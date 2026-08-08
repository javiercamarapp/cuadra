# Operabilidad y DX — auditoría 17

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura**. Se
cerró el abierto de `seed.sh` y las probes de arranque sí miden ahora, pero el
propio arreglo que las hizo medir (`a8c361b`) metió una escritura del arranque
sobre el **mutex del camino del dinero**; la migración a QStash (`91c41db`)
añadió una pata que nadie observa; y la única pantalla que dice si hay
observabilidad tiene la palabra "Conectado" escrita a mano.

**El riesgo mayor de hoy:** el diagnóstico de arranque *muta* el candado que
serializa el procesamiento de un viaje (`unlock_viaje` sin dueño), así que la
herramienta que existe para vigilar el camino del dinero es hoy uno de sus
peligros. Y por encima de eso: aun con Sentry cableado, `DEPLOY.md:147` sigue
diciendo con todas sus letras que **no hay destinatario ni canal** — a las 3 a.m.
nadie es despertado por nada.

---

## Hallazgos

### [CRÍTICO] El sondeo de arranque suelta el mutex de un viaje que puede estar en curso

`src/lib/likida/startup.ts:63-70` · `supabase/migrations/0005_concurrencia.sql:45-50`

```ts
const { data: viajeReal } = await admin.from('viaje').select('id').limit(1);
if (viajeReal?.[0]?.id) {
  const { error } = await admin.rpc('try_lock_viaje', { p_viaje: viajeReal[0].id, p_ttl_ms: 1 });
  ...
  await admin.rpc('unlock_viaje', { p_viaje: viajeReal[0].id }); // liberar el lock de prueba
}
```

`unlock_viaje` es `delete from viaje_lock where viaje_id = p_viaje` — **sin token
de dueño**. Y el `unlock` se ejecuta *incondicionalmente*: el código descarta el
`data` de `try_lock_viaje`, así que no sabe si adquirió el lease o si lo tenía
otro proceso (en ese caso `try_lock_viaje` devuelve `false` **sin error**, y el
probe lo lee como éxito).

Escenario, con valores:

1. El operador manda 4 fotos y un "listo". Instancia A entra por el webhook,
   `acquireViajeLock('a3f…', {ttlMs: 60_000})` (`conv.ts:418-426`) toma el lease
   del viaje `a3f…` hasta `now()+60 s`.
2. La ráfaga hace que Vercel levante una instancia B. Next ejecuta
   `instrumentation.register()` **antes** de servir la primera petición de B
   (`src/instrumentation.ts:11`), y ahí corre `verificarMigracionesCriticas()`.
3. `select id from viaje limit 1` (sin `order by`) devuelve `a3f…` — en la base
   demo sembrada por `supabase/seed.sql` la tabla `viaje` tiene 2 filas, así que
   es el mismo viaje del demo con probabilidad alta.
4. `try_lock_viaje('a3f…', 1)` → `found = false`, `error = null` → el probe da
   por buena la migración.
5. `unlock_viaje('a3f…')` → **DELETE del lease vivo de la instancia A**.
6. El siguiente mensaje del mismo teléfono entra a un viaje sin candado: dos
   turnos de agente concurrentes sobre el mismo viaje, que es exactamente lo que
   `0005_concurrencia.sql` existe para impedir. El `unique(viaje_id)` de
   `liquidacion` evita la fila duplicada, pero no evita dos ciclos de cierre, dos
   PDFs y dos mensajes de WhatsApp con cifras distintas del mismo viaje.

Intenté refutarlo por tres lados y no cae: (a) el `ttl_ms: 1` solo afecta al
lease que el propio probe *inserta*, no al que borra; (b) no hay ninguna guarda
de entorno — corre igual en producción que en `next dev`; (c) la barrera de
intake (`intake_pendientes`) protege contra cerrar sobre gastos parciales, pero
no contra dos turnos de agente simultáneos, que es lo que el mutex serializa.

**Consecuencia:** el contralor puede recibir dos liquidaciones del mismo viaje
con cifras que no coinciden, en la ventana en la que más probable es que pase
(ráfaga de fotos = escalado = arranques en frío). Y el log no dirá nada: el probe
emite `startup.migraciones {ok:true}`.

**Causa raíz probable:** `a8c361b` cambió el UUID de ceros por un viaje real para
matar un falso positivo de la FK de `0075`, y con eso convirtió un sondeo de solo
lectura en una escritura sobre estado vivo del camino del dinero.

---

### [ALTO] La pantalla que dice si hay observabilidad tiene "Conectado" escrito a mano

`src/app/admin/observabilidad/page.tsx:52-58` (y :59-65)

```tsx
<a href="https://sentry.io" …>
  <div className="text-sm font-medium">Errores — Sentry</div>
  <StatusPill estado="ok">Conectado</StatusPill>
```

Es un server component (`async`, `dynamic = 'force-dynamic'`): podría leer
`process.env.SENTRY_DSN` o llamar a `sentryActivo()` (`observability/sentry.ts:43`)
sin coste. No lo hace. El pill verde es una constante.

Escenario: `SENTRY_DSN` está vacía en Vercel — que es **exactamente** lo que pasó
en la auditoría 5 y la razón por la que existe `avisarObservabilidad()`. Javier
abre `/admin/observabilidad` para comprobar que la observabilidad está encendida
y lee **"Errores — Sentry · Conectado"** en verde. En realidad `sentryActivo()`
es `false`, `reportar()` y `reportarExcepcion()` son no-ops, y todo error muere
en el runtime log de Vercel, cuya retención `DEPLOY.md:24-27` describe como
"corta y sin log drain".

La única señal contraria es la línea `startup.observabilidad {"sentry":false}` en
el runtime log — es decir, en el sitio que nadie mira, y que Sentry no puede
retransmitir porque Sentry es precisamente lo que está apagado.

**Consecuencia:** el rótulo viola la regla del producto ("un rótulo tiene que ser
verdad") en la pantalla cuyo único trabajo es decir la verdad sobre si alguien se
entera cuando algo se rompe.

**Causa raíz probable:** el estado se escribió como maqueta y nunca se cableó al
único predicado que ya existe.

---

### [ALTO] Un fallo puramente de cliente no deja rastro en ninguna parte, y ni siquiera un código en pantalla

`src/app/dashboard/error.tsx:39-47` · `src/app/global-error.tsx:31-38` ·
`src/lib/logger.ts:142-150` · `src/proxy.ts` (CSP, `connect-src 'self'`)

Los dos boundaries hacen lo mismo en un `useEffect`:

```ts
void import('@/lib/logger').then(({ logger }) =>
  logger.error('panel.boundary', { digest: error.digest ?? 'sin-digest', err: error.message }));
```

`useEffect` solo corre en el navegador. Ahí:

- `logger.emit` termina en `console.error(JSON.stringify(line))` (`logger.ts:144`)
  → la consola del navegador del contralor, no el servidor.
- La réplica a Sentry está condicionada a `process.env.SENTRY_DSN`
  (`logger.ts:148`), que **no** es `NEXT_PUBLIC_*`: en el bundle de cliente vale
  `undefined`. Nunca entra.
- Aunque entrara, el CSP de `proxy.ts` fija `connect-src 'self'` y su propio
  comentario lo declara: *"Sentry vive SOLO en `SENTRY_DSN` (server…) — el
  navegador nunca le habla"*. No hay `instrumentation-client.ts` ni
  `sentry.client.config.ts` en el repo (verificado: `ls sentry*.*` vacío).
- `onRequestError` (`instrumentation.ts:76`) solo ve errores del **servidor**.

Y el remate: `error.digest` lo pone Next **solo** para errores originados en el
servidor. En un fallo de cliente `digest` es `undefined`, así que el bloque
`{error.digest && …}` no se pinta: no hay ni "Código del incidente".

Escenario con valores: en la sala, el contralor cambia el filtro de periodo; un
componente de cliente del panel (`admin/charts.tsx`, `contador-retro.tsx`,
`command-palette.tsx`) revienta con `TypeError: Cannot read properties of
undefined (reading 'toFixed')` sobre una serie vacía. Ve *"No se pudo cargar el
panel · Reintentar"* **sin código**. En el servidor: cero líneas. En Sentry: cero
eventos. A la mañana siguiente no hay absolutamente nada que buscar — el caso
literal que `dashboard/error.tsx` dice en su cabecera haber resuelto.

**Causa raíz probable:** el arreglo de la auditoría 5 se diseñó para el camino de
servidor y se colgó de un `useEffect`, que es el único punto del árbol donde el
`logger` de servidor no puede llegar a ningún lado.

---

### [ALTO] La compuerta de despliegue interpreta *cualquier* fallo del comando como "no desplegar", y nada confirma qué está publicado

`vercel.json:3` · `docs/conocimiento/DEPLOY.md:157-187` · `scripts/deploy-vercel.sh:44-46`

```json
"ignoreCommand": "git log -1 --pretty=%s | grep -qi '\\[deploy\\]' && exit 1 || exit 0"
```

La semántica de Vercel es `exit 1` = construir, `exit 0` = saltar. La lógica de
la bandera es correcta y sí lee **solo el asunto** (`--pretty=%s`) — eso está
bien y lo verifiqué. El problema es el `|| exit 0`: **colapsa todos los modos de
fallo del pipeline en "saltar"**. Medido:

```
$ cd /tmp/notgit && sh -c "git log -1 --pretty=%s | grep -qi '\[deploy\]' && exit 1 || exit 0"
fatal: not a git repository (or any of the parent directories): .git
exit=0        # ← saltar el build
```

Cualquier condición en la que `git log` no pueda leer el asunto —el contenedor de
build sin `.git` (el caso de un `vercel --prod` desde CLI, que es lo que hacen
`DEPLOY.md:123`, `DEPLOY.md:92` para rotar el token de WhatsApp, y
`scripts/deploy-vercel.sh:44`), `git` ausente, un clon superficial raro— produce
un *skip* **indistinguible** de "el commit no llevaba la bandera". Y
`deploy-vercel.sh:45` imprime `✅ Desplegado: $url` pase lo que pase, porque solo
mira el código de salida del CLI, no si hubo build.

Y no hay forma de enterarse:

- La app no expone **nada** de su identidad de build: `grep -rn "VERCEL_GIT_COMMIT_SHA" src/ next.config.ts` → 0 resultados. No hay `/api/health` con versión (`/api/demo` devuelve `envHealth()`, booleanos, sin commit).
- CI (`.github/workflows/ci.yml`) corre en cada push, sale verde, y no dice una palabra sobre la bandera.
- La comprobación que documenta `DEPLOY.md:177-180` exige el CLI de Vercel y una sesión iniciada; no hay nada automático.

Estado hoy, medido en el repo: el último commit con bandera es `87426f8`. Por
encima de él hay **5 commits sin bandera**, entre ellos `563c507 feat(dashboard):
Resumen de flota con la dirección visual elegida el 7-ago` y `ca2302f chore:
purgar menciones sueltas al nombre viejo 'Cuadra'`. Es decir: `app.likida.ai`
sirve una versión que no tiene el Resumen de flota y que todavía dice "Cuadra"
en algún sitio, y ni el repo ni la app lo dicen.

**Consecuencia:** se enseña un producto viejo creyendo que es el nuevo, y —peor—
una rotación de `WHATSAPP_ACCESS_TOKEN` seguida de `vercel --prod` puede no
llegar nunca a producción mientras el script grita `✅ Desplegado`, dejando al
operador en el bucle de "No pude descargar tu foto 😕" que `DEPLOY.md:78-83`
describe.

**Causa raíz probable:** un `||` que convierte el error en el caso por defecto,
más una compuerta sin ninguna señal positiva de confirmación.

---

### [ALTO] El único respaldo de producción es un script manual que nada agenda ni vigila

`scripts/respaldo.sh:1-45` · `package.json:6-15` · `.github/workflows/ci.yml`

El propio encabezado del script establece los hechos: plan **free** de Supabase,
**sin respaldo automático ni PITR**, verificado el 4-ago-2026, y el mismo día se
borró la base entera y la salvó un dump hecho a mano. El script convierte esa
suerte en procedimiento — pero solo si alguien se acuerda de correrlo.

Comprobado: `package.json` no tiene script `respaldo` (solo `dev/build/start/
lint/test/typecheck/seed/setup/ticket`); `.github/workflows/` tiene **un** job
(`ci.yml`) y no lo invoca; no hay `crons` en `vercel.json` que lo llamen (los tres
son `escalar`, `facturar`, `purgar`). El destino por defecto es
`~/Desktop/likida-respaldos` y borra a los 14 días.

Escenario: a las 3 a.m. una migración mal aplicada o un `delete` sin `where`
vacía `gasto` de un tenant. A la mañana siguiente el respaldo más reciente es de
cuando Javier se acordó por última vez de correr el script en su Mac — y no hay
ningún registro de cuándo fue, ni alerta de que lleva N días sin correrse.

**Consecuencia:** con CFF art. 30 de por medio (conservar comprobantes 5 años),
la pérdida no es de producto: es de la contabilidad de un cliente.

**Causa raíz probable:** el respaldo se escribió como herramienta, no como
proceso con calendario y comprobante.

---

### [MEDIO] La cola de QStash no rompe el techo que dice romper: el lote se sigue cortando a los 150 s

`src/app/api/cron/facturar/route.ts:25,129,158,469` · `src/app/api/cron/facturar/cola/route.ts:11,75`

`route.ts:129` define `const PRESUPUESTO_LOTE_MS = maxDuration * 1000`, donde
`maxDuration` es el **300 de esa ruta**. `procesarLoteEnCola` usa esa constante
de módulo. El callback la importa y la ejecuta con su propio
`maxDuration = 600` (`cola/route.ts:11`), cuyo comentario afirma: *"el techo de
300 s de una invocación directa es justo lo que esta cola existe para romper"*.

No lo rompe. El corte sigue siendo `Date.now() - inicioLote >= 300_000 - 150_000`
= **150 s**.

Escenario con valores: 8 tickets de 4 flotas distintas, peor caso medido de una
sesión de portal ~147 s (`MARGEN_LOTE_MS`, :149-156). Flota 1 arranca en t=0 y
termina ≈147 s. Flota 2 se comprueba a t≈147 s (< 150 s) y arranca, termina
≈294 s. Flota 3 se comprueba a t≈294 s ≥ 150 s → `sinTiempo`. Flota 4 igual.
Resultado: **2 de 4 flotas por corrida**, con 600 s de presupuesto disponibles y
306 s sin usar. La respuesta lo dice (`sinTiempo`), pero nadie la lee: es el
cuerpo de un POST de QStash.

**Consecuencia:** la facturación automática avanza a la mitad del ritmo
prometido, y la migración a QStash aparenta haber resuelto un techo que sigue
puesto.

**Causa raíz probable:** una constante derivada del `maxDuration` del módulo que
la define, compartida con un llamador que tiene otro `maxDuration`.

---

### [MEDIO] Encolar a QStash devuelve 200 y nadie observa si el callback llegó

`src/app/api/cron/facturar/route.ts:308-337` · `cola/route.ts:22-28` · `src/lib/env.ts:29-37`

```ts
logger.info('cron.facturar.encolado', { messageId: publicacion.messageId, tickets: lote.length });
return NextResponse.json({ corrio: true, encolado: true, messageId, tickets, quedaron });
```

`info` **no** se replica a Sentry (`logger.ts:148`: solo `warn`/`error`). Y nada
cierra el circuito: no se escribe el `messageId` en ninguna tabla, no hay
reconciliación, no hay manejador de DLQ. El cron de Vercel ve 200 y queda verde.

Escenario con valores: `UPSTASH_QSTASH_TOKEN` está puesta en Vercel pero
`QSTASH_CURRENT_SIGNING_KEY` no (son variables distintas, añadidas en `468ec1f`).
Cada hora: el cron encola, responde `{"corrio":true,"encolado":true}` con 200, y
el callback contesta **503 "QStash no configurado"** (`cola/route.ts:25-28`);
QStash reintenta 2 veces y se rinde. Cero tickets facturados, 24 veces al día,
indefinidamente — con el panel de crons de Vercel en verde.

Contrapeso que sí existe: `qstash.cola.sin_config` es `error`, así que *si*
`SENTRY_DSN` está puesta, llega a Sentry. Pero `env.ts:29-37` solo vigila los
grupos `llm`, `whatsapp` y `supabase`: ninguna de las cuatro variables de QStash
entra en `faltantes()`, así que `startup.entorno_grupos` no dice nada de esta
configuración parcial, que es justo la clase de variable que `arranque.ts` existe
para cazar ("el sistema arranca igual, mal").

**Consecuencia:** el camino del dinero recién movido a una cola es el único que
no tiene señal de terminación.

**Causa raíz probable:** el enqueue se instrumentó como éxito en vez de como
promesa pendiente de confirmar.

---

### [MEDIO] Una base caída se reporta como "sin viajes en la base"

`src/lib/likida/startup.ts:63,71-75`

```ts
const { data: viajeReal } = await admin.from('viaje').select('id').limit(1);
```

El `error` se descarta — el patrón que el propio archivo documenta como caro en
`sinRespuesta()` (:16-32: *"un diagnóstico falso cuesta dos veces"*). supabase-js
reporta por valor: con la base caída, `data` es `null` y se cae al `else`, que
emite:

`startup.migraciones_0005_skip {"msg":"sin viajes en la base; el probe del mutex no corre"}`

Escenario: Supabase con `fetch failed` a las 3 a.m. La línea que aparece afirma
un hecho sobre el **contenido** de la base ("sin viajes") cuando lo cierto es que
no se pudo preguntar. Quien la lee concluye que el tenant está vacío.

Atenúa —no anula— que los sondeos de índices y triggers de más abajo sí pasan por
`reportarProbe()` y dirán "no se pudo verificar". Pero la primera línea del
arranque miente, y es la primera que se lee.

**Causa raíz probable:** la única consulta del archivo que no pasa por
`reportarProbe`.

---

### [MEDIO] En la pantalla ARCO, los dos KPI pintan 0 cuando la lectura falló

`src/app/dashboard/arco/page.tsx:62-70,85-88`

El arreglo de la ronda 16 es real a medias: la **tabla** falla cerrado y muestra
*"No se pudieron leer las solicitudes ahora mismo (…) no hay forma de saber si
hay solicitudes pendientes"* (:94-99). Pero `pendientes` y `vencenPronto` se
calculan sobre `solicitudes`, que en el `catch` quedó en `[]`, y los dos
`KpiTile` se renderizan **antes** e **incondicionalmente**:

```tsx
<KpiTile … etiqueta="Por responder" valor={pendientes.length} />
<KpiTile … etiqueta="Vencen pronto (≤ 5 días)" valor={vencenPronto.length} />
```

Escenario: `listarSolicitudesArco` lanza (`LecturaIncompleta` de `pg.ts:174`, o
la base caída). Arriba de la pantalla, en las dos tarjetas grandes: **"Por
responder: 0"** y **"Vencen pronto: 0"**. Abajo, el aviso de que no se pudo leer.
El contralor lee los números.

**Consecuencia:** un cero que parece medición sobre un plazo legal (LFPDPPP art.
32, 20 días hábiles). `/admin/compliance` no tiene este problema: usa `traerTodo`
sin `try/catch`, así que la página entera falla cerrado con digest.

**Causa raíz probable:** el fail-cerrado se aplicó al bloque que se estaba
editando, no a todo lo que se deriva del mismo dato.

---

### [MEDIO] Todos los fallos de un mismo `msg` son un solo issue de Sentry: una causa nueva nunca dispara alerta

`src/lib/observability/sentry.ts:160`

```ts
sentry?.captureMessage(msg, { level: …, extra: meta, fingerprint: [msg, nivel] });
```

El `fingerprint` fijo resolvió un problema real (separar `startup.migraciones`
`ok:true` de su contrario). El efecto colateral es que **el mensaje es lo único
que agrupa**: todos los `processInbound.fail` —de todos los tenants, por todas
las causas— caen en un único issue.

Escenario con valores: durante semanas `processInbound.fail` acumula eventos de
`fetch failed` transitorios; el issue está "visto y silenciado". Una noche
aparece una causa nueva —`TypeError: Cannot read properties of undefined (reading
'monto')` en el tenant `id:9f2c1a4b77de`— y entra al **mismo** issue ya
silenciado. Las reglas de alerta habituales de Sentry ("nuevo issue", "issue no
resuelto que reaparece") no disparan. Los `extra` con `tenant`/`viaje` están ahí,
pero hay que ir a buscarlos.

Además, todo lo que pasa por `logger.error` llega como `captureMessage`: **sin
stack trace**. `reportarExcepcion` —el único camino con stack— solo lo llama
`onRequestError`. Un fallo dentro de `after()` nunca produce traza.

**Consecuencia:** la agrupación que se eligió para no perder un aviso hace que se
pierda el siguiente aviso distinto.

---

### [MEDIO] `npm run setup` no deja el proyecto corriendo en una máquina limpia

`package.json:12` · `scripts/seed.sh:8-31` · `README.md` (§ Correr el demo)

```json
"setup": "npm install && npm run seed"
```

En una máquina limpia, sin `DATABASE_URL` exportada, `seed.sh:11-15` imprime
`❌ Falta DATABASE_URL` y sale `1` → `npm run setup` **falla**. Y con
`DATABASE_URL` puesta pero sin cliente de Postgres instalado (una Mac recién
formateada no trae `psql`), el `if psql …` de :21 devuelve no-cero, se toma la
rama del `else`, se imprime **"▸ Aplicando migraciones…"** y acto seguido revienta
con `psql: command not found` — un mensaje que apunta al lugar equivocado (parece
un problema de migraciones, es un binario ausente).

El `README.md` no menciona `npm run setup`: documenta `npm install` → `cp
.env.example .env.local` → `npm run dev`, que tampoco siembra nada.

**Nota sobre el abierto de la ronda 13:** el hallazgo original —`seed.sh` no
funcionaba contra una base ya migrada— **está cerrado**: `seed.sh:21-30` detecta
`information_schema.tables … table_name='viaje'` y siembra solo datos. Verificado.
Lo que queda es lo de arriba.

**Causa raíz probable:** un alias `setup` que documenta una intención sin
comprobar sus dos prerrequisitos.

---

### [BAJO] El runbook manda a un archivo que ya no existe

`docs/conocimiento/DEPLOY.md:63`

> Estas cuatro líneas son las que lo delatan (`src/lib/cuadra/costos.ts`)

`src/lib/cuadra/` se eliminó en `87426f8`; hoy es `src/lib/likida/costos.ts`
(verificado: existe). Es la sección del runbook sobre el costo por liquidación —
la cifra con la que se fija el precio del producto. También `DEPLOY.md:47` cita
`startup.entorno`, cuyo `msg` real es `startup.entorno_grupos` /
`startup.config_silenciosa` (`arranque.ts:59,87`); ahí la búsqueda por subcadena
salva, en el `costos.ts` no.

**Consecuencia:** a las 3 a.m., el documento al que se acude manda a un `open` que
falla. Es exactamente la clase de deriva que `runbook.test.ts` vigila para
`.env.example` y no para las rutas citadas en `DEPLOY.md`.

---

### [BAJO] El catch exterior del `after()` del webhook pierde el `waMessageId`

`src/app/api/webhook/whatsapp/route.ts:168-171`

```ts
processInbound(m).catch((e) => logger.error('processInbound', { err: e instanceof Error ? e.message : String(e) }))
```

`processInbound` tiene su propio catch rico (`processor.ts:2213-2227`: `id`,
`de`, `tenant`, `viaje`, `cerroSinEntregar`), así que este exterior solo ve lo que
escapa a ese catch: un throw en `claimMessage` (`processor.ts:327`, **fuera** del
`try`) o en el `finally` que libera el lock (`processor.ts:2239`).

Escenario: Supabase no responde. `claimMessage` lanza para los 5 mensajes de la
ráfaga y salen 5 líneas idénticas, carácter por carácter:

```json
{"t":"…","level":"error","msg":"processInbound","meta":{"err":"TypeError: fetch failed"}}
```

Sin `waMessageId`, sin teléfono, sin nada. Y como el webhook ya respondió 200
(`route.ts:250`), Meta no reintenta: son 5 comprobantes perdidos y ninguna línea
dice cuáles. Justo diez líneas más arriba (`route.ts:140-141`) el archivo explica
por qué el `waMessageId` tiene que ir en el log.

**Causa raíz probable:** el `.catch` inline se escribió como red de última hora,
sin el contexto que el resto del archivo sí conserva.

---

## Lo que revisé y está bien

- **Las probes de arranque sí miden.** Verificado uno por uno: `indices_faltantes`
  (`startup.ts:158-174`) y `triggers_faltantes` (:186-205) consultan el catálogo,
  que es lo único que ve un índice o un trigger — ya no el `select cfdi_uuid` que
  respondía igual con la migración y sin ella. El sondeo de `0031` lee
  `viaje.intake_pendientes_en`, columna que **nace** en esa migración (:100-103).
  El de `0022` discrimina por SQLSTATE `42725` (:216-224). El de `0005` sí quedó
  midiendo la función (era un falso positivo de la FK de `0075`) — pero al precio
  del CRÍTICO de arriba.
- **`sinRespuesta()`** (`startup.ts:16-40`) separa "eso no existe" de "no pude
  preguntar" por presencia de `code`, y `reportarProbe` es el único sitio que
  decide qué se dice. Es la doctrina correcta; el hallazgo MEDIO es que una
  consulta se le escapó.
- **`onRequestError`** (`instrumentation.ts:76-114`) cubre toda superficie de
  servidor, registra el `digest` y llama a `flushObservabilidad()` en el punto
  exacto donde la invocación va a congelarse. Nunca lanza.
- **`huellaId` / redacción** (`logger.ts:82-110`): huella estable para lo que no
  se puede adivinar (UUID), borrado para lo que sí (RFC, teléfono), una sola
  pasada de regex, `digest` exceptuado en `CLAVES_NO_PII` (:127). Es lo que hace
  que un log sirva a las 3 a.m. sin ser una fuga.
- **Los tres crons fallan cerrado y lo dicen.** `escalar/route.ts:35-41`,
  `purgar/route.ts:56-61`, `facturar/route.ts:249-253`: sin `CRON_SECRET`
  devuelven **500**, no 200, con la razón escrita. Y `facturar` responde **503** y
  no marca tickets cuando Chromium no arranca (:541-563), con los tres orígenes
  del binario en el mensaje.
- **`runbook.test.ts`** convierte `.env.example` y `DEPLOY.md` en artefactos
  verificados: variables leídas ⊆ declaradas, sin sobrantes, sin duplicados, sin
  "palancas" que el código no tiene (:57-113).
- **CI corre en todas las ramas** (`ci.yml:20-22`), con `concurrency` que cancela
  lo viejo, `npm ci`, typecheck, lint, cobertura con trinquete, **y** el paso
  extra de pruebas de tiempo sin instrumentar (:66-72) que recupera las dos que
  `--coverage` se salta. Sin secretos, ~2 min.
- **Compuerta reproducida hoy**, coincide con el MAPA: `npx vitest run` → 249
  archivos, **3148 pruebas verdes, 1 saltada** (62.6 s).
- **Los dos abiertos de ARCO de la ronda 16 se sostienen:** `/admin/compliance`
  ya lista solicitudes reales con su plazo y una acción para resolver
  (`compliance/page.tsx:48,148-182`), y no está siempre vacía —`getSessionTenant`
  devuelve un objeto con `tenantId: null` para el superadmin, no `null`
  (`session.ts:66-104`), así que la guarda de :151 solo pega sin sesión.
  `traerTodo` (`pg.ts:171-174`) lanza `LecturaIncompleta` en vez de devolver una
  lista corta. El residual es el MEDIO de los KPI.
- **`avisarConfiguracionSilenciosa`** (`arranque.ts:53-92`) tiene consumidor real
  (`instrumentation.ts:22`) y emite nombres, nunca valores.

---

## Lo que NO alcancé a revisar

- **Si las variables de passcode siguen en Vercel** (abierto de la ronda 13). No
  hay acceso a `vercel env ls` desde aquí. Lo que sí verifiqué es el lado del
  repo: `deploy-vercel.sh:38-39` las salta explícitamente, `arranque.ts:20-31`
  documenta su muerte y `grep -rn "DASHBOARD_PASSCODE\|DASHBOARD_SECRET" src/`
  → 0 resultados. **Queda REINCIDENTE hasta que alguien corra
  `vercel env ls production` y lo pegue.**
- **Si Vercel evalúa el `ignoreCommand` en un "Redeploy" del panel.** Si lo
  evalúa, la salida de emergencia que documentan `CLAUDE.md` y `DEPLOY.md:182`
  no funciona: `git log -1` sobre el mismo commit devuelve el mismo asunto sin
  bandera. No pude comprobarlo sin la cuenta.
- **Si `maxDuration = 600` del callback de QStash es válido en el plan actual.**
  `deploy-vercel.sh:52-55` deja abierto si el proyecto es Hobby o Pro+Fluid; con
  el tope del plan por debajo, el callback muere antes de terminar el lote.
- **Retención real de los runtime logs de Vercel** y si hace falta un log drain
  — lo mismo que `DEPLOY.md:152-153` deja anotado como pendiente.
- **`/api/demo`** devuelve `envHealth()` sin autenticación
  (`api/demo/route.ts:9`). Son booleanos, no valores, pero es inventario de
  configuración expuesto — lo dejo señalado para el rubro de seguridad.
