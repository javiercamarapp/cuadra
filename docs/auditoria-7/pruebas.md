# Pruebas — auditoría 7

**Nota: 5/10** (antes 4). Razón del movimiento: **mirada más profunda — el código
no cambió, y la nota anterior estaba mal calibrada.** El 4 de la ronda 6 se fijó
midiendo 12 mutaciones sobre el peor subconjunto del árbol (el código recién
escrito de la ronda 5, que la ronda 6 estaba a punto de arreglar). Medí las
pruebas que escribió la **ronda 6** con el mismo método, 18 mutaciones, y
sobreviven **4 de 18 literales — 3 de 16 descontando dos mutantes equivalentes**.
La suite de este árbol protege bastante más de lo que un 4 dice. No sube más
porque encontré **tres pruebas de la ronda 6 que son decoración en el sentido
exacto que este rubro mide** —una imita el argumento que la corrección cambió,
otra prueba una copia de la función que vive dentro del propio archivo de prueba,
y la tercera reemplaza por completo la función que dice cubrir— y porque la
**escritura del dinero no tiene arnés**: las 5 mutaciones que le apliqué
sobrevivieron las 5.

**Riesgo mayor del rubro, hoy:** `saveLiquidacion` —la única función que escribe
la liquidación en la base— tiene una prueba que verifica 8 de sus 12 parámetros;
puedo cambiar el IEPS acreditable por el IVA, poner los litros de diésel en 0 y
borrar la URL del PDF archivado, las tres a la vez, y las 1115 pruebas siguen en
verde.

---

## La medición de mutantes sobre las pruebas de la ronda 6

**Método.** Copia del repo fuera del árbol (`tar` al scratchpad de la sesión, con
`node_modules` symlinkeado). Confirmé la copia fiel corriendo `npx vitest run`
antes de mutar: **112 archivos, 1115 pasan, 1 saltada**, idéntico a la línea base
del MAPA. Cada mutación se aplicó con un script de sustitución única
(`assert count(old) == 1`), se corrió la suite completa, y el archivo se restauró
desde el original antes de la siguiente. El árbol real nunca se tocó.

**Selección.** Una mutación por cada corrección de producción de los 11 commits
de código de `5b2ec76..abdc98d`, sobre la línea exacta que el commit escribió,
más una segunda donde el commit cerró dos defectos.

### Las 18 mutaciones sobre código de la ronda 6

| # | Prueba que dice cubrirlo | Mutación aplicada | `archivo:línea` | ¿Sobrevive? |
|---|---|---|---|---|
| M1 | `estado_afirmado.test.ts` | `real.entrego === false` → `!real.entrego` | `estado_afirmado.ts:108` | **equivalente** (ver nota) |
| M1b | `estado_afirmado.test.ts` | `real.entrego === false` → `!== true` | `estado_afirmado.ts:108` | no — 3 rojas |
| M2 | `processor_cierre.test.ts` | `entrego: closed ? 'pendiente' : false` → `false` | `processor.ts:747` | **equivalente** (ver nota) |
| M3 | `estado_afirmado.test.ts` | `reemplazo = real.cerro ? A : B` → siempre B | `estado_afirmado.ts:114` | no — 1 roja |
| M4 | `fundamento_ronda6.test.ts` | se borra el patrón "sigla después del número" | `fundamento.ts:113` | no — 8 rojas |
| M5 | `fundamento_ronda6.test.ts` | `numeroCitable` toma siempre el primer token | `fundamento.ts:133` | no — 1 roja |
| M6 | `config_falla.test.ts` | `getConfig` vuelve a descartar el `error` de PostgREST | `config.ts:178-180` | no — 3 rojas |
| M7 | `config_falla.test.ts` | vuelve `cfg.empresa = {...}` (fuga de RFC entre tenants) | `config.ts:213` | no — 2 rojas |
| M8 | `instrumentation.test.ts` | se descablea `verificarAvisoDePrivacidad()` | `instrumentation.ts:33` | no — 1 roja |
| M9 | `forma_pago_sat.test.ts` | `formaPagoSat` deja de rellenar el cero | `cfdi_xml.ts:90` | no — 3 rojas |
| **M10** | `analytics_deriva.test.ts` | el portón `if (derivoLaConfig(...)) return null` deja de correr | `analytics.ts:341` | **SÍ — 1115 verdes** |
| M11 | `startup_diagnostico.test.ts` | los índices faltantes dejan de reportarse | `startup.ts:136` | no — 2 rojas |
| M12 | `utils_fecha.test.ts` | `fechaMx` pierde `timeZone` (vuelve la fecha UTC) | `utils.ts:63` | no — 2 rojas |
| M13 | `utils_fecha.test.ts` | el PDF vuelve a su copia propia de la fecha | `pdf.ts:54` | no — 1 roja |
| M14 | `rfc_no_verificable.test.ts` | el RFC genérico vuelve a quedar excluido (AL-6) | `engine.ts:168` | no — 3 rojas |
| M15 | `privacidad_ronda6.test.ts` | el filtro de rellenos vuelve a ser substring | `privacidad.ts:121` | no — 5 rojas |
| M16 | `privacidad_ronda6.test.ts` | se quita la perífrasis de oposición | `privacidad.ts:294` | no — 3 rojas |
| **M17** | ninguna (commit `aa4d986`) | `updateGastoCfdiXml` deja de preservar `error.code` | `repo.ts:233-235` | **SÍ — 1115 verdes** |
| **M18** | `analytics_deriva.test.ts` | `derivoLaConfig` deja de ver una diferencia que DESAPARECE | `analytics.ts:391` | **SÍ — 1115 verdes** |

**Resultado: 4 de 18 sobreviven (22%)**, y **3 de 16 (19%)** descontando los dos
mutantes equivalentes. Contra el **10 de 12 (83%)** de la ronda 6 y el **12 de 21
(57%)** de la ronda 5.

**Los dos equivalentes, y por qué los descuento en vez de contarlos a mi favor.**
M1 y M2 sobreviven porque no cambian el comportamiento, no porque falte prueba:

- **M1**: `'pendiente'` es truthy, así que `!real.entrego` y `real.entrego === false`
  coinciden en los tres valores que el tipo admite. Su variante no equivalente
  —M1b, `!== true`, que sí reintroduce el bug— **muere con 3 rojas**.
- **M2**: `closed === true` implica `cuadro === true` en `guardiaCifras`
  (`guardia.ts:36-38`), que devuelve `forzado: true` por las dos salidas
  (`guardia.ts:79` y su `catch` en `:82`), y eso deja `textoDeterminista` en true
  antes del `if` de `processor.ts:740`. Recorrí las dos asignaciones de `closed`
  (`processor.ts:622` y `:663`; la segunda también repuebla `agentTools` con las
  tool calls parciales) y en las dos el `cuadro` queda en true. La rama
  `entrego: 'pendiente'` es **inalcanzable hoy**, exactamente lo que la ronda 6
  documentó como "hallazgo falso". El acoplamiento que la hace inalcanzable **sí**
  tiene prueba (`processor_cierre.test.ts`, *"en el cierre el texto lo escribe el
  motor"*), y esa prueba es la que hay que mirar, no ésta.

**La pregunta de la ronda, respondida.** Sí: los arreglos de la ronda 6 nacieron
con arnés, y el arnés funciona. Trece de dieciséis mutaciones no equivalentes
mueren, incluidas **todas** las de dinero y de fiscal (M14 el RFC genérico, M12 y
M13 la fecha del papel, M9 la `FormaPago`, M6 y M7 la config del tenant). No
cambió solo el discurso: cambió el número, y por un factor de cuatro.

### Segunda medición: los 10 supervivientes de la ronda 6, hoy

La ronda 6 arregló dos de sus tres CRÍTICOS de este rubro (commit `4c8d6b7`).
Repetí sus 10 mutaciones supervivientes para ver cuáles cerraron de verdad:

| # ronda 6 | Mutación | `archivo:línea` | Hoy |
|---|---|---|---|
| M1 | `resolveOperador`: `.limit(2)` → `.limit(1)` | `conv.ts:73` | **SIGUE VIVA** |
| M2 | `getOpenViaje`: `throw ConsultaFallida` → `return null` | `conv.ts:139` | cerrada — 1 roja |
| M3 | `intakeDelta`: `return null` → `return 0` | `conv.ts:331` | cerrada — 1 roja |
| M8 | `liberarEnvioAviso` reducida a no-op | `repo.ts:486` | **SIGUE VIVA** |
| M9 | `getDatosResponsable` pierde el guard | `repo.ts:445` | **SIGUE VIVA** |
| M10 | el bloqueo `if (!avisoPuesto)` deja de correr | `processor.ts:291` | **SIGUE VIVA** |
| M11 | la llamada a `guardiaEstado` deja de correr | `processor.ts:740` | cerrada — 1 roja |
| M12 | `ctxCerro = closed;` comentada | `processor.ts:623` | **SIGUE VIVA** |
| M6 | `LARGO_MINIMO` de 24 a 1 | `passcode.ts:115` | **SIGUE VIVA** |
| M7 | `litros > 0` → `litros !== 0` | `acreditable.ts:92` | **SIGUE VIVA** |

**3 de 10 cerradas.** Y la que más importa —la que decide de qué flota es el
dinero— sigue viva **con la prueba que se escribió para cerrarla en su sitio y en
verde**. Eso es el primer hallazgo.

### Tercera medición: la ESCRITURA del dinero (mi rubro la nombra primero)

Nadie la había medido en seis rondas. `saveLiquidacion` (`repo.ts:397-412`) es la
única función que escribe la liquidación:

| # | Mutación | `archivo:línea` | ¿Sobrevive? |
|---|---|---|---|
| W1 | `p_litros_diesel: liq.litrosDieselAcreditables ?? 0` → `0` fijo | `repo.ts:406` | **SÍ** |
| W2 | `p_ieps: liq.iepsAcreditable` → `liq.ivaAcreditable` | `repo.ts:405` | **SÍ** |
| W3 | `p_diferencias: liq.diferencias` → `[]` | `repo.ts:404` | **SÍ** |
| W4 | `p_pdf_url: pdfUrl ?? null` → `null` fijo | `repo.ts:409` | **SÍ** |
| W5 | `liberarEnvioAviso` pierde el filtro `.eq('tenant_id', ...)` | `repo.ts:490` | **SÍ** |
| W6 | se cae `uq_operador_telefono_activo` de los índices esperados | `startup.ts:128` | **SÍ** |

**6 de 6 sobreviven.** Todas con 1115 verdes.

---

## Hallazgos

### [CRÍTICO] La prueba que ancla "de qué flota es el dinero" imita un query builder que ignora el `.limit()`, y por eso el arreglo se puede revertir en verde

`src/lib/cuadra/conv_directo.test.ts:30-36` · `src/lib/cuadra/conv.ts:73`

**Escenario.** El arreglo que cierra el CRÍTICO de la ronda 5 es literalmente el
número dentro de `.limit()`: `resolveOperador` pide **dos** filas para poder
detectar que un teléfono resuelve a dos operadores de dos flotas distintas y
lanzar `OperadorAmbiguo`. Con `.limit(1)` PostgREST devuelve una sola fila, la
ambigüedad es indetectable, y el gasto se anota en la primera flota que la base
devuelva —sin `order by`—, que es el bug original palabra por palabra.

La prueba que la ronda 6 escribió para anclarlo (`conv_directo.test.ts:72-83`,
*"con DOS operadores activos para el mismo teléfono, se niega a elegir"*) no puede
verlo. Su stub construye el enlace así:

```ts
for (const m of ['select','eq','is','in','order','not','gte','limit']) e[m] = () => e;
e.then = (r, j) => limit().then(r, j);
```

`limit` se declara ignorando su argumento, y el `then` llama a `limit()` **sin
argumento** para sacar el valor mockeado. O sea: el mock devuelve las dos filas
que la prueba quiere oír, pida el código una o pida dos.

```
R1  conv.ts:73   .limit(2) → .limit(1)   →  112 archivos, 1115 pasan
```

**Consecuencia.** Es dinero de una flota anotado en la de otra, en silencio, en un
producto multi-tenant — y ahora con el agravante de que hay una prueba con nombre
propio que dice cubrirlo. El equipo que mantenga esto va a leer
`conv_directo.test.ts` y concluir que la ruta está protegida. No lo está. Y se
compone con W6: la prueba de arranque tampoco fija que se pregunte por el índice
`uq_operador_telefono_activo`, que es la garantía de base que impide que ese
estado exista.

**Causa raíz probable.** El stub imita la *forma* encadenable del query builder,
no su *semántica*; ninguna aserción mira los argumentos con que se llamó.

**REINCIDENTE** — es la mutación M1 de la ronda 6, reportada como CRÍTICO,
declarada cerrada por el commit `4c8d6b7`, y sigue viva.

---

### [CRÍTICO] La escritura de la liquidación —la única— verifica 8 de sus 12 parámetros; el IEPS, los litros, las diferencias y la URL del PDF no se miran

`src/lib/cuadra/repo.ts:397-410` · `src/lib/cuadra/repo_escritura.test.ts:104-111`

**Escenario.** `repo_escritura.test.ts` tiene un caso llamado *"manda cada total a
su parámetro"*, y su `toMatchObject` lista `p_tenant`, `p_viaje`,
`p_total_comprobado`, `p_total_anticipo`, `p_diferencia`, `p_estatus`, `p_iva` y
`p_peaje`. Faltan cuatro: `p_ieps`, `p_litros_diesel`, `p_diferencias` y
`p_pdf_url`. Con `toMatchObject`, lo que no se lista no se compara. Medido:

```
W2  repo.ts:405  p_ieps: liq.iepsAcreditable → liq.ivaAcreditable   → 1115 pasan
W1  repo.ts:406  p_litros_diesel: …          → 0 fijo               → 1115 pasan
W3  repo.ts:404  p_diferencias: liq.diferencias → []                → 1115 pasan
W4  repo.ts:409  p_pdf_url: pdfUrl ?? null   → null fijo            → 1115 pasan
```

Con el fixture del propio archivo (`iepsAcreditable: 0`, `ivaAcreditable: 663.79`,
`litrosDieselAcreditables: 255`), W2 escribe **$663.79 de IEPS acreditable donde
hay $0** y W1 escribe **0 litros donde hay 255**.

**Consecuencia.** Esas dos columnas las lee `getAcreditables`
(`analytics.ts:133-142`), que suma `ieps_acreditable` y
`litros_diesel_acreditables` de todo el ejercicio para la pantalla de acreditables
—la que el contralor mira para su estímulo de IEPS al diésel—. El motor puede
calcular perfecto y la base guardar otra cosa: ninguna prueba cruza el límite. W3
además apaga en silencio el portón de deriva de `analytics.ts` (que compara
justamente los tipos de `diferencias` persistidos) y W4 deja la liquidación sin
PDF archivado en el panel.

**Causa raíz probable.** `toMatchObject` sobre un subconjunto elegido a mano en la
única prueba de la única escritura de dinero; nadie comparó la lista contra la
firma de la RPC.

---

### [CRÍTICO] `analytics_deriva.test.ts` prueba una copia de `derivoLaConfig` escrita dentro del propio archivo de prueba, no la función de producción

`src/lib/cuadra/analytics_deriva.test.ts:57-66` · `src/lib/cuadra/analytics.ts:341` · `:385-393`

**Escenario.** El CRÍTICO de frontend de la ronda 6 —el panel recalcula con la
config de hoy y contradice al PDF archivado— se cerró con un portón en
`reconstruir`: `if (derivoLaConfig(diferenciasPersistidas, liq.diferencias)) return null`.
El archivo de prueba que lo acompaña declara en su encabezado que "fija las dos
mitades". Lo que hace en realidad, líneas 60-66, es **reimplementar el criterio**:

```ts
const derivo = (a, b) => { const antes = tipos(a); const ahora = tipos(b);
  if (antes.size !== ahora.size) return true;
  for (const t of ahora) if (!antes.has(t)) return true; return false; };
```

y correr sus cuatro casos contra esa copia local. La función de producción no se
importa en ningún archivo de prueba del repo (`derivoLaConfig` solo aparece una
vez fuera de `analytics.ts`, y es en un comentario de esa prueba). Medido:

```
M10  analytics.ts:341  el portón deja de ejecutarse           → 1115 pasan
M18  analytics.ts:391  `antes.size !== ahora.size` se borra    → 1115 pasan
```

**Consecuencia.** Es la sexta aparición del patrón que la ronda 6 nombró como
pregunta de la ronda —*dos copias de la misma verdad*—, y esta vez la segunda
copia vive dentro del arnés que existe para impedirlo. Si alguien quita el portón
en un refactor, el detalle del panel vuelve a enseñarle al contralor una
deducibilidad distinta de la del PDF que ya mandó a su contador, sin marca de
recálculo, y la suite no dice nada.

**Causa raíz probable.** `derivoLaConfig` no se exporta; en vez de exportarla o de
llegar a ella por `getLiquidacionDetalle` (que sí está mockeable, ver
`analytics.test.ts:48`), se copió el criterio al archivo de prueba.

---

### [ALTO] `aviso_constancia.test.ts` mockea la función que su encabezado dice cubrir: el cuerpo de `liberarEnvioAviso` sigue sin ejecutarse nunca

`src/lib/cuadra/aviso_constancia.test.ts:24` y `:30-33` · `src/lib/cuadra/repo.ts:486-493`

**Escenario.** El encabezado del archivo dice: *"`liberarEnvioAviso`, el arreglo de
la 'constancia falsa', NO SE EJECUTA EN NINGUNA PRUEBA … Los tres arneses que
ejecutan `processInbound` la mockean con un `vi.fn()`"*. Y entonces la línea 24
hace `const liberarEnvioAviso = vi.fn(async () => {});` y la 32 la inyecta en el
mock parcial de `./repo`. Lo que las 6 pruebas verifican es el **cableado** —que
`ponerAvisoADisposicion` la llame con `('t1','op1')` cuando `sendText` devuelve
`null`—, que es progreso real y lo digo. Lo que sigue sin correr ni una vez es el
`UPDATE`:

```
R8  repo.ts:486  el cuerpo entero reducido a `return;`            → 1115 pasan
W5  repo.ts:490  se cae el filtro `.eq('tenant_id', tenantId)`     → 1115 pasan
```

**Consecuencia.** R8 devuelve el CRÍTICO de la constancia falsa: la fila sigue
afirmando ante la autoridad que un operador recibió su aviso (LFPDPPP art. 16)
cuando Meta no lo entregó. W5 es peor y es nuevo: sin el filtro por tenant, un
`operadorId` que colisione borra la constancia de **otra flota** — una escritura
cruzada entre tenants en la tabla que sirve de prueba de cumplimiento.

**Causa raíz probable.** El arnés se montó sobre `processor.ts` (el llamador) en
vez de sobre `repo.ts` (el escritor), y `repo_escritura.test.ts` —que sí tiene un
stub de `supabaseAdmin` listo para esto— no se amplió.

---

### [ALTO] Cinco supervivientes de la ronda 6 siguen exactamente igual, y uno bloquea el tratamiento de datos personales

`processor.ts:291` · `repo.ts:445` · `processor.ts:623` · `passcode.ts:115` · `acreditable.ts:92`

**Escenario.** Repetí las cinco mutaciones que la ronda 6 reportó y la ronda 6 no
atacó. Las cinco siguen vivas, con la suite ya crecida a 1115 pruebas:

```
R10  processor.ts:291   `if (!avisoPuesto)` → `if (false && !avisoPuesto)`   → 1115 pasan
R9   repo.ts:445        se quita el guard `razonSocial && domicilio`          → 1115 pasan
R12  processor.ts:623   `ctxCerro = closed;` comentada                        → 1115 pasan
R6   passcode.ts:115    `LARGO_MINIMO` de 24 a 1                              → 1115 pasan
R7   acreditable.ts:92  `litros > 0` → `litros !== 0`                         → 1115 pasan
```

R10 y R9 se refuerzan entre sí y por eso los pongo juntos en ALTO: R9 quita el
guard que decide si hay responsable identificable, R10 quita el bloqueo que impide
tratar datos sin aviso. Roto cualquiera de los dos por separado, la foto del
ticket vuelve a irse a un modelo externo sin aviso que lo ampare, y nada avisa.

**Consecuencia.** Para el equipo que va a mantener esto: cinco defectos con
reporte escrito, severidad asignada y ubicación exacta, un `git revert` de
distancia, con la suite en verde. La deuda de la ronda 6 no cobró factura todavía
solo porque nadie tocó esas líneas.

**Causa raíz probable.** La ronda 6 cerró dos de los tres CRÍTICOS del rubro y
ninguno de los ALTOS ni MEDIOS; no es un descuido de diseño, es alcance.

**REINCIDENTE** de la ronda 6 (sus mutaciones M6, M7, M9, M10 y M12).

---

### [MEDIO] Las tres pruebas que vigilan tiempo se saltan bajo `--coverage`, y CI solo corre `--coverage`

`vitest.config.ts:13` y `:22` · `.github/workflows/ci.yml:59-60` · `fundamento.test.ts:125` · `duplicados.test.ts:151`

**Escenario.** `CUADRA_COBERTURA` se pone a `'1'` cuando la corrida lleva
`--coverage`, y dos pruebas lo usan con `it.skipIf` (el encabezado del config dice
tres). El paso de CI es `run: npm run test:coverage`, que es `vitest run
--coverage`. No hay un segundo paso con `npm test` a secas. Consecuencia medida:
en CI esas pruebas **nunca corren**, en ninguna rama y en ningún push.

La razón de saltarlas es correcta y está bien argumentada (la instrumentación de
v8 falsea el reloj: la suite pasa de 9 s a 34 s). Lo que no está cerrado es que la
única corrida automática del repo es justo la que las apaga.

**Consecuencia.** `fundamento.test.ts:125` es el centinela de ReDoS sobre
`FORMA_DE_CITA` —el archivo que la ronda 6 tocó para arreglar un CRÍTICO, con
patrones nuevos que llevan lookahead y cuantificadores lazy— y
`duplicados.test.ts:151` vigila que la detección de duplicados entre viajes no se
vuelva O(G×U) sobre 40 000 CFDI. Un patrón catastrófico introducido en un PR pasa
CI en verde; solo se detecta si alguien corre `npm test` a mano antes de mergear.

**Causa raíz probable.** El salto se resolvió por variable de entorno sin añadir
una segunda corrida sin instrumentar.

---

### [MEDIO] La migración 0030 —la única que escribió la ronda 6— no tiene bloque en `verificaciones.sql`, y su lista de índices esperados no se afirma en ninguna prueba

`supabase/verificaciones.sql:1-31` · `src/lib/cuadra/startup.ts:126-134` · `src/lib/cuadra/startup_diagnostico.test.ts:163-181`

**Escenario.** `verificaciones.sql` tiene 12 bloques y su encabezado enumera qué
migración comprueba cada uno: 0005, 0013, 0017, 0019, 0022, 0024–0029. **No hay
bloque para la 0030**, que es la que la ronda 6 escribió y aplicó, y cuyo propio
comentario en `startup.ts` explica que existe porque el sondeo anterior "anunciaba
que verificaba y no verificaba" tres rondas seguidas. El archivo dice de sí mismo:
*"Un test con Supabase mockeado no las prueba, prueba el mock"* — y eso es
exactamente lo que hay hoy para la 0030.

Del lado de TypeScript, `startup_diagnostico.test.ts` mockea el `rpc` y verifica
los tres desenlaces (ninguno falta, uno falta, la función no existe), pero **nunca
afirma el argumento `p_esperados`**. Medido:

```
W6  startup.ts:128  se renombra la clave `uq_operador_telefono_activo`
                    → el arranque deja de preguntar por ese índice   → 1115 pasan
```

**Consecuencia.** Se puede dejar de vigilar el índice único de teléfono —el que
impide que un mismo número resuelva a dos operadores— sin que nada lo note; y esa
es precisamente la garantía de base sobre la que descansa el CRÍTICO de
`resolveOperador` del primer hallazgo. Las dos redes de ese escenario, la de la
app y la de la base, tienen agujero en el mismo sitio.

**Causa raíz probable.** El commit `8f6e08f` añadió la migración y su prueba de
comportamiento, pero no el bloque en el archivo que existe para probar lo que solo
la base puede probar.

---

## Lo que revisé y está bien

- **El CI es sólido y corre en cada push, sin secretos.** `.github/workflows/ci.yml:21-30`
  dispara en `branches: ['**']` y en `pull_request`, con `concurrency` que cancela
  lo que quedó atrás; los cuatro pasos son typecheck, lint, tests con umbral de
  cobertura y build. El razonamiento de por qué corre en todas las ramas
  (`ci.yml:9-20`) está escrito y es correcto: las rutinas de nube pushean a
  `claude/*`.
- **El umbral de cobertura es una puerta de verdad, no un adorno.**
  `vitest.config.ts:75-80` con `include: ['src/**/*.{ts,tsx}']`, así que los
  archivos que ninguna prueba importa cuentan en el denominador. Las exclusiones
  (`page.tsx`, `layout.tsx`, …) están argumentadas archivo por archivo y no
  esconden lógica de dinero: las rutas de API sí cuentan.
- **`utils_fecha.test.ts` es el mejor arnés que escribió la ronda 6.** Sus dos
  mutaciones mueren (M12, M13) y el segundo `describe` (`:47-63`) hace algo que
  ninguna prueba de valores puede hacer: lee `pdf.ts` como texto y afirma que no
  contiene `toLocaleDateString`. Es la única prueba del repo que ataca el patrón
  "dos copias de la misma verdad" en su forma, no en su efecto.
- **`fundamento_ronda6.test.ts` es la red mejor dirigida.** M4 mata 8 pruebas y M5
  una: se escribió reproduciendo la frase exacta del bug, no una aserción genérica.
  Confirma el mismo diagnóstico que la ronda 6 hizo de `fundamento_ronda5.test.ts`.
- **`config_falla.test.ts` cubre las dos puertas del quinto sitio del patrón**
  (M6: el `error` por valor; M7: la fuga de RFC entre tenants por mutar
  `DEMO_CONFIG`). Las dos mueren. Es el arnés que más daño evita por línea escrita.
- **`arnes_ticket_real.test.ts` cerró el ALTO de la ronda 5.** Ya no tiene cero
  `expect`: tiene verificadores de forma (`:39-46` del encabezado) y un caso de oro
  con la fecha inyectada que corre siempre y gratis. Y es la única prueba saltada
  de la suite, por `describe.skipIf(GRUPOS.length === 0)` (`:320`) — se salta por
  ausencia de `TICKET_PATH`, no por estar rota.
- **La suite no depende del reloj de pared ni de la red.** Recorrí los cinco
  archivos que usan `new Date()`/`Date.now()`: `passcode.test.ts` y
  `ratelimit.test.ts` usan `vi.useFakeTimers()`; `fundamento.test.ts` y
  `duplicados.test.ts` miden con "mejor de N" y documentan la corrida en que se
  cayeron el 28-jul y por qué el umbral nuevo no es intermitente;
  `processor_cadena.test.ts` inyecta `hoy`; `arnes_ticket_real.test.ts` deja
  escrito que su `new Date()` solo afecta a la corrida con `TICKET_PATH`.
  `repo_tope.test.ts` levanta un servidor mudo **local** y no sale a la red.
- **`pruebas-manuales/` está bien aislado.** Seis `*.prueba.ts` con su propio
  `vitest.config.ts`, fuera del `include` de la suite. No los corrí (hacen llamadas
  de pago). El script `npm run ticket` es explícito y no está en CI.
- **`processor_cierre.test.ts` sí cerró el cableado de `guardiaEstado`** (R11 muere
  con 1 roja), que era la mutación M11 de la ronda 6 y la quinta aparición del
  patrón "función pura probada, cableado no". Las cuatro pruebas van por
  `processInbound`, no por la guardia, y una de ellas fija el acoplamiento con
  `guardiaCifras` que hace inalcanzable la rama del falso positivo.
- **Los dos cableados de `fc8de3e` tienen prueba que falla sin el cable** (M8 muere).
  Verificado sobre `instrumentation.ts:33`.

---

## Lo que NO alcancé a revisar

- **La mutación fuera de los 11 commits de la ronda 6.** Mis 18 + 6 + 10 = 34
  mutaciones cubren el código de la ronda 6, la escritura de la liquidación y los
  supervivientes de ayer. El resto del árbol —`ocr.ts`, `emparejar.ts`,
  `decidir.ts`, `sat.ts`, `comercios.ts`, `caducidad.ts`, `pagadero.ts`,
  `tools.ts`, `barrera.ts`, todo `src/lib/llm/` y `src/lib/agents/`— no lo muté
  esta ronda. La tasa real del repo entero sigue sin medirse.
- **El reporte de cobertura línea por línea.** No corrí `npm run test:coverage`:
  habría saltado las dos pruebas de tiempo y tardado ~4× por corrida, y mi señal
  viene de mutación dirigida, que es más cara pero dice más. El número que la
  ronda 6 reporta (81.5% líneas · 85.5% ramas) no lo verifiqué yo.
- **`supabase/verificaciones.sql` como SQL.** Lo leí entero y conté sus bloques
  contra las migraciones, pero no puedo ejecutarlo: no hay Supabase en este
  entorno. Que los 12 bloques hagan lo que dicen es lectura, no medición.
- **Si `guardiaCifras` puede lanzar por algún camino que yo no vi**, lo que
  volvería alcanzable la rama `entrego: 'pendiente'` y convertiría M2 en un
  superviviente de verdad. Recorrí sus dos salidas y su `catch` interno, y el
  `catch` de `processor.ts:697`; no encontré ninguno, pero es un argumento de
  lectura, no una medición.
- **`src/app/(dashboard)/` y las vistas de React**, excluidas de la cobertura a
  propósito. El rubro de frontend las cubre por otro camino y no las toqué.

---

## Confirmación de árbol limpio

Verificado al cerrar, sobre `/home/user/cuadra`. Toda la mutación ocurrió en una
copia del árbol en el scratchpad de la sesión; el repo real no se tocó ni una vez,
y no usé `git stash` en ningún punto.

```
$ git status --short
?? docs/auditoria-7/pruebas.md

$ git diff --stat
(vacío)

$ git stash list
(vacío)
```
