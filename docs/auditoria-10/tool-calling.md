# Tool calling — auditoría 10

**Nota: 7/10** (antes 8). Razón del movimiento: **mirada más profunda (el código
no cambió, la nota anterior estaba inflada)**.

Confirmado que el código es el mismo: `git log 848487a..HEAD -- src/lib/llm
src/lib/cuadra/tools.ts` no devuelve nada. Los siete reincidentes **siguen los
siete ahí** — verificados uno por uno abajo con `archivo:línea` de hoy. Tres de
ellos cambian de severidad porque la revisión de hoy encontró que dos eran más
graves de lo que decían y uno tenía el escenario mal planteado.

**Por qué baja.** El ancla de 8 es doble: «ninguna tool acepta datos del modelo
**y el camino con fallback tiene prueba**». La primera mitad se cumple y la
verifiqué línea por línea. La segunda **no**: hay tres caminos con fallback en
el gateway (`openrouter.ts:157`, `:369`, `:518`) y sólo uno tiene prueba que lo
ejecute — el de `generateWithTools`. El del OCR (`generateStructured`), que es
el camino feliz del demo del 6-ago, no tiene ninguna. Y el fallback de
escalación que `models.ts` documenta (`cuadre_fallback` → Opus 5) **no lo llama
nadie**: es configuración muerta. Súmese que las dos tools que deciden qué norma
fiscal puede citar el agente frente al contralor siguen sin una sola prueba que
ejecute su handler, y que su prueba más cercana **reimplementa a mano** el
cuerpo de la función en vez de invocarla. Eso es exactamente el ancla de 6
(«la regla se respeta pero el cliente que la implementa no tiene pruebas
unitarias») aplicada a `tools.ts`, compensada por un `openrouter.ts` que sí está
bien probado. 7.

Riesgo mayor hoy: **`cuadrar_viaje` puede romperse sin que nada se ponga en
rojo** — ni el tipo, ni el lint, ni las 1,570 pruebas cruzan el nombre de una
tool entre sus tres declaraciones, ni ejecutan su handler.

---

## Hallazgos

### [MEDIO] La atribución modelo↔tokens tras el fallback está mal en los TRES caminos, no sólo en el ciclo de tools (REINCIDENTE, ampliado)

`src/lib/llm/openrouter.ts:329` · `:339` · `:537` · `:394-415` ·
`src/lib/cuadra/processor.ts:1171` · `:1200` · `src/lib/cuadra/intake/ocr.ts:283`

La ronda 9 reportó esto sólo para `generateWithTools`. Hoy lo verifiqué en los
tres sitios y en dos de ellos es peor:

1. **`generateStructured`, camino de ÉXITO** (`:329`): devuelve
   `model: usage.model` —el modelo del ÚLTIMO intento— junto con `...gastado`,
   que es el acumulado de TODOS los intentos (`:265-270`, `:303`).
   Entra: Gemini 3.6 Flash falla dos veces con JSON malo (1,200 in / 300 out
   cada una) y `anthropic/claude-haiku-4.5` resuelve al tercero (1,200 / 300).
   Sale: `{ model: 'anthropic/claude-haiku-4.5', tokensIn: 3600, tokensOut: 900 }`.
   `ocr.ts:283` lo copia a `costo.modelo` y el processor escribe UNA fila
   diciendo que Haiku consumió 3,600 tokens de entrada. 2,400 fueron de Google.
2. **`generateStructured`, camino de ERROR** (`:339`, `conGastado`):
   `err.usage = { model, ...gastado }` usa `model` = el **primario**, aunque el
   consumo acumulado incluya el del fallback. Es el error opuesto al de arriba,
   en la misma función.
3. **`generateWithTools`** (`:537`): `used = res.model || activeModel` conserva
   sólo el modelo de la última ronda. El importe (`:536`) sí suma bien ronda a
   ronda — eso lo confirmé y tiene prueba (`openrouter_fallback_costo.test.ts:55`).
4. **`PartialExecutionError` no lleva el modelo** (`:394-415`): el constructor
   recibe `message, cause, partialToolCalls, tokensIn, tokensOut, cost` y nada
   más, aunque `used` y `activeModel` están en alcance en el `catch` de `:603`.
   Por eso `processor.ts:1200` escribe literalmente `modelo: 'parcial'` y
   `faseDeModelo('', 'cuadre')`. Es la rama que el demo corre con
   `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, o sea la que más consume.

Consecuencia: quien reconcilie `llm_costo` contra la factura de OpenRouter por
proveedor no puede, y las filas que peor mienten son las del caso caro. Likida
va a cobrar POR LIQUIDACIÓN: el costo unitario por proveedor es la defensa del
margen, y hoy no existe.

Causa raíz probable: el `model` se trata como escalar de la llamada completa
cuando el consumo es de N llamadas a M proveedores.

---

### [MEDIO] `cuadrar_viaje` y `consultar_politica` siguen sin prueba de handler, y la prueba que parece cubrir a la segunda REIMPLEMENTA su cuerpo (REINCIDENTE, agravado)

`src/lib/cuadra/tools.ts:81-136` · `:25-76` ·
`src/lib/cuadra/normas/permiso_politica.test.ts:31-43`

Repetido hoy: `grep -rn "executeTool(" src --include=*.test.ts` devuelve **una
sola línea** en todo el repo — `tools_cableado.test.ts:100`, y sólo para
`guardar_liquidacion`. Ninguna prueba ejecuta jamás el handler de las otras dos.

Lo que la ronda 9 no dijo con suficiente fuerza: `permiso_politica.test.ts` no
es que «reconstruya la forma»; **copia el cuerpo de la función**. Sus líneas
31-43 son carácter por carácter el `return` de `tools.ts:65-74` (`norma_id`,
`cita: NORMAS[id].citas[0]`, `jerarquia`, `verificada: … !== 'sin_verificar'`,
`vinculante`). Es un clon que se prueba a sí mismo: si alguien edita el handler,
la copia sigue verde y demuestra que la copia funciona.

Escenario con valores: invertir `tools.ts:117` de
`periodo.estado !== 'holgado'` a `===` quita el permiso de citar
`rfa-2026-2.9` justo cuando la flota va rebasando el 15% de combustible en
efectivo — que es cuando importa —, y se lo da cuando va holgada. El agente
explica el diésel en efectivo citando sólo LISR 27-III («no deducible, punto»)
en vez de LISR 27-III + la facilidad del 15%. O invertir `:131` /`:71`
(`verificada`) hace que el agente afirme tajante sobre una ficha
`sin_verificar`. Ninguna de las dos mutaciones pone en rojo ninguno de los
1,570 tests.

Consecuencia: las dos tools que deciden qué ley puede invocar el producto
delante del contralor son las únicas sin arnés. Es el mismo patrón que la
mutación M19 documentada en `tools_cableado.test.ts:11-20`, que ya costó un
ALTO reincidente en la ronda 5.

Causa raíz probable: la prueba se escribió un nivel por debajo del que tiene el
riesgo (`normasDePolitica`), no en la frontera (`executeTool`).

---

### [MEDIO] El nombre de una tool se declara TRES veces y nada —ni el tipo, ni el lint, ni una prueba— cruza las tres (NUEVO)

`src/lib/llm/tool-executor.ts:35-39` · `src/lib/agents/types.ts:11` ·
`src/lib/agents/registry.ts:21` · `src/lib/cuadra/tools.ts:25,30` ·
`src/lib/agents/run.ts:30`

Cada tool existe con su nombre escrito en tres lugares independientes, los tres
`string` suelto:

1. la llave del registro — `registerTool('consultar_politica', …)` (`tools.ts:25`);
2. el nombre que ve el modelo — `schema.function.name` (`tools.ts:30`);
3. la lista del agente — `AGENT_REGISTRY.liquidacion.tools` (`registry.ts:21`),
   tipada `tools: string[]` (`types.ts:11`).

`toolSchemas` resuelve por (1) y **descarta en silencio lo que no encuentra**:
`.map(n => REGISTRY.get(n)?.schema).filter(Boolean)` (`:36-38`). `executeTool`
resuelve por (2). No hay un solo test que toque `toolSchemas` ni
`AGENT_REGISTRY` (`grep -rn "toolSchemas\|AGENT_REGISTRY" src --include=*.test.ts`
→ vacío).

Dos escenarios concretos, ambos con las 1,570 pruebas, `tsc --noEmit` y el lint
en verde:

- **(1) se desalinea de (3):** alguien renombra `registerTool('cuadrar_viaje')`
  a `'cuadrar_viaje_v2'` y olvida `registry.ts`. `toolSchemas` devuelve **2**
  esquemas en vez de 3, sin error ni log. El modelo nunca ve `cuadrar_viaje`,
  no cuadra nunca; `guardiaCifras` calcula `cuadro = false`
  (`guardia.ts:38-40`) y el chofer recibe texto sin números o el genérico de
  fail-closed. El viaje no cierra.
- **(1) se desalinea de (2):** la llave dice `'consultar_politica'` y
  `schema.function.name` dice `'consultar_politicas'`. La tool se anuncia al
  modelo, el modelo la llama por el nombre anunciado, y
  `executeTool('consultar_politicas')` cae en `tool-executor.ts:49-51`
  devolviendo `{"error":"tool desconocida: consultar_politicas"}` al modelo —
  seis rondas seguidas, seis llamadas pagadas, y sale por `LoopGuardError`
  (`openrouter.ts:600`).

Consecuencia: el único punto donde la superficie de tools completa puede
desaparecer sin dejar una prueba en rojo, a cuatro días del demo. Le cobra la
factura a quien mantenga esto, y en el peor caso al contralor en la sala.

Causa raíz probable: tres cadenas sueltas que deben coincidir y ningún
invariante —de tipo o de prueba— que lo exija.

---

### [MEDIO] `guardar_liquidacion` devuelve 9.7 KB al modelo para que use 120 bytes, con los RFC, UUID y rutas de foto de cada comprobante dentro (NUEVO)

`src/lib/cuadra/tools.ts:209` · `src/lib/llm/openrouter.ts:595` · `:564,598`

`tools.ts:209` mete el snapshot **completo** (`liq`) en el resultado de la tool.
El comentario de `:196-208` justifica bien POR QUÉ el snapshot tiene que viajar
—para que `guardia.ts:69-72` lo reuse y no recalcule—, pero lo manda por el
canal que además alimenta al modelo: `openrouter.ts:595` hace
`JSON.stringify(exec.result)` y lo empuja a `convo` (`:598`), donde se reenvía
en el prompt de cada ronda posterior.

Medido con una liquidación de 12 comprobantes con los campos que `repo.ts:474`
lee de verdad (`rfc_emisor`, `rfc_receptor`, `cfdi_uuid`, `imagen_url`,
`ocr_extra`, `ieps_traslado`…) y 3 diferencias con su `nota`:

```
JSON.stringify(result)            → 9,710 bytes  (~2,700 tokens)
lo que el modelo realmente usa    →   120 bytes  (liquidacion_id, estatus,
                                       diferencia, pdf_generado,
                                       pdf_contralor_generado)
```

Consecuencia doble:
- **Costo.** ~2,700 tokens extra en el prompt del turno de cierre, a $2/1M de
  entrada de Sonnet 5 son ~$0.005 por ronda posterior — 11-18% del objetivo de
  $0.03-0.05 por liquidación declarado en `models.ts:17`, gastados en datos que
  el modelo no lee.
- **Superficie de datos.** 12 RFC de emisor, 12 RFC de receptor, 12 UUID de
  CFDI y 12 rutas de las fotos de los comprobantes salen al proveedor en el
  turno de cierre. **No es exposición a una persona** —lo refuté: `guardia.ts:83,114`
  sustituye SIEMPRE el texto cuando `cerro` es true, así que nada de esto puede
  llegar al chofer por WhatsApp, y el gateway fuerza ZDR (`openrouter.ts:123`)—
  pero sí reparte los mismos datos fiscales a un proveedor más de los
  necesarios (Sonnet 5, y GPT-5.6-terra si el fallback entra), cuando la ficha
  de soberanía de `models.ts:19-23` dice explícitamente «SOLO a proveedores
  US/EU con ZDR» — o sea, el criterio es de minimización.

Causa raíz probable: un solo `result` sirve a dos consumidores con necesidades
opuestas (la guardia necesita todo, el modelo casi nada) y no hay separación
entre lo que vuelve al llamador y lo que vuelve al modelo.

---

### [MEDIO] El fallback del OCR —el camino feliz del demo— no tiene ninguna prueba, y quema una segunda llamada contra el proveedor caído antes de usarlo (NUEVO)

`src/lib/llm/openrouter.ts:345-379` (`:364` y `:369-375`) · `:19-36` ·
`src/lib/cuadra/intake/ocr.ts:253-261`

Hay tres fallbacks cross-provider en el gateway y **sólo uno tiene prueba que lo
ejecute**: `openrouter_fallback_costo.test.ts:55-67` cubre
`generateWithTools` (y lo cubre bien: monta tool_calls reales y verifica el
precio por ronda — lo abrí precisamente porque el encargo advertía del patrón
«prueba que lee el fuente», y este no lo es). Los otros dos no tienen ninguna:

- `generateResponse` (`:157`) — sin prueba.
- `generateStructured` (`:369-375`) — sin prueba. Es el que usa `ocr.ts:253`
  con `role: 'ocr'`, o sea el que salva la demo si Gemini se cae mientras el
  contralor mira la pantalla. `openrouter_costo.test.ts` y
  `openrouter_truncado.test.ts` cubren truncado, JSON malo y presupuesto —
  ninguno llega a `attempt(fallback, note)`.

Y en ese camino, además, el orden está mal. `generateResponse` cae al fallback
inmediatamente (`:157`). `generateStructured` **no**: tras el fallo transitorio
`e1` ejecuta `attempt(model, note)` (`:364`) —una segunda llamada completa al
MISMO proveedor caído, con la imagen del ticket adjunta— y sólo si esa también
falla mira el fallback (`:369`).

Escenario con valores: OpenRouter devuelve 503 para `google/gemini-3.6-flash`.
`getClient()` (`:23-34`) no fija `maxRetries`, así que hereda el default 2 del
SDK de OpenAI: cada `attempt()` son hasta 3 peticiones con backoff (~0.5s +
~1s). Intento 1 ≈ 2.2s, intento 2 contra el mismo proveedor muerto ≈ 2.2s, y
recién entonces se prueba `anthropic/claude-haiku-4.5`. Son ~4.4s tirados por
foto, dentro de una invocación de 60s que corre el lote de fotos con
`Promise.all` y que ya reserva 12s para el cierre (`presupuesto.ts:70`).

Consecuencia: el mecanismo que existe para que «un provider caído nunca sea un
error visible para el operador» (`openrouter.ts:52-53`) es, en el camino del
OCR, código que nunca se ha ejecutado en una prueba y que llega tarde. En la
sala eso es «no pude leer tu ticket» por un parpadeo que el diseño prometía
tapar.

Causa raíz probable: la escalera de reintentos de `generateStructured` está
ordenada por tipo de fallo (formato → proveedor) y no por costo del reintento.

---

### [BAJO] `isTransientError` sí tiene un falso positivo real — pero no el que reportó la ronda 9 (REINCIDENTE, re-escopado)

`src/lib/llm/openrouter.ts:73-80` (regex en `:78`) · `:322` · `:369`

**Primero, la refutación.** El escenario de la ronda 9 —«un error de Postgres
tipo `check constraint violada (monto=507.65)` desde `saveLiquidacion`
clasificaría como transitorio»— **no puede ocurrir**. `isTransientError` sólo se
invoca sobre errores de `client.chat.completions.create` (`:157`, `:369`,
`:518`); los errores de handler los captura `tool-executor.ts:55-63` y nunca
llegan ahí. Ese camino no existe.

**Pero el falso positivo sí existe**, por otra puerta. `:73-75` concatena el
mensaje del error **y el de su `cause`**, y en `:322`
`new StructuredError('JSON parse falló', e, …)` pone como `cause` el
`SyntaxError` de `JSON.parse`, cuyo mensaje lleva el **offset**. Reproducido en
este repo:

```
Unterminated string in JSON at position 536 (line 1 column 537) → transitorio: true
Unterminated string in JSON at position 408 (line 1 column 409) → transitorio: true
```

Cualquier JSON de OCR que se rompa en un offset de 500-599 (o exactamente en
408, 429, 502-504) hace que `:369` clasifique un error de FORMATO como
proveedor caído y dispare una tercera llamada de visión completa contra
`anthropic/claude-haiku-4.5`, que va a fallar por lo mismo. Un ticket de ~500
bytes de JSON es lo típico, así que la ventana no es exótica.

Consecuencia: una llamada de visión pagada de más por cada ticket cuyo JSON se
rompa en esa ventana, y un `llm.fallback` en el log que dice «proveedor caído»
cuando el proveedor está sano — que es la peor clase de línea de log: la que
manda a diagnosticar al lado equivocado.

Causa raíz probable: clasificar por texto libre sobre un mensaje que puede
contener cualquier número de tres dígitos.

---

### [BAJO] `ToolCallRecord.args` sigue sin describir qué produjo el `result` (REINCIDENTE — bajo de MEDIO a BAJO)

`src/lib/llm/openrouter.ts:582` · `:594`

Sin cambio respecto a la ronda 9: cuando la caché acierta, `executed.push`
guarda el `args` de ESTE llamador con el `result` de OTRO (`:582`, caché entre
rondas) o del primero de la ronda (`:594` vía `inRound`, `:585-587`).

**La bajo de severidad porque hoy la consecuencia es exactamente cero y lo
verifiqué:** `grep -rn "\.args\b" src --include=*.ts` fuera de `openrouter.ts`
no devuelve nada. `guardia.ts` lee `.toolName`/`.error`/`.result`,
`fundamento.ts` lee `.result`, `processor.ts:1173` lee `.toolName`. Nadie
persiste ni consulta `.args`. Es deuda de trazabilidad para el día que una tool
sí lleve parámetros — y ese día la nota de `tool-executor.ts:98-104` ya avisa
que hay que revisar esta llave.

---

### [BAJO] `ctx.signal` sigue sin consumirse en ningún handler (REINCIDENTE, mitigado)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:32-34,45` ·
`src/lib/cuadra/tools.ts` (sin ninguna aparición de `signal`) ·
`src/lib/cuadra/presupuesto.ts:99`

`run.ts:34` construye `ctx.signal` desde el `AbortController` del turno (40s,
`processor.ts:1174: timeoutMs: reloj.acotar(40_000)`) y lo pasa a
`makeExecutor`. `grep -n "signal" src/lib/cuadra/tools.ts` → vacío. Los tres
handlers lo ignoran. Mitigado, no cerrado: todo lo que tocan pasa por
`acotada()` con su `TOPE_CONSULTA_MS` de 8s propio, así que nada se cuelga para
siempre; lo que no ocurre es que el reloj del turno cancele una consulta en
vuelo. Peor caso vigente: el turno se agota, `generateWithTools` aborta, y una
consulta de `guardar_liquidacion` sigue corriendo hasta 8s más contra su propio
reloj.

---

### [BAJO] El `error.message` crudo de Postgres sigue entrando sin filtro al contexto del modelo (REINCIDENTE)

`src/lib/llm/tool-executor.ts:60` · `src/lib/llm/openrouter.ts:595` ·
`src/lib/cuadra/repo.ts:536`

Sin cambio. `executeTool` pone `err.message` tal cual en `ToolExecResult.error`
(`:60`) y `openrouter.ts:595` lo serializa en el `content` del mensaje
`role:'tool'`. El ejemplo más directo sigue siendo `guardar_liquidacion`
(`tools.ts:181`), que llama `saveLiquidacion` sin try/catch propio: si el RPC
`guardar_liquidacion_tx` devuelve error, `repo.ts:536` lanza
`` `saveLiquidacion: ${error.message}` `` con el texto de Postgres —nombre de
función plpgsql, constraint, columna— y eso entra al contexto del modelo en la
tool que cierra el dinero.

Consecuencia acotada, y lo verifiqué: si `guardar_liquidacion` falla,
`guardia.ts:51` calcula `cerro = false` y `:38-40` `cuadro = false`, así que el
texto sólo se sustituye si el modelo narró cifras — un mensaje del tipo «se
trabó por un problema con `liquidacion_viaje_id_key`» puede salir tal cual al
chofer. Deuda de higiene, no de dinero.

---

### [BAJO] El loop-guard sigue ejecutando la ronda 6 entera antes de tirar el resultado (REINCIDENTE)

`src/lib/llm/openrouter.ts:528-600`

Sin cambio. El `for` corre las 6 rondas completas: las tools de la sexta se
ejecutan, se pagan, se serializan a `convo` (`:598`) y sólo entonces `:600`
lanza `LoopGuardError`, que `:603` envuelve en `PartialExecutionError`.
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1` sigue resolviendo el huérfano de cara al
operador (`processor.ts:1207-1210`). Lo que se pierde es la oportunidad de usar
la última ronda para cerrar con lo que ya se tiene en vez de correr a ciegas
hasta el tope.

---

### [BAJO] El rol `cuadre_fallback` está declarado, presupuestado y documentado, y no lo ejecuta nadie (NUEVO)

`src/lib/llm/models.ts:29,40,50,64` · `src/lib/cuadra/costos.ts:103`

`grep -rn "cuadre_fallback" src` devuelve **sólo** las cuatro declaraciones de
`models.ts`. Nadie llama `modelFor('cuadre_fallback')` y ningún agente usa ese
rol (`registry.ts` sólo usa `router` y `cuadre`). O sea:

- «Escalación por baja confianza / monto alto / caso ambiguo» (`models.ts:38-40`)
  y «Fallback Opus por confianza» (`:14`) describen algo que el código no hace.
- La fase de costo `'escalacion'` de `costos.ts:103`
  (`if (modelo.includes('opus')) return 'escalacion'`) es inalcanzable: ningún
  camino puede producir un slug con `opus`, porque
  `FALLBACK['anthropic/claude-sonnet-5']` es `'openai/gpt-5.6-terra'`
  (`openrouter.ts:57`), no Opus.
- `FALLBACK['anthropic/claude-opus-5']` (`openrouter.ts:58`) y
  `PRICES['anthropic/claude-opus-5']` (`:88`) son entradas muertas.

Consecuencia: quien lea `models.ts` para saber qué corre en producción —o quien
mire un tablero de costo por fase y no vea nunca `escalacion`— está leyendo una
promesa, no el sistema. Se arregla borrando o implementando, pero hoy miente.

---

## Lo que revisé y está bien

- **La regla estructural está intacta, releída completa.** Las tres —y sólo
  tres— tools registradas (`tools.ts:25,81,139`) declaran
  `parameters: { type:'object', properties: {}, additionalProperties:false }`
  (`:31,87,146`). Los tres handlers reciben `_args` y ninguno lo lee.
  `tenantId`/`viajeId`/`operadorId`/`telefono` salen siempre de `ToolContext`,
  resuelto en `run.ts:34` desde `processor.ts:1156`. **El modelo no puede
  influir en qué fila se escribe**: `saveLiquidacion(ctx.tenantId, liq, …)` y
  las rutas de PDF (`tools.ts:176-177`) se construyen sólo con IDs de servidor.
- **La dedup de mutaciones mira el efecto y aguanta concurrencia.**
  `makeExecutor` (`tool-executor.ts:94-120`) cachea la **promesa** antes del
  `await` (`:110-111`), llavea por nombre y no por args (`:105`), y borra el
  fallo comparando la promesa (`:116`). `tool_executor_concurrente.test.ts` y
  `tool-executor.test.ts` (9 pruebas) lo ejercitan de verdad, incluyendo
  `null` como args y las claves en otro orden.
- **La caché de lectura acierta y no fosiliza fallos.** `llaveDeCache`
  (`openrouter.ts:446-458`) colapsa por nombre sólo las tools sin `properties`,
  y `:593` sólo cachea el éxito. `openrouter_cache_llave.test.ts` (3) y
  `openrouter_cache_fallo.test.ts` (2) ejecutan el ciclo real con el SDK
  mockeado — no leen el fuente.
- **La respuesta truncada NO se trata como completa** en el ciclo de tools:
  `openrouter.ts:548-556` lanza `TruncatedError` antes de devolver, y
  `openrouter_truncado_tools.test.ts` (4) prueba el caso de `content` vacío,
  que es el que producía «Listo. 👍» sobre un turno donde no pasó nada.
- **Truncamiento CON `tool_calls` no vacío** — lo que la ronda 9 dejó como «no
  alcancé a revisar». Lo perseguí y **falla cerrado**: con `properties: {}` los
  `arguments` son `{}` (2 caracteres), así que un corte a media emisión deja o
  bien un JSON inválido → `openrouter.ts:575-578` empuja `args_parse` y **no
  ejecuta el handler**, o bien un `function.name` truncado
  (`"guardar_liquidac"`) → `tool-executor.ts:49-51` responde «tool
  desconocida». Ninguna de las dos ramas escribe nada. No es hallazgo.
- **El costo por ronda es correcto tras el fallback** (`openrouter.ts:536`,
  `activeModel` movido por `complete` antes de devolver): el importe está bien,
  sólo la etiqueta del modelo está mal (primer hallazgo).
- **Ninguna tool nueva rompió la regla**: sigue habiendo exactamente 3
  `registerTool(` en todo `src`, todas en `tools.ts`.
- **El índice de normas que las tools emiten no puede reventar el handler**:
  temí un `NORMAS[id].citas[0]` sobre un id inexistente en `tools.ts:126`
  (`normasDe` no filtra, a diferencia de `normasDePolitica`, que sí lo hace en
  `por_diferencia.ts:139`), pero `por_diferencia.test.ts:50-57` obliga a que
  todo id de `NORMA_POR_DIFERENCIA` exista en `IDS_NORMA`. Cerrado por prueba.
- **Aislamiento por tenant** en las cuatro funciones de `repo.ts` que tocan las
  tools (`getViaje`, `getOperador`, `saveLiquidacion` vía `p_tenant`,
  `getAcumuladoCombustible`): todas filtran por `tenant_id`.
- **Compuerta corrida hoy**: `npx vitest run src/lib/llm src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/normas/` → 17 archivos, **144 pruebas, 0 fallos**. Sin tocar
  ningún archivo del repo.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** Todo el gateway está probado con
  el SDK mockeado. En particular no verifiqué que un `assistant` con
  `tool_calls` emitido por Anthropic se acepte tal cual cuando la ronda
  siguiente la responde OpenAI (`openrouter.ts:564` + `:521`): confío en que
  OpenRouter normaliza los `tool_call.id`, pero es una suposición, y es
  exactamente el camino que el fallback recorre a mitad de ciclo.
- **Con qué frecuencia el modelo real emite `arguments` no vacíos.** Los
  schemas no llevan `strict:true` y no medí la tasa contra el proveedor real —
  importa sólo para la contabilidad de `ToolCallRecord.args`, no para el efecto.
- **Si el modelo llama `guardar_liquidacion` antes de tiempo.** El diseño le da
  al modelo la decisión de CUÁNDO (deliberado, y el ancla lo bendice), pero la
  única precondición del handler es `if (!ctx.viajeId)` (`tools.ts:150`) y el
  cierre es **irreversible** de cara al chofer (`processor.ts:1118`: «Ese viaje
  ya quedó cerrado 👍»). El prompt le ordena cerrar ante un «ya» o un «es todo»
  (`prompts.ts:21,27`). No puedo escribir el escenario con valores sin correr
  el modelo real, así que **no lo reporto como hallazgo** — pero es donde
  pondría el siguiente ensayo del guion del demo.
- **`tool_calls` en streaming** y **prompt caching** (`cache_control`): siguen
  sin usarse; no los evalué.
- **El resto de `processor.ts`** (1,400+ líneas) más allá de los tres puntos
  donde cruza mi frontera (`:9`, `:1171`, `:1200`). Es rubro de otro auditor.
