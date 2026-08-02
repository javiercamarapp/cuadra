# Cumplimiento fiscal — auditoría 9

**Nota: 5/10** (antes 4). Razón del movimiento: **se atacó y subió**, con una
corrección de encuadre. Los dos CRÍTICOS de la ronda 8 que dependían de código
—CFDI sin RFC receptor, y los litros del estímulo sin cotejar— los verifiqué
**corriendo el motor real**, no leyéndolo, y los dos cerraron. El tercero
(el tope de $750/día repartido contra pesos que no son deducción de nadie)
cerró **el dinero y no la frase**: la nota que se imprime sigue afirmando un
"no deducible" que el desglose de la misma página niega. El ALTO del permiso
CRE se atendió con un aviso honesto, pero el renglón verde no cambió. Y al
abrir dos caminos que ninguna ronda había abierto —el tercer párrafo de LISR
28-V y `intake/sat.ts`— salieron dos rutas nuevas por las que el producto
imprime hoy una cifra fiscal equivocada. No sube más porque el ancla es
explícita; no baja porque las dos rutas nuevas son **más angostas** que las dos
que se cerraron, y porque la trazabilidad cifra→ficha sigue siendo real
(1,436 pruebas verdes, `tsc` en 0, `normas_sincronizadas.test.ts` sujetando el
índice contra los YAML, y el estímulo de diésel todavía en litros y no en
pesos).

El riesgo mayor del rubro, hoy: **el papel imprime "Deducible para ISR" en
verde sin que exista siquiera un tono `condicionado` para esa cubeta — la regla
que el propio repo escribió para las afirmaciones que el motor no sostiene
entera (`acreditable.ts:9-11`) se aplicó a la cifra chica (peaje, $500) y no a
la grande (deducible, $5,800).**

---

## Veredicto sobre el cambio grande de la ronda (`7301adc`, permiso CRE)

Se pidió evaluarlo, y la respuesta tiene dos mitades distintas.

**El VEREDICTO es defensible; la IMPRESIÓN no.** Avisar sin fingir un dictamen
que no se puede sostener es la decisión correcta, y la nota lo dice sin
adornos ("El sistema todavía no lo valida"). Pero la analogía con EFOS y con el
complemento de hidrocarburos —el argumento del commit— no se sostiene entera:
en esos dos, el hecho vive **fuera** del alcance del sistema (una lista del SAT
que no consultamos con certeza; una fecha de exigibilidad que nadie ha
confirmado). El permiso CRE vive **dentro del XML que el motor ya tiene
abierto**: `g.xmlVerificado === true` es precondición del aviso
(`engine.ts:415`). "No se puede verificar" es, con precisión, "no está escrito
el parser". Eso no invalida la decisión —adivinar el atributo sería peor— pero
sí cambia lo que se puede imprimir al lado.

Lo que no es defensible es que, después del aviso, el renglón siga saliendo
`Deducible para ISR $5,800.00` en **verde y sin calificador**, cuando una de
las cuatro `condiciones_de_aplicacion` de la facilidad que el mismo papel cita
está sin verificar. El repo ya resolvió cómo se imprime eso y lo escribió como
regla; lo aplicó al peaje y no aquí. Ver el hallazgo [ALTO] correspondiente.

`facturacion/permiso_cre.ts` **sigue sin un solo consumidor** fuera de su
propia prueba (verificado con `command grep`, no con el `grep` que salta
binarios): 12,625 permisos cosechados, cero llamadas desde el motor, el intake
o el processor. El commit lo dice y lo asume; lo dejo anotado como hecho, no
como reproche.

---

## Hallazgos

### [ALTO] LISR 28-V, tercer párrafo: una comida amparada SOLO por transporte y pagada sin tarjeta de crédito sale "Deducible" en verde, estatus `cuadrada`, y sin una sola observación

`src/lib/cuadra/cuadre/engine.ts:643` · `:644` · `:696-761` (el bloque del tope
diario, que sí conoce `formaPago` y no lo mira)

**Norma comparada** — `normas/lisr-28-V.yaml:26-29`
(`estado_verificacion: verificado_fuente_primaria`, `:32`), tercera oración del
segundo párrafo, literal:

> "Cuando a la documentación que ampare el gasto de alimentación el
> contribuyente únicamente acompañe el comprobante fiscal relativo al
> transporte, la deducción a que se refiere este párrafo sólo procederá cuando
> el pago se efectúe mediante tarjeta de crédito de la persona que realiza el
> viaje."

La ficha lo declara como hallazgo abierto `H2` (`:59-65`,
`que_hace_el_motor: "No valida el medio de pago en ese supuesto."`,
`severidad: media`). Ninguna ronda lo había medido contra el motor.

`engine.ts:643` da por amparada la comida en cuanto existe **cualquier** gasto
de `hospedaje` o `transporte` en el viaje, y ahí termina la evaluación: no hay
segunda rama para el caso en que lo único que la ampara es el transporte.

Escenario (corrido con `cuadrarViaje` real, `DEMO_CONFIG`,
`empresaRfc: 'EMP010101AA2'`):

```
entra: alimentación $700.00, CFDI + XML al RFC de la empresa, IVA $96.55,
       formaPago '01' (EFECTIVO)
       transporte   $450.00, CFDI + XML, IVA $62.07
       (sin hospedaje en toda la liquidación)

sale:  Deducible para ISR      $1,150.00   ← VERDE
       No deducible                 $0.00
       Por confirmar                $0.00
       IVA acreditable (LIVA art. 5)  $158.62   ← VERDE
       estatus: cuadrada
       diferencias: NINGUNA
```

Con `formaPago '28'` (tarjeta de **débito**) el resultado es idéntico, y el
débito tampoco cumple el párrafo: la ley pide tarjeta de **crédito** de quien
viaja.

**Consecuencia:** por el tercer párrafo, la deducción de los $700 **no
procede**, y por `normas/liva-5.yaml:19-24` (`verificado_fuente_primaria`) su
IVA tampoco se acredita —"se consideran estrictamente indispensables las
erogaciones… que sean deducibles para los fines del impuesto sobre la renta"—.
El producto los imprime como $700 de deducción y $96.55 de IVA recuperable, en
verde, con el artículo citado, y además cierra el viaje como `cuadrada`: el
contralor no recibe ni siquiera la señal de revisar. Es la única de las tres
oraciones del párrafo que el motor no implementa, y es la que quita dinero.

**Causa raíz probable:** `haySoporte` se escribió como booleano ("¿hay algo que
ampare?") cuando la ley distingue **qué** ampara: hospedaje abre la deducción
sin condición de medio de pago, transporte solo la abre con tarjeta de crédito
del viajero. El arreglo de `flete` (28-jul) afinó *qué conceptos cuentan* y
dejó intacto el hecho de que los dos que cuentan no cuentan igual.

---

### [ALTO] Un emisor solo PRESUNTO en el 69-B se declara "lista negra" y tira la deducción entera: $30,000 a "No deducible" en rojo

`src/lib/cuadra/intake/sat.ts:68` · `:73-75` · `src/lib/cuadra/cuadre/engine.ts:383-384`
· `engine.ts:85` (`NO_DEDUCIBLE_ISR` incluye `cfdi_efos`)

`sat.ts:68` es, literalmente:

```ts
const EFOS_EN_LISTA = new Set(['100']); // presunto/definitivo 69-B (documentado)
```

El propio comentario admite que ese código **conflaciona presunto y
definitivo**, y acto seguido lo mapea a `efos: true`, que en `engine.ts:383`
produce `cfdi_efos` → `NO_DEDUCIBLE_ISR` (veredicto duro, tinta roja).

**Norma comparada** — `normas/cff-69-B.yaml`
(`estado_verificacion: verificado_fuente_primaria`, `:20`; texto transcrito del
PDF de diputados, última reforma DOF 09-04-2026). El efecto duro está atado
**solo** al listado definitivo del cuarto párrafo (`:13`):

> "Los efectos de la publicación de este listado serán considerar, con efectos
> generales, que las operaciones contenidas en los comprobantes fiscales
> expedidos por el contribuyente en cuestión no producen ni produjeron efecto
> fiscal alguno."

Del listado presuntivo, el primer párrafo solo dice "se **presumirá** la
inexistencia" (`:9`), y la propia ficha lo subraya dos veces:
`:38-39` — *"El estado 'presunto' (listado provisional) y el 'definitivo'
tienen efectos distintos, y el producto los distingue con
`cfdi_efos_indeterminado`"* — y `:32-35` — *"Lo que NO dice, y el producto no
debe insinuar: que el receptor pierda automáticamente y sin remedio."*

Las dos afirmaciones de la ficha son falsas contra el código: `cfdi_efos_
indeterminado` se emite **solo** para códigos que `sat.ts` no reconoce
(`:77`), nunca para un presunto; y la nota que se imprime es exactamente la
insinuación prohibida.

Escenario (corrido con el motor real):

```
entra: CFDI $30,000.00, XML verificado, receptor = RFC de la empresa,
       estadoSat 'vigente', IVA $4,137.93, emisor devuelto por el SAT con
       ValidacionEFOS = 100 (presunto, listado provisional del 1er párrafo)

sale:  Deducible para ISR      $0.00
       No deducible       $30,000.00   ← ROJO
       IVA acreditable         $0.00
       nota impresa: "El emisor del CFDI de Factura está en lista negra del
                      SAT (EFOS) — no deducible."
```

**Consecuencia:** al contribuyente presunto le quedan los plazos del propio
art. 69-B para desvirtuar, y al receptor los treinta días para acreditar que la
operación existió. Likida le dice al contralor, por escrito y en un documento
que se archiva, que ya perdió $30,000 de deducción y $4,137.93 de IVA, y que su
proveedor está en "lista negra". Si el proveedor desvirtúa —que es el resultado
normal de una parte de los presuntos— la afirmación era falsa las dos veces: la
del dinero y la del proveedor. Y es el veredicto más caro que emite el motor.

**Causa raíz probable:** `sat.ts` se escribió con el criterio correcto para el
eje "no marcar fraude por descarte" (`:62-65`) y no con el criterio para el eje
"presunto ≠ definitivo". El servicio del SAT no distingue los dos con códigos
distintos, y el código resolvió la ambigüedad hacia el lado duro en vez de
hacia el tercer estado que ya tenía escrito al lado.

---

### [ALTO] El tope de $750/día: cerró el dinero, no la frase. El papel imprime "$1,250.00 no es deducible" en la misma página donde el desglose dice No deducible $0.00

`src/lib/cuadra/cuadre/engine.ts:757` (la nota) · `:713` (`exceso`) · `:740-745`
(la proporción, ya corregida) · `src/lib/cuadra/liquidacion/pdf.ts:288-302`
(el desglose) · `pdf.ts:409-424` (las diferencias, con `mxn(d.monto)` a la
derecha)

`43ebf41` arregló lo que audit 8 midió: la proporción del IVA y de la cubeta
ahora se calcula **solo entre los timbrados del día** (`:740-743`), y lo
verifiqué corriendo el motor — el caso que salía "$194.44 deducibles" hoy sale
correcto. Lo que no se tocó es `exceso` (`:713`), que se sigue calculando sobre
`total`, es decir sobre **todos** los comprobantes del día, timbrados o no; y
esa cifra es la que viaja al papel en `nota` y en `monto`.

**Norma comparada** — `normas/lisr-28-V.yaml:21-25`
(`verificado_fuente_primaria`): *"Tratándose de gastos de viaje destinados a la
alimentación, éstos sólo serán deducibles hasta por un monto que no exceda de
$750.00 diarios por cada beneficiario"*. El tope acota la **deducción**; un
comprobante que todavía no es deducción de nadie no genera "excedente no
deducible" hoy.

Escenario (corrido con el motor real, `viaticosTopeFiscalDiarioMxn: 750`):

```
entra (20-jul): alimentación $1,200.00 SIN CFDI
                alimentación   $800.00 SIN CFDI
                hospedaje          $1.00 SIN CFDI

el PDF imprime, en la MISMA hoja:
   Total comprobado                      $2,001.00
     Por confirmar                       $2,001.00
     (no hay renglón de "No deducible": es $0.00)
   …
   DIFERENCIAS DETECTADAS
   • Alimentación del 2026-07-20: $2,000.00 (2 comprobantes del día) excede
     el tope fiscal de $750.00 por día (LISR 28-V) — el excedente de
     $1,250.00 no es deducible.                              $1,250.00
```

Con el día mixto ocurre lo mismo con otras cifras: $700 timbrado + $2,000 sin
timbrar + $900 de hospedaje timbrado da `Deducible $1,600.00 · Por confirmar
$2,000.00 · No deducible $0.00` y, debajo, "el excedente de **$1,950.00** no es
deducible" con $1,950.00 en la columna de importes.

**Consecuencia:** el contralor hace la cuenta con una calculadora —las tres
cubetas suman el comprobado, correcto— y encuentra $1,250 que la prosa declara
perdidos y que ningún renglón contiene. En una sala, esa es la pregunta que se
hace en voz alta. Es la mitad no cerrada de un CRÍTICO de la ronda anterior:
audit 8 lo describió nominalmente ("el papel dice *'el excedente de $1,250.00
no es deducible'* y el desglose no imprime renglón de No deducible en
absoluto") y el commit atendió la cubeta, no la frase.

**Causa raíz probable:** el comentario de `:736-739` decide a propósito que la
nota informe del día completo ("antes de timbrarse, el contralor quiere saber
que ese gasto tampoco va a deducir completo") — una intención razonable, escrita
en tiempo presente y con un importe en la columna de dinero, que es lo que la
vuelve una afirmación en vez de una advertencia.

---

### [ALTO] El aviso del permiso CRE no cambió el verde, y `filasDeducibilidad` no tiene siquiera un tono para decirlo

`src/lib/cuadra/cuadre/engine.ts:435-437` · `src/lib/cuadra/liquidacion/deducibilidad.ts:14`
(`TonoDeducibilidad = 'bueno' | 'malo' | 'pendiente'`) · `:45-47` ·
`src/lib/cuadra/liquidacion/pdf.ts:290` (`f.tono === 'bueno' ? GREEN : …`) ·
contraste: `src/lib/cuadra/liquidacion/acreditable.ts:9-11`, `:110-119`

**Norma comparada** — `normas/rfa-2026-2.9.yaml`
(`estado_verificacion: verificado_fuente_primaria`, `:27`), texto literal
`:17-21`:

> "Además, en el comprobante fiscal deberá constar la información del permiso
> vigente, expedido de acuerdo con la Ley de Hidrocarburos al proveedor del
> combustible y que, en su caso, dicho permiso no se encuentre suspendido en el
> momento de la expedición del comprobante fiscal."

y `:36`, cuarta de las `condiciones_de_aplicacion`: *"El CFDI debe consignar el
permiso vigente y no suspendido"*. `normas/lisr-27-III.yaml:19-22` dice lo
mismo para el régimen general —anotación obligada: esa ficha está en
`evidencia_corroborante` (`:27`), no en fuente primaria, y su propia
`nota_verificacion` (`:28-32`) declara que no se leyó en diputados.gob.mx.

Escenario (corrido con el motor real):

```
entra: diésel $5,800.00, CFDI con XML verificado, claveProdServ 15101505,
       tipoComprobante 'I', complemento de hidrocarburos PRESENTE,
       formaPago '03', IVA $689.66, receptor = RFC de la empresa

sale:  Deducible para ISR   $5,800.00   ← tono 'bueno' → tinta VERDE
       IVA acreditable        $689.66   ← tono 'bueno' → tinta VERDE
       + una observación en DIFERENCIAS DETECTADAS que dice que el sistema
         no valida el permiso
```

El repo escribió la regla que gobierna este caso, en `acreditable.ts:9-11`:
*"una cifra en el papel con un artículo citado al lado es una AFIRMACIÓN. Si el
motor no puede sostenerla entera, el renglón tiene que decir qué parte no
sostiene — en el mismo papel"*. El renglón de peaje la cumple: label
`"— sujeto a elegibilidad"`, `tono: 'condicionado'` → tinta neutra, y las
cuatro condiciones al pie. El renglón de deducibilidad **no puede** cumplirla:
`TonoDeducibilidad` no contempla `condicionado`, y `deducibilidad.ts:46` es un
`push` incondicional con `tono: 'bueno'`.

Dos efectos colaterales, medidos:

1. **`estatus: 'revisar'` deja de significar algo para el caso central del
   producto.** Un CFDI de diésel perfecto en todo lo verificable —XML,
   complemento presente, receptor correcto, IEPS desglosado, pago
   electrónico— mete la liquidación entera en `revisar` por una nota que nadie
   puede cerrar nunca, porque el motor no la va a validar. Es exactamente el
   argumento que el propio `engine.ts:925-929` da para dejar
   `ieps_no_desglosado` FUERA de `REVISAR` ("tenerlo en REVISAR mandaba TODA
   liquidación con diésel a la bandeja y la vaciaba de significado"), y la
   línea que `7301adc` editó es la siguiente.
2. **Una nota idéntica por cada CFDI de diésel.** Tres CFDI de diésel producen
   tres párrafos textualmente iguales de 253 caracteres, ~3 renglones cada uno
   al medirse con `envolverMedido` sobre 415pt: ~9 renglones de la hoja
   ocupados por la misma frase. Es el patrón que este mismo día se corrigió
   dos veces —`duplicado` agrupado por original, y `alimentacion_sin_soporte`
   convertido en una sola línea (`87ad2ee`)— reintroducido por el commit de
   en medio.

**Consecuencia:** el contralor lee "Deducible para ISR $5,800.00" en verde y,
tres párrafos abajo, que un requisito legal de esa deducción no está
verificado. Las dos cosas están en el papel, pero la que decide es la verde y
la que matiza está donde nadie mira. El aviso protege a Likida (CFF 89, último
párrafo — la manifestación por escrito); no protege al número.

**Causa raíz probable:** la decisión del commit se tomó sobre el eje "no bajar
la cubeta" (correcto) y no sobre el eje "cómo se pinta una cubeta que ya no se
sostiene entera" — un eje que el repo ya había resuelto en otro archivo, para
la sección de al lado.

---

### [MEDIO] Un hospedaje de $1 sin timbrar apaga la advertencia de LISR 28-V, y el producto se contradice consigo mismo sobre el mismo comprobante

`src/lib/cuadra/cuadre/engine.ts:643` · `:103-113` (`cubetaDe`) ·
`src/lib/cuadra/liquidacion/deducibilidad.ts:48-55`

`haySoporte` mira **el concepto y nada más**: `vivos.some((g) => g.concepto ===
'hospedaje' || g.concepto === 'transporte')`. No mira `cfdiUuid`, así que un
ticket de hotel sin timbrar —que el propio motor acaba de clasificar en `por
confirmar`— basta para silenciar la advertencia.

**Norma comparada** — `normas/lisr-28-V.yaml:16-19`
(`verificado_fuente_primaria`), primer párrafo: *"Los gastos a que se refiere
esta fracción deberán estar amparados con un **comprobante fiscal** cuando
éstos se realicen en territorio nacional o con la documentación comprobatoria
correspondiente, cuando los mismos se efectúen en el extranjero"* — la
alternativa de "documentación comprobatoria" es la del extranjero, no la
nacional. (Lo anoto como MEDIO y no más alto justamente porque el segundo
párrafo repite la disyuntiva "el comprobante fiscal o la documentación
comprobatoria" sin repetir la partición nacional/extranjero, y esa lectura
admite discusión.)

Lo que **no** admite discusión es la contradicción interna:

```
entra (20-jul): alimentación $700.00 con CFDI + XML, IVA $96.55
                hospedaje       $1.00 SIN CFDI

sale:  Deducible para ISR  $700.00   ← VERDE
       Por confirmar         $1.00   con el pie "Falta timbrar la factura…"
       estatus: cuadrada
       diferencias: NINGUNA   (la advertencia de LISR 28-V no sale)
```

El mismo papel dice, de ese hospedaje de $1, que todavía no ampara nada
("Por confirmar · Falta timbrar la factura"), y lo usa como el comprobante que
ampara la deducción de los $700. Sin él, el motor sí habría advertido.

**Consecuencia:** la única señal que el producto emite sobre el requisito de
soporte de LISR 28-V se apaga con el gasto más barato y menos formal de la
liquidación. Y el efecto es discontinuo: $0 de hospedaje → advertencia; $1 de
hospedaje sin factura → silencio y `cuadrada`.

**Causa raíz probable:** la regla se escribió para responder "¿hay hospedaje o
transporte en este viaje?" —una pregunta operativa— y se está usando para
responder "¿hay comprobante que ampare?", que es la pregunta de la ley.

---

### [MEDIO] El plazo de facturación: la rama VERIFICADA dice que la ley da el ejercicio; la rama SIN VERIFICAR —que es la de 33 de 37 comercios— no, y hay una prueba que lo fija

`src/lib/cuadra/cuadre/engine.ts:585-587` (`cierreComercio`) · `:607` (la rama
no urgente) · `src/lib/cuadra/cuadre/plazo_jerarquia.test.ts:69-73`

```ts
const cierreComercio = comercio?.plazoVerificado
  ? ` (plazo del portal de ${comercio.nombre}, no de la ley: legalmente puedes
      exigir la factura dentro del ejercicio)`
  : ', y la ventana del comercio puede ser menor';
```

**Norma comparada** — `normas/politica-portales-plazos.yaml`
(`jerarquia: 6`, `estado_verificacion: sin_verificar`, `:3` y `:8`),
`advertencia_de_jerarquia` `:30-35`:

> "ESTO NO ES UNA NORMA FISCAL. Es la política interna de un tercero y tiene
> CERO fuerza legal. El plazo LEGAL para pedir factura es todo el ejercicio (el
> SAT lo dice expresamente)… El producto NUNCA debe presentar estos plazos como
> una obligación fiscal."

y `:41-45`, el razonamiento con el que la propia ficha exige el matiz: *"un
contralor que lee 'puedes timbrarlo hasta el 31-ago' a secas concluye que el
1-sep perdió el CFDI, y no es cierto"*.

Escenario (corrido con el motor real, `hoy: '2026-07-26'`):

```
entra: ticket de OXXO $41.50 del 2026-07-05, sin CFDI
       (`comercio('oxxo').plazoVerificado === false`)

sale:  "Otro de $41.50 sigue sin factura: puedes timbrarlo hasta el 2026-07-31
        (5 días), y la ventana del comercio puede ser menor. Portal de OXXO
        (tienda): https://www4.oxxo.com:9443/facturacionEle…"
```

Ni "no de la ley", ni "dentro del ejercicio". Y `2026-07-31` no sale de ningún
lado verificado: es el default `mes_natural` que `engine.ts:562` aplica
**precisamente porque** el plazo del comercio no está verificado. La asimetría
es al revés de lo que pide la ficha: la fecha respaldada por evidencia (Office
Depot, leída del papel) lleva el matiz legal, y la fecha respaldada por nada
lo omite. `plazo_jerarquia.test.ts:72` lo deja fijado con
`expect(nota).not.toContain('no de la ley')`.

**Consecuencia:** la oficina lee que el 31-jul se acaba, no lo alcanza, y da
por perdido un CFDI que legalmente puede exigir todo el ejercicio (con
Conciliación de Factura). En diésel eso es la deducción y el IVA del gasto más
grande de la flota. Audit 8 dio por bueno este punto ("el matiz de jerarquía
está en las tres ramas"); medido, está en dos de tres, y la que falta es la
mayoritaria.

**Causa raíz probable:** el arreglo se diseñó y se probó contra el único
comercio con plazo verificado —Office Depot, que es el caso raro— y el caso
común quedó con la redacción anterior, que dice de menos.

---

### [BAJO] `rmf-2026-2.7.1.21.yaml` declara que no se usa en código, y `por_diferencia.ts` la habilita como cita del agente para el aviso de plazo

`normas/rmf-2026-2.7.1.21.yaml:30-31` (`usado_en_codigo: ["FISCAL_LEGAL.md §1.6
(documentación, no código)"]`) · `:8` (`texto_vigente: null`) ·
`src/lib/cuadra/normas/por_diferencia.ts:49`

`NORMA_POR_DIFERENCIA.factura_por_vencer = ['rmf-2026-2.7.1.21',
'politica-portales-plazos-facturacion']`, así que `guardiaFundamento` **permite**
que el agente cite la RMF 2.7.1.21 al explicarle a alguien por qué su ticket
"se pasó el plazo de facturación". La ficha tiene `texto_vigente: null` y su
`nota_verificacion` (`:12-14`) dice *"Texto NO transcrito. PARA CERRAR: pegar el
texto de la regla desde la RMF"*.

Escenario: el operador pregunta "¿por qué dices que ya no puedo facturarlo?" y
el agente contesta fundándose en la RMF 2.7.1.21 — una regla sobre la
**expedición de la factura global por parte del vendedor**, no sobre el plazo
del comprador para pedir su CFDI. Nadie en el repo puede comprobar qué dice,
porque el texto no está.

**Consecuencia:** no mueve ninguna cifra —por eso es BAJO— pero es el mismo
mecanismo por el que `usado_en_codigo` se degradó en la ficha de portales
(MEDIO de la ronda 8): el campo se escribe una vez y nada lo obliga a seguir al
código. Con dos fichas ya desincronizadas, deja de ser un descuido y pasa a ser
el comportamiento por defecto del campo.

**Causa raíz probable:** `normas_sincronizadas.test.ts` verifica id, estado,
jerarquía, citas, ruta y `fecha_vigencia_desde`; no verifica `usado_en_codigo`
contra el árbol.

---

## Lo que revisé y está bien

- **CRÍTICO #6 de la ronda 8 (CFDI sin RFC receptor) CERRADO, y el fixture
  ejercita el motor real.** `rfc_receptor_faltante.test.ts` importa
  `cuadrarViaje` de `./engine` y lo llama de verdad (`:2`, `:28-31`); no hay
  mock ni doble. Lo reproduje por mi cuenta con el motor bundleado fuera del
  repo: CFDI de $11,600 con `cfdiUuid` y sin `rfcReceptor`, `empresaRfc`
  válido → `deducible 0 · porConfirmar 11,600 · ivaAcreditable 0 · difs:
  rfc_receptor_no_verificable`. El control inverso también: con receptor
  correcto vuelve a `deducible 11,600 · iva 1,600`. `engine.ts:352-358` es la
  tercera rama y `rfc_receptor_no_verificable` está en `POR_CONFIRMAR` (`:86`)
  **y** en `SIN_ACREDITAMIENTO` (`:777`), que son las dos que hacían falta.
  El default del helper `g()` en `engine.test.ts` (`RECEPTOR_VERIFICADO_
  DEFAULT`) es explícito y se puede anular pasando `rfcReceptor: undefined`;
  no enmascara el camino nuevo, y el archivo que lo prueba no usa el helper.
- **CRÍTICO #2 de la ronda 8 (litros del estímulo sin cotejar) CERRADO.**
  `engine.ts:850-861`. Corrido: diésel $5,800 con `ocrExtra.litros = 20000` →
  `diesel_desviacion` con la cuenta explícita ("$5,800.00 ÷ ~$27/L ≈ 215 L
  esperados"), `litrosDieselAcreditables = 0`, y el renglón de litros
  desaparece del PDF. La banda 0.5×–2× deja pasar desviaciones moderadas —300 L
  sobre $5,800 (ratio 1.40) se acreditan— pero eso está declarado como decisión
  en el propio comentario y no es un error de norma.
- **CRÍTICO #3 de la ronda 8, en su mitad de dinero.** El caso que salía
  "$194.44 deducibles" hoy sale `Deducible $1,600.00 · Por confirmar $2,000.00 ·
  No deducible $0.00` sobre un comprobado de $3,600. La proporción se calcula
  entre timbrados (`:740-743`), ninguna cubeta salió negativa en los nueve
  escenarios que corrí, y las tres siempre sumaron el comprobado —
  `deducibilidad.ts:41-42` sigue siendo el portón que devuelve `null` si no
  cuadran. La mitad de la frase está arriba como hallazgo.
- **El estímulo de IEPS sigue en litros y nunca en pesos.** `engine.ts:783`
  (`const iepsAcreditable = 0`, y es `const` a propósito),
  `acreditable.ts:94-100` con `tono: 'condicionado'` y la nota de la cuota
  semanal. `normas/lif-2026-20-A.yaml` (`verificado_fuente_primaria`) dice
  "cuota × litros, no el IEPS trasladado", y eso es lo que el producto hace.
- **El estímulo de peaje sigue condicionado y bien impreso.**
  `acreditable.ts:110-119`: la condición va en el **label**, el tono es
  `condicionado` (tinta neutra en `pdf.ts:340`), y los dos pies traen la base
  usada (H4 de la ficha, declarado sin resolver) y las cuatro condiciones
  textuales con la frase "Likida NO verifica la elegibilidad". Es el modelo que
  el renglón de deducibilidad no sigue.
- **`permiso_cre_no_verificable` va SOLO al contralor.** `resumen.ts:24-28`; el
  operador no puede resolver un requisito del emisor y no recibe el reproche.
  `pdf.ts:398` aplica el mismo filtro al ejemplar del operador.
- **El complemento de hidrocarburos sigue sin declarar no deducible sobre una
  fecha que nadie confirmó.** `engine.ts:411-414` lee `exigibleDesde` de la
  ficha (`null` hoy) y cae en `complemento_no_verificable`;
  `h.vigenteDesde` quedó como filtro de ruido.
- **El 15% de la RFA 2.9 usa el denominador correcto.**
  `periodo/combustible.ts:80-89`: combustible en efectivo contra **todo** el
  combustible del ejercicio, que es lo que dice `rfa-2026-2.9.yaml:16-17`, y
  `excedente` tira solo el excedente y no el acumulado.
- **`rfa-2026-2.2` (el 8% de "gasto ciego") no se ofrece en ninguna parte del
  producto.** `usado_en_codigo: []` es cierto: fuera de `indice.ts` no aparece
  en código, y su `advertencia` —"NO cubre combustible… Prometerle a un
  contralor que el diésel sin factura 'entra en el 8%' es falso"— no está siendo
  violada por nada que el producto imprima o diga.
- **El dígito verificador del RFC está bien implementado.** `intake/cfdi.ts:36-74`:
  alfabeto correcto (`&` = 24, espacio = 37, Ñ = 38), pesos 13→2, y los dos
  casos frontera (resto 0 → '0', resto 1 → 'A'). Los genéricos del SAT se
  exceptúan a propósito y el motor los trata como "valor inservible", que es la
  corrección de la ronda 6.
- **Suite y tipos.** `npm test`: 154 archivos, 1,436 pruebas verdes, 1 saltada.
  `npx tsc --noEmit`: salida 0. Ninguno de los hallazgos de arriba es una
  regresión que la suite haya dejado pasar en rojo: los seis son huecos de
  cobertura, y dos de ellos (`plazo_jerarquia.test.ts:72`,
  `permiso_cre_no_verificable.test.ts:55-61`) están **fijados por una prueba
  que afirma el comportamiento que reporto**.

## Lo que NO alcancé a revisar

- **El PDF renderizado.** Igual que la ronda pasada: leí `pdf.ts` y verifiqué
  con el motor real las estructuras que le llegan (`filasDeducibilidad`,
  `filasAcreditables`, la lista de `diferencias` con su `monto`), pero **no
  generé un PDF ni lo miré**. El conteo de renglones de la nota del permiso CRE
  es una medición sobre `envolverMedido` y el ancho de columna, no sobre el
  papel.
- **`laboral/pagadero.ts` contra `lft-110-111-263.yaml`** — cuarta ronda
  consecutiva sin abrirlo. La sección "LO QUE SE LE REEMBOLSA AL OPERADOR" sale
  de ahí y ahora recibe cubetas calculadas por `cubetaDe` desde `pdf.ts:366-378`.
- **El camino nuevo de corrección de fecha** (`intake/emparejar.ts::
  emparejarCorreccionDeFecha`, `repo.ts::corregirFechaGasto`, `42ac86d`) desde
  el ángulo fiscal: re-fechar un gasto cambia ejercicio, plazo de facturación y
  agrupación del tope diario de LISR 28-V. Leí `fecha_dudosa.ts` y el prompt de
  fechas de `ocr.ts:124-130` (que está bien acotado, con la excepción de Costco
  declarada como única y verificada contra un ticket real), pero no ejercité el
  emparejamiento.
- **Fichas no verificables en esta ronda** (`texto_vigente: null`, sin
  transcripción de fuente primaria): `cff-29-A`, `criterio-1-CFF-PI`,
  `criterio-1-LIF-PI`, `rmf-2026-2.7.1.21`, `rmf-2026-2.7.1.48`,
  `politica-portales-plazos`. Nada de lo que afirmo arriba se apoya en ellas.
  Anoto que `cff-29-A` es la que funda cinco veredictos en `por_diferencia.ts`
  y sigue sin texto, y que el BAJO de la ronda 8 sobre su
  `fecha: 2026-11-07` sigue sin corregir.
- **Las condiciones 1 y 2 de la RFA 2.9** (dedicación exclusiva al
  autotransporte de carga federal, régimen fiscal del Título II Cap. VII o
  Título IV Cap. II Secc. I): siguen sin capturarse en ninguna parte, y la nota
  de `combustible_efectivo` (`engine.ts:250`) sigue diciendo "Dentro del 15%
  sigue siendo deducible" con solo una de las cuatro condiciones dicha. Es el
  MEDIO de la ronda 8 y **sigue abierto** — no lo repito como hallazgo nuevo,
  pero cuenta en la nota.
- **`normas/.latido-vigilancia` y `.latido-cuota-diesel`**: no revalidé ninguna
  ficha contra el DOF desde aquí. Todo lo que dice `verificado_el: 2026-07-27/28`
  lleva cinco días sin contrastarse.
