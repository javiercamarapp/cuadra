# Rendimiento y costo — auditoría 11

Anclado a `e4326f9` (HEAD de `claude/auditoria-11`, que es `master` + `docs/`).
`npx tsc --noEmit -p .` → exit 0 sobre este árbol.

**Nota: 3/10** (antes 4). Razón del movimiento: **deuda que cobró factura**. La
suma del peor caso da **exactamente el mismo número que la ronda 10 —233,000 ms
contra `maxDuration = 120`—** con las mismas líneas, solo movidas de sitio. Y
encima, los 40 commits nuevos de `master` (9,700 líneas: `operacion.ts`, el
`/dashboard` de 20 páginas, el rail fijo) se escribieron **sin heredar
`acotada`**: 6 lecturas nuevas sin techo, páginas de hasta 17 consultas por
carga, y un agujero nuevo de 619,000 ms **dentro del único tramo que el
presupuesto cree acotado a 40,000**. No se atacó nada; se amplió la superficie
con el mismo defecto puesto. Por eso baja en vez de quedarse.

Riesgo mayor hoy: `guardar_liquidacion` sube los DOS PDF con `fetch` pelado
(`tools.ts:169`) y **persiste la liquidación DESPUÉS** (`tools.ts:181`). Un
storage lento no degrada el cierre: lo borra. Vercel mata la función, no queda
liquidación, no queda PDF, no queda log y Meta no reintenta — y es el paso 3 del
guion del demo.

---

## La suma del peor caso

**Los techos, con su fuente.** No hay un solo número estimado aquí; todos salen
de una constante escrita en el repo.

| Cosa | Valor | `archivo:línea` |
|---|---:|---|
| Presupuesto de la invocación | 120,000 ms | `presupuesto.ts:188` ≡ `api/webhook/whatsapp/route.ts:28` |
| Reserva para cerrar | 12,000 ms | `presupuesto.ts:72` |
| Costo del cierre **declarado** | 8,900 ms | `presupuesto.ts:37-54` |
| Techo de una consulta `acotada` | 8,000 + 1,500 = **9,500 ms** | `presupuesto.ts:101`, `:104`, la carrera en `:163` |
| Techo de un envío a Meta | 10,000 ms | `meta/client.ts:17`, usado en `:94` y `:125` |
| Techo de un `fetch` **sin** `acotada` | **300,000 ms** | documentado por el propio repo en `presupuesto.ts:79-82` |
| Único `maxDuration` de todo `src/` | 120 | `grep -rn maxDuration src/` → 1 sola ruta |

### Camino del "listo", eslabón por eslabón

| # | Eslabón | `archivo:línea` de HOY | Techo real | ¿lo ve el `reloj`? |
|---|---|---|---:|---|
| 1 | `resolveOperador` | `processor.ts:251` | 9,500 | no |
| 2 | `getOpenViaje` | `processor.ts:270` | 9,500 | no |
| 3 | `getHuerfanos` | `processor.ts:1002` | 9,500 | no |
| 4 | barrera de intake | `processor.ts:1071` + `conv.ts:411-412` | 20,000 + 9,500¹ = **29,500** | `acotar(20_000)` |
| 5 | mutex del viaje | `processor.ts:1104` + `conv.ts:287,292,316` | **300,000**² | `acotar(12_000)`, **ignorado** |
| 6 | re-chequeo `getOpenViaje` | `processor.ts:1117` | 9,500 | no |
| 7 | `getTenantContext` + `loadConversation` | `processor.ts:1122-1123` | 19,000 | no |
| 8 | agente (completions) | `processor.ts:1158` → `run.ts:33` | 40,000 | **sí**, `AbortSignal` real |
| 9 | `guardar_liquidacion`, dentro de 8 | `tools.ts:151-181` | **619,000**³ | **no** |
| 10 | cierre, 13 pasos | `processor.ts:1171` → `:1482` | **125,000** | **no, nunca** |

¹ el `while` comprueba el vencimiento **después** del sondeo (`conv.ts:411`), y
cada sondeo es un `intakeDelta` `acotada` de hasta 9,500 ms.
² `conv.ts:287` construye el cliente fuera del bucle y `:292` lo usa crudo: el
RPC no pasa por `acotada`.
³ `computeCuadre` 9,500 + **2 × `storage.upload` sin `acotada` = 600,000**
(`tools.ts:169`, llamado en `:176` y `:177`) + `saveLiquidacion` 9,500.

### Desglose del cierre (los 13 pasos, con el techo de cada uno)

| Paso | Línea de HOY | Techo |
|---|---|---:|
| `registrarCosto` del turno | `processor.ts:1171` → `costos.ts:131` | 9,500 |
| `vincularCostosALiquidacion` | `processor.ts:1175` → `costos.ts:171` | 9,500 |
| `guardiaCifras` → `cuadrarDesdeDB` | `processor.ts:1245` → `desde_db.ts:29-33` | 9,500 |
| `sendText` de la respuesta | `processor.ts:1329` → `:362` | 10,000 |
| `registrarCostoWhatsApp` | `processor.ts:364` | 9,500 |
| `getGastos` del aviso de barrera | `processor.ts:1362` | 9,500 |
| `sendText` del aviso | `processor.ts:1366` | 10,000 |
| `registrarCostoWhatsApp` | `processor.ts:364` | 9,500 |
| `createSignedUrl` | `processor.ts:1411` (`acotada`) | 9,500 |
| `sendDocument` del PDF | `processor.ts:1413` | 10,000 |
| `registrarCostoWhatsApp` | `processor.ts:1414` | 9,500 |
| `saveConversation` | `processor.ts:1437` | 9,500 |
| `releaseViajeLock` | `processor.ts:1482` → `conv.ts:418` | 9,500 |

10 consultas × 9,500 + 3 envíos × 10,000 = **125,000 ms**.
Contra `MARGEN_CIERRE_MS = 12,000` → **10.4×**. Contra el `COSTO_CIERRE_MS =
8,900` que la tabla declara → **14.0×**.

### Los tres totales

**(A) Todo dentro de los techos escritos, dando por bueno el mutex y las
subidas.** `crearPresupuesto` garantiza que hasta `processor.ts:1158` el
transcurrido sea ≤ `120,000 − 12,000 = 108,000` (`presupuesto.ts:215,219`).
Encima corre el cierre, sin consultar el reloj ni una vez:

> **108,000 + 125,000 = 233,000 ms contra 120,000 ms → 1.94×**

Es el número de la ronda 10, reproducido hoy con las líneas de hoy.

**(B) Mutex degradado.** Prefijo 58,000 (eslabones 1-4) + un solo giro del RPC
sin techo = 358,000 ms. Vercel mata la función a los 120,000: **el `fetch`
todavía tiene 238,000 ms por delante cuando ya no hay nadie escuchando**, y el
agente ni siquiera arrancó.

**(C) Storage degradado (nuevo).** Prefijo nominal 4,500 (previo 0.9 + barrera
3.5 + mutex 0.1, los números que `presupuesto_camino.test.ts:87` llama "lo
medido") + 20,000 dentro del agente hasta llamar la tool + 619,000 de la tool =
**643,500 ms**. El `AbortController` de `run.ts:33` dispara a los 44,500 y
**no detiene nada**: `ctx.signal` se construye en `run.ts:34` y `grep -n signal
src/lib/cuadra/tools.ts` → **0 resultados**. Vercel mata la función 523,500 ms
antes de que la subida se rinda, y `saveLiquidacion` (`tools.ts:181`) está
*después* de las dos subidas.

**El promedio, para ser justo.** Camino nominal: 0.9 + 3.5 + 0.1 + 20 s de
agente + 8.9 s de cierre = **33.4 s contra 120,000** — cabe con 3.6× de holgura.
El problema no es el promedio; es que **lo único que se verifica es el
promedio**: `presupuesto.test.ts:107` compara `COSTO_CIERRE_MS` (8,900, la suma
de costos *nominales*) contra `MARGEN_CIERRE_MS` (12,000), y
`presupuesto_camino.test.ts:26-34` simula el camino **solo hasta el agente** —
el cierre no aparece en ninguna simulación.

### El costo, contra el presupuesto escrito

Declarado: **`Costo ≈ $0.03–0.05 / liquidación`** (`models.ts:17`).
Declarado por visión: **$0.015** (`processor.ts:503`, `:794`).

| Concepto | Aritmética | Fuente |
|---|---|---|
| Visiones por liquidación | cada foto paga la suya | `processor.ts:506`; el comentario `:503` lo dice literal tras revertir `foto_pendiente` |
| Lote típico | **8 fotos** | `api/webhook/whatsapp/route.ts:68` ("un lote de 8") |
| Ráfaga | **12 fotos** | `route.ts:10` |
| OCR de un lote típico | 8 × $0.015 = **$0.12** | → **2.4× el techo de $0.05, solo el OCR** |
| OCR de una ráfaga | 12 × $0.015 = **$0.18** | → 3.6× |
| Protocolo de dos fotos | 8 comprobantes = 16 visiones = **$0.24** | → 4.8× |
| Techo duro por visión | 4,000 tok × $7.5/1M = **$0.030 de salida sola** | `openrouter.ts:50` (`DEFAULT_MAX_TOKENS`), `:85` (Gemini 3.6 Flash `[1.5, 7.5]`) |
| Agente de cuadre, peor caso | 6 rondas × 4,000 tok × $10/1M = **$0.24** | `openrouter.ts:476` (`maxRounds = 6`), `:50`, `:87` (Sonnet 5 `[2,10]`) |
| Prefijo reenviado sin caché | ~1,200 tok × 6 × $2/1M = **$0.0144** | `openrouter.ts:487` + `:564` + `:598`; prompt de 3,343 chars (`prompts.ts`) |

**Peor caso sumado: $0.24 + $0.25 ≈ $0.49 por liquidación, contra $0.03–0.05 →
10–16×.** Caso corriente con los propios números del repo: $0.12 (OCR) + ~$0.056
(4 completions) ≈ **$0.18 → 3.6–6×**.

---

## Hallazgos

### [CRÍTICO] `guardar_liquidacion` sube dos PDF con `fetch` pelado dentro del tramo que el presupuesto cree acotado a 40,000 ms — y persiste la liquidación DESPUÉS
`src/lib/cuadra/tools.ts:169` (`supabaseAdmin().storage…upload(…)`, sin
`acotada`), llamado en `:176` y `:177`; `:181` (`saveLiquidacion`, **después** de
las dos subidas). El techo que el presupuesto cree tener está en
`src/lib/cuadra/processor.ts:1158` (`timeoutMs: reloj.acotar(40_000)`), que se
convierte en un `AbortController` en `src/lib/agents/run.ts:33` y en
`ctx.signal` en `:34`.

Escenario, con valores: el operador escribe "listo" en el camino nominal (previo
0.9 s + barrera 3.5 s + mutex 0.1 s = 4.5 s, los números que
`presupuesto_camino.test.ts:87` declara medidos). El agente arranca; a los 20 s
llama `guardar_liquidacion`. Storage degradado —no caído—: las dos subidas
heredan el default de undici, **300,000 ms cada una** (el número que
`presupuesto.ts:79-82` documenta como medido en esta máquina). El
`setTimeout(() => controller.abort(), 40_000)` de `run.ts:33` dispara a los
44,500 ms y **no toca la subida en vuelo**: `grep -n "signal"
src/lib/cuadra/tools.ts` devuelve **cero resultados** — `ctx.signal` se
construye y ningún handler lo lee. La tool terminaría a los 4,500 + 20,000 +
9,500 + 600,000 + 9,500 = **643,500 ms**. Vercel corta a los 120,000:
**523,500 ms antes**.

Peor todavía: el orden. `saveLiquidacion` está en `:181`, *después* de las
subidas. Cuando la función muere, **no hay liquidación en la base, no hay PDF,
no hay `logger.error`** (el proceso muere antes de cualquier `catch`) y Meta —que
recibió su 200 en `route.ts`— no reintenta.

Consecuencia: el paso 3 del guion del demo (el "listo" que produce el PDF) se
queda sin salida y sin rastro. El contralor ve un chat donde su chofer escribió
"listo" y nunca pasó nada; en el panel tampoco hay liquidación que enseñar. Con
un Supabase sano no ocurre — pero es el único eslabón del camino del dinero cuyo
techo es 5× el `maxDuration` de la ruta.

Causa raíz probable: `acotada` se aplicó archivo por archivo (`repo.ts` 27
`supabaseAdmin()` / 26 `acotada`; `costos.ts`, `conv.ts` cubiertos) y `tools.ts`
—que solo tiene una llamada, y es a **storage**, no a PostgREST— quedó fuera del
conteo con el que se verificó la cobertura.

### [CRÍTICO] El cierre corre sin reloj: 125,000 ms de techo contra una reserva de 12,000, y el total del camino da 233,000 contra `maxDuration = 120`
`src/lib/cuadra/processor.ts:1158` es la **última** línea del archivo que
menciona `reloj` (`grep -n reloj processor.ts | tail -3` → 1140, 1141, 1158);
todo lo que va de `:1171` a `:1482` corre a ciegas.
`src/lib/cuadra/presupuesto.ts:37-51` (`PASOS_CIERRE`), `:54`
(`COSTO_CIERRE_MS = 8,900`), `:72` (`MARGEN_CIERRE_MS = 12,000`).

Escenario, con valores: el agente agota su tope de 40,000 ms —caso que
`presupuesto_camino.test.ts:75-81` declara explícitamente soportado ("con SOLO
las esperas al máximo, el agente todavía cabe")—. En ese punto el reloj garantiza
≤ 108,000 ms transcurridos (`presupuesto.ts:215`: `restante = 120,000 − 12,000 −
gastado`). El cierre arranca con 12,000 ms nominalmente reservados y un techo
real de **125,000** (tabla de arriba: 10 consultas × 9,500 + 3 envíos × 10,000).
Basta que **2 de sus 13 pasos** agoten su propio techo (2 × 9,500 = 19,000 >
12,000) para pasarse. **108,000 + 125,000 = 233,000 contra 120,000 → 1.94×.**

Y el orden importa: `sendDocument` del PDF es el paso **10 de 13**. Para cuando
se llega ahí, `guardar_liquidacion` ya corrió **dentro** del agente, así que el
viaje está `liquidado`, el `llm_costo` ya se cobró y el trigger de la 0037 impide
corregirlo.

Consecuencia: liquidación cerrada en la base, cero mensajes al operador, cero
líneas de log, sin reintento de Meta. Para el contralor es una liquidación que
existe en el panel y que su chofer jura no haber recibido nunca.

Causa raíz probable: `PASOS_CIERRE` se pobló con el costo **nominal** de cada
paso (0.3 s una consulta, 1.5 s un `sendText`) en vez del techo que el mismo
archivo impone (9.5 s / 10 s), y `presupuesto.test.ts:107` compara esa suma
nominal contra el margen. El peor caso nunca entra en ninguna prueba.

**REINCIDENTE** (auditoría 10, ALTO-3). Misma aritmética, mismas constantes; solo
se movieron las líneas de `processor.ts`.

### [ALTO] El mutex del "listo" hace su RPC sin techo dentro de un `for (;;)`: 300,000 ms posibles contra un `maxWaitMs` de 12,000
`src/lib/cuadra/conv.ts:287` (`const admin = supabaseAdmin()`, **fuera** del
bucle), `:292` (`await admin.rpc('try_lock_viaje', …)`, sin `acotada`), `:316`
(la comprobación de vencimiento, **después** del `await`); invocado desde
`src/lib/cuadra/processor.ts:1104` con `reloj.acotar(12_000)`.

Escenario, con valores: el operador escribe "listo". El prefijo consume 58,000 ms
(eslabones 1-4 de la tabla). `acquireViajeLock` entra al bucle; con Supabase
degradado —acepta el socket y calla— el RPC bloquea **300,000 ms**. El
`Date.now() - start >= maxWaitMs` de `:316` se evalúa después del `await`, así
que los 12,000 ms nunca llegan a leerse. **58,000 + 300,000 = 358,000 contra
120,000**: Vercel mata la función **238,000 ms antes** de que el `fetch` se
rinda, y antes de que el agente arranque.

Consecuencia: el operador escribió "listo" y no recibe nada — ni resumen, ni PDF,
ni error. No hay `logger.error` porque el proceso muere antes del `catch`, y Meta
ya recibió su 200. Es el "peor final posible" que `presupuesto.ts:84-88` describe,
en el único mensaje que importa del flujo.

Causa raíz probable: el cliente se hoistea fuera del bucle, así que un solo sitio
contado (`conv.ts` da 10 `supabaseAdmin()` vs 10 `acotada`, verificado hoy)
alimenta un número ilimitado de RPC sin techo. El método de conteo con el que la
ronda 9 declaró esto "cerrado de verdad" sigue pasando sobre el agujero.

**REINCIDENTE** (auditoría 10, ALTO-1; auditoría 8). Líneas idénticas.

### [ALTO] El panel entero corre sin un solo techo de consulta y sin `maxDuration`: `/dashboard/despacho` son 17 consultas por carga, la peor rama sin cota
`src/lib/cuadra/analytics.ts`: **11 `supabaseAdmin()` / 0 `acotada`**.
`src/lib/cuadra/pg.ts:40-51` (`traerTodo`) no importa `acotada` — es el borde por
el que pasan **todas** las lecturas del panel.
`src/lib/cuadra/operacion.ts`: 14 `supabaseAdmin()` / 8 `acotada`, y los 8 son
las **escrituras** (`:376`, `:391`, `:471`, `:490`, `:497`, `:512`, `:536`,
`:563`); las **6 lecturas** (`getCargaOperadores:48-69`,
`getViajesSinAsignar:121`, `getUnidades:162-174`, `getIncidencias:247-262`,
`getPods:316-332`, `getTableroOperacion:418-435`) van por `traerTodo`, sin techo.
`src/lib/auth/tenant-efectivo.ts:68`: 1 / 0.
`grep -rn maxDuration src/` → **una sola ruta en todo el repo**, el webhook.

Conteo de consultas por carga, verificado leyendo cada página:

| Página | Servidor | Tablas releídas en la misma carga |
|---|---:|---|
| `/dashboard/despacho` (`page.tsx:51-56`) | **12** | `viaje` ×3, `pod` ×2, `incidencia` ×2, `unidad` ×2, `operador` ×2, `mantenimiento` ×1 |
| `/dashboard` (`page.tsx:81-90`) | 5 | `liquidacion` ×3, `gasto` ×1, `viaje` ×1 |
| `/dashboard/incidencias` (`page.tsx:43-46`) | 6 | `viaje` ×2, `unidad` ×2 |
| `/dashboard/valor-ahorro` (`page.tsx:43-46`) | 6 | `gasto` ×2 |
| `/dashboard/combustible-casetas` (`page.tsx:40-45`) | 4 | `gasto` ×3 |

**Más el rail, en las 20**: `chrome.tsx:90` monta `RailAsistente` en el marco, y
`rail.tsx:58` pega a `/api/dashboard/asistente`, que rehace `getSessionTenant`
(2 viajes de red) y corre `getKpis` + `getAcreditables` + `detectarAnomalias`
(`api/dashboard/asistente/route.ts:46-50`) = **5 consultas más por página**.
`/dashboard/despacho` = **17 consultas por carga**; `/dashboard` escanea
`liquidacion` **5 veces** y `gasto` **2 veces** por vista.

Escenario, con valores: Supabase degradado durante el demo. `proxy.ts:59`
(`getUser()`, sin techo) 300,000 + `session.ts:31,33` (getUser + `app_user`, en
serie, sin techo, con reintento en `:53`) 600,000 + la peor de las 12 lecturas
300,000 = **1,200,000 ms** para pintar una pantalla que **no declara
`maxDuration`**, contra el máximo absoluto que el propio repo cita para el plan
Pro (300,000 ms, `api/webhook/whatsapp/route.ts:21-23`) → **4×**.
Todas las páginas son `dynamic = 'force-dynamic'` (p. ej. `despacho/page.tsx:19`),
así que no hay caché que amortigüe nada.

Consecuencia: `safe()` (`despacho/page.tsx:22`, `dashboard/page.tsx:25`) atrapa
**excepciones, no esperas**. Con la base lenta la página no pinta el fallback
para el que se diseñó: se queda en blanco hasta que la plataforma corta. En la
sala, el contralor ve una pantalla vacía y nadie puede decir por qué.

Causa raíz probable: `acotada` se impuso en el camino del webhook y `pg.ts`
—escrito precisamente para que `operacion.ts` no reimplementara los bordes de
PostgREST (`pg.ts:1-8`)— se llevó `exigir` y `traerTodo` pero **no** el techo, así
que las 9,700 líneas nuevas nacieron con el defecto heredado.

**REINCIDENTE agravado** (auditoría 10, MEDIO: entonces eran 5 `supabaseAdmin()`
/ 0 `acotada` y una página; hoy son 11 + 6 lecturas nuevas y 20 páginas).

### [ALTO] `/admin`: cuatro escaneos de tabla completa por página, sin `.limit()`, sin `.order()`, sin techo y con recorte silencioso a 1,000 filas
`src/lib/admin/negocio.ts:62-65` (las cuatro consultas), `:145`
(`facturasPorDia` sobre `gastoRes.data`), `:163` (`viajesProcesados =
(viajesRes.data ?? []).length`), `:171` (`facturasTotal = (gastoRes.data ??
[]).length`), `:189` (`getCostoPorFaseModelo`, quinto escaneo de `llm_costo`);
`src/app/admin/layout.tsx:42` — vive en el **layout**, así que corre en las ~30
páginas de `/admin`. El archivo tiene **4 `supabaseAdmin()` y 0 `acotada`**, y
`grep` confirma que ninguna de las cuatro lleva `.limit()`, `.range()` ni
`.order()`.

Escenario, con valores: una flota de 30 unidades × 4 viajes/mes × 10
comprobantes = **1,200 filas de `gasto` en el primer mes**. PostgREST recorta a
`max_rows` (1,000 por default) **en silencio** — el mismo borde que `pg.ts:28-38`
documenta y que `traerTodo` existe para tapar. A partir de la fila 1,001,
`facturasTotal` (`:171`) se **congela en 1,000 y no se mueve nunca más**. Y sin
`.order()`, las 1,000 filas que vuelven son las que Postgres decida —típicamente
las más viejas—, así que `facturasPorDia` (últimos 7 días, `:145`) pinta **siete
ceros** en un mes con actividad diaria. Lo mismo le pasa a `viajesProcesados`,
`costoIaUsd`, `tokensIn/Out`, `porFase`, `porModelo` y a las dos tendencias.

Consecuencia: la consola desde la que Javier fija el precio del producto —porque
de ahí sale el costo de IA por viaje— enseña un negocio detenido en el mes 1, con
la misma cara que si de verdad no hubiera pasado nada. Y sin `acotada`, un
Supabase degradado no degrada la consola: la cuelga (tampoco hay `maxDuration`).

Causa raíz probable: el comentario de cabecera del archivo reconoce la falta de
paginación pero razona sobre el **volumen** ("hoy son 131 filas"), no sobre el
**recorte silencioso**, que es el modo de fallo.

**REINCIDENTE** (auditoría 10, ALTO-4). Presente, mismas líneas.

### [ALTO] El costo por liquidación excede su propio presupuesto declarado 2.4× solo con el OCR, y nadie lo ha contrastado
`src/lib/llm/models.ts:17` (`Costo ≈ $0.03–0.05 / liquidación`),
`src/lib/cuadra/processor.ts:503` y `:794` ($0.015 por visión),
`src/lib/cuadra/processor.ts:506` (`extraerComprobante` por foto),
`src/app/api/webhook/whatsapp/route.ts:68` ("un lote de 8"), `:10` ("una ráfaga
de 12 fotos"), `src/lib/llm/openrouter.ts:50` (`DEFAULT_MAX_TOKENS = 4000`),
`:85` (Gemini 3.6 Flash `[1.5, 7.5]`), `:87` (Sonnet 5 `[2, 10]`), `:476`
(`maxRounds = 6`), `src/lib/llm/models.ts:63` (`cuadre: reasoning 'high'`).

Escenario, con valores. El comentario de `processor.ts:503` lo dice literal tras
revertir `foto_pendiente`: *"Cada foto vuelve a pagar su propia visión"*.

- Lote típico del propio repo, 8 fotos: 8 × $0.015 = **$0.12** → **2.4× el techo
  declarado de $0.05**, y eso es **antes** de que el agente de cuadre gaste un
  solo token.
- Ráfaga de 12: **$0.18** → 3.6×.
- Con el protocolo de dos fotos (ticket + acercamiento del QR), 8 comprobantes
  son 16 visiones: **$0.24** → 4.8×.
- Techo por visión, no promedio: `DEFAULT_MAX_TOKENS = 4000` a $7.5/1M de salida
  = **$0.030 de salida sola**, ya el doble del $0.015 escrito a mano.
- Agente de cuadre, peor caso: 6 rondas × 4,000 tok × $10/1M = **$0.24**.

**Total peor caso ≈ $0.49 por liquidación contra $0.03–0.05 → 10–16×.**

Consecuencia: el precio del producto se va a fijar contra un número que su propia
aritmética desmiente. A 500 liquidaciones/mes la diferencia entre $0.05 y $0.18 es
$65/mes de margen que no existe — pequeño en absoluto, decisivo cuando es el
denominador del "por cada $1 que pagas ahorras $X" que la pantalla de Valor &
Ahorro se niega a inventar (`analytics.ts:236-238`) precisamente por no tenerlo.

Causa raíz probable: el $0.03–0.05 se dimensionó por **liquidación** y el OCR se
cobra por **foto**; el multiplicador (cuántas fotos trae una liquidación) nunca
entró en la cuenta. El dato para cerrarlo **ya se está guardando**
(`llm_costo.tokens_in/costo_usd`, `processor.ts:315`, `:508`, `:1171`) y
`negocio.ts:163,171` ya tiene numerador y denominador: nadie ha hecho la
división.

### [ALTO] "Avance de cierre" divide entre 100 porque la consulta corta en 100 y el filtro de periodo corre en memoria
`src/lib/cuadra/analytics.ts:328` (`getViajes(tenantId, limite = 100)`), `:333`
(`.order('created_at', { ascending: false })`), `:334` (`.limit(limite)`);
`src/app/dashboard/page.tsx:89` (`getViajes(tenantId)`, sin argumento → 100),
`:138` (`<AvanceCierre viajes={viajes ?? []} …>`);
`src/app/dashboard/avance-cierre.tsx:47-54` (el filtro por periodo, en el
cliente), `:104` (el rótulo).

Escenario, con valores: flota de 30 unidades × 4 viajes/mes = **120 viajes en 30
días**. La pestaña "Mes" (default, `:37`) filtra en memoria las **100** filas que
llegaron, así que el pie dice *"X de 100 viajes iniciados ya están liquidados"*
cuando fueron 120. La pestaña "Todo" (`:26`, `dias: null`) es peor: promete el
histórico completo y ve como máximo 100 filas. Y el orden agrava el sesgo: se
ordena por `created_at` y se filtra por `fecha_inicio`, que no son la misma
columna.

Consecuencia: el porcentaje de avance —la única cifra operativa del encabezado,
la que el encargado y el dueño miran primero— está calculado sobre un denominador
truncado, y **nada en pantalla lo dice**. Es exactamente el "cero que parece
medición" que la regla del producto prohíbe, entrando por la puerta del
rendimiento: el límite se puso para que la página cargara rápido y se convirtió
en una cifra falsa.

Causa raíz probable: el `limite = 100` se dimensionó para la **tabla** de viajes
(`/dashboard/viajes:41`, donde 100 filas es una decisión de UI razonable) y se
reutilizó para un **agregado** cuyo denominador tiene que ser completo.

### [ALTO] La barrera de intake espera 20,000 ms por un OCR cuyo techo es 25,000 ms
`src/lib/cuadra/processor.ts:1071` (`esperarIntake(viajeId,
reloj.acotar(20_000))`) contra `:314` y `:506`
(`extraerComprobante(dataUrl, reloj.senal(25_000))`); el 20 lo fija
`src/lib/cuadra/conv.ts:385` y lo justifica el comentario de `:380`.

Escenario, con valores: el operador manda la foto de un ticket pesado a las
21:04:00; esa invocación arranca la visión con una señal de **25,000 ms**. A las
21:04:01 escribe "listo": otra invocación entra a `esperarIntake` con un tope de
**20,000 ms**. Si el OCR tarda **22 s** —legítimo, dentro de su propio techo—, la
barrera vence a los 20 s, `intakeOk` sale `false` (`:1072`), el agente cuadra
**sin ese comprobante**, guarda la liquidación y manda el PDF. Dos segundos
después la primera invocación escribe el gasto en la base. Ventana de fallo:
**5,000 ms en los que la barrera siempre se rinde de más**.

Consecuencia: el PDF que recibió el operador y el panel que abre el contralor
difieren por el monto de ese ticket, y el viaje ya está `liquidado`. Con una carga
de diésel de $8,000 de por medio, el operador paga de su bolsa un gasto que sí
hizo. Hay aviso al operador (`:1364`), pero la discrepancia PDF↔panel no se le
avisa a nadie.

Causa raíz probable: el comentario que fija el 20 (`conv.ts:380`) todavía dice
*"El presupuesto de la función es maxDuration=60… con 60 s aquí el peor caso son
112 s"*. `PRESUPUESTO_WEBHOOK_MS` es **120,000** desde el 28-jul
(`presupuesto.ts:188`); el 20 nunca se re-dimensionó por encima del techo del OCR
que espera, y `reloj.acotar` solo puede bajarlo.

**REINCIDENTE** (auditoría 10, ALTO-2). Presente, mismas constantes.

### [MEDIO] El rail duplica las tres consultas más caras del panel en las 20 páginas, incluidas las 6 que no muestran dinero
`src/app/dashboard/chrome.tsx:90` (`<RailAsistente />`, sin condición de rol ni
de página), `src/app/dashboard/rail.tsx:58` (el `fetch`),
`src/app/api/dashboard/asistente/route.ts:26` (`getSessionTenant`, 2 viajes de
red) y `:46-50` (`getKpis` + `getAcreditables` + `detectarAnomalias`).

Escenario, con valores: en `/dashboard`, `page.tsx:82-84` ya corrió esas mismas
tres funciones del lado del servidor. El rail es un componente de cliente y su
petición es **otra petición HTTP** — no hay memoización de `fetch` de Next que la
colapse. Resultado por vista de Inicio: `liquidacion` escaneada **5 veces**
(`getAcreditables` ×2, `getKpis` ×2, `getLiquidacionesPorDia` ×1) y `gasto`
**2 veces** (`detectarAnomalias` ×2, un escaneo completo cada uno,
`analytics.ts:129-137`). En `/dashboard/despacho`, `/dashboard/pod`,
`/dashboard/unidades` e `/dashboard/incidencias` —donde no se pinta un solo peso—
el rail sigue pagando **2 escaneos de `liquidacion` + 1 de `gasto` + 2 viajes de
auth** por cada navegación, para un recuadro de una frase.

Consecuencia: cada clic del contralor en el panel cuesta el doble de lo que la
pantalla necesita, y el multiplicador crece con la antigüedad de la flota (los
escaneos son de tabla completa, sin filtro de fecha en `detectarAnomalias`).

Causa raíz probable: el rail se movió de Inicio al marco (`chrome.tsx`) para que
estuviera fijo, y se movió con su carga de datos entera en vez de con lo que cada
página ya tiene resuelto.

### [MEDIO] `getDocumentos(tenantId, 1000)` pide exactamente el `max_rows` de PostgREST, y sobre ese recorte se calcula un porcentaje
`src/lib/cuadra/analytics.ts:358` (`getDocumentos(tenantId, limite = 100)`),
`:364` (`.limit(limite)`); `src/app/dashboard/combustible-casetas/page.tsx:44`
(`getDocumentos(tenantId, 1000)`), `:52-54` (`sinCfdi` y `pctSinCfdi`);
`src/app/dashboard/facturacion/page.tsx:34` (idem).

Escenario, con valores: la misma flota de 1,200 filas de `gasto` en el primer
mes. `.limit(1000)` cae justo en el `max_rows` que `pg.ts:28-38` documenta, así
que PostgREST devuelve 1,000 sin avisar y la página no puede distinguir "eso es
todo" de "hay más". `pctSinCfdi` (`:54`) se presenta como el porcentaje de
comprobantes de combustible y casetas **de la flota** y es el porcentaje de una
muestra de 1,000. La función que resuelve exactamente esto —`traerTodo`,
`pg.ts:40`— está importada en el mismo archivo y no se usa en este camino.

Consecuencia: el contralor lee "18% sin CFDI" como un hecho de su flota; a partir
de la fila 1,001 es un hecho de un subconjunto que la pantalla no nombra. No es
una cifra inventada, es una cifra cuyo alcance no se declara — que en un producto
cuya regla es "un rótulo tiene que ser verdad" es la misma clase de problema.

### [MEDIO] La imagen que cuesta dinero va a resolución nativa; la que no cuesta nada va reducida a 1,600 px
`src/lib/cuadra/intake/ocr.ts:249` (`principal`), `:257` (`images: [principal]`);
`src/lib/meta/client.ts:192-193` (base64 del buffer crudo, sin tocar);
`src/lib/cuadra/intake/cfdi.ts:248-249`
(`sharp(image).rotate().resize({ width: ancho })` para `[1600, 1000]`).

El mismo buffer sigue dos caminos. El **gratis** (zxing, CPU local) se reduce a
1,600 px porque el repo ya midió que a resolución nativa "cuesta segundos y no
encuentra nada que no encuentre la de 1,600 px", y el comentario nombra el caso
real: **"una foto de 24 Mpx"** (`cfdi.ts:244-245`). El **caro** (la llamada de
visión) recibe el original, en base64 —**33% más de cuerpo**—, dentro de un
`reloj.senal(25_000)`.

Números: a `PRICES['google/gemini-3.6-flash'] = [1.5, 7.5]` (`openrouter.ts:85`),
los 1,000–1,800 tokens de razonamiento que el propio repo midió
(`openrouter.ts:41-45`) más ~100 de JSON ya cuestan **$0.0083–$0.0143 solo de
salida**. Contra el $0.015 escrito a mano, a la entrada le quedan **$0.0007–
$0.0067**, o sea **500–4,500 tokens de imagen**. Una foto sin redimensionar no
cabe en ese rango con ningún esquema de teselado, y el error se multiplica por 8
(el lote típico) contra un presupuesto de $0.03–0.05 por liquidación.

Consecuencia: el componente mayor del costo unitario del producto está sin medir
y va a la baja. `sharp` ya es dependencia de la función y ya toca este buffer
(`cfdi.ts:11`).

**REINCIDENTE** (auditoría 10, MEDIO). Mismas líneas.

### [MEDIO] Hasta 50 `INSERT` en serie sin consultar el presupuesto ni una vez
`src/lib/cuadra/processor.ts:1015` (`for (const h of ofrecidos)`), `:1017`
(`await addGasto(…)`); `src/lib/cuadra/repo.ts:281` (`.limit(50)` de
`getHuerfanos`), `src/lib/cuadra/repo.ts:118-119` (`addGasto`, con `acotada`).

Escenario, con valores: un operador acumuló **50 huérfanos** —el tope exacto de
`getHuerfanos`— mandando fotos sin viaje abierto. La oficina le abre el viaje, él
contesta "sí". El bucle emite 50 `INSERT` secuenciales. Al costo unitario que el
repo asume (0.3 s): **15,000 ms**, más `resolverHuerfanos` y `getGastos` ≈ 17 s.
Con Supabase a 2 s por insert: **100,000 ms** + prefijo → Vercel corta a los
120,000 con los comprobantes a medio adjuntar y `resolverHuerfanos` (`:1026`) sin
ejecutar. **Techo teórico del bucle: 50 × 9,500 = 475,000 ms, 3.96× la invocación
completa.** El bucle no consulta `reloj` ni una vez, mientras
`presupuesto.ts:92-95` justifica el tope de 8 s diciendo que "con 8 s la
invocación sobrevive a TRES colgadas": aquí se pueden emitir cincuenta.

Consecuencia: el operador dice "sí", no recibe respuesta, y no sabe si sus 50
comprobantes se adjuntaron. (El índice único `uq_gasto_img_hash` evita el
duplicado, así que no es dinero mal: es un turno perdido sin aviso.)

**REINCIDENTE** (auditoría 10, MEDIO). Mismas líneas.

### [MEDIO] `PASOS_CIERRE` —la tabla que existe para hacer verificable el cierre— apunta a trece líneas que ya no existen
`src/lib/cuadra/presupuesto.ts:38-50`: los trece campos `donde` dicen
`processor.ts:591`, `:595`, `:658`, `:715`, `:734`, `:735`, `:755`, `:757`,
`:758`, `:774`, `:814`. Los pasos reales están en `processor.ts:1171`, `:1175`,
`:1245`, `:1329`, `:364`, `:1362`, `:1366`, `:1411`, `:1413`, `:1414`, `:1437`,
`:1482`. Verificado leyendo cada una: `processor.ts:591` es un comentario sobre
acercamientos, `:715` es un `return`, `:814` un comentario sobre dieciocho fotos.
**Ninguna de las once líneas citadas contiene el paso que dice contener.**

Escenario: el mecanismo se construyó explícitamente contra este fallo — el
comentario de `:26-27` dice *"Nadie se enteró porque una lista en prosa no se
puede verificar"*, y `:28-32` promete que "meter un paso más al cierre sin
ampliar el margen deja de ser un descuido silencioso y pasa a ser una prueba en
rojo". La prueba que lo sostiene (`presupuesto.test.ts:111-118`) comprueba que
`p.donde` **coincida con `/\.ts/`** — nada más. Así que la tabla derivó de su
código sin que ninguna prueba se pusiera en rojo, exactamente como el comentario
que antecedía a la tabla.

Consecuencia: el único artefacto que permite auditar el costo del cierre sin
releer `processor.ts` entero (1,484 líneas) ya no se puede usar para eso. Es el
guardarraíl de los dos CRÍTICOs de arriba, y está roto.

### [MEDIO] `proxy.ts` cobra ~900 ms de red serializada antes del primer dato, en cada navegación, y sin techo
`src/proxy.ts:59` (`await supabase.auth.getUser()`), `:81` (el matcher, que cubre
todo salvo `/api` y estáticos); `src/lib/auth/session.ts:31` y `:33` (getUser +
`app_user`, **en serie**), `:53` (el reintento con 250 ms).

`getUser()` siempre es un viaje de red al servidor de Auth: a diferencia de
`getSession()` no decodifica el JWT en local. Al costo unitario del repo (0.3 s,
`presupuesto.ts:35`): proxy 300 ms + `getSessionTenant` 600 ms = **~900 ms de red
serializada** antes de leer el primer dato de negocio, en cada carga de
`/dashboard`, `/mis-viajes` y `/admin` — y encima corren los 12 de `despacho` o
los 4 escaneos de `negocio.ts`. Ninguna de las tres llamadas lleva techo (ni
`proxy.ts` ni `session.ts` importan `acotada`), y `getSessionTenant` **reintenta
una vez**: con Auth degradado, decidir "¿hay sesión?" cuesta hasta
2 × (300,000 + 300,000) + 250 = **1,200,250 ms**.

Consecuencia: cada clic del contralor paga ~0.9 s antes de empezar; con Auth
lento la página no muestra estado degradado, se queda en blanco.

**REINCIDENTE** (auditoría 10, MEDIO). Mismas líneas.

### [BAJO] El ciclo de tools re-factura el prefijo completo en cada ronda: no hay prompt caching en ningún sitio del repo
`src/lib/llm/openrouter.ts:487-490` (se arma `convo` una vez), `:497-513`
(`body()`, sin `cache_control`), `:564` y `:598` (se reenvía entero), `:528`
(`for (let round = 0; round < maxRounds; round++)`), `:476` (`maxRounds = 6`).
`grep -rn "cache_control\|prompt_cache\|cached_tokens" src/` → **0 resultados**,
verificado hoy.

Números: el system prompt de liquidación son **3,343 caracteres** (medido sobre
`agents/prompts.ts`) ≈ 900 tokens, más los 3 esquemas de tool que monta el agente
(`registry.ts:21`) ≈ **1,200 tokens de prefijo invariante**. El flujo normal son
4 completions; sin caché ese prefijo se paga 4 veces: **4,800 tok × $2/1M**
(Sonnet 5, precio intro vigente hasta 31-ago-2026, `openrouter.ts:87`) =
**$0.0096 por liquidación**, ~20-30% del presupuesto declarado. Con `maxRounds =
6`: **$0.0144**. Anthropic vía OpenRouter soporta `cache_control` y el prefijo es
literalmente estático entre rondas.

**REINCIDENTE** (auditoría 10, BAJO). Sin cambios.

---

## Lo que revisé y está bien

- **`traerTodo` pagina de verdad** (`pg.ts:40-51`, `.range()` hasta
  `MAX_PAGINAS = 100`, corte en `pag.length < PAGINA`). El recorte silencioso a
  1,000 filas está cerrado en `analytics.ts` y `operacion.ts`. Lo que falta es el
  techo de tiempo, no la paginación.
- **`exigir` traduce el error por valor a excepción en el borde** (`pg.ts:23-26`),
  y `analytics.ts` lo usa en los tres caminos que no paginan (`:335`, `:365`,
  `:510`, `:571`). Fallar cerrado está bien resuelto.
- **`detectarDuplicadosEntreViajes` es O(n)** (`duplicados.ts:31-45`, `:66-80`):
  el `[...conUuid].some(u => k.includes(u))` que era O(G×U) se sustituyó por un
  barrido de ventanas contra un `Set` con longitudes fijas. La CPU de la tarjeta
  de anomalías no es el problema; sus **lecturas** sí.
- **`repo.ts` está completo**: 27 `supabaseAdmin()` / 26 `acotada`, y el único
  suelto (`:547`) es el `const admin =` cuyo RPC sí va `acotada` en `:554`.
  Verificado línea por línea, no por conteo.
- **`costos.ts` lleva techo en las cuatro** (`:131`, `:171`, `:204`, `:256`) y
  distingue tres estados (`ResumenCosto`): "no se pudo medir" no se pinta como $0.
- **El costo se cobra al precio del modelo que respondió esa ronda**
  (`openrouter.ts:479-486`, `:536`) y `calcCost` no devuelve $0 ante un modelo
  desconocido (`:106-120`): estima con la tarifa más cara y loguea. Correcto para
  un producto que se cobra por liquidación.
- **`sendText`/`sendDocument` llevan techo** (`meta/client.ts:17`, `:94`, `:125`),
  y las descargas también (15 s, `:162-189`). Aquí el código está mejor que el
  comentario de `presupuesto.ts:66-70`, que quedó viejo.
- **El presupuesto es por mensaje y el reloj es de pared** (`processor.ts:239`,
  `presupuesto.ts:214-215`). Con `Promise.all` sobre un lote
  (`route.ts:72-76`), los N relojes miden el mismo tiempo de pared, así que **no**
  se suman los presupuestos. Lo verifiqué buscando el fallo y no está.
- **`PRESUPUESTO_WEBHOOK_MS` sigue sincronizado con `maxDuration`**, con la prueba
  que lee la ruta como texto y falla si se desincronizan
  (`presupuesto.test.ts:80-90`). El mecanismo es bueno; lo que no cubre es el peor
  caso.
- **`getHuerfanos` lleva `.limit(50)`** y `marcarHuerfanosOfrecidos` /
  `resolverHuerfanos` usan `.in(…)`: una consulta para N filas. El único N+1 de
  escritura del repo es el bucle de `addGasto`.
- **`getConversacionesActivas`** (`negocio.ts:221-227`) sí lleva `.limit(20)` y
  `.order()` — la única consulta acotada del archivo.
- **El chat de `/admin`** no llama a ningún LLM: coincidencia de palabras clave
  sobre el resumen ya calculado. Cero tokens.
- **`/api/export/liquidaciones` lleva `.limit(5000)`** (`route.ts:26`) y
  `/api/export/pdf/[id]` firma con TTL de 60 s (`route.ts:59`), igual que
  `processor.ts:1411`. Los dos exports están acotados.
- **`/api/demo` no toca ni red ni LLM** (`route.ts:29-48`): corre el motor puro.
  Para un demo en vivo es la decisión correcta.

## Lo que NO alcancé a revisar

- **El `maxDuration` por defecto de una página de Vercel.** No hay `vercel.json`
  en el repo y `src/app/**` no declara ninguno, así que las 20 páginas de
  `/dashboard` y las ~30 de `/admin` corren con el default de la plataforma, que
  no puedo leer desde aquí. Toda mi aritmética de páginas la comparo contra el
  máximo del plan Pro que el propio repo cita (300,000 ms,
  `api/webhook/whatsapp/route.ts:21-23`); si el default real es menor —15 s es lo
  habitual sin fluid compute—, los hallazgos de panel empeoran, no mejoran.
- **Costo real facturado.** Todo se calcula contra `PRICES` y contra los
  comentarios del repo. No tuve acceso a OpenRouter ni a `llm_costo` con datos
  reales, así que el $0.015/visión y el $0.03–0.05/liquidación siguen sin
  contrastarse contra una factura. Con las filas que ya existen, ese contraste es
  de media hora y cerraría el ALTO de costo y el MEDIO de la imagen.
- **Tokens de imagen reales.** Cité el "24 Mpx" que el propio repo midió
  (`cfdi.ts:244`) pero no medí la distribución de tamaños que llega de WhatsApp
  Cloud API ni conté tokens contra `llm_costo.tokens_in`.
- **CPU y memoria de `generarLiquidacionPDF`** (`tools.ts:176-177`, dos ejemplares
  con `pdf-lib`). Es tiempo de cómputo dentro del tramo del agente y no lo medí:
  mi aritmética del CRÍTICO 1 solo cuenta la red.
- **El presupuesto de la ruta del XML del CFDI** (`processor.ts:858-985`, con su
  propio `acquireViajeLock(reloj.acotar(12_000))` en `:889`). Hereda el mismo
  agujero de mutex, pero no le hice la suma completa como al camino del "listo".
- **Las ~30 páginas de `/admin` más allá de `negocio.ts`**, y el prefetch de los
  enlaces del sidebar (`sidebar-nav.tsx`): no verifiqué en un navegador cuántas
  peticiones RSC dispara Next 16 para rutas dinámicas sin `loading.tsx`, así que
  no lo reporté como multiplicador del MEDIO del proxy.
- **`/mis-viajes`** (el panel del chofer). Pasa por el mismo `proxy.ts:59` y el
  mismo `getSessionTenant` sin techo, pero no conté sus consultas.
- **Latencia real Vercel↔Supabase y Vercel↔OpenRouter.** Todos los números
  nominales usan el 0.3 s/consulta que el repo asume. Si la real es peor, los
  peores casos empeoran proporcionalmente; si es mejor, **los techos (9,500 /
  10,000 / 300,000) no se mueven y las sumas del peor caso tampoco**.
