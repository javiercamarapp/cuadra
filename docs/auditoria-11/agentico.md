# Sistema agéntico y orquestación — auditoría 11

**Nota: 3/10** (antes 3). Razón del movimiento: **mirada más profunda sobre el
mismo código**. No hay movimiento, y la razón es aritmética: este árbol es
`master`, los arreglos de la ronda 10 viven en el PR #7 sin mergear, y verifiqué
uno por uno que **los seis hallazgos de la ronda 10 siguen presentes aquí, en
líneas casi idénticas** (`processor.ts:1058-1059` es carácter por carácter el
mismo `if`). Encima, recorriendo el ciclo punto de muerte por punto de muerte
—que es lo que la ronda 10 dijo no haber podido hacer sin arnés— aparecieron
**seis estados nuevos en los que la base dice una cosa y el usuario cree otra**,
tres de ellos fuera de la sala de espera. El ancla del rubro («3 o menos si
existe un estado donde la base dice una cosa y el usuario cree otra») no se
cumple una vez: se cumple siete veces. El 3 es justo, y lo sostengo con
evidencia en vez de heredarlo.

> Riesgo mayor de hoy: **la afirmación del operador no está atada ni a la oferta
> ni al viaje**. Un «ok» o un «va» escritos semanas después de una pregunta que
> nadie repitió adjuntan comprobantes de un viaje anterior a la liquidación de
> hoy, sin una sola marca de fecha sospechosa (la tolerancia son 30 días), que
> es exactamente lo que `0040_comprobante_huerfano.sql:24-26` dice existir para
> impedir.

---

## Cómo lo recorrí

Ocho puntos de muerte del ciclo, con la pregunta del rubro en cada uno («si el
proceso muere AQUÍ, ¿qué ve el humano y qué quedó en la base?»):

| # | Punto exacto | Qué queda en la base | Qué ve el humano | Cierra |
|---|---|---|---|---|
| 1 | entre `claimMessage` (`:215`) y `resolveOperador` (`:251`) | mensaje reclamado | nada | ✗ (no hay reintento de Meta) |
| 2 | dentro de `guardarHuerfano` (`:321`) | nada o la fila | «no pude guardar ese comprobante» | ✓ |
| 3 | entre `marcarHuerfanosOfrecidos` (`:1061`) y `say` (`:1063`) | `ofrecido_en` puesto | **nada** | ✗ (H2/H3) |
| 4 | dentro del `for` de `addGasto` (`:1015-1025`) | gastos a medias, huérfanos sin resolver | «No pude agregarlos ⚙️. **lo intento otra vez**» | ✗ (H9) |
| 5 | tras `guardar_liquidacion`, antes del texto final | liquidación + 2 PDF + viaje `liquidado` | «se me trabó, ¿me reenvías?» | ✗ (H4) |
| 6 | entre `say(reply)` (`:1329`) y `sendDocument` (`:1413`) | todo cerrado | el cuadre sin PDF | ✗ (H5) |
| 7 | dentro de `sendDocument` (`:1413`) | todo cerrado | el cuadre sin PDF, **sin aviso** | ✗ (H5) |
| 8 | `ponerAvisoADisposicion` lanza (`:206`) | nada | «tu empresa no configuró su aviso» (falso) | ✗ (H8) |

Cinco de ocho no cierran el ciclo con el humano. Ese es el rubro.

---

## Hallazgos

### [CRÍTICO] «listo» (o «ya») con la sala de espera llena cierra la liquidación en $0.00 y los comprobantes nunca se ofrecen (REINCIDENTE, ronda 10)
`src/lib/cuadra/processor.ts:1058` (`pareceCierre`) y `:1059` (la condición);
bloque completo en `:1002-1066`, DESPUÉS del corte por «sin viaje abierto» de
`:272`. Fijado como correcto por `src/lib/cuadra/huerfanos_flujo.test.ts:248`.

Verificado en este árbol: la línea es idéntica a la que reportó la ronda 10.

```ts
const pareceCierre = /^\s*(listo|ya|ya est[aá]|termin[ée]|…)\b/i.test(msg.text);
if (!ofrecidos.length && !pareceCierre) { …ofrecer…; return; }
```

Escenario, con valores:

1. Martes 18:40, sin viaje abierto. El chofer manda 6 fotos: diésel $8,412.00,
   casetas $312.00 y $180.00, comida $340.00, hospedaje $900.00, diésel
   $6,100.00 = **$16,244.00**. Cada una entra por `:309-334` →
   `guardarHuerfano(motivo:'sin_viaje')`, y recibe UNA vez (`:333`) la promesa de
   `intake/huerfanos.ts:28-30`: *«no se pierden: en cuanto tu flota te asigne uno
   te pregunto si van ahí»*.
2. Miércoles: la oficina abre V1 con anticipo **$18,000.00**.
3. El chofer escribe **`listo`** (no tiene nada más que escribir: ya mandó todo).
4. `enEspera.length = 6`, `ofrecidos.length = 0`, `pareceCierre = true` → la
   condición de `:1059` es falsa → el bloque entero se salta **sin log y sin
   mensaje**. Sigue a la barrera (`:1071`), al mutex (`:1104`) y al agente.
5. Ni el prompt (`agents/prompts.ts:17-39`) ni el `history` (`:1124`) mencionan
   la sala de espera, así que el modelo no puede saber que existe;
   `guardar_liquidacion` (`tools.ts:149`) no tiene guarda de «viaje sin
   comprobantes», y `guardiaCifras` sustituye el texto por
   `resumenCuadre(liq, true, 'operador')`: **«Listo, cuadré tu viaje 👇 ·
   Comprobado: $0.00 · Anticipo: $18,000.00 · Sobró $18,000.00 del anticipo (a
   favor de la empresa)»** + PDF.

Estado final: `liquidacion` con `total_comprobado = 0`, viaje `liquidado`, y
**6 filas en `comprobante_huerfano` con `ofrecido_en` y `resuelto_en` nulos**.

**Consecuencia:** al chofer se le cargan $18,000.00 por comprobantes que sí mandó
y que Likida tiene guardados. Es demo-visible: el guion enseña el cierre por
WhatsApp.

**Causa raíz probable:** la decisión de `:1054-1057` supone que habrá un turno
posterior; el cierre es precisamente el turno que garantiza que no lo haya.

*Refutación intentada:* «el modelo verá cero gastos y no cerrará» — `prompts.ts:27`
dice literalmente «si el operador ya confirmó que terminó, CIERRA en ese turno…
NO le pidas que vuelva a confirmar», y aunque se negara, `guardia.ts:114`
sustituye el texto por el cuadre determinístico igual.

---

### [CRÍTICO] La afirmación no está atada ni a la oferta ni al viaje: un «ok» suelto adjunta los comprobantes de otro viaje
`src/lib/cuadra/processor.ts:1004` (`enEspera.filter(h => h.ofrecidoEn)`) ·
`:1010` (`if (ofrecidos.length && esAfirmacion(msg.text))`) ·
`src/lib/cuadra/intake/huerfanos.ts:109` (la lista de afirmaciones) ·
`src/lib/cuadra/repo.ts:274-291` (`getHuerfanos` no filtra por viaje) ·
`supabase/migrations/0040_comprobante_huerfano.sql:57` (`ofrecido_en` es un
timestamp: no guarda EN QUÉ VIAJE se preguntó, ni caduca)

El único requisito para adjuntar es que `ofrecido_en` no sea nulo. No se compara
contra el viaje en el que se hizo la oferta, ni contra el mensaje anterior, ni
contra ninguna ventana de tiempo. Y `esAfirmacion` acepta `ok`, `va`, `sale`,
`dale`, `claro`, `dale`, `todos` — muletillas de WhatsApp, no respuestas a una
pregunta concreta.

Escenario, con valores:

1. **14-jul.** V1 cierra. El chofer manda dos fotos más: diésel **$6,100.00** y
   caseta **$312.00** → `llegoTarde` (`:728`) → `guardarHuerfano(motivo:
   'tras_liquidar')`, con la promesa de `huerfanos.ts:42-43`: *«te lo agrego en
   cuanto abras tu siguiente viaje»*.
2. **15-jul.** Abre V2. Escribe «buenos días» → `:1059` se cumple →
   `marcarHuerfanosOfrecidos` pone `ofrecido_en` en las dos filas y se le
   pregunta. **No contesta**: sigue mandando fotos (las fotos ni pasan por este
   bloque, `:842` retorna antes) y luego escribe `listo` → hallazgo anterior →
   V2 cierra sin ellas.
3. **20-jul.** Abre V3, anticipo **$9,000.00**. Manda sus fotos de V3 y escribe
   **«va»** (o «ok», o «sale»).
4. `ofrecidos.length = 2` (de la oferta del 15-jul, en OTRO viaje),
   `esAfirmacion('va') = true` → `:1017` inserta los dos gastos en **V3** →
   *«Listo, agregué los 2 comprobantes a tu viaje ✅ — $6,412.00 en papel.»*

**Consecuencia:** $6,412.00 de combustible de un viaje de julio quedan en la
liquidación de otro viaje, con su IVA y su IEPS acreditados en el periodo
equivocado, y el contralor paga contra un PDF que no lo distingue. Es la frase
literal de la migración que creó la tabla: *«un ticket del viaje anterior metido
en el de hoy es dinero en la liquidación equivocada, y nadie lo nota hasta que el
contralor paga»*.

**Causa raíz probable:** `ofrecido_en` se modeló como «anti-repetición» y de
hecho es el estado de una máquina de conversación; le falta la otra mitad del
par (a qué pregunta y en qué viaje responde).

*Refutación intentada, y por qué no salva:* pensé que `fecha_sospechosa`
(`engine.ts:322-323`) marcaría el ticket viejo. No lo hace: la ventana la calcula
`ventanaDelViaje` con `fechaToleranciaDiasAntes = 30` (`config.ts:104`), así que
todo lo de los últimos 30 días entra sin una sola observación. Y aunque marcara,
la diferencia sale con `monto: 0` — la cifra comprobada sube igual. Segunda
refutación: «el chofer no dirá "ok" a la nada». Sí lo dice: `:802` le manda «📸
Voy recibiendo tus comprobantes… escribe *listo*», y contestar «va» a eso es
lo natural.

---

### [ALTO] La única recuperación del cierre a medias está detrás de un flag apagado por default, y nada verifica que esté puesto
`src/lib/cuadra/processor.ts:1187` (`const recuperar = process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1'`)
· `:1206-1207` (la guarda) · `:1232-1237` (el `else`) ·
`src/lib/cuadra/startup.ts:21-28` (`verificarEntornoCritico` solo mira
`DASHBOARD_SECRET`) · `.env.example:75` (lo recomienda ON) ·
`src/lib/llm/openrouter.ts:601-603` (todo error del ciclo se envuelve en
`PartialExecutionError` con `executed` dentro)

Escenario, con valores: el chofer escribe `listo` con $16,244.00 en 6
comprobantes y anticipo $18,000.00. El agente llama `consultar_politica`,
`cuadrar_viaje` y `guardar_liquidacion` — esta última **persiste la liquidación,
sube los DOS PDF y pone el viaje en `liquidado`** (`tools.ts:176-181`). En la
ronda siguiente, el modelo tarda y salta el `AbortSignal` de `reloj.acotar(40_000)`
(`:1158`) → `PartialExecutionError` con `guardar_liquidacion` dentro de
`partialToolCalls`. Con el flag ausente:

- `cierreParcial` es `undefined` → se toma el `else` de `:1232`;
- `reply = 'Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?'`;
- `closed` sigue `false` → **no se manda el PDF**, no se registra
  `pdf.no_entregado` (vive dentro del `if (closed)`), y `ctxCerro` queda `false`,
  así que el log del `catch` general —el que existe justamente para gritar
  `cerroSinEntregar`— tampoco se dispara;
- `guardiaEstado` no puede desmentir nada: recibe `cerro: closed = false`, que es
  falso, y el texto no afirma ningún cierre;
- el chofer reenvía «listo» → `getOpenViaje` devuelve `null` → **«No tienes un
  viaje abierto para liquidar ahorita»** (`:341`).

**Consecuencia:** liquidación cerrada, dos PDF en storage, el contralor la ve en
el panel, y el chofer se queda con «se me trabó» y luego con «no tienes viaje».
La información para cerrar el ciclo **está en memoria** (`parcial`, `:1188`) y se
tira por una variable de entorno. Y el comentario de
`openrouter.ts:402-403` afirma que el flag está «activo por default», que no es
cierto en el código de hoy.

**Causa raíz probable:** una recuperación de estado se dejó como flag de demo
(HARD RULE 3) en vez de como comportamiento, y el chequeo de arranque que existe
para las variables cuyo olvido falla en silencio no la incluyó.

---

### [ALTO] El PDF —el entregable— sale sin acuse: `sendDocument` devuelve `void` y su fallo no le dice nada al chofer
`src/lib/cuadra/processor.ts:1411` (URL firmada a **60 s**) · `:1413`
(`await sendDocument(...)`) · `:1414` (`registrarCostoWhatsApp` incondicional) ·
`src/lib/meta/client.ts:115` (firma `Promise<void>`) y `:127`
(`if (!res.ok) { logger.error(...); return; }`)

Este archivo pagó esta lección dos veces y las dos las escribió al lado: `say`
(`:361-366`) se cambió para DEVOLVER si el mensaje salió, y la constancia del
aviso de privacidad se movió a después del envío (`:193-203`). El envío del PDF
—que es el entregable del producto— se quedó con el patrón viejo.

Escenario, con valores: liquidación de V1 cerrada, `pdf_generado = true`, URL
firmada emitida a las 12:00:03 con TTL 60 s. `sendDocument` recibe 400 de Meta
(el `131030`/`131047` que este repo ya vio en producción el 1-ago) → se registra
`wa.sendDocument` y se **retorna normal**. En `processor.ts` no se lanza nada, así
que el `catch` de `:1415` no corre: no hay `pdf.no_entregado`, no sale el mensaje
*«Tu liquidación ya quedó cerrada ✅, pero no pude generarte el PDF…»* que existe
justo para este caso, y encima se cobra el costo de WhatsApp de un documento que
no salió.

Segunda puerta del mismo sitio: aunque Meta acepte, **descarga el `link`
después, por su cuenta** —lo dice `meta/client.ts:129-130`— contra una URL que
caduca en 60 s. Si esa descarga cae fuera de la ventana, el acuse llega por
`value.statuses` y se registra como `wa.no_entregado` (`route.ts:111`), donde
nadie lo lee ni lo reintenta.

**Consecuencia:** el chofer recibe el cuadre y nunca su PDF, sin una sola línea
que se lo diga; el único rastro es un log que no está atado al viaje ni dispara
nada. Es el modo de falla «se trabó» que el resto del archivo lleva tres rondas
cerrando.

**Causa raíz probable:** `sendText` se hizo devolver el `wamid` y `sendDocument`
no; el llamador nunca tuvo qué comprobar.

---

### [ALTO] La oferta se marca como hecha ANTES de entregarse, y es de un solo tiro (REINCIDENTE, ronda 10)
`src/lib/cuadra/processor.ts:1061` (la marca) y `:1063` (el envío) ·
`src/lib/cuadra/repo.ts:297-303`

```ts
if (!ofrecidos.length && !pareceCierre) {
  await marcarHuerfanosOfrecidos(op.tenantId, enEspera.map((h) => h.id));  // :1061
  await say(mensajeOfrecer(comoLista(enEspera), …));                        // :1063
  return;
}
```

`say` devuelve si el mensaje salió y aquí el resultado se tira; la condición de
re-oferta es `!ofrecidos.length`, así que una vez puesto `ofrecido_en`
**el bloque no puede volver a ejecutarse jamás**, en este viaje ni en ninguno.

Escenario, con valores: los 6 huérfanos de $16,244.00. El chofer escribe «hola»
con V1 abierto → las 6 filas quedan con `ofrecido_en` → `sendText` devuelve
`null` porque Meta responde `131047` (ventana de 24 h cerrada: su último mensaje
fue ayer). El chofer **no ve nada**. Cualquier mensaje posterior encuentra
`ofrecidos.length = 6` → `:1059` falso → nunca se re-ofrece. La base afirma «ya
se le preguntó» sobre una pregunta que nadie leyó, y el único camino que queda
abierto es el «ok» suelto del hallazgo anterior.

Tercer camino, hoy no cubierto: una respuesta PARCIAL. «no, el de diesel no» son
5 palabras normalizadas → `esNegacion` devuelve `false` (`huerfanos.ts:122`) y
`esAfirmacion` también → el mensaje cae al agente, que no sabe que la sala de
espera existe, y le contesta del cuadre. Los seis quedan pendientes y ya
inofrecibles.

**Consecuencia:** $16,244.00 en la base, invisibles para el chofer y para el
contralor, y la liquidación cierra sin ellos.

**Causa raíz probable:** `marcarHuerfanosOfrecidos` se modeló como
anti-repetición (best-effort, `repo.ts:295`) y de hecho es el único registro de
que la conversación pidió algo.

---

### [ALTO] El panel de Valor & Ahorro cuenta los comprobantes DESCARTADOS como «Amarrados a su viaje»
`src/lib/cuadra/analytics.ts:308`
(`huerfanos.filter(h => h.resuelto_en !== null …)`) ·
`src/app/dashboard/valor-ahorro/page.tsx:170-176` ·
`src/lib/cuadra/processor.ts:1048` (`resolverHuerfanos(..., 'descartado', null)`)

La columna que distingue los dos desenlaces es `resolucion`
(`'adjuntado' | 'descartado'`, `0040:46-48`), y la consulta no la mira: cuenta
`resuelto_en`, que se llena en los dos casos.

Escenario, con valores: el chofer recibe la oferta de 6 comprobantes por
$16,244.00 y contesta **«no»** (`:1047`) → las 6 filas quedan
`resolucion = 'descartado'`, `viaje_id = null`, fuera de toda liquidación. En
`/dashboard/valor-ahorro` el contralor lee: **«Llegaron sin viaje: 6 · Amarrados
a su viaje: 6»**, con la nota *«Comprobantes que se habrían perdido y acabaron en
su liquidación»* y el párrafo *«Estos se recuperaron»*.

**Consecuencia:** la pantalla que existe para demostrar el valor del producto le
afirma al comprador que seis comprobantes acabaron en una liquidación cuando no
están en ninguna. Rompe las dos reglas del producto a la vez: la cifra es real y
el rótulo es falso. Y es la pantalla que se enseña en la sala.

**Causa raíz probable:** el KPI se escribió contra el campo que dice «ya no está
pendiente» en vez de contra el que dice «acabó adentro».

---

### [ALTO] El asistente del panel convierte un fallo de lectura en «Todavía no hay liquidaciones»
`src/app/api/dashboard/asistente/route.ts:56-65` (el helper `safe()` que traga
la excepción y devuelve `null`) · `src/app/dashboard/chat.tsx:25`, `:28`, `:34` ·
`src/lib/cuadra/pg.ts:23-26` (`exigir` lanza a propósito, para que el fallo NO se
lea como vacío)

`exigir`/`traerTodo` existen justamente para traducir el error por valor de
supabase-js en una excepción —su comentario lo dice: *«el panel pintaba "Aún no
hay liquidaciones" con la base caída»*—. Este handler la vuelve a convertir en
`null`, y el chat traduce `null` a una afirmación sobre el negocio.

Escenario, con valores: 6-ago, 10:20, el contralor en la sala teclea **«¿Cuánto
llevo comprobado?»**. `getKpis` agota `TOPE_CONSULTA_MS` (8 s, `presupuesto.ts:101`)
o recibe un 503 → `traerTodo` lanza → `safe` devuelve `null` → la respuesta que
lee en pantalla es **«Todavía no hay liquidaciones para calcular esto.»** sobre
una flota con 40 liquidaciones cerradas. Lo mismo con «¿cuál es mi tasa de
cuadre?» y con el IVA acreditable.

Efecto gemelo en `src/app/dashboard/rail.tsx:112-131`: si el que falla es
`detectarAnomalias` (la consulta más pesada — barre TODOS los gastos del tenant),
`anomalias` llega `null` y el ternario cae al recuadro **verde** de «Smart
Insight» con la tasa de cuadre. El propio comentario de `:110-111` dice que «un
recuadro verde que dice "todo bien" cuando no se revisó nada entrena a
ignorarlo», y es exactamente lo que se pinta cuando el detector de duplicados
entre viajes no corrió.

**Consecuencia:** el asistente le contesta al comprador una negación inventada
sobre su propio dinero, en el canal que el producto vende como «pregúntale a tus
datos».

Y el mismo `null` significa ya **tres cosas distintas** que se renderizan
idénticas: «no hay datos», «no se pudo leer» y —desde el bloque de rol de
`:54-65`— «tu rol no puede ver el dinero». Un encargado que teclee esa pregunta
lee «Todavía no hay liquidaciones para calcular esto» en vez de «esto no te
toca».

**Causa raíz probable:** el `safe()` del handler se copió del patrón de las
páginas (donde el `null` sí se pinta como `EstadoVacio` declarado) a un
consumidor que traduce `null` a una frase afirmativa sobre el negocio.

*Nota de método:* este archivo estaba siendo modificado en el árbol por otro
auditor mientras yo lo revisaba (el bloque `puedeVerArea` de `:44-54` no estaba
al empezar). Las líneas pueden moverse; el ancla del hallazgo es el helper
`safe()` y el `?? null` de `:72`, que no cambiaron.

---

### [ALTO] Un blip de Supabase le dice al chofer que su flota no configuró el aviso, y le tira la foto
`src/lib/cuadra/processor.ts:206-210` (el `catch` que devuelve `false` ante
CUALQUIER excepción) · `:375-387` (el corte y su mensaje) ·
`src/lib/cuadra/repo.ts:595` (`getDatosResponsable` lanza ante error de consulta)
· `src/lib/cuadra/presupuesto.ts:148-169` (`acotada` convierte un cuelgue en ese
mismo error)

`ponerAvisoADisposicion` no distingue «el tenant no tiene razón social» de «la
base no contestó». Las dos devuelven `false`, y el llamador tiene un solo texto.

Escenario, con valores: 10:12 del demo. El chofer manda la foto del diésel de
$8,412.00. La consulta de `tenant` agota el tope de 8 s → `acotada` resuelve
`{ data:null, error:'sin respuesta en 8000 ms' }` → `getDatosResponsable` lanza →
`catch` de `:206` → `false` → el chofer lee: **«No puedo procesar tus
comprobantes todavía: tu empresa aún no ha terminado de configurar su aviso de
privacidad. Avísale a tu flota. 🙏»** y su foto se descarta sin guardarse en
ningún lado (el `return` de `:386` va antes del brazo de imagen). El claim del
mensaje tampoco se libera en ese `return`, al revés que sus dos vecinos
(`:428`, `:865`).

**Consecuencia:** el producto acusa por escrito al comprador de no haber
terminado su alta, delante del comprador, por un tropiezo de red — y pierde el
comprobante. La regla del repo es «fallar cerrado **y decirlo**»; aquí falla
cerrado y dice otra cosa.

**Causa raíz probable:** la función colapsa dos hechos distintos en un `boolean`,
el mismo error que `resolveOperador` y `getOpenViaje` ya corrigieron con
`ConsultaFallida`.

---

### [ALTO] La memoria por tema de `guardiaFundamento` sigue certificando una cita bien nombrada y mal aplicada (REINCIDENTE, rondas 8, 9 y 10)
`src/lib/cuadra/normas/fundamento.ts:204-215` (`citaEsMismoTema`), umbral en
`:197` · llamada en `:367` · cableado en `src/lib/cuadra/processor.ts:1293-1300`

La memoria se concede si la oración que trae la cita comparte **≥2 palabras** de
tema con la oración que la trajo antes. Ejecutado contra el código de hoy con
`permitidas = []` y el historial del resumen del motor (*«Diésel pagado en
EFECTIVO — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026
regla 2.9)»*):

| respuesta del modelo, sin ninguna tool en el turno | resultado |
|---|---|
| «Tu **caseta** pagada en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).» | **pasa entera** |
| «La **comida** que pagaste en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).» | **pasa entera** |

La regla 2.9 de la RFA 2026 es el tope del 15% del **combustible** en efectivo.
Ni una caseta ni una comida caben. El turno es alcanzable: sin `$` en la frase,
`guardiaCifras` sale en `guardia.ts:83`, `textoDeterminista` queda `false`
(`processor.ts:1243`) y la guardia de fundamento corre con `permitidas = []`, que
es el caso en que la memoria decide sola.

**Consecuencia:** el daño que `fundamento.ts` dice existir para evitar —una cita
inventada frente a un contralor con fiscalista— con el sello de la guardia
encima. Basta que el chofer pregunte «¿y la caseta también cuenta para ese tope?».

**Causa raíz probable:** la memoria ata la cita al VOCABULARIO, no a la
afirmación; y el vocabulario lo puso el propio sistema en el turno anterior, así
que el modelo que reformula bien la frase obtiene la memoria por reformularla.

---

### [MEDIO] El brazo de la sala de espera no toma la barrera ni el mutex, y su `catch` es el único que no reconoce «llegó tarde» (REINCIDENTE, ronda 10)
`src/lib/cuadra/processor.ts:1010-1026` (el `catch` en `:1019-1024`) ·
`src/lib/cuadra/pg_errores.ts` (`llegoTarde`, CU001)

El bloque corre **antes** de `esperarIntake` (`:1071`) y **antes** del mutex
(`:1104`), y no hace `intakeDelta(+1)`. Es el único camino que inserta gastos sin
ninguna de las dos protecciones: la foto tiene el contador (`:414`), el XML tiene
contador **y** mutex (`:861`, `:889`).

Escenario, con valores: el chofer contesta «sí» a 17 huérfanos ($28,041.15) y 3 s
después escribe «listo». Meta los entrega en el mismo POST y `route.ts:72` los
corre con `Promise.all`. El «listo» ve el contador en 0 —los huérfanos no lo
tocan—, pasa la barrera, toma el mutex y cierra. Los `addGasto` que aún no habían
corrido chocan con el trigger de la 0036 (`CU001`); el `catch` de `:1022` solo
reconoce `uq_gasto_img_hash` y `uq_gasto_cfdi_uuid`, así que `llegoTarde(e)` ni
se evalúa, la fila no entra en `puestos`, y el chofer recibe **«No pude
agregarlos ⚙️. Siguen guardados; lo intento otra vez en un momento.»** (`:1043`).

Ese reintento **no existe**: no hay `vercel.json` (verificado: el archivo no está
en el repo), no hay cron, y la re-oferta está bloqueada porque `ofrecido_en` ya
está puesto. Con el viaje liquidado, el siguiente mensaje recibe «No tienes un
viaje abierto».

**Consecuencia:** el chofer espera un reintento inventado mientras su liquidación
ya cerró sin esos comprobantes. Los otros dos brazos traducen CU001 a la verdad
(«llegó después de que cerré tu liquidación»); éste no.

**Causa raíz probable:** la sala de espera se modeló como flujo de conversación y
no como escritura al camino del dinero, que es lo que es.

---

### [MEDIO] Un «no» descarta TODO y el mensaje promete un rescate que no existe
`src/lib/cuadra/processor.ts:1047-1051` · `src/lib/cuadra/repo.ts:312-321`
(`resolverHuerfanos` pone `resuelto_en`) · `:279` (`getHuerfanos` filtra
`.is('resuelto_en', null)`)

```ts
await resolverHuerfanos(op.tenantId, ofrecidos.map((h) => h.id), 'descartado', null);
await say('Va, no los agrego a este viaje 👍. Si alguno sí era de aquí, dime cuál y lo pongo.');
```

Escenario, con valores: se le ofrecen 6 comprobantes por $16,244.00; el chofer
escribe **«no»** pensando en los dos de comida. Las 6 filas quedan resueltas y
salen para siempre de `getHuerfanos`. Obedece al mensaje y escribe «el de diesel
de 8,412 sí» → `esAfirmacion` no lo reconoce (más de 4 palabras), no hay ningún
otro lector de esa frase, y el mensaje cae al agente, que responde del cuadre.
No queda ninguna ruta —ni por WhatsApp ni por el panel: `comprobante_huerfano` no
tiene UI, verificado con grep sobre `src/`— para recuperarlos.

**Consecuencia:** $8,412.00 de diésel se pierden por seguir la instrucción que el
producto acaba de dar. La frase es literalmente una promesa sin implementación.

**Causa raíz probable:** el texto se escribió describiendo el flujo deseado, no
el implementado, y no hay prueba que compare uno con otro.

---

### [MEDIO] Un comprobante de la sala de espera entra sin `img_hash`: el tercer candado del dedup no lo cubre (REINCIDENTE, ronda 10)
`src/lib/cuadra/processor.ts:313` (se calcula `hashImagen(dataUrl)` para
`subirComprobante`) y `:321-324` (se guarda `ex.gasto`, que nunca lleva
`imgHash`) · `src/lib/cuadra/repo.ts:148` (`img_hash: g.imgHash ?? null`) ·
`src/lib/cuadra/cuadre/engine.ts:146` (`if (g.folio)` dentro de `copiasDeComprobante` — sin folio y sin UUID no hay dedup)

En el camino sin viaje no hay dedup alguno: `guardarHuerfano` es un `insert`
pelado y la 0040 no tiene índice único. El hash se calcula y se tira.

Escenario, con valores: sin viaje abierto, el chofer manda la foto de una caseta
de **$312.00** sin folio legible; WhatsApp marca fallo de envío y él la reenvía
(otro `waMessageId` → `claimMessage` no lo ve) → **dos** filas en
`comprobante_huerfano`. Al abrir el viaje se le ofrecen las dos («• Caseta ·
$312.00» dos veces), contesta «sí», y `:1017` inserta dos gastos con
`img_hash = null` (el índice único no colisiona con NULL) y sin folio →
`copiasDeComprobante` no los ve → el comprobado sube **$312.00** de más, y
`mensajeAdjuntados` lo confirma calculando el neto con el mismo dedup ciego
(`:1032-1040`).

**Consecuencia:** la diferencia sale a favor del chofer por dinero que no gastó,
y el acuse lo certifica.

**Causa raíz probable:** el `imgHash` viaja pegado al `addGasto` del camino con
viaje; la sala de espera se escribió con `ex.gasto` crudo.

---

### [MEDIO] El chofer ve en `/mis-viajes` el semáforo que se construyó para el contralor (REINCIDENTE, ronda 10)
`src/app/mis-viajes/page.tsx:8-12` y `:80` ·
`src/lib/cuadra/cuadre/engine.ts:1029-1030` (la lista `REVISAR`) ·
`src/lib/cuadra/cuadre/resumen.ts:24-33`

`SOLO_CONTRALOR` filtra del WhatsApp los veredictos que el chofer no puede
arreglar y que además lo señalan (`cfdi_efos`, `cfdi_cancelado`, `rfc_receptor`…).
Esos mismos tipos están en la lista `REVISAR` de `engine.ts:1029`, que produce `estatus = 'revisar'`, y `/mis-viajes`
pinta ese estatus con `--color-bad` y la etiqueta **«Por revisar»**.

Escenario, con valores: V1, comprobado $16,244.00, cuadra exacto; la única
diferencia es `cfdi_efos` —la gasolinera está en la lista 69-B—. Por WhatsApp
recibe el resumen **sin** esa observación (correcto, `resumen.ts:67`). Entra a
`/mis-viajes` y ve su viaje en rojo, «Por revisar», sin nota, sin explicación y
sin nada que pueda hacer.

**Consecuencia:** el canal nuevo del chofer entrega justo «la sensación de que se
le está auditando» que `resumen.ts:14-22` argumenta por escrito que hay que
evitarle. No se filtra el veredicto: se filtra su semáforo.

**Causa raíz probable:** el mapa `ESTATUS` se copió del panel del contralor sin
pasar por la pregunta de destinatario que el resto del sistema sí se hace.

---

### [BAJO] La tabla que documenta el cierre apunta a líneas que ya no existen, y un comentario afirma lo contrario del código
`src/lib/cuadra/presupuesto.ts:37-51` (`PASOS_CIERRE` cita
`processor.ts:591`, `:595`, `:658`, `:715`, `:734`, `:755`, `:757`, `:774`,
`:814`; hoy esas líneas están dentro del brazo de imagen y del `catch` general) ·
`src/lib/llm/openrouter.ts:402-403` («el processor —en su rama de recuperación de
cierre parcial, **con el flag activo por default**») contra
`processor.ts:1187` (`=== '1'`, o sea apagado por default).

La tabla existe para que meter un paso al cierre sea una prueba en rojo y no un
descuido silencioso (`presupuesto.test.ts` compara su suma con
`MARGEN_CIERRE_MS`); la prueba sigue verde porque compara MILISEGUNDOS, no
ubicaciones. Un mapa que apunta a otro sitio se deja de leer, y el comentario que
miente sobre el default es el que hizo falta para el hallazgo de arriba.

---

## Lo que revisé y está bien

- **Destinatario en WhatsApp.** Los tres llamadores de `resumenCuadre` pasan
  `'operador'` explícito (`processor.ts:1144`, `:1227`, `guardia.ts:114`); el
  default `'contralor'` (`resumen.ts:50`) está razonado en la dirección segura.
  Los dos PDF salen del mismo cierre (`tools.ts:176-177`) y el que va por
  WhatsApp es `-operador.pdf` (`:1399`), mientras `liquidacion.pdf_path` guarda
  el del contralor. No encontré ruta por la que el ejemplar completo llegue al
  chofer.
- **Claim, mutex y barrera.** `claimMessage` distingue los tres estados
  (`conv.ts:235-245`) y el `indeterminado` sigue en vez de perder el mensaje; los
  `return` que abandonan trabajo real liberan el claim (`:428`, `:865`, `:1111`,
  `:1471`); `acquireViajeLock` separa error permanente de transitorio
  (`conv.ts:305-325`) y el turno re-verifica el viaje tras tomarlo (`:1117`);
  `intakeDelta` devuelve `null` —no 0— ante error y `esperarIntake` es
  fail-closed con gracia de 2 s por default (`conv.ts:395`).
- **Orden y alcance de las guardias.** `guardiaCifras` sustituye siempre que hubo
  `cuadrar_viaje`/`guardar_liquidacion` usando el snapshot que la tool devolvió
  (`guardia.ts:69-72`, `tools.ts:209`), así que el PDF y el WhatsApp narran la
  MISMA lectura; `guardiaFundamento` y `guardiaEstado` no corren sobre texto ya
  determinístico (`processor.ts:1293`, `:1315`); `guardiaEstado` cotejaba contra
  `closed`, no adivina, y el `entrego: 'pendiente'` está bien razonado
  (`estado_afirmado.ts:70-85`).
- **`turns` acotado al viaje** (`conv.ts:196-204`): el historial de otro viaje se
  descarta con log, y el turno del asistente solo se guarda si `say` devolvió id
  (`processor.ts:1437-1441`).
- **Presupuesto.** El reloj arranca en la primera línea útil (`:239`),
  `PRESUPUESTO_WEBHOOK_MS` está sincronizado con `maxDuration` por prueba, el
  agente se salta con el resumen determinístico si no alcanzan 15 s
  (`:1140-1150`), y `acotada` cubre repo, conv, costos, config y
  `createSignedUrl`.
- **Un viaje abierto por operador**: `uq_viaje_abierto_por_operador`
  (`0029:71-73`) sigue en el esquema, así que el `.limit(1)` de `getOpenViaje` no
  puede elegir el viaje equivocado. (Aviso para *backend*: `crearViaje`
  —`operacion.ts:470`, nuevo en `master`— no comprueba ese invariante antes de
  insertar, así que el encargado recibirá un error crudo de Postgres al despachar
  a un chofer con viaje abierto. No es de mi rubro y no lo cuento aquí.)
- **Salud del árbol, medida por mí:** `npx vitest run` → 172 archivos / 1670
  pruebas en verde, 1 saltada (173 s).

## Lo que NO alcancé a revisar

- **No monté el arnés de concurrencia.** El MEDIO de la sala de espera contra el
  cierre y la carrera del `Promise.all` de `route.ts:72` están razonados sobre el
  código, no ejecutados con dos `processInbound` en vuelo. Sigue siendo lo
  primero que escribiría, igual que dijo la ronda 10.
- **El ciclo interno de tool-calling de `openrouter.ts`** (loop-guard, rondas,
  dedup entre rondas): lo dejé al rubro de tool calling salvo su consumo en
  `processor.ts:1178-1238`, que sí recorrí entero.
- **`pegarCodigoEnEspera` / `codigo_pendiente` (0016)**: verifiqué el claim
  atómico y el log de `reclamado_sin_pegar`, pero no conseguí escribir un
  escenario con valores donde el emparejamiento equivocado mueva dinero, así que
  no lo reporto.
- **`operacion.ts` (567 líneas nuevas) y las páginas del encargado**: solo las
  abrí para descartar que crearan una segunda vía de escritura al camino del
  dinero durante una conversación viva. No las auditó nadie de mi rubro.
- **Fuera de mi rubro pero lo dejo señalado para *seguridad/arquitectura*, porque
  lo vi mientras seguía el hilo del destinatario:**
  `src/lib/auth/tenant-efectivo.ts:55` es
  `if (false && !puedeVerRuta(sesion.rol, destino)) redirect(...)` — la puerta de
  visibilidad por rol de las 20 páginas de `/dashboard` está desactivada con un
  literal.
