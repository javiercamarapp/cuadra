# Tool calling — auditoría 4

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda** — el código
no cambió salvo por el arreglo de `59bc958`, y la nota anterior estaba inflada.
Este rubro nunca había tenido auditor dedicado; su sección de la ronda 3 son 29
líneas y se quedó en el prefijo de caché. Abajo hay seis defectos verificados
ejecutando el módulo real, y uno de ellos lo **introdujo** el arreglo de la ronda 3.

La regla estructural —ninguna tool acepta datos del modelo— es real y está
verificada (ver *Lo que revisé y está bien*). Eso es lo único que impide que esta
nota baje de 5. Lo que la baja de 6 es que el cliente que implementa esa regla
tiene un fallback que no se dispara en la falla para la que existe, una
deduplicación que mira la llamada y no el efecto, y una caché que ahora convierte
un error transitorio de un segundo en la muerte del turno completo.

> **Riesgo mayor, hoy:** el fallback cross-provider **no se activa cuando
> OpenRouter no responde** — el modo de falla exacto que el propio `models.ts:25`
> declara como punto único de falla del demo. `isTransientError` sólo lee
> `err.message`, y el SDK de OpenAI colapsa *todo* error de red en un
> `APIConnectionError` cuyo mensaje literal es `"Connection error."`.

---

## Verificación de los abiertos

### 1. [alto, declarado arreglado] `cuadrar_viaje` no cacheaba entre llamadas del turno
**CERRADO, PERO ABRIÓ OTRA COSA.** `cuadrar_` sí está en `READ_PREFIXES`
(`openrouter.ts:405`) y el test existe y es honesto
(`openrouter_fallback_costo.test.ts:118-135`, verificado: 2 llamadas → 1 ejecución).

Pero las dos preguntas del encargo tienen respuesta mala:

- **¿La deduplicación mira la llamada o el efecto?** Mira la **llamada**. La llave
  es `` `${call.function.name}:${JSON.stringify(args)}` `` (`openrouter.ts:506`, y la
  misma fórmula en `tool-executor.ts:78`), mientras que los tres handlers de
  `tools.ts` ignoran `args` por completo (`_args` en las líneas 34, 52 y 111): el
  efecto depende **sólo** de `ctx`. Llave y efecto no coinciden → hallazgo 2.
- **¿Qué pasa con una tool de ESCRITURA llamada dos veces?** Se ejecuta dos veces
  si los `args` difieren en un byte. Reproducido → hallazgo 2.
- Y el arreglo caché **también cachea los fracasos** (`openrouter.ts:515`, sin
  `if (exec.success)`), a diferencia de la rejilla de mutaciones que sí lo
  distingue (`tool-executor.ts:82`) → hallazgo 1.

### 2. [medio] Cero cobertura de test para el handler de `cuadrar_viaje`
**REINCIDENTE, sin cambio.** `ls src/lib/cuadra/ | grep tools` → sólo `tools.ts`;
`find . -name "tools*.test.ts"` → vacío (dos búsquedas distintas, como pide el
MAPA). El `try/catch` de `getAcumuladoCombustible` (`tools.ts:65-72`), el push
condicional de `rfa-2026-2.9` (`tools.ts:79`) y la forma del objeto `periodo`
siguen sin una sola aserción. Los 501 tests pasan con esa rama rota.

### 3. [medio] `computeCuadre` y `getAcumuladoCombustible` en serie
**REINCIDENTE, sin cambio.** `tools.ts:54` (`await computeCuadre`) y `tools.ts:67`
(`await getAcumuladoCombustible`) siguen encadenados; la segunda sólo usa
`ctx.tenantId` y `new Date().getUTCFullYear()` (`tools.ts:66`).

### 4. [medio] Ninguna llamada a la BD atada al reloj de `presupuesto.ts`
**REINCIDENTE, sin cambio.** `grep -rn "ctx\.signal\|abortSignal" src/lib/cuadra
src/lib/llm` devuelve exactamente 5 líneas y **ninguna** está en `tools.ts` ni en
`repo.ts`: `presupuesto.ts:89` (fabrica la señal) y `openrouter.ts:257,264,276,456`
(la única que la consume). `ToolContext.signal` (`tool-executor.ts:18`) se llena en
`run.ts:34` y muere ahí.

### 5. [bajo] `combustible_efectivo_ejercicio` se agrega siempre
**REINCIDENTE, sin cambio.** `tools.ts:86`: `...(periodo ? { combustible_efectivo_ejercicio: periodo } : {})`.
La única condición sigue siendo que la consulta no haya lanzado; `estado === 'holgado'`
sólo gobierna el push de la norma (`tools.ts:79`), no el payload.

**Marcador: 1 cerrado (con regresión), 4 reincidentes.**

---

## Hallazgos

### [ALTO] El fallback cross-provider NO se dispara cuando el proveedor está caído
`src/lib/llm/openrouter.ts:57-63` · `:460` · `:139` · `:351`

`isTransientError` decide sobre `err.message` y nada más. El SDK de OpenAI
(`openai@6.49.0`) construye, para **cualquier** fallo de conexión —DNS, TCP
rechazado, TLS, `fetch failed` de undici—, un `APIConnectionError` cuyo mensaje es
la cadena literal `"Connection error."`: `client.mjs:434` llama
`getConnectionErrorMessage(response)`, que devuelve `undefined` salvo en un caso
de undici (`client.mjs:783-788`), y `core/error.mjs:74` cae al default
`message || 'Connection error.'`. El detalle real (`TypeError: fetch failed`) queda
en `err.cause`, que `isTransientError` nunca lee.

Medido contra el módulo real (`isTransientError` importado, sin mocks del regex):

```
host inalcanzable (APIConnectionError)     → transient? false   message: "Connection error."
timeout (APIConnectionTimeoutError)        → transient? true    message: "Request timed out."
503 del provider                           → transient? true
429 rate limit                             → transient? true
529 overloaded (anthropic)                 → transient? true
```

**Escenario:** OpenRouter tiene una caída de red (las de ago-2025 y feb-2026 que
el propio `models.ts:25` cita). El operador manda "listo". El SDK reintenta 3
veces por su cuenta y lanza `Error("Connection error.")`. En `openrouter.ts:460`,
`isTransientError(err)` da `false` → no se prueba `openai/gpt-5.6-terra` → el error
sube → `PartialExecutionError` (`:525`) → `processor.ts:564` manda *"Perdón, se me
trabó el sistema tantito."*.

Reproducido con el ciclo real, contando las llamadas que salen por el cable:

```
H)  APIConnectionError en la ronda 1 → PartialExecutionError | llamadas al modelo: 1
H2) el mismo caso con "503" en el mensaje → finalText: "respondió el fallback" | llamadas: 2
```

Una llamada. El fallback existe, está configurado (`FALLBACK`, `:50-55`), tiene
prueba (`openrouter_fallback_costo.test.ts`) — y la prueba usa
`new Error('503 Service Unavailable: provider caído')` (línea 38, con un comentario
que dice *"isTransientError mira el MENSAJE, no la propiedad status"*), o sea que
prueba justo el caso que sí funciona. Afecta igual a `generateResponse` (`:139`) y
a `generateStructured` (`:351`), o sea al OCR de comprobantes.

**Consecuencia:** el contralor, en la sala del 6-ago, ve al agente contestar "se me
trabó el sistema" ante un parpadeo de red que el diseño prometía absorber sin que
nadie lo notara. Y el operador tiene que reenviar su mensaje, porque Meta ya
recibió su 200 y no reintenta.

**Causa raíz probable:** clasificar errores por texto en vez de por tipo/`cause`;
`isTransientError` nunca vio un error real del SDK, sólo `new Error('503 ...')` de
los tests.

---

### [ALTO] La caché de lectura guarda también los FRACASOS: un blip de un segundo mata el turno entero (REGRESIÓN de la ronda 3)
`src/lib/llm/openrouter.ts:515` · `:507-511` · comparar con `tool-executor.ts:82`

`crossRound.set(key, exec)` se ejecuta sin mirar `exec.success`. La rejilla
hermana sí lo distingue, y lo documenta: *"Solo se cachea el éxito (un fallo sí
puede reintentarse)"* (`tool-executor.ts:69-72`, línea 82).

Antes de `59bc958`, `cuadrar_viaje` no entraba en esta rejilla, así que un fallo
suyo se reintentaba en la ronda siguiente. Al meter `cuadrar_` en `READ_PREFIXES`
para arreglar el hallazgo de caché, **el fracaso pasó a ser permanente dentro del
turno**.

**Escenario, reproducido con el ciclo real:** ronda 1, el modelo llama
`cuadrar_viaje`; `cuadrarDesdeDB` rebota con un error transitorio de Supabase
(`fetch failed`). El modelo, viendo `{"error":"fetch failed"}`, reintenta en las
rondas 2 y 3 — lo natural. Salida real:

```
A) EJECUCIONES REALES DE LA TOOL: 1
A) toolCalls: [{"toolName":"cuadrar_viaje","args":{},"result":null,"durationMs":5,"error":"fetch failed"},
               {... "error":"fetch failed"}, {... "error":"fetch failed"}]
```

Tres llamadas del modelo, **una** ejecución, tres errores idénticos servidos desde
memoria sin tocar la base. La base ya estaba sana en la ronda 2 y nadie fue a
preguntarle. `guardiaCifras` exige `!t.error` (`guardia.ts:37-38`), así que
`cuadro` es `false` y la respuesta termina siendo el mensaje fail-closed.

Peor: engancha con el loop-guard. Como el error nunca cambia, el modelo puede
gastar las 6 rondas reintentando (`openrouter.ts:470`) hasta `LoopGuardError`.

**Consecuencia:** un fallo de red de un segundo, del tipo que Supabase produce y
se cura solo, se convierte en un "listo" perdido y en una respuesta de disculpa
delante del comprador. Lo que antes se recuperaba solo, ahora no.

**Causa raíz probable:** el arreglo de la ronda 3 copió el patrón de caché sin
copiar la distinción éxito/fracaso que la rejilla de mutaciones ya tenía a diez
archivos de distancia.

---

### [ALTO] La deduplicación de mutaciones se rompe con un solo byte de diferencia en `args` — y `args` no afecta al efecto
`src/lib/llm/tool-executor.ts:78` · `:82` · `openrouter.ts:506` · `tools.ts:111`

`makeExecutor` promete, en su docstring (`tool-executor.ts:66-73`), *"Evita, p. ej.,
un doble `guardar_liquidacion` (doble PDF/costo)"*. La llave que sostiene esa
promesa es `` `${name}:${JSON.stringify(args)}` ``. El handler de
`guardar_liquidacion` recibe `_args` y **no lo usa jamás** (`tools.ts:111`): su
efecto depende exclusivamente de `ctx.tenantId` / `ctx.viajeId`. La llave describe
la llamada; el efecto no depende de la llamada.

Reproducido en tres formas, con el `makeExecutor` y el `generateWithTools` reales:

```
B1) exec({}) y exec({confirmar:true})     → r1 = {liquidacion_id:'id-1'}  r2 = {liquidacion_id:'id-2'}  ejecuciones: 2
B2) exec({a:1,b:2}) y exec({b:2,a:1})     → ejecuciones: 2   (mismo objeto, distinto orden de claves)
B3) CICLO COMPLETO: el modelo emite guardar_liquidacion con "{}" en la ronda 1 y
    con '{"confirmar": true}' en la ronda 2
    → EJECUCIONES DE LA MUTACIÓN: 2   [{"liquidacion_id":"L-1"},{"liquidacion_id":"L-2"}]
```

Lo que se ejecuta dos veces (`tools.ts:111-143`): `computeCuadre` + `getViaje` +
`getOperador` (4 lecturas extra a Postgres), `generarLiquidacionPDF` (medido:
78 ms en frío, 12 ms en caliente), el `upload` a Supabase Storage sobre la misma
ruta `${tenantId}/${viajeId}.pdf` con `upsert:true`, y el RPC
`guardar_liquidacion_tx`. Y `logger.warn('tool.mutation_dedup')` **no se dispara**,
así que en el log parece que la deduplicación funcionó.

**Lo que hoy salva el dinero no es esta rejilla**, es el
`on conflict (viaje_id) do update` de `0021_liquidacion_litros_diesel.sql:37`, que
devuelve el mismo `id` y hace la fila idempotente. Eso es exactamente lo que hace
peligroso el defecto: la garantía documentada es falsa, y la que de verdad protege
vive en una migración que ningún comentario de `tool-executor.ts` menciona. La
cuarta tool que se registre —enviar el PDF por WhatsApp, marcar un pago, notificar
al contralor— hereda la promesa rota sin un `on conflict` que la absorba.

Vector adicional verificado: `arguments: "null"` es JSON válido, así que
`openrouter.ts:501` produce `args = null` (no `{}`), la llave pasa a ser
`"guardar_liquidacion:null"`, y el objeto viaja al handler tipado como
`Record<string, unknown>` siendo `null`:

```
E2) args recibidos por el executor: null | args guardados en el ToolCallRecord: null
```

**Consecuencia:** el equipo que mantenga esto va a confiar en una idempotencia que
no existe. Hoy cuesta latencia dentro de un presupuesto de 40 s; el día que se
agregue una tool cuyo efecto no sea un `upsert`, cuesta el efecto duplicado.

**Causa raíz probable:** la llave se diseñó para tools con parámetros (el patrón
genérico heredado del chasis de atiende.ai) y nunca se ajustó al diseño de Likida,
donde **ninguna** tool tiene parámetros a propósito.

---

### [ALTO] `generateWithTools` no mira `finish_reason`: una respuesta cortada se trata como completa, y una respuesta vacía se convierte en un "Listo. 👍"
`src/lib/llm/openrouter.ts:450` · `:480-489` · `processor.ts:503` · `models.ts:63`

Cien líneas más arriba, `generateStructured` detecta `finish_reason === 'length'`
**antes** de parsear, lanza `TruncatedError`, reintenta con el doble de techo y lo
tiene probado con cinco casos (`openrouter.ts:290-298`, `openrouter_truncado.test.ts`).
El comentario de `DEFAULT_MAX_TOKENS` (`:34-45`) explica por qué: *"Estaba en 1200 y
truncaba comprobantes REALES: Gemini Flash gasta 1,000–1,800 tokens de razonamiento
invisible antes de escribir la primera llave"*.

El ciclo de tools no aprendió nada de eso. `max_tokens: opts.maxTokens ?? 1000`
(`:450`), `run.ts:40-49` no pasa `maxTokens`, y `ROLE_PARAMS.cuadre` es
`{ temperature: 0, reasoning: 'high' }` (`models.ts:63`). El cuerpo que sale por el
cable, capturado del stub en el lugar del SDK:

```json
{ "model": "anthropic/claude-sonnet-5", "tool_choice": "auto",
  "max_tokens": 1000, "reasoning": { "effort": "high" } }
```

Mil tokens de techo compartidos entre el razonamiento y la respuesta, en el rol
que el propio `models.ts:14-16` describe como *"razonamiento profundo donde
importa"*. Y `openrouter.ts:483-489` devuelve `choice.message.content` sin mirar
`finish_reason` nunca.

Dos salidas, ambas reproducidas:

```
C1) finish_reason:'length', content:"Tu viaje quedó con una diferencia de $1,2"
    → finalText: "Tu viaje quedó con una diferencia de $1,2"      (se envía como completa)
C2) finish_reason:'length', content:null, usage 900/1000
    → finalText: ""  toolCalls: 0  costo: $0.00277 (pagado)
```

El caso C2 es el peligroso. `processor.ts:503` hace
`reply = res.finalText || 'Listo. 👍'`. Con `finalText` vacío y `toolCalls` vacío:
`guardiaCifras` ve `cuadro === false` y `tieneCifrasDeDinero('Listo. 👍') === false`,
así que sale por `guardia.ts:51` sin tocar nada. **Entra**: el operador escribe
"listo, ya no tengo más". **Sale**: `"Listo. 👍"` — una confirmación afirmativa de
un turno en el que no se llamó ninguna tool, no se cuadró nada, no se cerró la
liquidación y no se generó ningún PDF. Se pagó la llamada.

**Consecuencia:** el chofer cree que su viaje quedó cerrado y deja de mandar
comprobantes. El contralor abre el panel y el viaje sigue abierto sin liquidación.
Nadie ve un error, ni en el chat ni en el log.

Esto ya estaba escrito en `docs/conocimiento/51-boletin-tecnico.md` (mejora #18,
"medio", rubro Rendimiento) y sigue sin tocarse. Lo subo a ALTO porque el boletín
lo describe como *"una llamada pagada que no produjo tool_call"* y la medición
muestra que además produce una **afirmación falsa** al operador.

**Riesgo adyacente que NO pude verificar sin red, y que conviene comprobar con una
sola llamada real antes del 6-ago:** OpenRouter traduce `reasoning.effort:'high'`
a un presupuesto de razonamiento proporcional a `max_tokens`, y Anthropic exige
`budget_tokens >= 1024`. Con `max_tokens: 1000` ese presupuesto queda por debajo
del mínimo. Si OpenRouter no lo recorta al alza, la llamada devuelve un 400 —que
`isTransientError` **no** clasifica como transitorio (verificado:
`"400 thinking.budget_tokens must be >= 1024"` → `false`)— y **todo** turno del
agente muere en "se me trabó el sistema". No lo cuento como hallazgo porque no
puedo medirlo aquí; lo dejo como la primera cosa que probaría contra la API real.

**Causa raíz probable:** `reasoning:'high'` y `max_tokens ?? 1000` entraron en el
mismo commit (`49c8d03`) y nadie reconcilió los dos números.

---

### [MEDIO] La última ronda del loop-guard ejecuta las tools y tira el resultado a la basura
`src/lib/llm/openrouter.ts:470` · `:494-520` · `:522`

El bucle es `for (let round = 0; round < maxRounds; round++)`: cada iteración
completa **y luego ejecuta**. En la iteración 6 las tools se ejecutan, sus
resultados se empujan a `convo` (`:520`) y el bucle termina — el modelo nunca los
ve, y sale `LoopGuardError` → `PartialExecutionError`.

Reproducido, con el modelo devolviendo una tool call en cada ronda:

```
D) err: PartialExecutionError | "Ciclo de tools excedió 6 rondas"
   ejecuciones de la tool: 6 | llamadas al modelo: 6 | partialToolCalls: 6
```

**Escenario:** el turno se alarga (por ejemplo por el hallazgo 1: `cuadrar_viaje`
devolviendo el mismo error cacheado ronda tras ronda) y `guardar_liquidacion` cae
en la ronda 6. **Sale:** la liquidación **queda persistida** en Postgres, el
`viaje` queda en `'liquidado'` y el PDF queda en Storage; el ciclo muere; y
`CUADRA_RECUPERAR_CIERRE_PARCIAL` es `'0'` por default (`processor.ts:522`), así
que el operador recibe *"Perdón, se me trabó el sistema tantito. ¿Me reenvías tu
último mensaje?"*. Cuando lo reenvía, `processor.ts:460-462` le contesta *"Ese
viaje ya quedó cerrado"* — y nunca llega su PDF.

**Consecuencia:** liquidación huérfana. Es el mismo huérfano que la ronda 3
identificó y dejó detrás de un flag apagado; lo que aporto es **de dónde sale**:
el guard cuenta rondas de completado y ejecuta tools que sabe que ya no podrá
devolverle al modelo.

**Causa raíz probable:** el guard se aplica al final del cuerpo del bucle en vez de
antes de ejecutar; una rama que corte cuando `round === maxRounds - 1` y haya
`tool_calls` ahorraría la ejecución desperdiciada.

---

### [MEDIO] En un ciclo con fallback, el costo se reparte bien pero se atribuye entero al modelo que respondió al final
`src/lib/llm/openrouter.ts:479` · `:488` · `processor.ts:506` · `costos.ts:32`

`59bc958` arregló los dólares: `costo += calcCost(activeModel, rIn, rOut)`
(`:478`) precifica ronda a ronda, y su test lo prueba. Lo que no se movió es la
**etiqueta**: `used = res.model || activeModel` (`:479`) guarda el modelo de la
**última** ronda, y `processor.ts:506` escribe **una sola** fila en `llm_costo` con
ese `modelo`, los tokens sumados de todas las rondas y el costo mixto.

Medido con el ciclo real (3 rondas de Sonnet 5 + caída + 1 ronda de GPT-5.6-terra):

```
I) fila que se escribe → modelo: "openai/gpt-5.6-terra"  tokensIn: 2200  tokensOut: 500  cost: $0.0115
   si alguien recalcula desde la fila:  calcCost("openai/gpt-5.6-terra", 2200, 500) = $0.0130
   desglose real:  sonnet-5 $0.0040  +  gpt-5.6-terra $0.0075
```

**Escenario:** el contralor (o el equipo) reconcilia la factura de OpenRouter
contra `llm_costo`. La tabla dice que se gastaron $0.0115 en `gpt-5.6-terra` con
2,200/500 tokens; OpenRouter facturará $0.0075 por ese modelo y $0.0040 por
Sonnet. Ni el total por modelo ni la tarifa implícita cuadran, y no hay ninguna
columna que explique por qué.

Además `faseDeModelo(res.model, 'cuadre')` (`costos.ts:32-34`) clasifica por el
slug: cuando el que responda al final sea `anthropic/claude-opus-5`
(`FALLBACK['anthropic/claude-opus-5']` existe en `:54`), todo el ciclo se archiva
como `'escalacion'` aunque las tres primeras rondas fueran `cuadre`.

**Consecuencia:** Likida va a cobrar **por liquidación**. El desglose por modelo es
el insumo para fijar ese precio, y es el único número del sistema que no se puede
reconciliar contra la factura del proveedor.

**Causa raíz probable:** `generateWithTools` devuelve un escalar donde el ciclo ya
produce un vector; la corrección de `59bc958` arregló la suma pero conservó la
firma de un solo `model`.

---

### [MEDIO] `getAcumuladoCombustible` no puede distinguir "estos son todos los gastos" de "estos son los primeros N"
`src/lib/cuadra/repo.ts:416-438` · `tools.ts:67-69` · `supabase/migrations/0023_indice_acumulado_combustible.sql:8`

La consulta trae **todas** las filas de diésel del ejercicio del tenant sin
`.limit()`, sin `.range()`, sin `count`, y sin comparar lo recibido contra nada:
`grep -n "\.limit(\|\.range(\|count:" src/lib/cuadra/repo.ts` devuelve **una sola
línea** en todo el archivo, y es la 131 (otra función). Luego suma en JS
(`:431-436`) y el resultado va directo al payload que ve el modelo (`tools.ts:69,86`).

PostgREST corta las respuestas al `max-rows` del proyecto (1000 por default en
Supabase) devolviendo un **200 con menos filas**, no un error. El código de
`:427` sólo mira `error`. Independientemente del valor concreto de ese ajuste —que
no puedo consultar sin la base—, **el código es incapaz de detectar el corte**.

**Escenario:** flota de 40 tractocamiones, ~2,400 cargas de diésel en 2026, $1.8 M
de combustible, $300,000 en efectivo → razón 16.7 %, estado `excedido`, excedente
$30,000. Si PostgREST devuelve sólo las primeras 1,000 filas, la suma se hace sobre
~$750,000 con ~$90,000 en efectivo → razón 12 %, estado `cerca`, `margen: 22500`,
`excedente: 0`. **Sale** hacia el modelo (`tools.ts:86`):
`combustible_efectivo_ejercicio: { estado: "cerca", margen: 22500, excedente: 0, aviso: "..." }`
y `fundamentos` **no** incluye `rfa-2026-2.9` como excedido.

**Consecuencia:** el contralor recibe "todavía te caben $22,500 en efectivo este
año" cuando la flota ya perdió la deducción de $30,000. Es el error que
`periodo/combustible.ts:15-17` fue escrito para evitar ("el denominador equivocado
es el error que haría parecer holgada a una flota que ya se pasó") — sólo que aquí
el que se corta es el numerador y el denominador a la vez, y el cociente miente
igual porque las cargas en efectivo no están repartidas uniformemente en el año.
La migración 0023 anticipa "miles de cargas al año" en su propio comentario
(línea 8).

**Causa raíz probable:** se agregó el índice que hace la consulta rápida y no la
paginación que la hace completa.

*(Solapa con Modelo de datos / Fiscal. Lo reporto aquí porque el consumidor único
de esa función es el payload de una tool y ahí es donde el número miente.)*

---

### [BAJO] El mensaje crudo de Postgres viaja al contexto del modelo, que puede repetírselo al chofer
`src/lib/llm/tool-executor.ts:55-61` · `openrouter.ts:517`

`executeTool` mete `err.message` sin filtrar en el `ToolExecResult`, y
`openrouter.ts:517` lo serializa como contenido del mensaje `role:'tool'`.
Capturado del ciclo real:

```json
{ "role": "tool", "tool_call_id": "c1",
  "content": "{\"error\":\"permission denied for table gasto (tenant 8f2c-...)\"}" }
```

**Escenario:** falta la migración 0021 en el entorno del demo. `saveLiquidacion`
(`repo.ts:339`) lanza `saveLiquidacion: Could not find the function
public.guardar_liquidacion_tx(...) in the schema cache`. Esa cadena entra al
contexto; el prompt le ordena al modelo *"explícale en lenguaje simple"*
(`prompts.ts`, paso 4) y no le dice nada sobre qué hacer con un error de tool.
`guardiaCifras` deja pasar cualquier texto sin cifras de dinero (`guardia.ts:51`).
**Sale** por WhatsApp, al chofer y proyectado en la sala: *"no pude guardar tu
liquidación: no encuentro `guardar_liquidacion_tx` en el esquema"*.

**Consecuencia:** nombres de tablas, funciones y UUIDs internos en el chat del
operador. `logger.error('tool.error')` (`:56`) ya guarda el detalle completo donde
sí sirve. Ya estaba anotado como mejora #22 en el boletín técnico.

---

### [BAJO] `isTransientError` da falso positivo con cualquier número de tres cifras que empiece con 5
`src/lib/llm/openrouter.ts:60`

`/\b(5\d\d|429|408|502|503|504)\b/` se aplica sobre el mensaje completo. Verificado:

```
"Validación falló: [{\"code\":\"too_big\",\"maximum\":500,\"path\":[\"monto\"], ...}]"  → transient? true
```

En `generateStructured:351` eso convierte un fallo puro de schema en una tercera
llamada pagada a otro proveedor (`:353`), que va a fallar igual porque el problema
no era el proveedor. Cuesta una llamada de OCR por cada comprobante cuyo mensaje de
error de zod contenga un `5xx` literal, dentro de un presupuesto de 60 s.

---

## Lo que revisé y está bien

- **La regla estructural se sostiene, y la verifiqué en las tres tools, no en una.**
  `consultar_politica` (`tools.ts:31`), `cuadrar_viaje` (`:49`) y
  `guardar_liquidacion` (`:108`) declaran las tres
  `parameters: { type:'object', properties:{}, additionalProperties:false }`, y los
  tres handlers reciben `_args` sin usarlo (`:34`, `:52`, `:111`). `tenantId`,
  `viajeId`, `operadorId` y `telefono` se arman en `processor.ts:499` a partir del
  teléfono verificado y de `getOpenViaje`, y viajan por `ToolContext`
  (`tool-executor.ts:12-19`) cerrado en `makeExecutor` (`:74`). **No hay ningún
  parámetro que el modelo pueda llenar y que decida sobre una fila.** Ninguna tool
  nueva rompió la regla desde la ronda 3.
- **Aislamiento por tenant en todo lo que una tool puede alcanzar.**
  `getViaje` (`repo.ts:43-44`), `getOperador` (`:66-67`), `getGastos` (`:281`),
  `getAcumuladoCombustible` (`:423`) y `getConfig(ctx.tenantId)` filtran por
  `tenant_id` **además** del id de la fila. `cuadrarDesdeDB` (`desde_db.ts:11-14`)
  propaga los dos. Nada de lo que vuelve al modelo puede cruzar de tenant.
- **`tool_calls` con JSON inválido no tumban el turno y no engañan a la guardia.**
  `openrouter.ts:500-505` captura el parseo, registra `error:'args_parse'` y le
  devuelve al modelo `{"error":"argumentos JSON inválidos"}` sin ejecutar nada:
  ```
  E1) toolCalls: [{"toolName":"cuadrar_viaje","args":{},"result":null,"durationMs":0,"error":"args_parse"}]  ejecuciones: 0
  ```
  Y `guardiaCifras` exige `!t.error` para dar por bueno el cuadre
  (`guardia.ts:37-38`), así que una `cuadrar_viaje` con args rotos **no** habilita al
  modelo a narrar cifras. Ese era mi mejor candidato a CRÍTICO y está cerrado.
- **Tool que no existe en el registry:** `executeTool` (`tool-executor.ts:49-51`)
  devuelve `{success:false, error:"tool desconocida: X"}` y el ciclo sigue.
  Verificado: `E3) → {"success":false,"result":null,"error":"tool desconocida: get_saldo_secreto","durationMs":0}`.
- **`type !== 'function'`** se contesta con un mensaje `tool` válido en vez de
  reventar (`openrouter.ts:496-498`) — el `tool_call_id` se responde siempre, que es
  lo que impide el 400 del proveedor en la ronda siguiente.
- **Dedup dentro de una misma ronda** (`inRound`, `openrouter.ts:492,512-513`):
  dos calls idénticas en el mismo `tool_calls` comparten una sola promesa. Probado
  por `openrouter_fallback_costo.test.ts:118-135` y reverificado.
- **`calcCost` con modelo desconocido** (`:88-102`): estima con la tarifa más cara y
  loguea `llm.modelo_sin_precio`; tolera el sufijo `:nitro`/`:floor` (`:90`).
  Cubierto por `openrouter_costo.test.ts:155-170`.
- **El camino de truncamiento de `generateStructured`** (`:290-298, 333-343`) está
  bien hecho **y** bien probado: detecta antes de parsear, reintenta con el doble de
  techo, no disfraza el segundo truncamiento de error de formato, y arrastra el
  consumo de todos los intentos (`openrouter_truncado.test.ts`, 5 casos;
  `openrouter_costo.test.ts`, 12 casos). Es el contraste que hace evidente el hueco
  del ciclo de tools.
- **`PartialExecutionError` carga el costo real** (`:390-393`, llenado en `:525`) y
  `processor.ts:531-540` lo registra **antes** del `if` de recuperación. Verificado
  ejecutando, no leyendo: `err.tokensIn: 100, err.cost: calcCost(PRIM,100,20)`.
- **El fallback no re-ejecuta mutaciones.** El reintento vive dentro de `complete`
  (`:444-467`), o sea sólo la llamada de completado; las tools corren después
  (`:494`). El comentario de `:441-443` es cierto.
- **Reparto de costo por ronda con modelo mixto** (`:478`): correcto en dólares,
  probado, y lo reverifiqué con números propios (hallazgo de atribución arriba es
  sobre la *etiqueta*, no sobre el monto).
- **`registerTool` avisa de re-registro** (`tool-executor.ts:30`) y `processor.ts:9`
  importa `tools.ts` por efecto secundario con comentario explícito.
- **Línea base intacta:** `npm test` → 501/501 en 50 archivos, `git status` limpio.
  No toqué ningún archivo del repo salvo este.

---

## Lo que NO alcancé a revisar

- **Nada contra la API real.** Todo lo de arriba corre con un stub en el lugar del
  SDK. No pude confirmar: qué devuelve OpenRouter en `usage` cuando hay tokens de
  razonamiento (¿`completion_tokens` los incluye? de eso depende que
  `calcCost(:92)` los cobre o los regale), si `res.model` trae el slug con sufijo de
  proveedor en el camino de tools, ni el mapeo real de `reasoning.effort` a
  presupuesto de razonamiento (ver el riesgo adyacente del hallazgo de truncamiento
  — es lo primero que probaría).
- **El valor real de `max-rows` de PostgREST** en el proyecto de Supabase, y por
  tanto el umbral exacto donde el contador del 15% empieza a mentir. Lo que sí es
  verificable en el código es que no hay forma de detectar el corte.
- **`generateStructured` en su modo visión**: `strictify` (`:216-225`), el armado
  multimodal (`:232-240`) y `extractJson` (`:147-155`) los leí pero no los ataqué
  con schemas ni con salidas adversariales; el rubro de intake/OCR los toca más de
  cerca.
- **`tool_calls` en streaming / fragmentadas**: el cliente no usa streaming, así que
  no evalué el ensamblado incremental de `arguments`. Si alguien enciende streaming,
  todo el análisis de `openrouter.ts:494-519` hay que rehacerlo.
- **Concurrencia real de dos `guardar_liquidacion` en la MISMA ronda** contra
  Postgres (el `Promise.all` de `:494` las lanza en paralelo). El `on conflict` debe
  absorberlo, pero no lo probé contra la base — `supabase/verificaciones.sql` sería
  el lugar.
- **Prompt caching**: cero `cache_control` en el repo. Con hasta 6 rondas que
  reenvían el system prompt completo, es un costo que va a crecer; no lo cuantifiqué.
- **El agente `orchestrator`** (`registry.ts:7-13`, `tools: []`): no lo llama nadie,
  así que no evalué qué pasaría si `generateWithTools` corriera con `tools: []`
  (`:448` manda `undefined`).
