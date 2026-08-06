# Sistema agéntico y orquestación — auditoría 14

**Nota: 8/10** (movimiento: 8 → 8, sin cambio). La re-auditoría de la ronda 13
atacó los cuatro MEDIO agénticos y **tres de los cuatro cierres son reales** —
verificados hoy con probe propio contra el código ACTUAL (`45de52c`,
`438c8f4`+`e048de1`). El cuarto —el cotejo de cardinales en palabras
(`8d6eff7`)— quedó **a medias**: el escenario EXACTO que el auditor de la 13
probó con valores (un "ochocientos" inventado que coincide numéricamente con un
tope de la política) **sigue pasando intacto**. Y la implementación del deber
ser de la RFA 2.9 (`0d23f73`, `0fa305e`) —que es el código nuevo de esta
ronda— trae **dos MEDIO propios**: una liquidación cuyo único hallazgo es el
excedente del 15% (o la flota no elegible) sale con estatus **verde**
"Cuadrada" pese a tener dinero NO deducible, y el contador del ejercicio
**mezcla ejercicios** en cuadres de año cruzado (un diésel en efectivo de
dic-2025 consume el tope del 15% de 2026 y la nota lo afirma). No es un 9
porque la deuda del rubro vuelve a crecer en la misma clase —un fix que se
queda a medias, una cifra/estatus que se lee distinto de lo que es— y el
falso positivo de horas/fechas que la ronda 13 dejó anotado para "once" se
**ensanchó de 1 palabra a 6** con el propio fix de la 13.

> Método: leí línea por línea `estado_afirmado.ts`, `cifras.ts`, `guardia.ts`,
> `desde_db.ts`, `engine.ts` (1,175 líneas), `resumen.ts`, `por_diferencia.ts`,
> `cierre_aviso.ts`, `config.ts`, `administracion.ts`, `admin/flotas/page.tsx`,
> `tools.ts`, `periodo/combustible.ts`, `periodo/aviso.ts`, `repo.ts:802-860` y
> las zonas agénticas de `processor.ts`. Cada hallazgo se **probó** con probes
> temporales (`zzz-a14-probe`/`zzz-a14b`, borrados al terminar), no solo se
> razonó. Los cierres de la ronda 13 se verificaron contra el código ACTUAL
> (los archivos agénticos no cambiaron desde sus commits de cierre — verificado
> por `git log` por archivo). Suites del rubro en verde (307 + 173 pruebas),
> `eslint` limpio sobre los archivos del rubro. Sha: `0fa305e`.

## Los cierres de la ronda 13 — verificados contra el código actual

| Hallazgo ronda 13 | Commit de cierre | Estado hoy | Cómo se verificó |
|---|---|---|---|
| [MEDIO] negación de ORACIÓN ENTERA (mentira con "no" accesorio) | `45de52c` | **Cerrado** | `estado_afirmado.ts:148-149` — ventana de 25+18 chars. Probe: `guardiaEstado("Ya quedó cerrada tu liquidación, no te preocupes. En un momento te llega el PDF.", {cerro:false, entrego:false})` → `forzado:true` (se caza). Y la negación pegada ("Tu liquidación no quedó cerrada todavía") → `forzado:false`. |
| [MEDIO] pregunta SIN "¿" se tachaba | `45de52c` | **Cerrado** | `estado_afirmado.ts:125` — `PREGUNTA = /[¿?]/`. Probe: `"Ya quedó cerrada mi liquidación?"` → `forzado:false`. |
| [MEDIO] portón 1-10/"diez" | `438c8f4`+`e048de1` | **Cerrado (con efecto lateral, ver hallazgo nuevo)** | `cifras.ts:41-46`. Probes: "Te sobran diez del anticipo." → true; "Me faltan cinco." → true; "En un momento te llega el PDF." → false. |
| [MEDIO] cardinales en palabras no cotejados | `8d6eff7` | **Cierre PARCIAL** | `cifras.ts:187-196` + `guardia.ts:88-104`. La dirección "no coincide con nada" quedó cerrada; la dirección "coincide por casualidad" —el escenario que el auditor de la 13 probó con valores— sigue abierta. Ver hallazgo 1 abajo. |

Los BAJO que la ronda 13 dejó anotados como abiertos siguen abiertos y sin
tocar (los archivos no cambiaron): el futuro "-amos" con marcadores fuera de
la lista (`estado_afirmado.ts:129`), el comentario "estés" de `fundamento.ts`
(`:506-515`), la memoria multi-oración todo-o-nada (`fundamento.ts:281`), el
`CUADRA_INTAKE_GRACE_MS=0` inalcanzable (`conv.ts:591`), la rama `real.cerro`
muerta (`estado_afirmado.ts:172-175`). El de "a las once" NO sigue igual:
creció (hallazgo 6).

## Hallazgos nuevos de esta ronda — verificados con prueba propia

### [MEDIO] El cierre `8d6eff7` es parcial: el escenario exacto de la ronda 13 sigue pasando — "ochocientos" inventado que coincide con un tope de la política
`src/lib/cuadra/cuadre/cifras.ts:187-196` (`cifrasSinRespaldo` ahora extrae
cardinales y los coteja) · `guardia.ts:91-104` (con `fuera.length === 0` la
guardia devuelve `forzado:false`)

El hallazgo de la ronda 13 tenía DOS direcciones: (a) un cardinal que NO
coincide con nada pasaba en silencio, y (b) un cardinal que coincide por
casualidad con un número de la política pasaba el cotejo entero. El commit
`8d6eff7` cerró (a) — su propio mensaje lo dice ("si NO coincidía con nada
respaldado")— pero el escenario (b) es el que el auditor de la 13 probó con
valores, y sigue pasando:

```
cifrasSinRespaldo("Te sobran ochocientos del anticipo y el tope del diésel es 800.",
                  [{ politica: { topes: { diesel: 800, caseta: 1500 } } }])
→ []   (todo respaldado)   ❌  — el MISMO resultado que acusó la ronda 13
```

Flujo completo: turno con `consultar_politica` y sin `cuadrar_viaje`; el modelo
narra "Te sobran ochocientos del anticipo" — 800 coincide con el tope de la
política → `fuera = []` → `guardia.ts:103` devuelve `{forzado:false}` → el
"ochocientos" que nadie calculó llega al operador. La guardia no puede saber
que el 800 salió del tope y no de una cuenta — esa es la limitación del cotejo
por coincidencia que la ronda 13 señaló, y el fix solo movió la frontera: el
cardinal sin coincidencia se caza, el que coincide no. La dirección que falta
es la que el propio hallazgo pedía: distinguir el número que el modelo DERIVA
de un número que la tool entregó como dato (p. ej. exigir que el cardinal
aparezca con el contexto del tope, o vetar cardinales sueltos en turnos que
solo consultaron política).

**Estado: abierto (cierre parcial de `8d6eff7`).**

### [MEDIO] RFA 2.9: una liquidación cuyo único hallazgo es el excedente del 15% (o la flota no elegible) sale con estatus verde "Cuadrada" — dinero NO deducible pintado como todo en orden
`src/lib/cuadra/cuadre/engine.ts:1126-1129` (`REVISAR` no incluye los tipos
nuevos; `hayDif` no los cuenta) · `src/app/dashboard/estatus.ts:18` (`cuadrada`
= `--color-ok`, verde)

Probado:

```
cuadrarViaje({ gastos: [diésel $1,000 cash con CFDI], facilidad15: true,
               totalCombustibleEjercicio: 10000, efectivoPrevEjercicio: 1400 })
→ diferencias: [efectivo_sobre_15, monto 900] · totalNoDeducible: 900
· estatus: 'cuadrada'   ❌
```

La liquidación tiene $900 NO deducibles (el excedente del 15%, LISR 27-III) y
el panel la pinta verde "Cuadrada". Igual con `efectivo_no_elegible` (flota
declaró no calificar → TODO el diésel en efectivo no deducible → estatus
'cuadrada'). La clase hermana `efectivo_sobre_tope` —la misma regla 27-III,
mismo veredicto determinista, mismo nulo margen de acción— SÍ está en
`REVISAR` (`engine.ts:1126`) y manda a 'revisar' (rojo). Peor: el caso MÁS
seguro de la matriz (sin declarar → `combustible_efectivo` → por_confirmar) sí
cae en 'revisar'; el caso MÁS caro (declaró no calificar → no deducible) cae en
verde. La asimetría está invertida respecto al fail-closed que el archivo
predica. El contralor ve la cubeta "No deducible $900" debajo de un chip verde
"Cuadrada" — la misma clase de rótulo que se lee como dos cálculos. Fix
acotado: meter `efectivo_sobre_15` y `efectivo_no_elegible` en `hayDif` (o en
`REVISAR` si se quiere la bandeja).

**Estado: abierto (introducido por `0d23f73`).**

### [MEDIO] RFA 2.9: el contador del ejercicio mezcla años — un diésel en efectivo de dic-2025 consume el tope del 15% de 2026, y la nota lo afirma
`src/lib/cuadra/cuadre/desde_db.ts:59,70-74,86-89` (la query filtra por
`fecha` del año; `efectivoDeEsteViaje` NO filtra por año y se resta del total)
· `engine.ts:319-329` (el gasto de otro ejercicio corre contra el contador del
año en curso)

Probado (cuadre de enero-2026 de un viaje con diésel en efectivo fechado
30-dic-2025; la flota declaró elegible; la query de 2026 no ve gastos de 2025):

```
totalesEjercicio = { total: 0, efectivo: 0 }   (la fecha es 2025)
efectivoDeEsteViaje = 1000                      (sin filtro de año)
previo = max(0, 0 − 1000) = 0
engine: acumulado = 1000, tope = 0.15 × 0 = 0 → efectivo_sobre_15
nota: "el ejercicio ya excede el tope del 15% ($1,000.00 vs $0.00), así que
       el excedente de $1,000.00 NO se deduce"   ❌ — contra el ejercicio 2026
totalNoDeducible = 1000
```

El gasto de 2025 se evalúa contra el contador de 2026 (que no lo ve, porque la
query filtra por fecha) y la nota afirma un excedente contra un tope de $0 —
un veredicto construido sobre el ejercicio equivocado. El aviso de
`fecha_sospechosa` ("un gasto de otro ejercicio no se deduce en este") también
dispara, y ambos conviven: uno dice que el problema es el ejercicio, el otro
afirma el 15% del ejercicio actual. El caso es la norma en enero: los cuadres
de año cruzado son exactamente lo que `fecha_dudosa.ts` documenta como
frecuente. Falta filtrar `efectivoDeEsteViaje` por el mismo año de la query (o
excluir del contador los gastos con `fecha` fuera del ejercicio).

**Estado: abierto (introducido por `0d23f73`).**

### [MEDIO] RFA 2.9: el alta de flota no puede producir el estado "sin declarar" que el motor distingue — checkbox vacío = declaró NO = todo el diésel en efectivo no deducible, y no hay edición posterior
`src/app/admin/flotas/page.tsx:37-38,174-186` (checkbox: `=== 'on'`, default
off) · `src/lib/cuadra/administracion.ts:110-120` (siempre guarda booleanos) ·
`desde_db.ts:55-58` (ambos definidos → `facilidad15 = false` si alguno es
false) · `engine.ts:331-333` (`efectivo_no_elegible`)

El diseño del motor distingue TRES estados: `true` (válvula abierta), `false`
(declaró NO → no deducible) y `undefined` (sin declarar → por_confirmar, "nada
se afirma" — el comentario de `config.ts:56-59` lo promete). El formulario solo
puede producir dos: `fd.get(...) === 'on'` devuelve `false` para un checkbox
desmarcado, y `administracion.ts:110` guarda SIEMPRE el objeto (nunca
`undefined`) porque ambos campos llegan definidos. Resultado: un admin que deja
los dos checkbox vacíos —leyendo "habilita la facilidad", no "declara bajo tu
responsabilidad que NO calificas"— crea una flota cuyo diésel en efectivo pasa
de golpe a NO DEDUCIBLE, y la nota del motor dice "la flota declaró que NO
califica" (`engine.ts:332`) cuando nadie declaró nada: un checkbox default se
leyó como declaración fiscal con consecuencias. Además **no existe ninguna ruta
para editar la declaración después del alta** (el único escritor de
`facilidadCombustibleEfectivo` es `crearFlota`; verificado por grep en todo
`src/`), así que una flota creada antes de la función (config sin la llave →
`undefined` → todo el diésel en efectivo en "por confirmar" para siempre) no
tiene manera de declararse elegible, y una flota mal declarada no se corrige.
El fix mínimo: un tercer estado explícito en el formulario ("no declarar
ahora") o tratar `false` de un checkbox como no-declaración salvo confirmación
expresa, más una pantalla de edición.

**Estado: abierto (introducido por `0d23f73`).**

### [MEDIO] RFA 2.9: el cuadre entero ahora depende de un scan del ejercicio completo — >100,000 gastos/año tumba TODA guardia con cifras, cerrado y en silencio
`src/lib/cuadra/cuadre/desde_db.ts:61-84` (query del año vía `traerTodo`) ·
`src/lib/cuadra/pg.ts:48` (`MAX_PAGINAS = 100`) · `guardia.ts:110-118` (el
catch devuelve el mensaje genérico)

`cuadrarDesdeDB` corre en (a) la tool `cuadrar_viaje`, (b) la guardia de cifras
de CADA turno donde el modelo narra números sin tool de cuadre. Antes del
deber ser, esa función leía solo los gastos del viaje; ahora lee TODOS los
gastos de combustible del tenant en el año, paginados de 1,000 en 1,000 con un
tope de 100 páginas. Un tenant con >100,000 cargas de combustible al año —una
flota mediana de ~300 tractores: 300 × 365 × 1 diésel/día ≈ 110,000— hace que
`traerTodo` lance (`pg.ts:86`: "lectura incompleta"), `cuadrarDesdeDB` truene
y TODA guardia con cifras caiga al fail-closed "Dame un momento para cerrar
bien tu cuadre y te confirmo los números" — para siempre, sin log distinguible
para el operador. El límite viejo (`getAcumuladoCombustible`, `repo.ts:802`)
tenía el MISMO techo pero era best-effort (try/catch en `tools.ts:105-110`,
"si la consulta falla, el cuadre sale igual"); el nuevo es obligatorio en el
camino del dinero. No se ve en el demo (2 gastos); es el techo de escala que
la implementación nueva metió al camino crítico. Fix: agregar el `sum()` en SQL
(que el propio `pg.ts:86` recomienda) o degradar el contador a best-effort.

**Estado: abierto (introducido por `0d23f73`).**

### [MEDIO→BAJO] El fix `438c8f4` (1-10 al portón) ensanchó el falso positivo de horas/fechas: "a las once" era 1 palabra, ahora "a las cinco", "salgo el seis", "el diez" también disparan el reemplazo
`src/lib/cuadra/cuadre/cifras.ts:41-46` (`CARDINAL_SUELTO` ahora incluye
dos..diez) · `guardia.ts:83` (early return con `tieneCifrasDeDinero`)

La ronda 13 dejó anotado como BAJO que "Llego a las once, ¿te parece?"
disparaba el reemplazo determinístico. El fix que la propia ronda 13 aplicó
para atrapar "diez"/"cinco" como montos (`438c8f4`) metió los cardinales 2-10
al mismo regex, y con ellos el falso positivo se multiplicó. Probado:

```
tieneCifrasDeDinero("Llego a las cinco de la tarde.")  → true  ❌
tieneCifrasDeDinero("Salgo el seis por la mañana.")     → true  ❌
tieneCifrasDeDinero("El diez llego a Silao.")           → true  ❌
```

`NO_ES_DINERO` no cubre "a las cinco" ni "salgo el seis" (solo "horas" pegado,
y aquí no aparece). Un turno conversacional —"¿a qué hora llegas?" → "llego a
las cinco"— sale reemplazado por el cuadre del motor. La doctrina del archivo
tolera el falso positivo ("el reemplazo es correcto y hasta más útil"), pero
para "¿a qué hora llegas?" un cuadre no es más útil — el propio comentario de
la ronda 13 lo reconocía para "once". La clase entera se cierra con el patrón
`(?:a\s+las|el|al)\s+(dos|tres|…|diez|once|…)\b` en `NO_ES_DINERO`.

**Estado: abierto (ensanchado por el propio cierre `438c8f4`).**

### [BAJO] RFA 2.9: la nota "deducible por la facilidad del 15%" se imprime también sobre un gasto SIN CFDI, cuya cubeta real es "por confirmar"
`src/lib/cuadra/cuadre/engine.ts:312` (nota) · `engine.ts:108-111` (`cubetaDe`:
sin `cfdiUuid` → por_confirmar)

Probado: diésel en efectivo de $1,000 SIN factura, flota elegible, dentro del
15% → la diferencia `combustible_efectivo_dentro15` lleva la nota "…
deducible por la facilidad del 15% (RFA 2026 regla 2.9)…" mientras
`totalPorConfirmar = 1000` (el ticket sin timbrar no ampara deducción, LISR
27-III). El mismo papel dice "deducible" en la nota y "Por confirmar — falta
timbrar" en la cubeta. El dinero está bien; la frase afirma de más. El test
nuevo del commit lo evita a propósito (comenta "sin CFDI… la facilidad no
aplica") pero no probó la nota. Fix: condicionar la palabra "deducible" a
`g.cfdiUuid` (o que la nota diga "deducible una vez timbrado").

**Estado: abierto (introducido por `0d23f73`).**

### [BAJO] RFA 2.9: la nota del excedente repite el excedente ACUMULADO del ejercicio por cada comprobante, a veces mayor que el propio comprobante
`src/lib/cuadra/cuadre/engine.ts:325` (`monto: excedente`, donde `excedente` es
el acumulado del ejercicio)

Probado con dos comprobantes de $1,000 (previo $1,400, tope $1,500):

```
N1 (gasto 1): "…el excedente de $900.00 NO se deduce…"   (acumulado 2,400)
N2 (gasto 2): "…el excedente de $1,900.00 NO se deduce…" (acumulado 3,400)
```

El gasto 2 vale $1,000 y su nota afirma un excedente de $1,900 — el acumulado
del ejercicio, no el suyo. Las cubetas son correctas (900+1,000 no deducibles,
probado); el problema es la nota: un lector que suma las dos frases obtiene
$2,800, y cada gasto repite un total que crece. La diferencia de la ronda
anterior en este rubro se pagó por notas que se leen como el cálculo; esta se
lee como el cálculo equivocado. Fix: `monto` y nota por gasto (el marginal),
dejando el acumulado solo en la primera frase.

**Estado: abierto (introducido por `0d23f73`).**

### [BAJO] La ficha `rfa-2026-2.9.yaml` sigue diciendo que el contador del 15% "no existe" — la misma clase del BAJO de `conv.ts` que la ronda 12 cerró
`normas/rfa-2026-2.9.yaml:45-47` (`pendiente_en_producto`: "El CONTADOR del
15% por ejercicio no existe todavía. Hoy el motor avisa que hay que contarlo
pero no lleva la cuenta.")

`0d23f73` implementó exactamente ese contador (desde_db + engine). La ficha —
la fuente de verdad que las normas citan— quedó describiendo el producto antes
del cambio, y `usado_en_codigo` tampoco menciona las líneas nuevas. Es el
mismo patrón "comentario que ya no describe el código" que la ronda 12 cerró en
`conv.ts` y que este rubro ha perseguido tres rondas: la ficha es lo que se lee
para entender qué hace el motor, y esta dice que no hace lo que hace.

**Estado: abierto (introducido por `0d23f73`).**

### [BAJO] `cardinalesEnPalabras` mal-parsea "X mil": "ocho mil" → 1008, "quinientos mil" → 1500, "dos mil ochocientos" → 1802 — el cotejo verifica contra el número equivocado
`src/lib/cuadra/cuadre/cifras.ts:220-221` (la regla `vj > suma || v >= 1000 ?
suma + vj` suma "mil" en vez de multiplicar)

Probado:

```
cardinalesEnPalabras("ocho mil")           → [1008]  (debería ser 8000)
cardinalesEnPalabras("quinientos mil")     → [1500]  (debería ser 500000)
cardinalesEnPalabras("dos mil ochocientos")→ [1802]  (debería ser 2800)
cardinalesEnPalabras("mil ochocientos")    → [1800]  ✓ (este sí)
```

El comentario dice "sin parseador completo es mejor verificar de más (un
compuesto mal sumado cae a 'fuera')" — y es cierto para la dirección de que el
valor correcto esté en la política: 8000 no coincide con 1008 → fuera →
cazado. El riesgo es la coincidencia: "quinientos mil" parseado como 1500 pasa
como respaldado si la política trae un 1,500 (el tope de caseta del demo y del
seed es exactamente 1500). El parseo de "mil" es una multiplicación, no una
suma; la regla correcta es barata de escribir.

**Estado: abierto (introducido por `8d6eff7`).**

### [BAJO] Dos implementaciones del contador del 15% con filtros distintos: `getAcumuladoCombustible` (vieja) vs `desde_db.ts` (nueva) pueden divergir, y la vieja sigue alimentando la narrativa del modelo
`src/lib/cuadra/repo.ts:825` (filtra SOLO `concepto = 'diesel'`) ·
`src/lib/cuadra/cuadre/desde_db.ts:70-73` (filtra `concepto = diesel` O
`clave_prod_serv` en la lista) · `tools.ts:104-112` (la capa vieja sigue
inyectando `combustible_efectivo_ejercicio` y el permiso de citar `rfa-2026-2.9`
al resultado de `cuadrar_viaje`)

Un gasto con concepto 'otro' pero `clave_prod_serv` de combustible cuenta en el
contador nuevo y no en el viejo; el modelo recibe dos cifras del mismo 15% que
pueden no coincidir. Además la capa vieja computa `estado 'cerca'/'excedido'`
**sin mirar la declaración de elegibilidad**: para una flota que declaró NO
elegible (el motor ya tiró todo el efectivo a no deducible vía
`efectivo_no_elegible`), el resultado de la tool sigue diciendo "te quedan
$X de margen antes de perder la deducción (RFA 2026 regla 2.9)" — dos capas
del mismo producto afirmando cosas opuestas sobre el mismo hecho. La guardia
reemplaza el texto del modelo en el turno de cuadre, así que el aviso viejo no
llega al operador; el riesgo es el modelo citándolo a mitad de turno y el
permiso de cita extra (`tools.ts:112`) que se concede sin relación con el
veredicto del motor. Unificar: que `desde_db.ts` sea la única fuente y la capa
vieja desaparezca o lea el mismo filtro + eligibilidad.

**Estado: abierto (preexistente, agravado por `0d23f73`).**

## Lo que revisé y está bien (sin tocar)

- **La matriz del 15% en el motor** (`engine.ts:299-334`): los 5 casos de
  `engine.test.ts` + probes propios — elegible+dentro → deducible (1,000/0);
  elegible+excede → proporción exacta (100 deducible / 900 no, cubetas suman
  el comprobado al centavo); no elegible → 1,000 no deducible; sin declarar →
  por_confirmar con nota que no promete. La frontera por PROPORCIÓN reusa el
  mecanismo del tope de alimentación y no depende del orden del arreglo
  (verificado con dos comprobantes y previo ya sobre el tope: 900+1,000).
- **`SIN_ACREDITAMIENTO`** (`engine.ts:956`): los 3 tipos nuevos entran —
  dentro del 15% nunca acredita IVA ni IEPS (probado: `ivaAcreditable = 0`).
- **`cubetaDe`** (`engine.ts:97-111`): `efectivo_no_elegible` en
  NO_DEDUCIBLE_ISR, `combustible_efectivo` en POR_CONFIRMAR — la decisión
  sigue viviendo en un solo lugar.
- **`por_diferencia.ts` + índice + fichas**: los 3 tipos nuevos tienen norma
  (`rfa-2026-2.9`, `lisr-27-fr-III`); `normas_sincronizadas.test.ts` verde.
- **`cierre_aviso.ts:142-144`**: rutas sensatas — dentro15 al panel
  (informativo), sobre15/no_elegible a decisión.
- **`guardia.ts`** intacta: `cuadro`/`cerro`/`consultoPolitica` separados, el
  snapshot AG-3 del cierre, `'operador'` explícito en `resumenCuadre`.
- **El camino feliz del demo no toca la válvula del 15%**: el diésel del seed
  es `forma_pago '03'` (transferencia), no `'01'`; la facilidad declarada en el
  seed (`dedicacionExclusivaCarga:true, regimenElegible:true`) no produce
  ninguna diferencia nueva en la sala. Foto → "listo" → cuadre → PDF intacto.
- **Cierres de la 13 verificados** (tabla de arriba) y arneses
  `processor_cadena/cierre` actualizados para la query nueva (`0fa305e`) —
  suites verdes.
- **El prompt del agente** (`src/lib/agents/prompts.ts`) no promete nada sobre
  el 15%: lo aprende de las tools. Sin texto stale.
- **Suites**: 307 (cuadre+normas+guardia+resumen) y 173 (engine+loop-guard+
  tool-executor+conv+presupuesto+processor) verdes. `eslint` limpio sobre los
  archivos del rubro.

## Lo que no alcancé a revisar

- **No corrí `tsc --noEmit` full ni la suite completa**: otro subagente está
  trabajando en paralelo sobre el mismo repo (vi archivos temporales suyos
  aparecer y desaparecer durante la sesión) y el PROMPT-BASE pide no pisar la
  suite completa.
- **No medí en la base real** el tiempo de la query del ejercicio (el hallazgo
  de escala es por lectura del código y de `pg.ts`, no por cronómetro).
- **No vi el render del PDF** con los tipos nuevos (notas del 15% en el papel):
  requiere build/preview, y el rubro frontend/fiscal lo cubre.
- **`huerfanos.ts`, loop-guard de `openrouter.ts`, `tool-executor.ts`**: sin
  cambios desde la ronda 13 (verificado por `git log` por archivo), no los
  re-leí línea por línea.
- **El comportamiento de la 0082 contra la base real** (rubro datos): verifico
  el SQL, no su aplicación.

## Veredicto

**Green light para el demo, con la misma condición de siempre y una deuda que
volvió a crecer.**

El camino feliz del guion —fotos → "listo" → cuadre → PDF— sigue protegido por
la guardia más fuerte del sistema (`guardiaCifras` reemplaza SIEMPRE el texto
del modelo cuando hubo `cuadrar_viaje`/`guardar_liquidacion`, `guardia.ts:83-114`),
y el diésel del seed es electrónico: la válvula del 15% —con sus notas y su
contador nuevos— no se enciende en la sala. Los tres cierres de la ronda 13
que atacaron las regresiones de guardiaEstado y el portón 1-10 son reales
(probados contra el código actual). El motor de la RFA 2.9 hace lo que la
matriz del deber ser promete, con el dinero correcto al centavo en los casos
que probé.

La salvedad, otra vez, es la clase que este proyecto ya pagó cuatro rondas:
**un fix que se queda a medias** (el cotejo de cardinales cerró la dirección
que no era la probada por la ronda 13) y **un rótulo que se lee distinto de lo
que es** (estatus verde "Cuadrada" con $900 no deducibles; la nota "deducible
por la facilidad" sobre un ticket sin timbrar; el excedente acumulado repetido
por comprobante). La implementación nueva metió dos MEDIO al camino del dinero
(estatus y año cruzado) y un techo de escala al cuadre entero. Ninguno se ve
en la sala; todos se verán en el primer cliente con diésel en efectivo de
enero, o con una flota de 300 unidades.

Recomendación para la ronda 15, en orden: (1) `efectivo_sobre_15` y
`efectivo_no_elegible` en `hayDif` (o REVISAR); (2) filtrar por año
`efectivoDeEsteViaje`; (3) el formulario de alta con tercer estado y edición
posterior; (4) `(?:a\s+las|el|al)\s+(dos|…|diez|once|…)\b` en `NO_ES_DINERO`;
(5) el parseo de "mil" en `cardinalesEnPalabras`; (6) la nota del dentro15 sin
CFDI. Los seis con fix acotado y prueba escribible.
