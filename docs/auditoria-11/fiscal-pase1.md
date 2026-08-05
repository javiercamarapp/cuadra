# Cumplimiento fiscal — auditoría 11

**Nota: 3/10** (antes 5). Razón del movimiento: **deuda que cobró factura**.

La nota de 5 se puso sobre el árbol del PR #7, **con los arreglos dentro**. Este
árbol es `master` —lo que Vercel despliega y lo que se enseña el 6-ago— y no los
tiene. Reproduje ejecutando el motor real que en `master`:

- un CFDI cuyo emisor el SAT marca en EFOS sale **`Deducible para ISR $11,600.00`
  en verde con `IVA acreditable $1,600.00`** (el crítico FISCAL-1, que la
  auditoría 9 cerró y la 10 verificó cerrado — en la otra rama);
- el diésel con `FormaPago 99` vuelve a acreditar **200 litros** del estímulo del
  LIF 20-A (el crítico FISCAL-2, idem);
- el tenant del demo sigue con el RFC que nuestro propio validador rechaza.

El ancla del rubro es explícita: *"3 o menos si el producto imprime una cifra
fiscal equivocada"*. Imprime dos, y una de ellas es el veredicto más caro que el
motor sabe dar, invertido.

**El riesgo mayor del rubro, hoy:** `intake/sat.ts:82` no puede emitir
`efos: true` bajo ninguna respuesta del SAT, así que el ÚNICO camino de EFOS que
existe en producción es `cfdi_efos_indeterminado` — y ese veredicto no está ni en
`POR_CONFIRMAR` ni en `SIN_ACREDITAMIENTO`. La lista negra del art. 69-B, para
este árbol, es una nota al pie sobre una cifra afirmada en verde.

---

## Cómo verifiqué

Motor bundleado fuera del repo con `esbuild` (`--alias:@=./src`, stubs de `sharp`
y `zxing-wasm`) y ejecutado con node desde el scratchpad. **Todo lo que aparece
como "sale" es salida medida** de `cuadrarViaje`, `filasDeducibilidad`,
`filasAcreditables`, `evaluarTope15` y `avisoTope15` — no lectura de código. No
edité ni un archivo del repo fuera de éste.

Compuerta de partida verificada hoy: `npx vitest run` → **172 archivos / 1670
pruebas verdes, 1 saltada**. Todo lo de abajo pasa la suite.

Fichas: **21** en `normas/`, de las que 17 son de mi rubro (las 4 `lfpdppp-*` son
del auditor legal). `verificado_fuente_primaria` 12 · `evidencia_corroborante` 4 ·
`sin_verificar` 1.

---

## Hallazgos

### [CRÍTICO] (REINCIDENTE) Un CFDI cuyo emisor el SAT reporta en EFOS imprime `Deducible para ISR $11,600.00` en verde y `IVA acreditable $1,600.00`, porque el único veredicto de EFOS que el producto puede emitir no está en ninguna de las dos listas duras

`src/lib/cuadra/intake/sat.ts:82` y `:84` · `src/lib/cuadra/cuadre/engine.ts:86`
(`POR_CONFIRMAR`), `:407-408`, `:866` (`SIN_ACREDITAMIENTO`) ·
ficha `normas/cff-69-B.yaml` (**`verificado_fuente_primaria`**, transcrita del PDF
de diputados.gob.mx, última reforma DOF 09-04-2026)

Texto de la norma, 3er párrafo transcrito en la ficha, literal:

> «Los efectos de la publicación de este listado serán considerar, **con efectos
> generales, que las operaciones contenidas en los comprobantes fiscales expedidos
> por el contribuyente en cuestión no producen ni produjeron efecto fiscal
> alguno**.»

y la `nota_verificacion` de la propia ficha: *«De ahí que el veredicto sea duro y
no "por confirmar"»*.

**Código.** `sat.ts:82` sólo puede devolver `false` (códigos `200`/`201`) o `null`:

```ts
82:  const efos = !efosCode ? null : EFOS_LIMPIO.has(efosCode) ? false : null;
84:  const efosDesconocido = !!efosCode && !EFOS_LIMPIO.has(efosCode);
```

`efos: true` es **inalcanzable desde producción**. El comentario de `:66-79` lo
explica y es una decisión defendible (no declarar fraude sobre un presunto), pero
deja `cfdi_efos_indeterminado` como el único camino real — y ese tipo no aparece
en `engine.ts:86` (`POR_CONFIRMAR = ['combustible_efectivo',
'rfc_receptor_no_verificable']`) ni en `engine.ts:866` (`SIN_ACREDITAMIENTO`).
Sólo está en `REVISAR` (`:1029`), que mueve el estatus y **ninguna cifra**.

**Escenario (ejecutado).** Factura de $11,600, UUID válido, `estadoSat: 'vigente'`,
receptor = RFC de la flota, XML verificado, IVA $1,600, `formaPago '03'`; el SAT
devuelve un `ValidacionEFOS` distinto de 200/201 (`efosRevisar: true`):

```
difs: [cfdi_efos_indeterminado]   estatus: revisar
totalDeducible 11,600 · totalNoDeducible 0 · totalPorConfirmar 0 · ivaAcreditable 1,600
DEDUC → [ 'Deducible para ISR', 11600, tono 'bueno' ]          → GREEN (pdf.ts:295)
ACRED → [ 'IVA acreditable (LIVA art. 5)', '$1,600.00', 'bueno' ] → GREEN (pdf.ts:348)
```

Control con `efos: true` (la rama que producción no puede alcanzar):
`deducible 0 · noDeducible 11,600 · IVA 0`. **El mismo hecho jurídico produce dos
veredictos que difieren en $11,600 de deducción y $1,600 de IVA según por cuál de
las dos puertas entre — y la puerta que el SAT abre de verdad es la equivocada.**

Anoto lo que sí funciona, porque es donde se ve el hueco: la cadena de datos está
completa (`sat.ts:84` → `ocr.ts:356` → `repo.ts:135` / `:528` → `engine.ts:407`).
No falta plomería; faltan dos entradas en dos arreglos.

**Consecuencia:** el contralor archiva un PDF que afirma $11,600 de deducción y
$1,600 de IVA recuperable sobre un comprobante que, si el emisor está en el
listado definitivo del 69-B, **no produce ni produjo efecto fiscal alguno**. En
una revisión, ese papel es la prueba de que alguien se lo dijo por escrito. Y por
`resumen.ts:25`, `cfdi_efos_indeterminado` está en `SOLO_CONTRALOR`: al operador
ni siquiera se le menciona.

**Causa raíz probable:** el arreglo de `sat.ts` (auditoría 9) movió el único
camino vivo de EFOS del tipo duro al indeterminado, y las dos listas de
`engine.ts` se quedaron apuntando al tipo que ya nadie emite.

---

### [CRÍTICO] (REINCIDENTE) El tenant del demo trae un RFC que nuestro propio validador rechaza: la liquidación del 6-ago imprime `Por confirmar $5,600.00`, cero deducible, sin sección ACREDITABLE — y el único pie que sale es falso

`supabase/seed.sql:26` (`'TIN010101AAA'`) · `src/lib/cuadra/config.ts:186-215` ·
`src/lib/cuadra/cuadre/desde_db.ts:50` · `src/lib/cuadra/cuadre/engine.ts:188-231`
· `src/lib/cuadra/liquidacion/deducibilidad.ts:74-80` ·
ficha `normas/liva-5.yaml` (**`verificado_fuente_primaria`**)

Texto de la norma, fracción I, literal:

> «...se consideran estrictamente indispensables las erogaciones efectuadas por el
> contribuyente **que sean deducibles para los fines del impuesto sobre la renta**,
> aun cuando no se esté obligado al pago de este último impuesto.»

**Verificado con nuestro propio validador:** `esRfcValido('TIN010101AAA') = true`,
`rfcChecksumOk('TIN010101AAA') = false` (medido; el dígito esperado es `5`, no
`A`). `getConfig` lo pasa tal cual (`config.ts:215`) y sólo lo registra en un log
del servidor (`:192-197`); `engine.ts:193` lo descarta, `rfcsOk` queda vacía y
`rfcEmpresaInservible` se vuelve `true` (`:228`).

**Escenario (ejecutado con los dos gastos exactos de `seed.sql:121-130`):**
diésel $4,200 (`15101505`, complemento HidroYPetro, `FormaPago 03`, IVA $581.38,
IEPS $408.62, XML verificado) + caseta $1,400 (subtotal $1,206.90, IVA $193.10,
`FormaPago 04`, XML verificado), anticipo $10,600:

```
difs: sobre_politica, rfc_receptor_no_verificable ×2, permiso_cre_no_verificable, anticipo
totalDeducible 0 · totalNoDeducible 0 · totalPorConfirmar 5,600
ivaAcreditable 0 · peajeAcreditable 0 · litrosDieselAcreditables 0

DEDUC → [{ label:'Por confirmar', monto:5600, tono:'pendiente',
           pie:'Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar.' }]
ACRED → null
```

Control con el mismo par de CFDI y un RFC de flota que sí pasa el dígito
verificador (`TIN010101AA5`): `deducible 5,600 · IVA 774.48 · peaje 603.45`, y la
sección ACREDITABLE aparece con dos renglones. **La diferencia entre las dos
salidas es un solo carácter en `seed.sql`.**

Tres consecuencias, todas en el papel que se proyecta:

- el renglón `Deducible para ISR` **no se imprime** (`deducibilidad.ts:58`, está
  en $0);
- la sección **ACREDITABLE / RECUPERABLE** —la que `acreditable.ts:1-12` llama
  "la sección que vende"— devuelve `null` y desaparece del PDF entero
  (`pdf.ts:335`); en `dashboard/page.tsx:238-247` las tres tarjetas quedan en cero
  y el bloque "Acreditable (recuperable)" de WhatsApp (`resumen.ts:89-97`) no sale;
- el único pie que sí se imprime **es falso**: dice *"Falta timbrar la factura"*
  sobre dos comprobantes timbrados y vigentes ante el SAT. Lo que falta es el RFC
  de la flota, y el papel no lo dice.

**Consecuencia:** el 6-ago el contralor ve un documento que, sobre $5,600 de
comprobantes impecables —CFDI, XML, complemento de hidrocarburos, IEPS e IVA
desglosados, pago por transferencia—, no le afirma un peso de deducción ni de IVA
recuperable, y le da una razón que él desmiente mirando sus propios CFDI.

**Causa raíz probable:** el RFC de demo se escribió como texto plausible y nunca
se pasó por `rfcChecksumOk`; el motor hace lo correcto, el dato de entrada es el
que no sirve. *(La mitad honesta: fiscalmente el veredicto es defensible. Lo que
lo vuelve crítico es que TODAS las cifras fiscales del demo cuelgan de ese único
dato y que el papel explica mal por qué.)*

---

### [ALTO] (REINCIDENTE) LISR 27-III está implementado como "no es efectivo": un diésel con `FormaPago 99` (el CFDI a crédito de una gasolinera) sale `Deducible para ISR $5,400` con `IVA acreditable $744.83` en verde

`src/lib/cuadra/cuadre/engine.ts:271` y `:273` ·
fichas `normas/lisr-27-III.yaml` (`evidencia_corroborante`) y
`normas/rfa-2026-2.9.yaml` (**`verificado_fuente_primaria`**, leída en el DOF/SIDOF)

`rfa-2026-2.9.yaml`, `texto_vigente`, literal — es la fuente primaria que define
la lista cerrada por su complemento:

> «...considerarán cumplida la obligación establecida en el artículo 27, fracción
> III, segundo párrafo de la Ley del ISR, cuando los pagos por consumo de
> combustible se realicen **con medios distintos a cheque nominativo de la cuenta
> del contribuyente; tarjeta de crédito, de débito o de servicios; o monederos
> electrónicos autorizados por el SAT**, siempre que estos no excedan el 15 por
> ciento del total de los pagos efectuados por consumo de combustible...»

y `lisr-27-III.yaml`, 2º párrafo:

> «Tratándose de la adquisición de combustibles para vehículos marítimos, aéreos y
> terrestres, **el pago deberá efectuarse en la forma señalada en el párrafo
> anterior, aun cuando la contraprestación de dichas adquisiciones no excedan de
> $2,000.00**...»

**Código:** el motor sólo reconoce como "medio que no cumple" el literal `'01'`:

```ts
271:  if (g.formaPago === '01' && esCombustible) { ... combustible_efectivo ... }
273:  } else if (g.formaPago === '01' && !esCombustible && g.monto > topeEfectivo) { ... }
```

**Escenario (ejecutado).** Diésel de $5,400, `15101505`, `tipoComprobante 'I'`,
complemento presente, XML verificado, receptor = RFC de la flota, IVA $744.83,
IEPS $400, `ocrExtra.litros = 200`. Barrido de los 13 códigos de `c_FormaPago`:

```
FP 01  → ded 0        · porConfirmar 5,400 · IVA 0      · litros 0   · estatus revisar
FP 03,04,02,05,28     → ded 5,400 · IVA 744.83 · litros 200          (correcto: la lista cerrada)
FP 99,17,12,15,23,30,06 → ded 5,400 · IVA 744.83 · litros 200        ← ninguna diferencia sobre el pago
   DEDUC: ['Deducible para ISR — sujeto a permiso CRE vigente', 5400, 'condicionado']
   ACRED: ['IVA acreditable (LIVA art. 5)', '$744.83', 'bueno'] → GREEN
```

Alcance: `12` dación en pago, `15` **condonación** (nadie pagó nada), `17`
compensación, `23` novación, `30` aplicación de anticipos, `06` dinero
electrónico, y sobre todo **`99` "Por definir"**, que es el valor obligatorio en
todo CFDI con `MetodoPago = PPD` — el CFDI que emite una gasolinera a una flota
que compra a crédito.

El mismo hueco en el 1er párrafo: hospedaje de $5,000 con `FormaPago 17` (medido)
→ `Deducible para ISR $5,000` tono `bueno` (**verde**) + `IVA acreditable $689.66`
verde, sin una sola diferencia fiscal.

**Consecuencia:** el contralor archiva un papel que afirma $5,400 de deducción y
$744.83 de IVA sobre una compra de combustible cuyo medio de pago no está en la
lista del 2º párrafo — o que, en PPD, todavía no se ha pagado. Si el pago cae
fuera del 15% de la RFA 2.9 la deducción no procede, y el IVA tampoco (LIVA 5-I:
lo indispensable **es** lo deducible para ISR). El motor ya tiene el tercer estado
escrito y probado para esto: `combustible_efectivo`.

**Causa raíz probable:** "efectivo" se usó como sinónimo de "medio de pago que no
cumple", cuando la norma define lo contrario — una lista cerrada de lo que sí
cumple.

---

### [ALTO] (REINCIDENTE) El estímulo de diésel del LIF 20-A acredita 200 litros con `FormaPago 99`, `17` o `15`: `pagoElectronico` es literalmente "no es 01"

`src/lib/cuadra/cuadre/engine.ts:929` · ficha `normas/lif-2026-20-A.yaml`
(**`verificado_fuente_primaria`**) · contraste: `engine_diesel_medio_pago.test.ts:13-18`

```ts
929:  const pagoElectronico = !!g.formaPago && g.formaPago !== '01';
```

El propio archivo de prueba de esta regla enumera la lista cerrada **en prosa**
(`:13-18`): *«el pago tiene que ser con monedero electrónico autorizado, tarjeta,
cheque nominativo o transferencia»*, y en `:84-89` afirma `02, 03, 04, 05, 28` →
200 L. **Nunca pregunta por un código fuera de ese conjunto**, y por eso los 1,670
tests están verdes sobre el complemento equivocado.

**Escenario (ejecutado).** El mismo diésel de $5,400 / 200 L de arriba:

```
FP 01  → litrosDieselAcreditables 0    (bien)
FP 99  → litrosDieselAcreditables 200  ← CFDI PPD: todavía no se ha pagado
FP 15  → litrosDieselAcreditables 200  ← condonación: no hubo pago
ACRED → 'Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A)'  200 L
```

Los litros son **el dato duro que el contador multiplica por la cuota semanal del
DOF**. Con la cuota de referencia que la propia ficha `criterio-1-LIF-PI` cita
($2.09–$7.36/L durante 2026), esos 200 L de más son entre $418 y $1,473 de
estímulo reclamado sin derecho, por carga.

**Consecuencia:** la flota reclama un acreditamiento sobre combustible que no
pagó por un medio admitido, con un papel que Likida le dio. El criterio
`1/LIF/PI` del Anexo 3 alcanza a "quien preste servicios": la práctica indebida
sería de Likida, no del cliente.

**Causa raíz probable:** el mismo error del hallazgo anterior, en la otra mitad
del comprobante. *(Nota de contexto, no de mérito: este renglón se corrigió el
2-ago con la lista `MEDIOS_LIF_20A`; grepeado hoy, `MEDIOS_LIF_20A` **no existe en
`master`**. Lo que producción despliega es la versión previa al arreglo.)*

---

### [ALTO] El contador del 15% de la RFA 2.9 cuenta como "efectivo" únicamente `forma_pago = '01'`: una flota que compra TODO su diésel a crédito sale `holgado` y el aviso es `null`

`src/lib/cuadra/repo.ts:790` (`if (g.forma_pago === '01') efectivo += monto;`) ·
`src/lib/cuadra/periodo/combustible.ts:69-91` · `src/lib/cuadra/periodo/aviso.ts:22-25`
· `src/lib/cuadra/tools.ts:104-107` ·
ficha `normas/rfa-2026-2.9.yaml` (**`verificado_fuente_primaria`**) · **NUEVO**
(módulo `periodo/`, de los 40 commits de `master` que nadie había auditado)

El texto de la ficha, citado arriba, no dice "efectivo": dice **«medios distintos
a cheque nominativo de la cuenta del contribuyente; tarjeta de crédito, de débito
o de servicios; o monederos electrónicos autorizados por el SAT»**. El numerador
del 15% es todo lo que cae fuera de esa lista, no sólo `c_FormaPago 01`.

**Escenario (ejecutado con `evaluarTope15` + `avisoTope15`).** Flota que compró
$1,000,000 de diésel en el ejercicio 2026: $800,000 por transferencia y $200,000
facturados como PPD (`FormaPago 99`, compra a crédito en la estación), cero pesos
con `FormaPago 01`:

```
acumulado leído por repo.ts:790 → { efectivo: 0, totalCombustible: 1,000,000 }
evaluarTope15 → { razon: 0, estado: 'holgado', excedente: 0, margen: 150,000 }
avisoTope15   → null          ← el producto no dice absolutamente nada
```

Lo que la regla dice: $200,000 / $1,000,000 = **20% > 15%** → `excedido`, y por el
propio criterio del módulo (`combustible.ts:88`) **$50,000 del combustible del
ejercicio dejan de ser deducibles**. El producto reporta lo contrario del signo
correcto y guarda silencio.

Segundo hueco en la misma consulta: `repo.ts:775` filtra `.eq('concepto',
'diesel')`, mientras `engine.ts:260` define combustible como
`concepto === 'diesel' || h.claves.includes(claveProdServ)`. Un CFDI de gasolina
que llega por XML sin foto entra como `diesel` (`concepto.ts:48`) — bien — pero
uno clasificado por otra vía queda fuera del numerador Y del denominador sin que
nada lo diga.

**Consecuencia:** el contador del 15% es, según `FISCAL_LEGAL.md:52`, *"aquí es
donde Likida gana"*. Sobre la flota cuyo caso el propio repo describe —"compra
diésel a crédito en la estación y factura exactamente así"— el contador está
ciego: la flota cruza el 15% sin un aviso y descubre la pérdida de deducción con
su contador, en la anual.

**Causa raíz probable:** la misma conflación "efectivo = 01" de los dos hallazgos
anteriores, ahora heredada desde `docs/fase1/spec-contadores-periodo.md:66-69`,
que escribe la fórmula con `formaPago = '01'` en el numerador aunque cita bien el
texto de la regla tres líneas antes.

---

### [ALTO] (REINCIDENTE, alcance ampliado) El estímulo de peaje sale afirmado en verde en CUATRO pantallas y en WhatsApp, citando el artículo, sin ninguna de las cuatro condiciones que el PDF sí imprime

`src/app/dashboard/page.tsx:245-246` · `src/app/dashboard/[id]/page.tsx:211` ·
`src/app/dashboard/facturacion/page.tsx:98` ·
`src/app/dashboard/combustible-casetas/page.tsx:85` ·
`src/lib/cuadra/cuadre/resumen.ts:96` · contraste:
`src/lib/cuadra/liquidacion/acreditable.ts:110-119` ·
ficha `normas/lif-2026-20-A.yaml` (**`verificado_fuente_primaria`**)

`estimulo_peaje.texto_vigente`, literal:

> «Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
> **exclusivamente** al transporte terrestre público y privado, de carga o pasaje,
> así como el turístico, **que utilizan la Red Nacional de Autopistas de Cuota**,
> que obtengan en el ejercicio fiscal... **ingresos totales anuales para los
> efectos del impuesto sobre la renta menores a 300 millones de pesos**... **El
> estímulo no podrá ser aplicable por las personas morales que se consideran
> partes relacionadas** de acuerdo con el artículo 179 de la Ley del Impuesto
> sobre la Renta.»

y sus hallazgos abiertos `H5` (*"Aplica el 50% a TODO gasto con concepto
'caseta'"*, `engine.ts:902`) y `H6` (*"No conoce los ingresos de la flota ni su
relación de partes"*).

**Código.** El PDF cumple la regla que `acreditable.ts:9-11` fija: label
`'Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad'`, tono
`condicionado` (tinta neutra, `pdf.ts:348`) y dos pies, uno de los cuales dice
literal **"Likida NO verifica la elegibilidad"** y transcribe las cuatro
condiciones. Las otras cinco superficies no:

```tsx
dashboard/page.tsx:245        etiqueta="Peaje (50%)" ... nota="Estímulo de autopistas · LIF 2026, Art. 20-A"
dashboard/[id]/page.tsx:211   {d.peaje > 0 && <Tot label="Peaje 50%" value={mxn(d.peaje)} ok />}   // ok → --color-ok
facturacion/page.tsx:98       etiqueta="Peaje acreditable (50%)" ... nota="LIF 2026, Art. 20-A"
combustible-casetas:85        nota="LIF 2026, Art. 20-A"
resumen.ts:96                 lines.push(`• Peaje 50%: ${mxn(liq.peajeAcreditable)}`)
```

**Escenario (ejecutado, la caseta exacta de `seed.sql:127-129`).** $1,400 con XML
verificado y subtotal $1,206.90, con el RFC de la flota corregido →
`peajeAcreditable = 603.45`.

```
PDF     → 'Estímulo de peaje 50% ... — sujeto a elegibilidad'  $603.45 · tinta neutra
          pies: base usada + las 4 condiciones + 'es ingreso acumulable'
Panel   → 'Peaje (50%)  $603.45'   sin una sola reserva  (×4 pantallas)
WhatsApp→ '• Peaje 50%: $603.45'
```

Lo nuevo de esta ronda: `master` añadió `facturacion` y `combustible-casetas`, así
que el reincidente pasó de 3 superficies a 5. **Ninguna de las cuatro nuevas
consultó `acreditable.ts`.**

**Consecuencia:** el panel es lo que se proyecta en la sala y el mensaje de
WhatsApp es lo que el contralor reenvía. Una flota con ingresos ≥ $300M, o parte
relacionada, o que usó casetas fuera de la Red Nacional, se lleva la cifra
afirmada con el artículo al lado. El criterio 1/LIF/PI alcanza a "quien preste
servicios".

**Causa raíz probable:** la regla vive dentro de `acreditable.ts` (el armador de
renglones del PDF) y las demás superficies leen los números crudos de
`Liquidacion`; nada impide añadir una sexta.

---

### [MEDIO] El "margen" del 15% que el aviso llama "lo accionable" no es el margen: dice `$30,000` donde caben `$35,294.12`

`src/lib/cuadra/periodo/combustible.ts:89` · `src/lib/cuadra/periodo/aviso.ts:29`
· `src/lib/cuadra/periodo/combustible.test.ts:67-72` ·
ficha `normas/rfa-2026-2.9.yaml` (**`verificado_fuente_primaria`**) · **NUEVO**

La regla, literal: los pagos fuera de la lista valen *«siempre que estos no
excedan el 15 por ciento del **total de los pagos efectuados por consumo de
combustible**»*. El denominador **incluye** esos mismos pagos.

```ts
89:  margen: round2(Math.max(0, permitido - efectivo)),   // permitido = total × 0.15
```

Eso responde a *"¿cuánto le falta al numerador para llegar al 15% del total
actual?"*. La frase que se imprime pregunta otra cosa: cuánto efectivo **más**
cabe — y ese gasto adicional entra también al denominador. La respuesta correcta
es `(0.15·total − efectivo) / 0.85`.

**Escenario (ejecutado).** Flota con $1,000,000 de combustible en el ejercicio,
$120,000 de ellos con `FormaPago 01`:

```
evaluarTope15 → { razon: 0.12, estado: 'cerca', margen: 30,000 }
avisoTope15   → "Diésel en efectivo 2026: te quedan $30,000.00 antes de perder la
                 deducción. Vas en 12.0% del 15.0% que permite la RFA 2026 regla 2.9..."
correcto      → (150,000 − 120,000) / 0.85 = $35,294.12
```

Diferencia: **$5,294.12**, el 17.6%. La prueba `combustible.test.ts:67-72` fija el
valor equivocado con el comentario *"Es lo accionable para el contralor"*.

**Consecuencia:** el error es del lado conservador (nadie pierde una deducción por
esto), y por eso es MEDIO y no ALTO. Pero es una cifra en pesos, con la regla
citada al lado, entregada como la única acción concreta del módulo; el contralor
que la reproduzca con su contador encontrará que no cuadra, y lo que se pone en
duda es el resto del papel.

**Causa raíz probable:** se resolvió la desigualdad tratando el denominador como
constante cuando la variable aparece en los dos lados.

---

### [MEDIO] (REINCIDENTE, agravado) Un hospedaje de $1 sin timbrar apaga las DOS advertencias de LISR 28-V — y ahora deja la liquidación en `cuadrada`

`src/lib/cuadra/cuadre/engine.ts:681` y `:730` ·
ficha `normas/lisr-28-V.yaml` (**`verificado_fuente_primaria`**)

Texto, 2º párrafo, literal:

> «...y el contribuyente acompañe **el comprobante fiscal o la documentación
> comprobatoria que ampare el hospedaje o transporte**. Cuando a la documentación
> que ampare el gasto de alimentación el contribuyente únicamente acompañe el
> comprobante fiscal relativo al transporte, la deducción... **sólo procederá
> cuando el pago se efectúe mediante tarjeta de crédito de la persona que realiza
> el viaje**.»

**Código:** las dos condiciones se evalúan por existencia de un `concepto`, sin
mirar `cfdiUuid` ni monto:

```ts
681:  const haySoporte = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
730:  const hayHospedaje = vivos.some((g) => g.concepto === 'hospedaje');
```

**Escenario (ejecutado):**

```
comida $700 timbrada, sola                       → ['alimentacion_sin_soporte']  estatus REVISAR
+ hospedaje de $1 SIN UUID, sin RFC, sin XML     → []                            estatus CUADRADA

comida $700 con formaPago '28' + transporte $450 timbrado, sin hospedaje
                                                 → ['alimentacion_transporte_sin_tarjeta_credito']
+ el mismo hospedaje de $1 sin timbrar           → []
```

Sobre lo que reportó la ronda anterior: aquí el estatus no cae a
`con_diferencias`, cae a **`cuadrada`** — la liquidación sale entera en verde. El
mismo renglón de $1 que el motor acaba de clasificar en `por confirmar` con el pie
"Falta timbrar la factura" apaga la única señal que el producto emite sobre el
requisito de soporte de LISR 28-V.

**Consecuencia:** la señal se apaga con el gasto más barato y menos formal de la
liquidación, sobre un dato que el operador controla (mandar una foto etiquetada
"hospedaje"). Como el motor advierte en vez de quitar deducción, apagarla no deja
rastro en ninguna cifra: el contralor no puede notar que faltó.

**Causa raíz probable:** el soporte se modela por existencia de un concepto, no
por que exista un comprobante que ampare algo.

---

### [MEDIO] (REINCIDENTE) 34 de 38 comercios caen en la rama que afirma una fecha límite sin decir que el plazo legal es todo el ejercicio — y esa fecha no la sostiene ninguna ficha

`src/lib/cuadra/cuadre/engine.ts:623-625` y `:645` ·
`src/lib/cuadra/facturacion/comercios.ts` · fichas
`normas/politica-portales-plazos.yaml` (**`sin_verificar`**) y
`normas/rmf-2026-2.7.1.21.yaml` (`texto_vigente: null`)

Conteo de hoy sobre el archivo: **38** entradas, `plazoVerificado: true` en **4**,
`false` en **34**.

`politica-portales-plazos.yaml`, `advertencia_de_jerarquia`, literal:

> «ESTO NO ES UNA NORMA FISCAL. Es la política interna de un tercero y tiene CERO
> fuerza legal. **El plazo LEGAL para pedir factura es todo el ejercicio** (el SAT
> lo dice expresamente), y negarla porque "ya pasó el mes" es una práctica
> indebida listada por el propio SAT... El producto NUNCA debe presentar estos
> plazos como una obligación fiscal.»

y `normas/README.md:55`, literal: «Ninguna ficha `sin_verificar` debe sostener una
cifra que el producto imprima.»

**Código:** el matiz legal es propiedad de `cierreComercio`, que sólo existe
cuando el plazo está verificado (`:623-625`).

**Escenario (ejecutado).** Ticket de diésel de $3,200 del 1-ago-2026, emisor Shell
(`plazoVerificado: false`), `hoy = '2026-08-04'`. Texto impreso medido:

> «Combustible de $3,200.00 sigue sin factura: **puedes timbrarlo hasta el
> 2026-08-31 (27 días)**, y la ventana del comercio puede ser menor. Portal de
> Shell México: https://facturacion.shell.com.mx/.»

Ni "no de la ley" ni "dentro del ejercicio". La fecha `2026-08-31` es el default
`mes_natural` (`engine.ts:600`), cuyas dos fichas son `sin_verificar` y
`texto_vigente: null`.

**Consecuencia:** el contralor lee una fecha con la autoridad de un cálculo y da
por perdido el 1-sep un CFDI que puede exigir todo el ejercicio, con Conciliación
de Factura. En diésel eso es la deducción y el IVA del gasto más grande de la
flota.

---

### [MEDIO] `FISCAL_LEGAL.md` pone el contador del 15% "por mes" cuando la ficha `verificado_fuente_primaria` lo pone por ejercicio — y es la frase que el documento usa para vender

`FISCAL_LEGAL.md:49-53` y `:196` · ficha `normas/rfa-2026-2.9.yaml`
(**`verificado_fuente_primaria`**) · **NUEVO** (4ª ronda sin auditar este archivo)

Texto de la norma, literal: *«siempre que estos no excedan el 15 por ciento del
total de los pagos efectuados por consumo de combustible **para realizar su
actividad**»*, y `condiciones_de_aplicacion` de la misma ficha: *«El efectivo no
puede exceder el 15% del total pagado por combustible **en el ejercicio**»*.

El documento comercial dice:

```
:49  **Lo que Likida tiene que hacer con esto:** llevar el contador. *"Llevas 11.4% de
:50  tu diésel en efectivo **este mes**; el tope es 15%."*
...
:196 | Cuadre | Falta el **contador del 15% de combustible en efectivo** por flota y **por mes**.
```

**Escenario:** una flota con 14% de efectivo en cada mes de enero a noviembre y
25% en diciembre. Leído "por mes", once meses salen tranquilos y sólo diciembre
avisa; leído por ejercicio —que es la unidad de la regla— el acumulado es ~14.9%
y el aviso tenía que salir en octubre. Al revés también: un mes con 18% sobre una
flota que cierra el año en 9% dispararía una alarma que la regla no sostiene.

**Consecuencia:** es la frase con la que el equipo le explica al contralor la
única pieza que el documento llama *"aquí es donde Likida gana"* (`:52`). Prometer
en la sala una medición mensual sobre una regla anual es exactamente el error que
la ficha `criterio-1-LIF-PI` describe: no es un error del cliente, es una práctica
de quien presta el servicio. Anoto la mitad buena: el código
(`periodo/combustible.ts`) sí mide por ejercicio — el que se quedó atrás es el
papel comercial.

---

### [MEDIO] (REINCIDENTE) El renglón "IVA acreditable (LIVA art. 5)" sale verde en la misma hoja donde el de ISR sale condicionado por el mismo hecho

`src/lib/cuadra/liquidacion/acreditable.ts:102-108` vs
`src/lib/cuadra/liquidacion/deducibilidad.ts:64-72` · `engine.ts:866`
(`SIN_ACREDITAMIENTO`) · ficha `normas/liva-5.yaml` (**`verificado_fuente_primaria`**)

Texto, fracción I, literal: *«...se consideran estrictamente indispensables las
erogaciones efectuadas por el contribuyente **que sean deducibles para los fines
del impuesto sobre la renta**...»*, y la `nota_verificacion` de la ficha: «El IVA
solo es acreditable si la erogación es DEDUCIBLE para ISR. **No es un requisito
aparte**».

**Escenario (ejecutado):** diésel de $5,400 con XML verificado, clave `15101505` →
el motor levanta `permiso_cre_no_verificable`:

```
DEDUC → 'Deducible para ISR — sujeto a permiso CRE vigente'  $5,400  tono 'condicionado'
ACRED → 'IVA acreditable (LIVA art. 5)'                      $744.83 tono 'bueno'  pies: []
```

`pdf.ts:348` pinta `'bueno'` en verde. Aplica igual a `complemento_no_verificable`
y `alimentacion_sin_soporte`: ninguno está en `SIN_ACREDITAMIENTO` (`:866`) y los
tres acreditan el IVA al 100%.

**Consecuencia:** el contralor se lleva $744.83 en verde como recuperable sobre un
gasto cuya deducibilidad el mismo papel condiciona dos renglones más arriba.

**Causa raíz probable:** `SIN_ACREDITAMIENTO` se construyó como lista de veredictos
duros y no como "todo lo que condiciona la deducibilidad ISR condiciona el IVA".

---

### [MEDIO] (REINCIDENTE) El `estado` de verificación de la ficha no decide nada en runtime, y el único consumidor colapsa los tres estados en dos

`src/lib/cuadra/tools.ts:71` y `:131` · `src/lib/cuadra/normas/fundamento.ts`
(grep de `estado`: **cero apariciones**, verificado hoy) · `normas/README.md:21-26`

```ts
71:  verificada: NORMAS[id].estado !== 'sin_verificar',
```

`lisr-27-fr-III` es `evidencia_corroborante` —la norma que funda
`combustible_efectivo`, `efectivo_sobre_tope` y `sin_cfdi`— y llega al agente como
`verificada: true`, sin el matiz que la tabla del README exige
(`evidencia_corroborante` permite afirmar «Sí, **condicionado**»). En la otra
dirección, `politica-portales-plazos-facturacion` es `sin_verificar` y sin embargo
`por_diferencia.ts:50` la autoriza como fundamento citable de
`factura_por_vencer`; lo único que la guardia hace con ella es suavizar los verbos
de obligación (`fundamento.ts:357-359`, vía `jerarquia`), no impedir la cita.

**Consecuencia:** el mecanismo de confianza del rubro no es operante en el código.
Es lo que impide que este rubro llegue a 8, y esta ronda tampoco lo tocó.

---

### [BAJO] (REINCIDENTE) Un hotel guardado con el concepto heredado `viaticos` sale con "$1,250 no deducibles" citando LISR 28-V, y el papel lo llama "Alimentación"

`src/lib/cuadra/cuadre/engine.ts:773` · ficha `normas/lisr-28-V.yaml`
(**`verificado_fuente_primaria`**)

Ficha, literal: *«Tratándose de gastos de viaje destinados a la **alimentación**,
éstos sólo serán deducibles hasta por un monto que no exceda de $750.00
diarios...»*, y su `confirmado_del_codigo`: *«Solo alimentación; **el hospedaje
nacional no tiene tope**: CORRECTO»*.

**Escenario (ejecutado):** gasto de $2,000 del 1-ago con `concepto: 'viaticos'`
(una noche de hotel guardada por el OCR viejo), timbrado, IVA $275.86:

```
totalDeducible 750 · totalNoDeducible 1,250 · ivaAcreditable 103.45
nota: «Alimentación del 2026-08-01: $2,000.00 excede el tope fiscal de $750.00
       por día (LISR 28-V) — el excedente de $1,250.00 no es deducible.»
```

El comentario de `:770-772` lo llama "criterio conservador". No lo es: el lado
conservador para el contribuyente es no declararle perdida una deducción que la
ley le concede — y de paso el IVA se recorta al 83.3% por la proporción de
LIVA 5-I. **Alcance honesto:** el OCR de hoy no emite `viaticos`, pero
`0025_dominios_check.sql` sigue admitiendo el valor y `repo.ts:508` lo lee tal cual.

---

### [BAJO] La ficha `rfa-2026-2.9` afirma de sí misma algo que el código desmiente desde los 40 commits de `master`

`normas/rfa-2026-2.9.yaml:42-47` · `src/lib/cuadra/periodo/combustible.ts` ·
`src/lib/cuadra/periodo/aviso.ts` · `src/lib/cuadra/repo.ts:752` · **NUEVO**

La ficha dice hoy:

```yaml
usado_en_codigo:
  - "cuadre/engine.ts — nota de combustible_efectivo"
  - "cuadre/engine.ts — SIN_ACREDITAMIENTO (sigue sin acreditar IEPS)"
pendiente_en_producto: >
  El CONTADOR del 15% por ejercicio NO existe todavía. Hoy el motor avisa que hay
  que contarlo pero no lleva la cuenta.
```

Existe: `periodo/combustible.ts` (91 líneas), `periodo/aviso.ts`,
`repo.ts:752-809` y `tools.ts:104-107`, con dos suites de prueba. Ninguno aparece
en `usado_en_codigo`, que es el campo con el que `normas/README.md:51` dice que se
calcula el radio de impacto cuando una norma cambia.
`normas_sincronizadas.test.ts` compara id, estado, jerarquía, citas, ruta y
`fecha_vigencia_desde` — **nunca `usado_en_codigo`**.

**Consecuencia:** si la RFA 2027 mueve el 15% o su base, la evaluación de impacto
se hace contra dos líneas de `engine.ts` y deja fuera el módulo que calcula el
porcentaje y escribe la frase que el contralor lee.

---

### [BAJO] El requisito de medio de pago del estímulo del LIF 20-A sigue sin ficha que lo transcriba

`src/lib/cuadra/cuadre/engine.ts:922-929` · ficha `normas/lif-2026-20-A.yaml`

`engine.ts:922-925` funda `pagoElectronico` en «el 4º párrafo de la LIF 20-A-IV
(monedero, tarjeta, cheque nominativo o transferencia)». Abrí la ficha completa
hoy: transcribe `estimulo_diesel_transporte` (dos fragmentos) y `estimulo_peaje`,
más los hallazgos H4-H7. **Ese 4º párrafo no está transcrito en ninguna parte del
repo.** La regla que decide si 200 litros se acreditan o no sale de un comentario
de código. Por `por_diferencia.ts`, ese veredicto tampoco tiene entrada: el agente
no puede citar nada al explicarlo. El ancla de 8+ pide exactamente lo contrario.

---

## Lo que revisé y está bien

- **El estímulo de IEPS NO se calcula con el IEPS trasladado.** `engine.ts:872`
  (`const iepsAcreditable = 0`) y `:903-955` (se cuentan **litros**, no pesos), con
  `acreditable.ts:94-101` en tono `condicionado` y `NOTA_LITROS_DIESEL`. Es
  literalmente lo que `lif-2026-20-A.yaml` exige: *«cuota IEPS vigente al momento
  de la compra × LITROS. **No es el IEPS trasladado en el CFDI**»*. El error que
  el rubro nombra como ejemplo canónico no está aquí. La banda 0.5×–2× de
  `diesel_desviacion` (`:942`) atrapa el decimal corrido.
- **LIVA 5-I, segunda parte (proporcionalidad): implementada y medida.** Comida de
  $900 con tope de $750 → `deducible 750 · no deducible 150 · ivaAcreditable
  103.45` = 124.14 × 750/900 exacto. Coincide con el caso que la propia ficha
  `liva-5.yaml` pone en su `nota_verificacion`. El bloque de acreditamiento corre
  DESPUÉS del tope diario (`engine.ts:854-859`), que es lo que lo hace posible.
- **La RFA 2.9 aplicada al concepto correcto y a un solo beneficio.**
  `engine.ts:271-272` manda el combustible en `'01'` a `POR_CONFIRMAR` y lo deja
  en `SIN_ACREDITAMIENTO` (`:866`), con el comentario de `:860-865` explicando que
  la facilidad salva la deducción y no el acreditamiento — coincide con el
  `limite_importante` de la ficha. Medido: `FP 01` → `porConfirmar 5,400 · IVA 0 ·
  litros 0`. `rfa-2026-2.2` (el 8%) tiene `usado_en_codigo: []` y grepeado no se
  ofrece en ningún lado, que es lo correcto: la regla excluye combustible.
- **El interruptor del complemento de hidrocarburos.** `engine.ts:432-476` +
  `indice.ts` (`exigibleDesde: null` para `rmf-2026-2.7.1.48`) +
  `normas_sincronizadas.test.ts`. Con la fecha sin respaldo el motor emite
  `complemento_no_verificable` (revisión) y **no** declara no deducible; la fecha
  que decide dinero sale de la ficha, no de `config.ts`. Sigue siendo el mejor
  mecanismo del rubro.
- **RLISR 57 y el viático a nombre del operador.** `engine.ts:381-400`: si el RFC
  coincide con `operadorRfc` no se reporta nada; si falta el dato sale
  `viatico_rfc_operador` (revisión, sin quitar deducción). Coincide con el texto
  transcrito del reglamento.
- **Las leyendas citan lo que la norma sí dice.** `cuadre/leyendas.ts:36-58`
  contra `cff-89-90.yaml` (`verificado_fuente_primaria`): la frase «puede diferir
  de los criterios que dé a conocer el SAT» es literalmente la conducta que el
  último párrafo del art. 89 nombra para no incurrir en la infracción de la
  fracción I, y la referencia al art. 52 CFF («no constituye un dictamen») es
  correcta. Busqué una cita que no dijera lo citado y no la encontré.
- **Las tres cubetas siempre suman el comprobado.** `engine.ts:982-1012` y el
  portón de `deducibilidad.ts:54-55` (si no suman con 1.5 centavos de tolerancia,
  no se imprime el desglose). El contralor no puede sacar la calculadora y
  encontrar una diferencia.
- **El estímulo de peaje declara su base en el PDF.** `acreditable.ts:47-49`
  (`BASE_ESTIMULO_PEAJE`) dice cuál de las dos bases posibles usó y cuánto sube la
  cifra con la otra. Es el hallazgo H4 de la ficha (`severidad: alta`, `estado: SIN
  RESOLVER`) tratado como corresponde: no se resuelve solo, se declara. **No lo
  cuento como hallazgo mío** — es una pregunta para un contador, y el papel la deja
  a la vista.
- **`SOLO_CONTRALOR`** (`resumen.ts:24-33`) filtra bien: los veredictos que el
  operador no puede arreglar no le llegan; `complemento_no_verificable` sí, porque
  es lo único que él puede resolver.
- **Extracción de impuestos del XML.** `intake/cfdi_xml.ts:141-153`: IVA `002` e
  IEPS `003` se suman de `Impuestos/Traslados` y nunca se recomputan con una tasa
  asumida (`engine.ts:882` exige `xmlVerificado`), así que el 8% fronterizo sale
  tal cual del papel.

---

## Fichas no verificables en esta ronda

Esta ronda corre **sin red** hacia el DOF, el SAT ni diputados.gob.mx —
`normas/.latido-vigilancia` documenta cinco corridas consecutivas bloqueadas por
la política de egreso (403 en el CONNECT hacia `sidofqa.segob.gob.mx`,
`www.sat.gob.mx` y `www.diputados.gob.mx`). Todo lo que digo sobre el texto de una
ley sale de la transcripción que la ficha declara.

Quedan **no verificables en esta ronda** — no asumo que estén bien ni que estén mal:

- `cff-29-A` (`texto_vigente: null`, `evidencia_corroborante`) — **funda cinco
  veredictos** en `por_diferencia.ts:32,39,44,45,46`, tres de ellos
  (`rfc_receptor`, `cfdi_cancelado`, `cfdi_no_encontrado`) dentro de
  `NO_DEDUCIBLE_ISR`. El veredicto duro se apoya en una ficha sin texto.
- `criterio-1-CFF-PI` y `criterio-1-LIF-PI` (`texto_vigente: null`).
- `rmf-2026-2.7.1.21` (`texto_vigente: null`) y `rmf-2026-2.7.1.48`
  (`evidencia_corroborante`, fecha de exigibilidad sin confirmar — correctamente
  tratada como `null` por el código).
- `politica-portales-plazos` (`sin_verificar`, y sostiene una fecha que el
  producto imprime — ver el MEDIO correspondiente).
- `lisr-27-III` (`evidencia_corroborante`, «NO se leyó en diputados.gob.mx»). Para
  los hallazgos que la usan me apoyé en `rfa-2026-2.9`, que **sí** es
  `verificado_fuente_primaria` y reproduce la misma lista cerrada.
- **`normas/cuota-ieps-diesel.yaml` no existe** (`.latido-cuota-diesel`): no hay
  ninguna cuota semanal registrada para ninguna fecha. Es coherente con que el
  producto entregue litros y no pesos, y es la razón por la que esa decisión debe
  sostenerse.
- Duda que dejo abierta, no hallazgo: la enumeración de la RFA 2.9
  (`verificado_fuente_primaria`) **omite la transferencia electrónica** de la lista
  de medios que sí cumplen, mientras el 1er párrafo de LISR 27-III
  (`evidencia_corroborante`) sí la incluye. El producto trata `FormaPago 03` como
  plenamente conforme. No construí ningún hallazgo sobre esa lectura literal
  porque no pude leer el DOF; queda anotada.

---

## Lo que NO alcancé a revisar

- **No generé un PDF.** Verifiqué con el motor real las estructuras que le llegan
  (`filasDeducibilidad`, `filasAcreditables`, `diferencias` con su `monto`) y leí
  `pdf.ts` entero, pero no miré el papel renderizado.
- **`facturacion/permiso_cre.ts`** (12,625 permisos, `permisos_cre.json`): sigue
  sin consumidor real fuera de su propia prueba. No evalué si la tabla es correcta,
  ni por qué el motor prefiere avisar `permiso_cre_no_verificable` teniendo el
  catálogo en el repo.
- **Las condiciones 1 y 2 de la RFA 2.9** (dedicación exclusiva al autotransporte
  de carga federal; régimen del Título II Cap. VII o Título IV Cap. II Secc. I):
  siguen sin capturarse en ningún lado, así que el contador del 15% se activa para
  cualquier tenant. Es el MEDIO de la ronda 8, abierto por quinta ronda; no lo
  repito como hallazgo pero cuenta en la nota.
- **La ventana temporal del contador del 15%.** `docs/fase1/spec-contadores-periodo.md:88-118`
  declara dos huecos reales (la RFA 2026 entra en vigor el 18-feb pero el
  Transitorio Primero no se leyó; la periodicidad de medición dentro del ejercicio
  no está en el texto de la regla) y `repo.ts:776-777` filtra el año natural
  completo. No pude dictaminarlo sin fuente.
- **Qué pasa al superar el 15%.** El código afirma en pesos que sólo el **excedente**
  deja de ser deducible (`combustible.ts:88`, `aviso.ts:35`). El texto de la ficha
  redacta el 15% como **condición** de la facilidad («siempre que estos no
  excedan»), lo que admite la lectura más dura: superado el umbral, la facilidad no
  aplica a ningún pago. La única fuente del repo para la lectura suave es
  `docs/conocimiento/34-proceso-liquidacion.md:315`, que no es ficha. No lo reporto
  como hallazgo porque no puedo escribir cuál de las dos lecturas es la correcta
  sin leer un criterio del SAT — pero es la interpretación que decide más dinero de
  todo el módulo nuevo, y hoy sale impresa en pesos con la regla citada al lado.
- **`intake/decidir.ts`, `emparejar.ts`, `ocr.ts`:** la clasificación de concepto
  decide qué regla fiscal aplica (el tope de LISR 28-V, el estímulo del peaje, el
  contador del 15%). No audité el prompt del OCR ni sus umbrales.
- **`estadoSat: 'pendiente'`** (SAT caído o timeout de 4 s, `sat.ts:50` y `:89`):
  medido, un CFDI así sale `Deducible para ISR $11,600` con `IVA $1,600` en verde y
  sólo `cfdi_pendiente` en la lista. Es defendible —el comprobante existe— y por eso
  no lo levanto como hallazgo, pero es la misma dirección de fallo abierto que el
  crítico de EFOS y merece una decisión explícita.
- **`config.ts:93-103`** no define `precioDieselPorDefecto` dentro de `estimulos`,
  así que `engine.ts:939` siempre cae al literal `27.0` y el
  `tabulador.precioDieselPorDefecto` del tenant nunca llega a la banda de
  `diesel_desviacion`. Anotado sin escenario en pesos.
- **Las 4 fichas de LFPDPPP:** son del rubro legal.
