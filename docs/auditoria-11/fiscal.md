# Cumplimiento fiscal — auditoría 11 (pase 2)

**Nota: 6/10** (antes 3). Razón del movimiento: **se atacó y subió**. Los dos
CRÍTICOS del pase 1 están cerrados y los verifiqué **ejecutando el motor real**,
no leyendo el diff: el EFOS indeterminado ya sale `Por confirmar $11,600 · IVA
$0 · sin sección ACREDITABLE`, y el RFC del tenant del demo (`TIN010101AA5`) pasa
nuestro propio dígito verificador. Con ellos cayeron los dos ALTOS del medio de
pago, el numerador y el margen del 15%, y el IVA por WhatsApp.

No sube más porque el ancla de 8+ pide que *cada cifra fiscal impresa rastree a
una ficha `verificado_fuente_primaria`*, y hoy no lo hace: el $750/día (LISR
28-V), el 50% del peaje y los litros del estímulo cuelgan de fichas
`evidencia_corroborante`, y la lista de medios de pago del estímulo de diésel
cuelga de una sección cuyo `texto_vigente` es `null` por decisión declarada.

**El riesgo mayor del rubro, hoy:** el motor ya casi nunca se equivoca; **las
superficies que lo pintan sí**. El mismo hecho sale condicionado en el PDF y en
verde en la pantalla de la liquidación (`dashboard/[id]/page.tsx:216-219`), y la
liquidación del demo pierde en silencio el estímulo de diésel porque el parser
del XML nunca lee `Cantidad`. Dos papeles del mismo cuadre que no dicen lo mismo,
delante del contralor.

---

## Cómo verifiqué

Motor bundleado FUERA del repo con `esbuild` (`--alias:@=./src`, stubs de
`sharp`, `zxing-wasm/reader` y `pdf-lib`) y ejecutado con node desde el
scratchpad. **Todo lo que aparece como "sale" es salida medida** de
`cuadrarViaje`, `parseCfdiXml`, `filasDeducibilidad`, `filasAcreditables`,
`evaluarTope15` y `avisoTope15`. No edité ni un archivo del repo fuera de éste.

Compuerta medida hoy: `npx tsc --noEmit -p .` → **exit 0**. `npx vitest run` →
**269 archivos · 2,530 pruebas · 4 rojas** (`fundamento.test.ts` «un mensaje
normal cuesta una fracción de milisegundo»: 805 µs contra un umbral de 500, y
tres del mismo corte de tiempo/tamaño de imagen). Las corrí con `esbuild` y
`tsc` en paralelo en la misma máquina, así que **no las cuento como regresión**:
son sensibles a la carga y ninguna es de mi rubro. Dicho para que el rubro de
pruebas lo mire, no para colgárselo a nadie.

Fichas: **21** en `normas/`, 17 de mi rubro (las 4 `lfpdppp-*` son del auditor
legal). Esta ronda **sigue sin red**: `curl` a
`https://www.diputados.gob.mx/LeyesBiblio/pdf/LIF_2026.pdf` responde
`CONNECT tunnel failed, response 403`, igual que las cinco corridas que
`normas/.latido-vigilancia` documenta. Todo lo que digo sobre el texto de una ley
sale de la transcripción que la ficha declara.

---

## Hallazgos

### [ALTO] El parser del XML nunca lee `Cantidad`, así que la liquidación del demo entrega **0 litros** de estímulo sobre un CFDI que dice `Cantidad="113.00" ClaveUnidad="LTR"` — y el panel imprime que ese CFDI no trae los litros

`src/lib/cuadra/intake/cfdi_xml.ts:105-119` (el `map` de conceptos lee
`@_ClaveProdServ` y `@_ClaveUnidad`, **nunca `@_Cantidad`**) ·
`src/lib/cuadra/cuadre/engine.ts:1146` (`const litros = Number(g.ocrExtra?.litros ?? 0)`) ·
`src/lib/cuadra/processor.ts:1017-1034` (el alta desde XML **no** escribe `ocrExtra`) ·
`src/app/dashboard/medicion.ts:40` · `supabase/seed.sql:121-135` ·
ficha `normas/lif-2026-20-A.yaml` (**`evidencia_corroborante`**) · **NUEVO**

Texto de la ficha, `estimulo_diesel_transporte.texto_vigente`, literal:

> «...el monto que se podrá acreditar será el que resulte de multiplicar la cuota
> del impuesto especial sobre producción y servicios que corresponda según el tipo
> de combustible... vigente en el momento en que se haya realizado la importación o
> adquisición del diésel..., **por el número de litros importados o adquiridos**.»

y su `como_se_calcula`: *«cuota IEPS vigente al momento de la compra × LITROS.»*
**Los litros son la única mitad del producto que Likida entrega**, y es la cifra
que la ficha `criterio-1-LIF-PI` dice que el contador multiplica por la cuota
del DOF.

**Medido, con el XML exacto de `seed.sql:135`.** `parseCfdiXml` devuelve:

```
claveProdServ 15101505 · claveUnidad "LTR" · complementoHidrocarburos true
subTotal 3210 · iepsTraslado 408.62 · ivaTraslado 581.38 · formaPago "03"
                       ← NO HAY campo `cantidad`. Los 113.00 L se descartan.
```

y el cuadre del viaje del demo (diésel $4,200 + caseta $1,400, anticipo $10,600,
`empresaRfc TIN010101AA5`, `DEMO_CONFIG`):

```
sin ocrExtra.litros (= el gasto del seed) → litros 0
   ACRED: [IVA acreditable ... $774.48] [Estímulo de peaje 50% ... $603.45]
   ← el renglón «Diésel elegible para el estímulo de IEPS» NO EXISTE

con ocrExtra.litros = 113 (foto + XML)   → litros 113
   ACRED: [Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A) | 113 L | condicionado]
```

El único productor de `litros` es el OCR de una **foto** (`intake/ocr.ts:42`,
`:487`). El camino de mejor calidad de dato que existe —el XML solo, sin visión
de por medio— es el que pierde el estímulo.

**Y el papel lo explica al revés.** Con `litrosDiesel = 0` y liquidaciones > 0,
`notaAcreditable` imprime `NOTA_SIN_MEDICION.litrosDiesel`
(`app/dashboard/medicion.ts:40`), literal:

> «Ningún CFDI de diésel del periodo trae los litros (complemento de
> hidrocarburos) — sin ellos no se pueden contar.»

El CFDI **sí** los trae: `Cantidad="113.00"`, `ClaveUnidad="LTR"`. Y el
paréntesis además atribuye el dato al sitio equivocado: en el propio XML del seed
el nodo `HidroYPetro` lleva `TipoPermiso`, `NumeroPermiso`, `ClaveHYP` y
`SubProductoHYP`, **ningún volumen**. El comentario de `medicion.ts:16-17` ya
confiesa la causa —*«`ocrExtra.litros` (solo lo escribe el OCR de una foto)»*—
pero la frase que se imprime culpa al comprobante del cliente.

**Escenario en pesos.** Flota que manda sus XML por correo (el flujo que la
oficina prefiere) con 200,000 L al año. Likida entrega **0 L**. Con la banda de
cuota que la ficha `criterio-1-LIF-PI` cita para 2026 ($2.09–$7.36/L), son
**$418,000 a $1,472,000 de estímulo que el contador nunca ve**. Sobre el CFDI
único del demo: 113 L = **$236 a $832**, sobre un comprobante impecable.

**Consecuencia:** el 6-ago la tarjeta «Diésel elegible para el estímulo» de
`/dashboard` sale en «—» con esa nota, y el PDF de la liquidación **no imprime el
renglón del estímulo de diésel**. El contralor abre el XML que él mismo mandó,
lee `Cantidad="113.00"`, y lo que Likida le dice es que su factura no los trae.

**Causa raíz probable:** los litros se modelaron como un dato de visión cuando el
CFDI los lleva estructurados; `cfdi_xml.ts` extrae del mismo nodo el atributo de
al lado y no éste.

---

### [ALTO] (REINCIDENTE, alcance reducido) La pantalla de UNA liquidación imprime peaje, IVA y litros en **verde a 3xl** sin ninguna de las reservas que el PDF de esa MISMA liquidación imprime

`src/app/dashboard/[id]/page.tsx:216-219` y `:328-336` (`Tot` con `ok` →
`var(--color-ok)`) · `src/app/dashboard/chat.tsx:70` y `:73` ·
`src/app/dashboard/politicas/page.tsx:119-123` · contraste medido:
`src/lib/cuadra/liquidacion/acreditable.ts:83`, `:151`, `:211-215` ·
ficha `normas/lif-2026-20-A.yaml` (**`evidencia_corroborante`**)

`estimulo_peaje.texto_vigente`, literal:

> «Se otorga un estímulo fiscal a las personas contribuyentes que se dediquen
> **exclusivamente** al transporte terrestre público y privado, de carga o pasaje,
> así como el turístico, **que utilizan la Red Nacional de Autopistas de Cuota**,
> que obtengan en el ejercicio fiscal... **ingresos totales anuales... menores a
> 300 millones de pesos**... **El estímulo no podrá ser aplicable por las personas
> morales que se consideran partes relacionadas**...»

**Lo que sí se cerró, y hay que decirlo:** `/dashboard` (`page.tsx:270`) y
`/dashboard/facturacion` (`page.tsx:115`) ya importan `ETIQUETA_PEAJE_CORTA` y
`NOTA_PEAJE_PANEL` del motor, y `cuadre/resumen.ts:124` ya pega
`(sujeto a elegibilidad)` en WhatsApp. De cinco superficies del pase 1 quedan
**dos**, más una tercera nueva que nadie había mirado.

**Escenario (medido con la caseta exacta de `seed.sql:128`, subtotal $1,206.90).**
Misma liquidación, dos documentos:

```
PDF  (filasAcreditables)
  «Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad»  $603.45  tinta neutra
     pie 1: base usada = subtotal SIN IVA; con el total sube ~13.8%
     pie 2: «Likida NO verifica la elegibilidad» + las cuatro condiciones
  «IVA acreditable (LIVA art. 5) — sujeto a la deducibilidad para ISR»       $774.48  tinta neutra

/dashboard/<id>  (Tot ... ok)
  «Peaje 50%»          $603.45   3xl, --color-ok (VERDE)
  «IVA acreditable»    $774.48   3xl, --color-ok (VERDE)
  «Diésel elegible para el estímulo»  n L  3xl, VERDE
     ninguna reserva, ningún pie, ninguna de las cuatro condiciones

/dashboard rail (chat.tsx:73)  «$603.45 de peaje acreditable (50%) en el periodo.»
/dashboard/politicas:121       «50% — Del gasto de peaje es acreditable — estímulo de autopistas, LIF 2026 Art. 20-A.»
```

`dashboard/[id]/page.tsx` **sí** usa `filasDeducibilidad` para la sección de
cubetas (`:107`) — o sea, el archivo conoce el patrón — y para la sección
ACREDITABLE arma cuatro `Tot` a mano en vez de llamar `filasAcreditables`. Es
exactamente la trampa del MAPA: el arreglo existe en un archivo y el camino que
corre no pasa por él.

**Consecuencia:** ésta es la pantalla que el contralor abre al hacer clic en una
liquidación, y es donde va a mirar mientras el PDF se descarga. Una flota con
ingresos ≥ $300M, o parte relacionada, o que usó casetas fuera de la Red Nacional
de Autopistas de Cuota, se lleva $603.45 afirmados en verde con el artículo al
lado — y el criterio `1/LIF/PI` del Anexo 3 alcanza a «quien preste servicios».

**Causa raíz probable:** la reserva se centralizó en `acreditable.ts` y se
cablearon las superficies una por una; la de detalle de liquidación y el rail no
entraron en la lista.

---

### [ALTO] El PDF se contradice en la misma hoja: «Deducible para ISR $700.00» en **verde**, y dos renglones abajo «IVA acreditable — sujeto a la deducibilidad para ISR»

`src/lib/cuadra/liquidacion/deducibilidad.ts:64` (solo mira
`permiso_cre_no_verificable`) contra
`src/lib/cuadra/liquidacion/acreditable.ts:128-132` (`CONDICIONAN_LA_DEDUCCION_ISR`
lista **tres** motivos) · `src/lib/cuadra/liquidacion/pdf.ts:295` (`'bueno'` → GREEN) ·
fichas `normas/lisr-28-V.yaml` (`evidencia_corroborante`) y
`normas/liva-5.yaml` (**`verificado_fuente_primaria`**) · **NUEVO**
(es el MEDIO del pase 1 con el signo invertido)

`lisr-28-V.yaml`, 2º párrafo, literal:

> «Tratándose de gastos de viaje destinados a la alimentación, éstos sólo serán
> deducibles hasta por un monto que no exceda de $750.00 diarios por cada
> beneficiario... **y el contribuyente acompañe el comprobante fiscal o la
> documentación comprobatoria que ampare el hospedaje o transporte**.»

y su hallazgo `H1`, `severidad: alta`: *«Una comida SOLA, sin hotel ni transporte
que la acompañe, hoy se cuenta deducible hasta $750 — y por este párrafo NO lo
sería.»*

**Medido.** Comida de $700 timbrada, XML verificado, IVA $96.55, `FormaPago 04`,
sola en el viaje:

```
difs: [alimentacion_sin_soporte]
DEDUC → [ 'Deducible para ISR' | 700 | tono 'bueno' ]        → pdf.ts:295 GREEN
ACRED → [ 'IVA acreditable (LIVA art. 5) — sujeto a la deducibilidad para ISR'
          | $96.55 | tono 'condicionado' | pie: «...Esta liquidación depende de
          el comprobante de hospedaje o transporte que ampare la alimentación
          (LISR 28-V) — mientras eso no se confirme, este IVA tampoco está
          sostenido.» ]
```

El pie del IVA dice que **la deducción para ISR no está confirmada**. Tres
centímetros arriba, el renglón de ISR la afirma en verde. `acreditable.ts:117-123`
explica bien por qué esos tres veredictos no bajan la cubeta —son «el sistema no
verifica un requisito»— pero de ahí se sigue que el renglón de ISR tiene que ir
`condicionado`, exactamente como ya va con `permiso_cre_no_verificable`
(`deducibilidad.ts:65-72`). El tono existe y no se usa.

Aplica igual a `complemento_no_verificable` (el CFDI de combustible con XML sin
el nodo del complemento, cuando `exigibleDesde` es `null`): el IVA sale
condicionado y el ISR verde.

**Consecuencia:** el contralor archiva un papel que se desmiente a sí mismo sobre
$700 de deducción. El primero de los dos renglones que lea decide qué se cree, y
el verde es el que se lee primero. Su contador va a preguntar cuál de los dos vale
— y ésa es la conversación que decide si el motor es serio.

**Causa raíz probable:** la regla «lo que condiciona la deducción ISR condiciona
el IVA» se implementó en el archivo del IVA y nunca se aplicó de vuelta al archivo
del ISR, que es donde nació.

---

### [MEDIO] (REINCIDENTE, atenuado) Un hospedaje de $1 **con folio y sin CFDI** apaga `alimentacion_sin_soporte`, deja la liquidación en `cuadrada` y devuelve el IVA a verde

`src/lib/cuadra/cuadre/engine.ts:843-844` (`amparaLaComida = !!g.cfdiUuid || !!g.folio`)
y `:904-905` · ficha `normas/lisr-28-V.yaml` (`evidencia_corroborante`)

El arreglo de esta ronda subió el listón de «existe un concepto» a «existe un
concepto **con folio o UUID**». El folio es justo lo que el OCR lee de cualquier
papel, así que el escalón sigue siendo de un carácter.

**Medido, los tres casos seguidos:**

```
comida $700 timbrada, sola                       → [alimentacion_sin_soporte]  estatus revisar
                                                    ACRED: IVA condicionado
+ hospedaje $1 SIN folio ni UUID                 → [alimentacion_sin_soporte]  estatus revisar   ← el arreglo funciona
+ hospedaje $1 CON folio 'X1', sin CFDI          → []                          estatus CUADRADA
                                                    DEDUC: 'Deducible para ISR' 700 tono 'bueno'
                                                    ACRED: 'IVA acreditable (LIVA art. 5)' $96.55 tono 'bueno'  ← VERDE
```

El mismo renglón de $1 que el motor acaba de clasificar en «Por confirmar» con el
pie *«Falta timbrar la factura»* apaga la única señal del producto sobre el
requisito de soporte de LISR 28-V **y** le quita al IVA su reserva.

**Consecuencia:** el efecto sigue siendo discontinuo y del lado caro, sobre un
dato que controla el operador (mandar una foto con folio legible etiquetada
«hospedaje»). Y ahora apagar la señal ya no es invisible: **mueve una cifra de
tinta neutra a verde**, que es la dirección en la que el papel promete más.

**Causa raíz probable:** «que ampare el hospedaje» se sigue modelando por la
existencia de un renglón, no por que el documento cubra algo.

---

### [MEDIO] Con el SAT caído o en timeout (4 s) el papel imprime «Deducible para ISR $11,600» y «IVA acreditable $1,600» en verde — el mismo tercer estado que el motor sí aplica a EFOS, al RFC y al complemento

`src/lib/cuadra/intake/sat.ts:50`, `:89` (`catch` → `estado: 'pendiente'`) ·
`src/lib/cuadra/cuadre/engine.ts:527-528`, `:150` (`POR_CONFIRMAR` no incluye
`cfdi_pendiente`), `:1084` (`SIN_ACREDITAMIENTO` tampoco) ·
fichas `normas/cff-29-A.yaml` (`evidencia_corroborante`, `texto_vigente: null`) y
`normas/liva-5.yaml` (**`verificado_fuente_primaria`**)

**Medido.** CFDI de $11,600, UUID válido, receptor = RFC de la flota, XML
verificado, IVA $1,600, `FormaPago 03`, `estadoSat: 'pendiente'`:

```
difs: [cfdi_pendiente]    estatus: revisar
ded 11,600 · noDed 0 · porConf 0 · IVA 1,600
DEDUC → [ 'Deducible para ISR' | 11600 | 'bueno' ]                → GREEN
ACRED → [ 'IVA acreditable (LIVA art. 5)' | $1,600.00 | 'bueno' ] → GREEN
```

Control: el MISMO comprobante con `estadoSat: 'no_encontrado'` → `no deducible`
duro. La diferencia entre las dos salidas es que el SAT contestó o no en 4
segundos.

**Por qué lo levanto ahora y el pase 1 no.** El propio motor documenta su criterio
tres veces —`engine.ts:259-268` para el RFC, `:532-533` para el complemento,
`:140-150` para EFOS—: *«no se puede confirmar NI descartar → a revisión. Nunca
deducible, nunca acreditable.»* Este es el único punto donde «no se pudo
verificar» sigue cayendo en `deducible` con el IVA en verde, y es justo el que
depende de un servicio externo notoriamente intermitente. La corrección del EFOS
de esta ronda es la que deja la asimetría a la vista.

**Consecuencia:** una tarde con el `ConsultaCFDIService` lento —lo normal en
cierre de mes— produce liquidaciones enteras afirmadas en verde sin que un solo
UUID se haya confirmado, y el papel no lo dice en la cifra: lo dice en una
observación entre otras cinco. Al operador ni le llega (`resumen.ts:27`,
`cfdi_pendiente` está en `SOLO_CONTRALOR`).

---

### [MEDIO] `operadorRfc` no tiene un solo productor: la rama correcta de RLISR 57 es inalcanzable en producción y todo viático a nombre del operador manda la liquidación a `revisar`

`src/lib/cuadra/cuadre/engine.ts:44`, `:508-514` ·
`src/lib/cuadra/cuadre/desde_db.ts:44-60` (arma el `CuadreInput` y **no** pasa
`operadorRfc`) · `grep -rn "operadorRfc" src/ --exclude=*.test.*` → **dos
apariciones, las dos dentro de `engine.ts`** ·
ficha `normas/rlisr-57.yaml` (**`verificado_fuente_primaria`**) · **NUEVO**
(refuta un renglón de mi propio «lo que está bien» del pase 1)

La ficha funda la rama buena: *«Si benefician a personas que le prestan servicios
personales subordinados, los comprobantes fiscales podrán ser expedidos a nombre
de dichas personas»* — transcrito literal en el comentario de `engine.ts:500-504`.

**Medido.** Hospedaje de $2,000 timbrado al RFC del operador (`CAPJ800101AA1`),
XML verificado, IVA $275.86, `FormaPago 04`, con el RFC de la flota bien
capturado:

```
difs: [viatico_rfc_operador]      estatus: REVISAR
nota: «Viático de Hospedaje timbrado al RFC CAPJ800101AA1. Si es el del operador
       es válido (RLISR 57...) — captura su RFC para confirmarlo.»
```

El único llamador de producción es `cuadrarDesdeDB`, que no pasa el dato, así que
`rfcOperador` es siempre `null` y la rama de `:509` —«Es del operador: correcto
por RLISR 57, no se reporta nada»— **no se puede alcanzar desde WhatsApp ni desde
el panel**. `viatico_rfc_operador` está en `REVISAR` (`:1271`), así que baja el
estatus de toda liquidación con un viático a nombre del chofer.

**Consecuencia:** el caso NORMAL de una flota —el hotel a nombre del operador, que
el reglamento autoriza expresamente— produce una observación permanente que le
pide a la oficina «captura su RFC» sin que exista campo ni pantalla donde
capturarlo, y tiñe de «Por revisar» liquidaciones correctas. No mueve pesos, y por
eso es MEDIO; lo que mueve es la credibilidad del veredicto de estatus, que es lo
primero que el contralor filtra en el panel.

**Causa raíz probable:** el parámetro se diseñó con su prueba y nunca se cableó
desde `desde_db.ts`, igual que `precioDieselPorDefecto` abajo.

---

### [MEDIO] (REINCIDENTE, 6ª ronda) La válvula del 15% de la RFA 2.9 se ofrece a cualquier tenant: las dos condiciones de aplicación de la ficha no se capturan en ningún lado, y la nota las da por cumplidas en indicativo

`src/lib/cuadra/cuadre/engine.ts:352-361` (la nota) · `:334` ·
`src/lib/cuadra/periodo/combustible.ts:130-161` ·
`src/lib/cuadra/config.ts:44-49` y `:93-99` (`estimulos` no tiene régimen ni
dedicación) · `grep -rn "regimen\|dedicacion\|exclusiv" src/lib/cuadra/config.ts
src/types/cuadra.ts supabase/migrations/` → **cero** ·
ficha `normas/rfa-2026-2.9.yaml` (**`verificado_fuente_primaria`**, leída en el
DOF/SIDOF)

Texto de la ficha, literal, con el sujeto que el código no comprueba:

> «**Los contribuyentes personas físicas o morales, dedicados exclusivamente al
> autotransporte terrestre de carga federal, que tributen conforme al Título II,
> Capítulo VII o Título IV, Capítulo II, Sección I de la Ley del ISR**,
> considerarán cumplida la obligación establecida en el artículo 27, fracción III,
> segundo párrafo de la Ley del ISR, cuando los pagos por consumo de combustible se
> realicen con medios distintos a... siempre que estos no excedan el 15 por
> ciento...»

y `condiciones_de_aplicacion`, las dos primeras: *«Dedicados EXCLUSIVAMENTE al
autotransporte terrestre de carga federal»* · *«Tributar en Título II Cap. VII
(coordinados) o Título IV Cap. II Secc. I (PF act. empresarial)»*.

**Medido.** Diésel de $5,400, CFDI y XML impecables, `FormaPago 01`:

```
difs: [combustible_efectivo, sobre_politica, permiso_cre_no_verificable]
nota: «...cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026
       regla 2.9). Dentro del 15% SIGUE SIENDO DEDUCIBLE; el excedente no.»
```

Y el contador del ejercicio, sobre una flota con $1,000,000 de combustible y
$120,000 fuera de la lista cerrada:

```
evaluarTope15 → { razon: 0.12, estado: 'cerca', margen: 35,294.11 }
avisoTope15   → «...te quedan $35,294.11 antes de perder la deducción...»
```

Para una flota que **no** califica —una persona moral del Título II régimen
general que mueve su propia carga, o cualquier tenant que aún no declara su
régimen: el estado de todos hoy— esas dos frases son falsas en direcciones
opuestas y ambas caras. La primera le promete deducibles $5,400 que por LISR
27-III, 2º párrafo, sin la facilidad no lo son. La segunda le **autoriza en pesos**
gastar $35,294.11 más por un medio que para ella no deduce ni un peso.

**Consecuencia:** es la pieza que `FISCAL_LEGAL.md:60` llama la de más valor para
el contralor, y se activa sin preguntar si el cliente cae bajo la regla. El propio
`FISCAL_LEGAL.md:239` lo tiene declarado como pendiente («Régimen de cada flota»),
así que el hueco es conocido y sigue sin capturarse.

**Causa raíz probable:** la facilidad se implementó por su efecto (el 15%) y no
por su sujeto; el tenant no tiene dónde declarar régimen ni dedicación.

---

### [BAJO] (REINCIDENTE) `precioDieselPorDefecto` no vive dentro de `estimulos`, así que la banda anti-decimal-corrido siempre usa el literal `27.0` y el valor del tenant nunca llega

`src/lib/cuadra/config.ts:30` y `:74` (vive en `tabulador`) contra `:93-99`
(`estimulos` no lo declara) · `src/lib/cuadra/cuadre/desde_db.ts:53`
(`estimulos: config.estimulos`) · `src/lib/cuadra/cuadre/engine.ts:1181`
(`input.estimulos?.precioDieselPorDefecto ?? 27.0`) ·
ficha `normas/lif-2026-20-A.yaml` (`evidencia_corroborante`)

`engine.ts:1173-1180` explica que la banda 0.5×–2× existe para atrapar el decimal
corrido en los litros, que es el número que el contador multiplica por la cuota
del DOF. El único llamador de producción entrega `config.estimulos`, donde el
campo no existe.

**Escenario.** Tenant que captura `precioDieselPorDefecto: 14.0` (diésel
subsidiado de flota con contrato). Ticket de $5,400 leído como **760 L** (el OCR
corrió el decimal de 76.0). Con el precio del tenant, esperados ≈ 386 L → razón
1.97, dentro de la banda por poco. Con el literal 27.0, esperados 200 L → razón
3.8 → `diesel_desviacion` y no se acreditan. Y al revés con un precio alto: el
tenant que ponga 40.0 pierde la protección que él mismo configuró. En los dos
casos la cifra que se mueve son litros que el contador convierte a pesos con la
cuota semanal ($2.09–$7.36/L según `criterio-1-LIF-PI`).

**Consecuencia:** la banda que protege el número más caro del estímulo se calibra
con una constante del código, no con el dato del cliente, y el panel de
configuración (`dashboard/configuracion/page.tsx:95`) le enseña al contralor el
valor que él capturó como si estuviera en uso.

---

### [BAJO] (REINCIDENTE) El denominador del 15% filtra `concepto = 'diesel'` mientras el motor define combustible con dos criterios

`src/lib/cuadra/repo.ts:826` (`.eq('concepto', 'diesel')`) contra
`src/lib/cuadra/cuadre/engine.ts:324`
(`g.concepto === 'diesel' || h.claves.includes(g.claveProdServ ?? '')`) ·
ficha `normas/rfa-2026-2.9.yaml` (**`verificado_fuente_primaria`**)

La regla habla de *«el total de los pagos efectuados por consumo de combustible
para realizar su actividad»*, sin acotarlo a un concepto interno nuestro.

**Escenario.** Flota que carga magna en un tramo (clave `15101514`, dentro de
`hidrocarburos.claves`) y cuyo gasto se guardó con el concepto `otro` o `factura`
—p. ej. el XML llegó pegado a un ticket que el OCR clasificó como `factura`, o el
gasto se dio de alta antes del XML—. $150,000 de ese combustible al año quedan
fuera **del numerador y del denominador**: una flota con $850,000 de diésel de los
que $120,000 caen fuera de la lista sale en 14.1% (`cerca`, aviso) cuando sobre el
millón real va en 12.0%, o al revés si lo omitido era efectivo. El motor por viaje
sí lo cuenta como combustible; el contador del ejercicio no.

**Consecuencia:** las dos mitades del producto siguen contestando distinto sobre
el mismo gasto, que es exactamente lo que el arreglo G-04 vino a cerrar en la otra
mitad de la consulta (`repo.ts:841-847`). El aviso que decide si el contralor
cambia de medio de pago se calcula sobre una base que no es la de la regla.

---

## La decisión humana pendiente, dimensionada (no re-litigada)

**Base del 50% del peaje — `acreditable.ts:47-49`, hallazgo H4 de
`lif-2026-20-A.yaml` (`severidad: alta`, `estado: SIN RESOLVER`).** La ley dice
*«hasta en un 50 por ciento del **gasto total erogado** por este concepto»*; el
motor usa `g.subTotal * 0.5`.

Sobre la caseta del demo (`seed.sql:128`: total $1,400, subtotal $1,206.90, IVA
$193.10), medido:

```
base actual  (subtotal sin IVA)  →  $603.45
base «gasto total erogado»       →  $700.00
diferencia por caseta            →   $96.55   (+16.0% sobre lo que hoy se imprime;
                                               −13.79% mirado al revés, que es la
                                               cifra que el PDF ya declara al pie)
```

Extrapolado: una flota con $2,000,000 anuales de casetas facturadas ve **$862,072
contra $1,000,000** de estímulo — **$137,928 al año** de diferencia. El conflicto
que la ficha anota es real (tomar el total puede duplicar el beneficio del IVA,
que ya se acredita por `LIVA art. 5`), así que sigue siendo pregunta de contador.
**Lo que el producto hace hoy es lo correcto mientras no se decida:** el PDF
imprime cuál de las dos bases usó y cuánto sube con la otra
(`BASE_ESTIMULO_PEAJE`). Lo anoto para que el número con el que se decide esté a
la vista, no para reabrirlo.

---

## Lo que revisé y está bien

Esto vale tanto como los hallazgos, y esta vez es la mitad larga del reporte.

- **CERRADO, el CRÍTICO A11-FISCAL-1 (EFOS).** `engine.ts:150` mete
  `cfdi_efos_indeterminado` en `POR_CONFIRMAR` y `:1084` en `SIN_ACREDITAMIENTO`.
  Medido con el mismo caso del pase 1 (factura $11,600, `efosRevisar: true`, IVA
  $1,600): `porConfirmar 11,600 · deducible 0 · IVA 0`, `DEDUC → ['Por confirmar',
  11600, 'pendiente']`, **`ACRED → null`** (la sección entera desaparece). Antes
  salía `Deducible para ISR $11,600` en verde con $1,600 de IVA. El comentario de
  `:140-149` documenta el razonamiento contra `cff-69-B.yaml`
  (`verificado_fuente_primaria`, 3er párrafo: *«no producen ni produjeron efecto
  fiscal alguno»*) y elige bien el tercer estado: ni fraude declarado, ni deducción
  afirmada. `sat.ts:82` sigue sin poder emitir `efos: true`, y ahora eso ya no es
  un agujero.
- **CERRADO, el CRÍTICO del RFC del demo.** `supabase/seed.sql:26` y
  `api/demo/route.ts:36` traen `TIN010101AA5`. Reimplementé el algoritmo de
  `cfdi.ts:53-74` y lo corrí: `TIN010101AAA` → dígito esperado `5`, tenía `A`
  (rechazado); `TIN010101AA5` → **válido**. Medido con los dos gastos exactos del
  seed: `deducible 5,600 · IVA 774.48 · peaje 603.45`, y la sección ACREDITABLE
  aparece. Los dos ficheros usan el MISMO literal, con el comentario que explica
  por qué (`route.ts:33-36`).
- **CERRADO, el ALTO de LISR 27-III.** `engine.ts:101-108` declara
  `MEDIOS_LISR_27_III` como **lista cerrada** (`02,03,04,05,28,29`) y `:351` la usa
  por complemento. Barrido medido sobre el diésel de $5,400 / 200 L:
  `FP 01, 99, 15, 17` → `porConfirmar 5,400 · IVA 0 · litros 0 · estatus revisar`;
  `FP 03, 29` → `deducible 5,400 · IVA 744.83 · litros 200`. El `99` (PPD) y la
  condonación ya no pasan. El comentario de `:335-350` cita el texto de la ficha y
  explica por qué `01` es duro (`efectivo_sobre_tope`) y los demás van a por
  confirmar (`medio_pago_sobre_tope`, tipo nuevo): el efectivo es un hecho
  consumado, el PPD todavía no ocurrió. Es la lectura correcta del 1er párrafo.
- **CERRADO, el ALTO del estímulo de diésel (LIF 20-A).** `engine.ts:1163-1171`
  declara `MEDIOS_LIF_20A` con los mismos seis códigos y `pagoElectronico` ya es
  pertenencia, no negación. Medido: `FP 99/15/17` → **0 litros**. Y lo mejor:
  `lif-2026-20-A.yaml` ahora trae la sección `requisito_medio_de_pago` con
  `texto_vigente: null`, `estado_transcripcion: sin_transcribir`,
  `procedencia_real` («decisión de ingeniería... NO se leyó en fuente primaria») y
  `codigos_c_formapago: ["02","03","04","05","28","29"]`, atada al motor por
  `cuadre/medios_lif_con_ficha.test.ts`. Es la respuesta honesta a mi BAJO del pase
  1: no se inventó el párrafo, se declaró que no se tiene.
- **CERRADO, el ALTO del contador del 15%.** `periodo/combustible.ts:45-69`
  define su propia `MEDIOS_LISR_27_III` y `cuentaContraTope15`, y `repo.ts:847` la
  usa. Medido: $1,000,000 de combustible con $200,000 en `FP 99` → `razon 0.20 ·
  estado 'excedido' · excedente $50,000` y el aviso sale (antes: `holgado`, aviso
  `null`). El rótulo también se corrigió (`aviso.ts:26`: ya no dice «Diésel en
  efectivo»). Y `repo.ts:818-863` pagina con `count: 'exact'` y **lanza** si leyó
  menos filas de las que hay: un denominador recortado por `max_rows` ya no se lee
  como una flota holgada.
- **CERRADO, el MEDIO del margen del 15%.** `combustible.ts:160` despeja bien la
  desigualdad con la variable en los dos lados y **trunca** en vez de redondear.
  Medido: $1,000,000 / $120,000 → `margen 35,294.11` (antes $30,000). El
  comentario de `:154-159` explica por qué el centavo va hacia abajo. Impecable.
- **CERRADO, el ALTO del IVA por WhatsApp (`0492635`).** Seguí la cadena hasta el
  consumidor real, que es lo que el MAPA pide: `acreditable.ts:144`
  (`motivosQueCondicionanElIva`) tiene **dos** llamadores —`filasAcreditables:191`
  (PDF) y `resumen.ts:111` (WhatsApp)— y el literal de la reserva se importa en
  vez de escribirse (`RESERVA_IVA_ATADO_AL_ISR`, `RESERVA_PEAJE`). Medido en el
  caso del demo: PDF y WhatsApp condicionan el IVA por el mismo motivo, con la
  misma función.
- **CERRADO, el MEDIO del `viaticos` genérico.** `engine.ts:956`
  (`conTope = (c) => c === 'alimentacion'`) y el bloque de `:1043-1061`, que avisa
  con `monto: 0` y una nota que dice por qué no descuenta. Coincide con
  `confirmado_del_codigo` de `lisr-28-V.yaml`: *«Solo alimentación; el hospedaje
  nacional no tiene tope»*. El hotel de $2,000 guardado como `viaticos` ya no sale
  con «$1,250 no deducibles».
- **CERRADO, el MEDIO de los plazos de portal.** `engine.ts:764-766`: el matiz
  legal —*«no de la ley: legalmente puedes exigir la factura dentro del
  ejercicio»*— está ahora en **las cuatro ramas**, no solo en la de
  `plazoVerificado`. Conté hoy el catálogo: `plazoVerificado: true` en **4**
  entradas, `false` en **34**; las 34 caen en la rama que dice *«fin del mes de la
  compra, no de la ley... y legalmente puedes exigir la factura dentro del
  ejercicio»*. Es literalmente lo que exige el `advertencia_de_jerarquia` de
  `politica-portales-plazos.yaml` (`sin_verificar`).
- **CERRADO, el MEDIO del estado de verificación en runtime.**
  `normas/indice.ts:65-67` añade `puedeAfirmar()` con los **tres** estados
  (`si | condicionado | no`), y `tools.ts:114-116` y `:178-180` mandan al agente
  `verificacion` (el hecho auditable) **y** `afirmar` (lo accionable). El booleano
  que colapsaba tres estados en dos ya no existe. Es lo que el pase 1 dijo que
  impedía llegar a 8, y se movió.
- **CERRADO, el MEDIO de `FISCAL_LEGAL.md`.** `:52` y `:228` ya dicen **por
  ejercicio**, y `rfa-2026-2.9.yaml:usado_en_codigo` incorpora los dos párrafos
  del documento comercial, que es el campo con el que se calcula el radio de
  impacto si la RFA 2027 mueve el 15%.
- **El estímulo de IEPS sigue SIN calcularse con el IEPS trasladado.**
  `engine.ts:1090` (`const iepsAcreditable = 0`, con el comentario que explica por
  qué es `const`) y `:1121-1197` cuentan **litros**. Medido: sobre el CFDI del seed
  con `iepsTraslado 408.62`, la salida es `ieps 0` y ninguna superficie imprime
  esos $408.62. El error que el rubro nombra como ejemplo canónico —confundir el
  IEPS trasladado del CFDI con el estímulo del LIF 20-A— **no está aquí**, y es la
  pieza que más me costaría reemplazar.
- **LIVA 5-I, proporcionalidad.** El bloque de acreditamiento corre DESPUÉS del
  tope diario (`engine.ts:1066-1071`, con el comentario que explica el orden), y
  `:1116-1118` aplica `proporcionDeducible`. Es el caso que la propia
  `nota_verificacion` de `liva-5.yaml` pone como ejemplo.
- **Las tres cubetas siempre suman el comprobado**, con portón en
  `deducibilidad.ts:54-55` (tolerancia 1.5 centavos, si no cuadra no se imprime el
  desglose). Medido en los ocho escenarios de mi batería: cuadra en los ocho.
- **Las leyendas citan lo que la norma sí dice.** `cuadre/leyendas.ts:36-58`
  contra `cff-89-90.yaml` (**`verificado_fuente_primaria`**, transcrito del PDF de
  diputados, última reforma DOF 09-04-2026): la frase «puede diferir de los
  criterios que dé a conocer el SAT» es literalmente la conducta que el último
  párrafo del art. 89 nombra como eximente de la infracción de la fracción I, y la
  referencia al art. 52 CFF («no constituye un dictamen») es correcta. Volví a
  buscar una cita que no dijera lo citado en `leyendas.ts`, `acreditable.ts`,
  `deducibilidad.ts` y las notas de `engine.ts`, y no la encontré.
- **Extracción de impuestos del XML.** `cfdi_xml.ts:141-153`: IVA `002` e IEPS
  `003` se suman de `Impuestos/Traslados` tal como vienen, y `engine.ts:1100`
  exige `xmlVerificado` antes de acreditar: nunca se recomputa con una tasa
  asumida, así que el 8% fronterizo sale del papel. Medido sobre el XML del seed:
  `iepsTraslado 408.62 · ivaTraslado 581.38`, idénticos al comprobante.
- **El interruptor del complemento de hidrocarburos.** `engine.ts:550-594` +
  `indice.ts:326` (`exigibleDesde: null` para `rmf-2026-2.7.1.48`): con la fecha
  sin respaldo el motor emite `complemento_no_verificable` (revisión) y **no**
  declara no deducible. La fecha que decide dinero sale de la ficha, no de
  `config.ts`. Sigue siendo el mejor mecanismo del rubro.
- **`SOLO_CONTRALOR`** (`resumen.ts:25-34`) filtra bien, y
  `complemento_no_verificable` sigue **fuera** de la lista con la razón escrita
  (`:36-43`): es lo único que el operador puede resolver.
- **`alimentacion_transporte_sin_tarjeta_credito`** (`engine.ts:906-919`) exige
  `formaPago === '04'` — crédito, no débito (`28`) —, que es exactamente lo que
  dice la 3ª oración del 2º párrafo de `lisr-28-V.yaml`. Débito no cuela.
- **`rfa-2026-2.2` (el 8%, «gasto ciego»)** sigue con `usado_en_codigo: []` y
  grepeado no se ofrece en ningún lado. Correcto: la regla excluye combustible.
- **El simulador de `/demo`** no imprime ninguna cifra acreditable ni deducible
  (`api/demo/route.ts:120-126` devuelve solo comprobado, anticipo, diferencia,
  estatus y diferencias), así que la puerta que corre sin `xmlVerificado` no puede
  enseñar un cero fiscal. Y ya recibe `DEMO_CONFIG.estimulos` y
  `DEMO_CONFIG.hidrocarburos`, así que el tope de LISR 28-V corre por las dos
  puertas igual.
- **Detalles que miré y no son hallazgo:** `indice.ts:147` tiene
  `titulo: ">"` para `criterio-1-CFF-PI` (el marcador de bloque YAML se coló al
  transcribir); `titulo` no lo consume nadie —grepeado— así que no llega a
  ninguna pantalla ni al agente, y no puedo escribirle un escenario en pesos. Y
  `acreditable.ts:156` produce «depende de **el** permiso CRE» (concordancia) en
  un pie que el contralor lee.

---

## Fichas no verificables en esta ronda

Sin red: `curl` a `diputados.gob.mx` responde `CONNECT tunnel failed, response
403` (comprobado hoy), igual que las cinco corridas de
`normas/.latido-vigilancia`. No asumo que estén bien ni que estén mal:

- **`lif-2026-20-A` bajó a `evidencia_corroborante`** (corregido en la auditoría
  10) y su `requisito_medio_de_pago.texto_vigente` es `null`. De ella cuelgan
  **las tres cifras** de la sección que vende: litros de diésel, 50% de peaje y la
  lista de medios de pago. Que estén las tres en `tono: 'condicionado'` es la
  presentación que ese estado pide, y el código lo cumple — pero mientras siga así,
  el ancla de 8+ («cada cifra fiscal impresa rastrea a una ficha
  `verificado_fuente_primaria`») **no se puede alcanzar**. Cerrarla es una tarea de
  red, no de código.
- **`lisr-28-V` también bajó a `evidencia_corroborante`** (cuatro reproducciones
  coincidentes, no el original). Sostiene el $750/día, que es el número más impreso
  del producto.
- `cff-29-A` (`texto_vigente: null`, `evidencia_corroborante`) — funda **cinco**
  veredictos en `por_diferencia.ts:32,45,50,51,52`, tres de ellos
  (`rfc_receptor`, `cfdi_cancelado`, `cfdi_no_encontrado`) dentro de
  `NO_DEDUCIBLE_ISR`. **El veredicto duro sigue apoyado en una ficha sin texto**, y
  es la deuda más vieja del rubro.
- `criterio-1-CFF-PI` y `criterio-1-LIF-PI` (`texto_vigente: null`).
- `rmf-2026-2.7.1.21` (`texto_vigente: null`) y `rmf-2026-2.7.1.48`
  (`evidencia_corroborante`, exigibilidad sin confirmar — correctamente tratada
  como `null` por el código).
- `politica-portales-plazos` (`sin_verificar`, jerarquía 6). Sigue sostiendo la
  fecha que el producto imprime, ahora con el matiz legal en las cuatro ramas.
- `lisr-27-III` (`evidencia_corroborante`, «NO se leyó en diputados.gob.mx»). Para
  los hallazgos que la usan me apoyé en `rfa-2026-2.9`, que **sí** es
  `verificado_fuente_primaria` y reproduce la misma lista cerrada.
- **`normas/cuota-ieps-diesel.yaml` sigue sin existir** (`.latido-cuota-diesel`,
  bloqueado por egreso desde el 1-ago). No hay cuota semanal registrada para
  ninguna fecha. Es coherente con entregar litros y no pesos, y es la razón por la
  que esa decisión debe sostenerse.
- **Duda que dejo abierta otra vez, no hallazgo:** la enumeración de la RFA 2.9
  (`verificado_fuente_primaria`) **omite la transferencia electrónica** de la lista
  de medios que sí cumplen, mientras el 1er párrafo de LISR 27-III
  (`evidencia_corroborante`) sí la incluye. El código trata `FormaPago 03` como
  plenamente conforme por LISR 27-III, lo cual es coherente —quien cumple la ley no
  necesita la facilidad—, pero no lo puedo dictaminar sin leer el DOF.
- **Segunda duda:** `liva-5.yaml` transcribe **solo las fracciones I y II**, y el
  producto imprime el rótulo «IVA acreditable (LIVA art. 5)» a secas. El artículo
  tiene más fracciones (entre ellas el requisito de que el IVA haya sido
  *efectivamente pagado*), que la ficha no trae. Un hospedaje de $1,500 con
  `FormaPago 99` —bajo el tope de $2,000, así que no levanta
  `medio_pago_sobre_tope`— acredita hoy su IVA completo. **No construyo hallazgo
  sobre eso porque no tengo el texto**; lo dejo anotado porque es la misma
  dirección de fallo que el `cfdi_pendiente` de arriba.

---

## Lo que NO alcancé a revisar

- **No generé un PDF.** Verifiqué con el motor real las estructuras que le llegan
  (`filasDeducibilidad`, `filasAcreditables` con sus tonos y pies) y leí `pdf.ts`
  entero —incluido `:295` y `:348`, que son los dos sitios donde el tono se
  convierte en color—, pero no miré el papel renderizado. El MAPA pide mirar el
  render y no lo hice; para el hallazgo del `[id]` me apoyé en `Tot`
  (`page.tsx:328-336`, `ok → var(--color-ok)`), que no deja lugar a duda.
- **`facturacion/permiso_cre.ts`** (12,625 permisos en `permisos_cre.json`):
  sigue sin consumidor fuera de su propia prueba —grepeado— mientras
  `engine.ts:605-622` emite `permiso_cre_no_verificable` en TODO CFDI de
  combustible con XML. No evalué si la tabla podría cerrar ese aviso, ni si su
  calidad lo permite (su propio encabezado documenta que de dos comprobaciones
  reales una no supo y la otra mintió).
- **La ventana temporal del contador del 15%.** `repo.ts:827-828` filtra el año
  natural completo; la RFA 2026 entra en vigor el 18-feb y el Transitorio Primero
  sigue sin leerse. No lo puedo dictaminar sin fuente.
- **Qué pasa al superar el 15%.** `combustible.ts:149` y `aviso.ts:47` afirman en
  pesos que solo el **excedente** deja de ser deducible. El texto de la ficha
  redacta el 15% como **condición** («siempre que estos no excedan»), lo que admite
  la lectura más dura: superado el umbral, la facilidad no aplica a ningún pago.
  Es la interpretación que decide más dinero de todo el módulo, y sigue sin criterio
  del SAT que la resuelva. No lo reporto porque no puedo escribir cuál de las dos
  lecturas es la correcta.
- **`intake/ocr.ts`, `decidir.ts`, `emparejar.ts`:** la clasificación de concepto
  decide qué regla fiscal aplica (el tope de LISR 28-V, el estímulo del peaje, el
  contador del 15%). No audité el prompt del OCR ni sus umbrales.
- **El emisor.** `engine.ts` no le pasa el RFC del emisor por `rfcChecksumOk`;
  medido, el del seed (`ENE160518AB1`) **falla** el dígito verificador (esperado
  `3`). Es dato de demo y no mueve ninguna cifra, así que no lo levanto — pero la
  ruta de validación del emisor no existe.
- **Las 4 fichas de LFPDPPP** son del rubro legal.
