# Rendimiento y costo — auditoría 13

Anclado a `caae369` (HEAD actual, el release de la auditoría 12 en producción).
Audité el código ACTUAL línea por línea con el criterio del rubro:
**cron de facturación (300 s), pool del webhook (120 s), índices, N+1**.
Verifiqué los cierres de la ronda 12 abriendo cada commit y cada archivo — no me
creí los títulos. No toqué la base, no commiteé, no desplegué.

**Nota: 7.5/10** (7 en la ronda 12). Razón del movimiento:

1. **Se atacó y subió a medias.** El ALTO de la ronda 12 (margen del cron de 60 s
   contra un peor caso de sesión de ~147 s, y corte por flota sin corte interno)
   recibió dos commits (`440de1b`, `584fa12`): el margen subió a 150 s y el
   bucle de portales de la misma flota ahora consulta el reloj entre portal y
   portal. Verifiqué los dos: existen, corren, y la prueba del presupuesto del
   lote (20 verdes) cubre el caso "una sesión de 250 s deja a la segunda flota
   fuera". **PERO el ALTO no se cerró**: el escenario que la propia ronda 12
   enumeró como segundo —ocho tickets de CAPUFE en UNA sesión, ~316 s en el peor
   de los topes, más que los 300 s de la invocación entera— sigue intacto, porque
   el check solo impide ARRANCAR una sesión, nunca acota lo que corre dentro de
   la que ya arrancó. Y el margen de 150 s se dimensionó contra el peor caso
   DOCUMENTADO (~147 s), no contra la suma de los topes que el propio código
   declara (~150-210 s para una sesión de un ticket).
2. **Apareció deuda nueva de la misma familia** al verificar los cierres: el
   "fix" del comentario `maxDuration=60` cambió el JSDoc de `esperarIntake` y
   dejó el comentario del CUERPO de la función y la cabecera de `presupuesto.ts`
   mintiendo igual — el cierre declarado de la ronda 12 está a medias. Y el
   export paginado (fix de la 12) viola el contrato de orden único de
   `traerTodo`, con riesgo de filas repetidas/saltadas en el CSV.
3. **Lo sano pesa más que lo abierto**: cero N+1 en los seis módulos de datos y
   en las páginas del dashboard, presupuestos con prueba de sincronía con
   `maxDuration`, agregados en SQL (0062/0064), índices medidos con EXPLAIN, el
   fix de zona horaria de `getLiquidacionesPorDia` correcto y probado, y 86
   pruebas del rubro corriendo verdes (tsc 0, eslint limpio).

---

## Hallazgos

### [ALTO] El cron de facturación: el ALTO de la ronda 12 se atacó a medias — el lote de 8 tickets en UNA sesión sigue sin caber en 300 s, el margen cubre solo el peor caso documentado, y `avisarALasPersonas` corre como cola sin presupuesto

`src/app/api/cron/facturar/route.ts:157` (`MARGEN_LOTE_MS = 150_000`), `:412`
(`if (Date.now() - inicioLote >= PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS)` antes de
cada `conNavegador`), `:452` (el mismo check entre portales de la misma flota),
`:458` (`await correrLote(tenantId, comercio, delPortal)` — sin ningún check
dentro de la sesión), `:522` (`const avisos = await avisarALasPersonas(...)`
después del bucle, sin reloj),
`src/lib/cuadra/facturacion/adaptadores/capufe.ts:654-720` (la sesión procesa
TODOS los códigos del lote sin mirar el reloj),
`src/lib/cuadra/facturacion/agente.ts:260-268` (el camino `unoPorUno` tampoco
mira el reloj entre tickets),
`src/lib/cuadra/facturacion/al_vuelo.ts:604` (`CLAIM_MINUTOS = 10`), `:508-547`
(`escribirUuid` se llama DESPUÉS del intento),
`src/lib/cuadra/facturacion/avisar.ts:110` (`avisarPorFacturar` → `getPorFacturar`),
`vercel.json` (el cron corre a `:30` cada hora).

**Escenario 1 — el que la ronda 12 documentó y el fix no tocó.** Una flota,
ocho tickets de CAPUFE en una sesión (el diseño estrella de esta ronda, el que
motivó `facturarLoteAlVuelo`), todos los topes al máximo: lanzar Chromium 30 s +
navegar 20 s + receptor 68 s + 8 × ~21 s (escribir 8 + clic validar 8 + buscarFila
~3-5) + captura 10 s + esperarUuid 20 s ≈ **316 s > 300 s**. El check de `:412`
pasa en t=0 (0 < 150). La sesión corre sin un solo corte interno. Vercel mata la
invocación a los 300 s, a media sesión, justo después de apretar emitir
(`seApreto = true`, `capufe.ts:717-719`). En modo `emitir`, el CFDI puede haber
quedado timbrado en el SAT sin que `escribirUuid` se alcance a ejecutar
(`al_vuelo.ts:282-283` y `:483-547`); el claim de `reclamarIntentos` expira en
`CLAIM_MINUTOS` = 10 min (`al_vuelo.ts:604`), el cron vuelve a correr una hora
después (`vercel.json`), re-elige los tickets con `cfdi_uuid is null` y emite
**un segundo CFDI por el mismo consumo**. La cadena completa que la ronda 12
describió sigue alcanzable.

**Escenario 2 — el margen de 150 s no cubre la suma de sus propios topes.** El
margen se dimensionó contra los ~147 s "medidos" que cita el encabezado
(`route.ts:17-22`). La suma de los topes que el propio código declara para UNA
sesión de un ticket en `emitir` es mayor: `TOPE_LANZAR_MS` 30 +
`TOPE_NAVEGAR_MS` 20 + 4 × `TOPE_ACCION_MS` 8 (receptor) + 2 desplegables con su
sondeo (~15-20 s cada uno) + ticket 8+8+3 + `TOPE_CAPTURA_MS` 10 +
`ESPERA_UUID_MS` 20 ≈ **150-210 s**. Una sesión puede arrancar a t=149.9 s (el
check pasa) y morir a t=300 s a media sesión — el mismo modo de fallo de la ronda
12, con la ventana más chica. El check de `:412` y el de `:452` comparten el
mismo umbral de 150 s, así que tampoco hay holgura para el desgaste del cierre de
la sesión ni para lo que venga después.

**Escenario 3 — la cola sin presupuesto.** `avisarALasPersonas` (`:522`) corre
DESPUÉS del bucle de flotas sin consultar el reloj. Por cada flota con
bloqueados: `telefonoJefeDe` (consulta) + `avisarPorFacturar` →
`getPorFacturar` (la consulta SIN índice de `pendientes.ts:123-125`) +
`sendTemplate` (red a Meta) + insert en `bitacora_auditoria`. Con 3-4 flotas
bloqueadas al final de un lote que ya consumió ~290 s, la invocación muere antes
de responder: el cron se ve como fallido en Vercel y los avisos a los encargados
—el cierre de la señal de CAPTCHA que esta misma ronda construyó— se pierden sin
rastro. No es una cifra inventada: cada paso es red real con su tope, y ninguno
se mide contra `inicioLote`.

**Qué mejoró de verdad (no es lo mismo que la ronda 12):** el `for` de flotas
corta antes de abrir un navegador que no va a caber (`:412`), el bucle de
portales corta entre portal y portal sin tocar al principal (`:452-458`), lo
cortado queda SIN marcar (`sinTiempo`, se recoge entero la corrida siguiente) y
se anuncia en la respuesta, y la prueba `route.test.ts:328-390` existe y pasa
(20 verdes, los corrí). El modo por defecto sigue siendo `ensayo` — el riesgo
fiscal está dormido hasta que `FACTURACION_MODO=emitir` + mandato se pongan a
mano. La dirección que falta es la que la ronda 12 ya marcó y este fix dejó a
medias: **un check de reloj DENTRO de la sesión (antes de cada ticket del lote, y
dentro de `unoPorUno`), un margen que sea la suma real de los topes de la sesión
más larga posible (no el peor caso de un ticket), y un presupuesto para la cola
de avisos.**

**Estado: abierto** (mejorado; el cierre que la síntesis de la ronda 12 dio por
hecho —"cron por sesión con margen real"— no cubre el escenario del lote de 8 que
la propia ronda 12 enumeró, ni la suma real de topes, ni la cola de avisos).

### [MEDIO] El pool del webhook sigue sin reloj de pared del lote: sin cambios desde la ronda 12

`src/app/api/webhook/whatsapp/route.ts:40` (`MAX_EN_PARALELO = 5`), `:77`
(`maxDuration = 120`), `:169` (`await conPool(permitidos, MAX_EN_PARALELO, …)`),
`src/lib/cuadra/processor.ts:351` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)` —
UN presupuesto por mensaje, no por lote), `:525` y `:798`
(`extraerComprobante(dataUrl, reloj.senal(25_000))`),
`src/lib/meta/client.ts:10` (`DOWNLOAD_TIMEOUT_MS = 15_000`).

**Escenario con valores.** El propio comentario documenta la ráfaga de 22 fotos
en un POST (`route.ts:52-59`, `route_pool.test.ts:96`). Con el proveedor de
visión degradado (cada foto cerca de su tope de 25 s) y la descarga lenta
(15 s), una foto cuesta ~45 s y una ronda del pool (5 en paralelo) ~45 s.
22 fotos ÷ 5 = 5 rondas → **~225 s de reloj de pared contra 120 s de
`maxDuration`**. La invocación muere a mitad de la ronda 3; las ~8-10 fotos de
las rondas 4-5 ni siquiera arrancan —no tienen claim en `wa_mensaje_procesado`
(se toma al entrar a `processInbound`)—, Meta ya recibió su 200 (`route.ts` lo
contesta antes del `after()`), así que no se reintentan jamás. Cada
`processInbound` arranca su propio presupuesto de 120 s (`processor.ts:351`): la
foto número 20 que arranca a t=100 s cree tener 120 s cuando a la invocación le
quedan 20. La prueba del pool (`route_pool.test.ts`) solo mide el pico de
concurrencia (≤5 en vuelo), no el reloj de pared del lote: el escenario de arriba
no tiene ni una prueba que lo ejercite. La dirección de arreglo —un reloj
COMPARTIDO de la invocación creado en `route.ts` y pasado a cada `processInbound`,
o cortar el `conPool` cuando el reloj no alcanza para otra foto completa— sigue
sin ejecutarse.

**Estado: abierto** (sin cambios desde la 12; deuda de peor caso, no de hoy).

### [MEDIO] "Por facturar" y el JOIN del consolidado siguen sin índice que sirva `(tenant_id, cfdi_uuid is null, fecha)`

`src/lib/cuadra/facturacion/pendientes.ts:121-125` (`.eq('tenant_id', ...)
.is('cfdi_uuid', null).order('fecha', { ascending: true, nullsFirst: false })
.limit(500)`), `src/lib/cuadra/intake/consolidado.ts:244-248` (`.is('cfdi_uuid',
null).gte('fecha', rango.desde).lte('fecha', rango.hasta)`),
`supabase/migrations/0063_lo_que_falta_para_operar.sql:56-58` (el parcial que
sí existe ordena por `(autofactura_intentada_en nulls first, created_at)` —
escrito para la cola del cron, no para esta pantalla). Verifiqué las
migraciones 0065-0080: ninguna añadió un índice `(tenant_id, fecha)` parcial
sobre `cfdi_uuid is null`.

**Escenario con valores.** La 0060 proyecta ~240 mil gastos al año y ~95% sin
CFDI → **~228 mil filas sin CFDI por año**. Cada carga de `/dashboard/documentos`
(`documentos/page.tsx:64`) materializa y ordena por `fecha` ese conjunto para
quedarse con 500. Y ya no es solo la pantalla: `avisarALasPersonas` →
`avisarPorFacturar` (`avisar.ts:110`) llama a `getPorFacturar` al final de CADA
corrida del cron (24 veces al día) — sobre el mismo conjunto, sin índice, y
dentro de la cola sin presupuesto del ALTO de arriba. El JOIN del consolidado
(`consolidado.ts:244-248`) filtra por rango de fecha sin índice. Hoy, con 38
filas, es instantáneo — es deuda de escala, la misma clase que la 0060/0061 se
escribieron para pagar antes de tiempo. La dirección sigue siendo un parcial
`(tenant_id, fecha) where cfdi_uuid is null` medido con EXPLAIN.

**Estado: abierto** (sin cambios desde la 12).

### [BAJO] El fix del comentario `maxDuration=60` quedó a medias: el cuerpo de `esperarIntake` y la cabecera de `presupuesto.ts` siguen mintiendo

`src/lib/cuadra/conv.ts:577-579` (el comentario DENTRO del cuerpo de
`esperarIntake` sigue diciendo: "Default 20s, NO 60s. El presupuesto de la
función es maxDuration=60 y por debajo de esta barrera todavía corren el lock
(12s) y el agente (40s): con 60s aquí el peor caso son 112s…"),
`src/lib/cuadra/presupuesto.ts:11-13` (la cabecera: "…sin saber que comparten
los 60s con el agente —que es la parte cara—").

El commit `f2d8152` —que la síntesis de la ronda 12 dio por cerrado— cambió
SOLO el JSDoc de `esperarIntake` (`conv.ts:561`). Verifiqué el diff: una línea.
El comentario inline del cuerpo (`conv.ts:577-579`) y la cabecera de
`presupuesto.ts` —que la propia ronda 12 citó como "arrastra el mismo '60s'
histórico"— quedaron con el número viejo. La ruta está en `maxDuration = 120`
(`route.ts:77`) y `PRESUPUESTO_WEBHOOK_MS = 120_000` (`presupuesto.ts:188`). El
código funciona (el tope lo pone el reloj compartido); el rótulo miente — la
misma familia de "el rótulo tiene que ser verdad" que este repo persigue.

**Estado: abierto** (el cierre de la ronda 12 está incompleto; verificado en el
código actual).

### [BAJO] `guardarYConciliarConsolidado` sigue escribiendo una UPDATE por línea conciliada, en serie

`src/lib/cuadra/intake/consolidado.ts:255-270` (`for (const r de resultados) …
await ligarLineaAGasto(…)`), `:168-182` (cada `ligarLineaAGasto` es un UPDATE
acotado a 8 s).

Un CFDI consolidado de monedero/TAG puede traer decenas de líneas y conciliar
varias de un golpe; cada `ligarLineaAGasto` es un viaje de red secuencial.
40 líneas conciliadas = ~40 UPDATEs ≈ 12-20 s en el peor caso, dentro del turno
del webhook que procesa el mensaje de la oficina. Está acotado, es best-effort y
falla cerrado — no es un N+1 de lectura —, pero sigue siendo el único bucle del
repo que escribe por fila en serie. La dirección barata (un solo
`UPDATE … in (ids)` por lote de conciliadas) sigue sin ejecutarse.

**Estado: abierto** (sin cambios desde la 12).

### [BAJO] El export de liquidaciones viola el contrato de orden único de `traerTodo`: pagina por `created_at` sin desempate por `id`

`src/app/api/export/liquidaciones/route.ts:69` (`.order('created_at', {
ascending: false }).range(d, h)` dentro de `traerTodo`), y el contrato que el
propio `src/lib/cuadra/pg.ts:132-134` declara: "LA CONSULTA TIENE QUE VENIR
ORDENADA POR ALGO ÚNICO. … Todos los llamadores desempatan con `id`."

El fix de la ronda 12 paginó el export (bien: con `traerTodo` + `conteo()` +
`LecturaIncompleta`, cerró el recorte a 5,000) pero lo paginó con un orden NO
único. Dos liquidaciones con el mismo `created_at` (mismo microsegundo de un
`now()` compartido — posible con cierres en lote) en el borde de una página se
pueden repetir o saltar entre páginas; con inserciones concurrentes durante la
paginación (offset por posición, cada página es una consulta sin snapshot) el
riesgo crece. Es el ÚNICO llamador de `traerTodo` que no desempata con `id`
(verificado: los ~50 demás usan `.order('id')`). El CSV que alimenta un ERP
quedaría con filas repetidas/faltantes — la misma familia del "CSV corto" que el
fix vino a cerrar, por otro lado. La dirección: `.order('created_at', {
ascending: false }).order('id')`. El índice `idx_liq_tenant
(tenant_id, created_at desc)` de la 0001 sí sirve el orden — el problema es el
contrato de paginación, no el índice.

**Estado: abierto** (nuevo, encontrado al verificar el cierre de la ronda 12).

### [BAJO] Barrera de intake: sondeo cada 500 ms (hasta ~40 SELECTs por "listo") más 2 s de gracia fijos en el camino común

`src/lib/cuadra/conv.ts:591` (`const grace = Number(process.env.
CUADRA_INTAKE_GRACE_MS) || 2_000`), `:605-608` (bucle `vacio() … sleep(500)`).

Verificado que el sondeo sigue SIN escribir (`intakePendientes` es un SELECT por
PK, `conv.ts:531-553`), que es fail-closed (`null` no abre la barrera), que el
TTL de 10 min existe y que la gracia anti-carrera está probada
(`barrera.test.ts`, 5 verdes — los corrí). Lo que queda: cada mensaje de texto
"listo" paga la gracia de 2 s aunque no haya ninguna foto en vuelo (el caso
común), y hasta ~40 consultas si la barrera se sostiene los 20 s. Es el costo
documentado de la anti-carrera fotos+"listo" en el mismo lote; no es un bug, es
un impuesto medible (~2 s de latencia por "listo").

**Estado: abierto** (diseño declarado, sin cambios).

---

## Lo que revisé y está bien

- **El corte del cron existe, corre y está probado.** El check por flota
  (`route.ts:412`) y el check entre portales de la misma flota (`:452`, sin tocar
  al principal — el fix `584fa12` hace exactamente lo que dice su mensaje), lo
  cortado queda SIN marcar (`sinTiempo`) y se anuncia en la respuesta. Corrí
  `route.test.ts` + `presupuesto.test.ts`: 35 verdes. La prueba del presupuesto
  del lote cubre el caso "una sesión de 250 s deja a la segunda flota fuera" y el
  negativo "dos flotas rápidas SÍ se intentan las dos".
- **El claim atómico (`reclamarIntentos`, `al_vuelo.ts:613-645`), los bloqueados
  que no reintentan (`motivoDeBloqueo`), el modo `ensayo` por default y
  `modoEfectivo`/mandato**: intactos y probados — el riesgo fiscal del ALTO está
  dormido hasta que `FACTURACION_MODO=emitir` + mandato se pongan a mano.
- **El fix de zona horaria de `getLiquidacionesPorDia`** (`analytics.ts:163-190`):
  `toLocaleDateString('en-CA', { timeZone: TZ_MX })` con `TZ_MX` definido en
  `formato.ts:34`; la prueba `analytics_por_dia.test.ts` pasa (3 verdes). El
  cierre del ALTO de pruebas de la ronda 12 está bien hecho.
- **`acotada()` / `TOPE_CONSULTA_MS` y la prueba de sincronía con `maxDuration`**
  (`presupuesto.test.ts:79-91`): el techo en dos capas, fail-closed, y la prueba
  que falla si `PRESUPUESTO_WEBHOOK_MS` (120 s) se desincroniza de la ruta.
  Corridas: 15 verdes.
- **N+1, línea por línea**: `analytics.ts`, `comercial.ts`, `operacion.ts`,
  `admin/negocio.ts`, `repo.ts` y las páginas del dashboard (`page.tsx`,
  `valor-ahorro`, `analitica`, `viajes`, `combustible-casetas`, `despacho`,
  `documentos`) — cero N+1. Todo sigue el patrón `Promise.all` + `traerTodo`
  (paginado, con `conteo()` = count exacto en la primera página y
  `LecturaIncompleta` si no puede probar que trajo todo, `pg.ts:137-175`) y la
  agregación en memoria con `Map`. `getLineasPorConciliar` hace 2 consultas extra
  con `.in()` — no es N+1. Las validaciones nuevas de la ronda 12
  (`viajePropio`/`operadorPropio`, `operacion.ts:502-522`) son una consulta por
  id — pesadas de más (podrían ser `maybeSingle`) pero no N+1 y no están en un
  bucle.
- **Índices 0060/0061/0063/0071/0076**: leídos con su evidencia. La 0063 sigue
  sirviendo la cola del cron (el orden de `route.ts:289-292` coincide con el
  índice). La 0076 sirve la cola "por conciliar". El export paginado está servido
  por `idx_liq_tenant (tenant_id, created_at desc)` de la 0001. La 0061
  documenta la trampa del tenant único y el costo de escritura medido
  (1.1 µs/insert). Nada de esto regresó.
- **RLS 0078/0079**: sin costo de consulta (`get_user_tenant_ids()`/
  `is_operador()` son SQL `stable` por PK de `app_user`, una evaluación por
  statement).
- **El pool de 5**: el pico de concurrencia está probado (`route_pool.test.ts` —
  nunca más de 5 en vuelo, y 5 verdes). Lo que NO está probado es el reloj de
  pared del lote — por eso el MEDIO sigue abierto.
- **`downloadMediaAsDataUrl`/`sendText`/`sendDocument`** llevan
  `AbortSignal.timeout` (15 s / 10 s, `meta/client.ts:10-17`): no hay fetch
  pelado en el camino del webhook.
- **`registrarSolicitudArco`** usa import dinámico y un insert único — costo
  despreciable en el camino de privacidad (que además solo corre cuando el texto
  parece una solicitud ARCO).
- **tsc --noEmit: 0 errores**; suite del rubro: 86 verdes (35 cron/presupuesto +
  23 pool/barrera + 25 consolidado + 3 por-día).

## Lo que no alcancé a revisar

- **La sesión real de CAPUFE en Vercel**: los ~147-316 s del ALTO son sumas de
  topes, no mediciones con `@sparticuz/chromium` en frío dentro del contenedor de
  la función. Si alguien mide el peor caso real, el número se afina — la
  estructura del riesgo no cambia: no hay check de reloj dentro de la sesión.
- **El render del PDF del contralor** (`export/pdf/[id]`) y su presupuesto: otra
  superficie con Chromium que no profundicé.
- **Verificar contra la base real que 0060-0080 estén aplicadas**: regla del
  rubro — no toco la base; lo cubre el auditor de datos. Los índices se leyeron
  en las migraciones, no en `pg_indexes`.
- **El comportamiento exacto de Vercel al matar una invocación con Playwright
  abierto** (procesos huérfanos de Chromium, `finally` truncado): es
  operabilidad, no presupuesto de tiempo.
- **Los crons de escalar y purgar**: fuera del alcance de este rubro (los cubren
  otros auditores).

## VEREDICTO

**Ámbar para el rubro de rendimiento — no hay green light hasta cerrar el ALTO
del cron del todo.**

Motivos:

1. **El ALTO de la ronda 12 se atacó de verdad y no se cerró.** El margen subió
   de 60 s a 150 s y el bucle de portales consulta el reloj — progreso real,
   verificado en código y en prueba. Pero el escenario del lote de 8 tickets en
   UNA sesión (~316 s, el segundo escenario que la propia ronda 12 enumeró) sigue
   intacto: no hay check de reloj dentro de `facturarVarios` ni en `unoPorUno`,
   el margen cubre el peor caso documentado (~147 s) no la suma de los topes
   (~150-210 s), y `avisarALasPersonas` corre sin presupuesto al final de la
   invocación. La cadena fiscal (CFDI timbrado sin UUID, claim que expira en 10
   min, segundo CFDI en la corrida siguiente) sigue alcanzable el día que
   `FACTURACION_MODO=emitir` se ponga a mano. Ese es el bloqueador, y es el mismo
   de la ronda 12.
2. **Los MEDIO siguen abiertos y son deuda de escala/peor caso, no de hoy**: el
   pool del webhook pierde el final de una ráfaga grande solo con el proveedor de
   visión lento para TODAS las fotos; el índice de `fecha` de "por facturar"
   muerde al volumen que la 0060 proyecta (y ahora el cron lo paga también 24
   veces al día por la cola de avisos). Ninguno bloquea el demo del 6-ago.
3. **La deuda nueva es de la misma familia que este repo persigue**: un fix
   declarado cerrado (el comentario de 60 s) que quedó a medias en dos lugares, y
   un export paginado que viola el contrato de orden único que su propio helper
   documenta. Ninguno es crítico; los dos se arreglan en una línea.
4. **Lo verificado y sano pesa más que lo abierto**: cero N+1, presupuestos con
   prueba de sincronía, agregados en SQL, índices medidos con EXPLAIN, el fix de
   zona horaria correcto, y 86 pruebas del rubro verdes.

7.5/10 — sube medio punto respecto a la ronda 12: el corte por sesión con margen
mayor y el check entre portales son mejoras reales y probadas, pero el ALTO
sigue abierto (ahora con la ventana más chica), los dos MEDIO no se movieron, y
el cierre declarado del BAJO del comentario está incompleto. La dirección de
arreglo del ALTO está clara y es barata: check de reloj dentro de la sesión
(antes de cada ticket del lote), margen = suma real de topes de la sesión más
larga posible, y un presupuesto para la cola de avisos.
