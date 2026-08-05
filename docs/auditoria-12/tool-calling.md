# Tool calling — auditoría 12

**Nota: 8/10** (ronda 10: 8/10, sin movimiento de nota). La vara sigue siendo:
¿el sistema solo ejecuta lo que puede ejecutar, con los datos que el LLM NUNCA
decide, y un error de proveedor nunca se ve como un error del negocio? 10 =
ningún camino entre "el modelo pide algo" y "el sistema lo corre" puede romper
dinero o filtrar datos internos. 8 = la regla estructural está intacta y
probada, pero quedan huecos de robustez/observabilidad que un día van a doler,
no hoy.

La nota no se mueve porque lo que se pagó esta ronda es deuda de la ronda 10
—seis de siete MEDIO/BAJO cerrados y verificables en el código actual, incluida
la prueba `openrouter_registro_args.test.ts` que el encargo de la ronda 10 pedía
y no existía—, y lo que apareció es un riesgo NUEVO en el camino de fallback del
rol más importante (el cuadre), del mismo tamaño que lo ya señalado: no rompe
hoy, pero es exactamente el camino que el demo de mañana va a pisar si
Anthropic parpadea.

## Qué se auditó y con qué evidencia

- `src/lib/llm/openrouter.ts` (825 líneas) — releído completo, con
  reproducciones propias (abajo).
- `src/lib/llm/tool-executor.ts` (174 líneas) — releído completo, incluidos los
  comentarios de deuda documentada de la ronda 10.
- `src/lib/cuadra/tools.ts` (212 líneas) — releído completo: los tres
  `registerTool(` en 24/81/139.
- `src/lib/agents/run.ts` (70) y `src/lib/agents/registry.ts` (24) — releídos.
- `src/lib/llm/models.ts` — releído (defaults, overrides, ROLE_PARAMS).
- `src/lib/cuadra/costos.ts` — releído completo (registrarCosto, faseDeModelo,
  vincularCostosALiquidacion).
- `src/lib/cuadra/processor.ts:1820-1880` — el consumo de `costoPorModelo` y la
  rama de cierre parcial.
- `src/lib/cuadra/intake/ocr.ts:200-320` — el consumidor de `generateStructured`
  con señal.
- Los 16 archivos de prueba de `src/lib/llm/` + `tools_cableado`,
  `tools_camino_real`, `permiso_politica`, `por_diferencia`.
- `git diff 56c267a..HEAD -- src/lib/llm src/lib/cuadra/tools.ts src/lib/agents`
  → **vacío**: el código de tool-calling es byte-idéntico al que se publicó en
  la ronda 10 (el único commit nuevo, `ce9abab`, es la migración RLS 0078, de
  otro rubro).

Corridas propias:
```
$ npx vitest run src/lib/llm/            → 16 archivos, 73 pruebas, 0 fallos
$ npx vitest run tool-executor tool_executor_concurrente tools_cableado \
      tools_camino_real permiso_politica por_diferencia → 44 pruebas, 0 fallos
$ npx tsc --noEmit -p .                  → limpio
$ npx eslint src/lib/llm/ src/lib/cuadra/tools.ts src/lib/agents/ → limpio
```

Reproducción propia (script temporal, borrado al terminar): **el body que recibe
el fallback no-Anthropic del rol `cuadre` lleva el bloque `cache_control` de
Anthropic en el system** — ver [MEDIO-1] abajo.

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools
(`tools.ts:31,87,146`), `tenantId`/`viajeId`/`operadorId` saliendo solo de
`ToolContext` resuelto en servidor (`run.ts:29-31`), los handlers ignorando
`_args`— sigue intacta, verificada en el código actual y probada por
`tools_cableado`/`tools_camino_real`.

### ALTO

Ninguno nuevo. El ALTO de la ronda 10 (`FALLBACK` sin entrada para
`gemini-3.1-flash-lite`) sigue cerrado: la entrada vive en `openrouter.ts:63`,
la prueba `openrouter_fallback_ocr.test.ts` la fija con el override real de
producción, y `modelosAisladosDeFallback()` + `openrouter_fallback_cobertura
.test.ts` cierran la CLASE entera (todo `PRICES` está en la red de respaldo).

### MEDIO

#### [MEDIO, abierto — riesgo en el camino del demo] El bloque `cache_control` de Anthropic viaja al fallback no-Anthropic del rol `cuadre`

`src/lib/llm/openrouter.ts:666-672` (el system se arma UNA vez, desde el modelo
PRIMARIO) · `:711-714` (el fallback cambia `activeModel` pero reusa `convo`) ·
`:66` (`'anthropic/claude-sonnet-5': 'openai/gpt-5.6-terra'`).

Escenario con valores: el rol `cuadre` corre en `anthropic/claude-sonnet-5`.
`soportaCache = /anthropic\//.test(model)` → true, y `sistema` queda como
`{ role: 'system', content: [{ type: 'text', text, cache_control: { type:
'ephemeral' } }] }`. En la ronda 3, Anthropic devuelve 503; `complete()` mueve
`activeModel = 'openai/gpt-5.6-terra'` y reintenta con el MISMO `convo`. Lo
reproduje con el SDK mockeado: la llamada al fallback lleva
`model: 'openai/gpt-5.6-terra'` y `messages[0].content` como ARRAY con
`cache_control: {type:'ephemeral'}` — una extensión de Anthropic que el tipo
del SDK de OpenAI no contempla (por eso el `as any` de la línea 669) y que
OpenAI no documenta en sus content parts.

El comentario de la línea 663-664 dice "un modelo que no la entienda la ignora —
no rompe". Para el caso PRIMARIO no-Anthropic es cierto (el system va como
string plano). Para el caso FALLBACK no está verificado contra API real: si
OpenRouter traduce y descarta el campo, funciona; si lo reenvía tal cual a
OpenAI y este lo rechaza con 400, **el fallback del rol que orquesta dinero
muere en el primer parpadeo de Anthropic** — el ciclo se cae con `PartialExecutionError` y el operador recibe "se me trabó", exactamente lo que el
fallback existe para evitar.

Estado: abierto. Ninguna prueba cubre primario-Anthropic + fallback-OpenAI:
`cache_prompt.test.ts` solo prueba (1) primario Anthropic sin fallback, (2) que
los mensajes variables no se marcan, y (3) primario NO-Anthropic (system en
string plano). El camino (1)+(fallback OpenAI) no tiene test ni verificación
viva. Cuesta un cambio chico cerrarlo: reconstruir `sistema` sin el bloque
cuando `activeModel` deja de ser Anthropic — o una prueba contra OpenRouter real
antes del demo.

### BAJO

#### [BAJO, abierto — latente] `isTransientError` sigue con falso positivo para 5xx DESNUDOS y decimales con coma

`src/lib/llm/openrouter.ts:121-122` (regex `(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b`).

La corrección de la ronda 10 cubrió `FOLIO-502`, `$502` y `503.00` (decimal con
punto). Verifiqué con node lo que NO cubre:

```
'el gasto 502 no existe'            → true (falso positivo)
'viaje 502 ya liquidado'            → true
'el tenant 502 tiene problemas'     → true
'monto 502,30 excede el tope'       → true (coma decimal, formato es-MX)
'Error 502: Bad Gateway'            → true (correcto)
```

HOY no es alcanzable desde el código: `isTransientError` solo recibe errores del
SDK (`openrouter.ts:286,499,711`); los errores de negocio van por `executeTool`
→ `mensajeParaElModelo`, que no pasa por esta función. Es un riesgo latente de
la misma clase que la ronda 10 cerró: el día que alguien la reutilice en otro
punto (o un error de negocio se envuelva como `cause` de un error del SDK), un
dato del negocio vuelve a cruzar el fallback de proveedor. Los tests
(`openrouter_transitorio.test.ts`) no traen el caso del número desnudo ni el de
la coma decimal.

#### [BAJO, abierto — sin prueba] `mensajeParaElModelo` no tiene ni un test, y deja pasar mensajes PostgREST fuera del vocabulario

`src/lib/llm/tool-executor.ts:82-87` (regex `VOCABULARIO_POSTGRES`), aplicada en
`:113`. `grep -rln "mensajeParaElModelo\|VOCABULARIO_POSTGRES\|error interno de
datos" src --include="*.test.ts"` → **cero archivos**. Verifiqué con node qué se
cuela:

```
'new row violates row-level security policy for table "gasto"'  → filtrado (correcto)
'function resumen_costo_ia_tenant(character varying) does not exist' → PASA CRUDO
```

Escenario con valores: la migración 0064 no aplicada (o una RPC renombrada)
hace que `traerResumenCostoIaTenant` falle con `function
resumen_costo_ia_tenant(p_tenant, p_desde, p_hasta) does not exist`; si ese
error viaja por una tool, el nombre interno de la función (y su firma) llega al
modelo tal cual. No es dinero ni PII — pero es el mismo criterio que el repo ya
aplica ("no exponer lo interno", `guardiaFundamento`, `redactarTexto`) y la
función que lo implementa no está anclada por ninguna prueba: un refactor del
regex no tiene red.

#### [BAJO, abierto — latente] `JSON.stringify(exec.result)` produce `content: undefined` si un handler de éxito devuelve `undefined`

`src/lib/llm/openrouter.ts:815` — `content: JSON.stringify(exec.success ?
exec.result : { error: exec.error })`. Si algún día un handler de tool devuelve
`undefined` con éxito, `JSON.stringify(undefined)` es `undefined` y el mensaje
`role: 'tool'` queda sin `content` — el SDK de OpenAI rechaza eso con 400 y el
ciclo entero muere. Hoy los tres handlers devuelven objeto (`tools.ts:64,110,
180`), así que es latente; un `result ?? null` en esa línea lo cierra.

#### [BAJO, abierto — deuda conocida, documentada] `ctx.signal` sigue sin consumirse en ningún handler

`grep -n "\.signal" src/lib/cuadra/tools.ts src/lib/cuadra/repo.ts` → sin
matches, igual que en la ronda 10. La deuda está documentada con su análisis en
`tool-executor.ts:19-40` (enhebrarlo bien es cambio de backend, no de
tool-calling) y el mitigante sigue activo: cada consulta de `repo.ts` muere sola
a `TOPE_CONSULTA_MS`+`GRACIA_TOPE_MS` vía `acotada()` (`presupuesto.ts:148`).
Lo que el mitigante no cubre —una consulta en vuelo que sigue hasta su propio
tope cuando el turno ya expiró— se mantiene igual.

#### [BAJO, abierto — observación de costo, deliberada] `generateStructured` gasta un intento pagado en el proveedor muerto antes de cruzar al fallback

`src/lib/llm/openrouter.ts:494-503`. Cuando `e1` es transient (provider caído),
el código reintenta `attempt(model, note)` —el MISMO proveedor— y solo cruza al
fallback si `e2` también falla. La propia prueba `openrouter_fallback_ocr
.test.ts` lo codifica: 3 llamadas, 2 al proveedor muerto. El reintento con nota
existe para errores de FORMATO, no para caídas; en una caída real son dos
llamadas pagadas (o tres, si la de la nota responde con JSON malo) antes del
plan B. No es un bug — está probado y comentado—, pero es la misma observación
que la ronda 10 dejó anotada: el costo del caso "proveedor caído" es el doble
de lo que necesitaría.

#### [BAJO, abierto — menor] `registerTool` ante re-registro solo avisa, no falla

`src/lib/llm/tool-executor.ts:37-39`: `if (REGISTRY.has(name))
logger.warn('tool.reregister', { name }); REGISTRY.set(name, tool);` — un doble
registro del mismo nombre sobreescribe el handler en silencio (con warn). Hoy
los tres registros vienen de un solo módulo (`tools.ts`), así que es teórico;
si mañana dos módulos registran el mismo nombre desde distintos puntos de
import, el último gana sin error.

## Arreglado desde la ronda 10 (verificado en el código actual, no de oído)

- **`ToolCallRecord.args` auditable** — el archivo que el encargo de la ronda 10
  pedía y "no existía" AHORA EXISTE: `openrouter_registro_args.test.ts` (2
  pruebas, verdes), y el código en `openrouter.ts:681-689,795-800` guarda los
  args ORIGINALES (`c.args`, `entry.args`) junto al resultado cacheado. Los dos
  escenarios —acierto cross-round y dedup intra-ronda con args distintos— están
  probados.
- **Loop-guard corta ANTES de ejecutar la ronda que excede el límite** —
  `openrouter.ts:761-770`, probado en `openrouter_loopguard.test.ts`: 3 rondas
  permitidas, 2 ejecuciones de tool, `LoopGuardError` envuelto en
  `PartialExecutionError` con las tools que sí corrieron.
- **Atribución de costo por modelo real** — `costoPorModelo`
  (`openrouter.ts:638-641,729-731`) y su consumo en `processor.ts:1828-1840`
  (una fila de `llm_costo` POR modelo cuando el ciclo cruzó de proveedor; el
  camino de una sola fila se conserva byte a byte para el caso normal).
- **Falso positivo de `isTransientError`** — el caso `FOLIO-502` / `$502` /
  `503.00` está cerrado y probado (`openrouter_transitorio.test.ts`); quedan los
  huecos del BAJO de arriba.
- **El error crudo de Postgres no cruza al modelo** — `mensajeParaElModelo`
  activo en `tool-executor.ts:113`, con la salvedad del BAJO de arriba.
- **FALLBACK para toda la clase, no modelo por modelo** —
  `modelosAisladosDeFallback()` + prueba de cobertura; los tres candidatos de
  OCR del benchmark ya tienen respaldo (y el comentario de `:54-67` documenta el
  criterio de visión).
- **El costo del ciclo caído viaja en `PartialExecutionError`** y la rama de
  cierre parcial del processor lo registra aunque el cierre no se pueda
  recuperar (`processor.ts:1858-1875`).

## Lo que revisé y está bien

- **Regla estructural intacta**: `properties: {}` en las tres tools, args
  ignorados por los handlers, IDs de tenant/viaje/operador solo desde
  `ToolContext`. `tools.ts` y `run.ts` byte-idénticos a la ronda 10.
- **Idempotencia de mutaciones bajo concurrencia**: `tool_executor_concurrente
  .test.ts` (6 pruebas) verde; la rejilla cachea la PROMESA, no el resultado, y
  la llave es el nombre (el efecto), no los args.
- **Caché de lectura**: solo éxitos (`openrouter_cache_fallo.test.ts`), llave
  por efecto con tools sin parámetros (`openrouter_cache_llave.test.ts`),
  `cuadrar_` en `READ_PREFIXES` con prueba de una sola ejecución.
- **Caché de prompt**: `cache_control` solo en el system, nunca en mensajes
  variables, nunca para primarios no-Anthropic (`cache_prompt.test.ts`, 3
  pruebas) — con el hueco del MEDIO de arriba.
- **`costoReal()`**: prioriza el costo del proveedor, con guardas contra `NaN` y
  negativos; `calcCost` nunca devuelve 0 en silencio y tolera sufijos de
  proveedor (`costo_real.test.ts`, `openrouter_costo.test.ts`).
- **`finish_reason:'length'` en el ciclo de tools** no se envía como turno
  bueno: `TruncatedError` envuelto en `PartialExecutionError`, probado
  (`openrouter_truncado_tools.test.ts`).
- **El abort del presupuesto no dispara fallback**: un `AbortError` no matchea
  `isTransientError` (verificado por análisis del mensaje "The operation was
  aborted"), así que el turno que se queda sin presupuesto no gasta más dinero
  en el proveedor de respaldo.
- **El error de datos nunca cruza `isTransientError`**: verificado por grep —
  solo los errores del SDK pasan por ahí (`openrouter.ts:286,499,711`); los de
  negocio van por `executeTool`.
- Suite del rubro completa verde (73 + 44 pruebas), `tsc` y `eslint` limpios.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter/Anthropic/OpenAI** — mismo límite de
  siempre, y ahora pesa más: el MEDIO de esta ronda (¿OpenRouter descarta o
  reenvía `cache_control` a un modelo OpenAI?) solo se resuelve con una llamada
  viva o con el fix de código. No hice la llamada: cuesta dinero y la regla del
  rubro es solo lectura.
- **Los overrides de Vercel** (`CUADRA_MODEL_CUADRE` y demás): no puedo
  verificarlos desde el repo. El modelo AISLADO del comentario de `:86-90` —
  un override que no tiene entrada en `FALLBACK` apaga el plan B en silencio —
  sigue dependiendo de que las variables de Vercel estén dentro de la tabla.
  `CUADRA_MODEL_OCR` sí está cubierto por prueba; el resto no.
- **`finish_reason:'length'` con `tool_calls` parcialmente emitidos** — el
  punto ciego de la ronda 9/10 sigue igual: si `calls.length > 0`, las tools se
  ejecutan sin mirar `finish_reason`. Analicé el caso: una mutación pedida con
  args completos SÍ corre aunque la respuesta se haya cortado (el JSON de args
  de una tool sin parámetros es `{}`, que parsea hasta truncado), y el cierre
  resultante es un cierre real con datos reales — no encontré daño concreto,
  pero no hay prueba que lo amarre.
- La migración RLS 0078 (`ce9abab`) — es del rubro seguridad/datos, no lo
  audité a fondo; solo confirmé que no toca nada de `src/lib/llm` ni
  `src/lib/cuadra/tools.ts`.
- El rubro agéntico (guardias de cifras/fundamento, `guardiaCifras`,
  `guardiaFundamento`) — consumidor de `ToolCallRecord`, no parte de este rubro.

## Veredicto

**Green light para el rubro tool-calling, con UN riesgo a cerrar antes del
demo.** La regla estructural —el LLM decide CUÁNDO, nunca CON QUÉ DATOS, y el
dinero se mueve solo por handlers determinísticos con IDs de servidor— está
intacta, probada por 117 pruebas del rubro, y la contabilidad de costo (la
palanca del negocio) está correcta y ahora atribuible por modelo real. No hay
ningún camino de "el modelo pide algo" a "el sistema rompe dinero" abierto.

Lo que sí recomiendo antes de la sala de mañana: resolver el [MEDIO-1] — el
fallback del rol `cuadre` manda un bloque de Anthropic a un modelo OpenAI por
un camino que ninguna prueba toca. El fix es chico (reconstruir el system sin
`cache_control` cuando `activeModel` deja de ser Anthropic, o verificar contra
OpenRouter real que lo descarta), pero es exactamente el camino que se pisa si
Anthropic parpadea en vivo, y el modo de falla sería el "se me trabó" que el
diseño del fallback promete no tener.

Los BAJO restantes son deuda latente (números 5xx desnudos en
`isTransientError`, `mensajeParaElModelo` sin prueba, `content: undefined`
posible, `ctx.signal` sin enhebrar) — ninguno alcanzable desde el código actual,
ninguno bloquea el demo.
