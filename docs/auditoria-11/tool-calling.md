# Tool calling — auditoría 11

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda**.

El código propio del rubro es **byte-idéntico** al que auditó la ronda 10.
Verificado, no inferido: `git log --oneline -45 -- src/lib/llm src/lib/cuadra/tools.ts
src/lib/agents src/lib/cuadra/costos.ts` devuelve **un solo commit** (`cce7543`,
3-ago) y en él los cinco archivos aparecen como `new file` — o sea, la historia
del rubro empieza y termina ahí. Ninguno de los 40 commits nuevos de `master`
tocó el gateway, el registro de tools ni `costos.ts`. Todas las líneas que citó
la ronda 10 siguen en el mismo número de línea. Ninguno de sus hallazgos está
cerrado en este árbol.

Lo que baja la nota no es código nuevo roto: es que al mirar el otro extremo del
rubro —la **contabilidad**, no la frontera— aparece un segundo modo de fallo
silencioso que nadie había encontrado. **La única consulta del repo que produce
la atribución de costo (`negocio.ts:64`) lee `llm_costo` sin paginar y sin
`order`.** El mismo archivo `pg.ts:28-35` declara ese borde como «AUDITORÍA 8,
ALTO REINCIDENTE», `analytics_paginacion.test.ts` tiene una prueba entera para
él, y la consulta del dinero de Likida no lo usa. A partir de la fila 1,001 el
tile «Gastado en IA» de `/admin` deja de crecer para siempre, sin una línea de
log.

Lo que sostiene la nota en 5 y no más abajo: **la regla estructural sigue
intacta y la volví a verificar línea por línea.** `grep -rn "registerTool("` en
código de producción devuelve exactamente tres registros (`tools.ts:25,81,139`),
los tres con `parameters: { type:'object', properties: {}, additionalProperties:
false }` (`:31,87,146`), los tres handlers reciben `_args` y ninguno lo lee, y
`tenantId`/`viajeId` salen siempre de `ToolContext`. **No hay tools nuevas**, así
que la regla no se rompió. El ancla de 8 sigue cumpliéndose a la mitad: de los
tres caminos con fallback del gateway, uno tiene prueba.

Riesgo mayor del rubro, hoy: **el costo por liquidación de Likida —la cifra con
la que se va a fijar el precio— tiene dos formas distintas de bajar sola sin que
nada avise**: la atribución por modelo miente tras un fallback, y la lectura
completa se corta en 1,000 filas.

---

## Hallazgos

### [ALTO] La atribución modelo↔tokens tras el fallback sigue rota en los tres caminos, y `parcial`/`ocr` se siguen pintando como proveedores (REINCIDENTE, líneas idénticas)

`src/lib/llm/openrouter.ts:329` · `:339` · `:537` · `:394-415` ·
`src/lib/cuadra/processor.ts:1171` · `:1199-1200` ·
`src/lib/cuadra/intake/ocr.ts:281` ·
`src/lib/admin/negocio.ts:96-98` · `:193-194` ·
`src/app/admin/page.tsx:195-208` · `src/app/admin/model-ops/page.tsx:85-90` ·
`src/app/admin/proveedor-icono.tsx:42-47`

Los cuatro defectos siguen presentes, uno por uno, en las mismas líneas:

1. `generateStructured` camino de ÉXITO (`:329`): `model: usage.model` (el del
   ÚLTIMO intento) junto a `...gastado`, que es el acumulado de TODOS
   (`:265-270`, `:303`).
2. `generateStructured` camino de ERROR (`:339`): `err.usage = { model,
   ...gastado }` usa el modelo **primario** con el consumo del fallback dentro.
3. `generateWithTools` (`:537`): `used = res.model || activeModel` conserva sólo
   el modelo de la última ronda. El importe (`:536`) sí suma bien ronda a ronda
   y tiene prueba; lo que miente es la etiqueta.
4. `PartialExecutionError` (`:394-415`) no lleva el modelo, aunque `used` y
   `activeModel` están en alcance en el `catch` de `:603`. Por eso
   `processor.ts:1200` escribe literalmente `modelo: 'parcial'`.

Escenario con valores (el del cuadre, que es el del demo): el agente corre 5
rondas con `anthropic/claude-sonnet-5` (4,800 in / 1,100 out en total) y en la
ronda 4 OpenRouter devuelve 503; `complete` (`:518`) mueve `activeModel` a
`openai/gpt-5.6-terra`, que resuelve las dos últimas rondas (1,900 in / 400 out).
`generateWithTools` devuelve `model: 'openai/gpt-5.6-terra'`, `tokensIn: 6700`,
`tokensOut: 1500`, `cost` correcto. `processor.ts:1171` escribe UNA fila en
`llm_costo` que dice que gpt-5.6-terra consumió 6,700 tokens de entrada; 4,800
fueron de Anthropic. En Model Ops eso sale como
`cuadre → openai/gpt-5.6-terra · 1 llamadas · $0.14`, con la insignia de letra
«O» (`proveedor-icono.tsx:42-47`, no hay logo de OpenAI), y Sonnet desaparece
del renglón del cuadre.

Y con la rama de cierre parcial —la que el demo corre con
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1` y la que más tokens consume— el renglón que
aparece bajo el encabezado **«Costo por modelo»** (`admin/page.tsx:195`) es
`[P] parcial · N llamadas · $X`. `parcial` no es un modelo; tampoco `ocr`
(`ocr.ts:281`, el fallback cuando el error no trae `usage.model`) ni
`whatsapp-utility` (`costos.ts:87`, ése sí a propósito).

Consecuencia: quien fija el precio de Likida lee «Anthropic gastó $X» sobre una
atribución que el código no sabe calcular, sin ninguna marca de estimación. Es
el modo de fallo que `costos.ts:5-13` declara prohibido —«cero sólo se pinta
cuando cero es una medición»— aplicado a la columna de al lado.

Causa raíz probable: `model` se trata como escalar de la llamada completa cuando
el consumo es de N llamadas a M proveedores, y `llm_costo.modelo` no distingue
«slug de proveedor» de «etiqueta interna».

---

### [ALTO] La única consulta que produce la atribución de costo lee `llm_costo` sin paginar y sin `order`: a partir de la fila 1,001 el gasto en IA se congela para siempre (NUEVO)

`src/lib/admin/negocio.ts:64` · `:12-14` · `:189` ·
`src/lib/cuadra/pg.ts:28-38` (`traerTodo`) ·
`src/lib/cuadra/analytics_paginacion.test.ts:3-12`

`getResumenNegocio` hace
`admin.from('llm_costo').select('tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at')`
—sin `.order()`, sin `.range()`, sin `traerTodo`—, y `getCostoPorFaseModelo`
(`:189`) hace lo mismo con `select('fase, modelo, costo_usd')`. De ahí salen
**todas** las cifras de IA de `/admin`: `costoIaUsd`, `tokensIn/Out`, `porFase`,
`porModelo`, `porDia`, las dos tendencias y el `costoIaUsd` por flota.

El repo ya sabe que esto se corta: `pg.ts:28-35` lo declara textualmente
(«PostgREST recorta en silencio a `max_rows` (1,000 por default) sin avisar — no
lanza, no loguea»), `traerTodo` existe para eso, y
`analytics_paginacion.test.ts` prueba el caso con 1,001 filas. `negocio.ts:12-14`
reconoce la deuda en un comentario («hoy son 131 filas… el día que crezca de
verdad»), pero **la pantalla no la reconoce**: el tile dice «Gastado en IA» con
un número y una flecha de tendencia, sin caveat.

Escenario con valores. Cada liquidación del guion escribe ~19 filas de
`llm_costo`: 6 de `fase:'ocr'` (una por foto, `processor.ts:508`), ~3 de
`fase:'cuadre'` (una por turno del agente, `:1171`) y ~10 de `fase:'whatsapp'`
(una por mensaje saliente, `say()` en `:364`). Con 131 filas hoy, la tabla pasa
las 1,000 alrededor de la liquidación **#46**. En la #47: se gastan $0.05
reales, entran 19 filas nuevas, y `getResumenNegocio` devuelve exactamente el
mismo `costoIaUsd` que antes. Sin `.order()`, Postgres entrega el primer bloque
que produce el plan —para una tabla append-only, las **más viejas**—, así que
las filas nuevas son justamente las que se caen: `porDia` deja de tener días
recientes, `sumaEnVentana(inicioActual, …)` da 0, y `tendencia()` devuelve
`null` (`:133`) — la flecha simplemente desaparece en vez de gritar.

Consecuencia: Javier fija el precio por liquidación contra un panel cuyo gasto
en IA dejó de crecer, y el modo de fallo es exactamente el que `costos.ts:5-13`
llama el peligroso: «bajó sola y nadie lo notó». Además, el modelo nuevo que
sólo empezó a usarse esta semana (p. ej. el fallback) nunca aparece en «Costo
por modelo», porque sus filas son las últimas.

Causa raíz probable: los dos bordes de PostgREST se extrajeron a `pg.ts` para el
panel del CLIENTE (`analytics.ts`, `operacion.ts`) y la consola del superadmin
—que es donde vive el dinero de Likida— se quedó fuera del refactor.

---

### [MEDIO] `round2` sobre el desglose por modelo imprime `$0.00 · 1 llamadas` en la pantalla que fija el precio (NUEVO)

`src/lib/admin/negocio.ts:113` · `:200` · `src/lib/formato.ts:63-65` ·
`src/app/admin/model-ops/page.tsx:88` · `src/app/admin/page.tsx:207` ·
`src/lib/llm/models.ts:17` · `src/lib/llm/openrouter.ts:89`

`porModelo` y `getCostoPorFaseModelo` redondean cada renglón con `round2`, y las
pantallas lo imprimen con `usd()`, que es `toLocaleString('en-US', {style:
'currency'})` — dos decimales.

Escenario con valores: durante el demo Gemini devuelve un 503 y el fallback
`anthropic/claude-haiku-4.5` resuelve UNA foto: 1,200 in / 300 out. `calcCost`
con `PRICES['anthropic/claude-haiku-4.5'] = [1,5]` (`openrouter.ts:89`) da
`1200×1/1e6 + 300×5/1e6 = $0.0027`. `round2` → `0`. Model Ops pinta, bajo
«Agente OCR»:

```
anthropic/claude-haiku-4.5                          $0.00 · 1 llamadas
```

Un renglón que afirma que una llamada de visión a Anthropic costó cero. No es un
hueco declarado: es una medición redondeada a cero, al lado de un contador de
llamadas que sí es exacto. El propio `models.ts:17` fija el objetivo del
producto en **$0.03–0.05 por liquidación** — una magnitud que dos decimales
apenas distinguen de cero, y que por modelo y por fase es siempre inferior a un
centavo hasta que hay decenas de llamadas.

Consecuencia: la comparación «¿me sale más barato Gemini o Haiku?» —la única
razón por la que existe el desglose por modelo— no se puede hacer en la pantalla
que existe para hacerla, y un cero ahí se lee como gratis. `costos.ts` ya usa
`round6` para lo mismo (`round6()`, `:299-301`); `negocio.ts` no.

Causa raíz probable: se reusó el `round2` de pesos mexicanos para dólares de
costo unitario de IA, que viven tres órdenes de magnitud más abajo.

---

### [MEDIO] El precio de Sonnet 5 es una tarifa introductoria con fecha de caducidad escrita en un comentario y sin nada que la haga cumplir (NUEVO)

`src/lib/llm/openrouter.ts:87` · `:106-120` · `src/lib/llm/models.ts:37`

```ts
'anthropic/claude-sonnet-5': [2, 10],  // intro VIGENTE hasta 31-ago-2026; revertir a [3,15] después
```

`PRICES` es la **única** fuente del costo: `calcCost` (`:106`) multiplica tokens
por esa tabla y nadie reconcilia jamás contra un importe reportado por el
proveedor. `grep -rn "PRICES\|31-ago" src/lib/llm/*.test.ts src/lib/cuadra/costos.test.ts`
no devuelve ninguna aserción sobre la tarifa ni sobre la fecha: no hay prueba,
ni assert de arranque, ni log.

Escenario con valores: el 1-sep-2026 Anthropic revierte a $3/$15 y nadie toca el
archivo. Un cuadre de 6,700 in / 1,500 out se sigue registrando en `llm_costo`
como `6700×2/1e6 + 1500×10/1e6 = $0.0284`; el cargo real es
`6700×3/1e6 + 1500×15/1e6 = $0.0426`. **Un 50% de subestimación**, en la fase
más cara, en todas las filas, sin una sola línea de aviso — mientras
`llm.modelo_sin_precio` (`:118`) sí grita cuando el modelo es desconocido. El
caso «el precio que conozco ya no es el precio» es justo el que no avisa.

Consecuencia: el costo por liquidación es un **modelo del recibo, no el recibo**,
y su parámetro más caro caduca 25 días después del demo. Likida va a cobrar por
liquidación: el margen se defiende con esa cifra.

Causa raíz probable: una tarifa con vigencia se guardó como constante, y la
vigencia como comentario.

---

### [MEDIO] El contralor ve los envíos de WhatsApp contados como «acciones resueltas por los agentes» (NUEVO)

`src/lib/cuadra/costos.ts:86-88` · `src/lib/cuadra/analytics.ts:283-293` ·
`:310` · `src/app/dashboard/valor-ahorro/page.tsx:51` · `:83-85` · `:12-14` ·
`:120-122`

Éste es el consumidor **de cliente** de la taxonomía que produce mi rubro, y no
lo había mirado nadie. `getValorAhorro` cuenta filas de `llm_costo` agrupadas por
`fase` y las devuelve como `accionesPorAgente`; la página las mapea con
`FASE_LABEL` a «Agente OCR / Agente de Cuadre / Agente de WhatsApp» y las pinta
en `HBars`, más un KpiTile «Acciones resueltas por los agentes» cuya nota afirma
«Conteo real — **cada llamada de IA registrada** (OCR, cuadre, WhatsApp)».

Las filas de `fase:'whatsapp'` no son llamadas de IA. Las escribe
`registrarCostoWhatsApp` (`costos.ts:86-88`) una vez por **mensaje saliente**,
con `tokensIn: 0, tokensOut: 0` y `modelo: 'whatsapp-utility'` — el propio
nombre dice que es la tarifa *utility* de Meta.

Escenario con valores, con el guion del demo (6 fotos, ~3 turnos del agente, ~10
mensajes salientes contando el aviso de privacidad, los acuses y el envío del
PDF): el KpiTile dice **19 acciones resueltas por los agentes**, de las cuales 10
consumieron 0 tokens; y la barra más larga de «Acciones por agente» —la primera,
porque `HBars` recibe la lista ordenada por `n` descendente (`analytics.ts:310`)—
es **«Agente de WhatsApp», con 10**, por delante del OCR (6) y del cuadre (3).

Consecuencia: en la pantalla que el producto declara «la más fácil de convertir
en mentira» (`valor-ahorro/page.tsx:24`), el agente más productivo de Likida
resulta ser el cobro por mensaje de Meta. El contralor no puede refutarlo con su
PDF, pero es la clase de cifra que se cae en la primera pregunta —«¿qué hizo el
Agente de WhatsApp diez veces?»— delante del comprador.

Causa raíz probable: `llm_costo.fase` se diseñó como eje de **costo** (dónde se
va el dinero, y el envío de WhatsApp cuesta), y se está leyendo como eje de
**trabajo de IA** (qué hizo el producto). Son dos taxonomías distintas en una
sola columna.

---

### [MEDIO] `guardar_liquidacion` devuelve 12.5 KB al modelo para que use 153 bytes, con 24 RFC, 12 UUID y 12 rutas de foto dentro (REINCIDENTE, remedido hoy)

`src/lib/cuadra/tools.ts:209` · `src/lib/cuadra/repo.ts:508` ·
`src/lib/llm/openrouter.ts:595` · `:564,598` ·
`src/lib/cuadra/cuadre/guardia.ts:69-72`

El comentario de `tools.ts:196-208` justifica bien POR QUÉ el snapshot tiene que
viajar —`guardia.ts:69-72` lo reusa para no narrar dos cuadres distintos del
mismo cierre—, pero lo manda por el canal que además alimenta al modelo:
`openrouter.ts:595` hace `JSON.stringify(exec.result)` y lo empuja a `convo`
como mensaje `role:'tool'`.

Remedido hoy con 12 comprobantes y **exactamente** los campos que `repo.ts:508`
lee (`ocr_extra`, `rfc_emisor`, `rfc_receptor`, `cfdi_uuid`, `imagen_url`,
`ieps_traslado`…) más 3 diferencias con su `nota`:

```
JSON.stringify(result)          → 12,494 bytes  (~3,100 tokens)
sólo liq.gastos                 → 11,725 bytes
lo que el modelo realmente usa  →      153 bytes  (liquidacion_id, estatus,
                                        diferencia, pdf_generado,
                                        pdf_contralor_generado)
```

Consecuencia doble: ~3,100 tokens de entrada extra en cada ronda posterior al
cierre (a $2/1M de Sonnet, ~$0.006 por ronda — 12-20% del objetivo de
$0.03-0.05 que declara `models.ts:17`, gastados en datos que el modelo no lee); y
24 RFC, 12 UUID de CFDI y 12 rutas de foto salidos al proveedor. No es exposición
a una persona —`guardia.ts` sustituye el texto y el gateway fuerza ZDR
(`openrouter.ts:123`)— pero `models.ts:19-23` fija el criterio como
minimización, no sólo como ZDR.

Causa raíz probable: un solo `result` sirve a dos consumidores con necesidades
opuestas (la guardia necesita todo, el modelo casi nada) y no hay separación
entre lo que vuelve al llamador y lo que vuelve al modelo.

---

### [MEDIO] `fechaRaw` y `codigoBarras` llegan SIN SANEAR al contexto del modelo por el resultado de `guardar_liquidacion` (REINCIDENTE)

`src/lib/cuadra/tools.ts:209` · `src/lib/cuadra/intake/ocr.ts:404` · `:418` ·
`src/lib/cuadra/intake/cfdi.ts:251` · `src/lib/cuadra/repo.ts:508,519` ·
`src/lib/llm/openrouter.ts:595,598`

El intake sanea casi todo lo que sale de una foto (`producto` por
`sanitizarProducto`, `estacion`/`emisor` por `sanitizarTexto` con cap de 80,
`folio`/`webId` por `sanitizarFolio`). Dos campos de `ocrExtra` no pasan por
nada: `fechaRaw` (salida cruda del modelo de visión, schema
`z.string().nullable()` sin `max` ni regex) y `codigoBarras` (texto decodificado
por zxing tal cual). Viajan a `gasto.ocr_extra`, vuelven en `getGastos`
(`repo.ts:519`) dentro de `liq.gastos`, y `tools.ts:209` mete `liq` entera en el
resultado de la tool.

Escenario con valores: un comprobante de caseta con un PDF417 que codifica 1,100
caracteres de texto libre. `clasificarQr` no lo reconoce como CFDI ni como URL,
cae en `return { texto: t }` (`cfdi.ts:251`) y `codigoBarras` queda con los 1,100
caracteres. Al cerrar, el mensaje `role:'tool'` lleva esos 1,100 caracteres × el
número de comprobantes con código.

Consecuencia: quien imprime el papel decide contenido arbitrario dentro del
contexto del modelo en el turno que cierra el dinero, y decide sin tope el tamaño
de ese prompt.

Lo que lo mantiene en MEDIO y no ALTO, verificado otra vez hoy: `guardiaCifras`
sustituye SIEMPRE el texto cuando `cuadro` es true (`guardia.ts:83,114`) y
`guardar_liquidacion` cuenta como cuadre (`:38-40`); las tres tools no aceptan
datos del modelo, así que el texto no puede cambiar qué fila se escribe; y la
mutación está deduplicada por efecto (`tool-executor.ts:94-120`).

Causa raíz probable: la sanitización se diseñó para lo que se PERSISTE y lo que
se ENSEÑA, y nadie declaró que `ocrExtra` también se REMITE al modelo.

---

### [MEDIO] El nombre de una tool se declara CUATRO veces y el registro entero cuelga de un import por efecto secundario, sin ninguna prueba (REINCIDENTE)

`src/lib/cuadra/tools.ts:25,29` · `src/lib/agents/registry.ts:21` ·
`src/lib/agents/prompts.ts:22,23,24,27` · `src/lib/llm/tool-executor.ts:35-39` ·
`src/lib/cuadra/processor.ts:9`

Cuatro cadenas sueltas que deben coincidir: la llave del registro, el
`schema.function.name`, `AGENT_REGISTRY.liquidacion.tools` (tipado
`string[]`) y el prompt del sistema, que le ordena al modelo llamarlas por
nombre. `toolSchemas` descarta en silencio lo que no encuentra
(`.map(n => REGISTRY.get(n)?.schema).filter(Boolean)`), y el registro completo
depende de **una línea**: `import '@/lib/cuadra/tools';` en `processor.ts:9`
(`run.ts` no importa `tools.ts`).

Repetido hoy: `grep -rn "toolSchemas\|AGENT_REGISTRY" src --include=*.test.ts` →
**vacío**. Y todos los tests de processor mockean `@/lib/agents/run`
(`processor_cierre.test.ts:67` y 14 archivos más), así que ninguna prueba del
repo ejecuta jamás `toolSchemas(config.tools)` con el registro poblado.

Escenario con valores: alguien reordena imports y un linter «de imports sin uso»
se lleva `processor.ts:9`. `REGISTRY` queda vacío, `toolSchemas` devuelve `[]`,
`generateWithTools` manda `tools: undefined` y `tool_choice: undefined`
(`openrouter.ts:501-502`), el agente narra sin llamar nada, `guardiaCifras`
calcula `cuadro = false` y ningún viaje cierra. `npx tsc --noEmit` sale 0, `npm
run lint` sale 0 con 6 warnings, y las 1,670 pruebas pasan.

Consecuencia: el único punto donde la superficie de tools completa puede
desaparecer sin poner una prueba en rojo, a dos días del demo.

Causa raíz probable: cuatro cadenas que deben coincidir, un registro que se
puebla por efecto secundario, y ningún invariante —de tipo o de prueba— que
exija ninguna de las dos cosas.

---

### [MEDIO] `cuadrar_viaje` y `consultar_politica` siguen sin prueba de handler, y la que parece cubrir a la segunda REIMPLEMENTA su cuerpo (REINCIDENTE)

`src/lib/cuadra/tools.ts:81-136` · `:25-76` ·
`src/lib/cuadra/normas/permiso_politica.test.ts:31-44`

Repetido hoy: `grep -rn "executeTool(" src --include=*.test.ts` devuelve **una
sola línea** en todo el repo — `tools_cableado.test.ts:104`, y sólo para
`guardar_liquidacion`.

`permiso_politica.test.ts:32-44` no reconstruye la forma del resultado: **copia
el cuerpo**. Su comentario lo dice («Lo que `consultar_politica` devuelve hoy») y
las líneas 34-43 son carácter por carácter el `return` de `tools.ts:65-74`.

Escenario con valores: invertir `tools.ts:117` de `periodo.estado !== 'holgado'`
a `===` quita el permiso de citar `rfa-2026-2.9` justo cuando la flota va
rebasando el 15% de combustible en efectivo —que es cuando importa— y se lo da
cuando va holgada: el agente explica el diésel en efectivo citando sólo LISR
27-III («no deducible, punto») en vez de LISR 27-III + la facilidad del 15%.
Invertir `:131` (`verificada`) hace que afirme tajante sobre una ficha
`sin_verificar`. Ninguna de las dos mutaciones pone en rojo ninguna de las 1,670
pruebas.

Consecuencia: las dos tools que deciden qué ley puede invocar el producto delante
del contralor son las únicas sin arnés.

Causa raíz probable: la prueba se escribió un nivel por debajo del que tiene el
riesgo (`normasDePolitica`), no en la frontera (`executeTool`).

---

### [MEDIO] El fallback del OCR —el camino feliz del demo— sigue sin prueba y quema una segunda llamada contra el proveedor caído antes de usarlo (REINCIDENTE)

`src/lib/llm/openrouter.ts:345-379` (`:364`, `:369-375`) · `:19-36` ·
`src/lib/cuadra/intake/ocr.ts:253-261`

Tres fallbacks cross-provider en el gateway, **uno con prueba**:
`openrouter_fallback_costo.test.ts` cubre `generateWithTools`. `generateResponse`
(`:157`) no tiene ninguna —y de hecho no tiene tampoco ningún llamador, ver el
BAJO de roles muertos—. `generateStructured` (`:369-375`) tampoco, y es el que
usa `ocr.ts:253`: el que salva la demo si Gemini se cae mientras el contralor
mira la pantalla. Los cuatro archivos que sí lo tocan
(`openrouter_costo`, `openrouter_truncado`, `openrouter_truncado_tools`,
`openrouter_transitorio`) no llegan a `attempt(fallback, note)`.

Y el orden está mal: tras el fallo transitorio `e1`, `generateStructured` ejecuta
`attempt(model, note)` (`:364`) —una segunda llamada completa al MISMO proveedor
caído, con la imagen del ticket adjunta— y sólo si ésa también falla mira el
fallback (`:369`).

Escenario con valores: OpenRouter devuelve 503 para `google/gemini-3.6-flash`.
`getClient()` (`:23-34`) no fija `maxRetries`, así que hereda el default 2 del
SDK de OpenAI: cada `attempt()` son hasta 3 peticiones con backoff. Intento 1
≈ 2.2 s, intento 2 contra el mismo proveedor muerto ≈ 2.2 s, y recién entonces se
prueba `anthropic/claude-haiku-4.5`. ~4.4 s tirados por foto, dentro de una
invocación de 60 s.

Consecuencia: el mecanismo que existe para que «un provider caído nunca sea un
error visible para el operador» (`openrouter.ts:52-53`) es, en el camino del OCR,
código que nunca corrió en una prueba y que además llega tarde. En la sala eso es
«no pude leer tu ticket».

Causa raíz probable: la escalera de reintentos está ordenada por tipo de fallo
(formato → proveedor), no por costo del reintento.

---

### [BAJO] `isTransientError` tiene un falso positivo real por el offset del `SyntaxError` de JSON (REINCIDENTE, reproducido hoy)

`src/lib/llm/openrouter.ts:73-80` (regex en `:78`) · `:322` · `:369`

`:73-75` concatena el mensaje del error **y el de su `cause`**, y `:322` pone
como `cause` el `SyntaxError` de `JSON.parse`, cuyo mensaje lleva el offset.
Reproducido hoy con la regex literal de `:78`:

```
position 300  → false      position 502  → true
position 408  → true       position 536  → true
position 429  → true       position 599  → true
                           position 600  → false
```

(La ventana 500-599 entra por el `column N+1` del mensaje, además del `position`.)

Escenario: un ticket produce ~500 bytes de JSON; si se rompe en esa ventana,
`:369` clasifica un error de FORMATO como proveedor caído y dispara una tercera
llamada de visión pagada contra `anthropic/claude-haiku-4.5`, que va a fallar por
lo mismo, y escribe `llm.fallback` en el log con el proveedor sano.

Consecuencia: una llamada de visión de más por cada ticket cuyo JSON se rompa
ahí, y una línea de log que manda a diagnosticar al lado equivocado.

Causa raíz probable: clasificar por texto libre sobre un mensaje que puede
contener cualquier número de tres dígitos.

---

### [BAJO] `res.model` con sufijo de proveedor parte la fila de costo en dos (REINCIDENTE)

`src/lib/llm/openrouter.ts:98-101` · `:147` · `:300` · `:537` ·
`src/lib/admin/negocio.ts:96-98` · `:193-194`

`calcCost` documenta que OpenRouter a veces devuelve el slug con sufijo
(`:nitro`, `:floor`) y lo normaliza **para el precio** (`:108`). El slug que se
GUARDA no pasa por ahí. Escenario: dos liquidaciones idénticas, una respondida
como `anthropic/claude-sonnet-5` y otra como `anthropic/claude-sonnet-5:floor`;
`negocio.ts:96-98` llavea por la cadena completa y Model Ops enseña dos renglones
de $0.02 para el mismo modelo. El total no cambia, el desglose sí.

Consecuencia: deuda de reporting sobre la misma superficie del primer hallazgo.
El archivo ya sabe que el sufijo existe y lo maneja para el precio, no para la
identidad.

---

### [BAJO] Tres de los cinco `ModelRole` están muertos, y con ellos dos fases de costo que el tipo permite (REINCIDENTE, ampliado)

`src/lib/llm/models.ts:29,40,42,44,50,64` · `src/lib/agents/registry.ts:7-13` ·
`src/lib/cuadra/costos.ts:41,103` · `src/lib/llm/openrouter.ts:58,88,126`

Verificado hoy: `grep -rn "cuadre_fallback" src` devuelve **sólo** las cuatro
declaraciones de `models.ts`. El agente `orchestrator` (`registry.ts:7-13`,
`role: 'router'`) **nunca se ejecuta**: `grep -rn "runAgent" src` fuera de tests
da una sola llamada, `processor.ts:1153`, con `agent: 'liquidacion'`. Y
`generateResponse` —la única función que usaría `role: 'chat'`— no tiene ningún
llamador en todo `src`. O sea: de los cinco roles, sólo `ocr` y `cuadre` corren.

Consecuencias encadenadas: la fase `'escalacion'` de `costos.ts:103`
(`if (modelo.includes('opus'))`) es inalcanzable, porque
`FALLBACK['anthropic/claude-sonnet-5']` es `'openai/gpt-5.6-terra'`; las fases
`'chat'` y `'router'` de `FaseCosto` (`costos.ts:41`) nunca se escriben; y
`valor-ahorro/page.tsx:12-14` mapea etiquetas («Agente de Escalación», «Agente de
Chat», «Agente Router») para tres agentes que no existen.
`FALLBACK['anthropic/claude-opus-5']` y `PRICES['anthropic/claude-opus-5']` son
entradas muertas.

Consecuencia: quien lea `models.ts` para saber qué corre en producción está
leyendo una promesa. «Fallback Opus por confianza» (`:14`, `:38-40`) describe
algo que el código no hace.

---

### [BAJO] `ToolCallRecord.args` sigue sin describir qué produjo el `result` (REINCIDENTE)

`src/lib/llm/openrouter.ts:582` · `:594`

Cuando la caché acierta, `executed.push` guarda el `args` de ESTE llamador con el
`result` de OTRO (`:582`, caché entre rondas) o del primero de la ronda (`:594`
vía `inRound`). Sigue en BAJO y lo volví a verificar: `grep -rn "\.args\b" src`
fuera de `openrouter.ts` sólo devuelve mocks de supabase en `repo_*.test.ts`.
Nadie persiste ni consulta `.args`. La nota de `tool-executor.ts:98-104` ya avisa
que el día que una tool lleve parámetros hay que revisar esta llave.

---

### [BAJO] `ctx.signal` sigue sin consumirse en ningún handler (REINCIDENTE, mitigado)

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:32-34,45` ·
`src/lib/cuadra/tools.ts` (sin ninguna aparición de `signal`)

`run.ts:32-34` construye `ctx.signal` desde el `AbortController` del turno (40 s,
`processor.ts:1158`) y lo pasa a `makeExecutor`. `grep -n "signal"
src/lib/cuadra/tools.ts` → vacío. Mitigado: todo lo que tocan pasa por
`acotada()` con su `TOPE_CONSULTA_MS`. Peor caso vigente: el turno se agota,
`generateWithTools` aborta, y una consulta de `guardar_liquidacion` sigue
corriendo contra su propio reloj.

---

### [BAJO] El `error.message` crudo de Postgres sigue entrando sin filtro al contexto del modelo (REINCIDENTE)

`src/lib/llm/tool-executor.ts:60` · `src/lib/llm/openrouter.ts:595` ·
`src/lib/cuadra/repo.ts:536` · `src/lib/cuadra/tools.ts:181`

`executeTool` pone `err.message` tal cual en `ToolExecResult.error` y
`openrouter.ts:595` lo serializa en el `content` del mensaje `role:'tool'`.
`tools.ts:181` llama `saveLiquidacion` sin try/catch propio: si el RPC
`guardar_liquidacion_tx` falla, `repo.ts:536` lanza
`` `saveLiquidacion: ${error.message}` `` con nombre de función plpgsql,
constraint y columna, y eso entra al contexto del modelo en la tool que cierra el
dinero. Acotado: con el cierre fallido `guardia.ts:51` calcula `cerro = false`, así
que un mensaje del tipo «se trabó por un problema con `liquidacion_viaje_id_key`»
puede salir tal cual al chofer. Higiene, no dinero.

---

### [BAJO] El loop-guard cuenta bien, pero ejecuta la ronda 6 entera antes de tirar el resultado (REINCIDENTE)

`src/lib/llm/openrouter.ts:528-600`

El conteo es correcto (`round < maxRounds`, 6 iteraciones, `maxRounds = 6` por
default y `run.ts` no lo sobreescribe). Lo que se pierde: las tools de la sexta
ronda se ejecutan, se pagan y se serializan a `convo` (`:598`) y sólo entonces
`:600` lanza `LoopGuardError`, que `:603` envuelve en `PartialExecutionError`. La
última ronda podría usarse para cerrar con lo que ya se tiene en vez de correr a
ciegas hasta el tope.

---

## Lo que revisé y está bien

- **La regla estructural está intacta, releída completa.** Tres `registerTool` en
  producción (`tools.ts:25,81,139`), los tres con `properties: {}`
  (`:31,87,146`), los tres handlers con `_args` sin leer.
  `tenantId`/`viajeId`/`operadorId`/`telefono` salen siempre de `ToolContext`,
  resuelto en `run.ts:34` desde `processor.ts:1156`. **El modelo no puede influir
  en qué fila se escribe**: `saveLiquidacion(ctx.tenantId, liq, …)` y las rutas de
  PDF (`tools.ts:176-177`) se construyen sólo con IDs de servidor. **Ninguna tool
  nueva rompió la regla: no hay tools nuevas.**

- **El consumidor nuevo de `/dashboard` NO cruza la frontera del modelo.**
  `src/app/api/dashboard/asistente/route.ts` (59 líneas, leído entero) llama
  `getKpis`/`getAcreditables`/`detectarAnomalias` y devuelve JSON; no hay
  `generateResponse`/`generateStructured`/`generateWithTools`, ni tools, ni
  prompt. Confirmado por exclusión:
  `grep -rn "generateWithTools|generateStructured|generateResponse|toolSchemas|executeTool|makeExecutor|modelFor("`
  sobre todo `src` **no toca ni un archivo bajo `src/app/`**. `/admin/chat.tsx`
  sigue siendo coincidencia de palabras clave sobre un `ResumenNegocio` ya
  calculado en servidor. La frontera hoy es: **`/admin` y `/dashboard` leen
  `llm_costo`, no lo producen.**

- **La dedup de mutaciones mira el EFECTO, no la llamada, y aguanta
  concurrencia.** `makeExecutor` (`tool-executor.ts:94-120`) cachea la **promesa**
  antes del `await` (`:110-111`), llavea por nombre y no por args (`:105`), y
  borra el fallo comparando la promesa (`:116`).
  `tool_executor_concurrente.test.ts` y `tool-executor.test.ts` lo ejercitan de
  verdad, incluyendo `null` como args y las claves en otro orden.

- **La caché de lectura acierta y no fosiliza fallos.** `llaveDeCache`
  (`:446-458`) colapsa por nombre sólo las tools sin `properties`, y `:593` sólo
  cachea el éxito. `openrouter_cache_llave.test.ts` y
  `openrouter_cache_fallo.test.ts` ejecutan el ciclo real con el SDK mockeado.

- **La caché de `cuadrar_viaje` entre rondas NO puede hacer divergir el WhatsApp
  del PDF.** Lo perseguí a propósito: si el modelo llama `cuadrar_viaje` en la
  ronda 1, entra una foto (sin mutex), y vuelve a llamarla en la ronda 4, se le
  sirve el resultado viejo. Pero `guardiaCifras` sustituye SIEMPRE el texto
  cuando `cuadro` es true (`guardia.ts:83,114`) y, si cerró, usa el snapshot de
  `guardar_liquidacion` (`:69-72`), que **se recalcula fresco** en
  `tools.ts:152`. El número que ve el chofer y el que se imprime son el mismo.

- **La respuesta truncada NO se trata como completa** en el ciclo de tools:
  `openrouter.ts:548-556` lanza `TruncatedError` antes de devolver, con prueba
  (`openrouter_truncado_tools.test.ts`). Y con truncamiento CON `tool_calls`, la
  regla `properties: {}` hace que los `arguments` sean `{}`: un corte deja o un
  JSON inválido → `:575-578` empuja `args_parse` y **no ejecuta el handler**, o un
  `function.name` truncado → `tool-executor.ts:49-51` responde «tool desconocida».
  Ninguna rama escribe nada.

- **El importe por ronda es correcto tras el fallback** (`:536`, con `activeModel`
  movido por `complete` antes de devolver) y tiene prueba
  (`openrouter_fallback_costo.test.ts`). Sólo la etiqueta del modelo está mal.

- **El costo del cierre parcial sí se registra**, y antes de vincular
  (`processor.ts:1196-1201` corre antes de `:1220`): lo que se gastó antes de
  caerse no desaparece. Lo único mal ahí es la etiqueta `'parcial'`.

- **La inyección por el texto impreso está cerrada en el resto de los campos.**
  `etiquetaConcepto` (`engine.ts`) sólo lee `ocrExtra.producto`, que pasa por
  `sanitizarProducto`; los folios interpolados en las notas pasan por
  `sanitizarFolio`. Lo abierto son `fechaRaw` y `codigoBarras`, y sólo por el
  resultado de `guardar_liquidacion` (hallazgo aparte).

- **Aislamiento por tenant** en las cuatro funciones de `repo.ts` que tocan las
  tools (`getViaje`, `getOperador`, `saveLiquidacion` vía `p_tenant`,
  `getAcumuladoCombustible`).

- **Compuerta corrida hoy sobre este árbol:** `npx vitest run src/lib/llm
  src/lib/cuadra/tools_cableado.test.ts src/lib/admin` → 11 archivos, **64
  pruebas, 0 fallos**. `npx tsc --noEmit -p .` → exit 0. `npm run lint` → 0
  errores, 6 warnings (los mismos que declara el MAPA). No edité ningún archivo
  del repo salvo este entregable; las mediciones se hicieron en el scratchpad.
  (Nota: `git status` reporta `src/lib/auth/tenant-efectivo.ts` modificado —
  **no fui yo**, es de otro agente de esta ronda.)

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter.** Todo el gateway está probado con el
  SDK mockeado. En particular sigo sin verificar que un `assistant` con
  `tool_calls` emitido por Anthropic se acepte tal cual cuando la ronda siguiente
  la responde OpenAI (`openrouter.ts:564` + `:521`) — es exactamente el camino
  que el fallback recorre a mitad de ciclo, y sigo confiando en que OpenRouter
  normaliza los `tool_call.id`. Es una suposición.
- **Si OpenRouter reporta un importe propio por llamada** y por tanto si la
  reconciliación contra el recibo real es posible hoy. Verifiqué que el código
  **no** lee ningún campo de costo de la respuesta (sólo `usage.prompt_tokens` /
  `completion_tokens`) y que `PRICES` es la única fuente; no verifiqué contra el
  proveedor si había algo que leer.
- **Cuántas filas tiene `llm_costo` de verdad hoy.** El único dato es el
  comentario de `negocio.ts:12` («131 filas»), de fecha desconocida; aquí no hay
  Supabase. El umbral de 1,000 lo derivé de conteos de código
  (`processor.ts:315,508,1171,1199` y `say()` en `:364`), no de la base.
- **Cómo reacciona un modelo real al texto inyectado por el código de barras.**
  Verifiqué el canal y su tamaño; las tres rejillas que lo acotan las verifiqué
  por código, no por ensayo.
- **Si el modelo llama `guardar_liquidacion` antes de tiempo.** El diseño le da
  al modelo la decisión de CUÁNDO (deliberado) pero la única precondición del
  handler es `if (!ctx.viajeId)` (`tools.ts:150`), el cierre es irreversible de
  cara al chofer, y `prompts.ts` le ordena cerrar ante un «ya» o un «es todo». No
  puedo escribir el escenario con valores sin correr el modelo real, así que **no
  lo reporto** — pero es donde pondría el siguiente ensayo del guion del demo.
- **`tool_calls` en streaming** y **prompt caching** (`cache_control`): siguen sin
  usarse; no los evalué. Con 12.5 KB de resultado de tool volviendo al contexto,
  el segundo sería la palanca más barata.
- **El resto de `processor.ts`** más allá de donde cruza mi frontera (`:9`,
  `:1153-1177`, `:1196-1221`), y la autorización de `/admin` y `/dashboard`, que
  sólo miré para poder afirmar dónde está la frontera del modelo.
