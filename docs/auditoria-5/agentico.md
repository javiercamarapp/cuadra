# Sistema agéntico y orquestación — auditoría 5

**Nota: 4/10** (antes 3). Razón: **se atacó y subió**. De los siete hallazgos que
dejé abiertos en la ronda 4, **cinco están cerrados de verdad y con prueba** —el
historial ligado al viaje, el `claimMessage` de tres estados, el cierre sin PDF,
el PDF del operador filtrado, y el XML que llega tarde—. No sube más porque el
anclaje de "3 o menos" —*existe un estado donde la base dice una cosa y el
usuario cree otra*— **sigue existiendo por dos caminos distintos**, y uno de
ellos es nuevo.

**El riesgo mayor hoy:** el entregable del producto sale del sistema sin ninguna
comprobación de entrega. `sendDocument` da por bueno el 200 de Meta —que
significa *aceptado*, no *entregado*— y el único aviso que Meta da cuando la
entrega falla después (`value.statuses`) **no lo lee nadie**: `extractMessages`
solo recorre `value.messages`. Es exactamente el caso real sin explicar de esta
ronda: liquidación cerrada, PDF en storage, operador sin nada, y cero líneas en
el log.

---

## Verificación de lo que se declaró arreglado

Todo lo de abajo es **salida real** de scripts en el scratchpad que importan los
módulos del repo con `npx tsx`. No modifiqué ningún archivo. `HEAD` = `86e23aa`,
árbol limpio al momento de escribir (`git status --porcelain` → solo
`?? docs/auditoria-5/`).

| Ronda 4 | Estado hoy | Evidencia |
|---|---|---|
| CRÍTICO 1 · citas sin palabra clave / sigla invertida / número en palabras | **A medias** | se detectan (`forzado:true`), **dos de cuatro salen intactas** → sigue abajo |
| CRÍTICO 2 · la guardia certifica la ley equivocada | **A medias** | cerrado a ≤45 caracteres; **abierto a >45 y con sufijo de letra** → sigue abajo |
| CRÍTICO 3 · afirmaciones de estado | **REINCIDENTE** (decisión declarada) | ninguna guardia las mira; sigue abajo |
| ALTO · historial no ligado al viaje | **CERRADO** | `conv.ts:124-128` (`mismoViaje`) + `conv_historial.test.ts` (5 casos) |
| ALTO · `claimMessage` fail-closed sobre un retry inexistente | **CERRADO** | `conv.ts:143-169` tres estados + `processor.ts:164-172` sigue en `indeterminado` |
| ALTO · cierre sin PDF invisible | **CERRADO** para la generación | `processor.ts:673-695` lee `pdf_generado`, avisa al operador, `pdf.no_entregado` + `processor_cierre.test.ts` (5 casos). **No cubre la entrega** → sigue abajo |
| ALTO · el PDF le daba al chofer lo que el mensaje le ocultaba | **CERRADO** | `tools.ts:138-139` genera dos ejemplares; `processor.ts:678` firma `-operador.pdf` |
| ALTO · el XML que pedimos se descartaba tras el cierre | **CERRADO** | `processor.ts:220-229` lo guarda por UUID y se lo dice al operador |
| MEDIO · sufijo de letra huérfano en `CITA_DESCONOCIDA` | **REINCIDENTE** | sigue abajo |
| MEDIO · con `cuadro=true` se tira el 100% de la respuesta del modelo | **REINCIDENTE** | `guardia.ts:37-39,51,79` byte por byte igual |

---

## Hallazgos

### [CRÍTICO] La guardia de fundamento AUTORIZA citas que ninguna tool devolvió: basta alejar la ley 45 caracteres, o cambiarle la letra al artículo permitido
`src/lib/cuadra/normas/fundamento.ts:52-65` (`patronesDe`) · `:97` (`FIN_DE_NUMERO`)

El arreglo de la ronda 4 (`11c9529`) metió dos frenos: el lookahead
`salvoOtraLey` (línea 64), que solo mira `[^.]{0,45}`, y `FIN_DE_NUMERO`
(`(?![.-]?\d)`), que solo corta ante un **dígito**. Los dos se rodean sin
esfuerzo. Salida real:

```
perm  : ["lisr-27-fr-III"]
ENTRA : "Ese diésel no es deducible por el artículo 27, fracción III, que es la regla
         general de los pagos en efectivo que trae el Código Fiscal de la Federación."
citas : ["lisr-27-fr-III"]   forzado: false      ← la guardia lo APRUEBA
SALE  : idéntico

perm  : ["lif-2026-art-20-A"]
ENTRA : "El estímulo del diésel sale del LIF 2026 Art. 20-B, apartado que aplica a tu caso."
citas : ["lif-2026-art-20-A"]   forzado: false
SALE  : idéntico

perm  : ["lif-2026-art-20-A"]
ENTRA : "Te aplica el estímulo del 50% de peaje conforme al LIF 2026 Art. 20-C."
citas : ["lif-2026-art-20-A"]   forzado: false
SALE  : idéntico

perm  : ["cff-29-A"]
ENTRA : "Falta un requisito del CFF 29-AB."
citas : ["cff-29-A"]   forzado: false
SALE  : idéntico
```

Control, para que se vea que es la distancia y no otra cosa: la MISMA cita con el
CFF a 20 caracteres (`"…fracción III del Código Fiscal de la Federación."`) sí se
caza (`citas: ["DESCONOCIDA"]`, `forzado: true`).

`lif-2026-art-20-A` es la norma que `normasDe` emite en **el caso más vendido del
producto** (estímulo de diésel y 50% de peaje), y su `citas[0]` es literalmente
`"LIF 2026 Art. 20"` (`indice.ts:161`), así que cualquier apartado inventado que
el modelo le cuelgue detrás —`20-B`, `20-C`— entra por el patrón literal.

Consecuencia: es el hallazgo que la ronda 4 marcó como *"peor que callarse:
certifica"*, vivo con otra forma. El contralor —que en el demo trae fiscalista—
recibe por WhatsApp un apartado que no existe, o el artículo correcto atribuido
al Código Fiscal cuando es de la LISR, y `guardiaFundamento` lo da por bueno sin
una línea de log.
Causa raíz: los frenos se escribieron contra los CASOS de la ronda anterior
(distancia corta, sufijo numérico) y no contra la CLASE (el mismo regex sigue
sirviendo para detectar y para autorizar). (**REINCIDENTE** de auditoría 4,
CRÍTICO 2, en su consecuencia.)

### [CRÍTICO] La guardia detecta la cita inventada, escribe en el log que la quitó, y la manda igual
`src/lib/cuadra/normas/fundamento.ts:116-144` (detección) vs `:236-245` (limpieza) · `processor.ts:644-647`

`FORMA_DE_CITA` se ensanchó en `063d426` con tres formas nuevas (número+letra
junto a la ley, número en palabras, sigla después del número). La limpieza de
`CITA_DESCONOCIDA` **no se ensanchó con ellas**: sus cuatro `replace` cubren
`artículo|art.|arts.|regla` + dígitos, `SIGLA` + dígitos, la desnuda
`\d-[IVXLC|A-D]` y la regla decimal. Resultado, con `permitidas = []`:

```
ENTRA : "Ese gasto no aplica conforme al 45-Z de la Ley del ISR."
citas : ["DESCONOCIDA"]   forzado: true   quitadas: ["DESCONOCIDA"]
SALE  : idéntico                                   ← no se quitó nada

ENTRA : "No es deducible por el artículo veintisiete fracción tres de la LISR."
citas : ["DESCONOCIDA"]   forzado: true   quitadas: ["DESCONOCIDA"]
SALE  : idéntico

ENTRA : "Te lo permite la regla dos punto nueve fracción uno de la RFA."
citas : ["DESCONOCIDA"]   forzado: true   quitadas: ["DESCONOCIDA"]
SALE  : idéntico
```

Y hay una cuarta forma que **ni siquiera se detecta**, la más probable de todas
porque el modelo escribe las dos citas en la misma frase:

```
perm  : ["lisr-27-fr-III"]
ENTRA : "No es deducible conforme al artículo 27, fracción III de la LISR, y además
         el 45-Z de la Ley del ISR lo confirma."
citas : ["lisr-27-fr-III"]   forzado: false
SALE  : idéntico
```

El mecanismo: `citasEnTexto` (`:150-161`) borra del texto los patrones
reconocidos antes de buscar lo que sobra, y el `[^.]{0,45}` de esos patrones es
codicioso — se come `"…de la LISR, y además el 45-Z de la "` hasta encontrar el
alias, y con él se lleva la cita inventada. **Una cita legítima le da cobertura a
la inventada que la acompañe en la misma oración.**

Consecuencia: el `logger.warn('agent.fundamento_forzado', { quitadas })` de
`processor.ts:645` afirma que se limpió un texto que salió igual, así que ni
siquiera revisando los logs se ve. Es exactamente lo que el comentario de
`fundamento.ts:240-242` declara inaceptable —*"media guardia es peor que
ninguna, porque el log dice 'forzado' y el texto sale igual"*—, escrito para la
cita desnuda y dejado abierto para las otras tres.
Causa raíz: detección y limpieza son dos listas que se mantienen a mano, y solo
se amplió una. (**REINCIDENTE** de auditoría 4, CRÍTICO 1, en su consecuencia:
antes no se detectaba, ahora se detecta y tampoco se quita.)

### [CRÍTICO] El PDF se da por entregado con el 200 de Meta, y el aviso de que no se entregó se tira sin leerlo
`src/lib/meta/client.ts:92-108` · `src/app/api/webhook/whatsapp/route.ts:99-113` · `src/lib/cuadra/processor.ts:681-682`

`sendDocument` devuelve `void` en los dos desenlaces: cuando Meta rechaza (log
`wa.sendDocument`, y **el flujo sigue como si nada**) y cuando Meta acepta. En el
segundo caso Meta responde 200 con un `wamid` y **descarga el `link` después, por
su cuenta** —lo dice el propio comentario de `client.ts:105-107`—. Si esa
descarga falla, o el mensaje se cae luego, Meta lo reporta por el webhook en
`value.statuses` con `status:"failed"` y su `errors[]`.

`extractMessages` (`route.ts:99-113`) recorre **solo** `change.value?.messages`.
Comprobado con dos búsquedas distintas: `command grep -rn "statuses" src/ supabase/`
→ vacío; `find src -name "*.ts" -print0 | xargs -0 command grep -ln "statuses"` →
vacío. No hay ningún consumidor de estados de entrega en el repo.

Escenario, que es el caso REAL de esta ronda: viaje `v1`, `guardar_liquidacion`
OK, los dos PDF suben a `t1/v1.pdf` y `t1/v1-operador.pdf` (comprobado en
storage), `createSignedUrl` devuelve URL, `sendDocument` → 200 + wamid →
`logger.info('wa.sendDocument.ok')` → `registrarCostoWhatsApp` cobra el mensaje →
`if (closed)` termina sin excepción, así que **`pdf.no_entregado` no se dispara
nunca**. El operador no recibe el documento y en el log no hay ni un warn.
Ese es el hueco exacto entre "PDF en storage" y "operador sin PDF" sin ninguna
línea de error.
Consecuencia: el paso 3 del guion del demo ("llega el PDF") puede fallar delante
del comprador sin que nadie del equipo pueda decir por qué, y el contador de
costo por liquidación suma un mensaje de WhatsApp que nunca se entregó.
Causa raíz: la ronda 4 cerró la mitad del camino —comprobar que el PDF EXISTE—
y dejó sin cerrar la otra —comprobar que LLEGÓ—; el único canal que da esa
respuesta (los `statuses` de Meta) nunca se cableó.

### [CRÍTICO] Ninguna guardia mira las AFIRMACIONES DE ESTADO: el modelo puede decir "ya te lo cerré" sin haber cerrado nada — REINCIDENTE
`src/lib/cuadra/cuadre/guardia.ts:51` · `src/lib/cuadra/processor.ts:545,652,665,698`

Verificado otra vez contra el código de hoy, con salida real de
`tieneCifrasDeDinero` y `guardiaFundamento`:

```
"Ya quedó cerrada tu liquidación ✅. En un momento te llega el PDF."
   dinero? false   fundamento forzado? false   sale igual? true
"Listo, ya te lo cerré. Tu liquidación va en camino 📄"
   dinero? false   fundamento forzado? false   sale igual? true
"Sí, ya recibí todos tus comprobantes y ya cerré el viaje."
   dinero? false   fundamento forzado? false   sale igual? true
"Tu viaje ya está liquidado, no tienes nada pendiente."
   dinero? false   fundamento forzado? false   sale igual? true
"Ya le mandé tu liquidación a tu contralor y te la reenvío por aquí."
   dinero? false   fundamento forzado? false   sale igual? true
```

Con `toolCalls: []`, `guardia.ts:51` sale en la primera línea (`!cuadro &&
!tieneCifrasDeDinero`), `guardiaFundamento` no toca nada, `processor.ts:545` deja
`closed = false`, el bloque del PDF (665) no corre y `saveConversation` (698)
guarda el viaje como abierto. El operador deja de mandar comprobantes y espera un
PDF que nadie va a generar; `viaje.estatus` sigue `'abierto'`.
Consecuencia: el anclaje literal de "3 o menos" del rubro. En la sala: el chofer
del demo recibe "ya quedó" y el panel del contralor no muestra la liquidación.
Causa raíz: hay backstop para lo que el modelo puede NARRAR (cifras, citas) y
ninguno para lo que puede AFIRMAR del sistema, aunque `processor.ts:545` ya tiene
el booleano que lo contradiría.
(**REINCIDENTE** de auditoría 4. Se dejó abierto **con razón escrita** —"necesita
decisión de producto, no un backstop inventado de madrugada"—. Lo reporto porque
sigue vivo y sigue siendo el techo de la nota, no porque la razón fuera mala.)

### [ALTO] Cualquier error entre el cierre y el bloque del PDF salta la entrega, y el log que existe para eso no se dispara
`src/lib/cuadra/processor.ts:656-663` (fuera de cualquier `try`) · `:665-696` · `:699-705`

`if (!intakeOk) { const n = (await getGastos(viajeId, op.tenantId)).length; … }`
está **antes** del bloque del PDF y **fuera** del `try` que lo protege (el `try`
de 658 solo envuelve el `say`). Si `getGastos` lanza, el control salta al `catch`
de 699.
Escenario con valores: la barrera venció (`intakeOk = false`, o sea: la base ya
va lenta), `guardar_liquidacion` cerró el viaje `v1` y subió los dos PDF,
`say(reply)` entregó el cuadre, y entonces `getGastos` truena por un blip de
Supabase. Salida: `logger.error('processInbound.fail', { id, err })` —**sin
tenant, sin viaje, sin liquidación**—, `releaseMessageClaim`, y un
`"Perdón, se me trabó tantito. ¿Me reenvías tu último mensaje?"`. **`closed` era
`true` y `pdf.no_entregado` no se dispara**, porque solo vive dentro del bloque
que se saltó. `saveConversation` (698) tampoco corre.
El operador obedece y reenvía "listo" → `getOpenViaje` (205) ya no lo encuentra
(`'liquidado'`) → `"No tienes un viaje abierto para liquidar ahorita"`. Callejón
sin salida: la liquidación está cerrada, el PDF existe, y no hay ningún camino
por el que el operador lo reciba ni ninguna alerta que lo diga.
Consecuencia: mismo daño que el ALTO que se cerró esta ronda, por una puerta que
el arreglo no cubrió, y con un log que no permite ni identificar la liquidación.
Causa raíz: la entrega del entregable es el último paso de un `try` gigante, en
vez de un paso con su propio cierre; y el `catch` general no sabe que hubo un
cierre.

### [ALTO] La barrera de ráfaga se apaga sola y en silencio si el contador falla, y el aviso al operador depende del mismo booleano
`src/lib/cuadra/conv.ts:251-255` · `:265-297` · `src/lib/cuadra/processor.ts:255,376,464-465,656`

`intakeDelta` devuelve **0 ante cualquier error** (`conv.ts:253`), y ese 0 es el
mismo valor que significa "no hay nada en vuelo". `esperarIntake` sondea con
`intakeDelta(id, 0)` (`conv.ts:270`), así que un error de RPC → `0` → `<= 0` →
`return true` **inmediato**.
Escenario con valores: el operador manda 5 fotos; la #5 está en OCR (contador
real = 1) cuando llega "listo"; el `rpc('intake_delta')` del sondeo cae por un
error transitorio (pool agotado, 503). `esperarIntake` devuelve `true`, así que
`intakeOk = true` y **el aviso de `processor.ts:656-663` no se manda**. El agente
cuadra con 4 comprobantes: si el #5 era el diésel de $8,000, la liquidación se
cierra con $8,000 menos comprobados y el operador queda debiendo de su bolsa un
gasto que sí hizo — con el PDF ya emitido y el viaje en `'liquidado'`.
Además, el `logger.warn('intake.delta', { code, msg })` **no lleva el viaje**, así
que a la mañana siguiente no se puede saber cuál liquidación salió corta. Y en el
mismo error, `enVuelo` vale 0 en `processor.ts:255`, con lo que la primera foto
de la ráfaga tampoco manda el acuse "📸 Voy recibiendo tus comprobantes".
`barrera.test.ts` cubre gracia on/off, espera normal y timeout — **ninguno de los
5 casos ejercita un sondeo que falla**.
Consecuencia: es el único camino del sistema que cierra sobre datos parciales
**sin decírselo a nadie**; el resto de los caminos parciales sí avisan.
Causa raíz: un error y un contador vacío se codifican con el mismo valor, y la
decisión de avisar al operador cuelga de ese valor.

### [ALTO] La foto que llega después del cierre se tira sin guardar nada — la clase que el arreglo del XML no cubrió
`src/lib/cuadra/processor.ts:205-231`

El corte por "sin viaje abierto" ahora tiene una excepción para
`msg.type === 'document'` (220): el XML se conserva por UUID y se le explica al
operador. **La foto no tiene ninguna.**
Escenario con valores: ráfaga de 6 tickets; el operador escribe "listo" cuando la
#6 aún no salió de su teléfono. El turno cierra `v1` con 5 comprobantes. Dos
segundos después entra la foto #6 (caseta de $1,250): `getOpenViaje` → `null` →
`"No tienes un viaje abierto para liquidar ahorita. Cuando tu flota te asigne
uno, aquí lo cerramos. 👍"` y la imagen **no se descarga, no se OCR-ea, no se
guarda en ningún lado**. No hay `mediaId` persistido: el media de Meta caduca, así
que el comprobante no se puede recuperar ni a mano.
Consecuencia: $1,250 que la flota no reembolsa y que el operador sí pagó, con un
mensaje que le dice que el problema es que no tiene viaje —no que su ticket se
perdió—. Y el contralor no se entera de que existió.
Causa raíz: la ronda 4 arregló el CASO (el XML) y no la CLASE (todo comprobante
que llega tarde), que es literalmente lo que el auditor anterior anotó como causa
raíz de ese hallazgo.

### [MEDIO] Las tres líneas de dinero del único mensaje autoritativo no tienen ni una aserción
`src/lib/cuadra/cuadre/resumen.ts:51-57` · `src/lib/cuadra/cuadre/resumen.test.ts`

`resumenCuadre` es el texto que el operador lee cuando la guardia sustituye la
respuesta del modelo (`guardia.ts:79`), cuando no alcanza el presupuesto
(`processor.ts:520`) y cuando se recupera un cierre parcial (`processor.ts:595`).
Sus tres líneas de dinero son `• Comprobado`, `• Anticipo` y la que dice **a
favor de quién queda la diferencia**.
`resumen.test.ts` tiene 15 `it()` y ninguno las toca: todos los `expect` son sobre
el bloque de observaciones, la leyenda del contralor y el bloque de acreditables.
Comprobado con dos búsquedas: `command grep -n "Sobró\|bolsa\|a favor\|Comprobado"
resumen.test.ts` → solo aparece en los *fixtures*, nunca en un `expect`;
`find src -name "*.test.ts" | xargs grep -ln "Sobró"` → `fundamento.test.ts` y
`cifras.test.ts`, ninguno de resumen.
Escenario: invertir la rama `liq.diferencia > 0` para que diga *"Pusiste $1,000.00
de tu bolsa (a favor tuyo)"* cuando en realidad **sobraron $1,000 del anticipo y
los debe la empresa** deja las 628 pruebas en verde. Lo comprobé de una forma
incómoda: a las 16:52 de hoy el árbol de trabajo tenía justo esa modificación sin
commitear (`git diff` la mostró), y a las 16:54 volvió a estar limpio contra
`86e23aa`. **No la reporto como bug del código —`HEAD` está correcto—**, la
reporto como lo que demostró: el renglón que le dice al chofer si le deben o
debe no está anclado por nada.
Consecuencia: cualquier cambio futuro en ese texto —el archivo se tocó dos veces
en dos rondas— puede invertir quién le debe a quién sin que la suite se entere.
Causa raíz: las pruebas de `resumen.ts` se escribieron para los hallazgos de
filtrado por destinatario, y nunca para el contenido que siempre está.

### [MEDIO] La normalización del teléfono llegó a la búsqueda y al envío, no a la llave de la conversación
`src/lib/cuadra/processor.ts:499` · `src/lib/cuadra/conv.ts:112-119` · `:43-56`

`resolveOperador` acepta las cuatro variantes del número (`variantesTelefono`) y
`destinatarioWhatsApp` normaliza el envío. Pero `loadConversation` se llama con
`msg.from` **crudo**, y busca `.eq('telefono', telefono)`; `op.telefono` —la forma
canónica que ya está en la base— se resuelve y no se usa.
Escenario con valores: el operador está de alta como `+529993700779`. Meta entrega
su primer mensaje con `from = "5219993700779"` (el "1" mexicano del `wa_id`) → se
crea la fila de conversación con esa cadena. Más tarde entrega
`from = "529993700779"` —la propia cabecera de `conv.ts:26-41` documenta que el
mismo teléfono llega en las dos formas "según por dónde entre"—: `resolveOperador`
lo encuentra igual gracias a `variantesTelefono`, pero `loadConversation` no ve
fila para esa cadena, **inserta una segunda** (el unique de la 0005 es
`(tenant_id, telefono)`, así que las dos conviven) y devuelve `turns: []`.
Consecuencia: en mitad del mismo viaje el modelo pierde los turnos anteriores. El
operador contesta "sí, ciérralo" a una pregunta que el modelo ya no ve, y el
agente arranca de cero. No hay ningún log: `conv.historial_descartado` solo se
emite cuando la fila existe y el viaje difiere.
Causa raíz: el arreglo `b7b2fcc` normalizó los dos puntos donde el fallo ya había
dolido (buscar y enviar) y no el tercero, que usa el mismo dato como llave
primaria de hecho.

### [MEDIO] Con `cuadro = true` se descarta el 100% de la respuesta del modelo — REINCIDENTE
`src/lib/cuadra/cuadre/guardia.ts:37-39,51,79`

Intacto desde la ronda 4: `cuadro` es true si corrió `cuadrar_viaje` **o**
`guardar_liquidacion`, y con `cuadro=true` la línea 51 no puede salir temprano, de
modo que la 79 sustituye el texto por `resumenCuadre` **siempre, sin mirarlo**.
Escenario: el operador pregunta *"¿y la caseta de la autopista sí me la
contaron?"*; el prompt (`prompts.ts:22-24`) le ordena al modelo llamar
`cuadrar_viaje`; la respuesta a la pregunta se tira y se manda otra vez el cuadre
completo. Vuelve a preguntar, vuelve a recibir el mismo bloque.
Consecuencia: en el demo, cualquier pregunta improvisada sobre el chat recibe el
mismo mensaje enlatado, y se paga un turno de Sonnet por un texto que nunca sale.
Causa raíz: el backstop se aplica con granularidad de TURNO en vez de
granularidad de AFIRMACIÓN. (**REINCIDENTE** de auditoría 4, MEDIO.)

### [MEDIO] `CITA_DESCONOCIDA` sigue dejando el sufijo de letra huérfano — REINCIDENTE
`src/lib/cuadra/normas/fundamento.ts:239`

`(?:-[IVXLC]+)?` sigue absorbiendo solo romanos. Salida real:

```
ENTRA : "Esto se basa en el LIF 2026 Art. 20-B, que no existe."   SALE: "Esto se basa en el -B, que no existe."
ENTRA : "Esto se basa en el CFF 69-D."                            SALE: "Esto se basa en el -D."
ENTRA : "No es deducible por el LISR 27-Z."                       SALE: "No es deducible por el -Z."
```

Y la limpieza del hallazgo CRÍTICO de arriba produce frases igual de rotas cuando
sí actúa: `"Puedes pagar en efectivo hasta el 15% conforme a la"`,
`"Ese diésel no es deducible por el del Código Fiscal de la Federación."`
Consecuencia: el contralor lee una frase mutilada justo en el renglón del
fundamento — el momento en que está juzgando si el producto es serio.
Causa raíz: la limpieza se derivó del formato de fracción romana, no del formato
real del índice, que usa sufijos de letra (`LIF 2026 Art. 20-A`, `CFF 69-B`,
`CFF 29-A`). (**REINCIDENTE** de auditoría 3 y 4.)

### [MEDIO] El abandono silencioso del mutex supone que el dueño del lease sigue vivo
`src/lib/cuadra/processor.ts:484-489` · `src/lib/cuadra/conv.ts:199-201`

El comentario justifica abandonar en silencio porque *"`false` significa una sola
cosa: otro turno tiene el lease vigente y ESE va a responder"*. Es cierto salvo
cuando el otro turno **murió** (kill de Vercel a `maxDuration`, crash del
runtime): el lease sobrevive hasta su TTL de 60s sin nadie detrás.
Escenario: el "listo" del operador muere a los 118s; el operador reenvía "listo" a
los 20s siguientes; `try_lock_viaje` devuelve `false` porque el lease del muerto
sigue vigente; este turno **abandona sin escribir una sola palabra**. El operador
lleva dos mensajes sin ninguna respuesta y Meta no reintenta nada.
Consecuencia: el caso "se trabó" en su forma más silenciosa, y se dispara justo
después de otro fallo — cuando el usuario ya está reintentando.
Causa raíz: el lease no distingue "ocupado por alguien vivo" de "ocupado por
alguien que ya no está"; no hay heartbeat ni marca de la invocación dueña.

---

## Lo que revisé y está bien

- **Los cinco ALTOs cerrados de la ronda 4**, cada uno leído contra el código de
  hoy y con su prueba nombrada arriba. `conv_historial.test.ts` (5 casos) y
  `processor_cierre.test.ts` (5 + los del XML) fallarían de verdad si se
  revirtiera el arreglo: comprueban el efecto (`sendDocument` no llamado,
  `pdf.no_entregado` emitido con `viaje`), no la forma.
- **`claimMessage` de tres estados** (`conv.ts:143-169`) y su consumo en
  `processor.ts:159-172`. La decisión de SEGUIR en `indeterminado` está bien
  razonada y el comentario ya describe la plataforma real (Meta no reintenta), no
  la imaginaria.
- **Separación de ejemplares del PDF** (`tools.ts:118-139`). Dos PDF, dos rutas,
  y `pdf_generado` mira el del OPERADOR (`Boolean(pdfOperadorPath)`), que es el
  único que se manda. Si solo falla ese, `pdf_generado` es `false` y el operador
  recibe el aviso: la elección de cuál booleano devolver está bien hecha.
- **`normasDeToolCalls`** (`fundamento.ts:271-283`). Sigue leyendo solo el
  `result` de la tool, con cota de profundidad 6 y validación contra `NORMAS`. No
  hay forma de que el texto del modelo se auto-autorice; intenté colar un
  `norma_id` por el texto y no cede.
- **Protección de citas legítimas con placeholder NUL** (`fundamento.ts:220-229,
  259`). El truco funciona y la limpieza genérica no lo puede tocar.
- **`tieneCifrasDeDinero`** (`cifras.ts:56-64`) y `hablaDeDineroSinCifraVerificable`.
  Probé `"Tu resultado final: 8000"`, `"Te sobraron ocho mil pesos"` y
  `"Tu saldo: 500 a tu favor"`: los tres marcan. El portón ancho sigue cerrado.
- **`textoDeterminista`** (`processor.ts:611-650`). El orden de las dos guardias y
  la no-corrupción del texto del motor siguen correctos, con los tres caminos que
  emiten `resumenCuadre` cubiertos.
- **Presupuesto compartido** (`presupuesto.ts` completo, `route.ts:27`). Sumé el
  peor caso contra el nuevo `maxDuration`: barrera 20 + lock 12 + agente 40 = 72s
  de trabajo, `MARGEN_CIERRE_MS` 12s, tope 120s. Cabe, y `acotar` impide que una
  etapa tardía pida lo mismo que una temprana. Verifiqué además el caso que me
  preocupaba: el TTL del lease (60s) contra el tiempo máximo que un turno lo
  retiene (~48s, porque el agente ya viene acotado por `restante()`), y **no se
  cruzan**. El test que ata `PRESUPUESTO_WEBHOOK_MS` a `maxDuration` existe.
- **Recuperación de cierre parcial** (`processor.ts:562-599` con
  `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, presente en `.env.local` y en
  `.vercel/.env.production.local`). Leí el camino completo: `TruncatedError` y
  `LoopGuardError` se envuelven en `PartialExecutionError` con `partialToolCalls`
  (`openrouter.ts:562-565`), el `catch` marca `closed = true`, vincula costos y
  arma el resumen del motor; con eso el bloque del PDF sí corre. El costo de lo
  gastado se registra ANTES del `if`, así que no se pierde aunque el cierre no se
  pueda salvar.
- **El abort no deja una tool a medias con efecto perdido**: `controller.abort()`
  (`run.ts:32-33`) corta la llamada de completado, no las tools; las que ya
  corrieron están en `executed` y viajan en el error. Es el diseño correcto.
- **Dedup de mutaciones por NOMBRE** (`tool-executor.ts:74-95`) y el comentario
  que ata esa decisión a la regla de `properties: {}`. Correcto mientras ninguna
  tool acepte datos del modelo.

## Lo que NO alcancé a revisar

- **Todo lo que necesita Postgres.** `try_lock_viaje`, `intake_delta`,
  `guardar_liquidacion_tx` y los claims atómicos los leí en SQL y no los ejecuté.
  La concurrencia real de dos `after()` compitiendo sigue sin verificar.
- **El envío real por Meta.** No mandé mensajes (prohibido), así que la cadena
  "200 → statuses failed" la reconstruí de la documentación y del propio
  comentario del repo, no de una corrida. Lo que sí está verificado por código es
  que **nada lee `statuses`**.
- **El ciclo con un modelo real.** Con qué frecuencia el modelo escribe
  "45-Z de la Ley del ISR" o afirma un cierre falso no lo medí: verifiqué el
  mecanismo (determinístico), no la probabilidad.
- **La modificación transitoria de `resumen.ts`** que observé a las 16:52 (ver el
  MEDIO correspondiente). No sé quién la hizo ni si hubo otras en archivos que
  ya había leído; volví a comprobar `git status` al cerrar y el árbol estaba
  limpio contra `86e23aa`. Todo lo demás de este reporte está verificado contra
  ese commit.
- **`src/lib/agents/liquidacion/`** existe como carpeta **vacía** (`ls` → 0
  entradas). El MAPA la sigue listando; no hay nada que auditar ahí.
