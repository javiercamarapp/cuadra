# Cumplimiento fiscal — auditoría 14

**Nota: 7/10** (la ronda 13 cerró en 6). Razón del movimiento: **sube un punto
por lo que se cerró de verdad y se midió, y no sube más por la familia que
volvió a quedar a medias.** Los dos hallazgos de la ronda 13 que este rubro
abrió —el ALTO del IVA del panel (37d75ee) y el MEDIO de `operador.rfc` sin
productor (5ef6993)— están **cerrados y verificados en el código**, y el deber
ser de la RFA 2.9 (0d23f73 + 0fa305e) atacó de verdad el MEDIO reincidente del
15%: el motor ya tiene la matriz completa (elegible / no elegible / sin
declarar), medida por mí con el motor real, y las notas de las cuatro ramas
dicen exactamente lo que se verificó. **Pero la propagación del estándar volvió
a quedarse a medias —la misma enfermedad de la ronda 13, en el mismo órgano—**:
el panel del contador y el aviso de WhatsApp siguen afirmando "te quedan $X
antes de perder la deducción" y "Dentro del 15% sigue siendo deducible" para
flotas que el propio motor declara NO elegibles o SIN declarar. Y el contador
del ejercicio —la pieza nueva— tiene dos bugs de dinero medidos: el excedente
se reporta CUMULATIVO por comprobante (un gasto de $1,000 lleva una diferencia
de $1,500 en el papel) y el "ejercicio" se ancla al año del reloj del proceso,
no al de los comprobantes (un viaje de diciembre liquidado en enero pierde
la cuota completa del 15% con la nota "$500 vs $0"). Eso es lo que separa el 7
del 8.

---

## Hallazgos

### [ALTO] (NUEVO) La elegibilidad de la RFA 2.9 no se propagó a las superficies que la avisan y la pintan: el panel y el chat de WhatsApp siguen ofreciendo la válvula del 15% a flotas que el motor declara no elegibles o sin declarar

`src/lib/cuadra/periodo/aviso.ts:29` ("te quedan $X antes de perder la
deducción… A partir de ahí conviene pagar con tarjeta") ·
`src/lib/cuadra/tools.ts:105-107` (el chat llama `avisoTope15` sin conocer
`facilidad15`) · `src/app/dashboard/contador/combustible/page.tsx:151-163`
("Todavía caben $X de combustible en efectivo" / "Excedente del periodo") ·
`src/lib/cuadra/fiscal.ts:270` ("Dentro del 15% sigue siendo deducible; el
excedente no") y `fiscal.ts:321` (`causasDe` empuja `combustible_efectivo`
para cualquier flota) · `fiscal.ts:588-601` (`tope15DeGastos` no lee la
declaración) · contraste: el motor nuevo `engine.ts:296-336` (las cuatro ramas
de `facilidad15 === true/false/undefined`) · `evaluarTope15`
(`periodo/combustible.ts:45-69`, sin input de elegibilidad) · **ABIERTO
(regresión de cobertura: el cierre de la ronda 13 se aplicó al motor y otra
vez no a las superficies)**

**Medido con el módulo real:** `facilidad15 = false`, $10,000 de diésel en
efectivo en el ejercicio. El motor: `efectivo_no_elegible`, `totalNoDeducible
= 10,000`, nota "…la flota declaró que NO califica a la facilidad del 15%…
no deducible". El aviso del chat (`avisoTope15` con la MISMA flota al 8% de su
combustible): "Diésel en efectivo 2026: te quedan $X antes de perder la
deducción. Vas en 8.0% del 15% que permite la RFA 2026 regla 2.9. A partir de
ahí conviene pagar con tarjeta o transferencia." El panel: "Todavía caben $X".
La causa en el panel de deducciones perdidas: "Cuenta contra el 15%… Dentro
del 15% sigue siendo deducible; el excedente no."

**Escenario:** hoy TODOS los tenants reales salvo el del seed están "sin
declarar" (`undefined`): el motor pone su diésel en efectivo en `por_confirmar`
("no se afirma nada"), y el chat les escribe "te quedan $X antes de perder la
deducción" — afirmando que la facilidad existe cuando el motor acaba de decir
que no hay con qué sostenerla. Para una flota que declaró NO calificar, las
dos superficies le autorizan gastar más efectivo que para ella jamás deduce.

**Por qué ALTO:** es la misma familia del ALTO de la ronda 13 (37d75ee) y del
MEDIO reincidente de la 12/13 — "una superficie que guía la decisión afirma un
beneficio que el motor no verificó" —, ahora sobre la pieza que la ronda 14
presume completa. El fix se aplicó a `engine.ts` y no a `fiscal.ts`,
`periodo/aviso.ts` ni `tools.ts`, que es exactamente la omisión que la ronda 13
documentó palabra por palabra. La frase "Todavía caben" es además una
INSTRUCCIÓN de gasto, no un dato.

### [MEDIO] (NUEVO) El excedente del 15% se reporta CUMULATIVO por comprobante: un gasto de $1,000 lleva una diferencia de $1,500 en el PDF, y el reparto depende del orden del arreglo

`src/lib/cuadra/cuadre/engine.ts:320-325` (`excedente = acumulado - tope` se
cuelga de CADA gasto posterior al cruce, sin restar lo ya atribuido) ·
`src/lib/cuadra/liquidacion/pdf.ts:429` (el PDF imprime `mxn(d.monto)` junto a
la nota) · contraste con la disciplina que el propio archivo fijó para
`viatico_excede_fiscal` (`engine.ts:920-927`: "el `monto` de esta diferencia
CERRABA el dinero… `montoNoDeducible` es SOLO el exceso de lo timbrado —lo
mismo que de verdad resta de `totalDeducible`—") · **ABIERTO**

**Medido con el motor real** (3 gastos de $1,000 en efectivo, elegible, total
del ejercicio $10,000, previo $0, tope $1,500):
```
g1 → combustible_efectivo_dentro15 (monto 0)
g2 → efectivo_sobre_15, monto 500,  "…el excedente de $500.00 NO se deduce"
g3 → efectivo_sobre_15, monto 1500, "…el excedente de $1,500.00 NO se deduce"
```
La suma de la columna de montos ($2,000) no cuadra con el excedente real
($1,500) ni con `totalNoDeducible` ($1,500). La diferencia de g3 ($1,500) es
mayor que el propio gasto ($1,000): el papel imprime, en la fila de un ticket
de mil pesos, "el excedente de $1,500 NO se deduce" — y los $500 del cruce ya
se habían atribuido a g2. Un contador que sume la columna obtiene $2,000
contra los $1,500 del total no deducible de la misma hoja.

**Segundo modo del mismo bug — el orden decide quién "es" el excedente.** Con
los mismos tres gastos en orden inverso, el motor atribuye el cruce a OTRO
comprobante (`g2:500, g3:1500` → `g2:500, g1:1500`); los totales no cambian,
pero el PDF señala a un ticket distinto como "el que se pasó", y el panel dice
en paralelo "cuál comprobante concreto queda fuera lo decide tu contador"
(`periodo/aviso.ts:37`) cuando la liquidación ya lo decidió por orden de
arreglo. El caso de un solo gasto (el que cubren los tests) funciona; el caso
de varios gastos en efectivo en la misma liquidación —el real— no.

### [MEDIO] (NUEVO) El "ejercicio" del contador del 15% se ancla al año del PROCESO (`new Date()`), no al año de los comprobantes: un viaje de diciembre liquidado en enero pierde toda su cuota, y los gastos sin fecha subestiman el contador

`src/lib/cuadra/cuadre/desde_db.ts:59` (`const anioEjercicio =
String(new Date().getFullYear())`) · `desde_db.ts:65-66` (la consulta filtra
por ese año) · `desde_db.ts:86-89` (`efectivoDeEsteViaje` se resta del total
del año aunque los gastos del viaje no estén en ese año) · `engine.ts:305-309`
(`total ?? 0` → `tope = 0` → rama de excedente) · **ABIERTO**

**Escenario con valores:** flota elegible; ejercicio 2026: combustible total
$100,000, efectivo ya corrido $14,500 → tope $15,000, quedan $500 de cuota.
El 28-dic-2026 el operador paga $500 de diésel en efectivo —dentro de la
cuota real de 2026— y el viaje se liquida el 3-ene-2027. La consulta de
`desde_db` mira el ejercicio 2027 (vacío al empezar el año) → `total = 0`,
`tope = 0` → el motor entra a la rama de excedente con la nota "el ejercicio ya
excede el tope del 15% ($500.00 vs $0.00)" y `totalNoDeducible = 500` — un
viaje que la cuota real de 2026 tenía cubierto sale no deducible, y la nota
afirma una comparación que nadie midió (el input no dijo "cero", dijo "no hay
dato del año que toca"). Al revés, un viaje de un año viejo liquidado en 2026
ve su efectivo sumado a la cuota de
2026 (el motor suma TODO el efectivo del viaje sin mirar la fecha de los
gastos: `engine.ts:304`).

**Segundo modo:** un gasto de diésel en efectivo SIN `fecha` (el OCR no la
leyó; `gasto.fecha` es nullable, `0001_init.sql:62`) no entra a la consulta
del año (`gte/lte` lo excluyen) pero SÍ se resta en `efectivoDeEsteViaje`
(`desde_db.ts:86-89`) y SÍ lo suma el motor. Neto: `efectivoPrevEjercicio`
queda subestimado → el contador subestima el consumo real → la flota puede
cruzar el 15% sin que el motor lo corte. Es el lado caro: deducción afirmada
que no se sostiene. Ninguno de los dos modos está cubierto por un test (ver el
BAJO de cobertura).

### [MEDIO] (NUEVO) La alta de flota no puede expresar "sin declarar": una casilla sin marcar se convierte en "la flota declaró que NO califica" — y la declaración no se puede ver ni corregir después

`src/app/admin/flotas/page.tsx:37-38` (`fd.get('dedicacionExclusivaCarga') ===
'on'` → siempre booleano) y `:174-187` (dos checkboxes opcionales, sin
`required`, sin estado "no sé") · `src/lib/cuadra/administracion.ts:110-120`
(la llave se escribe siempre que el llamador pase los campos; la UI los pasa
siempre) · `administracion.ts:113-114` (`?? null`: un campo no proporcionado
se guarda como `null` y en `desde_db.ts:53-55` `null !== undefined` → la llave
cuenta como DECLARADA → `facilidad15 = false`) · `engine.ts:331-335` (la nota
de la rama false: "la flota declaró que NO califica") · `desde_db.ts:53-55`
(la derivación de `facilidad15`) · `src/app/dashboard/configuracion/page.tsx`
(solo lectura; no muestra la declaración) · `grep facilidadCombustibleEfectivo
src/` → cero escritores fuera del alta · **ABIERTO**

**Escenario con valores:** Javier da de alta una flota real (régimen general,
o simplemente no conoce la respuesta) y no marca las casillas → `false`/`false`
→ el motor imprime, en cada liquidación con diésel en efectivo, "la flota
declaró que NO califica a la facilidad del 15%… no deducible" — una afirmación
que nadie hizo. La casilla sin marcar es un dato ausente, no una declaración
negativa: el propio diseño del motor tiene un tercer estado (`undefined` →
"por confirmar, no se afirma nada") que la UI hace **inalcanzable** para flotas
nuevas. Y no hay remedio: la declaración no aparece en ninguna pantalla del
cliente y no existe ningún update posterior (el único escritor es
`crearFlota`). Una flota mal declarada queda marcada "no elegible" para
siempre, o "elegible" si alguien marcó sin verificar, sin forma de corregirlo
en el producto.

### [MEDIO] (NUEVO) Estatus "cuadrada" (verde) en liquidaciones con dinero no deducible: el 15% excedido y la flota no elegible no levantan el estatus

`src/lib/cuadra/cuadre/engine.ts:1126` (`REVISAR` no incluye
`efectivo_sobre_15` ni `efectivo_no_elegible`) · `engine.ts:1128` (`hayDif`
solo mira `sobre_politica | duplicado | diesel_desviacion | anticipo`) ·
`engine.ts:1129` (estatus) · `cierre_aviso.ts:143-144` (las dos van como
`'decision'`: "alguien decide") · `contador/liquidaciones/page.tsx:37`
(`cuadrada` → verde "Cuadrada") · **ABIERTO**

**Medido con el motor real** (anticipo = comprobado, sin otras diferencias):
caso A — elegible, dos gastos de $1,000 en efectivo, tope $1,500:
`estatus = cuadrada`, `totalNoDeducible = 1,900`, diferencias
`efectivo_sobre_15 | efectivo_sobre_15`. Caso B — flota no elegible, $1,000 en
efectivo: `estatus = cuadrada`, `totalNoDeducible = 1,000`. En los dos, el
panel pinta verde "Cuadrada" mientras el PDF dice "No deducible $1,900" y el
aviso del cierre le pide al jefe una decisión. "Cuadrada" es el estatus que el
contador no abre: la liquidación que perdió la deducción es justo la que nadie
mira.

### [MEDIO] (REINCIDENTE, 2ª ronda, ahora con efecto de dinero) Tres contadores del 15% con tres criterios distintos: el chat usa `concepto='diesel'` a secas, el motor y el panel usan los dos criterios

`src/lib/cuadra/repo.ts:825` (`.eq('concepto', 'diesel')`) · consumido por
`src/lib/cuadra/tools.ts:105` (el aviso del chat) · contra `desde_db.ts:76-84`
(`concepto.eq.diesel` OR `clave_prod_serv.in.(claves)`, el que alimenta al
motor) · contra `fiscal.ts:588-601` (`tope15DeGastos`, los dos criterios) ·
**ABIERTO** (el fix de la ronda 14 tocó `desde_db` y dejó `repo.ts` intacto)

**Escenario:** flota cuyo combustible se captura como `otro`/`factura` con
clave `15101505` (el OCR clasificó distinto el concepto). El motor cuenta esos
gastos en el numerador/denominador del 15% (y corta por la frontera); el aviso
del chat —la superficie que le dice al jefe "te quedan $X"— los ignora. Medido:
$150,000/año omitidos hacen parecer holgada a una flota que el motor ya marcó
`efectivo_sobre_15` en la última liquidación. El hallazgo de la ronda 13 era
"dos funciones del panel divergen"; ahora la divergencia es entre el chat y el
motor sobre el MISMO contador, y el chat autoriza gasto.

### [BAJO] (NUEVO) El motor convierte "input ausente" en "excede el 15% contra $0": falla cerrado pero con una nota falsa

`src/lib/cuadra/cuadre/engine.ts:305` (`const total =
input.totalCombustibleEjercicio ?? 0`) → `tope = 0` → rama de excedente
(`:308-325`) con nota "el ejercicio ya excede el tope del 15% ($1,000.00 vs
$0.00)". **Medido con el motor real**: `facilidad15: true` sin
`totalCombustibleEjercicio` → `totalNoDeducible = 1,000` con esa nota. El
patrón del repo es "fallar cerrado Y decirlo" (`pg.ts`, `getConfig`); aquí se
declara no deducible afirmando una comparación que nadie midió. Hoy solo lo
llama `desde_db` (que siempre lo provee) y la API de demo
(`app/api/demo/route.ts:41`, sin la llave — pero ahí `facilidad15` es
`undefined`, así que la rama no se alcanza). Sin guardia en la función pura, un
llamador futuro con `facilidad15: true` y sin totales produce el papel falso.

### [BAJO] (NUEVO) La migración 0082 acepta cualquier contenido en `facilidadCombustibleEfectivo`: un string "sí" pasa el validador y se lee como "no elegible" en silencio

`supabase/migrations/0082_config_facilidad15.sql:14-16` (la llave entra a
`llaves_ok` y NO hay validación de tipo/contenido del objeto — el validador
solo comprueba las llaves de primer nivel, `:28-34`) ·
`desde_db.ts:53-55` (`dedicacionExclusivaCarga !== undefined` con un string →
`facilidad15 = false`) · **ABIERTO**

**Escenario:** un script o un SQL directo escribe
`{"facilidadCombustibleEfectivo": {"dedicacionExclusivaCarga": "sí",
"regimenElegible": true}}` — el CHECK de la tabla lo acepta, la flota queda
"declaró que no" y cada liquidación con efectivo sale no deducible sin que
ningún log lo explique. La UI escribe booleanos de verdad, así que hoy es solo
un agujero de validación, no una ruta de producción; pero el validador existe
precisamente para que los typos de la config sean ruidosos (los demás campos
los valida hasta el tipo).

### [BAJO] (NUEVO) La doc del deber ser contradice al motor en la fila del permiso CRE — y la ficha de la norma sigue diciendo que el contador no existe

`docs/fiscal/rfa-2.9-deber-ser.md:56` (matriz: "Sin permiso CRE | ⚠️ revisar |
❌ | ❌ | por_confirmar (B1)") y `:39-41` ("Lo cubre la regla B1 del
complemento… → `permiso_cre_no_verificable` → a revisión") · contra el motor:
`engine.ts:97-98` (`permiso_cre_no_verificable` NO está en `NO_DEDUCIBLE_ISR`
ni en `POR_CONFIRMAR`), `engine.ts:956` (NO está en `SIN_ACREDITAMIENTO` — su
IVA sí se acredita), `engine.ts:1126` (NO está en `REVISAR` — no baja
estatus), y el comentario de `engine.ts:~520-531` ("el permiso CRE…
Independiente de si el complemento de hidrocarburos está presente: son dos
requisitos distintos de la misma compra") · `normas/rfa-2026-2.9.yaml:45-47`
(`pendiente_en_producto: "El CONTADOR del 15% por ejercicio no existe
todavía…"` — escrito antes de 0d23f73) · **ABIERTO**

La doc que la ronda 14 escribió como especificación del deber ser dice lo
contrario del código que la implementa en las tres columnas de esa fila: el
motor trata el permiso CRE como informativo (decisión deliberada de la
auditoría 9) y el complemento B1 como el que sí baja a revisión. Quien lea la
doc para implementar o para explicar el producto afirmará que un CFDI sin
permiso CRE valida manda la liquidación a revisar, y el sistema no lo hace.
Las dos fichas quedaron desincronizadas en el mismo commit que presumía
completar la regla.

### [BAJO] (NUEVO) El camino `desde_db` del contador del ejercicio no tiene ni una prueba: los 5 tests nuevos prueban el motor puro con inputs inyectados

`src/lib/cuadra/cuadre/engine.test.ts` (5 tests de la matriz, todos con
`totalCombustibleEjercicio`/`efectivoPrevEjercicio` ya calculados) ·
`src/lib/cuadra/cuadre/desde_db.ts` (la consulta nueva con `.or()`, filtro de
año, paginación y la resta del viaje — sin archivo de prueba propio; los
arneses de `processor_cadena.test.ts`/`processor_cierre.test.ts` mockean
`supabaseAdmin` con un stub que devuelve `[]`, así que el filtro, el año y la
resta nunca se ejecutan) · **ABIERTO**

Los bugs de los hallazgos MEDIO de arriba (año del proceso, gastos sin fecha,
excedente acumulado, criterio de concepto) viven TODOS en este camino sin
medir. El patrón del repo —"verificadas fallando sin el fix"— se aplicó al
motor puro y no al borde que calcula los insumos, que es justo donde están los
errores.

---

## Verificaciones puntuales que pidió esta ronda (cierres de la ronda 13)

**Panel del contador: IVA de CFDIs sin confirmar (ALTO de la 13, `37d75ee`) —
CERRADO y verificado.** `fiscal.ts:490-491` (`ivaSostenible` descarta
`cancelado`, `pendiente` y `no_encontrado` antes de acreditar); las pruebas
nuevas existen y pasan (`fiscal.test.ts:493-501`). Medido en la suite:
`resumirFiscal` con `estadoSat='pendiente'` e `ivaTraslado=137.93` →
`ivaAcreditable = 0` y `porValidar = 1`. La cola sigue visible y el IVA ya no
se afirma. (Residual: `estadoSat = null` —"nunca validado"— sigue pasando
`ivaSostenible` y acreditando; el intake siempre escribe algo, así que lo
declaro BAJO sin medir su alcance real en datos.)

**`operador.rfc` sin productor (MEDIO de la 13, `5ef6993`) — CERRADO y
verificado.** La captura inline existe en `operadores/page.tsx:168-176`
(action `accionRfc` con `tenantDelAction`), el escritor
`actualizarRfcOperador` en `repo.ts:901-907` filtra por `tenant_id`, y el
campo se renderiza en `:263`. La rama buena de RLISR 57 (viático timbrado al
RFC del operador subordinado) ya es alcanzable en producción.

**RFC del seed, litros 1:1, SAT sin verde en el motor, peaje con reserva —
intactos.** El seed sigue con `GMX0902279I1` (dígito verificador válido, ya
medido en la ronda 13), `cfdi_xml.ts:208-211` sigue leyendo la cantidad 1:1,
`engine.ts:84-88`/`890-895` siguen mandando `cfdi_pendiente` a
`POR_CONFIRMAR`+`SIN_ACREDITAMIENTO`, y las superficies del peaje conservan la
reserva. **Y el demo no se rompe con el motor nuevo: el diésel del seed es
`forma_pago='03'` (transferencia), así que la rama del 15% no se dispara — las
cifras del guion (deducible 5,600, IVA 774.48, peaje 603.45, 113 L) no
cambian.**

**Ronda-13 MEDIO "la válvula del 15% se ofrece a cualquier tenant" — CIERRE A
MEDIAS.** La parte del motor está cerrada de verdad (matriz de 4 ramas con
notas honestas, `engine.ts:296-336`); la parte del aviso y del panel NO se
tocó — es el ALTO de esta ronda.

## Lo que revisé y está bien (el resto del camino)

- **La matriz del motor, medida con el motor real en las 4 ramas**: elegible +
  dentro del 15% → deducible con el contador a la vista; elegible + excede →
  proporcional en la frontera; no elegible → no deducible; sin declarar → por
  confirmar, sin afirmar nada. Los 5 tests de la matriz (`engine.test.ts`,
  verificados fallando sin el motor según el commit) pasan, y las notas de las
  cuatro ramas dicen exactamente lo verificado.
- **"Dentro del 15% nunca acredita IVA/IEPS"**: los 4 tipos nuevos están en
  `SIN_ACREDITAMIENTO` (`engine.ts:956`) y la prueba del IVA en cero existe y
  pasa.
- **La frontera reparte por proporción y las cubetas siguen sumando el
  comprobado**: medido, `totalDeducible + totalNoDeducible = totalComprobado`
  en los casos de cruce (el mecanismo de `proporcionDeducible` compartido con
  el tope de alimentación no colisiona: conceptos disjuntos).
- **`traerTodo` falla cerrado** en la consulta del ejercicio (`pg.ts`): un
  error de PostgREST o una lectura incompleta lanza y tumba el cuadre, no
  produce un contador parcial.
- **`guardarPolitica` usa LEE-MODIFICA-ESCRIBE** sobre `tenant.config`
  (`administracion.ts:265-271`): no pisa `facilidadCombustibleEfectivo`.
- **La migración 0082 es copia fiel de la 0026 + la décima llave** (diff
  verificado función a función) y el CHECK de la 0026 referencia la función
  por nombre, así que el `create or replace` surte efecto sin recrear la
  constraint.
- **El seed declara al demo elegible** (`seed.sql`) y el `.or()` con claves
  del demo (`15101505,15101514,15101515`) es sintaxis PostgREST válida.
- **Pruebas del rubro, verdes**: `engine` (112), `fiscal` (57),
  `periodo/combustible` (15), `repo_acumulado` (5), `por_diferencia` (9),
  `processor_cadena` (14), `processor_cierre` (22), `guion_demo` +
  `migraciones_verificadas` → ~250 pruebas, 0 fallos. `tsc --noEmit` limpio.
- **No dejé basura**: los archivos de medición temporal se borraron; el árbol
  queda limpio salvo este reporte.

## Lo que no alcancé a revisar

- **El PDF renderizado** del caso frontera: verifiqué la línea que imprime el
  monto (`pdf.ts:429`), no imprimí el papel.
- **La suite completa** (otro auditor puede estar corriéndola; dejé intacto el
  archivo de medición del auditor de arquitectura).
- **La interpretación del excedente transitorio** (año natural vs el ejercicio
  de la RFA): sin fuente, no dictamino; mi hallazgo del año es sobre la ancla
  del reloj, no sobre la transitoriedad.
- **El alcance real de `estado_sat = null`** en datos de producción (el
  residual del IVA del panel): sin base no lo medí, lo declaro como residual
  del cierre de la ronda 13.

## Veredicto

**Green light para el demo en su parte fiscal, con el mismo matiz de la ronda
13: lo que se proyecta mañana está entero y medido.** Los dos hallazgos que la
ronda 13 abrió en este rubro están cerrados de verdad (verificados en el
código, no por el título del commit), el motor de la RFA 2.9 tiene la matriz
completa con notas honestas, y el demo no toca la rama nueva (su diésel es
transferencia), así que las cifras del guion se sostienen. La nota sube del 6
al 7 por esos cierres y por la matriz medida.

**Lo que separa el 7 del 8:** la misma enfermedad de la ronda 13, otra vez sin
curar —el estándar del motor no se propaga a las superficies que guían la
decisión—. El panel y el chat siguen ofreciendo la válvula del 15% (y
autorizando gasto en efectivo) a flotas que el motor acaba de declarar no
elegibles o sin declarar, y el contador del ejercicio —la pieza nueva— tiene
dos bugs de dinero medidos (el excedente que se imprime acumulado y por orden
de arreglo, y el año anclado al reloj del proceso). Ninguno de los tres toca la
proyección de mañana: el demo es elegible declarado, no cruza el 15% y su
diésel no es efectivo. Las condiciones antes de enseñar la RFA 2.9 como
terminada: propagar `facilidad15` a `fiscal.ts`/`aviso.ts`/`tools.ts` (o
declarar "no evaluado" donde no hay declaración), corregir el excedente
acumulado por gasto, anclar el ejercicio a la fecha de los comprobantes, y
subir `efectivo_sobre_15`/`efectivo_no_elegible` al estatus que les
corresponde. Eso es trabajo de la semana siguiente, no de la noche de hoy.
