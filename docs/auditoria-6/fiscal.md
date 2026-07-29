# Cumplimiento fiscal — auditoría 6

**Nota: 5/10** (antes 4). Razón: *se atacó y subió* — los dos CRÍTICOS y (al
menos) dos de los ALTOS de la ronda 5 están cerrados, y los cerré verificando
con el motor real, no leyendo. No sube más porque el ancla del rubro ("3 o
menos si el producto imprime una cifra fiscal equivocada") sigue siendo cierta
por un tercer camino: **el RFC genérico del SAT — que es el default de
`DEMO_CONFIG` — deja pasar un CFDI de tercero como deducible y acreditable**,
exactamente el mismo daño que los dos CRÍTICOS de ayer, solo que por una
puerta distinta. Es *deuda que cobró factura*: estaba anotada como abierta
(AL-6) desde antes de la ronda 5 y sigue abierta hoy.

---

## Lo que cerraron los arreglos de ayer — verificado corriendo el motor real

### CRÍTICO de ronda 5 #1 — el desglose de deducibilidad ya no se descuadra. CERRADO.

`src/lib/cuadra/cuadre/engine.ts:549-586` (proporción del día) ·
`engine.ts:697-727` (las tres cubetas) · `liquidacion/deducibilidad.ts:41-42`
(guardarraíl de suma).

El fix cambió la mecánica exacta que pedía el reporte anterior: el exceso del
tope diario ya no se cuelga del comprobante "ancla" (`delDia[delDia.length-1]`)
para los TOTALES; ahora cada gasto de la cubeta `deducible` se reparte por
`proporcionDia = tope/total`, la MISMA proporción que usa el IVA
(`engine.ts:634`). El ancla sigue existiendo solo para la *nota* de la
diferencia (`engine.ts:576`), no para el dinero.

Reproduje el escenario EXACTO del CRÍTICO 1 anterior contra el código de hoy
(`cuadrarViaje` importado y corrido, no leído):

```
entra: alimentación $2,000 (20-jul, SIN cfdiUuid) + alimentación $100 (20-jul, CON cfdiUuid y XML), tope $750
sale:  totalComprobado 2100 | totalDeducible 35.71 | totalNoDeducible 64.29 | totalPorConfirmar 2000
       suma de las tres cubetas: 2100.00  ·  ninguna negativa  ·  ivaAcreditable 5.71
```

Antes salía `totalDeducible -1250` bajo un comprobado de $2,100, impreso en el
PDF como `$2,000 + $1,350 = $3,350`. Ahora las tres cubetas SIEMPRE suman el
comprobado (probé también un caso con tres comprobantes CFDI del mismo día,
$400+$400+$200, tope $750: `totalDeducible 750, totalNoDeducible 250, suma
1000, ivaAcreditable 120` — exactamente `160×0.75`) y ninguna sale negativa
porque `proporcion = Math.max(0, Math.min(1, ...))` y `proporcionDia` es por
construcción `<1` (solo se calcula cuando `total > tope`, `engine.ts:551`).

También probé el caso mixto que el fix tenía que sobrevivir sin romper: un
gasto `no_deducible` por RFC y otro `deducible`, mismo día, tope excedido —
las cubetas siguen sumando el comprobado exacto (`900+300=1200` →
`750+450+0=1200`), porque el gasto no-deducible entra ÍNTEGRO a su cubeta (no
se le aplica la proporción dos veces) y solo el gasto `deducible` se reparte.

**39 tests de `engine.test.ts` + `deducibilidad.test.ts` (9) +
`acreditable.test.ts` (9) pasan; `deducibilidad.ts:41` sigue siendo el
guardarraíl que hace que un futuro descuadre no se imprima (`return null` si
la suma no cuadra) — ahora además la suma SÍ cuadra en el origen.**

### CRÍTICO de ronda 5 #2 (camino RFC MAL FORMADO) — CERRADO.

`engine.ts:113-148` (`rfcsOk`, `rfcEmpresaInservible`) · `engine.ts:276-282`
(`rfc_receptor_no_verificable`) · `engine.ts:83` (entra a `POR_CONFIRMAR`) ·
`engine.ts:602` (entra a `SIN_ACREDITAMIENTO`).

El nuevo tipo `rfc_receptor_no_verificable` es exactamente el tercer estado
que el reporte anterior pedía: "no se puede confirmar NI descartar → a
revisión". Reproduje el CFDI de $11,600 a un tercero (Office Depot) con
`empresaRfc: 'TIN010101AAA'` (el RFC malformado del tenant de demo,
confirmado en `supabase/seed.sql:26`):

```
totalDeducible 0 · totalPorConfirmar 11600 · ivaAcreditable 0 · diferencias: ['rfc_receptor_no_verificable']
```

Ya no aprueba todo (como el 28-jul) ni rechaza todo (como antes de eso). 6
tests en `rfc_no_verificable.test.ts` cubren los dos extremos que no se podían
perder: RFC válido + receptor distinto sigue `no_deducible`; RFC válido +
receptor correcto sigue `deducible`.

### ALTO de ronda 5 — el estímulo de peaje ya NO se imprime como derecho ganado. CERRADO.

`src/lib/cuadra/liquidacion/acreditable.ts` (archivo nuevo) ·
`liquidacion/pdf.ts:286-317`.

Antes: `pdf.ts` imprimía `Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)
$500.00` en **verde y negritas**, sin decir cuál de las dos bases usó ni
mencionar ninguna de las cuatro condiciones de elegibilidad. Ahora, leyendo el
archivo nuevo línea por línea:

- El label mismo cambió a `"Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) —
  sujeto a elegibilidad"` (`acreditable.ts:113`) — el comentario lo dice
  explícito: *"el renglón es lo que se skimmea, y 'Estímulo de peaje 50%' a
  secas se lee como un derecho ya ganado"*.
- El tono es `'condicionado'`, no `'bueno'` — en `pdf.ts:300` eso significa
  tinta `INK` (neutra), NO `GREEN`. Verifiqué en `pdf.ts:294-300` que el verde
  está reservado a `f.tono === 'bueno'`.
- Se imprimen DOS pies pegados al renglón: `BASE_ESTIMULO_PEAJE` (declara que
  la base es el subtotal SIN IVA y que con IVA la cifra sube ~13.8%, citando
  el hallazgo H4 de la ficha) y `CONDICIONES_ESTIMULO_PEAJE` (las cuatro
  condiciones textuales de `lif-2026-20-A.yaml`, con la frase *"Likida NO
  verifica la elegibilidad"*).

Esto cierra los dos problemas del ALTO anterior (base sin declarar,
elegibilidad sin mencionar) sin resolver la pregunta de fondo de H4 —que la
propia ficha marca `SIN RESOLVER` y dice que es "pregunta para un contador"—,
que ahora es correcto no resolver en código: ya no se afirma en silencio.

### ALTO de ronda 5 — la fecha del complemento de hidrocarburos ya no decide sin ficha. CERRADO.

`normas/rmf-2026-2.7.1.48.yaml:15` (`fecha_vigencia_desde: null`) ·
`src/lib/cuadra/normas/indice.ts:293-308` (`exigibleDesde: null`, espejado) ·
`engine.ts:335-338`.

`engine.ts` ya no lee la fecha dura de `config.ts`; lee
`NORMAS['rmf-2026-2.7.1.48']?.exigibleDesde` (con la ficha como fuente), que
hoy es `null`. Corrí `complemento_exigibilidad.test.ts` (6/6 verde) y el
mismo CFDI de diésel de $5,800 del reporte anterior, movido de 23-abr a
10-may, ya NO cambia de `$5,800 deducible` a `$0`: en ambas fechas sale
`totalDeducible 5800, ivaAcreditable 689.66, litrosDieselAcreditables 200`, y
la única diferencia es que el de mayo entra a revisión
(`complemento_no_verificable`, `estatus: 'revisar'`) en vez de afirmar
`"obligatorio desde 24-abr-2026"` sobre una regla redactada en futuro. El test
`'el día que la ficha traiga la fecha, el veredicto duro se enciende solo'`
prueba que la rama dura sigue viva y correcta (`totalNoDeducible 5800`) el día
que alguien llene la fecha en la ficha — sin tocar el motor.

`config.ts:88` sigue citando "RMF 2.7.1.8" en un comentario (sin ficha), pero
ya NO decide dinero — es, en sus propias palabras, "solo un filtro de ruido".
Es un cabo suelto cosmético, no un hallazgo de dinero.

### MEDIO de ronda 5 (deuda de citas sin ficha) — 3 de 4 saldadas.

`normas/cff-30.yaml` (nueva, `verificado_fuente_primaria`, transcrita del PDF
de diputados.gob.mx, usada por `repo.ts — saveCfdiXmlRaw` y `processor.ts`) y
`normas/cff-89-90.yaml` (nueva, `verificado_fuente_primaria`, usada por
`cuadre/leyendas.ts` para el descargo del pie) están dadas de alta en
`indice.ts:91-112` con sus `citas` correctas. La cuarta cita huérfana
(RMF 2.7.1.8) ya no hace falta que tenga ficha porque dejó de decidir dinero
(ver arriba).

---

## [CRÍTICO, confirmado abierto] El camino del RFC GENÉRICO deja pasar un CFDI de tercero como deducible — y es el default de `DEMO_CONFIG`

`src/lib/cuadra/cuadre/engine.ts:117-148` · `src/lib/cuadra/config.ts:56`
(`empresa: { rfc: 'XAXX010101000' }, // 🔴 demo: RFC genérico`) ·
`src/lib/cuadra/cuadre/rfc_no_verificable.test.ts:64-69` (lo documenta como
"hallazgo abierto") · `AUDIT_V2.md:128` (AL-6).

El arreglo de ayer resuelve el RFC **mal formado**. El de ayer NO toca —a
propósito, y lo dice el propio test— el RFC **genérico del SAT**
(`XAXX010101000`), que es el valor con el que el motor arranca `rfcsOk` vacío
Y `rfcEmpresaInservible = false` al mismo tiempo (`engine.ts:145-148`: la
condición exige `norm(empresaRfc) !== RFC_GENERICO`, y con el genérico eso es
falso). El resultado es que **ninguna** de las dos ramas de validación de RFC
receptor se activa: ni la nueva (`rfc_receptor_no_verificable`) ni la vieja
(`rfc_receptor`).

**Norma comparada** — `normas/liva-5.yaml` (`verificado_fuente_primaria`),
art. 5º fr. I: *"se consideran estrictamente indispensables las erogaciones
efectuadas **por el contribuyente** que sean deducibles para los fines del
impuesto sobre la renta"*; y `normas/lisr-27-III.yaml`: *"estar amparadas con
un comprobante fiscal"* — un CFDI a nombre de otro contribuyente no ampara la
deducción de este.

**Escenario con valores** (corrido contra el motor real de hoy, mismo CFDI de
$11,600 a Office Depot del CRÍTICO de ayer, cambiando solo `empresaRfc` al
GENÉRICO):

```ts
cuadrarViaje({ ..., empresaRfc: 'XAXX010101000', gastos: [CFDI_A_OFFICE_DEPOT] })
```
```
totalDeducible: 11600
totalNoDeducible: 0
totalPorConfirmar: 0
ivaAcreditable: 1600
estatus: con_diferencias   ← (por el sobrante de anticipo, NO por el RFC)
diferencias: [ { tipo: 'anticipo', monto: 8400, ... } ]   ← nada sobre el RFC
```

El PDF imprime `Deducible para ISR $11,600.00` en verde
(`deducibilidad.ts:45-46`, tono `bueno`) e `IVA acreditable (LIVA art. 5)
$1,600.00` en verde (`acreditable.ts:100-106`, tono `bueno`), citando el
artículo, sin una sola palabra sobre el receptor. Es el mismo daño que el
CRÍTICO de ayer, medido con el mismo CFDI.

**Por qué esto no queda en 3, sino en el fondo del 5 global.** Dos cosas lo
distinguen del CRÍTICO de ayer, y ninguna lo cierra:

1. **El tenant sembrado para el demo (`supabase/seed.sql:26`) trae
   `'TIN010101AAA'`, no el genérico** — así que el 6-ago, con esos datos, cae
   en la rama YA CERRADA (`rfc_receptor_no_verificable`), no en esta. Verifiqué
   con `command grep` (dos búsquedas) que no hay otro `insert into tenant` con
   RFC genérico en `seed.sql` ni en `verificaciones.sql`.
2. **Es la ruta que toma automáticamente CUALQUIER tenant nuevo que todavía no
   capturó su RFC real** — que es el estado normal de un cliente el día uno,
   inmediatamente después de una demo exitosa — porque `DEMO_CONFIG.empresa.rfc`
   (el fallback cuando `tenant.rfc` es `null` en la base, `config.ts:56`) ES el
   genérico. No es un caso raro: es el default.

No es una regresión de ayer — es deuda que ya estaba anotada (AL-6) y que
sigue sin atenderse, y el arreglo de ayer, al cerrar la mitad del problema
(el RFC malformado), deja esta mitad como la única puerta que sigue abierta
para la MISMA clase de error.

---

## Trazabilidad: cifra impresa → ficha

| Cifra que ve el contralor | Dónde se imprime | Ficha | Estado de la ficha | Veredicto ronda 6 |
|---|---|---|---|---|
| `Deducible para ISR` / `No deducible` / `Por confirmar` | `pdf.ts:247-264` | `lisr-27-III` + `lisr-28-V` | corroborante / **primaria** | ✅ CERRADO — cubetas siempre suman el comprobado, ninguna negativa (verificado corriendo) |
| `IVA acreditable (LIVA art. 5)` | `pdf.ts:300` / `acreditable.ts:100-106` | `liva-5` | **primaria** | ⚠️ correcto salvo con RFC genérico (CRÍTICO abierto arriba) |
| `Estímulo de peaje 50%... — sujeto a elegibilidad` | `pdf.ts:298-308` / `acreditable.ts:108-117` | `lif-2026-20-A` | **primaria** | ✅ CERRADO — ya no imprime en verde, declara base y las 4 condiciones |
| `Diésel elegible para el estímulo de IEPS` (LITROS) | `pdf.ts:293` / `acreditable.ts:92-98` | `lif-2026-20-A` | **primaria** | ✅ correcto (sin cambios, sigue en litros no pesos) |
| Tope de $750/día de alimentación | `engine.ts:582` (nota) | `lisr-28-V` | **primaria** | ✅ correcto, y ahora el exceso se reparte por proporción sin descuadrar |
| "no deducible (CFF 29-A)" / "revisión" por complemento de hidrocarburos | `engine.ts:351-358` | `rmf-2026-2.7.1.48` + `cff-29-A` | corroborante / corroborante | ✅ CERRADO — la fecha bisagra ahora sale de la ficha (`null` hoy), no de `config.ts` |
| `rfc_receptor_no_verificable` (por confirmar, sin acreditar) | `engine.ts:276-282` | ninguna (nota de calidad de dato, no cita ley) | n/a | ✅ correcto — no afirma nada que no pueda sostener |
| **Camino RFC GENÉRICO: sin ninguna diferencia** | `pdf.ts:247-264` y `:300` | `liva-5` / `lisr-27-III` | primaria / corroborante | ❌ imprime deducible + acreditable sobre un CFDI de tercero (CRÍTICO abierto) |
| Descargo del pie (CFF 89/90) | `pdf.ts:394` / `leyendas.ts` | `cff-89-90` (**nueva**, primaria) | **primaria** | ✅ CERRADO — ya tiene ficha |
| `iepsAcreditable` en pesos | NO SE IMPRIME | `lif-2026-20-A` | primaria | ✅ correcto a propósito (sigue en 0, litros es el dato que se entrega) |

---

## Observación menor, no puntuada: el contador del 15% de RFA 2.9 SÍ existe

El comentario de `engine.ts:194` dice *"El contador del 15% por ejercicio
todavía no existe: ver roadmap"*. Es falso hoy: `src/lib/cuadra/periodo/
combustible.ts` (`evaluarTope15`, con `TOPE_EFECTIVO = 0.15` verificado contra
`rfa-2026-2.9.yaml`) existe desde hace varias rondas y está cableado en
`tools.ts:20-21,68-69` — pero solo llega a la respuesta conversacional del
agente (WhatsApp), NO a `engine.ts` ni al PDF. El `combustible_efectivo` que
imprime el PDF sigue siendo "por confirmar" sin saber si esa flota va al 3% o
al 14.8% del ejercicio. No es un hallazgo de cifra impresa incorrecta —no
imprime nada que no pueda sostener—, es un comentario desactualizado y una
capa que existe pero no llega al papel. Lo dejo anotado, no lo puntúo: no
alcancé a leer `periodo/aviso.ts` completo ni a verificar si el aviso que sí
llega al chat es fiscalmente correcto.

---

## Lo que revisé y está bien (sin cambios desde ronda 5, re-confirmado)

- **El error canónico del IEPS sigue cerrado.** `engine.ts:608`:
  `const iepsAcreditable = 0`. El PDF sigue imprimiendo litros
  (`litrosDieselAcreditables`), nunca pesos, con la nota de cuota semanal
  (`acreditable.ts:76-78`, `NOTA_LITROS_DIESEL`). Sin cambios, sigue correcto.
- **388 pruebas** en `liquidacion/`, `intake/cfdi.test.ts`,
  `facturacion/`, `cuadre/` y `normas/` — todas verdes, corridas por mí, no
  asumidas de la línea base del orquestador.
- `normas_sincronizadas.test.ts` (10/10) sigue forzando que `indice.ts` y los
  YAML no diverjan — incluye ahora `cff-30` y `cff-89-90`.

## Lo que NO alcancé a revisar

Prioricé lo que cambió ayer (proporción, RFC, peaje, fecha del complemento,
fichas nuevas) y confirmé la deuda declarada del RFC genérico. Quedó fuera,
sin verificar en esta ronda:

- **`liquidacion/omitidos.ts`** — no cambió desde ronda 5 (verificado con
  `git log`), pero tampoco lo re-audité; sigue "no verificado" por mí.
- **`laboral/pagadero.ts` contra `lft-110-111-263.yaml`** — no cambió desde
  ronda 5, sin revisar de nuevo.
- **`intake/cfdi.ts` / `intake/sat.ts` contra `cff-29-A.yaml`** — sin cambios
  desde ronda 5 (confirmado con `git log cfae6a1..HEAD`); la ficha sigue
  `evidencia_corroborante` sin texto transcrito, sigue no verificable.
- **`periodo/aviso.ts`** — no lo leí completo; solo até cabos de que
  `evaluarTope15` existe y no llega al PDF.
- **`cuadre/resumen.ts`** — qué cifras fiscales viajan por WhatsApp (fuera del
  PDF) no lo revisé esta ronda.
- **`cuadre/desde_db.ts`** — si un `totalDeducible` reconstruido desde
  Supabase preserva la proporción nueva, no lo comprobé (aunque ya no hay
  escenario que produzca negativo para reconstruir mal).
- **Fichas `texto_vigente: null`** (no verificables esta ronda):
  `cff-29-A`, `criterio-1-CFF-PI`, `criterio-1-LIF-PI`, `rmf-2026-2.7.1.21`,
  `politica-portales-plazos`.
