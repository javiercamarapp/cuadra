# Tool calling — auditoría 10 (continuación 3-ago)

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura**.

El código propio del rubro **no cambió una línea**: `git log 96dc577..HEAD --
src/lib/llm src/lib/cuadra/tools.ts src/lib/agents` no devuelve nada, y
`git diff --stat` sobre esas rutas sale vacío. Lo que cambió es que llegó el
**consumidor** de la deuda más vieja del rubro. La atribución de costo por
modelo —mal desde la ronda 6, reportada tres rondas seguidas con la atenuante
«hoy no la lee nadie»— hoy se pinta como hecho en **siete pantallas de
`/admin`** (`porModelo` en `model-ops`, `costos-facturacion`, `analitica`,
`integraciones`, `agente-ocr`, `admin/page.tsx`, y `getCostoPorFaseModelo` en
Model Ops). La atenuante se acabó: la fila que dice «Anthropic gastó $X» ya se
enseña, y junto a ella hay filas de tres «modelos» que ningún proveedor facturó
nunca (`parcial`, `ocr`, `whatsapp-utility`).

Además, la mirada de esta ronda encontró que el resultado de
`guardar_liquidacion` es **el único camino por el que texto del papel llega sin
sanear al modelo del cuadre** — `history` son sólo turnos de conversación
(`processor.ts:1125`), así que `ocrExtra` no entra por ningún otro lado.

Lo que sostiene la nota en 6 y no más abajo: **la regla estructural sigue
intacta y la verifiqué línea por línea otra vez** —tres `registerTool` en todo
`src`, los tres con `properties: {}`, los tres handlers con `_args` sin leer, y
`tenantId`/`viajeId` siempre de `ToolContext`—, y `/admin` **no toca el camino
de tools ni el del modelo** (ver abajo). El ancla de 8 sigue cumpliéndose sólo
a la mitad: de los tres caminos con fallback del gateway, uno tiene prueba.

Riesgo mayor hoy: **el panel de costo de Likida ya presenta como medición una
atribución que el código no sabe hacer**, y es el panel con el que se va a fijar
el precio por liquidación.

---

## Hallazgos

### [ALTO] La atribución modelo↔tokens tras el fallback está mal en los tres caminos, y ahora se pinta como hecho en siete pantallas de `/admin` (REINCIDENTE desde ronda 6, agravado)

`src/lib/llm/openrouter.ts:329` · `:339` · `:537` · `:394-415` ·
`src/lib/cuadra/processor.ts:1171` · `:1199-1200` ·
`src/lib/cuadra/intake/ocr.ts:281` · `:470` ·
`src/lib/admin/negocio.ts:87-89` · `:178-193` ·
`src/app/admin/model-ops/page.tsx:137-146` ·
`src/app/admin/costos-facturacion/page.tsx:110-118`

Los cuatro defectos, verificados hoy en el árbol de hoy:

1. **`generateStructured`, camino de ÉXITO** (`:329`): devuelve
   `model: usage.model` —el modelo del ÚLTIMO intento— junto con `...gastado`,
   que es el acumulado de TODOS los intentos (`:265-270`, `:303`).
2. **`generateStructured`, camino de ERROR** (`:339`, `conGastado`):
   `err.usage = { model, ...gastado }` usa `model` = el **primario**, con el
   consumo acumulado que incluye el del fallback. El error opuesto, en la misma
   función.
3. **`generateWithTools`** (`:537`): `used = res.model || activeModel` conserva
   sólo el modelo de la última ronda. El *importe* (`:536`) sí suma bien ronda a
   ronda y tiene prueba (`openrouter_fallback_costo.test.ts:46-80`); lo que
   está mal es la etiqueta.
4. **`PartialExecutionError` no lleva el modelo** (`:394-415`): el constructor
   recibe `message, cause, partialToolCalls, tokensIn, tokensOut, cost` y nada
   más, aunque `used` y `activeModel` están en alcance en el `catch` de `:603`.
   Por eso `processor.ts:1200` escribe literalmente `modelo: 'parcial'`.

Escenario con valores (camino 1, el del OCR, que es el del demo): OpenRouter
devuelve 503 dos veces para `google/gemini-3.6-flash` (1,200 in / 300 out cada
una) y `anthropic/claude-haiku-4.5` resuelve al tercero (1,200 / 300).
`generateStructured` devuelve
`{ model: 'anthropic/claude-haiku-4.5', tokensIn: 3600, tokensOut: 900 }`;
`ocr.ts:470` lo copia a `costo.modelo` y `processor.ts:315`/`:508` escriben UNA
fila en `llm_costo` diciendo que Haiku consumió 3,600 tokens de entrada. 2,400
fueron de Google.

**Lo nuevo de esta ronda es dónde termina esa fila.** `negocio.ts:87-89`
agrupa `llm_costo.modelo` sin tocarlo y `model-ops/page.tsx:141` lo pinta en
`font-mono` con un avatar de proveedor derivado de la primera letra del slug
(`:31-36`). Con la rama de cierre parcial —la que el demo corre con
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1` y la que más tokens consume— la consola
enseña un renglón:

```
[P]  parcial                    12 llamadas · todas las fases     $0.84
```

`parcial` no es un modelo. Tampoco `ocr` (`ocr.ts:281`, el fallback cuando el
error no trae `usage.model`) ni `whatsapp-utility` (`costos.ts:87`, ése sí a
propósito). Bajo el encabezado **«Costo por modelo»** de
`costos-facturacion/page.tsx:103`, los tres se leen como proveedores.

Consecuencia: el contralor no ve esto —es la consola de Likida—, pero sí la ve
quien fija el precio. Likida va a cobrar POR LIQUIDACIÓN: el costo unitario por
proveedor es la defensa del margen, y hoy la única pantalla que lo presenta
muestra una cifra que el código no sabe calcular, sin ninguna marca de que sea
una estimación. Es exactamente el modo de fallo que `costos.ts:5-13` declara
prohibido —«cero sólo se pinta cuando cero es una medición»— aplicado a la
columna de al lado.

Causa raíz probable: `model` se trata como escalar de la llamada completa
cuando el consumo es de N llamadas a M proveedores, y `llm_costo.modelo` no
distingue «slug de proveedor» de «etiqueta interna».

---

### [MEDIO] El resultado de `guardar_liquidacion` es el único canal por el que texto del papel llega SIN SANEAR al modelo del cuadre (NUEVO)

`src/lib/cuadra/tools.ts:209` · `src/lib/cuadra/intake/ocr.ts:404` · `:418` ·
`src/lib/cuadra/intake/cfdi.ts:251` · `:164` ·
`src/lib/cuadra/repo.ts:508,519` · `src/lib/llm/openrouter.ts:595,598` ·
`src/lib/cuadra/processor.ts:1125`

El intake sanea casi todo lo que sale de una foto: `producto` pasa por
`sanitizarProducto`, `estacion`/`emisor`/`fechaImpresa` por `sanitizarTexto`
(cap de 80 chars, sin `<>\``, sin caracteres de control), `folio`/`webId` por
`sanitizarFolio` (charset y 40 chars). **Dos campos de `ocrExtra` no pasan por
nada**:

- `fechaRaw: data.fecha ?? undefined` (`ocr.ts:404`) — salida cruda del modelo
  de visión; el schema la declara `z.string().nullable()` (`ocr.ts:44`), sin
  `max` ni regex.
- `codigoBarras: codigos.find((c) => c.formato !== 'QRCode')?.texto`
  (`ocr.ts:418`) — el texto decodificado tal cual por zxing
  (`cfdi.ts:251` → `clasificarQr` devuelve `{ texto: t }` sin tocarlo,
  `cfdi.ts:164`), sin cap de longitud.

Esos dos campos viajan a `gasto.ocr_extra` (`repo.ts:147`), vuelven en
`getGastos` (`repo.ts:508,519`) dentro de `liq.gastos`, y `tools.ts:209` mete
`liq` **entera** en el resultado de la tool, que `openrouter.ts:595` serializa
con `JSON.stringify` y empuja a `convo` (`:598`). Verifiqué que **no hay otro
camino**: el `history` que recibe el agente son sólo los turnos de la
conversación (`processor.ts:1125`), y `cuadrar_viaje` devuelve de cada
diferencia únicamente `{tipo, monto, nota}` (`tools.ts:123`), donde `nota` ya
sale saneada del motor.

Escenario con valores: un comprobante de caseta con un **PDF417** impreso
(zxing lo lee con `tryHarder: true`, `cfdi.ts:248`) que codifica 1,100
caracteres de texto libre. zxing devuelve ese texto, `clasificarQr` no lo
reconoce como CFDI ni como URL, así que cae en `return { texto: t }`, y
`codigoBarras` queda con los 1,100 caracteres. Al cerrar, el prompt del turno
lleva esos 1,100 caracteres × el número de comprobantes con código, dentro de un
mensaje `role:'tool'` que el modelo lee como dato del sistema.

Consecuencia: quien imprime el papel —no el chofer necesariamente: la
gasolinera, o quien le venda un ticket falso— decide contenido arbitrario dentro
del contexto del modelo en el turno que cierra el dinero, y decide sin tope el
tamaño de ese prompt.

**Lo que refuté, y por eso no es ALTO:** el efecto está acotado por tres
rejillas que sí existen. `guardiaCifras` sustituye SIEMPRE el texto cuando
`cuadro` es true (`guardia.ts:83,114`), y `guardar_liquidacion` cuenta como
cuadre (`:38-40`), así que nada de ese texto puede llegar al chofer por
WhatsApp. Las tres tools no aceptan datos del modelo, así que el texto no puede
cambiar qué fila se escribe. Y `guardar_liquidacion` está deduplicada por
efecto (`tool-executor.ts:94-120`), así que no puede provocar un segundo cierre.
Lo que queda sin rejilla es el consumo y el tamaño del prompt.

Causa raíz probable: la sanitización se diseñó para lo que se PERSISTE y lo que
se ENSEÑA (así lo dice `sanitizar.ts:47-50`), y nadie declaró que `ocrExtra`
también se REMITE al modelo por el resultado de una tool.

---

### [MEDIO] `guardar_liquidacion` devuelve 15.6 KB al modelo para que use 132 bytes, con los RFC, UUID y rutas de foto de cada comprobante dentro (REINCIDENTE, remedido)

`src/lib/cuadra/tools.ts:209` · `src/lib/llm/openrouter.ts:595` · `:564,598` ·
`src/lib/cuadra/cuadre/guardia.ts:69-72`

El comentario de `tools.ts:196-208` justifica bien POR QUÉ el snapshot tiene que
viajar —`guardia.ts:69-72` lo reusa para no recalcular y narrar dos cuadres
distintos del mismo cierre—, pero lo manda por el canal que además alimenta al
modelo.

Remedido hoy con 12 comprobantes y los campos que `repo.ts:508` lee de verdad
(`ocr_extra`, `rfc_emisor`, `rfc_receptor`, `cfdi_uuid`, `imagen_url`,
`ieps_traslado`, `img_hash`…) más 3 diferencias con su `nota`:

```
JSON.stringify(result)          → 15,649 bytes  (~4,000 tokens)
sólo liq.gastos                 → 14,599 bytes
lo que el modelo realmente usa  →      132 bytes  (liquidacion_id, estatus,
                                        diferencia, pdf_generado,
                                        pdf_contralor_generado)
```

(La ronda anterior midió 9,710 bytes con un `ocrExtra` más pobre; el árbol de
hoy trae más campos por comprobante, no menos.)

Consecuencia doble:
- **Costo.** ~4,000 tokens extra en el prompt de cada ronda posterior al cierre,
  a $2/1M de entrada de Sonnet 5 son ~$0.008 por ronda — 16-27% del objetivo de
  $0.03-0.05 por liquidación que declara `models.ts:17`, gastados en datos que
  el modelo no lee.
- **Minimización.** 12 RFC de emisor, 12 de receptor, 12 UUID de CFDI y 12
  rutas de foto salen al proveedor. No es exposición a una persona —`guardia.ts`
  sustituye el texto y el gateway fuerza ZDR (`openrouter.ts:123`)— pero
  `models.ts:19-23` fija el criterio como minimización, no sólo como ZDR.

Causa raíz probable: un solo `result` sirve a dos consumidores con necesidades
opuestas (la guardia necesita todo, el modelo casi nada) y no hay separación
entre lo que vuelve al llamador y lo que vuelve al modelo.

---

### [MEDIO] El nombre de una tool se declara CUATRO veces, y el registro entero cuelga de un único import por efecto secundario sin ninguna prueba (REINCIDENTE, ampliado)

`src/lib/cuadra/tools.ts:25,29` · `src/lib/agents/registry.ts:21` ·
`src/lib/agents/types.ts:11` · `src/lib/agents/prompts.ts:22,23,24,27,31` ·
`src/lib/llm/tool-executor.ts:35-39` · `src/lib/cuadra/processor.ts:9`

Cada tool escribe su nombre en cuatro lugares independientes, los cuatro
`string` suelto: la llave del registro (`registerTool('consultar_politica',…)`),
el nombre que ve el modelo (`schema.function.name`), la lista del agente
(`AGENT_REGISTRY.liquidacion.tools`, tipada `tools: string[]`) y **el prompt del
sistema**, que le ordena al modelo llamarlas por nombre
(`prompts.ts:22-24,27,31`). La cuarta la añadí hoy: la ronda anterior sólo
contaba tres.

`toolSchemas` resuelve por la llave y **descarta en silencio lo que no
encuentra**: `.map(n => REGISTRY.get(n)?.schema).filter(Boolean)`
(`tool-executor.ts:36-38`). `executeTool` resuelve por el nombre del schema
(`:48`). Repetido hoy: `grep -rn "toolSchemas\|AGENT_REGISTRY" src
--include=*.test.ts` → **vacío**.

Y hay un quinto punto de fallo que no había visto: **el registro completo
depende de una sola línea**, `import '@/lib/cuadra/tools'` en
`processor.ts:9` — `run.ts` no importa `tools.ts`. `grep -rn "runAgent" src`
confirma que hoy sólo `processor.ts:1153` lo llama, y **todos** los tests de
processor mockean `@/lib/agents/run`, así que ninguna prueba del repo ejecuta
jamás `toolSchemas(config.tools)` con el registro poblado.

Tres escenarios, los tres con las 1,629 pruebas, `tsc --noEmit` y el lint en
verde:

- Alguien renombra `registerTool('cuadrar_viaje')` a `'cuadrar_viaje_v2'` y
  olvida `registry.ts`: `toolSchemas` devuelve **2** esquemas en vez de 3, sin
  error ni log. El modelo nunca ve `cuadrar_viaje`, `guardiaCifras` calcula
  `cuadro = false` (`guardia.ts:38-40`) y el viaje no cierra.
- La llave dice `'consultar_politica'` y `schema.function.name` dice
  `'consultar_politicas'`: el modelo la llama por el nombre anunciado y
  `executeTool` cae en `tool-executor.ts:49-51`, devolviendo
  `{"error":"tool desconocida: consultar_politicas"}` seis rondas seguidas —
  seis llamadas pagadas — hasta salir por `LoopGuardError` (`openrouter.ts:600`).
- Alguien reordena imports en `processor.ts` y un linter «de imports sin uso»
  se lleva la línea 9: `REGISTRY` queda vacío, `toolSchemas` devuelve `[]`,
  `generateWithTools` manda `tools: undefined` y `tool_choice: undefined`
  (`openrouter.ts:501-502`), y el agente narra sin números en cada turno.

Consecuencia: el único punto donde la superficie de tools completa puede
desaparecer sin poner una prueba en rojo, a tres días del demo.

Causa raíz probable: cuatro cadenas sueltas que deben coincidir, un registro
que se puebla por efecto secundario, y ningún invariante —de tipo o de prueba—
que exija ninguna de las dos cosas.

---

### [MEDIO] `cuadrar_viaje` y `consultar_politica` siguen sin prueba de handler, y la prueba que parece cubrir a la segunda REIMPLEMENTA su cuerpo (REINCIDENTE)

`src/lib/cuadra/tools.ts:81-136` · `:25-76` ·
`src/lib/cuadra/normas/permiso_politica.test.ts:31-44`

Repetido hoy: `grep -rn "executeTool(" src --include=*.test.ts` devuelve **una
sola línea** en todo el repo — `tools_cableado.test.ts:104`, y sólo para
`guardar_liquidacion`.

`permiso_politica.test.ts:31-44` no reconstruye la forma del resultado: **copia
el cuerpo de la función**. Su propio comentario lo dice —«Lo que
`consultar_politica` devuelve hoy»— y las líneas 34-43 son carácter por carácter
el `return` de `tools.ts:65-74` (`norma_id`, `cita: NORMAS[id].citas[0]`,
`jerarquia`, `verificada: … !== 'sin_verificar'`, `vinculante`). Es un clon que
se prueba a sí mismo: si alguien edita el handler, la copia sigue verde.

Escenario con valores: invertir `tools.ts:117` de `periodo.estado !== 'holgado'`
a `===` quita el permiso de citar `rfa-2026-2.9` justo cuando la flota va
rebasando el 15% de combustible en efectivo —que es cuando importa— y se lo da
cuando va holgada. El agente explica el diésel en efectivo citando sólo LISR
27-III («no deducible, punto») en vez de LISR 27-III + la facilidad del 15%.
Invertir `:131`/`:71` (`verificada`) hace que afirme tajante sobre una ficha
`sin_verificar`. Ninguna de las dos mutaciones pone en rojo ninguna de las 1,629
pruebas.

Consecuencia: las dos tools que deciden qué ley puede invocar el producto
delante del contralor son las únicas sin arnés.

Causa raíz probable: la prueba se escribió un nivel por debajo del que tiene el
riesgo (`normasDePolitica`), no en la frontera (`executeTool`).

---

### [MEDIO] El fallback del OCR —el camino feliz del demo— sigue sin ninguna prueba, y quema una segunda llamada contra el proveedor caído antes de usarlo (REINCIDENTE)

`src/lib/llm/openrouter.ts:345-379` (`:364`, `:369-375`) · `:19-36` ·
`src/lib/cuadra/intake/ocr.ts:253-261`

Hay tres fallbacks cross-provider en el gateway y **sólo uno tiene prueba que lo
ejecute**: `openrouter_fallback_costo.test.ts` cubre `generateWithTools`, y lo
cubre bien (monta `tool_calls` reales contra el SDK mockeado y verifica el
precio por ronda — lo volví a abrir hoy para descartar que fuera una prueba que
lee el fuente; no lo es). Los otros dos no tienen ninguna:

- `generateResponse` (`:157`) — sin prueba.
- `generateStructured` (`:369-375`) — sin prueba. Es el que usa `ocr.ts:253`
  con `role: 'ocr'`: el que salva la demo si Gemini se cae mientras el contralor
  mira la pantalla. `openrouter_costo.test.ts` y `openrouter_truncado.test.ts`
  cubren truncado, JSON malo y presupuesto — ninguno llega a
  `attempt(fallback, note)`.

Y en ese camino el orden está mal. `generateResponse` cae al fallback
inmediatamente (`:157`). `generateStructured` **no**: tras el fallo transitorio
`e1` ejecuta `attempt(model, note)` (`:364`) —una segunda llamada completa al
MISMO proveedor caído, con la imagen del ticket adjunta— y sólo si esa también
falla mira el fallback (`:369`).

Escenario con valores: OpenRouter devuelve 503 para `google/gemini-3.6-flash`.
`getClient()` (`:23-34`) no fija `maxRetries`, así que hereda el default 2 del
SDK de OpenAI: cada `attempt()` son hasta 3 peticiones con backoff (~0.5s +
~1s). Intento 1 ≈ 2.2s, intento 2 contra el mismo proveedor muerto ≈ 2.2s, y
recién entonces se prueba `anthropic/claude-haiku-4.5`. Son ~4.4s tirados por
foto, dentro de una invocación de 60s que ya reserva 12s para el cierre
(`presupuesto.ts`).

Consecuencia: el mecanismo que existe para que «un provider caído nunca sea un
error visible para el operador» (`openrouter.ts:52-53`) es, en el camino del
OCR, código que nunca se ha ejecutado en una prueba y que además llega tarde.
En la sala eso es «no pude leer tu ticket» por un parpadeo que el diseño
prometía tapar.

Causa raíz probable: la escalera de reintentos de `generateStructured` está
ordenada por tipo de fallo (formato → proveedor) y no por costo del reintento.

---

### [BAJO] `isTransientError` tiene un falso positivo real por el offset del `SyntaxError` de JSON (REINCIDENTE, reproducido hoy)

`src/lib/llm/openrouter.ts:73-80` (regex en `:78`) · `:322` · `:369`

`:73-75` concatena el mensaje del error **y el de su `cause`**, y en `:322`
`new StructuredError('JSON parse falló', e, …)` pone como `cause` el
`SyntaxError` de `JSON.parse`, cuyo mensaje lleva el offset. Reproducido hoy
contra la función real del repo (prueba temporal, ya borrada; árbol limpio):

```
Unterminated string in JSON at position 536 (line 1 column 537) → true
Unterminated string in JSON at position 408 (line 1 column 409) → true
Unterminated string in JSON at position 502 (line 1 column 503) → true
Unterminated string in JSON at position 300 (line 1 column 301) → false
Unterminated string in JSON at position 1200 (…)                → false
```

Cualquier JSON de OCR que se rompa en un offset de 500-599 (o en 408, 429,
502-504) hace que `:369` clasifique un error de FORMATO como proveedor caído y
dispare una tercera llamada de visión completa contra
`anthropic/claude-haiku-4.5`, que va a fallar por lo mismo. Un ticket produce
~500 bytes de JSON, así que la ventana no es exótica.

Consecuencia: una llamada de visión pagada de más por cada ticket cuyo JSON se
rompa en esa ventana, y un `llm.fallback` en el log que dice «proveedor caído»
con el proveedor sano — la peor clase de línea de log: la que manda a
diagnosticar al lado equivocado.

**Refutación del escenario de la ronda 9, que sigue en pie:** el caso que
reportó aquella ronda —un error de Postgres de `saveLiquidacion` clasificado
como transitorio— **no puede ocurrir**: `isTransientError` sólo se invoca sobre
errores de `client.chat.completions.create` (`:157`, `:369`, `:518`), y los
errores de handler los captura `tool-executor.ts:55-63` sin llegar ahí.

Causa raíz probable: clasificar por texto libre sobre un mensaje que puede
contener cualquier número de tres dígitos.

---

### [BAJO] `res.model` con sufijo de proveedor parte la fila de costo en dos en la consola (NUEVO)

`src/lib/llm/openrouter.ts:98-101` · `:147` · `:300` · `:537` ·
`src/lib/admin/negocio.ts:87-89` · `:184-189`

`calcCost` documenta explícitamente que «OpenRouter a veces devuelve el slug con
sufijo de proveedor (`:nitro`, `:floor`)» y por eso lo normaliza para el precio
(`:108`, `model.split(':')[0]`). El slug que se **guarda** no pasa por esa
normalización: `generateResponse:147`, `generateStructured:300` y
`generateWithTools:537` conservan `res.model` tal cual, y ése es el que llega a
`llm_costo.modelo`.

Escenario con valores: dos liquidaciones idénticas, una respondida como
`anthropic/claude-sonnet-5` y otra como `anthropic/claude-sonnet-5:floor`.
`negocio.ts:87-89` llavea el mapa por la cadena completa, así que Model Ops
enseña dos renglones —`anthropic/claude-sonnet-5 · 1 llamada · $0.02` y
`anthropic/claude-sonnet-5:floor · 1 llamada · $0.02`— para el mismo modelo, y
`getCostoPorFaseModelo` (`:184`, llave `fase::modelo`) hace lo mismo dentro de
la fase. El importe total no cambia; el desglose por modelo sí.

Consecuencia: deuda de reporting sobre la misma superficie del primer hallazgo.
El propio archivo ya sabe que el sufijo existe y lo maneja para el precio, no
para la identidad.

---

### [BAJO] `ToolCallRecord.args` sigue sin describir qué produjo el `result` (REINCIDENTE)

`src/lib/llm/openrouter.ts:582` · `:594`

Sin cambio: cuando la caché acierta, `executed.push` guarda el `args` de ESTE
llamador con el `result` de OTRO (`:582`, caché entre rondas) o del primero de la
ronda (`:594` vía `inRound`, `:585-587`).

Sigue en BAJO porque la consecuencia hoy es cero y lo volví a verificar:
`grep -rn "\.args\b" src --include=*.ts --include=*.tsx` fuera de
`openrouter.ts` sólo devuelve mocks de supabase en `repo_*.test.ts`. Nadie
persiste ni consulta `.args`; `guardia.ts` lee `.toolName`/`.error`/`.result`,
`fundamento.ts` lee `.result`, `processor.ts:1173` lee `.toolName`. La nota de
`tool-executor.ts:98-104` ya avisa que el día que una tool lleve parámetros hay
que revisar esta llave.

---

### [BAJO] `ctx.signal` sigue sin consumirse en ningún handler (REINCIDENTE, mitigado)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:32-34,45` ·
`src/lib/cuadra/tools.ts` (sin ninguna aparición de `signal`)

`run.ts:32-34` construye `ctx.signal` desde el `AbortController` del turno (40s,
`processor.ts:1158`) y lo pasa a `makeExecutor`.
`grep -n "signal" src/lib/cuadra/tools.ts` → vacío; los tres handlers lo
ignoran. Mitigado, no cerrado: todo lo que tocan pasa por `acotada()` con su
`TOPE_CONSULTA_MS` propio, así que nada se cuelga para siempre. Peor caso
vigente: el turno se agota, `generateWithTools` aborta, y una consulta de
`guardar_liquidacion` sigue corriendo contra su propio reloj.

---

### [BAJO] El `error.message` crudo de Postgres sigue entrando sin filtro al contexto del modelo (REINCIDENTE)

`src/lib/llm/tool-executor.ts:60` · `src/lib/llm/openrouter.ts:595` ·
`src/lib/cuadra/repo.ts:536` · `src/lib/cuadra/tools.ts:181`

Sin cambio. `executeTool` pone `err.message` tal cual en `ToolExecResult.error`
(`:60`) y `openrouter.ts:595` lo serializa en el `content` del mensaje
`role:'tool'`. El ejemplo más directo sigue siendo `guardar_liquidacion`
(`tools.ts:181`), que llama `saveLiquidacion` sin try/catch propio: si el RPC
`guardar_liquidacion_tx` devuelve error, `repo.ts:536` lanza
`` `saveLiquidacion: ${error.message}` `` con el texto de Postgres —nombre de
función plpgsql, constraint, columna— y eso entra al contexto del modelo en la
tool que cierra el dinero.

Consecuencia acotada, verificada: si `guardar_liquidacion` falla,
`guardia.ts:51` calcula `cerro = false` y `:38-40` `cuadro = false`, así que el
texto sólo se sustituye si el modelo narró cifras — un mensaje del tipo «se
trabó por un problema con `liquidacion_viaje_id_key`» puede salir tal cual al
chofer. Higiene, no dinero.

---

### [BAJO] El loop-guard sigue ejecutando la ronda 6 entera antes de tirar el resultado (REINCIDENTE)

`src/lib/llm/openrouter.ts:528-600`

Sin cambio. El `for` corre las 6 rondas completas: las tools de la sexta se
ejecutan, se pagan, se serializan a `convo` (`:598`) y sólo entonces `:600`
lanza `LoopGuardError`, que `:603` envuelve en `PartialExecutionError`. El
conteo en sí es correcto (`round < maxRounds`, 6 iteraciones) — lo que se pierde
es la oportunidad de usar la última ronda para cerrar con lo que ya se tiene en
vez de correr a ciegas hasta el tope.

---

### [BAJO] El rol `cuadre_fallback` está declarado, presupuestado y documentado, y no lo ejecuta nadie (REINCIDENTE)

`src/lib/llm/models.ts:29,40,50,64` · `src/lib/cuadra/costos.ts:103` ·
`src/lib/llm/openrouter.ts:58,88`

`grep -rn "cuadre_fallback" src` devuelve **sólo** las cuatro declaraciones de
`models.ts`. Nadie llama `modelFor('cuadre_fallback')` y ningún agente usa ese
rol (`registry.ts` sólo usa `router` y `cuadre`). Por tanto:

- «Escalación por baja confianza / monto alto / caso ambiguo» (`models.ts:38-40`)
  y «Fallback Opus por confianza» (`:14`) describen algo que el código no hace.
- La fase `'escalacion'` de `costos.ts:103`
  (`if (modelo.includes('opus')) return 'escalacion'`) es inalcanzable: ningún
  camino produce un slug con `opus`, porque
  `FALLBACK['anthropic/claude-sonnet-5']` es `'openai/gpt-5.6-terra'`
  (`openrouter.ts:57`). Se nota ahora que `model-ops/page.tsx:48,54-58` declara
  **tres** fases fijas y `FaseCosto` declara seis: `escalacion` es una fase que
  el tipo permite, el panel no nombra y el código no puede producir.
- `FALLBACK['anthropic/claude-opus-5']` (`:58`) y
  `PRICES['anthropic/claude-opus-5']` (`:88`) son entradas muertas.

Consecuencia: quien lea `models.ts` para saber qué corre en producción está
leyendo una promesa, no el sistema.

---

## Lo que revisé y está bien

- **La regla estructural está intacta, releída completa.** `grep -rn
  "registerTool("` devuelve exactamente 3 registros, los tres en `tools.ts`
  (`:25,81,139`), los tres con
  `parameters: { type:'object', properties: {}, additionalProperties:false }`
  (`:31,87,146`). Los tres handlers reciben `_args` y ninguno lo lee.
  `tenantId`/`viajeId`/`operadorId`/`telefono` salen siempre de `ToolContext`,
  resuelto en `run.ts:34` desde `processor.ts:1156`. **El modelo no puede
  influir en qué fila se escribe**: `saveLiquidacion(ctx.tenantId, liq, …)` y
  las rutas de PDF (`tools.ts:176-177`) se construyen sólo con IDs de servidor.
  Ninguna tool nueva rompió la regla: no hay tools nuevas.

- **El chat de `/admin` NO toca el camino de tools ni el del modelo, y la
  frontera es limpia.** `src/app/admin/chat.tsx:23-43` es coincidencia de
  palabras clave (`q.includes('gastad')`, `q.includes('flota')`…) sobre un
  `ResumenNegocio` **ya calculado en el servidor**; no hay `fetch`, ni acción de
  servidor, ni ninguna llamada a `generateResponse`/`generateStructured`/
  `generateWithTools`. `asistente-expandible.tsx` sólo alterna el ancho del
  panel y le pasa el mismo `resumen`; `chat/page.tsx` es un Server Component que
  llama `getResumenNegocio()` y lo entrega como prop. Lo confirmé además por
  exclusión: `grep -rn "generateWithTools|generateStructured|generateResponse|
  toolSchemas|executeTool|makeExecutor|modelFor("` sobre todo `src` no toca
  **ni un archivo** bajo `src/app/`. El propio archivo (`chat.tsx:8-15`)
  documenta la decisión de no traducir lenguaje natural a SQL con permisos de
  superadmin, y `/admin/playground/page.tsx:5-15` explica por qué no existe un
  sandbox que ejecute el pipeline. La frontera hoy es: **`/admin` lee
  `llm_costo`, no lo produce.** Para mi rubro eso significa que `/admin` es
  consumidor de la contabilidad, no de la frontera modelo↔mundo — y por eso el
  primer hallazgo sube de severidad, no porque `/admin` la haya roto.

- **La dedup de mutaciones mira el efecto y aguanta concurrencia.**
  `makeExecutor` (`tool-executor.ts:94-120`) cachea la **promesa** antes del
  `await` (`:110-111`), llavea por nombre y no por args (`:105`), y borra el
  fallo comparando la promesa (`:116`). `tool_executor_concurrente.test.ts` y
  `tool-executor.test.ts` lo ejercitan de verdad, incluyendo `null` como args y
  las claves en otro orden.

- **La caché de lectura acierta y no fosiliza fallos.** `llaveDeCache`
  (`openrouter.ts:446-458`) colapsa por nombre sólo las tools sin `properties`,
  y `:593` sólo cachea el éxito. `openrouter_cache_llave.test.ts` y
  `openrouter_cache_fallo.test.ts` ejecutan el ciclo real con el SDK mockeado.

- **La respuesta truncada NO se trata como completa** en el ciclo de tools:
  `openrouter.ts:548-556` lanza `TruncatedError` antes de devolver, y
  `openrouter_truncado_tools.test.ts` prueba el caso de `content` vacío.

- **Truncamiento CON `tool_calls` no vacío falla cerrado.** Con `properties: {}`
  los `arguments` son `{}`, así que un corte a media emisión deja o bien un JSON
  inválido → `openrouter.ts:575-578` empuja `args_parse` y **no ejecuta el
  handler**, o bien un `function.name` truncado → `tool-executor.ts:49-51`
  responde «tool desconocida». Ninguna rama escribe nada.

- **El importe por ronda es correcto tras el fallback** (`openrouter.ts:536`,
  con `activeModel` movido por `complete` antes de devolver) y tiene prueba: sólo
  la etiqueta del modelo está mal.

- **La inyección por el texto impreso del ticket está cerrada en el resto de los
  campos.** Perseguí el camino «papel → `nota` de una diferencia → resultado de
  `cuadrar_viaje` → modelo» y **no es hallazgo**: `etiquetaConcepto`
  (`engine.ts:1105-1112`) sólo lee `ocrExtra.producto`, que pasa por
  `sanitizarProducto` (`sanitizar.ts:110-121`), y los folios interpolados en las
  notas pasan por `sanitizarFolio` (`engine.ts:340,545`). Lo que sí quedó
  abierto son `fechaRaw` y `codigoBarras`, y sólo por el resultado de
  `guardar_liquidacion` (hallazgo aparte).

- **El índice de normas que las tools emiten no puede reventar el handler**:
  `por_diferencia.test.ts` obliga a que todo id de `NORMA_POR_DIFERENCIA` exista
  en `IDS_NORMA`, así que `NORMAS[id].citas[0]` de `tools.ts:126` no puede caer
  sobre un id inexistente.

- **Aislamiento por tenant** en las cuatro funciones de `repo.ts` que tocan las
  tools (`getViaje`, `getOperador`, `saveLiquidacion` vía `p_tenant`,
  `getAcumuladoCombustible`).

- **Compuerta del rubro corrida hoy**: `npx vitest run src/lib/llm
  src/lib/cuadra/tools_cableado.test.ts src/lib/cuadra/normas/` → 17 archivos,
  **144 pruebas, 0 fallos**. `git status --porcelain` vacío al terminar: no se
  editó ningún archivo del repo salvo este entregable.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** Todo el gateway está probado con el
  SDK mockeado. En particular no verifiqué que un `assistant` con `tool_calls`
  emitido por Anthropic se acepte tal cual cuando la ronda siguiente la responde
  OpenAI (`openrouter.ts:564` + `:521`): confío en que OpenRouter normaliza los
  `tool_call.id`, pero es una suposición, y es exactamente el camino que el
  fallback recorre a mitad de ciclo.
- **Cómo reacciona un modelo real al texto inyectado por el código de barras.**
  Verifiqué el canal y su tamaño; no pude medir si el modelo lo obedece, y las
  tres rejillas que lo acotan las verifiqué por código, no por ensayo.
- **Con qué frecuencia el modelo real emite `arguments` no vacíos.** Los schemas
  no llevan `strict: true` y no medí la tasa contra el proveedor real — importa
  sólo para la contabilidad de `ToolCallRecord.args`, no para el efecto.
- **Si el modelo llama `guardar_liquidacion` antes de tiempo.** El diseño le da
  al modelo la decisión de CUÁNDO (deliberado, y el ancla lo bendice), pero la
  única precondición del handler es `if (!ctx.viajeId)` (`tools.ts:150`) y el
  cierre es irreversible de cara al chofer. `prompts.ts:27` le ordena cerrar
  ante un «ya» o un «es todo». No puedo escribir el escenario con valores sin
  correr el modelo real, así que **no lo reporto** — pero es donde pondría el
  siguiente ensayo del guion del demo.
- **`tool_calls` en streaming** y **prompt caching** (`cache_control`): siguen
  sin usarse; no los evalué.
- **El resto de `processor.ts`** más allá de los puntos donde cruza mi frontera
  (`:9`, `:1125`, `:1153-1177`, `:1196-1205`). Es rubro de otro auditor, igual
  que la autorización de `/admin` (`layout.tsx:26`, `requireSuperadmin()`), que
  sólo miré para poder afirmar dónde está la frontera del chat.
