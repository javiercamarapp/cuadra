# Pruebas — auditoría 13

Ancla: HEAD `caae369` (release auditoría 12, producción). Sesión de auditoría-13
sobre el árbol actual; cada mutación se aplicó al working tree, se corrió contra
el archivo mutado y se restauró con `git diff` vacío confirmado al terminar.
Ninguna mutación quedó en el árbol; las pruebas se corrieron locales, sin tocar
base ni CI.

**Nota: 7/10** (ronda 12: **6/10**, re-auditoría en sesión: **8/10**). Razón del
movimiento:

1. **El CRÍTICO de la ronda 12 está cerrado de verdad, y lo verifiqué por
   afuera y por dentro.** La última corrida de master (`31045889794`, el mismo
   `caae369`) es verde; el lint ya es `eslint src/` (`package.json:10`) y el
   trinquete bajó a 64/64/84/78 con medición (`vitest.config.ts`); la corrida
   local con `--coverage` sale exit 0 (líneas 67.7% ≥ 64). Ya no hay forma de
   que el protocolo documentado y la puerta de CI midan cosas distintas.
2. **La capa de datos del panel sí tiene pruebas con datos ahora: analytics.ts
   pasó de 57.42% a 95.66% de líneas y de 63.63% a 100% de funciones.** Las 12
   pruebas nuevas (`analytics_datos.test.ts`) + 3 de zona horaria
   (`analytics_por_dia.test.ts`) existen, corren verdes, y sus controles MURIERON
   bajo mutación (quitar el `'duplicado'` del dinero observado y quitar el
   `eq('tenant_id')` de `getKpis` → fallan). El muro del mock plano (ALTO 3)
   ya no impide la prueba que más importa: `getKpis` con 4 filas funciona y
   afirma monto, tasa y dinero observado.
3. **Pero el ALTO 4 de la ronda 12 —la red de regresión del filtro de tenant—
   no se cerró como dice el commit, y es justo la pieza grave.** El commit
   `c6a916b` afirma "el aislamiento por tenant en cada función"; verifiqué que
   SOLO `getKpis` y `getStatsPorOperador` tienen aserción de filtro. Mutar el
   `eq('tenant_id', tenantId)` de `getLiquidacionDetalle` (línea 668, el límite
   único del camino service_role) da **0 fallos**. Igual para
   `getLiquidacionesPorDia` (172), `getConciliacionConsolidado` (932) y
   `getLineasPorConciliar` (988). El hallazgo que la ronda 12 llamó "la grave"
   sigue sin red.
4. **Y la misma familia de zona horaria que se arregló en
   `getLiquidacionesPorDia` sigue VIVA 120 líneas arriba, en `corteVentana`
   (analytics.ts:42), sin una sola prueba.** Con valores reales: a las 20:00
   CDMX, `corteVentana(7)` corta en `2026-07-27T00:00Z` = 26-jul 18:00 local, y
   una liquidación cerrada el 26-jul a las 10:00 local queda FUERA del "últimos
   7 días" — que es la vista por defecto de `/dashboard`
   (`resolverRango(sp?.rango, '7')`). La mutación de ventana corrida un día
   (M7) sigue sobreviviendo: el camino `gte('created_at', corte)` no corre en
   NINGUNA prueba.

Subió respecto a la ronda 12 (el CI cerró y el dinero del panel dejó de estar
huérfano) pero no llega a 8: el rubro pruebas existe para garantizar el
aislamiento entre tenants y la verdad de los rótulos de periodo, y las dos
garantías quedaron a medias — una de ellas con un bug vivo en la pantalla que
se va a proyectar.

---

## Método

1. `npx vitest run` completo: **244 archivos, 3,132 passed | 1 skipped** — la
   cifra exacta del PROMPT-BASE (el skipped es el arnés de ticket real, gateado
   por `TICKET_PATH`).
2. `npx vitest run --coverage` completo: **exit 0**. Líneas 67.7%
   (12,342/18,228), statements 67.7%, funciones 79.69% (683/857), ramas 85.47%
   (4,755/5,563). Umbrales de `vitest.config.ts`: 64/64/84/78. La corrida que
   CI corre hoy pasa.
3. Cobertura dirigida de `analytics.ts`: **líneas 95.66% (485/507), funciones
   100% (24/24), ramas 78% (156/200)** — contra 57.42%/63.63%/82.6% de la
   ronda 12.
4. **Mutación real sobre el árbol, restaurada al instante con diff vacío
   confirmado** (9 mutaciones + 2 controles). Detalle en el hallazgo ALTO 1.
5. `npx eslint src/` → exit 0 (10 warnings, ninguno de los fixes de la 12);
   `npx tsc --noEmit -p .` → limpio.
6. `gh run list`/`gh run view` sobre master: las 4 corridas posteriores a
   `be54830` son verdes (la última, `31045889794`, es el release en producción).
7. Re-leí el arnés: `pg.test.ts`, `analytics_paginacion.test.ts`,
   `analytics_consolidado.test.ts`, `pruebas_en_ci.test.ts`,
   `guion_demo.test.ts`, `analytics_deriva.test.ts` — sin cambios desde la
   ronda 12 en lo que los hacía ejemplares.

---

## Estado del suite, al momento de anclar

- `npx vitest run` → **244 archivos, 3132 passed | 1 skipped, 0 fallos.**
- `npx vitest run --coverage` → **exit 0**: 67.7/67.7/79.69/85.47 contra
  umbrales 64/64/78/84 (funciones y ramas con margen de 1.69 y 1.47 puntos;
  líneas con 3.7).
- `npx eslint src/` → 0 errores, 10 warnings (3 del fix de la 12:
  `pideConteo` sin usar en `analytics_por_dia.test.ts:13`).
- `npx tsc --noEmit -p .` → limpio.
- `gh run list --branch master` → verdes: `31038856873`, `31041891167`,
  `31045889794` (release); `31045698446` cancelada por supersederla el push
  siguiente. Cero rojas desde `be54830`.

---

## Hallazgos por severidad

### ALTO 1 — La red de regresión del filtro de tenant NO se cerró: el commit la anuncia y solo 2 de 6 lecturas la tienen; mutar el `eq` del detalle (el IDOR) da 0 fallos

**Archivo/línea:** `src/lib/cuadra/analytics.ts:668` (`.eq('tenant_id', tenantId)`
de `getLiquidacionDetalle`), 172 (`getLiquidacionesPorDia`), 512
(`getDocumentos`), 932 (`getConciliacionConsolidado`), 988
(`getLineasPorConciliar`). El commit `c6a916b` dice textual: "afirman el
aislamiento por tenant en cada función (getKpis, getStatsPorOperador,
contarViajes, getViajesSinLiquidar, getGastoPorConcepto, getOperadoresDetalle,
getViajes, getDocumentos, getValorAhorro)". Revisado el archivo: **solo
`getKpis` y `getStatsPorOperador`** tienen una aserción
`toContainEqual(['tenant_id', 't-1'])` (`analytics_datos.test.ts:80-86` y
`102-107`). Las demás siembran filas TODAS del tenant `t-1` y nunca afirman que
el filtro se aplicó — con todas las filas del mismo tenant, quitarlo no cambia
ningún número.

**Escenario concreto (mutaciones verificadas, todas sobreviven):**
- Quitar `.eq('tenant_id', tenantId)` de `getLiquidacionDetalle` (línea 668):
  la consulta queda solo con `.eq('id', id)` sobre el camino `supabaseAdmin`
  (service_role: la RLS de la 0078 no lo protege) → **0 fallos en los 34 tests
  de `analytics.test.ts` + 12 de `analytics_datos.test.ts` + 3 de
  `analytics_por_dia.test.ts`**. Es exactamente el M19 que la ronda 12 marcó
  como "la grave" y su reporte dejó escrito: "este `eq` es el ÚNICO límite
  entre tenants; la página `src/app/dashboard/[id]/page.tsx:81` toma el `id`
  del URL". Hoy el `tenantId` viene de la sesión, así que no es un IDOR
  explotable — es una red de regresión ausente sobre el único límite que le
  queda al camino. Un refactor futuro que tome el id de otro lado no tendría
  ni una prueba que lo vea.
- Quitar el mismo `eq` de `getLiquidacionesPorDia` (172), de
  `getConciliacionConsolidado` (932) y de `getLineasPorConciliar` (988) → 0
  fallos en sus archivos de prueba.
- `getDocumentos` (512): el mock de `analytics_datos.test.ts:207` siembra
  `TABLAS.liquidacion` cuando la función lee `gasto` (`analytics.ts:510`) — el
  filtro de tenant de la bandeja de documentos tampoco tiene aserción (ver
  MEDIO 2).

**Controles (mismo arnés):** quitar el `eq` de `getKpis` (56) → 1 fallo
("solo cuenta las liquidaciones DE ESTE TENANT"); quitar `'duplicado'` del
dinero observado (66) → 1 fallo. El arnés de mutación es válido; los 5 de
arriba son huecos reales.

**Estado: abierto** (parcialmente cerrado: 1 de 6 lecturas del listado de la
ronda 12 quedó cubierta).

### ALTO 2 — `corteVentana` sigue con el bug de zona horaria que la ronda 12 arregló 120 líneas abajo: el corte de "últimos 7 días" no son 7 días locales, y ninguna prueba toca el camino `gte`

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42` — el default del parámetro
`hoy` es `new Date().toISOString().slice(0, 10)` (fecha UTC), mientras su
hermana `getLiquidacionesPorDia` (166) usa
`toLocaleDateString('en-CA', { timeZone: TZ_MX })` — el arreglo de la ronda 12
(`3f73a7b`) se aplicó a UNA de las dos ventanas del mismo archivo. El corte
resultante se aplica en las líneas 57 (`getKpis`) y 215 (`getAcreditables`), y
las dos reciben `ventana` (7/30) desde `dashboard/page.tsx:87-88` — donde
`resolverRango(sp?.rango, '7')` (global-filter.tsx:39-46) hace que **7 días sea
la vista por defecto** del panel del demo.

**Escenario concreto (verificado con aritmética real):** el 1-ago-2026 a las
20:00 CDMX (= 02:00Z del 2-ago), `hoy` por defecto es `'2026-08-02'` (UTC).
`corteVentana(7)` produce `'2026-07-27T00:00:00Z'` = **26-jul 18:00 hora local**.
El rótulo dice "últimos 7 días" y el corte deja FUERA todo lo cerrado entre las
00:00 y las 17:59 del 26-jul (18 horas del día más viejo de la ventana), y
cuenta 6 días + 2 horas. Concretamente: una liquidación cerrada el 26-jul a las
10:00 local (16:00Z) se cae del KPI "LIQUIDACIONES DEL PERIODO" con el filtro
en 7d. A otras horas del día el error corre al revés (la ventana incluye horas
de más); en ningún caso son los 7 días locales que el rótulo promete. Es la
misma clase que el propio archivo documenta como bug arreglado en el detalle
(`analytics.ts:655-661`).
**La mutación de la ronda 12 (ventana corrida un día, M7) SIGUE sobreviviendo**:
`npx vitest run` sobre `analytics.ts` con `-(ventanaDias - 1)` → `-ventanaDias`
da 0 fallos; el `gte` con `corte` seteado no corre en ninguna prueba (todas
llaman `getKpis('t-1')` / `getAcreditables('t-1')` sin ventana).
**Estado: abierto.**

### MEDIO 1 — Los campos passthrough del detalle (litros, IEPS, IVA, peaje, diferencia, anticipo, pdf) siguen sin una sola aserción; el detalle que abre el demo mostraría "42 litros" y nadie lo vería

**Archivo/línea:** `src/lib/cuadra/analytics.ts:694-702` (`totalAnticipo`,
`diferencia`, `ieps`, `litrosDiesel`, `iva`, `peaje`, `pdfPath`). Las pruebas
del detalle (`analytics.test.ts:163-324`) afirman `gastos`, `creadoEn`,
`operadorId/Nombre`, `deducibilidad`, `comprobantesCuadran/Excluidos`,
`viajeId`, `folio` — ninguna de las líneas 694-702 (grep de aserciones: sin
resultados).
**Escenario concreto (mutación verificada):** `litrosDiesel:
Number(... ?? 42)` (M9 de la ronda 12) → **0 fallos**. El detalle que el guion
del demo abre (`GUION_DEMO.md:130`) enseñaría 42 litros de diésel y la suite no
se enteraría. Mismo riesgo para `ieps`, `iva`, `peaje`, `diferencia`,
`totalAnticipo` y `pdfPath`.
**Estado: abierto** (igual que en la ronda 12).

### MEDIO 2 — El "test" de `getDocumentos` en `analytics_datos.test.ts` es hueco: siembra la tabla equivocada y afirma solo `Array.isArray` — pasa aunque borren el cuerpo de la función

**Archivo/línea:** `src/lib/cuadra/analytics_datos.test.ts:206-210` siembra
`TABLAS.liquidacion` mientras `getDocumentos` lee `gasto`
(`analytics.ts:510`); la aserción es `expect(Array.isArray(r)).toBe(true)`.
**Escenario concreto (mutación verificada):** `concepto: 'otro'` fijo en el
mapeo (`analytics.ts:518`, el M de la ronda 12) → **0 fallos**. La función ni
siquiera recibe filas: con `gasto` vacío devuelve `[]` y el test pasa igual.
Es peor que la ausencia: la prueba existe, cuenta en el total (12 de las "12
pruebas con datos"), suma líneas a la cobertura, y no verifica NADA del mapeo
(monto, folio, rfc, `ocr_confianza`, `tieneImagen`) ni el filtro de tenant.
Su gemelo `getViajes` (líneas 201-205) es débil pero no hueco: al menos las
filas fluyen.
**Estado: abierto** (nuevo en esta ronda; la ronda 12 lo marcó como "sin
aserción" — la situación empeoró porque ahora hay un test que aparenta cubrirlo).

### MEDIO 3 — La ventana 7d/30d (GlobalFilter) sigue sin prueba: `corteVentana` no corre nunca con `ventanaDias`, y el `hoy` inyectable sigue documentando una prueba que no existe para el corte

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42-47` y las ramas `corte ?
q.gte(...) : q` de las líneas 57 y 215. Ninguna prueba llama
`getKpis(tenantId, 7)` ni `getAcreditables(tenantId, 7)` (grep: todas las
llamadas de test son con un argumento). El comentario de
`getLiquidacionesPorDia` (160-162) prometía "`hoy` inyectable… una prueba de
ventana no puede depender del reloj real" — esa prueba existe ahora para
`getLiquidacionesPorDia` (las 3 de `analytics_por_dia.test.ts`) pero el corte
de las otras dos consultas sigue sin ella.
**Escenario concreto:** M7 (ventana corrida un día) sobrevive; el panel
"últimos 7 días" podría traer 6 u 8 días y la suite no se entera. Además, al no
correr la rama `gte`, el bug de zona horaria del ALTO 2 pasó desapercibido.
**Estado: abierto** (la ronda 12 lo dejó abierto y el commit `3f73a7b` solo
cubrió la gráfica, no el corte).

### BAJO 1 — `getLineasPorConciliar`: los fallos de las tres consultas secundarias siguen sin prueba (BAJO 9 de la ronda 12)

**Archivo/línea:** `src/lib/cuadra/analytics.ts:1002` (`cfdi_xml`), `1013`
(`gasto`), `1021` (`viaje`) — las tres pasan por `exigir` y en todo
`analytics.test.ts` las respuestas de esas tablas son siempre `error: null`
(verificado por grep: ningún `respuestas.set('cfdi_xml', {… error: ERROR_RED})`).
Si una de las tres lecturas cae, el contador ve un 500 sin red de regresión.
**Estado: abierto** (sin cambios desde la ronda 12).

### BAJO 2 — La mutación de `tasaCuadre` (round→floor) sigue sobreviviendo, y el propio test lo admite

**Archivo/línea:** `src/lib/cuadra/analytics.ts:74`; el test
`analytics_datos.test.ts:49-56` usa 2 de 4 cuadradas (50% — floor y round dan
lo mismo) y su comentario dice textual: "Math.floor daría lo mismo". Verificado
por mutación: **0 fallos**. Con 2 de 3 cuadradas (66.67%) round da 67 y floor
66 — el panel mostraría 66% y la suite no lo vería. Bajo impacto, pero la
aserción de la cifra más pública del KPI (la tasa de cuadre) sigue sin poder
distinguir el redondeo.
**Estado: abierto** (heredado de la ronda 12, sin cambios).

---

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 12 está cerrado y verificado por tres vías**:
  (a) `gh run list` — master verde desde `be54830`; la corrida del release
  `31045889794` completa en 2m32s con Typecheck/Lint/Tests/Build ✓; (b)
  `npx vitest run --coverage` local → exit 0 con 67.7% ≥ 64; (c) `package.json`
  `"lint": "eslint src/"` — lo que CLAUDE.md documenta es lo que CI corre.
- **El fix de zona horaria de `getLiquidacionesPorDia` está bien hecho y
  probado**: `diaLocal` usa `toLocaleDateString('en-CA', { timeZone: TZ_MX })`
  (184-185); las 3 pruebas de `analytics_por_dia.test.ts` cubren el corrimiento
  de tarde (20:00 CDMX → barra del 31-jul), el mediodía sin corrimiento, y la
  ventana completa con ceros; verifiqué que la del corrimiento fallaría contra
  el `.slice(0,10)` viejo.
- **El arnés de mutación es válido**: los 2 controles en código cubierto
  murieron (quitar `'duplicado'` del dinero observado; quitar el `eq` de
  `getKpis`). Las 9 mutaciones que sobreviven (ALTO 1, MEDIO 1, MEDIO 3, BAJO
  2) son huecos reales del mismo método.
- **`getKpis` con datos — la prueba que la ronda 12 demostró imposible con el
  mock plano — hoy existe y afirma las cuatro cifras del panel**: 4 filas →
  `viajesLiquidados 4`, `montoComprobado 5300`, `diferenciaDetectada 500`
  (sobre_politica 200 + duplicado 300), `tasaCuadre 50`. El mock nuevo pagina
  con `range` real y APLICA los filtros `eq`/`in` (`analytics_datos.test.ts`),
  de modo que distingue diésel de caseta y tenant de tenant.
- **`getStatsPorOperador` (BAJO 8 de la ronda 12) quedó cerrado probándolo**:
  acumula el diésel vía el dueño del viaje (Ana 3,500 / Beto 700), descarta el
  gasto de caseta, y afirma el filtro de tenant en las tres lecturas.
- **`pg.test.ts`, `analytics_paginacion.test.ts`, `analytics_consolidado.test.ts`
  siguen intactos y verdes** — el estándar de mock fiel del repo (re-bana
  `range`, respeta `max_rows`, solo manda `count` si se pidió) no se movió.
- **`pruebas_en_ci.test.ts` sigue enganchada al CI real**: verifica que los
  `skipIf(CUADRA_COBERTURA)` (los 2 de tiempo) queden cubiertos por el paso
  "Pruebas de tiempo" y que CI siga corriendo `test:coverage`. Los 3 skipped
  de la corrida instrumentada son los 2 de tiempo + el arnés de ticket real
  (gateado por `TICKET_PATH`, no por la bandera).
- **`guion_demo.test.ts`** (ata el guion a lo que el panel pinta: litros y no
  IEPS en pesos, aviso de liquidaciones de siembra, dev_mode) sigue verde.
- **Los tests de los otros fixes de la ronda 12 que toqué al pasar**:
  `cifras.test.ts` (cardinales sueltos), `estado_afirmado.test.ts`
  (negaciones/preguntas/futuro), `analytics_deriva.test.ts` (el portón de
  deriva con el motor real) — todos presentes y con aserciones que se romperían
  si el fix se revirtiera.
- **La suite completa**: 3,132 passed | 1 skipped, exactamente la cifra del
  PROMPT-BASE, y la corrida `--coverage` (la que CI usa) pasa su propio umbral.

## Lo que no alcancé a revisar

- **No audité la calidad de las ~52 pruebas nuevas de los otros rubros** de la
  ronda 12 (saas/transferencia_mensualidad, suscripcion_eventos, processor,
  privacidad, operacion): verifiqué que existen y pasan, no que cada una
  rompa si su fix se revierte (habría sido una mutación por fix de otro rubro).
- **No volví a mutar `analytics.test.ts` (el mock plano)** para confirmar que
  los 34 tests de error/detalle sobreviven a mutaciones de datos: su propósito
  es la traducción de errores por valor y la reconstrucción del detalle, y eso
  sí lo hace — pero las mutaciones de MONTO dentro de ese archivo (p. ej.
  `totalComprobado` mal sumado en la reconstrucción) no las re-corrí.
- **No corrí `pruebas-manuales/*.prueba.ts`** (regla del proyecto: llamadas
  reales a portales/pago).
- **No verifiqué el render** de las pantallas del dashboard (rubro frontend),
  ni el comportamiento del `GlobalFilter` en el navegador.

---

## Veredicto

**Amarillo, con dos condiciones antes de dar green light al rubro pruebas.**

Lo que sostiene el progreso:
1. **La puerta de CI está cerrada y la verifiqué por fuera (gh) y por dentro
   (local)**: lint y cobertura miden lo mismo que documenta CLAUDE.md, y la
   corrida del release `caae369` —la que está en producción— es verde.
2. **El dinero del panel ya no está huérfano**: `analytics.ts` pasó de 8
   funciones a ~0% a 100% de funciones y 95.7% de líneas ejecutadas con datos
   reales y aserciones de monto; los controles de mutación mueren.

Lo que impide el green light:
1. **El hallazgo que la ronda 12 marcó como "la grave" del ALTO 4 sigue sin
   red**: quitar el `eq('tenant_id')` de `getLiquidacionDetalle` —el único
   límite del camino service_role— da 0 fallos en toda la suite. El commit
   `c6a916b` lo anuncia como cerrado y no lo está; de las 6 lecturas listadas
   en su propio reporte, solo 2 tienen aserción de tenant.
2. **El bug de zona horaria de la familia que la ronda 12 cerró sigue VIVO en
   `corteVentana`**, que alimenta los KPI de la vista por defecto (7 días) del
   panel que se va a proyectar mañana: el corte no son 7 días locales, y la
   mutación que lo demuestra sobrevive. Es literalmente el mismo `.slice(0,10)`
   sobre `toISOString()` que el commit `3f73a7b` dice haber eliminado del
   archivo — eliminado de una de las dos funciones.

El demo de mañana no depende de esto (el seed siembra dentro de la ventana y
el `tenantId` del detalle sale de la sesión, no del URL), pero el rubro pruebas
existe para que ninguna de las dos cosas dependa de la memoria de Javier. Nota
**7/10**: subió de 6 por el cierre real del CI y por las 15 pruebas con datos,
y se queda corto de 8 porque el ALTO 4 —el que la ronda 12 llamó grave— se
declaró cerrado sin estarlo y el bug de zona horaria del corte quedó a medias.
