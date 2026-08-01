# Cumplimiento fiscal — auditoría 8

**Nota: 4/10** (antes 5). Razón del movimiento: **mirada más profunda** — el
código no empeoró, la nota anterior estaba inflada. AL-6 **sí cerró** y lo
verifiqué corriendo el motor real (abajo, con las cifras). Pero las rondas 5, 6
y 7 auditaron este rubro tirando de un solo hilo —el RFC receptor— y de la tabla
de trazabilidad cifra→ficha. Al abrir los caminos que nadie había abierto
(el tope diario de LISR 28-V contra las cubetas, los litros del estímulo de
IEPS, el requisito del permiso CRE) salieron **tres rutas por las que el
producto imprime hoy una cifra fiscal equivocada**, y el ancla del rubro es
explícita: "3 o menos si el producto imprime una cifra fiscal equivocada". No
baja a 3 porque la trazabilidad es real y buena: cada cifra impresa tiene ficha,
`normas_sincronizadas.test.ts` impide que índice y YAML se separen, y el
producto sigue negándose a poner el estímulo de diésel en pesos.

El riesgo mayor de hoy: **el único número de la sección "ACREDITABLE /
RECUPERABLE" que no viene del XML son los litros de diésel — vienen de la
visión, sin una sola comprobación — y es justo el que el contador multiplica por
la cuota del DOF.**

---

## Hallazgos

### [CRÍTICO] Un CFDI sin RFC receptor sale "Deducible para ISR" en verde: es AL-6 por la puerta que quedó abierta

`src/lib/cuadra/cuadre/engine.ts:339` y `:355` · `src/lib/cuadra/intake/ocr.ts:299`,
`:313`, `:53` · `src/lib/cuadra/intake/ocr.ts:103`

Las **dos** ramas de validación del receptor exigen `g.rfcReceptor` truthy:
`if (rfcEmpresaInservible && g.rfcReceptor)` y
`if (rfcsOk.size > 0 && g.rfcReceptor && !rfcsOk.has(...))`. Si el gasto trae
`cfdiUuid` pero **no** trae `rfcReceptor`, ninguna corre y el gasto cae por
`cubetaDe` en `deducible`.

Y `rfcReceptor` solo se puebla desde el QR del SAT (`ocr.ts:313`,
`if (fiscal.rfcReceptor)`) o desde el XML. **El esquema de visión no tiene campo
de receptor**: `ocr.ts:38-76` declara `cfdi_uuid`, `rfc_emisor`, `emisor`… y
ningún `rfc_receptor`; el prompt (`ocr.ts:103`) le pide al modelo el folio
fiscal de un CFDI impreso —"Folio Fiscal", "en el recuadro del sello digital"— y
en `rfc_emisor` le dice expresamente *"si hay varios RFC impresos, el del EMISOR
es el del encabezado, **no el del cliente**"*. Es decir: se lee el UUID de una
factura impresa y se descarta a propósito el RFC del receptor. El propio
`intake/cfdi.ts` documenta que el QR falla en campo por daño físico del papel
("doblez cruzando el código, impresión térmica moteada, código fuera de
encuadre"), y `decidir.ts:26` da de alta el gasto igual (`legible` no mira el
receptor).

**Norma comparada** — `normas/liva-5.yaml` (`verificado_fuente_primaria`), art.
5º fr. I: *"se consideran estrictamente indispensables las erogaciones
efectuadas **por el contribuyente** que sean deducibles para los fines del
impuesto sobre la renta"*; `normas/lisr-27-III.yaml`: *"Estar amparadas con un
comprobante fiscal"*. Un CFDI a nombre de otro contribuyente no ampara ninguna
de las dos.

Escenario (corrido contra `cuadrarViaje` real, `empresaRfc: 'EMP010101AA2'`,
RFC válido y con dígito verificador correcto, factura de $11,600 con $1,600 de
IVA):

```
receptor LEÍDO del QR = ODM950324V2A (un tercero)
  → deducible 0 | noDeducible 11600 | iva 0 | difs: rfc_receptor      ← correcto

MISMA factura, receptor NO leído (QR ilegible, UUID leído por visión)
  → deducible 11600 | noDeducible 0 | iva 1600 | difs: (NINGUNA)
  → PDF: "Deducible para ISR $11,600.00" (verde)
         "IVA acreditable (LIVA art. 5) $1,600.00" (verde)
  → estatus: cuadrada
```

El veredicto de la MISMA factura se voltea de "$11,600 no deducible" a "$11,600
deducible + $1,600 de IVA acreditable, en verde y citando el artículo" según si
el QR se decodificó o no. Con el XML pegado (`processor.ts:615`) pasa lo mismo
si el `Receptor@Rfc` no se parsea: `cfdi_xml.ts:162` lo deja `undefined` sin
avisar.

**Consecuencia:** el contralor deduce y acredita un comprobante que puede estar
a nombre de un tercero, con el artículo citado al lado. Es exactamente el daño
del CRÍTICO de la ronda 5 y del AL-6 de la ronda 6, por la única puerta que las
dos dejaron abierta. Y no hay una sola prueba que cubra el caso:
`rfc_no_verificable.test.ts` y `rfc_empresa_invalido.test.ts` (10 casos entre
las dos) siempre pasan `rfcReceptor`.

**Causa raíz probable:** las dos validaciones tratan "no hay receptor" como
"nada que verificar" en vez de como el tercer estado que este mismo motor ya
inventó para el RFC de la empresa (`rfc_receptor_no_verificable`).

---

### [CRÍTICO] Los litros del estímulo de IEPS salen del OCR sin una sola verificación, y son el número que se multiplica por la cuota

`src/lib/cuadra/cuadre/engine.ts:770-772` ·
`src/lib/cuadra/liquidacion/acreditable.ts:94-100` ·
`src/lib/cuadra/cuadre/resumen.ts:83`

`const litros = Number((g.ocrExtra)?.litros ?? 0)` — el valor viene del modelo
de visión (`ocr.ts:41`, `litros: z.number().nullable()`), y **nada lo coteja**:
ni contra el XML (`cfdi_xml.ts` no extrae `Cantidad`), ni contra
`precio_unitario × litros ≈ subTotal`, ni contra
`tabulador.precioDieselPorDefecto` (que existe en `config.ts:73` con 27.0
MXN/L). El único cruce OCR↔código del intake es sobre el TOTAL
(`montoDiscrepante`, `ocr.ts:337`), no sobre los litros. El tipo
`diesel_desviacion` está declarado en `types/cuadra.ts:91` y **nunca se emite**.

Escenario (corrido con el motor real; un decimal corrido, que es el error de
lectura que este repo ya midió sobre folios y fechas):

```
entra: diésel $5,800.00, subTotal 4,310.34, tarjeta, CFDI con XML verificado,
       ocrExtra.litros = 20000   (el ticket dice 200.00 L)
sale:  PDF  → "Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A)
               20,000 L"
       WhatsApp → "• Diésel elegible para el estímulo de IEPS: 20,000 L"
       estatus: con_diferencias  (ni siquiera 'revisar')
       diferencias: anticipo, ieps_no_desglosado   ← nada sobre los litros
```

$5,800 / 20,000 L = **$0.29 por litro**. El motor tiene el precio de referencia
a un `import` de distancia y no lo mira. Con confianza de OCR 0.55 el resultado
es igual de afirmativo: sale `ocr_baja_confianza` (revisión) y el papel imprime
"200 L" como hecho de todos modos.

**Norma comparada** — `normas/lif-2026-20-A.yaml`
(`verificado_fuente_primaria`): *"el monto que se podrá acreditar será el que
resulte de multiplicar la cuota… por el número de litros importados o
adquiridos"*. Los litros **son** la base del estímulo.
`normas/criterio-1-LIF-PI.yaml` es más duro: *"Un motor de reglas que use una
cuota constante NO comete un error del cliente: implementa una práctica indebida
propia"* — y calcular de más el estímulo, sea por la cuota o por los litros, es
la misma práctica del criterio 1/LIF/PI, que alcanza a "quien preste servicios".

**Consecuencia:** el contador de la flota multiplica 20,000 L por la cuota
semanal y acredita cien veces el estímulo que le toca; el excedente se lo
reclaman al cliente y el papel que se lo dio lo firma Likida. Es el único número
de la sección que vende que no está respaldado por el XML, y el producto lo
imprime con el artículo al lado, sin condicionar.

**Causa raíz probable:** el resto de la sección ACREDITABLE se blindó exigiendo
`xmlVerificado` (engine.ts:724) porque "así el IVA/IEPS son SIEMPRE los importes
LEÍDOS del XML"; los litros se quedaron colgados de `ocrExtra` porque el XML no
siempre los trae, y esa excepción nunca recibió un guardarraíl propio.

---

### [CRÍTICO] El tope de $750/día se reparte contra pesos que todavía no son deducción de nadie: una comida timbrada de $700 sale $194.44 deducible

`src/lib/cuadra/cuadre/engine.ts:648-653` (armado de `porDia`) · `:656`
(`total`) · `:675-676` (`proporcionDia`) · `:827-828` (el comentario que afirma
lo contrario) · `:829-832` y `:742`

`porDia` mete **todos** los gastos de alimentación del día sin mirar en qué
cubeta caen: el filtro es solo `duplicados / monto>0 / conTope(concepto)`. El
denominador de `proporcionDia = topeAlimentacion / total` incluye por lo tanto
los pesos que están en `por_confirmar` —tickets sin timbrar, que **no amparan
ninguna deducción hoy**— y esa proporción se aplica al gasto que sí está
timbrado, y al IVA de ese gasto (`:742`).

El comentario de `:827-828` afirma exactamente la protección que falta:
*"Los gastos que ya cayeron en `por_confirmar` no arrastran su exceso hasta acá:
mientras no estén timbrados no son deducción de nadie."* No arrastran su exceso,
pero **sí consumen el tope**.

Escenario (corrido con el motor real, `viaticosTopeFiscalDiarioMxn: 750`):

```
entra (20-jul): alimentación $700 CON CFDI y XML al RFC de la empresa (IVA $96.55)
                alimentación $2,000 SIN CFDI (ticket de fonda, por timbrar)
                hospedaje $900 con CFDI
sale:  Deducible para ISR   $1,094.44   (de la comida: solo $194.44)
       Por confirmar        $2,000.00
       No deducible         $  505.56   ← en ROJO
       IVA acreditable      $   26.82   (de $96.55)
correcto hoy: la única alimentación que ampara deducción son los $700, que están
       POR DEBAJO del tope de $750 → $700 deducibles y $96.55 de IVA acreditable.
```

Se le quitan a la flota **$505.56 de deducción y $69.73 de IVA acreditable**, y
se pintan de rojo como perdidos. La nota que acompaña dice *"Alimentación del
2026-07-20: $2,700.00 (2 comprobantes del día) excede el tope fiscal de $750.00
por día (LISR 28-V) — el excedente de $1,950.00 no es deducible"*, mientras el
desglose de la misma página dice "No deducible $505.56": la nota y el desglose
se contradicen sobre el mismo día. Con el día entero sin timbrar la
contradicción es total: el papel dice *"el excedente de $1,250.00 no es
deducible"* y el desglose no imprime renglón de No deducible en absoluto,
porque son $0.

**Norma comparada** — `normas/lisr-28-V.yaml` (`verificado_fuente_primaria`):
*"Tratándose de gastos de viaje destinados a la alimentación, éstos sólo serán
deducibles hasta por un monto que no exceda de $750.00 diarios por cada
beneficiario"*. El tope acota la **deducción**; un gasto sin comprobante fiscal
no es deducción y no puede consumirla. Y `normas/liva-5.yaml` acredita el IVA
"en la proporción en la que dichas erogaciones sean deducibles" — la proporción
que se le está aplicando no es esa.

**Consecuencia:** el contralor compra precisamente por esta cifra. Sumar $700 de
comida timbrada bajo un tope de $750 y leer "$194.44 deducibles, $505.56 no
deducibles" es el tipo de cuenta que se hace con una calculadora en la sala. Es
el mismo error que el comentario de `:812-814` dice haber eliminado —"Mandar los
$900 completos a no deducible por $150 de exceso es el error que más dinero le
cuesta al cliente"— cometido otra vez desde el otro lado.

**Causa raíz probable:** el tope diario se calcula **antes** de que se sepa en
qué cubeta cae cada gasto, así que no puede excluir del denominador lo que no es
deducible; el reparto por proporción (arreglo de la ronda 6) heredó ese
denominador sin revisarlo.

---

### [ALTO] El permiso CRE en el CFDI de combustible es requisito de deducibilidad y no se valida en ninguna parte — con la tabla de 12,625 permisos ya cosechada y sin un solo consumidor

`src/lib/cuadra/cuadre/engine.ts:391-439` (todo el bloque de combustible: nada
de permiso) · `src/lib/cuadra/facturacion/permiso_cre.ts:129`
(`identificarPorPermiso`) · `src/lib/cuadra/intake/cfdi_xml.ts:155-172` ·
`src/types/cuadra.ts` (no existe el campo)

**Norma comparada** — `normas/lisr-27-III.yaml:19`, 2º párrafo: *"Tratándose de
la adquisición de combustibles para vehículos marítimos, aéreos y terrestres, el
pago deberá efectuarse en la forma señalada… aun cuando la contraprestación… no
exceda de $2,000.00 **y en el comprobante fiscal deberá constar la información
del permiso vigente**, expedido en los términos de la Ley de Hidrocarburos al
proveedor del combustible y que, en su caso, dicho permiso no se encuentre
suspendido, al momento de la expedición del comprobante fiscal"*.
`normas/rfa-2026-2.9.yaml` (`verificado_fuente_primaria`, vigente desde el
18-feb-2026) lo repite en su texto y lo lista como condición de aplicación:
`:36` *"El CFDI debe consignar el permiso vigente y no suspendido"*. Y
`normas/cff-29-A.yaml:16-22` documenta el inciso f) de la fracción V con el
número de permiso.

`command grep -rni "permiso" src/lib/cuadra/intake/ src/lib/cuadra/cuadre/
src/types/cuadra.ts` devuelve **cero** resultados: el permiso no se extrae del
XML, no vive en `Gasto`, no se compara y no se menciona.

Escenario (corrido con el motor real):

```
entra: diésel $5,800, tarjeta (formaPago 04), CFDI con XML verificado,
       claveProdServ 15101505, complemento de hidrocarburos presente,
       y SIN el permiso de la Ley de Hidrocarburos en el comprobante
sale:  "Deducible para ISR $5,800.00"  (verde)
       "IVA acreditable (LIVA art. 5) $689.66"  (verde)
       "Diésel elegible para el estímulo de IEPS 200 L"
       diferencias: (nada sobre el permiso)
```

Y en el mismo repo, `permiso_cre.ts` trae 12,625 permisos verificados (conté el
JSON: 12,625 llaves, 3,226 marcas) y tres estados para no confundir "no sé" con
"no existe". `command grep -rn "identificarPorPermiso\|permisoDelTicket\|
permisosDelTicket\|coberturaTablaCre" src/` fuera de su propio módulo y su
prueba: **cero llamadas**. La capacidad que resolvería el requisito está escrita,
probada y desconectada — el mismo patrón que este repo ya documentó con
`identificarComercio` ("estaba escrito, probado y sin llamar desde ningún lado",
engine.ts:515).

**Consecuencia:** la deducción del diésel es el gasto más grande de la flota y
el producto la afirma en verde sin validar el requisito que la propia ficha
`verificado_fuente_primaria` de la facilidad que le vendemos exige. Un contador
que revise la primera liquidación pregunta por el permiso.

**Causa raíz probable:** la cosecha del CRE se planteó como capa de contexto
para adivinar el portal de facturación, y nadie conectó la línea que va del
permiso impreso al requisito de LISR 27-III.

---

### [MEDIO] La nota de `combustible_efectivo` afirma la deducción citando la RFA 2.9 sin ninguna de sus otras tres condiciones — la asimetría exacta que el peaje ya corrigió

`src/lib/cuadra/cuadre/engine.ts:249`

El texto que se imprime es: *"…cuenta contra el tope del 15% del combustible del
ejercicio (RFA 2026 regla 2.9). **Dentro del 15% sigue siendo deducible**; el
excedente no. No acredita IEPS en ningún caso."*

**Norma comparada** — `normas/rfa-2026-2.9.yaml:32-37`,
`condiciones_de_aplicacion`, cuatro y no una:

1. "Dedicados EXCLUSIVAMENTE al autotransporte terrestre de carga federal"
2. "Tributar en Título II Cap. VII (coordinados) o Título IV Cap. II Secc. I"
3. "El efectivo no puede exceder el 15% del total pagado por combustible"
4. "El CFDI debe consignar el permiso vigente y no suspendido"

La nota condiciona solo la tercera. Las otras tres el motor no las conoce —no
sabe el régimen fiscal de la flota, ni si se dedica exclusivamente a carga
federal, ni el permiso.

Escenario: una flota que además hace transporte de personal (no "exclusivamente"
carga federal) recibe por WhatsApp y en el PDF *"Dentro del 15% sigue siendo
deducible"* sobre un diésel de $5,800 pagado en efectivo, con la regla citada.
No le aplica la facilidad, y por LISR 27-III 2º párrafo ese pago **no es
deducible en absoluto**.

**Consecuencia:** es el mismo defecto que la ronda 5 encontró en el estímulo de
peaje y que la 6 cerró poniendo *"— sujeto a elegibilidad"* en el label y
*"Likida NO verifica la elegibilidad"* en el pie
(`acreditable.ts:64-67`). Aquí no se hizo, y la afirmación es más tajante: dice
"sigue siendo deducible", no "puede serlo".

**Causa raíz probable:** el arreglo del peaje se aplicó a la sección ACREDITABLE
(`acreditable.ts`) y no a las notas de `diferencias`, que salen del motor.

---

### [MEDIO] La ficha de plazos de portales volvió a quedarse atrás del catálogo: dice 1 de 13 verificados, el código tiene 4 de 37 — y es el fallo que ella misma documenta haber corregido en la ronda 5

`normas/politica-portales-plazos.yaml:48-49` ·
`src/lib/cuadra/facturacion/comercios.ts:191`, `:280`, `:375`, `:404`

La ficha declara: *"`facturacion/comercios.ts` — `plazoVerificado: false` en 12
de 13 entradas; `true` SOLO en office_depot (plazo `mes_siguiente`, leído del
ticket)"*. Conté el catálogo de hoy: **37 comercios**, y `plazoVerificado: true`
en **cuatro** — `g500` (`:191`, `mes_natural`), `office_depot` (`:280`,
`mes_siguiente`), `megasur` (`:375`, `mes_natural`) y `la_gas` (`:404`,
`mes_natural`).

Escenario: el contralor lee en la liquidación *"Combustible de $839.70 sigue sin
factura: puedes timbrarlo hasta el 2026-07-31 (5 días) (plazo del portal de G500,
no de la ley: legalmente puedes exigir la factura dentro del ejercicio)"* —una
fecha de nivel 6 impresa en un documento que se archiva— y quien quiera
rastrearla llega a un YAML `sin_verificar` que afirma que esa entrada está en
`false` y que el motor no usa esos números.

**Consecuencia:** es exactamente lo que la propia ficha narra en
`nota_verificacion`: *"Esta ficha decía que TODAS las entradas estaban en
`false`… Dejó de ser cierto con el commit 13a56c6 y la ficha se quedó atrás: un
auditor que rastreara la fecha 2026-08-31 llegaba a un YAML `sin_verificar` que
decía lo contrario del código. Corregido el 28-jul-2026 (auditoría 5)."* Volvió
a pasar, con tres entradas nuevas. **REINCIDENTE de patrón** (el defecto se
cerró en la ronda 5 y reapareció en el mismo archivo).

**Causa raíz probable:** `normas_sincronizadas.test.ts` verifica id, estado,
jerarquía, citas, ruta de ficha y `fecha_vigencia_desde` — nada obliga a que
`usado_en_codigo` corresponda con el código, así que ese campo se degrada en
silencio.

---

### [MEDIO] La entrada `g500` manda a toda la red al portal de la franquicia de Mérida, contra lo que dice su propio comentario

`src/lib/cuadra/facturacion/comercios.ts:180` (`portal:
'http://megasur.com.mx:8029/'`) y `:165-220`

El comentario de la entrada dice *"El de la red se conserva como fallback porque
no todas las estaciones son del sureste"*, pero el campo `portal` quedó
apuntando al sistema del sureste. La entrada `megasur` (`:368`) ya tiene ese
mismo portal y se quedó con los dominios del sureste
(`megasur.com.mx`, `g500sureste.com.mx`); `g500` conserva
`g500network.com` y `miappg500.g500network.com`.

Escenario: un ticket de una G500 de Sonora, reconocido por el dominio
`g500network.com` impreso en el papel, produce en la liquidación
*"Portal de G500: http://megasur.com.mx:8029/ — te pedirá Autorización/WebID."*
La oficina teclea el WebID de un ticket de Sonora en el sistema de la
franquicia de Mérida, no encuentra la venta, y el ticket llega al fin de mes sin
timbrar. El gasto se queda en "Por confirmar" y su IVA se pierde.

**Consecuencia:** el aviso de facturación es lo único accionable del papel, y
mandar a la oficina al portal equivocado es el modo de falla que
`identificar.ts:6-9` declara querer evitar: *"Mandar un ticket al comercio
equivocado NO falla de forma visible: falla pidiéndole a la oficina un 'Web ID'
que ese ticket nunca tuvo, y nadie entiende por qué."*

**Causa raíz probable:** `10f7830` corrigió la entrada `g500` contra el portal
real de Mérida; después se creó la entrada `megasur` específica y se movieron los
dominios, pero el `portal` de `g500` no volvió a `g500network.com`.

---

### [BAJO] `cff-29-A.yaml` funda dos reformas en una fecha tres meses en el futuro

`normas/cff-29-A.yaml:16` y `:23` (`fecha: 2026-11-07`)

Las dos `reformas_relevantes` —el inciso f) de la fracción V con el permiso de
la CNE/CRE, y el nuevo plazo de cancelación— se fechan el **7-nov-2026**, y hoy
es 1-ago-2026. O la fecha está mal (el paquete económico que reformó el CFF
sale en el DOF del 7-nov del año ANTERIOR, igual que `lif-2026-20-A.yaml`, que
sí trae `fecha_publicacion: 2025-11-07`), o son reformas que todavía no están en
vigor y la ficha las presenta como aplicables.

**Consecuencia:** `cff-29-A` es la ficha que fundamenta cuatro veredictos en
`por_diferencia.ts` (`rfc_receptor`, `cfdi_cancelado`, `cfdi_no_encontrado`,
`cfdi_pendiente`, `comprobante_no_fiscal`) y el agente la puede citar. La ficha
está `evidencia_corroborante` con `texto_vigente: null`, así que ninguna de esas
citas es verificable hoy — y encima su cronología no cierra. No cambia ninguna
cifra: por eso es BAJO.

**Causa raíz probable:** copiado del año de publicación del paquete fiscal.

---

## Trazabilidad: cifra impresa → ficha (actualizada esta ronda)

| Cifra que ve el contralor | Dónde se imprime | Ficha | Estado de la ficha | Veredicto ronda 8 |
|---|---|---|---|---|
| `Deducible para ISR` / `No deducible` / `Por confirmar` | `pdf.ts:252-267` · `deducibilidad.ts:45-63` | `lisr-27-III` + `lisr-28-V` | corroborante / **primaria** | ❌ mal cuando el día mezcla timbrado y sin timbrar (CRÍTICO 3); ❌ mal cuando el CFDI no trae receptor (CRÍTICO 1) |
| `IVA acreditable (LIVA art. 5)` | `pdf.ts:303-305` · `acreditable.ts:102-108` | `liva-5` | **primaria** | ❌ acredita sobre un receptor no verificado (CRÍTICO 1); ❌ proporción mal calculada (CRÍTICO 3) |
| `Diésel elegible para el estímulo de IEPS` (LITROS) | `pdf.ts:303-305` · `acreditable.ts:94-100` | `lif-2026-20-A` | **primaria** | ❌ el número no lo verifica nadie (CRÍTICO 2). La DECISIÓN de dar litros y no pesos sigue siendo correcta |
| `Estímulo de peaje 50%… — sujeto a elegibilidad` | `pdf.ts:303-312` · `acreditable.ts:110-119` | `lif-2026-20-A` | **primaria** | ✅ sin cambios: tono `condicionado`, base declarada, las 4 condiciones al pie (verificado en `filasAcreditables`, tono ≠ `bueno` → tinta neutra en `pdf.ts:305`) |
| Tope de $750/día de alimentación | `engine.ts:685-690` (nota) | `lisr-28-V` | **primaria** | ⚠️ el importe y la periodicidad son correctos; el denominador no (CRÍTICO 3) |
| "no deducible (CFF 29-A)" / "revisión" por complemento de hidrocarburos | `engine.ts:423`, `:430` | `rmf-2026-2.7.1.48` + `cff-29-A` | corroborante / corroborante | ✅ sigue cerrado: `exigibleDesde: null` en índice y ficha, verificado por `normas_sincronizadas.test.ts:95` |
| `combustible_efectivo` — "dentro del 15% sigue siendo deducible" | `engine.ts:249` | `rfa-2026-2.9` | **primaria** | ⚠️ 1 de las 4 condiciones dicha (MEDIO) |
| Deducción del diésel (permiso de la Ley de Hidrocarburos) | `pdf.ts:252-267` | `lisr-27-III` + `rfa-2026-2.9` | corroborante / **primaria** | ❌ requisito no validado (ALTO) |
| `rfc_receptor_no_verificable` (por confirmar, sin acreditar) | `engine.ts:349-353` | ninguna (calidad de dato) | n/a | ✅ correcto — y cierra AL-6 |
| Plazo de portal ("puedes timbrarlo hasta el…") | `engine.ts:566-587` | `politica-portales-plazos` | sin_verificar | ⚠️ el matiz de jerarquía está en las tres ramas; la ficha ya no describe el código (MEDIO) |
| Descargo del pie (CFF 52, CFF 89/90) | `pdf.ts:403-405` · `leyendas.ts:50-59` | `cff-89-90` | **primaria** | ✅ sin cambios |
| `iepsAcreditable` en pesos | NO SE IMPRIME | `lif-2026-20-A` | primaria | ✅ correcto a propósito (`engine.ts:714`, `const iepsAcreditable = 0`) |

---

## Lo que revisé y está bien

- **AL-6 CERRADO, verificado corriendo el motor y no leyéndolo.**
  `engine.ts:171-214`: el RFC genérico ya NO se excluye de `rfcsOk` sin
  consecuencia — cae en `rfcEmpresaInservible` y emite
  `rfc_receptor_no_verificable`. Reproduje el CFDI de $11,600 a Office Depot con
  `empresaRfc: 'XAXX010101000'`: `deducible 0 · porConfirmar 11600 ·
  ivaAcreditable 0 · difs: rfc_receptor_no_verificable`. Los cuatro extremos que
  no se podían perder siguen bien: RFC válido + receptor ajeno → `rfc_receptor`
  (no deducible $11,600); RFC válido + receptor correcto → deducible con su IVA;
  RFC malformado → tercer estado; y el texto distingue "captura" de "corrige"
  (`engine.ts:343-348`). `rfc_no_verificable.test.ts` (10 casos) y
  `rfc_empresa_invalido.test.ts` (4) pasan.
- **El error canónico del IEPS sigue cerrado.** `engine.ts:714`
  (`const iepsAcreditable = 0`, y es `const` a propósito),
  `resumen.ts:71-85`, `acreditable.ts:78-80`, `analytics.ts:140`,
  `dashboard/page.tsx:289`. Los cuatro consumidores dicen litros; ninguno
  imprime pesos. `command grep -rn "cuota" src/` (28 resultados) confirma que no
  hay ninguna cuota de IEPS hardcodeada en el código, y
  `normas/.latido-cuota-diesel` dice la verdad: `normas/cuota-ieps-diesel.yaml`
  no existe. **El estímulo NO se está calculando con una cuota vieja: no se
  calcula.** Esa es la decisión correcta.
- **La fecha del complemento de hidrocarburos sigue saliendo de la ficha.**
  `engine.ts:406-410` lee `NORMAS['rmf-2026-2.7.1.48']?.exigibleDesde` (hoy
  `null`) y `config.ts:90` quedó como filtro de ruido.
  `complemento_exigibilidad.test.ts` verde.
- **Las tres cubetas siempre suman el comprobado.** Verificado con el motor real
  en los ocho escenarios que corrí (incluido el día mixto del CRÍTICO 3:
  `1094.44 + 2000 + 505.56 = 3600.00`), y `deducibilidad.ts:41-42` sigue siendo
  el portón que devuelve `null` si no cuadran. Ninguna cubeta salió negativa.
- **El estímulo de peaje sigue condicionado.** Corrí una caseta municipal de
  $1,160: sale `$500.00` con tono `condicionado` (tinta neutra, no verde) y los
  dos pies pegados —base sin IVA declarada y las cuatro condiciones textuales de
  `lif-2026-20-A.yaml` con la frase "Likida NO verifica la elegibilidad"—. H4,
  H5 y H6 de la ficha están DICHOS en el papel aunque no resueltos, que es lo
  correcto.
- **El índice de normas y las fichas no se han separado.**
  `normas_sincronizadas.test.ts` (10/10) verifica id, estado, jerarquía, citas,
  ruta de ficha y `fecha_vigencia_desde` en las 22 fichas. Y ninguna de las 11
  ids de `NORMA_POR_DIFERENCIA` ni de `NORMA_POR_CONCEPTO` está fuera de
  `NORMAS`, así que `tools.ts:127` (`NORMAS[id].citas[0]`) no puede reventar.
- **`normasDePolitica` filtra por índice.** `por_diferencia.ts:132`
  (`.filter((id) => NORMAS[id])`): un permiso sobre una ficha inexistente sería
  permiso muerto, y no puede emitirse. `permiso_politica.test.ts` (7/7) verde.
- **`evaluarTope15` usa el denominador correcto** (combustible contra
  combustible, `combustible.ts:69-91`) y `getAcumuladoCombustible`
  (`repo.ts:595-652`) pagina con `count: 'exact'` y **falla cerrado** si lee
  menos filas de las que hay — el sexto caso del patrón "fallo disfrazado de
  cero" NO está aquí. `avisoTope15` no afirma nada en `holgado` y su rama
  `sin_criterio` dice explícitamente que no se evaluó.
- **`filasImprimibles` y `resumenOmitidos`** (`omitidos.ts:67-92`, tocado hoy)
  usan `copiasDeComprobante` —el mismo origen que el motor— así que la suma de
  los renglones impresos es el `totalComprobado`, no otra cosa.
- **631 pruebas** de `cuadre/`, `liquidacion/`, `normas/`, `facturacion/`,
  `periodo/` e `intake/` (53 archivos) corridas por mí, todas verdes. Los tres
  CRÍTICOS de arriba son huecos de cobertura, no regresiones que la suite haya
  dejado pasar rojas.
- **`src/lib/cuadra/normas/permiso_politica.ts` NO existe** — el MAPA lo lista
  como archivo nuevo, pero lo nuevo es `permiso_politica.test.ts`, que prueba
  `normasDePolitica` de `por_diferencia.ts`. No es un hallazgo, es una
  corrección al mapa.
- **La tabla del CRE tiene los 12,625 registros que dice** (conté el JSON:
  12,625 llaves, 3,226 marcas). El comentario de `permiso_cre.ts:5-7` dice
  "46.6% son Pemex — 6,171 de 12,625"; el conteo real es 6,173, que es 48.9%.
  Es un comentario, no una cifra impresa, y la tabla no decide dinero: lo dejo
  anotado sin puntuar.

## Lo que NO alcancé a revisar

- **`liquidacion/pdf.ts` renderizado de verdad.** Leí el código que decide los
  renglones y los tonos, y verifiqué las estructuras que le llegan
  (`filasDeducibilidad`, `filasAcreditables`) con el motor real. **No generé un
  PDF ni lo miré.** Todo lo que digo del papel es inferencia sobre el código de
  dibujado.
- **`laboral/pagadero.ts` contra `lft-110-111-263.yaml`** — sin revisar por
  tercera ronda consecutiva. La sección "LO QUE SE LE REEMBOLSA AL OPERADOR"
  del PDF sale de ahí.
- **`intake/sat.ts`** (consulta de estatus y EFOS) contra `cff-69-B.yaml` y
  `cff-29-A.yaml`: no lo abrí. `cfdi_efos` es el veredicto más severo del motor
  y no verifiqué su camino.
- **`normas/rfa-2026-2.2.yaml`** (el 8% de "gasto ciego") tiene
  `usado_en_codigo: []` — no busqué si algún material comercial o el agente lo
  ofrece pese a que la regla excluye expresamente el combustible.
- **`cuadre/desde_db.ts`** lo leí y confirmé que NO pasa `operadorRfc` (la ficha
  `rlisr-57.yaml` lo declara pendiente porque la tabla `operador` no tiene esa
  columna), pero no medí cuántas liquidaciones reales caerían en
  `viatico_rfc_operador` por eso.
- **El régimen fiscal y la exclusividad de la flota** (condiciones 1 y 2 de la
  RFA 2.9, condiciones 1, 3 y 4 del estímulo de peaje): no busqué si existe
  algún lugar donde se capturen. Asumí que no, por los comentarios del código.
- **Fichas no verificables esta ronda** (`texto_vigente: null`, sin transcripción
  de fuente primaria): `cff-29-A`, `criterio-1-CFF-PI`, `criterio-1-LIF-PI`,
  `rmf-2026-2.7.1.21`, `politica-portales-plazos`. Nada de lo que afirmo se
  apoya en ellas. Anoto además que `indice.ts:127` guarda
  `titulo: ">"` para `criterio-1-CFF-PI` —el marcador de bloque del YAML se
  coló al índice— y `normas_sincronizadas.test.ts` no compara títulos.
- **`normas/.latido-vigilancia`**: tres corridas consecutivas bloqueadas por
  egress significa que **ninguna** ficha se ha revalidado desde el 21-jul. Todo
  lo que dice "verificado_el: 2026-07-27" lleva cinco días sin contrastarse
  contra el DOF, y no tengo forma de comprobarlo desde aquí.
