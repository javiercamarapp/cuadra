# Tool calling — auditoría 11 (pase 2)

**Nota: 8/10** (antes 5). Razón del movimiento: **se atacó y subió**.

De los 17 hallazgos del pase 1 verifiqué uno por uno contra el código de hoy:
**15 están cerrados**, y no por prosa — cada uno tiene el consumidor real
cableado y una prueba que ejecuta el camino que corre (la lista con líneas está
abajo, en «Lo que revisé y está bien»). Uno queda **parcial** y **uno sigue
abierto, y sigue abierto exactamente por la trampa que el MAPA documenta**: el
arreglo del redondeo cambió el dato y no el píxel, y la prueba que lo cubre se
llama «NO imprime $0.00» mientras mide el número, no la impresión.

Las dos anclas del rubro se cumplen y por eso la nota sube a 8, no a 6:

- **Ninguna tool acepta datos del modelo.** Siguen siendo tres
  (`tools.ts:54,125,187`), las tres con
  `parameters: { type:'object', properties: {}, additionalProperties:false }`
  (`:60,131,211`), los tres handlers reciben `_args` y ninguno lo lee, y
  `tenantId`/`viajeId`/`operadorId`/`telefono` salen siempre de `ToolContext`
  (`run.ts:39` ← `processor.ts:1367`). **No hay tools nuevas** y **ningún
  consumidor nuevo cruza la frontera del modelo**: `grep` de
  `generateWithTools|generateStructured|generateResponse|toolSchemas|executeTool|makeExecutor|modelFor(|runAgent|registerTool`
  sobre todo `src` fuera de `lib/llm` y `lib/agents` devuelve **sólo**
  `processor.ts:1364` (`runAgent`) y `ocr.ts:327` (`generateStructured`). Ni una
  línea bajo `src/app/`.
- **Los tres caminos con fallback tienen prueba.** Antes era uno de tres.
  `generateWithTools` → `openrouter_fallback_costo.test.ts`;
  `generateStructured` y `generateResponse` → `openrouter_fallback_ocr.test.ts`
  (nuevo), que además fija el orden corregido: `expect(modelosPedidos())
  .toEqual([OCR, OCR_FALL])` — ya no se quema una llamada de visión contra el
  proveedor caído.

Lo que impide el 9 no está en la frontera con el modelo: está en la
**contabilidad que sale de ella**. Los cuatro hallazgos de abajo viven todos en
el tramo `llm_costo → /admin`, y dos de ellos tocan la cifra con la que se fija
el precio de Likida.

**Riesgo mayor del rubro, hoy:** el número con el que se va a poner precio —el
tile «Gastado en IA» y el desglose por modelo de `/admin`— mezcla la mensajería
de Meta con el gasto de modelo y luego lo redondea a dos decimales, en una
magnitud que vive en la cuarta.

---

## Hallazgos

### [ALTO] El arreglo del redondeo cambió el dato y no el píxel: la pantalla que existe para comparar modelos sigue imprimiendo `$0.00` (REINCIDENTE — declarado cerrado, no lo está)

`src/lib/formato.ts:98-99` · `src/lib/admin/negocio.ts:28-33` · `:142` · `:229` ·
`src/app/admin/ui/formato-preset.ts:22` ·
`src/app/admin/model-ops/page.tsx:68` · `:79` ·
`src/app/admin/page.tsx:189` · `src/app/admin/analitica/page.tsx:92` ·
`src/app/admin/costos-facturacion/page.tsx:120` ·
`src/app/admin/agente-ocr/page.tsx:83` · `src/app/admin/chat.tsx:36` ·
`src/lib/admin/negocio_paginacion.test.ts:127-132`

El pase 1 reportó que `round2` sobre el desglose por modelo imprimía
`$0.00 · 1 llamadas`. El arreglo cambió `round2` por `redondearUsd` (seis
decimales) en `negocio.ts:142` y `:229`, y el encabezado del archivo lo declara
cerrado, textualmente: «una llamada de OCR cuesta $0.0027 y `round2` la pintaba
"$0.00 · 1 llamadas" en Model Ops […] La regla correcta ya estaba escrita y
bautizada: `redondearUsd`» (`negocio.ts:28-33`).

**El redondeo del DATO se arregló; el FORMATO de la impresión no se tocó.**
`usd()` es `n.toLocaleString('en-US', { style:'currency', currency:'USD' })`
(`formato.ts:98-99`) y USD tiene dos decimales por defecto. Todas las pantallas
que pintan `costoUsd` pasan por ahí, incluida `KpiTile formato="usd"`
(`formato-preset.ts:22`).

Escenario con valores — el mismo que usa la prueba del propio arreglo: durante
el demo Gemini devuelve 503 y `anthropic/claude-haiku-4.5` resuelve UNA foto
(1,200 in / 300 out). `calcCost` con `PRICES['anthropic/claude-haiku-4.5'] =
[1,5]` da `$0.0027`. `redondearUsd(0.0027)` → `0.0027` (correcto). Model Ops
ejecuta `{usd(m.costoUsd)} · {m.n} llamadas` (`model-ops/page.tsx:79`) y pinta:

```
anthropic/claude-haiku-4.5                          $0.00 · 1 llamadas
```

**Byte por byte lo mismo que salía antes del arreglo** (`round2(0.0027)` = 0 →
`usd(0)` = `"$0.00"`). Verificado en node:
`(0.0027).toLocaleString('en-US',{style:'currency',currency:'USD'})` → `"$0.00"`.

Lo que hace que esto pase por cerrado es la prueba:
`negocio_paginacion.test.ts:127` se llama **`'getCostoPorFaseModelo con $0.0027
NO imprime $0.00'`** y lo que mide en `:132` es
`expect(r[0].costoUsd).toBe(0.0027)` — el número dentro del objeto, no la
cadena que sale a pantalla. Es el patrón que el MAPA nombra: la versión que
corre no es la que la suite mide. No hay ninguna prueba de render que asegure
un `$` con más de dos decimales en `/admin`.

Consecuencia: «¿me sale más barato Gemini o Haiku?» —la única razón por la que
existe el desglose por modelo— sigue sin poderse responder en la pantalla que
existe para responderla, y un cero ahí se lee como gratis, contra la regla que
`costos.ts:5-13` declara («cero solo se pinta cuando cero es una medición»).
Lo mismo en el asistente de `/admin` (`chat.tsx:36`): «La fase que más cuesta es
"ocr": $0.00 en 6 llamadas».

Causa raíz: el redondeo y el formato son dos capas, y el arreglo tocó la de
abajo. `redondearUsd` existe; su gemelo de impresión no.

---

### [ALTO] «Gastado en IA» —la cifra con la que se pone precio— incluye la mensajería de Meta, a una tarifa que el propio archivo dice que hoy no se cobra (NUEVO)

`src/lib/cuadra/costos.ts:60-64` · `:103-105` ·
`src/lib/admin/negocio.ts:116-121` · `:140` ·
`src/app/admin/page.tsx:136` ·
`src/app/admin/costos-facturacion/page.tsx:31` · `:55` · `:59-60` ·
`src/app/admin/fases.ts:103-107` · `src/app/admin/model-ops/page.tsx:59-83` ·
`src/lib/cuadra/analytics.ts:337-349`

`registrarCostoWhatsApp` (`costos.ts:103-105`) escribe una fila de `llm_costo`
por cada mensaje SALIENTE, con `fase:'whatsapp'`, `modelo:'whatsapp-utility'`,
`tokensIn: 0, tokensOut: 0` y el precio de `WHATSAPP_MSG_USD_DEFAULT = 0.008`.
`getResumenNegocio` suma **todas** las filas sin distinguir fase
(`negocio.ts:116-121`), y de ahí salen `costoIaUsd`, `porFase` y el numerador
del costo unitario.

Dos cosas mal en la misma cifra:

1. **No es IA.** El propio repo ya hizo esta exclusión —para el CLIENTE. En
   `analytics.ts:337-349`: «MANDAR UN WHATSAPP NO ES UNA ACCIÓN DE IA […] es la
   contabilidad del costo de la plantilla de Meta, no una llamada a un modelo»,
   y `if (fase === 'whatsapp') continue`. `/admin` se quedó fuera del arreglo:
   `admin/page.tsx:136` pinta `KpiTile etiqueta="Gastado en IA"
   valor={r.costoIaUsd}`, y Model Ops la lista como una de «las TRES fases que
   de verdad corren» bajo el encabezado **«Registro de agentes»**
   (`fases.ts:103-107`), con la prosa «Lleva la conversación con el operador de
   principio a fin: recibe fotos, confirma y cierra la liquidación» — que
   describe al agente de cuadre, no al cobro por mensaje de Meta.
2. **La tarifa no está vigente.** `costos.ts:61-63`, literal: «Dentro de la
   ventana de servicio de 24h son gratis **hasta el 1-oct-2026**; después Meta
   cobra utility/servicio (~USD 0.0080)». En el guion del demo el operador
   escribe primero, así que todos los salientes van dentro de esa ventana: el
   cargo real hoy es **$0.00** y el default asienta $0.008.

Escenario con valores (guion del demo, seis fotos, con las constantes del
propio repo):

| fase | cómo se calcula | USD |
|---|---|---:|
| ocr | 6 fotos × $0.015 (`processor.ts:863`) | 0.090 |
| cuadre | un turno de agente | ~0.030 |
| whatsapp | 4 salientes (aviso de privacidad, acuse del primer comprobante, resumen de cierre, envío del PDF) × $0.008 | 0.032 |
| **«Gastado en IA»** | | **0.152** |

**El 21% de la cifra rotulada «Gastado en IA» no es IA y hoy no se está
cobrando.** Y `costos-facturacion/page.tsx:31` divide ese mismo numerador:
`costoPorViaje = r.costoIaUsd / r.viajesProcesados` → `$0.15` bajo la etiqueta
«Costo estimado de IA por viaje procesado», contra el objetivo declarado de
$0.03–0.05 de `models.ts:38`. Con más turnos del operador la desviación crece
lineal: cada pregunta de ida y vuelta añade $0.008 a la columna «IA».

Consecuencia: Javier fija el precio por liquidación contra un número que
sobreestima el costo de modelo por un cargo de mensajería que ni es de modelo
ni se está devengando, y la dona «Costo por fase» de cuatro pantallas de
`/admin` reparte ese dinero como si fuera de un agente.

Causa raíz: `llm_costo.fase` es un eje de COSTO (dónde se va el dinero) y se
está leyendo como eje de GASTO DE MODELO. El arreglo de la ronda anterior
separó las dos taxonomías en `analytics.ts` (cliente) y no en `negocio.ts`
(consola), que es donde vive el dinero de Likida.

---

### [MEDIO] «N llamadas» cuenta tres cosas distintas en la misma lista, y ninguna de las tres son llamadas (NUEVO)

`src/lib/cuadra/costos.ts:367-372` · `:179-197` ·
`src/lib/admin/negocio.ts:124` · `:222-223` ·
`src/lib/cuadra/processor.ts:1393` · `src/lib/llm/openrouter.ts:695` ·
`src/app/admin/model-ops/page.tsx:69` · `:79` ·
`src/app/admin/page.tsx:187` · `src/app/admin/analitica/page.tsx:90` ·
`src/app/admin/costos-facturacion/page.tsx:118` ·
`src/app/admin/agente-ocr/page.tsx:81` · `src/app/admin/chat.tsx:36`

`n` está honestamente documentado en el tipo —«Cuántas **filas** de `llm_costo`
cayeron en esa fase» (`costos.ts:369`)— y las siete pantallas lo imprimen como
«N llamadas». Una fila no es una llamada, y desde el arreglo de la atribución
(`registrarCostoDesglosado`, `costos.ts:179-197`, una fila **por modelo**) ni
siquiera es una unidad estable:

- **`ocr`** — 1 fila por foto (2 si hubo fallback) ≈ 1 llamada. Correcto por
  accidente.
- **`cuadre`** — `registrarCostoDesglosado` se llama **una vez por turno**
  (`processor.ts:1393`), y un turno son hasta `maxRounds = 6` completions
  (`openrouter.ts:695`). El cierre del guion son tres: `consultar_politica` +
  `cuadrar_viaje`, luego `guardar_liquidacion`, luego el texto final.
- **`whatsapp`** — 1 fila por mensaje saliente. Cero llamadas a un modelo.

Escenario con valores: tras el cierre del demo, Model Ops pinta las tres una
debajo de otra:

```
Agente OCR              $0.09 · 6 llamadas     ← 6 llamadas reales
Agente de Cuadre        $0.03 · 1 llamadas     ← 3 llamadas reales
Agente de WhatsApp      $0.03 · 4 llamadas     ← 0 llamadas reales
```

Consecuencia: cualquier lectura de «cuánto cuesta una llamada» sale 3× alta en
la fase más cara —$0.03 en vez de $0.01— y la comparación entre fases, que es
para lo que sirve el renglón, no se sostiene. Es la misma pantalla del hallazgo
anterior y el mismo lector.

Causa raíz: `n` se derivó de la granularidad de la tabla y se rotuló con la
granularidad del proveedor; el arreglo de la atribución cambió la primera sin
tocar la segunda.

---

### [MEDIO] Una lectura de OCR que nunca llegó al proveedor escribe igual su fila de `llm_costo`, y esa fila se cuenta como «acción resuelta por los agentes» en la pantalla del contralor (NUEVO)

`src/lib/llm/openrouter.ts:491-498` · `src/lib/cuadra/intake/ocr.ts:337-368`
(`:360-366`) · `src/lib/cuadra/processor.ts:577` · `:360` · `:619-621` ·
`src/lib/cuadra/costos.ts:131-138` · `:5-13` ·
`src/lib/cuadra/analytics.ts:344-352` · `:369` ·
`src/app/dashboard/valor-ahorro/page.tsx:64` · `:97-98` · `:134`

Cuando ningún `create()` llega a responder —OpenRouter caído en el primario **y**
en el fallback, o el `AbortSignal` de la barrera de intake (`TECHO_OCR_MS`)
disparando antes de la primera petición— `cobrar()` nunca corre, así que
`gastado` queda en ceros. `conGastado` (`openrouter.ts:491-498`) igual construye
`err.usage = { model: ultimoModelo, tokensIn:0, tokensOut:0, cost:0, porModelo: [] }`,
y el `catch` de `ocr.ts:360-366` lo devuelve tal cual en `costo`. `processor.ts:577`
llama `registrarCostoDesglosado` **incondicionalmente**, y `registrarCosto` sólo
rechaza NaN y negativos (`costos.ts:131-138`): **el cero pasa**.

Resultado: una fila de `llm_costo` con `fase:'ocr'`,
`modelo:'anthropic/claude-haiku-4.5'`, `tokens_in=0`, `tokens_out=0`,
`costo_usd=0` para una llamada que nunca ocurrió — exactamente el cero que
`costos.ts:5-13` prohíbe («cero solo se pinta cuando cero es una medición»).

Y no se queda en `/admin`. `getValorAhorro` cuenta filas de `llm_costo` por fase
(`analytics.ts:344-352`, `:369`) y las devuelve como `accionesPorAgente`.

Escenario con valores, en el panel del CLIENTE: OpenRouter se cae mientras el
operador manda el lote (`models.ts:50` documenta dos caídas: ago-2025 y
feb-2026). 2 de las 6 fotos salen con `motivo:'fallo_tecnico'`; `decidirFoto`
devuelve `avisar_falla` y `processor.ts:619-621` responde «Tuve un problema de
mi lado […] ese gasto NO quedó registrado» y hace `return` — **no se escribe
ninguna fila de `gasto`**. Pero las dos filas de `llm_costo` ya se escribieron.
`/dashboard/valor-ahorro` entonces pinta, en la misma pantalla:

```
Comprobantes leídos por el Agente OCR      4      ← gasto con ocr_confianza
Acciones resueltas por los agentes         6      ← filas de llm_costo
   nota: «Conteo real — cada llamada de IA registrada»
Acciones por agente ▸ Agente OCR           6      ← HBars, :134
```

Consecuencia: dos cifras que se contradicen a diez centímetros una de otra, en
la página que el propio producto declara «la más fácil de convertir en mentira»
(`valor-ahorro/page.tsx:36-40`), delante del comprador, y con la palabra
«resueltas» sobre dos lecturas que el sistema acaba de decirle al operador que
NO resolvió.

Causa raíz: la contabilidad se escribe en el borde del intake sin preguntar si
hubo consumo. El dato para distinguirlo ya existe y ya viaja
(`tokensIn+tokensOut === 0 && cost === 0` con `porModelo` vacío); nadie lo mira.

---

### [BAJO] «Se cortó ≠ terminó» sólo se comprueba en la rama SIN `tool_calls`, y esa asimetría no tiene ninguna prueba

`src/lib/llm/openrouter.ts:780-795` · `:806` · `:816-822` ·
`src/lib/llm/openrouter_truncado_tools.test.ts:29-31` · `:59-73`

`if (!calls || calls.length === 0)` (`:780`) es la puerta: la comprobación de
`finish_reason === 'length'` vive **dentro** de ella (`:787`). Una respuesta
truncada que además trae `tool_calls` no pasa por ahí — sigue de largo a
`convo.push` y a la ejecución.

Con `properties: {}` la mayoría de los cortes caen en rejilla: `arguments` roto
→ `args_parse` y el handler NO se ejecuta (`:816-822`); `function.name` cortado
→ «tool desconocida» (`tool-executor.ts:99-101`). Lo que queda descubierto es el
corte que ocurre **después** de una `tool_call` completa: esa se ejecuta, y si
es `guardar_liquidacion` el viaje queda `liquidado`, los dos PDF subidos y el
turno cerrado a partir de una respuesta que el gateway sabe que se cortó.

`openrouter_truncado_tools.test.ts` fija `tool_calls: []` en el helper
`cortada()` (`:29-31`) y las dos pruebas de truncamiento (`:59`, `:68`) usan
sólo ése: la rama con tools es la única de las dos que no se ejercita.

Lo que lo mantiene en BAJO: con `reasoning:'high'` el corte más probable ocurre
durante los tokens de razonamiento, antes de emitir nada, y ése sí está cubierto.

---

### [BAJO] `traerTodo` se corta a 100,000 filas en silencio, y su propio comentario afirma que no

`src/lib/cuadra/pg.ts:42-44` · `:51-66`

«100 páginas son 100,000 filas. Un tenant que las pase necesita un `sum()` en
SQL, no más vueltas: **se corta y se dice**, en vez de colgar el turno». El
bucle sale por `pagina === MAX_PAGINAS` sin `logger`, sin bandera en el retorno
y sin nada que distinga «se acabó la tabla» de «me rendí». Es el mismo modo de
fallo que este archivo entero existe para no tener, una escala más arriba: a
~19 filas por liquidación son ~5,200 liquidaciones, así que no es de este año,
pero cuando llegue se verá igual que el `max_rows` que ya se cerró.

---

### [BAJO] La prueba `'formato malo dos veces sí acaba en el otro proveedor'` asevera lo contrario de lo que dice su nombre

`src/lib/llm/openrouter_fallback_ocr.test.ts:107-116`

El nombre promete que dos fallos de formato terminan en el fallback; el cuerpo
prepara tres respuestas y luego afirma
`expect(err.name).toBe('StructuredError')` y
`expect(modelosPedidos()).toEqual([OCR, OCR])` — o sea, que **no** se llega al
otro proveedor. El comentario interno lo explica bien; el nombre no. Cuenta
porque cambia el significado: quien audite la cobertura del fallback leyendo la
lista de pruebas concluye que el camino formato→fallback está cubierto y
verificado, y lo que está fijado es su ausencia.

---

### [BAJO] Tres de los cuatro `ModelRole` y uno de los dos agentes siguen sin llamador (REINCIDENTE, reducido)

`src/lib/llm/models.ts:61` · `src/lib/llm/openrouter.ts:269` ·
`src/lib/agents/registry.ts:14-20` · `src/lib/cuadra/costos.ts:58` ·
`src/app/admin/fases.ts:36-37`

Cerrado a medias: `cuadre_fallback` se retiró del tipo y `'escalacion'` salió de
`FaseCosto` con su etiqueta reubicada como fase histórica (`fases.ts:57-63`), que
es la solución correcta. Lo que sigue: `generateResponse` (`openrouter.ts:269`)
no tiene un solo llamador en `src` fuera de sus pruebas, y con él los roles
`chat` y `router` no se ejecutan nunca; `AGENT_REGISTRY.orchestrator`
(`registry.ts:14-20`) tampoco —`runAgent` se llama una sola vez, con
`agent:'liquidacion'` (`processor.ts:1365`)—; y `FaseCosto` conserva `'chat'` y
`'router'`, que nadie escribe, con «Agente de Chat» y «Agente Router» esperando
en `fases.ts:36-37`. De los cuatro roles corren dos.

---

## Lo que revisé y está bien

**Los 15 hallazgos del pase 1 que sí se cerraron, con la línea de hoy que lo
prueba.** Los verifiqué abriendo el consumidor, no el archivo del arreglo:

| Pase 1 | Cerrado en | Prueba que ejecuta el camino real |
|---|---|---|
| Atribución modelo↔tokens rota tras el fallback | `UsoPorModelo`/`sumarUso` `openrouter.ts:254-266`; acumulación por ronda `:773-776`; `PartialExecutionError.porModelo` `:619-620,859`; `generateStructured` `:414-422,483,496` | `openrouter_atribucion_modelo.test.ts`, `openrouter_fallback_costo.test.ts` |
| `modelo:'parcial'` y `modelo:'ocr'` como proveedores | `registrarCostoDesglosado` `costos.ts:179-197`; consumidores `processor.ts:360,577,1393,1446`; `ocr.ts:353-366` | idem + `costos.test.ts` |
| `negocio.ts` sin paginar y sin `order` | `traerTodo` + `.order('created_at').order('id')` `negocio.ts:95-110`; `getCostoPorFaseModelo` `:217-219` | `negocio_paginacion.test.ts` |
| Precio de Sonnet con caducidad en un comentario | `VIGENCIAS` `openrouter.ts:139-153`, `preciosCaducados` `:156-167`, `avisarPreciosCaducados` llamado desde `calcCost` `:222` | `openrouter_vigencia_precio.test.ts` — incluye un trinquete que **falla solo** el 1-sep-2026 |
| WhatsApp contado como acción de IA (cliente) | `analytics.ts:349` `if (fase === 'whatsapp') continue` | (queda el lado `/admin`, ver hallazgo 2) |
| 12.5 KB de snapshot al modelo | `paraModelo` — declarada `tool-executor.ts:36`, aplicada `:107`, consumida `openrouter.ts:643,827,849`; lista blanca `tools.ts:202-205` | `tools_resumen_al_modelo.test.ts`, `openrouter_resultado_al_modelo.test.ts` |
| `fechaRaw`/`codigoBarras` sin sanear | `sanearOcrExtra` `tools.ts:42-51`, aplicado `:308` — **y además `paraModelo` ya impide que `liq` cruce**: doble candado | `tools_ocr_extra_saneado.test.ts` |
| Nombre de tool declarado 4 veces, registro por efecto secundario | `toolSchemas` **lanza** con la lista de faltantes `tool-executor.ts:81-89`; `registry.ts:10` importa `tools.ts` (ya no cuelga de `processor.ts`) | `registro_cableado.test.ts` — 6 pruebas, sin mockear `@/lib/agents/run` |
| `cuadrar_viaje`/`consultar_politica` sin prueba de handler | — | `tools_handlers.test.ts` por la frontera de `executeTool`; ya no reimplementa el cuerpo |
| Fallback del OCR sin prueba y en el orden equivocado | escalera reordenada: fallback ANTES del reintento con nota `openrouter.ts:531-538` | `openrouter_fallback_ocr.test.ts` |
| `isTransientError` falso positivo por el offset del `SyntaxError` | `openrouter.ts:79` descarta `StructuredError`/`SyntaxError` por tipo; además clasifica por `name`/`status` antes que por texto `:86-90` | `openrouter_transitorio.test.ts` |
| Sufijo `:floor`/`:nitro` partiendo la fila | `normalizarSlug` `:202-204`, aplicado en `:290,452,775` | `openrouter_slug_sufijo.test.ts` |
| `ToolCallRecord.args` no describía el `result` | `args` que lo produjo + `desdeCache` `:584,826,843,847` | `openrouter_registro_args.test.ts` |
| `ctx.signal` sin consumir | `tools.ts:64,135,224,237` — al entrar y antes de escribir, nunca después | `tools_signal.test.ts` |
| `error.message` de Postgres cruzando al modelo | `ToolErrorVisible` `tool-executor.ts:55-60`; todo lo demás sale opaco `:117` | `tool_executor_error_opaco.test.ts` |
| Loop-guard gastaba la ronda 6 | `ultima` con `tool_choice:'none'` `:765,731`, y si insiste no ejecuta ni paga `:806` | `openrouter_loop_guard.test.ts` |

Y además, verificado por mí en este árbol:

- **La dedup de mutaciones sigue mirando el EFECTO.** `makeExecutor`
  (`tool-executor.ts:151-177`) cachea la **promesa** antes del `await` (`:167-168`),
  llavea por nombre (`:162`) y borra el fallo comparando la promesa (`:173`).
  `tool_executor_concurrente.test.ts` lo ejercita con concurrencia real.
- **La caché de lectura no puede hacer divergir el WhatsApp del PDF.**
  `cuadrar_viaje` se cachea entre rondas (`READ_PREFIXES` incluye `cuadrar_`,
  `:633`), pero `guardiaCifras` sustituye SIEMPRE el texto cuando `cuadro` es
  true (`guardia.ts:83,102-114`) y, si cerró, usa el snapshot de
  `guardar_liquidacion` (`:69-72`), que se recalcula fresco en `tools.ts:227`.
- **`paraModelo` no abre un hueco en la guardia de cifras.** `guardia.ts:95`
  valida contra `t.result` (completo) y no contra lo que vio el modelo — sería
  una guardia más permisiva de lo debido, pero es **inalcanzable**: esa rama
  exige `!cuadro`, y la única tool con `paraModelo` es `guardar_liquidacion`,
  que hace `cuadro = true` (`:38-40`). Vale la pena anotarlo: el día que una
  segunda tool declare `paraModelo`, esa línea deja de ser inofensiva.
- **ZDR en los tres caminos.** `PROVIDER_OPTS` (`:239`) va en `generateResponse`
  (`:285`), `generateStructured` (`:445`) y `complete` (`:741`).
- **Aislamiento por tenant** en las cuatro lecturas de `repo.ts` que tocan las
  tools, y las rutas de PDF (`tools.ts:268-269`) construidas sólo con IDs de
  servidor.
- **Compuerta corrida hoy sobre este árbol.** `npx vitest run src/lib/llm
  src/lib/agents src/lib/admin src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/costos.test.ts` → 25 archivos, **161 pruebas, 0 fallos**.
  `npx tsc --noEmit -p .` → exit 0. `npm run lint` → exit 0, **cero warnings**.
  No edité ningún archivo del repo salvo este entregable; la medición del
  redondeo se hizo con `node -e` en el scratchpad.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** Todo el gateway está probado con el
  SDK mockeado. En particular sigo sin verificar que un `assistant` con
  `tool_calls` emitido por Anthropic se acepte tal cual cuando la ronda
  siguiente la responde OpenAI (`openrouter.ts:808` + `:747-750`) — es
  exactamente el camino que el fallback recorre a mitad de ciclo, y sigo
  confiando en que OpenRouter normaliza los `tool_call.id`. Es una suposición, y
  es la única del rubro que puede tirar el demo entera.
- **Si OpenRouter reporta un importe propio por llamada.** Verifiqué que el
  código no lee ningún campo de costo de la respuesta (sólo `prompt_tokens` /
  `completion_tokens`) y que `PRICES` sigue siendo la única fuente: el costo de
  Likida es un **modelo del recibo, no el recibo**. No verifiqué contra el
  proveedor si hay algo que reconciliar.
- **Cuántas filas tiene `llm_costo` de verdad.** Aquí no hay Supabase; los
  conteos del guion los derivé de `processor.ts:360,414,577,1393,1673` y de
  `$0.015` por visión (`processor.ts:863`), no de la base. La aritmética del
  hallazgo 2 es reproducible cambiando el número de salientes.
- **Cuántos `sendText` del camino de error NO registran su costo.** `say()`
  (`processor.ts:406-418`) es el único que llama `registrarCostoWhatsApp`, y hay
  49 puntos de envío entre `say(` y `sendText(`: algunos avisos salen sin fila.
  Empuja la contabilidad de WhatsApp en la dirección contraria al hallazgo 2 y
  no lo medí.
- **Si el modelo llama `guardar_liquidacion` antes de tiempo.** La única
  precondición del handler sigue siendo `if (!ctx.viajeId)` (`tools.ts:225`) y
  el cierre es irreversible de cara al chofer. No puedo escribir el escenario
  con valores sin correr el modelo real, así que no lo reporto — pero es donde
  pondría el siguiente ensayo del guion.
- **`tool_calls` en streaming** y **prompt caching** (`cache_control`): siguen
  sin usarse. Con `paraModelo` ya aplicado, el resultado de tool dejó de ser la
  palanca grande; el system prompt de `prompts.ts` (~2,800 caracteres) que se
  re-paga en cada una de las hasta 6 rondas, sí lo sería. No lo evalué.
