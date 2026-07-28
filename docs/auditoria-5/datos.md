# Modelo de datos y esquema — auditoría 5

**Nota: 5/10** (antes 7). Razón: **mirada más profunda** — el esquema casi no
cambió esta ronda (0020, 0021, 0023 y una 0022 que falta), y el 7 venía heredado
de una ronda que anotó "no auditado esta ronda". No es que empeorara: es que se
vio mejor. Lo que se ve es que la parte de CONCURRENCIA está bien resuelta y
documentada, y todo lo demás —dominios, clave natural del canal, config del
dinero, paridad repo↔producción— es fe.

**El riesgo mayor hoy:** el esquema del repo **ya no es** el esquema de
producción. La migración `0022`, la que evita que todo cierre de liquidación
falle, está aplicada en la base y **no existe como archivo**; cualquier entorno
reconstruido desde `supabase/migrations/` nace con el bug que el commit `52adedb`
dice haber cerrado.

Método: se leyeron las 22 migraciones del repo y se contrastaron contra la base
real de Likida (`gngoqsvrxdguxvsizpbw`) **solo con lecturas** —`pg_constraint`,
`pg_indexes`, `pg_proc`, `pg_policies`, `supabase_migrations.schema_migrations` y
las filas de negocio—. Los escenarios de motor se corrieron importando
`cuadrarViaje` y `fusionarConfig` reales con `npx tsx`; ninguna prueba escribió
en Supabase.

---

## Hallazgos

### [CRÍTICO] La migración 0022 está aplicada en producción y no existe en el repo

`supabase/migrations/` (22 archivos: 0001–0021 y 0023) ·
`supabase/migrations/0021_liquidacion_litros_diesel.sql:19` ·
`src/lib/cuadra/startup.ts:65-103`

**Evidencia.** `supabase_migrations.schema_migrations` tiene 23 filas; la que
falta en disco es `20260728100146 | 0022_drop_guardar_liquidacion_tx_vieja`.
`git log --all --diff-filter=A -- 'supabase/migrations/0022*'` no devuelve nada
y `git show --name-only 52adedb` solo lista `0021` y `0023`, aunque el mensaje
de ese mismo commit dice textual: *"Mig. 0022 elimina la vieja"*. El árbol está
limpio (`git status --porcelain supabase/` vacío), así que no es un archivo sin
commitear: no existe.

**Escenario con valores.** Un `supabase db push` sobre un proyecto limpio —una
rama de Supabase, un staging, un restore, o el segundo tenant que hace falta
para el demo del 6-ago— aplica `0013` (crea `guardar_liquidacion_tx` de 11
argumentos) y después `0021` (crea la de 12, porque `p_litros_diesel` lleva
`default 0`). Nada dropea la vieja. Producción hoy tiene UNA sola —verificado en
`pg_proc`: `guardar_liquidacion_tx` aparece con `pronargs = 12` y nada más—; el
entorno reconstruido tendría dos.

**Consecuencia.** Es exactamente el fallo que `52adedb` describe: `ERROR:
function guardar_liquidacion_tx(...) is not unique`. Revienta **todo cierre de
liquidación**, que es el camino más caro del producto. Y no hay red: la suite es
offline, y `verificarMigracionesCriticas` sondea `try_lock_viaje` (0005),
`intake_delta` (0011), `codigo_pendiente` (0016) y `enriquecer_gasto_codigo`
(0017) — **no sondea `guardar_liquidacion_tx`**, así que el arranque loguearía
`startup.migraciones { ok: true }` y el primer "listo" del operador moriría.

**Causa raíz.** El arreglo se aplicó contra la base (vía `apply_migration`) y no
se escribió el archivo. El repo dejó de ser la fuente de verdad del esquema, y el
propio MAPA hereda el error al contar "23 migraciones" — son 23 aplicadas y 22
versionadas.

---

### [CRÍTICO] Un teléfono no identifica a un operador, y `.limit(1).maybeSingle()` elige uno en silencio

`supabase/migrations/0001_init.sql:35` · `src/lib/cuadra/conv.ts:59-69`

**Evidencia.** La única unicidad de `operador` es `UNIQUE (tenant_id, telefono)`
sobre el texto **crudo** (confirmado en `pg_constraint`: la tabla no tiene otra
restricción `u` ni ningún `c`). `'529993700779'` y `'5219993700779'` son cadenas
distintas, así que la restricción no las ve. `resolveOperador` compensa al LEER:

```ts
.in('telefono', variantesTelefono(telefono))
.eq('activo', true)
.limit(1)
.maybeSingle();
```

Sin filtro de tenant y sin `ORDER BY`.

**Escenario con valores.** Hoy la base tiene `operador 33333333-…-00ff | tenant
11111111-… | telefono '529993700779'` (alta manual de hoy). Se da de alta el
mismo número en el tenant del prospecto para el demo, o alguien lo captura con el
"1" (`'5219993700779'`) como lo manda Meta. **El INSERT pasa**: no hay unicidad
global del teléfono ni normalización en la columna. Llega un mensaje de ese
número: `.in()` empata las DOS filas; `.limit(1)` recorta a una **antes** de que
`maybeSingle()` mire, así que PostgREST recibe una sola fila y **no lanza el
406** — devuelve una arbitraria, la que el plan haya sacado primero. Con esa fila
se decide el `tenantId` con el que se escriben el gasto y la liquidación.

**Consecuencia.** Los tickets de un operador se guardan en la flota equivocada,
con RLS intacta —la fila nace con ese `tenant_id`, así que ninguna policy la
detiene— y sin un solo error en el log. El contralor de la flota B ve gasto de la
flota A en su panel. Es el estado que el rubro llama "la base acepta algo que el
producto no sabe manejar": ante dos filas, el producto no falla, adivina.

**Causa raíz.** La clave natural del canal se normaliza al leer (`b7b2fcc`) y no
al escribir. La restricción de la base protege una columna cuyo formato nadie
impone.

---

### [ALTO] Cero `CHECK` en todo el esquema: `gasto.concepto` acepta cualquier texto y el 15% no se entera

`supabase/migrations/0001_init.sql:61` · `src/lib/cuadra/repo.ts:286` ·
`src/lib/cuadra/repo.ts:424` · `src/lib/cuadra/cuadre/engine.ts:156`

**Evidencia.** `select conname from pg_constraint where connamespace =
'public'::regnamespace and contype = 'c'` devuelve **cero filas**. No hay un solo
CHECK en la base.

Respuesta directa a la pregunta del brief: la columna `gasto.concepto` es `text
not null`, **sin CHECK ni enum**. El tipo de TS (`src/types/cuadra.ts:20-25`) y
el `z.enum(CONCEPTOS_OCR)` del intake (`src/lib/cuadra/intake/ocr.ts:26,35`) SÍ
incluyen `flete`, así que **un flete real escribe bien** — el desajuste va al
revés: la columna es más permisiva que el tipo. Y `getGastos` la lee con un cast
ciego, `concepto: r.concepto as Gasto['concepto']` (repo.ts:286): lo que salga de
la base entra al motor como si fuera del enum.

**Escenario con valores.** Un alta manual como las de hoy:

```sql
insert into gasto (tenant_id, viaje_id, concepto, monto, forma_pago, fecha)
values ('11111111-…','44444444-…-00ff','combustible', 9000, '01', '2026-07-28');
```

Pasa. Entonces, en cadena: `politicaPara('combustible', …)` no empata ninguna
política → sin tope; `esCombustible` es `g.concepto === 'diesel' || …`
(engine.ts:156) → **no se marca `combustible_efectivo`**; y
`getAcumuladoCombustible` filtra `.eq('concepto', 'diesel')` (repo.ts:424) → los
$9,000 en efectivo **no entran al contador del 15% de RFA 2026 regla 2.9**, ni al
numerador ni al denominador. Los $9,000 suman a `totalComprobado` y salen como
deducibles.

**Consecuencia.** Un concepto inventado no rompe nada: se vuelve el gasto más
limpio de la liquidación —sin tope de política, sin regla de efectivo, sin
contador del 15%— y el contralor recibe una cifra de cumplimiento con $9,000 de
menos.

El mismo hueco, con el mismo cero CHECK, en: `viaje.estatus` (un `'activo'` deja
al operador sin viaje para siempre, porque `getOpenViaje` filtra
`.in(['abierto','en_cuadre'])`), `liquidacion.estatus`, `gasto.estado_sat`,
`app_user.rol`, `tenant.plan`, `gasto.forma_pago`, `llm_costo.fase`.

**Causa raíz.** El dominio vive en TypeScript y en un zod del intake. La base no
tiene copia, así que todo lo que no pase por el intake queda sin dominio.

*(No se pide `CHECK (monto > 0)`: la migración 0019:27-36 explica por qué sería
un retroceso, y el argumento se sostiene.)*

---

### [ALTO] `tenant.config` manda sobre todos los topes fiscales, no tiene esquema, y su único escritor es la consola

`src/lib/cuadra/config.ts:106-126` · `supabase/migrations/0004_fiscal_config.sql:8` ·
`src/lib/cuadra/cuadre/desde_db.ts:25`

**Evidencia.** `tenant.config` es `jsonb` sin CHECK. `getConfig` lo lee con un
cast ciego —`data?.config as Partial<CuadraConfig> | null`, config.ts:109—, sin
zod, y `desde_db.ts:25` le entrega `config.politica` y `config.estimulos` al
motor. En producción `tenant.config IS NULL` (verificado), así que hoy el tenant
del demo corre entero sobre `DEMO_CONFIG`, cuyos topes el seed marca 🔴 INVENTADO.

Y **ningún código escribe `tenant.config`**: las tres únicas apariciones de
`from('tenant')` en `src/` (conv.ts:87, repo.ts:358, config.ts:147) son `select`.
La única vía para configurar a una flota es la consola de Supabase — el camino
que no pasa por ninguna validación.

**Escenario con valores.** Corrido contra el motor real, con
`alimentacion $1,050 (2026-07-27)` + `hospedaje $900`, anticipo $2,000:

| `tenant.config` | diferencias que produce el motor |
|---|---|
| `NULL` (lo de hoy) | `sobre_politica`, `anticipo`, `viatico_excede_fiscal` |
| `{"politica": []}` | `anticipo`, `viatico_excede_fiscal` — **se cae el tope de la flota** |
| `{"estimulos":{"viaticosTopeFiscalDiarioMxn": null}}` | `sobre_politica`, `anticipo` — **se cae el tope de $750/día de LISR 28-V** |
| `{"politica": "si"}` | `TypeError: pol.filter is not a function` — revienta el cuadre entero |

**Consecuencia.** Las dos primeras filas quitan un control fiscal **sin un log y
sin un error**: la liquidación sale diciendo que todo cumple. El caso del `null`
es especialmente caro porque el comentario de config.ts:65-87 documenta ese mismo
fallo como cerrado —lo cerró para el merge shallow, haciéndolo recursivo—, pero
escribir `null` a mano en la columna lo reabre. La cuarta fila mata el "listo" del
operador en producción.

**Causa raíz.** Una columna jsonb sin esquema como fuente de verdad del dinero, y
el único escritor es una persona con SQL.

---

### [ALTO] La misma foto (mismo SHA-256) son dos gastos si caen en dos viajes

`supabase/migrations/0015_gasto_img_hash_unique.sql:10` ·
`src/lib/cuadra/analytics.ts:91`

**Evidencia.** El índice único es `(tenant_id, viaje_id, img_hash)` — el
`viaje_id` en medio. Verificado en producción HOY: el hash
`250a4e5b34ecba43d043bf63b771c384296c5a62917bf326ab2826d1e9349d98` está en
**dos** gastos del mismo tenant y del mismo operador:

| gasto | viaje | monto | creado |
|---|---|---|---|
| `26fd8543-cb60-46b7-851b-829a5b823be0` | `44444444-…-00ff` | $199.00 | 21:41:45 |
| `19299f03-b61f-40f4-abbe-5b8252e00860` | `44444444-…-00fe` | $199.00 | 22:48:07 |

Un SHA-256 igual es el mismo archivo. La base lo aceptó dos veces.

**Escenario con valores.** Un ticket de fonda cuyo folio el OCR no leyó (`folio
NULL`, `cfdi_uuid NULL`, como es normal en papel térmico) se manda en el viaje A
y se vuelve a mandar en el viaje B. `uq_gasto_img_hash` no choca (distinto
`viaje_id`); el motor de cuadre solo deduplica DENTRO del viaje y necesita
`g.folio` para la llave `concepto|folio|monto` (engine.ts:133-137), así que sin
folio ni UUID no lo ve; y `detectarDuplicadosEntreViajes` —que sí cruza viajes—
tiene un único llamador, `analytics.ts:91`, o sea el panel, **después** del
cierre, y empata por `cfdiUuid` o `folio+monto`, **nunca por hash**. El mismo
dinero se comprueba dos veces contra dos anticipos.

**Consecuencia.** El fraude número uno del sector —el mismo comprobante en dos
liquidaciones— tiene barrera de base solo dentro de un viaje, y el dato que lo
cerraría (el hash) ya está en la columna, sin usar.

**Honestidad sobre el alcance:** con folio legible o con UUID, el panel sí lo
caza; y el caso de hoy es una prueba de Javier, no un fraude. Lo que se califica
es que la base no distingue una cosa de la otra.

**Causa raíz.** El índice se diseñó para una carrera intra-lote (así lo dice el
comentario de 0015) y nadie volvió a preguntarse si el alcance correcto era el
tenant.

---

### [MEDIO] `wa_conversacion` guarda el teléfono crudo y `operador_id` no se escribe nunca

`src/lib/cuadra/conv.ts:112-135` · `src/lib/cuadra/processor.ts:499` ·
`supabase/migrations/0001_init.sql:81` ·
`supabase/migrations/0005_concurrencia.sql:13-14`

**Evidencia.** `loadConversation(op.tenantId, msg.from, viajeId)` recibe el
`msg.from` **crudo** —no `op.telefono`, no una forma normalizada— y busca con
`.eq('telefono', telefono)`. El insert (conv.ts:132) pone `tenant_id, telefono,
viaje_id, estado` y **nunca `operador_id`**, aunque la columna y su FK existen
desde 0001. El índice único `wa_conversacion_tenant_tel_uidx` es sobre el texto
crudo.

En producción HOY, la misma persona vive bajo dos cadenas distintas en dos tablas:

- `operador.telefono = '529993700779'` (sin el 1)
- `wa_conversacion.telefono = '5219993700779'` (con el 1), 4 turnos guardados

y las dos filas de `wa_conversacion` tienen `operador_id = NULL`.

**Escenario con valores.** El número entra una vez como `5219993700779` y otra
como `529993700779` (el MAPA documenta que las dos formas circulan). El índice
único no choca —son cadenas distintas—, así que se crea una SEGUNDA fila de
conversación y los hasta 12 turnos de contexto se parten en dos. Sin
`operador_id` no hay forma de reconciliarlas ni de saber que son la misma persona.

**Consecuencia.** El operador pierde el hilo a media conversación y la fila por la
que viaja el `viaje_id` activo se duplica. No es dinero, es la sala del demo.

**Causa raíz.** El mismo patrón del CRÍTICO del teléfono: se normalizó el lado
que lee `operador` y no el que escribe `wa_conversacion`.

---

### [MEDIO] `gasto.fecha` es nullable, y sin fecha el gasto se cae de todas las validaciones temporales y del contador del 15%

`supabase/migrations/0001_init.sql:62` · `src/lib/cuadra/cuadre/engine.ts:198` ·
`src/lib/cuadra/repo.ts:425-426` · `src/lib/cuadra/tools.ts:67`

**Evidencia.** `fecha date` sin `NOT NULL` ni CHECK. En producción HOY hay
exactamente 1 fila con `fecha IS NULL`: el `alimentacion $1,050` del viaje
`44444444-…-00ff`. O sea, no es hipotético: el OCR ya produce filas así.

**Escenario con valores.** Entra un ticket de diésel de $9,000 pagado en efectivo
(`forma_pago = '01'`) cuya fecha el OCR no pudo leer → `fecha = NULL`. Entonces:

1. `engine.ts:198` abre el bloque de cordura de fecha con `if (g.fecha)` → no se
   puede marcar `fecha_sospechosa` ni por ejercicio equivocado ni por rango.
2. `getAcumuladoCombustible` filtra `.gte('fecha','2026-01-01').lte('fecha',
   '2026-12-31')`; en SQL `NULL >= '2026-01-01'` es NULL, no TRUE → **la fila
   queda fuera del contador**, y devuelve exactamente lo mismo que si el ticket
   no existiera.
3. Los $9,000 sí suman a `totalComprobado`.

**Consecuencia.** `avisoTope15` (tools.ts:67) le dice al contralor que va dentro
del 15% de RFA 2026 regla 2.9 contando $9,000 de efectivo menos de los que hay.
El excedente sobre el 15% no es deducible, y el producto afirma lo contrario.

**Causa raíz.** La columna admite el hueco y el contador lo lee como ausencia, no
como "no sé".

---

### [MEDIO] Ninguna FK lleva el `tenant_id`: una fila puede ser de un tenant y colgar del viaje de otro

`supabase/migrations/0001_init.sql:57-65` · `0001_init.sql:106-119`

**Evidencia.** Las 22 claves foráneas del esquema (leídas de `pg_constraint`,
`contype='f'`) apuntan **todas** a `(id)`: `gasto_viaje_id_fkey → viaje(id)`,
`liquidacion_viaje_id_fkey → viaje(id)`, `viaje_operador_id_fkey → operador(id)`,
`codigo_pendiente_viaje_id_fkey → viaje(id)`, `cfdi_xml_gasto_id_fkey →
gasto(id)`… Ninguna es compuesta con `tenant_id`. Y la policy `tenant_data` solo
comprueba `tenant_id = any(get_user_tenant_ids())`: la verificación de FK no mira
tenant y además ignora RLS.

**Escenario con valores.** Un usuario autenticado del tenant A, vía PostgREST:

```sql
insert into gasto (tenant_id, viaje_id, concepto, monto)
values ('<A>', '<uuid de un viaje del tenant B>', 'diesel', 50000);
```

El `WITH CHECK` pasa (el `tenant_id` es el suyo) y la FK pasa (el viaje existe).
Queda una fila cuyo `gasto.tenant_id` ≠ `viaje.tenant_id`.

**Consecuencia.** La fila es invisible para `getGastos(viajeId, B)` —filtra por
los dos— pero SÍ entra en `getAcumuladoCombustible(A)` y en los KPI del panel de
A: $50,000 de diésel que nadie gastó. Hoy no hay ninguna inconsistencia
(verificado: los tres cruces `gasto/viaje`, `liquidacion/viaje` y
`viaje/operador` dan 0), pero nada la impide más que la buena conducta de la app.

**Causa raíz.** El aislamiento se modeló como una columna repetida en cada tabla
en vez de como parte de la clave de las relaciones.

---

### [MEDIO] Nada impide dos viajes abiertos del mismo operador; el segundo huerfaniza al primero

`src/lib/cuadra/conv.ts:72-84` · `supabase/migrations/0001_init.sql:46-55`

**Evidencia.** `getOpenViaje` hace `.in('estatus',['abierto','en_cuadre'])
.order('created_at', { ascending: false }).limit(1)` — la forma de un SELECT que
espera varios y se queda con uno. En la base no hay índice único parcial
(`where estatus in (...)`) ni nada que limite a uno por operador; `viaje.estatus`
tiene `default 'abierto'`.

Los dos viajes que se insertaron a mano hoy son del MISMO operador
(`33333333-…-00ff`): `44444444-…-00ff` a las 20:45 y `44444444-…-00fe` a las
21:46. Hoy los dos acabaron `liquidado`, pero el segundo se creó a un `update`
de distancia de coexistir abierto con el primero.

**Escenario con valores.** El viaje `…00ff` está abierto con anticipo $5,000. Se
inserta `…00fe` con anticipo $4,000 tomando el default `estatus = 'abierto'`.
Desde ese instante **todas** las fotos del operador se cuelgan de `…00fe` (el más
nuevo). `…00ff` se queda con $5,000 de anticipo y cero comprobantes, sin que
nadie lo vea. Cuando alguien lo cierre, la diferencia sale $5,000 en contra del
operador.

**Consecuencia.** Una liquidación fantasma que acusa a un operador de $5,000 que
sí comprobó, en el otro viaje.

**Causa raíz.** El código trata "el viaje abierto" como singular; la base lo trata
como plural.

---

### [BAJO] Ninguna de las 22 migraciones es reversible

`supabase/migrations/` (los 22 archivos)

**Evidencia.** No hay archivos `down`, ni carpeta de rollback, ni bloques
`-- down` dentro de los `.sql`. Las dos operaciones destructivas del historial no
tienen inverso: `drop index if exists idx_gasto_viaje_hash`
(`0015_gasto_img_hash_unique.sql:9`) y el `drop function` de la `0022` — que
además no está en el repo (ver el primer CRÍTICO).

**Escenario con valores.** Un `push` que deje la base en mal estado se revierte a
mano, statement por statement, contra la base del demo, sin guion escrito.

**Consecuencia.** Aceptable para un producto pre-revenue con un tenant, pero
conviene decidirlo a propósito y no descubrirlo el 5 de agosto.

**Causa raíz.** El flujo es `supabase db push`, que no pide el `down` y por tanto
nunca se escribió.

---

## Invariantes del código y si la base los impone

| Invariante que el código asume | Dónde lo asume | Restricción en la base |
|---|---|---|
| Un teléfono → un operador | `conv.ts:59-69` (`.in(...).limit(1)`) | **Ninguna.** `UNIQUE (tenant_id, telefono)` es sobre el texto crudo y no cubre variantes ni cruza tenants |
| `gasto.concepto` ∈ los 9 valores de `ConceptoGasto` | `types/cuadra.ts:20`, `repo.ts:286` (cast ciego) | **Ninguna.** `text not null`, cero CHECK en el esquema |
| `viaje.estatus` ∈ {abierto, en_cuadre, liquidado} | `conv.ts:78`, mig. 0013:46 | **Ninguna.** `text not null default 'abierto'` |
| `liquidacion.estatus` ∈ {cuadrada, con_diferencias, revisar} | `types/cuadra.ts:102` | **Ninguna** |
| `gasto.estado_sat` ∈ {vigente, cancelado, no_encontrado, pendiente} | `repo.ts:298` (cast ciego) | **Ninguna** |
| `app_user.rol` ∈ {superadmin, flota_admin, contador, operador} | `auth/session.ts:16`, `is_superadmin()` | **Ninguna** — y de este depende la policy de RLS |
| Un operador tiene a lo más UN viaje abierto | `conv.ts:72-84` (`.limit(1)`) | **Ninguna** |
| Una liquidación por viaje | `repo.ts:326` | ✅ `liquidacion_viaje_uidx` (0005) |
| El cierre es atómico (liquidación + estatus del viaje) | `repo.ts:326` | ✅ `guardar_liquidacion_tx` en plpgsql (0013/0021) |
| Un CFDI timbrado = un gasto por tenant | `emparejarXmlConTicket` | ✅ `uq_gasto_cfdi_uuid` parcial (0019) |
| Una foto = un gasto | `processor.ts` (dedup por hash) | ⚠️ **parcial**: `uq_gasto_img_hash` es por `(tenant, viaje, hash)`; entre viajes no |
| Un `wa_message_id` se procesa una vez | `conv.ts:159-169` | ✅ PK de `wa_mensaje_procesado` + RLS deny-all (0002/0012) |
| Una conversación por (tenant, teléfono) | `conv.ts:112-119` | ⚠️ **parcial**: el índice existe (0005) pero sobre el texto crudo, así que las variantes del número crean dos |
| Un solo procesamiento concurrente por viaje | `conv.ts:199-245` | ✅ `viaje_lock` + `try_lock_viaje`, RLS deny-all, grants explícitos |
| El folio de portal no se pisa entre acercamientos | `repo.ts:197-216` | ✅ el claim vive en el `WHERE` de la 0017 |
| El aviso de privacidad se manda una vez por versión | `repo.ts:383-395` | ✅ el claim vive en el `WHERE` de la 0018 |
| `gasto.tenant_id` = `viaje.tenant_id` | implícito en todo `repo.ts` | **Ninguna.** Ninguna FK es compuesta con `tenant_id` |
| `liquidacion.tenant_id` = `viaje.tenant_id` | `guardar_liquidacion_tx` | **Ninguna** (la RPC recibe el tenant como parámetro y no lo comprueba contra el viaje) |
| Los topes fiscales tienen la forma de `CuadraConfig` | `config.ts:109` (cast ciego) | **Ninguna.** `tenant.config` es `jsonb` libre |
| `politica_gasto` es la política de la flota | `repo.ts:21-33` | La tabla tiene FK y RLS, pero **`getPolitica` no tiene un solo llamador** (confirmado con tres búsquedas): la política viva sale de `tenant.config`. Ya declarado como deuda en `docs/conocimiento/00-MEJORAS.md:248` |
| El esquema del repo = el esquema de producción | implícito en `supabase db push` | **Roto.** 23 migraciones aplicadas, 22 versionadas |

---

## Lo que revisé y está bien

- **Toda la capa de concurrencia del dinero.** Se leyeron 0005, 0013, 0015, 0017,
  0018, 0019 y 0021 completas. Las garantías están donde deben —índices únicos,
  `ON CONFLICT`, y el claim dentro del `WHERE` de un `UPDATE`—, no en TypeScript.
  El patrón "devuelve si ESTE llamado fue el que lo tomó" (0017, 0018) es la forma
  correcta y está aplicado con consistencia. Esto es lo que sostiene la nota.
- **`supabase/verificaciones.sql`** hace exactamente lo que dice: cuatro bloques
  `DO` que lanzan excepción a propósito para revertir dentro de su transacción, así
  que son seguros contra producción y no dejan rastro. Cubren mutex, doble cierre,
  claim del acercamiento y un-CFDI-un-gasto. La objeción real no es la técnica sino
  la cobertura: **no hay bloque para el 0022** (que la RPC sea única), que es
  justo la garantía que hoy no está en el repo. Tampoco hay ninguno de aislamiento
  entre tenants.
- **Los grants de las RPC internas.** 0012 y 0013 revocan de `public`, `anon` y
  `authenticated` explícitamente y conceden a `service_role`, con el comentario que
  explica por qué `revoke from public` no bastaba. Verificado en `pg_proc`: las
  ocho funciones existen y no hay sobrecargas duplicadas en producción.
- **RLS.** Está encendida en las 14 tablas de `public`. Las cuatro internas
  (`viaje_lock`, `wa_mensaje_procesado`, `codigo_pendiente`) tienen 0 políticas, que
  es deny-all deliberado y documentado. Las de negocio tienen `USING` **y**
  `WITH CHECK`, no solo `USING`.
- **La decisión de NO poner `CHECK (monto > 0)`** (0019:27-36). Es correcta y el
  razonamiento se sostiene: un dato malo visible vale más que un dato ausente.
- **`uq_gasto_cfdi_uuid` parcial** con nombre explícito para que el processor pueda
  distinguir cuál índice chocó. Es la clase de detalle que casi nadie hace.
- **Los `comment on column` de 0018, 0020 y 0021.** El esquema explica su propio
  porqué en la base, no solo en el repo.
- **Integridad de los datos de hoy:** se cruzaron `gasto/viaje`,
  `liquidacion/viaje` y `viaje/operador` por tenant, y los conceptos y estatus
  contra sus dominios de TS. Todo limpio salvo el `fecha IS NULL`. Los hallazgos
  de arriba son sobre lo que la base **permite**, no sobre corrupción presente.

## Lo que NO alcancé a revisar

- **El bucket `liquidaciones` de Storage.** La 0008 lo crea privado, pero no revisé
  las policies de `storage.objects`: si están abiertas, los PDF de liquidación —que
  llevan nombre del operador, montos y RFC— podrían ser listables por un
  autenticado de otro tenant. Es lectura de otro esquema y me quedé sin margen.
- **Si `wa_mensaje_procesado` se purga.** La 0002 crea el índice por `created_at`
  "para limpieza" y no encontré el job que borra. Crece sin techo.
- **El panel del contralor contra el esquema.** No verifiqué qué columnas lee
  `src/app/(dashboard)` ni si alguna consulta se apoya en `politica_gasto` (la
  tabla muerta) o en `ieps_acreditable` (siempre 0). El auditor de frontend está
  mejor situado.
- **`llm_costo`.** No revisé si se escribe siempre, ni si `liquidacion_id` se llena
  alguna vez (el `on delete set null` sugiere que sí importa).
- **Comportamiento real de `.in()` con dos filas.** El análisis es de las
  semánticas de PostgREST (`limit` se aplica antes que `single`, así que no hay
  406). No lo reproduje contra la base porque habría requerido insertar una
  segunda fila de operador, y el MAPA prohíbe escribir en Supabase. Vale la pena
  confirmarlo con un bloque `DO … raise exception` en `verificaciones.sql`, que sí
  revierte.
