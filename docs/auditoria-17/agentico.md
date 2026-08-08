# Sistema agéntico y orquestación — auditoría 17

**Nota: 5/10** (antes 8). Razón del movimiento: **mirada más profunda — el código
del ciclo casi no cambió y la nota anterior estaba inflada**. Los dos MEDIOs
abiertos de la ronda 13 SÍ se cerraron (verificado ejecutando los regex de hoy),
pero recorriendo el ciclo punto por punto aparecen tres huecos viejos que ninguna
ronda había mirado —el ejemplar de PDF que recibe el contralor, el "Listo. 👍"
sin mutación, el presupuesto que no es de la invocación sino del mensaje— y el
cambio a QStash (`91c41db`) agregó dos puntos de muerte nuevos que nadie observa.

**Riesgo mayor hoy:** al cerrar una liquidación, el contralor —el comprador—
recibe por WhatsApp el ejemplar del PDF **del operador**, que está filtrado a
propósito para esconderle los veredictos fiscales; el mensaje de texto que lo
acompaña sí los menciona. Dos documentos del mismo cierre que se contradicen, en
las manos de quien decide la compra.

## Hallazgos

### [CRÍTICO] El PDF que se le manda al contralor es el ejemplar del operador — el que se filtró para esconderle los veredictos fiscales
`src/lib/likida/processor.ts:2111` (se firma `…-operador.pdf`), `:2123`
(`createSignedUrl(path, 60)`), `:2162` (`avisarCierreAlJefe({ …, urlPdf:
data.signedUrl })`); origen de los dos ejemplares en
`src/lib/likida/tools.ts:188-189`; el filtro en
`src/lib/likida/liquidacion/pdf.ts:406`.

Escenario: viaje `VJ-2026-0847` con un gasto de diésel de $8,000 cuyo emisor está
en la lista 69-B (`cfdi_efos`). El chofer escribe *listo* → `guardar_liquidacion`
genera **dos** PDF: `…/v.pdf` (contralor, con la sección "DIFERENCIAS
DETECTADAS" completa) y `…/v-operador.pdf` (sin `cfdi_efos`, `cfdi_cancelado`,
`rfc_receptor`… — `SOLO_CONTRALOR`, `resumen.ts:24`). `processor.ts:2111` firma
**solo** el del operador, se lo manda al chofer (correcto) y **reusa esa misma
URL firmada** para `avisarCierreAlJefe`. Sale: al WhatsApp de la oficina llegan
(a) el texto de `armarAvisoJefe`, armado desde `liquidacion.diferencias` de la
base, que sí dice "proveedor en lista 69-B", y (b) adjunto, un PDF que **no trae
esa línea**. El del panel (`liquidacion.pdf_path`) sí la trae.

Consecuencia: el contralor archiva y le pasa a su contador el ejemplar
incompleto; el documento que recibe por WhatsApp contradice tanto al mensaje al
que viene adjunto como al que descarga del panel. Es el paso final del guion del
demo y ocurre en **todo** cierre, no en un borde. Además invierte la defensa que
`tools.ts:168-173` dice estar construyendo.

Causa raíz probable: `avisarCierreAlJefe` reusa `data.signedUrl` para no duplicar
el criterio del TTL (`avisar_cierre.ts:86-88`); nadie notó que esa URL apunta al
ejemplar filtrado. No hay ninguna prueba que fije qué `path` recibe el jefe
(`avisar_cierre.test.ts` inyecta `URL_PDF` como fixture).

### [ALTO] "Listo. 👍" se manda tras un turno en el que no se mutó nada, y ninguna guardia lo desmiente
`src/lib/likida/processor.ts:1860-1862`

Escenario: el chofer escribe *ya acabé*. El modelo llama **solo**
`consultar_politica` (read-only) y devuelve `content: ""` — cosa que pasa: el
propio `openrouter_truncado_tools.test.ts:16` documenta el caso del texto vacío.
`res.toolCalls.length > 0` es cierto, así que `reply = 'Listo. 👍'`. Después:
`guardiaCifras` sale en la primera línea (`guardia.ts:83`: `!cuadro` y sin
cifras); `guardiaFundamento` no encuentra citas; `guardiaEstado` no empata
—`AFIRMA_CIERRE` exige `quedó/está/cerré/liquidé`, y "Listo. 👍" no tiene verbo—.
Sale: el chofer lee "Listo. 👍" con el viaje en `abierto`, sin fila en
`liquidacion`, sin PDF y sin que nadie vaya a generarlo.

Consecuencia: el chofer deja de mandar comprobantes esperando su PDF; el panel
del contralor no tiene esa liquidación. Es literalmente el estado que
`estado_afirmado.ts:1-27` se escribió para impedir, entrando por la puerta que
esa guardia no vigila: el texto no lo escribió el modelo, **lo escribimos
nosotros**.

Causa raíz probable: la condición mira "¿corrió alguna tool?" cuando la pregunta
es "¿corrió alguna **mutación**?" — `guardar_liquidacion` es la única con
`isMutation` (`tools.ts:152`), y `closed` ya está calculado tres líneas abajo.

### [ALTO] El portón de cifras sigue ciego a cualquier número pegado a un guion o con signo — REINCIDENTE
`src/lib/likida/cuadre/cifras.ts:60` (`NUMERO_SUELTO`), `:114` (`MONEY_G`),
consumido en `src/lib/likida/cuadre/guardia.ts:83` y `:96`.

Verificado ejecutando los regex del archivo tal como están hoy:

| texto | ¿dispara el portón? |
|---|---|
| `Diferencia: -1500 a tu favor` | **NO** |
| `Tu saldo quedó en -3500` | **NO** |
| `Pusiste -450 de tu bolsa` | **NO** |
| `Te quedan entre 800-1200 del anticipo` | **NO** |
| `Te sobraron 3500 del anticipo` | sí |
| `Te sobran ochocientos del anticipo` | sí (lo cerró la 13) |

Escenario: turno con `toolCalls: []` (el modelo contesta de memoria del
historial, que trae el cuadre del turno anterior) y `reply = "Tu diferencia
quedó en -1500, a tu favor."` → `tieneCifrasDeDinero` devuelve `false` →
`guardia.ts:83` retorna sin tocar el texto → el −1,500 que nadie calculó llega al
teléfono del chofer, y no se escribe ni `guardia_cifra_no_verificable` ni
`guardia_cifras_sin_respaldo`. El mismo string es invisible para
`cifrasSinRespaldo` (`MONEY_G` lleva el mismo lookbehind), así que en la rama de
`consultar_politica` una cifra con signo cuenta como "todo respaldado" —
`fuera.length === 0` → `return { forzado: false }`. Y el signo no es exótico: el
JSON de `cuadrar_viaje` entrega `diferencia: -1500`, que es la forma que el
modelo copia.

Consecuencia: es la regla fundacional del producto ("nunca inventar una cifra")
sin backstop, y sin rastro en el log de que se cayó.

Causa raíz probable: los lookarounds `(?<![\w-])` / `(?![\w-])` se pusieron para
salvar folios (`VJ-2026-0847`) y de paso tragan el signo y el rango. Es la misma
raíz que el "1-10 pasa el portón" que la ronda 13 dejó abierto: se cerró la mitad
de cardinales en palabras (`diez` ya marca) y no se tocó la de los guiones.
(REINCIDENTE parcial de la ronda 13.)

### [ALTO] El presupuesto es del MENSAJE, no de la invocación: en una ráfaga, los últimos mensajes creen tener 120 s que ya no existen
`src/lib/likida/processor.ts:351` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)`
dentro de `processInbound`), `src/lib/likida/presupuesto.ts:213-215` (el reloj
arranca en la llamada), contra la afirmación de
`src/app/api/webhook/whatsapp/route.ts:31`.

Escenario: Meta entrega 22 fotos en UN POST (el caso que este repo mide como
real, ver `processor.ts:1234-1251`). `conPool` corre 5 a la vez; cada foto pide
`extraerComprobante(dataUrl, reloj.senal(25_000))`. Las fotos 21 y 22 arrancan
alrededor de t≈100 s de la invocación y **crean su propio presupuesto de
120 000 ms**, así que `reloj.acotar(25_000)` les concede los 25 s completos.
Vercel mata la invocación a los 120 s (`route.ts:77`) a mitad de su OCR. Sale:
esas dos fotos no se procesan, el `finally` de `processor.ts:1262`
(`intakeDelta(-1)`) **no corre**, el `+1` de cada una queda escrito, el claim en
`wa_mensaje_procesado` queda tomado, Meta ya recibió su 200 y no reintenta, y no
se escribe una sola línea de log.

Consecuencia: dos comprobantes perdidos en silencio; y el siguiente *listo* del
chofer (dentro del TTL de 10 min de `conv.ts:555`) espera la barrera completa y
recibe "⚠️ Ojo: cuadré con los N comprobantes que alcancé a procesar" — un aviso
cierto por accidente y por la razón equivocada. Es exactamente el final que
`route.ts:22-27` describe como "el peor que tiene este producto" y que el comentario
de `route.ts:31` afirma resuelto por el pool ("con el presupuesto ya gastado
descontado por `crearPresupuesto`"): el pool baja la concurrencia, pero el reloj
sigue siendo por mensaje.

Causa raíz probable: `crearPresupuesto` se instancia dentro de `processInbound`;
para que la afirmación de `route.ts:31` fuera cierta el reloj tendría que nacer
en el `after()` y viajar como parámetro.

### [ALTO] Con QStash, el cron de facturación responde 200 aunque el lote no se procese nunca
`src/app/api/cron/facturar/route.ts:308-337` (encola y retorna
`{corrio:true, encolado:true}`), `src/app/api/cron/facturar/cola/route.ts:22-28`
(el callback responde **503** si falta cualquiera de las tres variables).

Escenario: `UPSTASH_QSTASH_TOKEN` puesto en Vercel y `QSTASH_CURRENT_SIGNING_KEY`
ausente (son valores distintos, de pantallas distintas de Upstash; `.env.example`
solo los documentó después, en `468ec1f`). Cada media hora: el cron elige 8
tickets, `publishJSON` responde con `messageId`, el cron devuelve **200** y queda
verde en el panel de Vercel; el callback responde 503 `{error:'QStash no
configurado'}`; QStash reintenta 2 veces y manda el mensaje al DLQ. Sale: cero
tickets facturados, cero avisos al encargado (`avisarALasPersonas` vive dentro
del callback, `route.ts:579`), y ninguna señal en el único tablero que alguien
mira.

Consecuencia: la facturación automática puede quedarse muerta semanas; los
plazos reales son 7-15 días en gasolineras, así que el ticket se vence y el IVA y
el estímulo de diésel se pierden. Es el modo de fallo que este mismo archivo dice
existir para no tener (`route.ts:93-96`: "un 200 con la lista vacía dejaría el
cron verde en el panel de Vercel para siempre"). El camino síncrono devolvía 503
cuando no podía trabajar; el camino con cola devolvió esa garantía.

Causa raíz probable: "encolado" se está reportando como "corrido". Nada consulta
el estado del mensaje en QStash ni hay un heartbeat de "cuándo fue la última vez
que el callback terminó".

### [MEDIO] El callback de QStash tiene 600 s de presupuesto y se corta a los 150 s, porque hereda el reloj del cron
`src/app/api/cron/facturar/route.ts:129`
(`PRESUPUESTO_LOTE_MS = maxDuration * 1000`, con el `maxDuration = 300` de **esa**
ruta) y `:158` (`MARGEN_LOTE_MS = 150_000`), consumidos por
`procesarLoteEnCola` (`:469` y `:509`), que el callback importa —
`cola/route.ts:5`— aunque él exporte `maxDuration = 600` (`cola/route.ts:11`).

Escenario: 8 tickets de 3 flotas distintas, callback de QStash. La primera flota
consume ~140 s de sesión de portal. Antes de abrir el navegador de la segunda,
`Date.now() - inicioLote >= 300_000 - 150_000` ya es cierto → `sinTiempo += n`,
`break`. Sale: dos flotas quedan sin intentar y vuelven a la corrida siguiente,
con 450 s de presupuesto sin usar.

Consecuencia: la cola no hace lo que el commit dice que hace ("el techo de 300 s
de una invocación directa es justo lo que esta cola existe para romper",
`cola/route.ts:9-10`): con más de dos flotas activas, la cola de facturación
avanza igual de lento que antes y el ticket sigue acercándose a su vencimiento.

Causa raíz probable: el presupuesto se deriva de una constante del módulo en vez
de recibirse como parámetro; `procesarLoteEnCola` ya recibe `inicioLote`, le
falta recibir su techo.

### [MEDIO] La recuperación del cierre parcial —el arreglo de un CRÍTICO— vive detrás de un flag default-off
`src/lib/likida/processor.ts:1899`
(`process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1'`)

Escenario: el env de Vercel no trae la variable (el default del código). El
modelo llama `guardar_liquidacion` en la ronda 3 —la liquidación queda escrita,
el viaje pasa a `liquidado`, los dos PDF suben a storage— y en la ronda 4 la
respuesta se trunca (`finish_reason: 'length'`, `openrouter.ts:743`) o se agota
el `timeoutMs` de `runAgent`. `generateWithTools` lanza `PartialExecutionError`
con `guardar_liquidacion` dentro de `partialToolCalls`, pero `recuperar` es
`false` → `closed` queda en `false`, `agentTools` queda `[]`, y el chofer recibe
"Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?".
Obedece, y `getOpenViaje` ya no encuentra nada: "No tienes un viaje abierto para
liquidar ahorita" (`processor.ts:602`). Sale: liquidación cerrada e irreversible
(triggers 0036/0037), PDF en storage, cero entregas, callejón sin salida.

Consecuencia: es el anclaje literal del "3 o menos" del rubro. El código lo sabe
—su propio comentario dice "Se recomienda ON para el demo"—, pero el estado
seguro depende de una variable de entorno que no se puede verificar desde el
repo y cuya ausencia no deja ni un log.

Causa raíz probable: HARD RULE 3 (flag default-off para no cambiar el
comportamiento) aplicada a un arreglo cuyo comportamiento anterior es el bug.
Sin un chequeo de arranque que lo grite —`startup.ts` ya tiene ese patrón para
las migraciones—, no hay forma de notar que está apagado.

### [BAJO] El prompt le pide al modelo justo la salida que la guardia descarta siempre
`src/lib/agents/prompts.ts:25` ("explícale en lenguaje simple: cuánto comprobó,
cuánto era el anticipo, a favor de quién queda la diferencia…") contra
`src/lib/likida/cuadre/guardia.ts:38-40` y `:83`.

Escenario: turno de cierre normal. `cuadrar_viaje` o `guardar_liquidacion`
corrieron sin error → `cuadro === true` → la guardia sustituye el texto **sin
mirarlo** por `resumenCuadre(...)`. Sale: la narración que el prompt pidió (y sus
tokens de salida) se tira entera, en el 100 % de los cierres.

Consecuencia: deuda que ya cobra factura de dos formas — se pagan tokens por
texto que nadie lee, y cualquiera que quiera mejorar lo que el chofer lee al
cerrar va a editar este prompt y no va a pasar nada. El mensaje de cierre real
vive en `resumen.ts:52-63`.

Causa raíz probable: el prompt es anterior a que la guardia pasara de "sustituir
si detecto cifras" a "sustituir siempre que hubo cuadre" (el cambio documentado
en `guardia.ts:74-82`); nadie volvió a leer el prompt después.

## Lo que revisé y está bien

- **Los dos MEDIOs abiertos de la ronda 13 están cerrados**, verificado contra el
  código de hoy: el salto por negación ya es por **ventana del verbo**
  (`estado_afirmado.ts:148-149`, `m.index-25 … m.index+18`), así que
  "Ya quedó cerrada tu liquidación, no te preocupes" con `cerro:false` sí se
  caza; y la pregunta sin `¿` ya no se tacha (`estado_afirmado.ts:127`,
  `PREGUNTA = /[¿?]/`). Los cardinales 1-10 y "diez" ya disparan el portón
  (`cifras.ts:42`) y además se cotejan por valor (`cifras.ts:176-179`,
  `cardinalesEnPalabras`).
- **El renombre Cuadra→Likida no dejó marca vieja en el texto que ve el humano**:
  `prompts.ts` toma el nombre de `ctx.agentName`, que es `'Likida'` en
  `conv.ts:209`, único sitio donde se fija. No hay `src/lib/likida/marca.ts` (el
  archivo del brief no existe); la vigilancia vive en `marca.test.ts`. Los
  literales `CUADRA_*` que quedan son nombres de variables de entorno, no texto.
- **Snapshot único por cierre**: `guardia.ts:69-72` reusa el `liq` que devolvió
  `guardar_liquidacion` (`tools.ts:221`) en vez de releer la base, así que el PDF
  archivado y el WhatsApp narran la misma fotografía. Es correcto y está bien
  argumentado.
- **`cerro` vs `cuadro`** están separados (`guardia.ts:38-51`): un turno que solo
  calcula ya no encabeza "Listo, cuadré tu viaje".
- **Destinatario en el texto**: los tres llamadores de `resumenCuadre` que van al
  chofer pasan `'operador'` explícito (`processor.ts:1839`, `:1939`,
  `guardia.ts:114`); el default `'contralor'` (`resumen.ts:50`) solo se alcanza
  desde el PDF. El problema del destinatario está en el **adjunto**, no en el texto.
- **Idempotencia de mutaciones en el ciclo de tools**: `tool-executor.ts:149` no
  re-ejecuta una tool `isMutation`, y `openrouter.ts:769` corta ANTES de pagar la
  última ronda para no disparar un `guardar_liquidacion` cuyo resultado nadie va
  a leer.
- **Mutex y barrera fallan cerrado**: `intakeDelta`/`intakePendientes` devuelven
  `null` (no 0) ante error (`conv.ts:488-548`), `esperarIntake` no abre con
  `null` (`conv.ts:598-601`), `acquireViajeLock` distingue RPC ausente de error
  transitorio (`conv.ts:439-458`), y el `return` por mutex ocupado ahora avisa y
  libera el claim (`processor.ts:1751-1760`).
- **XML del CFDI dentro de la barrera y bajo mutex** (`processor.ts:1344-1395`):
  el caso que la ronda 8 dejó abierto está cerrado, con `+1/-1` simétrico.
- **Firma de QStash verificada antes de tocar nada** (`cola/route.ts:31-47`) y
  re-validación del lote contra `cfdi_uuid is null` (`:62-69`); un reintento de
  QStash no re-emite porque `marcarIntento` es un UPDATE condicional con claim
  (`al_vuelo.ts:641-648`).

## Lo que NO alcancé a revisar

- No corrí la suite (`npx vitest run`) ni `tsc`: me apoyé en la línea base del
  MAPA. Los hallazgos 3 y 4 los verifiqué ejecutando los regex y leyendo el
  código, no con una prueba que los reproduzca.
- No pude verificar el **entorno real de Vercel**: si
  `CUADRA_RECUPERAR_CIERRE_PARCIAL`, `QSTASH_CURRENT_SIGNING_KEY` y
  `QSTASH_NEXT_SIGNING_KEY` están puestos, los hallazgos 5 y 7 quedan latentes en
  vez de vivos. Los dos merecen una comprobación manual antes del demo.
- No recorrí el ciclo de `escalar_viaje.ts` (la escalación a las 5 h) ni el de
  `purgar`: los abrí por encima y el cron falla cerrado sin `CRON_SECRET`, pero
  no seguí sus puntos de muerte.
- No revisé `acuse_ticket.ts` ni `rafaga.ts` por dentro (el contador de
  confirmaciones y el cierre de ráfaga son estado **en memoria del proceso**: en
  serverless eso se pierde entre invocaciones y merece su propio recorrido).
