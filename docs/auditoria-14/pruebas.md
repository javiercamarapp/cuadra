# Pruebas — auditoría 14

Ancla: HEAD `0fa305e` (tras la ronda 13 + implementación del deber ser de la
RFA 2.9: `0d23f73`, `0fa305e`). Sesión sobre el árbol actual; cada mutación se
aplicó al working tree, se corrió contra el archivo mutado y se restauró con
`git diff` vacío confirmado al terminar. Ninguna mutación quedó en el árbol.

**Nota: 6/10** (ronda 13: **7/10**). Razón del movimiento: **deuda que cobró
factura.**

1. **Los dos ALTOS del rubro pruebas siguen abiertos, y esta vez los verifiqué
   por mutación otra vez.** ALTO 1 (la red de regresión del filtro de tenant):
   quitar el `.eq('tenant_id')` de `getLiquidacionDetalle` —el único límite del
   camino service_role— da **0 fallos** en los 49 tests de analytics (3ª ronda
   que lo reporta). ALTO 2 (`corteVentana` en UTC): la mutación M7 (ventana
   corrida un día) sigue sobreviviendo — el camino `gte('created_at', corte)`
   no corre en NINGUNA prueba (2ª ronda).
2. **La feature que se acaba de publicar (el deber ser de la RFA 2.9) llegó
   con dos bugs demostrables en el motor y el glue entero sin una sola
   prueba.** (a) `efectivo_no_elegible` y `efectivo_sobre_15` —los dos
   veredictos nuevos de "el efectivo NO se deduce"— no mueven el `estatus`:
   una liquidación con $1,000 no deducibles sale **'cuadrada'** (verificado con
   prueba temporal; la tasa de cuadre del panel la cuenta como limpia). (b) La
   rama del 15% no exige `cfdiUuid`, así que el motor afirma "deducible por la
   facilidad del 15%" sobre un ticket de diésel en efectivo SIN CFDI — la
   misma liquidación lo pone en `por_confirmar` (verificado: diferencias
   `[combustible_efectivo_dentro15, sin_cfdi, anticipo]`). El propio comentario
   del test nuevo (`engine.test.ts:1420-1423`) declara que "sin CFDI … la
   facilidad del 15% no aplica" — el código no implementa lo que el test
   documenta, y el test no lo cubre.
3. **Tres cierres de la ronda 13 tienen pruebas huecas o ausentes**:
   `venceArco` (el test pasa con 15 Y con 20 días — revertí la constante y
   quedó 40/40 verde, y el título sigue diciendo "15 DÍAS HÁBILES"),
   `buscarTenantPorTelefono` (cero tests), y la rama `'—'` de `CifraGrande`
   (sin test). Y el fix de cardinales (`8d6eff7`) trae un conversor roto para
   el rango que más se usa: "dos mil"→1002, "cinco mil"→1005, "tres mil
   doscientos"→1203 (verificado por prueba temporal: 4 fallos).

Baja de 7 porque la ronda 13 no atacó sus propios hallazgos y la ronda 14 —
que debía probar el deber ser de la RFA 2.9 — probó la matriz a medias y dejó
pasar dos mentiras de dinero en la feature recién publicada. El demo de mañana
no depende de ninguno (el seed usa `forma_pago '03'`, declara la facilidad
`true` y el `tenantId` del detalle sale de la sesión), pero el rubro pruebas
existe para que ninguna de esas tres cosas dependa del seed.

---

## Método

1. `npx vitest run` dirigido (44 archivos del rubro): **738 passed | 0 fallos**
   — cuadre completo, liquidación (pdf/acreditable/omitidos), fiscal, processor
   cadena/cierre, analytics (4 archivos), privacidad, migraciones,
   administracion, guion_demo, visibilidad, cifra-grande, por_diferencia.
   El batch cuadre+liquidacion+fiscal corrió 3 veces seguidas: 473/473 estable.
2. **Mutaciones sobre el árbol, restauradas con diff vacío** (5 mutaciones +
   controles): M1 (quitar `eq('tenant_id')` de `getLiquidacionDetalle`,
   analytics.ts:668) → 0 fallos; M2 (`litrosDiesel ?? 42`) → 0 fallos;
   M7 (ventana corrida un día, analytics.ts:42) → 0 fallos; quitar la línea
   `pendiente/no_encontrado` de `ivaSostenible` (fiscal.ts:491) → **2 fallos**
   (el cierre de la ronda 13 está bien clavado); revertir `DIAS_HABILES_ARCO`
   a 15 (privacidad.ts:615) → **0 fallos** (el test es hueco).
3. **Pruebas temporales creadas, corridas y borradas** (git status limpio al
   final, solo `docs/auditoria-14/` untracked): (a) `cardinalesEnPalabras`
   con "dos mil"/"cinco mil"/"tres mil doscientos" → 4 fallos; (b) estatus de
   la matriz 2.9 con anticipo == comprobado → 2 fallos (estatus 'cuadrada');
   (c) negación accesoria ANTES del verbo en `guardiaEstado` → 1 fallo;
   (d) efectivo sin CFDI con la facilidad → doble diferencia confirmada.
4. `npx tsc --noEmit -p .` y `npx eslint src/` no se re-corrieron completos en
   esta sesión (los corren los rubros arquitectura/backend); el build del
   release `caae369` ya estaba verde y no hay cambios de tipos sin compilar
   (el `Record<TipoDiferencia, RutaDeAviso>` de cierre_aviso compila, lo que
   demuestra que los 3 tipos nuevos están en el mapa).

## Estado del suite, al momento de anclar

- Mis 44 archivos objetivo: **738 passed | 0 fallos**, 3 corridas estables.
- El árbol quedó limpio tras cada mutación (`git diff` vacío verificado).
- Nota de convivencia: durante la sesión apareció y desapareció un archivo
  temporal de otro rubro (`src/lib/zzz-audit14-arq.test.ts`, luego `.bak`,
  luego nada) — otro auditor mutaba en paralelo. Todas mis mutaciones fueron
  sobre archivos propios con respaldo y restauración verificada; el batch
  final estable (738) se corrió con el árbol ya limpio.

---

## Hallazgos por severidad

### ALTO 1 — (heredado, 3ª ronda) La red de regresión del filtro de tenant sigue sin cerrarse: quitar el `eq` del detalle da 0 fallos

**Archivo/línea:** `src/lib/cuadra/analytics.ts:668` (`.eq('tenant_id', tenantId)`
de `getLiquidacionDetalle` — el único límite del camino service_role), 172
(`getLiquidacionesPorDia`), 512 (`getDocumentos`), 932 (`getConciliacionConsolidado`),
988 (`getLineasPorConciliar`). El commit de la ronda 12 (`c6a916b`) lo anunció
cerrado; la ronda 13 demostró que solo 2 de 6 lecturas tienen aserción; la
ronda 14 lo vuelve a confirmar: **el código no cambió en esta zona** (el único
diff de analytics.ts desde `caae369` es el `rfc` de `getOperadoresDetalle`).

**Escenario concreto (mutación M1 verificada):** quitar el `.eq('tenant_id', tenantId)`
de `getLiquidacionDetalle` → la consulta queda solo con `.eq('id', id)` sobre
`supabaseAdmin` (service_role: la RLS de la 0078 no lo protege) → **0 fallos**
en los 34 tests de `analytics.test.ts` + 12 de `analytics_datos.test.ts` + 3 de
`analytics_por_dia.test.ts`. Los tests siembran todas las filas del tenant `t-1`
y nunca afirman que el filtro se aplicó. El `tenantId` hoy sale de la sesión,
así que no es un IDOR explotable — es una red ausente sobre el único límite que
le queda al camino, tres rondas seguidas sin moverse.

**Estado: abierto** (sin cambios desde la ronda 13).

### ALTO 2 — (heredado, 2ª ronda) `corteVentana` sigue en UTC: "últimos 7 días" no son 7 días locales, y la mutación M7 sobrevive

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42` — el default del parámetro
`hoy` sigue siendo `new Date().toISOString().slice(0, 10)` (fecha UTC), mientras
su hermana `getLiquidacionesPorDia` (166-167) usa
`toLocaleDateString('en-CA', { timeZone: TZ_MX })` — el arreglo de la ronda 12
(`3f73a7b`) se aplicó a UNA de las dos ventanas del archivo. El corte se aplica
en `getKpis` (57) y `getAcreditables` (215), y la vista por defecto del panel es
7 días (`resolverRango(sp?.rango, '7')`).

**Escenario concreto (aritmética real, la misma de la ronda 13):** el 1-ago-2026
a las 20:00 CDMX (= 02:00Z del 2-ago), `hoy` por defecto es `'2026-08-02'`.
`corteVentana(7)` produce `'2026-07-27T00:00:00Z'` = 26-jul 18:00 local. Una
liquidación cerrada el 26-jul a las 10:00 local (16:00Z) queda FUERA del
"últimos 7 días". **Mutación M7 verificada:** `-(ventanaDias - 1)` →
`-ventanaDias` → 0 fallos; el `gte('created_at', corte)` no corre en ninguna
prueba (todas llaman `getKpis('t-1')` / `getAcreditables('t-1')` sin ventana).

**Estado: abierto.**

### ALTO 3 — (NUEVO) `efectivo_no_elegible` y `efectivo_sobre_15` no mueven el `estatus`: la liquidación sale "cuadrada" con dinero no deducible

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:97-98` (los tipos nuevos en
`NO_DEDUCIBLE_ISR`/`POR_CONFIRMAR`) vs `1126-1129` (la computación del estatus).
`efectivo_no_elegible` está en `NO_DEDUCIBLE_ISR` pero NO en `REVISAR` (1126);
`efectivo_sobre_15` no está ni en `NO_DEDUCIBLE_ISR` ni en `REVISAR` (se maneja
por `proporcionDeducible`). `hayDif` (1128) solo mira `sobre_politica`,
`duplicado`, `diesel_desviacion` y la diferencia de anticipo. Todo el resto de
veredictos no deducibles del archivo (`rfc_receptor`, `cfdi_cancelado`,
`efectivo_sobre_tope` — la MISMA familia 27-III) están en `REVISAR` → 'revisar'.

**Escenario concreto (verificado con prueba temporal):** anticipo $1,000, un
diésel en efectivo con CFDI por $1,000, `facilidad15: false` →
`totalNoDeducible` 1000, diferencia de anticipo 0, **`estatus: 'cuadrada'`**.
Y con `facilidad15: true`, ejercicio $10,000, previo $1,400 (cruza el tope
$1,500): `totalNoDeducible` 900, `totalDeducible` 100, **`estatus: 'cuadrada'`**.
La tasa de cuadre del panel (`getKpis`, analytics.ts:74) cuenta esa liquidación
como "cuadrada"; la lista la pinta verde; el PDF dice "$900/$1,000 no
deducibles". El aviso al jefe SÍ se dispara (cierre_aviso.ts:282 filtra por
`RUTA_DE_DIFERENCIA` — 'decision' — no por estatus), así que el hallazgo es del
rótulo, no del aviso: el estatus miente, y es el dato que alimenta el KPI más
público. Los 5 tests nuevos de la matriz (`engine.test.ts:1425-1488`) afirman
cubetas y notas, nunca `estatus` — por eso pasó.

**Estado: abierto** (nuevo en la ronda 14).

### ALTO 4 — (NUEVO) El motor afirma "deducible por la facilidad del 15%" sobre un comprobante SIN CFDI — contradicción en el mismo documento

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:299` — la rama
`if (g.formaPago === '01' && esCombustible)` no exige `g.cfdiUuid`, así que un
ticket de diésel en efectivo sin factura entra a la matriz y recibe la nota
"deducible por la facilidad del 15%" (311-319) o "el excedente NO se deduce"
(324-330). El comentario del propio test nuevo lo contradice textualmente
(`engine.test.ts:1420-1423`): "sin CFDI, el gasto cae a por_confirmar por la
regla del ticket, y la facilidad del 15% no aplica (no hay comprobante que
ampare)" — pero el fixture `g15` SIEMPRE trae `cfdiUuid`, así que la suposición
declarada jamás se ejercita.

**Escenario concreto (verificado con prueba temporal):** diésel en efectivo
$1,000, SIN `cfdiUuid`, `facilidad15: true`, ejercicio $10,000, previo 0 → el
resultado trae las diferencias `[combustible_efectivo_dentro15, sin_cfdi,
anticipo]` con `totalPorConfirmar` 1000 y `totalDeducible` 0. El mismo
comprobante recibe "deducible por la facilidad del 15% (RFA 2026 regla 2.9): el
ejercicio lleva $1,000.00 de $10,000.00 … (10% del total, tope 15%)" Y "requiere
factura CFDI y no trae UUID válido", y la cubeta lo manda a `por_confirmar`.
Es el caso MÁS común del producto (diésel en efectivo con ticket, antes de
facturar) — el papel que se archiva se contradice sobre el mismo renglón.

**Estado: abierto** (nuevo en la ronda 14).

### MEDIO 1 — (heredado) Los campos passthrough del detalle siguen sin aserción, y el `rfc` nuevo de `getOperadoresDetalle` tampoco tiene

**Archivo/línea:** `src/lib/cuadra/analytics.ts:694-702` (`totalAnticipo`,
`diferencia`, `ieps`, `litrosDiesel`, `iva`, `peaje`, `pdfPath`) y `621` (el
`rfc` que la ronda 13 añadió a `getOperadoresDetalle`). **Mutación M2
verificada:** `litrosDiesel: Number(... ?? 42)` → 0 fallos. El detalle que abre
el demo podría enseñar 42 litros y nadie lo vería. El `rfc` nuevo se suma al
passthrough sin ninguna aserción (`analytics_datos.test.ts:191-200` afirma solo
`operadorId`).

**Estado: abierto** (igual que en la ronda 13; empeoró con el passthrough nuevo).

### MEDIO 2 — (heredado) El "test" de `getDocumentos` sigue siendo hueco

**Archivo/línea:** `src/lib/cuadra/analytics_datos.test.ts:206-210` — siembra
`TABLAS.liquidacion` mientras `getDocumentos` lee `gasto` (analytics.ts:510); la
aserción es `expect(Array.isArray(r)).toBe(true)`. La función ni recibe filas:
con `gasto` vacío devuelve `[]` y el test pasa igual. Sigue contando en el total
y sumando cobertura sin verificar NADA del mapeo ni del filtro de tenant.

**Estado: abierto** (sin cambios).

### MEDIO 3 — (heredado) La ventana 7d/30d sigue sin prueba — el bug del ALTO 2 pasó por esto

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42-47` y las ramas
`corte ? q.gte(...) : q` de 57 y 215. Ninguna prueba llama
`getKpis(tenantId, 7)` ni `getAcreditables(tenantId, 7)`. La prueba de ventana
que sí existe cubre solo la gráfica (`getLiquidacionesPorDia`), no el corte de
los KPI.

**Estado: abierto.**

### MEDIO 4 — (NUEVO) `cardinalesEnPalabras` rompe el multiplicador "mil": "dos mil" → 1002, "cinco mil" → 1005

**Archivo/línea:** `src/lib/cuadra/cuadre/cifras.ts:222-228` (la composición
`suma = vj > suma || v >= 1000 ? suma + vj : ...` — "mil" se SUMA, nunca
multiplica). El fix de la ronda 13 (`8d6eff7`) introdujo la función; sus tests
(`cifras.test.ts:185-195`) cubren solo los dos casos que funcionan ("treinta y
dos" → 32, "mil ochocientos" → 1800).

**Escenario concreto (verificado con prueba temporal, 4 fallos):**
`cardinalesEnPalabras('son dos mil pesos')` → `[1002]` (esperado 2000);
`('te sobran cinco mil del anticipo')` → `[1005]` (esperado 5000);
`('son tres mil doscientos pesos')` → `[1203]` (esperado 3200). En la guardia:
`cifrasSinRespaldo('te sobran cinco mil pesos del anticipo', [{ tope: 5000 }])`
→ `[1005]` — el modelo dijo la verdad, la tool la respaldó, y la guardia
reemplaza el texto porque el conversor leyó 1005. El comentario del propio
código ("es mejor verificar de más: un compuesto mal sumado cae a 'fuera'")
declara la dirección del error, pero "N mil" no es un compuesto ambiguo: es la
forma canónica de 2,000 a 999,999, el rango de montos más frecuente del dominio.

**Estado: abierto** (nuevo en la ronda 14; defecto del fix de la ronda 13).

### MEDIO 5 — (NUEVO) El glue de la RFA 2.9 en `desde_db.ts` no tiene NINGUNA prueba y lee el reloj

**Archivo/línea:** `src/lib/cuadra/cuadre/desde_db.ts:45-90` — la derivación de
`facilidad15` (56), la agregación del ejercicio (58-73), `efectivoDeEsteViaje` y
`efectivoPrevEjercicio` (86-89). Cero tests: `desde_db.ts` no tiene archivo de
prueba, y los únicos que lo tocan lo corren con datos vacíos
(`processor_cadena.test.ts:153-176` devuelve `[]` para `gasto`; los 5 archivos
de analytics lo mockean). Una mutación de la resta del previo, del cálculo de
`facilidad15` o del `.or(...)` no rompería nada.

**Además, dos bordes concretos sin red:** (a) `anioEjercicio =
String(new Date().getFullYear())` (59) — el bloque lee el reloj del SERVIDOR
(UTC), violando la doctrina del propio archivo ("El motor es puro y no lee el
reloj: la fecha se le inyecta aquí, que es el borde con el mundo",
desde_db.ts:116-119). Un viaje de dic-2026 liquidado el 1-ene-2027 cuenta su
combustible contra el ejercicio 2027: el query `gte('fecha', '2027-01-01')`
excluye los gastos de dic-2026, `total` puede quedar en 0 y el efectivo de ese
viaje cae a "excede el tope del 15% ($1,000.00 vs $0.00)" — la nota del
`efectivo_sobre_15` comparando contra cero. (b) el `.or(...)` con
`clavesCombustible` vacío produciría `clave_prod_serv.in.()` — en la práctica
DEMO_CONFIG y la validación 0082 impiden claves vacías, pero la consulta exacta
no está probada.

**Estado: abierto** (nuevo en la ronda 14).

### MEDIO 6 — (NUEVO) El alta de flota convierte "no declarado" en "declaró que NO", y `crearFlota` con los campos nuevos no tiene prueba

**Archivo/línea:** `src/app/admin/flotas/page.tsx:37-38` —
`dedicacionExclusivaCarga: fd.get(...) === 'on'` — el checkbox desmarcado manda
`false`, siempre; `src/lib/cuadra/administracion.ts:110-115` — como la página
siempre manda los dos booleanos, `facilidad15` se escribe SIEMPRE en la config.
El tercer estado del motor —`undefined` = "no declarada" → `combustible_efectivo`
→ por_confirmar, "no se afirma nada" (engine.ts:333-340)— es **inalcanzable
desde la UI**.

**Escenario concreto:** un administrador crea una flota sin tocar los dos
checkbox (lo normal: son nuevos, no los conoce). `tenant.config` queda con
`{dedicacionExclusivaCarga: false, regimenElegible: false}` → el motor resuelve
`facilidad15 = false` → el diésel en efectivo de esa flota sale
`efectivo_no_elegible` con la nota "la flota declaró que NO califica" — una
afirmación que nadie hizo — y con el estatus 'cuadrada' del ALTO 3. `crearFlota`
con los campos nuevos no tiene ninguna prueba (`administracion.test.ts` no toca
la config del alta).

**Estado: abierto** (nuevo en la ronda 14).

### MEDIO 7 — (NUEVO) El cierre de la ronda 13 sobre `venceArco` es hueco: el test pasa con 15 y con 20 días

**Archivo/línea:** `src/lib/cuadra/privacidad.test.ts:367-376` — el test
"venceArco suma 15 DÍAS HÁBILES" (título que la ronda 13 no actualizó) solo
afirma `expect([1,2,3,4,5]).toContain(d.getUTCDay())`: que el resultado caiga
en día entre semana. **Mutación verificada:** revertir
`DIAS_HABILES_ARCO = 20` (privacidad.ts:615) a 15 → **0 fallos** (40/40).
Valores concretos: desde 1-ago-2026 (sábado), 20 días hábiles vencen el
28-ago; 15, el 21-ago — ambos viernes, el test no distingue. El fix de la ronda
13 (`94a3521`) cambió la constante y dejó el test con la aserción que no puede
verlo.

**Estado: abierto** (nuevo en la ronda 14).

### MEDIO 8 — (NUEVO) La ventana de negación de `guardiaEstado` es asimétrica: "No te preocupes, YA quedó cerrada" escapa

**Archivo/línea:** `src/lib/cuadra/cuadre/estado_afirmado.ts:148` — la ventana
`oracion.slice(Math.max(0, m.index - 25), m.index + 18)` se extiende 25
caracteres ANTES del match, así que un "no" accesorio anterior al verbo también
salta la oración. **Verificado con prueba temporal:** `guardiaEstado('No te
preocupes, ya quedó cerrada tu liquidación.', NO_CERRO)` → `forzado: false` —
la mentira pasa intacta; el test nuevo de la ronda 13 (`estado_afirmado.test.ts`)
solo cubre el "no" DESPUÉS del verbo ("…, no te preocupes" → se caza). La
doctrina del archivo prefiere dejar pasar una mentira antes que tachar un
mensaje correcto, así que la dirección es defendible — pero la frontera de 25
caracteres es arbitraria y el caso "antes" no está ni documentado ni probado.

**Estado: abierto** (nuevo en la ronda 14; parcial del fix de la ronda 13).

### BAJO 1 — (NUEVO) La matriz del 15% depende del orden de `input.gastos`, y `getGastos` no trae `ORDER BY`

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:307` (`efectivoAcumuladoEjercicio
+= g.monto` en orden de llegada) y `src/lib/cuadra/repo.ts:555-560` (`getGastos`
sin `order`). La atribución de CUÁL comprobante cruza la frontera del 15% —y por
tanto cuál recibe la nota "el excedente de $X NO se deduce"— depende del orden
que PostgREST decida (insertion, sin garantía). Los totales no cambian; el
comprobante señalado en el PDF puede ser el equivocado. Sin prueba de cruce
multi-comprobante ni del borde exacto `acumulado === tope` (que cae DENTRO por
`<=`, línea 310) ni de `total === 0`.

**Estado: abierto** (nuevo en la ronda 14).

### BAJO 2 — (NUEVO) Los 5 tests de la matriz 2.9 no afirman `estatus` — por eso el ALTO 3 pasó

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.test.ts:1425-1488`. Las
pruebas afirman cubetas, montos y notas (bien hechas: la del "dentro" exige
`$1,500.00 de $10,000.00` y `15%` en la nota) pero ninguna toca `r.estatus` ni
el caso "sin `cfdiUuid`" que su propio comentario declara (ver ALTO 4). El
fixture `g15` (1421-1423) usa `Math.random()` para el id — no determinista.

**Estado: abierto.**

### BAJO 3 — (NUEVO) La rama `'—'` de `CifraGrande` (fix de la ronda 13) no tiene prueba

**Archivo/línea:** `src/app/dashboard/cifra-grande.tsx:60`; el test
(`cifra-grande.test.tsx`, 3 pruebas) cubre opacity, valor servido y cero real —
nada de `valor === undefined → '—'`. Mutar `'—'` por `'$0.00'` no rompería
ninguna prueba. El fix funciona en el call site (`page.tsx` manda `undefined`
con la consulta caída, verificado por lectura), pero la garantía no está
clavada.

**Estado: abierto.**

### BAJO 4 — (NUEVO) `buscarTenantPorTelefono` (fix ARCO de la ronda 13) no tiene NINGUNA prueba

**Archivo/línea:** `src/lib/cuadra/conv.ts:644-655` — el `.limit(2)` +
`if (filas.length !== 1) return null` (574137c) no aparece en ningún test
(grep: cero referencias). El fix es correcto por lectura (con dos flotas niega
la identidad y el caller pide identificar la flota), pero la garantía de que
"un teléfono en dos flotas ya no elige tenant arbitrario" no tiene red.

**Estado: abierto.**

### BAJO 5 — (heredado) `getLineasPorConciliar`: los fallos de las tres consultas secundarias siguen sin prueba

**Archivo/línea:** `src/lib/cuadra/analytics.ts:1002` (`cfdi_xml`), `1013`
(`gasto`), `1021` (`viaje`) — sin `respuestas.set(..., { error: ERROR_RED })`
en todo `analytics.test.ts`. **Estado: abierto** (sin cambios).

### BAJO 6 — (heredado) La mutación de `tasaCuadre` (round→floor) sigue sobreviviendo

**Archivo/línea:** `src/lib/cuadra/analytics.ts:74`; el test
`analytics_datos.test.ts:49-56` usa 2 de 4 cuadradas (floor y round dan lo
mismo) y su comentario lo admite. **Estado: abierto** (sin cambios).

### BAJO 7 — (NUEVO) El fix `rolEfectivo` de `[id]/page.tsx` (ronda 13) no tiene prueba de página

**Archivo/línea:** `src/app/dashboard/[id]/page.tsx:47` — no existe test para el
archivo (el directorio solo tiene `page.tsx` y `loading.tsx`); la función pura
`rolEfectivo` está cubierta en `visibilidad.test.ts`, pero la decisión de
"qué se pinta y qué se ejecuta con el rol efectivo" en esa página no. Una
regresión que vuelva a gatear con el rol real no rompería nada.

**Estado: abierto.**

---

## Lo que revisé y está bien

- **El ALTO fiscal de la ronda 13 (panel acreditaba IVA de CFDIs sin confirmar)
  está cerrado de verdad, con red.** `ivaSostenible` (fiscal.ts:491) rechaza
  `pendiente`/`no_encontrado`; los 3 tests nuevos (`fiscal.test.ts:490-508`)
  afirman IVA 0 + `porValidar > 0` para pendiente, IVA 0 para no_encontrado y
  137.93 para vigente. **Mutación verificada:** quitar la línea → 2 tests
  mueren. Ejemplar.
- **La matriz del 15% del motor está bien probada en lo que cubre**: los 5
  tests (`engine.test.ts:1419-1488`) distinguen los 4 cuadrantes
  (dentro/excede/no elegible/sin declarar) con aserciones de cubeta y de nota;
  el "dentro" exige el contador con valores (`$1,500.00 de $10,000.00`, `15%`);
  el "excede" exige el reparto proporcional exacto (900 no deducible / 100
  deducible); el "sin declarar" exige `por_confirmar` y la nota que no promete.
  El mecanismo de `proporcionDeducible` (compartido con el tope de
  alimentación) reparte sin negativos.
- **La cadena entera sigue corriendo real con el mock nuevo**:
  `processor_cadena.test.ts:153-176` — el builder genérico incluye los métodos
  del query nuevo (`gte`, `lte`, `or`, `range`) y la cadena completa
  (processor → tools → desde_db → engine → pdf-lib → storage → Graph API) corre
  14 + 22 tests verdes; el query del ejercicio pasa por `traerTodo` con su
  paginación.
- **`getLiquidacionesPorDia` conserva el fix TZ_MX y sus 3 pruebas**
  (`analytics_por_dia.test.ts`): corrimiento de tarde (20:00 CDMX → barra del
  31-jul), mediodía sin corrimiento y ventana completa con ceros.
- **`por_diferencia.test.ts` se actualizó bien**: el regex `[a-z_0-9]+` captura
  los tipos nuevos con dígitos (`dentro15`, `sobre_15`) y el test de cobertura
  exige norma o `SIN_NORMA` para cada tipo; `NORMA_POR_DIFERENCIA` y
  `RUTA_DE_DIFERENCIA` (exhaustiva por tipo, `Record<TipoDiferencia, …>` que
  compila) tienen los 3 tipos nuevos.
- **El seed del demo NO dispara la matriz**: el diésel del demo es
  `forma_pago '03'` (electrónico), así que la diferencia única del viaje sigue
  siendo la `sobre_politica` de $200 que el guion promete; el seed declara
  `facilidadCombustibleEfectivo: { true, true }` y la migración 0082 añade la
  llave a la validación sin romper el bloque 0026. `guion_demo.test.ts` (8)
  sigue verde.
- **`migraciones_verificadas.test.ts`**: la entrada EXENTA de la 0082 razona
  bien (si falta la migración, el alta con declaración revienta ruidoso con el
  error de la 0026) y el bloque 56 (POD del chofer, mig. 0081) está en
  `verificaciones.sql`.
- **`seed.sh`**: el cambio a "solo datos si el esquema ya está" es correcto
  contra base migrada (el chequeo por `information_schema` es el camino
  honesto; aplicar migraciones ya aplicadas reventaba).
- **Estado final del árbol**: 738/738 en mis 44 archivos objetivo, 3 corridas
  consecutivas estables; `git status` limpio al terminar (solo
  `docs/auditoria-14/` untracked).

## Lo que no alcancé a revisar

- **La suite completa (~3,1xx)** — otro auditor la corría en paralelo; no quise
  pisar. Vi su archivo temporal (`zzz-audit14-arq.test.ts`) aparecer y
  desaparecer durante la sesión. Todas mis mutaciones fueron sobre archivos
  propios con respaldo/restauración verificada, y el batch final (738) corrió
  con el árbol limpio — pero no puedo jurar que ninguna corrida intermedia
  conviviera con una mutación ajena en OTRO archivo (ninguna de mis mediciones
  dependía de archivos fuera de los que yo mutaba y restauraba).
- **No muté los tests nuevos de los otros rubros** (agentico/legal/operabilidad
  de la ronda 13): los corrí y pasan, pero no verifiqué uno por uno que mueran
  si su fix se revierte (excepto fiscal, que sí muté).
- **No corrí `pruebas-manuales/*.prueba.ts`** (regla del proyecto: llamadas
  reales a portales/pago) ni verifiqué el render en navegador del checkbox de
  alta ni de la liquidación con los tipos nuevos (rubro frontend).
- **No re-muté el mock plano de `analytics.test.ts`** para confirmar que las
  mutaciones de MONTO dentro de la reconstrucción del detalle siguen
  sobreviviendo (la ronda 13 lo dejó pendiente y esta ronda no lo retomó).

---

## Veredicto

**Rojo — el rubro pruebas no da green light.**

Lo que sostiene el puntaje:
1. **El cierre fiscal de la ronda 13 está clavado y lo demostré por mutación**
   (2 tests mueren). La matriz del motor en lo que cubre está bien hecha, la
   cadena entera corre con datos y el seed del demo no toca la matriz.
2. Los 738 tests objetivo están verdes y estables; el árbol quedó limpio.

Lo que impide el green light — tres capas:
1. **Los dos ALTOS propios del rubro pruebas llevan sin cerrarse desde la
   ronda 12/13** (tenant 3ª ronda, ventana UTC 2ª ronda). El rubro pruebas no
   cierra sus propios hallazgos: reporta, no verifica.
2. **La feature recién publicada (RFA 2.9 deber ser) trae dos mentiras de
   dinero demostrables en el motor** — el estatus 'cuadrada' con dinero no
   deducible (ALTO 3) y la afirmación de deducibilidad sobre comprobantes sin
   CFDI (ALTO 4) — y su glue (`desde_db.ts`) no tiene una sola prueba (MEDIO
   5). Los 5 tests de la matriz no afirman ni `estatus` ni la condición de
   CFDI que su propio comentario declara.
3. **Tres cierres de la ronda 13 de otros rubros tienen la red hueca o
   ausente** (venceArco, buscarTenantPorTelefono, CifraGrande '—') y el fix de
   cardinales trae el conversor de "N mil" roto (MEDIO 4).

El demo de mañana está a salvo por tres accidentes del seed (forma_pago '03',
declaración true, tenant de sesión) — exactamente el tipo de seguridad que el
rubro pruebas existe para no depender de tener. **Nota 6/10**: baja de 7 porque
la deuda de las rondas 12-13 cobró factura en la feature nueva, y los hallazgos
nuevos (2 ALTOS) pesan más que los cierres verificados.
