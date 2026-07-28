# Rendimiento y costo — nota 6/10

## Intentos de tumbar el arreglo del presupuesto

El reloj compartido (`src/lib/cuadra/presupuesto.ts`, `crearPresupuesto`) hace
exactamente lo que dice: `restante()`/`acotar()`/`alcanza()` miden tiempo real
transcurrido (`Date.now()`), no presupuestos por etapa fijos, así que la barrera
de intake, el mutex y el agente se reparten los mismos 60s en vez de sumar sus
topes. Los tests en `presupuesto.test.ts` y `presupuesto_camino.test.ts`
verifican la aritmética, incluyendo el caso "todas las etapas al máximo" (línea
38-43 de `presupuesto_camino.test.ts`) y que el agente reciba MENOS tiempo, no
su tope completo, cuando llega tarde (línea 79-85). Confirmé que
`src/app/api/webhook/whatsapp/route.ts:24` (`maxDuration = 60`) coincide con
`PRESUPUESTO_WEBHOOK_MS` vía el test que lee el archivo de la ruta
(`presupuesto.test.ts:73-84`) — no es solo una promesa en un comentario.

Para el camino del **texto "listo"** (que es el que causaba el 72s del boletín
anterior: 20s barrera + 12s mutex + 40s agente contra 60s totales), el arreglo
aguanta. Verifiqué con la aritmética de los tests y con lectura de
`processor.ts:147,413,417,463` que el reloj se crea en la primera línea de
`processInbound` y que barrera, mutex y `runAgent` piden su tope vía
`reloj.acotar(...)`, nunca su constante fija. **Esto quedó arreglado.**

Intenté tumbarlo por tres caminos distintos, y dos SÍ lo consiguen — no para el
"listo", sino en piezas vecinas que comparten la misma invocación de 60s:

1. **Las ramas de imagen y documento nunca consultan el reloj.** Leí
   `processor.ts:205-336` (rama `image`) y `:342-402` (rama `document`) de
   punta a punta: ninguna de las dos referencia `reloj` en ningún punto — ni
   para descargar el media, ni para el OCR, ni para insertar el gasto. El
   objeto `reloj` existe (se crea en la línea 147 para TODO mensaje, sin
   importar el tipo) pero para fotos y XML es letra muerta.
2. **`extraerComprobante` (el OCR de fotos) no tiene timeout ni `AbortSignal`.**
   `generateStructured` en `src/lib/llm/openrouter.ts` (función `attempt`,
   líneas 223-275) llama `getClient().chat.completions.create(...)` sin pasar
   `signal` ni `timeout`. Confirmé en `node_modules/openai/client.js:163` que
   el SDK de OpenAI cae al default `DEFAULT_TIMEOUT` de **10 minutos** cuando
   no se especifica uno. Compara con `runAgent` (`src/lib/agents/run.ts:32-33`),
   que SÍ arma un `AbortController` con `setTimeout(..., opts.timeoutMs)` y lo
   liga al reloj vía `reloj.acotar(40_000)` en `processor.ts:463`. El texto
   ("listo") está protegido; la foto no.
3. **`sendText`/`sendDocument` tampoco tienen timeout**, a diferencia de
   `downloadMediaAsDataUrl`/`downloadMediaAsText`. En `src/lib/meta/client.ts`
   las descargas usan `AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)` (líneas 71,
   77, 92, 98) pero `sendText` (42-49) y `sendDocument` (52-64) son un
   `fetch()` liso. El `say(reply)` final del camino "listo" (`processor.ts:521`)
   — el que el `MARGEN_CIERRE_MS` de 8s asume que será rápido — puede colgarse
   sin límite si el Graph API de Meta tarda.

**Por qué esto sí importa para "reventar juntos":** el webhook mete N mensajes
del mismo POST en un solo `after()` con `Promise.all` (`route.ts:66-74`), y esa
llamada no retorna hasta que TODOS los mensajes de la ráfaga terminan. Si en el
mismo lote vienen 3 fotos y un "listo" (el propio comentario de
`route.ts:61-65` dice que Meta puede entregar varias fotos en un POST), y una
de esas fotos se cuelga en un `chat.completions.create` sin bound (provider
lento, no caído del todo — no dispara el fallback de `isTransientError`, solo
tarda), la invocación entera sigue viva hasta que Vercel la mate a los 60s duros
— y en ese momento el "listo", que SÍ calculó bien su presupuesto y a lo mejor
ya iba a responder en el segundo 35, puede perderse igual si su `await
say(reply)` (sin timeout, punto 3) coincide con el corte. El reloj no falla en
su propia aritmética; falla en que no cubre a todos los vecinos de la misma
invocación.

Conclusión: el bug específico del boletín anterior (72s aditivos en el camino
"listo") está **arreglado y probado**. La superficie de "silencio total sin
reintento de Meta" sigue abierta por rutas distintas: fotos/documentos sin
bound propio, y el envío final sin timeout.

## Hallazgos

### [ALTO] Fotos y documentos no tienen presupuesto propio — pueden colgar la invocación entera
`src/lib/cuadra/processor.ts:205-336` (rama `image`) y `:342-402` (rama
`document`) nunca llaman `reloj.acotar()`/`reloj.alcanza()`. El OCR
(`extraerComprobante` → `generateStructured`, sin `signal`) puede tardar hasta
el default de 10 min del SDK de OpenAI (verificado en
`node_modules/openai/client.js:163`) antes de que CUALQUIER cosa lo corte. Si
esa foto comparte lote con un "listo" (mismo `after()`, `route.ts:66-74`), un
solo proveedor lento revienta el presupuesto de TODOS los mensajes del lote,
no solo el suyo — exactamente el escenario que el reloj se propuso evitar, por
una puerta que el reloj no vigila.

### [ALTO] El costo del agente se pierde cuando el ciclo de tools falla — justo en el camino de recuperación
`src/lib/llm/openrouter.ts:339-344` — `PartialExecutionError` solo carga
`message`, `cause` y `partialToolCalls`; NO carga `tokIn`/`tokOut`/`costo`
acumulados. `generateWithTools` (líneas 410-467) sí acumula `costo` ronda a
ronda en una variable local, pero el `catch` final (464-467) construye el
`PartialExecutionError` sin pasarlo. En `src/lib/cuadra/processor.ts:475-509`,
el bloque que recupera un cierre parcial (`cierreParcial`, cuando
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1`) llama `vincularCostosALiquidacion`
(que solo RE-ETIQUETA filas YA existentes en `llm_costo`) pero nunca llama
`registrarCosto` para el consumo del propio run que falló — y el `else` (log
`agent.fail`, línea 506) tampoco. Escenario concreto: el agente corre 5 rondas
de tools (varias llamadas reales a Sonnet 5, dinero gastado), la 6ª dispara
`LoopGuardError` (tope `maxRounds=6`, `openrouter.ts:365`) o el
`AbortController` del timeout del reloj aborta a media ronda; si la ronda 5 ya
había llamado `guardar_liquidacion`, el operador RECIBE su PDF y la liquidación
queda cerrada — pero el costo de las 5 rondas que la produjeron nunca llega a
`llm_costo`. Es justo el caso de mayor presión de presupuesto (cerca del corte
de 60s) el que más probablemente dispara este camino, y es justo ese caso el
que el contador de "costo por liquidación" reporta más barato de lo que costó.

### [MEDIO] `cuadrarDesdeDB` se recalcula hasta 3 veces por cada cierre, con los mismos datos
`src/lib/cuadra/tools.ts:36,46` (`cuadrar_viaje` llama `computeCuadre` =
`cuadrarDesdeDB`), `tools.ts:69` (`guardar_liquidacion` vuelve a llamar
`computeCuadre` de forma independiente), y
`src/lib/cuadra/cuadre/guardia.ts:52-55` (`guardiaCifras` llama
`cuadrarDesdeDB` una TERCERA vez cuando `cuadro=true` y la respuesta trae
cifras — que es el caso normal de cualquier cierre exitoso, porque el resumen
del agente siempre menciona dinero). Cada llamada a `cuadrarDesdeDB`
(`desde_db.ts:11-15`) son 3 queries a Supabase en paralelo
(`getViaje`+`getGastos`+`getConfig`). El viaje está bajo mutex durante todo el
turno (`acquireViajeLock`, `processor.ts:417`), así que los datos NO cambian
entre las 3 invocaciones — la redundancia no compra nada, solo suma hasta 9
round-trips a Supabase y el tiempo de `cuadrarViaje` (motor + deducibilidad +
omitidos) 3 veces, en el camino más transitado del producto y contra el mismo
presupuesto de 60s que se está auditando.

### [MEDIO] El OCR manda la foto a resolución completa al proveedor de pago, cuando el propio código demuestra que 1600px alcanza
`src/lib/cuadra/intake/ocr.ts:170` — `extraerComprobante` pasa `principal`
(el data-URL crudo que llegó de WhatsApp, sin redimensionar) directo a
`generateStructured({ images: [principal], ... })`, que lo manda tal cual a
Gemini 3.6 Flash vía OpenRouter. Contraste: `src/lib/cuadra/intake/cfdi.ts:239`
redimensiona la MISMA foto a máx. 1600px de ancho antes de decodificar
QR/código de barras — una tarea que exige MÁS precisión pixel a pixel que leer
texto impreso — y el propio comentario (`cfdi.ts:234-237`) documenta que
"la pasada a resolución nativa cuesta segundos y no encuentra nada que no
encuentre la de 1600px". El OCR paga tokens de imagen (los modelos
multimodales cobran por tiles/resolución) sobre una foto de hasta 24MP —
mencionado en el propio comentario de `cfdi.ts:236`— cuando ya está probado en
el mismo archivo que 1600px es suficiente. Esto es dinero dejado sobre la mesa
en la llamada más cara del pipeline de intake, en cada una de las fotos que
llegan.

### [MEDIO] Dos formas silenciosas de que "costo por liquidación" mienta
`src/lib/llm/openrouter.ts:76-80` — `calcCost` devuelve `0` sin loguear nada
si el slug del modelo no está en `PRICES`. Como CADA rol tiene override por
env (`models.ts:47-53`, `CUADRA_MODEL_OCR`/`_CUADRE`/`_CHAT`/`_ROUTER`), apuntar
un rol a un modelo nuevo sin agregar su entrada a `PRICES` no truena: registra
silenciosamente $0 en `llm_costo` para esa llamada, y no hay test que falle
(no existe assert de "todo modelo en DEFAULTS/FALLBACK tiene precio"). Segundo:
`PRICES['anthropic/claude-sonnet-5']` (línea 69) trae el comentario "intro
VIGENTE hasta 31-ago-2026; revertir a [3,15] después" — un precio con fecha de
caducidad sin ningún mecanismo (test, alerta, TODO con fecha en `startup.ts`)
que impida que sobreviva después del 31-ago-2026 y subestime el costo real en
50% a partir de esa fecha. Cualquiera de las dos rutas corrompe en silencio el
número que el negocio va a usar para fijar precio por liquidación.

### [OPINIÓN] WhatsApp saliente se contabiliza aunque el envío haya fallado
`src/lib/cuadra/processor.ts:163-166` — el helper `say()` llama
`registrarCostoWhatsApp` incondicionalmente DESPUÉS de `sendText`, y
`sendText` (`src/lib/meta/client.ts:42-49`) nunca lanza cuando `!res.ok`: solo
loguea `wa.sendText` y retorna. Un mensaje que Meta rechazó (token vencido,
número inválido) igual se cobra en `llm_costo`. Es defecto describible pero de
impacto bajo (WHATSAPP_MSG_USD es una constante chica, $0.008) — lo marco como
opinión porque no verifiqué si sobrestimar aquí importa más que la complejidad
de condicionar el registro al `res.ok` real.

---

# Operabilidad y DX — nota 6/10

Mejoras reales desde el boletín anterior: hay lint (`eslint.config.mjs`) y un
CI completo y probado en seco (`.github/ci.yml.pendiente`), bloqueado solo por
un scope de OAuth que el propio archivo explica cómo resolver — no es
negligencia, es una limitación de entorno documentada, tal como dice el MAPA.
Sentry sigue sin cablear, y el hallazgo puntual del boletín anterior sobre el
log de fallo de cierre **lo verifiqué en el código actual y sigue ahí, línea
por línea**.

## Hallazgos

### [ALTO] `agent.fail` — el log del fallo más importante del sistema no dice qué liquidación falló, aunque los datos están en el mismo scope
`src/lib/cuadra/processor.ts:506` —
```
logger.error('agent.fail', { err: e instanceof Error ? e.message : String(e) });
```
Este es el `catch` de `runAgent()` cuando NO se pudo recuperar un cierre
parcial (rama `else` de la línea 505). `viajeId`, `op.tenantId` y
`op.operadorId` están en scope en ese punto exacto (se usan siete líneas
arriba, línea 500, en el mismo bloque) y NO se incluyen en el log. Es el
fallo que el boletín anterior citó textualmente ("el log del fallo de cierre
no dice qué liquidación falló") y sigue reproducible: a las 3am, este error en
Vercel logs trae el mensaje de la excepción y nada más — ni viaje, ni
operador, ni tenant. Encontrar la liquidación afectada requiere cruzar la hora
del log contra la tabla `viaje`/`wa_conversacion` a mano.

### [MEDIO] El catch general de `processInbound` tampoco deja rastro utilizable
`src/lib/cuadra/processor.ts:552` —
```
logger.error('processInbound.fail', { id: msg.waMessageId, err: ... });
```
Solo trae `waMessageId`. `msg.from` (el teléfono) está en scope y no se
incluye — aunque tampoco ayudaría mucho: `logger.ts:6,10` redacta CUALQUIER
teléfono a `[TEL]` antes de emitir el log, así que ni agregándolo se podría
correlacionar por número. Sin `operadorId`/`tenantId`/`viajeId` (que este
catch no tiene porque están declarados con `const` dentro del `try` que
falló, fuera de scope aquí), el único identificador utilizable es
`waMessageId`, que exige ir a buscarlo en la tabla `wa_mensaje_procesado` para
saber a quién pertenece.

### [MEDIO] Sentry: dependencia instalada, cero cableado — qué se pierde
`package.json` trae `@sentry/nextjs@^10.0.0`, pero `src/lib/observability/`
está vacío (0 archivos), no existen `sentry.{client,server,edge}.config.ts`,
`instrumentation.ts:3` dice textualmente "Aquí también se cablearía Sentry
(ME-9, post-demo)", y `.env.example:35` trae `SENTRY_DSN=` sin valor. Sin
Sentry: no hay agrupación de errores repetidos, no hay alertas push/email/
Slack, no hay stack trace con contexto de request — solo lo que
`console.error` deja en el log de función de Vercel, con la retención y el
`grep` manual que eso implica. Combinado con el hallazgo anterior (logs sin
identificadores), un fallo de `agent.fail` en producción hoy requiere: (1)
que alguien esté mirando activamente los logs de Vercel, y (2) que ese alguien
cruce la hora contra la base de datos a mano para saber qué liquidación se
perdió.

### [BAJO / conforme al MAPA] CI pendiente por scope de OAuth, no por negligencia
`.github/ci.yml.pendiente` (todo el archivo) — el workflow está completo,
corre `npm ci`, typecheck, lint, test y build, y el encabezado explica
exactamente por qué vive fuera de `.github/workflows/` (falta el scope
`workflow` en el token) y el comando exacto para activarlo
(`gh auth refresh -h github.com -s workflow`). No lo cuento como hallazgo de
severidad — es la situación que el MAPA ya describe — pero sigue siendo cierto
que HOY no hay gate automático corriendo en cada push; las "cuatro puertas" se
corren a mano.

---

# Arquitectura y mantenibilidad — nota 6/10

## Verificación del hallazgo anterior: "el panel lee Supabase con mapeo a mano fuera de repo.ts, sin prueba; ya se desincronizó una vez"

**Sigue así, y de hecho la superficie creció.** `repo.ts` cubre bien el acceso
de `processor.ts`/`tools.ts`, pero el panel (`src/app/dashboard/`) y el export
NO pasan por `repo.ts` en absoluto — tienen su propia capa paralela:

- `src/app/dashboard/page.tsx:25-40` — la función `getLiquidaciones` está
  definida DENTRO del archivo de la página, con su propio
  `supabaseAdmin().from('liquidacion').select(...)` y su propio mapeo a mano.
- `src/lib/cuadra/analytics.ts` (159 líneas completas) — es una SEGUNDA capa
  de acceso a datos, independiente de `repo.ts`, con 5 funciones que hacen sus
  propias queries a Supabase y su propio mapeo de filas
  (`getKpis:19-40`, `getStatsPorOperador:51-75`, `detectarAnomalias:86-100`,
  `getAcreditables:105-116`, `getLiquidacionDetalle:127-155`). **No existe
  `analytics.test.ts`** (confirmado con `find` — no hay ningún archivo de test
  para este módulo). `getStatsPorOperador` además es código muerto: no lo
  importa ninguna página (`command grep -rn getStatsPorOperador src` solo
  encuentra su propia definición).
- `src/app/api/export/liquidaciones/route.ts:21-26` — una TERCERA query
  directa a `liquidacion` con su propio join, fuera de `repo.ts` y de
  `analytics.ts`.

### [ALTO] La desincronización que el boletín anterior citó como advertencia ya volvió a pasar — está viva en el código de HOY, no solo en el historial
El comentario de `src/app/dashboard/[id]/page.tsx:11-13` documenta un
incidente real: "Se desincronizó una vez al partir 'viaticos' en tres: el
contralor veía 'hospedaje' en minúscula cruda en su tabla." La reparación fue
un comentario ("Mantener en sintonía con..."), no una fuente única ni una
prueba. Verificando las TRES copias hoy:

- `src/lib/cuadra/cuadre/engine.ts:467` — `otro: 'Gasto'`
- `src/lib/cuadra/liquidacion/pdf.ts:26` — `otro: 'Otro'`
- `src/app/dashboard/[id]/page.tsx:17` — `otro: 'Otro'`

**Ya están desincronizadas.** Un gasto con `concepto: 'otro'` que dispare
cualquiera de las notas de diferencia del motor (`label()` se usa en 9 sitios
de `engine.ts`, líneas 108-180, y esas notas viajan tal cual al WhatsApp del
operador vía `resumenCuadre` Y a la sección "Diferencias detectadas" del panel
del contralor, `dashboard/[id]/page.tsx:76-88`) le mostrará "Gasto de $X" al
operador por WhatsApp, mientras que la fila de ese mismo gasto en la tabla de
comprobantes del MISMO detalle de liquidación (`dashboard/[id]/page.tsx:98`,
usa el diccionario `CONCEPTO` local) dice "Otro". Es el mismo bug de origen
que el boletín anterior señaló — tres diccionarios hardcodeados sin fuente
compartida ni test — reproducido con una etiqueta distinta ('otro' en vez de
'viaticos'), y no fue lo que se corrigió: se corrigió el síntoma puntual
('viaticos' partido en tres) dejando la causa (sin single-source-of-truth,
sin test) intacta.

## Otros hallazgos

### [OPINIÓN] El resto de la arquitectura del dinero está disciplinado
`engine.ts` sigue puro y sin I/O, `guardia.ts` sigue siendo el backstop
determinístico que impide narrar cifras sin tool (verifiqué la lógica en
`guardia.ts:31-58`, incluida la distinción entre "no llamó ninguna tool" y
"consultó política pero no cuadró"), y `saveLiquidacion` (`repo.ts:307-334`)
sigue siendo una transacción atómica única (`guardar_liquidacion_tx`) en vez
de dos statements. El problema de este rubro está concentrado casi por
completo en la capa de LECTURA del panel, no en el motor.

### [BAJO] `getStatsPorOperador` es código muerto
`src/lib/cuadra/analytics.ts:51-75` — hace 3 queries a Supabase (`operador`,
`gasto`, `viaje`) y las cruza en JS, pero no lo importa ninguna página ni ruta
del repo. Si nadie lo va a usar, es mantenimiento gratis quitarlo; si se va a
usar pronto, merece su propio test antes de conectarlo a una vista.
