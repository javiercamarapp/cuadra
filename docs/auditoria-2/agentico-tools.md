# Sistema agéntico y orquestación — nota 5/10

Nota anterior: 6. El riesgo declarado —`guardia.ts` mandaba veredictos fiscales al
chofer por WhatsApp en el camino feliz— **está corregido y verificado**:
`guardia.ts:56` pasa `'operador'` explícitamente, con comentario que documenta el
bug, y `guardia.test.ts` + `resumen.test.ts` cubren el caso con aserciones
específicas (`no le manda al chofer el veredicto fiscal`). Ese bug ya no existe.

Bajo la nota de todos modos, porque el ejercicio de "intenta romper la regla
fundacional" encontró un bypass **total** del mecanismo que reemplazó a ese bug
—no un caso de borde, sino un agujero en el propio portón de entrada de la
guardia— más una segunda inconsistencia de negocio en el mismo archivo que nunca
se probó. Ver la sección de abajo: es el hallazgo más valioso del reporte.

## Hallazgos

### [ALTO] `cifras.ts:9-10` — el portón de la guardia (`tieneCifrasDeDinero`) se evade con frases comunes, no solo con ataques

`src/lib/cuadra/cuadre/cifras.ts:9-10` y `src/lib/cuadra/cuadre/guardia.ts:32` —
`guardiaCifras` empieza con `if (!tieneCifrasDeDinero(reply)) return { reply, forzado: false };`.
Si esa función devuelve `false`, la guardia entera se salta —**incluido** el
reemplazo íntegro que se dispara cuando `cuadrar_viaje` sí se llamó (línea 34,
`cuadro === true` fuerza siempre `resumenCuadre` sobre el texto del modelo). O
sea: el portón de entrada protege también al camino feliz, y el portón tiene
huecos grandes.

`MONEY` es un regex que exige una de: `$`, coma de miles, `.XX` de centavos,
sufijo "pesos/mxn", o una de 8 raíces léxicas (`anticipo`, `comprob*`, `sobr*`,
`falt*`, `diferencia`, `acredit*`, `reembols*`, `adeud*`) a ≤14 caracteres de un
número. Cualquier frase que evite las cinco formas no dispara nada. Verificado
corriendo el regex EXACTO del archivo:

```
MONEY.test("Ya tienes todo en regla, tu registro final marca 7500 contra 8000, quedas bien.") → false
MONEY.test("Tu resultado final: 8000") → false
MONEY.test("Quedaste con 8000 de saldo.") → false
MONEY.test("El corte te dio 8000.") → false
MONEY.test("El anticipo fueron ocho mil pesos y comprobaste siete mil quinientos, te sobran quinientos pesos.") → false
```

La última prueba es la más grave: **cualquier cifra escrita en palabras evade
el sistema entero**, porque cada rama del regex exige un carácter `\d`. Si el
modelo (por transcripción, por seguir el hilo de una pregunta del operador, o
por una instrucción inyectada en un folio/nota de ticket —el prompt ya advierte
que eso es una superficie de ataque activa, `prompts.ts:30`) narra un número mal
transcrito con cualquiera de estas formas, ese número llega a WhatsApp tal cual,
sin que la guardia lo toque. Es la ÚNICA capa de defensa: una vez que
`tieneCifrasDeDinero` dice que no hay nada que revisar, no hay una segunda
pasada en ningún otro punto del pipeline (`processor.ts:521` manda `reply` tal
cual a `say()`).

Nada de esto está probado: `cifras.test.ts` solo prueba formatos que SÍ pasan el
portón (`$500`, `sobró 500`, `1500 a favor`); ningún caso ejercita una frase sin
signo de dinero, sin coma y sin las 8 raíces léxicas.

Esto es distinto en tipo del bug anterior: aquel garantizaba el fallo (100% del
camino feliz). Este requiere que el modelo elija una frase concreta, pero no
requiere adversario: basta con que Sonnet narre "tu registro marca X" en vez de
usar `$`. El diseño de "tools sin argumentos" cierra la inyección hacia qué tool
se llama; no cierra la inyección hacia CÓMO se narra el resultado, que es
justo el canal que este regex intenta vigilar y no logra cerrar.

### [ALTO] `resumen.ts:24-28` — `complemento_no_verificable` está mal clasificado: su propio texto le pide algo al operador y nunca se lo dice

`src/lib/cuadra/cuadre/resumen.ts:24-28` (`SOLO_CONTRALOR`) incluye
`'complemento_no_verificable'`. Pero su nota, generada en
`src/lib/cuadra/cuadre/engine.ts:235`, es una instrucción dirigida al operador:

> "La factura de {concepto} es de combustible: **reenvía el XML** (el que te
> manda la gasolinera por correo) para verificar el complemento de
> hidrocarburos."

El propio comentario de `resumen.ts:14-22` define la regla: "Al operador se le
pide lo que falta; no se le juzga." Este tipo cumple exactamente esa
descripción —es una petición, no un veredicto fiscal contra un tercero— y aun
así está en la lista que se **excluye** cuando `destinatario === 'operador'`
(`resumen.ts:53`). Comparar con `complemento_hidrocarburos` (el hermano NIVEL
2, correctamente en la lista: ese SÍ es un "no deducible" definitivo sobre el
que el operador no puede hacer nada) — parece que ambos se agruparon por
parecerse en el nombre sin revisar que uno es un veredicto y el otro es una
acción pendiente.

Efecto concreto: un diésel comprado con ticket fotografiado (sin XML aún —el
caso NIVEL 1, normal y frecuente, `engine.ts:230-236`) genera esta diferencia.
En el cierre estándar el modelo llama `cuadrar_viaje` y narra cifras casi
siempre → `guardia.ts:34` fuerza `cuadro=true` → el texto del modelo se
descarta ENTERO y se reemplaza por `resumenCuadre(liq, true, 'operador')` →
esa función filtra `complemento_no_verificable` fuera de `obs`
(`resumen.ts:51-53`) → el operador **nunca ve "reenvía el XML"** en el mensaje
que sí recibe. El mismo texto ocurre en los dos otros llamadores deterministas
(`processor.ts:449`, `processor.ts:500`), así que el hueco es sistemático, no
solo de la guardia.

Consecuencia de negocio: la flota pierde el acreditamiento de IEPS/peaje de ese
gasto (el mismo estímulo que sí se explica cuando SÍ llega el XML,
`engine.ts:292`) y nadie —ni el operador, que es quien tiene el correo con el
XML— se entera de que hay algo que mandar. El contralor lo ve en el panel,
pero el canal pensado para pedírselo al operador (WhatsApp) queda mudo.

Ningún test cubre este tipo: ni `guardia.test.ts`, ni `resumen.test.ts`
mencionan `complemento_no_verificable`.

### [MEDIO] `guardia.ts:34` — el check de "cuadro" solo mira `cuadrar_viaje`, no `guardar_liquidacion`

Sigue como en el boletín anterior (mencionado ahí como ajuste de nota, no
corregido en código): `const cuadro = toolCalls.some((t) => t.toolName === 'cuadrar_viaje' && !t.error);`
no considera que `guardar_liquidacion` también cuadra internamente
(`tools.ts:74`, llama a `computeCuadre` antes de guardar). El prompt pide las
dos llamadas "en el mismo turno" (`prompts.ts:21-24`) pero nada en código lo
impone — un modelo que reutiliza un total ya conocido de un turno anterior y
llama solo `guardar_liquidacion` es un comportamiento plausible en un modelo de
razonamiento que evita llamadas redundantes.

Si eso pasa: `cuadro=false`, la guardia recalcula el cuadre real (cifras
correctas — la regla fundacional NO se rompe) pero llama a
`resumenCuadre(liq, cuadro=false, 'operador')`, que imprime el encabezado
neutral "Este es el cuadre de tu viaje" (`resumen.ts:41`) en vez de "Listo,
cuadré tu viaje" — justo en el turno en que `processor.ts:467`
(`closed = res.toolCalls.some(...guardar_liquidacion...)`) SÍ marca el viaje
como cerrado y manda el PDF a continuación (`processor.ts:534-545`). El
operador recibe un mensaje que suena a "aquí está tu cuadre, pendiente" seguido
de un PDF que dice "aquí está tu liquidación". Ningún test construye este caso
(`toolCalls` con `guardar_liquidacion` sin `cuadrar_viaje`).

### [MEDIO] `processor.ts:465-547` — la cola de cierre no está contabilizada contra el reloj de presupuesto

`presupuesto.ts:19-26` documenta `MARGEN_CIERRE_MS = 8_000` como "el tiempo que
se aparta para CERRAR: mandar el mensaje al operador, soltar el mutex, escribir
el log", y `runAgent` sí respeta el reloj (`processor.ts:463`,
`timeoutMs: reloj.acotar(40_000)`, verificado con
`presupuesto_camino.test.ts`). Pero después de que `runAgent` devuelve, nada
vuelve a consultar `reloj`: `guardiaCifras` puede disparar su propio
`cuadrarDesdeDB` (3 lecturas paralelas a Supabase, `desde_db.ts:11-15`), y si
`closed` es verdadero se suman `createSignedUrl` + `sendDocument` +
`registrarCostoWhatsApp` (`processor.ts:536-540`) — hasta 4-5 llamadas de red
secuenciales adicionales, ninguna con tope, dentro de un margen que el propio
comentario solo dimensionó para "un envío de WhatsApp lento más el unlock". En
el caso normal esto no pasa de un segundo; en un momento genuinamente lento de
Supabase o de la API de WhatsApp —que es precisamente cuándo el reloj existe
para proteger— la cola de cierre puede rebasar el margen sin que nada lo mida
ni lo corte. `presupuesto_camino.test.ts` prueba la decisión de lanzar o no al
agente, no la cola posterior.

### [BAJO] `models.ts:29-67` / `registry.ts:7-13` — `cuadre_fallback` (escalación a Opus) y el agente `orchestrator` siguen sin conectar

Confirmado igual que el boletín anterior (#30 y #37, sin corregir):
`cuadre_fallback` tiene modelo, env var y `ROLE_PARAMS` completos pero
`command grep -rn "cuadre_fallback"` no devuelve ningún uso fuera de
`models.ts` — nunca se pasa a `generateWithTools` ni a `runAgent`. Y
`AGENT_REGISTRY.orchestrator` sigue sin llamador: `runAgent()` en todo el repo
solo se invoca con `agent: 'liquidacion'` (`processor.ts:458`). Es deuda
documentada, no un fallo de datos — etiquetado como opinión/bajo porque no hay
una entrada que produzca una salida incorrecta, solo una promesa del comentario
que el código no cumple.

## Intentos de romper la regla fundacional

Lo que se probó y el resultado:

1. **Cifra narrada sin `cuadrar_viaje`, sin `consultar_politica`.** No pasa:
   `guardia.ts` recalcula y reemplaza (`cuadro=false`, rama superior de
   `try`). Aguantó.
2. **Cifra inventada colada junto a un tope real, con `consultar_politica`
   llamada.** No pasa: `cifrasSinRespaldo` (`cifras.ts:61-73`) la detecta por
   número, no por si hubo alguna tool, y fuerza el reemplazo completo. Aguantó
   (cubierto además por `cifras.test.ts` — "NO deja pasar un cuadre inventado
   colado junto a un tope real").
3. **Cifra derivada (resta/suma que el motor no devolvió literal).** No pasa:
   `cifrasSinRespaldo` es estricta a propósito — un número que no aparece
   verbatim (±1 centavo) en ningún resultado de tool cuenta como sin respaldo,
   aunque sus operandos sí lo tengan. Aguantó.
4. **Cifra en formato "pelón" sin `$` ni coma, con una palabra clave cerca
   (`sobró 500`, `faltan 500`).** No pasa: el regex de palabra clave +
   `\d{2,}` la atrapa igual. Aguantó.
5. **Cifra narrada con frase natural sin `$`/coma/centavos/"pesos"/palabra
   clave ("tu registro final marca 7500 contra 8000, quedas bien").** **SÍ
   PASA.** `tieneCifrasDeDinero` devuelve `false`, la guardia entera se salta
   (`guardia.ts:32`), y el texto del modelo —con la cifra que sea, correcta o
   no— llega a WhatsApp tal cual. Verificado corriendo el regex real del
   archivo contra la frase (ver hallazgo ALTO arriba).
6. **Cifra en palabras ("ocho mil pesos... siete mil quinientos... quinientos
   pesos").** **SÍ PASA**, por la misma razón: cero dígitos en el texto, cero
   coincidencias posibles con un regex que exige `\d` en cada rama.
7. **Diferencia real, correctamente calculada por el motor, pero con una nota
   operador-accionable mal clasificada como solo-contralor
   (`complemento_no_verificable`).** No es una cifra inventada —la regla
   fundacional en sentido estricto sigue viva, los números que sí se muestran
   son siempre los del motor— pero es la misma familia de daño: información
   correcta que el motor calculó y que el operador necesita para actuar nunca
   llega, por una regla de negocio (no de cifras) mal puesta en el mismo
   archivo que blinda las cifras.

Los intentos 1-4 confirman que el diseño central (recálculo autoritativo,
cotejo cifra por cifra, estrictez ante derivados) funciona cuando se activa.
Los intentos 5-6 muestran que **el interruptor que decide si se activa** es un
regex heurístico con huecos reales y sin ninguna prueba que los cubra.

---

# Tool calling — nota 6/10

Nota anterior: 7. El riesgo declarado era "ni un test unitario" para
`generateWithTools`. Eso ya no es cierto del todo: existe
`openrouter_fallback_costo.test.ts` (cubre el bug B23 — precio por ronda con el
modelo que respondió esa ronda, no el modelo final) y
`tool-executor.test.ts` (dedup de mutaciones, reintento tras fallo,
no-dedup de lecturas) — mejora real y verificada. Pero al revisar a fondo
`LoopGuardError`/`PartialExecutionError` —los dos mecanismos que este mismo
boletín pidió cubrir por nombre— apareció un defecto de contabilidad nuevo, no
solo un hueco de pruebas, que justifica no volver al 7.

## Hallazgos

### [ALTO] `openrouter.ts:339-344` / `463-467` — el costo y los tokens de las rondas previas se pierden cuando el ciclo falla

`PartialExecutionError` (`openrouter.ts:339-344`) solo carga
`(message, cause, partialToolCalls)`. El acumulado `tokIn`/`tokOut`/`costo`
que sí se lleva ronda a ronda dentro de `generateWithTools` (`openrouter.ts:415-419`)
**solo se devuelve en el `return` de éxito** (`openrouter.ts:429`). Cuando el
ciclo termina en error —`LoopGuardError` tras `maxRounds` (`openrouter.ts:463`),
un `AbortError` por el `timeoutMs` de `runAgent`, o cualquier fallo de
`complete()`— el `catch` de `openrouter.ts:464-467` envuelve el error en
`PartialExecutionError` **sin adjuntar nada del consumo acumulado**.

`processor.ts:475-509` (el catch que atrapa esto) nunca llama a
`registrarCosto` en ninguna de sus dos ramas — ni cuando recupera el cierre
parcial (`agent.cierre_parcial_recuperado`) ni cuando falla del todo
(`agent.fail`). Comparar con `generateStructured`, que tiene un mecanismo
dedicado y documentado exactamente para este problema
(`openrouter.ts:211-221`, "OpenRouter cobra la llamada aunque el JSON venga
truncado... se reportaba UN intento habiendo pagado dos, tres o cuatro"): ese
fix nunca se replicó en `generateWithTools`.

Efecto concreto: cualquier liquidación que dispare `CUADRA_RECUPERAR_CIERRE_PARCIAL`
(el camino ya prendido por default en `.env.example:44` para recuperar un
cierre exitoso tras un timeout) gastó dinero real en OpenRouter en las rondas
que sí completaron —incluida la que llamó `guardar_liquidacion`— y ese gasto
nunca se escribe en `costos`. Dado que el modelo de negocio es "cobrar por
liquidación" con un costo objetivo de "$0.03–0.05" (`models.ts:17`), esto
subestima sistemáticamente el costo real de exactamente las liquidaciones más
caras (las que necesitaron varias rondas y aun así tardaron o cayeron al
loop-guard).

### [MEDIO] `LoopGuardError`, `PartialExecutionError`, el cache `crossRound` y el parseo de argumentos siguen sin un solo test directo

`command grep -rn "LoopGuardError\|PartialExecutionError" --include="*.ts" .`
solo devuelve `processor.ts` (consumidor) y `openrouter.ts` (definición) —
cero apariciones en archivos `*.test.ts`. Tampoco hay ningún test que
construya una respuesta con `tool_calls[].function.arguments` inválido para
verificar la rama `args_parse` (`openrouter.ts:440-445`), ni uno que ejercite
`crossRound`/`isReadOnly` (`openrouter.ts:346-347, 448-456`). El único test de
`generateWithTools` que existe (`openrouter_fallback_costo.test.ts`) cubre un
solo eje —precio por ronda con fallback— de los cuatro que pide este rubro.
Esto no es "cero cobertura" como antes, pero sigue siendo cobertura estrecha
justo en la ruta que decide si una liquidación ya guardada le llega al
operador como "listo" o como "se me trabó" (ver hallazgo ALTO arriba: es la
misma ruta).

### Verificado, no es un defecto: argumentos basura y tool en bucle

- **Argumentos basura**: los tres tools registrados (`tools.ts:26,44,68`)
  declaran `properties: {}`; los handlers reciben `_args` y no lo usan —
  cualquier cosa que el modelo mande en `arguments` se ignora, y el JSON
  malformado se captura explícitamente (`openrouter.ts:440-445`) sin tumbar el
  ciclo, devolviendo un mensaje de error al modelo para que reintente. Correcto
  por lectura; sin test que lo pruebe (ver arriba).
- **Misma tool en bucle**: `maxRounds` (default 6, `openrouter.ts:365`) topa el
  ciclo y lanza `LoopGuardError`. Si dentro de esas rondas ya hubo un
  `guardar_liquidacion` exitoso antes de caer en el bucle, la recuperación de
  `processor.ts:484-504` lo encuentra en `partialToolCalls` y sí responde con
  el cuadre real — funciona, pero (a) sin test directo y (b) sin el costo de
  esas rondas contabilizado (mismo hallazgo ALTO).

### `PartialExecutionError`: ¿se maneja o tumba el turno?

Se maneja — el operador SIEMPRE recibe algún mensaje (recuperación con PDF
real, o "se me trabó el sistema tantito" con reintento sugerido); no hay una
ruta donde el turno muera en silencio total. Lo que no se maneja es la
contabilidad de lo gastado en el intento fallido (hallazgo ALTO), que es un
defecto de negocio (costo real no facturable) más que de UX del operador.

### El reloj de presupuesto (`presupuesto.ts`) usado desde `processor.ts`

`crearPresupuesto` está bien diseñado y bien probado
(`presupuesto.test.ts`, `presupuesto_camino.test.ts`): la guarda antes de
lanzar al agente (`processor.ts:445`, `!reloj.alcanza(COSTO_AGENTE_MS)`)
**no** deja al operador sin respuesta — en ese caso manda el resumen
determinístico del motor de inmediato (`processor.ts:448-449`), sin esperar al
LLM. Es la mitigación correcta y está verificada con un test que simula
exactamente el peor caso anterior (barrera+mutex agotando el presupuesto). La
única grieta relacionada es la de la cola de cierre después del agente, que ya
se reportó arriba en el rubro agéntico (`processor.ts:465-547`, sin reloj) por
ser más una cuestión de orquestación que de la primitiva de tool-calling en sí.

## Lo que se sostiene sin cambios (para no repetir el boletín anterior)

- Idempotencia de mutaciones (`tool-executor.ts:74-87`) — ahora con test
  dedicado, ver arriba. Sigue correcta: solo cachea éxitos, un fallo permite
  reintentar.
- Fallback cross-provider en `generateWithTools` (`openrouter.ts:398-407`) —
  ahora con test dedicado (`openrouter_fallback_costo.test.ts`). Correcto:
  solo la llamada de completado se reintenta en otro proveedor; las tools ya
  ejecutadas no se repiten.
- `cuadrar_viaje` sigue fuera de `READ_PREFIXES` (`openrouter.ts:346`), como
  ya se había señalado. Confirmado sin cambios — no es un bug de dinero (el
  cálculo es determinístico y siempre lee el estado más fresco de la DB si se
  repite), es solo una llamada extra que no se cachea entre rondas.
