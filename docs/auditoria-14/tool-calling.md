# Tool calling — auditoría 14

**Nota: 6/10** (ronda 13: 7/10). Baja un punto — y no es deuda que cobró factura,
es código NUEVO que se acaba de escribir mal. Los dos commits de la ronda 14
(`0d23f73` y `0fa305e`, "RFA 2.9 deber ser") no tocaron ni una línea de
`src/lib/llm/`, `tools.ts`, `ocr.ts` o `costos.ts` — todo lo que la ronda 13
dejó abierto sigue abierto, incluido el MEDIO-1 del `cache_control` que está
**en producción desde `caae369` y lo reproduje HOY en HEAD**. Pero además la
implementación del deber ser de la regla 2.9 (la que se vende mañana en la
sala) metió al rubro: (a) un ALTO con cifra falsa por comprobante en el PDF, en
el aviso del jefe y en el mensaje del operador —la frontera del 15% atribuye el
excedente ACUMULADO del ejercicio al último ticket en efectivo, que puede
resultar una cifra mayor que el propio comprobante—, reproducido con valores; y
(b) un ALTO de regresión de resiliencia: la consulta del ejercicio entró al
camino del cuadre con fallo CERRADO y sin try/catch, donde antes la capa de
periodo era best-effort, así que un fallo de esa consulta tumba
`cuadrar_viaje` Y `guardar_liquidacion` completos y el error crudo cruza al
modelo. La regla estructural —`properties: {}`, IDs solo desde `ToolContext`,
handlers que ignoran `_args`— sigue intacta y probada, y no hay ningún camino
nuevo de "el modelo pide algo" a "el sistema mueve mal el dinero" (las cubetas
de la frontera suman bien; lo que miente es la atribución por comprobante). Por
eso no hay CRÍTICO. Pero el rubro no puede subir cuando lo que se acaba de
escribir viola la regla número uno del repo en el documento que compra.

## Qué se auditó y con qué evidencia

- `git log caae369..HEAD`: 15 commits de la re-auditoría de la ronda 13 (13
  fixes de otros rubros, ninguno de tool-calling) + 2 commits de la RFA 2.9.
- `git diff caae369..HEAD --stat` sobre el rubro: **cero cambios** en
  `src/lib/llm/`, `src/lib/cuadra/tools.ts`, `src/lib/cuadra/intake/ocr.ts`,
  `src/lib/cuadra/costos.ts`, `src/lib/agents/`, `presupuesto.ts` y
  `processor.ts`. Los hallazgos de la ronda 13 se re-verificaron contra el
  código IDÉNTICO.
- `src/lib/cuadra/cuadre/engine.ts` (releído completo, +94 líneas de la RFA
  2.9), `src/lib/cuadra/cuadre/desde_db.ts` (+48), `src/lib/cuadra/normas/
  por_diferencia.ts` (+6), `src/lib/cuadra/administracion.ts` (+20),
  `src/app/admin/flotas/page.tsx` (+17), `src/lib/cuadra/cierre_aviso.ts`
  (+3), `src/lib/cuadra/config.ts` (+12), `src/types/cuadra.ts` (+6), el seed
  y la migración 0082.
- Los consumidores de las nuevas diferencias: `cierre_aviso.ts`
  (RUTA_DE_DIFERENCIA), `resumen.ts` (mensaje del operador), `liquidacion/
  pdf.ts:404-421` (notas en el PDF), `guardia.ts:105`, `processor.ts:1838,
  1939`, `analytics.ts:800`.
- Los 26 archivos de prueba del rubro (`src/lib/llm/` completo + los de
  tools/por_diferencia/engine).

Corridas propias:

```
$ npx vitest run src/lib/llm/                 → 16 archivos, 73 pruebas, 0 fallos
$ npx vitest run src/lib/cuadra/engine.test.ts src/lib/cuadra/normas/por_diferencia.test.ts \
      src/lib/cuadra/tools_cableado.test.ts src/lib/cuadra/tools_camino_real.test.ts
                                               → 4 archivos, 134 pruebas, 0 fallos
$ npx vitest run tool_executor_concurrente openrouter_transitorio openrouter_truncado \
      openrouter_truncado_tools openrouter_fallback_ocr openrouter_loopguard \
      openrouter_registro_args openrouter_cache_fallo openrouter_cache_llave \
      openrouter_costo razonamiento_ocr permiso_politica
                                               → 10 archivos, 45 pruebas, 0 fallos
$ npx tsc --noEmit -p .                        → limpio
$ npx eslint (rubro + engine/desde_db/config/administracion/por_diferencia) → limpio
```

Reproducciones propias (scripts temporales `zzz_auditoria14_tmp.*`, borrados
al terminar):

1. **Frontera del 15% con dos comprobantes** (engine puro): previo=1400,
   tope=1500 (15% de 10000), A=1000 y B=1000 en efectivo con CFDI. El motor
   emite `efectivo_sobre_15` con monto 900 para A y **1900 para B** — un ticket
   de $1,000 con un excedente declarado de $1,900. Suma de montos de
   diferencias = 2800; excedente real = 1900. La cubeta `totalNoDeducible` sí
   da 1900 (correcta).
2. **MEDIO-1 del cache_control** (SDK mockeado): primario
   `anthropic/claude-sonnet-5` → 503 → fallback `openai/gpt-5.6-terra`. La
   llamada del fallback lleva `messages[0].content` como ARRAY con
   `cache_control: {type:'ephemeral'}` — idéntico a la ronda 13, en HEAD.
3. **`mensajeParaElModelo`**: verificado con node que
   `desde_db.totalCombustibleEjercicio: Failed to parse filter (...)`,
   `lectura incompleta — solo se leyeron 100000 de 240000 filas`, `PGRST116` y
   `function guardar_liquidacion_tx(...) does not exist` pasan TODOS crudos.

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools
(`tools.ts:31,87,146`), `tenantId`/`viajeId`/`operadorId` saliendo solo del
`ToolContext` resuelto en servidor (`run.ts:40-42,56`), handlers que ignoran
`_args`— sigue intacta y byte-idéntica a la ronda 13. Las cubetas de la
frontera del 15% suman el dinero correcto (reproducido); el defecto del ALTO-1
es de atribución y narración, no de totales.

### ALTO

#### [ALTO, abierto — nuevo] La frontera del 15% atribuye el excedente ACUMULADO del ejercicio al último ticket en efectivo: cifra mayor que el propio comprobante en el PDF, en el aviso del jefe y en el mensaje del operador

`src/lib/cuadra/cuadre/engine.ts:304-329` — el contador es acumulativo
(`efectivoAcumuladoEjercicio += g.monto` en :304, `acumulado = previo +
acumulado` en :306), pero el excedente que se cuelga de CADA comprobante es el
excedente CUMULATIVO, no el marginal: `const excedente = Math.max(0, acumulado
- tope)` en :320, `monto: excedente` y `nota: "…el excedente de ${mxn(excedente)}
NO se deduce"` en :324-326.

Escenario con valores (reproducido): `facilidad15=true`,
`totalCombustibleEjercicio=10000` (tope 1500), `efectivoPrevEjercicio=1400`,
dos tickets de diésel en efectivo con CFDI: A=1000, B=1000.

```
A: acumulado 2400 → excedente 900  → diferencia efectivo_sobre_15 monto 900  ✓
B: acumulado 3400 → excedente 1900 → diferencia efectivo_sobre_15 monto 1900 ✗
```

La diferencia de B declara un excedente de $1,900 sobre un comprobante de
$1,000. La suma de los montos de las diferencias = $2,800 contra un excedente
real de $1,900. Las cubetas (`totalNoDeducible=1900`, vía `proporcionDeducible`
en :322) son correctas — el dinero no se mueve mal; la narración miente por
comprobante y no es consistente ni siquiera consigo misma dentro del mismo
documento. La nota de B además es la única que coincide con el agregado del
ejercicio, así que leer la sección de diferencias del PDF da una cifra distinta
de la sección de cubetas del mismo papel.

Alcance de la cifra falsa (verificado en los consumidores):
- **PDF del contralor**: `pdf.ts:421` imprime `d.nota` de cada diferencia
  ("Las diferencias son lo ÚNICO accionable del papel").
- **Aviso de WhatsApp al jefe**: `cierre_aviso.ts:143` — `efectivo_sobre_15:
  'decision'` → interrumpe al jefe con `lineaDeDiferencia(d)` que devuelve la
  nota tal cual.
- **Mensaje de WhatsApp al operador**: `resumen.ts:67-70` imprime `d.nota` y
  `efectivo_sobre_15` NO está en `SOLO_CONTRALOR` (`resumen.ts:24-36`) → le
  llega también al chofer en el camino feliz (guardia forzada).
- **El modelo**: `tools.ts:96-97` (`cuadrar_viaje`) devuelve `{ tipo, monto,
  nota }` con `monto: 1900` → el modelo puede narrarlo.

Es exactamente la clase que este mismo archivo documenta haber resuelto para el
tope de alimentación: "no depende del ORDEN del arreglo" (`engine.ts:1100-1104`)
y "el reparto va por PROPORCIÓN del día" — el código nuevo reintroduce la
atribución por comprobante y dependiente del orden (además `getGastos` no trae
`.order()` en `repo.ts:555-560`, así que el ticket al que se le cuelga el
excedente acumulado ni siquiera es determinista entre corridas). La spec propia
del dominio lo prohíbe: `periodo/combustible.ts` documenta que "cuál pago
específico 'es' el excedente no lo resuelve ninguna fuente".

Estado: **abierto**. Las 5 pruebas nuevas de la matriz (`engine.test.ts:1417-
1487`) solo ejercitan UN comprobante, donde el acumulado coincide con el
marginal; el caso de dos comprobantes cruzando la frontera no existe.

#### [ALTO, abierto — nuevo, regresión de resiliencia] La consulta del ejercicio entró al camino del cuadre con fallo CERRADO: un fallo de esa consulta tumba `cuadrar_viaje` y `guardar_liquidacion` enteros, y el error crudo cruza al modelo

`src/lib/cuadra/cuadre/desde_db.ts:62-81` — `traerTodo(...)` corre sin
try/catch dentro de `cuadrarDesdeDB` (que es `computeCuadre` de las tools,
`tools.ts:79`). Hasta la ronda 13, la capa de periodo del ejercicio era
best-effort DENTRO del handler de `cuadrar_viaje` (`tools.ts:103-110`, con
`catch { logger.warn }` y el cuadre saliendo igual). El commit `0d23f73` movió
la consulta del ejercicio ADENTRO del cuadre y la hizo fail-closed:
`traerTodo` lanza `LecturaIncompleta` o `Error('desde_db.totalCombustibleEjercicio:
…')` (`pg.ts:137-174`), y `cuadrarDesdeDB` no lo atrapa → el handler de la tool
tira → `executeTool` devuelve `{success:false}` → el turno no cuadra ni cierra.

Escenario con valores: (a) tenant cuyo `config.hidrocarburos.claves` se
overrideó a `[]` —`fusionarConfig` documenta que "un array vacío es una
decisión"— → el filtro queda `concepto.eq.diesel,clave_prod_serv.in.()`
(`desde_db.ts:70`), PostgREST responde 400, `exigir` lanza → `cuadrar_viaje`
muere; (b) un tenant con >100,000 cargas de combustible en el año → `traerTodo`
agota las 100 páginas y lanza `LecturaIncompleta` → **`guardar_liquidacion` no
corre, la liquidación no se cierra**; (c) cualquier 500/network en esa consulta
→ mismo efecto. El camino grácil existe y no se usó: `facilidad15=undefined` +
totales ausentes caen a `combustible_efectivo` (por confirmar, "nada se
afirma") — que era el comportamiento de antes.

Además, el mensaje de error cruza crudo al modelo: verificado con node que
`VOCABULARIO_POSTGRES` (`tool-executor.ts:82`) no cubre ninguna de las familias
nuevas — `Failed to parse filter`, `lectura incompleta`, `PGRST116` — ni la
vieja (`function … does not exist`). El modelo lee el nombre interno de la
consulta, el filtro y el conteo de filas.

Estado: **abierto**. No hay `desde_db.test.ts`; los mocks de
`processor_cadena.test.ts`/`processor_cierre.test.ts` solo hacen que la
consulta "responda vacío" — nadie prueba el fallo de la consulta del ejercicio
en el camino de la tool.

#### [ALTO, abierto — nuevo, decisión de diseño con el peor default] El alta de flota no puede producir "sin declarar": un checkbox sin marcar se guarda como declaración NEGATIVA y todo el diésel en efectivo del tenant sale "no deducible"

`src/app/admin/flotas/page.tsx:37-38` (`fd.get('dedicacionExclusivaCarga') ===
'on'` — un checkbox sin marcar devuelve `null` → `false`) y :174,181 (los dos
checkboxes) · `src/lib/cuadra/administracion.ts:110-114` (`?? null` nunca
dispara desde el formulario; la llave se escribe siempre con `false` cuando la
casilla no se marcó).

El diseño tri-estado de la matriz (`config.ts:55-66`, `engine.ts:294-299`,
`docs/fiscal/rfa-2.9-deber-ser.md` §2) reserva `undefined` para "sin declarar →
por confirmar, nada se afirma". Pero el ÚNICO productor de producto de ese dato
(el alta de flota) no puede producirlo: el admin que omite las dos casillas
(están al final del formulario, texto pequeño, sin `required` ni paso de
confirmación) deja `facilidadCombustibleEfectivo =
{dedicacionExclusivaCarga: false, regimenElegible: false}` → `facilidad15 =
false` → el motor marca TODO combustible en efectivo como `efectivo_no_elegible`
= NO deducible (LISR 27-III), con la nota "la flota declaró que NO califica a la
facilidad" — una afirmación fiscal falsa sobre una declaración que nunca
ocurrió, en el PDF, en el aviso del jefe (`cierre_aviso.ts:144`, 'decision') y
en el mensaje del operador (`resumen.ts`, no está en `SOLO_CONTRALOR`). El
default es la sentencia fiscal más severa de las tres.

El seed del demo no sufre (declara `true` directo en DB, `seed.sql:104-107`),
pero TODA flota real creada por el formulario desde mañana nace con el
veredicto negativo por defecto si el admin no encuentra las casillas. Un radio
tri-estado ("sí / no / no declarado") o `required` con confirmación explícita
cierra el hueco.

Estado: **abierto**.

### MEDIO

#### [MEDIO, abierto — nuevo] Dos fuentes de verdad para el 15%, con barrido duplicado del ejercicio en el MISMO turno

`tools.ts:105` (`getAcumuladoCombustible`, filtro `.eq('concepto','diesel')` en
`repo.ts:825`) + `desde_db.ts:63-81` (filtro `concepto.eq.diesel OR
clave_prod_serv.in.(…)`). `cuadrar_viaje` corre las DOS (el motor ya trae el
contador en las notas y el handler lo recalcula para `combustible_efectivo_
ejercicio`), y `guardar_liquidacion` vuelve a correr la de `desde_db` vía
`computeCuadre`. Un cuadre + cierre = 3 barridos paginados del año
(100 viajes de red cada uno en el peor caso), y el presupuesto de la tabla
(`presupuesto.ts:40`) sigue presupuestando `cuadrarDesdeDB` entero en 300ms.

Y las dos fuentes pueden DISCREPAR: un gasto de combustible con concepto ≠
'diesel' pero con clave 151015xx entra en el motor (por `esCombustible`,
`engine.ts:287`) y NO en `getAcumuladoCombustible` — el bloque
`combustible_efectivo_ejercicio` del tool result puede decir "excedido" sobre
diferencias que dicen "dentro15" o al revés. El modelo lee los dos.

Estado: **abierto**.

#### [MEDIO, abierto — ronda 12 reincidente, en producción] El bloque `cache_control` de Anthropic sigue viajando al fallback no-Anthropic del rol `cuadre`

`src/lib/llm/openrouter.ts:666-674` (el system se arma UNA vez desde el modelo
PRIMARIO) · :672-674 (`convo` se construye con ese system) · :711-714 (el
fallback cambia `activeModel` pero reusa `convo`) · :66
(`'anthropic/claude-sonnet-5': 'openai/gpt-5.6-terra'`) · `models.ts:24` (el rol
`cuadre` corre en sonnet por default).

Reproducido HOY en HEAD con el SDK mockeado:

```
LLAMADA 1 model= anthropic/claude-sonnet-5 system content tipo= ARRAY
LLAMADA 2 (fallback) model= openai/gpt-5.6-terra system content=
[{"type":"text","text":"REGLAS FISCALES LARGAS…","cache_control":{"type":"ephemeral"}}]
```

`git diff caae369..HEAD` confirma que `openrouter.ts` no se tocó: producción
(`caae369`) lleva este código exacto desde la ronda 12, que la marcó como "el
único riesgo a cerrar antes del demo", y mañana ES el demo. `cache_prompt.test.ts`
sigue sin cubrir el camino (1)+fallback: solo prueba primario Anthropic sin
fallback, mensajes variables y primario no-Anthropic. El fix sigue siendo chico
y local: `sistema` no puede ser una constante del primario cuando `activeModel`
deja de ser Anthropic.

Estado: **abierto — y desplegado**.

### BAJO

#### [BAJO, abierto — ronda 13, ahora con DOS caminos nuevos] `mensajeParaElModelo` sigue sin cubrir las familias de error reales y sin UNA sola prueba

`tool-executor.ts:82-87` (regex) · :113 (aplicada). Verificado con node hoy:
`Failed to parse filter (clave_prod_serv.in.())`, `lectura incompleta — solo se
leyeron X de Y filas`, `{"code":"PGRST116"}`, `more than one row returned by a
subquery`, `could not serialize access`, `canceling statement due to statement
timeout` y `function guardar_liquidacion_tx(...) does not exist` pasan TODOS
crudos. Los dos caminos nuevos de la ronda 14: la consulta de
`desde_db.totalCombustibleEjercicio` (ALTO-2) y `saveLiquidacion` → RPC (ronda
13). `grep -rln "mensajeParaElModelo|VOCABULARIO_POSTGRES" src --include="*.test.ts"`
→ cero archivos: un refactor de la regex no tiene red.

#### [BAJO, abierto — ronda 13, latente] `isTransientError` sigue con falso positivo para 5xx desnudos y decimales con coma

`openrouter.ts:122` (`(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b`). Verificado hoy:
`'el gasto 502 no existe'` → true, `'monto 502,30 excede el tope'` → true
(coma decimal es-MX). `openrouter_transitorio.test.ts` sigue sin traer el
número desnudo ni la coma. Sigue inalcanzable desde el código actual (solo
recibe errores del SDK), pero es la misma deuda de la ronda 10 a medias.

#### [BAJO, abierto — ronda 13] Una llamada OCR abortada a mitad de vuelo se asienta como costo $0

`ocr.ts:284` (`costoUsd: u?.cost ?? 0`) · `openrouter.ts:404,411` (`throwIfAborted`)
y :424 (señal al SDK) · `processor.ts:798` (`extraerComprobante(dataUrl,
reloj.senal(25_000))`). El abort en vuelo deja `gastado` en 0 y `conGastado`
(`openrouter.ts:467-469`) escribe `usage.cost = 0`; la fila de `llm_costo` se
registra con $0 aunque OpenRouter pudo cobrar la generación en curso. Sin
cambio.

#### [BAJO, abierto — ronda 13] Truncamiento + truncamiento nunca prueba el proveedor de respaldo

`openrouter.ts:481-490`: si `eT` también es `TruncatedError`, `throw eT` sale
del ciclo sin mirar el `fallback`. Decisión probada como intencional
(`openrouter_truncado.test.ts`), con el hueco documentado: el modo de falla
medido del OCR. Sin cambio.

#### [BAJO, abierto — ronda 13] En el camino "ambos proveedores fallaron", el costo acumulado se etiqueta con el modelo PRIMARIO

`openrouter.ts:467-469` (`err.usage = { model, ...gastado }`). Dinero correcto,
etiqueta por-modelo mentirosa a medias. Sin cambio.

#### [BAJO, abierto — ronda 13] `JSON.stringify(exec.result)` produce `content: undefined` si un handler de éxito devuelve `undefined`

`openrouter.ts:815`. Los tres handlers devuelven objeto hoy; latente.

#### [BAJO, abierto — ronda 13] `ctx.signal` sigue sin consumirse en ningún handler

`grep -n "\.signal" src/lib/cuadra/tools.ts` → cero matches. Documentado con su
análisis en `tool-executor.ts:19-40`; mitigante activo `acotada()`. Sin cambio.

#### [BAJO, abierto — ronda 13] `generateStructured` gasta un intento pagado en el proveedor muerto antes de cruzar al fallback

`openrouter.ts:494-503`. Deliberado y comentado. Sin cambio.

#### [BAJO, abierto — ronda 13] `registerTool` ante re-registro solo avisa, no falla

`tool-executor.ts:37-39`. Teórico. Sin cambio.

#### [BAJO, abierto — nuevo] `efectivo_sobre_15` y `efectivo_no_elegible` no entran en `REVISAR`: el estatus puede decir "cuadrada" con una diferencia no deducible en la lista

`engine.ts:1053-1070` (`REVISAR` incluye `efectivo_sobre_tope` —la otra regla
de efectivo— pero no los dos tipos nuevos de la 2.9). Un viaje cuya única
diferencia es el excedente del 15% sale `estatus: 'cuadrada'` (si anticipo ≈
comprobado) mientras el jefe recibe la interrupción 'decision'
(`cierre_aviso.ts:143-144`) y el PDF muestra no deducible: la tool devuelve
`estatus: 'cuadrada'` + `diferencias: [efectivo_sobre_15 …]`, y el modelo narra
sobre esa contradicción. Inconsistente con el tratamiento de
`efectivo_sobre_tope` (que sí baja a 'revisar').

## Arreglado desde la ronda 13 (verificado en el código actual)

La ronda 13 no declaró cierres de código para este rubro (su reporte lo dice y
el diff lo confirma: `caae369..HEAD` no toca `src/lib/llm/` ni `tools.ts`), así
que no hay fixes de tool-calling que verificar. Lo que la síntesis de la 13
atribuye a la re-auditoría son fixes de otros rubros; de los que tocan el
camino de las tools, verifiqué los dos que cambian insumos del cuadre:

- **`5ef6993` (operador.rfc con productor)**: `desde_db.ts:46-50` lee
  `operador?.rfc` y lo inyecta al motor (`operadorRfc`) — el insumo llega por
  la vía correcta; la rama buena de RLISR 57 ya no es inalcanzable por falta de
  productor.
- **`37d75ee` (panel no acredita IVA sin confirmar)**: `fiscal.ts` (otro
  rubro); no toca el motor ni las tools.
- Y los cierres de la ronda 12 que la 13 re-verificó siguen en pie, uno por
  uno, byte-idénticos: `ToolCallRecord.args` auditable, loop-guard antes del
  `Promise.all`, `costoPorModelo`, caché de solo-éxitos, dedup por promesa.

## Lo que revisé y está bien

- **Regla estructural intacta**: `properties: {}` en las tres tools
  (`tools.ts:31,87,146`), handlers que ignoran `_args`, IDs solo desde
  `ToolContext` (`run.ts:40-42,56`). Byte-idéntico a la ronda 13.
- **Las cubetas de la frontera del 15% suman bien**: reproducido — A y B con
  `totalNoDeducible=1900`, `totalDeducible=100`, independiente del orden de
  `input.gastos` (el contador acumulado solo depende de totales; la atribución
  por comprobante es lo que miente). La proporción usa el MISMO mecanismo del
  tope de alimentación (`engine.ts:319-322`).
- **El abort NO dispara fallback** (verificado en el código, idéntico a la 13)
  y en `generateStructured` el reintento con nota muere en el `throwIfAborted()`
  antes de pagar una segunda llamada.
- **Caché de lectura**: solo éxitos, llave por efecto con tools sin parámetros,
  `cuadrar_` en `READ_PREFIXES`, args originales registrados con el resultado
  cacheado (`openrouter.ts:681-689, 795-800`).
- **Dedup de mutaciones**: cachea la PROMESA (`tool_executor_concurrente.test.ts`,
  6 pruebas verdes); fallo no cacheado.
- **`costoReal()`/`calcCost`**: proveedor primero, guardas contra NaN, nunca 0
  en silencio, sufijos tolerados (pruebas verdes).
- **`finish_reason:'length'` sin tool_calls** no se manda como turno bueno
  (`TruncatedError` envuelto en `PartialExecutionError`).
- **Los 3 tipos nuevos de diferencia** quedaron cableados en
  `por_diferencia.ts:37-39` (con su norma: dentro15 → rfa-2026-2.9; excedente →
  27-III + 2.9; no elegible → 27-III), en `cierre_aviso.ts:142-144` y en
  `SIN_ACREDITAMIENTO` (`engine.ts:956`) — el cableado es consistente y el test
  de cobertura de tipos (`por_diferencia.test.ts`, con el parser ya aceptando
  dígitos) pasa.
- Suite del rubro completa verde (73 + 134 + 45 pruebas), `tsc` y `eslint`
  limpios, sin archivos temporales (git status solo muestra `docs/auditoria-14/`).

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter/Anthropic/OpenAI** — el MEDIO-1 solo
  se zanja con una llamada viva (¿OpenRouter descarta o reenvía `cache_control`
  a un modelo OpenAI?) o con el fix de código. No hice la llamada: cuesta
  dinero y la regla del rubro es solo lectura.
- **Los overrides de Vercel** (`CUADRA_MODEL_CUADRE`, `CUADRA_MODEL_OCR`…): no
  verificables desde el repo. Un override sin entrada en `FALLBACK` apaga el
  plan B en silencio (comentado en `openrouter.ts:63-71`).
- **La migración 0082 y el validador `config_tenant_valida`**: rubro fiscal;
  solo confirmé que la base real la tiene aplicada según el commit y que la
  llave viaja en `tenant.config` (el camino de lectura lo usa `getConfig`).
- **El comportamiento del demo con la frontera del 15%**: el seed de
  Transportes Innovativos trae el diésel con forma_pago '03' (transferencia,
  `seed.sql:134`) y las fotos en vivo son casetas/viáticos, así que la frontera
  probablemente no se cruza en la sala — no lo pude ejecutar.
- **`finish_reason:'length'` con `tool_calls` parcialmente emitidos**: el punto
  ciego de las rondas 9/10/12/13 sigue igual, sin prueba que lo amarre.

## Veredicto

**Green light condicionado para el demo, con el rubro en su punto más bajo en
cuatro rondas.** La regla estructural —el LLM decide CUÁNDO, nunca CON QUÉ
DATOS— está intacta y probada, y las cubetas de la frontera del 15% mueven el
dinero correcto: no hay camino nuevo de "el modelo pide algo" a "el sistema
rompe dinero". El demo sembrado no cruza la frontera en efectivo, así que el
ALTO-1 no se dispara en la sala tal como está sembrado.

Pero el rubro baja a 6/10 porque la implementación del deber ser de la regla
que se vende mañana se escribió con tres defectos de la clase que este rubro
lleva cuatro rondas persiguiendo, y la deuda de las rondas 12/13 sigue
desplegada:

1. **ALTO-1: la cifra falsa por comprobante** — el excedente acumulado del
   ejercicio se cuelga del último ticket en efectivo: "el excedente de $1,900
   NO se deduce" sobre un comprobante de $1,000, en el PDF, en el aviso del
   jefe y en el mensaje del operador. Es la regla número uno del repo violada
   por el código más nuevo, en el documento que compra. Fix chico y probable:
   `excedente` marginal por comprobante (o `monto: 0` y el agregado en una sola
   línea), con una prueba de dos comprobantes cruzando la frontera.
2. **ALTO-2: la consulta del ejercicio fail-closed dentro del cuadre** — un
   fallo de esa consulta tumba `cuadrar_viaje` y `guardar_liquidacion`
   enteros (antes era best-effort), y el error crudo cruza al modelo. Fix:
   try/catch que degrade a `facilidad15=undefined` (por confirmar, nada se
   afirma), que es el camino que la propia matriz ya define.
3. **ALTO-3: el alta de flota no puede declarar "sin declarar"** — checkbox
   sin marcar = declaración negativa = todo el diésel en efectivo del tenant
   no deducible, con una nota que afirma una declaración que nunca ocurrió.
4. **El MEDIO-1 (cache_control) sigue en producción**, reproducido HOY, con la
   recomendación de la ronda 12 ("resolver antes de la sala") vencida y
   desplegada.

Recomendación antes de la sala, en orden: (a) fix del ALTO-1 (una línea +
prueba de dos comprobantes), (b) try/catch del ALTO-2 en `desde_db.ts` con la
rama `por_confirmar`, (c) tri-estado o `required` en el alta de flota,
(d) MEDIO-1: fix de `sistema` o llamada viva contra OpenRouter. Lo demás sigue
siendo deuda latente, no bloqueante.
