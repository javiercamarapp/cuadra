# Rendimiento y costo — auditoría 14

Anclado a `0fa305e` (HEAD actual: la RFA 2026 regla 2.9 "deber ser" completa —
`0d23f73` + `0fa305e` — encima del release caae369 que está en producción).
Audité el código ACTUAL línea por línea con el criterio del rubro:
**cron de facturación (300 s), pool del webhook (120 s), índices, N+1,
presupuestos** — y verifiqué los cierres/pendientes de la ronda 13 abriendo
cada archivo, sin creerme los títulos de los commits. No toqué la base, no
commiteé, no desplegué.

**Nota: 6/10** (7.5 en la ronda 13). Razón del movimiento — **baja**, y la
razón es una sola: la feature estrella de este release (la RFA 2.9 "deber ser",
la que se demuestra mañana) metió al camino caliente del WhatsApp **una
agregación anual paginada por cada cuadre** que no existía antes, sin índice
que sirva su filtro, sin actualizar el presupuesto que la declara en 300 ms, y
duplicando el barrido anual que `getAcumuladoCombustible` ya hacía — con un
acantilado (`LecturaIncompleta` a las 100,000 filas) en el volumen que la
propia 0060 proyecta. Ninguno de los siete hallazgos de la ronda 13 se movió
(verifiqué cada uno: siguen exactamente donde estaban). Lo sano sigue sano
(cero N+1, pruebas del rubro verdes, tsc 0, eslint 0), pero esta ronda es la
primera en que la deuda nueva aparece en la ruta del demo, no en una pantalla
de escala.

---

## Hallazgos

### [ALTO] La RFA 2.9 agregó una agregación ANUAL por cuadre al camino caliente — sin índice, sin presupuesto, y con un acantilado en el volumen que la propia 0060 proyecta

`src/lib/cuadra/cuadre/desde_db.ts:61-82` (la consulta corre dentro de
`cuadrarDesdeDB`, incondicional), `:59` (`const anioEjercicio = String(new
Date().getFullYear())`), `:70` (`.or(`concepto.eq.diesel,clave_prod_serv.in.
(${clavesCombustible.join(',')})`)`), `:71` (`.order('id')`),
`src/lib/cuadra/presupuesto.ts:40` (`{ paso: 'guardiaCifras →
cuadrarDesdeDB', ms: 300 }` — la entrada del presupuesto NO se tocó),
`src/lib/cuadra/cuadre/guardia.ts:105` (`const liq = snapshotCierre ?? (await
cuadrarDesdeDB(...))` — la guardia corre en CADA turno con cifras),
`src/lib/cuadra/processor.ts:1957` (la guardia en el turno), `:1838` y `:1939`
(fallbacks del agente), `src/lib/cuadra/tools.ts:92` y `:152` (las dos tools),
`src/lib/cuadra/analytics.ts:680` → `:800` (cada carga de la pantalla detalle,
`dashboard/[id]/page.tsx:86`), `src/lib/cuadra/pg.ts:34-36` (`MAX_PAGINAS =
100` → `LecturaIncompleta`).

**Qué hace el código.** Antes de `0d23f73`, `cuadrarDesdeDB` leía viaje, gastos,
config y operador — cuatro consultas puntuales. Desde `0d23f73`, cada llamada
agrega además TODOS los gastos de combustible del tenant en el ejercicio
completo:

```ts
const filas = await traerTodo<{ monto: unknown; forma_pago: unknown }>(
  (desde, hasta) => supabaseAdmin()
    .from('gasto')
    .select('monto, forma_pago', conteo(desde))
    .eq('tenant_id', tenantId)
    .gte('fecha', `${anioEjercicio}-01-01`)
    .lte('fecha', `${anioEjercicio}-12-31`)
    .or(`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})`)
    .order('id')
    .range(desde, hasta),
  'desde_db.totalCombustibleEjercicio',
);
```

**Escenario con valores.** La 0060 proyecta ~240 mil gastos al año por tenant;
el diésel es el concepto dominante del producto (~40% según la distribución de
los datos vistos) → **~95 mil filas de diésel al año**. `traerTodo` pagina de
1,000 en 1,000: **95 viajes de red secuenciales por cuadre**, a 0.3 s el costo
unitario que el propio `presupuesto.ts` usa → **~28 s por cuadre solo de esta
consulta**. Y corre 3+ veces por liquidación: `cuadrar_viaje` (tools.ts:92) +
`guardar_liquidacion` (tools.ts:152) + la guardia del turno (guardia.ts:105,
porque el camino feliz —foto → "listo" → narra— trae cifras y la guardia
sustituye el texto, así que casi nunca hay snapshot) + cada carga del detalle
(analytics.ts:800). Tres cuadres por cierre → **~85 s de barridos anuales por
liquidación**, contra un `PRESUPUESTO_WEBHOOK_MS` de 120 s y un
`MARGEN_CIERRE_MS` de 12 s que la entrada `:40` modela como 300 ms. El turno
muere fail-closed ("Dame un momento…") a media liquidación, con el agente ni
siquiera arrancado.

**El acantilado, no la pendiente.** Pasadas las 100 páginas (100,000 filas),
`traerTodo` lanza `LecturaIncompleta` (pg.ts:34-36, fail-closed) → `cuadrarDesdeDB`
lanza → la guardia responde neutral y **ninguna liquidación del tenant se puede
cuadrar**. El comentario de pg.ts:127-128 dice exactamente a dónde debería ir
esto: "necesita un `sum()` en SQL, no más vueltas". La 0023 ya dejó escrito
que el contador del 15% es EL denominador de una regla fiscal y que "con una
flota real —miles de cargas al año— sí" se nota (0023:1-13); la consulta nueva
ignora su propio precedente.

**Por qué no tiene índice el filtro.** El único índice útil es
`idx_gasto_acumulado (tenant_id, concepto, fecha)` (0023). El `OR` sobre
`clave_prod_serv` no tiene índice, y un `OR` donde un brazo no es indexable
impide el BitmapOr: el plan realista es un Seq Scan del `gasto` del tenant
filtrando, más un sort por `id` (`:71`) que la 0023 evitaba explícitamente en
`getAcumuladoCombustible` ordenando por `fecha, id` para salir del índice.

**Qué NO es.** No es un bug de hoy: el tenant del demo tiene ~40 gastos y una
página — el demo no se entera. No es un número inventado: son los topes y
costos unitarios del propio `presupuesto.ts` aplicados al volumen que la propia
0060 proyecta. Es deuda de escala de la misma familia que 0060/0023/0063 se
escribieron para pagar ANTES de que muerda — metida, esta vez, en el camino
caliente del producto y sin cortocircuito (ver BAJO abajo).

**Dirección:** agregar en SQL (`sum()`) — o al menos cachear el total del
ejercicio por tenant con invalidación por escritura; y actualizar la entrada
`:40` del presupuesto cuando el costo deje de ser puntual. La 0023 ya pagó la
mitad de la deuda para el brazo `concepto='diesel'`; falta el brazo
`clave_prod_serv` o la agregación en SQL.

**Estado: abierto** (nuevo en esta ronda, introducido por `0d23f73`).

### [ALTO] El cron de facturación: sin cambios desde la ronda 13 — el lote de 8 en UNA sesión sigue sin check de reloj interno, el margen no cubre la suma de topes, y la cola de avisos corre sin presupuesto

`src/app/api/cron/facturar/route.ts:157` (`MARGEN_LOTE_MS = 150_000`), `:412` y
`:452` (los únicos checks, antes de CADA `conNavegador`/portal nuevo — nunca
dentro de la sesión), `:458` (`await correrLote(...)` sin reloj),
`:522` (`const avisos = await avisarALasPersonas(bloqueadosPorFlota, hoy)` —
después del bucle, sin reloj), `:190-194` (`avisarALasPersonas` → por flota:
`telefonoJefeDe` + `getPorFacturar` + `sendTemplate` + insert de bitácora),
`src/lib/cuadra/facturacion/adaptadores/capufe.ts:676` (el `for` de códigos
dentro de `sesion()` sin consultar el reloj), `:719` (`seApreto = true`),
`src/lib/cuadra/facturacion/agente.ts:260` (el `for` de `unoPorUno` sin reloj),
`vercel.json` (el cron sigue a `:30` cada hora).

**Escenario 1 — el de la ronda 13, intacto.** Ocho tickets de CAPUFE en UNA
sesión con todos los topes al máximo: lanzar Chromium 30 s + navegar 20 s +
receptor 68 s + 8 × ~21 s + captura 10 s + esperarUuid 20 s ≈ **316 s > 300 s**.
El check de `:412` pasa en t=0. La sesión corre sin un solo corte interno
(`capufe.ts:676` procesa todos los códigos; `agente.ts:260` no mira el reloj
entre tickets). Vercel mata la invocación a los 300 s; en modo `emitir` el CFDI
puede quedar timbrado con `seApreto = true` y sin `escribirUuid` — el claim
expira en 10 min y la corrida siguiente re-emite.

**Escenario 2 — la cola de avisos sigue sin presupuesto.** `:522` corre con el
reloj ya gastado: 3-4 flotas bloqueadas al final de un lote de ~290 s = 3-4 ×
(consulta del jefe + `getPorFacturar` sin índice + red a Meta + insert) — la
invocación muere antes de responder y la señal de CAPTCHA —el cierre de esta
misma feature— se pierde sin rastro.

Verifiqué que el fix de la ronda 12 sigue existiendo y funcionando (checks
`:412`/`:452`, `sinTiempo`, la prueba de 20 verdes que corre) — el progreso de
la 12 NO regresó. Lo que no se movió es lo que la ronda 13 marcó como bloqueo:
**un check de reloj dentro de la sesión (antes de cada ticket del lote y dentro
de `unoPorUno`) y un presupuesto para la cola de avisos.** Los commits de la
RFA 2.9 no tocaron esta ruta.

**Estado: abierto** (sin cambios desde la ronda 13; la dirección de arreglo
sigue siendo la misma y sigue siendo barata).

### [MEDIO] El pool del webhook sigue sin reloj de pared del lote — sin cambios desde la ronda 12

`src/app/api/webhook/whatsapp/route.ts:40` (`MAX_EN_PARALELO = 5`), `:77`
(`maxDuration = 120`), `:169` (`await conPool(permitidos, MAX_EN_PARALELO, …)`),
`src/lib/cuadra/processor.ts:351` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)` —
UN presupuesto por mensaje, no por lote), `:525` y `:798`
(`extraerComprobante(dataUrl, reloj.senal(25_000))`).

**Escenario con valores** (el de la ronda 13, sin cambios). Ráfaga de 22 fotos
en un POST con visión degradada (~25 s por foto) y descarga lenta (15 s): una
foto ~45 s, una ronda del pool ~45 s, 22 ÷ 5 = 5 rondas → **~225 s de reloj de
pared contra 120 s**. La invocación muere en la ronda 3; las fotos de las
rondas 4-5 no arrancan (sin claim), Meta ya tiene su 200 y no reintenta. Cada
`processInbound` arranca su propio presupuesto de 120 s — la foto 20 que
arranca a t=100 s cree tener 120 s cuando quedan 20. `route_pool.test.ts` mide
el pico de concurrencia (≤5), no el reloj del lote. El RFA 2.9 no tocó esta
ruta.

**Estado: abierto** (deuda de peor caso, no de hoy — no bloquea el demo).

### [MEDIO] `cuadrar_viaje` ahora barre el ejercicio DOS veces — la consulta nueva de la RFA 2.9 y `getAcumuladoCombustible` que ya existía

`src/lib/cuadra/tools.ts:92` (`const liq = await computeCuadre(...)` →
`cuadrarDesdeDB` → la agregación anual nueva), `:105` (`const acum = await
getAcumuladoCombustible(ctx.tenantId, ejercicio)` — el contador viejo,
`repo.ts:802`), `repo.ts:830` (el viejo, index-served por `idx_gasto_acumulado`,
orden `fecha, id` que sale del índice).

**Qué pasó.** La RFA 2.9 metió el contador del ejercicio dentro de
`cuadrarDesdeDB` (para que la guardia y el cierre lo tengan sin depender de la
tool), pero la tool `cuadrar_viaje` SIGUE llamando `getAcumuladoCombustible`
para su "capa de periodo" (`combustible_efectivo_ejercicio`, el contexto que le
da al LLM para narrar el 3% vs 14.8%). Resultado: **una sola llamada de
`cuadrar_viaje` hace dos barridos completos del año**, y el nuevo es el peor de
los dos (OR sin índice + sort por `id` — ver el ALTO de arriba). Antes de
`0d23f73` era UN barrido, y era el indexado.

**Escenario con valores.** A 30 mil cargas de diésel al año: el nuevo ~9 s (30
páginas) + el viejo ~9 s (30 páginas, indexado) = **~18 s en una sola tool**,
dentro de un turno de 120 s y contra la entrada `presupuesto.ts:40` que modela
`cuadrarDesdeDB` en 300 ms. Es trabajo duplicado que una sola fuente (o un
cache del ejercicio) eliminaría — los dos consumidores quieren el mismo número.

**Estado: abierto** (nuevo; el cierre natural es la misma agregación en SQL del
ALTO, que sirve a los dos llamadores).

### [MEDIO] "Por facturar" y el JOIN del consolidado siguen sin índice que sirva `(tenant_id, fecha)` — sin cambios, y ahora el cron lo paga 24 veces al día

`src/lib/cuadra/facturacion/pendientes.ts:121-125` (`.eq('tenant_id', ...)
.is('cfdi_uuid', null).order('fecha', ...)` sin índice),
`src/lib/cuadra/intake/consolidado.ts:244-248` (el JOIN por rango de fecha sin
índice), `src/app/dashboard/documentos/page.tsx:64` (la pantalla),
`src/lib/cuadra/facturacion/avisar.ts:110` (el cron → `getPorFacturar` al final
de CADA corrida, 24 veces al día — dentro de la cola sin presupuesto del ALTO
de arriba). Verifiqué 0063 (el único parcial existente ordena por
`autofactura_intentada_en nulls first, created_at` — para la cola del cron, no
para esta pantalla) y las migraciones 0081/0082: **ninguna añadió un índice
`(tenant_id, fecha)` parcial sobre `cfdi_uuid is null`**.

**Estado: abierto** (sin cambios; el escenario con valores de la ronda 13
—~228 mil filas sin CFDI al año, cada carga de `/dashboard/documentos`
ordenando el conjunto para quedarse con 500— sigue siendo válido).

### [BAJO] El fix del comentario `maxDuration=60` sigue a medias: el cuerpo de `esperarIntake` todavía dice 60

`src/lib/cuadra/conv.ts:577-579` ("Default 20s, NO 60s. El presupuesto de la
función es maxDuration=60 y por debajo de esta barrera todavía corren el lock
(12s) y el agente (40s): con 60s aquí el peor caso son 112s…"). El JSDoc de
`:560-562` ya dice 120 (el cierre de la 12) pero el comentario inline del
cuerpo quedó con el número viejo. Verifiqué el estado actual: la ruta está en
`maxDuration = 120` (route.ts:77) y `PRESUPUESTO_WEBHOOK_MS = 120_000`. El
código funciona; el rótulo miente — la misma familia de "el rótulo tiene que
ser verdad".

**Estado: abierto** (la ronda 13 lo documentó; ningún commit posterior lo tocó).

### [BAJO] La consulta del ejercicio corre SIN cortocircuito — se paga aunque la flota no declaró la facilidad o el viaje no trae diésel

`src/lib/cuadra/cuadre/desde_db.ts:61-62` (la agregación arranca
incondicionalmente), `:55-58` (`facilidad15` puede ser `undefined`), y el uso
en `engine.ts:302-306` (los totales solo se leen cuando `elegible === true`;
con `false`/`undefined` la diferencia es `efectivo_no_elegible` /
`combustible_efectivo` sin tocar el contador).

**Escenario con valores.** Un tenant que no declaró dedicación/régimen (el
estado normal de un cliente el día uno — la propia doc del motor lo llama
"sin declarar → por confirmar, nada se afirma") paga el barrido anual completo
en cada cuadre para alimentar una rama que nunca se ejecuta. Igual un viaje sin
ni un gasto de diésel. Hoy (40 filas) es despreciable; a la escala del ALTO es
~28 s de nada por cuadre. La dirección es un `if (facilidad15 !== true) skip`
— o la agregación en SQL del ALTO, que es más barata aunque corra.

**Estado: abierto** (nuevo).

### [BAJO] `.or()` con `clavesCombustible` vacío: `clave_prod_serv.in.()` — la única `.in()` del repo construida de un array de config

`src/lib/cuadra/cuadre/desde_db.ts:60` (`config.hidrocarburos?.claves ?? []`),
`:70` (`.or(\`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})\`)`).
Todos los demás `.in()` del repo usan literales no vacíos o se protegen con
`if (estatus?.length)` (`analytics.ts:433`). Aquí, un tenant cuya config ponga
`hidrocarburos: null` (posible: `fusionarConfig` reemplaza con null,
`config.ts:142-160`) produce `clave_prod_serv.in.()` — que PostgREST rechaza
con 400 (el cuadre entero cae fail-closed) o interpreta como siempre-falso
(cambia el denominador del 15% en silencio). No puedo verificar cuál de las dos
sin tocar la base (regla del rubro); cualquiera de las dos es un modo de fallo
que no tiene ni una prueba (los arneses de processor devuelven `[]` sin
ejercitar la semántica del filtro, `processor_cadena.test.ts:151-159`).

**Estado: abierto** (nuevo; no verificable sin la base — lo dejo como riesgo
declarado para el auditor de datos/fiscal).

### [BAJO] `guardarYConciliarConsolidado` sigue escribiendo una UPDATE por línea conciliada, en serie

`src/lib/cuadra/intake/consolidado.ts:268-270` (`for (const r of resultados) …
await ligarLineaAGasto(...)`), `:168-182` (cada ligada es un UPDATE acotado a
8 s). Un CFDI de monedero/TAG con 40 líneas conciliadas = ~40 UPDATEs
secuenciales ≈ 12-20 s en el peor caso, dentro del turno del webhook. Acotado,
best-effort, fail-closed — no es N+1 de lectura — pero sigue siendo el único
bucle del repo que escribe por fila en serie. Sin cambios desde la ronda 13.

**Estado: abierto**.

### [BAJO] El export de liquidaciones sigue violando el contrato de orden único de `traerTodo`

`src/app/api/export/liquidaciones/route.ts:69-70` (`.order('created_at', {
ascending: false })` sin desempate por `id` dentro de `traerTodo`), contra el
contrato de `pg.ts:132-134` ("Todos los llamadores desempatan con `id`").
Verifiqué: sigue siendo el ÚNICO llamador de `traerTodo` sin `.order('id')`.
Dos liquidaciones con el mismo `created_at` en el borde de página se pueden
repetir o saltar; la dirección es `.order('created_at', { ascending: false
}).order('id')`. Sin cambios desde la ronda 13.

**Estado: abierto**.

### [BAJO] Barrera de intake: sondeo cada 500 ms + 2 s de gracia fijos — diseño declarado, sin cambios

`src/lib/cuadra/conv.ts:591` (`CUADRA_INTAKE_GRACE_MS || 2_000`), `:605-608`
(bucle `vacio()` … `sleep(500)`). Verificado otra vez: el sondeo es un SELECT
por PK (no escribe), es fail-closed, la gracia anti-carrera está probada
(`barrera.test.ts`, 5 verdes — los corrí). El impuesto medible sigue siendo ~2 s
por "listo" y hasta ~40 SELECTs cuando la barrera se sostiene. Es el costo
documentado de la anti-carrera fotos+"listo"; no es un bug.

**Estado: abierto** (diseño declarado, sin cambios).

---

## Lo que revisé y está bien

- **Los fixes de la ronda 12/13 en el cron no regresaron.** El corte por flota
  (`route.ts:412`) y el corte entre portales de la misma flota (`:452`, sin
  tocar al principal) existen, corren y dejan lo cortado SIN marcar
  (`sinTiempo`, anunciado en la respuesta). Corrí `route.test.ts` (20 verdes) +
  `presupuesto.test.ts` (15 verdes): la prueba del presupuesto del lote sigue
  cubriendo "una sesión de 250 s deja a la segunda flota fuera" y el negativo
  "dos flotas rápidas SÍ se intentan las dos".
- **Cero N+1, verificado otra vez en los módulos del rubro**: `analytics.ts`
  (incluido el nuevo camino `reconstruir` → `cuadrarDesdeDB`, que es una
  llamada puntual por pantalla, no un bucle), `fiscal.ts` (el JOIN del contexto
  de viaje va en una segunda consulta con `.in()` — `fiscal.ts:728`), `repo.ts`,
  `operacion.ts`, `admin/negocio.ts` y las páginas del dashboard. Todo sigue el
  patrón `traerTodo` + `conteo()` + `LecturaIncompleta` (fail-closed).
- **Los agregados en SQL y los índices 0060/0061/0063/0071/0076**: leídos con
  su evidencia; la 0063 sigue sirviendo la cola del cron (el orden de
  `route.ts:291` coincide con el índice), la 0076 la cola "por conciliar", el
  export paginado está servido por `idx_liq_tenant` de la 0001. Nada regresó.
- **La 0082** (config_tenant_valida): es una función `immutable` de validación
  que corre en escrituras de config — costo despreciable, sin camino de lectura
  en el turno. La RFA 2.9 no tocó los crons, el pool ni el motor de presupuestos
  — solo el cuadre (ver hallazgos).
- **El claim atómico, los bloqueados que no reintentan, el modo `ensayo` por
  default** y `modoEfectivo`/mandato: intactos — el riesgo fiscal del ALTO del
  cron sigue dormido.
- **El fix de zona horaria de `getLiquidacionesPorDia`** (`analytics.ts:163-190`):
  intacto y probado (`analytics_por_dia.test.ts`, 3 verdes).
- **Pruebas del rubro corridas en esta ronda: 251 verdes.** `route.test.ts` 20,
  `presupuesto.test.ts` 15, `route_pool.test.ts` 10, `engine.test.ts` 112,
  `repo_acumulado.test.ts` 5, `consolidado.test.ts` 25, `barrera.test.ts` +
  `analytics_por_dia.test.ts` 8, `processor_cadena` + `processor_cierre` +
  `guardia.test.ts` 56. tsc 0 errores, eslint 0 en los archivos del rubro.
- **RLS 0081/0078/0079**: sin costo de consulta (funciones `stable` por PK de
  `app_user`, una evaluación por statement).

## Lo que no alcancé a revisar

- **El plan real de la consulta del ALTO en la base real**: la afirmación de
  que el `OR` impide usar `idx_gasto_acumulado` es estructural (no hay índice
  para `clave_prod_serv`), pero no la medí con `EXPLAIN` — regla del rubro, no
  toco la base. Si el auditor de datos puede correr un `EXPLAIN` sobre
  `tenant_id = X AND fecha BETWEEN … AND (concepto = 'diesel' OR
  clave_prod_serv IN (…))` en `gasto`, el hallazgo se afina con el plan exacto.
- **El comportamiento de PostgREST ante `in.()` vacío** (BAJO del `.or()`): lo
  dejo como riesgo declarado, no como bug probado.
- **Los crons de escalar y purgar** y el render de PDFs (determinístico con
  pdf-lib, verificado — no usa Chromium): fuera del alcance de este rubro o ya
  cubiertos.
- **La sesión real de CAPUFE en Vercel**: sigo sin medir los ~147-316 s con
  `@sparticuz/chromium` en frío; la estructura del riesgo (sin check dentro de
  la sesión) no cambia con la medición.

## VEREDICTO

**Ámbar — no hay green light del rubro: el ALTO de la ronda 13 sigue abierto y
la RFA 2.9 metió deuda nueva en el camino caliente.**

Motivos:

1. **El ALTO del cron sigue intacto** — verificado línea por línea, sin cambios:
   lote de 8 en una sesión (~316 s > 300 s), margen de 150 s que no cubre la
   suma de sus topes, y `avisarALasPersonas` sin presupuesto al final. Es el
   mismo bloqueador de la ronda 13, y su dirección de arreglo (check de reloj
   dentro de la sesión + margen = suma real de topes + presupuesto de avisos)
   sigue sin ejecutarse.
2. **La RFA 2.9 —la feature del demo— introdujo el hallazgo nuevo más caro de
   la ronda**: una agregación anual paginada por CADA cuadre, sin índice que
   sirva el brazo `clave_prod_serv`, sin cortocircuito, sin actualizar el
   presupuesto que la declara en 300 ms, duplicando el barrido que
   `getAcumuladoCombustible` ya hacía, y con un acantilado
   (`LecturaIncompleta`) en el volumen que la propia 0060 proyecta. No rompe el
   demo (40 filas), pero es la primera deuda de escala del repo que nace en la
   ruta del WhatsApp, no en una pantalla.
3. **Lo sano pesa pero no compensa**: cero N+1, 251 pruebas del rubro verdes,
   tsc/eslint limpios, los fixes del cron de la 12 sin regresión, y ningún
   cierre de la ronda 13 se rompió — pero tampoco se movió ninguno. La ronda 14
   del rubro no cerró nada y abrió un ALTO nuevo.

**6/10** — baja 1.5 puntos respecto a la ronda 13: el progreso previo se
sostiene, pero esta ronda es la primera en que la deuda nueva aparece en la
ruta del demo, y el bloqueador del cron sigue sin tocarse. Lo que haría subir
la nota: la agregación del ejercicio en SQL (sirve al ALTO nuevo, al MEDIO de
la duplicación y al BAJO del cortocircuito de un solo golpe) y el check de
reloj dentro de la sesión del cron.
