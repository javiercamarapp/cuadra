# Rendimiento y costo — auditoría 5

**Nota: 7/10** (antes 6). Razón: **se atacó y subió** — `f437f18` + `5328087`
cerraron de verdad el fallo que definía el rubro (peor caso 112 s contra
`maxDuration=60`, muerte silenciosa), y esta ronda es la primera con **costo por
operación medido sobre fotos reales**, no estimado. Y **mirada más profunda**:
la ronda 4 no auditó este rubro, así que la suma del peor caso se rehízo eslabón
por eslabón contra el código y no contra el comentario. Cabe, con 29 s de
holgura. No llega a 8 porque el tramo de cierre **no tiene ningún tope impuesto**
(13 viajes de red, cero `AbortSignal`), el costo medido cubre solo la pata de
visión mientras el código cita una cifra 3–4× baja, y el panel barre la tabla
`gasto` completa del tenant sin límite.

**El riesgo mayor hoy:** el protocolo de dos fotos —que es el camino DISEÑADO
para todo ticket de gasolinera— paga una llamada de visión completa por el
acercamiento, y ese resultado no se usa para nada: duplica la partida de costo
dominante y duplica la espera de la barrera de intake.

---

## Hallazgos

### [ALTO] El acercamiento del protocolo de dos fotos paga visión completa, y esa llamada no aporta nada

`src/lib/cuadra/processor.ts:275` · `src/lib/cuadra/intake/ocr.ts:189-206,371-378`

La premisa que traigo del encargo —«un lote de 3 fotos del mismo ticket comparte
UNA llamada de visión»— es cierta de la FIRMA de `extraerComprobante`
(`ocr.ts:170`, acepta `string | string[]`) y del arnés
(`arnes_ticket_real.test.ts:54`, `grupo.map(dataUrl)`), pero **falsa del camino de
producción**. El único llamador real es `processor.ts:275`:

```ts
const extraccion = await extraerComprobante(dataUrl, reloj.senal(25_000));
```

`dataUrl` es UNA foto. Meta entrega un mensaje por foto, cada uno entra por su
propio `processInbound`, y no hay nada que las agrupe. Verificado con dos
búsquedas: `command grep -rn "extraerComprobante("` da 24 resultados, 22 en
`*.test.ts`, uno en el arnés y uno en `processor.ts` — con un solo argumento.

Escenario con números. El operador manda el acercamiento del código y después el
ticket completo, que es literalmente lo que el producto le pide
(`processor.ts:321`: «Ya tengo el código de ese ticket 👍. Mándame también la foto
del *ticket completo*»):

| foto | zxing | llamada de visión | qué se usa del resultado de visión |
|---|---|---|---|
| acercamiento | 50–171 ms, gratis, saca folio/código/liga/UUID/total | **sí**, $0.013–0.018, 6–12 s | solo `data.monto === null`, para clasificarla `solo_codigo` |
| ticket completo | 50–171 ms | sí, $0.013–0.018 | todo |

Lo que el acercamiento aporta de verdad —`folioPortal`, `codigoBarras`,
`urlFacturacion`, `cfdiUuid`, `total`— sale de `codigos`, que se decodifican en
`ocr.ts:189` **antes** de la llamada de visión, y son los cuatro únicos campos que
el processor consume después (`processor.ts:306-312` y `329-334`). El resultado de
visión sobre esa foto solo sirve para que `soloCodigo` (`ocr.ts:371`) resulte
`true`.

Cuenta por liquidación de 8 comprobantes con el protocolo usado como está
diseñado (16 fotos):

- 16 × $0.0155 = **$0.248** de visión, de los cuales **$0.124 no compra nada**.
- 8 × 6–12 s de OCR inútil que además hacen `+1` en el contador de intake
  (`processor.ts:255`), así que el «listo» espera por ellos en la barrera de 20 s
  (`processor.ts:464`).

Medido en esta máquina: zxing sobre una foto de 4032 px / 1.53 MB tarda **171 ms**
y sobre el fixture en caliente **50 ms**. La señal que decide es gratis; la que se
paga es la que sobra.

**Consecuencia:** el costo por liquidación se dobla en su partida dominante, y la
ventana de la barrera se consume con trabajo descartable justo cuando el operador
está esperando su cierre.

**Causa raíz:** la capacidad multi-foto se construyó y se probó en `ocr.ts`, y el
processor nunca se cableó a ella — el mismo patrón que el MAPA describe para
`facturacion/` («escrito, probado y sin llamar desde ningún lado»).

---

### [ALTO] `MARGEN_CIERRE_MS` es una reserva contable, no un tope: ninguna llamada del cierre lleva señal

`src/lib/cuadra/presupuesto.ts:22-36` · `src/lib/cuadra/processor.ts:546-707` ·
`src/lib/meta/client.ts:70,93` · `src/lib/supabase/admin.ts:14`

El comentario de `presupuesto.ts:26-31` enumera **seis** pasos de red del cierre y
los suma en «~7 s en un día malo». Conté los que hay de verdad después de que
`runAgent` devuelve, y son **trece** viajes de red secuenciales:

| # | paso | línea | costo unitario del propio `presupuesto.ts` |
|---|---|---|---|
| 1 | `registrarCosto` del turno | processor.ts:546 | 0.3 s · **no documentado** |
| 2 | `vincularCostosALiquidacion` | processor.ts:550 | 0.3 s · **no documentado** |
| 3 | `guardiaCifras` → `cuadrarDesdeDB` (3 consultas en paralelo) | processor.ts:613 → desde_db.ts:11 | 0.3 s |
| 4 | `sendText` de la respuesta | processor.ts:652 | 1.5 s |
| 5 | `registrarCostoWhatsApp` de esa respuesta | costos.ts:17 | 0.3 s · **no documentado** |
| 6 | `getGastos` para contar el aviso de barrera | processor.ts:657 | 0.3 s · **no documentado** |
| 7 | `sendText` del aviso de barrera | processor.ts:659 | 1.5 s |
| 8 | `registrarCostoWhatsApp` de ese aviso | costos.ts:17 | 0.3 s · **no documentado** |
| 9 | `createSignedUrl` | processor.ts:679 | 0.5 s |
| 10 | `sendDocument` | processor.ts:681 | 2.5 s |
| 11 | `registrarCostoWhatsApp` del PDF | processor.ts:682 | 0.3 s · **no documentado** |
| 12 | `saveConversation` | processor.ts:698 | 0.5 s |
| 13 | `releaseViajeLock` | processor.ts:707 | 0.3 s |

**8.9 s contra los 12 s reservados.** O sea: con los costos unitarios optimistas
que el propio archivo escribió, cabe, pero con 3.1 s de holgura y no con los ~5 s
que sugiere su cuenta de 7 s. La respuesta a la pregunta del encargo es *sí, pero
por poco, y sobre una lista incompleta*.

El problema real no es la aritmética, es que **nada la hace cumplir**. Verificado
con `command grep -rn "AbortSignal\|signal" src/lib` (sin tests):

- `sendText` (`meta/client.ts:70`) y `sendDocument` (`meta/client.ts:93`) usan
  `fetch` pelado. `DOWNLOAD_TIMEOUT_MS` de 15 s existe (`meta/client.ts:10`) pero
  solo se aplica a las DESCARGAS (líneas 115, 121, 136, 142). Los ENVÍOS no.
- `supabaseAdmin()` (`supabase/admin.ts:14`) crea el cliente sin `fetch` propio, así
  que ninguna consulta ni RPC de todo el sistema lleva señal.
- `ToolContext.signal` está declarado (`tool-executor.ts:18`) y poblado
  (`run.ts:34`), y **no lo lee nadie** — verificado con una segunda búsqueda sobre
  `tools.ts`, `cuadre/`, `repo.ts` y `liquidacion/`: cero resultados.

Escenario con números: el default de `undici` (el `fetch` global de Node) es
`headersTimeout` y `bodyTimeout` de **300 000 ms**. Un socket aceptado que no
contesta cuelga 300 s. `maxDuration` son 120 s (`route.ts:27`). Vercel mata la
función a los 120 s, 180 s antes de que el `fetch` se rinda.

**Consecuencia:** la liquidación YA quedó escrita en la base (`guardar_liquidacion`
corrió dentro del agente), el operador no recibe ni el resumen ni el PDF, y el
`logger.error('pdf.no_entregado')` de `processor.ts:686` **tampoco se escribe**,
porque el proceso muere antes del `catch`. Meta recibió su 200 en `route.ts:78` y
no reintenta. Es exactamente el modo de falla que `presupuesto.ts:5-7` dice venir a
evitar, sobreviviendo en el único tramo donde el presupuesto no se puede aplicar.

**Causa raíz:** el reloj compartido se cableó a las tres etapas que ESPERAN
(barrera, mutex, agente) porque esas aceptan un tope. El cierre no espera, ejecuta
— y ahí el presupuesto se volvió una resta en un comentario.

---

### [ALTO] El panel barre la tabla `gasto` completa del tenant, sin filtro, sin límite y sin caché

`src/lib/cuadra/analytics.ts:88-92` · `src/lib/cuadra/duplicados.ts:68` ·
`src/app/dashboard/page.tsx:8,48-54`

`detectarAnomalias` pide `viaje_id, concepto, monto, folio, cfdi_uuid` de **todos
los gastos del tenant desde el principio de los tiempos** — sin rango de fecha,
sin `.limit()`, sin `.range()`. Lo mismo `getKpis` (`analytics.ts:21-24`) y
`getAcreditables` (`analytics.ts:109-113`) sobre `liquidacion`, y
`getResumenCosto` (`costos.ts:80-83`) sobre `llm_costo`. La página es
`export const dynamic = 'force-dynamic'` (`dashboard/page.tsx:8`): sin caché, se
rehace en cada F5.

Escenario con números. Flota mediana: 50 operadores × 20 viajes/mes × 8
comprobantes = 8 000 gastos/mes = **96 000 filas al año**, ~11 MB de JSON, en cada
carga del panel. Y encima `detectarDuplicadosEntreViajes` hace, en
`duplicados.ts:68`:

```ts
if (conUuid.size && [...conUuid].some((u) => k.includes(u))) continue;
```

`[...conUuid]` materializa un arreglo de **todos** los UUID distintos (~20 000 al
año) **dentro** del bucle de grupos de folio duplicado, y por cada uno corre un
`String.includes` sobre la llave. Es O(G × U) con una asignación de arreglo por
iteración.

Amplificador: el tope por defecto de PostgREST en Supabase (`max_rows`, Settings →
API) es **1 000 filas**, y ninguna de estas consultas lo desactiva ni lo pagina. Si
está en el default, el detector de fraude entre viajes ve el **1 %** de los gastos
y los KPI se congelan en silencio en cuanto el tenant pasa de ~125 liquidaciones.
`getResumenCosto` se topa antes todavía: son 6–12 filas de `llm_costo` por
liquidación, o sea ~100 liquidaciones. *(El valor concreto hay que leerlo en el
panel de Supabase; el escaneo sin límite es un hallazgo con o sin él.)*

**Consecuencia:** el panel del contralor —la pantalla que decide el trato— se
degrada linealmente con el uso, y su función de detección de fraude deja de ver la
mayoría de los datos sin dar ninguna señal.

**Causa raíz:** toda la agregación se hace en JavaScript sobre filas crudas. No hay
ninguna vista, RPC ni `count`/`sum` en SQL. Contrasta con `getAcumuladoCombustible`
(`repo.ts:416-437`), que al menos tiene su índice dedicado (mig. 0023) — pero
también agrega en JS y también viene sin límite.

---

### [MEDIO] El `timeoutMs` del agente aborta el HTTP, no las tools: la etapa puede pasarse de su tope

`src/lib/agents/run.ts:32-34,48` · `src/lib/llm/tool-executor.ts:52` ·
`src/lib/cuadra/tools.ts:111-143`

`runAgent` arma un `AbortController` y lo pasa a `generateWithTools`, que lo usa en
un solo sitio: `client.chat.completions.create` (`openrouter.ts:477` y `482`). Los
handlers no consultan `ctx.signal` (verificado arriba: cero usos). Si el abort cae
mientras corre una ronda de tools, esa ronda **termina entera** y el abort solo se
nota en la siguiente llamada al modelo.

La ronda más larga es `guardar_liquidacion` (`tools.ts:111-149`): `Promise.all`
de `computeCuadre` + `getViaje` + `getOperador` (1 RTT), dos subidas de PDF a
storage **secuenciales** (`tools.ts:138-139`, 2 RTT, sin timeout, ver hallazgo
anterior) y `saveLiquidacion` (1 RTT) = 4 viajes de red en serie.

Medido en esta máquina: generar los **dos** PDF (contralor + operador, 8
diferencias y 8 gastos) cuesta **8 ms**. No es CPU: es red. A 0.5–1.5 s por viaje,
la ronda son 2–6 s.

**Escenario:** el agente pide `acotar(40_000)` (`processor.ts:535`). El abort cae a
los 40 s con `guardar_liquidacion` en vuelo → la etapa acaba a los **42–46 s**
contra su tope de 40. En la suma total eso son 2–6 s que salen del margen de 12 s
del cierre, que como ya se vio no tiene holgura para regalar.

**Consecuencia:** el único mecanismo que el sistema tiene para no exceder
`maxDuration` es aproximado en la etapa más cara.

**Causa raíz:** la señal se diseñó para el SDK del LLM y se propagó al
`ToolContext` sin cablearla a los handlers.

---

### [MEDIO] La misma fila se lee tres y cuatro veces en el turno de cierre

`src/lib/cuadra/config.ts:145-147` · `src/lib/cuadra/cuadre/desde_db.ts:11-15` ·
`src/lib/cuadra/tools.ts:35,67,113-117` · `src/lib/cuadra/processor.ts:613`

`getConfig` no tiene memoización de ningún tipo: cada llamada es un `select rfc,
config from tenant`. `cuadrarDesdeDB` lo invoca junto con `getViaje` y `getGastos`.
Y `cuadrarDesdeDB` se llama tres veces en el mismo turno.

Turno «listo» que cierra (política → cuadre → guardar), contando viajes de red:

| origen | consultas | `tenant` | `viaje` | `gasto` |
|---|---|---|---|---|
| `consultar_politica` → `getConfig` (tools.ts:35) | 1 | ×1 | | |
| `cuadrar_viaje` → `cuadrarDesdeDB` (tools.ts:54) | 3 | ×1 | ×1 | ×1 |
| `cuadrar_viaje` → `getAcumuladoCombustible` (tools.ts:67) | 1 | | | (año entero) |
| `guardar_liquidacion` → `cuadrarDesdeDB` + `getViaje` + `getOperador` (tools.ts:113-117) | 5 | ×1 | ×2 | ×1 |
| `guardar_liquidacion` → 2 uploads + `saveLiquidacion` | 3 | | | |
| `guardiaCifras` → `cuadrarDesdeDB` (processor.ts:613 → guardia.ts:20) | 3 | ×1 | ×1 | ×1 |
| **total** | **16** | **4** | **4** | **3** |

Bastarían 6 lecturas distintas. A 80–150 ms por viaje son **0.9–1.7 s** dentro del
presupuesto de 40 s del agente; con la base en otra región (300 ms) son **3.3 s**.

**Consecuencia:** entre 1 y 3 s del presupuesto del turno se van en releer lo
mismo, en la etapa que ya es la más apretada.

**Causa raíz:** `cuadrarDesdeDB` es «fuente única de verdad» a propósito
(`desde_db.ts:2-4`) y esa decisión es correcta; lo que falta es que sea única
también DENTRO de una invocación. No hay ningún caché por request.

*Lo que sí está bien y hay que reconocerlo:* `READ_PREFIXES` incluye `cuadrar_`
(`openrouter.ts:419`) con un comentario que explica exactamente este problema, así
que si el modelo llama `cuadrar_viaje` dos veces en el mismo turno, la segunda sale
de `crossRound` y no repite el barrido del ejercicio. Esa mitad ya está cerrada.

---

### [MEDIO] La foto va al modelo a resolución completa y sin tope; el resize ya existe y se tira

`src/lib/meta/client.ts:145-146` · `src/lib/cuadra/intake/ocr.ts:203` ·
`src/lib/cuadra/intake/cfdi.ts:249`

`downloadMediaAsDataUrl` hace `buf.toString('base64')` sobre lo que Meta entregue,
sin mirar el tamaño, y ese data-URL se pasa tal cual a `generateStructured`
(`ocr.ts:203`). Dos líneas más arriba en la cadena, `decodeCodigosFromImage`
(`cfdi.ts:249`) **ya reduce la imagen a 1600 px** con `sharp` para zxing… y
descarta ese buffer.

Medido en esta máquina:

- foto de 4032 px de ancho / **1.53 MB** de JPEG
- data-URL resultante: **2.04 MB de texto**, que es lo que viaja en el cuerpo del
  POST a OpenRouter
- Meta admite imágenes de hasta 5 MB → hasta **6.7 MB** de data-URL, sin ningún
  corte en el código

Estimación de tokens (modelo de teselado de Gemini: 768², 258 tokens por tesela;
no es una medición, no corrí visión): 4032×3024 → 6×4 = 24 teselas ≈ **6 200
tokens** de entrada; a 1600×1200 serían 3×2 = 6 teselas ≈ **1 550**. A $1.5/M
(`openrouter.ts:81`) son $0.0093 contra $0.0023 — hasta **$0.007 por foto**, ~45 %
del costo medido de $0.015.

**Consecuencia:** entrada y latencia de subida proporcionales a una resolución que
el extractor no necesita, × 8–16 fotos por liquidación. Y sin tope: una foto de
5 MB entra igual.

**Causa raíz:** el resize se escribió para zxing, no para la visión, y las dos
rutas comparten el buffer original en vez de la versión reducida.

*Matiz honesto:* WhatsApp comprime en origen y con «HD» apagado las fotos suelen
llegar por debajo de 1600 px, donde el ahorro tiende a cero. Lo que no existe en
ningún caso es un **límite**.

---

### [MEDIO] El precio de Sonnet 5 caduca el 31-ago-2026 y no hay nada que lo cambie

`src/lib/llm/openrouter.ts:83`

```ts
'anthropic/claude-sonnet-5': [2, 10],       // intro VIGENTE hasta 31-ago-2026; revertir a [3,15] después
```

No hay lógica de fecha, ni prueba, ni alerta: `command grep -rn "31-ago\|2026-08-31"
src/` da solo ese comentario. El demo es el **6-ago-2026**; **26 días después** el
precio real sube a $3/$15 (+50 % en ambas patas) mientras `calcCost`
(`openrouter.ts:102-106`) sigue devolviendo el intro.

**Escenario:** un turno de cuadre de 7 600 tokens de entrada y 3 000 de salida
(estimación con `reasoning: 'high'` y `max_tokens` 4 000, `openrouter.ts:469`) pasa
de $0.045 reales a $0.068 el 1-sep. `llm_costo` (`costos.ts:40-49`) sigue
insertando $0.045, y `getResumenCosto` (`costos.ts:79`) —el que alimenta el margen
del panel— subestima el cuadre en **33 %** desde esa fecha, de forma indefinida.

**Consecuencia:** en un producto que va a cobrar POR LIQUIDACIÓN, el medidor de
costo empieza a mentir a la baja el mes siguiente al demo, y a la baja es la
dirección que nadie mira.

**Causa raíz:** una fecha de caducidad escrita en un comentario, en un archivo cuyo
propio encabezado (`openrouter.ts:96-100`) argumenta que «un costo que se
subestima en silencio es peor que uno que se equivoca ruidosamente».

---

### [MEDIO] `models.ts` promete $0.03–0.05 por liquidación; lo medido son $0.12 solo de visión

`src/lib/llm/models.ts:17`

```
//   Costo ≈ $0.03–0.05 / liquidación.
```

Lo medido esta ronda con fotos reales son **$0.12 por 8 comprobantes**, y esa cifra
sale de `arnes_ticket_real.test.ts:89`, que imprime literalmente *«costo total de
**visión**»*: el arnés llama `extraerComprobante` (línea 54) y después el motor
puro (línea 81). **No incluye el turno de cuadre ni los mensajes de WhatsApp.**

Suma real por liquidación de 8 comprobantes, con las fuentes:

| partida | cuenta | USD |
|---|---|---|
| visión, 8 fotos | 8 × $0.0155 (medido) | 0.124 |
| visión, 8 acercamientos (ver primer hallazgo) | 8 × $0.0155 | 0.124 |
| turno de cuadre, Sonnet 5 `reasoning:'high'` | ~7 600 in × $2/M + ~3 000 out × $10/M | ~0.045 |
| WhatsApp salientes: aviso privacidad + acuse + respuesta + aviso barrera + PDF | 5 × $0.008 (`costos.ts:13`) | 0.040 |
| **total** | | **≈ 0.33** |

Peor caso del cuadre: `maxToolRounds` es 6 (`openrouter.ts:438`) con
`max_tokens` 4 000 por ronda → 24 000 tokens de salida × $10/M = **$0.24** en un
solo turno, más que todas las fotos juntas.

**Consecuencia:** la cifra que está escrita en el código —y que es la que alguien
cita al razonar el modelo de negocio— está entre **2.4× y 11× baja**. Para un
producto que cobra por liquidación eso es el margen entero.

**Causa raíz:** el comentario es de la fase de diseño y ninguna de las tres
mediciones posteriores lo tocó.

*Sobre la pregunta de si $0.12–$0.33 es sostenible:* con una flota de 50
operadores × 20 viajes/mes son 1 000 liquidaciones/mes ≈ **$330 USD/mes de costo
variable**. Contra un precio por liquidación de $1–2 USD el margen bruto queda en
75–85 %, que sí aguanta. Lo que no aguanta es planear con $0.03–0.05: ahí el
supuesto es 10× optimista y el primer cliente grande se lo lleva por delante.

---

### [BAJO] Dos segundos fijos de espera en CADA mensaje de texto, tenga o no fotos en vuelo

`src/lib/cuadra/conv.ts:287-291`

```ts
const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 2_000;
const start = Date.now();
if (grace > 0 && (await probe(viajeId)) <= 0) {
  await sleep(Math.min(grace, tope));
}
```

La gracia se paga siempre que el contador arranque en 0 — que es **el caso normal**:
el operador mandó sus fotos hace minutos y ahora escribe. `esperarIntake` se llama
en el camino de texto (`processor.ts:464`) antes de cualquier discriminación de
intención, así que un «hola» o una pregunta suelta también pagan los 2 s.

Cabe dentro del tope (el `start` se toma antes del sueño, `conv.ts:288`, así que la
gracia no se suma al tope de 20 s — verificado leyendo el bucle). Es latencia
percibida, no riesgo de corte: 2 s sobre un turno típico de ~20 s son un 10 %, y en
la sala del demo son dos segundos de pantalla quieta antes de que el agente
empiece.

**Causa raíz:** la gracia resuelve una carrera real (fotos y «listo» en el mismo
`Promise.all`, `route.ts:70-76`) con un `sleep` incondicional en vez de una
condición.

---

### [BAJO] El bundle de la función: 616 archivos / 25.1 MB, con fixtures de prueba y `pruebas-manuales/` dentro

`next.config.ts:25-27`

Medido sobre el trace real del build local,
`.next/server/app/api/webhook/whatsapp/route.js.nft.json`:

- **616 archivos, 25.1 MB.**
- `@img/sharp-libvips-*`: **16.08 MB — el 64 % de la función**. Y `sharp` se importa
  en la cadena de módulos del webhook (`cfdi.ts:11` ← `ocr.ts:16` ← `processor.ts:16`),
  así que se carga aunque el turno sea de puro texto. Medido: `import sharp` = 27 ms
  con caché de disco caliente; en un arranque en frío de Lambda con 16 MB de libvips
  que mapear es un piso, no un techo.
- Resto: chunks de la app 2.4 MB, `next` 1.36 MB, `zxing-wasm` 1.13 MB, `pdf-lib`
  0.85 MB.

**Los excludes SÍ funcionaron** y hay que decirlo: cero `.md`, cero `.env*`, cero
`docs/`, cero `supabase/` en el trace. Lo que no cazaron —**125 archivos del
proyecto, ~1.5 MB**— es:

| archivo | bytes |
|---|---|
| `tsconfig.tsbuildinfo` | 431 195 |
| `package-lock.json` | 352 413 |
| `src/lib/cuadra/intake/__fixtures__/ticket-codigos.jpg` | 134 234 |
| `design-system/` (13 archivos HTML/CSS/JSON) | ~120 000 |
| `normas/*.yaml` (19 fichas que `indice.ts:11` dice que runtime NO debe leer) | ~55 000 |
| `pruebas-manuales/*.prueba.ts` (7 archivos que el MAPA marca como llamadas reales de pago) | ~38 000 |
| `src/**/*.ts` en fuente sin compilar (~90 archivos) | ~400 000 |
| `schema.sql`, `qr-sat.png`, `eslint.config.mjs`, `vitest.config.ts` | ~20 000 |

**Consecuencia para el arranque en frío:** marginal — 1.5 MB sobre 25.1 MB. Quien
domina el frío es libvips. Lo anoto porque la lista de excludes se escribió contra
un inventario (`.md`, `.env`, `docs`) y no contra el trace, así que la próxima
carpeta nueva vuelve a colarse igual.

---

### [BAJO] Ocho comentarios siguen diciendo que el presupuesto son 60 s

`conv.ts:272,275` · `ocr.ts:177` · `openrouter.ts:216-217` · `route.ts:65,68` ·
`presupuesto.ts:71` · `cfdi.ts:247`

`f437f18` subió `maxDuration` a 120 y `5328087` sincronizó `PRESUPUESTO_WEBHOOK_MS`,
pero ocho comentarios repartidos por seis archivos siguen razonando contra 60 s.
`conv.ts:272-276` es el peor: es justo la explicación de por qué el tope de la
barrera es 20 s y no 60, y hoy el número que cita contradice a `route.ts:27`.

El test `presupuesto.test.ts:77-85` protege la sincronía del literal, y eso está
bien resuelto. Lo que no protege nadie es el razonamiento escrito alrededor — y la
desincronización de comentario a código es exactamente el mecanismo que produjo el
bug original.

---

### [BAJO] Dos viajes de red por mensaje para descubrir que el aviso ya se envió

`src/lib/cuadra/processor.ts:247` · `src/lib/cuadra/repo.ts:357,388`

`ponerAvisoADisposicion` corre en **todo** mensaje con viaje abierto, antes de la
bifurcación por tipo (`processor.ts:247`), incluida cada foto de una ráfaga. Cada
pasada son `getDatosResponsable` (select sobre `tenant`) + `reclamarEnvioAviso`
(RPC `marcar_aviso_privacidad`, un `UPDATE ... WHERE`).

Ráfaga de 12 fotos: **24 viajes de red**, de los cuales 22 solo confirman lo ya
sabido. A 80 ms son ~1.9 s repartidos entre las 12 ejecuciones paralelas. El claim
en SQL (mig. 0018) es la decisión correcta —evita mandar el aviso tres veces— y el
`UPDATE` no toma lock más allá del statement porque su `WHERE` deja de casar tras
el primero. Es coste, no riesgo.

---

## La suma del peor caso, eslabón por eslabón

Costos unitarios: los que el propio `presupuesto.ts:26-31` escribió (0.3 s una
consulta, 1.5 s un `sendText`, 2.5 s un `sendDocument`, 0.5 s una URL firmada).

| # | eslabón | tope | fuente en el código | acumulado |
|---|---|---|---|---|
| 0 | arranque en frío: init de módulos + 5 sondas de migración **secuenciales** | sin tope | `instrumentation.ts:5` → `startup.ts:65-101` | **fuera del reloj** (medido: 116 ms de módulos + 5 RTT) |
| 1 | `claimMessage` + `resolveOperador` + `getOpenViaje` | 3 RTT, sin timeout | `processor.ts:159,187,205` | 0.9 s |
| 2 | aviso de privacidad: 2 consultas + `sendText` + costo | 4 RTT, sin timeout | `processor.ts:247`, `repo.ts:357,388` | 3.4 s |
| 3 | barrera de intake | `acotar(20_000)` + 1 sonda + 500 ms de sueño de sobrepaso | `processor.ts:464`, `conv.ts:277,292-296` | 24.2 s |
| 4 | mutex del viaje | `acotar(12_000)` + 1 RPC + 1 500 ms de backoff de sobrepaso | `processor.ts:484`, `conv.ts:231-243` | 38.0 s |
| 5 | `getOpenViaje` + `getTenantContext` + `loadConversation` | 3 RTT | `processor.ts:493,498,499` | 38.9 s |
| 6 | agente | `acotar(40_000)` | `processor.ts:535`, `run.ts:33` | 78.9 s |
| 7 | ronda de tools que el abort NO corta | 4 RTT + 2 subidas de PDF | `run.ts:34` vs `tool-executor.ts:52`, `tools.ts:130-143` | 81.9 s |
| 8 | cierre | 12 000 ms **reservados**, 13 RTT reales | `presupuesto.ts:36`, `processor.ts:546-707` | 90.8 s |
| | **límite** | **`maxDuration = 120`** | `route.ts:27` | **sobran 29.2 s** |

**Veredicto: cabe.** El peor caso sumado a mano da **90.8 s contra 120 s**, con 24 %
de holgura. La subida de 60 a 120 fue correcta y el reloj compartido hace lo que
promete: verifiqué que `acotar` recorta de verdad (`presupuesto.ts:86`) y que
`senal()` devuelve una señal ya abortada cuando no queda nada (`presupuesto.ts:94`),
que es lo que impide pagar una llamada condenada.

**Dos correcciones a lo declarado:**

1. El «≈72 s» de `route.ts:15` y `presupuesto.ts:48` es la suma de **tres** eslabones.
   La cadena real son nueve y da 90.8 s: el número declarado subestima en **26 %**.
   No cambia el veredicto hoy; sí cambia el margen que alguien cree tener la
   próxima vez que quiera meter un paso más.
2. La holgura de 29.2 s es aritmética, no física. Los eslabones 1, 2, 5, 7 y 8 —**23
   viajes de red**— no llevan ninguna señal de aborto, y el default de `undici` son
   300 s. Un solo socket colgado en cualquiera de ellos convierte 90.8 s en 120 s y
   la función muere sin escribir nada. La suma cabe; lo que no está acotado es la
   varianza.

**Sobre `MARGEN_CIERRE_MS = 12 000` y los seis pasos:** los pasos son trece, no seis
(tabla en el hallazgo ALTO #2). Con los costos unitarios del propio archivo suman
8.9 s: alcanza, con 3.1 s de sobra en vez de los ~5 s que sugiere su cuenta. Un
`sendText` que tarde 4 s en lugar de 1.5, o un reintento del PDF, y ya no.

---

## Costo por liquidación

Medido esta ronda (fotos reales): **$0.013–0.018 por llamada de visión, 6–12 s cada
una**. La cifra de **$0.12 por 8 comprobantes** es, según el propio arnés
(`arnes_ticket_real.test.ts:89`), *costo total de visión* — no incluye el cuadre ni
WhatsApp.

| partida | fuente | 8 comprobantes | peor caso |
|---|---|---|---|
| visión del ticket completo | medido | $0.124 | $0.144 |
| visión del acercamiento (**no aporta nada**, ver hallazgo 1) | medido | $0.124 | $0.144 |
| turno de cuadre (Sonnet 5, `reasoning:'high'`, hasta 6 rondas × 4 000 tokens) | `models.ts:38`, `openrouter.ts:83,438,469` | ~$0.045 | $0.28 |
| WhatsApp salientes | `costos.ts:13` | 5 × $0.008 = $0.040 | 6 × $0.008 = $0.048 |
| **total** | | **≈ $0.33** | **≈ $0.62** |

Contra el **$0.03–0.05** que declara `models.ts:17`: entre 7× y 12× por debajo.

**¿Es sostenible?** Sí, con el precio correcto. 1 000 liquidaciones/mes (flota de 50
operadores) son ~$330 de costo variable; a $1–2 USD por liquidación el margen bruto
queda en 75–85 %. Lo que no es sostenible es **planear con la cifra del comentario**:
a $0.04 la cuenta dice $40/mes, y el error de 8× se descubre con el primer cliente
grande, no antes.

**Palancas por tamaño, todas medidas o rastreables:**

| palanca | ahorro | evidencia |
|---|---|---|
| no pagar visión sobre el acercamiento | **−$0.124 / liquidación (−38 %)** | `processor.ts:275` manda 1 foto; los códigos ya salieron en `ocr.ts:189` |
| mandar la imagen ya reducida (el resize existe) | hasta −$0.007 × 16 fotos | `cfdi.ts:249` reduce a 1600 px y tira el buffer; data-URL medido 2.04 MB |
| caché del prompt de sistema del OCR | −$0.018 / liquidación | `ocr.ts:67-101` son **5 287 chars ≈ 1 469 tokens** reenviados en cada una de las 16 llamadas; `command grep -rni "cache_control\|prompt_cach"` → 0 resultados |

**Sobre «tokens gastados en contexto que el modelo no usa»: no encontré un
desperdicio material en el cuadre, y lo intenté refutar.** Construí el payload real
de `cuadrar_viaje` para una liquidación de 8 comprobantes con 9 diferencias y 5
fundamentos:

- payload completo: **2 109 chars ≈ 586 tokens**
- de eso, 908 chars (43 %) son las `nota` en prosa que el motor escribe para
  humanos, con una nota máxima de 203 chars
- `resumenCuadre` al operador: 772 chars ≈ 214 tokens
- `fundamentos` trae `citas[0]`, que son cadenas cortas tipo `"LISR 27-III"`
  (`indice.ts`), no el texto de la norma — la decisión correcta
- el historial está topado en `MAX_TURNS = 12` (`conv.ts:96`) y además se DESCARTA
  al cambiar de viaje (`conv.ts:124-128`), así que no arrastra turnos ajenos

Reenviado en hasta 4 rondas más, ese payload cuesta ~$0.005. **No es una fuga.** El
gasto de tokens del cuadre está en la salida con `reasoning: 'high'`
(`models.ts:63`), no en el contexto de entrada.

---

## Lo que revisé y está bien

- **El reloj compartido hace lo que dice.** `acotar` recorta de verdad
  (`presupuesto.ts:86`) y las tres etapas lo usan (`processor.ts:464,484,535`).
  `senal()` devuelve una señal **ya abortada** cuando no queda presupuesto
  (`presupuesto.ts:89-95`) en vez de agendar un timeout de 0 — detalle fino y
  correcto: evita pagar una llamada condenada.
- **La guarda `alcanza(15_000)`** (`processor.ts:516`) y su fallback determinístico
  vía `cuadrarDesdeDB`: el operador recibe números correctos en vez de silencio.
- **`READ_PREFIXES` con `cuadrar_`** (`openrouter.ts:419`): impide que un turno
  «cómo voy, y ciérralo» repita el barrido del ejercicio. Y solo se cachea el
  ÉXITO (`openrouter.ts:554`), que es lo correcto.
- **Contabilidad de costo por ronda con el modelo que respondió esa ronda**
  (`openrouter.ts:497`), y cobro de los intentos truncados y fallidos
  (`openrouter.ts:299`, `333-337`). `calcCost` estima con la tarifa **más cara** ante
  un modelo desconocido en vez de devolver 0 (`openrouter.ts:110-115`). Es la
  postura correcta para un medidor de costo.
- **`DEFAULT_MAX_TOKENS = 4000`** (`openrouter.ts:34-46`): es un techo, no un cargo,
  y el comentario lo dice. Subirlo no cuesta.
- **`decodeCodigosFromImage` a dos escalas y no más** (`cfdi.ts:246-253`), con la
  medición escrita. Confirmado: **50 ms en caliente**, **171 ms** sobre una foto de
  4032 px. Barato de verdad.
- **`generarLiquidacionPDF` ×2 = 8 ms.** No es un problema de CPU en ningún
  escenario; lo caro de `guardar_liquidacion` es la red.
- **Índice `idx_gasto_acumulado`** (mig. 0023) con el orden de columnas correcto
  (igualdades primero, rango al final) y el comentario que explica por qué.
- **`outputFileTracingExcludes` funcionó**: verificado sobre el trace real — cero
  `.md`, cero `.env*`, cero `docs/`, cero `supabase/`, cero `*.test.*`.
- **El SAT no puede colgar el turno**: `consultarCFDI` lleva su `AbortSignal` de 4 s
  y devuelve `pendiente` ante cualquier fallo (`sat.ts:36,48,80-83`).
- **Las descargas de media sí tienen timeout** (15 s, `meta/client.ts:115,121,136,142`).
  Son los ENVÍOS los que no.
- **`intakeDelta(-1)` en `finally`** (`processor.ts:384`): un OCR que truena libera
  su contador y no deja la barrera esperando 20 s por nada.

## Lo que NO alcancé a revisar

- **Latencia real Vercel ↔ Supabase y ↔ Graph API.** Toda la tabla del peor caso usa
  los costos unitarios que `presupuesto.ts` escribió. Medirlos de verdad exige o
  bien tocar producción o bien leer los logs de Vercel de la corrida real del
  28-jul. Si el RTT p99 a Supabase es de 1 s en vez de 0.3, el cierre pasa de 8.9 s
  a ~15 s y **se sale del margen**.
- **El `max_rows` real del proyecto Supabase.** El hallazgo del panel está probado por
  la ausencia de `.limit()`; el factor de amplificación (1 000 filas) es el default
  de la plataforma y hay que confirmarlo en Settings → API.
- **Tokens reales de una imagen en Gemini 3.6 Flash.** El desglose por teselas es un
  modelo, no una medición: medirlo pide una llamada de visión y el encargo lo
  prohíbe. El dato duro que sí tengo es el data-URL de 2.04 MB.
- **Consumo real del turno de cuadre.** Los ~7 600 in / ~3 000 out son una
  estimación a partir del prompt (923 tokens medidos), los schemas de las 3 tools y
  el payload de `cuadrar_viaje` (586 tokens medidos). La cifra exacta está en la
  tabla `llm_costo` de producción, que no consulté.
- **Memoria del proceso bajo una ráfaga grande.** Medí en local: 1 foto de 4032 px
  = +65 MB de pico de RSS; 12 en paralelo llevaron el RSS a 572 MB. `route.ts:9`
  permite 40 mensajes por minuto y por teléfono, y `Promise.all` no acota la
  concurrencia. No pude confirmar el límite de memoria de la función en Vercel, así
  que no sé a cuántas fotos concurrentes se rompe.
- **Arranque en frío real.** Los 116 ms de init de módulos son locales, con caché de
  disco caliente. Lo que no está medido es lo que cuestan las **5 sondas
  secuenciales** de `startup.ts` en cada instancia nueva.
