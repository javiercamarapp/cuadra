# Operabilidad y DX — auditoría 6

**Nota: 4/10** (antes 5). Los tres CRÍTICOS y los seis ALTOS de la ronda 5 sí se
cerraron —lo verifiqué archivo por archivo, no de oídas— y el nivel de
ingeniería del rubro subió de verdad: `logger.ts` tiene ahora un huellado
razonado con FNV-1a que resiste el ataque de diccionario que un redactor
ingenuo no resistiría, `meta/client.ts` ya no traga los `!res.ok` de la
descarga de media, `dashboard/error.tsx` y el nuevo `global-error.tsx`
capturan el `digest`, la ruta de export dejó de mandar el error crudo de
Postgres al navegador, y `runbook.test.ts` ata `.env.example` y `DEPLOY.md` al
código con pruebas reales. Todo eso es trabajo sólido y lo dejo dicho abajo con
detalle.

Pero la pregunta de esta ronda es qué abrieron esos arreglos, y **encontré dos
CRÍTICOS nuevos, verificados contra el código real y contra `vercel env ls`**:

1. `getConfig` (el que decide con qué RFC y con qué topes de política se
   liquida un viaje) sigue descartando el `error` de Supabase exactamente
   igual que los cuatro sitios que esta misma ronda pedía cazar — y es un
   quinto lugar, en un archivo que el propio MAPA señaló como sospechoso.
2. El mecanismo que se construyó AYER, con comentarios extensos y ocho
   pruebas unitarias, para que un evento de Sentry sobreviva al congelamiento
   de una invocación de Vercel dentro de `after()` — nunca se llama desde el
   único `after()` que existe en el repo, que es el webhook de WhatsApp. El
   arreglo está bien hecho y prueba lo que dice probar; simplemente no está
   conectado a su único cliente real.

Con dos caminos así, la pregunta que ordena el rubro —"si esto revienta a las
3 a.m. con un cliente adentro, ¿qué hay a la mañana siguiente?"— sigue
teniendo una respuesta parcial: para el CRÍTICO 1, una liquidación con
política y RFC equivocados, sin una sola línea que lo delate; para el
CRÍTICO 2, silencio en Sentry incluso el día que alguien ponga `SENTRY_DSN`.

---

## Hallazgos

### [CRÍTICO] `getConfig` descarta el error de Supabase y liquida con la política y el RFC de la demo

`src/lib/cuadra/config.ts:145-169`, consumido en el camino del dinero por
`src/lib/cuadra/processor.ts:501`, `src/lib/cuadra/tools.ts:35` y
`src/lib/cuadra/cuadre/desde_db.ts:14`.

**Escenario.**

```ts
export async function getConfig(tenantId: string): Promise<CuadraConfig> {
  try {
    const { data } = await supabaseAdmin().from('tenant').select('rfc, config').eq('id', tenantId).maybeSingle();
    const override = (data?.config as Partial<CuadraConfig> | null) ?? null;
    const cfg: CuadraConfig = fusionarConfig(DEMO_CONFIG, override);
    if (data?.rfc) { /* valida y mete el RFC real */ }
    return cfg;
  } catch {
    return DEMO_CONFIG; // demo-safe: si la DB no está, usa defaults
  }
}
```

Es exactamente el patrón que el MAPA pidió cazar por quinta vez: `supabase-js`
**no lanza** ante un error de PostgREST (RLS mal puesta, columna caída tras
una migración, un `grant` revocado) — resuelve con `{ data: null, error }`, tal
como documentan `costos.ts:15-20`, `analytics.ts:12-22` y las 12 funciones de
`repo.ts` que sí desestructuran `{ error }`. `getConfig` es la única función
del camino del dinero en este archivo que solo pide `{ data }`. El `try/catch`
que rodea la llamada únicamente atrapa el caso "la base no contestó nada en
absoluto" (un `TypeError: fetch failed`, y el comentario lo dice: "demo-safe:
si la DB no está"); **no atrapa el caso más común**, que es una consulta que
sí volvió pero con `error` adentro.

Cuando eso pasa: `data` es `undefined` → `override` es `null` →
`fusionarConfig(DEMO_CONFIG, null)` devuelve `DEMO_CONFIG` sin tocar (su
propia regla, `config.ts:128`: `if (override == null) return base;`) →
`data?.rfc` es falso, así que el bloque que valida y mete el RFC real del
tenant (`config.ts:151-163`) **ni siquiera se ejecuta**. La función devuelve
exactamente lo mismo que devolvería para un tenant que legítimamente nunca
configuró nada — sin una sola línea de log que distinga los dos casos.

**No es hipotético que el archivo se toque y este bug sobreviva**: la ronda 5
editó esta misma función (`86e23aa`, "Un RFC de empresa mal formado apagaba
deducciones, no validaciones") para arreglar la validación del RFC **tres
líneas más abajo** de donde está el bug, y no lo tocó.

**Consecuencia.** `getConfig` alimenta `politica` (los topes por concepto:
$4,000 diésel, $1,500 caseta…), `estimulos` (factor de peaje, claves del IEPS
de diésel), `tabulador` (precio de diésel por defecto) y, el más caro,
`empresa.rfc` — el RFC contra el que `engine.ts` valida que un CFDI viene
dirigido al cliente y no a un tercero (`rfc_empresa_invalido.test.ts` prueba
justo esa validación, pero con un `empresaRfc` ya resuelto, no ejercitando
`getConfig`). Si la lectura de `tenant` falla por una razón que no es "la base
está caída" —el caso más probable en producción—, la liquidación de un
cliente REAL corre con el RFC genérico de demo (`XAXX010101000`) y los topes
de política de demo, en vez de los suyos. Ninguna alerta, ningún log:
`getConfig` es indistinguible de un tenant sin configurar.

**Y no hay ninguna prueba que lo cubra.** `config_merge.test.ts` prueba
`fusionarConfig` en aislamiento; ningún archivo de prueba mockea
`supabaseAdmin()` para ejercitar la rama de error de `getConfig` (verificado
con `command grep -rln "getConfig" src --include="*.test.ts"`: los tres
resultados o mockean `getConfig` entero o comentan sobre él, ninguno prueba su
manejo de errores).

**Causa raíz.** La misma de siempre: se asumió que `await` sobre el query
builder de `supabase-js` lanza. No lo hace. El resto del archivo —y del
repo— ya sabe esto; esta función no.

---

### [CRÍTICO] El flush de Sentry construido para sobrevivir a `after()` nunca se llama desde el único `after()` que existe

`src/lib/observability/sentry.ts:129-135` (`flushObservabilidad`) ·
`src/app/api/webhook/whatsapp/route.ts:70-77` (el único `after()` del repo,
verificado con `command grep -rn "after(" src --include="*.ts"`) ·
`src/lib/cuadra/processor.ts:803-830` (el catch que produce `agent.fail` /
`processInbound.fail`, y que corre DENTRO de ese `after()`).

**Escenario.** El propio `sentry.ts` explica, en un comentario largo y
correcto, por qué existe `flushObservabilidad`:

> «En Vercel el trabajo del webhook corre dentro de `after()` y la invocación
> se CONGELA en cuanto esa promesa resuelve: sin esto, el evento que más
> importa —el último error antes de morir— es justo el que menos probabilidad
> tiene de salir del proceso.»

Y `reportar()` (la función que `logger.error`/`logger.warn` invocan para
mandar algo a Sentry) sí hace `flush` — pero **dentro de su propia promesa
desprendida**:

```ts
export function reportar(nivel: 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (!sentryActivo()) return;
  intento ??= cargar();
  seguir(
    intento.then(async () => {
      sentry?.captureMessage(msg, { ... });
      await sentry?.flush(2000);
    }),
  );
}
```

`seguir(p)` (`sentry.ts:115-118`) agrega `p` a un `Set` llamado `enVuelo` y
hace `void p.finally(...)` — **no la devuelve a quien llamó `reportar()`**.
`reportar()` regresa de inmediato. `logger.ts:148-150` llama a `reportar` sin
`await`:

```ts
if ((level === 'error' || level === 'warn') && process.env.SENTRY_DSN) {
  void import('./observability/sentry').then((s) => s.reportar(level, msg, redactado));
}
```

La única función que de verdad ESPERA a que ese trabajo termine es
`flushObservabilidad()`, que hace `await Promise.allSettled([...enVuelo])`.
Y `flushObservabilidad` se llama en exactamente **dos** sitios del código de
producción (verificado con `command grep -rn "flushObservabilidad" src/`,
descartando pruebas): dentro de sí misma, y en `instrumentation.ts:76`, al
final de `onRequestError` — el manejador de excepciones no atrapadas de
Server Components y route handlers.

**`route.ts:70-76` no la llama:**

```ts
after(async () => {
  await Promise.all(
    permitidos.map((m) =>
      processInbound(m).catch((e) => logger.error('processInbound', { err: ... })),
    ),
  );
});
```

`Promise.all` espera a que cada `processInbound(m).catch(errHandler)` se
resuelva. `errHandler` llama a `logger.error(...)` de forma síncrona
(`logger.error` no devuelve una promesa que alguien espere) y termina ahí: el
mapeo se resuelve sin haber esperado el `reportar()` que ese `logger.error`
disparó por dentro. En cuanto `Promise.all` resuelve, el callback de
`after()` termina, y con él la invocación — exactamente el escenario que el
comentario de `sentry.ts` describe, siendo el disparador el mismo
`logger.error('processInbound.fail', ...)` de `processor.ts:816-830` que
también dispara para `agent.fail` (`processor.ts:676`) y `pdf.no_entregado`
(`processor.ts:790`): los tres eventos que más importan en el camino del
dinero.

**Verificado que no hay prueba que lo hubiera atrapado.**
`route_cableado.test.ts` mockea `processInbound` entero (`vi.fn(async () =>
{})`) y `logger` entero, así que nunca ejercita un `logger.error` real ni,
por tanto, `reportar()` ni `flushObservabilidad()`. Los ocho tests de
`reportar.test.ts` sí prueban que `flushObservabilidad` espera los envíos en
vuelo — pero llamándola directamente, nunca a través del `after()` de la
ruta. El cableado que falta está exactamente en la costura entre dos archivos
que cada uno prueba bien por separado.

**Consecuencia.** Incluso el día que alguien ponga `SENTRY_DSN` en Vercel
(hallazgo siguiente), los eventos que de verdad importan —los que se generan
dentro de `after()`, que es TODO el procesamiento de mensajes de WhatsApp—
siguen corriendo una carrera contra el congelamiento de la invocación, sin
nada que la fuerce a esperar. El mecanismo que se escribió específicamente
para ganar esa carrera está en el repo, probado, y desconectado de la única
llamada real que lo necesitaba.

**Causa raíz.** El fix se hizo en la capa correcta (`sentry.ts`) y se probó en
esa capa. Faltó el paso de conectar el llamador: `after()` necesita su propio
`await flushObservabilidad()` después del `Promise.all`, igual que
`onRequestError` lo tiene al final.

---

### [ALTO] `SENTRY_DSN` sigue sin existir en Vercel — confirmado, y el aviso nuevo SÍ se dispararía

`src/lib/observability/sentry.ts:69-75` (`avisarObservabilidad`) ·
verificado con `vercel env ls production` sobre `likida/likida.ai`.

**Escenario.** Corrí `vercel env ls production` contra el proyecto real. Las
17 variables de producción no incluyen `SENTRY_DSN`:

```
DASHBOARD_PASSCODE, WHATSAPP_ACCESS_TOKEN, NEXT_PUBLIC_APP_URL,
CUADRA_INTAKE_ESPERA_MS, CUADRA_DEDUP_FOTOS, CUADRA_RECUPERAR_CIERRE_PARCIAL,
CUADRA_INTAKE_GRACE_MS, DASHBOARD_SECRET, DEMO_TENANT_ID,
WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID,
WHATSAPP_PHONE_NUMBER_ID, OPENROUTER_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL
```

Confirmo también que el aviso nuevo SÍ se dispararía: `avisarObservabilidad()`
decide con `desplegado = !!process.env.VERCEL_ENV || process.env.NODE_ENV ===
'production'`. `VERCEL_ENV` la inyecta la plataforma en toda función
desplegada, sin que nadie la configure — así que en producción real
`desplegado` es `true`, `sentryActivo()` es `false`, y
`instrumentation.ts:register()` llamaría a `logger.error('startup.observabilidad',
{ sentry: false, entorno: 'production', err: '...' })` en cada arranque de
instancia fría. Leí `reportar.test.ts:157-172` y `arranque.test.ts`, que
prueban esta misma lógica con `vi.stubEnv`, y el razonamiento coincide.

**Consecuencia.** A diferencia de la ronda 5, esto ya NO es invisible: cada
arranque en frío lo grita en el log, y `DEPLOY.md:35-37` le dice a quien
opere dónde mirarlo. Pero la condición de fondo —cero alertas activas en
producción— sigue siendo cierta hoy, y se combina con el hallazgo anterior:
poner el DSN sin cablear el `flush` en `after()` deja el problema
parcialmente resuelto.

**Causa raíz.** Nadie ha ejecutado `vercel env add SENTRY_DSN production`
todavía. Es el único de los cuatro hallazgos de esta lista que no se arregla
en código.

---

### [MEDIO] El probe de la migración 0022 no distingue "no se pudo preguntar" de sus cinco hermanos

`src/lib/cuadra/startup.ts:134-145`

**Escenario.** Los otros cinco probes de `verificarMigracionesCriticas`
(0005, 0011, 0016, 0017, 0019) pasan su error por `reportarProbe()`, que
primero pregunta `sinRespuesta(error)` — si la base no contestó (red caída,
`fetch failed`), emite `startup.migraciones_sin_verificar` como `warn` y NO
afirma que falte la migración. El de la 0022 no pasa por ahí:

```ts
const { error: e22 } = await admin.rpc('guardar_liquidacion_tx', { ... });
if (e22 && (e22.code === '42725' || /is not unique|no es única/i.test(e22.message ?? ''))) {
  logger.error('startup.migraciones', { msg: 'FALTA la migración 0022...', ... });
  faltan = true;
}
```

Si `e22` existe pero no es exactamente "la función no es única" —por ejemplo
un `TypeError: fetch failed` porque la base no contestó justo en ese probe—,
la condición es falsa y **no se emite ninguna línea para este probe en
particular**: ni `error`, ni el `warn` de "no se pudo verificar" que sí
tienen los otros cinco.

**Consecuencia.** Es un hueco angosto —en un apagón total de red los otros
cinco probes sí gritarían "no se pudo verificar el esquema", así que el
arranque no queda mudo del todo— pero es exactamente la asimetría que esta
ronda pide cazar: un mismo archivo, mismo patrón, aplicado cinco de seis
veces. Si algún día el apagón es parcial o intermitente y toca justo este
probe, es el único de los seis que no deja rastro de haber fallado.

**Causa raíz.** El comentario de `startup.ts:124-133` explica que este probe
se diseñó distinto a propósito ("lo que importa es CUÁL error responde, no
que funcione") para tolerar los muchos errores esperados de llamar la función
con datos basura — pero esa tolerancia también se tragó el caso de "no hubo
respuesta", que sí importa.

---

## Efectos del camino del dinero que no dejan rastro en éxito

Mismo chequeo que la ronda 5, repetido contra el código de hoy. Lo que se
cerró, se cerró (`wa.sendText.ok`/`wa.sendDocument.ok` con wamid,
`wa.media_no_descargada` con body de Meta, `costo.vinculado`/
`costo.liquidacion_sin_costo`). Lo que sigue igual:

- **`src/lib/cuadra/repo.ts:141` — `addGasto`.** Sigue sin una línea de éxito.
  Lanza correctamente si falla (eso cambió hace rondas), pero "el ticket de
  $1,050 se registró" solo se puede inferir por ausencia de error, nunca
  leerse directamente.
- **`src/lib/cuadra/repo.ts:375` — `saveLiquidacion`.** Igual: lanza si
  `guardar_liquidacion_tx` falla, no deja línea si tiene éxito. El cierre del
  viaje —el evento más importante del producto— no es buscable por sí mismo
  en los logs.
- **`src/lib/cuadra/repo.ts:198` — `updateGastoCfdiXml`.** Reescribe monto,
  fecha, UUID y RFC de un gasto con los datos del CFDI y no deja rastro de
  haberlo hecho cuando sale bien.
- **`src/lib/cuadra/conv.ts:227` — `saveConversation`. Sigue sin
  desestructurar `error` siquiera** (verificado línea por línea: `await
  supabaseAdmin().from('wa_conversacion').update(...).eq('id', convId);`, sin
  asignar el resultado a nada). Ronda 5 lo marcó como el ejemplo más extremo
  de la lista y sigue exactamente igual. Si el estado de la conversación no
  se guarda, el turno siguiente parte de un historial viejo y no hay ni éxito
  ni fallo que buscar.
- **`src/lib/cuadra/costos.ts:114` — `registrarCosto`.** Ahora SÍ grita si
  falla (`costo.no_registrado`, el ALTO de la ronda 5 ya cerrado), pero
  tampoco deja una línea cuando el insert sale bien.
- **`src/lib/cuadra/repo.ts:258` — `enriquecerGastoConCodigo`** y
  **`repo.ts:284` — `guardarCodigoPendiente`.** Mismo patrón: lanzan al
  fallar, callan al lograrlo.

---

## Lo que revisé y está bien

- **El huellado de UUID resiste la prueba de "de qué se hace huella y de qué
  no".** Confirmé contra las migraciones (`supabase/migrations/0001_init.sql`
  y las tablas que suman al camino del dinero) que `tenant.id`, `viaje.id`,
  `gasto.id`, `operador.id` y `liquidacion.id` usan **todos**
  `default gen_random_uuid()` — un CSPRNG de pgcrypto con ~122 bits de
  entropía real, no un contador ni un derivado de nombre. Y `huellaId()` no
  se llama en ningún sitio del código de producción salvo dentro de
  `redactarTexto` (verificado con `command grep -rn "huellaId(" src/`): no
  hay ninguna llamada directa que la aplique a un valor de espacio chico (un
  teléfono, un RFC) donde sí sería reversible por diccionario. El diseño que
  describe el comentario de `logger.ts` es el que el código de verdad
  implementa.
- **`meta/client.ts` cerró bien su CRÍTICO.** `avisarFalloMedia()` unifica los
  cuatro `if (!res.ok)` que antes devolvían `null` mudos, y lleva `status` y
  el cuerpo de la respuesta de Meta —lo que distingue un token vencido
  (401/190) de un media caducado (404)—, que es justo el dato que faltaba
  para no mandar al operador a reenviar una foto que nunca va a funcionar.
- **`dashboard/error.tsx` y el nuevo `global-error.tsx`** capturan el
  `digest` de Next, lo pintan seleccionable en pantalla y lo registran por el
  logger. `CLAVES_NO_PII` en `logger.ts:122` exime a `digest` de la
  redacción a propósito (diez dígitos que si no, salían como `[TEL]`), y hay
  prueba de eso en `instrumentation.test.ts`.
- **La ruta de export ya no manda el error crudo de Postgres al navegador.**
  `route.ts` de `api/export/liquidaciones` registra `export.liquidaciones`
  con el tenant (huellado) y el mensaje, y responde un texto genérico.
- **`runbook.test.ts` es exactamente lo que hacía falta.** Compara
  `.env.example` contra un `grep` real de `process.env.` en todo `src/`,
  falla si sobra o falta una variable, falla si `SENTRY_DSN` aparece dos
  veces, y falla si `DEPLOY.md` deja de mencionar las cuatro variables
  silenciosas. Es una prueba que ata prosa a código, y las dos veces que este
  rubro se rompió fue exactamente por esa deriva.
- **Cinco de los seis probes de `verificarMigracionesCriticas` distinguen
  bien "no se pudo preguntar" de "no está" (el hallazgo MEDIO de arriba es
  sobre el sexto).** La 0019 nueva de esta ronda (`startup.ts:108-122`)
  sigue el mismo criterio que las anteriores, con su propio comentario
  explicando el peor caso (CFDI de diésel duplicado, IVA acreditado dos
  veces).
- **`arranque.ts` es una adición limpia.** Separa lo "silencioso" (variables
  cuya ausencia no rompe nada pero contesta mal: `DEMO_TENANT_ID`,
  `DASHBOARD_PASSCODE`, `CUADRA_WHATSAPP_MSG_USD`) de lo que sí rompe
  (`faltantes()` de `env.ts`, ahora con un consumidor real por primera vez),
  y usa un `msg` distinto para cada aviso a propósito, citando el mismo
  motivo por el que `startup.migraciones` no debería compartir mensaje entre
  el error y su desmentido. Las siete pruebas de `arranque.test.ts` cubren
  el caso feliz, cada variable faltante por separado, y que el VALOR nunca
  se filtre por el aviso.
- **`getResumenCosto` es ahora una unión discriminada de verdad.** Confirmé
  que `medido` / `sin_registros` / `no_medido` son mutuamente excluyentes en
  el tipo (no solo en la intención) y que ningún consumidor puede leer
  `totalUsd` fuera de la rama `medido`.
- **CI intacto.** Mismas cuatro puertas en el mismo orden, sin cambios que
  reportar.

---

## Lo que NO alcancé a revisar

- **Si Sentry realmente pierde eventos hoy en `after()`.** Razoné el
  mecanismo leyendo `sentry.ts`, `route.ts` y `route_cableado.test.ts`, y es
  consistente con el propio comentario del autor sobre por qué existe
  `flushObservabilidad`, pero no disparé un error real contra producción con
  un DSN real para medirlo con los ojos — habría requerido `SENTRY_DSN`
  puesto, que hoy no existe.
- **Si `getConfig` ha fallado alguna vez en producción de esta forma.** No
  encontré ninguna línea `config.rfc_empresa_invalido` en el código que
  sugiera que ya pasó, pero tampoco hay forma de saberlo desde los logs
  actuales: es precisamente la falta de instrumentación la que hace este
  hallazgo posible.
- **`src/app/(admin)/` y `(portal)/`, otra vez.** Revisé lo que cambió en
  `dashboard/`, `global-error.tsx` y las rutas de `api/`; no volví a leer
  esas dos superficies completas.
- **La retención real de los runtime logs de Vercel en el plan actual.**
  Sigue sin log drain configurado (`command grep -rn "drain" . --include="*.ts"
  --include="*.md"` no devuelve nada relevante); `DEPLOY.md` ya lo admite
  como hueco abierto y no lo repito como hallazgo nuevo.
- **Los flujos que no son código**: quién recibe la alerta de Sentry el día
  que exista, rotación del token de WhatsApp en la práctica, y qué se hace
  operativamente con una liquidación cerrada sin PDF. `DEPLOY.md` los declara
  fuera de su alcance explícitamente.
