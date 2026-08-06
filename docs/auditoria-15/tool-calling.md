# Tool calling — auditoría 15

**Nota: 6/10** (ronda 14: 6/10). Se atacó y subió en lo estructural — los dos
ALTOs de la ronda 14 que movían mal el dinero están cerrados de verdad y con
prueba —, pero la forma en que se cerró el ALTO-2 deja un defecto nuevo de la
MISMA clase que el ALTO-1 que se acababa de arreglar: el fallo de la consulta
del ejercicio ya no tumba el cuadre, pero inyecta ceros que el motor lee como
medición, y con `facilidad15=true` (la flota del demo declara true en el seed)
TODO el diésel en efectivo del viaje sale `efectivo_sobre_15` no deducible con
"tope de $0.00 (15% de $0.00)" en el PDF, en el aviso del jefe y en el WhatsApp
del operador — reproducido HOY. El comentario del propio fix (`desde_db.ts:70-
74`) dice que "la rama 'sin datos del ejercicio' marca el efectivo para
revisar", y esa rama NO existe para `facilidad15=true`: marca NO DEDUCIBLE. La
cifra falsa tiene TRES disparadores — consulta caída, recibo con `fecha` NULL
(consulta sana), recibo con fecha fuera del `anioEjercicio` (frontera de año) —
y ninguno tiene prueba. A eso se suman tres MEDIO nuevos (la nota
`combustible_efectivo_dentro15` afirma "deducible" sobre tickets que la misma
cubeta manda a por-confirmar; el panel contradice al motor en el tri-estado
"sin declarar"; la "una sola barrida del ejercicio" del commit 8a33ce1 sigue
siendo dos barridos con criterios y años que divergen) y el MEDIO-1 del
`cache_control` sigue en producción, reproducido HOY otra vez, sin una sola
prueba que cubra el camino primario→fallback. La regla estructural —`properties:
{}`, IDs solo desde `ToolContext`, handlers que ignoran `_args`— sigue intacta
y probada, y las cubetas de la frontera ya suman el excedente REAL e invariante
al orden (reproducido). Por eso no hay CRÍTICO. Pero el rubro no sube cuando
el fix del fallo más caro del turno produce la cifra fiscal falsa que la regla
número uno del repo prohíbe, en las tres superficies, con un disparador que no
necesita ningún fallo.

## Qué se auditó y con qué evidencia

- `git log caae369..HEAD`: 2 commits que tocan el rubro — `0d23f73` +
  `0fa305e` (RFA 2.9 deber ser, ronda 14) y **`8a33ce1`** ("corrige los
  hallazgos de la auditoría 14", 31 archivos) — más `d7b171f` (backend+legal,
  no toca el rubro salvo `processor.ts` en el rechazo de PDF, rubro backend).
- `git diff caae369..HEAD --stat` sobre el rubro: **`src/lib/llm/` completo
  sigue sin tocarse** (MEDIO-1 y todos los BAJO de la ronda 13 intactos,
  byte-idénticos). Los cambios del rubro están en `cuadre/engine.ts` (+103),
  `cuadre/desde_db.ts` (+49), `tools.ts` (+10), `cifras.ts` (+57),
  `estado_afirmado.ts` (+19, rubro agentico), `fiscal.ts` (+24),
  `administracion.ts` (+25), `app/admin/flotas/page.tsx` (+53), `repo.ts`
  (+25, `getAcumuladoCombustible` con claves + `actualizarFacilidad15`),
  `config.ts` (+12), `types/cuadra.ts` (+6), migración `0083`.
- `src/lib/cuadra/cuadre/engine.ts` (releído el bloque 2.9 completo, cubetas,
  `cubetaDe`, `REVISAR`, `SIN_ACREDITAMIENTO`), `desde_db.ts` (completo),
  `tools.ts` (los 3 handlers), `fiscal.ts` (`causasDe`/`ivaSostenible`),
  `resumen.ts`, `cierre_aviso.ts`, `guardia.ts`, `periodo/aviso.ts`,
  `periodo/combustible.ts`, `presupuesto.ts`, `repo.ts`
  (`getAcumuladoCombustible`/`actualizarFacilidad15`), migración 0083,
  `pdf.ts:395-430`.
- `src/lib/llm/openrouter.ts` (650-730, 395-510, 800-830), `models.ts`,
  `tool-executor.ts`, los 17 archivos de prueba de `llm/`.
- Los tests nuevos de 8a33ce1 (`engine.test.ts` +106: excedente por
  comprobante y estatus revisar; `fiscal.test.ts` +3; `repo_acumulado.test.ts`
  +1).

Corridas propias:

```
$ npx vitest run src/lib/llm/            → 17 archivos, 74 pruebas, 0 fallos
$ npx vitest run engine.test.ts tools_cableado tools_camino_real
                                          → 3 archivos, 127 pruebas, 0 fallos
$ npx vitest run resumen aviso por_diferencia fiscal cifras estado_afirmado \
      guardia repo_acumulado cierre_aviso → 8 archivos, 166 pruebas, 0 fallos
$ npx tsc --noEmit -p .                   → limpio (los 2 errores son de un
      zzz-fiscal-aud15-probe.test.ts AJENO, sin trackear, de otro auditor)
$ npx eslint (rubro + superficies)        → 0 errores, 1 warning:
      desde_db.ts:9 'supabaseAdmin' importado y sin usar
```

Reproducciones propias (scripts temporales `zzz_auditoria15_tmp.*`, borrados
al terminar; en el árbol quedan los `zzz-*` de OTROS auditores, sin trackear,
que no toqué):

1. **ALTO nuevo — ceros del fallo con `facilidad15=true`** (motor puro):
   `totalCombustibleEjercicio=0`, `efectivoPrevEjercicio=0`, un diésel en
   efectivo con CFDI de $1,000 →
   ```
   efectivo_sobre_15, monto 1000, totalNoDeducible 1000, estatus revisar
   nota: "…el ejercicio lleva $1,000.00 de combustible en efectivo contra un
   tope de $0.00 (15% de $0.00); el excedente de $1,000.00 de ESTE comprobante
   NO se deduce (RFA 2026 regla 2.9)."
   ```
   Con `facilidad15=undefined` el MISMO input sale `combustible_efectivo`
   ("esto se revisa", monto 0) — la rama honesta existe, el fix no la usa.
2. **Mismo claim falso con consulta SANA — recibo con `fecha: undefined`**:
   el barrido del ejercicio excluye los recibos sin fecha del denominador,
   `total=0`, y el motor cuelga el excedente completo ("tope de $0.00").
3. **Mismo claim falso en la frontera de año** (scratch de otro auditor,
   corrido por mí): ticket del 30-dic-2025 en viaje que ancla 2026 → `total=0`
   → misma nota falsa.
4. **`combustible_efectivo_dentro15` sobre ticket SIN CFDI**: `estatus:
   'cuadrada'`, `totalPorConfirmar: 1000`, `totalDeducible: 0`, nota
   "**deducible** por la facilidad del 15%" — el papel se contradice solo.
5. **MEDIO-1 cache_control** (SDK mockeado, idéntico a la ronda 14):
   ```
   LLAMADA 1 model= anthropic/claude-sonnet-5 system content tipo= object
   LLAMADA 2 (fallback) model= openai/gpt-5.6-terra system content=
   [{"type":"text","text":"REGLAS FISCALES LARGAS…","cache_control":{"type":"ephemeral"}}]
   ```

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools
(`tools.ts:31,87,146`), IDs solo desde el `ToolContext` resuelto en servidor,
handlers que ignoran `_args`— sigue intacta y byte-idéntica. Las cubetas de la
frontera del 15% mueven el dinero correcto: el excedente POR COMPROBANTE es
marginal y su suma es invariante al orden (reproducido: 3×$1,000, tope $1,500 →
suma de la columna $1,500 = `totalNoDeducible`). El defecto del ALTO-1 es de
narración y de atribución en el caso de datos ausentes, no de totales.

### ALTO

#### [ALTO, abierto — nuevo. Cierre del ALTO-2 de la ronda 14 con la forma equivocada] El fallo de la consulta del ejercicio ya no tumba el cuadre, pero los ceros que recibe el motor se leen como medición: con `facilidad15=true`, TODO el diésel en efectivo del viaje sale no deducible con "tope de $0.00" — sin que ningún fallo sea necesario

`src/lib/cuadra/cuadre/desde_db.ts:76-81` — el try/catch del fix degrada a
`totalesEjercicio = { efectivo: 0, totalCombustible: 0 }` y sigue; el motor
recibe `totalCombustibleEjercicio=0`, `efectivoPrevEjercicio=0`. En
`engine.ts:316-336` (rama `elegible === true`), con `total=0`:
`tope = 0.15*0 = 0` (:317), `cupoRestante = max(0, 0 - previo) = 0` (:318),
`dentro = 0` (:319), `excedenteDeEste = g.monto` (:320) → la diferencia
`efectivo_sobre_15` con `monto: g.monto` y la nota :332:
"el ejercicio lleva ${mxn(acumulado)} … contra un tope de $0.00 (15% de $0.00);
el excedente de $1,000.00 de ESTE comprobante NO se deduce".

El comentario del fix miente sobre su propia rama: `desde_db.ts:70-74` dice "el
motor recibe ceros y la rama 'sin datos del ejercicio' marca el efectivo para
revisar, que es el fail-cerrado honesto" — para `facilidad15=true` NO existe
esa rama: la que corre es la de no-deducible. La rama honesta (`combustible_efectivo`,
por confirmar) solo corre para `facilidad15=undefined` (:344-346). La matriz
que el propio fix cita (`docs/fiscal/rfa-2.9-deber-ser.md` §2) reserva el
tercer estado para "no se puede evaluar → nada se afirma"; el fix lo reemplazó
por ceros que parecen medidos.

Escenario con valores (reproducido HOY, dos veces):
- (a) **consulta caída** — un 500/network/timeout en
  `getAcumuladoCombustible` (o el corte a 100,000 cargas del año,
  `repo.ts:861`), `facilidad15=true` (el seed del demo declara `true`,
  `seed.sql:104-107`), un diésel en efectivo con CFDI de $1,000 →
  `efectivo_sobre_15` $1,000, nota "contra un tope de $0.00", en el PDF
  (`pdf.ts:404-421`), en la interrupción al jefe (`cierre_aviso.ts:143`,
  'decision'), en el WhatsApp del operador (`resumen.ts` — `efectivo_sobre_15`
  NO está en `SOLO_CONTRALOR` `resumen.ts:24-36`) y en lo que lee el modelo
  (`tools.ts:96-97`).
- (b) **recibo con `fecha` NULL** — NO necesita ningún fallo: el barrido
  filtra `.gte('fecha', …)`, un ticket de gasolinera cuya fecha no leyó el OCR
  queda fuera del denominador (`total=0`), y `efectivoDeEsteViaje`
  (`desde_db.ts:82-86`) igual lo resta del previo → el motor afirma el
  excedente completo contra el tope de $0. Reproducido.
- (c) **frontera de año** — recibo del 30-dic-2025 dentro de un viaje cuyo
  `fechaInicio` es de 2026 (o al revés): `anioEjercicio` se ancla a UNA fecha
  (`desde_db.ts:63-66`) y los recibos del otro año quedan fuera del barrido →
  mismo `total=0` → misma nota falsa. Reproducido.

La cifra afirmada no es cierta ni siquiera en el caso degenerado "el año no
tiene diésel": con el recibo ya en la base, un barrido sano SÍ lo cuenta
(`total ≥ monto`), así que `total=0` con diésel en efectivo en el viaje es
siempre señal de "no se pudo medir" — y el motor lo imprime como "tope de $0".

Estado: **abierto**. No hay ninguna prueba con `totalCombustibleEjercicio: 0`
en `engine.test.ts` (grep → cero), y `desde_db.ts` no tiene archivo de prueba
propio: nadie ejercita el catch del fix. El fix de una línea que la ronda 14
recomendó (degradar a `facilidad15=undefined` cuando el barrido falla) es
exactamente lo que este código no hace.

### MEDIO

#### [MEDIO, abierto — cierre incompleto del MEDIO-2 de la ronda 14] "Una sola barrida del ejercicio" sigue siendo DOS barridos con criterios y años que divergen, en el MISMO turno

El commit 8a33ce1 dice "una sola barrida del ejercicio (reusa
getAcumuladoCombustible, best-effort)". El código actual:

- `cuadrar_viaje` corre `computeCuadre` → `desde_db.ts:78`
  `getAcumuladoCombustible(tenantId, anioEjercicio, clavesCombustible)` (con
  claves, año del viaje) **y además** el bloque de periodo en
  `tools.ts:104-105` `getAcumuladoCombustible(ctx.tenantId, ejercicio)` (sin
  claves → `concepto.eq.diesel` a secas, `repo.ts:831`; año del reloj
  `new Date().getUTCFullYear()`). `guardar_liquidacion` vuelve a correr la
  primera vía `computeCuadre`. Un cuadre + cierre = **3 barridos paginados del
  año** (hasta 100 páginas × ~0.3s cada uno), y `presupuesto.ts:40` sigue
  presupuestando `cuadrarDesdeDB` entero en 300ms — sin tocar.

Las dos fuentes siguen pudiendo discrepar en el mismo turno:
- **Criterios**: tenant con `hidrocarburos.claves` (ej. gasolina clave
  15101505, el caso real de gasolineras): el motor y sus notas usan
  claves+diésel; el barrido del periodo usa solo `concepto='diesel'` →
  `evaluarTope15` sobre {0,0} → `estado 'holgado'` → `combustible_efectivo_
  ejercicio` NI SE ADJUNTA (`tools.ts:132`, `estado !== 'holgado'`) mientras el
  motor afirma excedentes no deducibles y le interrumpe al jefe. El contador
  que la spec promete ("te quedan $X antes de perder la deducción") desaparece
  justo cuando el motor dice que el ejercicio ya se pasó.
- **Año**: viaje dic-2025 cerrado en ene-2026 → las notas del motor usan el
  ejercicio 2025 (`desde_db.ts:63-66`, el fix del "ejercicio desde los
  comprobantes" es real pero solo en el motor) y el aviso dice "Diésel en
  efectivo **2026**: te quedan $X" (`avisoTope15`, `aviso.ts:37-47`, año del
  reloj desde `tools.ts:104`). El modelo lee las dos cosas.

Estado: **abierto**.

#### [MEDIO, abierto — nuevo] La nota `combustible_efectivo_dentro15` afirma "deducible por la facilidad del 15%" sobre tickets que el MISMO motor manda a POR CONFIRMAR — y el estatus puede salir 'cuadrada'

`engine.ts:322-330` — la rama `excedenteDeEste === 0` emite
`combustible_efectivo_dentro15` con `monto: 0` y la nota "…**deducible** por la
facilidad del 15% (RFA 2026 regla 2.9)…". Para un ticket de gasolinera SIN
CFDI (el caso más común del mundo real: ticket ≠ factura), `cubetaDe`
(`engine.ts:123`, `!g.cfdiUuid` → `'por_confirmar'`) manda el gasto completo a
`totalPorConfirmar` — y `sin_cfdi` NO se emite porque solo corre si la política
trae `requiereCfdi` (`engine.ts:418-419`). Resultado, reproducido (Z3):
```
estatus: 'cuadrada'   totalPorConfirmar: 1000   totalDeducible: 0
nota: "Combustible pagado en EFECTIVO — deducible por la facilidad del 15% …
      el ejercicio lleva $1,000.00 de $10,000.00 …"
```
El mismo papel dice DEDUCIBLE en la sección de diferencias, POR CONFIRMAR en la
cubeta, y el estatus es verde. Y `combustible_efectivo_dentro15` NO está en
`REVISAR` (`engine.ts:1133` — el fix de la ronda 14 agregó `efectivo_sobre_15`
y `efectivo_no_elegible` pero no este), así que ni siquiera baja a 'revisar' el
dinero que la cubeta no se atreve a llamar deducible. La nota tendría que
condicionar ("deducible por la facilidad, sujeto a CFDI") o ir a
`SOLO_CONTRALOR`-style con su cubeta — hoy se contradice consigo misma.

Estado: **abierto**.

#### [MEDIO, abierto — nuevo] El panel contradice al motor en el tri-estado "sin declarar": `causasDe` pinta una PÉRDIDA que el motor se niega a afirmar

`src/lib/cuadra/fiscal.ts:337` — `push(o.elegible15 === true ?
'combustible_efectivo' : 'efectivo_no_elegible')`: cualquier valor distinto de
`true`, **incluido `undefined` (sin declarar)**, cae en `efectivo_no_elegible`
con `gravedad: 'perdida'` y el detalle "…no es deducible aunque tenga CFDI"
(`fiscal.ts:280-285`) → `montoPerdido` del panel. El motor, para la MISMA
config, produce `combustible_efectivo` (por confirmar, `engine.ts:344-346`,
`totalPorConfirmar`, cubeta `POR_CONFIRMAR` `engine.ts:98`): "sin esa
declaración esto se revisa. No acredita IEPS" — explícitamente NO afirma la
pérdida. La doctrina del doc: "undefined (sin declarar) → por confirmar, nada
se afirma" (`docs/fiscal/rfa-2.9-deber-ser.md` §2).

Escenario: una flota dada de alta sin marcar las casillas —el caso exacto que
la ronda 14 ALTO-3 quiso dejar "sin declarar"— tiene un diésel en efectivo con
CFDI. El motor: `combustible_efectivo`, por confirmar, estatus revisar. El
panel del contador: `efectivo_no_elegible`, **perdida**, "no es deducible
aunque tenga CFDI". Dos veredictos sobre la misma declaración ausente, y el
severo (el que le cuesta dinero al cliente) es el del panel. El fix de la
ronda 14 ("superficies con la elegibilidad: panel, causasDe…") dejó
`causasDe` con el default del lado equivocado.

Estado: **abierto**.

#### [MEDIO, abierto — ronda 12/13/14 reincidente, en producción] El bloque `cache_control` de Anthropic sigue viajando al fallback no-Anthropic del rol `cuadre`

`src/lib/llm/openrouter.ts:666-669` (`sistema` se arma UNA vez desde el modelo
PRIMARIO: `soportaCache = /anthropic\//.test(model)`), :672-674 (`convo` con ese
system), :711-714 (el fallback cambia `activeModel` y reusa `convo`) ·
`models.ts` (FALLBACK `'anthropic/claude-sonnet-5': 'openai/gpt-5.6-terra'`).

Reproducido HOY en HEAD (SDK mockeado):
```
LLAMADA 1 model= anthropic/claude-sonnet-5 system content tipo= object
LLAMADA 2 (fallback) model= openai/gpt-5.6-terra system content=
[{"type":"text","text":"REGLAS FISCALES LARGAS…","cache_control":{"type":"ephemeral"}}]
```
`git diff caae369..HEAD` confirma que `src/lib/llm/` no se tocó: producción
lleva este código desde la ronda 12, con la recomendación de aquella ronda
("resolver antes de la sala") vencida. `cache_prompt.test.ts` sigue cubriendo
solo primario-Anthropic sin fallback, mensajes variables y primario
no-Anthropic — el camino (1)+fallback sigue sin prueba (los tests de fallback
usan el rol `chat`, cuyo primario NO es Anthropic y no genera `cache_control`,
por eso no lo ven). Fix chico y local: `sistema` no puede ser una constante del
primario cuando `activeModel` deja de ser Anthropic.

Estado: **abierto — y desplegado**.

### BAJO

#### [BAJO, abierto — ronda 13, ahora con menos exposición pero cero red] `mensajeParaElModelo` sigue sin cubrir las familias de error reales y sin UNA sola prueba

`tool-executor.ts:82-87` (regex) · :113 (aplicada). El try/catch del ALTO-2
quitó el camino más ruidoso (la consulta del ejercicio ya no lanza), pero los
errores de `saveLiquidacion` (RPC), `getViaje`, `getConfig` siguen pasando por
aquí: `{"code":"PGRST116"}`, `Failed to parse filter (…)`, `function
guardar_liquidacion_tx(…) does not exist`, `lectura incompleta — solo se
leyeron X de Y filas` siguen TODOS crudos hacia el modelo. `grep -rln
"mensajeParaElModelo|VOCABULARIO_POSTGRES" src --include="*.test.ts"` → cero
archivos. Un refactor de la regex no tiene red.

#### [BAJO, abierto — ronda 13, latente] `isTransientError` sigue con falso positivo para 5xx desnudos y decimales con coma

`openrouter.ts:122` (`(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b`). Verificado:
`'el gasto 502 no existe'` → true, `'monto 502,30 excede el tope'` → true.
`openrouter_transitorio.test.ts` sin el número desnudo ni la coma. Inalcanzable
desde el código actual (solo recibe errores del SDK), misma deuda de la 10 a
medias.

#### [BAJO, abierto — ronda 13] Una llamada OCR abortada a mitad de vuelo se asienta como costo $0

`ocr.ts:284` (`costoUsd: u?.cost ?? 0`) · `openrouter.ts:404,411`
(`throwIfAborted`) y :424 (señal al SDK) · `processor.ts:798`. El abort en
vuelo deja `gastado` en 0 y `conGastado` (:467-469) escribe `usage.cost = 0`;
la fila de `llm_costo` se registra con $0 aunque OpenRouter pudo cobrar la
generación en curso. Sin cambio.

#### [BAJO, abierto — ronda 13] Truncamiento + truncamiento nunca prueba el proveedor de respaldo

`openrouter.ts:481-490`: si `eT` también es `TruncatedError`, `throw eT` sale
del ciclo sin mirar el `fallback`. Decisión probada como intencional
(`openrouter_truncado.test.ts`), hueco documentado. Sin cambio.

#### [BAJO, abierto — ronda 13] En el camino "ambos proveedores fallaron", el costo acumulado se etiqueta con el modelo PRIMARIO

`openrouter.ts:467-469` (`err.usage = { model, ...gastado }`). Dinero correcto,
etiqueta por-modelo mentirosa a medias. Sin cambio.

#### [BAJO, abierto — ronda 13] `JSON.stringify(exec.result)` produce `content: undefined` si un handler de éxito devuelve `undefined`

`openrouter.ts:815`. Los tres handlers devuelven objeto hoy; latente.

#### [BAJO, abierto — ronda 13] `ctx.signal` sigue sin consumirse en ningún handler

`grep -n "\.signal" src/lib/cuadra/tools.ts` → cero matches. Documentado en
`tool-executor.ts:19-40`; mitigante activo `acotada()`. Sin cambio.

#### [BAJO, abierto — ronda 13] `generateStructured` gasta un intento pagado en el proveedor muerto antes de cruzar al fallback

`openrouter.ts:494-503`. Deliberado y comentado. Sin cambio.

#### [BAJO, abierto — ronda 13] `registerTool` ante re-registro solo avisa, no falla

`tool-executor.ts:37-39`. Teórico. Sin cambio.

#### [BAJO, abierto — nuevo, residuo del fix] Import muerto `supabaseAdmin` en `desde_db.ts`

`desde_db.ts:9` (`import { supabaseAdmin } …`) quedó sin uso cuando el fix
reemplazó `traerTodo` por `getAcumuladoCombustible` — warning de eslint, cero
efecto funcional, pero es exactamente el tipo de residuo que el refactor de un
camino de dinero no debería dejar.

## Arreglado desde la ronda 14 (verificado en el código actual)

- **ALTO-1 (excedente por comprobante) — CERRADO, con prueba.** `engine.ts:316-
  321`: `previoSinEste`, `cupoRestante = max(0, tope - previoSinEste)`,
  `dentro = min(g.monto, cupoRestante)`, `excedenteDeEste = g.monto - dentro`.
  Reproducido el escenario de la ronda 14 (previo 1400, tope 1500, A=1000,
  B=1000): A=900, B=1000, suma 1900 = excedente real = `totalNoDeducible`, y
  ningún monto de diferencia supera su comprobante. La prueba nueva
  (`engine.test.ts:1455-1471`, 3×$1,000 tope $1,500 → suma $1,500) existe y
  pasa; también la verifiqué con el probe P4 del árbol. La suma ya no depende
  del orden de `input.gastos` (y `getGastos` sigue sin `.order()`, `repo.ts`,
  pero ya no importa para el total).
- **ALTO-2 (crash fail-closed) — cerrado COMO CRASH, con el defecto del ALTO
  nuevo arriba.** El try/catch (`desde_db.ts:76-81`) existe y cumple su primer
  trabajo: un fallo de `getAcumuladoCombustible` ya no tumba `cuadrar_viaje`
  ni `guardar_liquidacion` (verificado por lectura: `logger.warn` y sigue). Lo
  que no cumple es la segunda mitad de su propio comentario — ver ALTO-1 de
  esta ronda.
- **ALTO-3 (alta tri-estado) — CERRADO.** `administracion.ts:110-114`: la
  llave solo se escribe cuando AMBAS condiciones son booleanos explícitos;
  `flotas/page.tsx:37-38,174-181`: checkbox sin marcar → `undefined`, no
  `false`; la edición (`repo.ts:921-932` `actualizarFacilidad15`) borra la
  llave si falta una de las dos; la migración 0083 exige la FORMA de la llave
  (booleans o ausente) y rechaza "sí"/números. Con la llave ausente el motor
  produce `combustible_efectivo` (por confirmar) — el tercer estado funciona
  en el motor y en el alta. Lo que NO funciona es el panel (`causasDe`, MEDIO-3
  de esta ronda).
- **BAJO (efectivo_sobre_15/efectivo_no_elegible fuera de REVISAR) — CERRADO.**
  `engine.ts:1133` incluye ambos; prueba nueva `engine.test.ts:1473-1487`
  (estatus 'revisar' para excede y para no elegible) pasa.
- **Ejercicio desde los comprobantes — CERRADO en el motor, no en el periodo.**
  `desde_db.ts:63-66` ancla en `viaje.fechaInicio` (el caso dic-cerrado-en-ene
  ya no topa contra $0 con consulta sana) — verificado. Pero `tools.ts:104`
  sigue con el reloj del proceso: la mitad del MEDIO-2 de esta ronda.
- **IVA del efectivo negado en el panel — CERRADO y consistente.**
  `fiscal.ts:510-513` (`ivaSostenible` niega IVA al combustible en efectivo, :513),
  mismo estándar que `SIN_ACREDITAMIENTO` del motor (`engine.ts:963,981`).
- **Cierres de la ronda 12 que la 13 y la 14 re-verificaron** — intactos,
  byte-idénticos: `ToolCallRecord.args` auditable, loop-guard antes del
  `Promise.all`, `costoPorModelo`, caché de solo-éxitos, dedup por promesa.

## Lo que revisé y está bien

- **Regla estructural intacta**: `properties: {}` en las tres tools
  (`tools.ts:31,87,146`), handlers que ignoran `_args`, IDs solo desde
  `ToolContext` (`makeExecutor`/`tool-executor.ts:12-45`), `guardar_liquidacion`
  con `isMutation` e idempotencia por promesa. Byte-idéntico a la ronda 14.
- **Las cubetas de la frontera suman el dinero correcto y sin orden**:
  reproducido en 4 configuraciones (2 y 3 comprobantes cruzando la frontera,
  previo distinto): suma de `efectivo_sobre_15` = excedente real =
  `totalNoDeducible`, ningún monto > su comprobante. La proporción usa el
  MISMO mecanismo del tope de alimentación (28-V).
- **Estatus 'revisar' para el dinero no deducible del 15%**: `engine.ts:1133`
  y prueba nueva — el estatus ya no dice "cuadrada" cuando la única diferencia
  es `efectivo_sobre_15`/`efectivo_no_elegible`. (El hueco que queda es el del
  MEDIO-2: `combustible_efectivo_dentro15` sobre ticket sin CFDI.)
- **Tri-estado en el alta y la edición, con la base exigiendo la forma**: el
  "sin declarar" viaja como llave AUSENTE (no como false), la migración 0083
  rechaza el typo, y el motor lo lee como por-confirmar. El seed del demo
  declara `true` explícito (`seed.sql:104-107`).
- **`avisoTope15` con la elegibilidad**: `aviso.ts:28-47` — false → "la flota
  declaró que NO califica", undefined → "sin esa declaración el efectivo sale a
  revisión" (honesto), true → el aviso accionable. Consistente con el motor en
  este archivo (la inconsistencia está en `causasDe`, MEDIO-3).
- **El abort NO dispara fallback** (verificado, idéntico a la 13) y en
  `generateStructured` el reintento con nota muere en el `throwIfAborted()`
  antes de pagar una segunda llamada.
- **Caché de lectura y dedup de mutaciones**: solo éxitos, llave por efecto,
  args originales registrados con el resultado cacheado
  (`openrouter.ts:681-689,795-800`); promesa cacheada con fallo no cacheado
  (`tool_executor_concurrente.test.ts`).
- **Costo real**: `costoReal()`/`calcCost` — proveedor primero, guardas contra
  NaN, nunca 0 en silencio (tests verdes).
- **`finish_reason:'length'` sin tool_calls** no se manda como turno bueno
  (`TruncatedError` envuelto en `PartialExecutionError`).
- Suite del rubro completa verde (74 + 127 + 166 pruebas), `tsc` limpio y
  `eslint` con 0 errores (1 warning: el import muerto de `desde_db.ts`).

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter/Anthropic/OpenAI** — el MEDIO-1 solo
  se zanja con una llamada viva (¿OpenRouter descarta o reenvía `cache_control`
  a un modelo OpenAI?) o con el fix de código. No hice la llamada: cuesta
  dinero y la regla del rubro es solo lectura.
- **Los overrides de Vercel** (`CUADRA_MODEL_CUADRE`, `CUADRA_MODEL_OCR`…): no
  verificables desde el repo. Un override sin entrada en `FALLBACK` apaga el
  plan B en silencio (`openrouter.ts:63-71`).
- **La migración 0083 en la base real**: verificada solo por el commit y por
  lectura del SQL; no ejecuté nada contra la base (regla del rubro).
- **El demo ejecutado**: el seed trae el diésel con `forma_pago '03'`
  (`seed.sql:135`), así que la frontera del 15% no se cruza en la sala y el
  ALTO-1 no se dispara con el sembrado actual — pero no lo corrí.
- **`finish_reason:'length'` con `tool_calls` parcialmente emitidos**: el punto
  ciego de las rondas 9/10/12/13/14 sigue igual, sin prueba que lo amarre.
- **Los `zzz-*` de otros auditores** (`zzz-fiscal-aud15-probe*.test.ts`,
  `zzz-r15-scratch.test.ts`, sin trackear): los leí (sus probes confirman los
  míos) pero no los toqué ni los borré — son de otra mano.
- **`src/lib/cuadra/analytics.ts` aparece modificado en el working tree** — no
  es de esta auditoría (otro rubro trabaja en paralelo); no lo toqué.

## Veredicto

**Green light condicionado para el demo, sin cambios de nota respecto a la
ronda 14.** La regla estructural —el LLM decide CUÁNDO, nunca CON QUÉ DATOS—
está intacta y probada, y las cubetas de la frontera del 15% ya mueven el
dinero correcto e invariante al orden: el ALTO-1 de la ronda 14 (la cifra
acumulada colgada del último ticket) está cerrado con prueba, y el ALTO-3 (el
alta que no podía declarar "sin declarar") está cerrado de verdad con el
tri-estado y la migración 0083. El demo sembrado no cruza la frontera en
efectivo, así que ni el ALTO nuevo ni los MEDIO se disparan en la sala tal como
está sembrado.

Pero el rubro no sube porque el cierre del ALTO-2 de la ronda 14 se hizo con
la forma equivocada y reintroduce la clase de defecto que esa misma ronda
acababa de cazar:

1. **ALTO nuevo: ceros que parecen medición.** El fallo de la consulta del
   ejercicio ya no tumba el cuadre (bien), pero con `facilidad15=true` el
   motor recibe `total=0` y afirma "el excedente de $1,000 NO se deduce …
   contra un tope de $0.00" en el PDF, en el aviso del jefe y en el WhatsApp
   del operador — con TRES disparadores, uno de los cuales (recibo con fecha
   NULL) no necesita ningún fallo. El comentario del fix dice que existe la
   rama "sin datos del ejercicio → revisar" y no existe. Fix chico y probado:
   degradar a `facilidad15=undefined` cuando el barrido no entrega datos (o
   emitir la diferencia `combustible_efectivo` por-confirmar), con una prueba
   para cada disparador (catch, fecha NULL, frontera de año).
2. **MEDIO-2: la "una sola barrida" del commit es falsa** — `tools.ts` sigue
   barriendo el año con criterio distinto (solo diésel, año del reloj) y el
   aviso puede decir "holgado" mientras el motor interrumpe al jefe por
   excedente. Unificar el periodo con `desde_db` (una sola llamada, mismo
   criterio, mismo año) y subir el presupuesto de `cuadrarDesdeDB` en
   `presupuesto.ts`.
3. **MEDIO nuevo: "deducible por la facilidad" sobre tickets sin CFDI** — la
   nota y la cubeta del mismo papel se contradicen, y el estatus puede salir
   'cuadrada' con $1,000 en por-confirmar. Condicionar la nota al CFDI o
   mandar el tipo a `REVISAR`.
4. **MEDIO nuevo: el panel pinta como PÉRDIDA lo que el motor deja "por
   confirmar"** para flotas sin declarar — `fiscal.ts:337` necesita el tercer
   estado (`elegible15 === undefined` → `combustible_efectivo`, en_riesgo).
5. **El MEDIO-1 (`cache_control`) sigue en producción**, reproducido HOY por
   tercera ronda, con la recomendación de la ronda 12 vencida y desplegada.

Recomendación antes de la sala, en orden: (a) fix del ALTO nuevo (una rama +
tres pruebas), (b) unificar el barrido del periodo con `desde_db` y corregir
el presupuesto, (c) el tercer estado en `causasDe`, (d) condicionar la nota
dentro15, (e) MEDIO-1: fix de `sistema` o llamada viva contra OpenRouter. Lo
demás sigue siendo deuda latente, no bloqueante.
