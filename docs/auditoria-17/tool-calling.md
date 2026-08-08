# Tool calling — auditoría 17

**Nota: 7/10** (antes 7). Razón del movimiento: mirada más profunda · deuda que
cobró factura. La regla estructural está intacta y no hay nada nuevo roto en el
camino del dinero, pero los dos arreglos grandes de la ronda 10 (atribución de
costo por modelo real, detección de truncamiento) se aplicaron **a un solo lado
de cada par**: `generateWithTools` sí, `generateStructured` no; la rama "sin tool
calls" sí, la rama "con tool calls" no. Cinco MEDIO, ninguno CRÍTICO ni ALTO.

**Riesgo mayor hoy:** el costo por modelo que se pinta en `/admin` → "Costo por
modelo" no es auditable en los dos caminos que más se usan — el OCR con fallback
(todo el gasto de los intentos previos se etiqueta con el modelo del último) y el
ciclo de tools que se cae a medias (todo se escribe bajo un modelo inventado,
`parcial`). Es la cifra con la que se va a fijar el precio por liquidación.

## Hallazgos

### [MEDIO] `generateStructured`: el fallback cambia de modelo y no cambia la atribución del gasto (REINCIDENTE parcial, auditoría 10)

`src/lib/llm/openrouter.ts:430`, `:459`, `:469`, `:502` → `src/lib/likida/intake/ocr.ts:470` y `:281` → `src/lib/likida/processor.ts:800`

`gastado` acumula el consumo de **todos** los intentos (`cobrar`, :433), pero el
modelo que sale con él es el de **un solo** intento: en el éxito, el del último
(`model: usage.model`, :459); en el fallo, el **primario** (`err.usage = { model,
...gastado }`, :469). No existe aquí el `costoPorModelo` que sí se construyó para
`generateWithTools` (:638).

Escenario (rol `ocr`, primario `google/gemini-3.6-flash` [1.5, 7.5], fallback
`anthropic/claude-haiku-4.5` [1, 5]):

| intento | modelo | in | out | costo real |
|---|---|---|---|---|
| 1 | gemini-3.6-flash | 1,100 | 1,500 | $0.0129 |
| 2 (con nota) | gemini-3.6-flash | 1,100 | 1,500 | $0.0129 |
| 3 (fallback, :502) | claude-haiku-4.5 | 1,100 | 300 | $0.0026 |

Sale: `{ model: 'anthropic/claude-haiku-4.5', tokensIn: 3300, tokensOut: 3300,
cost: 0.0284 }`. `ocr.ts:470` lo pasa tal cual y `processor.ts:800` escribe **una
fila** de `llm_costo`: `modelo = anthropic/claude-haiku-4.5`, `costo_usd =
0.0284`. Haiku, que gastó $0.0026, aparece **11× más caro de lo que costó**;
gemini-3.6-flash, que gastó $0.0258, aparece con **cero llamadas y cero dólares**.
En el camino de fallo total la mentira es la simétrica: `ocr.ts:281` toma
`u?.model`, que `:469` fijó al primario, y el gasto de haiku se le carga a gemini.

Consecuencia: `/admin` → "Costo por modelo" (`src/app/admin/page.tsx:210-224`)
pinta el ranking al revés justo en el rubro donde ya se tomó una decisión de
arquitectura por dinero — la nota de `models.ts:34-47` compara $0.0188 vs $0.0015
por comprobante y elige el modelo del OCR con esos números. Con un fallback de por
medio, esa comparación se hace sobre filas que atribuyen el gasto al modelo
equivocado. Ninguna prueba lo cubre: `openrouter_costo.test.ts` verifica que el
costo **suma** todos los intentos, nunca a **quién** se le carga.

Causa raíz probable: el arreglo de la ronda 10 se implementó como un campo nuevo
del retorno de `generateWithTools` en vez de como una regla del gateway; la otra
puerta de salida del gateway se quedó con el modelo escalar.

---

### [MEDIO] En el camino de error del ciclo de tools, todo el gasto se escribe bajo un modelo que no existe (REINCIDENTE parcial, auditoría 10)

`src/lib/llm/openrouter.ts:524-545` y `:823` → `src/lib/likida/processor.ts:1908-1917`

`PartialExecutionError` transporta `tokensIn`, `tokensOut` y `cost`, pero **no**
`costoPorModelo` (:638), que sí existe y está calculado en ese momento. El
`catch` de :821-824 lo construye con `tokIn, tokOut, costo` y tira el desglose.
`processor.ts:1911-1912` escribe entonces `fase: faseDeModelo('', 'cuadre')` y
`modelo: 'parcial'`.

Escenario: turno de cierre. Ronda 1 responde `anthropic/claude-sonnet-5` (in
9,500 / out 800, $0.0270). Ronda 2 el primario devuelve 503, `complete()` cae a
`openai/gpt-5.6-terra` (:711-714) y esa ronda responde (in 11,000 / out 900,
$0.0410). Ronda 3 se agota el `AbortController` de `run.ts:41`. Sale
`PartialExecutionError(tokensIn 20500, tokensOut 1700, cost 0.068)` → una fila:
`modelo = 'parcial'`, `fase = 'cuadre'`, `$0.068`.

Consecuencia: en `/admin` → "Costo por modelo" aparece un renglón `parcial` con su
`IconoProveedor` (`src/app/admin/page.tsx:216-217`) al lado de los slugs reales, y
$0.068 de gasto **real** de Sonnet y de GPT no se le pueden imputar a ninguno de
los dos. Es además el caso que más consume (el que se cayó después de varias
rondas), y el único al que la recuperación de cierre parcial —recomendada ON para
el demo, `processor.ts:1899`— le entrega igual su PDF al cliente. Se cobra por
liquidación y esa liquidación queda sin modelo atribuible.

Causa raíz probable: el mismo arreglo de arriba se enhebró por el `return` feliz
(:756) y no por el constructor del error, que es la otra salida de la función.

---

### [MEDIO] `finish_reason: 'length'` solo se mira cuando NO hay tool calls

`src/lib/llm/openrouter.ts:736-751`

La comprobación de truncamiento vive **dentro** de `if (!calls || calls.length ===
0)`. Si la respuesta trae tool calls, el `finish_reason` no se lee nunca y el
ciclo sigue como si el turno hubiera terminado bien.

Escenario A — la mutación. El proveedor devuelve
`{ finish_reason: 'length', message: { content: null, tool_calls: [{ id:'c1',
type:'function', function:{ name:'guardar_liquidacion', arguments:'{}' } }] } }`
(Anthropic corta con `stop_reason: max_tokens` dejando el bloque `tool_use` a
medias; el `arguments` de una tool sin parámetros son dos caracteres, así que
puede quedar completo con el turno cortado). El código salta la comprobación,
salta el loop-guard, y ejecuta `guardar_liquidacion`: `cuadrarDesdeDB`, dos PDF,
dos subidas a Storage y `saveLiquidacion` — un cierre que los triggers de las
migs. 0036/0037 hacen **irreversible** (`processor.ts:1775`). El prompt pide tres
tools en orden (`prompts.ts:22-24`); si el corte llegó después de serializar la
tercera, se ejecuta un plan que el modelo no terminó de emitir.

Escenario B — el silencio. Si el corte cae a media `arguments`, `JSON.parse` falla
(:784) y se devuelve `argumentos JSON inválidos` al modelo, que reintenta y vuelve
a truncarse, hasta `LoopGuardError` en la ronda 6. En los dos escenarios **no se
emite `llm.truncado`, no se lanza `TruncatedError` y no queda una sola línea que
distinga un turno cortado de uno normal**: a las 3 am el log dice "loop guard" o
nada. Cien líneas más arriba, `generateStructured` trata la misma señal como
fatal antes de parsear (:438) precisamente porque el truncamiento disfrazado ya
mordió una vez.

Consecuencia: un techo de salida mal puesto (alguien pasa `maxTokens`, o el
razonamiento crece) degrada el sistema entero sin producir un solo síntoma
diagnosticable, y en el peor caso cierra una liquidación desde una respuesta que
el proveedor declaró incompleta. `openrouter_truncado_tools.test.ts:29-31` monta
todos sus casos con `tool_calls: []`: la mitad con tool calls no está probada.

Causa raíz probable: el arreglo de la auditoría 4 se escribió para el bug que se
vio (finalText vacío → "Listo. 👍") y se colocó dentro de la rama de ese bug, en
vez de arriba del `switch` de la ronda.

---

### [MEDIO] El techo duplicado tras un truncamiento se pierde en los dos peldaños siguientes de la escalera

`src/lib/llm/openrouter.ts:481-495` y `:502`

`attempt(model, undefined, tope * 2)` (:483) sube el techo. Pero su `catch` solo
relanza si el segundo fallo **también** es `TruncatedError` (:490); cualquier otro
error **cae por debajo** del `if` y llega al reintento con nota de :495, que no
recibe `tope` y vuelve a `opts.maxTokens ?? DEFAULT_MAX_TOKENS` = 4,000. El
fallback de :502 tampoco lo recibe.

Escenario (rol `ocr`, ticket térmico difícil): intento 1 con tope 4,000 →
`finish_reason: 'length'`, out 4,000, $0.0300. Intento 2 con tope 8,000 → el
modelo sí cierra el JSON pero devuelve `monto: "1,234.00"` (string) →
`StructuredError('Validación falló…')`, que **no** es `TruncatedError` → se cae
por el hueco. Intento 3, con nota y tope otra vez 4,000 → se trunca igual que el
primero. `isTransientError` dice `false` en los dos → `throw conGastado(e2, …)`.
`ocr.ts:262-286` devuelve `legible: false, motivo: 'fallo_tecnico'` y el chofer
recibe que su foto no se pudo leer, habiendo pagado tres llamadas (~$0.072) y
teniendo el intento 2 —el único con techo suficiente— a un error de formato de
distancia, que es exactamente para lo que existe la nota.

Consecuencia: un comprobante legible se rechaza y el operador tiene que volver a
la gasolinera a fotografiarlo, con el ticket ya guardado.

Causa raíz probable: el techo se trata como parámetro de **un intento** y no como
estado de la escalera; una vez que se sabe que 4,000 no alcanza, ningún peldaño
posterior debería volver a 4,000.

---

### [MEDIO] `cuadrar_viaje` cuenta el 15% con un criterio distinto al del motor, y paga un segundo barrido del ejercicio para hacerlo

`src/lib/likida/tools.ts:109` (contra `src/lib/likida/cuadre/desde_db.ts:78`)

`desde_db.ts:78` llama `getAcumuladoCombustible(tenantId, año, clavesCombustible)`
**con** las claves del SAT, y su comentario (`:67-69`) afirma: *"se REUSA
getAcumuladoCombustible (el mismo que usa la tool de periodo) con las claves del
SAT — una sola barrida del ejercicio, no dos consultas duplicadas con criterios
que podían divergir."* La tool llama `getAcumuladoCombustible(ctx.tenantId,
ejercicio)` **sin** claves, y `repo.ts:831` cae entonces a `concepto.eq.diesel` a
secas — que es literalmente el criterio que la auditoría 14 documentó como el bug
(`repo.ts:827-831`). El `config` con `hidrocarburos.claves` está disponible cinco
líneas más abajo (`tools.ts:114`) y no se usa.

Escenario, ejercicio 2026 de una flota cuyos CFDI de gasolinera entran con
`clave_prod_serv = 15101514` pero `concepto` distinto de `diesel`:

- combustible con `concepto='diesel'`: $500,000, de los cuales $60,000 en efectivo.
- combustible con clave del SAT y otro concepto: $500,000, de los cuales $90,000 en efectivo.

Motor (`desde_db`): 150,000 / 1,000,000 = **15.0%** → `evaluarTope15` marca
`excedido`/`cerca` y el cuadre levanta su diferencia.
Tool (`tools.ts:109`): 60,000 / 500,000 = **12.0%** → `holgado`, `aviso: null`,
y ni siquiera se agrega `rfa-2026-2.9` a `fundamentos` (`:129`). Dos veredictos
del mismo artículo dentro de **la misma llamada a la misma tool**.

Consecuencia hoy es acotada y por una razón incómoda: `combustible_efectivo_ejercicio`
**no tiene canal de salida**. Siempre que `cuadrar_viaje` corre sin error,
`guardia.ts:38-40` pone `cuadro = true`, `:83` no corta y `:114` sustituye el
texto del modelo **entero** por `resumenCuadre(...)`, que no imprime ese bloque.
`avisoTope15` no tiene otro llamador en todo `src/` — la cadena
`getAcumuladoCombustible → evaluarTope15 → avisoTope15` produce una frase que
nadie puede recibir salvo que la guardia reviente (`processor.ts:1963`). Lo que sí
se paga siempre: en un turno de cierre, `gasto` se barre **tres veces** por el
mismo ejercicio (`tools.ts:92` → `desde_db:78`; `tools.ts:109`; `tools.ts:164` →
`desde_db:78` otra vez), a 1,000 filas por página con `acotada()` de 8 s cada una,
dentro de un turno acotado a 40 s (`processor.ts:1853`) y de un webhook de 60 s.

Causa raíz probable: la unificación de criterios de la auditoría 14 se hizo en el
consumidor nuevo (`desde_db`) y el consumidor viejo (`tools.ts`) se quedó con la
firma de dos argumentos, que sigue compilando.

## Lo que revisé y está bien

- **La regla estructural sigue intacta.** `grep registerTool` sobre `src/` da
  exactamente tres registros, todos en `src/lib/likida/tools.ts` (`:25`, `:81`,
  `:151`), y los tres declaran `parameters: { type:'object', properties: {},
  additionalProperties: false }` (`:31`, `:87`, `:158`). Ninguna tool nueva desde
  el renombre; `git show 87426f8 -- src/lib/llm/openrouter.ts` son cuatro líneas
  de comentario (Cuadra→Likida). `AGENT_REGISTRY.liquidacion.tools`
  (`registry.ts:21`) no creció. Los tres handlers reciben `_args` y no lo tocan;
  `tenantId`/`viajeId`/`operadorId` salen de `ToolContext` (`run.ts:42`).
- **Dedup de mutaciones por PROMESA, no por resultado.** `tool-executor.ts:147-170`:
  se registra la promesa antes del `await`, así que el `Promise.all` de :776 no
  tiene ventana de check-then-act; la llave es el **nombre** (el efecto), no los
  args (la llamada); el fallo no se cachea (:169).
- **La caché de lectura llavea por efecto.** `llaveDeCache` (:576-588) reduce la
  llave al nombre cuando el schema no declara propiedades, y `ToolCallRecord`
  guarda los args **originales** (:796, :814), no los de la invocación que acertó
  la caché.
- **El loop-guard corta antes de gastar.** `:769-771` lanza en `round ===
  maxRounds - 1` **antes** del `Promise.all`, así que la última ronda no ejecuta
  una mutación cuyo resultado nadie va a leer. Probado en
  `openrouter_loopguard.test.ts:40` con `maxToolRounds: 3`.
- **El error de Postgres no cruza hacia el modelo.** `tool-executor.ts:82-89`
  filtra por vocabulario y deja pasar el mensaje de negocio ("sin viaje activo");
  el detalle completo se queda en `logger.error` (:109).
- **Clasificación de error transitorio por tipo antes que por texto**
  (`:103-107`), y el lookbehind de `:122` impide que un folio (`FOLIO-502`), un
  importe (`$500`) o un decimal (`503.00`) se lean como un 5xx de proveedor.
- **Ningún modelo de `PRICES` queda aislado de la red de respaldo**:
  `modelosAisladosDeFallback()` (:91-94) + `openrouter_fallback_cobertura.test.ts:29`.
- **Costo por ronda al precio de la ronda** en el ciclo de tools (`:729-731`), con
  el desglose por modelo consumido en `processor.ts:1875-1883`. Probado en
  `openrouter_fallback_costo.test.ts:55` y `:97`.
- **`costoReal` prefiere el costo del proveedor** (:177-188) y `calcCost` nunca
  devuelve 0 en silencio para un modelo sin precio (:198-203).
- **`registrarCosto` no escribe un cero que nadie midió**: NaN o negativo se
  descartan con línea de error (`costos.ts:120-127`), y `precioMensajeWhatsAppUsd`
  distingue `'0'` a propósito de `''` por descuido (`:67-83`).
- **Nada de lo que la tool le enseña al modelo llega crudo al chofer.** El
  historial que se le pasa al agente son solo turnos `user`/`assistant`
  (`processor.ts:1820`): los mensajes `role:'tool'` —que sí traen los veredictos
  `SOLO_CONTRALOR` en `diferencias[].nota`— no se persisten ni se replican al
  turno siguiente, y en el turno en que sí los ve, `guardia.ts:114` sustituye el
  texto por `resumenCuadre(..., 'operador')`, que los filtra.
- **Los `norma_id` que emiten las tools existen**: `por_diferencia.test.ts:50-56`
  falla si alguno no está en el índice, y `normasDePolitica` filtra además en
  runtime (`por_diferencia.ts:148`).
- Compuerta del rubro: `npx vitest run src/lib/llm src/lib/likida/tools_*.test.ts
  src/lib/likida/costos.test.ts` → 19 archivos, **114 pruebas verdes**.

## Lo que NO alcancé a revisar

- **`cache_control` sobreviviendo al fallback.** `soportaCache` se calcula con
  `model`, no con `activeModel` (`openrouter.ts:666`), así que cuando el rol
  `cuadre` (`anthropic/claude-sonnet-5`) cae a `openai/gpt-5.6-terra` (:66) el
  system sigue viajando como array de partes con `cache_control: {type:'ephemeral'}`
  hacia un modelo de OpenAI. El comentario de :664-665 afirma que "un modelo que
  no la entienda la ignora", pero no pude comprobar contra el gateway real qué
  hace OpenRouter con esa extensión en un proveedor que no la soporta, y no voy a
  reportar como hallazgo algo que depende de un comportamiento del gateway que no
  medí. Es el primer sitio que miraría si el fallback del cuadre falla en el demo.
- **`modelFor('cuadre_fallback')` no se llama en ningún sitio de `src/`.** La
  escalación a Opus que documenta `models.ts:52-54` y la fase `escalacion` que
  deriva `costos.ts:103` no tienen productor. No lo escribo como hallazgo porque
  `/admin` pinta las fases desde los datos (`admin/page.tsx:195-201`), así que no
  se pinta un cero inventado — pero la nota del rubro para la próxima ronda es que
  `ROLE_PARAMS.cuadre_fallback` y `faseDeModelo(...'opus'...)` son código que
  ninguna ruta puede alcanzar.
- **El comportamiento real de `res.model` de OpenRouter con sufijo de proveedor.**
  `costoPorModelo` llavea por `activeModel` (el slug pedido) y el retorno escalar
  por `res.model` (el que reporta el gateway), así que `processor.ts:1876` puede
  escribir dos etiquetas distintas para el mismo modelo según haya habido fallback
  o no. `calcCost` ya tolera el sufijo (:192-193); lo que no verifiqué es si
  `llm_costo` acaba con `anthropic/claude-sonnet-5` y `anthropic/claude-sonnet-5:floor`
  como dos renglones en "Costo por modelo".
- No corrí `pruebas-manuales/*.prueba.ts` (llamadas reales de pago) ni
  `npm run build`, por instrucción.
