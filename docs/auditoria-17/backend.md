# Backend y API — auditoría 17

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura**. Los
cierres de las rondas 13–16 se mantienen (los verifiqué uno por uno, abajo), pero
QStash entró al camino del dinero en cuatro commits (`91c41db`, `4cd1eb4`,
`4568121`, `ec012da`) **sin una sola prueba**: `route.test.ts` nunca define
`UPSTASH_QSTASH_TOKEN`, así que sus 40+ casos ejercitan la rama síncrona —la que
producción **no** toma— y el archivo `cola/route.ts` no aparece en ningún test del
repo. El ancla del rubro es explícita: *"6 si es correcto por lectura y no por
prueba"*. Encima, una mirada más profunda encontró un lee-modifica-escribe con el
error descartado que borra señales de fraude ya detectadas.

Compuerta corrida hoy por mí: `npx vitest run` → 249 archivos, 3148 verdes, 1
saltada (60.9 s). `npx eslint src/` → 0 errores, 18 warnings. Coincide con el MAPA.

**El riesgo mayor del rubro hoy:** el cron de facturación puede responder 200 y
verde en el panel de Vercel durante semanas sin que se emita una sola factura,
porque desde la ronda 16 el trabajo real ocurre en otro proceso (el callback de
QStash) y nada en la respuesta del cron demuestra que ese proceso corrió.

---

## Hallazgos

### [ALTO] El cron de facturación declara `corrio: true` cuando lo único que hizo fue encolar; si el callback rebota, el cron se queda verde para siempre

`src/app/api/cron/facturar/route.ts:308-337` (el enqueue) y
`src/app/api/cron/facturar/cola/route.ts:21-28` (el 503 del callback).

**Escenario.** `UPSTASH_QSTASH_TOKEN` está puesto en Vercel pero
`QSTASH_CURRENT_SIGNING_KEY` **no** (son variables distintas; `.env.example` solo
las documentó en `468ec1f`, *después* del commit de la funcionalidad `91c41db`, y
`4cd1eb4` existe precisamente porque la primera versión verificaba con el token en
vez de con las signing keys). A las 12:30 el cron:

1. lee 8 gastos con `cfdi_uuid IS NULL` (línea 278-294),
2. entra al `if` de la línea 308, `publishJSON` devuelve `messageId: "msg_abc"`,
3. responde `200 {corrio: true, encolado: true, messageId: "msg_abc", tickets: 8}`.

QStash entrega el mensaje a `/api/cron/facturar/cola`. Ahí, línea 25-28:
`!currentKey` → `503 {error:'QStash no configurado'}`. QStash reintenta 2 veces
(`retries: 2` en la línea 320), las dos rebotan igual, el mensaje muere en el DLQ
de Upstash. **Ningún gasto se tocó: no se selló `autofactura_intentada_en`, no se
bloqueó nada, no hay un `logger.error` del lado del cron.** A las 13:30 se repite
idéntico, y a las 14:30, y así 24 veces al día. Vercel pinta el cron en verde
porque el cron devolvió 200.

**Consecuencia.** Es literalmente el modo de falla que este módulo se escribió para
no tener — sus propias líneas 86-96 lo dicen (*"Un 200 con la lista vacía dejaría
el cron verde en el panel de Vercel para siempre"*) y `route.test.ts:10` lo repite
(*"Un cron en verde que no hace nada es peor que uno en rojo"*). Para la flota son
tickets que caducan: 7-15 días en gasolineras. Para Javier, la única señal de que
la facturación automática lleva un mes sin correr sería que alguien abra la
pantalla de "por facturar" y cuente. Y para el equipo: **no hay prueba que cubra
ninguno de los dos lados de este camino** — ni el `if` de la línea 308, ni la
verificación de firma, ni el re-chequeo de vigencia de `cola/route.ts:61-69`.

**Causa raíz probable:** el `return` de la línea 324 afirma un hecho (`corrio`) que
solo el callback puede constatar, y no hay marca en base ni contador que ate el
`messageId` publicado a un lote efectivamente procesado.

**Nota colateral del mismo bloque:** `route.ts:258` calcula `modo` y no lo usa
(eslint no lo marca), así que la respuesta del camino encolado es la única que
**no** dice si el lote va a correr en `ensayo` o en `emitir` — el dato que
distingue un ensayo de un CFDI irreversible ante el SAT.

---

### [ALTO] `updateGastoCfdiXml` descarta el error de su propia lectura y luego reemplaza `ocr_extra` entero — borrando las señales de fraude que el motor ya había detectado

`src/lib/likida/repo.ts:414-420` (el `const { data: actual }` sin `error`) y
`:421` (el UPDATE que escribe `extra.ocr_extra` completo).

**Escenario, con valores.** El chofer manda la foto de un ticket de gasolinera de
$8,450. El intake guarda
`ocr_extra = {producto:"PLUS", estacion:"E12345", urlFacturacion:"https://...",
folioPortal:"A-000123", codigoBarras:"…", montoDiscrepante:true, montoOcr:8054}`.
Horas después la oficina reenvía el XML del monedero; `processor.ts:1422` entra por
la rama `eraTicket` y llama a `updateGastoCfdiXml` con `claveUnidad:'LTR'`,
`cantidad: 850`, así que se dispara el bloque de la línea 414.

Ese `SELECT ocr_extra` va envuelto en `acotada()`, y `acotada` **no lanza al agotar
el tope**: resuelve `{data: null, error: {message:'sin respuesta en 8000 ms (tope
de consulta)'}}` (`presupuesto.ts:156-163`, `TOPE_CONSULTA_MS = 8_000`). El
llamador solo desestructura `data`. Entonces `actual` es `null`,
`ocrExtra = {litros: 850}`, y el UPDATE de la línea 421 escribe **ese objeto
completo** sobre la columna.

**Sale mal:** `ocr_extra` queda en `{litros: 850}`. Se perdieron
`montoDiscrepante`, `montoOcr`, `producto`, `estacion`, `urlFacturacion`,
`folioPortal`, `codigoBarras`.

**Consecuencia.** El motor de cuadre lee justo esas llaves para levantar
diferencias que van al PDF del contralor: `engine.ts:381` (`monto_discrepante` — el
código decía $8,450 y la visión $8,054), `engine.ts:402` (`texto_sospechoso`) y
`engine.ts:398` (`comprobante_no_fiscal`). Con la columna borrada, la liquidación
sale **sin la anomalía que el sistema ya había detectado** y el contralor firma un
comprobado que nadie marcó. Además `identificarComercio` (`identificar.ts:31-35`)
pierde su señal más fuerte —el dominio del QR— y el ticket cae a `sinPortal` en el
cron, o sea que deja de facturarse solo, y `folioPortal` —el código que la oficina
teclea en el portal— desaparece del papel de "por facturar".

Lo llamativo es que el propio archivo declara la regla dos veces y aquí la rompe:
`repo.ts:411-413` (*"no se reemplaza el jsonb — ahí viven producto, estacion,
fechaImpresa… que una escritura a ciegas borraría"*) y `repo.ts:463-469`, que
explica que por esto exacto el merge de `enriquecerGastoConCodigo` se mudó a SQL
(mig. 0017) y nombra a `montoDiscrepante` y `textoSospechoso` como lo que se
perdía.

**Causa raíz probable:** el único lee-modifica-escribe de `ocr_extra` que quedó del
lado de la app usa `actual?.ocr_extra ?? {}`, que hace indistinguible "la fila no
tiene nada" de "no pude leer".

---

### [MEDIO] La cola de QStash se presupuesta con los 300 s del cron, no con sus 600 s: el techo que existe para romper sigue en pie

`src/app/api/cron/facturar/route.ts:25` (`maxDuration = 300`), `:129`
(`PRESUPUESTO_LOTE_MS = maxDuration * 1000`), `:158` (`MARGEN_LOTE_MS = 150_000`),
`:469` y `:509` (los dos cortes), contra
`src/app/api/cron/facturar/cola/route.ts:11` (`maxDuration = 600`).

**Escenario.** `procesarLoteEnCola` está definida en `route.ts`, así que cierra
sobre la constante de **ese** archivo. El callback la importa (`cola/route.ts:5`) y
la invoca con su propio `inicio` (`:72`). Un lote de 8 tickets repartido en 3
flotas: la primera abre navegador en t≈2 s y tarda 100 s; la segunda arranca en
t≈102 s y tarda 60 s; al llegar la tercera, t≈162 s, la comprobación de la línea
469 evalúa `162_000 >= 300_000 - 150_000` → **verdadero**, así que la tercera flota
sale como `sinTiempo` y se aplaza una hora. Al callback le quedaban ~438 s sin usar.

**Consecuencia.** La cola se construyó explícitamente para esto —su propio
comentario dice *"el techo de 300 s de una invocación directa es justo lo que esta
cola existe para romper"* (`cola/route.ts:8-10`)— y no lo rompe. Para la flota:
tickets que se aplazan una vuelta de reloj por cada corrida con más de dos flotas,
contra un plazo real de 7-15 días. Para el equipo: el número que se lee en la
respuesta (`sinTiempo`) parece capacidad agotada y no lo es, así que la conclusión
natural —"hay que subir `maxDuration`"— ya se aplicó y no cambió nada.

**Causa raíz probable:** `PRESUPUESTO_LOTE_MS` es una constante del módulo del cron
y no un parámetro de la función compartida, que es la que corre en dos hosts con
presupuestos distintos.

---

### [MEDIO] (REINCIDENTE, ronda 12 → 13) Dos handlers siguen resolviendo `?tenant=` a mano sin mirar `error`, con el helper que lo arregla ya escrito

`src/app/api/dashboard/asistente/route.ts:57` y
`src/app/dashboard/contador/cfdi/export/route.ts:55`.

Los dos hacen `const { data } = await supabaseAdmin().from('tenant').select('id')…`
y descartan `error`. `resolverTenantApi` (`tenant-api.ts:63-72`) y
`resolverTenantPedido` (`tenant-api.ts:92-99`) existen desde la ronda 12/13
precisamente para esto, con el comentario que lo dice con todas sus letras: *"sin
revisar `error`, un bache de red se ve idéntico a 'ese uuid no existe' — el `data`
es null en los dos"*. Solo las dos rutas de `export` los usan.

**Escenario.** Javier, superadmin, abre `/dashboard?tenant=<uuid de Transportes
Innovativos>`. La página de abajo resuelve por `resolverTenantEfectivo` y pinta las
cifras de Innovativos. En paralelo, el rail de la derecha pega a
`/api/dashboard/asistente?tenant=<mismo uuid>`; ese `select` agota el tope o
devuelve un 503 transitorio → `t` es `null` → el `if` de la línea 58 no entra →
`tenantId` se queda en `tenantDemo()` y `tenantNombre` en `null` (o sea, sin
badge). El rail devuelve 200 con `errorCarga: false` y pinta IVA, IEPS acreditable
y anomalías **de la flota demo**, junto a una página que dice Innovativos.

**Consecuencia.** Es exactamente lo que el encabezado de ese archivo dice que
existe para evitar (*"Dos verdades distintas en la misma pantalla"*, líneas 8-9), y
rompe la regla de producto "un rótulo tiene que ser verdad". En el demo del 6-ago
son cifras fiscales de otra empresa en la misma pantalla, sin una sola señal de
error. En el export de CFDI del contador el mismo patrón produce un CSV de la flota
de la sesión rotulado como si fuera el de la pedida.

**Causa raíz probable:** el helper se escribió y se cableó solo en los dos endpoints
donde se descubrió el bug; no hay prueba ni regla de lint que impida un sitio nuevo
que lo resuelva a mano.

---

### [MEDIO] `tenant.config` se escribe con lee-modifica-escribe desde dos módulos sin control de concurrencia: una política de gasto se puede perder sin log

`src/lib/likida/administracion.ts:272-278` (`guardarPolitica`) y
`src/lib/likida/repo.ts:926-934` (`actualizarFacilidad15`).

**Escenario, con tiempos.** El contralor guarda la política en
`/dashboard/politicas` con 13 conceptos. `guardarPolitica` lee `config` en
t=0.00 s. En t=0.10 s el flota_admin guarda la declaración de la facilidad del 15%
desde otra pantalla; `actualizarFacilidad15` lee el **mismo** `config` (todavía sin
los 13 conceptos). En t=0.20 s aterriza el UPDATE de `guardarPolitica`; en t=0.35 s
aterriza el de `actualizarFacilidad15`, que escribe el objeto que leyó en t=0.10 s
más su llave. La política vuelve a la anterior. Ninguna de las dos llamadas
devuelve error, `anotar(tenantId,'politica.editada',…)` deja constancia de una
edición que ya no está, y la pantalla recarga mostrando lo viejo.

**Consecuencia.** La política es lo que el motor de cuadre usa para decidir topes y
`requiereCfdi` (`engine.ts`), o sea que el siguiente viaje se liquida contra reglas
que el contralor cree haber cambiado. Es la misma clase de fallo que el comentario
de `guardarPolitica` (líneas 240-250) describe para el caso de un solo escritor
—*"se salta el bloque… una liquidación que declara todo deducible sin un solo error
en el log"*— pero por la vía de dos escritores.

**Causa raíz probable:** PostgREST no da transacción, y `config` se sobrescribe
entero en vez de con un `jsonb_set` en SQL o un update condicionado a `updated_at`
(el patrón que la mig. 0017 ya usa para `ocr_extra`).

---

### [BAJO] La URL destino del job firmado sale de una cabecera `Host` del que llama

`src/app/api/cron/facturar/route.ts:316`.

`const base = process.env.NEXT_PUBLIC_APP_URL ?? \`https://${req.headers.get('host')}\``.
Si `NEXT_PUBLIC_APP_URL` no está puesta —lo está, según CLAUDE.md, pero nada en el
código lo exige— quien pueda llamar al cron con `CRON_SECRET` y un
`Host: evil.example` hace que QStash publique el lote a
`https://evil.example/api/cron/facturar/cola`, con el cuerpo completo: `tenant_id`,
`concepto`, `monto`, `fecha`, `folio`, `rfc_emisor` y `ocr_extra` de 8 gastos
reales, y con dos reintentos de cortesía. **Consecuencia:** exfiltración de datos
comerciales de la flota por una cabecera, detrás del secreto del cron.
**Causa raíz probable:** el fallback usa una entrada no confiable para construir un
destino de salida.

---

### [BAJO] La verificación de firma de QStash no fija la URL, así que no se comprueba el `sub` del JWT

`src/app/api/cron/facturar/cola/route.ts:36-39`.

`receiver.verify({ signature, body })` se llama sin `url`. En la implementación
(`node_modules/@upstash/qstash/chunk-JYPXGFWX.mjs:1147-1150`) el chequeo de destino
está guardado por `if (request.url !== void 0 …)`, así que omitir el parámetro lo
salta: se valida `iss: "Upstash"`, `exp` y el hash del cuerpo, pero no que ese
mensaje fuera dirigido a **este** endpoint. **Consecuencia:** hoy es teórico —solo
existe un consumidor de QStash en el repo, así que no hay otro mensaje firmado que
redirigir— pero deja de serlo en cuanto se encole un segundo tipo de trabajo, y es
deuda que va a cobrar factura sin que nadie recuerde por qué. **Causa raíz
probable:** el parámetro es opcional en la librería y su ausencia no falla, falla
silenciosa.

---

### [BAJO] `/api/demo` parsea el cuerpo sin red

`src/app/api/demo/route.ts:32`. `await req.json()` sin `try/catch` en un endpoint
público y sin sesión: un POST con `Content-Type: application/json` y cuerpo `{`
sube una excepción sin capturar y Next devuelve un 500 genérico —ni el 400 que le
correspondería, ni una línea de log—. El resto del archivo sí acota cuerpo
(`bodyExcede`, 64 KB) y tasa (30/min), así que la puerta está a medio cerrar.
**Consecuencia:** ruido de 500s en Sentry indistinguible de un fallo real del motor
de cuadre, justo en la ruta que se enseña en vivo.

---

## Lo que revisé y está bien

Esto vale tanto como lo de arriba: son los cierres de rondas anteriores que
**siguen puestos**, verificados leyendo el código y nombrando la prueba.

- **La carrera del doble CFDI está cerrada por Postgres, no por un `if`.**
  `al_vuelo.ts:627-659`: el claim es un `UPDATE … .or('autofactura_intentada_en.is.null,
  autofactura_intentada_en.lt.<vencido>') .select('id')` — condicional sobre la
  columna que el propio UPDATE pisa, así que el segundo proceso se queda sin filas.
  Falla **cerrado** si el update devuelve error (`:651-657`). Probado en
  `al_vuelo.test.ts:649-790` (el sello, su forma y el orden de la 0063).
- **Un reintento del callback de QStash no re-emite.** Lo verifiqué contra los
  números, no por lectura: el backoff de QStash pone el primer reintento a ~12 s y
  el segundo a ~148 s del fallo, y `CLAIM_MINUTOS = 10` (`al_vuelo.ts:604`) son
  600 s. Los tres intentos caen dentro de la ventana del claim, así que el segundo
  y el tercero salen por `ya_en_proceso` (`al_vuelo.ts:387-392`). Además
  `cola/route.ts:61-69` re-consulta `cfdi_uuid IS NULL` antes de procesar. **Esto
  no tiene prueba**, pero el mecanismo es correcto.
- **El tenant no se puede confundir por el cuerpo del callback.** Aunque el `lote`
  llega en el body, `facturarLoteAlVuelo` releé con
  `.eq('tenant_id', args.tenantId).in('id', args.gastoIds)` (`al_vuelo.ts:343-347`)
  y descarta el gasto cuyo comercio no sea el del lote (`:410-414`, con
  `logger.error`). Un `tenant_id` manipulado sale como "no existe en esta flota".
- **Guardar el UUID no se traga su fallo.** `al_vuelo.ts:508-536`: si el UPDATE
  falla, el gasto se **bloquea** con el UUID dentro del motivo y distinguiendo
  `CU001` (viaje ya liquidado) de `23505` sobre `uq_gasto_cfdi_uuid`. Sale de la
  cola automática en vez de volver a emitir. `pg_errores.ts:40-45` exige el código
  **y** el nombre del índice antes de tragarse nada.
- **El cierre de liquidación es una sola transacción.** `repo.ts:605-620`:
  `guardar_liquidacion_tx` (mig. 0013) hace liquidación + viaje en un plpgsql; el
  error sube. Ya no hay "segunda escritura ignorada" ahí.
- **Idempotencia del webhook de WhatsApp.** `conv.ts:343-353`: `claimMessage`
  distingue tres estados y solo `23505` cuenta como duplicado; el indeterminado se
  sigue procesando a propósito (`processor.ts:332-340`) porque los efectos con
  dinero traen su propio candado.
- **El mutex del viaje distingue "ocupado" de "no supe".** `conv.ts:418-464`:
  `rpcAusente` (migración sin aplicar) abre con `logger.error`; el transitorio
  reintenta con backoff y solo abre tras agotar la ventana. Y tras tomarlo se
  re-verifica que el viaje siga abierto (`processor.ts:1764`), con
  `getOpenViaje` lanzando `ConsultaFallida` en vez de devolver `null`
  (`conv.ts:178`) — que era el camino por el que se le afirmaba al chofer "ese
  viaje ya quedó cerrado" sobre un viaje abierto.
- **La barrera de ráfaga falla cerrada.** `conv.ts:488-497` y `:524-548`: `null` es
  "no sé" y no abre; el contador vencido a 10 min sí. `esperarIntake`
  (`:598-609`) devuelve `false` y el llamador avisa.
- **Las lecturas paginadas no devuelven cifras parciales.** `pg.ts:137-175`:
  `traerTodo` avanza por filas leídas (no por número de página), exige el `count`
  o una página vacía, y lanza `LecturaIncompleta`. El export lo maneja
  explícitamente (`export/liquidaciones/route.ts:73-80`).
- **El webhook de Stripe marca antes de aplicar y desmarca al fallar.**
  `stripe/webhook/route.ts:60-76` + `:79-89`, con 503 si falta el secreto y 500 a
  propósito para que Stripe reintente.
- **Los dos endpoints de export cierran rol + área + tenant.**
  `export/pdf/[id]/route.ts:63-71` y `export/liquidaciones/route.ts:47-55`; el 404
  no distingue "no existe" de "existe sin PDF" (`pdf/[id]:91`) y la descarga va por
  URL firmada de 60 s sobre bucket privado (`:93-103`).
- **El 429 del webhook de WhatsApp en vez de 200.** `whatsapp/route.ts:244-249`:
  lo que pasa del techo se aplaza usando la cola durable de Meta, y lo que cabe se
  procesa. `route_pool.test.ts` cubre el pool de 5 y `acuses.test.ts` los
  `value.statuses`.
- **`proxy.ts` no es la puerta de `/api`** y está dicho: su matcher excluye `/api`
  (`:148`), y cada handler resuelve su propia autorización. La única ruta de API
  fuera de `/api` —`dashboard/contador/cfdi/export/route.ts`— cae bajo
  `RUTAS_CON_SESION` por el prefijo `/dashboard` (`proxy.ts:94`), así que lleva las
  dos capas.
- **`acotada` convierte el cuelgue en `{data:null,error}` por el mismo camino que
  un error de Postgres** (`presupuesto.ts:148-169`), que es la decisión correcta —
  y es justo lo que hace que el hallazgo ALTO #2 sea alcanzable: cualquier llamador
  que descarte `error` convierte un timeout en un dato vacío.
- **El renombre Cuadra→Likida no dejó rutas huérfanas.** Crucé las 16 rutas de
  `src/app/api` contra las 13 cadenas `/api/...` referenciadas en el código y en
  `vercel.json`: no hay referencia a una ruta inexistente ni ruta sin referencia
  (`/api/cron/*` las llama `vercel.json`, `/api/cron/facturar/cola` lo llama
  QStash). Los `process.env.CUADRA_*` que quedan (`CUADRA_CAPTURAS_DIR`,
  `CUADRA_INTAKE_ESPERA_MS`, `CUADRA_TOPE_CONSULTA_MS`, `CUADRA_CHROMIUM_PATH`,
  `CUADRA_MODEL_*`) coinciden con `.env.example`: el renombre no rompió ningún
  contrato de configuración.
- **`duplicados.ts` es lógica pura y sin bordes de base** (`:82-117`), con
  `buscadorDeUuidEnLlave` (`:66-80`) devolviendo la misma respuesta que la versión
  O(G×U). Nada que reportar.

---

## Lo que NO alcancé a revisar

- **`processor.ts` completo** (136 KB). Recorrí el arranque (`:325-430`), la rama
  de XML (`:1382-1490`) y el cierre con mutex (`:1720-1830`, `:2239`). Las ~1,000
  líneas de las ramas de imagen, huérfanos y consulta del chofer las leí solo por
  encima.
- **`src/lib/likida/facturacion/adaptadores/`** (`pagina_playwright.ts`,
  `capufe.ts`, `registro.ts`): el comportamiento de `conNavegador` bajo corte de
  presupuesto lo di por bueno desde el llamador, no leyendo el adaptador.
- **`agente.ts` / `facturarLoteConAgente`**: no verifiqué qué garantiza sobre el
  orden de `porGasto` frente a `tickets`, del que depende el reparto de
  `cfdi_orden` en `guardarUno` (`al_vuelo.ts:481-483`).
- **Las funciones plpgsql** (`guardar_liquidacion_tx`, `try_lock_viaje`,
  `intake_delta`, `enriquecer_gasto_codigo`, `mantenimiento_de_datos`): las traté
  como caja negra. Su contenido es del auditor de modelo de datos.
- **No pude ejercitar ninguna ruta contra una base real** (sin credenciales en este
  entorno) ni correr `npm run build`, así que todo lo de QStash está verificado por
  lectura del código y del paquete instalado, no en vuelo.
