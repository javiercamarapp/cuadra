# Backend y API — auditoría 5

**Nota: 5/10** (antes 7). Razón del movimiento: **mirada más profunda**. El código
no empeoró — los commits de hoy (`4b30dfb` destinatario, `5328087` presupuesto,
`c7f1424` diagnóstico de migraciones) lo mejoraron. Lo que pasó es que el 7 venía
arrastrado de una ronda que **no auditó este rubro**, y al abrirlo aparecen tres
caminos donde el dinero no se escribe, o se escribe a medias, y **nadie se entera**.
Ese es literalmente el ancla de "4 o menos" del rubro; el 5 y no el 4 se lo gana el
trabajo deliberado y probado que sí hay alrededor (mutex con distinción
transitorio/permanente, claim de tres estados, transacción atómica de cierre,
reloj de presupuesto, `pg_errores`).

**El riesgo mayor hoy:** `conv.ts` trata "la base no me contestó" como "el dato no
existe" en dos funciones, y el processor convierte ese silencio en una afirmación
falsa al operador — *"Ese viaje ya quedó cerrado 👍"* sobre un viaje abierto y sin
liquidación, sin una sola línea de log.

---

## Hallazgos

### [CRÍTICO] `resolveOperador` y `getOpenViaje` confunden "no hay" con "no pude preguntar", y el producto miente con la cara seria

`src/lib/cuadra/conv.ts:67` y `src/lib/cuadra/conv.ts:82` — las dos líneas son
`if (error || !data) return null;`. Consumidores: `src/lib/cuadra/processor.ts:187`,
`:205` y **`:493`**.

**Escenario A (el caro).** Viaje `v1` abierto, 17 gastos ya escritos, $8,940
comprobados, anticipo $6,000. El operador escribe *listo*. La barrera pasa, el
mutex se toma (`lockedViaje = 'v1'`). En la re-verificación de `processor.ts:493`
—`if ((await getOpenViaje(op.tenantId, op.operadorId)) !== viajeId)`— Supabase
devuelve `57014 canceling statement due to statement timeout` (o el
`TypeError: fetch failed` que `startup.ts:36` documenta haber visto **en producción
el 28-jul-2026**). `getOpenViaje` devuelve `null`. `null !== 'v1'` → el processor
manda:

> *"Ese viaje ya quedó cerrado 👍. Si te falta algo, tu flota te abre el siguiente."*

y hace `return`. Estado real tras el turno: `viaje.estatus = 'abierto'`, **cero
filas en `liquidacion`**, sin PDF, y la rama no llama a `logger` ni una vez.

**Escenario B (el ancho).** El mismo `null` en `processor.ts:187` produce
*"Hola, no te tengo registrado como operador"* a un operador que **sí** está de
alta; en `:205`, *"No tienes un viaje abierto para liquidar ahorita"* — y si el
mensaje era una foto, el comprobante se descarta ahí mismo sin registrarse en
ningún lado.

**Consecuencia.** El operador deja de mandar comprobantes porque le dijeron que su
viaje cerró. El contralor ve en el panel un viaje `abierto` con 17 gastos y ninguna
liquidación, y no hay alerta ni log que lo explique. Es exactamente el estado que
el rubro agéntico llama "la base dice una cosa y el usuario cree otra", y a nueve
días del demo cae en el peor sitio posible: el escenario A ocurre **después** de
que el operador hizo todo bien.

**Causa raíz.** El repositorio distingue esta clase de error tres veces y muy bien
—`claimMessage` con su tri-estado (`conv.ts:143-168`), `acquireViajeLock` con
transitorio contra permanente (`conv.ts:209-240`), `startup.ts:48-63` con
`sinRespuesta()`—, y `repo.ts` lanza en **todos** sus errores (`repo.ts:26, 46, 69,
165, 214, 237, 246, 283, 340, 362, 393`). `conv.ts` es el único módulo de acceso a
datos que se los traga, y es el que decide qué se le dice al humano.

**Prueba que lo cubra: NINGUNA.** `resolveOperador` y `getOpenViaje` están
mockeadas en los dos únicos tests que las tocan (`processor_lock.test.ts:38-39`,
`processor_cierre.test.ts:38-39`); su implementación real **no se ejecuta en
ninguno de los 65 archivos de prueba** (verificado con `command grep -rn
"resolveOperador\|getOpenViaje" src --include="*.test.ts"`). Los tres
`getOpenViaje.mockResolvedValue(null)` de `processor_cierre.test.ts:138,145,154`
sólo ejercitan la **primera** llamada como "no hay viaje"; la re-verificación de
`:493` no tiene test alguno.

---

### [ALTO] La barrera de ráfaga se abre en silencio ante cualquier error de la RPC, y ese es el único camino que no le avisa nada al operador

`src/lib/cuadra/conv.ts:253` → `conv.ts:270` → `conv.ts:293`, consumido en
`src/lib/cuadra/processor.ts:464-465` y `:656-663`.

```ts
// conv.ts:251-255
export async function intakeDelta(viajeId: string, delta: number): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('intake_delta', {...});
  if (error) { logger.warn('intake.delta', {...}); return 0; }   // ← error ≡ "no hay fotos"
```

`esperarIntake` usa como sonda por defecto `(id) => intakeDelta(id, 0)`
(`conv.ts:270`) y cierra con `if (await probe(viajeId) <= 0) return true`
(`conv.ts:293`). Un `0` de error es indistinguible de un `0` real.

**Medido, no leído.** Corrí `esperarIntake` con una sonda que devuelve lo que
`intakeDelta` devuelve ante un error:

```
esperarIntake con RPC caída  -> true (12ms, 2 probes)
esperarIntake con 5 en vuelo -> false (501ms)
```

**Escenario con valores.** 8 fotos en vuelo (total real $8,940); el *listo* llega
en el mismo lote y corre en el `Promise.all` de `route.ts:71`. Un
`57014 statement timeout` en la sonda → `esperarIntake` devuelve `true` en 12 ms →
**`intakeOk === true`** → el processor **se salta** el aviso de `:656-663`
(*"⚠️ Ojo: cuadré con los N comprobantes que alcancé a procesar"*) → el agente
cuadra sobre los 3 gastos ya escritos ($2,410) → la liquidación imprime
`diferencia = 6,000 − 2,410 = $3,590 a cargo del operador` y el PDF sale con esa
cifra.

**Consecuencia.** Al operador se le cobra una diferencia de $3,590 que no existe, y
el producto se lo entrega en un PDF con fundamento legal, sin la advertencia que
existe precisamente para este caso. Ni el operador ni el contralor tienen forma de
saber que el cuadre fue parcial: el único rastro es un `logger.warn('intake.delta')`
sin `viajeId` en el payload.

**Causa raíz.** El propio repositorio ya identificó este modo de fallo y lo cubrió
**a medias**: `startup.ts:76-78` dice literalmente *"Si falta [la 0011], intakeDelta
devuelve 0 en silencio → esperarIntake retorna true de inmediato y el 'listo' cuadra
sobre gastos PARCIALES"*, y añade un probe de arranque. Pero ese probe corre **una
vez, al boot**, y sólo cubre el caso "migración ausente"; peor, por su propia lógica
(`startup.ts:55-60`) un fallo de red al arrancar sólo produce un `warn`. El caso
transitorio en runtime no tiene guardia — mientras que la RPC hermana
(`try_lock_viaje`) recibió la distinción completa transitorio/permanente. La misma
clase de error, dos tratamientos opuestos, en el mismo archivo.

**Prueba que lo cubra: NINGUNA.** `barrera.test.ts` tiene 5 casos y los cinco
inyectan una sonda honesta (`secuencia([0,1,0])`, `[3,2,0]`, `[5]`…); ninguno modela
el retorno de error de `intakeDelta`. La asimetría también está en los tests:
`conv_lock.test.ts:56-70` **sí** prueba el caso transitorio para el mutex, con dos
casos dedicados.

---

### [ALTO] El acuse "voy recibiendo tus comprobantes" se manda una vez POR FOTO, y el guion del demo promete lo contrario

`src/lib/cuadra/processor.ts:255` y `src/lib/cuadra/processor.ts:376`.

```ts
const enVuelo = await intakeDelta(viajeId, 1);   // :255 — devuelve el contador NUEVO
...
if (enVuelo === 1) {                              // :376
  await say('📸 Voy recibiendo tus comprobantes. Mándalos todos y cuando termines escribe *listo*...');
```

El comentario de `:373-375` dice *"Acuse una sola vez: solo la PRIMERA foto de la
ráfaga"*. La condición implementada no es esa: es *"la foto que llevó el contador de
0 a 1"*, que se cumple para **toda** foto cuya OCR terminó antes de que llegue la
siguiente. El decremento vive en el `finally` de `:383-385`, así que el contador
vuelve a 0 entre fotos separadas.

**Escenario con valores.** El operador fotografía 17 tickets en la gasolinera y los
manda de uno en uno (adjuntar → enviar, ~15 s de interacción humana entre cada uno).
Cada OCR tarda ~3-4 s y deja el contador en 0 antes de que llegue el siguiente →
cada foto ve `enVuelo === 1` → **17 mensajes idénticos** *"📸 Voy recibiendo tus
comprobantes…"*, más 17 `registrarCostoWhatsApp` (`processor.ts:237`).

**Consecuencia.** `GUION_DEMO.md:19-20` describe exactamente esta coreografía —
*"Javier (como operador) manda fotos de tickets reales… El sistema responde UNA vez:
'Voy recibiendo tus comprobantes…' (acuse consolidado, **no por foto**)"*. Si en la
sala las fotos se mandan de una en una en vez de multi-seleccionadas, el segundo
tiempo del guion se rompe delante del contralor: el bot repite el mismo mensaje
tantas veces como tickets haya.

Y la cara opuesta del mismo `if`: en una ráfaga de verdad, las fotos 2..N **no
reciben ningún acuse**. La reacción humana al silencio en WhatsApp es reenviar. Con
`CUADRA_DEDUP_FOTOS` sin poner en el entorno de Vercel — `DEPLOY.md:9` dice "No
tengo token de Vercel" y `:40-41` lista esa bandera entre las que hay que poner **a
mano**, así que no puedo verificar que esté — un reenvío inserta un segundo gasto, y
`engine.ts:133-137` sólo lo detecta si el OCR produjo el mismo
`concepto|folio|monto`; un ticket sin folio legible **no se deduplica en absoluto** y
suma dos veces al `totalComprobado`.

**Causa raíz.** Un invariante escrito en el comentario ("una vez por ráfaga") que la
condición no implementa ("una vez por transición 0→1"). No hay noción de ráfaga en
ningún lado: el contador sólo sabe cuántas OCR están corriendo *ahora*.

**Prueba que lo cubra: NINGUNA**, y es peor que ausente: `processor_lock.test.ts:45`
y `processor_cierre.test.ts:45` mockean `intakeDelta: vi.fn(async () => 0)`, con lo
que `enVuelo` vale siempre `0` y **la rama del acuse no se ejecuta en ningún test de
la suite**. Romper el `if` a propósito no pondría ninguna prueba en rojo.

---

### [MEDIO] `resolveOperador` puede devolver un operador distinto —o de otro tenant— sin que nada decida cuál

`src/lib/cuadra/conv.ts:60-69`:

```ts
.from('operador')
.in('telefono', variantesTelefono(telefono))   // :63  ← hasta 4 cadenas
.eq('activo', true)
.limit(1)                                      // :65  ← sin .order()
.maybeSingle()
```

`variantesTelefono` genera hasta cuatro cadenas para un número mexicano
(`5219993700779`, `529993700779`, `+5219993700779`, `+529993700779`), y la única
restricción de la tabla es `unique (tenant_id, telefono)` sobre la cadena **exacta**
(`0001_init.sql:35`): las cuatro formas pueden convivir como filas distintas, dentro
del mismo tenant o entre tenants. No hay filtro de `tenant_id` —no puede haberlo, el
teléfono *es* lo que lo resuelve— y no hay `.order()`, así que con dos filas que
casan **Postgres devuelve la que quiera**.

Y no existe ningún camino de la aplicación que dé de alta operadores: `command grep
-rn "from('operador')" src` devuelve sólo `conv.ts:61` y `repo.ts:64` (lecturas) y
`analytics.ts:54` (lectura). Todas las filas se teclean a mano en la consola de
Supabase, que es justo donde la disciplina de formato falla. La propia semilla
guarda `+521111111101` (`seed.sql:53`) mientras Meta entrega `521111111101`.

**Escenario con valores.** La flota da de alta a Juan como `+5219993700779`. Semanas
después alguien lo vuelve a capturar desde la consola como `5219993700779` y le
asigna el viaje nuevo a **esa** fila. Llega un mensaje de Juan: casan las dos filas,
las dos con `activo = true`. Si el plan devuelve la vieja, `getOpenViaje(tenant,
operadorId_viejo)` no encuentra nada y Juan recibe *"No tienes un viaje abierto para
liquidar ahorita"* mientras el contralor está mirando el viaje que acaba de
asignarle.

**Consecuencia.** Diagnóstico imposible desde el chat: el mensaje culpa al dato de
la flota y el webhook devolvió 200. Es el mismo modo de fallo que el comentario de
`conv.ts:30-33` describe como *"el peor de todos para depurar"* — se le cerró la
puerta del "1" mexicano y se dejó abierta la de la fila ambigua. En cuanto haya un
segundo tenant, la misma línea decide **a qué empresa pertenece el gasto**: todo lo
que sigue (`getOpenViaje`, `addGasto`, `getConfig`, el PDF) va scopeado por ese
`tenantId`.

**Intento de refutación.** `unique (tenant_id, telefono)` no lo impide (son cadenas
distintas); `activo = true` sólo ayuda si alguien desactivó la fila vieja, y nada lo
obliga; y sin `.order()` el resultado ni siquiera es estable entre ejecuciones.

**Prueba que lo cubra: NINGUNA de la función.** `telefono_mx.test.ts` tiene 9 casos
excelentes, todos sobre `variantesTelefono`, que es pura. La consulta —el `.in()`,
el `.limit(1)` sin orden, la ausencia de tenant— no se ejecuta en ningún test.

---

### [MEDIO] El rate limit del webhook tira comprobantes sin decírselo a nadie

`src/app/api/webhook/whatsapp/route.ts:9` y `:57-62`.

```ts
const MSGS_POR_MIN = 40;
...
const permitidos = messages.filter((m) => {
  const ok = rateLimit(`wa:${m.from}`, MSGS_POR_MIN, 60_000);
  if (!ok) logger.warn('wa.ratelimit', { from: m.from });
  return ok;
});
```

Lo descartado no llega a `processInbound`, así que **no hay ningún mensaje al
operador**, y la ruta devuelve `200 {received: N}` (`:78`), con lo que Meta tampoco
reintenta. El único rastro es un `warn` que lleva el teléfono pero **no el
`waMessageId`**: el comprobante perdido no es identificable después.

**Escenario con valores.** WhatsApp permite multi-seleccionar y enviar hasta 30
imágenes de golpe. Un operador que manda dos tandas seguidas (45 fotos) en menos de
un minuto pierde las últimas 5 → esos 5 tickets nunca llegan a `gasto` → el
`totalComprobado` queda corto en, digamos, $4,300 → la liquidación le carga al
operador una diferencia que no existe, y el PDF sale con ella.

**Consecuencia.** Dinero que no se escribe, sin aviso al operador, sin identificador
para reconstruirlo, y con el webhook en verde. Además el limitador es un `Map` en
memoria **por instancia** (`ratelimit.ts:7`), así que ni protege de forma fiable ni
permite de forma fiable: en Vercel los mensajes del mismo teléfono pueden caer en
instancias distintas.

**Causa raíz.** El descarte del rate limit se modeló como defensa de DoS (una
petición anónima que se tira) y se aplicó a mensajes de negocio ya autenticados por
HMAC, donde tirar equivale a perder.

**Prueba que lo cubra: NINGUNA del comportamiento de la ruta.**
`ratelimit.test.ts` tiene 2 casos sobre `rateLimit` aislada. `route.ts` no tiene
test de comportamiento: el único que lo toca es `presupuesto.test.ts:82`, que lee el
archivo **como texto** para comprobar que `maxDuration` y `PRESUPUESTO_WEBHOOK_MS`
no se desincronicen (ese sí es un buen test, y hoy pasa: los dos dicen 120).

---

### [MEDIO] `loadConversation` descarta tres errores seguidos y se queda con un id vacío

`src/lib/cuadra/conv.ts:112-136`, consumido en `src/lib/cuadra/processor.ts:499`,
`:532` y `:698`.

`const { data } = await admin...maybeSingle()` (`:114-119`) descarta `error`. Ante
un error transitorio `data` es `null`, así que cae a la rama de INSERT (`:130-134`),
donde el insert choca contra `wa_conversacion_tenant_tel_uidx`
(`0005_concurrencia.sql:13-14`) porque la fila **sí existe**; ese segundo error
también se descarta, y la función devuelve `{ id: '', turns: [] }` (`:135`).

Después, `saveConversation('')` (`processor.ts:698` → `conv.ts:171-176`) hace
`.eq('id', '')` → `22P02 invalid input syntax for type uuid`, tercer error
descartado. Y `runAgent` recibe `conversationId: ''` (`processor.ts:532`).

**Escenario con valores.** Un pico de latencia de Supabase durante el turno del
cierre: el operador cierra bien, recibe su resumen y su PDF, pero el turno no se
guarda y, sobre todo, el `viaje_id = null` que marca el cierre nunca se escribe: la
fila `wa_conversacion` sigue apuntando al viaje ya liquidado.

**Consecuencia.** Acotada, y hay que decirlo: `loadConversation:124-128` se
autocura descartando el historial cuando el `viaje_id` no coincide. Lo que no está
acotado es la observabilidad — tres `error` tirados en fila y **ni un `logger`**, con
lo que este fallo es invisible incluso a posteriori.

**Causa raíz.** Un patrón de escritura best-effort (correcto para `saveCfdiXmlRaw`,
que sí registra) aplicado sin registro a la ruta que decide el contexto del agente.

**Prueba que lo cubra:** `conv_historial.test.ts` cubre la lógica de
`viaje_id`/historial (que es la parte buena y reciente de esta función). El camino
de error no lo cubre nada.

---

### [BAJO] La renombrada `middleware.ts` → `proxy.ts` SÍ cambió el runtime, y el registro del repo dice lo contrario

`src/proxy.ts` (antes `src/middleware.ts`), commit `baeb42b`.

El mensaje de `baeb42b` afirma: *"El runtime edge no aplica aquí: este proxy ya era
nodejs."* **Es falso**, y se comprueba en el propio código de build de Next
—`node_modules/next/dist/build/index.js:1520`—:

```js
if (staticInfo.runtime === 'nodejs' || (0, _utils1.isProxyFile)(page)) {
    hasNodeMiddleware = true;
    functionsConfigManifest.functions['/_middleware'] = { runtime: 'nodejs', ... };
```

Un archivo llamado `proxy` es **siempre** nodejs; uno llamado `middleware` sólo si
declara `export const runtime = 'nodejs'`. `git show baeb42b^:src/middleware.ts` no
declara ninguno, y `git log --all -S"runtime" -- src/middleware.ts src/proxy.ts` no
devuelve nada: **nunca lo declaró**. Antes del rename compilaba como edge.

Verificado en el artefacto construido de hoy (16:42):
`.next/server/functions-config-manifest.json` → `"/_middleware": {"runtime":
"nodejs", "matchers": [...]}`, y `.next/server/middleware-manifest.json` está vacío
(`"middleware": {}`, `"sortedMiddleware": []`), es decir: ya no existe ninguna
función edge.

**Lo que descarto por escrito, con evidencia, para que nadie lo persiga:**

- `passcode.ts` sólo usa `crypto.subtle` y un bucle `for` — funciona en los dos
  runtimes, y su comentario de `:7-8` ya lo razonaba.
- El proxy no guarda estado por isolate, así que no hay nada que se comporte
  distinto entre edge y node.
- **No** arrastra peso ni side-effects: `.next/server/middleware.js.nft.json` traza
  134 archivos, sólo 3 fuera de `node_modules`, y `command grep -c` sobre el chunk
  del proxy da **0** para `supabase` y **0** para `try_lock_viaje` — o sea que
  `instrumentation.ts` **no** corre sus tres RPC de Supabase desde el proxy.
- El matcher sobrevive: la regexp construida conserva el lookahead negativo y añade
  las variantes `.rsc`/`.segments`, así que `/dashboard` sigue pasando por el gate.

**Lo que queda, y por eso es hallazgo y no nota:** cada petición que no sea `/api`
paga ahora una invocación de función **Node** en vez de una edge, y el runtime ya no
se puede elegir (`isProxyFile` lo fuerza). Nada de eso rompe hoy. Rompe el día que
alguien lea el mensaje del commit, concluya que los dos archivos son equivalentes, y
vuelva a `middleware.ts` — que sí cambiaría el runtime, esta vez en la otra
dirección y sin que nadie lo mire.

---

### [BAJO] `releaseMessageClaim` se documenta como "at-least-once" apoyándose en el reintento que el propio repo declara inexistente

`src/lib/cuadra/processor.ts:700-704`: *"si el procesamiento crashea, liberar el
claim para que el retry de Meta lo reprocese (at-least-once)"*.

Ese reintento no existe, y el repositorio lo dice dos veces con todas sus letras:
`conv.ts:151-153` (*"Ese retry NO EXISTE: `route.ts` responde 200 y hace el trabajo
en `after()`"*) y `presupuesto.ts:5-7`. Liberar el claim no reprocesa nada: el
mensaje se pierde salvo que el humano lo reenvíe, cosa que el `sendText` de
`:705` le pide explícitamente.

**Consecuencia.** No hay bug de ejecución — el efecto de liberar es nulo, no
dañino. Lo que hay es una garantía escrita que no existe, en el `catch` de último
recurso del camino del dinero: quien lea "at-least-once" ahí va a asumir que un
crash se recupera solo y no va a poner la cola (QStash) que `route.ts:26` ya
identifica como el arreglo de fondo.

---

## Lo que revisé y está bien

- **`saveLiquidacion` / cierre atómico.** `repo.ts:314-342` delega en
  `guardar_liquidacion_tx` (`0013`, ampliada en `0021`), que hace el upsert de
  `liquidacion` y el `update viaje set estatus='liquidado'` en **una** transacción,
  con `liquidacion_viaje_uidx` (`0005:9`) forzando una sola fila por viaje. Es el
  patrón correcto y está bien argumentado en el comentario. Cubierto por
  `repo_escritura.test.ts`, que además prueba el mapeo campo a campo (el error
  clásico de `??` vs `||`).
- **`try_lock_viaje` (`0005:31-42`).** El `on conflict do update ... where
  locked_until < now()` con `return found` es correcto: `found` es `false` cuando el
  lease vigente bloquea el update. Y **verifiqué que el lease no se le queda corto al
  trabajo**: el peor caso de retención es `lock + 1s + agente(≤40s) + cierre(≈7s)
  ≈ 48s` contra un TTL de 60s (`conv.ts:200`), y como el lock se toma *después* de
  la barrera, su TTL se corre con ella. Cabe.
- **`acquireViajeLock` (`conv.ts:199-245`).** La distinción ausente/transitorio, el
  backoff exponencial acotado a 1500 ms y el fail-open sólo tras agotar la ventana
  están razonados y **probados**: `conv_lock.test.ts`, 6 casos, incluido el control
  de que sí lo consigue.
- **Abandono del turno sin mutex.** `processor.ts:484-489` abandona en silencio, y
  `processor_lock.test.ts` lo cubre con tres casos, uno de ellos de control (que con
  el lock tomado el agente **sí** corre) — un test bien construido, no decorativo.
- **`claimMessage` tri-estado** (`conv.ts:159-169`) y su integración
  (`processor.ts:159-172`), cubiertos por `processor_cierre.test.ts` con los tres
  casos, incluido que el `indeterminado` quede anotado como tal y no como duplicado.
- **`pg_errores.violaIndice`** (`pg_errores.ts:24-29`): exige el `23505` **y** el
  nombre del índice, así que no se traga un error real por coincidencia de texto.
  Cubierto por `pg_errores.test.ts`. Bien usado en `processor.ts:356` y `:364`.
- **Claims atómicos en SQL, no en la app**: `reclamarCodigoPendiente`
  (`repo.ts:266-275`, delete con `.select()`), `enriquecer_gasto_codigo` (`0017`) y
  `marcar_aviso_privacidad` (`0018`). El razonamiento de `repo.ts:184-195` sobre el
  read-modify-write contra `ocr_extra` es correcto y la solución también.
- **Sincronía `maxDuration` ↔ `PRESUPUESTO_WEBHOOK_MS`.** Los dos dicen 120, y
  `presupuesto.test.ts:82` lee el archivo de la ruta como texto para que no se
  desincronicen. Sumé la cadena a mano contra el nuevo techo: `108 s` utilizables
  (120 − `MARGEN_CIERRE_MS` 12) contra un peor caso de `20 + 12 + 40 = 72 s` más
  ~7 s de cierre. Cabe con margen, y el manifiesto construido lo confirma
  (`functions-config-manifest.json` → `"/api/webhook/whatsapp": {"maxDuration":
  120}`). El commit `f437f18` cerró de verdad el hallazgo de rendimiento.
- **Contrato de entrada del webhook** (`route.ts:39-54`): cap de body **antes** de
  leer y antes del HMAC, segundo cap sobre el texto crudo por si falta
  `content-length`, HMAC timing-safe (`meta/client.ts:33-40`), y `JSON.parse` en
  try/catch con 400. El orden es el correcto.
- **`destinatarioWhatsApp`** (`meta/client.ts:63-67`) se aplica en `sendText` **y**
  en `sendDocument`, con su test (`meta/destinatario.test.ts`). El bug de hoy quedó
  cerrado en los dos caminos, no en uno.
- **`intake_delta` no puede quedar negativo**: `greatest(0, ...)` en `0011:15`. Esto
  **refuta** la hipótesis de deriva permanente del contador que perseguí primero — un
  decremento espurio no envenena el viaje, sólo esa ventana.
- **`guardar_liquidacion_tx` filtra por `tenant_id`** en el update del viaje
  (`0013:46`, `0021:51`), así que el cierre no puede cruzar tenants.

## Lo que NO alcancé a revisar

- **`src/lib/cuadra/analytics.ts`** (las consultas del panel: `Promise.all` de
  varias tablas completas por tenant sin paginar, `:54-56`). Huele a N+1/carga
  completa, pero no lo abrí a fondo: cae mejor en rendimiento y en frontend.
- **Si las banderas están puestas en el entorno de Vercel.** `CUADRA_DEDUP_FOTOS`,
  `CUADRA_INTAKE_GRACE_MS`, `CUADRA_RECUPERAR_CIERRE_PARCIAL` y
  `CUADRA_INTAKE_ESPERA_MS` están en `.env.local` y `.env.example`, pero `DEPLOY.md:9`
  dice que no hay token de Vercel y `:40-41` las lista como "ponerlas a mano". **No
  pude verificarlo**, y tres de mis hallazgos cambian de gravedad según la respuesta.
  Es el primer dato que pediría antes del demo.
- **`src/app/api/export/liquidaciones/route.ts` y `/api/demo`** más allá de una
  lectura: el export usa un `DEMO_TENANT_ID` fijo con service-role
  (`export/liquidaciones/route.ts:10,24`) y `/api/demo` hace
  `(await req.json()) as {...}` sin validar tipos (`demo/route.ts:32`) — un `monto`
  que llegue como cadena entraría al motor sin coerción. Los dos son de seguridad y
  de contrato de entrada; los dejo señalados, no auditados.
- **`tool-executor.ts` y el camino de fallback de `openrouter.ts`**: es frontera con
  el rubro 4 y no quise duplicar trabajo.
- **RLS y `GRANT`s de `0012_seguridad_rls.sql`**: todo el backend corre con
  service-role y re-impone el scope a mano, así que la calidad de esa red es del
  rubro de seguridad y del de modelo de datos.
- **La ausencia de una restricción que impida dos `viaje` abiertos por operador.**
  No hay índice parcial en ninguna migración (verificado con dos búsquedas sobre
  `unique` y sobre `estatus` en `supabase/migrations/`), y `getOpenViaje:79-80` se
  queda con el más reciente. Si el contralor abre el viaje #2 antes de liquidar el
  #1, todos los comprobantes del #1 se registran contra el #2. **No lo cuento como
  hallazgo mío** porque el fallo es de restricción, no de handler: es del rubro 12,
  y lo dejo apuntado aquí para que no se pierda entre los dos.
