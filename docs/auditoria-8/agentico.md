# Sistema agéntico y orquestación — auditoría 8

**Nota: 5/10** (antes 3). Razón del movimiento: **se atacó y subió**. Los tres
críticos que la ronda 7 dejó abiertos —AG-1 (el encabezado que afirmaba un cierre
que no ocurrió), AG-2 y AG-3— están cerrados en el camino que reportaron, y lo
verifiqué **ejecutando los módulos**, no leyendo el commit. La nota no llega a 6+
porque el entregable del turno —el texto del cuadre y el PDF— **se da por
entregado sin mirar si Meta lo aceptó**, y porque el lease del mutex es más corto
que el peor caso que el propio repo documenta para la ruta que lo sostiene.

Sobre el ancla de "3 o menos": el estado "la base dice una cosa y el usuario cree
otra" **ya no está en el camino feliz**. En la ronda 7 ocurría en cada cierre y
por construcción (dos fotografías de la base). Hoy exige un disparador externo
—que la Graph API rechace el envío— y eso es una diferencia de categoría, no de
grado. Por eso el piso del ancla no aplica; el hecho de que ese estado siga
existiendo es lo que impide pasar de 5.

**El riesgo mayor del rubro, hoy:** el sistema decide que terminó un ciclo sin
comprobar que el humano recibió algo — `sendText` devuelve `string | null` y
`sendDocument` devuelve `void`, y el processor descarta los dos.

---

## Método

Salida real de `npx tsx` importando los módulos del repo (`fundamento.ts`,
`por_diferencia.ts`, `guardia.ts`, `engine.ts`, `config.ts`, `privacidad.ts`)
desde el scratchpad, sin tocar un archivo del repo. `HEAD` = `337e1a8`. Lo que
toca Supabase o Meta va razonado sobre el código y dicho como tal.

---

## Estado de AG-2 y AG-3

### AG-3 — **CERRADO** (con un residuo, ver MEDIO 1)

Recorrí el camino entero, no el commit. `tools.ts:200` mete `liq` —la MISMA que
se imprimió en los dos PDF (`tools.ts:176-177`) y se persistió en
`saveLiquidacion` (`:181`)— en el resultado de la tool;
`openrouter.ts:594` la conserva en `ToolCallRecord.result`; `processor.ts:700`
la pasa a `guardiaCifras`; `guardia.ts:69-72` la lee y `:105` la usa **en vez de
tocar la base**. Ejecutado:

```
guardiaCifras('Ya te cerré la liquidación, pusiste $650 de tu bolsa.',
  [{toolName:'guardar_liquidacion', result:{…, liq:{comprobado 4850, anticipo 5000, dif 150}}}])
→ "Listo, cuadré tu viaje 👇 • Comprobado: $4,850.00 • Anticipo: $5,000.00
   • Sobró $150.00 del anticipo (a favor de la empresa)"     forzado: true
```

Sin credenciales de Supabase el proceso no lanzó una sola excepción: prueba de
que `cuadrarDesdeDB` **no se llama** en el cierre. Con el snapshot ausente
(`toolCalls` de solo `cuadrar_viaje`) sí intenta la base y cae al fail-closed
("Dame un momento…"), que es el comportamiento correcto.

De paso quedó cerrado **AG-1** (ronda 7): `guardia.ts:51` separa `cerro` de
`cuadro` y `:114` pasa `cerro` al encabezado. Un turno de solo `cuadrar_viaje` ya
no dice "Listo, cuadré tu viaje" con el viaje abierto.

### AG-2 — **PARCIALMENTE CERRADO**

Cerrado en el escenario que la ronda 7 midió, y lo confirmo ejecutando
`normasDePolitica(DEMO_CONFIG.politica)` → `['lisr-27-fr-III','lisr-28-fr-V',
'rfa-2026-2.9','lif-2026-art-20-A']`, que `normasDeToolCalls` recoge íntegras del
resultado de `consultar_politica`. Con esos permisos, las tres frases de la ronda
7 **salen intactas**:

```
ENTRA: Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.
SALE : Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.   forzado: false
ENTRA: …porque el artículo 27, fracción III de la LISR limita a $2,000…
SALE : …porque el artículo 27, fracción III de la LISR limita a $2,000…   forzado: false
```

Lo que NO se cerró: el permiso **solo viaja si el modelo llama la tool**, y el
escenario textual de AG-2 era *"el agente contesta de memoria, sin llamar tools"*.
En ese turno `permitidas` sigue vacío y la salida sigue siendo la misma frase rota
(ver MEDIO 5, con salida real). Es una decisión escrita en `e50510c` ("sin llamar
la tool no hay permiso"), y estoy de acuerdo con la decisión; lo que está mal es
que su consecuencia sea **mutilar la oración** en vez de quitar la cita limpia.

---

## Hallazgos

### [CRÍTICO] El cierre se da por entregado sin mirar si Meta aceptó el mensaje ni el PDF
`src/lib/cuadra/processor.ts:284-287` (`say`) · `:840` · `:882` ·
`src/lib/meta/client.ts:82-88` (`sendText` devuelve `null` al rechazo) ·
`:107-118` (`sendDocument` devuelve `void`)

`sendText` se cambió a `Promise<string | null>` precisamente para que un llamador
pudiera saber si el mensaje salió, y `ponerAvisoADisposicion` sí lo usa
(`processor.ts:176-181`: si no hay `id`, libera la reserva y devuelve `false`).
**El camino del entregable no lo usa.** `say` (`:284-287`) hace
`await sendText(...)` y tira el valor; `sendDocument` (`:882`) ni siquiera puede
informar: al `!res.ok` registra y **retorna normal**, así que el `try` de
`:876-896` no se dispara.

Escenario, con valores. `WHATSAPP_ACCESS_TOKEN` vencido — pasó el 28-jul-2026 a
las 12:00, y está documentado en el propio `meta/client.ts:125-133`. Viaje
`VJ-2026-0847`, anticipo $10,600, 14 comprobantes. El operador escribe "listo":

| paso | qué ocurre | qué queda |
|---|---|---|
| `guardar_liquidacion` | cuadra, sube los dos PDF, `guardar_liquidacion_tx` | `liquidacion` emitida, `viaje.estatus = 'liquidado'` |
| `say(reply)` `:840` | Graph API responde 401 → `sendText` → `null` | el operador **no recibe el cuadre** |
| `sendDocument` `:882` | Graph API responde 401 → retorna `void` | el operador **no recibe el PDF** |
| `:887` `pdf.no_entregado` | **no se escribe**: no hubo excepción | nadie sabe que el papel no llegó |
| `:894` "no pude generarte el PDF" | **no se manda**: vive en ese mismo `catch` | |
| `:899` `saveConversation` | guarda el turno assistant **como si hubiera salido** | el contexto del siguiente turno miente |
| `:924` `cerroSinEntregar` | **nunca se evalúa**: no hubo excepción | |

El operador reenvía "listo" y `getOpenViaje` devuelve `null` →
*"No tienes un viaje abierto para liquidar ahorita"* (`:279`). Callejón sin
salida: liquidación emitida, PDF en storage, panel del contralor con la
liquidación, y el chofer creyendo que nada pasó. El campo `cerroSinEntregar`
—escrito exactamente para nombrar este estado— dice `false` porque no llega a
correr, y `wa.no_entregado` (`route.ts:110-116`) tampoco ayuda: ese acuse solo
existe si Meta llegó a emitir un `wamid`, y en un rechazo inmediato no lo hay.

Lo fija una prueba: `processor_cierre.test.ts:119-184` cubre `pdf_generado=false`
y el error de `createSignedUrl`, y mockea `sendDocument: vi.fn()` — que devuelve
`undefined`, o sea **exactamente lo mismo que devuelve al ser rechazado**. La
suite no puede distinguir entregado de rechazado.

**Consecuencia:** el chofer se queda sin su liquidación y sin camino de vuelta; el
contralor la tiene en el panel. Es el ancla del rubro, con disparador externo. En
la sala del 6-ago, con la app en `dev_mode` (`GUION_DEMO.md:18-24`), un rechazo de
Meta se ve exactamente igual que "todo salió bien".
**Causa raíz probable:** el resultado del envío es un dato que existe y que el
único camino que lo necesita no consulta.

---

### [ALTO] El lease del mutex (60 s) es más corto que el peor caso que el propio repo documenta para esa ruta (~90.8 s)
`src/lib/cuadra/conv.ts:256` (`ttlMs ?? 60_000`) · `:263` ·
`src/lib/cuadra/processor.ts:636` (único llamador, sin `ttlMs`) ·
`src/lib/cuadra/presupuesto.ts:92` (*"el peor caso sumado de la ruta son ~90.8s
contra 120"*) · `supabase/migrations/0005_concurrencia.sql:31-42` (`try_lock_viaje`
reasigna en cuanto `locked_until < now()`) · `:45-49` (`unlock_viaje` borra **sin
comprobar dueño**)

El lease no se renueva y nadie lo hereda. El turno que lo tiene puede gastar,
legítimamente, agente (`reloj.acotar(40_000)`) + los trece pasos de cierre
(`COSTO_CIERRE_MS = 8.9 s`) + las consultas previas — y cada consulta colgada
suma `TOPE_CONSULTA_MS + 1.5 s = 9.5 s` (`repo.ts:45-69`). Dos consultas lentas y
el titular pasa de 60 s **sin haber hecho nada mal**.

Escenario, con valores. t=0 llega "listo" (mensaje A), toma el lease, expira
t=60. El agente tarda 38 s y `getGastos` se cuelga 9.5 s → A sigue vivo en t=62.
t=61 llega un segundo texto (B, "¿ya quedó?"): `try_lock_viaje` ve
`locked_until < now()` y **se lo da**; la re-verificación de `:649` pasa porque A
todavía no ha cerrado. B corre el agente completo y llama `guardar_liquidacion`
otra vez. `guardar_liquidacion_tx` es `on conflict (viaje_id) do update`, así que
la fila es una — pero se generan y suben **4 PDF** sobre las mismas dos rutas
(`upsert: true`), se paga **dos veces** el turno de Sonnet, y el operador recibe
**dos cierres y dos PDF**; si un gasto entró entre los dos cálculos, los dos
mensajes traen totales distintos y la liga firmada que recibió primero apunta al
segundo documento. Encima, cuando A termina, su `releaseViajeLock` (`:939`) borra
el lease **de B**, y un tercer mensaje entra sobre B todavía vivo.

**Consecuencia:** doble cierre visible, doble costo, y dos cifras distintas del
mismo viaje delante del comprador. La rejilla de idempotencia
(`tool-executor.ts:97-118`) NO cubre esto: se llavea por `makeExecutor(ctx)`, que
es **por run**, y aquí hay dos runs.
**Causa raíz probable:** el TTL del lease se fijó contra un `maxDuration` de 60 s
y la ruta se subió a 120 sin moverlo.

---

### [ALTO] El aviso de barrera vencida le pide al operador algo que el sistema acaba de dejar de aceptar, y cuenta comprobantes que no son los que liquidó
`src/lib/cuadra/processor.ts:857-864` (sin condicionar a `closed`) · `:859`
(`getGastos` fresco) · `:866` (`if (closed)`, treinta líneas después) · `:255-280`

```ts
if (!intakeOk) {
  const n = (await getGastos(viajeId, op.tenantId)).length;
  await say(`⚠️ Ojo: cuadré con los ${n} comprobantes que alcancé a procesar. Si te faltó alguno, reenvíalo y escribe *listo* otra vez.`);
}
```

Este bloque corre **también cuando el turno cerró**. Escenario, con valores: 6
fotos, la #6 es un diésel de $8,000 cuyo OCR pasa de los 20 s de la barrera
(`:603`). `intakeOk = false`. El agente cierra con 5 comprobantes, $4,850 de
$12,850. Se emite el PDF, `viaje.estatus = 'liquidado'`. Acto seguido el operador
lee *"reenvíalo y escribe **listo** otra vez"*, obedece, y su foto entra por
`processInbound`: `getOpenViaje` devuelve `null` (`:253`) → *"No tienes un viaje
abierto para liquidar ahorita"* (`:279`) y **la imagen se descarta sin guardarse
en ningún lado** — la excepción de `:269` solo cubre `document` (el XML). Los
$8,000 se pierden, y la única instrucción que el producto le dio en el momento
exacto en que le faltaba dinero era imposible de cumplir.

Segundo defecto en la misma línea: `n` sale de una lectura **fresca**, no del
snapshot que se liquidó. Si un gasto entró entre `computeCuadre` y
`saveLiquidacion` (ver MEDIO 1), el aviso dice "cuadré con los 6" sobre una
liquidación que contó 5.

**Consecuencia:** el operador paga de su bolsa un gasto que sí hizo, y lo hace
después de seguir al pie de la letra lo que el sistema le dijo.
**Causa raíz probable:** al aviso le falta `&& !closed` y le falta leer del
snapshot; se escribió para el caso en que el turno no cierra y se dejó
incondicional.

---

### [ALTO] `loadConversation` y `saveConversation` descartan el `error`: es el sexto sitio del patrón que el MAPA persigue
`src/lib/cuadra/conv.ts:170-175` (`const { data } = await …`, sin `error`) ·
`:186-191` (el insert también) · `:227-232` (`saveConversation` no mira el
resultado) · `supabase/migrations/0005_concurrencia.sql:13-14`
(`unique (tenant_id, telefono)`) · `src/lib/cuadra/processor.ts:655`, `:899`

La ronda 7 escribió que *"el patrón de las cinco apariciones del MAPA no reaparece
en `conv.ts`"*. Reaparece dos veces, en el mismo archivo, quince líneas más abajo
de `getOpenViaje`. `loadConversation` lee `wa_conversacion` y solo destructura
`data`: un fallo transitorio se convierte en `data === null`, que el código lee
como **"este operador no tiene conversación"**.

Escenario, con valores. El operador lleva 4 turnos; el modelo acaba de preguntar
*"¿ya no te falta ningún comprobante?"* y él responde **"no, ya no"**. Un blip de
Supabase en el `select` de `:170`:

1. `data = null` → se cae a la rama de creación (`:186`).
2. El `insert` choca con `wa_conversacion_tenant_tel_uidx` → 23505. Ese error
   también se descarta → `created` es `undefined` → **devuelve `{ id: '', turns: [] }`**.
3. El agente corre con `history = [{role:'user', content:'no, ya no'}]`. Sin el
   turno anterior, "no, ya no" no significa nada; el prompt (`prompts.ts:21`)
   lista "ya no tengo más" como disparador de cierre, así que el modelo o cierra
   sobre una frase que no entendió, o contesta "¿a qué te refieres?".
4. `saveConversation('')` (`:899`) hace `.eq('id', '')` contra una columna `uuid`
   → PostgREST `22P02`, **descartado**. El turno no se guarda. El siguiente
   mensaje vuelve a empezar ciego.

Ni `conv.historial_descartado` (`:182`) se escribe, porque esa línea vive dentro
del `if (data)` que no se tomó. No queda una sola huella.

**Consecuencia:** el turno que decide el cierre se resuelve sobre un contexto
truncado que nadie sabe que se truncó, y la conversación deja de persistir en
silencio. Es exactamente la familia de fallo que este repo lleva cinco rondas
cerrando, en el archivo donde ya se cerró tres veces.
**Causa raíz probable:** `maybeSingle()` colapsa "no hay fila" y "no pude
preguntar" en el mismo `null`, y aquí nadie los separó.

---

### [ALTO] `saveLiquidacion` tiene techo de 8 s: el cliente puede reportar un fallo sobre una transacción que sí confirmó
`src/lib/cuadra/repo.ts:45-69` (`acotada` resuelve con un `error` sintético a los
`TOPE_CONSULTA_MS + 1.5 s`) · `:397-411` (`saveLiquidacion` lanza con ese error) ·
`src/lib/cuadra/presupuesto.ts:99` (`TOPE_CONSULTA_MS = 8_000`) ·
`src/lib/cuadra/tools.ts:181` · `src/lib/cuadra/processor.ts:701`

`acotada` no cancela Postgres: cancela **la espera del cliente**. Cuando vence,
devuelve `{ data: null, error }` y `saveLiquidacion` lanza; la transacción del
lado del servidor sigue su curso y puede confirmar.

Escenario, con valores. Supabase acaba de despertar de pausa — el propio guion lo
prevé: *"si Supabase pausó, la primera consulta la revive (~10 s)"*
(`GUION_DEMO.md:26-27`), o sea **más que el techo de 8 s**. El operador escribe
"listo":

- `guardar_liquidacion` genera y sube los dos PDF y llama `guardar_liquidacion_tx`.
- A los 9.5 s `acotada` devuelve error; el handler lanza; `executeTool` lo captura
  y la tool queda con `error`.
- En el servidor, la RPC confirma: `liquidacion` emitida, `viaje.estatus = 'liquidado'`.
- En el processor `closed = false` (`:701`) y `cuadro = false`, así que
  `guardiaCifras` **no** sustituye nada y el modelo —que recibió
  `{"error":"saveLiquidacion: sin respuesta en 8000 ms"}`— contesta lo natural:
  "no pude cerrar tu liquidación, inténtalo otra vez".
- El bloque del PDF (`:866`) no corre. El operador reenvía "listo" →
  `getOpenViaje` es `null` → *"No tienes un viaje abierto para liquidar ahorita"*.

**Consecuencia:** liquidación emitida, dos PDF en storage, panel del contralor
completo, y el operador con un "no se pudo" y sin ruta de vuelta. No hay ninguna
reconciliación en el repo que detecte "viaje liquidado cuyo turno reportó fallo".
**Causa raíz probable:** un tope de espera del cliente sobre la única escritura
que no es idempotente desde el punto de vista de *quién se entera*.

---

### [ALTO] El Plan B del demo no puede producir NADA de lo que el guion promete enseñar
`src/app/api/demo/route.ts:40` (`cuadrarViaje` sin `empresaRfc`, `hidrocarburos`,
`estimulos`, `fechaMin/fechaMax` ni `hoy`) · `:33-40` (no mapea `fecha` ni
`ocrExtra`) · `src/app/demo/page.tsx:13-17` (los cuatro comprobantes) ·
`:53-62` · `GUION_DEMO.md:127` (*"pestaña del simulador `/demo`: mismo motor,
mismos números, sin Meta. Se narra igual"*)

Corrí el motor real con los cuatro comprobantes exactos que manda `/demo`
(anticipo $10,600):

```
estatus: con_diferencias · comprobado: 10600 · diferencia: 0
OBSERVACIONES:
  • sobre_politica → Combustible de $4,200.00 excede el tope de política ($4,000.00) por $200.00.
acreditable: litros 0 · iva 0 · peaje 0
```

**Una** observación, y es un tope de la propia flota, no fiscal. Las seis filas
que `GUION_DEMO.md:73-80` presenta como *"lo que separa a Likida de una app que
junta fotos"* son inalcanzables por Plan B:

| lo que promete el guion | por qué no puede salir |
|---|---|
| "quedan 0 días para timbrarlo" + el portal | `engine.ts:470` corta con `if (!g.fecha) continue`; el route no manda `fecha` |
| "está fechado en 2024 y estamos en 2026" | `fecha_sospechosa` necesita `g.fecha` + `input.hoy`; no hay ninguno |
| "excede el tope fiscal de $750/día (LISR 28-V)" | necesita `input.estimulos`; el route no lo pasa |
| "lleva impreso que NO es un comprobante fiscal" | vive en `ocrExtra`, que el route no mapea |
| "aparece dos veces (excluido del total)" | los cuatro presets tienen folios distintos |

Lo comprobé pasándole al MISMO motor la config que sí usa WhatsApp: aparece
`viatico_excede_fiscal` con su nota íntegra ("excede el tope fiscal de $750.00 por
día (LISR 28-V) — el excedente de $230.00 no es deducible"). Es la config, no el
motor. Y el bloque **Acreditable (recuperable)** —litros de diésel, IVA, peaje:
la sección 4 completa del guion— sale en ceros por la misma razón.

Aparte, `page.tsx:56-62` reimplementa a mano el texto que produce
`resumenCuadre` y **no filtra por `SOLO_CONTRALOR`** (`resumen.ts:24-28`) ni
trunca a 6 observaciones (`resumen.ts:65-68`): el simulador, que se proyecta como
si fuera el teléfono del chofer, enseñaría veredictos (EFOS, CFDI cancelado, RFC
receptor) que el producto real le oculta al operador a propósito.

**Consecuencia:** el riesgo #1 del propio checklist es que WhatsApp no entregue
(la app está en `dev_mode`, `GUION_DEMO.md:18-24`). Si se cae a Plan B, Javier
narra en voz alta seis hallazgos que la pantalla no va a enseñar — el mismo modo
de falla que `337e1a8` acaba de cerrar para el IEPS en pesos, vivo en la pestaña
de respaldo.
**Causa raíz probable:** `/api/demo` se escribió antes de que existieran los
estímulos y las fechas, y quedó como una segunda invocación del motor que nadie
volvió a sincronizar.

---

### [MEDIO] Residuo de AG-3: el gasto que entra mientras se generan los PDF no queda en la liquidación, no dispara "llegó tarde", y le rompe el detalle al contralor
`src/lib/cuadra/tools.ts:151-152` (T1: `computeCuadre`) · `:164-177` (dos PDF +
dos subidas) · `:181` (`saveLiquidacion`) ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql` (el trigger mira
`exists(select 1 from liquidacion …)`) · `src/lib/cuadra/analytics.ts:306`

La 0036 cierra la ventana **desde que la liquidación confirma**, no desde que se
leyeron los gastos. Entre `computeCuadre` (`:152`) y `saveLiquidacion` (`:181`)
hay dos `generarLiquidacionPDF` y dos subidas a Storage — segundos — y en ese
tramo `addGasto` **pasa el trigger** porque todavía no hay fila en `liquidacion`.

Escenario, con valores. El operador escribe "listo" y 6 s después manda una foto
más (diésel $800). El OCR termina justo mientras se sube el segundo PDF:
`addGasto` entra. La liquidación queda con 5 gastos / $4,850, los PDF también, y
el operador **no** recibe el aviso de `processor.ts:484-487` ("llegó después de
que cerré tu liquidación") porque el insert no falló.

Lo que ve el contralor: `analytics.ts:306` reconstruye el viaje y compara contra
lo persistido; $5,650 ≠ $4,850 → `comprobantesCuadran = false`
(`analytics.ts:215`) → el detalle cae al camino de respaldo y pinta **6
comprobantes por $5,650 bajo un encabezado que dice $4,850**, sin pie de tabla y
**sin el desglose de deducibilidad** (`dashboard/[id]/page.tsx:192, 210`).

**Consecuencia:** la pantalla que el guion manda abrir en la sala (*"Abre el
detalle de la liquidación que acabas de crear"*, `GUION_DEMO.md:106`) se contradice
a sí misma, y el operador nunca supo que su ticket no entró.
**Causa raíz probable:** la barrera atómica se puso contra la existencia de la
liquidación en vez de contra la lectura que la produjo.

---

### [MEDIO] El arreglo de AG-3 metió el arreglo completo de gastos —con `ocrExtra` y las ligas de las fotos— en el contexto del modelo, en cada cierre
`src/lib/cuadra/tools.ts:200` (`liq`) · `src/lib/cuadra/cuadre/engine.ts:791`
(`gastos: input.gastos`) · `src/lib/llm/openrouter.ts:595`
(`JSON.stringify(exec.result)` va al `convo`) · `src/lib/cuadra/repo.ts:355-382` ·
`src/lib/cuadra/intake/ocr.ts:387-400`

`Liquidacion.gastos` es el arreglo entero de `Gasto`, con `ocrExtra`,
`imagenUrl`, RFC emisor/receptor, folios de portal y códigos de barras. Medido con
14 comprobantes (el número que usa el guion) y el motor real:

```
bytes del tool result ANTES de 2f79174: 116
bytes del tool result HOY (con liq):    25,498      (×220)
   de los cuales, solo liq.gastos:      10,489
¿viaja ocrExtra.producto?  true      ¿viaja imagenUrl?  true
```

Eso son ~6.4k tokens de entrada extra en la ronda final de **todo** cierre, la
más apretada del turno (`reloj.acotar(40_000)`, `reasoning: 'high'`). Y
`ocrExtra.producto` es el campo que el propio `ocr.ts:388-391` señala como el
único donde un ticket puede revelar SALUD ("una farmacia imprime el nombre del
medicamento", dato sensible del art. 2 fr. VI de la LFPDPPP): hasta `2f79174` no
salía hacia OpenRouter y ahora sí, en cada liquidación.

No hay fuga hacia el operador —con `cuadro = true` la guardia sustituye el texto
siempre— pero el snapshot se está entregando por el canal del LLM cuando el
consumidor real (`guardiaCifras`) está en nuestro propio proceso.

**Consecuencia:** costo y latencia en el turno que menos margen tiene, y el blob
crudo del OCR de cada ticket viajando a un tercero sin que nada lo necesite.
**Causa raíz probable:** el snapshot se devolvió por el `result` de la tool, que
es el único canal que además va al modelo.

---

### [MEDIO] El detector de derechos ARCO secuestra mensajes normales de liquidación y mata el turno
`src/lib/cuadra/privacidad.ts:301` · `:318-327` · `src/lib/cuadra/processor.ts:247-250`

`pideAtencionPrivacidad` corre **antes que todo** y su `return` (`:249`) termina
el turno: el mensaje nunca llega al agente. Salida real del módulo:

```
DESVÍA→ARCO  "listo, ya no tengo más. Ese de $1,240 que lo vea alguien please"
DESVÍA→ARCO  "quiero que una persona revise mi liquidación"
DESVÍA→ARCO  "Ya está todo, pero la comida de $980 me opongo a que la quiten"
agente       "listo"
agente       "Oye, el diesel de 8000 que lo revisen"
```

El primero es un cierre con dinero adentro: el operador dice "listo, ya no tengo
más" y recibe *"Claro. El responsable de tus datos es Transportes Innovativos SA
de CV, con domicilio en …"*. El viaje se queda `abierto`, sin cuadre y sin PDF, y
nada vuelve a intentarlo. El segundo es peor de significado: pedir que **una
persona revise su liquidación** es una petición sobre el dinero, no sobre sus
datos, y se contesta con el domicilio del responsable.

El comentario de `:279-281` dice que se exige forma de petición *"para no
secuestrar la conversación normal de la caseta"*; el patrón de `:301`
(`que (lo )?(vea|revise) (un |una )?(alguien|persona|…)`) la secuestra igual.

**Consecuencia:** el turno más importante del producto se pierde con una respuesta
legal que no viene a cuento, y el operador no tiene forma de saber que su "listo"
no se procesó.
**Causa raíz probable:** un detector determinístico que corre antes del agente y
retorna, en vez de atender el derecho **y** seguir con el mensaje.

---

### [MEDIO · REINCIDENTE de ronda 6 y 7] Cualquier pregunta que lleve al agente a llamar `cuadrar_viaje` se contesta con el estado de cuenta, no con la respuesta
`src/lib/cuadra/cuadre/guardia.ts:38-40` · `:83` · `:114` ·
`src/lib/cuadra/processor.ts:777-782`

`cuadro = true` hace que `guardiaCifras` **siempre** devuelva
`resumenCuadre(...)`: no hay `return` alternativo después de la línea 83. El texto
del modelo se descarta al 100%, diga lo que diga.

Escenario, con valores. Viaje abierto, anticipo $10,600, 9 comprobantes. El
operador pregunta **"¿por qué no me cuentas el diésel de $3,000 que pagué en
efectivo?"**. El agente hace lo correcto: llama `cuadrar_viaje` para ver la
diferencia y redacta la explicación con el `fundamento` que la tool le devolvió.
Lo que sale por WhatsApp es:

```
Este es el cuadre de tu viaje 👇
• Comprobado: $10,600.00
• Anticipo: $10,600.00
• Cuadra exacto ✅
```

Su pregunta no se contesta. Si la nota de `engine.ts` sobre ese gasto está entre
las seis primeras, se cuela por casualidad; si hay más de seis observaciones
(`resumen.ts:65-68`), ni eso. Y como `textoDeterminista` queda en `true`, la
guardia de fundamento tampoco corre (`processor.ts:805`), así que el permiso de
citar que `cuadrar_viaje` acaba de emitir (`tools.ts:115-133`) no sirve para nada
en el turno que lo produjo.

**Consecuencia:** el producto no puede explicar un veredicto sin llamar la tool,
y llamándola no puede explicar nada. Es el bloque 3 del guion ("lo que el sistema
ATRAPA") contestado con un saldo.
**Causa raíz probable:** la guardia de cifras sustituye el mensaje entero cuando
lo único que tiene que garantizar es que los NÚMEROS salgan del motor.

---

### [MEDIO] Sin llamada a tool, la guardia de fundamento sigue mutilando la oración en vez de quitar la cita
`src/lib/cuadra/normas/fundamento.ts:302-318` · `:238-250` (`limpiar`) ·
`src/lib/cuadra/processor.ts:805-807`

Es el residuo de AG-2. Con `permitidas = []` —el turno en que el modelo contesta
sin llamar ninguna tool, que sigue existiendo— la salida real de hoy es idéntica
a la de la ronda 7:

```
ENTRA: Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.
SALE : Te aplica el estímulo del diésel conforme al -A.
ENTRA: El tope de alimentación es $750 al día por el artículo 28 fracción V de la LISR.
SALE : El tope de alimentación es $750 al día por el.
ENTRA: Puedes deducir hasta el 15% conforme a la regla 2.9 de la RFA 2026.
SALE : Puedes deducir hasta el 15% conforme a la 2026.
```

Quitar la cita es la política correcta; entregar *"conforme al -A."* no lo es. La
frase mutilada llega al operador tal cual (`processor.ts:810`), y el log
(`agent.fundamento_forzado`) dice que se hizo lo correcto.

**Consecuencia:** en el único canal por el que el producto habla, una respuesta
sin gramática. Delante de un contralor con fiscalista es peor que callarse.
**Causa raíz probable:** la limpieza borra el fragmento que casó el patrón y
`limpiar()` solo arregla espacios y paréntesis; nadie mira si la oración quedó de
pie.

---

### [BAJO] El agente se presenta como "Cuadra" mientras el PDF, el panel y el simulador dicen "Likida"
`src/lib/cuadra/conv.ts:147` (`agentName: 'Cuadra'`) ·
`src/lib/agents/prompts.ts:17` (`Eres ${ctx.agentName}…`) ·
`src/lib/cuadra/processor.ts:236` ("Pídele a tu flota que te dé de alta en
**Cuadra**") · `src/lib/cuadra/liquidacion/pdf.ts:387, 393` ("Generado por
**Likida** · likida.ai") · `src/app/demo/page.tsx:22` ("¡Hola! Soy **Likida**") ·
`src/app/dashboard/page.tsx:79`

En la misma pantalla proyectada, el chat dice una marca y el PDF que llega dos
segundos después dice otra. Y `cuadra.mx` **no es nuestro** (`87daa62`): el primer
mensaje que recibe alguien no registrado —el paso 1 del checklist del demo,
`GUION_DEMO.md:18-24`— lo manda a darse de alta en un nombre que pertenece a un
tercero.

**Consecuencia:** el comprador ve dos productos donde hay uno.
**Causa raíz probable:** el rebranding tocó los artefactos (PDF, panel, cabeceras
de OpenRouter) y no el único sitio desde el que habla el agente.

---

### [BAJO · REINCIDENTE de ronda 6 y 7] La conversación se llavea con el teléfono crudo de Meta y no con el del operador ya resuelto
`src/lib/cuadra/processor.ts:655` (`loadConversation(op.tenantId, msg.from, viajeId)`) ·
`src/lib/cuadra/conv.ts:43-56` (`variantesTelefono`, que sí existe) · `:174`
(`.eq('telefono', telefono)`, igualdad exacta)

`resolveOperador` acepta cinco formas del mismo número; `loadConversation` exige
una. Si Meta alterna `5219993700779` / `529993700779` para el mismo `wa_id`, se
abren dos filas de `wa_conversacion` (el índice único es por `telefono`, así que
no colisionan) y el historial se parte en dos sin log. `op.telefono` está
disponible en ese mismo scope.

Lo reporto BAJO y no más: `meta/client.ts:44-56` documenta que Meta **entrega**
siempre con el "1", así que hoy la alternancia es teórica. Lo que no es teórico es
que la defensa exista y este llamador no la use.

---

## Lo que revisé y está bien

- **AG-1 cerrado y verificado corriendo el módulo.** `guardia.ts:51` calcula
  `cerro` solo con `guardar_liquidacion`; `:114` lo pasa al encabezado. Un turno
  de solo `cuadrar_viaje` produce "Este es el cuadre de tu viaje 👇" con el viaje
  abierto, que es lo correcto.
- **El destinatario es el correcto en las tres salidas de WhatsApp.** Los tres
  llamadores de `resumenCuadre` pasan `'operador'` explícito
  (`processor.ts:676`, `:759`, `guardia.ts:114`); el default `'contralor'`
  (`resumen.ts:45`) no lo usa ninguna ruta de WhatsApp. El adjunto es
  `${viajeId}-operador.pdf` (`processor.ts:879`), el ejemplar filtrado.
  `SOLO_CONTRALOR` deja fuera `complemento_no_verificable`, que es lo único que
  el operador sí puede arreglar.
- **`ctxCerro` ya tiene sus dos escrituras.** `processor.ts:702` (camino feliz) y
  `:749` (recuperación de cierre parcial). El ALTO REINCIDENTE de la ronda 7 está
  cerrado; `grep -n ctxCerro` da 232, 702, 749 y 924.
- **El `+1` y el `-1` de la barrera son simétricos ante el error.**
  `processor.ts:335-351`: si el incremento devuelve `null`, la foto **no se
  procesa**, se avisa al operador con texto accionable y se libera el claim; no
  se ejecuta el `-1` gemelo, con la razón escrita (`greatest(0,…)` no distingue
  de quién es el crédito). Cerrado.
- **El contador de la barrera aprende a olvidar.**
  `0031_intake_barrera_ttl.sql`: el sello `intake_pendientes_en` reinicia el
  conteo a los 10 min y el olvido ocurre también en el sondeo (`p_delta = 0`),
  que es como lo llama `esperarIntake`. El MEDIO de la ronda 7 está cerrado, y
  `startup.ts:100-104` lo sondea con la columna que **nace** en esa migración.
- **El mensaje que pierde el mutex ya no desaparece.** `processor.ts:636-645`
  avisa ("todavía estoy procesando tu mensaje anterior") y libera el claim. No
  resuelve que el segundo mensaje se conteste —está documentado como FASE 3— pero
  el operador sabe que no se perdió.
- **La rejilla contra el doble efecto dentro de UN run es correcta.**
  `tool-executor.ts:97-118` cachea la **promesa** antes del `await` y se llavea
  por nombre (no por args); `openrouter.ts:517-524` reintenta solo el completado,
  nunca la ejecución de tools; `llaveDeCache` (`:446-458`) usa el nombre a secas
  para las tools sin parámetros. Las tres miran en la misma dirección. (Lo que no
  cubren es el segundo *run*: ver el ALTO del lease.)
- **La respuesta truncada ya no se convierte en un "Listo. 👍".**
  `openrouter.ts:548-556` lanza `TruncatedError` cuando `finish_reason === 'length'`
  sin tool calls, y `processor.ts:697-699` solo dice "Listo. 👍" si hubo tools.
- **El presupuesto compartido sigue siendo la pieza mejor hecha del rubro.**
  `crearPresupuesto` arranca en `processor.ts:222`; barrera (`:603`), mutex
  (`:636`) y agente (`:690`) lo consultan, y la compuerta de `:672` cae al
  resumen determinístico en vez de lanzar un agente que Vercel va a cortar.
- **`resolveOperador` y `getOpenViaje` siguen distinguiendo "no pude preguntar"
  de "no hay"** (`conv.ts:82`, `:137`, `ConsultaFallida`), y el `catch` general
  lo traduce a un mensaje cierto (`processor.ts:911-936`). El operador ambiguo
  se niega en vez de adivinar tenant (`conv.ts:85-95`).
- **El fundamento SÍ llega al operador por la vía determinística.** Las notas de
  `engine.ts` traen la cita dentro del texto y `resumenCuadre` las imprime; la
  guardia de fundamento no corre sobre ese texto (`processor.ts:805`), que es lo
  correcto: lo escribió el motor, no el modelo.
- **La sonda de arranque no escribe nada.** `startup.ts:184-188` llama
  `guardar_liquidacion_tx` con tenant/viaje en ceros; la FK de
  `0028_fks_con_tenant.sql` lo rechaza. No se crea liquidación fantasma.
- **`cifras.ts` es puro y no puede lanzar**, así que el `catch` de
  `processor.ts:783` (que dejaría pasar el texto del modelo sin verificar) es
  inalcanzable. Lo verifiqué porque un fail-open ahí anularía toda la garantía.

---

## Lo que NO alcancé a revisar

- **Nada contra el modelo real ni contra Supabase.** Sin `.env`, sin OpenRouter y
  sin base. Todo lo de arriba es salida de módulos puros importados de verdad o
  lectura de código.
- **La frecuencia real de los disparadores externos.** No medí cuántas veces Meta
  rechaza un envío ni cuánto tarda de verdad `guardar_liquidacion_tx` contra
  Supabase. Sé que los dos caminos existen y qué dejan detrás; la probabilidad es
  inferencia.
- **Concurrencia real de Postgres.** `try_lock_viaje`, `intake_delta`,
  `guardar_liquidacion_tx` y el trigger de la 0036 los leí en SQL; no los corrí en
  paralelo. En particular no medí cuánto dura de verdad la ventana entre
  `computeCuadre` y `saveLiquidacion` (los dos PDF y las dos subidas).
- **El ciclo completo de `statuses` de Meta.** Que un `failed` llegue con la forma
  que `WaEstado` espera lo tomo de la documentación.
- **`prompts.ts` como superficie de inyección.** Lo leí; sus reglas de seguridad
  (`:29-33`) están bien puestas, pero auditarlas de verdad es del rubro de
  seguridad.
- **El resto de `/demo` y `/dashboard`.** Solo entré a lo que produce texto de
  conversación (`page.tsx:53-62`) y a `analytics.ts:298-306` para poder afirmar
  qué ve el contralor tras el residuo de AG-3.
