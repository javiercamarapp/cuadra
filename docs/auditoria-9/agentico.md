# Sistema agéntico y orquestación — auditoría 9

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**. Los
tres hallazgos abiertos de la ronda 8 SÍ cerraron —los verifiqué uno por uno— y
el ciclo del "listo" está mejor sujeto que nunca. Pero el mecanismo nuevo de
esta ronda (`foto_pendiente`) mete una máquina de estados **entre invocaciones**
en el camino del dinero, y ahí existe hoy un estado donde el operador mandó un
comprobante, no hay nada en la base y nadie se lo dice. El ancla del rubro es
explícita sobre ese caso, y manda por encima de lo que se cerró.

> Riesgo mayor de hoy: en una ráfaga de fotos, la retención de "ticket sin
> código" fusiona DOS comprobantes distintos en uno solo y el segundo desaparece
> sin log, sin mensaje y sin rastro — y la ráfaga es exactamente cómo se manda
> en el demo.

## Hallazgos

### [CRÍTICO] La retención de foto fusiona dos comprobantes DISTINTOS en uno, y el otro desaparece
`src/lib/cuadra/processor.ts:459-503` (decisión en `:460` y `:466-470`);
`src/lib/cuadra/intake/ocr.ts:254-259`; `supabase/migrations/0038_foto_pendiente.sql`

El único criterio para decidir "esta foto es el acercamiento de la que está
esperando" es `tieneCodigoLegible(dataUrl)` — o sea, *que la foto suelte
cualquier código de barras o QR*. No se comprueba jamás que las dos fotos sean
del mismo papel. La comprobación que sí sabría distinguirlo (`soloCodigo` /
`soloPago`, `ocr.ts:443-451`) corre **después** de la fusión, sobre el
resultado ya fusionado, cuando ya es tarde.

Escenario, con valores (todo en UNA sola invocación: WhatsApp permite mandar
varias fotos en un envío y Meta las entrega en un POST → `route.ts:72`
`Promise.all`):

- **P1** = ticket de gasolinera de **$8,412.00**, código de barras sobre el
  doblez del papel → `decodeCodigosFromImage` devuelve `[]`.
- **P2** = ticket de caseta de **$312.00** con su código de barras legible.

1. P1: `tieneCodigoLegible` = `false` → `guardarFotoPendiente(t1, v1, media-P1)`
   → fila `fp-1` → entra a sondear (`processor.ts:486`).
2. P2, ~200 ms después: `tieneCodigoLegible` = `true` →
   `reclamarFotoPendiente(t1, { viajeId: 'v1' })` → se lleva `fp-1` (la fila se
   BORRA), descarga `media-P1`, y arma `imagenes = [P1, P2]` (`:469`).
3. `extraerComprobante`: `codigosPorFoto = [[], [barcode-caseta]]` →
   `iSinCodigo = 0` → **el OCR corre SOLO sobre P1** (`ocr.ts:259, 267`). Sale
   un comprobante con el monto, concepto, litros y RFC del **diésel**, y con
   `codigoBarras`/`folioPortal` de la **caseta** (`ocr.ts:347-348`).
4. `decidirFoto` → `legible` → `alta` → **un** `addGasto`.
5. P1, en su siguiente sondeo (~400 ms): `existeFotoPendiente` = `false` →
   `esperarReclamoDeFoto` devuelve `true` → `if (laTomoOtro) return;`
   (`processor.ts:496`). No hace nada más.

Estado final: **un gasto** de $8,412.00 con el folio de la caseta pegado. La
caseta de $312.00 no existe en ninguna tabla. Cero logs de error, cero mensajes
al operador.

Variante peor: si el código de P2 lleva total (QR fiscal, o liga de portal con
`totalPortal`), `ocr.ts:341` hace `monto = montoCodigo` → el gasto sale con
**$312.00** y los datos del diésel. Ahí se pierden $8,412.00 de comprobado y el
único aviso es la observación `monto_discrepante` (`engine.ts:261`), que le dice
al contralor "no coinciden el código y la visión" sobre un ticket que sí era
consistente.

**Consecuencia:** la liquidación cierra corta por el importe entero de un
comprobante que el operador sí mandó, y él lo paga de su bolsa. Encima el
comprobante que sí entró va a timbrarse con el folio de portal de otro papel —
que es justo lo que la oficina teclea. En el demo del 6-ago, si el guion manda
las fotos en un envío, esto es visible en la sala.

**Causa raíz probable:** el pre-chequeo `tieneCodigoLegible` es una versión más
cruda de la misma heurística "trae código ⇒ es acercamiento" que ya produjo un
bug real el 1-ago (el voucher de terminal disfrazado por su código de barras,
commit `3a937dd`). Aquel se corrigió *dentro* de `ocr.ts`, con la evidencia del
OCR a la mano; este corre una capa antes, sin ninguna evidencia, y decide algo
más caro: qué dos fotos se colapsan en un solo gasto.

*Intento de refutación:* «no se solapan, el operador manda de una en una». No se
sostiene: `route.ts:65-69` documenta y dimensiona el lote (`MSGS_POR_MIN = 40`,
"una ráfaga de 12 fotos cabe holgada"), y aun mandando de una en una la ventana
de retención es de 3 s (`HOLD_FOTO_MS`). Segunda: «un ticket completo casi nunca
suelta código». Tampoco: `cfdi.ts:274-276` dice lo contrario en el propio repo
("un ticket puede traer QR y código de barras a la vez (Office Depot trae los
dos)"), toda factura impresa lleva QR del SAT y las casetas llevan barras.

---

### [ALTO] El que reclama la foto retenida puede fallar DESPUÉS de borrarla, y el comprobante ya no existe en ningún lado
`src/lib/cuadra/processor.ts:466-470` · `src/lib/cuadra/repo.ts:404-414`

`reclamarFotoPendiente` **borra** la fila y devuelve el `media_id`. A partir de
ese instante el ticket retenido vive solo en la memoria de esa invocación: la
que esperaba ya devolvió `true` y salió por `:496` sin procesar nada.

Escenario, con valores:

- P1 = ticket de diésel de **$8,412.00** sin código legible → `fp-1`.
- P2 = acercamiento legítimo a ese mismo código.
1. P2 reclama `fp-1` → la fila se borra.
2. `downloadMediaAsDataUrl('media-P1')` devuelve **`null`** — Graph contesta 401
   (`190`, token rotado) o 404 (media caducado); `meta/client.ts:185,191`
   devuelven `null` y solo escriben `wa.media_no_descargada`.
3. `if (dataUrlPendiente)` (`:469`) es falso → **se descarta en silencio**, sin
   una sola línea de log propia → `imagenes` se queda con el acercamiento solo.
4. `extraerComprobante(acercamiento)` → `montoCodigo = 8412`, `montoOcr = null`
   → `soloCodigo` → `emparejarPorMonto(8412, [])` no encuentra nada →
   `pedir_ticket` → el operador recibe *«Ya tengo el código de ese ticket 👍.
   Mándame también la foto del ticket completo»* — la foto que acaba de mandar y
   que el sistema acaba de tirar.

Misma familia, mismo final: si P2 revienta en cualquier punto posterior al
reclamo (`extraerComprobante` lanza, la invocación muere), el `catch` general
manda *«se me trabó tantito, ¿me reenvías tu último mensaje?»* — y su último
mensaje es el **acercamiento**, no el ticket.

**Consecuencia:** un comprobante de $8,412.00 que el operador mandó no está en la
base, y el mensaje que recibe le pide justamente lo que ya hizo. Bucle sin
salida por su lado.

**Causa raíz probable:** el reclamo es destructivo y no hay compensación. El
propio archivo trata `dataUrl == null` como un caso ESPERADO para la foto propia
(`:407`, con mensaje al operador) y como un no-caso para la retenida.

---

### [ALTO] Un blip en el sondeo procesa el mismo ticket DOS veces
`src/lib/cuadra/processor.ts:484-497` (el resultado que se tira está en `:494`)

```ts
try { laTomoOtro = await esperarReclamoDeFoto(op.tenantId, idPendiente); }
catch (e) {
  logger.warn('foto.pendiente_espera_error', …);
  try { await reclamarFotoPendiente(op.tenantId, { id: idPendiente }); } catch {}
}
if (laTomoOtro) return;
```

El reclamo de rescate **devuelve si consiguió la fila o no**, y ese valor se
descarta. `null` significa exactamente "otro ya se la llevó y ya la está
procesando", que es la única condición que debía poner `laTomoOtro = true`.

Escenario, con valores:
1. P1 (ticket de **$8,412.00**, folio impreso `A-4501`) → `fp-1` → sondea.
2. P2 (acercamiento) reclama `fp-1` y procesa el par → `addGasto` **A**:
   $8,412.00, folio `A-4501`, `img_hash = sha256(P2)`.
3. El sondeo de P1 revienta por un blip de Supabase — `acotada` convierte el
   tope agotado en `{ data:null, error }` y `existeFotoPendiente` (`repo.ts:391`)
   **lanza**.
4. Cae al `catch` → `reclamarFotoPendiente({ id:'fp-1' })` → **`null`** (P2 ya la
   borró) → se tira → `laTomoOtro` sigue en `false` → P1 sigue de largo y hace su
   propio `extraerComprobante(P1)` → `addGasto` **B**: $8,412.00, folio `A-45O1`.
5. `copiasDeComprobante` (`engine.ts:147`) deduplica por
   `concepto|folio|monto`. El folio es justo el campo que —lo dice `ocr.ts:346`—
   "el OCR leyó distinto en cada corrida sobre el mismo ticket": `A-4501` vs
   `A-45O1` no empatan, y los dos gastos entran al comprobado.

**Consecuencia:** $16,824.00 de comprobado por un ticket de $8,412.00. La
diferencia contra el anticipo sale a favor del operador por dinero que no gastó,
y la flota lo paga. Si el folio sí empata, el contralor recibe un "Comprobante
duplicado" por un duplicado que el sistema se fabricó solo.

**Causa raíz probable:** el `catch` trata el rescate como best-effort ("libera la
fila por si acaso") cuando en realidad es la consulta que resuelve la carrera.

---

### [ALTO] `guardiaFundamento` ahora certifica una cita bien *nombrada* y mal *aplicada*
`src/lib/cuadra/processor.ts:1106-1118` · `src/lib/cuadra/normas/fundamento.ts:265-279`

Verificado lo que pedía el encargo: `:1108` filtra de verdad a `t.role ===
'assistant'`, nunca lee el turno del operador, y `conv.turns` sí está acotado al
viaje (`conv.ts:200-204` descarta el historial si `viaje_id` no coincide, y
`saveConversation` lo pone en `null` al cerrar). Esa parte está bien.

El problema es otro: el permiso se concede **por id de norma**, no por
afirmación, y dura todo el viaje. La regla que el propio archivo declara —"el
modelo solo puede referenciar una norma que una tool le devolvió EN ESE TURNO"
(`fundamento.ts:14-15`)— ya no es la que el código aplica.

Escenario, con valores:
1. Turno 1 (sin cierre): el operador escribe "¿cuánto llevo?" → el agente llama
   `cuadrar_viaje` → `guardiaCifras` sustituye por `resumenCuadre(liq, false,
   'operador')`, que trae la nota de `engine.ts:250`: *«Diésel pagado en EFECTIVO
   — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla
   2.9)»*. Como `closed = false`, `saveConversation` guarda ese turno `assistant`
   **con el viaje vivo**.
2. Turno 2: "¿y la caseta de $312 sí me la puedo deducir?". El modelo contesta de
   memoria, **sin ninguna tool**: *«Sí, la caseta es deducible al 100%; la regla
   2.9 de la RFA 2026 lo permite.»*
3. `permitidas` = `[] ∪ yaEntregadas` = `['rfa-2026-2-9']` → `sobran` vacío →
   `forzado: false` → **la cita sale intacta**.

La regla 2.9 de la RFA es el tope del 15% de combustible en efectivo; no tiene
nada que ver con el peaje (que es LIF 20-A). La guardia acaba de firmar un
fundamento inventado.

**Consecuencia:** exactamente el daño que `fundamento.ts:9-12` dice existir para
evitar — "frente a un contralor con fiscalista, una cita inventada cuesta más
que un número mal puesto". Y ahora con el sello de la guardia encima.

**(REINCIDENTE, en la otra dirección.)** La ronda 8 reportó que sin tools la
guardia *mutilaba* cualquier cita; `b65eb4f` lo cerró abriendo este.

*Intento de refutación:* el comentario del commit dice "repetir una cita que YA
se entregó no es alucinar: es memoria". Es cierto para la repetición literal de
la misma afirmación. No lo es aquí: nada ata la cita a la afirmación que la
justificó, y el turno sin tools es justo donde el modelo improvisa.

---

### [MEDIO] `foto_pendiente` no caduca: una fila huérfana empareja horas después
`supabase/migrations/0038_foto_pendiente.sql:30-37` · `src/lib/cuadra/repo.ts:404-414`

La tabla tiene `creado_en` y **nadie lo mira**: `reclamarFotoPendiente` filtra
por `tenant_id` y `viaje_id`, sin cota de edad, y no hay TTL, ni job, ni sonda de
arranque (`startup.ts` no la incluye).

Escenario: el doble fallo del hallazgo anterior (el sondeo revienta **y** el
reclamo de rescate revienta, `:494` se traga la excepción) deja `fp-1` viva
apuntando a `media-P1`, que ya se registró como gasto. Cuarenta minutos después,
mismo viaje, el operador manda el acercamiento de OTRO ticket de $312:
`reclamarFotoPendiente({ viajeId })` se lleva `fp-1`, vuelve a descargar
`media-P1`, fusiona `[ticket viejo, acercamiento nuevo]`, corre el OCR sobre el
ticket viejo y da de alta **otra vez** ese gasto — mientras el acercamiento nuevo
pierde su código.

**Consecuencia:** doble conteo del ticket viejo y pérdida del folio del nuevo, con
horas de distancia entre causa y efecto (lo peor de depurar).

**Causa raíz probable:** el diseño asume que la fila vive "segundos" (lo dice la
migración) y no pone nada que lo garantice; la ronda 8 ya pagó esta lección con
el contador de intake, que sí acabó necesitando TTL (mig. 0031).

---

### [MEDIO] El aviso de barrera vencida afirma un cuadre que no ocurrió
`src/lib/cuadra/processor.ts:1171-1177`

`470f5f3` cerró lo que se reportó —el CONSEJO ahora se bifurca con `closed`, lo
verifiqué— pero la primera mitad de la frase no se tocó y afirma un hecho.

Escenario: llegan en un lote 6 fotos y el texto "buenas tardes". El OCR de una
tarda más de 20 s → `esperarIntake` devuelve `false`. El agente contesta el
saludo sin llamar ninguna tool → `closed = false`, no hay liquidación, el viaje
sigue `abierto`. Acto seguido sale: *«⚠️ Ojo: cuadré con los 5 comprobantes que
alcancé a procesar. Si te faltó alguno, reenvíalo y escribe listo otra vez.»*

**Consecuencia:** el operador entiende que su viaje se cerró con 5 de 6
comprobantes. Es la misma clase de mentira que `guardiaEstado` existe para
tapar ("ya quedó cerrada"), solo que este texto lo escribe el sistema y no pasa
por ninguna guardia.

**Causa raíz probable:** el mensaje se escribió para el camino del "listo" y se
disparó desde `!intakeOk`, que es independiente de si hubo cuadre.

---

### [MEDIO] El `img_hash` del par fusionado es el del acercamiento, no el del ticket
`src/lib/cuadra/processor.ts:413-415, 668`

`imgHash` se calcula sobre `dataUrl` —la imagen del mensaje actual— antes de
cualquier fusión. Cuando el acercamiento procesa el par, el gasto del **ticket**
se guarda con `img_hash = sha256(acercamiento)`.

Escenario (con `CUADRA_DEDUP_FOTOS=1`, que está puesto en `.env.local:35`): P1
(ticket de $2,300) + P2 (acercamiento) se fusionan → un gasto con el hash de P2.
Minutos después el operador reenvía P1 porque cree que no entró:
`gastoExistePorHash(v1, sha256(P1))` → `false` → pasa el pre-check, pasa el
índice `uq_gasto_img_hash` (mig. 0015, el hash es distinto) → `alta` → segundo
gasto de $2,300.

**Consecuencia:** el tercer candado del dedup deja de cubrir justo la foto por la
que se creó. Antes de `foto_pendiente` ese ticket sí dejaba su hash.

**Causa raíz probable:** la fusión cambió qué imagen produce el gasto y no se
movió el cálculo del hash con ella.

---

### [MEDIO] Dos XML del mismo total en el mismo lote se pisan sobre el mismo gasto
`src/lib/cuadra/processor.ts:797-834` · `src/lib/cuadra/intake/emparejar.ts:118-134`

`8433db4` sí puso la barrera de intake en el XML (`:783` `intakeDelta(+1)`,
`:879` el `-1` en `finally`) — verificado. Lo que **no** tomó, y el hallazgo de la
ronda 8 nombraba, es el mutex del viaje. Para la foto eso es inocuo (cada una
inserta lo suyo); para el XML no, porque es un *read-modify-write*: `getGastos` →
`find` → `updateGastoCfdiXml`.

Escenario: la oficina reenvía en un solo envío los dos XML de dos cargas de
diésel de **$8,000.00** del mismo día, y solo una se fotografió. Los dos corren
en paralelo (`route.ts:72`), los dos hacen `getGastos` antes de que ninguno
escriba, los dos ven el mismo ticket sin `cfdi_uuid` de $8,000 →
`emparejarXmlConTicket` devuelve **el mismo gasto** a los dos → los dos hacen
`updateGastoCfdiXml` sobre él. Gana el último. El UUID, el RFC emisor, el IVA y
el IEPS del primero quedan sobrescritos; `saveCfdiXmlRaw` guarda su XML crudo
apuntando a un gasto que ya no lleva su UUID.

**Consecuencia:** un CFDI timbrado desaparece del acreditamiento —IVA y estímulo
de diésel— y la ruta del XML es **silenciosa por diseño** (`:881`), así que nadie
se entera hasta la conciliación.

**Causa raíz probable:** el brazo del XML se modeló como "igual que la foto"
cuando su escritura es sobre una fila compartida, no sobre una nueva.

## Lo que revisé y está bien

- **Los tres arrastres de la ronda 8, verificados en el código, no en el mensaje
  de commit:** el consejo del aviso de barrera se bifurca con `closed`
  (`processor.ts:1174-1176`); `guardiaFundamento` ya no mutila la cita repetida y
  el test `processor_fundamento_historial.test.ts` corre `processInbound` de
  verdad (no lee el fuente); el XML sostiene el `+1/-1` de la barrera con el `-1`
  en `finally`. Los tres cerraron lo que decían cerrar.
- **`turns` está acotado al viaje.** `loadConversation` exige `data.viaje_id ===
  viajeId` y descarta con log; `saveConversation` pone `viaje_id = null` al
  cerrar. Un cuadre del viaje A no puede contaminar el prompt del viaje B.
- **El destinatario.** Los tres llamadores de `resumenCuadre`
  (`processor.ts:966`, `:1049`, `guardia.ts:114`) pasan `'operador'`
  explícitamente; el default `'contralor'` está razonado en la dirección segura.
  `SOLO_CONTRALOR` filtra EFOS, cancelado, RFC receptor y el nuevo
  `permiso_cre_no_verificable`, y `complemento_no_verificable` está fuera con
  razón escrita. No encontré ruta por la que un veredicto del contralor llegue
  al chofer salvo que `guardiaCifras` lance (su `catch` interno lo hace
  improbable).
- **Cifras.** `guardiaCifras` sustituye el texto SIEMPRE que hubo
  `cuadrar_viaje`/`guardar_liquidacion`, sin dejar que el detector de regex
  decida sobre el camino feliz, y usa el snapshot de la tool en vez de releer la
  base (AG-3). El prompt sí invita al modelo a narrar cifras
  (`prompts.ts:25`), pero el determinismo lo impone el código, no el prompt.
- **Presupuesto y muerte por tiempo.** El reloj arranca en la primera línea,
  `PRESUPUESTO_WEBHOOK_MS` está sincronizado con `maxDuration` por prueba, el
  agente se salta con `resumenCuadre` determinístico si no alcanza (`:962-972`),
  y `acotada` cubre repo, conv, costos y config, incluida `createSignedUrl`.
- **Claim del mensaje.** Todos los `return` tempranos que abandonan trabajo real
  liberan el claim (`:402`, `:787`, `:933`, `:1261`); `claimMessage` distingue
  los tres estados y el `indeterminado` sigue en vez de perder el mensaje.
- **Mutex.** `acquireViajeLock` separa error permanente (RPC ausente → abre,
  ERROR) de transitorio (reintenta), re-verifica el viaje tras tomarlo, y el
  turno abandonado ahora avisa y libera.
- **Recuperación de cierre parcial.** Los flags (`CUADRA_RECUPERAR_CIERRE_PARCIAL`,
  `CUADRA_INTAKE_GRACE_MS`, `CUADRA_DEDUP_FOTOS`, `CUADRA_INTAKE_ESPERA_MS`)
  están puestos en `.env.local`; la rama registra el costo antes del `if` y
  actualiza `ctxCerro`.
- **`saveConversation` solo guarda el turno del asistente si `say` devolvió id.**
- Salud del árbol: `npx tsc --noEmit` limpio, `npm test` 153 archivos / 1419
  pruebas en verde.

## Lo que NO alcancé a revisar

- **El árbol se estaba editando mientras auditaba.** `git status` mostró cinco
  archivos modificados sin commitear y `processor.ts`, `ocr.ts` y `pedir_fecha.ts`
  cambiaron a mitad de mi lectura (mtimes de las 17:35, dos sesiones en
  paralelo). Re-verifiqué el bloque de `foto_pendiente` contra el archivo actual
  y `processor.ts` solo cambió una línea (`:729`, `fechaRaw` → `fechaImpresa`),
  así que mis números de línea valen; pero no puedo garantizar lo mismo de
  `ocr.ts` y `pedir_fecha.ts`, que llevan cambios sin commitear.
- **No ejecuté ningún escenario de carrera.** Todos los hallazgos son por
  lectura del código; no monté un arnés que lance dos `processInbound` en
  paralelo contra un `foto_pendiente` simulado. Ese arnés es lo que convertiría
  el CRÍTICO en una prueba en rojo, y es lo que recomendaría escribir primero.
- **`tools.ts` a fondo** (leí solo el cableado de `guardar_liquidacion` y sus dos
  PDF). El ciclo de tool-calling de `openrouter.ts` —loop-guard, rondas,
  construcción de `PartialExecutionError`— lo di por bueno del rubro de tool
  calling.
- **El brazo del acercamiento con `codigo_pendiente`** (`pegarCodigoEnEspera`,
  mig. 0016) lo recorrí por encima: interactúa con `foto_pendiente` (son dos
  bandejas para el mismo protocolo, con reglas de unicidad distintas) y esa
  interacción merece una pasada propia.
- **El panel/`export`** y cualquier ruta que no sea el webhook de WhatsApp.
