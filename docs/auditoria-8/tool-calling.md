# Tool calling — auditoría 8

**Nota: 8/10** (antes 8, auditoría 6 — el rubro no se auditó en la ronda 7).
Razón del movimiento: **ninguna de las tres.** La nota se queda igual porque
ninguna aplica: no hay commits de esta ronda que ataquen los reincidentes que
traigo abajo (los siete siguen exactamente como en la ronda 6, verificado
línea por línea, no de nombre); ningún reincidente cobró factura — no hay
incidente real, solo el mismo riesgo latente sin cambiar de tamaño; y la
mirada de hoy no encontró que la nota anterior estuviera inflada — al
contrario, verifiqué a fondo el único cambio de esta ronda que sí toca mi
rubro (AG-2, el permiso de citar viajando con `consultar_politica`, y el
crecimiento del resultado de `guardar_liquidacion` con el snapshot completo
de AG-3) y ambos resisten el ataque: ver "Lo que revisé y está bien".

El riesgo mayor hoy sigue siendo el mismo de la ronda 6: ninguna prueba
ejercita el handler real de `cuadrar_viaje`, así que la única lógica de
tool-calling que decide qué norma fiscal puede citar el modelo sobre el tope
de diésel en efectivo puede romperse sin que la suite (1296+ pruebas) se
entere.

## Verificación de los abiertos de la ronda 6

Los siete hallazgos que traía de la ronda 6 siguen abiertos. Confirmado con
`git log abdc98d..HEAD -- src/lib/llm/` (solo dos commits tocan ese
directorio: `87daa62`, que cambia `cuadra.mx`→`likida.ai` en una cabecera
HTTP, sin relación con estos hallazgos; y ninguno más) y con
`git diff abdc98d..HEAD -- src/lib/cuadra/tools.ts`, que muestra que el único
cambio en `tools.ts` es AG-2 (permiso de `consultar_politica`) y el snapshot
de AG-3 en `guardar_liquidacion` — ninguno de los dos toca las líneas de los
siete hallazgos. Detalle de cada uno abajo, con REINCIDENTE marcado.

## Hallazgos

### [MEDIO] El registro de auditoría (`ToolCallRecord.args`) sigue mintiendo sobre qué args produjeron un resultado (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:579-594`

```ts
579  const key = llave(call.function.name, args);
580  if (isReadOnly(call.function.name) && crossRound.has(key)) {
581    const c = crossRound.get(key)!;
582    executed.push({ toolName: call.function.name, args, result: c.result, durationMs: c.durationMs, error: c.error });
       ...
585  let p = inRound.get(key);
586  if (!p) { p = opts.toolExecutor(call.function.name, args); inRound.set(key, p); }
587  const exec = await p;
       ...
594  executed.push({ toolName: call.function.name, args, result: exec.result, durationMs: exec.durationMs, error: exec.error });
```

Escenario (idéntico al de la ronda 6, código sin tocar): el modelo emite en
la misma ronda `guardar_liquidacion` con `{}` y, por reintento de su propio
razonamiento, otra vez con `{"confirmar":true}`. `llaveDeCache` (líneas
446-458) colapsa ambas a la llave `"guardar_liquidacion"` porque el schema no
declara `properties`. La segunda entrada de `executed` queda con
`args:{"confirmar":true}` pero `result` es el que produjo el PRIMER llamador
— el handler nunca vio esos args. Mismo patrón en la rama `crossRound`
(línea 582): el `args` es de la llamada actual, el `result` es de una
ejecución de una ronda anterior.

Consecuencia: hoy ninguna, verificado de nuevo — `guardia.ts:37-40,63` lee
`.result`, no `.args`; `processor.ts:743-746` no lee `.args`; el log de
`processor.ts` (`tools: res.toolCalls.map(t=>t.toolName)`) tampoco los
persiste. El día que alguien use `ToolCallRecord.args` para depurar una
discrepancia de dinero, o que una tool futura sí decida sobre datos, el
registro apuntará al llamador equivocado.

Causa raíz probable: la caché por nombre resuelve el `result` compartido pero
no reescribe (ni descarta) el `args` local de cada llamador.

### [MEDIO] La atribución de costo tras fallback sigue etiquetando la fila completa con el modelo de la última ronda (REINCIDENTE, viene de al menos la ronda 5 — la ronda 6 ya lo llamó "4ª mención" — sin cambio hoy)

`src/lib/llm/openrouter.ts:536-537` · `src/lib/cuadra/processor.ts:743` ·
`src/lib/cuadra/costos.ts:101-104`

```ts
536  costo += calcCost(activeModel, rIn, rOut);   // correcto: suma ronda a ronda, al precio de CADA ronda
537  used = res.model || activeModel;             // pero solo sobrevive el de la ÚLTIMA
...
743  await registrarCosto({ ..., fase: faseDeModelo(res.model, 'cuadre'), modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.costUsd });
```

Verificado con `openrouter_fallback_costo.test.ts` (pasa: `r.cost` suma
correcto en un ciclo mixto primario+fallback), pero ese mismo test no toca
`r.model` en el caso mixto — solo confirma que el NÚMERO es correcto, no que
la ATRIBUCIÓN lo sea. `registrarCosto` (processor.ts:743) escribe UNA fila
con UN `modelo` para tokens que, en un ciclo que cruza a fallback a medio
camino, se cobraron a dos tarifas distintas. `faseDeModelo` (costos.ts:102)
clasifica el ciclo entero por el slug de la ÚLTIMA respuesta, así que un
ciclo que escaló a Opus solo en la ronda final se archiva como `escalacion`
completa aunque la mayoría de los tokens se pagaron al precio de Sonnet.

Consecuencia: quien reconcilie `llm_costo` contra la factura de OpenRouter
por modelo no puede — la fila no dice cuánto de esos tokens fue de cada
proveedor. Es un problema de reporting/facturación, no de que el dinero se
calcule mal (`costo` en sí ya suma bien).

Causa raíz probable: `generateWithTools` devuelve un solo `model` de nivel de
ciclo cuando el ciclo pudo correr en dos modelos distintos.

### [BAJO] `cuadrar_viaje` y `consultar_politica` siguen sin una sola prueba que ejercite su handler real (REINCIDENTE, sin cambio desde la ronda 6)

`src/lib/cuadra/tools.ts:25-136` · `src/lib/cuadra/tools_cableado.test.ts` ·
`src/lib/cuadra/normas/permiso_politica.test.ts`

Repetí la búsqueda de la ronda 6, con un tercer método:
`command grep -rn "executeTool('cuadrar_viaje'\|executeTool('consultar_politica'"
src --include="*.test.ts"` no encuentra nada. `tools_cableado.test.ts` (6
pruebas, todas pasan) sigue cubriendo solo `guardar_liquidacion`, y de forma
genuina: genera el PDF real y lee los bytes subidos, no espía el argumento de
llamada.

Lo que sí es nuevo desde la ronda 6: `permiso_politica.test.ts`, el test que
prueba el fix de AG-2. Lo leí completo esperando que cerrara este hueco para
`consultar_politica`, y no lo cierra — `resultadoDeLaTool()` (línea 32-44)
**reconstruye a mano** la forma que el handler de `tools.ts:34-75` debería
producir (llama `normasDePolitica` directamente y arma el objeto), en vez de
invocar `executeTool('consultar_politica', {}, ctx)` contra el handler real.
Es exactamente el patrón de gap que `tools_cableado.test.ts` documenta en su
propio encabezado como el error de la ronda 4 (mutar `tools.ts` sin que
ninguna prueba lo note porque prueban un nivel por debajo). Si alguien
invierte `NORMAS[id].estado !== 'sin_verificar'` a `===` en la línea 71 de
`tools.ts`, o rompe la llamada a `getConfig`, las 1296+ pruebas del repo
siguen verdes.

Para `cuadrar_viaje` el hueco es el mismo que la ronda 6 documentó con
valores concretos y sigue intacto: la condición `periodo.estado !== 'holgado'`
(`tools.ts:117`) que decide si el modelo puede citar `rfa-2026-2.9` no tiene
una sola aserción directa. Invertirla a `===` pasaría toda la suite.

Consecuencia: la tool que decide qué norma fiscal sobre el tope de diésel en
efectivo puede citar el modelo, y la que decide si el permiso de citar la
política existe, son código sin arnés propio — solo probado por lo que sus
llamadores (guardia, processor) hacen con una salida simulada a mano.

### [BAJO] `ctx.signal` sigue sin consumirse en los handlers de tools (REINCIDENTE mitigado, sin cambio desde la ronda 6)

`src/lib/llm/tool-executor.ts:12-19` · `src/lib/cuadra/tools.ts` ·
`src/lib/cuadra/repo.ts:45-73` · `src/lib/cuadra/presupuesto.ts:99`

`command grep -rn "\.signal" src/lib/cuadra/tools.ts src/lib/cuadra/repo.ts`
no devuelve nada: ningún handler de tool ni ninguna de las 17 funciones de
`repo.ts` lee `ctx.signal`. Confirmado también sin cambio: las 17 funciones
exportadas de `repo.ts` siguen pasando por `acotada()`
(`command grep -c "acotada(" repo.ts` → 17), que impone su propio
`AbortSignal.timeout(TOPE_CONSULTA_MS)` (8000ms por defecto,
`presupuesto.ts:99`). El techo real de cualquier consulta individual sigue
siendo 8s con o sin `ctx.signal`, así que el riesgo práctico de "consulta
colgada para siempre" sigue mitigado — pero sigue siendo un segundo mecanismo
de timeout que no se habla con el primero (el del turno completo, en
`run.ts:32-34`), y por diseño ninguno de los dos cancela al otro.

Consecuencia: si el `AbortController` de `runAgent` dispara porque el turno
se agotó, una consulta de `repo.ts` en vuelo no se entera por esa vía —
termina por su propio reloj de 8s, no por el del turno.

### [BAJO] `isTransientError` sigue dando falso positivo con `5\d\d` en el texto (REINCIDENTE, sin cambio desde la ronda 4)

`src/lib/llm/openrouter.ts:73-80`

Mismo regex: `/\b(5\d\d|429|408|502|503|504)\b/.test(texto)` sobre el mensaje
completo y `err.cause`. Releí `openrouter_transitorio.test.ts` completo (5
casos, todos pasan): el único caso "NO transitorio" que prueba es `400` y
`401` — sigue sin un caso negativo con un `5xx` dentro del texto de un error
que NO es de proveedor caído. Un error real de la app con esa forma —
`saveLiquidacion: check constraint violada (monto=507.65)`, o un folio
`FOLIO-502` duplicado — sigue clasificando como transitorio y gastando una
llamada extra a otro proveedor que va a fallar exactamente igual, porque el
error es del dato, no del proveedor.

### [BAJO] El error crudo de la base de datos sigue viajando sin filtrar al contexto del modelo (REINCIDENTE, sin cambio desde la ronda 5)

`src/lib/llm/tool-executor.ts:52-63` · `src/lib/llm/openrouter.ts:595` ·
`src/lib/cuadra/repo.ts:107` (ejemplo concreto de dónde nace el mensaje)

`executeTool` (tool-executor.ts:52-63) mete `err.message` sin sanitizar en
`ToolExecResult.error`, y `generateWithTools` lo serializa tal cual como
`content` del mensaje `role:'tool'` (`JSON.stringify({ error: exec.error })`,
línea 595). Un ejemplo concreto de qué puede llegar ahí:
`repo.ts:107 throw new Error(\`viaje: ${error.message}\`)` — el `.message` de
Postgres, con nombres de columna, de tabla o de constraint, entra sin filtro.
Nombres internos siguen pudiendo llegar al modelo y, de ahí, a lo que narra
por WhatsApp si la guardia de cifras no lo intercepta (solo lo hace cuando
`cuadro` es verdadero o el texto trae dinero).

### [BAJO] El loop-guard sigue ejecutando la ronda 6 completa antes de tirar el resultado (REINCIDENTE, sin cambio desde la ronda 5)

`src/lib/llm/openrouter.ts:528-604`

El `for` (línea 528-599) corre las 6 rondas completas —las tools de la ronda
6 se ejecutan, se pagan y se empujan a `convo`— y solo DESPUÉS, al salir del
`for`, lanza `LoopGuardError` (línea 600), que el `catch` (601-604) envuelve
en `PartialExecutionError` junto con `executed`. `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`
sigue activo en `.env.local:34`, así que el huérfano de cara al operador
sigue resuelto (`processor.ts` recupera el cierre parcial); lo que se sigue
descartando es el propio `LoopGuardError` — el ciclo nunca aprovecha esa
6ª ronda para intentar cerrar con lo que ya tiene, corre a ciegas hasta el
tope y recién ahí revienta.

## Lo que revisé y está bien

- **AG-2 (`consultar_politica` con permiso de citar) resiste el ataque desde
  el ángulo de tool-calling.** Leí `tools.ts:34-75`, `por_diferencia.ts:91-133`
  (`normasDePolitica`) y `processor.ts:846`
  (`normasDeToolCalls(agentTools.filter((t) => !t.error).map((t) => t.result))`)
  para confirmar que el permiso se agrega sobre **TODOS** los `toolCalls` del
  turno —no solo el último ni solo `cuadrar_viaje`— así que si el modelo llama
  `consultar_politica` Y `cuadrar_viaje` en el mismo turno, sus `fundamentos`
  se unen antes de pasar a `guardiaFundamento`. `permiso_politica.test.ts`
  (9 pruebas, pasan) cubre el caso central: sin la tool no hay permiso
  (línea 96-98), que es la posición segura. La regla estructural
  (`properties: {}`, ninguna tool decide con datos del modelo) sigue intacta
  en las tres tools — releído `tools.ts` completo.
- **AG-3 (el snapshot `liq` completo en el resultado de `guardar_liquidacion`)
  no abre una fuga hacia el operador, verificado y no solo leído.** Investigué
  a fondo si el crecimiento del resultado de la tool —ahora trae
  `liq.diferencias[].nota`, que incluye texto SOLO_CONTRALOR como "está en
  lista negra del SAT (EFOS)"— podía llegarle al chofer por una vía distinta
  al PDF filtrado. Descarté la hipótesis con dos hechos del código: (1)
  `guardia.ts:38-39,83` hace que `guardiaCifras` **reemplace siempre** el
  `reply` del modelo por `resumenCuadre(liq, cerro, 'operador')` en cualquier
  turno donde `cuadrar_viaje` O `guardar_liquidacion` corrieron —el propio
  texto del modelo, que sí pudo ver el `.nota` crudo en el tool result, nunca
  llega a WhatsApp esos turnos—; y (2) `conv.ts:15-18` (`ConvTurn`) persiste
  SOLO `{role, content}` de texto plano entre turnos — los resultados crudos
  de tools nunca sobreviven a la siguiente pregunta del operador. La misma
  exposición de `.nota` ya existía en `cuadrar_viaje` antes de esta ronda (no
  es nueva), y por eso no la reporto como hallazgo — pero valía la pena
  reverificar que crecer el payload de `guardar_liquidacion` no reabriera el
  bug que AG-3 mismo vino a cerrar.
- **La idempotencia de mutaciones bajo concurrencia real sigue sólida.**
  `tool_executor_concurrente.test.ts` (6 pruebas, pasan) sin tocar nada del
  repo.
- **La caché de lectura por nombre sigue acertando** para tools sin
  parámetros, entre rondas y dentro de la ronda:
  `openrouter_cache_llave.test.ts` (3 pruebas) y el test nuevo-para-mí de
  `openrouter_fallback_costo.test.ts` ("`cuadrar_viaje` llamada dos veces se
  ejecuta UNA"), ambos pasan.
- **El costo por ronda se suma al precio de la ronda que respondió**, no al
  del modelo activo al final: confirmado con los dos casos de
  `openrouter_fallback_costo.test.ts` (ciclo entero en primario, y
  primario+fallback mixto). Lo que no se atribuye bien es el `model` que
  queda en la fila (hallazgo de arriba), no el número.
- **El fallback de `generateWithTools` sigue reintentando solo el
  `complete()`**, antes de que las tools de esa ronda corran
  (`openrouter.ts:497-524`, el `for` empieza en 528): estructuralmente no
  puede re-ejecutar una mutación.
- **Aislamiento por tenant intacto**: `getViaje` (`repo.ts:96`), `getOperador`
  (`:123`) y `getConfig` (`config.ts:176`) siguen filtrando por `tenant_id`
  además del id de fila — releído, sin cambio.
- **`registry.ts` y `run.ts` sin cambios**: mismos dos agentes, mismas tres
  tools, `ctx.signal` se sigue creando y pasando pero (ver hallazgo) sin
  consumirse en el handler.
- **Línea base propia, corrida hoy**: `npx vitest run src/lib/llm/
  src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/normas/permiso_politica.test.ts` → **64 pruebas, 11
  archivos, 0 fallos**. No modifiqué ningún archivo del repo.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter** — mismo límite que la ronda 6: no
  logré interceptar `openai` desde un archivo de prueba fuera de `src/` sin
  pegarle a la red real. Los hallazgos de arriba están apoyados en lectura de
  código determinista (el `Promise.all` sobre `.map()` async es síncrono
  hasta el primer `await`, sin ambigüedad de orden en JS de un solo hilo), no
  en una corrida en vivo.
- **Con qué frecuencia el modelo real emite `arguments` distintos de `{}`**
  para las tres tools de Likida — sigue sin `strict:true` en sus schemas
  (`tools.ts:31,87,146` contra el único `strict:true` del repo,
  `openrouter.ts:290`, para OCR). No medí la tasa contra el proveedor real,
  así que no sé qué tan seguido el hallazgo del `ToolCallRecord.args`
  desalineado ocurre en producción versus en el peor caso teórico.
- **`max-rows` real de PostgREST** para `getAcumuladoCombustible` — no lo
  toqué esta ronda, no hubo cambio en ese código.
- **`tool_calls` en streaming** — el cliente lo sigue sin usar; sin cambio.
- **Prompt caching** (`cache_control`) — sigue en cero, no lo cuantifiqué.
- **El texto real que un modelo de producción escribiría** dado el `.nota`
  crudo de `guardar_liquidacion` en su contexto — verifiqué la RUTA
  estructural (guardia siempre reemplaza), no corrí el modelo de verdad para
  confirmar que nunca decide, por ejemplo, mencionar el dato en una llamada a
  OTRA tool o en un log de razonamiento que yo no pueda ver desde aquí.
