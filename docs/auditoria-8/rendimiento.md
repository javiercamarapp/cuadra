# Rendimiento y costo — auditoría 8

**Nota: 4/10** (antes 7). Razón del movimiento: **mirada más profunda — el
mecanismo de presupuesto no cambió, y la nota anterior estaba inflada.** La
ronda 6 escribió «el peor caso sumado sigue cabiendo — 90.8 s contra 120 s» y
llegó a esa cifra usando el costo **promedio** (0.3 s por consulta) para ocho
eslabones que tienen un **techo escrito de 9,500 ms** en el propio repo
(`TOPE_CONSULTA_MS = 8_000` + `GRACIA_TOPE_MS = 1_500`). Eso no es el peor caso:
es el caso normal con dos etapas al máximo. Sumado con el techo que cada
eslabón declara, el mismo camino da **126.1 s contra `maxDuration = 120`**. Y
hay un resultado que no depende de ninguna estimación: los tres números
constantes del archivo —`PRESUPUESTO_WEBHOOK_MS − MARGEN_CIERRE_MS = 108,000`,
`COSTO_CIERRE_MS = 8,900`, y el `flushObservabilidad()` de hasta 4,000 ms que
`route.ts:90` agregó esta ronda y que ninguna tabla contempla— **suman 120,900
contra 120,000**. El presupuesto no cabe en su propio límite por pura
aritmética, sin suponer un solo milisegundo.

**El riesgo mayor de este rubro, hoy:** el turno que cierra la liquidación puede
pasarse de 120 s sin que ningún mecanismo lo corte, y cuando Vercel mata la
función la liquidación ya está escrita en la base, el operador no recibe ni
resumen ni PDF, `pdf.no_entregado` no se escribe, y Meta —que ya tiene su 200 en
`route.ts`— no reintenta.

---

## La suma del peor caso

Camino auditado: mensaje de texto **«listo»** que cierra la liquidación. Es el
paso 3 del guion del demo. Cada eslabón con el techo **escrito en el código**;
donde no hay techo escrito, con el costo unitario que el propio
`presupuesto.ts:33` declara (0.3 s consulta, 1.5 s `sendText`, 2.5 s
`sendDocument`, 0.5 s URL firmada) — y se marca que su techo REAL es el default
de undici, 300,000 ms.

| # | eslabón | `archivo:línea` | techo escrito | peor caso (ms) | acumulado (s) |
|---|---|---|---|---|---|
| 0 | arranque en frío | — | ninguno | fuera del reloj | — |
| 0b | `claimMessage` | `conv.ts:215-217` | **ninguno** (undici 300 000) | 300 | *fuera del reloj*: arranca en `processor.ts:222`, tres líneas después |
| 1 | `resolveOperador` | `conv.ts:59-60` | **ninguno** | 300 | 0.3 |
| 2 | `getOpenViaje` | `conv.ts:123-124` | **ninguno** | 300 | 0.6 |
| 3 | `getDatosResponsable` | `repo.ts:428` (`acotada`) | 8 000 + 1 500 | 9 500 | 10.1 |
| 4 | `reclamarEnvioAviso` | `repo.ts:477` (`acotada`) | 9 500 | 9 500 | 19.6 |
| 5 | barrera de intake | `processor.ts:603` → `reloj.acotar(20_000)` | 20 000 | 20 000 | 39.6 |
| 5b | último sondeo de la barrera | `conv.ts:326` (`intake_delta`, crudo) | **ninguno** | 300 | 39.9 |
| 6 | mutex del viaje | `processor.ts:636` → `reloj.acotar(12_000)` | 12 000 | 12 000 | 51.9 |
| 6b | último `try_lock_viaje` | `conv.ts:263` (crudo) | **ninguno** | 300 | 52.2 |
| 7 | `getOpenViaje` (re-verificación) | `processor.ts:649` | **ninguno** | 300 | 52.5 |
| 8 | `getTenantContext` | `conv.ts:142-143` | **ninguno** | 300 | 52.8 |
| 9 | `loadConversation` | `conv.ts:168-175` | **ninguno** | 300 | 53.1 |
| 10 | agente | `processor.ts:690` → `run.ts:32` (`AbortController`) | `reloj.acotar(40_000)` | 40 000 | 93.1 |
| 11 | **ronda de tools que el abort NO corta** | `tool-executor.ts:18` (signal declarado, cero lectores) | **ninguno** | 20 107 | **113.2** |
| 12 | cierre, 13 pasos | `presupuesto.ts:35-49` | reserva 12 000 · techo real: ninguno en 11 de 13 | 8 900 | **122.1** |
| 13 | `flushObservabilidad()` | `route.ts:90` → `sentry.ts:129-134` | 2 000 + 2 000 | 4 000 | **126.1** |

**126.1 s contra `maxDuration = 120` (`route.ts:28`). Se pasa por 6.1 s.**

Desglose del eslabón 11 (`guardar_liquidacion`, `tools.ts:139-183`), que es la
ronda de tools más cara y la que corre justo cuando el abort de los 40 s puede
dispararse:

| sub-paso | línea | ms |
|---|---|---|
| `Promise.all[computeCuadre, getViaje, getOperador]` | `tools.ts:151-155` | 9 500 (el más lento manda; `getConfig` dentro va crudo, sin techo) |
| `generarLiquidacionPDF` ×2 | `tools.ts:176-177` | 107 (**medido en esta máquina**: 89 + 18 ms) |
| 2 × `storage.upload` | `tools.ts:168-172` | 1 000 (crudos, sin techo) |
| `saveLiquidacion` | `tools.ts:181` → `repo.ts:397` (`acotada`) | 9 500 |
| | | **20 107** |

**Y el resultado que no depende de ninguna estimación.** El reloj compartido
garantiza que `restante()` (`presupuesto.ts:145`) llegue a 0 en
`PRESUPUESTO_WEBHOOK_MS − MARGEN_CIERRE_MS = 108 000` ms. Ese punto es
alcanzable de verdad: con `elapsed = 93 000` la guarda `alcanza(15_000)`
(`processor.ts:672`) pasa justo, y `acotar(40_000)` devuelve 15 000, así que el
agente termina exactamente en 108 000. A partir de ahí, con TODO lo demás en su
mejor caso:

```
108 000  fin del agente (garantizado por el reloj)
+ 8 900  COSTO_CIERRE_MS  (presupuesto.ts:52)
+ 4 000  flushObservabilidad (route.ts:90, sentry.ts:129)
────────
 120 900  contra maxDuration = 120 000
```

**El presupuesto no cabe en su propio límite ni en el camino más favorable.** La
holgura que `MARGEN_CIERRE_MS` reserva sobre `COSTO_CIERRE_MS` son 3 100 ms, y
el `flush` que se cableó esta ronda necesita hasta 4 000.

**Lo que la prueba de camino sí verifica y lo que no.**
`presupuesto_camino.test.ts` (nueva, 7 pruebas, pasan) modela **tres** etapas
—barrera, mutex, agente— más un bulto `previo`, y su `gastar` es
`ahora += Math.min(real, p.acotar(pedido))` (`:27`). Por construcción **ninguna
etapa puede pasarse de su ventana**, que es exactamente el modo de falla real
(eslabones 5b, 6b y 11). La prueba se titula «EL PEOR CASO TIENE QUE CABER EN SU
PROPIO PRESUPUESTO» y demuestra la aritmética de `acotar`, no la del camino.
Tampoco cuenta el eslabón 13.

---

## El JSON de permisos CRE

**Medido en esta máquina, no estimado.**

| qué | valor |
|---|---|
| peso en disco | **436 600 bytes = 426.4 KiB = 0.416 MiB** (`src/lib/cuadra/facturacion/permisos_cre.json`) |
| forma | objeto plano, **12 625 claves**, 3 226 marcas distintas |
| cómo se carga | `import PERMISOS from './permisos_cre.json'` — estático, `permiso_cre.ts:67` |
| `JSON.parse` en frío | **8.88 ms**; caliente 4.5–6.9 ms (6 corridas) |
| `readFileSync` | 1.77 ms |
| eval del módulo compilado | **11.06 ms** si el bundler emite `JSON.parse("…")` · **12.64 ms** si emite un literal de objeto (medí las dos formas) |
| a través de tsx (con transpilación de TS) | 47.02 ms |
| heap retenido | **1.57 MiB** (medido con `--expose-gc`, antes/después) |
| segunda importación | 2.87 ms — **caché de módulos**, no re-parseo |
| costo de uso | 10 000 `identificarPorPermiso` en **6.06 ms** (0.6 µs cada uno) |

**¿Se parsea una vez o por llamada? Una vez por proceso.** Es un `import`
estático de nivel de módulo: la caché de módulos de Node/webpack lo evalúa la
primera vez que alguien lo requiere y nunca más. **La premisa del encargo —«un
JSON de ese tamaño cargado en cada invocación de una función serverless»— no se
cumple aquí.** Lo digo porque es el resultado, no porque convenga: se paga una
vez por arranque en frío, no por mensaje.

**Efecto real en el arranque en frío: cero, porque el módulo no se carga nunca.**
`permiso_cre.ts` **no lo importa ni un solo archivo de producción**. Verificado
con dos búsquedas independientes, como pide el MAPA:

1. por ruta de import (`permiso_cre`, `permisos_cre`) → solo
   `permiso_cre.test.ts:6` y el propio `permiso_cre.ts:67`;
2. por cada símbolo exportado (`identificarPorPermiso`, `coberturaTablaCre`,
   `permisosDelTicket`, `permisoDelTicket`, `normalizarPermiso`,
   `ResultadoPermiso`) sobre todo `src/` → **cero resultados** fuera del propio
   archivo y su prueba.

Su propia prueba lo fija por escrito: `permiso_cre.test.ts:161-163` afirma que
`identificar.ts` **no** contiene `permiso_cre`.

Así que hoy la tabla es **peso muerto**: 426 KiB y un módulo que nadie llama. Si
mañana se cablea —y el código está escrito para eso— el costo pasa a ser **~11–13
ms de evaluación en cada arranque en frío y 1.57 MiB residentes**, contra un
trabajo útil de 0.6 µs por consulta. Es un intercambio aceptable *si se usa*; hoy
es 100 % desperdicio.

Lo que sí puede estar pagándose ya: `outputFileTracingExcludes`
(`next.config.ts:87-113`) excluye `./src/**/*.ts` y `./src/**/*.tsx` pero **no
`./src/**/*.json`**, y el propio comentario del archivo explica que
`cfdi.ts` lee el `.wasm` con `process.cwd()` y eso hace que el tracer «dé por
alcanzable todo lo que cuelgue de la raíz». Es el único `.json` bajo `src/` y
pesa más que los 20 archivos de proyecto que la última medición decía que
quedaban. No pude confirmarlo: el encargo prohíbe `npm run build` y sin trace no
hay número. Queda como el hallazgo BAJO de abajo, con esa incertidumbre dicha.

**El catálogo de comercios (13 → 37):** `comercios.ts` son 33 443 bytes,
evaluación medida **16.80 ms**, y `identificarComercio` (`identificar.ts:30-51`)
es un barrido lineal de 37 elementos por gasto. A 37 entradas eso son
microsegundos. **No es un hallazgo.**

---

## Hallazgos

### [CRÍTICO] El presupuesto de la invocación no cabe en su propio `maxDuration`, y el exceso mata el turno en silencio

`src/lib/cuadra/presupuesto.ts:52,70,118,145` · `src/app/api/webhook/whatsapp/route.ts:28,90` ·
`src/lib/observability/sentry.ts:129-134`

**Escenario:** el operador escribe «listo». El reloj compartido deja al agente
correr hasta `120 000 − 12 000 = 108 000` ms — y ese punto es alcanzable: basta
que lo previo consuma 93 000 ms para que `alcanza(15_000)` (`processor.ts:672`)
pase justo y `acotar(40_000)` devuelva 15 000. El agente termina en 108 000. Le
siguen los 13 pasos del cierre (`COSTO_CIERRE_MS = 8 900`, y son 8 900 en el
**mejor** caso, con los costos unitarios optimistas del propio archivo) y el
`await flushObservabilidad()` de `route.ts:90`, que espera
`Promise.allSettled` de los envíos en vuelo y luego `sentry.flush(2000)`: hasta
4 000 ms. **108 000 + 8 900 + 4 000 = 120 900 > 120 000.** Con los techos
escritos de cada eslabón en vez de sus promedios, la suma es **126 100 ms**
(tabla completa arriba).

**Consecuencia:** cuando Vercel mata la función, `guardar_liquidacion` ya corrió
—la liquidación está escrita, los dos PDF están en storage, el viaje está
`liquidado`—. El chofer no recibe ni el resumen ni el PDF. `pdf.no_entregado`
(`processor.ts:887`) no se escribe porque el proceso muere antes. Meta no
reintenta. Y `getOpenViaje` ya no encuentra nada si el operador reenvía: callejón
sin salida. Es el modo de falla que `presupuesto.ts:4-7` describe como el que
este archivo viene a evitar.

**Causa raíz probable:** `MARGEN_CIERRE_MS` se dimensionó contra
`COSTO_CIERRE_MS` y deja 3 100 ms de holgura; el `flushObservabilidad` que se
cableó esta ronda es un **decimocuarto** paso de red de la invocación que no está
en `PASOS_CIERRE` y necesita hasta 4 000.

---

### [CRÍTICO] El abort de los 40 s del agente no corta la tool en vuelo: `ToolContext.signal` se declara y no lo lee nadie

`src/lib/llm/tool-executor.ts:18` · `src/lib/agents/run.ts:32-36` ·
`src/lib/llm/openrouter.ts:567-597` · `src/lib/cuadra/tools.ts:139-183`

**Escenario:** `run.ts:32` arma `setTimeout(() => controller.abort(), timeoutMs)`
con `timeoutMs = reloj.acotar(40_000)` y mete `controller.signal` en el `ctx`
(`run.ts:34`). Pero `opts.signal` solo se le pasa a
`client.chat.completions.create` (`openrouter.ts:514-516`); las tools se ejecutan
en `Promise.all(calls.map(...))` (`openrouter.ts:567`) **sin señal**. Grepeando
`signal` sobre `tool-executor.ts`, `tools.ts`, `desde_db.ts`, `config.ts` y
`pdf.ts` hay **una sola aparición**: la declaración del campo en
`tool-executor.ts:18`. Cero lectores.

Con números: el abort dispara a los 40 000 ms mientras corre
`guardar_liquidacion`. Esa tool sigue hasta el final: `Promise.all` de tres
lecturas (**9 500 ms**, el techo de `acotada`), dos PDF (**107 ms medidos**), dos
`storage.upload` sin techo (**1 000 ms**) y `saveLiquidacion` (**9 500 ms**) =
**20 107 ms**. El agente, que tenía una ventana de 40 s, consume 60.1 s. Ese
sobrepaso es el que convierte los 108 s garantizados en los 126.1 s de la tabla.

**Consecuencia:** el sobrepaso empuja la invocación fuera de `maxDuration`
justo en el turno en que la liquidación se persiste. El contralor ve en el panel
una liquidación cerrada de la que el chofer jura no haber recibido nada, y no hay
log que lo explique.

**Causa raíz probable:** el `AbortController` se diseñó para cortar la llamada al
modelo, y el ciclo de tools se ejecuta en nuestro código, fuera de su alcance; el
campo `signal` del contexto se creó para cerrarlo y quedó sin cablear.

---

### [ALTO] `getAcumuladoCombustible` puede hacer 100 consultas secuenciales dentro de un turno de 40 s, sin mirar el reloj

`src/lib/cuadra/repo.ts:595-651` (`MAX_PAGINAS = 100` en `:603`, bucle en `:610`) ·
llamado desde `src/lib/cuadra/tools.ts:105`

**Escenario:** el operador escribe «listo», el agente llama `cuadrar_viaje`, y
esa tool llama `getAcumuladoCombustible` para el tope del 15 % de la RFA 2026. El
bucle pagina de 1 000 en 1 000, **secuencialmente**, hasta 100 vueltas. Cada
vuelta es una llamada `acotada` con techo de **9 500 ms**. El bucle no consulta
`restante()`, no recibe `AbortSignal` y no tiene tope de tiempo: solo de páginas.

Los números con la flota que el propio comentario documenta (`repo.ts:578`, «50
operadores, ~18 000 cargas de diésel al año»): **18 páginas**. A los 300 ms que
el repo declara por consulta = 5.4 s. A un p95 de 1 500 ms = **27 s** — más de la
mitad de la ventana de 40 s del agente, en una sola tool. Al techo escrito de
9 500 ms por página = **171 s**, más que la invocación entera. Y el techo
absoluto que el código permite son 100 × 9 500 = **950 000 ms**.

**Consecuencia:** para una flota mediana, el turno de cierre se pasa del
presupuesto durante el paso más visible del demo. Para el contralor es «se quedó
pensando y no llegó nada». El `try/catch` de `tools.ts:104-110` es best-effort
para el ERROR, no para el TIEMPO: una consulta lenta no lanza, tarda.

**Causa raíz probable:** el arreglo de la ronda 6 cambió «una consulta que mentía
a la baja» por «N consultas que dicen la verdad», y N quedó acotado por número de
páginas pero no por el reloj compartido que gobierna todo lo demás.

---

### [ALTO · REINCIDENTE de la ronda 6] «Ahora hay techo por consulta» sigue cubriendo 2 de los 13 pasos del cierre

`src/lib/cuadra/costos.ts:130,170,203,256` · `src/lib/cuadra/conv.ts:60,124,143,169,217,228,263,326,390,403` ·
`src/lib/cuadra/config.ts:178` · `src/lib/meta/client.ts:83,108` ·
`src/lib/cuadra/processor.ts:880` · `src/lib/cuadra/tools.ts:168-172`

Verificado de nuevo archivo por archivo esta ronda: **nada cambió**.
`grep -n "supabaseAdmin()" repo.ts` da 17 usos, **todos** envueltos en `acotada`;
`grep` sobre `costos.ts`, `conv.ts` y `config.ts` da **catorce** usos de
`supabaseAdmin()` crudo, ninguno con `abortSignal` ni carrera contra
temporizador. `meta/client.ts:83` y `:108` siguen con `fetch` pelado (los
`downloadMedia*` sí llevan `AbortSignal.timeout(15_000)`, `:153,159,174,180`).
`processor.ts:880` (`createSignedUrl`) y `tools.ts:168-172` (los dos `upload` a
storage) siguen crudos.

**Escenario con números:** un socket se queda a medio abrir en `registrarCosto`
(`costos.ts:130`), que es el **primer** paso después de que el agente ya guardó la
liquidación. Techo real: el default de undici, **300 000 ms**, o sea **2.5 veces
el `maxDuration` entero**. Nada de lo que sigue corre: ni el `sendText` del
resumen (`processor.ts:840`), ni el PDF, ni `saveConversation`. La invocación se
queda viva hasta que Vercel la mata.

**Consecuencia:** una sola conexión colgada en cualquiera de los 11 puntos sin
techo se lleva la invocación completa, con la liquidación ya escrita. El propio
`presupuesto.ts:62-68` admite 3 de los 11 (`sendText`/`sendDocument`); los otros 8
siguen sin mención.

**Causa raíz probable:** sin cambios respecto a la ronda 6 — el arreglo se aplicó
por archivo (`repo.ts`) y el cierre es una secuencia que cruza cinco módulos.

---

### [ALTO · REINCIDENTE de las rondas 5 y 6] El protocolo de dos fotos sigue pagando una llamada de visión completa por el acercamiento

`src/lib/cuadra/processor.ts:371` · `src/lib/cuadra/intake/ocr.ts:246-254`

Sigue siendo `extraerComprobante(dataUrl, …)` — **una** foto por llamada — aunque
la firma acepte `string | string[]` (`ocr.ts:219`). Cada foto llega como su propio
mensaje, abre su propio `processInbound` y paga su propia llamada de visión.

**Escenario con números medidos esta ronda:** el prompt de sistema del OCR
(`ocr.ts:83-130`) mide **8 036 caracteres ≈ 2 009 tokens** de entrada, y se
reenvía íntegro en cada foto. La salida, según el propio comentario de
`openrouter.ts:41-45`, son «1 000–1 800 tokens de razonamiento invisible» más
~100 de JSON: **~1 500 tokens de salida**. Con los precios de
`openrouter.ts:85` (`gemini-3.6-flash`, $1.5 / $7.5 por 1M):

```
salida:  1 500 × 7.5/1e6 = $0.01125
entrada: 2 009 × 1.5/1e6 = $0.00301   (sin contar los tokens de la imagen)
                            ────────
por foto, piso                $0.0143
```

Una liquidación de 8 comprobantes con el protocolo de dos fotos son **16
llamadas**, de las cuales **8 son acercamientos**. Esas 8 devuelven
`motivo: 'solo_codigo'` (`ocr.ts:426,441`) y no dan de alta ningún gasto: el
folio, el código de barras y la liga ya salieron gratis de `decodeCodigosFromImage`
(`ocr.ts:237`, zxing, sin LLM). **≥ $0.114 por liquidación en llamadas de visión
que no compran nada.** A 5 200 liquidaciones/año (50 operadores, 2 por semana),
**≥ $595/año quemados**.

**Consecuencia:** quien paga la factura de OpenRouter paga el doble de la partida
dominante del costo unitario, en un producto que va a cobrar **por liquidación**.

**Causa raíz probable:** el batching existe en la firma y nunca se cableó al
llamador; y el estado `solo_codigo` solo se puede saber DESPUÉS de la llamada de
visión, así que el arreglo pasa por juntar las dos fotos en una llamada, no por
saltarse una.

---

### [MEDIO] El costo real por liquidación es ~6–10× el que declara el código, calculado desde tokens medidos aquí

`src/lib/llm/models.ts:17` · `src/lib/llm/openrouter.ts:85-91`

`models.ts:17` sigue diciendo `Costo ≈ $0.03–0.05 / liquidación`. Reconstruido
esta ronda desde conteos medidos en esta máquina, no heredados:

| partida | derivación | USD |
|---|---|---|
| visión, 16 fotos | 16 × $0.0143 (ver hallazgo anterior; **excluye tokens de imagen**) | 0.229 |
| turno de cuadre | contexto fijo medido **1 061 tokens/ronda** (system 835 + schemas 227, `prompts.ts` + `tool-executor.ts:35`), 4 completados con historial creciente ≈ 11 000 in / 1 900 out, Sonnet 5 a $2/$10 | 0.041 |
| WhatsApp saliente | 3 mensajes × $0.008 (`costos.ts:46`) | 0.024 |
| | **piso** | **≈ $0.294** |

Coincide con los ~$0.33 que midió la ronda 5 y **contradice el comentario por un
factor de 6 a 10**. Además `openrouter.ts:87` sigue con
`'anthropic/claude-sonnet-5': [2, 10]  // intro VIGENTE hasta 31-ago-2026;
revertir a [3,15] después`: sin lógica de fecha, sin prueba, sin alerta. El
1-sep-2026 el costo real sube 50 % y `calcCost` seguirá reportando el precio
viejo, en silencio, en la tabla `llm_costo` que es la única fuente del costo
unitario.

**Consecuencia:** el número con el que se va a fijar el precio del producto está
escrito 6–10× por debajo del real, en el archivo que un fundador leería para
fijarlo.

**Causa raíz probable:** el comentario se escribió antes del protocolo de dos
fotos y antes de `reasoning: 'high'` (`models.ts:63`), y nada lo compara contra lo
que la base ya registra.

---

### [MEDIO] La barrera de intake gasta ~24–34 viajes de red por cierre, sin techo en ninguno — casi la mitad de todas las consultas del turno

`src/lib/cuadra/conv.ts:344-385` (grace en `:366`, `sleep(500)` en `:383`) ·
`src/lib/cuadra/conv.ts:326` (`intakeDelta`, crudo)

**Escenario:** «listo» con una ráfaga de fotos todavía en OCR. `esperarIntake`
sondea con `intakeDelta(id, 0)` —una RPC a Supabase— cada 500 ms hasta agotar los
20 000 ms. Con un RTT de 300 ms el periodo es 800 ms → **~23 sondeos**; con RTT de
50 ms, **~33**. Más el sondeo de gracia. Ninguno pasa por `acotada`: techo real
300 000 ms cada uno.

Contadas a mano, las llamadas de red del turno de cierre completo son **~60**:
9 antes de la barrera, **24–34 de la barrera**, 13 dentro del agente (getConfig +
3 de `cuadrarDesdeDB` + acumulado + 3 de `computeCuadre` en `guardar_liquidacion`
+ getViaje + getOperador + 2 uploads + saveLiquidacion) y 9–12 en el cierre.
**La barrera es ~47 % del total** y no aporta ningún dato: solo pregunta si el
contador llegó a cero.

**Consecuencia:** carga innecesaria sobre el pool de Postgres del tenant durante
justo la ventana en la que todo lo demás compite por él, y una superficie de 34
sockets sin techo dentro del eslabón que ya consume 20 s del presupuesto.

**Causa raíz probable:** la barrera es un sondeo activo donde el dato ya vive en
Postgres y podría notificarse.

---

### [MEDIO] La imagen se manda a visión sin redimensionar, teniendo la versión reducida ya en memoria

`src/lib/cuadra/intake/ocr.ts:242,250` · `src/lib/meta/client.ts:183-184` ·
`src/lib/cuadra/intake/cfdi.ts:248-249`

**Escenario:** `downloadMediaAsDataUrl` (`client.ts:183-184`) hace
`Buffer.from(await bin.arrayBuffer())` **sin tope de tamaño** y devuelve el
data-URL del original. `extraerComprobante` elige `principal` (`ocr.ts:242`) y lo
pasa tal cual a `generateStructured({ images: [principal] })` (`ocr.ts:250`).
Veinte líneas antes, `cfdi.ts:249` ya produjo un JPEG de 1 600 px con `sharp`
para el decodificador de códigos — y ese buffer se descarta.

Medido en esta máquina con una foto de 12 MP (4032×3024, q92), que es lo que la
Cloud API acepta (5 MB de tope):

```
original 12 MP : 818 687 bytes → data-URL de 1 091 584 chars = 1.04 MiB al proveedor
a 1 600 px     : 142 903 bytes → data-URL de   190 540 chars = 0.18 MiB
reducción      : 5.7×    ·    costo del resize: 93 ms
mosaicos de 768 px: 24 contra 6
```

**Me lo intenté refutar y el hallazgo se encoge, pero no desaparece:** el cliente
de WhatsApp ya comprime al enviar, así que la foto típica llega cerca de 1 600 px
y la diferencia real es de 2–4×, no de 5.7×. Sigue siendo pago recurrente por el
camino «foto HD» y por cualquier reenvío desde galería, y el buffer reducido ya
existe: 93 ms de CPU contra tokens de imagen en cada una de las 16 llamadas de
visión por liquidación.

**Consecuencia:** el eslabón 11 de la tabla de costos —la visión, la partida
dominante— paga entrada de más en todas las fotos que lleguen por encima de
1 600 px. Lo paga quien firma la factura del modelo.

**Causa raíz probable:** el resize existe para zxing, no para visión, y su
resultado no viaja de vuelta a `extraerComprobante`.

---

### [MEDIO · REINCIDENTE de la ronda 6, y peor] Los punteros de `PASOS_CIERRE` volvieron a desfasarse: de +28 líneas a +112/+125

`src/lib/cuadra/presupuesto.ts:35-49` contra `src/lib/cuadra/processor.ts`

| paso de la tabla | declara | línea real hoy | delta |
|---|---|---|---|
| `registrarCosto` del turno | 591 | **703** | +112 |
| `vincularCostosALiquidacion` | 595 | **707** | +112 |
| `guardiaCifras → cuadrarDesdeDB` | 658 | **777** | +119 |
| `sendText` de la respuesta | 715 | **840** | +125 |
| `getGastos` del aviso de barrera | 734 | **859** | +125 |
| `sendText` del aviso de barrera | 735 | **860** | +125 |
| `createSignedUrl` del PDF | 755 | **880** | +125 |
| `sendDocument` del PDF | 757 | **882** | +125 |
| `registrarCostoWhatsApp` del PDF | 758 | **883** | +125 |
| `saveConversation` | 774 | **899** | +125 |
| `releaseViajeLock` | 814 | **939** | +125 |

La ronda 6 midió +28 en las once. Hoy son +112 a +125: el desface **cuadruplicó**
y ninguna prueba lo nota — `presupuesto.test.ts:111-120` solo comprueba que
`p.donde` matchee `/\.ts/` y que haya 13 elementos. El conteo de 13 sigue siendo
correcto; los punteros no, y la tabla existe precisamente para no tener que
releer `processor.ts` entero.

**Consecuencia:** sin efecto en runtime. El efecto es que la única herramienta
escrita para auditar el cierre manda al lector 125 líneas antes del código que
describe — y es la misma herramienta que faltó cuando el bug original de
`maxDuration` pasó tres rondas sin verse.

**Causa raíz probable:** la tabla se escribe a mano y ninguna prueba compara
`donde` con el archivo.

---

### [MEDIO · REINCIDENTE de las rondas 5 y 6] `analytics.ts` sigue barriendo la tabla completa del tenant, con las MISMAS líneas

`src/lib/cuadra/analytics.ts:39-44,71-77,106-110,130-134`

Confirmado esta ronda: `getKpis`, `getStatsPorOperador`, `detectarAnomalias` y
`getAcreditables` hacen `.eq('tenant_id', …)` sin `.limit()` ni `.range()`. Las
cuatro líneas coinciden **exactamente** con las que citó la ronda 6: no se tocó
nada. `getStatsPorOperador:73-77` son además **tres** barridos completos en un
`Promise.all` (`operador`, `gasto` de diésel, `viaje`) y descarta el `error`
(`const [{ data: ops }, …]`), así que un recorte de `max_rows` y un fallo se ven
igual.

`dashboard/page.tsx:59-64` lanza `getAcreditables`, `getKpis`, `getLiquidaciones`
y `detectarAnomalias` en paralelo con `dynamic = 'force-dynamic'` (`:10`): **6
consultas sin tope por cada carga del panel**, y sin `maxDuration` declarado en
la página. Con el `max_rows` de PostgREST por defecto (1 000 filas), un tenant
pasa a leer una fracción de sus datos en cuanto supera ~125 liquidaciones, sin
error y sin cabecera.

**Consecuencia:** el detector de fraude entre viajes deja de ver la mayoría de
los datos sin decirlo, y el panel del contralor tarda proporcionalmente al
histórico completo de la flota en cada recarga.

**Causa raíz probable:** el arreglo de la ronda 6 (paginado + `count: 'exact'` +
fallo cerrado) se aplicó solo a `getAcumuladoCombustible`, en `repo.ts`; sus tres
hermanas viven en otro archivo.

---

### [BAJO] `permisos_cre.json` no está cubierto por ninguna regla de `outputFileTracingExcludes`

`next.config.ts:87-113` · `src/lib/cuadra/facturacion/permisos_cre.json`

**Escenario:** la lista excluye `./src/**/*.ts` y `./src/**/*.tsx` **por
extensión**, y el comentario del propio archivo (`:39-46`) explica por qué eso es
seguro: «un `.ts` no lo puede ejecutar el runtime». Un `.json` **sí**. No hay
regla `./src/**/*.json`, y el mismo comentario advierte que `cfdi.ts` lee con
`process.cwd()` y por eso «cualquier carpeta generada que aparezca después va a
colarse igual». `permisos_cre.json` son **436 600 bytes**: el único `.json` bajo
`src/`, y más pesado que los 20 archivos de proyecto (2.51 MB, de los cuales 13
son chunks de `.next/`) que la última medición decía que quedaban en el bundle.

**No lo pude confirmar** — el encargo prohíbe `npm run build` y sin
`route.js.nft.json` no hay número. Lo reporto como BAJO por eso, no porque el
peso sea pequeño.

**Consecuencia:** hasta 426 KiB de datos que la función no lee viajando en cada
despliegue, en el artefacto cuyo tamaño gobierna el arranque en frío.

**Causa raíz probable:** la lista se escribió por extensión de código fuente, y
llegó un dato grande con otra extensión.

---

### [BAJO · REINCIDENTE de las rondas 5 y 6, y creciendo] Los comentarios que dicen «60s» pasaron de 8 a 13, y uno afirma un peor caso falso

`route.ts:15,66,69` · `conv.ts:340,351,353` · `ocr.ts:224` · `openrouter.ts:219` ·
`presupuesto.ts:11,115,134` · `processor.ts:216,221`

La ronda 5 contó ocho. La ronda 6 dijo «siguen ahí». Hoy son **trece**, contadas
con `grep -rn "60s\|de 60\b\|los 60\b"` sobre los seis archivos del camino
crítico. El peor es `conv.ts:351-353`: *«El presupuesto de la función es
maxDuration=60 y por debajo de esta barrera todavía corren el lock (12s) y el
agente (40s): con 60s aquí el peor caso son 112s»*. Hoy `maxDuration` es 120
(`route.ts:28`) y ese «112s» describe un sistema que ya no existe — dentro de la
función que **fija el tope de la barrera**.

**Consecuencia:** sin efecto en runtime. El efecto es que quien vaya a tocar la
barrera lee un presupuesto equivocado justo en la línea donde lo va a cambiar.

**Causa raíz probable:** el número vive en prosa en once sitios y en código en
uno.

---

## Lo que revisé y está bien

- **El reloj compartido funciona y está probado.** `crearPresupuesto`
  (`presupuesto.ts:143-161`) y sus consumidores (`processor.ts:603,636,690`)
  hacen lo que dicen: corrí `presupuesto.test.ts` (15/15) y
  `presupuesto_camino.test.ts` (7/7, nuevo esta ronda). `acotar` recorta de
  verdad cuando el turno llega tarde, `senal(0)` devuelve una señal ya abortada
  en vez de agendarla (`:157`), y la guarda `alcanza(COSTO_AGENTE_MS)`
  (`processor.ts:672`) evita lanzar un agente que no cabe. Es el mecanismo que
  impide que este rubro esté en 2.
- **`TOPE_CONSULTA_MS` + `abortSignal` + carrera contra temporizador siguen
  correctos para lo que cubren.** Corrí `repo_tope.test.ts` (4/4, 6.05 s reales
  contra un servidor mudo). Las **17** llamadas a `supabaseAdmin()` de `repo.ts`
  están **todas** envueltas en `acotada` (`repo.ts:44-69`), incluida la RPC de
  escritura `guardar_liquidacion_tx` (`:397`). El `finally { clearTimeout }`
  (`:67`) no fuga temporizadores.
- **La paginación de `getAcumuladoCombustible` falla cerrada.** `repo.ts:643-649`
  lanza si `leidas < esperadas` en vez de devolver un acumulado recortado, y el
  `if (!filas.length || leidas >= esperadas) break` (`:641`) impide el bucle
  infinito ante un `max_rows` de 0. El problema es su TIEMPO, no su corrección.
- **La caché de tools por ronda de verdad acierta ahora.** `llaveDeCache`
  (`openrouter.ts:446-458`) llavea por nombre las tools sin parámetros, así que
  `cuadrar_viaje` —y con ella `getAcumuladoCombustible`— corre **una** vez por
  turno aunque el modelo la pida tres veces con argumentos distintos. Sin esto el
  hallazgo ALTO del acumulado se multiplicaría por tres.
- **El costo se cobra aunque la llamada falle.** `openrouter.ts:265-270,301-303`
  acumula el `usage` de cada intento antes de cualquier salida, y
  `PartialExecutionError` (`:394-415`) lo arrastra hasta `processor.ts:730`. Un
  reintento truncado ya no se reporta como una sola llamada.
- **`calcCost` no devuelve $0 ante un modelo desconocido** (`openrouter.ts:113-119`):
  estima con la tarifa más cara de la tabla y deja un `warn`. La dirección
  correcta para un error de costo.
- **`downloadMediaAsText`/`downloadMediaAsDataUrl` sí llevan techo**:
  `DOWNLOAD_TIMEOUT_MS = 15_000` en las cuatro llamadas (`client.ts:153,159,174,180`),
  y `sat.ts` conserva su `AbortSignal` de 4 s.
- **`identificarComercio` con 37 portales no cuesta nada** (`identificar.ts:30-51`,
  `comercios.ts` evaluado en **16.80 ms** medidos): barrido lineal de 37
  elementos por gasto, microsegundos.
- **El contexto que se le manda al modelo es magro, no gordo.** Medido: system
  prompt del cuadre **835 tokens**, schemas de las 3 tools **227**, retorno de
  `consultar_politica` **178**, retorno de `cuadrar_viaje` con 4 diferencias
  **247**. `MAX_TURNS = 12` (`conv.ts:152`) y el historial se descarta al cambiar
  de viaje (`conv.ts:181-184`). **No hay desperdicio de tokens en contexto** —
  el costo está en el razonamiento invisible y en las 16 fotos, no aquí. Buscaba
  este hallazgo y no existe.
- **La generación de los dos PDF es barata**: **89 ms + 18 ms medidos** con
  `pdf-lib` y fuentes estándar, sin red.

## Lo que NO alcancé a revisar

- **Latencia real Vercel ↔ Supabase.** Toda la tabla del peor caso usa los techos
  escritos en el código y los costos unitarios que el propio `presupuesto.ts:33`
  declara. Ningún número de red viene de producción. Si el p95 real es peor que
  0.3 s, la suma empeora; si es mejor, el resultado aritmético de 120 900 ms
  sigue en pie porque no depende de ninguna latencia.
- **Si `permisos_cre.json` entra de verdad al bundle de la función.** Exige
  `npm run build` y leer `route.js.nft.json`; el encargo lo prohíbe. Por eso el
  hallazgo va en BAJO y con la incertidumbre dicha.
- **Tokens de imagen reales de Gemini 3.6 Flash.** El piso de costo por foto
  ($0.0143) excluye la entrada de la imagen a propósito: medirla exige una
  llamada real de pago, que el encargo prohíbe. El costo real por liquidación es
  **mayor** que los $0.294 que calculé, no menor.
- **`src/lib/queue/`** — el encargo lo señala como zona mía y **no existe** en el
  árbol (`ls` falla). No hay cola: todo corre en `after()`.
- **`maxDuration` de las rutas que no lo declaran.**
  `api/export/liquidaciones/route.ts` y `api/export/pdf/[id]/route.ts` no
  declaran ninguno y quedan con el default de la plataforma. No pude verificar el
  valor efectivo del plan desde aquí; lo dejo señalado sin calificarlo.
