# Sistema agéntico y orquestación — nota 4/10 (antes 5)

## Intentos de romper guardiaFundamento

Todo lo de esta sección corrió contra el código real (`src/lib/cuadra/normas/fundamento.ts`)
con `npx tsx`, importando `citasEnTexto` y `guardiaFundamento` directamente — no son
hipótesis, son transcripciones de salida real. Script y salidas completas quedaron en
`/private/tmp/claude-501/.../scratchpad/romper-fundamento*.ts` (fuera del repo, no se tocó nada).

**Bypass total, cero cita detectada, cero forzado — el más grave:**

```
entra:  "Ese gasto no aplica conforme al 45-Z de la Ley del ISR, así que te lo
         dejo como no deducible."
sale:   IDÉNTICO. citasEnTexto = []  forzado = false
```
```
entra:  "Tu saldo final es correcto. Ese gasto no es deducible conforme al
         27-III porque el pago fue en efectivo."
sale:   IDÉNTICO. citasEnTexto = []  forzado = false
```
```
entra:  "No es deducible: 27-III LISR."           (sigla DESPUÉS del número)
sale:   IDÉNTICO. citasEnTexto = []
```
```
entra:  "No es deducible por el artículo veintisiete fracción tres de la LISR."
sale:   IDÉNTICO. citasEnTexto = []
```

**Por qué se escapan, exacto:** `FORMA_DE_CITA` (fundamento.ts:77-81) solo dispara con
`(?:artículo|art\.|arts\.|regla|fracción|fr\.)\s*\d+` o con `SIGLA\s+\d+` (sigla
**antes** del número, con espacio literal, no guion). Cualquier cita que:
(a) no use ninguna de esas seis palabras clave, o (b) ponga la sigla **después**
del número, o (c) escriba el número en palabras — no tiene "forma de cita" para
el detector, así que ni siquiera cae en `CITA_DESCONOCIDA`. Y "conforme al 27-III"
o "27-III LISR" son formas *más* naturales en español hablado que "según el
artículo 27, fracción III de la Ley del Impuesto sobre la Renta" — el WhatsApp de
un agente que explica un veredicto va a sonar así, no como una cita de tratado.

Con esto, la promesa central de `guardiaFundamento` ("el modelo solo puede citar
una norma que una tool le devolvió en ese turno") es falsa en la práctica: un
modelo puede inventar cualquier artículo, con cualquier fracción, y con solo
evitar la palabra "artículo"/"regla"/"fracción" pegada a un dígito, el texto sale
tal cual al contralor.

**Casos que SÍ se detectan** (control, para acotar el hallazgo — no es que la
guardia no haga nada): "LISR 27-III", "el art. 28 fr. V de la Ley del ISR",
mayúsculas/minúsculas mezcladas, dentro de una lista con viñetas, con emoji
alrededor, con paréntesis anidados — todos correctamente reconocidos y (si no
están permitidos) quitados. El agujero es específico: falta la palabra clave O
el orden sigla-número está invertido.

**Segundo hallazgo, distinto: una cita REAL y PERMITIDA se rompe por una coma.**
```
entra:       "No es deducible según el artículo 27, fracción III de la LISR."
permitidas:  ['lisr-27-fr-III']   (la tool SÍ la devolvió este turno)
citasEnTexto: ["DESCONOCIDA"]
sale:        "No es deducible según el, fracción III de la LISR."
```
`patronesDe` (fundamento.ts:43) exige `${art}${fr}` contiguos con solo `\s*`
entre el número y "fracción" — una coma rompe el match. El texto cae al fallback
de `CITA_DESCONOCIDA`, que sí lo detecta como "tiene forma de cita" pero no lo
reconoce como el `lisr-27-fr-III` legítimo, así que lo trata como inventado y lo
quita — **incluso habiendo sido autorizado por la tool este mismo turno**. Queda
"según el, fracción III de la LISR", una frase rota, delante del contralor.

## Hallazgos

### [crítico] `guardiaFundamento` no detecta citas sin palabra clave o con la sigla invertida
`src/lib/cuadra/normas/fundamento.ts:70-81` (`SIGLAS`, `FORMA_DE_CITA`)
Entra `"Ese gasto no aplica conforme al 45-Z de la Ley del ISR"` o
`"conforme al 27-III"` o `"27-III LISR"` (sigla después del número) → sale
exactamente igual, sin marcar, sin log, sin `forzado`. Es la regla fundacional
del módulo ("el modelo solo cita lo que una tool devolvió") rota en la forma más
natural de fraseo, no en un caso adversarial rebuscado. `citasEnTexto` depende
enteramente de que el texto contenga literalmente "artículo/art./arts./regla/
fracción/fr." pegado a dígitos, o una sigla conocida seguida de espacio y
dígitos — nunca al revés y nunca sin la palabra clave.

### [crítico] El orden `guardiaCifras` → `guardiaFundamento` corrompe el propio resumen determinístico del motor
`src/lib/cuadra/processor.ts:566-568` (comentario) · `src/lib/cuadra/cuadre/guardia.ts:79` ·
`src/lib/cuadra/cuadre/engine.ts:127` (nota con cita real)

El comentario en `processor.ts:566-568` dice: *"si aquella [guardiaCifras]
sustituyó el texto por el resumen determinístico, este [guardiaFundamento] ya no
trae citas y esto no hace nada."* **Es falso**, verificado con el código real:
`resumenCuadre()` arma sus líneas de `diferencia.nota`, y varias de esas notas
llevan citas reales puestas por el motor —`engine.ts:127` escribe literal
`"... excede el tope de $X (LISR 27-III) — no deducible."`

Reproducido con `resumenCuadre` + `guardiaFundamento` reales, simulando el turno
en que `guardiaCifras` sustituye porque el modelo no llamó `cuadrar_viaje` (por
eso hizo falta sustituir, así que `agentTools` no trae ningún `norma_id` este
turno → `permitidas = []`):

```
resumenCuadre():
  "Este es el cuadre de tu viaje 👇
   • Comprobado: $5,000.00
   • Anticipo: $6,000.00
   • Sobró $1,000.00 del anticipo (a favor de la empresa)

   Ojo con esto:
   • Peaje de $3,500.00 en efectivo excede el tope de $2,000.00 (LISR 27-III) — no deducible."

guardiaFundamento(ese texto, permitidas=[]):
  forzado: true   quitadas: ["lisr-27-fr-III"]
  "Este es el cuadre de tu viaje 👇
   • Comprobado: $5,000.00
   • Anticipo: $6,000.00
   • Sobró $1,000.00 del anticipo (a favor de la empresa) Ojo con esto:
   • Peaje de $3,500.00 en efectivo excede el tope de $2,000.00 — no deducible."
```

El fundamento fiscal correcto —puesto ahí por el motor, no por el LLM— se le
quita al mensaje autoritativo porque `permitidas` se deriva de las tool calls de
este turno (`normasDeToolCalls`, processor.ts:573), y `resumenCuadre` no pasa por
ninguna tool: sale de `cuadrarDesdeDB` directo. Las dos guardias no comparten
noción de "qué está permitido decir", y la segunda castiga al texto que la
primera generó para ser autoritativo. (Nota aparte: el camino de
`processor.ts:468-478`, cuando no alcanza el presupuesto para el agente, llama
`say(resumenCuadre(...))` **sin pasar por ninguna guardia** — ahí la cita
sobrevive intacta, por accidente, porque ese `return` ocurre antes de llegar al
código de `guardiaFundamento`. La inconsistencia entre los dos caminos confirma
que el comentario de `processor.ts:566-568` describe una garantía que no existe.)

### [alto] `limpiar()` colapsa saltos de línea cada vez que la guardia actúa
`src/lib/cuadra/normas/fundamento.ts:105` (`.replace(/\s{2,}/g, ' ')`)
`\s` incluye `\n`. Cualquier texto de WhatsApp con párrafos separados por línea
en blanco (el formato estándar de `resumenCuadre`, con bloques "Ojo con esto:" /
"Acreditable (recuperable):") pierde esos saltos en cuanto `guardiaFundamento`
quita cualquier cosa — sea una cita legítimamente inventada (funcionando bien) o
una legítima mal detectada (el hallazgo anterior). Reproducido:

```
entra:
  "Listo, cuadré tu viaje 👇
   • Comprobado: $5,000.00
   • Anticipo: $6,000.00

   Ojo con esto:
   • Peaje excede el tope (LISR 27-III) — no deducible.

   Acreditable (recuperable):
   • IVA: $200.00"

sale (misma llamada, quitando solo "LISR 27-III"):
  "Listo, cuadré tu viaje 👇
   • Comprobado: $5,000.00
   • Anticipo: $6,000.00 Ojo con esto:
   • Peaje excede el tope — no deducible. Acreditable (recuperable):
   • IVA: $200.00"
```
Las líneas en blanco desaparecen y dos bloques temáticamente distintos quedan
pegados en la misma línea ("$6,000.00 Ojo con esto:" y "no deducible. Acreditable
(recuperable):"). No es cosmético menor: es el mensaje que el contralor lee en
WhatsApp, y pasa **cada vez** que la guardia hace cualquier trabajo, no solo en
el caso raro.

### [alto] La forma más natural de citar con fracción ("artículo 27, fracción III") no se reconoce y rompe la cita al quitarla
`src/lib/cuadra/normas/fundamento.ts:43,46-47` (`fr` sin tolerancia a coma) ·
`fundamento.ts:160-164` (limpieza de `CITA_DESCONOCIDA`)
Ver el caso reproducido arriba en "Intentos de romper". Con o sin permiso de la
tool, "artículo 27, fracción III" cae al fallback de desconocida, y la limpieza
de esa rama (`fundamento.ts:162`) solo quita `artículo\s*[\d.]+` — la coma
detiene el match de la parte de fracción opcional, así que queda
", fracción III de la LISR" colgando en el texto final. Esto no protege contra
nada (no hay cita inventada aquí): rompe la gramática de una respuesta legítima.

### [medio] La limpieza de `CITA_DESCONOCIDA` solo contempla fracciones romanas, no los sufijos de letra que SÍ existen en el propio índice
`src/lib/cuadra/normas/fundamento.ts:162-163`
```
entra:  "Esto se basa en el LIF 2026 Art. 45-A, que no existe."
sale:   "Esto se basa en el -A, que no existe."
```
El regex de limpieza `(?:fracci[oó]n|fr\.?)\s*[IVXLC]+` y
`SIGLA\s+[\d.]+(?:-[IVXLC]+)?` solo absorben sufijos con números romanos. Pero el
propio índice (`normas/indice.ts`) usa sufijos de LETRA todo el tiempo: `LIF 2026
Art. 20-A`, `CFF 69-B`. Una cita inventada con esa forma —muy plausible, porque
es exactamente el patrón de las normas reales del producto— deja el residuo
`"-A"` o `"-B"` huérfano en el texto tras la limpieza.

## Contexto que no baja la nota (verificado, no repetido de rondas anteriores)
El bypass CRÍTICO de `guardiaCifras` que dominó la auditoría 2 (`"Tu resultado
final: 8000"`, `"Te sobraron ocho mil pesos"`) está **corregido**:
`cuadre/cifras.ts` ahora tiene `DINERO_EN_PALABRAS` y un portón mucho más ancho,
con comentarios que citan las frases exactas del boletín anterior. Buen cierre
de loop — es la razón de que la nota no caiga más abajo de 4: el diseño de
"fail-closed + recálculo autoritativo" sigue siendo el correcto, lo que falla es
la cobertura de patrones de las dos guardias de texto (cifras ya tapada,
fundamento recién estrenada y con el mismo tipo de hueco).

---

# Arquitectura y mantenibilidad — nota 5/10 (antes 6)

## Hallazgos

### [alto] El panel sigue leyendo Supabase con mapeo a mano fuera de `repo.ts` — mismo hallazgo, dos rondas después, sin tocar
`src/app/dashboard/page.tsx:24-41` (`interface LiqRow`, `getLiquidaciones`)
```ts
const { data } = await supabaseAdmin()
  .from('liquidacion')
  .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
  ...
return (data ?? []).map((r) => ({ ... }));  // casts a mano, sin tipo generado
```
`repo.ts` no tiene ninguna función de listado (`command grep "^export.*function" repo.ts`
no devuelve nada parecido a `getLiquidaciones`). MAPA.md sigue describiendo
`repo.ts` como "TODO el acceso a datos", y el boletín anterior (51,
línea 16) y la auditoría 2 (línea 30) ya señalaron exactamente este archivo y
este patrón — el desajuste del mapa `CONCEPTO` que ese mismo mecanismo produjo
una vez ya está resuelto (`engine.ts:531` y `pdf.ts:35` dicen `'Otro'` los dos),
pero la causa raíz —consultas ad hoc con mapeo manual en un archivo de
presentación, sin prueba— sigue exactamente donde estaba. Es la segunda vez que
se marca sin que se mueva una línea.

### [medio] Lógica de negocio (cuándo el agente puede citar la 2.9) vive en `tools.ts`, sin ningún test
`src/lib/cuadra/tools.ts:79`
```ts
if (periodo && periodo.estado !== 'holgado' && !fundamentos.includes('rfa-2026-2.9'))
  fundamentos.push('rfa-2026-2.9');
```
Es una decisión de producto/fiscal (bajo qué condición del contador de ejercicio
se autoriza citar la facilidad del 15%), no un detalle de wiring de la tool. No
hay `tools.test.ts` en el repo — cero prueba directa de esta rama. Comparar con
`normas/por_diferencia.ts`, que sí es un módulo puro, testeado y exhaustivo
(`por_diferencia.test.ts`) para el mismo tipo de decisión; esta pieza equivalente
quedó fuera de ese patrón.

### [medio] `laboral/pagadero.ts` (resumenLaboral) solo está conectado al PDF, nunca al mensaje de WhatsApp
`src/lib/cuadra/liquidacion/pdf.ts:312` es el único llamador de `resumenLaboral`
(verificado con `command grep -rn "resumenLaboral" src/` — un solo resultado
fuera de su propio archivo y test). `cuadre/resumen.ts` (el texto que arma
`guardiaCifras`/`processor.ts` para WhatsApp) no lo menciona. Escenario
concreto: viaje con demora no imputable al operador y hospedaje sobre política →
`resumenLaboral` calcula correctamente "SE DEBE pagar (LFT 263-I)" y ese texto
sale en el PDF adjunto — pero el mensaje de WhatsApp que el operador lee
*primero*, en el momento del cierre, no dice nada de esa obligación legal. El
propio comentario del módulo (`pagadero.ts:165-168`) advierte contra exactamente
este patrón ("un cálculo correcto que no llega a quien decide no arregla
nada") y el módulo mismo cae medio en él: llega a quien archiva el PDF, no a
quien necesita saberlo en el momento.

### [medio] El reorden de `engine.ts` es correcto para lo que dice arreglar, pero expone un resultado dependiente del ORDEN de los gastos
`src/lib/cuadra/cuadre/engine.ts:344-360` (`ancla = delDia[delDia.length-1]`) ·
`engine.ts:405-410` (proporción de IVA por gasto)

Verificado primero que el movimiento en sí no rompe nada: para cuando corre el
bloque de acreditamiento (línea 385), `diferencias` ya incluye TODAS las
entradas —incluida `viatico_excede_fiscal`, calculada arriba en el mismo
`cuadrarViaje`— así que no hay variable usada antes de tiempo ni `continue` que
se salte algo que antes no se saltaba. El fix que dice hacer (LIVA 5-I ya ve el
exceso de tope antes de acreditar IVA) sí funciona.

Pero cuando el tope de alimentación se excede con **dos o más comprobantes del
mismo día con tasas de IVA distintas** (realista para una flota que cruza a la
franja fronteriza, IVA 8%, contra el resto del país al 16%), todo el excedente
se cuelga del ÚLTIMO gasto del día en el arreglo (`ancla`, línea 350), y la
proporción de IVA acreditable se calcula gasto por gasto contra `noDeducibleDeEste`
(línea 405-407) — que solo es distinto de cero para la ancla. Reproducido con
`cuadrarViaje` real, mismos hechos, dos órdenes de entrada:

```
g1 = $400, IVA 16% ($64) | g2 = $500, IVA 8% ($40) | mismo día, tope $750

orden [g1, g2]  (g2 es la ancla) → ivaAcreditable = 92
orden [g2, g1]  (g1 es la ancla) → ivaAcreditable = 80
```
Mismo viaje, mismos montos, mismas tasas — el total de IVA acreditable (la
"cifra que compra el contralor", según el propio comentario de
`engine.ts:448`) cambia $12 según en qué orden llegaron los comprobantes al
arreglo, no según ninguna regla fiscal. Es consecuencia directa de que
`cuadrarViaje` es una sola función de 460 líneas con un arreglo `diferencias`
mutable que varios bloques leen y escriben en secuencia: reordenar bloques (como
se hizo aquí, correctamente, para otro bug) puede cambiar CUÁL gasto ve cuál
diferencia, y el diseño no tiene forma de detectarlo salvo auditándolo a mano.
No hay test que cubra dos gastos del mismo día con tasas de IVA distintas (sí
hay uno para "dos gastos, no excede vs excede", pero en días distintos —
`engine.test.ts:1027-1037` — que por construcción no puede ver este caso).

## Lo que sí mejoró (verificado, no solo leído)
`normas/`, `periodo/` y `laboral/` están bien colocados: son módulos puros,
testeados, de una sola responsabilidad, exactamente el patrón que
`cuadre/engine.ts` ya usaba bien. `normas/por_diferencia.ts` en particular es un
buen diseño — la lista `SIN_NORMA` explícita convierte un olvido silencioso en
una decisión declarada. El mapa `CONCEPTO`/`otro` que causó el bug de la
auditoría 2 está sincronizado (`engine.ts:531`, `pdf.ts:35`, ambos `'Otro'`).
