# Tool calling — auditoría 16

**Nota: 6/10** (ronda 15: 6/10). Se atacó y subió en lo puntual — el ALTO de la
ronda 15 (ceros del contador → "excedente contra $0") está cerrado de verdad,
con 3 pruebas y con la rama honesta que su propio comentario prometía; el
tri-estado del panel (`causasDe`) ya no pinta pérdida lo que el motor deja "por
confirmar"; y el año del barrido del periodo ya es el del viaje. Pero la deuda
cobró factura en tres frentes: (1) el cierre del ALTO dejó un HERMANO de la
misma familia sin tocar — `efectivoDeEsteViaje` resta del previo los gastos que
el contador NO contó (otro ejercicio o fecha NULL), el previo llega deflatado y
el motor imprime "el ejercicio lleva $X" con un acumulado que contradice al
propio contador, reproducido HOY con el veredicto volteado (dentro15 → todo el
comprobante no deducible) y sin UNA sola prueba (`desde_db.ts` no tiene archivo
de prueba); (2) las DOS MEDIO de la ronda 15 que el commit no tocó siguen
abiertas — la nota "**deducible** por la facilidad del 15%" sobre tickets sin
CFDI que la misma cubeta manda a por-confirmar (reproducido), y la "una sola
barrida" que sigue siendo DOS con criterios que divergen (reproducido: el motor
marca excedente no deducible mientras el periodo dice 'holgado' y el aviso
desaparece); (3) el MEDIO-1 del `cache_control` cumple CUATRO rondas abierto y
desplegado, con `src/lib/llm/` byte-idéntico desde caae369. Por eso no baja y
no sube: el fallo más caro del turno anterior está bien cerrado, pero el rubro
sigue sin red en el camino que más le cuesta al cliente cuando los datos se
mezclan o faltan.

## Qué se auditó y con qué evidencia

- `git log caae369..HEAD`: 2 commits tocan el rubro — `96f2adc` (fix ronda 15:
  `desde_db.ts` +1, `engine.ts` +24, `fiscal.ts` +8, `repo.ts` +6, `tools.ts`
  +6, `engine.test.ts` +40) y `c901226` (ronda 16, ARCO: `repo.ts`
  `resolverSolicitudArco`, `meta/client.ts` — sin interacción con las tools).
- `git diff caae369..HEAD -- src/lib/llm/` → **VACÍO**: `openrouter.ts`,
  `models.ts`, `tool-executor.ts` intactos desde producción. MEDIO-1 y todos
  los BAJO de la ronda 13 siguen byte-idénticos y desplegados.
- Releídos: `engine.ts` (guard fail-closed :306-328, cubetas :96-137, dentro15
  :347-355, REVISAR :1155, totales :1108-1145), `desde_db.ts` (completo, 121
  líneas), `tools.ts` (los 3 handlers), `periodo/aviso.ts`, `periodo/
  combustible.ts`, `fiscal.ts` (:219-280, :332-345, `ivaSostenible` :506-513),
  `repo.ts` (`getAcumuladoCombustible` :803-866, `actualizarFacilidad15`
  :920-935, `resolverSolicitudArco` :969-1000), `cuadre/resumen.ts`
  (`SOLO_CONTRALOR`), `cierre_aviso.ts` (:140-148), `presupuesto.ts` (:38-50),
  `llm/openrouter.ts` (:655-720, :795-820), `tool-executor.ts` (:1-60),
  `seed.sql` (:104-107, :145), `supabase/seed.sql` gastos del demo.

Corridas propias:

```
$ npx vitest run src/lib/llm/            → 16 archivos, 73 pruebas, 0 fallos
$ npx vitest run engine.test.ts fiscal.test.ts aviso combustible
                                          → 4 archivos, 195 pruebas, 0 fallos
$ npx vitest run tools_cableado processor_cadena cierre_aviso resumen
                                          → 67 pruebas, 0 fallos
$ npx tsc --noEmit -p .                   → limpio
$ npx eslint (llm + tools + cuadre + fiscal + repo + periodo)
                                          → 0 errores, 1 warning:
      desde_db.ts:9 'supabaseAdmin' importado y sin usar
```

Reproducciones propias (probes temporales `zzz-aud16-*.test.ts`, borrados al
terminar; en el árbol quedan `aud16-probe.test.ts` y `zzz-a16-probe.test.ts`
de OTRO auditor — el segundo reproduce independientemente el hallazgo ALTO de
esta ronda, no los toqué):

1. **ALTO nuevo — previo contaminado por gasto de otro ejercicio** (motor puro,
   simulando exactamente la resta de `desde_db.ts`): contador 2026 con
   `efectivo=2000` (de otras liquidaciones), viaje con G1 (2026, $1,000) y G2
   (2025, $1,000). `efectivoDeEsteViaje` resta ambos → previo que recibe el
   motor = $1,000 en vez de $2,000 → G1 sale "excedente de $500 NO se deduce"
   cuando su excedente real es $1,000, y la nota imprime "el ejercicio lleva
   $2,000.00" cuando el contador midió $3,000. Con el previo en la frontera el
   veredicto se VOLTEA: previo real $8,000 (excedido) vs previo contaminado
   $6,500 (dentro del tope) → "deducible por la facilidad" cuando la verdad es
   "todo no deducible".
2. **Mismo efecto con recibo sin fecha** (el caso (b) de la ronda 15, a medias):
   `fecha: null` → el contador lo excluye (`.gte('fecha', …)`) pero
   `efectivoDeEsteViaje` lo resta igual → misma deflación. El guard del fix
   trata `fecha: null` como "mismo ejercicio" (`mismoEjercicio = !anioComprobante
   || …`), así que NO lo manda a por-confirmar: lo evalúa contra un contador que
   no lo contiene.
3. **MEDIO reincidente — nota dentro15**: ticket sin CFDI, `facilidad15=true`,
   contador sano → `combustible_efectivo_dentro15` con nota "**deducible** por
   la facilidad del 15%", `totalDeducible: 0`, `totalPorConfirmar: 1000` — el
   mismo papel dice DEDUCIBLE y POR CONFIRMAR a la vez.
4. **MEDIO reincidente — dos barridos**: tenant con `claves=['15101505']`, gasto
   `concepto='varios', claveProdServ='15101505'` → el motor (con claves) marca
   `efectivo_sobre_15` (excedente no deducible); el periodo (`tools.ts:109`, sin
   claves) cuenta solo `concepto='diesel'` → `{0,0}` → 'holgado' → aviso null.
5. **Fail-closed del ALTO ronda 15 — VERIFICADO en los 3 disparadores**: (a)
   contador caído → total 0 → `combustible_efectivo` por-confirmar, nota "no se
   pudo calcular", sin "NO se deduce"; (b) gasto de otro ejercicio → por
   confirmar "se revisa aparte"; (c) la nota del total-0 no promete deducción.
   Las 3 pruebas nuevas (`engine.test.ts:1523-1565`) existen y pasan.

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools
(`tools.ts:32,87,146`), IDs solo desde el `ToolContext` resuelto en servidor,
handlers que ignoran `_args`, `guardar_liquidacion` con `isMutation` e
idempotencia por promesa— sigue intacta y byte-idéntica. Las cubetas de la
frontera del 15% mueven el dinero correcto cuando el contador está sano y el
viaje es de un solo ejercicio (re-producido: la suma por comprobante cuadra con
`totalNoDeducible` y es invariante al orden).

### ALTO

#### [ALTO, abierto — nuevo. El cierre del ALTO de la ronda 15 tapó el brazo "total=0" y dejó intacto el brazo del PREVIO: los gastos que el contador no contó se restan igual, y el motor imprime un acumulado del ejercicio que contradice al propio contador]

`src/lib/cuadra/cuadre/desde_db.ts:84-87` — `efectivoDeEsteViaje` filtra por
`formaPago==='01'` y por criterio de combustible, pero NO por el año del
ejercicio ni por `fecha`:

```
const efectivoDeEsteViaje = gastos
  .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
  .reduce((s, g) => s + Number(g.monto ?? 0), 0);
const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
```

El contador (`repo.ts:833-835`) cuenta SOLO los gastos con
`fecha ∈ [anio-01-01, anio-12-31]`; `efectivoDeEsteViaje` resta TODOS los del
viaje. Cualquier gasto que el contador excluyó —otro ejercicio (frontera de
año) o `fecha: null` (el OCR no la leyó; `repo.ts:142` la inserta como NULL)—
deflata `efectivoPrevEjercicio`. El guard nuevo del motor (`engine.ts:312-313`,
`mismoEjercicio = !anioComprobante || anioComprobante === input.anioEjercicio`)
manda el gasto de otro ejercicio a por-confirmar, pero su efecto sobre el previo
de los gastos del MISMO ejercicio permanece: es la misma clase de ceguera que
la ronda 15 cazó en el denominador, ahora en el numerador previo.

Escenario con valores (reproducido HOY, dos veces):
- Viaje con `fechaInicio` 2026-01-02. El contador 2026 midió
  `efectivo=2000` (otras liquidaciones) y `total=10000`. El viaje trae G1
  (diésel efectivo con CFDI, 2026, $1,000) y G2 (diésel efectivo con CFDI,
  2025-12-20, $1,000) — un viaje que cruzó año, el caso normal de un flete que
  salió antes de Año Nuevo.
- `efectivoDeEsteViaje = 2000` (resta G1 y G2) → `efectivoPrevEjercicio =
  2000 − 2000 = 0`; el previo REAL es `2000 − 1000(G1) = 1000`.
- El motor evalúa G1 con previo 0: `acumulado = 1000`, tope `1500`, cupo
  `1500` → **dentro15, "deducible por la facilidad"** (`engine.ts:347-348`).
  Con el previo real (1000): `acumulado = 2000`, cupo `500`, excedente `500` →
  "el excedente de $500 NO se deduce". En la frontera el veredicto se voltea
  completo: previo real 8000 vs contaminado 6500 → "todo deducible" cuando la
  verdad es "todo no deducible".
- Variante fecha NULL (el caso (b) de la ronda 15, a medias): G1 con
  `fecha: null` no entra al contador, pero `mismoEjercicio = !anioComprobante`
  lo trata como del ejercicio y lo evalúa contra un tope cuyo denominador no lo
  contiene — y su resta del previo contamina a los demás.
- La nota impresa (`engine.ts:348` y :354) es la cifra falsa: "el ejercicio
  lleva $X de $Y" con un acumulado que contradice lo que el contador midió, en
  el PDF, en el WhatsApp del operador y en lo que lee el modelo (`tools.ts:
  96-97`).

El comentario del propio fix lo reconoce a medias: `desde_db.ts:65` dice "los
gastos sin fecha no pueden anclar" (el ancla del año) — pero la resta del
previo tampoco los puede contar, y los cuenta.

Estado: **abierto**. `desde_db.ts` no tiene archivo de prueba (verificado:
`ls src/lib/cuadra/cuadre/*.test.ts` → no hay `desde_db.test.ts`); las 3
pruebas nuevas del ALTO inyectan el input AL MOTOR, ninguna ejercita la resta
de `efectivoDeEsteViaje`. El probe de otro auditor (`zzz-a16-probe.test.ts`,
sin trackear) reproduce el mismo hallazgo de forma independiente. Fix chico y
probable: filtrar `efectivoDeEsteViaje` por el mismo rango de fecha del
contador (o, más simple, por `anioEjercicio`), con una prueba para cada
disparador (gasto de otro año, fecha NULL, mezcla).

### MEDIO

#### [MEDIO, abierto — ronda 15 sin tocar] La nota `combustible_efectivo_dentro15` sigue afirmando "deducible por la facilidad del 15%" sobre tickets que la MISMA cubeta manda a POR CONFIRMAR

`engine.ts:347-348` — la rama `excedenteDeEste === 0` emite
`combustible_efectivo_dentro15` con la nota "**deducible** por la facilidad del
15%…". Para un ticket de gasolinera SIN CFDI (el caso más común del mundo
real), `cubetaDe` (`engine.ts:135`, `!g.cfdiUuid → 'por_confirmar'`) manda el
gasto completo a `totalPorConfirmar`. Reproducido HOY:
```
tipo: combustible_efectivo_dentro15
nota: "…deducible por la facilidad del 15% (RFA 2026 regla 2.9): el ejercicio
      lleva $1,000.00 de $10,000.00 de combustible en efectivo (10% del total,
      tope 15%)…"
totalPorConfirmar: 1000   totalDeducible: 0
```
El mismo papel dice DEDUCIBLE en la sección de diferencias y POR CONFIRMAR en
la cubeta, y el tipo sigue fuera de `REVISAR` (`engine.ts:1155`) y fuera de
`NO_DEDUCIBLE_ISR`/`POR_CONFIRMAR` (`engine.ts:100-101`): con el anticipo
ajustado el estatus sale 'cuadrada' con $1,000 en por-confirmar. El commit de
la ronda 15 no tocó esta rama. La nota tendría que condicionar ("sujeto a
CFDI") o el tipo entrar a `REVISAR`.

Estado: **abierto**.

#### [MEDIO, abierto — ronda 15 a medias] La "una sola barrida" sigue siendo DOS barridos con criterios que divergen: el motor marca excedente no deducible mientras el periodo dice 'holgado' y el aviso desaparece

El commit 96f2adc alineó el AÑO (`tools.ts:107-108` ahora ancla al viaje) pero
no el CRITERIO: `tools.ts:109` llama `getAcumuladoCombustible(ctx.tenantId,
ejercicio)` SIN claves (`repo.ts:831` → `concepto.eq.diesel` a secas), mientras
`desde_db.ts:78` la llama CON las claves del SAT. Reproducido HOY:

- Tenant con `hidrocarburos.claves=['15101505']`; gasto `concepto='varios'`,
  `claveProdServ='15101505'`, efectivo $1,000, contador 2026 `efectivo=9000`,
  `total=10000` → el motor: `efectivo_sobre_15` (excedente no deducible,
  interrumpe al jefe, `cierre_aviso.ts:146` 'decision'). El periodo: el gasto
  no es `concepto='diesel'` → acumulado `{0,0}` → `evaluarTope15` → 'holgado'
  → `avisoTope15` devuelve null → el "te quedan $X antes de perder la
  deducción" que la spec promete desaparece justo cuando el motor afirma el
  excedente.

Y el conteo de barridos no cambió: un cierre completo corre `cuadrar_viaje`
(`computeCuadre` con claves + periodo sin claves) y `guardar_liquidacion`
(`computeCuadre` otra vez) = **3 barridos paginados del año** (hasta 100 páginas
× ~0.3s cada uno), con `presupuesto.ts:40` presupuestando `guardiaCifras →
cuadrarDesdeDB` entero en 300ms — sin tocar. Además, `tools.ts:107` vuelve a
pedir `getViaje` que `computeCuadre` ya trajo.

Estado: **abierto** (la mitad del año cerrada, la mitad del criterio no).

#### [MEDIO, abierto — ronda 12/13/14/15 reincidente, en producción] El bloque `cache_control` de Anthropic sigue viajando al fallback no-Anthropic del rol `cuadre`

`src/lib/llm/openrouter.ts:666-669` (`sistema` se arma UNA vez desde el modelo
PRIMARIO: `soportaCache = /anthropic\//.test(model)`), :672-674 (`convo` con ese
system), :711-714 (el fallback cambia `activeModel` y reusa `convo` con ese
`system`). `git diff caae369..HEAD -- src/lib/llm/` vacío: producción lleva
este código desde la ronda 12. `cache_prompt.test.ts` sigue sin cubrir el
camino primario-Anthropic → fallback no-Anthropic; los tests de fallback usan
el rol `chat`, cuyo primario no es Anthropic. La recomendación de la ronda 12
("resolver antes de la sala") lleva 4 rondas vencida y desplegada. Fix chico:
`sistema` no puede ser constante del primario cuando `activeModel` deja de ser
Anthropic.

Estado: **abierto — y desplegado**.

### BAJO

#### [BAJO, abierto — nuevo] El tri-estado del 15% arreglado en la ronda 15 NO tiene UNA sola prueba

`fiscal.ts:337-339` (`if (o.elegible15 === false) push('efectivo_no_elegible');
else push('combustible_efectivo')`) y el recuadro tri-estado del panel
(`dashboard/contador/combustible/page.tsx:155-166`) cambiaron en 96f2adc, y
`grep -rln "elegible15: false\|elegible15: undefined" src --include="*.test.*"`
→ **cero archivos**. `fiscal.test.ts` usa `OPTS.elegible15: true` en TODOS sus
tests; ninguna prueba pisa `false` (pérdida) ni `undefined` (en_riesgo, el caso
que la ronda 15 cerró). El motor tiene 3 pruebas nuevas; la mitad panel del
mismo fix no tiene ninguna — el default del lado equivocado que la ronda 15
cazó podría volver sin que ninguna prueba se entere.

#### [BAJO, abierto — nuevo, residuo del fix] La nota del guard puede imprimir "la facilidad se mide contra el ejercicio undefined"

`engine.ts:312-318`: si un llamador pasa `facilidad15: true` sin `anioEjercicio`
y con un gasto con fecha, `mismoEjercicio = false` y la nota sale "este
comprobante es de 2026 y la facilidad se mide contra el ejercicio undefined".
Hoy inalcanzable desde producción (`desde_db.ts` siempre lo pasa; el demo no
declara facilidad15) — pero es exactamente el tipo de texto que el motor puro
no debería poder emitir. Un default honesto (`input.anioEjercicio ?? 'el
ejercicio'`) o un guard que trate `undefined` como "sin dato" lo cerraría.

#### [BAJO, abierto — ronda 13, ahora con un disparador menos pero cero red] `mensajeParaElModelo` sigue sin cubrir las familias de error reales y sin UNA sola prueba

`tool-executor.ts:82-87` (regex) · :113 (aplicada). El guard del ALTO quitó el
camino más ruidoso del contador, pero los errores de `saveLiquidacion` (RPC),
`getViaje`, `getConfig` siguen pasando por aquí: `{"code":"PGRST116"}`,
`function guardar_liquidacion_tx(…) does not exist`, `lectura incompleta — solo
se leyeron X de Y filas` crudos hacia el modelo. `grep -rln
"mensajeParaElModelo|VOCABULARIO_POSTGRES" src --include="*.test.ts"` → cero.
Sin red, como en la 13.

#### [BAJO, abierto — ronda 13, latente] `isTransientError` sigue con falso positivo para 5xx desnudos y decimales con coma

`openrouter.ts:122` (`(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b`). `'el gasto 502 no
existe'` → true; `'monto 502,30 excede el tope'` → true. Inalcanzable desde el
código actual (solo recibe errores del SDK), misma deuda.

#### [BAJO, abierto — ronda 13] Una llamada OCR abortada a mitad de vuelo se asienta como costo $0

`ocr.ts:284` (`costoUsd: u?.cost ?? 0`) · `openrouter.ts:404,411`
(`throwIfAborted`) y :424. El abort en vuelo deja `gastado` en 0 y la fila de
`llm_costo` se registra con $0 aunque OpenRouter pudo cobrar. Sin cambio.

#### [BAJO, abierto — ronda 13] Truncamiento + truncamiento nunca prueba el proveedor de respaldo

`openrouter.ts:481-490`: si `eT` también es `TruncatedError`, `throw eT` sale
del ciclo sin mirar el `fallback`. Decisión probada como intencional, hueco
documentado.

#### [BAJO, abierto — ronda 13] En "ambos proveedores fallaron", el costo se etiqueta con el modelo PRIMARIO

`openrouter.ts:467-469` (`err.usage = { model, ...gastado }`). Dinero correcto,
etiqueta mentirosa a medias.

#### [BAJO, abierto — ronda 13] `JSON.stringify(exec.result)` produce `content: undefined` si un handler de éxito devuelve `undefined`

`openrouter.ts:815`. Los tres handlers devuelven objeto hoy; latente.

#### [BAJO, abierto — ronda 13] `ctx.signal` sigue sin consumirse en ningún handler

`grep -n "\.signal" src/lib/cuadra/tools.ts` → cero. Mitigante activo
`acotada()`, documentado en `tool-executor.ts:19-40`.

#### [BAJO, abierto — ronda 13] `generateStructured` gasta un intento pagado en el proveedor muerto antes del fallback

`openrouter.ts:494-503`. Deliberado y comentado.

#### [BAJO, abierto — ronda 13] `registerTool` ante re-registro solo avisa, no falla

`tool-executor.ts:37-39`. Teórico.

#### [BAJO, abierto — ronda 15, residuo del fix] Import muerto `supabaseAdmin` en `desde_db.ts`

`desde_db.ts:9` — warning de eslint, cero efecto funcional, mismo residuo que
la ronda 15 reportó.

## Arreglado desde la ronda 15 (verificado en el código actual)

- **ALTO (ceros del contador → "excedente contra $0") — CERRADO, con prueba.**
  `engine.ts:306-328`: el guard `!mismoEjercicio || !(total > 0)` emite
  `combustible_efectivo` (por confirmar, `monto: 0`) con nota honesta — "no se
  pudo calcular el total de combustible del ejercicio (el contador no
  respondió) — la facilidad del 15% (RFA 2026 regla 2.9) no se evaluó. No se
  afirma deducible ni no deducible" — para los tres disparadores de la ronda
  15: consulta caída (total 0), gasto de otro ejercicio ("se revisa aparte") y
  el caso degenerado "todo el viaje sin fecha" (total 0). Verificado por
  reproducción y por las 3 pruebas nuevas (`engine.test.ts:1523-1565`): el
  efectivo va a `totalPorConfirmar`, nunca a `totalNoDeducible`, y la nota no
  promete deducción. El comentario del fix ya NO miente: la rama honesta existe
  y corre para `facilidad15=true`. Lo que NO cubre es el brazo del previo — el
  ALTO nuevo de esta ronda.
- **MEDIO (el panel pintaba PÉRDIDA lo que el motor deja "por confirmar") —
  CERRADO en código, sin prueba.** `fiscal.ts:337-339`: solo `elegible15 ===
  false` cae en `efectivo_no_elegible` (perdida); `undefined` y `true` caen en
  `combustible_efectivo` (en_riesgo) — consistente con el motor (`engine.ts:
  359-366`). El recuadro del panel (`page.tsx:155-166`) honra el tri-estado.
  Verificado por lectura y por el comportamiento del motor; la falta de prueba
  es el BAJO-1 de esta ronda.
- **MEDIO-2 (año del barrido) — CERRADO a medias.** `tools.ts:107-108` ya ancla
  al año del viaje (mismo ancla que `desde_db.ts:63-66`); el criterio sigue
  divergiendo — ver MEDIO-2 de esta ronda.
- **MEDIO (actualizarFacilidad15 sin comprobar el error de lectura) — CERRADO.**
  `repo.ts:923-926`: `if (errLee) throw` — un bache de red ya no se lee como
  "la flota no tiene config" y ya no reemplaza la config entera por una llave.
- **ALTO-1 ronda 14 (excedente por comprobante) — intacto y probado.**
  `engine.ts:334-355`: `previoSinEste`, `cupoRestante`, `dentro`,
  `excedenteDeEste`; suma de la columna = `totalNoDeducible`, invariante al
  orden. Re-verificado por lectura (la ronda 15 ya lo reprodujo; el guard nuevo
  no lo altera para el caso sano).
- **ALTO-3 ronda 14 (alta tri-estado) + migración 0083 — intactos.** El
  tri-estado viaja como llave ausente, la migración exige la forma; sin cambios
  desde la ronda 15.
- **BAJO ronda 14 (`efectivo_sobre_15`/`efectivo_no_elegible` fuera de REVISAR)
  — CERRADO y vigente.** `engine.ts:1155` incluye ambos; el estatus de esos
  veredictos es 'revisar' (verificado por las pruebas v15g/v15h que pasan).
- **`ivaSostenible` niega IVA al combustible en efectivo — intacto.**
  `fiscal.ts:510-513`.
- **El demo no cruza la frontera**: `seed.sql:106` declara `facilidad15=true`
  pero el CFDI del demo (`seed.sql:145`) es `FormaPago="03"` y todo es 2026 —
  ni el ALTO nuevo ni las MEDIO se disparan con el sembrado actual.

## Lo que revisé y está bien

- **Regla estructural intacta**: `properties: {}` en las tres tools
  (`tools.ts:32,87,146`), handlers que ignoran `_args`, IDs solo desde
  `ToolContext` (`tool-executor.ts:12-45`), `guardar_liquidacion` con
  `isMutation` e idempotencia por promesa, snapshot `liq` viajando con el
  resultado. Byte-idéntico a la ronda 15.
- **El fail-closed honesto funciona en las superficies**: `combustible_efectivo`
  → 'panel' (`cierre_aviso.ts:144`, no interrumpe al jefe con un veredicto que
  no se pudo calcular), visible en el PDF y en el WhatsApp del operador
  (`resumen.ts` — no está en `SOLO_CONTRALOR`) con la nota honesta; el
  `efectivo_sobre_15` real sigue siendo 'decision' (:146).
- **Las cubetas suman el dinero correcto en el caso sano**: `cubetaDe` única y
  exportada (`engine.ts:118-137`), `totalPorConfirmar` incluye el gasto
  completo del fail-closed vía `POR_CONFIRMAR` (`engine.ts:101`), y el estatus
  del fail-closed es 'revisar' (`combustible_efectivo` está en `REVISAR`).
- **`getAcumuladoCombustible` fail-closed de lectura**: `repo.ts:861-865` —
  `leidas < esperadas` lanza y se dice, no devuelve medio acumulado. El try/
  catch de `desde_db.ts:76-81` existe y cumple su primer trabajo (no tumba el
  cuadre) — lo que falta es el filtro del previo (ALTO nuevo).
- **Cierre del turno**: las 3 pruebas nuevas del ALTO existen, corren y
  cubren total-0, otro-ejercicio y la nota honesta; la suite del rubro verde
  (73 + 195 + 67), `tsc` limpio, `eslint` 0 errores.
- **Caché y dedup**: solo éxitos, llave por efecto, args originales registrados
  con el resultado cacheado; promesa cacheada con fallo no cacheado — sin
  cambios, intacto.
- **`costoReal()`/`calcCost`**: proveedor primero, guardas contra NaN — sin
  cambios.
- **El seed del demo**: `facilidad15=true` declarado, pero diésel en `forma_pago
  '03'` y fechas 2026 — la frontera del 15% no se cruza en la sala.

## Lo que NO alcancé a revisar

- **Nada contra la API real de OpenRouter/Anthropic/OpenAI** — el MEDIO-1 solo
  se zanja con una llamada viva o con el fix de código. No hice la llamada:
  cuesta dinero y la regla del rubro es solo lectura.
- **El flujo ARCO de la ronda 16** (`resolverSolicitudArco`/`enviarRespuestaArco`,
  `repo.ts:969-1000`, `meta/client.ts:433-482`): lo leí solo para confirmar que
  no interactúa con las tools del agente (no lo hace — es un server action sin
  LLM). El detalle fino (plantilla `respuesta_arco`, ventana de 24h, el
  parámetro {{1}} que el código llena con el literal 'la flota' en vez de la
  razón social que el comentario promete) es del rubro legal/backend; no lo
  dictaminé aquí.
- **La migración 0083 en la base real**: verificada por lectura del SQL y del
  commit; no ejecuté nada contra la base (regla del rubro).
- **Los overrides de Vercel** (`CUADRA_MODEL_CUADRE`, `CUADRA_MODEL_OCR`…): no
  verificables desde el repo; un override sin entrada en `FALLBACK` apaga el
  plan B en silencio.
- **`finish_reason:'length'` con `tool_calls` parcialmente emitidos**: el punto
  ciego de las rondas 9/10/12/13/14/15 sigue igual, sin prueba que lo amarre.
- **El demo ejecutado**: no lo corrí; el sembrado no cruza la frontera del 15%
  (ver arriba), así que el ALTO nuevo y las MEDIO no se disparan en la sala tal
  como está sembrado — pero no lo verifiqué ejecutándolo.
- **Los `zzz-*` de otros auditores** (`aud16-probe.test.ts`,
  `zzz-a16-probe.test.ts`, sin trackear): los leí —el segundo corrobora el ALTO
  de esta ronda— y no los toqué ni los borré.

## Veredicto

**Green light condicionado para el demo, nota sin movimiento: 6/10.** El ALTO
de la ronda 15 —la cifra fiscal falsa más cara del turno— está cerrado de
verdad, con la rama honesta que su comentario prometía y 3 pruebas que la
amarran; el tri-estado del panel ya no contradice al motor; el año del barrido
ya es el del viaje. Eso es progreso real y verificado.

Pero el rubro no sube, por tres deudas que esta ronda hace visibles:

1. **El cierre del ALTO dejó un hermano de la misma familia.** El guard tapó
   el denominador (total=0 → por confirmar) y dejó destapado el numerador
   previo: `efectivoDeEsteViaje` resta los gastos que el contador no contó, el
   previo llega deflatado, y el motor imprime "el ejercicio lleva $X" contra el
   propio contador — con el veredicto capaz de voltearse (deducible ↔ no
   deducible) en la frontera del tope. Sin archivo de prueba para `desde_db.ts`
   y sin una sola prueba del brazo del previo. Fix chico: filtrar
   `efectivoDeEsteViaje` por el rango del ejercicio.
2. **Las dos MEDIO de la ronda 15 que el commit no tocó siguen abiertas**: la
   nota "deducible por la facilidad" sobre tickets sin CFDI (el papel se
   contradice solo, estatus 'cuadrada' posible) y la "una sola barrida" que
   sigue siendo dos barridos con criterios divergentes (motor excedido + aviso
   ausente, reproducido).
3. **El MEDIO-1 (`cache_control`) cumple cuatro rondas abierto y desplegado**,
   con `src/lib/llm/` byte-idéntico desde caae369.

Recomendación antes de la sala, en orden: (a) el filtro del previo en
`desde_db.ts` con sus pruebas (incluida la frontera de año y la fecha NULL), (b)
unificar el barrido del periodo con las claves del SAT y corregir el
presupuesto, (c) condicionar la nota dentro15 al CFDI o mandar el tipo a
`REVISAR`, (d) pruebas del tri-estado del panel, (e) el fix de `sistema` del
MEDIO-1 o la llamada viva contra OpenRouter. El demo, tal como está sembrado,
no cruza ninguna de estas fronteras: no bloquea la sala.
