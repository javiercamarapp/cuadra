# Rendimiento y costo — auditoría 12

Anclado a `ce9abab` (HEAD al empezar, el fix de RLS 0078). Árbol limpio salvo
`docs/auditoria-12/`. Audité el código ACTUAL línea por línea con el criterio
del rubro: **acotada/presupuesto de tiempo, presupuesto del webhook, N+1,
índices, cron de facturación (300 s) y barrera de intake**. No toqué la base,
no commiteé, no desplegué.

**Nota: 7/10** (igual que ronda 10). Razón del movimiento, con las tres formas
del criterio de la síntesis:

1. **Se atacó y subió, pero no se cerró**: el ALTO de la ronda 10 —el `for` de
   flotas del cron de facturación abría el siguiente navegador sin consultar el
   reloj— YA tiene el corte (`route.ts:406`, `MARGEN_LOTE_MS`), con su prueba
   (`route.test.ts` "el presupuesto de tiempo del lote") y con el peor caso
   documentado en el propio comentario. Verifiqué el fix: existe, corre, y la
   prueba cubre el caso "una sesión de 250 s deja a la segunda flota fuera".
   PERO la aritmética del propio arreglo sigue sin cuadrar para el peor caso
   que el mismo archivo declara: el margen es de 60 s y la sesión de portal
   puede necesitar ~147 s (y un lote de 8 tickets en una sesión, ~316 s en el
   peor de los topes). El corte reduce el riesgo de la ronda 10, no lo cierra —
   ver el ALTO de abajo.
2. **Deuda que cobró factura**: la ronda 10 dejó dicho que el pool de 5 del
   webhook era la mejora medida del día. Al revisarlo a fondo contra los topes
   reales de cada etapa (`download 15 s` + `visión 25 s`), el pool acota la
   concurrencia pero NO el reloj de pared del lote: una ráfaga de 22 fotos con
   el proveedor de visión lento necesita ~5 rondas × ~45 s = ~225 s contra los
   120 s de `maxDuration`. El comentario de la ruta dice que "el reloj de cada
   foto vuelve a significar algo" — es cierto por foto, falso para el lote.
3. **Apareció un hallazgo nuevo de la misma familia de escala**: la pantalla
   "por facturar" ordena por `fecha` y el único índice parcial sobre
   `cfdi_uuid is null` (0063) ordena por `(autofactura_intentada_en,
   created_at)` — al volumen que la propia 0060 proyecta (~228 mil gastos sin
   CFDI al año), cada carga de esa pantalla ordena todo el histórico sin índice.
   Misma clase de "la cifra no cabe en su herramienta" que cerraron la 0061/0062,
   solo que en el lado de facturación.

## Hallazgos

### [ALTO] El cron de facturación: el corte por reloj existe, pero su margen (60 s) no cubre el peor caso de sesión (~147 s) que el propio archivo documenta, y el corte es por FLOTA, no por sesión de portal
`src/app/api/cron/facturar/route.ts:151` (`MARGEN_LOTE_MS = 60_000`), `:406`
(`if (Date.now() - inicioLote >= PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS)`), `:378`
(el `for` de flotas), `:434` (`for (const [comercio, delPortal] of porPortal)`
— sin ningún check en medio), `src/lib/cuadra/facturacion/adaptadores/
pagina_playwright.ts:53` (`TOPE_NAVEGAR_MS=20_000`), `:70` (`TOPE_ACCION_MS=
8_000`), `:85` (`TOPE_LECTURA_MS=3_000`), `:99` (`TOPE_CAPTURA_MS=10_000`),
`:109` (`TOPE_LANZAR_MS=30_000`), `src/lib/cuadra/facturacion/adaptadores/
playwright_base.ts:97` (`ESPERA_UUID_MS=20_000`), `src/lib/cuadra/facturacion/
adaptadores/capufe.ts:454` (`esperaMaxMs ?? 10_000`), `src/lib/cuadra/
facturacion/al_vuelo.ts:604` (`CLAIM_MINUTOS = 10`).

**El corte se añadió (ronda 10 → hoy) y no es suficiente para su propio peor
caso.** La cuenta del propio archivo, con los topes que el mismo código declara:

- Sesión de portal de UN ticket, todos los topes al máximo (el criterio de
  "peor caso de la cadena" que la ronda 10 usó y el propio comentario de
  `route.ts:17-22` repite): lanzar Chromium 30 s + navegar 20 s + receptor
  (4 × escribir 8 s = 32 s + 2 desplegables × ~18 s = 36 s) + por ticket
  (escribir código 8 s + clic validar 8 s + `buscarFila` ~3-5 s) + captura
  10 s + (en `emitir`) `esperarUuid` 20 s ≈ **~147 s**.
- El check de `:406` corta antes de abrir una sesión nueva SOLO si ya pasaron
  240 s. O sea que **una sesión puede arrancar a t=239.9 s y ser matada por
  Vercel a los 300 s, 60 s después, a media sesión** — el margen de 60 s es
  menos de la mitad de los ~147 s que una sesión puede necesitar.
- Escenario con valores: tres flotas, cada una con una sesión de CAPUFE de
  ~115 s (portal lento, cada espera al 60-80% de su tope — nada exótico):
  sesión 1 de 0→115, sesión 2 de 115→230, el check en 230 pasa (230 < 240),
  sesión 3 arranca a t=230 y muere a t=300 — **70 s dentro de la sesión**.
  En modo `emitir` con `seApreto = true` ya marcado (`capufe.ts:719-720`), el
  CFDI puede haber quedado timbrado en el SAT sin que `cfdi_uuid` se alcance a
  escribir de vuelta (`escribirUuid`, `al_vuelo.ts:508-547`, se llama DESPUÉS
  del intento, `al_vuelo.ts:282` y `:483`). El claim expira en `CLAIM_MINUTOS` (10 min, `al_vuelo.ts:604`) y la
  corrida siguiente re-elige el ticket → **segundo CFDI por el mismo consumo**.
- Segundo escenario, UNA sola flota: lote de 8 tickets de CAPUFE en una sesión
  (el diseño estrella de esta ronda), todos los topes al máximo:
  30 + 20 + 68 + 8 × 21 + 10 + 20 ≈ **316 s > 300 s**. La invocación muere
  durante el último `buscarFila` o el `esperarUuid` — justo después de apretar
  emitir.
- Y el check es por FLOTA, no por sesión: dentro de `conNavegador`, los
  portales de una misma flota corren en serie (`:434`, `await correrLote`) sin
  volver a mirar el reloj. Una flota con 2 portales distintos (CAPUFE + una
  gasolinera) puede consumir ~294 s en un solo `conNavegador` sin ningún corte
  interno, y una con 3, ~441 s → matada en la tercera.

**Qué mejoró de verdad (no es lo mismo que la ronda 10):** el `for` de flotas
ahora corta antes de abrir un navegador que no va a caber, lo no intentado
queda SIN marcar (`sinTiempo`, se recoge entero la corrida siguiente), y el
modo por defecto sigue siendo `ensayo` — el riesgo fiscal está dormido hasta
que `FACTURACION_MODO=emitir` + mandato se pongan a mano. La dirección de
arreglo barata que la ronda 10 propuso se ejecutó; lo que falta es que el
check use el peor caso real de sesión (~147 s) en vez de un colchón fijo de
60 s, y que mire el reloj también entre portales de la misma flota (y dentro
del lote de 8, antes de cada ticket si hace falta). El colchón debería ser
`PEOR_CASO_SESION_MS + margen de respuesta`, no `60_000` a secas.

**Estado: abierto** (mejorado respecto a la ronda 10; el hallazgo original
"no hay ningún corte" está arreglado con commit, pero el riesgo que describía
—matado a media sesión en `emitir` con doble CFDI— sigue alcanzable).

### [MEDIO] El pool del webhook acota la concurrencia pero no el reloj de pared del lote: una ráfaga grande con el proveedor de visión lento se pierde al final, sin claim y sin reintento
`src/app/api/webhook/whatsapp/route.ts:40` (`MAX_EN_PARALELO = 5`), `:77`
(`maxDuration = 120`), `:169` (`await conPool(permitidos, MAX_EN_PARALELO, …)`),
`src/lib/cuadra/processor.ts:338` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)`
— UN presupuesto por mensaje, no por lote), `:761` (`extraerComprobante(dataUrl,
reloj.senal(25_000))`), `src/lib/meta/client.ts:10` (`DOWNLOAD_TIMEOUT_MS =
15_000`).

**Lo que el pool resuelve y lo que no.** El pool sí limita a 5 fotos en vuelo
(medido en la ronda 10: el bloqueo síncrono del lector de códigos baja de 1.7 s
a <0.5 s) — eso está bien. Lo que el comentario de `route.ts:52-59` afirma
también es que "el reloj de cada foto vuelve a significar algo… con el
presupuesto ya gastado descontado": eso es falso para el LOTE, porque cada
`processInbound` arranca su propio `crearPresupuesto(120_000)` (`processor.ts:
338`) — la foto número 20 que arranca a t=100 s cree tener 120 s cuando a la
invocación le quedan 20.

**Escenario con valores.** El propio comentario documenta la ráfaga de 22 fotos
en un POST (`route.ts:52-59`, `route_pool.test.ts:99`). Con el proveedor de
visión degradado (cada foto cerca de su tope de 25 s) y la descarga lenta
(15 s), una foto cuesta ~45 s y una ronda del pool (5 en paralelo) ~45 s.
22 fotos ÷ 5 = 5 rondas → **~225 s de reloj de pared contra 120 s de
`maxDuration`**. La invocación muere a los 120 s a mitad de la ronda 3; las
~8-10 fotos de las rondas 4-5 **ni siquiera arrancan**: no tienen claim en
`wa_mensaje_procesado` (el claim se toma al entrar a `processInbound`,
`processor.ts:314`), Meta ya recibió su 200 (`route.ts` contesta antes del
`after()`), así que **no se reintentan jamás**. El único rastro es el
`wa.rafaga` de `route.ts:167` que dice cuántas entraron, no cuántas
terminaron. Con el proveedor sano (visión 4-8 s) las 5 rondas caben en ~50 s —
el riesgo está condicionado a un proveedor lento, que es exactamente el día
sistémico que este mismo archivo documenta en `fallo_tecnico`.

No es una regresión: es mejor que el `Promise.all` de antes. Pero el criterio
del repo —"el peor caso tiene que caber en su límite"— sigue sin cumplirse
para el lote grande. La dirección de arreglo es un reloj COMPARTIDO de la
invocación (crearlo en `route.ts` antes del `after()` y pasarlo a cada
`processInbound`, o cortar el `conPool` cuando el reloj no alcanza para otra
foto completa), no 5 presupuestos independientes.

**Estado: abierto.**

### [MEDIO] La pantalla "por facturar" y el JOIN del CFDI consolidado filtran por `(tenant_id, cfdi_uuid is null, fecha)` y ningún índice sirve ese orden; el parcial de la 0063 ordena por `(autofactura_intentada_en, created_at)`
`src/lib/cuadra/facturacion/pendientes.ts:123-125` (`.is('cfdi_uuid', null)
.order('fecha', { ascending: true, nullsFirst: false }).limit(500)`),
`supabase/migrations/0063_lo_que_falta_para_operar.sql:56-58` (`gasto_
por_facturar_idx on public.gasto (autofactura_intentada_en nulls first,
created_at) where cfdi_uuid is null`), `src/lib/cuadra/intake/consolidado.ts:
218-228` (`.is('cfdi_uuid', null).gte('fecha', rango.desde).lte('fecha',
rango.hasta)`).

**El índice de la 0063 se escribió para el cron y solo para el cron.** La
consulta de la cola del cron ordena por `(autofactura_intentada_en nulls
first, created_at)` — ese índice la sirve. Pero `getPorFacturar` —la pantalla
de facturación del panel, y también `avisarPorFacturar` que el propio cron
llama en su cola (`avisar.ts:52`)— ordena por `fecha`, y el JOIN del
consolidado filtra por rango de `fecha`. Ningún índice entrega filas
`cfdi_uuid is null` ordenadas por `fecha`: el planeador filtra por tenant
(`gasto_paginacion_idx`, 0061) o recorre el parcial de la 0063 y ordena.

**Escenario con valores.** La propia 0060 proyecta ~240 mil gastos al año y
la 0063/`pendientes.ts` documenta que el 95% no tiene CFDI → **~228 mil filas
sin CFDI al año de operación**. Cada vez que el contador abre "por facturar",
Postgres materializa y ordena ese conjunto para quedarse con 500; y el JOIN
del consolidado (un CFDI de monedero/TAG mensual puede abarcar miles de
gastos en su rango de fechas) filtra sin índice. Hoy, con 38 filas, es
instantáneo — es deuda de escala, no de hoy; exactamente la clase de deuda
que la 0060/0061 se escribieron para pagar antes de tiempo. La dirección de
arreglo es un parcial `(tenant_id, fecha) where cfdi_uuid is null` (o
extender el de la 0063), medido con el mismo `EXPLAIN` antes/después de la
0061.

**Estado: abierto.**

### [BAJO] `esperarIntake` sigue diciendo que el presupuesto de la función es `maxDuration=60`; la ruta ya está en 120
`src/lib/cuadra/conv.ts:575-577` ("Default 20s, NO 60s. El presupuesto de la
función es maxDuration=60 y por debajo de esta barrera todavía corren el lock
(12s) y el agente (40s): con 60s aquí el peor caso son 112s…").

La aritmética del comentario es de la época de los 60 s; hoy el webhook está
en `maxDuration = 120` (`route.ts:77`) y el reloj que acota la barrera es
`reloj.acotar(20_000)` (`processor.ts:1676`) sobre el presupuesto real de
120 s. El código funciona (el tope lo pone el reloj compartido), pero el
comentario miente sobre el presupuesto contra el que se mide — la misma
familia de "el rótulo tiene que ser verdad" que este repo persigue. La
cabecera de `presupuesto.ts:11-13` arrastra el mismo "60s" histórico.

**Estado: abierto** (cosmético, una línea).

### [BAJO] `guardarYConciliarConsolidado` escribe una UPDATE por línea conciliada, en serie
`src/lib/cuadra/intake/consolidado.ts:259-268` (`for (const r of resultados)…
await ligarLineaAGasto(…)`).

Un CFDI consolidado de monedero/TAG puede traer decenas de líneas y conciliar
varias de un golpe; cada `ligarLineaAGasto` es un viaje de red acotado por
`acotada` (8 s). 40 líneas conciliadas = ~40 UPDATEs secuenciales ≈ 12-20 s
en el peor caso, dentro del turno del webhook que procesa el mensaje de la
oficina. Está acotado, es best-effort y falla cerrado — no es un N+1 de
lectura —, pero es el único bucle del repo que escribe por fila en serie; si
alguna vez llega un consolidado de 200 líneas, se come el presupuesto del
turno. La dirección barata es un solo `UPDATE … in (ids)` por lote de
conciliadas.

**Estado: abierto.**

### [BAJO] Barrera de intake: sondeo cada 500 ms (hasta ~40 SELECTs por "listo") más 2 s de gracia fijos en el camino común
`src/lib/cuadra/conv.ts:590` (`const grace = … || 2_000`), `:604-610` (bucle
`vacio() … sleep(500)`).

Verificado que el sondeo ya NO escribe (`intakePendientes` es un SELECT por
PK, `conv.ts:531-553` — la mejora de la ronda 9 se sostiene), que es
fail-closed (`null` no abre la barrera) y que el TTL de 10 min existe. Lo que
queda: cada mensaje de texto "listo" paga la gracia de 2 s aunque no haya
ninguna foto en vuelo (el caso común), y hasta ~40 consultas si la barrera se
sostiene los 20 s. Es el costo documentado de la anti-carrera fotos+"listo"
en el mismo lote; no es un bug, es un impuesto medible (~2 s de latencia por
"listo"). Anotado para que nadie lo confunda con un cuelgue.

**Estado: abierto** (diseño declarado).

## Lo que revisé y está bien

- **`acotada()` y `TOPE_CONSULTA_MS`** (`presupuesto.ts:152-170`): techo en
  dos capas (señal de aborto + carrera contra temporizador), entra por el
  mismo camino que un error de Postgres, y `presupuesto.test.ts:79-91` falla
  si `PRESUPUESTO_WEBHOOK_MS` (120 s) se desincroniza del `maxDuration` de la
  ruta. Corrí las pruebas: 38 verdes (`presupuesto`, `route_pool`, `barrera`,
  `barrera_sondeo`).
- **La tabla de pasos del cierre** (`presupuesto.ts:31-49`): 13 pasos, 8.9 s
  contra `MARGEN_CIERRE_MS` de 12 s, y la prueba exige holgura de un paso
  lento. La cuenta que en la ronda 9 era prosa ahora es verificable.
- **El cron de facturación — lo nuevo de esta ronda**: `MARGEN_LOTE_MS` +
  check por flota + `sinTiempo` sin marcar + respuesta que lo dice (`route.ts:
  143-151, 406-416, 512-514`). La prueba del presupuesto del lote existe y la
  corrí: 20 verdes. El claim atómico (`reclamarIntentos`, `al_vuelo.ts:613-
  645`), los bloqueados que no reintentan (`motivoDeBloqueo`), el modo
  `ensayo` por default y `modoEfectivo`/mandato siguen intactos y probados.
- **Índices 0060/0061/0063/0071 — leídos con su evidencia**: todos traen
  `EXPLAIN` antes/después con volumen sembrado (10 tenants, hasta 400 mil
  filas) y la 0061 documenta explícitamente la trampa del tenant único y el
  costo de escritura medido (1.1 µs/insert). La 0063 reemplaza el parcial de
  la 0060 con el orden de la cola del cron. Nada de esto regresó.
- **Migración 0078 (RLS) — revisada como parte de este rubro por su costo de
  consulta**: el fix es correcto (a las 7 tablas se les pone `not
  is_operador()`, y `tenant` pasa a solo-lectura). Costo de rendimiento
  despreciable: `get_user_tenant_ids()`/`is_operador()` son SQL `stable` por
  PK de `app_user` (se evalúan una vez por statement, no por fila).
- **N+1, línea por línea**: `analytics.ts`, `comercial.ts`, `operacion.ts`,
  `admin/negocio.ts`, `repo.ts` — cero N+1. Todo sigue el patrón
  `Promise.all` + `traerTodo` (paginado, con `LecturaIncompleta` si no puede
  probar que trajo todo, `pg.ts:137-175`) y la agregación en memoria con
  `Map`. Los agregados pesados (`llm_costo`, `gasto`) ya viven en SQL
  (0062/0064) y cruzan la red una fila. `getLineasPorConciliar` hace 2
  consultas extra acotadas con `.in()` — no es N+1.
- **Páginas del dashboard**: `page.tsx:86`, `valor-ahorro:43`, `analitica:45`,
  `viajes:49` usan `Promise.all`; los conteos van con `head: true` y los
  límites de 100 están servidos por los índices recientes de la 0061
  (`gasto_reciente_idx`, `viaje_reciente_idx`).
- **El pool de 5**: el pico de concurrencia está probado (`route_pool.test.ts:
  99-101` — nunca más de 5 en vuelo) y el bloqueo de event loop del lector
  síncrono quedó medido en la ronda 10.
- **`downloadMediaAsDataUrl`/`sendText`/`sendDocument`** llevan
  `AbortSignal.timeout` (15 s / 10 s, `meta/client.ts:10-17`) — ya no hay
  fetch pelado en el camino del webhook.
- **`subirComprobante`** está acotado por `acotada` (`almacen.ts:53-61`) con
  la advertencia documentada de que storage-js no acepta señal (cubre solo la
  red de seguridad).

## Lo que no alcancé a revisar

- **La sesión real de CAPUFE en Vercel**: los ~147 s del ALTO son la suma de
  los topes declarados, no una medición con el navegador dentro del contenedor
  de la función (en la Mac, con la caché caliente, los pasos medidos son de
  ~1.2 s por sesión). Si alguien mide el peor caso real con `@sparticuz/chromium`
  en frío, el número del hallazgo se afina — la estructura del riesgo no
  cambia (el margen de 60 s es menor que la suma de topes de una sesión).
- **El render del PDF** (`export/pdf/[id]`) y su presupuesto: no profundicé en
  la generación del PDF del contralor (es otra superficie con Chromium).
- **Verificar contra la base real que 0060-0078 estén aplicadas**: regla del
  rubro — no toco la base; lo cubre el auditor de datos. Los índices se
  leyeron en las migraciones, no en `pg_indexes`.
- **El comportamiento exacto de Vercel al matar una invocación con Playwright
  abierto** (procesos huérfanos de Chromium, `finally` truncado): es
  operabilidad, no presupuesto de tiempo; lo dejo para ese rubro como la ronda
  10.
- **La ruta del XML del CFDI consolidado contra el reloj compartido** (las
  ~40 UPDATEs del BAJO): no la cronometré en producción con un XML real grande;
  es una proyección sobre los topes.

## VEREDICTO

**Ámbar para el rubro de rendimiento — no hay green light hasta cerrar el
ALTO del cron, y el MEDIO del pool merece decisión explícita.**

Motivos:

1. **El ALTO de la ronda 10 se atacó de verdad** (el corte por reloj existe,
   está probado, y los tickets cortados quedan sin marcar para la corrida
   siguiente) — eso es progreso real y verificado en el código y en las
   pruebas. Pero **no se cerró**: el margen de 60 s es menor que los ~147 s de
   peor caso de sesión que el propio archivo cita, el check es por flota y no
   por sesión de portal, y un lote de 8 tickets en UNA sesión suma ~316 s en
   el peor de los topes. El riesgo fiscal (CFDI timbrado sin UUID, doble
   emisión en el reintento) sigue alcanzable el día que `FACTURACION_MODO=
   emitir` se ponga a mano. Ese es el bloqueador.
2. **Los dos MEDIO son deuda de escala y de peor caso, no de hoy**: el pool
   del webhook pierde el final de una ráfaga grande solo cuando el proveedor
   de visión va lento para TODAS las fotos (el día sistémico, que es
   justamente el que `fallo_tecnico` documenta); el índice de `fecha` de
   "por facturar" muerde al volumen que la propia 0060 proyecta. Ambos tienen
   dirección de arreglo clara y barata, ninguno bloquea el demo del 6-ago.
3. **Lo verificado y sano pesa más que lo abierto**: cero N+1 en los seis
   módulos de datos, presupuestos con prueba de sincronía, agregados en SQL,
   índices medidos con EXPLAIN y con su costo de escritura declarado, RLS 0078
   sin costo de consulta, y 58 pruebas del rubro corriendo verdes.

7/10 — mismo nivel que la ronda 10: se atacó el hallazgo principal y se
midió la mejora, pero la deuda que quedó es de la misma familia (peor caso
que no cabe en su límite) y sigue viva en la superficie de mayor riesgo del
producto.
