# Cumplimiento fiscal — auditoría 17

**Nota: 4/10** (antes 6, ronda 13; la 16 se autocalificó 7). Razón del
movimiento: **deuda que cobró factura, y la mirada más profunda encontró dos
sitios donde el producto imprime una cifra fiscal equivocada.** El hallazgo más
reincidente del rubro —la válvula del 15% de la RFA 2.9— *sí* se cerró como
compuerta (ya no se ofrece a cualquier tenant: `desde_db.ts:56-58` exige la
declaración y el motor tiene tres estados honestos), pero la ronda 16 la conectó
al **código de régimen equivocado**: `601` no es el Título II Capítulo VII que la
regla nombra, y el `624` que sí lo es no existe ni en el selector ni en el
CHECK de la base. La válvula ya no está abierta de par en par: ahora abre para
quien no califica y cierra para quien sí. Y el contador del 15% mide contra un
denominador —"lo que Likida vio"— que no es el que la regla nombra, y con él
imprime "No deducible" en el PDF.

Lo que sostiene la nota por encima de 3: la trazabilidad es real y funcionó —
las dos fichas que refutan los dos CRÍTICOS ya traen el texto literal que los
desmiente (`rfa-2026-2.9.yaml`, `verificado_fuente_primaria`); el estímulo de
IEPS, que es el dinero grande, se sigue negando a imprimirse en pesos y entrega
litros; el PDF lleva el tono `condicionado` donde toca; y RLISR 57 quedó cerrado
de verdad (ya hay escritor de `operador.rfc`).

**El riesgo mayor del rubro, hoy:** la elegibilidad de una facilidad se deriva
de un catálogo del SAT mal mapeado, y el resultado —deducible o no deducible—
se imprime en el PDF citando la regla. Es el mismo error de jerarquía que
`normas/README.md` llama "el más caro del dominio", cometido esta vez por el
código que existía para evitarlo.

---

## Hallazgos

### [CRÍTICO] El régimen `601` abre la facilidad del 15% de la RFA 2.9 — y `624` (Coordinados), el único régimen de PM que la regla nombra, no existe en el producto

`src/lib/likida/administracion.ts:115-116` · `src/app/admin/flotas/page.tsx:220,232-233` ·
`supabase/migrations/0056_datos_fiscales_y_cfdi.sql:45-53` ·
ficha `normas/rfa-2026-2.9.yaml` (`estado_verificacion: verificado_fuente_primaria`,
fuente DOF/SIDOF 5780249)

**Norma (literal, `rfa-2026-2.9.yaml` → `texto_vigente`):**
> "Los contribuyentes personas físicas o morales, dedicados exclusivamente al
> autotransporte terrestre de carga federal, **que tributen conforme al Título
> II, Capítulo VII o Título IV, Capítulo II, Sección I de la Ley del ISR**,
> considerarán cumplida la obligación establecida en el artículo 27, fracción
> III, segundo párrafo de la Ley del ISR, cuando los pagos por consumo de
> combustible se realicen con medios distintos a cheque nominativo…"

Y su `condiciones_de_aplicacion`, literal:
> "Tributar en Título II Cap. VII (**coordinados**) o Título IV Cap. II Secc. I
> (PF act. empresarial)"

**Código (literal, `administracion.ts:111-116`):**
```
  // elegibilidad se DERIVA de él: los códigos 601 (General de Ley PM —
  // coordinados) y 612 (PF con actividades empresariales) son los dos títulos
  // que la regla admite.
  const REGIMENES_ELEGIBLES = ['601', '612'];
  const regimenElegible = f.regimenFiscal ? REGIMENES_ELEGIBLES.includes(f.regimenFiscal) : undefined;
```
Y el selector, literal (`admin/flotas/page.tsx:220,232-233`):
```
  <option value="601">601 — General de Ley PM (coordinados)</option>
  … la facilidad del 15% (RFA 2.9) exige 601 o 612; cualquier otro
  no califica y el efectivo en combustible no se deduce.
```

En el catálogo `c_RegimenFiscal` del SAT, **601 es "General de Ley Personas
Morales" (Título II, régimen general) y "Coordinados" es la clave 624**. El
comentario del código y la etiqueta del selector equiparan las dos. `624` no
aparece en ningún archivo del repo (`grep -rn "624"` → cero coincidencias fuera
de un número de teléfono en un test), y tampoco está en el CHECK
`tenant_regimen_fiscal_dominio` (`0056:47-53` admite solo `601, 603, 612, 621,
626`).

**Escenario A — se afirma una deducción que no existe.** Flota "X, S.A. de
C.V.", persona moral del régimen general, alta con `regimenFiscal: '601'` y la
casilla de dedicación exclusiva marcada → `facilidadCombustibleEfectivo:
{dedicacionExclusivaCarga: true, regimenElegible: true}` → `desde_db.ts:56-58`
entrega `facilidad15 = true`. Un ticket de diésel de **$2,320 pagado en
efectivo** con CFDI, ejercicio 2026 con $200,000 de combustible: `engine.ts:337`
calcula `tope = 0.15 × 200,000 = $30,000`, cae dentro, y el PDF imprime
**"Deducible para ISR $2,320.00"** en verde más la nota "deducible por la
facilidad del 15% (RFA 2026 regla 2.9)". La regla no le aplica: por LISR 27-III
2º párrafo (sin excepción para el régimen general) esos **$2,320 no son
deducibles**. Salen $2,320 donde la norma da $0.

**Escenario B — se le quita la deducción a quien sí la tiene.** Un coordinado de
verdad (c_RegimenFiscal 624) no se puede registrar: el valor no está en el
selector ni lo acepta el CHECK de la base. Las únicas salidas son "Sin declarar"
—y entonces todo su diésel en efectivo cae para siempre en `combustible_efectivo`
(revisión, `engine.ts:365-369`)— o marcarlo 601, que lo mete al escenario A.
Además, 8 de las 10 opciones del selector (`605, 606, 607, 608, 610, 611, 615,
616`) violan el CHECK: el alta revienta con un error de constraint crudo. Y la
etiqueta "615 — Incorporación Fiscal" es falsa (615 es "ingresos por obtención
de premios"; Incorporación Fiscal es 621), sobre una columna que
`facturacion/flota_fiscal.ts:84` y `saas/facturapi.ts:183` usan como
`tax_system` del receptor del CFDI.

**Consecuencia:** el contralor archiva un PDF que declara deducible en verde un
gasto que su contador va a rechazar en la primera revisión, con la regla citada
al lado. Del otro lado, un coordinado —el cliente arquetípico de esta facilidad—
no puede ser dado de alta correctamente.

**Causa raíz probable:** la ronda 16 sustituyó un booleano declarado por una
derivación desde el catálogo del SAT sin cotejar `c_RegimenFiscal` contra el
texto de la ficha; el comentario que escribió la equivalencia ("601 … —
coordinados") se convirtió en la única fuente de verdad.

---

### [CRÍTICO] El 15% se mide contra "el combustible que Likida vio", no contra "el total de los pagos efectuados por consumo de combustible" — y con ese denominador el PDF imprime "No deducible"

`src/lib/likida/cuadre/engine.ts:337,354` · `src/lib/likida/cuadre/desde_db.ts:78,91` ·
`src/lib/likida/repo.ts:820-834` · ficha `normas/rfa-2026-2.9.yaml`
(`verificado_fuente_primaria`)

**Norma (literal):**
> "…siempre que estos no excedan el 15 por ciento **del total de los pagos
> efectuados por consumo de combustible para realizar su actividad**."

**Código (literal, `repo.ts:826-834` — el único productor del denominador):**
```
      .from('gasto')
      .select('monto, forma_pago', …)
      .eq('tenant_id', tenantId)
      .or(claves?.length ? `concepto.eq.diesel,clave_prod_serv.in.(${claves.join(',')})` : 'concepto.eq.diesel')
      .gte('fecha', `${ejercicio}-01-01`)
```
y `engine.ts:337,354`:
```
        const tope = 0.15 * total;
        … `el ejercicio lleva ${mxn(acumulado)} de combustible en efectivo contra un tope de ${mxn(tope)} (15% de ${mxn(total)}); el excedente de ${mxn(excedenteDeEste)} de ESTE comprobante NO se deduce (RFA 2026 regla 2.9).`
```

`gasto` contiene **únicamente lo que los operadores mandaron por WhatsApp**. El
propio producto lo dice en el pie del panel del contador
(`contador/comun.tsx:177-179`: "No es la contabilidad completa de la flota").
Pero ni el motor ni el PDF lo dicen, y el motor lo usa como si fuera el
universo: la frase impresa dice "15% de $X" a secas.

**Escenario:** flota elegible (612 + dedicación exclusiva), ejercicio 2026. Carga
la mayor parte de su diésel en su terminal con factura directa a la cuenta de la
empresa: **$1,200,000 en el año, que nunca pasan por el teléfono**. Por WhatsApp
llegan solo las cargas de carretera: **$80,000, de los cuales $30,000 en
efectivo**.
- Motor: `total = 80,000` → `tope = 0.15 × 80,000 = $12,000`; acumulado
  $30,000 → `excedenteDeEste` se reparte y **$18,000 se van a `totalNoDeducible`**
  (vía `proporcionDeducible`, `engine.ts:343` → `engine.ts:1134-1137`). El PDF
  imprime "**No deducible $18,000.00**" en rojo y la nota "…contra un tope de
  $12,000.00 (15% de $80,000.00) … NO se deduce (RFA 2026 regla 2.9)".
- Norma: el total de pagos por consumo de combustible del ejercicio es
  **$1,280,000**; el 15% son **$192,000**; los $30,000 en efectivo son el
  **2.3%**. Todo es deducible. Lo correcto es **$0 no deducible**.

Sale $18,000 en rojo donde la norma da $0, con la regla citada.

**Consecuencia:** el contralor ve una pérdida de deducción que no existe y la
cifra tiene el formato de una medición. Peor: el rótulo "15% de $80,000" es
falso como afirmación sobre el ejercicio de la flota — es el rótulo que la regla
de producto "un rótulo tiene que ser verdad" prohíbe. Y el error es del lado que
el contador *sí* revisa (le quitan dinero), así que se descubre en la sala.

**Causa raíz probable:** el contador del 15% se construyó sobre la única tabla
que el producto tiene (`gasto`) sin declarar que su universo es parcial; ninguna
ficha ni ningún renglón del PDF acota la afirmación al alcance real del dato.

---

### [ALTO · REINCIDENTE, otra superficie] El panel del contador declara "Ya no se recupera $X" por un plazo de **nivel 6** y lo funda en **LISR 27-III** — el mismo hecho que el PDF ya corrigió

`src/lib/likida/fiscal.ts:243-248` (`TITULOS.plazo_vencido`) · `fiscal.ts:326`
(`if (g.plazoVencido === true) push('plazo_vencido')`) ·
`src/app/dashboard/contador/deducciones/page.tsx:52,126-127` ·
`fiscal.ts:945-946` (columna `fundamento` del CSV) ·
ficha `normas/politica-portales-plazos.yaml` (`jerarquia: 6`,
`estado_verificacion: sin_verificar`)

**Norma / ficha (literal, `advertencia_de_jerarquia`):**
> "**ESTO NO ES UNA NORMA FISCAL.** Es la política interna de un tercero y tiene
> CERO fuerza legal. El plazo LEGAL para pedir factura es todo el ejercicio (el
> SAT lo dice expresamente), y negarla porque 'ya pasó el mes' es una práctica
> indebida listada por el propio SAT, con remedio en la Conciliación de Factura.
> **El producto NUNCA debe presentar estos plazos como una obligación fiscal.**"

**Código (literal, `fiscal.ts:243-248`):**
```
  plazo_vencido: {
    gravedad: 'perdida',
    titulo: 'Plazo de facturación vencido',
    norma: 'LISR 27-III',
    detalle: 'El comercio ya no acepta timbrarlo. Sin CFDI no ampara deducción y el IVA no se acredita.',
  },
```

`gravedad: 'perdida'` se pinta en `deducciones/page.tsx:126-127` como
**"Ya no se recupera"** en `var(--bad)`, y el monto entra a `montoPerdido`
(`fiscal.ts:418`). El fundamento que se imprime junto al renglón y en la columna
`fundamento` del export a Excel es **"LISR 27-III"** — un artículo de nivel 1 que
habla de medio de pago y de comprobante fiscal, y que **no dice una palabra sobre
plazos de facturación**.

**Escenario:** ticket de diésel de **$4,800** del **3-jul-2026**, sin CFDI,
comercio reconocido (Petromax, `plazo: 'mes_natural'`, `plazoVerificado: false`).
Hoy 8-ago-2026 → `calcularCaducidad` da vencido el 31-jul → `plazoVencido: true`.
- Panel: **"Ya no se recupera $4,800.00"**, causa "Plazo de facturación
  vencido", fundamento "LISR 27-III".
- El PDF del **mismo ticket**, corregido en la ronda 10 (`engine.ts:749`), dice
  literalmente: *"se pasó el plazo de facturación. El comercio ya no suele
  facturarlo en su portal, **pero legalmente puedes exigirlo dentro del ejercicio
  (Conciliación de Factura del SAT)**"*.

Dos superficies del mismo producto, dos verdades opuestas sobre el mismo peso, y
la que dice que está perdido es la que encabeza "la pantalla que justifica el
producto" (`deducciones/page.tsx:22-24`).

**Consecuencia:** el contador da por perdidos $4,800 (y su IVA) que recupera con
una llamada o con Conciliación de Factura, y la cifra viaja al Excel con un
artículo que no la sostiene. Si el contralor cruza el panel contra el PDF ve al
producto contradecirse.

**Causa raíz probable:** el arreglo de la jerarquía se aplicó al motor y nunca se
propagó a `fiscal.ts`, que es el módulo gemelo escrito después.

---

### [ALTO] El estímulo de peaje se imprime en pesos, en el panel del cliente, sin ninguna de las cuatro condiciones — el matiz que sí lleva el PDF

`src/app/dashboard/page.tsx:391-392` · `src/app/dashboard/facturacion/page.tsx:98` ·
contraste: `src/lib/likida/liquidacion/acreditable.ts:110-119` ·
ficha `normas/lif-2026-20-A.yaml` (`verificado_fuente_primaria`)

**Norma (literal, `estimulo_peaje.texto_vigente`):**
> "Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
> **exclusivamente** al transporte terrestre público y privado, de carga o
> pasaje, así como el turístico, que utilizan la **Red Nacional de Autopistas de
> Cuota**, que obtengan en el ejercicio fiscal… **ingresos totales anuales… menores
> a 300 millones de pesos**… El estímulo **no podrá ser aplicable por las personas
> morales que se consideran partes relacionadas** de acuerdo con el artículo 179…"

Y sus hallazgos H5/H6, literales en la ficha:
> H5 · que hace el motor: "**Aplica el 50% a TODO gasto con concepto 'caseta'.**"
> H6 · que hace el motor: "**No conoce los ingresos de la flota ni su relación de
> partes.** El estímulo se aplica sin verificar si el cliente califica."

**Código (literal, `dashboard/page.tsx:391-392`):**
```
                    etiqueta="Peaje (50%)" valor={acred.peaje} formato="mxn"
                    nota="Estímulo de autopistas · LIF 2026, Art. 20-A" />
```
y `facturacion/page.tsx:98`:
```
                etiqueta="Peaje acreditable (50%)" valor={acred.peaje} formato="mxn" nota="LIF 2026, Art. 20-A" />
```
El motor lo calcula con `engine.ts:1028`: `if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;` — sin
mirar RNAC, ingresos ni partes relacionadas.

El PDF **sí** lo resuelve: `acreditable.ts:115-118` etiqueta el renglón
"…**— sujeto a elegibilidad**", lo pinta en tono `condicionado` (tinta neutra, no
verde) y le cuelga los dos pies `BASE_ESTIMULO_PEAJE` y
`CONDICIONES_ESTIMULO_PEAJE`, que enumeran las cuatro. El comentario de
`pdf.ts:330-333` explica exactamente por qué: *"Una flota con ingresos ≥ $300M, o
parte relacionada, se llevaba impreso un estímulo al que no tiene derecho."* El
arreglo no llegó ni a `/dashboard` (la pantalla de aterrizaje del contralor) ni a
`/dashboard/facturacion`. La página de detalle sí lo lleva
(`dashboard/[id]/page.tsx:266`, `nota="Sujeto a elegibilidad"`), lo que confirma
que fue una omisión y no una decisión.

**Escenario:** flota con $420M de ingresos anuales. En la ventana de 7 días hay
CFDI de caseta por $50,000 de subtotal → `peajeAcreditable = $25,000`. El panel
imprime **"Peaje (50%) $25,000.00 · Estímulo de autopistas · LIF 2026, Art.
20-A"**. El estímulo real de esa flota es **$0** (supera los $300M). El PDF de
las mismas liquidaciones lleva "sujeto a elegibilidad" y las cuatro condiciones;
el panel no.

**Consecuencia:** una cifra en pesos con un artículo citado al lado es una
afirmación. `normas/criterio-1-CFF-PI.yaml` recuerda que la fracción de cierre
alcanza a "quien asesore, aconseje, **PRESTE SERVICIOS** o participe" — es
exposición de Likida, no del cliente.

**Causa raíz probable:** `analytics.acreditables()` devuelve `peaje` como número
crudo y cada pantalla decide su copy; el renglón condicionado vive en
`acreditable.ts`, que solo consume el PDF.

---

### [ALTO] El combustible en efectivo dentro del 15% no acredita **IVA** — y ninguna ficha respalda esa negativa (la que existe excluye el IEPS, no el IVA)

`src/lib/likida/cuadre/engine.ts:985,1003` · `src/lib/likida/fiscal.ts:512-515` ·
fichas `normas/liva-5.yaml` y `normas/rfa-2026-2.9.yaml`
(ambas `verificado_fuente_primaria`)

**Norma (literal, `liva-5.yaml` → art. 5 fr. I):**
> "…se consideran estrictamente indispensables **las erogaciones efectuadas por el
> contribuyente que sean deducibles para los fines del impuesto sobre la renta**,
> aun cuando no se esté obligado al pago de este último impuesto."

**Norma (literal, `rfa-2026-2.9.yaml` → `limite_importante`):**
> "Conserva la **DEDUCCIÓN para ISR**. NO habilita el acreditamiento **del IEPS**:
> son dos beneficios distintos y el efectivo solo salva uno."

**Código (literal, `engine.ts:985,1003`):**
```
  const SIN_ACREDITAMIENTO: TipoDiferencia[] = ['rfc_receptor', …, 'combustible_efectivo', 'combustible_efectivo_dentro15', 'efectivo_sobre_15', 'efectivo_no_elegible', …];
  …
    if (diferencias.some((d) => d.gastoId === g.id && SIN_ACREDITAMIENTO.includes(d.tipo))) continue;
```
El `continue` salta el gasto **entero**, incluida la línea de IVA
(`engine.ts:1026`). `fiscal.ts:515` hace lo mismo en el panel y lo justifica así:
`// … el combustible en EFECTIVO no acredita IVA — la facilidad del 15% (RFA 2.9) solo salva la deducción de ISR`.

La ficha dice **IEPS**. El código extiende la exclusión al **IVA**, un impuesto
distinto, sin ficha que lo sostenga. Y el art. 5 de la LIVA no condiciona el
acreditamiento al medio de pago: la fr. I lo ata a que la erogación sea
*deducible para ISR* —y por la RFA 2.9 lo es— y la fr. III solo pide que el IVA
esté trasladado expresamente y por separado.

**Escenario:** CFDI de diésel de **$5,800** (subtotal $5,000, IVA trasladado
$800), pagado en efectivo, XML verificado, flota elegible, dentro del 15%. El
motor emite `combustible_efectivo_dentro15`, el gasto entra a `totalDeducible`
por $5,800 (bien), y `ivaAcreditable` recibe **$0**. Por LIVA 5-I + RFA 2.9 son
**$800** acreditables. El PDF no imprime el renglón "IVA acreditable (LIVA art.
5)" para ese comprobante, y el panel lo cuenta en `ivaNoAcreditable`
(`fiscal.ts:536`).

**Consecuencia:** al cliente le faltan $800 de IVA acreditable por CFDI en el
papel que le entregamos. El error va a la baja (menos riesgo ante el SAT, más
dinero perdido para el cliente), pero es igual de equivocado y contradice la
regla del producto de no afirmar sin ficha: aquí se **niega** un acreditamiento
citando una restricción que la ficha no contiene.

**Causa raíz probable:** la lista `SIN_ACREDITAMIENTO` es una sola dimensión
("no acredita nada") para dos impuestos con requisitos distintos; el comentario
que la encabeza (`engine.ts:979-984`) advierte precisamente de esa confusión
pero solo en la dirección ISR↔IEPS.

---

### [MEDIO · REINCIDENTE] "El SAT no reconoce este CFDI" no llega al panel del contador: `causasDe` solo conoce `cancelado`

`src/lib/likida/fiscal.ts:314-344` (`causasDe`), `fiscal.ts:207-223`
(`CausaPerdida` no tiene `cfdi_no_encontrado` ni `cfdi_pendiente`) ·
contraste: `src/lib/likida/cuadre/engine.ts:100-101`
(`NO_DEDUCIBLE_ISR` incluye `'cfdi_no_encontrado'`; `POR_CONFIRMAR` incluye
`'cfdi_pendiente'`) · `src/lib/likida/intake/sat.ts:18`
(`EstadoSat = 'vigente' | 'cancelado' | 'no_encontrado' | 'pendiente'`)

**Código (literal, `fiscal.ts:321-328`):**
```
  if (g.estadoSat === 'cancelado') push('cfdi_cancelado');

  if (!g.cfdiUuid) {
    if (g.plazoVencido === true) push('plazo_vencido');
    else push('sin_cfdi');
  }
```
No hay rama para `'no_encontrado'` ni para `'pendiente'`.

**Escenario:** un gasto de **$11,600** con UUID que el SAT devuelve como *no
encontrado* (UUID inexistente o fabricado), forma de pago transferencia.
- Motor / PDF: `cfdi_no_encontrado` → `cubetaDe` → **`no_deducible`** →
  "No deducible $11,600.00" en rojo, nota "El SAT NO reconoce el CFDI… — no
  deducible" (`engine.ts:502`).
- `/dashboard/contador/deducciones`: `causasDe` devuelve `[]` → la fila no entra
  a `resumirPerdidas` → si es el único comprobante marcado, la pantalla imprime
  *"Ningún comprobante del periodo tiene una observación fiscal"*
  (`deducciones/page.tsx:120-122`) y **$0.00** en las tres cubetas.

Lo mismo con `estadoSat === 'pendiente'`: el motor lo manda a `por_confirmar` y
lo saca del acreditamiento; el panel no lo cuenta en ninguna cubeta. El arreglo
de la ronda anterior llegó solo a `ivaSostenible` (`fiscal.ts:509` sí excluye
`pendiente` y `no_encontrado` del IVA) y no a `causasDe`, que es lo que mueve el
dinero de la pantalla.

**Consecuencia:** el contador cierra el mes con la pantalla que dice que no hay
nada perdido, y el PDF de ese mismo viaje declara $11,600 no deducibles.

**Causa raíz probable:** dos catálogos de veredictos (`TipoDiferencia` del motor
y `CausaPerdida` del panel) sin nada que obligue a que el segundo cubra al
primero.

---

### [MEDIO · REINCIDENTE (2ª ronda)] `efectivo_no_elegible` sigue fuera de `ORDEN`: la sección "por causa" queda vacía con dinero en "perdido", y un diésel sin CFDI de flota no elegible se cuenta como "se recupera"

`src/lib/likida/fiscal.ts:354-357` · `fiscal.ts:429-440` (`porCausa` se filtra por
`ORDEN`) · `src/app/dashboard/contador/deducciones/page.tsx` (la sección "por
causa" no se renderiza con `porCausa` vacío)

**Código (literal, `fiscal.ts:354-357`):**
```
const ORDEN: CausaPerdida[] = [
  'efos', 'cfdi_cancelado', 'plazo_vencido', 'efectivo_sobre_tope',
  'efos_indeterminado', 'combustible_efectivo', 'sin_cfdi',
];
```
`'efectivo_no_elegible'` está en `CausaPerdida` (`fiscal.ts:221`), en `TITULOS`
(`fiscal.ts:279-284`) y en `causasDe` (`fiscal.ts:338`) — pero no aquí.

**Escenario:** flota con `elegible15 = false`. Diésel en efectivo de **$1,000**
**sin** CFDI → `causasDe` devuelve `[sin_cfdi, efectivo_no_elegible]`;
`causaDominante` recorre `ORDEN`, encuentra `sin_cfdi` y devuelve esa →
**`montoRecuperable = $1,000`**, "Se recupera pidiendo la factura". Falso: aun
timbrándolo, el efectivo en combustible de una flota que no califica no deduce
(LISR 27-III sin excepción, que es justo lo que el propio `TITULOS`
`efectivo_no_elegible` dice). Con CFDI, la dominante sí es `efectivo_no_elegible`
→ $1,000 en "Ya no se recupera" pero **`porCausa = []`**: la suma por causa no
cuadra con el total, que es lo que la propia pantalla se prohíbe
(`deducciones/page.tsx:36-41`).

**Consecuencia:** la gravedad del dinero queda invertida y el desglose que
explica dónde se perdió desaparece.

**Causa raíz probable:** el tipo se añadió a tres de las cuatro listas que lo
necesitan.

---

### [MEDIO · REINCIDENTE (2ª ronda)] La píldora y el gauge del 15% siguen diciendo "Holgado / Excedido" a flotas a las que la facilidad no aplica

`src/app/dashboard/contador/combustible/page.tsx:75,134,148` ·
`src/lib/likida/fiscal.ts:611-619` (`tope15DeGastos` no recibe ni lee
`o.elegible15`) · contraste: `combustible/page.tsx:154-171`, donde el **texto**
sí interroga la declaración.

**Código (literal, `page.tsx:134`):**
```
                accion={<StatusPill estado={ESTADO_TOPE[tope.estado].estado}>{ESTADO_TOPE[tope.estado].texto}</StatusPill>}
```

**Escenario:** flota con `elegible15 = false` y $500 de diésel en efectivo sobre
$10,000 de combustible del periodo → `evaluarTope15` da `estado: 'holgado'` → la
píldora se pinta **verde "Holgado"** y el gauge al 5%, justo encima del texto que
dice "La flota declaró que NO califica… el combustible en efectivo no es
deducible". La píldora es lo que se lee primero.

**Consecuencia:** la lectura rápida de la pantalla afirma que la flota va dentro
de una válvula que no tiene.

**Causa raíz probable:** el fix de la ronda 15 curó el copy y no la función que
alimenta el indicador.

---

### [MEDIO · REINCIDENTE (2ª ronda)] Un gasto de combustible **sin fecha** corre contra el contador del 15% cuyo denominador lo excluye

`src/lib/likida/cuadre/engine.ts:312-313` · `src/lib/likida/cuadre/desde_db.ts:86-90` ·
`src/lib/likida/repo.ts:832-833` (`.gte('fecha', …)` / `.lte('fecha', …)`)

**Código (literal, `engine.ts:312-313`):**
```
        const anioComprobante = g.fecha ? g.fecha.slice(0, 4) : null;
        const mismoEjercicio = !anioComprobante || anioComprobante === input.anioEjercicio;
```
y `desde_db.ts:87`:
```
    .filter((g) => (g.fecha?.slice(0, 4) ?? anioEjercicio) === anioEjercicio
```
Un gasto sin fecha se declara "del mismo ejercicio" por construcción en los dos
sitios, pero la consulta que mide la base filtra por `fecha` y nunca lo incluyó.

**Escenario (ejercicio 2026):** la consulta trae `efectivo = 14,300` (incluye
$500 fechados de este viaje) y `totalCombustible = 99,000`. Este viaje trae
además un diésel en efectivo de **$1,000 SIN fecha** (el OCR no la leyó).
`efectivoDeEsteViaje = 500 + 1,000 = 1,500` → `prev = 14,300 − 1,500 = 12,800`
(se resta un monto que la consulta nunca sumó). El motor acumula `12,800 + 1,500
= 14,300` contra `tope = 14,850` → declara **cero exceso**. El efectivo real del
ejercicio es `13,800 + 1,500 = 15,300` contra un tope real de `15,000` (el
sin-fecha también es base): el exceso verdadero es **$300** y el motor imprimió
**$0**.

**Consecuencia:** la flota cruza el 15% sin corte y el PDF afirma deducible lo
que no lo es. La dirección del error se invierte según de dónde venga el
sin-fecha, así que tampoco es conservador.

**Causa raíz probable:** el fail-closed de la ronda 15 cubrió "gasto de otro
ejercicio" y dejó "gasto sin ejercicio atribuible" tratado como del año en curso.

---

### [MEDIO · REINCIDENTE (3ª ronda)] El chat cuenta el 15% con `concepto='diesel'` a secas; el `SUM` en SQL de la migración 0084 nunca se llama

`src/lib/likida/tools.ts:109` (`await getAcumuladoCombustible(ctx.tenantId, ejercicio)`
— sin el tercer argumento) · `src/lib/likida/repo.ts:831` (sin `claves` cae a
`concepto.eq.diesel`) · contraste `desde_db.ts:78` (mismo llamado **con**
`clavesCombustible`) · `supabase/migrations/0084_sumar_combustible_ejercicio.sql`
(`grep -rn "sumar_combustible_ejercicio" src/` solo devuelve
`migraciones_verificadas.test.ts:56`, que además afirma "si falta,
getAcumuladoCombustible lanza ruidoso… (el RPC no existe)" — el RPC no se invoca
desde ningún camino de producción).

**Escenario:** un CFDI de diésel llega después de la foto y
`repo.updateGastoCfdiXml` (`repo.ts:421-433`) escribe `clave_prod_serv =
'15101505'` pero **no reescribe `concepto`** — el gasto sigue con el concepto que
puso el OCR (`otro`/`factura`). El motor y `desde_db` lo cuentan en el 15% (por
clave); el aviso del chat no. El mismo día, WhatsApp puede decir "vas en 8% del
15%" mientras la liquidación imprime "el excedente NO se deduce".

**Consecuencia:** dos cifras del mismo hecho fiscal en dos canales, y la del chat
es la que el jefe de flota lee para decidir con qué pagar.

---

### [MEDIO] El panel del contador afirma como resuelto lo que la ficha marca `SIN RESOLVER`: "el estímulo es el 50% del gasto en peaje **sin IVA**"

`src/app/dashboard/contador/combustible/page.tsx:227-230` · ficha
`normas/lif-2026-20-A.yaml`, hallazgo **H4**, `severidad: alta`,
`estado: SIN RESOLVER`

**Norma (literal):** "…consistente en permitir un acreditamiento de los gastos
realizados en el pago de los servicios por el uso de la infraestructura
mencionada hasta en un 50 por ciento **del gasto total erogado** por este
concepto."

**Código (literal, `combustible/page.tsx:227-230`):**
```
                    El estímulo es el 50% del gasto en peaje sin IVA (LIF 2026 20-A, para ingresos bajo $300M). La
                    base es el SubTotal, no el total: aplicar el 50% al total incluiría el IVA, que ya se acredita
                    por su lado.
```
El PDF, para la misma cifra, dice lo contrario de "resuelto"
(`acreditable.ts:47-49`, `BASE_ESTIMULO_PEAJE`): *"La ley dice '50% del gasto
total erogado'; si su contador toma el total con IVA, la cifra sube alrededor de
13.8%."*

**Escenario:** $50,000 de subtotal de casetas. El panel enseña la base como
$50,000 y afirma que esa es la del estímulo → $25,000. Con la base literal de la
ley ($58,000 erogados) serían $29,000: **$4,000 de diferencia** presentados como
si no hubiera discusión, sobre un punto que la ficha declara sin resolver y
"pregunta para un contador".

**Consecuencia:** el contador lee una regla en el panel y la contraria en el PDF.

---

### [MEDIO] Las seis pantallas del panel del contador emiten veredictos fiscales con norma citada sin la leyenda del CFF 89 — la eximente que `leyendas.ts` existe para producir

`src/app/dashboard/contador/comun.tsx:174-183` (`PieDeAlcance`, el único pie de
esas pantallas) · `src/lib/likida/fiscal.ts:945-946` (columna `fundamento` del
export a Excel) · `src/lib/likida/cuadre/leyendas.ts:36-39` (`LEYENDA_CORTA`,
usada solo en `dashboard/page.tsx:425`, `dashboard/cuadre/page.tsx:246` y
`dashboard/[id]/page.tsx:372`) · ficha `normas/cff-89-90.yaml`
(`verificado_fuente_primaria`)

**Norma (literal, art. 89 último párrafo):**
> "No se incurrirá en la infracción a que se refiere la fracción primera de este
> artículo, cuando se manifieste… **o bien manifiesten también por escrito al
> contribuyente que su asesoría puede ser contraria a la interpretación de las
> autoridades fiscales.**"

**Código (literal, `comun.tsx:177-180`):**
```
      Todo lo de esta pantalla sale de los comprobantes que los operadores mandaron por WhatsApp y que el
      agente leyó. No es la contabilidad completa de la flota: los gastos que no pasan por el teléfono
      (nómina, seguros, arrendamiento, refacciones de taller) no están aquí y hay que sumarlos aparte.
```
Dice de dónde sale el dato; **no** dice que el criterio puede diferir del del
SAT. `grep -rln "LEYENDA\|dictamen\|criterios que dé a conocer"
src/app/dashboard/contador/` → cero archivos.

**Escenario:** el contador abre "Deducciones perdidas", ve "$X ya no se
recupera · LISR 27-III", exporta el CSV con la columna `fundamento`, y lo usa
para su papel de trabajo. En ninguna de las dos superficies aparece la
manifestación por escrito que el propio art. 89 nombra como conducta que exime.

**Consecuencia:** es exposición de Likida (el propio encabezado de
`leyendas.ts:8-11` lo dice: "un motor que calcula mal un estímulo… comete una
práctica indebida propia"), y el agravante del art. 90 sube la multa del 10% al
20% de la contribución omitida cuando el criterio es diverso al del SAT.

---

### [BAJO · REINCIDENTE] `avisoTope15` afirma "hay pagos de combustible en efectivo" a toda flota sin declarar, incluso con cero efectivo

`src/lib/likida/periodo/aviso.ts:32-33`

**Código (literal):**
```
  if (elegible === undefined) {
    return `Diésel en efectivo ${ejercicio}: hay pagos de combustible en efectivo, pero la facilidad del 15% de la RFA 2026 regla 2.9 exige que la flota declare su dedicación y régimen al registrarla. …`;
  }
```
La rama devuelve el texto sin mirar `r`. El contrato de la función
(`aviso.ts:19-22`) dice "En `holgado` devuelve null a propósito".

**Escenario:** tenant sin declarar con **cero** diésel en efectivo en el
ejercicio (`efectivo = 0, total = 0` → `evaluarTope15` da `holgado`). `tools.ts:119`
mete el aviso en el turno del agente; si el modelo lo repite, el jefe de flota
recibe por WhatsApp la afirmación "hay pagos de combustible en efectivo" sobre un
hecho que nadie midió.

---

### [BAJO · REINCIDENTE] La rama fail-closed del 15% hace `continue` y se lleva por delante `monto_discrepante` y `comprobante_no_fiscal` del mismo comprobante

`src/lib/likida/cuadre/engine.ts:324` (`continue;`) · las notas saltadas viven en
`engine.ts:381,399,402`. Las otras cuatro ramas del 15% no continúan.

**Escenario:** el contador del ejercicio no responde (`total = 0`, bache de red)
y ese mismo ticket de diésel en efectivo trae `ocrExtra.montoDiscrepante` (el
total del código no coincide con el del OCR, p. ej. $4,200 vs $4,700). El gasto
sale a `por_confirmar` con la nota honesta de la facilidad —bien— pero **sin** la
advertencia de que el total está en duda, que en cualquier otra circunstancia sí
se emite. El contralor recibe la liquidación con un monto dudoso y sin aviso.

---

## Fichas: cuáles verifiqué y cuáles quedaron no verificables

Abrí y leí las 24 fichas de `normas/`; las 16 fiscales son las que este rubro
juzga. **Ninguna se pudo re-verificar contra la fuente en esta ronda**: los dos
latidos (`normas/.latido-vigilancia`, `normas/.latido-cuota-diesel`) declaran
egress bloqueado hacia `sidofqa.segob.gob.mx`, `www.sat.gob.mx` y
`diputados.gob.mx` — **octava corrida consecutiva** de vigilancia normativa y
segunda de cuota-diésel. El rango sin barrer del DOF va del **24-jul al 6-ago**.
La ventana anticipada del SAT (ETag del minisitio, chequeo de lunes) lleva **tres
lunes** bloqueada.

| Ficha | Estado | Última verificación | Uso en el veredicto de esta auditoría |
|---|---|---|---|
| `rfa-2026-2.9.yaml` | **verificado_fuente_primaria** | 2026-07-27 | Gana los dos CRÍTICOS (texto literal del régimen y del denominador) |
| `lif-2026-20-A.yaml` | **verificado_fuente_primaria** | 2026-07-27 | Gana el ALTO del peaje y el MEDIO de la base |
| `liva-5.yaml` | **verificado_fuente_primaria** | *sin fecha en la ficha* (nota: 28-jul) | Gana el ALTO del IVA sobre efectivo |
| `lisr-28-V.yaml` | **verificado_fuente_primaria** | 2026-07-27 | Verificado contra el motor: correcto |
| `rlisr-57.yaml` | **verificado_fuente_primaria** | 2026-07-27 | Verificado: cerrado |
| `cff-89-90.yaml` | **verificado_fuente_primaria** | 2026-07-28 | Gana el MEDIO de la leyenda ausente |
| `cff-69-B.yaml` | **verificado_fuente_primaria** | 2026-07-28 | Verificado contra `sat.ts`: correcto |
| `cff-30.yaml` | **verificado_fuente_primaria** | 2026-07-28 | No decide dinero |
| `rfa-2026-2.2.yaml` | **verificado_fuente_primaria** | 2026-07-27 | `usado_en_codigo: []` — el 8% no se implementa (correcto: excluye combustible) |
| `lisr-27-III.yaml` | evidencia_corroborante | 2026-07-27 | **No verificable en esta ronda.** Su `nota_verificacion` pide leer el PDF de diputados; el motor decide "no deducible" con ella (`efectivo_sobre_tope`, `efectivo_no_elegible`) |
| `cff-29-A.yaml` | evidencia_corroborante (`texto_vigente: null`) | 2026-07-27 | **No verificable.** El PDF cita CFF 29-A en `comprobante_no_fiscal` sobre una ficha sin texto transcrito |
| `criterio-1-LIF-PI.yaml` | evidencia_corroborante (`texto_vigente: null`) | 2026-07-27 | **No verificable.** Sostiene la decisión de no imprimir el IEPS en pesos (decisión correcta y conservadora) |
| `criterio-1-CFF-PI.yaml` | evidencia_corroborante (`texto_vigente: null`) | 2026-07-27 | **No verificable.** Sostiene las leyendas |
| `rmf-2026-2.7.1.48.yaml` | evidencia_corroborante | 2026-07-27 | **No verificable.** `exigibleDesde: null` — el motor avisa y no declara no deducible: correcto mientras siga null |
| `rmf-2026-2.7.1.21.yaml` | evidencia_corroborante (`texto_vigente: null`) | 2026-07-27 | **No verificable.** `usado_en_codigo` solo documentación |
| `politica-portales-plazos.yaml` | **sin_verificar** (nivel 6) | 2026-07-28 | Sostiene el ALTO de "Ya no se recupera": una ficha `sin_verificar` de nivel 6 está moviendo dinero en el panel |
| `cuota-ieps-diesel.yaml` | **NO EXISTE** | — | El motor no tiene cuota semanal para ninguna fecha. Correcto que no imprima pesos; incorrecto que lleve 12 días sin poder crearse |

Lectura: **ninguna ficha lleva más de 12 días sin re-verificar por descuido — lo
llevan porque el entorno no permite verificar.** Pero el efecto sobre la
trazabilidad es el mismo: cuatro fichas con `texto_vigente: null` sostienen citas
que el producto imprime (CFF 29-A en el PDF, 1/LIF/PI y 1/CFF/PI en las
leyendas), y una `sin_verificar` de nivel 6 decide una cifra en pesos.

---

## Lo que revisé y está bien

- **El estímulo de IEPS NO se imprime en pesos.** `engine.ts:998` (`const
  iepsAcreditable = 0;` y su comentario) + `acreditable.ts:94-100` entregan
  **litros** con el pie "el estímulo se calcula con la cuota SEMANAL vigente al
  momento de cada compra". Es exactamente lo que exige `criterio-1-LIF-PI` y lo
  que el brief señala como la trampa clásica. **La confusión "IEPS trasladado =
  estímulo" está cerrada en las cinco superficies** que la podrían cometer
  (`engine.ts:1078`, `acreditable.ts`, `pdf.ts:334-365`, `dashboard/page.tsx:385`,
  `contador/combustible/page.tsx:122-124`, esta última con la nota literal "El
  estímulo es cuota del DOF × litros — no esta cifra").
- **Los litros se cotejan contra precio × litros** antes de acreditarse
  (`engine.ts:1065-1076`): un decimal corrido (200 L leídos como 20,000 L) emite
  `diesel_desviacion` y no acredita. Tolerancia 0.5×–2× declarada.
- **LISR 28-V está bien implementado en las tres condiciones verificables.**
  $750/día **por beneficiario** y solo alimentación (`engine.ts:887-903`, ficha
  `confirmado_del_codigo`); el amparo de hospedaje/transporte
  (`engine.ts:805-835`); y **H1b**, la tercera oración del 2º párrafo —"sólo
  procederá cuando el pago se efectúe mediante tarjeta de crédito de la persona
  que realiza el viaje"— con `formaPago !== '04'` (`engine.ts:857`), donde débito
  ('28') correctamente **no** cuenta.
- **LIVA 5-I proporcional está implementado** (`engine.ts:1024-1026`): el IVA de
  una erogación parcialmente deducible se acredita en la proporción del día, y el
  bloque de acreditamiento corre **después** del tope de alimentación
  (`engine.ts:973-978`) para que la proporción exista.
- **RLISR 57 quedó cerrado.** `repo.ts:907-914` (`actualizarRfcOperador`) y
  `dashboard/operadores/page.tsx:182,190` son el escritor que faltaba;
  `desde_db.ts:43-46` lo lee y `engine.ts:487-497` distingue los tres estados
  (RFC del operador = válido; sin RFC = revisión sin quitar la deducción; tercero
  = no deducible). El hallazgo abierto del brief **ya no aplica**.
- **La válvula del 15% ya no se ofrece sin declaración.** `desde_db.ts:56-58`
  exige que **ambas** condiciones sean booleanos explícitos; `undefined` va a
  `combustible_efectivo` (revisión, `engine.ts:365-369`); el fail-closed de
  `engine.ts:315-325` (total ≤ 0 o comprobante de otro ejercicio) no afirma nada.
  La compuerta funciona: lo que falla es **con qué código se abre**.
- **Las leyendas dicen lo que la norma dice.** `leyendas.ts:36-39,50-58` contra
  `cff-89-90.yaml`: la frase "puede diferir de los criterios que dé a conocer el
  SAT" reproduce la conducta eximente del último párrafo del art. 89, y la cita
  del art. 52 del CFF ("no constituye un dictamen") es correcta.
- **El complemento de hidrocarburos no tira deducciones sobre una fecha sin
  respaldo.** `engine.ts:531-534,562-573` + `normas/indice.ts` (`exigibleDesde:
  null`): con la exigibilidad sin confirmar se emite
  `complemento_no_verificable` (revisión), nunca `complemento_hidrocarburos` (no
  deducible).
- **El permiso CRE nunca se declara cumplido ni incumplido** y se avisa una sola
  vez por liquidación (`engine.ts:545-560,585-595`), con el renglón de
  deducibilidad en tono `condicionado` (`deducibilidad.ts:64-71`).
- **Las tres cubetas suman el comprobado o no se pinta nada**
  (`deducibilidad.ts:54-55`, tolerancia de un centavo).
- **Las retenciones no se inventan.** `fiscal.ts:665-680` declara `calculable:
  false` con los dos campos que faltan por nombre exacto, en vez de derivar `4% ×
  subtotal`.
- **El IEPS del panel exige pago electrónico** (`fiscal.ts:541`) y no aplica la
  válvula del 15%, que es lo que `rfa-2026-2.9.yaml:limite_importante` pide.
- **El aviso de facturación lleva el matiz de jerarquía en las dos ramas**
  (`engine.ts:730-732,749`): "legalmente puedes exigir la factura dentro del
  ejercicio". Comprobé además que `pendientes.ts:154` (`plazo: c?.plazo ??
  'mes_natural'`) y `engine.ts:698` (`comercio?.plazoVerificado ? … :
  'mes_natural'`) **no** producen fechas distintas hoy, porque las 13 entradas
  del catálogo usan `mes_natural` salvo `office_depot` (`mes_siguiente`,
  `plazoVerificado: true`) — refuté esta divergencia antes de reportarla.
- **La clave del estímulo de IEPS es solo diésel** (`config.ts:109`,
  `clavesDieselIeps: ['15101505']`), y `etiquetaConcepto` (`engine.ts:1191-1198`)
  impide que un ticket de PLUS se imprima como "Diésel" e invite a reclamar un
  estímulo que no aplica.

---

## Lo que NO alcancé a revisar

- **`src/lib/likida/facturacion/` completo** (adaptadores CAPUFE/Playwright,
  `permiso_cre.ts`, `comercios.ts` entrada por entrada). Solo verifiqué
  `caducidad.ts`, `pendientes.ts` y los plazos del catálogo. El adaptador de
  CAPUFE teclea datos fiscales del receptor en un portal real y no lo audité.
- **`src/lib/saas/`** (Stripe, Facturapi, CFDI que Likida **emite** a la flota).
  Solo miré `fiscal.ts` lo suficiente para ver el conflicto de catálogos con
  `crearFlota`. El CFDI de la suscripción —uso, régimen, CP, PUE/PPD, REP— no
  está auditado en esta ronda.
- **`intake/consolidado.ts` y `intake/ocr.ts`** (424 y 472 líneas): de dónde
  salen `litros`, `formaPago` y `producto`, que son insumos directos de tres
  reglas fiscales. Solo verifiqué qué hace el motor con ellos.
- **Corrida real del motor con estos escenarios.** No creé archivos en el repo
  (instrucción del brief), así que todas las cifras de este reporte están
  derivadas leyendo el código línea por línea, no medidas con `vitest`. Las
  aritméticas son deliberadamente simples para que se puedan recomprobar a mano.
- **Retenciones y Carta Porte 3.1**: el producto declara honestamente que no
  existen (`facturacion/page.tsx:106-113`), así que no hay código que auditar.
- **Verificación de las fichas contra el DOF/SAT**: imposible en este entorno
  (egress bloqueado, ver la tabla de arriba). Todo lo que este reporte afirma
  sobre las normas sale del texto ya transcrito en las fichas, no de la fuente.
