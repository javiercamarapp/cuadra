# Operabilidad y DX — auditoría 9

Ancla: commit `f34066f6714a142fa22075cd09e5430314341354` (2026-08-01 18:36 -0600).

**Nota: 5/10** (antes 6). Razón del movimiento: mirada más profunda — el
reincidente de `conv.ts` cerró de verdad, pero esta ronda metió el mecanismo
`foto_pendiente` en el camino del dinero sin que el probe de arranque creciera
con él, y el propio mecanismo tiene una vía de pérdida silenciosa de
comprobante que ninguno de los dos logs nuevos alcanza a registrar.

El riesgo mayor hoy: si el trigger `trg_gasto_no_tras_liquidar`/`..._update`
(0036/0037) llegara a faltar en un entorno — el que blinda el peor bug
histórico del repo, PDF y WhatsApp diciendo cifras contrarias — el arranque no
lo dice. `startup.migraciones` se quedó en la migración 0033/0022 y nunca creció
para cubrir 0036-0040.

## Hallazgos

### [CRÍTICO] El probe de arranque no cubre las migraciones 0036-0040 — incluida la que blinda el peor bug histórico del camino del dinero

`src/lib/cuadra/startup.ts:65-199` (`verificarMigracionesCriticas`).

Escenario: la función sondea explícitamente 0005, 0011, 0031, 0016, 0017, los
índices de 0019/0024 (vía `indices_faltantes`), 0033 y detecta el conflicto de
firmas de 0022. Ninguna línea de este archivo sonda 0036, 0037, 0038, 0039 ni
0040 — confirmado con `grep -n "0036\|0037\|0038\|0039\|0040"
src/lib/cuadra/startup.ts`, cero resultados. `0036_no_gastos_tras_liquidar.sql`
es, en palabras de su propio comentario, "Último crítico de código abierto de
las siete rondas de auditoría" — el trigger que impide que un gasto se
inserte (0036) o modifique montos (0037, esta ronda) después de emitida la
liquidación, precisamente para no repetir el bug documentado ahí mismo con
números: PDF dice "Sobró $150.00", WhatsApp seis segundos después dice
"Pusiste $650.00 de tu bolsa" — mismo viaje, signo contrario.

Si en cualquier entorno (un proyecto de Supabase nuevo para el demo, un `db
push` que se corta a la mitad, una branch de Supabase que no heredó las
migraciones más recientes) 0036/0037 no están aplicadas: `addGasto` y
`updateGastoCfdiXml` insertan/actualizan sin que Postgres los rechace —no hay
`CU001`, no hay `llegoTarde()` que lo distinga— y `guardiaCifras`/
`cuadrarDesdeDB` recalculan sobre esos datos exactamente como antes de la
0036. `instrumentation.ts:26-27` confirma que `verificarMigracionesCriticas`
sí corre en cada arranque frío, así que el hueco es real y no teórico: el
arranque completo pasa sin decir nada, `startup.migraciones` emite `{ok:
true}`, y DEPLOY.md:38 le dice a quien esté de guardia que esa línea es "el
esquema del camino del dinero" — promesa que hoy es falsa para el trigger más
importante del archivo.

Confirmé además que no hay ningún otro mecanismo que cubra el hueco:
`supabase/verificaciones.sql` (bloques 20/21, que sí prueban 0037/0038 contra
Postgres real) no corre en CI ni en ningún script (`grep -rn
"verificaciones.sql" DEPLOY.md scripts/*.sh .github/workflows/ci.yml
package.json` → cero resultados) — es SQL que un humano corrió una vez a
mano.

Consecuencia: un fallo en el camino del dinero más caro del repo —cifras
contradictorias entre el PDF que se archiva y el WhatsApp que lee el
operador, delante del contralor si pasa en el demo— sería invisible en el
arranque, exactamente el criterio que hunde la nota a 4 o menos en este
rubro.

Causa raíz probable: el patrón "un `admin.rpc`/`select` de sonda por
migración crítica, con `faltan = true`" existe y es barato de extender —lo
prueban los ocho probes que sí están— pero nadie añadió uno nuevo cuando 0036
se cerró (ronda 8) ni cuando 0037-0040 se agregaron esta ronda; el archivo
creció en migraciones sin que su verificador creciera con él.

### [CRÍTICO] `foto_pendiente` puede perder un comprobante entero sin ningún log que lo diga, en la rama exacta que la auditoría pidió revisar

`src/lib/cuadra/processor.ts:528-541`.

```ts
try {
  const pendiente = await reclamarFotoPendiente(op.tenantId, { viajeId });
  if (pendiente) {
    const dataUrlPendiente = await downloadMediaAsDataUrl(pendiente.mediaId);
    if (dataUrlPendiente) imagenes = [dataUrlPendiente, dataUrl];
  }
} catch (e) {
  logger.warn('foto.pendiente_error', { viaje: viajeId, err: ... });
}
```

`reclamarFotoPendiente` (`repo.ts:490-500`) es un `DELETE ... RETURNING`:
consume la fila de forma irreversible en el momento en que la llamada tiene
éxito, sin importar lo que pase después. `downloadMediaAsDataUrl`
(`src/lib/meta/client.ts:179-198`) **nunca lanza** — atrapa internamente
cualquier fallo (HTTP no-2xx de Meta, timeout, red) y devuelve `null`. Cuando
eso pasa, `dataUrlPendiente` es falsy, el `if` no entra, `imagenes` se queda
como solo la foto actual, y **el `catch` de arriba nunca se ejecuta porque no
hubo excepción**: `foto.pendiente_error` no se emite.

Escenario con valores: operador manda el ticket completo de $850 sin código
visible (viaje V1) → se guarda como `foto_pendiente` (fila con `media_id`
M1). Dos segundos después manda el acercamiento con el código de barras →
esa segunda invocación detecta `tieneCodigoLegible=true`, llama
`reclamarFotoPendiente` y SÍ borra la fila de M1 con éxito. Justo entonces el
token de WhatsApp está vencido o hay un timeout de red: `downloadMediaAsDataUrl(M1)`
devuelve `null` (log `wa.media_no_descargada` en `client.ts:148`, con
`mediaId` pero **sin `viaje` ni `tenantId`** — o, si fue un timeout/excepción
de red en vez de un HTTP no-2xx, el log es `wa.downloadMedia`
(`client.ts:194-197`), que **no lleva ni siquiera el `mediaId`**, solo el
mensaje de error). Mientras tanto, la primera invocación (la que sigue
esperando en `esperarReclamoDeFoto`, `processor.ts:81-93`) sondea
`existeFotoPendiente` justo después del DELETE, lo ve `false`, concluye
"alguien la tomó" y hace `return` sin procesar nada (`processor.ts:564`,
confiando en el comentario "el acercamiento ya procesó el par completo").
Resultado: el ticket de $850 nunca se convierte en un `gasto` — la foto B
sola (un acercamiento a un código, sin monto legible) entra por
`decidirFoto` como `solo_codigo`/`solo_pago`
(`src/lib/cuadra/intake/decidir.ts:74-81`), no encuentra con qué emparejar
—porque el gasto A nunca se creó— y cae a `pedir_ticket`: se le pide al
operador que reenvíe un ticket que YA mandó. Si no lo reenvía (confundido, o
simplemente sigue con el siguiente ticket), el gasto de $850 se pierde de la
liquidación sin que quede una sola línea en los logs que diga qué viaje, qué
tenant o qué comprobante se vio afectado.

Verificado que este camino no está probado:
`src/lib/cuadra/processor_foto_pendiente.test.ts` tiene 7 pruebas del
mecanismo (autorreclamo, reclamo cruzado, fail-open de `guardarFotoPendiente`
y de la espera) pero ninguna cubre `reclamarFotoPendiente` devolviendo una
fila exitosamente Y `downloadMediaAsDataUrl` devolviendo `null` — el `grep`
de `mockResolvedValue(null)` en ese archivo no toca `downloadMediaAsDataUrl`.

Consecuencia: es exactamente el escenario que la propia migración 0038
dice evitar ("nunca se pierde un comprobante por un problema del mecanismo
que intenta ahorrar una visión") pero el fail-open está mal calibrado — falla
abierto hacia "no re-procesar nada" en vez de hacia "procesar la foto sola",
y encima sin dejar rastro con contexto suficiente para reconstruirlo.

Causa raíz probable: el `try/catch` de la línea 533-541 se escribió pensando
en que `reclamarFotoPendiente` es lo único que puede fallar (es lo único que
lanza), pero el fallo real y más probable en este bloque —una descarga de
media que falla, algo ya documentado como frecuente en `DEPLOY.md` (token de
WhatsApp que caduca)— se modeló como valor de retorno (`null`) en vez de
excepción en la capa de abajo, y el código de arriba no distingue "no había
nada pendiente" de "había algo pendiente y se perdió al descargarlo".

### [ALTO] `foto.pendiente_error` es el mismo nombre de log para dos mecanismos distintos, y uno de los dos sitios no lleva NINGÚN identificador

`src/lib/cuadra/processor.ts:104-138` (`pegarCodigoEnEspera`, la bandeja de
**códigos** pendientes, migración 0016, existente desde antes de esta ronda)
vs. `src/lib/cuadra/processor.ts:540,549` (la bandeja de **fotos** pendientes,
migración 0038, nueva esta ronda). Confirmé con `git log -S"'foto.pendiente_error'"`
que el mensaje ya existía en `35849ff` (anterior a la base de la ronda 8) para
la función de códigos, y que el commit `42ac86d` de esta ronda **reutilizó el
mismo string literal** para el mecanismo de fotos, en vez de darle un nombre
propio (p. ej. `foto_pendiente.error` o `foto.espera_error`).

Consecuencia directa para la pregunta que esta ronda pidió verificar
("¿tienen suficiente contexto para reconstruir qué foto se perdió?"): en
Sentry —que agrupa por `msg`, y el propio `sentry.ts` lo dice explícitamente
en su comentario sobre `fingerprint`— un fallo de la bandeja de códigos
(gasto ya insertado, se pierde solo un folio) y un fallo de la bandeja de
fotos (potencialmente un comprobante entero, ver el CRÍTICO anterior) caen en
el mismo cubo de alertas. Y el sitio más viejo (`processor.ts:136-138`) es el
peor de los tres: su función recibe `tenantId`, `viajeId` y `gasto` como
parámetros —los tres están en scope, y las tres líneas vecinas (118, 132,
135) SÍ los usan— pero el `catch` solo registra `{ err }`. Escenario: la
bandeja de códigos falla por un `TypeError: fetch failed` de Supabase a media
liquidación del viaje V7, tenant Innovativos; el log que llega es
`{"msg":"foto.pendiente_error","meta":{"err":"fetch failed"}}` — no hay forma
de saber, ni cruzando con la base, a qué viaje o tenant pertenece esa línea.

Consecuencia: al ingeniero de guardia se le pide, en `logger.ts` y en
`DEPLOY.md:21-28`, cruzar la huella del log contra la base — pero aquí no hay
nada que cruzar. Combinado con el hallazgo anterior, la respuesta a la
pregunta de la ronda es: no, los logs nuevos no tienen contexto suficiente
para reconstruir qué foto se perdió, y en el peor caso (descarga fallida) ni
siquiera se emiten.

Causa raíz probable: reutilizar un string de log existente es más rápido que
inventar uno nuevo y revisar que no colisione; no hay ninguna prueba ni
convención en el repo que impida dos funciones distintas compartiendo `msg`.

## Lo que revisé y está bien

- **`CUADRA_FOTO_PENDIENTE_HOLD_MS` y `CUADRA_FOTO_PENDIENTE_POLL_MS` sí están
  en `.env.example`** (líneas correspondientes al bloque de "Flags de
  comportamiento"), y corrí `npx vitest run
  src/lib/observability/runbook.test.ts` contra el árbol tal como está ahora:
  6/6 verde, incluida la prueba que compara variables leídas por el código
  contra el archivo. El inventario no se atrasó esta ronda.
- **El reincidente de `conv.ts` (ronda 8, ALTO) está genuinamente cerrado.**
  Leí `loadConversation` (`conv.ts:181-211`) completa: ahora desestructura
  `{ data, error }` y lanza `ConsultaFallida` si `error` viene poblado —ya no
  puede confundir un blip de Supabase con "no existe la conversación".
  `saveConversation` (`conv.ts:255-261`) desestructura `error` y lo registra
  como `logger.error('conv.no_se_guardo', ...)`; verifiqué contra el commit
  `01afba0` que la decisión de NO relanzar ahí es explícita y razonada (evitar
  un segundo mensaje "se me trabó" sobre una respuesta que ya se entregó), no
  un descuido.
- **`tsc --noEmit` y `npm run lint` limpios** contra el árbol en `f34066f`.
- **El pipeline de Sentry sigue sólido**: `sentryActivo()`/`avisarObservabilidad()`
  (arranque, `error` si falta `SENTRY_DSN` en despliegue real),
  `flushObservabilidad()` llamado desde el único `after()` del webhook y desde
  `onRequestError`, redacción centralizada en `logger.ts` antes de que nada
  llegue a Sentry. No encontré regresión aquí esta ronda.
- **`avisarConfiguracionSilenciosa`/`SILENCIOSAS`
  (`observability/arranque.ts`)** cubre correctamente `DEMO_TENANT_ID`,
  `DASHBOARD_PASSCODE`, `CUADRA_WHATSAPP_MSG_USD` — no le hacía falta crecer
  con `CUADRA_FOTO_PENDIENTE_*`, porque esas dos SÍ tienen default seguro
  (`|| 3_000`, `|| 400`) y su ausencia no produce una respuesta silenciosamente
  equivocada, solo pierde la optimización de costo — es la categoría correcta
  para no estar en esa lista.
- **CI (`ci.yml`) corre typecheck, lint, tests con cobertura, las pruebas de
  tiempo sin instrumentar y build, en todas las ramas** — sin cambios de
  regresión esta ronda.
- **`scripts/seed.sh` sigue siendo un solo comando reproducible** contra una
  base nueva (migraciones + bucket + seed), con los valores inventados
  marcados en rojo.

## Lo que NO alcancé a revisar

- **Si `foto.pendiente_error`/`foto.pendiente_espera_error` de verdad llegan a
  Sentry en producción** — confirmé que el nivel `warn` sí dispara el reenvío
  (`logger.ts:148`), pero no disparé un fallo real contra el proyecto de
  Vercel/Supabase reales para verlo aparecer en el panel.
- **Si el probe de arranque para 0036-0040 es viable técnicamente con el mismo
  patrón que los ocho existentes** (una llamada de sonda que distinga "no
  existe" de "no contestó") — no diseñé el probe, solo confirmé que no existe;
  el trigger no tiene una función RPC equivalente a las que los otros probes
  usan, así que el diseño concreto (¿sondear con un INSERT/UPDATE de prueba
  que se espera que falle con `CU001`?) queda para quien lo implemente.
- **El reincidente MEDIO de la ronda 8** (probe de la migración 0022 sin pasar
  por `reportarProbe`/`sinRespuesta`) y **el MEDIO de `DEPLOY.md` con el
  dominio viejo (`likidaai.vercel.app` en vez de `likida.ai`)** — confirmé con
  grep que los dos siguen exactamente igual (`startup.ts:184-195` sigue
  comparando `e22.code` directo; `DEPLOY.md:3,14,124` sigue sin mencionar
  `likida.ai`/`app.likida.ai`), pero no profundicé porque el MAPA de esta
  ronda no los señaló para reverificación y ya tenía tres hallazgos nuevos con
  evidencia completa.
- **El resto de `processor.ts` fuera del mecanismo `foto_pendiente`** (barrera
  del XML, corrección de fecha) desde el ángulo de logging — lo leí para
  entender el flujo pero no audité cada `logger.*` nuevo de esas dos piezas
  con el mismo detalle.
- **Migraciones 0039/0040** (`bucket_comprobantes`, `comprobante_huerfano`),
  que aparecieron en commits de esta ronda no listados en el MAPA
  (`cc2a576`, `87ad2ee`) — las incluí en el hallazgo del probe de arranque por
  estar en el mismo hueco, pero no audité el mecanismo de "sala de espera
  para comprobantes sin viaje" que introducen con el mismo nivel de detalle
  que `foto_pendiente`.
