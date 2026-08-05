# Pruebas — auditoría 12

Ancla: HEAD `ce9abab` (fix RLS 0078, AUDITORÍA 11). Sesión de auditoría-12 en
paralelo sobre el árbol actual; todos los hallazgos de abajo se verificaron con
mutación o ejecución sobre el working tree en el momento exacto de tocarlo, y
cada mutación se restauró con diff vacío confirmado.

**Nota: 6/10** (ronda 10: **8/10**, ▼2). Razón del movimiento, en orden:

1. **CRÍTICO: la puerta de CI está abierta desde el 3-ago y nadie lo notó en
   dos rondas de auditoría.** Todas las corridas de master desde
   2026-08-03T16:47 son rojas (60+ corridas, cero successes — verificado con
   `gh run list`). Primero cayó el umbral de cobertura (`ERROR: Coverage for
   lines (74.81%) does not meet global threshold (78%)` en la corrida
   `30833805404` del 3-ago); hoy el mismo umbral mide **65.7%** de líneas y la
   corrida local de `npx vitest run --coverage` sale con exit 1. Y desde el
   5-ago, el lint de CI (`eslint .`) falla antes siquiera de llegar a las
   pruebas: 217 errores en los `.js` vendidos de
   `docs/investigacion/portales/` (commit `fe32e0d`). El deploy de producción
   `56c267a` se publicó con el CI rojo.
2. **ALTO: la capa de datos del panel del demo no tiene pruebas con datos.**
   `analytics.ts` —el módulo del que leen `/dashboard`, `/analitica`,
   `/operadores`, `/documentos`, `/combustible-casetas` y el detalle que el
   guion del demo abre— mide **57.42% de líneas / 63.63% de funciones**, ocho
   funciones a ~0% de ejecución, y **18 mutaciones sobreviven** (verificado
   con mutación real; los controles en código cubierto sí mueren, así que el
   arnés es válido). Incluye un **bug vivo de zona horaria** en
   `getLiquidacionesPorDia` —la gráfica de barras que proyecta el demo—, la
   misma clase que el propio archivo documenta como arreglada en el detalle.
3. **ALTO: el mock plano de `analytics.test.ts` hace estructuralmente
   IMPOSIBLE la prueba que más importa.** Demostrado: `getKpis` con 4 filas de
   datos contra ese mock lanza `LecturaIncompleta` ("se agotaron las 100
   páginas con 400 filas") porque `range()` es un no-op y `traerTodo` pagina
   la misma página 100 veces. La suite no puede expresar "getKpis con datos";
   por eso el dinero de los cuatro KPI del panel no tiene una sola aserción.

El suite en sí está verde (`npx vitest run`: 240 archivos, 3,079 passed, 1
skipped), y las redes estructurales (`pruebas_en_ci`, `migraciones_verificadas`
con el bloque 54 de la 0078, `pg.test.ts`) siguen siendo ejemplares — pero el
número de pruebas verdes no es la puerta; la puerta es CI, y CI está rojo.

---

## Método

1. `npx vitest run` completo: **3,079 passed | 1 skipped** (el arnés de ticket
   real, gateado por `TICKET_PATH`) — coincide con la cifra del PROMPT-BASE.
2. `npx vitest run --coverage` completo (la misma corrida que CI):
   **exit 1 — ERROR: Coverage for lines (65.7%) / statements (65.7%) /
   functions (79.04%) does not meet global threshold (78/78/83)**. Repetido
   dos veces, números idénticos.
3. Cobertura dirigida de `analytics.ts` (solo sus 4 archivos de prueba) y
   confirmada contra el reporte de la corrida completa: el módulo mide
   290/505 líneas (57.42%), 14/22 funciones (63.63%), 114/138 ramas (82.6%).
4. **Mutación real sobre el árbol de trabajo**: 22 mutaciones en
   `analytics.ts` (10 en código sin ejecutar + 5 controles en código cubierto
   + 7 en filtros de tenant/estatus), cada una corrida contra los 4 archivos
   de prueba de analytics + `pg` + `duplicados` + `estado`, restaurada al
   instante con diff vacío confirmado. Los 5 controles en código cubierto
   MURIERON (la suite los atrapa); los otros 17 SOBREVIVIERON.
5. Scratch test desechable (borrado tras correr) que demuestra el muro del
   mock plano: `getKpis` con 4 filas → `LecturaIncompleta`.
6. `npx eslint .` (lo que corre CI) y `npx eslint src/` (lo que documenta
   CLAUDE.md): el primero exit 1 (217 errores), el segundo exit 0.
7. `gh run list`/`gh run view` sobre master para anclar la línea de tiempo del
   CI rojo (última verde: 3-ago 16:23; primera roja: 3-ago 16:47; causa:
   umbral de cobertura; desde el 5-ago: lint de `docs/investigacion/portales/`).

---

## Estado del suite, al momento de anclar

- `npx vitest run` → **240 archivos, 3079 passed | 1 skipped (3080), 0 fallos.**
- `npx vitest run --coverage` → **exit 1**. Líneas 65.7% (11,855/18,043),
  statements 65.7%, funciones 79.04% (660/835), ramas 85.94% (4,599/5,351).
  Umbrales de `vitest.config.ts:88-92`: líneas 78, statements 78, ramas 84,
  funciones 83.
- `npx eslint .` → exit 1: 217 errores (215 en
  `docs/investigacion/portales/capufe_vendor.js`, el resto en
  `valoran_ctrl.js`, `tmp.js`, `capufe_main.js`, `t.js`, `fg_purify.js`,
  `shell_purify.js`). `npx eslint src/` → 0 errores, 8 warnings.
- `npx tsc --noEmit -p .` → limpio (exit 0, verificado en esta ronda; el paso
  Typecheck de CI salió ✓ en todas las corridas rojas).

---

## Hallazgos por severidad

### CRÍTICO 1 — CI rojo en master desde el 3-ago: umbral de cobertura caído + lint roto por archivos vendidos; un deploy a producción salió en medio

**Archivo/línea:** `.github/workflows/ci.yml:67-68` (`npm run test:coverage`),
`package.json:10` (`"lint": "eslint ."`), `vitest.config.ts:88-92` (umbrales).
**Escenario concreto:** la última corrida verde de master es `30831967044`
(3-ago 16:23). La siguiente (`30833805404`, 3-ago 16:47) ya falló en el paso
"Tests (con umbral de cobertura)" con, textual, `ERROR: Coverage for lines
(74.81%) does not meet global threshold (78%)`. Hoy, medido dos veces:
`lines 65.7%`, `functions 79.04%` contra umbrales 78/83 — **exit 1**. Desde el
5-ago el paso que falla primero es Lint: `eslint .` recorre el repo entero,
incluido `docs/`, y los 8 `.js` de la investigación de portales commiteados en
`fe32e0d` acumulan 217 errores (215 solo en `capufe_vendor.js`, un bundle
minificado de terceros guardado como evidencia). Las 16 corridas de master del
5-ago fallan todas en Lint (verificado en `31030595942` y `31014745084`), y el
commit `56c267a` ("release: publica auditoría 10… [deploy]") **desplegó a
producción con CI rojo**. El protocolo documentado en CLAUDE.md ("Cómo se
verifica": `npx eslint src/` + `npx vitest run`) no es lo que CI corre
(`eslint .` + `vitest run --coverage`), y por eso las auditorías 10 y 11
publicaron evidencia "verde" mientras la puerta estaba abierta.
**Estado: abierto.** (El fix es pequeño —excluir `docs/` del lint, subir la
cobertura o bajar el trinquete con medición—, pero hoy mismo no está hecho.)

### ALTO 2 — `analytics.ts`: la capa de datos del panel del demo, sin pruebas con datos (8 funciones a ~0%, 18 mutantes que sobreviven)

**Archivo/línea:** `src/lib/cuadra/analytics.ts` — funciones sin ejecutar en
la suite completa: `getStatsPorOperador` (87-120), `getLiquidacionesPorDia`
(163-191), `contarViajes` (413-435), `getViajesSinLiquidar` (451-463),
`getViajes` (465-488), `getDocumentos` (499-521), `getGastoPorConcepto`
(527-543), `getOperadoresDetalle` (563-620). Cobertura del módulo: **líneas
57.42% (290/505), funciones 63.63% (14/22), ramas 82.6%** — los umbrales del
repo son 78/83/84.
**Escenario concreto (mutaciones verificadas, todas sobreviven):**
- `analytics.ts:74` `Math.round`→`Math.floor` en `tasaCuadre` — sobrevive.
- `analytics.ts:66` quitar `|| d.tipo === 'duplicado'` del dinero observado —
  sobrevive (la detección de fraude duplicado deja de sumarse).
- `analytics.ts:70` `montoComprobado` siempre 0 — sobrevive.
- `analytics.ts:509` `getDocumentos` con `concepto: 'otro'` fijo — sobrevive.
- `analytics.ts:542` `getGastoPorConcepto` con el sort invertido — sobrevive.
- `analytics.ts:188` `getLiquidacionesPorDia` con los días al revés —
  sobrevive.
- `analytics.ts:434` `contarViajes` devolviendo `0` donde debería devolver
  `null` (la diferencia "no hay viajes" vs "no se pudo contar") — sobrevive.
- `analytics.ts:614` `getOperadoresDetalle` con `Math.floor` en el % de
  comprobación — sobrevive.
- `analytics.ts:45` `corteVentana` con la ventana corrida un día — sobrevive.
- `analytics.ts:691` `litrosDiesel: Number(... ?? 42)` — sobrevive.

**Controles (mismos archivos de prueba, código cubierto):** `derivoLaConfig`
siempre false, acumulado congelado, `viajeFolio` siempre null, `sinMatch`
siempre 0, horas-ahorradas ÷50 → las cinco MURIERON. El arnés de mutación es
válido; los 10 de arriba son huecos reales, no ruido del método.
**Escenario de demo:** GUION_DEMO.md:106 proyecta `/dashboard` — los cuatro
KPI (líneas 69-74), la gráfica "Liquidaciones cerradas por día" (163-191) y la
bandeja de documentos (499-521) no tienen UNA aserción con valores reales.
**Estado: abierto.**

### ALTO 3 — El mock plano de `analytics.test.ts` impide probar `getKpis` con datos

**Archivo/línea:** `src/lib/cuadra/analytics.test.ts:38-46` (`crearBuilder`):
`select`, `eq`, `order`, `limit`, `range`, `in`, `gte`, `lte`, `is` son no-ops
que devuelven el mismo builder (línea 42); la respuesta es SIEMPRE la misma
página. `traerTodo` (`pg.ts:96-131`) pagina por filas leídas, así que con datos
no vacíos duplica la página hasta las 100 y lanza.
**Escenario concreto (demostrado con scratch test, borrado al terminar):**
`getKpis('t1')` con 4 liquidaciones reales → `getKpis: lectura incompleta — se
agotaron las 100 páginas con 400 filas…`. Es decir: **hoy no existe forma de
escribir la prueba que verifique el dinero de los KPI del panel**, porque el
único mock disponible la revienta. Los autores lo saben:
`analytics_consolidado.test.ts:8-11` documenta que "el builder plano de
analytics.test.ts NO sirve aquí" (y por eso ese archivo usa un mock que
re-bana `range` de verdad) — pero el mock plano nunca se actualizó, y el hueco
quedó en las funciones que SÍ dependen de él: `getKpis` y `getAcreditables`.
El estándar correcto ya existe en el repo: `pg.test.ts:17-35` (`baseFalsa`
re-bana, respeta `max_rows` y solo manda `count` si se pidió) y
`analytics_paginacion.test.ts:24-38`. El mock plano es el que se queda atrás.
**Estado: abierto.**

### ALTO 4 — Ninguna prueba afirma el filtro por tenant de las consultas de analytics; el IDOR de `getLiquidacionDetalle` no tiene red de regresión

**Archivo/línea:** las únicas aserciones de forma del suite de analytics son
`tablasLeidas` (`analytics.test.ts:402-403`) y `llamadasRpc` (407-411) — ni una
afirma `.eq('tenant_id', …)`. El mock de `eq` es un no-op (`analytics.test.ts:42`).
**Escenario concreto (mutaciones verificadas, todas sobreviven):** quitar
`.eq('tenant_id', tenantId)` de `getKpis` (línea 56), `getLiquidacionesPorDia`
(172), `getDocumentos` (503), `getConciliacionConsolidado` (924),
`getLineasPorConciliar` (979) y —la grave— **`getLiquidacionDetalle`
(659)**. Esta última corre por `supabaseAdmin` (service_role: la RLS de la 0078
NO protege este camino), y ese `eq` es el ÚNICO límite entre tenants: la página
`src/app/dashboard/[id]/page.tsx:81` toma el `id` del URL; si el filtro se
cae, cualquiera lee la liquidación de otra flota (folio, montos, PDF path,
operador) por id. Es la misma familia de IDOR que las auditorías 10/11
cerraron para `operadorId`/`unidadId` — pero esas se cerraron CON PRUEBA; este
no tiene ninguna. `M19` (quitar la línea 659): 0 fallos.
**Estado: abierto.**

### ALTO 5 — Bug vivo de zona horaria en `getLiquidacionesPorDia`: la gráfica del demo mueve los cierres de la tarde al día siguiente

**Archivo/línea:** `src/lib/cuadra/analytics.ts:179-181`:
`const dia = (r.created_at as string).slice(0, 10)` sobre un `timestamptz`
que PostgREST devuelve en UTC.
**Escenario concreto:** una liquidación cerrada el 31-jul-2026 a las 20:00
CDMX (UTC-6) se guarda como `2026-08-01T02:00:00Z`; `.slice(0,10)` da
`'2026-08-01'` (verificado: `'2026-08-01T02:00:00.123456+00:00'.slice(0,10)`
→ `'2026-08-01'`), así que el cierre cae en la barra del 1-ago, no del 31-jul.
Cualquier cierre entre las 18:00 y las 23:59 hora local (00:00–05:59Z) se
atribuye al día siguiente. **El propio archivo documenta esta clase como bug
arreglado en el detalle**: `analytics.ts:655-661` dice que `.slice(0, 10)`
"fechaba en agosto lo cerrado el 31 de julio a las 20:00 hora local
(auditoría 5, frontend, MEDIO 3)" y que por eso `creadoEn` viaja crudo y se
formatea en pantalla — la misma función hermana `getLiquidacionesPorDia`
siguió con el mismo slice, sin pruebas que lo vieran (0% de cobertura). Es la
gráfica de barras que el guion del demo proyecta en el paso 4.
**Estado: abierto.**

### MEDIO 6 — La ventana 7d/30d (GlobalFilter) nunca se prueba

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42-47` (`corteVentana`):
las líneas 44-47 (la aritmética de fechas) no se ejecutan en ninguna prueba;
las ramas `corte ? q.gte('created_at', corte) : q` de las líneas 57 y 206
nunca corren con `corte` seteado. `dashboard/page.tsx:87-90` y
`analitica/page.tsx:46-48` pasan `ventana` (7/30/undefined) en producción.
**Escenario concreto:** M9 (ventana corrida un día: `-(ventanaDias - 1)` →
`-ventanaDias`) sobrevive: el panel "últimos 7 días" podría estar trayendo 6
u 8 días y la suite no se entera. El comentario de `getLiquidacionesPorDia`
(líneas 160-162) promete "`hoy` inyectable por la misma razón que ahí (una
prueba de ventana no puede depender del reloj real)" — **no existe tal
prueba**; el parámetro `hoy` inyectable está documentando una prueba que nadie
escribió.
**Estado: abierto.**

### MEDIO 7 — Campos passthrough del detalle de liquidación sin aserción

**Archivo/línea:** `src/lib/cuadra/analytics.ts:685-699` — `totalAnticipo`,
`diferencia`, `ieps`, `litrosDiesel`, `iva`, `peaje`, `pdfPath`. Las pruebas
del detalle (`analytics.test.ts:246-345`) afirman `gastos`,
`comprobantesCuadran/Excluidos`, `deducibilidad`, `creadoEn`, `viajeId`,
`operadorId`, `operadorNombre`, `totalComprobado` — ninguna de las líneas
685-699 (grep de aserciones: sin resultados).
**Escenario concreto:** M10 (`litrosDiesel: Number(... ?? 42)`) sobrevive; el
detalle que el demo abre (GUION_DEMO.md:130) mostraría 42 litros y la suite
no lo vería. El mismo riesgo corre para `ieps`, `iva`, `peaje`, `diferencia`,
`totalAnticipo` y `pdfPath`.
**Estado: abierto.**

### BAJO 8 — `getStatsPorOperador`: código muerto exportado, 0% de cobertura

**Archivo/línea:** `src/lib/cuadra/analytics.ts:87-120`. Ninguna prueba la
llama y ningún módulo de producción la importa (solo se la menciona en
comentarios: `operadores/page.tsx:76`, `analytics.ts:561`); la página de
operadores usa `getOperadoresDetalle` desde la ronda 5. Es una trampa de
mantenimiento: una función exportada sin dueño que infla el conteo de
"funciones del módulo" en los totales de cobertura y que un futuro barrido
puede confundir con código vivo. Borrarla o probarla; hoy está las dos cosas
mal.
**Estado: abierto.**

### BAJO 9 — `getLineasPorConciliar`: los fallos de las consultas secundarias no se prueban

**Archivo/línea:** `src/lib/cuadra/analytics.ts:992` (`cfdi_xml`), `1003`
(`gasto`), `1011` (`viaje`) — las tres pasan por `exigir` y ninguna tiene
prueba de error (solo los caminos felices y el gasto-borrado en
`analytics.test.ts:473-540`). Además el `conteo(desde)` del select (línea 978)
no está forzado por el mock plano: si producción dejara de pedir `count`, las
pruebas seguirían verdes (el `count` de la respuesta lo pone el test a mano,
no el mock).
**Estado: abierto.**

---

## Lo que revisé y está bien

- **El suite está verde y coincide con la cifra oficial**: `npx vitest run` →
  240 archivos, 3,079 passed | 1 skipped (el arnés de ticket real, gateado por
  `TICKET_PATH`), 0 fallos.
- **El arnés de mutación es válido**: los 5 controles en código cubierto de
  `analytics.ts` murieron (M11-M15); los 17 que sobreviven son huecos reales.
- **`pg.test.ts` sigue siendo el estándar de mock fiel del repo**: `baseFalsa`
  re-bana `range`, respeta `max_rows` y solo devuelve `count` si la consulta lo
  pidió (`pg.test.ts:17-35`); `traerTodo`, `conteo()` y `LecturaIncompleta`
  están probados de punta a punta, incluido el mensaje con la cuenta exacta
  ("solo se leyeron 700 de 1200").
- **`analytics_consolidado.test.ts` pagina de verdad** (1,200 filas → 1,100
  conciliadas / 50 por conciliar / 50 sin_match / 5 CFDI) y respeta `conteo()`
  (solo pide count en la primera página). **`analytics_paginacion.test.ts`**
  verifica que el registro 1,001 se ve y que el rango pedido es `[0, 999]`.
- **`analytics_deriva.test.ts` prueba la función real, no una reimplementación**
  — documenta el arreglo de la ronda 7 (la copia infiel que probaba "el
  criterio" y no la función) y fija la premisa del portón con el motor real.
- **`migraciones_verificadas.test.ts` cubre la 0078**: el bloque 54 de
  `supabase/verificaciones.sql:2970-3036` siembra filas en las siete tablas,
  impersona un chofer y un `flota_admin`, y exige el conteo exacto
  (0/0/0/0/0/0/0/0/1/2). Leí la migración 0078 línea por línea (la política
  correcta de la 0047 aplicada a las siete tablas, `tenant` en solo lectura
  por RLS) y el bloque la verifica bien. Ese hallazgo del prompt está cerrado
  y su prueba existe.
- **`pruebas_en_ci.test.ts` sigue enganchada a un self-check**: falla si un
  `skipIf(CUADRA_COBERTURA)` nuevo queda fuera del paso "Pruebas de tiempo
  (sin cobertura)" de CI, y exige que CI siga corriendo `test:coverage`.
  Los 4 usos actuales de skip son los ya conocidos.
- **`duplicados.test.ts`** prueba la función pura real (folio vs UUID,
  mismo viaje, tres viajes, el folio que contiene un UUID); **`costos.test.ts`**
  usa un mock encadenado que VERIFICA argumentos (`insert.mock.calls[0][0]`
  con las columnas exactas), no un no-op.
- **`estado.test.ts` es honesto sobre qué prueba**: lee el `page.tsx` real por
  fuente (mismo patrón que `foto_no_expuesta`) y no pretende renderizar.
- **`npx tsc --noEmit` y el paso Typecheck de CI**: ✓ en las corridas rojas.

## Lo que no alcancé a revisar

- **No audité la alineación de los otros ~56 archivos que mockean
  `@/lib/supabase/admin`** — solo el cluster analytics/pg/costos/duplicados y
  el barrido del patrón "no-op chain" (13 archivos lo usan; no verifiqué uno a
  uno cuáles registran argumentos y cuáles no).
- **No corrí `pruebas-manuales/*.prueba.ts`** (regla del proyecto: llamadas
  reales a portales/pago).
- **El paso Build de CI no llegó a correr en las corridas rojas de master**
  (fallan antes, en Lint) — puede tener fallos propios que nadie ha visto
  desde el 3-ago.
- **No identifiqué qué commits del 3-ago al 5-ago hundieron la cobertura de
  74.81% a 65.7%** (habría requerido checkouts aislados; lo dejo como deuda
  para la siguiente ronda, junto con la decisión de qué se hace con el
  trinquete).
- **No verifiqué el render** de las pantallas del dashboard (rubro frontend).

---

## Veredicto

**No hay green light.** Tres motivos, en orden de urgencia:

1. **La puerta de CI está abierta desde el 3-ago y se desplegó producción en
   medio.** El umbral de cobertura falla (65.7% vs 78%) y el lint falla por
   archivos vendidos en `docs/` (`eslint .` vs el `eslint src/` que documenta
   CLAUDE.md). Hasta que no se cierre esto, "la suite está verde" es una
   afirmación que solo es cierta para `vitest run`, no para el mecanismo que
   el repo eligió como puerta — y el protocolo de verificación documentado es
   el que impidió verlo.
2. **La capa de datos que el demo proyecta mañana no tiene pruebas con
   datos**: 8 funciones de `analytics.ts` a 0%, 18 mutantes que sobreviven
   (incluido el filtro de tenant y un IDOR de `getLiquidacionDetalle`), y un
   bug vivo de zona horaria en la gráfica de barras del paso 4 del guion.
3. **El mock plano de `analytics.test.ts` es un muro, no una red**: impide
   escribir la prueba más importante del módulo, y el repo ya tiene el
   estándar correcto en `pg.test.ts` para sustituirlo.

Lo que sí está sólido: el suite en sí (3,079 verdes), `pg.test.ts`,
`migraciones_verificadas` con el bloque 54 de la 0078, `pruebas_en_ci`, y el
código de dinero que SÍ está cubierto (cuadre, deducibilidad, `derivoLaConfig`,
`getValorAhorro`, `getLiquidacionDetalle` en sus caminos principales) murió
bien bajo mutación. La nota 6/10 refleja que el rubro pruebas existe
precisamente para garantizar las dos cosas que hoy están rotas: la puerta
automatizada y la protección del dinero que se va a enseñar.
