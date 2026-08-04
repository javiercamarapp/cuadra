# Arquitectura y mantenibilidad — auditoría 11

Ancla: árbol de `claude/auditoria-11`, idéntico a `origin/master` (`e4326f9`)
salvo dos líneas del working tree que se reportan abajo (H1).
`git diff origin/master claude/auditoria-11 -- src/` → vacío.
Compuertas corridas por mí, hoy, sobre este árbol:
`npx vitest run` → 172 archivos, 1670 pruebas, 1 saltada, exit 0.
`npx tsc --noEmit -p .` → exit 0. `npm run lint` → 0 errores, 6 warnings.

**Nota: 5/10** (antes 6). Razón del movimiento: **deuda que cobró factura**.
Hay dos arreglos arquitectónicos de verdad en los 40 commits nuevos —
`app/dashboard/estatus.ts` cerró el duplicado de ESTATUS *eliminándolo* en vez
de vigilarlo, y `lib/cuadra/pg.ts` extrajo `exigir()`/`traerTodo()` para que
`operacion.ts` no los reimplementara (`pg.ts:1-8` lo dice por escrito, y lo
cumplió). Esos dos son exactamente el mecanismo que este rubro premia. Pero
las ~9,700 líneas nuevas reprodujeron, en el mismo mes, el patrón que el rubro
persigue desde la ronda 5: `FASE_LABEL` pasó de **cuatro copias a cinco**, y la
quinta cruzó la frontera `/admin` → `/dashboard` (H5). La lógica de
"a qué flota apunta esta página" se copió **ocho veces**, todas descartando el
`error` que `pg.ts` existe para no descartar (H3). Y "ver como" quedó
implementado en tres sitios que conocen tres subconjuntos distintos del
problema, con el resultado ya medible de que funciona en **1 de 17 páginas**
(H4). El acceso directo a la base fuera de `repo.ts` subió de 67% a **80%**.

**El riesgo mayor del rubro, hoy:** `resolverTenantEfectivo()` es el único
cuello de botella de autorización de las 20 páginas de `/dashboard` —y **no
tiene una sola prueba**. `grep -rln "resolverTenantEfectivo" src/ --include=*.test.ts`
devuelve vacío. La función pura que decide quién ve qué (`visibilidad.ts`)
tiene 83 pruebas; el único sitio donde se aplica no tiene ninguna. En este
árbol eso ya se cobró: el gate está desactivado y las tres compuertas están
verdes.

## Hallazgos

### [CRÍTICO] El gate de rol de las 20 páginas está desactivado en este árbol y tsc, eslint y 1670 pruebas lo dan por verde
`src/lib/auth/tenant-efectivo.ts:55` · `src/lib/auth/visibilidad.ts:130` ·
`src/lib/auth/visibilidad.ts:14-19`

Dos líneas del working tree (no commiteadas — `git diff` las muestra sin
`stage`, y `git diff origin/master claude/auditoria-11 -- src/` es vacío):

```
tenant-efectivo.ts:55   if (false && !puedeVerRuta(sesion.rol, destino)) redirect(inicioDe(sesion.rol));
visibilidad.ts:130      if (rolReal === 'superadmin') return rolReal;      // era `!==`
```

La segunda **sí la caza** `visibilidad.test.ts:79,86` (2 fallos, verificado). La
primera **no la caza nada**: corrí la suite completa con el `if (false &&)`
puesto y salió `172 passed / 1670 passed`, `tsc --noEmit` exit 0 y `eslint`
sin un solo error. `eslint` no marca `puedeVerRuta` ni `inicioDe` como
importados sin usar porque siguen citados dentro de la rama muerta, y
`no-constant-condition` no mira el operando izquierdo de un `&&`.

**Escenario, con valores.** `app_user` real: `{rol:'encargado',
tenant_id:'11111111-…'}` — el jefe de tráfico de Transportes Innovativos.
`visibilidad.ts:41` le da `['operacion']` y `visibilidad.ts:84` clasifica
`/dashboard/rentabilidad` como `'dinero'`. El sidebar no le pinta el link
(`sidebar-nav.tsx:94` sí llama a `puedeVerRuta`). Teclea la URL a mano:
`resolverTenantEfectivo('/dashboard/rentabilidad', …)` corre la línea 55,
que hoy nunca redirige, y la página renderiza. El comentario de
`visibilidad.ts:16-19` describe literalmente este ataque —«un link que no se
pinta se escribe a mano en la barra de direcciones»— y el código que lo
implementa está apagado.

Consecuencia: el jefe de tráfico ve el margen de la flota, la cobranza y la
facturación de su patrón. Pero el hallazgo de arquitectura no es la línea: es
que **una sola letra en el único chokepoint de autorización de 20 páginas pasa
las tres compuertas**. Cualquiera —una resolución de merge del PR #7, un
`git checkout` a medias, un refactor— puede borrarlo y desplegar verde el
6-ago.

Causa raíz probable: `visibilidad.ts` se probó como función pura y el cableado
—que es donde vive la garantía— se dio por probado con ella.

### [CRÍTICO] REINCIDENTE — la tabla de permisos sigue diciendo que gobierna la API, y sigue sin gobernar un solo endpoint
`src/lib/auth/permisos.ts:9` · `src/lib/auth/permisos.ts:17` ·
`src/app/api/export/liquidaciones/route.ts:18` ·
`src/app/api/export/pdf/[id]/route.ts:33` · `src/proxy.ts` (matcher sin `/api`)

Verificado hoy sobre este árbol, con las líneas movidas: `permisos.ts:9` sigue
afirmando que esta tabla decide «qué botón se pinta **y qué endpoint acepta la
petición**». `grep -rn "puedeExportar" src/` sin tests devuelve **tres** sitios
—`dashboard/[id]/page.tsx:127`, `dashboard/analitica/page.tsx:102`,
`dashboard/cuadre/page.tsx:158`—, los tres para pintar o no un botón. Cero
endpoints. La regla real que corre en `export/liquidaciones/route.ts:18` sigue
siendo `if (!s || !s.tenantId) return 401`, y la de
`export/pdf/[id]/route.ts:33` es la misma línea.

Se agrava respecto de la ronda 10: `puedeAdministrar` (`permisos.ts:29`) tiene
hoy **cero consumidores en todo `src/`**, tests incluidos fuera de
`permisos.test.ts`. Un tercio de la tabla no lo lee nadie.

**Escenario, con valores.** Fila creada desde `admin/usuarios/nuevo/page.tsx:12`
(«Chofer (operador)»): `{rol:'operador', tenant_id:'11111111-…',
operador_id:'op-A'}`. El chofer entra por magic link a `/mis-viajes` —donde la
0045 le enseña solo lo suyo— y pide `GET /api/export/liquidaciones`.
`getSessionTenant()` devuelve `tenantId` no nulo → pasa la línea 18. La
consulta usa `supabaseAdmin()` (service-role: **salta RLS**, la 0045 no
aplica) y filtra solo por `tenant_id`. Sale un CSV de hasta 5,000 filas con
`folio_viaje, operador, fecha, total_comprobado, anticipo, diferencia,
estatus, num_diferencias` (`lib/cuadra/export.ts`): el nombre de cada chofer
de la flota y la diferencia de cada viaje. `puedeExportar('operador')` es
`false` y habría cortado exactamente esto.

Consecuencia: un chofer se lleva la nómina de viajes de sus compañeros. Y para
el equipo: la migración 0045, con sus 40 líneas de comentario explicando por
qué la UI no puede ser el único candado, sigue desactivada por una ruta que se
salta RLS por diseño — una ronda entera después de reportarlo.

Causa raíz probable: no hay ningún mecanismo que ate `permisos.ts` a sus
consumidores; su prueba verifica la tabla, no que alguien la consulte.

(REINCIDENTE — auditoría 10, CRÍTICO H1. Sigue textualmente abierto aquí.)

### [ALTO] "A qué flota apunta esta página" está copiado ocho veces, y las ocho copias descartan el `error` — el fallback es el tenant DEMO
`src/lib/auth/tenant-efectivo.ts:68` · `src/app/dashboard/despacho/page.tsx:68` ·
`src/app/dashboard/incidencias/page.tsx:53` · `src/app/dashboard/pod/page.tsx:52` ·
`src/app/dashboard/unidades/page.tsx:53` · `src/app/dashboard/[id]/page.tsx:53` ·
`src/app/dashboard/[id]/page.tsx:77` · `src/app/api/dashboard/asistente/route.ts:40`

El encabezado de `tenant-efectivo.ts:1-2` dice, textual: «A QUÉ FLOTA APUNTA
CADA PÁGINA DE /dashboard/* — **un solo lugar, no 20 copias**». Hay ocho, y
todas son la misma línea:

```
const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', sp.tenant).maybeSingle();
if (data) return data.id as string;   // …y si no, cae al tenant de la sesión
```

`error` se descarta en las ocho. Es el patrón exacto que `pg.ts:9-21` describe
como «la familia de bugs más repetida del repo» y que `exigir()` existe para
cerrar; ninguna de las ocho lo usa.

**Escenario, con valores.** Javier (superadmin, `tenantId` de sesión = el demo
de `0001_init.sql`) entra a `/dashboard/despacho?tenant=<uuid de Transportes
Innovativos>`. El render resuelve bien y pinta la flota correcta. Llena la
forma de alta de viaje y da Enter. El server action llama
`tenantDelAction()` (`despacho/page.tsx:64-71`); en ese instante PostgREST
devuelve un 503 transitorio: `data = null`, `error` se tira, el `if (data)` no
entra, y la función devuelve `s.tenantId` — **el tenant demo**. `crearViaje()`
(`operacion.ts:471`) inserta la fila con `tenant_id` = demo. El redirect vuelve
a `/dashboard/despacho?tenant=<Innovativos>&ok=creado`: la pantalla dice
"creado" y el viaje no está. No hay log, porque el error se descartó.

Consecuencia: el 6-ago, si algo parpadea, el viaje que Javier crea delante del
contralor se escribe en la flota equivocada y la pantalla afirma que se creó.
Para el equipo: cambiar la regla del override —p. ej. exigir `tenant.activo`—
son ocho ediciones y ninguna falla si se olvida una.

Causa raíz probable: `resolverTenantEfectivo` resuelve el tenant para el
RENDER; nadie extrajo la mitad que los server actions necesitan, así que cada
página se la volvió a escribir.

### [ALTO] "Ver como" vive en tres sitios con tres reglas distintas, y ya funciona en 1 de 17 páginas
`src/app/dashboard/sidebar-nav.tsx:81-88` · `src/app/dashboard/sufijo.ts:7-16` ·
`src/app/dashboard/page.tsx:291` · `src/app/dashboard/viajes/page.tsx:37`

Tres implementaciones de la misma regla, cada una con un pedazo:

1. `sidebar-nav.tsx:73-82` (cliente) — arrastra `?tenant=`, `?vista=`, **y
   `?rol=`**, y para superadmin sin parámetro asume `?vista=demo`.
2. `sufijo.ts:12-15` (server) — arrastra `?tenant=` o `?vista=`. **No conoce
   `?rol=`** (ni está en su tipo) y no tiene el fallback a demo. Su propio
   comentario (líneas 7-10) afirma «Misma regla, dos fuentes de entrada». No
   es la misma regla.
3. `resolverTenantEfectivo` (`tenant-efectivo.ts:44`) — aplica
   `rolEfectivo(sesionReal.rol, sp?.rol)`.

Y la divergencia que ya se consumó: de las 17 páginas que llaman a
`resolverTenantEfectivo`, **solo `dashboard/page.tsx:291` declara `rol?: string`
en el tipo de `searchParams`**. Las otras 16 lo tipan
`Promise<{ vista?: string; tenant?: string }>` (verificado una por una), así
que `sp.rol` es `undefined` y `rolEfectivo` devuelve siempre el rol REAL. `tsc`
no ve nada: pasar un objeto sin `rol` a un parámetro con `rol?` es legal.

**Escenario, con valores.** Javier abre `/dashboard?rol=encargado` para
preparar el demo. La raíz sí lo honra: el contenido se filtra a operación.
Clic en "Viajes" en el sidebar → `/dashboard/viajes?vista=demo&rol=encargado`.
`viajes/page.tsx:37` no tipa `rol`, así que `rolEfectivo('superadmin',
undefined)` = `'superadmin'` y la página corre con privilegios completos —
mientras el sidebar de esa misma pantalla, que lee `useSearchParams()` directo
(`sidebar-nav.tsx:81`), sigue filtrado a encargado. Media pantalla previsualiza
y media no. En `/dashboard/despacho?vista=demo&rol=contador`, `puede =
puedeAsignar(rol)` (`despacho/page.tsx:49`) recibe `'superadmin'` y **pinta la
forma de alta de viajes** que un contador nunca vería.

Y al revés: en `/dashboard/cuadre?tenant=<uuid>&rol=contador`, el link de cada
fila (`cuadre/page.tsx:196`) se arma con `sufijoTenant(sp)` = `?tenant=<uuid>`
— el `?rol=` se cae al primer clic dentro de la página.

Consecuencia: Javier usa "ver como" para enseñarle al contralor que su jefe de
tráfico no ve las finanzas, y a un clic de distancia la pantalla le contradice.
Peor para el equipo: la única forma de verificar la separación de roles sin
tener la contraseña de cada rol es esta función, y da un falso positivo en 16
de 17 páginas.

Causa raíz probable: `?rol=` se agregó al chokepoint y al sidebar, y el tipo de
`searchParams` de cada página —que es lo que de verdad decide si el parámetro
llega— se quedó como estaba.

### [ALTO] REINCIDENTE — `FASE_LABEL` pasa de cuatro copias a cinco, y la quinta cruzó al panel del cliente
`src/app/admin/page.tsx:19` · `src/app/admin/analitica/page.tsx:11` ·
`src/app/admin/costos-facturacion/page.tsx:12` ·
`src/app/admin/model-ops/page.tsx:29` ·
`src/app/dashboard/valor-ahorro/page.tsx:12` · `src/lib/cuadra/costos.ts:41`

La verdad sigue en `costos.ts:41`:
`type FaseCosto = 'ocr'|'cuadre'|'escalacion'|'chat'|'router'|'whatsapp'`.
Cuatro de las cinco copias tienen las seis claves carácter por carácter;
`model-ops/page.tsx:29` sigue con **tres** (le faltan `escalacion`, `chat`,
`router`), igual que en la ronda 10 — no se tocó. **Ninguna de las cinco** está
tipada `Record<FaseCosto, string>`; las cinco son `Record<string, string>`, así
que `tsc` no ve nada. `model-ops` además lista las fases desde un sexto literal
(`FASES`, línea 35, tres entradas fijas).

Lo nuevo y lo que sube la severidad: la quinta copia está en
`dashboard/valor-ahorro/page.tsx:12`, o sea **dentro del panel del cliente**.
El mapa de conceptos internos de Likida (fases del pipeline de IA) ya no vive
solo en la consola de Javier: cruzó la frontera que CLAUDE.md declara.

**Escenario, con valores.** Se agrega una séptima fase a `costos.ts:41` —
p. ej. `'reintento'` — y `faseDeModelo` empieza a escribir filas de `llm_costo`
con `fase='reintento', costo_usd=0.04`. `tsc` pasa. Las cinco pantallas caen a
su `?? f.fase` y pintan la clave cruda **`reintento`** en la dona; el contralor
la ve en `/dashboard/valor-ahorro`, que es la pantalla que existe para
justificarle el precio del producto. Hoy mismo, sin cambiar nada,
`/admin/model-ops` ya pinta «escalacion» donde las otras tres pintan «Agente de
Escalación», y no lista la fase de escalación en su "Registro de agentes" — la
página que existe para vigilar el modelo caro es la única que no lo enseña.

Consecuencia: para agregar o renombrar una fase hay que tocar seis literales y
ninguno falla si se olvida. Es el caso canónico del rubro (`otro:'Gasto'` vs
`otro:'Otro'`), tercera ronda seguida, y esta vez creciendo.

(REINCIDENTE — auditoría 10, MEDIO H4. Empeoró: 4 → 5 copias, y cruzó de panel.)

### [ALTO] Dos páginas del panel declaran como inexistentes tablas que la 0047 creó, y la 0047 tiene páginas vivas en el mismo menú
`src/app/dashboard/viajes/page.tsx:132-136` ·
`src/app/dashboard/soporte/page.tsx:17-20` ·
`supabase/migrations/0047_operacion_encargado.sql:31,65,97,127` ·
`src/app/dashboard/rutas.ts:36-38`

El producto tiene un mecanismo explícito para declarar lo que falta
(`pendiente.tsx`, `EstadoVacio`) y es una de las reglas que no se rompen. Dos
de esas declaraciones son falsas desde la 0047:

- `viajes/page.tsx:132-136` le dice al contralor: «Unidad asignada, POD … no
  aparecen porque no existen en el sistema: `viaje` no guarda unidad, no hay
  tabla de vehículos, no hay campo de POD … Crear y asignar viajes desde aquí
  (hoy se hace por WhatsApp) … necesitan esas mismas piezas.»
  La 0047 crea `public.unidad` (línea 31), añade `viaje.unidad_id` (línea 65) y
  crea `public.pod` (línea 127). `operacion.ts:479` escribe `unidad_id` en el
  INSERT, y `/dashboard/despacho` crea y asigna viajes desde el navegador.
- `soporte/page.tsx:17-20`: «Las incidencias de un viaje (retraso, daño,
  faltante) tampoco tienen dónde vivir». La 0047 crea `public.incidencia`
  (línea 97) con tipo, prioridad, estado y SLA, y `operacion.ts:535`
  (`crearIncidencia`) escribe en ella.

**Escenario, con valores.** El 6-ago el contralor abre el menú y ve, en el
grupo Operación (`rutas.ts:36-38`), «POD & Evidencias», «Incidencias» y
«Unidades» — las tres funcionando. Baja a «Viajes» y la propia app le dice que
no hay tabla de vehículos ni campo de POD. Abre «Soporte & Quejas» y le dice
que las incidencias no tienen dónde vivir, con «Incidencias» dos renglones
arriba en el mismo sidebar.

Consecuencia: el mecanismo cuya credibilidad es todo el argumento del producto
—"si no hay dato, se dice qué falta y por qué"— queda desmentido en pantalla
por el propio menú. Un contralor que pilla una de estas deja de creer las
otras. Para el equipo: la capacidad del esquema está reescrita en prosa dentro
de N archivos de página y nada las ata a `supabase/migrations/`.

Causa raíz probable: la 0047 y sus cuatro páginas se escribieron sin barrer las
declaraciones de "esto no existe" que ella misma volvió falsas.

### [MEDIO] REINCIDENTE — tercera copia de `ESTATUS` en `/mis-viajes`, y el guardarraíl se reescribió sin incluirla
`src/app/mis-viajes/page.tsx:8-12` ·
`src/lib/cuadra/etiquetas_sincronizadas.test.ts:113-121` ·
`src/app/dashboard/estatus.ts:18-22`

La unificación en `dashboard/estatus.ts` es real y la doy por buena: las dos
páginas del panel importan `etiquetaEstatus` y el test lo verifica. Pero al
reescribir el bloque, la lista de archivos vigilados quedó en
`['../../app/dashboard/cuadre/page.tsx', '../../app/dashboard/[id]/page.tsx']`
(línea 116). `mis-viajes/page.tsx:8-12` sigue con su copia literal, byte a byte
idéntica a `estatus.ts:19-21`, fuera de la lista. Era el MEDIO H5 de la ronda
10; el arreglo se hizo y no la absorbió.

**Escenario, con valores.** Se agrega `'en_revision'` a `EstatusLiquidacion`
(`types/cuadra.ts:106`). El test «cubre todos los estatus que el tipo permite»
falla contra `estatus.ts` y obliga a etiquetarlo — hace su trabajo para el
panel. `mis-viajes/page.tsx` pasa verde y cae a su fallback de la línea 80,
`{ label: v.estatus, color: 'var(--muted)' }`: el chofer ve **`en_revision`**
en gris, en la única pantalla web que tiene, mientras el contralor lee «Por
revisar».

Consecuencia: el chofer lee una clave de base de datos. Para el equipo: el
mecanismo que costó tres rondas construir protege dos de tres consumidores, y
la reescritura de esta ronda no aprovechó para cerrarlo.

Causa raíz probable: el guardarraíl sigue nombrando archivos concretos en vez
de descubrir a quien declare el mapa.

### [MEDIO] El acceso directo a la base fuera de `repo.ts` pasó de 67% a 80%, y 19 sitios están dentro de `src/app/`
`src/lib/cuadra/operacion.ts` (25 sitios) · `src/app/dashboard/usuarios/page.tsx:23` ·
`src/app/admin/mi-perfil/page.tsx:31,38,56` · `src/lib/cuadra/repo.ts` (26 sitios)

Medido con el criterio exacto de las rondas 8-10 (`.from('`/`.rpc('` con
literal, sin `*.test.ts`): **129 sitios totales**, 26 en `repo.ts` → **103
fuera (80%)**. La ronda 10 midió 79 / 53 fuera (67%). De los 103, **19 están en
`src/app/`**, o sea en la capa de rutas.

`operacion.ts` en sí NO es el problema: es un repositorio hermano, usa
`traerTodo`/`exigir` de `pg.ts`, comprueba `error` en las once escrituras y
acota por `tenant_id` en el WHERE además del id. Es la parte bien hecha. Lo
que cuenta es lo otro:

- `dashboard/usuarios/page.tsx:23` define `getUsuarios()` —una consulta a
  `app_user` con `supabaseAdmin()` y `.eq('tenant_id', …)`— **dentro del
  archivo de la página**, teniendo `analytics.ts` y `operacion.ts` al lado con
  la misma firma `(…, tenantId)`. Es el mismo sitio del que la ronda 10 sacó
  `getLiquidaciones`; se movió el archivo, no el patrón.
- `admin/mi-perfil/page.tsx` rompe la frontera que la ronda 10 verificó como
  intacta: las ~30 páginas de `/admin` importaban **solo** de
  `@/lib/admin/negocio`, y esta trae `supabaseAdmin()` directo, hace tres
  consultas a `app_user` y dos al storage (`admin.storage.from('avatares')`).
- `viaje` se toca desde **seis** módulos (`repo.ts`, `operacion.ts`,
  `analytics.ts`, `conv.ts`, `negocio.ts`, `mis-viajes/page.tsx`), y las
  escrituras se reparten entre `repo.ts:111` (`reasignarOperador`) y
  `operacion.ts:471,490` (`crearViaje`, `asignarUnidad`) —
  `despacho/page.tsx:9-14` importa de los dos en el mismo server action.

**Escenario, con valores.** Se agrega a `viaje` una columna obligatoria de
negocio —el caso plausible es `unidad_id` volviéndose requerida para despacho,
o un `origen_id` cuando exista la tabla de clientes. Se actualiza el INSERT en
`operacion.ts:471` porque es el que se llama "crear viaje". `conv.ts` sigue
resolviendo viajes abiertos con su propio SELECT, `analytics.ts:424` sigue
trayendo `id, operador_id, anticipo`, y "¿dónde se lee un viaje?" tiene seis
respuestas, ninguna canónica.

Consecuencia: para el equipo, el aislamiento entre flotas depende de que cada
uno de los 103 sitios se acuerde de poner el `.eq('tenant_id', …)` — todos usan
service-role, así que RLS no cubre a ninguno.

(REINCIDENTE — auditoría 10, BAJO H7. La métrica empeoró 13 puntos.)

### [MEDIO] `safe()` copiado 16 veces: la política de "fallar cerrado y decirlo" se decide en 16 archivos y ninguno deja una línea
`src/app/dashboard/page.tsx:25-27` y 14 archivos más ·
`src/app/api/dashboard/asistente/route.ts:43-45` · `src/lib/cuadra/pg.ts:23`

Dieciséis copias, hoy idénticas byte a byte (verificado con `uniq -c`):

```
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}
```

`pg.ts` fue construido para que un error de PostgREST **lance** en vez de leerse
como "no hay nada" —es la corrección de un CRÍTICO de la auditoría 5— y estos
16 sitios lo vuelven a convertir en `null` sin registrar nada. El comentario de
`pg.ts:18-20` incluso los da por buenos: «el panel ya sabe distinguir null de
dato — `safe()` en dashboard/page.tsx atrapa excepciones». Atrapa; no avisa.

**Escenario, con valores.** El 6-ago la llave de service-role se rota o el
proyecto de Supabase pega su límite de conexiones. `getAcreditables` lanza,
`safe()` devuelve `null` en las 15 páginas, y ninguna de las 16 llama a
`logger`. Sentry no recibe un solo evento. El equipo se entera por lo que el
contralor diga en la sala. Y el día que se quiera arreglar —añadir
`logger.error` al catch— son 16 ediciones, sin nada que falle si se olvidan
tres.

Consecuencia: el mecanismo que existe para no leer una base caída como "no hay
datos" está neutralizado en el borde, en 16 copias.

### [MEDIO] Los ordinales duplicados 0046/0047 rompen el mecanismo que existe para que ninguna migración se cuele sin comprobar
`src/lib/cuadra/migraciones_verificadas.test.ts:78,89-101` ·
`supabase/verificaciones.sql:1022,1068` · `supabase/migrations/0046_perfil_avatar.sql` ·
`supabase/migrations/0047_operacion_encargado.sql`

El mecanismo identifica una migración por su **número**, no por su nombre:
`.map((f) => ({ num: f.slice(0, 4), archivo: f }))` (línea 78), y decide con
`new RegExp("\\b" + num + "\\b").test(TITULOS)` (línea 93) contra los títulos de
`verificaciones.sql`. Hoy en `master` los bloques 27 y 28 se titulan
«(mig. 0046)» y «(mig. 0047)». En la rama del PR #7 hay bloques titulados
exactamente igual —«El chofer no toca las otras cuatro tablas (mig. 0046)» y
«Las policies del chofer filtran por tenant (mig. 0047)»— para migraciones
distintas.

**Escenario, con valores.** Se mergea el PR #7. Los cuatro `.sql` tienen rutas
distintas, así que git **no reporta conflicto** en `supabase/migrations/` y los
cuatro aterrizan: dos archivos `0046_*` y dos `0047_*`. `verificaciones.sql`
sí conflicta (los dos lados añadieron bloques 26-28); se resuelve quedándose con
los del PR, que es lo natural porque son de RLS. `migraciones_verificadas.test.ts`
pasa verde: `\b0046\b` aparece en TITULOS, así que las **dos** migraciones 0046
cuentan como comprobadas, y la garantía de `0046_perfil_avatar.sql` —que cada
usuario solo escriba SU propio avatar en el bucket— se queda sin verificar con
la suite en verde. Y `supabase db push` aplica por `version` = prefijo
numérico: dos filas con `version='0046'` en `supabase_migrations.schema_migrations`
es una violación de llave primaria, así que el push se corta a media serie con
0046_perfil_avatar aplicado y 0047-0053 no.

Consecuencia: el único mecanismo del repo que impide que una migración se cuele
sin comprobación queda ciego justo en el merge que más migraciones mete de
golpe (0046→0053, ocho de ellas de RLS). El síntoma de arriba es el bueno; el
malo es el silencioso.

Causa raíz probable: la identidad de una migración es el ordinal, y dos ramas
largas no pueden coordinarlo.

### [MEDIO] REINCIDENTE — el passcode sigue completo: dos verdades de autenticación, y dos documentos + un test fijan la que ya no es cierta
`src/lib/auth/passcode.ts:1-252` · `src/app/acceso/page.tsx:24` ·
`src/lib/observability/arranque.ts:33` · `DEPLOY.md:99` ·
`src/lib/observability/runbook.test.ts:100` · `src/proxy.ts:8`

Verificado hoy: `proxy.ts:8` declara que «el gate ya NO es un passcode
compartido». Pero `passcode.ts` sigue con sus 252 líneas y su prueba de 19
tests; `tokenMatches` (línea 236) y `hayPasscode` (línea 180) tienen **cero
consumidores** fuera del propio archivo; `/acceso/page.tsx:24` sigue siendo
ruta pública que compara contra `DASHBOARD_PASSCODE` y emite la cookie
`likida_access` que nadie lee.

**Escenario, con valores.** Se despliega para el demo sin `DASHBOARD_PASSCODE`
(que es lo correcto: no gatea nada). En cada arranque en frío,
`arranque.ts:33` emite `logger.error('startup.config_silenciosa',
{faltan:['DASHBOARD_PASSCODE: proxy.ts no bloquea /dashboard']})`. Sentry recibe
un ERROR que dice que el panel del contralor está abierto. Es falso. Quien esté
de guardia el 6-ago persigue un incidente inexistente durante el demo. Y
`runbook.test.ts:100` **exige** que `DEPLOY.md` siga nombrando la variable: el
guardarraíl que existía para que el runbook no mintiera obliga hoy a que mienta.

(REINCIDENTE — auditoría 10, ALTO H3. Íntegro en este árbol.)

### [MEDIO] `SIN_CERRAR` en tres literales, y uno ya cuenta distinto
`src/lib/cuadra/operacion.ts:21` · `src/lib/cuadra/conv.ts:130` ·
`src/app/dashboard/viajes/page.tsx:45`

Tres respuestas a "¿qué viaje sigue en curso?":

```
operacion.ts:21     const SIN_CERRAR = new Set(['abierto', 'en_cuadre']);
conv.ts:130         .in('estatus', ['abierto', 'en_cuadre'])
viajes/page.tsx:45  viajes?.filter((v) => v.estatus !== 'liquidado')
```

Las dos primeras enumeran; la tercera niega. Hoy dan lo mismo porque el
dominio tiene exactamente tres valores (`viaje_estatus_dominio`, 0025).

**Escenario, con valores.** Se agrega `'cancelado'` al CHECK — el candidato más
plausible, porque `/dashboard/despacho` ya crea viajes desde el navegador y un
viaje mal capturado hoy no tiene salida. Una flota con 40 viajes, 6 cancelados:
`/dashboard/viajes` pinta «Abiertos (sin liquidar): 6+…» contando los
cancelados y suma sus anticipos en «Anticipo en viajes abiertos»;
`/dashboard/despacho` pinta `viajesActivos` sin ellos
(`operacion.ts:441`). Dos pantallas del mismo panel, la misma flota, el mismo
minuto, dos cifras de viajes abiertos — y una de ellas es dinero.

Consecuencia: el contralor cruza dos pantallas y no cuadran. Es exactamente la
falla que la regla "nunca inventar una cifra" quiere evitar, por la vía de la
duplicación.

### [BAJO] REINCIDENTE — el guardarraíl de `round2` sigue contando declaraciones, no la expresión
`src/lib/cuadra/repo.ts:808` · `src/lib/cuadra/liquidacion/omitidos.ts:37` ·
`src/lib/formato.test.ts` (grep `function round2\|const round2`)

Verificado hoy: `round2` se declara solo en `formato.ts:53`, y las dos
expresiones inline siguen exactamente donde estaban.

```
repo.ts:808     return { efectivo: Math.round(efectivo * 100) / 100, totalCombustible: Math.round(totalCombustible * 100) / 100 };
omitidos.ts:37    monto: Math.round(monto * 100) / 100,
```

`repo.ts:808` es `getAcumuladoCombustible`, el acumulado del ejercicio que
dispara la alerta del tope RFA 2026 2.9. Hoy no hay bug visible (el `+EPSILON`
de `formato.ts:54` es un no-op arriba de ~$2). El cambio que la hace estallar:
el día que se arregle `round2` de verdad, `formato.test.ts` pasa verde y estos
dos sitios se quedan con el comportamiento viejo.

(REINCIDENTE — auditoría 10, BAJO H7.)

### [BAJO] Tres funciones exportadas con cero consumidores, dos de ellas de dinero
`src/lib/cuadra/costos.ts:253` · `src/lib/cuadra/laboral/pagadero.ts:122` ·
`src/lib/auth/permisos.ts:29` · `src/lib/admin/negocio.ts:50`

- `getResumenCosto()` sigue con **cero** consumidores fuera de sus tests
  (verificado). `negocio.ts:50` reimplementa la misma agregación de
  `llm_costo` por fase, con `round2` en vez de `round6` y sin la unión
  discriminada `medido`/`sin_registros`/`no_medido` que `costos.ts:235-246`
  explica que existe para no pintar un 0 que nadie midió.
- `topeDescuento()` (`pagadero.ts:122`) también tiene cero consumidores, y
  formatea dinero con `${exigible.toFixed(2)}` (línea 147) — sin `$`, sin
  separador de miles, fuera de `formato.ts`. El guardarraíl de `formato.test.ts`
  solo greppea `toLocaleString('es-MX'`, así que no lo ve.
- `puedeAdministrar()` (`permisos.ts:29`): cero consumidores.

El cambio que las hace estallar: el día que el panel de la flota enseñe su
costo —está en el roadmap, `costos.ts:252`— habrá dos agregadores de
`llm_costo` con distinto redondeo y distinto contrato de error, y se arreglará
el que se llama `costos.ts`. Y el día que alguien conecte `topeDescuento` al
PDF, la nota del art. 110-I LFT saldrá como «hasta 1000.55» al lado de líneas
que dicen «$1,000.55».

(REINCIDENTE parcial — auditoría 10, BAJO H6, para `getResumenCosto`.)

### [BAJO] Dos de los seis stubs no usan el gate que se escribió para los stubs
`src/app/dashboard/mapa/page.tsx:6` · `src/app/dashboard/soporte/page.tsx:6` ·
`src/lib/auth/guard.ts:69-78`

`exigirVerRuta` existe, textual, «para las páginas que no pasan por
`resolverTenantEfectivo` — los stubs sin datos», y remata: «el día que dejen de
ser stubs, el gate ya está puesto en vez de ser algo que alguien tenga que
acordarse de agregar». Cuatro stubs lo usan (`clientes`, `cobranza`,
`cotizador`, `rentabilidad`); `mapa` y `soporte` no llaman a **ninguna** función
de sesión: son componentes síncronos sin `await`.

El cambio que la hace estallar es el que el propio comentario anticipa: el día
que `/dashboard/soporte` deje de ser un stub y lea la tabla `incidencia` —que
ya existe desde la 0047—, nadie va a recordar poner el gate, porque en las
otras cuatro ya estaba. Hoy el daño es que un `contador` (área `dinero`, sin
link en el sidebar) puede teclear `/dashboard/soporte` y ver la pantalla.

### [BAJO] `ROL_LABEL` copiado en `/admin/mi-perfil` perdiendo el tipo que lo hacía exhaustivo
`src/app/admin/mi-perfil/page.tsx:9` · `src/app/admin/equipo/page.tsx:12` ·
`src/app/dashboard/chrome.tsx:26` · `src/app/dashboard/usuarios/page.tsx:12` ·
`src/app/admin/usuarios/nuevo/page.tsx:8`

La ronda 10 dio los mapas de rol por «razonablemente atados» porque
`equipo/page.tsx:12` es `Record<RolAppUser, string>` — exhaustivo, `tsc` caza un
rol nuevo sin etiqueta. La copia nueva de esta ronda,
`mi-perfil/page.tsx:9-11`, es el mismo mapa con las mismas cinco claves pero
tipada `Record<string, string>`: perdió la garantía en el copiado. Hoy son
cinco sitios que nombran los roles (`chrome.tsx:26` en abreviatura,
`dashboard/usuarios/page.tsx:12` en prosa describiendo permisos que decide
`permisos.ts`), y solo uno falla si se agrega un rol al dominio de la 0044.

## Lo que revisé y está bien

- **`estatus.ts` es el arreglo correcto, hecho como se pide.** El duplicado se
  **eliminó**, no se vigiló: `dashboard/estatus.ts:18-27` es la fuente y
  `etiquetas_sincronizadas.test.ts:113-121` ahora prueba que las dos páginas
  *importan* en vez de comparar dos copias. Mi reserva es el alcance (H7), no
  el mecanismo.
- **`pg.ts` es una extracción con motivo escrito y cumplido.** `pg.ts:1-8` dice
  que se extrajo para que `operacion.ts` no reimplementara `exigir`/`traerTodo`,
  y `operacion.ts` los usa en las **once** lecturas (líneas 49-64, 121, 163,
  169, 248-258, 317-327, 419-431). Cero reimplementaciones. Es el patrón que el
  rubro premia.
- **`engine.ts` sigue puro.** `grep` de `Date.now`, `new Date(`, `fetch(`,
  `Math.random`, `process.env`, `supabase`, `await` dentro del archivo: **cero
  resultados**, cuarta ronda seguida.
- **No hay una segunda librería de UI.** `grep -rln "<svg" src/app/dashboard/`
  → **cero archivos**. Las 20 páginas importan del kit de `/admin`: 23 imports
  de `admin/ui/kit`, 4 de `admin/ui/graficas`, 3 de `admin/charts`. Los cinco
  componentes locales (`cifra-grande`, `avance-cierre`, `pendiente`, `chrome`,
  `rail`) son composición del kit, no reimplementación.
- **El formato de cifras sigue con una sola fuente y el guardarraíl cubre lo
  nuevo.** `formato.test.ts:122-125` greppea **`src/` entero** (`grep -rl`), no una
  lista, así que las páginas nuevas entran solas; corrido, verde.
  `toLocaleString('es-MX'` aparece hoy solo en `lib/formato.ts:59,69,80` fuera
  de comentarios y tests. `utils.ts:12` y `dashboard/formato.ts:27` son
  reexports puros. Y `admin/ui/formato-preset.ts:1` resuelve el problema real
  que habría forzado una copia: pasar una función de formato a un Client
  Component no es serializable, y en vez de reimplementar `mxn` ahí, se pasa un
  preset de texto y se resuelve contra `@/lib/formato`.
- **Las etiquetas de concepto se cerraron de verdad.** `engine.ts:1075` dice hoy
  `otro: 'Otro'` con el comentario que lo ata a `pdf.ts` y al panel; `pdf.ts`
  ya no tiene mapa propio (importa `etiquetaConcepto`), y
  `etiquetas_panel.test.ts:26-37` prueba la **salida** (que un ticket de MAGNA
  no salga «Diésel»), no la forma. El ejemplo canónico del rubro está resuelto.
- **No hay dependencia apuntando al revés.** `grep` de `from '@/app` y
  `from '../app` dentro de `src/lib/` y `src/types/` (sin tests): **cero**.
- **Las tres listas de rutas de `/dashboard` coinciden hoy**, y una de las dos
  direcciones tiene prueba: `rutas.ts` (23 hrefs), `AREA_POR_RUTA`
  (23 entradas) y las 24 `page.tsx` reales cuadran sin huérfanas en ninguna
  dirección; `visibilidad.test.ts:64` falla si el sidebar gana una ruta sin
  clasificar. Falta la dirección contraria (una `page.tsx` nueva sin entrada de
  menú), pero ahí `puedeVerRuta` falla cerrado, así que no lo cuento.
- **`negocio.ts` sigue sin filtrarse al panel del cliente.** `grep` de
  `@/lib/admin/negocio` bajo `src/app/dashboard/`: cero. La única función con
  permiso de cruzar tenants no cruzó de panel.
- **`migraciones_verificadas.test.ts` absorbió la 0045, 0046 y 0047** con
  bloques reales en `verificaciones.sql` (26, 27, 28), ninguna exención nueva.
  El mecanismo funciona; su punto ciego es el ordinal (H10).

## Lo que NO alcancé a revisar

- **No abrí `conv.ts` (11 sitios de acceso directo) ni `startup.ts` (10).**
  Sexta ronda sin abrirse; nadie los tocó esta tampoco. Los conté en la métrica
  y leí `conv.ts:105-145`, nada más.
- **No leí las ~30 páginas de `/admin` una por una.** Verifiqué la frontera de
  datos de todas por grep (y ahí salió `mi-perfil`), y leí a fondo cinco.
  Puede haber más literales copiados en las que solo grepeé.
- **No verifiqué H2 ni H3 contra un Supabase real** — no hay base en este
  entorno. Las cadenas están leídas línea por línea y no hallé guardarraíl
  intermedio, pero no las ejecuté.
- **No ejecuté el merge del PR #7** para confirmar el comportamiento exacto de
  `supabase db push` ante dos `version='0046'`. El punto ciego del test
  (`\b0046\b` sobre TITULOS) sí lo verifiqué leyendo las dos ramas.
- **No perseguí duplicación dentro de `analytics.ts`** (386 líneas de diff) más
  allá de sus sitios de acceso a datos y de `getViajes`; el reparto de
  responsabilidades entre `analytics.ts` y `operacion.ts` lo miré por firma, no
  por cuerpo.
- **No revisé `charts.tsx` (227 líneas de SVG) ni `graficas.tsx` (más de 450)**
  contra duplicación interna entre sus 15 componentes.
