# Rendimiento y costo — auditoría 9

Anclado a `f34066f6714a142fa22075cd09e5430314341354` (HEAD al empezar).

**Nota: 7/10** (antes 6). Razón del movimiento: dos de los tres reincidentes de
la ronda 8 cerraron limpio y verificable con número en mano (`analytics.ts` ya
pagina de verdad, `repo.ts`/`conv.ts`/`costos.ts`/`config.ts` quedaron sin un
solo `supabaseAdmin()` crudo). El tercero — el protocolo de dos fotos — sí deja
de pagar visión doble, pero al resolverlo abre un gasto de presupuesto nuevo,
real y sin medir, contra la barrera de intake de 20s. Es progreso neto, no
mirada más profunda sobre lo mismo: la deuda vieja cobró factura y una parte
chica de deuda nueva quedó sin pagar.

El riesgo mayor hoy: `esperarReclamoDeFoto` se paga en CADA foto sin código
legible —es decir, en casi cualquier ticket que no sea un acercamiento a
gasolinera—, y ese costo sale directo del presupuesto de 20s que la ronda 8
reservó para que el OCR en vuelo termine antes de que "listo" cuadre. Nadie
mide si el ahorro que motivó el mecanismo (evitar una segunda visión) ocurre
lo bastante seguido para pagar ese gasto.

## Hallazgos

### [ALTO] `esperarReclamoDeFoto` se cobra en toda foto sin código, aunque nunca vaya a tener pareja, y ese costo sale del presupuesto de la barrera de intake
`src/lib/cuadra/processor.ts:81-93` (función), `:527-571` (donde se invoca),
`src/lib/cuadra/conv.ts:373-414` (`esperarIntake`, tope 20s)

Escenario: un operador manda la foto de una caseta (peaje). Las casetas no
traen QR de autofacturación ni código de barras — ese código solo existe en
tickets de gasolinera/portal, que es el único caso de campo que sustenta el
mecanismo (`intake/ocr.ts:230-238`, medición del 27-jul-2026 SOLO sobre
tickets de diésel). `tieneCodigoLegible` devuelve `false` sobre esa foto de
caseta —siempre lo va a devolver, para ese tipo de documento— así que entra a
`guardarFotoPendiente` + `esperarReclamoDeFoto` y espera a un acercamiento que
estructuralmente NUNCA va a llegar. La espera nominal es
`HOLD_FOTO_MS=3000ms` en ciclos de `POLL_FOTO_MS=400ms`, pero el ciclo real
—sleep 400ms + `existeFotoPendiente` (una consulta acotada por
`TOPE_CONSULTA_MS`)— con el mismo costo unitario de 0.3s/consulta que
`presupuesto.ts` ya usa para `PASOS_CIERRE`, corre 5 vueltas completas antes de
que `Date.now() >= vence` (5 × 700ms = 3500ms) más la consulta final de
`reclamarFotoPendiente` (≈300ms) = **≈3.8s**, no los 3.0s que sugiere el
nombre de la constante. Ese tiempo transcurre con el contador de intake de esa
foto todavía en +1 (el `finally` que hace -1 vive después de todo esto).

Si el operador —terminando una ruta corta, ya son las 9pm— escribe "listo"
poco después, `esperarIntake(viajeId, reloj.acotar(20_000))` tiene que esperar
esos ≈3.8s de espera pura ANTES de que siquiera arranque la llamada de visión
de esa foto (`extraerComprobante(imagenes, reloj.senal(25_000))`, tope propio
de hasta 25s). El presupuesto efectivo para que el OCR de esa foto de caseta
termine cae de 20s a ≈16.2s — un recorte de ~19% del margen que la ronda 8
dimensionó específicamente para que "listo" nunca cuadre sobre datos
parciales — para un tipo de documento que NUNCA iba a beneficiarse del
mecanismo que le cobra el tiempo.

Consecuencia: en un viaje real (varias casetas, alimentación, hospedaje, y
solo 1-3 cargas de diésel), la mayoría de las fotos pagan el impuesto de
espera y ninguna tiene a quién esperar. Si una de esas fotos además necesita
un reintento de visión (`openrouter.ts:351-354`: un truncamiento reintenta con
el doble de tokens, un viaje de red completo extra), el margen que queda tras
los 3.8s de espera puede no alcanzar, y `esperarIntake` vence: el operador
recibe "⚠️ Ojo: cuadré con los N comprobantes que alcancé a procesar"
(`processor.ts:1332`) por un comprobante que SÍ mandó a tiempo, solo que una
espera que nunca le tocaba lo empujó fuera de la ventana.

Causa raíz probable: `esperarReclamoDeFoto` se dispara con una sola señal
—¿esta foto trae un código decodificable?— sin distinguir "candidata real a
acercamiento" de "este tipo de documento nunca trae código". Y a diferencia de
`PASOS_CIERRE` (la tabla que este mismo período construyó para que el costo de
cada eslabón del cierre fuera verificable y no prosa), este paso nuevo no se
sumó a ninguna contabilidad de presupuesto: `presupuesto.test.ts` no lo
menciona, y no hay ningún test que corra con los defaults reales de
`HOLD_FOTO_MS`/`POLL_FOTO_MS` contra el tope de 20s de la barrera (los tests
de `processor_foto_pendiente.test.ts` fijan `CUADRA_FOTO_PENDIENTE_HOLD_MS=60`
para no tardar, y por diseño nunca ejercitan esta interacción).

### [MEDIO] Una sola consulta lenta puede inflar la espera "de 3 segundos" a ~19s, por sí sola más que el tope entero de la barrera de intake
`src/lib/cuadra/processor.ts:81-93` (`esperarReclamoDeFoto`), `src/lib/cuadra/repo.ts:470-479` (`existeFotoPendiente`), `src/lib/cuadra/presupuesto.ts:101,104,148-169` (`TOPE_CONSULTA_MS=8000`, `GRACIA_TOPE_MS=1500`, `acotada`)

Escenario: el ciclo de `esperarReclamoDeFoto` llama `existeFotoPendiente`, que
pasa por `acotada` — el mismo mecanismo que `presupuesto.ts` documenta que
"seguía bloqueado a los 20s sin el menor síntoma" contra un servidor que
acepta y calla. `acotada` corta esa consulta a los `TOPE_CONSULTA_MS(8000) +
GRACIA_TOPE_MS(1500) = 9500ms`, no a los `POLL_FOTO_MS=400ms` que el bucle
asume como cadencia. Si UNA sola consulta de Supabase responde lenta —no
caída, solo degradada, que es justo el escenario que `TOPE_CONSULTA_MS`
documenta como real en esta pila— esa única vuelta del `while` puede tardar
hasta ≈9.9s (400ms sleep + 9500ms de la consulta agotando su tope), y como el
`while` ya excedió `vence` (3000ms) al salir, cae directo a la llamada final
`reclamarFotoPendiente` (`repo.ts:490-500`), TAMBIÉN envuelta en `acotada` y
capaz de otros ≈9.5s en el mismo escenario. Total: **hasta ≈19.4s**, solo en
`esperarReclamoDeFoto`, antes de que la visión (hasta 25s más) siquiera
arranque — más que el tope entero de 20s de `esperarIntake` por sí solo.

Consecuencia: en un episodio de Supabase degradado (no caído), UNA foto puede
consumir ella sola el presupuesto completo de la barrera de intake,
garantizando el aviso de "cuadré con lo que alcancé" para cualquier
liquidación que se cierre en esa ventana, sin relación con cuántas fotos se
mandaron ese viaje.

Causa raíz probable: el ciclo de sondeo reutiliza el tope genérico de
`acotada` (diseñado como red de seguridad para UNA consulta cualquiera, con
margen generoso a propósito) dentro de un bucle que asume ciclos mucho más
rápidos, sin imponerle un tope propio y más estrecho a cada sondeo individual.

### [BAJO] `decodeCodigosFromImage` corre dos veces sobre la misma foto
`src/lib/cuadra/processor.ts:527` (`tieneCodigoLegible`), `src/lib/cuadra/intake/ocr.ts:259` (dentro de `extraerComprobante`)

Toda foto que entra a `guardarFotoPendiente` —es decir, casi cualquier foto
sin código— hace decodificar sus códigos (zxing-wasm) una vez en
`tieneCodigoLegible` para decidir la rama, y otra vez dentro de
`extraerComprobante` cuando por fin se le paga la visión
(`codigosPorFoto = await Promise.all(fotos.map((f) => decodeCodigosFromImage(...)))`).
No tiene costo en dólares (es CPU local, no un modelo), pero es trabajo WASM
duplicado en cada foto del flujo nuevo — el mismo decode que el propio
comentario de `ocr.ts` describe como corriendo en el orden de ~100ms se paga
dos veces por foto en vez de una. No se reporta como ALTO porque no compite
por presupuesto de red ni por dinero, solo por CPU de la invocación.

## El "ahorro real" que pide esta ronda: sin medir

`processor.ts:837` estima la visión en **$0.015 por llamada** (consistente en
orden de magnitud con `PRICES['google/gemini-3.6-flash'] = [1.5, 7.5]` USD/1M
tokens de `openrouter.ts:85`). Ese es el ahorro por cada acercamiento que de
verdad encuentra su ticket completo esperando.

Pero no existe ningún contador, log o columna que registre cuántas veces por
liquidación el mecanismo de verdad evita esa segunda visión (grep sobre
`costos.ts`/`processor.ts` por "ahorr\*"/"fusionad\*"/"merge" no encuentra
telemetría — solo comentarios). La justificación de campo citada en el código
(`intake/ocr.ts:230-238`) es una muestra de tickets de diésel del 27-jul-2026,
no una medición sobre la mezcla real de conceptos de un viaje (casetas,
alimentación, hospedaje, transporte, que típicamente superan en cantidad a las
cargas de diésel). Sin ese conteo no se puede saber si el mecanismo paga su
propio costo de espera (hallazgos de arriba) o si —para la mayoría de las
fotos de un viaje típico— reparte un gasto de latencia garantizado a cambio de
un ahorro que casi nunca ocurre.

## Lo que revisé y está bien

- **`analytics.ts` (recorte a 1,000 filas, ronda 8) — cerrado de verdad.**
  `traerTodo` (líneas 42-54) pagina con `.range()` hasta `MAX_PAGINAS=100`
  (100,000 filas) en `getKpis`, `getStatsPorOperador`, `detectarAnomalias` y
  `getAcreditables`. Ya no hay un corte silencioso a 1,000. (Nota menor, no
  reportada como hallazgo por su magnitud: si un tenant algún día supera
  100,000 filas en una sola consulta, el bucle simplemente termina sin log —
  el comentario dice "se corta y se dice" pero no hay ninguna llamada a
  `logger` en ese caso. A 96 empresas censadas y cero clientes, esto está a
  varios órdenes de magnitud de importar para el demo.)
- **Tope de consulta (ronda 8) — cerrado de verdad.** Conteo cruzado de
  `supabaseAdmin()` contra `acotada(` en `repo.ts` (28 vs 27),
  `conv.ts` (10 vs 10), `costos.ts` (4 vs 4) y `config.ts` (1 vs 1): la única
  diferencia en `repo.ts` son dos patrones de "construir ahora, envolver
  después" (`reclamarFotoPendiente`, `getAcumuladoCombustible`) que sí quedan
  acotados en la línea donde se ejecutan. Las funciones nuevas de este período
  (`guardarFotoPendiente`, `existeFotoPendiente`, `reclamarFotoPendiente`,
  `corregirFechaGasto`) también están acotadas.
- **`PASOS_CIERRE` / `MARGEN_CIERRE_MS` / `PRESUPUESTO_WEBHOOK_MS`.** La tabla
  suma 8,900ms contra un margen de 12,000ms (3.1s de holgura), y hay un test
  (`presupuesto.test.ts`) que falla si se desincroniza con `route.ts`. Revisé
  el cálculo a mano y cuadra.
- **`maxDuration=120` en `route.ts` contra `PRESUPUESTO_WEBHOOK_MS=120_000`
  en `presupuesto.ts`.** Coinciden, y el comentario documenta que se verificó
  el plan Pro de Vercel (300s de tope real) contra la API, no por suposición.
- **Modelo por rol (`models.ts`).** OCR en Gemini Flash (barato), cuadre en
  Sonnet (caro solo donde el error cuesta dinero), chat/router en Flash-Lite.
  Sin cambios respecto a lo ya evaluado; sigue siendo la asignación correcta.
- **`generateWithTools` — costo por ronda al precio del modelo que respondió
  esa ronda** (`openrouter.ts:480-484,536`), con su propio test
  (`openrouter_fallback_costo.test.ts`) que verifica que un ciclo con fallback
  a media ejecución no cobra las rondas previas al precio del fallback.
- **`decodeCodigosFromImage` (barcode/QR) es genuinamente gratis en dólares**:
  corre zxing-wasm local, no un modelo — confirmado leyendo `intake/cfdi.ts`.
  El único costo que impone es CPU duplicada (ver hallazgo BAJO arriba), no
  gasto de LLM.
- **Descarga de media de WhatsApp acotada.** `downloadMediaAsDataUrl` en
  `meta/client.ts` lleva `AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)` en sus dos
  `fetch` — no es un cuelgue sin techo.

## Lo que NO alcancé a revisar

- **Tamaño de imagen enviado a visión sin redimensionar.** No confirmé si el
  dataURL que llega de WhatsApp (`downloadMediaAsDataUrl`) puede venir en una
  resolución alta que infle tokens de entrada en `generateStructured`; no
  encontré ningún paso de resize/compresión antes de mandarlo a
  `images: [principal]`, pero tampoco medí el tamaño típico real de una foto
  de WhatsApp Cloud API para saber si esto importa en la práctica. Lo dejo sin
  reportar por falta de evidencia numérica, no porque esté descartado.
- **`corregirFechaGasto` / `emparejarCorreccionDeFecha` (camino nuevo de
  re-fecha).** Revisé que no haya una consulta dentro de un bucle, pero no
  medí su costo de extremo a extremo contra el presupuesto — es más un tema
  de correctitud (agéntico/datos) que de rendimiento puro, y así lo trata
  `MAPA.md`.
- **`round2()` duplicado en 4 archivos de dinero** (hallazgo abierto de la
  ronda 8, marcado explícitamente como "no atacado esta ronda"). No lo
  reverifiqué: es un hallazgo de arquitectura/correctitud numérica, no de
  presupuesto de tiempo o costo por operación, y el propio `MAPA.md` no lo
  asigna a este rubro.
- **Costo real medido en producción de una liquidación completa.** El
  "$0.03–0.05/liquidación" de `models.ts` y el "$0.015/visión" de
  `processor.ts` son estimaciones escritas en el código, no un dato de
  facturación real de OpenRouter contrastado — no tuve acceso a esa cuenta
  para confirmarlo.
- **Presupuesto de la ruta de XML del CFDI** (`processor.ts:858-972`, "hasta
  30s" según su propio comentario) contra el reloj compartido — lo leí de
  paso pero no le hice la suma a mano como sí hice con la foto.
