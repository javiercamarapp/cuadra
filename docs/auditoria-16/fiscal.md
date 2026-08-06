# Cumplimiento fiscal — auditoría 16

**Nota: 7/10** (la ronda 15 cerró en 6). Razón del movimiento: **se atacó y
subió un punto — el fail-closed real del contador cerró de verdad, con
pruebas, y dos regresiones del panel se curaron — pero la mirada más profunda
al dinero encontró que tres MEDIO de la ronda 15 siguen abiertos, uno de ellos
(el contador ciego a la fecha de cada gasto) en su lado más caro, y sembró dos
MEDIO nuevos en las superficies que el propio fix presumía cerradas.** Lo que
se movió del 6 al 7 es el corazón del dinero: el motor ya NO imprime "el
excedente de $X NO se deduce contra un tope de $0 que nadie midió" — eso era
la mentira más cara del sistema y está cerrada y verificada con 3 pruebas
nuevas (`engine.test.ts:1525-1563`). Lo que lo detiene en 7 es que la
tercera superficie del ALTO de la ronda 14 —la píldora y el gauge del panel—
sigue hablando de "Holgado / Cerca del tope / Excedido" para flotas a las que
el 15% no aplica, que `efectivo_no_elegible` sigue sin entrar a `ORDEN` (la
sección por-causa queda vacía con dinero en "perdido" y un diésel sin CFDI de
flota no elegible se pinta "recuperable"), que un gasto SIN fecha sigue
corriendo contra un contador cuya base lo excluye, y que el chat sigue
contando con `concepto='diesel'` a secas — la misma omisión que la ronda 13
documentó y la 14 prometió cerrar.

---

## Cierres de la ronda 15 — verificados en el código, no en el título del commit

**Fail-closed real del contador (ALTO de la 15) — CERRADO y verificado.**
`engine.ts:311-325` abre la rama `!mismoEjercicio || !(total > 0)` → diferencia
`combustible_efectivo` con `monto: 0` y nota honesta ("no se pudo calcular el
total… No se afirma deducible ni no deducible"), `continue` antes del acumulado.
Medido con el motor real: `totalCombustibleEjercicio: 0` + $1,000 en efectivo →
`totalPorConfirmar = 1,000`, `totalNoDeducible = 0`, estatus `revisar`; gasto
fechado 2025-12-20 en ejercicio 2026 → `por_confirmar`, no mezcla. Las 3
pruebas nuevas (`engine.test.ts:1525-1563`) cubren el total 0, el otro
ejercicio y la honestidad de la nota. La rama "sin datos del ejercicio" que el
comentario de la ronda 15 prometía —y que la 15 demostró que no existía— ahora
SÍ existe.

**"Sin declarar" ya no se pinta como deducción perdida (MEDIO de la 15) —
CERRADO y verificado.** `fiscal.ts:337-339` separa `false` de `undefined`:
`if (o.elegible15 === false) push('efectivo_no_elegible'); else
push('combustible_efectivo')`. Medido con el módulo real: `elegible15 =
undefined` + diésel en efectivo de $1,000 → `montoPerdido = 0`,
`montoEnRiesgo = 1,000`, dominante `combustible_efectivo` — mismo lenguaje que
el motor (`por_confirmar`). La mentira "Ya no se recupera $1,000" para una
flota que solo no ha declarado desapareció del panel.

**El recuadro del 15% del panel honra la declaración (en su TEXTO) — CERRADO
parcial.** `combustible/page.tsx:154-171`: antes de decidir entre "Excedente
del periodo" y "Todavía caben", se interroga `opts?.elegible15 === false` y
`=== undefined` y se pinta el texto honesto ("La flota declaró que NO califica…
el combustible en efectivo no es deducible" / "exige que la flota declare… el
efectivo sale a revisión"). El "Todavía caben $X" ya no se imprime para
ninguna flota no elegible ni sin declarar. **Pero la píldora y el gauge del
mismo recuadro siguen mintiendo — ver MEDIO #1 de esta ronda.**

**tools.ts y desde_db.ts con el MISMO año (MEDIO de la 15) — CERRADO en el
camino principal.** `tools.ts:107-108` lee el viaje y usa `fechaInicio`; el
fallback al año del proceso solo queda para un viaje SIN `fecha_inicio` (la
columna es nullable) — ver BAJO #6. desde_db sigue anclando a
`viaje.fechaInicio ?? primer gasto con fecha ?? hoy` (`desde_db.ts:63-64`).

**actualizarFacilidad15 comprueba el error de lectura (MEDIO de la 15) —
CERRADO y verificado.** `repo.ts:924-925`: `if (errLee) throw new
Error('actualizarFacilidad15.leer: …')` — un bache de red ya no se lee como
"la flota no tiene config" y ya no reemplaza la config entera por una llave.
El patrón del repo ("fallar cerrado y decirlo") se aplicó a este escritor.

**El motor ya no convierte "input ausente" en "excede contra $0" (BAJO de la
15) — CERRADO.** Es la misma rama fail-closed de arriba; la nota enseña el $0
a la vista y el estatus sube a `revisar`. El remedio correcto (rama explícita
a `por_confirmar`) existe ahora.

**El best-effort de desde_db ya no declara "no deducible" con ceros (MEDIO de
la 15) — CERRADO.** El `catch` de `desde_db.ts:81-83` sigue inyectando ceros,
pero el motor ahora los rutea a `por_confirmar` con nota honesta. El
comentario del fix —que la 15 demostró falso— ahora describe el código real.

---

## Hallazgos

### [MEDIO] (REINCIDENTE — la tercera superficie del ALTO de la ronda 14 quedó a medias) La píldora y el gauge del recuadro del 15% siguen hablando de "Holgado / Cerca del tope / Excedido" para flotas que declararon NO calificar o que nunca declararon

`src/app/dashboard/contador/combustible/page.tsx:135` (`accion={<StatusPill
estado={ESTADO_TOPE[tope.estado].estado}>{ESTADO_TOPE[tope.estado].texto}</StatusPill>}`)
· `page.tsx:148` (`<Gauge valor={Math.round(tope.razon * 100)} …/>`) · el
`tope` viene de `tope15DeGastos` (`page.tsx:75`), que NO lee `o.elegible15`
(`fiscal.ts:611-619`: suma efectivo/total y llama `evaluarTope15` a ciegas) ·
contraste: el texto bajo el gauge ya interroga la declaración (`page.tsx:154-171`).

**Medido con el módulo real:** flota con `elegible15 = false`, un diésel en
efectivo de $3,000 sobre $3,000 de total →
`tope15DeGastos` devuelve `estado: 'excedido', razon: 1, excedente: 2,550`. El
recuadro pinta la píldora **"Excedido"** (roja) y el gauge al **100%** — para
una flota cuyo efectivo JAMÁS deduce, y debajo el texto honesto "La flota
declaró que NO califica… el combustible en efectivo no es deducible". Con
$500 de efectivo sobre $10,000 (misma función): píldora **"Holgado"** (verde)
— el panel le dice al contador que la flota va holgada bajo una válvula que
declaró no tener. Con `elegible15 = undefined` (el estado de TODOS los
tenants reales según la ronda 14) la píldora dice lo mismo: "Holgado" o
"Cerca del tope" junto al texto "el efectivo sale a revisión en cada
liquidación". La píldora y el texto se contradicen en el mismo recuadro.

**Escenario:** el contador abre el panel de combustible de una flota que
declaró NO calificar (o sin declarar), ve la píldora verde "Holgado" y el
gauge — la lectura rápida de la pantalla — y concluye que el efectivo está
dentro del 15%. El texto debajo lo desmiente, pero la píldora es lo que se
lee primero. La ronda 14 llamó ALTO a esta familia ("una superficie que guía
la decisión afirma un beneficio que el motor no verificó"); el fix curó el
texto y dejó viva la píldora y el gauge. **ABIERTO (residual del ALTO de la
14: 2.5 de 3 superficies cerradas; esta es la mitad que el fix no tocó).**

### [MEDIO] (REINCIDENTE de la ronda 15, 2ª ronda) Deducciones perdidas: `efectivo_no_elegible` sigue fuera de `ORDEN` — la sección "por causa" queda VACÍA con dinero en "perdido", y un diésel en efectivo sin CFDI de flota no elegible sigue contándose como "Se recupera pidiendo la factura"

`src/lib/cuadra/fiscal.ts:354-356` (`const ORDEN` NO incluye
`'efectivo_no_elegible'` — solo `efos, cfdi_cancelado, plazo_vencido,
efectivo_sobre_tope, efos_indeterminado, combustible_efectivo, sin_cfdi`) ·
`fiscal.ts:429` (`porCausa` se filtra por `ORDEN` → el tipo jamás aparece) ·
`fiscal.ts:366` (`causaDominante` cae al fallback `cs[0]` o a `sin_cfdi`) ·
`deducciones/page.tsx:194` (`resumen.porCausa.length > 0 &&` — la sección
entera no se renderiza) · la home del contador consume el mismo resumen
(`contador/page.tsx:97,196`). **ABIERTO.** El fix de la 15 tocó `causasDe`
(separó `false` de `undefined`) pero no `ORDEN` — el tipo se agregó a
`TITULOS` y a `causasDe`, y sigue sin estar donde se decide la dominante y el
desglose.

**Medido con el módulo real** (`resumirPerdidas`, flota no elegible):
- Diésel en efectivo de $1,000 CON CFDI vigente → `montoPerdido = 1,000`,
  dominante `efectivo_no_elegible`, **`porCausa = []`**. El panel imprime
  "Ya no se recupera $1,000.00" y la gráfica/desglose por causa —la fila que
  explica DÓNDE se perdió— no existe. La suma por causa no cuadra con el
  total, que es exactamente lo que la propia pantalla se prohíbe
  (`deducciones/page.tsx:26-30`: "Si las sumas por causa no cuadran con el
  total, el contador lo nota con una calculadora y deja de creerle").
- Diésel en efectivo de $1,000 SIN CFDI → causas
  `[sin_cfdi (recuperable), efectivo_no_elegible (perdida)]` → dominante
  `sin_cfdi` (está primero en `ORDEN` y en `causasDe`) → `montoRecuperable =
  1,000`: el panel le dice al contador "Se recupera pidiendo la factura"
  cuando, aun timbrándolo, el efectivo de una flota no elegible no deduce
  (LISR 27-III sin excepción). La gravedad del dinero queda invertida.

### [MEDIO] (REINCIDENTE de la ronda 15, 2ª ronda — el lado caro sigue abierto) Un gasto de combustible SIN fecha sigue corriendo contra el contador del ejercicio: el fix cerró el gasto de OTRO ejercicio y dejó entrar al que no tiene fecha, que además se resta dos veces del previo

`src/lib/cuadra/cuadre/engine.ts:312-313` (`const anioComprobante = g.fecha ?
g.fecha.slice(0, 4) : null; const mismoEjercicio = !anioComprobante ||
anioComprobante === input.anioEjercicio;` — un gasto sin fecha se declara
"mismo ejercicio" por construcción) · `desde_db.ts:84-88`
(`efectivoDeEsteViaje` filtra por `formaPago` y concepto/clave, SIN mirar
`fecha`) · `desde_db.ts:87` (`efectivoPrevEjercicio = max(0,
totales.efectivo − efectivoDeEsteViaje)`) · la base del 15%
(`getAcumuladoCombustible`, `repo.ts:832-835`) filtra por `fecha` gte/lte del
año, así que un gasto sin fecha NO entra ni al numerador ni al denominador
medidos. **ABIERTO (el fix curó "gasto fechado de otro ejercicio" y dejó
intacto "gasto sin fecha").**

**Escenario A (medido con el motor real, reproduciendo el escenario B de la
ronda 15):** ejercicio 2026; la consulta del contador trae
`efectivo = 14,300` (incluye $500 fechados de ESTE viaje) y
`totalCombustible = 99,000`; este viaje tiene un gasto de diésel en efectivo
de $1,000 SIN fecha (OCR no la leyó). `efectivoDeEsteViaje = 500 + 1,000 =
1,500` → `prev = 14,300 − 1,500 = 12,800` — el gasto sin fecha se resta del
previo aunque la consulta nunca lo incluyó. El motor acumula `12,800 + 1,500
= 14,300` contra un tope de `14,850`: declara **cero exceso** y ambos gastos
"dentro del 15%". El efectivo verdadero del ejercicio es `13,800` (previo
real) `+ 1,500 = 15,300` contra un tope verdadero de `15,000` (el sin-fecha
también es combustible): **el exceso verdadero es $300 y el motor declaró
$0**. La flota cruza el 15% sin que el motor corte, la deducción afirmada no
se sostiene y nadie es avisado: `sin_fecha` se cuenta en el panel
(`fiscal.ts:462`) pero no en el camino del motor.

**Escenario B (medido):** el mismo gasto sin fecha con `prev = 14,800` y
`total = 99,000` produce `efectivo_sobre_15` por $950 — exceso sobre un tope
que excluye $1,000 de base; el exceso verdadero contra el tope real ($15,000)
es $800. La dirección del error cambia con la procedencia del sin-fecha
(previo vs. de este viaje): el contador puede subestimar O sobreestimar el
exceso según el caso, y ninguno de los dos se declara. El fail-closed honesto
sería mandar el gasto sin fecha a `por_confirmar` (como el de otro ejercicio)
— no se puede atribuir a ningún año.

### [MEDIO] (REINCIDENTE de la ronda 15, 2ª ronda) El chat sigue contando con `concepto='diesel'` a secas: el fix de la 15 tocó el año, no las claves del SAT

`src/lib/cuadra/tools.ts:109` (`const acum = await
getAcumuladoCombustible(ctx.tenantId, ejercicio);` — sin el tercer argumento)
· `src/lib/cuadra/repo.ts:826` (sin `claves`, el `.or()` cae a
`concepto.eq.diesel` a secas) · contra `desde_db.ts:78` (el mismo
`getAcumuladoCombustible` PERO con `clavesCombustible`). **ABIERTO.** El
commit 96f2adc dice "tools.ts y desde_db.ts con el MISMO año" — arregló el
año y dejó el criterio de concepto divergente que la ronda 14 ya documentó y
que el doc del deber ser sigue afirmando unificado (ver BAJO #2).

**Escenario:** flota cuyo combustible se captura como `otro`/`factura` con
clave `15101505` (el OCR clasificó distinto el concepto). El motor y desde_db
cuentan esos gastos en el numerador/denominador del 15%; el aviso del chat —la
superficie que le dice al jefe "te quedan $X antes de perder la deducción"—
los ignora. El chat puede decir "vas en 8%" el mismo día en que la
liquidación imprime "el excedente NO se deduce". Sin valores medidos en esta
ronda (la ronda 14 midió $150,000/año omitidos); el defecto es estructural y
sigue en la misma línea.

### [MEDIO] (NUEVO) El aviso del chat afirma "hay pagos de combustible en efectivo" para TODA flota sin declarar, incluso con CERO efectivo en el ejercicio

`src/lib/cuadra/periodo/aviso.ts:32-33` (la rama `elegible === undefined`
devuelve el texto incondicionalmente: `Diésel en efectivo ${ejercicio}: hay
pagos de combustible en efectivo, pero la facilidad…`) · llega al chat por
`tools.ts:119` (`periodo = { …, aviso: avisoTope15(t, ejercicio, elegible) }`)
· la rama `false` (`aviso.ts:29-31`) hace lo mismo con "el efectivo en
combustible no es deducible". El propio contrato de la función dice "En
`holgado` devuelve null a propósito" (`aviso.ts:19-22`) — las dos ramas de la
declaración lo violan: con `elegible15 = undefined` y `efectivo = 0, total =
0` (`evaluarTope15` → estado `holgado`), el aviso sale igual. **ABIERTO
(introducido por el fix de la ronda 14, nunca reportado).**

**Escenario:** un tenant sin declarar (el estado de todos los reales según la
ronda 14) con CERO diésel en efectivo en el ejercicio. El turno del agente
recibe `combustible_efectivo_ejercicio.aviso` afirmando "hay pagos de
combustible en efectivo" — un hecho que nadie midió. Si el agente lo repite,
el jefe recibe por WhatsApp una afirmación fiscal falsa. El texto correcto
sería condicional ("si hay pagos de combustible en efectivo…") o la rama
debería gatear en `efectivo > 0`.

### [BAJO] (NUEVO — regresión del fix 96f2adc) La rama fail-closed del motor hace `continue` y se salta las notas de `monto_discrepante` y `noEsComprobanteFiscal` del mismo comprobante

`src/lib/cuadra/cuadre/engine.ts:324` (`continue;` dentro de la rama
fail-closed) · `engine.ts:381` (`if (extraOcr?.montoDiscrepante)`) ·
`engine.ts:399` (`if (extraOcr?.noEsComprobanteFiscal)`) — las otras ramas del
15% (dentro/excedido/no elegible/por confirmar) NO hacen `continue` y caen a
esas notas. **ABIERTO (introducido por el fix: antes ninguna rama continuaba).**

**Escenario:** el contador del ejercicio está caído (total 0, bache de red) y
el comprobante de diésel en efectivo trae `ocrExtra.montoDiscrepante` (el
total del código no coincide con el del OCR). El gasto va a `por_confirmar`
con la nota honesta de la facilidad — bien — pero SIN la nota de
`monto_discrepante`, que en cualquier otra circunstancia sí se emite. El
contralor recibe la liquidación con el total dudoso sin aviso. Es la misma
dirección que el fix quería eliminar (verdad a medias cuando el contador
falla), en una nota hermana.

### [BAJO] (REINCIDENTE de la ronda 15) `desde_db.ts` — el camino que calcula los insumos del contador — sigue sin UNA sola prueba

No existe `desde_db.test.ts`. Las pruebas nuevas de 96f2adc
(`engine.test.ts:1525-1563`) prueban el motor puro con inputs ya calculados;
los arneses que tocan `cuadrarDesdeDB` (`tools_camino_real.test.ts:53`,
`processor_cadena.test.ts:101`, `guardia.test.ts`, `injeccion.test.ts`)
mockean `getAcumuladoCombustible` con valores fijos. El ancla del ejercicio
(`desde_db.ts:63-64`), el best-effort con ceros (`desde_db.ts:81-83`), la
resta `efectivoDeEsteViaje` (`desde_db.ts:84-88`) y el filtro por fecha —
donde viven los hallazgos MEDIO de esta ronda y de la 14— no se ejecutan en
ninguna prueba. **ABIERTO.**

### [BAJO] (REINCIDENTE de la ronda 15) `getGastos` no trae `.order()`: cuál comprobante "es" el excedente depende del orden no garantizado de la consulta

`src/lib/cuadra/repo.ts:556-562` (`getGastos` sin `.order()`; PostgREST no
garantiza orden sin él) · consumido por `engine.ts:334-336` (la atribución
por comprobante es estrictamente por orden de arreglo). Los MONTOS cuadran,
pero el ticket que carga con el cruce de la frontera puede cambiar entre
corridas: con $1,000+$1,000+$1,000 y tope $1,500, el "excedente de $500" cae
en el segundo o en el primero según el orden. `.order('fecha').order('id')`
lo haría determinístico. **ABIERTO.**

### [BAJO] (REINCIDENTE de la ronda 15) La doc del deber ser sigue afirmando lo que el código no hace: "mismo criterio en motor, panel y chat" y "por_confirmar (B1)"

`docs/fiscal/rfa-2.9-deber-ser.md:86` ("Una sola barrida del ejercicio:
desde_db reusa getAcumuladoCombustible con las claves del SAT (mismo criterio
en motor, panel y chat)") — falso: `tools.ts:109` sigue sin claves ·
`rfa-2.9-deber-ser.md:56` (la fila "Sin permiso CRE | ⚠️ revisar | ❌ | ❌ |
por_confirmar (B1)") — falso: `permiso_cre_no_verificable` NO está en
`POR_CONFIRMAR` (`engine.ts:101`) ni en `REVISAR` (`engine.ts:1155`);
solo se avisa como nota condicionada en `deducibilidad.ts:64`. La sección
"Correcciones de la auditoría 14" (`rfa-2.9-deber-ser.md:74-92`) dice "el
panel del contador… ya no ofrecen el 15% a flotas no elegibles o sin
declarar" — ahora cierto para el TEXTO del panel, pero la píldora y el gauge
lo contradicen (MEDIO #1 de esta ronda). **ABIERTO.**

### [BAJO] (REINCIDENTE de la ronda 15) El commit promete "3,155 verdes" y el fix presume superficies cuyas ramas nuevas no tienen prueba

`src/lib/cuadra/periodo/aviso.test.ts` (las 6 pruebas pasan solo `true` como
tercer argumento — las ramas `false`/`undefined` del fix de la 14 no se
prueban, y el MEDIO #5 de esta ronda existe exactamente donde no hay prueba) ·
`src/lib/cuadra/fiscal.test.ts` (el OPTS de `causasDe`/`resumirPerdidas` solo
trae `elegible15: true`, `fiscal.test.ts:31` — ni `false` ni `undefined`, y
por eso el MEDIO #2 de esta ronda pasó desapercibido) ·
`actualizarFacilidad15` (el `throw` por error de lectura no tiene test) ·
`desde_db` (ver BAJO #4). **ABIERTO.**

### [BAJO] (REINCIDENTE de la ronda 15) La consola de flotas: fijar UNA sola condición borra la declaración entera y el mensaje dice "actualizada"

`src/app/admin/flotas/page.tsx:69` (`return { ok: ded !== undefined ?
'Declaración del 15% actualizada.' : 'Declaración del 15% borrada (sin
declarar).' }`) · `page.tsx:56-62` (`ded = fd.get('ded') === 'si' ? true :
…`, `reg = …` — dos selects independientes de 3 estados) ·
`repo.ts:927-931` (`if (ded !== undefined && reg !== undefined) { escribe }
else { delete }` — el par es atómico: con UNO solo, borra la llave entera).
Con "Carga: Sí" y "Régimen: —" el sistema borra la declaración completa (la
flota pasa a "sin declarar") y le dice al admin "Declaración del 15%
actualizada." — un rótulo que no es verdad. El mensaje honesto existe pero
solo sale cuando la PRIMERA casilla está vacía; si el admin marcó solo la
segunda, el mensaje dice "borrada" y la intención (declarar el régimen) se
perdió en silencio. **ABIERTO.** El fix de la 15 tocó la lectura de
`actualizarFacilidad15` (bien) y no la semántica del formulario.

### [BAJO] (NUEVO) El ancla del año vuelve a divergir cuando `viaje.fecha_inicio` es null: desde_db ancla al año del PRIMER GASTO y tools.ts al año del PROCESO

`src/lib/cuadra/cuadre/desde_db.ts:63-64` (`String((viaje.fechaInicio ??
gastos.find((g) => g.fecha)?.fecha ?? new Date().toISOString()).slice(0, 4))`)
· `src/lib/cuadra/tools.ts:108` (`viajeCtx?.fechaInicio ? Number(…slice(0,
4)) : new Date().getUTCFullYear()`) · `viaje.fecha_inicio` es nullable
(`migraciones/0001_init.sql:53`, `operacion.ts:564` lo escribe `|| null`).
**ABIERTO.** El fix de la 15 unificó el camino feliz y dejó dos fallbacks
distintos para el mismo borde: un viaje creado sin `fecha_inicio` cuyos
gastos son de 2026, liquidado en 2027 — el motor ancla a 2026 (primer gasto)
y el aviso del chat a 2027 (reloj). Es exactamente el bug que 96f2adc
presumía haber cerrado ("dos barridos con dos criterios"), en un caso más
angosto: `desde_db.ts:64` ancla al gasto, `tools.ts:108` al proceso.

---

## Lo que revisé y está bien (el resto del camino)

- **La matriz del motor, intacta y coherente**: elegible+dentro → deducible
  informativo con el contador a la vista; elegible+excede → proporcional por
  comprobante (suma cuadrada, frontera cruzada una vez); no elegible → no
  deducible; sin declarar → por confirmar; contador caído u otro ejercicio →
  por confirmar con nota honesta. `totalDeducible + totalNoDeducible +
  totalPorConfirmar = totalComprobado` en los cruces que medí.
- **El estatus de las tres cubetas del 15%**: `efectivo_sobre_15`,
  `efectivo_no_elegible` y `combustible_efectivo` están en `REVISAR`
  (`engine.ts:1155`); `cierre_aviso.ts:141-144` rutea
  `efectivo_sobre_15`/`efectivo_no_elegible` como `'decision'` (interrumpen al
  jefe) y `combustible_efectivo` como `'panel'`; el panel pinta `revisar` en
  rojo "Por revisar" (`liquidaciones/page.tsx:39`). Medido: los dos casos de
  la ronda 15 siguen en `revisar`.
- **El IVA del efectivo** sigue cerrado en el panel (`fiscal.ts:515`:
  `formaPago '01'` + combustible → `ivaSostenible = false`) y el IEPS del
  diésel exige pago electrónico (`fiscal.ts:541`). Sin regresión.
- **El demo no se rompe**: el diésel del seed es `forma_pago='03'`
  (transferencia), la rama del 15% no se dispara; la facilidad declarada
  (`true`/`true`) es la forma que 0083 exige; `guion_demo.test.ts` (8) verde.
- **El alta tri-estado y 0083** siguen como la ronda 15 los verificó:
  `administracion.ts` solo escribe con AMBOS booleanos; la migración rechaza
  llaves parciales; `actualizarFacilidad15` nunca escribe una forma parcial.
- **`getAcumuladoCombustible` falla cerrado** (`repo.ts:835-839,861-865`):
  lectura incompleta → throw → catch best-effort con `logger.warn` → ahora el
  motor rutea a `por_confirmar`. El rastro existe y el veredicto es honesto.
- **Pruebas del rubro, verdes**: `engine` (117), `fiscal` (57),
  `periodo/combustible` (15), `periodo/aviso` (6), `repo_acumulado` (5),
  `administracion` (27), `processor_cadena` (14), `processor_cierre` (22),
  `cierre_aviso` (30), `avisar_cierre` (9), `tools_cableado` (8),
  `guion_demo` (8), `cifras`/`liquidacion_completa`/`diesel_estimulo`/
  `guardia`/`injeccion`/`migraciones_verificadas` (78) → 386 pruebas en los
  archivos que tocan este rubro, 0 fallos. `npx tsc --noEmit` no lo corrí
  (lo corre otro auditor en paralelo; el build de la ronda 15 estaba limpio y
  el commit c901226 no toca archivos fiscales — solo ARCO, `repo.ts` suma dos
  funciones de ARCO y no modifica ninguna fiscal).
- **El commit de la ronda 16 (c901226)** no toca ninguna superficie fiscal:
  su diff en `repo.ts` solo agrega `resolverSolicitudArco` y ajusta
  `listarSolicitudesArco`; el resto es ARCO/visibilidad/meta. Sin regresión
  fiscal de la ronda 16.
- **No dejé basura**: mis tres archivos de medición (`audit16_fiscal_probe*`,
  `audit16_probe2/3*`) se borraron; los probes `zzz-a16-probe*` de otros
  auditores no los toqué.

## Lo que no alcancé a revisar

- **El render real** (screenshot) del recuadro del 15% con una flota no
  elegible y con una sin declarar: verifiqué las líneas y medí las funciones
  (`tope15DeGastos`, `resumirPerdidas`, `avisoTope15`, el motor), no imprimí
  las pantallas.
- **La base real**: no toqué datos; "todos los tenants reales sin declarar"
  sigue siendo la afirmación de la ronda 14, no una lectura mía; tampoco
  medí si existe algún gasto sin fecha o sin `forma_pago` en producción (los
  dos huecos que mis hallazgos necesitarían para volverse dinero real).
- **La suite completa** (otros auditores la corren; dejé intactos sus probes).
- **El PDF impreso** del caso fail-closed (verifiqué `pdf.ts:429` imprime
  `mxn(d.monto)` = $0.00 junto a la nota honesta — mismo patrón preexistente
  que la rama "sin declarar"; no imprimí el papel).
- **`npx eslint src/`** (lo corre otro auditor; el commit de la ronda 16 no
  toca este rubro).

## Veredicto

**Green light para el demo en su parte fiscal, sin matiz nuevo** — el diésel
del demo es transferencia, la facilidad está declarada en la forma que la
base exige, el viaje demo es de 2026 y ninguno de los hallazgos de esta ronda
toca sus cifras. **Pero la RFA 2.9 sigue sin estar para enseñarse como
terminada.** El balance de la ronda es real: el fail-closed del contador —la
mentira más cara del sistema— cerró con pruebas y honestidad (contador caído u
otro ejercicio → `por_confirmar`, nunca "no deducible contra $0"), y con él
cerraron el "sin declarar = perdida" del panel, el `actualizarFacilidad15` que
borraba configs con un bache de red, y el best-effort que declaraba pérdidas
sobre ceros no medidos. Eso es el motor y el escritor de config, y están bien.

Lo que queda es la familia de siempre, ahora más delgada: la píldora y el
gauge del panel que contradicen el texto honesto que el fix sí escribió
(MEDIO #1); el `efectivo_no_elegible` que sigue fuera de `ORDEN` y hace que la
pantalla que se prohíbe descuadrar descuadre (MEDIO #2); el gasto sin fecha
que sigue corriendo contra un contador que lo excluye de la base — el lado
caro, donde la flota cruza el 15% sin que el motor corte (MEDIO #3); el chat
que sigue sin las claves del SAT (MEDIO #4); y dos MEDIO nuevos: el aviso que
afirma "hay pagos de combustible en efectivo" para toda flota sin declarar
aunque tenga cero (MEDIO #5) y el `continue` del fix que se traga las notas
de monto discrepante y comprobante no fiscal cuando el contador está caído
(BAJO #1).

**Lo que hay que hacer antes de presumir el 15% como completo:** llevar la
declaración al `StatusPill`/`Gauge` del recuadro (o sustituirlos por "No
aplica / Sin declarar"), meter `efectivo_no_elegible` en `ORDEN` (y decidir
su peso frente a `sin_cfdi`), mandar los gastos sin fecha a `por_confirmar`
(o al menos filtrar `efectivoDeEsteViaje` por el mismo año de la consulta),
pasar las claves del SAT al llamador de `tools.ts`, gatear la rama
`undefined` de `avisoTope15` en `efectivo > 0`, quitar el `continue` de la
rama fail-closed, escribir el test de `desde_db` que falta y corregir la doc.
Es trabajo de la semana, no de la víspera del demo — y todo está medido y
localizado para que nadie tenga que volver a buscarlo.
