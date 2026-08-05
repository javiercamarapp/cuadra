# Pruebas — auditoría 11 (pase 2)

**Nota: 5/10** (antes 3). Razón del movimiento: **se atacó y subió**, y la
mirada más profunda encontró dónde no. Los tres mutantes que en el pase 1
definieron el CRÍTICO —`tenant-efectivo.ts` al 0.0 %— hoy **mueren los tres**,
con un archivo de prueba de 345 líneas que no existía. La compuerta entera pasa
en el runner de GitHub, **Build incluido**, y la cobertura subió de 64.32 % a
**84.19 %**. Pero de **35 mutantes medidos, 21 siguen vivos**, y **12 de esos 21
están en un solo archivo: `src/lib/cuadra/analytics.ts`**, que es el que
alimenta todas las cifras de dinero del panel del cliente. No sube más porque la
escala dice «4 o menos si la suite pasa con la función rota», y aquí pasa con
veintiuna; no baja de 5 porque el motor del cuadre, el rail, las dos rutas de
export, el login y las escrituras del encargado **sí** están anclados y lo
comprobé rompiéndolos.

**Riesgo mayor del rubro, hoy:** `analytics.ts` no tiene **una sola aserción de
valor sobre `getKpis`** ni **una sola prueba que pueda ver un `.eq('tenant_id')`**.
Dupliqué `montoComprobado` (×2), invertí la tasa de cuadre, y borré el filtro de
tenant de **cinco** lecturas distintas —viajes, documentos, gasto por concepto,
roster de operadores, diésel por operador—: **las once mutaciones salieron
verdes**, `269 archivos · 2529 pruebas · 1 saltada · exit 0`, byte por byte igual
a la línea base. La prueba nueva que el pase 1 escribió para `getViajes`
(`analytics_ventana_y_dia.test.ts`, uno de los 49 cierres) **ejercita esa misma
función con 1,500 filas y aun así no ve el filtro**, porque su doble de
PostgREST define `eq` como `b[m] = self`.

---

## La compuerta medida hoy

Medido por mí sobre el árbol de `a2e2933` (cuyo `src/` es idéntico a `707c749`,
verificado con `git diff --stat 707c749..a2e2933 -- src/ supabase/ .github/
vitest.config.ts package.json` → **vacío**). A partir de las **11:47** otros
agentes empezaron a escribir en `src/` (`c02f0c4`, `ceb1a13`, y modificaciones
sin commitear en `export/liquidaciones/route.ts`, `export/pdf/[id]/route.ts` y
`guard.ts`); **todo lo que reporto abajo se midió antes de eso**, salvo donde lo
digo.

```
$ npx vitest run                              → exit 0
   Test Files  269 passed (269)
        Tests  2529 passed | 1 skipped (2530)
     Duration  84.89 s

$ npm run test:coverage                       → exit 1   ← LA COMPUERTA ROJA
   ❯ src/lib/cuadra/intake/ocr_imagen_cara.test.ts (4 tests | 2 failed)
   ⎯ Unhandled Rejection ⎯
   Error: ENOENT: … /node_modules/.cache/coverage/.tmp/coverage-145.json
   (sin reporte de cobertura: el proceso muere antes de evaluar el umbral)

$ npm run test:coverage   (segunda corrida)   → exit 1   ← REPRODUCIBLE
   ❯ src/lib/cuadra/intake/ocr_imagen_cara.test.ts (4 tests | 2 failed)
   ⎯ pero FALLAN OTRAS DOS pruebas del mismo archivo ⎯
   Error: ENOENT: … coverage-235.json

$ npx vitest run --coverage --testTimeout=60000   → exit 0
   Test Files  269 passed (269)
        Tests  2527 passed | 3 skipped (2530)
   % Coverage report from v8
   Statements   : 84.19% ( 9478/11257 )
   Branches     : 85.56% ( 3431/4010 )
   Functions    : 85.03% (   483/568  )
   Lines        : 84.19% ( 9478/11257 )
```

**El número de `RESULTADO.md` es cierto: 84.19 % de líneas y 85.03 % de
funciones, contra umbrales 78 y 83.** `vitest.config.ts` sigue byte-idéntico
(umbrales `lines: 78, statements: 78, branches: 84, functions: 83`), como el
commit `bc7fc86` prometió. Lo que ese commit hizo fue reordenar `ci.yml`: las
pruebas van primero **sin instrumentar**, el Build va en medio, y el trinquete
de cobertura queda al final y solo. Eso es correcto y lo verifiqué contra el
runner real.

**Y el CI de esta rama está VERDE en GitHub**, con los diez pasos en `success`
(run #336, `f6010617`, 11:13–11:16 UTC): Typecheck ✓ · Lint ✓ · Tests ✓ ·
Pruebas de tiempo ✓ · **Build ✓** · **Trinquete de cobertura ✓ (57 s)**. Es la
primera vez desde el 3-ago que el paso de Build corre sobre el código del demo.
Eso es lo que sube la nota.

Contexto que no es mío pero cambia cómo se lee lo anterior: **el CI de `master`
sigue rojo en las diez corridas más recientes** (#326–#335, la última a las
09:55 de hoy), y no por cobertura sino por lint: `✖ 3254 problems (217 errors,
3037 warnings)`. `master` es lo que Vercel despliega.

---

## Las pruebas de los 49 cierres — cuáles anclan de verdad y cuáles no

Tomé **catorce** de los cierres de los ocho commits citados y rompí a propósito
la función que cada uno dice proteger, **en una copia fuera del repo**
(`/tmp/mutacion-pruebas`, sin `.git`, con `node_modules` enlazado; `mutar.py`
restaura desde el árbol real antes y después de cada mutante). Corrí la suite
COMPLETA (`npx vitest run --bail=1`) en cada uno. **Cero mutaciones dentro del
repo de trabajo**; prueba al final.

### Anclan de verdad — la mutación muere (10)

| Cierre | Mutación aplicada | Quién la mató |
|---|---|---|
| **G-50** `tenant-efectivo.ts:53` | `if (sesionReal.rol !== 'superadmin') return null;` → `if (false)` | `tenant-efectivo.test.ts` · «un FLOTA_ADMIN con `?tenant=<otra-flota>` se queda en la SUYA» |
| **G-50** `tenant-efectivo.ts:123` | `if (!puedeVerRuta(…)) redirect(…)` → `if (false && …)` | idem · «el ENCARGADO no entra a /dashboard/rentabilidad» |
| **G-50** `tenant-efectivo.ts:112` | `rolEfectivo(sesionReal.rol, sp?.rol)` → `sp?.rol ?? sesionReal.rol` | idem · «un ENCARGADO con `?rol=flota_admin` NO gana la pantalla del dinero» |
| **G-26** `visibilidad.ts:113` | `area !== undefined &&` → `area === undefined ||` | idem · «una ruta que nadie clasificó se niega — fail closed» |
| **G-31** `login/acciones.ts:83` | `if (!(await dentroDelLimite('login:email')))` → `if (false && …)` | `no_autoregistro.test.ts` · «cuando el límite se excede NO se llama a Supabase» |
| **G-24(a)** `export/liquidaciones/route.ts:29` | `if (!puedeExportar(s.rol))` → `if (false && …)` | `autorizacion.test.ts` · «el CHOFER con sesión NO baja el CSV» |
| **G-24(b)** `export/pdf/[id]/route.ts:41` | idem | `autorizacion.test.ts` · «el CHOFER con sesión NO se lleva la URL firmada» |
| **A11-BE-1** `asistente/route.ts:63` | `const verDinero = puedeVerArea(sesion.rol,'dinero')` → `= true` | `rol_no_mirado.test.ts` · «el ENCARGADO no recibe comprobado, ni acreditables, ni anomalías» |
| **G-21(c)** `operacion.ts:682` | `if (i.viajeId) await exigirDelTenant(…)` → `if (false && …)` | `operacion.test.ts` · «una incidencia no se levanta contra un viaje ajeno» |
| **G-20** `operacion.ts:579` | `if (!v.operadorId) throw ErrorDeCaptura('sin_chofer')` → `if (false)` | `operacion.test.ts` · «crearViaje sin operador dice qué falta» |

Los cuatro **controles** que puse para demostrar que el arnés sí caza también
murieron: `engine.ts:668` (invertir `input.anticipo - totalComprobado`) → mata
`engine.test.ts`; `pg.ts` (romper la paginación de `traerTodo`) → mata
`negocio_paginacion.test.ts`; `acreditable.ts:151` (vaciar
`RESERVA_IVA_ATADO_AL_ISR`) → mata `acreditable.test.ts`; `negocio.ts:331`
(devolver el teléfono crudo en vez de `seudonimoOperador`) → mata
`negocio_seudonimo.test.ts`.

`tenant-efectivo.test.ts` merece decirse aparte: es **el mejor archivo nuevo del
árbol**. Cubre las cuatro decisiones de la función, cada una con su CONTROL
explícito («sin el control, "redirigir siempre" pasaría y no probaría nada»), y
además afirma que el gate corre **antes** de tocar la base
(`expect(maybeSingle).not.toHaveBeenCalled()`). El CRÍTICO del pase 1 está
cerrado de verdad, no por prosa.

### NO anclan — la mutación sobrevive (4 de los cierres muestreados)

| Cierre | Prueba que dice cerrarlo | Qué sobrevive |
|---|---|---|
| **G-14** «`getViajes` se corta en 100 filas» | `analytics_ventana_y_dia.test.ts` | borrar `.eq('tenant_id', tenantId)` de `getViajes` **y** de `getDocumentos` |
| **G-10** «"del periodo" era "de siempre"» | `ventana_del_periodo.test.ts` | quitar `.gte('created_at', corte)` de `getKpis`; y un off-by-one en `corteVentana` |
| **G-21(b)/(c)** «las siete escrituras del encargado» | `operacion.test.ts` | 3 de las 7: `asignarUnidad` sin tenant en el WHERE, `crearUnidad` sin `tenant_id` en el INSERT, `marcarPodPedido` naciendo `'subido'` |
| **G-51** «dos migraciones con el mismo ordinal» | `migraciones_verificadas.test.ts:137` | nada — pero **hoy no puede fallar**: `supabase/migrations/` no tiene ordinales repetidos, así que la guardia pasa por vacío. Es correcta, y no está ejercida |

`ventana_del_periodo.test.ts` es el caso más ilustrativo: son **dos greps de
`readFileSync` sobre el texto fuente** más el hecho de que `tsc` ahora exige el
segundo argumento. Eso cierra «alguien lo omitió», que era la mitad del bug. La
otra mitad —que el corte se calcule bien y llegue a la consulta— no la toca
nadie: la cobertura confirma que **`analytics.ts:39-42`, el cuerpo entero de
`corteVentana`, nunca se ejecuta**.

### Recuento de la mutación

**37 mutantes aplicados · 1 descartado por mí (era un no-op) · 1 con patrón que
no casó · 35 medidos: 14 murieron, 21 sobrevivieron.** Contra el pase 1
(22 dirigidos al código nuevo, sobrevivieron 22, más 5 controles). Los 21 vivos:
**12 en `analytics.ts`**, 3 en `repo.ts`, 3 en `operacion.ts`, 1 en `guard.ts`,
1 en `dashboard/[id]/page.tsx`, 1 en `supabase/verificaciones.sql`.

---

## Hallazgos

### [CRÍTICO] Cinco lecturas de `analytics.ts` pierden su `.eq('tenant_id', …)` con la suite verde — y una de ellas TIENE prueba nueva que la ejercita y no lo ve · REINCIDENTE

`src/lib/cuadra/analytics.ts:400` (`getViajes`) · `:436` (`getDocumentos`) ·
`:465` (`getGastoPorConcepto`) · `:496` (`getOperadoresDetalle`) · `:97`
(`getStatsPorOperador`) · contra `src/lib/cuadra/analytics_ventana_y_dia.test.ts:33`

**Qué mutación sobrevive.** Borré el `.eq('tenant_id', tenantId)` de las cinco,
una por una. Las cinco: `269 archivos · 2529 pruebas · 1 saltada · exit 0`.

- **`getViajes`** alimenta `/dashboard/viajes`, que esta ronda reclasificó a área
  **`dinero`** (`visibilidad.ts:89`) precisamente porque lista el anticipo. Sin
  el filtro, la tabla pasa a listar los viajes de **todas** las flotas de Likida
  con folio, origen, destino, anticipo y nombre del operador.
- **`getDocumentos`** alimenta la bandeja del Agente OCR: `rfc_emisor`,
  `cfdi_uuid`, `estado_sat` y `efos` de comprobantes de terceros.
- **`getGastoPorConcepto`** (`/dashboard/combustible-casetas`), **`getOperadoresDetalle`**
  (el roster con «Anticipo entregado» y «% comprobado» por chofer) y
  **`getStatsPorOperador`** (diésel por chofer) hacen lo mismo con el gasto y con
  los datos personales del personal de conducción.

**Lo que distingue este hallazgo del mismo del pase 1** es que ahora **sí hay
una prueba nueva sobre `getViajes` y `getDocumentos`** —
`analytics_ventana_y_dia.test.ts`, escrita para cerrar G-14, que les pasa 1,500
y 2,400 filas y verifica que salgan enteras— **y aun así el mutante vive**. La
razón está en su línea 33:

```ts
for (const m of ['select', 'eq', 'order', 'in', 'gte', 'lte', 'is', 'not']) b[m] = self;
```

`eq` es un no-op que devuelve el propio builder. El doble **no puede** observar
qué filtros se aplicaron: es un mock que devuelve lo que la prueba quiere oír.
`analytics.test.ts:33` tiene exactamente el mismo defecto, y además hace `range`
y `limit` no-ops.

**Consecuencia.** Estas lecturas van por `supabaseAdmin()` (service-role), que
salta la RLS del esquema: el `.eq('tenant_id', …)` **es** el aislamiento entre
flotas. Un `.eq` que se cae en un refactor de paginación es un incidente LFPDPPP
con RFC de proveedores y teléfonos de choferes dentro, y hoy nada en el repo lo
detiene. El 6-ago, la pantalla que se enseña es `/dashboard/viajes`.

**Causa raíz.** El patrón que sí funciona está escrito **tres veces** en este
mismo repo: `operacion.test.ts:55` (`eq: (c,v) => { filtros.push([c,v]); … }`),
`negocio_paginacion.test.ts:37-44` (registra `order` y `range` por tabla) y
`repo_operadores.test.ts`. Cuando se escribió el arnés de G-14 se copió el doble
de `analytics.test.ts` —que nació para un CRÍTICO de *fail-closed* y solo
necesitaba devolver `{data,error}`— en vez del de al lado.

---

### [CRÍTICO] `getKpis` no tiene una sola aserción de valor: dupliqué el comprobado de la flota e invertí la tasa de cuadre, y la suite no parpadeó · REINCIDENTE

`src/lib/cuadra/analytics.ts:72` (`montoComprobado`) · `:65` (`tasaCuadre`) ·
`:68` (`diferenciaDetectada`) · contra `src/lib/cuadra/analytics.test.ts:59,220`

**Qué mutación sobrevive.**

- `montoComprobado: round2(rows.reduce(…))` → `round2(rows.reduce(…) * 2)`.
  **Verde.** Con las 12 liquidaciones y $47,300 comprobados que el propio
  `rol_no_mirado.test.ts:40` usa como cifra de ejemplo, el panel y el rail
  imprimirían **$94,600.00** bajo «Comprobado del periodo». Es el número que el
  contralor cruza contra su contabilidad.
- `rows.filter((r) => r.estatus === 'cuadrada')` → `!== 'cuadrada'`. **Verde.**
  Con 9 de 12 cuadradas, la tasa pasa de **75 %** a **25 %**.
- `difs.filter((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado')` →
  sin filtro. **Verde.** `diferenciaDetectada` —«dinero recuperado/observado»—
  empieza a sumar el `monto` de diferencias que no son de dinero.

**Cómo lo confirma la cobertura.** A `getKpis` la suite entera solo le da dos
entradas: `{data: null, error}` (`analytics.test.ts:60`) y `{data: [], error:
null}` (`:220`). Nunca filas reales. El reporte de v8 lo dice sin ambigüedad:
**`analytics.ts:67-68` —el reductor de `diferenciaDetectada`— tiene 0
ejecuciones**, porque ningún caso llega con un `diferencias` no vacío.

**Consecuencia.** Es el hallazgo que contradice la regla que define al producto
(«nunca inventar una cifra»). La tarjeta grande del panel, la del rail y la tasa
de cuadre se pueden mover en un refactor y el primero en enterarse es el
contralor, en la sala.

---

### [ALTO] El cierre de «un rótulo tiene que ser verdad» (G-10) se ancló con un grep de texto: `corteVentana` no se ejecuta ni una vez en toda la suite

`src/lib/cuadra/analytics.ts:37-42` · `:59` · `:237` · contra
`src/app/dashboard/ventana_del_periodo.test.ts`

**Qué mutación sobrevive.**

- Quitar el ternario de `getKpis`: `(corte ? q.gte('created_at', corte) : q)` →
  `q`. **Verde.** La consulta vuelve al histórico completo bajo el rótulo «del
  periodo», que es literalmente el bug que G-10 cerró.
- Off-by-one en el corte: `d.setUTCDate(d.getUTCDate() - (ventanaDias - 1))` →
  `- (ventanaDias + 1)`. **Verde.** Con `ventanaDias = 7` un 2026-08-05, el corte
  correcto es `2026-07-30T00:00:00Z`; con el mutante es `2026-07-28`. La pestaña
  «7 días» pasa a contar **nueve**, y el panel no tiene forma de contradecirse a
  sí mismo.

**Por qué sobreviven.** `ventana_del_periodo.test.ts` hace dos cosas, las dos
sobre `readFileSync`: cuenta los argumentos de cada llamada a
`get(Kpis|Acreditables)\(([^)]*)\)` con una expresión regular, y comprueba que
ninguna pantalla que pase `null` literal contenga la cadena «del periodo». Eso
cierra «alguien omitió el argumento» —que `tsc` ya cierra por su cuenta desde
que el parámetro es obligatorio— y nada más. La cobertura lo confirma:
**`analytics.ts:39-42` figura con 0 ejecuciones**; `corteVentana` solo se llama
con `ventanaDias = null`, que sale por el `return null` de la línea 38.

**Consecuencia.** El cierre está en la lista de los 49 y la aritmética que
sostiene los dos rótulos «DEL PERIODO» del panel no tiene un solo `expect`.

---

### [ALTO] Tres de las siete escrituras del encargado siguen sin una aserción sobre lo que escriben — incluida la que marca un POD como entregado sin papel · REINCIDENTE PARCIAL

`src/lib/cuadra/operacion.ts:630` (`asignarUnidad`) · `:655-656` (`crearUnidad`) ·
`:384` (`marcarPodPedido`) · contra `src/lib/cuadra/operacion.test.ts`

**Qué mutación sobrevive.**

- **`asignarUnidad`**: `.eq('id', viajeId).eq('tenant_id', tenantId).select('id')`
  → `.eq('id', viajeId).select('id')`. **Verde.** Existe la prueba «asignar
  unidad a un viaje que no es de esta flota lanza» (`:443`), pero su montaje es
  `TABLAS = { …, viaje: [] }` —la fila simplemente no está—, así que pasa igual
  con el `.eq` puesto o quitado. Con el mutante, un encargado que adivine (o vea
  en un log) un `viaje.id` ajeno le empata una unidad suya a un viaje de otra
  flota.
- **`crearUnidad`**: fuera `tenant_id: tenantId` del INSERT. **Verde.** Las dos
  únicas pruebas que la llaman (`:406`, `:418`) le inyectan un fallo y afirman el
  mensaje; **el payload del camino bueno no se mira nunca**. La unidad nace sin
  dueño.
- **`marcarPodPedido`**: `estado: 'pendiente'` → `'subido'`. **Verde.** La única
  prueba que la llama sin error (`:462`) verifica que NO escriba cuando el chofer
  es de otra flota. El POD queda marcado como **entregado** sin que nadie haya
  subido un papel, y `getTableroOperacion` y `getCargaOperadores` cuentan
  `estado === 'subido'` como evidencia buena: el tablero del encargado reporta
  **0 PODs pendientes** — el cero mentiroso que ese archivo entero dice existir
  para evitar.

**Lo que sí mejoró, y hay que decirlo.** `operacion.test.ts` pasó de 3 a 7
escrituras cubiertas y de 84.9 %/68.8 % a **96.74 % de líneas / 95.65 % de
funciones**. Los tres bloques nuevos (G-21 a/b/c) son buenos: traducen el 23505
por nombre de índice, afirman que un UPDATE que no empató nada **lanza**, y que
un id ajeno no llega a escribirse. Mi crítica es a las tres columnas que quedaron
sin `expect`, no al archivo.

---

### [ALTO] `npm run test:coverage` —el último paso del CI— sale en **exit 1** de forma reproducible aquí, y las pruebas que fallan **cambian entre corridas**

`src/lib/cuadra/intake/ocr_imagen_cara.test.ts:70,81,90` ·
`.github/workflows/ci.yml` (paso «Trinquete de cobertura») · `vitest.config.ts:13`

**Escenario, con valores.** Dos corridas consecutivas del comando exacto del CI:

- Corrida 1: fallan las pruebas **1 y 2** («una foto de 24 Mpx se acota…»,
  5083 ms → `Test timed out in 5000ms`; y «la foto típica de WhatsApp pasa
  INTACTA», que compara base64 y recibe el de la foto anterior).
- Corrida 2: fallan las pruebas **1 y 3** («…se acota», 5150 ms; y «el lado corto
  se mantiene en proporción», 2135 ms).

En las dos, el proceso muere después con
`Unhandled Rejection · ENOENT: … /coverage/.tmp/coverage-145.json` (y `-235.json`),
así que **el reporte de cobertura no se imprime y el umbral nunca llega a
evaluarse**: el rojo no dice «entró código sin prueba», dice otra cosa.

La causa es de reloj: `vitest.config.ts:6-13` documenta que la instrumentación de
v8 falsea el tiempo y por eso exporta `CUADRA_COBERTURA`, y **dos** pruebas de
tiempo se saltan con esa bandera (`fundamento.test.ts:125` y
`duplicados.test.ts:151` — la corrida instrumentada reporta 3 saltadas contando
el arnés de ticket). `ocr_imagen_cara.test.ts` —que
redimensiona con `sharp` una imagen de 5 657 × 4 243 px— **no lleva la bandera ni
un `testTimeout` propio**, y bajo `--coverage` cruza los 5 000 ms por default. La
prueba número 2 falla **por arrastre**: la 1 se corta a mitad, su
`extraerComprobante` sigue vivo y ensucia `generateStructured.mock.calls[0]`
después del `mockReset` del `beforeEach` siguiente.

La demostración de que es solo el reloj: `npx vitest run --coverage
--testTimeout=60000` —única diferencia— sale **exit 0** con
`84.19 % / 85.03 % / 85.56 %`.

**Consecuencia.** Hoy el runner de GitHub gana la carrera (el paso completo tarda
57 s y sale verde), así que es un **rojo latente, no uno actual**: basta un runner
cargado, o la siguiente foto que alguien agregue al arnés, para que el paso que
protege la cobertura se ponga rojo por una razón que no es la cobertura. Es
exactamente el modo de fallo que `bc7fc86` reorganizó `ci.yml` para evitar
—«cuando este paso sea el único rojo, el diagnóstico es inmediato»— reabierto por
otra puerta. Y `pruebas_en_ci.test.ts`, que vigila que ningún `skipIf` quede fuera
del comando dedicado, no puede ver esto: el archivo no tiene `skipIf`.

---

### [MEDIO] `exigirVerRuta` —el segundo chokepoint, seis páginas— sigue sin una sola prueba · REINCIDENTE LITERAL

`src/lib/auth/guard.ts:81` · `src/lib/auth/guard.test.ts` (no lo nombra)

**Qué mutación sobrevive.** `if (!puedeVerRuta(s.rol, destino)) redirect(inicioDe(s.rol));`
→ `if (false && …)`. **Verde.** `guard.test.ts` tiene 11 pruebas repartidas en
`requireSessionTenant`, `requireOperador` y `requireSuperadmin`; **`exigirVerRuta`
no aparece ni una vez** (grep verificado sobre el archivo de hoy).

Es el gate de las páginas que no pasan por `resolverTenantEfectivo`:
`/dashboard/rentabilidad`, `/dashboard/cobranza`, `/dashboard/clientes`,
`/dashboard/cotizador`, `/dashboard/mapa`, `/dashboard/soporte` — las cuatro
primeras son área `dinero`. Con el mutante, el jefe de tráfico vuelve a ver
rentabilidad y cobranza de la flota tecleando la URL.

`guardas_de_pagina.test.ts` comprueba que cada `page.tsx` **nombre** una de las
tres guardas; no que la guarda haga algo. Es la distinción exacta que el pase 1
llamó «la matriz se prueba, el `if` que la consulta no», y aquí `visibilidad.ts`
está al **100 % de líneas y de funciones** mientras uno de sus tres consumidores
se puede anular entero.

---

### [MEDIO] El gate de `dinero` del detalle de liquidación se borra con la suite verde

`src/app/dashboard/[id]/page.tsx:49`

**Qué mutación sobrevive.** `if (!puedeVerArea(rol, 'dinero')) redirect(inicioDe(rol));`
→ `if (false && …)`. **Verde.** `/dashboard/[id]` es una ruta dinámica y por eso
no puede estar en `AREA_POR_RUTA`: su gate se escribe a mano ahí. Un `encargado`
con el UUID de una liquidación abre el detalle completo —anticipo, comprobado,
diferencia, desglose de IVA/IEPS y el PDF.

Hay un archivo que sabe de esta línea: `dashboard/[id]/reasignar.test.ts:9` la
cita en su cabecera («El auditor cambió `dashboard/[id]/page.tsx:51` a…»). Cita
el hallazgo y prueba otra cosa. `page.tsx` está excluido de la medición de
cobertura a mano (`vitest.config.ts`), así que el hueco tampoco aparece en el
porcentaje. REINCIDENTE del pase 1 (M20).

---

### [MEDIO] `repo.ts` es el archivo con la peor cobertura del camino del dinero (65.73 % L / 69.23 % F) y tres mutaciones suyas sobreviven, una de ellas fiscal

`src/lib/cuadra/repo.ts:75` (`getOperador`) · `:419` (`updateGastoCfdiXml.monto`) ·
`:433` (`updateGastoCfdiXml` WHERE)

**Qué mutación sobrevive.**

- `getOperador`: fuera `.eq('tenant_id', tenantId)`. **Verde.** Es la función que
  resuelve nombre y **teléfono** del chofer.
- `updateGastoCfdiXml`: fuera `.eq('tenant_id', tenantId)` del UPDATE. **Verde.**
  Un XML pegado por WhatsApp reescribe un `gasto` de otra flota si el id coincide.
- `updateGastoCfdiXml`: `if (x.total != null && x.total > 0) extra.monto = x.total;`
  → `if (false)`. **Verde.** Ese `if` es la regla de que **el total del CFDI
  timbrado manda sobre el que leyó la visión**. Con el mutante, un ticket cuyo OCR
  leyó $1,000 conserva $1,000 aunque el XML diga $1,160, y esa cifra entra al
  cuadre y al PDF. La cobertura confirma que las líneas 406-445 del archivo no se
  ejecutan nunca.

Lo que **sí** está anclado en `repo.ts` y lo comprobé: `saveLiquidacion`
—la escritura del dinero, el RPC `guardar_liquidacion_tx`— tiene arnés propio
(`repo_escritura.test.ts:86-151`) que verifica los doce parámetros, el `pdf_url`
y que un deadlock lance. La escritura del dinero **no** está desarmada; lo que
está desarmado es el camino que la alimenta.

---

### [MEDIO] `migraciones_verificadas.test.ts` sigue midiendo que alguien escribió un TÍTULO, y el bloque de la RLS del chofer nunca se corrió · REINCIDENTE

`src/lib/cuadra/migraciones_verificadas.test.ts:39-42` ·
`supabase/verificaciones.sql:986` (bloque 26) · `:1068` (bloque 28)

**Qué mutación sobrevive.** Metí un `raise exception 'CUERPO BORRADO POR LA
AUDITORIA'` como primera sentencia del bloque 28 —el de la 0047, el que comprueba
que `unidad`/`mantenimiento`/`incidencia`/`pod` no se le abran al chofer—
dejando el título intacto. **Verde**, las 5 pruebas del archivo. La guardia lee
solo las líneas que casan `/^-- ── \d+\./`.

**Lo que mejoró:** el archivo ganó una prueba nueva y correcta («ningún ordinal
nombra dos migraciones distintas», `:137`), que convierte en rojo el choque
0046/0047 del PR #7. Hoy **no puede fallar** porque `supabase/migrations/` quedó
intacto en 0047 sin duplicados: está bien escrita y sin ejercer.

**Lo que sigue igual:** el bloque **26 (mig. 0045)** —el que sostiene todo
`/mis-viajes`, la RLS del chofer— **no tiene una sola salida registrada** en el
archivo. Los bloques 27 y 28 sí («escribe-en-carpeta-ajena=f»,
«unidades=0 … pod-ajeno-por-id=0», del 3-ago). El 20, 24 y 25 tampoco.

---

### [MEDIO] Dos de los cierres nuevos se eximen a sí mismos del archivo que todavía tiene el defecto

`src/lib/cuadra/liquidacion/reserva_una_sola_fuente.test.ts:72` contra
`src/app/dashboard/acred.tsx:101` · y
`src/lib/auth/visibilidad_dinero.test.ts:45` contra `/dashboard/operadores`

**Escenario.** `reserva_una_sola_fuente.test.ts` (cierre G-05) es un grep-test que
prohíbe que ningún archivo de `src/` reescriba a mano la reserva fiscal, y
declara una excepción: `const PENDIENTE_OTRO_DOMINIO = ['src/app/dashboard/acred.tsx']`,
con el comentario «Cuando `acred.tsx` importe la constante, esta línea se borra».
No se borró: `acred.tsx:101` sigue escribiendo el literal
`' — sujeto a elegibilidad'`, que es exactamente el valor de `RESERVA_PEAJE`
(`acreditable.ts:80`). Son **cuatro** copias del mismo dictamen fiscal, y el
commit que dice cerrar el problema deja la cuarta fuera del detector.

Lo mismo, con más honestidad, en `visibilidad_dinero.test.ts:45`:
`/dashboard/operadores` sigue pintando pesos en un área que ve el encargado, y
la prueba lo declara «residual conocido» con una tercera prueba que afirma que la
lista no crece. Ese sí está bien construido —el trinquete se ve— pero conviene no
contarlo como cerrado.

**Consecuencia.** Un grep-test con lista de perdón sigue siendo verde el día que
las dos copias divergen, que es el escenario que CLAUDE.md llama «una cifra
fiscal que se lee distinto en dos pantallas se lee como dos cálculos».

---

### [BAJO] `getEquipo()` — la única lectura cruzada de tenants sin paginar, y al 0 % de cobertura

`src/lib/admin/negocio.ts:404-420`

**Escenario.** Es la consulta de `/admin/equipo`: trae `id, tenant_id, rol,
nombre, email, operador_id` de **toda** la tabla `app_user`, de todas las flotas.
No usa `traerTodo` ni `.range()`, así que PostgREST la recorta en silencio en la
fila 1,000 — el borde que `negocio_paginacion.test.ts` cerró para las otras cinco
consultas del archivo y que este quedó fuera. Cobertura: **0 % de líneas**;
ningún `*.test.ts` la importa. Con menos de 1,000 usuarios no cambia nada hoy;
es la pieza que hace falsa la afirmación de que la consola ya no se congela.

---

## Lo que revisé y está bien

- **El núcleo del dinero sigue anclado, y lo comprobé rompiéndolo.** Invertir
  `input.anticipo - totalComprobado` (`engine.ts:668`) mata pruebas en tres
  archivos. `engine.ts` está al **100 % de líneas y de funciones**, `pg.ts`
  también, `duplicados.ts` también, `presupuesto.ts` al 100/90.9,
  `cuadre/resumen.ts` y `liquidacion/acreditable.ts` al 100/100.
- **La escritura del dinero tiene arnés.** `saveLiquidacion` (el RPC atómico
  `guardar_liquidacion_tx`) se prueba parámetro por parámetro en
  `repo_escritura.test.ts`, incluido el `p_pdf_url` y el deadlock.
- **`tenant-efectivo.test.ts` cierra el CRÍTICO del pase 1 de verdad**, con
  controles explícitos y con la aserción de que el gate corre antes de tocar la
  base. Es el modelo a copiar.
- **`autorizacion.test.ts` (×2), `rol_no_mirado.test.ts` y `no_autoregistro.test.ts`
  son pruebas de comportamiento, no de texto.** Las tres tienen bloque de
  CONTROL escrito («sin estos, "responder 403 siempre" pasaría las de arriba»),
  que es lo que impide el arnés que se auto-satisface. `no_autoregistro.test.ts`
  dejó de ser tres greps y ahora EJECUTA los server actions; `una_sola_copia.test.ts`
  ata `page.tsx` a `acciones.ts` para que no vuelvan a divergir — es el cierre
  correcto de la trampa que el `RESULTADO.md` documenta.
- **`/admin` dejó de no tener pruebas.** Pasó de cero archivos a ocho
  (`fases`, `gate`, `consola_render`, `frontera_datos`, `mi-perfil/acciones`,
  `notificaciones_leidas`, `roles_y_mensajes`, `ui/graficas`), y
  `frontera_datos.test.ts` mide una regla arquitectónica que antes solo vivía en
  un comentario.
- **`negocio_paginacion.test.ts` es la prueba mejor construida del lote nuevo**:
  su doble de PostgREST recorta a 1,000 en el `then` y registra `range` y `order`
  por tabla, así que puede ver el bug que persigue. Es el patrón que le falta a
  `analytics.test.ts`.
- **Ninguna prueba depende de la red.** Los que tocan `fetch` lo hacen con
  `vi.stubGlobal`/mock. La única saltada de la suite sigue siendo
  `arnes_ticket_real.test.ts` (`describe.skipIf(GRUPOS.length === 0)`). **No corrí
  ningún `pruebas-manuales/*.prueba.ts`** ni `npm run build`.
- **Ninguna prueba depende de la hora de forma frágil**, salvo la de cobertura del
  ALTO de arriba, que depende del reloj de la máquina y no de la del día. Los
  `Date.now()` restantes son umbrales deliberados con `skipIf(CUADRA_COBERTURA)`,
  y `pruebas_en_ci.test.ts` vigila que el comando dedicado del YAML los alcance.
- **La suite no perdió pruebas por comodidad**: 172→269 archivos y 1670→2530
  pruebas, con `vitest.config.ts` byte-idéntico y los umbrales sin tocar. Nadie
  bajó el medidor.

---

## Lo que NO alcancé a revisar

- **No tengo Postgres.** Todo lo que digo de `supabase/verificaciones.sql` sale de
  leer el SQL y sus bitácoras. No corrí un solo bloque, y en particular no
  comprobé que la salida registrada del bloque 28 corresponda al SQL de hoy.
- **Muestreé 14 de los 49 cierres**, elegidos por dinero y por autorización. Los
  35 restantes —notablemente los de `processor.ts` (el «va» que adjuntaba
  comprobantes de ayer, `e305a08`), los de `periodo/combustible.ts` y los de
  `intake/almacen.ts`— no los mutá. `processor.ts` está al 89.31 % de líneas y sus
  arneses son grandes; no espero sorpresas, pero no lo medí.
- **No mutá `src/proxy.ts`, `provisionar.ts`, `auth/callback/route.ts` ni
  `tools.ts`.** Los cuatro salen bien en cobertura (`tools.ts` al 98.67/100), pero
  cobertura no es protección y no lo comprobé.
- **`src/app/dashboard/**/vista.tsx` e `inicio-operacion.tsx` están al 0 % de
  líneas** (155, 151, 128, 105 líneas cada uno). Son componentes de cliente y el
  rubro de frontend los cubre por otro camino; los nombro para que no se lean
  como cubiertos.
- **No evalué `npm run build`** (prohibido por el mandato). Sí verifiqué que el
  paso de Build del CI pasó en el runner de GitHub sobre esta rama.
- **Los mutantes M19p2, M20p2 y los de `lote3` corrieron después de las 11:47**,
  cuando otros agentes ya escribían en `src/`. `mutar.py` copia el archivo objetivo
  desde el árbol real antes de mutar, así que esos tres pudieron ver un
  `guard.ts` recién tocado. Los tres resultados son consistentes con el pase 1 y
  con el grep directo (`guard.test.ts` no nombra `exigirVerRuta` ni antes ni
  ahora), pero lo digo en vez de esconderlo.

---

## Estado del árbol al terminar

**No mutá el árbol de trabajo ni una vez.** Copié el repo a
`/tmp/mutacion-pruebas` (`tar` sin `.git` ni `node_modules`, con `node_modules`
enlazado por symlink), y `mutar.py` solo escribe **dentro de esa copia**:
restaura copiando **desde** el árbol real **hacia** la copia, nunca al revés.
Las 37 corridas de `npx vitest run --bail=1` se ejecutaron con `cwd` en la copia.

Comprobación al cerrar:

```
$ git status --short
?? docs/auditoria-11/pruebas.md      ← el único archivo que escribí
```

(Lo que aparezca además bajo `src/` no es mío: a partir de las 11:47 los agentes
de arreglo del pase 2 empezaron a trabajar sobre este mismo árbol —`c02f0c4`,
`ceb1a13`, y modificaciones en vuelo en `export/liquidaciones/route.ts`,
`export/pdf/[id]/route.ts` y `guard.ts`—. No reverto nada de eso.)

Grep de control, corrido sobre `src/` y `supabase/` al terminar, con los siete
patrones más distintivos de mis mutantes — `if (false && !puedeVerRuta`,
`if (false) return null`, `if (false && !(await dentroDelLimite`,
`if (false && !puedeVerArea`, `area === undefined || puedeVerArea`,
`MINUTOS_CAPTURA_MANUAL = 40`, `CUERPO BORRADO POR LA AUDITORIA`: **los siete
ausentes**.
