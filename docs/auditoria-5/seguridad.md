# Seguridad — auditoría 5

**Nota: 7/10** (antes 7). Razón: dos fuerzas opuestas se cancelan. *Se atacó y
subió* — `outputFileTracingExcludes` cerró una fuga real (`.env.local` con la
service-role key viajaba al bundle de la función) y lo verifiqué archivo por
archivo en los 12 manifiestos de trazado: **cero** coincidencias de `.env`,
`.md`, `docs/`, `supabase/` o `scripts/`. Y *mirada más profunda* en dirección
contraria — el 7 anterior era heredado ("no auditado esta ronda"); este está
sostenido con lecturas del catálogo de Postgres en producción, cinco peticiones
al sitio vivo y un test del regex de redacción. Lo que la mirada encontró le
quita lo que el arreglo le puso.

**El riesgo mayor hoy:** el sitio ya está en producción con datos fiscales y
personales reales de un tenant, y lo único que los separa de internet es un
passcode compartido, adivinable y sin forma de revocar (`likida-demo-2026`) — las
dos capas de autorización del panel son buenas, pero las dos comprueban el
**mismo** secreto débil, y dos capas del mismo candado son un candado.

---

## Hallazgos

### [ALTO] El panel de producción está detrás de una credencial adivinable, compartida y no revocable

`src/lib/auth/passcode.ts:42-50` · `src/app/acceso/page.tsx:20-33` ·
`src/lib/ratelimit.ts:7-27` · `src/app/api/export/liquidaciones/route.ts:15-26`

**Escenario con valores.** `DASHBOARD_PASSCODE=likida-demo-2026` (verificado en
`.env.local:9`). El patrón es `<marca>-demo-<año>`: una lista de 50 candidatos
obvios (`likida`, `likida2026`, `demo`, `likida-demo`, `likida-demo-2026`…) lo
contiene. El límite es 10 intentos / 5 min por IP (`acceso/page.tsx:20`), pero
`buckets` es un `Map` **en memoria del proceso** (`ratelimit.ts:7`): en Vercel
cada instancia concurrente arranca con el suyo vacío, así que el techo real es
10 × (instancias que el atacante logre abrir en paralelo), no 10.

Con el passcode acertado:

- `GET /dashboard` → KPIs, acreditables y las 20 liquidaciones más recientes del
  tenant. Hoy en la base de producción hay **1 tenant, 3 operadores, 5
  liquidaciones, 8 gastos y 5 PDF** (contado con `SELECT` sobre el proyecto
  `gngoqsvrxdguxvsizpbw`).
- `GET /api/export/liquidaciones` → CSV de hasta **5 000** filas que incluye
  `operador:operador_id(nombre)` — el **nombre propio** de cada operador junto a
  sus montos (`route.ts:23`). Verificado en producción: devuelve `401 No
  autorizado` sin cookie, y ese 401 es lo único que lo cubre.

**Y la credencial no caduca.** `accessToken()` es
`HMAC-SHA256("likida-access:" + passcode)` con `DASHBOARD_SECRET`: es
**determinista**. La misma cookie vale para todos los usuarios, desde cualquier
IP, para siempre. `maxAge: 60*60*8` (`acceso/page.tsx:30`) es una pista para el
navegador, no una expiración de servidor: `tokenMatches()` acepta un valor
copiado de las devtools hace un año. No hay identificador de sesión, no hay
revocación, no hay contador de intentos sobre la cookie ya emitida. Después del
demo del 6-ago, cortarle el acceso a quien vio el passcode exige rotar la
variable de entorno — y eso corta a todos a la vez.

**Consecuencia.** Datos personales de operadores (nombre) y la contabilidad de
una flota, expuestos a quien acierte una cadena que un humano adivina. Y una vez
dentro, el acceso es permanente y no se puede quitar selectivamente.

**Causa raíz.** El candado se diseñó como "suave para el demo" y está
documentado así (`passcode.ts:1-5`), pero el demo dejó de ser un demo el día que
el sitio salió a producción con datos reales detrás. El diseño no cambió con la
exposición.

**Lo que intenté para refutarlo y no lo tumbó:** (a) `x-forwarded-for` no es
falsificable — Vercel lo **sobrescribe** y no reenvía IPs externas justo para
impedir el spoofing (doc oficial de request headers), así que el límite por IP sí
apunta a la IP real; (b) la comparación es en tiempo constante (`constTimeEq`,
`passcode.ts:59-64`), sin fuga por timing; (c) `DASHBOARD_SECRET` tiene 48 hex de
entropía real y **no** tiene fallback en producción (`passcode.ts:26-30`) — el
HMAC está bien construido. Nada de eso ayuda cuando lo que se adivina es el
passcode, no el HMAC. (d) El panel no está enlazado desde la landing, pero
`/dashboard` es la ruta obvia y el 307 a `/acceso` la confirma en una petición.

---

### [ALTO] El tenant se resuelve desde un teléfono externo sin desempate ni criterio de tenant

`src/lib/cuadra/conv.ts:59-69` (`resolveOperador`) ·
`src/lib/cuadra/conv.ts:43-56` (`variantesTelefono`) ·
`supabase/migrations/0001_init.sql:34` (`unique (tenant_id, telefono)`)

Esta es la única línea del sistema donde **el tenant nace de un dato del
exterior**. Todo lo demás lo hereda de aquí: `processor.ts:187` toma `op.tenantId`
y lo empuja a `getOpenViaje`, `addGasto`, `getGastos`, `saveLiquidacion` y a la
ruta del PDF en storage.

```
.in('telefono', variantesTelefono(telefono))
.eq('activo', true)
.limit(1)
.maybeSingle();
```

No hay `.eq('tenant_id', …)` — no puede haberlo, es lo que se está resolviendo —
pero tampoco hay `.order(...)`. **`limit(1)` sin orden es una fila arbitraria.**

**Escenario con valores.** La unicidad de la base es `(tenant_id, telefono)`, no
`telefono`: el mismo número puede vivir en N tenants. Juan Pérez maneja para la
Flota A, que lo dio de alta como `+525512345678` y nunca lo puso
`activo=false`; se cambia a la Flota B, que lo da de alta como `5215512345678`.
Meta entrega su mensaje con `from = 5215512345678`. `variantesTelefono` devuelve
`['5215512345678', '525512345678', '+5215512345678', '+525512345678']` — el `in`
empareja **las dos filas**, y gana la que Postgres saque primero.

Si gana la Flota A: la foto del ticket de un viaje de la Flota B se inserta como
`gasto` de la Flota A, se cuadra contra la política de la Flota A, se cierra en
una `liquidacion` de la Flota A, y el PDF con el nombre de Juan se sube a
`liquidaciones/<tenant-A>/<viaje>-operador.pdf`. El contralor de la Flota A lo ve
en su panel. Nadie recibe error: todas las escrituras están correctamente
scopeadas al tenant… equivocado.

Y no hace falta un segundo tenant. Dentro de **uno solo**, `unique (tenant_id,
telefono)` no impide dos filas del mismo humano (`+525512345678` y
`5215512345678` son cadenas distintas), y entonces el desempate arbitrario elige
el `operadorId` equivocado → `getOpenViaje` busca el viaje del otro y el operador
recibe "no tienes un viaje abierto" mientras su viaje sigue abierto, o su gasto
aterriza en el viaje de un compañero.

**Consecuencia.** Es el fallo de autorización multi-tenant clásico: dato personal
y fiscal de una flota escrito en la contabilidad de otra, sin ningún error
visible.

**Causa raíz.** El commit `b7b2fcc` de esta ronda amplió el emparejamiento de
igualdad exacta a cuatro variantes para arreglar un bug real ("no te tengo
registrado"), y al ampliarlo multiplicó por cuatro las formas en que dos filas
pueden colisionar — sin añadir desempate. La unicidad de la base sigue siendo la
de antes.

**Refutación honesta, y es importante:** *esto no está vivo hoy.* Conté en la
base de producción: **1 tenant y 3 operadores con teléfonos distintos** (formas
`+52`+10 dígitos y `52`+10 dígitos, sin colisión). Y `msg.from` **no** lo controla
un atacante: viene dentro del cuerpo firmado con HMAC por Meta. O sea, no es
explotable — es un defecto latente que se arma solo el día que entra la segunda
flota, o el día que alguien recaptura un teléfono con otro formato. Lo califico
ALTO por eso y no CRÍTICO.

---

### [MEDIO] La redacción de PII del logger falla exactamente en el formato de teléfono que Meta entrega

`src/lib/logger.ts:11` · `src/app/api/webhook/whatsapp/route.ts:60` ·
`src/lib/cuadra/conv.ts:126`

`const PHONE = /\b\+?52\d{10}\b|\b\d{10}\b/g;`

El `\b` final exige frontera de palabra, y dentro de una corrida de dígitos no
hay fronteras. Un número mexicano con el "1" son **13** dígitos, no 12. Corrido
tal cual sobre el valor real que documenta el MAPA:

```
5219993700779    -> 5219993700779     ← NO redactado
529993700779     -> [TEL]
+5219993700779   -> +5219993700779    ← NO redactado
+529993700779    -> +[TEL]
```

**Escenario.** Un operador manda 41 fotos en un minuto. `route.ts:60` ejecuta
`logger.warn('wa.ratelimit', { from: '5219993700779' })`. Como es `warn`, sale por
`console.error` a los logs de Vercel **y** —si `SENTRY_DSN` está puesto en
Vercel, cosa que no pude verificar— se replica a Sentry, un tercero fuera de
México. El teléfono va en claro. `conv.ts:126` (`conv.historial_descartado`) hace
lo mismo con `telefono` y se dispara en cada viaje nuevo, que es el caso común,
no el raro.

**Consecuencia.** El dato personal directo del operador —el teléfono— queda en
los logs y en el subencargado, que es justo lo que la cabecera del módulo promete
que no pasa ("redacción de PII fiscal (RFC, UUID CFDI, teléfonos)… siempre después
de redactar"). Un control que dice hacer algo y no lo hace es peor que no
tenerlo: nadie vuelve a mirar.

**Causa raíz.** El regex se escribió contra la forma sin el "1", que es la que
está en la semilla y en la columna `operador.telefono`. Meta entrega la forma
**con** el "1" — el descubrimiento central de esta ronda (`meta/client.ts:45-61`).
El arreglo del destinatario se hizo en `client.ts` y no se propagó al logger.

**Nota secundaria, no verificada contra un valor real de este sistema:** el
`wamid` que se registra en `processInbound.fail` (`processor.ts:703`) lleva el
E.164 codificado en base64 por construcción del identificador de Meta
(`wamid.HBgNNTIxOTk5MzcwMDc3OQ…` → `5219993700779`). Si eso se confirma con un
wamid real de producción, la redacción tampoco lo alcanza.

---

### [MEDIO] La URL firmada del PDF vive una hora; la necesidad dura segundos

`src/lib/cuadra/processor.ts:679`

```ts
const path = `${op.tenantId}/${viajeId}-operador.pdf`;
const { data, error } = await supabaseAdmin().storage
  .from('liquidaciones').createSignedUrl(path, 3600);
await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', …);
```

**Escenario con valores.** La URL firmada es un **portador**: quien la tenga baja
el PDF sin autenticarse. Su único consumidor es Meta, que descarga el `link` al
recibir el mensaje — segundos, no una hora. `3600 s` es ~60× la ventana necesaria,
y en ese tiempo la URL existe en el cuerpo de la petición a `graph.facebook.com`,
en la infraestructura de Meta y en cualquier traza intermedia.

El documento no es anodino: es el ejemplar del operador, con su **nombre**, el
folio del viaje, los conceptos y los montos (`tools.ts:139`, `pdf.ts:70,347`).

**Consecuencia.** Una fuga de esa cadena dentro de la hora entrega un documento
con datos personales y fiscales a cualquiera, sin pasar por el passcode ni por
RLS.

**Causa raíz.** `3600` es el default cómodo de `createSignedUrl`, no un número
derivado de cuánto dura la necesidad.

**Camino adicional que no pude cerrar ni descartar:** si Meta rechaza el envío,
`client.ts:103` registra `logger.error('wa.sendDocument', { status, body })` con el
cuerpo de la respuesta. La redacción tapa RFC, UUID y teléfonos, pero **no** un
JWT de Supabase. Si Meta hiciera eco del `link` en su mensaje de error, una URL
firmada viva entraría a los logs y a Sentry. No lo verifiqué —exigiría provocar un
envío fallido contra la API de Meta, prohibido en esta ronda—.

---

### [BAJO] `bodyExcede` promete un cap que no siempre aplica, y `/api/demo` se lo cree

`src/lib/ratelimit.ts:5,36-39` · `src/app/api/demo/route.ts:30`

`bodyExcede` mira **solo** `content-length`. Una petición con
`Transfer-Encoding: chunked` no lo lleva, `Number(null || 0)` da `0`, y la función
devuelve `false` — "cabe". El webhook lo sabe y se cubre releyendo `raw.length`
después (`webhook/whatsapp/route.ts:44`, con el comentario "por si falta
content-length"). `/api/demo` **no**: llama `bodyExcede(req, 64*1024)` y luego
`await req.json()` sin volver a medir. El comentario de `ratelimit.ts:5` afirma que
el cap "es por-request y **siempre** aplica (defensa DoS principal)", y para esa
ruta es falso.

**Consecuencia.** Acotada: Vercel corta el cuerpo en su propio límite de
plataforma, así que el techo pasa de 64 KB a algunos MB, no a infinito, y la ruta
no toca la base. Es la afirmación la que está mal, no el cielo el que se cae.

---

### [BAJO] `/api/demo` publica sin autenticar qué grupos de secretos están configurados

`src/app/api/demo/route.ts:8-10` · `src/lib/env.ts:21-27`

Verificado contra producción hace un momento:

```
GET https://likidaai.vercel.app/api/demo
→ 200 {"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}
```

No expone valores —eso está bien puesto y así lo dice el comentario— pero sí
confirma a un desconocido que hay credenciales de LLM, de WhatsApp y de Supabase
cargadas. Valor de reconocimiento: le dice al que mira dónde vale la pena
insistir. El matcher del proxy excluye `/api`, así que esta respuesta además sale
sin `X-Content-Type-Options` ni `X-Frame-Options`.

---

## Lo que revisé y está bien

Todo lo de esta sección lo comprobé yo, no lo di por bueno.

**El renombre `middleware.ts` → `proxy.ts` no dejó ninguna ruta descubierta.**
`.next/server/middleware-manifest.json` sale vacío (`"middleware": {}`), y eso
asusta hasta que se abre `functions-config-manifest.json`, donde está registrado
como `/_middleware` con `"runtime": "nodejs"` y el matcher compilado intacto:
`^(?:\/(_next\/data\/[^/]{1,}))?(?:\/((?!api|_next\/static|_next\/image|favicon.ico).*))(\.json|\.rsc|\.segments\/.+\.segment\.rsc)?[\/#\?]?$`.
El manifiesto vacío es el legacy de edge, no una ausencia. Y confirmado en vivo:
`GET /dashboard` → `307 → /acceso?next=%2Fdashboard`; `GET /` y `/acceso` → 200
con las cuatro cabeceras (`x-content-type-options`, `x-frame-options: DENY`,
`referrer-policy`, `permissions-policy`) presentes. Que el 307 responda en vez de
un 500 prueba además que `DASHBOARD_SECRET` **sí** está puesto en Vercel — sin
él `secret()` lanza (`passcode.ts:26`) y el panel entero devolvería 500.

**Las dos capas del panel existen de verdad.** No solo el matcher:
`dashboard/page.tsx:46` y `dashboard/[id]/page.tsx:30` llaman `exigirAcceso()`
antes de cualquier consulta. Las únicas otras páginas son `/`, `/demo`, `/acceso`
y `not-found`, y ninguna importa `supabaseAdmin` (grepeado). No hay página con
datos de tenant fuera de `/dashboard`.

**El HMAC del webhook se valida ANTES de parsear y antes de cualquier efecto.**
`webhook/whatsapp/route.ts`: cap de cuerpo (41) → `req.text()` (43) → recheck de
longitud (44) → `verifySignature` (45) → **`JSON.parse` (51)** → extracción (56)
→ `after()` (70). No hay una sola escritura ni una sola llamada de red antes de la
línea 45. `verifySignature` (`meta/client.ts:33-40`) falla cerrado si falta el
secreto o la firma, compara longitud antes de `timingSafeEqual` (que lanza con
buffers de distinto largo) y usa el cuerpo **crudo**, no el reserializado.
`verifyWebhookChallenge` (24-30) tiene el mismo cuidado.

**El `outputFileTracingExcludes` es efectivo.** Recorrí los 12 `*.nft.json` del
build y conté las coincidencias de `.env`, `*.md`, `docs/`, `supabase/` y
`scripts/`: **cero en los doce**. En el bundle del webhook, el más gordo, quedan
616 archivos y ninguno es un secreto ni una nota interna. La fuga que motivó el
cambio está cerrada. *Lo que sí sigue viajando* —y lo dejo anotado sin subirlo a
hallazgo porque no hay secreto en ello— es el árbol `src/` completo en TypeScript,
`schema.sql`, `pruebas-manuales/*.prueba.ts` (incluido el arnés de inyección),
`package-lock.json` y `tsconfig.tsbuildinfo` (431 KB). Es superficie regalada, no
exposición.

**RLS y grants, leídos del catálogo de Postgres en producción, no de las
migraciones.** Las 14 tablas de `public` tienen `relrowsecurity = true`. Las que
tienen política usan `tenant_id = any(get_user_tenant_ids()) or is_superadmin()`,
y para `anon` eso evalúa a falso siempre (`auth.uid()` es NULL → arreglo vacío).
`codigo_pendiente`, `viaje_lock` y `wa_mensaje_procesado` tienen RLS con **0**
políticas = deny-all, que es lo correcto. `app_user` solo tiene política de
`select`, así que nadie se auto-nombra superadmin.

**Los `GRANT` implícitos de Supabase: la trampa que el rubro señala, y aquí no
está.** Sospeché de la migración `0012_seguridad_rls.sql:13-18`, que hace
`revoke … from public` sobre `try_lock_viaje`, `unlock_viaje` e `intake_delta`
**sin** revocar de `anon` y `authenticated` — mientras la `0013:52-55` documenta
haber verificado en la base que "revoke from public NO basta". Dos migraciones
contradiciéndose es exactamente la forma de una vulnerabilidad. **Refutado con el
catálogo:** `proacl` de las tres funciones es `postgres=X/postgres |
service_role=X/postgres`. Sin `anon`, sin `authenticated`, sin `PUBLIC`. Lo mismo
para `guardar_liquidacion_tx` (las dos aridades), `enriquecer_gasto_codigo` y
`marcar_aviso_privacidad`. Las únicas ejecutables por `anon` son
`get_user_tenant_ids()` e `is_superadmin()`, y con `auth.uid()` nulo devuelven
`{}` y `false`. Nadie puede soltar el mutex del viaje ni mover el contador de la
barrera con la anon key.

**Storage.** Un solo bucket, `liquidaciones`, `public = false`, y **0** políticas
sobre `storage.objects` → ni listar ni leer con la anon key. Los PDF solo salen
por URL firmada.

**El scoping por tenant en `repo.ts` está completo.** Revisé las 14 funciones que
tocan la base: todas llevan `.eq('tenant_id', tenantId)` o lo pasan como parámetro
a un RPC que lo pone en el `WHERE` (`enriquecer_gasto_codigo` lo tiene en la
línea 48 de la 0017; `guardar_liquidacion_tx` en el `update viaje … and tenant_id
= p_tenant`). Y seguí cada identificador externo hasta su origen: el `id` de
`/dashboard/[id]` va a `getLiquidacionDetalle(id, TENANT())` con `.eq('tenant_id')`
(`analytics.ts:138`); `viajeId` sale de `getOpenViaje(tenant, operador)`;
`decision.gastoId`, `match.id` y `cod.id` salen de consultas ya scopeadas por
tenant **y** por viaje. No encontré un solo IDOR. El único identificador que entra
sin verificar pertenencia es el teléfono, y es el hallazgo ALTO de arriba.

**Las tools no aceptan datos del modelo.** Las tres declaran
`parameters: { type: 'object', properties: {}, additionalProperties: false }`
(`tools.ts:31,49,108`) y sacan `tenantId`/`viajeId` del `ctx` resuelto en servidor
(`processor.ts:532`). El modelo decide *cuándo*, nunca *sobre qué fila*. La
inyección de prompt está cerrada estructuralmente, no por filtro.

**Inyección de XML al servicio del SAT: refutada.** `sat.ts:38-42` mete
`re/rr/tt/id` dentro de un `<![CDATA[…]]>` de la petición SOAP, y esos campos
salen de un QR que el atacante puede imprimir y fotografiar. Un `]]>` en el QR
rompería el CDATA. No pasa: `parseCfdiQr` (`cfdi.ts:76-100`) solo asigna el campo
si pasa `esUuidValido` (hex y guiones) o `esRfcValido` (alfanumérico), y `tt` va
por `parseFloat` + `toFixed(6)`. Ninguno de esos alfabetos contiene `]`, `>` ni
`&`.

**Sin sumideros peligrosos.** Cero `dangerouslySetInnerHTML`, `eval`,
`new Function`, `child_process` o `exec` en `src/`. Sin SQL construido por
concatenación: todo pasa por el query builder de supabase-js o por funciones
plpgsql con parámetros tipados.

**Sin redirección abierta.** `/acceso` valida `next` con
`startsWith('/dashboard')` en los dos puntos donde se usa (`page.tsx:11` y `:32`).
`//evil.com` y `//dashboard.evil.com` fallan el prefijo; `/dashboard…` cualquier
cosa es una ruta relativa del mismo origen.

**`x-forwarded-for` no es falsificable en esta plataforma.** Lo verifiqué en la
documentación de Vercel: sobrescriben el header y no reenvían IPs externas,
literalmente "to prevent IP spoofing". `clientIp()` (`ratelimit.ts:30-33`) toma el
primer valor, y ese primer valor es el real. El límite por IP apunta a donde
dice.

**Ningún secreto con fallback silencioso.** `passcode.ts:26-30` **lanza** en
producción si falta `DASHBOARD_SECRET`, con el razonamiento escrito de por qué el
fallback anterior era crackeable offline. `supabaseAdmin()` lanza sin URL o sin
key. `meta/client.ts:12-21` lanza sin token o sin phone number id.
`getClient()` de OpenRouter lanza sin API key. Esto es lo que el ancla del rubro
pide para un 8, y está.

---

## CVE descartados y por qué

`npm audit`: 17 vulnerabilidades (1 crítica, 13 altas, 3 moderadas). **Dieciséis
de las diecisiete están en `devDependencies` y no llegan al artefacto
desplegado.**

- **`vitest` (CRÍTICA, GHSA-5xrq-8626-4rwp)** — "when Vitest UI server is
  listening, arbitrary file can be read and executed". **Descartada:** vitest es
  devDependency, el proyecto nunca corre `vitest --ui` (`package.json` solo tiene
  `vitest run`), y nada de vitest entra al bundle — comprobado en los 12
  `*.nft.json`, donde no aparece. Sin servidor de UI escuchando no hay
  vulnerabilidad, ni siquiera en local.
- **`vite` / `vite-node` / `esbuild` / `@vitest/mocker` (alta y moderadas)** —
  path traversal en `.map`, bypass de `server.fs.deny` en Windows, dev-server que
  atiende a cualquier origen. **Descartadas:** todas exigen un dev-server
  escuchando. Este proyecto usa Turbopack para `next dev`, y vite solo existe como
  dependencia de vitest. Además, dos de las tres son específicas de Windows y el
  desarrollo es en macOS.
- **`eslint`, `@eslint/eslintrc`, `@eslint/config-array`, `eslint-config-next`,
  `eslint-plugin-*`, `minimatch`, `brace-expansion` (altas)** — todas se reducen a
  **una**: `brace-expansion` GHSA-mh99-v99m-4gvg, DoS por expansión sin cota.
  **Descartadas:** el atacante tendría que controlar un patrón glob de la
  configuración de ESLint, o sea el repo mismo. ESLint no corre en producción ni
  procesa entrada de usuario. Ruido de árbol de dependencias.
- **`postcss` < 8.5.17 (alta, GHSA-6g55-p6wh-862q / GHSA-r28c-9q8g-f849)** —
  lectura arbitraria de archivos vía `sourceMappingURL` en comentarios CSS.
  **Descartada:** entra por `next` y solo se ejecuta en tiempo de build, sobre el
  CSS del propio repo (`globals.css` y el design-system). No hay ninguna ruta por
  la que un CSS de un tercero llegue a postcss. Si algún día se procesara CSS
  subido por un usuario, deja de estar descartada.

**La única que NO descarto del todo: `sharp` 0.34.5 (alta, GHSA-f88m-g3jw-g9cj).**
Es dependencia de **producción** y hay un camino real de entrada:
`cfdi.ts:249` hace `sharp(image).rotate().resize(...)` sobre los bytes que bajaron
de WhatsApp (`downloadMediaAsDataUrl`), o sea sobre una imagen que la manda un
tercero. El aviso dice literalmente "vulnerable when processing untrusted image
input" y parcha en 0.35.0; aquí está instalada 0.34.5 (`node_modules/sharp/package.json:4`).

Lo que baja el riesgo, y por eso lo dejo como observación y no como hallazgo: el
aviso identifica los cargadores afectados como **GIF (`VipsForeignLoadNsgif`),
TIFF (`VipsForeignLoadTiff`) y VIPS**, y por el canal de WhatsApp un mensaje
`type: 'image'` llega como JPEG o PNG —Meta transcodifica—; un TIFF o un GIF
viajaría como `document`, y esa rama va a `downloadMediaAsText` + parser de XML,
sin tocar sharp. El CVSSv4 de 7.0 apunta a integridad y disponibilidad, no a
ejecución remota. Aun así: quien lo consiguiera estaría dentro de la función que
tiene la service-role key, así que el impacto sería total aunque la probabilidad
sea baja.

---

## Lo que NO alcancé a revisar

- **Las variables de entorno reales del proyecto en Vercel.** Solo pude inferir
  que `DASHBOARD_SECRET` está puesta (porque `/dashboard` responde 307 y no 500).
  No sé si `SENTRY_DSN` está configurada, y de eso depende si el hallazgo del
  teléfono sin redactar sale o no del perímetro hacia un tercero.
- **Si el límite de tasa aguanta de verdad bajo concurrencia.** Razoné que
  `Map` en memoria por instancia se multiplica con las lambdas concurrentes, pero
  no lo medí: medirlo exige lanzar tráfico agresivo contra producción, y está
  prohibido en esta ronda. La afirmación del propio módulo —"un atacante golpea
  una instancia y queda limitado"— sigue sin comprobar.
- **Si Meta hace eco de la URL firmada en sus mensajes de error.** Exigiría
  provocar un `sendDocument` fallido contra la API real.
- **El bypass de `bodyExcede` por `Transfer-Encoding: chunked`.** Lo deduje del
  código; no lo probé contra producción para no meterle cuerpos grandes.
- **Rotación y alcance del `WHATSAPP_ACCESS_TOKEN`.** No revisé si es un token de
  usuario de sistema con caducidad o uno permanente, ni qué permisos tiene. Un
  token de Meta con más alcance del necesario es superficie que no miré.
- **La cadena de suministro de `zxing-wasm`.** El `.wasm` se carga de disco en
  runtime y se le mete al bundle a la fuerza (`next.config.ts:11-15`). No verifiqué
  integridad ni procedencia del binario; es código nativo procesando imágenes de
  terceros, igual que sharp.
- **Los `pruebas-manuales/inyeccion.prueba.ts`.** Existen y cubren inyección de
  prompt, pero no se corren (llamadas de pago) y no los ejecuté, así que no puedo
  decir si siguen pasando.
