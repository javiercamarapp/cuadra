# Sistema agéntico y orquestación — auditoría 13

**Nota: 8/10** (movimiento: 7 → 9 en la re-auditoría de la 12, y ahora los
cuatro cierres de código de la ronda 12 se verificaron uno a uno contra el
código ACTUAL — están, y funcionan en su escenario exacto; sube de 7 a 8 como
nota de ronda). No es un 9 porque la mirada más profunda de esta ronda encontró
**una regresión real introducida por el propio fix de la ronda 12** y **tres
cierres parciales de la misma ronda**:

- **regresión**: el fix de `guardiaEstado` (`6e133b8`) prometía saltarse "la
  negación PEGADA AL VERBO" y la implementación salta la oración ENTERA si
  contiene cualquier "no" — una mentira de cierre con reaseguramiento ("Ya
  quedó cerrada tu liquidación, no te preocupes") pasa intacta. En la ronda 11
  ese mismo texto SÍ se cazaba (probado contra `6e133b8^`).
- **cierres parciales**: la pregunta SIN "¿" (el caso de la ronda 12 tenía "¿"
  y por eso el fix pasó), los cardinales 1-10 y "diez" (el commit documenta
  "11-99 + centenas + mil" — la frontera es arbitraria: "once" marca, "diez"
  no), y el futuro en "-amos" con marcadores fuera de la lista ("En un momento
  cerramos tu liquidación" se tacha igual que la ronda 12 acusaba "mañana").
- además, la puerta trasera de la ronda 7 (consulta de política como
  salvoconducto) sigue abierta por la vía del cotejo: un cardinal en palabras
  ("ochocientos") que coincida numéricamente con un número de la política
  pasa el cotejo entero.

Ninguno de los hallazgos toca el camino feliz del demo (foto → "listo" →
cuadre → PDF): ese texto lo escribe `resumenCuadre` del motor y la guardia de
cifras lo reemplaza SIEMPRE que hubo `cuadrar_viaje`/`guardar_liquidacion`,
apagando a las otras dos guardias a propósito (`processor.ts:2005,2027`). Todos
los hallazgos operan sobre turnos de conversación SIN tool de cuadre — la
deuda real del rubro, no el riesgo de la sala.

> Método: leí línea por línea `fundamento.ts`, `cifras.ts`, `estado_afirmado.ts`,
> `guardia.ts`, `resumen.ts`, `tools.ts`, `tool-executor.ts`, `openrouter.ts`
> (loop-guard), `run.ts`, `presupuesto.ts`, `conv.ts` y las zonas agénticas de
> `processor.ts` (1,560-2,235) y `huerfanos.ts`. Cada hallazgo se **probó** con
> un probe temporal (`src/lib/zzz-audit13-agentico.test.ts` + un script tsx,
> borrados al terminar), no solo se razonó. Los cierres de la ronda 12 se
> verificaron contra el diff de sus commits y re-ejecutando sus escenarios
> exactos. Suites del rubro en verde (127 + 35 pruebas), `tsc --noEmit` y
> `eslint` limpios sobre los archivos del rubro. Sha: `caae369`.

## Los cierres de la ronda 12 — verificados, siguen cerrados

| Hallazgo ronda 12 | Estado | Cómo se verificó hoy |
|---|---|---|
| **[ALTO]** memoria de fundamento solo evaluaba la PRIMERA oración con la cita | Cerrado | `fundamento.ts:281` — `citaEsMismoTema` ahora evalúa TODAS las oraciones con `.every()`. Probado el escenario exacto del auditor con el orden invertido (diésel legítimo delante, caseta inválida detrás): la cita de la caseta se quita (`fundamento_ronda9.test.ts` en verde). Nota de comportamiento: el veto es todo-o-nada — ver el BAJO nuevo abajo. |
| **[MEDIO]** el suavizado de "obligación" invertía negaciones | Cerrado | `fundamento.ts:508-513` — `reescribirSalvoNegacion` con ventana de 60 chars. Probados los escenarios exactos: "No estás obligado a facturar en 72 horas, pero conviene hacerlo." intacto; "No es obligatorio facturar en 72 horas." intacto; "Estás obligado a facturar en 72 horas." → "conviene facturar en 72 horas."; "Es obligatorio facturar en 72 horas." → "es lo recomendable facturar en 72 horas.". |
| **[MEDIO]** `guardiaEstado` tachaba negaciones, preguntas y futuro | Cerrado para los 5 casos probados | `estado_afirmado.ts:125-152` — oración por oración, con salto de interrogativa (solo "¿"), negación y futuro "-amos". Los 5 casos del test de la ronda 12 pasan. Quedan los residuales: negación de oración ENTERA (MEDIO, regresión), pregunta sin "¿" (MEDIO) y "-amos" con marcadores fuera de la lista (BAJO). |
| **[MEDIO]** el portón de cifras no detectaba cardinales sueltos | Cerrado para 11-99/centenas/mil | `cifras.ts:41-46` — `CARDINAL_SUELTO`; los 5 casos del test pasan. Quedan: 1-10/"diez" (MEDIO) y el falso positivo "a las once" (BAJO). |
| **[BAJO]** comentarios de `conv.ts` que contradecían los defaults | Cerrado | `conv.ts:560-562` dice "default 20s — NO 60s" (código: `|| 20_000`) y `:586-591` "Default 2s" (código: `|| 2_000`) — consistentes. Queda el residual del valor 0 inalcanzable (BAJO nuevo). |
| **[BAJO]** `ctx.signal` desconectado de los handlers | Abierto (documentado) | `tool-executor.ts:27-40` — igual que lo dejó la ronda 12; cambio de rubro backend, superficie ~19 funciones de `repo.ts`. El mitigante (`acotada`, 8s por consulta) sigue activo. |
| **[BAJO]** rama `real.cerro` del reemplazo = código muerto | Abierto (sin fix, defensivo) | `estado_afirmado.ts:172-175` — el único llamador (`processor.ts:2034`) pasa `entrego: closed ? 'pendiente' : false`, así que `real.cerro === true` ⇒ `motivos` vacío ⇒ la primera rama del ternario nunca se toma. Igual que lo dejó la ronda 12. |

## Hallazgos nuevos de esta ronda — verificados con prueba propia

### [MEDIO] `guardiaEstado`: el salto por negación es de ORACIÓN ENTERA — una mentira de cierre con "no" accesorio pasa intacta (regresión introducida por el fix de la ronda 12)
`src/lib/cuadra/cuadre/estado_afirmado.ts:141` (`if (NEGACION.test(oracion) && !AFIRMA_NEGANDO.test(oracion)) continue;`)

El comentario del propio fix (`:136-140`) dice que se salta "una negación
PEGADA AL VERBO ('no quedó cerrada')". La implementación salta la oración si
contiene **cualquier** "no" en **cualquier** posición. Probado:

```
guardiaEstado("Ya quedó cerrada tu liquidación, no te preocupes. En un momento te llega el PDF.",
              { cerro: false, entrego: false })
→ { reply: <idéntico>, forzado: false }   ❌
```

El turno NO cerró (`cerro: false`) y el modelo afirma el cierre con su
reaseguramiento natural — exactamente la clase que la guardia existe para
cazar. Contra `6e133b8^` (ronda 11) el mismo texto SÍ se cazaba: el patrón 1
(`qued[óo]…cerrad`) corría sobre el reply completo sin salto de negación. El
fix abrió el hueco que cerró. Variante igualmente plausible: "Tu liquidación
quedó cerrada, no tienes que hacer nada más." — también pasa. La doctrina del
archivo tolera el falso negativo ("se prefiere el segundo error"), pero el
prometido era "negación pegada al verbo": un `no\b[^.!?]{0,20}?(?:qued|está|…)`
habría cumplido la promesa sin abrir el hueco.

**Estado: abierto (regresión de `6e133b8`).**

### [MEDIO] `guardiaEstado`: la pregunta SIN "¿" (estilo WhatsApp) se tacha como afirmación consumada — cierre parcial de la ronda 12
`src/lib/cuadra/cuadre/estado_afirmado.ts:127` (`const PREGUNTA = /¿/;`) · `:135` (`if (PREGUNTA.test(oracion)) continue;`)

El signo de apertura "¿" es el que se cae en WhatsApp mexicano con
naturalidad. Probado:

```
guardiaEstado("Ya quedó cerrada mi liquidación?", { cerro: false, entrego: false })
→ { reply: "Todavía no he cerrado tu liquidación. Cuando ya no te falte ningún
     comprobante, escribe *listo* y la cierro. 🚛", forzado: true }   ❌
```

La pregunta del operador se descarta y se responde con el mensaje genérico. El
caso de la ronda 12 ("¿Ya quedó cerrada mi liquidación?") sí quedó cubierto —
con "¿". La forma sin "¿" no. Un `[¿?]` en vez de `/¿/` cierra la clase entera.

**Estado: abierto (cierre parcial de `6e133b8`).**

### [MEDIO] El portón de cifras deja fuera 1-10 y "diez": "te sobran diez" sigue pasando — cierre parcial de la ronda 12
`src/lib/cuadra/cuadre/cifras.ts:41-46` (`CARDINAL_SUELTO` arranca en "once") · `guardia.ts:83` (early return con `tieneCifrasDeDinero`)

El commit `8ad7346` documenta la frontera ("11-99 + centenas + mil") y la
frontera es arbitraria: "once" (11) marca y "diez" (10) no, con la misma
ambigüedad en los dos. Probado:

```
tieneCifrasDeDinero("Te sobran diez del anticipo.")  → false  ❌
tieneCifrasDeDinero("Me faltan cinco para completar.") → false ❌
```

Con el portón cerrado, `guardiaCifras` sale por el early return de
`guardia.ts:83` y un número que nadie calculó llega al teléfono de quien
liquida — el caso exacto que el comentario de `cifras.ts:9-12` dice que el
portón existe para impedir. El vocabulario de `NO_ES_DINERO` (`cifras.ts:49`)
ya desambigua los sustantivos comunes ("tres comprobantes", "cinco fotos"); el
hueco es solo la frontera.

**Estado: abierto (cierre parcial de `8ad7346`).**

### [MEDIO] El cotejo contra la política no ve los cardinales en palabras: "ochocientos" pasa si "800" aparece en la política (la puerta trasera de la ronda 7, abierta por esta vía)
`src/lib/cuadra/cuadre/cifras.ts:114,160` (`cifrasSinRespaldo` extrae solo dígitos vía `MONEY_G`) · `cifras.ts:155-158` (`hablaDeDineroSinCifraVerificable` solo dispara sin NINGÚN dígito) · `guardia.ts:88-104`

La ronda 7 cerró el bypass "consultar_politica desbloquea narrar cualquier
cifra" cotejando cifra por cifra. El cotejo extrae solo números con dígitos
(`MONEY_G`), así que un cardinal en palabras dentro de una oración mixta no se
puede cotejar — y si el número respaldado coincide, todo pasa. Probado:

```
cifrasSinRespaldo("Te sobran ochocientos del anticipo y el tope del diésel es 800.",
                  [{ politica: { topes: { diesel: 800, caseta: 1500 } } }])
→ []   (todo respaldado)  ❌
hablaDeDineroSinCifraVerificable("Te sobran ochocientos … es 800.") → false (hay dígitos)
```

Flujo completo: turno con `consultar_politica` y sin `cuadrar_viaje`; el modelo
narra "Te sobran ochocientos del anticipo" — 800 coincide con un tope de la
política → `cifrasSinRespaldo` = [] → `guardiaCifras` devuelve `forzado: false`
→ el "ochocientos" (que el motor nunca calculó) llega al operador. Es la misma
clase que la ronda 7 cerró para dígitos; el cardinal en palabras dentro de una
oración con dígitos la vuelve a abrir.

**Estado: abierto.**

### [BAJO] El portón de cifras marca la hora del día: "Llego a las once" dispara el reemplazo determinístico (regresión de la ronda 12)
`src/lib/cuadra/cuadre/cifras.ts:41-46` · `guardia.ts:83`

Probado: `tieneCifrasDeDinero("Llego a las once, ¿te parece?")` → **true**.
"CARDINAL_SUELTO" casa "once" y `NO_ES_DINERO` no explica "a las once". Un
turno conversacional donde el modelo conteste la hora sale reemplazado por el
cuadre determinístico del motor. El costo es el que la doctrina del archivo
tolera ("el reemplazo es correcto y hasta más útil") — salvo que para "¿a qué
hora llegas?" un cuadre no es más útil. Falso positivo, no falso negativo: la
asimetría manda, pero conviene que "a las (once|doce|…)s\b" esté en
`NO_ES_DINERO`.

**Estado: abierto (regresión de `8ad7346`).**

### [BAJO] La memoria multi-oración es todo-o-nada: la cita legítima de la oración buena se borra junto con la mala
`src/lib/cuadra/normas/fundamento.ts:281` (`oraciones.every`) · `:473-477` (la limpieza borra TODAS las ocurrencias del id)

El escenario exacto de la ronda 12, con el orden diésel→caseta (el del test
nuevo), produce:

```
reply:  "Tu diésel pagado en efectivo cuenta contra el tope del 15% del
         combustible (RFA 2026 regla 2.9). Tu caseta de peaje también se pagó
         en efectivo y aplica la misma regla 2.9 de la RFA 2026."
salida: "Tu diésel pagado en efectivo cuenta contra el tope del 15% del
         combustible. Tu caseta de peaje también se pagó en efectivo y aplica
         la misma 2026."
```

La cita del DIÉSEL era memoria legítima (el historial la justifica) y se pierde
igual. El test de la ronda 12 (`fundamento_ronda9.test.ts`) solo verifica que
la caseta pierda la cita; no verifica la supervivencia de la legítima. La
recomendación de la ronda 12 era "quitar solo las ocurrencias que no pasen el
veto"; el fix quita todas las del id (fail-closed, documentado en el commit
`97925ad` — pero más grueso que la recomendación). El resultado es el error
barato de la asimetría del archivo (precisión), no el caro (certificar la
falsa); aun así, la dirección correcta sigue siendo la que apuntaba la ronda
12: quitar por oración, no por id.

**Estado: abierto (nota de comportamiento del cierre `97925ad`).**

### [BAJO] `fundamento.ts`: comentario que promete un reescrito que el regex no puede producir ("estés" subjuntivo)
`src/lib/cuadra/normas/fundamento.ts:506-507` · `:515` (`est[áa]s?`)

El comentario dice: "un 'no' con palabras en medio ('no me parece que estés
obligado') NO casa la ventana y se reescribe, que es el caso que sí es una
afirmación disfrazada". Probado — el código no puede:

```
guardiaFundamento("No me parece que estés obligado a facturar en 72 horas.",
                  ['politica-portales-plazos-facturacion'], '')
→ { reply: <idéntico>, forzado: false }
```

`est[áa]s?` no casa "estés" (la penúltima vocal es "é", no "á/a") — el
subjuntivo no dispara `OBLIGA` ni el reemplazo. El comportamiento real es
benigno (la negación verdadera pasa intacta, que es lo correcto), pero el
comentario describe un comportamiento que el código no tiene — la misma clase
del BAJO de `conv.ts` que la ronda 12 cerró. Si algún día se amplía el patrón a
`est[éeáa]s?`, el reescrito SÍ va a correr sobre "no me parece que estés
obligado" y va a producir "no me parece que conviene facturar" — sentido
invertido. El comentario está preparando el bug, no documentándolo.

**Estado: abierto (cosmético, con trampa futura).**

### [BAJO] `guardiaEstado`: el futuro en "-amos" con marcadores fuera de la lista se tacha
`src/lib/cuadra/cuadre/estado_afirmado.ts:129` (`FUTURO`) · `:146` (la exención `-amos` solo con `FUTURO.test`)

La lista cubre `mañana|cuando|después|en cuanto|pronto|luego|al rato|apenas`.
Probado:

```
guardiaEstado("En un momento cerramos tu liquidación.", { cerro: false, entrego: false })
→ { reply: "Todavía no he cerrado…", forzado: true }   ❌ (es futuro)
guardiaEstado("Ya mero cerramos tu liquidación.", …)   → forzado: true  ❌
```

El reemplazo no miente (la liquidación no está cerrada), pero descarta el
matiz temporal — la misma clase que la ronda 12 acusó para "mañana" y que el
fix cubrió solo para los marcadores de su lista. "en un momento", "ya mero",
"ahorita", "en unos minutos" quedan fuera.

**Estado: abierto (residual de `6e133b8`).**

### [BAJO] `conv.ts`: `CUADRA_INTAKE_GRACE_MS=0` no apaga la gracia — el valor 0 documentado es inalcanzable
`src/lib/cuadra/conv.ts:591` (`const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 2_000;`) · `:588-590` (comentario: "con 0 la carrera fotos+'listo' cierra sobre datos parciales")

Verificado: `Number('0') || 2_000` → `2000`. El "con 0" del comentario —el
único camino documentado para reproducir la carrera y ver el modo de falla—
es inalcanzable por entorno; quien ponga `CUADRA_INTAKE_GRACE_MS=0` para
probar la carrera va a obtener la gracia activa y va a creer que la apagó.
Mismo patrón en `CUADRA_INTAKE_ESPERA_MS=0` → 20,000 (`conv.ts:582`). El
efecto es seguro (la gracia queda ON), pero la bandera miente sobre su propio
rango — el mismo BAJO de "comentario vs. código" que la ronda 12 cerró en este
archivo, ahora dentro del código mismo.

**Estado: abierto (residual del BAJO de la ronda 12).**

## Lo que revisé y está bien (sin tocar)

- **Las tres guardias y su orden** (`processor.ts:1955-2040`): cifras →
  fundamento → estado, con `textoDeterminista` apagando las dos últimas cuando
  la primera reemplazó. El orden sigue siendo el correcto (fundamento sobre un
  texto del motor lo corrompería — documentado en el propio archivo).
- **El snapshot AG-3** (`guardia.ts:69-77`): con `guardar_liquidacion` OK, la
  guardia usa la MISMA `liq` que la tool devolvió (la que se imprimió en los
  dos PDF y persistió `saveLiquidacion`), no una segunda lectura de la DB.
- **`resumenCuadre(liq, cerro, 'operador')`** (`guardia.ts:114`): el
  destinatario es explícito, `SOLO_CONTRALOR` filtra lo que el chofer no puede
  arreglar, y el descargo legal solo va al contralor (`resumen.ts`).
- **`guardiaCifras` con política**: la puerta trasera de la ronda 7 sigue
  cerrada para dígitos (`cifrasSinRespaldo` coteja cifra por cifra); el fallo
  de verificación cae al reemplazo determinístico. (El MEDIO nuevo es la vía
  de los cardinales en palabras, no una regresión de esta.)
- **Loop-guard** (`openrouter.ts:690-700`): corta ANTES del `Promise.all` que
  ejecuta las tools; `openrouter_loopguard.test.ts` pasa contando ejecuciones
  (2, no 3). El costo de la ronda cortada se registra vía
  `PartialExecutionError` con tokens/costo acumulados (`processor.ts:1904-1917`).
- **tool-executor**: `executeTool` nunca tumba el loop (captura y devuelve
  `success:false`); `mensajeParaElModelo` acota el vocabulario de Postgres y
  el detalle completo queda en el log; `makeExecutor` cachea la PROMESA antes
  del await (sin ventana check-then-act) y no cachea los fallos; la llave es
  el nombre (correcto para las tools sin parámetros, documentado).
- **Idempotencia de mutación**: `guardar_liquidacion` no se re-ejecuta en el
  turno — rejilla `mutacionesHechas` (tool-executor) + `inRound` (openrouter,
  dedup síncrono antes del primer await, sin carrera) + backstop de la DB
  (`unique(viaje_id)`).
- **Cierres parciales** (`processor.ts:1890-1948`): la recuperación del
  huérfano registra el costo (modelo 'parcial'), vincula costos a la
  liquidación, arma el resumen del MOTOR (nunca cifras del modelo), pone
  `ctxCerro` para el log y el PDF falla cerrado con `pdf.no_entregado`. El
  flag `CUADRA_RECUPERAR_CIERRE_PARCIAL=1` está en `.env.local` (verificado).
- **Barrera de ráfaga** (`conv.ts:560-610`): fail-closed en las dos
  direcciones, contador vencido tratado como 0, aviso bifurcado por `closed`
  (`processor.ts:2072-2087`).
- **El freno de cierre sin comprobantes** (`processor.ts:1788-1820`): pregunta
  una sola vez por viaje, guarda la marca solo si el aviso SALIÓ, y el conteo
  falla abierto (un error de lectura no impide cerrar a quien sí mandó sus
  comprobantes).
- **`pareceCierre` / `esAfirmacion` / `esNegacion`** (`processor.ts:321-330`,
  `huerfanos.ts:114-140`): estrechez deliberada documentada; "listo" no cuenta
  como sí en el ofrecimiento de huérfanos (a propósito, comentado).
- **El prompt del agente** (`agents/prompts.ts`) y el registro de tools:
  consistentes con las guardias.
- **Suites**: 127 pruebas en `estado_afirmado` + `cifras` (+`cifras_tolerancia`)
  + `fundamento` + `fundamento_ronda9` + `fundamento_ronda10` + `openrouter_loopguard`
  + `tool-executor` + `tool_executor_concurrente` + `conv` + `presupuesto`, más
  35 de `guardia` + `resumen` — todos verdes. `tsc --noEmit -p .` y `eslint`
  limpios sobre los archivos del rubro.

## Lo que NO alcancé a revisar

- **No corrí un arnés de concurrencia propio contra `processInbound`** (dos
  "listo" + fotos en paralelo contra el proceso real). Las carreras del rubro
  se verificaron por lectura y por las suites existentes
  (`tool_executor_concurrente`, `processor_lock`, `conv_carrera_insert`), no
  lanzando el pipeline yo mismo — sigue siendo la recomendación más barata que
  dejó la ronda 9.
- **El entorno de Vercel de producción**: los flags del demo
  (`CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, `CUADRA_INTAKE_GRACE_MS=2000`,
  `CUADRA_INTAKE_ESPERA_MS=20000`, `CUADRA_DEDUP_FOTOS`) están en `.env.local`
  (verificado), no puedo ver las envs de Vercel. Si el demo se proyecta contra
  producción y ahí no están replicados, el huérfano de cierre queda sin
  recuperación.
- **`al_vuelo.ts` / `enrutar.ts` y los adaptadores de portal**: rubro
  fiscal/tool-calling, no dupliqué. El rubro acuses (`acuse_ticket.ts`) no
  cambió desde la ronda 10.
- **La calibración real de `ocr_confianza`**: sigue sin datos que
  correlacionar desde el código.

## Veredicto

**Green light para el demo, con las mismas dos condiciones de la ronda 12 y
una nota de deuda que creció.**

El camino feliz del guion —fotos → "listo" → cuadre → PDF— sigue protegido por
la guardia más fuerte del sistema: `guardiaCifras` reemplaza SIEMPRE el texto
del modelo por el resumen del motor cuando hubo `cuadrar_viaje` o
`guardar_liquidacion` (`guardia.ts:83-114`), y ese reemplazo apaga a las otras
dos guardias (`processor.ts:2005,2027`). Los cuatro cierres de la ronda 12
están en el código y funcionan en su escenario exacto; el loop-guard corta
antes de gastar; la mutación no se duplica; el cierre parcial tiene su
recuperación activa en el entorno local del demo.

Las dos condiciones, igual que en la ronda 12: (1) los flags del `.env.local`
replicados si el demo se proyecta contra el deploy — sobre todo
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1`; (2) las fotos ANTES del "listo" (ya lo
exige el guion; la barrera + la gracia de 2s cubren el lote simultáneo).

La salvedad: la deuda del rubro creció con la ronda 12 en vez de bajar. La
regresión de la negación de oración entera, los tres cierres parciales y la
vía de los cardinales en palabras son todos de la MISMA clase que este proyecto
ya pagó tres o cuatro rondas seguidas (una cifra o un hecho que el modelo
afirma sin respaldo llega al teléfono). Ninguno se ve en la sala, pero el MEDIO
de la negación es especialmente incómodo porque el fix de la ronda 12 prometía

exactamente lo contrario de lo que implementó. Recomendación: arreglar antes de
la ronda 14 los dos MEDIO del detector de estado (negación por cláusula del
verbo, pregunta con o sin "¿") y su BAJO de futuro, el gap de "diez"/1-10 y el
cotejo de cardinales — los cinco con fix acotado y prueba escribible.
