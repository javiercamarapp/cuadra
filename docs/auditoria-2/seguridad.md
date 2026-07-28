# Seguridad — nota 7/10

## Hallazgos

### [alto] Con `DASHBOARD_SECRET` ausente, UNA cookie capturada permite crackear el passcode offline sin rate-limit
`src/lib/auth/passcode.ts:12-27`

```ts
function secret(): string {
  return process.env.DASHBOARD_SECRET || `likida:${process.env.DASHBOARD_PASSCODE || 'dev'}`;
}
export async function accessToken(passcode: string): Promise<string> {
  return hmacHex(`likida-access:${passcode}`);   // key = secret() = `likida:${passcode}`
}
```

Sin `DASHBOARD_SECRET`, la clave del HMAC y el mensaje firmado se derivan del **mismo** passcode. El
ataque concreto: un atacante que capture UNA sola cookie `likida_access` por cualquier medio ajeno al
código —laptop de demo compartida, `curl -v` pegado en un ticket de soporte, captura de pantalla,
historial de un proxy— puede, **offline y sin el rate-limit de `/acceso` (10/5min)**, probar candidatos
de passcode calculando `HMAC-SHA256('likida-access:'+p, 'likida:'+p)` hasta que coincida con el token
capturado. Un passcode de demo (corto, memorizable para enseñarlo en una llamada de ventas) cae en
minutos. Una vez roto, el atacante tiene el passcode real y acceso indefinido por el formulario normal,
sin que el límite de intentos por IP lo detenga nunca (no está adivinando en vivo).
Con `DASHBOARD_SECRET` configurado (secreto largo e independiente), el mismo token capturado NO permite
recuperar el passcode: haría falta adivinar dos valores de alta entropía a la vez.
No pude verificar el valor de `DASHBOARD_SECRET` en el entorno de producción real (fuera del alcance de
esta auditoría de solo lectura) — el hallazgo es sobre el código: el fallback existe y se activa
silenciosamente si alguien olvida poner la variable.

### [medio] La autorización del panel sigue en una sola capa — sin redundancia dentro de las páginas
`src/middleware.ts:9-33`, `src/app/dashboard/page.tsx`, `src/app/dashboard/[id]/page.tsx`

El gate vive ÚNICAMENTE en el matcher/regex del middleware (`path.startsWith('/dashboard')`, línea 18).
Verifiqué con `command grep` que ninguna página bajo `src/app/dashboard/` vuelve a comprobar
`tokenMatches`/`ACCESS_COOKIE` — ambas confían en que el middleware ya corrió. Ambas páginas leen con
`supabaseAdmin()` (service-role, bypassa RLS) y arman el `tenantId` desde `DEMO_TENANT_ID` en código, no
desde la sesión. El ataque concreto no es hoy —revisé los cuatro route groups vacíos
`src/app/(portal)/`, `(dashboard)/`, `(demo)/`, `(admin)/`: no contienen ni un `page.tsx`, así que no hay
actualmente ninguna ruta con datos del contralor fuera de `/dashboard`— pero el diseño es fresco (esos
route groups fueron creados para algo) y cualquier página nueva que no quede exactamente bajo el prefijo
`/dashboard`, o un ajuste futuro al regex del `matcher`, sirve datos fiscales y de operadores sin ningún
control adicional. Es un riesgo estructural de punto único de falla, no un hueco activo verificado hoy.

### [bajo] Comparación no-constante del passcode en el formulario de login — sigue sin corregirse
`src/app/acceso/page.tsx:25`

```ts
if (expected && code === expected) {
```

`passcode.ts` ya expone `constTimeEq` (usada en `tokenMatches`) y no se reutiliza aquí; `code === expected`
hace short-circuit por carácter. Mismo hallazgo #23 del boletín anterior, todavía vivo. Explotabilidad
sigue siendo baja por el rate-limit de 10 intentos/5min por IP (línea 20) — extraer señal de timing con
tan pocas muestras no es práctico. Lo dejo anotado porque no se corrigió, no porque cambie la nota.

### [opinión] Sin Content-Security-Policy
`src/middleware.ts:13-16` pone `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y
`Permissions-Policy`, pero no CSP. No encontré ningún `dangerouslySetInnerHTML` en `src/` (verificado con
`command grep`), así que no hay un sink de XSS conocido que una CSP esté protegiendo hoy. Es una capa de
defensa-en-profundidad ausente, no un hallazgo con fallo concreto — lo marco como opinión.

### [opinión] `/api/demo` (GET) expone `envHealth()` sin autenticación
`src/app/api/demo/route.ts:8-10` — devuelve `{ llm: bool, whatsapp: bool, supabase: bool }` a cualquiera,
sin passcode. Son solo booleanos ("¿está configurado el grupo de env X?"), nunca valores — el propio
comentario dice "sin exponer valores" y es cierto. El valor informativo para un atacante es mínimo
(saber si el webhook de WhatsApp tiene secretos puestos no le da ninguno de ellos). Lo anoto como
observación, no como hallazgo con fallo explotable.

## Riesgos anteriores: ¿siguen vivos?

Ambos riesgos señalados en el boletín anterior siguen exactamente igual, verificados contra el código
actual (no contra la memoria del boletín):

- **`DASHBOARD_SECRET` ausente → HMAC derivado del passcode** (`passcode.ts:12-14`): SIGUE VIVO, sin
  cambios línea por línea desde la auditoría anterior. Ver hallazgo alto arriba — con el ataque concreto
  de "una cookie capturada + brute-force offline" que el boletín no detalló pero que sí se sostiene con
  el código tal cual está.
- **Autorización del panel en una sola capa** (`middleware.ts:33` — hoy línea 32 del `matcher`): SIGUE
  VIVO. Confirmé además que ninguna página del dashboard revalida la cookie, y que los cuatro route
  groups vacíos (`(portal)`, `(dashboard)`, `(demo)`, `(admin)`) no materializan hoy una ruta expuesta,
  así que el riesgo sigue siendo estructural/latente, no una URL explotable ahora mismo.

Ninguno de los dos se corrigió. La nota no baja porque tampoco hay nada nuevo que agrave el cuadro, y el
resto de la superficie revisada (multi-tenancy, RPCs, webhook, inyección) está sólido.

## Lo que está sólido

- **HMAC del webhook de Meta, bien hecho.** `src/lib/meta/client.ts:33-39` — compara longitudes con `===`
  ANTES de llamar `crypto.timingSafeEqual` (que lanza si los buffers difieren de tamaño), evitando tanto
  el crash como una comparación insegura. El body cruda se firma antes de `JSON.parse` (orden correcto:
  verificar sobre bytes crudos, no sobre una reserialización). `verifyWebhookChallenge` para el GET de
  configuración usa el mismo patrón timing-safe.
- **Multi-tenancy: no encontré ningún camino que lea o escriba sin `tenant_id`.** Revisé
  `src/lib/cuadra/repo.ts` completo (387 líneas), `analytics.ts`, `conv.ts` y las RPCs de
  `supabase/migrations/`: cada `select`/`update`/`delete`/RPC que toca datos de tenant lleva
  `.eq('tenant_id', tenantId)` o el parámetro `p_tenant` en el `WHERE` de la función SQL.
  `resolveOperador` (`conv.ts:21-31`) es la única consulta sin ese filtro, y es correcto: en ese punto el
  tenant todavía no se conoce — es precisamente lo que el teléfono resuelve, y solo un `operador` ya dado
  de alta por la flota puede existir ahí (no es superficie controlable por un atacante externo).
- **Migraciones 0016-0019: RLS y `revoke` correctos, sin `security definer` de más.**
  `enriquecer_gasto_codigo` (0017) y `marcar_aviso_privacidad` (0018) son `language plpgsql` normal (NO
  `security definer`), filtran por `tenant_id` en el `WHERE`, y revocan `execute` de `public, anon,
  authenticated` explícitamente — necesario en Supabase porque los default privileges conceden a esos
  tres roles de forma explícita, no solo vía `PUBLIC` (documentado en el comentario de 0013, que sí lo
  verificó contra la DB). `codigo_pendiente` (0016) tiene RLS `enable` con deny-all por falta de policy.
  0019 es solo un índice único parcial, sin función nueva. Los únicos `security definer` del proyecto
  (`get_user_tenant_ids`, `is_superadmin`, 0001) son el patrón estándar y necesario para que las policies
  de RLS funcionen sin importar quién llame — no son parte del alcance 0017-0019 pero los revisé por
  contraste y están bien.
- **Prompt injection en OCR: defensa en profundidad real, no solo el flag.** `ocr.ts` instruye
  explícitamente al modelo a extraer el TOTAL impreso incluso si la imagen trae instrucciones, y a marcar
  `texto_sospechoso` aparte de `legible`. Ese flag SÍ llega a algún lado — no se queda en `ocrExtra` sin
  uso: `engine.ts:145-147` lo convierte en una `diferencia` tipo `texto_sospechoso` visible para el
  contralor en el dashboard. Y el backstop de `guardia.ts` (que no toqué como hallazgo, ya documentado en
  MAPA) asegura que ninguna cifra narrada por el LLM llega al usuario sin venir del motor determinístico —
  incluso si el prompt injection lograra alterar la NARRACIÓN de texto, no puede alterar un monto que se
  muestre. `sanitizar.ts` además cepilla folios/texto libre del OCR (charset acotado, sin `< > \``, cap de
  longitud) antes de que ese texto viaje al contexto del LLM en turnos futuros.
- **`tools.ts`: superficie de prompt-injection-a-dinero cerrada estructuralmente.** Las tres tools
  declaran `parameters: { properties: {} }` (líneas 26, 44, 68) — el modelo decide CUÁNDO llamar, nunca
  CON QUÉ datos; `tenantId`/`viajeId` se resuelven server-side desde `ctx`, nunca desde argumentos del
  LLM. Confirmado sin cambios desde la auditoría anterior.
- **Sin secretos hardcodeados ni logueados.** Búsqueda de patrones de credenciales (`sk-`, `AIza`,
  `xox[baprs]-`, bloques `PRIVATE KEY`) en `src/` y `supabase/`: nada. `src/lib/logger.ts` redacta RFC,
  UUID de CFDI y teléfonos con regex recursivo sobre objetos completos (vía
  `JSON.parse(redact(JSON.stringify(v)))`), y revisé cada línea que loguea algo con "token/secret/key" en
  el nombre: solo hay un `tope`/`usados` de límite de tokens del LLM, no un secreto real.
- **Rate limit y cap de body en los tres endpoints públicos.** Webhook (`MAX_BODY` antes Y después de leer
  el body, `MSGS_POR_MIN=40` por teléfono), `/api/export` (10/min por IP + su propio `tokenMatches`, pese
  a que `/api` está excluido del middleware — el patrón correcto de defensa en el propio endpoint, en
  contraste con el dashboard), `/api/demo` (cap de 64KB + 30/min por IP). Payload malformado en el webhook
  (`JSON.parse` que revienta) cae en un `catch` sin tipar que también atrapa un eventual `RangeError` por
  anidamiento profundo, y responde 400 en vez de tumbar la función.
- **Next.js 16.2.11 — descarté CVE-2025-29927** (bypass de middleware vía header
  `x-middleware-subrequest`, corregido en 14.2.25/15.2.3): la versión instalada es muchísimo más nueva que
  las versiones parcheadas, así que el punto único de falla del hallazgo medio de arriba no está agravado
  por esa vulnerabilidad conocida.

## Lo que no cubrí

No revisé `supabase/verificaciones.sql` (pruebas de concurrencia) ni corrí ningún test — la auditoría es
de solo lectura sobre código, según el MAPA. Tampoco pude confirmar el valor real de `DASHBOARD_SECRET`
ni `WHATSAPP_APP_SECRET` en el entorno de producción (Vercel), solo el comportamiento del código ante su
ausencia. No audité `src/lib/cuadra/intake/sat.ts` (consulta al SAT) ni `src/lib/cuadra/intake/cfdi.ts`
(parsing de QR/zxing) a fondo por tiempo — son superficie de datos no confiables (un CFDI/QR es
input externo) que valdría revisar en una próxima pasada si no se cubrió en otro rubro.
