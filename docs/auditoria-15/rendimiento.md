# Rendimiento y costo — auditoría 15

Anclado a `d7b171f` (HEAD actual: los 7 hallazgos de backend de la ronda 13 +
pantalla ARCO, encima de `8a33ce1` + `0fa305e` + `0d23f73` y del release caae369
que está en producción). Audité el código ACTUAL línea por línea con el criterio
del rubro: **cron de facturación (300 s), pool del webhook (120 s), índices,
N+1, presupuestos** — y verifiqué cada cierre/pendiente de la ronda 14 abriendo
los archivos, sin creerme los títulos de los commits. No toqué la base, no
commiteé, no desplegué.

**Nota: 6.5/10** (6 en la ronda 14). Razón del movimiento — **sube medio punto**,
y es un movimiento honesto pero chico: el hallazgo nuevo más caro de la ronda 14
(el `traerTodo` anual bespoke dentro de `cuadrarDesdeDB`, con `.order('id')`,
sin `count`, y con `LecturaIncompleta` que tumbaba la liquidación) **murió** en
`8a33ce1` — ahora es best-effort, con la función vieja index-consciente y
fail-cerrado suave. Se cerraron además dos BAJOs (desempate del export,
`.or()` vacío). Pero el costo de fondo sigue exactamente en la ruta caliente:
el barrido anual paginado por cuadre sigue corriendo 3-4 veces por liquidación
con el brazo `clave_prod_serv` SIN índice (y es el camino de TODOS los tenants,
porque el default de config trae claves), la entrada del presupuesto sigue
mintiendo (300 ms), `cuadrar_viaje` sigue haciendo DOS barridos —ahora con año y
claves divergentes entre sí—, y el ALTO del cron no se movió ni un milímetro.
El commit dice "una sola barrida del ejercicio": es verdad por CUADRE, falso por
TOOL.

---

## Hallazgos

### [ALTO] El barrido anual por cuadre sigue en el camino caliente — transformado, no cerrado (la ronda 14 lo marcó ALTO; `8a33ce1` le cambió la forma, no el costo)

`src/lib/cuadra/cuadre/desde_db.ts:63` (`anioEjercicio` desde los comprobantes),
`:77-80` (`totalesEjercicio = await getAcumuladoCombustible(tenantId, Number(anioEjercicio), clavesCombustible)` — incondicional, best-effort con catch),
`src/lib/cuadra/repo.ts:831` (`.or(claves?.length ? \`concepto.eq.diesel,clave_prod_serv.in.(${claves.join(',')})\` : 'concepto.eq.diesel')`),
`src/lib/cuadra/config.ts:99-101` (`claves: ['15101505', '15101514', '15101515']` — el DEFAULT de todo tenant que no override hidrocarburos),
`src/lib/cuadra/presupuesto.ts:40` (`{ paso: 'guardiaCifras → cuadrarDesdeDB', ms: 300 }` — la entrada del presupuesto NO se tocó),
`src/lib/cuadra/cuadre/guardia.ts:105` (`snapshotCierre ?? (await cuadrarDesdeDB(...))` — corre en CADA turno con cifras),
`src/lib/cuadra/processor.ts:1957` (la guardia en el turno), `:1838` y `:1939` (fallbacks del agente — incluido el de `agente.sin_presupuesto`, que llama el barrido justo cuando el reloj ya se agotó),
`src/lib/cuadra/analytics.ts:800` (cada carga del detalle, `dashboard/[id]/page.tsx`),
`src/lib/cuadra/tools.ts:92` y `:160` (las dos tools).

**Qué se arregló de verdad (verificado abriendo `8a33ce1`).** La consulta bespoke
de la ronda 14 —`traerTodo` con `.or(...)`, `.order('id')` (sort del set
completo), sin `count`, y `LecturaIncompleta` fail-closed que tumbaba la
liquidación entera— **ya no existe**. En su lugar, `cuadrarDesdeDB` reusa
`getAcumuladoCombustible`, que: (a) pide `count: 'exact'` solo en la primera
página, (b) ordena `fecha, id` —coherente con `idx_gasto_acumulado` para el
brazo `concepto='diesel'`—, y (c) el llamador lo envuelve en try/catch: si falla
o se agota, el motor recibe ceros y la rama del 15% marca el efectivo para
`revisar` en vez de tumbar el cuadre. El acantilado pasó de duro a suave.

**Qué NO se arregló.** El costo no cambió: sigue siendo **una barrida paginada
de TODO el diésel del ejercicio por CADA cuadre**, 3-4 veces por liquidación.
Y un matiz que empeora el plan real: como el default de config trae las claves
SAT (`config.ts:99-101`), el `.or()` con `clave_prod_serv.in.(…)` corre para
TODOS los tenants — y ese brazo no tiene índice, así que el OR no se puede
servir con `idx_gasto_acumulado` (BitmapOr necesita un índice por brazo; solo
existe el de `concepto`). El plan realista es Seq Scan de `gasto` + Sort
`(fecha, id)` re-ejecutado por página (OFFSET). La 0064 ya documentó cuánto
cuesta este sort cuando el plan sale del índice.

**Escenario con valores.** La 0060 proyecta ~240 mil gastos al año por tenant;
el diésel domina (~40%) → **~95 mil filas al año**. `getAcumuladoCombustible`
pagina de 1,000 en 1,000: **95 viajes de red por cuadre**, y a los 0.3 s del
costo unitario del propio `presupuesto.ts` → **~28 s por cuadre**. Por
liquidación: `cuadrar_viaje` (2 barridos — ver MEDIO de abajo) +
`guardar_liquidacion` + la guardia del turno = **~112 s de barridos anuales por
liquidación**, contra `PRESUPUESTO_WEBHOOK_MS` de 120 s y una entrada de
presupuesto que modela el paso completo en **300 ms**. Cada carga del detalle
(`analytics.ts:800`) paga otro barrido. **El acantilado suave:** pasadas las
100,000 filas de diésel al año, `repo.ts:861` lanza (fail-closed), el catch de
`desde_db.ts:79` responde ceros, y el motor calcula `tope = 0.15 × 0 = 0` →
**todo el diésel en efectivo de CADA viaje cae a `efectivo_sobre_15` → estatus
`revisar`**: la facilidad del 15% muere entera para el tenant, en silencio (solo
dos warns por cuadre: `gasto.acumulado_incompleto` + `desde_db.contador_15_no_disponible`).
No es un bug de hoy (el demo tiene ~40 gastos y una página — no se entera), pero
es la misma deuda que 0060/0023/0063 se escribieron para pagar ANTES de que
muerda, viva en la ruta del WhatsApp.

**Dirección (la misma de la ronda 14):** `sum()` en SQL del diésel del ejercicio
por tenant (sirve de un golpe al ALTO, al MEDIO de la duplicación y al BAJO del
cortocircuito), o índice parcial sobre `clave_prod_serv` + cache del total del
ejercicio con invalidación por escritura. Y actualizar la entrada `:40` del
presupuesto cuando el costo deje de ser puntual.

**Estado: abierto** (transformado por `8a33ce1`, no cerrado — el costo y el
presupuesto mintiendo siguen).

### [MEDIO] `cuadrar_viaje` sigue con DOS barridos del ejercicio — y ahora con año y claves divergentes entre los dos

`src/lib/cuadra/tools.ts:92` (`const liq = await computeCuadre(...)` →
`cuadrarDesdeDB` → `getAcumuladoCombustible` CON claves y con el año de los
COMPROBANTES, `desde_db.ts:63/78`), `src/lib/cuadra/tools.ts:104-105`
(`const ejercicio = new Date().getUTCFullYear(); const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio)` — SIN claves y con el año del RELOJ).

**Qué pasó.** El commit `8a33ce1` promete "una sola barrida del ejercicio (reusa
getAcumuladoCombustible, best-effort)". Es verdad por CUADRE: `cuadrarDesdeDB`
ya no hace dos consultas. Pero la tool `cuadrar_viaje` **sigue llamando
`getAcumuladoCombustible` por su cuenta** para la "capa de periodo"
(`combustible_efectivo_ejercicio`, el contexto que el LLM narra). Resultado:
una sola llamada de `cuadrar_viaje` paga **dos barridos completos del año**, y
ahora los dos barridos divergen en TODO:
- **Año:** el motor ancla al año de los comprobantes (fix fiscal de la ronda
  14); la tool ancla al reloj del proceso (`getUTCFullYear`). Un viaje de
  diciembre cerrado en enero: el motor cuenta contra 2025, la "capa de periodo"
  contra 2026 — el aviso "te quedan $X antes de perder la deducción" puede
  narrar el ejercicio equivocado, y el trabajo duplicado no sirve de cache para
  el otro.
- **Claves:** el motor pasa `clavesCombustible` (default: 15101505/14/15); la
  tool no pasa nada → `concepto.eq.diesel` a secas. Tres contadores con tres
  criterios era exactamente lo que la ronda 14 marcó y el propio comentario de
  `repo.ts:825-829` dice haber venido a matar — pero la tool quedó fuera del
  arreglo.

**Escenario con valores.** 30 mil cargas de diésel al año: barrido del motor
(~30 páginas, OR → Seq Scan) + barrido de la tool (~30 páginas, index-served) =
**~18 s en una sola tool**, dentro de un turno de 120 s y contra la entrada
`presupuesto.ts:40` que modela `cuadrarDesdeDB` en 300 ms. Los dos consumidores
quieren el mismo número; el cierre natural es la agregación en SQL del ALTO
(una sola fuente para los dos llamadores).

**Estado: abierto** (ronda 14, MEDIO — persiste con la forma cambiada y una
divergencia fiscal nueva que la duplicación destapó).

### [MEDIO] El cron de facturación: sin cambios desde la ronda 13 — y ahora su cola de avisos paga barridos COMPLETOS de "sin CFDI" sin índice

`src/app/api/cron/facturar/route.ts:157` (`MARGEN_LOTE_MS = 150_000`), `:412` y
`:452` (los únicos checks de reloj, antes de CADA `conNavegador`/portal nuevo —
nunca dentro de la sesión), `:522` (`const avisos = await avisarALasPersonas(bloqueadosPorFlota, hoy)` — después del bucle, sin reloj),
`src/lib/cuadra/facturacion/adaptadores/capufe.ts:676` (el `for (const { codigo, r } of porIntentar)` dentro de `sesion()` sin consultar el reloj),
`src/lib/cuadra/facturacion/agente.ts:260` (el `for (const t of tickets)` sin reloj),
`src/lib/cuadra/facturacion/avisar.ts:110` (`getPorFacturar(args.tenantId, …)` dentro del aviso — ver el hallazgo de abajo),
`vercel.json` (el cron sigue a `:30` cada hora).

**Escenario 1 — el de la ronda 13, intacto.** Ocho tickets de CAPUFE en UNA
sesión con todos los topes al máximo: lanzar Chromium 30 s + navegar 20 s +
receptor 68 s + 8 × ~21 s + captura 10 s + esperarUuid 20 s ≈ **316 s > 300 s**.
El check de `:412` pasa en t=0; la sesión corre sin un solo corte interno
(`capufe.ts:676` procesa todos los códigos; `agente.ts:260` no mira el reloj
entre tickets). Vercel mata la invocación a los 300 s; en modo `emitir` el CFDI
puede quedar timbrado con `seApreto = true` y sin `escribirUuid`.

**Escenario 2 — la cola de avisos, ahora más cara.** `avisarALasPersonas`
(`:522`) corre con el reloj ya gastado y, por flota bloqueada, llama
`avisarPorFacturar` → `getPorFacturar` → **`traerTodo` de TODOS los gastos sin
CFDI** (paginado, ordenado, sin índice). Antes del fix de la ronda 14 esta
consulta devolvía 500 filas; ahora barre el conjunto completo. 3-4 flotas
bloqueadas al final de un lote de ~290 s = 3-4 barridos completos de ~228 mil
filas + red a Meta — la invocación muere antes de responder y la señal de
CAPTCHA se pierde sin rastro.

**Estado: abierto** (sin cambios desde la ronda 13; el fix de `d7b171f` mejoró
la honestidad de `getPorFacturar` y empeoró su costo — ver hallazgo siguiente).

### [MEDIO] "Por facturar" y el JOIN del consolidado: el fix de paginación hizo la lectura COMPLETA — y el índice sigue sin existir

`src/lib/cuadra/facturacion/pendientes.ts:125-131` (`.eq('tenant_id', …).is('cfdi_uuid', null).order('fecha', { nullsFirst: false }).order('id')` dentro de `traerTodo` — sin índice que sirva el filtro),
`src/lib/cuadra/intake/consolidado.ts:244-247` (el JOIN por rango de fecha, `.is('cfdi_uuid', null).gte('fecha', …).lte('fecha', …)`, sin índice),
`src/app/dashboard/documentos/page.tsx:64` (la pantalla), `src/lib/cuadra/facturacion/avisar.ts:110` (el cron, al final de CADA corrida — 24 veces al día).

**Qué cambió en esta ronda.** `d7b171f` convirtió `getPorFacturar` de
`.limit(500)` (recorte silencioso — el ALTO de backend de la ronda 13) a
`traerTodo`: correcto, pero ahora **cada llamada lee, pagina y ordena el
conjunto COMPLETO de gastos sin CFDI**. La corrección compró honestidad con
costo ilimitado: antes el trabajo se capaba en 500 filas; ahora una flota con
228 mil filas sin CFDI (la estimación de la ronda 13) paga ~228 páginas... hasta
que `traerTodo` lanza `LecturaIncompleta` a las 100 páginas (100,000 filas) y la
pantalla muestra su estado de error fail-closed. Verifiqué las migraciones
0081/0082/0083: **ninguna añadió un índice parcial `(tenant_id)` sobre
`cfdi_uuid is null`** ni para el JOIN por `(tenant_id, fecha)`. El costo
agregado: 24 veces al día desde el cron (más el aviso por flota bloqueada, más
cada carga de `/dashboard/documentos`), cada vez ordenando el conjunto en
memoria sin apoyo de índice.

**Estado: abierto** (ronda 14, MEDIO — el índice sigue faltando; el fix de
paginación agrandó la lectura, no el problema de fondo).

### [MEDIO] El pool del webhook sigue sin reloj de pared del lote — sin cambios desde la ronda 12

`src/app/api/webhook/whatsapp/route.ts:40` (`MAX_EN_PARALELO = 5`), `:77`
(`maxDuration = 120`), `:169` (`await conPool(permitidos, MAX_EN_PARALELO, …)`),
`src/lib/cuadra/processor.ts:351` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)` —
UN presupuesto por mensaje, no por lote), `:525`/`:798`
(`extraerComprobante(dataUrl, reloj.senal(25_000))`).

**Escenario con valores** (el de la ronda 13, sin cambios). Ráfaga de 22 fotos
en un POST con visión degradada (~25 s por foto) y descarga lenta (15 s): una
foto ~45 s, una ronda del pool ~45 s, 22 ÷ 5 = 5 rondas → **~225 s de reloj de
pared contra 120 s**. La invocación muere en la ronda 3; las fotos de las
rondas 4-5 no arrancan (sin claim), Meta ya tiene su 200 y no reintenta. Cada
`processInbound` arranca su propio presupuesto de 120 s — la foto 20 que arranca
a t=100 s cree tener 120 s cuando quedan 20. `route_pool.test.ts` mide el pico
de concurrencia (≤5), no el reloj del lote. Los commits de la ronda 14/15 no
tocaron esta ruta.

**Estado: abierto** (deuda de peor caso, no de hoy — no bloquea el demo).

### [BAJO] El comentario de `esperarIntake` sigue diciendo `maxDuration=60`

`src/lib/cuadra/conv.ts:577-579` ("Default 20s, NO 60s. El presupuesto de la
función es maxDuration=60 y por debajo de esta barrera todavía corren el lock
(12s) y el agente (40s)…"). El JSDoc de `:561` ya dice 120 (el cierre de la
ronda 12) pero el comentario inline del cuerpo quedó con el número viejo. La
ruta está en `maxDuration = 120` (route.ts:77) y `PRESUPUESTO_WEBHOOK_MS =
120_000`. El código funciona; el rótulo miente — la misma familia de "el rótulo
tiene que ser verdad". Ningún commit posterior lo tocó.

**Estado: abierto** (ronda 14, BAJO — intacto).

### [BAJO] La consulta del ejercicio corre SIN cortocircuito — se paga aunque la flota no declaró la facilidad o el viaje no trae diésel

`src/lib/cuadra/cuadre/desde_db.ts:77-80` (el barrido arranca
incondicionalmente), `:55-58` (`facilidad15` puede ser `undefined` — "sin
declarar"), y el uso en `engine.ts:302-306` (los totales solo se leen cuando
`elegible === true`). Un tenant que no declaró dedicación/régimen (el estado
normal de un cliente el día uno — el motor lo trata como "por confirmar, nada
se afirma") paga el barrido anual completo en cada cuadre para alimentar una
rama que nunca se ejecuta. Igual un viaje sin ni un gasto de diésel. Hoy (40
filas) es despreciable; a la escala del ALTO es ~28 s de nada por cuadre. La
dirección sigue siendo `if (facilidad15 !== true) skip` — o la agregación en SQL
del ALTO, que es más barata aunque corra.

**Estado: abierto** (ronda 14, BAJO — intacto).

### [BAJO] `guardarYConciliarConsolidado` sigue escribiendo una UPDATE por línea conciliada, en serie

`src/lib/cuadra/intake/consolidado.ts:259-268` (`for (const r of resultados) …
const ligado = await ligarLineaAGasto(...)`), `:168` (cada ligada es un UPDATE
acotado a 8 s). Un CFDI de monedero/TAG con 40 líneas conciliadas = ~40 UPDATEs
secuenciales ≈ 12-20 s en el peor caso, dentro del turno del webhook. Acotado,
best-effort, fail-closed — no es N+1 de lectura — pero sigue siendo el único
bucle del repo que escribe por fila en serie. Sin cambios.

**Estado: abierto** (ronda 14, BAJO — intacto).

### [BAJO] Barrera de intake: sondeo cada 500 ms + 2 s de gracia fijos — diseño declarado, sin cambios

`src/lib/cuadra/conv.ts:591` (`CUADRA_INTAKE_GRACE_MS || 2_000`), `:605-608`
(bucle `vacio()` … `sleep(500)`). Verificado otra vez: el sondeo es un SELECT
por PK (no escribe), es fail-closed, la gracia anti-carrera está probada
(`barrera.test.ts` + `barrera_sondeo.test.ts`, 13 verdes — los corrí). El
impuesto medible sigue siendo ~2 s por "listo" y hasta ~40 SELECTs cuando la
barrera se sostiene. Es el costo documentado de la anti-carrera fotos+"listo";
no es un bug.

**Estado: abierto** (diseño declarado, sin cambios).

### [BAJO] Higiene del fix de la ronda 14: import muerto en `desde_db.ts` y un paso de red nuevo fuera de `PASOS_CIERRE`

`src/lib/cuadra/cuadre/desde_db.ts:9` (`import { supabaseAdmin } from
'@/lib/supabase/admin'` — quedó sin uso al morir la query bespoke; eslint lo
marca: `@typescript-eslint/no-unused-vars`). Evidencia de que el fix de
`8a33ce1` se limpió a medias — la misma familia que dejó el comentario de
`conv.ts:577` y la entrada `presupuesto.ts:40` sin tocar.
`src/lib/cuadra/processor.ts:2141` (`await sendText(msg.from, 'Tu liquidación ya
quedó cerrada ✅, pero el PDF no se te entregó…').catch(() => {})` — el paso
nuevo de `d7b171f` en la rama `pdf.no_entregado`). Es un paso de RED en el
cierre que no está en `PASOS_CIERRE` ni pasa por `acotada` — `sendText` va con
`fetch` pelado (techo de undici: 300 s, según el propio comentario de
`presupuesto.ts:57-61`). En el peor caso (Meta fallando — que es justo cuando
esta rama corre) suma ~1.5 s al cierre; la holgura de `MARGEN_CIERRE_MS` (3.1 s)
lo absorbe, pero es un paso no contabilizado en el escenario donde la red ya
está degradada.

**Estado: abierto** (nuevo en esta ronda — menor).

---

## Cierres de la ronda 14 verificados

- **[BAJO] Export de liquidaciones sin desempate — CERRADO por `d7b171f`.**
  `src/app/api/export/liquidaciones/route.ts:69` ahora trae
  `.order('created_at', { ascending: false }).order('id', { ascending: false })`
  — el contrato de `pg.ts` ("todos los llamadores desempatan con `id`") vuelve a
  cumplirse; ya no es el único llamador de `traerTodo` sin `order('id')`.
- **[BAJO] `.or()` con `clavesCombustible` vacío — CERRADO por `8a33ce1`.**
  `repo.ts:831` protege el brazo: `claves?.length ? … : 'concepto.eq.diesel'`.
  Un tenant con `hidrocarburos: null` ya no produce `clave_prod_serv.in.()`.
  Verificado en el código actual y con `repo_acumulado.test.ts` (5 verdes).
- **[ALTO] La query bespoke de la RFA 2.9 — ELIMINADA por `8a33ce1`** (ver ALTO
  de arriba): el `traerTodo` con `.order('id')` y sin `count` ya no existe en
  `desde_db.ts`; lo reemplaza `getAcumuladoCombustible` con try/catch. El
  hallazgo se transformó, no se cerró: el costo sigue.

## Lo que revisé y está bien

- **Los fixes de la ronda 12/13 en el cron no regresaron.** El corte por flota
  (`route.ts:412`) y el corte entre portales de la misma flota (`:452`, sin
  tocar al principal) existen, corren y dejan lo cortado SIN marcar
  (`sinTiempo`). Corrí `route.test.ts` (20 verdes) + `presupuesto.test.ts` (15
  verdes): la prueba del presupuesto del lote sigue cubriendo "una sesión de
  250 s deja a la segunda flota fuera".
- **El motor de la RFA 2.9 es O(n) puro** — el fix de `8a33ce1` (excedente por
  comprobante, `proporcionDeducible.set`, cubetas) recorre los gastos del viaje
  una vez, sin consultas ni bucles anidados. `engine.test.ts` 114 verdes.
- **Cero N+1, verificado en los módulos del rubro y en lo nuevo de la ronda**:
  `analytics.ts` (incluido el camino `reconstruir` → `cuadrarDesdeDB`, que es
  una llamada puntual por pantalla), `repo.ts` (los ARCO nuevos:
  `listarSolicitudesArco` = un `traerTodo` con desempate `id`, `resolverSolicitudArco`
  = un UPDATE por PK+tenant), `admin/compliance/page.tsx` (dos consultas, sin
  bucles), `admin/negocio.ts` (el `config` extra del tenant sale en el mismo
  select — no suma viajes), `facturacion/*`, `intake/consolidado.ts`,
  `contactos.ts` (`telefonosJefe` es UNA consulta para todas las flotas).
- **El claim atómico, los bloqueados que no reintentan, el modo `ensayo` por
  default** y `modoEfectivo`/mandato: intactos — el riesgo fiscal del ALTO del
  cron sigue dormido.
- **El fix de zona horaria de `getLiquidacionesPorDia`**
  (`analytics.ts:163-190`): intacto (`analytics_por_dia.test.ts`, 3 verdes).
- **La 0083** (config_tenant_valida con forma): función `immutable` de
  validación en escrituras — costo despreciable, sin camino de lectura en el
  turno. La cola del cron sigue servida por el índice de la 0063 (el orden de
  `route.ts:291-293` coincide: `autofactura_intentada_en nulls first,
  created_at`), el export por `idx_liq_tenant` de la 0001.
- **Pruebas del rubro corridas en esta ronda: 287 verdes.** `route.test.ts` 20,
  `presupuesto.test.ts` 15, `route_pool.test.ts` 10, `engine.test.ts` 114,
  `guardia.test.ts` 20, `repo_acumulado.test.ts` 5, `pg.test.ts` 13,
  `consolidado.test.ts` 25, `barrera.test.ts` + `barrera_sondeo.test.ts` 13,
  `analytics_por_dia.test.ts` 3, `processor_cadena` + `processor_cierre` +
  `tools_cableado` + `tools_camino_real` 49. eslint 0 errores en los archivos
  del rubro (1 warning: el import muerto del hallazgo BAJO).

## Lo que no alcancé a revisar

- **El plan real de la consulta del ALTO en la base real**: la afirmación de que
  el OR con `clave_prod_serv` impide usar `idx_gasto_acumulado` es estructural
  (no hay índice para ese brazo y el default de config SIEMPRE trae claves),
  pero no la medí con `EXPLAIN` — regla del rubro, no toco la base. Un
  `EXPLAIN` sobre `tenant_id = X AND fecha BETWEEN … AND (concepto = 'diesel'
  OR clave_prod_serv IN (…)) ORDER BY fecha, id` en `gasto` afinaría el hallazgo
  con el plan exacto (Seq Scan + Sort por página vs. lo que yo infiero).
- **La sesión real de CAPUFE en Vercel**: sigo sin medir los ~147-316 s con
  `@sparticuz/chromium` en frío; la estructura del riesgo (sin check dentro de
  la sesión) no cambia con la medición.
- **Los archivos `zzz-*` del working tree** (`zzz-a15-probe`, `zzz-a15b-probe`,
  `zzz-fiscal-aud15-probe`, `zzz-r15-scratch`, `zzz-audit15`,
  `zzz_auditoria15_tmp`): son sondas SIN trackear de los auditores en paralelo —
  hoy rompen `npx tsc --noEmit -p .` (4 errores en dos de ellas). No son del
  repo; los dejo señalados para que el auditor de pruebas confirme que no llegan
  a master.
- **Los crons de escalar y purgar** y el render de PDFs (determinístico con
  pdf-lib): fuera del alcance de este rubro o ya cubiertos.

## VEREDICTO

**Ámbar — no hay green light del rubro: el ALTO de la ronda 14 se transformó
pero no se cerró, el ALTO del cron sigue intacto, y el fix de la RFA 2.9 quedó a
medias (prometió "una sola barrida" y la tool sigue barriendo dos veces).**

Motivos:

1. **El ALTO de la ronda 14 bajó de forma, no de fondo.** El `traerTodo`
   bespoke murió — crédito real: best-effort, count-exact, orden index-consciente,
   acantilado suave. Pero el barrido anual paginado por cuadre sigue en la ruta
   caliente 3-4 veces por liquidación, con el brazo `clave_prod_serv` sin índice
   (y es el default de TODOS los tenants), la entrada `presupuesto.ts:40` sigue
   modelando 300 ms, y el acantilado ahora degrada en silencio a "todo el
   efectivo a revisar" en vez de tumbar — mejor, pero la facilidad muere igual
   para el tenant que pase las 100,000 filas.
2. **El ALTO del cron sigue intacto** — verificado línea por línea, sin cambios:
   lote de 8 en una sesión (~316 s > 300 s), margen de 150 s que no cubre la
   suma de sus topes, y `avisarALasPersonas` sin presupuesto al final — ahora
   con `getPorFacturar` leyendo el conjunto COMPLETO de gastos sin CFDI por
   flota bloqueada.
3. **El fix de la ronda 14 se atacó a medias y sin cerrar la contabilidad**: la
   tool `cuadrar_viaje` sigue duplicando el barrido (con año y claves que
   divergen del motor — un riesgo fiscal nuevo nacido de la duplicación), el
   presupuesto no se actualizó, el comentario de `conv.ts` sigue mintiendo y
   quedó un import muerto. La disciplina "el rótulo tiene que ser verdad" se
   aplicó al motor y se le escapó la herramienta.
4. **Lo sano pesa**: cero N+1 (incluido lo nuevo de ARCO), 287 pruebas del rubro
   verdes, dos BAJOs cerrados y verificados, los fixes del cron de la 12 sin
   regresión, y el demo (40 gastos, una página) no se entera de nada de esto.

**6.5/10** — sube medio punto respecto a la ronda 14: el hallazgo nuevo más caro
de aquella ronda se desarmó de verdad (y dos BAJOs se cerraron), pero la deuda
de fondo sigue en la ruta del demo y el bloqueador del cron no se movió. Lo que
haría subir la nota: la agregación en SQL del diésel del ejercicio por tenant
(sirve al ALTO, al MEDIO de la duplicación y al BAJO del cortocircuito de un
solo golpe, y de paso mata la divergencia de año/claves entre motor y tool) y el
check de reloj dentro de la sesión del cron.
