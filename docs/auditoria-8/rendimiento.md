# Rendimiento y costo — auditoría 8

**Nota: 6/10** (antes 7). Razón del movimiento: **mirada más profunda** — el
código de runtime que gobierna el peor caso no cambió una sola línea esta
ronda (cero commits tocaron `repo.ts`, `costos.ts`, `meta/client.ts`,
`analytics.ts`, `identificar.ts` o `models.ts` con intención de rendimiento;
verificado con `git log abdc98d..HEAD`), así que los tres ALTOS de la ronda 6
se verifican REINCIDENTES sin cambio. Lo que sí es nuevo es la profundidad de
la mirada sobre dos piezas que la ronda 6 dejó como "no verificado": (1)
confirmé que `consultar_politica` llama a `getConfig` sin ninguna protección
NI la salvación accidental de `Promise.all` que blinda el paso 3 del cierre —
`ToolContext.signal` tiene **cero lectores** en todo `tools.ts` — así que hay
un cuarto camino sin techo dentro del presupuesto caro del agente, no solo los
11 del cierre; y (2) las dos piezas de higiene que se calificaban "sin
consecuencia de runtime" (el offset de `PASOS_CIERRE` y los comentarios
"60s") **empeoraron de forma medible** durante una ronda que tocó
`processor.ts` seis veces sin que nadie las corrigiera al pasar — el patrón
que la ronda 6 predijo como riesgo futuro ("puede abrir una instancia nueva
del mismo patrón") ya no es hipotético, es lo que pasó. Un rubro donde ni un
commit de 41 se dirigió a los riesgos ya escritos, y donde la deriva pasiva
crece en vez de quedarse quieta, no sostiene un 7.

El riesgo mayor sigue siendo el mismo de las rondas 5 y 6: un socket colgado
en cualquiera de los 11 pasos del cierre sin techo (o ahora, en `getConfig`
dentro del turno del agente) se lleva la invocación completa hasta que
`maxDuration=120` la mata, con la liquidación ya escrita en la base y el
operador sin recibir una sola palabra.

---

## Hallazgos

### [ALTO, REINCIDENTE] "Ahora hay techo por consulta" sigue cubriendo 2 de 13 pasos del cierre — y hay un cuarto camino sin techo, confirmado esta ronda, dentro del turno del agente

`src/lib/cuadra/costos.ts:85,114,168` · `src/lib/cuadra/conv.ts:239-243,400-403` ·
`src/lib/meta/client.ts:82-96,107-123` · `src/lib/cuadra/processor.ts:920` ·
`src/lib/cuadra/config.ts:176-178` · `src/lib/cuadra/tools.ts:35`

Verifiqué cada uno de los 13 pasos de `PASOS_CIERRE` contra el código de HOY,
no contra el de la ronda 6. `repo.ts` sigue con `acotada()` (17 llamadas
protegidas con `TOPE_CONSULTA_MS` — corrí `repo_tope.test.ts`, 4/4, la
protección real toma ~1.5s con el tope de prueba). Pero **ninguno de los
cuatro módulos que cargan los otros 11 pasos importa `acotada`, `TOPE_CONSULTA_MS`
ni ningún `AbortSignal`**:

- `costos.ts:114` (`registrarCosto`), `:168` (`vincularCostosALiquidacion`),
  `:85` (`registrarCostoWhatsApp`, invocado ×3) — `supabaseAdmin()` crudo, sin
  `acotada`. Llamados desde `processor.ts:743,747,302,923`.
- `conv.ts:239-243` (`saveConversation`), `:400-403` (`releaseViajeLock`) —
  `supabaseAdmin()` crudo. Llamados desde `processor.ts:946,991`.
- `meta/client.ts:82-96` (`sendText`), `:107-123` (`sendDocument`) — `fetch`
  pelado, sin `signal`. Llamados vía `say()` (`processor.ts:299-303`, tres
  veces: 880, 900) y directo en 922.
- `processor.ts:920` — `supabaseAdmin().storage.from('liquidaciones').createSignedUrl(...)`,
  crudo.

Confirmé con `command grep -c "await acotada(" src/lib/cuadra/repo.ts` → **17**,
el mismo número que la ronda 6 midió: cero funciones nuevas en `repo.ts`
llevan el mecanismo a `costos.ts`, `conv.ts` o `meta/client.ts` porque nadie
lo movió ahí. El paso 3 (`guardiaCifras → cuadrarDesdeDB`) sigue "sí\*" por la
misma razón frágil de la ronda 6: `desde_db.ts:11-15` hace
`Promise.all([getViaje, getGastos, getConfig])`, y solo los dos primeros
tienen tope — si `getConfig` cuelga sola, la arrastra el rechazo de sus
hermanas, no un diseño propio.

**Lo nuevo esta ronda: verifiqué que esa salvación accidental NO existe en
absoluto para un cuarto camino.** `tools.ts:35` (`consultar_politica`) llama
`getConfig(ctx.tenantId)` **sola**, sin ningún `Promise.all` que la acompañe.
`getConfig` (`config.ts:176-178`) es `supabaseAdmin()` crudo, igual que
arriba. Y `ToolContext.signal` —declarado en `src/lib/agents/run.ts:34`,
parte de la interfaz en `src/lib/llm/tool-executor.ts:11-18` (el campo
`signal?: AbortSignal` es la línea 18)— tiene: `command
grep -n "signal" src/lib/cuadra/tools.ts` → **cero resultados** en todo el
archivo de 13 tools. La ronda 6 había dejado esto como "verifiqué que el
código lo permite; no medí probabilidad" (su sección "Lo que NO alcancé a
revisar"). Ya no es una posibilidad sin medir: es un camino confirmado,
dentro del presupuesto de 40s del agente (`processor.ts:730`,
`reloj.acotar(40_000)`), sin ningún mecanismo — ni propio ni prestado — que lo
corte antes de que Vercel mate la función entera a los 120s.

**Escenario con valores.** Un operador pregunta "¿por qué se descontó esto?"
a media conversación (sin que el agente llame `cuadrar_viaje`), el modelo
decide llamar `consultar_politica`, y el socket hacia Supabase se queda a
medio abrir (el mismo patrón que `repo_tope.test.ts` reproduce: acepta la
conexión y no contesta). Sin `TOPE_CONSULTA_MS` ni `signal`, el `fetch`
interno de `supabaseAdmin()` hereda el default de undici (300s,
`headersTimeout`/`bodyTimeout`). El turno del agente nunca vuelve. A los 120s
Vercel mata la función. Como este turno NO llamó `guardar_liquidacion`, no
hay liquidación huérfana en la base — pero el operador tampoco recibe
respuesta a su pregunta, no hay log de error (nunca se llega al `catch` de
`processInbound`), y Meta ya tiene su 200: no reintenta.

**Consecuencia:** para el operador, un mensaje que desaparece sin explicación
ni reintento. Para quien mantiene esto, un cuarto síntoma del mismo patrón
—"el arreglo se escribió por archivo (`repo.ts`), no por camino de
ejecución"— que ya afecta 12 de 13 pasos del cierre y ahora, confirmado, al
menos un camino más fuera del cierre.

**Causa raíz:** el mecanismo (`acotada()`) vive en `repo.ts` y solo protege lo
que pasa por ahí. `costos.ts`, `conv.ts`, `meta/client.ts` y `config.ts` no lo
importan, y `ToolContext.signal` se declaró (ronda anterior a la 5) pero nunca
se cableó a ningún handler de `tools.ts`.

---

### [MEDIO, REINCIDENTE, PEOR] El `donde` de `PASOS_CIERRE` sigue apuntando a líneas equivocadas — y la deriva se TRIPLICÓ esta ronda, sin que se tocara

`src/lib/cuadra/presupuesto.ts:35-49` contra `src/lib/cuadra/processor.ts` (líneas reales)

`presupuesto.ts` no tiene ni un commit en `abdc98d..HEAD` (`git log` vacío
para ese archivo). Pero `processor.ts` sí: **seis commits** esta ronda
(`d30a205`, `c07360a`, `b187427`, `12bf3a6`, `95bbe01`, más los que tocan
otras zonas del archivo), sumando cientos de líneas. Comparé cada
`donde: 'processor.ts:N'` contra la línea real de HOY:

| paso de la tabla | línea que declara | línea real | delta |
|---|---|---|---|
| `registrarCosto` del turno | 591 | 743 | +152 |
| `vincularCostosALiquidacion` | 595 | 747 | +152 |
| `guardiaCifras → cuadrarDesdeDB` | 658 | 817 | +159 |
| `sendText` de la respuesta | 715 | 880 | +165 |
| `getGastos` del aviso de barrera | 734 | 899 | +165 |
| `sendText` del aviso de barrera | 735 | 900 | +165 |
| `createSignedUrl` del PDF | 755 | 920 | +165 |
| `sendDocument` del PDF | 757 | 922 | +165 |
| `registrarCostoWhatsApp` del PDF | 758 | 923 | +165 |
| `saveConversation` | 774 | 946 | +172 |
| `releaseViajeLock` | 814 | 991 | +177 |

Los valores declarados (591, 595, 658, 715, 734, 735, 755, 757, 758, 774, 814)
son **exactamente los mismos** que la ronda 6 ya reportó como incorrectos —
nadie los tocó desde entonces. Lo que cambió es el delta: en la ronda 6 el
offset era **uniforme, +28 en las 11 filas** (evidencia de que la tabla se
escribió una vez contra una versión vieja y nunca más). Hoy el offset **crece
de +152 a +177 según bajas en el archivo** — ya no es uniforme, lo que dice
que `processor.ts` recibió inserciones en VARIOS puntos distintos (no solo al
principio) durante estas dos rondas, y la tabla no absorbió ninguna. La
prueba que debería atraparlo (`presupuesto.test.ts:118`,
`expect(p.donde).toMatch(/\.ts/)`) sigue sin verificar que la línea exista o
corresponda — mismo hueco que la ronda 6 documentó, sin cambios.

**Consecuencia:** el propio comentario de la tabla (`presupuesto.ts:18-30`)
explica por qué existe: la versión anterior era "una lista en prosa" y
"nadie se enteró porque una lista en prosa no se puede verificar"
(`presupuesto.ts:25`) cuando enumeraba seis pasos donde en realidad había
trece. Hoy, si alguien confía en el `donde` para auditar el paso 13
(`releaseViajeLock`, dice línea 814), va a caer en medio del bloque de
recuperación de cierre parcial (líneas 810-820 reales), no donde vive el
paso real (991) — el mismo tipo de extravío que la tabla se escribió para
evitar, reproducido dentro de la propia tabla. Sigue sin consecuencia de
runtime: es deuda de documentación que se demostró, otra vez, que crece sola.

**Causa raíz:** el `donde` es un string literal sin ninguna verificación
automática contra el AST o el archivo real; nada en CI lo recalcula cuando
`processor.ts` cambia.

(REINCIDENTE, peor que la ronda 6: mismo hallazgo, deriva 6× mayor.)

---

### [ALTO, REINCIDENTE] `analytics.ts` sigue barriendo la tabla completa del tenant — sin cambios de código esta ronda

`src/lib/cuadra/analytics.ts:39-44 (getKpis), 71-77 (getStatsPorOperador), 106-110 (detectarAnomalias), 130-134 (getAcreditables)`

Verificado línea por línea contra el archivo de hoy (398 líneas, creció desde
la ronda 6 pero no en las cuatro funciones señaladas): las cuatro siguen
haciendo `supabaseAdmin().from(...).select(...).eq('tenant_id', tenantId)`
sin `.limit()` ni `.range()`. Confirmé con
`command grep -n "\.limit(\|\.range(" src/lib/cuadra/analytics.ts` → **cero
resultados** en todo el archivo. El único commit de esta ronda que toca
`analytics.ts` (`3fb1e81`, "pruebas: analytics_deriva prueba la función real")
es un arreglo de PRUEBAS (exportar `derivoLaConfig` para que el test deje de
reimplementarlo) — no toca ninguna de las cuatro consultas. El `max_rows` de
PostgREST (default 1.000 filas) sigue recortando en silencio `detectarAnomalias`
en cuanto el tenant pasa las ~125 liquidaciones (8 gastos/liquidación
promedio), con el mismo efecto documentado desde la ronda 5: el detector de
fraude entre viajes deja de ver la mayoría de los datos sin decir nada — no
lanza, no loguea, simplemente ve menos.

**Consecuencia:** para el contralor de una flota que ya lleva más de un
trimestre operando con Likida, la pantalla de anomalías puede reportar "0
duplicados" con datos reales de fraude fuera de la ventana que PostgREST
decidió devolver, y no hay forma de saber desde el panel que la lectura está
incompleta.

**Causa raíz:** no cambió — sigue siendo que estas cuatro funciones no
adoptaron el patrón de paginación que `getAcumuladoCombustible` (`repo.ts`)
sí tiene desde la ronda 6.

---

### [ALTO, REINCIDENTE] El protocolo de dos fotos sigue pagando visión completa en el acercamiento — sin cambios de código esta ronda

`src/lib/cuadra/processor.ts:388` · `src/lib/cuadra/intake/ocr.ts:218-243`

```ts
const extraccion = await extraerComprobante(dataUrl, reloj.senal(25_000));
```

Cero commits de esta ronda tocan `ocr.ts` con intención de fusionar las dos
fotos en una llamada (el único commit relevante, `d30a205`, cambia el AVISO
de "manda el ticket completo" para que salga una vez por viaje en vez de una
por foto — un arreglo de UX, no de costo). `extraerComprobante` sigue
aceptando `string | string[]` (`ocr.ts:219`) y su propio docstring
(`ocr.ts:202-215`) explica que pasarle AMBAS fotos junto haría UNA sola
llamada de visión, con los códigos ya extraídos gratis de la que no los
necesita. Pero el único llamador real (`processor.ts:388`) sigue mandando
`dataUrl` de a una: cada foto —la del ticket completo Y la del
acercamiento— dispara su propio `extraerComprobante`, y como cada llamada ve
solo UNA imagen, `iSinCodigo` (`ocr.ts:241-242`) decide "la foto sin código es
la principal" mirando un arreglo de longitud 1 — así que el acercamiento, que
SÍ trae código, se convierte en su propia `principal` y paga una segunda
llamada de visión completa que no aporta nada (el código ya salió gratis de
`decodeCodigosFromImage`, `ocr.ts:237`).

**Consecuencia:** el costo de visión sigue duplicado en su partida dominante
por cada ticket que usa el protocolo de dos fotos, exactamente como documentó
la ronda 5. No repito la derivación de pesos por llamada (nada cambió en
precios ni tokens esta ronda — ver el hallazgo de `models.ts` abajo); vive en
`docs/auditoria-5/rendimiento.md`.

**Causa raíz:** el emparejamiento de las dos fotos (`decidirFoto`,
`EMPAREJAN`) ocurre DESPUÉS del OCR de cada una por separado, no antes —
`processor.ts` nunca retiene la primera foto para pasarla junto con la
segunda al mismo `extraerComprobante`.

---

### [MEDIO, REINCIDENTE] El costo declarado en `models.ts` sigue sin corregirse

`src/lib/llm/models.ts:17` · `src/lib/llm/openrouter.ts:87`

```ts
//   Costo ≈ $0.03–0.05 / liquidación.
```

Cero commits de esta ronda tocan `models.ts` ni las secciones de precio de
`openrouter.ts` (`git log abdc98d..HEAD -- src/lib/llm/` solo trae `87daa62`,
que cambia el dominio impreso en un prompt de marca, no un precio). La cifra
medida en la ronda 5 (~$0,33 típico, ~$0,62 peor caso) sigue sin reflejarse.
`openrouter.ts:87` sigue con `'anthropic/claude-sonnet-5': [2, 10], // intro
VIGENTE hasta 31-ago-2026` sin ninguna lógica de fecha ni prueba que avise
cuando esa ventana se cierre — hoy (1-ago-2026) sigue dentro de la ventana,
así que no es un error activo todavía, pero el mecanismo para que deje de
serlo sigue sin existir.

**Consecuencia:** cualquiera que presupueste el costo por liquidación desde
el comentario del código (en vez de medir) subestima entre 7× y 12×. El 31 de
agosto, si nadie interviene a mano, el precio real sube (Sonnet 5 vuelve a
$3/$15) y el comentario seguirá diciendo $0.03–0.05 sin que nada lo marque.

**Causa raíz:** no cambió — el comentario es texto libre, no una constante
derivada de una medición ni verificada por una prueba.

---

### [BAJO, REINCIDENTE, PEOR] Los comentarios "60s" no solo siguen sin corregirse — se extendieron a más archivos durante una ronda que editó esos mismos archivos

`src/app/api/webhook/whatsapp/route.ts:66,69` · `src/lib/cuadra/conv.ts:352,363,365` ·
`src/lib/cuadra/intake/ocr.ts:224` · `src/lib/llm/openrouter.ts:219` ·
`src/lib/cuadra/presupuesto.ts:11,134` · `src/lib/cuadra/processor.ts:213-222` ·
`src/lib/observability/sentry.ts:86`

La ronda 6 contó 8 apariciones en 5 archivos. Hoy son **8 archivos** (sumaron
`processor.ts` y `sentry.ts`), todas describiendo el presupuesto ACTUAL de la
invocación como si `maxDuration` siguiera en 60 cuando es 120 desde el
28-jul-2026 (`route.ts:28`). Dos ejemplos concretos, no cosméticos:

- **`conv.ts:352` se contradice con `conv.ts:363` a 11 líneas de distancia,
  en el mismo archivo, sin que nadie lo note.** La línea 352 (docstring de
  `esperarIntake`) dice: `tope configurable (env CUADRA_INTAKE_ESPERA_MS,
  default 60s)`. El código real, cinco líneas más abajo (`conv.ts:368`), es
  `const tope = timeoutMs ?? (Number(process.env.CUADRA_INTAKE_ESPERA_MS) ||
  20_000)` — el default real es **20s**, no 60s. Y la línea 363 ya lo sabe:
  dice literalmente `Default 20s, NO 60s`, corrigiendo el mismo error que su
  propio docstring comete 11 líneas arriba.
- **`processor.ts:213-221` afirma `maxDuration=60` en el comentario que abre
  la función, una línea antes de la línea de código que usa el valor real.**
  `processor.ts:215-216`: "20s de barrera + 12s de mutex + 40s de agente = 72s
  contra un presupuesto de 60." La siguiente línea de código real,
  `processor.ts:222`, es `crearPresupuesto(PRESUPUESTO_WEBHOOK_MS)`, y
  `PRESUPUESTO_WEBHOOK_MS = 120_000` (`presupuesto.ts:118`). `processor.ts`
  recibió **seis commits** esta ronda (verificado con `git log abdc98d..HEAD
  -- src/lib/cuadra/processor.ts`) y ninguno tocó estas ocho líneas de
  cabecera, pese a que están a dos líneas del código que las contradice.

**Consecuencia:** sin efecto en runtime — ninguno de estos comentarios
gobierna un timeout real. La consecuencia es de confianza en la
documentación, y el propio crecimiento del conteo (8→8 archivos con 2 nuevos,
mismo total de instancias pese a que se corrigieron cero) es la evidencia más
directa de que nadie lee estos comentarios cuando toca el código de al lado
— ni siquiera al tocarlo seis veces en una ronda.

**Causa raíz:** no cambió — son comentarios en prosa, sin ningún mecanismo
(como el que sí protege `MARGEN_CIERRE_MS` vs `COSTO_CIERRE_MS`) que los
compare contra la constante real.

---

## Costo por liquidación

Sin cambios en precio de modelo, tokens o el protocolo de dos fotos esta
ronda (confirmado arriba: cero commits en `src/lib/llm/` que toquen precio, y
el protocolo de dos fotos sin tocar), las cifras de la ronda 5 siguen
vigentes y no las re-derivo: **≈$0,33 por liquidación de 8 comprobantes,
peor caso ≈$0,62**, contra el **$0,03–0,05** que sigue declarando
`models.ts:17`.

**Lo nuevo de esta ronda, medido:**

- **Catálogo de comercios, 13→37 (`facturacion/comercios.ts`, confirmado
  ~38 entradas con `command grep -c "reconocer:" comercios.ts`).**
  `identificarComercio` (`facturacion/identificar.ts:29-46`) es un
  `COMERCIOS.find()`/`.filter()` lineal sobre el arreglo — con 37 entradas y
  un puñado de patrones por comercio (dominios/RFC/texto), es del orden de
  cientos de comparaciones de string sobre un texto de ticket de unos
  cientos de caracteres: microsegundos, no milisegundos. Crecer 3× el
  catálogo no movió nada medible. Sin hallazgo.
- **Permisos CRE, 12.625 registros (`facturacion/permisos_cre.json`,
  436 KB) — la pregunta del encargo era si la consulta está indexada o es
  lineal.** Está **indexada**: `permiso_cre.ts:132` hace
  `(PERMISOS as Record<string, string>)[permiso]`, acceso de propiedad sobre
  un objeto plano — O(1) por V8, no un escaneo. Pero la respuesta completa a
  la pregunta es más importante que el mecanismo: **no hay ninguna consulta
  que medir, porque nada en producción llama `identificarPorPermiso` ni
  `coberturaTablaCre`.** Verificado con `command grep -rln
  "identificarPorPermiso|coberturaTablaCre|permiso_cre" src/` → los únicos
  dos resultados son el propio `permiso_cre.ts` y su archivo de prueba.
  `comercios.ts`, `identificar.ts`, `processor.ts`, `tools.ts` y `startup.ts`
  no lo importan. Es una cosecha real (`688b8c2`, 31-jul-2026, el día antes
  de esta ronda) con 16 pruebas verdes, correctamente indexada, y CERO costo
  o latencia en producción hoy — porque no corre. No lo cuento como hallazgo
  de rendimiento porque no hay escenario de "entra X → sale Y mal" sobre
  costo o tiempo; lo dejo anotado porque es la respuesta directa a la
  pregunta del encargo y porque probablemente le importe a agéntico o
  arquitectura (una capacidad construida y probada que el flujo real nunca
  invoca).

---

## La suma del peor caso, eslabón por eslabón

Sin cambios en las constantes que gobiernan la cadena — confirmado contra el
código de hoy, no asumido: `maxDuration = 120` (`route.ts:28`), barrera
`acotar(20_000)` (`processor.ts:643`), mutex `acotar(12_000)`
(`processor.ts:676`), agente `acotar(40_000)` (`processor.ts:730`),
`MARGEN_CIERRE_MS = 12_000` (`presupuesto.ts:70`) y `COSTO_CIERRE_MS = 8_900` (`presupuesto.ts:35-52`,
recalculado sumando a mano los 13 `ms` de `PASOS_CIERRE`: 300+300+300+1500+
300+300+1500+300+500+2500+300+500+300 = 8.900). El peor caso sumado en el
camino donde todo responde (lento, no colgado) sigue cabiendo: **90.8s contra
120s, 29.2s de holgura aritmética.** No repito la tabla eslabón por eslabón
completa (vive en `docs/auditoria-6/rendimiento.md`); nada de lo que cambió
esta ronda la toca.

**Lo que sí importa: el peor caso real de este producto nunca fue "todo
lento".** Es "un socket se queda colgado", y para ESE escenario el único
techo sigue siendo `maxDuration=120` en 11 de los 13 pasos del cierre, más
—confirmado esta ronda— en `getConfig` cuando se llama sola desde
`consultar_politica`. La holgura de 29.2s no protege de nada cuando el fallo
es "no vuelve nunca": un socket colgado en cualquiera de esos caminos quema
el resto del presupuesto hasta los 120s, mata la función, y si ya corrió
`guardar_liquidacion` (el caso del cierre, no el de `consultar_politica`) la
liquidación queda escrita en la base sin que el operador reciba una sola
palabra.

---

## Lo que revisé y está bien

- **`TOPE_CONSULTA_MS` + `AbortSignal` + carrera contra temporizador, para lo
  que cubren, siguen funcionando.** Corrí `repo_tope.test.ts` (4/4, con
  tiempos reales: la lectura protegida se rinde en ~1.5s contra un servidor
  mudo, la escritura por RPC igual) y `presupuesto.test.ts` (15/15).
- **`getAcumuladoCombustible` (`repo.ts:595-652`) sigue paginado y fail-closed,
  sin cambios de código esta ronda.** No repito la verificación, ya la hizo
  la ronda 6; leí el código de hoy y es idéntico.
- **El catálogo de comercios (13→37) no introdujo ningún costo medible.**
  Ver arriba: escaneo lineal sobre 37 entradas, microsegundos.
- **Los permisos CRE (12.625 registros) están indexados correctamente
  (acceso de objeto, O(1)), aunque hoy no corren en producción.** Ver arriba.
- **`sat.ts` sigue con su `AbortSignal` de 4s** y las descargas de media de
  `meta/client.ts` (`downloadMediaAsText`/`downloadMediaAsDataUrl`) con
  `DOWNLOAD_TIMEOUT_MS = 15_000` — ninguno de los dos se tocó ni se rompió
  esta ronda.
- **El nuevo `getCodigosPendientes` en el camino del aviso de acercamiento
  (`processor.ts`, commit `d30a205`) sí usa `acotada`** (`repo.ts:311-...`,
  confirmado con `command grep -n "acotada" repo.ts` cerca de esa función) —
  es una lectura nueva en un camino existente, protegida desde que nació, no
  un hallazgo nuevo.

## Lo que NO alcancé a revisar

- **Latencia real Vercel↔Supabase.** Igual que las rondas 5 y 6: toda la
  tabla del peor caso usa costos unitarios optimistas escritos en el propio
  código, no medidos en producción.
- **No pude reproducir en runtime el colgado de `costos.ts`/`conv.ts`/
  `meta/client.ts` contra un servidor mudo esta ronda** (el patrón que sí usa
  `repo_tope.test.ts`). Lo intenté desde fuera del repo, respetando la
  restricción de no escribir archivos dentro de él, y Vitest no recoge
  pruebas fuera de su raíz de proyecto sin tocar su configuración. La
  verificación de esta ronda es estática —código abierto y leído línea por
  línea, mismo patrón de import que el arnés de la ronda 6 usa— pero no
  volví a correr el cronómetro. Dado que ninguno de los cuatro módulos
  cambió una sola línea desde la ronda 6 (confirmado por `git log`), el
  resultado medido en la ronda 6 (los seis casos seguían colgados a los
  12.000 ms) sigue siendo la evidencia de tiempo más reciente disponible.
- **Con qué frecuencia real el operador dispara `consultar_politica` sin que
  el turno también llame `cuadrar_viaje`** (el escenario que deja a
  `getConfig` sola, sin la salvación de `Promise.all`). Confirmé que el
  código lo permite y que no hay ninguna protección; no medí la probabilidad
  contra tráfico real porque no existe tráfico real todavía (pre-revenue).
- **Consumo real de tokens del turno de cuadre y costo real de una imagen en
  Gemini.** Sin cambios desde la ronda 5; sigue sin medirse con una llamada
  real (el encargo la prohíbe).
