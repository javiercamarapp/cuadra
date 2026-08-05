# Frontend — auditoría 11

**Nota: 5/10** (antes 6). Razón del movimiento: **deuda que cobró factura**. La
nota de 6 se puso sobre el árbol del PR #7, con los arreglos dentro. Aquí no
están: `acred.tsx` y `acred_sin_litros.test.tsx` **no existen en `master`**
(`git branch --contains 5365ca0` → solo `claude/auditoria-10`), así que el
CRÍTICO del 2-ago está **reabierto y peor** —tres tarjetas en vez de una, y la
de litros ahora con borde de acento—. Encima, los 40 commits nuevos levantaron
20 páginas sobre esa base sin lint ni prueba de render propia, y metieron tres
mentiras de rótulo nuevas: un filtro que ignora el clic, cuatro pantallas que
llaman "IVA acreditable" a tres ventanas de tiempo distintas, y el token con el
que se pintan TODAS las citas legales del panel midiendo 2.56:1.

No baja de 5 porque lo nuevo, mirado de cerca, es honesto donde importa: las
ocho páginas nuevas declaran lo que no tienen (`SeccionPendiente`,
`EstadoVacio`) en vez de fingirlo, los mapas de la operación (unidad,
incidencia, POD, viaje) cubren **100%** de los dominios de la 0047, y ninguna
cifra sale mal *formateada* — `lib/formato.ts` aguanta.

**El riesgo mayor del rubro, hoy:** `KpiTile` —el componente por el que pasan
las 60 cifras de los dos paneles— **no sabe decir "no lo medí"**. Siempre
imprime el número. Por eso "IVA acreditable **$0.00**" con LIVA art. 5 debajo, y
"Diésel elegible **0 L**" con LIF 20-A debajo, son lo primero que el contralor
ve si el panel se proyecta antes de la liquidación en vivo.

---

## Hallazgos

### [CRÍTICO · REINCIDENTE, REABIERTO] `KpiTile` siempre imprime el número: tres tarjetas fiscales y la mediana de incidencias afirman una medición que nunca ocurrió

`src/app/admin/ui/kit.tsx:59` (`<div className="text-xl …">{fmt(mostrado)}</div>`
— sin rama para "no hay dato"; `vacio` y `nota` en `:64` y `:71` solo añaden
texto **debajo** del número, nunca lo sustituyen) ·
`src/app/dashboard/page.tsx:238-240` (Diésel elegible, `formato="litros"`,
**`destacar`**) · `:241-243` (IVA acreditable) · `:244-246` (Peaje 50%) ·
`src/app/dashboard/combustible-casetas/page.tsx:83-85`
(`valor={acred?.litrosDiesel ?? 0}`) ·
`src/app/dashboard/facturacion/page.tsx:93-101` (las mismas tres) ·
`src/app/dashboard/incidencias/vista.tsx:49-52`.

**Escenario 1, con los datos que hay hoy y sin ninguna falla.** Las tres
liquidaciones de siembra (`supabase/seed.sql:145-149`) se insertan **sin**
`iva_acreditable`, `peaje_acreditable` ni `litros_diesel_acreditables`, y las
tres columnas son `not null default 0` (`0007_acreditamiento.sql:10-11`,
`0021_liquidacion_litros_diesel.sql:13`). Son de `current_date - 1` y `- 2`, o
sea dentro de la ventana de 7 días por defecto. `getAcreditables`
(`analytics.ts:204-211`) suma tres ceros reales, `estadoPanel` devuelve
`'datos'` (hay 3 liquidaciones), y el panel pinta con total confianza:

| Tarjeta | Lo que imprime | La cita que va debajo, en `--faint` |
|---|---|---|
| Diésel elegible para el estímulo | **`0 L`** *(con borde de acento)* | LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente |
| IVA acreditable | **`$0.00`** | LIVA, Art. 5 — CFDI con IVA desglosado |
| Peaje (50%) | **`$0.00`** | Estímulo de autopistas · LIF 2026, Art. 20-A |

`0 L` **no significa** "esta flota no compró diésel elegible": significa "no
hay ninguna liquidación con ese dato". Un CFDI de diésel de $4,200 del propio
seed trae 113 litros y $581.38 de IVA (`seed.sql:126,135`).

**Escenario 2, el que no depende del seed.**
`combustible-casetas/page.tsx:83` usa `acred?.litrosDiesel ?? 0` **fuera** del
guard de esa consulta (el guard de `:73` es de `porConcepto`, otra consulta).
Si `getAcreditables` truena y `getGastoPorConcepto` no, la pantalla queda:
"Gastado en combustible $128,400 · 31 cargas registradas" al lado de
"**0 L** — Litros elegibles para el estímulo · LIF 2026, Art. 20-A". 31 cargas
y cero litros elegibles es una conclusión fiscal, y sale de una consulta caída.

**Escenario 3, en una página nueva.**
`incidencias/vista.tsx:32-34` calcula `mediana = null` cuando no hay ninguna
incidencia resuelta, y su propio comentario (`:30`) dice *"`null` si no hay
ninguna resuelta — un 0 se leería como 'se resuelven al instante'"*. Pero la
línea siguiente escribe `valor={mediana ?? 0}`: la tarjeta imprime **`0`** en
grande y la advertencia honesta ("sin incidencias resueltas todavía") va en
`text-xs` gris debajo. El autor identificó el defecto, lo escribió, y el
componente no le dio manera de evitarlo.

**Intento de refutación.** ¿Lo salva el demo? A medias y por accidente: el guion
(`GUION_DEMO.md`, §4) proyecta `/dashboard` **después** de cerrar el viaje en
vivo, y esa liquidación sí trae 113 L / $774.48 / $603.45. Pero el checklist
previo manda "abrir el panel una vez" (§*Antes de entrar a la sala*, punto 2), y
la tabla *"Si algo falla en vivo"* contempla que WhatsApp no entregue. En los
dos casos lo que se proyecta son los tres ceros.

**Consecuencia.** El contralor lee "$0.00 de IVA acreditable" con LIVA art. 5 al
lado y la única lectura disponible es "mi flota no tiene IVA que acreditar" —
que es la conclusión contraria a la que el producto existe para vender. Y para
quien mantenga esto: el arreglo del 2-ago ya existía y se quedó en una rama.

**Causa raíz probable.** La regla "no afirmes una medición que no hiciste" se
implementó como un componente aparte (`acred.tsx`) en la otra rama, en vez de
como una capacidad de `KpiTile` —`valor: number | null`—, que es el único punto
por el que pasan las 60 cifras de los dos paneles.

---

### [ALTO] El botón "30d" del panel no hace nada: `pordefecto="30"` contra un default de 7 días

`src/app/dashboard/page.tsx:73` (`… : sp?.rango === 'todo' ? 'todo' : '7'`) ·
`:211` (`<GlobalFilter base="/dashboard" pordefecto="30" activo={rango} …>`) ·
`src/app/admin/ui/global-filter.tsx:32-38` (`if (rango !== pordefecto)
params.set('rango', rango)`).

**Escenario, paso a paso con las URLs.** Se abre `/dashboard`. Sin `?rango=`,
`:73` resuelve `'7'`: el rótulo dice "Liquidaciones cerradas — últimos 7 días",
el pill negro está en **7d**, y `getAcreditables`/`getKpis` reciben ventana 7.
Se hace clic en **30d**:

```
construir('30') → '30' === pordefecto → NO escribe el parámetro → href = "/dashboard"
GET /dashboard  → sp.rango === undefined → rango = '7'
```

Vuelve exactamente la misma pantalla: mismos $ , mismo rótulo "últimos 7 días",
y el pill activo **salta de vuelta a 7d**. Los 30 días son **inalcanzables desde
la interfaz**: solo funcionan "7d" (`/dashboard?rango=7`) y "Todo"
(`/dashboard?rango=todo`).

**Intento de refutación.** ¿Es un caso raro? No: es la única combinación rota
del repo, y las otras dos están bien —`admin/page.tsx:75` default `'7'` con
`GlobalFilter` sin `pordefecto` (`:123`, que por defecto es `'7'`), y
`analitica/page.tsx:39` default `'30'` con `pordefecto="30"` (`:62`)—. El
docstring de `global-filter.tsx:26-32` describe *este mismo bug al revés* como
algo que ya pasó y se arregló: *"Un filtro que ignora un clic es peor que no
tenerlo."*

**Consecuencia.** El único control interactivo de la pantalla que se proyecta el
6-ago no responde. Y peor: el comentario de `page.tsx:61-72` declara que si el
panel abre en ceros teniendo datos un poco más atrás, *"se cambia el default de
vuelta a '30'"* — la salida que la UI ofrece para ese escenario es justo el
botón que no funciona.

**Causa raíz probable.** El default de la página se revirtió 30 → 7 el 3-ago
(está escrito en el comentario) y no se bajó el `pordefecto` del filtro con él.

---

### [ALTO] `--faint` mide 2.56:1: las citas legales que sostienen cada cifra fiscal son el texto menos legible del panel

`src/app/globals.css:68` (`--faint: #a1a1aa`) ·
`src/app/admin/ui/kit.tsx:71` (`<p className="text-xs mt-2" style={{ color:
'var(--faint)' }}>{nota}</p>` — el pie de **todos** los `KpiTile`) · `:64` (el
mensaje `vacio`) · `:133` (subtítulo de `ChartCard`) ·
`src/app/dashboard/cifra-grande.tsx:62` (`text-[11px]`) ·
`src/app/admin/ui/graficas.tsx:286,322,350,496` (etiquetas de eje, `text-[10px]`)
· contra `src/app/dashboard/contraste.test.ts:59-101`, que mide **solo**
`--color-ok` y `--color-bad`.

**Escenario, con la misma fórmula de luminancia WCAG 2.1 que usa la prueba del
repo** (recalculada a mano, `#a1a1aa` sobre `#ffffff` = fondo de `.card`):

```
--faint  #a1a1aa sobre #ffffff  →  2.56:1     (sobre --bg #fbfbfd → 2.48:1)
AA pide 4.5:1 para texto normal y 3:1 hasta para texto grande. Esto es text-xs.
```

Lo que se pinta con ese token en la pantalla que se proyecta:
*"LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente"*,
*"LIVA, Art. 5 — CFDI con IVA desglosado"*,
*"Estímulo de autopistas · LIF 2026, Art. 20-A"*,
*"ESTIMACIÓN: 412 comprobantes × 4 min de captura manual ÷ 60. Los 4 min son un
supuesto, no una medición."* (`valor-ahorro/page.tsx:82`) y
*"Sobre política y duplicados · últimos 7 días"* (`page.tsx:149`).

**Intento de refutación — y aquí está lo que lo agrava.** El guardarraíl existe
y no lo cubre: `contraste.test.ts` mide dos tokens y se llama a sí mismo "los
tres tokens con significado". `--faint` no está en la lista, ni `--muted`
(4.83:1, pasa), ni los tokens v2 `--ok/--warn/--bad` (5.02 / 4.92 / 6.47 sobre
blanco, pasan). Es el mismo hueco que en la auditoría 10 dejó pasar
`--color-warn`; ese token sí se arregló (hoy `#a16207`, 4.92:1,
`globals.css:36`) y el defecto migró al token nuevo.

**Segundo caso, marginal pero del mismo hueco.** `StatusPill`
(`kit.tsx:88-95`) pinta `--ok` sobre `--okbg` y `--warn` sobre `--warnbg`, y
esas parejas —que la prueba tampoco mide, porque solo mide contra blanco— dan
**4.46:1** y **4.45:1** en `text-xs`. Rozan por debajo del 4.5.

**Consecuencia.** La estrategia entera del producto es "no te doy un peso que no
pueda defender, te doy el dato duro y el artículo". El artículo es lo que
sostiene la cifra, y en un proyector de sala de juntas —con luz— es lo primero
que desaparece. Además el mensaje de estimación de `valor-ahorro` —el que
declara el supuesto de 4 minutos, la defensa del producto contra "¿de dónde
salió ese número?"— se pinta igual de tenue que el número que califica.

**Causa raíz probable.** `--faint` nació en el design system v2 como color de
etiqueta de eje de gráfica (donde un gris claro es correcto) y se reusó como
tinta de texto; la prueba de contraste se escribió sobre una lista de tokens
fija en vez de sobre "todo token que aparezca como `color:`".

---

### [ALTO] Con la base caída, el número más grande del panel dice `$0.00` justo encima del cartel que avisa que no se pudo leer nada

`src/app/dashboard/page.tsx:145-150` (`<CifraGrande valor={kpis?.diferenciaDetectada ?? 0}
etiqueta="Señalado por el motor" nota={`… ${etiquetaVentana}`} />`) · `:138`
(`<AvanceCierre viajes={viajes ?? []} …>`) · `:168` (donde recién empieza
`{estado === 'error' ? …}`) · `src/app/dashboard/estado.ts:32` ·
`src/app/dashboard/cifra-grande.tsx:45` (`fontSize: 'clamp(2rem, 3.4vw, 3.25rem)'`).

**Escenario, con valores.** Supabase pausó (el guion lo contempla: *"La base
pausó — una consulta la despierta (~10 s)"*). Las cuatro consultas de `:81-90`
truenan, `safe()` devuelve `null` en las cuatro, `estadoPanel` devuelve
`'error'` y el cuerpo se sustituye por la tarjeta correcta:

> **No se pudieron cargar los datos.** Hubo un problema al leer del sistema…
> esto **NO** significa que no haya liquidaciones, significa que no se pudieron
> leer.

Pero el encabezado se pinta **antes** de ese `?:` y no lo cubre. Arriba de esa
tarjeta, en 52 px de tipografía display, sigue diciendo:

```
$0.00
SEÑALADO POR EL MOTOR
Sobre política y duplicados · últimos 7 días
```

y a su izquierda, la barra de avance: **"No hay viajes iniciados en este
periodo."** (`avance-cierre.tsx:103`, porque `viajes` llegó `null` y se le pasó
`[]`). La misma pantalla dice a la vez "no pude leer nada" y "medí, y dio cero".
El caso `'parcial'` es igual: el aviso amarillo aparece y la cifra grande sigue
afirmando.

**Intento de refutación.** El repo ya resolvió esto bien en el otro Inicio: la
pantalla del encargado (`inicio-operacion.tsx:93`) escribe
`{tablero?.viajesActivos ?? '—'}` — un guion, no un cero. Dos versiones de la
misma cabecera, una correcta y otra no. Y `getViajes` ni siquiera entra en
`SeccionesPanel` (`estado.ts:16-21`), así que si es la única que cae, el panel
ni pasa a `'parcial'`.

**Consecuencia.** Es la regla fundacional del producto —"fallar cerrado y
decirlo"— rota en la cifra que el panel pone más grande, y encima de su propio
desmentido. Para el contralor, una pantalla que se contradice a sí misma en el
mismo golpe de vista vale menos que una pantalla en blanco.

**Causa raíz probable.** El encabezado se sacó fuera del condicional al
reestructurar la página (para que el saludo y la cifra queden fijos al hacer
scroll, `:122-123`), y con él salió del alcance del estado.

---

### [ALTO] "IVA acreditable" son tres números distintos en cuatro pantallas del mismo panel, y "del periodo" es "de siempre"

`src/app/dashboard/page.tsx:80,82` (`getAcreditables(tenantId, ventana)` — 7
días por defecto) · `src/app/dashboard/facturacion/page.tsx:35`
(`getAcreditables(tenantId)` — **sin ventana**) ·
`src/app/dashboard/combustible-casetas/page.tsx:41` (ídem) ·
`src/app/api/dashboard/asistente/route.ts:48-49` (ídem, alimenta el rail de las
20 páginas) · `src/app/dashboard/chat.tsx:31,37,40` (*"…de IVA acreditable
**este periodo**"*) · `src/app/dashboard/cuadre/page.tsx:67`
(`getKpis(tenantId)` sin ventana) contra `:87` (**"Comprobación del periodo"**)
y `:117` (*"sobre el total del periodo"*).

**Escenario, con valores.** Una flota con dos meses de operación:
$4,120.00 de IVA acreditable histórico, de los cuales $774.48 cayeron en los
últimos 7 días.

| Dónde | Rótulo | Qué imprime |
|---|---|---|
| `/dashboard` (Inicio) | "IVA acreditable · LIVA, Art. 5" | **$774.48** |
| `/dashboard/facturacion` | "IVA acreditable · LIVA, Art. 5" | **$4,120.00** |
| `/dashboard/combustible-casetas` | "Litros elegibles · LIF 20-A" | histórico |
| El rail, en **cualquiera** de las 20 páginas | *"de IVA acreditable **este periodo**"* | **$4,120.00** |

Las dos primeras filas llevan **el mismo rótulo y la misma cita legal**, y
ninguna de las dos dice sobre qué ventana está calculada (`facturacion` no tiene
filtro ni etiqueta). La cuarta convive en pantalla con la primera: el rail vive
en `chrome.tsx:90`, o sea que en `/dashboard` el asistente contesta $4,120.00
"este periodo" mientras la tarjeta a su izquierda dice $774.48.

Y `/dashboard/cuadre` titula su bloque **"Comprobación del periodo"** sobre un
`getKpis(tenantId)` que, con `ventanaDias` indefinido, hace
`corte = corteVentana(undefined) = null` (`analytics.ts:36-37`) y **no aplica
`.gte('created_at', …)`**: es el histórico completo, sin filtro ni control de
fecha en la pantalla.

**Intento de refutación — y aquí está lo grave.** El encabezado de
`analytics.ts:28-34` documenta exactamente este bug como ya cerrado:

> *"'ESTÍMULOS ACREDITABLES DEL PERIODO' y 'LIQUIDACIONES DEL PERIODO' sobre
> consultas que NO filtraban por fecha: los rótulos decían periodo y las cifras
> eran de siempre."*

La función quedó bien parametrizada; las páginas nuevas la llaman sin el
parámetro y le vuelven a poner el rótulo encima.

**Consecuencia.** El contralor cruza dos pantallas del mismo panel para
confirmar una cifra que va a declarar, encuentra dos números bajo el mismo
rótulo y la misma cita de LIVA, y a partir de ahí no cree ninguno de los dos.
Es literalmente el daño que `lib/formato.ts` existe para evitar —"una cifra
fiscal que se lee distinta en dos pantallas se lee como dos cálculos"— por la
otra puerta: no el formato, la ventana.

**Causa raíz probable.** `ventanaDias` es opcional en `getKpis`/`getAcreditables`
y omitirlo significa "todo"; ocho páginas nuevas se escribieron sin decidir su
ventana y heredaron el rótulo de la que sí la tenía.

---

### [MEDIO] Viajes y Soporte siguen declarando que unidades, POD e incidencias "no existen en el sistema" — y hay tres pantallas al lado que las administran

`src/app/dashboard/viajes/page.tsx:131-136` · `src/app/dashboard/soporte/page.tsx:17-18`
y `:26` · contra `supabase/migrations/0047_operacion_encargado.sql:36-52`
(tabla `unidad`), `:63-64` (`viaje.unidad_id`), `:101-121` (tabla `incidencia`),
`:132-153` (tabla `pod`) · y contra
`src/app/dashboard/despacho/page.tsx:217-220`, que dice lo contrario.

**Escenario, textual.** El contralor abre **Viajes** y lee, en un recuadro
`EstadoVacio`:

> "Unidad asignada, POD (evidencia de entrega) y margen por viaje no aparecen
> porque **no existen en el sistema**: `viaje` no guarda unidad, **no hay tabla
> de vehículos**, **no hay campo de POD**…"

Tres renglones más arriba, en el mismo sidebar, están **Unidades** y **POD &
Evidencias**, con sus tablas llenas. Abre **Soporte & Quejas** y lee: *"Las
incidencias de un viaje (retraso, daño, faltante) tampoco tienen dónde vivir"*,
y en `cuandoExista` (`:26`) *"Incidencias por viaje: retraso, daño, faltante"*
listado como funcionalidad futura — cuando `/dashboard/incidencias` levanta
justo esas cinco. Y en **Despacho** (`:217`) lee la frase contraria: *"Unidades,
incidencias y POD sí tienen dónde vivir desde la migración 0047"*.

**Intento de refutación.** No es que la migración no haya corrido: su propio
encabezado (`0047…sql:9-15`) **cita `viajes/page.tsx:130-137` textualmente** como
la razón de existir y dice que cierra tres de esos cuatro huecos. El único que
sigue siendo cierto es el margen. `pendiente.tsx:8-9` repite el error en su
docstring (lista "Unidades" entre las siete pantallas sin datos).

**Consecuencia.** Estos recuadros son el activo de credibilidad del panel: el
producto se vende diciendo "prefiero enseñarte un hueco honesto que cifras de
ejemplo" (`pendiente.tsx:69-70`). Un hueco que ya no es hueco convierte esa
declaración en una más que hay que verificar. Y el comprador que le cree a la
pantalla descarta tres funciones que sí tiene.

**Causa raíz probable.** El texto de "qué falta" está escrito a mano en cada
página y no deriva de nada verificable; la 0047 lo dejó vencido el día que
entró.

---

### [MEDIO · REINCIDENTE] `TonoDeducibilidad` tiene cuatro miembros y el panel sigue conociendo dos: en pantalla, "Por confirmar" se ve idéntico a "Deducible para ISR"

`src/app/dashboard/[id]/page.tsx:189-190`
(`style={{ color: f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)' }}` — un
ternario de dos ramas para una unión de cuatro) contra
`src/lib/cuadra/liquidacion/deducibilidad.ts:17`
(`'bueno' | 'malo' | 'pendiente' | 'condicionado'`) y
`src/lib/cuadra/liquidacion/pdf.ts:295`
(`f.tono === 'bueno' ? GREEN : f.tono === 'malo' ? RED : f.tono === 'condicionado' ? INK : AMBER`
— cuatro tonos, cuatro colores).

**Escenario.** Una liquidación con combustible pagado en efectivo devuelve una
fila `tono:'condicionado'` ("Deducible para ISR — sujeto a permiso CRE
vigente") y otra `tono:'pendiente'` ("Por confirmar"). El guion abre pantalla y
PDF del mismo viaje en el minuto 6:

| Fila | En el PDF | En el panel |
|---|---|---|
| Deducible para ISR | VERDE | `--ink` |
| No deducible | ROJO | `--color-bad` |
| Deducible — sujeto a permiso CRE | INK | `--ink` |
| Por confirmar | ÁMBAR | `--ink` |

Tres de las cuatro filas salen en la misma tinta en pantalla y en tres colores
distintos en el PDF, del mismo viaje, en la misma reunión.

**Consecuencia.** "Por confirmar" es dinero que todavía se puede perder y se lee
con la misma tinta que "Deducible para ISR"; lo único que los distingue en
pantalla es el texto de la etiqueta. Y el comentario que justifica la tinta
plana (`[id]/page.tsx:174-175`: *"`--color-ok` mide 2.22:1 sobre blanco"*) lleva
**tres rondas vencido**: `globals.css:35` es `#14602c`, 7.67:1, verificado por
`contraste.test.ts:63-67`.

*(REINCIDENTE de la auditoría 10. Verificado hoy con la línea movida.)*

---

### [MEDIO] `EstadoSat` 2/4: un CFDI que el SAT no reconoce sale en ámbar y con su clave cruda `no_encontrado`

`src/app/dashboard/documentos/page.tsx:23-30` (`estadoSat()`: nombra `vigente` y
`cancelado`, y `:28` devuelve `{ label: d.estadoSat, estado: 'warn' }` para el
resto) contra `src/types/cuadra.ts:27`
(`'vigente' | 'cancelado' | 'no_encontrado' | 'pendiente'`) y
`src/lib/cuadra/cuadre/engine.ts:85`
(`NO_DEDUCIBLE_ISR = [… 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado' …]`).

**Escenario, con valores.** Un comprobante con `estado_sat = 'no_encontrado'` —
el UUID que el SAT no reconoce, "inexistente o fabricado" según la nota que el
propio motor emite (`engine.ts:404`). En la bandeja de Documentos sale:

```
Diésel   03 ago 2026   DS-8801   ENE160518AB1   $4,200.00   97%   [ no_encontrado ]   ← pill ÁMBAR
```

Dos filas arriba, un CFDI cancelado sale como **"Cancelado"** en pill **rojo**.
Los dos están en la misma cubeta del motor: no deducibles. La pantalla los pinta
en dos severidades distintas, y al peor de los dos le imprime la clave de la
base de datos con guion bajo y en minúscula.

**Intento de refutación.** El `else if` de `:28` es deliberado (mejor la clave
cruda que `undefined`, mismo criterio que `ESTATUS_VIAJE` o `ESTADO_UNIDAD`) —
pero ahí el fallback cubre valores que la base **no admite**; aquí cubre dos de
los cuatro valores que el tipo **sí declara**, y uno de ellos es el más grave.

**Consecuencia.** El contralor revisa la bandeja buscando los rojos, ve ámbar, y
deja pasar un comprobante que su contador va a tener que sacar de la
declaración. Y ve un identificador interno en la columna que le está dando el
veredicto del SAT. *(El mismo fuga de clave cruda, sin la parte de severidad,
está en `src/app/dashboard/usuarios/page.tsx:106`: el pill imprime `flota_admin`,
`encargado`, `operador` tal cual, teniendo el repo **tres** mapas de etiqueta de
rol ya escritos — `admin/equipo/page.tsx:12`, `admin/mi-perfil/page.tsx:9`,
`dashboard/chrome.tsx:26`.)*

---

### [MEDIO] El sidebar del panel del CLIENTE no tiene variante de íconos: abajo de 1024 px son 23 etiquetas envueltas dentro de 56 px

`src/app/dashboard/chrome.tsx:55-57` (`<nav …><SidebarNav rol={rol} /></nav>`,
una sola variante) · `src/app/marco.ts:22-23` (`MARCO_SIDEBAR` =
`w-[72px] lg:w-[232px]`) · `src/app/dashboard/sidebar-nav.tsx:36-38` (el `<Link>`
pinta `<Icono/> {nombre}`, sin `hidden lg:inline` en el texto) · contra
`src/app/admin/layout.tsx:81-82`
(`<div className="hidden lg:block"><SidebarNav/></div>` +
`<div className="lg:hidden"><SidebarNavIconos/></div>`) y
`src/app/admin/sidebar-nav-iconos.tsx`, que existe exactamente para esto.

**Escenario.** Se abre `/dashboard` en un iPad horizontal (1024 px es el punto
de corte de `lg`) o en un navegador sin maximizar de 900 px. El `<aside>` pasa a
`w-[72px]`; el `<nav>` tiene `px-2`, así que quedan **56 px** de ancho útil. Ahí
dentro se siguen pintando los 23 links con su texto: "Valor & Ahorro (ROI)",
"Combustible & Casetas", "POD & Evidencias", cada uno envuelto en tres o cuatro
renglones de `text-sm`, más los cinco encabezados de sección en versalitas de
11 px con su chevron. El `aside` es `overflow-hidden`; el `nav`,
`overflow-y-auto`.

**Intento de refutación.** No es teórico ni depende de medir píxeles: el mismo
repo resolvió el mismo breakpoint en `/admin` con un componente dedicado, y
`dashboard/rutas.ts:56-61` incluso deja `TODAS_LAS_RUTAS` exportada *"para el
mismo punto de extensión que admin/rutas.ts"* — y nadie la consume
(`grep -rn TODAS_LAS_RUTAS src/app/dashboard/` devuelve solo su definición).

**Consecuencia.** La consola interna (la de Javier) tiene el arreglo; el panel
del cliente, que es el que se le enseña al comprador y el que un contralor va a
abrir desde donde sea, no. Cobra factura el día que alguien lo abra en una
tableta o en media pantalla.

---

### [MEDIO] Ninguna de las 20 páginas marca dónde estás: el sidebar se ve igual en las 20

`src/app/dashboard/sidebar-nav.tsx:35-39` (el `<Link>` usa la constante `ITEM`,
idéntica para todos; `pathname` solo se lee en `:17` para decidir si la sección
arranca abierta) · `src/app/admin/sidebar-nav.tsx:34-38` (mismo patrón, mismo
hueco).

**Escenario.** Javier proyecta el panel y recorre Inicio → Cuadre → Documentos →
Despacho → Incidencias. En los cinco, el sidebar es idéntico: ningún item queda
resaltado, ninguno lleva `aria-current="page"`, ningún fondo ni tinta cambia.
La única pista de dónde estás es el título del `header` de la página. En
`/dashboard/despacho` e `/dashboard/incidencias` —que comparten el bloque
"Estado de la operación" con las mismas seis tarjetas
(`despacho/vista.tsx:18-36`, reusado por `inicio-operacion.tsx:121`)— dos
pantallas distintas abren con la misma fila de números y el mismo menú sin marca.

**Consecuencia.** En un recorrido de cinco pantallas en dos minutos, el
comprador pierde el hilo de dónde está y las páginas se le mezclan; y quien use
el panel a diario navega por prueba y error. Es orientación, no datos, y por eso
es MEDIO. Para accesibilidad, además, no hay `aria-current` en ninguna
navegación del producto.

---

### [MEDIO · REINCIDENTE, AGRAVADO] `/admin` reserva 292 px para un panel oculto — y ahora en las 30 páginas, no en una

`src/app/admin/asistente-expandible.tsx:36`
(`width: expandido ? 0 : `calc(100% - ${ANCHO_ASIDE + 16}px)``, con
`ANCHO_ASIDE = ANCHO_ASISTENTE = 276` en `:10` y `src/app/marco.ts:43` — o sea
`calc(100% - 292px)`, **sin condición de breakpoint**) · `:51-52` (el `<aside>`
que ocuparía esos 292 px es `hidden xl:flex`) ·
`src/app/admin/layout.tsx:124-126` (**envuelve `children`**, o sea todas las
páginas).

**Escenario, con números.** Ventana de 1200 px (o un proyector 1152×864, o un
portátil de 1366 sin maximizar). `xl` es `min-width: 1280px`, así que el
`<aside>` pasa a `display:none`, pero el `<div>` hermano sigue midiendo
`calc(100% - 292px)`. La columna de contenido de `/admin` mide
`1200 − 32 (padding) − 232 (sidebar) − 16 (gap) = 920 px`; dentro, el contenido
se encoge a **628 px** y quedan **292 px** de hueco a la derecha con el fondo
naranja difuminado a la vista y nada encima. Es el **32%** del área útil.

**Qué cambió desde la ronda 10, y por qué empeoró.** Entonces el componente
envolvía solo `admin/page.tsx` (Inicio). Hoy vive en el layout
(`layout.tsx:126`), así que el hueco muerto aplica a las ~30 páginas de la
consola.

**Intento de refutación.** `/dashboard` no lo tiene: ahí el rail es hermano flex
directo con `shrink-0` y la columna es `flex-1 min-w-0` (`marco.ts:37`,
`chrome.tsx:82`), así que al ocultarse el rail el flex reparte el espacio solo.
El defecto es exclusivo de `/admin`, que calcula el ancho a mano.

**Consecuencia.** Es la pantalla del equipo y no la del contralor, por eso es
MEDIO. Cobra factura el día que la consola se enseñe en una laptop que no sea la
de siempre.

---

### [MEDIO] Un contador o un chofer que teclea `/dashboard/soporte` o `/dashboard/mapa` entra — y el sidebar le sale completamente vacío

`src/app/dashboard/soporte/page.tsx:6` (`export default function SoportePage()`
— sin `resolverTenantEfectivo` ni `exigirVerRuta`) ·
`src/app/dashboard/mapa/page.tsx` (ídem) · contra las otras 21 páginas, que sí
gatean (p.ej. `rentabilidad/page.tsx:8`, `exigirVerRuta('/dashboard/rentabilidad')`)
· `src/lib/auth/visibilidad.ts:76` (soporte es `'operacion'`) y `:48`
(`AREAS_POR_ROL[rol] ?? []` — el `operador` no está en el mapa) ·
`src/app/dashboard/layout.tsx:19-20` (la única puerta que queda: "¿hay sesión?").

**Escenario, con un rol real.** Un chofer con `app_user.rol='operador'` y sesión
válida (la que le crea `/admin/usuarios/nuevo`) teclea
`https://app.likida.ai/dashboard/soporte`. El layout ve sesión y sirve.
`DashboardChrome` pinta el marco de la oficina, y `SidebarNav` filtra con
`puedeVerRuta('operador', href)`, que devuelve `false` para las 23 rutas — las
cinco `<Seccion>` se autoeliminan (`sidebar-nav.tsx:22`) y el link "Resumen"
tampoco se pinta (`:98`). Resultado: el logo de Likida, un badge que dice
**OPERADOR**, un `<nav>` **totalmente vacío**, su nombre y "Cerrar sesión" — y a
la derecha, la página de Soporte. Un contador (`contador` no ve `'operacion'`)
llega igual; en cualquier otra página lo habría rebotado `inicioDe(rol)`.

**Intento de refutación.** No hay fuga de datos: las dos páginas son estáticas y
no consultan nada del tenant. Por eso es MEDIO y no más. Lo que se rompe es la
pantalla: es un estado que la UI no sabe pintar y deja en blanco, y el rol que
no debería estar ahí es exactamente el que lo ve.

**Causa raíz probable.** La compuerta de visibilidad se aplica **por página**
(`visibilidad.ts:14-19` dice que hacen falta los dos sitios) y no en el layout,
así que una página nueva que la olvide entra sin red — y dos ya lo hicieron.

---

### [MEDIO] Los dos parámetros que sostienen el modo superadmin se caen en los links del cuerpo de la página

`src/app/dashboard/sufijo.ts:13-17` (`sufijoTenant` arrastra `tenant` y `vista`,
**nunca `rol`**) contra `src/app/dashboard/sidebar-nav.tsx:81-82`, que sí lo
arrastra · `src/app/dashboard/analitica/page.tsx:115`
(`<Link href="/dashboard/cuadre">`, sin sufijo ninguno — el único link desnudo
del panel).

**Escenario A — se pierde la flota.** Javier entra desde `/admin/flotas` →
"Ver dashboard" de Transportes Innovativos → `/dashboard?tenant=<uuid>` (el
encabezado muestra el badge naranja *"viendo como superadmin · Transportes
Innovativos"*). Sidebar → **Analítica & Reportes** (`?tenant=` conservado) →
tarjeta **"PDF por liquidación"** → `/dashboard/cuadre`, **sin `?tenant=`**.
`resolverTenantEfectivo` cae al tenant de la sesión, que para un superadmin es
el **demo** (`tenant-efectivo.ts:65`). La tabla de "Detalle por liquidación" se
llena con los folios y los montos del tenant demo. El badge que decía de qué
flota se estaba hablando **solo existe en Inicio** (`page.tsx:130-134`), así que
en Cuadre no hay nada que avise del cambio.

**Escenario B — se pierde el rol previsualizado.** Javier abre
`/dashboard?vista=demo&rol=encargado`; la cinta de `aviso-rol.tsx:38-52` anuncia
*"Estás viendo el panel como Jefe de tráfico"*. Aterriza en `InicioOperacion`
(`page.tsx:307-309`), hace clic en **"Ir a despacho"**
(`inicio-operacion.tsx:131`, `href={`/dashboard/despacho${sufijo}`}`) →
`?vista=demo`, sin `rol`. `rolEfectivo` vuelve a `superadmin`, la cinta
desaparece y el sidebar —que lee `useSearchParams()`— se repuebla con las 23
rutas. La comparación se termina sola, en silencio.

**Intento de refutación.** El propio código nombra los dos daños: `sufijo.ts:2-5`
(*"si un link lo pierde, el siguiente clic te devuelve al tenant demo sin
avisar, viendo cifras de otra empresa bajo el mismo encabezado"*) y
`sidebar-nav.tsx:78-80` (*"si un solo link lo pierde, el siguiente clic te
devuelve a tu propia vista de superadmin y la comparación se rompe sin
avisar"*). Las dos advertencias existen; la implementación que las cumple es la
del sidebar, y la de las páginas —la misma regla, otra fuente de entrada— quedó
a medias.

**Consecuencia.** Es la herramienta interna, no la del contralor, y por eso es
MEDIO. Pero el modo de falla es leer dinero de la flota equivocada bajo el mismo
marco, sin ninguna señal.

---

### [MEDIO · REINCIDENTE] `/mis-viajes` imprime "$0.00 comprobado" para el viaje que el chofer tiene abierto y al que ya le mandó comprobantes

`src/app/mis-viajes/page.tsx:38` (`comprobado: Number(liq?.total_comprobado ?? 0)`)
· `:87` (`{mxn(v.comprobado)}`) · `:82` y `:95` (la columna de estatus **sí**
distingue `null` y pinta "Sin liquidar").

**Escenario, con los datos del demo.** `VJ-2026-0847` está `'abierto'`
(`seed.sql:116`) y ya tiene $5,600 en `gasto` (`seed.sql:121-129`), pero todavía
no existe su fila en `liquidacion`. El chofer abre su panel:

```
VJ-2026-0847    04 ago 2026    $0.00    Sin liquidar
```

La columna de dinero afirma cero para un viaje donde ya mandó $5,600 en fotos.
La columna de estatus, tres celdas a la derecha, sabe distinguir "no hay
liquidación"; la de dinero colapsa `null` a `0` y lo formatea como una cifra
medida.

**Consecuencia.** El chofer que revisa si su envío llegó lee "$0.00" y concluye
que se perdió: reenvía las catorce fotos. Cada reenvío es otra pasada de OCR
—costo real— y el motor las trata como duplicados que hay que explicar después
en la liquidación.

*(REINCIDENTE de la auditoría 10; misma línea, misma pantalla.)*

---

### [BAJO · REINCIDENTE, EXTENDIDO] 4 de 106 encabezados de tabla del producto llevan `scope`

`grep -rn "<th" src/app/ | grep -v test` → **106** `<th>`; con `scope`,
**cuatro**, todos en `src/app/dashboard/[id]/page.tsx:255-257` y `:272` (puestos
por el BAJO 2 de la auditoría 5). Sin `scope` quedan, entre otras, las tablas de
dinero y de operación: `dashboard/cuadre/page.tsx:178-182`,
`dashboard/viajes/page.tsx:99-104`, `dashboard/documentos/page.tsx:105-111`,
`dashboard/operadores`, `dashboard/usuarios/page.tsx:91-93`,
`dashboard/politicas/page.tsx:67-69`, `dashboard/despacho/vista.tsx:55-58` y
`:115-120`, `dashboard/incidencias/vista.tsx:81-87`,
`dashboard/unidades/vista.tsx:81-87`, `dashboard/pod/vista.tsx:67-72`,
`mis-viajes/page.tsx:72-75`. Ninguna lleva `<caption>`.

**Escenario.** Un lector de pantalla recorre la tabla de Cuadre —Folio, Fecha,
Comprobado, Diferencia, Estatus— y anuncia "$1,500.00, a favor de la empresa"
sin decir de qué columna. En la pantalla de detalle, sí lo dice.

**Consecuencia.** No es del demo: nadie va a usar un lector de pantalla el 6 de
agosto. Cobra factura el día que un cliente institucional lo pida, y cuesta más
porque la inconsistencia —una pantalla bien, diecinueve mal— hace pensar que ya
estaba hecho. La ronda 10 lo reportó con dos tablas; la reestructuración lo
multiplicó por diez sin que nada avisara.

---

## Lo que revisé y está bien

**Las ocho páginas nuevas son honestas, y lo verifiqué línea por línea, no por
el nombre.** `rentabilidad` y `soporte` usan `SeccionPendiente` y explican la
pieza concreta que falta (`rentabilidad/page.tsx:14-23`: el ingreso del flete no
se registra en ningún lado, y calcularlo con el anticipo *"daría números que se
ven bien y están mal"*). `valor-ahorro` es la que más fácil se convertiría en
mentira y es la más disciplinada: `:82` enseña el supuesto de
`MINUTOS_CAPTURA_MANUAL` en la misma tarjeta, `:110-112` se niega a llamar
"ahorro" a dinero señalado, `:137` exige **tres** meses antes de dibujar una
curva acumulada, y `:188-199` enumera las cuatro cifras que el PASO 6 pide y no
se pueden sostener. `viajes:118` pinta `—` en vez de `$0.00` cuando el anticipo
es cero; `unidades/vista.tsx:103-104` pinta `—` en vez de `0` km *"porque un 0
se lee como unidad nueva sin rodar"*; `despacho/vista.tsx:109` escala la barra
de carga al máximo real y no a una capacidad inventada; `pod/vista.tsx:13-19`
distingue `null` ("Nadie lo ha pedido") de `'pendiente'` ("Pedido, sin llegar"),
que es la distinción operativa que importa. **No encontré una sola cifra
fabricada en las ocho.**

**El cotejo obligatorio, mapa por mapa, contra `src/types/` y contra los
`check` de las migraciones.** Enumeré cada mapa literal de `src/app/`:

| Mapa | Dónde | Contra | Resultado |
|---|---|---|---|
| `ESTATUS` (3) | `dashboard/estatus.ts:17` | `EstatusLiquidacion`, `types/cuadra.ts:106` | **3/3** · fallback `:26` |
| `ESTATUS` (3) | `mis-viajes/page.tsx:8` | ídem | 3/3 · y distingue `null` = "Sin liquidar" · *(copia de la anterior, pese a que `estatus.ts` existe para no tener copias)* |
| `CONCEPTO` (9) | `dashboard/[id]/page.tsx:23` | `ConceptoGasto`, `types/cuadra.ts:20-25` | **9/9** · y solo es red: `:315-317` delega en el motor |
| `ESTATUS_VIAJE` (3) | `dashboard/viajes/page.tsx:15` | `viaje_estatus_dominio` | **3/3** · fallback `:109` |
| `ESTADO_UNIDAD` (4) | `dashboard/unidades/vista.tsx:15` | `unidad_estado_dominio`, 0047:50 | **4/4** · fallback `:92` |
| `TIPOS` (5) | `dashboard/incidencias/vista.tsx:11` | `incidencia_tipo_dominio`, 0047:115 | **5/5** |
| `PRIORIDADES` (3) · `ESTADOS` (3) | ídem `:14,:19` | 0047:117,119 | **3/3 y 3/3** · y `page.tsx:64,75` valida contra el mapa **antes** de escribir, para dar redirect en vez de un 500 del constraint |
| POD (3 + `null`) | `dashboard/pod/vista.tsx:13-19` | `pod_estado_dominio`, 0047:146 | **3/3 + null** |
| `ROLES` (5) | `dashboard/usuarios/page.tsx:12` | `app_user.rol` | 5/5 en la descripción · **el pill imprime la clave cruda** (ver hallazgo) |
| `ROL_BADGE` (5) | `dashboard/chrome.tsx:26` | ídem | **5/5** · fallback `:51` |
| `NOMBRE` (3) | `dashboard/aviso-rol.tsx:7` | `PREVISUALIZABLES`, `visibilidad.ts:111` | **3/3** |
| `FASE_LABEL` (6) | `dashboard/valor-ahorro:12`, `admin/page:19`, `admin/analitica:11`, `admin/costos-facturacion:12` | `FaseCosto`, `costos.ts:41` | **6/6 en las cuatro** |
| `ROL_LABEL` (5) | `admin/equipo:12` (`Record<RolAppUser,…>`), `admin/mi-perfil:9` | `RolAppUser` | 5/5 · el de `equipo` es el único del repo **tipado contra la unión**: un rol nuevo rompe `tsc` |
| Rutas (23) | `dashboard/rutas.ts:58-61` | `AREA_POR_RUTA`, `visibilidad.ts:62-92` | **23/23** — ninguna ruta del sidebar cae al `undefined` que la negaría |
| `EstadoSat` (4) | `dashboard/documentos:23-30` | `types/cuadra.ts:27` | **2/4** → hallazgo |
| `TonoDeducibilidad` (4) | `dashboard/[id]:190` | `deducibilidad.ts:17` | **2/4** → hallazgo |
| `TipoDiferencia` (37) | — | `types/cuadra.ts:62-93` | no hay mapa: se pinta `nota` libre (`[id]:191`), como en la ronda 10 |

**El sidebar filtra con la MISMA función que gatea la página.**
`sidebar-nav.tsx:94` usa `puedeVerRuta`, la de `visibilidad.ts:98`, no una lista
paralela; y `:88` reimplementa `rolEfectivo` a propósito y con la misma regla
(no puede llamar a la del servidor desde un Client Component). Verifiqué que
las dos coinciden. `Seccion` se autoelimina si queda sin items (`:22`), así que
al encargado no se le anuncia un encabezado "Documentos & Dinero" vacío.

**Los estados de carga y de error del panel.** `estado.ts:29-38` distingue
`error`/`parcial`/`vacio`/`datos` y `estado.test.ts` (6/6) fija la combinación
traicionera. `cuadre/page.tsx:31` **lanza** ante el error por valor de
supabase-js —el error que la auditoría 5 cobró—; `usuarios/page.tsx:28` hace lo
mismo. Las 21 páginas con datos envuelven cada consulta en su propio `safe()` y
tienen fallback por sección, no uno global. `error.tsx:66-73` pinta el `digest`
seleccionable y lo registra. `cargando.tsx` (el logo respirando) respeta
`prefers-reduced-motion`, igual que `use-count-up`, `avance-cierre.tsx:92` y
`cifra-grande.tsx:51`. `not-found.tsx` sustituye el 404 crudo de Next.

**Ningún error de servidor llega crudo a pantalla.** Los server actions de
`despacho`/`incidencias`/`pod`/`unidades` validan **antes** de escribir y hacen
`redirect` en vez de dejar que reviente el constraint
(`incidencias/page.tsx:64,75,81`), y confirman con un `StatusPill` leído de
`?ok=` (`:116-117`) — que es justo la mitad que a `/admin/usuarios/nuevo` le
faltaba en la ronda 10.

**El formateo del dinero sigue siendo uno solo.** `npx vitest run` → **172
archivos / 1670 pruebas / 1 saltada**, exit 0; `npx tsc --noEmit -p .` exit 0;
`npm run lint` sin errores (el warning de `analytics.ts:44` es de caché: con
`--no-cache` no aparece, y `corte` sí se usa en `:51`). `formato.test.ts`
(el grep de `toLocaleString('es-MX')`) sigue verde; `formato-preset.ts:21-23`
reexporta `mxn`/`litros` de `lib/formato.ts` en vez de reimplementarlos, así que
las 60 cifras que pasan por `KpiTile` se formatean en el único sitio donde debe
hacerse.

**Las llaves de React de las filas de dinero son estables.** `key={l.id}`
(`cuadre:194`), `key={v.id}` (`viajes:111`, `mis-viajes:84`), `key={u.id}`
(`usuarios:98`, `unidades/vista:95`), `key={i.id}` (`incidencias/vista:95`),
`key={p.viajeId}` (`pod/vista:79`), `key={c.operadorId}` (`despacho/vista:125`),
`key={p.concepto}` (`politicas:74`), `key={f.label}` (`[id]:151`). Las de índice
que quedan (`cuadre/page.tsx:136`, `combustible-casetas/page.tsx:129`) están sobre listas de
anomalías en Server Components que no reordenan.

**La foto del ticket sigue sin llegar a pantalla**, y el POD nace con el mismo
criterio: `pod/page.tsx:115-121` dice explícitamente que la evidencia se guarda y
no se exhibe, y la tabla no referencia `storagePath`. `foto_no_expuesta.test.ts`
(2/2) verde.

**El `--color-warn` de la ronda 10 cerró.** `globals.css:36` es `#a16207`
(**4.92:1** sobre blanco, recalculado a mano) y ya no `#ff9f0a` (1.99:1). Los
tokens v2 `--ok` 5.02, `--bad` 6.47, `--muted` 4.83, `--marca` 5.18 en los dos
sentidos: pasan. El único que reprueba de verdad es `--faint`, arriba.

---

## Lo que NO alcancé a revisar

- **Sexta ronda seguida sin renderizar nada en un navegador.** Todo lo de arriba
  es lectura de código y cálculo a mano. `npm run build` está prohibido en este
  árbol y el preview temporal bajo `src/app/zzz-preview-*` exige escribir en el
  repo, que también lo está. Los tres hallazgos que un screenshot confirmaría o
  tumbaría en diez segundos: el hueco de 292 px de `/admin` a 1200 px, el
  sidebar de `/dashboard` a 900 px, y `--faint` proyectado.
- **No tengo el proyecto real de Supabase.** Todo lo que digo del estado de los
  datos sale de `seed.sql` y de las migraciones — incluida la premisa de que las
  tres liquidaciones sembradas traen los tres acreditables en 0. No pude
  confirmar si en producción ya hay alguna con `iva_acreditable > 0`, que es lo
  que decide si el CRÍTICO se ve o no el 6-ago.
- **No medí tamaños de toque renderizados.** Los `<select>`/`<button>` de los
  cuatro formularios nuevos (`px-2.5 py-1.5`, ~32 px) y los items del sidebar
  (`py-2`, ~34 px) calculan por debajo de los 44 px recomendados, pero no lo
  verifiqué en pantalla y por eso no lo reporto como hallazgo.
- **No audité `design-system/`** (los archivos HTML/CSS sueltos que no importa
  nadie desde `src/`): no pude establecer si todavía describe lo que
  `globals.css` sirve hoy, sobre todo después de que se retirara el modo oscuro
  y entrara la paleta naranja.
- **`/admin`: leí el marco, el kit y `asistente-expandible`, no las ~30
  páginas.** La ronda 10 las abrió una por una buscando cifras fabricadas y no
  encontró ninguna; no repetí ese barrido, así que sobre `/admin` esta ronda
  aporta solo el 292 px y el contraste compartido.
- **No perseguí las 37 claves de `TipoDiferencia`** buscando textos rotos como
  el "de Combustible de combustible" que la ronda 10 documentó
  (`engine.ts:499-503`). Sigue presente y sigue llegando a `[id]/page.tsx:191`
  como texto libre, pero es del rubro del motor y no lo re-medí.
- **No verifiqué el chat de `/dashboard` fuera de las seis ramas de
  `responder()`** (`chat.tsx:24-43`): sé que no traduce a SQL y que responde
  "todavía no sé responder eso", pero no probé qué contesta ante entradas
  ambiguas ("¿cuánto peaje de diésel?", que hace match con `diesel` antes que
  con `peaje`).
- **`/demo`** (los dos ALTO/MEDIO de la ronda 10: la palomita "CFDI validado por
  QR ✅" que se desdice, y `diesel` en crudo) — no lo abrí esta ronda; el MAPA
  declara su tope de arreglos agotado y preferí gastar el tiempo en las ocho
  páginas que nadie había mirado nunca.
