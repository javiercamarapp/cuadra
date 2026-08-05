# Tool calling — auditoría 13

**Nota: 7/10** (ronda 12: 8/10). Baja un punto por deuda que cobró factura, no
por regresión: el [MEDIO-1] de la ronda 12 —el fallback del rol `cuadre` manda
el bloque `cache_control` de Anthropic a un modelo OpenAI por un camino que
ninguna prueba toca— **sigue abierto, verificado y reproducido HOY en el código
de producción** (`caae369`), y la re-auditoría de la ronda 12 lo dio por
"sin hallazgos abiertos nuevos" en la tabla de la síntesis mientras el propio
reporte de la ronda 12 lo dejaba abierto con la recomendación explícita de
"resolver antes de la sala de mañana". Mañana ES la sala. Además, esta ronda
encontró que el hueco de `mensajeParaElModelo` (BAJO de la ronda 12, "sin
alcance desde el código actual") **sí es alcanzable** por la tool de mutación
más importante: el error de Postgres "function … does not exist" de la RPC
`guardar_liquidacion_tx` cruza crudo al modelo.

Lo que NO cambió: la regla estructural sigue intacta y probada (117+ pruebas
del rubro verdes, `tsc` y `eslint` limpios), no hay ningún camino de "el modelo
pide algo" a "el sistema rompe dinero" abierto, y no apareció ningún
CRÍTICO/ALTO nuevo. Lo que bajó la nota es que el riesgo que la ronda 12
marcó como el único pendiente pre-demo se desplegó sin cerrar, y que la
contabilidad de costo tiene un caso nuevo (el $0 de una llamada abortada a
mitad de vuelo) que contradice la regla que este mismo rubro sostiene.

## Qué se auditó y con qué evidencia

- `src/lib/llm/openrouter.ts` (825 líneas) — releído completo. `git diff
  ce9abab..HEAD` sobre el rubro: **solo cambió `processor.ts`** (61+/7-, todo
  de legal/fiscal/backend); `openrouter.ts`, `tool-executor.ts`, `tools.ts`,
  `costos.ts`, `run.ts`, `registry.ts`, `models.ts` y `intake/ocr.ts` están
  **byte-idénticos** a lo que audité en la ronda 12.
- `src/lib/cuadra/processor.ts:1800-1930` — el consumo de `costoPorModelo`, la
  rama de cierre parcial y el registro de costo 'parcial'.
- `src/lib/cuadra/intake/ocr.ts:195-345` — el consumidor de `generateStructured`
  con señal y el armado del costo del fallo.
- `src/lib/cuadra/repo.ts:592-618` — `saveLiquidacion` (RPC) y su throw, para
  probar la alcanzabilidad del hueco de `mensajeParaElModelo`.
- Los 16 archivos de prueba de `src/lib/llm/` + `tools_cableado`,
  `tools_camino_real`, `permiso_politica`, `por_diferencia`,
  `processor_cadena`.
- `docs/auditoria-12/tool-calling.md` y `docs/auditoria-12/00-SINTESIS.md` —
  el formato y los cierres declarados, verificados contra el código real.

Corridas propias:
```
$ npx vitest run src/lib/llm/            → 16 archivos, 73 pruebas, 0 fallos
$ npx vitest run tool-executor tool_executor_concurrente tools_cableado \
      tools_camino_real permiso_politica por_diferencia cache_prompt \
      openrouter_transitorio openrouter_registro_args openrouter_loopguard \
      openrouter_cache_fallo openrouter_cache_llave → 12 archivos, 65 pruebas, 0 fallos
$ npx tsc --noEmit -p .                  → limpio
$ npx eslint src/lib/llm/ src/lib/cuadra/tools.ts src/lib/agents/ \
      src/lib/cuadra/costos.ts           → limpio
```

Reproducción propia (script temporal `zzz_auditoria13_tmp.test.ts`, borrado al
terminar): con el SDK mockeado, un ciclo del rol `cuadre` que cae de
`anthropic/claude-sonnet-5` a `openai/gpt-5.6-terra` por un 503 manda la
llamada del fallback con `messages[0].content` como **ARRAY** con
`cache_control: {type:'ephemeral'}`:

```
LLAMADA 1 model= anthropic/claude-sonnet-5 system content tipo= ARRAY
LLAMADA 2 (fallback) model= openai/gpt-5.6-terra system content=
[{"type":"text","text":"REGLAS FISCALES LARGAS…","cache_control":{"type":"ephemeral"}}]
```

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools
(`tools.ts:31,87,146`), `tenantId`/`viajeId`/`operadorId` saliendo solo del
`ToolContext` resuelto en servidor (`run.ts:29-31`), handlers que ignoran
`_args`— sigue intacta, byte-idéntica a la ronda 12 y probada por
`tools_cableado`/`tools_camino_real`.

### ALTO

Ninguno nuevo. El ALTO de la ronda 10 (FALLBACK sin entrada para el OCR en
producción) sigue cerrado: la entrada vive en `openrouter.ts:63`, la prueba
`openrouter_fallback_ocr.test.ts` la fija con el override real, y
`modelosAisladosDeFallback()` + `openrouter_fallback_cobertura.test.ts`
cierran la clase entera.

### MEDIO

#### [MEDIO, abierto — ronda 12 reincidente, en producción] El bloque `cache_control` de Anthropic sigue viajando al fallback no-Anthropic del rol `cuadre`

`src/lib/llm/openrouter.ts:666-669` (el system se arma UNA vez, desde el modelo
PRIMARIO) · `:672` (`convo` se construye con ese system) · `:711-714` (el
fallback cambia `activeModel` pero reusa `convo`) · `:66`
(`'anthropic/claude-sonnet-5': 'openai/gpt-5.6-terra'`) · `models.ts:24` (el
rol `cuadre` corre en sonnet por default y por override).

Escenario con valores: el rol `cuadre` corre en `anthropic/claude-sonnet-5`.
`soportaCache = /anthropic\//.test(model)` → true, y `sistema` queda como
`{ role: 'system', content: [{ type: 'text', text, cache_control: { type:
'ephemeral' } }] }`. En la ronda 3, Anthropic devuelve 503; `complete()` mueve
`activeModel = 'openai/gpt-5.6-terra'` y reintenta con el MISMO `convo`. Lo
reproduje hoy con el SDK mockeado (arriba): la llamada al fallback lleva
`model: 'openai/gpt-5.6-terra'` y `messages[0].content` como ARRAY con
`cache_control` — una extensión de Anthropic que el tipo del SDK de OpenAI no
contempla (por eso el `as any` de la línea 669) y que OpenAI no documenta en
sus content parts. Si OpenRouter reenvía el campo a OpenAI y este lo rechaza
con 400, **el fallback del rol que orquesta dinero muere en el primer
parpadeo de Anthropic** — el ciclo se cae con `PartialExecutionError` y el
operador recibe "se me trabó", exactamente lo que el fallback existe para
evitar. Sigue sin prueba: `cache_prompt.test.ts` cubre (1) primario Anthropic
sin fallback, (2) mensajes variables sin marcar, (3) primario no-Anthropic con
system en string plano; el camino (1)+fallback OpenAI no existe.

Estado: **abierto — y desplegado**. `git diff ce9abab..HEAD` confirma que
`openrouter.ts` no se tocó en los ~40 commits de la ronda 12, así que
`caae369` (producción) lleva el código exacto que la ronda 12 marcó como "el
único riesgo a cerrar antes del demo". La tabla de la re-auditoría en
`00-SINTESIS.md` ("Tool calling | 8 | 8 | sin hallazgos abiertos nuevos") es
literalmente cierta —no aparecieron NUEVOS— pero dejó abierto el que la propia
ronda había marcado, y el veredicto de la ronda 12 ("resolver antes de la sala
de mañana") quedó sin ejecutar. El fix sigue siendo el mismo y chico:
reconstruir `sistema` sin el bloque cuando `activeModel` deja de ser Anthropic
(`sistema` ya no puede ser una constante del primario), o una verificación
viva contra OpenRouter real antes de la sala.

### BAJO

#### [BAJO, abierto — ahora con camino CONCRETO] `mensajeParaElModelo` deja pasar "function … does not exist" — y la tool `guardar_liquidacion` lo alcanza

`src/lib/llm/tool-executor.ts:82-87` (regex `VOCABULARIO_POSTGRES`) · `:113`
(aplicada en `executeTool`) · `src/lib/cuadra/repo.ts:604-618`
(`saveLiquidacion` → `admin.rpc('guardar_liquidacion_tx', …)` y `throw new
Error(\`saveLiquidacion: ${error.message}\`)`).

La ronda 12 lo dejó como "sin prueba y sin alcance demostrado" usando el
ejemplo de `resumen_costo_ia_tenant` (que NO pasa por una tool). Esta ronda
encontró el camino real: `guardar_liquidacion` → `saveLiquidacion` → RPC.
Verificado con node que el vocabulario NO cubre la familia de errores de RPC
ausente ni otros modos reales de PostgREST:

```
'function resumen_costo_ia_tenant(character varying) does not exist' → PASA CRUDO
'more than one row returned by a subquery used as an expression'    → PASA CRUDO
'could not serialize access due to concurrent update'               → PASA CRUDO
'canceling statement due to statement timeout'                      → PASA CRUDO
'operator does not exist: character varying = uuid'                 → PASA CRUDO
```

Escenario con valores: la migración que crea `guardar_liquidacion_tx` no
aplicada (o renombrada), o un `statement timeout` en la RPC de cierre: el
mensaje `saveLiquidacion: function guardar_liquidacion_tx(p_tenant, p_viaje,
…) does not exist` llega a `ToolExecResult.error` y de ahí, sin más escalas, al
`content` del mensaje `role: 'tool'` que el modelo LEE (`openrouter.ts:815`).
El nombre interno de la RPC y su firma —no dinero ni PII, pero sí el criterio
que el repo ya aplica: "no exponer lo interno"— viajan tal cual. La función que
lo implementa sigue sin UNA sola prueba (`grep -rln "mensajeParaElModelo|
VOCABULARIO_POSTGRES" src --include="*.test.ts"` → cero archivos): un refactor
de la regex no tiene red. Sugerencia mínima: añadir `does not exist|more than
one row|could not serialize|canceling statement|operator does not exist` al
vocabulario, y una prueba por rama.

#### [BAJO, abierto — latente] `isTransientError` sigue con falso positivo para 5xx desnudos y decimales con coma

`src/lib/llm/openrouter.ts:122` (regex `(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b`).

Verificado hoy con node, idéntico a la ronda 12:

```
'el gasto 502 no existe'            → true (falso positivo)
'viaje 502 ya liquidado'            → true
'el tenant 502 tiene problemas'     → true
'monto 502,30 excede el tope'       → true (coma decimal, formato es-MX)
'Error 502: Bad Gateway'            → true (correcto)
```

Sigue sin ser alcanzable desde el código actual —`isTransientError` solo recibe
errores del SDK (`openrouter.ts:286,499,711`)— pero la clase de error sigue
abierta y `openrouter_transitorio.test.ts` no trae ni el número desnudo ni la
coma decimal. Es la misma deuda que la ronda 10 cerró a medias.

#### [BAJO, abierto — nuevo] Una llamada OCR abortada a mitad de vuelo se asienta como costo $0 (desconocido disfrazado de medición)

`src/lib/cuadra/intake/ocr.ts:284` (`costoUsd: u?.cost ?? 0`) · `openrouter.ts:
404,411` (`throwIfAborted`) y el pase de `{ signal }` al SDK · `processor.ts:
797` (`extraerComprobante(dataUrl, reloj.senal(25_000))`) · `processor.ts:526,
800` (la fila se registra igual en el fallo).

Escenario con valores: la foto entra, el webhook tiene presupuesto; a los 25 s
`reloj.senal(25_000)` dispara el abort. El primer intento de `generateStructured`
estaba EN VUELO: el fetch se aborta, el SDK lanza `AbortError`, y `cobrar()`
nunca corre — `gastado` queda en 0. `conGastado` (`openrouter.ts:467-469`)
escribe `err.usage = { model, tokensIn: 0, tokensOut: 0, cost: 0 }`;
`extraerComprobante` devuelve `costo.costoUsd = 0`; `registrarCosto` inserta la
fila con `costo_usd: 0` (pasa la guarda: es finito y no negativo). El problema:
OpenRouter pudo cobrar la generación que ya estaba en curso cuando el cliente
se desconectó, y el sistema asienta "esta llamada costó $0" — una cifra que no
es una medición, es una suposición. Es exactamente la clase que `costos.ts`
documenta como la peor del rubro ("un costo que se subestima en silencio es
peor que uno que se equivoca ruidosamente"), y en el peor momento posible:
una foto lenta el día del demo paga una llamada que el contador del panel
registra como gratis. No hay forma de recuperar el `usage` de una llamada
abortada; el fix honesto es NO escribir la fila (o escribirla con un marcador
de "costo desconocido"), no escribir 0. La misma mecánica aplica al turno de
`cuadre` abortado por `reloj.acotar(40_000)`: la ronda en vuelo que se aborta
no suma su costo al `PartialExecutionError` (`processor.ts:1910-1913` lo
registra como `parcial` con el costo subestimado).

#### [BAJO, abierto — nuevo, decisión de diseño con hueco] Truncamiento + truncamiento nunca prueba el proveedor de respaldo

`openrouter.ts:482-490`: si `e1` es `TruncatedError`, el reintento sube el tope
a `tope * 2`; si `eT` TAMBIÉN es `TruncatedError`, `throw eT` sale del ciclo
sin mirar el `fallback`. `openrouter_truncado.test.ts` fija ese
comportamiento como intencional, así que no es un bug — es una decisión con un
hueco: el plan B no existe para el modo de falla "el primario quema el
presupuesto de salida", que es EXACTAMENTE el modo de falla medido del OCR
(3 de 5 tickets truncados con techo de 1200 el 27-jul, comentario de
`DEFAULT_MAX_TOKENS`). Hoy el override de producción es
`google/gemini-3.1-flash-lite` (~274 tokens de salida, benchmark del 4-ago), así
que el riesgo es bajo; el día que alguien revierta el override a
`google/gemini-3.6-flash` (que gasta ~1,500 tokens de razonamiento), un
comprobante que trunque dos veces le dará al operador "fallo_tecnico" aunque
`anthropic/claude-haiku-4.5` (que no quema razonamiento) esté sano y a centavos.
El reintento de techo doble es la mitigación correcta para el primario; que el
fallback no entre nunca en la conversación es la parte cuestionable.

#### [BAJO, abierto — nuevo, cosmético] En el camino "ambos proveedores fallaron", el costo acumulado se etiqueta con el modelo PRIMARIO

`openrouter.ts:467-469` (`conGastado`): `err.usage = { model, ...gastado }` —
`model` es el primario, `gastado` es el total de TODOS los intentos (primario +
nota + fallback). Si el fallback consumió la mayor parte de los tokens antes de
caer, la fila de `llm_costo` (vía `ocr.ts:282`, `u?.model`) dice que todo se
gastó en el primario. El dinero es correcto; la etiqueta por-modelo miente a
medias, y `faseDeModelo` (que decide `escalacion` si el slug trae `opus`) podría
clasificar mal la fase en un caso opus→fallback→fallo. Solo en el camino raro
"los dos proveedores cayeron"; el camino de éxito etiqueta bien (devuelve
`usage.model` del fallback).

#### [BAJO, abierto — ronda 12] `JSON.stringify(exec.result)` produce `content: undefined` si un handler de éxito devuelve `undefined`

`openrouter.ts:815`. Hoy los tres handlers devuelven objeto (`tools.ts:64,110,
180`), así que sigue latente; un `result ?? null` lo cierra.

#### [BAJO, abierto — ronda 12] `ctx.signal` sigue sin consumirse en ningún handler

`grep -n "\.signal" src/lib/cuadra/tools.ts` → cero matches. Deuda documentada
con su análisis en `tool-executor.ts:19-40`; mitigante activo: `acotada()`
mata cada consulta a `TOPE_CONSULTA_MS`+`GRACIA_TOPE_MS`. Sin cambio.

#### [BAJO, abierto — ronda 12] `generateStructured` gasta un intento pagado en el proveedor muerto antes de cruzar al fallback

`openrouter.ts:494-503`; `openrouter_fallback_ocr.test.ts` lo fija (3 llamadas,
2 al proveedor caído). Costo del caso "provider caído" = el doble de lo
necesario. Deliberado y comentado.

#### [BAJO, abierto — ronda 12] `registerTool` ante re-registro solo avisa, no falla

`tool-executor.ts:37-39`. Teórico (un solo módulo registra), sin cambio.

## Arreglado desde la ronda 12 (verificado en el código actual)

La ronda 12 no declaró cierres de código para este rubro —el diff
`ce9abab..HEAD` solo toca `processor.ts` por rubros ajenos (legal: ARCO;
fiscal: litros del XML; backend: `sendDocument` con rastro)— y todos los cierres
que la ronda 12 atribuyó a la ronda 10 siguen en pie, verificados uno por uno:

- **`ToolCallRecord.args` auditable** — `openrouter_registro_args.test.ts` (2
  pruebas, verdes); `openrouter.ts:681-689,795-800` guarda los args ORIGINALES
  junto al resultado cacheado.
- **Loop-guard corta ANTES de ejecutar la ronda que excede el límite** —
  `openrouter.ts:761-770` (el `throw` está antes del `Promise.all`), probado en
  `openrouter_loopguard.test.ts`.
- **Atribución de costo por modelo real** — `costoPorModelo`
  (`openrouter.ts:638-641,729-731`) y su consumo en `processor.ts:1875-1882`
  (una fila por modelo cuando el ciclo cruzó de proveedor; el camino de una
  sola fila se conserva). Probado en `openrouter_fallback_costo.test.ts` y
  `processor_cadena.test.ts:359-389`.
- **Falso positivo de `isTransientError`** — `FOLIO-502`/`$502`/`503.00`
  cerrados y probados; quedan los huecos del BAJO de arriba.
- **El error crudo de Postgres no cruza** — `mensajeParaElModelo` activo en
  `tool-executor.ts:113`, con la salvedad del BAJO de arriba.
- **FALLBACK para toda la clase** — `modelosAisladosDeFallback()` + prueba de
  cobertura.
- **El costo del ciclo caído viaja en `PartialExecutionError`** y la rama de
  cierre parcial lo registra (`processor.ts:1903-1913`).

## Lo que revisé y está bien

- **Regla estructural intacta**: `properties: {}` en las tres tools
  (`tools.ts:31,87,146`), handlers que ignoran `_args`, IDs solo desde
  `ToolContext`. `tools.ts` y `run.ts` byte-idénticos a la ronda 12.
- **El abort NO dispara fallback**: verificado con node — "The operation was
  aborted" no matchea `isTransientError` (ni por tipo: `AbortError` no es
  `APIConnectionError` ni trae `status` numérico), así que un turno que se
  queda sin presupuesto no gasta un centavo más en el proveedor de respaldo.
  Y en `generateStructured`, el reintento con nota tras un abort muere en el
  `throwIfAborted()` de la línea 404 ANTES de pagar una segunda llamada.
- **Caché de lectura**: solo éxitos (`openrouter_cache_fallo.test.ts`), llave
  por efecto con tools sin parámetros (`openrouter_cache_llave.test.ts`),
  `cuadrar_` en `READ_PREFIXES` con prueba de una sola ejecución; el acierto
  de caché registra los args de la llamada que LLENÓ la caché, no los de la
  actual (fix de la ronda 10 verificado).
- **Caché de prompt**: `cache_control` solo en el system, nunca en mensajes
  variables, nunca para primarios no-Anthropic (`cache_prompt.test.ts`, 3
  pruebas) — con el hueco del MEDIO de arriba.
- **Dedup de mutaciones**: cachea la PROMESA, no el resultado
  (`tool_executor_concurrente.test.ts`, 6 pruebas verdes); fallo no cacheado;
  llave por nombre (el efecto), no por args.
- **`costoReal()`/`calcCost`**: prioriza el costo del proveedor, guardas
  contra NaN/negativos, nunca 0 en silencio, tolera sufijos (`costo_real.test
  .ts`, `openrouter_costo.test.ts`).
- **`finish_reason:'length'` sin tool_calls** no se envía como turno bueno:
  `TruncatedError` envuelto en `PartialExecutionError`, probado
  (`openrouter_truncado_tools.test.ts`); el techo ya no es 1000.
- **El error de datos no cruza `isTransientError`** — solo los errores del SDK
  pasan por ahí (`openrouter.ts:286,499,711`); los de negocio van por
  `executeTool`.
- **`generateStructured`**: `TruncatedError` se detecta ANTES de parsear; el
  consumo ACUMULADO viaja en el error y en el éxito (`gastado`); el reintento
  de truncamiento sube el techo a `tope*2` (con su prueba).
- Suite del rubro completa verde (73 + 65 pruebas), `tsc` y `eslint` limpios.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter/Anthropic/OpenAI** — el MEDIO-1 solo
  se zanja con una llamada viva (¿OpenRouter descarta o reenvía `cache_control`
  a un modelo OpenAI?) o con el fix de código. No hice la llamada: cuesta
  dinero y la regla del rubro es solo lectura.
- **Los overrides de Vercel** (`CUADRA_MODEL_CUADRE`, `CUADRA_MODEL_OCR` y
  demás): no puedo verificarlos desde el repo. Un override que no tenga entrada
  en `FALLBACK` apaga el plan B en silencio; `CUADRA_MODEL_OCR` está cubierto
  por prueba, el resto no. Si el demo corre con `CUADRA_MODEL_CUADRE` apuntando
  a un modelo fuera de la tabla, el MEDIO-1 ni siquiera es el peor problema:
  no habría fallback en absoluto.
- **`finish_reason:'length'` con `tool_calls` parcialmente emitidos** — el
  punto ciego de las rondas 9/10/12 sigue igual: si `calls.length > 0`, las
  tools se ejecutan sin mirar `finish_reason`, y para una tool sin parámetros
  los args `{}` parsean hasta truncados (una mutación pedida con args completos
  corre aunque la respuesta se haya cortado). No encontré daño concreto nuevo,
  y no hay prueba que lo amarre.
- **El rubro agéntico** (`guardiaCifras`, `guardiaFundamento`) — consumidor de
  `ToolCallRecord`, no parte de este rubro.
- Las migraciones 0078/0079/0080 y los cambios de `processor.ts` de legal/
  fiscal/backend — otros rubros; solo confirmé que no tocan nada de
  `src/lib/llm` ni `tools.ts`.

## Veredicto

**Green light para el rubro tool-calling, con la MISMA advertencia de la ronda
12, ahora vencida.** La regla estructural —el LLM decide CUÁNDO, nunca CON QUÉ
DATOS; el dinero se mueve solo por handlers determinísticos con IDs de
servidor— está intacta y probada, y no hay ningún camino abierto de "el modelo
pide algo" a "el sistema rompe dinero". La contabilidad de costo está correcta
y atribuible por modelo real.

Pero el rubro baja a 7/10 por tres cosas concretas, en orden:

1. **El MEDIO-1 sigue en producción el día antes del demo.** La ronda 12 lo
   marcó como "el único riesgo a cerrar antes de la sala" y se desplegó sin
   cerrar. Es exactamente el camino que se pisa si Anthropic parpadea en vivo,
   y el modo de falla sería el "se me trabó" que el diseño del fallback
   promete no tener. El fix es chico y local (`sistema` no puede ser una
   constante del primario cuando `activeModel` deja de ser Anthropic, o una
   verificación viva contra OpenRouter real). Lo demás —los BAJOS de
   `isTransientError`, `ctx.signal`, `content: undefined`, `registerTool`,
   el intento extra en el proveedor muerto— sigue siendo deuda latente, no
   bloqueante.
2. **El hueco de `mensajeParaElModelo` dejó de ser teórico**: `guardar_liquidacion`
   → `saveLiquidacion` → RPC demuestra que "function … does not exist" y
   amigos cruzan crudos al modelo por la tool de mutación más importante. Es
   un fix de una línea + pruebas.
3. **El $0 de la llamada abortada a mitad de vuelo** contradice la regla que
   este rubro sostiene ("cero solo cuando cero es una medición") justo en el
   camino del demo: una foto lenta paga una llamada que el panel registra como
   gratis.

Recomendación antes de la sala de mañana, en orden de urgencia: (a) cerrar el
MEDIO-1 (fix de código o llamada viva), (b) ampliar `VOCABULARIO_POSTGRES` y
anclar `mensajeParaElModelo` con pruebas, (c) que la fila de costo de una
llamada abortada no diga $0.
