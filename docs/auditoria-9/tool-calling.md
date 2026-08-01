# Tool calling — auditoría 9

**Nota: 8/10** (antes 8). Razón del movimiento: no atacado esta ronda —
confirmado con `git log 43ebf41..HEAD -- src/lib/cuadra/tools.ts
src/lib/llm/` (cero commits) y `git diff 43ebf41..HEAD --stat -- src/lib/cuadra/tools.ts src/lib/llm/`
(sin salida). `tools.ts`, `openrouter.ts`, `tool-executor.ts` y `models.ts`
son **byte-idénticos** a como quedaron al cierre de la ronda 8. La mirada de
hoy fue adversarial y con contexto fresco — releí los cuatro archivos
completos, corrí la suite del rubro, y perseguí activamente la posibilidad de
que `processor.ts` (+433 líneas esta ronda) o `repo.ts` (+188) hubieran roto
algo en la frontera del tool-calling sin tocar los archivos propios del
rubro. No encontré nada nuevo ni nada que la nota anterior no viera: los
mismos siete reincidentes (2 MEDIO, 5 BAJO) de la ronda 8 siguen exactamente
donde estaban, sin que ninguno haya cobrado factura.

El riesgo mayor sigue siendo el mismo: `cuadrar_viaje` y `consultar_politica`
—las dos tools que deciden qué norma fiscal puede citar el modelo frente al
contralor— no tienen una sola prueba que invoque su handler real a través de
`executeTool`. Un cambio que invierta la condición que decide si el tope de
diésel en efectivo aplica pasaría los 1300+ tests verde.

## Verificación de que nada cambió (y de que el cambio ajeno no filtró)

- `command grep -rn "registerTool("` sigue devolviendo exactamente 3
  registros: `consultar_politica`, `cuadrar_viaje`, `guardar_liquidacion`
  (`tools.ts:25,81,139`), los tres con `parameters: { type: 'object',
  properties: {}, additionalProperties: false }` — la regla estructural (el
  modelo decide CUÁNDO, nunca CON QUÉ DATOS) intacta.
- `src/lib/agents/registry.ts` — sin cambios (`git diff` vacío) — sigue
  siendo un único agente (`liquidacion`) con esas tres tools; `orchestrator`
  sigue sin ninguna.
- `processor.ts` creció 433 líneas esta ronda (barrera del XML, foto
  pendiente, corrección de fecha — todo intake/agéntico), pero el bloque que
  sí toca mi rubro —`registrarCosto({..., fase: faseDeModelo(res.model,
  'cuadre'), modelo: res.model, ...})`— es el MISMO código, solo desplazado
  de la línea 743 (ronda 8) a la 1018 hoy. Lo confirmé por los límites de los
  hunks del diff (`git diff 43ebf41..HEAD -- processor.ts`): el hunk que
  cierra antes de la línea 743 y el que abre después de la 841 no tocan ese
  rango — el desplazamiento es enteramente de código insertado ANTES, no una
  edición de esas líneas.
- `repo.ts` pasó de 17 a **22** funciones envueltas en `acotada()` (nuevas:
  `guardarFotoPendiente`, `existeFotoPendiente`, `reclamarFotoPendiente`,
  `corregirFechaGasto`, y una más) — ninguna de las nuevas la llama
  `tools.ts` (confirmado: sus únicos imports de `repo` siguen siendo
  `getViaje`, `getOperador`, `saveLiquidacion`, `getAcumuladoCombustible`).
  El intake nuevo de esta ronda no cruza a tool-calling.
- `src/lib/agents/run.ts` — `git diff` vacío, sin cambios. Verifiqué que
  `res.costUsd` en `processor.ts:1018` sí mapea a `res.cost` de
  `generateWithTools` (`run.ts:52`, `costUsd: res.cost`) — no es un campo
  fantasma, descarté la hipótesis de que el shift de líneas hubiera
  desalineado algo.
- Línea base propia, corrida hoy: `npx vitest run src/lib/llm/
  src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/normas/permiso_politica.test.ts` → **64 pruebas, 11
  archivos, 0 fallos**. Sin modificar ningún archivo del repo.

## Hallazgos

### [MEDIO] La atribución de costo/modelo tras fallback sigue etiquetando la fila completa con el modelo de la última ronda (REINCIDENTE, sin cambio de código — solo de línea)

`src/lib/llm/openrouter.ts:536-537` · `src/lib/cuadra/processor.ts:1018`
(antes 743) · `src/lib/cuadra/costos.ts:102`

Escenario: un ciclo de `cuadrar_viaje` corre 3 rondas en
`anthropic/claude-sonnet-5` ($2/$10 por 1M) y en la 4ª ronda el primario cae
(503) y el fallback `openai/gpt-5.6-terra` ($2.5/$15) responde el cierre.
`costo` (línea 536) suma correcto ronda a ronda al precio de cada una —
verificado que el número no está mal—, pero `used = res.model || activeModel`
(línea 537) solo sobrevive el modelo de la ÚLTIMA ronda. `processor.ts:1018`
escribe UNA fila en `llm_costo` con `modelo: res.model` = el slug del
fallback, y `faseDeModelo` (`costos.ts:102`, `if (modelo.includes('opus'))
return 'escalacion'`) clasifica el ciclo entero por ese único slug.

Consecuencia: quien reconcilie `llm_costo` contra la factura de OpenRouter
por proveedor no puede — una liquidación que se cobró 3/4 a Sonnet y 1/4 a
GPT queda archivada como "100% GPT-5.6-terra". Con Likida cobrando por
liquidación, es un problema de defensa de margen/reporting, no de que el
dinero se sume mal.

Causa raíz probable: `generateWithTools` devuelve un `model` de nivel de
ciclo cuando el ciclo pudo correr en dos proveedores distintos.

### [MEDIO] `ToolCallRecord.args` sigue sin describir qué args produjeron el `result` que trae (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:579-594`

Escenario: el modelo llama `guardar_liquidacion` con `{}` y, en la misma
ronda, otra vez con `{"confirmar":true}` (nada se lo impide: las tools no
llevan `strict:true`). `llaveDeCache` colapsa ambas a la llave
`"guardar_liquidacion"` porque `properties` está vacío. La segunda entrada de
`executed` (línea 594) queda con `args:{"confirmar":true}` pero `result` es
el que produjo el PRIMER llamador, cuyo `args` fue `{}`. Mismo patrón en
`crossRound` (línea 582): `args` es de la llamada de esta ronda, `result` es
de una ejecución de una ronda anterior.

Consecuencia: hoy ninguna — `guardia.ts` lee `.result`, no `.args`;
`processor.ts` no persiste `.args` en ningún log ni en `wa_conversacion`. El
día que alguien depure una discrepancia de dinero mirando
`ToolCallRecord.args`, o que una tool futura sí decida sobre datos, el
registro de auditoría apunta al llamador equivocado.

Causa raíz probable: la caché por nombre resuelve el `result` compartido
pero no reescribe (ni descarta) el `args` local de cada llamador antes de
empujarlo a `executed`.

### [BAJO] `cuadrar_viaje` y `consultar_politica` siguen sin una prueba que ejercite su handler real vía `executeTool` (REINCIDENTE, sin cambio)

`src/lib/cuadra/tools.ts:81-136` (cuadrar_viaje) · `tools.ts:25-76`
(consultar_politica)

Repetí la búsqueda hoy: `command grep -rn "executeTool('cuadrar_viaje'\|executeTool('consultar_politica'" src --include="*.test.ts"` no
encuentra nada. `tools_cableado.test.ts` (6 pruebas) sigue cubriendo solo
`guardar_liquidacion`, de forma genuina (genera el PDF real y lee los bytes).
`permiso_politica.test.ts` (9 pruebas) prueba el fix de AG-2 pero
**reconstruye a mano** la forma del resultado (línea 32-44 de ese archivo:
llama `normasDePolitica` directo) en vez de invocar
`executeTool('consultar_politica', {}, ctx)`.

Escenario concreto: si alguien invierte `periodo.estado !== 'holgado'`
(`tools.ts:117`, la condición que decide si el modelo puede citar
`rfa-2026-2.9`) a `===`, o invierte `NORMAS[id].estado !== 'sin_verificar'`
(línea 71) a `===`, las 1300+ pruebas del repo siguen en verde.

Consecuencia: la tool que decide qué norma fiscal sobre el tope de diésel en
efectivo puede citar el modelo frente al contralor, y la que decide si el
permiso de citar la política existe, son código sin arnés propio.

### [BAJO] `ctx.signal` sigue sin consumirse en ningún handler de tool (REINCIDENTE mitigado, sin cambio)

`src/lib/llm/tool-executor.ts:12-19` · `src/lib/cuadra/tools.ts` ·
`src/lib/cuadra/repo.ts` (ahora 22 funciones, antes 17) ·
`src/lib/cuadra/presupuesto.ts:101`

`command grep -rn "\.signal" src/lib/cuadra/tools.ts src/lib/cuadra/repo.ts`
sigue sin devolver nada. Las 22 funciones exportadas de `repo.ts` (subieron
de 17 a 22 esta ronda por el intake nuevo, ninguna de ellas usada por
`tools.ts`) siguen pasando por `acotada()`, con su propio
`AbortSignal.timeout(TOPE_CONSULTA_MS)` (8000ms, `presupuesto.ts:101`). El
riesgo práctico de "consulta colgada para siempre" sigue mitigado por ese
segundo mecanismo — pero sigue siendo un timeout que no se entera del
`AbortController` del turno completo (`run.ts:32`, 40s).

Consecuencia: si el turno se agota por timeout general, una consulta de
`repo.ts` en vuelo dentro de una tool no se cancela por esa vía — sigue su
propio reloj de 8s.

### [BAJO] `isTransientError` sigue con falso positivo por `5\d\d` dentro del texto de un error (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:73-80`

Mismo regex: `/\b(5\d\d|429|408|502|503|504)\b/.test(texto)` sobre el mensaje
completo. `openrouter_transitorio.test.ts` (5 casos, todos pasan hoy) sigue
sin un caso negativo con un `5xx` dentro de un error que NO es de proveedor.
Con el `saveLiquidacion` real (`repo.ts:479`,
`` throw new Error(`saveLiquidacion: ${error.message}`) ``), un error de
Postgres tipo `check constraint violada (monto=507.65)` o un folio duplicado
`FOLIO-502` clasificaría como transitorio y gastaría una llamada extra a otro
proveedor que va a fallar exactamente igual, porque el error es del dato, no
del proveedor caído.

### [BAJO] El error crudo de Postgres sigue viajando sin filtrar al contexto del modelo, incluso desde el propio cierre de la liquidación (REINCIDENTE, con ejemplo más directo que la ronda 8)

`src/lib/llm/tool-executor.ts:52-63` · `src/lib/llm/openrouter.ts:595` ·
`src/lib/cuadra/repo.ts:479`

`executeTool` mete `err.message` sin sanitizar en `ToolExecResult.error`, y
`generateWithTools` lo serializa tal cual en `content` del mensaje `role:
'tool'` (línea 595: `JSON.stringify({ error: exec.error })`). El ejemplo más
directo hoy: `guardar_liquidacion` (`tools.ts:181`) llama `saveLiquidacion`
sin envolverla en try/catch propio; si `repo.ts:479` lanza
`` `saveLiquidacion: ${error.message}` `` — el `.message` crudo de Postgres,
con nombres de columna, tabla o constraint —, ese texto entra sin filtro
directo al contexto del modelo en la MISMA tool que cierra el dinero del
viaje.

Consecuencia: nombres internos de la base pueden llegar al modelo y, de ahí,
a lo que narra por WhatsApp si la guardia de cifras no lo intercepta (solo
reemplaza el `reply` cuando `cuadrar_viaje` o `guardar_liquidacion` corrieron
— si `guardar_liquidacion` FALLA con esta excepción, ni siquiera llega a
producir un `liq` que dispare esa sustitución).

### [BAJO] El loop-guard sigue ejecutando la ronda 6 completa antes de tirar el resultado (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:528-604`

El `for` corre las 6 rondas completas —las tools de la ronda 6 se ejecutan,
se pagan y se empujan a `convo`— y solo DESPUÉS lanza `LoopGuardError` (línea
600), envuelto en `PartialExecutionError` con `executed`.
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1` sigue resolviendo el huérfano de cara al
operador; lo que se sigue perdiendo es la oportunidad de usar esa 6ª ronda
para intentar cerrar con lo que ya se tiene en vez de correr a ciegas hasta
el tope.

## Lo que revisé y está bien

- **La regla estructural sigue intacta en las tres tools, releída completa
  hoy**: `properties: {}` en `consultar_politica`, `cuadrar_viaje` y
  `guardar_liquidacion` (`tools.ts:31,87,146`); `tenantId`/`viajeId`/`operadorId`
  salen siempre de `ToolContext`, resuelto en servidor (`run.ts:33`), nunca
  de `args`. Ningún handler lee `_args`.
- **El fallback cross-provider tiene prueba, en ambos caminos que importan**:
  `openrouter_fallback_costo.test.ts` ejercita `generateWithTools` con un
  ciclo mixto primario+fallback (confirmé que sí monta tool_calls y no solo
  respuestas simples); `openrouter_transitorio.test.ts` cubre la
  clasificación de error transitorio para `generateResponse`/
  `generateStructured`. Ambos corrieron hoy, verdes.
- **La idempotencia de mutaciones bajo concurrencia real sigue sólida**:
  `tool_executor_concurrente.test.ts` (6 pruebas) — la caché por NOMBRE (no
  por args) en `makeExecutor` sigue siendo la decisión correcta dado que
  ninguna tool tiene parámetros.
- **La caché de lectura por nombre (`llaveDeCache`) sigue acertando** para
  las tres tools sin parámetros: `openrouter_cache_llave.test.ts` (3
  pruebas) verde.
- **Aislamiento por tenant intacto**, releído hoy: `getViaje` (`repo.ts:41,50`),
  `getOperador` (`:68,73`) y `saveLiquidacion` (`p_tenant`, `:466`) filtran
  por `tenant_id` en cada consulta que toca una tool.
- **Ningún cambio de esta ronda cruza hacia `tools.ts`/`openrouter.ts`**: las
  cuatro funciones nuevas de `repo.ts` (foto pendiente, corrección de fecha)
  son consumidas por `processor.ts`/`intake/`, no por ninguna tool del LLM —
  confirmado por los imports de `tools.ts`, sin cambios.
- **El costo se acumula por ronda al precio de quien respondió esa ronda**
  (no del modelo activo al final) — el número es correcto; lo que no lo es
  es la ATRIBUCIÓN del `modelo` en la fila (hallazgo de arriba).

## Lo que NO alcancé a revisar

- **`finish_reason:'length' con `tool_calls` NO vacío.** La comprobación de
  truncamiento en el ciclo de tools (`openrouter.ts:548`) solo corre en la
  rama `!calls || calls.length === 0`. Si el modelo se queda sin presupuesto
  a media emisión de una lista de tool_calls (plausible con `reasoning:
  'high'` y el techo compartido que ya causó el bug de AUDITORÍA 4), el
  código no lo detecta como truncamiento. Investigué el peor caso concreto
  —JSON de argumentos truncado— y no encontré una forma de que eso corrompa
  datos: como las tres tools tienen `properties: {}`, `JSON.parse` de un
  argumento truncado falla y cae en el `catch` de `openrouter.ts:576`
  (`args_parse`), que NO ejecuta el handler — falla cerrado. No pude
  descartar el caso de una lista de tool_calls incompleta (el modelo quería
  llamar dos tools y solo una llegó completa) sin pegarle a la API real; no
  until convertí esto en un escenario con valores concretos, así que no lo
  reporto como hallazgo.
- **Nada contra la API real de OpenRouter** — mismo límite que rondas
  anteriores.
- **Con qué frecuencia el modelo real emite `arguments` no-vacíos** para las
  tres tools — sin `strict:true` en sus schemas, no medí la tasa contra el
  proveedor real.
- **`tool_calls` en streaming** — el cliente lo sigue sin usar.
- **Prompt caching** (`cache_control`) — sigue en cero.
- **El texto real que un modelo de producción escribiría** dado el `.nota`
  crudo de `cuadrar_viaje`/`guardar_liquidacion` en su contexto — verifiqué
  la ruta estructural (la guardia de cifras siempre reemplaza el `reply`
  cuando esas tools corrieron con éxito), no corrí el modelo real.
