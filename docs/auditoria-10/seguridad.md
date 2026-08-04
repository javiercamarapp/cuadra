# Seguridad — auditoría 10

**Nota: 5/10** (antes 8). Razón del movimiento: **deuda que cobró factura**. La
decisión de que *todo* el panel lea con `supabaseAdmin()` (service-role, salta
RLS) y de que la RLS sea **por tenant y no por rol** era inofensiva mientras
todos los usuarios del panel eran iguales. Esta ronda entró un quinto rol
—`operador`, el chofer— cuyo valor entero es *ver menos*, y esas dos decisiones
viejas lo dejan viendo todo. La 0045 escribió la RLS del chofer con cuidado y
la aplicación la esquiva por dos caminos distintos.

Lo que **sí** se sostiene, y por eso no baja de 5: el aislamiento **entre
flotas** no se rompió por ningún lado que haya podido recorrer, no hay camino
**sin autenticar** a datos de un tenant, y ningún secreto tiene fallback
derivado de otro. Lo que se rompió es el aislamiento **entre roles dentro de
una flota**, que es exactamente el entregable de esta ronda.

El riesgo mayor del rubro hoy: **el rol del usuario solo decide qué página le
pinta la interfaz; ninguna de las dos capas de servidor (`proxy.ts` y los
`require*` de `guard.ts`) mira el rol en `/dashboard`, y la base tampoco, porque
esa página lee con service-role.**

---

## Hallazgos

### [CRÍTICO] Un chofer con cuenta abre `/dashboard` y ve la flota entera — y es el único panel al que la consola de superadmin lo puede mandar hoy

`src/lib/auth/guard.ts:27-37` · `src/app/dashboard/page.tsx:62` y `:34` ·
`src/app/dashboard/[id]/page.tsx:35,37` · `src/lib/cuadra/analytics.ts:8` ·
`src/lib/auth/provisionar.ts:28-30` · `src/app/login/page.tsx:49`

`requireSessionTenant` solo comprueba dos cosas: que haya sesión y que haya
`tenantId`. No mira `rol`:

```ts
const s = await getSessionTenant();
if (!s) redirect(`/login?next=…`);
if (!s.tenantId) { if (s.rol === 'superadmin') …; redirect('/sin-acceso'); }
return s as SessionTenant & { tenantId: string };
```

`rol === 'operador'` con `tenant_id` puesto pasa. `requireOperador`
(`guard.ts:51`) rebota a `/dashboard` a todo el que **no** sea operador, pero
nada rebota al operador **fuera** de `/dashboard`. Y la página no puede
apoyarse en la RLS de la 0045 porque no usa la sesión: `getLiquidaciones`
(`page.tsx:34`) y todo `analytics.ts` (`:8`) leen con `supabaseAdmin()`,
service-role, que salta RLS por `rolbypassrls`. El comentario de
`guard.test.ts:44-46` deja escrita la premisa falsa: *«Un chofer que aterrice
ahí por error no debe ver ESE panel (**RLS ya se lo impediría**, pero la UI ni
se lo ofrece)»*. No se lo impediría: en esa página la RLS no está en el
circuito.

**Escenario, con valores.** Javier da de alta a Rubén desde
`/admin/usuarios/nuevo`, opción **«Chofer (operador) — solo sus propios
viajes»** (`usuarios/nuevo/page.tsx:12`), flota "Transportes del Bajío"
(`tenant_id = A`). `provisionarUsuario` inserta
`{id, tenant_id: A, email, nombre, rol: 'operador'}` — **sin `operador_id`**
(`provisionar.ts:28-30`; la columna existe desde la 0045 y esta función no la
llena).

1. Rubén pide su magic link en `/login` y entra.
2. `login/page.tsx:49` fuerza `next` a `/dashboard` salvo que ya empiece por
   `/dashboard` — o sea que aterriza **siempre** en `/dashboard`.
3. `/dashboard` le sirve: las **20 liquidaciones más recientes de toda la
   flota** con folio, fecha, monto comprobado y diferencia con signo; los KPIs
   del periodo (`viajesLiquidados`, `montoComprobado`, `tasaCuadre`); los
   acreditables fiscales de la flota; y la sección de *«mismo comprobante en
   varios viajes»* con los folios de los viajes implicados.
4. Cada renglón es un `<Link>` a `/dashboard/{id}` (`page.tsx:259`), que vuelve
   a llamar `requireSessionTenant` (`[id]/page.tsx:35`) y vuelve a pasar: ahí
   ve **el nombre del chofer asignado**, el desglose de cada gasto con
   concepto, monto, folio y CFDI, y el veredicto de la liquidación de sus
   compañeros.
5. Su propio panel, `/mis-viajes` —el que sí tiene RLS real— lo manda a
   `/sin-acceso`, porque `requireOperador` exige `operadorId` y la consola no
   lo llenó (`guard.ts:52`).

O sea: hoy, un usuario dado de alta con el rol cuya etiqueta promete «solo sus
propios viajes» **no puede entrar a la pantalla que se le construyó y sí puede
entrar a la que no**.

**Consecuencia.** Para la flota: cada chofer con cuenta web conoce el anticipo,
lo comprobado y la diferencia de todos los demás — el dato más delicado de una
liquidación, el que decide si a alguien le descuentan de la nómina. Para el
contralor el 6-ago: la pregunta *«¿el chofer puede ver lo de los otros?»* es la
primera que hace un comprador de este producto, y la respuesta demostrable en
la sala es que sí. Para el equipo: la migración 0045, el bloque 26 de
`verificaciones.sql` y la página `/mis-viajes` —el trabajo completo de la
Task 4/5— quedan sin efecto por la ruta que el propio login elige por default.

**Causa raíz probable.** `requireSessionTenant` heredó tal cual el contrato del
`exigirAcceso` del passcode (*«¿hay sesión? entonces pasa»*) y nadie le agregó
la comprobación de rol cuando apareció un rol que debe ver menos; el panel lee
con service-role, así que no hay una segunda capa que lo atrape.

---

### [CRÍTICO] La RLS del chofer solo cubre 3 de las 7 tablas: `operador`, `terminal`, `politica_gasto` y `wa_conversacion` le siguen dando lectura **y escritura**

`supabase/migrations/0045_rls_operador.sql:39` ·
`supabase/migrations/0001_init.sql:110-117` ·
`supabase/migrations/0045_rls_operador.sql:15-17` (la justificación) ·
`src/lib/cuadra/conv.ts:60-74`

La 0045 reescribe `tenant_data` **solo** para tres tablas:

```sql
foreach t in array array['viaje', 'gasto', 'liquidacion']
```

Las otras cuatro conservan la policy de la 0001 (`0001:114-116`), que es
`for all` —SELECT, INSERT, UPDATE, DELETE— y no mira el rol:

```sql
create policy tenant_data on %I for all
using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
```

La propia 0045 lo declara y da la razón equivocada (`:15-17`): *«Las otras 4
tablas de `tenant_data` (terminal, politica_gasto, wa_conversacion — y
`operador` misma) no cambian: el chofer no tiene vista de esas»*. «No tiene
vista» es una afirmación sobre la interfaz; la policy es sobre PostgREST, que
está en internet. La cabecera de esa misma migración explica por qué eso no
basta: *«la UI de /mis-viajes sería el único candado — el que un token robado
se salta sin pasar por el navegador»*. Y `verificaciones.sql:893-894` ya dejó
escrito que los grants de tabla no ayudan: *«`anon` y `authenticated` tienen
SELECT/INSERT/UPDATE/DELETE … porque es el default del esquema `public` en
Supabase»*.

**Escenario, con valores.** Rubén (el mismo chofer del hallazgo anterior) abre
las devtools de **su propio** navegador y copia el access token de la cookie
`sb-<ref>-auth-token`. La `apikey` es la anon key, pública por diseño
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `src/lib/supabase/server.ts:11`).

*Lectura:*
```
GET https://<ref>.supabase.co/rest/v1/operador?select=nombre,telefono,numero_empleado
```
→ las 40 filas de `operador` de la flota: nombre, teléfono personal y número de
empleado de todos los choferes.

*Escritura — la que cuesta dinero:*
```
PATCH /rest/v1/operador?id=eq.<uuid de otro chofer>
{"telefono":"+5215588887777"}          ← un número que Rubén controla
```
`resolveOperador` (`conv.ts:60-74`) resuelve por `telefono` con
`.eq('activo', true)` y devuelve `{tenantId, operadorId}` sin más comprobación:
desde ese momento, los mensajes de WhatsApp del segundo celular de Rubén son
los del compañero. Puede mandar fotos de gasto contra el viaje abierto de otro
y escribir «listo» para cerrarlo — y el PDF del operador, con el nombre, el
folio y los montos del compañero, le llega a él.

*O, en una línea:* `PATCH /rest/v1/operador?tenant_id=eq.<A>` con
`{"activo": false}` deja a **toda la flota** sin poder mandar comprobantes por
WhatsApp: `resolveOperador` devuelve `null` para todos. Si eso pasa el 6-ago,
el demo no corre.

**Lo intenté refutar y no cierra por ningún lado.** El bloque 26 de
`verificaciones.sql:986-1019` —el único que prueba la 0045— cuenta filas
visibles en `viaje`, `gasto` y `liquidacion`, y **solo lee**: no toca las otras
cuatro tablas ni intenta un UPDATE. No hay `revoke` de tabla en ninguna
migración (`grep -n "revoke" supabase/migrations/` solo devuelve revokes de
`execute on function`). Las 16 tablas tienen RLS encendida, así que la única
puerta abierta es esta policy, y está abierta a propósito.

**Consecuencia.** Para los choferes: su teléfono personal y su número de
empleado quedan legibles por cualquier compañero con cuenta, y su identidad de
WhatsApp —que es la que autoriza gastos contra un anticipo— es reescribible por
él. Para la flota: dinero anotado al chofer equivocado, sin que nada en el log
lo distinga de un gasto legítimo.

**Causa raíz probable.** La 0045 razonó tabla por tabla desde *«¿esto lo pinta
alguna pantalla del chofer?»* en vez de desde *«¿qué le entrega PostgREST a un
JWT con `rol=operador`?»*.

---

### [ALTO] Los dos endpoints de export autentican pero no autorizan: `puedeExportar` existe, excluye a `operador`, y no se llama en el servidor

`src/app/api/export/liquidaciones/route.ts:17-19` ·
`src/app/api/export/pdf/[id]/route.ts:32-34` · `src/lib/auth/permisos.ts:17,21`

```ts
const s = await getSessionTenant();
if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
```

Eso es todo. `puedeExportar` —cuyo conjunto `EXPORTA` (`permisos.ts:17`) tiene
los cuatro roles **menos `operador`**— solo se usa para decidir si se pinta el
botón: `dashboard/page.tsx:222` y `dashboard/[id]/page.tsx:95`. El repo ya sabe
que eso no basta y lo escribió al lado, en el server action de reasignación
(`[id]/page.tsx:45-51`): *«Repite la comprobación de permiso EN el server
action: el `puedeAsignar` de arriba solo decide si el `<form>` se pinta»*. Esa
lección no se aplicó a los dos `route.ts`, que además son las **únicas** rutas
privilegiadas fuera del matcher del proxy (`proxy.ts:81` excluye `api`): ahí no
hay primera capa que valga, la única comprobación es esa línea.

**Escenario, con valores.** Rubén, chofer, con su sesión ya viva:

```
curl -b "sb-<ref>-auth-token=…" https://app.likida.ai/api/export/liquidaciones
```
→ `200` con `Content-Disposition: attachment; filename="liquidaciones_likida.csv"`
y hasta **5,000 filas** (`route.ts:26`) de toda la flota: fecha, total
comprobado, total anticipo, diferencia, estatus, folio del viaje y **nombre del
operador** de cada una (`route.ts:23`). Con cualquier `id` de esa lista,
`GET /api/export/pdf/<id>` devuelve un 302 a la URL firmada del PDF **del
contralor** —el ejemplar con los veredictos, según el comentario de `:23-25`.

**Consecuencia.** Es el mismo dato del primer hallazgo pero en formato
máquina y de un jalón: 20 renglones en pantalla contra 5,000 en un CSV que se
abre en Excel. Para el contralor, el archivo que él exporta para su ERP lo
puede exportar igual cualquier chofer con cuenta.

**Causa raíz probable.** Al migrar del passcode a la sesión se sustituyó
`tokenMatches(...)` por `getSessionTenant()` línea por línea; el passcode no
tenía roles que comprobar, así que no había nada que trasladar, y la función
que sí los tiene se quedó en la capa de pintado.

---

### [ALTO] El `contador` se vende como «solo lectura» en la consola y la base le da escritura completa sobre `viaje`, `gasto` y `liquidacion`

`src/app/admin/usuarios/nuevo/page.tsx:11` · `src/lib/auth/permisos.ts:4-9,19` ·
`supabase/migrations/0045_rls_operador.sql:39-45`

La consola de superadmin ofrece el rol con esta etiqueta literal:

```ts
{ valor: 'contador', etiqueta: 'Contador — solo lectura y exportar' },
```

`permisos.ts` lo respeta en la aplicación (`ADMINISTRA` y `ASIGNA` no lo
incluyen) y a la vez declara lo contrario de la base en su propia cabecera
(`:4-9`): *«cualquier app_user de un tenant tiene lectura+escritura completa
sobre las 7 tablas de negocio vía la policy `tenant_data`. Eso es correcto
para flota_admin/encargado/contador»*. Después de la 0045 esa policy sigue
siendo `for all` para todo rol que **no** sea `operador`
(`0045:41-42`: `and not is_operador()`), así que «solo lectura» no existe en
ningún lado salvo en la etiqueta del `<select>`.

**Escenario, con valores.** Marisol, contadora externa de la flota A, con su
sesión legítima del panel:

```
DELETE /rest/v1/liquidacion?id=eq.<uuid>
Authorization: Bearer <su access token>
```
→ `204`. La liquidación desaparece del panel del contralor, del CSV y del PDF
descargable, sin `logger`, sin fila de auditoría y sin trigger que lo impida
(la 0036/0037/0042 cubren INSERT y UPDATE de `gasto`, no DELETE de
`liquidacion`). Lo mismo con
`PATCH /rest/v1/viaje?id=eq.<uuid>` `{"anticipo": 0}` sobre un viaje aún
abierto: la próxima liquidación calcula la diferencia contra un anticipo que
nadie entregó.

**Consecuencia.** Para el contralor: una separación de funciones que su consola
le promete por escrito y que ninguna capa de servidor sostiene — es
exactamente lo que su auditor interno va a pedir demostrar. La única capa que
hoy detiene esto es que la interfaz no pinta el botón, y la interfaz no es una
capa.

**Causa raíz probable.** Los cinco roles se diseñaron como una tabla de
permisos de aplicación (`permisos.ts`) sin un cambio equivalente en la RLS; la
0045 hizo ese trabajo **solo** para `operador`, que era el que tenía plan
escrito.

---

### [MEDIO] `shouldCreateUser:false` solo protege el camino del correo; el botón de Google no tiene equivalente en código

`src/app/login/page.tsx:59-62` y `:80-87` ·
`src/app/login/no_autoregistro.test.ts:26-32`

El camino de magic link cierra el autoregistro en el código y tiene prueba que
lo ancla. El de Google no:

```ts
const { data, error } = await sb.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${siteUrl()}/auth/callback?next=…` },
});
```

`signInWithOAuth` no tiene `shouldCreateUser`. Lo único que impide que un
consentimiento de Google cree un `auth.users` es el interruptor *«Allow new
users to sign up»* del proyecto en el dashboard de Supabase — y el hecho de que
el código se moleste en poner `shouldCreateUser:false` en el otro camino dice
que ese interruptor está **encendido**. `no_autoregistro.test.ts` prueba las
tres propiedades del camino del correo y ninguna del de Google.

**Escenario, con valores.** El día que se configure el provider (hoy el propio
test lo da por no configurado, `:31`), cualquiera con una cuenta de Google
pulsa «Continuar con Google» en `app.likida.ai/login`: obtiene un `auth.users`
real y un JWT con `role=authenticated` firmado por el secreto del proyecto. En
la app no ve nada —`getSessionTenant` devuelve `tenantId: null` y
`requireSessionTenant` lo manda a `/sin-acceso`— pero el JWT sí sirve contra
PostgREST, donde queda a merced de que **todas** las policies estén bien
escritas para un `get_user_tenant_ids()` vacío. Las recorrí y hoy todas
deniegan; el punto es que la puerta de entrada dejó de estar cerrada por código
y pasó a estar cerrada por una casilla que ninguna prueba mira.

**Consecuencia.** Registro ilimitado de cuentas contra el proyecto (MAU
facturable, cuota de correo) y una superficie de JWT válidos que el diseño
supone imposible. Colateral para el 6-ago: si el provider **no** está
configurado, ese botón —el primero de la pantalla de login— devuelve *«Algo
falló. Intenta otra vez.»* delante del contralor.

**Causa raíz probable.** La decisión «nadie se da de alta solo» se implementó
en el sitio donde el SDK ofrece una bandera, y en el otro camino se dio por
implícita.

---

### [BAJO, REINCIDENTE — rondas 8, 9 y 10] `gasto_no_tras_liquidar` sigue sin `search_path` fijo, y ahora cuelga de dos triggers

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:55-58` ·
`supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql:18-30`

```sql
create or replace function gasto_no_tras_liquidar()
returns trigger
language plpgsql
as $$
```

Sin `set search_path = public`, y sus dos `select … from viaje` / `from
liquidacion` siguen sin calificar el esquema. Sigue siendo la única función de
`public` sin `proconfig` (la 0035 fijó las demás y es anterior a la 0036, así
que no pudo alcanzarla). La 0042 —escrita **esta ronda**, precisamente para
arreglar el hallazgo ALTO de la ronda 9— volvió a tocar el trigger que la usa y
otra vez no le puso la línea.

**Escenario y consecuencia:** los mismos de la ronda 8 (bajo un `search_path`
con otro esquema delante de `public`, el `select exists` lee una tabla sombra y
el gasto tardío entra). Sigue en BAJO por la misma razón comprobada:
`has_schema_privilege('anon','public','CREATE') = false`, así que hoy nadie que
llegue por PostgREST puede crear esa sombra. Lo que se reporta es que la
migración que existía para arreglar esta función tuvo la línea a la vista y no
la puso. El bloque 18 de `verificaciones.sql:738-746` sigue comprobando una
lista de nueve nombres tecleada a mano —`has_function_privilege` de las RPC,
no `proconfig`— así que nada en el repo mira esto.

---

### [BAJO, REINCIDENTE de las rondas 8 y 9] `GET /api/demo` publica el inventario de configuración sin autenticar

`src/app/api/demo/route.ts:8-10`

```ts
export async function GET() {
  return NextResponse.json({ ok: true, config: envHealth() });
}
```

`/api` está fuera del matcher del proxy (`proxy.ts:81`) y esta función no tiene
sesión, rate-limit ni cap de cuerpo. `envHealth()` (`src/lib/env.ts`) devuelve
`{llm: bool, whatsapp: bool, supabase: bool}`: no valores, sí un mapa de qué
integraciones están puestas en el despliegue. Sigue sin cambio desde la ronda 8.

**Escenario:** `curl https://app.likida.ai/api/demo` → `{"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}`.
**Consecuencia:** reconocimiento gratuito y un canal para saber, sin cuenta, si
un despliegue quedó a medias. Bajo porque no hay secreto ni dato de tenant en
la respuesta.

---

### [BAJO, REINCIDENTE de la ronda 9] La descarga de media de Meta sigue sin tope de tamaño

`src/lib/meta/client.ts:158-176` (`return await bin.text()`, `:171`) ·
`:192` (`Buffer.from(await bin.arrayBuffer())`)

Sin cambio. El cap de 256 KB del webhook (`webhook/whatsapp/route.ts:42,45`) es
correcto y mide dos veces, pero lo que ese cuerpo trae es un `media_id`; la
descarga posterior no mira `content-length` ni `byteLength`.

**Escenario, con valores:** un operador dado de alta manda como *documento* un
`.xml` de 100 MB (el máximo de WhatsApp Cloud API). El webhook responde 200 con
400 bytes; después, en `after()`, `downloadMediaAsText` lo materializa entero y
`saveCfdiXmlRaw` lo escribe en una columna `text` sin `check` de longitud.
**Consecuencia:** la invocación se lleva por delante los demás mensajes del
mismo lote (`route.ts:72`, `Promise.all`) y el egress de Supabase —que ya
bloqueó dos trabajos programados— se estrangula. Sigue en BAJO porque quien lo
dispara es un operador identificado por HMAC y hace falta un XML deliberado.

---

### [BAJO] `/acceso` sigue publicado con el passcode viejo, y ya no autoriza nada

`src/app/acceso/page.tsx:13-35` · `src/lib/auth/passcode.ts:236-252`

`/acceso` sigue siendo una ruta pública que compara `DASHBOARD_PASSCODE` y
emite la cookie `likida_access`. **`tokenMatches` no lo llama nadie** —lo
verifiqué: fuera de `passcode.ts` y su prueba, no hay un solo consumidor— así
que la cookie que emite no abre ninguna puerta.

**Escenario, con valores:** alguien teclea `app.likida.ai/acceso` el 6-ago y ve
una segunda pantalla de login, con otro branding, que acepta un código y
después no lleva a ningún lado: `redirect('/dashboard')` y el proxy lo devuelve
a `/login`. Y si `DASHBOARD_PASSCODE` sigue puesto en Vercel con un valor
débil, `passcodeConfigurado()` (`passcode.ts:172-177`) lanza y esa ruta responde
500 en producción.

**Consecuencia:** una puerta muerta en la superficie pública el día del demo, y
un secreto (`DASHBOARD_PASSCODE`) que sigue vivo en el entorno sin proteger
nada. No es una segunda vía de acceso —lo comprobé— es un vestigio.
**Causa raíz probable:** el reemplazo del passcode migró los consumidores y no
retiró el emisor.

---

## Lo que revisé y está bien

**`/admin` sí está detrás de autorización de rol real, página por página — la
respuesta a la pregunta 1 es que no es «solo un matcher».** Abrí las 26 páginas.
`requireSuperadmin()` vive en `admin/layout.tsx:27`, y en App Router el layout
envuelve a *toda* página descendiente: el `redirect()` aborta la respuesta antes
de que el RSC del hijo se serialice. Lo reforcé por tres vías: **(a)** no existe
ningún `route.ts` bajo `src/app/admin/` (`find src/app/admin -type f`, 39
archivos, cero handlers), que es la forma en que un layout no protege a su
hermana; **(b)** los únicos dos server actions de `/admin` repiten la
comprobación por su cuenta —`usuarios/nuevo/page.tsx:28` llama
`requireSuperadmin()` **dentro** de `crear`, no solo arriba, y el `cerrarSesion`
del layout solo hace `signOut`—; **(c)** `admin/page.tsx:102` la vuelve a
llamar en su `Promise.all`. Lo que sí anoto sin subirlo a hallazgo: para las
otras 25 páginas la comprobación de **rol** ocurre en **un solo punto** (el
proxy solo pregunta «¿hay sesión?», `proxy.ts:44`), y `/cuenta` está fuera del
gate del proxy y depende únicamente de `requireSessionTenant`
(`cuenta/page.tsx:9`). Es correcto, es una sola capa.

**El chat de `/admin` no traduce lenguaje natural a SQL.** `admin/chat.tsx:23-43`
es coincidencia de palabras clave contra un `ResumenNegocio` **ya calculado en
el servidor**; el texto del usuario nunca llega a la base. Era mi primera
hipótesis al leer «chat de asistente» en el MAPA y está cerrada por diseño, con
el razonamiento escrito en el archivo.

**No hay tabla sin RLS.** Crucé las 16 `create table` de las migraciones contra
los `enable row level security` (siete por el bucle de `0001:110`, nueve
explícitas): cobertura completa. No hay ninguna tabla que dependa solo de los
grants por defecto.

**El aislamiento entre flotas se sostiene.** Ninguna ruta acepta un `tenant_id`
del cliente: el webhook lo resuelve por teléfono (`conv.ts:60`), los dos export
y las dos páginas del panel lo toman de la sesión y lo re-imponen con `.eq()`
sobre el service-role, `/aviso/[tenant]` solo devuelve razón social y domicilio
con `notFound()` indistinguible, y `/api/demo` POST es cálculo puro sin base.
Los cuatro hallazgos de arriba son **dentro** de una flota, no entre flotas.

**Enumeración de usuarios en `/login`: verificada en el código, no se puede.**
El caso «correo sin cuenta» cae en `esCorreoSinCuenta` (`login/page.tsx:34-40`,
que mira `otp_disabled`, `signup_disabled` **y** el texto del mensaje, porque
el `code` no existe en SDK viejos) y termina en el **mismo**
`redirect(…&enviado=1)` que el caso con cuenta (`:97`). El exceso de límite
también devuelve el error genérico y no «vas muy rápido» (`:68-71`), que sería
el segundo oráculo. Queda un canal de temporización teórico (no mandar correo
es más rápido que mandarlo) que no puedo medir sin producción y que el límite
de 10/5 min por IP estorba; no da para hallazgo.

**Redirecciones abiertas: no hay.** Los cuatro sitios que aceptan `next` lo
filtran con `startsWith('/dashboard')` — `login/page.tsx:49,54,70`,
`auth/callback/route.ts:12`, `acceso/page.tsx:11,32`. `//evil.com` y
`https://evil.com` no pasan el filtro.

**El fallback de `session.ts:42` (`rol ?? 'flota_admin'`) es inofensivo, esta
vez sí verificado extremo a extremo.** Un usuario de Auth sin fila en
`app_user` sale con `tenantId: null` y `rol: 'flota_admin'`; los tres `require*`
lo mandan a `/sin-acceso` o `/dashboard`→`/sin-acceso`, y los dos export
devuelven 401 por `!s.tenantId`. `app_user.rol` es `not null` con check de
dominio (0044), así que el `??` no puede dispararse con fila presente. Falla
cerrado por todas las puertas.

**Ningún secreto con fallback derivado.** `secret()` lanza en producción en vez
de caer a `likida:${passcode}` (`passcode.ts:85-89`); `supabaseAdmin()` lanza
sin `SUPABASE_SERVICE_ROLE_KEY` (`admin.ts:14`); `verifySignature` devuelve
`false` sin `WHATSAPP_APP_SECRET` (fail-closed). El único valor con default
literal es `DEMO_TENANT_ID` en `guard.ts:25`, y no es un secreto: es un id que
lleva meses en `seed.sql`, en un repo público, y tenerlo no abre nada.

**Cabeceras de seguridad: el reincidente de la ronda 8 está cerrado.**
`withSecurityHeaders` se aplica ahora en un solo punto al final **y** al objeto
de redirección (`proxy.ts:72,77`), que era exactamente el hueco. El `no-store`
va en las rutas gateadas (`:74`). Sigue sin CSP, igual que en las rondas 8 y 9.

**La URL firmada del PDF que va por WhatsApp: cerrada tras cuatro rondas.**
`processor.ts:1411` firma con **60** segundos, no 3600. Lo doy por resuelto y
no lo repito como reincidente.

**Los dos hallazgos de SQL de la ronda 9 están cerrados.** El `when` del trigger
ya incluye `fecha` (`0042:19-30`) y `verificaciones.sql:928` lo ancla con un
bloque nuevo; `foto_pendiente` se eliminó entera (`0041`), así que su FK sin
`tenant_id` dejó de existir. El TTL de `ligaComprobante` sigue en 3600
(`almacen.ts:76`) pero **ya no lo llama nadie** —`foto_no_expuesta.test.ts:28`
prueba que el panel no la importa—, así que no hay escenario que escribir y no
lo levanto como hallazgo: es un default peligroso esperando un consumidor.

**CVE: `npm audit` da 11 (2 críticas, 5 altas, 4 moderadas), mismo cuadro que
la ronda 9, y ninguna tiene camino real de explotación en esta app — lo digo por
escrito y lo descarto.** Las dos críticas son `vitest` y `@vitest/coverage-v8`
(la misma advisory contada dos veces, devDependency, nunca se corre `--ui`).
`postcss` (3 advisories, vía `next`), `brace-expansion` (seis copias, todas bajo
`node_modules/eslint*`) y `esbuild` (GHSA-67mh-4wv8-2f99, que solo afecta al
**dev server**) son de build y de lint: no hay `postcss` ni `esbuild` en el
runtime de la función desplegada, y ninguna de las tres advisories de `postcss`
—XSS por `</style>` sin escapar, lectura de archivo por `sourceMappingURL`—
tiene una entrada donde el atacante controle CSS de este repo. `@sentry/nextjs`
figura solo por depender de `next`. El único paquete que toca bytes del
atacante es **`sharp` 0.34.5** (GHSA-f88m-g3jw-g9cj, cuatro CVE de libvips):
`intake/cfdi.ts:249` corre `sharp(image).rotate().resize(…)` sobre lo que baja
de WhatsApp. Reverifiqué que las ramas nuevas de esta ronda no ensanchan ese
canal —`/admin` y `/mis-viajes` no tocan imágenes de usuario, y el camino de
`document` va a `downloadMediaAsText`, que no pasa por `sharp`— y que sigue
haciendo falta ser un operador dado de alta (`processor.ts` corta en
`resolveOperador` antes de cualquier descarga). Observación vigilada, no
hallazgo: hay arreglo publicado (`sharp@0.35.3`) y `package.json` sigue fijando
`^0.34.0`.

---

## Lo que NO alcancé a revisar

- **Ejecutar los dos hallazgos de RLS contra Postgres real.** El razonamiento
  es sobre el texto de las policies (`0045:39-49` y `0001:110-117`) y sobre qué
  cliente usa cada página, y las dos cosas están leídas línea por línea — pero
  no corrí `set local role authenticated` + `update operador …` contra la base
  del proyecto, que es lo que lo volvería incontestable. Es un bloque de quince
  líneas al lado del 26 de `verificaciones.sql`, y ese bloque no existe: el 26
  solo cuenta filas visibles en tres tablas y nunca intenta escribir.
- **Confirmar que Supabase acepta el access token del usuario como `apikey`.**
  El escenario del segundo hallazgo lo doy por bueno con la anon key, que es
  pública por diseño; no probé la variante en que el JWT del propio usuario
  sirve de las dos cosas. No cambia la conclusión, cambia cuánto trabajo cuesta.
- **El estado real del interruptor «Allow new users to sign up»** del proyecto
  Supabase, del que depende por completo el hallazgo de Google. Esta ronda corre
  sin credenciales y no pude consultarlo; el razonamiento se apoya en que el
  código pone `shouldCreateUser:false` en el otro camino, lo cual solo tiene
  sentido si está encendido.
- **El linter de Supabase (`get_advisors`) contra la base viva.** Afirmo que
  `gasto_no_tras_liquidar` sigue sin `search_path` porque ninguna migración se
  lo pone, no porque haya vuelto a leer `pg_proc.proconfig`.
- **CSP y el sumidero de XSS de `/privacidad`.** Sigue sin CSP ni en `proxy.ts`
  ni en `next.config.ts`, tercera ronda igual, y sigo sin recorrer
  `privacidad/page.tsx` con el detalle que merece.
- **Concurrencia real del rate-limit.** Cuarto pendiente idéntico: exige tráfico
  agresivo contra producción, que esta ronda prohíbe.
