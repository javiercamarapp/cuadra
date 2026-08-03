# Cumplimiento fiscal — auditoría 10 (continuación 3-ago)

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda (el código no
cambió, la nota anterior estaba inflada)**.

Los dos altos que se cerraron el 2-ago **anclaron de verdad** y lo verifiqué
ejecutando `cuadrarViaje`, no leyendo el commit: un CFDI que el SAT marca ya no
sale "Deducible para ISR", y un diésel con `FormaPago 99` ya no acredita litros.
Eso, solo, subiría la nota. Baja porque al abrir el mismo eje una capa más
adentro salieron dos cosas que ya existían el 2-ago y no vi:

1. el arreglo del medio de pago se aplicó al beneficiario **chico** (los litros
   del estímulo del LIF) y no al **grande** (la deducción para ISR del mismo
   diésel), donde la condición sigue siendo "no es efectivo";
2. el tenant del demo trae un RFC que **nuestro propio validador rechaza**, así
   que la liquidación del 6-ago imprime `Deducible para ISR $0.00`, sin sección
   ACREDITABLE / RECUPERABLE, sobre dos CFDI impecables.

Y siguen vivos los seis pendientes de la ronda anterior, verificados uno por uno.

**El riesgo mayor del rubro, hoy:** el papel del demo, tal como está sembrado,
no imprime ni una sola cifra fiscal distinta de cero — y la única línea que sí
imprime le echa la culpa a algo falso ("Falta timbrar la factura", sobre dos
comprobantes timbrados).

---

## Cómo verifiqué

Motor bundleado fuera del repo con `esbuild` (`--alias:@=./src`) y ejecutado con
node. Todos los "sale" de abajo son salida medida de `cuadrarViaje`,
`filasDeducibilidad` y `filasAcreditables`, no lectura de código. Compuerta de
partida verificada: `npm test` → 173 archivos / 1629 pruebas verdes.

Conteo de fichas de hoy: **21** en `normas/` (el MAPA dice 22; sobra una).
`verificado_fuente_primaria` 14 · `evidencia_corroborante` 6 · `sin_verificar` 1.

---

## Los dos arreglos del 2-ago: SÍ anclaron

**FISCAL-1 (`65b90eb`) — cerrado.** `intake/sat.ts:80-86` sigue sin poder emitir
`efos: true`, pero ahora `engine.ts:96` mete `cfdi_efos_indeterminado` en
`POR_CONFIRMAR` y `engine.ts:882` en `SIN_ACREDITAMIENTO`. El camino de falla ya
no existe: la cadena `sat.efosDesconocido` → `ocr.ts:356` → `gasto.efos_revisar`
→ `repo.ts:528` → `engine.ts:417` está completa. Medido con el CFDI del hallazgo
(11,600, XML verificado, receptor OK, `estadoSat: 'vigente'`, `efosRevisar: true`):

```
antes → Deducible para ISR $11,600 · IVA acreditable $1,600
hoy   → deducible 0 · por confirmar 11,600 · IVA acreditable 0 · estatus revisar
        DEDUC: [{ label:'Por confirmar', tono:'pendiente' }]   ACRED: null
```

**FISCAL-2 (`0d1fe65`+`de4b945`) — cerrado en su mitad.** `engine.ts:961-969`
sustituyó la negación del efectivo por la lista cerrada `MEDIOS_LIF_20A`
(`02,03,04,05,28,29`). Medido: diésel de $5,400 / 200 L con `FormaPago 99` →
`litrosDieselAcreditables: 0`; con `03` → `200 L`. El renglón de litros
desaparece del PDF. **La otra mitad del hallazgo sigue abierta** (ver
[ALTO] #2 y [BAJO] #9).

---

## Hallazgos

### [CRÍTICO] El tenant del demo trae un RFC que nuestro propio validador rechaza: la liquidación del 6-ago imprime `Deducible para ISR $0.00` y no imprime la sección ACREDITABLE

`supabase/seed.sql:26` (`tenant.rfc = 'TIN010101AAA'`) · `src/lib/cuadra/config.ts:186-215`
· `src/lib/cuadra/cuadre/engine.ts:198-241` · `deducibilidad.ts:74-80`

Ficha `normas/liva-5.yaml` (`verificado_fuente_primaria`), fracción I, literal:

> «...se consideran estrictamente indispensables las erogaciones efectuadas por el
> contribuyente **que sean deducibles para los fines del impuesto sobre la renta**,
> aun cuando no se esté obligado al pago de este último impuesto.»

**Código:** `getConfig` toma `tenant.rfc` tal cual (`config.ts:215`), solo lo
loguea si falla el dígito verificador (`:192-197`). El motor lo descarta
(`engine.ts:203`), `rfcsOk` queda vacía y `rfcEmpresaInservible` se vuelve `true`
(`:238`), así que **todo gasto con `rfcReceptor` presente** levanta
`rfc_receptor_no_verificable`, que está en `POR_CONFIRMAR` (`:96`) y en
`SIN_ACREDITAMIENTO` (`:882`).

**Escenario (ejecutado con los dos gastos exactos de `seed.sql:121-130`):**
diésel $4,200 (`15101505`, complemento HidroYPetro, `FormaPago 03`, IVA $581.38,
IEPS $408.62, XML verificado) + caseta $1,400 (subtotal $1,206.90, IVA $193.10,
XML verificado), receptor `TIN010101AAA`, `empresaRfc = 'TIN010101AAA'`. Verifiqué
antes con nuestro propio `intake/cfdi.ts`: `esRfcValido('TIN010101AAA') = true`,
`rfcChecksumOk('TIN010101AAA') = false`.

```
difs: sobre_politica, rfc_receptor_no_verificable ×2, permiso_cre_no_verificable, anticipo
totalDeducible 0 · totalNoDeducible 0 · totalPorConfirmar 5,600
ivaAcreditable 0 · peajeAcreditable 0 · litrosDieselAcreditables 0

DEDUC → [{ label:'Por confirmar', monto:5600, tono:'pendiente',
           pie:'Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar.' }]
ACRED → null
```

Tres consecuencias medidas, todas en el papel que se proyecta:

- el renglón `Deducible para ISR` **no se imprime** (está en $0);
- la sección **ACREDITABLE / RECUPERABLE** —la que `acreditable.ts:1-12` llama
  "la sección que vende"— devuelve `null` y **desaparece del PDF entero**;
  en `dashboard/page.tsx:160-161` las tarjetas quedan en `$0.00`, y el bloque
  "Acreditable (recuperable)" de WhatsApp (`resumen.ts:89-97`) no sale;
- el único pie que sí se imprime es **falso**: dice "Falta timbrar la factura"
  sobre dos comprobantes que están timbrados y vigentes ante el SAT. Lo que
  falta es el RFC de la flota, y el papel no lo dice.

**Consecuencia:** el 6-ago el contralor ve un documento que, sobre $5,600 de
comprobantes perfectos —CFDI, XML, complemento de hidrocarburos, IEPS e IVA
desglosados, pago por transferencia—, no le afirma un solo peso de deducción ni
de IVA recuperable, y le da una razón que él puede desmentir mirando sus propios
CFDI. Es exactamente la promesa del producto, en cero, en la sala.

**Causa raíz probable:** el RFC de demo se escribió como texto plausible y nunca
se pasó por `rfcChecksumOk`; `getConfig` lo detecta y solo lo registra en un log
del servidor. El motor hace lo correcto — el dato de entrada es el que no sirve.

*(Anoto la mitad honesta: fiscalmente el veredicto del motor es defensible —no se
puede confirmar el receptor, así que no se afirma la deducción—. Lo que convierte
esto en crítico es que TODAS las cifras fiscales del demo dependen de ese único
dato y que el papel explica mal por qué.)*

---

### [ALTO] El requisito de medio de pago de LISR 27-III sigue implementado como "no es efectivo": un diésel con `FormaPago 99` o `17` sale "Deducible para ISR" en verde con su IVA

`src/lib/cuadra/cuadre/engine.ts:281` y `:283` · contraste con el arreglo de ayer
en el MISMO archivo, `:961-969` · ficha `normas/lisr-27-III.yaml`
(`evidencia_corroborante`) y `normas/rfa-2026-2.9.yaml` (`verificado_fuente_primaria`)

`lisr-27-III.yaml`, `texto_vigente`, segundo párrafo, literal:

> «Tratándose de la adquisición de combustibles para vehículos marítimos, aéreos y
> terrestres, **el pago deberá efectuarse en la forma señalada en el párrafo
> anterior, aun cuando la contraprestación de dichas adquisiciones no excedan de
> $2,000.00**...»

y el párrafo anterior, que es el que enumera la lista cerrada:

> «...que los pagos cuyo monto exceda de $2,000.00 se efectúen mediante
> **transferencia electrónica de fondos**...; **cheque nominativo** de la cuenta del
> contribuyente, **tarjeta de crédito, de débito, de servicios, o los denominados
> monederos electrónicos** autorizados por el Servicio de Administración Tributaria.»

`rfa-2026-2.9.yaml`, `texto_vigente`, literal — y esto define el alcance exacto de
la válvula del 15%:

> «...considerarán cumplida la obligación establecida en el artículo 27, fracción
> III, segundo párrafo de la Ley del ISR, cuando los pagos por consumo de
> combustible se realicen **con medios distintos a cheque nominativo de la cuenta
> del contribuyente; tarjeta de crédito, de débito o de servicios; o monederos
> electrónicos autorizados por el SAT**, siempre que estos no excedan el 15 por
> ciento del total de los pagos efectuados por consumo de combustible...»

**Código:** el motor manda a la válvula del 15% (`combustible_efectivo` →
`POR_CONFIRMAR` + `SIN_ACREDITAMIENTO`) **solo** con `formaPago === '01'`:

```ts
281:  if (g.formaPago === '01' && esCombustible) { ... combustible_efectivo ... }
283:  } else if (g.formaPago === '01' && !esCombustible && g.monto > topeEfectivo) { ... }
```

Los otros 29 códigos de `c_FormaPago` pasan como si cumplieran. Y el propio
archivo tiene la lista cerrada escrita 680 líneas más abajo (`:961-969`,
`MEDIOS_LIF_20A`) — el arreglo de ayer la aplicó al estímulo del LIF y no a la
deducción para ISR del mismo comprobante, que es la cifra grande.

**Escenario (ejecutado).** Diésel de $5,400, clave `15101505`, `tipoComprobante 'I'`,
complemento presente, XML verificado, receptor = RFC de la flota,
IVA $744.83, IEPS $400, `ocrExtra.litros = 200`, **`FormaPago = '17'` (compensación)**:

```
difs: permiso_cre_no_verificable, anticipo   ← ninguna sobre el medio de pago
totalDeducible 5,400 · totalPorConfirmar 0 · ivaAcreditable 744.83 · litros 0
DEDUC → 'Deducible para ISR — sujeto a permiso CRE vigente'  $5,400  tono 'condicionado'
ACRED → 'IVA acreditable (LIVA art. 5)'  $744.83  tono 'bueno'  → GREEN (pdf.ts:348)
```

Control con `'01'`, mismos datos: `deducible 0 · por confirmar 5,400 · IVA 0`,
estatus `revisar`, con la nota del 15% de la RFA 2.9. **El mismo hecho jurídico —un
pago que no está en la lista del 2º párrafo— produce dos veredictos que difieren
en $5,400 de deducción y $744.83 de IVA según el código de forma de pago.**

Alcance: entran `12` (dación en pago), `15` (condonación), `17` (compensación),
`23` (novación), `30` (aplicación de anticipos) y sobre todo **`99` (Por definir)**,
que es el valor obligatorio en todo CFDI con `MetodoPago = PPD` — el caso que el
propio commit `0d1fe65` describe como "una flota que compra diésel a crédito en la
estación factura exactamente así". Con `'99'` la salida es la misma: $5,400
deducibles y $744.83 de IVA en verde.

El mismo hueco en el primer párrafo: hospedaje de $5,000 con `FormaPago 17`
(medido) → `Deducible para ISR $5,000` tono `bueno` (**verde**, `pdf.ts:295`) +
`IVA acreditable $689.66` verde, **cero diferencias fiscales**.

**Consecuencia:** el contralor archiva un papel que afirma $5,400 de deducción y
$744.83 de IVA sobre una compra de combustible cuyo medio de pago no cumple el 2º
párrafo — o que, en el caso PPD, todavía no se ha pagado. Si el pago cae fuera del
15% de la RFA 2.9, la deducción no procede y el IVA tampoco (LIVA 5-I: lo
indispensable **es** lo deducible para ISR). Y el motor ya tiene el tercer estado
correcto escrito y probado para esto: `combustible_efectivo`.

**Causa raíz probable:** "efectivo" se usó como sinónimo de "medio de pago que no
cumple", cuando la ley define lo contrario —una lista cerrada de lo que sí
cumple—; el arreglo del 2-ago corrigió esa misma confusión en el estímulo y no en
la deducción.

---

### [ALTO] El estímulo de peaje sale afirmado y en verde en el panel y en WhatsApp, citando el artículo, sin ninguna de las cuatro condiciones que el PDF sí imprime

`src/app/dashboard/page.tsx:161` · `src/app/dashboard/[id]/page.tsx:179` +
`:288-296` (`Tot`, `ok` → `--color-ok`) · `src/lib/cuadra/cuadre/resumen.ts:96` ·
contraste: `src/lib/cuadra/liquidacion/acreditable.ts:110-119` ·
ficha `normas/lif-2026-20-A.yaml` (`verificado_fuente_primaria`)

La ficha, `estimulo_peaje.texto_vigente`, literal:

> «Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
> **exclusivamente** al transporte terrestre público y privado, de carga o pasaje,
> así como el turístico, **que utilizan la Red Nacional de Autopistas de Cuota**, que
> obtengan en el ejercicio fiscal... **ingresos totales anuales para los efectos del
> impuesto sobre la renta menores a 300 millones de pesos**... **El estímulo no podrá
> ser aplicable por las personas morales que se consideran partes relacionadas** de
> acuerdo con el artículo 179 de la Ley del Impuesto sobre la Renta.»

y sus dos hallazgos abiertos, `H5` (`severidad: media`) — *"que_hace_el_motor:
Aplica el 50% a TODO gasto con concepto 'caseta'"* — y `H6` — *"No conoce los
ingresos de la flota ni su relación de partes"*.

**Código.** El PDF cumple la regla que `acreditable.ts:9-11` fija: label
`'Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad'`,
`tono: 'condicionado'` (tinta neutra, `pdf.ts:348`) y dos pies, uno de los cuales
transcribe las cuatro condiciones y dice **"Likida NO verifica la elegibilidad"**.
Las otras dos superficies no:

```tsx
dashboard/page.tsx:161   <Acred titulo="Peaje (50%)" valor={acred.peaje}
                                base="Estímulo de autopistas · LIF 2026, Art. 20-A" />
dashboard/[id]/page.tsx:179   {d.peaje > 0 && <Tot label="Peaje 50%" value={mxn(d.peaje)} ok />}
resumen.ts:96                 lines.push(`• Peaje 50%: ${mxn(liq.peajeAcreditable)}`)
```

`Tot` con `ok` pinta el número en `--color-ok` a `text-3xl` (`:289`); `Acred` lo
pinta a `text-4xl md:text-5xl` (`acred.tsx:70-76`). Ninguna de las tres imprime
"sujeto a elegibilidad", ni las cuatro condiciones, ni la
`NOTA_INGRESO_ACUMULABLE` que el PDF sí lleva.

**Escenario (ejecutado):** caseta de $1,400 con XML verificado y subtotal
$1,206.90 (el gasto exacto de `seed.sql:127-129`) → `peajeAcreditable = 603.45`.

```
PDF     → 'Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad'
          $603.45 · tinta neutra · pies: base usada + las 4 condiciones
Panel   → 'Peaje (50%)  $603.45' en verde, pie: 'Estímulo de autopistas · LIF 2026, Art. 20-A'
WhatsApp→ '• Peaje 50%: $603.45'
```

**Consecuencia:** el panel es lo que se proyecta en la sala y el mensaje de
WhatsApp es lo que el contralor reenvía. Una flota con ingresos ≥ $300M, o parte
relacionada, o que usó casetas fuera de la Red Nacional, se lleva la cifra
afirmada con el artículo citado al lado y sin una sola reserva. El criterio
1/LIF/PI del Anexo 3 alcanza a "quien preste servicios": esa práctica sería de
Likida, no del cliente — que es literalmente lo que `acreditable.ts:56-62`
explica que este renglón existe para evitar.

**Causa raíz probable:** la regla se resolvió dentro de `acreditable.ts` (el
armador de renglones del PDF) y las otras dos superficies leen los números crudos
de `Liquidacion` sin pasar por ella.

---

### [MEDIO] (REINCIDENTE) Un hospedaje de $1 sin timbrar apaga las DOS advertencias de LISR 28-V del mismo viaje

`src/lib/cuadra/cuadre/engine.ts:691` y `:740` · ficha `normas/lisr-28-V.yaml`
(`verificado_fuente_primaria`)

Ficha, `texto_vigente`, segundo párrafo, literal:

> «...y el contribuyente acompañe **el comprobante fiscal o la documentación
> comprobatoria que ampare el hospedaje o transporte**. Cuando a la documentación que
> ampare el gasto de alimentación el contribuyente únicamente acompañe el
> comprobante fiscal relativo al transporte, la deducción... **sólo procederá cuando
> el pago se efectúe mediante tarjeta de crédito de la persona que realiza el
> viaje**.»

**Código:** las dos condiciones se evalúan por existencia de un `concepto`, sin
mirar `cfdiUuid` ni monto:

```ts
691:  const haySoporte = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
740:  const hayHospedaje = vivos.some((g) => g.concepto === 'hospedaje');
```

**Escenario (ejecutado):**

```
comida $700 timbrada (IVA $96.55), sola          → ['alimentacion_sin_soporte']  estatus revisar
+ hospedaje de $1 SIN UUID, sin RFC, sin XML     → []                            estatus con_diferencias

comida $700 con formaPago '28' + transporte $450 timbrado, sin hospedaje
                                                 → ['alimentacion_transporte_sin_tarjeta_credito']
+ el mismo hospedaje de $1 sin timbrar           → []
```

El mismo renglón de $1 —que el propio motor acaba de clasificar en `por confirmar`
con el pie "Falta timbrar la factura"— apaga las dos señales. El efecto es
discontinuo: $0 de hospedaje → advertencia; $1 sin factura → silencio y
`con_diferencias`.

**Consecuencia:** la única señal que el producto emite sobre el requisito de
soporte de LISR 28-V se apaga con el gasto más barato y menos formal de la
liquidación, sobre un dato que el operador controla (mandar una foto etiquetada
"hospedaje"). Como el motor advierte en vez de quitar deducción, apagarla no deja
rastro en ninguna cifra: el contralor no puede notar que faltó.

**Causa raíz probable:** el soporte se modela por existencia de un concepto, no
por que exista un comprobante que ampare algo.

---

### [MEDIO] (REINCIDENTE) 33 de 37 comercios caen en la rama que afirma una fecha límite sin decir que el plazo legal es todo el ejercicio — y esa fecha no la sostiene ninguna ficha

`src/lib/cuadra/cuadre/engine.ts:633-635` y `:655` ·
`src/lib/cuadra/facturacion/comercios.ts` · `src/lib/cuadra/cuadre/plazo_jerarquia.test.ts:69-73`
· fichas `normas/politica-portales-plazos.yaml` (`sin_verificar`) y
`normas/rmf-2026-2.7.1.21.yaml` (`texto_vigente: null`)

Conteo de hoy, contado a mano sobre el archivo: **37** entradas en `COMERCIOS`,
`plazoVerificado: true` en **4** (`:191`, `:280`, `:375`, `:404`) y `false` en **33**.

`politica-portales-plazos.yaml`, `advertencia_de_jerarquia`, literal:

> «ESTO NO ES UNA NORMA FISCAL. Es la política interna de un tercero y tiene CERO
> fuerza legal. **El plazo LEGAL para pedir factura es todo el ejercicio** (el SAT lo
> dice expresamente), y negarla porque "ya pasó el mes" es una práctica indebida
> listada por el propio SAT, con remedio en la Conciliación de Factura.
> El producto NUNCA debe presentar estos plazos como una obligación fiscal.»

Y `normas/README.md`, "Cómo se usa", literal:

> «Ninguna ficha `sin_verificar` debe sostener una cifra que el producto imprima.»

**Código:** el matiz legal es propiedad de `cierreComercio`, que solo existe
cuando el plazo está verificado:

```ts
633: const cierreComercio = comercio?.plazoVerificado
634:   ? ` (plazo del portal de ${comercio.nombre}, no de la ley: legalmente puedes exigir la factura dentro del ejercicio)`
635:   : ', y la ventana del comercio puede ser menor';
655:   : `puedes timbrarlo hasta el ${c.fechaLimite} (${c.diasRestantes} días)${cierreComercio}`;
```

**Escenario (ejecutado):** ticket de diésel de $3,200 del 1-ago-2026, emisor Shell
(`plazoVerificado: false`), `hoy = '2026-08-02'`. Texto impreso medido:

> «Combustible de $3,200.00 sigue sin factura: **puedes timbrarlo hasta el
> 2026-08-31 (29 días)**, y la ventana del comercio puede ser menor. Portal de Shell
> México: https://facturacion.shell.com.mx/.»

Ni "no de la ley" ni "dentro del ejercicio" — y las dos únicas ramas que sí lo
dicen (vencida y verificada) son las de 4 comercios. Además la fecha
`2026-08-31` es el default `mes_natural` (`engine.ts:610`), cuyas dos fichas son
`sin_verificar` y `texto_vigente: null`: **el producto imprime una fecha límite
que ninguna ficha del repo sostiene**, contra la regla explícita del README.
`plazo_jerarquia.test.ts:72` fija el comportamiento con
`expect(nota).not.toContain('no de la ley')`.

**Consecuencia:** el contralor lee una fecha con la autoridad de un cálculo y da
por perdido el 1-sep un CFDI que puede exigir todo el ejercicio, con Conciliación
de Factura. En diésel eso es la deducción y el IVA del gasto más grande de la
flota.

**Causa raíz probable:** el matiz legal se escribió como propiedad del
`cierreComercio` (que depende de `plazoVerificado`) en vez de como propiedad del
aviso.

---

### [MEDIO] (REINCIDENTE) El renglón "IVA acreditable (LIVA art. 5)" sale verde en la misma hoja donde el de ISR sale condicionado por el mismo hecho

`src/lib/cuadra/liquidacion/acreditable.ts:102-108` vs
`src/lib/cuadra/liquidacion/deducibilidad.ts:64-72` · `pdf.ts:295` y `:348` ·
ficha `normas/liva-5.yaml` (`verificado_fuente_primaria`)

Ficha, fracción I, literal:

> «...se consideran estrictamente indispensables las erogaciones efectuadas por el
> contribuyente **que sean deducibles para los fines del impuesto sobre la renta**,
> aun cuando no se esté obligado al pago de este último impuesto.»

y su propia `nota_verificacion`: «El IVA solo es acreditable si la erogación es
DEDUCIBLE para ISR. **No es un requisito aparte**: la ley DEFINE "estrictamente
indispensable" como "deducible para los fines del ISR"».

**Escenario (ejecutado):** diésel de $5,400 con XML verificado, `tipoComprobante 'I'`,
clave `15101505` → el motor levanta `permiso_cre_no_verificable`:

```
DEDUC → 'Deducible para ISR — sujeto a permiso CRE vigente'  $5,400  tono 'condicionado'
        pie: 'LISR 27-III y RFA 2026 regla 2.9 exigen ... El sistema no lo valida'
ACRED → 'IVA acreditable (LIVA art. 5)'                      $744.83 tono 'bueno'  pies: []
```

`pdf.ts:348` pinta `'bueno'` en verde. El mismo hecho condiciona una cifra y deja
la otra afirmada sin reserva, cuando LIVA 5-I las ata. Aplica igual a
`complemento_no_verificable` y `alimentacion_sin_soporte`: ninguno está en
`SIN_ACREDITAMIENTO` (`engine.ts:882`) y los tres acreditan el IVA al 100%.
Anoto también, y no como hallazgo aparte, que `liva-5.yaml` transcribe **solo las
fracciones I y II** del artículo mientras el renglón cita "LIVA art. 5" entero —
la propia ficha lo declara en `riesgo_actual`: *"Si el artículo exige alguna
condición adicional que hoy no se valida, la cifra impresa está de más."*

**Consecuencia:** el contralor se lleva $744.83 en verde como recuperable sobre un
gasto cuya deducibilidad el mismo papel condiciona dos renglones más arriba.

**Causa raíz probable:** `SIN_ACREDITAMIENTO` se construyó como lista de
veredictos duros y no como "todo lo que condiciona la deducibilidad ISR condiciona
el IVA".

---

### [MEDIO] (REINCIDENTE) Dos fichas que respaldan cifras impresas dicen `verificado_fuente_primaria` y en su propia nota admiten fuente secundaria — y el campo no decide nada en runtime

`normas/lisr-28-V.yaml:30-36` · `normas/lif-2026-20-A.yaml:9-14` · contraste
`normas/lisr-27-III.yaml:25-32` · `src/lib/cuadra/tools.ts:71`

`lisr-28-V.yaml` — la ficha del **$750/día**, el número más impreso del producto:

```yaml
fuente_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf"
fuente_tipo: diputados_oficial
estado_verificacion: verificado_fuente_primaria
nota_verificacion: >
  Texto idéntico en cuatro reproducciones independientes (apta.com.mx, leyesmx,
  mley.mx, tax.com.mx).
```

`lif-2026-20-A.yaml` — la ficha de los litros de diésel y del 50% de peaje:

```yaml
estado_verificacion: verificado_fuente_primaria
nota_verificacion: >
  Texto obtenido de dos reproducciones del articulado (leyes-mx.com y mley.mx) y
  corroborado con el documento de Reducciones y Estímulos Fiscales 2026 de PRODECON.
```

`lisr-27-III.yaml` tiene la misma clase de evidencia (Justia + SDV + página del
SAT) y está honestamente marcada `evidencia_corroborante`, con «NO se leyó en
diputados.gob.mx». Las genuinamente primarias se distinguen solas: `cff-30`,
`cff-69-B`, `cff-89-90` dicen «transcrito del PDF oficial de la Cámara de
Diputados» y `rfa-2026-2.9` dice «Leído en el DOF (SIDOF)».

**Lo nuevo de esta ronda:** el campo tampoco decide nada donde se usa. Grepeé
`estado` en `normas/fundamento.ts`: **cero apariciones**. El único consumidor es
`tools.ts:71`:

```ts
verificada: NORMAS[id].estado !== 'sin_verificar',
```

Un booleano que colapsa los tres estados en dos: `lisr-27-fr-III`
(`evidencia_corroborante`, la norma que funda `combustible_efectivo`,
`efectivo_sobre_tope` y `sin_cfdi`) llega al agente como `verificada: true`,
sin el matiz que `normas/README.md` exige — su tabla dice, literal, que
`evidencia_corroborante` permite afirmar «**Sí, condicionado**».

**Consecuencia:** el mecanismo de confianza del rubro no es auditable en la
ficha ni operante en el código. Un contador que abra `normas/` en la sala y lea
dos líneas seguidas de `lisr-28-V.yaml` concluye que el sello de verificación es
decorativo. Es lo que impide que este rubro llegue a 8, y esta ronda tampoco lo
tocó.

---

### [BAJO] (REINCIDENTE) La lista `MEDIOS_LIF_20A` implementa un párrafo que ninguna ficha del repo transcribe

`src/lib/cuadra/cuadre/engine.ts:956-968` · ficha `normas/lif-2026-20-A.yaml`

El comentario del propio arreglo lo declara:

> «OJO CON LA PROCEDENCIA: ninguna ficha de `normas/` transcribe ese 4º párrafo,
> así que esta lista sale del comentario de este archivo y no de una fuente que el
> repo pueda citar... queda un hallazgo abierto para transcribir el párrafo en
> `lif-2026-20-A.yaml`.»

Abrí la ficha completa hoy: transcribe `estimulo_diesel_transporte` (dos
fragmentos) y `estimulo_peaje`, más los hallazgos H4-H7. **El 4º párrafo del medio
de pago no está en ninguna parte del repo.** La lista `02,03,04,05,28,29` es una
decisión de ingeniería sin norma citable detrás.

**Escenario:** un contralor pregunta por qué su diésel de 200 L con `FormaPago 05`
(monedero) sí acredita y el de `FormaPago 06` (dinero electrónico) no. La única
respuesta que el repo puede dar es un comentario de código. Y por
`por_diferencia.ts`, ese veredicto no tiene entrada: el agente no puede citar nada
al explicarlo.

**Consecuencia:** no mueve una cifra hoy —la lista es conservadora— pero es la
mitad del hallazgo FISCAL-2 que quedó sin cerrar, y el ancla de 8+ pide
exactamente lo contrario: que cada cifra fiscal impresa rastree a una ficha.

---

### [BAJO] (REINCIDENTE) Dos fichas declaran mal dónde se usan, y una de las dos afirma de sí misma algo que el código desmiente

`normas/rmf-2026-2.7.1.21.yaml:30-31` · `normas/politica-portales-plazos.yaml:48-50`

`rmf-2026-2.7.1.21.yaml`:

```yaml
usado_en_codigo:
  - "FISCAL_LEGAL.md §1.6 (documentación, no código)"
```

y `src/lib/cuadra/normas/por_diferencia.ts:50`:

```ts
factura_por_vencer: ['rmf-2026-2.7.1.21', 'politica-portales-plazos-facturacion'],
```

Sí se usa en código, y es una de las dos normas que `guardiaFundamento` autoriza
al agente a citar sobre un aviso de facturación — con `texto_vigente: null`.

`politica-portales-plazos.yaml:48-50` dice hoy:

> «`facturacion/comercios.ts` — `plazoVerificado: false` **en 12 de 13 entradas**;
> `true` SOLO en office_depot»
> «`cuadre/engine.ts` — regla factura_por_vencer: ... **en las dos ramas (vencida y
> no vencida) dice que el plazo LEGAL es todo el ejercicio**»

Son 37 entradas y 4 verificadas, y la segunda frase es **falsa contra la salida
medida** del hallazgo anterior: la rama no vencida sin verificar no menciona el
ejercicio. La `nota_verificacion` de esa misma ficha documenta que ya se corrigió
una vez por este motivo el 28-jul.

**Consecuencia:** `usado_en_codigo` es el campo con el que se calcula el radio de
impacto cuando una norma cambia (lo dice `normas/README.md`). Si miente, una
reforma se evalúa contra el archivo equivocado. `normas_sincronizadas.test.ts`
compara id, estado, jerarquía, citas, ruta y `fecha_vigencia_desde` — nunca
`usado_en_codigo`.

---

### [BAJO] (REINCIDENTE) Un hotel guardado con el concepto heredado `viaticos` sale con "$1,250 no deducibles" citando LISR 28-V, y el papel lo llama "Alimentación"

`src/lib/cuadra/cuadre/engine.ts:780-783` · ficha `normas/lisr-28-V.yaml`

Ficha, literal: «Tratándose de gastos de viaje destinados a la **alimentación**,
éstos sólo serán deducibles hasta por un monto que no exceda de $750.00
diarios...», y su `confirmado_del_codigo`: «Solo alimentación; **el hospedaje
nacional no tiene tope**: CORRECTO».

**Escenario (ejecutado):** gasto de $2,000 del 1-ago con `concepto: 'viaticos'`
(una noche de hotel guardada por el OCR viejo), timbrado, IVA $275.86:

```
totalDeducible 750 · totalNoDeducible 1,250 · ivaAcreditable 103.45
nota: «Alimentación del 2026-08-01: $2,000.00 excede el tope fiscal de $750.00
       por día (LISR 28-V) — el excedente de $1,250.00 no es deducible.»
```

El comentario de `:780-782` lo llama "criterio conservador". No lo es: el lado
conservador para el contribuyente es no declararle perdida una deducción que la
ley le concede. **Alcance honesto:** el OCR de hoy no emite `viaticos`
(`intake/ocr.ts`), pero `0025_dominios_check.sql` sigue admitiendo el valor y
`repo.ts` lo lee tal cual.

---

### [BAJO] `/api/demo` corre el motor real sin ninguna configuración fiscal

`src/app/api/demo/route.ts:41` vs `src/lib/cuadra/cuadre/desde_db.ts:44-60`

```ts
41: const liq = cuadrarViaje({ viajeId:'demo', anticipo: body.anticipo ?? 0, gastos, politica: POLITICA, ruta:'Silao-Laredo' });
```

Sin `estimulos`, sin `empresaRfc`, sin `hidrocarburos`, sin `hoy`. `engine.ts:779`
condiciona todo el bloque del tope de LISR 28-V a `if (topeAlimentacion != null)`,
así que la regla no corre; tampoco la validación de receptor, ni el complemento,
ni el permiso CRE, ni el aviso de facturación.

**Corrección honesta de mi propio reporte del 2-ago:** dije que las cifras de
deducibilidad divergían entre las dos puertas. Releído el archivo, `/api/demo`
**no devuelve** `totalDeducible`, `totalNoDeducible` ni `ivaAcreditable`
(`:42-48`), y el mapeo de entrada descarta `fecha`, `formaPago`, `xmlVerificado` y
`rfcReceptor` (`:33-40`). Lo que sí diverge es la **lista de diferencias**: una
alimentación de $3,000 timbrada sale sin `viatico_excede_fiscal` por esta puerta y
con ella por `desde_db`. Ninguno de los cuatro presets (`demo/page.tsx:12-17`) es
`alimentacion`, así que hoy no se dispara desde la UI. Baja de MEDIO a BAJO.

**Consecuencia:** el simulador que la página anuncia como «El cuadre es real»
(`demo/page.tsx`) puede omitir una observación fiscal que el producto sí emite, si
alguien edita un preset antes del 6-ago.

---

## Lo que revisé y está bien

- **Los dos altos del 2-ago anclaron** — verificado ejecutando el motor, no
  leyendo el commit. Ver la sección de arriba con las salidas medidas.
- **El estímulo de IEPS no se calcula con el IEPS trasladado.** `engine.ts:888`
  (`const iepsAcreditable = 0`) y `:970-990` (se cuentan litros, no pesos), con
  `acreditable.ts:94-100` en `tono: 'condicionado'` y la nota de la cuota semanal.
  Es literalmente lo que `lif-2026-20-A.yaml` pide: «cuota IEPS vigente al momento
  de la compra × LITROS. **No es el IEPS trasladado en el CFDI**». El error que el
  rubro nombra como ejemplo canónico no está aquí. La banda 0.5×–2× de
  `diesel_desviacion` (`:982`) atrapa el decimal corrido.
- **RFA 2026 regla 2.9 aplicada al concepto correcto y solo a un beneficio.**
  `engine.ts:281-282` manda el combustible en efectivo a `POR_CONFIRMAR` y lo deja
  en `SIN_ACREDITAMIENTO` (`:882`), con el comentario de `:870-875` explicando que
  la facilidad salva la deducción y no el acreditamiento — coincide con el
  `limite_importante` de la ficha. `rfa-2026-2.2` (el 8%) tiene `usado_en_codigo: []`
  y grepeado no se ofrece en ningún lado.
- **El interruptor del complemento de hidrocarburos.** `engine.ts:442-486` +
  `indice.ts:306` (`exigibleDesde: null`) + `normas_sincronizadas.test.ts:86-97`.
  Con la fecha sin respaldo el motor emite `complemento_no_verificable` (revisión)
  y **no** declara no deducible; la fecha que decide dinero sale de la ficha, no de
  `config.ts`. Sigue siendo el mejor mecanismo del rubro.
- **RLISR 57 y el viático a nombre del operador.** `engine.ts:391-410`: si el RFC
  coincide con `operadorRfc` no se reporta nada; si falta el dato sale
  `viatico_rfc_operador` (revisión, sin quitar deducción). Coincide con el texto
  transcrito del reglamento.
- **Las leyendas citan lo que la norma sí dice.** `cuadre/leyendas.ts:36-58`
  contra `cff-89-90.yaml`: la frase «pueden diferir de los criterios que dé a
  conocer el SAT» es la conducta que exime del art. 89 último párrafo, y la
  referencia al art. 52 CFF («no constituye un dictamen») es correcta. Busqué una
  cita que no dijera lo citado y no la encontré.
- **Las tres cubetas siempre suman el comprobado.** `engine.ts:1022-1052` y el
  portón de `deducibilidad.ts:54-55` (si no suman con 1.5 centavos de tolerancia,
  no se imprime el desglose). El contralor no puede sacar la calculadora y
  encontrar una diferencia.
- **Extracción de impuestos del XML.** `intake/cfdi_xml.ts:141-153`: IVA `002` e
  IEPS `003` se suman de `Impuestos/Traslados` del comprobante y nunca se
  recomputan con una tasa asumida (`engine.ts:898` exige `xmlVerificado`), así que
  el 8% fronterizo sale tal cual del papel. `formaPagoSat` (`:87-91`) normaliza a
  dos dígitos sin inventar valores.
- **DEDUCIBLE ≠ PAGADERO sigue cableado.** `laboral/pagadero.ts:196-230` llamado
  desde `pdf.ts:376-386`, con las cubetas del motor (`cubetaDe`) y con las copias
  excluidas por `copiasDeComprobante` — el reembolso ya no cuenta tres veces el
  mismo ticket. LFT 263-I manda sobre la política interna, y `sin_criterio` no
  descuenta solo.
- **`SOLO_CONTRALOR`** (`resumen.ts:24-33`) filtra bien: los veredictos que el
  operador no puede arreglar (EFOS, cancelado, permiso CRE, tarjeta de crédito de
  LISR 28-V) no le llegan; `complemento_no_verificable` sí, porque es lo único que
  él puede resolver.

## Lo que NO alcancé a revisar

- **No verifiqué ninguna norma contra su fuente.** Esta ronda corre sin red hacia
  el DOF, el SAT ni diputados.gob.mx. Todo lo que digo sobre el texto de una ley
  sale de la transcripción que la ficha declara. Las fichas
  `evidencia_corroborante` o con `texto_vigente: null` —`cff-29-A`,
  `criterio-1-CFF-PI`, `criterio-1-LIF-PI`, `rmf-2026-2.7.1.21`,
  `rmf-2026-2.7.1.48`, `politica-portales-plazos`— quedan como **no verificables
  en esta ronda**: no asumo que estén bien ni que estén mal. Anoto que `cff-29-A`
  funda cinco veredictos en `por_diferencia.ts` y sigue sin texto, y que
  `rfc_receptor`, `cfdi_cancelado` y `cfdi_no_encontrado` —tres de los seis
  veredictos duros de `NO_DEDUCIBLE_ISR`— se apoyan en ella.
- **No generé un PDF.** Verifiqué con el motor real las estructuras que le llegan
  (`filasDeducibilidad`, `filasAcreditables`, `diferencias` con su `monto`) y leí
  `pdf.ts`, pero no miré el papel renderizado.
- **`facturacion/permiso_cre.ts`** (12,625 permisos): sigue sin consumidor real
  fuera de su propia prueba. No evalué si la tabla es correcta.
- **Las condiciones 1 y 2 de la RFA 2.9** (dedicación exclusiva al autotransporte
  de carga federal, régimen del Título II Cap. VII o Título IV Cap. II Secc. I) y
  **el contador del 15% por ejercicio**: siguen sin capturarse. Es el MEDIO de la
  ronda 8, abierto por cuarta ronda; no lo repito como hallazgo pero cuenta en la
  nota.
- **`normas/fundamento.ts` (447 líneas):** verifiqué que discrimina por jerarquía
  (`:357`) y que no lee `estado` en absoluto (eso es el MEDIO de arriba). No probé
  la sustitución de texto ni el detector de siglas.
- **`intake/decidir.ts`, `emparejar.ts`, `ocr.ts`:** la clasificación de concepto
  decide qué regla fiscal aplica. No audité el prompt del OCR ni sus umbrales.
- **Dos deudas menores que anoto sin hallazgo, porque no pude escribir un
  escenario con valores:** (a) `config.ts:93-103` no define
  `precioDieselPorDefecto` dentro de `estimulos`, así que `engine.ts:979` siempre
  cae al literal `27.0` y el `tabulador.precioDieselPorDefecto` del tenant nunca
  llega a la banda de `diesel_desviacion`; (b) `indice.ts:127` tiene
  `titulo: ">"`, un resto del YAML colado al índice de `criterio-1-CFF-PI`.
- **`FISCAL_LEGAL.md`** (documento comercial con cifras fiscales, el que el equipo
  usa para hablar con clientes): cuarta ronda sin auditar.
- **Las 4 fichas de LFPDPPP:** son del rubro legal.
