# Backend y API — auditoría 11

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**. La
ronda anterior bajó este rubro porque "quién ve el dinero de la flota se decidió
solo en la capa que pinta botones". Esta ronda escribió las 139 líneas de
`visibilidad.ts` para arreglarlo, lo aplicó bien en las páginas (`tenant-efectivo.ts:55`,
`dashboard/[id]/page.tsx:41` — verificado, funciona) **y a la vez estrenó una
ruta de API nueva que lo vuelve a abrir en JSON**. Encima, `src/app/api/` sigue
sin importar `permisos.ts` en ninguna de sus cinco rutas: los dos CRÍTICOS de la
ronda 10 están abiertos aquí, línea por línea, sin un solo cambio
(`git diff fe2d11c..HEAD -- src/app/api` no toca ni `export/liquidaciones` ni
`export/pdf`). Y las 567 líneas nuevas de `operacion.ts` son las **primeras
escrituras administrativas del producto** y llegaron sin traducir un solo error
de Postgres: hay un camino de dos clics, en el tenant del demo, que tumba la
pantalla con "Código del incidente: 39dfa…".

Riesgo mayor hoy: el jefe de tráfico y el chofer pueden bajarse las finanzas de
la flota con un `GET` a `/api/dashboard/asistente` —monto comprobado, IVA y
peaje acreditables, y el detalle de las anomalías de fraude—, que es
exactamente lo que el archivo que se escribió esta ronda promete impedir.

---

## Hallazgos

### [CRÍTICO] `/api/dashboard/asistente` no mira el rol: el encargado —y el chofer con sesión— reciben las finanzas de la flota en JSON, que es lo que `visibilidad.ts` se escribió para impedir

`src/app/api/dashboard/asistente/route.ts:26-33` · `:46-58` · `src/app/dashboard/chrome.tsx:90` · `src/app/dashboard/chat.tsx:25,37,40`

La ruta es NUEVA en estos 40 commits (59 líneas, `729638e`). Su cabecera explica
con cuidado que "la autorización se rehace COMPLETA en este handler" — y lo que
rehace es la del **tenant** (`?tenant=` solo lo honra un superadmin, `:38-41`,
correcto). Del **rol** no pregunta nada:

```ts
const sesion = await getSessionTenant();
if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
let tenantId = sesion.tenantId;          // ← y de aquí en adelante, todos iguales
```

Escenario 1, con valores y sin nada adversarial. Javier da de alta a
`trafico@innovativos.mx` con `rol = 'encargado'`, `tenant_id = 1111…`. El
encargado abre `/dashboard/despacho`, que es SU pantalla. `chrome.tsx:90` pinta
`<RailAsistente />` **en las 20 páginas, sin mirar el rol** (el gate por área
vive en `sidebar-nav` y en `resolverTenantEfectivo`, no en el marco). El rail
hace `fetch('/api/dashboard/asistente')` (`rail.tsx:58`) y recibe:

- `kpis.montoComprobado` → `chat.tsx:25` lo pinta: *"Llevas $47,300.00
  comprobados en 12 viajes."*
- `acred.iva`, `acred.peaje` → `chat.tsx:37,40`: *"$8,412.00 de IVA acreditable
  este periodo"*, *"$3,100.00 de peaje acreditable (50%)"*.
- `anomalias[].monto` → `rail.tsx:118`: *"3 comprobantes en más de un viaje, por
  $9,400.00."*
- `kpis.tasaCuadre` → `rail.tsx:128`.

O sea: el jefe de tráfico lee el comprobado, los acreditables fiscales y el
detector de fraude de la flota. `visibilidad.ts:41` dice `encargado:
['operacion']` y su cabecera (`:8-12`) dice textualmente que enseñarle el margen
"no es un detalle de UI, es exponerle a un puesto medio las finanzas completas
de la empresa".

Escenario 2, el chofer. Juan, `rol = 'operador'`, `tenant_id = 1111…`. Si abre
`/dashboard`, `resolverTenantEfectivo:55` lo rebota a `/sin-acceso` — eso SÍ
quedó cerrado esta ronda y lo verifiqué. Pero con la misma cookie de sesión:
`curl -b sb-…-auth-token=… https://app.likida.ai/api/dashboard/asistente`
devuelve el JSON completo. `/api` está fuera del matcher del proxy
(`proxy.ts:81`), la consulta corre con `supabaseAdmin()` (service-role, salta la
RLS de la 0045) y el `if` de arriba solo pregunta si hay sesión.

Consecuencia: el contralor compra este producto para controlar qué sabe cada
puesto sobre el dinero de la flota. Si en la sala pregunta "¿y mi jefe de
tráfico qué ve?", la respuesta honesta hoy es "en su pantalla no lo ve, pero el
recuadro del asistente que tiene al lado sí se lo dice".

Causa raíz probable: `visibilidad.ts` se aplicó en las dos capas que su propia
cabecera enumera (sidebar y página) y la ruta de API se escribió después,
copiando el gate de tenant de `resolverTenantEfectivo` sin copiar el
`puedeVerRuta`/`puedeVerArea` que va tres líneas antes.

Prueba que lo cubra: **ninguna**. `visibilidad.test.ts` (120 líneas) prueba la
tabla pura —`areasDe`, `puedeVerRuta`, `rolEfectivo`—; ningún `*.test.ts` del
repo importa `api/dashboard/asistente` (`grep` sobre `api/dashboard`,
`asistente`: cero coincidencias fuera de `route.ts` y `rail.tsx`).

---

### [CRÍTICO] `/api/export/liquidaciones` y `/api/export/pdf/[id]` siguen sin mirar el rol — REINCIDENTE, y verificado como intacto en este árbol

`src/app/api/export/liquidaciones/route.ts:17-19` · `src/app/api/export/pdf/[id]/route.ts:32-34` · `src/lib/auth/permisos.ts:9`

No lo doy por cerrado ni por abierto de oído: `git diff fe2d11c..HEAD --
src/app/api` devuelve **solo** `dashboard/asistente/route.ts` (+59). Las dos
rutas del hallazgo de la ronda 10 no tienen una línea distinta. La puerta sigue
siendo la misma en las dos:

```ts
const s = await getSessionTenant();
if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
```

Y `permisos.ts:9` sigue afirmando por escrito que estas funciones deciden "qué
botón se pinta **y qué endpoint acepta la petición**". Confirmado con `grep`
sobre `src/app/api/`: **ninguna de las cinco rutas importa `permisos`**. Cero.

Lo nuevo de esta ronda que agrava el hallazgo: ahora `puedeExportar` sí gobierna
tres JSX (`dashboard/[id]/page.tsx:127`, `analitica/page.tsx:102`,
`cuadre/page.tsx:158`), o sea que la distancia entre lo que la UI promete y lo
que el endpoint concede creció en vez de encogerse.

Escenario con valores, idéntico al de la ronda 10 porque el código es idéntico:
Juan (`rol='operador'`, `tenant='1111…'`) pide `GET /api/export/liquidaciones` →
CSV con `created_at, total_comprobado, total_anticipo, diferencia, estatus,
diferencias, folio, nombre del operador` de toda la flota
(`route.ts:21-26`, `.eq('tenant_id', …)` con service-role). Con
`GET /api/export/pdf/<uuid>` obtiene la URL firmada del ejemplar del
CONTRALOR de un viaje que no es suyo.

Consecuencia: el aislamiento por chofer de la 0045 —tres policies,
`is_operador()`, `get_user_operador_id()`— se rodea con dos peticiones GET.

Causa raíz probable: la misma de la ronda 10 —"¿tiene la llave?" se tradujo por
"¿tiene sesión?"— y el PR que lo arreglaba no está mergeado.

Prueba que lo cubra: **ninguna, ni antes ni ahora**. `export.test.ts` prueba
`toCsv`/`toLiquidacionRows` (el formateo), no la lectura ni la puerta.

---

### [CRÍTICO] Dar de alta o asignar un viaje al chofer del guion del demo choca contra `uq_viaje_abierto_por_operador` y la pantalla muere con un código de incidente

`src/lib/cuadra/operacion.ts:471-486` · `src/app/dashboard/despacho/page.tsx:92-120` · `:74-90` · `src/lib/cuadra/repo.ts:109-116` · `src/lib/cuadra/pg_errores.ts:40-45` · `supabase/seed.sql:110-117` · `supabase/migrations/0029_un_viaje_abierto_por_operador.sql:71-73`

Intenté refutarlo por dos lados y el guardarraíl aguanta donde importa: la 0029
sí impide que el dinero se cuelgue del viaje equivocado (dos viajes abiertos por
chofer son imposibles), y `crearViaje` sí falla cerrado. El problema es el otro:
**nadie traduce el 23505 y la pantalla se cae**.

Escenario con valores, dos clics:

1. `seed.sql:110-117` deja `44444444-…-0001` (folio `VJ-2026-0847`, Silao →
   Nuevo Laredo, anticipo $10,600) en estatus `abierto`, asignado al operador
   `33333333-…-0001`. Es el viaje del guion del demo.
2. En la sala, `/dashboard/despacho` → "Dar de alta un viaje": folio
   `VJ-2026-0848`, origen "Nuevo Laredo", anticipo `8000`, y en el `<select>` de
   chofer el único con datos, que es ese mismo operador.
3. `accionCrear` valida el anticipo (`page.tsx:106`, bien hecho) y llama
   `crearViaje`. Postgres devuelve `23505 duplicate key value violates unique
   constraint "uq_viaje_abierto_por_operador"`. `acotada` lo entrega por valor,
   `operacion.ts:482` lanza `Error('crearViaje: duplicate key value…')`.
4. Nadie lo atrapa. El server action propaga, y `dashboard/error.tsx:54` pinta
   **"No se pudo cargar el panel — Hubo un problema al leer los datos"** con
   "Código del incidente: 39dfa…". El texto es doblemente falso: no fue una
   lectura, y el panel sí se podía cargar.

Lo mismo por otras tres puertas, todas de un clic:

- `accionAsignar` (`despacho/page.tsx:82`) → `reasignarOperador` sobre un chofer
  que ya trae viaje abierto: mismo 23505, misma pantalla muerta.
- `crearUnidad` (`operacion.ts:512-524`) contra `unidad_economico_unico`
  (`0047:51`): teclear "C2-08" dos veces —el caso más normal del mundo al
  capturar una flota— revienta la página en vez de decir "ya existe".
- `marcarPodPedido` (`operacion.ts:376-383`) contra `pod_viaje_unico`
  (`0047:151`): el botón "Marcar como pedido" (`pod/vista.tsx:86-94`) no se
  deshabilita al enviar, así que un doble clic manda dos POST; el segundo
  revienta.

Y el repo **ya tiene la herramienta**: `pg_errores.ts:40-45` (`violaIndice(e,
indice)`) se escribió exactamente para esto, con su prueba
(`gasto_tarde.test.ts`), y lo usa el processor (`processor.ts:678`). Ninguna de
las siete escrituras nuevas de `operacion.ts` lo importa.

Consecuencia: para el demo del 6-ago, la pantalla más nueva del producto tiene
una acción de primer nivel que tumba la vista con un hash. Fuera del demo, la
operación más frecuente del jefe de tráfico —adelantarle el siguiente viaje a un
chofer que todavía trae uno— es un error 500 permanente que no explica nada, y
lo que el encargado concluye es "el panel no sirve", no "ese chofer todavía no
cierra".

Causa raíz probable: `operacion.ts` se escribió apoyándose en los constraints de
la 0047 (que es lo correcto) pero sin la capa que traduce el choque a un mensaje
— y sin mirar que el invariante que más se va a tocar, la 0029, es de otra
migración y no está citado en ningún comentario del archivo.

Prueba que lo cubra: **ninguna que ejerza el camino**. `operacion.test.ts:314`
prueba que un insert fallido *lanza* (`FALLAN = { viaje: 'folio duplicado' }`),
que es la mitad correcta; lo que no existe es un caso que verifique que alguien
traduce ese throw. Ningún test toca los server actions de `despacho/`, `pod/`,
`unidades/` ni `incidencias/`.

---

### [ALTO] Las siete escrituras nuevas confían en el id que viene del formulario y ninguna mira filas afectadas: un update que no empata reporta "listo" en verde

`src/lib/cuadra/operacion.ts:490-494` · `:391-395` · `:497-501` · `:563-567` · `:536-549` · `:376-383` · `src/lib/cuadra/repo.ts:109-116` · `src/app/dashboard/despacho/page.tsx:86` (REINCIDENTE, ampliado)

Las cuatro escrituras de tipo `update` tienen la misma forma:

```ts
const { error } = await acotada(supabaseAdmin().from('pod')
  .update({ estado: 'rechazado', nota })
  .eq('id', podId).eq('tenant_id', tenantId), 'rechazarPod');
if (error) throw new Error(`rechazarPod: ${error.message}`);
```

Sin `.select()` y sin `count`. PostgREST responde **204 sin error** cuando el
`WHERE` empata cero filas, así que "no había nada que actualizar" y "se
actualizó" entran por el mismo camino.

Escenario A (el silencioso), con valores: dos personas de la oficina tienen
`/dashboard/pod` abierta. La primera rechaza el POD `p-1`. La segunda, con la
pantalla vieja, manda `podId=p-1` con `nota='ilegible'`. El pod ya no está en
'subido'… pero el filtro es solo `id + tenant_id`, así que sí empata y sí
sobrescribe la nota de la primera. Cambia el caso a un `podId` de una fila que
ya se borró: cero filas, `error === null`, `rechazarPod` no lanza,
`page.tsx:75` redirige a `?ok=rechazado`, y `page.tsx:89` pinta la píldora
verde **"Evidencia rechazada"**. Nada cambió, nadie se enteró, y no hay una sola
línea de log. Igual `cambiarEstadoUnidad` → "Estado actualizado",
`cambiarEstadoIncidencia` → "Estado actualizado", `asignarUnidad` y
`reasignarOperador` → "Viaje asignado".

Escenario B (cruce de flotas): `accionAsignar` (`despacho/page.tsx:86`) toma
`unidadId` del `<form>` y lo pasa a `asignarUnidad`, que acota el `WHERE` por el
**viaje** y escribe el `unidad_id` sin comprobar de quién es. La FK
`viaje.unidad_id references unidad(id)` (`0047:65`) es global. Con el UUID de
una unidad de la flota B, el `UPDATE` corre y el viaje de la flota A queda
apuntando a un camión de la B. Lo mismo `crearIncidencia`
(`operacion.ts:536-549`), que acepta `viajeId`/`unidadId` de cualquier tenant, y
`marcarPodPedido`, que además ocupa el `pod_viaje_unico` de un viaje ajeno y
deja al dueño real sin poder crear el suyo nunca (23505 permanente). Es el mismo
hallazgo ALTO de la ronda 10 sobre `reasignarOperador` —que sigue idéntico en
`repo.ts:109-116`— reproducido en cuatro escrituras nuevas.

Y ninguna de las siete nombra la fila en su error: `throw new
Error('asignarUnidad: sin respuesta en 8000 ms')` no dice qué viaje ni qué
unidad, así que la línea `supabase.tope_agotado` que sí deja `acotada`
(`presupuesto.ts:158`) tampoco se puede atar a nada.

Consecuencia: para el encargado, acciones que dicen que funcionaron y no
funcionaron —el peor tipo de fallo en la pantalla que existe para perseguir
cosas. Para quien mantenga esto, un reporte de "rechacé el POD y sigue ahí" sin
un solo dato con el cual buscar. Y para el aislamiento multi-tenant, cuatro
escrituras más por las que una flota puede plantar una referencia en otra.

Causa raíz probable: la validación de los ids se dejó implícita en los
`<select>` que la página pinta, y `acotada` se leyó como "esto ya cubre el
error" cuando lo que cubre es el error, no el vacío.

Prueba que lo cubra: **ninguna, y el mock la vuelve invisible**. El constructor
de `operacion.test.ts:44-46` resuelve todo update sin fallo como
`{ data: null, error: null }`, o sea que **codifica el cero-filas como éxito**;
`:300-328` verifica los *filtros* del update (`[['id','i-1'],['tenant_id','t-1']]`),
que es lo que se puede ver desde ahí. No hay caso con un id de otro tenant ni
con un update que no empate.

---

### [ALTO] "Avance de cierre — Todo" calcula el porcentaje sobre los 100 viajes más recientes y no lo dice

`src/lib/cuadra/analytics.ts:328-334` · `src/app/dashboard/page.tsx:89` · `:138` · `src/app/dashboard/avance-cierre.tsx:41-56`

`getViajes(tenantId, limite = 100)` es de lo nuevo del diff de 386 líneas, y es
la única función de lectura del archivo que **no** pasa por `traerTodo`:

```ts
.order('created_at', { ascending: false })
.limit(limite);
```

`dashboard/page.tsx:89` la llama sin segundo argumento —o sea 100— y le pasa el
resultado a `AvanceCierre`, que en el cliente calcula "liquidados / iniciados
en el periodo" con tres pestañas: Semana, Mes y **Todo**.

Escenario con valores: flota de 40 unidades, ~25 viajes nuevos al día, y un
viaje tarda ~3 días en cerrar. Los 100 más recientes por `created_at desc` son
los últimos **4 días**. Con la pestaña "Todo", `corte === null`
(`avance-cierre.tsx:41`), así que `dentro = 100` y `cerrados` son solo los que
alcanzaron a liquidarse en esos 4 días: unos 25. La barra pinta **"Avance de
cierre 25%"** bajo el rótulo "Todo", cuando el histórico real de la flota es
~95%. Con "Mes" da exactamente el mismo número, porque los 100 caben enteros
dentro de los 30 días — dos pestañas distintas que dan lo mismo y ninguna de
las dos es cierta.

Es el mismo modo de falla que este repo persiguió dos veces (`repo.ts:731-741`,
`pg.ts:28-38`), con el agravante de que aquí el recorte no lo pone PostgREST:
lo pone el código, a 100, y la pantalla lo presenta como el total.

Hermano del mismo hallazgo: `getDocumentos` (`analytics.ts:358-364`) pide
`.limit(1000)` y `facturacion/page.tsx:34` y `combustible-casetas/page.tsx:44`
lo llaman con `1000` — **exactamente el techo de `max_rows`**. A las 1,001 filas
de `gasto` el recorte deja de ser el del código y pasa a ser el silencioso de
PostgREST, sin un `count` que lo delate.

Consecuencia: la barra que el contralor mira para decidir si su operación va al
corriente es una acusación de retraso fabricada por un `limit`. Y "Todo" no es
todo, que es la regla de rótulos que el producto se puso.

Causa raíz probable: `getViajes` nació para una tabla paginada de 100 renglones
y después se reusó como fuente de un agregado sobre el histórico, sin que el
`limite` volviera a mirarse.

Prueba que lo cubra: **ninguna**. `analytics.test.ts` (24 casos) y
`analytics_paginacion.test.ts` (2) no mencionan `getViajes`, `getDocumentos`,
`getGastoPorConcepto`, `getOperadoresDetalle`, `getValorAhorro` ni
`getLiquidacionesPorDia`. De las 386 líneas nuevas del archivo, las seis
funciones de lectura nuevas tienen cero pruebas.

---

### [ALTO] El CSV que va al ERP se sigue recortando en silencio a 1,000 renglones — REINCIDENTE, sin un cambio

`src/app/api/export/liquidaciones/route.ts:21-26`

Verificado por diff, no por lectura: el archivo no se tocó en los 40 commits.
Sigue `.limit(5000)`, sin `count: 'exact'`, sin paginar, sin `Content-Range`, y
`db-max-rows` de la plataforma —1,000, valor que el propio repo afirma dos veces
por escrito (`repo.ts:731-741`, `pg.ts:28-38`)— gana sobre el `limit` del
cliente.

Escenario con valores: flota de 40 unidades, ~25 liquidaciones cerradas al día;
al mes 3 lleva ~1,800. El contralor pulsa "Exportar CSV" para conciliar el
trimestre. `order('created_at', desc)` + techo de 1,000 → el archivo trae de hoy
hacia atrás y **corta a mitad del segundo mes**, con `HTTP 200`,
`Content-Disposition: attachment` y ni una fila de advertencia. Excel abre 1,000
renglones bien formados y la conciliación cuadra contra un universo al que le
falta el 44%.

Consecuencia: una cifra de gasto subestimada que entra al ERP del cliente como
buena, y lo que falta es lo más viejo, que es justo lo que ya nadie revisa.

Causa raíz probable: `.limit(5000)` se leyó como si el límite del cliente
mandara sobre el techo del servidor.

Prueba que lo cubra: **ninguna**. `export.test.ts` prueba el formateo.

---

### [ALTO] `getSessionTenant` detecta el error del `select` a `app_user`, lo registra y **no corta**: sintetiza una sesión con `rol: 'flota_admin'` y `tenantId: null`

`src/lib/auth/session.ts:33` · `:40-48`

```ts
const { data, error } = await sb.from('app_user')
  .select('tenant_id, rol, nombre, operador_id, avatar_url')…
if (error) logger.warn('session.app_user_error', { userId: user.id, err: error.message });
return {
  tenantId: (data?.tenant_id as string) ?? null,
  rol: (data?.rol as string) ?? 'flota_admin',   // ← con error, esto NO es un default: es una invención
  …
};
```

El `if` detecta la condición mala y **no hace `return`**. Es el patrón exacto
que este rubro persigue, en la única puerta de entrada del producto.

Escenario con valores, y no es de laboratorio: este árbol trae dos migraciones
sin aplicar contra la base real (0046 `avatar_url`, 0047). Si el deploy de
Vercel llega antes que la migración —que es el orden por default, porque el push
a `master` redespliega solo—, PostgREST responde `42703 column
app_user.avatar_url does not exist` para **todos** los usuarios. `data` queda
`null`, así que:

- el contralor (`flota_admin`) → `tenantId: null` → `requireSessionTenant:34`
  → `/sin-acceso`, con un texto que le dice que pida su alta. Falso.
- Javier (`superadmin`) → su `rol` también se lee como `'flota_admin'` por el
  `??`, así que ni siquiera cae en la rama de `:33` que lo salvaría: también va
  a `/sin-acceso`.
- El único rastro es un `logger.warn`, no un `error`, con `err: "column
  app_user.avatar_url does not exist"` — un mensaje que sí sirve, si alguien
  está mirando los warns el 6 de agosto a las 10:00.

Consecuencia: el producto entero queda cerrado para todo el mundo, incluido el
dueño, y lo que se lee en pantalla es "tu cuenta no está dada de alta". Es la
diferencia entre 10 minutos de diagnóstico y una hora. El MAPA señala este
`select` (`session.ts:33`) como el CRÍTICO de modelo de datos que la ronda 10
cerró con un reintento por `esColumnaAusente`; ese reintento **no está aquí**.
Lo reporto desde backend porque la parte que me toca no es la columna: es que el
error se detecta y la ejecución continúa construyendo un objeto de sesión con
valores inventados.

Causa raíz probable: `data?` con `??` se escribió para el caso legítimo
"usuario autenticado sin fila en `app_user`" (alta pendiente) y quedó cubriendo
también el caso "la consulta falló", que necesita otra respuesta.

Prueba que lo cubra: **ninguna**. `session.test.ts` tiene 9 casos; `:33`
("usuario autenticado sin fila en app_user") pone `data: null` con
`error: null` — el caso legítimo. No existe ningún caso con `error` distinto de
null.

---

### [MEDIO] El despacho asigna la unidad al viaje y nunca la saca de "disponible": el tablero la sigue contando libre y el selector la sigue ofreciendo

`src/lib/cuadra/operacion.ts:490-494` · `:443` · `src/app/dashboard/despacho/page.tsx:86` · `:123` · `supabase/migrations/0047_operacion_encargado.sql:56-57`

`asignarUnidad` escribe `viaje.unidad_id` y punto. Confirmé con `grep` que
**nada en `src/` escribe `unidad.estado`** salvo `cambiarEstadoUnidad`, que solo
lo llama el botón manual de `/dashboard/unidades`. Y la 0047 promete lo
contrario en el comentario de la propia columna: *"disponible | en_ruta |
taller | baja. **Lo mueve el despacho**, no un humano tecleando."*

Escenario con valores: la flota tiene 8 unidades en `estado='disponible'`. El
encargado despacha las 8 durante la mañana con "Asignar". Al mediodía:
`getTableroOperacion:443` sigue devolviendo `unidadesDisponibles: 8` y la
tarjeta del tablero dice **"8 disponibles"** con los 8 camiones en carretera;
`despacho/page.tsx:123` (`unidadesLibres`) vuelve a ofrecer C2-08 en el
`<select>` del noveno viaje, y nada —ni un constraint ni una comprobación—
impide que dos viajes abiertos compartan la misma unidad.

Consecuencia: la cifra que el encargado usa para decidir "¿tengo con qué?" es
siempre el total de la flota, y la única pantalla del producto que existe para
repartir trabajo permite repartir el mismo camión dos veces. No es dinero mal
calculado, pero sí es un número operativo afirmado que nadie va a dudar.

Causa raíz probable: el ciclo de vida del estado de la unidad se documentó en la
migración y no se implementó en la escritura que lo tenía que mover.

Prueba que lo cubra: **ninguna** — `operacion.test.ts` no ejercita
`asignarUnidad` en absoluto.

---

### [MEDIO] El día se calcula en UTC en la gráfica de cierres y en los vencimientos de papeles, y el panel es de México (UTC−6)

`src/lib/cuadra/analytics.ts:171-174` · `:36-41` · `src/lib/cuadra/operacion.ts:182`

`getLiquidacionesPorDia` agrupa con `(r.created_at as string).slice(0, 10)`
—fecha UTC— y arma la ventana con `new Date().toISOString().slice(0, 10)`. El
mismo archivo documenta este bug **treinta líneas más arriba** como ya pagado en
otro sitio (`analytics.ts:471-473`: *"`.slice(0, 10)` aquí fechaba en agosto lo
cerrado el 31 de julio a las 20:00 hora local (auditoría 5, frontend, MEDIO
3)"*). Se arregló en el detalle de la liquidación y se reintrodujo en la
gráfica.

Escenario con valores: una liquidación cierra el viernes 31-jul-2026 a las
20:00 hora de México = `2026-08-01T02:00:00Z`. La gráfica "Liquidaciones
cerradas — últimos 7 días" (`dashboard/page.tsx:208`) la pinta en la barra del
**sábado 1 de agosto**. El contralor que cuenta los cierres del viernes en su
propio corte encuentra uno menos. Con el corte de mes es peor: todo lo cerrado
después de las 18:00 del último día del mes cae en el mes siguiente.

Mismo error en `operacion.ts:182`: `base = Date.UTC(hoy.getUTC…)`. A las 18:01
hora de México ya es el día siguiente en UTC, así que un permiso SICT que vence
mañana se pinta **"Vence hoy"** —o peor, uno que vence hoy se pinta con
`diasAlVencimiento = -1`, o sea en rojo de vencido, cuando el camión todavía
puede circular legalmente esa tarde.

Consecuencia: cifras y semáforos de cumplimiento corridos un día para la mitad
de las horas hábiles del país. `getUnidades` sí acepta `hoy` inyectable
(`:160`), pero nadie le pasa la zona.

Causa raíz probable: `toISOString()` y `Date.UTC` se usaron como "la fecha" en
un producto cuya única zona horaria es `America/Mexico_City`
(`conv.ts:161` ya la declara).

Prueba que lo cubra: parcialmente. `operacion.test.ts:139` inyecta
`hoy = '2026-08-03T12:00:00Z'` (mediodía UTC = 6 am en México), que es
justamente la franja donde los dos calendarios coinciden — la prueba pasa y el
bug sobrevive. Para `getLiquidacionesPorDia`: ninguna.

---

### [MEDIO] `getResumenNegocio` sigue leyendo `gasto` y `viaje` sin paginar ni ordenar — REINCIDENTE

`src/lib/admin/negocio.ts:63` · `:65`

El diff de esta ronda sobre el archivo (+21 líneas) es solo el parámetro
`ventanaDias` para `facturasPorDia`. Las dos consultas del hallazgo siguen
así, sin `.range()` y sin `.order()`:

```ts
admin.from('viaje').select('id, tenant_id'),
admin.from('gasto').select('created_at'),
```

Escenario con valores: `gasto` con 14,300 filas. PostgREST corta en 1,000, y sin
`order by` entrega las que el planner tenga a mano (en la práctica las más
antiguas). El contador retro de `/admin` dice **"1,000 facturas procesadas"**
para siempre, y `facturasPorDia` —que ahora además puede pedir una ventana de
30 días— no encuentra **ninguna** fila reciente entre esas 1,000 viejas: la
gráfica se pinta plana en cero mientras el sistema procesa cientos al día.
Ampliar la ventana de 7 a 30 días empeora el efecto, porque hay más barras que
llenar con el mismo conjunto truncado.

Consecuencia: Javier decide precio y capacidad mirando una cifra congelada en un
número redondo que parece un tope de producto.

Causa raíz probable: la excepción "hoy son 131 filas" se aplicó al archivo
entero contando solo la tabla más chica.

Prueba que lo cubra: **ninguna** — `negocio.test.ts` no toca truncamiento.

---

### [BAJO] `proxy.ts` descarta el `error` de `auth.getUser()`: una caída de Supabase Auth expulsa a todos y no deja una línea

`src/proxy.ts:59`

`const { data: { user } } = await supabase.auth.getUser();` — solo `data`. Falla
cerrado, que es lo correcto y no lo discuto: sin `user`, a `/login`. Lo que
falta es el testigo. Si el 6-ago a las 10:05 Supabase Auth tiene un bache de
90 segundos, todo el que esté en el panel aterriza en `/login?next=/dashboard`
sin nada en el servidor que distinga "se les venció la sesión a todos a la vez"
de "hubo un incidente en el proveedor". `session.ts:52` sí deja
`session.reintento` para el camino equivalente del lado de la página; el proxy,
que es la capa que corre primero, no deja nada.

Consecuencia: quien opere esto pierde el único minuto en que se puede saber por
qué el panel echó a la sala.

Causa raíz probable: el gate se reescribió mirando el flujo de cookies (que
quedó bien, y con prueba) y no el flujo de errores.

---

### [BAJO] `/api/demo` acepta lo que no debería: `req.json()` sin `try`, y campos sin validar que llegan hasta el motor de cuadre

`src/app/api/demo/route.ts:32-41`

```ts
const body = (await req.json()) as { comprobantes: Partial<Gasto>[]; anticipo: number };
const gastos = (body.comprobantes ?? []).map(…)
```

El `as` es una promesa, no una comprobación. Tres entradas concretas:

- `POST /api/demo` con `Content-Type: application/json` y cuerpo `<html>`:
  `req.json()` lanza, nadie lo atrapa → 500 sin log. El webhook, tres archivos
  más allá, sí lo hace bien (`whatsapp/route.ts:51-55` → 400 "Bad JSON").
- `{"comprobantes": "hola", "anticipo": 0}`: `"hola" ?? []` no es `[]`, y
  `.map` sobre un string no existe → TypeError → 500.
- `{"comprobantes": [], "anticipo": "cinco mil"}`: `?? 0` no atrapa el NaN, el
  motor cuadra con `anticipo: NaN` y el JSON de respuesta sale con
  `"totalAnticipo": null, "diferencia": null` — el motor de cuadre devolviendo
  nulos donde iban pesos.

Consecuencia: acotada, porque la ruta es determinística y no toca la base
(`/demo/page.tsx:46` es su único consumidor). Pero es la única ruta pública sin
sesión del producto y es la que corre el motor del dinero; que su contrato
acepte un `anticipo` que no es número es deuda que va a cobrar factura el día
que alguien la use para algo más que la pantalla de demo.

---

## Lo que revisé y está bien

- **`resolverTenantEfectivo:55` cierra de verdad el primer CRÍTICO de la ronda
  10 para las páginas.** Lo verifiqué a mano, no por el nombre: con
  `rol='operador'`, `areasDe` devuelve `[]` (`visibilidad.ts:36-49`, el
  `operador` no está en el mapa a propósito), `puedeVerRuta` da `false` y el
  redirect va a `inicioDe('operador') = '/sin-acceso'`. Un chofer con sesión ya
  **no** ve el panel de la flota por la URL. `dashboard/[id]/page.tsx:41` hace
  el equivalente a mano para la ruta dinámica, con el comentario que explica por
  qué no puede ir en el mapa. Eso es trabajo real y está probado
  (`visibilidad.test.ts`, 120 líneas). El hallazgo CRÍTICO de arriba es que la
  ruta de API no participa de ese acuerdo, no que el acuerdo no exista.
- **`pg.ts` (52 líneas nuevas) es la extracción correcta.** `exigir` y
  `traerTodo` salieron de `analytics.ts` para que `operacion.ts` no los
  reimplementara, con el argumento escrito de por qué (`:1-8`), y
  `operacion.ts` los usa en **las 14 lecturas, sin una sola excepción** — lo
  verifiqué consulta por consulta. Cada `traerTodo` lleva además etiqueta propia
  (`'getCargaOperadores.operador'`, `'getPods.viaje'`…), así que un fallo dice
  qué consulta de qué función fue. Es el mejor patrón nuevo de la ronda.
- **`operacion.test.ts:121-127`** ejerce de verdad el fallo cerrado: con
  `FALLAN = { viaje: 'timeout' }`, `getCargaOperadores` **lanza** en vez de
  devolver carga cero. Es el caso que este rubro pide y está escrito, no
  supuesto.
- **`getTableroOperacion:437-446` y `getPods:337-338` parten de los VIAJES, no
  de la tabla `pod`.** El comentario (`:408-414`) nombra el modo de falla —"el
  peor tipo de cero, el que se lee como *no falta ninguno*"— y
  `operacion.test.ts:220-239` lo prueba con un viaje sin fila en `pod`. Correcto
  y probado.
- **La validación de dominios ANTES de escribir**, en las dos páginas donde hay
  `<select>` de valores acotados: `unidades/page.tsx:19,64` valida contra los
  cuatro estados de `unidad_estado_dominio`, e `incidencias/page.tsx:64,75,81`
  contra tipo/prioridad/estado y contra `sla_horas >= 1`. Las dos con el
  comentario que dice por qué (dar un redirect y no un 500). Es exactamente lo
  que a las escrituras del hallazgo CRÍTICO 3 les falta.
- **La re-verificación de permiso DENTRO de cada server action.**
  `tenantDelAction` se repite en las cuatro páginas nuevas
  (`despacho:64-72`, `pod:48-56`, `unidades:49-57`, `incidencias:49-57`) y
  resuelve sesión, rol y tenant **otra vez**, sin confiar en el closure del
  render, con la razón escrita (`despacho/page.tsx:60-62`). El `?tenant=` solo
  lo honra un superadmin y se valida contra la tabla antes de usarse. Ese
  patrón es correcto y está bien argumentado.
- **`api/export/pdf/[id]/route.ts:48-66`** sigue siendo el mejor manejo de
  errores del repo: distingue fallo de lectura (500) de fallo de firma (502),
  loguea los dos con `tenant + liquidacion + path`, y devuelve el mismo 404 para
  "no existe" y "existe sin PDF". Su problema es quién entra, no cómo falla.
- **`api/webhook/whatsapp/route.ts` — sin un solo cambio en los 40 commits**
  (verificado por `git diff`). Firma HMAC antes de parsear, cap de body en dos
  puntos, rate limit por teléfono, un solo `after()` con `Promise.all`, y
  `flushObservabilidad` al final. `extractStatuses` sigue cerrando el circuito
  de los acuses. No lo reabrí.
- **`processor.ts`, `repo.ts` (salvo `reasignarOperador`), `conv.ts`,
  `duplicados.ts`, `pg_errores.ts`** — cero diff desde el árbol base
  (`git diff --stat fe2d11c..HEAD -- src/lib` no los lista). Lo que las rondas
  9 y 10 verificaron ahí sigue valiendo; no lo re-audité para no gastar la
  ronda en lo que no se movió.
- **`analytics.ts:626-696` (`reconstruir`) y `derivoLaConfig`.** El portón de
  `0.015` y la comparación de tipos+`esperado` son de las defensas mejor
  argumentadas del repo, y **sí** tienen prueba propia
  (`analytics_deriva.test.ts`, 12 casos, incluido el del tope fiscal que mueve
  el desglose sin mover el total). El `catch { return null }` de `:693` lo miré
  con sospecha y está bien: es un extra que no puede tirar la pantalla, y el
  camino de respaldo se marca `comprobantesCuadran: false`.
- **`presupuesto.ts:148-169` (`acotada`).** Comprobé que las siete escrituras
  nuevas sí pasan por ella, así que ninguna hereda el default de undici de
  300 s. El tope entra por el mismo camino que un error de Postgres, que es lo
  que preserva la semántica de cada llamador.
- **Compuerta verde, medida por mí sobre este árbol:** `npx vitest run` → exit
  0, 172 archivos, 1,670 pruebas, 1 saltada, 43 s. Coincide con la línea base
  del MAPA.

## Lo que NO alcancé a revisar

- **No pude ejercer una sola de las escrituras nuevas contra Postgres.** Aquí no
  hay Supabase, y `operacion.test.ts` mockea el constructor entero, así que
  todo lo que digo sobre 23505 y sobre el update de cero filas se apoya en el
  contrato de PostgREST y en los constraints que leí en la 0029 y la 0047 — no
  en una ejecución. Es la misma limitación que la migración 0047 declara de sí
  misma ("escrita sin base contra la cual ejercerla").
- **`/admin`: solo su capa de datos.** Miré `negocio.ts` y la puerta
  (`requireSuperadmin` en el layout). Las ~30 páginas nuevas —CommandPalette,
  `calcular-alertas.ts`, `notificaciones-leidas.ts`, `mi-perfil/`— no las abrí:
  es superficie de servidor real y queda sin auditar por mí esta ronda.
- **`avatar-uploader.tsx` (subida de archivo del usuario) no la revisé.** Es
  entrada del usuario que llega a Storage, o sea materia de contratos, pero es
  frontera con seguridad y preferí no reportar algo que no pude ejecutar.
- **El techo real de `max_rows` del proyecto de Supabase sigue sin verificarse
  empíricamente** (no hay `.env` y no se puede editar el repo). Me apoyo en que
  el repo afirma 1,000 por escrito en dos archivos y ya corrigió dos veces
  contra ese número.
- **`tenant-efectivo.ts` como mecanismo de suplantación** (quién puede, cómo se
  acota, qué queda en el log) lo miré solo desde el lado del contrato: valida
  que el rol real sea superadmin y que el uuid exista. **No deja ninguna línea
  de log cuando un superadmin entra al panel de una flota real** — lo anoto aquí
  y no como hallazgo porque la trazabilidad de la suplantación es de seguridad y
  de legal, no mía.
