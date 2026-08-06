# Sistema agéntico y orquestación — auditoría 15

**Nota: 7/10** (movimiento: 8 → 7, bajó). La ronda 14 cerró **tres de sus
recomendaciones de verdad** — verificadas hoy contra el código ACTUAL (`8a33ce1`
+ `d7b171f`, HEAD `d7b171f`) con probes propios: (1) `efectivo_sobre_15` y
`efectivo_no_elegible` ya están en `REVISAR` y la liquidación sale **roja**
"Por revisar", no verde (probado: `estatus: 'revisar'` en ambos casos); (2) el
excedente del 15% se reporta POR COMPROBANTE y la suma de la columna cuadra con
`totalNoDeducible` (probado: 3×$1,000, tope $1,500 → suma $1,500 = no deducible,
cada nota ≤ $1,000); (3) el alta de flota tiene tercer estado (sin declarar) y
pantalla de edición. **Pero** la deuda vuelve a crecer en la misma clase, y
ahora con una variante peor: el fix del hallazgo de escala (`desde_db.ts:71-77`)
convirtió un fail-closed honesto —la guardia caía al mensaje neutral— en **una
nota fiscal falsa sobre datos no medidos** —cuando el contador del 15% no carga,
el motor recibe ceros y afirma "el ejercicio lleva $1,000.00 contra un tope de
$0.00 (15% de $0.00); el excedente de $1,000.00 NO se deduce", moviendo dinero
deducible a la cubeta NO deducible. El comentario del propio fix promete "la
rama 'sin datos del ejercicio' marca el efectivo para revisar" (`desde_db.ts:74`)
y **esa rama no existe** (grep en todo `engine.ts`). Y el cierre del año cruzado
quedó a medias: la dirección que la recomendación #2 de la 14 pedía filtrar
(`efectivoDeEsteViaje` sin filtro de año) sigue viva para el caso normal de
enero —un viaje de 2026 con un gasto de dic-2025— y produce exactamente la misma
nota falsa. La capa narrativa del mismo producto (`avisoTope15`, caso
`sin_criterio`) sí sabe decir "no se pudo calcular el total… no se evaluó"; el
camino del dinero no.

> Método: leí línea por línea `desde_db.ts`, `engine.ts` (zona 15% + estatus),
> `tools.ts`, `periodo/aviso.ts`, `administracion.ts`, `admin/flotas/page.tsx`,
> `admin/compliance/page.tsx`, `repo.ts` (802-880, 920-976), `guardia.ts`,
> `cifras.ts`, `resumen.ts`, `cierre_aviso.ts`, `por_diferencia.ts`, `config.ts`,
> `processor.ts` (zona ARCO y PDF) y el diff completo `0fa305e..d7b171f` del
> rubro. Cada hallazgo se **probó** con probes temporales (`zzz-a15-probe`/
> `zzz-a15b`, borrados al terminar). Suites del rubro en verde (95 + 162 + 499 +
> 81 + 72 = 909 pruebas en los archivos agénticos), `eslint` sin cambios de
> estilo. Sha: `d7b171f`.

## Los cierres de la ronda 14 — verificados contra el código actual

| Hallazgo ronda 14 | Commit de cierre | Estado hoy | Cómo se verificó |
|---|---|---|---|
| [MEDIO] estatus verde "Cuadrada" con $900 no deducibles (excedente 15% / flota no elegible) | `8a33ce1` | **Cerrado** | `engine.ts:1133` — ambos tipos en `REVISAR`. Probe: `cuadrarViaje({facilidad15:true, totalCombustibleEjercicio:10000, efectivoPrevEjercicio:2000, gastos:[1×$1,000 cash]})` → `estatus:'revisar'`; `facilidad15:false` → `estatus:'revisar'`. Tests nuevos en `engine.test.ts` (auditoría 14). |
| [MEDIO] excedente CUMULATIVO repetido por comprobante | `8a33ce1` | **Cerrado** | `engine.ts:308-333` — `excedenteDeEste = max(0, g.monto − cupoRestante)`. Probe: 3×$1,000, tope $1,500 → notas marginales $500 (gasto 2) y $1,000 (gasto 3); suma $1,500 = `totalNoDeducible`; cada `d.monto ≤ g.monto`. |
| [MEDIO] alta de flota sin estado "sin declarar" + sin edición | `8a33ce1`+`d7b171f` | **Cerrado (con dos residuales, ver hallazgos 7 y 8)** | `administracion.ts:110-120` escribe SOLO con ambos booleanos; `admin/flotas/page.tsx:38-39` manda `true|undefined`; pantalla de edición `accionFacilidad` + `actualizarFacilidad15` (`repo.ts:920-928`) con tercer estado "—". |
| [MEDIO] año cruzado: gasto de dic-2025 consume el tope de 2026 | `8a33ce1` | **Cierre PARCIAL** | El ancla cambió de "año de hoy" a "año del viaje" (`desde_db.ts:63-66`): la dirección "viaje de dic cerrado en enero" quedó arreglada (probe P2b: contador 2025 lo ve, tope $150, excedente $850 — correcto). La dirección "viaje de 2026 con gasto de dic-2025" —la que la recomendación #2 pedía filtrar en `efectivoDeEsteViaje`— sigue intacta. Ver hallazgo 1. |
| [MEDIO] escala: >100,000 gastos/año tumba TODA guardia | `8a33ce1` | **Cerrado en la letra, con modo de falla peor** | `desde_db.ts:70-77` — `getAcumuladoCombustible` best-effort con try/catch. La guardia ya no cae al mensaje neutral; pero con ceros el motor produce una nota fiscal falsa (ver hallazgo 2). El comentario promete una rama "sin datos del ejercicio" que NO existe. |
| [BAJO] nota "deducible por la facilidad" sobre gasto SIN CFDI | — | **Abierto** | `engine.ts:326` sin condición de `cfdiUuid`. Probe P3: `totalPorConfirmar: 1000, totalDeducible: 0`, nota "deducible por la facilidad del 15%". Ver hallazgo 3. |
| [MEDIO→BAJO] "a las cinco"/"salgo el seis" (falso positivo del portón 1-10) | — | **Abierto** | `cifras.ts:41-48` sin cambios desde la 13. Probe G1: los tres `true`. Ver hallazgo 4. |
| [MEDIO] "ochocientos" coincidente con un tope pasa el cotejo | — | **Abierto** | `cifras.ts:187-196` + `guardia.ts:102-104` sin cambios. Probe G2: `fuera: []`. Ver hallazgo 5. |
| [BAJO] `cardinalesEnPalabras` mal-parsea "X mil" | — | **Abierto** | `cifras.ts:220` sin cambios. Probe G3: "ocho mil"→1008, "quinientos mil"→1500. Ver hallazgo 6. |
| [BAJO] ficha `rfa-2026-2.9.yaml` dice que el contador "no existe" | — | **Abierto** | `normas/rfa-2026-2.9.yaml:45-47` sin tocar (último commit `e5d6b46`, anterior a `0d23f73`). Ver hallazgo 6 (de la 14, sigue). |
| [BAJO] dos implementaciones del contador con filtros distintos | `8a33ce1` | **Cierre PARCIAL** | Misma función (`getAcumuladoCombustible`), pero `tools.ts:104-105` la llama SIN claves y con el año actual; `desde_db.ts:78-79` CON claves y con el año del viaje. La divergencia se redujo, no se eliminó. Ver hallazgo 9. |

Los cierres de la ronda 13 (negación de oración, pregunta sin "¿", portón 1-10,
cardinales sin coincidencia) se mantienen: `cifras.ts`, `guardia.ts`,
`estado_afirmado.ts`, `fecha_dudosa.ts` no cambiaron desde `e048de1`/`8d6eff7`/
`438c8f4` (verificado por `git log` por archivo) y sus suites pasan (95 pruebas
en guardia+cifras+estado_afirmado).

## Hallazgos nuevos / verificados con prueba propia

### [MEDIO] El cierre del año cruzado es parcial: un gasto de dic-2025 dentro de un viaje de enero-2026 sigue corriendo contra el contador de 2026, ahora con el ancla del viaje — y deflacta el contador previo de 2026
`src/lib/cuadra/cuadre/desde_db.ts:63-66` (el ancla es `viaje.fechaInicio`, no el
año del comprobante) · `desde_db.ts:84-87` (`efectivoDeEsteViaje` **sin filtro de
año**, idéntico al de la 14) · `engine.ts:310-315` (`acumulado` suma el gasto sin
mirar su `fecha`)

El fix de la 14 cambió el ancla de "hoy" a "el viaje", que arregla la dirección
"viaje de dic-2025 procesado en enero-2026" (P2b: contador 2025, tope $150,
excedente $850 — correcto). Pero la otra dirección —**la que la propia
recomendación #2 de la 14 pedía filtrar**— sigue viva y es la normal de enero:
un viaje que EMPIEZA en 2026 cargando un comprobante de dic-2025. Probado:

```
viaje enero-2026 (ancla → anioEjercicio = 2026) · gasto: diésel en efectivo
$1,000 fechado 30-dic-2025 · query 2026 no lo ve → totalesEjercicio = {0, 0}
efectivoDeEsteViaje = 1000 (sin filtro de año) → previo = max(0, 0−1000) = 0
engine: acumulado = 1000, tope = 0.15 × 0 = 0 → efectivo_sobre_15
nota: "el ejercicio lleva $1,000.00 de combustible en efectivo contra un tope
      de $0.00 (15% de $0.00); el excedente de $1,000.00 de ESTE comprobante
      NO se deduce"   ❌ — el MISMO texto que acusó la ronda 14
```

Y peor que en la 14: cuando el contador de 2026 SÍ tiene datos (p. ej. $2,000
de otras liquidaciones), `efectivoDeEsteViaje` resta $1,000 de un contador que
nunca lo incluyó → `efectivoPrevEjercicio = 1000` en vez de 2000 → el gasto de
2025 **consume $1,000 del cupo de 2026** y además **deflacta el contador previo
de 2026 en $1,000**, dejando que la próxima liquidación de 2026 deduzca $1,000
más de efectivo del que la ley permite. El `fecha_sospechosa` (`engine.ts:397`,
"un gasto de otro ejercicio no se deduce en este") dispara a la vez, y ambas
notas conviven afirmando ejercicios distintos sobre el mismo ticket — exactamente
la coexistencia que la 14 documentó. Fix acotado que ya estaba escrito en la
recomendación #2: filtrar `efectivoDeEsteViaje` por el año de `anioEjercicio`.

**Estado: abierto (cierre parcial de `8a33ce1`).**

### [MEDIO] Contador del 15% caído (best-effort) → el motor afirma "el excedente NO se deduce" contra un tope de $0 que no se midió, y el dinero sale de la deducción — la rama honesta que el comentario promete no existe
`src/lib/cuadra/cuadre/desde_db.ts:71-77` (try/catch → ceros + comentario "la
rama 'sin datos del ejercicio' marca el efectivo para revisar") ·
`engine.ts:313-330` (sin rama 'sin datos del ejercicio': `tope = 0.15 × total`
con `total = 0` → todo cash diésel cae a `efectivo_sobre_15`) ·
`resumen.ts:69-70` (la guardia narra las notas al operador)

Probado (P1) — exactamente lo que `desde_db.ts` produce cuando
`getAcumuladoCombustible` lanza (tenant >100,000 cargas/año —el techo
documentado en `repo.ts:807-808`— o cualquier bache de red en el momento del
turno):

```
cuadrarViaje({ facilidad15: true, totalCombustibleEjercicio: 0,
               efectivoPrevEjercicio: 0, gastos: [diésel cash $1,000 con CFDI] })
→ diferencias: [efectivo_sobre_15, monto 1000] · totalNoDeducible: 1000
· estatus: 'revisar'
· nota: "el ejercicio lleva $1,000.00 de combustible en efectivo contra un tope
        de $0.00 (15% de $0.00); el excedente de $1,000.00 de ESTE comprobante
        NO se deduce (RFA 2026 regla 2.9)"
```

Tres problemas en uno: (a) la nota presenta como MEDIDA una base que no se pudo
medir —el $0.00 no es "el ejercicio no tiene combustible", es "el contador no
cargó"— y afirma un veredicto fiscal ("NO se deduce") sobre ese dato; (b) la
cubeta mueve $1,000 de deducible a NO deducible por la misma causa, sin señal
visible para el contralor salvo la nota; (c) el comentario del propio fix
(`desde_db.ts:74`) promete una rama "sin datos del ejercicio" que **no existe**
en `engine.ts` (grep: la única mención es el comentario). La capa narrativa del
mismo feature es honesta: `evaluarTope15` devuelve `sin_criterio` para
`total <= 0 && efectivo > 0` (`periodo/combustible.ts:56-58`) y `avisoTope15`
dice "no se pudo calcular el total de combustible del ejercicio, así que no se
evaluó el 15%". El camino del dinero no heredó esa rama. Nota: el fix de la 14
al hallazgo de escala mejoró la disponibilidad (la guardia ya no cae al mensaje
genérico) pero **empeoró el modo de falla**: antes el operador recibía "Dame un
momento…" (sin cifras); ahora recibe una cifra fiscal afirmada sobre datos que
no existen. Fix: rama `total === 0 && efectivo > 0` en el motor → diferencia
`combustible_efectivo` (por_confirmar) o una nota `sin_criterio` como la de la
capa narrativa, sin tocar cubetas.

**Estado: abierto (introducido por el propio cierre `8a33ce1`).**

### [BAJO] La nota "deducible por la facilidad del 15%" se sigue imprimiendo sobre un gasto SIN CFDI, cuya cubeta real es "por confirmar" — sin tocar desde la 14
`src/lib/cuadra/cuadre/engine.ts:326` (nota incondicional) · `engine.ts:123`
(`cubetaDe`: sin `cfdiUuid` → por_confirmar)

Probado (P3): diésel en efectivo $1,000 SIN factura, flota elegible, dentro del
15% → `totalPorConfirmar: 1000`, `totalDeducible: 0`, y la nota dice "…
deducible por la facilidad del 15% (RFA 2026 regla 2.9): el ejercicio lleva
$1,500.00 de $10,000.00…". La recomendación #6 de la 14 (condicionar a
`g.cfdiUuid` o decir "deducible una vez timbrado") no se aplicó. El dinero está
bien; la frase afirma de más, y es de las que llegan al papel y al WhatsApp.

**Estado: abierto (preexistente, recomendación #6 de la 14 sin aplicar).**

### [MEDIO→BAJO] El portón 1-10 sigue ensanchando el falso positivo de horas/fechas: "a las cinco", "salgo el seis", "el diez" disparan el reemplazo — sin tocar desde la 13
`src/lib/cuadra/cuadre/cifras.ts:41-48` (`CARDINAL_SUELTO` incluye dos..diez ·
`NO_ES_DINERO` sin el patrón `(?:a\s+las|el|al)\s+(dos|…|diez|once|…)`)

Probe G1 (código actual): `tieneCifrasDeDinero("Llego a las cinco de la
tarde.")` → `true`; `"Salgo el seis por la mañana."` → `true`; `"El diez llego a
Silao."` → `true`. La recomendación #4 de la 14 —cerrar la clase entera con el
patrón en `NO_ES_DINERO`— no se aplicó; el patrón sigue siendo solo "horas"
pegado. Un "¿a qué hora llegas?" → "llego a las cinco" sigue recibiendo el
cuadre determinístico del motor.

**Estado: abierto (preexistente).**

### [MEDIO] El escenario exacto de la 13 ("ochocientos" inventado que coincide con un tope) sigue pasando el cotejo completo — sin tocar
`src/lib/cuadra/cuadre/cifras.ts:187-196` · `guardia.ts:102-104` (`fuera.length
=== 0` → `forzado:false`)

Probe G2 (el MISMO del reporte de la 13):

```
cifrasSinRespaldo("Te sobran ochocientos del anticipo y el tope del diésel es 800.",
                  [{ politica: { topes: { diesel: 800, caseta: 1500 } } }])
→ []   ❌ — todo respaldado; el "ochocientos" que nadie calculó llega al operador
```

Ninguno de los archivos cambió desde `8d6eff7`. La recomendación de la 14 era
distinguir el número que el modelo DERIVA del que la tool entregó (vetar
cardinales sueltos en turnos que solo consultaron política, o exigir el contexto
del tope). Sigue sin hacerse.

**Estado: abierto (cierre parcial de `8d6eff7`, sin avance desde la 14).**

### [BAJO] `cardinalesEnPalabras` sigue mal-parseando "X mil" y la ficha `rfa-2026-2.9.yaml` sigue negando que el contador exista
`src/lib/cuadra/cuadre/cifras.ts:220` (regla `vj > suma || v >= 1000 ? suma +
vj`) · `normas/rfa-2026-2.9.yaml:45-47`

Probe G3 (código actual): "ocho mil" → `[1008]`, "quinientos mil" → `[1500]`,
"dos mil ochocientos" → `[1802]`; "mil ochocientos" → `[1800]` (el único
correcto). La coincidencia por casualidad con un tope real de la política
(caseta $1,500 en el demo y el seed) sigue siendo el riesgo. Y la ficha —la
fuente que las normas citan— sigue diciendo "El CONTADOR del 15% por ejercicio
no existe todavía. Hoy el motor avisa que hay que contarlo pero no lleva la
cuenta", cuando `desde_db.ts` + `engine.ts` lo implementan desde `0d23f73`. La
recomendación de la 14 (reescribir la ficha con el contador y `usado_en_codigo`)
no se aplicó; el último commit del archivo es `e5d6b46`, anterior al deber ser.

**Estado: abierto (ambos, preexistentes).**

### [BAJO] La edición parcial de la declaración del 15% borra TODA la declaración previa y el mensaje dice "actualizada"
`src/app/admin/flotas/page.tsx:57-58,69` (`ded`/`reg` independientes; mensaje
según `ded !== undefined`) · `src/lib/cuadra/repo.ts:924-928` (`actualizarFacilidad15`:
si NO llegan ambos definidos → `delete` de la llave completa)

Escenario: una flota con `{dedicacionExclusivaCarga: true, regimenElegible:
true}`; el superadmin cambia solo "Carga" a "No" y deja "Régimen" en "—"
(pensando que conserva lo anterior). Resultado: `ded=false`, `reg=undefined` →
`actualizarFacilidad15` borra la llave entera → la flota pasa de "elegible" a
"sin declarar" (todo su diésel en efectivo sale a por_confirmar desde la
siguiente liquidación) — y el mensaje de éxito dice "Declaración del 15%
actualizada." (`page.tsx:69`). El mensaje solo es cierto cuando ambos campos
llegan definidos; el comportamiento de borrado silencioso de una declaración
fiscal previa no pide confirmación ni avisa del efecto. El residual de la 14
arregló el estado "sin declarar" del alta, pero la edición introdujo este
tropezón nuevo en la misma pantalla.

**Estado: abierto (introducido por `d7b171f`).**

### [BAJO] La pantalla ARCO de la flota promete "El titular recibió su respuesta por WhatsApp" — y nada se envía
`src/app/admin/compliance/page.tsx:45` (mensaje de éxito) · `src/lib/cuadra/repo.ts:969-976` (`resolverSolicitudArco` solo hace `UPDATE` en `solicitud_arco`)

El único envío del flujo ARCO es el acuse de `atenderPrivacidad`
(`processor.ts:150`, `respuestaPrivacidad` — "queda registrada tu solicitud").
La RESOLUCIÓN que escribe el superadmin en `/admin/compliance` queda en la DB y
nadie la manda al titular; el mensaje de éxito afirma lo contrario ("recibió su
respuesta por WhatsApp"). Es el mismo rótulo que se lee distinto de lo que es,
en la pantalla que la 14 construyó para que la flota cumpliera su obligación de
respuesta (LFPDPPP art. 32). Nota para el rubro legal: el comentario de la misma
página dice "20 días hábiles (LFPDPPP art. 32)" mientras `venceArco` y el test
usan 15 (el art. 32 son 15 hábiles, prorrogables 5 más con aviso) — que lo
arbitre legal.

**Estado: abierto (introducido por `d7b171f`).**

### [BAJO] La "unificación" del contador quedó a medias: misma función, argumentos distintos — año y claves
`src/lib/cuadra/tools.ts:104-105` (`getAcumuladoCombustible(ctx.tenantId,
ejercicio)` con el AÑO ACTUAL y SIN claves) · `desde_db.ts:78-79`
(`getAcumuladoCombustible(tenantId, Number(anioEjercicio), clavesCombustible)`
con el año del viaje y CON claves)

Un gasto con `concepto='otro'` pero `clave_prod_serv` de combustible cuenta en
el motor y no en la capa de periodo; y en enero, un viaje de dic-2025 cuadrado
en 2026: el motor evalúa contra 2025 mientras la tool narra "Diésel en efectivo
**2026**: te quedan $X…". El fix de la 14 eliminó la segunda implementación pero
no los criterios divergentes —el comentario del fix ("una sola barrida del
ejercicio, no dos consultas duplicadas con criterios que podían divergir",
`desde_db.ts:67-69`) describe la intención, no el resultado. La guardia
reemplaza el texto en el turno de cuadre, así que el riesgo es el modelo citando
la cifra de 2026 a mitad de turno sobre un cuadre de 2025.

**Estado: abierto (cierre parcial de `8a33ce1`).**

### [BAJO] Los fixes de la 14 en la capa admin/narrativa no tienen pruebas: `avisoTope15` con `elegible:false/undefined` y `actualizarFacilidad15` sin test
`src/lib/cuadra/periodo/aviso.test.ts` (los tests existentes solo pasan `true`
como tercer argumento — el diff de la 14 los tocó para eso y nada más) ·
`src/lib/cuadra/administracion.test.ts` (sin casos del tercer estado de
`crearFlota`) · `actualizarFacilidad15`: cero referencias en `*.test.ts`

La rama nueva que la 14 introdujo —el aviso para flota que declaró NO
(`avisoTope15` con `elegible === false`) y para la que no declaró
(`undefined`)— es justo la que el hallazgo ALTO pedía, y no la ejercita ninguna
prueba; si alguien la rompe mañana, la suite no se entera. Los fixes del motor
(estatus, excedente) SÍ tienen tests; los de la capa de aviso y admin no.

**Estado: abierto (introducido por `8a33ce1`/`d7b171f`).**

## Lo que revisé y está bien (sin tocar)

- **Estatus del dinero NO deducible** (`engine.ts:1133-1135`): `efectivo_sobre_15`
  y `efectivo_no_elegible` en `REVISAR` → chip rojo "Por revisar"
  (`dashboard/estatus.ts:20`). Probes P4/P5 + tests nuevos de `8a33ce1`.
- **Excedente por comprobante** (`engine.ts:308-333`): el marginal se calcula
  contra `cupoRestante = max(0, tope − previoSinEste)`; `proporcionDeducible` por
  gasto; la suma de la columna cuadra con `totalNoDeducible` (P4: $1,500 = $1,500).
  No depende del orden del arreglo (mismo mecanismo de proporción del tope de
  alimentación).
- **El alta de flota con tres estados**: `administracion.ts:110-120` solo escribe
  con ambos booleanos; `admin/flotas/page.tsx:38-39` manda `true|undefined`;
  la edición (`accionFacilidad` + `actualizarFacilidad15`) permite `si/no/—`.
  Una flota creada con las casillas vacías ya NO declara "no califica": queda
  sin declarar (por_confirmar, "nada se afirma" — `config.ts:56-59`).
- **La migración 0083** valida la FORMA de `facilidadCombustibleEfectivo` a nivel
  DB (`check (config is null or config_tenant_valida(config))`, 0026): un "sí"
  o un objeto parcial revienta ruidoso en el UPDATE, no se lee como "no elegible"
  en silencio.
- **El camino feliz del demo sigue sin tocar la válvula**: el diésel del seed es
  `forma_pago '03'` (transferencia) — la RFA 2.9 no se enciende en la sala
  (verificado en `seed.sql`). La flota del seed declaró `true/true`, pero sin
  efectivo no produce diferencias nuevas.
- **`SIN_ACREDITAMIENTO`** (`engine.ts:963`) incluye los tipos nuevos: dentro15/
  sobre15/no_elegible nunca acreditan IVA ni IEPS.
- **`cubetaDe`** (`engine.ts:97-123`): `efectivo_no_elegible` en NO_DEDUCIBLE_ISR,
  `combustible_efectivo` en POR_CONFIRMAR; la decisión vive en un solo lugar.
- **`cierre_aviso.ts:139-145`**: dentro15 → panel (informativo), sobre15/no_elegible
  → decisión. **`por_diferencia.ts:33-40`**: los 3 tipos con norma; índice
  sincronizado (suite `normas_sincronizadas` verde).
- **`guardia.ts`** intacta: `cuadro`/`cerro`/`consultoPolitica` separados, snapshot
  AG-3 de cierre, `'operador'` explícito en `resumenCuadre`, fail-closed final
  (`guardia.ts:116-118`). `avisoTope15` con `elegible` pasa por el cierre de la 14
  (ALTO) y la suite de aviso quedó actualizada.
- **`processor.ts:2141`**: el PDF rechazado por Meta ahora le dice la verdad al
  chofer ("ya quedó cerrada ✅… pídeselo a tu contralor") — el residual BAJO de la
  13 cerró; el mensaje se envía SOLO tras `pdf_generado=true` (no miente sobre el
  cierre).
- **`getAcumuladoCombustible`** (`repo.ts:802-870`): mismo criterio de
  combustible que el motor cuando se le pasan las claves; paginación con
  `count:'exact'` y fail-closed si la lectura queda incompleta; el orden
  `fecha, id` sale del índice (mig. 0023).
- **Suites**: 95 (guardia+cifras+estado_afirmado) + 162 (engine+resumen+
  liquidacion_completa+por_diferencia+normas) + 499 (cuadre completo+periodo+
  normas) + 81 (processor_cadena/cierre/ctx_cerro/lock+tools+conv) + 72
  (administracion+privacidad+repo_acumulado) — todas en verde. `eslint` limpio
  sobre los archivos del rubro.

## Lo que no alcancé a revisar

- **No corrí `tsc --noEmit` full ni la suite completa**: hay otros auditores
  trabajando en paralelo sobre el mismo repo (dejaron `zzz-fiscal-aud15-probe`,
  `zzz-r15-scratch`, `zzz_auditoria15_tmp` en `cuadre/`), y el PROMPT-BASE pide
  no pisar la suite completa.
- **No medí en la base real** el costo de `getAcumuladoCombustible` dentro del
  presupuesto del turno (el hallazgo de escala es por lectura de `repo.ts:807-819`,
  no por cronómetro).
- **No vi el render del PDF** con las notas del 15% ni la pantalla nueva de
  `/admin/flotas` (edición) en el navegador: requiere build/preview; los rubros
  frontend/fiscal lo cubren.
- **`huerfanos.ts`, `tool-executor.ts`, `openrouter.ts` (loop-guard)**: sin
  cambios desde la ronda 13/14 (verificado por `git log`), no los re-leí línea
  por línea.
- **La aplicación de 0082/0083 contra la base real** (rubro datos): verifico el
  SQL, no su aplicación.

## Veredicto

**Green light para el demo, con la misma condición de siempre y la deuda del
rubro otra vez en alza.**

El camino feliz del guion —fotos → "listo" → cuadre → PDF— sigue protegido por la
guardia más fuerte del sistema (`guardiaCifras` reemplaza SIEMPRE el texto del
modelo tras `cuadrar_viaje`/`guardar_liquidacion`, `guardia.ts:83-114`), el
diésel del seed es electrónico (`forma_pago '03'`), y la válvula del 15% —con
sus notas, su contador y su estatus nuevo— no se enciende en la sala. Los tres
cierres fuertes de la 14 son reales y los probé con valores: estatus rojo para
el excedente del 15% y la flota no elegible, excedente por comprobante que suma
el total real, y el alta/edición con tercer estado.

La salvedad, otra vez, es la clase que este proyecto lleva cinco rondas
pagando: **un fix que se queda a medias** (el año cruzado cerró la dirección del
proceso pero no la del comprobante de otro ejercicio, que es la que la propia
recomendación pedía filtrar; el cotejo de cardinales y el portón 1-10 siguen
intactos pese a que la 14 los recomendó cerrar) y **una cifra que se afirma sin
haberse medido** — ahora en su variante más cara: cuando el contador del 15% no
carga, el motor imprime "el excedente de $1,000 NO se deduce (15% de $0.00)" y
mueve el dinero de la deducción, mientras el comentario del fix promete una rama
"sin datos del ejercicio" que no existe. Es el mismo hueco que el fail-closed de
la guardia existe para evitar, reintroducido en el camino del dinero por el
propio cierre de la 14. Ninguno se ve en la sala; todos se verán en el primer
cliente con diésel en efectivo cuya consulta del ejercicio falle o cuyo enero
traiga tickets del año anterior — es decir, en enero.

Recomendación para la ronda 16, en orden: (1) la rama `total === 0 && efectivo
> 0` en el motor (o nota `sin_criterio`) para el contador caído — es la más
urgente porque convierte un fallo de disponibilidad en una afirmación fiscal;
(2) filtrar por año `efectivoDeEsteViaje`; (3) el patrón
`(?:a\s+las|el|al)\s+(dos|…|diez|once|…)` en `NO_ES_DINERO`; (4) el parseo de
"mil"; (5) condicionar la palabra "deducible" de la nota dentro15 a `cfdiUuid`;
(6) pruebas para `avisoTope15` con `elegible:false/undefined` y
`actualizarFacilidad15`; (7) mensaje de éxito de `accionFacilidad` y del ARCO
con la verdad (borrado vs actualizada; el titular no recibe la resolución por
WhatsApp). Los siete con fix acotado y prueba escribible.
