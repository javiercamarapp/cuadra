# Pruebas — auditoría 8

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió**. Los tres
CRÍTICOS que la ronda 7 dejó abiertos en este rubro se atacaron y dos cerraron
con el mutante en la mano: **PR-1 muere** (`conv.ts:73` `.limit(2)→.limit(1)` →
1 roja) y la **escritura de la liquidación**, que en la ronda 7 sobrevivía 6 de 6,
hoy muere en **4 de 4** (`p_ieps`, `p_litros_diesel`, `p_diferencias`,
`p_pdf_url`). El MEDIO de `verificaciones.sql` cerró con una red estructural
(`migraciones_verificadas.test.ts`) y el MEDIO del CI cerró para su caso literal
(quitarle `duplicados` al paso sin instrumentar ahora pone 1 roja). No sube más
porque la ronda inventó una forma de anclar —**leer el fuente de producción como
texto en vez de ejecutarlo**— y con ella tres arreglos de dinero de esta misma
ronda se pueden desactivar dejando la línea escrita, con la suite en 1262 verdes.

**Riesgo mayor del rubro, hoy:** puedo apagar el detector de vouchers
(`ocr.ts:432`), quitarle el snapshot de AG-3 a `guardar_liquidacion`
(`tools.ts:200`) y vaciar los fundamentos de AG-2 (`tools.ts:64`) —los tres
arreglos de dinero de esta ronda, incluidos los dos CRÍTICOS que el MAPA da por
cerrados— y las 1262 pruebas siguen verdes en las tres.

---

## La medición de mutantes

**Método.** Copia del árbol fuera del repo (`tar` al scratchpad de la sesión,
`node_modules` symlinkeado). Confirmé la copia fiel corriendo `npx vitest run`
antes de mutar: **127 archivos, 1262 pasan, 1 saltada**, idéntico a la línea base
del MAPA. Cada mutación se aplicó con un script de sustitución **única**
(`assert count(old) == 1`), se corrió la suite completa, y el archivo se restauró
desde el original antes de la siguiente. El repo real no se tocó ni una vez.

**Selección.** Una mutación por cada corrección de producción de los 34 commits
de `abdc98d..HEAD`, sobre la línea exacta que el commit escribió.

### Las 36 mutaciones sobre el código de la ronda 8

| # | Mutación | `archivo:línea` | Antes | Después |
|---|---|---|---|---|
| PR1 | `resolveOperador`: `.limit(2)` → `.limit(1)` | `conv.ts:73` | 1262 pasan | **1 falla** |
| W1 | `p_litros_diesel: liq.litros… ?? 0` → `0` fijo | `repo.ts:406` | 1262 | **1 falla** |
| W2 | `p_ieps: liq.iepsAcreditable` → `liq.ivaAcreditable` | `repo.ts:405` | 1262 | **1 falla** |
| W3 | `p_diferencias: liq.diferencias` → `[]` | `repo.ts:404` | 1262 | **1 falla** |
| W4 | `p_pdf_url: pdfUrl ?? null` → `null` fijo | `repo.ts:409` | 1262 | **1 falla** |
| A1 | AG-3: `snapshotCierre ?? cuadrarDesdeDB` → siempre recalcula | `guardia.ts:106` | 1262 | **1 falla** |
| A2 | `resumenCuadre(liq, cerro,…)` → `cuadro` | `guardia.ts:114` | 1262 | **1 falla** |
| A3 | `litros(liq.litrosDiesel…)` → `${…} L` a mano | `resumen.ts:83` | 1262 | **1 falla** |
| B1 | barrera: `incrementado == null` → `=== undefined` | `processor.ts:336` | 1262 | **2 fallan** |
| B2 | el `+1` fallido deja de liberar su claim | `processor.ts:349` | 1262 | **1 falla** |
| B3 | el mutex perdido vuelve a callarse y no libera | `processor.ts:643` | 1262 | **1 falla** |
| B4 | `ctxCerro = closed` del cierre parcial | `processor.ts:770` | 1262 | **1 falla** |
| B5 | `EMPAREJAN` pierde `'solo_pago'` | `processor.ts:384` | 1262 | **2 fallan** |
| **B6** | `if (llegoTarde(e))` → `if (false && llegoTarde(e))` | `processor.ts:484` | 1262 | **1262 pasan** |
| B7 | `confirmarEnvioAviso(...)` deja de llamarse | `processor.ts:186` | 1262 | **1 falla** |
| B8 | `decidirFoto` pierde `\|\| r.motivo === 'solo_pago'` | `decidir.ts:28` | 1262 | **5 fallan** |
| C1 | el motor deja de marcar la nota no fiscal | `engine.ts:251` | 1262 | **1 falla** |
| **C2** | `comprobante_no_fiscal` sale de `REVISAR` | `engine.ts:779` | 1262 | **1262 pasan** |
| **C3** | AG-2: `normasDePolitica(config.politica)` → `[]` | `tools.ts:64` | 1262 | **1262 pasan** |
| **C4** | `NORMAS_DE_PISO` → `[]` | `por_diferencia.ts:125` | 1262 | **1262 pasan** |
| **C5** | AG-3: la tool deja de devolver `liq` | `tools.ts:200` | 1262 | **1262 pasan** |
| C6 | `clavesPeaje: CLAVES_PEAJE` → lista a mano | `config.ts:102` | 1262 | **1 falla** |
| C7 | vuelve el default `clavesPeaje = CLAVES_PEAJE` | `concepto.ts:47` | 1262 | **1 falla** |
| D1 | `litros()`: `maximumFractionDigits: 2` → `0` | `formato.ts:54` | 1262 | **4 fallan** |
| D2 | `fechaMx` pierde `timeZone: TZ_MX` | `formato.ts:75` | 1262 | **3 fallan** |
| **D3** | `soloPago` → `false && …` (el voucher vuelve a entrar) | `ocr.ts:432` | 1262 | **1262 pasan** |
| D4 | `MARCA_NO_FISCAL` deja de emitirse | `ocr.ts:417` | 1262 | **1 falla** |
| D5 | `'desconocido'` → `'sin_permiso'` (no sé = no hay) | `permiso_cre.ts:132` | 1262 | **2 fallan** |
| D6 | `P[LT]` → `PL` en `FORMA_PERMISO` | `permiso_cre.ts:81` | 1262 | **2 fallan** |
| D7 | vuelve `cuadra.mx` al pie del PDF | `pdf.ts:393` | 1262 | **2 fallan** |
| **D8** | sonda 0031: `select('intake_pendientes_en')`→`select('id')` | `startup.ts:100` | 1262 | **1262 pasan** |
| **D9** | sonda 0033: `if (e33)` → `if (false && e33)` | `startup.ts:169` | 1262 | **1262 pasan** |
| D10 | `liberar_aviso_privacidad` → `confirmar_…` | `repo.ts:492` | 1262 | **1 falla** |
| D11 | `constancia_sin_fila` deja de registrarse | `repo.ts:513` | 1262 | **1 falla** |
| D12 | `pendiente: !contacto` → `false` (art. 29) | `privacidad.ts:530` | 1262 | **2 fallan** |
| E1 | CI: `npx vitest run fundamento duplicados` → `fundamento` | `ci.yml:76` | 1262 | **1 falla** |

**Resultado: 8 de 36 sobreviven — 22%.** Contra la serie **57% (r5) → 83% (r6) →
19% (r7) → 22% (r8)**. Plano frente a la ronda 7, con un denominador el doble de
grande (36 contra 16) y con **cero mutantes equivalentes que descontar**: los
ocho supervivientes cambian comportamiento observable.

**Dos mediciones más, fuera del denominador:**

| # | Mutación | `archivo:línea` | Resultado |
|---|---|---|---|
| B6b | la rama de `llegoTarde` pierde su `return` (el error vuelve a subir) | `processor.ts:486` | **1262 pasan** |
| E8 | un `skipIf` por constante intermedia en un archivo fuera de los filtros del CI | `barrera.test.ts:17` | **1262 pasan** |

### La escritura del dinero: de 6 de 6 sobrevivientes a 0 de 4

Era el riesgo mayor que dejó la ronda 7. `repo_escritura.test.ts:110-131` ahora
lista los **doce** parámetros de `guardar_liquidacion_tx` y el fixture tiene
valores distintos entre sí a propósito (`iepsAcreditable: 1477.35` contra
`ivaAcreditable: 663.79`), así que una permutación también se ve. W1–W4 mueren
las cuatro. **Cerrado y verificado.**

### La deuda de la ronda 7, remedida: 6 de 7 siguen vivas

| # | Mutación | `archivo:línea` | Hoy |
|---|---|---|---|
| E3 | `if (!avisoPuesto)` → `if (false && !avisoPuesto)` | `processor.ts:297` | **SIGUE VIVA** — 1262 pasan |
| E4 | `getDatosResponsable` pierde el guard de razón social y domicilio | `repo.ts:451` | **SIGUE VIVA** — 1262 pasan |
| E5 | `LARGO_MINIMO` de 24 a 1 | `passcode.ts:115` | **SIGUE VIVA** — 1262 pasan |
| E6 | `litros > 0` → `litros !== 0` | `acreditable.ts:94` | **SIGUE VIVA** — 1262 pasan |
| E7 | `ctxCerro = closed` del camino feliz | `processor.ts:723` | **SIGUE VIVA** — 1262 pasan |
| R-M10 | el portón `if (derivoLaConfig(...)) return null` deja de correr | `analytics.ts:341` | **SIGUE VIVA** — 1262 pasan |
| R-M18 | `antes.size !== ahora.size` se borra | `analytics.ts:391` | cerrada — 1 roja |

---

## Estado de PR-1

**CERRADO.** Verificado con el mutante real, no por lectura del commit:

```
$ (copia del árbol)  conv.ts:73   .limit(2) → .limit(1)
Test Files  1 failed | 126 passed (127)
Tests       1 failed | 1261 passed | 1 skipped (1263)
 × src/lib/cuadra/conv_directo.test.ts > resolveOperador >
   con DOS operadores activos para el mismo teléfono, se niega a elegir
```

El arreglo es real y está en el sitio correcto: `conv_directo.test.ts:43-48`
ya no declara `limit` entre los métodos que solo devuelven el enlace; guarda el
argumento en `limiteFilas` y el `then()` **trunca el array de `data` a ese
tamaño** antes de resolver, replicando el efecto de PostgREST. Con `.limit(1)` el
mock devuelve una fila, `resolveOperador` deja de ver la ambigüedad y la prueba
cae. Es el arreglo que la ronda 7 pidió, con la semántica y no solo con la forma.

---

## Estado del CI

**Corre en cada push, en todas las ramas, y ahora corre también lo que
`--coverage` apaga.** `ci.yml:75-76` añade *"Pruebas de tiempo (sin cobertura)"*
(`npx vitest run fundamento duplicados`) y `pruebas_en_ci.test.ts` lo vigila:
quitarle `duplicados` al comando pone 1 roja (E1). Verifiqué además que la puerta
de cobertura de verdad pasa hoy, que es lo que CI evalúa y el MAPA no midió:

```
$ npx vitest run --coverage
Test Files  127 passed (127)
Tests       1260 passed | 3 skipped (1263)
Statements  84.97%   Branches 85.27%   Functions 87.86%   Lines 84.97%
(umbrales: 78 / 84 / 83)
```

Los 127 archivos `*.test.ts` del repo están todos bajo `src/` y todos entran en
el `include` por defecto de vitest; los seis `pruebas-manuales/*.prueba.ts` están
fuera por nombre y no los corrí. Lo que **no** cubre el CI está en el hallazgo
MEDIO de abajo.

---

## Hallazgos

### [CRÍTICO] El detector de vouchers —el arreglo que quitó $1,600 de comprobado fantasma— está anclado por un `grep` sobre el fuente, no por una ejecución

`src/lib/cuadra/intake/ocr.ts:432` · `src/lib/cuadra/intake/voucher.test.ts:80-87`

**Escenario.** Con el mutante `const soloPago = false && data.documento === 'voucher_pago' …`:

```
D3  ocr.ts:432   →  Test Files 127 passed (127)
                    Tests 1262 passed | 1 skipped (1263)
```

`voucher.test.ts` es el archivo mejor argumentado de la ronda —14 fotos reales,
cuatro pares voucher+ticket, $1,600 duplicados sobre $1,600 de gasto real— y sus
tres aserciones sobre el portón son:

```ts
const OCR = sinComentarios(readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8'));
expect(OCR).toMatch(/documento === 'voucher_pago'/);
expect(OCR).toMatch(/!gasto\.rfcEmisor/);
expect(OCR).toMatch(/litros == null/);
```

Las tres cadenas siguen ahí con el mutante puesto. Lo que sí se ejecuta —los
cuatro casos de `decidirFoto` y los cinco del motor— arranca **después** de que
alguien fijó `motivo: 'solo_pago'` a mano en el fixture (`:44`): prueban el
consumidor, nunca el productor. Con `soloPago` apagado, `legible` vuelve a ser
`true`, `motivo` vuelve a `undefined`, y `decidirFoto` devuelve `alta`.

**Consecuencia.** Vuelve el bug medido: en cada carga de diésel el operador
fotografía los dos papeles que escupe la bomba, los dos entran como gasto, y la
liquidación reporta el doble de comprobado. Sobre las cifras del propio archivo,
$3,200 comprobados donde hubo $1,600 — dinero que el contralor le repone al
operador dos veces, y una diferencia que el motor no puede detectar porque su
llave de dedup es `concepto|folio|monto` y los folios difieren.

**Causa raíz probable.** El arnés que hacía falta ya existe y no se amplió:
`ocr_motivo.test.ts` mockea `generateStructured` y corre `extraerComprobante` de
verdad; añadir un caso con `documento: 'voucher_pago'` habría matado el mutante.

---

### [CRÍTICO] La mitad productora de AG-3 no tiene prueba: la tool puede dejar de mandar el snapshot y la guardia vuelve a recalcular, en verde

`src/lib/cuadra/tools.ts:200` · `src/lib/cuadra/cuadre/guardia.ts:70-73` · `src/lib/cuadra/tools_cableado.test.ts`

**Escenario.** AG-3 tiene dos mitades: `guardar_liquidacion` devuelve `liq`
dentro de su `result`, y `guardiaCifras` lo reusa en vez de llamar
`cuadrarDesdeDB`. La mitad consumidora está anclada (A1 mata 1 prueba). La
productora no. Con el mutante que borra `liq,` del objeto que devuelve la tool:

```
C5  tools.ts:200   →  Test Files 127 passed (127)
                      Tests 1262 passed | 1 skipped (1263)
```

`snapshotCierre` queda `undefined`, el `??` de `guardia.ts:106` cae al
`await cuadrarDesdeDB(tenantId, viajeId)`, y el sistema vuelve exactamente al
estado de antes de `2f79174`.

**Consecuencia.** Es el CRÍTICO AG-3 palabra por palabra: entre T1 (la tool
imprime los dos PDF) y T2 (la guardia arma el texto) las fotos entrantes no toman
mutex, así que un comprobante que llega en esa ventana hace que el PDF archivado
y el WhatsApp narren dos cuadres distintos del mismo cierre — *"Sobró $150"*
contra *"Pusiste $650 de tu bolsa"*, $800 y de signo contrario. El MAPA lo lista
como cerrado y lo está en el código; en la suite no lo está.

**Causa raíz probable.** `tools_cableado.test.ts` **ya ejecuta ese handler** por
`executeTool('guardar_liquidacion', …)` y afirma sobre `r.result.pdf_generado`
(`:139`); nadie añadió la línea gemela sobre `r.result.liq`.

---

### [CRÍTICO] La prueba de AG-2 reimplementa dentro del archivo de prueba lo que devuelve `consultar_politica`; la tool real no la ejecuta ninguna prueba

`src/lib/cuadra/normas/permiso_politica.test.ts:32-44` · `src/lib/cuadra/tools.ts:64` · `src/lib/cuadra/normas/por_diferencia.ts:125`

**Escenario.** El arreglo de AG-2 vive en `tools.ts:64-74`: `consultar_politica`
llama `normasDePolitica(config.politica)` y emite los `norma_id` que
`guardiaFundamento` necesita para no borrar las citas. La prueba que dice
cubrirlo declara en su encabezado *"Lo que `consultar_politica` devuelve hoy"* y
acto seguido **lo vuelve a escribir**:

```ts
const resultadoDeLaTool = () => {
  const ids = normasDePolitica(DEMO_CONFIG.politica);
  return { politica: DEMO_CONFIG.politica, fundamentos: ids.map((id) => ({ norma_id: id, … })) };
};
```

Ningún archivo de prueba del repo importa `./tools` salvo `tools_cableado.test.ts`,
y ése solo llama `guardar_liquidacion`. Medido:

```
C3  tools.ts:64            const fundamentos = normasDePolitica(...) → []   → 1262 pasan
C4  por_diferencia.ts:125  NORMAS_DE_PISO = []                             → 1262 pasan
```

C4 sobrevive por un motivo distinto y vale la pena decirlo: las dos únicas
aserciones sobre las normas de piso (`:56-57`) usan `DEMO_CONFIG.politica`, que
ya trae `diesel` y `alimentacion` y por tanto arrastra `lisr-27-fr-III` y
`lisr-28-fr-V` por la vía de concepto. La red existe y está tapada por el
fixture: para un tenant cuya política no traiga esos conceptos, el mutante deja
`normasDePolitica` en `[]` sin que nada falle.

**Consecuencia.** Es el escenario de la sala del 6-ago: cerrada la liquidación,
el contralor pregunta *"¿y en qué se basan para no contarme ese diésel?"*. Sin
`fundamentos`, `permitidas` vuelve a `[]`, toda cita cae en `CITA_DESCONOCIDA`
y la frase sale rota delante del comprador — *"Te aplica el estímulo conforme al
-A."*, con el estímulo del diésel, que es lo que se vende. La prueba con nombre
propio va a hacer creer que la ruta está protegida.

**Causa raíz probable.** Es el mismo patrón que la ronda 7 reportó sobre
`analytics_deriva.test.ts` —una copia de la verdad dentro del arnés que existe
para impedir copias— reaparecido en otro archivo la ronda siguiente.

---

### [ALTO] La nota no fiscal levanta su diferencia pero puede dejar de mandar la liquidación a revisión, y ninguna prueba mira el `estatus`

`src/lib/cuadra/cuadre/engine.ts:779` · `src/lib/cuadra/intake/voucher.test.ts:138-176`

**Escenario.** Con el mutante que saca `'comprobante_no_fiscal'` de la lista
`REVISAR`:

```
C2  engine.ts:779   →  Test Files 127 passed (127)
                       Tests 1262 passed | 1 skipped (1263)
```

Las cinco pruebas de *"la nota no fiscal, en pesos"* verifican
`totalComprobado`, `totalDeducible`, el tipo de la diferencia, su `monto: 0`, su
nota y su `gastoId` — **nunca `liq.estatus`**. Medido importando el motor real
con un gasto de caseta de $500 contra $500 de anticipo, que es el caso en que el
resto de señales callan:

```
marca = true       → estatus: revisar   difs: ['comprobante_no_fiscal']
marca = undefined  → estatus: cuadrada  difs: []
```

Con el mutante, la primera línea pasa a `cuadrada`.

**Consecuencia.** La liquidación con un papel que dice de sí mismo que no ampara
deducción sale marcada como **cuadrada** y nunca aparece en la bandeja del
contralor. La diferencia queda escrita en un campo que ya nadie va a abrir, y la
oficina no pide la factura que el CFF 29-A exige. El gasto se deduce de facto.

**Causa raíz probable.** El fixture de esas cinco pruebas tiene $500 de anticipo
contra $116 de gasto, así que el `estatus` sale distinto de `cuadrada` por la
diferencia de $384 aunque el tipo no esté en `REVISAR`; nadie eligió un caso
donde el `estatus` dependa solo de la marca.

---

### [ALTO] El aviso del gasto que llega tarde (mig. 0036) tampoco lo ejecuta ninguna prueba: se ancla leyendo `processor.ts` como texto

`src/lib/cuadra/processor.ts:484-487` · `src/lib/cuadra/gasto_tarde.test.ts:47-69`

**Escenario.** Dos mutantes, los dos verdes:

```
B6   processor.ts:484  if (llegoTarde(e)) → if (false && llegoTarde(e))   → 1262 pasan
B6b  processor.ts:486  la rama pierde su `return` (el error vuelve a subir) → 1262 pasan
```

Las tres pruebas del segundo `describe` hacen
`P.indexOf('llegoTarde(e)')`, cortan 700 caracteres del fuente y buscan
`sendText`, `/llegó después|NO entró/` y `mxn(gasto.monto)`. Con el mutante todas
esas cadenas siguen escritas. Lo que sí se ejecuta —el primer `describe`— prueba
`llegoTarde()` como predicado puro, que es correcto y muere si se rompe; el
cableado no.

**Consecuencia.** Con B6 el gasto tardío vuelve a caer en el `throw e` de
`:488`: el operador manda su foto, la liquidación ya está emitida, la base la
rechaza con `CU001`, y él no recibe nada — el gasto no queda en ningún lado y
nadie se lo dice. Con B6b recibe el aviso **y además** el flujo lanza, con lo que
el mensaje entra al camino de error genérico. Es dinero que el operador puso y
que no se le repone.

**Causa raíz probable.** El arnés de `processInbound` con `addGasto` mockeado ya
existe (`processor_intake_delta_falla.test.ts`); la rama nueva se ancló con un
`readFileSync` en vez de con un `mockRejectedValue({ code: 'CU001' })`.

---

### [ALTO · REINCIDENTE] El portón que impide que el panel contradiga al PDF archivado sigue sin ejecutarse en ninguna prueba

`src/lib/cuadra/analytics.ts:341` · `src/lib/cuadra/analytics_deriva.test.ts`

**Escenario.** La ronda 7 lo reportó como CRÍTICO con dos mutantes vivos. Esta
ronda exportó `derivoLaConfig` (`analytics.ts:385`) y el archivo de prueba dejó de
llevar su copia local. La mitad pura cerró; el cableado no:

```
R-M18  analytics.ts:391  `antes.size !== ahora.size` se borra   → 1 roja      (cerrado)
R-M10  analytics.ts:341  el portón deja de ejecutarse           → 1262 pasan  (VIVO)
```

**Consecuencia.** Si alguien quita el portón en un refactor, el detalle del panel
vuelve a recalcular con la config de hoy y a enseñarle al contralor una
deducibilidad distinta de la del PDF que ya mandó a su contador, sin marca de
recálculo. Es la misma consecuencia que la ronda 7 escribió, y la mitad que
sobrevive es la que la produce.

**Causa raíz probable.** Se atacó exportando la función (lo barato) en vez de
llegar al portón por `getLiquidacionDetalle`, que sí está mockeable
(`analytics.test.ts:48`).

---

### [MEDIO · REINCIDENTE] Las dos sondas de arranque nuevas (0031 y 0033) se pueden desactivar con la suite en verde

`src/lib/cuadra/startup.ts:100` y `:169` · `src/lib/cuadra/startup_diagnostico.test.ts`

**Escenario.**

```
D8  startup.ts:100  admin.from('viaje').select('intake_pendientes_en') → select('id')  → 1262 pasan
D9  startup.ts:169  if (e33) → if (false && e33)                                       → 1262 pasan
```

D8 es literalmente el error que el comentario de esa misma línea explica que se
está evitando: *"al revés que el sondeo de la 0019, que leía `cfdi_uuid`, una
columna de `0001_init.sql` que responde igual con índice o sin él"*. Con
`select('id')` la sonda vuelve a leer una columna que existe desde la 0001 y por
tanto no puede detectar nada. `startup_diagnostico.test.ts` mockea las respuestas
y verifica los desenlaces, pero sigue sin afirmar **qué** se sondea.

**Consecuencia.** Se puede dejar de vigilar el TTL de la barrera y la existencia
de `confirmar_aviso_privacidad` sin que nada lo note. La segunda es la que
escribe la única constancia del art. 16 de la LFPDPPP: sin la 0033 y sin la
sonda, el arranque dice que todo está bien y no se escribe ni una constancia.

**Causa raíz probable.** Es la misma mutación W6 que la ronda 7 reportó como
MEDIO sobre `startup.ts:128` y que no se atacó; las dos sondas nuevas nacieron
con el mismo hueco.

---

### [MEDIO] La red que vigila «lo que se salta bajo cobertura sí corre en CI» solo reconoce una forma de escribir el salto

`src/lib/cuadra/pruebas_en_ci.test.ts:43`

**Escenario.** El detector es
`/skipIf\([^)]*CUADRA_COBERTURA/` sobre el fuente sin comentarios: exige que la
bandera aparezca **dentro del paréntesis del `skipIf`**. Un salto escrito por
constante intermedia no lo dispara. Aplicado sobre `barrera.test.ts` —un archivo
que el paso *"Pruebas de tiempo (sin cobertura)"* no alcanza, porque sus filtros
son `fundamento` y `duplicados`—:

```ts
const SALTA = process.env.CUADRA_COBERTURA === '1';
describe.skipIf(SALTA)('esperarIntake — ráfaga', () => {
```

```
E8  npx vitest run              → Test Files 127 passed | Tests 1262 passed
    npx vitest run --coverage src/lib/cuadra/barrera.test.ts src/lib/cuadra/pruebas_en_ci.test.ts
                               → ↓ barrera.test.ts (5 tests | 5 skipped)
                                 ✓ pruebas_en_ci.test.ts (4 tests)
                                 Tests 4 passed | 5 skipped (9)
```

O sea: bajo el comando exacto que CI corre, las cinco pruebas de la barrera de
ráfaga desaparecen y las cuatro pruebas de la red que existe para avisarlo pasan
sin decir nada.

**Consecuencia.** Es el modo de falla que `cb392f5` cerró, con otra ortografía.
El archivo lo describe él mismo: *"esta clase de hueco es invisible por
construcción: la suite sale verde, el contador de pruebas se ve alto, y el número
que baja —las saltadas— no lo mira nadie"*.

**Causa raíz probable.** El detector busca la forma del salto en el texto en vez
de contar las pruebas saltadas de la corrida, que es el dato que ya existe.

---

### [BAJO] Cinco defectos de la ronda 7 con reporte escrito y ubicación exacta siguen a un `git revert` de distancia

`processor.ts:297` · `repo.ts:451` · `passcode.ts:115` · `acreditable.ts:94` · `processor.ts:723`

**Escenario.** Remedidos con la suite ya crecida a 1262:

```
E3  processor.ts:297   `if (!avisoPuesto)` → `if (false && !avisoPuesto)`  → 1262 pasan
E4  repo.ts:451        se cae el guard `razonSocial && domicilio`          → 1262 pasan
E5  passcode.ts:115    `LARGO_MINIMO` de 24 a 1                            → 1262 pasan
E6  acreditable.ts:94  `litros > 0` → `litros !== 0`                       → 1262 pasan
E7  processor.ts:723   `ctxCerro = closed` del camino feliz, borrada       → 1262 pasan
```

E7 es el que más llama la atención: la ronda escribió su **gemela** de la línea
770 y la ancló (B4 mata 1 prueba), dejando la original de la 723 sin arnés. Las
dos líneas dicen lo mismo y solo una está protegida.

**Consecuencia.** E3 y E4 se refuerzan: quitado cualquiera de los dos, la foto
del ticket vuelve a irse a un modelo externo sin aviso de privacidad que lo
ampare, y nada avisa. Es deuda que no ha cobrado factura solo porque nadie tocó
esas líneas.

**Causa raíz probable.** Alcance: la ronda atacó los tres CRÍTICOS y los ALTOS de
concurrencia, no los ALTOS de privacidad ni los MEDIOS.

---

### [BAJO] El trinquete de cobertura quedó siete puntos por debajo de lo medido

`vitest.config.ts:75-80`

**Escenario.** Los umbrales (`lines 78`, `branches 84`, `functions 83`) son la
línea del 28-jul (79.69 / 85.09 / 84.69). Hoy la corrida real da **84.97 / 85.27 /
87.86**. Un trinquete con siete puntos de holgura en líneas deja caer 400 líneas
ejecutadas sin ponerse rojo. La holgura de ramas, en cambio, es de 1.27 puntos,
que es apretado para un refactor benigno: las dos van en la dirección contraria a
la que el comentario del archivo dice buscar.

**Consecuencia.** Nada se rompe hoy; el número deja de ser la puerta que el
propio archivo dice que es.

---

## Lo que revisé y está bien

- **PR-1, cerrado con el mutante en la mano.** `conv_directo.test.ts:43-48`: el
  stub guarda el argumento de `.limit(n)` y trunca `data` a ese tamaño en el
  `then()`. Es semántica, no forma.
- **La escritura de la liquidación, cerrada.** `repo_escritura.test.ts:110-131`
  lista los doce parámetros y el fixture usa valores distintos entre sí para que
  una permutación se vea. W1–W4 mueren las cuatro.
- **`processor_intake_delta_falla.test.ts` es el mejor arnés de la ronda.** Corre
  `processInbound` de verdad y mata tres mutantes distintos (B1 con 2 rojas, B2,
  y el `-1` gemelo). Ancla el fail-closed, el aviso y la liberación del claim por
  separado, que es lo correcto: los tres se pueden romper por separado.
- **`repo_aviso.test.ts` cerró el ALTO de la ronda 7 sobre `liberarEnvioAviso`.**
  El cuerpo ahora se ejecuta: D10 (llamar a la RPC equivocada) y D11 (dejar de
  gritar cuando no se tocó ninguna fila) mueren los dos. El arnés se movió del
  llamador al escritor, que es lo que la ronda 7 pidió.
- **`migraciones_verificadas.test.ts` cierra el MEDIO de `verificaciones.sql`.**
  Obliga a que cada migración tenga bloque **o** exención con razón de ≥20
  caracteres, y prohíbe exenciones fantasma. Los títulos de `verificaciones.sql`
  llegan al bloque 19 (mig. 0036) y las 36 migraciones están decididas.
- **`formato.ts` cerró el reincidente x4 de los litros con red doble.** D1 mata 4
  pruebas en 3 archivos distintos (`formato.test.ts`, `resumen_cifras.test.ts`,
  `dashboard/formato.test.ts`) y D2 otras 3. `dominio_propio.test.ts` hace lo
  mismo por el lado del dominio: D7 mata 2.
- **`permiso_cre.test.ts` ancla los tres estados, que es el patrón caro del
  repo.** D5 —degradar `'desconocido'` a `'sin_permiso'`, o sea leer "no sé" como
  "no hay"— mata 2 pruebas. Es el único sitio del código nuevo donde el patrón de
  las cinco apariciones se probó explícitamente.
- **`aviso_integral.test.ts` prueba lo que el aviso NO puede inventar.** D12 mata
  2, incluida la que fija que *ninguna otra* sección nazca pendiente — el control
  que impide que "arreglarlo" marcándolo todo pendiente pase en verde.
- **`decidir_empareja.test.ts` fija las dos listas juntas.** B5 y B8 mueren, y B8
  con 5 rojas en 2 archivos. Es el antídoto correcto para "dos listas que tienen
  que coincidir".
- **El CI corre en cada push y en todas las ramas, sin secretos**
  (`ci.yml:21-30`), con `concurrency` que cancela lo que quedó atrás. Los cinco
  pasos son typecheck, lint, cobertura con umbral, pruebas de tiempo sin
  instrumentar, y build. Los 127 archivos de prueba del repo están todos bajo
  `src/` y todos entran en la corrida.
- **La suite nueva no depende del reloj ni de la red.** Recorrí los 16 archivos
  de prueba nuevos de la ronda: cero apariciones de `new Date()`, `Date.now()`,
  `fetch(`, `setTimeout` o `performance.now`. La única saltada de la suite sigue
  siendo `arnes_ticket_real.test.ts` por ausencia de `TICKET_PATH`.
- **`pruebas-manuales/` sigue aislado.** Seis `*.prueba.ts` con su propio
  `vitest.config.ts`, fuera del `include`. No los corrí.

---

## Lo que NO alcancé a revisar

- **El catálogo de comercios (13 → 37 portales) y `permisos_cre.json` como
  datos.** Muté la lógica de `permiso_cre.ts` (D5, D6) pero no las 12,625 entradas
  de la tabla ni las 24 fichas nuevas de `comercios.ts`. Una URL de portal
  equivocada es un hallazgo que solo se ve con la red, y aquí no hay red.
- **`supabase/verificaciones.sql` como SQL.** Creció +409 líneas y ahora tiene 19
  bloques. Conté los títulos contra las migraciones y verifiqué que la red de
  `migraciones_verificadas.test.ts` los ata, pero no puedo ejecutar el archivo:
  no hay Supabase. Que los 19 bloques hagan lo que dicen es lectura, no medición.
- **Las 36 mutaciones cubren el código de esta ronda, no el árbol.** Fuera del
  denominador quedan `emparejar.ts`, `sat.ts`, `caducidad.ts`, `cfdi_xml.ts`,
  `barrera.ts`, `export.ts`, `presupuesto.ts`, todo `src/lib/llm/` y
  `src/lib/agents/`, y las páginas nuevas de `src/app/privacidad/` y
  `src/app/aviso/[tenant]/` como vistas. La tasa del repo entero sigue sin
  medirse en ocho rondas.
- **Si `guardiaCifras` puede lanzar por un camino que yo no vi**, que es lo que
  volvería alcanzable la rama del `catch` con el snapshot puesto. Recorrí las dos
  salidas y el `catch`; no encontré ninguno, pero es lectura, no medición.

---

## Estado del árbol

Toda la mutación ocurrió en una copia del árbol en el scratchpad de la sesión
(`…/scratchpad/work`, con `node_modules` symlinkeado). El repo real no se
modificó ni una vez y no usé `git stash` en ningún punto.

```
$ git status --short
?? docs/auditoria-8/pruebas.md

$ git diff --stat
(vacío)

$ git stash list
(vacío)
```

Limpio salvo mi entregable. Mi único archivo escrito es
`docs/auditoria-8/pruebas.md`.
