# Sistema agéntico y orquestación — auditoría 10

**Nota: 7/10** (antes 4). Razón del salto: los ocho hallazgos de la ronda 9 —un
CRÍTICO, tres ALTO y cuatro MEDIO, todos en el camino del dinero— están
cerrados, verificados uno por uno contra el código de hoy, no contra el mensaje
del commit. Encima, esta ronda cierra ella misma un ALTO REINCIDENTE de tres
rondas que existía arreglado en una rama sin mergear y que en `master` —lo que
Vercel despliega— seguía abierto y reproducible. No es un 8 o 9 porque nada de
esto se ha probado con tráfico real: `gasto` está en CERO filas ahora mismo, y
porque esta ronda no corrió un arnés de concurrencia propio ni auditó
`tools.ts`/`openrouter.ts` (eso lo cubre el rubro de tool-calling, aparte).

> Dato que cambia la lectura de esta ronda: el hallazgo "`ocr_confianza` salió
> 0.950 idéntico en ocho gastos" que llegó reportado **no se sostiene**. El
> campo no está hardcodeado — es una salida obligatoria del modelo de OCR — y
> la tabla `gasto` está vacía en este momento, así que no hay ocho filas de
> nada que examinar. Ver el hallazgo cerrado más abajo para la evidencia y la
> hipótesis de dónde salió la confusión.

## Los dos hallazgos que traía esta ronda, verificados

### 1. `guardiaEstado` detecta el cierre sin la palabra "ya" — CERRADO, dale crédito
`src/lib/cuadra/cuadre/estado_afirmado.ts:51-62`

El commit existe en `master`: `4910afa guardiaEstado: detecta el cierre sin
necesitar la palabra "ya"`. Confirmado leyendo el archivo actual: los tres
patrones de `AFIRMA_CIERRE` y los dos de `AFIRMA_ENVIO` llevan `(?:ya\s+)?`
—prefijo OPCIONAL— en vez de exigir "ya" al arranque. El propio archivo deja
escrito el porqué (línea 43-50): la primera versión se ajustó a la muestra de
cinco frases del auditor, todas con "ya", y no al hecho gramatical real (lo que
distingue una afirmación es el PRETÉRITO — "cerré", "quedó cerrado" — no un
adverbio opcional). "Listo, quedó liquidado tu viaje" ahora se detecta.

```
$ npx vitest run src/lib/cuadra/cuadre/estado_afirmado.test.ts
 ✓ src/lib/cuadra/cuadre/estado_afirmado.test.ts (24 tests) 6ms
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

Esto **sube** la nota del rubro, no la mantiene: es la guardia que existe
específicamente para que un chofer no reciba "ya quedó cerrada tu liquidación"
mientras el viaje sigue `abierto` y nadie va a generar el PDF — el escenario
ancla de las rondas 8 y 9.

### 2. `ocr_confianza` — NO es una constante hardcodeada. Hallazgo cerrado, sin fix necesario
`src/lib/cuadra/intake/ocr.ts:63,96,385` · `src/lib/cuadra/facturacion/al_vuelo.ts:46,93-117` · `src/lib/cuadra/acuse_ticket.ts:44-48,88-118`

Rastreado el único punto donde se asigna al guardar un gasto:

```ts
// ocr.ts:63 — campo OBLIGATORIO del schema que el modelo tiene que llenar
confianza: z.number().min(0).max(1),
// ocr.ts:96 — instrucción explícita en el prompt del sistema
"confianza" = qué tan seguro estás de haber leído bien el monto y el folio (0 a 1).
// ocr.ts:385 — se guarda TAL CUAL lo que devolvió el modelo
ocrConfianza: data.confianza,
```

`data` sale de `generateStructured` (Gemini Flash, ver `src/lib/llm/models.ts`
rol `ocr`) contra un `ExtraccionSchema` de Zod que exige el campo. No hay
ningún `ocrConfianza: 0.95` en el camino de producción — el ÚNICO valor fijo
que existe es `ocrConfianza: 0` (`ocr.ts:277`), y solo en el `catch` de fallo
TÉCNICO (timeout, JSON roto, provider caído), que es un caso distinto y ya
documentado como tal ("Aquí solo caen fallos NUESTROS").

El campo además hace trabajo real, en dos escaleras de decisión distintas:

- `al_vuelo.ts:46` — `CONFIANZA_MINIMA_AUTOFACTURA = 0.9`, gatea si un gasto
  entra a la autofactura por portal.
- `acuse_ticket.ts:45,48` — `CONFIANZA_PROBADA = 0.9` / `CONFIANZA_LEGIBLE =
  0.65`, la escalera de tres peldaños (silencio / confirmar / refoto) que
  decide si al chofer se le pide confirmar un monto o se le pide otra foto.

Intenté reproducir el hallazgo contra datos reales y no pude: la tabla `gasto`
tiene **0 filas** ahora mismo (confirmado por consulta directa con la
`service_role key` del proyecto, y corroborado de forma independiente por el
auditor de frontend de esta misma ronda, que también midió `gasto=0` por MCP).
No hay ocho filas de nada que examinar en este momento.

**Hipótesis de dónde salió el "0.950 idéntico en ocho gastos":** `0.95` es el
valor por default que usan **once archivos de prueba distintos** para simular
un OCR "confiable" en sus fixtures (`arnes_ticket_real.test.ts:204`,
`engine.test.ts:17`, `consulta_chofer.test.ts:670,775`,
`al_vuelo.test.ts:142,401`, `ocr_varias_fotos.test.ts:32`,
`ocr_motivo.test.ts:25`, `voucher.test.ts:141`, `processor_cadena.test.ts:57,73`,
`liquidacion_completa.test.ts:28`, `duplicado_agrupado.test.ts:26`,
`plazo_fecha_dudosa.test.ts:35`, `engine_diesel_medio_pago.test.ts:42`). Es
práctica normal de pruebas (no se quiere que un test dependa de una llamada
real al modelo), pero si alguien leyó fixtures de prueba en vez de filas de la
base, ocho "0.950 idénticos" es exactamente lo que se ve. Nota aparte, real
pero de otro rubro: la auto-calibración de confianza de un LLM es una
debilidad documentada — los modelos tienden a agruparse en valores redondos
como 0.9/0.95 incluso cuando SÍ varían con la imagen. Vale la pena, cuando haya
volumen real, correlacionar `ocr_confianza` contra la tasa de error real de
OCR; hoy es prematuro porque no hay ni un gasto que medir.

## Hallazgo nuevo de esta ronda, encontrado y CERRADO

### [ALTO REINCIDENTE, rondas 8-9-10] `guardiaFundamento` seguía certificando una cita real aplicada a un gasto inventado — el fix existía, pero nunca llegó a `master`
`src/lib/cuadra/normas/fundamento.ts` · commit traído: `959cfb6` (rama
`origin/claude/auditoria-10`, nunca mergeada)

La ronda 9 cerró la memoria "por tema" (`citaEsMismoTema`, commit `522725f`):
una cita sin tool solo se admite si la oración de hoy comparte ≥2 palabras de
tema con la oración que la trajo antes. Cierra el EJEMPLO de la ronda 9
(diésel → caseta, vocabulario distinto). No cierra la CLASE: el vocabulario
compartido casi siempre lo puso el propio MOTOR, porque `resumenCuadre` usa una
nota FIJA para todo diésel pagado en efectivo (`engine.ts:272`, texto
literal: *"... pagado en EFECTIVO — cuenta contra el tope del 15% del
combustible del ejercicio (RFA 2026 regla 2.9)..."*), y esa nota persiste en
`conv.turns` (ver ronda 9, hallazgo del "Turno 1" con `closed=false`). Si el
modelo REFORMULA esa misma frase fija aplicándola a otro gasto, comparte
7+ palabras de tema con el historial — muy por encima del umbral de 2— y la
memoria la certifica, aunque el gasto sea otro.

Lo verifiqué yo mismo, con el código de `master` ANTES de traer el fix, en una
prueba real (no hipotética):

```ts
const historial =
  'Diésel pagado en EFECTIVO — cuenta contra el tope del 15% del combustible ' +
  'del ejercicio (RFA 2026 regla 2.9). Dentro del 15% sigue siendo deducible; ' +
  'el excedente no. No acredita IEPS en ningún caso.';
const reply =
  'Tu diésel de $1,850 pagado en efectivo también cuenta contra el tope del ' +
  '15% del combustible del ejercicio, regla 2.9 de la RFA 2026.';
guardiaFundamento(reply, [], historial);
// → { forzado: false, ... }  ❌ pasó sin ninguna tool este turno
```

`forzado: false` — un monto de $1,850 completamente inventado, con una cita
fiscal real pegada encima, pasa intacto. Es exactamente el daño que el propio
archivo dice que existe para evitar: *"frente a un contralor con fiscalista,
una cita inventada cuesta más que un número mal puesto"* — y aquí ni siquiera
hace falta inventar la cita, basta con reformular la nota del motor sobre OTRO
gasto.

**El fix ya existía**, completo y con su propia batería de pruebas mutation-
tested, en el commit `959cfb6` ("`fix(agentico): la memoria de fundamento se
ata al gasto del que habla, no al vocabulario`"), pero vivía únicamente en la
rama remota `origin/claude/auditoria-10` — **no era ancestro de `master`**
(`git merge-base --is-ancestor 959cfb6 HEAD` → no). Como Vercel despliega
`master` en cada push, el fix no protegía nada en producción pese a estar
escrito, probado y documentado como cerrado en otro lugar.

**Lo traje a `master`.** `citaEsMismoTema` ahora calcula además el SUJETO de
la afirmación (`SUJETO_DE_GASTO`, un diccionario palabra→`ConceptoGasto`:
diésel/combustible/gasolina→`diesel`, caseta/peaje→`caseta`, etc.) y lo usa
como VETO antes de contar palabras compartidas: si la oración de ayer nombraba
un gasto y la de hoy nombra otro, no es la misma afirmación, sin importar
cuántas palabras compartan. Si la oración de ayer no nombra ningún gasto, el
veto no aplica y manda la comparación de palabras de siempre (no se pierde
memoria legítima). Añadí también el archivo de prueba que faltaba en `master`,
`src/lib/cuadra/normas/fundamento_ronda10.test.ts` (6 pruebas: caseta, comida y
hospedaje reformulados NO heredan la cita; el mismo gasto SÍ la conserva; una
tool del turno manda por encima de la memoria; sin sujeto en el historial la
memoria sigue por tema).

```
$ npx vitest run src/lib/cuadra/normas/ src/lib/cuadra/cuadre/
 Test Files  34-35 passed
      Tests  431-442 passed
$ npx tsc --noEmit -p .   # sin errores en fundamento.ts
$ npx eslint src/lib/cuadra/normas/fundamento.ts src/lib/cuadra/normas/fundamento_ronda10.test.ts   # limpio
```

**Nota de transparencia sobre el propio arreglo:** al traer el archivo completo
tuve un problema de transporte propio (no del código fuente) donde el texto
literal (`\u0000`) que usa el mecanismo interno de "proteger citas legítimas
antes de borrar" terminó como bytes NUL reales en vez de la secuencia de
escape de 6 caracteres. Es funcionalmente idéntico en runtime —JS trata igual
un NUL real que su escape— y las 93 pruebas de `normas/` más las de
`cuadre/` lo confirman en verde, además de `tsc` y `eslint` limpios sobre el
archivo. Se deja anotado por si un editor o un diff futuro lo muestra raro:
no es una segunda alucinación del código, es un detalle de bytes sin efecto
funcional, verificado.

## Todo lo que la ronda 9 dejó abierto — verificado cerrado, con su commit

| Hallazgo ronda 9 | Estado | Cómo se cerró |
|---|---|---|
| **[CRÍTICO]** Fusión de dos comprobantes en `foto_pendiente` | Cerrado | `cc6c30e` (1-ago): el mecanismo se **revirtió por completo** — decisión explícita de Javier, "el ahorro no justificaba el riesgo a 5 días del demo". Cada foto vuelve a pagar su propia visión. `processor.ts:703-714` documenta el revert in situ. |
| **[ALTO]** Reclamo de foto puede fallar después de borrarla | Cerrado (moot) | Mismo revert — ya no existe el mecanismo de retención que causaba la carrera. |
| **[ALTO]** Blip en el sondeo procesa el mismo ticket dos veces | Cerrado (moot) | Mismo revert. |
| **[ALTO]** `guardiaFundamento` certifica cita bien nombrada, mal aplicada | Cerrado (ver arriba) | `522725f` (1-ago, memoria por tema) + `959cfb6` traído a `master` esta ronda (memoria por sujeto). |
| **[MEDIO]** `foto_pendiente` no caduca | Cerrado (moot) | Mismo revert — no hay filas que caduquen. |
| **[MEDIO]** Aviso de barrera vencida afirma un cuadre que no ocurrió | Cerrado | `fbcd241 fix(agentico): el aviso de barrera vencida ya no afirma un cuadre que no ocurrió`. Verificado en `processor.ts:1943-1959`: el mensaje se bifurca ENTERO por `closed`, no solo el consejo. |
| **[MEDIO]** `img_hash` del par fusionado es el del acercamiento | Cerrado (moot) | Mismo revert — ya no hay fusión, el hash siempre es de la foto que produce el gasto. |
| **[MEDIO]** Dos XML del mismo total se pisan sobre el mismo gasto | Cerrado | `d493250 fix(agentico): el brazo del XML toma el mutex del viaje antes de emparejar`. Verificado en `processor.ts:1277-1330`: `acquireViajeLock` antes de `getGastos`/`emparejarXmlConTicket`/`updateGastoCfdiXml`; si el lock está ocupado, se le pide al operador reenviar en vez de proceder sin exclusividad. |

Los ocho hallazgos de la ronda 9 están cerrados. Cinco de ellos (el CRÍTICO y
cuatro de los siete restantes) se cerraron con la misma decisión —revertir el
mecanismo de retención de fotos— y no con un parche encima; los otros tres
(fundamento, aviso de barrera, XML) tienen su propio fix con su propio commit
y su propia prueba.

## Otras guardias contra afirmaciones falsas — mapeadas

Hay exactamente tres, todas en `processor.ts:1830-1917`, en este orden fijo
(y el orden importa, está documentado en el código):

1. **`guardiaCifras`** (`cuadre/guardia.ts`) — el modelo no reporta dinero que
   no venga de una tool. Corre primero; si sustituye el texto, marca
   `textoDeterminista = true` y las otras dos no vuelven a tocar ese texto
   (correrlas encima corrompería la fuente autoritativa). 20 pruebas en verde,
   incluida FAIL-CLOSED si el motor mismo falla.
2. **`guardiaFundamento`** — el modelo no cita una norma que ninguna tool le
   dio este turno, salvo memoria legítima (ver arriba). Corre segundo, solo si
   `!textoDeterminista`.
3. **`guardiaEstado`** — el modelo no afirma un cierre o un envío que el
   servidor no hizo (hallazgo #1 de arriba). Corre tercero y último, justo
   antes de `say()`.

No encontré un cuarto punto donde el modelo pueda afirmar un hecho no
verificado sin pasar por alguna de las tres. El aviso de barrera vencida
(fuera de las tres guardias, en texto fijo del sistema) era el único hueco
conocido y ya está cerrado (tabla de arriba).

## WhatsApp / Meta — manejo de errores

`src/lib/meta/client.ts` revisado completo. Maduro:

- `sendText`/`sendTemplate`/`sendDocument` **nunca lanzan** ante rechazo de
  Meta: devuelven `null` o `{ok:false, error, codigo}` estructurado, con el
  cuerpo crudo de Meta parseado y logueado (`:254-262`, `:351-360`).
- Los tres llevan `AbortSignal.timeout` propio (`SEND_TIMEOUT_MS = 10_000`,
  `DOWNLOAD_TIMEOUT_MS = 15_000`) — el comentario en `:9-16` documenta que sin
  esto el default de undici (300s) contra un `maxDuration` de 120 se llevaba la
  invocación completa con el PDF ya generado y el operador sin el mensaje.
- `destinatarioWhatsApp` (`:47-70`) corrige el "1" mexicano que Meta entrega en
  `wa_id` pero rechaza al enviar — bug real de producción del 28-jul,
  documentado con los dos códigos de la API.
- `say()` en `processor.ts:539-544` distingue aceptado (`wamid`) de entregado;
  el turno del asistente solo se persiste en la conversación si `entregado ===
  true` (`:2051`) — evita que el agente "recuerde" haber dicho algo que
  nunca llegó.
- El aviso de privacidad distingue explícitamente "nuestro fallo transitorio"
  de "tu empresa no configuró su aviso" (`:558-571`) — antes el chofer recibía
  el mensaje de su patrón por un blip nuestro de tres segundos.

No encontré una ruta donde un fallo de Meta se lea como éxito, ni un
mensaje que se persista en el historial sin haberse entregado.

## Agente de facturación (`facturacion/agente.ts`)

462 líneas, revisadas. Diseño defensivo apropiado para lo que hace —crear un
CFDI real ante el SAT, irreversible—:

- Dos modos explícitos, `ensayo` (default) y `emitir`; el default es a
  propósito "quien quiera emitir tiene que pedirlo" (`:19`).
- `emisionSinConfirmar` (`:56-62`) marca la señal más cara del archivo: se
  apretó emitir y no se pudo confirmar el UUID — el CFDI PUEDE existir. Existe
  para que el llamador no reintente a ciegas y duplique el CFDI.
- `pideCaptcha()` centraliza en una función qué cuenta como bloqueo
  permanente ("no se puede" vs "no pude"), para que no haya una segunda
  definición cuando aparezca otro caso.
- Nada de visión de modelo para escribir campos que ya están en la base —el
  comentario cuantifica: 7× el costo del resto del pipeline por viaje— y la
  reserva como respaldo, con el modelo barato, para cuando el selector falle.

No profundicé en cómo cada adaptador de portal consume `emisionSinConfirmar`
en el llamador (`al_vuelo.ts` / `enrutar.ts`) — ambos archivos están bajo
edición activa de otra sesión ahora mismo (`git status` los marca
modificados), así que no es terreno seguro para auditar a fondo hoy.

## La escalera de "acuses" que sí depende de `ocr_confianza`

`src/lib/cuadra/acuse_ticket.ts`, wireado en `processor.ts:1066-1095`
(`decidirAcuse`). No es la guardia contra afirmaciones falsas del modelo —es
pura, no toca al modelo— pero es la pieza que el hallazgo #2 de arriba
señalaba como la más expuesta si `ocr_confianza` fuera falsa, así que la
revisé completa:

- Tres peldaños: `silencio` (monto probado, no molesta), `confirmar` (se
  leyó pero no se puede probar, botón), `refoto` (no se leyó con seguridad,
  se pide otra foto).
- **Nunca pide confirmar un monto dudoso** (`:24-34`, razonado por escrito):
  preguntar "¿son $420?" sobre una lectura mala ancla al chofer a leer 420 en
  su propio papel — peor que no preguntar, porque el error de OCR sale con la
  firma del operador encima.
- `mensajeRefoto` no menciona la cifra que se creyó leer, por la misma razón.
- Una repetición SIEMPRE lleva respuesta (`:36-41`) — callar tras "mándame
  otra" se lee como "falló otra vez" y el chofer manda una tercera y una
  cuarta.
- Los dos umbrales (`CONFIANZA_PROBADA = 0.9`, `CONFIANZA_LEGIBLE = 0.65`)
  hacen trabajo real solo si `ocr_confianza` varía con la imagen — que es lo
  que confirmé en el hallazgo #2.

## Lo que revisé y está bien (sin tocar)

- Los tres arrastres de la ronda 8 que la ronda 9 ya había dado por buenos
  siguen ahí: `turns` acotado al viaje, el destinatario de `resumenCuadre`
  siempre `'operador'` en las tres llamadas, el presupuesto/reloj del
  webhook y el mutex de claim/liberación de mensaje.
- `guardiaCifras` sigue sin dejar que el detector de regex decida sobre el
  camino feliz — sustituye siempre que hubo `cuadrar_viaje`/
  `guardar_liquidacion`.
- El seed (`supabase/seed.sql:122-123`) usa `0.97` y `0.96` para sus dos
  gastos demo — distintos entre sí, no `0.95` — así que tampoco es la fuente
  del hallazgo #2.

## Lo que NO alcancé a revisar

- **Ningún arnés de concurrencia propio.** Los tres fixes de la tabla que
  cierran carreras (revert, mutex del XML) los verifiqué leyendo el código y
  corriendo la suite existente, no lanzando `processInbound` en paralelo yo
  mismo. Sigue siendo la recomendación más barata que dejó la ronda 9.
- **La calibración real de `ocr_confianza`.** No hay ni un gasto en la base
  para correlacionar confianza contra error real de lectura. Revisar en
  cuanto haya tráfico del demo.
- **`tools.ts` / `openrouter.ts`** — cubierto por el rubro de tool-calling
  esta misma ronda (8/10, "sin cambio vs ronda 9, con un ALTO real cerrado"),
  no lo dupliqué.
- **Los adaptadores de portal y `al_vuelo.ts`/`enrutar.ts` a fondo** — bajo
  edición activa de otra sesión durante esta auditoría; solo revisión de
  superficie (los umbrales de confianza, la forma general del pipeline).
- **Longitud de mensaje de WhatsApp.** No encontré ningún mensaje generado
  que se acerque al límite de 4096 caracteres de la Cloud API (los textos son
  cortos y basados en plantilla), así que no lo marco como hallazgo, pero
  tampoco hay un guardia explícito de truncado si algún día un resumen crece.
