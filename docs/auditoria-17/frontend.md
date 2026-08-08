# Frontend — auditoría 17

**Nota: 6/10** (antes 8). Razón del movimiento: **mirada más profunda + deuda que
cobró factura**. Los dos cierres que la ronda 13/16 prometieron SÍ están (CifraGrande
sirve `—`, el `?rol=` viaja en el filtro, el action de ARCO resuelve el tenant
efectivo), y los ~20 mapas literales del panel se compararon uno por uno contra
`src/types/likida.ts` y los dominios de las migraciones: **todos cuadran y todos
tienen fallback**. Lo que baja la nota es otra cosa que la 13 no midió: **dos
rótulos del panel afirman un filtro que su consulta no hace** (la regla que
CLAUDE.md llama "un rótulo tiene que ser verdad"), un link interno cruza de flota
en silencio, la pantalla nueva del "Resumen de flota" (`563c507`) reintrodujo el
cero-que-parece-medición que el resto del panel ya tenía cerrado, y el asistente
expandido bajo 1280 px sobrevive su tercera ronda.

Riesgo mayor hoy: el contralor puede leer dos cifras distintas de "Monto
comprobado" a un clic de distancia — una bajo el rótulo "del periodo" que no
filtra nada — y no hay en pantalla nada que explique la diferencia.

## Hallazgos

### [ALTO] "Vencen pronto (≤ 5 días)" cuenta solo lo que YA venció
`src/app/dashboard/arco/page.tsx:71` (cálculo) y `src/app/dashboard/arco/page.tsx:87` (rótulo)

```ts
const vencenPronto = solicitudes.filter((s) =>
  (s.estado === 'recibida' || s.estado === 'en_proceso') && venceEn(s.venceEn) <= hoy);
...
<KpiTile ... etiqueta="Vencen pronto (≤ 5 días)" valor={vencenPronto.length} />
```

Escenario: hoy es 2026-08-08. Tres solicitudes ARCO de operadores están `recibida`
con `vence_en = 2026-08-11` (3 días). `venceEn(s.venceEn) <= hoy` → `'2026-08-11' <=
'2026-08-08'` → **false** para las tres. El tile dice **"Vencen pronto (≤ 5 días): 0"**.
La misma medida en `/admin/compliance:179` sí compara contra `hoy + 5 días` y para
esas mismas tres filas dice **3**. Y en el sentido contrario: una solicitud con
`vence_en = 2026-07-20` (vencida hace 19 días) sí entra en el conteo, así que el
tile mezcla "por vencer" con "ya incumplida" bajo un rótulo que no menciona
ninguna de las dos. Añadido: `hoy` sale de `toISOString()` (UTC), así que después
de las 18:00 CST el corte se corre un día.

Consecuencia: la flota es la responsable obligada a contestar en 20 días hábiles
(LFPDPPP art. 32) y este tile es su único aviso de urgencia. Marca 0 el día que
tiene tres a punto de vencer, y el superadmin —que mira otra pantalla— ve 3. Un
incumplimiento del art. 32 con multa, causado por un rótulo.

Causa raíz probable: la pantalla de `/dashboard/arco` (nacida en la ronda 16) copió
el rótulo de `/admin/compliance` pero no su predicado, y no hay prueba que ate el
texto al cálculo.

### [ALTO] "Comprobación del periodo" en /dashboard/cuadre no filtra por ninguna fecha
`src/app/dashboard/cuadre/page.tsx:67` (consulta), `:86-88` (rótulo), `:117` (segundo rótulo)

`getKpis(tenantId)` se llama **sin** `ventanaDias`; `analytics.ts:49-57` solo aplica
`gte('created_at', corte)` si recibe uno, así que estos KPIs son el **histórico
completo**. Encima van dos rótulos: `"Comprobación del periodo"` y, bajo el gauge,
`"...sobre el total del periodo"`. La página no tiene `GlobalFilter`: no existe
periodo alguno en pantalla.

Escenario: el contralor abre `/dashboard` con el default de 7 días y lee
`Monto comprobado $84,300` bajo `Liquidaciones — últimos 7 días`. Hace clic en
`Ver detalle →` (`page.tsx:403`) y aterriza en `/dashboard/cuadre`, donde bajo
`Comprobación del periodo` lee `Monto comprobado $612,400`. Mismo rótulo de tile,
misma flota, dos clics, 7× de diferencia, cero explicación.

Consecuencia: es exactamente la falla que la auditoría 10 cerró en
`/dashboard/page.tsx:379` y `:402` (donde el título sí lleva `{etiquetaVentana}`) —
solo que aquí el rótulo no está desactualizado, está afirmando un filtro que no
existe. El contralor cruza contra su PDF, no cuadra ninguna de las dos, y deja de
creerle al panel.

Causa raíz probable: `/dashboard/cuadre` se separó de Inicio con el texto de Inicio
pero sin la ventana ni el filtro; la palabra "periodo" nunca se retiró.

### [ALTO] El link "PDF por liquidación" de Analítica pierde el `?tenant=` y salta a la flota demo
`src/app/dashboard/analitica/page.tsx:121`

```tsx
<Link href="/dashboard/cuadre" className="card p-4 ...">
```

Es el **único** `href="/dashboard…"` de todo `src/app/dashboard/` que no arrastra el
sufijo (verificado con `grep -rn 'href="/dashboard' --include=*.tsx | grep -v 'sufijo\|${'`).
La misma página ya calcula `extra` para el `GlobalFilter` en la línea 51 y no lo
reusa aquí.

Escenario: Javier abre `/admin/flotas`, hace clic en "Ver dashboard" de Transportes
Innovativos (`admin/flotas/page.tsx:163` → `/dashboard?tenant=<uuid-innovativos>`),
navega a Analítica (el sidebar sí propaga el sufijo) y hace clic en la tarjeta
"PDF por liquidación". Cae en `/dashboard/cuadre` pelón →
`resolverTenantEfectivo` (tenant-efectivo.ts:120) no ve `sp.tenant`, deja
`tenantId = DEMO_TENANT_ID` y `tenantNombre = null`, así que **tampoco se pinta la
insignia "viendo como superadmin · <flota>"**. La tabla "Detalle por liquidación"
lista folios y montos de la flota demo bajo el mismo cromo, sin una sola señal de
que cambió de empresa.

Consecuencia: en la sala, folios y pesos que no son de la flota que está enfrente,
presentados como suyos. No es fuga de datos (el superadmin ve las dos), es la peor
versión de un error de rótulo: cifras de otra empresa sin aviso.

Causa raíz probable: `sufijoTenant` se aplicó a los links "obvios" (sidebar, "Ver
detalle") y este quedó fuera; nada mecánico lo vigila.

### [ALTO · REINCIDENTE] El asistente expandido deja el panel en blanco si el ancho baja de 1280 px
`src/app/dashboard/rail.tsx:45-50` y `:89`; `src/app/globals.css:217-223`; mismo patrón en `src/app/admin/asistente-expandible.tsx:61`

El rail marca la raíz del documento (`raiz.dataset.asistente = 'expandido'`) y el CSS
apaga la columna de contenido (`:root[data-asistente="expandido"] .columna-centro {
opacity: 0; pointer-events: none }`). El `<aside>` que lleva el botón de contraer es
`hidden xl:flex` (línea 89) — `display:none` bajo 1280 px. La limpieza del `dataset`
vive en el cleanup del efecto, que solo corre al desmontar o al cambiar `expandido`:
**un cambio de ancho no desmonta nada y no toca el estado**.

Escenario: el presentador está en un MacBook de 1440 px de ancho. Expande el
asistente para enseñar el chat a pantalla completa. Para que la sala lea el texto
pulsa ⌘+ una vez (125 % → 1152 px CSS). El `<aside>` desaparece por CSS, pero
`data-asistente="expandido"` sigue puesto: la columna de contenido queda a
`opacity: 0` y `pointer-events: none`. En pantalla quedan el fondo y el sidebar; el
panel del cliente está en blanco y no responde al clic. No hay ningún control
visible que lo revierta — hay que volver a hacer ⌘− o recargar.

Consecuencia: el panel del comprador en blanco a media demostración, y el
presentador sin nada que tocar para arreglarlo. Lo mismo pasa al reducir la ventana,
al conectar un proyector de 1024 px, o al rotar una tableta.

Causa raíz probable: el estado de "expandido" vive en React y la visibilidad del
rail vive en CSS; nadie reconcilia los dos cuando cambia el breakpoint. La ronda 12
arregló el desbordamiento horizontal (`marco.ts:64-73`), no este.

### [MEDIO] "Viajes activos 0" y "Aún no hay viajes registrados" cuando la consulta falló
`src/app/dashboard/page.tsx:255` y `src/app/dashboard/page.tsx:273-279`

```tsx
<KpiDegradado ... etiqueta="Viajes activos" valor={viajesActivos ?? 0} formato="entero" />
...
{kpis && totalViajes !== null && totalViajes !== undefined && totalViajes > 0
  ? <Dona .../>
  : <p>Aún no hay viajes registrados.</p>}
```

`contarViajes` devuelve `null` **a propósito** ante un error, y su comentario lo dice
con todas las letras (`src/lib/likida/analytics.ts:436-443`): *"`null` ≠ 0 … Quien
llame enseña '—' y dice que no se pudo contar."* Aquí se hace lo contrario.
Y `estadoPanel` (`dashboard/estado.ts:30`) solo mira `acreditables/kpis/
liquidaciones/anomalias`: si **solo** falla `contarViajes`, no se pinta la banda
"Faltan datos por cargar" y el cero sale sin ningún aviso.

Escenario: la flota trae 14 viajes `abierto`/`en_cuadre`. La consulta de conteo
sobre `viaje` falla (timeout de PostgREST). Las demás responden. El contralor abre
el panel y lee, en la tarjeta con degradado de marca del encabezado, **"Viajes
activos 0"**, y debajo **"Aún no hay viajes registrados."** — una afirmación sobre
su negocio hecha estando ciego. El mismo dato en el panel del encargado
(`inicio-operacion.tsx:101`, `tablero?.viajesActivos ?? '—'`) y en
`/dashboard/viajes:91-95` (`vacio={totalViajes === null ? 'No se pudo contar' : undefined}`)
se pinta correctamente: **tres pantallas, dos criterios**.

Consecuencia: el cero se lee como medición en la pantalla de aterrizaje del dueño.
`KpiDegradado` (`resumen-visual.tsx:19-26`) ni siquiera acepta un `valor` ausente —
su prop es `valor: number`, así que hoy no hay forma de que diga `—`.

Causa raíz probable: el "Resumen de flota" (`563c507`) estrenó `KpiDegradado` sin la
prop `vacio` que `KpiTile` sí tiene, y el call site rellenó con `?? 0`.

### [MEDIO] "Litros elegibles para el estímulo: 0.00 L" con la cita legal debajo, cuando la consulta falló
`src/app/dashboard/combustible-casetas/page.tsx:183`

```tsx
<KpiTile ... etiqueta="Litros elegibles para el estímulo"
  valor={acred?.litrosDiesel ?? 0} formato="litros"
  nota="LIF 2026, Art. 20-A" />
```

El tile vive dentro de la rama `porConcepto !== null`, pero `acred` viene de un
`safe()` **independiente** (`getAcreditables`). Los otros tres tiles de esa misma
grilla sí distinguen el fallo: `pctSinCfdi === null` dispara la prop `vacio`
(línea 186-188).

Escenario: `getGastoPorConcepto` responde y `getAcreditables` no. La pantalla pinta
`Gastado en combustible $412,900 · 118 cargas registradas` al lado de
`0.00 L · Litros elegibles para el estímulo · LIF 2026, Art. 20-A`. El contralor
concluye que ninguno de sus 118 tickets de diésel califica para el estímulo — que
es justo la cifra por la que compra el producto — y no hay nada en pantalla que
diga que no se pudo leer.

Consecuencia: un cero fiscal con fundamento legal citado al lado, indistinguible de
una medición. Es la misma clase de fallo que `CifraGrande` cerró en la ronda 13.

Causa raíz probable: los cuatro tiles se agruparon bajo la guardia de una sola de
las consultas.

### [BAJO] /mis-viajes imprime "$0.00 comprobado" en viajes sin liquidar
`src/app/mis-viajes/page.tsx:108` (`{mxn(v.comprobado)}`) y `:116` (`Sin liquidar`)

`comprobado: Number(liq?.total_comprobado ?? 0)` (línea 57): sin fila de
`liquidacion`, el valor es 0.

Escenario: el operador Juan lleva 9 tickets mandados por WhatsApp de un viaje
`abierto`. Abre `/mis-viajes` y ve la fila `VJ-2026-1041 · $0.00 · Sin liquidar`.
`/chofer` para el mismo viaje dice *"Todavía no se cierra la liquidación de este
viaje"* y no imprime ningún monto (`chofer/vista.tsx:468-472`).

Consecuencia: el chofer lee "$0.00" como "no me contaron nada" y reenvía las nueve
fotos, o le habla a la oficina — exactamente el comportamiento que el docstring de
`chofer/error.tsx` dice querer evitar. Es BAJO porque `/mis-viajes` es el panel
antecesor (`proxy.ts:100`) y `inicioDe('operador')` ya manda a `/chofer`, pero la
ruta sigue viva y gateada.

Causa raíz probable: `/mis-viajes` no se retiró ni se alineó cuando `/chofer` lo
sustituyó.

### [BAJO] El panel le dice al dueño que sus choferes usan una ruta que ya no es la suya
`src/app/dashboard/usuarios/page.tsx:16`

`operador: 'No entra a este panel: usa WhatsApp y /mis-viajes'` — pero
`visibilidad.ts:138` manda al rol `operador` a `/chofer`, y `/chofer` es el panel
móvil real (4 pestañas, diseñado para cabina). Un flota_admin que lea esa línea y
le pase `/mis-viajes` a su chofer le da la pantalla vieja de solo lectura, con el
`$0.00` del hallazgo anterior.

Consecuencia: soporte y expectativas mal puestas desde la única pantalla del panel
que explica los roles.

### [BAJO] `HBars` usa el nombre humano como key de React en una lista de dinero
`src/app/admin/ui/graficas.tsx:93` (`key={d.etiqueta}`) alimentado desde `src/app/dashboard/page.tsx:345` (`etiqueta: o.nombre`)

`getOperadoresDetalle` devuelve una fila por `operador.id`, no por nombre. Dos
choferes homónimos en la misma flota ("JOSÉ LUIS HERNÁNDEZ" es común) producen dos
hijos con la misma key en la lista "Top operadores por gasto", que además se ordena
por `comprobadoTotal` descendente (línea 343) — o sea que reordena cuando entra un
gasto nuevo. React avisa por consola y la reconciliación de las dos filas homónimas
queda indefinida; la transición de ancho (`graficas.tsx:99`, delay por índice) es lo
primero que se descoloca.

Consecuencia: deuda. Hoy el síntoma es una advertencia en consola y una barra que
anima mal; el día que esa lista gane interacción, es una fila de dinero atribuida al
chofer equivocado. La misma pieza recibe `etiqueta: r.ruta` y `etiqueta: c.concepto`
en otros call sites, que sí son claves únicas — la debilidad es del contrato de
`HBars`, no del dato.

## Lo que revisé y está bien

**Cierres verificados de rondas anteriores**

- `CifraGrande` sirve `—` y no `$0.00` con la consulta caída: `src/app/dashboard/cifra-grande.tsx:60` (`valor === undefined ? '—' : fmt(mostrado)`), y el call site pasa `undefined` de verdad — `src/app/dashboard/page.tsx:176` (`valor={kpis ? kpis.diferenciaDetectada : undefined}`). **Cerrado.**
- `?rol=` preservado por el filtro 7d/30d: `src/app/dashboard/page.tsx:435-442` (`sufijoTenantParams`) y `src/app/dashboard/sufijo.ts:24-25`. Cubierto por `sufijo.test.ts`. **Cerrado.**
- Tenant efectivo en el action de ARCO: `src/app/dashboard/arco/page.tsx:39-43` resuelve `?tenant=` con `resolverTenantPedido` dentro del `'use server'`, no del closure del render. **Cerrado.**
- Carga fail-cerrado en ARCO: `src/app/dashboard/arco/page.tsx:62-68, 95-99` — una base caída dice "no se pudieron leer las solicitudes", no "ninguna registrada". **Cerrado.**

**Los mapas literales del panel contra `src/types/` y los dominios de la base** (trabajo obligatorio del rubro — se revisaron los 20 `Record<…>` de `src/app/`):

- `CONCEPTO` en `src/app/dashboard/[id]/page.tsx:28-32` — las 9 claves de `ConceptoGasto` (`types/likida.ts:20-25`), y además ya no es quien pinta: `etiquetaGasto:392-395` delega en `etiquetaConcepto` del motor, con `ocrExtra`. `label()` (`engine.ts:1200-1203`) cubre las mismas 9. Atado por `etiquetas_panel.test.ts`.
- `ESTATUS` en `src/app/dashboard/estatus.ts:17-27` — los 3 de `EstatusLiquidacion`, con `etiquetaEstatus()` devolviendo la clave cruda para lo desconocido. Copia idéntica y correcta en `contador/liquidaciones/page.tsx:36` y `mis-viajes/page.tsx:9`.
- `ESTATUS_VIAJE` en `src/app/dashboard/viajes/vista.tsx:23-27` y `ESTATUS_ETIQUETA` en `resumen-visual.tsx:93-97` — los 3 de `viaje_estatus_dominio` (0025), ambos con `??`.
- `TIPOS`/`PRIORIDADES`/`ESTADOS` en `src/app/dashboard/incidencias/vista.tsx:11-23` — coinciden exacto con `incidencia_tipo_dominio` / `_prioridad_` / `_estado_` de `0047_operacion_encargado.sql:111-115`.
- `ESTADO_UNIDAD` en `unidades/vista.tsx:15-20` — los 4 de `unidad_estado_dominio` (0047:46-47).
- `etiqueta()` de POD en `pod/vista.tsx:13-19` — los 3 de `pod_estado_dominio` **más** `null`, distinguido a propósito ("nadie lo ha pedido" ≠ "pedido, sin llegar").
- `ETIQUETA_TIPO`/`ETIQUETA_ESTADO` de ARCO en `arco/page.tsx:14-16` y `admin/compliance/page.tsx:14-19` — los 4+4 de `arco_tipo_dominio`/`arco_estado_dominio` (0053:113-114).
- Los cinco roles: `dashboard/usuarios/page.tsx:12-18`, `dashboard/chrome.tsx:26-32`, `admin/equipo/page.tsx:12-18` (tipado `Record<RolAppUser, …>`), `admin/mi-perfil/page.tsx:9-11` — todos completos contra `app_user_rol_dominio` (0044).
- `FASE_LABEL` (4 copias: `admin/page.tsx:21`, `admin/analitica:11`, `admin/costos-facturacion:63`, `dashboard/valor-ahorro:12`) — las 6 de `FaseCosto` (`lib/likida/costos.ts:41`), todas con `?? f.fase`.
- `ESTADO_PILL` en `suscripcion/page.tsx:32` y `ICONO_GRAVEDAD`/`TEXTO_GRAVEDAD` en `contador/deducciones/page.tsx:45-55` — `Record<Tipo, …>` tipados: un valor nuevo del tipo rompe la compilación. Es el patrón correcto.
- `FORMAS_PAGO` en `contador/comun.tsx:149-158` — parcial **a propósito y bien documentado**: una clave desconocida se imprime cruda (`etiquetaFormaPago:161-164`) en vez de traducirse a "Otro".
- `MOTIVO_ERROR` en `combustible-casetas/page.tsx:29-35` — los 5 motivos de `ResolucionLineaManual`, con fallback.

**Formato de cifras.** Una sola fuente confirmada: `src/lib/formato.ts` (`utils.ts:12` reexporta, `dashboard/formato.ts:27` reexporta, `admin/ui/formato-preset.ts:1` importa). `formato.test.ts` bloquea `toLocaleString('es-MX')` fuera de ahí y sigue verde.

**Estados vacío / cargando / error pintados a propósito** (muestra abierta y leída):
`rentabilidad/page.tsx:44-60` (distingue "no se pudo calcular" de "falta capturar el
ingreso" y declara el tamaño del hueco en `:99-108`), `clientes/page.tsx:47-62`,
`cobranza/page.tsx:50-64`, `contador/comun.tsx:36-100` (`safe` + `AvisoDeFallo`, que
distingue "no se pudo leer" de "lectura incompleta" y **no pinta ninguna cifra** en
ninguno de los dos casos), `inicio-operacion.tsx:99-134, 147-181` (cada sección con
su propio `null`, y la cifra de cabecera en `—`), `[id]/page.tsx:297-305` (tabla de
comprobantes vacía explicada), `avance-cierre.tsx:74-78, 107-118` (sin viajes no se
dibuja la barra fantasma), `chofer/vista.tsx:242-268` (misma regla), `cargando.tsx`
(`role="status"`, `aria-label`), `chofer/loading.tsx`, `global-error.tsx` +
`dashboard/error.tsx` + `chofer/error.tsx` (los tres con `digest` en pantalla,
`select-all`, y línea de log; ninguno filtra stack ni mensaje crudo).

**Autorización de la UI.** `sidebar-nav.tsx:94` filtra con la MISMA
`puedeVerRuta` que gatea la página (`tenant-efectivo.ts:105`), así que no hay
links que reboten. `AREA_POR_RUTA` (`visibilidad.ts:63-110`) cubre las 27 rutas de
`dashboard/rutas.ts`; una ruta nueva sin clasificar cae a `undefined` y se niega.
`chrome.tsx:57-61` esconde la insignia SUPERADMIN solo para superadmin y la cinta
`AvisoRol` la sustituye. `[id]/page.tsx:47` pasa por `rolEfectivo` y re-chequea el
permiso dentro de los dos server actions (`:104`, `:131`).

**Contraste.** `contraste.test.ts` mide `--color-ok`, `--color-bad` y `--faint`
sobre `--surface` y `--bg` leyendo el CSS real. Recalculé a mano los tokens que la
prueba NO cubre y todos pasan AA para texto normal sobre blanco: `--ok` #137a38
(5.4:1), `--warn` #9a5c00 (5.4:1), `--bad` #b91c1c (6.5:1), `--muted` #6b7280
(4.8:1), `--accent` #c2410c (5.2:1). El caso peor del "Resumen de flota" —blanco al
85 % de opacidad sobre el extremo naranja del degradado de `KpiDegradado`
(`resumen-visual.tsx:31,34`)— mide **4.52:1**: pasa, pero sin margen.

**Toque y responsive.** `/chofer` declara y cumple `TOQUE = {normal:48, principal:56}`
(`vista.tsx:39`, aplicado en `:196`, `:457`, `nav.tsx:64`), con
`env(safe-area-inset-bottom)`. La fila de `/dashboard/cuadre:194-197` estira el
`<Link>` con un pseudo-elemento para que la fila entera sea blanco de toque. Todas
las tablas que revisé van dentro de `overflow-x-auto` (`cuadre:174`, `viajes/vista:95`,
`incidencias/vista:77`, `[id]/page:307`, `page.tsx:366`, `arco:106`).

**Compuerta.** `npx tsc --noEmit -p .` → 0 errores. `npx vitest run` → 249 archivos,
3 148 pruebas verdes, 1 saltada. Igual a la línea base del MAPA.

## Lo que NO alcancé a revisar

- **Nada se renderizó.** No corrí `npm run build` ni levanté un preview con
  screenshot (no hay credenciales en este entorno, y el MAPA lo prohíbe). Todo lo
  visual de arriba —el contraste del degradado, el desbordamiento del asistente, el
  recorte de etiquetas— está **leído y calculado, no mirado**. El hallazgo del
  asistente bajo 1280 px está derivado del código (estado React + `hidden xl:flex` +
  la regla de `globals.css`), no reproducido en un navegador.
- **`/admin` en profundidad.** Abrí `page.tsx`, `analitica`, `compliance`,
  `costos-facturacion`, `equipo`, `mi-perfil`, `model-ops`, `ui/kit`, `ui/graficas`,
  `ui/global-filter`, `charts` y `asistente-expandible`. Las otras ~20 páginas de la
  consola interna (soporte, trust-safety, whatsapp-infra, observabilidad,
  conocimiento-rag, playground, calidad-evals, capacidad-forecast, crecimiento,
  integraciones, notificaciones, dev, salud-sistema, vista-chofer, comunicacion,
  conversaciones, agente-*) quedaron sin abrir. Son la consola de Javier, no la del
  comprador, pero el rubro las incluye.
- **`ui/graficas.tsx` completo.** Revisé `HBars` y las keys; `MultiLine`, `Gauge`,
  `Waterfall`, `MarginDivergingBars`, `Heatmap` (líneas 109-560) no se auditaron por
  degeneración de datos (series vacías, todos-ceros, un solo punto, valores
  negativos).
- **Accesibilidad más allá de contraste y toque.** No revisé orden de foco,
  navegación por teclado en los `<select>`/`<form>` de despacho, incidencias y POD,
  anuncios de `aria-live` tras un server action (`FormaConAviso`), ni lectores de
  pantalla sobre las tablas de dinero.
- **Los `key={i}` restantes.** `[id]/page.tsx:277` (diferencias),
  `cuadre/page.tsx:135` (anomalías), `resumen-visual.tsx:80` (vencimientos),
  `demo/page.tsx:91,106` — todos sobre listas que hoy no se reordenan en cliente. No
  los verifiqué uno por uno contra un re-render.
- **`/dashboard/despacho`, `documentos`, `facturacion`, `politicas`, `configuracion`,
  `soporte`, `cotizador`, `chat`, `contador/retenciones`, `contador/cfdi/export`**:
  solo hojeadas por el `grep` de `?? 0` y de links, no leídas completas.
