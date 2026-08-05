# Modelo de datos y esquema — auditoría 11

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**. La
`0047` metió cuatro tablas de golpe **sin una base contra la cual ejercerlas** y
repitió, una por una, las tres decisiones que la `0028` y la `0025` habían
cerrado para el resto del esquema: FK sin `tenant_id`, unicidad global en vez de
por tenant, y dominios numéricos sin `CHECK`. Encima, el módulo que las escribe
(`operacion.ts`, 567 líneas) asume que `viaje.operador_id` es nullable cuando la
`0001:49` lo declara `not null` — o sea que la pantalla estrella del encargado,
en su estado por default, la base la rechaza. El núcleo del dinero (dominios de
la `0025`, unicidades `0019`/`0024`/`0027`/`0029`, FK compuestas de la `0028`,
triggers `0036`/`0037`/`0042`) sigue en nivel 8 y no lo tocó nadie; todo lo que
llegó en las últimas tres migraciones está en nivel 3.

Anclado a `e4326f9` sobre `master`. **No hay Postgres en este entorno**: todo lo
que sigue sale de leer las migraciones, las policies y sus llamadores. No corrí
un solo `select`.

Riesgo mayor del rubro hoy: **el esquema rechaza el estado que el panel del
encargado necesita para existir** (`viaje.operador_id not null` vs. "Asignar
después"), y ninguna sonda del arranque toca la `0044`, la `0045`, la `0046` ni
la `0047` — las cuatro migraciones de las que dependen el login y las cuatro
pantallas nuevas del demo del 6-ago.

## Hallazgos

### [CRÍTICO] `viaje.operador_id` es `NOT NULL` desde la `0001` y TODO el módulo del encargado está construido sobre que sea nullable: "Crear viaje" en su opción por default es un 23502, y "Viajes sin asignar" no puede devolver una fila jamás

`supabase/migrations/0001_init.sql:49`
(`operador_id uuid not null references operador(id) on delete restrict`) ·
`grep operador_id supabase/migrations/` confirma que **ninguna** de las 47
migraciones hace `alter column operador_id drop not null`; la `0028:96` incluso
le añadió la FK compuesta `viaje_operador_tenant_fkey` sin tocar la nulabilidad ·
`src/lib/cuadra/operacion.ts:477` (`operador_id: v.operadorId || null`) ·
`src/lib/cuadra/operacion.ts:124` (`.is('operador_id', null)`) ·
`src/lib/cuadra/operacion.ts:442` (`porAsignar: enCurso.filter((v) => !v.operador_id).length`) ·
`src/lib/cuadra/operacion.ts:83` (`if (!op) continue; // sin dueño`) ·
`src/app/dashboard/despacho/vista.tsx:164`
(`<option value="">Asignar después</option>` — es la opción **seleccionada por
default** del `select name="operadorId"`) ·
`src/app/dashboard/despacho/page.tsx:108-116` (el server action no envuelve
`crearViaje` en `safe()`).

Escenario, con valores. En el demo, el encargado abre `/dashboard/despacho`,
llena Folio `VJ-2026-0900`, Origen `Guadalajara`, Destino `Monterrey`, Anticipo
`8000`, no toca el select de Chofer (queda en "Asignar después") y da "Crear
viaje". Sale:

```sql
insert into viaje (tenant_id, folio, origen, destino, fecha_inicio,
                   anticipo, operador_id, unidad_id, estatus)
values ('1111…', 'VJ-2026-0900', 'Guadalajara', 'Monterrey', null,
        8000, NULL, null, 'abierto');
-- ERROR 23502: null value in column "operador_id" of relation "viaje"
--              violates not-null constraint
```

`crearViaje` lanza (`operacion.ts:482`), el server action no lo atrapa, y Next
pinta la pantalla de error con un `Digest`. La segunda mitad es peor porque es
**silenciosa**: `getViajesSinAsignar` filtra `.is('operador_id', null)` sobre una
columna que no puede ser null, así que devuelve `[]` siempre. La pantalla no dice
"no pude leer": dice, con `EstadoVacio` (`despacho/page.tsx:161-163`), *«Todo lo
que está en curso ya trae chofer»*, y el KPI "Por asignar" (`vista.tsx:26-27`)
pinta **0** con su nota "Sin chofer y todavía sin liquidar". Las dos son
afirmaciones sobre la flota derivadas de una consulta que es estructuralmente
vacía.

Consecuencia: el contralor, en la sala, ve la pantalla del encargado afirmar que
no hay ni un viaje sin repartir —el número que esa pantalla existe para dar— y
si alguien intenta dar de alta un viaje sin chofer, un 500. Es exactamente lo
que "nunca inventar una cifra" prohíbe, causado por el esquema y no por la UI.
La única red de `operacion.ts` no lo puede ver: `operacion.test.ts:293-294`
llama `crearViaje('t-1', { folio: 'VJ-9', … })` **sin `operadorId`** contra
Supabase mockeado — la prueba verde demuestra que el mock acepta null.

Causa raíz probable: la `0047` se escribió para dar de alta unidades e
incidencias y nadie volvió a mirar la nulabilidad de `viaje.operador_id`, que es
de la `0001` y contradice el concepto entero de "viaje sin asignar".

### [CRÍTICO · REINCIDENTE, AGRAVADO] `getSessionTenant` pide en un solo `select` dos columnas que nacen en la `0045` y en la `0046`, y ninguna sonda del arranque mira esas migraciones: si falta cualquiera de las dos, TODOS —superadmin incluido— acaban en `/sin-acceso` con `startup.migraciones {ok:true}`

`src/lib/auth/session.ts:33`
(`.select('tenant_id, rol, nombre, operador_id, avatar_url')`) ·
`supabase/migrations/0045_rls_operador.sql:20-21` (nace `operador_id`) ·
`supabase/migrations/0046_perfil_avatar.sql:10`
(`alter table app_user add column if not exists avatar_url text` — nace
`avatar_url`) · `:40` (el `error` se registra con `logger.warn` y la función
devuelve igual `tenantId: null`, `rol: 'flota_admin'` por los `??`) ·
`src/lib/auth/guard.ts:32-36` (sin `tenantId` y sin `superadmin` →
`/sin-acceso`) · `:41` (`requireSuperadmin` con `rol='flota_admin'` →
`/dashboard` → que rebota otra vez) · `src/lib/cuadra/startup.ts:74-221` (sonda
la 0005, 0011, 0031, 0016, 0017, 0019/0024, 0036/0037/0042, 0033 y 0022:
**ninguna línea toca 0044, 0045, 0046 ni 0047**) · `:222`
(`if (!faltan) logger.info('startup.migraciones', { ok: true })`).

Escenario: el proyecto de Supabase del demo tiene aplicado hasta la `0045` (o se
monta uno nuevo el 5-ago y se paran las migraciones donde sea). PostgREST
contesta `42703 column app_user.avatar_url does not exist` a **toda** sesión.
Entra el contralor con su magic link: sesión válida, y la pantalla que ve es
`/sin-acceso` ("pide tu alta"). Javier entra a `/admin` y acaba en el mismo
sitio, porque el `?? 'flota_admin'` de `:44` lo degradó. El único rastro es una
línea `warn` `session.app_user_error`, indistinguible de "este correo no está
dado de alta"; el arranque, mientras, escribió `{ok: true}`.

Consecuencia: el demo se cae en el primer clic y el diagnóstico en vivo apunta al
lugar equivocado. **Agravado desde la ronda 10**: entonces era una columna de una
migración; hoy son dos, de dos migraciones distintas, y `master` tampoco tiene el
reintento por `esColumnaAusente` que el PR #7 escribió para esto. El repo tiene
el mecanismo bueno a mano (`indices_faltantes` de la 0030, `triggers_faltantes`
de la 0043) y las tres migraciones que condicionan el login y el panel del
encargado entraron sin usarlo.

Causa raíz probable: la sonda de arranque se amplía cuando una migración crea una
FUNCIÓN o un ÍNDICE, y nunca cuando crea una COLUMNA que el `select` de sesión va
a pedir sin falta.

### [CRÍTICO] `master` y el PR #7 usan los ordinales `0046` y `0047` para migraciones distintas: al mergear, una base que ya aplicó las de `master` se salta en silencio las dos de RLS del PR, y queda "totalmente migrada" sin ellas

`supabase/migrations/0046_perfil_avatar.sql` y `0047_operacion_encargado.sql`
(este árbol) vs. `git ls-tree claude/auditoria-10 supabase/migrations/` →
`0046_rls_operador_resto.sql`, `0047_rls_operador_tenant.sql`, y después
`0048`…`0053` · `src/lib/cuadra/startup.ts:76` y `:86` (los mensajes de arranque
dicen literalmente «Corre `supabase db push`», que es el mecanismo declarado) ·
no existe `supabase/config.toml` ni script de migración en `package.json`, y
`startup.ts:206-207` deja constancia de que la `0022` *«se aplicó a mano en
producción y nunca entró al repo»*: el estado real de una base es hoy lo que un
humano recuerda.

Escenario, con valores. La base del demo aplica hoy `0046_perfil_avatar` y
`0047_operacion_encargado`. `supabase db push` lleva su registro en
`supabase_migrations.schema_migrations` con la **versión** = el prefijo numérico,
no el nombre del archivo: quedan las filas `'0046'` y `'0047'`. Se mergea el PR
#7. En el árbol mergeado hay dos archivos que empiezan con `0046` y dos con
`0047`. Los dos desenlaces posibles son malos y ninguno es detectable:

- si el CLI toma la versión ya registrada como aplicada,
  `0046_rls_operador_resto.sql` y `0047_rls_operador_tenant.sql` **nunca corren**
  — y son precisamente las que cierran el ALTO de la ronda 10 (el chofer con
  `for all` sobre `operador`/`cfdi_xml`) y el que le mete `tenant_id` a las
  policies de la `0045`. La base queda con las cuatro tablas de operación y sin
  la RLS que el PR escribió para ellas, reportándose al día;
- si el CLI aborta por versión duplicada, se queda sin poder aplicar **nada**
  —incluidas 0048–0053— en la ventana del demo.

Consecuencia: los 96 arreglos del PR #7 se mergean creyendo que el esquema los
acompaña, y el chofer conserva escritura sobre la tabla de identidades de sus
compañeros y sobre el archivo fiscal de la flota (`cfdi_xml`, CFF 30, 5 años)
con el sistema afirmando que la migración que lo cerraba ya se aplicó. **No pude
ejercerlo**: aquí no hay CLI ni base; lo anterior sale de leer los dos árboles y
el mecanismo declarado en `startup.ts`.

Causa raíz probable: el ordinal es la clave primaria del despliegue de esquema y
se asigna mirando el directorio local, no un registro compartido; con dos ramas
largas vivas eso es una colisión garantizada, no un accidente.

### [ALTO] Las siete FK de la `0047` van a `(id)` a secas —el patrón que la `0028` cerró para todo el esquema— y `pod_viaje_unico` es única GLOBAL: una fila de POD de la flota A bloquea para siempre el POD de un viaje de la flota B

`supabase/migrations/0047_operacion_encargado.sql:65`
(`viaje.unidad_id … references public.unidad(id)`) · `:76`
(`mantenimiento.unidad_id`) · `:100-101` (`incidencia.viaje_id`,
`incidencia.unidad_id`) · `:106` (`incidencia.responsable`) · `:130-131`
(`pod.viaje_id`, `pod.operador_id`) · `:151`
(`create unique index pod_viaje_unico on public.pod (viaje_id)` — sin
`tenant_id`) · contra `supabase/migrations/0028_fks_con_tenant.sql:7-37` (que
escribe el escenario palabra por palabra) y
`supabase/migrations/0027_gasto_img_hash_por_tenant.sql` (que existe justamente
para mover una unicidad global a `(tenant_id, …)`) ·
`src/lib/cuadra/operacion.ts:376-382` (`marcarPodPedido` inserta `viaje_id` tal
cual, sin comprobar de qué tenant es el viaje) ·
`src/app/dashboard/pod/page.tsx:61-63` (`viajeId` sale de `formData`).

Escenario, con valores. El encargado de la flota A tiene sesión válida y arma a
mano el POST del server action de `/dashboard/pod` con
`viajeId = 'bbbb…'`, el uuid de un viaje de la flota B:

```sql
insert into pod (tenant_id, viaje_id, operador_id, estado)
values ('<A>', '<viaje de B>', null, 'pendiente');   -- la base la acepta
```

Pasa la FK (`pod_viaje_id_fkey` solo exige que el viaje exista), pasa
`pod_estado_dominio`, pasa `pod_subido_tiene_archivo`, y no hay nada que compare
`pod.tenant_id` con `viaje.tenant_id`. La fila queda **invisible para las dos
flotas**: `getPods(A)` parte de los viajes de A (`operacion.ts:337`) y ese viaje
no está; `getPods(B)` filtra `.eq('tenant_id', B)` (`:324`) y ese POD no está. B
ve "Nadie lo ha pedido" (`pod/vista.tsx:14`), le pinta el botón "Marcar como
pedido" (`:86`), y al pulsarlo:
`23505 duplicate key value violates unique constraint "pod_viaje_unico"` →
`marcarPodPedido` lanza (`operacion.ts:382`), el server action no lo atrapa, 500.
Para siempre, sobre ese viaje. La misma unicidad, sin atacante, convierte el
doble clic o dos encargados en la misma pantalla en un 500.

Consecuencia: negación de servicio cruzada entre flotas sobre la evidencia de
entrega —el documento con el que se cobra el flete— por una fila que ninguna de
las dos puede ver ni borrar desde el producto. Y las otras seis FK dejan la
puerta equivalente abierta: `crearViaje`/`asignarUnidad`
(`despacho/page.tsx:86,115`) y `crearIncidencia` (`incidencias/page.tsx:88-89`)
escriben `unidadId`/`viajeId` tomados del formulario sin verificar tenant, contra
FK que tampoco lo verifican.

Causa raíz probable: `unique (id, tenant_id)` sobre `viaje` y `operador` ya
existe desde la `0028:71-85` —la FK compuesta estaba disponible— y la `0047` se
escribió en un editor, sin base, copiando la forma corta.

### [ALTO] La policy `operador_sube_su_pod` no mira `tenant_id` ni exige que el archivo exista: el chofer puede declarar entregada su carga escribiendo `estado='subido'` con `storage_path='x'`

`supabase/migrations/0047_operacion_encargado.sql:190-191`
(`create policy operador_sube_su_pod on public.pod for insert with check
(viaje_id in (select id from public.viaje where operador_id =
get_user_operador_id()))` — el `WITH CHECK` no dice **nada** sobre `tenant_id`,
`estado` ni `storage_path`) · `:143-144` (`pod_subido_tiene_archivo`:
`check (estado <> 'subido' or storage_path is not null)` — el único requisito es
que la columna no sea NULL) · `:135` (`estado text not null default 'pendiente'`)
· `src/lib/cuadra/operacion.ts:73` y `:437` (`estado === 'subido'` es lo que
convierte un viaje en "con evidencia") · `src/app/dashboard/pod/vista.tsx:17`
(pinta `StatusPill estado="ok"` → "Recibido").

Escenario, con valores. El chofer de la flota A tiene sesión desde la `0045`
(`/mis-viajes`), así que su JWT sirve contra PostgREST:

```
POST /rest/v1/pod
{"tenant_id":"<A>","viaje_id":"<su propio viaje>","estado":"subido","storage_path":"x"}
```

La base la acepta: el `WITH CHECK` pasa (el viaje es suyo), `pod_estado_dominio`
pasa, `pod_subido_tiene_archivo` pasa porque `'x'` no es NULL. Ningún camino de
la aplicación puede llegar a ese estado —`grep storage_path src/` solo devuelve
`operacion.test.ts:326`, que comprueba que la app NO lo escribe—, así que la
única fila `subido` que puede existir en producción es una forjada. Efecto:
`getPods` la pinta "Recibido" en verde, `getTableroOperacion.podPendientes` baja
uno y `getCargaOperadores.sinPod` de ese chofer baja uno. El encargado deja de
perseguir una entrega de la que no hay ni un byte de prueba. El mismo POST con
`tenant_id` de otra flota también entra, porque el `WITH CHECK` no lo mira.

Consecuencia: la prueba de entrega —lo que respalda la factura del flete y lo que
se enseña cuando el cliente reclama— la puede declarar cumplida la parte
interesada, y el esquema no tiene forma de distinguirla de una real. Para el
contralor es un POD que no existe con el tablero en verde.

Causa raíz probable: la policy se escribió pensando en "¿de quién es este
viaje?" y no en "¿qué columnas puede fijar el que inserta?"; el `CHECK` de
integridad se puso sobre la NULabilidad de una ruta, no sobre que la ruta
apunte a un objeto del bucket.

### [ALTO] El bucket `avatares` es PÚBLICO, escribible por cualquier `authenticated` —el chofer incluido— y la `0046` no le pone `allowed_mime_types` ni `file_size_limit`; el server action tampoco valida nada

`supabase/migrations/0046_perfil_avatar.sql:17-19`
(`insert into storage.buckets (id, name, public) values ('avatares','avatares',true)`
— tres columnas; `file_size_limit` y `allowed_mime_types` se quedan NULL) ·
`:28-30` (`create policy avatares_propio_insert … for insert to authenticated
with check (bucket_id = 'avatares' and (storage.foldername(name))[1] =
auth.uid()::text)` — la única condición es la CARPETA) · `:43-45`
(`avatares_lectura_publica … for select to public`) ·
`src/app/admin/mi-perfil/page.tsx:44-52` (el server action solo comprueba
`archivo instanceof File && archivo.size !== 0`: ni tipo, ni tamaño, y le pasa
`contentType: archivo.type` tal cual) ·
`src/app/admin/mi-perfil/avatar-uploader.tsx:59` (`accept="image/*"` — un
atributo del navegador) · contra `0039_bucket_comprobantes.sql:30-35` y
`0008_storage_bucket.sql`, los dos buckets anteriores, **privados y sin ninguna
policy**, donde solo escribe el service-role.

Escenario, con valores. Un `app_user` con `rol='operador'` (el rol que la `0045`
existe para contener; no tiene pantalla de perfil en ningún panel) usa su JWT:

```
POST /storage/v1/object/avatares/<su auth.uid>/carga.zip
Content-Type: application/zip     ← 40 MB de lo que sea
```

`avatares_propio_insert` pasa: el primer segmento de la ruta es su `auth.uid()`.
Nada más se comprueba, porque el bucket no declara MIME permitidos ni tamaño
máximo, y el único límite que queda es el global del proyecto de Supabase, que
ninguna línea del repo fija ni documenta. El objeto queda con URL pública
permanente por `avatares_lectura_publica`, servido desde el dominio de Storage
del proyecto de Likida, y se puede repetir con `carga2.zip`, `carga3.zip`…

Consecuencia: un alojamiento de archivos anónimo, gratis y con la marca de
Likida detrás, más la factura de storage y egress; y la invariante "un avatar es
una imagen chica" no la impone nadie —ni el `accept` del cliente, ni el server
action, ni el bucket—. Es el primer bucket público del repo y el primero que le
da INSERT directo a `authenticated`, y llegó sin ninguno de los dos límites que
`storage.buckets` ofrece para eso.

Causa raíz probable: el `insert into storage.buckets` se copió de la `0008`/`0039`,
que son privadas y sin policies, y al volverlo público nadie revisó qué columnas
de esa tabla dejaban de ser opcionales.

### [ALTO · REINCIDENTE] La RLS de la `0045` sigue sin gobernar ningún camino real, y la `0046` repitió el patrón: sus tres policies de storage tampoco gobiernan la única subida que existe

`supabase/migrations/0045_rls_operador.sql:52-59` (las tres policies del chofer) ·
`src/app/api/export/liquidaciones/route.ts:17-25` (única comprobación:
`if (!s || !s.tenantId) → 401`; después `supabaseAdmin()` —service-role, con
BYPASSRLS— y `.limit(5000)`) · `src/app/api/export/pdf/[id]/route.ts:32-45` (mismo
patrón) · `src/proxy.ts:81`
(`matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']`: `/api` queda
fuera) · `src/lib/auth/permisos.ts:17,21-22` (`puedeExportar` existe y excluye a
`operador`; ninguna ruta de API lo consulta) ·
`supabase/migrations/0046_perfil_avatar.sql:28-40` (las tres policies
`avatares_propio_*`) vs. `src/app/admin/mi-perfil/page.tsx:48-52`
(`supabaseAdmin().storage.from('avatares').upload(...)` — service-role, que las
salta) · `supabase/verificaciones.sql:1022-1066` (el bloque 27 las demuestra con
`set local role authenticated`, un camino que el producto no recorre; igual que
el bloque 26 con la `0045`).

Escenario: un `app_user` con `rol='operador'`, flota A, sesión válida, pide
`GET /api/export/liquidaciones` con su cookie. No pasa por el proxy (excluido del
matcher), no pasa por `requireSessionTenant`, y la consulta corre con
service-role, que ignora `operador_ve_su_viaje` por completo: sale un CSV con
hasta 5,000 liquidaciones de la flota entera —folio, nombre de cada compañero,
comprobado, anticipo, diferencia y desglose—. Verificado presente hoy: los dos
endpoints siguen llamando a `getSessionTenant` directo y sin mirar `s.rol`.

Consecuencia: se puede demostrar la garantía en SQL (bloques 26 y 27, con salida
real copiada) y ser falsa por HTTP. Lo anoto en mi rubro por lo que le toca al
esquema: dos migraciones seguidas escribieron su control en la única puerta que
la aplicación no usa, y la verificación se diseñó para la puerta, no para el
camino.

Causa raíz probable: la RLS se diseñó como el candado en la `0001` mientras el
100% de las lecturas y escrituras del panel se hacen con la llave que la salta.

### [ALTO · REINCIDENTE] `app_user.operador_id` sigue siendo la única FK de identidad sin `tenant_id`, y las tres policies que la usan tampoco lo llevan

`supabase/migrations/0045_rls_operador.sql:20-21`
(`add column if not exists operador_id uuid references public.operador(id) on
delete set null` — FK simple) · `:31-34` (`get_user_operador_id()` no compara
tenants) · `:52-59` (`using (operador_id = get_user_operador_id())`, sin un solo
predicado sobre `tenant_id`) · `supabase/migrations/0028_fks_con_tenant.sql:71-85`
(`operador_id_tenant_key unique (id, tenant_id)` ya existe: la FK compuesta está
disponible) · `src/lib/auth/provisionar.ts:28-30` y `src/app/admin/usuarios/nuevo/`
(el único escritor de `app_user` no escribe `operador_id`: ligarlo es forzosamente
manual, en la consola).

Escenario, con valores: `update app_user set operador_id = '<uuid de un operador
de la flota B>' where email = 'chofer@flota-a.com'`. La base lo acepta —la FK
solo exige que el operador exista—. Ese chofer entra a `/mis-viajes`,
`requireOperador` (`guard.ts:52`) solo exige `operadorId` no nulo, y las policies
le devuelven los viajes, gastos y liquidaciones de la flota B. Confirmado
presente en este árbol, sin cambios respecto de la ronda 10.

Consecuencia: fuga entre flotas —el único daño que este esquema declara
inaceptable desde la `0001`— por un `UPDATE` de una columna que la aplicación no
sabe escribir, y sin rastro: para la base es una fila válida.

Causa raíz probable: la columna se agregó pensando en la RLS y no en la clave.

### [ALTO · REINCIDENTE] El chofer conserva `tenant_data` con `for all` sobre seis tablas; la `0047` acertó al excluirlo de las suyas y eso deja aún más claro lo que falta

`supabase/migrations/0045_rls_operador.sql:39` (el `foreach` solo recorre
`viaje, gasto, liquidacion`) · `supabase/migrations/0001_init.sql:110` (la lista
real son siete: `terminal, operador, politica_gasto, viaje, gasto, liquidacion,
wa_conversacion`) · `supabase/migrations/0003_costos.sql:24` (`llm_costo`) ·
`supabase/migrations/0009_xml_crudo_efos.sql:15` (`cfdi_xml`) ·
`supabase/migrations/0047_operacion_encargado.sql:174-175` (aquí SÍ va
`and not is_operador()`).

Escenario, con valores: el chofer de la flota A, con el mismo JWT que le da
`/mis-viajes`, hace `PATCH /rest/v1/operador?id=eq.<uuid del compañero>` con
`{"activo": false}`. `tenant_data` sobre `operador` sigue siendo `for all` con
`using (tenant_id = any(get_user_tenant_ids()))` y su `tenant_id` es A: la base
lo acepta. Desde ahí `resolveOperador` (`conv.ts:65`) filtra `.eq('activo', true)`,
no lo encuentra, y los mensajes de WhatsApp de ese compañero se contestan "no te
tengo registrado". La misma llave sirve para
`DELETE /rest/v1/cfdi_xml?tenant_id=eq.<A>`, que borra el XML crudo que la `0009`
guarda para el art. 30 del CFF (5 años).

Consecuencia: sabotaje interno sin log y pérdida del archivo fiscal de la flota.
Lo mantengo como ALTO porque la `0047` demuestra que el criterio correcto ya
está escrito y aplicado a las tablas nuevas: lo que falta es aplicarlo hacia
atrás.

Causa raíz probable: el inventario de qué tablas cubre `tenant_data` se hizo
leyendo la `0001` y no `grep "create policy tenant_data"`, que hoy devuelve
**once** tablas en seis migraciones.

### [MEDIO] La `0047` no es idempotente ni deja escrita su reversión — y es la migración que más objetos crea de golpe; la `0046`, a dos archivos de distancia, sí lo hace bien

`supabase/migrations/0047_operacion_encargado.sql:172-176` (`create policy
tenant_data` dentro del `do $$`, sin `drop policy if exists` delante) · `:183-185`
· `:187-188` · `:190-191` · todo lo demás del archivo SÍ es idempotente
(`create table if not exists` en `:31,73,97,127`, `create index if not exists`,
`add column if not exists` en `:64-65`) · contra
`supabase/migrations/0046_perfil_avatar.sql:27,32,37,42`
(`drop policy if exists` + `create policy`, con el motivo escrito en `:24-26`) ·
y contra `supabase/migrations/0028_fks_con_tenant.sql:59-60` y
`0025_dominios_check.sql:70-71`, que sí escriben la reversión.

Escenario, con valores: se re-aplica la `0047` sobre una base donde ya corrió (un
`db push` repetido, un `db reset` parcial, o el merge del CRÍTICO de arriba). Las
cuatro `create table if not exists` no hacen nada, los índices tampoco, y en
`:172` el `execute format` truena con
`42710 policy "tenant_data" for table "unidad" already exists`. Peor todavía si
el `do $$` de `:157-164` ya volvió a correr `enable row level security`: se sale a
la mitad, y quien lo destrabe bajo presión no tiene escrita ni una línea de cómo
revertir 4 tablas, 1 columna en `viaje`, 5 índices y 6 policies.

Consecuencia: deuda; el riesgo real es que la reversión se improvise la
madrugada del 6-ago sobre la migración más grande del repo. **REINCIDENTE** en su
forma: es el mismo BAJO que la ronda 10 levantó sobre la `0045`, repetido en la
migración siguiente y con cuatro veces más superficie.

Causa raíz probable: `create policy` es la única sentencia de las que usa el
archivo que no acepta `if not exists`, y el autor la escribió con la misma
confianza que las demás.

### [MEDIO · REINCIDENTE] `rol='operador'` con `operador_id` NULL sigue siendo un estado que la base acepta, que el producto no sabe usar, y que es el ÚNICO que la aplicación sabe crear

`supabase/migrations/0045_rls_operador.sql:23-24` (el comentario declara la
invariante —*«Solo se llena cuando rol = 'operador' … NULL para los otros 4
roles»*— y no hay `CHECK` que la imponga en ninguna de las dos direcciones) ·
`src/lib/auth/provisionar.ts:28-30` (el `insert` escribe `id, tenant_id, email,
nombre, rol`: nunca `operador_id`) · `src/lib/auth/guard.ts:52`
(`if (!s.operadorId) redirect('/sin-acceso')`).

Escenario: en el ensayo, Javier da de alta un chofer desde `/admin/usuarios/nuevo`
con rol "operador". Queda `rol='operador', operador_id=null` y la base no objeta.
El chofer entra con su magic link y `requireOperador` lo manda a `/sin-acceso`,
la pantalla que dice "pide tu alta" — a alguien a quien acaban de dar de alta.
Verificado sin cambios en este árbol.

Consecuencia: `/mis-viajes` es indemostrable con las herramientas del propio
producto y el fallo se presenta como "no tienes acceso" en vez de "falta ligar tu
cuenta". Si el demo enseña el panel del chofer, se cae ahí.

Causa raíz probable: falta el `CHECK ((rol='operador') = (operador_id is not
null))` que obligaría a que la columna y el rol se noten a la vez.

### [MEDIO · REINCIDENTE] `triggers_faltantes` sonda por NOMBRE, así que no distingue el trigger de la `0037` del de la `0042`

`supabase/migrations/0043_triggers_faltantes.sql:31`
(`where n.nspname = 'public' and t.tgname = e and not t.tgisinternal` — solo el
nombre) · `supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql:18-31`
(hace `drop trigger` + `create trigger` con **el mismo nombre**
`trg_gasto_no_tras_liquidar_update`, cambiando solo el `when`) ·
`src/lib/cuadra/startup.ts:170` (el mensaje dice "migraciones 0037/0042" para ese
único nombre).

Escenario: la base tiene el trigger de la `0037` (aplicado en la ronda 8) y la
`0042` no entra. `triggers_faltantes(['trg_gasto_no_tras_liquidar',
'trg_gasto_no_tras_liquidar_update'])` devuelve `{}` porque los dos nombres
existen, el arranque escribe `{ok:true}`, y un
`UPDATE gasto SET fecha = '2026-08-02' WHERE id = …` posterior a la liquidación
vuelve a pasar sin `CU001`.

Consecuencia: la sonda que se construyó para que el arranque dejara de mentir
sobre estos dos triggers puede seguir mintiendo sobre el que el propio arreglo
modificó. Sin cambios respecto de la ronda 10.

Causa raíz probable: una migración que **reemplaza** un objeto conservando su
nombre no es detectable por una sonda de existencia; haría falta mirar
`pg_get_triggerdef`/`tgqual`.

### [MEDIO] Las dos unicidades que la `0047` sí puso son correctas, y ningún escritor las maneja: un `23505` sale como 500, no como mensaje

`supabase/migrations/0047_operacion_encargado.sql:51`
(`unidad_economico_unico unique (tenant_id, numero_economico)` — correcta, por
tenant) · `:151` (`pod_viaje_unico`) ·
`src/lib/cuadra/operacion.ts:512-524` (`crearUnidad`: `if (error) throw`) ·
`:376-382` (`marcarPodPedido`: idem) ·
`src/app/dashboard/unidades/page.tsx:70-90` y
`src/app/dashboard/pod/page.tsx:58-66` (ninguno de los dos server actions envuelve
la escritura ni distingue el código de error).

Escenario, con valores: el encargado da de alta la unidad `C2-08`; más tarde
—o el capturista de al lado— la vuelve a dar de alta con el mismo número
económico. La base hace lo correcto:
`23505 duplicate key value violates unique constraint "unidad_economico_unico"`.
`crearUnidad` lanza (`operacion.ts:520`), el server action no lo atrapa y la
pantalla se cae con un `Digest`, en vez de decir "esa unidad ya existe". Igual
con el POD: dos encargados con `/dashboard/pod` abierto pulsan "Marcar como
pedido" sobre el mismo viaje y el segundo se lleva el 500.

Consecuencia: la restricción de la base —que es la buena— se le presenta al
usuario como una caída del producto. En el demo, capturar dos veces el mismo
económico rompe la pantalla de unidades.

Causa raíz probable: `operacion.ts` son las primeras escrituras administrativas
del repo (lo dice en `:450-457`) y se escribieron con `if (error) throw` sin
mirar `error.code`, que es lo único que distingue "el usuario repitió un dato" de
"la base se cayó".

### [BAJO] Los cuatro enteros de la `0047` no tienen dominio: `km_actual`, `anio`, `km_servicio` y `sla_horas` aceptan negativos y disparates

`supabase/migrations/0047_operacion_encargado.sql:38` (`anio int`) · `:40`
(`km_actual int`) · `:80` (`km_servicio int`) · `:107` (`sla_horas int`) — los
cuatro sin `CHECK`, en una migración que sí puso seis `CHECK` de dominio de texto
· `src/app/dashboard/unidades/page.tsx:79-80` (la única validación es
`Number.isInteger(anio)`: `-3` y `999999` pasan) ·
`src/app/dashboard/incidencias/page.tsx:81` (la app sí exige `slaHoras >= 1`, la
base no) · `src/lib/cuadra/operacion.ts:286`
(`slaVencido: sla !== null && i.estado !== 'resuelta' && horas > sla`).

Escenario, con valores: `insert into incidencia (tenant_id, tipo, sla_horas)
values ('<A>','averia',-5)` desde la consola de Supabase —que es como se cargan
los datos hoy, según el encabezado de la propia `0025:14-16`—. La base la acepta.
`getIncidencias` calcula `horas = 0` en el instante de crearla y `0 > -5` es
cierto: nace **con el SLA vencido**, en rojo, en la pantalla del encargado. El
mismo `insert` con `anio = -3` pinta "-3" como año del camión.

Consecuencia: menor, pero es exactamente el hueco que la `0025` existe para
tapar; el criterio de aquella migración (no poner `CHECK (monto > 0)` porque un
dato malo VISIBLE vale más que uno ausente) no aplica a un SLA ni a un año, que
no vienen de un OCR sino de un formulario.

Causa raíz probable: la `0047` puso dominio a todo lo que es texto y a nada de lo
que es número.

### [BAJO · REINCIDENTE] `app_user.id` no tiene FK a `auth.users` y `provisionarUsuario` no es atómico

`supabase/migrations/0001_init.sql:16` (`id uuid primary key, -- = auth.users.id`
— un comentario, no una restricción; `grep "auth.users" supabase/` devuelve esta
línea y ninguna más) · `:18` (`email text not null unique`) ·
`src/lib/auth/provisionar.ts:25-31` (`createUser` primero, `insert` en `app_user`
después, sin transacción ni compensación).

Escenario: se borra un usuario de prueba desde la consola de Auth; su fila de
`app_user` sobrevive porque nada la ata. Se vuelve a dar de alta el mismo correo:
`createUser` funciona y devuelve un `id` nuevo, y el `insert` truena con
`23505 … "app_user_email_key"`. Queda un usuario de Auth sin fila en `app_user`:
pide su magic link, obtiene sesión válida, y `getSessionTenant` le devuelve
`tenantId: null` → `/sin-acceso` para siempre. Sin cambios en este árbol.

Consecuencia: deuda de operación; el alta hay que destrabarla a mano en SQL y el
síntoma que ve la persona no apunta a la causa.

Causa raíz probable: la relación 1-a-1 con `auth.users` vive en un comentario
desde la `0001` y nunca se convirtió en `references auth.users(id) on delete
cascade`.

## Lo que revisé y está bien

- **Los `CHECK` de texto de la `0047` están bien pensados y son de los mejores del
  repo.** `unidad_estado_dominio:46-47`, `mantenimiento_tipo_dominio:83-84`,
  `mantenimiento_estado_dominio:85-86`, `incidencia_tipo_dominio:110-111`,
  `incidencia_prioridad_dominio:112-113`, `incidencia_estado_dominio:114-115`.
  Y los dos de coherencia —`mantenimiento_cierre_coherente:90-91` e
  `incidencia_cierre_coherente:116-117`, con la forma `(estado = 'cerrada') =
  (cerrada_en is not null)`, que cubre las DOS direcciones— son la clase de
  restricción que este rubro pide: `cambiarEstadoIncidencia`
  (`operacion.ts:560-567`) existe explícitamente porque la base no la deja
  olvidarse, y el comentario de `:551-558` lo dice.
- **`unidad_economico_unico unique (tenant_id, numero_economico)`
  (`0047:51`) es la unicidad hecha bien**, con el razonamiento escrito
  (`:48-50`: dos flotas pueden tener cada una su C2-08). Es el contraste exacto
  con `pod_viaje_unico`, que en el mismo archivo la olvidó.
- **La `0047` excluye al chofer de sus tres tablas de oficina**
  (`:174-175`, `and not is_operador()`), que es la lección de la `0045` aplicada
  bien y a tiempo; y la excepción de `pod` está razonada en `:180-182`. Lo que
  falla es el `WITH CHECK` de la excepción, no el criterio.
- **`viaje.unidad_id` nace NULLABLE a propósito** (`0047:64-65`) y el comentario
  de `:67-68` declara por qué. Todo el archivo es aditivo: ninguna tabla existente
  pierde una columna ni cambia un tipo, así que un despliegue viejo sigue
  corriendo. Eso es correcto y no lo es por accidente.
- **La `0046` es idempotente de verdad** (`:27,32,37,42`: `drop policy if
  exists` + `create policy`, con el motivo escrito en `:24-26`) y usa
  `add column if not exists`. Es lo que la `0047` debió copiar.
- **Los `CHECK` de dominio de la `0025` siguen intactos.** Ninguna de las
  migraciones `0044`–`0047` toca `gasto_concepto_dominio`,
  `viaje_estatus_dominio`, `liquidacion_estatus_dominio`, `gasto_monto_no_nan`
  ni `viaje_intake_pendientes_no_negativo`, y los tipos de `src/types/cuadra.ts`
  (`ConceptoGasto:20-25`, `EstadoSat:27`, `EstatusLiquidacion:106`) siguen
  empatando valor por valor con lo que la base acepta. Busqué un tipo de
  TypeScript más estricto que su columna en `operacion.ts` y **no lo hay**: los
  campos que declara `string` (`UnidadRow.numeroEconomico:143`,
  `IncidenciaRow.abiertaEn:246`, `CargaOperador.nombre:29`) corresponden a
  columnas `not null`. El desajuste de este módulo va en la dirección contraria
  —el código asume nullable lo que la base no deja— y es el CRÍTICO 1.
- **La `0044` extendió el dominio de `app_user.rol` bien**, dropeando y
  recreando dentro de un `do $$ … if exists` (`:12-24`), con el nuevo valor como
  superconjunto estricto del de la `0025:138-140`: ninguna fila existente puede
  violarla. `mi-perfil/page.tsx:10` conoce los cinco roles.
- **`migraciones_verificadas.test.ts` sí obligó a la `0046` y a la `0047` a
  tomar una decisión**: existen los bloques 27 (`verificaciones.sql:1022`) y 28
  (`:1068`), con salida real fechada el 3-ago. Lo que esos bloques prueban no es
  lo que este reporte cuestiona —el 28 prueba que el chofer NO LEE las cuatro
  tablas, y es cierto; ninguno de los dos prueba qué puede ESCRIBIR, ni con qué
  `tenant_id`—, pero la mecánica funcionó y no la reporto.
- **`gasto.ocr_raw`, `politica_gasto`, `wa_mensaje_procesado` sin `tenant_id` y
  el dominio de `viaje.estatus`**: verificados sin cambios, no los reporto (son
  trampas conocidas).

## Lo que NO alcancé a revisar

- **No hay base contra la cual ejercer NADA.** Este entorno no tiene Supabase,
  ni Postgres, ni el CLI. Todo lo de arriba sale de leer las 47 migraciones, las
  policies, `verificaciones.sql` y los llamadores en `src/`. No corrí un
  `select`, no apliqué una migración, no reproduje un `23502` ni un `23505`
  contra una base real: los SQLSTATE que cito salen del texto de la restricción,
  no de haberla golpeado. Los bloques 27 y 28 de `verificaciones.sql` declaran
  haberse corrido el 3-ago y les creo por lo que dicen, no porque yo los haya
  visto correr.
- **El comportamiento exacto de `supabase db push` ante dos archivos con el
  mismo ordinal** (CRÍTICO 3) no lo pude ejercer. Describí los dos desenlaces
  posibles; cuál ocurre depende de la versión del CLI y del contenido de
  `supabase_migrations.schema_migrations`, que aquí no existe.
- **`liquidacion` sigue sin trigger de "no se reescribe tras emitida"**, al
  revés que `gasto` (`0036`/`0037`/`0042`). Un `flota_admin` o un `contador` con
  su JWT puede `PATCH /rest/v1/liquidacion` sobre `total_comprobado`. No lo elevo
  a hallazgo por segunda ronda seguida —es la misma deuda de la `0001` que ya
  cuenta el ALTO reincidente de `tenant_data`—, pero es el siguiente sitio donde
  va a doler.
- **Las policies del bucket `liquidaciones`** (`0008`) siguen sin bloque de
  verificación; pendiente arrastrado desde la ronda 5.
- **`analytics.ts` (386 líneas de diff en esta ronda)** solo lo miré donde toca
  columnas que la `0047` creó — que es en ningún sitio. Sus consultas contra
  `viaje`/`gasto`/`liquidacion` no las revisé columna por columna.
- **`mantenimiento` no tiene un solo escritor en `src/`** (`grep from('mantenimiento')`
  devuelve una lectura, `operacion.ts:170`) y `unidad.activo` tampoco: nada la
  pone en `false`, así que `.eq('activo', true)` de `operacion.ts:424` es hoy un
  filtro que no filtra. Son columnas y tablas nacidas muertas, no un estado
  imposible; lo dejo anotado como deuda y no como hallazgo.
- **Nota de proceso**: a mitad de la ronda, otro agente modificó
  `src/lib/auth/visibilidad.ts` en este mismo árbol y la compuerta pasó de
  `exit 0` a **2 pruebas fallando** (`visibilidad.test.ts:86,88`). No es de mi
  rubro y no toqué nada, pero la línea base de la MAPA ya no describe este árbol.
