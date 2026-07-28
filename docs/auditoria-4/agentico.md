# Sistema agéntico y orquestación — auditoría 4

**Nota: 3/10** (antes 4). Razón del movimiento: **deuda que cobró factura**. De los
cinco hallazgos declarados arreglados, tres están cerrados de verdad — pero el
CRÍTICO que causó la caída de 5 a 4 (`guardiaFundamento` no ve una cita sin
palabra clave) **no se tocó**: el commit `59bc958` ni lo menciona, `FORMA_DE_CITA`
está byte por byte igual, y no hay un solo test que lo cubra. Encima el arreglo de
la coma **abrió un agujero nuevo del mismo tipo**: el patrón que se añadió en
`fundamento.ts:56` valida una cita con el INSTRUMENTO EQUIVOCADO. Y fuera de
`normas/`, hay un estado en que la base dice "viaje abierto" y el operador cree
que ya se liquidó, sin ninguna guardia que lo pueda ver.

**El riesgo mayor hoy:** el modelo puede afirmar un ESTADO del sistema ("ya te lo
cerré") sin haber llamado ninguna tool, y ninguna de las dos guardias mira las
afirmaciones de estado — solo cifras y citas. El código ya sabe la verdad
(`processor.ts:505` calcula `closed`) y no la usa para verificar el texto.

---

## Verificación de lo que se declaró arreglado

Todo lo de esta sección es **salida real** de scripts en `/tmp/aud4/*.ts` que
importan los módulos del repo con `npx tsx`. No se modificó ningún archivo.
Línea base confirmada por mí: `npm test` → 501 tests, 50 archivos, verde.

### 1. [crítico] Citas sin palabra clave / sigla invertida / número en palabras → **REINCIDENTE, intacto**

`normas/fundamento.ts:86-90` (`FORMA_DE_CITA`). `git show 59bc958 -- src/lib/cuadra/normas/fundamento.ts`
confirma que el diff **no toca** ni `FORMA_DE_CITA` ni `SIGLAS`. Salida real de los
cuatro casos exactos de la ronda 3, con `permitidas = []`:

```
ENTRA : "Ese gasto no aplica conforme al 45-Z de la Ley del ISR, así que te lo dejo como no deducible."
citas : []      forzado: false
SALE  : idéntico

ENTRA : "Tu saldo final es correcto. Ese gasto no es deducible conforme al 27-III porque el pago fue en efectivo."
citas : []      forzado: false
SALE  : idéntico

ENTRA : "No es deducible: 27-III LISR."
citas : []      forzado: false
SALE  : idéntico

ENTRA : "No es deducible por el artículo veintisiete fracción tres de la LISR."
citas : []      forzado: false
SALE  : idéntico
```

`fundamento.test.ts` (18 tests, verdes) no contiene ninguno de estos casos:
`grep` de `45-Z`, `conforme al`, `27-III LISR` y `veintisiete` no devuelve nada.
El hallazgo se declaró arreglado y **nunca se atacó**.

### 2. [crítico] `guardiaCifras` → `guardiaFundamento` corrompía el resumen del motor → **CERRADO**

`processor.ts:571,574-577,601`. Ahora hay `textoDeterminista`: cuando
`guardiaCifras` devuelve `forzado`, `guardiaFundamento` **no corre**
(`if (!textoDeterminista) try { ... }`, línea 601). El comentario falso de la
ronda 3 se sustituyó por uno que admite el error (líneas 593-600). Los otros dos
caminos que emiten `resumenCuadre` también quedan fuera de la guardia:
`processor.ts:487` (sin presupuesto, `return` antes) y `processor.ts:555`
(cierre parcial recuperado, que entra a `guardiaCifras` con `cuadro=true` →
`forzado=true` → marca `textoDeterminista`). Cerrado por diseño, no por accidente.

### 3. [alto] `limpiar()` colapsaba saltos de línea → **CERRADO**

`normas/fundamento.ts:118-130`. Ahora limpia renglón a renglón con `[ \t]`, no
`\s`. Salida real sobre el formato multilínea de `resumenCuadre`, quitando una
cita inventada:

```
Listo, cuadré tu viaje 👇
• Comprobado: $5,000.00
• Anticipo: $6,000.00

Ojo con esto:
• Peaje excede el tope ( de la LISR) — no deducible.

Acreditable (recuperable):
• IVA: $200.00
```

Las líneas en blanco y los bloques se conservan. (Queda el paréntesis vacío
`"( de la LISR)"` porque `\(\s*[,;]?\s*\)` solo limpia paréntesis totalmente
vacíos — cosmético, no lo cuento como hallazgo.)

### 4. [alto] `"artículo 27, fracción III"` → **CERRADO A MEDIAS, y lo que abrió es peor**

La detección y la protección **sí** funcionan ahora:

```
ENTRA : "No es deducible según el artículo 27, fracción III de la LISR."
perm  : ["lisr-27-fr-III"]   citas: ["lisr-27-fr-III"]   forzado: false
SALE  : idéntico   ← antes salía "No es deducible según el, fracción III de la LISR."
```

Pero el patrón nuevo de `fundamento.ts:56` (`sin instrumento cerca`) acepta
artículo+fracción **sin comprobar de qué ley se habla**. Ver hallazgo CRÍTICO 2.
Y sin permiso, la limpieza se lleva la frase entera: `"No es deducible según el."`

### 5. [medio] Sufijos de LETRA en `CITA_DESCONOCIDA` → **REINCIDENTE**

`normas/fundamento.ts:185` sigue con `(?:-[IVXLC]+)?`. Salida real:

```
ENTRA : "Esto se basa en el LIF 2026 Art. 20-B, que no existe."
SALE  : "Esto se basa en el -B, que no existe."

ENTRA : "Esto se basa en el CFF 69-D."
SALE  : "Esto se basa en el -D."
```

(`CFF 69-C` sí se limpia entero, pero por accidente: la `C` es un carácter romano.)

---

## Hallazgos

### [CRÍTICO] `guardiaFundamento` sigue ciego a la cita sin palabra clave, con sigla invertida o con el número en palabras — REINCIDENTE
`src/lib/cuadra/normas/fundamento.ts:86-90`
Escenario: el agente responde `"Ese gasto no aplica conforme al 45-Z de la Ley del
ISR"` con `permitidas = []`. `citasEnTexto` devuelve `[]`, `forzado = false`, el
texto sale idéntico por `processor.ts:612`. Igual con `"conforme al 27-III"`,
`"27-III LISR"` y `"artículo veintisiete fracción tres"`. `FORMA_DE_CITA` exige
literalmente `artículo|art.|arts.|regla|fracción|fr.` pegado a dígitos, o una
SIGLA **antes** del número; las tres formas más naturales del español hablado no
cumplen ninguna de las dos.
Consecuencia: la promesa que el módulo escribe en su propia cabecera ("con esto es
una propiedad del código") es falsa. El contralor —que en el demo trae fiscalista—
recibe por WhatsApp un artículo que nadie autorizó y que puede no existir.
Causa raíz probable: `FORMA_DE_CITA` es una lista de formas conocidas, no un
detector de "esto tiene pinta de referencia legal"; nunca se amplió.
(**REINCIDENTE** de auditoría 3, hallazgo 1. Declarado arreglado, no tocado.)

### [CRÍTICO] El patrón que se añadió para arreglar la coma valida una cita con el INSTRUMENTO EQUIVOCADO
`src/lib/cuadra/normas/fundamento.ts:56`
El arreglo agregó `out.push(new RegExp('(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}', 'i'))`
—artículo + fracción, **sin `quien`**— con el comentario *"Se acepta porque la
fracción ya identifica la norma sin ambigüedad."* No la identifica: identifica el
número, no la ley. Salida real, con `permitidas = ['lisr-27-fr-III']` (el permiso
que `cuadrar_viaje` emite en `tools.ts:88` para `sin_cfdi`,
`combustible_efectivo` y `efectivo_sobre_tope` — el caso más común del producto):

```
ENTRA : "Ese diésel no es deducible por el artículo 27, fracción III del Código Fiscal de la Federación."
citas : ["lisr-27-fr-III"]      forzado: false
SALE  : idéntico

ENTRA : "No es deducible por el artículo 27, fracción III de la Ley del IVA."
SALE  : idéntico

ENTRA : "El tope diario lo pone el artículo 28, fracción V del Código Fiscal de la Federación."   (perm: lisr-28-fr-V)
SALE  : idéntico
```

CFF 27 fr. III es el registro del RFC, no tiene nada que ver con pagos en
efectivo. La guardia no solo deja pasar la cita: la **aprueba** como si la tool la
hubiera autorizado.
El mismo mecanismo, por falta de frontera al final del número, valida artículos
que no existen aunque el instrumento sí coincida (todos con `permitidas`
alcanzables por `NORMA_POR_DIFERENCIA`):

```
"conforme a la RFA 2026 regla 2.9.1"        perm ['rfa-2026-2.9']  → citas ['rfa-2026-2.9'], intacto
"conforme a la regla 2.91 de la RFA 2026"   perm ['rfa-2026-2.9']  → intacto
"el artículo 570 del RLISR"                 perm ['rlisr-57']      → intacto
"el artículo 29-A9 del CFF"                 perm ['cff-29-A']      → intacto
```

Consecuencia: peor que el hallazgo anterior. Ahí la guardia se quedaba callada;
aquí certifica. Un fiscalista que busque "RFA 2026 regla 2.9.1" no encuentra nada
y concluye que el producto inventa fundamentos — que es exactamente el daño que
`guardiaFundamento` existe para evitar.
Causa raíz probable: `patronesDe` usa el mismo regex para DETECTAR y para
AUTORIZAR, y los patrones se ensancharon (`sep`, patrón sin instrumento) mirando
solo los falsos negativos, sin frontera de fin de número ni verificación del alias.

### [CRÍTICO] Ninguna guardia mira las AFIRMACIONES DE ESTADO: el modelo puede decir "ya te lo cerré" sin haber cerrado nada
`src/lib/cuadra/cuadre/guardia.ts:51` · `src/lib/cuadra/processor.ts:505,612,625,638`
Escenario, con salida real de `tieneCifrasDeDinero` y `guardiaFundamento`:

```
reply del modelo : "Ya quedó cerrada tu liquidación ✅. En un momento te llega el PDF."
toolCalls        : []                       → cuadro = false
tieneCifrasDeDinero → false                 → guardia.ts:51 sale sin tocar el texto
guardiaFundamento   → forzado: false        → texto final idéntico
```

Lo mismo con `"Listo, ya te lo cerré. Tu liquidación va en camino 📄"`,
`"Sí, ya recibí todos tus comprobantes y ya cerré el viaje."` y
`"Tu viaje ya está liquidado, no tienes nada pendiente."`
Después: `closed = false` (`processor.ts:505`, no hubo `guardar_liquidacion`) → el
bloque del PDF (625) no corre → `saveConversation(..., viajeId)` (638) deja el
viaje abierto. El operador deja de mandar comprobantes y espera un PDF que no
existe; `viaje.estatus` sigue `'abierto'`.
Consecuencia: es el anclaje de "3 o menos" del rubro — la base dice una cosa y el
usuario cree otra. En la sala: el chofer del demo recibe "ya quedó" y el panel del
contralor no muestra la liquidación. Y para la flota, un viaje que nadie liquida
porque los dos lados creen que ya está.
Causa raíz probable: se construyeron dos backstops para lo que el modelo puede
NARRAR (cifras, citas) y ninguno para lo que puede AFIRMAR del sistema, aunque
`processor.ts:505` ya tiene el booleano que lo contradiría.

### [ALTO] El historial de conversación no está ligado al viaje: los turnos del viaje anterior entran al prompt del siguiente
`src/lib/cuadra/conv.ts:60-78` (`loadConversation`) · `processor.ts:466-468,638`
`loadConversation(tenantId, telefono, viajeId)` usa `viajeId` **solo en el INSERT**
(línea 74); en la rama de fila existente (68-71) devuelve `estado.turns` sin
filtrar por viaje. `saveConversation` (100-105) pone `viaje_id = null` al cerrar
pero **conserva los turnos**.
Escenario: viaje A cierra y el último turno de asistente guardado es
`"Listo, cuadré tu viaje 👇 • Comprobado: $5,000.00 • Anticipo: $6,000.00 • Sobró
$1,000.00 del anticipo"`. La flota abre el viaje B (anticipo $9,000). El operador
manda fotos y escribe "listo". `history` (processor.ts:468) llega al modelo con el
par `user:"listo"` / `assistant:"Listo, cuadré tu viaje… $5,000.00…"` del viaje A
como si fuera esta conversación.
Consecuencia: si el modelo repite una cifra, `guardiaCifras` lo tapa
(`guardia.ts:70-79`); si concluye que "eso ya lo cerré", nada lo tapa — es la
munición del CRÍTICO anterior. Además el prompt paga tokens de un viaje ajeno
todos los turnos.
Causa raíz probable: la conversación está modelada por (tenant, teléfono) y el
`viaje_id` de la fila se guarda pero nunca se usa como condición de lectura ni de
reseteo.

### [ALTO] `claimMessage` fail-closed y `releaseMessageClaim` descansan en un reintento de Meta que `route.ts` hace imposible
`src/lib/cuadra/conv.ts:92-97` · `src/lib/cuadra/processor.ts:159-162,644` ·
`src/app/api/webhook/whatsapp/route.ts:66-75`
`route.ts` responde `NextResponse.json(...)` (línea 75) y hace el trabajo en
`after()` (67). Meta ya recibió su 200: **no reintenta nunca** — lo dice el propio
`presupuesto.ts:5-7`. Pero `conv.ts:94-95` afirma lo contrario (*"el retry de Meta
lo reprocesará cuando la DB responda"*) y `processor.ts:642-644` monta un
at-least-once sobre la misma premisa.
Escenario: el operador escribe "listo"; el `insert` en `wa_mensaje_procesado` cae
por un error transitorio de Supabase (pool agotado, 503, timeout) — código
distinto de `23505`. `claimMessage` devuelve `false`; `processor.ts:159-162` loguea
`wa.duplicate` (nivel **info**, y el diagnóstico es falso: no era un duplicado) y
hace `return`. **Cero mensajes salientes, para siempre.** Ese "listo" no existe
para nadie.
Consecuencia: el caso "se trabó" en su forma más pura — el usuario nunca recibe su
salida y el log dice "duplicado". A las 3 a.m. nadie encuentra esto. Y
`releaseMessageClaim` es maquinaria inerte: libera un claim que nadie va a volver
a usar.
Causa raíz probable: la decisión fail-closed (correcta para no duplicar un gasto)
se aplica igual al texto, donde no hay dinero que duplicar y sí una respuesta que
perder; y el comentario que la justifica describe una plataforma distinta a la que
`route.ts` implementa.

### [ALTO] Se cierra la liquidación, el PDF no se generó, y el operador no recibe ni el PDF ni una sola línea de log
`src/lib/cuadra/processor.ts:625-636` · `src/lib/cuadra/tools.ts:132-142`
`guardar_liquidacion` devuelve `pdf_generado: Boolean(pdfPath)` (tools.ts:141) y
pone `pdfPath = undefined` si `generarLiquidacionPDF` lanza (134) o si el upload a
storage falla (132). El motor **guarda la liquidación igual** (136).
`processor.ts:625` solo mira `closed` y **nunca lee `pdf_generado`**: pide una URL
firmada de `${tenantId}/${viajeId}.pdf`, que no existe. `createSignedUrl` no lanza:
devuelve `{ data: null, error }`, y el `error` se descarta en el destructuring
(`const { data } = ...`, línea 628). `data?.signedUrl` es falsy → no se manda nada,
no hay `else`, el `catch` (633) no se dispara.
Escenario: el operador cierra su viaje, recibe *"Listo, cuadré tu viaje 👇 …"* y
—porque `prompts.ts:25` instruye "Avísale que le llega su liquidación en PDF"—
espera el documento. No llega. En los logs no hay `pdf.send`, no hay warn, no hay
nada; solo el `pdf.gen`/`pdf.upload` del otro módulo, sin viaje ni tenant en el
caso del upload.
Consecuencia: la liquidación queda cerrada en la base, el operador se queda sin
comprobante, y el equipo no tiene señal de que pasó. En el demo es el paso 3 del
guion ("Llega el PDF de la liquidación") fallando en silencio.
Causa raíz probable: el dato que decide (`pdf_generado`) viaja en el resultado de
la tool y se tira; el cierre del ciclo con el humano se infiere del estado de la
BD en vez de comprobarse.

### [ALTO] El PDF que se le manda al chofer trae los veredictos que `resumenCuadre` le oculta a propósito
`src/lib/cuadra/processor.ts:630` · `src/lib/cuadra/cuadre/resumen.ts:24-28,62` ·
`src/lib/cuadra/liquidacion/pdf.ts:336-356`
`resumen.ts` define `SOLO_CONTRALOR` y filtra del mensaje al operador
`cfdi_efos`, `cfdi_cancelado`, `cfdi_no_encontrado`, `rfc_receptor`,
`texto_sospechoso`… con el argumento explícito de que son cosas que el chofer no
puede arreglar y que además lo señalan. `guardia.ts:79` y `processor.ts:487,555`
pasan `'operador'` con cuidado. Y acto seguido, `processor.ts:630` hace
`sendDocument(msg.from, ...)` — el mismo teléfono del chofer — con el PDF, que
imprime `liq.diferencias` **completo** (`pdf.ts:336`, sin filtro por destinatario,
y con el comentario "nunca se truncan").
Escenario: viaje con una factura de diésel de un emisor en la lista 69-B. WhatsApp
al operador: el veredicto no aparece. Diez segundos después, en el mismo chat,
llega `liquidacion.pdf` con la línea *"El emisor del CFDI de Diésel está en lista
negra del SAT (EFOS) — no deducible."* (`engine.ts:207`) y, si el RFC receptor no
es el de la empresa, *"Factura de Diésel timbrada al RFC XAXX010101000 (no es de
la empresa) — no deducible."* (`engine.ts:199`).
Consecuencia: la defensa deliberada del texto no vale nada — el mismo destinatario
recibe todo, en un documento que además puede reenviar. Es el "destinatario
equivocado" del rubro, y es el paso del demo que el contralor va a ver proyectado.
Causa raíz probable: el concepto `Destinatario` existe en `resumen.ts` y no se
propagó a `pdf.ts`; el PDF se diseñó como papel del contralor y se entrega por el
canal del operador.

### [ALTO] El XML que el propio mensaje le pide al operador se rechaza si llega después del cierre
`src/lib/cuadra/processor.ts:195-199,360-420` · `src/lib/cuadra/cuadre/engine.ts:235,418`
`complemento_no_verificable` **no** está en `SOLO_CONTRALOR` (decisión explícita,
`resumen.ts:30-37`), así que el operador recibe literalmente *"La factura de Diésel
es de combustible: reenvía el XML (el que te manda la gasolinera por correo) para
verificar el complemento de hidrocarburos."* Ese texto llega en el MISMO mensaje
de cierre, cuando `guardar_liquidacion` ya puso `viaje.estatus = 'liquidado'`
(`0013_guardar_liquidacion_tx.sql:46`).
Escenario: el operador obedece y reenvía el XML del CFDI de $8,000 de diésel.
`processInbound` llega a `getOpenViaje` (195), que solo acepta `'abierto'` y
`'en_cuadre'` → `null` → responde *"No tienes un viaje abierto para liquidar
ahorita"* (197) y **descarta el XML sin guardarlo en ningún lado**. La rama de
documento (360-420) nunca se ejecuta.
Consecuencia: `engine.ts:418` (`if (!g.xmlVerificado) continue;`) deja ese gasto
fuera del acreditamiento para siempre: ~$1,103 de IVA no acreditable y los litros
de diésel que alimentan el estímulo del LIF 20-A nunca se cuentan. El producto
pide un documento y luego se niega a recibirlo — sobre la función que el guion del
demo vende en el minuto 4.
Causa raíz probable: el corte por "sin viaje abierto" está antes de la rama de
documento (el mismo error que ya se corrigió para el medio ARCO en `59bc958`,
moviéndolo antes del corte — se arregló el caso y no la clase).
Nota del mismo hilo, sin caso construible aquí: la barrera de ráfaga solo cuenta
**fotos** (`intakeDelta(+1)` en `processor.ts:222`); la rama de documento no la
incrementa ni toma el mutex, así que la garantía del comentario de `processor.ts:428-430`
("así 'listo' nunca cierra sobre datos parciales") no cubre el XML: solo gana por
ser más rápido que el ciclo del agente en el caso típico.

### [MEDIO] Cuando hubo cuadre, la respuesta del modelo se descarta al 100% — el operador no puede obtener respuesta a nada
`src/lib/cuadra/cuadre/guardia.ts:37-39,51,79` · `src/lib/agents/prompts.ts:21-27`
`cuadro` es `true` si `cuadrar_viaje` **o** `guardar_liquidacion` corrieron sin
error; con `cuadro=true`, `guardia.ts:51` no puede salir temprano y la línea 79
sustituye el texto por `resumenCuadre` **siempre**, sin mirarlo.
Escenario: turno 2, el operador pregunta *"¿y la caseta de la autopista sí me la
contaron?"*. El agente llama `cuadrar_viaje` (que es lo que el prompt le ordena en
el paso 2) y responde la pregunta. `guardia.ts:79` tira esa respuesta y manda otra
vez el cuadre completo. El operador vuelve a preguntar y recibe el mismo bloque.
Consecuencia: el prompt (`prompts.ts:25`) le pide al modelo que explique en
lenguaje simple; ese texto no llega nunca al usuario en el camino feliz — se paga
y se tira. En el demo, cualquier pregunta improvisada del contralor sobre el chat
recibe el mismo mensaje enlatado.
Causa raíz probable: el backstop determinístico se aplica con granularidad de
TURNO en vez de granularidad de AFIRMACIÓN; es la decisión correcta para el turno
del cierre y la equivocada para todos los demás.

### [MEDIO] `CITA_DESCONOCIDA` deja el sufijo de letra huérfano — REINCIDENTE
`src/lib/cuadra/normas/fundamento.ts:185`
`(?:-[IVXLC]+)?` solo absorbe romanos. Entra `"Esto se basa en el LIF 2026 Art.
20-B, que no existe."` → sale `"Esto se basa en el -B, que no existe."` Entra
`"Esto se basa en el CFF 69-D."` → sale `"Esto se basa en el -D."` El propio índice
usa sufijos de letra (`LIF 2026 Art. 20-A`, `CFF 69-B`, `CFF 29-A`), así que es la
forma que un modelo copia del contexto que le dieron.
Consecuencia: el contralor lee una frase rota justo en el renglón del fundamento;
es visible y es el momento en que se está juzgando la seriedad del producto.
Causa raíz probable: la limpieza de desconocidas se derivó del formato de fracción
romana, no del formato real del índice.
(**REINCIDENTE** de auditoría 3, hallazgo 5.)

---

## Lo que revisé y está bien

- **Orden de las guardias y no-corrupción del texto determinístico**
  (`processor.ts:571,574-577,601`). El `textoDeterminista` cierra el crítico 2 de
  la ronda 3, y los tres caminos que emiten `resumenCuadre` quedan cubiertos:
  `487` (sale antes), `555` (marca el flag vía `guardiaCifras`), `guardia.ts:79`.
- **`limpiar()` renglón a renglón** (`fundamento.ts:118-130`). Verificado con el
  formato multilínea real de `resumenCuadre`: viñetas, líneas en blanco y bloques
  sobreviven.
- **Protección de citas legítimas antes de borrar** (`fundamento.ts:166-175,200`).
  El truco del placeholder (byte NUL + índice + NUL) funciona y la limpieza
  genérica de `CITA_DESCONOCIDA` no lo puede tocar: `[\d.]+` exige un dígito
  inmediatamente tras la palabra clave y ahí hay un NUL. Intenté romperlo con
  "regla" + una permitida y no cedió.
- **`normasDeToolCalls`** (`fundamento.ts:212-224`). Lee solo el `result` de la
  tool, con cota de profundidad 6, y valida contra `NORMAS[...]`. No hay forma de
  que el texto del modelo se auto-autorice.
- **Mutex del viaje y abandono silencioso** (`processor.ts:451-456`,
  `conv.ts:128-174`). La distinción error permanente (RPC ausente → fail-open con
  `logger.error`) / transitorio (reintenta con backoff, y solo abre tras agotar la
  ventana) está bien razonada, y `processor_lock.test.ts` cubre las tres ramas
  incluida "tampoco le escribe al operador".
- **Doble "listo"** (`processor.ts:460-463`). Re-verifica `getOpenViaje` DESPUÉS
  de tomar el lock y responde algo coherente en vez de re-correr el agente.
- **Presupuesto compartido** (`presupuesto.ts` completo). `MARGEN_CIERRE_MS`, el
  `acotar`, y `senal()` devolviendo una señal YA abortada cuando no queda tiempo
  son correctos; `presupuesto_camino.test.ts` (6 tests) cubre el peor caso, el
  caso normal y la regresión de "sin reloj compartido no cabría". El corte
  `alcanza(15_000)` con fallback determinístico (`processor.ts:483-493`) es el
  cierre correcto para ese punto de muerte.
- **Barrera de ráfaga para FOTOS** (`conv.ts:194-226`, `processor.ts:222,351,431`).
  El `+1` es la primera línea del intake y el `-1` vive en un `finally`; la gracia
  anti-carrera ya está en `2_000` por defecto (`conv.ts:216`) — el flag C2 de
  AUDIT_V3 dejó de ser opcional. `barrera.test.ts` (5 tests) cubre gracia on/off,
  espera normal y timeout. Cuando vence, el operador recibe aviso explícito con el
  conteo real (`processor.ts:616-623`): falla visible, no silenciosa.
- **Costo del cierre parcial** (`processor.ts:531-540`). Se registra ANTES de
  decidir si se recupera, así que el gasto no se pierde aunque el cierre no se
  pueda salvar. Bien puesto.
- **`generateWithTools` envuelve TODO en `PartialExecutionError`**
  (`openrouter.ts:523-526`), incluidos el abort del timeout y el `LoopGuardError`,
  con `executed`, tokens y costo. La materia prima para recuperar un cierre
  huérfano existe de verdad.
- **`cifras.ts`** (56-64, 127-130). El portón ancho y `hablaDeDineroSinCifraVerificable`
  siguen cerrando el bypass de la ronda 2; probé `"Tu resultado final: 8000"`,
  `"Te sobraron ocho mil pesos"` y `"Tu saldo: 500 a tu favor"` — los tres marcan.
- **Prompt** (`prompts.ts:29-34`). El bloque de SEGURIDAD trata folios y textos de
  comprobante como datos, no instrucciones, y niega el "modo administrador". No
  encontré ninguna línea del prompt que autorice narrar cifras sin tool: dice lo
  contrario en 31 y 32. El problema no es el prompt, es que las guardias no cubren
  las afirmaciones de estado.
- **`startup.ts`**. Los probes de 0005/0011/0016/0017 convierten migraciones
  faltantes en errores ruidosos al arrancar. (Detalle menor, sin caso de fallo: el
  `return` en cada rama impide ver más de una migración faltante por despliegue.)

## Lo que NO alcancé a revisar

- **Todo lo que necesita Postgres.** `try_lock_viaje`, `intake_delta`,
  `guardar_liquidacion_tx`, `reclamarEnvioAviso` y los claims atómicos los leí en
  SQL pero no los ejecuté. La concurrencia real (dos `after()` compitiendo por el
  lease, el TTL de 60s contra un `maxDuration` de 60s) queda sin verificar —
  `supabase/verificaciones.sql` existe para eso y aquí no se puede correr.
- **El ciclo de tool-calling contra un modelo real.** `tool-executor.ts`, el
  fallback cross-provider y el comportamiento del `AbortSignal` de `run.ts:32-34`
  bajo latencia real no se pueden observar sin OpenRouter. En particular no probé
  si el `controller.abort()` de `run.ts` deja alguna tool a medio ejecutar.
- **El recorrido con `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`.** Leí la rama
  (`processor.ts:522-559`) y me parece coherente, pero el flag está apagado por
  defecto y no monté un arnés para ejercitarla. El estado huérfano con el flag
  APAGADO ya está documentado en `docs/conocimiento/51-boletin-tecnico.md:101`;
  no lo cuento como hallazgo nuevo, pero sigue abierto y es del mismo tipo que el
  CRÍTICO de afirmación de estado.
- **Cuántos turnos de historial hacen falta para que el modelo afirme un cierre
  falso.** El mecanismo del CRÍTICO 3 lo verifiqué en las guardias (determinístico);
  la probabilidad de que el modelo lo diga no la medí — haría falta correr el
  agente real, que aquí no se puede.
- **`agents/liquidacion/`** aparece en el MAPA como parte del rubro; no existe en
  el repo (`ls src/lib/agents/` → `prompts.ts`, `registry.ts`, `run.ts`,
  `types.ts`, `prompts.test.ts`). El MAPA está desactualizado en ese punto.
