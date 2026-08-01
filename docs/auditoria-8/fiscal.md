# Cumplimiento fiscal — auditoría 8

**Nota: 5/10** (antes 5). Razón del movimiento: dos fuerzas que se cancelan, y lo
digo con las palabras exactas. **Se atacó y subió**: el CRÍTICO abierto de la
ronda 6 —el RFC genérico `XAXX010101000` apagaba las dos ramas de validación de
receptor y un CFDI de tercero salía "Deducible para ISR" en verde— está
**CERRADO**, verificado corriendo el motor real (`engine.ts:170-173`: el genérico
ya entra a `rfcEmpresaInservible`; el mismo insumo sale hoy `deducible 0 · iva 0 ·
por confirmar 5,600`). **Mirada más profunda**: el ALTO que la ronda 6 declaró
cerrado —"el estímulo de peaje ya NO se imprime como derecho ganado"— se cerró
**solo en `pdf.ts`**. Las dos pantallas del contralor y el resumen de WhatsApp
siguen imprimiendo `Peaje 50% $603.45` en verde, sin una sola de las cuatro
condiciones. La nota anterior estaba inflada en ese renglón: se dio por cerrado un
hallazgo que se cerró en una de cuatro superficies. Neto: se queda en 5.

Riesgo mayor hoy: **el motor afirma deducibilidad y acreditamiento sin validar tres
requisitos que están escritos, literales, en fichas `verificado_fuente_primaria`
que el propio repo tiene abiertas** — el permiso de hidrocarburos del proveedor
del diésel, el medio de pago de la alimentación amparada solo por transporte, y la
elegibilidad del estímulo de peaje fuera del PDF.

## Hallazgos

### [ALTO] REINCIDENTE — el estímulo de peaje sí se imprime como derecho ganado: en verde, en las dos pantallas del contralor y en WhatsApp
`src/app/dashboard/[id]/page.tsx:134` · `src/app/dashboard/page.tsx:141` · `src/lib/cuadra/cuadre/resumen.ts:85` · ficha `normas/lif-2026-20-A.yaml`

Texto de la norma (`estimulo_peaje.texto_vigente`, `verificado_fuente_primaria`):
«Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
**exclusivamente** al transporte terrestre público y privado, de carga o pasaje,
así como el turístico, **que utilizan la Red Nacional de Autopistas de Cuota**, que
obtengan en el ejercicio fiscal… **ingresos totales anuales… menores a 300 millones
de pesos**… El estímulo **no podrá ser aplicable por las personas morales que se
consideran partes relacionadas** de acuerdo con el artículo 179 de la Ley del
Impuesto sobre la Renta.»

La misma ficha lo dice de este código: H5 «Aplica el 50% a TODO gasto con concepto
'caseta'» y H6 «No conoce los ingresos de la flota ni su relación de partes».

Escenario (corrido con `cuadrarViaje`, no leído): flota con ingresos anuales de
$400M, caseta con CFDI verificado, `subTotal 1,206.90`, total $1,400 →
`peajeAcreditable 603.45`. Sale así:

- `dashboard/[id]/page.tsx:134` → `<Tot label="Peaje 50%" value="$603.45" ok />`, y
  `ok` es `var(--color-ok)` (`[id]/page.tsx:244`): **verde**, bajo el encabezado
  «Acreditable / recuperable». Cero condiciones.
- `dashboard/page.tsx:141` → tarjeta HERO «Estímulos acreditables del periodo»:
  `Peaje (50%) $603.45`, pie `Estímulo de autopistas · LIF 2026, Art. 20-A`. La
  cifra con el artículo al lado y ni una palabra de elegibilidad.
- WhatsApp (`resumen.ts:85`, salida literal del motor): `Acreditable
  (recuperable):` / `• Peaje 50%: $603.45`.

En el PDF, en cambio, `acreditable.ts:110-119` sí imprime `Estímulo de peaje 50%
(LIF 2026 art. 20, ap. A) — sujeto a elegibilidad`, tono `condicionado` (tinta
neutra, `pdf.ts:301`) y los dos pies `BASE_ESTIMULO_PEAJE` y
`CONDICIONES_ESTIMULO_PEAJE`. El arreglo existe y está a un import de distancia de
las tres superficies que no lo usan.

Consecuencia: el contralor —que es quien mira el panel, no el PDF— se lleva un
estímulo al que su flota puede no tener derecho, en verde y citando el artículo. Y
el criterio 1/LIF/PI del Anexo 3 alcanza a «quien preste servicios»: esa práctica
sería de Likida, no del cliente.

Causa raíz probable: `filasAcreditables()` es el único lugar donde vive la
condición, y solo `pdf.ts` la llama; las vistas y `resumen.ts` reconstruyen los
renglones a mano desde los campos crudos de la liquidación.

---

### [ALTO] El camino más confiable —el XML del CFDI a secas— entrega CERO litros de diésel elegible
`src/lib/cuadra/cuadre/engine.ts:709` · `src/lib/cuadra/intake/cfdi_xml.ts:105-119` · `src/lib/cuadra/processor.ts:568-587` · ficha `normas/lif-2026-20-A.yaml`

Texto de la norma (`estimulo_diesel_transporte.texto_vigente`,
`verificado_fuente_primaria`): «el monto que se podrá acreditar será el que resulte
de multiplicar la cuota del impuesto especial sobre producción y servicios que
corresponda según el tipo de combustible… **por el número de litros importados o
adquiridos**». `como_se_calcula`: «cuota IEPS vigente al momento de la compra ×
LITROS».

Los litros son, por decisión del propio producto, **el dato que se entrega** (no
los pesos). Y salen de un solo sitio:

```ts
// engine.ts:709
const litros = Number((g.ocrExtra as Record<string, unknown> | undefined)?.litros ?? 0);
```

`ocrExtra.litros` lo escribe únicamente la visión sobre la foto (`intake/ocr.ts:394`).
El parser del XML lee `ClaveProdServ` y `ClaveUnidad` del concepto
(`cfdi_xml.ts:115-116`) y **nunca lee `Cantidad`**, aunque ahí está: el XML del
propio seed trae `Cantidad="113.00" ClaveUnidad="LTR"`. Y `processor.ts:568-587`
—la rama «el XML llegó sin foto previa»— crea el gasto sin `ocrExtra`.

Escenario (corrido): mismo CFDI de diésel de $4,200 / 113 L, clave `15101505`,
`FormaPago 03`, receptor = la flota.

```
XML enviado solo (sin foto):  litros 0    | deducible 4,200 | iva 581.38
                              → filasAcreditables: [["IVA acreditable (LIVA art. 5)","$581.38"]]
                                (el renglón de diésel NO se imprime)
Mismo CFDI con foto previa:   litros 113
```

Y el producto pide exactamente ese camino: «reenvía el XML (el que te manda la
gasolinera por correo)» (`engine.ts:410`), y `processor.ts:532` lo acepta suelto.

Consecuencia: la flota pierde el estímulo del art. 20-A sobre sus compras **mejor
documentadas**. A 113 L por carga y con la cuota que el propio repo cita ($2.0925–
$7.3634 según semana), son $236–$832 por carga que el contador nunca ve porque el
papel dice 0. Es el mismo modo de falla que el commit `3bf1ff8` documenta para el
peaje: «el 50% se perdía justo en los comprobantes mejor documentados. Dinero real,
y invisible: nada fallaba».

Causa raíz probable: `CfdiConceptoXml` no tiene campo `cantidad`, así que el único
origen de litros es la visión.

---

### [ALTO] El permiso de hidrocarburos del proveedor —requisito literal de deducibilidad— no se valida en ninguna parte
`src/lib/cuadra/intake/cfdi_xml.ts:105-119` · `src/lib/cuadra/cuadre/engine.ts:221-226` y `364-412` · `src/lib/cuadra/facturacion/permiso_cre.ts:129` · fichas `normas/rfa-2026-2.9.yaml` y `normas/lisr-27-III.yaml`

Texto de la norma (`rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`**, DOF/SIDOF):
«…siempre que estos no excedan el 15 por ciento del total de los pagos efectuados
por consumo de combustible para realizar su actividad. **Además, en el comprobante
fiscal deberá constar la información del permiso vigente, expedido de acuerdo con
la Ley de Hidrocarburos al proveedor del combustible y que, en su caso, dicho
permiso no se encuentre suspendido en el momento de la expedición del comprobante
fiscal.**» — y `condiciones_de_aplicacion` la lista como cuarta condición: «El CFDI
debe consignar el permiso vigente y no suspendido».

El mismo requisito, para **toda** compra de combustible (no solo la pagada en
efectivo), en `lisr-27-III.yaml`, 2º párrafo: «…y en el comprobante fiscal deberá
constar la información del permiso vigente, expedido en los términos de la Ley de
Hidrocarburos al proveedor del combustible y que, en su caso, dicho permiso no se
encuentre suspendido». Y `cff-29-A.yaml` registra la adición del inciso f) a la
fracción V: «número de permiso vigente de la CNE para quienes distribuyan o
enajenen hidrocarburos o petrolíferos».

El código: `cfdi_xml.ts:105-119` extrae del concepto **ClaveProdServ, ClaveUnidad y
la mera presencia** de un nodo cuyo nombre case con `/hidro|petro/i` — no lee
`NumeroPermiso` ni `TipoPermiso`, que es lo que ese nodo contiene (el XML del seed
trae `TipoPermiso="PER20" NumeroPermiso="PL/12345/EXP/ES/2020"`). No existe campo
`permiso` en `Gasto` (comprobado con dos búsquedas: `rg permiso` sobre `src/` sin
tests, y `rg NumeroPermiso` sobre todo `src/`: cero coincidencias). Y
`permiso_cre.ts` —12,625 permisos cosechados, commit `688b8c2`— **no tiene un solo
llamador de producción**: su único import está en su propio test.

Escenario (corrido): diésel $4,200, 113 L, clave `15101505`, XML verificado con
complemento presente, `FormaPago 03`, receptor = la flota, emisor **sin permiso CRE
vigente** →

```
deducible 4,200 | iva 581.38 | litros 113 | diferencias: sobre_politica, anticipo
WhatsApp: "Acreditable (recuperable): • Diésel elegible para el estímulo de IEPS: 113 L · IVA: $581.38"
```

Ni una palabra del permiso. Peor: cuando el pago es en efectivo, `engine.ts:222`
imprime una afirmación sobre la facilidad —«cuenta contra el tope del 15% del
combustible del ejercicio (RFA 2026 regla 2.9). **Dentro del 15% sigue siendo
deducible**»— citando una regla cuya cuarta condición el motor jamás miró.

Consecuencia: la flota deduce $4,200 y acredita $581.38 de IVA sobre un CFDI que
por el 2º párrafo de LISR 27-III no ampara la deducción; ante una revisión responde
el cliente, con el papel de Likida en la mano.

Causa raíz probable: el parser trata el complemento de hidrocarburos como un
booleano de presencia en vez de como una fuente de datos.

---

### [ALTO] Alimentación pagada en efectivo, amparada solo por transporte: se imprime deducible en verde y con CERO diferencias
`src/lib/cuadra/cuadre/engine.ts:541-558` y `580-631` · ficha `normas/lisr-28-V.yaml`

Texto de la norma (`texto_vigente`, **`verificado_fuente_primaria`**, cuatro
reproducciones): «…éstos sólo serán deducibles hasta por un monto que no exceda de
$750.00 diarios por cada beneficiario… y el contribuyente acompañe el comprobante
fiscal o la documentación comprobatoria que ampare el hospedaje o transporte.
**Cuando a la documentación que ampare el gasto de alimentación el contribuyente
únicamente acompañe el comprobante fiscal relativo al transporte, la deducción a
que se refiere este párrafo sólo procederá cuando el pago se efectúe mediante
tarjeta de crédito de la persona que realiza el viaje.**»

La propia ficha lo tiene abierto como H2, `severidad: media`: «No valida el medio
de pago en ese supuesto».

El código: `engine.ts:548` solo pregunta si existe **hospedaje o transporte**
(`haySoporte`); si hay transporte, la advertencia `alimentacion_sin_soporte` no se
emite y el tope de `engine.ts:580-631` corre sin mirar `formaPago`.

Escenario (corrido): mismo día, comida $700 con CFDI verificado y `formaPago '01'`
(efectivo — por debajo de los $2,000, así que tampoco entra `efectivo_sobre_tope`)
+ taxi $350 con CFDI, **sin hospedaje**:

```
totalDeducible 1,050 | totalNoDeducible 0 | ivaAcreditable 144.83
diferencias: (ninguna)
filasDeducibilidad: [{"label":"Deducible para ISR","monto":1050,"tono":"bueno"}]
```

`tono: 'bueno'` es GREEN en `pdf.ts:251`. Por el texto literal, esos $700 no son
deducibles (el pago no fue con tarjeta de crédito del viajero), y con LIVA 5-I
—«en la proporción en la que dichas erogaciones sean deducibles»— tampoco lo son
sus $96.55 de IVA.

Consecuencia: el PDF que se archiva afirma $1,050 deducibles y $144.83 acreditables
donde hay $350 y $48.28. Silencioso: no hay diferencia que le avise al contralor.

Causa raíz probable: `haySoporte` es un booleano de existencia; la ley distingue
*cuál* de los dos comprobantes ampara y, si es el de transporte, exige medio de pago.

---

### [MEDIO] El 50% del peaje se aplica al SubTotal del comprobante COMPLETO, no al gasto de casetas
`src/lib/cuadra/cuadre/engine.ts:683` · `src/lib/cuadra/intake/cfdi_xml.ts:133` y `160` · ficha `normas/lif-2026-20-A.yaml`

Texto de la norma: «…consistente en permitir un acreditamiento de los gastos
realizados en el pago de los servicios por el uso de la infraestructura mencionada
hasta en un 50 por ciento **del gasto total erogado por este concepto**.»

El código toma el SubTotal del **comprobante**, no del concepto:

```ts
// engine.ts:683
if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;
```
```ts
// cfdi_xml.ts:160
subTotal: num(comp['@_SubTotal']),        // ← atributo del Comprobante
// cfdi_xml.ts:133  el concepto "representativo" es UNO SOLO; los demás se tiran
const rep = conceptos.find((c) => c.claveProdServ?.startsWith(PREFIJO_COMBUSTIBLE)) ?? conceptos[0];
```

Escenario (corrido): CFDI mensual de un operador de telepeaje (IAVE/PASE) por
$11,600, `SubTotal 10,000` = $9,500 de casetas + $500 de cuota de administración;
el concepto representativo es la clave de peaje `95111602`, así que el gasto entra
como `caseta` → `peajeAcreditable 5,000`. Lo correcto por «este concepto» es
$4,750: **$250 de estímulo inventado por factura**, en un comprobante que llega
todos los meses.

Consecuencia: acreditamiento de más — el lado caro, porque responde el cliente. Y
la cifra sale impresa junto al artículo, que es lo que la vuelve una afirmación.

Causa raíz probable: el modelo de datos guarda un solo `subTotal` por gasto y el
parser descarta los conceptos no representativos.

---

### [MEDIO] El plazo del portal del comercio se imprime como fecha límite sin el marco legal, en 33 de 37 comercios
`src/lib/cuadra/cuadre/engine.ts:505-512` · ficha `normas/politica-portales-plazos.yaml`

Texto de la ficha (`advertencia_de_jerarquia`): «**ESTO NO ES UNA NORMA FISCAL.** Es
la política interna de un tercero y tiene CERO fuerza legal. **El plazo LEGAL para
pedir factura es todo el ejercicio (el SAT lo dice expresamente)**, y negarla porque
"ya pasó el mes" es una práctica indebida listada por el propio SAT… **El producto
NUNCA debe presentar estos plazos como una obligación fiscal.**»

El código añade el marco legal **solo** cuando el plazo está verificado:

```ts
// engine.ts:505-507
const cierreComercio = comercio?.plazoVerificado
  ? ` (plazo del portal de ${comercio.nombre}, no de la ley: legalmente puedes exigir la factura dentro del ejercicio)`
  : ', y la ventana del comercio puede ser menor';
```

`plazoVerificado: true` está en **4** de las **37** entradas de `comercios.ts`
(office_depot, g500, megasur, la_gas). Para las otras 33 el plazo es el default
`mes_natural`, que es una suposición de nivel 6, y sale así (salida literal del
motor, ticket de OXXO Gas del 1-ago-2026):

```
Combustible de $900.00 sigue sin factura: puedes timbrarlo hasta el 2026-08-31
(30 días), y la ventana del comercio puede ser menor. Portal de OXXO Gas: …
```

Consecuencia: el contralor lee una fecha límite dura en el documento que archiva y
concluye que el 1-sep perdió el CFDI. No es cierto: puede exigir la factura dentro
del ejercicio y tiene la Conciliación de Factura del SAT. Es exactamente el error de
confundir niveles que `normas/README.md` llama el más caro del dominio, y el propio
comentario de `engine.ts:491-504` dice haberlo cerrado «en las dos ramas».

Causa raíz probable: el matiz legal se ató a `plazoVerificado`, cuando el que lo
necesita es el caso contrario (plazo supuesto).

---

### [BAJO] La vista de detalle todavía puede imprimir el IEPS en PESOS, en verde
`src/app/dashboard/[id]/page.tsx:132` · ficha `normas/criterio-1-LIF-PI.yaml`

Texto de la ficha (`contenido_esencial`): «El estímulo del IEPS de diésel se calcula
con la **CUOTA SEMANAL DISMINUIDA**, no con la cuota entera. Calcularlo con la
entera es práctica indebida — de quien lo hace **Y de quien le presta el
servicio**.» `pendiente_en_producto`: «el producto NO debe imprimir una cifra de
estímulo de diésel en pesos: solo litros, cuota fechada y rango».

`engine.ts:653` fija `const iepsAcreditable = 0`, así que ninguna liquidación nueva
puede alimentar esto. Pero la vista sigue leyendo la columna heredada
(`analytics.ts:205`) y la pinta:
`{d.ieps > 0 && <Tot label="IEPS de diésel (vs ISR)" value={mxn(d.ieps)} ok />}` —
`ok` = verde. Escenario: cualquier fila de `liquidacion` escrita antes del cambio, o
importada, con `ieps_acreditable = 1,247.30` → la pantalla del contralor imprime
`$1,247.30` de estímulo de IEPS en verde, que es el IEPS trasladado del CFDI y **no**
el estímulo. Bajo porque hoy no hay productor de esa cifra; queda como puerta
abierta con etiqueta de "compatibilidad".

Causa raíz probable: se cerró el productor y se dejó vivo el consumidor.

---

## Fichas que abrí, y su estado de verificación

| Ficha | `verificado_fuente_primaria` | Código que la implementa | ¿Cuadra? |
|---|---|---|---|
| `lif-2026-20-A.yaml` (diésel) | **sí** | `engine.ts:686-714` (litros, `iepsAcreditable = 0`), `acreditable.ts:94-101` | **parcial** — la fórmula es correcta (litros, nunca pesos); los litros se pierden en el camino XML (ALTO) |
| `lif-2026-20-A.yaml` (peaje) | **sí** | `engine.ts:683`, `acreditable.ts:110-119`, `resumen.ts:85`, `dashboard/page.tsx:141`, `[id]/page.tsx:134` | **no** — base equivocada en CFDI mixtos (MEDIO) y condiciones ausentes fuera del PDF (ALTO) |
| `lisr-28-V.yaml` | **sí** | `engine.ts:541-558`, `580-631`, `config.ts:94` | **parcial** — $750/día por beneficiario y solo alimentación: correcto; H2 (medio de pago) no validado (ALTO) |
| `liva-5.yaml` | **sí** | `engine.ts:665-681` (proporción), `acreditable.ts:102-108` | **sí** — la proporción de erogaciones parcialmente deducibles está implementada y probada |
| `rfa-2026-2.9.yaml` | **sí** | `engine.ts:221-222`, `647` (`SIN_ACREDITAMIENTO`), `periodo/combustible.ts`, `repo.ts:595-652` | **parcial** — el 15% es del EJERCICIO y el denominador es combustible/combustible: correcto; la condición del permiso no se valida (ALTO) |
| `rfa-2026-2.2.yaml` | **sí** | ninguno (`usado_en_codigo: []`) | n/a — y es correcto: la regla excluye combustible y el producto no la promete |
| `rlisr-57.yaml` | **sí** | `engine.ts:336-346` (`viatico_rfc_operador`) | **sí** — el viático a nombre del operador subordinado no se rechaza |
| `cff-89-90.yaml` | **sí** | `cuadre/leyendas.ts:36-58`, `pdf.ts:400` | **sí** — la manifestación por escrito («puede diferir de los criterios que dé a conocer el SAT») está en las dos leyendas y en el pie del PDF |
| `cff-30.yaml` | **sí** | `repo.ts — saveCfdiXmlRaw`, `processor.ts:591` | **sí** — el XML crudo se conserva |
| `cff-69-B.yaml` | **sí** | `engine.ts:352-355` (`cfdi_efos`, `cfdi_efos_indeterminado`) | **sí** — el estado indeterminado no declara no deducible |
| `lisr-27-III.yaml` | no (`evidencia_corroborante`) | `engine.ts:223-225` (tope $2,000, `>` estricto: correcto), 2º párrafo del permiso: **sin implementar** | **no verificable en esta ronda** en cuanto a texto; el requisito del permiso lo respalda además `rfa-2026-2.9` (primaria) |
| `cff-29-A.yaml` | no (`texto_vigente: null`) | `engine.ts:252` (`comprobante_no_fiscal`), `por_diferencia.ts:32,38,43-45` | **no verificable en esta ronda** — se cita en cinco tipos de diferencia sobre una ficha sin texto transcrito |
| `rmf-2026-2.7.1.48.yaml` | no (`evidencia_corroborante`) | `engine.ts:364-412`, `indice.ts` (`exigibleDesde: null`) | **sí** — con `null` el motor avisa y no declara no deducible; verificado corriendo |
| `criterio-1-LIF-PI.yaml` | no (`texto_vigente: null`) | `engine.ts:653`, `resumen.ts:71-85`, `[id]/page.tsx:132` | **no verificable en esta ronda**; el espíritu se respeta salvo la puerta heredada del BAJO |
| `criterio-1-CFF-PI.yaml` | no (`evidencia_corroborante`) | no localicé consumidor | **no verificable en esta ronda** |
| `rmf-2026-2.7.1.21.yaml` | no (`texto_vigente: null`) | `por_diferencia.ts:49` (`factura_por_vencer`) | **no verificable en esta ronda** |
| `politica-portales-plazos.yaml` | no (`sin_verificar`, nivel 6) | `engine.ts:482-527`, `facturacion/comercios.ts`, `caducidad.ts` | **no** — el marco legal solo viaja en 4 de 37 comercios (MEDIO) |
| `lft-110-111-263.yaml` | **sí** | `laboral/pagadero.ts` | no revisada esta ronda (ver abajo) |
| `lfpdppp-*.yaml` (4) | **sí** | `privacidad.ts` | fuera de mi rubro — es de otro auditor |
| `normas/.latido-cuota-diesel` | n/a | — | ver abajo |

**Son 21 fichas, no 22** (`ls normas/*.yaml` = 21; `NORMAS` en `indice.ts` = 21
entradas, y `normas_sincronizadas.test.ts` pasa 10/10). El MAPA dice 22.

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 6 está CERRADO, medido.** `engine.ts:130-136` filtra el
  genérico de `rfcsOk` y `engine.ts:170-173` lo mete a `rfcEmpresaInservible` /
  `rfcEmpresaNoCapturado`. Corrido con el mismo insumo del reporte anterior
  (`empresaRfc: 'XAXX010101000'`, CFDI a un tercero): `deducible 0 · noDed 0 ·
  porConfirmar 5,600 · iva 0 · peaje 0 · litros 0`, diferencias
  `rfc_receptor_no_verificable`, y `filasAcreditables()` devuelve `null` (la sección
  ACREDITABLE no se imprime). Ya no aprueba por defecto.
- **El error canónico del IEPS sigue cerrado.** `engine.ts:653`: `const
  iepsAcreditable = 0`, y el motor entrega litros. Verifiqué la pregunta del
  encargo: **no hay ninguna cuota en el repo** (`normas/cuota-ieps-diesel.yaml` no
  existe; `rg cuota` sobre `src/` no encuentra una sola constante numérica de cuota).
  Por lo tanto **no hay cuota con rango vencido** y **el motor no hace nada
  distinto si la fecha cae fuera de un rango**: no hay rama que dependa de eso. El
  `riesgo` que declara `normas/.latido-cuota-diesel` («el motor no tiene con qué
  calcular el estímulo») describe una capacidad que el motor nunca tuvo ni debe
  tener hoy: la decisión D2 es entregar litros. La corrida bloqueada es INFRA.
- **La proporción de LIVA 5-I y las tres cubetas.** `engine.ts:614-615` y `768-771`:
  el exceso del tope diario se reparte por `tope/total` y el IVA hereda la misma
  proporción (`engine.ts:679-681`). Corrido: `$700 + $350` sin exceder tope →
  `deducible 1,050 · noDed 0`, suma exacta del comprobado.
  `deducibilidad.ts:41-42` sigue devolviendo `null` si las cubetas no suman.
- **El tope del 15% de RFA 2.9 es del EJERCICIO, no del mes.** `repo.ts:619-620`
  filtra `.gte('fecha', '${ejercicio}-01-01').lte('fecha','${ejercicio}-12-31')`;
  `tools.ts:104` usa `getUTCFullYear()`. El denominador es combustible contra
  combustible (`repo.ts:632`), que es lo que la ficha exige, y `combustible.ts:78-80`
  falla a `sin_criterio` en vez de dividir entre cero.
- **`combustible_efectivo` NO acredita IEPS.** Está en `SIN_ACREDITAMIENTO`
  (`engine.ts:647`) y fuera de `NO_DEDUCIBLE_ISR` (`engine.ts:84-85`): la facilidad
  salva la deducción y no el acreditamiento, exactamente como dice
  `rfa-2026-2.9.yaml → limite_importante`.
- **El tope de efectivo es `>` estricto** (`engine.ts:223`), que es «exceda de
  $2,000.00» y no «$2,000 o más».
- **La gasolina no cobra estímulo de IEPS.** `config.ts:96`: `clavesDieselIeps:
  ['15101505']`, y `etiquetaConcepto` (`engine.ts:819-826`) imprime «Combustible
  Plus» en vez de «Diésel» sobre un ticket de premium.
- **El descargo del CFF 89/90 va escrito en el papel** (`pdf.ts:400`,
  `leyendas.ts:50-58`), que es la conducta que exime según el último párrafo del 89.
- 617 pruebas verdes en `cuadre/`, `liquidacion/`, `normas/`, `facturacion/`,
  `periodo/` e `intake/` (51 archivos), corridas por mí.

## Lo que NO alcancé a revisar

- **`laboral/pagadero.ts` contra `lft-110-111-263.yaml`** — sigue sin re-auditar
  desde la ronda 5.
- **`cuadre/desde_db.ts` y `cuadre/guardia.ts`** — si el snapshot de
  `guardar_liquidacion` (AG-3, `2f79174`) preserva las cifras fiscales que aquí
  audité, no lo comprobé de punta a punta.
- **`intake/voucher` y el contrato de la nota no fiscal (`ce867a1`)** — leí la regla
  en `engine.ts:251-253` pero no corrí el arnés de las 14 fotos. Anoto sin puntuar:
  `comprobante_no_fiscal` no está ni en `NO_DEDUCIBLE_ISR` ni en `POR_CONFIRMAR`
  (`engine.ts:84-85`), así que el gasto solo cae en «por confirmar» por no tener
  UUID; si una foto trae el voucher encima de un ticket timbrado —el residuo que el
  propio commit declara— el gasto tendría UUID y la cubeta sería `deducible` pese a
  la leyenda impresa. No lo reproduje con valores, por eso no es hallazgo.
- **`facturacion/identificar.ts` y las 37 entradas del catálogo** — solo verifiqué
  el conteo de `plazoVerificado`.
- **`criterio-1-CFF-PI.yaml`** — no localicé su consumidor en código.
- Fichas sin texto transcrito, que por regla **no se asumen ni bien ni mal**:
  `cff-29-A`, `criterio-1-CFF-PI`, `criterio-1-LIF-PI`, `rmf-2026-2.7.1.21`,
  `politica-portales-plazos`, y `lisr-27-III` / `rmf-2026-2.7.1.48` como
  `evidencia_corroborante`.
- El RFC de la flota (seed `TIN010101AAA`, que falla el dígito verificador y manda
  toda factura a revisión) **no lo reporto**: el MAPA lo declara abierto y
  dependiente del cliente. Solo dejo el dato medido, porque toca lo que imprime el
  papel el 6-ago: con ese RFC, el mismo viaje del seed sale `deducible $0 · IVA $0 ·
  0 L · por confirmar $5,600`, y el PDF no imprime la sección ACREDITABLE.
