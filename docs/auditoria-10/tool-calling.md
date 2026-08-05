# Tool calling — auditoría 10

**Nota: 8/10** (ronda 9: 8/10, sin cambio de nota — pero con un ALTO real
encontrado, arreglado y commiteado esta ronda: `cc2d6b8`). La vara: ¿el
sistema solo ejecuta lo que puede ejecutar, con los datos que el LLM NUNCA
decide, y un error de proveedor nunca se ve como un error del negocio? 10 =
ningún camino entre "el modelo pide algo" y "el sistema lo corre" puede
romper dinero o filtrar datos internos. 8 = la regla estructural está
intacta y probada, pero quedan huecos de atribución/observabilidad que un
día van a doler, no hoy.

La nota no sube porque lo que se cerró esta ronda (el hueco de fallback del
OCR) es real y estaba en producción, pero es del mismo tamaño que lo que ya
estaba señalado como MEDIO/BAJO en la ronda 9 — no cambia la foto general.
Lo que sí cambia: uno de esos huecos dejó de ser hipotético y pasó a estar
confirmado contra el override que vive en Vercel ahora mismo.

## Qué se auditó y con qué evidencia

- `src/lib/llm/openrouter.ts` (727 líneas, era 668 en la síntesis de la
  ronda 9) — releído completo.
- `src/lib/llm/tool-executor.ts` (121 líneas) — **byte-idéntico** desde el
  cierre de la ronda 9 (`git diff 848487a..HEAD` sin salida).
- `src/lib/cuadra/tools.ts` (212 líneas) — **byte-idéntico**, mismos tres
  `registerTool(` en las líneas 25/81/139.
- `src/lib/agents/run.ts` y `src/lib/agents/registry.ts` — **sin cambios**.
- `src/lib/cuadra/facturacion/agente.ts` — LEÍDO completo (462 líneas, casi
  todo escrito HOY: `git diff 848487a..HEAD --stat` marca +205 líneas netas
  sobre este archivo entre tres commits de hoy). Ver nota de alcance abajo.
- Corrida propia: `npx vitest run src/lib/llm/ src/lib/cuadra/tools_cableado.test.ts
  src/lib/cuadra/normas/permiso_politica.test.ts src/lib/agents/` →
  **82 pruebas, 16 archivos, 0 fallos** (incluye la prueba nueva de esta
  ronda). `npx tsc --noEmit -p .` y `npx eslint` sobre los archivos tocados,
  limpios.

### Sobre el archivo que el encargo pedía verificar (`openrouter_registro_args.test.ts`)

Ese archivo **no existe** — `find src/lib/llm -iname '*registro*'` no
devuelve nada, y `git log --since=2026-08-04 -- src/lib/llm/` no lo
menciona. Lo que sí tocó `src/lib/llm/` hoy, confirmado por
`git log --oneline --since=2026-08-04 -- src/lib/llm/`:

1. `71be672` perf(ocr): reasoning por rol medido (con
   `razonamiento_ocr.test.ts`, ya verde).
2. `53492a3` perf(ocr): cambio de modelo OCR a `gemini-3.1-flash-lite` +
   entradas nuevas en `PRICES` — **este commit es la causa raíz del ALTO de
   esta ronda**, ver abajo.
3. `88adc4d` perf(cuadre): caché de prompt (`cache_control` en el system de
   Anthropic) — revisado, correcto, con `cache_prompt.test.ts` (3 pruebas)
   cubriendo el caso positivo (Anthropic sí marca), el caso de no invalidar
   la caché con mensajes que cambian, y el caso negativo (no-Anthropic no
   manda `cache_control`).
4. `796efc3` fix(costos): `costoReal()` prioriza el costo que reporta el
   proveedor sobre la tabla propia — revisado, correcto, con
   `costo_real.test.ts` (4 pruebas) probando el caso de caché real medido
   contra OpenRouter (-92%), el fallback a tabla cuando no viene costo, y
   que un costo basura (`NaN`, negativo) no se cuela.

Ninguno de los cuatro es "registro de argumentos" en el sentido de
`ToolCallRecord.args`. La pieza real de trabajo de hoy en mi rubro, sin
commitear cuando arranqué esta ronda, fue la que seguía abajo.

## Arreglado esta ronda

### [ALTO, cerrado] `FALLBACK` no tenía entrada para el modelo de OCR que YA está activo en producción — commit `cc2d6b8`

`src/lib/llm/openrouter.ts:63` (tabla `FALLBACK`, ahora con la entrada) ·
causa raíz en `53492a3` (4-ago-2026).

`generateStructured` (usada por `extraerComprobante`, el OCR de tickets) lee
`const fallback = FALLBACK[model] ?? null;` y solo intenta el proveedor
alterno si `fallback` no es `null` (`openrouter.ts:461`: `if (fallback &&
(isTransientError(e1) || isTransientError(e2)))`). El commit `53492a3` de
hoy movió el default de OCR a `google/gemini-3.1-flash-lite` —medido 12.5×
más barato y con mejor lectura, con el override ya puesto en
`CUADRA_MODEL_OCR` de Vercel— y agregó su precio a `PRICES`, pero no agregó
su entrada en `FALLBACK`. Encontré el fix YA ESCRITO (con un comentario
completo explicando exactamente esto) en el working tree, sin commitear —
consistente con "algunos agentes murieron a medio camino" hoy: alguien más
lo diagnosticó y lo escribió, pero no llegó al commit.

Lo verifiqué de dos formas antes de darlo por bueno:

1. **Reconstruí el bug con `git stash` sobre el archivo solo.** Con el
   archivo pre-fix, mi prueba nueva (`openrouter_fallback_ocr.test.ts`)
   falla con el error crudo del primario (`503 Service Unavailable`)
   propagado tal cual — el fallback nunca se intenta. Con el archivo
   post-fix, la misma prueba pasa y la 3ª llamada al SDK sí va al modelo de
   respaldo (`anthropic/claude-haiku-4.5`).
2. **Confirmé que es el override REAL, no un caso de laboratorio**: el
   comentario en `models.ts:44` dice textualmente que `CUADRA_MODEL_OCR` "ya
   apunta a 3.1-flash-lite" en Vercel.

Consecuencia sin el fix: un Gemini caído en el flujo de OCR de comprobantes
—el punto de entrada de TODO el producto, cada foto que manda un chofer—
gastaba dos intentos contra el mismo proveedor muerto y terminaba en "foto
ilegible" en vez de cruzar a Anthropic. Con el fix, cruza.

Prueba de regresión: `src/lib/llm/openrouter_fallback_ocr.test.ts` (2
pruebas) — fija `CUADRA_MODEL_OCR` al valor de producción antes de importar,
mockea dos fallos transitorios del primario y verifica que la 3ª llamada al
SDK va al modelo de `FALLBACK`.

### [BAJO, nuevo — riesgo residual del mismo bug, documentado y no arreglado]

`src/lib/llm/openrouter.ts:100-103` (`PRICES`) vs `:54-67` (`FALLBACK`).

El mismo commit `53492a3` agregó CUATRO modelos a `PRICES` durante el
benchmark de OCR, no solo el que ganó: `google/gemini-2.5-flash-lite`,
`google/gemini-2.5-flash` y `google/gemini-3-flash-preview` están precificados
pero **ninguno tiene entrada en `FALLBACK`**. Hoy no es un bug activo —
ninguno es el modelo que corre en producción—, pero es el mismo hueco: el
día que alguien pruebe uno de estos tres por `CUADRA_MODEL_OCR` (son
justamente los candidatos que se compararon en el benchmark, el lugar más
probable de donde saldría el próximo cambio), pierde el respaldo
cross-provider en silencio, sin error ni log. No lo arreglé esta ronda
—inventar a qué proveedor debería caer cada uno sin la misma medición que
sostiene las entradas existentes sería una decisión de producto, no una
corrección obvia—, pero el comentario que ya vive en `FALLBACK:54-61` (de la
misma pieza sin commitear) ya avisa exactamente de esta clase de error para
quien toque la tabla después.

## Reincidentes de la ronda 9 (releídos completos hoy, sin cambio de código)

### [MEDIO] La atribución de costo/modelo tras fallback sigue etiquetando el ciclo completo con el modelo de la ÚLTIMA ronda

`src/lib/llm/openrouter.ts:659` (era :537 en la ronda 9 — solo se desplazó
por las 60 líneas nuevas de caché de prompt + costo real que se insertaron
ANTES). `used = res.model || activeModel;` sigue viviendo dentro del `for`
de rondas y se sobreescribe en cada vuelta; lo que sale como `model` del
ciclo completo (`processor.ts` → `llm_costo.modelo` → `faseDeModelo` en
`costos.ts`) es solo el modelo de la ronda que cerró, no una mezcla honesta
de un ciclo que corrió 3 rondas en Sonnet y 1 en el fallback. El costo en
dinero SÍ está bien —se acumula ronda a ronda al precio de quien respondió
esa ronda, confirmado en `openrouter_fallback_costo.test.ts`—; lo que sigue
mal es la ETIQUETA de proveedor de la fila completa.

### [MEDIO] `ToolCallRecord.args` en la caché cross-round sigue sin describir qué args produjeron el `result` que trae

`src/lib/llm/openrouter.ts:704` (era :594). Sin cambio: cuando una tool de
solo lectura pega en `crossRound`, `executed.push({..., args, result:
c.result, ...})` mete el `args` de ESTA llamada con el `result` de la
llamada ANTERIOR que llenó la caché. Consecuencia hoy: ninguna, porque las
tres tools registradas siguen con `properties: {}` (confirmado, sin
cambio en `tools.ts:31,87,146`) así que `args` es siempre `{}` para las
tres. El día que una tool reciba parámetros reales, este campo miente.

### [BAJO] `cuadrar_viaje` y `consultar_politica` siguen sin una prueba que invoque su handler real vía `executeTool` — CERRADO

`command grep -rn "executeTool('cuadrar_viaje'\|executeTool('consultar_politica'"
src --include="*.test.ts"` sigue sin devolver nada. Sin cambio desde la
ronda 9: la condición que decide si el modelo puede citar `rfa-2026-2.9`
(`tools.ts:117`) y la que decide si una norma tiene permiso de citarse
(`tools.ts:71`) siguen sin arnés propio — solo probadas por reconstrucción a
mano en `permiso_politica.test.ts`, no por el camino real.

**Arreglado** (`459db00`, `src/lib/cuadra/tools_camino_real.test.ts`): mismo
patrón que `tools_cableado.test.ts` ya usa para `guardar_liquidacion` — se
mockea la capa de datos (`cuadre/desde_db`, `config`, `repo`), nunca el
handler; `executeTool('cuadrar_viaje', …)` y `executeTool('consultar_politica',
…)` corren el handler REGISTRADO de verdad. Cubre: los totales del cuadre
real, que el permiso de citar (`fundamentos`/`norma_id`) viaja con las
diferencias del cuadre Y con la política, y que "sin viaje activo" se
captura por `executeTool` sin reventar el turno.
```
$ npx vitest run src/lib/cuadra/tools_camino_real.test.ts
 ✓ src/lib/cuadra/tools_camino_real.test.ts (5 tests)
```

### [BAJO] `ctx.signal` sigue sin consumirse en ningún handler de tool

`command grep -n "\.signal" src/lib/cuadra/tools.ts src/lib/cuadra/repo.ts`
sigue sin devolver nada, pese a que `repo.ts` volvió a crecer esta ronda
(+49/-3 líneas — pero ninguna de las funciones nuevas la importa `tools.ts`,
verificado igual que en la ronda 9). El `AbortSignal` del turno (`run.ts:34`)
sigue sin llegar a las consultas de una tool en vuelo; el mitigante sigue
siendo el timeout propio de 8s en `presupuesto.ts`.

### [BAJO] `isTransientError` sigue con el mismo falso positivo por `5\d\d` dentro del texto de un error de dato

`src/lib/llm/openrouter.ts:70-84`. Mismo regex, sin cambio, sin caso
negativo en `openrouter_transitorio.test.ts` con un `5xx` que NO es del
proveedor (p. ej. un folio `FOLIO-502` o un monto en el mensaje de un
`check constraint`).

### [BAJO] El error crudo de Postgres sigue viajando sin filtrar al contexto del modelo

`src/lib/llm/tool-executor.ts:55-63` (`err.message` sin sanitizar) ·
`src/lib/cuadra/repo.ts:479` (`saveLiquidacion` lanza el `.message` crudo).
Sin cambio.

### [BAJO] El loop-guard sigue ejecutando la ronda 6 completa antes de tirar `LoopGuardError`

`src/lib/llm/openrouter.ts:722`. Sin cambio.

## Nota de alcance: `facturacion/agente.ts` NO es tool calling de LLM

El encargo describe este archivo como "tool calling contra Playwright", pero
leído completo hoy no lo es: es automatización determinística por
selectores, y el propio archivo documenta POR QUÉ (líneas 23-29): un modelo
de visión mirando la pantalla costaría ~$0.08/factura, siete veces el resto
del costo de una liquidación completa ($0.24). `grep -rln
"generateStructured\|generateResponse\|generateWithTools" src/lib/cuadra/`
no encuentra ninguna llamada al LLM dentro de `facturacion/` — la única
carpeta de `cuadra/` que sí llama al gateway es `intake/` (el OCR, ya
cubierto arriba). Este archivo está modificado en el working tree ahora
mismo (otra sesión activa, sin commitear) — no lo toqué. Lo que revisé es
solo lectura: `facturarConAgente`/`facturarLoteConAgente` fallan cerrado en
los tres puntos que importan (sin adaptador → no improvisa; campo requerido
vacío → no se manda; excepción del adaptador → no reintenta, para no
duplicar un CFDI), y el registro de adaptadores está scoped por tenant
(`ADAPTADORES: Map<tenant, Map<comercio, adaptador>>`, con `exigirTenantId`
lanzando en vez de caer a un cajón compartido) — pero nada de esto es
tool-calling del LLM, así que no le puse peso en la nota de este rubro.

## Lo que revisé y está bien

- **La regla estructural sigue intacta**: `properties: {}` en las tres
  tools, `tenantId`/`viajeId`/`operadorId` solo salen de `ToolContext`
  resuelto en servidor. `tools.ts` y `run.ts` byte-idénticos a la ronda 9.
- **La caché de prompt nueva de hoy está bien cableada**: solo marca
  `cache_control` en el system cuando el modelo es Anthropic, nunca en los
  mensajes que cambian entre rondas — las tres pruebas de
  `cache_prompt.test.ts` verdes, y confirmé a mano que un modelo no-Anthropic
  manda el system como string plano (sin el bloque de caché).
- **`costoReal()` prioriza el costo real del proveedor sobre la tabla, con
  guardas contra basura** (`NaN`, negativo) — nuevo de hoy, correcto,
  probado.
- **El fallback cross-provider mixto sigue con prueba real**:
  `openrouter_fallback_costo.test.ts` sigue verde y sigue cubriendo el ciclo
  primario+fallback con tool_calls de por medio.
- **La idempotencia de mutaciones bajo concurrencia sigue sólida**:
  `tool_executor_concurrente.test.ts` (6 pruebas) verde, sin cambios en
  `tool-executor.ts`.
- **El fix de esta ronda no rompió nada del rubro**: 82 pruebas verdes
  (`src/lib/llm/`, `tools_cableado.test.ts`, `permiso_politica.test.ts`,
  `src/lib/agents/`), `tsc` y `eslint` limpios sobre los archivos tocados.

## Lo que NO alcancé a revisar

- Nada contra la API real de OpenRouter/Anthropic — mismo límite de siempre.
- `finish_reason:'length'` con `tool_calls` parcialmente emitido — mismo
  punto ciego señalado en la ronda 9, sin evidencia nueva para convertirlo en
  hallazgo.
- Los otros archivos que cambiaron hoy fuera de mi rubro
  (`processor.ts`, `enrutar.ts`, `pendientes.ts`, `intake/huerfanos.ts`) —
  solo confirmé que ninguno cruza hacia `tools.ts`/`openrouter.ts` por sus
  imports; no los auditué a fondo porque son de otros rubros (agéntico,
  backend).
