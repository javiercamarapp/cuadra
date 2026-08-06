# Pruebas — auditoría 16

Ancla: HEAD `c901226` (ronda 16: ARCO de la flota en /dashboard + entrega de la
respuesta por WhatsApp). Sesión sobre el árbol actual; se verificaron los
cierres de la ronda 15 (`96f2adc`: fail-closed real del contador del 15%,
3 pruebas nuevas) y la superficie nueva de la ronda 16. Cada mutación se
aplicó al working tree, se corrió contra el archivo mutado y se restauró con
`git diff` vacío verificado al terminar. Ninguna mutación quedó en el árbol.

**Nota: 6/10** (ronda 15: **6/10**). Razón del movimiento: **se atacó y subió
un punto, pero la factura la cobró la misma ronda** — por primera vez un
hallazgo PROPIO del rubro se cerró con red real verificada por mutación
(MEDIO 9, el contador caído: quitar la guardia mata 3 tests). Eso es
progreso genuino. Pero el mismo fix que cerró el MEDIO 9 introdujo una
regresión que sus 3 tests no ven: el `continue` de `engine.ts:324` se salta
TODAS las reglas posteriores del gasto (política, monto discrepante, CFDI
cancelado, RFC de tercero, complemento…) cuando el contador está caído — lo
demostré con prueba propia y la confirmó en paralelo la sonda de otro auditor
(`zzz-a16-probe2.test.ts`). Y la ronda 16 desplegó una feature completa
(resolver + envío WhatsApp con plantilla) con **cero pruebas**: ni
`resolverSolicitudArco`, ni `enviarRespuestaArco`, ni la página, ni la ruta
tienen una sola aserción, mientras el commit proclama "3,159 verdes". Los tres
ALTOS propios del rubro (tenant 5ª ronda, ventana UTC 4ª ronda, facilidad sin
CFDI 3ª ronda) siguen sin red, con las mutaciones sobreviviendo otra vez.
6 se queda: el cierre con red es real, la regresión y la superficie sin red
también.

---

## Método

1. **Verificación de los cierres de la ronda 15 por lectura + mutación:**
   - MEDIO 9 (contador caído → "tope de $0.00"): el fix está
     (`engine.ts:312-325`, rama fail-closed con nota honesta) y tiene 3 tests
     (`engine.test.ts:1527-1560`). **Mutación verificada:** `if (false && …)`
     sobre la guardia `!(total > 0)` → **3 tests mueren** (117 → 3 failed).
     **Cerrado de verdad.** ⚠️ Pero el fix trae una regresión (ver ALTO 5).
   - ALTO 3 (ronda 14, estatus 'revisar'): sigue cerrado; los 2 tests de la
     matriz afirman `revisar` (`engine.test.ts:1494-1505`), 117 verdes.
   - Los demás cierres anunciados por `96f2adc` (panel 'sin declarar',
     tools.ts/desde_db.ts mismo año, `actualizarFacilidad15` con error de
     lectura) se verificaron por lectura: presentes en el árbol.
2. **Mutaciones sobre el árbol, restauradas con `git diff` vacío verificado**
   (6 mutaciones): M1 (quitar `.eq('tenant_id')` de `getLiquidacionDetalle`,
   analytics.ts:671) → **0 fallos en 49 tests** (5ª ronda); M7 (ventana
   corrida un día, analytics.ts:42) → **0 fallos en 67 tests** (4ª ronda);
   `litrosDiesel ?? 42` (analytics.ts:703) → **0 fallos en 49 tests** (4ª
   ronda); `tasaCuadre` round→floor → **0 fallos en 46 tests** (3ª ronda);
   `DIAS_HABILES_ARCO` 20→15 → **0 fallos en 40 tests** (3ª ronda); quitar la
   línea del IVA del efectivo en `ivaSostenible` (fiscal.ts:514) → **57/57
   verdes** (2ª ronda). Control positivo: mutar la guardia fail-closed del
   MEDIO 9 → **3 tests mueren** (ese cierre sí tiene red).
3. **Pruebas temporales creadas, corridas y borradas** (mis archivos
   `zzz-aud16-*.test.ts` y `zzz-a16-propio.test.ts` eliminados; `git diff`
   vacío verificado): (a) ALTO 4 — diésel en efectivo sin `cfdiUuid` con
   `facilidad15: true` → el motor emite `combustible_efectivo_dentro15` con
   nota "deducible por la facilidad del 15%" mientras `cubetaDe` lo manda a
   `por_confirmar` (`totalPorConfirmar` 1000, `totalDeducible` 0); (b) MEDIO 4
   — "dos mil"→1002, "cinco mil"→1005, "tres mil doscientos"→1203;
   (c) **REGRESIÓN** — contador caído + diésel $9,000 con tope de política
   $4,000 → diferencias `['combustible_efectivo', 'anticipo']`:
   `sobre_politica` se PIERDE; control con contador sano → `sobre_politica` y
   `monto_discrepante` presentes.
4. **Estado del suite:** batch del rubro — 34 archivos: **547 passed, 2
   failed** (los 2 fallos son de la sonda de otro auditor,
   `zzz-a16-probe2.test.ts`, que documenta la misma regresión del punto 3c);
   sin mis mutaciones: engine 117, analytics 49, privacidad 40, fiscal 57,
   meta+auth 211 — todo verde. No corrí la suite completa (3,1xx): otros
   auditores corrían en paralelo (aparecieron `zzz-a16-probe.test.ts` y
   `zzz-a16-probe2.test.ts` durante mi sesión — ninguno es mío, ninguno lo
   toqué).
5. **Superficie nueva de la ronda 16 (grep exhaustivo):** `resolverSolicitudArco`,
   `listarSolicitudesArco`, `enviarRespuestaArco` y `/dashboard/arco` tienen
   **cero referencias en tests** en todo `src/`. El commit `c901226` no toca
   ningún archivo `*.test.*` (solo 5 archivos de código + docs).

## Hallazgos por severidad

### ALTO 1 — (heredado, 5ª RONDA) La red de regresión del filtro de tenant sigue sin cerrarse: quitar el `eq` del detalle da 0 fallos

**Archivo/línea:** `src/lib/cuadra/analytics.ts:671` — `.eq('tenant_id', tenantId)`
de `getLiquidacionDetalle`, el único límite del camino service_role. Sin
cambios desde la ronda 13.

**Escenario concreto (mutación M1 verificada, 5ª vez):** quitar el `eq` → la
consulta queda solo con `.eq('id', id)` sobre `supabaseAdmin` → **0 fallos**
en 49 tests (analytics + analytics_datos + analytics_por_dia). Los tests
siembran filas del tenant `t-1` y nunca afirman que el filtro se aplicó.

**Estado: abierto** (sin cambios desde la ronda 13).

### ALTO 2 — (heredado, 4ª RONDA) `corteVentana` sigue en UTC: "últimos 7 días" no son 7 días locales, y la mutación M7 sobrevive

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42` — el default del parámetro
`hoy` sigue siendo `new Date().toISOString().slice(0, 10)` (UTC), mientras su
hermana `getLiquidacionesPorDia` usa `toLocaleDateString('en-CA', { timeZone:
TZ_MX })`.

**Escenario concreto (aritmética real, 4ª ronda):** el 1-ago-2026 a las 20:00
CDMX (= 02:00Z del 2-ago), `hoy` por defecto es `'2026-08-02'`.
`corteVentana(7)` produce `'2026-07-27T00:00:00Z'` = 26-jul 18:00 local. Una
liquidación cerrada el 26-jul a las 10:00 local queda FUERA del "últimos 7
días". **Mutación M7 verificada (4ª vez):** `-(ventanaDias - 1)` →
`-ventanaDias` → 0 fallos en 67 tests.

**Estado: abierto.**

### ALTO 3 — (ronda 14) Estatus 'revisar' con dinero no deducible: CERRADO, con red

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:1155` — `efectivo_sobre_15`
y `efectivo_no_elegible` en `REVISAR`; tests en `engine.test.ts:1494-1505`.
Verificado por lectura y ejecución (117 verdes).

**Estado: cerrado** (con commit `8a33ce1`, con prueba).

### ALTO 4 — (heredado, 3ª RONDA) El motor sigue afirmando "deducible por la facilidad del 15%" sobre un comprobante SIN CFDI

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:304-325` — la rama
`if (elegible === true)` sigue sin exigir `g.cfdiUuid`. El fix de la ronda 15
(`96f2adc`) añadió dos guardias —`mismoEjercicio` y `total > 0`— y NO esta.
El comentario del fixture lo declara sin cubrirlo: `engine.test.ts:1419-1420`
— "sin CFDI, el gasto cae a por_confirmar por la regla del ticket, y la
facilidad del 15% no aplica (no hay comprobante que ampare)" — y el fixture
`g15` (`engine.test.ts:1423` y `1526`) SIEMPRE trae `cfdiUuid`.

**Escenario concreto (verificado con prueba temporal, 2ª vez):** diésel en
efectivo $1,000, SIN `cfdiUuid`, `facilidad15: true`, ejercicio $10,000,
previo 0, fecha dentro del ejercicio → el motor emite
`combustible_efectivo_dentro15` con la nota "deducible por la facilidad del
15% (RFA 2026 regla 2.9): el ejercicio lleva $1,000.00 de $10,000.00 … (10%
del total, tope 15%). No acredita IEPS" — y `cubetaDe` (`engine.ts:126`, `if
(!g.cfdiUuid) return 'por_confirmar'`) manda el MISMO gasto a `por_confirmar`
(`totalPorConfirmar` 1000, `totalDeducible` 0). El papel se contradice sobre
el mismo renglón: "deducible" y "por confirmar". Es el caso más común del
producto (diésel en efectivo con ticket, antes de facturar). La ronda 15 lo
dejó documentado y su fix lo volvió a dejar pasar.

**Estado: abierto** (sin cambios desde la ronda 14).

### ALTO 5 — (NUEVO, REGRESIÓN de la ronda 15) El `continue` del fail-closed se salta TODAS las reglas posteriores del gasto: política, monto discrepante, CFDI cancelado y RFC de tercero desaparecen cuando el contador está caído

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:324` — el `continue` de la
rama fail-closed que el fix de la ronda 15 añadió. A diferencia de las otras
dos ramas del 15% (`elegible === false` en 358-364 y `else` en 366-372, que
hacen push y caen al resto del bucle), esta rama hace `continue` y salta hasta
el final del `for` (cierra en ~582): se pierden, para ese gasto, el aviso de
monto discrepante (`~387`), el de "no es comprobante fiscal" (`~398`), el de
texto sospechoso (`~405`), la cordura de fecha (`~421`), el folio de baja
confianza (`~428`), el **tope de política** (`~437`), `sin_cfdi`, la
confianza OCR, el **RFC receptor de tercero** (`~472`, la rama que hace un
CFDI ajeno NO deducible), el **estado SAT cancelado/efos** (`~496`) y el
complemento. Los 3 tests nuevos de la ronda 15 (`engine.test.ts:1527-1560`)
solo afirman el tipo `combustible_efectivo` y las notas — sus fixtures no
llevan ni discrepancia ni política rebasada ni estado SAT, así que no ven el
salto.

**Escenario concreto (verificado con prueba propia; la sonda en paralelo de
otro auditor, `zzz-a16-probe2.test.ts`, lo confirma con `monto_discrepante` y
`comprobante_no_fiscal`):** viaje con `facilidad15: true`,
`totalCombustibleEjercicio: 0` (contador caído o año nuevo sin compras), un
solo gasto: diésel en efectivo $9,000 CON CFDI, fecha 2026-07-10, y
`ocrExtra: { montoDiscrepante: true }`. La política tiene tope de diésel
$4,000. Resultado: diferencias = `['combustible_efectivo', 'anticipo']` —
**no aparece `sobre_politica`** (los $5,000 sobre tope desaparecen del papel)
ni `monto_discrepante`. Control con el MISMO gasto y `totalCombustibleEjercicio:
10000` → `sobre_politica` y `monto_discrepante` SÍ aparecen. El caso extremo:
un CFDI **cancelado** ante el SAT con el contador caído deja de emitir
`cfdi_cancelado` (NO deducible, rojo) y pasa a `por_confirmar` (ámbar) — la
clasificación del dinero cambia según un bache de red. Además la nota de la
rama afirma una causa falsa cuando el total es 0 legítimo: "el contador no
respondió" cuando sí respondió con $0 (flota nueva en enero, primer ticket).

**Estado: abierto** (regresión nueva de la ronda 15; sus 3 tests de cierre no
la cubren).

### MEDIO 1 — (heredado) Los campos passthrough del detalle siguen sin aserción

**Archivo/línea:** `src/lib/cuadra/analytics.ts:703` (`litrosDiesel`) y el
resto de los passthrough (694-702). **Mutación M2 verificada (4ª vez):**
`litrosDiesel: Number(... ?? 42)` → 0 fallos en 49 tests.

**Estado: abierto.**

### MEDIO 2 — (heredado) El "test" de `getDocumentos` sigue siendo hueco

**Archivo/línea:** `src/lib/cuadra/analytics_datos.test.ts:206-210` — siembra
`TABLAS.liquidacion` mientras `getDocumentos` lee `gasto`; la aserción es
`expect(Array.isArray(r)).toBe(true)`.

**Estado: abierto** (sin cambios).

### MEDIO 3 — (heredado) La ventana 7d/30d sigue sin prueba — el bug del ALTO 2 pasó por esto

**Archivo/línea:** `src/lib/cuadra/analytics.ts:42-47` y las ramas
`corte ? q.gte(...) : q` (57 y 215). Ninguna prueba llama
`getKpis(tenantId, 7)` ni `getAcreditables(tenantId, 7)` (grep: cero).

**Estado: abierto.**

### MEDIO 4 — (heredado, 3ª RONDA) `cardinalesEnPalabras` sigue rompiendo el multiplicador "mil"

**Archivo/línea:** `src/lib/cuadra/cuadre/cifras.ts:220` — la composición
`suma = vj > suma || v >= 1000 ? suma + vj : ...` no cambió; "mil" se SUMA,
nunca multiplica. El test de la ronda 13 (`cifras.test.ts:208-211`) cubre
"mil ochocientos" (1000+800) y NO el rango 2,000–999,999.

**Escenario concreto (verificado con prueba temporal, 3ª vez):**
`cardinalesEnPalabras('son dos mil pesos')` → `[1002]` (esperado 2000);
`('te sobran cinco mil del anticipo')` → `[1005]` (esperado 5000);
`('son tres mil doscientos pesos')` → `[1203]` (esperado 3200). En la
guardia: `cifrasSinRespaldo('te sobran cinco mil pesos del anticipo', [{
tope: 5000 }])` → `[1005]` — el modelo dijo la verdad, la tool la respaldó, y
la guardia reemplaza el texto porque el conversor leyó 1005.

**Estado: abierto** (3ª ronda; el fix de la ronda 13 sigue roto en el rango
más frecuente del dominio).

### MEDIO 5 — (heredado) El glue de la RFA 2.9 en `desde_db.ts` sigue SIN NINGUNA prueba

**Archivo/línea:** `src/lib/cuadra/cuadre/desde_db.ts:55-90` — la derivación
de `facilidad15`, el ancla del ejercicio (63), la resta del previo y el
best-effort de `getAcumuladoCombustible`. **Cero tests:** `desde_db.ts` no
tiene archivo de prueba. El `anioEjercicio` nuevo (ronda 15, línea 114) entró
con el mismo silencio.

**Estado: abierto.**

### MEDIO 6 — (heredado) El alta tri-estado y `actualizarFacilidad15` siguen sin prueba

**Archivo/línea:** `src/app/admin/flotas/page.tsx:37-38` y
`src/lib/cuadra/administracion.ts:110-115`; `administracion.test.ts:64-87`
solo cubre RFC inválido, RFC válido y nombre corto. `actualizarFacilidad15`
(`repo.ts:928-940`) tiene el fix del error de lectura de la ronda 15 (correcto
por lectura) y **cero referencias en tests** (grep: cero).

**Estado: abierto.**

### MEDIO 7 — (heredado, 3ª RONDA) El cierre de la ronda 13 sobre `venceArco` sigue hueco: el test pasa con 15 y con 20 días

**Archivo/línea:** `src/lib/cuadra/privacidad.test.ts:367-376` — el test
sigue titulado "suma 15 DÍAS HÁBILES (LFPDPPP art. 32)" y solo afirma
`expect([1,2,3,4,5]).toContain(d.getUTCDay())`. **Mutación verificada (3ª
vez):** `DIAS_HABILES_ARCO = 20` → 15 → **0 fallos** (40/40). Desde
1-ago-2026 (sábado), 20 días hábiles vencen el 28-ago; 15, el 21-ago — ambos
viernes, el test no distingue.

**Estado: abierto.**

### MEDIO 8 — (heredado, 3ª RONDA) La ventana de negación de `guardiaEstado` sigue asimétrica

**Archivo/línea:** `src/lib/cuadra/cuadre/estado_afirmado.ts:148` — ventana
`oracion.slice(m.index - 25, m.index + 18)` sin cambios. El test
(`estado_afirmado.test.ts:203`) solo cubre el "no" DESPUÉS del verbo.

**Estado: abierto.**

### MEDIO 9 — (ronda 15) Contador caído → nota "contra un tope de $0.00": CERRADO, con red — pero su fix abrió el ALTO 5

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:315-325` — la rama
fail-closed con nota honesta ("no se pudo calcular el total … no se evaluó").
**Mutación verificada:** desactivar la guardia → **3 tests mueren**
(`engine.test.ts:1527-1560`). Es el primer cierre del rubro con red real de
verdad. El costo: la regresión del ALTO 5.

**Estado: cerrado** (con commit `96f2adc`, con prueba) — con deuda (ALTO 5).

### MEDIO 10 — (heredado, 2ª RONDA) El patrón "corregido con prueba" sigue sin sostenerse: la línea del IVA del efectivo sigue sin red, y la superficie de la ronda 16 llegó con CERO tests

**Archivo/línea:** `src/lib/cuadra/fiscal.ts:514` — la línea del IVA del
efectivo (fix de la ronda 14). **Mutación verificada (2ª vez):** quitarla →
**57/57 verdes**. Las ramas nuevas de `causasDe` con `elegible15: undefined`
(fiscal.ts:338, ronda 15) y `avisoTope15` con `elegible: false/undefined`
(`periodo/aviso.ts:29-32`) tampoco tienen NINGÚN test (`aviso.test.ts` pasa
`true` a todas las llamadas; `fiscal.test.ts` pasa `OPTS` con `elegible15:
true`).

**Y la ronda 16 (commit `c901226`, "3,159 verdes") no añadió un solo archivo
de prueba** (git show --stat: solo 5 archivos de código). La superficie nueva:
`resolverSolicitudArco` (`repo.ts:972-1006`, incluye el envío WhatsApp),
`enviarRespuestaArco` (`meta/client.ts:437-481`, texto libre + fallback de
plantilla + 3 códigos de ventana), `listarSolicitudesArco` (`repo.ts:950-970`),
la página `/dashboard/arco/page.tsx` (126 líneas, server actions) y la ruta en
`visibilidad.ts:76` — **cero referencias en tests** en todo `src/` (grep
exhaustivo). El camino más frágil de la feature —decidir si Meta aceptó el
texto, si el código de error es de ventana, si la plantilla aprobada manda—
es exactamente el que no tiene una sola aserción. El "3,159 verdes" del
asunto no puede venir de `c901226` (no toca tests).

**Estado: abierto** (con el añadido de la ronda 16).

### BAJO 1 — (heredado) La matriz del 15% depende del orden de `input.gastos`, y `getGastos` no trae `ORDER BY`

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:316-317` y
`src/lib/cuadra/repo.ts:556-561`. Sin cambios.

**Estado: abierto.**

### BAJO 2 — (heredado, parcial) El fixture `g15` sigue no determinista y el caso "sin CFDI" declarado en el comentario sigue sin test

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.test.ts:1423` y `1526` —
`cfdiUuid: 'u-' + Math.random()`; `1419-1420` — el comentario declara el
comportamiento que el código no implementa (por eso el ALTO 4 pasa otra vez).

**Estado: abierto** (la mitad —estatus— se cerró con `8a33ce1`; la otra mitad
sigue).

### BAJO 3 — (heredado) La rama `'—'` de `CifraGrande` sigue sin prueba

**Archivo/línea:** `src/app/dashboard/cifra-grande.tsx:60`;
`cifra-grande.test.tsx` sigue con 3 pruebas (opacity, valor servido, cero
real) y ninguna para `valor === undefined → '—'`.

**Estado: abierto.**

### BAJO 4 — (heredado) `buscarTenantPorTelefono` sigue sin NINGUNA prueba

**Archivo/línea:** `src/lib/cuadra/conv.ts:644-655` (grep: cero referencias).

**Estado: abierto.**

### BAJO 5 — (heredado) `getLineasPorConciliar`: los fallos de las tres consultas secundarias siguen sin prueba

**Archivo/línea:** `src/lib/cuadra/analytics.ts:1002` (`cfdi_xml`), `1013`
(`gasto`), `1021` (`viaje`) — sin `respuestas.set(..., { error: ERROR_RED })`
en todo `analytics.test.ts` (verificado en 470-545).

**Estado: abierto.**

### BAJO 6 — (heredado, 3ª RONDA) La mutación de `tasaCuadre` (round→floor) sigue sobreviviendo

**Archivo/línea:** `src/lib/cuadra/analytics.ts:74`. **Mutación verificada
(3ª vez):** round→floor → 0 fallos en 46 tests.

**Estado: abierto.**

### BAJO 7 — (heredado) El fix `rolEfectivo` de `[id]/page.tsx` (ronda 13) sigue sin prueba de página

**Archivo/línea:** `src/app/dashboard/[id]/page.tsx:47` — la decisión de qué
se pinta/ejecuta con el rol efectivo no tiene test de página.

**Estado: abierto.**

### BAJO 8 — (NUEVO) La plantilla `respuesta_arco` lleva el parámetro {{1}} hardcodeado como "la flota", no la razón social

**Archivo/línea:** `src/lib/meta/client.ts:466` — el comentario (463) dice
"{{1}} = razón social de la flota" y el código pasa
`text: 'la flota'`. Cuando Meta apruebe la plantilla, el mensaje que reciba el
titular dirá "la flota" donde debería ir el nombre de la empresa responsable.
La lista `FUERA_VENTANA = [131047, 131026, 131042]` (455) es además una
adivinanza parcial: otros códigos de "fuera de ventana" (p. ej. 131030, 470)
se saltan el fallback de plantilla y caen al error genérico `HTTP 400` — el
fallo es honesto (fail-closed), pero la cobertura es incompleta y no hay test
que fije ninguno de los dos comportamientos.

**Estado: abierto** (nuevo).

### BAJO 9 — (NUEVO) "Vencen pronto" mezcla la ventana de 24h de WhatsApp con un `Date.now()` en UTC sobre fechas-hora locales

**Archivo/línea:** `src/app/dashboard/arco/page.tsx:49` —
`s.venceEn <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)`.
`venceEn` es la fecha UTC de `venceArco` (privacidad.ts:618-628), así que la
comparación es coherente en UTC, pero el borde "≤ 5 días" puede correrse un
día respecto al calendario local (la misma clase del ALTO 2, aquí sobre un
KPI informativo). Un titular que vence en 5 días hábiles locales puede quedar
fuera del contador en las horas nocturnas.

**Estado: abierto** (nuevo, borde).

### BAJO 10 — (NUEVO) `mismoEjercicio` con `anioEjercicio` ausente falla cerrado en silencio

**Archivo/línea:** `src/lib/cuadra/cuadre/engine.ts:313` —
`mismoEjercicio = !anioComprobante || anioComprobante === input.anioEjercicio`.
Si un llamador no pasa `anioEjercicio` y el gasto trae fecha, TODOS los
gastos de efectivo con fecha caen a "se revisa aparte". Hoy los llamadores de
producción lo pasan (`desde_db.ts:114`), así que no es un bug vivo — pero el
parámetro opcional recién nacido no tiene un solo test que fije su ausencia, y
el costo de olvidarlo en el próximo llamador es silencioso.

**Estado: abierto** (nuevo, fragilidad).

---

## Lo que revisé y está bien

- **MEDIO 9 cerrado de verdad, con red que responde a la mutación.** El
  contador caído ya no imprime "contra un tope de $0.00": la rama fail-closed
  de `engine.ts:315-325` manda a `por_confirmar` con nota honesta, y quitar la
  guardia mata 3 tests (`engine.test.ts:1527-1560`). Es el primer cierre del
  rubro propio verificado con control positivo en esta auditoría.
- **La matriz del 15% sigue verde y coherente** (117 tests): dentro/excede por
  comprobante, no elegible, sin declarar, excedente $1,500 con 3×$1,000,
  estatus `revisar`. El rewrite de la ronda 14 no se movió en la 15 excepto
  por la guardia nueva.
- **El cierre fiscal de la ronda 13 sigue clavado.** El control positivo de la
  ronda 15 (quitar la línea `pendiente/no_encontrado` de `ivaSostenible`) no
  se re-mutó esta vez, pero la línea está y el batch de fiscal (57) corre
  verde.
- **El fix de la ronda 15 en `actualizarFacilidad15` está presente**
  (`repo.ts:923-926`, comprueba `errLee` antes de reemplazar la config) —
  correcto por lectura, aunque sin red (MEDIO 6).
- **El panel 'sin declarar' ya no se pinta como pérdida** (`fiscal.ts:338`:
  `elegible15 === false → efectivo_no_elegible`, `undefined → combustible_efectivo`)
  y el recuadro del 15% en `combustible/page.tsx:155-166` distingue los tres
  estados. Por lectura correcto.
- **`fechaMx` maneja bien las fechas sin hora** (`formato.ts:107-127`): la
  tabla ARCO imprime `venceEn` ('YYYY-MM-DD') y `recibidaEn` sin correrlas un
  día — el fix documentado del 1-ago sigue aplicado.
- **La ruta `/dashboard/arco` no quedó huérfana:** el test "el mapa de rutas
  no se queda atrás del sidebar" (`visibilidad.test.ts:87-92`) itera GESTION
  —que ahora incluye ARCO— y exige `areaDeRuta` declarada; pasa (90 verdes).
  La cobertura es transitiva, no semántica (quién ve la ruta), pero existe.
- **Mis batches del rubro:** engine 117, analytics 49, privacidad 40, fiscal
  57, meta+auth 211 — todo verde y estable. El árbol quedó limpio tras cada
  mutación (`git diff` vacío verificado) y mis archivos temporales fueron
  borrados; `zzz-a16-probe*.test.ts` son de otros auditores y no los toqué.

## Lo que no alcancé a revisar

- **La suite completa (~3,1xx)** — otros auditores corrían en paralelo. Mis
  mediciones son sobre archivos propios con restauración verificada.
- **No monté el render de `/dashboard/arco/page.tsx`** (rubro frontend): leí
  el server component y las server actions línea por línea, pero no verifiqué
  el HTML servido ni el flujo real del form `FormaConAviso`.
- **No probé `enviarRespuestaArco` contra Meta real** (requiere credenciales y
  un número whitelisted; el punto es precisamente que no hay test de ningún
  tipo para ese camino).
- **No re-muté el cierre fiscal de la ronda 13** (control positivo de la ronda
  15): el batch corre verde y la línea está, pero no repetí la mutación.
- **No revisé el GUION_DEMO.md** para el flujo ARCO (la solicitud sembrada
  está fuera de la ventana de 24h, así que la respuesta en la demo caerá al
  camino "no se pudo enviar" — honesto, pero conviene que el guion lo sepa).

---

## Veredicto

**Rojo — el rubro pruebas no da green light.**

Lo que sostiene el puntaje:
1. **El primer cierre propio del rubro con red real:** MEDIO 9 (contador
   caído) está bien hecho y bien probado — la mutación lo demuestra (3 tests
   mueren). La ronda 15 atacó su hallazgo más feo y lo cerró con prueba.
2. Mis ~900 pruebas objetivo están verdes y estables; el árbol quedó limpio.

Lo que lo impide — tres capas:
1. **La regresión dentro del propio fix de la ronda 15 (ALTO 5).** El
   `continue` de `engine.ts:324` se salta el tope de política, el monto
   discrepante, el CFDI cancelado y el RFC de tercero para el gasto afectado.
   Los 3 tests del cierre no lo ven porque sus fixtures son limpios. El
   camino "fail-closed honesto" que la ronda 15 proclamó es justo el que ahora
   esconde diferencias.
2. **La ronda 16 desplegó una feature con cero pruebas** —resolver + envío
   WhatsApp con fallback de plantilla— mientras el asunto dice "3,159 verdes"
   y el commit no toca un solo archivo de test. El patrón de la ronda 14 se
   repite al pie de la letra: la superficie nueva se anuncia probada y no
   tiene una sola aserción.
3. **Los tres ALTOS propios del rubro siguen clavados en el mismo sitio**
   (tenant 5ª ronda, UTC 4ª ronda, facilidad sin CFDI 3ª ronda), con las
   mutaciones sobreviviendo una vez más, y la mitad de los MEDIO/BAJO
   heredados (cifras "N mil", venceArco, passthrough, getDocumentos, guardia)
   sin moverse.

El demo de mañana sigue a salvo por los mismos accidentes del seed (diésel
`forma_pago '03'`, declaración true, solicitud ARCO sembrada fuera de ventana
con mensaje honesto) — la seguridad que el rubro pruebas existe para no
depender de tener. **Nota 6/10**: no baja a 5 porque el cierre del MEDIO 9 con
red real es el primer movimiento propio del rubro en cinco rondas; no sube a 7
porque ese mismo fix rompió la cadena de reglas sin que sus tests lo vieran, y
la ronda 16 repitió el patrón "feature nueva, cero pruebas".
