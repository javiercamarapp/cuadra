# Sistema agéntico y orquestación — auditoría 12

**Nota: 7/10** (sin movimiento vs auditoría 10). Razón: los ocho cierres de la
ronda 10 siguen verificados uno a uno contra el código de hoy —incluido el
reincidente de `guardiaFundamento` por sujeto, que esta ronda volvió a abrir
para demostrar el hueco que le queda—, pero la mirada más profunda de esta
ronda (la que pide el rubro: guardias, tool-executor, loop-guard, ctx.signal y
cierres parciales, línea por línea y con pruebas propias encima) encontró
**cuatro hallazgos reales nuevos verificados con prueba, uno de ellos ALTO y de
la MISMA clase que la ronda 10 cerró como reincidente de tres rondas**: la
memoria de fundamento sigue certificando una cita real aplicada a un gasto
inventado cuando el reply trae más de una oración con la misma cita. No es un 6
porque ninguno de los hallazgos nuevos está en el camino feliz del demo
(foto → listo → cuadre → PDF: ese camino corre `guardiaCifras` con reemplazo
determinístico, que apaga las otras dos guardias a propósito), y porque
tool-executor, loop-guard y el cierre parcial —los otros tres puntos del
rubro— salieron limpios. No es un 8 porque la clase del ALTO de tres rondas
sigue teniendo una puerta abierta, y porque `guardiaCifras` tiene un falso
negativo del portón (cardinales sin "pesos"/"mil") que es exactamente el caso
que la guardia existe para cazar.

> Método: leí `guardia.ts`, `estado_afirmado.ts`, `cifras.ts`, `fundamento.ts`,
> `tools.ts`, `tool-executor.ts`, `openrouter.ts`, `run.ts`, `presupuesto.ts`,
> `conv.ts`, `processor.ts` (los 2,182 renglones) y `resumen.ts` completos, más
> el `registry` y el prompt del agente. Cada hallazgo se **probó** con un test
> temporal (`src/lib/zzz-audit12-*.test.ts`, borrado al terminar), no solo se
> razonó. Suites del rubro en verde: 514 pruebas en `normas/` + `cuadre/` +
> `llm/` + `processor_ctx_cerro` + `conversacion_entregada`, más `tsc --noEmit`
> y `eslint` limpios sobre los archivos del rubro.

## Los cierres de la ronda 10 — verificados, siguen cerrados

| Hallazgo ronda 10 | Estado | Cómo se verificó hoy |
|---|---|---|
| **[CRÍTICO]** `guardiaEstado` solo detectaba el cierre con la palabra "ya" | Cerrado | `estado_afirmado.ts:53-61` — los tres patrones de `AFIRMA_CIERRE` y los dos de `AFIRMA_ENVIO` llevan `(?:ya\s+)?` opcional y exigen pretérito. "Listo, quedó liquidado tu viaje" se detecta (24 tests en verde). |
| **[ALTO ×3]** `guardiaFundamento` certificaba cita real aplicada a gasto inventado | Cerrado para UNA oración, **abierto para varias** | El veto por sujeto (`fundamento.ts:270-287`) funciona: "Tu caseta… aplica la regla 2.9 de la RFA 2026" sin historial de caseta → la cita se quita (probado, caso A). Pero ver el ALTO nuevo de esta ronda: solo evalúa la PRIMERA oración del reply. |
| **[ALTO]** PDF rechazado por Meta sin rastro / `pdf_generado` distinguía los dos ejemplares | Cerrado | `tools.ts` devuelve `pdf_generado` (operador) y `pdf_contralor_generado`; `processor.ts:2010-2033` loguea `pdf.contralor_no_generado` y falla cerrado con `pdf.no_entregado`. |
| **[MEDIO]** Aviso de barrera vencida afirmaba un cuadre que no ocurrió | Cerrado | `processor.ts:2036-2050` — el aviso se bifurca ENTERO por `closed`. |
| **[MEDIO]** Costo de un ciclo mixto atribuido a un solo modelo | Cerrado | `processor.ts:1825-1842` registra una fila de `llm_costo` POR MODELO vía `res.costoPorModelo`; el cierre parcial registra `modelo: 'parcial'` (`processor.ts:1865-1874`). |
| **[MEDIO]** Error crudo de Postgres llegaba al modelo | Cerrado | `tool-executor.ts:87-100` — `mensajeParaElModelo` acota el vocabulario de Postgres; el detalle completo queda en el log. |
| **[MEDIO]** Loop-guard pagaba la última ronda completa | Cerrado | `openrouter.ts:769-770` corta ANTES del `Promise.all`; `openrouter_loopguard.test.ts` cuenta ejecuciones y confirma que la ronda que excede no ejecuta su tool. |
| **[MEDIO]** Mutación doble por ventana check-then-act | Cerrado | `tool-executor.ts:150-160` cachea la PROMESA, no el resultado; `tool_executor_concurrente.test.ts` (6 tests) cubre args distintos, fallos en paralelo y no-envenenamiento de la caché. |

Los cuatro puntos del rubro que pedía este prompt y no estaban en la tabla de
arriba —tool-executor, loop-guard, ctx.signal, cierres parciales— se auditaron
completos; tres salieron limpios y `ctx.signal` sigue siendo el BAJO
documentado de siempre (ver abajo).

## Hallazgos nuevos de esta ronda — verificados con prueba propia

### [ALTO] La memoria de fundamento solo evalúa la PRIMERA oración con la cita; una segunda oración sobre OTRO gasto hereda la memoria
`src/lib/cuadra/normas/fundamento.ts:270` (`const oracionActual = oracionesConCita(reply, patrones)[0]`) · `:439-440` (`if (id !== CITA_DESCONOCIDA && !ok.has(id) && citaEsMismoTema(id, reply, historial)) ok.add(id)`)

El veto por sujeto de la ronda 10 se concede **por id de norma**, pero se
comprueba **solo contra la primera oración del reply que contiene la cita**.
Una vez que `ok.add(id)` corre, TODAS las ocurrencias de ese id pasan —incluidas
las de una oración posterior sobre otro gasto, que nunca se evalúa.

Escenario, probado de verdad (historial = la nota FIJA del motor para todo
diésel en efectivo, `engine.ts`; reply de dos oraciones):

```
historial: "Diésel pagado en EFECTIVO — cuenta contra el tope del 15% del
            combustible del ejercicio (RFA 2026 regla 2.9)."
reply:     "Tu diésel pagado en efectivo cuenta contra el tope del 15%
            (RFA 2026 regla 2.9). Tu caseta de peaje también se pagó en
            efectivo y aplica la misma regla 2.9 de la RFA 2026."
guardiaFundamento(reply, [], historial)
→ { reply: <idéntico>, forzado: false, quitadas: [] }   ❌
```

La regla 2.9 es el tope del 15% del **combustible** en efectivo — ni una caseta
ni una comida están dentro. Con el control (solo la oración de la caseta) la
cita SÍ se quita (`quitadas: ['rfa-2026-2.9']`): el veto funciona; el hueco es
que con la oración de diésel delante, la de la caseta cabalga sobre su permiso.
Es la **misma clase** que `2d64d8e` cerró como reincidente de las rondas 8-9-10
— la cita real aplicada al gasto equivocado, con tool ausente en el turno — y
sigue abierta para respuestas multi-oración, que son justo las de un listado de
gastos (diésel, caseta, comida = los tres conceptos del demo). El fix va en la
dirección que ya apunta el archivo: evaluar `citaEsMismoTema` **por oración**,
no por id, y quitar solo las ocurrencias que no pasen el veto.

**Estado: abierto.**

### [MEDIO] El suavizado de "obligación" invierte el sentido de las negaciones
`src/lib/cuadra/normas/fundamento.ts:485-491`

```ts
if (suavizar) {
  texto = texto
    .replace(/\best[áa]s?\s+obligad\w*\s+a\b/gi, 'conviene')
    .replace(/\best[áa]s?\s+obligad\w*\b/gi, 'conviene')
    .replace(/\bes\s+obligatorio\b/gi, 'es lo recomendable')
    ...
```

Los tres `replace` no miran si la oración está **negada**. Probado:

```
permitidas: ['politica-portales-plazos-facturacion']   // jerarquía 6, NO vinculante —
                                                       // la única de su clase en el camino
                                                       // del demo ("quedan 0 días para timbrarlo")
reply:  "No estás obligado a facturar en 72 horas, pero conviene hacerlo."
→ "No conviene facturar en 72 horas, pero conviene hacerlo."   ❌
```

"no estás obligado" (verdad, el plazo del portal no es obligación legal) se
vuelve "no conviene" (falso: facturar a tiempo es justo lo que el producto
recomienda, es el ahorro que se vende). Además `OBLIGA` (`fundamento.ts:431`,
`\bes\s+obligatorio\b`) casa "**no** es obligatorio" por subcadena, así que una
afirmación negativa correcta dispara el reescrito. El caso "no es obligatorio"
→ "no es lo recomendable" suaviza el error pero sigue cambiando el sentido.
Un fix mínimo: exigir que la negación NO esté en la cláusula antes de reescribir
(o reescribir "no estás obligado a" → "puedes, aunque conviene").

**Estado: abierto.**

### [MEDIO] `guardiaEstado` caza negaciones, preguntas y futuro — el detector no es "deliberadamente estrecho" como dice su comentario
`src/lib/cuadra/cuadre/estado_afirmado.ts:52-61`

El propio encabezado (`:44-49`) dice: "Un falso positivo aquí tacha un mensaje
correcto… Se prefiere el segundo error, así que solo se marcan las formas que
afirman el cierre COMO HECHO CONSUMADO." La implementación hace lo contrario
para cuatro clases. Probado, todas con `{ cerro: false, entrego: false }`:

| Reply del modelo | ¿Qué es? | `forzado` |
|---|---|---|
| "¿Ya quedó cerrada mi liquidación?" | pregunta | **true** ❌ |
| "Tu liquidación no quedó cerrada todavía, faltan tus fotos." | negación CIERTA | **true** ❌ |
| "Tu viaje no está liquidado, te falta un comprobante." | negación cierta | **true** ❌ |
| "Mañana cerramos tu liquidación cuando llegue el último ticket." | futuro | **true** ❌ |
| "Ya quedó cerrada tu liquidación ✅" | afirmación (la que debe cazar) | true ✅ |

Causas: el patrón 1 (`qued[óo]|est[áa]|dej[ée]` + `[^.!?]{0,40}` + `cerrad|liquidad|list`) no excluye "no" ni "¿" del medio, y "cerrada" contiene "cerrad"; el patrón 2 (`(?:cerr|liquid)(?:é|ó|amos|aron)`) incluye "amos", que en "cerramos" es presente/futuro tanto como pretérito. El reemplazo que produce es SIEMPRE verdadero (la rama solo corre con `cerro:false`), así que no miente — pero tira la información que el operador necesita: en el caso 2, "faltan tus fotos" — el dato que lo hace actuar — se reemplaza por "Todavía no he cerrado tu liquidación…". El costo es UX y confianza, no una cifra falsa.

**Estado: abierto.**

### [MEDIO] El portón de cifras no detecta cardinales sin "pesos"/"mil": un número inventado pasa intacto
`src/lib/cuadra/cuadre/cifras.ts:28-35` (`DINERO_EN_PALABRAS` exige `\s+(?:mil|millones?|pesos?)` después del cardinal) · `guardia.ts:83` (el early return decide con `tieneCifrasDeDinero`)

Probado: `tieneCifrasDeDinero('Te sobran ochocientos del anticipo.')` → **false**.
"ochocientos" a secas —español natural de WhatsApp— no casa `DINERO_EN_PALABRAS`
(sin "mil"/"pesos") ni `DINERO_EXPLICITO` (sin dígitos/$) ni `NUMERO_SUELTO`
(sin dígitos). Consecuencia en `guardiaCifras`: un turno SIN tools donde el
modelo narra "Te sobran ochocientos del anticipo" sale intacto por el early
return de `guardia.ts:83` — un número que nadie calculó llega al teléfono de
quien liquida, que es exactamente lo que el comentario de `cifras.ts:9-12`
dice que el portón existe para impedir. Mismo caso con "te sobran trece",
"me faltan quinientos". No es el camino feliz del demo (ahí el reemplazo
determinístico manda), pero sí cualquier turno de conversación donde el modelo
conteste de memoria.

**Estado: abierto.**

### [BAJO] `guardiaEstado`: la rama `real.cerro` del reemplazo es código muerto
`estado_afirmado.ts:127-132`. Los dos motivos solo se empujan con `!real.cerro`
(`:118`) y `real.entrego === false` (`:121`); el único llamador
(`processor.ts:1992`) pasa `entrego: closed ? 'pendiente' : false`, así que
`real.cerro === true` ⇒ `motivos` vacío ⇒ el ternario nunca toma la primera
rama. Defensivo, no dañino — anotado para no mantener dos textos vivos.

**Estado: abierto (no requiere fix).**

### [BAJO] `ctx.signal` sigue desconectado de los handlers — la documentación es exacta, sin regresión
`tool-executor.ts:19-39` (documentado a propósito) · `run.ts:29` — ningún
handler de `tools.ts` lee `ctx.signal`; `acotada()` (`presupuesto.ts:148`)
impone su propio `AbortSignal.timeout(TOPE_CONSULTA_MS)` por consulta. Verifiqué
el hueco documentado: si al turno le quedan 2s de presupuesto (el
`AbortController` de `run.ts` ya abortó), una consulta en vuelo sigue hasta sus
8s de tope — trabajo desperdiciado, no un recurso que no se libera. Lo que la
doc NO cubre y verifiqué que tampoco existe: la señal del turno no se combina
con el tope de consulta (`AbortSignal.any([...])`), así que el mitigante de 8s
sigue siendo el único techo real. Igual que en la ronda 10: cambio de rubro
backend, superficie ~19 funciones de `repo.ts`, no se toca hoy.

**Estado: abierto (documentado).**

### [BAJO] Comentarios que contradicen el código sobre los defaults de la barrera y la gracia
`conv.ts:560-562` ("tope configurable (env CUADRA_INTAKE_ESPERA_MS, default
**60s**)" — el código en `:575` dice "Default **20s**, NO 60s" y el default es
`20_000`) · `conv.ts:586-588` ("FLAG (HARD RULE 3): default **0** = comportamiento
actual EXACTO. Se recomienda ~2000ms" seguido de "Default **2s**" — el código es
`|| 2_000`, o sea la gracia anti-carrera está ON por default, no OFF). Una
revisión futura leyendo el comentario creería que la carrera fotos+"listo"
cierra sobre parciales por default cuando no lo está. Cosmético, pero son dos
afirmaciones del MISMO archivo sobre el MISMO default, y una de ellas es la
docstring pública de la función.

**Estado: abierto (cosmético).**

## Lo que revisé y está bien (sin tocar)

- **Las tres guardias y su orden** (`processor.ts:1915-1997`): cifras →
  fundamento → estado, con `textoDeterminista` apagando las dos últimas cuando
  la primera reemplazó. El orden está documentado en el código y es correcto:
  correr fundamento sobre un texto del motor lo corrompería (el propio archivo
  lo demuestra con el caso de la auditoría 3).
- **El snapshot AG-3** (`guardia.ts:69-73, 105-114`): un turno que cierra usa la
  MISMA `liq` que ya se imprimió en los dos PDF, no una segunda lectura. Las
  fotos no toman mutex, así que entre el cálculo y el texto podría entrar un
  comprobante; el snapshot lo elimina. Verificado por lectura y por
  `guardia.test.ts` (20 tests, incluido el fail-closed del motor caído).
- **`guardiaCifras` con política**: la puerta trasera de la ronda 7
  (consultar_politica como salvoconducto) sigue cerrada — `cifrasSinRespaldo`
  coteja cifra por cifra y el fallo de verificación ("habla de dinero sin cifra
  cotejable") cae al reemplazo determinístico, no al pase.
- **`guardiaEstado` con cierre real**: cuando `closed=true` la guardia no toca
  el texto (el cierre ocurrió de verdad), y `entrego:'pendiente'` evita la
  regresión de la ronda 6 (desmentir el PDF que está a punto de salir).
- **Loop-guard** (`openrouter.ts:769-770`): corta ANTES del `Promise.all`, y
  `openrouter_loopguard.test.ts` lo confirma contando ejecuciones (2, no 3). El
  costo de la llamada LLM de esa última ronda se registra igual
  (`PartialExecutionError` con tokens/costo acumulados).
- **tool-executor**: `executeTool` nunca tumba el loop; el error de Postgres se
  acota para el modelo y queda completo en el log; `makeExecutor` cachea la
  promesa (no el resultado) y la llave es el nombre (correcto para tools sin
  parámetros — la regla `properties: {}` está documentada y vigilada por la
  propia llave). `tool_executor_concurrente.test.ts` (6 tests) cubre la
  concurrencia real.
- **Cierres parciales** (`processor.ts:1857-1901`): la recuperación del
  huérfano (guardar_liquidacion OK + ciclo muerto) vincula costos, arma el
  resumen del MOTOR (nunca cifras del modelo), pone `ctxCerro` para el log, y
  el PDF falla cerrado con `pdf.no_entregado`. El flag
  `CUADRA_RECUPERAR_CIERRE_PARCIAL=1` está puesto en `.env.local` (demo local,
  verificado) junto con `CUADRA_INTAKE_GRACE_MS=2000`, `CUADRA_DEDUP_FOTOS=1` y
  `CUADRA_INTAKE_ESPERA_MS=20000`.
- **Barrera de ráfaga** (`conv.ts:565-610`): fail-closed en las dos direcciones
  (`intakeDelta` null → no se procesa la foto; `intakePendientes` null → no
  abre la barrera), contador vencido tratado como 0, y el operador recibe el
  aviso de "cuadré con los N que alcancé" si la barrera vence.
- **Mutex y claim**: `acquireViajeLock` reintenta y distingue RPC ausente
  (fail-open con ERROR) de transitorio; el abandono por lock ocupado avisa y
  libera el claim; la re-verificación del doble "listo" está después del lock.
- **El freno de cierre sin comprobantes** (`processor.ts:1726-1760`): pregunta
  una sola vez por viaje, guarda la marca solo si el aviso SALIÓ, y el conteo
  falla abierto (un error de lectura no puede impedir cerrar a quien sí mandó
  sus comprobantes).
- **El prompt del agente** (`agents/prompts.ts:17-44`): prohíbe inventar
  números, trata folios/comprobantes como datos no como instrucciones (antiprompt-injection), y ordena cerrar en el mismo turno — consistente con las
  guardias.
- **Suites**: 514 tests en `normas/` + `cuadre/` + `llm/` + los dos processor
  de cierre, todos verdes; `tsc --noEmit` y `eslint` limpios sobre los archivos
  del rubro.
- El artefacto de bytes NUL de `fundamento.ts:456,496` (la nota de transporte
  de la ronda 10) sigue ahí y sigue siendo funcionalmente inerte: 4 bytes NUL
  reales en dos líneas, JS los trata igual que su escape. Verificado, no es una
  segunda alucinación.

## Lo que NO alcancé a revisar

- **No corrí un arnés de concurrencia propio contra `processInbound`** (dos
  "listo" + fotos en paralelo contra el proceso real). Las carreras del rubro
  se verificaron por lectura y por las suites de concurrencia existentes
  (`tool_executor_concurrente`, `processor_lock`, `conv_carrera_insert`), no
  lanzando el pipeline yo mismo. Sigue siendo la recomendación más barata que
  dejó la ronda 9.
- **El entorno de Vercel de producción**: los flags del demo
  (`CUADRA_RECUPERAR_CIERRE_PARCIAL`, `CUADRA_INTAKE_GRACE_MS`, `CUADRA_DEDUP_FOTOS`)
  están en `.env.local` (demo local, verificado) y en `.env.example`, pero no
  puedo ver las envs de Vercel. Si el demo se proyecta contra producción y ahí
  no están, el huérfano de cierre queda sin recuperación. Lo marca
  `DECISIONES_PENDIENTES.md` como pendiente de replicar; no lo puedo confirmar
  desde el código.
- **La calibración real de `ocr_confianza`**: la tabla `gasto` sigue sin filas
  del demo (el seed no está aplicado — hallazgo de datos/operabilidad, no lo
  arreglo), así que no hay nada que correlacionar. El rubro acuses
  (`acuse_ticket.ts`) no se re-auditó a fondo: no cambió desde la ronda 10 y no
  es uno de los cinco puntos de este rubro.
- **`al_vuelo.ts` / `enrutar.ts` y los adaptadores de portal**: rubro fiscal /
  tool-calling, no dupliqué.

## Veredicto

**Green light para el demo, con dos condiciones y una salvedad honesta.**

El camino feliz del guion —fotos → listo → cuadre → PDF— está protegido por la
guardia más fuerte del sistema: `guardiaCifras` reemplaza SIEMPRE el texto del
modelo por el resumen del motor cuando hubo `cuadrar_viaje`/`guardar_liquidacion`
(`guardia.ts:83-114`), y ese reemplazo apaga a las otras dos guardias
(`processor.ts:1963,1985`) — así que el ALTO de la memoria multi-oración y los
MEDIO de negaciones/cardinales **no pueden tocar el mensaje de cierre del
demo**: ese texto lo escribe `resumenCuadre`, no el modelo. El cierre parcial
tiene su recuperación activa en el entorno local del demo, el loop-guard corta
antes de gastar, y la mutación no se duplica ni bajo concurrencia.

Las dos condiciones: (1) que el demo corra con los flags del `.env.local`
(`CUADRA_RECUPERAR_CIERRE_PARCIAL=1` sobre todo) — si se proyecta contra el
deploy, verificar que estén replicados en Vercel; (2) que el operador del demo
mande las fotos ANTES del "listo" (ya lo exige el guion, y la barrera + la
gracia de 2s cubren el lote simultáneo).

La salvedad: los cuatro hallazgos abiertos no se ven en la sala, pero son
deuda real del rubro — el ALTO de la memoria multi-oración es la misma clase
que este proyecto ya pagó tres rondas seguidas, y los tres MEDIO son huecos del
mecanismo central (una cifra inventada puede pasar si va en cardinal pelado;
un mensaje correcto puede ser tachado por negación/pregunta; una negación
legal puede invertirse). Mi recomendación: arreglar el ALTO y el MEDIO de
`suavizar` antes de la próxima ronda de auditoría, y los otros dos en cuanto
haya presupuesto — los cuatro tienen fix acotado y prueba escribible.
