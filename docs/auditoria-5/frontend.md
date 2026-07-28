# Frontend — auditoría 5

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda** — el código
del panel casi no cambió esta ronda y en dos puntos mejoró (los litros de la ronda 3
ya llegan al detalle, el contraste de `--color-bad` quedó cerrado en los dos modos).
La nota baja porque esta vez **corrí el camino de fallo en vez de leerlo**: el
mecanismo que el propio código dice tener para distinguir "falló la carga" de "no hay
datos" no funciona, y su comentario afirma que sí. La nota anterior descansaba en ese
comentario.

**El riesgo mayor hoy:** si Supabase no responde durante el demo del 6-ago, el panel
no muestra un error — muestra, con tipografía impecable, que la flota nunca ha
liquidado un viaje.

---

## Hallazgos

### [CRÍTICO] Un fallo de Supabase se pinta como "Aún no hay liquidaciones"

`src/app/dashboard/page.tsx:20-22,57-58,82-90` · `src/lib/cuadra/analytics.ts:20-24,108-112` · `src/app/dashboard/page.tsx:26-32`

**Escenario, ejecutado — no leído.** `safe()` (`page.tsx:20-22`) atrapa lo que
*lanza*. Ninguna de las tres consultas lanza cuando la base falla: las tres
desestructuran `const { data } = await ...` y tiran el `error` al piso. Reproduje el
cuerpo literal de `getKpis` (`analytics.ts:20-24`) contra un host inalcanzable:

```
error devuelto por supabase-js: {"message":"TypeError: fetch failed", ... ENOTFOUND ...}
data devuelta: null
NO LANZÓ. getKpis devolvió → {"viajesLiquidados":0,"montoComprobado":0,"tasaCuadre":0}
```

(`@supabase/postgrest-js/dist/index.cjs:328` — `if (!this.shouldThrowOnError) res = res.catch(...)`,
y `shouldThrowOnError` es `false` por defecto, línea 147.)

Con eso: `acred`, `kpis`, `liqs` y `anomalias` valen `{…ceros}` / `[]`, **nunca
`null`**. Entonces `errorCarga` (línea 57) es `false`, `sinDatos` (línea 58) es
`true`, y la pantalla que se sirve es la de las líneas 82-90:

> **Aún no hay liquidaciones**
> En cuanto un operador cierre su primer viaje por WhatsApp, aquí aparecerán los acreditables y el detalle.
> `[ Ver el demo ]`

La rama `errorCarga` ("No se pudieron cargar los datos", líneas 75-81) solo puede
dispararse si `supabaseAdmin()` lanza por falta de variables de entorno
(`src/lib/supabase/admin.ts:13`) — el único `throw` del camino. Un error de red, un
500 de PostgREST, una llave rotada o un `grant` que le cierre `liquidacion` al
service-role **no la alcanzan nunca**.

Un **fallo parcial es peor**: si solo revienta `getLiquidaciones` (por ejemplo el
embed `viaje:viaje_id(folio)` de `page.tsx:29` deja de resolver), `liqs` vale `[]`,
no `null`, así que la línea 157 no entra al fallback y se pinta la tabla con
encabezados y **cero filas** debajo de unos KPIs que dicen "Viajes liquidados 12 ·
Monto comprobado $340,000". Dos cifras que se contradicen en la misma pantalla.

Misma raíz en el detalle: `getLiquidacionDetalle` (`analytics.ts:132-140`) devuelve
`null` ante error y `dashboard/[id]/page.tsx:33` responde `notFound()` → *"Esta
página no existe. Puede que el enlace esté mal escrito o que la liquidación ya no
esté disponible."* El contralor hizo clic en una liquidación que sí existe.

**Consecuencia.** En la sala, el presentador no puede distinguir "el tenant está
vacío" de "la base está caída", porque la pantalla es idéntica en los dos casos y
no hay señal de error en ningún lado. El comprador ve un producto que dice no haber
procesado nunca nada.

**Causa raíz probable:** el arreglo se diseñó contra `null` de una excepción, pero
supabase-js reporta los fallos por valor (`{ data: null, error }`), y `analytics.ts`
nunca mira `error` — a diferencia de `src/app/api/export/liquidaciones/route.ts:28`,
donde el mismo autor sí lo comprueba y devuelve 500.

---

### [ALTO] La columna "Diferencia" de la lista borra el signo: no se sabe quién le debe a quién

`src/app/dashboard/page.tsx:167,181` · contraste con `src/app/dashboard/[id]/page.tsx:61-65` · origen del signo en `src/lib/cuadra/cuadre/engine.ts:312-315`

**Escenario con valores.** El motor define `diferencia = anticipo − totalComprobado`
y documenta el signo (`engine.ts:312-314`): `> 0` sobró anticipo (**el operador
regresa dinero**), `< 0` el operador puso de su bolsa (**la empresa le debe**).

- Liquidación A — anticipo $10,000, comprobado $8,500 → `diferencia = +1500`
- Liquidación B — anticipo $10,000, comprobado $11,500 → `diferencia = −1500`

La celda es `{l.diferencia === 0 ? '—' : mxn(Math.abs(l.diferencia))}`. Las dos filas
imprimen **`$1,500.00`**, con la misma tipografía, bajo el mismo encabezado
"Diferencia" (línea 167), y con el mismo estatus (`con_diferencias`: `anticipo` no
está en la lista `REVISAR` de `engine.ts:637`). Nada en la fila las distingue.

**Consecuencia.** El contralor escanea la lista —que es para lo que existe una
lista— y lee "$1,500 de diferencia" como dinero a favor de la empresa, que es la
lectura natural en un panel de liquidación. En la mitad de los casos la empresa
**debe** ese dinero. Solo abriendo el detalle aparece la etiqueta correcta
("A favor de la empresa" / "A favor del operador", `[id]/page.tsx:62`); la página de
detalle ya resolvió el problema y la lista no heredó la solución.

**Causa raíz probable:** `Math.abs()` se puso para evitar el guion del negativo, sin
mover la dirección a otra señal (etiqueta, color o columna).

---

### [ALTO] El panel nunca dice cuánto de lo comprobado es deducible — el PDF sí

`src/app/dashboard/[id]/page.tsx:57-66` · `src/lib/cuadra/analytics.ts:123-129` · `src/lib/cuadra/repo.ts:326-339` · contraste con `src/lib/cuadra/liquidacion/pdf.ts:246-263`

**Escenario.** `types/cuadra.ts:114-119` establece la invariante del producto: *"las
tres cubetas SIEMPRE suman totalComprobado"* — `totalDeducible`, `totalNoDeducible`,
`totalPorConfirmar`. El PDF las imprime (`pdf.ts:246` llama `filasDeducibilidad(liq)`
y pinta "Deducible para ISR / Por confirmar / No deducible" indentadas bajo el total).

El panel no. Dos búsquedas independientes con `command grep` sobre `src/app/`
(nombres exactos, y luego `-i "deduc|pagader|labor|tope15|15%"`) devuelven **cero
coincidencias**. La tarjeta de arriba del detalle dice "Comprobado $47,300" y ahí
termina.

No es solo que la vista no lo pinte: no lo puede pintar. `LiquidacionDetalle`
(`analytics.ts:123-129`) no tiene los campos, `guardar_liquidacion_tx`
(`repo.ts:326-339`) no recibe `p_total_deducible` ni equivalente —compárese con
`p_ieps`, `p_litros_diesel`, `p_iva`, `p_peaje`— y `command grep -rn
"total_deducible|total_no_deducible|total_por_confirmar" supabase/migrations/` no
devuelve nada: las columnas no existen.

**Consecuencia.** Un contralor que revise liquidaciones desde el navegador —el uso
que el panel promete— no puede saber cuánto de esos $47,300 sobrevive una revisión
del SAT. Ese cálculo es el diferenciador del producto y solo existe en un PDF que
alguien tuvo que abrir por separado. Es el mismo hallazgo ALTO que la ronda 3 abrió
(ítem 3) y sigue vivo: **advertencia repetida = hallazgo**.

**Causa raíz probable:** las tres cubetas nacieron para el PDF y nadie extendió la
cadena de persistencia, así que el panel quedó estructuralmente incapaz de mostrarlas.

---

### [MEDIO] Los litros elegibles se imprimen de tres formas distintas en tres pantallas

`src/app/dashboard/page.tsx:208-210` · `src/app/dashboard/[id]/page.tsx:76` · `src/lib/cuadra/liquidacion/pdf.ts:294`

**Escenario con valores.** `litros_diesel_acreditables` es `numeric(12,3)`
(`supabase/migrations/0021_liquidacion_litros_diesel.sql:13`) y el motor lo redondea
a dos decimales (`engine.ts:654`). Con `1234.56` litros, medido:

```
PDF     pdf.ts:294   → 1,234.56 L     (toLocaleString('es-MX') por defecto)
Lista   page.tsx:209 → 1,235 L        (maximumFractionDigits: 0)
Detalle page.tsx:76  → 1234.56 L      (interpolación cruda: `${d.litrosDiesel} L`)
```

Con una sola liquidación de `152.35 L` el salto es aún más visible: la tarjeta grande
del panel dice **152 L** y al hacer clic el detalle dice **152.35 L**.

**Consecuencia.** Es la cifra con la que se abre el panel ("Diésel elegible para el
estímulo", con `destacar` y a `text-5xl`). El contralor la va a comparar con la del
detalle y con la del PDF que le mande a su contador, y le van a salir tres números.
En una cifra fiscal, tres representaciones se leen como tres cálculos.

**Causa raíz probable:** el detalle (`[id]/page.tsx:76`) usa interpolación de plantilla
en vez del formateador; la lista y el PDF sí formatean, pero con opciones distintas y
sin una función compartida — `mxn()` existe en `src/lib/utils.ts` para pesos, y no hay
equivalente para litros.

---

### [MEDIO] `--color-ok` a 2.22:1 es el color de las cifras acreditables del detalle

`src/app/globals.css:20` · `src/app/dashboard/[id]/page.tsx:76-79,125,128`

**Escenario, medido con la fórmula de luminancia relativa de WCAG.** `--color-ok:
#34c759` se aplica como color de **texto** en `Tot(..., ok)` (`[id]/page.tsx:125` →
`style={{ color }}` en el `<div className="text-3xl font-semibold">` de la línea 128),
que es exactamente lo que envuelve las cuatro tarjetas de acreditables (líneas 76-79:
litros de diésel, IEPS, IVA, peaje).

```
#34c759 sobre --surface claro #ffffff = 2.22:1
#34c759 sobre --bg      claro #fbfbfd = 2.15:1
umbral AA para texto grande (≥24px)   = 3.00:1   → NO pasa
#34c759 sobre superficie oscura       = 8.12:1   → pasa (el fallo es solo en claro)
```

`--color-ok` es el único token de color con significado que **no** tiene override en
`@media (prefers-color-scheme: dark)` ni en `:root[data-theme]` — y no lo necesita,
porque el que falla es el modo claro, que es el que va a un proyector.

El propio sistema de diseño del repo ya resolvió esto y el panel no lo copió:
`design-system/styles.css:283` pinta `.tag-ok` con `background: color-mix(... --color-ok 20% ...)`
y **`color: #14602C`** — verde oscuro para el texto, precisamente porque `#34C759` no
sirve como tinta.

**Consecuencia.** "IVA acreditable $12,480" en verde claro sobre blanco, a 2.2:1, en
una sala iluminada y proyectada. Es la cifra que se supone que hace enderezarse al
contralor y es la menos legible de la pantalla.

**Causa raíz probable:** la ronda 3 midió y corrigió `--color-bad` (con comentario en
`globals.css:22-23,54-56`) pero auditó ese token, no la lista de tokens usados como
color de texto.

---

### [MEDIO] La fecha del panel es la fecha UTC: después de las 18:00 hora de México salta un día

`src/lib/cuadra/analytics.ts:150` · `src/app/dashboard/page.tsx:36`

**Escenario con valores.** `liquidacion.created_at` es `timestamptz`
(`supabase/migrations/0001_init.sql:75`) y PostgREST lo entrega en UTC. Las dos
páginas lo cortan con `.slice(0, 10)`, que se queda con la fecha **UTC**. Medido:

```
liquidación cerrada el 31-jul-2026 a las 20:00 hora de Ciudad de México
created_at devuelto : 2026-08-01T02:00:00.000+00:00
panel muestra       : 2026-08-01
realidad en México  : 31/7/2026, 8:00 p.m.
```

CST es UTC−6, así que **todo lo que se cierre después de las 18:00 hora local sale
fechado al día siguiente** — y las liquidaciones se cierran al terminar el viaje, de
noche. El PDF arrastra el mismo desfase por otra vía (`pdf.ts:48-49` usa
`toLocaleDateString` sobre el reloj del servidor, que en Vercel es UTC), y además con
otro formato: "01 ago 2026" en el papel contra "2026-08-01" en la pantalla.

**Consecuencia.** En el corte mensual —el momento en que un contralor abre este
panel— una liquidación del 31 de julio aparece listada en agosto. Y el orden de la
tabla (`created_at desc`, `page.tsx:31`) es correcto mientras la columna que se lee
al lado dice otro día.

**Causa raíz probable:** `.slice(0,10)` sobre un ISO en UTC es el atajo de formateo
más común; el repo tiene `America/Mexico_City` escrito una sola vez
(`src/lib/cuadra/conv.ts:92`) y no lo usa para presentar.

---

### [MEDIO] La tabla de comprobantes del detalle no suma el total que tiene arriba

`src/app/dashboard/[id]/page.tsx:100-114` · `src/lib/cuadra/cuadre/engine.ts:140-144` · contraste con `src/lib/cuadra/liquidacion/pdf.ts:186-190`

**Escenario con valores.** `totalComprobado` excluye duplicados y montos ≤ 0
(`engine.ts:142-144`). El duplicado por folio (`concepto|folio|monto`,
`engine.ts:133-137`) **sí se persiste**: el único unique de la base es por
`cfdi_uuid` (`0019_gasto_cfdi_uuid_unico.sql:21-23`, parcial) y por `img_hash`
(`0015`), así que dos fotos distintas del mismo ticket de caseta producen dos filas.

- Gastos del viaje: Diésel $4,200 · Diésel $3,800 · Caseta $1,400 (CA-4471) · Caseta $1,400 (CA-4471, segunda foto)
- Motor: `totalComprobado = $9,400`, más una diferencia `duplicado` de $1,400.
- Panel, tarjeta de arriba: **Comprobado $9,400.00**
- Panel, tabla "Comprobantes" (`[id]/page.tsx:105-111`): **cuatro filas** que suman
  **$10,800.00**, la duplicada pintada exactamente igual que las demás.

El PDF sí lo resuelve: `filasImprimibles(liq)` (`pdf.ts:190`) omite duplicados y
montos inválidos, con el comentario explícito *"imprimirlos hacía que los renglones
no sumaran el total"*. El panel no usa esa función.

**Refutación intentada, y por eso es MEDIO y no ALTO:** la sección "Diferencias
detectadas" sí lleva la nota *"Comprobante duplicado: Caseta folio CA-4471 por
$1,400.00 aparece dos veces (excluido del total)"*. La información está en la página;
lo que falla es que la tabla la contradice y hay que cruzar prosa contra columna.

**Consecuencia.** El contralor suma la columna con el dedo y le sobran $1,400 contra
el total que tiene tres centímetros más arriba. En un producto cuyo argumento de
venta es "detectamos comprobantes duplicados", el duplicado aparece en la tabla como
un comprobante normal y válido.

**Causa raíz probable:** el panel consulta `gasto` directo por `viaje_id`
(`analytics.ts:141-145`) en vez de reconstruir la vista del motor, y `filasImprimibles`
vive en `liquidacion/` sin que nadie la reutilice.

---

### [MEDIO] El PDF y el CSV existen, están autenticados y no hay forma de llegar a ellos desde el panel

`src/app/dashboard/[id]/page.tsx` (completo) · `src/app/api/export/liquidaciones/route.ts` · `src/lib/cuadra/repo.ts:338`

**Escenario.** `guardar_liquidacion_tx` recibe `p_pdf_url` (`repo.ts:338`) y la
columna `pdf_url` existe (`0001_init.sql:75`), pero `getLiquidacionDetalle`
(`analytics.ts:136`) no la selecciona y ninguna página la renderiza. La ruta
`/api/export/liquidaciones` está escrita, va detrás del mismo passcode
(`route.ts:19-20`), tiene rate-limit y devuelve un CSV con `Content-Disposition:
attachment`. Dos búsquedas independientes con `command grep` sobre `src/app/`
(`"api/export|pdf_url|pdfUrl|\.pdf"` y `"export/liquidaciones"` en todo `src/`)
devuelven **cero** referencias: nada en la interfaz apunta a ninguna de las dos.

**Consecuencia.** En el demo, la pregunta obvia del contralor ("¿y esto lo puedo bajar
a Excel? ¿me da el PDF?") se contesta tecleando una URL a mano. Dos entregables
terminados y probados quedan invisibles.

**Causa raíz probable:** ambas piezas se construyeron desde el backend hacia afuera y
el panel nunca creció el botón.

---

### [BAJO] La fila entera reacciona al cursor pero solo el folio navega, y ese blanco mide ~20px

`src/app/dashboard/page.tsx:155,175,177`

El comentario de la línea 155 dice *"Tabla (cada fila abre el detalle)"*. El `<tr>`
lleva `hover:opacity-80` (línea 175), que es la señal universal de "esto se puede
hacer clic", pero el único `<Link>` envuelve el texto del folio (línea 177). Clic en
Fecha, Comprobado, Diferencia o Estatus: no pasa nada. En tableta no hay hover, así
que el único blanco de navegación de todo el panel es un texto de ~20px de alto
dentro de una celda de `px-6 py-4` — por debajo del mínimo de 44px de toque.

---

### [BAJO] La tabla de comprobantes no tiene encabezados ni orden estable

`src/app/dashboard/[id]/page.tsx:103-113` · `src/lib/cuadra/analytics.ts:141-145`

El `<table>` arranca directo en `<tbody>`: tres columnas (concepto, folio, monto) sin
`<thead>` ni `<th>`. Un lector de pantalla lee tres celdas sueltas por fila y la
columna del folio —que a veces es `—`— no se anuncia como nada. Además la consulta
(`analytics.ts:141-145`) no lleva `.order()`, así que Postgres puede devolver los
comprobantes en distinto orden entre recargas; la tabla equivalente de la lista sí
ordena (`page.tsx:31`). El contenedor usa `overflow-hidden` (línea 102) en vez de
`overflow-x-auto` como la tabla de la lista (línea 160) — lo anoto porque cambió de
significado al perder el `<thead>`, no como estilo.

---

### [BAJO] El esqueleto de carga del detalle es una copia literal del de la lista

`src/app/dashboard/[id]/loading.tsx` (idéntico byte a byte a `src/app/dashboard/loading.tsx`)

Pinta cuatro tarjetas de KPI en `grid-cols-2 md:grid-cols-4` dentro de `max-w-6xl`.
La página que carga (`[id]/page.tsx:46,58`) es `max-w-4xl` con tres tarjetas. El
esqueleto promete una estructura y llega otra: se ve un salto de layout justo en la
transición que el esqueleto existe para suavizar.

---

## Lo que revisé y está bien

**El modo de falla dominante del rubro está cerrado con mecanismo, no con disciplina.**
`src/lib/cuadra/etiquetas_sincronizadas.test.ts` (7 pruebas, las corrí: verdes en
5ms) lee los mapas literales del fuente y compara motor↔panel↔`types/cuadra.ts` para
`CONCEPTO` y lista↔detalle↔tipo para `ESTATUS`. **`flete` entró correctamente**:
`src/app/dashboard/[id]/page.tsx:17` lo tiene con la misma etiqueta que
`engine.ts:690`, y la prueba `'cubren todos los conceptos que el tipo permite'`
(líneas 57-66) habría fallado si no. Comparé a mano los nueve conceptos de
`ConceptoGasto` (`types/cuadra.ts:20-25`) contra el mapa del panel: coinciden uno a
uno. `EstatusLiquidacion` (línea 102) contra los dos mapas `ESTATUS`
(`page.tsx:12-16`, `[id]/page.tsx:20-24`): coinciden, y los dos tienen fallback para
un valor desconocido (`page.tsx:173`, `[id]/page.tsx:34`). El `catalogoCuentas` de
`config.ts:76-83` y la `politica` de `config.ts:57-67` también incorporaron `flete`.
**No hay ningún mapa literal del panel desincronizado del tipo.**

**La premisa del rubro "el panel no tiene lint ni prueba" está desactualizada.**
`eslint.config.mjs` es flat config con `eslint-config-next/core-web-vitals` +
`/typescript` y no excluye `src/app/`; el comentario del archivo documenta que
`next lint` desapareció en Next 16 y que el script estaba roto ("un lint que no corre
se lee como un lint que pasa"). El panel sí está cubierto.

**Cerrado de la ronda 3, verificado numéricamente:** `--color-bad` ya tiene override
en los dos modos (`globals.css:24,57,62`). Medido: 5.38:1 en claro sobre `#ffffff`,
5.29:1 en oscuro sobre `#16161c`. Ambos pasan AA. `--muted` da 4.68–4.83:1, pasa por
poco. El acento pasa 5.13:1 en claro y 9.68:1 en oscuro.

**Cerrado de la ronda 3:** los litros de diésel ya llegan al detalle — migración
`0021` añade la columna, `repo.ts:335` la manda como `p_litros_diesel`,
`analytics.ts:158` la selecciona y `[id]/page.tsx:76` la pinta. El comentario de
`analytics.ts:155-157` documenta el bug que cerró.

**Estados pintados a propósito:** `loading.tsx` y `[id]/loading.tsx` (esqueleto en vez
de pantalla en blanco, con el porqué escrito), `error.tsx` (boundary del segmento con
botón de reintento), `not-found.tsx` (con `<h1>` y salida al panel). Los tres son
deliberados. Cada página tiene un solo `<h1>`. El fallback por sección
(`page.tsx:98,115,157`) evita que una consulta caída tire la pantalla entera — el
diseño es correcto; lo que falla es que el caso de error nunca se alcanza (ver el
CRÍTICO).

**Refutado, no es hallazgo:** en `[id]/page.tsx:92` el monto de una diferencia solo se
pinta si `df.monto > 0`, y las diferencias de tipo `anticipo` pueden ser negativas
(`engine.ts:320`). Revisé: la única diferencia con monto firmado es `anticipo`, y su
`nota` (`engine.ts:322-324`) ya lleva la cifra en el texto — "El operador puso
$1,500.00 de su bolsa". No se pierde información.

**Refutado, no es hallazgo:** los `key={i}` de `[id]/page.tsx:90,106` y `page.tsx:138`
son índices, pero se trata de server components de solo lectura sin reordenamiento en
cliente. No hay filas de dinero que React pueda barajar.

**Refutado, no es hallazgo:** el gate del panel es de dos capas y las dos existen —
matcher del proxy (`src/proxy.ts:18-27`) y `exigirAcceso` dentro de cada página
(`page.tsx:46`, `[id]/page.tsx:30`), esta última con la ruta de vuelta para aterrizar
en la liquidación pedida tras el passcode.

**Aviso al orquestador — no lo reportes como hallazgo.** Mientras auditaba,
`src/lib/cuadra/liquidacion/pdf.ts` cambió bajo mis pies dos veces: a las ~16:50 la
línea 246 decía `const deduc = null;` y la 241 `mxn(liq.totalComprobado * 10)`. A las
16:53 `git diff` estaba vacío y el árbol limpio en `86e23aa`. Es otro auditor haciendo
pruebas de mutación (rubro 9) y revirtiendo. **Ninguna de las dos es un defecto
real**; verifiqué todas mis citas contra el árbol limpio antes de escribir esto.

---

## Lo que NO alcancé a revisar

- **No rendericé nada.** Todo es lectura de código y ejecución de módulos sueltos; no
  levanté `next dev` ni tomé capturas. El contraste y los formatos están **medidos con
  la fórmula y con la salida real de `toLocaleString`**, pero el layout real en un
  proyector, el reflow en móvil y el comportamiento de `backdrop-filter` en la barra
  `glass` no los vi. La memoria del proyecto dice "verificar mirando": esta ronda no
  miré.
- **`design-system/`** (10 archivos HTML/CSS) lo abrí solo para el caso de `.tag-ok`.
  Dos búsquedas confirman que **nada en `src/` lo importa** — es referencia muerta
  respecto del build. No audité si sus componentes divergen del panel.
- **`/demo`** (`src/app/demo/page.tsx`) lo leí completo pero no lo ejercité contra
  `/api/demo`. Noté que `Comprobante.concepto` es `string` sin tipar contra
  `ConceptoGasto` (línea 5) y que los botones siguen activos después de cerrar el
  cuadre —se puede disparar un segundo cierre en la misma conversación—, pero no
  construí el caso que lo rompe, así que no lo escribo como hallazgo.
- **Accesibilidad de teclado y lector de pantalla**: solo revisé estructura (headings,
  `<th>`, `aria-label` del passcode en `acceso/page.tsx:43`). No probé orden de
  tabulación ni foco visible; `globals.css` no define ningún `:focus-visible`, lo cual
  es sospechoso pero no lo verifiqué contra el reset de Tailwind.
- **No verifiqué qué pasa cuando `DEMO_TENANT_ID` no coincide con el tenant que el
  webhook resuelve** (`page.tsx:10`, `[id]/page.tsx:10`, `route.ts:10` — el mismo
  literal `'11111111-…'` repetido en tres archivos). Si divergen, el panel se ve
  vacío por una razón distinta a las del CRÍTICO. Es territorio de backend/datos.
