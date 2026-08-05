# Rendimiento y costo — auditoría 11 (pase 2)

Anclado al HEAD de `claude/auditoria-11` (`707c749`).

Compuerta medida hoy, dos corridas completas:

```
$ npx tsc --noEmit -p .   → exit 0
$ npx vitest run          → corrida 1: 3 archivos / 4 pruebas EN ROJO
                          → corrida 2: 1 archivo  / 1 prueba  EN ROJO
```

El MAPA dice `npx vitest run → exit 0 · 269 archivos · 2530 pruebas`. **No es
reproducible.** La única prueba que falló en las DOS corridas es
`src/lib/cuadra/normas/fundamento.test.ts:144`, y es una aserción de tiempo — o
sea, de mi rubro. Va como hallazgo abajo.

**Nota: 5/10** (antes 3). Razón del movimiento: **se atacó y subió**. Los dos
agujeros de 300,000 ms que sostenían el 3 están cerrados con código en el camino
que corre, verificado línea por línea y no por prosa: `tools.ts:261` envuelve las
dos subidas en `acotada`, `conv.ts:304` mete el RPC del mutex dentro del bucle,
`pg.ts:60` le pone techo a cada página de `traerTodo`. El techo del peor caso
baja de **233,000 ms a 140,900–194,500 ms**. Pero **sigue sin caber en 120,000**,
y sigue muriendo callado en los cinco pasos del cierre que nunca miran el reloj.
Por eso no llega a 6: la nota de 6 pide que el peor caso quede *apenas dentro*, y
este queda 20,900 ms fuera en su versión más benigna. Y no baja a 4 porque el
modo de falla dejó de ser el mismo: antes bastaba **una** consulta colgada para
irse 5× por encima; hoy hacen falta **cuatro de cinco** eslabones en su techo, y
los pasos que se pueden sacrificar ya dejan `cierre.paso_omitido` escrito antes
de morir.

Riesgo mayor hoy: `presupuesto.ts:224-229` declara por escrito que el peor caso
del camino del "listo" son **82,000 ms con 26,000 de holgura**, y setenta líneas
más arriba el mismo archivo declara que el cierre obligatorio son **48,500 ms**.
Los dos números viven en el mismo archivo, nadie los suma, y **82,900 + 58,000 =
140,900 contra 120,000**.

---

## La suma del peor caso, con las líneas de hoy

### Los techos, con su fuente

No hay un número estimado en esta tabla: todos salen de una constante escrita en
el repo.

| Cosa | Valor | `archivo:línea` |
|---|---:|---|
| Presupuesto de la invocación | 120,000 ms | `presupuesto.ts:316` ≡ `api/webhook/whatsapp/route.ts:28` |
| Reserva para cerrar | 12,000 ms | `presupuesto.ts:181` |
| Techo de un paso a Supabase | 8,000 + 1,500 = **9,500 ms** | `presupuesto.ts:50`, `:53`, `:66` |
| Techo de un envío a Meta | 10,000 ms | `presupuesto.ts:78` ≡ `meta/client.ts:17` |
| Techo del OCR | 25,000 ms | `presupuesto.ts:192` |
| Tope de la barrera de intake | 25,000 + 5,000 = **30,000 ms** | `presupuesto.ts:231` |
| Techo del cierre COMPLETO | 125,000 ms | `presupuesto.ts:141` |
| Techo del cierre OBLIGATORIO, declarado | 48,500 ms | `presupuesto.ts:153` |
| Techo del cierre OBLIGATORIO, **contado en el código** | **58,000 ms** | ver abajo |

### Camino del "listo", eslabón por eslabón

| # | Eslabón | `archivo:línea` de HOY | Tope pedido | Techo REAL | ¿lo ve el reloj? |
|---|---|---|---:|---:|---|
| 1 | `claimMessage` | `processor.ts:244` | — | 9,500 | **no** — corre ANTES de `crearPresupuesto` (`:268`) |
| 2 | `resolveOperador` | `processor.ts:280` | — | 9,500 | lo mide, no lo acota |
| 3 | `getOpenViaje` | `processor.ts:299` | — | 9,500 | ídem |
| 4 | `getHuerfanos` | `processor.ts:1071` | — | 9,500 | ídem |
| 5 | barrera de intake | `processor.ts:1282` → `conv.ts:426-433` | `acotar(30,000)` | 30,000 + 9,500 = **39,500** | sí, pero el vencimiento se comprueba DESPUÉS del sondeo (`conv.ts:430-431`) |
| 6 | mutex del viaje | `processor.ts:1315` → `conv.ts:304, :328` | `acotar(12,000)` | 12,000 + 9,500 = **21,500** | ídem — el propio `conv.ts:300` lo escribe |
| 7 | re-chequeo `getOpenViaje` | `processor.ts:1328` | — | 9,500 | lo mide |
| 8 | `getTenantContext` + `loadConversation` | `processor.ts:1333-1334` | — | 19,000 | lo mide |
| 9 | agente | `processor.ts:1369` → `run.ts:37-38` | `acotar(40,000)` | 40,000 | **sí**, `AbortSignal` real |
| 10 | tool en vuelo cuando el agente aborta | `tools.ts:260-273` | — | **28,500** | **no** |
| 11 | cierre obligatorio | `processor.ts:1493 … :1696` | — | **58,000** | **no, nunca** |

### El cierre obligatorio son 58,000 ms, no los 48,500 que dice la constante

`PASOS_CIERRE` (`presupuesto.ts:117-129`) marca cinco pasos como no opcionales y
`TECHO_CIERRE_OBLIGATORIO_MS` (`:153`) suma **48,500**. Contados sobre
`processor.ts`, los pasos que corren SIN puerta son **seis**:

| Paso | Línea de HOY | Techo | ¿puerta `hayPresupuestoPara`? |
|---|---|---:|---|
| `guardiaCifras` → `cuadrarDesdeDB` | `processor.ts:1493` | 9,500 | no |
| `say(reply)` | `processor.ts:1577` | 10,000 | no |
| `createSignedUrl` | `processor.ts:1663` | 9,500 | no |
| `sendDocument` del PDF | `processor.ts:1671` | 10,000 | no |
| **`registrarCostoWhatsApp` del PDF** | **`processor.ts:1673`** | **9,500** | **no — y la tabla lo marca `opcional: true`** |
| `saveConversation` | `processor.ts:1696` | 9,500 | no |

**Σ = 58,000 ms.** (Y no cuenta el `say(...)` del `catch` en `:1684`, otros
10,000 si el PDF falla.)

### Los tres totales

**(A) La cota que el reloj sí garantiza.** `crearPresupuesto`
(`presupuesto.ts:382, :387`) garantiza que el `setTimeout` del agente dispare a
más tardar en `120,000 − 12,000 = 108,000 ms`. Encima corre el cierre, sin
consultar el reloj ni una vez:

> **108,000 + 58,000 = 166,000 ms contra 120,000 → 1.38×**

**(B) Con la tool en vuelo cuando el agente aborta.** `run.ts:38` aborta el
`AbortController`, pero el `Promise.all` de las tools (`openrouter.ts:811`) no
cuelga de esa señal, y `tools.ts` solo mira `ctx.signal` en `:224` y `:237`. Si
el aborto cae después de `:237`, la tool termina entera: subida #1 (9,500) +
subida #2 (9,500) + `saveLiquidacion` (9,500) = **28,500 ms fuera de todo tope**.

> **108,000 + 28,500 + 58,000 = 194,500 ms contra 120,000 → 1.62×**

**(C) El peor caso que el propio repo declara soportado.**
`presupuesto.ts:224-229`: *"El peor caso del camino del 'listo' con topes pedidos
es 30 000 (barrera) + 12 000 (mutex) + 40 000 (agente) = 82 000 ms contra los
108 000 utilizables: 26 000 ms de holgura."* Con el previo nominal de 900 ms que
`presupuesto_camino.test.ts:87` llama medido:

> **82,900 + 58,000 = 140,900 ms contra 120,000 → se pasa por 20,900 ms**

Y para reventarlo desde ahí basta con que **cuatro de los cinco** pasos
obligatorios lleguen a su techo: quedan `120,000 − 82,900 = 37,100 ms`, y
`9,500 + 10,000 + 9,500 + 10,000 = 39,000 > 37,100` — con `saveConversation`
todavía sin correr.

**Contra el pase 1:** 233,000 → 140,900–194,500. Bajó **38–40%**. Sigue sin
caber.

**El promedio, para ser justo.** Camino nominal con los números que el repo llama
medidos: claim 0.3 + previo 0.9 + barrera 3.5 + mutex 0.1 + agente 20 + cierre
nominal 8.9 (`COSTO_CIERRE_MS`, `presupuesto.ts:133`) = **33.7 s contra 120,000**
— cabe con 3.6× de holgura. El demo de mañana no toca esto. El problema sigue
siendo que **lo único que se simula es el promedio**:
`presupuesto_camino.test.ts:33` gasta con `Math.min(real, p.acotar(pedido))`, o
sea asume que ninguna etapa se pasa de lo que se le concedió — que es
exactamente lo que la barrera (`conv.ts:430-431`) y el mutex (`conv.ts:328`) sí
hacen; y la simulación **termina en el agente**: el cierre no aparece en ninguna.

### El costo, contra el presupuesto escrito

| Concepto | Aritmética | Fuente |
|---|---|---|
| Visiones por liquidación | cada foto paga la suya | `processor.ts:575`; el comentario `:569` lo dice literal |
| Precio de una visión | $0.015 | `processor.ts:863` |
| Lote típico | 8 fotos | `api/webhook/whatsapp/route.ts:68` |
| Ráfaga | 12 fotos | `route.ts:10` |
| OCR de un lote típico | 8 × $0.015 = **$0.12** | → **2.4× el objetivo, solo el OCR** |
| OCR de una ráfaga | 12 × $0.015 = **$0.18** | → 3.6× |
| Agente de cuadre, peor caso | 6 × 4,000 tok × $10/1M = **$0.24** | `openrouter.ts:695`, `:50`, `:105` (Sonnet 5 `[2,10]`) |
| Prefijo re-facturado sin caché | ~1,300 tok × 4 × $2/1M = **$0.0104** | `prompts.ts` (4,152 bytes) + `registry.ts:21`; `openrouter.ts:766` |

Objetivo declarado: **$0.03–0.05 / liquidación** (`models.ts:38`, ahora rotulado
como *aspiración, no medición* — eso es nuevo y es correcto).
**Peor caso sumado ≈ $0.38. Caso corriente ≈ $0.17 → 3.4×.**

---

## Hallazgos

### [CRÍTICO] El cierre sigue corriendo sin reloj en sus cinco pasos obligatorios: 58,000 ms de techo sobre un transcurrido que el propio presupuesto acepta en 82,900 · REINCIDENTE
`src/lib/cuadra/processor.ts:1493`, `:1577`, `:1663`, `:1671`, `:1673`, `:1696`
— ninguno pasa por `hayPresupuestoPara`, verificado leyendo las seis.
`src/lib/cuadra/presupuesto.ts:224-229` (los 82,000 "con 26,000 de holgura"),
`:153` (`TECHO_CIERRE_OBLIGATORIO_MS`).

Escenario, con valores: el operador manda su última foto y escribe "listo" un
segundo después. La barrera espera al OCR en vuelo y agota su tope legítimo de
**30,000 ms** (`processor.ts:1282`; el OCR tiene 25,000 de techo, `:192`). Otro
turno tiene el lease, el mutex espera sus **12,000** (`processor.ts:1315`). El
agente usa su tope completo, **40,000** (`processor.ts:1369`) — caso que
`presupuesto_camino.test.ts:93-99` declara explícitamente soportado. Transcurrido
= 900 + 30,000 + 12,000 + 40,000 = **82,900 ms**. Quedan 37,100. El cierre
arranca y no consulta el reloj ni una vez en sus seis pasos sin puerta:
`guardiaCifras` 9,500 → `say(reply)` 10,000 → `createSignedUrl` 9,500 →
`sendDocument` 10,000 ya son **39,000 > 37,100**. Vercel corta **durante
`sendDocument`**, que es el paso que entrega el PDF.

Nada de esto es degradación: los tres topes de arriba son los que el archivo
llama "el peor caso soportado", y el techo de cada paso es el que ese mismo
archivo impone.

Consecuencia: `guardar_liquidacion` ya corrió DENTRO del agente, así que el viaje
está `liquidado`, el `llm_costo` está cobrado y el trigger de la 0037 impide
corregirlo. El operador no recibe PDF ni resumen. **No queda ni una línea de log**
—el proceso muere antes de cualquier `catch`— y Meta, que recibió su 200 en
`route.ts:122`, no reintenta. Para el contralor es una liquidación que existe en
su panel y que su chofer jura no haber recibido nunca.

Causa raíz: `hayPresupuestoPara` se aplicó a los pasos accesorios y **el
entregable se dejó a propósito sin puerta** (`cierre_reloj.test.ts:103` lo fija:
*"Y NUNCA el entregable"*). La decisión es defendible; lo que falta es que alguien
compare `TECHO_CIERRE_OBLIGATORIO_MS` contra lo que queda del presupuesto en el
peor caso que el mismo archivo declara — `grep -rn "TECHO_CIERRE_OBLIGATORIO_MS"
src/` da tres usos y ninguno es esa comparación.

**REINCIDENTE** (pase 1 CRÍTICO; auditoría 10, ALTO-3). Mismo modo de falla,
techo bajado de 125,000 a 58,000 y ventana de 233,000 a 140,900.

---

### [ALTO] `guardar_liquidacion` corre entera después de que el agente abortó: 28,500 ms fuera de cualquier presupuesto, y `saveLiquidacion` sigue siendo el último paso
`src/lib/agents/run.ts:37-38` (el `AbortController` del turno),
`src/lib/llm/openrouter.ts:811` (`await Promise.all(calls.map(...))`, que **no**
cuelga de `opts.signal` — la señal solo va a `client.chat.completions.create` en
`:745`), `src/lib/cuadra/tools.ts:224` y `:237` (los dos únicos
`ctx.signal?.throwIfAborted()`), `:268`, `:269` (las subidas), `:273`
(`saveLiquidacion`, **después**).

Escenario, con valores: el agente arranca con su tope de 40,000 ms. A los 25,000
llama `guardar_liquidacion`; pasa `throwIfAborted` en `:224` y en `:237`. Storage
degradado: cada `subir()` agota `acotada` en **9,500 ms** (`presupuesto.ts:291`,
`TOPE + GRACIA`). El `setTimeout(() => controller.abort(), 40_000)` de `run.ts:38`
dispara a los 40,000 y **no toca nada de esto**: no hay más
`throwIfAborted` después de `:237`, y `Promise.all` no lee la señal. La tool
sigue: subida #1 hasta 9,500 + subida #2 hasta 9,500 + `saveLiquidacion` 9,500 =
**28,500 ms después del aborto**. Recién entonces la siguiente vuelta del `for` de
`openrouter.ts:757` llama a `complete()` y lanza.

Aritmética completa: 108,000 (cota del reloj al abortar) + 28,500 + 58,000 (el
cierre) = **194,500 contra 120,000 → 1.62×**.

Consecuencia: es el único tramo del camino del dinero cuyo reloj se puede
desbordar sin que ninguna cota lo note, y el orden lo empeora —
`saveLiquidacion` está en `:273`, después de las dos subidas. Si Vercel corta ahí,
hay dos PDF en el bucket y **ninguna liquidación en la base**: el estado más caro
de reconstruir a mano.

Causa raíz: el arreglo de la ronda 11 puso `acotada` en las subidas (correcto, y
cierra el CRÍTICO del pase 1) y `throwIfAborted` en la entrada, pero el ciclo de
tools de `openrouter.ts` nunca propagó la señal al `Promise.all` que las ejecuta,
así que el tope del turno solo acota la parte del turno que habla con el modelo.

---

### [ALTO] `registrarCostoWhatsApp` del PDF está marcado `opcional` en la tabla y no lleva puerta — y la prueba que lo verifica hace `grep` sobre el archivo entero
`src/lib/cuadra/presupuesto.ts:127` (`{ paso: 'registrarCostoWhatsApp del PDF',
donde: 'processor.ts:1673', … opcional: true }`) contra
`src/lib/cuadra/processor.ts:1673` (`await registrarCostoWhatsApp(op.tenantId,
viajeId);`, sin `hayPresupuestoPara`, dentro del `try` del PDF).
La prueba: `src/lib/cuadra/cierre_reloj.test.ts:96-99`.

Escenario, con valores: `TECHO_CIERRE_OBLIGATORIO_MS` (`:153`) se calcula
filtrando `!p.opcional` y da **48,500**. El código obligatorio real son
**58,000** — 9,500 ms más, o sea **el 19.6%** de la única cifra con la que se puede
decidir si el cierre cabe. Con el transcurrido de 82,900 del CRÍTICO de arriba, la
diferencia entre 48,500 y 58,000 es la diferencia entre pasarse por 11,400 ms y
pasarse por 20,900.

Por qué la prueba no lo caza: `cierre_reloj.test.ts:99` comprueba
`processorSrc.match(/hayPresupuestoPara\([^;]*'registrarCostoWhatsApp'\)/)` sobre
**el archivo completo**, y eso hace match con la puerta que sí existe dentro del
helper `say` (`processor.ts:413`) — otro sitio de llamada. Los dos `await
registrarCostoWhatsApp(` del archivo están en `:414` (dentro de `say`, con puerta)
y `:1673` (suelto, sin puerta); la prueba solo puede ver el primero. El comentario
del bloque dice *"y salta exactamente los pasos que la tabla marca como
opcionales"*, y no es cierto para uno de los cinco.

Consecuencia: el único artefacto que existe para hacer auditable el costo del
cierre —el que el comentario de `presupuesto.ts:103-113` dice haber reparado esta
misma ronda porque *"una tabla de presupuesto que apunta a otro lado no se puede
auditar"*— vuelve a mentir, ahora en la columna `opcional` en vez de en `donde`.
Es el guardarraíl del CRÍTICO de arriba.

Causa raíz: la prueba verifica que la MARCA exista en algún sitio del archivo, no
que exista en la línea que `donde` señala.

---

### [ALTO] Las ~30 páginas de `/admin` no declaran `maxDuration`, y su layout monta cinco escaneos paginados que cruzan todos los tenants
`src/app/admin/layout.tsx:42` (`await Promise.all([getResumenNegocio(),
getConversacionesActivas()])` — en el **layout**, o sea en cada página),
`src/lib/admin/negocio.ts:96-108` (cuatro `traerTodo` sobre `tenant`, `viaje`,
`llm_costo` y `gasto`, **sin `.eq('tenant_id')`**), `:217` (un quinto sobre
`llm_costo`). `grep -rn maxDuration src/app/admin/` → **cero resultados**, y las
~30 páginas son `force-dynamic` (`layout.tsx:19` y una por página).

Y el guardarraíl que se puso esta ronda se detuvo un directorio antes:
`src/app/dashboard/max_duration.test.ts:23` fija `RAIZ = join(process.cwd(),
'src/app/dashboard')`. Las 24 páginas de `/dashboard` declaran `maxDuration = 60`;
las de `/admin` —que hacen **más** trabajo, y cruzando tenants— no las mira nadie.
`/mis-viajes/page.tsx:8` es `force-dynamic` y tampoco lo declara.

Escenario, con valores: `traerTodo` (`pg.ts:46-67`) pide páginas de 1,000 filas
hasta `MAX_PAGINAS = 100` (`:44`), cada una con techo de 9,500 ms (`:60`). Sobre
`llm_costo`, que es la tabla que más crece: una liquidación con el lote típico de
8 fotos escribe 8 filas de `fase: 'ocr'` (`processor.ts:577`) + 1 de `'cuadre'`
(`:1393`) + hasta 3 de WhatsApp (`:414`, `:1673`) ≈ **12 filas**. A 500
liquidaciones/mes son **6,000 filas/mes**. Al sexto mes son 36,000 filas = **36
páginas secuenciales**, y `getCostoPorFaseModelo` (`:217`) las relee: **72 viajes
de red en serie por carga de CUALQUIERA de las 30 páginas**. Al costo unitario
que el propio repo asume (0.3 s, `presupuesto.ts:39`): **21.6 s de espera por
clic**. Con Supabase degradado, 36 × 9,500 = **342,000 ms** contra un techo que la
página no declara — el máximo del plan pro que el propio repo cita es 300,000
(`api/webhook/whatsapp/route.ts:21-22`), o sea **1.14×**.

Consecuencia: la consola desde la que Javier fija el precio del producto se pone
lenta linealmente con el uso, y ninguna de sus 30 páginas tiene forma de
degradarse: `layout.tsx:42` no está envuelto en `safeLog`, así que cuando
`traerTodo` lanza cae la página entera, no una tarjeta.

Causa raíz: el arreglo de `maxDuration` de esta ronda se ejecutó por dominio de
archivo (`/dashboard`) y el test se acotó a ese dominio en vez de a "toda página
`force-dynamic` del repo", que es el mecanismo que su propio comentario describe
(`max_duration.test.ts:25-27`: *"Se deja el mecanismo —no la lista— porque una
página nueva sin `maxDuration` tiene que seguir poniendo esto en rojo"*).

**REINCIDENTE parcial** (pase 1, ALTO ×2). `/dashboard` cerrado y verificado;
`/admin` y `/mis-viajes` abiertos.

---

### [ALTO] El costo por liquidación sale 2.4×–3.4× de su objetivo, y la única función que hace la división tiene CERO consumidores y lee 1,000 filas sin paginar
`src/lib/cuadra/costos.ts:305-341` (`getResumenCosto`), `:335`
(`costoPromedioPorLiquidacion: viajes.size ? redondearUsd(totalUsd / viajes.size)
: null`), `:308-311` (la consulta). `grep -rln "getResumenCosto" src/` devuelve
**dos archivos: `costos.ts` y `costos.test.ts`**. Ninguna página, ninguna ruta.

Escenario, con valores. Primero el número:

- Lote típico del propio repo, 8 fotos: 8 × $0.015 (`processor.ts:863`) =
  **$0.12** → **2.4× el techo de $0.05**, antes de que el agente gaste un token.
- Ráfaga de 12 (`route.ts:10`): **$0.18** → 3.6×.
- Agente de cuadre, peor caso: `maxRounds = 6` (`openrouter.ts:695`) ×
  `DEFAULT_MAX_TOKENS = 4000` (`:50`) × $10/1M de salida (`:105`) = **$0.24**.
- **Peor caso ≈ $0.38; corriente ≈ $0.17 → 3.4× el objetivo.**

Y ahora por qué nadie lo ha desmentido con datos reales, teniéndolos: la división
**está escrita** (`costos.ts:335`), **está probada** (`costos.test.ts`) y **no la
pinta ninguna pantalla**. Es la misma forma exacta que `RESULTADO.md:62-63`
describe para `puedeExportar` ("seis pruebas y cero consumidores"), repetida en el
rubro del dinero.

Peor: aunque se conectara, daría mal. `costos.ts:308-311` hace
`.select('viaje_id, fase, tokens_in, tokens_out, costo_usd').eq('tenant_id', …)`
**sin `.limit()`, sin `.range()`, sin `.order()` y sin `traerTodo`**. PostgREST
recorta a `max_rows` (1,000) en silencio — el borde que `pg.ts:34-40` documenta y
que `traerTodo` existe para tapar, importado en el archivo de al lado. A 12 filas
de `llm_costo` por liquidación, el corte cae en la **liquidación número 84**: a
partir de ahí `totalUsd` y `registros` se congelan, y sin `.order()` las 1,000
filas que vuelven son las que Postgres decida.

Consecuencia: el precio del producto se va a fijar contra un objetivo que la
aritmética del propio repo desmiente por 3.4×, y el instrumento para cerrarlo
existe, está probado, y no está enchufado. A 500 liquidaciones/mes la diferencia
entre $0.05 y $0.17 son **$60/mes** de margen que no existe — pequeño en absoluto,
decisivo cuando es el denominador del "por cada $1 que pagas ahorras $X" que la
pantalla de Valor & Ahorro se niega a inventar precisamente por no tenerlo.

Lo que SÍ mejoró y hay que decirlo: `models.ts:18-40` dejó de afirmar
"$0.03–0.05" a secas y ahora lo rotula como **objetivo declarado, no medido**, con
la cota inferior calculada al lado y la línea *"Medición real: PENDIENTE"*. Eso
cierra la mitad del hallazgo del pase 1 —la cifra dejó de mentir— y deja abierta
la otra: sigue sin medirse.

**REINCIDENTE** (pase 1, ALTO). Aritmética idéntica; la prosa cambió, el número no.

---

### [ALTO] La barrera y el mutex se pasan de su tope por un sondeo cada uno, y `presupuesto.ts` suma los topes PEDIDOS: 82,000 declarados contra 101,000 reales
`src/lib/cuadra/conv.ts:429-431` (`for(;;) { if (await vacio()) return true; if
(Date.now() - start >= tope) return false; … }` — el vencimiento se evalúa
**después** del sondeo) y `:422-425` (`vacio()` → `probe` → `intakeDelta`, que es
`acotada` en `:367`, techo 9,500). Lo mismo en el mutex: `conv.ts:304` (el RPC
`acotada`) y `:328` (la comprobación, después del `await`).
`src/lib/cuadra/presupuesto.ts:224-229` (la suma de 82,000).
`src/lib/cuadra/presupuesto_camino.test.ts:33`
(`gastar = (pedido, real) => { ahora += Math.min(real, p.acotar(pedido)); }`).

Escenario, con valores: la barrera recibe `acotar(30,000)`. Un sondeo que arranca
en t = 29,999 ms y agota su techo termina en **39,499**: la barrera devuelve a los
39,500, no a los 30,000. El mutex recibe `acotar(12,000)` y termina a los
**21,500** — número que `conv.ts:300` ya escribe correctamente, así que el código
lo sabe y el presupuesto no. Suma real de las tres etapas: **39,500 + 21,500 +
40,000 = 101,000 ms** contra los 108,000 utilizables → **7,000 ms de holgura**,
no los 26,000 que `presupuesto.ts:228` declara. Y eso es antes de los cuatro
eslabones previos (`claimMessage`, `resolveOperador`, `getOpenViaje`,
`getHuerfanos`), cuyo techo sumado es **38,000 ms** más.

Por qué ninguna prueba lo dice: `presupuesto_camino.test.ts:33` modela cada etapa
como `Math.min(real, acotar(pedido))` — o sea **asume que ninguna etapa se pasa de
lo que se le concedió**, que es exactamente el supuesto que `conv.ts:429-431` y
`:328` rompen. La simulación no puede encontrar un desbordamiento que su propio
modelo declara imposible.

Consecuencia: los 26,000 ms de holgura son el argumento con el que
`presupuesto.ts:224-229` justifica haber subido la barrera de 20,000 a 30,000 esta
ronda (decisión correcta — cerró liquidaciones cortas). Con 7,000 reales, esa
decisión se tomó contra un margen 3.7× más grande del que hay.

**REINCIDENTE** (pase 1, ALTO del mutex — la parte de los 300,000 ms está cerrada
con `conv.ts:304`; lo que queda es el desbordamiento de un sondeo).

---

### [MEDIO] `traerTodo` no tiene presupuesto de tiempo por llamada, y a las 100,000 filas se corta EN SILENCIO — el comentario promete lo contrario
`src/lib/cuadra/pg.ts:41` (`PAGINA = 1_000`), `:44` (`MAX_PAGINAS = 100`, con el
comentario *"se corta y se dice, en vez de colgar el turno"*), `:51-65` (el bucle:
al agotar las 100 páginas simplemente **sale**; `logger` está importado en `:1` y
en este archivo solo lo usa `safeLog`). `grep -n logger src/lib/cuadra/pg.ts` →
`:1` y `:104`, ninguna dentro de `traerTodo`.

Escenario, con valores: `traerTodo` acota cada PÁGINA a 9,500 ms (`:60`) y no
acota el NÚMERO de páginas. Techo por llamada = 100 × 9,500 = **950,000 ms**, o
sea **15.8× el `maxDuration = 60` que las páginas de `/dashboard` acaban de
declarar** y 3.2× el máximo del plan pro. Al costo unitario del repo (0.3 s), 100
páginas son **30 s** de espera con la base sana. Y al llegar a la fila 100,001
devuelve 100,000 filas sin lanzar, sin loguear y sin marca: el consumidor no puede
distinguir "eso es todo" de "hay más" — que es literalmente el modo de fallo de
PostgREST que `pg.ts:34-40` cita para justificar la existencia de esta función.

Consecuencia: se cambió una lectura acotada-pero-incorrecta (`.limit(1000)`) por
una correcta-pero-sin-techo, y el umbral del mismo error pasó de 1,000 a 100,000
filas. Con `getDocumentos` (`analytics.ts:432`, sobre `gasto`) y
`api/export/liquidaciones/route.ts:49` —que además no declara `maxDuration`—, el
cruce llega antes por tiempo que por filas.

---

### [MEDIO] El rail repite las tres lecturas más caras del panel y su propia sesión en las 24 páginas, incluidas las que no pintan un peso · REINCIDENTE
`src/app/dashboard/chrome.tsx:113` (`{puedeVerArea(rol, 'dinero') &&
<RailAsistente />}` — con puerta de ROL, sin puerta de PÁGINA),
`src/app/dashboard/rail.tsx:71` (el `fetch`),
`src/app/api/dashboard/asistente/route.ts:33` (`getSessionTenant`, 2 viajes de red
en serie) y `:78-82` (`getKpis` + `getAcreditables` + `detectarAnomalias`).

Escenario, con valores: en `/dashboard`, `page.tsx:91-93` ya corrió esas mismas
tres funciones del lado del servidor. El rail es cliente y su petición es otra
petición HTTP — no hay memoización que la colapse. Por vista de Inicio:
`liquidacion` escaneada **5 veces** (`getKpis` ×2, `getAcreditables` ×2,
`getLiquidacionesPorDia` ×1) y `gasto` **2 veces**.

El multiplicador está en `detectarAnomalias` (`analytics.ts:137-145`): un
`traerTodo` sobre `gasto` **sin filtro de fecha**, o sea la tabla completa del
tenant. Con el lote típico de 8 comprobantes × 4 viajes/mes × 30 unidades =
**960 filas/mes**, al año son 11,520 filas = **12 páginas secuenciales**. Al costo
unitario del repo eso es **3.6 s** por cada carga del rail — y el rail se monta en
`/dashboard/despacho`, `/pod`, `/unidades`, `/incidencias`, `/viajes` y
`/operadores`, donde no se pinta un solo peso, para un recuadro de una frase.
Techo: 12 × 9,500 = **114,000 ms contra el `maxDuration = 30`** de esa ruta
(`route.ts:28`) → **3.8×**.

Consecuencia: cada clic del contralor cuesta el doble de lo que la pantalla
necesita, y el multiplicador crece con la antigüedad de la flota. Lo que sí se
cerró esta ronda: el encargado y el chofer ya no lo pagan (`chrome.tsx:113`).

**REINCIDENTE** (pase 1, MEDIO). Mitigado por rol, no por página.

---

### [MEDIO] `proxy.ts` + `session.ts` + `tenant-efectivo.ts`: el único tramo por el que pasa TODA petición del producto, y no tiene un solo `acotada` · REINCIDENTE
`src/proxy.ts:60` (`await supabase.auth.getUser()`), `:108` (el matcher: todo
salvo `/api` y estáticos); `src/lib/auth/session.ts:31` y `:33` (getUser +
`app_user`, **en serie**), `:53` (el reintento con 250 ms);
`src/lib/auth/tenant-efectivo.ts:68`. Conteo verificado hoy: `session.ts` y
`proxy.ts` tienen **0 `supabaseAdmin()` y 0 `acotada`**; `tenant-efectivo.ts`,
**1 y 0**.

Escenario, con valores: `getUser()` siempre es un viaje de red al servidor de
Auth (a diferencia de `getSession()` no decodifica el JWT en local). Al costo
unitario del repo: proxy 300 ms + `getSessionTenant` 600 ms = **~900 ms de red
serializada antes del primer dato de negocio**, en cada carga de `/dashboard`,
`/admin` y `/mis-viajes`. Con Auth degradado y sin techo, el default de undici son
300,000 ms por llamada y `getSessionTenant` **reintenta una vez**: decidir "¿hay
sesión?" cuesta hasta **2 × (300,000 + 300,000) + 250 = 1,200,250 ms**.

Lo que cambió: en `/dashboard` el `maxDuration = 60` corta eso a los 60,000 — la
pestaña ya no gira cinco minutos. En `/admin` (30 páginas) y `/mis-viajes` no hay
nada que corte.

Consecuencia: la página no pinta el fallback para el que se diseñó (`safeLog`
atrapa **excepciones, no esperas**): se queda en blanco hasta que la plataforma
corta. En la sala, el contralor ve una pantalla vacía y nadie puede decir por qué.

**REINCIDENTE** (pase 1, MEDIO; auditoría 10). Mismas líneas.

---

### [MEDIO] `claimMessage` corre antes de que arranque el reloj, en el archivo cuyo comentario dice que el reloj arranca "desde la primera línea"
`src/lib/cuadra/processor.ts:244` (`const claim = msg.waMessageId ? await
claimMessage(msg.waMessageId) : 'nuevo'`) contra `:268` (`const reloj =
crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)`), y el comentario de `:259-267`:
*"RELOJ COMPARTIDO, desde la primera línea … Arranca AQUÍ y no más abajo … Un
reloj que arranca a media función cree tener 60s cuando ya se fueron varios."*

Escenario, con valores: `claimMessage` es un `insert` sobre
`wa_mensaje_procesado` con `acotada`, techo **9,500 ms**. En una ráfaga de 12
fotos, `route.ts:72-76` corre 12 `processInbound` en `Promise.all` contra la misma
tabla y la misma clave de conflicto. Los 9,500 ms de ese insert transcurren
**antes** de que exista el `Presupuesto`, así que `reloj.gastado()` los reporta
como 0 y `acotar(30,000)` concede 30,000 creyendo que quedan 120,000 cuando quedan
110,500. Es el 7.9% del presupuesto, invisible para todas las decisiones que
cuelgan de él —incluida la guarda `alcanza(COSTO_AGENTE_MS)` de `:1351`.

Consecuencia: pequeña en milisegundos, exacta en clase — es el fallo que el
comentario de `:265-267` describe y que motivó mover el `crearPresupuesto` hacia
arriba, con la línea de red que faltaba por subir 24 líneas más arriba.

---

### [MEDIO] La única aserción de tiempo de la suite mide la carga de la máquina, no el algoritmo — y vuelve a fallar, por segunda ronda consecutiva
`src/lib/cuadra/normas/fundamento.test.ts:137-144` (`medir()` cronometra 100
`citasEnTexto(t)` con `Date.now()`, toma el mejor de 9 y exige `< 500`).

Escenario, con valores, medido hoy sobre este árbol:

| Corrida | Resultado |
|---|---|
| `npx vitest run` completa, #1 | **3 archivos / 4 pruebas en rojo**, incluida ésta |
| `npx vitest run` completa, #2 | **1 archivo / 1 prueba en rojo**: ésta |
| `npx vitest run <solo este archivo>` | **37/37 en verde**, 1,986 ms |

Pasa aislada y falla en la suite: lo que mide es la contención de CPU entre los
269 archivos que corren en paralelo, no el coste de `citasEnTexto`.

Y su propio comentario ya diagnosticó esto y falló al dimensionarlo
(`:129-136`): *"126 ms el 28-jul con la máquina cargada — un microbenchmark
dentro de una suite de **103 archivos** en paralelo mide la carga, no el
algoritmo … Con 500 ms sigue detectándolo por tres órdenes de magnitud y deja de
romperse por ruido."* La suite pasó de 103 a **269 archivos** (`RESULTADO.md:40`)
y el umbral se volvió a reventar. El umbral se subió 4× y la carga subió 2.6×;
la siguiente ronda lo vuelve a romper.

Consecuencia: el mismo comentario la escribe — *"Un umbral que falla al azar no
protege de nada: enseña a reintentar el CI sin leerlo."* Es exactamente lo que
está pasando: la compuerta que el MAPA declara verde no lo es, y la única defensa
del repo contra un ReDoS en `FORMA_DE_CITA` es un número que ya nadie puede
distinguir de ruido. Antes de un demo, un CI que falla al azar es un CI que se
ignora.

Causa raíz: es un microbenchmark de pared dentro de un runner en paralelo. El
umbral es el síntoma; el instrumento es el problema.

---

### [BAJO] Sin prompt caching en ningún sitio del repo: el prefijo invariante se re-factura en cada ronda · REINCIDENTE
`src/lib/llm/openrouter.ts:711-714` (`convo` se arma una vez), `:724-742`
(`body()`, sin `cache_control`), `:766` (`await complete(convo, ultima)`, se
reenvía entero cada vuelta), `:757` (`for (let round = 0; round < maxRounds;
round++)`), `:695` (`maxRounds = 6`).
`grep -rn "cache_control\|prompt_cache\|cached_tokens" src/` → **0 resultados**,
verificado hoy.

Números: `src/lib/agents/prompts.ts` son **4,152 bytes** ≈ 1,050 tokens, más los
tres esquemas de tool que monta `registry.ts:21` ≈ **1,300 tokens de prefijo
invariante**. El flujo normal son 4 completions; sin caché ese prefijo se paga 4
veces: 5,200 tok × $2/1M (Sonnet 5, tarifa intro vigente hasta 31-ago-2026,
`openrouter.ts:105`) = **$0.0104 por liquidación**, ~20-35% del objetivo
declarado. Con `maxRounds = 6`: **$0.0156**. El prefijo es literalmente estático
entre rondas.

**REINCIDENTE** (pase 1, BAJO; auditoría 10). Sin cambios.

---

### [BAJO] `acotada` sobre `storage.upload` solo corre la carrera, no cancela: el PDF puede aterrizar después de que se registró como fallido
`src/lib/cuadra/tools.ts:261` (`acotada(supabaseAdmin().storage.from(…).upload(…))`),
`src/lib/cuadra/presupuesto.ts:277-278` (la capa 1: `if (typeof
conSenal.abortSignal === 'function')`). Verificado en `node_modules`:
`@supabase/storage-js/dist/index.cjs` tiene **cero** ocurrencias de `abortSignal`
y su firma es `async upload(path, fileBody, fileOptions)` — no es un builder de
PostgREST y no expone ese método.

Escenario, con valores: la capa 1 de `acotada` no se aplica, así que solo dispara
la capa 2 (el `Promise.race` de `:282-293`) a los **9,500 ms**. Eso libera la
invocación —que es lo que importa y es correcto— pero **no cancela el socket**: el
`fetch` subyacente sigue vivo hasta el default de undici (300,000 ms,
`presupuesto.ts:28-31`) en una instancia caliente de Lambda. Si la subida termina
a los 12,000 ms, el PDF **queda en el bucket** y el código ya escribió
`logger.warn('pdf.upload')` y devolvió `undefined`: `saveLiquidacion` persiste
`pdf_url = null` (`tools.ts:273`) sobre un objeto que existe, y `:287`
(`pdf_contralor_generado: false`) dispara `logger.error('pdf.contralor_no_generado')`
en `processor.ts:1646` para un PDF que sí se generó.

Consecuencia: dos filas de log afirmando un fallo que no ocurrió, y una
liquidación sin `pdf_url` cuyo PDF está a un `createSignedUrl` de distancia. Es
ruido de diagnóstico, no dinero — pero es ruido en el camino que el contralor
audita.

---

## Lo que revisé y está bien

- **Las dos subidas de `guardar_liquidacion` ya llevan techo** (`tools.ts:261-264`,
  llamadas en `:268` y `:269`). El agujero de 600,000 ms del CRÍTICO del pase 1
  está cerrado en el camino que corre, y `ctx.signal?.throwIfAborted()` aparece en
  `:224` y `:237`. Verificado abriendo el archivo, no por conteo.
- **El RPC del mutex está dentro de `acotada`** (`conv.ts:304`), con el cliente
  hoisteado fuera del bucle pero la llamada acotada dentro. El agujero de 300,000
  ms del ALTO del pase 1, cerrado. El comentario `:299-303` documenta el nuevo
  peor caso (21,500) con honestidad.
- **`traerTodo` acota cada página** (`pg.ts:60`). Las once lecturas de
  `analytics.ts` y las seis de `operacion.ts` que en el pase 1 no tenían techo
  ahora lo tienen todas, por el borde. Verificado: `analytics.ts` tiene 0
  `acotada` propias porque las 11 pasan por `traerTodo`, y las 3 que no paginan
  (`:586`, `:647`) van por `exigir`.
- **El bucle de huérfanos mira el reloj** (`processor.ts:1147`,
  `hayPresupuestoPara(reloj, techoPasoSupabaseMs(), 'addGasto de huérfano')`), con
  `faltaron` y aviso al operador (`:1201-1203`). Los 475,000 ms teóricos del MEDIO
  del pase 1, cerrados.
- **La barrera de intake se DERIVA del techo del OCR**
  (`presupuesto.ts:231`: `TECHO_OCR_MS + MARGEN_INTAKE_ESCRITURA_MS` = 30,000),
  así que la ventana de 5,000 ms en la que la barrera se rendía de más ya no
  existe. Era un ALTO reincidente desde la auditoría 10 y era dinero del operador.
- **La imagen que cuesta dinero ya va acotada** (`ocr.ts:233` `TOPE_PX_VISION =
  2_000`, `:242-259` `paraVision`, usada en el camino real en `:323`), con
  `withoutEnlargement` para que la foto típica de WhatsApp pase intacta. El MEDIO
  reincidente del pase 1, cerrado con la aritmética de teselas escrita al lado.
- **Los dos recortes silenciosos del panel, cerrados**: `getViajes`
  (`analytics.ts:396`) ya no tiene `limite = 100` y `getDocumentos` (`:432`) ya no
  pide `.limit(1000)`; las dos paginan con `traerTodo` y desempatan por `id`. Eran
  dos ALTOS del pase 1 y los dos eran cifras falsas, no solo lentitud.
- **`/admin/negocio.ts` ya pagina y ordena** (`:96-108`, `:217`): las cuatro
  consultas sin `.limit()`, sin `.order()` y con recorte a 1,000 del ALTO del pase
  1 ahora van por `traerTodo` con `.order()` explícito. Lo que queda de ese
  hallazgo es el `maxDuration` ausente, reportado arriba.
- **Las 24 páginas de `/dashboard` declaran `maxDuration = 60`**, con una prueba
  que lo mantiene (`max_duration.test.ts:51-57`) y una lista `PENDIENTES` vacía.
  El techo elegido (60) cabe holgado sobre el techo de una consulta (9,500) y no
  llega a "minutos".
- **`PASOS_CIERRE` volvió a apuntar a donde dice**: los trece `donde` llevan ahora
  un `simbolo` y `presupuesto.test.ts` abre `processor.ts`, va a esa línea y
  comprueba que lo contenga. El MEDIO del pase 1 (los once `donde` que apuntaban a
  comentarios y `return`s) está cerrado — con la excepción de la columna
  `opcional`, reportada arriba.
- **`PRESUPUESTO_WEBHOOK_MS` y `TECHO_ENVIO_META_MS` siguen sincronizados por
  prueba** que lee el otro archivo como texto (`presupuesto.test.ts:80-90`,
  `cierre_reloj.test.ts:69-76`). El mecanismo es bueno; lo que no cubre es la suma.
- **El presupuesto es por mensaje y el reloj es de pared** (`processor.ts:268`,
  `presupuesto.ts:380-382`). Con `Promise.all` sobre un lote (`route.ts:72-76`),
  los N relojes miden la misma ventana, así que **no** se suman los presupuestos.
  Lo volví a buscar y no está.
- **La guarda `alcanza(COSTO_AGENTE_MS)`** (`processor.ts:1351`) impide el caso en
  que `acotar(40_000)` devolvería 0 — que en `run.ts:38` sería falsy y dejaría al
  agente **sin ningún timer**. Con la guarda, `timeoutMs` nunca baja de 15,000.
  Lo verifiqué buscando el fallo; está tapado por accidente afortunado, no por
  diseño.
- **`generarLiquidacionPDF` no es un problema de CPU**: `pdf-lib` con
  `StandardFonts.Helvetica` (`liquidacion/pdf.ts:84-85`), sin embeber tipografías
  ni imágenes. Los dos ejemplares son decenas de ms, no segundos.
- **El costo se cobra al precio del modelo que respondió esa ronda**
  (`openrouter.ts:773-776`) y las tarifas caducadas gritan al arrancar
  (`avisarPreciosCaducados`, con la vigencia del precio intro de Sonnet como DATO
  y no como comentario). Correcto para un producto que se cobra por liquidación.
- **`getResumenCosto` distingue tres estados** (`costos.ts:299-302`) y no pinta $0
  cuando no midió. La lástima es que nadie lo llame.
- **`/api/demo` no toca ni red ni LLM**: corre el motor puro. Para un demo en vivo
  sigue siendo la decisión correcta.

## Lo que NO alcancé a revisar

- **Los otros tres fallos de la primera corrida.** La corrida #1 dio 3 archivos /
  4 pruebas en rojo y solo capturé la cola del reporte, así que tengo el nombre
  de una (`fundamento.test.ts:144`) y no el de las otras tres. La corrida #2 dio
  1/1. O sea: hay **al menos dos archivos más intermitentes** que no identifiqué.
  Es del rubro de pruebas, pero lo dejo escrito porque invalida la línea base con
  la que los doce auditores estamos midiendo.
  Ningún hallazgo de este reporte depende de la suite: todos salen de leer las
  líneas, y `npx tsc --noEmit -p .` da exit 0.
- **El `maxDuration` por defecto de Vercel para una página sin declararlo.** No
  hay `vercel.json` legible desde aquí con esa clave, así que comparo contra el
  máximo del plan pro que el propio repo cita (300,000 ms,
  `api/webhook/whatsapp/route.ts:21-22`). Si el default real es menor —15 s es lo
  habitual sin fluid compute—, el ALTO de `/admin` empeora, no mejora.
- **Costo real facturado.** Todo se calcula contra `PRICES` y contra los
  comentarios del repo. Sin acceso a OpenRouter ni a `llm_costo` con datos reales,
  el $0.015/visión sigue sin contrastarse contra una factura. Con las filas que ya
  existen y `getResumenCosto` ya escrito, ese contraste es de media hora.
- **Tokens de imagen reales después del `paraVision` nuevo.** El cálculo de
  teselas de `ocr.ts:215-221` es del repo y es razonable, pero no medí la
  distribución de tamaños que llega de WhatsApp Cloud API ni conté contra
  `llm_costo.tokens_in`. Si la foto típica ya venía bajo 2,000 px, el arreglo no
  ahorra nada y el $0.015 sigue sin explicación.
- **La ruta del XML del CFDI** (`processor.ts:858-985`, con su propio
  `acquireViajeLock(reloj.acotar(12_000))` en `:958`). Hereda el mismo
  desbordamiento de un sondeo que reporté para el camino del "listo", pero no le
  hice la suma completa.
- **`/mis-viajes`** (el panel del chofer). Confirmé que es `force-dynamic` sin
  `maxDuration` (`page.tsx:8`), pero no conté sus consultas.
- **El prefetch de los enlaces del sidebar** (`sidebar-nav.tsx`) en Next 16. No
  verifiqué en un navegador cuántas peticiones RSC dispara para rutas dinámicas
  sin `loading.tsx`, así que no lo reporté como multiplicador del MEDIO del rail.
- **El tamaño del payload RSC** que ahora viajan `getViajes` y `getDocumentos` al
  paginar sin tope. Cambiar `.limit(100)` por "todas las filas" arregla la cifra y
  mueve el costo al transporte; no lo medí y por eso no lo reporté como hallazgo.
- **Latencia real Vercel↔Supabase y Vercel↔OpenRouter.** Todos los números
  nominales usan el 0.3 s/consulta que el repo asume. Si la real es peor, los
  peores casos empeoran proporcionalmente; si es mejor, **los techos (9,500 /
  10,000 / 300,000) no se mueven y las sumas del peor caso tampoco**.
