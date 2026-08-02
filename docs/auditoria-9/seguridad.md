# Seguridad — auditoría 9

**Nota: 7/10** (antes 8). Razón del movimiento: **mirada más profunda** sobre
las dos migraciones nuevas, que encontró un control que el código de arriba
afirma tener y no tiene; y **deuda que cobró factura** — de los ocho hallazgos
de la ronda 8 no se tocó **ninguno**, y el de la URL firmada del PDF va por su
**cuarta** aparición.

El ancla del 8 deja de cumplirse en un punto concreto y por eso baja: no toda
ruta privilegiada tiene dos capas. `corregirFechaGasto` —camino nuevo de esta
ronda, y toca qué fecha se factura— tiene **cero**: la capa de base (el trigger
de la 0037) no dispara para su UPDATE, y la capa de aplicación que iba a
atraparlo (`llegoTarde`) es inalcanzable por esa causa. `foto_pendiente` (0038)
tiene **una**: es la única tabla hija de `viaje` que nace sin la FK compuesta
con `tenant_id` que la 0028 estableció como "el aislamiento es parte de la
clave". El resto del diseño sigue firme: **no hay camino sin autenticar a datos
de un tenant** y **ningún secreto tiene fallback derivado** — lo verifiqué, no
lo heredé.

Sobre lo que se me pidió mirar con nombre: **el RLS de `foto_pendiente` está
bien y no se filtró nada.** `enable row level security` sin policy es
deny-all real para `anon` y `authenticated` (`service_role` pasa por
`rolbypassrls`, no por una policy), mismo criterio que la 0012 y la 0016. Lo
que no queda cerrado ahí es el aislamiento *entre* flotas, que es otra cosa —
ver el segundo hallazgo.

El riesgo mayor del rubro hoy: **el control de integridad post-liquidación se
declara en un comentario y no en el `when` del trigger** — dos sesiones
paralelas escribieron el candado y la puerta el mismo día, cada una suponiendo
que la otra cubría el hueco, y ni una prueba ni un bloque de
`verificaciones.sql` mira ese par junto.

---

## Hallazgos

### [ALTO] `corregirFechaGasto` pasa por encima del trigger de la 0037, y la rama que iba a atraparlo es código muerto

`supabase/migrations/0037_gasto_no_tras_liquidar_update.sql:21-27` ·
`src/lib/cuadra/repo.ts:184-205` · `src/lib/cuadra/processor.ts:639-657`

El `when` del trigger nuevo enumera cinco columnas:

```sql
  when (
    new.monto is distinct from old.monto
    or new.sub_total is distinct from old.sub_total
    or new.iva_traslado is distinct from old.iva_traslado
    or new.ieps_traslado is distinct from old.ieps_traslado
    or new.cfdi_uuid is distinct from old.cfdi_uuid
  )
```

`fecha` no está. Y `corregirFechaGasto` —función nueva de esta ronda— actualiza
**exactamente y solamente** esa columna (`repo.ts:193`):

```ts
supabaseAdmin().from('gasto').update({ fecha }).eq('id', gastoId).eq('tenant_id', tenantId)
```

Su propio docstring (`repo.ts:184-185`) afirma lo contrario: *«El trigger de la
0037 sigue mandando: si la liquidación ya se emitió, esto levanta `CU001` y el
processor lo traduce, igual que en el alta.»* No lo levanta: el `when` evalúa
falso y la función del trigger ni se llama.

**Escenario, con valores.** Viaje V del 30-jul al 1-ago, anticipo $5,000. El
OCR fecha mal un ticket de diésel de $850 y lo pone en `2026-06-01`; el motor
emite `fecha_sospechosa` para ese gasto (`engine.ts:296-301`) y `pedir_fecha.ts`
le pide al operador otra foto del mismo ticket.

1. El operador escribe **"listo"**. El "listo" pasa `esperarIntake` (contador en
   0: la foto todavía no llega) y el agente arranca el cierre.
2. **6 segundos después** manda la foto que se le pidió. `getOpenViaje` todavía
   devuelve V —`guardar_liquidacion_tx` no ha corrido—, así que la foto entra,
   hace `intakeDelta(+1)` y se va a OCR (~10 s).
3. **T1:** `guardar_liquidacion_tx` inserta la `liquidacion`, genera los DOS PDF
   con la línea *«La fecha del comprobante de Diésel (2026-06-01) está fuera del
   rango esperado del viaje»* y pone `viaje.estatus='liquidado'`.
4. El OCR de la foto termina. `decidirFoto` devuelve
   `{ accion:'corregir_fecha', gastoId:'g-diesel', fecha:'2026-07-31' }`.
5. `corregirFechaGasto` ejecuta el UPDATE. **El trigger no corre. La escritura
   pasa.**
6. `processor.ts:643` le contesta al operador: *«Ya quedó ✅ — ese ticket de
   $850.00 ahora tiene fecha 31/07/2026. No lo registré otra vez.»*

La rama `if (llegoTarde(e))` de `processor.ts:649-652`, escrita literalmente
para este hecho —su comentario dice *«la liquidación de este viaje ya se emitió
y el trigger de la 0037 lo impide»*— no se ejecuta nunca por esta causa.

**Lo intenté refutar por tres vías y ninguna cierra:**
· La barrera de intake no cubre la foto que llega *después* del "listo" — es
palabra por palabra el escenario que la propia 0036 documenta en su cabecera
(*«El operador escribe "listo"; 6 segundos después manda UNA FOTO MÁS»*).
· El bloque 20 de `verificaciones.sql` no lo ve: prueba `monto`+`cfdi_uuid`
(bloqueado) y `clave_prod_serv` (pasa, como control deliberado). `fecha` cae
del lado del control, y nadie notó que el camino nuevo escribe justo ahí.
· `foto_refoto_fecha.test.ts` tampoco: mockea `corregirFechaGasto` entero
(`:53`), así que prueba el cableado, no el candado. Los 1,436 tests pasan.

**Consecuencia.** Para el contralor: el PDF archivado —el ejemplar que se guarda
y que él lee— dice que ese ticket tiene fecha sospechosa y hay que verificarla,
y la fila de `gasto` que alimenta el panel `/dashboard/{id}` ya no lo dice. Dos
documentos de la misma liquidación con datos distintos, que es el crítico #6 de
la ronda 8 movido de columna. Para el fisco, `fecha` no es cosmética: decide el
periodo del estímulo de diésel y el plazo de facturación (`engine.ts:550-607`).
Para el operador: se le confirma con un ✅ una corrección que su liquidación ya
emitida no recogió.

**Causa raíz probable.** Dos sesiones concurrentes el mismo día, como avisa el
MAPA. Una escribió el `when` estrecho a propósito, para "no bloquear de más"
sobre campos no financieros. La otra escribió un camino nuevo que actualiza un
campo no financiero y dio por hecho que el trigger lo cubría — y lo dejó
escrito como un hecho en el docstring y en un `catch`.

---

### [MEDIO] `foto_pendiente` es la única tabla hija de `viaje` que nace sin la FK compuesta con `tenant_id`

`supabase/migrations/0038_foto_pendiente.sql:30-37`

```sql
create table if not exists foto_pendiente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid not null references viaje(id) on delete cascade,   -- ← a (id), no a (id, tenant_id)
  ...
```

La 0028 estableció el criterio y lo escribió en su cabecera: *«el aislamiento
deja de ser "una columna repetida en cada tabla" y pasa a ser parte de la
relación»*. Aplicó `(viaje_id, tenant_id) → viaje(id, tenant_id)` a `gasto`,
`liquidacion` y **`codigo_pendiente`** — que es la tabla gemela de ésta, con la
misma forma y el mismo papel. La 0038, escrita cuatro migraciones después, no
la lleva.

**Escenario, con valores.** Hoy la única defensa es que
`guardarFotoPendiente(op.tenantId, viajeId, mediaId)` recibe los dos valores del
mismo `resolveOperador`/`getOpenViaje`, así que coinciden por construcción. El
día que no coincidan —un parámetro invertido en un refactor, una llamada desde
un job nuevo, un `viajeId` que venga de otra consulta— la base acepta la fila:
`tenant_id = A`, `viaje_id = <viaje de B>`. Y entonces
`reclamarFotoPendiente(A, { viajeId: <viaje de B> })` (`repo.ts:408-409`, que
filtra por los dos y por eso la encuentra) devuelve el `media_id` de una foto de
la flota B, `downloadMediaAsDataUrl` la baja y `extraerComprobante` la fusiona
con la foto de A: un ticket con el RFC, el domicilio y el consumo de otra flota
entra como gasto de ésta, y su foto se sube a `comprobantes/A/…`.
En `gasto` y `liquidacion` ese mismo error rebota contra la FK; aquí no rebota
contra nada.

**Consecuencia.** Para las dos flotas: dinero y datos personales de una contados
en la liquidación de la otra — el escenario textual que la 0028 se escribió para
cerrar, sobre la tabla nueva. Para el equipo: una excepción silenciosa a una
regla que el repo da por universal (el bloque 18 de `verificaciones.sql` mira
RLS y grants, no la forma de las FK, así que esto no aparece en ningún tablero).

**Causa raíz probable.** La 0038 se escribió copiando la 0016 (`codigo_pendiente`
*antes* de que la 0028 la arreglara), no la 0016 ya arreglada.

---

### [MEDIO] La foto del ticket —con RFC, domicilio y a veces dato sensible— se firma por una hora para pintarla en una página que dura segundos

`src/lib/cuadra/intake/almacen.ts:76` · `src/app/dashboard/[id]/page.tsx:48-50`

```ts
export async function ligaComprobante(ruta: string, segundos = 3600): Promise<string | undefined>
```
```tsx
const ligas = await Promise.all(
  d.gastos.map((g) => (g.imagenUrl ? ligaComprobante(g.imagenUrl) : Promise.resolve(undefined))),
);
```

Código nuevo de esta ronda (bucket `comprobantes`, mig. 0039). El consumidor es
un `<img src>` en el HTML del detalle de la liquidación: la necesidad dura lo
que tarda el navegador en pedir la imagen. El TTL dura **3,600 segundos**, y una
URL firmada de Supabase Storage no lleva ninguna otra credencial — durante esa
hora abre sin cookie, sin passcode y desde cualquier IP.

**Escenario, con valores.** El contralor abre `/dashboard/<uuid>` con diez
gastos. Se emiten diez URLs firmadas de una hora, una por ticket. Cada una queda
en el historial y el caché del navegador, en el log de cualquier proxy TLS
corporativo que la flota tenga en medio, y —el 6-ago— en la laptop del demo. La
propia 0039 dice qué hay dentro: *«un ticket trae RFC, domicilio, a veces el
nombre del titular y —en una farmacia— lo que se compró, que es dato sensible
del art. 2 fr. VI de la LFPDPPP»*. Con 60 segundos la ventana es la que la
necesidad dura; la plantilla correcta está en el mismo repo
(`api/export/pdf/[id]/route.ts:59` firma con **60**).

**Consecuencia.** Para el operador y la flota: el expediente gráfico de sus
gastos legible sin credencial durante una hora por quien vea el enlace. Para
Likida, en la sala del 6-ago: es exactamente la pregunta que hace el auditor
interno del comprador cuando se le enseña que las fotos se conservan cinco años.

**Causa raíz probable.** El default `= 3600` se copió del PDF —donde también
lleva tres rondas señalado— en vez de del export, que ya nació con 60.

---

### [MEDIO, REINCIDENTE ×4 — rondas 5, 6, 8 y 9] La URL firmada del PDF que va por WhatsApp sigue viva una hora

`src/lib/cuadra/processor.ts:1226`

```ts
const { data, error } = await acotada(supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600), 'createSignedUrl');
```

La línea se tocó **esta ronda** (se le puso `acotada`, con su comentario citando
la auditoría 8) y el `3600` se dejó intacto. Es el dato que convierte esto de
"pendiente" en "revisado y no arreglado": alguien leyó, editó y devolvió la
misma línea.

**Escenario y consecuencia:** idénticos a la ronda 8 —el único consumidor es
Meta, que descarga en segundos; el objeto es
`{tenantId}/{viajeId}-operador.pdf` de un bucket privado y lleva nombre del
operador, folio y montos—. Se repite porque el reincidente en su cuarta
aparición ya no es un defecto, es una medida de qué se arregla y qué no.

---

### [BAJO, REINCIDENTE de la ronda 8] `gasto_no_tras_liquidar` sigue sin `search_path` fijo — y la 0037 le colgó un SEGUNDO trigger encima

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:55-58` ·
`supabase/migrations/0037_gasto_no_tras_liquidar_update.sql:17-28`

`command grep -rn "gasto_no_tras_liquidar" supabase/ | grep -i "search_path\|alter function"` no
devuelve nada: sigue siendo la única de las quince funciones de `public` sin
`proconfig`, tal como lo midió la ronda 8 contra el catálogo real. Lo nuevo es
que la 0037 **duplicó su superficie** sin corregirla: ahora la misma función sin
`search_path` cuelga de `before insert` y de `before update`, y sus dos
`select … from viaje` / `from liquidacion` siguen sin calificar el esquema.

**Consecuencia:** la misma de la ronda 8 (bajo un `search_path` con otro esquema
antes que `public`, el `select exists` lee la tabla equivocada y el gasto tardío
entra), ahora por dos puertas. Sigue en BAJO por la misma razón que allá:
`has_schema_privilege('anon','public','CREATE') = false`, así que hoy nadie que
llegue por PostgREST puede crear la sombra. Lo que se reporta es que la
migración que reusó la función tuvo la ocasión de arreglarla —una línea— y en su
lugar la usó más.

**Causa raíz probable:** el bloque 18 de `verificaciones.sql:738-745` sigue
comprobando una **lista de nueve nombres tecleada a mano** que no incluye a
`gasto_no_tras_liquidar`. La comprobación que debía anclar esto sigue mirando
para otro lado, sin cambio desde la ronda 8.

---

### [BAJO] No hay ningún tope de tamaño en la descarga de media, y el XML crudo se guarda entero en la base

`src/lib/meta/client.ts:158-176` (`downloadMediaAsText`) ·
`src/lib/cuadra/repo.ts:20-25` (`saveCfdiXmlRaw`) ·
`src/app/api/webhook/whatsapp/route.ts:9`

El webhook capa el **cuerpo del webhook** en 256 KB y lo remide tras leer
(`route.ts:42-45`), que es correcto. Pero lo que ese cuerpo trae es un
`media_id`, y la descarga que viene después no tiene tope ninguno:
`await bin.text()` / `await bin.arrayBuffer()` sin `content-length`, sin
`byteLength`, sin corte.

**Escenario, con valores.** Un operador dado de alta manda como *documento* un
`.xml` de 100 MB (el máximo que acepta WhatsApp Cloud API). El webhook responde
200 con 400 bytes de payload. Después, en `after()`: `downloadMediaAsText` lo
materializa entero (~200 MB como string UTF-16), `parseCfdiXml` construye el
árbol encima, y si trae un `Comprobante` con `TimbreFiscalDigital`,
`saveCfdiXmlRaw` lo escribe tal cual en `cfdi_xml.xml` — una columna `text`, sin
`check` de longitud, que TOAST admite hasta 1 GB por fila.

**Consecuencia.** Dos, y la segunda es la que importa aquí: (1) la invocación se
queda sin memoria y se lleva por delante a los demás mensajes del mismo lote,
que comparten el `Promise.all` de `route.ts:72`; (2) escritura y egress de
Supabase sin techo, en un proyecto donde el egress **ya bloqueó dos trabajos
programados** (`0769d77`, `90569ef`). Si el 6-ago la base está estrangulada, el
demo se cae por una puerta que no está medida en ningún lado.

Va en BAJO y no más porque quien lo dispara es un operador ya dado de alta y
plenamente identificado (la firma HMAC de Meta se verifica antes de cualquier
cosa), no un anónimo — y porque hace falta un XML deliberadamente enorme, no un
accidente.

---

## Lo que revisé y está bien

**El RLS de `foto_pendiente`, que es lo que se me pidió comprobar.** `0038:41`
enciende RLS y no crea ninguna policy: en Postgres eso es denegación total de
SELECT/INSERT/UPDATE/DELETE para todo rol que no sea dueño ni tenga
`BYPASSRLS`. `anon` y `authenticated` no son ninguna de las dos cosas;
`service_role` pasa por su atributo `rolbypassrls`, no por una policy que
alguien pudiera aflojar. **No se filtró nada.** El criterio es idéntico al de
`codigo_pendiente` (0016) y `wa_mensaje_procesado` (0012), que la ronda 8 ya
verificó contra el catálogo vivo.

**El `GRANT` implícito que el `revoke from public` no alcanza, revalidado sobre
la tabla nueva.** `foto_pendiente` hereda de las default privileges de Supabase
el mismo `TRUNCATE` y `REFERENCES` que la ronda 8 documentó para las otras tres
tablas sin policy — y RLS **no** cubre `TRUNCATE`, así que la frase de la 0012
("RLS on, sin policy = deny-all") tampoco es literalmente cierta aquí. Mismo
veredicto que la ronda 8 y por la misma razón comprobada: no hay vía para
emitirlo (PostgREST no expone `TRUNCATE` y la llave publicable es un JWT, no una
credencial de conexión a Postgres). Lo dejo escrito, no lo subo a hallazgo.

**No hay camino sin autenticar a datos de un tenant.** Recorrí las siete rutas
que sirven algo: `/dashboard` y `/dashboard/[id]` llevan las dos capas
independientes (matcher del proxy + `exigirAcceso` dentro de la página,
`page.tsx:57` y `[id]/page.tsx:36`); los dos export comprueban `tokenMatches`
**y** filtran `.eq('tenant_id', TENANT())` con service-role; `/api/demo` POST es
cálculo puro sin base; el webhook verifica HMAC antes de parsear;
`/aviso/[tenant]` y `/privacidad` son documentos legales públicos por
obligación. Ninguna acepta un identificador externo que decida una fila sin
comprobarlo en servidor.

**Ningún secreto con fallback derivado.** `DASHBOARD_SECRET` lanza en producción
(`passcode.ts:85-89`) en vez de caer a `likida:${passcode}`;
`exigirPasscodeFuerte` lanza ante un passcode adivinable; `supabaseAdmin()`,
`token()`, `phoneNumberId()` y el cliente de OpenRouter lanzan sin sus llaves;
`verifySignature` devuelve `false` sin `WHATSAPP_APP_SECRET` (fail-closed, no
fail-open). `next.config.ts:76` sigue excluyendo `./.env*` del trace del bundle.

**El trigger de la 0037 sí cierra lo que fue a cerrar.** El camino para el que
se escribió —`updateGastoCfdiXml` pegando un XML a un gasto ya liquidado— toca
`sub_total`, `iva_traslado` e `ieps_traslado` en cada llamada
(`repo.ts:222-234`, se escriben siempre, aunque sea a `null`), así que el `when`
evalúa verdadero y `CU001` sube. El bloque 20 de `verificaciones.sql:820-849` lo
demuestra contra Postgres real, no contra un mock. El defecto del primer
hallazgo no es que el trigger falle: es que hay un segundo escritor que su `when`
no contempla.

**El token del panel, sin regresión.** `git diff` sobre `src/lib/auth/` no
devuelve nada desde la ronda 8; corrí sus 24 pruebas y pasan. Formato v2 con
hora firmada, nonce de 16 bytes, `constTimeEq`, rechazo del formato viejo por
`partes.length !== 4 || partes[0] !== VERSION`, caducidad de 8 h comprobada en
servidor. No encontré vía de forja, downgrade, reúso ni extensión.

**Trust boundary del camino nuevo de corrección de fecha.** `decision.gastoId`
no viene de fuera: sale de `emparejarCorreccionDeFecha`
(`intake/emparejar.ts:64-75`) sobre `yaRegistrados = getGastos(viajeId,
op.tenantId)` — servidor, acotado por tenant y por viaje, y con regla de
candidato **único** (`candidatos.length === 1`). No hay IDOR por aquí, que era
mi primera hipótesis al leer que un camino nuevo decide qué gasto se re-fecha.

**El bucket `comprobantes` (0039) es privado y no hay `getPublicUrl` en el
repo.** `command grep -rn "getPublicUrl" src/` solo aparece dentro de una
aserción de prueba (`almacen.test.ts:91`) que existe justamente para impedirlo.
El bloque 22 de `verificaciones.sql` comprueba `buckets_publicos = 0` sobre
**todos** los buckets, no solo el nuevo, que es la forma correcta de escribirlo.
La ruta del objeto (`almacen.ts:46`) va sanitizada: la extensión pasa por
`replace(/[^a-z0-9]/g, '')` y el nombre es un hash hex o un `randomUUID()`, así
que no hay travesía de ruta posible.

**`sharp` 0.34.5 (GHSA-f88m-g3jw-g9cj, cuatro CVE de libvips) — el único CVE con
camino de producción, y lo descarto por escrito otra vez.** `npm audit` da 11
(2 críticas, 5 altas, 4 moderadas). Las dos críticas son `vitest` y
`@vitest/coverage-v8` —la misma advisory contada dos veces, devDependency, nunca
`--ui`—; `postcss` y `brace-expansion` son de build y de `eslint`, no llegan al
runtime de la función. Solo `sharp` toca bytes del atacante: `cfdi.ts:249` corre
`sharp(image).rotate().resize(…)` sobre lo que baja de WhatsApp. **Reverifiqué
que las ramas nuevas de esta ronda no ensanchan ese canal:** `tieneCodigoLegible`
(`ocr.ts:220`) y la descarga de la foto retenida (`processor.ts:486`) entran las
dos por `msg.type === 'image'` (`processor.ts:369`), donde Meta solo entrega
JPEG/PNG; el `document` va a `downloadMediaAsText` y no toca `sharp`. Y hace
falta ser un operador dado de alta: `resolveOperador` corta en `processor.ts:271`
antes de cualquier descarga. Sigue como observación vigilada, con el mismo
apunte que la ronda 8 —hay arreglo publicado (`sharp@0.35.3`) y `package.json`
sigue fijando `^0.34.0`—. **Ningún otro CVE del árbol tiene camino real de
explotación en esta app.**

**`npx tsc --noEmit` limpio; `npm test` en verde (154 archivos, 1,436 pruebas,
1 saltada).** Lo cual es parte del primer hallazgo, no un consuelo: el defecto
más caro de esta ronda vive en el hueco entre un `when` de SQL y un `vi.fn()`.

**Reincidentes de la ronda 8 verificados sin cambio, que no repito como
hallazgos completos porque están escritos ahí con su escenario y no se movió
una línea:** las cabeceras de seguridad y el `no-store` siguen perdiéndose en la
rama de redirección (`proxy.ts:42`); `/api/demo` GET sigue publicando `envHealth()`
sin autenticar (`route.ts:8-10`); `bodyExcede` sigue sin remedir en `/api/demo`
(`route.ts:30`); `session.ts:20` sigue devolviendo `rol: 'flota_admin'` ante un
usuario desconocido y sigue muerto; `/aviso/[tenant]` sigue siendo la única
puerta sin credencial que llega a la base sin `rateLimit`.

---

## Lo que NO alcancé a revisar

- **Confirmar el primer hallazgo contra Postgres real.** El razonamiento es
  puramente sobre el `when` de la 0037 y sobre qué columnas escribe
  `corregirFechaGasto`, y las dos cosas están leídas línea por línea — pero no
  ejecuté el `update gasto set fecha = …` tras un `guardar_liquidacion_tx`
  contra la base del proyecto, que es lo que lo volvería incontestable. Es un
  bloque de diez líneas al lado del 20 de `verificaciones.sql`, y ese bloque no
  existe.
- **El linter de Supabase (`get_advisors`) contra la base viva.** La ronda 8 lo
  consultó y encontró el `function_search_path_mutable` de la 0036. Esta ronda
  me quedé en el repo: afirmo que la función sigue sin `search_path` porque
  ninguna migración lo pone, no porque haya vuelto a leer `pg_proc.proconfig`.
- **La superficie HTTP medida en vivo contra `app.likida.ai`.** Los reincidentes
  de cabeceras y de `/api/demo` los doy por vigentes leyendo el código, que no
  cambió; no repetí las peticiones reales que la ronda 8 sí hizo.
- **CSP.** Sigue sin existir ni en `proxy.ts` ni en `next.config.ts`, igual que
  en la ronda 8, y sigo sin haber recorrido `privacidad/page.tsx` buscando un
  sumidero de XSS con el detalle que eso merece. Con `almacen.ts` guardando el
  `contentType` que viene de Meta sin normalizar (`almacen.ts:50`), el día que
  algo sirva esos objetos desde el propio origen esto deja de ser teórico.
- **Concurrencia real del rate-limit.** Tercer pendiente idéntico: exige tráfico
  agresivo contra producción, que esta ronda prohíbe.
