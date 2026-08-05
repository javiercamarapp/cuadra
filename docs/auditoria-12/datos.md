# Modelo de datos y esquema — auditoría 12

**Nota: 5/10** (baja de 8 tras los arreglos de la ronda 10). La vara del rubro,
heredada de la ronda 10: ¿el esquema puede sostener, sin que nadie lo esté
mirando, las tres garantías que este producto vende —el PDF archivado y lo que
hay en `gasto` dicen lo mismo para siempre, ningún tenant ve dinero de otro, y
toda migración nueva se comprueba contra Postgres real antes de darla por
buena—? 10 = las tres se sostienen incluso si el código de aplicación tiene un
bug. 7 = se sostienen, pero el proceso tuvo que autocorregirse. 4 = una de las
tres tiene un hueco conocido y sin blindaje.

Anclado a `ce9abab9bd8284486df953a4896cad575f859d34` (`git rev-parse HEAD` al
empezar). Sin acceso a MCP/Postgres en esta sesión: toda la verificación es
lectura línea por línea de `supabase/migrations/` (0001–0078), `seed.sql`,
`verificaciones.sql` y el código que consume el esquema. Lo que necesitaría
base real para confirmar está dicho como tal, con el escenario armado.

## Hallazgos

### [CRÍTICO, abierto] La reconstrucción de la 0065 no trae `autofactura_bloqueada_en` ni `autofactura_bloqueo` — el repo ya no puede reproducir el esquema de facturación

`supabase/migrations/0065_cfdi_de_varias_casetas.sql` (archivo completo, 72
líneas, recuperado en `dac343b` tras el `rm -f` accidental de la ronda 10)
crea SOLO `gasto.cfdi_orden` + el índice `uq_gasto_cfdi_uuid (tenant_id,
cfdi_uuid, cfdi_orden)`. En todo el repo, ninguna migración 0001–0078 crea las
columnas `autofactura_bloqueada_en` ni `autofactura_bloqueo` (verificado:
`grep -rn "autofactura_bloqueada_en" supabase/migrations/` → 0 resultados; lo
único que existe es `autofactura_intentada_en`, mig. 0063:48).

Y el código las consume como si existieran:

- `src/lib/cuadra/facturacion/pendientes.ts:121` — `.select('... autofactura_bloqueada_en, autofactura_bloqueo')`, y `:174-175` construye el bloqueo de la cola "por facturar" con ellas.
- `src/app/api/cron/facturar/route.ts:281` — `.is('autofactura_bloqueada_en', null)` filtra la cola del cron en cada corrida.
- `supabase/verificaciones.sql:2282` (bloque 44) — `update gasto set autofactura_bloqueada_en = now() where ...` esperando `check_violation`, y `:2287` inserta con ambas columnas.

**Por qué hoy nadie lo ve.** En la base real las columnas SÍ existen: la 0065
original (aplicada a producción como `cfdi_de_varias_casetas`, versión
`20260805042253`) las traía; lo que se perdió fue el archivo local. El bloque 44
corre contra la base real y pasa — la base esconde el hueco del repo. La ronda
10 afirmó en su reporte que la reconstrucción "coincide exacto con el archivo
local (columnas `cfdi_orden`, `autofactura_bloqueada_en`/`_bloqueo`...)" — esa
afirmación es FALSA para el archivo que hay hoy en `master`; el propio encabezado
de la 0065 dice "describe fielmente lo que la base tiene hoy" y omite dos
columnas y el CHECK que el bloque 44 presupone.

**Escenario con valores.** Se provisiona un entorno nuevo (dev, staging, un
proyecto de respaldo, `db reset` local) y se corren 0001→0078 + `seed.sql`:

1. `pendientes.ts:121` lanza `column gasto.autofactura_bloqueada_en does not exist` → la pantalla "por facturar" del panel deja de cargar.
2. `route.ts:281` lanza el mismo error → el cron de facturación muere en la primera consulta, 24 veces al día, sin CFDI timbrados y sin log de negocio.
3. `verificaciones.sql` bloque 44 truena en el paso 4 con `undefined_column` (42703), que el `exception when check_violation` NO atrapa → la verificación falla ruidoso (único blindaje parcial: el fallo no es silencioso, pero nada en CI corre migraciones contra una base fresca).

El invariante del rubro —"el esquema del repo = el esquema de producción"—
está roto en la dirección que nadie mira: la base puede más que el repo, y el
repo no puede reconstruirla. **Estado: abierto.** Arreglo sugerido (no lo hago,
este rubro solo reporta): agregar a la 0065 local las dos columnas y el CHECK de
coherencia que el bloque 44 prueba (`(autofactura_bloqueada_en is null) =
(autofactura_bloqueo is null)` o el que la base real tenga — hay que leerlo de
`pg_constraint` antes de escribirlo), y re-correr el bloque 44 contra una base
fresca, no solo contra la real.

### [ALTO, abierto] `seed.sql` ya no reproduce el estado que exige `GUION_DEMO.md` — el viaje del demo cuelga de un teléfono inventado, y la base real está vacía

`GUION_DEMO.md:30-33` dice, para mañana: *"El 1-ago se corrigió: el viaje
`VJ-2026-0847` ... Ahora es del operador con `529993700779`."* El seed
(`supabase/seed.sql`) NO contiene ese número en ninguna línea:

- `seed.sql:73-77` — los cinco operadores del demo se crean con teléfonos placeholder `+521111111101`…`105` (🔴 INVENTADO, el propio archivo lo marca).
- `seed.sql:108-113` — el viaje abierto `VJ-2026-0847` (anticipo $10,600) se asigna al operador `33333333-…-0001` (Juan Pérez, `+521111111101`).

`resolveOperador` (`src/lib/cuadra/conv.ts:100-104`) resuelve al chofer por
teléfono vía `variantesTelefono`; ningún teléfono del seed coincide con
`529993700779`. Y según el PROMPT-BASE de esta ronda, la base real está VACÍA
de datos del demo — el seed no está aplicado.

**Escenario con valores.** El día del demo, alguien aplica `seed.sql` para
levantar el estado (es el único artefacto que lo reproduce): el operador con el
teléfono de Javier no existe, el viaje `VJ-2026-0847` cuelga de un número que
no está dado de alta en Meta dev mode, y el paso 4 del guion —"mandar un hola y
que conteste algo que no sea 'No tienes un viaje abierto'"— falla en la sala.
Además el seed no crea ninguna fila en `app_user` (cero inserts), así que
tampoco hay con quién entrar al panel del dashboard desde el tenant del demo.

Dos inconsistencias internas del mismo archivo que lo confirman como
desactualizado:

- `seed.sql:108` — el comentario dice *"(anticipo = total comprobado, así la
  ÚNICA diferencia es la de política)"*, pero con los gastos sembrados
  (`seed.sql:117-126`: diésel $4,200 + caseta $1,400 = $5,600) contra un
  anticipo de $10,600, el cuadre cerraría con una diferencia de $5,000, no de
  $200. El diseño que el comentario declara no se cumple con sus propios datos.
- `seed.sql:12` — *"La política es PARAMETRIZABLE: cambia los valores del
  bloque POLÍTICA y listo"*, y el bloque POLÍTICA (`seed.sql:82-97`) escribe en
  `politica_gasto`, la tabla MUERTA que el propio bloque reconoce ("ESTA TABLA
  NO LA LEE NADIE"). La política viva es `tenant.config.politica`
  (`getConfig`, `src/lib/cuadra/config.ts:179`) y el seed no inserta ningún
  `config`. Cambiar el bloque no cambia ninguna liquidación.

**Estado: abierto** — es el hallazgo de datos/operabilidad que el PROMPT-BASE
ya anticipaba ("el seed no está aplicado"); aquí está la prueba de que, aunque
se aplique, no produce el estado del guion.

### [MEDIO, abierto] `app_user_self` sigue dejando que el chofer lea los `email`/`nombre`/`rol` de TODA la flota — la misma clase de fuga que la 0078 cerró en las otras siete tablas

`supabase/migrations/0001_init.sql:127-128`:

```sql
create policy app_user_self on app_user for select
  using (id = auth.uid() or tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

La 0078 cierra `operador`, `wa_conversacion`, `cfdi_xml`… pero `app_user`
—donde viven los `email` y `nombre` de cada usuario del tenant— sigue legible
en bloque para cualquier `authenticated` del tenant, incluido `rol=operador`.
El encabezado de la 0078 argumenta el cierre de `wa_conversacion` con
"historias de chats de todos los choferes (datos personales de terceros,
LFPDPPP)"; el mismo argumento aplica a los correos y nombres de los compañeros.

**Escenario con valores.** Un chofer con sesión web y la anon key pública:
`GET /rest/v1/app_user?select=email,nombre,rol,operador_id&tenant_id=eq.<flota>`
le devuelve la lista completa de usuarios de su flota — incluyendo el `email`
del `flota_admin` y de cada compañero. Solo lectura (no puede escribir), y solo
de su propio tenant; por eso MEDIO y no ALTO. La app solo lee su propia fila
por RLS (`src/lib/auth/session.ts:70`, `.eq('id', user.id)`), así que
restringir la policy a `id = auth.uid() or (tenant_id = any(get_user_tenant_ids())
and not is_operador()) or is_superadmin()` no rompe nada. **Estado: abierto.**

### [MEDIO, abierto] `bitacora_insercion` deja que el chofer escriba en la bitácora de auditoría — el rastro puede envenenarse

`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:199`:

```sql
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

Sin `not is_operador()`, a diferencia de la `bitacora_lectura` de la misma
migración (`:197`, que sí exige `administra_flota()`). El bloque 54 de la 0078
impersona al chofer contra las siete tablas y contra `tenant`, pero no contra
la bitácora.

**Escenario con valores.** Un chofer con sesión + anon key hace
`POST /rest/v1/bitacora_auditoria {"tenant_id": "<su flota>", "actor_email":
"flota_admin@…", "accion": "politica.editada", "detalle": {"tope": 500000}}`.
El `with check` pasa (su tenant) y la fila entra: la bitácora —la evidencia de
"quién cambió qué", que `administracion.ts:47` y `avisar.ts:131` escriben por
service_role— ahora admite filas que parecen escritas por la oficina. La
política de INSERT existe sin consumidor RLS en la app, así que cerrarla con
`and not is_operador()` (o eliminarla) no rompe ningún camino. **Estado:
abierto.**

### [BAJO, abierto] El bloque 54 de `verificaciones.sql` (prueba de la 0078) está escrito pero sin correr contra la base real

El commit `ce9abab` (la 0078) lo dice en su propio mensaje: *"Pendiente de
correr contra la base real."* El bloque existe y está bien armado
(`supabase/verificaciones.sql:2970-3038`: siembra las siete tablas, impersona
al chofer por `request.jwt.claims`, espera 0/0/0/0/0/0/0/0/1/2, y verifica la
regresión del flota_admin), pero una verificación que nadie ha corrido no es
una verificación — es una intención. Mismo criterio que la ronda 10 aplicó a la
0066: el bloque solo vale cuando su salida quedó registrada contra Postgres
real. **Estado: abierto** (sin MCP en esta sesión no pude correrlo yo).

### [BAJO, documentado en el propio repo] La base real está vacía de datos del demo

Confirmado solo por el PROMPT-BASE (no tengo acceso a la base en esta sesión):
`tenant=0`, `gasto=0`, `viaje=0` en `gngoqsvrxdguxvsizpbw`. Es el mismo hecho
que hace ALTO al hallazgo del seed: no hay un estado de demo reproducible en el
repo que se pueda aplicar mañana. No se toca (instrucción explícita).

## Lo que revisé y está bien

- **La 0078 línea por línea (el encargo central de esta ronda).** El `do $$
  loop` (`0078_rls_chofer_sin_escritura.sql:39-46`) dropea y recrea `tenant_data`
  con el patrón `(tenant_id = any(get_user_tenant_ids()) and not is_operador())
  or is_superadmin()` sobre exactamente las siete tablas que arrastraban el
  patrón viejo: `terminal`, `operador`, `politica_gasto`, `wa_conversacion`
  (0001), `llm_costo` (0003), `cfdi_xml` (0009), `cfdi_consolidado_linea`
  (0076). No sobra ni falta ninguna: verifiqué contra el inventario completo de
  `create policy` del repo. `tenant_self` pasa de `for all` a `for select`
  (`:55-58`) — y **no rompe ninguna escritura de la app**: todas las escrituras
  a `tenant`/`operador`/`wa_conversacion`/`llm_costo`/`cfdi_xml` van por
  `supabaseAdmin()` (service_role, salta RLS): `administracion.ts:99,169,246,253`,
  `conv.ts:233-274`, `costos.ts:131`, `repo.ts:22`, `saas/suscripcion.ts:381`.
  El único acceso por cliente de sesión (RLS de verdad) es `app_user` en
  `session.ts:70` y las lecturas del chofer en `mis-viajes/page.tsx:44` y
  `chofer.ts:229,315` — todas cubiertas por las policies que la 0078 no toca.
- **Inventario RLS tabla por tabla (33 tablas de `public`).** Con RLS y policy
  correcta: `viaje`/`gasto`/`liquidacion` (0045, con `operador_ve_*` de solo
  lectura), `unidad`/`mantenimiento`/`incidencia`/`pod` (0047, POD con insert
  scoped al propio viaje), `cliente`/`tarifa` (0048), `factura_emitida`/
  `pago_recibido`/`factura_viaje` (0049), `posicion`/`geocerca` (0050),
  `rastreo_credencial` (solo_admin_flota), `ticket_soporte`/`ticket_mensaje`/
  `cotizacion` (0051), `plan`/`suscripcion`/`factura_saas` (0052), `invitacion`/
  `solicitud_arco`/`campania`/`envio_mensaje` (0053), `evento_stripe` (0055,
  solo superadmin), `portal_credencial` (0063, deny-all + sin policies),
  `llm_costo_mensual` (0072, deny-all + `revoke`). Con RLS on y CERO policies
  (deny-all, correcto): `wa_mensaje_procesado`, `viaje_lock`, `codigo_pendiente`,
  `comprobante_huerfano` (+ `foto_pendiente`, dropeada por la 0041 sin
  referencias colgando). Storage: `liquidaciones` (0008) y `comprobantes`
  (0039) privados sin policies; `avatares` (0046) público con policies por
  `auth.uid()`.
- **Integridad referencial.** Ninguna tabla con `tenant_id` carece de FK a
  `tenant` (barrido archivo por archivo; `viaje_lock` no tiene `tenant_id` y su
  FK a `viaje` la agrega la 0075). Las compuestas de la 0028
  (`gasto_viaje_tenant_fkey`, `liquidacion_viaje_tenant_fkey`, etc.), la FK
  compuesta de `comprobante_huerfano` (0073), la de `viaje_lock` (0075), y los
  dominios de la 0025 + 0044 (`encargado`) + 0073 + 0077 (`sin_match`) están
  como sus encabezados dicen. Los `NOT VALID` de la 0048 (`viaje_ingreso_no_negativo`,
  `viaje_km_sanos`) los valida la 0075. La 0070 (`gasto.monto >= 0`,
  `viaje.anticipo >= 0`) y la 0066 (desglose de la mensualidad con sus tres
  CHECK) son correctas y sus bloques 45/51 existen.
- **Sin fugas de funciones.** `resumen_costo_ia` (0062) y
  `resumen_costo_ia_tenant` (0064) revocan de `public, anon, authenticated` y
  solo conceden a `service_role`; `ve_finanzas`/`administra_flota` revocadas de
  `PUBLIC` (0054); `factura_saldo` con `security_invoker` (0054). La 0074 fija
  `search_path = public, pg_temp` en las cuatro funciones que resuelven TODA
  la RLS — el hueco de suplantación por `pg_temp` queda cerrado.
- **Cabeceras de 0070-0072 corregidas** (el MEDIO de la ronda 10 está cerrado:
  los tres archivos dicen 0070/0071/0072 en su primera línea).
- **`migraciones_verificadas.test.ts` 4/4** y `politica_un_origen.test.ts` 3/3
  — corridos en esta sesión, verdes. Bloque 54 presente con el formato correcto
  (título con "mig. 0078").
- **`seed.sql` y `verificaciones.sql` cuadran en lo que toca a constraints:**
  los `estatus` del seed (`cuadrada`/`con_diferencias`/`revisar`, `liquidado`,
  `abierto`) cumplen los dominios de la 0025; los montos desglosados de los dos
  gastos del seed cuadran ($3,210 + $408.62 + $581.38 = $4,200; $1,206.90 +
  $193.10 = $1,400).

## Lo que no alcancé a revisar

- **No pude correr el bloque 54 (ni 44/48-53) contra la base real** — esta
  sesión no tiene MCP/credenciales de Postgres. La lectura estática del bloque
  54 es correcta; su salida real queda sin registrar, que es exactamente el
  BAJO que reporto.
- **No repetí el diff nombre por nombre migraciones-locales vs `list_migrations`
  remoto** que la ronda 10 hizo; sin base no es reproducible. El hallazgo del
  CRÍTICO (0065) demuestra que ese diff no se puede dar por cerrado de memoria.
- **0056-0061 y 0030-0037/0042-0043** los revisé por cabecera y por sus
  bloques en `verificaciones.sql`, no constraint por constraint.
- **El patrón exacto del CHECK de `autofactura_bloqueo` en la base real** — no
  puedo leerlo sin Postgres; el arreglo de la 0065 debe copiarlo de
  `pg_constraint`, no inventarlo.

## Veredicto

**Rojo para el rubro datos, con matices.** Lo que esta ronda debía validar —la
0078, DATOS-C2— está bien construido: cierra de verdad la escritura/lectura del
chofer sobre las siete tablas y el `tenant` de solo lectura, no rompe ningún
camino de la app (todo lo que escribe va por service_role) y trae su bloque de
verificación. Los dos MEDIO residuales de la misma familia (`app_user` legible
en bloque, `bitacora_auditoria` insertable por el chofer) son la clase exacta de
hueco que la 0078 dejó sin cubrir, y el arreglo es una línea cada uno.

Pero el rubro entero no puede estar verde con un CRÍTICO de su propio
invariante abierto: la 0065 reconstruida no reproduce el esquema de facturación
de producción — dos columnas y un CHECK que el código y el bloque 44 consumen
no existen en ninguna migración del repo, y la ronda anterior certificó por
escrito que "coincide exacto". Eso es el modo de falla que este rubro existe
para impedir, y pasó. Súmenle que mañana es el demo y el único artefacto que
reproduce el estado del demo (`seed.sql`) está desincronizado del guion en el
dato más crítico —el teléfono del operador— y que la base real está vacía. Los
tres motivos son independientes entre sí, así que no hay un arreglo que los
cierre a la vez: (1) completar la 0065 leyendo el CHECK de la base real, (2)
actualizar `seed.sql` al estado del guion (teléfono `529993700779`, `config`
de política, `app_user` del panel) y aplicarlo, (3) cerrar las dos policies
residuales y correr el bloque 54. Con eso, el rubro vuelve a 8.
