# Arquitectura y mantenibilidad — auditoría 4

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**. De los
cuatro hallazgos abiertos, uno se cerró bien y de verdad (el orden de los gastos en
`engine.ts` — verificado corriendo el motor real). Los otros tres siguen intactos, y
uno de ellos va por su **tercera ronda**. Pero lo que baja la nota no es la
reincidencia en abstracto: es que en esta ronda pude **construir el fallo que esa
deuda produjo**. La ausencia de una capa de acceso a datos hizo que el cambio de
`ieps_acreditable` → `litros_diesel_acreditables` (commit `52adedb`) llegara a dos de
sus cuatro consumidores, y `pdf.ts` reconstruye por su cuenta la clasificación de
dinero del motor y ya da un resultado distinto. La misma lógica de dinero vive en más
de un archivo: esa es literalmente el ancla del 4.

**El riesgo mayor del rubro, hoy:** `pdf.ts:314` recalcula "qué gasto quedó fuera de
la deducción" a partir de `diferencias` en vez de usar la clasificación que el motor
ya hizo, y por eso la sección legal que protege al operador (LFT 263-I / 110-I)
aparece o no **según un flag de configuración del tenant** — exactamente la
contradicción que `engine.ts:486-495` documenta haber eliminado del lado fiscal.

---

## Verificación de los abiertos

### 1. [alto, REINCIDENTE — TERCERA RONDA] El panel lee Supabase fuera de `repo.ts`
**Sigue exactamente igual.** El commit `52adedb` tocó `dashboard/page.tsx` pero solo
el componente `Acred` y la tarjeta del hero (`git show 52adedb -- src/app/dashboard/page.tsx`:
el diff son 13 líneas, todas de presentación). `interface LiqRow` y `getLiquidaciones`
están sin tocar en `src/app/dashboard/page.tsx:24-41`, con `supabaseAdmin().from('liquidacion')`,
casts a mano y cero prueba.

Y el alcance es mayor de lo que decía la ronda 3. Conteo de sitios de consulta
(`.from(` + `.rpc(`) por archivo:

| archivo | `.from(` | `.rpc(` |
|---|--:|--:|
| `src/lib/cuadra/repo.ts` | 13 | 3 |
| `src/lib/cuadra/conv.ts` | 8 | 3 |
| `src/lib/cuadra/analytics.ts` | 8 | 0 |
| `src/lib/cuadra/costos.ts` | 3 | 0 |
| `src/lib/cuadra/startup.ts` | 1 | 4 |
| `src/lib/cuadra/config.ts` | 1 | 0 |
| `src/app/dashboard/page.tsx` | 1 | 0 |
| `src/app/api/export/liquidaciones/route.ts` | 1 | 0 |

`repo.ts` concentra **16 de 43**. `MAPA.md:59` sigue diciendo "`repo.ts` es TODO el
acceso a datos". Sobre la sola tabla `liquidacion` hay **cinco listas de columnas
escritas a mano** en cuatro archivos: `analytics.ts:22`, `analytics.ts:110`,
`analytics.ts:136`, `dashboard/page.tsx:29`, `export/liquidaciones/route.ts:23` — y
ninguna en `repo.ts`, que a esa tabla solo escribe (RPC, `repo.ts:332`).
**Reincidente, y ahora con consecuencia medible: ver el hallazgo A.**

### 2. [medio, REINCIDENTE] Lógica de negocio en `tools.ts` sin test
**Sigue igual.** `src/lib/cuadra/tools.ts:79`:

```ts
if (periodo && periodo.estado !== 'holgado' && !fundamentos.includes('rfa-2026-2.9')) fundamentos.push('rfa-2026-2.9');
```

`ls src/lib/cuadra/tools*` devuelve solo `tools.ts`; `grep -rn "tools.test"` no
encuentra nada. Cero prueba directa. `normas/por_diferencia.ts` sigue siendo el
contraejemplo: módulo puro, `por_diferencia.test.ts` exhaustivo, y una lista
`SIN_NORMA` explícita que convierte el olvido en decisión declarada.

### 3. [medio, REINCIDENTE] `laboral/pagadero.ts` solo llega al PDF
**Sigue igual, y ahora también sé que el único camino que existe está roto.**
`grep -rn "resumenLaboral\|veredictoLaboral\|topeDescuento" src/` fuera del propio
módulo devuelve **una sola línea**: `src/lib/cuadra/liquidacion/pdf.ts:312`.
`cuadre/resumen.ts` (85 líneas, leído completo) no lo menciona. `topeDescuento` sigue
con cero consumidores. Ver además el hallazgo A: ese único consumidor deja de
activarse en la configuración por defecto del demo.

### 4. [medio] `engine.ts` dependiente del ORDEN de los gastos — **CERRADO**
Verificado corriendo `cuadrarViaje` real (vite-node, importando el módulo del repo)
con los mismos hechos del reporte anterior:

```
g1=$400 IVA 16% ($64) | g2=$500 IVA 8% ($40) | mismo día | tope $750
orden [g1, g2] → ivaAcreditable = 86.67
orden [g2, g1] → ivaAcreditable = 86.67
```

Ya no hay $12 de diferencia. El arreglo (`engine.ts:333`, `369-370`, `434`) es el
correcto de fondo: la proporción deducible se calcula **del día** (`tope/total`) y
cada comprobante la hereda por `Map<gastoId, proporción>`, en vez de deducirla del
monto de la diferencia colgada del ancla. La diferencia sigue colgada del último
gasto (`engine.ts:376`) pero eso ya no decide el prorrateo, que era el problema.
Buen cierre; es lo que impide que la nota baje más.

---

## Hallazgos

### A. [ALTO] `pdf.ts` reconstruye la clasificación de dinero del motor y ya da otro resultado: la sección legal del operador depende de un flag de configuración
`src/lib/cuadra/liquidacion/pdf.ts:16-19` (`NO_DEDUCIBLES_PDF`) y `pdf.ts:314-316`
· contra `src/lib/cuadra/cuadre/engine.ts:496-512` (`NO_DEDUCIBLE_ISR`, `POR_CONFIRMAR`, `if (!g.cfdiUuid)`)

El motor clasifica cada gasto en tres cubetas. Para "por confirmar" usa **dos**
criterios: el tipo de diferencia (`engine.ts:506`) **y** la ausencia de UUID
(`engine.ts:512`, `if (!g.cfdiUuid) { totalPorConfirmar += g.monto; continue; }`).
`pdf.ts:315` reconstruye lo mismo con **un solo** criterio —
`d.tipo === 'sin_cfdi' || d.tipo === 'combustible_efectivo'` — y `sin_cfdi` solo se
emite si la política del tenant trae `requiereCfdi` (`engine.ts:176`).

**Escenario, reproducido con el PDF real** (motor real + `generarLiquidacionPDF` real,
descomprimiendo los content streams y decodificando los `Tj`):

Ticket de hotel de **$2,000 sin timbrar**, con `DEMO_CONFIG.politica` tal cual
(`config.ts:66-73`: solo `factura` trae `requiereCfdi: true`; `hospedaje`, `diesel`,
`caseta`, `alimentacion`, `transporte` no):

```
motor : deducible=0  noDeducible=0  porConfirmar=2000   diferencias=[]
PDF   : "Por confirmar $2,000.00 / Falta timbrar la factura... Se puede recuperar."  → SÍ
PDF   : "LO QUE SE LE REEMBOLSA AL OPERADOR"                                        → NO
```

Mismos hechos, mismo dinero, con `requiereCfdi: true` en `hospedaje`:

```
motor : deducible=0  noDeducible=0  porConfirmar=2000   diferencias=['sin_cfdi']
PDF   : "Por confirmar"                                                             → SÍ
PDF   : "LO QUE SE LE REEMBOLSA AL OPERADOR"                                        → SÍ
PDF   : "...no autoriza descontárselo"                                              → SÍ
```

**Consecuencia:** el contralor recibe un papel que dice "Por confirmar $2,000" y
**nada** que le diga que ese dinero se le reembolsa al operador igual. La sección
existe precisamente para impedir la lectura "no deducible ⇒ se lo descuento", que la
LFT no permite; y aparece o desaparece según un flag de la política de la flota, no
según la ley. En la configuración por defecto del demo, **desaparece** para todo lo
que no sea `factura`. Es la misma contradicción que `engine.ts:486-495` describe
haber cerrado del lado fiscal ("el veredicto dependía de un flag de configuración, no
de la ley"), resucitada en otro archivo.

Además `NO_DEDUCIBLES_PDF` (pdf.ts:16-19) es hoy una copia literal, miembro por
miembro, de `NO_DEDUCIBLE_ISR` (engine.ts:496), sin ninguna prueba de sincronía —
mientras que el mapa `CONCEPTO`, que se desincronizó dos veces, sí la tiene
(`etiquetas_sincronizadas.test.ts`). Si alguien mueve un tipo entre cubetas en el
motor, el PDF no se entera.

**Causa raíz probable:** el motor devuelve totales agregados pero no el
`gastoId → cubeta` que los produjo, así que cada consumidor lo reconstruye a mano
desde `diferencias`, que es una vista parcial de la decisión.

### B. [ALTO] El dato que sustituyó al IEPS llegó a dos de sus cuatro consumidores; en `resumen.ts` quedó una rama que ya no puede ejecutarse
`src/lib/cuadra/cuadre/engine.ts:404-408` (`const iepsAcreditable = 0`)
· `src/lib/cuadra/cuadre/resumen.ts:71,73`
· `src/lib/cuadra/analytics.ts:136` y `src/app/dashboard/[id]/page.tsx:35,73`

`engine.ts:408` fija `iepsAcreditable = 0` **como `const`, a propósito**, y el dato
útil pasa a ser `litrosDieselAcreditables`. Ese cambio se propagó a `repo.ts:335`,
`pdf.ts:270,290`, `analytics.getAcreditables` (`analytics.ts:110`) y al hero del panel
(`dashboard/page.tsx:102`). **No** se propagó a:

- `resumen.ts:71,73` — el mensaje de WhatsApp. La condición `liq.iepsAcreditable > 0`
  ya no puede ser verdadera nunca: la línea 73 (`• IEPS diésel: …`) es código muerto.
- `analytics.ts:136` — el `select` del detalle sigue pidiendo `ieps_acreditable` y
  **no** pide `litros_diesel_acreditables`, así que `dashboard/[id]/page.tsx:73`
  nunca puede mostrarlo.

**Escenario, reproducido con el motor y el PDF reales.** Un CFDI de diésel de $8,100
con complemento, pagado con tarjeta (`formaPago: '03'`), 300 L en `ocrExtra`:

```
motor: litrosDieselAcreditables = 300   iepsAcreditable = 0   ivaAcreditable = 1116

PDF (texto extraído):
  "Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A)   300 L"

Mensaje de WhatsApp (resumenCuadre, tal cual sale de processor.ts:555):
  Listo, cuadré tu viaje 👇
  • Comprobado: $8,100.00
  • Anticipo: $8,100.00
  • Cuadra exacto ✅

  Acreditable (recuperable):
  • IVA: $1,116.00           ← y nada más. Los 300 L no aparecen.
```

**Consecuencia:** el estímulo de diésel es el beneficio más grande que Likida le
enseña a una flota, y en el canal sobre el que se vende el producto no existe. En el
panel es peor por incoherente: el contralor ve "1,850 L elegibles" en la tarjeta
destacada de la lista, hace clic en la liquidación que los produjo, y en el detalle no
hay ninguna mención — porque el `select` de esa página no trae la columna. Es la
pregunta que se hace en voz alta en la sala.

**Causa raíz probable:** cinco listas de columnas escritas a mano sobre la misma
tabla, ninguna en `repo.ts` (hallazgo 1) — cuando cambia el significado de una
columna, no hay un solo lugar donde cambiarlo. Es la factura del hallazgo reincidente.

### C. [MEDIO] El descargo legal de WhatsApp está detrás de una rama que ningún llamador puede alcanzar, y hay un test verde que la cubre
`src/lib/cuadra/cuadre/resumen.ts:81` · `src/lib/cuadra/cuadre/leyendas.ts:19`
· `src/lib/cuadra/cuadre/liquidacion_completa.test.ts:133`

`leyendas.ts:19` declara `LEYENDA_CORTA` como *"Para WhatsApp y el dashboard"*, y
`resumen.ts:81` la emite solo `if (destinatario === 'contralor')`. Los **tres**
llamadores de `resumenCuadre` que existen en producción pasan `'operador'`:

```
src/lib/cuadra/processor.ts:487   resumenCuadre(liq, false, 'operador')
src/lib/cuadra/processor.ts:555   resumenCuadre(await cuadrarDesdeDB(...), true, 'operador')
src/lib/cuadra/cuadre/guardia.ts:79  resumenCuadre(liq, cuadro, 'operador')
```

(verificado con `grep -rn "resumenCuadre" src/` — no hay más). El default
`'contralor'` de `resumen.ts:45`, con su comentario sobre por qué es el default
seguro, no lo usa nadie.

**Escenario:** el mensaje de WhatsApp con las cifras del cuadre **nunca** lleva
descargo. La única prueba que cubre eso, `liquidacion_completa.test.ts:133` ("al
contralor sí le llega el descargo de responsabilidad"), pasa en verde llamando
`resumenCuadre(r, true, 'contralor')` — una forma de llamada que el producto no
produce. El filtro `SOLO_CONTRALOR` (`resumen.ts:24-28`) tiene el mismo problema: hoy
recorta lo mismo en el 100% de los mensajes, y su rama "el contralor sí lo ve" no
existe. `LEYENDA_INLINE` (`leyendas.ts:25-27`) tiene cero consumidores.

**Consecuencia:** para el equipo, un test verde que garantiza algo que el producto no
hace — la peor clase de test, porque desactiva la sospecha. Para el negocio, el
propio comentario de `leyendas.ts:1-16` explica que el descargo es la mitigación
frente al Anexo 3 de la RMF 2026 y a los arts. 89-90 del CFF; esa mitigación no sale
por el canal principal.

**Causa raíz probable:** se construyó la abstracción `Destinatario` antes de que
existiera el segundo canal, y el test la validó en aislamiento en vez de en el camino.

### D. [BAJO] `catalogoCuentas` es una novena copia de la lista de conceptos con cero consumidores
`src/lib/cuadra/config.ts:29,82-88` · `src/lib/cuadra/export.ts:4-13`

`grep -rn "catalogoCuentas\|catalogo_cuentas" src/` devuelve **solo la declaración del
tipo y el literal de `DEMO_CONFIG`**: nadie lo lee. `toLiquidacionRows`
(`export.ts:42-51`) no tiene columna de cuenta contable, así que el CSV que va al ERP
no la lleva.

**Escenario de mantenimiento:** alguien añade un concepto a `ConceptoGasto`
(`types/cuadra.ts`). `etiquetas_sincronizadas.test.ts` obliga a añadirlo en
`engine.ts:557`, `pdf.ts:31` y `dashboard/[id]/page.tsx:15` — pero `catalogoCuentas`
queda sin él y nada falla, porque nada lo mira. El día que alguien conecte el
mapeo contable al export, la mitad de los conceptos saldrá sin cuenta y el síntoma
será una importación al ERP con filas rechazadas.

**Consecuencia:** para el equipo, una cuarta copia de la misma lista fuera del único
mecanismo que las mantiene sincronizadas. Para la venta, una promesa de configuración
("concepto → cuenta contable") que no está implementada.

**Causa raíz probable:** config escrita para el demo antes que su consumidor.

---

## Lo que revisé y está bien

- **`engine.ts` sigue siendo puro.** Dos búsquedas independientes
  (`grep -n "new Date()\|Date.now()\|process.env\|Math.random\|randomUUID\|fetch("`
  y `grep -rn "new Date\b"`) sobre `cuadre/`, `normas/`, `periodo/`, `laboral/`,
  `liquidacion/` y `facturacion/`: **cero** lecturas de reloj, entorno, red o
  aleatoriedad en el motor. El único `new Date()` del camino de dinero está en el
  borde, `cuadre/desde_db.ts:17,36`, inyectado como `hoy` — exactamente donde debe
  estar. Esta es la mejor propiedad arquitectónica del repo y aguantó el reorden de
  `59bc958`.
- **El ejemplo canónico del rubro está cerrado por MECANISMO, no a mano.**
  `src/lib/cuadra/etiquetas_sincronizadas.test.ts` compara los tres literales de
  concepto (`engine.ts:557`, `pdf.ts:31`, `dashboard/[id]/page.tsx:15`) claves y
  valores, contra `ConceptoGasto`, y hace lo mismo con `ESTATUS` en las dos páginas
  del panel. `otro: 'Gasto'` vs `otro: 'Otro'` ya no puede volver a pasar en
  silencio. Es el patrón correcto y es lo que le falta a `NO_DEDUCIBLES_PDF`
  (hallazgo A).
- **El arreglo de `59bc958` en `engine.ts` no abrió nada por el lado del orden.** Con
  el `Map<gastoId, proporción>` (`engine.ts:333,369-370,434`), el prorrateo ya no
  depende de qué gasto quedó de ancla; verificado con las dos permutaciones.
- **`repo.ts:42,48-50` (`getViaje` + `demoraNoImputable`) quedó bien conectado.** El
  `?? undefined` en vez de `|| false` es la decisión correcta (NULL = "sin
  determinar" ≠ "sí imputable") y el comentario explica el porqué.
- **`normas/por_diferencia.ts` y `normas/indice.ts`** siguen siendo el buen patrón:
  puros, con test de sincronía contra los YAML (`normas_sincronizadas.test.ts`) y
  lista `SIN_NORMA` explícita.
- **`duplicados.ts`** se sacó de Supabase y quedó puro y testeado; la lógica de
  "mismo comprobante entre viajes" vive en un solo sitio y `analytics.ts:86` solo le
  da de comer filas.
- **Línea base intacta:** `npm test` → 50 archivos, **501 tests**, todos verdes. No
  rompí ni toqué nada del repo; los scripts de reproducción viven en
  `/tmp/.../scratchpad/` (`repro1.ts` … `repro5.ts`, `pdftext.ts`).

---

## Lo que NO alcancé a revisar

- **`conv.ts` (11 sitios de consulta), `costos.ts` (3) y `startup.ts` (5).** Los conté
  para el hallazgo 1 pero **no audité sus fronteras internas ni su semántica**. Son,
  juntos, más sitios de acceso a datos que `analytics.ts`, y ninguno tiene dueño
  declarado en `MAPA.md`.
- **`src/lib/agents/` y `src/lib/llm/`** — dónde vive el prompt, cómo se registra una
  tool, si `registry.ts` y `prompts.ts` duplican la lista de tools. Es frontera real
  y la dejé fuera por solaparse con el rubro de tool calling.
- **`intake/`** (10 módulos): no revisé si `concepto.ts`, `emparejar.ts` y
  `decidir.ts` comparten o duplican la noción de "qué es el mismo gasto" con
  `duplicados.ts` y con el bloque 0 de `engine.ts:79-95`. Vi una divergencia menor
  (`engine.ts:90` normaliza con `strip_accents`, `duplicados.ts:65` no) que no pude
  convertir en un caso que falle, porque `ConceptoGasto` no tiene acentos hoy.
- **El acoplamiento `supabase/migrations/` ↔ tipos de TS.** No verifiqué columna por
  columna que `schema.sql` y las 23 migraciones coincidan con lo que los `select` de
  arriba piden; sin base de datos aquí, un desajuste solo se ve en runtime.
- **`facturacion/comercios.ts` (230 líneas)** y `intake/ocr.ts` (351) — los dos
  archivos grandes que no toqué.
- **No leí `docs/auditoria-3/backend-datos-pruebas.md` ni `fiscal.md`**, así que puede
  haber solape con hallazgos que esos auditores ya cerraron por su lado.
