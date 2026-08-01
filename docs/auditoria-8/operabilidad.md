# Operabilidad y DX — auditoría 8

**Nota: 6/10** (antes 4). Se atacó y subió: los dos CRÍTICOS y el ALTO de la
ronda 6 —los verifiqué archivo por archivo y, para el de Sentry, contra
`vercel env ls production` real, no de oídas— están genuinamente cerrados. Pero
el mismo patrón que se cerró en `config.ts` sigue vivo en `conv.ts`, ahora
tocando cada mensaje de WhatsApp que se procesa, y el MEDIO de la ronda 6
lleva dos rondas sin tocarse. No sube más porque el rubro sigue teniendo un
camino de falla invisible en producción, solo que cambió de archivo.

## Los cuatro abiertos, verificados uno por uno

### [CERRADO] `getConfig` ya no descarta el error de Supabase

`src/lib/cuadra/config.ts:176-223`. Verificado leyendo la función completa:
ahora desestructura `{ data, error }` (línea 178) y **lanza** `ConsultaFallida`
si `error` viene poblado (líneas 179-181), en vez de caer en el `catch`
genérico que antes devolvía `DEMO_CONFIG` a secas. El propio archivo documenta
el cierre en un comentario de 25 líneas (144-175) que además revela un segundo
bug que este mismo arreglo destapó y cerró de paso: `fusionarConfig` devuelve
la MISMA referencia de `DEMO_CONFIG` cuando no hay override, así que la línea
vieja `cfg.empresa = { ...cfg.empresa, rfc }` mutaba el objeto compartido del
módulo — una fuga de RFC entre tenants en la misma instancia de Fluid Compute.
Ahora la función devuelve un objeto nuevo (`return { ...cfg, empresa: {
...cfg.empresa, rfc } }`, línea 214) sin tocar `DEMO_CONFIG`. Cierre limpio, y
mejor que el original: cerró el hallazgo que se pidió verificar y uno que
nadie había reportado.

### [CERRADO] El flush de Sentry ya se llama desde el único `after()` del repo

`src/app/api/webhook/whatsapp/route.ts:71-91`. Verificado: tras el
`Promise.all` que procesa los mensajes, la línea 90 hace `await
flushObservabilidad()`, con un comentario que cita textualmente el hallazgo de
la ronda 6 ("EL MECANISMO EXISTÍA Y NADIE LO LLAMABA (auditoría 6,
operabilidad)"). `flushObservabilidad` (`sentry.ts:129-135`) sigue intacta —
mismo `Promise.allSettled([...enVuelo])` seguido de `sentry?.flush()` — así
que el cierre fue exactamente el que faltaba: conectar el llamador, no
rehacer la función.

### [CERRADO] `SENTRY_DSN` ya existe en Vercel

Verificado corriendo `vercel env ls production` contra el proyecto real
(`likida/likida.ai`) en esta sesión: `SENTRY_DSN` aparece como `Encrypted /
Production / 12h ago`. Combinado con el cierre anterior, hoy un `logger.error`
disparado dentro de `after()` —que es todo el procesamiento de WhatsApp— tiene
destino y además se espera antes de que la invocación se congele. No pude
disparar un error real contra producción para verlo llegar a Sentry con mis
propios ojos (habría requerido provocar un fallo en el sistema real), pero el
mecanismo que lo mueve está, hoy, completo en las dos puntas que hacía falta
cerrar.

### [REINCIDENTE — MEDIO] El probe de la migración 0022 sigue sin distinguir "no se pudo preguntar"

`src/lib/cuadra/startup.ts:184-195`.

**Escenario.** El código es idéntico al que la ronda 6 reportó:

```ts
const { error: e22 } = await admin.rpc('guardar_liquidacion_tx', { ... });
if (e22 && (e22.code === '42725' || /is not unique|no es única/i.test(e22.message ?? ''))) {
  logger.error('startup.migraciones', { msg: 'FALTA la migración 0022...', ... });
  faltan = true;
}
```

Los otros seis probes del mismo archivo (0005, 0011, 0031, 0016, 0017, los
índices vía `indices_faltantes`, y el nuevo de la migración 0033) pasan su
error por `reportarProbe()`, que primero pregunta `sinRespuesta(error)` y, si
la base no contestó, emite `startup.migraciones_sin_verificar` como `warn` en
vez de afirmar una migración faltante. El de la 0022 sigue comparando
directamente `e22.code === '42725'` sin pasar por ese filtro: si `e22` existe
por cualquier otra razón —un `TypeError: fetch failed` porque la base no
respondió justo en ese probe, por ejemplo— la condición es falsa y **no se
emite ninguna línea para este probe en particular**, ni `error` ni el `warn`
de "no se pudo verificar" que los otros seis sí tienen.

**Consecuencia.** Sigue siendo un hueco angosto —en un apagón total los otros
seis probes sí gritan— pero es el único de los siete que, ante un fallo
parcial que le toque justo a él, no deja ningún rastro de haber fallado.

**Causa raíz.** La misma que en la ronda 6: el comentario del archivo
(líneas 174-183) explica por qué este probe se diseñó distinto a propósito
("lo que importa es CUÁL error responde, no que funcione") para tolerar los
errores esperados de llamar la función con datos basura, pero esa tolerancia
sigue sin distinguir el caso de "no hubo respuesta". Dos rondas de vida sin
que nadie lo toque — el rubro no se auditó en la ronda 7, así que es la
primera vez que se vuelve a mirar desde que se reportó.

---

## Hallazgos nuevos

### [ALTO] `conv.ts` descarta el error de las dos operaciones que sostienen la memoria de cada conversación, y una de las dos puede duplicar filas

`src/lib/cuadra/conv.ts:180-204` (`loadConversation`) y
`src/lib/cuadra/conv.ts:239-244` (`saveConversation`), ambas invocadas en
`processor.ts` en cada mensaje entrante procesado (`saveConversation` en la
línea 946).

**Escenario — `loadConversation`.**

```ts
export async function loadConversation(tenantId: string, telefono: string, viajeId: string | null) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('wa_conversacion')
    .select('id, estado, viaje_id')
    .eq('tenant_id', tenantId)
    .eq('telefono', telefono)
    .maybeSingle();
  if (data) { /* ... reusa la fila ... */ }
  const { data: created } = await admin
    .from('wa_conversacion')
    .insert({ tenant_id: tenantId, telefono, viaje_id: viajeId, estado: { turns: [] } })
    .select('id').single();
  return { id: (created?.id as string) ?? '', turns: [] };
}
```

Es el mismo patrón que `getConfig` tenía y que se acaba de cerrar: `{ data }`
sin `error`. `wa_conversacion` **no tiene `unique` sobre `(tenant_id,
telefono)`** — verificado contra `supabase/migrations/0001_init.sql:78-92`,
que solo declara `idx_wa_tel` (un índice normal, no único) sobre `telefono`.

Con un operador a mitad de una conversación de 5 turnos: si el `.select(...)
.maybeSingle()` de arriba devuelve `{ data: null, error }` —por un `error` de
verdad, no por ausencia de fila: RLS que se desalinea tras una migración, una
columna caída, un permiso revocado— el código no lo distingue de "este
teléfono no tiene conversación todavía" y cae al bloque de `INSERT`,
**creando una fila NUEVA** con `estado: { turns: [] }`. El agente le contesta
al operador como si la conversación empezara de cero —incluyendo,
potencialmente, volver a presentarse, porque `getTenantContext` decide eso
mirando si `turns` está vacío— en medio de un intercambio que llevaba cinco
turnos.

Y el daño no termina ahí: como ahora hay DOS filas para el mismo `(tenant_id,
telefono)`, el PRÓXIMO `.select(...).maybeSingle()` sobre ese teléfono
**también falla** —`.maybeSingle()` de supabase-js sí produce error cuando
hay más de una fila, a diferencia de cuando hay cero— y ese error también se
descarta de la misma forma, así que el código vuelve a caer al `INSERT` y crea
una TERCERA fila. Es un ciclo que se autoalimenta: una vez que un teléfono
entra en este estado, cada mensaje siguiente crea una fila nueva y pierde toda
la memoria de la conversación, sin que ninguna línea de log lo diga en
ningún momento del proceso.

**Escenario — `saveConversation`.**

```ts
export async function saveConversation(convId: string, turns: ConvTurn[], viajeId: string | null): Promise<void> {
  await supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: { turns: turns.slice(-MAX_TURNS) }, viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('id', convId);
}
```

Aquí ni siquiera se asigna el resultado a una variable: el `error` se
descarta por completo. Es la llamada que, en `processor.ts:946`, guarda el
turno recién ocurrido y —si el viaje se acaba de cerrar— pone `viaje_id =
null`. Si el `UPDATE` falla en silencio, el turno más reciente no se persiste:
el siguiente mensaje del mismo operador arranca desde el estado ANTERIOR al
guardado fallido, sin la última cosa que se dijeron. El propio comentario de
`loadConversation` (líneas 169-178) documenta el bug histórico exacto que
provoca un `viaje_id` mal actualizado —contexto de un viaje viejo filtrándose
al siguiente—, y esta es la ruta por la que ese `viaje_id` puede quedarse sin
actualizar sin que nada lo detecte.

**Verificado que nada de esto está probado.** `conv_historial.test.ts` prueba
la lógica de "mismo viaje" de `loadConversation` con datos limpios, nunca con
un Supabase que devuelva `error`. Los cuatro `processor_*.test.ts` que llaman
`saveConversation`/`loadConversation` los mockean enteros
(`vi.fn(async () => ({ id: 'c1', turns: [] }))`), así que ninguno ejercita el
código real de esta página. `conversacion_entregada.test.ts` —la prueba nueva
de esta ronda, que sí toca `saveConversation`— verifica QUÉ contenido se le
pasa (que el turno del asistente no se guarde si el mensaje rebotó), no si la
escritura misma tiene éxito.

**Consecuencia.** No corrompe las cifras de la liquidación —esas están
protegidas aparte, en `cifras.ts`/`guardia.ts`, y no dependen de
`wa_conversacion`— pero sí corrompe la memoria conversacional del producto
para el operador afectado, de forma silenciosa y, en el caso de
`loadConversation`, autoalimentada. En un demo frente al contralor, un
operador al que el agente de pronto "no reconoce" a mitad de una liquidación
se ve exactamente como el producto rompiéndose en vivo.

**Causa raíz.** Mismo origen que el CRÍTICO ya cerrado de `config.ts`:
`supabase-js` no lanza ante un error de PostgREST, y estas dos funciones —a
diferencia de las reescritas esta ronda en `repo.ts` (`getDatosResponsable`,
`saveLiquidacion`, etc., que sí desestructuran y lanzan `{ error }`)— nunca se
tocaron con ese criterio.

---

### [MEDIO] `DEPLOY.md` sigue apuntando al dominio de Vercel de antes de la mudanza, no a `likida.ai`/`app.likida.ai`

`DEPLOY.md:3,14,124` — último commit que tocó el archivo: `fa03b00`
(28-jul-2026, auditoría 5), **tres días antes** de la decisión de mudar el
software (`93be38a`, 31-jul-2026) y **cuatro días antes** de hoy.

**Escenario.** Verificado con `vercel inspect likida.ai` contra el proyecto
real: el despliegue de producción de hoy tiene CINCO alias, entre ellos
`likida.ai`, `app.likida.ai` **y** `likidaai.vercel.app`. `DEPLOY.md` no
menciona ni `likida.ai` ni `app.likida.ai` en ningún lado —grep confirmado:
`likida\.ai` solo aparece dentro de `likida/likida.ai`, el nombre del proyecto
en Vercel, en la línea 3— y en cambio da tres instrucciones operativas
contra `https://likidaai.vercel.app`:

- Línea 3: "Producción: **https://likidaai.vercel.app**".
- Línea 14: el comando para ver logs en un incidente, `vercel logs
  https://likidaai.vercel.app --since 1h`.
- Línea 124: la URL que el runbook dice que hay que dar de alta como Callback
  URL en Meta — `https://likidaai.vercel.app/api/webhook/whatsapp`.

`docs/HANDOFF.md:333-339`, que sí se actualizó con la mudanza, documenta un
plan de CUATRO pasos donde el paso 2 —repuntar la Callback URL de Meta a
`https://app.likida.ai/api/webhook/whatsapp`— aparece listado como pendiente
bajo "Lo que Javier tiene que hacer, y nadie más puede". `DEPLOY.md`, que es
el documento al que este mismo archivo (línea 105-109 de `runbook.test.ts`)
reconoce como "el documento al que se acude a las 3 a.m.", nunca se enteró de
que ese plan existe.

**No verifiqué que esto rompa nada hoy**: `likidaai.vercel.app` sigue siendo
un alias válido del mismo despliegue —es el dominio de fallback que Vercel
asigna al proyecto, no depende del DNS custom— así que los tres comandos de
arriba siguen funcionando. El daño es que quien consulte `DEPLOY.md` durante
un incidente para verificar contra qué URL está configurado el webhook de
Meta, recibe una respuesta que no coincide con lo que el propio repo dice en
otro documento que debería estar configurado, y no hay forma de saber cuál de
los dos mandó sin ir a mirar el panel de Meta directamente.

**Consecuencia.** `runbook.test.ts` prueba que `.env.example` y `DEPLOY.md` no
se atrasen respecto al CÓDIGO (nombres de variables), pero no tiene ningún
chequeo sobre el DOMINIO que documentan — es exactamente el punto ciego que
dejó pasar esto. El costo es tiempo de diagnóstico a las 3 a.m., no dinero mal
calculado ni un fallo activo hoy.

**Causa raíz.** La mudanza de dominio (`93be38a`) tocó `docs/HANDOFF.md` y
`supabase/seed.sql`, y el `PDF`/`openrouter.ts` se habían corregido tres
minutos antes en `87daa62`. `DEPLOY.md` no estaba en la lista de archivos que
esa sesión revisó.

---

## Lo que revisé y está bien

- **La mudanza de dominio no dejó rastro de `cuadra.mx` en ningún lugar que
  importe.** Confirmé con `grep -rn "cuadra\.mx"` sobre todo `src/`,
  `supabase/`, `.env.example` y `DEPLOY.md`: las únicas apariciones son en
  `dominio_propio.test.ts` (la prueba que vigila que NO vuelva a aparecer,
  auditoría 6) y en comentarios que narran por qué se quitó de
  `conv.ts`, `pdf.ts` y `openrouter.ts`. `dominio_propio.test.ts` corre en CI y
  falla si el dominio ajeno vuelve a aparecer en código de producción o en
  `seed.sql`, y falla también si `pdf.ts`/`openrouter.ts` dejan de usar
  `likida.ai`. Lo corrí: 5 pruebas, verde.
- **`.env.example` no tiene ningún dominio hardcodeado.** `NEXT_PUBLIC_APP_URL`
  queda como `http://localhost:3000` con el comentario correcto ("en Vercel:
  el dominio de producción"), y es la única variable de dominio del archivo.
- **`scripts/deploy-vercel.sh` no hardcodea ningún dominio**: fija
  `NEXT_PUBLIC_APP_URL` al valor que devuelve `vercel --prod --yes` en el
  momento del deploy, así que no puede quedarse con un dominio viejo por
  diseño (aunque tampoco garantiza que sea el dominio custom y no la URL de
  despliegue única — no lo pude verificar sin disparar un deploy real, ver
  abajo).
- **El fallback de `openrouter.ts` y el pie del PDF usan `likida.ai`
  correctamente**, y están guardados por prueba (`dominio_propio.test.ts`,
  "el dominio propio sale de un solo sitio").
- **`getDatosResponsable` (`repo.ts:425-452`), nueva esta ronda, sí hace bien
  lo que `getConfig` no hacía**: desestructura `{ data, error }` y lanza si
  `error` viene poblado. Mismo patrón correcto en `saveLiquidacion`,
  `enriquecerGastoConCodigo` y `guardarCodigoPendiente` — las cuatro
  funciones nuevas/tocadas de `repo.ts` en esta ronda siguen la regla que
  `conv.ts` todavía no sigue.
- **`instrumentation.ts` (`onRequestError`) también llama
  `flushObservabilidad()` al final** (línea 82), consistente con el cierre del
  CRÍTICO del webhook: las dos superficies que pueden congelarse —`after()` y
  las excepciones no atrapadas de Server Components— ahora esperan sus envíos
  en vuelo antes de terminar.
- **El acuse de entrega de WhatsApp (`wa.no_entregado`) que el propio
  `route.ts` documenta como el origen de una pérdida real el 28-jul ya está
  cableado y probado** (`src/app/api/webhook/acuses.test.ts`), y `maxDuration`
  subió de 60 a 120 con una nota fechada que verificó el plan real de Vercel
  contra la API, no contra una suposición.
- **CI corre en todas las ramas**, no solo `master`/`main` — cambio de esta
  ronda, con la razón escrita en el propio `ci.yml`: las rutinas de nube
  empujan a `claude/*` y antes ese código no pasaba por ninguna puerta.
- **`getTenantContext` (`conv.ts:143`) también descarta `error`, pero con
  degradación aceptable**: si la consulta del nombre de la flota falla, cae a
  `'la flota'`, un genérico sin consecuencia sobre datos ni sobre dinero. No
  lo cuento como hallazgo — es la misma familia de patrón que `loadConversation`
  y `saveConversation`, pero sin su daño concreto.
- **Suite completa corrida en esta sesión**: `npm test` → 133 archivos, 1299
  pruebas pasadas, 1 saltada, exit 0. Coincide con la línea base que reportó
  el orquestador (1296/132, la diferencia es el crecimiento normal de commits
  entre que se tomó esa foto y ahora).

## Lo que NO alcancé a revisar

- **Si `scripts/deploy-vercel.sh` fija `NEXT_PUBLIC_APP_URL` al dominio custom
  o a la URL de despliegue única.** `vercel --prod --yes` puede imprimir
  cualquiera de los dos según la versión del CLI y si el proyecto ya tiene
  dominios de producción asignados; no lo pude verificar sin disparar un
  deploy real, que está fuera de lo que esta ronda permite correr. El impacto
  si imprime la URL de despliegue única es bajo — hoy esa variable solo
  alimenta el header `HTTP-Referer` hacia OpenRouter (verificado con `grep
  -rn "NEXT_PUBLIC_APP_URL" src`, un solo consumidor) — pero no llegué a
  cerrarlo con certeza.
- **Si el evento de Sentry realmente llega hoy**, con `SENTRY_DSN` puesto.
  Verifiqué que la variable existe y que el código la lee y la espera; no
  disparé un error real contra producción para verlo aparecer en el panel de
  Sentry con mis propios ojos.
- **Si Meta tiene configurada de verdad la Callback URL contra
  `app.likida.ai`** o si sigue en `likidaai.vercel.app` — es exactamente la
  pregunta que el hallazgo de `DEPLOY.md` deja abierta, y no tengo acceso al
  panel de Meta para resolverla desde aquí.
- **`src/app/(admin)/` y `(portal)/` completos, otra vez** — repasé lo que
  cambió en las rutas nuevas (`privacidad/`, `aviso/[tenant]/`) y en el
  webhook; no releí esas dos superficies enteras por tercera ronda seguida.
- **La retención real de los runtime logs de Vercel** — sigue sin log drain
  (mismo grep que en la ronda 6, mismo resultado vacío), y `DEPLOY.md` lo
  sigue admitiendo como hueco abierto en su propia sección final.
