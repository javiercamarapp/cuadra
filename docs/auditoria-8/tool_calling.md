# Tool calling — auditoría 8

**Nota: 7/10** (antes 8). Razón del movimiento: **deuda que cobró factura**. La
deuda es la misma que llevo reportando desde la ronda 4 y que la 6 dejó por
escrito: `consultar_politica` y `cuadrar_viaje` no tienen NI UNA prueba que las
llame de verdad. Esta ronda se implantó el cierre de un CRÍTICO (AG-2) dentro de
`consultar_politica` y el cierre de otro (AG-3) dentro de `guardar_liquidacion`,
y las dos cosas entraron sin que nada en CI ejercite el handler real: la prueba
que certifica AG-2 (`permiso_politica.test.ts:32-44`) **re-escribe a mano el
objeto que la tool devuelve** en vez de llamarla. Con esa venda puesta, el
arreglo de AG-2 ensanchó —de forma medible, la reproduje— el conjunto de cifras
que la guardia de dinero considera "respaldadas", y el de AG-3 metió 17 KB de
snapshot con RFC y UUID de cada gasto al contexto del modelo sin que nadie del
lado del modelo los necesite. La regla estructural (`properties: {}`) sigue
intacta en las tres tools y no se registró ninguna tool nueva; por eso no baja
más.

El riesgo mayor del rubro hoy: **el permiso de citar que ahora viaja con
`consultar_politica` arrastra los números de la cita legal, y `cifrasSinRespaldo`
los acepta como respaldo de una cifra de dinero** — una diferencia inventada de
`$2,026.00` pasa la guardia que existe justamente para que ninguna cifra del
modelo llegue al WhatsApp.

## Hallazgos

### [ALTO] El arreglo de AG-2 convirtió los números de las citas legales en respaldo válido de una cifra de dinero

`src/lib/cuadra/tools.ts:64-74` · `src/lib/cuadra/cuadre/guardia.ts:95-96` ·
`src/lib/cuadra/cuadre/cifras.ts:96-99`

`consultar_politica` ahora devuelve `fundamentos[].cita`, que son strings como
`"LISR 27-III"`, `"LISR 28-V"`, `"RFA 2026 regla 2.9"` y `"LIF 2026 Art. 20"`,
más `jerarquia` (1, 3). Cuando el turno NO llamó `cuadrar_viaje` pero sí
`consultar_politica`, `guardia.ts:95` arma `respaldos` con **todos** los
resultados de tool y `cifras.ts:96-99` (`numerosDe`) barre cada string
extrayendo cualquier número embebido. Los artículos entran al conjunto de
cifras respaldadas.

Escenario, **reproducido importando los módulos reales** (`normasDePolitica`,
`NORMAS`, `DEMO_CONFIG`, `cifrasSinRespaldo`) con `tsx`, política del demo:

```
citas emitidas: [ 'LISR 27-III', 'LISR 28-V', 'RFA 2026 regla 2.9', 'LIF 2026 Art. 20' ]

"Tu diferencia es de $2,026.00."   ANTES: sin respaldo [2026]   HOY: []
"Sobró $27.00 del anticipo…"       ANTES: sin respaldo [27]     HOY: []
"Pusiste $28.00 de tu bolsa."      ANTES: sin respaldo [28]     HOY: []
"Te quedaron $20 a favor."         ANTES: sin respaldo [20]     HOY: []
"Sobró $145.50 del anticipo."      ANTES: [145.5]               HOY: [145.5]  ← sigue cazándose
```

Entra: el turno del guion del demo que el propio test describe —cerrada la
liquidación, el contralor pregunta "¿y en qué se basan para no contarme ese
diésel?"; el agente contesta con `consultar_politica` y sin `cuadrar_viaje`— y
el modelo escribe una cifra que nadie calculó. Sale: `cifrasSinRespaldo`
devuelve `[]`, `guardia.ts:96-99` concluye "todo respaldado", `return {reply,
forzado:false}` y el texto del modelo sale íntegro por WhatsApp. `2026` es el
valor más probable de todos: está en dos de las cuatro citas y es un monto
perfectamente plausible de diferencia de viaje (nótese que el filtro `ANIO` de
`cifras.ts:54` no lo salva: `$2,026.00` lleva coma de miles y no casa
`(?:19|20)\d{2}`).

Consecuencia: al contralor —o al chofer— le llega un número de pesos inventado
por el LLM, en el único rubro donde el producto promete lo contrario por
escrito («Ninguna cifra que vea el usuario sale del LLM», MAPA §Convenciones).
Es además la puerta trasera que `cifras.ts:69-74` dice haber cerrado
("consultar la política desbloqueaba narrar cualquier número"): quedó
entreabierta con la llave del artículo.

Causa raíz probable: el permiso de citar y el respaldo de cifras comparten el
mismo canal —el `result` de la tool— y `numerosDe` no distingue un monto de un
número de artículo.

---

### [MEDIO] `guardar_liquidacion` manda al modelo el snapshot entero de la liquidación —RFC, UUID y `ocrExtra` de cada gasto— que ningún consumidor del lado del modelo usa

`src/lib/cuadra/tools.ts:200` · `src/lib/llm/openrouter.ts:595`

`liq` es `Omit<Liquidacion,'id'|'creadaEn'>`, e incluye `gastos: Gasto[]`
completo: `rfcEmisor`, `rfcReceptor`, `cfdiUuid`, `imgHash`, `formaPago`,
`iepsTraslado`, y `ocrExtra` con `producto`, `estacion`, `emisor`,
`urlFacturacion`, `folioPortal`, `codigoBarras`. `openrouter.ts:595` lo
serializa con `JSON.stringify(exec.result)` como `content` del mensaje
`role:'tool'`, y la ronda siguiente del `for` lo reenvía como input.

Medido corriendo el motor real (`cuadrarViaje` de `engine.ts`, gastos
sintéticos con los campos que el OCR sí llena):

```
gastos=1    antes=89 chars   hoy=1,697 chars    (~424 tokens)
gastos=6    antes=89 chars   hoy=7,618 chars    (~1,905 tokens)
gastos=14   antes=88 chars   hoy=17,112 chars   (~4,278 tokens)
gastos=25   antes=90 chars   hoy=30,185 chars   (~7,546 tokens)
```

Entra: un viaje normal de 14 comprobantes que cierra. Sale: ~4,278 tokens de
input extra en la ronda posterior al cierre, a $2/1M de Sonnet 5
(`openrouter.ts:87`) = **$0.0086 por cierre**, contra el objetivo declarado de
**$0.03–0.05 por liquidación** (`models.ts:22`) — entre un 17% y un 29% del
costo unitario, gastado en datos que el modelo no consume.

El consumidor real de `liq` es `guardiaCifras` (`guardia.ts:69-72, 105`), que lo
lee **en proceso** desde `toolCalls`, no desde el modelo. Nada del lado del
modelo lo necesita.

Me intenté refutar por dos vías y las dos aguantan a medias: (a) `imagenUrl`
está siempre `undefined` hoy (`ocr.ts:377`, nunca se escribe `imagen_url`), así
que no viaja ninguna liga firmada; (b) el texto libre de la foto ya llegaba al
modelo por `diferencias[].nota` vía `etiquetaConcepto` (`engine.ts:819-826`) y
`sanitizarTexto` lo capa a 80 caracteres sin `< > \``, así que esto **no** abre
una puerta de inyección nueva. Lo que sí es nuevo es el volumen y los campos
`estacion`/`emisor`/`folioPortal`/`codigoBarras` y los RFC/UUID de cada gasto.

Consecuencia: quien pague la factura de OpenRouter, y quien tenga que sostener
ante el contralor la frase de `models.ts:31` sobre soberanía de datos fiscales
—RFC y CFDI son datos personales— tiene ahora un cierre que los remite todos al
proveedor, sin que ninguna función del otro lado los lea.

Causa raíz probable: AG-3 necesitaba que el snapshot llegara a la **guardia**, y
se le hizo viajar por el único canal que además va al modelo.

---

### [MEDIO] La prueba que certifica el cierre de AG-2 re-implementa el retorno de la tool en vez de llamarla — `consultar_politica` y `cuadrar_viaje` siguen en CERO pruebas directas (5ª ronda)

`src/lib/cuadra/normas/permiso_politica.test.ts:32-44` ·
`src/lib/cuadra/tools.ts:25-76` · `src/lib/cuadra/tools_cableado.test.ts:101`

`permiso_politica.test.ts:31` dice literalmente *"Lo que `consultar_politica`
devuelve hoy"* y a continuación construye el objeto a mano (`normasDePolitica` +
`NORMAS[id].citas[0]` + `norma_id` + `jerarquia`…). Nunca importa `tools.ts` ni
llama `executeTool('consultar_politica', …)`. Verificado con dos búsquedas
independientes: `grep -rn "executeTool(\s*'" src --include=*.test.ts` da **una
sola línea** (`tools_cableado.test.ts:101`, `guardar_liquidacion`), y
`grep -rn "cuadra/tools'"` da solo `processor.ts:9` (import de side-effect) y
dos `vi.mock('@/lib/cuadra/tools', () => ({}))`.

Escenario: alguien renombra la llave `norma_id` → `id` en `tools.ts:68`, o borra
`fundamentos:` del `return` de `tools.ts:65-74` al limpiar el payload (que es
exactamente lo que el hallazgo anterior invita a hacer).
`normasDeToolCalls` (`fundamento.ts:351`) busca `norma_id` y nada más → vuelve
`permitidas = []` → AG-2 REGRESA íntegro: *"Te aplica el estímulo conforme al
LIF 2026 Art. 20-A"* sale como *"Te aplica el estímulo conforme al -A."*. Las
1,262 pruebas de la suite siguen verdes, incluidas las 9 de
`permiso_politica.test.ts`, porque ese archivo construye su propio objeto.

Lo mismo aplica a `cuadrar_viaje` (`tools.ts:90-136`): el `try/catch` de
`getAcumuladoCombustible`, y sobre todo `tools.ts:117` —el push condicional de
`rfa-2026-2.9` cuando `periodo.estado !== 'holgado'`— siguen sin una sola
aserción directa; invertir ese `!==` a `===` no rompe nada.

Consecuencia: para quien mantenga esto, el CRÍTICO que esta ronda declara
cerrado no tiene ninguna prueba que pueda fallar si se reabre. Es el modo de
falla que el MAPA nombra ("se le escribieron pruebas unitarias, y nunca se
conectó"), aplicado a la prueba misma.

Causa raíz probable: la prueba se escribió contra el *contrato imaginado* de la
tool y no contra el registro real, que es lo único que corre en producción.

---

### [MEDIO] El rol `cuadre_fallback` (Opus) está declarado, precificado y documentado como escalación, y ningún camino de código lo invoca — la fase de costo `escalacion` es inalcanzable

`src/lib/llm/models.ts:40,50,64` · `src/lib/cuadra/costos.ts:102` ·
`src/lib/llm/openrouter.ts:57-58`

`models.ts:38-41` promete: *"Escalación por baja confianza / monto alto / caso
ambiguo. Opus 5 […] Solo se dispara"*. Verificado con dos búsquedas: `grep -rn
"modelFor("` da tres llamadas, todas con `opts.role` de
`generateResponse`/`generateStructured`/`generateWithTools`; y `grep -rn "role:
'"` en `src/lib` da exactamente `'router'` (registry), `'cuadre'` (registry) y
`'ocr'` (`ocr.ts:247`). **`modelFor('cuadre_fallback')` no se llama nunca.**

Escenario: un cuadre de $180,000 con tres diferencias ambiguas corre en
`anthropic/claude-sonnet-5` y se queda ahí; el único salto posible es el
cross-provider por error transitorio de `FALLBACK` (`openrouter.ts:57`), que
manda a `openai/gpt-5.6-terra`, **no** a Opus. En consecuencia
`faseDeModelo(res.model,'cuadre')` (`costos.ts:102`, `modelo.includes('opus')`)
nunca devuelve `'escalacion'`: esa cubeta de `llm_costo` sale siempre en cero.

Consecuencia: el contralor —y quien lea el desglose de costo por fase— ve una
fase "escalación" que existe en el esquema, en el reporte y en la
documentación, y que no puede llenarse. Y el caso de mayor riesgo de dinero no
tiene la ruta de modelo que el propio archivo dice que tiene.

Causa raíz probable: el ruteo por rol se diseñó con cinco roles y solo tres
tienen quien los pida.

---

### [MEDIO] La atribución de costo tras fallback sigue escribiendo UNA fila con UN modelo (REINCIDENTE, 5ª mención, sin cambio) — y su gemelo en `generateStructured` etiqueta con el modelo equivocado

`src/lib/llm/openrouter.ts:536-537` · `src/lib/cuadra/processor.ts:703` ·
`src/lib/llm/openrouter.ts:329,339`

```ts
536  costo += calcCost(activeModel, rIn, rOut);   // correcto: cada ronda a su precio
537  used = res.model || activeModel;             // pero solo sobrevive el de la ÚLTIMA
703  await registrarCosto({ …, fase: faseDeModelo(res.model,'cuadre'), modelo: res.model, … });
```

Escenario con valores: ronda 1 en `anthropic/claude-sonnet-5` (100 in / 20 out),
ronda 2 el primario cae y contesta `openai/gpt-5.6-terra` (150 in / 30 out).
`cost` sale bien —lo prueba `openrouter_fallback_costo.test.ts:56-68`, que sí
verifica la suma— pero `registrarCosto` graba UNA fila con
`modelo: 'openai/gpt-5.6-terra'` y 250 tokens in / 50 out, de los cuales 100/20
se cobraron a tarifa de Anthropic. Nótese que **ese test no asierta el `model`
devuelto**, solo el costo: la mitad del hallazgo no está cubierta.

Lo nuevo esta ronda es el gemelo en `generateStructured`: `conGastado`
(`openrouter.ts:339`) hace `err.usage = { model, ...gastado }` con `model` = el
**primario**, aunque los últimos intentos hayan corrido en el fallback
(`attempt(fallback, note)`, `:372`); y en el camino feliz `:329` devuelve
`model: usage.model` (el del ÚLTIMO intento) junto a `...gastado` (la suma de
TODOS). Un OCR que truncó dos veces en Gemini y cerró en
`anthropic/claude-haiku-4.5` llega a `processor.ts:373` como una fila
`fase:'ocr', modelo:'anthropic/claude-haiku-4.5'` con los tokens de las tres
llamadas.

Consecuencia: nadie puede reconciliar `llm_costo` contra la factura de
OpenRouter por modelo. Con un negocio que va a cobrar por liquidación, el costo
unitario por proveedor es una cifra que el comprador va a pedir.

Causa raíz probable: el acumulador de costo es por ronda y el de atribución es
un escalar.

---

### [MEDIO] La rama de cierre parcial tira el snapshot que la tool ya devolvió y recalcula el cuadre — tres consultas más a la base en el camino que ya se quedó sin presupuesto

`src/lib/cuadra/processor.ts:760`

```ts
760  reply = resumenCuadre(await cuadrarDesdeDB(op.tenantId, viajeId), true, 'operador');
```

`cierreParcial.result` **ya trae** `liq` (`tools.ts:200`), que es el mismo
snapshot que se imprimió en los dos PDF. Aquí se ignora y se llama
`cuadrarDesdeDB`, que son tres lecturas (`getViaje` + `getGastos` + `getConfig`,
`desde_db.ts:11-15`), cada una acotada a 8 s por `acotada()` (`repo.ts:45-73`).

Escenario: `CUADRA_RECUPERAR_CIERRE_PARCIAL=1` —está en `.env.example:75` y
`AUDIT_V3.md:76` lo declara encendido en el entorno del demo— y el ciclo revienta
por timeout de 40 s después de `guardar_liquidacion`. Entra: un
`PartialExecutionError` con el snapshot dentro. Sale: hasta 24 s más de
consultas dentro de una invocación cuyo presupuesto ya se agotó
(`maxDuration = 120`), justo antes de intentar mandar el PDF.

Me refuté a mí mismo en la parte grave: **no** produce dos cuadres distintos,
porque `guardiaCifras` corre 17 líneas después (`processor.ts:777`), ve
`cerro = true` y sustituye el `reply` por `resumenCuadre(snapshotCierre, …)`
(`guardia.ts:69-72, 105`). O sea que el texto que sale sí es el snapshot: el
trabajo de la línea 760 es **íntegramente desechado**. Lo que cuesta es
latencia, en el único camino donde la latencia ya es el problema.

Causa raíz probable: la rama de recuperación se escribió antes de que el
snapshot existiera y no se revisitó al cerrarse AG-3.

---

### [BAJO] `ToolCallRecord.args` sigue sin corresponder al resultado que produjo (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:582,594`

En las dos ramas `args` es la variable local de ESTA llamada y `result` viene de
la ejecución compartida. Con la llave por nombre (`llaveDeCache`, `:446-458`),
dos `guardar_liquidacion` en la misma ronda con `{}` y `{"confirmar":true}`
producen dos registros con args distintos y el mismo `result`, y el handler solo
vio los primeros. Hoy nadie lee `.args` (verificado: `guardia.ts:38,52,95`,
`processor.ts:701,705,709` leen `toolName` y `result`), así que sigue siendo
latente. Consecuencia para quien depure una discrepancia de dinero con ese log:
apunta al llamador equivocado.

---

### [BAJO] `isTransientError` sigue dando falso positivo con `5\d\d` dentro del texto (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:78`

Mismo regex desde la ronda 4: `/\b(5\d\d|429|408|502|503|504)\b/` sobre el
mensaje completo. Un `saveLiquidacion: check constraint violada (monto=507.65)`
clasifica como transitorio y gasta una llamada al otro proveedor que va a fallar
igual. `openrouter_transitorio.test.ts` (5 casos, todos pasan) sigue sin un caso
negativo con `5xx` en el texto de un error NO transitorio.

---

### [BAJO] El mensaje crudo de Postgres sigue viajando al contexto del modelo (REINCIDENTE, sin cambio)

`src/lib/llm/tool-executor.ts:60` → `src/lib/llm/openrouter.ts:595`

`executeTool` mete `err.message` sin filtrar en `error`, y `openrouter.ts:595` lo
serializa como `content` del mensaje `role:'tool'`. Nombres de tabla, funciones
y UUIDs internos siguen pudiendo llegar al modelo y de ahí a lo que narra por
WhatsApp. Con el hallazgo del snapshot arriba, este canal ahora convive con un
payload mucho más grande de datos internos.

---

### [BAJO] El loop-guard ejecuta la ronda 6 completa y luego la tira (REINCIDENTE, sin cambio)

`src/lib/llm/openrouter.ts:528-600`

El `for` completa la ronda 6 —las tools corren, se pagan, se empujan a `convo`—
y solo entonces `throw new LoopGuardError(maxRounds)` en `:600`. Se paga y se
descarta hasta una ronda entera de lecturas dentro de un turno acotado a 40 s.
El huérfano de cara al operador sigue cubierto por
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1`.

---

### [BAJO] `ctx.signal` sigue sin consumirse en ninguna tool (REINCIDENTE, mitigado)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:34` ·
`src/lib/cuadra/tools.ts` (0 apariciones de `signal`)

El `AbortController` de `runAgent` corta la llamada al modelo a los 40 s; una
consulta de `repo.ts` en vuelo no se entera por esa vía. Sigue mitigado por
`acotada()` (`repo.ts:45-73`), que impone su propio techo de 8 s por consulta.
Deuda arquitectónica (dos relojes que no se hablan), no un cuelgue indefinido.

---

### [BAJO] `generateResponse` no tiene ningún llamador, y el par de fallback del rol real del cuadre nunca se ejercita en prueba

`src/lib/llm/openrouter.ts:126-161` · `openrouter_fallback_costo.test.ts:24-26`

`grep -rn "generateResponse(" src` fuera de su propia definición: cero. Es una
entrada pública con su propio camino de fallback y su propia contabilidad de
costo que nadie ejecuta. Y el test que cubre el fallback lo hace con
`role: 'chat'` (`gemini-3.5-flash-lite` → `gpt-5.6-luna`); el par que de verdad
corre el dinero, `anthropic/claude-sonnet-5` → `openai/gpt-5.6-terra`
(`openrouter.ts:57`), no se ejercita nunca — y es el único que además lleva
`reasoning: {effort:'high'}` en el body (`openrouter.ts:511`).

---

## Lo que revisé y está bien

- **La regla estructural aguanta, reverificada tool por tool.**
  `consultar_politica` (`tools.ts:31`), `cuadrar_viaje` (`tools.ts:87`) y
  `guardar_liquidacion` (`tools.ts:146`) siguen con
  `parameters:{type:'object',properties:{},additionalProperties:false}` y los
  tres handlers reciben `_args` sin tocarlo (`tools.ts:34,90,149`). Los efectos
  salen de `ctx.tenantId`/`ctx.viajeId`, resueltos en servidor
  (`processor.ts:688`). El commit `e50510c` **no** metió ningún dato del modelo:
  `normasDePolitica(config.politica)` (`tools.ts:64`) lee la política del tenant
  desde `getConfig`, no del `arguments`.
- **No hay tools nuevas, y la premisa del encargo sobre "tools de facturación
  alrededor de `permiso_cre.ts`" es falsa.** Dos búsquedas: `grep -rn
  "registerTool(" src --include=*.ts` da exactamente 3 registros de producción,
  todos en `tools.ts`; y `AGENT_REGISTRY` (`registry.ts:22`) sigue con las mismas
  tres. `permiso_cre.ts` no se registra como tool ni se importa desde `tools.ts`.
- **El cierre de AG-2 funciona de verdad en el camino vivo.**
  `normasDeToolCalls` (`fundamento.ts:344-356`) busca `norma_id` en profundidad
  ≤6, `consultar_politica` lo emite (`tools.ts:68`), y `processor.ts:805-807`
  lo alimenta a `guardiaFundamento` en el turno `!textoDeterminista` — que es
  justo el turno que antes salía con `permitidas = []`. Las 9 pruebas de
  `permiso_politica.test.ts` pasan (mi objeción es cómo están cableadas, no el
  mecanismo).
- **El permiso es acotado, no un salvoconducto.** `normasDePolitica`
  (`por_diferencia.ts:127-133`) emite dos normas de piso más las del concepto
  presente en la política, y **filtra por `NORMAS[id]`** antes de devolver, así
  que no puede emitir un permiso muerto. Verificado además que ningún id de
  `NORMA_POR_DIFERENCIA` falta del índice (script propio: 0 faltantes) y que
  `por_diferencia.test.ts:49-57` lo impone en CI — o sea que el
  `NORMAS[id].citas[0]` sin guarda de `cuadrar_viaje` (`tools.ts:128`) no puede
  reventar por sorpresa.
- **Idempotencia de mutaciones, intacta.** `makeExecutor`
  (`tool-executor.ts:94-117`) sigue registrando la PROMESA antes del `await`, con
  llave por nombre, y borrando el fallo para permitir reintento.
  `tool_executor_concurrente.test.ts` (6 casos con `Promise.all` real, incluidos
  dos fallos en paralelo que no envenenan la caché) y `tool-executor.test.ts`
  (7 casos, incluye args distintos y claves en otro orden) pasan.
- **La caché de lectura acierta y no se envenena.** `llaveDeCache`
  (`openrouter.ts:446-458`) colapsa por nombre cuando el schema no declara
  `properties` —el caso de las tres tools— y `openrouter.ts:593` solo cachea el
  ÉXITO. `openrouter_cache_llave.test.ts` y `openrouter_cache_fallo.test.ts`
  pasan; `openrouter_fallback_costo.test.ts:118-141` prueba que dos
  `cuadrar_viaje` en la misma ronda ejecutan una vez.
- **Truncado ≠ terminado, en las dos superficies.** `openrouter.ts:548-556`
  levanta `TruncatedError` cuando `finish_reason==='length'` y no hay tool_calls
  —cerrando el "Listo. 👍" sobre un turno vacío— y `:308-316` hace lo propio en
  `generateStructured` ANTES de parsear, con reintento que sube el tope en vez de
  regañar al modelo (`:351-361`). `openrouter_truncado.test.ts` (5) y
  `openrouter_truncado_tools.test.ts` (4) pasan.
- **El fallback no re-ejecuta mutaciones.** El reintento vive dentro de
  `complete()` (`openrouter.ts:515-524`), que corre ANTES de que las tools se
  despachen (`:567`); y `activeModel === model` impide que el fallback se dispare
  dos veces en el mismo ciclo.
- **Un modelo sin precio no cuesta $0.** `calcCost` (`openrouter.ts:106-120`)
  limpia el sufijo de proveedor, y ante un slug desconocido estima con la tarifa
  MÁS CARA y deja `llm.modelo_sin_precio`. `openrouter_costo.test.ts` pasa.
- **`data_collection:'deny'` viaja en las tres superficies**
  (`openrouter.ts:123`, aplicado en `:142`, `:293`, `:512`).
- **El `HTTP-Referer` ya no le atribuye nuestro consumo a un dominio ajeno**
  (`openrouter.ts:31-32`, `cuadra.mx` → `likida.ai`).
- **No hay canal de inyección nuevo por el snapshot.** `texto_sospechoso` es un
  `z.boolean()` (`ocr.ts:80`), no el texto; `producto`/`estacion`/`emisor` pasan
  por `sanitizarTexto` (cap 80, sin `< > \``, `sanitizar.ts:17-26`) y `producto`
  además por el filtro de datos sensibles (`sanitizar.ts:111-118`); `imagenUrl`
  nunca se escribe (`ocr.ts:377`, y `imagen_url` solo aparece en `repo.ts`).
- **Línea base**: corrí `npx vitest run src/lib/llm src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/normas src/lib/cuadra/cuadre/guardia.test.ts` → **17 archivos,
  157 pruebas, 0 fallos**; `npx tsc --noEmit` → exit 0. `git status --porcelain`
  vacío: no modifiqué ningún archivo del repo (los scripts de medición se
  crearon y borraron en la misma llamada).

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** Sin credenciales en este entorno.
  Los dos escenarios que sí medí (el ensanche de `cifrasSinRespaldo` y el tamaño
  del snapshot) se reprodujeron importando los módulos **puros** reales con
  `tsx`; el resto es lectura de código determinista.
- **Con qué frecuencia el modelo real emite `arguments` distintos de `{}`.**
  Los schemas de tools siguen sin `strict:true` (`tools.ts:31,87,146`, contra el
  único `strict:true` del repo, `openrouter.ts:290`, para el OCR). Ya no decide
  si hay doble ejecución, pero sí la frecuencia del desalineo de
  `ToolCallRecord.args`.
- **Si `openai/gpt-5.6-terra` acepta `reasoning:{effort:'high'}`** por la vía
  unificada de OpenRouter. Es el fallback del rol que corre el dinero y no hay
  forma de comprobarlo aquí; tampoco hay prueba que lo cubra.
- **`tool_calls` en streaming.** El cliente sigue sin usarlo; si se enciende,
  todo el análisis de `openrouter.ts:528-600` hay que rehacerlo.
- **Prompt caching**: sigue en cero `cache_control` en el repo. Con el snapshot
  de 17 KB entrando al contexto, es la palanca de costo más obvia y no la
  cuantifiqué.
- **El impacto real del snapshot sobre el presupuesto de 40 s** (tokens de input
  extra ↔ latencia de la ronda siguiente). Medí bytes y tokens, no milisegundos.
