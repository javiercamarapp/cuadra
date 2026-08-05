# Modelo de datos y esquema — auditoría 11 (pase 2)

**Nota: 4/10** (antes 4). Razón del movimiento: **se atacó y subió en el camino
de la aplicación · deuda que cobró factura en el esquema.**

La nota no se mueve y esa es la medición, no una postura. Los once commits de
arreglo cerraron o mitigaron **cada uno** de mis hallazgos del pase 1 —y lo
digo con línea abajo, uno por uno—, pero los cerraron **en TypeScript**:
`supabase/migrations/` sigue byte-idéntico en `0047` y no ganó una sola
restricción. Mi rubro dice literalmente que «la aplicación se encarga» es un
hallazgo, no un arreglo, porque un script, la consola de Supabase o el JWT del
propio chofer contra PostgREST no pasan por la aplicación. Y encima esta rama
**introdujo** una regresión de esquema que `master` no tiene.

Riesgo mayor del rubro hoy: **`tenant_self` (`0001:122`) es `for all` para
cualquier `app_user` del tenant, y de `tenant.rfc` y `tenant.config` salen TODOS
los topes de dinero de la flota** — el chofer al que se está auditando puede
reescribir, con su propia sesión, el reglamento que lo juzga, y el `CHECK` que
la `0026` construyó para esa columna valida la forma, nunca al autor.

Anclado a `707c749` sobre `claude/auditoria-11`. **No hay Postgres aquí**: todo
lo que sigue sale de leer las 47 migraciones, las policies y sus llamadores. No
corrí un solo `select`. Compuerta medida hoy: `npx tsc --noEmit -p .` → exit 0;
`npx vitest run` → **4 pruebas fallando en 3 archivos**, las cuatro de
TIEMPO/rendimiento (`normas/fundamento.test.ts` «expected 838 to be less than
500», `intake/codigos.test.ts` a 5,070 ms), ninguna de mi rubro y ninguna
tocando SQL.

## Hallazgos

### [CRÍTICO · NUEVO · REGRESIÓN DE ESTA RAMA] El arranque llama a `triggers_desactualizados`, una función que crea la migración 0052 — que NO existe en este repo: cada boot de producción grita por una migración impushable, `startup.migraciones {ok:true}` no puede emitirse jamás, y el trigger de «nada se reescribe tras liquidar» deja de verificarse

`src/lib/cuadra/startup.ts:263`
(`await admin.rpc('triggers_desactualizados', { p_esperados: … })`) · `:269`
(el mensaje de fallo: *«falta la migración 0052, `triggers_desactualizados`»*) ·
`supabase/migrations/0043_triggers_faltantes.sql:18` — la ÚNICA función de este
tipo que existe en el árbol se llama `triggers_faltantes`, y
`grep -rn "triggers_desactualizados" supabase/` devuelve **cero** ·
`git show master:src/lib/cuadra/startup.ts` línea 172 llamaba
`admin.rpc('triggers_faltantes', …)`, que **sí** existe: la rompió `989ca62`,
el commit que trajo `startup.ts` del PR #7 y dejó fuera
`supabase/migrations/` a propósito · `src/instrumentation.ts:26-27` (es quien lo
corre, en cada arranque) · `src/lib/cuadra/startup.ts:315`
(`if (!faltan) logger.info('startup.migraciones', { ok: true })`).

Escenario, con valores. Cualquier boot en Vercel contra el proyecto de Supabase
del demo, con las 47 migraciones aplicadas y perfectas. `instrumentation.ts`
llama `verificarMigracionesCriticas()`. Al llegar a `:263`, PostgREST contesta:

```json
{"code":"PGRST202",
 "message":"Could not find the function public.triggers_desactualizados(p_esperados) in the schema cache"}
```

`sinRespuesta(error)` (`:48-51`) devuelve `false` —hay `code`—, así que
`reportarProbe` cae en la rama de `logger.error` y `faltan = true`. Tres
consecuencias, las tres permanentes:

1. **`{ok: true}` es inalcanzable.** La línea `:315` está guardada por `!faltan`
   y `faltan` ya es `true`. El único acuse de «esta base está al día» que el
   producto emite no se puede volver a ver en ninguna base del mundo.
2. **Un diagnóstico falso, en cada boot, para siempre.** El log dice «falta la
   migración 0052». Esa migración no está en el repo: `supabase db push` no la
   puede aplicar por más veces que se corra. Es exactamente el daño que el
   comentario de este mismo archivo describe en `:33-46` —*«manda a alguien a
   correr `supabase db push` contra un problema que no existe. Y después, cuando
   el aviso resulta ser mentira una vez, se aprende a ignorarlo»*— sobre el canal
   que también dice «FALTA la 0045: NADIE puede entrar al panel».
3. **La verificación de los triggers del dinero se apagó.** El `else if` de
   `:271` sólo se evalúa cuando `eTrig` es falsy. Con el error permanente,
   `trigFaltantes` no se mira nunca: 0036/0037/0042 —«el peor bug histórico del
   camino del dinero», un gasto insertado o reescrito DESPUÉS de emitida la
   liquidación, con el PDF y el WhatsApp diciendo cifras contrarias del mismo
   viaje— vuelven a estar sin sondear, que es el CRÍTICO de operabilidad de la
   ronda 9.

La suite está verde sobre esto: `src/lib/cuadra/startup_diagnostico.test.ts:280`
**mockea** la RPC devolviendo `{error:{code:'PGRST202'}}` y afirma que el mensaje
contiene `'0052'` (`:284`). La prueba mide la rama que sólo se dispara porque la
migración no está, y la declara correcta. Es la trampa del PR #7 palabra por
palabra: **llegó la prosa, no la migración** — y aquí la prosa está en un `rpc()`,
no en un comentario.

Consecuencia para alguien real: la mañana del 6-ago, si algo falla, el log del
arranque enseña un error rojo señalando una migración inexistente. Quien
diagnostique va a `supabase db push`, no cambia nada, y a la segunda deja de
leer `startup.migraciones` — que es el mismo renglón donde aparecería «FALTA la
0045» si la base del demo estuviera a medio migrar.

Causa raíz: el merge selectivo trajo el consumidor (`startup.ts`) y excluyó al
productor (`supabase/migrations/`), y no hay ninguna guarda que compare lo que el
código llama contra lo que las migraciones crean.

### [CRÍTICO · NUEVO] `tenant_self` es `for all` para cualquier `app_user` del tenant — chofer y contador incluidos — y de `tenant.rfc` y `tenant.config` salen todos los topes de dinero: el auditado reescribe el reglamento que lo juzga

`supabase/migrations/0001_init.sql:121-124`
(`alter table tenant enable row level security; create policy tenant_self on
tenant **for all** using (id = any(get_user_tenant_ids()) or is_superadmin())
with check (…)`) · `grep -rn "on public.tenant\|on tenant " supabase/migrations/`
devuelve **esa única línea**: ni la `0045` ni la `0047` la tocaron cuando
introdujeron `and not is_operador()` para las demás tablas ·
`src/lib/cuadra/config.ts:179`
(`.from('tenant').select('rfc, config')`) · `:183-184`
(`fusionarConfig(DEMO_CONFIG, override)`) · `:214`
(`return { ...cfg, empresa: { ...cfg.empresa, rfc } }`) ·
`src/lib/cuadra/cuadre/engine.ts:254-260` (`rfcsOk`, que descarta
`XAXX010101000`) · `supabase/migrations/0026_tenant_config_esquema.sql` (270
líneas de `CHECK` sobre el CONTENIDO de esa columna, y ni una sobre quién puede
escribirla; su propio encabezado dice *«ninguna línea de `src/` ESCRIBE esa
columna… El único escritor es una persona con la consola de Supabase abierta»* —
esa premisa es falsa) · `src/lib/supabase/server.ts:10-11`
(`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: la URL de
PostgREST y la anon key viajan al navegador, y el token del usuario vive en su
cookie).

Escenario A, con valores. El chofer de la flota A tiene cuenta web —para eso
existe la `0045`— con `app_user.rol='operador'`,
`tenant_id='11111111-1111-1111-1111-111111111111'`. Toma su `access_token` de
`sb-<ref>-auth-token` y manda:

```http
PATCH /rest/v1/tenant?id=eq.11111111-1111-1111-1111-111111111111
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
Authorization: Bearer <su access_token>
Content-Type: application/json

{"rfc":"XAXX010101000"}
```

`tenant_self` evalúa `id = any(get_user_tenant_ids())` → **true**. `tenant.rfc`
no tiene un solo `CHECK` (la `0025` decidió a propósito no ponerle dominio a
`tenant.plan`; `rfc` no se consideró). La fila se escribe. A partir de ahí
`getConfig` mete ese valor en `empresa.rfc` y `engine.ts:257` lo filtra por ser
el genérico del SAT: **`rfcsOk` queda vacía y la validación de receptor se apaga
para la flota entera**. Es el daño que `config.ts:160-172` documenta medido —*«un
CFDI de $11,600 timbrado a un TERCERO sale "Deducible para ISR $11,600.00" en
verde, con $1,600 de IVA acreditable citando LIVA art. 5, y cero
diferencias»*— reabierto por una puerta que el esquema deja abierta.

Escenario B, mismo PATCH, otra columna:

```json
{"config":{"politica":[{"concepto":"diesel"},{"concepto":"alimentacion"},{"concepto":"caseta"}]}}
```

Pasa `config_tenant_valida` línea por línea: es un objeto, la llave `politica`
está en `llaves_ok`, el array no está vacío (regla 3), cada elemento es un objeto
con `concepto` de texto y de la lista de nueve, y **`topeMonto` es opcional**. La
propia `0026` llama a esa forma *«una política sin topes, explícita y
auditable»*. Lo es — salvo que quien la escribió es el chofer. Resultado:
`politicaPara` empata, `pol.topeMonto` es `undefined`, y **ninguna liquidación
de esa flota vuelve a levantar `sobre_politica`**. Sin log, sin rastro y sin que
el `CHECK` que se escribió justo para esto pueda decir nada.

Escenario C, sin atacante: el **contador** tiene el mismo `for all` y puede
reescribir `url_aviso_privacidad` —la liga que va en el aviso simplificado que
recibe cada operador por WhatsApp (LFPDPPP 16 fr. II)—, `razon_social` y
`domicilio_fiscal`, que son lo que el PDF imprime como responsable.

Consecuencia: la parte interesada apaga los controles del motor con una petición
HTTP, y la liquidación sale «cuadrada» en verde delante del contralor. Es el
único daño que este esquema declara inaceptable desde la `0001`, entrando por la
tabla que nadie volvió a mirar.

Causa raíz: la `0045` y la `0047` partieron `tenant_data` por rol y `tenant_self`
—escrita en la `0001`, cuando `tenant` sólo guardaba nombre y ciudad— se quedó
con el reparto viejo; entre tanto la `0004` y la `0026` le colgaron encima los
parámetros del dinero.

### [ALTO · NUEVO] `permisos.ts` afirma como hecho de la base que el contador es «SOLO lectura (0048, `contador_lee`)». La migración 0048 no existe: en este árbol el contador tiene `for all` sobre las diez tablas de negocio, incluido `DELETE`

`src/lib/auth/permisos.ts:8-11` (*«Hoy el reparto en la base es: · superadmin /
flota_admin / encargado → lectura + escritura (tenant_data) · **contador → SOLO
lectura (0048, contador_lee)**»*) · `ls supabase/migrations/` termina en `0047`;
`grep -rn "contador_lee" supabase/` devuelve **cero** ·
`supabase/migrations/0045_rls_operador.sql:42-46` (`create policy tenant_data …
for all using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or
is_superadmin())` — `contador` no es `is_operador()`, así que entra completo) ·
`supabase/migrations/0001_init.sql:110-118` (las otras siete) ·
`src/app/admin/usuarios/nuevo/page.tsx:11`
(`{ valor: 'contador', etiqueta: 'Contador — solo lectura y exportar' }`).

Escenario, con valores. El contador de la flota A, dado de alta desde esa misma
consola con la etiqueta «solo lectura y exportar», sesión válida:

```http
DELETE /rest/v1/liquidacion?id=eq.<uuid>&tenant_id=eq.11111111-…
apikey: <anon>
Authorization: Bearer <su access_token>
```

`tenant_data` en `liquidacion`: `tenant_id` empata y `not is_operador()` es
cierto. La fila desaparece — la liquidación a la que apuntan el PDF archivado y
el export al ERP. El mismo verbo sirve sobre `gasto` y sobre `viaje`.

Consecuencia doble. La primera es el `DELETE`. La segunda es peor para el repo:
el archivo que el resto del código lee como la autoridad sobre permisos declara
**por escrito** que la base ya impone lo que no impone, y esa frase llegó con
`989ca62` sin la policy que la haría cierta. El siguiente que audite `permisos.ts`
va a leer «cerrado». Es la trampa del PR #7 en el sitio donde más caro sale.

Causa raíz: el merge trajo el comentario que describía una migración del otro
árbol; el ordinal `0048` está libre aquí y nadie lo notó porque un comentario no
compila.

### [ALTO · REINCIDENTE] `operador_sube_su_pod` no mira `tenant_id`, `estado` ni `storage_path`: el chofer declara entregada su carga con `estado='subido'`, `storage_path='x'`, y el tablero se pone verde

`supabase/migrations/0047_operacion_encargado.sql:190-191`
(`create policy operador_sube_su_pod on public.pod for insert with check
(viaje_id in (select id from public.viaje where operador_id =
get_user_operador_id()))` — el `WITH CHECK` no nombra ninguna otra columna) ·
`:143-144` (`pod_subido_tiene_archivo check (estado <> 'subido' or storage_path
is not null)`: el único requisito es que la columna no sea NULL) · `:135`
(`estado text not null default 'pendiente'`) ·
`src/lib/cuadra/operacion.ts:74` (`pods.filter((p) => p.estado === 'subido')` →
`conPod`) · `:349` (`estado: p ? (p.estado as string) : null`) · `:451`
(`podPendientes: enCurso.filter((v) => !conPod.has(v.id))`) ·
`src/app/dashboard/pod/vista.tsx:18`
(`if (estado === 'subido') return { label: 'Recibido', estado: 'ok' }`) ·
`:36-37` (el KPI «Recibidos»).

Escenario, con valores, sin cambios respecto del pase 1:

```http
POST /rest/v1/pod
{"tenant_id":"<A>","viaje_id":"<uno de sus propios viajes>","estado":"subido","storage_path":"x"}
```

`pod_estado_dominio` pasa, `pod_subido_tiene_archivo` pasa porque `'x'` no es
NULL, y el `WITH CHECK` pasa porque el viaje es suyo. `grep -rn "storage_path"
src/` sigue devolviendo únicamente `operacion.test.ts` — la aplicación **no
escribe esa columna nunca**, así que en producción la única fila `'subido'` que
puede existir es forjada. Efecto en pantalla: `StatusPill` verde «Recibido», el
KPI «Sin evidencia de entrega» baja uno, y `getCargaOperadores.sinPod` (`:92`) de
ese chofer baja uno.

Consecuencia: la prueba de entrega —lo que respalda la factura del flete y lo
único que se enseña cuando el cliente reclama— la declara cumplida la parte
interesada, y el esquema no tiene con qué distinguirla de una real. El encargado
deja de perseguir una entrega de la que no hay un byte.

Causa raíz: la policy contesta «¿de quién es este viaje?» y no «¿qué columnas
puede FIJAR el que inserta?»; y el `CHECK` se puso sobre la nulabilidad de una
ruta, no sobre que la ruta apunte a un objeto del bucket.

### [ALTO · REINCIDENTE, MITIGADO A MEDIAS] `pod_viaje_unico` sigue siendo única GLOBAL y `pod.viaje_id` sigue siendo FK de una sola columna: cerrado el camino de la app, abierto el de la RLS — y ahora el mensaje traducido contradice a la tabla que lo acompaña

Lo que SÍ se arregló, y lo digo primero: `src/lib/cuadra/operacion.ts:377`
(`await exigirDelTenant('viaje', viajeId, tenantId)`) y `:554-561`
(`exigirDelTenant`) cierran el camino del formulario, y `:530-534` (`CHOQUES`) +
`:538` (`comoError`) traducen el `23505` a `pod_duplicado` en vez de tumbar la
pantalla. Eso cierra el 500 que reporté en el pase 1.

Lo que NO cambió: `supabase/migrations/0047_operacion_encargado.sql:151`
(`create unique index if not exists pod_viaje_unico on public.pod (viaje_id)` —
sin `tenant_id`) · `:130` (`viaje_id uuid not null references public.viaje(id)` —
sin la FK compuesta que la `0028:71-85` dejó disponible con
`viaje_id_tenant_key unique (id, tenant_id)`) · `:190-191` (la policy de arriba,
que no mira `tenant_id`).

Escenario, con valores. El chofer de la flota A inserta por PostgREST, con su
propio JWT, una fila **para su propio viaje pero con el `tenant_id` de la flota
B**:

```sql
insert into pod (tenant_id, viaje_id, estado)
values ('<B>', '<viaje de A, del chofer>', 'pendiente');
```

El `WITH CHECK` de `operador_sube_su_pod` sólo mira `viaje_id`, y ése es suyo.
No hay nada que compare `pod.tenant_id` con `viaje.tenant_id`. La fila queda
**invisible para las dos flotas**: `getPods(A)` construye `porViaje` sólo con los
PODs de A (`operacion.ts:324` filtra `.eq('tenant_id', tenantId)`) y ése no está;
`getPods(B)` sí lo trae, pero ese `viaje_id` no aparece en los viajes de B, así
que el `.map` de `:338-354` nunca lo mira. Y ocupa `pod_viaje_unico` para
siempre.

Ahora el encargado de A abre `/dashboard/pod`, ve ese viaje con «Nadie lo ha
pedido» en rojo (`vista.tsx:14`), pulsa «Marcar como pedido», y la pantalla le
contesta —traducido, ya sin 500— *«Ese viaje ya tiene registro de evidencia de
entrega. Si la que llegó no sirve, recházala desde la tabla»* (`operacion.ts:490`).
En la tabla no hay nada que rechazar. Para siempre, sobre ese viaje.

Consecuencia: negación de servicio permanente sobre la evidencia de entrega de un
viaje, con la pantalla contradiciéndose a sí misma en dos renglones contiguos. La
traducción del error convirtió un 500 honesto en una instrucción imposible, y
eso es lo que pasa cuando se traduce un síntoma sin cerrar la causa en la base.

Causa raíz: `unique (id, tenant_id)` sobre `viaje` existe desde la `0028`; la
`0047` copió la forma corta y la unicidad global.

### [ALTO · REINCIDENTE] `viaje.operador_id` sigue siendo `NOT NULL`: el producto ya no miente, pero sigue sin poder representar un viaje sin asignar — y la pantalla estrella del encargado es hoy un descargo permanente

`supabase/migrations/0001_init.sql:49`
(`operador_id uuid not null references operador(id) on delete restrict`) ·
`grep -rn "operador_id" supabase/migrations/` sigue sin un solo
`alter column operador_id drop not null` en las 47 ·
`src/lib/cuadra/operacion.ts:125` (`.is('operador_id', null)` — la consulta que no
puede devolver una fila) · `:447` (`porAsignar: enCurso.filter((v) =>
!v.operador_id).length`) · `:84` (`if (!op) continue`).

Lo que SÍ se arregló: `operacion.ts:579`
(`if (!v.operadorId) throw new ErrorDeCaptura('sin_chofer')`), `:493-494` (el
texto que el encargado lee), `despacho/vista.tsx:173-174` (el `<option
value="" disabled>` sustituyó a «Asignar después», que era el default) y
`despacho/page.tsx:195-198` + `vista.tsx:26-32` (la pantalla DECLARA que el cero
no es una medición). El 23502 y el `Digest` desaparecieron, y el KPI ya no se
lee como «todo repartido». Eso cierra la mitad de «nunca inventar una cifra».

Lo que sigue: el esquema **prohíbe el estado que el módulo entero existe para
manejar**. `getViajesSinAsignar` es una consulta estructuralmente vacía que se
sigue ejecutando en cada carga; el KPI «Por asignar» es un `0` constante con una
nota de disculpa; y el bloque «Sin asignar» es un `EstadoVacio` de cuatro
renglones explicando una restricción de la base. Escenario con valores: en el
demo, el contralor pregunta «¿y si me entra un viaje y todavía no sé quién lo
lleva?» y la respuesta del producto es que no se puede capturar.

Consecuencia: la pantalla del jefe de tráfico llega al 6-ago sin la función que
la encabeza, y lo que se enseña en su lugar es el texto de un constraint.

Causa raíz: la `0001` declaró que un viaje nace de un operador de WhatsApp; la
`0044` inventó al encargado y la `0047` le dio tablas, y nadie volvió a mirar esa
columna.

### [ALTO · REINCIDENTE] El chofer conserva `tenant_data for all` sobre seis tablas que la `0045` no tocó, incluida la del archivo fiscal

`supabase/migrations/0045_rls_operador.sql:39` (el `foreach` recorre sólo
`viaje, gasto, liquidacion`) · `supabase/migrations/0001_init.sql:110` (la lista
real: `terminal, operador, politica_gasto, viaje, gasto, liquidacion,
wa_conversacion`) · `supabase/migrations/0003_costos.sql:24` (`llm_costo`) ·
`supabase/migrations/0009_xml_crudo_efos.sql:15` (`cfdi_xml`) ·
`supabase/migrations/0047_operacion_encargado.sql:174-175` (donde SÍ va
`and not is_operador()`, que demuestra que el criterio correcto ya está escrito).

Escenario, con valores: el chofer de A, con el JWT que le da `/mis-viajes`, hace
`PATCH /rest/v1/operador?id=eq.<uuid del compañero>` con `{"activo": false}`. La
policy pasa. Desde ahí `resolveOperador` filtra `.eq('activo', true)`, no lo
encuentra, y los mensajes de WhatsApp de ese compañero se contestan «no te tengo
registrado». La misma llave sirve para
`DELETE /rest/v1/cfdi_xml?tenant_id=eq.<A>`, que borra el XML crudo que la `0009`
guarda por el art. 30 del CFF (5 años). Verificado sin cambios en este árbol.

Consecuencia: sabotaje interno sin log, y pérdida del archivo fiscal de la flota.

### [ALTO · REINCIDENTE, MITIGADO EN LA APP] El bucket `avatares` sigue público, sin `file_size_limit` ni `allowed_mime_types`, y con `INSERT` directo para cualquier `authenticated` — el chofer incluido

`supabase/migrations/0046_perfil_avatar.sql:17-19`
(`insert into storage.buckets (id, name, public) values
('avatares','avatares',true)` — tres columnas; los dos límites se quedan NULL) ·
`:28-30` (`avatares_propio_insert … with check (bucket_id = 'avatares' and
(storage.foldername(name))[1] = auth.uid()::text)`: la única condición es la
CARPETA) · `:43-45` (`avatares_lectura_publica … for select to public`).

Lo que SÍ se arregló, y es real: `src/app/admin/mi-perfil/avatar-validacion.ts:28-30`
(lista blanca `image/jpeg|png|webp`, con SVG excluido por el XSS y el motivo
escrito), `:38` (`MAX_AVATAR_BYTES = 4 MiB`), `:51-52`, y
`src/app/admin/mi-perfil/acciones.ts:45-49` lo aplica antes de subir. El camino
del producto ya no acepta un ZIP de 40 MB.

Lo que no cambió es de quién es la restricción. El objeto del bucket sigue sin
declarar ni MIME ni tamaño, y `avatares_propio_insert` sigue autorizando a
`authenticated` a escribir en su propia carpeta **sin pasar por el server
action**. Escenario, con valores: un `app_user` con `rol='operador'` —que no
tiene pantalla de perfil en ningún panel— manda
`POST /storage/v1/object/avatares/<su auth.uid>/carga.zip` con
`Content-Type: application/zip` y 40 MB. La policy pasa; el bucket no tiene con
qué negarse; el objeto queda con URL pública permanente en el dominio de Storage
de Likida, repetible con `carga2.zip`, `carga3.zip`… `validarAvatar` no está en
ese camino.

Consecuencia: alojamiento anónimo con la marca de Likida detrás, más la factura
de egress. Y es el ejemplo de manual de mi rubro: la invariante «un avatar es una
imagen chica» la impone hoy **sólo** la aplicación, teniendo `storage.buckets`
dos columnas para imponerla de verdad.

### [ALTO · REINCIDENTE] `app_user.operador_id` sigue siendo la única FK de identidad sin `tenant_id`, y las tres policies que la usan tampoco lo llevan

`supabase/migrations/0045_rls_operador.sql:20-21`
(`add column if not exists operador_id uuid references public.operador(id) on
delete set null` — FK simple) · `:31-34` (`get_user_operador_id()` no compara
tenants) · `:52-59` (`using (operador_id = get_user_operador_id())`, sin un solo
predicado sobre `tenant_id`) · `supabase/migrations/0028_fks_con_tenant.sql:71-85`
(`operador_id_tenant_key unique (id, tenant_id)` ya existe).

Lo que SÍ se arregló: `src/lib/auth/provisionar.ts:63-72` ahora comprueba contra
la base que el `operador_id` pertenezca al `tenantId` antes de escribir, con el
razonamiento escrito. El camino del producto está cerrado.

Escenario que la base sigue aceptando: `update app_user set operador_id = '<uuid
de un operador de la flota B>' where email = 'chofer@flota-a.com'` desde la
consola de Supabase o cualquier script. La FK sólo exige que el operador exista.
Ese chofer entra a `/mis-viajes`, `requireOperador` sólo exige `operadorId` no
nulo, y las tres policies le devuelven viajes, gastos y liquidaciones de la
flota B.

Consecuencia: fuga entre flotas por un `UPDATE` de una columna, sin rastro: para
la base es una fila válida.

## Hallazgos MEDIO

### [MEDIO · NUEVO] `andamiaje_local.sql` describe una FK que nace en la 0053 y un bloque 34 de verificación: ninguno de los dos existe, así que el andamiaje verifica un esquema que este repo no puede producir

`supabase/andamiaje_local.sql:61-62` (*«`auth.users` es el destino de
`app_user.id` (0001 lo dice en un comentario, y **la migración 0053 lo convierte
en FK de verdad**)»*) · `:66-68` y `:71-73` (*«el **bloque 34** de
`verificaciones.sql` inserta en `auth.users` imitando a GoTrue… Están aquí para
que ese bloque mida la FK de la 0053»*) · `:81` · contra `ls
supabase/migrations/`, que termina en `0047`, y contra
`grep -n "^-- ── [0-9]" supabase/verificaciones.sql`, cuyo **último título es el
28** (`:1068`). No existe ni la 0053 ni el bloque 34.

Escenario: alguien corre `scripts/verificar-sql.sh` para dar por comprobado el
esquema antes del demo. El andamiaje monta `auth.users` con `instance_id`, `aud`,
`role` y `raw_app_meta_data` —columnas que existen sólo para un bloque que no
está—, las 47 migraciones se aplican, los 28 bloques pasan, y el archivo que
documenta el arnés afirma que `app_user.id` es una FK. En el árbol,
`0001_init.sql:16` sigue siendo `id uuid primary key, -- = auth.users.id`: un
comentario. `grep -rn "auth.users" supabase/migrations/` devuelve **cero**.

Consecuencia: el único mecanismo del repo que puede demostrar una garantía de
base describe por escrito una garantía que no aplica. Quien lo lea concluye que
el huérfano de Auth está cerrado por el esquema, cuando lo que lo compensa es
`provisionar.ts:60-90`, en TypeScript.

### [MEDIO · REINCIDENTE, DEGRADADO] La colisión de ordinales 0046/0047 ya no es silenciosa — pero la guarda sólo dispara DESPUÉS del merge, y no existe la guarda inversa, que es por donde entró la 0052

`src/lib/cuadra/migraciones_verificadas.test.ts:137-153` (nuevo en esta rama:
*«ningún ordinal nombra dos migraciones distintas»*, agrupando por `f.slice(0,4)`
y fallando en rojo si dos archivos comparten prefijo) · `:117-135` (el
razonamiento, correcto y completo) · `ls supabase/migrations/` — hoy no hay
ningún ordinal repetido, así que la prueba pasa **en vacío**.

Esto cierra la mitad silenciosa del CRÍTICO 3 del pase 1 y lo digo: el riesgo se
volvió un rojo. Queda lo que la prueba no puede ver:

1. **Dispara tarde.** Sólo falla cuando los cuatro archivos ya están en el árbol,
   o sea después del merge del PR #7. Antes del merge —hoy— no dice nada, y la
   decisión de renumerar hay que tomarla antes.
2. **No hay guarda inversa.** Ninguna prueba compara lo que el código llama
   (`admin.rpc('…')`, `.select('columna')`) contra lo que las migraciones crean.
   Ése es exactamente el hueco por el que entró `triggers_desactualizados` (0052)
   y el comentario de `permisos.ts` sobre la 0048. La prueba mira el directorio
   de migraciones; el defecto vive en el otro lado del contrato.

### [MEDIO · REINCIDENTE] La `0047` no es idempotente en sus seis `create policy` ni deja escrita su reversión, y es la migración que más objetos crea de golpe

`supabase/migrations/0047_operacion_encargado.sql:172-176` (`create policy
tenant_data` dentro del `do $$`, sin `drop policy if exists` delante) · `:183-185`
· `:187-188` · `:190-191` · todo lo demás del archivo SÍ es idempotente
(`create table if not exists` en `:31,73,97,127`; `add column if not exists` en
`:64-65`) · contra `supabase/migrations/0046_perfil_avatar.sql:27,32,37,42`
(`drop policy if exists` + `create policy`, con el motivo escrito en `:24-26`) y
contra `0025_dominios_check.sql:69-70` y `0028_fks_con_tenant.sql:59-60`, que sí
escriben cómo revertir.

Escenario, con valores: se re-aplica la `0047` sobre una base donde ya corrió (un
`db push` repetido, un `db reset` parcial, o el merge del PR #7). Las cuatro
`create table if not exists` no hacen nada, los índices tampoco, y en `:172` el
`execute format` truena con
`42710 policy "tenant_data" for table "unidad" already exists`. Quien lo destrabe
la madrugada del 6-ago no tiene escrita ni una línea de cómo revertir 4 tablas,
1 columna en `viaje`, 5 índices y 6 policies.

### [MEDIO · NUEVO] Nada devuelve la unidad a `disponible` cuando el viaje se liquida: `unidad.estado='en_ruta'` sin viaje abierto es un estado que la base acepta y que el propio código declara imposible

`src/lib/cuadra/operacion.ts:600`
(`if (v.unidadId) await cambiarEstadoUnidad(tenantId, v.unidadId, 'en_ruta')`) ·
`:634-635` (el único punto que devuelve `'disponible'`, y sólo cuando se CAMBIA
la unidad de un viaje) · `:616-619` (el comentario que declara la invariante:
*«Sin esto, el encargado despacha las ocho unidades de la mañana y al mediodía el
tablero sigue diciendo "8 disponibles"»*) ·
`grep -n "unidad" supabase/migrations/0013_guardar_liquidacion_tx.sql
supabase/migrations/0021_liquidacion_litros_diesel.sql` → **cero**: la RPC que
cierra la liquidación y pone `viaje.estatus='liquidado'` no toca `unidad` ·
`src/lib/cuadra/operacion.ts:448`
(`unidadesDisponibles: unidades.filter((u) => u.estado === 'disponible').length`) ·
`src/app/dashboard/despacho/page.tsx:154`
(`unidadesLibres = unidades.filter((u) => u.estado === 'disponible' && u.activo)`).

Escenario, con valores: la flota da de alta 8 unidades (`C2-01`…`C2-08`), todas
`disponible`. El lunes el encargado crea 8 viajes con unidad; las 8 pasan a
`en_ruta`. El viernes los 8 viajes se liquidan por WhatsApp. Las 8 unidades
siguen en `en_ruta`. El lunes siguiente el KPI «Unidades disponibles» dice **0**,
el `<select>` de «Dar de alta un viaje» ofrece únicamente «Sin unidad», y el único
modo de recuperarlas es mover las ocho a mano desde `/dashboard/unidades`.

Consecuencia: el tablero afirma que la flota entera está en carretera cuando está
en el patio — la mentira exacta que el comentario de `:616-619` dice haber
cerrado, en la otra dirección. Anoto la frontera de mi rubro con honestidad: esto
NO se puede imponer con un `CHECK` (es coherencia entre dos tablas); lo que le
toca a la base es un trigger sobre `viaje.estatus`, o que la RPC de cierre lo
haga. Lo que no puede quedarse es que ningún camino lo haga.

## Hallazgos BAJO

### [BAJO · REINCIDENTE] Los cuatro enteros de la `0047` siguen sin dominio: `anio`, `km_actual`, `km_servicio` y `sla_horas` aceptan negativos y disparates

`supabase/migrations/0047_operacion_encargado.sql:38` (`anio int`) · `:40`
(`km_actual int`) · `:80` (`km_servicio int`) · `:107` (`sla_horas int`) — los
cuatro sin `CHECK`, en una migración con seis `CHECK` de dominio de texto.

La app tapó parte: `src/app/dashboard/incidencias/page.tsx:103`
(`if (slaHoras !== null && (!Number.isInteger(slaHoras) || slaHoras < 1))`) ya
rechaza el SLA negativo y el cero. `unidades/page.tsx:104` sólo exige
`Number.isInteger(anio)`: `anio = -3` y `anio = 999999` pasan, y se pintan como
el año del camión (`operacion.ts:213`, `unidades/vista.tsx`). Y el camino de la
consola de Supabase —que es como se cargan los datos hoy, según la propia
`0025:14-16`— no pasa por ninguna de las dos validaciones:
`insert into incidencia (tenant_id, tipo, sla_horas) values ('<A>','averia',-5)`
la acepta la base, `getIncidencias` calcula `horas = 0`, y `0 > -5` es cierto:
la incidencia **nace con el SLA vencido**, en rojo, en la bandeja del encargado
(`operacion.ts:287`).

### [BAJO · REINCIDENTE, DEGRADADO] `rol='operador'` con `operador_id` NULL sigue sin `CHECK`; lo que cambió es que la aplicación ya no lo crea

`supabase/migrations/0045_rls_operador.sql:23-24` (el comentario declara la
invariante —*«Solo se llena cuando rol = 'operador' … NULL para los otros 4
roles»*— y no hay `CHECK` en ninguna de las dos direcciones).

Cerrado en el camino del producto: `src/lib/auth/provisionar.ts:62-71` rechaza
`rol='operador'` sin `operadorId` **antes** de tocar Auth, y `:67-70` rechaza
también el caso contrario (`operadorId` con otro rol). Baja de MEDIO a BAJO por
eso. Lo que la base sigue aceptando, desde la consola o un script:
`update app_user set rol='operador' where email='…'` sobre una fila con
`operador_id` NULL — y `guard.ts` manda a esa persona a `/sin-acceso`, la
pantalla que dice «pide tu alta», a alguien a quien acaban de dársela. Falta el
`CHECK ((rol='operador') = (operador_id is not null))`.

### [BAJO · REINCIDENTE] `app_user.id` sigue sin FK a `auth.users`; la compensación vive en TypeScript

`supabase/migrations/0001_init.sql:16` (`id uuid primary key, -- = auth.users.id`
— un comentario; `grep -rn "auth.users" supabase/migrations/` devuelve cero) ·
`:18` (`email text not null unique`).

Cerrado en el camino del producto y bien: `src/lib/auth/provisionar.ts:15-32`
documenta el huérfano y compensa borrando el usuario de Auth si el insert falla,
dejando su correo escrito si el borrado también falla. Pero la relación 1-a-1
sigue viviendo en un comentario: se borra un usuario desde la consola de Auth y
su fila de `app_user` sobrevive porque nada la ata; se vuelve a dar de alta el
mismo correo y el `insert` truena con `23505 … "app_user_email_key"`.

## Lo que revisé y está bien

- **Las siete escrituras del encargado ahora comprueban el tenant del id que va
  como VALOR**, que es exactamente el hueco que dejaban las FK de una sola
  columna de la `0047`: `operacion.ts:554-561` (`exigirDelTenant`), llamada en
  `:377-378` (pod), `:580-581` (viaje/unidad), `:622` (asignarUnidad) y
  `:682-683` (incidencia). El comentario de `:464-476` nombra la causa correcta
  —*«Las FK de la 0047 son de una sola columna, así que la base aceptaría feliz
  una unidad de otra flota»*—. Es la mitigación correcta para un esquema que no
  se puede tocar hoy, y está escrita como mitigación, no como arreglo.
- **El `23505` se traduce por NOMBRE de índice, no por código.**
  `src/lib/cuadra/pg_errores.ts:40-45` (`violaIndice` exige `code === '23505'`
  Y que el nombre aparezca en `message`/`details`) + `operacion.ts:530-534`
  (`CHOQUES`: `uq_viaje_abierto_por_operador`, `unidad_economico_unico`,
  `pod_viaje_unico`) + `:536-540` (`comoError`, que deja subir cualquier otro).
  Es la lectura correcta: `23505` no es una categoría. Cierra el MEDIO del pase 1
  («un 23505 sale como 500») sin tragarse el bug que sí lo sea.
- **Un `UPDATE` que no empató ninguna fila es un fallo declarado.**
  `operacion.ts:542-545` (`tocadas`) + `:399`, `:632`, `:643`, `:716`. PostgREST
  contesta 204 sin error, así que sin esto «no había nada que actualizar» y «se
  actualizó» entraban por el mismo camino y las dos pintaban verde.
- **El arranque ya sonda la 0045, la 0046 y la 0047**, que era mi CRÍTICO 2 del
  pase 1: `startup.ts:122-126` (`app_user.operador_id`), `:135-139`
  (`app_user.avatar_url`, con el razonamiento de por qué falla el select
  ENTERO), `:145-149` (`pod`, elegida porque es la última tabla que crea el
  archivo). Y `:176-183` declara por escrito por qué la 0038 y la 0044 NO se
  sondean. Ese hallazgo está cerrado salvo por el CRÍTICO 1 de arriba, que
  rompe el `{ok:true}` que estas tres sondas alimentan.
- **Los `CHECK` de dominio de la `0025` siguen intactos y siguen empatando con
  TypeScript, valor por valor.** `gasto_concepto_dominio` (`:82-84`) ↔
  `ConceptoGasto` (`types/cuadra.ts:20-25`), `gasto_estado_sat_dominio` (`:88-90`)
  ↔ `EstadoSat` (`:27`), `liquidacion_estatus_dominio` (`:125-127`) ↔
  `EstatusLiquidacion` (`:120`), `viaje_estatus_dominio` (`:110-112`),
  `app_user_rol_dominio` (`:136-138`) + la extensión de la `0044`. Busqué
  específicamente un tipo de TypeScript **más estricto que su columna** en
  `operacion.ts` y en `types/cuadra.ts` y **no lo hay**: los campos declarados
  `string` (`UnidadRow.numeroEconomico:144`, `IncidenciaRow.abiertaEn:237`,
  `CargaOperador.nombre:27`) corresponden a columnas `not null`. El desajuste de
  este módulo va en la otra dirección y es el ALTO de `viaje.operador_id`.
- **La razón por la que la `0025` NO puso `CHECK (monto > 0)` sigue siendo
  correcta** (`0025:41-47`): un comprobante ilegible que entra y se marca
  `monto_invalido` vale más que una foto perdida en un `INSERT` fallido. Lo que sí
  prohíbe —`gasto_monto_no_nan`— es la elección exacta. No lo reporto y lo
  respaldo.
- **`unidad_economico_unico unique (tenant_id, numero_economico)`
  (`0047:51`)** sigue siendo la unicidad hecha bien, con el razonamiento escrito
  en `:48-50`. Es el contraste dentro del mismo archivo con `pod_viaje_unico`.
- **Los dos `CHECK` de coherencia de la `0047`** —`mantenimiento_cierre_coherente`
  (`:90-91`) e `incidencia_cierre_coherente` (`:116-117`), con la forma
  `(estado = 'X') = (columna is not null)`, que cubre las DOS direcciones— son la
  clase de restricción que este rubro pide, y se nota: `cambiarEstadoIncidencia`
  (`operacion.ts:709-717`) existe porque la base no la deja olvidarse, y su
  llamador (`incidencias/page.tsx:79`) valida el dominio antes para dar un
  redirect y no un 500. Aquí la base manda y el código obedece.
- **La `0026` es el mejor `CHECK` del repo por lo que valida y por cómo lo dice**
  (lanza con el motivo en vez de devolver `false`). Su único defecto es de
  autoría, no de contenido, y es el CRÍTICO 2.
- **`migraciones_verificadas.test.ts` sigue obligando a cada migración a tomar una
  decisión** (bloque o exención con razón), y ahora además veta los ordinales
  repetidos (`:137-153`). Los bloques 26, 27 y 28 de `verificaciones.sql`
  (`:986`, `:1022`, `:1068`) existen con salida real fechada el 3-ago.
- **`provisionarUsuario` verifica contra la BASE que el `operador_id` sea del
  tenant** (`provisionar.ts:63-72`), no contra el `<select>` que pintó la lista.
  Es el criterio correcto y está aplicado antes de tocar Auth.
- **Trampas conocidas, verificadas sin cambios y no reportadas:** `gasto.ocr_raw`
  muerta, `politica_gasto` muerta (`0032`), `wa_mensaje_procesado` sin
  `tenant_id` (`0012`), el dominio de `viaje.estatus`, y `cliente`/`unidad`/
  `tarifa`/`factura_emitida`/`pago_recibido`/`posicion`/`geocerca` — de las de
  este árbol, `unidad`, `mantenimiento`, `incidencia` y `pod` EXISTEN (0047) y
  sólo `mantenimiento` sigue sin un escritor en `src/`
  (`grep "from('mantenimiento')"` → una lectura, `operacion.ts:171`).

## Lo que NO pude verificar sin una base

- **No hay Postgres, ni Supabase, ni el CLI.** Los SQLSTATE que cito
  (`23502`, `23505`, `42710`, `42703`, `PGRST202`) salen del texto de la
  restricción o del mensaje que el propio repo escribe, no de haberlos golpeado.
  No apliqué una migración ni corrí un `select`.
- **No pude ejercer las policies.** Los escenarios de `tenant_self`,
  `operador_sube_su_pod` y `tenant_data` salen de leer el `using`/`with check` y
  el `grant` que `andamiaje_local.sql:136-141` replica. En particular, **no
  comprobé si PostgREST aplica la RLS de `viaje` dentro del subselect de
  `operador_sube_su_pod`**; lo asumo (es el comportamiento de Postgres para
  expresiones de policy) y por eso el escenario del CRÍTICO cruzado se limita a
  los viajes propios del chofer, que es la variante conservadora.
- **El comportamiento exacto de `supabase db push` ante dos archivos con el mismo
  ordinal** sigue sin ejercerse. Lo que sí es medible y lo medí: el árbol de hoy
  no tiene ordinales repetidos y ahora existe una prueba que los vetaría.
- **Los bloques 26, 27 y 28 de `verificaciones.sql` declaran haberse corrido el
  3-ago** contra la base real, con salida copiada. Les creo por lo que dicen, no
  porque yo los haya visto correr. Y ninguno de los tres prueba qué puede
  ESCRIBIR el chofer ni con qué `tenant_id` — el 28 prueba que NO LEE, que es
  cierto y no es lo que este reporte cuestiona.
- **`liquidacion` sigue sin trigger de «no se reescribe tras emitida»**, al revés
  que `gasto` (`0036`/`0037`/`0042`). Un `flota_admin` o un `contador` con su JWT
  puede `PATCH /rest/v1/liquidacion` sobre `total_comprobado`. No lo levanto como
  hallazgo aparte por tercera ronda —queda dentro del ALTO de `tenant_data`— pero
  con el CRÍTICO 1 vivo, la sonda que vigila esa familia de triggers ya no
  reporta nada, así que el siguiente sitio donde va a doler tiene ahora un vigía
  ciego.
- **Las policies del bucket `liquidaciones`** (`0008`) siguen sin bloque de
  verificación; pendiente arrastrado desde la ronda 5.
- **No revisé columna por columna las consultas de `analytics.ts`** contra el
  esquema; sólo donde tocan columnas nacidas en la 0044–0047, que es en ningún
  sitio.
- **La compuerta no está en verde hoy** (4 pruebas en 3 archivos), pero las
  cuatro son de tiempo de ejecución en este sandbox y ninguna toca SQL. Lo anoto
  para que no se lea como que la línea base del MAPA sigue vigente.
