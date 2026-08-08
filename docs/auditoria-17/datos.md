# Modelo de datos y esquema — auditoría 17

**Nota: 7/10** (antes 7). Razón del movimiento: **se atacó y subió** el hallazgo
abierto (`operador_sube_su_pod` quedó amarrado en la `0081`, verificado línea por
línea) — pero **la deuda cobró factura por el otro lado**: el ALTO que la ronda 16
declaró cerrado sigue medio abierto (`REINCIDENTE`), la `0084` que se anunció como
el arreglo del camino caliente es SQL que nadie llama, y tres migraciones seguidas
(`0082`/`0083`/`0085`) borraron en silencio el `search_path` que la `0035` le había
fijado al validador de `tenant.config`. Los dominios y las unicidades críticas
siguen bien puestos; lo que falta ahora es de otra clase: **coherencias entre
columnas que solo vive en un comentario**.

El riesgo mayor del rubro hoy: `gasto.fecha` es NULLABLE y **tres caminos del
mismo cálculo del 15% le dan tres valores por omisión distintos** (el SQL lo
excluye, el motor lo incluye, `desde_db` lo resta). Nada en la base obliga a que
un comprobante que entra al contador del ejercicio tenga fecha.

---

## Hallazgos

### [ALTO · REINCIDENTE] El gasto SIN FECHA se resta de un contador del que nunca formó parte

`src/lib/likida/cuadre/desde_db.ts:86-90` · `src/lib/likida/repo.ts:832-833` ·
`supabase/migrations/0001_init.sql:62`

La ronda 16 (`4e866fc`) escribió el comentario *"un gasto de otro año **(o sin
fecha)** no está en el contador y restarlo fabricaba un previo negativo"* y el
filtro que puso es:

```ts
.filter((g) => (g.fecha?.slice(0, 4) ?? anioEjercicio) === anioEjercicio && …)
```

Con `g.fecha` nula, `?.` da `undefined` y el `??` sustituye **`anioEjercicio`**:
la comparación es `anioEjercicio === anioEjercicio` → **true**. El gasto sin fecha
SÍ se resta. Se arregló el cruce de año; el caso "sin fecha" quedó exactamente
como estaba, con un comentario que afirma lo contrario.

Del otro lado, `getAcumuladoCombustible` filtra `.gte('fecha', …).lte('fecha', …)`
(`repo.ts:832-833`), y en SQL `NULL >= '2026-01-01'` es NULL → la fila **no entra**
al acumulado. Y el motor, en `engine.ts:313-314`, hace
`mismoEjercicio = !anioComprobante || …` → una fecha nula **sí** consume cupo del
15%. Tres criterios distintos para la misma fila.

**Escenario:** flota elegible al 15% (`facilidadCombustibleEfectivo` declarada,
como en `seed.sql`). Ejercicio 2026: `sumar(monto)` de combustible con fecha =
$1,200,000 → tope 15% = $180,000, ya consumido por completo en efectivo en viajes
previos. Llega el viaje del día con un ticket de diésel en efectivo de **$18,000
cuyo `fecha` el OCR no pudo leer** (columna nullable, caso normal en térmico
descolorido; `repo.ts` lo mapea a `undefined`).

- `totalesEjercicio.efectivo` = 180,000 (el de $18,000 no está: no tiene fecha).
- `efectivoDeEsteViaje` = 18,000 (**sí se resta**: el `??` lo dio por del año).
- `efectivoPrevEjercicio` = 180,000 − 18,000 = **162,000**.
- `engine.ts:339` → `cupoRestante = max(0, 180,000 − 162,000)` = **18,000**;
  `excedenteDeEste` = 0 → diferencia **`combustible_efectivo_dentro15`**.

Sale: *"deducible por la facilidad del 15% (RFA 2026 regla 2.9)"* sobre $18,000
que en realidad caen **fuera** del tope (`efectivo_sobre_15`, no deducible).

**Consecuencia:** el PDF que el contralor archiva declara $18,000 de deducción de
ISR que el SAT no admite, con la cita de la regla al lado. Es una cifra inventada
en la dirección que nadie revisa (a favor de la flota).

**Causa raíz probable:** la base no impone "todo gasto que entra al contador del
ejercicio tiene fecha" (`gasto.fecha date` sin NOT NULL ni CHECK condicionado a
`concepto='diesel'`), así que cada consumidor eligió su propio default para el
NULL y los tres eligieron distinto.

---

### [MEDIO] La `0085` (y la `0082` y la `0083`) borraron el `search_path` que la `0035` le fijó a `config_tenant_valida`

`supabase/migrations/0085_fix_config_tenant_valida_tipo.sql:17-21` ·
`supabase/migrations/0035_search_path_fijo.sql:27`

La `0035` hizo `alter function public.config_tenant_valida(p_config jsonb) set
search_path = public, pg_catalog;` — y su propio encabezado explica por qué: es
la función de la que cuelga el CHECK `tenant_config_valida`, o sea todos los topes
de dinero de la flota.

La `0085` la redefine con `CREATE OR REPLACE FUNCTION … LANGUAGE plpgsql
IMMUTABLE AS $function$` y **sin cláusula `SET`**. En PostgreSQL `CREATE OR
REPLACE FUNCTION` reconstruye la tupla completa de `pg_proc`: los atributos que no
se nombran vuelven a su default, y `proconfig` vuelve a **NULL**. (La ACL sí se
preserva; `proconfig` no.) La `0082:11` y la `0083:8` ya lo habían hecho igual —
esta es la tercera vez, y como la `0085` es la última migración, el estado de hoy
es `proconfig = NULL`.

**Escenario:** el `tenant` solo se escribe por `service_role` (la `0078:55-57` lo
dejó de solo-lectura por RLS), así que el camino de usuario está cerrado — pero un
script de migración de datos o la consola SQL de Supabase corriendo

```sql
set search_path = pg_temp, public;
create function pg_temp.jsonb_exists(jsonb, text) returns boolean
  immutable language sql as $$ select false $$;
update tenant set config = '{"politica": []}'::jsonb where id = '1111…';
```

pasa el CHECK: cada `jsonb_exists(p_config, …)` del validador resuelve contra la
función temporal, ninguna rama se evalúa y la función devuelve `true`. Queda una
flota con `politica = []`, que es justo lo que la `0085:97-100` describe como
"quita el tope de TODOS los conceptos sin dejar rastro": la liquidación sale sin
una sola diferencia `sobre_politica` y parece que la flota cumple.

**Consecuencia:** el único guardia declarativo de los topes de dinero depende del
`search_path` de quien escribe, que es exactamente la propiedad que la `0035`
compró y que nadie volvió a comprobar — el bloque 49 de `verificaciones.sql`
(`0074`) solo audita `proconfig` de las **cuatro** funciones de RLS, no de ésta.

**Causa raíz probable:** el patrón "copia íntegra de la función anterior + el
cambio" se aplicó al **cuerpo** y no a los atributos; la `0074` documenta el
razonamiento correcto (*"se usa `alter function … set search_path` a propósito, y
NO un `create or replace`"*) y las tres migraciones de `config` no lo siguieron.

*(De la misma familia, BAJO: la `0084:15` fija `search_path = public, pg_catalog`
sin nombrar `pg_temp`, contra el criterio que la `0074` estableció.)*

---

### [MEDIO] `cfdi_consolidado_linea`: "conciliada ⇒ gasto_id no nulo" está escrito en el comentario, no en un CHECK — y el propio `ON DELETE SET NULL` lo rompe

`supabase/migrations/0076_cfdi_consolidado.sql:57` y `:69-70` ·
`supabase/migrations/0077_cfdi_consolidado_sin_match.sql:29`

El comentario de la tabla dice literalmente: *"`estatus=conciliada` implica
`gasto_id` no nulo Y que `gasto.cfdi_uuid`/`cfdi_orden` ya se escribieron"*. No hay
ningún CHECK que lo imponga — a diferencia de las **seis** tablas hermanas que sí
lo tienen (`comprobante_huerfano_cierre_coherente` 0073, `incidencia_cierre_coherente`
y `ticket_cierre_coherente` 0051, `mantenimiento_cierre_coherente` 0047,
`arco_cierre_coherente` 0053, `factura_saas_pagada_coherente` 0066).

Y la columna se declara `gasto_id uuid references public.gasto(id) **on delete set
null**`, o sea que la base tiene un camino propio para producir el estado que el
comentario declara imposible.

**Escenario:** CFDI consolidado de monedero Edenred por $180,000, 24 líneas, las 24
conciliadas contra 24 gastos. Alguien borra un viaje mal capturado
(`delete from viaje where id = '4444…'`, consola o script de limpieza). Los 3
gastos de diésel de ese viaje se van por `gasto_viaje_id_fkey … on delete cascade`
(0001:60). Las 3 líneas del consolidado quedan con
`estatus = 'conciliada'`, `gasto_id = NULL`, `monto = 7,500` cada una.

- El índice parcial `cfdi_consolidado_linea_por_conciliar_idx` (0076:78-80) filtra
  `where estatus = 'por_conciliar'` → esas 3 líneas **no reaparecen en la cola**.
- El resumen de `guardarYConciliarConsolidado` (`consolidado.ts:250`) cuenta
  `estatus === 'conciliada'` → sigue diciendo **24 de 24**.
- `resolverLineaAMano` (`consolidado.ts:359`) rechaza cualquier línea cuyo estatus
  no sea `por_conciliar` → tampoco hay forma de reabrirlas desde el panel.

**Consecuencia:** $22,500 de un CFDI que la flota va a acreditar dejan de estar
amparados por ningún gasto y el panel de Combustible & Casetas afirma "0 por
revisar". Es una fila que miente en la dirección exacta que la tabla existe para
impedir ("sin esta tabla esas líneas simplemente DESAPARECERÍAN", 0076:24-25).

**Causa raíz probable:** la coherencia se documentó en `comment on table` en vez de
en un `CHECK`, y el `ON DELETE SET NULL` se eligió mirando la integridad
referencial sin mirar el dominio de `estatus`.

---

### [MEDIO] El trigger de "nada se reescribe tras liquidar" es un allowlist con `concepto`, `forma_pago` y `clave_prod_serv` fuera — y sin brazo de DELETE

`supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql:22-30` ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql:76-79`

El `when` de `trg_gasto_no_tras_liquidar_update`, en su forma final, cubre
`monto`, `sub_total`, `iva_traslado`, `ieps_traslado`, `cfdi_uuid` y `fecha`. Es
un allowlist que ya se extendió dos veces por auditoría (la `0037` le añadió el
UPDATE, la `0042` le añadió `fecha`) y sigue sin **las dos columnas que deciden la
rama fiscal más grande del motor**:

- `forma_pago` — `'01'` es lo que dispara `combustible_efectivo` /
  `efectivo_sobre_15` / `efectivo_no_elegible` (`engine.ts:302`) y
  `efectivo_sobre_tope` (LISR 27-III).
- `concepto` — decide `politicaPara` (el tope) y `esCombustible` (el 15%).
- `clave_prod_serv` — la otra mitad de `esCombustible`.

Y `trg_gasto_no_tras_liquidar` es `before insert` a secas: **no hay trigger de
DELETE**, así que un gasto puede desaparecer de un viaje ya liquidado.

**Escenario:** viaje liquidado, PDF emitido con un diésel de $12,000 marcado
deducible al 100% (forma de pago `'03'`, transferencia). Después del cierre:

```sql
update gasto set forma_pago = '01' where id = '5555…';   -- pasa: no está en el `when`
delete from gasto where id = '5555…';                    -- pasa: no hay trigger de delete
```

Ninguna de las dos levanta el `CU001` que `processor.ts:2062` sabe traducir. El
mismo statement sobre `fecha` sí lo levanta. La siguiente lectura (`cuadrar_viaje`
desde el chat, el panel, o un `reabrirViaje` + recierre) devuelve un
`totalDeducible` distinto del que ya está impreso en el PDF archivado.

**Consecuencia:** el PDF que el contralor tiene en la mano y lo que la app le dice
del mismo viaje dejan de coincidir — que es textualmente el defecto que la `0036`
llama "el peor bug histórico del camino del dinero".

**Causa raíz probable:** el `when` se construyó enumerando las columnas que el
código de ese momento tocaba (`updateGastoCfdiXml`, `corregirFechaGasto`) en vez de
enumerar las que el PDF imprime; y el DELETE nunca se consideró porque ninguna
función de `src/` borra gastos hoy.

---

### [MEDIO] `guardar_liquidacion_tx`: el `ON CONFLICT DO UPDATE` no vuelve a comprobar el tenant, y la FK compuesta de la `0028` no lo cubre

`supabase/migrations/0021_liquidacion_litros_diesel.sql:37-50` ·
`supabase/migrations/0028_fks_con_tenant.sql` (comentario final)

La `0028` afirma: *"Cierra por esquema el hueco de `guardar_liquidacion_tx`, que
recibe el tenant como parámetro y nunca lo compara contra el del viaje."* Eso es
cierto para la rama **INSERT** — `liquidacion_viaje_tenant_fkey` la rechaza. No lo
es para la rama `on conflict (viaje_id) do update`: el `SET` de la `0021:38-49` no
toca ni `tenant_id` ni `viaje_id`, y PostgreSQL **no re-dispara el chequeo de una
FK cuando las columnas de la clave no cambian** (`RI_FKey_check` sale temprano si
las llaves son iguales). Además el `do update` no lleva `where tenant_id = p_tenant`.

**Escenario:** `select guardar_liquidacion_tx('<tenant B>', '<viaje de A que ya
tiene liquidación>', 9900, 9900, 0, 'cuadrada', '[]', 0,0,0, null, 0);` — el
INSERT choca contra `liquidacion_viaje_uidx` (0005:9), cae en el `DO UPDATE` y
**sobrescribe `total_comprobado`, `total_anticipo`, `diferencia`, `estatus` y
`diferencias` de la liquidación de la flota A** con los números de B. La FK no se
entera (las llaves no cambiaron) y el `update viaje … where tenant_id = p_tenant`
de la línea 51 no afecta ninguna fila, así que ni siquiera queda rastro en el
estatus del viaje.

**Consecuencia:** la liquidación archivada de una flota queda con las cifras de
otra, sin error y sin bitácora. Hoy solo `service_role` la ejecuta y la app resuelve
tenant y viaje del mismo contexto, así que el camino es de script/consola/bug
futuro — que es precisamente la clase de camino que la `0028` dice haber cerrado.

**Causa raíz probable:** se asumió que la FK compuesta protege la función entera;
protege el INSERT.

---

### [MEDIO] La `0084` es SQL muerto: `sumar_combustible_ejercicio` no la llama nadie, y el barrido paginado sigue en el camino caliente

`supabase/migrations/0084_sumar_combustible_ejercicio.sql:11` ·
`src/lib/likida/repo.ts:803-865` ·
`src/lib/likida/migraciones_verificadas.test.ts:56`

La ronda 16 la anunció como *"0084: `sumar_combustible_ejercicio` (SUM en SQL, una
consulta en vez de páginas en el camino caliente) — aplicada y verificada en la
base real"*, y la exención del test la describe como *"si falta,
`getAcumuladoCombustible` lanza ruidoso en el primer cuadre (el RPC no existe)"*.

Verificado: `grep -rn "sumar_combustible" src/` devuelve **una sola línea**, y es
esa cadena de texto dentro del propio test. `getAcumuladoCombustible` (`repo.ts:819`)
sigue siendo el bucle de hasta 100 páginas de 1,000 filas, y `desde_db.ts:78` la
sigue llamando a ella, no al RPC.

**Consecuencia doble:** (a) el ALTO de rendimiento del camino caliente sigue
abierto y se contabilizó como cerrado; (b) la exención escrita en
`migraciones_verificadas.test.ts` afirma un comportamiento de fallo (*"lanza
ruidoso"*) que no puede ocurrir, así que si el RPC se borrara de la base nadie se
enteraría — la prueba que existe para que ninguna migración quede sin decisión
explícita registró una decisión falsa.

**Causa raíz probable:** se escribió y aplicó la migración y no se cambió el
llamador; nada en la compuerta puede detectar SQL sin consumidor.

---

### [MEDIO] `liquidacion` no tiene el CHECK de cuadre que sí tienen las dos tablas de factura

`supabase/migrations/0001_init.sql:71-73` ·
`supabase/migrations/0049_cobranza_factura_emitida_pago.sql:54-55` ·
`supabase/migrations/0066_iva_de_la_mensualidad.sql:85-86`

`factura_emitida` tiene `factura_total_cuadra check (abs(total - (subtotal + iva))
<= 0.01)` y `factura_saas` tiene `factura_saas_desglose_cuadra`, las dos con el
razonamiento escrito (*"Sin esto, un total tecleado a mano descuadra la cobranza
contra la contabilidad del cliente y nadie sabe cuál de los dos números creer"*).
`liquidacion` — la tabla central del producto, la que el PDF imprime — recibe
`total_comprobado`, `total_anticipo` y `diferencia` como **tres parámetros
independientes** de `guardar_liquidacion_tx` (`0021:19-20`) y solo tiene el CHECK
de `NaN` (`0025:129-130`).

**Escenario:** `update liquidacion set total_comprobado = 9000 where viaje_id =
'4444…'` (una corrección a mano por la consola, que es como se cargan datos hoy
según la propia `0025:14-15`) deja la fila con `total_anticipo = 10,600`,
`total_comprobado = 9,000` y `diferencia = 200`. La base la acepta. El PDF y el
panel imprimen los tres números y **la resta no da**: 10,600 − 9,000 = 1,600, no
200.

**Consecuencia:** el contralor hace la resta en la sala del demo. La regla que
define al producto ("nunca inventar una cifra") no tiene aquí su respaldo
declarativo, y sí lo tiene en dos tablas de facturación que hoy están vacías.

**Causa raíz probable:** la coherencia de las tres cifras vive en el motor puro,
que sí la garantiza; nunca se bajó a la tabla porque el motor era el único
escritor conocido.

---

### [MEDIO] Dos contadores del 15% con criterios distintos en el mismo turno

`src/lib/likida/tools.ts:109` · `src/lib/likida/cuadre/desde_db.ts:78` ·
`src/lib/likida/repo.ts:831`

`getAcumuladoCombustible(tenantId, ejercicio, claves?)` degrada a
`concepto.eq.diesel` cuando no recibe `claves` (`repo.ts:831`). `desde_db.ts:78`
le pasa `config.hidrocarburos.claves`; `tools.ts:109` la llama **sin el tercer
argumento**. El comentario de `repo.ts:827-830` documenta esta divergencia como el
hallazgo de la auditoría 14 y como resuelta: *"Ahora se pasa la misma lista de
claves que el motor"* — se pasa en uno de los dos llamadores.

**Escenario:** ejercicio con $1,000,000 de combustible por clave del SAT, de los
cuales $400,000 entraron con `concepto = 'factura'` u `'otro'` pero
`clave_prod_serv = '15101505'` (lo normal en un CFDI de monedero: el `concepto`
lo pone el OCR, la clave la pone el XML). El motor mide contra $1,000,000 → tope
$150,000. La tool `cuadrar_viaje` mide contra $600,000 → tope $90,000. En el mismo
turno, WhatsApp le dice al operador "vas al 14%, te quedan $X" y el PDF calcula el
excedente contra otra base.

**Consecuencia:** dos cifras fiscales del mismo periodo en la misma conversación.

**Causa raíz probable:** el parámetro `claves` es opcional con un fallback
silencioso, así que olvidarlo no rompe nada visible.

---

### [BAJO] Ninguna tabla nacida después de la `0028` adoptó la FK compuesta con `tenant_id`

`supabase/migrations/0047_operacion_encargado.sql:129-131` ·
`0049:84-85` y `:95-96` · `0076:57` · `0048:139`

La `0028` estableció el patrón y la `0073` lo aplicó retroactivamente a
`comprobante_huerfano` ("es exactamente el argumento que la 0028 rechazó"). Las
tablas posteriores no lo siguieron: `pod (tenant_id, viaje_id)` con FK simple
(`0047:129-131` — la `0081` tuvo que amarrarlo por RLS porque el esquema no lo
amarra), `pago_recibido (tenant_id, factura_id)`, `factura_viaje (factura_id,
viaje_id)` sin `tenant_id` ni comprobación del viaje,
`cfdi_consolidado_linea.gasto_id`, `viaje.cliente_id` y `viaje.unidad_id`.

**Escenario concreto (el único con escritura viva):** `guardarPod` inserta con
`tenant_id` y `viaje_id` resueltos por separado; nada en la base impide
`(tenant A, viaje de B)`. Las demás están vacías (`cliente`, `unidad`,
`factura_emitida`, `pago_recibido` — ver MAPA), así que hoy no hay daño, pero
`pago_recibido` es el caso que más duele el día que se llene: un abono de la flota
A contra una factura de la flota B baja el saldo de B en la vista
`factura_saldo`, que agrupa solo por `factura_id` (`0049:112-127`).

**Consecuencia:** el aislamiento entre flotas vuelve a ser "una columna repetida en
cada tabla" en vez de una propiedad de la clave, que es lo que la `0028` explica
que no debe ser.

**Causa raíz probable:** la `0028` cerró las cuatro relaciones del camino del
dinero de entonces; no dejó un chequeo que obligue a las tablas nuevas.

---

### [BAJO] `cfdi_consolidado_linea.gasto_id` es la FK sin índice que la `0071` acababa de eliminar

`supabase/migrations/0076_cfdi_consolidado.sql:57` y `:78-85` ·
`supabase/migrations/0071_indices_de_borrado.sql:64`

La `0071` recorrió el esquema poniendo índice a toda FK cuya tabla padre se borra
en cascada (incluida `cfdi_xml_gasto_id_idx`). La `0076`, cinco migraciones
después, creó `gasto_id … on delete set null` y creó **dos** índices para la
tabla — ninguno sobre `gasto_id`. Borrar un viaje con 40 gastos hace 40 `Seq Scan`
de `cfdi_consolidado_linea`; borrar una flota, uno por gasto de toda su historia.
Es exactamente la forma cuadrática que la `0071` documenta haber cerrado.

---

## Lo que revisé y está bien

- **`operador_sube_su_pod` — CERRADO.** `supabase/migrations/0081_pod_tenant_amarrado.sql:15-19`:
  el `with check` amarra las dos condiciones (`viaje_id in (select … where
  operador_id = get_user_operador_id())` **y** `tenant_id = (select tenant_id from
  viaje where id = viaje_id)`). Ninguna migración posterior la vuelve a dropear
  (`grep operador_sube_su_pod supabase/`). Era la razón de la nota anterior.
- **Los dominios de estado.** `0025:87-155` cubre `gasto.concepto` (los 9 de
  `ConceptoGasto`), `gasto.estado_sat`, `gasto.forma_pago` (forma, no catálogo, con
  la razón escrita), `viaje.estatus`, `liquidacion.estatus`, `app_user.rol`,
  `llm_costo.fase`. La `0073:60-72` cerró las dos últimas columnas de estado sin
  CHECK. Recorrí las 43 tablas: **no queda ninguna columna de estado sin dominio**.
- **Montos negativos.** `0070:44-48` (`gasto.monto >= 0`, `viaje.anticipo >= 0`),
  con `pago_monto_positivo`, `tarifa_precio_positivo`, `factura_importes_positivos`,
  `cotizacion_importes`, `plan_precio_no_negativo`, `llm_costo_mensual_no_negativo`.
- **El mismo CFDI dos veces.** `0065:69-70`: `uq_gasto_cfdi_uuid (tenant_id,
  cfdi_uuid, cfdi_orden) where cfdi_uuid is not null`. Intenté refutarlo y no pude:
  `cfdi_orden` es `not null default 1` (`0065:58`) con `check (cfdi_orden >= 1)`, así
  que dos inserciones del mismo XML siguen chocando en `orden = 1`; y
  `ligarLineaAGasto` (`consolidado.ts:170-174`) lleva el guardia
  `.is('cfdi_uuid', null)`, que impide re-apuntar un gasto ya timbrado.
- **RLS habilitada en las 42 tablas vivas** (barrido de `enable row level security`
  contra la lista de `create table`, incluidas las de los `do $$ … array[…]`).
  `tenant` es de solo lectura por RLS desde `0078:55-57` y `app_user` /
  `bitacora_auditoria` llevan `not is_operador()` desde la `0079`.
- **FK compuestas del camino del dinero.** `0028:78-124`: `gasto→viaje`,
  `liquidacion→viaje`, `codigo_pendiente→viaje`, `viaje→operador`, todas
  `(id, tenant_id)`; `0073:31-35` añadió la de `comprobante_huerfano`.
- **`0075:20-45`**: la FK que le faltaba a `viaje_lock` y las dos `NOT VALID`
  permanentes ya validadas. `viaje_lock_pkey` ya sirve el sondeo de la FK.
- **`0072`, la consolidación mensual de IA.** Traté de romper la idempotencia por
  NULLs en la llave del `on conflict (tenant_id, mes, fase, modelo)` — no se puede:
  `llm_costo.fase` y `llm_costo.modelo` son `not null` (`0003:14-15`) y `tenant_id`
  también, así que ninguna llave del `group by` puede ser NULL. Refutado.
- **`0085` como fix funcional.** El bug que arregla es real y está bien arreglado:
  `eleg jsonb` separada de la `r record` de los loops (`0085:37`, `:74`), y las
  ramas de `facilidadCombustibleEfectivo` (`:66-83`) exigen objeto + las dos
  condiciones + booleanos. El `seed.sql:107-110` escribe una config que las pasa.

---

## Lo que NO alcancé a revisar

- **`supabase/verificaciones.sql` completo** (3,150 líneas). Leí los títulos de los
  56 bloques y a fondo solo el 49 (`0074`) y el 56 (`0081`). No comprobé si algún
  bloque afirma verificar algo que ya no es cierto. Nota al margen: la numeración
  salta del **56 al 61** — no hay bloques 57-60, y las migraciones `0082`-`0085`
  quedaron todas como exentas en `migraciones_verificadas.test.ts:52-56`.
- **El bucket de Storage y sus políticas** (`0008`, `0039`) — solo confirmé que
  existen.
- **Todo el subsistema SaaS/Stripe** (`0052`-`0057`, `0066`): revisé la lista de
  constraints (que es densa y coherente) pero no leí las migraciones línea por
  línea. Está fuera del camino del demo.
- **Las RPC de resumen** (`0062`, `0064`) — 27 KB de SQL agregador; verifiqué que
  tienen `search_path` fijo y que no las tocó ningún `create or replace` posterior,
  pero no auditué su aritmética contra la del panel.
- **La numeración `0067`-`0069` no existe** en el repo ni en la historia de git
  (`git log --diff-filter=A -- 'supabase/migrations/006[789]*'` no devuelve nada).
  No pude determinar si son huecos deliberados o migraciones aplicadas contra la
  base real que nunca se commitearon — lo segundo sería el mismo accidente que la
  `0065:39-54` documenta, y no hay forma de comprobarlo sin base.
