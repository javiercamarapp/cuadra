# Seguridad — auditoría 6

**Nota: 8/10** (antes 7). Razón, y son las dos primeras formas a la vez.

*Se atacó y subió* — los dos ALTOS de la ronda 5 (passcode adivinable/eterno/
irrevocable, y tenant resuelto por teléfono sin desempate) se cierran con la
reescritura de `src/lib/auth/passcode.ts` y con `conv.ts` + dos migraciones
(0024, 0028). Pasé la ronda completa tratando de romper el diseño nuevo —
forjar el token, reutilizarlo para extender la sesión, hacerlo bajar al
formato viejo, tumbar la comparación por timing— y no encontré ninguna vía.
Está respaldado por 19 pruebas propias (`passcode.test.ts`, `guard.test.ts`)
que cubren exactamente los casos que probé a mano, y el arreglo del tenant
quedó en DOS capas independientes: aplicación (`resolveOperador` ahora lanza
en vez de adivinar) y base de datos (índice único global sobre teléfonos
activos + FK compuesta que ata `gasto`/`liquidacion` al tenant de su `viaje`).

Lo que impide el 9: la reescritura sí abrió un defecto nuevo, aunque menor
—cabeceras de seguridad que se pierden en la rama de redirección de
`/dashboard`, verificado en vivo— y dos MEDIO/BAJO de la ronda 5 (TTL de la
URL firmada del PDF, `bodyExcede` sin remedir en `/api/demo`) siguen sin
tocarse.

**No encontré ningún crítico.** No hay acceso sin autenticar a datos de un
tenant, ni un secreto con fallback silencioso, ni un identificador externo que
se use sin comprobar que pertenece al tenant resuelto en servidor.

---

## Hallazgos

### [BAJO] Las cabeceras de seguridad y el `no-store` nuevo se pierden exactamente en la rama de redirección de `/dashboard`

`src/proxy.ts:9-46`

```ts
export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  ...
  res.headers.set('X-Content-Type-Options', 'nosniff');       // 13
  res.headers.set('X-Frame-Options', 'DENY');                 // 14
  res.headers.set('Referrer-Policy', ...);                    // 15
  res.headers.set('Permissions-Policy', ...);                 // 16
  ...
  if (path.startsWith('/dashboard')) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate'); // 32
    const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
    if (hayPasscode() && !(await tokenMatches(cookie))) {
      const url = req.nextUrl.clone();
      url.pathname = '/acceso';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);   // 42 — objeto NUEVO, no `res`
    }
  }
  return res;                              // 45 — el que sí lleva las cabeceras
}
```

Las cinco cabeceras (las cuatro generales más el `Cache-Control: no-store` que
se añadió esta ronda) se escriben sobre `res`. Pero cuando el visitante NO
tiene una sesión válida —que es el caso más común: cualquiera antes de
teclear el passcode, y cualquiera cuya sesión ya caducó a las 8 h— la función
no devuelve `res`: construye un objeto de respuesta **nuevo** con
`NextResponse.redirect(url)` en la línea 42, que no hereda nada de lo que se
escribió arriba.

**Verificado en vivo** contra producción (2026-07-29, sin cookie):

```
GET https://likidaai.vercel.app/dashboard
→ 307
  cache-control: public, max-age=0, must-revalidate      ← el default de Vercel, no el no-store del código
  (sin x-content-type-options, sin x-frame-options,
   sin referrer-policy, sin permissions-policy)
```

Contra el mismo endpoint con un valor de cookie con forma de token v2 pero
firma inventada, y con el formato viejo de 64 hex, el resultado es idéntico:
307 sin las cinco cabeceras. La comparación es la que sí funciona bien —a eso
llego más abajo—; lo que falla es solo el empaquetado de la respuesta.

**Consecuencia, y por qué la dejo en BAJO y no más arriba.** Lo intenté
escalar y no encontré cómo. La respuesta 307 no lleva cuerpo con datos: no hay
nada que un atacante gane enmarcando esta página (no hay contenido) ni nada
que la ausencia de `Referrer-Policy` filtre (la única cabecera saliente
relevante, `Location`, apunta a `/acceso`, no a nada con secretos). Y la
amenaza que motivó el `Cache-Control: no-store` de esta ronda —que la HTML
real del panel quede en el caché del navegador tras cerrar sesión— sigue
cubierta: `dashboard/page.tsx:10` y `dashboard/[id]/page.tsx:11` declaran
`export const dynamic = 'force-dynamic'`, y Next pone su propio
`private, no-cache, no-store` en CUALQUIER página dinámica que sí se sirve
—lo confirmé en vivo contra `/acceso`, que tampoco pasa por el bloque de
`proxy.ts` que fija `Cache-Control` y aun así sale con
`private, no-cache, no-store, max-age=0, must-revalidate`—. O sea: el
contenido con datos siempre queda protegido por Next, con o sin la línea 32
del proxy. Lo único que de verdad se pierde en la rama de redirección es
higiene de cabeceras sobre una respuesta vacía.

**Causa raíz.** `NextResponse.redirect()` crea una respuesta desde cero; para
que herede cabeceras hay que copiarlas explícitamente o construir el redirect
sobre `res` (`res.headers.set('Location', ...); return new
Response(null, { status: 307, headers: res.headers })`, o el patrón
equivalente de Next). El código de antes de esta ronda no tenía este problema
porque no había nada que perder —el `Cache-Control` no existía—; al añadirlo
sin revisar las dos ramas de salida, la ronda abrió la inconsistencia.

---

### [MEDIO, sigue abierto de la ronda 5 — sin cambios] La URL firmada del PDF que manda WhatsApp sigue viva una hora

`src/lib/cuadra/processor.ts:783`

```ts
const { data, error } = await supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600);
```

Nada tocó esta línea. Sigue siendo el mismo hallazgo de la ronda 5: el único
consumidor es Meta, que descarga el `link` en segundos, no en una hora, y el
documento lleva nombre, folio y montos del operador. Lo interesante de esta
ronda es que el equipo **sí conoce y aplicó** el número correcto en código
nuevo: `src/app/api/export/pdf/[id]/route.ts:59`, la ruta de descarga del
panel que se agregó esta ronda, firma con **60** segundos —

```ts
.createSignedUrl(data.pdf_url as string, 60, { download: `liquidacion_${id.slice(0, 8)}.pdf` });
```

— o sea: el patrón correcto existe en el repo, a 100 líneas del que sigue mal.
No lo subo de severidad porque el escenario y la consecuencia no cambiaron
desde la ronda 5 (una fuga de la cadena Meta-Graph dentro de esa hora expone
el PDF a quien la intercepte); lo dejo anotado para que no se pierda que ya
hay una plantilla correcta a la que copiar.

---

### [BAJO, sigue abierto de la ronda 5 — sin cambios] `bodyExcede` en `/api/demo` sigue sin remedir tras leer el cuerpo

`src/app/api/demo/route.ts:30` · `src/lib/ratelimit.ts:86-98`

Mismo hallazgo que la ronda 5, mismo código. `ratelimit.ts` documenta el
propio hueco en su cabecera (líneas 18-20: "`api/demo/route.ts:30` no lo
hace"), así que no es una omisión sin dueño — está anotada y no se atendió
esta ronda. Consecuencia acotada, igual que antes: Vercel corta el cuerpo en
su propio límite de plataforma antes de que esto importe.

---

### [BAJO, sigue abierto de la ronda 5 — sin cambios] `/api/demo` sigue publicando sin autenticar qué grupos de secretos están configurados

`src/app/api/demo/route.ts:8-10` · `src/lib/env.ts:54-60`

Verificado en vivo, 2026-07-29:

```
GET https://likidaai.vercel.app/api/demo
→ 200 {"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}
```

Idéntico al de la ronda 5. `envHealth()` sigue devolviendo booleanos, no
valores, así que el riesgo sigue siendo solo de reconocimiento.

---

## El ataque real de esta ronda: ¿se puede forjar, reusar o alargar el token v2?

Intenté las cuatro cosas que pide el encargo, contra `src/lib/auth/passcode.ts`.

**Forjar sin el secreto.** El HMAC (`firma()`, línea 190-196) cubre
`VERSION|emitidoEn|nonce|passcode` completo, con `DASHBOARD_SECRET` como
clave. `tokenMatches` (236-252) recalcula la firma con el passcode **del
servidor**, nunca con uno que traiga la cookie —la cookie no lleva el
passcode en claro, solo la firma—, así que no hay forma de que un atacante
sin el secreto produzca un `partes[3]` que pase `constTimeEq`. Intenté
construir un mensaje ambiguo (dos tripletas `emitidoEn/nonce/passcode`
distintas que concatenen al mismo string antes del HMAC, para explotar la
falta de un separador con escape) y no lo logré: `nonce` tiene longitud fija
(32 hex, comprobada por regex antes de usarse) y `emitidoEn` se serializa
como el mismo número decimal en emisión y verificación, así que no hay dos
tripletas value-distintas que produzcan el mismo mensaje firmado. Y aunque
lo lograra, seguiría sin el secreto para firmarlo.

**Reusar para escalar.** El nonce no está pensado para impedir reúso —es
session token, se espera que la misma cookie sirva mientras no caduque— así
que "reusar" no aplica como ataque aquí; lo que sí probé es si reenviar la
MISMA cookie desde otra IP o para otro propósito da algo distinto de lo que
ya daba: no, `tokenMatches` no mira IP ni nada más que la firma y la edad. Es
el límite ya documentado en el propio código ("Es UN secreto para TODOS"), no
uno nuevo.

**Alargar la sesión.** Tomé una cookie válida, le cambié `emitidoEn` a una
fecha futura dejando el nonce y el HMAC intactos (`falsificado` en
`passcode.test.ts:98-108`, y lo repetí a mano fuera del arnés): rechazada,
porque la firma ya no corresponde a la nueva hora. No hay ningún endpoint que
renueve una sesión sin volver a pasar por `/acceso` con el passcode real —
`proxy.ts` y `guard.ts` solo verifican, nunca reemiten.

**Bajar al formato viejo.** `partes.length !== 4 || partes[0] !== VERSION`
rechaza cualquier cosa que no tenga la forma `2.x.x.x`; el token viejo (64 hex
sin puntos) da `partes.length === 1` y se rechaza en la primera línea.
Reconstruí el HMAC viejo (`HMAC("likida-access:" + passcode)`) con el secreto
de prueba correcto —exactamente lo que haría alguien con una cookie robada de
antes de la ronda 5— y `tokenMatches` lo rechazó igual (`passcode.test.ts:85-96`,
reproducido a mano).

**Comparación en tiempo constante.** `constTimeEq` (216-221) compara longitud
primero —eso es información pública (el token siempre mide lo mismo por
construcción del formato, así que no filtra nada nuevo) — y después recorre
byte a byte con XOR acumulado, sin cortocircuito. Es correcta.

**Lo único que no logré cerrar del todo, y lo dejo dicho:** `acceso/page.tsx:24`
lee `process.env.DASHBOARD_PASSCODE` directo, no a través de
`passcodeConfigurado()`. En producción esto no abre nada —`accessToken()`
sigue llamando `exigirPasscodeFuerte` antes de emitir cualquier cookie, así
que un passcode débil configurado por error sigue sin poder producir una
sesión—, pero si `DASHBOARD_PASSCODE` estuviera VACÍO en producción (variable
borrada por error), `expected` sería `''`, el `if (expected && ...)` de la
línea 28 nunca sería cierto y `/acceso` rechazaría siempre... mientras que
`hayPasscode()` (que si el passcode es `undefined`/`''` devuelve `false`
antes de tocar `exigirPasscodeFuerte`) dejaría **todo `/dashboard` abierto sin
passcode**, porque tanto `proxy.ts:38` como `guard.ts:33` tratan "sin
passcode configurado" como "modo desarrollo, no bloquear". No es un defecto
de esta ronda —el mismo `if (!hayPasscode()) return` existía en el diseño
anterior— y hay una alarma que lo cubre parcialmente:
`observability/arranque.ts:29,50` emite `logger.error('startup.config_silenciosa', …)`
en cada arranque desplegado si `DASHBOARD_PASSCODE` falta, con la consecuencia
escrita en el propio mensaje. No lo elevo a hallazgo de esta ronda porque no
cambió, pero como es exactamente la forma de "un camino de acceso sin
autenticar a datos de un tenant" que el rubro pide vigilar, lo dejo escrito
para que la próxima ronda confirme si `DASHBOARD_PASSCODE` sigue puesta en
Vercel.

---

## El identificador externo multi-tenant: `resolveOperador`, cerrado en dos capas

El ALTO de la ronda 5 era exactamente esto: `msg.from` (el teléfono, dato que
llega de fuera, dentro de un payload firmado por Meta pero cuyo VALOR nadie
controla salvo quien manda el WhatsApp) decide el `tenant_id` con el que se
escribe todo lo que sigue, y la consulta vieja (`conv.ts`, `.limit(1)` sin
`order by`) elegía una fila arbitraria si dos operadores activos compartían
número.

**Capa 1 — aplicación.** `conv.ts:59-98` ahora pide `.limit(2)` y, si vienen
dos filas, no seguir: registra `logger.error('operador.ambiguo', { telefono,
tenants, operadores })` (89-93) y lanza `OperadorAmbiguo`. Seguí el
`throw` hasta su único punto de captura: `processor.ts:803-839` lo distingue
de un fallo de red (`ConsultaFallida`) y de un fallo genérico, no escribe
NADA en `gasto`/`viaje`/`liquidacion` en ninguno de los tres casos, libera el
claim del mensaje para que Meta reintente, y le dice al operador la verdad
("tu número aparece dado de alta más de una vez... ya lo reporté") en vez de
"listo" o de una liquidación silenciosa en la flota equivocada. Es
exactamente el patrón "fail closed" que el rubro pide.

**Capa 2 — base de datos**, y esta es la que hace que la Capa 1 no dependa de
que nadie vuelva a tocar `conv.ts` sin saberlo:

- `supabase/migrations/0024_telefono_normalizado_unico.sql:120-122` crea un
  índice único **global** (no por tenant, a propósito: `resolveOperador` no
  puede filtrar por tenant, es lo que está averiguando) sobre
  `telefono_normalizado(telefono) where activo` — la misma normalización
  521→52 que ya usan `variantesTelefono` y `destinatarioWhatsApp`. Con este
  índice puesto, la fila que produjo el escenario del ALTO de la ronda 5 (dos
  operadores activos, mismo número, dos tenants) **no puede existir en la
  base**: el `INSERT`/`UPDATE` que la crearía falla antes de llegar a
  `resolveOperador`.
- `supabase/migrations/0028_fks_con_tenant.sql` añade FK compuestas
  `(columna, tenant_id) references (id, tenant_id)` para
  `gasto→viaje`, `liquidacion→viaje`, `codigo_pendiente→viaje` y
  `viaje→operador`. Aunque `resolveOperador` fallara o `guardar_liquidacion_tx`
  recibiera un `tenant_id` equivocado por otra vía, la base ahora rechaza
  físicamente que un gasto o una liquidación cuelguen de un viaje de OTRO
  tenant — cierra el mismo hueco por un camino que no pasa por `src/`.

Comprobé que ninguna de las dos migraciones toca `GRANT`, `REVOKE` ni las
policies de RLS (`command grep -in 'grant\|revoke\|policy'` sobre las siete
migraciones nuevas: solo aparece en comentarios, ninguna DDL). El aislamiento
por tenant que la ronda 5 verificó contra el catálogo de Postgres —RLS en las
14 tablas, `anon`/`authenticated` sin `EXECUTE` en las funciones con
service-role— no se tocó y no hay señal de regresión.

**Lo que esto NO cierra, y hay que decirlo con la misma honestidad que la
ronda 5:** sigue habiendo un solo passcode compartido para TODO el panel —no
hay identidad por usuario— y eso es una limitación de diseño documentada
(`passcode.ts:33-37`), no un hallazgo nuevo. Y las dos migraciones (0024,
0028) figuran en el MAPA como aplicadas en producción junto con 0022,
0025-0026 y 0029; no verifiqué el catálogo en vivo esta ronda para confirmar
que los índices y FK existen tal cual en la base real (sí lo hice para RLS y
GRANT en la ronda 5) — lo marco abajo en lo que no alcancé.

---

## Lo que revisé y está bien

**El token v2 no tiene downgrade, no se puede forjar sin el secreto, y la
sesión no se puede alargar ni reusar entre formatos.** Detallado arriba.

**Las dos capas del panel siguen siendo dos capas de verdad**, y verificado
en vivo con tres cookies distintas (ninguna, formato viejo, formato v2 con
firma inventada): las tres dan 307 a `/acceso`. `dashboard/page.tsx:57` y
`dashboard/[id]/page.tsx:35` llaman `exigirAcceso()` ANTES de cualquier
`await` a `supabaseAdmin` o `analytics.ts` — no hay fuga de datos antes del
gate en ninguna de las dos páginas.

**Ningún secreto tiene fallback silencioso**, y esto se endureció esta ronda:
`DASHBOARD_SECRET` lanza en producción (ya lo hacía); ahora además
`DASHBOARD_PASSCODE` débil lanza en producción (`exigirPasscodeFuerte`,
nuevo). `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`supabaseAdmin()` y el cliente de OpenRouter siguen lanzando sin fallback,
sin cambios.

**Ninguna de las siete migraciones nuevas (0022, 0024-0029) toca `GRANT`,
`REVOKE` o una policy de RLS.** Solo agregan funciones de validación
(inmutables, sin acceso a tablas), índices únicos y FK compuestas — todas
reducen superficie, ninguna la abre.

**El regex de teléfono del logger ya cubre el formato de 13 dígitos que Meta
entrega.** Lo reproduje: `'5219993700779'.replace(PHONE, '[TEL]')` →
`'[TEL]'`; `'+5219993700779'` → `'+[TEL]'` (el `+` suelto no es PII, los
dígitos sí se van). Cerraba el MEDIO de la ronda 5. Sigue sin verificarse el
caso del `wamid` en base64 (ver abajo, es el mismo pendiente que dejó la
ronda 5) porque exigiría un `wamid` real de producción.

**El HMAC del webhook de WhatsApp no se tocó y sigue firme**: cap de cuerpo
→ `req.text()` → recheck de longitud → `verifySignature` (timing-safe,
`meta/client.ts:33-40`) → recién ahí `JSON.parse`. Sin cambios desde la ronda
5, sin regresión.

**`npm audit`: de insumo, no de veredicto** — ver la sección de abajo.

---

## CVE descartados y por qué

`npm audit`: 20 vulnerabilidades (2 críticas, 15 altas, 3 moderadas) — subió
de 17 a 20 desde la ronda 5, y la explicación es aburrida: es la misma
familia de problemas, contada más fino.

- **`vitest` Y `@vitest/coverage-v8` (CRÍTICAS, misma GHSA-5xrq-8626-4rwp)** —
  antes solo `vitest` salía como crítica; ahora el paquete de cobertura, que
  depende de `vitest`, también se lista por separado. Es la MISMA
  vulnerabilidad (UI server de Vitest sirviendo archivos arbitrarios),
  contada dos veces por el árbol de dependencias. **Descartada** por la misma
  razón que la ronda 5: es `devDependency`, el proyecto solo corre
  `vitest run` (nunca `--ui`), y nada de vitest/coverage-v8 entra al bundle.
- **`next` aparece ahora como ALTA, y no aparecía en la ronda 5.** Es la
  novedad real de esta lista. Revisado en el JSON del audit: `"via":
  ["postcss", "sharp"]`, `"effects": []` — no es un CVE propio de Next.js
  (no es el bypass de middleware `CVE-2025-29927` ni ninguna otra advisory
  contra `next` en el reporte); es que el rango de versiones vulnerables de
  `postcss` y `sharp` se solapa con el rango que `next@16.2.4` declara como
  compatible, y `npm audit` propaga la vulnerabilidad de la dependencia hacia
  arriba. **Descartada** por las mismas razones que ya cubren `postcss` y
  `sharp` abajo: no es una vulnerabilidad nueva, es la misma reetiquetada.
- **`eslint`, `@eslint/*`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`,
  `eslint-plugin-react`, `minimatch`, `glob`, `brace-expansion`, `test-exclude`
  (altas)** — se reducen todas a `brace-expansion` (DoS por expansión sin
  cota, GHSA-mh99-v99m-4gvg) propagada por el árbol de ESLint/Vitest.
  **Descartadas**: ESLint no corre en producción ni procesa entrada de
  usuario; el atacante necesitaría controlar un patrón glob del repo mismo.
- **`vite`, `vite-node`, `esbuild`, `@vitest/mocker` (alta/moderadas)** —
  exigen un dev-server escuchando; el proyecto usa Turbopack para `next dev`
  y `vite` solo vive como dependencia de `vitest`. **Descartadas**, sin
  cambio respecto a la ronda 5.
- **`postcss` < 8.5.17 (alta)** — lectura arbitraria vía `sourceMappingURL`
  en tiempo de build, sobre CSS del propio repo. **Descartada**, sin cambio.

**La que sigue sin descartar del todo: `sharp` 0.34.5 (alta,
GHSA-f88m-g3jw-g9cj).** Sin cambio de versión desde la ronda 5
(`node_modules/sharp/package.json:4` sigue en 0.34.5;
`package.json` sigue fijando `^0.34.0`). Dependencia de producción, con
camino real: `cfdi.ts:249` corre `sharp(image).rotate().resize(...)` sobre
bytes que bajaron de WhatsApp — imagen que manda un tercero. El razonamiento
de la ronda 5 sigue aplicando sin cambios: los cargadores afectados son
GIF/TIFF/VIPS, y por el canal de WhatsApp un mensaje `type: 'image'` llega
transcodificado a JPEG/PNG por Meta; un TIFF o GIF viajaría como `document` y
esa rama no toca `sharp`. Sigue como observación vigilada, no como hallazgo.

---

## Lo que NO alcancé a revisar

- **Si `SENTRY_DSN` está puesto en Vercel hoy.** `observability/sentry.ts` y
  `arranque.ts` ahora HABLAN de esto en cada arranque desplegado
  (`startup.observabilidad`), pero eso solo lo ve quien mire el runtime log
  de Vercel; no tengo forma de leerlo desde aquí sin acceso al dashboard de
  Vercel. Sigue siendo el mismo pendiente de la ronda 5.
- **El catálogo de Postgres en vivo para 0024 y 0028.** Verifiqué RLS y GRANT
  contra producción en la ronda 5 y no encontré señal de que hayan cambiado
  (ninguna migración nueva los toca), pero no repetí la consulta al catálogo
  esta ronda para confirmar que los dos índices y las cuatro FK compuestas
  existen tal cual en la base real — el MAPA dice que están aplicadas; lo doy
  por bueno con esa fuente, no con una consulta propia.
- **El `wamid` en base64 con el teléfono codificado**
  (`processor.ts` línea ~703, `processInbound.fail`). Sigue siendo el mismo
  pendiente "no verificado" de la ronda 5: exigiría un `wamid` real de
  producción para confirmar si `redactarTexto` lo alcanza.
- **Intentar iniciar sesión real contra `/acceso` en producción.** El
  `.env.local` trae un `DASHBOARD_PASSCODE` que pasa `motivoPasscodeDebil`
  (28 caracteres, verificado con un script que solo imprimió el resultado
  booleano, nunca el valor), pero no hay garantía de que sea el mismo valor
  configurado en Vercel, y probarlo contra el sitio real arriesgaba: (a)
  gastar de los 10 intentos/5 min de un usuario legítimo si fallaba, y (b) si
  acertaba, quedar con una sesión real sobre datos de un tenant real sin que
  el encargo lo pidiera. Me limité a cookies inválidas por construcción
  (formato viejo, firma inventada), que ya prueban el rechazo sin ese riesgo.
- **Concurrencia real del rate-limit.** Mismo pendiente que la ronda 5: medir
  si `Map` en memoria por instancia aguanta bajo tráfico concurrente exige
  tráfico agresivo contra producción, prohibido en esta ronda.
