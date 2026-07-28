# Operabilidad y DX — auditoría 5

**Nota: 5/10** (antes 6). Razón: el 6 anterior era un "no auditado esta ronda", no
una nota ganada. Mirado de verdad y contra producción, esta ronda **sí atacó el
rubro** —`fc760c3` (log de éxito en los envíos) y `c7f1424` (red ≠ esquema) son
dos arreglos correctos y bien razonados, y el CI es sólido— pero las dos lecciones
que salieron de producción se aplicaron **en el sitio exacto donde dolieron y en
ningún otro**, y la pregunta que ordena el rubro sigue mal contestada.

**El riesgo mayor hoy:** si esto revienta a las 3 de la mañana, lo que queda a la
mañana siguiente es una línea de log **anónima** —el redactor de PII convierte
`tenant`, `viaje`, `operador` y `gasto` en `[UUID]`— en un stream que **nadie
recibe**, porque `SENTRY_DSN` no está puesto en el proyecto de Vercel. Verificado
ejecutando el logger real y listando las variables de producción, abajo.

---

## Hallazgos

### [CRÍTICO] El redactor de PII borra todos los identificadores del camino del dinero

`src/lib/logger.ts:10` · `src/lib/logger.ts:15` · consumidores en
`src/lib/cuadra/processor.ts:603`, `:686`, `src/lib/cuadra/tools.ts:135`

**Escenario.** `redact()` serializa el objeto `meta` entero a JSON y le pasa
`UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi`.
Esa expresión está pensada para el UUID de un CFDI — que es un UUID v4. Los ids
de fila de Postgres (`tenant.id`, `viaje.id`, `gasto.id`, `operador.id`,
`liquidacion.id`) **son exactamente la misma forma**. El regex no puede
distinguirlos, y no lo intenta.

Ejecutado contra el módulo real (`npx tsx`, importando `src/lib/logger`, con las
metas literales que emite el código):

```
{"t":"","level":"error","msg":"agent.fail",
 "meta":{"tenant":"[UUID]","viaje":"[UUID]","operador":"[UUID]","err":"timeout"}}
{"t":"","level":"error","msg":"pdf.no_entregado",
 "meta":{"tenant":"[UUID]","viaje":"[UUID]","pdfGenerado":false,"err":"storage no devolvió URL firmada"}}
{"t":"","level":"warn","msg":"pdf.upload",
 "meta":{"path":"[UUID]/[UUID].pdf","err":"x"}}
```

Los tres sitios que **sí** hacen lo correcto son los tres que quedan inservibles.
`processor.ts:601-602` lleva este comentario:

> «Con tenant y viaje: sin ellos, a las 3am el log dice que algo falló pero no qué
> liquidación, y hay que cruzarlo a mano con la hora.»

Ese comentario describe con precisión lo que el redactor produce dos capas más
abajo. El autor identificó el problema, escribió el arreglo, y una función que
está entre medias lo deshace.

**Consecuencia.** No existe forma de reconstruir un fallo. El único identificador
que sobrevive es el `waMessageId` de Meta (`processInbound.fail`, `wa.sendText.ok`),
y **no lleva a ningún lado**: `wa_mensaje_procesado`
(`supabase/migrations/0002_idempotency.sql:5`) guarda `wa_message_id` y
`created_at`, nada más — ni tenant, ni viaje, ni operador. El wamid no se puede
cruzar contra la base. Y las líneas van con `t: ''`
(`logger.ts:32`), así que tampoco traen hora propia. Un fallo de PDF del contralor
Innovativos y uno de otra flota producen **la misma línea, carácter por carácter**.

**Causa raíz.** Una sola función redacta dos cosas que no son la misma: el dato
personal que hay que ocultar y la llave primaria que hay que conservar. Se eligió
una sola forma —el regex de UUID— para las dos.

Nota que refuerza el diagnóstico: el regex está mal calibrado **en los dos
sentidos**. `logger.warn('wa.ratelimit', { from })` en
`src/app/api/webhook/whatsapp/route.ts:60` emite
`"from":"5219993700779"` **sin redactar** (medido en la misma corrida): el
`wa_id` mexicano tiene 13 dígitos y no cabe en `\b\+?52\d{10}\b` ni en
`\b\d{10}\b`. O sea que la función borra el identificador que sirve para operar y
deja pasar el teléfono que existe para proteger. Ese segundo medio es del rubro
de seguridad; lo apunto porque comparte la causa.

**Y el suite lo bendice.** `src/lib/observability/sentry.test.ts:37-49` prueba que
la redacción funciona usando un UUID con forma de CFDI, y
`sentry.test.ts:23` pasa `{ viaje: 'v1' }` — un id corto que ningún regex toca.
Ninguna prueba comprueba que un identificador de fila sobreviva. 628 pruebas en
verde con esto vivo.

---

### [CRÍTICO] No hay observabilidad en producción: `SENTRY_DSN` no existe en Vercel

`src/lib/observability/sentry.ts:34` · `src/lib/logger.ts:39` ·
`src/instrumentation.ts:3` · `DEPLOY.md:36-41`

**Escenario.** `vercel env ls production` sobre el proyecto `likida/likida.ai`
devuelve **17 variables**: `WHATSAPP_*` (5), `NEXT_PUBLIC_APP_URL`, `CUADRA_*` (4),
`DASHBOARD_SECRET`, `DASHBOARD_PASSCODE`, `DEMO_TENANT_ID`, `OPENROUTER_API_KEY`,
`SUPABASE_*` (3). **`SENTRY_DSN` no está.** Por lo tanto `sentryActivo()` devuelve
`false`, la condición de `logger.ts:39` nunca se cumple, y el módulo
`src/lib/observability/` entero —75 líneas y su archivo de pruebas— es **código
muerto en el despliegue que atiende al cliente**.

`DEPLOY.md:36-41` («Variables que deben quedar en Vercel») enumera las que hacen
falta y **no menciona `SENTRY_DSN`**: no es un olvido de configuración, es que el
runbook no lo pide.

**Consecuencia.** El único destino de un `logger.error` es `console.error`, o sea
el stream de runtime logs de Vercel. Eso significa tres cosas a la vez: **nadie
recibe una notificación** (no hay alerta, ni correo, ni Slack, ni PagerDuty — un
`grep -rl` por esos términos en `src/` no devuelve nada), **nadie está mirando** a
las 3 a.m., y **la línea caduca**: los runtime logs de Vercel tienen retención
corta por plan y no hay ningún log drain configurado ni ningún otro sumidero en
el repo. Un fallo del sábado en la madrugada puede no existir el lunes.

**Causa raíz.** El cableado se hizo (logger → sentry) pero el paso que lo enciende
—una variable en el entorno del despliegue— quedó fuera del runbook, y no hay
ninguna verificación de arranque que lo note: `verificarEntornoCritico()`
(`startup.ts:21`) revisa `DASHBOARD_SECRET` y nada más. El sistema arranca en
producción sin observabilidad y **no lo dice**.

**Y ojo con el arreglo obvio.** Poner `SENTRY_DSN` no cierra esto:

1. Lo que llega a Sentry es `redactado` (`logger.ts:31,40`) — el mismo `[UUID]`
   del hallazgo anterior. Alertas anónimas.
2. `reportar()` (`sentry.ts:68-76`) hace `void intento.then(...)` y **nunca llama
   a `flush()`** (`command grep -rn "flush" src/` → cero resultados). En Vercel,
   el trabajo corre dentro de `after()` (`route.ts:70`) y la invocación se congela
   al resolverse; el evento que más importa —el último error antes de morir— es
   justo el que tiene menos probabilidad de salir del proceso.
3. Solo se reporta lo que pasa por `logger.error/warn`. No hay `Sentry.init` en
   `src/instrumentation.ts` (que declara, línea 3, «Aquí también se cablearía
   Sentry (ME-9, post-demo)»), no hay export `onRequestError`, y no hay
   `withSentryConfig` en `next.config.ts` — verificado con `command grep`. Una
   excepción no atrapada en un Server Component del panel o en la ruta de export
   no llega nunca.
4. `reportar` solo usa `captureMessage`; `captureException` está declarado en el
   tipo (`sentry.ts:26`) y no se llama en ninguna parte. Cero stack traces.

---

### [CRÍTICO] Las descargas de media de Meta fallan sin dejar una sola línea

`src/lib/meta/client.ts:117` · `:123` · `:137` · `:143`

**Escenario.** `downloadMediaAsDataUrl` y `downloadMediaAsText`:

```ts
if (!meta.ok) return null;   // línea 137 / 117
...
if (!bin.ok) return null;    // línea 143 / 123
```

`logger.warn('wa.downloadMedia', ...)` está **solo en el `catch`** (`:126`, `:148`),
que atrapa excepciones de red y timeout. Un `401` por token de WhatsApp vencido,
un `404` porque el media id de Meta caducó, un `429` por límite de la Graph API:
ninguno lanza. Los cuatro caminos devuelven `null` **en silencio absoluto**.

Del otro lado, `processor.ts:258` responde:

> `'No pude descargar tu foto 😕. ¿Me la reenvías?'`

**Consecuencia.** Es exactamente el fallo del 28-jul con `sendText`, vivo en el
mismo archivo, treinta líneas más abajo del comentario que lo documenta. Con el
token de sistema de Meta vencido —caducan— **todas** las fotos de **todos** los
operadores devuelven `null`; cada uno recibe "¿me la reenvías?", reenvía, vuelve
a fallar, y en los logs no hay **nada**: ni un warn, ni un contador, ni el
`mediaId`. La foto del ticket es el camino del dinero entero. Y el remedio que se
le pide al operador —reenviar— no arregla un token vencido nunca, así que el
bucle no termina solo.

Peor todavía: `downloadMediaAsText` en `processor.ts:394` cae en `xml = null` →
`say('...necesito el *XML* del CFDI...no el PDF')`. El operador mandó el XML
correcto y el producto le dice que mandó un PDF. Diagnóstico invertido, sin
rastro, con la culpa puesta en el usuario.

**Causa raíz.** `res.ok === false` no es una excepción, y el `try/catch` solo
cubre excepciones. La misma confusión "no pude preguntar" ≠ "la respuesta es no"
que `c7f1424` arregló en `startup.ts` — aquí en su forma de "no pude bajar" ≠
"la foto es ilegible".

---

### [ALTO] El costo por liquidación puede ser cero y verse igual que "barato"

`src/lib/cuadra/costos.ts:39-52` · `:57-67` · `:78-82`

**Escenario.**

```ts
try {
  await supabaseAdmin().from('llm_costo').insert({ ... });
} catch (e) {
  logger.warn('costo.registrar', { err: ... });
}
```

`supabase-js` **no lanza** ante un error de la base: resuelve con
`{ data: null, error }`. Todo `repo.ts` lo sabe y desestructura `{ error }` en las
19 funciones que tiene (`repo.ts:18, 26, 46, 69, 112, 165, 214, 237, 246, 273,
283, 340, 362, 393, 427`). `registrarCosto` es la única del camino del dinero que
**no lo hace**: el `catch` solo se dispara si el `fetch` revienta. Un fallo de RLS,
una columna que no existe tras una migración, un `check` violado — todo eso pasa
sin excepción y sin log.

Lo mismo en `vincularCostosALiquidacion` (`:57-67`, con `catch {}` vacío) y en
`getResumenCosto` (`:78-82`), que hace `const { data } = await ...` y **descarta el
`error`**: si la consulta falla, el panel pinta `totalUsd: 0`,
`liquidaciones: 0`, `costoPromedioPorLiquidacion: 0`.

**Consecuencia.** Es la lección de `fc760c3` en su forma más cara: "se registró el
costo" y "el insert lleva semanas rebotando" producen la misma salida —ninguna—
y el panel del contralor muestra $0 en ambos casos. Likida cobra **por
liquidación**: el costo unitario es la cifra que decide si el negocio existe, y
hoy no hay forma de saber si es bajo o si no se está midiendo.

**Causa raíz.** Se asumió que `await` sobre el query builder lanza. En el resto
del repo no se asumió.

---

### [ALTO] `verificarMigracionesCriticas` afirma `ok: true` sin haber probado la 0019

`src/lib/cuadra/startup.ts:93-103`

**Escenario.** El comentario de esas líneas dice, textualmente:

> «Las **dos** migraciones nuevas del camino del dinero. La 0017 hace el merge de
> ocr_extra con claim […]; **la 0019 impide que el mismo CFDI se liquide dos veces**.»

Debajo hay **un** probe: `enriquecer_gasto_codigo` (la 0017). No hay ninguno para
la 0019. Y a continuación, línea 103:

```ts
logger.info('startup.migraciones', { ok: true });
```

Es una afirmación positiva sobre el estado del esquema del camino del dinero, y
cubre una migración que no se comprobó.

**Consecuencia.** Sin la 0019 no existe `uq_gasto_cfdi_uuid`
(`supabase/migrations/0019_gasto_cfdi_uuid_unico.sql:21`). El
`processor.ts:364` depende de que ese índice choque para tratar el duplicado como
benigno:

```ts
if (violaIndice(e, 'uq_gasto_cfdi_uuid')) { logger.info('foto.cfdi_ya_registrado', ...); return; }
```

Sin índice no hay `23505`: `addGasto` inserta la segunda fila y el mismo CFDI de
diésel entra dos veces, con su IVA y su IEPS. El total comprobado infla, el
acreditamiento infla, **y `startup.migraciones ok:true` dice que el esquema está
completo**. Es el diagnóstico invertido que `c7f1424` vino a corregir, con el
signo al revés: allá se afirmaba "falta" sin saber; aquí se afirma "está" sin
preguntar.

Dos problemas menores del mismo bloque, que apunto aquí para no repetirlos:

- Los cuatro probes hacen `return` al primer fallo (`:72`, `:82`, `:91`, `:101`).
  Con 0005 y 0011 faltando, la primera corrida solo reporta 0005; hay que
  arreglar, redesplegar y esperar el siguiente arranque para enterarse de la
  segunda. Una migración por ciclo de despliegue.
- `logger.error('startup.migraciones', ...)` (`:62`) y
  `logger.info('startup.migraciones', {ok:true})` (`:103`) usan **el mismo `msg`**.
  En Sentry, que agrupa por mensaje, el aviso y su desmentido caen en el mismo
  cubo.

---

### [ALTO] El catch más externo del camino del dinero no dice de quién era el mensaje

`src/lib/cuadra/processor.ts:703`

**Escenario.**

```ts
logger.error('processInbound.fail', { id: msg.waMessageId, err: ... });
```

Es el `catch` que envuelve `processInbound` entero: descarga, OCR, base, agente,
PDF. Todo lo inesperado cae aquí. Lleva `waMessageId` y el mensaje de error —**no
lleva `tenantId`, ni `viajeId`, ni `operadorId`**, y los tres están disponibles en
`op` y `viajeId` dentro del mismo `try`.

Cuarenta líneas más arriba, `agent.fail` (`:603`) sí los lleva, con un comentario
que explica por qué. La lección se aplicó al `catch` interior y no al exterior.

**Consecuencia.** El fallo más grave —el que ni siquiera se anticipó— es el que
menos información deja. Y el `waMessageId` no sirve de puente: como en el primer
hallazgo, `wa_mensaje_procesado` no lo relaciona con nada. A la mañana siguiente:
un wamid, un texto de error, cero contexto.

---

### [ALTO] El error boundary del panel tira el único hilo que había

`src/app/dashboard/error.tsx:7`

**Escenario.**

```tsx
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
```

El tipo declara `error: Error` y la desestructuración **se queda solo con `reset`**.
Next.js entrega en ese `error` un `digest`: el hash que correlaciona lo que el
usuario vio con la línea del log del servidor. Se descarta. No se pinta, no se
reporta, no se registra. Y no existe `global-error.tsx`
(`find src/app -name "global-error.tsx"` → vacío), así que un fallo en el layout
raíz cae al default de Next.

**Consecuencia.** Escenario del 6 de agosto: el contralor abre el panel en la
sala, ve *"No se pudo cargar el panel"*, y no hay nada que preguntarle —ni un
código en pantalla— ni nada que buscar después. `src/app/` no importa el `logger`
en ninguna parte salvo el webhook (`command grep -rln "logger" src/app` → un solo
archivo): las tres superficies web fallan sin registrar.

---

### [ALTO] La ruta de export devuelve el error de Postgres al navegador y no lo registra

`src/app/api/export/liquidaciones/route.ts:27`

```ts
if (error) return new NextResponse(error.message, { status: 500 });
```

**Escenario.** El contralor le da a "Exportar CSV" y le llega el texto crudo de
PostgREST en el cuerpo del 500. Del lado del servidor no queda **ninguna** línea.

**Consecuencia.** El único testigo del fallo es el navegador del cliente, que no
lo guarda. Si el contralor cierra la pestaña, el evento no existió. Y de paso el
mensaje puede llevar nombres de columna y detalle del esquema hacia afuera —esa
mitad es del rubro de seguridad, pero la causa es la misma línea.

---

### [ALTO] `.env.example` no documenta las dos variables que gobiernan el panel, y `DEPLOY.md` manda leerlo

`.env.example` (completo) · `DEPLOY.md:29` · `DEPLOY.md:36-41` ·
`src/app/dashboard/page.tsx:10` · `src/app/dashboard/[id]/page.tsx:10` ·
`src/app/api/export/liquidaciones/route.ts:10`

**Escenario.** Las variables que el código lee y `.env.example` **no menciona**:

| Variable | Dónde se lee | Qué pasa si falta |
|---|---|---|
| `DASHBOARD_PASSCODE` | `src/app/acceso/page.tsx:24`, `passcode.ts:51-54` | sin passcode, `proxy.ts:22` **no bloquea** `/dashboard` |
| `DEMO_TENANT_ID` | `dashboard/page.tsx:10` y 2 más | cae a `'11111111-1111-1111-1111-111111111111'` |
| `CUADRA_WHATSAPP_MSG_USD` | `costos.ts:13` | usa 0.008 |

Y `DEPLOY.md:32`, en el camino "Alternativa (dashboard)", dice: «pega las envs de
`.env.example` (con los valores de `.env.local`)». Seguir el runbook al pie de la
letra **deja fuera el passcode del panel y el tenant**. `DEPLOY.md:36-41` sí las
nombra tres líneas más abajo, contradiciéndose consigo mismo.

**Consecuencia.** El `DEMO_TENANT_ID` es el caso de manual del rubro —"una
variable de entorno que falta y el sistema arranca igual, mal"—: el fallback es
el tenant del `seed.sql` (`supabase/seed.sql:25`). Con la variable ausente, el
panel **no falla**: consulta un tenant distinto del que la flota usa y pinta cero
liquidaciones, sin un solo log. En un demo eso se ve como "el producto no guardó
nada". `verificarEntornoCritico()` (`startup.ts:21`) no la revisa; solo revisa
`DASHBOARD_SECRET`.

*(En el despliegue actual las tres están puestas —lo verifiqué—; el hallazgo es
que el procedimiento documentado no las produce y nada avisa si desaparecen.)*

---

### [MEDIO] El validador de entorno que existe no se llama desde ningún lado

`src/lib/env.ts:13`

`requireEnv(group)` lanza con un mensaje claro si falta alguna variable de
`llm`, `whatsapp` o `supabase`. Su propio comentario de cabecera dice «Llamar en
los paths críticos». Verificado con dos búsquedas (`command grep -rn "requireEnv"
src/ scripts/` y `find src -name "*.ts*" | xargs command grep -l`): la **única**
aparición es su definición. Nunca se invoca.

Lo que sí se usa es `envHealth()`, en `src/app/api/demo/route.ts:9`. O sea que el
único chequeo de configuración del despliegue vive colgado del `GET` de la ruta
de demo, cubre tres grupos, y **no mira** `DASHBOARD_SECRET`, `DASHBOARD_PASSCODE`,
`DEMO_TENANT_ID` ni `SENTRY_DSN`, ni dice nada sobre si las migraciones críticas
pasaron. No hay endpoint que conteste "¿está sano el camino del dinero?".

---

### [MEDIO] El plan B documentado para el demo no existe en el código

`.env.example:17-19`

```
# Plan B demo en vivo (llaves directas por si OpenRouter cae):
# ANTHROPIC_API_KEY=
# GOOGLE_API_KEY=
```

`command grep -rn "ANTHROPIC_API_KEY\|GOOGLE_API_KEY" src/` no devuelve nada;
`openrouter.ts:21` solo lee `OPENROUTER_API_KEY`. Si OpenRouter cae durante el
demo, la palanca que el propio repo documenta como salvavidas **no hace nada**, y
descubrirlo cuesta el tiempo de ponerla y redesplegar antes de entender que no
había ruta.

Contraste útil: las palancas `CUADRA_MODEL_*` de las líneas 12-16 del mismo
archivo **sí funcionan** (`models.ts:47-58`, `modelFor` lee
`process.env[ENV_KEY[role]]`). Que unas sirvan y otras no, en el mismo bloque
comentado, es lo que hace peligroso el archivo: no hay forma de saber cuál es
cuál sin abrir el código.

En el mismo archivo hay documentación muerta que confunde el inventario:
`FACTURAPI_KEY`, `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`, `QSTASH_TOKEN` y
`WHATSAPP_BUSINESS_ACCOUNT_ID` no los lee nadie (el README ya declara que se
quitaron esas dependencias), y `SENTRY_DSN` aparece **dos veces** (`:35` y `:57`), con dos
comentarios distintos.

---

### [MEDIO] Los runbooks describen un estado que ya no es el actual

`DEPLOY.md:1-16` · `README.md:44-46`

`DEPLOY.md` sigue escrito como si el deploy estuviera pendiente: «lo único que
falta es tu autenticación de Vercel», «El bloqueo (honesto): No tengo token de
Vercel». El producto lleva horas en `https://likidaai.vercel.app` con 17 env vars
en producción. El documento al que se acude a las 3 a.m. describe un mundo que ya
no existe, y no contiene lo que a esa hora se necesita: dónde están los logs, cómo
se rota el token de WhatsApp, qué mirar primero.

`README.md:44-46` dice que `@sentry/nextjs` sigue «sin usar todavía (a cablear:
hoy no hay observabilidad de errores en producción)» — pero
`src/lib/observability/sentry.ts` sí está cableado a `logger.ts:40`. La conclusión
del README resulta cierta por un motivo distinto del que da (falta el DSN, no el
cable), y esa clase de "acierto por accidente" es la que hace que un documento
deje de leerse.

---

### [BAJO] `npm run setup` no deja el proyecto corriendo en una máquina limpia

`package.json:12` · `scripts/seed.sh:11-15`

`"setup": "npm install && npm run seed"` y `seed.sh` sale con código 1 si no hay
`DATABASE_URL`. En una máquina limpia `npm run setup` **siempre** falla: el
comando que existe para arrancar no arranca. Falla ruidoso y con instrucciones
claras, que es lo correcto, pero el nombre promete otra cosa.

Además `seed.sh` no comprueba que `psql` esté instalado (revienta con
`command not found` en el primer `psql` del bucle), y al terminar deja el trabajo
a medias a propósito: hay que escribir `.env.local` a mano. El último `echo` lo
dice. No hay un solo comando que lleve de repo clonado a `npm run dev` funcionando.

---

### [BAJO] Hueco en la numeración de migraciones

`supabase/migrations/`

La secuencia va `0021_liquidacion_litros_diesel.sql` → `0023_indice_acumulado_combustible.sql`.
**No hay `0022`**, y `git log --all -- 'supabase/migrations/0022*'` no devuelve
nada: nunca estuvo versionada. Son 22 archivos, no los 23 que dice el MAPA.

`seed.sh:19-22` aplica `supabase/migrations/*.sql` en orden de nombre, así que el
hueco no rompe nada hoy. Lo apunto porque un número faltante es exactamente lo
que se mira cuando hay que decidir si producción y una máquina limpia tienen el
mismo esquema, y esa pregunta se hace a las 3 a.m.

---

## Efectos del camino del dinero que no dejan rastro en éxito

La lección de `fc760c3` —"se envió bien" y "nunca se llamó" se veían idénticos—
aplicada al resto del recorrido. En cada uno de estos, un fallo total del efecto y
un camino que nunca llegó ahí producen **la misma salida en los logs: ninguna**.

**Escrituras del dinero, sin log de éxito:**

- `src/lib/cuadra/repo.ts:80` — `addGasto`. **El insert del gasto.** Es la
  escritura central del producto y no emite una sola línea al lograrlo. Lo único
  que se ve son los caminos raros (`foto.dedup`, `foto.cfdi_ya_registrado`). "El
  ticket de $1,050 se registró" y "la foto nunca llegó a `addGasto`" son
  indistinguibles.
- `src/lib/cuadra/repo.ts:314` — `saveLiquidacion`. **El cierre del viaje.** Sin
  línea propia; solo se infiere de `agent.run` (`processor.ts:552`), que lista
  nombres de tools y no el `liquidacion_id`.
- `src/lib/cuadra/repo.ts:137` — `updateGastoCfdiXml`. Reescribe **monto, fecha,
  UUID y RFC** de un gasto con los del CFDI (`:150`: «El monto del CFDI gana»).
  Solo hay `xml.pegado_a_ticket` (`processor.ts:420`) en la rama `eraTicket`; el
  otro camino sobrescribe dinero en silencio.
- `src/lib/cuadra/tools.ts:131-136` — `subir()`, el upload del PDF a storage.
  Devuelve el path o `undefined` sin log de éxito; el `pdf.upload` del fallo es
  `warn`, y su único identificador (`path`) sale redactado a `[UUID]/[UUID].pdf`.
- `src/lib/cuadra/costos.ts:39` y `:57` — `registrarCosto` y
  `vincularCostosALiquidacion`. Ni éxito ni fallo (ver hallazgo ALTO arriba).
- `src/lib/cuadra/conv.ts:171` — `saveConversation`. **No desestructura `error`
  siquiera.** Si el estado de la conversación no se guarda, el turno siguiente
  parte de un historial viejo y nadie se entera.
- `src/lib/cuadra/repo.ts:124-133` — `gastoExistePorHash`: `if (error) return
  false;`. Con la lectura rota, el dedup queda apagado en silencio y entran
  duplicados.

**Fallos sin identificador suficiente para reconstruir:**

- `src/lib/meta/client.ts:75` y `:103` — `wa.sendText` / `wa.sendDocument` logean
  `{ status, body }`. **Sin `to`, sin `viaje`, sin `tenant`.** Se sabe que un
  envío rebotó; no a quién ni de qué liquidación. Y el log de éxito que se añadió
  hoy (`:80`, `:107`) lleva solo el wamid, así que tampoco se puede cruzar
  "salió" con "para qué viaje".
- `src/lib/cuadra/repo.ts:14-19` — `saveCfdiXmlRaw`: `logger.warn('cfdi_xml.save',
  { err })`, **sin `cfdiUuid`, sin `tenantId`, sin `gastoId`**. Es la conservación
  del XML que exige el CFF art. 30 durante cinco años. Cuando falle, no habrá
  forma de saber qué comprobante quedó sin conservar.
- `src/lib/cuadra/tools.ts:141` — `pdf.gen`: solo `err`. Sin tenant ni viaje. Es
  el paso 3 del guion del demo.
- `src/lib/cuadra/costos.ts:51` — `costo.registrar`: solo `err`. Sin tenant, sin
  viaje, sin fase, sin modelo, sin monto.

**Efecto contable sobre un envío que pudo no ocurrir:**

- `src/lib/cuadra/processor.ts:237` y `:682` — `registrarCostoWhatsApp` se llama
  **después** de `sendText`/`sendDocument`, que no lanzan cuando Meta rechaza
  (`client.ts:75`, `:103`, ambos hacen `return`). Se cobra el mensaje en
  `llm_costo` aunque el operador no haya recibido nada. `say()` (`:235-238`) tiene
  esa forma en **todo** el `processor`.
- `src/lib/cuadra/processor.ts:698` — `saveConversation` guarda el turno del
  asistente como entregado por el mismo motivo. La base afirma que se le dijo algo
  al operador que el operador nunca leyó.

---

## Lo que revisé y está bien

- **El CI (`.github/workflows/ci.yml`) es lo mejor del rubro.** Cuatro puertas
  (typecheck, lint, test, build) en ese orden y por esa razón, `npm ci` en vez de
  `npm install` con la justificación escrita, `concurrency` con
  `cancel-in-progress`, `timeout-minutes: 15`, y el build al final con env de
  relleno explicando por qué. El comentario de cabecera documenta que la suite es
  offline a propósito y que por eso el CI no necesita secretos. No le encontré
  nada.
- **`c7f1424` cerró bien lo suyo.** `sinRespuesta()` (`startup.ts:48-51`)
  distingue por la presencia de `error.code` —PostgREST contesta con `PGRST202` o
  `42883`, un `TypeError: fetch failed` no trae código— y `reportarProbe()`
  concentra la decisión en un solo sitio. El razonamiento del comentario
  (`:30-47`) es correcto y la implementación lo cumple. El mismo criterio está en
  `conv.ts:187-189` (`rpcAusente`).
- **`fc760c3` es correcto donde se aplicó.** El wamid es la llave para preguntarle
  a Meta después, y `idDeRespuesta()` está envuelto en `try/catch` para que
  parsear la respuesta no pueda romper un envío que ya salió.
- **La densidad de instrumentación del `processor` es alta y deliberada.** Los
  caminos raros están cubiertos con el nivel correcto y el comentario que explica
  por qué es ese nivel: `foto.pendiente_reclamado_sin_pegar` es `error` y no
  `info` porque se pierde el folio que la oficina teclea (`:88`);
  `foto.acercamiento_ya_tenia` es `info` porque el claim hizo su trabajo (`:338`);
  `agente.sin_presupuesto` (`:517`) lleva `gastadoMs` y `restanteMs`, que es
  justo lo que hace falta para entender un corte por reloj.
- **`pdf.no_entregado` (`processor.ts:686`) tiene la forma correcta**: distingue
  `pdfGenerado=false` de "el storage no dio URL", explica en el comentario por qué
  es ruidoso, y **además le avisa al operador** en vez de dejarlo esperando.
  Es la respuesta bien contestada a "¿qué ve el humano?". Lo único que le falta es
  que sus identificadores sobrevivan al redactor.
- **La observabilidad no puede tumbar una liquidación**, y eso está probado:
  `sentry.ts:54-59` atrapa el fallo de init y avisa por `console.error` en vez de
  por `logger` (que llamaría de vuelta al mismo módulo — la recursión está vista);
  `reportar` no bloquea el turno; `sentry.test.ts:23-30` fija que un DSN basura no
  lanza. El diseño es bueno; lo que falta es que esté encendido.
- **La suite corre offline y es reproducible.** Los arneses que gastan dinero
  (`*.prueba.ts`, `arnes_ticket_real`) están fuera del include de vitest y detrás
  de `TICKET_PATH`. Un desarrollador nuevo puede correr `npm test` sin llaves y
  sin costo.
- **`seed.sh` es honesto:** `set -euo pipefail`, marca con 🔴 los valores
  inventados, y el fallo del bucket no aborta pero deja la instrucción manual.
- **Los flags de comportamiento están documentados con su razón** en
  `.env.example:41-47`, y los cuatro están efectivamente puestos en producción
  (verificado).

---

## Lo que NO alcancé a revisar

- **La retención real de los runtime logs del proyecto en Vercel.** Sé que no hay
  log drain configurado en el repo ni ningún otro sumidero, y que el plan del
  equipo es `pro` (`route.ts:20`). No confirmé el número exacto de días que Vercel
  conserva la vista de logs en ese plan ni si hay Observability Plus contratado.
  El hallazgo no depende de la cifra —no hay alerta, y eso ya basta— pero la
  ventana concreta importa para decidir si hace falta un drain antes del 6.
- **Si Sentry pierde de verdad los eventos emitidos dentro de `after()`.**
  Razoné el mecanismo (sin `flush()`, invocación congelada al resolver) y es la
  recomendación explícita de Sentry para serverless, pero no lo medí: habría hecho
  falta un DSN real y disparar un error contra producción.
- **Qué pasa con `instrumentation.register()` en frío.** Corre cuatro RPCs
  secuenciales a Supabase antes de servir la primera petición de cada instancia
  nueva. No medí cuánto le añade al peor caso del webhook — se lo dejo al rubro de
  rendimiento, que tiene el presupuesto sumado.
- **Los flujos de operación que no son código:** rotación del token de WhatsApp
  (que caduca y es el detonante del hallazgo CRÍTICO de descargas), quién recibe
  qué cuando algo falla, y qué se hace con una liquidación cerrada cuyo PDF no
  salió. Nada de eso está escrito en el repo, y no es un hueco de código.
- **`src/app/(admin)/` y `(portal)/`.** Revisé el manejo de errores de
  `dashboard/`, `acceso/` y las tres rutas de `api/`; las otras superficies solo
  las verifiqué por ausencia de `logger` (`command grep -rln "logger" src/app`
  devuelve un solo archivo), no leyéndolas.
