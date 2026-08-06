# Rendimiento y costo — auditoría 16

Anclado a `c901226` (HEAD actual: ARCO de la flota en /dashboard + entrega de la
respuesta por WhatsApp, encima de `96f2adc` — los fixes de la ronda 15 — y del
release `caae369` que está en producción). Audité el código ACTUAL línea por
línea con el criterio del rubro: **cron de facturación (300 s), pool del webhook
(120 s), índices, N+1, presupuestos** — y verifiqué cada hallazgo abierto de la
ronda 15 abriendo los archivos, sin creerme los títulos de los commits. No toqué
la base, no commiteé, no desplegué.

**Nota: 6.0/10** (6.5 en la ronda 15). Razón del movimiento — **baja medio
punto, por mirada más profunda, no por regresión de la ronda**: la 16 no cerró
NI UN hallazgo de rendimiento; el único toque real (alinear el año del viaje en
`tools.ts`) es un arreglo parcial que deja el costo intacto y agrega una consulta
duplicada; y al verificar la contabilidad del cierre con la que la ronda 15
apoyaba su nota, resulta que **ya era ficción antes de la 15**: la tabla
`PASOS_CIERRE` declara TRECE pasos y 8.9 s, pero `avisarCierreAlJefe` (agregado
en `3a8d06e`, DESPUÉS de que la tabla se creó en `fa03b00`) añadió 4 pasos de
red que nunca entraron a la tabla, y el cierre real del camino feliz suma
**~13.8 s contra un margen de 12 s** — con la prueba que "protege" la tabla
verde. El ALTO de la ronda 14 (barrido anual por cuadre), los tres MEDIOs del
cron / "por facturar" / pool y los BAJOs del comentario y el cortocircuito
siguen exactamente donde estaban.

---

## Hallazgos

### [ALTO] El barrido anual por cuadre sigue en el camino caliente — intacto (ronda 14/15; la 16 solo le pasó un dato nuevo, no el costo)

`src/lib/cuadra/cuadre/desde_db.ts:63-66` (`anioEjercicio` — el cambio de la 16
es un passthrough puro al motor, no toca la consulta), `:77-80`
(`totalesEjercicio = await getAcumuladoCombustible(tenantId, Number(anioEjercicio), clavesCombustible)` — incondicional, best-effort con catch),
`src/lib/cuadra/repo.ts:808` (`PAGINA = 1_000`), `:812` (`MAX_PAGINAS = 100`),
`:819` (el bucle), `:831` (`.or(claves?.length ? 'concepto.eq.diesel,clave_prod_serv.in.(…)' : 'concepto.eq.diesel')`),
`src/lib/cuadra/config.ts:101` (`claves: ['15101505', '15101514', '15101515']` — el default de TODO tenant),
`src/lib/cuadra/presupuesto.ts:40` (`{ paso: 'guardiaCifras → cuadrarDesdeDB', ms: 300 }` — la entrada del presupuesto sigue mintiendo),
`src/lib/cuadra/cuadre/guardia.ts:105` (`snapshotCierre ?? (await cuadrarDesdeDB(...))` — el snapshot solo salva el turno de cierre),
`src/lib/cuadra/processor.ts:1957` (la guardia), `:1838` y `:1939` (los dos fallbacks del agente), `src/lib/cuadra/analytics.ts:800` (cada carga del detalle).

**Verificado abriendo `96f2adc` y `c901226`:** ningún commit de la ronda tocó
`repo.ts:819-861`, la entrada `presupuesto.ts:40` ni el `config.ts` default. El
cambio de `desde_db.ts` (añadir `anioEjercicio` al objeto devuelto) es una línea
de datos, no una consulta. El costo sigue siendo **una barrida paginada de TODO
el diésel del ejercicio por CADA cuadre**, 3 veces por liquidación (ver el MEDIO
de abajo), con el brazo `clave_prod_serv` sin índice — plan realista: Seq Scan +
Sort `(fecha, id)` re-ejecutado por página.

**Escenario con valores** (el de la ronda 15, sin cambios). ~95 mil cargas de
diésel al año → **95 viajes de red por barrido**; a los 0.3 s del costo unitario
del propio `presupuesto.ts` → **~28 s por barrido**. Por liquidación:
`cuadrar_viaje` (2 barridos) + `guardar_liquidacion` (1 barrido) + la guardia
(snapshot, ya no paga el cuarto) = **~85 s** contra `PRESUPUESTO_WEBHOOK_MS` de
120 s y una entrada de presupuesto que modela el paso en **300 ms**. Cada carga
del detalle (`analytics.ts:800`) paga otro barrido. **El acantilado suave
sigue**: pasadas las 100,000 filas (`MAX_PAGINAS`), `repo.ts:861` lanza, el
catch de `desde_db.ts:79` responde ceros, y el motor —con el fail-closed REAL de
la ronda 15 (`engine.ts:305-323`)— ahora manda TODO el diésel en efectivo del
viaje a `por_confirmar` con nota honesta en vez de "excedente contra $0". Mejor
que antes, pero la facilidad del 15% muere igual para el tenant que pase las
100,000 filas, solo que ahora en silencio y con más filas en revisión.

**Estado: abierto** (transformado por `8a33ce1`, endurecido por `96f2adc`, nunca
cerrado — el costo y el presupuesto mintiendo siguen).

### [MEDIO] `cuadrar_viaje` sigue pagando DOS barridos — la 16 alineó el año pero no el costo ni las claves, y agregó un `getViaje` duplicado

`src/lib/cuadra/tools.ts:107` (`const viajeCtx = await getViaje(ctx.viajeId, ctx.tenantId)` — NUEVO en la 16, duplica la lectura que `cuadrarDesdeDB` ya hace en `desde_db.ts:30`),
`:108-109` (`const ejercicio = viajeCtx?.fechaInicio ? … : new Date().getUTCFullYear(); const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio)` — el barrido #2 SIN claves),
`:114` (`const cfg = await getConfig(ctx.tenantId)` — segunda lectura de config del turno),
`src/lib/cuadra/cuadre/desde_db.ts:78` (el barrido #1 CON claves), `src/lib/cuadra/tools.ts:164` (el barrido #3 en `guardar_liquidacion`).

**Qué se arregló de verdad (verificado en `96f2adc`).** La divergencia de AÑO
que la ronda 15 marcó —el motor anclado a los comprobantes y la tool al reloj
del proceso— está cerrada para el caso normal: la tool ahora lee `fechaInicio`
del viaje, mismo ancla que `desde_db.ts:63`. El aviso "te quedan $X antes de
perder la deducción" ya no narra el ejercicio equivocado. Crédito real.

**Qué NO se arregló.** (a) Siguen siendo **tres barridos completos del año por
liquidación** (tool + motor dentro de `cuadrar_viaje`, y `guardar_liquidacion`
paga otro en `tools.ts:164`). (b) Las **claves siguen divergiendo**: el motor
pasa `clavesCombustible` (default 15101505/14/15, `desde_db.ts:78`) y la tool no
pasa nada (`tools.ts:109` → `concepto.eq.diesel` a secas). Tres contadores con
tres criterios era lo que la ronda 14 vino a matar; la tool sigue fuera del
arreglo. (c) El nuevo `getViaje` de `tools.ts:107` es la MISMA consulta que
`cuadrarDesdeDB` acaba de hacer — un viaje de red duplicado por llamada, y el
fallback `new Date().getUTCFullYear()` reintroduce la divergencia de año en el
caso borde: un viaje sin `fecha_inicio` (que `desde_db.ts:63-66` resuelve con la
fecha del primer comprobante) sigue anclando la tool al reloj del proceso.

**Escenario con valores.** 95 mil cargas de diésel al año: barrido del motor
(~95 páginas, OR → Seq Scan) + barrido de la tool (~95 páginas, index-served) =
**~57 s en UNA tool**, dentro de un turno de 120 s y contra la entrada
`presupuesto.ts:40` que modela `cuadrarDesdeDB` en 300 ms. Con
`guardar_liquidacion` al cierre: **~85 s**. Los tres consumidores quieren el
mismo número; el cierre natural sigue siendo la agregación en SQL del ALTO (una
sola fuente para todos los llamadores).

**Estado: abierto** (ronda 14/15, MEDIO — el año se alineó, el costo y las
claves no; la duplicación quedó más barata de leer y más cara de ejecutar).

### [MEDIO] El cron de facturación: sin cambios desde la ronda 13 — y su cola de avisos sigue pagando barridos COMPLETOS de "sin CFDI" sin índice

`src/app/api/cron/facturar/route.ts:157` (`MARGEN_LOTE_MS = 150_000`), `:412` y
`:452` (los únicos checks de reloj, antes de CADA `conNavegador`/portal nuevo —
nunca dentro de la sesión), `:522` (`const avisos = await avisarALasPersonas(bloqueadosPorFlota, hoy)` — después del bucle, sin reloj),
`src/lib/cuadra/facturacion/adaptadores/capufe.ts:676` (el `for (const { codigo, r } of porIntentar)` dentro de `sesion()` sin consultar el reloj),
`src/lib/cuadra/facturacion/agente.ts:260` (el `for (const t of tickets)` sin reloj),
`src/lib/cuadra/facturacion/avisar.ts:110` (`getPorFacturar` dentro del aviso — ver el MEDIO de abajo),
`vercel.json` (el cron sigue a `:30` cada hora).

**Escenario 1 — intacto desde la ronda 13.** Ocho tickets de CAPUFE en UNA
sesión con todos los topes al máximo: ~316 s > 300 s. Los checks de `:412`/`:452`
pasan en t=0; la sesión corre sin un solo corte interno. Vercel mata la
invocación a los 300 s; en modo `emitir` el CFDI puede quedar timbrado con
`seApreto = true` y sin `escribirUuid`.

**Escenario 2 — la cola de avisos, ahora más cara que en la ronda 15.**
`avisarALasPersonas` (`:522`) corre con el reloj ya gastado y, por flota
bloqueada, `avisarPorFacturar` → `getPorFacturar` → `traerTodo` de TODOS los
gastos sin CFDI (paginado, ordenado por `fecha, id` — orden que NO sirve el
índice `gasto_por_facturar_idx` de la 0063, que es `(autofactura_intentada_en
nulls first, created_at)`). 3-4 flotas bloqueadas al final de un lote de ~290 s
= 3-4 barridos completos + red a Meta — la invocación muere antes de responder y
la señal de CAPTCHA se pierde sin rastro.

**Estado: abierto** (sin cambios desde la ronda 13; la 15/16 no lo tocó).

### [MEDIO] "Por facturar" y el JOIN del consolidado: lectura COMPLETA sin índice que sirva el orden — sin cambios

`src/lib/cuadra/facturacion/pendientes.ts:125-132` (`.eq('tenant_id', …).is('cfdi_uuid', null).order('fecha', …).order('id')` dentro de `traerTodo`),
`src/lib/cuadra/intake/consolidado.ts:245-247` (el JOIN por rango de fecha, `.is('cfdi_uuid', null).gte('fecha', …).lte('fecha', …)`, sin índice),
`src/app/dashboard/documentos/page.tsx` (la pantalla), `src/lib/cuadra/facturacion/avisar.ts:110` (el cron, 24 veces al día).

Verifiqué las migraciones 0081/0082/0083 (las de la ronda): **ninguna añadió un
índice** para `cfdi_uuid is null` + `fecha` ni para el JOIN del consolidado; la
0063 solo cubre la cola del cron. Un tenant con 228 mil filas sin CFDI paga
~228 páginas hasta que `traerTodo` lanza `LecturaIncompleta` a las 100,000 filas
y la pantalla muestra su estado fail-closed — 24 veces al día desde el cron.

**Estado: abierto** (ronda 14, MEDIO — sin cambios).

### [MEDIO] El pool del webhook sigue sin reloj de pared del lote — sin cambios

`src/app/api/webhook/whatsapp/route.ts:40` (`MAX_EN_PARALELO = 5`), `:77`
(`maxDuration = 120`), `:169` (`await conPool(permitidos, MAX_EN_PARALELO, …)`),
`src/lib/cuadra/processor.ts:351` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)` —
UN presupuesto por mensaje, no por lote), `:525`/`:798`
(`extraerComprobante(dataUrl, reloj.senal(25_000))`).

**Escenario con valores** (el de la ronda 13, sin cambios). Ráfaga de 22 fotos
en un POST con visión degradada (~25 s por foto) y descarga lenta (15 s): una
foto ~45 s, una ronda del pool ~45 s, 22 ÷ 5 = 5 rondas → **~225 s de reloj de
pared contra 120 s**. La invocación muere en la ronda 3; las fotos de las rondas
4-5 no arrancan (sin claim), Meta ya tiene su 200 y no reintenta. Cada
`processInbound` arranca su propio presupuesto de 120 s — la foto 20 que arranca
a t=100 s cree tener 120 s cuando quedan 20. `route_pool.test.ts` mide el pico
de concurrencia (≤5), no el reloj del lote.

**Estado: abierto** (deuda de peor caso, no de hoy — no bloquea el demo).

### [MEDIO — NUEVO] La contabilidad del cierre es ficción: la tabla declara TRECE pasos y el cierre real tiene ~17; la suma real (13.8 s) se pasa del margen (12 s) — y la prueba que "protege" la tabla sigue verde

`src/lib/cuadra/presupuesto.ts:21-29` (el claim: "LOS PASOS DE RED DEL CIERRE,
UNO POR UNO… son TRECE viajes de red secuenciales y suman 8.9s… 3.1s de
holgura"), `:31-33` ("Meter un paso más al cierre sin ampliar el margen deja de
ser un descuido silencioso y pasa a ser una prueba en rojo"), `:72`
(`MARGEN_CIERRE_MS = 12_000`),
`src/lib/cuadra/presupuesto.test.ts:115` (`expect(PASOS_CIERRE).toHaveLength(13)`),
`src/lib/cuadra/processor.ts:2162` (`await avisarCierreAlJefe(...)` — agregado en `3a8d06e`, DESPUÉS de que `fa03b00` creó la tabla; la tabla no se tocó),
`src/lib/cuadra/avisar_cierre.ts:90-131` (lo que esa llamada paga: `telefonoJefeDe` = 1 lectura (`:95`); `resumenDeCierre` = 2 lecturas en `Promise.all` (`:103`); `sendText` si `requiereDecision` (`:109`); `sendDocument` siempre que haya PDF (`:127`)),
`src/lib/cuadra/processor.ts:2141` y `:2177` (los dos envíos de la rama `pdf.no_entregado`/`pdf.contralor_no_generado`, agregados en `d7b171f`, tampoco en la tabla).

**Qué encontré.** Verifiqué con `git log -S PASOS_CIERRE` y `git log -L` que la
tabla nació en `fa03b00` y que `3a8d06e` (avisarCierreAlJefe) y `d7b171f` (los
dos sendText de fallo) son posteriores y **ninguno actualizó la tabla ni el
margen**. La promesa del archivo —"pasa a ser una prueba en rojo"— es
demostrablemente falsa: dos commits agregaron pasos de red al cierre y la prueba
`toHaveLength(13)` sigue verde porque la tabla nunca cambió. El cierre real del
camino feliz con decisión (cierre que requiere aviso al jefe) es:

| Paso | ms |
|---|---|
| los 13 declarados | 8,900 |
| `telefonoJefeDe` (1 lectura) | 300 |
| `resumenDeCierre` (2 lecturas en paralelo) | 600 |
| `sendText` al jefe (si `requiereDecision`) | 1,500 |
| `sendDocument` al jefe | 2,500 |
| **Total real** | **13,800** |

**13.8 s > 12 s de `MARGEN_CIERRE_MS`**: la reserva no cubre ni el costo nominal
de su propio cierre. Con la rama `pdf.no_entregado` encima: **15.3 s**. La
lectura de "3.1s de holgura" con la que la ronda 15 cerró su nota ya era
optimista cuando se escribió — `3a8d06e` es anterior a la auditoría 15. Y de
paso, la entrada `presupuesto.ts:40` (300 ms) es la misma que el ALTO de arriba
modela en ~28 s reales: dos de los TRECE pasos declarados valen una fracción de
su costo real.

**Escenario con valores.** Liquidación que cierra con diferencia (lo común):
el cierre paga los 13 declarados + `avisarCierreAlJefe` entero ≈ **13.8 s**; con
Meta degradado (justo cuando el PDF pudo no salir), la rama `pdf.no_entregado`
añade su `sendText` → **15.3 s**; cualquiera de los dos se come la holgura de
3.1 s y alcanza el techo de 120 s del turno sin que ninguna prueba se entere.

**Estado: abierto** (nuevo en esta ronda — evidencia que la 15 no miró).

### [BAJO — NUEVO] La acción "Responder" de ARCO bloquea el navegador del usuario hasta ~11 s (server action con dos envíos de WhatsApp en serie)

`src/lib/cuadra/repo.ts:979-1006` (`resolverSolicitudArco`: SELECT + UPDATE +
`enviarRespuestaArco` en serie, todo dentro de la server action),
`src/lib/meta/client.ts:441-481` (`enviarRespuestaArco`: hasta DOS `fetch` a Meta
con `AbortSignal.timeout(SEND_TIMEOUT_MS)`), `:17` (`SEND_TIMEOUT_MS = 10_000`),
`src/app/dashboard/arco/page.tsx:23-39` (la server action `accionResponder`, que
espera todo eso antes de devolver).

**Escenario con valores.** Fuera de la ventana de 24 h y con la plantilla aún
sin aprobar (el caso del commit: "en revisión de Meta"), el flujo es: texto libre
→ Meta responde 400 rápido → intento de plantilla → 400 rápido → ~1-2 s totales,
aceptable. Con Meta degradado: el texto libre cuelga hasta el aborto a los 10 s
→ el `catch` de `repo.ts:1004` devuelve `{ enviada: false }` → **~10.6 s de
spinner en el navegador** para un botón que "no pudo enviar". No está en el
presupuesto de 120 s del webhook (es una server action de panel), pero es un
camino lento nuevo en `/dashboard/arco` y `/admin/compliance` — y no pasa por
`acotada` ni por ningún presupuesto compartido, igual que los `sendText` del
cierre.

**Estado: abierto** (nuevo en esta ronda — menor, no toca la ruta del WhatsApp).

### [BAJO] El comentario de `esperarIntake` sigue diciendo `maxDuration=60`

`src/lib/cuadra/conv.ts:577-579` ("Default 20s, NO 60s. El presupuesto de la
función es maxDuration=60 y por debajo de esta barrera todavía corren el lock
(12s) y el agente (40s)…"). El JSDoc de `:561` ya dice 120; el comentario inline
del cuerpo quedó con el número viejo. La ruta está en `maxDuration = 120`
(route.ts:77) y `PRESUPUESTO_WEBHOOK_MS = 120_000`. El código funciona; el
rótulo miente. Ningún commit de la 15/16 lo tocó.

**Estado: abierto** (ronda 14, BAJO — intacto).

### [BAJO] La consulta del ejercicio corre SIN cortocircuito — se paga aunque la flota no declaró la facilidad o el viaje no trae diésel

`src/lib/cuadra/cuadre/desde_db.ts:77-80` (el barrido arranca incondicionalmente),
`:55-58` (`facilidad15` puede ser `undefined` — "sin declarar"), y el uso en
`engine.ts:305-315` (los totales solo se leen cuando `elegible === true`). Un
tenant que no declaró dedicación/régimen (el estado normal de un cliente el día
uno) paga el barrido anual completo en cada cuadre para alimentar una rama que
nunca se ejecuta. Igual un viaje sin ni un gasto de diésel. Hoy (40 filas) es
despreciable; a la escala del ALTO es ~28 s de nada por cuadre. La dirección
sigue siendo `if (facilidad15 !== true) skip` — o la agregación en SQL del ALTO.

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
(`barrera.test.ts` + `barrera_sondeo.test.ts`, verdes — los corrí). El impuesto
medible sigue siendo ~2 s por "listo" y hasta ~40 SELECTs cuando la barrera se
sostiene. Es el costo documentado de la anti-carrera fotos+"listo"; no es un bug.

**Estado: abierto** (diseño declarado, sin cambios).

### [BAJO] Higiene: el import muerto de `desde_db.ts` sigue ahí (ronda 15, intacto)

`src/lib/cuadra/cuadre/desde_db.ts:9` (`import { supabaseAdmin } from
'@/lib/supabase/admin'` — verifiqué con grep que es el ÚNICO uso de
`supabaseAdmin` en el archivo; quedó sin uso al morir la query bespoke de la
ronda 14). Evidencia de que el fix de `8a33ce1` se limpió a medias — la misma
familia que dejó el comentario de `conv.ts:577`, la entrada `presupuesto.ts:40`
y (descubierto en esta ronda) los pasos de cierre fuera de la tabla del MEDIO
nuevo. Menor, pero el repo promete "tsc 0" y esta línea es ruido muerto que
eslint marca.

**Estado: abierto** (ronda 14, BAJO — intacto).

---

## Cierres de la ronda 15 verificados

- **Ronda 15: no cerró NINGÚN hallazgo de rendimiento.** Su reporte decía
  "transformado, no cerrado" para el ALTO y dejó 9 hallazgos abiertos; los
  verifico uno por uno en este reporte: **todos siguen abiertos**, con el matiz
  de que el MEDIO de los dos barridos mejoró un grado (año alineado) sin
  cerrarse (costo y claves intactos).
- **Los cierres de la ronda 14 siguen vivos** (verificados de nuevo en el árbol
  actual): el export con desempate `created_at desc, id desc`
  (`src/app/api/export/liquidaciones/route.ts:69`), el guard del `.or()` vacío
  (`repo.ts:831`), y la query bespoke eliminada (hoy `desde_db.ts` reusa
  `getAcumuladoCombustible` con try/catch best-effort).
- **El fail-closed REAL del contador del 15% existe y está probado**
  (`engine.ts:305-323`, 3 pruebas nuevas en `engine.test.ts:1524-1555`): contador
  caído → `por_confirmar` con nota honesta, nunca "excedente contra $0". Es un
  cambio de CORRECCIÓN, no de rendimiento — lo revisé y es O(n) puro, sin
  consultas nuevas.

## Lo que revisé y está bien

- **Pruebas del rubro corridas en esta ronda: 299 verdes.** `route.test.ts` 20,
  `presupuesto.test.ts` 15, `route_pool.test.ts` 10, `engine.test.ts` 114 (+3 de
  la ronda 15), `guardia.test.ts` 20, `repo_acumulado.test.ts` 5, `pg.test.ts`
  13, `consolidado.test.ts` 25, `barrera.test.ts` + `barrera_sondeo.test.ts` 13,
  `analytics_por_dia.test.ts` 3, `processor_cadena` 14, `processor_cierre` 22,
  `tools_cableado` 8, `tools_camino_real` 5, `avisar_cierre` 12.
- **El motor sigue O(n) puro tras el fail-closed de la 15**: el bloque nuevo
  (`engine.ts:305-323`) recorre los gastos una vez, con `slice(0,4)` y
  comparaciones — cero consultas, cero bucles anidados.
- **La guardia del turno de cierre NO paga el barrido**: `snapshotCierre ??
  cuadrarDesdeDB` (`guardia.ts:105`) usa el snapshot cuando `guardar_liquidacion`
  corrió en el turno — el 4º barrido que la ronda 15 contaba ya no corre en el
  camino feliz del cierre.
- **El cambio de año en `tools.ts` es real** (verificado en `96f2adc`): la tool
  ancla al `fechaInicio` del viaje, mismo criterio que el motor — el riesgo
  fiscal "el aviso narra el ejercicio equivocado" está cerrado para el caso
  normal.
- **Cero N+1 en lo nuevo de la ronda**: `listarSolicitudesArco` es UN
  `traerTodo` con el embed `operador:operador_id(nombre)` y filtro por tenant;
  `datosDeCompliance` (`admin/compliance/page.tsx`) son DOS `traerTodo` en
  `Promise.all` con embeds (`operador`, `flota`) — el superadmin ve todas las
  flotas con dos consultas, no con un bucle; la tabla `solicitud_arco` es chica
  y tiene `arco_pendientes_idx (tenant_id, estado, vence_en)` (0053). El orden
  `recibida_en desc, id desc` no está indexado, pero a ese volumen no importa.
- **`actualizarFacilidad15` comprueba el error de lectura** (`repo.ts:926-927`):
  un bache de red ya no reemplaza la config entera por una sola llave. Misma
  cantidad de consultas que antes — sin costo nuevo.
- **Los fixes del cron de la ronda 12 no regresaron** (`route.ts:412`/`:452`,
  `presupuesto.test.ts` con la sesión de 250 s). La cola sigue servida por el
  índice de la 0063 (el orden de `route.ts` coincide con
  `autofactura_intentada_en nulls first, created_at`).
- **El demo no se entera de nada de esto**: ~40 gastos, una página por barrido,
  la acción ARCO del demo manda texto libre dentro de la ventana de 24 h (si
  Meta lo acepta, <1 s).

## Lo que no alcancé a revisar

- **El plan real de la consulta del ALTO en la base real**: la afirmación de que
  el OR con `clave_prod_serv` impide usar `idx_gasto_acumulado` sigue siendo
  estructural (no hay índice para ese brazo y el default de config SIEMPRE trae
  claves), pero no la medí con `EXPLAIN` — regla del rubro, no toco la base.
- **La sesión real de CAPUFE en Vercel**: sigo sin medir los ~147-316 s con
  `@sparticuz/chromium` en frío; la estructura del riesgo (sin check dentro de
  la sesión) no cambia con la medición.
- **Los archivos de sonda SIN trackear del working tree** — rompen
  `npx tsc --noEmit -p .` hoy (6 errores en 6 archivos):
  `src/lib/cuadra/audit16_fiscal_probe.test.ts`, `audit16_probe2.test.ts`,
  `src/lib/cuadra/cuadre/zzz-aud16-probe2.test.ts`, `zzz-aud16-probe3.test.ts`,
  `zzz-aud16-probe4.test.ts`, `zzz-aud16-toolcalling-probe.test.ts` — todos
  importan `PoliticaGasto` de `@/types/cuadra`, que ya no se exporta. No son del
  repo; los dejo señalados para que el auditor de pruebas confirme que no llegan
  a master (misma situación que las `zzz-a15-*` de la ronda 15).
- **Los crons de escalar y purgar** y el render de PDFs: fuera del alcance de
  este rubro o ya cubiertos.

## VEREDICTO

**Ámbar — no hay green light del rubro: el ALTO de la ronda 14 no se movió, los
tres MEDIOs de fondo (cron, por-facturar, pool) tampoco, y la mirada más
profunda a la contabilidad del cierre destapó que el margen que la ronda 15
creía sano (12 s vs 8.9 s) ya estaba roto antes de que la 15 lo revisara (13.8 s
reales, con la prueba verde).**

Motivos:

1. **Cero cierres en la ronda.** La 16 no tocó un solo hallazgo de rendimiento:
   el ALTO del barrido, el cron, "por facturar", el pool, el comentario de
   `conv.ts`, el cortocircuito y el bucle del consolidado están idénticos a como
   la ronda 15 los dejó. Lo único que cambió —el año de la tool— es un arreglo
   parcial dentro de un MEDIO abierto.
2. **El hallazgo nuevo es de los que bajan la nota, no de los que la suben.**
   La tabla `PASOS_CIERRE` es la pieza central de la disciplina de presupuestos
   del repo ("ahora es una tabla y pasa a ser una prueba en rojo"), y está
   demostrablemente incompleta desde `3a8d06e`: 4 pasos de `avisarCierreAlJefe`
   + 2 envíos de la rama `pdf.no_entregado` nunca entraron, la prueba
   `toHaveLength(13)` sigue verde, y el cierre real (13.8-15.3 s) se pasa del
   margen (12 s) a costo nominal. La ronda 15 escribió "la cuenta seguía
   cabiendo en los 12 s con 3.1 s de holgura" sobre una cuenta que no incluía
   los pasos que ya existían.
3. **Lo que sí se arregló es de corrección, no de costo.** El fail-closed del
   contador del 15% (`engine.ts`) y el mismo año en motor y tool son cambios
   reales y bien probados — pero el primero endurece el acantilado del ALTO
   (más filas a revisión cuando el barrido falla) y el segundo deja intactos los
   ~57-85 s de barridos por liquidación.
4. **Lo sano pesa lo mismo que en la 15**: 299 pruebas del rubro verdes, cero
   N+1 en lo nuevo (ARCO con embeds en una sola consulta), el motor O(n), el
   snapshot de la guardia evitando el 4º barrido, y el demo (40 gastos, una
   página) no se entera de nada.

**6.0/10** — baja medio punto respecto a la ronda 15: no hubo ataque al rubro y
la verificación profunda mostró que la contabilidad del cierre (un pilar de la
nota anterior) era ficción desde antes de la 15. Lo que haría subir la nota: la
agregación en SQL del diésel del ejercicio por tenant (sirve de un golpe al
ALTO, al MEDIO de los tres barridos, al BAJO del cortocircuito y a la entrada
mintiendo de `presupuesto.ts:40`), el check de reloj dentro de la sesión del
cron, y actualizar `PASOS_CIERRE` con los pasos reales (o subir el margen) para
que la prueba vuelva a significar algo.
