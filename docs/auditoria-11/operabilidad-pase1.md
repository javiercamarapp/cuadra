# Operabilidad y DX — auditoría 11

Ancla: rama `claude/auditoria-11`, árbol de `master` en `e4326f9` (4-ago-2026).
Compuerta medida hoy: `npx tsc --noEmit` exit 0 · `npm run lint` exit 0 ·
`npm run test:coverage` **exit ≠ 0** (ver el primer hallazgo).

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**, y
además **mirada más profunda**. El 5 de la ronda 10 se puso sobre el árbol del
PR #7 *con los arreglos dentro*; este árbol no los tiene, así que los dos
CRÍTICOS del login siguen aquí carácter por carácter. Encima aparecieron dos
cosas que la ronda 10 no vio: el **CI de `master` lleva rojo desde el 3-ago** y
nadie lo paró, y las 20 páginas nuevas de `/dashboard` traen **dieciséis copias
del mismo `catch` vacío** que se traga todos los errores de lectura del panel
del contralor —incluida la página del dinero— sin escribir una línea. Lo que
sostiene la nota y evita el 3 es que el camino del dinero (webhook → processor →
costos → export) sigue siendo el mejor instrumentado del repo, Sentry está
cableado y **verificado vivo** en producción, y `logger.ts` no se degradó.

**El riesgo mayor hoy:** el 6 de agosto el contralor abre `/dashboard/cuadre` y
lee *"No se pudo leer…"* o una tarjeta vacía. En el servidor no queda **nada**:
ni qué consulta falló, ni de qué tenant, ni si la base contestó. Y el CI que
tendría que haber avisado antes del despliegue lleva ~20 pushes en rojo, así que
un rojo nuevo es indistinguible del rojo de fondo.

## Hallazgos

### [CRÍTICO] El CI de `master` lleva rojo desde el 3-ago 17:32 y el paso de Build no ha corrido una sola vez desde entonces — sobre el código que Vercel despliega para el demo

`.github/workflows/ci.yml:67-68` (paso «Tests (con umbral de cobertura)») y
`vitest.config.ts:88-93` (el trinquete).

Verificado contra la API de GitHub, no inferido:

| Run | Commit | Fecha | Paso 7 (Tests) | Paso 8 (t. de tiempo) | Paso 9 (Build) |
|---|---|---|---|---|---|
| #271 | `e4326f9` (**HEAD de master**) | 4-ago 05:43:36Z | **failure** | skipped | **skipped** |
| #267 | `5fcfb38` | 4-ago 05:29Z | **failure** | skipped | **skipped** |
| —    | `5c092b59` | 3-ago 17:32Z | **failure** | skipped | **skipped** |

Reproducido aquí, `npm run test:coverage`, 186 s:

```
Test Files  172 passed (172)
     Tests  1668 passed | 3 skipped (1671)
Statements : 64.05% ( 6464/10092 )
Functions  : 78.8%  ( 342/434 )
ERROR: Coverage for lines (64.05%) does not meet global threshold (78%)
ERROR: Coverage for functions (78.8%) does not meet global threshold (83%)
ERROR: Coverage for statements (64.05%) does not meet global threshold (78%)
```

O sea: **ninguna prueba falla**; lo que falla es el trinquete de cobertura, que
`vitest.config.ts:81-84` dejó en la línea medida el 28-jul (79.69% de líneas) y
que los ~9,700 renglones nuevos de `master` hundieron a 64.05%. Como el trinquete
vive **dentro del mismo paso** que las pruebas, el paso entero sale en rojo y
GitHub **salta los dos siguientes**: las pruebas de tiempo (la guardia de ReDoS
del buscador de fundamentos y la de crecimiento no lineal del deduplicador de
CFDI, que el propio `ci.yml:70-76` explica que existen porque nadie más las
corre) y el **Build**, cuyo comentario en `ci.yml:79-80` dice que «ya cazó un
fallo real que solo aparecía aquí: Turbopack no resolvía el .wasm del lector de
códigos». Ese `.wasm` es el que lee el código de barras de los tickets del demo.

Dos agravantes concretos, los dos verificables:

1. **Nadie lo vio.** El mensaje del commit `5fcfb38` afirma literalmente
   «1,670 pruebas verdes · tsc, eslint y build limpios» — y el CI de ese mismo
   commit terminó en `failure` 100 segundos después. Se siguió pusheando 5 veces
   más ese día. Un semáforo que lleva 20 corridas en rojo ya no distingue nada:
   el día que se rompa una prueba de verdad, el color no va a cambiar.
2. **Vercel no lo consulta.** `CLAUDE.md:63` deja escrito que «Vercel redeploya
   PRODUCCIÓN en cada push a `master`». No hay `required status checks` que lo
   detenga (no existe archivo de protección de rama en el repo, y las corridas
   siguen siendo `push`, no `merge_group`).

Consecuencia: lo que se demuestra el 6-ago llegó a producción sin que el Build
—la única puerta que evalúa los módulos como los evalúa Next— se haya ejecutado
sobre él ni una vez desde que aterrizó el rediseño completo de `/dashboard`. Y
el ingeniero de guardia no tiene forma de saber si el rojo de esta mañana es el
de siempre o uno nuevo.

Causa raíz probable: el trinquete de cobertura y la suite comparten un solo paso
de CI, así que «una regresión» y «entró código sin prueba» producen exactamente
el mismo rojo — y el segundo, al ser tolerable, entrena a ignorar el primero.

### [CRÍTICO] Dieciséis copias del mismo `catch` vacío se tragan TODOS los errores de lectura de `/dashboard` —incluida la página del dinero— y ninguna escribe una línea

`src/app/dashboard/cuadre/page.tsx:42-44` (el peor), `src/app/dashboard/page.tsx:25-27`,
`src/app/dashboard/pod/page.tsx:15-17`, `src/app/dashboard/despacho/page.tsx:21-23`,
y otras doce idénticas: `incidencias:20`, `unidades:22`, `viajes:22`,
`analitica:15`, `documentos:17`, `operadores:10`, `facturacion:9`, `chat:10`,
`valor-ahorro:18`, `combustible-casetas:16`, `inicio-operacion.tsx:31`,
`api/dashboard/asistente/route.ts:56-58`.

Todas dicen exactamente esto:

```ts
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}
```

Escenario con valores, el más probable de los próximos dos días: la migración
**0047** (`unidad`, `mantenimiento`, `incidencia`, `pod`) está en el repo pero
`verificarMigracionesCriticas()` no la sonda —`grep -n "0047" src/lib/cuadra/startup.ts`
da **cero**— así que si no se corrió `supabase db push` contra producción nada lo
dice en el arranque. El contralor abre `/dashboard/pod` →
`getPods()` (`operacion.ts:322`) llama a `traerTodo(..., 'getPods.pod')` →
`exigir()` (`pg.ts:24`) lanza
`Error("getPods.pod: relation \"public.pod\" does not exist")` → el `safe()` de
`pod/page.tsx:16` lo atrapa y devuelve `null` → la pantalla dice *"No se pudo
leer el estado de las evidencias"* (`pod/page.tsx:94`). **Cero líneas escritas.**
Y como no salió excepción, `onRequestError` (`instrumentation.ts:56-86`) —la
única red del repo para las superficies web, cuyo propio comentario dice que
existe porque «el panel fallaba sin dejar una sola línea en el servidor»— **no
se dispara**. Mismo mecanismo exacto del `catch {}` de `/auth/callback` que la
ronda 10 marcó CRÍTICO, replicado ahora en dieciséis sitios.

El caso más caro es `cuadre`, la página del dinero. `getLiquidaciones` lanza a
propósito en `cuadre/page.tsx:31`
(`if (error) throw new Error(\`getLiquidaciones: ${error.message}\`)`) y el
comentario de arriba dice por qué: es el CRÍTICO de frontend de la auditoría 5,
los paneles que decían «12 viajes liquidados» con la base caída. Once líneas más
abajo, el `safe()` de :43 se come ese throw. La intención —fallar cerrado y
decirlo— sobrevive de cara al usuario (la pantalla no miente, dice que no pudo
leer) y muere de cara al operador del sistema.

Lo confirma un conteo: de todo `src/app/`, solo **seis** archivos importan
`@/lib/logger` (`api/webhook/whatsapp`, `api/export/liquidaciones`,
`api/export/pdf/[id]`, `login/page.tsx`, `global-error.tsx`,
`dashboard/error.tsx`). Ninguna de las 20 páginas de `/dashboard` ni de las ~30
de `/admin`.

Consecuencia: a la mañana siguiente de un incidente en el panel del cliente no
hay absolutamente nada que leer, ni siquiera un contador. Es el criterio literal
de «un fallo en producción es invisible», sobre la superficie que el comprador
mira.

Causa raíz probable: `safe()` se escribió una vez para «resiliencia por sección»
(el comentario de `dashboard/page.tsx:23-24`) y se copió a cada página nueva sin
pasar por el logger; nadie notó que atrapar también apaga `onRequestError`.

### [CRÍTICO · REINCIDENTE] `/auth/callback` sigue sin escribir una línea cuando el login falla, y su `catch` vacío sigue impidiendo que `onRequestError` lo vea

`src/app/auth/callback/route.ts:15-37` — el `if (!error)` de :19, el `catch {}`
de :31-35 y el `return NextResponse.redirect(new URL('/login?error=1', req.url))`
de :37. **Idéntico, línea por línea, al que la ronda 10 reportó**: los arreglos
viven en el PR #7 sin mergear.

Escenario con valores, sin repetir el de la ronda 10: el contralor entra con
*Continuar con Google*. Supabase devuelve a
`GET /auth/callback?code=abc123&next=%2Fdashboard`, pero el proyecto de Google
Cloud tiene el `redirect_uri` de la app anterior, así que GoTrue responde
`{ error: AuthApiError "Unable to exchange external code" }` → `if (!error)` no
entra → cae al `redirect('/login?error=1')` de :37 → la pantalla dice *"Algo
falló. Intenta otra vez."* (`login/page.tsx:176`). **Log del servidor: cero
líneas.** El ingeniero no puede distinguir eso de un `flow_state_expired` (link
de más de una hora), de un `code` que Supabase nunca emitió porque
`https://<dominio>/auth/callback` no está en la lista blanca del proyecto, o de
un 500 de GoTrue.

Y el `catch {}` de :31-35 agrava: su comentario dice que atrapa «fallo inesperado
del SDK o `supabaseServer()`» para que no salga un 500. Si falta
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `createServerClient` lanza `supabaseKey is
required`, este `catch` se lo come, el usuario vuelve a la pantalla de login y
`request.fail` **no se emite**.

Consecuencia: si el 6-ago el contralor no entra, no hay nada que leer para
decidir en dos minutos si se tira del plan B (`/demo`).

Causa raíz probable: la ruta optimizó «que nunca salga un 500 en la pantalla de
login» y lo resolvió con un fallback mudo, sin un `logger.error` donde se decide
el fallback.

### [CRÍTICO · REINCIDENTE] El login solo registra el caso benigno; el fallo caro del magic link sale sin log

`src/app/login/page.tsx:95-100` (email) y `src/app/login/page.tsx:64` (Google).

```ts
if (error) {
  if (!esCorreoSinCuenta(error)) redirect(`/login?next=...&error=1`);   // ← :96, sin log
  logger.warn('login.otp_sin_cuenta', { code: error.code, status: error.status }); // ← :99
}
```

La única llamada a `logger` del archivo (:99) cubre el caso **inocuo**: un correo
que no tiene cuenta. El caro —cuota de correo agotada, SMTP caído, `redirectTo`
rechazado, proyecto mal configurado— sale por el `redirect` de :96 sin tocar el
logger. Igual en Google, :64: `if (error || !data.url) redirect(...)`.

Escenario con valores, y ya documentado en este repo:
`docs/superpowers/plans/2026-08-02-roles-flota.md` deja constancia de que el
remitente es el sandbox de Resend (`onboarding@resend.dev`), que solo entrega a
`javiercamaraportepetit@gmail.com` y responde 403 a cualquier otra dirección. El
contralor teclea `contraloria@transportesinnovativos.mx` → Resend 403 → GoTrue
responde 500 `unexpected_failure` («Error sending magic link email») →
`esCorreoSinCuenta()` (:36-42) devuelve `false` porque el `code` no es
`otp_disabled` ni el mensaje trae «signups not allowed» → `redirect(…&error=1)`
de :96. **Cero líneas.** La pantalla dice *"Algo falló. Intenta otra vez."* y él
lo intenta otra vez, generando cero evidencia — con el agravante de que el
`rateLimit` de :21-25 (10 por IP cada 5 min) lo va a cortar al décimo intento con
**el mismo mensaje genérico**, también sin log.

Consecuencia: un fallo de login que el equipo ya sabe que existe es
indistinguible en los logs de un correo mal tecleado, en el minuto que decide si
el demo empieza.

Causa raíz probable: se instrumentó la rama que se estaba razonando (el oráculo
de enumeración) y no la que simplemente redirige; el `logger` quedó del lado
equivocado del `if`.

### [ALTO] `NEXT_PUBLIC_APP_URL` tiene cuatro valores distintos según dónde se lea, el script de despliegue la fija a la URL efímera del deploy, y nada verifica el valor — solo que exista

`scripts/deploy-vercel.sh:47-51`, `CLAUDE.md:64-66`, `DEPLOY.md:3,14,124`,
`src/app/login/page.tsx:11`, `src/lib/observability/arranque.ts:55`.

Los cuatro valores, leídos uno por uno:

| Dónde | Qué dice |
|---|---|
| `CLAUDE.md:64-66` | «`NEXT_PUBLIC_APP_URL` **debe ser** `https://app.likida.ai`» |
| `DEPLOY.md:3,14,124` | «Producción: **https://likidaai.vercel.app**» (y el webhook de Meta ahí) |
| `src/app/login/page.tsx:11` | fallback del código: `https://likida.ai` |
| `scripts/deploy-vercel.sh:47-51` | lo que imprima `vercel --prod --yes` |

El renglón del script es el que muerde:

```bash
url="$(vercel --prod --yes)"
...
printf '%s' "$url" | vercel env add NEXT_PUBLIC_APP_URL production >/dev/null
echo "  ✓ (redeploy para que tome el valor:  vercel --prod --yes)"
```

`vercel --prod` imprime en stdout la **URL de despliegue**, que es única por
deploy (`https://likidaai-<hash>-javiercamarapp.vercel.app`), no el alias
estable. Escenario con valores: se corre el script el 5-ago para levantar el
entorno de respaldo. `NEXT_PUBLIC_APP_URL` queda en
`https://likidaai-k3f9x2p-javiercamarapp.vercel.app`. El contralor teclea su
correo → `login/page.tsx:83` arma
`emailRedirectTo=https://likidaai-k3f9x2p-.../auth/callback?next=%2Fdashboard`
→ ese host **no está** en la lista de *Redirect URLs* del proyecto de Supabase
→ GoTrue ignora el `emailRedirectTo` y usa la *Site URL* del proyecto. El correo
llega, el link abre, y el navegador va a otro dominio: **Likida nunca recibe esa
petición**, así que no hay log que pueda existir. Y `arranque.ts:55` comprueba
`!process.env[v.nombre]` —presencia, no valor—, así que el arranque emite
`startup.config_silenciosa ok:true`, que es exactamente el semáforo que
`GUION_DEMO.md:29` manda mirar como paso 3 antes de entrar a la sala. El
semáforo va a estar en verde con el login roto.

Añado que la última línea del script (`echo "✓ (redeploy para que tome el
valor…)"`) es un **recordatorio impreso, no un paso**: `NEXT_PUBLIC_*` se
inyecta en el build, así que el despliegue que acaba de salir lleva el valor
viejo hasta que alguien lea ese `echo` y actúe.

Consecuencia: el folclore de `CLAUDE.md` («si no coincide con el Site URL de
Supabase, el usuario queda fuera de su propia cuenta») no lo verifica nadie: ni
una prueba, ni el arranque, ni el runbook, ni el script. `runbook.test.ts:95-110`
comprueba que `DEPLOY.md` *mencione* cuatro variables, y `NEXT_PUBLIC_APP_URL`
no es ninguna de las cuatro.

Causa raíz probable: la variable se añadió a la vigilancia de arranque cuando
apareció el login (commit `fd5f619`) como chequeo de presencia, que era el patrón
de las otras tres — pero esta es la única de la lista cuyo daño viene de un
**valor** equivocado, no de una ausencia.

### [ALTO] La suplantación de tenant del superadmin no deja rastro, y si la consulta falla cambia de flota en silencio — también en las ESCRITURAS

`src/lib/auth/tenant-efectivo.ts:67-73`, y las cuatro copias del mismo patrón
dentro de server actions: `dashboard/despacho/page.tsx:68`,
`dashboard/pod/page.tsx:52`, `dashboard/incidencias/page.tsx:53`,
`dashboard/unidades/page.tsx:53`. Más `api/dashboard/asistente/route.ts:40`.

```ts
if (sesionReal.rol === 'superadmin' && sp?.tenant) {
  const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', sp.tenant).maybeSingle();
  if (t) { tenantId = t.id as string; tenantNombre = t.nombre as string; }
}
```

Dos cosas, las dos verificadas:

1. **No queda registro de la suplantación.** `tenant-efectivo.ts` no importa
   `@/lib/logger` en ninguna línea. Un superadmin que entra a
   `/dashboard/cuadre?tenant=<uuid de Transportes Innovativos>` ve la cobranza,
   los acreditables y las anomalías de una flota real y **no se escribe nada**:
   ni quién, ni a qué flota, ni cuándo. Cuando llegue el primer cliente de pago,
   esa es la pregunta que un contralor hace («¿quién de ustedes entró a mis
   números?») y hoy no tiene respuesta.
2. **El fallo de la consulta se lee como "el tenant no existe".** `data` se
   desestructura y `error` se descarta — la familia de bugs que `pg.ts:10-20`
   llama «la más repetida del repo». Escenario con valores: bache de 800 ms
   contra Supabase mientras el superadmin navega con
   `?tenant=22222222-2222-2222-2222-222222222222`. PostgREST devuelve
   `{ data: null, error: { message: 'fetch failed' } }` → `if (t)` no entra →
   `tenantId` se queda en el que puso `requireSessionTenant`, que para un
   superadmin sin `tenant_id` es **el tenant DEMO** (`guard.ts:25,33`) → y
   `tenantNombre` se queda en `null`, así que el badge *"viendo como superadmin ·
   <flota>"* (`dashboard/page.tsx:130-132`) **no se pinta**. Resultado: la URL
   dice una flota, la pantalla enseña los números de otra, y no hay ninguna
   marca visual ni ninguna línea de log que lo delate.

Lo grave es que las cuatro copias de este patrón están **dentro de server
actions que escriben**: en `despacho/page.tsx:64-72` el mismo `if (data)` decide
el `tenant_id` con el que `crearViaje()` y `asignarUnidad()` van a insertar. Con
el mismo bache, un viaje que el superadmin creía estar dando de alta en
Innovativos aterriza en el tenant demo — `crearViaje` devuelve un id, la acción
redirige a `?ok=creado` y la píldora verde dice *"Viaje creado"*
(`despacho/page.tsx:136`). Cero líneas.

Consecuencia: la única función de suplantación del producto no es auditable, y
su modo de fallo es escribir en la flota equivocada anunciando éxito.

Causa raíz probable: el patrón se escribió una vez en `tenant-efectivo.ts` y se
copió a cada action que necesitaba respetar `?tenant=`, arrastrando el
`{ data }` sin `error` y sin logger las cinco veces.

### [ALTO · REINCIDENTE] `getSessionTenant` sigue tirando el `error` de `auth.getUser()` — el fallo transitorio más probable, y el reintento no lo cubre

`src/lib/auth/session.ts:31`.

```ts
const { data: { user } } = await sb.auth.getUser();
if (!user) return null;
```

La línea se movió de :29 a :31 (el `select` de :33 creció con `operador_id,
avatar_url`), pero el defecto es el mismo: se desestructura `data` y se descarta
`error`. Importa porque `auth-js` **no lanza** en el caso frecuente:
`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` atrapa cualquier
`isAuthError(error)` en `_getUser` y hace `return { data: { user: null }, error }`.
`AuthRetryableFetchError` —lo que produce un `fetch failed`, un timeout o un 5xx
del endpoint de auth— **es** un `AuthError`.

Escenario con valores: bache de 800 ms mientras el contralor navega de
`/dashboard` a `/dashboard/cuadre`. `getUser()` devuelve
`{ user: null, error: AuthRetryableFetchError }` → `if (!user) return null` en
:32 → `requireSessionTenant` (`guard.ts:31`) hace `redirect('/login?next=…')`. El
`for` de :28 **no reintenta** (no se lanzó nada), `session.reintento` no se
emite, `session.excepcion` no se emite, y `session.app_user_error` tampoco porque
la consulta a `app_user` nunca corrió. Total escrito: **cero líneas**, y el
resultado es idéntico byte por byte a «este usuario nunca inició sesión». El
comentario de :18-25 promete exactamente lo contrario.

Consecuencia: el contralor es expulsado a `/login` a media demo por un bache que
no tiene que ver con él, y no queda rastro — el escenario exacto que el reintento
se añadió a evitar.

Causa raíz probable: el `try/catch` se construyó sobre la premisa de que el SDK
señala lanzando; `auth-js` lo señala por valor de retorno en la mitad de los
casos.

### [ALTO · REINCIDENTE] `src/proxy.ts` corre en el 100% del tráfico autenticado y no tiene una sola llamada al logger

`src/proxy.ts:59` (`const { data: { user } } = await supabase.auth.getUser();`) y
el archivo entero: no importa `@/lib/logger` en ninguna línea. (Era :63 en la
ronda 10; el gate se reescribió alrededor pero el hueco no se tocó.)

Escenario con valores: rotación de la anon key, o 30 s de caída del endpoint de
auth. Para cada `GET /dashboard`, `GET /admin` y `GET /mis-viajes`, `getUser()`
devuelve `{ user: null, error }` (mismo mecanismo del hallazgo anterior), el
`if (!user)` de :60 entra, y la petición se responde con un `307` a
`/login?next=/dashboard`. **Cero líneas**, ningún contador, nada que distinga
«nadie ha iniciado sesión» de «el gate rebotó las 40 peticiones del último
minuto». Como no se lanza, `onRequestError` tampoco se dispara.

Agrava un detalle que sigue vigente: el middleware corre en el runtime **edge**,
y `register()` (`instrumentation.ts:11`) retorna de inmediato si
`NEXT_RUNTIME !== 'nodejs'`. Ninguno de los avisos de arranque
(`startup.observabilidad`, `startup.config_silenciosa`, `startup.entorno_grupos`)
existe en el proceso donde vive el gate.

Consecuencia: la única capa por la que pasa todo el tráfico autenticado es la
única sin instrumentar. Si el 6-ago «el panel no abre», el primer sitio donde
mirar es el que no dejó huella.

Causa raíz probable: `proxy.ts` viene del ejemplo oficial de `@supabase/ssr`, que
no incluye logging, y nadie lo cableó al aterrizarlo.

### [ALTO] `/admin/mi-perfil` afirma "guardado" con el `error` del update descartado, y la subida de avatar falla sin dejar una línea

`src/app/admin/mi-perfil/page.tsx:38`, `:51` y `:56`.

Tres fallos distintos en la misma pantalla, la primera del repo que sube un
archivo del usuario:

```ts
await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);   // :38 — sin error, sin log
redirect('/admin/mi-perfil?ok=nombre');                                        // :39 — "Nombre guardado."
...
if (error) redirect('/admin/mi-perfil?error=avatar');                          // :51 — sin log
...
await admin2.from('app_user').update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', userId); // :56 — sin error, sin log
redirect('/admin/mi-perfil?ok=avatar');                                        // :57 — "Foto de perfil actualizada."
```

Escenario con valores: la migración **0046** no se aplicó en producción
—`startup.ts` tampoco la sonda—, así que la columna `app_user.avatar_url` no
existe. Javier elige una foto; `avatar-uploader.tsx:27` envía el form solo;
`storage.from('avatares').upload(...)` de :50 sí funciona (el bucket lo crea la
propia 0046… que tampoco corrió, así que aquí falla y entra el :51). Camino A:
el `upload` devuelve `{ error: 'Bucket not found' }` → `redirect(?error=avatar)`
→ la pantalla dice *"No se pudo subir la foto — intenta con otra imagen."*
(:77), que le manda a probar otra foto cuando el problema es el esquema.
**Cero líneas.** Camino B (bucket sí, columna no): el upload pasa, el `update` de
:56 devuelve `{ error: 'column app_user.avatar_url does not exist' }`, se
descarta, la pantalla dice **"Foto de perfil actualizada."** (:71), y en la
siguiente carga vuelve el círculo con la inicial. Sin log, el síntoma que se
reporta es «se borra sola», que no lleva a ningún lado.

Ninguno de los tres llega a `onRequestError`: `redirect()` de Next lanza
`NEXT_REDIRECT`, que Next filtra, y los dos `update` no lanzan nada.

Consecuencia: es una pantalla de perfil, no dinero — por eso ALTO y no CRÍTICO —
pero es el patrón exacto que el rubro nombra: «un error que se traga y devuelve
200», estrenado en el primer camino de subida de archivo del producto.

Causa raíz probable: la Server Action se escribió sobre el patrón de
`usuarios/nuevo/page.tsx` (permiso + `supabaseAdmin()` + `redirect`), que tampoco
comprueba el `error` del write.

### [MEDIO · REINCIDENTE, ampliado] `verificarMigracionesCriticas` no sonda 0044/0045/0046/0047 — y la 0047 trae las cuatro tablas de las cuatro páginas nuevas

`src/lib/cuadra/startup.ts:65-230`.
`grep -n "0044\|0045\|0046\|0047" src/lib/cuadra/startup.ts` → **cero**.

El probe cubre 0005, 0011, 0016, 0017, 0019, 0022, 0024, 0030, 0031, 0033 y
0036/0037/0042/0043 — todo el camino del dinero, y el cierre del CRÍTICO de la
ronda 9 (`:161-176`, la sonda de `triggers_faltantes`) **ancló de verdad**. Lo
que quedó fuera creció: la 0047 crea `unidad`, `mantenimiento`, `incidencia` y
`pod`, que son la base de `/dashboard/despacho`, `/dashboard/unidades`,
`/dashboard/incidencias` y `/dashboard/pod`, y de todo `operacion.ts`. Sin ella
el arranque dice `startup.migraciones {"ok":true}` y las cuatro páginas se
rinden en silencio por el `safe()` del segundo hallazgo. La 0046 lo mismo para
`/admin/mi-perfil`.

Sigue abierto lo que la ronda 9 anotó: `supabase/verificaciones.sql` —que sí
valida triggers y RLS contra Postgres real— no lo invoca `.github/workflows/ci.yml`,
ni `scripts/*.sh`, ni `package.json`, ni `DEPLOY.md`. Es SQL que un humano corrió
una vez.

Causa raíz probable: el probe crece cuando una auditoría lo señala, no cuando se
añade una migración; nada liga `supabase/migrations/*.sql` con `startup.ts`.

### [MEDIO · REINCIDENTE] La vigilancia de arranque grita una consecuencia falsa por una variable muerta — y ahora hay una PRUEBA que la fija

`src/lib/observability/arranque.ts:33` (y el encabezado que la repite, :13-14),
`.env.example:46-48`, `DEPLOY.md:99`, y **`src/lib/observability/runbook.test.ts:100`**.

`SILENCIOSAS` sigue conteniendo
`{ nombre: 'DASHBOARD_PASSCODE', consecuencia: 'proxy.ts no bloquea /dashboard' }`.
Leí `src/proxy.ts` entero: no menciona `DASHBOARD_PASSCODE` en ninguna línea; el
gate de :44-73 es la sesión de Supabase. `.env.example:46-47` va más lejos y cita
un renglón que ya no existe («`proxy.ts:22` NO bloquea /dashboard»), y
`DEPLOY.md:99` lo repite en la tabla de «las cuatro que hay que revisar a mano».

Lo nuevo respecto de la ronda 10: `runbook.test.ts:100` **exige por prueba** que
`DEPLOY.md` mencione `DASHBOARD_PASSCODE`. O sea que la afirmación falsa ya no
es solo documentación atrasada: está anclada por la compuerta. Quien intente
limpiarla pone el CI en rojo (más rojo).

Dos efectos concretos, los dos malos: si alguien **quita** la variable (lo
correcto, porque ya no gatea nada), cada arranque en frío emite
`{"level":"error","msg":"startup.config_silenciosa","meta":{"ok":false,"faltan":["DASHBOARD_PASSCODE: proxy.ts no bloquea /dashboard"]}}`
—un `error` que va a Sentry (`logger.ts:148`) en el **mismo cubo de `msg`** que el
aviso real de `DEMO_TENANT_ID`/`NEXT_PUBLIC_APP_URL`, que es justo lo que
`arranque.ts:70-74` explica que hace perder un aviso—; y si nadie la quita, hay
que mantener viva una variable que ningún gate lee solo para que el semáforo de
`GUION_DEMO.md:29` pase.

`src/lib/cuadra/startup.ts:34-46` documenta este anti-patrón con nombre y fecha
(«cuando el aviso resulta ser mentira una vez, se aprende a ignorarlo»); la
lección no cruzó al directorio de al lado.

### [MEDIO] `/api/dashboard/asistente` responde **200** con `kpis: null` cuando la base no contesta, y el rail pinta el asistente como si estuviera vivo

`src/app/api/dashboard/asistente/route.ts:56-58` y `:67-73`.

La ruta distingue bien 401 y 403 (:28, :32), pero para el fallo de datos usa el
mismo `safe()` con `catch` vacío y devuelve:

```json
{"nombre":"Javier","tenantNombre":null,"kpis":null,"acred":null,"anomalias":null}
```

con status **200**. Escenario con valores: `SUPABASE_SERVICE_ROLE_KEY` rotada.
`getKpis(tenantId)` lanza dentro de `exigir()`, `safe()` lo atrapa,
`rail.tsx:107` recibe el JSON y saluda *"Hola Javier. Pregúntame lo que quieras
de tu operación."* sobre datos que no existen. El cliente HTTP no tiene forma de
saber que la respuesta es un error: el status dice que todo salió bien.

Consecuencia: es la ruta que alimenta el asistente que está fijo en todas las
páginas del panel. Un 200 con nulos no es diagnosticable ni desde el navegador
ni desde el log.

Causa raíz probable: `safe()` se copió desde las páginas —donde el `null` sí lo
traduce la vista a un estado vacío honesto— a una ruta de API, donde el contrato
lo lleva el status y no el cuerpo.

### [MEDIO · REINCIDENTE] Una máquina limpia no queda corriendo: el `setup` no está documentado, `seed.sql` no crea ningún `app_user`, y el README describe otro producto

`README.md:70-77`, `package.json:13` (`"setup": "npm install && npm run seed"`),
`scripts/seed.sh` (completo), `supabase/seed.sql` (`grep -n "app_user"` → cero
resultados), `src/app/login/page.tsx:87` (`shouldCreateUser: false`),
`src/app/admin/usuarios/nuevo/page.tsx` (empieza con `requireSuperadmin()`).

Lo que dice el README para levantar el proyecto es
`npm install && cp .env.example .env.local && npm run dev` — **no menciona las
migraciones ni el seed en ninguna línea**, y tampoco menciona el script `setup`
que sí existe en `package.json` (y que requiere un `DATABASE_URL` que el README
tampoco nombra). Encima el archivo sigue titulándose «Cuadra», describe un
«portal del cliente» que no existe como superficie separada, y su tabla de
módulos no incluye `auth/`, que es la ruta crítica de hoy.

Y aunque se corra el seed, el panel sigue inaccesible: no hay una sola fila de
`app_user` en `seed.sql`, `signInWithOtp` va con `shouldCreateUser:false`, y el
único camino de alta —`/admin/usuarios/nuevo`— exige ya ser superadmin. Lo único
que queda escrito cuando esto pasa es `login.otp_sin_cuenta`
(`login/page.tsx:99`), un `warn` con `code` y `status`: suficiente **si alguien
sabe que ese log existe**, y ningún runbook lo dice mientras la pantalla afirma
*"Te mandamos un link a tu correo"*.

Consecuencia: si la laptop del demo falla el 5-ago, no hay procedimiento escrito
para recuperar el acceso al panel, y `/demo` no lo sustituye (es el simulador, no
el panel del contralor).

### [BAJO] `DEPLOY.md` nombra un mensaje de arranque que ya no es el que importa y omite los dos que el guion del demo usa como semáforo

`DEPLOY.md:34-39`.

La lista de «mensajes de arranque» que hay que mirar dice
`startup.observabilidad`, `startup.migraciones` y `startup.entorno`. El tercero
existe (`src/lib/cuadra/startup.ts:24`) pero cubre solo `DASHBOARD_SECRET`; los
que hoy deciden si el panel contesta bien —`startup.config_silenciosa`
(`arranque.ts:57,59`) y `startup.entorno_grupos` (`arranque.ts:85,88`, el que
cubre `NEXT_PUBLIC_SUPABASE_ANON_KEY`)— **no aparecen en el runbook**, aunque
`GUION_DEMO.md:29` mande verificar el primero como paso 3 antes de entrar a la
sala. Quien siga el runbook a las 3 a.m. va a buscar un `msg` que casi nunca sale
y a no buscar los dos que sí.

## Lo que revisé y está bien

- **El camino del dinero sigue instrumentado y con identificador, que es lo que
  salva la nota.** `processor.ts:1443-1470`: el `catch` general emite
  `processInbound.fail` / `.consulta_fallida` / `.operador_ambiguo` con
  `id` (wamid), `de`, `tenant`, `viaje` y `cerroSinEntregar` — el contexto vive
  **fuera** del `try` a propósito (`:242-249`) para que no se pierda. Y
  `route.ts:106-118` cierra el circuito de los acuses con
  `wa.no_entregado {id, para, codigo, err, detalle}`.
- **Los exports llevan el identificador exacto.**
  `api/export/pdf/[id]/route.ts:49` emite `export.pdf.lectura` con
  `{ tenant, liquidacion: id }`; `api/export/liquidaciones/route.ts:37` lleva
  `tenant`. Es la única parte del repo que responde bien a «¿cuál liquidación
  falló?».
- **Sentry está cableado y verificado vivo, no solo instalado.**
  `docs/HANDOFF.md:354-357` deja constancia del log real
  `{"msg":"startup.observabilidad","sentry":true,"entorno":"production"}` y de
  una prueba de punta a punta (issue LIKIDAAI-1). `sentry.ts:69-75` grita en
  `error` si falta el DSN; `flushObservabilidad()` sí se llama desde el `after()`
  del webhook (`route.ts:91`).
- **`logger.ts` no cambió su contrato**: huella estable de UUID (`huellaId`,
  :82-90), borrado de RFC/teléfono, `digest` exento (`CLAVES_NO_PII`, :122), una
  sola pasada de redacción, y `warn`/`error` a Sentry por un único camino ya
  redactado (:148-150).
- **`instrumentation.ts` sigue cableado** (`register` + `onRequestError` con
  `digest`, `ruta`, `metodo`, y `flushObservabilidad()` esperado, :56-86). El
  problema no es él: son los dieciséis `catch` que le quitan el trabajo.
- **`dashboard/error.tsx:40-48` sí instrumenta el error boundary del panel** —
  con import perezoso y con `digest`. Es el único archivo de `/dashboard` que
  toca el logger, y está bien hecho.
- **`acotada()` (`presupuesto.ts:148-169`) sí impone techo y lo grita**
  (`supabase.tope_agotado {consulta, topeMs}`), y `operacion.ts` la usa en las
  cinco escrituras nuevas (`:376, 391, 471, 490, 497, 512, 536, 563`).
- **`pg.ts` es la extracción correcta**: `exigir()` traduce el error por valor a
  excepción (:23-26) y `traerTodo()` pagina con tope de 100 páginas (:40-52), así
  que `operacion.ts` no reimplementó los dos bordes de PostgREST.
- **`/admin/observabilidad` sigue siendo honesto**: enlaza Sentry y Vercel en vez
  de simular dashboards, y su comentario (`page.tsx:29-32`) dice tal cual que
  latencia p50/p95 y trazas «NO se instrumenta hoy».
- **La migración 0046 crea su propio bucket** (`0046_perfil_avatar.sql:17-19`),
  así que el avatar no depende de que alguien lo cree a mano — a diferencia del
  bucket `liquidaciones`, que sí vive en `scripts/seed.sh`.
- **CI corre en cada push y en todas las ramas** (`ci.yml:21-24`), con
  `concurrency` que cancela lo que quedó atrás (:28-30) y sin necesidad de
  secretos. La forma del workflow es correcta; el problema es que lleva rojo
  desde el 3-ago y nadie lo miró.
- **`npx tsc --noEmit` exit 0 y `npm run lint` exit 0** sobre este árbol, hoy.

## Lo que NO alcancé a revisar

- **Desde cuándo exactamente lleva rojo el CI.** Muestreé tres corridas de
  `master` (4-ago 05:43, 4-ago 05:29 y 3-ago 17:32) y las tres son `failure` con
  Build saltado. No bisecté hacia atrás del 3-ago 17:32, así que el rojo puede
  ser más viejo; lo que sí está medido es que la causa (cobertura 64.05% contra
  un trinquete de 78) es una propiedad del árbol, no un intermitente, así que
  **toda** corrida sobre este árbol falla.
- **La configuración del proyecto de Supabase** (Site URL, lista de Redirect
  URLs, proveedor de Google, remitente SMTP real vs. el sandbox de Resend). Ahí
  vive la mitad del riesgo del hallazgo de `NEXT_PUBLIC_APP_URL` y no es visible
  desde el repo.
- **Qué valor tiene hoy `NEXT_PUBLIC_APP_URL` en Vercel.** Los cuatro documentos
  que la nombran se contradicen; cuál ganó no se puede saber desde aquí.
- **Las ~30 páginas de `/admin` una por una.** Verifiqué el patrón de errores en
  `negocio.ts` (que sí falla lanzando) y leí `mi-perfil` y `observabilidad`
  completas; no audité cada `page.tsx` de `/admin` buscando `catch` mudos ni
  Server Actions que descarten el `error` del write, como hace `mi-perfil`.
- **`operacion.ts` en el caso de "0 filas afectadas".** Los cuatro `update` con
  `.eq('id', …).eq('tenant_id', …)` (`:391, 490, 497, 563`) devuelven
  `{ error: null }` cuando no empatan ninguna fila, así que un id de otro tenant
  produce un no-op que se anuncia como éxito. No lo reporto como hallazgo porque
  no logré construir el escenario con valores sin entrar en terreno de
  seguridad/backend, pero **no lo des por cerrado**.
- **Los dos hallazgos de la ronda 9 sobre `foto_pendiente`** (pérdida silenciosa
  de comprobante y colisión del `msg` `foto.pendiente_error`) tampoco los
  reverifiqué esta ronda. No los des por cerrados.
