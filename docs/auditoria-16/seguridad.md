# Seguridad — auditoría 16

**Nota: 6.5/10** (baja desde el 7 de la ronda 15). Razón del movimiento: **la
ronda 15 atacó bien sus tres encargos de seguridad y los tres se verifican de
verdad** —`actualizarFacilidad15` por fin comprueba el error de lectura, el
CRÍTICO ARCO de /admin quedó cerrado (el superadmin ve TODAS las flotas), y el
fail-closed del contador del 15% es de los mejores que ha recibido este rubro
(el motor se niega a afirmar "excedente contra $0 no medido" y lo manda a
revisión con nota honesta). Pero la ronda 16 construyó la pieza de seguridad
más sensible del ciclo —la entrega de la respuesta ARCO por WhatsApp desde la
cuenta oficial de la empresa— **sin UNA sola prueba, sin idempotencia, sin
bitácora en `envio_mensaje` (la tabla que existe exactamente para eso) y
marcando la solicitud como `resuelta` ANTES de que el envío exista**. Y lo
hizo con la familia que este rubro persigue desde la ronda 10: la pantalla de
cumplimiento se cae a "Ninguna solicitud ARCO registrada" (fail-open a vacío,
el mismo anti-patrón que la propia ronda acababa de matar en el motor), y la
consola de /admin dice "Likida no envía mensajes ARCO todavía" en el MISMO
commit que los envía. La frontera de base ganó, la disciplina del código nuevo
volvió a perder. El MEDIO del POD cumple su cuarta ronda abierta.

---

## Verificación de los cierres de la ronda 15 (el encargo central)

Se abrió `96f2adc` y se leyó el código ACTUAL, no el mensaje del commit:

**`actualizarFacilidad15` — CERRADO, bien cerrado.** `src/lib/cuadra/repo.ts:923-929`:
```ts
const { data: fila, error: errLee } = await acotada(...maybeSingle(), 'actualizarFacilidad15.leer');
if (errLee) throw new Error(`actualizarFacilidad15.leer: ${errLee.message}`);
```
El LEE-MODIFICA-ESCRIBE sobre `tenant.config` ya no puede reemplazar la config
entera por un bache: el `throw` corta antes del `{...?? {}}`. El patrón quedó
alineado con `guardarPolitica` (que sí comprobaba `errLee`). El escenario de la
ronda 15 —parpadeo de red → `config = {facilidadCombustibleEfectivo: {...}}`
borrando política, topes y estímulos— ya no es alcanzable desde el código.

**CRÍTICO ARCO de /admin — CERRADO.** `src/app/admin/compliance/page.tsx:141-181`
ya no filtra por el tenant de la sesión: consulta TODAS las solicitudes
(`solicitud_arco` sin `.eq('tenant_id', …)`), con `flota:tenant_id(nombre)` en
el join y columna "Flota" en la tabla. La pantalla que la ronda 14 prometió
("el superadmin ve las solicitudes") por fin muestra algo. El `if (!s)` de
`datosDeCompliance` (`:144-145`) solo corta cuando NO hay sesión — para el
superadmin (`getSessionTenant` → `tenantId: null`) ya no corta.

**Fail-closed real del contador del 15% — CERRADO, y es el mejor fix de la
ronda.** `src/lib/cuadra/cuadre/engine.ts:303-326`: dentro de `elegible ===
true` ahora hay una puerta doble —`anioComprobante === input.anioEjercicio` y
`total = input.totalCombustibleEjercicio ?? 0; total > 0`— y si falla, el gasto
va a `diferencias` como `combustible_efectivo` con monto 0 y nota que dice
"no se afirma deducible ni no deducible; no acredita IEPS" y el motivo exacto
(contador caído vs comprobante de otro ejercicio). `desde_db.ts:63-64` inyecta
`anioEjercicio` desde la fecha del viaje y `:112-114` lo pasa al motor;
`tools.ts:105-107` ancla el MISMO año (el del viaje) en el chat. 117 pruebas de
`engine.test.ts` verdes, incluidas las 3 nuevas. Es el estándar que este rubro
le pide a todo el código nuevo — y la ronda 16 no lo aplicó donde debía (ver
hallazgo 2).

**Regresiones del panel — verificadas.** `contador/combustible/page.tsx:155-169`
distingue `elegible15 === false` ("declaró que NO califica"), `undefined` ("sin
declarar — sale a revisión") y el excedente real; `fiscal.ts:332-341` ya no
pinta "deducción perdida" para `undefined` (solo para `false`). Sin superficie
de seguridad nueva.

**Superficie crítica intacta desde `caae369`.** `git log caae369..HEAD` sobre
`proxy.ts`, `api/webhook/*`, `api/cron/*`, `api/stripe/*`, `middleware.ts`,
`lib/supabase/*`: **cero archivos tocados** salvo `lib/auth/visibilidad.ts`
(una línea: `'/dashboard/arco': 'operacion'`). HMAC del webhook con cap de body,
CRON_SECRET con 500, firma de Stripe, CSP, no-store: todo como la ronda 15 lo
dejó. `npx tsc --noEmit` limpio. Pruebas de este rubro: auth+meta+ratelimit 227
verdes, engine+fiscal+privacidad 214 verdes, operacion+administracion+pg+
webhook 113 verdes (554 en total, sin la suite completa que corre otro auditor).

---

## Hallazgos

### [MEDIO, abierto — cuarta ronda] `operador_sube_su_pod`: el chofer sigue pudiendo auto-certificar su entrega sin subir nada

`supabase/migrations/0081_pod_tenant_amarrado.sql:15-19` ·
`supabase/verificaciones.sql:3133,3146` · `src/app/dashboard/pod/vista.tsx:17` ·
`src/lib/cuadra/operacion.ts:75` · `supabase/migrations/0047_operacion_encargado.sql:139-144`

Ninguno de los dos commits de la ronda 16 (`96f2adc`, `c901226`) lo toca. La
policy de la 0081 está intacta (`with check (viaje_id in … operador_id =
get_user_operador_id() and tenant_id = (select tenant_id …))`), el bloque 56
sigue esperando `pod-en-su-flota=t` (`verificaciones.sql:3146`) y —verificado
de nuevo con grep— `'subido'` solo se LEE en `vista.tsx:17,37,101` y
`operacion.ts:75,455`: ningún código de la app lo escribe. La única puerta al
estado es el INSERT RLS del chofer vía PostgREST directo.

**Escenario, con valores.** El chofer de Transportes Innovativos con su access
token y la anon key del navegador:

```
POST /rest/v1/pod
Authorization: Bearer <access_token del chofer>
{ "tenant_id": "<A>", "viaje_id": "VJ-2026-0847",
  "operador_id": "<su operador>",
  "estado": "subido", "storage_path": "falso.jpg" }
```

Pasa el `with check` (viaje suyo + tenant del viaje), pasa
`pod_estado_dominio` y `pod_subido_tiene_archivo` (el string no es nulo): la
pantalla pinta "Recibido", el despacho deja de contar el viaje como "sin POD" y
nadie vuelve a perseguir la evidencia. Sin foto, sin Storage, sin verificación.
El arreglo sigue siendo el de la ronda 13 (dropear la policy y exigir en el
bloque 56 que el INSERT del chofer, incluido `estado='subido'`, rebote). El
bloque 56 actual inserta con `estado='pendiente'` y exige que PASE — codifica
el vector abierto. Estado: **abierto** (cuarta ronda).

---

### [MEDIO, abierto — nuevo] La entrega de la respuesta ARCO por WhatsApp: sin pruebas, sin idempotencia, sin bitácora, y `resuelta` se escribe antes del envío

`src/lib/cuadra/repo.ts:976-1003` · `src/lib/meta/client.ts:441-482` ·
`src/app/dashboard/arco/page.tsx:29-43` · `src/app/admin/compliance/page.tsx:40-45`

La feature estrella de la ronda 16 —enviar la respuesta ARCO al titular por la
cuenta oficial de WhatsApp— llegó con cuatro faltantes, todos en la familia que
este rubro persigue:

1. **Cero pruebas.** `grep resolverSolicitudArco|enviarRespuestaArco *.test.ts`
   → cero. El `client_cableado.test.ts` (11 pruebas) cubre `sendText`,
   `sendDocument`, `sendButtons`; la ruta nueva no tiene ni un mock de `fetch`.
   El repo exige "la prueba de que algo pasó" (`ocr_confianza`); aquí no hay ni
   la prueba de que el envío se intenta.
2. **Sin idempotencia ni check de estado.** `resolverSolicitudArco` lee la
   solicitud, la actualiza a `resuelta` y envía — sin mirar `estado` en ningún
   momento. Reinvocar la server action (doble clic que gane a `disabled`, una
   pestaña duplicada, un replay del POST con el `solicitudId` capturado) vuelve
   a enviar el mensaje: la segunda pasada actualiza 0 filas SIN error
   (supabase-js no lo reporta) y el envío sale igual. Dos actores legítimos
   (encargado y flota_admin) pueden responder la misma solicitud y el titular
   recibe DOS resoluciones contradictorias.
3. **Sin bitácora.** `envio_mensaje` (0053:206-224) existe exactamente para
   esto —"el registro de CADA plantilla de WhatsApp que Likida manda", con
   `proveedor_id` único para casar el webhook de estado— y `enviarRespuestaArco`
   no inserta NADA: solo `logger.info('arco.envio_ok')`. Una respuesta ARCO es
   una comunicación legal con plazo (LFPDPPP art. 32); el producto no puede
   demostrar que se envió, ni cuándo, ni si Meta lo entregó.
4. **`resuelta` antes del envío.** El UPDATE (`repo.ts:985-990`) corre ANTES
   del `enviarRespuestaArco` (`:997`). Si el envío falla —hoy es el caso real:
   la plantilla `respuesta_arco` está "en revisión" (`client.ts:457`) y fuera
   de la ventana de 24h no hay texto libre— la solicitud queda `resuelta`, el
   botón "Responder" desaparece de la UI (`page.tsx:106-112` solo lo pinta para
   estados no cerrados) y **no existe ningún camino de reintento**: el titular
   se queda sin la respuesta y el estado de datos no distingue "entregada" de
   "marcada como resuelta sin entregar". El mensaje de la UI es honesto ("no se
   pudo enviar — entrégala por otro canal"), pero el modelo de datos miente por
   omisión.

**Escenario, con valores.** Encargado de Transportes Innovativos abre
`/dashboard/arco`, responde la solicitud VJ-ARCO-1 del operador 521999… durante
un bache transitorio de red hacia la Graph API: `resolverSolicitudArco` marca
`estado='resuelta'`, `resuelta_en=now()`, guarda la resolución, y
`enviarRespuestaArco` devuelve `{ok:false, error:'HTTP 408'}`. La UI dice
"entrégala por otro canal". Se reinvoca la acción (replay): la solicitud ya está
resuelta, el UPDATE toca 0 filas sin error, y el envío se REINTENTA igual. Si la
red ya repuntó, el titular recibe el mensaje ahora; si no, la solicitud queda
`resuelta` sin envío ni rastro en `envio_mensaje` — la flota no puede probar la
entrega de una obligación legal, ni el titular recibió respuesta.

**El arreglo honesto**: comprobar `estado in ('recibida','en_proceso')` antes
de actualizar (rechazar la reinvocación), insertar en `envio_mensaje` el
intento con su resultado, y —si la entrega es requisito— escribir un estado
`resuelta` solo tras el envío, o añadir `enviada_en` a `solicitud_arco`. Más
las pruebas que exijan: una para el replay (no se reenvía), una para el fallo
del envío (el estado de datos lo refleja), una para el caso feliz (el insert
en `envio_mensaje` existe). Estado: **abierto**.

---

### [MEDIO, abierto — nuevo] Ambas pantallas ARCO se caen a "Ninguna solicitud ARCO registrada" — el fail-open a vacío que la propia ronda acabó de matar en el motor

`src/app/dashboard/arco/page.tsx:47,73` · `src/app/admin/compliance/page.tsx:159-165,75`

```ts
// dashboard/arco/page.tsx:47
const solicitudes = await listarSolicitudesArco(tenantId).catch(() => []);
// admin/compliance/page.tsx:159-165
).catch(() => []),
```

Las dos pantallas de cumplimiento ARCO —la obligación legal con plazo de 20
días hábiles— tragan el error y pintan el estado vacío: **una base caída o un
bache de red se lee como "no hay solicitudes", y la flota lee esa pantalla como
"estamos al día"**. Es exactamente el modo de falla que la ronda 15 documentó y
cerró en el motor ("contador caído → por confirmar, NUNCA excedente contra
$0") y que `analytics.ts` resuelve con `exigir()`/`traerTodo()` desde la ronda
11: supabase-js reporta por valor y `catch(() => [])` convierte el silencio en
cero filas. En una pantalla de cumplimiento legal la mentira es más cara que en
el panel: "Ninguna solicitud ARCO registrada" es la constancia que nadie pidió.

**Escenario, con valores.** La base de producción da un parpadeo a las 9:00.
El encargado de Transportes Innovativos abre `/dashboard/arco`: `traerTodo`
lanza `LecturaIncompleta`, el `.catch(() => [])` devuelve `[]`, y la página
pinta "Ninguna solicitud ARCO registrada. Cuando un operador escribe
*PRIVACIDAD*…" — mientras la solicitud VJ-ARCO-1 (sembrada para el demo)
sigue en la base y vence en 20 días hábiles. Nadie la responde; el estado de la
pantalla no mintió a propósito, pero la afirmación "Ninguna solicitud" fue una
medición falsa.

El patrón correcto ya existe a diez líneas: `datosDeCompliance` de la ronda 15
usa `traerTodo` (que lanza `LecturaIncompleta`); falta que la página deje de
tragarse la excepción y muestre el estado de fallo (como `EstadoVacio` con "no
se pudo consultar" o el `AvisoDeFallo` de otras páginas). Estado: **abierto**.

---

### [BAJO, abierto — nuevo] `accionResolver` de /admin: el mensaje de éxito dice "Likida no envía mensajes ARCO todavía" en el MISMO commit que los envía, y su lectura sigue sin comprobar el error

`src/app/admin/compliance/page.tsx:31-45`

```ts
const { data: sol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
if (!sol?.tenant_id) return { error: 'La solicitud no existe.' };
…
return { ok: 'Solicitud marcada como resuelta. La respuesta se entrega al titular por el canal que la flota defina — Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente).' };
```

Dos problemas en la misma función:
1. **El rótulo miente.** La línea 45 afirma que Likida no envía mensajes ARCO
   "todavía", pero `resolverSolicitudArco` (que esta misma acción invoca en la
   línea 40) desde el commit `c901226` INTENTA enviar la respuesta al titular
   por WhatsApp (`repo.ts:997-998`). Si el envío funcionó (dentro de la ventana
   de 24h), el superadmin lee "no se envió" cuando sí se envió; si falló, el
   texto acierta por accidente. Es la regla del repo —un rótulo tiene que ser
   verdad— en la consola de cumplimiento, y el retorno `{enviada}` de
   `resolverSolicitudArco` se descarta. El fix es de una línea: usar
   `r.enviada` como hace `accionResponder` en `/dashboard` (`page.tsx:38-41`).
2. **La lectura sigue sin comprobar `error`** (nota de la ronda 15, sigue
   abierta): con un bache de red `sol` es `null` y la acción responde "La
   solicitud no existe" a una solicitud que sí existe. Fail-closed, pero con
   afirmación falsa — y ahora con un envío de WhatsApp colgando de la decisión.

Estado: **abierto**.

---

### [BAJO, abierto — nuevo] `resolverSolicitudArco` cae a `operador_id` como teléfono del titular

`src/lib/cuadra/repo.ts:994`

```ts
const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;
```

`operador_id` es un uuid (0053: `operador_id uuid references public.operador`),
no un teléfono. El camino correcto es `titular_ref` —que `registrarSolicitudArco`
siempre llena con el `wa_id` entrante—, así que el fallback solo dispara cuando
`titular_ref` es NULL: filas viejas o sembradas a mano (el commit de la ronda 16
dice "se sembró una solicitud ARCO de prueba en la base real" — fuera del
`seed.sql`, sin garantía del contenido). Con un uuid, `destinatarioWhatsApp`
(`client.ts:70-74`) le quita los no-dígitos y el resultado es un número
basura de hasta 32 dígitos que Meta rechaza (fail-closed, pero con el envío
fallido y el log sucio) — o, en el caso límite de un uuid que normalice a
`^521(\d{10})$`, un mensaje real a un número ajeno. El arreglo es quitar el
fallback y devolver `{enviada:false, error:'sin teléfono del titular'}`.
Estado: **abierto**.

---

### [BAJO, abierto — nuevo] El encargado puede responder ARCO y mandar WhatsApp de la empresa con texto libre — la app concede lo que la RLS de la tabla reserva a `administra_flota()`

`src/lib/auth/visibilidad.ts:77` · `src/app/dashboard/arco/page.tsx:29-43` ·
`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:202-204` ·
`src/lib/auth/permisos.ts:29-31`

`/dashboard/arco` se clasificó como `'operacion'` (visible para flota_admin Y
encargado), y `accionResponder` solo pide `requireSessionTenant` — no consulta
`puedeAdministrar` (flota_admin+superadmin), que es la matriz que distingue "el
dueño administra" de "el jefe de tráfico opera". La propia base piensa distinto:
la policy `solo_admin_flota` de `solicitud_arco` exige `administra_flota()`
(`0053:202-204`) — el encargado NO puede tocar la tabla por PostgREST, pero la
app (service-role) le abre la acción completa: responder la solicitud Y disparar
un mensaje saliente de la cuenta oficial de WhatsApp con texto libre (`"Tu
solicitud de derechos ARCO fue atendida por la empresa: ${resolucion}"`).
Es la primera capacidad de mensajería saliente de la empresa que recibe el
encargado (los demás emisores —`avisar_cierre`, `notificar`, `escalar_viaje`—
son del sistema, no del usuario). Un encargado podría enviar a un operador un
texto que suplanta a la empresa (phishing, instrucciones falsas) desde el número
oficial, con costo por mensaje, sin bitácora (ver hallazgo 2) y sin gate de rol.

**Por qué BAJO y no MEDIO**: el encargado es un rol autenticado de la MISMA
flota, la respuesta va a un número que ya escribió PRIVACIDAD (no es número
arbitrario), y el texto se envía con un prefijo fijo de la empresa — no es
explotable por un externo. Pero la divergencia app-vs-RLS es exactamente la
clase de frontera que este rubro audita: decidir si el encargado responde ARCO
es una decisión de producto (o legal); si la respuesta es "sí", la RLS de 0053
debería abrirse a `not is_operador()`; si es "no", `accionResponder` debe pedir
`puedeAdministrar`. Estado: **abierto**.

---

### [BAJO, abierto — nuevo] Superadmin en `/dashboard/arco?tenant=X`: ve la flota X pero "Responder" actúa sobre la demo — "la solicitud no existe en esta flota"

`src/app/dashboard/arco/page.tsx:27,37` · `src/lib/auth/guard.ts:33-36`

La página lista con `resolverTenantEfectivo` (que honra `?tenant=X`) pero la
server action responde con `requireSessionTenant` (que para superadmin devuelve
`tenantDemo()`, `guard.ts:34-35` — el tenant de la demo, no X). Con
`?tenant=<flota X>`, el superadmin ve las solicitudes de X y el botón
"Responder" falla con `resolverSolicitudArco: la solicitud no existe en esta
flota` (`repo.ts:983`) — afirmación falsa (la solicitud existe; el query buscó
en el tenant equivocado) pero fail-closed: el `.eq('tenant_id', tenantDemo())`
no toca filas ajenas. Es la asimetría que ya existe en el resto del panel entre
la vista (`?tenant=`) y las acciones (sesión real); aquí quedó sin resolver y
con un mensaje que culpa a la solicitud. Estado: **abierto** (deuda de UX
fail-closed, no fuga).

---

### [BAJO, abierto — nuevo] La plantilla `respuesta_arco` no usa la razón social de la flota: `{{1}}` es el literal 'la flota'

`src/lib/meta/client.ts:469-471`

```ts
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```

El mensaje del commit `c901226` dice "la plantilla lleva {{1}} = razón social
de la flota" — el código pasa el literal `'la flota'`. Un operador que trabajó
en dos flotas recibe "Tu solicitud de derechos ARCO fue atendida por la
empresa: …" sin saber QUÉ empresa respondió — la respuesta no identifica al
responsable, que es justo lo que el art. 29 exige que se pueda saber. El dato
existe (`tenant.nombre`, y `getDatosResponsable` ya lo usa para el aviso); falta
pasarlo por el parámetro. Estado: **abierto**.

---

### [BAJO, abiertos — residuales de la ronda 15, sin cambios]

- **`.or()` con claves sin escapar** — `src/lib/cuadra/repo.ts:831`:
  `clave_prod_serv.in.(${claves.join(',')})` intacto. La 0083 sigue validando
  `hidrocarburos.claves` solo como "array de strings" sin exigir `^\d{8}$` ni
  prohibir `,()`. Latente por las mismas capas (solo service-role escribe
  `tenant.config` + `.eq('tenant_id')` exterior). Estado: **abierto**.
- **`bitacora_insercion`** — `0053:199`: el contador/encargado sigue pudiendo
  escribir lo que no puede leer (el `with check` no exige `administra_flota()`).
  Estado: **abierto**.
- **Bucket `avatares`** — `0046:28-31`: sigue aceptando cualquier mime de
  cualquier autenticado en una URL pública. Estado: **abierto**.
- **Policies de lectura del chofer** — `0045:52-60` y `0047:187-189`: siguen
  sin componer tenant. Estado: **abierto** (inocuo por las capas ya
  documentadas).

---

## Lo que revisé y está bien

**El cierre de los tres encargos de la ronda 15, en código actual.** Ya
descrito arriba: `actualizarFacilidad15` (repo.ts:923-929), el CRÍTICO ARCO de
/admin (compliance/page.tsx:141-181) y el fail-closed del 15% (engine.ts:303-326
+ desde_db.ts:63-64 + tools.ts:105-107), con sus pruebas verdes.

**El scoping de tenant de la ruta nueva.** `resolverTenantEfectivo` gatea
`/dashboard/arco` con `puedeVerRuta` (encargado ve 'operacion', contador no, el
rebote conserva la previsualización), `listarSolicitudesArco(tenantId)` filtra
`.eq('tenant_id', tenantId)` (una flota no ve solicitudes ajenas), y
`resolverSolicitudArco` comprueba el error de lectura y el `.eq('tenant_id')`
en la lectura Y en el UPDATE — la reinvocación con el `solicitudId` de otra
flota rebota ("la solicitud no existe en esta flota"). El patrón nuevo SÍ
aprendió de `actualizarFacilidad15`: comprueba `errLee` antes de escribir.

**El intake de solicitudes no es abusable por desconocidos.** La única puerta a
`solicitud_arco` es `registrarSolicitudArco` desde `atenderPrivacidad`
(processor.ts:146-175), y el tenant se resuelve con `buscarTenantPorTelefono`
(conv.ts:641-659, con `.limit(2)` para negar la ambigüedad) o
`resolverCuentaOficina` — un número que no está en `operador` ni en cuentas de
oficina recibe "no te tengo identificado" sin crear solicitud. El `titular_ref`
siempre es el `wa_id` entrante: la flota no puede escribir el número de destino
del mensaje ARCO desde la UI; solo el webhook lo fija.

**El envío sale por la cuenta correcta y con timeouts.** `enviarRespuestaArco`
usa `phoneNumberId()`/`token()` de env con `AbortSignal.timeout(SEND_TIMEOUT_MS)`
(client.ts:442-448), `destinatarioWhatsApp` normaliza el "1" mexicano, y el
fallo cae a `{ok:false}` con el código HTTP — nunca lanza por red. La UI de
/dashboard distingue "se envió" de "no se pudo — entrégala por otro canal"
(page.tsx:38-41), que es el mensaje honesto que el /admin no copió.

**Superficie de sesión, guard, proxy, webhook, cron y Stripe intacta desde
caae369** (verificado con `git log`); `npx tsc --noEmit` limpio; 554 pruebas de
este rubro verdes. El seed y el guion del demo no cruzan los hallazgos: el POD
exige sesión web de chofer + PostgREST directo (el guion no la provisiona), el
envío ARCO requiere pulsar "Responder" (el guion no lo incluye), y el
fail-open de las pantallas ARCO no se nota con la base sana.

## Lo que no alcancé a revisar

- **No ejecuté los bloques 54/55/56 contra la base real** (regla: no tocar la
  base). Verifiqué el 56 en `verificaciones.sql` y que sus expectativas son las
  que el código dice; no puedo afirmar que pasen en vivo.
- **Pen-test real del escenario del POD contra PostgREST de producción** (curl
  con sesión de chofer) — razonado contra las policies, no ejecutado.
- **El estado real de la plantilla `respuesta_arco` en Meta** (aprobada o en
  revisión) y **si la solicitud ARCO sembrada en la base real tiene
  `titular_ref` válido** — ambas viven en el panel/servicios, no en el repo.
- **Si `envio_mensaje` tiene filas** en la base real (no puedo consultarla; la
  lectura del código dice que el nuevo envío no la escribe).
- **La suite completa (3,159)** no la corrí — otros auditores la tienen.

## VEREDICTO

**Green light para la demo, con la disciplina del código nuevo otra vez en
deuda.** El camino del demo no toca ninguno de los MEDIOs: el 1 exige sesión
web de chofer + PostgREST directo (el guion no la provisiona), el 2 exige
pulsar "Responder" sobre la solicitud ARCO (el guion no lo hace) y el 3 es
invisible con la base sana. Los cierres de la ronda 15 que este rubro podía
reclamar están puestos y hacen lo que dicen; la frontera de base y el motor
están en su mejor momento.

La nota baja porque la ronda 16 construyó la superficie de seguridad más
sensible del ciclo —una puerta de mensajería saliente de la cuenta oficial de
la empresa, disparada por dos roles de oficina, dirigida al titular de datos
personales— **sin una sola prueba, sin idempotencia, sin la bitácora que la
tabla `envio_mensaje` ya prometía, y con el estado `resuelta` escrito antes de
que la entrega exista**. Es la misma lista de faltantes que la ronda 15 le
cobró a `actualizarFacilidad15` —y que ahí se pagó—, repetida al pie de la
letra una semana después en la feature nueva, con un mensaje de éxito en la
consola que la contradice y dos pantallas de cumplimiento que se caen al vacío
"sin solicitudes". El patrón de fondo no cambió: cada ronda arregla la familia
en el código viejo y la re-siembra en el nuevo. Cinco arreglos acotados: check
de estado + idempotencia + `envio_mensaje` + estado de entrega en
`resolverSolicitudArco`, quitar los `catch(() => [])` de las dos pantallas
ARCO, corregir el rótulo y el error de lectura de `accionResolver`, decidir el
rol que responde ARCO (alinear `visibilidad` con `administra_flota()`), y —por
cuarta vez— dropear `operador_sube_su_pod`.
