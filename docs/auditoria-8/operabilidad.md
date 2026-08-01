# Operabilidad y DX — auditoría 8

**Nota: 7/10** (antes 4). Razón del movimiento: **se atacó y subió**. Los dos
CRÍTICOS de la ronda 6 están cerrados y verificados por mí contra el código:
`getConfig` ya desestructura `error` y lanza `ConsultaFallida`
(`src/lib/cuadra/config.ts:176-181`), y el `after()` del webhook ya llama a
`flushObservabilidad` (`src/app/api/webhook/whatsapp/route.ts:90`, con tres
pruebas que miran el cable en `route_cableado.test.ts:201-226`). El hueco de CI
de `cb392f5` está cerrado y —lo que vale más— atado con una red estructural que
falla si vuelve a abrirse (`.github/workflows/ci.yml:75-76` +
`src/lib/cuadra/pruebas_en_ci.test.ts:57-72`). Ya no es cierto que un fallo en
producción sea invisible, y por eso la nota sale del 4.

No llega a 8 porque el ancla pide que **cada** fallo del camino del dinero
genere alerta con identificador suficiente, y hoy hay tres cortes medidos: un
tramo del camino a Sentry que pierde la carrera contra el congelamiento, una
superficie del camino del dinero (`wa.no_entregado`) que no tiene ninguna
llamada a flush, y cinco fallos que se registran sin decir de qué viaje son.

**Riesgo mayor del rubro, hoy:** el evento que avisa de que el PDF de una
liquidación cerrada NO llegó al operador —`wa.no_entregado`, el log que existe
porque eso ya pasó el 28-jul— entra por el único camino del webhook que nunca
registra un `after()`, así que nada espera a que salga hacia Sentry.

---

## El camino de un error hasta Sentry

Recorrido punto por punto, no leído del commit. `94d0174` («Sentry vivo y
verificado de punta a punta») **toca un solo archivo: `docs/HANDOFF.md`, +28/−2**
— es un cambio de infraestructura y de documento, cero código. Lo que prueba su
evidencia (`startup.config_silenciosa` → issue LIKIDAAI-1) es el tramo del
arranque; los otros dos tramos no los prueba.

**Tramo 0 — ¿hay DSN?** `sentry.ts:43-45` (`sentryActivo`) y `logger.ts:148`
leen `process.env.SENTRY_DSN`. No puedo verificar Vercel desde esta máquina (no
hay credenciales); tomo por bueno lo que dice `docs/HANDOFF.md:264-269` con la
línea real del arranque. **No se corta aquí** — y esto es lo que de verdad
cambió esta ronda.

**Tramo 1 — el error se emite.** `processor.ts:913-927` (`processInbound.fail` /
`consulta_fallida` / `operador_ambiguo`) lleva `id` del wamid, `tenant`, `viaje`
y `cerroSinEntregar`. `processor.ts:767` (`agent.fail`) lleva tenant, viaje y
operador. `processor.ts:887` (`pdf.no_entregado`) lleva tenant, viaje y
`pdfGenerado`. Identificadores suficientes: el UUID sale huellado
(`logger.ts:82-90`) y `DEPLOY.md:21-32` explica cómo cruzarlo contra la base.
**No se corta.**

**Tramo 2 — logger → módulo de Sentry.** `logger.ts:148-150`:

```ts
if ((level === 'error' || level === 'warn') && process.env.SENTRY_DSN) {
  void import('./observability/sentry').then((s) => s.reportar(level, msg, redactado));
}
```

Un `import()` dinámico, sin `await` y sin que nadie guarde la promesa. `reportar`
(`sentry.ts:154-165`) solo entra en `enVuelo` (`sentry.ts:115-118`) **después**
de que ese import resuelve. **Aquí es donde se corta**, y con qué margen está
medido abajo (hallazgo ALTO nº 2).

**Tramo 3 — el flush.** `flushObservabilidad` (`sentry.ts:129-135`) hace
`await Promise.allSettled([...enVuelo])`: una **foto** del conjunto en el
instante en que se llama. Solo se invoca desde dos sitios de producción
(`command grep -rn "flushObservabilidad" src/` descartando pruebas):
`route.ts:90` y `instrumentation.ts:82`.

**Dónde queda cada superficie:**

| Superficie | ¿Llega a `flushObservabilidad`? |
|---|---|
| `processInbound` y todo lo que cuelga de él | Sí — `route.ts:90`, y con muchos `await` de por medio (`releaseMessageClaim`, `sendText`) que le dan tiempo al import del tramo 2 |
| `wa.no_entregado` / `wa.estado` (`route.ts:108-120`) | **No.** Corren en el POST, y si el payload es solo de acuses `permitidos.length === 0` → `route.ts:70` nunca registra el `after()` |
| `wa.ratelimit` (`route.ts:61`) | Mismo caso |
| Excepción no atrapada de Server Component o route handler | Sí — `instrumentation.ts:82` |
| Error **atrapado** en una ruta de API (`export.liquidaciones`, `export.pdf.lectura`, `export.pdf.firma`) | **No.** `onRequestError` solo ve lo no atrapado; estas rutas devuelven 500/502 por su cuenta |
| Diagnósticos del arranque (`register()`, `instrumentation.ts:10-34`) | **No.** Ningún flush, y ningún try/catch |

---

## Hallazgos

### [ALTO] El aviso de que el PDF no llegó al operador no tiene ningún camino a Sentry

`src/app/api/webhook/whatsapp/route.ts:70` · `route.ts:108-122` ·
`src/app/api/webhook/acuses.test.ts:75-78`

**Escenario.** Meta entrega los acuses de entrega en `value.statuses`, en un POST
propio y sin `value.messages` — es lo que fija la prueba existente
`acuses.test.ts:75-78`, que espera `{ received: 0, estados: 1 }`. Entra este
cuerpo:

```json
{"entry":[{"changes":[{"value":{"statuses":[
  {"id":"wamid.PDF123","status":"failed","recipient_id":"5219993700779",
   "errors":[{"code":131026,"title":"Message undeliverable"}]}]}}]}]}
```

`extractMessages` devuelve `[]` → `permitidos.length` es `0` → **`route.ts:70`
no registra ningún `after()`** → `flushObservabilidad()` no se llama en toda la
invocación. `route.ts:111` emite `logger.error('wa.no_entregado', { id:
'wamid.PDF123', para: '[TEL]', codigo: 131026, ... })`, que dispara el
`void import(...)` del tramo 2, y dos líneas después `route.ts:122` devuelve la
respuesta. La invocación termina con el envío a Sentry sin encolar siquiera.

**Consecuencia.** Es exactamente el incidente del 28-jul-2026 que este código
existe para cubrir, y que el propio comentario de `route.ts:99-104` narra: una
liquidación cerró, el PDF se generó y subió a storage, y el operador no lo
recibió; se perdieron veinte minutos reconstruyéndolo a mano. Hoy la línea se
escribe en el runtime log de Vercel —retención corta, sin log drain, lo admite
`DEPLOY.md:16-19`— y la alerta que haría que alguien se entere el mismo día es
la que menos probabilidad tiene de salir del proceso. Para el chofer: se queda
sin su comprobante. Para el contralor: una liquidación cerrada sin papel y nadie
avisado.

**Causa raíz probable.** El flush se cableó al `after()` del procesamiento de
mensajes, que es donde la ronda 6 señaló el hueco; la rama de acuses del mismo
archivo no tiene `after()` y quedó fuera del cable.

---

### [ALTO] El salto de `logger` a Sentry es un `import()` sin esperar: `flushObservabilidad` toma la foto siete ticks antes de que haya algo que ver

`src/lib/logger.ts:148-150` · `src/lib/observability/sentry.ts:115-118` ·
`sentry.ts:129-135` · `src/app/api/webhook/whatsapp/route.ts:72-90`

**Escenario, medido.** Reproduje en Node 22 (ESM) la forma exacta de
`route.ts:72-90` con un módulo ya cargado estáticamente —igual que `route.ts:7`
importa `sentry.ts`— contando ticks de microtarea:

```
{"log":2,"flush":4,"vio":0,"reportar":11}
```

Es decir: `logger.error` corre en el tick 2 y lanza el `import()`;
`flushObservabilidad` hace su `[...enVuelo]` en el tick 4 y ve **cero** envíos
en vuelo; `reportar()` —y con él el `captureMessage`— no se ejecuta hasta el
tick 11, siete ticks después de que el flush ya devolvió y el callback de
`after()` ya resolvió. Un `import()` de módulo **ya cacheado** cuesta 9 ticks en
Node; el camino `catch → Promise.all → await` da 2.

El caso concreto en producción es `route.ts:74`: si `processInbound(m)` rechaza
(el `finally` de `releaseViajeLock`, o cualquier cosa antes de su try), el
manejador hace `logger.error('processInbound', { err: 'lock: fetch failed' })` y
**no queda un solo `await` más** antes del `flushObservabilidad()` de la línea 90.

**Refutación que sí encontré, y su límite.** Cuando el `logger.error` ocurre
dentro de `processInbound` —el caso mayoritario— quedan `await` de red por
delante (`releaseMessageClaim`, `sendText` en `processor.ts:928-936`) y el
import termina a tiempo. Y si otro evento entró antes en la misma invocación,
`flushObservabilidad` se queda esperándolo y de rebote le da tiempo al segundo.
O sea: **no es una pérdida garantizada, es una carrera que nada ordena** — y el
comentario de `sentry.ts:120-127` dice explícitamente que esta función existe
para no depender de esa carrera. La garantía que promete no la tiene.

**Consecuencia.** El mecanismo que la ronda 6 marcó como «construido y sin
cablear» está ahora cableado a la función equivocada: espera un conjunto que en
el peor caso —el último error antes de morir, justo el que el comentario dice
proteger— todavía está vacío. Para quien mantenga esto a las 3 a.m.: eventos que
faltan sin patrón aparente en Sentry, y ninguna forma de saber cuáles.

**Causa raíz probable.** `logger.emit` desprende la promesa del `import()`
dinámico en vez de meterla al mismo `enVuelo` que `reportar` alimenta; el
registro empieza un paso demasiado tarde.

**Verificado que no hay prueba que lo atrape.** `reportar.test.ts:44-89` llama a
`reportar()` directamente, nunca a través de `logger.error`;
`route_cableado.test.ts:38-39` mockea `@/lib/observability/sentry` entero, así
que prueba que el cable existe pero no que llegue corriente por él.

---

### [ALTO] Cinco fallos del camino del dinero se registran sin decir de qué viaje ni de qué flota son

`src/lib/cuadra/repo.ts:79` · `repo.ts:58` · `src/lib/cuadra/processor.ts:450` ·
`processor.ts:424` · `processor.ts:95`

**Escenario.** El más limpio es `repo.ts:79`. La firma es
`saveCfdiXmlRaw(tenantId, cfdiUuid, gastoId, xml)` —los tres identificadores
están en la mano— y lo que se registra es:

```ts
if (error) logger.warn('cfdi_xml.save', { err: error.message });
```

Entra: el XML del CFDI `A1B2C3D4-…` de un diésel de $2,320 del tenant de
Innovativos, y el insert rebota (`new row violates row-level security policy`).
Sale en el log: `{"msg":"cfdi_xml.save","meta":{"err":"new row violates
row-level security policy for table \"cfdi_xml\""}}`. El XML crudo que el CFF
art. 30 obliga a conservar cinco años no está, y la línea no dice de qué CFDI ni
de qué flota.

Los otros cuatro, con la misma forma:

- `processor.ts:450` `foto.acercamiento_error` — solo `err`. **La línea de éxito
  cuatro renglones arriba (`processor.ts:443`) sí lleva `{ viaje, gasto }`.** Su
  propio comentario dice «se pierde el folio del acercamiento (grave, por eso
  ERROR)»: ese folio es el que la oficina teclea en el portal de la gasolinera
  para bajar la factura.
- `processor.ts:424` `foto.codigo_en_espera_error` — solo `err`; su gemela de
  éxito (`processor.ts:419`) lleva `{ viaje, monto }`.
- `processor.ts:95` `foto.pendiente_error` — solo `err`; las tres líneas de la
  misma función (`processor.ts:76, 90, 93`) llevan `{ viaje, gasto }`.
- `repo.ts:58` `supabase.tope_agotado` — lleva `{ consulta: 'saveLiquidacion',
  topeMs: 8000 }` y ni tenant ni viaje. Dice que **una** liquidación se rindió a
  los 8 s, no cuál.

**Consecuencia.** Es literalmente el modo de falla que este rubro nombra: un log
de fallo que no dice cuál liquidación falló. Con Sentry vivo, además, agrupa
todos los `foto.acercamiento_error` de todas las flotas en un solo issue sin nada
que los separe: quien lo abra a la mañana siguiente ve «12 eventos» y ni un
identificador con el que ir a la base. Para el contralor: una factura que no se
puede bajar del portal y ninguna forma de saber cuál gasto se quedó sin folio.

**Causa raíz probable.** El `catch` se escribió pensando en no tumbar el
procesamiento —que es lo correcto— y se olvidó de copiar al `meta` los mismos
identificadores que la rama de éxito de al lado ya pone.

---

### [MEDIO] Los diagnósticos del arranque no tienen flush, y el propio equipo ya midió que no dejan rastro

`src/instrumentation.ts:10-34` · `src/lib/cuadra/startup.ts:196` ·
`docs/HANDOFF.md:280-291`

**Escenario.** `register()` emite por `logger` los avisos de mayor valor del
producto: `startup.observabilidad`, `startup.config_silenciosa`,
`startup.entorno_grupos`, `startup.migraciones` y `startup.aviso_privacidad`.
Ninguno de esos `logger.error` se espera: `register()` no llama a
`flushObservabilidad()` en ningún punto (`onRequestError`, veinte líneas más
abajo, sí lo hace en `instrumentation.ts:82` y explica por qué). Tampoco hay
try/catch alrededor de las líneas 16-33, así que si el `await
import('@/lib/cuadra/startup')` de la línea 26 falla, las dos verificaciones
siguientes no corren y no queda una línea que lo diga.

Y el síntoma ya está medido, por el propio autor, en `docs/HANDOFF.md:280-291`:
`verificarMigracionesCriticas()` y `verificarAvisoDePrivacidad()` **no dejan
rastro en `vercel logs`**, aunque las tres líneas de arranque anteriores sí
salen. Concretamente: si mañana un despliegue apunta a una base sin la migración
0019, `startup.ts:154` emitiría «FALTA el índice `uq_gasto_cfdi_uuid`: el mismo
CFDI se liquida dos veces, con su IVA acreditado por duplicado» — al mismo sitio
donde hoy desaparece su `ok:true` (`startup.ts:196`).

**Consecuencia.** El único chequeo automático del esquema del camino del dinero
no tiene salida observable comprobada. `HANDOFF.md:288-290` concluye «ahora que
Sentry existe, un fallo real de ese chequeo sí tendría destino»: esa afirmación
no está probada por nada, y el código dice que el envío es fire-and-forget sin
nadie que lo espere.

**Causa raíz probable.** El arranque se instrumentó antes de que existiera
`flushObservabilidad` y no se le añadió el `await` que sí recibieron
`onRequestError` y el `after()` del webhook.

---

### [MEDIO · REINCIDENTE] El sondeo de la migración 0022 sigue siendo el único de los siete que no distingue «no se pudo preguntar»

`src/lib/cuadra/startup.ts:184-195` (era `startup.ts:134-145` en la ronda 6)

**Escenario.** Los otros sondeos del archivo (0005, 0011, 0031, 0016, 0017,
índices, 0033) pasan su error por `reportarProbe` (`startup.ts:54-63`), que
primero pregunta `sinRespuesta(error)` y emite
`startup.migraciones_sin_verificar` como `warn` si la base no contestó. El de la
0022 no:

```ts
if (e22 && (e22.code === '42725' || /is not unique|no es única/i.test(e22.message ?? ''))) { ... }
```

Entra: un `TypeError: fetch failed` intermitente que cae justo en este sondeo
(`e22.code` vacío). Sale: la condición es falsa, no se emite **ninguna** línea
para este sondeo, ni error ni el `warn` de «no se pudo verificar» que tienen los
otros siete. Si el resto respondió bien, `startup.ts:196` remata con
`startup.migraciones { ok: true }`.

**Consecuencia.** Sin la 0022, `guardar_liquidacion_tx` existe con dos firmas y
**ninguna liquidación puede cerrar** — lo dice el propio mensaje de la línea 191.
Un arranque que reporta `ok:true` habiendo fallado en preguntar por eso es el
diagnóstico falso que `startup.ts:34-46` describe como el que enseña a ignorar
los avisos. Es el mismo hallazgo de la ronda 6, en las mismas líneas, con el
archivo tocado desde entonces (se le añadieron los sondeos de 0031 y 0033, los
dos por el camino correcto).

**Causa raíz probable.** La tolerancia deliberada a los muchos errores esperados
de llamar la función con datos basura se tragó también el caso «no hubo
respuesta».

---

### [MEDIO · REINCIDENTE] `saveConversation` sigue sin mirar el `error` de Supabase — tercera ronda igual

`src/lib/cuadra/conv.ts:227-232`, llamada desde `src/lib/cuadra/processor.ts:898`

**Escenario.** Línea por línea, sin cambios desde la ronda 5:

```ts
export async function saveConversation(convId: string, turns: ConvTurn[], viajeId: string | null): Promise<void> {
  await supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: { turns: turns.slice(-MAX_TURNS) }, viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('id', convId);
}
```

No se asigna el resultado a nada: ni `data` ni `error`. Entra: el UPDATE rebota
con `{ error: { message: 'canceling statement due to statement timeout' } }`
justo después de cerrar la liquidación del viaje `V`. Sale: `processInbound`
termina normal, el operador ya recibió su PDF, y `wa_conversacion.viaje_id`
sigue apuntando a `V` con el historial del viaje cerrado. Cero líneas de log —
ni éxito ni fallo.

**Consecuencia.** Es el único acceso a datos del repo que ni siquiera
desestructura `error` (`repo.ts` lo hace en las 12 funciones equivalentes). El
efecto visible es acotado —`loadConversation` (`conv.ts:180-183`) detecta el
viaje distinto y descarta el historial, dejando `conv.historial_descartado`—
pero cuando el viaje sigue abierto el turno del asistente simplemente no se
guarda y el siguiente turno parte de un historial viejo, sin que nada lo diga.
Es un error que se traga y devuelve éxito, en el archivo del estado de la
conversación.

**Causa raíz probable.** La misma que las cinco apariciones del patrón que el
MAPA lista: `supabase-js` no lanza, devuelve el error por valor, y aquí no se
recoge.

---

### [MEDIO] El runbook al que se acude a las 3 a.m. no sabe que Sentry existe

`DEPLOY.md:10-19` · `DEPLOY.md:96-101` · `DEPLOY.md:134-140` ·
`src/lib/observability/runbook.test.ts:95-110`

**Escenario.** Entra: son las 3 a.m., alguien abre `DEPLOY.md`. Sale: la lista
numerada «Algo se rompió: qué mirar, en este orden» arranca en `vercel logs` y
**no menciona Sentry en ningún punto** — ni la organización ni el proyecto
(`atiendeai/likidaai`, según `docs/HANDOFF.md:264`), ni cómo se ven los issues.
La tabla de `DEPLOY.md:97` sigue describiendo `SENTRY_DSN` como una variable por
poner. Y la sección «Lo que este runbook NO cubre» (`DEPLOY.md:136-138`) afirma
hoy: *«Quién recibe qué cuando algo falla. Hoy no hay nadie asignado ni ningún
canal: **sin `SENTRY_DSN` no hay a dónde mandarlo**»* — la premisa dejó de ser
cierta el 1-ago y la conclusión (nadie asignado) sigue sin resolverse.

De paso: `DEPLOY.md:3` fija producción en `https://likidaai.vercel.app`,
proyecto `likida/likida.ai`, mientras `93be38a` dejó escrito que hoy `likida.ai`
sirve esta app y que el destino es `app.likida.ai`.

**Consecuencia.** El único documento operativo manda a la fuente de menor
retención («la retención de esa vista es corta y no hay ningún log drain
configurado», `DEPLOY.md:16-19`) y calla la que ahora sí conserva y agrupa. Y
`runbook.test.ts` —la red que existe para que este documento no se quede atrás
del código— solo comprueba que se **mencionen** cuatro nombres de variable y que
aparezca la cadena `vercel logs`; ninguna de sus dos pruebas se entera de que el
destino de las alertas cambió.

**Causa raíz probable.** El cambio de `94d0174` fue de infraestructura y se
anotó en `HANDOFF.md` (documento de traspaso) en vez de en `DEPLOY.md`
(documento de guardia).

---

### [BAJO · REINCIDENTE desde la ronda 5] `npm run setup` sigue sin dejar el proyecto corriendo en una máquina limpia

`package.json:12` · `scripts/seed.sh:10-15` · `README.md:70-75`

**Escenario.** `"setup": "npm install && npm run seed"`. En una máquina limpia
sin `DATABASE_URL`, `seed.sh:11-15` imprime «❌ Falta DATABASE_URL» y sale con
código 1: **el comando que existe para arrancar siempre termina en error**. El
`README.md:70-75` ni siquiera lo nombra —propone `npm install` + `cp .env.example
.env.local` + `npm run dev`—, y ese `.env.local` sale con doce llaves
vacías; en desarrollo `avisarObservabilidad` (`sentry.ts:70-71`) y
`avisarConfiguracionSilenciosa` (`arranque.ts:43-44`) salen temprano a propósito,
así que el arranque local no dice **nada** de lo que falta y el primer síntoma es
`Error: Supabase service-role no configurado` (`src/lib/supabase/admin.ts:13`)
cuando alguien abre el panel. No hay un solo comando que lleve de repo clonado a
algo que corra, y esta ronda el clon de nube llegó otra vez sin `node_modules`
sin nada en el repo que lo bootstrapee (no hay `.claude/settings.json`, ni hook
de arranque, ni devcontainer; solo `.claude/skills/`).

**Consecuencia.** Cuesta minutos, no dinero — pero son tres rondas
(5 → 6 → 8) con el mismo texto, y el rubro dice explícitamente que un `setup`
que no deja el proyecto corriendo en una máquina limpia cuenta aquí.

**Causa raíz probable.** `setup` se definió como «instala y siembra» cuando
sembrar exige una base remota que no todo el mundo tiene; falta el escalón de
«clonar → correr las pruebas».

---

## Lo que revisé y está bien

- **El CRÍTICO nº 1 de la ronda 6 está cerrado de verdad.**
  `src/lib/cuadra/config.ts:176-181`: `getConfig` ahora desestructura `{ data,
  error }` y lanza `ConsultaFallida` en vez de devolver `DEMO_CONFIG` con el RFC
  genérico. El comentario de `config.ts:145-175` documenta el escenario con
  números ($11,600 timbrados a un tercero saliendo «deducible» en verde) y
  `processInbound` (`processor.ts:911, 931-934`) ya traduce `ConsultaFallida` a
  un mensaje que no afirma nada falso.
- **El CRÍTICO nº 2 está cableado donde faltaba.** `route.ts:90` llama a
  `flushObservabilidad()` después del `Promise.all`, con el comentario de
  `route.ts:77-89` explicando el hallazgo, y `route_cableado.test.ts:201-226`
  fija el cable con tres pruebas: que se llama, que se llama **después** de
  procesar, y que un `processInbound` que revienta no lo impide. El hallazgo
  ALTO nº 2 de arriba es un tramo distinto, más abajo.
- **El hueco de CI de `cb392f5` está cerrado y atado.** `ci.yml:75-76` añade
  `npx vitest run fundamento duplicados` sin instrumentar, y
  `src/lib/cuadra/pruebas_en_ci.test.ts:37-72` **descubre por sí sola** qué
  archivos llevan `skipIf(CUADRA_COBERTURA)` recorriendo `src/`, y falla con
  instrucciones si alguno no está cubierto por el paso del workflow. Es la clase
  de red que impide que el hueco vuelva: no enumera los dos archivos de hoy,
  enumera la condición. Además protege que nadie sustituya `test:coverage` por
  `npm test` (línea 77) y que el ayudante de pruebas no entre al bundle de
  producción (línea 83-87).
- **CI corre las cinco puertas en el orden correcto** (`ci.yml:47-90`): `npm ci`
  (no `install`), typecheck, lint, tests con umbral de cobertura, pruebas de
  tiempo, build. `on: push: branches: ['**']` con `concurrency` y
  `cancel-in-progress`, y sin necesidad de secretos.
- **Línea base reproducida en esta máquina:** `npm test` → 127 archivos, 1262
  pruebas, 1 saltada, exit 0. Coincide con lo que declara el MAPA.
- **El huellado sigue siendo el diseño correcto y `DEPLOY.md:21-32` enseña a
  usarlo.** `logger.ts:82-90` (`huellaId`, FNV-1a de 12 hex) y `logger.ts:93-99`
  (una sola pasada, no tres `replace` encadenados) resuelven bien el compromiso
  entre no filtrar y poder reconstruir. `CLAVES_NO_PII` (`logger.ts:122`) exime
  al `digest` de Next, que es el único puente entre lo que el contralor ve en
  pantalla y la línea del servidor.
- **`reportar` separa el aviso de su desmentido.** `sentry.ts:160` mete el nivel
  en el `fingerprint`, así que `startup.migraciones` con `ok:false` y con
  `ok:true` no caen en el mismo cubo de Sentry. Probado en
  `reportar.test.ts:67-81`.
- **Sentry no puede tumbar una liquidación.** `cargar()` (`sentry.ts:78-99`)
  atrapa todo y avisa por `console.error` —no por `logger`, que reentraría—;
  `reportar`, `reportarExcepcion` y `flushObservabilidad` tienen su propio
  `catch` vacío con la razón escrita. `sentry.test.ts` lo prueba contra el
  paquete real, no contra el mock.
- **`reportarExcepcion` redacta por el mismo camino que los logs.**
  `sentry.ts:174-180` (`anonimizar`) pasa mensaje y stack por `redactarTexto`, y
  `reportar.test.ts:105-120` comprueba que el UUID sobrevive como huella y el
  RFC se borra. `sendDefaultPii: false` y `tracesSampleRate: 0` en
  `sentry.ts:87-90`, con el porqué escrito.
- **`onRequestError` sí espera su flush** (`instrumentation.ts:82`) y captura
  ruta, tipo, método, `digest` y error. `instrumentation.test.ts:20-64` lo
  cubre, incluido el caso de argumentos deformes.
- **Las dos rutas de export registran con identificador y no filtran esquema.**
  `export/liquidaciones/route.ts:37-40` y `export/pdf/[id]/route.ts:49-52, 61-67`
  llevan `tenant` (huellado) y `liquidacion`, y devuelven un texto genérico al
  navegador. Solo les falta el flush, que ya está anotado en la tabla de arriba.
- **`.env.example` está atado al código por prueba.** `runbook.test.ts:57-92`
  compara el archivo contra un `grep` real de `process.env.` sobre todo `src/`,
  falla si sobra o falta una variable, si alguna se declara dos veces, o si el
  archivo promete palancas que ningún módulo lee. Verifiqué que hoy pasa.
- **`avisarConfiguracionSilenciosa` (`observability/arranque.ts`) usa un `msg`
  propio por aviso** y nunca emite el valor de la variable, solo el nombre y la
  consecuencia — y `94d0174` demuestra que ese mecanismo funcionó de verdad en
  producción (fue el que produjo el issue LIKIDAAI-1).
- **No hay lectores de disco nuevos que el tracer pueda romper.**
  `command grep -rn "readFileSync\|readFile(\|process.cwd()" src/` sobre el árbol
  de hoy devuelve solo `intake/cfdi.ts:205-220` (el `.wasm` de zxing), que es el
  único caso que `next.config.ts` protege con `outputFileTracingIncludes`. El
  `permisos_cre.json` nuevo (12,625 permisos) entra por import, no por `fs`.
- **`repo.ts:44-69` (`acotada`)** impone el tope de consulta en dos capas
  (`abortSignal` + carrera contra temporizador) y hace entrar el timeout por el
  mismo `{ data: null, error }` que un error de Postgres, para no cambiar la
  semántica de 12 llamadores a la vez. El razonamiento está escrito y es
  correcto; lo único que le falta es el identificador en su línea de log
  (hallazgo ALTO nº 3).

---

## Lo que NO alcancé a revisar

- **`SENTRY_DSN` en Vercel, de primera mano.** No hay credenciales en esta
  máquina y `vercel env ls` no es una opción. Tomo por buena la evidencia de
  `94d0174` / `docs/HANDOFF.md:264-269` (línea real del arranque con
  `"sentry":true`, issue LIKIDAAI-1 capturado y resuelto). Si esa evidencia
  fuera falsa, todo el rubro vuelve a la nota anterior.
- **El comportamiento real del `import()` dinámico bajo el bundler de Next.**
  Medí la carrera del hallazgo ALTO nº 2 en Node 22 ESM, que es el runtime de la
  función. Webpack/Turbopack pueden compilar `import()` a algo más barato
  (`Promise.resolve().then(...)`), lo que reduciría el margen de 7 ticks a 1 o 2
  — seguiría siendo una carrera sin orden garantizado, pero no pude medirla
  porque no puedo correr `npm run build`.
- **Si Vercel congela la invocación lo bastante rápido como para perder el envío
  ya disparado.** El `flush(2000)` de `reportar` es una petición HTTP real que
  puede completarse antes de la suspensión, o quedar pendiente y reanudarse en la
  siguiente invocación de esa misma instancia. No tengo forma de medirlo sin
  producción.
- **Quién recibe la alerta de Sentry.** `DEPLOY.md:136-138` lo declara fuera de
  alcance y no hay nada en el repo que lo defina. No es código, no lo cuento como
  hallazgo propio.
- **La retención real de los runtime logs de Vercel en el plan Pro** y si hace
  falta log drain antes del demo. Sigue sin haber `drain` en ningún archivo
  (`command grep -rn "drain" . --include="*.ts" --include="*.md"` sin resultados
  relevantes); `DEPLOY.md:141-143` ya lo admite.
- **Las superficies `src/app/(admin)/` y `(portal)/`.** Tercera ronda seguida sin
  leerlas completas; `onRequestError` las cubre por construcción, pero no revisé
  si tienen errores atrapados que devuelvan una respuesta sin dejar línea.
- **`analytics.ts`, `costos.ts`, `presupuesto.ts` y el código nuevo de esta ronda
  (`permiso_cre.ts`, `formato.ts`, `intake/voucher`, las páginas de privacidad)
  bajo la lente del patrón «fallo de consulta disfrazado de no hay».** Es trabajo
  del rubro de arquitectura/datos; solo comprobé que ninguno de ellos añade un
  lector de disco ni una superficie de error nueva sin log.
