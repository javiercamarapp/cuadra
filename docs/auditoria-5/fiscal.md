# Cumplimiento fiscal — auditoría 5

**Nota: 4/10** (antes 7). Razón: mirada más profunda · deuda que cobró factura ·
el rubro subió en lo que se atacó y bajó en lo que nadie había medido.

Por qué 4 y no 3: la trazabilidad es real —el error canónico del IEPS está
cerrado, la proporción de LIVA 5-I está implementada, la separación `flete` /
`transporte` está COMPLETA, y las fichas que deciden dinero son casi todas
`verificado_fuente_primaria`—. Por qué no 6: el ancla del rubro dice "3 o menos
si el producto imprime una cifra fiscal equivocada", y hay **dos** casos
reproducidos en los que el PDF imprime una cifra equivocada, uno de ellos
descuadrando el propio documento.

**Riesgo mayor hoy:** el desglose de deducibilidad puede imprimir tres cubetas
que suman **más que el total comprobado impreso tres renglones arriba** —
`$3,350` bajo un `Total comprobado $2,100.00` —, y en el mismo PDF el contralor
tiene los dos números a la vista.

---

## Hallazgos

### [CRÍTICO] El desglose de deducibilidad se descuadra cuando el tope diario de alimentación cae sobre un comprobante de otra cubeta

`src/lib/cuadra/cuadre/engine.ts:494` (`const ancla = delDia[delDia.length - 1]`)
· `engine.ts:616-630` (bucle de las tres cubetas) ·
`src/lib/cuadra/liquidacion/deducibilidad.ts:41-47` ·
`src/lib/cuadra/liquidacion/pdf.ts:246-263`

**Norma y línea transcrita** — `normas/lisr-28-V.yaml`,
`estado_verificacion: verificado_fuente_primaria`:

> "Tratándose de gastos de viaje destinados a la alimentación, éstos sólo serán
> deducibles hasta por un monto que no exceda de **$750.00 diarios por cada
> beneficiario**, cuando los mismos se eroguen en territorio nacional"

**Escenario con valores** (corrido contra el motor real, no leído):

| entra | |
|---|---|
| `alimentacion` $2,000.00, 20-jul-2026, **sin** `cfdiUuid` (ticket de fonda) | |
| `alimentacion` $100.00, 20-jul-2026, **con** `cfdiUuid` y XML | |

Sale:

```
totalComprobado 2100 | totalDeducible -1250 | totalPorConfirmar 2000 | totalNoDeducible 1350
filas del PDF: [["Por confirmar", 2000], ["No deducible", 1350]]
```

El día suma $2,100 y el tope es $750, así que el exceso es $1,350 — correcto. El
error está en **de quién se descuenta**: `ancla` es el último gasto del día
($100), y el bucle de cubetas hace `totalDeducible += g.monto - excedente` =
`100 - 1350 = -1250`. El gasto de $2,000, que está en `por_confirmar`, entra
**íntegro** a esa cubeta por el `continue` de la línea 623, así que los mismos
pesos se cuentan dos veces.

`deducibilidad.ts:41` sí tiene el guardarraíl de suma, pero **pasa**: las tres
cubetas suman 2100 exactamente. Lo que lo rompe es `deducibilidad.ts:45`
(`if (liq.totalDeducible > 0)`): el renglón negativo que balanceaba se suprime, y
el PDF imprime **$2,000 + $1,350 = $3,350 bajo un "Total comprobado $2,100.00"**.

**Consecuencia.** El contralor tiene los cuatro números en la misma hoja y una
calculadora. El papel se contradice a sí mismo en la sección que el producto
vende. Además queda un `totalDeducible = -1250` escrito en la columna de la BD.

**Causa raíz.** El comentario de `engine.ts:472-493` corrigió que la PROPORCIÓN
del IVA se colgara de un solo comprobante (`proporcionDia` para todos), pero dejó
la DIFERENCIA colgada del ancla ("los totales de deducibilidad suman por gastoId
y tiene que vivir en alguno"). Esa premisa solo se sostiene si el ancla está en la
cubeta `deducible`; nadie lo verifica.

*Intento de refutación:* con los dos gastos en la misma cubeta el resultado SÍ
sale bien ($2,000+$100 con CFDI → deducible $750, no deducible $1,350). El fallo
necesita cubetas mixtas el mismo día — que es el caso normal, porque el operador
manda unos comprobantes timbrados y otros no.

---

### [CRÍTICO] Con el RFC de la empresa mal formado, un CFDI a nombre de un tercero se imprime como deducible y su IVA como acreditable

`src/lib/cuadra/cuadre/engine.ts:113-119` (`rfcsOk`) ·
`src/lib/cuadra/config.ts:151-164` · `src/lib/cuadra/liquidacion/pdf.ts:297`

**Normas y líneas transcritas.**

`normas/lisr-27-III.yaml` (`evidencia_corroborante`):
> "**Estar amparadas con un comprobante fiscal** y que los pagos cuyo monto exceda
> de $2,000.00 se efectúen mediante transferencia electrónica de fondos desde
> cuentas abiertas **a nombre del contribuyente**…"

`normas/liva-5.yaml` (`verificado_fuente_primaria`), art. 5º fr. I:
> "…se consideran estrictamente indispensables las erogaciones efectuadas **por el
> contribuyente** que sean deducibles para los fines del impuesto sobre la renta"

**Escenario con valores** (corrido contra el motor real). Un solo CFDI:
`factura` $11,600.00, `rfcReceptor: 'ABC120101AA8'` (un tercero), XML verificado,
`ivaTraslado: 1600`, `estadoSat: 'vigente'`.

| `empresaRfc` | deducible | no deducible | IVA acreditable | estatus | diferencias |
|---|---|---|---|---|---|
| `TIN010101AAA` (el del tenant de demo) | **$11,600** | $0 | **$1,600** | `cuadrada` | `[]` |
| `SAT970701NN3` (RFC válido) | $0 | $11,600 | $0 | `revisar` | `["rfc_receptor"]` |
| `XAXX010101000` (genérico) | **$11,600** | $0 | **$1,600** | `cuadrada` | `[]` |

Con el RFC del tenant de demo, `rfcsOk` queda vacío (`engine.ts:118` filtra por
`rfcChecksumOk`, verificado: `esRfcValido('TIN010101AAA') = true`,
`rfcChecksumOk = false`), la guarda `rfcsOk.size > 0` de la línea 247 nunca entra,
y **no se emite ninguna diferencia**. El PDF imprime "Deducible para ISR
$11,600.00" en verde y "IVA acreditable (LIVA art. 5) $1,600.00" en verde citando
el artículo.

**Consecuencia.** Ninguna de las dos cifras es correcta: un CFDI timbrado a otro
RFC no ampara la deducción del contribuyente ni su IVA. Es la cifra que el
contralor mete a la declaración, y el papel se la dio Likida citando la ley. Y el
tenant que se va a usar el 6-ago es exactamente el que tiene el RFC malo.

**Causa raíz.** El arreglo `86e23aa` es correcto en su dirección —dejar de
rechazar facturas legítimas contra un RFC inventado— pero es **binario**: apagó la
validación entera en vez de degradarla a aviso. El único rastro es un
`logger.error('config.rfc_empresa_invalido')` en `config.ts:158`, que es un log de
servidor: no llega al PDF, ni al resumen de WhatsApp, ni a `diferencias`, ni al
estatus (sale `cuadrada`).

*Intento de refutación:* el comentario de `engine.ts:105-112` documenta la defensa
y es correcta para el falso positivo ("enseñar un CFDI real en una demostración y
que el sistema lo declare no deducible es peor que no validar"). No cubre el falso
NEGATIVO, que es el que imprime dinero de más y no dice nada. Verifiqué con dos
búsquedas (`grep -rn "rfc_empresa_invalido\|validación de receptor"` y
`grep -rn "APAGADA"`) que no existe ninguna salida al usuario.

---

### [ALTO] Una fecha sin ficha decide un "no deducible" de $5,800 sobre el diésel

`src/lib/cuadra/config.ts:88` (`vigenteDesde: '2026-04-24'`) ·
`src/lib/cuadra/cuadre/engine.ts:284, 293-295` · `engine.ts:67` (el tipo entra a
`NO_DEDUCIBLE_ISR`)

**Norma y línea transcrita** — `normas/rmf-2026-2.7.1.48.yaml`,
`estado_verificacion: **evidencia_corroborante**` (no primaria):

> "Para los efectos de los artículos 29 y 29-A del CFF, los contribuyentes que
> enajenen gasolinas y diésel … deben incorporar en el CFDI que se emita, el
> 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos',
> **que al efecto publique el SAT en su Portal**."

Y su propia `nota_verificacion`, literal:

> "La fecha exacta de EXIGIBILIDAD no está confirmada. La regla, reformada el
> 09-jul-2026, sigue redactada en futuro … así que la obligación **puede estar
> latente y no vigente**. El código usa 2026-04-24 como `vigenteDesde` y **ESA
> FECHA NO ESTÁ RESPALDADA** por esta ficha."

El comentario de `config.ts:88` la funda en "RMF 2.7.1.8", que es una de las
cuatro citas **sin ficha** que declara `docs/fase1/inventario-normas.md`.

**Escenario con valores** (corrido contra el motor real). El MISMO CFDI de diésel
—$5,800, clave `15101505`, tipo `I`, XML verificado, `formaPago 03`, 200 L, IVA
$689.66— movido un día:

| fecha del CFDI | deducible | no deducible | IVA acreditable | litros elegibles |
|---|---|---|---|---|
| 2026-04-23 | $5,800 | $0 | $689.66 | 200 L |
| 2026-05-10 | **$0** | **$5,800** | **$0** | **0 L** |

**Consecuencia.** Un día de diferencia en la fecha impresa del ticket vale
$5,800 de deducción y $689.66 de IVA, y la bisagra es una fecha que ninguna ficha
respalda y que la propia ficha del artículo marca como posiblemente no exigible
todavía. Además el motor cita en el papel "obligatorio desde 24-abr-2026, regla
2.7.1.48 RMF … no deducible (CFF 29-A)" (`engine.ts:294`): afirma vigencia con
fecha exacta sobre una norma redactada en futuro.

*Intento de refutación:* el motor sí tiene dos niveles y no declara no deducible
sin XML (`complemento_no_verificable`, línea 300) — esa defensa está bien y la
respeté. Pero con XML el veredicto es duro, y el disparador es la fecha.

---

### [ALTO] El estímulo de peaje se imprime en verde citando LIF 20-A sin verificar ninguna de sus condiciones, y sobre la base equivocada

`src/lib/cuadra/cuadre/engine.ts:556` ·
`src/lib/cuadra/liquidacion/pdf.ts:298` · `src/lib/cuadra/config.ts:91`

**Norma y línea transcrita** — `normas/lif-2026-20-A.yaml`,
`estado_verificacion: verificado_fuente_primaria`, `estimulo_peaje`:

> "Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
> **exclusivamente** al transporte terrestre público y privado, de carga o pasaje,
> así como el turístico, que utilizan la **Red Nacional de Autopistas de Cuota**,
> que obtengan en el ejercicio fiscal … **ingresos totales anuales … menores a 300
> millones de pesos**, consistente en permitir un acreditamiento de los gastos
> realizados … hasta en un 50 por ciento del **gasto total erogado** por este
> concepto. El estímulo será aplicable **únicamente cuando se cumplan con los
> requisitos que mediante reglas de carácter general establezca el SAT**. El
> estímulo no podrá ser aplicable por las personas morales que se consideran
> **partes relacionadas** de acuerdo con el artículo 179 de la LISR."

**Escenario con valores.** Caseta timbrada de $1,160.00 (`subTotal` $1,000 +
IVA $160), XML verificado → el motor devuelve `peajeAcreditable = 500` y el PDF
imprime, en verde y en negritas:

```
Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)      $500.00
```

Dos problemas distintos en ese renglón:

1. **La base.** "50 por ciento del gasto total erogado" sobre $1,160 son $580, no
   $500. Es el hallazgo `H4` de la propia ficha, `severidad: alta`,
   `estado: SIN RESOLVER`, y la ficha advierte que resolverlo hacia el total podría
   duplicar el beneficio del IVA — **es una pregunta para un contador**. Lo que no
   es discutible es que el papel no dice cuál de las dos bases usó.
2. **La elegibilidad.** El motor no conoce los ingresos de la flota, ni su
   relación de partes, ni si la caseta pertenece a la Red Nacional (`engine.ts:556`
   dispara con `g.concepto === 'caseta'` a secas). Son `H5` y `H6` de la ficha. El
   PDF sí imprime la advertencia de ingreso acumulable (`pdf.ts:303`) pero **ni una
   palabra sobre las cuatro condiciones de elegibilidad**.

**Consecuencia.** Una flota con ingresos ≥ $300M, o que sea parte relacionada, se
lleva impreso un estímulo al que no tiene derecho, con el artículo citado al lado.
Y el criterio `1/LIF/PI` del Anexo 3 alcanza a "quien preste servicios" — o sea, a
Likida, no al cliente.

---

### [MEDIO] `plazoVerificado: true` de Office Depot contradice su propia ficha, y el aviso se queda sin la advertencia de jerarquía

`src/lib/cuadra/facturacion/comercios.ts:226-227` ·
`src/lib/cuadra/cuadre/engine.ts:372, 381-385`

**El cálculo es CORRECTO. Lo verifiqué:** `calcularCaducidad({ fechaTicket:
'2026-07-25', plazo: 'mes_siguiente', hoy: '2026-07-28' })` →
`fechaLimite 2026-08-31, diasRestantes 34, vencido false`. El caso de fin de año
también (`2026-12-25` → `2027-01-31`). `Date.UTC(año, mes+2, 0)` es el último día
del mes siguiente, que es exactamente lo que dice el ticket transcrito en
`comercios.ts:220-225` ("SOLICITARLA A MÁS TARDAR DENTRO DEL MES SIGUIENTE A LA
FECHA DE EMISIÓN"). Sin este cambio el aviso habría dicho "te quedan 3 días", que
era falso. **No hay hallazgo en la aritmética.**

**Lo que sí es hallazgo** — `normas/politica-portales-plazos.yaml`,
`estado_verificacion: sin_verificar`, dice literal:

> `usado_en_codigo: "facturacion/comercios.ts — campo **plazoVerificado: false en
> cada entrada**"`
>
> `uso_permitido_hoy:` "Solo como advertencia genérica: 'la ventana del comercio
> puede ser menor'. **El aviso del motor usa la regla general del mes natural, no
> estos números**."
>
> `advertencia_de_jerarquia:` "ESTO NO ES UNA NORMA FISCAL … **El plazo LEGAL para
> pedir factura es todo el ejercicio** (el SAT lo dice expresamente) … El producto
> NUNCA debe presentar estos plazos como una obligación fiscal."

**Escenario con valores** (salida real del motor, ticket de Office Depot de
$1,450.50 del 25-jul, `hoy = 2026-07-28`):

```
Otro de $1,450.50 sigue sin factura: puedes timbrarlo hasta el 2026-08-31 (34 días).
Portal de Office Depot: https://facturacion.officedepot.com.mx/ — te pedirá …
```

Comparado con el de OXXO (`plazoVerificado: false`), que sí lleva el matiz:
`"…(3 días), y la ventana del comercio puede ser menor"`.

**Consecuencia.** Doble. (a) La única entrada "verificada" del catálogo no tiene
ficha que la respalde: la ficha sigue diciendo que todas están en `false` y que el
motor no usa estos números. Un auditor que rastree la cifra `2026-08-31` llega a
un YAML `sin_verificar` que dice lo contrario de lo que hace el código. (b) La
rama no-vencida afirma un plazo sin decir que es política del comercio y no la
ley; la rama vencida (`engine.ts:382`) sí menciona el ejercicio y la Conciliación
de Factura. Un contralor que lea "puedes timbrarlo hasta el 31-ago" concluye que
el 1-sep se perdió el CFDI, y no es cierto.

**Causa raíz.** El commit `13a56c6` cambió el código y no la ficha. La ficha es la
fuente de verdad del rubro; quedó atrás.

---

### [MEDIO] Deuda de citas sin ficha: se pagó una de cuatro

Verificado, no redescubierto. Contra `docs/fase1/inventario-normas.md`:

| cita | estado hoy | dónde |
|---|---|---|
| **CFF 69-B (EFOS)** | ✅ **PAGADA.** `normas/cff-69-B.yaml` creada el 28-jul, `verificado_fuente_primaria`, texto transcrito de diputados.gob.mx, y dada de alta en `normas/indice.ts:65` | `engine.ts:272` |
| **CFF 30** | ❌ sigue sin ficha | `processor.ts:216`, `processor.ts:450`, `repo.ts:11` |
| **RMF 2.7.1.8** | ❌ sigue sin ficha — y decide dinero (ver el ALTO de arriba) | `config.ts:88` |
| **CFF 90** | ❌ sigue sin ficha | `leyendas.ts:11` (es el marco de la mitigación del descargo del PDF) |

Y **`liva-art-5` ya NO está `sin_verificar`**: la ficha se cerró el 28-jul contra
el texto vigente (`fuente: diputados.gob.mx … última reforma DOF 12-11-2021`) y el
código sí aplica ahora la fracción I. La cifra concreta que imprime es
**`IVA acreditable (LIVA art. 5)`** en verde en `pdf.ts:297`, calculada en
`engine.ts:554` (`ivaAcreditable += ivaTraslado * proporcion`). El bloque se movió
al final del motor a propósito (`engine.ts:509-513`) para que la proporción exista
cuando se calcula. **Esa deuda está saldada.**

Detalle menor que queda: `normas/liva-5.yaml` declara
`estado_verificacion: verificado_fuente_primaria` con **`verificado_por: null`** —
la única ficha primaria del catálogo sin firma de quién la verificó.

---

## Trazabilidad: cifras impresas → ficha que las respalda

| Cifra que ve el contralor | Dónde se imprime | Ficha | Estado de la ficha | Veredicto |
|---|---|---|---|---|
| `Deducible para ISR` / `No deducible` / `Por confirmar` | `pdf.ts:246-263` | `lisr-27-III` + `lisr-28-V` + `rfa-2026-2.9` | corroborante / **primaria** / **primaria** | ⚠️ se descuadra (CRÍTICO 1) |
| `IVA acreditable (LIVA art. 5)` | `pdf.ts:297` | `liva-5` | **primaria** (cerrada 28-jul) | ⚠️ correcto salvo con la validación de RFC apagada (CRÍTICO 2) |
| `Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)` | `pdf.ts:298` | `lif-2026-20-A` | **primaria** | ❌ base y elegibilidad sin resolver (ALTO) |
| `Diésel elegible … (LIF 2026 art. 20, ap. A)` **en LITROS** | `pdf.ts:293-294` | `lif-2026-20-A` + `criterio-1-LIF-PI` | **primaria** / corroborante | ✅ correcto |
| Tope de $750/día de alimentación | `engine.ts:500` (nota) | `lisr-28-V` | **primaria** | ✅ importe y unidad correctos |
| "no deducible (CFF 29-A)" por complemento de hidrocarburos | `engine.ts:294` | `rmf-2026-2.7.1.48` + `cff-29-A` | corroborante / corroborante | ❌ la fecha bisagra no la respalda ninguna ficha (ALTO) |
| `puedes timbrarlo hasta el <fecha>` | `engine.ts:385` | `politica-portales-plazos` | **sin_verificar** | ⚠️ la ficha dice lo contrario de lo que hace el código (MEDIO) |
| Descargo del pie (art. 52 CFF) | `pdf.ts:387` / `leyendas.ts:33` | `criterio-1-CFF-PI` (+ CFF 89/90 **sin ficha**) | corroborante | ⚠️ cita CFF 90 sin ficha |
| `iepsAcreditable` en pesos | **NO SE IMPRIME** | `lif-2026-20-A` | **primaria** | ✅ correcto a propósito |

---

## Lo que revisé y está bien

**El error canónico está cerrado, y bien.** `engine.ts:526`:
`const iepsAcreditable = 0`, con `const` y con el comentario que explica por qué.
El motor NO suma `iepsTraslado`; en su lugar acumula
`litrosDieselAcreditables` (`engine.ts:582-584`) y el PDF imprime **litros, no
pesos** (`pdf.ts:292-296`), con la nota de que la cuota es semanal. Corresponde
literal a `lif-2026-20-A.yaml`: *"cuota IEPS vigente al momento de la compra ×
LITROS. No es el IEPS trasladado en el CFDI."* Y respeta el 4º párrafo de la
fracción IV: solo cuenta litros con `formaPago !== '01'` (`engine.ts:583`), sin
darle la válvula del 15% de la RFA 2.9, que solo salva la deducción.

**La separación `flete` / `transporte` está COMPLETA.** Los seis puntos que pedía
esta ronda, uno por uno:

| punto | archivo:línea | estado |
|---|---|---|
| `ES_VIATICO` | `engine.ts:62` — `['alimentacion','hospedaje','transporte','viaticos']` | ✅ `flete` fuera |
| Soporte de LISR 28-V | `engine.ts:421` — `g.concepto === 'hospedaje' \|\| g.concepto === 'transporte'` | ✅ `flete` no ampara |
| Tope de política | `config.ts:65` — `{ concepto: 'flete' }` sin `topeMonto` | ✅ |
| Catálogo de cuentas | `config.ts:81` — `flete: '600-005'` | ✅ cuenta propia |
| Enum del OCR | `ocr.ts:26` — `CONCEPTOS_OCR` incluye `'flete'` | ✅ (el enum de Zod, no solo el prompt) |
| Prompt del OCR | `ocr.ts:80` | ✅ con la regla operativa (GUÍA, RASTREO, REMITENTE, KILOS) y la razón fiscal citada |
| `app/api/demo/route.ts` | línea 25 — `{ concepto: 'flete' }` | ✅ |
| Extras que también lo tienen | `types/cuadra.ts:23`, `engine.ts:690` (`label`), `app/dashboard/[id]/page.tsx:17` | ✅ los tres mapas de etiqueta coinciden |

Corresponde a `lisr-28-V.yaml`: *"cuando no se destinen al hospedaje,
alimentación, transporte … **de la persona beneficiaria del viático**"*. Una guía
de paquetería no es transporte de la persona. La separación está donde tiene que
estar y no encontré ningún camino por el que un `flete` vuelva a amparar una
comida.

**El aviso de facturación permanente está bien construido.** `engine.ts:345-403`:
sale siempre (no solo si `urgente`), lo que cambia con la urgencia es el tono; se
calla en ejercicios anteriores (`engine.ts:368`) para no contradecir a
`fecha_sospechosa`; no afirma nada sin fecha (`:360`) ni sin comercio ni liga
(`:359`); y `identificarComercio` ya está cableado (era código muerto). El plazo
por cadena solo se usa con `plazoVerificado` (`:372`), que es el diseño correcto.

**LIVA 5 fr. I, la proporción.** `engine.ts:552-554` aplica
`proporcionDeducible` al IVA, y `engine.ts:487` la calcula como
`tope/total` del DÍA repartida entre todos los comprobantes del día — no colgada
del último. Verifiqué el caso de la ficha: alimentación de $900 con tope de $750 →
83.3% del IVA. Correcto, y el comentario de `:472-486` documenta las dos formas
en que estaba mal antes.

**RLISR 57.** `engine.ts:247-266`: un viático a nombre del operador no se rechaza;
sin `operadorRfc` se emite `viatico_rfc_operador` (revisión) en vez de
`rfc_receptor` (no deducible). Corresponde al texto transcrito: *"Si benefician a
personas que le prestan servicios personales subordinados, los comprobantes
fiscales **podrán** ser expedidos a nombre de dichas personas"*.

**RFA 2026 regla 2.9.** `engine.ts:167-168`: el combustible en efectivo va a
`por_confirmar`, no a `no_deducible`, y el texto dice explícitamente que no
acredita IEPS. Corresponde a `limite_importante` de la ficha: *"Conserva la
DEDUCCIÓN para ISR. NO habilita el acreditamiento del IEPS"*. Y
`combustible_efectivo` está en `SIN_ACREDITAMIENTO` (`:520`) pero no en
`NO_DEDUCIBLE_ISR` (`:67`), que es exactamente la distinción que la ficha pide.

**El tope de $750 aplica solo a alimentación**, no a hospedaje ni a transporte
(`engine.ts:458`), como manda `confirmado_del_codigo` de la ficha de LISR 28-V.

**`clavesPeaje` excluye la genérica `93151505`** (`intake/concepto.ts:19-27`),
para no acreditar peaje sobre gastos que no lo son. Buena decisión, documentada.

---

## Lo que NO alcancé a revisar

Prioricé las cuatro áreas de la ronda + la deuda declarada, y estas quedaron
fuera. **No están validadas ni invalidadas:**

- **`liquidacion/omitidos.ts`** — solo lo leí de refilón desde `pdf.ts`. La
  invariante "los renglones impresos suman el total impreso" no la comprobé.
- **`laboral/pagadero.ts` contra `lft-110-111-263.yaml`** — es rubro fronterizo
  con legal, pero el tope del 30% del EXCEDENTE del salario mínimo (LFT 110-I) y
  el "salarios de un mes" son cifras que pueden salir impresas. Sin revisar.
- **`intake/cfdi.ts` y `intake/sat.ts` contra `cff-29-A.yaml`** — la validación de
  UUID, el mapeo de códigos EFOS (`EFOS_EN_LISTA = new Set(['100'])`) y los
  requisitos del art. 29-A. La ficha de CFF 29-A es `evidencia_corroborante` sin
  texto transcrito, así que buena parte **no es verificable en esta ronda**.
- **`periodo/`** (el 15% del ejercicio de RFA 2.9) — la ficha declara que el
  contador no existe; no verifiqué qué hay en ese directorio.
- **`cuadre/resumen.ts` y `normas/fundamento.ts`** — qué cifras fiscales viajan
  por WhatsApp y si `guardiaFundamento` deja citar CFF 30 / RMF 2.7.1.8 / CFF 90
  sin ficha. Es la pregunta natural que sigue al hallazgo de las citas huérfanas.
- **`cuadre/desde_db.ts`** — reconstrucción desde Supabase: si un
  `totalDeducible` negativo (CRÍTICO 1) sobrevive el viaje de ida y vuelta a la
  BD, no lo sé.
- **`liva-5.yaml` fr. III y siguientes** — la ficha solo transcribe las fracciones
  I y II del art. 5º. Los demás requisitos de acreditamiento (que el IVA esté
  efectivamente pagado, la mecánica de la proporción del art. 5º-A/5º-B) no están
  en el catálogo y no los evalué.
- **Fichas no verificables en esta ronda** (`texto_vigente: null`, se anotan sin
  presumir bien ni mal): `cff-29-A`, `criterio-1-CFF-PI`, `criterio-1-LIF-PI`,
  `rmf-2026-2.7.1.21`, `politica-portales-plazos`.
- **No corrí la suite completa** ni busqué cuáles de las 628 pruebas cubren los
  dos CRÍTICOS. Sospecho que ninguna —el descuadre pasa el guardarraíl de suma de
  `deducibilidad.ts`—, pero no lo comprobé, así que no lo afirmo.
