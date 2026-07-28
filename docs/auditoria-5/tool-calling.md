# Tool calling — auditoría 5

**Nota: 7/10** (antes 5). Razón del movimiento: **se atacó y subió** — los seis
hallazgos de la ronda 4 se atacaron, cinco están cerrados **con prueba anclada**
(`openrouter_transitorio.test.ts`, `openrouter_cache_fallo.test.ts`,
`openrouter_truncado_tools.test.ts`, `tool-executor.test.ts`, cuatro archivos que
no existían), y el que quedó abierto quedó estrechado a un solo camino. La regla
estructural —ninguna tool acepta datos del modelo— sigue intacta y la reverifiqué
en las tres tools.

Lo que impide llegar a 8: el ancla del rubro pide *"ninguna tool acepta datos del
modelo **y** el camino con fallback tiene prueba"*. El fallback ya tiene prueba.
Pero `src/lib/cuadra/tools.ts` —el archivo donde vive la regla— sigue sin **una
sola** prueba por tercera ronda consecutiva, la idempotencia que `tool-executor.ts`
documenta sigue siendo falsa bajo concurrencia, y dos campos del esquema de OCR
llegan al modelo sin una sola instrucción sobre qué poner en ellos.

> **Riesgo mayor, hoy:** nada obliga a que el `arguments` de una tool sea `{}` —
> los schemas de tools **no** llevan `strict: true` (contrasta con
> `openrouter.ts:286`, que sí se lo pone al `json_schema` del OCR)— y las **dos**
> rejillas que impiden ejecutar dos veces siguen dependiendo de ese `arguments`:
> la de lectura porque se llavea con él, y la de mutación porque bajo `Promise.all`
> su llave por nombre nunca se consulta a tiempo.

---

## Verificación de los abiertos de la ronda 4

| # | Hallazgo de la ronda 4 | Hoy |
|---|---|---|
| 1 | `isTransientError` no dispara el fallback con el proveedor caído | **CERRADO.** `openrouter.ts:64-68` clasifica por `name`/`status` **antes** que por texto, y lee `err.cause` (`:69-72`). Medido: `APIConnectionError` → `true`. Anclado en `openrouter_transitorio.test.ts` (5 casos). |
| 2 | La caché de lectura guardaba los FRACASOS | **CERRADO.** `openrouter.ts:554`: `if (isReadOnly(...) && exec.success)`. Anclado en `openrouter_cache_fallo.test.ts`. |
| 3 | Dedup de mutación llaveada por `args` | **CERRADO A MEDIAS.** `tool-executor.ts:86` ya es `const key = name`. Medido: rondas distintas con args distintos → **1** ejecución. Pero en la MISMA ronda, en paralelo → **2**. Ver hallazgo ALTO. **REINCIDENTE** en su camino concurrente. |
| 4 | `generateWithTools` no miraba `finish_reason` / `max_tokens: 1000` | **CERRADO.** `openrouter.ts:509-517` lanza `TruncatedError`; `:469` usa `DEFAULT_MAX_TOKENS` = 4000. Medido por el cable: `max_tokens: 4000, reasoning:{effort:'high'}`. `processor.ts:541` ya no convierte el vacío en `"Listo. 👍"`. Anclado en `openrouter_truncado_tools.test.ts`. También cierra el riesgo adyacente de `budget_tokens >= 1024`. |
| 5 | El loop-guard ejecuta la ronda 6 y la tira | **REINCIDENTE**, degradado a BAJO (ver abajo): `CUADRA_RECUPERAR_CIERRE_PARCIAL=1` ya está en `.env.local:34` y en Vercel producción, así que el huérfano se recupera. |
| 6 | Atribución de costo por modelo tras fallback | **REINCIDENTE, sin cambio.** `openrouter.ts:498`. |
| 7 | `getAcumuladoCombustible` sin paginación | **REINCIDENTE, sin cambio.** `repo.ts:420-427`. |
| 8 | Error crudo de Postgres al contexto del modelo | **REINCIDENTE, sin cambio.** `tool-executor.ts:60` → `openrouter.ts:556`. |
| 9 | `isTransientError` falso positivo con `5xx` en el texto | **REINCIDENTE, sin cambio.** `openrouter.ts:74`. Su prueba nueva no cubre esa dirección. |
| 10 | Cero cobertura de `tools.ts` · `ctx.signal` muerto · `combustible_efectivo_ejercicio` siempre en el payload | **REINCIDENTES (3.ª ronda).** |

**Marcador: 3 cerrados con prueba, 1 cerrado a medias, 6 reincidentes.**

---

## Hallazgos

### [ALTO] La idempotencia de mutaciones sigue siendo falsa: bajo `Promise.all`, la llave por nombre se consulta antes de que exista (REINCIDENTE, estrechado)

`src/lib/llm/tool-executor.ts:86-91` · `src/lib/llm/openrouter.ts:526` · `:540` · `:546-547` · `src/lib/cuadra/tools.ts:108`

El arreglo de esta ronda cambió la llave a `const key = name` y su comentario
(`tool-executor.ts:78-85`) explica bien por qué. El problema es el **orden de las
operaciones**, no la llave:

```
87    const cache = mutacionesHechas.get(key);
88    if (cache) { ...; return cache; }
89    const res = await executeTool(name, args, ctx);   ← ventana
90    if (res.success) mutacionesHechas.set(key, res);
```

`get` … `await` … `set`. Dos invocaciones concurrentes pasan las dos por el `if`
con la caché vacía. Y `generateWithTools` las lanza concurrentes: `Promise.all`
sobre `calls` (`openrouter.ts:528`). Lo único que las junta antes es `inRound`
(`:526`, `:546-547`), que se llavea con `` `${name}:${JSON.stringify(args)}` ``
(`:540`) — **exactamente la llave que este arreglo quitó por describir la llamada
y no el efecto**.

Reproducido con `makeExecutor` y `generateWithTools` reales, contando ejecuciones
del handler:

```
D) el modelo emite en la MISMA ronda:
   [guardar_liquidacion "{}", guardar_liquidacion "{\"confirmar\":true}"]
   → EJECUCIONES REALES DEL HANDLER: 2
   → toolCalls: [{"args":{},"res":{"liquidacion_id":"L-1"}},
                 {"args":{"confirmar":true},"res":{"liquidacion_id":"L-2"}}]
   mismo caso con args IDÉNTICOS      → 1   (lo salva `inRound`, no `makeExecutor`)
   rondas distintas, args distintos   → 1   (aquí sí, `tool.mutation_dedup` se dispara)
```

**Escenario:** el operador escribe *"listo, ciérralo"*. Sonnet 5 con
`reasoning:'high'` emite `guardar_liquidacion` dos veces en el mismo `tool_calls`
—que es justo el caso para el que existe `inRound`— y el segundo lleva
`{"confirmar": true}`. Nada lo impide: los schemas de tools **no** declaran
`strict: true` (`tools.ts:108` es solo `properties: {}, additionalProperties:false`;
el único `strict:true` del repo está en `openrouter.ts:286`, para el OCR), así que
el proveedor no restringe `arguments`. El propio código ya asume que puede venir
cualquier cosa: `args_parse` (`:537`) y el comentario de `tool-executor.ts:81-84`.

**Consecuencia medida sobre lo que corre el handler** (`tools.ts:111-150`):
2 × `computeCuadre` + `getViaje` + `getOperador` (6 lecturas extra a Postgres),
**4** `generarLiquidacionPDF`, **4** `upload` a Storage sobre las mismas dos rutas
`${tenantId}/${viajeId}.pdf` y `-operador.pdf`, y **2** RPC
`guardar_liquidacion_tx`. Y `logger.warn('tool.mutation_dedup')` (`:88`) **no se
dispara**: en el log parece que la rejilla funcionó.

El dinero lo salva —otra vez— el `on conflict (viaje_id) do update` de
`supabase/migrations/0021_liquidacion_litros_diesel.sql:38-51`, que devuelve el
mismo `id`. Ningún comentario de `tool-executor.ts` lo menciona. Y hay un caso
donde ni siquiera hace falta que los `args` difieran: **con args idénticos,
`makeExecutor` tomado por sí solo tampoco protege** — protege `inRound`, en otro
archivo y con la llave equivocada. La garantía documentada en el docstring
(`:66-73`) no la sostiene el código que la documenta.

**Causa raíz:** el arreglo cambió la llave sin cerrar la ventana check-then-act, y
dejó el caso concurrente delegado en la rejilla del llamador, que quedó con la
llave vieja. `tool-executor.test.ts` prueba los cuatro casos **secuenciales** y
ninguno concurrente.

---

### [MEDIO] Dos campos del esquema de OCR llegan al modelo sin una sola instrucción — y sus comentarios de TypeScript no viajan por el cable

`src/lib/cuadra/intake/ocr.ts:36` · `:53` · `:67-101` (el `SYSTEM`) · `src/lib/cuadra/cuadre/engine.ts:682-686` · `src/lib/cuadra/cuadre/engine.ts:241`

Es la familia del bug de `flete`, en su otra dirección: el esquema pide un campo
que el prompt nunca explica. Barrí los 20 campos del esquema contra el texto del
`SYSTEM`, imprimiendo además el `json_schema` que de verdad sale por el cable:

```
══ Campos del esquema que el PROMPT nunca nombra ══
  ✗ producto
  ✗ cfdi_uuid

══ json_schema que recibe el modelo ══
   producto    {"anyOf":[{"type":"string"},{"type":"null"}]}   ← SIN description
   cfdi_uuid   {"anyOf":[{"type":"string"},{"type":"null"}]}   ← SIN description
   (los 20 campos salen SIN description: z.toJSONSchema no lleva comentarios de TS)
```

Los otros 18 tienen su renglón en *REGLAS DURAS* o en *MAPEO DE ETIQUETAS*. Estos
dos tienen su explicación en un comentario `//` de TypeScript
(`ocr.ts:36`: *`"Diesel", "Regular", "Premium", "GSuper", "Magna"`*) que se lee
como si le hablara al modelo y que el modelo **nunca ve**.

**`cfdi_uuid`.** `engine.ts:241`: `if (pol?.requiereCfdi && !g.cfdiUuid)` levanta
`sin_cfdi`, y `config.ts:66` trae `{ concepto: 'factura', requiereCfdi: true }`.
El UUID normalmente lo pisa el QR (`ocr.ts:263`), pero cuando el QR no decodifica
—el propio módulo documenta en `ocr.ts:158-168` que sobre los tickets de campo del
27-jul la foto completa dio **0 códigos legibles**— el único camino es lo que lea
visión, y al modelo nadie le dijo dónde está el folio fiscal ni cómo se llama en
el papel ("Folio Fiscal", "UUID", "IdDocumento"). **Sale:** un CFDI legítimo de,
digamos, $12,400 entra con `cfdiUuid: undefined` → diferencia `sin_cfdi` →
`REVISAR` (`engine.ts:637`) con la nota *"requiere factura CFDI y no trae UUID
válido"* y `lisr-27-fr-III` citado en `fundamentos`. Es literalmente *"un `sin_cfdi`
que no existía"*, la misma frase con la que se describió el incidente de `flete`.

**`producto`.** Lo consume `etiquetaConcepto` (`engine.ts:682-686`), que es lo que
el PDF imprime en la columna concepto (`liquidacion/pdf.ts:200`) y lo que arma la
fila imprimible (`liquidacion/omitidos.ts:47`). Esa función existe —lo dice su
docstring, `engine.ts:670-677`— para que *"un ticket real de PLUS no salga
etiquetado Diésel"*. Nunca recibe su insumo. Y cuando lo recibe, no es lo que
espera: la salida real capturada de un ticket de OXXO
(`intake/rfc_emisor_puntuado.test.ts:29`) trae `producto: 'CUCHARA GRANDE 25PZ'`
—la descripción del renglón, no el grado del combustible—. Sobre un ticket de
gasolinera con `concepto:'diesel'`, `engine.ts:686` hace
`/diesel|diésel/i.test(producto)`: cualquier cadena que el modelo copie del papel
y que contenga "diesel" (el nombre de la estación, "SERVICIO DIESEL DEL SURESTE")
imprime **"Diésel"** en el PDF que el contralor archiva, sobre un litraje de
gasolina que no ampara el estímulo del LIF 20-A fr. IV.

**Consecuencia:** el mismo modo de falla del incidente de hoy — no hay error en
ningún log, hay una degradación silenciosa — sobre dos campos que sí tienen
consumidor y sí tocan un veredicto fiscal impreso.

---

### [MEDIO] La prueba escrita para que el bug de `flete` no vuelva no cubre la dirección en que ocurrió

`src/lib/cuadra/intake/conceptos_coinciden.test.ts:26-33`

El bug fue: **el prompt tiene un concepto que el esquema no acepta**. La aserción
recorre `CONCEPTOS_OCR` (el esquema) y comprueba que el prompt lo mencione. El
cuantificador va al revés: un valor que esté solo en el prompt no lo ve nadie.

Corrí la aserción tal cual, con la línea real del prompt y con la línea real más
un concepto inventado:

```
línea real del prompt          → { paso: true }
línea + ", peaje_urbano, otro." → { paso: true }
```

Verde. **La prueba que conmemora el bug de `flete` no falla ante el bug de
`flete`.** Hoy no hay divergencia viva (las dos listas coinciden, lo verifiqué),
así que esto no es un fallo de producción: es la red que se puso para que no
vuelva a pasar, y no está tendida del lado por el que se cayó.

Nota menor del mismo archivo: `it('todo concepto del esquema existe en el tipo del
dominio')` (`:20-24`) es una aserción de **compilación** —así lo dice su
comentario—; bajo `npm test` el `expect(_.length).toBe(CONCEPTOS_OCR.length)` es
trivialmente cierto. Solo la protege `tsc --noEmit`.

**Escenario:** el 5-ago alguien añade `peaje_urbano` a la línea del prompt para
separar las casetas urbanas del operador (que hoy el prompt manda a `transporte`).
Las 628 pruebas siguen verdes; el modelo emite `otro` porque el enum no lo acepta;
y las casetas urbanas dejan de amparar el viático de alimentos que sí les toca.

---

### [MEDIO] La caché de lectura se anula con cualquier variación de `arguments`, y `cuadrar_viaje` vuelve a barrer el ejercicio entero (REINCIDENTE)

`src/lib/llm/openrouter.ts:540` · `:541-545` · `src/lib/cuadra/tools.ts:52-54` · `:67`

Misma raíz que el ALTO: la llave de `crossRound` sigue siendo
`` `${name}:${JSON.stringify(args)}` `` mientras el handler ignora `args` por
completo (`tools.ts:52`, `_args`). Reproducido con el ciclo real:

```
E) el modelo llama cuadrar_viaje en 3 rondas con:
   {}  ·  {"viaje_id":"v1"}  ·  {"incluir_periodo":true}
   → EJECUCIONES REALES: 3   (la caché no acertó ni una vez)
```

Lo que se repite tres veces (`tools.ts:52-72`): `cuadrarDesdeDB` (3 lecturas) y
—en serie detrás de él, `tools.ts:67`— `getAcumuladoCombustible`, que barre
**todas** las cargas de diésel del ejercicio del tenant. Es exactamente el gasto
que el comentario de `READ_PREFIXES` (`openrouter.ts:413-418`) dice haber cerrado
al meter `cuadrar_` en la lista: la lista acertó, la llave no.

**Consecuencia:** en una flota de 40 unidades con ~2,400 cargas al año, tres
barridos del ejercicio dentro de un turno acotado a 40 s (`processor.ts:534`), más
6 lecturas de cuadre redundantes. No corrompe nada; se come el presupuesto que
`presupuesto.ts` acaba de sincronizar con `maxDuration`.

---

### [MEDIO] En un ciclo con fallback el costo se reparte bien y se etiqueta mal (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:498` · `:497` · `src/lib/cuadra/processor.ts:546` · `costos.ts:32`

`costo += calcCost(activeModel, rIn, rOut)` (`:497`) sigue precificando ronda a
ronda —correcto—, pero `used = res.model || activeModel` (`:498`) guarda el modelo
de la **última** ronda y `processor.ts:546` escribe **una** fila en `llm_costo`
con ese `modelo`, los tokens sumados y el costo mixto. Medido con el ciclo real
(2 rondas de Sonnet 5 → `APIConnectionError` → fallback → 1 ronda de GPT-5.6-terra):

```
fila que se escribiría → modelo: "openai/gpt-5.6-terra"  tokIn: 1700  tokOut: 400  cost: $0.008750
recalculado desde la fila: calcCost("openai/gpt-5.6-terra", 1700, 400) = $0.010250
```

**Escenario:** se reconcilia la factura de OpenRouter contra `llm_costo`. La fila
dice $0.008750 en `gpt-5.6-terra` con 1,700/400 tokens; a la tarifa de ese modelo
esos tokens son $0.010250, y OpenRouter va a facturar el desglose por modelo.
Ni el total por modelo ni la tarifa implícita cuadran, y no hay columna que lo
explique. Además `faseDeModelo(res.model, 'cuadre')` (`costos.ts:32`) clasifica por
el slug: si el que responde al final es `anthropic/claude-opus-5`, todo el ciclo se
archiva como `'escalacion'`.

**Consecuencia:** Likida cobra **por liquidación**; el desglose por modelo es el
insumo de ese precio y es el único número del sistema que no se puede reconciliar
contra la factura del proveedor. `59bc958` arregló la suma y conservó la firma de
un solo `model`.

---

### [MEDIO] `getAcumuladoCombustible` sigue sin poder distinguir "todos los gastos" de "los primeros N" (REINCIDENTE, sin cambio)

`src/lib/cuadra/repo.ts:420-427` · `tools.ts:67-69` · `:86`

```
420    .from('gasto')
422    .select('monto, forma_pago')
423    .eq('tenant_id', tenantId)
424    .eq('concepto', 'diesel')
425    .gte('fecha', `${ejercicio}-01-01`)
426    .lte('fecha', `${ejercicio}-12-31`);
427  if (error) throw ...
```

Sin `.limit()`, sin `.range()`, sin `count`, y sin comparar lo recibido contra
nada; después suma en JS (`:429-436`) y el número entra al payload de la tool
(`tools.ts:69`, `:86`). PostgREST corta al `max-rows` del proyecto devolviendo un
**200 con menos filas**, no un error, y `:427` solo mira `error`. Independientemente
del valor real de ese ajuste —que no puedo consultar sin escribir en la base—, el
código **no tiene forma de detectar el corte**.

**Escenario:** 40 tractocamiones, ~2,400 cargas en 2026, $1.8 M de combustible,
$300,000 en efectivo → razón 16.7 %, estado `excedido`, excedente $30,000. Con las
primeras 1,000 filas: ~$750,000 con ~$90,000 en efectivo → razón 12 %, estado
`cerca`. **Sale** hacia el modelo (`tools.ts:86`):
`combustible_efectivo_ejercicio: { estado:"cerca", margen:22500, excedente:0 }` y
`fundamentos` no incluye `rfa-2026-2.9` (`tools.ts:79`).

**Consecuencia:** el contralor oye *"todavía te caben $22,500 en efectivo este
año"* cuando la flota ya perdió la deducción de $30,000. Es el error que
`periodo/combustible.ts` fue escrito para evitar, entrando por el numerador y el
denominador a la vez.

*(Solapa con Modelo de datos. Va aquí porque el consumidor único de esa función es
el payload de una tool, y ahí es donde el número miente.)*

---

### [BAJO] `isTransientError` sigue dando falso positivo con cualquier número de tres cifras que empiece con 5, y su prueba nueva no cubre esa dirección (REINCIDENTE)

`src/lib/llm/openrouter.ts:74` · `openrouter_transitorio.test.ts`

El arreglo añadió la clasificación por tipo **antes** del texto, pero dejó el
regex `/\b(5\d\d|429|408|502|503|504)\b/` sobre el mensaje completo — y ahora
también sobre `err.cause` (`:69-72`), o sea con más superficie. Medido:

```
zod too_big maximum:500                                → true   ← falso positivo
saveLiquidacion: check constraint violada (monto=507.65) → true   ← falso positivo
duplicate key ... "gasto_folio_key" (folio 502)        → true   ← falso positivo
zod too_big maximum:750                                → false
```

En `generateStructured:365` eso convierte un fallo puro de schema en una tercera
llamada pagada a otro proveedor (`:368`) que va a fallar igual. `openrouter_transitorio.test.ts`
prueba cinco casos y **ninguno** es un error no-transitorio con un `5xx` en el
texto: el caso negativo que eligieron es `"400 thinking.budget_tokens..."`.

---

### [BAJO] El mensaje crudo de Postgres viaja al contexto del modelo (REINCIDENTE, sin cambio)

`src/lib/llm/tool-executor.ts:57-62` · `src/lib/llm/openrouter.ts:556`

`executeTool` mete `err.message` sin filtrar en el `ToolExecResult` y
`openrouter.ts:556` lo serializa como contenido del mensaje `role:'tool'`.
Capturado ejecutando `makeExecutor` real:

```json
{"role":"tool","tool_call_id":"c1",
 "content":"{\"error\":\"saveLiquidacion: Could not find the function public.guardar_liquidacion_tx(p_ieps, p_iva, ...) in the schema cache\"}"}
```

El prompt le ordena al modelo *"explícale en lenguaje simple"* (`prompts.ts:25`) y
no le dice nada sobre qué hacer con un error de tool; `guardiaCifras` deja pasar
cualquier texto sin cifras de dinero. Nombres de funciones, tablas y UUIDs
internos pueden salir por WhatsApp al chofer, proyectados en la sala.
`logger.error('tool.error')` (`:56`) ya guarda el detalle donde sí sirve.

---

### [BAJO] El loop-guard ejecuta la ronda 6 y tira el resultado (REINCIDENTE, degradado)

`src/lib/llm/openrouter.ts:489` · `:528-559` · `:561`

`for (let round = 0; round < maxRounds; round++)` completa **y luego ejecuta**: en
la iteración 6 las tools corren, sus resultados se empujan a `convo` (`:559`), el
bucle termina y sale `LoopGuardError` → `PartialExecutionError`. Reproducido:

```
D) err: PartialExecutionError | "Ciclo de tools excedió 6 rondas"
   llamadas al modelo: 6 | ejecuciones de la tool: 6 | partialToolCalls: 6
```

Lo bajo de ALTO a BAJO porque el huérfano ya no ocurre: `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`
está en `.env.local:34` y en `.vercel/.env.production.local`, así que
`processor.ts:581-599` recupera el cierre y manda el resumen determinístico. Lo
que queda es trabajo pagado y tirado —hasta 4 lecturas a Postgres en una ronda que
el modelo nunca verá— dentro de un presupuesto de 40 s.

---

### [BAJO] `ctx.signal` sigue muerto, y `tools.ts` sigue sin una sola prueba (REINCIDENTES, 3.ª ronda)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:33` · `src/lib/cuadra/tools.ts` · `src/lib/cuadra/repo.ts`

- **La señal.** `command grep -rn "signal" src/lib/cuadra/presupuesto.ts repo.ts tools.ts`
  devuelve **una** línea, `presupuesto.ts:94`, que la fabrica. Ni `tools.ts` ni
  `repo.ts` la consumen. `ToolContext.signal` se llena en `run.ts:33` y muere ahí:
  cuando el `AbortController` de `runAgent` dispara a los 40 s, la llamada al
  modelo se corta pero `cuadrarDesdeDB` y `getAcumuladoCombustible` siguen
  corriendo contra Supabase.
- **Las pruebas.** Dos búsquedas distintas, como pide el MAPA:
  `find src -name "tools*.test.ts"` → vacío; `command grep -rln "cuadra/tools"` →
  solo `processor.ts` y sus dos tests, que lo importan por efecto secundario. El
  `try/catch` de `getAcumuladoCombustible` (`tools.ts:70-72`), el push condicional
  de `rfa-2026-2.9` (`:79`) y la forma del objeto `periodo` (`:69`) siguen sin una
  sola aserción. Las 628 pruebas pasan con esa rama rota.
- **El payload.** `tools.ts:86` sigue siendo
  `...(periodo ? { combustible_efectivo_ejercicio: periodo } : {})`: la única
  condición es que la consulta no haya lanzado. `estado === 'holgado'` solo
  gobierna el push de la norma (`:79`), no lo que ve el modelo.

---

## Lo que revisé y está bien

- **La regla estructural se sostiene, reverificada en las tres tools.**
  `consultar_politica` (`tools.ts:31`), `cuadrar_viaje` (`:49`) y
  `guardar_liquidacion` (`:108`) declaran las tres
  `parameters:{type:'object',properties:{},additionalProperties:false}` y los tres
  handlers reciben `_args` sin usarlo (`:34`, `:52`, `:111`). `tenantId`,
  `viajeId`, `operadorId` y `telefono` se arman en `processor.ts:532` desde el
  teléfono verificado y `getOpenViaje`, y viajan por `ToolContext` cerrado en
  `makeExecutor`. **Ninguna tool nueva rompió la regla, y no se registró ninguna
  tool nueva** (`registry.ts:20` sigue con las mismas tres). Los hallazgos de
  arriba sobre `arguments` NO contradicen esto: el modelo puede *escribir* args,
  pero ningún handler los lee, así que sigue sin poder decidir qué fila se toca.
- **El fallback cross-provider ya se dispara con el proveedor caído de verdad**, y
  la prueba reconstruye el error tal como lo arma `openai@6` (mensaje genérico +
  `cause` real), no un `new Error('503 ...')` de conveniencia. Es el arreglo mejor
  hecho de la ronda.
- **La caché de lectura ya no guarda fracasos** (`:554`), con su prueba propia.
- **El truncamiento del ciclo de tools se detecta y falla cerrado** (`:509-517`), y
  `processor.ts:541` distingue "sin texto pero con tools" de "sin texto y sin
  tools". Un turno vacío ya no se confirma como `"Listo. 👍"`.
- **`max_tokens` = 4000 en los dos caminos**, verificado por el cable
  (`max_tokens:4000, reasoning:{effort:'high'}`). Eso también cierra el riesgo
  adyacente que dejé abierto en la ronda 4: `budget_tokens >= 1024` ya cabe.
- **`pdf_generado` ya se consulta** (`processor.ts:674-676`) y el fallo de entrega
  se le dice al operador en vez de dejarlo esperando.
- **Aislamiento por tenant en todo lo que una tool alcanza**: `getViaje`,
  `getOperador`, `getGastos`, `getAcumuladoCombustible` (`repo.ts:423`) y
  `getConfig(ctx.tenantId)` filtran por `tenant_id` **además** del id de la fila.
  Nada de lo que vuelve al modelo puede cruzar de tenant.
- **`tool_calls` con JSON inválido** se contestan con `{"error":"argumentos JSON
  inválidos"}` sin ejecutar nada (`:534-539`), y `guardiaCifras` exige `!t.error`
  (`guardia.ts:37`), así que no habilitan al modelo a narrar cifras.
- **Tool desconocida** → `{success:false, error:"tool desconocida: X"}` y el ciclo
  sigue (`tool-executor.ts:49-51`). **`type !== 'function'`** se contesta con un
  mensaje `tool` válido (`:530-532`), que es lo que impide el 400 de la ronda
  siguiente.
- **`calcCost` con modelo desconocido** estima con la tarifa más cara y avisa
  (`:108-115`), tolerando `:nitro`/`:floor`.
- **El fallback no re-ejecuta mutaciones**: el reintento vive dentro de `complete`
  (`:458-486`); las tools corren después (`:528`).
- **Los ids de `NORMA_POR_DIFERENCIA`** (`por_diferencia.ts:26-46`) existen todos
  en `NORMAS` (`indice.ts`), incluido el `rfa-2026-2.9` que `tools.ts:79` empuja a
  mano: `NORMAS[id].citas[0]` (`tools.ts:89`) no puede reventar por un id huérfano.
- **Solo hay UN `generateStructured` en el repo** (`ocr.ts:198`) — verificado con
  `command grep` sobre todo `src/`. La superficie del encargo de esta ronda es
  exactamente ese esquema, y lo barrí campo por campo.
- **Línea base intacta:** `npm test` → **628 pasan, 1 saltado, 64 archivos**;
  `git status` solo muestra `docs/auditoria-5/` sin trackear. No modifiqué ningún
  archivo del repo; todo lo de arriba se midió con scripts en `/tmp` importando
  los módulos reales.

---

## Lo que NO alcancé a revisar

- **Nada contra la API real.** Todo se midió con un stub en el lugar del SDK. Sigue
  sin confirmar: si `completion_tokens` de OpenRouter incluye los tokens de
  razonamiento (de eso depende que `calcCost` los cobre o los regale con
  `reasoning:'high'`), y si `res.model` trae sufijo de proveedor en el camino de
  tools.
- **Con qué frecuencia el modelo emite `arguments` distintos de `{}`.** Establecí
  que nada se lo impide (no hay `strict:true` en los schemas de tools) y que el
  código ya lo asume en dos lugares, pero no medí la tasa contra el proveedor real.
  Es lo primero que probaría con una sola llamada de verdad antes del 6-ago, porque
  de esa tasa dependen el ALTO y el MEDIO de la caché.
- **El `max-rows` real de PostgREST** en el proyecto de Supabase, y por tanto el
  umbral exacto donde el contador del 15 % empieza a mentir. Lo verificable en el
  código es que no hay forma de detectar el corte.
- **La tasa de lectura del QR sobre CFDI impresos** (no tickets térmicos). De ella
  depende cuánto pesa de verdad el hueco de `cfdi_uuid`; con los tickets de campo
  está documentada en 0, con CFDI no la tengo.
- **`tool_calls` en streaming.** El cliente no lo usa; si alguien lo enciende, todo
  el análisis de `openrouter.ts:528-559` hay que rehacerlo.
- **Prompt caching:** cero `cache_control` en el repo. Con hasta 6 rondas que
  reenvían el system prompt completo es un costo que va a crecer; no lo cuantifiqué.
- **El agente `orchestrator`** (`registry.ts:7-13`, `tools: []`): sigue sin
  llamarlo nadie, así que no evalué `generateWithTools` con `tools: []` (`:462-463`
  mandan `undefined`).
