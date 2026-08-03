# Modelo de datos y esquema — auditoría 10

**Nota: 5/10** (antes 8). Razón del movimiento: **deuda que cobró factura**. La
deuda es de la `0001`: la RLS de este esquema es **por tenant, nunca por rol**, y
el panel entero se sirve con `service_role` (que salta RLS por definición), así
que hasta hoy la RLS no gobernaba ni un solo camino de lectura real — y no se
notaba porque todos los usuarios veían lo mismo. La `0045` es la primera vez que
el producto necesita que un usuario vea MENOS que su tenant, y ahí la deuda pasó
la factura completa: la migración impone la restricción en la única puerta que
la aplicación no usa. A la vez, el modelo de identidad que llegó con la `0045`
(`app_user.operador_id`) es la primera clave foránea del repo que rompe el
patrón que la `0028` estableció para todas las demás — sin `tenant_id` en la
clave ni en la policy.

Anclado a `6d4ea7a14052044cf393cf90aea9e44ade5511c0`.

El ALTO de la ronda 9 **cerró de verdad**: la `0042:28` mete `fecha` al `when`
de la MISMA función `gasto_no_tras_liquidar()` y el bloque 24 de
`verificaciones.sql` lo ejercita. No es reincidente. El núcleo del dinero
(dominios de la `0025`, unicidades de la `0019`/`0024`/`0027`/`0029`, triggers
`0036`/`0037`/`0042`) sigue en nivel 8. Todo lo que se agregó esta ronda para
roles e identidad está en nivel 4, y es lo que arrastra la nota.

Riesgo mayor del rubro hoy: **la `0045` protege una puerta que casi nadie usa**
— `/api/export/liquidaciones` y `/api/export/pdf/[id]` leen las mismas tres
tablas con `service_role`, fuera del matcher del proxy y sin mirar el rol, así
que un `rol='operador'` con sesión sigue bajándose el CSV de la flota entera.
(El camino gemelo por `/dashboard` se cerró a media auditoría en
`guard.ts:41`; los dos endpoints siguen abiertos.)

## Hallazgos

### [CRÍTICO] La RLS del chofer (`0045`) no gobierna los exports: `/api/export/*` lee las mismas tablas con `service_role`, fuera del matcher del proxy y sin mirar el rol

`supabase/migrations/0045_rls_operador.sql:5-10` (la migración declara su
propósito: *«Repetirlo para `operador` sería un IDOR: un chofer con sesión vería
los viajes de TODA la flota… y la UI de /mis-viajes sería el único candado — el
que un token robado se salta sin pasar por el navegador»*) ·
`src/app/api/export/liquidaciones/route.ts:17-26` (**única** comprobación:
`if (!s || !s.tenantId) → 401`; después `supabaseAdmin()` —`service_role`, con
`BYPASSRLS`— y `limit(5000)`) · `src/app/api/export/pdf/[id]/route.ts:32-46`
(mismo patrón) · `src/proxy.ts:81` (el matcher es
`'/((?!api|_next/static|_next/image|favicon.ico).*)'`: `/api` queda **fuera** de
la primera capa) · `src/lib/auth/permisos.ts:17` (`puedeExportar` existe y
excluye a `operador`, pero `grep` confirma que sus **únicos** llamadores son
`dashboard/page.tsx:222` y `dashboard/[id]/page.tsx:40,95` — pintar botones;
ninguna ruta de API lo consulta).

Escenario: se da de alta un chofer por la propia consola
(`/admin/usuarios/nuevo`, `rol='operador'`, flota A). Entra con su magic link:
sesión válida y `app_user.tenant_id = A`. Pide
`GET /api/export/liquidaciones` con esa cookie: no pasa por el proxy (excluido
del matcher), no pasa por `requireSessionTenant`, y la consulta corre con
`service_role`, que ignora `operador_ve_su_viaje` por completo. Sale un CSV con
hasta 5,000 liquidaciones de la flota entera — folio, **nombre de cada
compañero**, comprobado, anticipo, diferencia y el desglose de diferencias —
sin que ninguna línea compruebe `puedeExportar('operador')`, que devuelve
`false`. Con el `id` de cualquiera de esas liquidaciones,
`GET /api/export/pdf/<id>` le devuelve además la URL firmada del PDF del
contralor.

Consecuencia: el chofer que la `0045` acaba de acotar a «solo sus viajes»
descarga el expediente completo de sus compañeros. El bloque 26 de
`verificaciones.sql:986-1020` va a dar `1/1/1` y ser cierto, porque prueba
PostgREST con `set local role authenticated` — un camino que estos endpoints no
usan. La garantía se puede demostrar en SQL y ser falsa por HTTP.

**Nota de la ronda:** durante esta auditoría se cerró la mitad de este hallazgo
en `src/lib/auth/guard.ts:41` (`if (s.rol === 'operador') redirect('/mis-viajes')`),
lo que tapa `/dashboard` y `/dashboard/[id]` — el camino que el chofer recorría
por default. Verifiqué que **los dos endpoints de `/api/export/` siguen sin
tocarse**: no llaman a `requireSessionTenant`, sino a `getSessionTenant`
directo, así que la parte de arriba está viva tal cual.

Causa raíz probable: la RLS se diseñó como el candado (`0001`) mientras el
100% de las lecturas del panel se hacen con la llave que la salta, y nadie
reintrodujo el rol en el lado del `service_role`.

### [CRÍTICO] Nada sonda la `0045`, y si no está aplicada el `select` de `operador_id` deja a TODOS fuera del panel — incluido el superadmin — con un `warn` y `startup: ok:true`

`src/lib/auth/session.ts:31` (`.select('tenant_id, rol, nombre, operador_id')`:
`operador_id` **nace** en la `0045:20-21`) · `:38-45` (el error se registra con
`logger.warn` y la función devuelve igual `tenantId: null`, `rol: 'flota_admin'`
por el `??`) · `src/lib/auth/guard.ts:32-35` (sin `tenantId` y sin rol
`superadmin` → `redirect('/sin-acceso')`) · `:62-66` (`requireSuperadmin` con
`rol='flota_admin'` → `/dashboard` → que rebota otra vez a `/sin-acceso`) ·
`src/lib/cuadra/startup.ts:74-185` (sonda 0005, 0011, 0016, 0017, 0022, 0030,
0031, 0033, 0036/0037/0042 y dos índices: **ninguna línea toca la `0044` ni la
`0045`**) · `:222` (`if (!faltan) logger.info('startup.migraciones', {ok:true})`).

Escenario: el proyecto de Supabase del demo tiene aplicadas las migraciones
hasta la `0043` y la `0045` se queda sin aplicar (un `db push` cortado, un
proyecto nuevo montado el 5-ago, o el mismo caso literal que la `0022` ya vivió
según `startup.ts:200-207`). PostgREST responde
`42703 column app_user.operador_id does not exist` a **toda** sesión. Entra el
contralor en la sala: magic link correcto, sesión creada, y la pantalla que ve
es `/sin-acceso` diciéndole que pida su alta. Javier intenta entrar a `/admin` y
también acaba en `/sin-acceso`, porque el `??` lo degradó a `flota_admin`. El
arranque, mientras tanto, escribió `{ok: true}`.

Consecuencia: el demo del 6-ago se cae en el primer clic, y el único rastro
para diagnosticarlo en vivo es una línea `warn` con
`session.app_user_error` — indistinguible de «este correo no está dado de
alta», que es exactamente lo que la pantalla le dice a quien mira.

Causa raíz probable: el repo tiene un mecanismo maduro para «¿está aplicada la
00XX?» (`indices_faltantes` 0030, `triggers_faltantes` 0043) y la migración que
condiciona **el login entero** entró sin usarlo; además `getSessionTenant`
colapsa «el esquema no es el que creo» con «este usuario no tiene alta».

### [ALTO] `app_user.operador_id` es la única FK de identidad del repo sin `tenant_id`, y la policy que la usa tampoco lo lleva: un UUID mal pegado da lectura cruzada entre flotas

`supabase/migrations/0045_rls_operador.sql:20-21`
(`add column ... operador_id uuid references public.operador(id) on delete set
null` — FK simple) · `:31-34` (`get_user_operador_id()` devuelve el
`operador_id` sin comparar tenants) · `:52-59` (las tres policies:
`using (operador_id = get_user_operador_id())`, sin un solo predicado sobre
`tenant_id`) · `supabase/migrations/0028_fks_con_tenant.sql:7-36` (la migración
que estableció lo contrario para las 22 FK del esquema, con este escenario
escrito palabra por palabra: *«la verificación de la FK no mira tenant, y además
ignora la RLS»*) · `src/app/admin/usuarios/nuevo/page.tsx:26-36` y
`src/lib/auth/provisionar.ts:28-30` (el **único** escritor de `app_user` de todo
el repo NO escribe `operador_id`: `grep "from('app_user')"` da tres resultados y
dos son lecturas) · `supabase/verificaciones.sql:986-1020` (el bloque 26 siembra
los dos choferes en el MISMO tenant: nunca ejercita el caso cruzado).

Escenario: como ningún camino de la aplicación llena `operador_id`, ligar la
cuenta de un chofer es forzosamente manual, en la consola de Supabase. Se pega
el UUID equivocado — el de un chofer de la flota B, que está a tres filas en la
misma tabla `operador`:

```sql
update app_user set operador_id = '<uuid de un operador de la flota B>'
where email = 'chofer@flota-a.com';   -- la base lo acepta: la FK solo exige que el operador exista
```

Sale: ese chofer entra a `/mis-viajes`, `requireOperador` lo deja pasar
(`guard.ts:48-54` solo exige `operadorId` no nulo), y la policy
`operador_ve_su_viaje` le devuelve los viajes, gastos y liquidaciones de la
flota B — con folio, fecha, comprobado y estatus. No hay `tenant_id` en ninguna
de las tres policies que lo pueda frenar, y `mis-viajes/page.tsx:16-22` declara
por escrito que confía en la base para eso: *«un `.eq()` que se le olvide a
alguien en este archivo seguiría sin filtrar de más: la base ya no tiene los
viajes de otro chofer que enseñarle»*.

Consecuencia: fuga entre flotas, el único daño que este esquema declara
inaceptable desde la `0001`, por un `UPDATE` de una columna que la aplicación
no sabe escribir. Y no queda rastro: para la base es una fila perfectamente
válida.

Causa raíz probable: la columna se agregó pensando en la RLS y no en la clave;
`unique (id, tenant_id)` sobre `operador` ya existe desde la `0028`, así que la
FK compuesta estaba disponible y no se usó.

### [ALTO] La `0045` sacó al chofer de tres tablas y lo dejó con `for all` en las otras seis — su propio comentario cuenta cuatro y omite `cfdi_xml` y `llm_costo`

`supabase/migrations/0045_rls_operador.sql:15-17` (*«Las otras 4 tablas de
`tenant_data` (terminal, politica_gasto, wa_conversacion — y `operador` misma)
no cambian: el chofer no tiene vista de esas»*) · `:39` (el `foreach` solo
recorre `viaje, gasto, liquidacion`) · `supabase/migrations/0001_init.sql:110`
(la lista real son SIETE tablas: `terminal, operador, politica_gasto, viaje,
gasto, liquidacion, wa_conversacion`) · `supabase/migrations/0003_costos.sql:23-26`
y `supabase/migrations/0009_xml_crudo_efos.sql:14-17` (dos `tenant_data` MÁS,
`llm_costo` y `cfdi_xml`, que el inventario de la `0045` no menciona) ·
`src/lib/cuadra/conv.ts:60-66` (`resolveOperador` filtra `.eq('activo', true)`
y NO por tenant: es quien determina de qué flota es el dinero).

Escenario: el chofer de la flota A tiene sesión (la misma que le da
`/mis-viajes`) y su JWT sirve para PostgREST directo. `tenant_data` sobre
`operador` sigue siendo `for all` con `using (tenant_id = any(get_user_tenant_ids()))`,
y su `app_user.tenant_id` es A:

```
PATCH /rest/v1/operador?id=eq.<uuid del compañero>   {"activo": false}
```

La base lo acepta. Desde ese momento `resolveOperador` no encuentra al
compañero (`.eq('activo', true)`) y sus mensajes de WhatsApp se contestan como
«no te tengo registrado»: sus tickets dejan de archivarse y su viaje no se puede
liquidar. Ninguna pantalla del producto ofrece ese botón — la base era el único
control posible. La misma llave sirve para
`DELETE /rest/v1/cfdi_xml?tenant_id=eq.<A>`, que borra el XML crudo de los CFDI
de la flota entera: la evidencia que la `0009` guarda explícitamente para el
art. 30 del CFF, 5 años.

Consecuencia: el primer rol del producto que no es de confianza recibió, en la
misma migración que lo acota, escritura total sobre la tabla de identidades de
sus compañeros y sobre el archivo fiscal de la flota. Para el contralor es
sabotaje interno sin log; para la flota es una pérdida de comprobantes que solo
se descubre en una revisión del SAT.

Causa raíz probable: el inventario de qué tablas cubre `tenant_data` se hizo
leyendo la `0001` y no `grep "create policy tenant_data"`, que devuelve nueve
tablas en cuatro migraciones distintas.

### [MEDIO] `triggers_faltantes` sonda por NOMBRE: no distingue el trigger de la `0037` del de la `0042`, así que el cierre del ALTO de la ronda 9 no es verificable en una base desplegada

`supabase/migrations/0043_triggers_faltantes.sql:29-32` (`where n.nspname =
'public' and t.tgname = e and not t.tgisinternal` — solo el nombre) ·
`supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql:18-30` (hace
`drop trigger` + `create trigger` con **el mismo nombre**
`trg_gasto_no_tras_liquidar_update`, cambiando solo el `when`) ·
`src/lib/cuadra/startup.ts:166-172` (el mensaje dice literalmente *«migraciones
0037/0042»* para ese único nombre) · `supabase/verificaciones.sql:15` (la
última corrida real del archivo es del **31-jul**: los bloques 24, 25 y 26
nunca se han ejecutado contra Postgres).

Escenario: la base de producción tiene hoy el trigger de la `0037` (se aplicó
en la ronda 8). Se despliega el código de esta ronda y la `0042` no entra —
mismo supuesto del CRÍTICO anterior. `triggers_faltantes(['trg_gasto_no_tras_liquidar',
'trg_gasto_no_tras_liquidar_update'])` devuelve `{}` porque los dos nombres
existen, el arranque escribe `{ok: true}`, y un
`UPDATE gasto SET fecha = '2026-08-02' WHERE id = …` posterior a la liquidación
vuelve a pasar sin `CU001`: exactamente el ALTO de la ronda 9, con el sistema
afirmando por escrito que está cerrado.

Consecuencia: la sonda que se construyó como CRÍTICO de la ronda 9 para que el
arranque dejara de mentir sobre estos dos triggers puede seguir mintiendo sobre
el que el propio arreglo modificó. El contralor puede ver un desglose fiscal
que contradice el PDF archivado, con el arranque en verde.

Causa raíz probable: una migración que **reemplaza** un objeto conservando su
nombre no es detectable por una sonda de existencia; haría falta mirar el
cuerpo (`pg_get_triggerdef` / `tgqual`), y ninguna migración toca ese punto.

### [MEDIO] `rol='operador'` con `operador_id` NULL es un estado que la base acepta, que el producto no sabe usar, y que es el ÚNICO que la aplicación sabe crear

`supabase/migrations/0045_rls_operador.sql:23-24` (el comentario declara la
invariante: *«Solo se llena cuando rol = 'operador' … NULL para los otros 4
roles»* — no hay `CHECK` que la imponga en ninguna de las dos direcciones) ·
`src/app/admin/usuarios/nuevo/page.tsx:12` (la consola ofrece «Chofer
(operador) — solo sus propios viajes») · `:26-36` y
`src/lib/auth/provisionar.ts:28-30` (el `insert` escribe `id, tenant_id, email,
nombre, rol`: nunca `operador_id`) · `src/lib/auth/guard.ts:52`
(`if (!s.operadorId) redirect('/sin-acceso')`).

Escenario: en el ensayo del demo, Javier crea al chofer desde
`/admin/usuarios/nuevo` con rol «Chofer (operador)». La fila queda
`rol='operador', operador_id=null` — la base la acepta sin objeción. El chofer
entra con su magic link y `requireOperador` lo manda a `/sin-acceso`, la
pantalla que dice «pide tu alta»: acaba de dársele de alta. La misma fila, con
`rol='contador'` y un `operador_id` pegado por error, tampoco se rechaza (ahí
`get_user_operador_id()` filtra por rol y no da acceso de más, pero la columna
queda mintiendo sobre lo que significa).

Consecuencia: el panel del chofer es indemostrable con las herramientas del
propio producto, y el fallo se presenta como «no tienes acceso» en vez de
«falta ligar tu cuenta». Si el demo enseña `/mis-viajes`, se cae ahí.

Causa raíz probable: la columna se agregó en la migración y no en el único
escritor de la tabla, y no hay `CHECK ((rol='operador') = (operador_id is not
null))` que obligue a que se noten a la vez.

### [BAJO] `app_user.id` no tiene FK a `auth.users` y `provisionarUsuario` no es atómico: las dos tablas se separan y el `unique` del correo deja el alta trabada

`supabase/migrations/0001_init.sql:16` (`id uuid primary key, -- = auth.users.id`
— un comentario, no una restricción; `grep "auth.users"` en `supabase/` devuelve
esta línea y ninguna más) · `:18` (`email text not null unique`) ·
`src/lib/auth/provisionar.ts:25-31` (`createUser` primero, `insert` en
`app_user` después, sin transacción ni compensación).

Escenario: se borra un usuario de prueba desde la consola de Auth (la vía
documentada para revocar acceso); su fila de `app_user` sobrevive, porque nada
la ata. Se vuelve a dar de alta el mismo correo:
`admin.auth.admin.createUser` funciona (ya no existe en Auth) y devuelve un
`id` nuevo, y el `insert` truena con
`23505 duplicate key value violates unique constraint "app_user_email_key"`.
Queda un usuario de Auth sin fila en `app_user`: pide su magic link, obtiene
sesión válida, y `getSessionTenant` le devuelve `tenantId: null` → `/sin-acceso`
para siempre, mientras la fila vieja con el `id` muerto sigue en la tabla.

Consecuencia: deuda de operación — el alta hay que destrabarla a mano en SQL y
el síntoma que ve la persona («no tienes acceso») no apunta a la causa.

Causa raíz probable: la relación 1-a-1 con `auth.users` vive en un comentario
desde la `0001` y nunca se convirtió en `references auth.users(id) on delete
cascade`, que es lo que la haría imposible de romper.

### [BAJO] La `0045` no es idempotente ni deja escrita su reversión, a diferencia de la `0044` y del resto del repo

`supabase/migrations/0045_rls_operador.sql:52,55,58` (tres `create policy`
sin `drop policy if exists` delante, mientras la MISMA migración sí lo usa para
`tenant_data` en `:41`) · `supabase/migrations/0044_rol_encargado.sql:12-24`
(el patrón correcto: `do $$ … if exists … drop … add`) ·
`supabase/migrations/0028_fks_con_tenant.sql:59-60` (el repo sí acostumbra
escribir la reversión: *«Reversible: `alter table <t> drop constraint <nombre>`»*).

Escenario: re-aplicar la `0045` sobre una base donde ya corrió (un
`db push` repetido, un `db reset` parcial) falla con
`42710 policy "operador_ve_su_viaje" for table "viaje" already exists`, después
de que el `do $$` de `:36-48` ya reescribió las tres policies `tenant_data`.
Revertirla, además, exige reconstruir a mano el `tenant_data` original de la
`0001:113-117` en las tres tablas: no está escrito en ningún sitio, y quien lo
haga bajo presión puede dejar la versión de la `0045` (con `not is_operador()`)
en una base que ya no tiene las policies del chofer — es decir, un chofer sin
acceso a nada, o un `tenant_data` mal reconstruido sin la exclusión.

Consecuencia: deuda; el riesgo real es que la reversión se improvise en la
madrugada del 6-ago.

Causa raíz probable: la migración se escribió como script de una sola pasada,
no con el mismo criterio de idempotencia que su vecina inmediata.

## Lo que revisé y está bien

- **El ALTO de la ronda 9 cerró y ancló.** `0042:22-29` agrega
  `new.fecha is distinct from old.fecha` al `when` del MISMO trigger y la MISMA
  función `gasto_no_tras_liquidar()` — no duplica lógica —, y el bloque 24 de
  `verificaciones.sql:928-962` ejercita el caso exacto (`update gasto set fecha`
  tras `guardar_liquidacion_tx`) con su control de columna no financiera
  (`clave_prod_serv`) para comprobar que no bloquea de más. **No es
  REINCIDENTE.** Lo único que le falta es poder verificarse en una base
  desplegada (hallazgo MEDIO de arriba).
- **La `0044` está bien construida como cambio de dominio.** Dropea y recrea la
  restricción dentro de un `do $$` con `if exists`, el dominio nuevo es un
  superconjunto estricto del de la `0025:138-140` (`superadmin, flota_admin,
  contador, operador` + `encargado`), así que **ninguna fila existente puede
  violarla** y el `ADD CONSTRAINT` no puede fallar por datos; y el
  `comment on constraint` se reescribe para no quedar desactualizado. `rol` es
  `not null` con default `'flota_admin'`, que está en el dominio.
- **El dominio de `rol` sí lo impone la base, y ese `CHECK` es lo único que
  frena un rol inventado.** `src/app/admin/usuarios/nuevo/page.tsx:32` hace
  `formData.get('rol') as RolAppUser` — un cast, sin validar contra la lista —,
  así que un POST fabricado con `rol=admin` llega intacto a
  `provisionar.ts:28`. Lo detiene `app_user_rol_dominio` con `23514`, no la
  aplicación. Es el caso de manual de por qué el `CHECK` vale: sin la `0025` ese
  usuario existiría con un rol que `is_superadmin()` y `permisos.ts` no conocen,
  y `EXPORTA/ASIGNA/ADMINISTRA` (`permisos.ts:17-19`) son `Set`s que fallan
  cerrado, así que sería un usuario con acceso al panel y ningún botón, sin
  ningún error.
- **`app_user` no se puede editar desde una sesión: la escalada de privilegio
  por PostgREST está cerrada.** `0001:126-128` habilita RLS con una única policy
  `app_user_self` **`for select`**; sin policy de `UPDATE`, un
  `PATCH /rest/v1/app_user?id=eq.<mío> {"rol":"superadmin"}` lo rechaza la base
  con `42501`. Lo verifiqué contra la lista completa de policies del esquema, no
  por el nombre de la migración.
- **`is_operador()` y `get_user_operador_id()` fallan cerrado ante ausencia de
  sesión.** Con `auth.uid()` NULL las dos devuelven NULL/false; la comparación
  `operador_id = NULL` da NULL (no true), así que `anon` no ve filas por esa
  vía, y un `app_user` sin `operador_id` tampoco arrastra los viajes con
  `operador_id` NULL (que además es `not null` en `viaje`, `0001:49`). Las dos
  llevan `set search_path = public`, el criterio de la `0035`.
- **La `0041` revirtió la `0038` de forma limpia y el código la siguió.**
  `drop table if exists foto_pendiente` sobre una tabla sin tráfico, y
  `grep foto_pendiente` en `src/` solo devuelve dos comentarios
  (`processor.ts:109,494`): no queda un solo llamador de
  `guardarFotoPendiente`/`reclamarFotoPendiente`. El pendiente que dejé abierto
  en la ronda 9 («la RLS de `foto_pendiente` no se probó como `anon`») quedó sin
  objeto.
- **El `service_role` sí filtra por tenant explícitamente en los dos exports.**
  `api/export/pdf/[id]/route.ts:41-46` y `api/export/liquidaciones/route.ts:21-25`
  añaden `.eq('tenant_id', tenantId)` con el tenant tomado de la sesión, no de
  `DEMO_TENANT_ID`, y el PDF se sirve con URL firmada de 60s sobre bucket
  privado. **No hay fuga entre flotas por ahí** — el hueco de esos endpoints es
  de rol dentro del mismo tenant, no de tenant.
- **Los `CHECK` de dominio de la `0025` siguen intactos.** Ninguna de las
  migraciones `0041`–`0045` toca `gasto_concepto_dominio`,
  `viaje_estatus_dominio`, `liquidacion_estatus_dominio`,
  `gasto_monto_no_nan` ni `viaje_intake_pendientes_no_negativo`, y los tipos de
  `src/types/cuadra.ts` (`ConceptoGasto:20-25`, `EstatusLiquidacion:106`)
  siguen empatando valor por valor con lo que la base acepta.
- **`migraciones_verificadas.test.ts` obligó a que la `0044` y la `0045` tomaran
  una decisión explícita** (exención razonada y bloque 26 respectivamente), que
  es para lo que existe. La exención de la `0044` se apoya en
  `provisionar.test.ts:58-62`, que es un test con Supabase mockeado y por tanto
  no puede demostrar que la base acepte `'encargado'` — lo anoto aquí y no como
  hallazgo porque el `CHECK` de la `0044` es correcto por lectura y el riesgo
  real (que no esté aplicada) ya está cubierto por el CRÍTICO de la sonda.

## Lo que NO alcancé a revisar

- **No corrí nada contra Postgres.** No hay base en este entorno; todo lo de
  arriba sale de leer las migraciones, las policies y los llamadores, más los
  bloques de `verificaciones.sql` que declaran qué prueban y qué no. Los
  bloques 24, 25 y 26 **nunca se han corrido** (`verificaciones.sql:15`:
  última corrida 31-jul), así que la `0042`, la `0043` y la `0045` están
  verificadas solo por lectura, incluidas por mí.
- **`liquidacion` no tiene trigger de «no se reescribe tras emitida»**, al
  revés que `gasto` (`0036`/`0037`/`0042`). Un `flota_admin` o un `contador`
  con su propio JWT puede `PATCH /rest/v1/liquidacion` sobre
  `total_comprobado`/`diferencia` de una liquidación ya entregada. No lo elevo a
  hallazgo esta ronda porque es la misma deuda de la `0001` que ya nombra el
  CRÍTICO 1 (RLS por tenant, no por rol) y no quiero contarla dos veces, pero es
  el siguiente sitio donde va a doler.
- **Storage: las policies del bucket `liquidaciones`** — pendiente arrastrado
  desde la ronda 5. La `0039` (bucket `comprobantes`) sí tiene bloque 22; el de
  `liquidaciones` sigue sin verificarse, y ahora hay un rol más que puede pedir
  URLs firmadas.
- **`wa_conversacion` sin normalizar y `gasto.fecha` nullable sin CHECK** — los
  dos MEDIOS reincidentes de la ronda 8. Confirmé que ninguna de las migraciones
  `0041`–`0045` los toca; no los re-verifiqué más allá de eso.
- **Las 26 páginas nuevas de `/admin`** solo las miré donde escriben o leen
  esquema (`negocio.ts:250-263`, `usuarios/nuevo`, `equipo`). El resto puede
  tener más lecturas con `service_role` de las que revisé.
