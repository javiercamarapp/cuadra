# Backend y API — auditoría 11 (pase 2)

**Nota: 6/10** (antes 4). Razón del movimiento: **se atacó y subió**, con una
deuda de costura que sobrevive. Los dos CRÍTICOS del pase 1 están cerrados y los
verifiqué línea por línea, no de oído: `/api/dashboard/asistente` niega el dinero
por área ANTES de consultar (`route.ts:60`, `:77-83`) con seis casos y dos
controles (`rol_no_mirado.test.ts`), las dos rutas de export llaman
`puedeExportar` antes de tocar base o storage (`liquidaciones/route.ts:29`,
`pdf/[id]/route.ts:41`) y el CSV pagina con `traerTodo` probado con 2,400 filas
(`autorizacion.test.ts:123-144`). Las siete escrituras del encargado —el hallazgo
más caro del pase 1— hoy traducen el 23505 por NOMBRE de índice
(`operacion.ts:530-540`), cuentan filas afectadas (`tocadas`, `:542-545`) y
comprueban la pertenencia del id que viene del `<form>` antes de escribirlo
(`exigirDelTenant`, `:554-561`). Eso es trabajo real y con prueba.

Lo que impide subir más: **la matriz de permisos se partió en dos y la API
implementa la mitad permisiva**. `visibilidad.ts` dice que el encargado no ve
dinero; `permisos.ts:21` le da `puedeExportar`; las dos rutas de export gatean
con la segunda. Es la MISMA familia que bajó este rubro a 4 —una ruta de API que
reabre en JSON lo que la página cerró—, ahora en un rol en vez de en todos.

Riesgo mayor hoy: `curl` con la cookie del jefe de tráfico se baja el CSV con el
comprobado, el anticipo y la diferencia de cada liquidación de la flota, que es
exactamente lo que el producto promete impedirle.

---

## Hallazgos

### [CRÍTICO] `puedeExportar` le concede al ENCARGADO las dos únicas rutas de export que existen, y las dos son dinero: `visibilidad.ts` se lo niega en pantalla y `permisos.ts` se lo da por API

`src/lib/auth/permisos.ts:21` · `src/app/api/export/liquidaciones/route.ts:29` ·
`src/app/api/export/pdf/[id]/route.ts:41` · `src/lib/auth/visibilidad.ts:41` ·
`src/lib/cuadra/export.ts:4-13`

Intenté refutarlo por los dos lados y no aguanta. El gate nuevo existe y funciona
— pero pregunta lo que no es:

```ts
const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
```

Escenario con valores, sin nada adversarial. Javier da de alta a
`trafico@innovativos.mx` con `rol = 'encargado'`, `tenant_id = 1111…` — el puesto
para el que se escribió `visibilidad.ts` esta misma ronda. En el panel el gate
funciona: `puedeVerArea('encargado','dinero')` es `false`
(`visibilidad.ts:41`, `encargado: ['operacion']`), así que `/dashboard/cuadre`,
`/dashboard/analitica` y `/dashboard/[id]` lo rebotan y el botón «Exportar CSV»
no se le pinta en ninguna parte. Con la misma cookie:

```
curl -b sb-…-auth-token=… https://app.likida.ai/api/export/liquidaciones
```

`rateLimit` pasa · `getSessionTenant` devuelve `rol:'encargado'` ·
`puedeExportar('encargado')` → **true** · sale `HTTP 200` con
`folio_viaje, operador, fecha, total_comprobado, anticipo, diferencia, estatus,
num_diferencias` de TODAS las liquidaciones de la flota
(`export.ts:66-75`). Con `GET /api/export/pdf/<uuid>` sale además la URL firmada
del ejemplar del CONTRALOR, el que lleva los veredictos.

`/api` está fuera del matcher del proxy (`proxy.ts:108`) y las dos consultas
corren con `supabaseAdmin()` (service-role, salta la RLS), así que ese `if` es la
única puerta. Y el rol NO tiene una sola pantalla de export a la que llegar: la
capacidad que `permisos.ts` le concede no abre ningún botón — abre solo el
bypass.

La contradicción está escrita en el repo, en dos archivos que se citan entre sí:
`operacion.ts:8-9` dice «la matriz de permisos (0044) le da al encargado
**exportar** y asignar, **no ver finanzas**», y lo único exportable del producto
son las finanzas. `visibilidad.ts:8-12` dice que enseñarle el margen «no es un
detalle de UI, es exponerle a un puesto medio las finanzas completas de la
empresa».

Consecuencia: el contralor compra esto para controlar qué sabe cada puesto sobre
el dinero de la flota. En la sala, a «¿y mi jefe de tráfico qué ve?», la respuesta
honesta hoy es «en su pantalla nada, pero se lo puede descargar en Excel».

Causa raíz probable: el arreglo del rail eligió el eje correcto
(`puedeVerArea(rol,'dinero')`) y el arreglo de export eligió el eje viejo
(`puedeExportar`), en dos commits del mismo día sobre dominios disjuntos
(`2fb1982` y `489ff54`). Nadie cruzó las dos tablas.

Prueba que lo cubra: **ninguna, y las que hay lo confirman en verde**.
`autorizacion.test.ts:73-95` prueba `operador` y `gerente_regional`; sus dos
CONTROLES son `contador` y `flota_admin`. **No hay un caso con `encargado` en
ninguno de los dos archivos de autorización de export.** Y `permisos.test.ts:9-10`
afirma explícitamente `puedeExportar('encargado') === true` como comportamiento
deseado: la suite defiende el defecto.

---

### [ALTO] «Ver como Jefe de tráfico» apaga el sidebar y deja el rail del dinero encendido — la cinta dice «solo cambia lo que se te enseña» y es falsa

`src/app/dashboard/layout.tsx:30` · `src/app/dashboard/chrome.tsx:113` ·
`src/app/api/dashboard/asistente/route.ts:33-36`, `:60` ·
`src/app/dashboard/aviso-rol.tsx:41-43` · `src/app/dashboard/sidebar-nav.tsx:104`

El modo de previsualización (`?rol=`) se resuelve con `rolEfectivo` en la PÁGINA
(`tenant-efectivo.ts:105`) y en el sidebar (`sidebar-nav.tsx:104`, `rolMenu`). El
LAYOUT no puede: no recibe `searchParams`, así que pasa el rol REAL
(`layout.tsx:30`, `rol={sesion.rol}`), y `chrome.tsx:113` monta el rail con
`puedeVerArea(rol,'dinero')` sobre ese rol real. El handler del rail tampoco
acepta `rol`: su contrato solo lee `tenant` y `rango`
(`route.ts:43`, `:75`) y decide con `sesion.rol`.

Escenario con valores, y es literalmente el guion del demo. Javier (superadmin)
abre `/dashboard?tenant=<Innovativos>&rol=encargado` para enseñar qué ve el jefe
de tráfico. Sale: la cinta *«Estás viendo el panel como **Jefe de tráfico**. Solo
cambia lo que se te enseña, no lo que puedes hacer»*; el sidebar sin Viajes,
Analítica, Cuadre ni Facturación; **y a la derecha, el rail con
`kpis.montoComprobado` ($47,300.00 en el fixture), `acred.iva` ($8,412.00 bajo
«LIVA, Art. 5») y el detector de anomalías** — porque `rail.tsx:65-71` no
propaga `rol` y el handler resuelve `superadmin`.

Consecuencia: la única pantalla que contesta la pregunta que el contralor va a
hacer, la contesta al revés y con un rótulo que afirma lo contrario de lo que
pasa. Si el contralor mira el rail mientras Javier explica que el encargado no ve
finanzas, el trato se cae ahí. No es fuga de datos —el superadmin ya los ve— es
una demostración que prueba lo opuesto de lo que dice.

Causa raíz probable: `?rol=` se cableó en las dos capas que reciben
`searchParams` y el rail es la tercera, que vive en el layout y pregunta por HTTP;
su contrato de entrada nunca se amplió.

Prueba que lo cubra: **ninguna**. `rol_no_mirado.test.ts` prueba roles de sesión,
nunca `?rol=`; `visibilidad.test.ts` prueba `rolEfectivo` como función pura, sin
un solo caso que ate el rail al rol previsualizado.

---

### [ALTO] El arreglo de `reasignar` existe en un archivo con seis pruebas y el `<form>` monta la copia inline — la trampa documentada, en otro archivo

`src/app/dashboard/[id]/reasignar.ts:29` · `src/app/dashboard/[id]/page.tsx:74`,
`:155` · `src/app/dashboard/[id]/reasignar.test.ts:44` (REINCIDENTE de proceso)

`reasignar.ts` se creó por el ALTO de pruebas de la ronda 10 con esta
justificación escrita en su cabecera (`:7-21`): el auditor mutó
`if (!puedeAsignar(r)) redirect(...)` a `if (false && …)` y la suite quedó verde,
así que el action se extrajo «a un archivo que se puede importar y correr».

Lo verifiqué con `grep` sobre `src/` completo: **el único consumidor de
`reasignarChofer` es su propio test** (`reasignar.test.ts:44`). `page.tsx:13`
importa `reasignarOperador` de `repo.ts` directo, define su propia
`async function reasignar` en `:74`, y el JSX monta ESA:
`<form action={reasignar}>` (`:155`). La misma mutación de hoy sobre `page.tsx:83`
—la línea que de verdad corre— deja la suite igual de verde que antes: los seis
casos de `reasignar.test.ts` no tocan el camino que ejecuta.

Escenario con valores: un `contador` de Innovativos, con sesión válida y sin
botón, arma el POST del server action de `/dashboard/<liq>`. Lo que decide si
pasa es `page.tsx:83`, sin cobertura. Si esa línea se pierde en un refactor —o si
ya se hubiera perdido— nada de la compuerta lo dice, y el efecto es reasignarle el
viaje de Juan Pérez a Ana Ruiz: el PDF y el CSV de esa liquidación le atribuyen el
anticipo al chofer equivocado.

Consecuencia: una prueba verde que mide código muerto es peor que no tener
prueba, porque cierra el hallazgo en el tablero. Es exactamente lo que
`RESULTADO.md:115-119` documenta del PR #7 («el merge trajo la prosa, no el
borrado ni el uso»), reproducido aquí sin que nadie lo notara.

Causa raíz probable: la extracción se hizo y el `page.tsx` no se reescribió para
importarla; nada en el repo falla cuando un `export` queda sin consumidor.

---

### [ALTO] La ruta del rail descarta el `error` del `?tenant=` — el arreglo G-34 se aplicó en ocho copias y esta, que es de esta misma ronda, quedó con el patrón viejo

`src/app/api/dashboard/asistente/route.ts:46` · `src/app/dashboard/[id]/page.tsx:61`,
`:85` · `src/lib/auth/tenant-efectivo.ts:31-45`, `:55-70`

```ts
const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', pedido).maybeSingle();
if (t) { tenantId = t.id as string; tenantNombre = t.nombre as string; }
```

`flotaSuplantada` se escribió esta ronda precisamente para matar este `const {
data } = await` (su cabecera lo dice: «Esto era `const { data } = await …` ocho
veces copiado, y las ocho descartaban el `error`»), y usa `exigir()` para fallar
cerrado y dejar `tenant.suplantacion_ilegible` en el log. Quedan **tres copias
vivas del patrón viejo**, y una está dentro de la ruta que este mismo commit
(`2fb1982`) arregló.

Escenario con valores. Javier demuestra `/dashboard/analitica?tenant=<Innovativos>`.
La página resuelve por `resolverTenantEfectivo` → Innovativos. El rail hace
`GET /api/dashboard/asistente?tenant=<Innovativos>&rango=7`. Un 503 transitorio
de PostgREST en ESA consulta: `t` queda `null`, el `if` no entra, `tenantId` se
queda en `sesion.tenantId` —que para el superadmin es el **tenant DEMO**
(`tenant-efectivo.ts:6-9`)— y `tenantNombre` queda `null`, así que el saludo
tampoco delata el cambio. Salen `getKpis`/`getAcreditables`/`detectarAnomalias`
del DEMO junto a una página que enseña las de Innovativos. Y como la página SÍ
falla cerrado ahora (`exigir` lanza), lo que se proyecta es: contenido central
«No se pudo cargar el panel» y, al lado, el rail afirmando con aplomo
«$47,300.00 comprobados» de otra flota.

Es palabra por palabra el fallo que la cabecera de esta ruta dice existir para
impedir (`route.ts:6-9`): «el rail enseñaría cifras del tenant demo junto a una
página que muestra las de Transportes Innovativos: dos verdades distintas en la
misma pantalla».

Consecuencia: cifras de una flota bajo el nombre de otra, sin una línea de log —
esta ruta no importa `logger`. Para un producto cuya regla es «nunca inventar una
cifra», es la peor forma de romperla: la cifra es real, el dueño no.

Causa raíz probable: los seis agentes de arreglo corrieron en paralelo;
`tenant-efectivo.ts` (G-34) y `asistente/route.ts` (BE-1) eran dominios
disjuntos, y el segundo se escribió con la copia que el primero estaba borrando.

Prueba que lo cubra: **ninguna**. Los dos tests de la ruta mockean
`maybeSingle` como `{ data: null }` — **sin campo `error`**
(`rol_no_mirado.test.ts:33`, `falla_cerrado.test.ts:26`), así que el caso del
error ni siquiera es representable en el mock.

---

### [ALTO] El handler colapsa tres lecturas independientes en un solo booleano: el rail pinta «No pude leer las cifras de tu flota» y el chat, dos centímetros abajo, contesta la cifra

`src/app/api/dashboard/asistente/route.ts:66-68`, `:77-89` ·
`src/app/dashboard/rail.tsx:131-137` · `src/app/dashboard/chat.tsx:56-58`, `:68` ·
`src/app/api/dashboard/asistente/falla_cerrado.test.ts:100-109`

`safe()` comparte una sola variable `fallo` entre las tres consultas del
`Promise.all`. Si UNA falla, `motivo = 'error'` y el estado es 503 — pero las
otras dos **viajan pobladas en el cuerpo**.

Escenario con valores. `detectarAnomalias` (`analytics.ts:133-146`) es la más
pesada de las tres: lee TODA la tabla `gasto` del tenant paginando de 1,000 en
1,000, cada página con el tope de 8 s de `acotada`. Con 14,300 gastos son 15
páginas dentro de un `maxDuration = 30`: es la que se cae primero. Entonces sale
`HTTP 503` con `{ motivo:'error', kpis:{montoComprobado:47300,…},
acred:{iva:8412,…}, anomalias:null }`. En pantalla, a la vez:

- `rail.tsx:131-137` pinta el recuadro rojo *«No pude leer las cifras de tu
  flota. No significa que no haya: significa que no se pudieron leer.»*
- el contralor pulsa el chip «¿Cuánto llevo comprobado?» y `chat.tsx:58`
  —`return kpis ? … : nada`, que mira `kpis`, no `motivo`— contesta
  *«Llevas $47,300.00 comprobados en 12 viajes (los últimos 7 días).»*
- y con «¿Cuánto IVA?», `chat.tsx:68` responde *«$8,412.00 de IVA acreditable en
  los últimos 7 días (LIVA, Art. 5)»* bajo el mismo recuadro rojo.

Al revés es peor: si el que se cae es `getKpis` y `getAcreditables` sobrevive, se
niega el comprobado y se afirma el acreditable fiscal.

Consecuencia: dos afirmaciones contradictorias sobre el mismo dinero en la misma
pantalla, delante del comprador. Y lo que de verdad no corrió —el detector de
comprobantes repetidos entre viajes— se comunica como «no pude leer las cifras»,
que es otra cosa: el contralor concluye «el panel va lento», no «el chequeo de
duplicados no se hizo».

Causa raíz probable: `motivo` se diseñó para tres SITUACIONES
(`route.ts:85-89`) y se calcula desde una sola bandera compartida por tres
CONSULTAS; el consumidor ramifica por `motivo` en un sitio y por `kpis != null`
en otro.

Prueba que lo cubra: **la hay y solo mide la mitad**. `falla_cerrado.test.ts:100-109`
monta exactamente este caso («si lo único que se cae es el detector de anomalías»)
y afirma únicamente `body.motivo === 'error'`. No comprueba que `body.kpis` haya
quedado poblado, ni existe un caso de `responder()` con `motivo:'error'` y
`kpis` no nulo.

---

### [MEDIO] `reasignarOperador` es la única escritura del panel que NO traduce el 23505, y el mensaje que le faltaría ya está escrito tres archivos más allá

`src/lib/cuadra/repo.ts:137` · `src/lib/cuadra/operacion.ts:530-540`, `:485-488` ·
`src/app/dashboard/[id]/page.tsx:90`, `:155` ·
`supabase/migrations/0029_un_viaje_abierto_por_operador.sql:71-73`

`c4358fa` puso `comoError()` en las siete escrituras de `operacion.ts` y
`CHOQUES` incluye `['uq_viaje_abierto_por_operador', 'viaje_abierto']`, cuyo
texto —`CAPTURA.viaje_abierto`, `operacion.ts:485`— dice *«Ese chofer ya trae un
viaje abierto. Ciérralo o liquídalo antes de darle otro»*. `reasignarOperador`
vive en `repo.ts`, no se tocó, y hace `throw new Error(\`reasignarOperador:
${error.message}\`)`.

Escenario con valores, dos clics y sin nada raro. El contralor abre
`/dashboard/<liq de VJ-2026-0847>` y usa «Reasignar chofer» para pasarlo a Ana
Ruiz, que ya trae `VJ-2026-0851` en `abierto`. El índice parcial de la 0029
—`unique on viaje (tenant_id, operador_id) where estatus in ('abierto',
'en_cuadre')`— rechaza el UPDATE con `23505 duplicate key value violates unique
constraint "uq_viaje_abierto_por_operador"`. `acotada` lo entrega por valor,
`repo.ts:137` lanza un `Error` genérico, `reasignar` (`page.tsx:90`) no lo
atrapa —no hay `codigoDeCaptura` en este action, a diferencia de los cuatro de
`despacho`/`pod`/`unidades`/`incidencias`— y `dashboard/error.tsx` pinta **«No se
pudo cargar el panel — Hubo un problema al leer los datos»** con un código de
incidente. Doblemente falso: ni fue una lectura, ni el panel dejó de poder
cargarse.

Consecuencia: la operación más natural del mundo —el chofer al que le quieres
adelantar el siguiente viaje es justo el que todavía trae uno— es un error 500
permanente que no explica nada, en la pantalla del dinero, y el mensaje correcto
está a tres archivos de distancia sin importarse.

Causa raíz probable: el arreglo se acotó al archivo `operacion.ts` (el dominio
D5) y la octava escritura del panel vive en `repo.ts`, que era dominio de otro
agente.

Prueba que lo cubra: **ninguna**. `repo_operadores.test.ts:50-108` prueba
pertenencia y cero-filas; no hay un caso con `code: '23505'`.

---

### [MEDIO] Dos escrituras del encargado son multi-paso sin transacción: el primer paso queda hecho, el segundo revienta, y la pantalla dice que no se hizo nada

`src/lib/cuadra/operacion.ts:600`, `:628-636` ·
`src/app/dashboard/despacho/page.tsx:135-147`, `:102-111`

`crearViaje` inserta el viaje y DESPUÉS llama `cambiarEstadoUnidad(…,'en_ruta')`
(`:600`). `asignarUnidad` hace tres escrituras seguidas: el UPDATE del viaje
(`:628`), liberar la unidad previa (`:634`) y ocupar la nueva (`:635`). No hay
RPC transaccional como el que sí protege el cierre de liquidación
(`repo.ts:604-607`, `guardar_liquidacion_tx`).

Escenario A, con valores. El encargado da de alta `VJ-2026-0848` con la unidad
`C2-08`. El `INSERT` entra. `cambiarEstadoUnidad` se lleva un timeout de
`acotada` (8 s): `comoError` no reconoce el índice, devuelve un `Error` normal,
`codigoDeCaptura` da `null`, `accionCrear` re-lanza (`despacho/page.tsx:146`) y
la pantalla muere con el hash. El encargado concluye que no se guardó y vuelve a
capturarlo → ahora sí `23505` de `uq_viaje_abierto_por_operador` → *«Ese chofer
ya trae un viaje abierto»*, hablándole del viaje que él acaba de crear y cree que
no existe.

Escenario B, el que deja el dato mal. Reasigna la unidad del viaje V1 de `C2-08`
a `C3-11`. El UPDATE del viaje entra, `C2-08` vuelve a `'disponible'` (`:634`), y
el `cambiarEstadoUnidad(C3-11,'en_ruta')` de `:635` falla. Resultado: V1 lleva
`C3-11` y `C3-11` sigue en `'disponible'`. `getTableroOperacion:448` la cuenta
libre, `despacho/page.tsx:154` (`unidadesLibres`) la vuelve a ofrecer en el
`<select>` del siguiente viaje, y no hay constraint que impida que dos viajes
abiertos compartan camión — que es exactamente lo que el docstring de
`asignarUnidad` (`:612-619`) dice existir para impedir.

Consecuencia: el tablero con el que el encargado decide «¿tengo con qué?» afirma
una unidad libre que va en carretera, y el mismo camión se despacha dos veces.

Causa raíz probable: `crearViaje`/`asignarUnidad` heredaron el ciclo de vida del
estado de la unidad (bien) sin heredar la atomicidad que el cierre de liquidación
sí exigió en su día.

Prueba que lo cubra: **ninguna que ejerza el segundo paso fallando**.
`operacion.test.ts` verifica filtros y throws de un solo paso; el constructor
mockeado no permite hacer fallar la segunda escritura y no la hace fallar en
ningún caso.

---

### [MEDIO] Se pagina con `.range()` sobre una columna que no es única — el CSV que va al ERP puede repetir u omitir renglones sin decirlo

`src/app/api/export/liquidaciones/route.ts:55` · `src/lib/admin/negocio.ts:108` ·
`src/lib/cuadra/pg.ts:51-65` · `src/lib/admin/negocio.ts:93-96`

El propio repo escribe la regla en `negocio.ts:93-96`: «El `.order()` NO es
cosmético: es lo que hace que "la página 2" signifique algo. Sin él, dos
peticiones al mismo rango pueden devolver filas distintas y la suma sale mal en
silencio.» Y la respeta en casi todas partes con `.order('id')` — o con
`.order('created_at').order('id')` en `llm_costo` (`negocio.ts:105`). Dos
consultas quedaron con la llave a medias:

- `export.liquidaciones`: `.order('created_at', { ascending: false })`, sin
  desempate.
- `getResumenNegocio/gasto`: `.order('created_at', { ascending: true })`, sin
  desempate — la de al lado, `llm_costo`, sí lo lleva.

Escenario con valores: `guardar_liquidacion_tx` corre dentro de una transacción,
y `now()` en Postgres es la hora de INICIO de transacción — dos cierres que
arrancan en el mismo tick comparten `created_at` al microsegundo. Con 2,400
liquidaciones y un empate a caballo del corte de página (`range(999,1998)`),
Postgres no garantiza el mismo orden entre las dos consultas: el renglón repetido
entra dos veces al CSV y el otro no entra. El contralor concilia el trimestre
contra un archivo con 2,400 renglones exactos, `HTTP 200`, y una liquidación
duplicada y otra ausente.

Consecuencia: en el peor caso, un gasto contado dos veces en la conciliación del
ERP. No es frecuente, pero es indetectable: el conteo cuadra.

Causa raíz probable: al migrar de `.limit(5000)` a `traerTodo` se conservó el
`ORDER BY` que la consulta ya tenía —elegido para presentación, no para
paginación— sin añadirle el desempate que el resto del archivo sí lleva.

Prueba que lo cubra: **ninguna posible con el mock actual**.
`autorizacion.test.ts:33-36` implementa `range` como `FILAS.slice(desde,hasta+1)`
sobre un arreglo estable, o sea que **codifica la paginación estable como un
hecho**: el modo de falla es invisible desde ahí por construcción.

---

### [MEDIO] `traerTodo` se corta a las 100 páginas sin decirlo, y su propio comentario afirma que lo dice

`src/lib/cuadra/pg.ts:42-44`, `:51-66`

```ts
/** 100 páginas son 100,000 filas. Un tenant que las pase necesita un `sum()`
 *  en SQL, no más vueltas: se corta y se dice, en vez de colgar el turno. */
const MAX_PAGINAS = 100;
```

El bucle sale por `pagina < MAX_PAGINAS` y no hay `logger`, ni un flag de
retorno, ni una excepción: la única forma de saber que se cortó sería que el
llamador contara 100,000 exactos.

Escenario con valores: una flota con dos años de operación llega a 100,000 filas
en `gasto` (40 unidades × ~25 viajes/día × ~5 comprobantes ≈ 125/día ⇒ ~2.2
años). `detectarAnomalias` (`analytics.ts:137`) recorre `gasto` entero: a partir
de ahí revisa las 100,000 más viejas por `id`, ignora las nuevas, y el rail
contesta «0 comprobantes en más de un viaje» sobre un universo recortado. Es la
frase que el comentario de esa misma función (`analytics.ts:134-136`) llama «la
afirmación más cara que puede hacer este producto», reintroducida por el techo
que se puso para protegerla.

Consecuencia: hoy, ninguna — ninguna flota está cerca. Lo reporto porque es un
guardarraíl que afirma por escrito hacer algo que no hace, en el archivo que el
repo trata como su borde canónico de PostgREST, y porque el modo de falla es el
mismo silencio de 1,000 filas que este repo ya pagó tres veces.

Causa raíz probable: el `logger.warn` se describió en el comentario y no se
escribió.

Prueba que lo cubra: **ninguna** — no hay caso con más de 100 páginas.

---

### [MEDIO] El INSERT de `loadConversation` descarta su error y devuelve `id: ''`: en una ráfaga, los turnos de dos de tres mensajes se pierden con un log y sin reintento

`src/lib/cuadra/conv.ts:206-210` · `:255-260` · `src/lib/cuadra/processor.ts:1334`

`loadConversation` lanza `ConsultaFallida` si el SELECT falla (arreglado, con
prueba). El INSERT que va después, no:

```ts
const { data: created } = await acotada(admin.from('wa_conversacion')
  .insert({ … }).select('id').single(), 'loadConversation.insert');
return { id: (created?.id as string) ?? '', turns: [] };
```

Escenario con valores. Es el PRIMER mensaje del operador (no hay fila en
`wa_conversacion`) y Meta entrega tres mensajes de texto en un solo POST —
`route.ts:70-76` los corre con `Promise.all`. Los tres hacen SELECT, los tres ven
`data: null`, los tres hacen INSERT; dos chocan con
`wa_conversacion_tenant_tel_uidx` (23505). En esos dos, `created` queda `null`,
la función devuelve `id: ''`, y al cerrar el turno `saveConversation('')` hace
`.eq('id','')` → error de PostgREST → `logger.error('conv.no_se_guardo')` y el
turno se pierde. Meta ya recibió su 200, así que no hay reintento: la memoria de
esos dos turnos desaparece y el agente responde el siguiente mensaje sin saber
qué ya dijo.

Consecuencia: el asistente se repite o se contradice en el arranque de la
conversación, que es justo el minuto del demo. La fila que hace falta YA existe
(la creó el hermano que ganó la carrera) y nadie la vuelve a pedir.

Causa raíz probable: el arreglo de la auditoría 8 atacó el SELECT —que era el
hallazgo— y dejó el INSERT con el patrón que ese mismo hallazgo describe.

Prueba que lo cubra: **ninguna**. `conv_error_disfrazado.test.ts:12` fija
`insertSingle` en `{ data: { id: 'c-nueva' } }` **sin campo `error`**, y sus dos
casos cubren el SELECT. La rama del INSERT fallido no es representable en ese
mock.

---

### [BAJO] `proxy.ts` cita un criterio compartido con `session.ts` que en `session.ts` no existe

`src/proxy.ts:76` · `src/lib/auth/session.ts:40`

`proxy.ts:76` dice «Mismo criterio que `noPudePreguntar` en lib/auth/session.ts;
va repetido aquí y no importado porque este archivo corre en el runtime EDGE».
`grep -rn "noPudePreguntar" src/` devuelve **una sola línea: ese comentario**.
`session.ts:40` registra `logger.warn` para CUALQUIER error del select a
`app_user`, sin distinguir 4xx de «no contestó», que es justo la distinción que
el proxy dice compartir.

Consecuencia: acotada — quien opere esto busca en `session.ts` un filtro que no
está, y a las 3 a.m. concluye que el ruido de `session.app_user_error` es
significativo cuando puede no serlo. Lo reporto porque cambia el significado de
una decisión de operación, no por estilo.

---

## Lo que revisé y está bien

- **`/api/export/liquidaciones` y `/api/export/pdf/[id]` ya autorizan, y lo hacen
  ANTES de tocar nada.** `liquidaciones/route.ts:29-32` y `pdf/[id]/route.ts:41-44`
  responden 403 con `logger.warn` y sin consultar; `autorizacion.test.ts:88-95`
  lo ejerce (`expect(range).not.toHaveBeenCalled()`). El CRÍTICO reincidente del
  pase 1 está cerrado para `operador` y para roles desconocidos — mi hallazgo 1
  es sobre el rol que la lista sí admite, no sobre la ausencia de lista.
- **El CSV ya no se corta en 1,000.** `route.ts:47-64` usa `traerTodo`, y
  `autorizacion.test.ts:123-144` lo prueba con 2,400 filas verificando además las
  ventanas `[[0,999],[1000,1999],[2000,2999]]`. Es la prueba que el pase 1 pedía.
- **`/api/dashboard/asistente` niega el dinero por ÁREA, no por rol enumerado.**
  `route.ts:60` (`puedeVerArea(sesion.rol,'dinero')`) y `:77-83` (`verDinero ? … :
  [null,null,null]`). `rol_no_mirado.test.ts` tiene cuatro negativos —encargado,
  operador, rol desconocido, sin sesión— y **dos controles** (flota_admin y
  contador reciben las cifras), que es lo que impide que «devolver null siempre»
  pase. Es el mejor test de autorización del repo.
- **Las siete escrituras del encargado.** Verifiqué una por una:
  `marcarPodPedido:386`, `rechazarPod:398-399`, `asignarUnidad:631-632`,
  `cambiarEstadoUnidad:642-643`, `crearViaje:594`, `crearUnidad:663`,
  `crearIncidencia:694` y `cambiarEstadoIncidencia:715-716`. Todas pasan por
  `comoError` (traduce el 23505 por NOMBRE de índice, `:530-540` — no por código,
  que es lo correcto) y las cuatro de tipo UPDATE llevan `.select('id')` +
  `tocadas(data) === 0 → ErrorDeCaptura('sin_filas')`. El cero-filas silencioso
  del pase 1 está cerrado.
- **`exigirDelTenant` (`operacion.ts:554-561`) cierra el cruce de flotas.** Las
  FK de la 0047 son de una sola columna; ahora `crearViaje`, `asignarUnidad`,
  `crearIncidencia` y `marcarPodPedido` comprueban la pertenencia del id que
  viene del `<form>` antes de escribirlo, con `ErrorDeCaptura('ajeno')`. El ALTO
  del pase 1 (escenario B) está cerrado.
- **`crearViaje:579` rechaza el viaje sin chofer con un mensaje humano** en vez
  de dejar que el `NOT NULL` de `viaje.operador_id` tumbe la pantalla, y la
  página declara en `EstadoVacio` (`despacho/page.tsx:196-198`) por qué «Sin
  asignar» está vacío por diseño y no por medición. Eso es la regla de «nunca
  inventar una cifra» aplicada a una lista.
- **`reasignarOperador` (`repo.ts:112-143`) sí valida pertenencia y sí mira filas
  afectadas**, y su error nombra viaje y tenant (`:142`). Su único hueco es el
  23505 (hallazgo de arriba).
- **`analytics.ts`: las once lecturas pasan por `traerTodo`.** El `getViajes`
  con `limite = 100` del pase 1 ya no existe (`:387-403`, con el comentario que
  explica por qué era la única sin paginar) y `getDocumentos` ya no pide
  `.limit(1000)` (`:428-439`). El ALTO de «Avance de cierre — Todo» está cerrado
  en su causa.
- **El día calendario ya es de México donde se agrupa.** `diaMx` (`analytics.ts:175-182`)
  usa `Intl` con `TZ_MX`, y `export.ts:29-36` (`fechaIsoMx`) hace lo mismo para
  el CSV. El MEDIO de UTC del pase 1 está cerrado en la llave de agrupación.
- **`proxy.ts:79-87` distingue «no contestó» de «no hay sesión»** y deja
  `proxy.auth_error` con un mensaje que dice qué revisar. El BAJO del pase 1 está
  cerrado, y además arrastra las cookies de borrado al redirect (`:97-99`).
- **`/api/demo` ya valida su contrato.** `route.ts:61-77` atrapa el JSON
  inválido (400), exige que `comprobantes` sea arreglo, que `anticipo` sea número
  finito y que cada `monto` lo sea. Y el `GET` de health quedó detrás de
  `superadmin` con 404 (`:23-27`). El BAJO del pase 1 está cerrado con
  `entrada_invalida.test.ts`.
- **`negocio.ts:95-110` ya pagina las cuatro tablas con `traerTodo`** y ordena.
  El MEDIO reincidente del pase 1 está cerrado salvo por el desempate
  (hallazgo de arriba).
- **El webhook de WhatsApp.** `whatsapp/route.ts` — cap de cuerpo en dos puntos
  antes de la firma (`:42`, `:45`), HMAC antes de parsear (`:46`), 400 en JSON
  malo (`:53`), rate limit por teléfono, un solo `after()` con `Promise.all` y
  `flushObservabilidad` al final (`:90`). `extractStatuses` cierra el circuito de
  los acuses (`:108-120`). Sin cambios y sin objeciones.
- **La sala de espera de huérfanos ahora está atada al viaje.**
  `processor.ts:1086` filtra por `h.ofrecidoParaViaje === viajeId`, y el brazo
  del «va» toma contador de intake Y mutex antes de insertar (`:1113-1121`),
  con el contador liberado en `finally` (`:1207`), los `addGasto` mirando el reloj
  (`:1146-1156`), el marcado DESPUÉS de insertar y la oferta marcada DESPUÉS del
  envío (`:1266-1275`). Es el camino de dinero mejor razonado del repo.
- **`saveLiquidacion` sigue siendo una sola RPC transaccional**
  (`repo.ts:604-618`, `guardar_liquidacion_tx`), no dos statements con el error
  del segundo ignorado.
- **`pg_errores.ts:39-45`** exige el código 23505 ADEMÁS del nombre del índice,
  así que un mensaje que casualmente mencione el índice no se traga un error real.

**Compuerta, medida por mí sobre este árbol:** `npx tsc --noEmit -p .` → exit 0.
`npm run lint` → limpio. `npx vitest run` → **1 fallo**:
`src/lib/cuadra/intake/codigos.test.ts > «aguanta una foto de celular grande y con
orientación EXIF»`, *Test timed out in 5000ms*. Corrido solo, ese archivo pasa en
5.9 s (el caso tarda 3.4 s): es **intermitente por contención**, no una
regresión — pero la línea base del MAPA dice «exit 0» y hoy no lo es. No es de mi
rubro arreglarlo; lo dejo medido.

## Lo que NO alcancé a revisar

- **No pude ejercer una sola escritura contra Postgres.** Aquí no hay Supabase, y
  `operacion.test.ts` mockea el constructor entero. Todo lo que digo sobre el
  23505 de la 0029, sobre la paginación con llave no única y sobre la carrera de
  `loadConversation` se apoya en el contrato de PostgREST/Postgres y en los
  índices que leí en la 0029 y la 0047 — no en una ejecución.
- **No verifiqué el `max_rows` real del proyecto de Supabase**, ni si
  `db-pool` o el plan cambian el tope de 1,000. Me apoyo en que el repo lo afirma
  por escrito en tres archivos y ya corrigió tres veces contra ese número.
- **Las ~30 páginas de `/admin`** (CommandPalette, `calcular-alertas.ts`,
  `notificaciones-leidas.ts`, `mi-perfil/`) siguen sin auditar por mí. Solo miré
  `negocio.ts` y la puerta del layout.
- **`avatar-uploader.tsx` y la subida a Storage** — entrada de usuario que llega
  a un bucket, o sea materia de contratos, pero no la abrí.
- **El agente y `tool-executor`**: `processor.ts` tiene 1,748 líneas y solo
  recorrí el intake, la sala de espera, el cierre y el manejo de errores. Las
  ramas de foto/XML y el bucle de herramientas quedan para tool calling.
- **No revisé `mis-viajes/`** (el panel del chofer) ni sus lecturas: es donde vive
  la RLS de la 0045 y es el otro consumidor posible de estas rutas.
