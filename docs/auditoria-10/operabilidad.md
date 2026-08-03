# Operabilidad y DX — auditoría 10

Ancla: rama `claude/auditoria-10`, merge `6d4ea7a` (3-ago-2026).

**Nota: 5/10** (antes 7). Razón del movimiento: **deuda que cobró factura**. El
camino del dinero (webhook → processor → costos → export) sigue siendo el mejor
instrumentado del repo y no encontré regresión ahí. Lo que cambió es que el
bloque de autenticación (≈30 commits) metió una **nueva ruta crítica delante de
todo** —si el contralor no entra, no hay demo— y esa ruta aterrizó **sin una
sola línea de log en tres de sus cuatro saltos**. La ronda 9 había subido a 7
cerrando el probe de migraciones; ese cierre ancló de verdad (ver abajo), pero
la superficie nueva volvió a abrir el hueco en otro sitio.

**El riesgo mayor hoy:** el 6 de agosto el contralor teclea su correo, ve *"Algo
falló. Intenta otra vez."* o *"Te mandamos un link"* que nunca llega, y el
servidor no escribe **nada**. No hay forma de saber si fue el SMTP, el code
verifier, el dominio del redirect o Supabase caído. La pregunta que ordena el
rubro —¿qué tengo a la mañana siguiente?— para el login se responde hoy con
"nada".

## Hallazgos

### [CRÍTICO] `/auth/callback` no escribe una sola línea cuando el login falla — y su `catch` vacío impide además que `onRequestError` lo vea

`src/app/auth/callback/route.ts:15-37` (el `if (!error)` de :19, el `catch {}` de
:31-35 y el `redirect` de :37).

Escenario, con valores: el contralor pide el magic link desde el Chrome de la
laptop y abre el correo en el teléfono —exactamente lo que la propia pantalla de
login advierte que no haga (`src/app/login/page.tsx:133`, «Ábrelo desde este
mismo dispositivo»), porque el `code_verifier` del PKCE vive en la cookie del
navegador que pidió el link. Entra `GET /auth/callback?code=abc123` →
`exchangeCodeForSession` devuelve
`{ error: AuthApiError "invalid request: both auth code and code verifier should be non-empty" }`
→ el `if (!error)` no entra → se cae al `return NextResponse.redirect('/login?error=1')`
de :37. **Lo que queda escrito en el log del servidor: cero líneas.** Ni el
`code`, ni el mensaje de Supabase, ni la ruta, ni la hora. Y no es un caso: por
esa misma salida sin log pasan un `flow_state_expired` (link de más de una hora),
un 500 de GoTrue, y un `code` que Supabase nunca emitió porque la URL de callback
no está en la lista blanca del proyecto.

Peor todavía el `catch {}` de :31-35: su comentario dice explícitamente que
atrapa «fallo inesperado del SDK o `supabaseServer()`» para que no se vuelva un
500 — pero al atraparlo y no relanzar, **desactiva la única red que el repo tiene
para las superficies web**: `onRequestError` (`src/instrumentation.ts:56-86`),
cuyo propio comentario dice que existe porque «hasta la auditoría 5 el panel
fallaba sin dejar una sola línea en el servidor». Si falta
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `createServerClient` lanza `supabaseKey is
required`, este `catch` se lo come, el usuario ve la pantalla de login otra vez
y `request.fail` **no se emite**.

Consecuencia: el 6-ago, el contralor no entra y el ingeniero de guardia no tiene
absolutamente nada que leer. Es el criterio literal de "un fallo en producción es
invisible", sobre el camino que decide si el demo empieza.

Causa raíz probable: la ruta se escribió optimizando "que nunca salga un 500 en
la pantalla de login" y se resolvió con un fallback mudo, sin un `logger.error`
en el mismo sitio donde se decide el fallback.

### [CRÍTICO] El login solo registra el caso benigno; los fallos reales de envío del magic link salen sin log — y el SMTP de hoy es un sandbox que ya se sabe que rebota

`src/app/login/page.tsx:94-99` (email) y `src/app/login/page.tsx:63` (Google).

```ts
if (error) {
  if (!esCorreoSinCuenta(error)) redirect(`/login?next=...&error=1`);   // ← sin log
  logger.warn('login.otp_sin_cuenta', { code: error.code, status: error.status });
}
```

La única llamada a `logger` de todo el archivo (:98) cubre el caso **inocuo**
(correo que no tiene cuenta). El caso caro —cuota de correo, SMTP caído,
`redirectTo` rechazado, proyecto mal configurado— cae en el `redirect` de :95 sin
tocar el logger. Idéntico en el camino de Google, :63:
`if (error || !data.url) redirect(...)`.

Escenario, con valores y **ya documentado en este repo**:
`docs/superpowers/plans/2026-08-02-roles-flota.md:96-103` deja constancia de que
el remitente es el sandbox de Resend (`onboarding@resend.dev`), que **solo
entrega a `javiercamaraportepetit@gmail.com` y responde 403 a cualquier otra
dirección**, y que por eso «no se pudo completar el login real vía magic link».
Ese 403 llega a GoTrue, que responde 500 `unexpected_failure` («Error sending
magic link email»); `esCorreoSinCuenta()` (:35-41) devuelve `false` porque el
`code` no es `otp_disabled` ni el mensaje trae «signups not allowed`, así que el
flujo va al `redirect(...&error=1)` de :95. **Lo escrito en el log: cero
líneas.** La pantalla dice «Algo falló. Intenta otra vez.» (:176) y el contralor
lo intenta otra vez, y otra vez, generando cero evidencia. En la variante en que
el proveedor acepta el correo pero no lo entrega, no hay ni siquiera `error`: la
pantalla dice «Te mandamos un link» (:133) y tampoco hay log.

Consecuencia: el fallo de login que el equipo **ya sabe que existe** (marcado
PENDIENTE en el plan del 2-ago, nunca verificado con un login real) es
indistinguible en los logs de un correo tecleado mal. En la sala, el 6-ago, no
hay manera de decidir en dos minutos si conviene tirar del plan B.

Causa raíz probable: se instrumentó la rama que se estaba razonando (el oráculo
de enumeración) y no la rama que simplemente redirige; el `logger` quedó del lado
equivocado del `if`.

### [ALTO] `getSessionTenant` tapó el error de `app_user` pero sigue tirando el de `auth.getUser()` — que es el fallo transitorio más probable, y el reintento no lo cubre

`src/lib/auth/session.ts:29`.

```ts
const { data: { user } } = await sb.auth.getUser();
if (!user) return null;
```

El commit `8394781` sí cerró lo que dice cerrar: el error del `select` a
`app_user` (línea 31) hoy se registra como `session.app_user_error` (:38). Pero
la llamada de **la línea de arriba** desestructura `data` y descarta `error`, y
eso importa porque `auth-js` **no lanza** en el caso frecuente: en
`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2642-2679`, `_getUser`
atrapa cualquier `isAuthError(error)` y hace
`return { data: { user: null }, error }`. `AuthRetryableFetchError`
(`.../lib/errors.js:238`) —que es lo que produce un `fetch failed`, un timeout o
un 5xx del endpoint de auth— **es** un `AuthError`. Resultado: no hay excepción.

Escenario con valores: bache de red de 800 ms contra Supabase Auth mientras el
contralor navega de `/dashboard` a `/dashboard/<id>`. `getUser()` devuelve
`{ user: null, error: AuthRetryableFetchError }` → `if (!user) return null` en :30
→ `requireSessionTenant` (`guard.ts:31`) hace `redirect('/login?next=...')`. El
`for` de :26 **no reintenta** (no se lanzó nada), `session.reintento` no se emite,
`session.excepcion` no se emite, `session.app_user_error` no se emite porque la
consulta a `app_user` nunca se ejecutó. Total escrito: **cero líneas**, y el
resultado es idéntico, byte por byte, a "este usuario nunca inició sesión". El
comentario de :20-23 promete justo lo contrario («un `fetch failed` transitorio
aquí no es "no hay sesión"»).

Verificado que la suite no lo cubre: `src/lib/auth/session.test.ts` prueba «si
Supabase truena las DOS veces» y «si truena una vez pero se recupera» con mocks
que **lanzan** — corrí `npx vitest run src/lib/auth` y las dos líneas que
aparecen en stderr son `session.reintento`/`session.excepcion`. No hay ninguna
prueba con `getUser` devolviendo `{ user: null, error }`.

Consecuencia: el contralor es expulsado a `/login` a media demo por un bache que
no tiene nada que ver con él, y a la mañana siguiente no hay rastro de que haya
ocurrido — que es el escenario exacto que el reintento se añadió a evitar.

Causa raíz probable: se asumió que el SDK señala los fallos lanzando, y el
`try/catch` se construyó sobre esa premisa; `auth-js` los señala por valor de
retorno en la mitad de los casos.

### [ALTO] `src/proxy.ts` es la primera capa del gate, corre en el 100% del tráfico del panel, y no tiene una sola llamada al logger

`src/proxy.ts:63` (`const { data: { user } } = await supabase.auth.getUser();`) y
el archivo entero: no importa `@/lib/logger` en ninguna línea.

Escenario con valores: rotación de la anon key, o una caída de 30 s del endpoint
de auth de Supabase. Para cada `GET /dashboard`, `GET /admin` y `GET
/mis-viajes`, `getUser()` devuelve `{ user: null, error }` (mismo mecanismo del
hallazgo anterior; ver `GoTrueClient.js:2669-2676`), el `if (!user)` de :64 entra,
y la petición se responde con un `307` a `/login?next=/dashboard`. **Lo que se
escribe: cero líneas.** No hay contador, no hay `warn`, no hay nada que distinga
"nadie ha iniciado sesión" de "el gate rebotó las 40 peticiones del último
minuto". Y como no se lanza, `onRequestError` tampoco se dispara.

Añado un detalle que agrava: el middleware corre en el runtime **edge**, y
`register()` en `src/instrumentation.ts:11` retorna de inmediato si
`NEXT_RUNTIME !== 'nodejs'`. Ninguno de los avisos de arranque
(`startup.observabilidad`, `startup.config_silenciosa`, `startup.entorno_grupos`)
existe en el proceso donde vive el gate.

Consecuencia: la única capa por la que pasa todo el tráfico autenticado es la
única sin instrumentar. Si el 6-ago el panel "no abre", el primer sitio donde
mirar es precisamente el que no dejó huella.

Causa raíz probable: `proxy.ts` se reescribió desde el ejemplo oficial de
`@supabase/ssr`, que no incluye logging, y nadie lo cableó al `logger` del repo
al aterrizarlo.

### [ALTO] El runbook describe un candado que ya no existe y calla toda la configuración que el login nuevo necesita

`DEPLOY.md:93-101` (la tabla de "las cuatro que hay que revisar a mano"),
`.env.example:46-48`, `DEPLOY.md:3`.

Tres cosas, verificadas una por una:

1. **La tabla afirma algo falso.** Dice `DASHBOARD_PASSCODE` → «`proxy.ts` **no
   bloquea** `/dashboard`: el panel queda abierto», y `.env.example:46-47` repite
   «`proxy.ts:22` NO bloquea /dashboard». Leí `src/proxy.ts` entero: no menciona
   `DASHBOARD_PASSCODE` en ninguna línea; el gate de :44-77 es la sesión de
   Supabase. Los únicos lectores de esa variable que quedan son
   `src/app/acceso/page.tsx:24` y `src/lib/auth/passcode.ts:90`, y ninguno de los
   dos protege `/dashboard`. Escenario: el 6-ago alguien limpia la variable
   muerta, lee esta tabla y cree que dejó el panel del contralor abierto al
   público.

2. **Faltan las dos que sí importan hoy.** `NEXT_PUBLIC_APP_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` **no están** en esa tabla, y la primera es la
   que decide a qué dominio se manda el magic link
   (`src/app/login/page.tsx:10`). Además el fallback del código es
   `https://likida.ai` mientras `DEPLOY.md:3,14,124` insiste en que producción es
   `https://likidaai.vercel.app`: si la variable falta, el link se arma contra un
   dominio que el propio runbook no reconoce como el desplegado.

3. **Nada documenta el lado de Supabase.** `grep -in "redirect url|site
   url|auth/callback|magic link|oauth|google"` sobre `DEPLOY.md`, `README.md`,
   `SEED.md`, `.env.example` y `GUION_DEMO.md` da **cero resultados**. Escenario
   concreto y frecuente: `NEXT_PUBLIC_APP_URL` perfectamente puesta, pero
   `https://<dominio>/auth/callback` no está en la lista de *Redirect URLs* del
   proyecto de Supabase → GoTrue ignora el `emailRedirectTo` y usa la *Site URL*
   del proyecto (por default `http://localhost:3000`). El correo llega, el
   contralor lo abre, y el navegador va a `localhost`. **Likida nunca recibe esa
   petición**, así que no hay log que pueda existir: ningún hallazgo de código
   arregla esto, solo el runbook.

Consecuencia: quien levante o revise el entorno el 5-ago tiene una lista de
chequeo que le miente en un renglón y le omite tres.

### [ALTO] Una máquina limpia no puede entrar al panel: no existe procedimiento para crear el primer usuario

`scripts/seed.sh` (completo), `supabase/seed.sql` (no inserta `app_user` — `grep
-rn "app_user" supabase/` solo devuelve migraciones), `src/app/login/page.tsx:86`
(`shouldCreateUser: false`), `src/app/admin/usuarios/nuevo/page.tsx:24`
(`await requireSuperadmin()`), `src/lib/auth/guard.ts:60-65`.

Escenario, paso a paso: se clona el repo en una laptop limpia (la del 5-ago, la
de repuesto, la de un dev nuevo), se corre `DATABASE_URL=... npm run seed` y
`npm run dev`. Se abre `http://localhost:3000/dashboard` → `proxy.ts:64` redirige
a `/login` → se teclea el correo → `signInWithOtp` con
`shouldCreateUser:false` y sin `auth.users` → Supabase responde `otp_disabled` →
la pantalla dice **«Te mandamos un link a tu correo»** (a propósito, para no
filtrar qué correos existen) y el link nunca llega. El único camino de alta que
existe en el árbol es `/admin/usuarios/nuevo`, que empieza con
`requireSuperadmin()` — o sea que exige una fila `app_user` con
`rol='superadmin'`, que solo se puede crear con esa misma página. El comentario
de `page.tsx:16-17` dice que reemplaza a `scripts/tmp-provisionar-*.ts`; ese
script **ya no existe** (`scripts/` contiene `cosecha/`, `deploy-vercel.sh` y
`seed.sh`). Ni `README.md`, ni `SEED.md`, ni `DEPLOY.md`, ni `TRASPASO.md`
mencionan cómo se crea el primer superadmin.

Lo único que sí queda escrito es `login.otp_sin_cuenta` (`login/page.tsx:98`), un
`warn` con `code` y `status` — suficiente para diagnosticarlo **si alguien sabe
que ese log existe**, pero no hay runbook que lo diga y la pantalla afirma lo
contrario.

Consecuencia: el rubro pide explícitamente que el setup deje el proyecto
corriendo en una máquina limpia; hoy deja el WhatsApp corriendo y el panel
inaccesible. Si la laptop del demo falla el 5-ago no hay procedimiento escrito
para recuperar el acceso al panel, y el `/demo` que sirve de plan B no lo
sustituye (es el simulador, no el panel del contralor).

Causa raíz probable: el bootstrap se hizo con un script temporal que se borró al
construir la pantalla de `/admin`, sin notar que la pantalla depende del estado
que el script creaba.

### [MEDIO] La vigilancia de arranque grita una consecuencia falsa por una variable muerta, y ensucia el mismo aviso que el guion del demo usa como semáforo

`src/lib/observability/arranque.ts:33` (y el encabezado que la repite, :13-14).

`SILENCIOSAS` sigue conteniendo
`{ nombre: 'DASHBOARD_PASSCODE', consecuencia: 'proxy.ts no bloquea /dashboard' }`.
Como se ve en el hallazgo anterior, esa consecuencia es hoy falsa. Dos efectos
concretos y opuestos, los dos malos:

- Si alguien **quita** la variable (lo correcto: el passcode ya no gatea nada),
  cada arranque en frío emite
  `{"level":"error","msg":"startup.config_silenciosa","meta":{"ok":false,"faltan":["DASHBOARD_PASSCODE: proxy.ts no bloquea /dashboard"]}}`.
  Ese `error` va a Sentry (`logger.ts:148`) en el **mismo cubo de `msg`** que el
  aviso real de `DEMO_TENANT_ID`/`NEXT_PUBLIC_APP_URL` — el propio archivo
  explica en :70-74 por qué eso es lo que hace que un aviso se pierda. Se entrena
  a ignorar la línea que más importa el 6-ago.
- Si nadie la quita, hay que mantener viva una variable que ningún gate lee, solo
  para que el semáforo pase.

Y ese semáforo es explícito: `GUION_DEMO.md:28` pone como paso 3 de "antes de
entrar a la sala" que los logs digan `startup.config_silenciosa ok:true`.

`src/lib/cuadra/startup.ts:34-46` documenta este anti-patrón con nombre y fecha
(«un diagnóstico falso cuesta dos veces… cuando el aviso resulta ser mentira una
vez, se aprende a ignorarlo»); la lección no cruzó de un directorio al de al
lado.

Causa raíz probable: la lista se amplió con `NEXT_PUBLIC_APP_URL` (commit
`fd5f619`) sin revisar si las entradas viejas seguían siendo ciertas después de
que el passcode dejara de gatear el panel.

### [MEDIO] `verificarMigracionesCriticas` no sonda 0038/0039/0040/0044/0045 — cierre parcial del CRÍTICO de la ronda 9

`src/lib/cuadra/startup.ts:65-230`. (REINCIDENTE parcial.)

La mitad importante **sí cerró y hay que decirlo**: :161-176 sonda hoy
`trg_gasto_no_tras_liquidar` y `trg_gasto_no_tras_liquidar_update` vía
`triggers_faltantes` (migración 0043), con mensajes que nombran el bug histórico.
Ese era el corazón del CRÍTICO de la ronda 9 y ancló.

Lo que quedó: `grep -n "0038\|0039\|0040\|0044\|0045"` sobre el archivo da cero.
La más relevante hoy es **0045** (`rls_operador`), porque `/mis-viajes` es la
única página del repo que se sirve con el cliente de sesión y confía en RLS
(`src/app/mis-viajes/page.tsx:24`, comentario de :17-22: «el aislamiento lo hace
RLS de verdad»). Escenario: base sin 0045 → la columna `app_user.operador_id` no
existe → el `select` de `session.ts:31` falla y **sí** se registra
`session.app_user_error`, pero con `err: 'column app_user.operador_id does not
exist'` en un `warn` que llega en el turno del usuario, no en el arranque. Por eso
lo dejo en MEDIO y no en CRÍTICO: hay una línea, tarde y en el sitio equivocado.

Sigue igualmente abierto lo que la ronda 9 anotó: `supabase/verificaciones.sql`
—que sí valida triggers y RLS contra Postgres real, incluido el bloque 26 del
chofer— no lo invoca `.github/workflows/ci.yml`, ni `scripts/*.sh`, ni
`package.json`, ni `DEPLOY.md`. Es SQL que un humano corrió una vez.

Causa raíz probable: el probe crece cuando una auditoría lo señala, no cuando se
añade una migración; no hay nada que ligue `supabase/migrations/*.sql` con
`startup.ts`.

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 9 sobre 0036/0037 está genuinamente cerrado**
  (`startup.ts:161-176`, sonda de `triggers_faltantes` de la 0043, con
  `reportarProbe` y por tanto con la distinción "no existe" vs "no contestó").
- **El camino del dinero sigue instrumentado y con identificador.** Releí
  `src/app/api/export/liquidaciones/route.ts:35-38`: el error de PostgREST se
  queda dentro, el usuario recibe un texto repetible y el log lleva `tenant`
  (huellado, no borrado). El bloque de costos de `DEPLOY.md:51-66` sigue
  correspondiendo a los cuatro logs de `costos.ts`.
- **`logger.ts` no cambió su contrato**: huella estable de UUID, borrado de
  RFC/teléfono, `digest` exento, `warn`/`error` reenviados a Sentry por un solo
  camino ya redactado.
- **`instrumentation.ts` sigue cableado** (`register` + `onRequestError` con
  `digest`, `ruta`, `metodo`, y `flushObservabilidad()` esperado).
- **`avisarGruposDeConfiguracion()` sí cubre `NEXT_PUBLIC_SUPABASE_ANON_KEY`**
  (`env.ts:37`), con `msg` propio (`startup.entorno_grupos`) separado del de las
  silenciosas, y la prueba que lo garantiza existe (`arranque.test.ts:111-124`).
- **`NEXT_PUBLIC_APP_URL` sí está en `.env.example:39`** y la prueba
  `arranque.test.ts:43-57` verifica que su ausencia se grita. El inventario de
  `.env.example` no se atrasó con el auth nuevo.
- **`/admin/observabilidad` es honesto**: enlaza Sentry y Vercel en vez de
  simular dashboards, y dice tal cual que latencia p50/p95 y trazas «NO se
  instrumenta hoy» (`page.tsx:29-32`). No presume datos que no tiene.
- **`src/lib/admin/negocio.ts` falla lanzando** (`:62-65`, `:181`, `:219`, `:254`)
  en vez de devolver ceros: un fallo de lectura de `/admin` llega a
  `onRequestError` y sale como `request.fail`.
- **CI (`.github/workflows/ci.yml`) no se degradó**: typecheck, lint, cobertura,
  las pruebas de tiempo sin instrumentar y build, en todas las ramas.
  `npx vitest run src/lib/observability src/lib/auth src/app/login` → 10 archivos,
  81 pruebas, verde.
- **`scripts/seed.sh` sigue siendo un solo comando** contra una base nueva
  (migraciones + bucket + seed) con los valores inventados marcados. Su límite es
  el hallazgo del bootstrap de usuario, no el script en sí.

## Lo que NO alcancé a revisar

- **Si `SENTRY_DSN` está de verdad puesto en el proyecto de Vercel hoy.** Todo el
  valor de los `logger.error` de este informe depende de eso y desde aquí no hay
  forma de comprobarlo; `/admin/observabilidad` afirma «Ya conectado» sin
  verificarlo contra nada.
- **La configuración del proyecto de Supabase** (Site URL, lista de Redirect
  URLs, proveedor de Google, remitente SMTP real vs. el sandbox de Resend). Es
  donde vive la mitad del riesgo del hallazgo del magic link y no es visible
  desde el repo.
- **Los 39 archivos de `/admin` uno por uno.** Verifiqué el patrón de errores en
  `negocio.ts` y leí dos páginas completas; no audité cada `page.tsx` buscando
  `catch` mudos.
- **Si la desincronía build-time vs. runtime de `NEXT_PUBLIC_*` es explotable en
  la práctica.** `arranque.ts:55` lee `process.env[v.nombre]` (dinámico, runtime)
  mientras `login/page.tsx:10` lee `process.env.NEXT_PUBLIC_APP_URL` (estático,
  que Next reemplaza en el build). En Vercel las dos vienen del mismo conjunto de
  variables del despliegue, así que no logré construir un escenario con valores
  que produzca un `ok:true` falso; lo dejo anotado porque
  `scripts/deploy-vercel.sh:47-51` fija esa variable **después** de desplegar y
  solo imprime un recordatorio de redesplegar.
- **`src/lib/cuadra/processor.ts` fuera del auth.** Los dos hallazgos de la ronda
  9 sobre `foto_pendiente` (pérdida silenciosa de comprobante y colisión del
  `msg` `foto.pendiente_error`) no los reverifiqué: el encargo de esta ronda
  apuntaba al arranque y al login, y no me quedó margen. **No los des por
  cerrados.**
