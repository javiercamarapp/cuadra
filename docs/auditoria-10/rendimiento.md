# Rendimiento y costo — auditoría 10

Anclado a `6d4ea7a` (HEAD de `claude/auditoria-10` al empezar).

**Nota: 4/10** (antes 8). Razón del movimiento: **mirada más profunda**. Los tres
hallazgos que sostenían el 8 eran sobre `foto_pendiente`, y ese mecanismo se
revirtió (`processor.ts:494`, mig. `0041`): quedaron sin objeto, no atacados. Al
volver a hacer la suma que este rubro exige —el peor caso de cada eslabón contra
el límite escrito, no el nominal— el resultado es que **el cierre de la
liquidación, él solo, tiene un techo de 125.0 s contra un `maxDuration` de
120 s**, y el mutex del "listo" puede colgar 300 s sin techo alguno. El código
nuevo (`/admin`) además reintroduce dos patrones que la ronda 8 cerró.

Riesgo mayor hoy: el tramo posterior a `runAgent` —donde se manda el resumen y
el PDF— corre sin consultar el presupuesto ni una sola vez, y sus propios topes
suman más que la invocación entera; cuando revienta, la liquidación ya está
escrita, el operador no recibe nada, no queda log y Meta no reintenta.

---

## La suma, contra el límite escrito

`PRESUPUESTO_WEBHOOK_MS = 120_000` (`presupuesto.ts:188`), sincronizado con
`maxDuration = 120` (`api/webhook/whatsapp/route.ts:28`). Techos que el propio
repo impone: una consulta `acotada` corta a `TOPE_CONSULTA_MS (8_000) +
GRACIA_TOPE_MS (1_500) = 9_500 ms` (`presupuesto.ts:101,104,148-169`); un envío
a Meta corta a `SEND_TIMEOUT_MS = 10_000` (`meta/client.ts:17`).

**Camino del "listo", peor caso, etapa por etapa:**

| Tramo | Tope pedido | Techo real sumado | ¿Lo limita `reloj`? |
|---|---:|---:|---|
| previo: `resolveOperador` + `getOpenViaje` + `getHuerfanos` | — | 3 × 9 500 = **28 500** | no |
| barrera de intake (`processor.ts:1071`) | 20 000 | 20 000 + 9 500 de sobretiro¹ = **29 500** | sí (`acotar`) |
| mutex (`processor.ts:1104`) | 12 000 | **300 000** (RPC sin techo, ver ALTO-1) | sí, pero no se respeta |
| agente (`processor.ts:1158`) | 40 000 | 40 000 (`AbortSignal` real) | sí |
| **cierre** (`PASOS_CIERRE`, 13 pasos) | reserva 12 000 | **125 000** | **no, nunca** |

¹ el `while` de `esperarIntake` comprueba el vencimiento **después** del sondeo
(`conv.ts:410-412`), y cada sondeo es un `intakeDelta` `acotada` de hasta
9 500 ms.

**Desglose del cierre** (`presupuesto.ts:37-51`), sustituyendo el costo nominal
de cada fila por el techo que el mismo repo le impone:

- 9 pasos de Supabase (`registrarCosto`, `vincularCostosALiquidacion`,
  `guardiaCifras→cuadrarDesdeDB`, `registrarCostoWhatsApp` ×3, `getGastos`,
  `saveConversation`, `releaseViajeLock`) × 9 500 = **85 500 ms**
- `createSignedUrl` (`processor.ts:1411`, `acotada` por carrera) = **9 500 ms**
- `sendText` ×2 + `sendDocument` ×1 × 10 000 = **30 000 ms**
- **Total = 125 000 ms** contra `MARGEN_CIERRE_MS = 12 000` → **10.4×**, y
  contra `PRESUPUESTO_WEBHOOK_MS = 120 000` → **1.04× él solo**.

**Total del camino:** 28 500 + 29 500 + 12 000 + 38 000 (lo que `acotar` le deja
al agente tras 70 s consumidos) = 108 000 ms, que es exactamente el tope que
`crearPresupuesto` garantiza (`120 000 − 12 000`). Y **encima** de eso corre el
cierre, con techo de 125 000 ms y sin ninguna consulta al `reloj`:
**108 000 + 125 000 = 233 000 ms contra 120 000 ms**, 1.94× el límite escrito.
Con el mutex sin techo (ALTO-1), el número deja de tener cota.

Lo que hoy se comprueba: `presupuesto.test.ts` compara `COSTO_CIERRE_MS`
(**8 900 ms**, la suma de los costos *nominales*) contra `MARGEN_CIERRE_MS`
(12 000). Es la suma del promedio, no la del peor caso.

---

## Hallazgos

### [ALTO] El mutex del "listo" hace su RPC sin techo dentro de un `for (;;)`: 300 s posibles contra un `maxWaitMs` de 12 000 ms
`src/lib/cuadra/conv.ts:287` (`const admin = supabaseAdmin()`), `:292`
(`await admin.rpc('try_lock_viaje', …)`), `:316` (comprobación de vencimiento),
invocado desde `src/lib/cuadra/processor.ts:1104` con `reloj.acotar(12_000)`.

Escenario: el operador escribe **"listo"**. `acquireViajeLock` entra al bucle y
llama `try_lock_viaje`. Ese RPC **no pasa por `acotada`** —el cliente se
construye una vez en la línea 287 y se usa crudo en la 292—, así que hereda el
default de undici: **300 000 ms**, el número que `presupuesto.ts:78-82` documenta
como medido ("`fetch` seguía bloqueado a los 20 s sin el menor síntoma" contra un
servidor que acepta y calla). El `Date.now() - start >= maxWaitMs` de la línea
316 se evalúa **después** del `await`, así que los 12 000 ms de `maxWaitMs`
nunca llegan a leerse. Con Supabase degradado —no caído—, una sola vuelta del
bucle bloquea **300 000 ms contra un `maxDuration` de 120 000**: Vercel mata la
función 180 s antes de que el `fetch` se rinda, **antes de que el agente
arranque**.

Consecuencia: el operador escribió "listo" y no recibe absolutamente nada — ni
resumen, ni PDF, ni error. No hay `logger.error` porque el proceso muere antes
de cualquier `catch`, y Meta ya recibió su 200 en `route.ts`, así que no
reintenta. Es exactamente el "peor final posible" que `presupuesto.ts:84-88`
describe, en el único mensaje que importa del flujo.

Causa raíz probable: `acotada` se aplicó por sitio de llamada a `supabaseAdmin()`
y aquí el cliente se hoistea fuera del bucle, así que un solo sitio contado
alimenta un número ilimitado de RPC sin techo.

**REINCIDENTE.** Es el ALTO de la ronda 8 ("toda consulta tiene techo"). La
ronda 9 lo declaró "cerrado de verdad" contando `supabaseAdmin()` contra
`acotada(` en `conv.ts` — hoy siguen dando 10 vs 10, y el conteo sigue pasando
sobre este agujero. El método de verificación es lo que falló, no el arreglo.

### [ALTO] La barrera de intake espera 20 000 ms por un OCR cuyo techo es 25 000 ms — 5 000 ms de ventana en la que siempre se rinde de más
`src/lib/cuadra/processor.ts:1071` (`esperarIntake(viajeId, reloj.acotar(20_000))`)
contra `:314` y `:506` (`extraerComprobante(dataUrl, reloj.senal(25_000))`);
`src/lib/cuadra/conv.ts:380` (el comentario que fija el 20).

Escenario, con valores: el operador manda la foto de un ticket pesado a las
21:04:00. Esa invocación hace `intakeDelta(+1)` y arranca la visión con una
señal de **25 000 ms**. A las 21:04:01 escribe "listo": otra invocación entra a
`esperarIntake` con un tope de **20 000 ms**. Si el OCR tarda **22 s** —legítimo,
está dentro de su propio techo—, la barrera vence a los 20 s, `intakeOk` sale
`false`, se registra `intake.barrera_timeout` (`:1072`) y el agente cuadra
**sin ese comprobante**, guarda la liquidación y manda el PDF. Dos segundos
después la primera invocación termina y escribe el gasto en la base.

Resultado: el PDF que recibió el operador y el panel que abre el contralor
difieren por el monto de ese ticket, y el viaje ya está `liquidado` (el trigger
de la 0037 impide corregirlo). Hay aviso al operador ("cuadré con los N que
alcancé"), pero la discrepancia PDF↔panel no se le avisa a nadie.

Consecuencia: el contralor abre la liquidación en la sala, la compara con el
panel y no cuadran. Con una carga de diésel de $8 000 de por medio, el operador
paga de su bolsa un gasto que sí hizo.

Causa raíz probable: el 20 se dimensionó contra otro presupuesto. El comentario
que lo fija (`conv.ts:380`) todavía dice *"El presupuesto de la función es
maxDuration=60… con 60 s aquí el peor caso son 112 s"*; `PRESUPUESTO_WEBHOOK_MS`
es **120 000** desde el 28-jul (`presupuesto.ts:180-188`) y el 20 nunca se
re-dimensionó por encima del techo del OCR que espera. `reloj.acotar` solo puede
bajarlo, nunca subirlo.

### [ALTO] El cierre corre sin reloj: 125 000 ms de techo contra una reserva de 12 000 ms, y la tabla que debía hacerlo verificable está llena de costos nominales
`src/lib/cuadra/presupuesto.ts:37-51` (`PASOS_CIERRE`), `:54` (`COSTO_CIERRE_MS`),
`:72` (`MARGEN_CIERRE_MS`); `src/lib/cuadra/processor.ts:1158` es la **última**
línea del archivo que menciona `reloj` — todo lo que va después corre a ciegas.

Escenario, con valores: el agente consume su tope de 40 000 ms, caso que
`presupuesto_camino.test.ts:75-81` declara explícitamente soportado ("con SOLO
las esperas al máximo, el agente todavía cabe"). En ese punto el transcurrido es
0.9 (previo nominal) + 20 (barrera) + 12 (mutex) + 40 (agente) = **72.9 s**, y
quedan **47.1 s** de los 120 antes de que Vercel corte. El cierre arranca. Basta
que **5 de sus 13 pasos** agoten su propio techo (5 × 9 500 = **47 500 ms**) para
pasarse de los 120 000. Y `sendDocument` del PDF es el paso **10 de 13**: para
cuando se llega ahí, `guardar_liquidacion` ya corrió **dentro** del agente, así
que el viaje está `liquidado` y el `llm_costo` ya cobrado.

Consecuencia: liquidación cerrada en la base, cero mensajes al operador, cero
líneas de log (el proceso muere antes del `catch`), sin reintento de Meta. Para
el contralor es una liquidación que existe en el panel y que su chofer jura no
haber recibido nunca.

Causa raíz probable: `PASOS_CIERRE` se construyó para hacer verificable el costo
del cierre, pero se pobló con el costo **nominal** de cada paso (0.3 s una
consulta, 1.5 s un `sendText`) en vez de con el techo que el mismo archivo
impone (9.5 s / 10 s), y el test compara esa suma nominal. El comentario que
advierte del riesgo (`:63-71`) además ya no describe este código: dice que
`sendText`/`sendDocument` "siguen usando `fetch` pelado… el techo es el default
de undici: 300 s", y desde `meta/client.ts:17` llevan `SEND_TIMEOUT_MS = 10_000`.

### [ALTO] `/admin`: cuatro escaneos de tabla completa por página, sin techo de consulta y con recorte silencioso a 1 000 filas
`src/lib/admin/negocio.ts:52-57` (las cuatro consultas), `:140-143`
(`facturasPorDia`), `:162` (`facturasTotal`), `:178-180`
(`getCostoPorFaseModelo`); `src/app/admin/layout.tsx:33` (se ejecuta en las 30
páginas de `/admin`, porque vive en el layout).

Ninguna de las 7 consultas del archivo lleva `.limit()`, `.range()` ni
`acotada` — el archivo tiene 4 `supabaseAdmin()` y **0 `acotada`**.

Escenario, con valores: una flota real de 30 unidades × 4 viajes/mes × 10
comprobantes = **1 200 filas de `gasto` en el primer mes**. PostgREST recorta a
`max_rows` (1 000 por default) **en silencio** — no lanza, no loguea: es
textualmente lo que este repo ya documentó y cerró para `analytics.ts:31-41`
("AUDITORÍA 8, ALTO REINCIDENTE"). A partir de la fila 1 001, el contador retro
de facturas (`facturasTotal`, línea 162 = `gastoRes.data.length`) se **congela en
1 000 y no se mueve nunca más**. Peor: la consulta no lleva `.order()`, así que
las 1 000 filas que vuelven son las que PostgREST decida —típicamente las más
viejas—, y `facturasPorDia` (últimos 7 días, línea 140) pinta **siete ceros** en
un mes con actividad diaria. Lo mismo le pasa a `viajesProcesados`,
`costoIaUsd`, `tokensIn/Out`, `porFase`, `porModelo` y a las dos tendencias.

Consecuencia: la consola de negocio de Javier —la pantalla desde la que se fija
el precio del producto, porque de ahí sale el costo de IA por viaje— enseña un
negocio detenido en el mes 1, con la misma cara que si de verdad no hubiera
pasado nada. Y sin `acotada`, un Supabase degradado no degrada la consola: la
cuelga (no hay `export const maxDuration` en ninguna página de `src/app`; solo
lo tiene el webhook).

Causa raíz probable: código nuevo escrito rápido que no heredó ni `traerTodo`
(analytics.ts) ni `acotada` (presupuesto.ts); el comentario de cabecera del
archivo (`:12-14`) reconoce la falta de paginación pero razona sobre el volumen
("hoy son 131 filas"), no sobre el recorte silencioso, que es el modo de fallo.

### [MEDIO] `proxy.ts` cobra ~900 ms de red pura antes del primer dato, en cada navegación del panel, y sin techo
`src/proxy.ts:59` (`await supabase.auth.getUser()`), `:81` (matcher);
`src/lib/auth/session.ts:29` y `:31` (getUser + `app_user`, en serie), `:50`
(reintento con 250 ms).

`getUser()` **siempre** es un viaje de red al servidor de Auth
(`GET /auth/v1/user`): a diferencia de `getSession()`, no decodifica el JWT en
local. Con el costo unitario que este repo usa para un salto a Supabase
(**0.3 s**, `presupuesto.ts:35`):

- proxy: `getUser()` → **300 ms**
- render: `getSessionTenant()` → `getUser()` (300) **+** `select` a `app_user`
  (300), uno detrás del otro → **600 ms**
- **Total ≈ 900 ms de red serializada** en cada carga de `/dashboard`,
  `/mis-viajes` y `/admin`, antes de que se lea el primer dato de negocio. Sobre
  eso corren los 4 escaneos completos de `negocio.ts`.

Los dos `getUser()` del render (layout + página) sí se colapsan en uno solo por
la memoización de `fetch` de Next —verificado en
`node_modules/next/dist/server/lib/dedupe-fetch.js:85-95`: solo se excluye si el
`init` trae `signal`, y ni `postgrest-js` ni `auth-js` lo mandan—, pero el del
proxy corre en otra ejecución y **no** se deduplica: es un round-trip extra
garantizado por request, incluido cada RSC de navegación cliente y cada prefetch
de los enlaces del sidebar que estén en viewport.

Ninguna de las tres llamadas lleva techo (ni `proxy.ts` ni `session.ts` importan
`acotada`), y `getSessionTenant` además **reintenta una vez** tras 250 ms: con
Auth degradado, decidir "¿hay sesión?" puede costar 2 × 300 s + 250 ms.

Consecuencia: cada clic del contralor en el panel paga ~0.9 s antes de empezar a
cargar; con Auth lento, la página no muestra estado degradado — se queda en
blanco hasta que Vercel corta.

Causa raíz probable: la validación se puso en la capa del proxy *además de* en la
página, sin compartir resultado entre las dos ejecuciones ni imponerle el mismo
techo que el resto del repo ya tiene.

### [MEDIO] La imagen que cuesta dinero va a resolución nativa; la que no cuesta nada va reducida a 1 600 px
`src/lib/cuadra/intake/ocr.ts:257` (`images: [principal]`),
`src/lib/meta/client.ts:192-193` (base64 del buffer crudo, sin tocar),
`src/lib/cuadra/intake/cfdi.ts:243-249` (`sharp(image).resize({ width: 1600 })`).

El mismo buffer sigue dos caminos. El **gratis** (zxing, CPU local) se reduce a
1 600 px porque el repo ya midió que a resolución nativa "cuesta segundos y no
encuentra nada que no encuentre la de 1 600 px", y el comentario nombra el caso
real: **"una foto de 24 Mpx"**. El **caro** (la llamada de visión) recibe el
original de 24 Mpx, en base64 —33 % más de cuerpo—, dentro de un
`reloj.senal(25_000)`.

Números: la estimación de costo escrita en el repo es **$0.015 por visión**
(`processor.ts:503,794`). A `PRICES['google/gemini-3.6-flash'] = [1.5, 7.5]`
USD/1M (`openrouter.ts:85`), los 1 000–1 800 tokens de razonamiento que el propio
repo midió (`openrouter.ts:41-45`) más ~100 de JSON ya cuestan **$0.0083–$0.0143
solo de salida**. Le quedan entre **$0.0007 y $0.0067** a la entrada, es decir
entre **500 y 4 500 tokens de imagen**. Una foto de 24 Mpx sin redimensionar no
cabe en ese rango con ningún esquema de teselado; con 8 comprobantes por viaje,
el error se multiplica por 8 contra un presupuesto declarado de **$0.03–0.05 por
liquidación** (`models.ts:17`).

Consecuencia: el costo unitario con el que se va a poner precio al producto
tiene su componente mayor sin medir, y va a la baja. El dato para medirlo **ya
se está guardando** (`llm_costo.tokens_in`, `processor.ts:315,508`) y ya se pinta
en `/admin/agente-ocr`; nadie lo ha contrastado contra el $0.015 escrito a mano.

Causa raíz probable: `sharp` ya es dependencia de la función (15.34 MB del
bundle, según la medición del propio `next.config.ts`) y ya toca este buffer,
pero el resize se ató al lector de códigos y no al camino que paga tokens.

### [MEDIO] Hasta 50 `INSERT` en serie, sin consultar el presupuesto ni una vez
`src/lib/cuadra/processor.ts:1015-1025` (`for (const h of ofrecidos) { await addGasto(…) }`),
`src/lib/cuadra/repo.ts:281` (`getHuerfanos` … `.limit(50)`),
`src/lib/cuadra/repo.ts:119-149` (`addGasto`, `acotada`).

Escenario, con valores: un operador pasó el fin de semana mandando fotos sin
viaje abierto y acumuló **50 huérfanos** (el tope exacto de `getHuerfanos`). La
oficina le abre el viaje, él contesta **"sí"**. El bucle emite 50 `INSERT`
secuenciales. Nominal, al costo unitario del repo (0.3 s): **15 000 ms**, más
`resolverHuerfanos` + `getGastos` + `sendText` ≈ **17.1 s**. Con Supabase
degradado a 2 s por insert: **100 s** + previo → Vercel corta a los 120 s con los
comprobantes a medio adjuntar y `resolverHuerfanos` (`:1026`) sin ejecutar. Techo
teórico del bucle: 50 × 9 500 = **475 000 ms**, **3.96× la invocación completa**.

El bucle no consulta `reloj` ni una vez, mientras `presupuesto.ts:92-95` justifica
`TOPE_CONSULTA_MS = 8_000` diciendo que "con 8 s la invocación sobrevive a TRES
colgadas antes de tocar el límite" — aquí se pueden emitir cincuenta.

Consecuencia: el operador dice "sí", no recibe respuesta, y no sabe si sus 50
comprobantes se adjuntaron. (Los huérfanos no resueltos se le vuelven a ofrecer y
el índice único `uq_gasto_img_hash` evita el duplicado, así que no es dinero mal:
es un turno perdido sin aviso.)

Causa raíz probable: el bucle se escribió pensando en el conteo típico (2-3
huérfanos), no contra el `.limit(50)` que le fija la cota superior, y no hay una
salida por presupuesto agotado.

### [MEDIO] El panel del contralor no tiene ni un techo de consulta: 5 `supabaseAdmin()` / 0 `acotada`, con paginación de hasta 100 consultas encadenadas
`src/lib/cuadra/analytics.ts:8` (importa `supabaseAdmin`, **no** `acotada`),
`:42-54` (`traerTodo`, `MAX_PAGINAS = 100`), `:146-158` (`detectarAnomalias`);
`src/app/dashboard/page.tsx:34` (`getLiquidaciones`, también crudo).

La ronda 9 verificó el techo contando `supabaseAdmin()` contra `acotada(` en
`repo.ts`, `conv.ts`, `costos.ts` y `config.ts`. `analytics.ts` no estaba en esa
lista y hoy da **5 vs 0**; `dashboard/page.tsx`, **1 vs 0**;
`auth/provisionar.ts`, **2 vs 0**. Es decir: el camino del webhook tiene techo, el
camino del **panel** no tiene ninguno, y tampoco declara `maxDuration`.

Escenario, con valores: la misma flota de 30 unidades acumula ~14 400 filas de
`gasto` en un año. `detectarAnomalias` (`:150`) encadena **15 consultas
secuenciales** de 1 000 filas cada una — 15 × 0.3 s = **4.5 s** solo esa tarjeta,
en **cada** carga del panel, sin caché (la página es dinámica por
`requireSessionTenant`). Y basta una de esas 15 lenta para que la carga no tenga
piso: sin `acotada` el techo es el default de undici, **300 s**.

Consecuencia: el panel se degrada linealmente con la antigüedad de la flota, y
en un episodio de Supabase degradado se cuelga en blanco en vez de pintar el
fallback que `safe()` (`dashboard/page.tsx:23-25`) fue diseñado para pintar —
`safe()` atrapa excepciones, no esperas.

### [BAJO] El ciclo de tools del cuadre re-factura el prefijo completo en cada ronda: no hay prompt caching en ningún sitio del repo
`src/lib/llm/openrouter.ts:487-490` (se arma `convo` una vez y se reenvía entero
en cada vuelta), `:497-513` (`body()`, sin `cache_control`), `:528`
(`for (let round = 0; round < maxRounds; round++)`), `:476`
(`maxToolRounds ?? 6`).

`grep -rn "cache_control\|prompt_cache\|cached_tokens" src/` → **0 resultados**.

Números: el system prompt de liquidación son **3 343 caracteres** (~900 tokens,
`agents/prompts.ts:16-38`) más 3 esquemas de tool (`cuadra/tools.ts`, 12 KB en
total, de los que el agente monta 3) ≈ **1 200 tokens de prefijo invariante**. El
flujo normal son 4 completions (consultar_politica → cuadrar_viaje →
guardar_liquidacion → respuesta). Sin caché, ese prefijo se paga 4 veces:
**4 800 tokens de entrada × $2/1M** (Sonnet 5, precio intro vigente hasta
31-ago-2026, `openrouter.ts:87`) = **$0.0096 por liquidación**, ~20-30 % del
presupuesto declarado de $0.03–0.05. Anthropic vía OpenRouter soporta
`cache_control`; el prefijo es literalmente estático entre rondas.

Consecuencia: deuda, no fallo. Pero es un quinto del costo unitario del producto,
en el rol más caro del stack, y crece con `maxToolRounds`.

---

## Lo que revisé y está bien

- **Ruteo de modelos por rol** (`models.ts`). OCR en Gemini Flash, cuadre en
  Sonnet con `reasoning: 'high'` solo donde el error cuesta dinero, chat/router
  en Flash-Lite. Sigue siendo la asignación correcta y no cambió.
- **Costo por ronda al precio del modelo que respondió esa ronda**
  (`openrouter.ts:479-486,536`), con su prueba. Verificado que `calcCost` usa
  `activeModel` y no el modelo inicial.
- **`calcCost` no devuelve $0 ante un modelo desconocido** (`openrouter.ts:106-120`):
  estima con la tarifa más cara de la tabla y loguea. Es la decisión correcta
  para un producto que se cobra por liquidación.
- **`costos.ts` — tres estados, no uno** (`ResumenCosto`, `:247-250`). "No se
  pudo medir" no puede pintarse como $0. `registrarCosto` descarta NaN en vez de
  escribir una fila que se leería como gratis (`:120-127`), y
  `avisarSiNoHayCosto` (`:203-221`) grita cuando una liquidación cierra sin una
  sola fila de costo. Está bien pensado y bien probado.
- **`sendText`/`sendDocument` ya llevan techo** (`meta/client.ts:17,94,125`,
  `SEND_TIMEOUT_MS = 10_000`), y `downloadMediaAsDataUrl`/`downloadMediaAsText`
  también (15 s). Esto **mejoró** respecto a lo que `presupuesto.ts:66-70`
  todavía afirma; el comentario es el que quedó viejo, no el código.
- **`traerTodo` de `analytics.ts` sí pagina de verdad** (`.range()` hasta
  `MAX_PAGINAS = 100`): el recorte silencioso a 1 000 filas está cerrado **en ese
  archivo**. El problema es que el patrón no viajó a `negocio.ts` (ver ALTO-4).
- **`getHuerfanos` lleva `.limit(50)`** y `marcarHuerfanosOfrecidos` /
  `resolverHuerfanos` usan `.in(…)`, una sola consulta para N filas — no hay N+1
  ahí. El N+1 es solo el bucle de `addGasto` (MEDIO arriba).
- **`getConversacionesActivas`** (`negocio.ts:212-219`) sí lleva `.limit(20)` y
  `.order()` — es la única consulta del archivo nuevo que está acotada.
- **El chat de `/admin`** (`admin/chat.tsx`) **no llama a ningún LLM**: es
  coincidencia de palabras clave contra el resumen ya calculado. Cero costo de
  tokens, y el comentario explica por qué a propósito.
- **`decodeCodigosFromImage` sigue siendo gratis en dólares** (zxing-wasm local)
  y ahora corre **una sola vez** por foto: el doble decode que reporté como BAJO
  en la ronda 9 desapareció con la reversión de `foto_pendiente`.
- **`PRESUPUESTO_WEBHOOK_MS` sigue sincronizado con `maxDuration = 120`**, con
  su prueba que falla si se desincronizan (`presupuesto.test.ts:80-90`). El
  mecanismo es bueno; lo que no se comprueba es el peor caso (ver ALTO-3).

## Lo que NO alcancé a revisar

- **Costo real facturado.** Todo lo de arriba se calcula contra `PRICES` y contra
  los comentarios del repo. No tuve acceso a la cuenta de OpenRouter ni a
  `llm_costo` con datos reales, así que el $0.015/visión y el $0.03–0.05/liquidación
  siguen sin contrastarse contra una factura. Con 131 filas de `llm_costo` ya
  existentes, este contraste es de media hora y cerraría el MEDIO de la imagen.
- **Peso real de una foto de WhatsApp Cloud API.** Cité el "24 Mpx" que el propio
  repo midió (`cfdi.ts:244`) y el tope de 5 MB de la Cloud API, pero no medí la
  distribución real de tamaños que llega del cliente de WhatsApp, ni conté
  tokens de imagen contra `llm_costo.tokens_in`.
- **Presupuesto de la ruta del XML del CFDI** (`processor.ts:858-985`, con su
  propio `acquireViajeLock(reloj.acotar(12_000))` en `:889`). Hereda el mismo
  agujero de mutex del ALTO-1, pero no le hice la suma completa como al camino
  del "listo".
- **Latencia real Vercel↔Supabase y Vercel↔OpenRouter.** Todos los números
  usan el costo unitario que el repo asume (0.3 s/consulta). Si la latencia real
  es peor, los peores casos de arriba empeoran proporcionalmente; si es mejor,
  los techos (9.5 s, 10 s) no se mueven y las sumas del peor caso tampoco.
- **Prefetch de los 29 enlaces del sidebar de `/admin`.** Las secciones arrancan
  colapsadas (`sidebar-nav.tsx:69`), así que el abanico máximo es ~10 enlaces por
  sección abierta; no verifiqué en un navegador cuántas peticiones RSC de
  prefetch dispara Next 16 para rutas dinámicas sin `loading.tsx`, así que no lo
  reporté como multiplicador del MEDIO del proxy.
- **`getResumenCosto`** (`costos.ts:253-289`) tiene el mismo recorte silencioso a
  1 000 filas que `negocio.ts`, pero **no lo llama nadie** (grep: solo su propio
  test). No lo reporto como hallazgo porque hoy no tiene consumidor; lo dejo
  anotado porque el día que el panel lo use, entra con el defecto puesto.
