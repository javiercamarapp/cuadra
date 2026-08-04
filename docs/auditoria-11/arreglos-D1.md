# Arreglos D1 — panel del cliente y su capa de datos

Rama `claude/auditoria-11`. Compuerta al terminar: `npx vitest run` → **269
archivos · 2,519 pruebas · 1 saltada, exit 0** · `npx tsc --noEmit -p .` → exit 0
· `npx eslint` sobre el dominio → limpio.

Cada línea: qué se cerró, con qué prueba, y qué quedó fuera del dominio.

| Grupo | Estado |
|---|---|
| **G-05** (mitad de D1) | **CERRADO** (prueba: `src/app/dashboard/peaje_condicionado.test.tsx`, describe nuevo). Las pruebas del PR #7 ejercían `acred.tsx`, un componente que `master` dejó de montar: la pantalla real seguía diciendo «Peaje (50%) · LIF 2026, Art. 20-A» sin ninguna de las cuatro condiciones. `dashboard/page.tsx` y `facturacion/page.tsx` consumen ahora `ETIQUETA_PEAJE_CORTA` y `NOTA_PEAJE_PANEL` del motor (D2), no una cadena propia. |
| **G-09** | **CERRADO** (prueba: `src/app/dashboard/kpi_sin_medicion.test.tsx`). `KpiTile.valor` pasa a `number \| null` y pinta «—» en tinta apagada; `getAcreditables` devuelve `liquidaciones` (cuántas filas entraron en la suma) y `dashboard/medicion.ts` decide qué se puede afirmar y qué falta. Corregidos los consumidores de `/dashboard`, `facturacion` y `combustible-casetas` (incluido `acred?.litrosDiesel ?? 0`, que vivía fuera de su guard). **Fuera de dominio:** `incidencias/vista.tsx` (`mediana ?? 0`) es de D5 y ya compila contra el tipo nuevo. |
| **G-10** | **CERRADO** (prueba: `src/app/dashboard/ventana_del_periodo.test.ts` + `rail_no_afirma.test.tsx`). `ventanaDias` es obligatorio en `getKpis`/`getAcreditables` (`number \| null`, donde `null` es "histórico, a propósito"): `tsc` caza al que lo omita. `dashboard/ventana.ts` resuelve el rango UNA vez y lo comparten la página y `/api/dashboard/asistente`; el rail manda el `?rango=` de la URL y contesta nombrando el periodo. Los rótulos de las pantallas sin filtro dicen «todo el histórico». |
| **G-11** | **CERRADO** (prueba: `src/app/dashboard/encabezado_sin_dato.test.tsx`). `CifraGrande` y `AvanceCierre` aceptan `null` y dicen que no se pudo leer, en vez de `$0.00` y «No hay viajes iniciados» encima del cartel que avisa que no se leyó nada. |
| **G-12** | **CERRADO** (prueba: `src/app/dashboard/filtro_rango.test.tsx`). `pordefecto="30"` contra un default de `'7'`: el clic en 30d no escribía el parámetro. Ahora el `pordefecto` sale del mismo módulo que resuelve el rango, y la prueba exige que coincidan en cada página que monta el filtro. |
| **G-13** | **CERRADO en el dominio** (prueba: `src/app/dashboard/contraste_citas_legales.test.ts`, que DESCUBRE los tokens usados como `color:` en vez de llevar lista). El pie de todos los `KpiTile` (las citas de LIF/LIVA y el supuesto de `MINUTOS_CAPTURA_MANUAL`), el subtítulo de `ChartCard` y la nota de `CifraGrande` dejan `--faint` (2.56:1) por `--muted` (4.83:1). **PENDIENTE fuera de dominio:** el VALOR de `--faint` en `src/app/globals.css` y sus 5 usos en `src/app/admin/ui/graficas.tsx`. |
| **G-14** | **CERRADO** (prueba: `src/lib/cuadra/analytics_ventana_y_dia.test.ts`). `getViajes` y `getDocumentos` pasan por `traerTodo` (eran `limit(100)` y `limit(1000)` — el `max_rows` exacto de PostgREST); el día de `getLiquidacionesPorDia` se agrupa en hora de México. La tabla de `documentos` sigue pintando 100 filas y ahora lo dice con el total real. |
| **G-15** | **CERRADO** (prueba: `src/app/dashboard/mapas_de_etiqueta.test.ts`). `documentos/estado-sat.ts` traduce los CUATRO `EstadoSat` con `Record<EstadoSat, …>` (`no_encontrado` deja de salir en ámbar y en crudo: es la misma cubeta de no deducible que `cancelado`); `usuarios/page.tsx` usa `etiquetaRol`. **YA CERRADO por `989ca62`:** la tercera copia de `ESTATUS` en `/mis-viajes` y el `TonoDeducibilidad` de `[id]/page.tsx` (hoy `deducible.tsx`). **Fuera de dominio:** `viajes/page.tsx` (`SIN_CERRAR`) es de D5. |
| **G-16** | **YA CERRADO por `989ca62`** — `mis-viajes/page.tsx` distingue `comprobado: null` de `$0.00` y filtra el semáforo del contralor con `SOLO_CONTRALOR`. |
| **G-17** | **CERRADO en el dominio** (prueba: `src/app/dashboard/sidebar_marco.test.tsx`). El link activo del sidebar lleva `aria-current="page"` (había CERO en todo el producto) y, debajo de `lg` —donde `MARCO_SIDEBAR` mide 72 px—, los 23 nombres y los encabezados de sección se retiran y queda el ícono con su `title`. **YA CERRADO por `2e332ae`:** los `<th scope>`. **Fuera de dominio:** los 292 px muertos de `/admin` (D6). |
| **G-25** | **CERRADO** (pruebas: `src/app/api/dashboard/asistente/falla_cerrado.test.ts`, `src/app/dashboard/rail_no_afirma.test.tsx`, `src/app/dashboard/rail_gate_rol.test.tsx`). El handler discrimina `motivo: 'ok' \| 'error' \| 'sin-permiso'` y responde **503** cuando la lectura falló (era 200 con nulos); `chat.tsx` deja de contestar «Todavía no hay liquidaciones» a un fallo de lectura o a un rol sin acceso; el recuadro verde de "todo bien" ya no se pinta cuando lo que falló fue el detector de anomalías; y `chrome.tsx` monta el rail solo para quien puede ver dinero (segunda capa sobre el gate de `2fb1982`). |
| **G-32** | **CERRADO como owner** (prueba: `src/lib/cuadra/pg_safelog.test.ts`). `safeLog()` vive en `src/lib/cuadra/pg.ts`: registra con `logger.error` y devuelve `null`. Sustituidas las 9 copias de este dominio más la del handler del rail; el `catch` mudo de `analytics.reconstruir` ahora deja línea. El grep-test exige que los infractores sean subconjunto de una lista explícita. **PENDIENTE en otros dominios:** las 6 copias de D5 (`despacho`, `incidencias`, `pod`, `unidades`, `viajes`, `operadores`) y `intake/cfdi_xml.ts` (D4) — están anotadas en `PENDIENTES` de esa prueba y basta cambiar el import. |
| **G-41** | **CERRADO** (prueba: `src/lib/cuadra/valor_ahorro_honesto.test.ts`). «Amarrados a su viaje» cuenta `resolucion = 'adjuntado'` (antes contaba `resuelto_en`, que también se llena al DESCARTAR) y los descartados se enseñan aparte; los envíos de WhatsApp dejan de contarse como «acciones resueltas por los agentes». |
| **G-46** | **CERRADO la parte de D1** (prueba: `src/app/dashboard/fases_una_sola_fuente.test.ts`, verificada reintroduciendo la copia). La quinta copia de `FASE_LABEL` —la única en el panel del CLIENTE— se retira; `valor-ahorro` importa el mapa tipado de `admin/fases.ts`. El guardarraíl que existía solo barría `src/app/admin/`; este barre `/dashboard`. |
| **G-47** | **CERRADO como owner** (prueba: `src/app/dashboard/ver_como_rol.test.ts`). `sufijo.ts` arrastra `?rol=` además de `?tenant=`/`?vista=` y exporta el tipo `SearchParamsPanel`, que declaran las 10 páginas de este dominio; corregido además el único link desnudo del panel (`analitica` → `/dashboard/cuadre`). **PENDIENTE en D5:** `viajes/page.tsx` y `operadores/page.tsx` (anotadas en `PENDIENTES` de la prueba; es una línea en el tipo). |
| **G-52** | **CERRADO** (pruebas: `src/lib/cuadra/pg_acotada.test.ts`, `src/app/dashboard/max_duration.test.ts`). `traerTodo` pasa cada página por `acotada()` (el tope de consulta de `presupuesto.ts`, importado, no reescrito) y las 16 páginas dinámicas del dominio más la ruta del rail declaran `maxDuration`. **PENDIENTE en D5:** las 6 páginas de operación (anotadas en `PENDIENTES`). |
| **G-56** | **YA CERRADO por `989ca62`** en `/login` y `/mis-viajes`. La ampliación que el plan dejaba a D1 está hecha: el marco de `/dashboard` enlaza el aviso de la FLOTA (`/aviso/<tenant>`) en las 20 páginas (prueba: `rail_gate_rol.test.tsx`). |

## Lo que necesita salir del dominio (no se tocó)

1. **`src/app/globals.css`** — `--faint: #a1a1aa` mide 2.56:1. Se retiró de las
   piezas del panel del cliente, pero sigue sirviéndose a
   `src/app/admin/ui/graficas.tsx` (5 usos). El valor honesto es el de
   `--muted` (#6b7280) o un gris equivalente; la prueba que lo mediría ya está
   escrita y solo hay que ampliarle el alcance.
2. **D5 · las 6 páginas de operación** — les faltan tres cambios de una línea
   que este dominio ya publicó: importar `safeLog` (G-32), tipar `rol?` en
   `searchParams` (G-47) y declarar `maxDuration` (G-52). Cada uno está
   anotado en el `PENDIENTES` de su prueba, así que quitar el nombre de la
   lista sin hacer el cambio pone la suite en rojo.
3. **D4 · `src/lib/cuadra/intake/cfdi_xml.ts`** — su `catch { return null }` es
   un VEREDICTO ("esto no es un CFDI"), no un fallo de lectura; conviene que su
   dominio decida si se queda o se registra.
4. **D5 · `incidencias/vista.tsx:49-52`** — `mediana ?? 0` compila contra el
   `KpiTile` nuevo, pero sigue afirmando un cero que su propio comentario dice
   que no se puede afirmar. Pasar `mediana` a secas lo cierra.
