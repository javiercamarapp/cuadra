# Rendimiento y costo — auditoría 6

**Nota: 7/10** (igual que la ronda 5). Razón: **se atacó y subió** en tres frentes
verificados — `getAcumuladoCombustible` pasó de "sin límite, mentía a la baja" a
paginado con `count: 'exact'` y falla cerrada (probado); `duplicados.ts` dejó de
materializar un arreglo de ~20.000 UUID por grupo (probado, 1.291 ms → 30.7 ms con
96.000 filas); y el bundle de la función bajó de 623 a 498 archivos (**medido en
esta máquina, no solo leído**: 498 archivos, 480 de `node_modules`). Se queda en 7
y no sube porque el frente que más pesaba en la ronda 5 —el tramo de cierre sin
tope— se anunció cerrado ("Ahora hay techo por consulta", commit `20a9f58`) y
**verifiqué corriendo el código real contra un servidor mudo que solo 2 de los 13
pasos del cierre quedaron protegidos**. Es el mismo riesgo que la ronda 5 ya
calificaba ALTO, medido con precisión en vez de estimado — no es nuevo, pero es
mayor de lo que el propio comentario del código admite.

**La pregunta de la ronda, aplicada a este rubro:** el arreglo de `repo.ts`
—`TOPE_CONSULTA_MS` + `AbortSignal` + carrera contra temporizador en sus 17
funciones— es correcto y está probado para lo que cubre. Lo que abrió es la
apariencia de que el CIERRE completo quedó protegido, cuando el cierre cruza cinco
módulos y solo uno de los cinco recibió el arreglo.

---

## Hallazgos

### [ALTO] "Ahora hay techo por consulta" cubre 2 de 13 pasos del cierre; los otros 11 cuelgan exactamente igual que antes de la ronda

`src/lib/cuadra/costos.ts:85,114,168` · `src/lib/cuadra/conv.ts:227,388` ·
`src/lib/meta/client.ts:82-96,107-123` · `src/lib/cuadra/processor.ts:783` ·
`src/lib/cuadra/presupuesto.ts:35-49` (tabla `PASOS_CIERRE`)

El mensaje del commit `20a9f58` dice "Ahora hay `TOPE_CONSULTA_MS` impuesto en las
17 llamadas de `repo.ts`, y la tabla de los 13 pasos se compara contra el margen en
una prueba." Las dos frases son ciertas por separado y engañosas juntas: **las 17
llamadas de `repo.ts` no son las mismas que los 13 pasos del cierre.** Solo 2 de
los 13 pasan por `repo.ts`. Los otros 11 pasan por `costos.ts`, `conv.ts`,
`meta/client.ts` o `supabaseAdmin().storage` directo — ninguno de los cuales
importa `acotada()`, `TOPE_CONSULTA_MS` ni ningún `AbortSignal`.

Mapa completo de `PASOS_CIERRE` contra su implementación real:

| # | paso | archivo real | protegido |
|---|---|---|---|
| 1 | `registrarCosto` del turno | `costos.ts:114`, `supabaseAdmin()` crudo | **NO** |
| 2 | `vincularCostosALiquidacion` | `costos.ts:168`, crudo | **NO** |
| 3 | `guardiaCifras` → `cuadrarDesdeDB` | `repo.ts` (`getViaje`+`getGastos`, `acotada`) | sí* |
| 4 | `sendText` de la respuesta | `meta/client.ts:82-96`, `fetch` pelado | **NO** |
| 5 | `registrarCostoWhatsApp` de esa respuesta | `costos.ts:85`→114, crudo | **NO** |
| 6 | `getGastos` del aviso de barrera | `repo.ts`, `acotada` | sí |
| 7 | `sendText` del aviso de barrera | `meta/client.ts:82-96`, crudo | **NO** |
| 8 | `registrarCostoWhatsApp` de ese aviso | `costos.ts:85`, crudo | **NO** |
| 9 | `createSignedUrl` del PDF | `processor.ts:783`, `supabaseAdmin().storage`, crudo | **NO** |
| 10 | `sendDocument` del PDF | `meta/client.ts:107-123`, crudo | **NO** |
| 11 | `registrarCostoWhatsApp` del PDF | `costos.ts:85`, crudo | **NO** |
| 12 | `saveConversation` | `conv.ts:227`, crudo | **NO** |
| 13 | `releaseViajeLock` | `conv.ts:388`, `supabaseAdmin().rpc()` crudo | **NO** |

\* El paso 3 sobrevive no porque esté protegido entero: `cuadrarDesdeDB`
(`desde_db.ts:11-15`) hace `Promise.all([getViaje, getGastos, getConfig])`, y
`getConfig` (`config.ts:145-147`) también usa `supabaseAdmin()` crudo, sin tope.
Lo comprobé importando el módulo real contra un servidor que acepta la conexión y
nunca contesta: `Promise.all` falla RÁPIDO porque `getViaje`/`getGastos` SÍ
rechazan a los ~1.5 s de `TOPE_CONSULTA_MS` (probé con
`CUADRA_TOPE_CONSULTA_MS=1500`), y eso arrastra el `Promise.all` entero a rechazar
aunque `getConfig` siga colgado de fondo. Es una salvación por semántica de
`Promise.all`, no por diseño — el día que `getConfig` se llame solo (ya pasa en
`tools.ts:35`, fuera del cierre pero dentro del presupuesto de 40 s del agente,
sin ninguna carrera que lo salve) cuelga igual que los demás.

**Verificado corriendo el código real**, no leyéndolo — mismo patrón que
`repo_tope.test.ts`: un servidor TCP local que acepta la conexión y nunca
contesta, con un corte artificial de 12.000 ms (el tamaño íntegro de
`MARGEN_CIERRE_MS`):

```
registrarCosto contra servidor mudo:              colgada en 12037 ms
vincularCostosALiquidacion contra servidor mudo:   colgada en 12004 ms
saveConversation contra servidor mudo:             colgada en 12034 ms
releaseViajeLock contra servidor mudo:              colgada en 12025 ms
storage().createSignedUrl contra servidor mudo:     colgada en 12002 ms
fetch pelado (patrón sendText/sendDocument):        sigue viva a los 12007 ms
```

Ninguno de los seis resolvió — ni con éxito ni con error — dentro del margen
completo del cierre. El default real de undici (300.000 ms) es 25× más largo que
esta prueba; lo único que de verdad los corta es `maxDuration = 120` matando la
función entera.

**Escenario con números.** Un socket se queda a medio abrir en el paso 1
(`registrarCosto`, el PRIMER paso después de que el agente ya guardó la
liquidación en la base). Nada de lo que sigue corre: ni el `sendText` con el
resumen, ni el aviso de barrera, ni el PDF, ni `saveConversation`. La invocación
completa —que en el peor caso de la ronda 5 ya llevaba 81,9 s gastados antes de
llegar aquí (ver la tabla de abajo)— se queda viva hasta que Vercel la mata a los
120 s. El operador no recibe nada. `logger.error('pdf.no_entregado')` **tampoco se
escribe**, porque ese log vive dentro de un bloque que nunca se alcanza. Meta ya
tiene su 200 y no reintenta. Es EXACTAMENTE el modo de falla que el encabezado de
`repo.ts:14-39` describe en detalle como "el peor final que tiene este producto" —
descrito ahí para justificar el arreglo de `repo.ts`, y vivo intacto trece líneas
de código más allá.

**Lo que el propio código ya admite, y lo que no.** El comentario de
`presupuesto.ts:62-68` es honesto sobre una fracción del problema: dice
explícitamente que "los `sendText`/`sendDocument` de `meta/client.ts` siguen
usando `fetch` pelado". Eso son 3 de los 11 pasos sin proteger. Los otros 8
—`registrarCosto`, `vincularCostosALiquidacion`, `registrarCostoWhatsApp` (×3),
`createSignedUrl`, `saveConversation`, `releaseViajeLock`— no se mencionan en
ningún comentario de esta ronda. No es que el problema haya crecido: es que
`repo.ts` es un archivo y el cierre es una SECUENCIA que cruza cinco módulos, y el
arreglo se aplicó por archivo.

**Consecuencia:** la ronda 5 ya calificaba este riesgo ALTO con la premisa de que
"nada la hace cumplir" en NINGÚN punto del cierre. Hoy 2 de 13 puntos sí la hacen
cumplir. El riesgo sigue siendo el mismo — un solo socket colgado en cualquiera de
los 11 puntos restantes se lleva la invocación completa — y ahora está medido con
la fracción exacta en vez de estimado.

**Causa raíz:** el arreglo se escribió y se probó contra `repo.ts` (`repo_tope.test.ts`),
que es donde vive la mayoría de las CONSULTAS de datos. Pero el cierre no es solo
consultas: es escrituras de costo (`costos.ts`), mensajería (`meta/client.ts`),
storage (`processor.ts`) y persistencia de conversación (`conv.ts`), y ninguno de
esos cuatro módulos importa de `repo.ts` ni comparte su mecanismo.

---

### [MEDIO] El `donde` de `PASOS_CIERRE` ya apunta a líneas equivocadas — desde el mismo día en que se escribió

`src/lib/cuadra/presupuesto.ts:35-49` contra `src/lib/cuadra/processor.ts` (líneas reales)

La tabla `PASOS_CIERRE` se escribió, según su propio comentario, para que "revisar
si la lista sigue completa" no exija "releer `processor.ts` entero, que es
exactamente lo que nadie hizo en tres rondas." Comparé cada `donde: 'processor.ts:N'`
contra la línea real (`command grep -n` sobre las 11 llamadas):

| paso de la tabla | línea que declara | línea real | delta |
|---|---|---|---|
| `registrarCosto` del turno | 591 | 619 | +28 |
| `vincularCostosALiquidacion` | 595 | 623 | +28 |
| `guardiaCifras` → `cuadrarDesdeDB` | 658 | 686 | +28 |
| `sendText` de la respuesta (`say(reply)`) | 715 | 743 | +28 |
| `getGastos` del aviso de barrera | 734 | 762 | +28 |
| `sendText` del aviso de barrera | 735 | 763 | +28 |
| `createSignedUrl` del PDF | 755 | 783 | +28 |
| `sendDocument` del PDF | 757 | 785 | +28 |
| `registrarCostoWhatsApp` del PDF | 758 | 786 | +28 |
| `saveConversation` | 774 | 802 | +28 |
| `releaseViajeLock` | 814 | 842 | +28 |

Las 11 referencias están corridas por el MISMO offset (+28 líneas), lo que dice
que el desface no es ruido: se escribió la tabla contra una versión de
`processor.ts` con 28 líneas menos antes del punto 591, y el mismo commit
(`fa03b00`) agregó un docstring de 13 líneas a `ponerAvisoADisposicion` —más
arriba en el archivo— sin recalcular la tabla. `presupuesto.test.ts:111-120`
("la tabla trae los trece pasos, con dónde vive cada uno") solo verifica que
`p.donde` matchee `/\.ts/` y que haya 13 elementos — **no verifica que la línea
exista o corresponda**. El conteo de pasos (13) sigue siendo correcto; los
punteros, no.

**Consecuencia:** el mecanismo que se escribió esta ronda para prevenir
exactamente el patrón "el número al lado del código dejó de coincidir con el
código" —el patrón que el propio `presupuesto.ts:101` cita como causa del bug
original de `maxDuration`— reprodujo ese mismo patrón dentro de las horas de
haberse escrito, sin que ninguna prueba lo note. Es de documentación, no de
runtime: no cambia ningún presupuesto ni ningún tiempo de respuesta. Baja a MEDIO
y no a BAJO porque es la prueba más directa de que la ronda necesita justo el tipo
de mirada que esta pide — el mismo día que un arreglo cierra un patrón de fallo,
puede abrir una instancia nueva del mismo patrón.

---

### [ALTO, sin cambios] `analytics.ts` sigue barriendo la tabla completa del tenant — confirmado, no se tocó esta ronda

`src/lib/cuadra/analytics.ts:39-44,71-77,106-110,130-134`

Pedido explícito del encargo: confirmar si sigue igual. Sigue igual. `getKpis`,
`getStatsPorOperador`, `detectarAnomalias` y `getAcreditables` hacen
`supabaseAdmin().from(...).select(...).eq('tenant_id', tenantId)` sin `.limit()`
ni `.range()`, exactamente como los describía la ronda 5. La ÚNICA función de esta
familia que se arregló esta ronda fue `getAcumuladoCombustible` (`repo.ts`, ver
"lo que está bien" abajo) — sus tres hermanas de `analytics.ts` no. El
`max_rows` de PostgREST (default 1.000 filas) sigue recortando en silencio
`detectarAnomalias` en cuanto el tenant pasa las ~125 liquidaciones, con el mismo
efecto que la ronda 5 documentó: el detector de fraude entre viajes deja de ver la
mayoría de los datos sin decir nada. No repito la derivación completa (flota
mediana, 96.000 filas/año, etc.) porque no cambió; vive en
`docs/auditoria-5/rendimiento.md`, hallazgo ALTO 3.

---

### [ALTO, sin cambios] El protocolo de dos fotos sigue pagando visión completa en el acercamiento

`src/lib/cuadra/processor.ts:329`

```ts
const extraccion = await extraerComprobante(dataUrl, reloj.senal(25_000));
```

Sigue siendo UNA foto por llamada — el hallazgo ALTO 1 de la ronda 5 no se tocó.
`extraerComprobante` sigue aceptando `string | string[]` en su firma
(multi-foto probado en el arnés), pero el único llamador real en producción sigue
mandando un `dataUrl` a la vez. El costo sigue doblado en su partida dominante
($0,124 de $0,248 de visión por liquidación de 8 comprobantes no compra nada, por
la misma razón que la ronda 5 documentó: lo único que el acercamiento aporta —folio,
código de barras, liga, UUID— sale de `codigos` en `ocr.ts:189`, ANTES de la
llamada de visión). No repito la derivación; vive en `docs/auditoria-5/rendimiento.md`.

---

### [MEDIO, sin cambios] El costo declarado en `models.ts` sigue entre 7× y 12× bajo lo medido

`src/lib/llm/models.ts:17`

```
//   Costo ≈ $0.03–0.05 / liquidación.
```

Sin tocar. La cifra medida en la ronda 5 (~$0,33 típico, ~$0,62 peor caso, con las
fuentes desglosadas en ese reporte) sigue sin reflejarse aquí. Nada de lo que
cambió esta ronda toca precios de modelo, tokens ni conteo de rondas —`openrouter.ts:83`
sigue con el mismo intro de Sonnet 5 vigente hasta el 31-ago-2026, sin lógica de
fecha, sin prueba, sin alerta.

---

### [BAJO, sin cambios] Los comentarios "60s" siguen sin corregirse, y siguen apareciendo

`route.ts:14,64,68` · `conv.ts:351,353` · `ocr.ts:178` · `openrouter.ts:215` ·
`presupuesto.ts:9-12`

La ronda 5 contó ocho. Volví a contar con `command grep -rn "60s"` sobre los
archivos del camino crítico y siguen ahí, incluido uno dentro del propio
`presupuesto.ts` (líneas 9-12: "la barrera de intake espera hasta 20s y el mutex
hasta 12s... sin saber que comparten los 60s con el agente" — hoy comparten 120s).
Es el archivo que MÁS se tocó esta ronda y el comentario de cabecera —el que
explica por qué existe el archivo— sigue citando el número viejo. Sin consecuencia
de runtime; consecuencia de confianza en la documentación, que es justo el rubro
que esta ronda pide vigilar.

---

## La suma del peor caso, eslabón por eslabón

Los eslabones 0-7 no cambiaron de código esta ronda (nada tocó `conv.ts` en su
lógica de barrera/mutex, ni `run.ts`, ni `tool-executor.ts`). Revalidé las
constantes que los gobiernan contra el código de HOY en vez de asumir las de la
ronda 5: `maxDuration = 120` (`route.ts:27`), barrera `acotar(20_000)`
(`processor.ts:536`), mutex `acotar(12_000)` (`processor.ts:556`), agente
`acotar(40_000)` (`processor.ts:606`) — las cuatro sin cambios. `ToolContext.signal`
sigue declarado (`run.ts:34`) y sin un solo lector en `tools.ts` (mismo grep que la
ronda 5, cero resultados) — el hallazgo MEDIO de la ronda 5 sobre la ronda de
tools sigue exactamente igual.

| # | eslabón | tope | acumulado (ronda 5, sin cambios) |
|---|---|---|---|
| 0 | arranque en frío | sin tope | fuera del reloj |
| 1 | `claimMessage`+`resolveOperador`+`getOpenViaje` | 3 RTT, sin timeout | 0.9 s |
| 2 | aviso de privacidad | 4 RTT, sin timeout | 3.4 s |
| 3 | barrera de intake | `acotar(20_000)` | 24.2 s |
| 4 | mutex del viaje | `acotar(12_000)` | 38.0 s |
| 5 | lecturas previas al agente | 3 RTT | 38.9 s |
| 6 | agente | `acotar(40_000)` | 78.9 s |
| 7 | ronda de tools que el abort NO corta | 4 RTT + 2 subidas de PDF | 81.9 s |
| 8 | **cierre** | ver abajo | ver abajo |

**Eslabón 8, recalculado con lo que cambió esta ronda.** Si los 13 pasos se
comportan en su costo unitario optimista (los mismos de siempre: 0.3 s consulta,
1.5 s `sendText`, 2.5 s `sendDocument`, 0.5 s URL firmada), la suma sigue siendo
**8.9 s contra 12 s reservados** — idéntico a la ronda 5, porque `COSTO_CIERRE_MS`
no cambió. Con eso: **90.8 s contra 120 s, 29.2 s de holgura aritmética.** Ese
número no cambió y sigue siendo cierto EN EL CAMINO FELIZ.

Lo que cambió es la naturaleza del peor caso. Antes de esta ronda, los 13 pasos
compartían un único perfil de riesgo: cualquiera podía colgar hasta 300 s (default
de undici), sin excepción. Hoy hay dos perfiles:

- **2 de 13 pasos** (guardiaCifras→cuadrarDesdeDB, getGastos de la barrera):
  acotados a `TOPE_CONSULTA_MS` + `GRACIA_TOPE_MS` = 9.5 s como techo duro,
  verificado con `repo_tope.test.ts` (pasa) y con mis propias corridas contra un
  servidor mudo.
- **11 de 13 pasos**: sin ningún techo propio. Verificado contra el mismo servidor
  mudo: los seis que pude importar directamente (`registrarCosto`,
  `vincularCostosALiquidacion`, `saveConversation`, `releaseViajeLock`,
  `createSignedUrl`, y el patrón `fetch` pelado de `sendText`/`sendDocument`)
  seguían sin resolver a los 12.000 ms — 25× menos que el default real de undici.

**Veredicto:** el peor caso sumado a mano sigue cabiendo — 90.8 s contra 120 s — en
el camino donde todo responde, aunque lento. Pero el peor caso REAL de este
producto nunca fue "todo lento": es "un socket se queda colgado", y para ESE
escenario el techo sigue siendo `maxDuration = 120` como único límite en 11 de los
13 pasos del tramo que más importa, exactamente como en la ronda 5. La holgura de
29.2 s no protege de nada cuando el fallo no es "tardar de más" sino "no volver
nunca": un socket colgado en cualquiera de los 11 pasos sin techo quema el resto
del presupuesto hasta los 120 s, mata la función, y dado que el agente ya corrió
`guardar_liquidacion_tx` en el eslabón 7, la liquidación queda escrita en la base
sin que el operador reciba una sola palabra ni un PDF.

---

## Costo por liquidación

Nada de lo que cambió esta ronda toca precio de modelo, tokens ni el protocolo de
dos fotos, así que las cifras de la ronda 5 siguen vigentes y no las re-derivo:
**≈$0,33 por liquidación de 8 comprobantes, peor caso ≈$0,62**, contra el
**$0,03–0,05** que sigue declarando `models.ts:17` (7× a 12× bajo). El desglose
completo —visión del ticket, visión del acercamiento que no aporta nada, turno de
cuadre, WhatsApp salientes— vive en `docs/auditoria-5/rendimiento.md`.

Lo único nuevo con impacto en costo/latencia esta ronda es indirecto:
`getAcumuladoCombustible` paginado (ver abajo) le AGREGA round-trips a
`cuadrar_viaje` cuando el tenant tiene más de 1.000 cargas de diésel en el
ejercicio (una flota de 50 operadores con ~18.000 cargas/año hace ~18 páginas). A
~150-300 ms por página protegida (`repo.ts`, `acotada`), son **~2.7-5.4 s
adicionales** dentro del presupuesto de 40 s del agente, a cambio de dejar de
reportar un acumulado recortado al 5-40% (el bug que la ronda 5 encontró). Es un
intercambio correcto — dinero correcto por unos segundos — y está dentro del
presupuesto del agente con margen de sobra.

---

## Lo que revisé y está bien

- **`TOPE_CONSULTA_MS` + `AbortSignal` + carrera contra temporizador, para lo que
  cubren, funcionan.** Corrí `repo_tope.test.ts` (4/4) y `presupuesto.test.ts`
  (15/15): pasan. Sobre el mecanismo mismo: el `finally { clearTimeout(temporizador) }`
  de `repo.ts:66-68` limpia el temporizador tanto si gana la consulta como si gana
  el corte — no hay fuga de los 17 timers por invocación. Verifiqué que
  `.abortSignal()` es un método real de `@supabase/postgrest-js` (línea 1045 de su
  `dist/index.mjs`) que sí cancela el `fetch` subyacente (línea 300), y que
  funciona igual para lecturas (`getViaje`) que para escrituras por RPC
  (`saveLiquidacion` → `guardar_liquidacion_tx`), probado en el propio
  `repo_tope.test.ts:62-72`.
- **`getAcumuladoCombustible` paginado es un arreglo real, no cosmético.** Corrí
  `repo_acumulado.test.ts` (5/5): el caso del `max_rows` recortado
  (`rejects.toThrow(/solo se leyeron 500 de 50000/)`) confirma que falla cerrado
  en vez de devolver un acumulado silenciosamente incompleto — mismo criterio que
  el resto del camino del dinero. `MAX_PAGINAS = 100` (100.000 cargas) es un techo
  razonable con mensaje explícito si se excede, no un corte mudo.
- **`duplicados.ts` es una mejora algorítmica genuina.** Corrí
  `duplicados.test.ts` (10/10, incluida la prueba de escala con 96.000 filas en
  350 ms). La nueva `buscadorDeUuidEnLlave` reemplaza `[...conUuid].some(...)`
  dentro del bucle por una búsqueda de ventanas de longitud fija contra un `Set`:
  O(G×U) → O(G×|llave|), con salida idéntica byte a byte (mismo criterio
  `k.includes(u)`, solo reformulado). Deja de depender del tamaño del catálogo de
  CFDI del tenant.
- **El bundle de la función bajó de verdad — lo medí yo, no solo leí el
  comentario.** Reconstruí el script del propio `next.config.ts:52-57` contra el
  trace real (`route.js.nft.json`): **498 archivos totales**, coincide con lo
  declarado. El desglose exacto de MB varió un poco contra el comentario
  (dependencias del entorno local), pero el número que importa —el conteo de
  archivos, que es lo que gobierna cuántos `stat()` hace el cold start— coincide.
- **`sat.ts` sigue con su `AbortSignal` de 4 s** y las descargas de media de
  `meta/client.ts` (`downloadMediaAsText`/`downloadMediaAsDataUrl`) siguen con
  `DOWNLOAD_TIMEOUT_MS = 15_000` — ninguno de los dos se tocó ni se rompió esta
  ronda.

## Lo que NO alcancé a revisar

- **Latencia real Vercel↔Supabase.** Igual que la ronda 5: toda la tabla del peor
  caso usa costos unitarios optimistas escritos en el propio código, no medidos en
  producción.
- **Si `getConfig` alguna vez cuelga SOLO (no dentro de un `Promise.all` con un
  hermano protegido) dentro del presupuesto de 40 s del agente** —pasa en
  `tools.ts:35`, `consultar_politica`— con qué frecuencia real ocurre. Verifiqué
  que el código lo permite (mismo patrón `supabaseAdmin()` crudo); no medí
  probabilidad contra producción.
- **Consumo real de tokens del turno de cuadre y costo real de una imagen en
  Gemini.** Sin cambios desde la ronda 5; sigue sin medirse con una llamada real
  (el encargo la prohíbe).
