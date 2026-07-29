# Tool calling — auditoría 6

**Nota: 8/10** (antes 7). Razón del movimiento: **se atacó y subió**. El único
ALTO que quedaba abierto —la idempotencia falsa bajo `Promise.all`— está
CERRADO, y lo verifiqué de dos formas independientes: importando el módulo
real y disparando concurrencia de verdad con `Promise.all` (sin mocks), y
leyendo el archivo nuevo `tool_executor_concurrente.test.ts` (6 casos, todos
con `Promise.all` real, no secuenciales disfrazados). Además se cerraron tres
MEDIO de la ronda 5: las dos instrucciones de OCR que faltaban en el prompt
(`producto`, `cfdi_uuid`), la prueba que no cubría la dirección real del bug
de `flete`, y la paginación de `getAcumuladoCombustible`. La regla
estructural —ninguna tool acepta datos del modelo— la reverifiqué en las tres
tools y no se registró ninguna tool nueva.

Lo que impide el 9: un MEDIO reincidente (atribución de costo tras fallback,
4ª mención sin cambio), un puñado de BAJO reincidentes sin cambio, y un
hallazgo nuevo — de baja severidad pero es literalmente la pregunta de esta
ronda — sobre lo que el propio arreglo de la idempotencia abrió: el registro
de auditoría (`ToolCallRecord.args`) ya no siempre corresponde al resultado
que produjo. Y `cuadrar_viaje`/`consultar_politica` —las dos tools de
lectura, la primera con lógica fiscal (`rfa-2026-2.9`)— siguen en CERO
pruebas directas, 4ª ronda consecutiva, aunque la tool de mayor riesgo
(`guardar_liquidacion`, la que escribe dinero) ya tiene cobertura real de
bytes de PDF.

---

## La pregunta de la ronda: ¿qué abrió el arreglo de la idempotencia?

**Verificado, no solo leído.** Repliqué el escenario exacto de la ronda 5
—dos llamadas concurrentes a una mutación con args distintos, vía
`Promise.all` real, sin mocks— importando `tool-executor.ts` con `tsx`:

```
=== TEST 1: 2 concurrentes, args distintos ===
calls (veces que corrio el handler): 1
maxConcurrentes en vuelo a la vez: 1
args que vio el handler: [ '{}' ]
r1: {"success":true,"result":{"n":1,"argsRecibidos":{}},"durationMs":52}
r2: {"success":true,"result":{"n":1,"argsRecibidos":{}},"durationMs":52}
r1 === r2 (misma promesa)? true
```

`tool-executor.ts:94-121` (`makeExecutor`): la promesa se registra en el
`Map` (`:110-111`) ANTES del `await` (`:112`), así que el segundo llamador
concurrente encuentra la caché ya poblada (`:106-107`) y nunca ejecuta el
handler. El handler corrió UNA vez con los args del PRIMER llamador; el
segundo recibió el mismo resultado sin que sus propios args (`{confirmar:
true}` en mi prueba) tocaran nunca el handler. Esto **es correcto** porque
—y solo porque— los tres handlers registrados ignoran `args` por completo
(`tools.ts:34`, `:52`, `:111`, todos `_args`): los efectos son idénticos
sin importar qué args lleguen. El propio código lo dice
(`tool-executor.ts:97-104`): *"Si algún día una tool sí decide sobre datos,
esta llave tiene que volver a incluirlos"*.

El repo ya tiene la prueba que yo reproduje a mano:
`src/lib/llm/tool_executor_concurrente.test.ts` (añadido en el mismo commit
que cerró el ALTO, `fa03b005`, hoy). Van más allá de mi repro: prueban args
distintos en paralelo, args idénticos en paralelo, tres en paralelo más una
cuarta después, un fallo que no se cachea, y el caso más fino —**dos fallos
EN PARALELO** que comparten la ejecución (`ejecuciones` queda en 1, ambos
`success:false`) **sin envenenar la caché** (un tercer intento sí corre y
tiene éxito). Los 6 pasan:

```
✓ src/lib/llm/tool_executor_concurrente.test.ts (6 tests) 38ms
```

**Lo mismo pasa en la otra capa.** `openrouter.ts:442-454` (`llaveDeCache`)
hace que `inRound` (línea `:561`, se recrea CADA ronda) y `crossRound`
(persiste TODO el ciclo) colapsen por NOMBRE cuando el schema no declara
`properties` — que es el caso de las tres tools de Likida hoy. Confirmado
con la prueba del repo `openrouter_cache_llave.test.ts` (3 rondas con
`{}`, `{"viaje_id":"v1"}`, `{"incluir_periodo":true}` → 1 ejecución, 0 antes
del arreglo), que también pasa. Así que la protección es de DOS capas: si el
modelo emite dos `guardar_liquidacion` en la MISMA ronda con args distintos,
`inRound` los junta ANTES de que `tool-executor.ts` los vea siquiera.

**Lo que sí abrió el arreglo — y es lo que reporto abajo como hallazgo
nuevo:** antes del arreglo, la caché casi NUNCA acertaba (0 de 3 en la
medición de la ronda 5), así que cada llamada ejecutaba con sus propios
args y el registro de auditoría (`args` junto a `result`) siempre era fiel,
aunque desperdiciara trabajo. Ahora que la caché acierta de forma fiable,
CADA vez que dos llamadas colisionan, el registro de la llamada perdedora
queda con SUS args (los que el modelo mandó) pegados al resultado de la
OTRA ejecución. El arreglo cambió "nunca miente porque nunca junta" por
"siempre junta y a veces miente en el registro, nunca en el dinero".

---

## Verificación de los abiertos de la ronda 5

| # | Hallazgo de la ronda 5 | Hoy |
|---|---|---|
| ALTO | Idempotencia falsa bajo `Promise.all` | **CERRADO**, verificado empíricamente (arriba) y con `tool_executor_concurrente.test.ts` (6 casos, incluye fallos concurrentes). |
| MEDIO | `producto`/`cfdi_uuid` sin instrucción en el prompt de OCR | **CERRADO.** Barrí los 20 campos del esquema (`ocr.ts:28-65`) contra el `SYSTEM` (`:67-103`) con un script: los 20 aparecen nombrados, incluidos `producto` (`:86`) y `cfdi_uuid` (`:87`), añadidos en el commit `fa03b005` de hoy (confirmado con `git blame`). |
| MEDIO | La prueba de `flete` no cubre la dirección en que ocurrió el bug | **CERRADO.** `conceptos_coinciden.test.ts:35-53` añadió *"y AL REVÉS"* (todo concepto del prompt existe en el esquema) y una prueba adicional (`:55-82`) que barre TODOS los campos del esquema —no solo `concepto`— contra el prompt. Las 6 pruebas del archivo pasan. |
| MEDIO | Caché de lectura se anula con cualquier variación de `arguments` | **CERRADO.** `llaveDeCache` (`openrouter.ts:442-454`) colapsa por nombre cuando el schema no declara parámetros; `openrouter_cache_llave.test.ts` pasa (3 rondas, args distintos, 1 ejecución). |
| MEDIO | `getAcumuladoCombustible` sin paginación | **CERRADO.** `repo.ts:528-576`: pagina con `.range()`, usa `count` de PostgREST, corta a `MAX_PAGINAS=100` con aviso. |
| MEDIO | Costo se reparte bien y se etiqueta mal tras fallback | **REINCIDENTE, sin cambio (4ª mención).** `processor.ts:619` sigue grabando UNA fila con `modelo: res.model` (el de la ÚLTIMA ronda) aunque `costo` (openrouter.ts:532) sí sume ronda a ronda al precio correcto de cada una. |
| BAJO | `isTransientError` falso positivo con `5\d\d` en el texto | **REINCIDENTE, sin cambio.** `openrouter.ts:74`, mismo regex. |
| BAJO | Mensaje crudo de Postgres al contexto del modelo | **REINCIDENTE, sin cambio.** `tool-executor.ts:56-62` → `openrouter.ts:556`. |
| BAJO | Loop-guard ejecuta la ronda 6 y la tira | **REINCIDENTE, sin cambio.** `openrouter.ts:524-559`; `CUADRA_RECUPERAR_CIERRE_PARCIAL=1` sigue activo en `.env.local:34`. |
| BAJO | `ctx.signal` muerto · `tools.ts` sin pruebas | **PARCIAL.** Ver hallazgo abajo: la mutación ya tiene prueba real; las dos tools de lectura no. |

---

## Hallazgos

### [MEDIO] El registro de auditoría (`ToolCallRecord.args`) miente sobre qué args produjeron un resultado — y el propio arreglo de la idempotencia lo volvió el caso común, no el raro

`src/lib/llm/openrouter.ts:568-591`

```ts
575   const key = llave(call.function.name, args);
576   if (isReadOnly(call.function.name) && crossRound.has(key)) {
577     const c = crossRound.get(key)!;
578     executed.push({ toolName: call.function.name, args, result: c.result, ... });
       ...
581   let p = inRound.get(key);
582   if (!p) { p = opts.toolExecutor(call.function.name, args); inRound.set(key, p); }
583   const exec = await p;
       ...
590   executed.push({ toolName: call.function.name, args, result: exec.result, ... });
```

En AMBAS ramas, `args` es la variable LOCAL de ESTA llamada (lo que el
modelo mandó en el wire para ESTE `tool_call_id`), pero `result` viene de
`c`/`exec` — la ejecución COMPARTIDA, que corrió con los args del llamador
que llegó primero. Para tools sin parámetros (las tres de Likida hoy), esto
pasa cada vez que el modelo repite una tool, no solo bajo carrera real.

**Escenario con valores.** El modelo, cerrando un viaje, emite en la MISMA
ronda `guardar_liquidacion` con `{}` y luego, por lo que sea (reintento de
su propio razonamiento), otra vez con `{"confirmar":true}`. `inRound` los
junta (`llaveDeCache` da `key="guardar_liquidacion"` para ambas). El
`executed` que sale de `generateWithTools` trae DOS entradas:
`{args:{}, result:{liquidacion_id:"L-1"}}` y
`{args:{"confirmar":true}, result:{liquidacion_id:"L-1"}}` — la segunda
afirma que esos args produjeron ese resultado, y no es cierto: el handler
nunca vio `{"confirmar":true}`.

**Consecuencia hoy: ninguna que cambie una cifra.** Verifiqué los tres
consumidores de `toolCalls`/`ToolCallRecord`:
- `guardia.ts:37,40,63` usa `.some()`/`.filter().map(t=>t.result)` — no le
  importa el `args`, y un `result` duplicado no cambia el veredicto.
- `processor.ts:617,621` usa `.some()`/`.find()` sobre `toolName` y lee
  `.result` — no lee `.args`.
- `processor.ts:625` solo persiste `tools: res.toolCalls.map(t=>t.toolName)`
  en el log — los `args` nunca salen de la memoria de ese turno.

Así que hoy es un defecto latente: nadie confía en `.args` todavía. Lo
reporto porque es exactamente lo que pide la ronda ("compartir una promesa
es peligroso si los efectos no son idénticos") y porque el arreglo cambió
la frecuencia del fenómeno de "casi nunca" (antes, con la llave vieja, la
caché acertaba 0 de 3 según la medición de la ronda 5: cada llamada corría
con SUS propios args, así que el registro nunca podía mentir) a "cada vez
que hay una repetición en la misma ronda o entre rondas". El día que un
`ToolCallRecord.args` se use para depurar una discrepancia de dinero —o que
una tool futura sí lea args— este registro va a apuntar al llamador
equivocado.

---

### [MEDIO] La atribución de costo tras fallback sigue etiquetando la fila completa con el modelo de la última ronda (REINCIDENTE, 4ª mención, sin cambio)

`src/lib/llm/openrouter.ts:532-533` · `src/lib/cuadra/processor.ts:619` ·
`src/lib/cuadra/costos.ts:101-104`

```ts
532  costo += calcCost(activeModel, rIn, rOut);   // correcto: suma ronda a ronda
533  used = res.model || activeModel;             // pero solo queda el de la ÚLTIMA
...
619  await registrarCosto({ ..., fase: faseDeModelo(res.model, 'cuadre'), modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.costUsd });
```

`costo` suma bien (verificado leyendo `openrouter_fallback_costo.test.ts`,
que SÍ cubre la suma por ronda y pasa), pero `registrarCosto` escribe UNA
fila con UN `modelo` para tokens que pudieron cobrarse a dos tarifas
distintas si el ciclo cruzó a fallback a medio camino. Mismo hallazgo que
la ronda 5, mismas líneas, sin cambio: quien reconcilie `llm_costo` contra
la factura de OpenRouter por modelo no puede, porque la fila no dice cuánto
de esos tokens fue de cada proveedor. `faseDeModelo` (`costos.ts:102`)
también clasifica el ciclo entero por el slug de la ÚLTIMA respuesta.

---

### [BAJO] `cuadrar_viaje` y `consultar_politica` siguen en CERO pruebas directas — 4ª ronda consecutiva — mientras `guardar_liquidacion` ya tiene cobertura real (MEJORÓ, no cerró)

`src/lib/cuadra/tools.ts:25-98` · `src/lib/cuadra/tools_cableado.test.ts`

Búsqueda igual que rondas anteriores, dos formas: `find src -iname
"tools*.test.ts"` → ahora SÍ hay uno, `tools_cableado.test.ts`. Pero
`command grep -n "'cuadrar_viaje'\|'consultar_politica'" src --include=
"*.test.ts"` solo encuentra usos como STUB (nombres de tool falsos para
probar `guardia.ts` u `openrouter.ts`), nunca una llamada real a
`executeTool('cuadrar_viaje', ...)` contra el handler de `tools.ts`.

Lo que SÍ mejoró, y es genuino: `tools_cableado.test.ts` prueba
`guardar_liquidacion` —la única mutación, la que escribe dinero— pasando
por `executeTool` de verdad, generando el PDF de verdad, inflando los
streams del PDF subido y leyendo el texto (no espiando el argumento de la
llamada, que es justo el estilo de prueba que la ronda 4 mostró que se
puede mutar sin que nada falle). Las 6 pruebas de ese archivo pasan y
cubren el caso concreto que motivó su creación (M19: el PDF del operador no
debe traer lo que el operador no puede arreglar).

Pero el handler de `cuadrar_viaje` (`tools.ts:52-98`) —el `try/catch`
alrededor de `getAcumuladoCombustible`, el push condicional de
`rfa-2026-2.9` a `fundamentos` cuando `periodo.estado !== 'holgado'`
(`:79`), y la forma exacta de `combustible_efectivo_ejercicio` que llega al
modelo (`:86`)— sigue sin una sola aserción directa. Es la tool que decide
qué norma fiscal puede citar el modelo sobre el tope de combustible en
efectivo; si su lógica se rompe, nada en la suite lo nota.

**Escenario:** alguien invierte por accidente la condición de `:79` (de
`periodo.estado !== 'holgado'` a `===`). Las 990 pruebas siguen verdes
—ninguna ejercita esa línea—, y el modelo deja de poder citar
`rfa-2026-2.9` justo cuando la flota SÍ va cerca del tope del 15%, o
empieza a citarla siempre, incluida cuando va holgada.

---

### [BAJO] `ctx.signal` sigue sin consumirse, pero el riesgo que describía ya no es indefinido (REINCIDENTE, mitigado)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:33` ·
`src/lib/cuadra/repo.ts:45-73` · `src/lib/cuadra/presupuesto.ts:99`

`command grep -rn "signal" src/lib/cuadra/presupuesto.ts src/lib/cuadra/
repo.ts src/lib/cuadra/tools.ts` da UNA línea, `presupuesto.ts:157` (la
fábrica del signal para OCR) — ni `tools.ts` ni `repo.ts` consumen
`ctx.signal`. Sigue siendo cierto que si el `AbortController` de
`runAgent` dispara a los 40s, la llamada al modelo se corta pero una
consulta de `repo.ts` en vuelo no se entera por esa vía.

Lo que cambió desde la ronda 5 y baja el riesgo práctico: las 17 funciones
exportadas de `repo.ts` ahora pasan por `acotada()` (`repo.ts:45-73`), que
les impone SU PROPIO `AbortSignal.timeout(TOPE_CONSULTA_MS)`
(`presupuesto.ts:99`, default 8000ms, verificado `17` funciones ↔ `17`
llamadas a `acotada(` con `command grep -c`). No es el mismo mecanismo que
`ctx.signal` —cada query tiene su propio reloj, no el del turno completo—,
pero ya no existe el escenario "la función se abortó a los 40s y una
consulta sigue viva indefinidamente": el techo real de cualquier consulta
individual es 8s, con o sin `ctx.signal`. Sigue siendo deuda arquitectónica
(dos mecanismos de timeout que no se hablan) y no un hallazgo de "esto
puede colgarse para siempre".

---

### [BAJO] `isTransientError` sigue dando falso positivo con `5\d\d` en el texto (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:73-76`

Mismo regex desde la ronda 4: `/\b(5\d\d|429|408|502|503|504)\b/` sobre el
mensaje completo (y ahora también `err.cause`, `:69-72`). Un error de
`saveLiquidacion: check constraint violada (monto=507.65)` o un folio
duplicado `502` siguen clasificando como transitorio y gastando una
tercera llamada a otro proveedor que va a fallar igual.
`openrouter_transitorio.test.ts` sigue sin un caso negativo con `5xx` en el
texto de un error NO transitorio.

---

### [BAJO] El error crudo de Postgres sigue viajando al contexto del modelo (REINCIDENTE, sin cambio)

`src/lib/llm/tool-executor.ts:56-62` · `src/lib/llm/openrouter.ts:556`

`executeTool` mete `err.message` sin filtrar en el resultado, y se
serializa como `content` del mensaje `role:'tool'`. Nombres de función,
tablas y UUIDs internos de Postgres siguen pudiendo llegar al modelo y de
ahí, potencialmente, a lo que narra por WhatsApp.

---

### [BAJO] El loop-guard sigue ejecutando la ronda 6 y tirando el resultado (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:524-559`

El `for` completa la ronda 6 —las tools corren, se pagan, se empujan a
`convo`— y LUEGO lanza `LoopGuardError`. `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`
sigue activo (`.env.local:34`), así que el huérfano de cara al operador
sigue resuelto; lo que se sigue tirando es trabajo pagado (hasta 4 lecturas
a Postgres) dentro de un presupuesto acotado.

---

## Lo que revisé y está bien

- **La regla estructural se sostiene, reverificada en las tres tools.**
  `consultar_politica` (`tools.ts:25-38`), `cuadrar_viaje` (`:43-98`) y
  `guardar_liquidacion` (`:101-151`) siguen con
  `parameters:{type:'object',properties:{},additionalProperties:false}` y
  los tres handlers reciben `_args` sin usarlo. `registry.ts` sigue con
  exactamente los mismos dos agentes y las mismas tres tools que la ronda
  5 — **no se registró ninguna tool nueva**, así que no hay superficie
  nueva que pudiera romper la regla.
- **La idempotencia de mutaciones es robusta bajo concurrencia real**,
  verificado por mí (`tsx`, sin mocks, `Promise.all` real) y por el propio
  repo (`tool_executor_concurrente.test.ts`, 6 casos incluyendo dos fallos
  paralelos que no envenenan la caché).
- **La caché de lectura acierta de verdad ahora**, entre rondas y dentro de
  la misma ronda, para tools sin parámetros, con prueba propia
  (`openrouter_cache_llave.test.ts`) que también prueba que una tool CON
  parámetros de verdad sigue cacheándose por args (`get_algo`, dos ids
  distintos → dos ejecuciones).
- **El prompt de OCR ya no tiene campos huérfanos.** Barrido programático
  de los 20 campos del esquema contra el `SYSTEM`: los 20 aparecen
  nombrados con instrucción, incluidos `producto` y `cfdi_uuid`.
- **`conceptos_coinciden.test.ts` cierra las DOS direcciones** del bug de
  `flete` (esquema→prompt y prompt→esquema) y además generaliza a los 20
  campos del esquema, no solo al enum de `concepto`.
- **`getAcumuladoCombustible` pagina de verdad**: `.range()`, `count` de
  PostgREST, corte explícito a `MAX_PAGINAS=100` con log.
- **`guardar_liquidacion` tiene la prueba más honesta que he visto en este
  rubro**: genera el PDF real, sube a un storage falso, INFLA los streams
  comprimidos y lee el texto — no espía argumentos de llamada, que es el
  estilo de prueba que la ronda 4 demostró que se puede mutar sin fallar.
- **Aislamiento por tenant intacto**: `getViaje`, `getOperador`,
  `getAcumuladoCombustible` y `getConfig` siguen filtrando por `tenant_id`
  además del id de fila (releído, sin cambio desde la ronda 5).
- **Fallback no re-ejecuta mutaciones**: el reintento de `complete()`
  (`openrouter.ts:511-520`) sigue ocurriendo ANTES de que las tools
  corran (`:563`); estructuralmente sin cambio.
- **Línea base intacta**: corrí `src/lib/llm/*`, `tools_cableado.test.ts` y
  `conceptos_coinciden.test.ts` — **61 pruebas, 11 archivos, 0 fallos**. No
  modifiqué ningún archivo del repo; todo lo de arriba se verificó
  importando los módulos reales desde `/private/tmp/.../scratchpad` con
  `tsx` y con una config de Vitest aislada fuera del repo.

---

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** No pude hacer que `vi.mock('openai', ...)`
  interceptara desde un archivo de prueba fuera de `src/` (dos configuraciones
  de Vitest distintas, ambas con la misma alias de `@`, terminaron pegándole
  a `https://openrouter.ai` de verdad y devolviendo 401 con la key falsa —
  nunca llegó a cobrar nada, pero tampoco reprodujo el mock). Por eso el
  hallazgo del registro de auditoría (`args`/`result` desalineados) queda
  apoyado en lectura de código determinista —dos `Promise.all` sobre un
  `.map()` async, sin ninguna ambigüedad de orden de ejecución en JS de un
  solo hilo— y no en una corrida en vivo contra `generateWithTools`. La
  lógica en juego es síncrona hasta el primer `await`, así que no hay
  condición de carrera que dependa del proveedor real; aun así, es lectura,
  no medición, y lo marco así.
- **Con qué frecuencia el modelo real emite `arguments` distintos de `{}`.**
  Sigue sin `strict:true` en los schemas de tools (`tools.ts:31,49,108`
  contra el único `strict:true` del repo, `openrouter.ts:286`, para el
  OCR). Con el arreglo de esta ronda, esto YA NO decide si hay doble
  ejecución (la llave por nombre lo cierra), pero sí decide con qué
  frecuencia el registro de auditoría queda con args desalineados del
  hallazgo de arriba. No medí la tasa contra el proveedor real.
- **`max-rows` real de PostgREST** para calibrar si `MAX_PAGINAS=100` deja
  algún margen o es exactamente el borde.
- **`tool_calls` en streaming.** El cliente sigue sin usarlo; si se
  enciende, hay que rehacer el análisis de `openrouter.ts:524-559` entero.
- **Prompt caching**: sigue en cero `cache_control` en el repo. No lo
  cuantifiqué esta ronda tampoco.
