# Frontend — nota 6/10 (antes 7)

## Lo de la ronda anterior, verificado contra el código actual

- `<h1>` único por página: sigue así (`dashboard/page.tsx:64`, `dashboard/[id]/page.tsx:50`, cada uno con un solo `<h1>`).
- `overflow-x-auto` en la tabla de liquidaciones: sigue en `dashboard/page.tsx:160` (la tabla de 5 columnas que se auditó antes).
- `not-found.tsx`: existe, con `<h1>` y CTA de vuelta al panel.
- Contraste `#d70015`: **verificado con cálculo real de luminancia relativa (WCAG), no a ojo** — contra `--surface` claro (`#ffffff`) da **5.384:1**, pasa AA (4.5:1) para texto normal, tal como dice el comentario en `globals.css:22-23`. Ver hallazgo nuevo abajo: la verificación anterior se quedó corta en modo oscuro.
- Test de sincronía CONCEPTO/ESTATUS: `etiquetas_sincronizadas.test.ts` existe, corre (7 tests, verde) y compara motor↔PDF↔panel para `CONCEPTO` y lista↔detalle para `ESTATUS`, incluyendo cobertura contra los tipos de `types/cuadra.ts`. Sólido, no se tocó.

`npm test` completo: 486/486 verdes (50 archivos), corrido para este informe.

## Hallazgos

### [ALTO] El motor calcula tres cosas nuevas y el panel web no enseña ninguna
`src/app/dashboard/[id]/page.tsx` (completo) · `src/lib/cuadra/analytics.ts:123-155` · `src/lib/cuadra/repo.ts:307-334`

Es el mismo patrón que el propio proyecto ya nombró como riesgo conocido ("las tres cubetas de deducibilidad"), repetido con las tres piezas nuevas de esta ronda:

1. **Litros de diésel elegibles** (`litrosDieselAcreditables`, `engine.ts:517`): SÍ se imprime en el PDF (`liquidacion/pdf.ts:288-292`), pero `LiquidacionDetalle` (`analytics.ts:123-129`) no tiene el campo, y `getLiquidacionDetalle` (`analytics.ts:132-155`) no lo selecciona — no puede, porque `saveLiquidacion` (`repo.ts:307-334`) nunca lo manda a `guardar_liquidacion_tx` (compárese con `p_ieps`/`p_iva`/`p_peaje` en `repo.ts:327-329`: no hay `p_litros`), y la tabla `liquidacion` no tiene esa columna (`supabase/migrations/0007_acreditamiento.sql:9-11` solo agrega `ieps_acreditable`/`iva_acreditable`/`peaje_acreditable`). **Entra**: un contralor abre `/dashboard/<id>` para el viaje que sí tiene diésel acreditable. **Sale**: nada — ese dato solo existe en el PDF que alguien tuvo que descargar; el panel que se usa para navegar liquidaciones no lo tiene ni lo puede tener sin migración.

2. **El contador del 15% de combustible en efectivo** (`combustible_efectivo_ejercicio`, `tools.ts:64-86`): no llega a NINGÚN lado durable. No está en el PDF (`command grep` confirmó cero referencias a `periodo`/`combustible`/`Tope15` en `liquidacion/pdf.ts`), no se persiste (mismo `saveLiquidacion` de arriba), y en el panel no existe. Su único destino es el payload JSON que ve el LLM en ESE turno, filtrado además por `guardiaFundamento` (solo puede citarlo si `estado !== 'holgado'`, `tools.ts:79`) y sujeto a que el modelo decida mencionarlo en el texto de WhatsApp. **Entra**: la flota lleva 13.2% de su diésel en efectivo (estado `cerca`, a $1,100 de perder la deducción del resto del año). **Sale**: si el modelo no lo menciona ese turno (nada lo obliga a hacerlo — es contexto, no una instrucción de cierre), el aviso completo desaparece: no está en el WhatsApp, no está en el PDF, no está en el panel. El único lugar donde el contralor podría enterarse es un mensaje de texto que puede no llegar.

3. **El veredicto laboral (LFT 263-I, deducible ≠ pagadero)**: `resumenLaboral` SÍ está bien enganchado al PDF (`liquidacion/pdf.ts:312-331`, sección "LO QUE SE LE REEMBOLSA AL OPERADOR"), que es lo correcto. Pero el panel web (`dashboard/[id]/page.tsx`) no tiene ninguna sección equivalente — un contralor que revisa liquidaciones desde el navegador (en vez de abrir cada PDF) no ve por qué un gasto "no deducible" de todos modos se le paga al operador, que es exactamente la confusión que `pagadero.ts` fue escrito para evitar.

Confirmado con `command grep` (no `grep` normal) que no hay ninguna referencia a `resumenLaboral`, `veredictoLaboral`, `combustible_efectivo_ejercicio`, `evaluarTope15` ni `avisoTope15` en ningún archivo bajo `src/app/`.

### [MEDIO] Contraste de `--color-bad` roto en modo oscuro — la verificación anterior no cubrió dark mode
`src/app/globals.css:24` · `src/app/acceso/page.tsx:45`

`--color-bad: #d70015` se define una sola vez en `@theme` (línea 24) y **no tiene override** en el bloque `@media (prefers-color-scheme: dark)` (líneas 45-55) ni en `:root[data-theme="dark"]` (línea 57) — a diferencia de `--bg`, `--surface`, `--ink`, `--muted`, `--line` y `--accent`, que sí cambian. Se usa como color de TEXTO (no de fondo decorativo) en `acceso/page.tsx:45`, el mensaje de error del login del panel.

Medido con la fórmula de luminancia relativa de WCAG (no a ojo):

```
d70015 vs superficie clara #ffffff:  5.384:1   → pasa AA (4.5:1)
d70015 vs superficie oscura #16161c: 3.346:1   → NO pasa AA
d70015 vs fondo oscuro #0b0b0f:      3.649:1   → NO pasa AA
```

**Entra**: un contralor con macOS en modo oscuro (el propio sistema de diseño se llama "macOS premium... Light + dark automáticos", `globals.css:6`) teclea mal el passcode en `/acceso`. **Sale**: el mensaje "Código incorrecto." se pinta en rojo a ~3.3-3.6:1 de contraste contra el fondo oscuro — por debajo del 4.5:1 que el propio comentario del código (línea 22-23) dice haber conseguido. La ronda anterior corrigió el tono correctamente para modo claro (el comentario incluso lo documenta con precisión) pero no verificó el modo oscuro, que este mismo archivo soporta activamente.

### [OPINIÓN, no hallazgo] Tabla de comprobantes del detalle sin `overflow-x-auto`
`src/app/dashboard/[id]/page.tsx:98` usa `overflow-hidden` en vez de `overflow-x-auto` para la tabla de 3 columnas (Concepto/Folio/Monto). A diferencia de la tabla de 5 columnas que sí se corrigió, esta tiene contenido corto (una palabra, un folio, un monto) y no tengo un caso concreto de overflow real en móvil. Lo anoto como sospecha, no como hallazgo: no puedo construir la entrada que la rompe.

---

# Tool calling — nota 6/10 (antes 6)

## Lo de la ronda anterior, verificado contra el código actual

- `PartialExecutionError` carga el costo acumulado: `openrouter.ts:376-397` (`tokensIn`, `tokensOut`, `cost` en el constructor) y `openrouter.ts:519` lo llena con lo que sí se gastó (`tokIn, tokOut, costo`) antes de que el ciclo cayera.
- El camino de error SÍ llama `registrarCosto`: `processor.ts:516-525`, con comentario explícito de por qué va antes del `if` de recuperación ("el dinero se fue de todos modos"). Confirmado, no solo declarado.
- `calcCost` ya no devuelve `$0` en silencio: `openrouter.ts:88-102` — modelo desconocido se estima con la tarifa más cara de la tabla y se loguea `llm.modelo_sin_precio`.

## Hallazgos

### [ALTO] `cuadrar_viaje` no cachea entre llamadas del mismo turno — cae entre las dos rejillas de deduplicación que sí existen
`src/lib/llm/openrouter.ts:399-400,433,500-509` · `src/lib/llm/tool-executor.ts:74-87` · `src/lib/cuadra/tools.ts:43-98`

Hay DOS mecanismos de caché en el ciclo de tools, y `cuadrar_viaje` no califica para ninguno:

1. **`crossRound`** (`openrouter.ts:433`, usado en `500-509`): cachea entre rondas SOLO tools cuyo nombre empiece con `get_`, `check_`, `list_`, `find_`, `consultar_` o `validar_` (`isReadOnly`, línea 399-400). `consultar_politica` sí califica (empieza con `consultar_`). `cuadrar_viaje` **no** — no empieza con ningún prefijo de la lista, aunque su propio docstring dice "NO cierra la liquidación" (o sea, es de lectura).
2. **`mutacionesHechas`** (`tool-executor.ts:74-87`): dedupea tools con `isMutation: true`. `cuadrar_viaje` está registrado sin ese flag (correctamente — no muta), así que tampoco entra aquí.

Resultado: `cuadrar_viaje` es la única tool de lectura que se re-ejecuta completa cada vez que el modelo la llama, aunque los argumentos sean siempre idénticos (`{}`, no toma parámetros).

**Entra**: el operador escribe en un solo mensaje "oye cómo voy, y si está bien ciérralo". El prompt (`prompts.ts:21-27`) obliga al agente a llamar `cuadrar_viaje` antes de `guardar_liquidacion` "en el mismo turno" — si el modelo primero la usa para responder "cómo voy" y luego la vuelve a llamar como paso 2 del cierre (mismo turno, misma llamada `generateWithTools`, hasta 6 rondas de margen), **sale**: dos ejecuciones completas de `computeCuadre` (3 lecturas paralelas: `getViaje`, `getGastos`, `getConfig`) más, ahora, dos ejecuciones de la nueva `getAcumuladoCombustible` — sin que ninguna capa lo evite. No es un bug de dinero (los números son consistentes, es puro y determinístico), es gasto de red y de reloj duplicado que el propio patrón de `isReadOnly` fue diseñado para evitar y no cubre por un desajuste de nomenclatura.

### [MEDIO] Cero cobertura de test para la lógica nueva dentro del handler de `cuadrar_viaje`
`src/lib/cuadra/tools.ts:52-97`

`command grep -rln "cuadrar_viaje" src --include="*.test.ts"` solo encuentra `cuadre/guardia.test.ts`, y ese archivo prueba `guardiaCifras` (que solo mira si una tool *llamada* `cuadrar_viaje` aparece en la lista de tool calls, para decidir si narra el cierre) — nunca invoca el handler real registrado en `tools.ts`. El try/catch alrededor de `getAcumuladoCombustible` (líneas 65-72, con su rama de fallo `logger.warn('periodo.combustible_no_disponible', ...)`), el ensamblado de `fundamentos` (línea 77-79, incluyendo el push condicional de `rfa-2026-2.9` cuando `estado !== 'holgado'`) y la forma exacta del objeto `periodo` que ve el modelo no tienen ninguna prueba directa. Si alguien rompe la ruta feliz de `getAcumuladoCombustible` (p. ej. cambia el nombre de una columna), el `catch` silencioso hace que el bug pase inadvertido en CI: los 486 tests siguen en verde.

---

# Rendimiento y costo — nota 6/10 (antes 6)

## Lo de la ronda anterior, verificado contra el código actual

- Reloj compartido (`presupuesto.ts`): `PRESUPUESTO_WEBHOOK_MS = 60_000` (línea 50) sincronizado por test contra `maxDuration = 60` de `route.ts:24` (visto: no hay desajuste). `presupuesto_camino.test.ts` simula el peor caso (barrera+mutex+agente al máximo) y pasa.
- `AbortSignal` del OCR: `ocr.ts` acepta `signal?: AbortSignal` (línea 159) y lo usa (línea 184); `processor.ts:227` lo alimenta desde `reloj.senal(25_000)`. Confirmado, no solo declarado.

## Hallazgos

### [ALTO] `getAcumuladoCombustible` no tiene índice que la respalde — escala con el año completo del tenant, no con el viaje
`src/lib/cuadra/repo.ts:408-430` · migraciones `0001_init.sql:87-91`, `0014_gasto_img_hash.sql:7`, `0015_gasto_img_hash_unique.sql:10`

La consulta nueva filtra `gasto` por `tenant_id` + `concepto = 'diesel'` + rango de `fecha` del año en curso. Los únicos índices que tocan la tabla `gasto` son `idx_gasto_viaje(viaje_id)`, `idx_gasto_viaje_hash(viaje_id, img_hash)` y `uq_gasto_img_hash(tenant_id, viaje_id, img_hash)` — ninguno tiene `concepto` ni `fecha`, y el único que empieza en `tenant_id` lo hace para deduplicar fotos por viaje, no para acotar por fecha/concepto. Postgres puede usar ese índice como prefijo de `tenant_id` pero igual tiene que revisar fila por fila (todos los conceptos, todo el histórico del tenant que calce el rango de fechas) para aplicar los otros dos filtros.

No pude medir el tiempo real de la consulta contra Postgres (la auditoría es de solo lectura y no toca la BD), así que esto es un hallazgo de **diseño verificado en el código**, no un tiempo medido: el costo de esta consulta crece con el TOTAL de gastos del ejercicio del tenant, no con el tamaño del viaje que se está cuadrando — y **se paga en cada llamada a `cuadrar_viaje`**, no una vez por liquidación (ver hallazgo de tool calling arriba: nada impide que se llame más de una vez por turno).

### [MEDIO] `computeCuadre` y `getAcumuladoCombustible` corren en serie pudiendo correr en paralelo
`src/lib/cuadra/tools.ts:54` y `:67`

```
54:    const liq = await computeCuadre(ctx.tenantId, ctx.viajeId);
...
67:      const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

`getAcumuladoCombustible` solo necesita `ctx.tenantId` y el año en curso — no depende de `liq` para nada. Tal como está escrito, su latencia se SUMA a la de `computeCuadre` en vez de solaparse. Un `Promise.all` (con el mismo `try/catch` alrededor de la pata de `getAcumuladoCombustible` para no tumbar el cuadre si falla, que es la intención declarada del comentario "best-effort" en la línea 62) recortaría a la mitad el tiempo que esta tool le añade al turno.

### [MEDIO] Ninguna llamada a la BD dentro de una tool está atada al reloj de `presupuesto.ts` — ni la nueva ni las viejas
`src/lib/cuadra/tools.ts` (todo el archivo) · `src/lib/cuadra/repo.ts` (todo el archivo) · `src/lib/llm/tool-executor.ts:12-19,74-87`

`ToolContext` trae un campo `signal?: AbortSignal` (`tool-executor.ts:18`), que `run.ts` sí llena con el `AbortController` derivado de `timeoutMs: reloj.acotar(40_000)` (`processor.ts:486`). Pero `command grep -rn "ctx\.signal\|\.abortSignal(" src/lib/cuadra src/lib/llm` no encuentra NINGÚN uso: ni `cuadrar_viaje` ni `guardar_liquidacion` ni ninguna función de `repo.ts` (incluida la nueva `getAcumuladoCombustible`) lee `ctx.signal` ni llama `.abortSignal()` en el cliente de Supabase. El único lugar donde el `AbortController` del turno sí se conecta es la llamada de completado del LLM (`openrouter.ts:452,457`, vía `signalOpt`).

Esto significa que si una llamada a Postgres dentro de una tool se cuelga (carga, red, o el escaneo sin índice del hallazgo de arriba bajo contención), **nada la corta**: el `reloj.gastado()` sigue avanzando y se puede reportar en el log, pero no hay ningún mecanismo activo que aborte esa consulta específica — la invocación completa corre hasta que Vercel la mata a los 60s duros, que es exactamente el modo de falla silenciosa que `presupuesto.ts` dice en su propio comentario que existe para evitar (líneas 4-8). Es un hueco preexistente, no introducido en esta ronda, pero la nueva `getAcumuladoCombustible` queda expuesta a él igual que todo lo demás en `repo.ts`.

### [VERIFICADO, no es un problema — número medido] `fundamento.ts` recompila regex en cada llamada, pero el costo real es de ~2ms, una vez por turno
`src/lib/cuadra/normas/fundamento.ts:32-50` (`patronesDe`) · `processor.ts:573-574` (dónde se invoca)

`patronesDe` no está memoizada: compila entre 3 y 5 `new RegExp(...)` por norma cada vez que se llama, y `citasEnTexto` la invoca para las 19 normas del índice (más una segunda pasada para las que sí calzaron, y `guardiaFundamento` una tercera pasada para proteger/quitar citas). Pero **se invoca UNA sola vez por turno del agente** (`processor.ts:573-574`, después de armar la respuesta final), no una vez por tool call ni dentro de un loop.

Medido directamente (Node + esbuild, bundle del archivo real sin tocarlo, primera llamada del proceso sin calentar el JIT — el escenario más parecido a una invocación serverless fresca):

```
guardiaFundamento (texto con 2 citas legítimas + 1 inventada): 2.10 - 2.23 ms
citasEnTexto sola:                                              1.43 - 1.49 ms
```

(En un loop caliente con JIT ya optimizado el promedio cae a 0.03-0.05 ms/llamada, pero eso no representa el patrón de uso real de una llamada por turno.)

Contra un presupuesto de turno de 40-48s, **2ms es inmaterial** — el 0.005% del presupuesto del agente. La sospecha de la ronda ("¿cuánto cuesta por mensaje?") estaba bien planteada pero el número dice que no hace falta memoizar todavía: sería una optimización gratis (un `Map<string, RegExp[]>` construido una vez al cargar el módulo) pero no hay evidencia de que el costo actual justifique priorizarla.

### [BAJO, nota informativa] El payload nuevo de `cuadrar_viaje` cuesta centavos de centavo, no dólares — el problema de fondo es la red, no los tokens
`src/lib/cuadra/tools.ts:64-96`

Medido construyendo el payload real (mismas funciones: `indice.ts`, `por_diferencia.ts`, `periodo/combustible.ts`, `periodo/aviso.ts`) para dos escenarios representativos, con la heurística estándar de ~4 caracteres/token:

```
Caso "sin diferencias, ejercicio holgado" (el más común):
  antes:   116 chars  (~29 tokens)
  después: 243 chars  (~61 tokens)
  delta:   +127 chars (~32 tokens)  ← se añade SIEMPRE, incluso sin nada que decir

Caso "3 diferencias, ejercicio cerca del 15%":
  antes:   335 chars  (~84 tokens)
  después: 856 chars  (~214 tokens)
  delta:   +521 chars (~130 tokens)
```

A precio de Claude Sonnet 5 (`openrouter.ts:69`, $2/1M tokens de entrada), 130 tokens extra cuestan **~$0.00026 por llamada** — trivial. El hallazgo real no es de costo en dólares sino de diseño: `combustible_efectivo_ejercicio` se agrega al payload SIEMPRE que la consulta a la BD no falle (`tools.ts:86`), no solo cuando `estado !== 'holgado'`, así que el caso más común (flota tranquila, nada que avisar) paga igual el bulto completo del objeto con `aviso: null`. Y dentro de ese objeto, `estado`/`razon` son parcialmente redundantes con `aviso`, que ya trae la misma información en una frase lista para citar — no hay daño medible, pero es peso que el modelo no necesita para cumplir la instrucción del prompt.
