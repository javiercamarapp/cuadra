# Cumplimiento fiscal — auditoría 15

**Nota: 6/10** (la ronda 14 cerró en 7). Razón del movimiento: **se atacó y
bajó un punto — deuda que cobró factura + mirada más profunda a los fixes.**
Los fixes de la 14 (8a33ce1) cerraron de verdad dos hallazgos de dinero del
motor (el excedente por comprobante y el estatus 'revisar', ambos medidos) y
atacaron el ALTO, pero a medias: la tercera superficie del ALTO —el panel
"Todavía caben"— sigue viva, el chat sigue con el criterio de concepto
divergente que el propio commit prometía unificar, y el camino `desde_db` (el
que calcula los insumos del contador) sigue sin una sola prueba — es
exactamente donde viven los bugs de dinero que encontré. Peor: los fixes
sembraron **tres regresiones nuevas** en superficies que antes solo callaban y
ahora dicen mal: la sección por-causa de Deducciones perdidas queda VACÍA con
$3,500 en "perdido", "sin declarar" se pinta como "deducción perdida" cuando el
motor dice "por confirmar", y un fallo de lectura en la consola puede
BORRAR la config completa de una flota con el mensaje "Declaración
actualizada." Eso es lo que separa el 6 del 7: el motor subió, el panel
empeoró.

---

## Hallazgos

### [ALTO] (REINCIDENTE del 14, 2ª ronda — la tercera superficie del ALTO quedó sin tocar) El panel del contador sigue ofreciendo la válvula del 15% —"Todavía caben $X"— a flotas que el motor declara no elegibles o sin declarar

`src/app/dashboard/contador/combustible/page.tsx:75` (`const tope = gastos &&
opts ? tope15DeGastos(gastos, opts) : null`) · `page.tsx:161` ("Todavía caben
<strong>{mxn(tope.margen)}</strong> de combustible en efectivo dentro del
periodo sin pasarse") · `page.tsx:154-159` ("Excedente del periodo…") ·
`src/lib/cuadra/fiscal.ts:609-616` (`tope15DeGastos` NO lee `o.elegible15`:
suma efectivo/total y llama `evaluarTope15` a ciegas) · contraste: el fix tocó
las otras dos superficies del ALTO (`periodo/aviso.ts:31-36` y `tools.ts:108-115`,
ambas ya con `elegible`), y `comun.tsx:127-135` (`opcionesDe`) SÍ provee
`elegible15` — el dato está a un parámetro de distancia y `tope15DeGastos` no
lo usa. El commit 8a33ce1 no incluyó este archivo. **ABIERTO (parcial: 2 de 3
superficies del ALTO cerradas; esta es la que la ronda 14 citó palabra por
palabra).**

**Medido con el módulo real:** `tope15DeGastos` con `elegible15 = false` y
$10,000 de efectivo sobre $10,000 de total devuelve `estado: 'excedido',
razon: 1, excedente: 8,500` — el panel pintaría "Excedente del periodo:
$8,500.00… tira el excedente completo" para una flota cuyo efectivo JAMÁS
deduce. Y con $3,000 de efectivo sobre $100,000 de total (la misma función,
`evaluarTope15`: `margen = 15,000 − 3,000 = 12,000`) la rama 'holgado'
renderiza "Todavía caben $12,000.00 de combustible en efectivo dentro del
periodo sin pasarse" + Gauge al 3% + StatusPill "Holgado". Para la flota SIN
declarar (undefined — el estado de TODOS los tenants reales salvo el seed,
según la ronda 14) el panel pinta lo mismo.

**Escenario:** una flota que declaró NO calificar (o que nunca declaró) abre el
panel del contador, ve "Todavía caben $X" — una INSTRUCCIÓN de gasto en
efectivo — cuando el propio motor acaba de declarar en su liquidación que ese
efectivo jamás deduce. Es la misma familia del ALTO de la ronda 13 (37d75ee) y
del ALTO de la 14: una superficie que guía la decisión afirma un beneficio que
el motor no verificó. El chat ya no lo hace; el panel sí.

### [MEDIO] (NUEVO — regresión del fix 8a33ce1) Deducciones perdidas: la sección "por causa" queda VACÍA con dinero en "perdido", y un diésel en efectivo sin CFDI de flota no elegible se cuenta como "Se recupera pidiendo la factura"

`src/lib/cuadra/fiscal.ts:352-356` (`const ORDEN` NO incluye
`'efectivo_no_elegible'`) · `fiscal.ts:427-429` (`porCausa` se filtra por
ORDEN → el tipo nuevo jamás aparece) · `fiscal.ts:359-366` (`causaDominante`
cae al fallback `cs[0]` o a `sin_cfdi` antes que a `efectivo_no_elegible`) ·
`src/app/dashboard/contador/deducciones/page.tsx:194` (`porCausa.length > 0 &&`
— la sección entera no se renderiza) · `src/app/dashboard/contador/page.tsx:97`
(la home del contador consume el mismo resumen). **ABIERTO (introducido por el
fix: el tipo se agregó a `TITULOS` y a `causasDe` pero no a `ORDEN`).**

**Medido con el módulo real** (`resumirPerdidas`, flota no elegible):
- Dos gastos de diésel en efectivo de $1,000 y $2,500, ambos con CFDI vigente →
  `montoPerdido = 3,500`, `porCausa = []`. El panel muestra "Ya no se
  recupera $3,500.00" y la gráfica/desglose por causa no existe: la fila que
  explica DÓNDE se perdió no aparece porque el tipo no está en `ORDEN`.
- Un gasto de diésel en efectivo de $1,000 SIN CFDI en flota no elegible →
  causas `[sin_cfdi (recuperable), efectivo_no_elegible (perdida)]` →
  dominante `sin_cfdi` → `montoRecuperable = 1,000`: el panel le dice al
  contador "Se recupera pidiendo la factura" cuando, aun timbrándolo, el
  efectivo de una flota no elegible no deduce (LISR 27-III sin excepción). La
  gravedad del dinero queda invertida: lo perdido se pinta recuperable.

### [MEDIO] (NUEVO — regresión del fix 8a33ce1) "Sin declarar" se pinta como "deducción PERDIDA" en el panel, mientras el motor dice "por confirmar, no se afirma nada"

`src/lib/cuadra/fiscal.ts:337` (`push(o.elegible15 === true ?
'combustible_efectivo' : 'efectivo_no_elegible')` — el `else` mezcla `false`
con `undefined`) · `fiscal.ts:278-283` (`efectivo_no_elegible` con
`gravedad: 'perdida'` y detalle "La flota no califica… así que el efectivo en
combustible **no es deducible** aunque tenga CFDI") · contraste con el motor:
`cuadre/engine.ts:342-347` (la rama `undefined` → `combustible_efectivo`, cubeta
`por_confirmar`, nota "sin esa declaración **esto se revisa**"). **ABIERTO.**

**Medido con el módulo real:** `elegible15 = undefined`, un gasto de diésel en
efectivo de $1,000 → `resumirPerdidas` devuelve `montoPerdido = 1,000`,
dominante `efectivo_no_elegible`; el motor para el mismo gasto produce
`combustible_efectivo` → `por_confirmar` (ni deducible ni perdido: pendiente).
El panel le imprime al contador "Ya no se recupera $1,000" y "La flota no
califica a la facilidad del 15%" — una afirmación que NADIE hizo (la flota solo
no ha declarado). Es la misma confusión que la ronda 14 denunció en el alta
("una casilla sin marcar se convierte en 'declaró que NO'"), ahora trasladada
al panel: el fix del alta la curó y el fix del panel la reintrodujo con otra
cara. Hoy, con todos los tenants reales sin declarar, el panel les declara
perdidas deducciones que el motor manda a revisar.

### [MEDIO] (NUEVO) `actualizarFacilidad15` descarta el error de LECTURA: con la base caída, "Guardar declaración" reemplaza TODA la config de la flota en silencio

`src/lib/cuadra/repo.ts:921-927` (`const { data: fila } = await acotada(...)`
sin revisar `error`; `actual = { ...((fila?.config as …) ?? {}) }` — un fallo
de lectura produce `{}` y el UPDATE escribe la config entera de nuevo) ·
contraste con `src/lib/cuadra/administracion.ts:268-271` (`guardarPolitica`
hace `if (errLee) throw` — el patrón del repo es "fallar cerrado y decirlo") ·
`src/app/admin/flotas/page.tsx:60-61` (el server action responde "Declaración
del 15% actualizada." sin saber si la lectura sirvió). **ABIERTO.**

**Escenario:** la base responde lento o con timeout en el `SELECT config`
(PostgREST devuelve errores POR VALOR: `data = null`). `fila` es null →
`actual = {}` → el UPDATE escribe `{ config: { facilidadCombustibleEfectivo:
{…} } }` — la política con sus topes, `estimulos`, `hidrocarburos`,
`validacion` de la flota desaparecen del override y la flota corre de golpe con
los topes de `DEMO_CONFIG` (fusionarConfig rellena lo que falta). El admin ve
el mensaje de éxito, nadie ve el log. Es exactamente la enfermedad que
CLAUDE.md documenta ("una base caída se lee como 'no hay nada'"), en un
escritor de config nuevo, con la agravante de que el dato perdido es la
política de dinero de la flota. El mismo patrón aplica al camino "borrar
declaración": con la lectura caída escribe `{ config: {} }` y borra todo.

### [MEDIO] (PARCIAL del 14) El ejercicio se ancla al VIAJE pero el contador sigue ciego a la fecha de CADA gasto: un viaje que cruza el año cuenta enero contra el tope de diciembre, y un gasto sin fecha escapa del contador

`src/lib/cuadra/cuadre/desde_db.ts:63-64` (`anioEjercicio` = año de
`viaje.fechaInicio` — el caso simple de la ronda 14 quedó arreglado) ·
`desde_db.ts:84-88` (`efectivoDeEsteViaje` filtra por `formaPago` y concepto,
SIN mirar `fecha`) · `cuadre/engine.ts:311-316` (el motor suma TODO el efectivo
del viaje al acumulado del ejercicio sin verificar que el gasto sea de ese
año) · **ABIERTO (el fix curó el modo "liquidación de diciembre en enero" y
dejó los otros dos).**

**Escenario A (medido con el motor real):** viaje 28-dic-2026 → 2-ene-2027.
Ejercicio 2026: total $100,000, efectivo ya corrido $14,900 (incluye el $1,000
de diésel del 28-dic). El gasto de $200 del 2-ene-2027 —que pertenece al tope
de 2027— el motor lo cuenta contra el tope de 2026: excedente $100 (dic) +
$200 (ene) = $300 no deducible, y el PDF le imprime al ticket de enero "el
excedente de $200.00 de ESTE comprobante NO se deduce" contra un ejercicio que
no es el suyo. Si enero es su cuota de 2027, la deducción se pierde dos veces
contada.

**Escenario B (aritmética verificada sobre desde_db):** un gasto de diésel en
efectivo de $1,000 SIN `fecha` (OCR no la leyó; `gasto.fecha` es nullable) no
entra a la consulta del año (`gte/lte` lo excluyen) pero SÍ se resta en
`efectivoDeEsteViaje` y SÍ lo suma el motor. Con efectivo fechado 2026 =
$15,300 (incluye $500 fechados de este viaje) y el gasto sin fecha de $1,000:
`efectivoDeEsteViaje = 1,500` → `previo = 13,800` → el motor acumula 15,300 →
exceso declarado $300; el exceso verdadero es $1,300. El contador subestima por
exactamente el monto sin fecha, la flota cruza el 15% sin que el motor corte y
la deducción afirmada no se sostiene — el lado caro.

### [MEDIO] (PARCIAL del 14 — el commit prometió "una sola barrida" y la dejó a medias) El chat sigue contando con `concepto='diesel'` a secas: el fix tocó repo.ts y desde_db, no al llamador

`src/lib/cuadra/tools.ts:105` (`const acum = await
getAcumuladoCombustible(ctx.tenantId, ejercicio)` — sin el tercer argumento) ·
`src/lib/cuadra/repo.ts:826` (sin `claves`, el `.or()` cae a
`concepto.eq.diesel` a secas) · contra `desde_db.ts:78` (el mismo
`getAcumuladoCombustible` PERO con `clavesCombustible`). **ABIERTO (el fix de
la ronda 14 tocó la función y el llamador del motor; el llamador del chat
quedó intacto — la misma omisión que la ronda 13 documentó).**

**Escenario:** flota cuyo combustible se captura como `otro`/`factura` con
clave `15101505` (el OCR clasificó distinto el concepto). El motor y desde_db
cuentan esos gastos en el numerador/denominador del 15%; el aviso del chat —la
superficie que le dice al jefe "te quedan $X antes de perder la deducción"—
los ignora. Medido en la ronda 14: $150,000/año omitidos hacen parecer holgada
a una flota que el motor ya marcó `efectivo_sobre_15`. El chat puede decir
"vas en 8%" el mismo día en que la liquidación imprime "el excedente NO se
deduce". El commit 8a33ce1 dice "mismo criterio en motor, panel y chat" — falso
para el chat.

### [MEDIO] (NUEVO) El best-effort de desde_db convierte un FALLO de consulta en "el efectivo NO se deduce": la rama "sin datos del ejercicio" que el commit invoca no existe en el motor

`src/lib/cuadra/cuadre/desde_db.ts:75-80` (el `catch` inyecta ceros
silenciosamente: `totalesEjercicio = { efectivo: 0, totalCombustible: 0 }`) ·
`cuadre/engine.ts:312-315` (`const total = input.totalCombustibleEjercicio ??
0` → `tope = 0` → la rama `elegible === true` SIEMPRE produce
`efectivo_sobre_15`) · el comentario del propio fix dice "la rama 'sin datos
del ejercicio' marca el efectivo para revisar, que es el fail-cerrado honesto"
— **esa rama no existe**: con `elegible === true` y `total = 0` no hay ningún
camino a `por_confirmar` ni a "no evaluado". **ABIERTO.**

**Medido con el motor real:** `facilidad15: true`, `totalCombustibleEjercicio:
0`, `efectivoPrevEjercicio: 0`, un gasto de $1,000 en efectivo →
`efectivo_sobre_15` con monto $1,000, nota "el ejercicio lleva $1,000.00 de
combustible en efectivo contra un tope de $0.00 (15% de $0.00); el excedente de
$1,000.00 de ESTE comprobante NO se deduce", `totalNoDeducible = 1,000`,
`estatus = revisar`. La nota ya enseña la comparación (mejor que la ronda 14),
pero el veredicto sigue siendo "no deducible" sobre datos que nadie midió. Y la
capa de periodo dice lo contrario para el mismo input: `periodo/combustible.ts`
(`total <= 0` → `sin_criterio` → "no se evaluó el 15%… conviene revisarlo a
mano"). El aviso dice "no se pudo calcular"; el motor dice "NO se deduce". Con
la base caída o un ejercicio sin gastos fechados (los sin-fecha no entran a la
consulta), toda liquidación con diésel en efectivo de una flota elegible sale
declarada no deducible — mitigado por el estatus 'revisar', pero el dinero ya
quedó contado como no deducible en la hoja.

### [BAJO] (REINCIDENTE del 14, mitigado) El motor sigue convirtiendo "input ausente" en "excede el 15% contra $0": la nota ya muestra la comparación y el estatus sube a 'revisar', pero la cubeta cuenta el dinero como perdido

`src/lib/cuadra/cuadre/engine.ts:312-325` (la rama `elegible === true` con
`total = 0` → `efectivo_sobre_15` siempre). **ABIERTO (mitigado: nota con el
$0 a la vista + estatus 'revisar'; antes era el papel falso directo).** El
remedio correcto —una rama explícita "sin datos del ejercicio" que mande a
`por_confirmar`— es el que el comentario del fix cree haber escrito y no
escribió (ver el MEDIO de arriba).

### [BAJO] (REINCIDENTE del 14) El camino `desde_db` del contador del ejercicio sigue sin una sola prueba

No existe `desde_db.test.ts`; los tests nuevos de 8a33ce1 (`engine.test.ts:1455-1471`,
`aviso.test.ts`, `fiscal.test.ts`) prueban el motor puro y las funciones puras
con inputs ya calculados. El ancla del ejercicio, el best-effort con ceros, la
resta `efectivoDeEsteViaje` y el filtro por año —donde viven los hallazgos
MEDIO de esta ronda— no se ejecutan en ninguna prueba. El patrón del repo
("verificadas fallando sin el fix") se aplicó al motor y no al borde que
calcula los insumos, que es justo donde están los errores.

### [BAJO] (NUEVO) `getGastos` no trae `.order()`: cuál comprobante "es" el excedente depende del orden no garantizado de la consulta

`src/lib/cuadra/repo.ts:556-562` (`getGastos` sin `.order()`; PostgREST no
garantiza orden sin él) · consumido por `engine.ts:311-321` (la atribución
por comprobante es estrictamente por orden de arreglo). Los MONTOS ya cuadran
(el fix de la ronda 14), pero el ticket que carga con el cruce de la frontera
puede cambiar entre corridas: con $1,000+$1,000+$1,000 y tope $1,500, el
"excedente de $500" cae en el segundo o en el primero según el orden que
devuelva la consulta. El PDF señala a un ticket distinto para el mismo viaje
sin que cambie ningún dato. `.order('fecha').order('id')` lo haría
determinístico.

### [BAJO] (NUEVO) La doc del deber ser afirma correcciones que el código no hizo, y la ficha de la norma sigue diciendo que el contador no existe

`docs/fiscal/rfa-2.9-deber-ser.md:79-92` (la sección "Correcciones de la
auditoría 14" dice "el panel del contador… ya no ofrecen el 15% a flotas no
elegibles o sin declarar" — falso: `combustible/page.tsx:161` sigue con
"Todavía caben" — y "mismo criterio en motor, panel y chat" — falso:
`tools.ts:105` sin claves) · `rfa-2.9-deber-ser.md:56` (la fila "Sin permiso
CRE | ⚠️ revisar | ❌ | ❌ | por_confirmar (B1)" sigue contradiciendo al motor:
`permiso_cre_no_verificable` NO está en `POR_CONFIRMAR` ni en `REVISAR`,
`engine.ts:84-88`/`1126-1132`) · `normas/rfa-2026-2.9.yaml:47-49`
(`pendiente_en_producto: "El CONTADOR del 15% por ejercicio no existe
todavía…"` — escrito antes de 0d23f73 y nunca actualizado). **ABIERTO.** Una
doc que describe el producto inexistente es la misma mentira que la ronda 14
documentó; ahora además afirma fixes que no existen.

### [BAJO] (NUEVO) El commit promete "todos corregidos con prueba" — cuatro de los fixes no tienen ninguna

`src/lib/cuadra/fiscal.test.ts` (el único cambio de 8a33ce1 fue `elegible15:
true` en el OPTS: sin prueba para `ivaSostenible` del efectivo ni para
`causasDe` → `efectivo_no_elegible`) · `src/lib/cuadra/periodo/aviso.test.ts`
(solo se añadió `true` como tercer argumento: las ramas `false`/`undefined`
nuevas no se prueban) · `src/lib/cuadra/administracion.test.ts` (cero mención a
la alta tri-estado) · el ancla del ejercicio (ningún test de `desde_db`).
**ABIERTO.** Verifiqué el IVA del efectivo en el código y funciona (medido:
`ivaAcreditable = 0`, `ivaNoAcreditable = 160`), pero la promesa del commit es
más amplia que la evidencia.

### [BAJO] (NUEVO) La consola de flotas: fijar UNA sola condición BORRA la declaración entera y el mensaje dice "actualizada"

`src/app/admin/flotas/page.tsx:56-62` (`ded = 'si'`, `reg = ''` → `ded=true`,
`reg=undefined` → `actualizarFacilidad15` entra a la rama de borrar, pero el
mensaje de éxito solo mira `ded`) · `src/lib/cuadra/repo.ts:923-924`. Con
"Carga: Sí" y "Régimen: —" el sistema borra la llave completa (la flota pasa a
"sin declarar") y le dice al admin "Declaración del 15% actualizada." — un
rótulo que no es verdad y una semántica que nadie pidió. El mensaje honesto
existe ("Declaración del 15% borrada (sin declarar)") pero solo sale cuando la
primera casilla está vacía.

---

## Verificaciones puntuales que pidió esta ronda (cierres de la ronda 14)

**Excedente POR COMPROBANTE (MEDIO de la 14) — CERRADO y verificado.**
`engine.ts:311-325` reparte por gasto: `cupoRestante = max(0, tope − previoSin
Este)`; la frontera se cruza una vez. Medido con el motor real (3×$1,000,
elegible, total $10,000, previo $0, tope $1,500): g1 → `dentro15` (monto 0,
proporción 1), g2 → `sobre_15` monto $500 (proporción 0.5), g3 → `sobre_15`
monto $1,000 (proporción 0). Suma de la columna $1,500 = `totalNoDeducible`
$1,500, ningún monto supera su gasto, `totalDeducible + totalNoDeducible =
totalComprobado` ($1,500 + $1,500 = $3,000). Test nuevo en `engine.test.ts`.

**Estatus 'revisar' para el efectivo no deducible (MEDIO de la 14) — CERRADO y
verificado.** `engine.ts:1130-1132` incluye `efectivo_sobre_15` y
`efectivo_no_elegible` en REVISAR; el test nuevo lo verifica en las dos ramas;
`cierre_aviso.ts` los rutea como `'decision'` (interrumpen al jefe); el panel
pinta `revisar` en rojo "Por revisar" (`contador/liquidaciones/page.tsx:39`).
Medido: caso A (excede) y caso B (no elegible) → ambos `estatus = 'revisar'`.

**IVA del efectivo en el panel (ALTO de la 14) — CERRADO en código, SIN
prueba.** `fiscal.ts:509-512` (`if (g.formaPago === '01' && esCombustible(g,
o)) return false;`). Medido: cash diesel con `ivaTraslado=160` →
`ivaAcreditable = 0`, `ivaNoAcreditable = 160` — mismo estándar que
`SIN_ACREDITAMIENTO` del motor (`engine.ts:963`).

**Alta tri-estado (MEDIO de la 14) — CERRADO y verificado.** `flotas/page.tsx:37-38`
manda `undefined` cuando la casilla no se marcó; `administracion.ts:113-119`
solo escribe la llave con AMBOS booleanos; la consola permite ver y corregir
(`accionFacilidad` + selects de 3 estados). Verificado también que el seed del
demo escribe la forma válida (ambos `true`) y que 0083 la acepta.

**0083 (BAJO de la 14) — CERRADO y verificado.** La migración exige: llave
ausente → válido; llave `null` → válido ("sin declarar"); objeto → las DOS
condiciones booleanas, si no `raise exception`. El `"sí"` rebota. Coherente con
`desde_db.ts:53-55` (null → undefined → sin declarar) y con
`actualizarFacilidad15` (nunca escribe parcial). Residual de bajo riesgo: filas
escritas por el código PRE-fix con `null` en los campos (`?? null` de la ronda
14) bloquearían cualquier UPDATE de config posterior — el alta por UI siempre
pasó booleanos, así que es solo un riesgo de script.

**Chat con la elegibilidad (ALTO de la 14, superficie aviso) — CERRADO en
código, SIN prueba.** `tools.ts:108-115` lee la config y pasa `elegible` a
`avisoTope15`; `aviso.ts:29-36` tiene las tres ramas con textos honestos
("la flota declaró que NO califica…", "exige que la flota declare…"). Las
ramas nuevas no tienen test (ver BAJO).

**Cierres de la ronda 13 que este rubro abrió — intactos.** IVA de CFDIs sin
confirmar (`fiscal.test.ts:493-504`, verde), `operador.rfc` con productor
(`repo.ts:906-912`), RFC del seed válido, litros 1:1, SAT sin verde en el
motor, peaje con reserva — sin regresión.

## Lo que revisé y está bien (el resto del camino)

- **La matriz del motor, las 4 ramas, intacta y ahora con estatus correcto**:
  elegible + dentro → deducible informativo; elegible + excede → proporcional
  por comprobante (suma cuadrada); no elegible → no deducible; sin declarar →
  por confirmar. `totalDeducible + totalNoDeducible = totalComprobado` en los
  cruces (verificado).
- **La frontera reparte por proporción y la cubeta del excedente no se dobla**:
  `efectivo_sobre_15` NO está en `NO_DEDUCIBLE_ISR` (va por proporción) y
  `efectivo_no_elegible` SÍ (monto completo). Coherente con el PDF que imprime
  `mxn(d.monto)` (`pdf.ts:429`).
- **El demo no se rompe**: el diésel del seed es `forma_pago='03'`, así que la
  rama del 15% no se dispara; la facilidad declarada (`true`/`true`) es la
  forma que 0083 exige; las cifras del guion (deducible 5,600, IVA 774.48,
  peaje 603.45, 113 L) no cambian, y el `anioEjercicio` del viaje demo (2026)
  con `totalCombustibleEjercicio = 4,200` no produce aviso (holgado → null).
- **`traerTodo`/`acotada` fallan cerrado** en `getAcumuladoCombustible`
  (`repo.ts:835-839`, `861-865`): lectura incompleta → throw → (ahora) catch
  de best-effort en desde_db con `logger.warn` — el rastro existe aunque el
  veredicto resultante sea el problema del MEDIO.
- **Pruebas del rubro, verdes**: `engine` (114), `fiscal` (57), `periodo/aviso`
  (6), `periodo/combustible` (15), `repo_acumulado` (5), `administracion`,
  `processor_cadena` (14), `processor_cierre` (22) → 209 pruebas, 0 fallos.
  `npx tsc --noEmit` limpio.
- **No dejé basura**: mis archivos de medición se borraron; el árbol queda con
  solo `docs/auditoria-15/` sin rastrear (los probes temporales de otros
  auditores no los toqué).

## Lo que no alcancé a revisar

- **El render real** (screenshot) del panel de combustible y de Deducciones
  perdidas con una flota no elegible: verifiqué las líneas y medí las
  funciones, no imprimí las pantallas.
- **La base real**: no toqué datos; el estado de la declaración de los tenants
  reales (¿todos `undefined`?) es la afirmación de la ronda 14, no una lectura
  mía; tampoco medí si existe alguna fila con la llave en forma pre-0083.
- **La suite completa** (otros auditores la están corriendo; dejé intactos sus
  archivos temporales).
- **El PDF impreso** del caso frontera (verifiqué `pdf.ts:429`, no imprimí el
  papel).
- **El alcance real de `estado_sat = null`** en datos (residual del IVA de la
  ronda 13, sigue pasando `ivaSostenible`).

## Veredicto

**Green light para el demo en su parte fiscal, sin matiz nuevo: la proyección
de mañana está entera y medida** —el diésel del demo es transferencia, la
facilidad está declarada en la forma que la base exige, y ninguno de los
hallazgos de esta ronda toca sus cifras—. **Pero la RFA 2.9 NO está para
enseñarse como terminada, y esta vez el motivo no es solo lo que quedó: es lo
que el fix rompió.** El motor cerró de verdad los dos hallazgos de dinero de la
ronda 14 (excedente por comprobante, estatus) y la mitad del ALTO (aviso y
chat), pero la tercera superficie del ALTO —el panel "Todavía caben" para
flotas no elegibles o sin declarar— sigue viva, el chat sigue con el criterio
de concepto divergente, y el camino sin pruebas (`desde_db`) es donde viven los
tres modos de dinero que encontré (año cruzado, gastos sin fecha, ceros del
best-effort). Los fixes sembraron además tres regresiones en superficies: la
sección por-causa de Deducciones perdidas vacía con dinero en "perdido", el
"sin declarar" pintado como pérdida cuando el motor dice "por confirmar", y el
escritor de la consola que puede borrar la config de una flota entera con una
lectura caída.

**Lo que hay que hacer antes de presumir el 15% como completo:** propagar
`elegible15` a `tope15DeGastos`/`combustible/page.tsx` (o pintar "no aplica /
sin declarar" donde no hay declaración), meter `efectivo_no_elegible` en
`ORDEN` y en el filtro de `porCausa`, separar el `undefined` de `causasDe` del
`false` (devolver la causa de "pendiente de declaración", no "perdida"), revisar
`error` en la lectura de `actualizarFacilidad15`, pasar las claves del SAT al
llamador de `tools.ts`, filtrar por fecha del gasto en `efectivoDeEsteViaje` y
en el acumulado del motor, y escribir el test de `desde_db` que falta. Eso es
trabajo de la semana, no de la víspera del demo.
