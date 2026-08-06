# Pruebas — auditoría 15

Ancla: HEAD `d7b171f` (los fixes de la ronda 14: `8a33ce1` fiscal RFA 2.9 +
`d7b171f` 7 backend + ARCO). Sesión sobre el árbol actual; cada mutación se
aplicó al working tree, se corrió contra el archivo mutado y se restauró con
`git diff` vacío confirmado al terminar. Ninguna mutación quedó en el árbol.

**Nota: 6/10** (ronda 14: **6/10**). Razón del movimiento: **se atacó y subió,
pero la deuda propia cobró la misma factura** — los fixes de la ronda 14
cerraron los dos ALTOS más públicos de la feature CON prueba (el estatus
'revisar' y el excedente por comprobante: verificados por lectura y por
mutación), y eso es real. Pero el rubro pruebas no cerró NINGUNO de sus dos
ALTOS propios (tenant 4ª ronda, ventana UTC 3ª ronda), el ALTO 4 sigue vivo
(2ª ronda), y la promesa del commit de la ronda 14 —"todos corregidos con
prueba"— es falsa: de los ~15 fixes anunciados entre `8a33ce1` y `d7b171f`,
solo 3 tienen prueba (2 del motor + el route-test de Stripe). Lo demostré con
dos mutaciones que sobreviven en el propio código de la ronda 14
(`ivaSostenible` del efectivo, y la nota "tope de $0.00" del contador caído,
que el fix introdujo/agravó). 6 se queda: la feature subió, la red no.

---

## Método

1. **Verificación de los cierres de la ronda 14 por lectura + mutación:**
   - ALTO 3 (estatus 'revisar'): `engine.ts:1133` — `efectivo_sobre_15` y
     `efectivo_no_elegible` ya están en `REVISAR`; 2 tests nuevos
     (`engine.test.ts:1478-1492`) afirman `estatus === 'revisar'`. **Cerrado
     de verdad.**
   - ALTO 4 (facilidad sin CFDI): **sigue abierto** — verificado con prueba
     temporal (abajo).
   - MEDIO 5 (año del ejercicio): el fix está (desde_db.ts:59-62 ancla en
     `viaje.fechaInicio`/`gasto.fecha`), pero sigue SIN un solo test.
   - MEDIO 6 (alta tri-estado): fix en código (administracion.ts:110-115,
     `undefined` en vez de `false`), pero `crearFlota` no tiene test para la
     config; el test existente solo cubre RFC/nombre.
2. **Mutaciones sobre el árbol, restauradas con `git diff` vacío verificado**
   (6 mutaciones): M1 (quitar `.eq('tenant_id')` de `getLiquidacionDetalle`) →
   0 fallos en 49 tests (4ª ronda); M7 (ventana corrida un día,
   analytics.ts:42) → 0 fallos en 67 tests (3ª ronda); M2
   (`litrosDiesel ?? 42`) → 0 fallos en 46 tests; revertir
   `DIAS_HABILES_ARCO` 20→15 → 40/40 verdes; `tasaCuadre` round→floor → 46/46
   verdes; quitar la línea de IVA del efectivo en `ivaSostenible` (el fix de
   la ronda 14) → **57/57 verdes** (el fix no tiene red). Control positivo:
   quitar la línea `pendiente/no_encontrado` de `ivaSostenible` (cierre de la
   ronda 13) → **2 tests mueren** (ese cierre sigue clavado).
3. **Pruebas temporales creadas, corridas y borradas** (mis archivos
   `zzz-audit15*.test.ts` eliminados; `git status` limpio de mis huellas):
   (a) ALTO 4 — diésel en efectivo sin `cfdiUuid` con `facilidad15: true` →
   la nota dice "deducible por la facilidad del 15%" y `cubetaDe` dice
   `por_confirmar`; (b) MEDIO 4 — "dos mil"→1002, "cinco mil"→1005, "tres mil
   doscientos"→1203, y `cifrasSinRespaldo` lee 1005; (c) MEDIO 8 — "No te
   preocupes, ya quedó cerrada" → `forzado: false`; (d) NUEVO — contador caído
   (`totalCombustibleEjercicio: 0`) → nota "contra un tope de $0.00 (15% de
   $0.00); el excedente de $1,000.00 NO se deduce" y `totalNoDeducible` 1000.
4. **Estado del suite:** 30 archivos objetivo: **533 passed | 0 fallos**;
   batch adicional de 11 archivos: **139 passed | 0 fallos**; liquidación +
   normas + guion + visibilidad + cifra-grande: **66 + 96 passed**. Total
   medido esta sesión: ~800 pruebas verdes en los archivos del rubro. No corrí
   la suite completa (3,1xx): otros auditores corrían en paralelo (aparecieron
   y desaparecieron `zzz-fiscal-aud15-probe.test.ts`,
   `zzz-fiscal-aud15-probe2.test.ts`, `zzz-r15-scratch.test.ts`,
   `aud15-temporal.test.ts` durante la sesión — ninguno es mío, ninguno lo
   toqué).
5. `npx tsc --noEmit -p .` y `npx eslint src/` no se re-corrieron completos
   (rubros arquitectura/backend); el build del release ya estaba verde y no
   hay tipos sin compilar (`elegible15` opcional en `OpcionesFiscales` y
   `status: 503` en `ResultadoTenantApi` compilan en los consumidores que leí).

## Hallazgos por severidad

### ALTO 1 — (heredado, 4ª RONDA) La red de regresión del filtro de tenant sigue sin cerrarse: quitar el `eq` del detalle da 0 fallos

**Archivo/línea:** `src/lib/cuadra/analytics.ts:670` — `.eq('tenant_id', tenantId)`
de `getLiquidacionDetalle`, el único límite del camino service_role. El código
de esta zona NO cambió desde la ronda 13 (el único diff de la ronda 14 en
analytics.ts es el `rfc` de `getOperadoresDetalle`, que la ronda 13 ya traía).

**Escenario concreto (mutación M1 verificada, 4ª vez):** quitar el
`.eq('tenant_id', tenantId)` → la consulta queda solo con `.eq('id', id)` sobre
`supabaseAdmin` → **0 fallos** en 49 tests (analytics + analytics_datos +
analytics_por_dia). Los tests siembran todas las filas del tenant `t-1` y nunca
afirman que el filtro se aplicó. El `tenantId` sale de la sesión, así que no es
un IDOR explotable — es la red ausente sobre el único límite del camino,
CUATRO rondas seguidas.

**Estado: abierto** (sin cambios desde la ronda 13).

### ALTO 2 — (heredado, 3ª RONDA) `corteVentana` sigue en UTC: "últimos 7 días" no son 7 días locales, y la mutación M7 sobrevive

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42` — el default del parámetro
`hoy` sigue siendo `new Date().toISOString().slice(0, 10)` (UTC), mientras su
hermana `getLiquidacionesPorDia` (166-167) usa
`toLocaleDateString('en-CA', { timeZone: TZ_MX })`.

**Escenario concreto (aritmética real, 3ª ronda):** el 1-ago-2026 a las 20:00
CDMX (= 02:00Z del 2-ago), `hoy` por defecto es `'2026-08-02'`.
`corteVentana(7)` produce `'2026-07-27T00:00:00Z'` = 26-jul 18:00 local. Una
liquidación cerrada el 26-jul a las 10:00 local (16:00Z) queda FUERA del
"últimos 7 días". **Mutación M7 verificada:** `-(ventanaDias - 1)` →
`-ventanaDias` → 0 fallos en 67 tests; el `gte('created_at', corte)` no corre
en ninguna prueba.

**Estado: abierto.**

### ALTO 3 — (ronda 14) El estatus 'revisar' del efectivo no deducible: CERRADO, con red

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:1133` — `efectivo_sobre_15`
y `efectivo_no_elegible` ya están en `REVISAR`. Los 2 tests nuevos
(`engine.test.ts:1478-1492`) afirman `estatus === 'revisar'` para el excedente
y para la flota no elegible. Verifiqué por lectura (la lista) y por ejecución
(los tests pasan). Escenario de la ronda 14 (anticipo $1,000, diésel en
efectivo con CFDI $1,000, `facilidad15: false`) ahora da `revisar`.

**Estado: cerrado** (con commit `8a33ce1`, con prueba).

### ALTO 4 — (heredado, 2ª RONDA) El motor sigue afirmando "deducible por la facilidad del 15%" sobre un comprobante SIN CFDI

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:299` — la rama
`if (g.formaPago === '01' && esCombustible)` sigue sin exigir `g.cfdiUuid`. El
commit `8a33ce1` corrigió 7 cosas de la matriz y NO esta. El comentario del
fixture lo declara sin cubrirlo: `engine.test.ts:1418-1420` — "sin CFDI, el
gasto cae a por_confirmar por la regla del ticket, y la facilidad del 15% no
aplica (no hay comprobante que ampare)" — y el fixture `g15` (1421) SIEMPRE
trae `cfdiUuid`.

**Escenario concreto (verificado con prueba temporal):** diésel en efectivo
$1,000, SIN `cfdiUuid`, `facilidad15: true`, ejercicio $10,000, previo 0 →
el motor emite `combustible_efectivo_dentro15` con la nota "deducible por la
facilidad del 15% (RFA 2026 regla 2.9): el ejercicio lleva $1,000.00 de
$10,000.00 … (10% del total, tope 15%). No acredita IEPS" — y `cubetaDe` manda
el MISMO gasto a `por_confirmar` (`totalPorConfirmar` 1000, `totalDeducible`
0). El papel que se archiva se contradice sobre el mismo renglón: "deducible"
y "por confirmar". Es el caso más común del producto (diésel en efectivo con
ticket, antes de facturar). La ronda 14 lo dejó documentado y el fix la dejó
pasar.

**Estado: abierto** (sin cambios desde la ronda 14).

### MEDIO 1 — (heredado) Los campos passthrough del detalle siguen sin aserción, y el `rfc` de `getOperadoresDetalle` tampoco tiene

**Archivo/línea:** `src/lib/cuadra/analytics.ts:694-702` (`totalAnticipo`,
`diferencia`, `ieps`, `litrosDiesel`, `iva`, `peaje`, `pdfPath`) y `621` (el
`rfc` de la ronda 13). **Mutación M2 verificada (3ª vez):**
`litrosDiesel: Number(... ?? 42)` → 0 fallos en 46 tests. El detalle que abre
el demo podría enseñar 42 litros y nadie lo vería.

**Estado: abierto.**

### MEDIO 2 — (heredado) El "test" de `getDocumentos` sigue siendo hueco

**Archivo/línea:** `src/lib/cuadra/analytics_datos.test.ts:206-210` — siembra
`TABLAS.liquidacion` mientras `getDocumentos` lee `gasto` (analytics.ts:510);
la aserción es `expect(Array.isArray(r)).toBe(true)`. Sigue contando en el
total sin verificar NADA del mapeo ni del filtro de tenant.

**Estado: abierto** (sin cambios).

### MEDIO 3 — (heredado) La ventana 7d/30d sigue sin prueba — el bug del ALTO 2 pasó por esto

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42-47` y las ramas
`corte ? q.gte(...) : q` de 57 y 215. Ninguna prueba llama
`getKpis(tenantId, 7)` ni `getAcreditables(tenantId, 7)`.

**Estado: abierto.**

### MEDIO 4 — (heredado, 2ª RONDA) `cardinalesEnPalabras` sigue rompiendo el multiplicador "mil"

**Archivo/línea:** `src/lib/cuadra/cuadre/cifras.ts:222-228` — la composición
`suma = vj > suma || v >= 1000 ? suma + vj : ...` no cambió; "mil" se SUMA,
nunca multiplica. La ronda 14 lo reportó con valores; los fixes de la 14 no lo
tocaron (ninguno de los dos commits toca `cifras.ts`).

**Escenario concreto (verificado con prueba temporal, igual que la ronda 14):**
`cardinalesEnPalabras('son dos mil pesos')` → `[1002]` (esperado 2000);
`('te sobran cinco mil del anticipo')` → `[1005]` (esperado 5000);
`('son tres mil doscientos pesos')` → `[1203]` (esperado 3200). En la guardia:
`cifrasSinRespaldo('te sobran cinco mil pesos del anticipo', [{ tope: 5000 }])`
→ `[1005]` — el modelo dijo la verdad, la tool la respaldó, y la guardia
reemplaza el texto porque el conversor leyó 1005.

**Estado: abierto** (2ª ronda; el fix de la ronda 13 sigue roto en el rango
2,000–999,999, el más frecuente del dominio).

### MEDIO 5 — (heredado, parcialmente atendido) El glue de la RFA 2.9 en `desde_db.ts` sigue SIN NINGUNA prueba

**Archivo/línea:** `src/lib/cuadra/cuadre/desde_db.ts:45-90` — la derivación de
`facilidad15` (56-58), el ancla del ejercicio (59-62), la resta de
`efectivoDeEsteViaje` (86-89) y el best-effort de `getAcumuladoCombustible`
(74-81). **Cero tests:** `desde_db.ts` no tiene archivo de prueba; los únicos
que lo tocan corren con datos vacíos (`processor_cadena.test.ts:153-176`
devuelve `[]` para `gasto`; los 5 archivos de analytics lo mockean). Una
mutación del ancla del año, de la resta del previo o del tri-estado de
`facilidad15` no rompería nada.

**Lo que SÍ se arregló de la ronda 14:** el año del ejercicio ya no es el del
reloj del proceso (antes `new Date().getFullYear()`, ahora ancla en
`viaje.fechaInicio` → `gasto.fecha` → reloj como último recurso). Ese fix es
correcto por lectura — pero sin red.

**Estado: abierto** (el defecto de reloj se cerró en código; la ausencia de
prueba persiste).

### MEDIO 6 — (ronda 14) El alta tri-estado: fix en código, sin prueba

**Archivo/línea:** `src/app/admin/flotas/page.tsx:37-38` —
`dedicacionExclusivaCarga: fd.get(...) === 'on' ? true : undefined` y
`src/lib/cuadra/administracion.ts:110-115` — solo se escribe la config cuando
AMBOS son booleanos. El fix es correcto por lectura: una flota creada sin
tocar los checkbox queda SIN declarar, y el motor la trata como tal
(`combustible_efectivo` → por_confirmar, "no se afirma nada"). Pero
`administracion.test.ts` no toca la config del alta: los 3 tests de
`crearFlota` cubren RFC inválido, RFC válido y nombre corto. El tri-estado
nuevo (sin marcar → sin config; ambos marcados → config con `true`; uno solo →
sin config) no tiene una sola aserción, y `actualizarFacilidad15` (repo.ts:928)
tampoco tiene ningún test (grep: cero referencias).

**Estado: abierto** (fix presente, red ausente).

### MEDIO 7 — (heredado, 2ª RONDA) El cierre de la ronda 13 sobre `venceArco` sigue hueco: el test pasa con 15 y con 20 días

**Archivo/línea:** `src/lib/cuadra/privacidad.test.ts:367-376` — el test
sigue titulado "suma 15 DÍAS HÁBILES (LFPDPPP art. 32)" y solo afirma
`expect([1,2,3,4,5]).toContain(d.getUTCDay())`. **Mutación verificada (2ª
vez):** revertir `DIAS_HABILES_ARCO = 20` (privacidad.ts:615) a 15 → **0
fallos** (40/40). Desde 1-ago-2026 (sábado), 20 días hábiles vencen el 28-ago;
15, el 21-ago — ambos viernes, el test no distingue. El commit `d7b171f`
(pantalla ARCO de cumplimiento) ni siquiera actualizó el título.

**Estado: abierto.**

### MEDIO 8 — (heredado, 2ª RONDA) La ventana de negación de `guardiaEstado` sigue siendo asimétrica: "No te preocupes, YA quedó cerrada" escapa

**Archivo/línea:** `src/lib/cuadra/cuadre/estado_afirmado.ts:148` — la ventana
`oracion.slice(Math.max(0, m.index - 25), m.index + 18)` sin cambios.
**Verificado con prueba temporal (2ª vez):**
`guardiaEstado('No te preocupes, ya quedó cerrada tu liquidación.', NO_CERRO)`
→ `forzado: false` — la mentira pasa intacta. El test de la ronda 13
(`estado_afirmado.test.ts:203`) solo cubre el "no" DESPUÉS del verbo
("…, no te preocupes" → se caza). La dirección es defendible (preferir dejar
pasar una mentira antes que tachar un mensaje correcto), pero la frontera de
25 caracteres sigue arbitraria y el caso "antes" sin documentar ni probar.

**Estado: abierto.**

### MEDIO 9 — (NUEVO) Contador caído → el motor imprime "contra un tope de $0.00" y cuenta el efectivo como PERDIDO, no como "por confirmar"

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:310-335` (la rama del 15%
con `total = 0`: `tope = 0.15 * 0 = 0` → `cupoRestante = 0` → `excedenteDeEste
= g.monto` → `efectivo_sobre_15` con nota "contra un tope de $0.00 (15% de
$0.00)") y `src/lib/cuadra/cuadre/desde_db.ts:74-81` (el best-effort que
promete otra cosa: "el motor recibe ceros y la **rama 'sin datos del
ejercicio'** marca el efectivo para revisar, que es el fail-cerrado honesto" —
**esa rama no existe**).

**Escenario concreto (verificado con prueba temporal):** `getAcumuladoCombustible`
falla (o no hay gastos con fecha en el ejercicio ancla) → `totalesEjercicio =
{0, 0}` → el motor recibe `totalCombustibleEjercicio: 0`, `efectivoPrevEjercicio:
0`, y el viaje trae diésel en efectivo $1,000 con CFDI → nota:
"Combustible pagado en EFECTIVO — el ejercicio lleva $1,000.00 de combustible
en efectivo contra un tope de $0.00 (15% de $0.00); el excedente de $1,000.00
de ESTE comprobante NO se deduce (RFA 2026 regla 2.9)". El estatus sí va a
`revisar` (por `efectivo_sobre_15` en `REVISAR`), pero la cubeta cuenta los
$1,000 como NO deducibles (`totalNoDeducible` 1000, `totalPorConfirmar` 0) y
el PDF archiva una afirmación fiscal fabricada: no hay un "tope de $0", hay
UNA LECTURA QUE FALLÓ o un año sin datos. El propio best-effort de la ronda 14
(desde_db.ts:75-79) dice que un fallo aquí "no puede tumbar la liquidación" —
pero sí la clasifica mal y miente en la nota. Antes del fix, el mismo caso
caía al `else` con la misma nota ("excede el tope del 15% ($1,000.00 vs
$0.00)"); el rewrite de `8a33ce1` lo reprodujo en vez de cerrarlo.

**Estado: abierto** (nuevo en la ronda 15; agrava el borde (b) del MEDIO 5 de
la ronda 14, que ya avisaba de este escenario con el año equivocado — el año
se arregló, la nota del tope $0 no).

### MEDIO 10 — (NUEVO) El commit de la ronda 14 dice "todos corregidos con prueba": al menos 8 de sus fixes no tienen ninguna, y dos mutaciones sobreviven

**Archivo/línea:** los 8 ítems del mensaje de `8a33ce1` + los 7 de `d7b171f`.
Verifiqué uno por uno:
- Con prueba: excedente por comprobante (`engine.test.ts:1460-1476`), estatus
  'revisar' (`1478-1492`), route-test de Stripe (`route.test.ts`, 98 líneas,
  bien hecho: 401/503/idempotencia/500).
- **Sin prueba** (grep + mutación): (a) "ejercicio desde los comprobantes" —
  `desde_db.ts` sin archivo de test; (b) "superficies con la elegibilidad" —
  `fiscal.test.ts` solo añade `elegible15: true` al fixture OPTS (línea 31),
  `causasDe` con `efectivo_no_elegible` no tiene NINGÚN test, `avisoTope15`
  con `elegible: false/undefined` (`aviso.ts:21-26`) no tiene NINGÚN test
  (`aviso.test.ts` pasa `true` a todas las llamadas); (c) "IVA del efectivo
  negado en el panel" — **mutación verificada: quitar la línea
  `if (g.formaPago === '01' && esCombustible(g, o)) return false;`
  (`fiscal.ts:512`) → 57/57 verdes**; (d) "alta tri-estado" — ver MEDIO 6;
  (e) "0083: el 'sí' rebota" — `migraciones_verificadas.test.ts` solo añade la
  entrada EXENTA con un comentario, no un test; (f) "una sola barrida" — el
  parámetro `claves` de `getAcumuladoCombustible` (`repo.ts:805`) no se
  asevera en ningún test (`repo_acumulado.test.ts` solo añadió `or()` al mock,
  sin afirmar el criterio).
- De `d7b171f`, sin prueba: `resolverTenantApi` 503 (`tenant-api.ts:61-65`;
  `session.test.ts` solo cubre el 403 y el éxito), export con desempate
  (`route.ts:69` — `export.test.ts` no toca el orden), `getPorFacturar`
  paginado (`pendientes.ts:120-131` — `pendientes.test.ts` solo cubre
  `armar`/`resumen`), el rechazo del PDF al chofer (`processor.ts:2136-2139`
  — cero referencias en tests), la validación de rol en el alta de usuario
  (`usuarios/nuevo/page.tsx:34-37` — sin test de página), y las funciones ARCO
  nuevas (`registrarSolicitudArco`, `listarSolicitudesArco`,
  `resolverSolicitudArco`, `actualizarFacilidad15` — **cero tests** en todo
  `src/`).

**Escenario concreto:** quitar la línea del IVA del efectivo (el fix que la
ronda 14 anunció como corregido "con prueba") → la suite de `fiscal.test.ts`
queda verde idéntica. Ese es el patrón: el commit se atribuye pruebas que no
existen, y el rubro pruebas no las pidió antes de dar el cierre.

**Estado: abierto** (nuevo en la ronda 15; es la deuda de la ronda 14).

### BAJO 1 — (heredado) La matriz del 15% depende del orden de `input.gastos`, y `getGastos` no trae `ORDER BY`

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:316-317`
(`previoSinEste`/`efectivoAcumuladoEjercicio` en orden de llegada) y
`src/lib/cuadra/repo.ts:556-561` (`getGastos` sin `.order()`). El rewrite de
la ronda 14 conservó la dependencia del orden (los comentarios del archivo
dicen que el reparto "no depende del ORDEN del arreglo" para el viático, pero
la frontera del 15% sí). Sin prueba de cruce multi-comprobante ni del borde
exacto.

**Estado: abierto** (sin cambios).

### BAJO 2 — (heredado, parcial) Los tests de la matriz ya afirman `estatus`, pero el fixture `g15` sigue no determinista y el caso "sin CFDI" declarado en el comentario sigue sin test

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.test.ts:1421` —
`cfdiUuid: 'u-' + Math.random()` (sin cambios); `1418-1420` — el comentario
sigue declarando "sin CFDI … la facilidad del 15% no aplica" sin ninguna
prueba que lo ejerza (por eso el ALTO 4 pasó otra vez).

**Estado: abierto** (la mitad del hallazgo —estatus— se cerró con `8a33ce1`;
la otra mitad sigue).

### BAJO 3 — (heredado) La rama `'—'` de `CifraGrande` sigue sin prueba

**Archivo/línea:** `src/app/dashboard/cifra-grande.tsx:60`; `cifra-grande.test.tsx`
sigue con 3 pruebas (opacity, valor servido, cero real) y ninguna para
`valor === undefined → '—'`. Mutar `'—'` por `'$0.00'` no rompería nada.

**Estado: abierto.**

### BAJO 4 — (heredado) `buscarTenantPorTelefono` sigue sin NINGUNA prueba

**Archivo/línea:** `src/lib/cuadra/conv.ts:644-655` — el `.limit(2)` +
`if (filas.length !== 1) return null` del fix ARCO de la ronda 13 sigue sin
ninguna referencia en tests (grep: cero). El fix es correcto por lectura, pero
"un teléfono en dos flotas ya no elige tenant arbitrario" no tiene red.

**Estado: abierto.**

### BAJO 5 — (heredado) `getLineasPorConciliar`: los fallos de las tres consultas secundarias siguen sin prueba

**Archivo/línea:** `src/lib/cuadra/analytics.ts:1002` (`cfdi_xml`), `1013`
(`gasto`), `1021` (`viaje`) — sin `respuestas.set(..., { error: ERROR_RED })`
en todo `analytics.test.ts`.

**Estado: abierto** (sin cambios).

### BAJO 6 — (heredado) La mutación de `tasaCuadre` (round→floor) sigue sobreviviendo

**Archivo/línea:** `src/lib/cuadra/analytics.ts:74`; el test
(`analytics_datos.test.ts:49-56`) usa 2 de 4 cuadradas y su comentario lo
admite. **Mutación verificada (2ª vez):** round→floor → 46/46 verdes.

**Estado: abierto.**

### BAJO 7 — (heredado) El fix `rolEfectivo` de `[id]/page.tsx` (ronda 13) sigue sin prueba de página

**Archivo/línea:** `src/app/dashboard/[id]/page.tsx:47` — el directorio solo
tiene `page.tsx` y `loading.tsx`; la función pura está cubierta en
`src/lib/auth/visibilidad.test.ts`, pero la decisión de qué se pinta/ejecuta
con el rol efectivo en esa página no.

**Estado: abierto.**

---

## Lo que revisé y está bien

- **ALTO 3 de la ronda 14 cerrado de verdad, con red.** El estatus de la
  liquidación ya no miente con dinero no deducible: `efectivo_sobre_15` y
  `efectivo_no_elegible` están en `REVISAR` (`engine.ts:1133`), y los 2 tests
  nuevos (`engine.test.ts:1478-1492`) afirman `revisar` para el excedente y
  para la flota no elegible. Verificado por lectura y ejecución.
- **El excedente por comprobante está bien resuelto y bien probado.** El
  rewrite de `engine.ts:310-335` reparte el tope por comprobante
  (`cupoRestante`, `dentro`, `excedenteDeEste`), la suma de la columna cuadra
  con `totalNoDeducible` (test `1460-1476` con 3×$1,000 → $1,500), y el caso
  "elegible + excede" conserva el reparto proporcional exacto (900/100). El
  borde `acumulado === tope` cae DENTRO de forma consistente con la versión
  anterior.
- **El año del ejercicio ya no lee el reloj del proceso.** `desde_db.ts:59-62`
  ancla en `viaje.fechaInicio` → primera `gasto.fecha` → reloj como último
  recurso. El fix de la ronda 14 (MEDIO 5) está aplicado; una liquidación de
  dic-2026 cerrada en enero-2027 ya cuenta contra 2026.
- **El cierre fiscal de la ronda 13 sigue clavado.** **Mutación de control:**
  quitar la línea `pendiente/no_encontrado` de `ivaSostenible` (`fiscal.ts`)
  → **2 tests mueren** (57 → 2 failed). Ese cierre tiene red de verdad.
- **El route-test de Stripe es una adición genuina.** `route.test.ts` (98
  líneas) cubre firma inválida→401, sin secreto→503, evento repetido→200 con
  `repetido:true`, y el 500 con desmarcado para el reintento. Es el único fix
  de `d7b171f` con prueba, y está bien hecho.
- **`getAcumuladoCombustible` sigue paginando contra el max_rows** con
  fail-closed (`repo.ts:803-865`): 4 tests (`repo_acumulado.test.ts`) cubren
  el recorte a 1,000, el tenant de una página, el max_rows menor a la página y
  los ceros legítimos. La unificación del criterio (`.or` con claves) es
  correcta por lectura — falta aseverarla (ver MEDIO 10f).
- **El seed del demo sigue sin disparar la matriz:** diésel `forma_pago '03'`,
  declaración `true`; `guion_demo.test.ts` (8) verde. La 0083 exige la FORMA de
  la llave (un `"sí"` rebota en el UPDATE), y la entrada EXENTA de
  `migraciones_verificadas.test.ts` razona bien.
- **Mis batches del rubro:** 30 archivos → 533 passed; 11 adicionales → 139
  passed; liquidación+normas+visibilidad+cifra-grande → 162 passed. Todo
  verde, estable. El árbol quedó limpio tras cada mutación (`git diff` vacío
  verificado) y mis archivos temporales fueron borrados; los archivos
  `zzz-*`/`aud15-*` que aparecieron durante la sesión son de otros auditores y
  no los toqué.

## Lo que no alcancé a revisar

- **La suite completa (~3,1xx)** — otros auditores corrían en paralelo (sus
  archivos temporales aparecieron y desaparecieron durante mi sesión). Todas
  mis mutaciones fueron sobre archivos propios con restauración verificada y
  el batch final corrió con el árbol limpio, pero no puedo jurar que ninguna
  corrida intermedia conviviera con una mutación ajena en OTRO archivo
  (ninguna de mis mediciones dependía de archivos fuera de los que yo mutaba).
- **No muté las superficies de la elegibilidad del panel** (`deducciones/`,
  `combustible/`, `cfdi/`): verifiqué por lectura que `opcionesDe` llega con
  `elegible15` a las 4 páginas del contador, pero no monté un render para
  confirmar el HTML de `efectivo_no_elegible` (rubro frontend).
- **No corrí `pruebas-manuales/*.prueba.ts`** (regla del proyecto: llamadas
  reales a portales/pago), ni verifiqué el render de la pantalla ARCO nueva
  (`admin/compliance`) ni de los selects tri-estado de `admin/flotas`.
- **No probé el flujo del webhook de Stripe contra un payload real** (solo
  leí el route-test, que está bien construido).
- **No re-verifiqué los cierres de otros rubros** (agentico/operabilidad de la
  ronda 13): los corrí y pasan, pero no muté sus fixes uno por uno (excepto
  fiscal, que sí muté, con control positivo).

---

## Veredicto

**Rojo — el rubro pruebas no da green light.**

Lo que sostiene el puntaje:
1. **Los dos fixes más públicos de la ronda 14 están bien hechos Y con
   prueba**: el estatus 'revisar' (ALTO 3 cerrado) y el excedente por
   comprobante. El cierre fiscal de la ronda 13 sigue clavado (control
   positivo por mutación). El route-test de Stripe es una adición real.
2. Mis ~800 pruebas objetivo están verdes y estables; el árbol quedó limpio.

Lo que lo impide — tres capas:
1. **El rubro pruebas no cierra sus propios hallazgos.** ALTO 1 (tenant, 4ª
   ronda) y ALTO 2 (ventana UTC, 3ª ronda) siguen sin moverse; la mutación de
   ambos sobrevive otra vez. ALTO 4 (facilidad sobre comprobante sin CFDI)
   sigue imprimiendo una contradicción en el caso más común del producto, con
   el comentario del fixture declarando el comportamiento que el código no
   implementa.
2. **El commit de la ronda 14 dice "todos corregidos con prueba" y es falso
   en al menos 8 de 15.** Lo demostré con dos mutaciones que sobreviven en el
   código de la propia ronda 14 (la línea del IVA del efectivo en el panel —
   57/57 verdes sin ella — y la nota "tope de $0.00" del contador caído, que
   el rewrite del 15% reprodujo en vez de cerrar). El patrón de la ronda 14
   se repite: los fixes que tocan la feature grande se anuncian probados y el
   rubro pruebas los acepta sin pedir la prueba.
3. **Las superficies nuevas (ARCO, alta tri-estado, `resolverTenantApi` 503,
   `getPorFacturar` paginado) llegaron sin una sola prueba**, y la mitad de
   los heredados (cardinales "N mil", venceArco, guardiaEstado, getDocumentos,
   passthrough) siguen donde estaban.

El demo de mañana sigue a salvo por los mismos tres accidentes del seed
(forma_pago '03', declaración true, tenant de sesión) — la seguridad que el
rubro pruebas existe para no depender de tener. **Nota 6/10**: no baja a 5
porque los dos ALTOS de la feature se cerraron con prueba real y verificada;
no sube a 7 porque la promesa del commit ("corregidos con prueba") no
sobrevive al contacto con el código y el rubro acumula su propia deuda sin
cobrarla.
