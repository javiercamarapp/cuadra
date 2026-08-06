# Operabilidad y DX — auditoría 16

Ancla: HEAD `c901226` (2026-08-05 20:59:50 -0600, "feat(legal): ARCO de la flota
en /dashboard + entrega de la respuesta por WhatsApp (ronda 16)"). Todo lo que
este reporte afirma se verificó en vivo con `git`, `vercel ls/inspect`,
`npx tsc --noEmit -p .`, `npx eslint src/`, `npm run build`, `npx supabase
projects list`, `curl` y lectura directa de los archivos en el momento de
escribir — no de memoria y no citando mensajes de commit sin abrir el archivo.
La base de datos real no se tocó ni se consultó (prohibido por el encargo).

**Nota: 6.0/10** (era 6.5 en la ronda 15). Razón del movimiento: **los dos
defectos más pesados de la ronda 15 quedaron cerrados y verificados en código**
—el CRÍTICO ARCO (el superadmin ahora ve TODAS las flotas, `compliance/page.tsx`
sin filtro de tenant) y el ALTO del contador (el motor ya no afirma "excedente
contra $0.00": `engine.ts:310-327` manda el efectivo a `por_confirmar` con nota
honesta cuando el contador no respondió o el comprobante es de otro ejercicio,
con 3 pruebas nuevas verdes)—. Pero **la pieza central de la ronda 16 —la
entrega de la respuesta ARCO por WhatsApp— llegó sin una sola prueba, rompiendo
el gate de `eslint` en código commiteado, con tres tragaderas `.catch(() => [])`
que vuelven a la familia de mentira que el repo prohíbe, con un mensaje de éxito
en `/admin/compliance` que quedó mintiendo en la dirección contraria, y con una
acción "Responder" que falla para el superadmin que ve una flota real por
`?tenant=`**. Y producción sigue **21 commits atrás** de master (ronda 15: 19):
para el demo de mañana, nada de esto existe en `app.likida.ai`.

## Hallazgos

### [MEDIO, abierto — reincidente ronda 14/15] Producción sigue en `caae369`, ahora 21 commits atrás: el ARCO de la flota, el fail-closed del 15% y la RFA 2.9 completa NO están desplegados, y la base tiene datos que el código desplegado no lee

Verificado en vivo ahora: `vercel ls` → el deployment Ready de producción más
reciente es `likida-4h09tz7eg` (created Wed Aug 05 14:49:22, aliases
`app.likida.ai`/`likida.ai`) — el mismo release de la ronda 14 (`caae369`).
Los 6 pushes posteriores (`dd64068` … `c901226`) aparecen **Canceled** (3-4 s,
el `ignoreCommand` de `vercel.json` leyendo el asunto). `git rev-list --count
caae369..HEAD` = **21**, ninguno con `[deploy]` en la primera línea
(`git log --grep='\[deploy\]'` → el último es `caae369`). La suite está verde
y `npm run build` compila (lo corrí hoy: exit 0), así que el despliegue es una
decisión de una línea — no una barrera técnica.

Lo que producción NO tiene y el demo de mañana presume: la ruta
`/dashboard/arco` (no existe en `caae369`), el fail-closed del contador del 15%
(`engine.ts:310-327`), la declaración tri-estado del alta, la 0082/0083. El
checklist del GUION_DEMO.md ("Antes de entrar a la sala", líneas 13-29) sigue
sin incluir el cruce `git log -1` vs deployment que DEPLOY.md documenta; hoy
`git log -1 --pretty=%s` dice "feat(legal): ARCO…" y el sitio sirve otra cosa.

**Escenario con valores:** 6-ago, en la sala, contra `app.likida.ai`. El
contralor de Innovativos pregunta por la regla del 15% — el motor de producción
ni conoce el contador del ejercicio. O se abre `/dashboard/arco` (el nuevo
entregable de la ronda) y da 404. Ninguna prueba del repo puede cazarlo:
`runbook.test.ts` cruza código↔documento, nunca master↔Vercel.

**Estado: abierto** (empeoró: 19 → 21 commits; se agregó el ARCO de la flota a
lo no desplegado).

### [ALTO, abierto — nuevo] `/admin/compliance` quedó mintiendo en la dirección contraria: su mensaje de éxito dice "Likida no envía mensajes ARCO todavía" y el código SÍ envía, y el resultado del envío se descarta

`96f2adc` (fix ronda 15) hizo honesto el mensaje de éxito de la pantalla de
compliance: "Likida no envía mensajes ARCO todavía (anotado para la ronda
siguiente)". `c901226` (ronda 16) agregó el envío a la función COMPARTIDA y no
tocó el mensaje:

- `src/app/admin/compliance/page.tsx:40` — `await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);` (se descarta el retorno).
- `src/app/admin/compliance/page.tsx:45` — `return { ok: 'Solicitud marcada como resuelta. La respuesta se entrega al titular por el canal que la flota defina — Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente).' };`
- `src/lib/cuadra/repo.ts:993-1000` — `resolverSolicitudArco` ahora INTENTA el envío por WhatsApp (`enviarRespuestaArco`) y devuelve `{ enviada, error? }`.

El mensaje es falso en los dos sentidos: si el envío sale, el titular recibió
un WhatsApp y la pantalla afirma que no se envía nada (y le instruye a la flota
entregar "por el canal que defina" — doble entrega). Si el envío falla, la
pantalla afirma lo mismo y nadie se entera: la flota responsable cree que
"entrega por otro canal" y el fracaso solo vive en el log `arco.envio_fallido`.

**Escenario con valores:** un operador escribe *PRIVACIDAD* → `atenderPrivacidad`
(`processor.ts:146-167`) responde el aviso y registra la solicitud con su
teléfono en `titular_ref`. El superadmin resuelve desde `/admin/compliance`: el
texto sale (o no) por WhatsApp al teléfono del titular, y la pantalla le dice
"Likida no envía mensajes ARCO todavía". El titular recibe un mensaje anónimo
("la empresa", sin razón social — ver hallazgo de plantilla abajo) y la flota
además cree que debe entregarlo a mano. Pasaron los 20 días hábiles y la
constancia (LFPDPPP art. 16) que la app presume no tiene acreditada ni la
entrega ni el intento visible.

**Estado: abierto.** La ronda 15 lo dejó honesto; la 16 lo volvió falso sin
darse cuenta. El fix es de una línea (usar `r.enviada`/`r.error` como ya hace
`/dashboard/arco/page.tsx:39-41`).

### [ALTO, abierto — nuevo] Fail-open en las DOS pantallas ARCO: tres `.catch(() => [])` convierten una base caída en "Ninguna solicitud ARCO registrada" — la regla "fallar cerrado y decirlo" del repo, en la pantalla del plazo legal

`src/app/dashboard/arco/page.tsx:47`:
```ts
const solicitudes = await listarSolicitudesArco(tenantId).catch(() => []);
```
`src/app/admin/compliance/page.tsx:159` y `:164`:
```ts
traerTodo<...>(..., 'compliance.todas').catch(() => []),
traerTodo<...>(..., 'compliance.pendientes').catch(() => []),
```
`listarSolicitudesArco` (`repo.ts:943-974`) y `traerTodo` (`pg.ts:137-166`)
LANZAN ante cualquier `error` de la consulta y ante `LecturaIncompleta`
(>100,000 filas). El `.catch(() => [])` traga todo: bache de red, Supabase
caída, RLS, corte de paginación. El resultado es la mentira exacta que
CLAUDE.md prohíbe ("una base caída se lee como 'no hay nada', y el panel afirma
'aún no hay liquidaciones' estando ciego") — aquí: la flota responsable de
contestar en 20 días hábiles abre la pantalla durante una caída y ve "Ninguna
solicitud ARCO registrada" con KPIs en 0.

**Escenario con valores:** un parpadeo de red mientras el contador de
Innovativos abre `/dashboard/arco` el 12-ago → `listarSolicitudesArco` lanza
`fetch failed` → `.catch` → "Ninguna solicitud ARCO registrada". La solicitud
del operador (que existe, sembrada en la base real) no se ve; el KPI "Por
responder" marca 0. Si nadie lo nota, el día 21 hábil nadie contestó y la flota
tiene una constancia en cero. El patrón correcto ya existe en el repo
(`safe()` + `AvisoDeFallo` en `contador/combustible/page.tsx:57-60,105-109`):
decir qué falta y por qué. El patch de la ronda 15 que arregló `tenant-api.ts`
es la misma familia.

**Estado: abierto** — el CRÍTICO de la 15 se cerró (el superadmin ya ve todas
las flotas), pero el fail-open se copió a las dos pantallas nuevas/arregladas.

### [MEDIO, abierto — nuevo] `accionResponder` de `/dashboard/arco` ignora `?tenant=`: el superadmin que ve una flota real ve la lista de ESA flota y el botón "Responder" siempre le falla con "la solicitud no existe en esta flota"

`src/app/dashboard/arco/page.tsx:31-37`:
```ts
const s = await requireSessionTenant(RUTA);
...
const r = await resolverSolicitudArco(s.tenantId, solicitudId, resolucion);
```
`requireSessionTenant` (`guard.ts:27-34`) para superadmin devuelve
`tenantId: tenantDemo()` — el tenant demo, no el que la página está mostrando
(`resolverTenantEfectivo` sí honra `?tenant=<flotaX>`, `tenant-efectivo.ts:120-126`).
`resolverSolicitudArco` filtra `.eq('tenant_id', tenantId)` con el tenant demo →
la solicitud de flotaX no existe ahí → error, fail-closed (sin fuga), pero la
acción visible siempre truena.

El patrón correcto está en el propio repo, en SEIS páginas hermanas:
`unidades/page.tsx:54`, `pod/page.tsx:54`, `incidencias/page.tsx:54`,
`documentos/page.tsx:79`, `suscripcion/page.tsx:91`, `politicas/page.tsx:83-85`
— todas resuelven `sp.tenant` con `resolverTenantPedido(...)` dentro de la
server action. `/dashboard/arco` es la única que no.

**Escenario con valores:** Javier entra a `/admin/flotas` → "Ver dashboard" de
Transportes Innovativos → `/dashboard/arco?tenant=11111111-…` → la tabla lista
la solicitud ARCO sembrada del demo. Aprieta "Responder", escribe la resolución
→ la acción corre contra el tenant demo → `resolverSolicitudArco: la solicitud
no existe en esta flota`. En `?vista=demo` (el camino del demo) sí funciona
porque el tenant de la acción coincide con el de la página. El modo "ver una
flota real" está roto en la pieza central de la ronda.

**Estado: abierto.**

### [MEDIO, abierto — nuevo] La entrega de la respuesta ARCO por WhatsApp no tiene UNA sola prueba, y no deja ni el `wamid` en el log

`grep -rn "resolverSolicitudArco\|listarSolicitudesArco\|enviarRespuestaArco\|respuesta_arco" src --include="*.test.ts"` → **vacío**. El commit dice "3,159 verdes", pero el bloque nuevo entero —resolución, plantilla, texto libre, ventana de 24h, FUERA_VENTANA, whitelist— es código sin probar. `enviarRespuestaArco` (`client.ts:433-481`) en el éxito solo loguea `logger.info('arco.envio_ok', { telefono })`: a diferencia de `sendText` (`client.ts:100-106`), que registra el `wamid` ("El id del mensaje es lo que permite rastrearlo después en Meta"), aquí no hay con qué rastrear la entrega en Meta cuando el titular reclame que nunca recibió nada. Y `res` con HTTP 200 no se parsea por si el body trae un `error` de Meta (la Cloud API responde 200 con error embebido en varios fallos de entrega) — un falso `enviada: true` es posible.

**Escenario con valores:** el flota_admin resuelve una solicitud; la UI dice "la respuesta se envió al titular por WhatsApp" (`r.enviada === true`). El titular nunca la recibió (número fuera de WhatsApp, bloqueado, o fallo de entrega reportado como 200+error). No hay wamid en el log, no hay webhook de acuses mirando este envío, no hay prueba que pinte el caso. El estado en la base es `resuelta` igual.

**Estado: abierto.**

### [MEDIO, abierto — nuevo] La plantilla `respuesta_arco` manda el literal `'la flota'` en `{{1}}` donde el propio comentario dice "razón social de la flota", y el texto libre no identifica al responsable

`src/lib/meta/client.ts:466-467`:
```ts
name: 'respuesta_arco', language: { code: 'es_MX' },
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```
El comentario de la misma función (línea 456-457) dice "{{1}} = razón social de
la flota"; el código manda la cadena literal `'la flota'`. Y el texto libre de
la ventana de 24h (`repo.ts:998`) dice "fue atendida por la empresa: …" sin
nombrar ninguna empresa. Las dos rutas entregan una respuesta ARCO anónima: el
titular no sabe QUÉ responsable le contesta (LFPDPPP art. 34: la respuesta debe
identificar y ser clara). Operativamente, la UI le dice a la flota "se envió" y
lo que salió no dice quién la envió.

**Escenario con valores:** la plantilla se aprueba en Meta; fuera de la ventana
de 24h, la respuesta sale como "**la flota** te informa: <resolución>" — el
literal, no "TRANSPORTES INNOVATIVOS SA DE CV". El titular responde
"¿y ustedes quiénes son?" y eso no llega a ninguna bandeja.

**Estado: abierto.** El parámetro correcto necesita el nombre del tenant en
`resolverSolicitudArco` (que ya tiene `tenantId` y podría leer `tenant.nombre`).

### [MEDIO, abierto — nuevo] `resuelta` se escribe ANTES del intento de envío y no hay estado de entrega: la tabla muestra "Resuelta" para solicitudes cuyo titular nunca recibió nada

`src/lib/cuadra/repo.ts:985-990` actualiza `{ estado: 'resuelta', resuelta_en,
resolucion }` y DESPUÉS intenta el envío. Si el envío falla, la UI del momento
avisa ("entrégala por otro canal"), pero la base queda `resuelta` igual: al
recargar, no hay ninguna marca de "resuelta pero no entregada", ni columna, ni
estado. Una flota con 10 solicitudes con envío fallido ve 10 "Resuelta".

**Escenario con valores:** `enviarRespuestaArco` devuelve `{ok:false,
error:'fuera de la ventana…'}` → la solicitud queda `estado='resuelta'`. El
flota_admin cierra la pestaña sin leer el aviso. Tres semanas después, el
contralor pregunta por la constancia de entrega: la base dice resuelta, no hay
rastro del fallo salvo el log, y el plazo de 20 días hábiles ya pasó.

**Estado: abierto.** Al menos una nota en `resolucion` o un campo
`entregada_en`/`entrega_error` haría el registro honesto.

### [MEDIO, abierto — nuevo] `eslint src/` falla con un ERROR en código commiteado: `Date.now()` impuro dentro del render de la página nueva — el gate de CLAUDE.md roto por la pieza central de la ronda

`npx eslint src/` → 1 error + 18 warnings. El error:
```
src/app/dashboard/arco/page.tsx
  49:130  error  Error: Cannot call impure function during render
`Date.now` is an impure function...
```
`arco/page.tsx:49` calcula `vencenPronto` con `new Date(Date.now() + 5 * 864e5)`
dentro del cuerpo del componente server. El patrón de la pantalla hermana
(`compliance/page.tsx:179`) hace lo mismo pero dentro de la función helper
`datosDeCompliance` (minúscula), que la regla `react-hooks/purity` no mira —
por eso la 15 pasó y la 16 no. El commit anuncia "tsc 0 · build limpio" y es
cierto: `npx tsc --noEmit -p .` → 0 y `npm run build` → exit 0 (el build de
Next no aplica esta regla con la misma config). Pero CLAUDE.md define el gate
como "`npx tsc --noEmit -p .` y `npx eslint src/` — limpios", y el segundo está
roto en master.

**Escenario con valores:** cualquier PR/deploy que corra `npm run lint` o un
CI con `npx eslint src/` falla en la página nueva. El fix es mecánico (mover el
cálculo a una constante fuera del componente o a un helper, como compliance).

**Estado: abierto.**

### [MEDIO, abierto — nuevo] La solicitud ARCO del demo existe SOLO en la base real: ni `seed.sql` ni el GUION la reproducen, y el commit lo anuncia como logro

`c901226` dice "Se sembró una solicitud ARCO de prueba en la base real (demo)".
`grep -n "solicitud_arco" supabase/seed.sql` → **vacío**; GUION_DEMO.md no
menciona el flujo ARCO (su "El arco" es la estructura de la presentación, no
los derechos ARCO); la página nueva no está en el guion. La ronda 15 ya pagó
esta factura con el seed del demo: el dato vive en la base, no en el repo.
Restaurar la base desde `seed.sql` (el camino que SÍ funciona, `psql -f`) borra
la solicitud del demo sin que nada lo diga.

**Escenario con valores:** el día después del demo se restaura un backup del
seed para limpiar datos de prueba → `/dashboard/arco` muestra "Ninguna
solicitud ARCO registrada" y la ronda 16 no se puede demostrar en una segunda
reunión.

**Estado: abierto.**

### [MEDIO, abierto — nuevo] El gate de roles del ARCO: el `encargado` puede responder (un acto legal) y el `contador` —el rol que "vive del papel"— no puede ni ver la pantalla

`visibilidad.ts:26-32` — `encargado: ['operacion']`, `contador: ['dinero']`; y
`visibilidad.ts:80` clasifica `/dashboard/arco` como `'operacion'`. Resultado:
el jefe de tráfico —que por diseño "despacha y da seguimiento. No ve finanzas
ni toca la configuración de la cuenta"— puede responder una solicitud ARCO (una
decisión legal de la responsable, art. 32/34), y el contador —que es quien hace
todo el papel fiscal/legal de la flota— no tiene ni el link en el sidebar
(`sidebar-nav.tsx` filtra por `puedeVerRuta`). Puede ser una decisión
deliberada (ARCO = datos de operadores, mundo de operación), pero ningún
comentario ni prueba lo declara, y el rol equivocado respondiendo un acto legal
sin gate de `puedeAdministrar` es el patrón que la 0045 ya tuvo que cerrar.

**Escenario con valores:** el encargado de Innovativos (puesto medio, sin
facultades legales declaradas) entra a `/dashboard/arco` —el sidebar se lo
ofrece— y resuelve una solicitud de cancelación. El texto sale por WhatsApp a
nombre de "la empresa". El contador, que lleva los plazos de la LFPDPPP en su
operación diaria, no tiene forma de ver ni de enterarse.

**Estado: abierto** (cuestionable por diseño; al menos falta el gate de rol en
la acción, como `politicas/page.tsx:79-81` hace con `puedeAdministrar`).

### [BAJO, abierto — reincidente ronda 15] `compliance/page.tsx:37-38` sigue desestructurando `data` sin revisar `error` en el `maybeSingle`

```ts
const { data: sol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
if (!sol?.tenant_id) return { error: 'La solicitud no existe.' };
```
Mismo hallazgo de la ronda 15, sin cambio. Un bache de red → `data: null,
error: {message:'fetch failed'}` → "La solicitud no existe." — diagnóstico que
apunta al lugar equivocado. El fix modelo sigue en `tenant-api.ts:58-63`.

**Estado: abierto** (el `96f2adc` tocó esta página y no lo arregló).

### [BAJO, abierto — reincidente ronda 15] El KPI "Vencen pronto" sigue contando días CALENDARIO; en `/admin/compliance` el rótulo aún dice "días hábiles" (mentira), en `/dashboard/arco` dice "días" (verdad pero semántica desincronizada)

`compliance/page.tsx:67` rótulo "Vencen pronto (≤ 5 días hábiles)" +
`compliance/page.tsx:179` `5 * 864e5` (calendario). `arco/page.tsx:65` rótulo
"(≤ 5 días)" + `arco/page.tsx:49` `5 * 864e5`. El plazo real (`vence_en`) lo
calcula `venceArco` en DÍAS HÁBILES (`privacidad.ts:618-627`). Comparar un
límite de hábiles contra `Date.now() + 5 días de reloj` clasifica mal el
"vence pronto" — y en la pantalla de admin el rótulo lo afirma como hábiles.
La ronda 16 arregló el rótulo en la página nueva pero copió el cálculo.

**Estado: abierto.**

### [BAJO, abierto — nuevo] `resolverSolicitudArco` usa `operador_id` (un UUID) como teléfono de respaldo

`repo.ts:994`: `const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;`
`titular_ref` siempre es el teléfono (`processor.ts:160` lo llena con
`telefono = msg.from`), así que el respaldo es código muerto… hasta que una
solicitud llegue con `titular_ref` nulo (insert manual, migración): el
"teléfono" sería `33333333-0000-0000-0000-000000000001`, `destinatarioWhatsApp`
lo deja pasar como cadena de 33 dígitos y Meta lo rechaza con 400 — fail-closed,
pero con un diagnóstico que no dice "falta el teléfono".

**Estado: abierto** (latente).

### [BAJO, abierto — nuevo] Doble clic en "Responder" = doble envío de WhatsApp al titular

`resolverSolicitudArco` no comprueba el estado actual: si la solicitud ya está
`resuelta` y la acción vuelve a correr (doble submit del form, o re-submit
manual), re-lee, re-actualiza y **re-envía** el texto. No hay idempotencia ni
guard de "ya se envió". El form se oculta para `resuelta` después del
revalidate, pero entre el primer clic y el re-render caben dos envíos.

**Estado: abierto** (BAJO; el patrón de idempotencia por `estado` es una línea).

### [BAJO, abierto — reincidentes ronda 10/13/14/15] Las cinco deudas operativas clásicas siguen igual

- `scripts/seed.sh:21-22` sigue detectando el esquema por la tabla `viaje`
  mientras `seed.sql:104-107` exige la 0082 + la FORMA de la 0083 — el guard
  correcto sigue sin implementarse.
- `scripts/respaldo.sh` sigue sin poder correr: `npx --yes supabase projects
  list` → *"Access token not provided. Supply an access token by running
  `supabase login`…"*, y no hay `supabase/config.toml` ni `.supabase/`. La base
  sin respaldo operativo es ahora la que tiene la 0083 + la solicitud ARCO del
  demo.
- `startup.ts` sigue sin sondear 0078/0079/0080/0081/0082/0083
  (`grep -n "0078\|…" src/lib/cuadra/startup.ts` → vacío).
- `scripts/deploy-vercel.sh:65-69` sigue sugiriendo el webhook contra la URL
  efímera y el "sube maxDuration a 120" ya cumplido.
- `FACTURAPI_SECRET_KEY` sigue solo en preview (`vercel env ls production` →
  no existe; `preview` → sí, 1d). El hueco de numeración 0066→0070 sigue.

**Estado: abiertos** (sin cambio desde la ronda 15).

### [BAJO, abierto — nuevo, DX] Los probes sin trackear volvieron a romper `npx tsc --noEmit` durante la ventana de auditoría — el mismo accidente de la ronda 15, en más grande

Entre 21:47 y 21:58 vi aparecer y desaparecer **7 archivos de sonda sin
trackear** (`audit16_fiscal_probe.test.ts`, `zzz-aud16-probe2/3/4.test.ts`,
`zzz-aud16-toolcalling-probe.test.ts`, …) y `npx tsc --noEmit -p .` falló con
4 errores (TS2305/TS2739/TS2322) mientras existían. Al momento de escribir,
los dueños los borraron y `tsc` vuelve a 0 — el árbol commiteado compila. Pero
es la repetición exacta del hallazgo de la ronda 15 (`zzz-a15-probe.test.ts`
sin trackear que rompía tsc): la regla "se borra al terminar" no funciona con
varios agentes en paralelo, y en la ronda 15 este accidente ya había mandado
previews a producción. Los probes de ESTA ronda además usan `console.log` y
`Math.random()` (idem `engine.test.ts:1529`, aunque ahí no afecta las
aserciones).

**Estado: abierto como patrón** (transitorio: el árbol actual compila).

## Cierres de la ronda 15 — verificados

- **[CRÍTICO ARCO, cerrado]** El superadmin ya ve TODAS las flotas.
  `compliance/page.tsx:147-158` — `datosDeCompliance` hace `traerTodo` sobre
  `solicitud_arco` SIN filtro de tenant (la línea `if (!s?.tenantId) return`
  desapareció; ahora es `if (!s)`), con columna de flota vía el join
  `flota:tenant_id(nombre)`. La pantalla ya no está vacía para el superadmin
  diseñado. Verificado en el archivo actual.
- **[ALTO contador 15%, cerrado]** `engine.ts:310-327`: con `facilidad15 ===
  true`, si `totalCombustibleEjercicio` no es `> 0` o el comprobante es de otro
  año (`anioComprobante !== input.anioEjercicio`), el gasto va a
  `combustible_efectivo` (monto 0, cubeta `por_confirmar`, estatus `revisar`)
  con nota "no se pudo calcular el total… la facilidad no se evaluó" — ya no
  existe la frase "contra un tope de $0.00". `desde_db.ts:63-65` inyecta
  `anioEjercicio` (año del viaje) y `desde_db.ts:113` lo pasa al motor. Las 3
  pruebas nuevas de `engine.test.ts:1523-1560` pasan (117/117 de engine).
- **[MEDIO tools.ts/desde_db.ts, cerrado]** `tools.ts:104-108` usa el año del
  VIAJE (`getViaje(...).fechaInicio.slice(0,4)`), no el del reloj — mismo ancla
  que `desde_db.ts`.
- **[MEDIO actualizarFacilidad15, cerrado]** `repo.ts:923-926` ahora revisa
  `errLee` y lanza antes de reemplazar la config por una sola llave.
- **[MEDIO panel 'sin declarar', cerrado]** `fiscal.ts:335-340`: `elegible15 ===
  false` → `efectivo_no_elegible` (perdida); `undefined` → `combustible_efectivo`
  (en riesgo), y `contador/combustible/page.tsx:155-167` pinta los tres estados
  con su texto.
- **[BAJO probe zzz-a15, cerrado]** `git status` ya no lista
  `zzz-a15-probe.test.ts`; el árbol compila (los probes de la 16 son otro
  asunto, ver BAJO de arriba).
- **[BAJO KPI calendario, NO cerrado]** el rótulo "días hábiles" de compliance
  sigue mintiendo (ver hallazgo BAJO de arriba).
- **[Reincidentes]** seed.sh, respaldo.sh, startup.ts, deploy-vercel.sh,
  FACTURAPI, numeración — todos siguen abiertos.

## Lo que revisé y está bien

- **`npm run build` compila (exit 0)** con el HEAD actual — el deploy de la
  ronda 16 no está bloqueado por build; lo está solo por la bandera `[deploy]`.
- **Pruebas de mis bloques, verdes**: engine (117), fiscal (57),
  administración (27), migraciones_verificadas (4), guard (20), visibilidad
  (90), tenant-efectivo (45), instrumentation (5), observability arranque (7) +
  reportar (11), aviso_barrera_cerrado (3) + aviso_blip_de_red (5), webhook
  whatsapp route_pool (10) + route_cableado (14), stripe webhook (5) → ~420
  verdes, incluidas las 3 nuevas del fail-closed del 15%.
- **El fail-closed del 15% es real y honesto en el PDF y en el estatus**: con
  contador caído, `estatus: 'revisar'` + cubeta `por_confirmar` + nota que dice
  qué falta. `tools.ts` omite `combustible_efectivo_ejercicio` cuando la
  consulta falla (no entrega ceros como si fueran medición).
- **`npm run build` limpio y `tsc` a 0** sobre el árbol commiteado (al cierre
  de esta auditoría).
- **El flujo de registro ARCO por WhatsApp sigue intacto y sin regresión**:
  `processor.ts:146-167` responde el aviso, registra la solicitud
  (`titular_ref = msg.from`), nunca lanza; `resolverSolicitudArco` filtra por
  `tenant_id` en la lectura y en el update (sin fuga cross-tenant).
- **La página nueva respeta el gate de visibilidad**: `resolverTenantEfectivo`
  + `puedeVerRuta` en `visibilidad.ts:80`; el sidebar filtra con la MISMA
  función (sidebar-nav.tsx:94).
- **`enviarRespuestaArco` falla cerrado en lo que sí controla**: timeout de
  10s por fetch, `destinatarioWhatsApp` normaliza el 521→52 (el bug del "1"
  mexicano está cerrado), los códigos 131047/131026/131042 intentan la
  plantilla y si no, devuelven `ok:false` con error.
- **El mensaje de `/dashboard/arco` SÍ es honesto** (`arco/page.tsx:39-41`):
  distingue "se envió" de "no se pudo enviar (razón) — entrégala por otro
  canal". La ronda 16 arregló la mentira en la página que construyó y la dejó
  en la que no tocó (ver ALTO #1).
- **Producción responde**: `curl https://app.likida.ai/` → 200 (1.19s), el
  webhook responde 403 al GET sin token. El release Ready sigue siendo
  `caae369`.

## Lo que no alcancé a revisar

- **La base real** (prohibido consultarla): si la solicitud ARCO del demo está
  sembrada, con qué `titular_ref` (determina si la respuesta del demo saldría
  por WhatsApp), si `vence_en` de esa solicitud sigue vigente, y si la 0083
  sigue aplicada.
- **El estado real de la plantilla `respuesta_arco` en Meta** (aprobada o en
  revisión — el commit dice "en revisión") y el `dev_mode`/whitelist de la app.
- **La suite completa (~3,159)**: otro auditor la corre; corrí ~420 de mis
  bloques.
- **La ejecución real del envío**: no se envió nada (prohibido tocar
  producción); el análisis de `enviarRespuestaArco` es sobre el código, no
  sobre una llamada real.
- **El contenido fiscal de la RFA 2.9** (matriz, IEPS): rubro del auditor
  fiscal; yo verifiqué el impacto operativo (contador, estatus, despliegue,
  panel).

## Veredicto

**Yellow light para el demo de mañana — los dos peores defectos de la ronda 15
quedaron bien cerrados, pero la ronda 16 entregó su pieza central sin pruebas,
con el gate de `eslint` roto en código commiteado, y nada de todo esto está en
producción.**

Para la sala:

1. **Decide el despliegue YA.** Producción sigue en `caae369`, 21 commits
   atrás. El ARCO de la flota, el fail-closed del 15% y la RFA 2.9 no existen
   en `app.likida.ai`. La suite y el build están verdes; es una línea
   (`[deploy]` o Redeploy). Ir a la sala sin desplegar es presentar un producto
   que no sabe la regla que se acaba de implementar.
2. **No demuestres la resolución ARCO desde `/admin/compliance`**: su mensaje
   dice "Likida no envía mensajes ARCO todavía" y el código SÍ envía (o falla
   en silencio). Usa `/dashboard/arco`, cuyo mensaje sí es honesto — y sé que
   la respuesta sale anónima ("la empresa", sin razón social) y desde el número
   de Likida, no del de la flota.
3. **Arregla el gate antes de cerrar la ronda**: `npx eslint src/` falla con 1
   error en `arco/page.tsx:49` (`Date.now` impuro). La ronda 15 ya pagó por
   cerrar con el gate roto (el probe sin trackear); esta vez es código
   commiteado.
4. **Los tres `.catch(() => [])`** de las pantallas ARCO vuelven a la mentira
   de "no hay nada estando ciego" — en la pantalla del plazo legal. El patrón
   `safe()`+`AvisoDeFallo` del repo ya existe; úsalo.
5. **No hagas depender el demo de la solicitud sembrada a mano**: no está en
   `seed.sql`. Si mañana alguien restaura la base, el ARCO del demo desaparece
   sin que nada lo diga.
6. **Las deudas clásicas siguen**: respaldo imposible (`supabase login` +
   `link`), seed.sh con guard de `viaje`, startup sin sondear 0078-0083,
   FACTURAPI solo en preview. La más cara sigue siendo el respaldo: la base que
   no se puede respaldar es la que tiene el demo sembrado.

**Yellow light: el camino del demo (WhatsApp → cuadre → PDF) no se rompió y el
fail-closed del 15% quedó honesto, pero la ronda 16 estrenó una superficie
nueva —ARCO de la flota con entrega por WhatsApp— que no está probada, no está
desplegada, miente en la pantalla que no tocó y miente por omisión cuando la
base no responde.**
