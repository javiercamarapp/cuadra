# Arquitectura y mantenibilidad — auditoría 8

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió, con freno**.
Tres hallazgos reincidentes de tres y cuatro rondas —`litros()`, `mxn()` y
`politica_gasto`— están **cerrados por mecanismo** (una fuente única con una
prueba que impide la siguiente copia, no dos copias sincronizadas a mano), que
es exactamente el arreglo que este rubro exige y sube la nota un punto entero.
El freno: la frontera de `repo.ts` **empeoró** por primera vez en cinco rondas,
y encontré el mismo patrón de copia-sin-guardarraíl que tardó tres rondas en
cerrarse para `mxn()`, vivo hoy en la aritmética del dinero (`round2`), sin que
nadie lo haya tocado todavía.

Riesgo mayor del rubro, hoy: **el 70% del acceso a datos (40 de 57 sitios)
vive fuera de `repo.ts`**, la cifra subió por primera vez desde que se mide
(33→38→38→**40**), y el `MAPA.md` de esta ronda vuelve a decir "`repo.ts`
(TODO el acceso a datos)" — falso por cuarta ronda consecutiva.

## Hallazgos

### [MEDIO] `repo.ts` concentra el 30% del acceso a datos, no "todo"; la frontera creció por primera vez en la serie
`docs/auditoria-8/MAPA.md:69` (la afirmación) · `src/lib/cuadra/startup.ts:100,109,146,166,184` (los sondeos que crecieron)

Comando exacto, mismo criterio que rondas 5-7 (`.from('`/`.rpc('` con literal
de tabla/función, producción, sin `*.test.ts`):

```
grep -rn "\.from('\|\.rpc('\|\.from(\`\|\.rpc(\`" src --include=*.ts --include=*.tsx \
  | grep -v "\.test\.ts" | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

| archivo | r5 | r6 | r7 | **r8** | Δ r7→r8 |
|---|--:|--:|--:|--:|--:|
| `src/lib/cuadra/repo.ts` | 16 | 17 | 17 | **17** | — |
| `src/lib/cuadra/conv.ts` | 11 | 11 | 11 | **11** | — |
| `src/lib/cuadra/startup.ts` | 5 | 7 | 7 | **9** | **+2** |
| `src/lib/cuadra/analytics.ts` | 8 | 8 | 8 | **8** | — |
| `src/lib/cuadra/costos.ts` | 3 | 4 | 4 | **4** | — |
| `src/app/api/export/pdf/[id]/route.ts` | — | 2 | 2 | **2** | — |
| `tools.ts`, `processor.ts`, `config.ts`, `auth/session.ts`, `dashboard/page.tsx`, `export/liquidaciones/route.ts` | 6 | 6 | 6 | **6** | — |
| **TOTAL** | **49** | **55** | **55** | **57** | **+2** |

**Fuera de `repo.ts`: 40 de 57 (70%).** Serie completa, mismo criterio:
r5 = 33 fuera, r6 = 38, r7 = 38, **r8 = 40**. Es la primera vez que sube desde
que se mide — las tres rondas anteriores el número estaba plano.

**Escenario, con valores.** El crecimiento es 100% de `startup.ts`, que ganó
dos sondeos nuevos esta ronda: `admin.from('viaje').select('intake_pendientes_en')`
(`startup.ts:100`, migración 0031) y `admin.rpc('confirmar_aviso_privacidad', …)`
(`startup.ts:166`, migración 0033). Cada migración nueva que se sondea al
arranque —y esta ronda trajo seis (0031-0036)— añade otro literal de tabla o
de función fuera del perímetro. El `MAPA.md` que se le entrega a cada auditor
sigue diciendo, línea 69, que `repo.ts` es "(TODO el acceso a datos)".
Verificado con `grep -c` sobre el propio archivo: no hay ninguna prueba en
`src/` que compare esa afirmación contra el código (busqué explícitamente un
guardarraíl tipo `formato.test.ts` para esta frontera y no existe ninguno).

**Consecuencia.** Quien llegue a este repo confiando en el mapa —que es
exactamente para lo que existe— cree que auditar o tocar el acceso a datos es
mirar un archivo. Son doce. El segundo concentrador, `conv.ts` (11 sitios),
lleva **cuatro rondas seguidas sin que nadie lo abra**: no se sabe si esas
consultas replican los controles de tenant que si están garantizados dentro de
`repo.ts`, y la ronda 6 ya encontró exactamente esa clase de bug —aislamiento
de tenant roto en una consulta fuera del perímetro (`resolveOperador`,
PR-1)— aunque en otro archivo.

**Causa raíz probable:** cada módulo satélite (`conv.ts`, `analytics.ts`,
`startup.ts`, `costos.ts`) creció resolviendo su propio problema (WhatsApp,
KPIs, arranque, costeo), y la regla de "todo pasa por `repo.ts`" vive en un
comentario del `MAPA.md`, no en un lint ni una prueba.

---

### [MEDIO] El redondeo de dinero a dos decimales (`round2`) está reimplementado por separado en 4 archivos, sin fuente compartida ni prueba que los compare — el mismo patrón que tardó tres rondas en cerrarse para `mxn()`
`src/lib/cuadra/cuadre/engine.ts:864-865` · `src/lib/cuadra/analytics.ts:396-397` · `src/lib/cuadra/periodo/combustible.ts:63` · `src/lib/cuadra/laboral/pagadero.ts:107` (más dos usos sueltos de la misma fórmula sin nombre: `src/lib/cuadra/repo.ts:651` y `src/lib/cuadra/liquidacion/omitidos.ts:37`)

Cuatro definiciones, todas con el cuerpo idéntico:

```ts
// engine.ts:864-865
function round2(n: number): number { return Math.round(n * 100) / 100; }

// analytics.ts:396-397
function round2(n: number): number { return Math.round(n * 100) / 100; }

// periodo/combustible.ts:63
const round2 = (n: number) => Math.round(n * 100) / 100;

// laboral/pagadero.ts:107
const round2 = (n: number) => Math.round(n * 100) / 100;
```

Verificado con `grep -rln "round2" src --include="*.test.ts"`: la única
prueba que lo menciona (`deducibilidad.test.ts:77`) verifica tolerancia al
centavo **dentro** de `engine.ts`, no compara las cuatro implementaciones
entre sí. No existe un `dinero.ts` o `math.ts` del que importar — a
diferencia de `formato.ts`, que sí se construyó para esto exactamente en
`60538b3` (esta misma ronda) y que **no** cubre aritmética, solo presentación.

**Escenario, con valores — el defecto ya existe, no es hipotético.** Verificado
en Node: `round2(1.005)` devuelve **`1`**, no `1.01` (`1.005 * 100` no es
exactamente `100.5` en punto flotante IEEE-754, y `Math.round` redondea hacia
abajo). El mismo defecto vive, hoy, idéntico en las cuatro copias: el
descuento de nómina que tapa el tope del art. 110 LFT (`pagadero.ts:140`), el
excedente de efectivo que dispara la alerta de la RFA 2.9 (`combustible.ts:88-89`),
los acumulados del panel (`analytics.ts:137-142`) y las cubetas fiscales del
motor (`engine.ts:830-859`, incluida `litrosDieselAcreditables`, el número que
`resumen.ts` le manda al operador). El día que alguien lo note —porque se ve
en el PDF, que es donde primero se mira— y lo arregle en `engine.ts:864`, las
otras tres copias se quedan con el centavo mal, en silencio: nadie sabe que
hay tres copias más, porque ninguna prueba las junta.

**Consecuencia.** Para quien mantenga esto: exactamente el mecanismo que
produjo la reincidencia de `mxn()` durante tres rondas (arreglar la copia que
se ve, dejar las demás) va a repetirse aquí si nadie lo consolida antes de que
alguien lo note por accidente.

**Causa raíz probable:** ningún módulo satélite de `cuadre/` importa de
`cuadre/engine.ts` (por diseño: evita ciclos), así que cada uno que necesitó
redondear a centavos escribió su propia línea en vez de crear un módulo común.

---

### [BAJO] El guardarraíl que cierra el formato de dinero no cubre `.toFixed(2)`, y ya hay una función que lo usa
`src/lib/formato.test.ts:68-81` (el guardarraíl, busca solo `toLocaleString('es-MX'`) · `src/lib/cuadra/laboral/pagadero.ts:149` (`.toFixed(2)`, sin `$` ni separador de miles) · `src/lib/cuadra/laboral/pagadero.ts:124` (`topeDescuento`, la función, cero consumidores en producción)

`topeDescuento()` no tiene un solo llamador fuera de su propio archivo y de su
prueba (verificado: `grep -rn "topeDescuento" src` solo devuelve la
definición y `pagadero.test.ts`). Su campo `nota` —pensado para el
contralor, a juzgar por su vecino de once líneas abajo, la sección literal
"Lo que de verdad llega al contralor" (`pagadero.ts:153`)— interpola
`exigible.toFixed(2)` y `descuentoPeriodo.toFixed(2)`: sale `"15400.00"`, sin
`$` ni comas, mientras el resto del producto (`resumenLaboral`, tres líneas
más abajo en el mismo archivo, línea 215) usa `mxn()` y saca `"$15,400.00"`.

**Por qué no es MEDIO:** hoy es inerte. `resumenLaboral()` —la función que sí
tiene consumidor (`pdf.ts:333`)— no llama a `topeDescuento`; construye su
propio texto con `mxn()` correctamente. El guardarraíl no puede reportarlo
porque busca el literal `toLocaleString('es-MX'`, y `.toFixed(2)` no lo
contiene.

**Consecuencia.** El día que alguien conecte `topeDescuento` —la estructura
del archivo lo invita: es el vecino inmediato de la función que sí llega al
contralor, bajo el mismo comentario "Los dos topes del art. 110"— la prueba
que se supone impide una copia nueva del formato de dinero no lo va a ver.

**Causa raíz probable:** `formato.test.ts` se escribió para cerrar el
`toLocaleString('es-MX')` que sí encontró (auditoría 7), no para prohibir
formatear dinero en general.

---

### [BAJO, REINCIDENTE — 2ª RONDA] `ESTATUS` de liquidación sigue duplicado literalmente entre las dos pantallas
`src/app/dashboard/page.tsx:14-18` · `src/app/dashboard/[id]/page.tsx:25-29`

Mismo mapa (`cuadrada`/`con_diferencias`/`revisar` → `{label, color}`),
escrito dos veces, hoy byte por byte idéntico (lo comparé línea por línea, no
solo por nombre de clave). Sin prueba que lo compare. Reportado ya en la
ronda 7 como BAJO y no se tocó: es el mismo patrón que produjo la divergencia
de `CONCEPTO_LABEL` (cerrada) un nivel más abajo, y el que la ronda 6 dejó
como "el ejemplo canónico" del rubro.

**Consecuencia.** Bajo hoy porque las dos copias coinciden; el riesgo es que
un tercer estatus se agregue en un solo archivo —el tipo `EstatusLiquidacion`
en `types/cuadra.ts:104` sigue siendo la única fuente de verdad de los
*valores*, pero no de sus *etiquetas y colores*— y una de las dos pantallas
muestre la clave cruda en vez del texto.

**Causa raíz probable:** las dos pantallas son componentes de servidor
independientes en Next.js sin un archivo compartido de "presentación de
liquidación" (a diferencia de `CONCEPTO`, que sí tiene ese archivo — ver "lo
que revisé y está bien").

## Lo que revisé y está bien

- **`litros()`, `mxn()` y `fechaMx()` — cerrados por mecanismo, no por
  parche, y verificado con las pruebas corriendo.** `src/lib/formato.ts` es
  hoy la única definición de las tres, con **cero imports** (verificado
  leyendo el archivo completo: ni `clsx` ni nada más), para que el motor puro
  y el bundle del webhook puedan usarla sin arrastrar Tailwind. `utils.ts:12`
  reexporta. Corrí `npx vitest run src/lib/formato.test.ts`: 7/7 verdes,
  incluida la prueba que escanea **todo `src/`** buscando `toLocaleString('es-MX'`
  fuera de `formato.ts` y falla si aparece — es la prueba que impide la
  QUINTA ronda del hallazgo de litros. Los tres consumidores reales
  (`resumen.ts:6` WhatsApp, `acreditable.ts:17` PDF, `dashboard/page.tsx:8` y
  `[id]/page.tsx:9` panel) importan los tres de la misma fuente, confirmado
  archivo por archivo. Verifiqué también que `grep -rn "mxn = (n\|function mxn("`
  devuelve **una sola** ocurrencia en todo `src/` (antes: 8).
- **`politica_gasto` — el lector muerto se borró, no se documentó nada más.**
  `getPolitica` ya no existe en `repo.ts` (solo queda el comentario que
  explica por qué se borró, línea 82-95); la migración `0032` comenta la
  tabla como muerta; el seed (`supabase/seed.sql:85-92`) ya no afirma que el
  motor la lee. `politica_un_origen.test.ts` (3 pruebas, corridas: verdes)
  falla si algo en `src/` vuelve a leer `politica_gasto` fuera de
  comentarios, confirma que el motor recibe la política de
  `tenant.config.politica`, y confirma que el seed dejó de mentir.
- **`CLAVES_PEAJE` — deduplicada.** `config.ts:15` importa `CLAVES_PEAJE` de
  `intake/concepto.ts:27` en vez de tener su propia copia; `concepto.test.ts:68`
  verifica por regex que `config.ts` siga importando (no reescribiendo) la
  constante.
- **El mapa gemelo `CONCEPTO_LABEL` sigue borrado.** Reverificado:
  `grep -rn "CONCEPTO_LABEL" src` da los mismos dos hits que la ronda 7 (un
  comentario y la prueba que prohíbe que vuelva). `engine.ts:819` sigue
  diciendo `otro: 'Otro'`, igual que el único mapa de respaldo que queda
  (`[id]/page.tsx`).
- **La migración 0036 (`gasto_no_tras_liquidar`) resuelve el último crítico
  de siete rondas en la capa correcta.** Es un trigger `before insert`, con
  `perform 1 from viaje … for update` para serializar contra el cierre —no un
  `if` de aplicación entre leer y escribir, que es exactamente donde cabía la
  carrera original. `processor.ts:524` distingue el SQLSTATE propio (`CU001`,
  `pg_errores.ts:25`) de un duplicado benigno vía `llegoTarde()`, y
  `gasto_tarde.test.ts` lo verifica leyendo el CÓDIGO real de `processor.ts`
  (no un mock): que manda el mensaje, que dice qué hacer, y que el monto sale
  formateado con `mxn()`. `migraciones_verificadas.test.ts` (bloque 19 de
  `verificaciones.sql`) confirma que la 0036 no quedó sin comprobar en la
  base real.
- **El motor sigue puro.** Reverificado sobre `cuadre/`, `normas/`,
  `laboral/`, `liquidacion/`, `facturacion/`, `periodo/`: cero `Date.now(`,
  `process.env`, `Math.random`, `randomUUID`, `fetch(`, `supabaseAdmin`.
  `engine.ts` importa `mxn` de `formato.ts` (línea 19), que no rompe la
  pureza porque `formato.ts` en sí no tiene imports ni I/O.
- **`acreditable.ts` y `deducibilidad.ts` siguen sin duplicar criterio
  fiscal.** Sus únicos imports de producción son tipos y `formato.ts`
  (verificado leyendo los `import` de ambos archivos completos); reciben
  `Liquidacion` ya calculada y solo formatean/presentan.
- **`CONCEPTOS_OCR` (subconjunto deliberado de `ConceptoGasto`) está
  guardado, no es una copia sin vigilar.** `ocr.ts:26` documenta por qué
  excluye `'viaticos'` y cita que "hay un test que compara las dos listas" —
  `conceptos_coinciden.test.ts` existe y lo hace. No lo reporto como hallazgo:
  es justo la clase de guardarraíl que este rubro premia.
- **`presupuesto.ts` sigue sin tocar la base.** Reverificado: el único hit de
  `supabaseAdmin(` en ese archivo es un comentario (línea 75), no una
  llamada.

## Lo que NO alcancé a revisar

- **`conv.ts` por dentro (11 sitios de consulta) — cuarta ronda seguida sin
  abrirlo.** Sigue siendo el segundo concentrador de acceso a datos fuera de
  `repo.ts` y nadie lo ha auditado por dentro.
- **Si los literales de nombres de `tools` subieron o bajaron** — cuarta
  ronda que lo dejo pendiente.
- **`processor.ts` (993 líneas, subió de las >800 de la ronda 7)** — no
  evalué si sus responsabilidades justifican seguir en un solo archivo.
- **`catalogoCuentas` (`config.ts`)** — no reverifiqué si sigue sin
  consumidores.
- **No leí los reportes de los otros auditores de esta ronda.** Probable
  solape con pruebas sobre el guardarraíl de `formato.test.ts` y con
  seguridad sobre la RFA 2.9 / tope de descuento laboral.
- **No revisé los 41 commits uno por uno** — me enfoqué en verificar la lista
  de hallazgos abiertos que traía y en buscar patrones de duplicación nuevos;
  puede haber otras copias que no encontré con los greps que corrí.
