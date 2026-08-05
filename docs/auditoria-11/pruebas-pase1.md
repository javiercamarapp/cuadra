# Pruebas — auditoría 11

**Nota: 3/10** (antes 5). Razón: **deuda que cobró factura**. El 5 se puso sobre
el árbol del PR #7 —**con** los arreglos dentro—; este árbol no tiene ninguno, y
encima trae los 9,700 renglones nuevos de `master`. Corrí **22 mutaciones
dirigidas al código nuevo: sobrevivieron las 22**. Los **5 controles murieron**
como debían, así que la suite sí corre y sí caza — el motor del dinero sigue
armado (`engine.ts`, `pg.ts`, `duplicados.ts`). Lo que no existe es red sobre lo
que entró: el único punto de autorización de `/dashboard` mide **0.0 % de líneas
y 0.0 % de funciones**, y sus tres decisiones se pueden borrar una por una con
`173 archivos · 1677 pruebas · exit 0`. La escala del rubro dice «4 o menos si la
suite pasa con la función rota»; aquí pasa con **veintidós** funciones rotas, tres
de ellas fugas entre flotas. De ahí el 3, y no menos porque el núcleo del cuadre
sigue anclado de verdad.

**Riesgo mayor del rubro, hoy:** `src/lib/auth/tenant-efectivo.ts` no tiene un
solo archivo de prueba y es el único chokepoint que resuelve *qué flota* y *qué
rol* ve cada una de las ~20 páginas de `/dashboard`. Cambiar
`if (sesionReal.rol === 'superadmin' && sp?.tenant)` por `if (sp?.tenant)`
(línea 67) deja que **cualquier flota_admin con sesión legítima teclee
`?tenant=<uuid-de-otra-flota>` y vea el panel completo de la competencia** — y la
suite queda verde, `tsc --noEmit` en 0, `eslint` en 0. Dos días antes del demo,
el árbol que Vercel despliega no tiene una sola prueba que lo impida.

---

## Método y línea base

Línea base medida hoy sobre `50e3047` (HEAD de esta rama = `master` + docs), en
copia limpia: **`173 archivos · 1677 pruebas · 1 saltada · exit 0 · 51 s`**.

**No mutá el árbol real ni una vez.** Copié el repo (sin `.git`, con
`node_modules` symlinkeado) a `scratchpad/mut` y ahí apliqué cada mutante,
corriendo la suite COMPLETA (`npx vitest run`) en cada uno y restaurando el
archivo desde el árbol real inmediatamente después. Prueba en la sección final.

Cobertura medida por mí sobre este árbol (per-file, provider v8):

```
  0.0 % líneas ·   0.0 % funciones ·  24 L   src/lib/auth/tenant-efectivo.ts
 44.3 % líneas ·  56.2 % funciones · 402 L   src/lib/cuadra/analytics.ts
 84.9 % líneas ·  68.8 % funciones · 332 L   src/lib/cuadra/operacion.ts
100.0 % líneas · 100.0 % funciones ·  55 L   src/lib/auth/visibilidad.ts   ← y M18 sobrevive
 81.2 % líneas ·  80.0 % funciones ·  32 L   src/lib/auth/guard.ts
100.0 % líneas · 100.0 % funciones ·  19 L   src/lib/cuadra/pg.ts
```

El total (`64.32 % líneas`, `78.89 % funciones`, contra umbrales 78/83) ya venía
medido por el orquestador; lo repito solo para lo que sí es mío: **`visibilidad.ts`
está al 100 % de líneas Y de funciones y aun así deja pasar un mutante de
fail-open.** 100 % de líneas con las aserciones equivocadas sigue siendo cero
protección — lo dice el propio `vitest.config.ts:38-44` y aquí hay el caso.

---

## Mutaciones aplicadas

Cada `NO` de la columna «¿Murió?» significa una corrida literal de
`Test Files 173 passed (173) · Tests 1677 passed | 1 skipped (1678) · exit 0`,
byte por byte igual a la línea base.

### Controles — mutantes que SÍ tenían que morir, y murieron los 5

| # | archivo:línea | Mutante | ¿Murió? | Quién lo mató |
|---|---|---|---|---|
| C1 | `src/lib/cuadra/pg.ts:49` | `if (pag.length < PAGINA) break;` → `break;` | **SÍ** — 1 fallo | `analytics_paginacion.test.ts` |
| C2 | `src/lib/cuadra/cuadre/engine.ts:543` | `round2(input.anticipo - totalComprobado)` → orden invertido | **SÍ** — 4 fallos / 3 archivos | `engine.test.ts`, `processor_cadena.test.ts`, `arnes_ticket_real.test.ts` |
| C3 | `src/lib/auth/visibilidad.ts:41` | `encargado: ['operacion']` → `['operacion','dinero']` | **SÍ** — 12 fallos / 2 archivos | `visibilidad.test.ts`, `api/dashboard/asistente/rol_no_mirado.test.ts` |
| C4 | `src/lib/cuadra/operacion.ts:480` | `crearViaje`: `estatus: 'abierto'` → `'liquidado'` | **SÍ** — 1 fallo | `operacion.test.ts` «crearViaje acota por tenant y nace abierto» |
| C5 | `src/lib/cuadra/pg.ts:24` | `if (res.error) throw` → `if (false && res.error) throw` | **SÍ** — 6 fallos / 2 archivos | `analytics.test.ts`, `operacion.test.ts` |

### Los 22 mutantes sobre código nuevo — sobrevivieron los 22

| # | archivo:línea | Mutante | ¿Murió? | Prueba que debía cazarlo |
|---|---|---|---|---|
| M1 | `src/lib/auth/tenant-efectivo.ts:55` | `if (!puedeVerRuta(sesion.rol, destino))` → `if (false && !puedeVerRuta(…))` | **NO** | ninguna |
| M2 | `src/lib/auth/tenant-efectivo.ts:67` | `if (sesionReal.rol === 'superadmin' && sp?.tenant)` → `if (sp?.tenant)` | **NO** | ninguna |
| M3 | `src/lib/auth/tenant-efectivo.ts:44` | `rolEfectivo(sesionReal.rol, sp?.rol)` → `sp?.rol ?? sesionReal.rol` | **NO** | ninguna |
| M4 | `src/lib/cuadra/operacion.ts:492` | `asignarUnidad`: fuera `.eq('tenant_id', tenantId)` | **NO** | ninguna |
| M5 | `src/lib/cuadra/operacion.ts:499` | `cambiarEstadoUnidad`: fuera `.eq('tenant_id', tenantId)` | **NO** | ninguna |
| M6 | `src/lib/cuadra/operacion.ts:512` | `crearUnidad`: fuera `tenant_id: tenantId` del INSERT | **NO** | ninguna |
| M7 | `src/lib/cuadra/operacion.ts:380` | `marcarPodPedido`: `estado: 'pendiente'` → `'subido'` | **NO** | ninguna |
| M8 | `src/lib/cuadra/operacion.ts:536` | `crearIncidencia`: fuera `tenant_id: tenantId` del INSERT | **NO** | ninguna |
| M9 | `src/lib/cuadra/operacion.ts:478` | `crearViaje`: `operador_id: v.operadorId \|\| null` → `null` | **NO** | ninguna |
| M10 | `src/lib/cuadra/analytics.ts:37` | `corteVentana`: `return null;` antes del `if` (la ventana muere para los DOS rótulos) | **NO** | ninguna |
| M11 | `src/lib/cuadra/analytics.ts:51` | `getKpis`: `(corte ? q.gte('created_at', corte) : q)` → `q` | **NO** | ninguna |
| M12 | `src/lib/cuadra/analytics.ts:389` | `getGastoPorConcepto`: fuera `.eq('tenant_id', tenantId)` | **NO** | ninguna |
| M13 | `src/lib/cuadra/analytics.ts:332` | `getViajes`: fuera `.eq('tenant_id', tenantId)` | **NO** | ninguna |
| M14 | `src/lib/cuadra/analytics.ts:362` | `getDocumentos`: fuera `.eq('tenant_id', tenantId)` | **NO** | ninguna |
| M15 | `src/lib/cuadra/analytics.ts:247` | `MINUTOS_CAPTURA_MANUAL = 4` → `40` | **NO** | ninguna |
| M16 | `supabase/verificaciones.sql:1082` | bloque 28 (mig. 0047) con el cuerpo alterado, solo el título intacto | **NO** | `migraciones_verificadas.test.ts` (mira solo títulos) |
| M17 | `src/app/login/page.tsx:74` | `if (!(await dentroDelLimite('login:email')))` → `if (false && …)` | **NO** | `no_autoregistro.test.ts` (mira solo el texto fuente) |
| M18 | `src/lib/auth/visibilidad.ts:100` | `return area !== undefined && puedeVerArea(rol, area)` → `return area === undefined \|\| puedeVerArea(rol, area)` | **NO** | ninguna |
| M19 | `src/lib/auth/guard.ts:81` | `exigirVerRuta`: `if (!puedeVerRuta(s.rol, destino))` → `if (false && …)` | **NO** | ninguna |
| M20 | `src/app/dashboard/[id]/page.tsx:41` | `if (!puedeVerArea(rol, 'dinero')) redirect(…)` → `if (false && …)` | **NO** | ninguna |
| M21 | `src/lib/cuadra/analytics.ts:64` | `getKpis.montoComprobado`: la suma `* 2` | **NO** | ninguna |
| M22 | `src/lib/cuadra/analytics.ts:57` | `getKpis`: `r.estatus === 'cuadrada'` → `!==` (la tasa de cuadre se invierte) | **NO** | ninguna |

---

## Hallazgos

### [CRÍTICO] `tenant-efectivo.ts` — el único chokepoint de autorización de `/dashboard`: **0.0 % de líneas, 0.0 % de funciones, cero archivos de prueba**, y sus TRES decisiones se borran con la suite verde

`src/lib/auth/tenant-efectivo.ts:44` · `:55` · `:67`

**Escenario, con las tres mutaciones medidas por separado.** No existe
`tenant-efectivo.test.ts`; la única aparición del nombre en toda la suite es un
comentario en `api/dashboard/asistente/rol_no_mirado.test.ts:8`. Grep verificado
hoy: **20 `page.tsx` de `/dashboard` importan `resolverTenantEfectivo`** —
`page.tsx` (raíz), `viajes`, `cuadre`, `facturacion`, `documentos`, `operadores`,
`analitica`, `combustible-casetas`, `valor-ahorro`, `usuarios`, `politicas`,
`configuracion`, `despacho`, `incidencias`, `pod`, `unidades`, `chat`.

- **M2 (`:67`) — fuga ENTRE FLOTAS.** `if (sesionReal.rol === 'superadmin' && sp?.tenant)`
  → `if (sp?.tenant)`. Con eso, `sp.tenant` deja de ser un privilegio del
  superadmin. Ana Ruiz, `flota_admin` de Transportes Innovativos, con su magic
  link legítimo, abre `/dashboard/cuadre?tenant=<uuid-de-otra-flota>` y
  `resolverTenantEfectivo` devuelve `tenantId` = la otra flota; de ahí en
  adelante `getKpis`, `getAcreditables`, `getViajes` y `getLiquidacionDetalle`
  consultan con `service-role` bajo ESE tenant. RLS no la para: todas estas
  lecturas van por `supabaseAdmin()`. **173 archivos, 1677 pruebas, exit 0.**
- **M1 (`:55`) — el gate de ruta apagado.** `if (false && !puedeVerRuta(sesion.rol, destino))`.
  El comentario de las líneas 47-54 dice por escrito que este `if` existe porque
  «RLS no podía evitarlo (`tenant_data` es por tenant, no por rol) y esconder el
  link tampoco — se teclea la URL». El encargado (jefe de tráfico) vuelve a ver
  rentabilidad, cobranza y facturación de la flota. Verde.
- **M3 (`:44`) — escalada de privilegio de un teclazo.** `rolEfectivo(sesionReal.rol, sp?.rol)`
  → `sp?.rol ?? sesionReal.rol`. `visibilidad.test.ts:83-89` prueba **la función**
  con tres casos («NO es una escalada: a un encargado el parámetro no le da
  nada»), y esa prueba sigue verde: nadie prueba **el cableado**. Un `encargado`
  teclea `?rol=flota_admin` y ve las tres áreas. Verde.

**Consecuencia.** El 6-ago el contralor de Transportes Innovativos es la persona
con sesión legítima frente a la pantalla. Cualquiera de estas tres líneas es un
refactor de una tarde; ninguna deja rastro en CI. Y si M2 llega a producción, lo
que se enseña es el cuadre de otra flota — el único error del que este producto
no se recupera.

**Causa raíz.** El archivo nació el 3-ago con el bloque B de `master` y trajo su
lógica de autorización sin su prueba. Es **REINCIDENTE de patrón** del CRÍTICO de
la ronda 10 (`/admin` — `requireSuperadmin()` en un `layout.tsx` sin ancla): la
autorización se sigue escribiendo en la capa que pinta, y la capa que pinta está
excluida a mano de la cobertura (`vitest.config.ts:75-80`). Aquí la lógica sí se
extrajo a `lib/` —el paso correcto— pero nadie escribió el archivo de prueba, y
el trinquete de cobertura no lo notó porque 24 líneas a 0 % contra 10,095 no
mueven el porcentaje.

---

### [CRÍTICO] Las cifras de dinero del panel no tienen **una sola aserción de valor**: dupliqué `montoComprobado` e invertí la tasa de cuadre y la suite ni parpadeó

`src/lib/cuadra/analytics.ts:64` (`montoComprobado`) · `:57` (`tasaCuadre`) · `:37` y `:51` (la ventana «del periodo»)

**Escenario.** `analytics.test.ts` es un archivo bueno, pero prueba **una sola
propiedad**: que un error por valor se traduzca en excepción. A `getKpis` solo se
le dan dos entradas en toda la suite — `{ data: null, error }` (línea 60) y
`{ data: [], error: null }` (línea 219). **Nunca se le dan filas reales.** Medido:

- M21: `montoComprobado: round2(rows.reduce(…))` → `round2(rows.reduce(…) * 2)`.
  Verde. La cifra grande del panel —el total comprobado de la flota, el número
  que el contralor cruza contra su PDF— se puede duplicar sin que nada falle.
- M22: `rows.filter((r) => r.estatus === 'cuadrada')` → `!== 'cuadrada'`. Verde.
  La **tasa de cuadre** pasa a reportar exactamente el complemento: una flota con
  90 % cuadrado se presenta al 10 %, o al revés.
- M11 y M10: la ventana. `corteVentana` existe —y su comentario (líneas 28-35) lo
  dice con todas sus letras— porque «el panel enseñaba "ESTÍMULOS ACREDITABLES
  DEL PERIODO" y "LIQUIDACIONES DEL PERIODO" sobre consultas que NO filtraban por
  fecha». Quité el `.gte('created_at', corte)` de `getKpis` (M11) y luego hice
  que `corteVentana` devolviera siempre `null` (M10, que apaga la ventana en
  `getKpis` **y** en `getAcreditables`): **verde las dos veces**. El arreglo de la
  regla «un rótulo tiene que ser verdad» no tiene una sola prueba que lo ancle,
  ni siquiera una que llame a `corteVentana` con un `hoy` inyectado.

**Consecuencia.** Es el hallazgo que contradice la regla que define al producto.
El contralor va a cruzar `montoComprobado` contra su contabilidad; si un refactor
lo mueve, se entera él en la sala, no CI. Y la regresión histórica —rótulo «del
periodo» sobre datos de siempre— puede reaparecer entera sin que nada suene.

**Causa raíz.** El arnés de `analytics.ts` se escribió para un CRÍTICO de
*fail-closed* (auditoría 5) y quedó fijado a esa forma: el mock
(`crearBuilder`, línea 29) devuelve lo mismo para cualquier `.eq/.gte/.order`
—`for (const m of [...]) b[m] = self`— así que **no puede** observar qué filtros
se aplicaron. Es un mock que devuelve lo que la prueba quiere oír. El patrón
correcto ya existe en el repo dos veces (`repo_aviso.test.ts` y
`repo_huerfanos.test.ts` registran tabla/método/args); `analytics.test.ts` no lo
usa. Cobertura del archivo: **44.3 % de líneas, 56.2 % de funciones**.

---

### [CRÍTICO] Tres lectores de `analytics.ts` pierden su `.eq('tenant_id', …)` con la suite verde — y son las tres pantallas con datos personales y fiscales

`src/lib/cuadra/analytics.ts:332` (`getViajes`) · `:362` (`getDocumentos`) · `:389` (`getGastoPorConcepto`)

**Escenario.** De las 12 funciones exportadas de `analytics.ts`, la suite entera
solo nombra cuatro (`getKpis`, `getAcreditables`, `detectarAnomalias`,
`getLiquidacionDetalle`). Las otras ocho no aparecen en ningún `import` de
ningún `*.test.ts` — verificado por grep sobre `src/`. Borré el
`.eq('tenant_id', tenantId)` de tres de ellas, una por una:

- **M13, `getViajes`** (alimenta `/dashboard/viajes`): la tabla del panel pasa a
  listar los últimos 100 viajes **de todas las flotas de Likida**, con folio,
  origen, destino, anticipo y nombre del operador.
- **M14, `getDocumentos`** (`/dashboard/documentos`, la bandeja del Agente OCR):
  100 comprobantes de todas las flotas, con `rfc_emisor`, `cfdi_uuid`,
  `estado_sat` y `efos`. Datos fiscales de terceros y RFC de proveedores.
- **M12, `getGastoPorConcepto`** (`/dashboard/combustible-casetas`): el gasto en
  diésel y casetas de todas las flotas sumado como si fuera de una.

Las tres: **173 archivos, 1677 pruebas, exit 0**.

**Consecuencia.** Es la misma clase de fuga que M2 pero por la vía del dato, no
la de la sesión — y como todas estas lecturas van por `supabaseAdmin()`
(service-role), la RLS del esquema no las alcanza: el `.eq('tenant_id', …)` **es**
el aislamiento. Un `.eq()` borrado en un refactor de paginación es un incidente
LFPDPPP con RFC de terceros dentro, y hoy nada en el repo lo detiene.

**Causa raíz.** El patrón que sí funciona ya está escrito en este mismo repo:
`repo_operadores.test.ts` prueba exactamente esto para `reasignarOperador`
—«quitar ese `.eq` hace fallar la prueba», verificado en la ronda 10— y no se
replicó cuando `analytics.ts` creció 386 líneas.

---

### [ALTO] `operacion.test.ts` cubre 3 de las 8 escrituras del encargado: las otras 5 —incluido el `tenant_id` de tres de ellas— se rompen con la suite verde

`src/lib/cuadra/operacion.ts:380`, `:478`, `:492`, `:499`, `:512`, `:536`

**Escenario.** El `describe('escrituras')` de `operacion.test.ts:292-328` es
serio: verifica que `cambiarEstadoIncidencia` fecha el cierre, que `rechazarPod`
**no** borra `storage_path`, y que los dos comprueban `[['id',…],['tenant_id',…]]`
en el WHERE. Pero solo toca **`crearViaje`, `cambiarEstadoIncidencia` y
`rechazarPod`**. Las otras cinco exportadas —`marcarPodPedido`, `asignarUnidad`,
`cambiarEstadoUnidad`, `crearUnidad`, `crearIncidencia`— no se importan siquiera
(`operacion.test.ts:54-57`). Cobertura del archivo: 84.9 % de líneas pero
**68.8 % de funciones** — el hueco es exactamente ese. Medido:

- **M4** `asignarUnidad`: `.eq('id', viajeId).eq('tenant_id', tenantId)` →
  `.eq('id', viajeId)`. Verde. El comentario de las líneas 450-457 dice que cada
  escritura «comprueba el tenant en el WHERE además del id — un id de otro tenant
  no debe poder tocarse aunque alguien lo adivine». Con M4, el encargado de una
  flota que adivine (o vea en un log) un `viaje.id` ajeno le empata una unidad
  suya a un viaje de otra flota.
- **M5** `cambiarEstadoUnidad`: idem. Manda al taller un tractocamión de otra flota.
- **M6 / M8** `crearUnidad` / `crearIncidencia`: fuera `tenant_id: tenantId` del
  INSERT. La fila nace sin dueño; si la columna admite NULL, queda invisible para
  todos y el alta «funciona» en pantalla.
- **M7** `marcarPodPedido`: `estado: 'pendiente'` → `'subido'`. Verde. Y es el
  peor de los seis en operación: el POD queda marcado como **entregado** sin que
  nadie haya subido un papel. `getTableroOperacion` (`:446`) y `getCargaOperadores`
  (`:73`) cuentan `estado === 'subido'` como evidencia buena, así que el tablero
  del encargado reporta **0 PODs pendientes** — el cero mentiroso que ese archivo
  entero dice existir para evitar (comentarios de `:408-414` y `:220-222`).
- **M9** `crearViaje`: `operador_id: v.operadorId || null` → `null`. Verde. Cada
  viaje nace sin chofer aunque el alta lo haya elegido. La aserción existente es
  `toMatchObject` (`:297`) sobre 4 de las 9 claves del INSERT: no observa las
  otras cinco.

**Consecuencia.** Estas son, por comentario propio del archivo (`:450`), «las
PRIMERAS escrituras administrativas de la app». La red que las acompaña cubre
el 37 % de ellas, y ninguna de las que quedan fuera tiene un solo `expect` sobre
el WHERE que las acota al tenant.

---

### [ALTO] `visibilidad.ts` está al **100 % de líneas y 100 % de funciones** y aun así deja pasar el fail-open que su propio comentario dice cerrar; y los otros dos sitios que la aplican no tienen prueba de cableado

`src/lib/auth/visibilidad.ts:100` · `src/lib/auth/guard.ts:81` · `src/app/dashboard/[id]/page.tsx:41`

**Escenario (M18).** `visibilidad.ts:57-61` promete: «Explícito y no por prefijo
a propósito: una ruta nueva que nadie clasifique cae a `undefined`, y
`puedeVerRuta` la niega. Es preferible que una pantalla nueva no se vea a que se
vea de más — el error caro es el segundo». Invertí la guardia:
`return area !== undefined && puedeVerArea(rol, area)` →
`return area === undefined || puedeVerArea(rol, area)`. **173 archivos, 1677
pruebas, exit 0.** Las 25 pruebas de `visibilidad.test.ts` siguen pasando porque
todas preguntan por rutas que **sí** están en `AREA_POR_RUTA`; la única que mira
lo no clasificado (`:63-69`, «toda ruta del sidebar tiene área declarada») usa
`areaDeRuta` directo y nunca pasa por `puedeVerRuta`. Resultado del mutante: la
próxima ruta de `/dashboard` que alguien agregue y olvide clasificar **se le
abre a todos los roles, incluido el contador y el encargado** — el default se da
vuelta de cerrado a abierto y las pruebas lo aplauden.

**Escenario (M19).** `exigirVerRuta` (`guard.ts:78-83`) es el **segundo**
chokepoint: lo usan las páginas que no llaman a `resolverTenantEfectivo`
(`rentabilidad`, `cobranza`, `clientes`, `cotizador`, `mapa`, `soporte`).
`guard.test.ts` no lo nombra ni una vez (grep verificado). `if (false && !puedeVerRuta(…))`
→ verde.

**Escenario (M20).** `/dashboard/[id]` —el detalle de una liquidación: anticipo,
comprobado, diferencia, desglose de IVA/IEPS— es una ruta dinámica y por eso no
puede estar en `AREA_POR_RUTA`; su gate se escribe a mano en `page.tsx:41`, con
un comentario que explica exactamente eso. `if (false && !puedeVerArea(rol, 'dinero'))`
→ verde. Un `encargado` con el UUID de una liquidación (que ve en `/dashboard/viajes`,
que sí es suya) abre el detalle completo del dinero.

**Consecuencia.** El archivo que este bloque de `master` escribió para que «el
encargado deje de ver las finanzas de la flota» tiene una prueba de función pura
excelente y **cero pruebas de que alguien la aplique correctamente**. Los tres
sitios donde se aplica se pueden anular por separado sin que la suite lo note.

**Causa raíz.** REINCIDENTE literal del ALTO de la ronda 10 («`permisos.ts` está
probado como función pura y nunca como cableado»). Mismo archivo hermano, mismo
mes, mismo patrón: la matriz se prueba, el `if` que la consulta no.

---

### [MEDIO · REINCIDENTE] `migraciones_verificadas.test.ts` sigue midiendo que alguien escribió un TÍTULO, y ahora hay 4 bloques sin correr — incluido el de la RLS del chofer

`src/lib/cuadra/migraciones_verificadas.test.ts:39-42` · `supabase/verificaciones.sql:986` (bloque 26) · `:1068` (bloque 28)

**Escenario (M16).** La guardia lee solo las líneas que casan
`/^-- ── \d+\./` y comprueba que el ordinal de cada migración aparezca en alguna.
Alteré el cuerpo del **bloque 28** —el nuevo, el de la 0047, el que comprueba que
`unidad`/`mantenimiento`/`incidencia`/`pod` no se le abren al chofer— dejando el
título intacto: **4 pruebas, todas pasan**. Idéntico a lo que la ronda 10 midió
sobre el bloque 26; el patrón entró tal cual en el código nuevo.

**Lo que sí mejoró, y hay que decirlo:** los bloques **27 (0046) y 28 (0047)
llevan salida real registrada del 3-ago** («escribe-en-su-carpeta=t
escribe-en-carpeta-ajena=f», «unidades=0 mantenimientos=0 incidencias=0
pods-visibles=1 pod-ajeno-por-id=0»). Alguien los corrió de verdad. Eso deja el
hallazgo de la ronda 10 **parcialmente atendido pero no cerrado**: los bloques
**20 (0037), 24 (0042), 25 (0043) y 26 (0045)** siguen sin una sola salida
registrada. El 26 es el que sostiene todo `/mis-viajes`.

**Consecuencia.** La verificación de la 0047 —cuatro tablas nuevas de golpe en un
esquema multi-tenant— está escrita, se corrió una vez a mano, y a partir de hoy
nada obliga a que se vuelva a correr ni impide que se vacíe. Y la de la 0045
nunca corrió.

---

### [MEDIO · REINCIDENTE] `no_autoregistro.test.ts` sigue siendo tres greps sobre el texto fuente: apagué el límite por IP dejando el literal y las tres pruebas siguen verdes

`src/app/login/no_autoregistro.test.ts:23-41` contra `src/app/login/page.tsx:74`

**Escenario (M17).** `if (!(await dentroDelLimite('login:email')))` →
`if (false && !(await dentroDelLimite('login:email')))`. El texto
`dentroDelLimite('login:email')` y `rateLimit(` siguen en el archivo, así que las
dos `toMatch` de la línea 30-31 pasan. **Verde.** El archivo no se ha tocado desde
la ronda 10: mismo texto, mismas tres pruebas, misma laguna. La confirmo sobre
`page.tsx` de HOY (mtime 11:04, sin cambios) y la marco **REINCIDENTE**, sin
repetir el análisis de las otras dos propiedades que la ronda 10 ya midió.

**Consecuencia.** El día del demo, 500 POST desde una IP queman la cuota de SMTP
de Supabase y nadie entra al panel — sin un error en ningún log y con CI verde.

---

### [MEDIO] El CI rojo no solo no mide cobertura: **impide que corran los dos pasos siguientes**, incluidas las dos pruebas de tiempo que existen precisamente porque antes no corrían

`.github/workflows/ci.yml` (pasos «Tests (con umbral de cobertura)» → «Pruebas de tiempo (sin cobertura)» → «Build»)

**Escenario.** `npm run test:coverage` sale con **exit 1** (64.32 % líneas contra
78, 78.89 % funciones contra 83 — medido por mí también). Los pasos de un job de
GitHub Actions son secuenciales y ninguno de los dos siguientes lleva
`continue-on-error` ni `if: always()`, así que desde que el umbral se rompió
—3-ago, según el orquestador— **no ha corrido en CI**:

1. `npx vitest run fundamento duplicados`, el paso que el propio YAML explica
   («la guardia de ReDoS del buscador de fundamentos y la de crecimiento no
   lineal del deduplicador de CFDI **existían y nadie las corría** más que Javier
   en su máquina») — el paso se añadió para arreglar exactamente este síntoma y
   volvió a quedar inalcanzable, por otra puerta;
2. `npm run build`, que el YAML dice que «ya cazó un fallo real que solo aparecía
   aquí: Turbopack no resolvía el .wasm del lector de códigos».

**Consecuencia.** Dos días antes del demo, el árbol que Vercel despliega no ha
pasado un `npm run build` en CI desde el 3-ago, y el fallo que aparece es el de
un umbral de cobertura — el ruido tapa la señal. `pruebas_en_ci.test.ts` vigila
que nadie añada un `skipIf(CUADRA_COBERTURA)` fuera del alcance de ese comando,
pero no puede vigilar que el comando llegue a ejecutarse.

---

### [MEDIO] `MINUTOS_CAPTURA_MANUAL` — el supuesto declarado de la única estimación del producto, sin una sola prueba

`src/lib/cuadra/analytics.ts:247` · `src/app/dashboard/valor-ahorro/page.tsx:82`

**Escenario (M15).** `4` → `40`. Verde. La constante es el corazón de la única
cifra que el producto se permite estimar, y la pantalla la declara honestamente
(«ESTIMACIÓN: N comprobantes × 4 min de captura manual ÷ 60. Los 4 min son un
supuesto, no una medición»). Con el mutante, el rótulo sigue diciendo la verdad
sobre sí mismo y el ahorro presentado al comprador se multiplica por diez.
`getValorAhorro` (`analytics.ts:265`) no se importa en ninguna prueba.

**Consecuencia.** La pantalla que el `analytics.ts` describe como «la más fácil
de convertir en mentira» (comentario de `:214-220`) no tiene arnés, y es la que
se le enseña al comprador para justificar el precio.

---

## Lo que revisé y está bien

- **El núcleo del dinero sigue anclado de verdad, y lo comprobé, no lo supuse.**
  C2 (invertir `input.anticipo - totalComprobado` en `engine.ts:543`) mata **4
  pruebas en 3 archivos**. C1 (romper la paginación de `pg.ts:49`) y C5 (que
  `exigir` deje de lanzar) matan 1 y 6 respectivamente. Los dos bordes de
  PostgREST que CLAUDE.md llama «la familia de bugs más repetida del repo» están
  al **100 % de líneas y 100 % de funciones** y **sí** protegen: C5 hizo fallar a
  `analytics.test.ts` **y** a `operacion.test.ts` a la vez, o sea que el
  fail-closed del módulo nuevo del encargado sí heredó la red.
- **`operacion.test.ts` es una buena prueba en lo que cubre.** No es decoración:
  el caso de `getCargaOperadores` que exige `rejects.toThrow('timeout')` cuando
  una de las cuatro consultas falla (`:121-127`), el POD `rechazado` que cuenta
  como faltante (`:87`), el viaje del que *nadie* creó registro saliendo primero
  en `getPods` (`:254`), y la aserción de que `rechazarPod` **no** trae
  `storage_path` (`:326`) son casos de borde escogidos con criterio, no camino
  feliz. Mi crítica es a las cinco funciones que dejó fuera, no a estas.
- **`visibilidad.test.ts` tiene la mejor prueba a futuro del árbol nuevo**: la de
  `:63-69` cruza `AREA_POR_RUTA` contra las cinco listas de `dashboard/rutas.ts`
  y falla si alguien mete una pantalla al sidebar sin clasificarla. Eso es una
  guardia estructural correcta, con mensaje de error que dice qué hacer.
- **`analytics_paginacion.test.ts`** simula de verdad 1,000 + 1 filas y registra
  los `range()` pedidos: es el patrón que le falta a `analytics.test.ts`, y está
  escrito en el mismo directorio.
- **Ninguna prueba depende de la red.** Verificado archivo por archivo: los 22
  que tocan `fetch` lo hacen con `vi.stubGlobal`/mock. El único arnés de pago
  (`arnes_ticket_real.test.ts`) se salta solo si no hay `TICKET_PATH`
  (`describe.skipIf(GRUPOS.length === 0)`, `:345`) y es la única prueba saltada
  de la suite. No corrí ningún `pruebas-manuales/*.prueba.ts`.
- **Ninguna prueba depende de la hora de forma frágil.** Los tres usos de
  `Date.now()` fuera de arneses son umbrales de tiempo deliberados
  (`fundamento.test.ts:115,138`, `duplicados.test.ts:151`), correctamente
  aislados con `skipIf(CUADRA_COBERTURA)` porque la instrumentación de v8 falsea
  el reloj — y el YAML tiene un paso dedicado a recuperarlas (que hoy no corre,
  ver el MEDIO de CI). `processor_cadena.test.ts:38` usa `new Date()` para `HOY`
  pero ambos lados son UTC; lo volví a mirar y sigue sin desfase.
- **`vitest.config.ts` es honesto sobre sus límites.** El comentario de las
  líneas 38-44 dice explícitamente que «100 % de líneas con cero `expect` sigue
  siendo cero protección» y que la otra mitad la da la mutación dirigida. Esta
  auditoría es exactamente la confirmación de esa advertencia: `visibilidad.ts`
  al 100/100 con un mutante de fail-open vivo.
- **La suite no perdió pruebas por comodidad.** 172→173 archivos y 1670→1677
  pruebas contra la línea base que MAPA.md midió hoy: no hay borrados.

---

## Lo que NO alcancé a revisar

- **No tengo Postgres.** Todo lo que digo de `supabase/verificaciones.sql` sale
  de leer el SQL y su bitácora de corridas en la cabecera y en cada bloque. No
  corrí un solo bloque; en particular no comprobé que la salida registrada del
  bloque 28 (3-ago) corresponda al SQL que hoy está en el archivo.
- **`src/app/admin/` sigue sin un solo `*.test.ts`** y no volví a medirlo: el
  CRÍTICO de la ronda 10 sobre `requireSuperadmin()` en `admin/layout.tsx` sigue
  abierto en este árbol por construcción (los arreglos viven en el PR #7). No
  gasté mutaciones repitiéndolo; dalo por vigente.
- **No mutá** `src/proxy.ts` (el matcher ni el gate), `provisionar.ts`,
  `auth/callback/route.ts`, ni `admin/negocio.ts`. Los cuatro tienen hallazgos
  abiertos de la ronda 10 que este árbol no arregló; los di por reincidentes sin
  volver a medirlos para gastar el presupuesto en lo nunca auditado.
- **De `analytics.ts` dejé sin mutar** `getStatsPorOperador`, `getOperadoresDetalle`,
  `getLiquidacionesPorDia` y `getValorAhorro` — las cuatro sin ninguna prueba que
  las importe. No espero sorpresas (mismo patrón que M12-M14), pero no lo medí.
- **No corrí `npm run build`** (prohibido por el mandato) ni evalué si el paso de
  Build del CI pasaría hoy si llegara a ejecutarse.
- **`npx tsc --noEmit` y `npm run lint`**: los corrí como parte de la mutación 1
  de la ronda anterior, no en esta pasada, porque el árbol se movió a media
  auditoría (ver abajo) y su resultado de HOY ya no describiría lo que medí.

---

## Estado del árbol al terminar

**Yo no dejé una sola línea en `src/`. El árbol tampoco está limpio, y nada de lo
que hay es mío.** A media auditoría —a partir de las **14:39 de hoy**, con mis 27
corridas ya hechas— otro proceso empezó a aterrizar en este working tree los
arreglos de la ronda 10 / PR #7, escribió `docs/auditoria-11/plan-arreglo.md`
(93 KB) y **commiteó `989ca62` «fix: se traen a master los arreglos de la ronda 10
que no chocan con nada» (116 archivos)**, y sigue trabajando: entre dos ejecuciones
consecutivas de `git status --short` separadas por dos minutos, la salida pasó de
**129 líneas → 43 → 35**. El mandato decía «ahora corres SOLO»; sobre este árbol,
a esta hora, eso ya no es cierto. Lo digo porque cambia cómo hay que leer la
salida de abajo, no como queja.

Salida literal de `git status --short` en el instante de cerrar este archivo:

```
A  src/app/admin/fases.test.ts
A  src/app/admin/fases.ts
A  src/app/admin/gate.test.tsx
A  src/app/api/demo/config_no_publica.test.ts
A  src/app/api/demo/configuracion_fiscal.test.ts
M  src/app/api/demo/route.ts
A  src/app/api/demo/veredicto.test.ts
A  src/app/auth/callback/destino.test.ts
A  src/app/auth/callback/log.test.ts
M  src/app/auth/callback/route.ts
A  src/app/cuenta/identidad.test.tsx
M  src/app/cuenta/page.tsx
A  src/app/dashboard/[id]/reasignar.test.ts
A  src/app/dashboard/[id]/reasignar.ts
A  src/app/dashboard/acred.tsx
A  src/app/dashboard/acred_sin_litros.test.tsx
M  src/app/dashboard/contraste.test.ts
A  src/app/dashboard/deducible.test.tsx
A  src/app/dashboard/deducible.tsx
A  src/app/dashboard/encabezados_tabla.test.tsx
M  src/app/dashboard/formato.test.ts
M  src/app/dashboard/formato.ts
A  src/app/dashboard/peaje_condicionado.test.tsx
A  src/app/demo/etiqueta_concepto.test.ts
M  src/app/demo/page.tsx
A  src/app/demo/presets.ts
A  src/app/demo/simulador.tsx
A  src/app/login/acciones.ts
M  src/app/login/no_autoregistro.test.ts
A  src/app/mis-viajes/aviso.test.tsx
A  src/app/mis-viajes/comprobado_sin_liquidar.test.tsx
M  src/app/mis-viajes/page.tsx
A  src/app/mis-viajes/semaforo.test.tsx
?? docs/auditoria-11/plan-arreglo.md
?? docs/auditoria-11/pruebas.md
```

De esas líneas, **la única mía es `?? docs/auditoria-11/pruebas.md`**, que es el
único archivo que el mandato me autoriza a escribir. `?? docs/auditoria-11/plan-arreglo.md`
y todo lo que aparezca bajo `src/` es del otro proceso. **No revierto nada**:
descartar del índice el trabajo en vuelo de otro proceso sería destructivo y no es
mi mandato. Nunca commiteé.

### Prueba de que ninguna línea de `src/` es mía

1. **Los 9 archivos que mutá siguen intactos.** Salida literal de
   `git status --short -- src/lib/cuadra/pg.ts src/lib/auth/visibilidad.ts
   src/lib/auth/tenant-efectivo.ts src/lib/cuadra/operacion.ts
   src/lib/cuadra/analytics.ts supabase/verificaciones.sql src/app/login/page.tsx
   src/lib/auth/guard.ts 'src/app/dashboard/[id]/page.tsx'`:

   ```
   (vacío)
   ```

   Y `git diff --name-only 50e3047..HEAD` sobre esos mismos 9 archivos también
   sale **vacío**: ni siquiera el commit ajeno los tocó.

2. **Sus `mtime` son de las 11:04-11:35**, horas antes de que yo empezara (mi
   copia se hizo a las 14:21) y antes del cambio ajeno (14:42):

   ```
   11:04  src/app/login/page.tsx            11:27  supabase/verificaciones.sql
   11:04  src/lib/auth/guard.ts             11:34  src/lib/cuadra/analytics.ts
   11:18  src/lib/auth/tenant-efectivo.ts   11:35  src/lib/cuadra/operacion.ts
   11:20  src/lib/auth/visibilidad.ts       11:25  src/lib/cuadra/pg.ts
   ```

   El único de los míos que llegó a cambiar es `engine.ts` (mtime 14:42) — lo
   tocó el proceso ajeno: mi control C2 corrió a las ~14:24 y restauró desde el
   árbol real en ese momento, tres cuartos de hora antes.

3. **Ninguno de mis 22 mutantes está presente en `src/` ni en `supabase/`.**
   Grep literal, re-corrido DESPUÉS del commit ajeno, de los siete patrones más
   distintivos — `if (false && !puedeVerRuta`, `if (false && res.error)`,
   `if (false && !(await dentroDelLimite`, `if (false && !puedeVerArea`,
   `area === undefined || puedeVerArea`, `MINUTOS_CAPTURA_MANUAL = 40`,
   `CUERPO BORRADO POR LA AUDITORIA`: **los siete ausentes**. Y los
   `.eq('tenant_id', tenantId)` siguen completos donde los quité
   (`analytics.ts`: 19 ocurrencias · `operacion.ts`: 21).

4. **Todas mis mutaciones vivieron en `scratchpad/mut/`**, una copia sin `.git`
   con `node_modules` symlinkeado. El script (`scratchpad/mut11.py`) solo escribe
   dentro de esa copia, y restaura copiando **desde** el árbol real **hacia** la
   copia; nunca al revés.

### Nota sobre la validez de lo medido

Las **27 corridas** (22 mutantes + 5 controles) se hicieron **todas** contra el
árbol de `50e3047` —`master` tal como estaba commiteado y tal como Vercel lo
despliega—, que es lo que el mandato pedía. La prueba: la copia reportó
exactamente `173 archivos · 1677 pruebas · 1 saltada` en **cada una de las 27**,
incluidas las cuatro posteriores a las 14:42; si hubiera absorbido algo del
proceso ajeno, ese conteo habría subido. No subió.

Para dimensionar el cambio ajeno, y solo como dato ajeno a mis hallazgos:
`npx vitest run` sobre el árbol real al cerrar dio **`218 archivos · 1973 pruebas`
con `14 archivos y 40 pruebas FALLANDO`**. Es trabajo en vuelo, no lo audité, y
no lo cuento ni a favor ni en contra de la nota. Si esos arreglos aterrizan
completos y verdes, **varios de mis hallazgos pueden cerrarse rápido** — noté que
`no_autoregistro.test.ts` y `dashboard/[id]/reasignar.ts` ya están en la oleada,
que es exactamente el MEDIO REINCIDENTE y el ALTO de cableado de arriba. Lo que
**no** vi en ninguna de las dos oleadas es un `tenant-efectivo.test.ts`.
