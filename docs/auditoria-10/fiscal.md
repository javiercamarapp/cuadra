# Cumplimiento fiscal — auditoría 10

**Nota: 6/10** (antes 7). Razón del movimiento: **mirada más profunda (el código no
cambió, la nota anterior estaba inflada)**.

Tres de los cuatro altos de la ronda 9 anclaron de verdad y lo verifiqué
ejecutando el motor. El cuarto —EFOS— cerró el falso positivo y abrió el falso
negativo: hoy **ningún camino del código puede poner `efos: true`**, así que un
CFDI que el SAT marca sale impreso "Deducible para ISR" en verde con su IVA
acreditable. Y al abrir las 21 fichas, la trazabilidad que el ancla de 8+ exige
no se sostiene: las dos fichas que respaldan las cifras impresas están marcadas
`verificado_fuente_primaria` mientras su propia `nota_verificacion` admite que el
texto salió de reproducciones secundarias.

**El riesgo mayor del rubro, hoy:** el producto ya no puede declarar no deducible
un comprobante de un EFOS —lo declara *deducible*— y ese es el veredicto que un
contador revisa primero.

---

## Cómo está marcada la verificación (lo que el ancla de 8+ pide, medido)

Ninguna ficha tiene un campo booleano `verificado_fuente_primaria: true`. Lo que
existe es `estado_verificacion:` con uno de tres valores. Conteo real sobre las 21
fichas de `normas/`:

| `estado_verificacion` | fichas | de ellas, con `texto_vigente: null` |
|---|:--:|:--:|
| `verificado_fuente_primaria` | 14 (10 fiscales + 4 de LFPDPPP) | 0 |
| `evidencia_corroborante` | 6 | 4 |
| `sin_verificar` | 1 | 1 |

`src/lib/cuadra/normas/normas_sincronizadas.test.ts:45-51` verifica que el índice
de TS copie ese estado, **pero nada verifica que el estado corresponda a la
evidencia que la propia ficha declara**. Ese es el hueco del hallazgo 5.

---

## Hallazgos

### [ALTO] Después del arreglo de EFOS, un CFDI que el SAT marca sale "Deducible para ISR" en verde con su IVA acreditable

`src/lib/cuadra/intake/sat.ts:80-84` · `src/lib/cuadra/cuadre/engine.ts:85,405-408,866`

La ficha `normas/cff-69-B.yaml` (`estado_verificacion: verificado_fuente_primaria`,
transcrita del PDF de diputados.gob.mx) dice **literal**:

> «Los efectos de la publicación de este listado serán considerar, con efectos
> generales, que las operaciones contenidas en los comprobantes fiscales expedidos
> por el contribuyente en cuestión **no producen ni produjeron efecto fiscal
> alguno**.»

El commit `4d8b4f4` eliminó `EFOS_EN_LISTA = new Set(['100'])` y dejó esto:

```ts
const EFOS_LIMPIO = new Set(['200', '201']);
const efos = !efosCode ? null : EFOS_LIMPIO.has(efosCode) ? false : null;
const efosDesconocido = !!efosCode && !EFOS_LIMPIO.has(efosCode);
```

`efos` ya no puede valer `true` desde ningún camino. Grepeé los cuatro
consumidores (`intake/ocr.ts:355`, `repo.ts:102/495`, `engine.ts:405`) y no hay
otra fuente. En consecuencia `cfdi_efos` —el único tipo EFOS que está en
`NO_DEDUCIBLE_ISR` (`engine.ts:85`) y en `SIN_ACREDITAMIENTO` (`engine.ts:866`)—
es hoy **código muerto**, y todo EFOS entra por `cfdi_efos_indeterminado`, que no
está en ninguna de las dos listas.

**Escenario (ejecutado contra `cuadrarViaje` real):** CFDI de $11,600, XML
verificado, receptor = RFC de la flota, `estadoSat: 'vigente'`, `ivaTraslado: 1600`,
y el SAT devuelve `ValidacionEFOS = 100` (el código que hasta el 1-ago significaba
"en lista"). Salida medida:

```
diferencias: ['cfdi_efos_indeterminado']
totalDeducible: 11600 · totalNoDeducible: 0 · ivaAcreditable: 1600
```

`liquidacion/deducibilidad.ts:72` emite `{ label: 'Deducible para ISR', monto: 11600,
tono: 'bueno' }` y `pdf.ts:295` pinta `tono: 'bueno'` en **GREEN**;
`liquidacion/acreditable.ts` emite `IVA acreditable (LIVA art. 5) $1,600.00` también
en verde. La única señal contraria es un renglón que dice «La validación EFOS ... no
fue concluyente», que es además una afirmación falsa: el SAT sí fue concluyente.

**Consecuencia:** el contralor archiva un papel que afirma $11,600 de deducción y
$1,600 de IVA acreditable sobre un comprobante que, si el emisor está en el listado
definitivo, no produce efecto fiscal alguno. Quien lo acredita en su declaración es
la flota, y el papel se lo dio Likida — que es exactamente el supuesto del art. 89
fr. I del CFF que `cuadre/leyendas.ts` existe para mitigar.

**Causa raíz probable:** el arreglo cambió "siempre duro" por "nunca duro" en vez de
usar el tercer estado que este mismo archivo celebra haber inventado para el RFC
(`engine.ts:195-211`): `POR_CONFIRMAR` + `SIN_ACREDITAMIENTO`, ni deducible ni
acreditable, a revisión.

---

### [ALTO] Los litros del estímulo de diésel se cuentan con cualquier forma de pago que no sea efectivo, y el requisito que el código cita es una lista cerrada de cuatro

`src/lib/cuadra/cuadre/engine.ts:929-930`

```ts
const pagoElectronico = !!g.formaPago && g.formaPago !== '01';
if (pagoElectronico && Number.isFinite(litros) && litros > 0) { ... litrosDieselAcreditables += litros; }
```

El comentario inmediatamente anterior (`engine.ts:922-925`) dice qué requisito está
implementando:

> «El medio de pago es requisito del 4º párrafo de la LIF 20-A-IV (**monedero,
> tarjeta, cheque nominativo o transferencia**) y NO tiene la válvula del 15% que la
> RFA 2.9 sí concede para ISR: la facilidad salva la deducción, no el
> acreditamiento.»

Cuatro medios nombrados; el código acepta 30 (todo `c_FormaPago` salvo `01`).

**Escenario (ejecutado):** CFDI de diésel de $5,400, clave `15101505`, XML
verificado, complemento presente, `ocrExtra.litros = 200`, **`FormaPago = '99'`** —
que no es un caso exótico: `99 (Por definir)` es el valor obligatorio en todo CFDI
con `MetodoPago = PPD`, y una flota que compra diésel a crédito en la estación
factura exactamente así. Salida medida: `litrosDieselAcreditables: 200`, sin una sola
diferencia sobre el medio de pago. `liquidacion/acreditable.ts` lo imprime como
«Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A) — 210 L» (200 L
en este caso) y el pie invita al contador a multiplicarlo por la cuota del DOF.
Lo mismo pasa con `12` (dación en pago), `17` (compensación), `23` (novación) y
`30` (aplicación de anticipos).

**Y no hay ficha que respalde el requisito.** Abrí `normas/lif-2026-20-A.yaml`
completo: transcribe dos fragmentos del estímulo de diésel y las condiciones del de
peaje, pero **el 4º párrafo del medio de pago no está transcrito en ninguna parte del
repo**. El código cita un párrafo que ninguna ficha contiene.

**Consecuencia:** el contador de la flota multiplica 200 L × cuota semanal y acredita
un estímulo cuyo requisito de medio de pago nadie verificó. Con la cuota alta de 2026
($7.3634/L, la que la propia ficha `criterio-1-LIF-PI` cita) son ~$1,473 por ticket,
y la ficha estima ~$1M mensuales de exposición para una flota de 200,000 L/mes.

**Causa raíz probable:** "electrónico" se implementó como negación del efectivo en vez
de como la lista cerrada que la ley enumera — y el párrafo que la enumera no está
transcrito, así que nadie podía cotejarlo.

---

### [MEDIO] (REINCIDENTE) Un hospedaje de $1 sin timbrar apaga las DOS advertencias de LISR 28-V del mismo viaje

`src/lib/cuadra/cuadre/engine.ts:681` y `:730`

```ts
const haySoporte = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
...
const hayHospedaje = vivos.some((g) => g.concepto === 'hospedaje');
```

`normas/lisr-28-V.yaml` (`verificado_fuente_primaria`) dice literal:

> «...y el contribuyente acompañe **el comprobante fiscal o la documentación
> comprobatoria** que ampare el hospedaje o transporte.»

El motor no exige comprobante *fiscal* ni monto: le basta un `Gasto` con
`concepto === 'hospedaje'`.

**Escenario (ejecutado):** comida de $700 timbrada + un renglón de hospedaje de $1
sin UUID, sin RFC, sin XML.

```
solo la comida              → ['anticipo', 'alimentacion_sin_soporte']
comida + hospedaje de $1    → ['anticipo']
```

La advertencia desaparece. El mismo renglón de $1 apaga además la condición de
tarjeta de crédito (`hayHospedaje` en `:730`), que es justo el alto que la ronda 9
cerró con `c64c74c`: basta un hospedaje de $1 para volver a apagarlo.

**Consecuencia:** el contralor deja de ver la única señal de que una comida no está
amparada, sobre un dato que el operador controla (mandar una foto etiquetada
"hospedaje"). Es la advertencia que el motor emite en vez de quitar la deducción,
así que apagarla no deja rastro en ninguna cifra.

**Causa raíz probable:** el soporte se modela por existencia de un concepto, no por
que el comprobante ampare algo.

---

### [MEDIO] (REINCIDENTE) 33 de 37 comercios caen en la rama que afirma una fecha límite sin decir que el plazo legal es todo el ejercicio

`src/lib/cuadra/cuadre/engine.ts:623-625,645` · `src/lib/cuadra/facturacion/comercios.ts`

Conteo de hoy: 37 entradas en `COMERCIOS`, `plazoVerificado: true` en 4 (`g500` :191,
`office_depot` :280, `megasur` :375, `la_gas` :404) y `false` en 33.

`normas/politica-portales-plazos.yaml`, `advertencia_de_jerarquia`, literal:

> «ESTO NO ES UNA NORMA FISCAL. Es la política interna de un tercero y tiene CERO
> fuerza legal. **El plazo LEGAL para pedir factura es todo el ejercicio** (el SAT lo
> dice expresamente)... El producto NUNCA debe presentar estos plazos como una
> obligación fiscal.»

Las dos ramas de cierre (`:623-625`):

```ts
const cierreComercio = comercio?.plazoVerificado
  ? ` (plazo del portal de ${comercio.nombre}, no de la ley: legalmente puedes exigir la factura dentro del ejercicio)`
  : ', y la ventana del comercio puede ser menor';
```

**Escenario (ejecutado):** ticket de diésel de $3,200 del 1-ago-2026, emisor Shell
(`plazoVerificado: false`), `hoy = 2026-08-02`. Texto impreso medido:

> «Combustible de $3,200.00 sigue sin factura: **puedes timbrarlo hasta el 2026-08-31
> (29 días)**, y la ventana del comercio puede ser menor. Portal de Shell México:
> https://facturacion.shell.com.mx/.»

La rama vencida y la rama verificada sí nombran el ejercicio; ésta —la de 33 de 37
comercios, y la que se lee **antes**— no.

**Consecuencia:** el contralor lee una fecha límite con la autoridad de un cálculo y
concluye que el 1-sep perdió el CFDI. No lo perdió: puede exigirlo dentro del
ejercicio y tiene la Conciliación de Factura del SAT. Es el error de confundir niveles
que `normas/README.md` llama «el más caro del dominio», cometido por el papel que
vendemos.

**Causa raíz probable:** el matiz legal se escribió como propiedad del `cierreComercio`
(que depende de `plazoVerificado`) en vez de como propiedad del aviso.

---

### [MEDIO] El renglón "IVA acreditable (LIVA art. 5)" sale verde en la misma hoja donde el de ISR sale condicionado por el mismo hecho

`src/lib/cuadra/liquidacion/acreditable.ts` (renglón de IVA, `tono: 'bueno'`) vs
`src/lib/cuadra/liquidacion/deducibilidad.ts:64-72`

`normas/liva-5.yaml` (`verificado_fuente_primaria`), fracción I, literal:

> «...se consideran estrictamente indispensables las erogaciones efectuadas por el
> contribuyente **que sean deducibles para los fines del impuesto sobre la renta**,
> aun cuando no se esté obligado al pago de este último impuesto.»

Y la propia `nota_verificacion` de la ficha lo subraya: «El IVA solo es acreditable si
la erogación es DEDUCIBLE para ISR. No es un requisito aparte: la ley DEFINE
"estrictamente indispensable" como "deducible para los fines del ISR"».

**Escenario (ejecutado):** un diésel de $5,800 (XML verificado, IVA $800) y una caseta
de $1,160 (IVA $160). El motor levanta `permiso_cre_no_verificable`. Salida medida de
las dos funciones que alimentan la misma hoja del PDF:

```
DEDUC → label: 'Deducible para ISR — sujeto a permiso CRE vigente'  $6,960  tono: 'condicionado'
        pie:   'LISR 27-III y RFA 2026 regla 2.9 exigen ... El sistema no lo valida'
ACRED → label: 'IVA acreditable (LIVA art. 5)'                        $960   tono: 'bueno'  pies: []
```

`pdf.ts:348` pinta `'bueno'` en verde. El mismo hecho —el permiso CRE que el sistema
no verifica— condiciona una cifra y deja la otra afirmada sin reserva, cuando LIVA 5-I
las ata: si la deducción para ISR está en duda, el acreditamiento del IVA está en la
misma duda. El propio encabezado de `acreditable.ts` fija la regla que aquí se rompe:
«una cifra en el papel con un artículo citado al lado es una AFIRMACIÓN. Si el motor
no puede sostenerla entera, el renglón tiene que decir qué parte no sostiene».

Aplica igual a `cfdi_efos_indeterminado`, `alimentacion_sin_soporte` y
`complemento_no_verificable`: ninguno está en `SIN_ACREDITAMIENTO` (`engine.ts:866`) y
los tres acreditan el IVA al 100%.

**Consecuencia:** el contralor se lleva $960 en verde como recuperable sobre gastos
cuya deducibilidad el mismo papel condiciona dos renglones más arriba.

**Causa raíz probable:** `SIN_ACREDITAMIENTO` se construyó como lista de veredictos
duros y no como "todo lo que condiciona la deducibilidad ISR condiciona el IVA".

---

### [MEDIO] Las dos fichas que respaldan las cifras impresas dicen `verificado_fuente_primaria` y en su propia nota admiten fuente secundaria

`normas/lisr-28-V.yaml` · `normas/lif-2026-20-A.yaml` · contraste:
`normas/lisr-27-III.yaml`

`lisr-28-V.yaml` — la ficha del **$750/día**, el número más impreso del producto
(`config.ts:95`, `engine.ts:768-848`):

```yaml
fuente_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf"
fuente_tipo: diputados_oficial
estado_verificacion: verificado_fuente_primaria
nota_verificacion: >
  Texto idéntico en cuatro reproducciones independientes (apta.com.mx, leyesmx,
  mley.mx, tax.com.mx).
```

`lif-2026-20-A.yaml` — la ficha de los **litros de diésel** y del **50% de peaje**,
las dos cifras de la sección "ACREDITABLE / RECUPERABLE":

```yaml
fuente_tipo: diputados_oficial
estado_verificacion: verificado_fuente_primaria
nota_verificacion: >
  Texto obtenido de dos reproducciones del articulado (leyes-mx.com y mley.mx) y
  corroborado con el documento de Reducciones y Estímulos Fiscales 2026 de PRODECON.
```

`lisr-27-III.yaml` tiene **exactamente la misma clase de evidencia** (Justia + SDV
Asesores + página del SAT) y está honestamente marcada `evidencia_corroborante`, con
«NO se leyó en diputados.gob.mx. PARA CERRAR: leer el PDF vigente...». Tres fichas,
dos etiquetas, la misma calidad de fuente. Las genuinamente primarias se distinguen
solas: `cff-30`, `cff-69-B`, `cff-89-90` y `lft-110-111-263` dicen «transcrito del PDF
oficial de la Cámara de Diputados» y `rfa-2026-2.9` dice «Leído en el DOF (SIDOF)».

`normas_sincronizadas.test.ts:45-51` solo comprueba que el índice copie el valor del
estado; nada comprueba que el estado corresponda a la evidencia declarada dos líneas
más abajo en la misma ficha.

Al mismo tiempo, tres de los seis veredictos duros de `NO_DEDUCIBLE_ISR`
(`engine.ts:85`) —`rfc_receptor`, `cfdi_cancelado`, `cfdi_no_encontrado`— se fundan en
`cff-29-A` (`por_diferencia.ts:39,44,45`), cuya ficha tiene **`texto_vigente: null`**:
nadie en este repo ha leído el artículo que tres veredictos rojos citan. Y el tope de
$2,000 (`engine.ts:273-275`) se imprime como «no deducible» sin condición alguna
apoyado en `lisr-27-III`, que es `evidencia_corroborante` — el `normas/README.md` dice
que ese estado permite afirmar «Sí, **condicionado**», y aquí no hay condición.

**Consecuencia:** el mecanismo de confianza del rubro entero —el campo que decide si
el producto puede afirmar algo— no es auditable, porque en las dos fichas que
importan la etiqueta contradice su propia nota. Un contador que abra `normas/` en la
sala y lea las dos líneas seguidas concluye que el sistema de verificación es
decorativo. Es lo que impide que este rubro llegue a 8.

**Causa raíz probable:** el estado se asignó por confianza en la coincidencia de
fuentes, no por el criterio que `normas/README.md` define («se leyó el texto en el
DOF, el SAT o diputados.gob.mx»).

---

### [MEDIO] `/api/demo` corre el motor real sin ninguna configuración fiscal: el mismo gasto da dos veredictos según la puerta

`src/app/api/demo/route.ts:41` vs `src/lib/cuadra/cuadre/desde_db.ts:44-60`

```ts
const liq = cuadrarViaje({ viajeId: 'demo', anticipo: body.anticipo ?? 0, gastos, politica: POLITICA, ruta: 'Silao-Laredo' });
```

Sin `estimulos`, sin `empresaRfc`, sin `hidrocarburos`, sin `hoy`. `engine.ts:768-769`
condiciona **todo** el bloque del tope de LISR 28-V a
`if (topeAlimentacion != null)`, así que sin `estimulos` la regla no corre; tampoco
corre la validación de receptor, ni el complemento, ni el permiso CRE, ni el aviso de
facturación. `desde_db.ts` sí las pasa todas.

**Escenario (ejecutado):** una alimentación de $3,000 del 1-ago-2026, timbrada, con
IVA de $413.79. Mismo motor, mismos datos, dos puertas:

```
por /api/demo   → diferencias ['sobre_politica','alimentacion_sin_soporte']
                  deducible $3,000 · no deducible $0 · IVA acreditable $413.79
por desde_db    → diferencias ['sobre_politica','alimentacion_sin_soporte','viatico_excede_fiscal']
                  deducible $750   · no deducible $2,250 · IVA acreditable $103.45
```

$2,250 de deducción y $310 de IVA de diferencia sobre los mismos hechos. La página
`/demo` (`src/app/demo/page.tsx:77`) anuncia «El cuadre es real» y sus cuatro presets
(`page.tsx:12-17`) están marcados «🔴 INVENTADO ... Ajústala con la política real de
Innovativos»: hoy ninguno es `alimentacion`, así que el camino no se dispara desde la
UI — pero un preset editado antes del 6-ago lo abre sin que nada falle.

**Consecuencia:** el simulador que el contralor puede abrir en su navegador y el
producto que le manda el PDF pueden contestar cosas distintas sobre la misma comida,
y la del simulador es la que promete de más.

**Causa raíz probable:** la ruta construye su propio `CuadreInput` a mano en vez de
pasar por la única función que lo arma con la config.

---

### [BAJO] (REINCIDENTE) Dos fichas declaran mal dónde se usan, y una de las dos ya se había corregido por esto mismo

`normas/rmf-2026-2.7.1.21.yaml` · `normas/politica-portales-plazos.yaml`

`rmf-2026-2.7.1.21.yaml`:

```yaml
usado_en_codigo:
  - "FISCAL_LEGAL.md §1.6 (documentación, no código)"
```

Y `src/lib/cuadra/normas/por_diferencia.ts:50`:

```ts
factura_por_vencer: ['rmf-2026-2.7.1.21', 'politica-portales-plazos-facturacion'],
```

Sí se usa en código, y además es una de las dos normas que el agente puede citar al
explicar un aviso de facturación.

`politica-portales-plazos.yaml` está desincronizada por segunda vez. Dice hoy:

> «`facturacion/comercios.ts` — `plazoVerificado: false` **en 12 de 13 entradas**;
> `true` SOLO en office_depot (plazo `mes_siguiente`, leído del ticket)»

Son 37 entradas y 4 verificadas (`g500`, `office_depot`, `megasur`, `la_gas`), tres
de ellas con plazo `mes_natural` y no `mes_siguiente`. La `nota_verificacion` de esa
misma ficha documenta que ya se corrigió una vez por este motivo el 28-jul: «un
auditor que rastreara la fecha "2026-08-31" llegaba a un YAML `sin_verificar` que
decía lo contrario del código».

**Consecuencia:** `usado_en_codigo` es el campo con el que se calcula el radio de
impacto cuando una norma cambia (lo dice `normas/README.md`). Si miente, una reforma
se evalúa contra el archivo equivocado. Y ninguna prueba lo cubre:
`normas_sincronizadas.test.ts` compara id, estado, jerarquía, citas, ruta y
`fecha_vigencia_desde` — nunca `usado_en_codigo`.

---

### [BAJO] Un hotel guardado con el concepto heredado `viaticos` sale con "$1,250 no deducibles" citando LISR 28-V, y el comentario lo llama "conservador"

`src/lib/cuadra/cuadre/engine.ts:770-773`

```ts
// 'viaticos' a secas entra por compatibilidad ... Criterio
// conservador: se le sigue aplicando el tope.
const conTope = (c: string) => c === 'alimentacion' || c === 'viaticos';
```

`normas/lisr-28-V.yaml`, literal: «Tratándose de gastos de viaje destinados a la
**alimentación**, éstos sólo serán deducibles hasta por un monto que no exceda de
$750.00 diarios...». Y el `confirmado_del_codigo` de la misma ficha: «Solo
alimentación; **el hospedaje nacional no tiene tope**: CORRECTO».

**Escenario (ejecutado):** gasto de $2,000 del 1-ago con `concepto: 'viaticos'`
(una noche de hotel guardada por el OCR viejo), timbrado, IVA $275.86:

> «**Alimentación** del 2026-08-01: $2,000.00 excede el tope fiscal de $750.00 por día
> (LISR 28-V) — el excedente de $1,250.00 no es deducible.»
> `totalDeducible 750 · totalNoDeducible 1250 · ivaAcreditable 103.45`

Es el mismo error que el comentario de `:752-755` declara haber arreglado («una noche
de hotel de $2,000 salía con $1,250 "no deducibles" que sí lo eran»), conservado a
propósito para una rama. Y no es conservador: el lado conservador para el
contribuyente es no declararle perdida una deducción que la ley le concede. Encima
renombra el hotel como "Alimentación" en el papel.

**Alcance honesto:** hoy el OCR no emite `viaticos` (`intake/ocr.ts:29,101`) y el
producto es pre-revenue, así que no debería haber filas así. La migración
`0025_dominios_check.sql:88` sigue admitiendo el valor.

---

## Lo que revisé y está bien

**Los tres altos de la ronda 9 que sí anclaron** (verificados ejecutando el motor, no
leyendo el commit):

- **Tope de $750 (`72b565b`)** — `engine.ts:812-842`. Dos tickets sin timbrar de
  $1,200 y $800 el mismo día: `totalNoDeducible = 0` y la nota dice «Hoy nada de esto
  es "no deducible" todavía: lo que falta por timbrar sigue por confirmar». El papel
  ya no se contradice. Además el prorrateo es por proporción del día
  (`engine.ts:815-816`, `:1008-1011`) y nunca produce un deducible negativo.
- **Comida amparada solo por transporte (`c64c74c`)** — `engine.ts:730-745`. Comida de
  $500 con `formaPago: '28'` (débito) + transporte, sin hospedaje → emite
  `alimentacion_transporte_sin_tarjeta_credito`. La ley pide crédito (`'04'`) y el
  código exige `'04'`, no "cualquier tarjeta". Coincide con el 2º párrafo, 3ª oración
  de `lisr-28-V.yaml`.
- **Permiso CRE (`f25d44f`)** — `permiso_cre_no_verificable` está fuera de `REVISAR`
  (`engine.ts:1029`), así que ya no manda el viaje demo a rojo; el requisito sigue
  dicho, con tono `condicionado`, pegado al renglón de ISR
  (`deducibilidad.ts:64-72`, `pdf.ts:309`).

**El interruptor del complemento de hidrocarburos** — `engine.ts:432-476` +
`indice.ts:306` (`exigibleDesde: null`) + `normas_sincronizadas.test.ts:86-97`. Con la
fecha sin respaldo el motor emite `complemento_no_verificable` (revisión) y **no**
declara no deducible; la fecha que decide dinero sale de la ficha, no de `config.ts`.
Es el mejor mecanismo del rubro y aguanta la inspección.

**La sección "ACREDITABLE / RECUPERABLE"** — `liquidacion/acreditable.ts` completo.
Los hallazgos H4 (base `subTotal` vs "gasto total erogado"), H5 (Red Nacional de
Autopistas) y H6 (ingresos < $300M, partes relacionadas) que `lif-2026-20-A.yaml`
declara `SIN RESOLVER` están **impresos en el papel**, con las cuatro condiciones
transcritas literales y la nota de ingreso acumulable. Intenté reportarlos como
hallazgo y me refuté yo mismo: el papel dice qué base usó y que Likida no verifica la
elegibilidad. El renglón sale en tinta neutra, no en verde (`pdf.ts:348`).

**El estímulo de IEPS no se calcula con el IEPS trasladado** — `engine.ts:872`
(`const iepsAcreditable = 0`) y `:928` (se cuentan litros, no pesos). Es exactamente
lo que `lif-2026-20-A.yaml` pide: «cuota IEPS vigente al momento de la compra ×
LITROS. No es el IEPS trasladado en el CFDI». El error que el rubro nombra como
ejemplo canónico no está aquí. La verificación de litros contra precio×litros
(`engine.ts:939-950`) atrapa el decimal corrido.

**RFA 2026 regla 2.9 aplicada al concepto correcto** — `engine.ts:271-272` manda el
combustible en efectivo a `POR_CONFIRMAR` (deducible hasta el 15%) y lo deja en
`SIN_ACREDITAMIENTO` (`:866`), con el comentario de `:860-865` explicando que la
facilidad salva un beneficio y no los dos. Coincide con el `limite_importante` de la
ficha. Y `rfa-2026-2.2.yaml` (el 8%) tiene `usado_en_codigo: []` y no se aplica a
combustible en ningún lado — grepeé "2.2" y no hay uso.

**RLISR 57 y el viático a nombre del operador** — `engine.ts:381-400`. No se rechaza
el CFDI a nombre de una persona: si coincide con `operadorRfc` no se reporta nada, si
falta el dato sale `viatico_rfc_operador` (revisión, sin quitar deducción). Coincide
con el texto transcrito del reglamento.

**La leyenda del PDF cita lo que la norma sí dice** — `cuadre/leyendas.ts:50-59` contra
`cff-89-90.yaml`. La frase «pueden diferir de los que dé a conocer el SAT» es
literalmente la conducta que exime del art. 89 último párrafo, y la referencia al art.
52 CFF («no constituye un dictamen») es correcta. Busqué una cita que no dijera lo
citado y no la encontré en `leyendas.ts`.

**Las tres cubetas siempre suman el comprobado** — `engine.ts:983-1012` y el portón de
`deducibilidad.ts:54-55` (si no suman con 1.5 centavos de tolerancia, no se imprime el
desglose). El contralor no puede sacar la calculadora y encontrar una diferencia.

**Extracción de impuestos del XML** — `intake/cfdi_xml.ts:141-153`. IVA `002` e IEPS
`003` se suman de `Impuestos/Traslados` del comprobante y nunca se recomputan con una
tasa asumida (`engine.ts:878-882` exige `xmlVerificado`), así que el 8% fronterizo
sale tal cual del papel.

## Lo que NO alcancé a revisar

- **`facturacion/permiso_cre.ts`** (12,625 permisos): lo leí y confirmé que **no tiene
  consumidor real** — el único `grep` de `permisoCre` fuera de su propia prueba es la
  cadena `permiso_cre_no_verificable`. No evalué si la tabla es correcta ni qué haría
  falta para conectarla; es una pregunta de arquitectura más que de norma.
- **`liquidacion/omitidos.ts`, `laboral/pagadero.ts` y `cuadre/resumen.ts`**: solo los
  abrí de paso. `pagadero.ts` cruza LFT 263-I con la deducibilidad y merece una pasada
  propia que no le di.
- **`normas/fundamento.ts` (447 líneas)**: solo verifiqué que discrimina por jerarquía
  (`:357`). No probé si la guardia deja pasar una cita a una ficha
  `evidencia_corroborante` sin el matiz que `normas/README.md` exige ("Sí,
  condicionado").
- **Las 4 fichas de LFPDPPP** (`lfpdppp-*.yaml`): son del rubro legal, no las abrí más
  allá de contarlas para la tabla de estados.
- **`intake/decidir.ts`, `emparejar.ts`, `ocr.ts`**: la clasificación de concepto
  decide qué regla fiscal aplica (un PLUS clasificado como `diesel` invita a un
  estímulo que no existe, y `etiquetaConcepto` lo mitiga solo en el texto). No audité
  el prompt del OCR ni sus umbrales.
- **No verifiqué ninguna norma contra su fuente**: esta ronda corre sin red hacia el
  DOF, el SAT ni diputados.gob.mx. Todo lo que digo sobre el texto de una ley sale de
  la transcripción que la ficha declara; el hallazgo 5 es precisamente que esa
  declaración no es fiable en dos fichas. Cerrar ese hallazgo requiere bajar los PDF,
  y eso no lo hice.
- **`FISCAL_LEGAL.md`** (documento comercial de 200+ líneas): no lo audité. Contiene
  cifras fiscales y es lo que el equipo usa para hablar con clientes.
