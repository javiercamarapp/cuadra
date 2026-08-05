# Arquitectura y mantenibilidad — auditoría 11 (pase 2)

Ancla: `claude/auditoria-11` @ `707c749`. Compuertas corridas por mí, hoy, sobre
este árbol:

```
npx tsc --noEmit -p .  → exit 0
npm run lint           → exit 0, cero warnings
npx vitest run         → 266/269 archivos, 2524/2530 pruebas
```

Nota de método: la suite NO me sale en verde como dice `MAPA.md:155`. Fallan 5
pruebas en 3 archivos —`intake/ocr_imagen_cara.test.ts` (bytes de un JPEG
reencodeado), `intake/ocr_varias_fotos.test.ts` (timeout de 5 s) y
`normas/fundamento.test.ts:144` (`expected 900 to be less than 500`)—. Las tres
son dependientes del entorno (encoder de imagen y relojes), ninguna toca
frontera ni duplicación, y ninguna sostiene un hallazgo mío. Lo digo porque la
línea base publicada y la medida no coinciden, y eso sí es del rubro de
pruebas/operabilidad.

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió.** Once de
mis dieciséis hallazgos del pase 1 están cerrados, y cerrados con el mecanismo
que este rubro premia: **se borró el duplicado en vez de vigilarlo**, y donde
quedó una copia se le puso un **tipo** que no compila si diverge. `safe()`
pasó de 16 copias a una función con log (`pg.ts:98`); `FASE_LABEL` de cinco
literales a un `Record<FaseCosto,string>` (`admin/fases.ts:34`); `ROL_LABEL` de
cinco a un `Record<RolAppUser,string>` (`admin/roles.ts:18`); las ocho copias
de "¿a qué flota apunta esta página?" a `flotaSuplantada()` +
`resolverTenantDeAction()` (`tenant-efectivo.ts:47,84`), con `exigir()` y con
log de suplantación; `passcode.ts` y `/acceso` **borrados**, con
`acceso_retirado.test.ts` para que no vuelvan; el ordinal duplicado de
migraciones dejó de ser un punto ciego y hoy es un rojo
(`migraciones_verificadas.test.ts:137`). Eso no es prosa: es el archivo que
desaparece.

Lo que impide el 7 son tres reincidencias y una costura nueva. La costura es
el hallazgo central: **hay dos tablas de permisos** —`permisos.ts` (qué acción)
y `visibilidad.ts` (qué pantalla)— y el arreglo que puso puerta a `/api/export`
consultó **una sola**. `puedeExportar('encargado')` es `true` y
`puedeVerArea('encargado','dinero')` es `false`; el endpoint solo pregunta lo
primero.

**El riesgo mayor del rubro, hoy:** el jefe de tráfico —el rol para el que se
escribió `visibilidad.ts` entero— baja por `curl` el CSV con el anticipo, lo
comprobado y la diferencia de cada liquidación de la flota, porque la ruta de
API se gatea con la otra tabla.

---

## Hallazgos

### [CRÍTICO] Dos tablas de permisos gobiernan el mismo dinero, y las rutas de API consultan la que no lo niega
`src/lib/auth/permisos.ts:21` · `src/lib/auth/visibilidad.ts:41` ·
`src/lib/auth/visibilidad.ts:89-99` ·
`src/app/api/export/liquidaciones/route.ts:29` ·
`src/app/api/export/pdf/[id]/route.ts:41` ·
`src/app/api/export/liquidaciones/autorizacion.test.ts:106-119`

El repo tiene hoy **dos** fuentes de autorización, y las dos están bien hechas
por separado. `permisos.ts:21` dice quién puede exportar:

```
const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
```

`visibilidad.ts:41` dice qué pantallas existen para cada rol:

```
encargado: ['operacion'],
```

y `visibilidad.ts:89-99` clasifica `/dashboard/cuadre`, `/dashboard/viajes`,
`/dashboard/analitica` y `/dashboard/documentos` como `'dinero'` — con el
comentario de las líneas 77-88 explicando que se movieron ahí porque
«enseñarle el margen de la flota a un puesto medio no es un detalle de UI».

Las dos rutas de export preguntan **solo** por la primera:
`liquidaciones/route.ts:29` es `if (!puedeExportar(s.rol)) return 403` y
`pdf/[id]/route.ts:41` es la misma línea. No hay una segunda comprobación:
`proxy.ts:108` excluye `/api` del matcher, y la consulta corre con
`supabaseAdmin()` (service-role, salta RLS).

**Escenario, con valores.** Fila creada desde `/admin/usuarios/nuevo`:
`{rol:'encargado', tenant_id:'11111111-…'}` — el jefe de tráfico de
Transportes Innovativos. Entra por magic link, aterriza en `/dashboard`
(`inicioDe('encargado')`), y el panel se comporta como está diseñado: sin
Cuadre, sin Viajes, sin Analítica, sin Documentos, sin una cifra de dinero.
Abre la consola del navegador y hace `fetch('/api/export/liquidaciones')` con
su propia cookie. `getSessionTenant()` devuelve `tenantId` no nulo y
`rol:'encargado'`; `puedeExportar('encargado')` es `true`; pasa. Sale el CSV
que arma `toLiquidacionRows` (`export.ts:4-13`) para **todas** las
liquidaciones de la flota, paginado sin tope práctico por `traerTodo`:

```
folio_viaje, operador, fecha, total_comprobado, anticipo, diferencia, estatus, num_diferencias
```

Con un `id` de liquidación, `GET /api/export/pdf/<id>` le devuelve además una
URL firmada del **ejemplar del contralor** —el que lleva los veredictos—, por
la misma puerta.

`autorizacion.test.ts` prueba `operador` (403), un rol desconocido (403),
`contador` (200) y `flota_admin` (200). **No prueba `encargado`**, que es
exactamente el rol donde las dos tablas discrepan.

Consecuencia: el módulo `visibilidad.ts` completo —cuya cabecera dice que se
escribió porque «RLS no puede resolver esto»— queda sin efecto para el rol que
lo motivó, por un endpoint. Para el equipo: cada regla nueva de "qué ve quién"
hay que escribirla dos veces, en dos archivos, y nada falla si solo se escribe
en uno.

Causa raíz: el arreglo D3 le puso puerta a `/api/export` con la tabla de
ACCIONES; el arreglo del rail (`asistente/route.ts:79`) se la puso con la
tabla de PANTALLAS. Dos arreglos correctos que juntos no lo son — la costura
que `MAPA.md:75-77` anticipó.

### [ALTO] "Ver como" tiene una TERCERA implementación —el `extra` del filtro de rango— y es la única que no conoce `?rol=`
`src/app/dashboard/page.tsx:228` · `src/app/dashboard/analitica/page.tsx:60,73` ·
`src/app/dashboard/sufijo.ts:26-33` · `src/app/dashboard/sidebar-nav.tsx:98-99` ·
`src/app/dashboard/ver_como_rol.test.ts:84-98`

El pase 1 reportó que `?rol=` vivía en tres sitios con tres reglas. Dos se
arreglaron: `sufijo.ts:26-33` ahora arrastra `tenant|vista` **y** `rol`, y
`sidebar-nav.tsx:98-99` igual. Pero `GlobalFilter` no recibe el sufijo: recibe
un `extra` que las dos páginas que lo montan construyen **a mano**, con el
ternario viejo:

```
page.tsx:228        extra={sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined}
analitica:60-61     const extra = sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined;
```

`global-filter.tsx:32` arma el link con `new URLSearchParams(extra)` y añade
`rango`. Lo que no esté en `extra` no viaja.

**Escenario, con valores.** Javier abre `/dashboard?rol=encargado` delante del
contralor para enseñarle qué ve su jefe de tráfico. Funciona: `rolEfectivo`
devuelve `'encargado'`, la raíz pinta `inicio-operacion.tsx` sin cifras de
dinero y `aviso-rol.tsx` (montado en `chrome.tsx:101`) pinta la cinta «estás
viendo como Jefe de tráfico». El contralor pregunta «¿y en el mes?». Javier
hace clic en el pill **30d** — el control que está ahí para eso. El link es
`/dashboard?rango=30`: `?rol=` se cayó. La página vuelve a correr como
superadmin, aparecen IVA acreditable, IEPS, litros, el detector de anomalías y
la barra de avance de cierre, y la cinta que decía "estás viendo como" se
apaga. Con `?tenant=<uuid>&rol=encargado` pasa lo mismo: el tenant sobrevive,
el rol no.

`ver_como_rol.test.ts` no lo caza porque comprueba **el tipo** que cada página
declara (`/searchParams: Promise<SearchParamsPanel>/`), no la propagación en
los links; y `analitica/page.tsx` declara `SearchParamsPanel`, así que pasa en
verde con el `extra` mutilado tres líneas más abajo.

Consecuencia: la demostración de separación de roles se contradice sola con un
clic, delante del comprador. Para el equipo: la regla de qué parámetros
arrastra un link interno sigue existiendo en tres formas, y la que se olvidó
es la única sin guardarraíl.

(REINCIDENTE — pase 1, ALTO H4. Se cerraron dos de las tres implementaciones.)

### [ALTO] `/dashboard/[id]` es la única página con datos fuera del chokepoint, y por eso queda fuera de los tres guardarraíles
`src/app/dashboard/[id]/page.tsx:39` · `src/app/dashboard/[id]/page.tsx:43,49` ·
`src/app/dashboard/[id]/page.tsx:61,85` · `src/app/dashboard/[id]/page.tsx:71` ·
`src/app/dashboard/cuadre/page.tsx:210` · `src/lib/auth/tenant-efectivo.ts:118-126`

`tenant-efectivo.ts:118-126` afirma que se gatea ahí porque «todas las páginas
de /dashboard con datos ya pasan por esta función». Conté las 24 `page.tsx`:
17 llaman a `resolverTenantEfectivo`, 6 son stubs que llaman a
`exigirVerRuta`, y **una no hace ninguna de las dos**: la pantalla de detalle
de liquidación, que es la que enseña el dinero de un viaje. Usa
`requireSessionTenant` + `puedeVerArea(rol,'dinero')` a mano (líneas 43 y 49).

Estar fuera del chokepoint le cuesta tres cosas a la vez:

1. **Ignora `?rol=`.** Su tipo es `searchParams: Promise<{ tenant?: string }>`
   (línea 39): sin `rol`, `sp.rol` es `undefined` y nunca se llama a
   `rolEfectivo`. Y `ver_como_rol.test.ts:76` filtra por
   `src.includes('resolverTenantEfectivo(')`, así que esta página **no entra
   en la lista** que el guardarraíl revisa.
2. **Conserva dos de las ocho copias que se consolidaron.** Líneas 61 y 85
   siguen siendo `const { data: t } = await supabaseAdmin().from('tenant')…`
   con el `error` descartado y sin `acotada`. La copia de la línea 85 está
   dentro del server action `reasignar`.
3. **`visibilidad_dinero.test.ts` la salta por diseño** (las rutas dinámicas
   no tienen entrada en `AREA_POR_RUTA`).

**Escenario, con valores.** Javier abre `/dashboard/cuadre?tenant=<uuid de
Transportes Innovativos>&rol=contador` para enseñarle al contralor que su
contador no puede mover choferes. La pantalla obedece. Hace clic en el renglón
de una liquidación; `cuadre/page.tsx:210` arma
`/dashboard/<uuid-liq>?tenant=<uuid>&rol=contador` — el sufijo **sí** lleva el
rol, arreglado esta ronda. La página de detalle lo tira: `rol` sale de
`requireSessionTenant` y vale `'superadmin'`, así que `puedeAsignar(rol)`
(línea 71) es `true` y **se pinta el formulario "Reasignar operador"**. En la
previsualización del rol que la matriz de permisos define como «solo lectura y
exportar», Javier acaba de enseñar que el contador reasigna choferes. Y el
`<form>` funciona de verdad: el action revalida contra el rol REAL.

Segundo escenario, de mantenimiento: el día que se cambie la regla del
override —p. ej. exigir `tenant.activo`— se edita `flotaSuplantada`
(`tenant-efectivo.ts:47`), que es «un solo lugar», y estas dos copias se
quedan con la regla vieja sin que nada falle.

Consecuencia: la excepción al chokepoint es justamente la pantalla de dinero,
y las tres pruebas que existen para que esto no pase la excluyen cada una por
su propio motivo. Para el equipo, "todas las páginas con datos pasan por aquí"
es un rótulo que no es verdad.

(REINCIDENTE parcial — pase 1, ALTO H3 y ALTO H4: se cerraron 6 de 8 copias y
16 de 17 páginas; el residuo de las dos es la misma página.)

### [MEDIO] El dominio de `viaje.estatus` está escrito en cinco literales, no tiene tipo, y creció esta ronda
`src/lib/cuadra/operacion.ts:22` · `src/lib/cuadra/conv.ts:130` ·
`src/app/dashboard/viajes/page.tsx:21` · `src/app/dashboard/viajes/page.tsx:59` ·
`src/app/dashboard/incidencias/page.tsx:128` · `src/types/cuadra.ts`

`EstatusLiquidacion` sí es un tipo, y `dashboard/estatus.ts` +
`etiquetas_sincronizadas.test.ts:119` lo atan a su mapa de etiquetas. El
dominio de **viaje** no tiene tipo en `src/types/cuadra.ts` (grep de
`EstatusViaje`: cero). Vive solo en el `check` de la 0025 y en cinco literales
de código, que hoy dan cinco respuestas a "¿qué viaje sigue en curso?":

```
operacion.ts:22        const SIN_CERRAR = new Set(['abierto', 'en_cuadre']);   // enumera
conv.ts:130            .in('estatus', ['abierto', 'en_cuadre'])                // enumera
viajes/page.tsx:59     viajes.filter((v) => v.estatus !== 'liquidado')         // niega
incidencias/page.tsx:128  .filter((v) => v.estatus !== 'liquidado')            // niega  ← NUEVO
viajes/page.tsx:21     const ESTATUS_VIAJE: Record<string, {label,estado}>     // 3 claves, sin tipo ← NUEVO
```

El pase 1 contó tres. Hay cinco: los dos de `/dashboard/incidencias` y
`ESTATUS_VIAJE` llegaron con el código de esta ronda.

**Escenario, con valores.** Se agrega `'cancelado'` al `check` — el candidato
plausible, porque `/dashboard/despacho` ya crea viajes desde el navegador y un
viaje mal capturado hoy no tiene salida. Flota con 40 viajes, 6 cancelados,
anticipo de $8,000 cada uno. `/dashboard/viajes` pinta «Abiertos (sin
liquidar): N+6» y suma **$48,000** de más en el KPI «Anticipo en viajes
abiertos» (`viajes/page.tsx:61`, `formato="mxn"`). `/dashboard/despacho` pinta
`viajesActivos` sin ellos (`operacion.ts:443`). Y `ESTATUS_VIAJE` no conoce la
clave, así que la columna Estatus de esa misma tabla imprime **`cancelado`** en
crudo, en gris, al lado de "Abierto" y "Liquidado".

Consecuencia: dos pantallas del mismo panel, la misma flota, el mismo minuto,
dos cifras de viajes abiertos — y una es dinero. Es la regla "nunca inventar
una cifra" rota por la vía de la duplicación.

(REINCIDENTE — pase 1, MEDIO H12. Empeoró: 3 → 5 literales.)

### [MEDIO] La pantalla de Usuarios & Roles dice que su texto sale de `permisos.ts`, y ya lo contradice
`src/app/dashboard/usuarios/page.tsx:20-30` · `src/lib/auth/permisos.ts:21`

El comentario de la línea 21 es textual: «qué puede cada uno — el texto sale de
`lib/auth/permisos.ts`, que es quien de verdad decide». No sale de ahí: es un
`Record<string, string>` escrito a mano cuatro líneas abajo, sin tipo y sin
nada que lo ate. Y ya dice algo falso:

```
usuarios/page.tsx:26   encargado: 'Operación y asignación de viajes — sin finanzas'
permisos.ts:21         EXPORTA = new Set([… 'encargado' …])
```

**Escenario, con valores.** El 6-ago el contralor abre «Usuarios & Roles» para
decidir a quién da de alta. Lee que el encargado no toca finanzas y da de alta
a su jefe de tráfico con ese rol. Lo que compró es lo del CRÍTICO de arriba:
ese usuario puede bajar el CSV con el anticipo y la diferencia de cada
liquidación. La pantalla que existe para que el cliente entienda el modelo de
permisos es la que se lo describe mal.

Consecuencia: para el equipo, cambiar `EXPORTA` o `ASIGNA` exige acordarse de
editar una prosa en otro archivo, y nada falla si no se hace. Es el mismo
patrón que `permisos.ts` tenía en el pase 1 (decía gobernar la API sin
gobernarla), movido de sitio.

Causa raíz: se describe una tabla en prosa en vez de derivar la prosa de la
tabla.

### [MEDIO] `valor-ahorro` esquiva el accesor de fases y pinta la clave cruda que `/admin` traduce
`src/app/dashboard/valor-ahorro/page.tsx:14,134` · `src/app/admin/fases.ts:63-76`

`admin/fases.ts` es un buen arreglo: un mapa tipado (`FASE_LABEL`) más un
accesor (`etiquetaFase`, línea 74) que además traduce la fase **histórica**
`'escalacion'` — que salió de `FaseCosto` este mismo mes pero sigue admitida
por el `check` de la 0025 y sigue en filas de `llm_costo`, como documenta el
propio archivo en las líneas 51-58. Las cuatro pantallas de `/admin` usan el
accesor. La quinta consumidora, que está en el panel del **cliente**, indexa el
mapa directo:

```
valor-ahorro/page.tsx:134   FASE_LABEL[a.fase as keyof typeof FASE_LABEL] ?? a.fase
```

El `as keyof typeof` apaga justo el tipo que la cabecera de `fases.ts:27-30`
declara como «EL GUARDARRAÍL».

**Escenario, con valores.** Una flota con filas históricas
`llm_costo{fase:'escalacion', n:37}`. `getValorAhorro`
(`analytics.ts:369`) las devuelve en `accionesPorAgente`. `/admin`,
`/admin/analitica`, `/admin/costos-facturacion` y `/admin/model-ops` pintan
«Agente de Escalación · 37». `/dashboard/valor-ahorro` pinta **`escalacion`
· 37**, en la dona que existe para justificarle el precio del producto al
contralor. Una fila de la base, dos nombres según la pantalla: el caso que este
rubro llama canónico (`otro:'Gasto'` contra `otro:'Otro'`), reproducido dentro
del arreglo que lo cerró.

Consecuencia: para el equipo, el arreglo dejó dos formas de leer el mismo mapa
—una segura y una que compila igual— y la insegura es la única que cruzó al
panel del cliente.

### [MEDIO] `resolverVentana` se extrajo «para que el rail y la página hablen del mismo periodo», y Analítica tiene su propia copia con un comentario falso
`src/app/dashboard/ventana.ts:20,33-41` · `src/app/dashboard/analitica/page.tsx:48-53` ·
`src/app/dashboard/page.tsx:89` · `src/app/api/dashboard/asistente/route.ts:75`

`ventana.ts` resuelve `?rango=` en un sitio; `/dashboard` y el handler del rail
lo usan. `/dashboard/analitica` lo reimplementa en tres líneas y afirma en su
comentario (líneas 49-50) «Mismo default de 30 días que Inicio». Inicio usa 7
(`ventana.ts:20`, `RANGO_POR_DEFECTO: Rango = '7'`).

**Escenario, con valores.** El cambio que lo hace estallar está escrito en el
repo: `dashboard/page.tsx:83` dice «si en el demo el panel abre en ceros con
datos existiendo, es esto: se cambia el default de vuelta a '30' en esta
línea». El día que además se toque cuántos días pinta la gráfica del histórico
—`ventana.ts:35` da `ventanaDias = 30` para `'todo'`— Analítica se queda en
30: `/dashboard` y `/dashboard/analitica` pintan «Liquidaciones cerradas —
histórico» sobre dos ventanas distintas, con el mismo rótulo.

Consecuencia: el módulo que existe porque dos superficies dieron $774.48 y
$4,120.00 bajo el mismo rótulo (G-10) tiene una tercera superficie que no lo
usa, y su comentario afirma un acoplamiento que no existe.

### [BAJO] Tres funciones exportadas siguen sin un solo consumidor, y una de ellas era la razón de la nota del pase 1
`src/lib/auth/permisos.ts:33` · `src/lib/cuadra/laboral/pagadero.ts:122` ·
`src/lib/cuadra/costos.ts:305`

Verificado con grep sobre todo `src/` sin tests:

- `puedeAdministrar()` — **cero** consumidores. Es literalmente el hecho que
  bajó la nota a 5 en el pase 1, y no se movió. Un tercio de la tabla de
  permisos no lo lee nadie, mientras `AREA_POR_RUTA` clasifica tres rutas como
  `'administracion'` (`visibilidad.ts:102-104`) — o sea, la decisión "quién
  administra" ya se toma, en el otro archivo.
- `topeDescuento()` — cero consumidores, y formatea dinero con
  `${exigible.toFixed(2)}` (`pagadero.ts:147`), fuera de `formato.ts`. El
  guardarraíl de `formato.test.ts` solo greppea `toLocaleString('es-MX'`, así
  que no lo ve.
- `getResumenCosto()` — cero consumidores. Aquí sí hubo avance real: la
  agregación se extrajo a `agregarPorFase` (`costos.ts:400`) y `negocio.ts:140`
  la usa, así que ya no hay dos sumas distintas de `llm_costo`. Lo que sobra es
  la función envolvente.

El cambio que las hace estallar: el día que el panel de la flota enseñe su
costo (roadmap en `costos.ts`) o que el PDF cite el art. 110-I LFT, se conectan
funciones que nunca corrieron y que formatean dinero con reglas propias — la
nota saldría como «hasta 1000.55» al lado de líneas que dicen «$1,000.55».

(REINCIDENTE — pase 1, BAJO H14, y auditoría 10 antes.)

### [BAJO] El panel del cliente ahora depende de dos módulos de dominio de `/admin`, y los dos declaran en su cabecera que son «EN /admin»
`src/app/dashboard/valor-ahorro/page.tsx:14` · `src/app/dashboard/usuarios/page.tsx:8` ·
`src/app/admin/fases.ts:5` · `src/app/admin/roles.ts:4`

`CLAUDE.md` sanciona que `/dashboard` reuse de `/admin` la **UI** (`ui/kit`,
`ui/graficas`, `charts`). Grepeados los 40 imports cruzados, 38 son eso. Los
dos que no lo son llegaron con los arreglos de esta ronda: `admin/fases.ts` y
`admin/roles.ts`, que son vocabulario de dominio, no componentes. Sus propias
cabeceras dicen «CÓMO SE LLAMA UNA FASE DEL PIPELINE, **EN /admin**» y «CÓMO SE
LLAMA UN ROL, **EN /admin**».

El cambio que lo hace doler: el día que Javier quiera renombrar una fase solo
en su consola (o que `/dashboard` necesite nombres de cara al cliente
distintos de los internos), el mapa que se edita es el que las dos consolas
comparten, y el cambio sale en la pantalla del cliente sin que nadie lo pida.
No es un bug hoy; es un rótulo que ya no es verdad y una dependencia que
apunta del panel del cliente a la consola del superadmin.

---

## Lo que revisé y está bien

- **`engine.ts` sigue puro, quinta ronda seguida.** `grep` de `Date.now`,
  `new Date(`, `fetch(`, `Math.random`, `process.env`, `supabase` y `await`
  dentro de `src/lib/cuadra/cuadre/engine.ts`: **cero resultados**. Y no
  encontré lógica de dinero duplicada en ningún otro archivo: `getAcreditables`
  (`analytics.ts:229-249`) **suma columnas persistidas**, no recalcula;
  `deducibilidad.ts` y `acreditable.ts` formatean el reparto que el motor ya
  hizo. El ancla de "≤4" del rubro no aplica.
- **`permisos.ts` ya gobierna endpoints** — el CRÍTICO reincidente del pase 1
  está cerrado en su forma literal: `liquidaciones/route.ts:6,29` y
  `pdf/[id]/route.ts:5,41` lo importan y devuelven 403. Lo que reporto arriba
  es la mitad que falta, no la que se cerró.
- **Las ocho copias del override de tenant son ahora dos.**
  `tenant-efectivo.ts:47` (`flotaSuplantada`) usa `exigir()`, deja
  `logger.info('tenant.suplantacion')` con quién/qué flota/qué ruta, y
  `resolverTenantDeAction` (línea 84) cubre los cuatro server actions de
  despacho, incidencias, pod y unidades.
- **`safe()` se borró de los 16 archivos.** `grep -rn "async function safe<T>"`
  solo aparece dentro del comentario de `pg.ts:76`. La función viva es
  `safeLog` (`pg.ts:98`), que registra `lectura.fallida` con contexto y admite
  un `alFallar` — que el rail usa para responder 503 en vez de 200 con nulos.
- **`FASE_LABEL` y `ROL_LABEL` se eliminaron como copias.** Uno vive en
  `admin/fases.ts:34` como `Record<FaseCosto,string>`; el otro en
  `admin/roles.ts:18` como `Record<RolAppUser,string>`. Agregar una fase o un
  rol sin etiquetarlo **no compila** — el mecanismo correcto, no una prueba de
  texto.
- **`mis-viajes` ya importa `etiquetaEstatus`** (`mis-viajes/page.tsx:5,122`).
  La tercera copia de `ESTATUS` desapareció; el chofer y el contralor leen la
  misma etiqueta.
- **El passcode se borró entero.** No existen `src/lib/auth/passcode.ts` ni
  `/acceso`; `acceso_retirado.test.ts:45` falla si `DASHBOARD_PASSCODE` vuelve
  a leerse en `src/`, y `arranque.test.ts:72` fija que su ausencia ya no
  alarma. Dos documentos y un test que fijaban la verdad vieja: corregidos.
- **`round2` inline desapareció.** `grep` de `Math.round(… * 100) / 100` fuera
  de tests: solo la cita dentro del comentario de `formato.ts:41`.
- **Los seis stubs usan el mismo gate.** `mapa/page.tsx:11` y
  `soporte/page.tsx:11` llaman a `exigirVerRuta`, igual que los otros cuatro.
- **La prosa de "esto no existe" se corrigió contra la 0047.**
  `viajes/page.tsx:143-153` ahora enlaza a Unidades, POD y Despacho y declara
  lo que de verdad falta (ingreso de flete y km); `soporte/page.tsx:17-25`
  distingue la incidencia operativa —que sí tiene tabla— de la queja del
  cliente, que no.
- **El ordinal duplicado de migraciones dejó de ser un punto ciego.**
  `migraciones_verificadas.test.ts:137` («ningún ordinal nombra dos migraciones
  distintas») convierte en rojo lo que antes pasaba en verde. El riesgo del
  merge del PR #7 sigue vivo, pero ya no es silencioso: es la decisión humana
  que `RESULTADO.md:101` lista, no un hallazgo mío.
- **No hay dependencia apuntando al revés.** `grep` de `from '@/app` y
  `from '../app` en `src/lib/` y `src/types/` sin tests: **cero**.
- **`negocio.ts` no cruzó de panel.** Cero imports de `@/lib/admin/negocio`
  bajo `src/app/dashboard/` y `src/app/api/`.
- **`admin/mi-perfil` volvió a la frontera.** Los tres `supabaseAdmin()` que el
  pase 1 encontró en su `page.tsx` ya no están; `acciones.ts` no toca la base
  directo (su comentario de la línea 16 lo dice y lo cumple).
- **Acceso directo a la base en la capa de rutas: 19 → 11 sitios.** Total 134
  `.from(`/`.rpc(` sin tests, 27 en `repo.ts`. `operacion.ts` (26) es un
  repositorio hermano legítimo: usa `traerTodo`/`exigir` de `pg.ts` y acota por
  `tenant_id`. La métrica global sigue en 80% fuera de `repo.ts`, pero el 80%
  ya no está donde duele.
- **El formato de cifras sigue con una sola fuente**, con el guardarraíl que
  greppea `src/` entero.
- **`etiquetaConcepto` sigue siendo la única verdad de conceptos.**
  `engine.ts:1317` dice `otro: 'Otro'` con el comentario que lo ata a `pdf.ts`,
  `pdf.ts:241` la importa, y las nueve pantallas que pintan concepto la llaman.
  La copia de `[id]/page.tsx:31` está declarada como respaldo y vigilada por
  `etiquetas_sincronizadas.test.ts`.

## Lo que NO alcancé a revisar

- **No abrí `processor.ts` (1,748 líneas) ni `conv.ts` (456)** más allá de sus
  sitios de acceso a datos y de `conv.ts:130`. Séptima ronda sin abrirse.
- **No leí las ~30 páginas de `/admin` una por una.** Verifiqué la frontera de
  datos de todas por grep (y ahí salió que `mi-perfil` ya está cerrada) y leí a
  fondo `fases.ts`, `roles.ts`, `global-filter.tsx` y `page.tsx`.
- **No ejecuté nada contra un Supabase real** — no hay base en este entorno. El
  CRÍTICO y los dos ALTOS están leídos línea por línea siguiendo la cadena de
  llamada hasta el consumidor, sin guardarraíl intermedio; no los corrí.
- **No verifiqué el merge del PR #7**: esa rama no está en este clon
  (`git branch -a` da solo `master` y `claude/auditoria-11`). El punto ciego
  del ordinal lo verifiqué sobre el test de hoy, no sobre los cuatro `.sql`.
- **No perseguí duplicación dentro de `analytics.ts` (824 líneas)** ni entre
  `analytics.ts` y `operacion.ts` por cuerpo; los miré por firma y por sitio de
  acceso a datos.
- **No revisé `charts.tsx` ni `graficas.tsx`** contra duplicación interna entre
  sus componentes. Tercera ronda sin mirarse.
- **No conté las copias de literales dentro de `normas/` ni `facturacion/`**
  (comercios.ts son 742 líneas de tabla).
