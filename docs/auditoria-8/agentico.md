# Sistema agéntico y orquestación — auditoría 8

**Nota: 4/10** (antes 3). Razón del movimiento: **se atacó y subió**. Hay commits
de esta ronda que cerraron hallazgos del rubro y los verifiqué ejecutando los
módulos, no leyéndolos: AG-1 (`cuadro` vs `cerro`), AG-3 (el texto y el PDF ya
salen del mismo snapshot), el `+1` de la barrera (ahora fail-closed), el TTL del
contador (0031) y `ctxCerro` en el cierre parcial recuperado. Es trabajo real y
comprobable. Sube **un** punto y no más porque el ancla del rubro —*existe un
estado donde la base dice una cosa y el usuario cree otra*— **sigue satisfecha**,
por una puerta nueva: la guardia que impone "ninguna cifra que vea el usuario
sale del LLM" se apaga con una palabra del propio vocabulario del producto.

**El riesgo mayor del rubro, hoy:** basta que el modelo escriba la palabra
"comprobantes", "litros", "artículo" o "folio" en el mismo mensaje para que
`guardiaCifras` deje de mirar los números de ese mensaje — y un saldo que nadie
calculó llega íntegro al WhatsApp del operador.

---

## Verificación de lo que venía abierto

Todo esto se comprobó ejecutando los módulos del repo con `npx vite-node
--config vitest.config.ts` desde el scratchpad, sin tocar un solo archivo.
`HEAD = ac752de`. Línea base reproducida: `npm test` → **1299 pruebas, 1
saltada, 133 archivos, exit 0** (el MAPA decía 1296/132).

| Hallazgo abierto | Estado hoy | Evidencia |
|---|---|---|
| **AG-1** · "Listo, cuadré tu viaje" en un turno que no cerró | **CERRADO** | `guardia.ts:51` separa `cerro` de `cuadro`; salida real con solo `cuadrar_viaje` → *no* dice "Listo, cuadré" |
| **AG-2** · `guardiaFundamento` siempre con `permitidas=[]` | **CERRADO A MEDIAS** | con `consultar_politica` las 6 frases salen intactas (`normasDePolitica` → `lisr-27-fr-III`, `lisr-28-fr-V`, `rfa-2026-2.9`, `lif-2026-art-20-A`). **Sin ninguna tool sigue mutilando**: ver ALTO nº3 |
| **AG-3** · texto y PDF de dos fotografías distintas | **CERRADO** | con el snapshot en el resultado de la tool, `guardiaCifras` **no toca la base** (lo probé sin env de Supabase: no cae al fail-closed) y narra exactamente los $4,850 / $150 que se imprimieron. Los TRES consumidores del snapshot —PDF contralor, PDF operador, `saveLiquidacion`— usan la misma `liq` (`tools.ts:165-181,200`). Queda una ventana residual: MEDIO nº5 |
| **ALTO REINCIDENTE** · `ctxCerro` + `guardiaEstado` sin `try/catch` | **CERRADO la mitad** | `processor.ts:789` ya fija `ctxCerro` en la recuperación. `guardiaEstado` (`:866-878`) sigue siendo la única guardia sin `try/catch`, y la rama NO recuperada tampoco fija `ctxCerro`: ver BAJO nº9 |
| **ALTO** · segundo mensaje de texto descartado en silencio | **CERRADO A MEDIAS** | `processor.ts:679-684` ya avisa y libera el claim. El mensaje sigue sin contestarse ni entrar a la conversación: MEDIO nº8 |
| **ALTO** · el `+1` fallido no detenía la foto | **CERRADO** | `processor.ts:352-368` es fail-closed, avisa, libera el claim y **no** ejecuta el `-1` gemelo; el `finally` del `-1` vive dentro del `try` que arranca *después* del `+1` (`:369`, `:562-564`) |
| **MEDIO** · el contador de la barrera sin reset ni TTL | **CERRADO** | `0031_*.sql` sella `intake_pendientes_en` en cada `+1` y reinicia a cero pasados 10 min, también en el sondeo `p_delta = 0`. Con sonda de arranque propia (`startup.ts:100-104`) |

---

## Hallazgos

### [CRÍTICO] El portón de cifras se apaga con una palabra del propio dominio: un saldo inventado por el modelo llega íntegro al operador
`src/lib/cuadra/cuadre/cifras.ts:36-37` (`NO_ES_DINERO`) · `:56-64`
(`tieneCifrasDeDinero`, y en particular el `return false` de la línea 62) ·
`src/lib/cuadra/cuadre/guardia.ts:83` · `src/lib/cuadra/processor.ts:816-825`

`tieneCifrasDeDinero` tiene tres pasos: si hay dinero explícito (`$`, coma de
miles, `.XX`, "pesos") devuelve `true`; **si no, y la FRASE contiene una palabra
de `NO_ES_DINERO`, devuelve `false` sin mirar ningún número**; y solo entonces
busca el número suelto. La lista de `NO_ES_DINERO` es: `folio, uuid, rfc, ticket,
comprobantes, fotos, litros, lts, km, kilómetros, placas, año, días, horas,
minutos, por ciento, artículo, regla, migración, viaje #`. Es el vocabulario del
producto entero.

Y el apagado es **por frase, no por vecindad del número** — el comentario de
`cifras.ts:58-61` lo declara a propósito. Los mensajes de este agente son
multilínea.

Salida real, con los módulos del repo:

```
"Llevas 6 comprobantes y te sobran 3200 del anticipo."
   tieneCifrasDeDinero = false → guardiaCifras sale en guardia.ts:83
   guardiaFundamento    forzado = false
   guardiaEstado        no afirma cierre → pasa
   SALE AL OPERADOR: "Llevas 6 comprobantes y te sobran 3200 del anticipo."

"Cargaste 320 litros y te quedan 4500 de anticipo por comprobar."   → sale igual
"Tu tope de diésel en efectivo es 5000, según el artículo 27, fracción III
 de la LISR."                                                       → sale igual
```

**Escenario con valores.** Viaje `v1`, anticipo $5,000, 3 tickets registrados por
$1,800. El operador escribe *"¿cuánto llevo?"*. El modelo contesta sin llamar
`cuadrar_viaje` —el prompt se lo ordena (`prompts.ts:31`) pero un prompt no es un
candado, y esa es la razón declarada de existir de esta guardia—: *"Llevas 6
comprobantes y te sobran 3200 del anticipo."* `cuadro = false` porque no hubo
tool, `tieneCifrasDeDinero = false` por la palabra "comprobantes", y el texto sale
tal cual. Ni el número (3200 contra los $3,200 reales… que casualmente coinciden
aquí, pero nadie lo verificó) ni el conteo (6 contra 3) pasaron por el motor.

El mismo camino se abre **aunque el modelo sí llame la tool**: si
`cuadrar_viaje` devuelve error, `!t.error` falla, `cuadro` vuelve a ser `false`,
y el modelo narra desde lo que recuerda con la guardia ciega.

Y no se puede argumentar que la cota está en el cotejo cifra por cifra de
`cifrasSinRespaldo`: ese cotejo vive **después** del portón (`guardia.ts:88-99`),
así que un texto que el portón declara "sin dinero" nunca llega a él. La puerta
trasera de `consultar_politica` que la ronda 4 cerró sigue abierta por debajo.

El propio encabezado de `cifras.ts:13-17` fija la regla que el código viola:
*"LA ASIMETRÍA MANDA… ante la duda se marca, y por eso el criterio es ancho"*.
`NO_ES_DINERO` invierte esa asimetría para la frase completa. Las pruebas
(`cifras.test.ts:9-12`, `:100-112`) fijan el falso negativo como especificación
—`'Ya recibí tus 3 comprobantes' → false`— pero ninguna prueba mete un monto
inventado en la misma frase que la palabra inocente.

**Consecuencia:** el chofer lee un saldo que nadie calculó y ajusta su conducta
—deja de mandar comprobantes, o reclama un reembolso que no existe—. Es la
garantía sobre la que se vende el producto ("ninguna cifra que ve el usuario sale
del LLM", CLAUDE/MAPA) rota en el canal por el que se vende, y sin una sola línea
de log: `agent.cifras_forzadas` no se escribe porque la guardia no actuó.
**Causa raíz probable:** el detector decide "¿esta FRASE habla de dinero?" cuando
la pregunta es "¿este NÚMERO es dinero?", y usa como veto el vocabulario que este
dominio tiene en cada mensaje.

---

### [ALTO] El aviso de barrera vencida manda al operador a hacer algo que la migración 0036 acaba de prohibir
`src/lib/cuadra/processor.ts:643-644` (`intakeOk`) · `:897-904` (el aviso) ·
`:906` (el PDF va después) · `:524-527` (`llegoTarde`) ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql:75-77`

Cuando la barrera vence, el turno **cierra igual** y se le manda al operador:

> ⚠️ Ojo: cuadré con los 5 comprobantes que alcancé a procesar. Si te faltó
> alguno, **reenvíalo y escribe *listo* otra vez**.

Ese texto se escribió cuando reenviar funcionaba. Hoy, con la liquidación ya
emitida, las dos instrucciones son imposibles:

- **reenviarlo** → `addGasto` topa con el trigger `trg_gasto_no_tras_liquidar`
  (0036), SQLSTATE `CU001`, y el operador recibe *"Ese comprobante de $8,000.00
  llegó después de que cerré tu liquidación, así que NO entró"* (`:526`);
- **escribir "listo" otra vez** → `getOpenViaje` ya no encuentra viaje abierto y
  responde *"No tienes un viaje abierto para liquidar ahorita"* (`:279`).

**Escenario con valores.** El operador manda 6 fotos; la #6 es el diésel de
$8,000 y su OCR se pasa de los 20 s de `esperarIntake`. `intakeOk = false`. El
modelo no sabe nada de eso —la barrera no entra ni al prompt ni al historial— y
cierra. El operador recibe, en este orden: el cuadre por $4,850, el ⚠️ de arriba,
y su PDF. Obedece el ⚠️, reenvía la foto del diésel, y recibe "llegó tarde". Los
$8,000 son suyos y no hay ningún camino de vuelta desde WhatsApp.

El aviso no distingue `closed`: se emite igual cerrando que sin cerrar
(`:897`, fuera de cualquier `if (closed)`), y solo en el segundo caso su consejo
es cierto.

**Consecuencia:** el modo de falla que la barrera existe para hacer *visible*
vuelve a ser irrecuperable, y encima el producto da una instrucción falsa
inmediatamente antes de entregar el PDF. Es deuda que cobró factura: el arreglo
de AG-3 (0036) invalidó el texto de recuperación de la barrera y nadie los cruzó.
**Causa raíz probable:** el aviso de la barrera y el candado de la 0036 se
escribieron contra el mismo hecho —"esta foto llega tarde"— sin saber uno del
otro.

---

### [ALTO · REINCIDENTE de AG-2] Sin ninguna tool en el turno, toda cita normativa se sigue borrando a media frase
`src/lib/cuadra/processor.ts:845-847` · `src/lib/cuadra/normas/fundamento.ts:265-334` ·
`src/lib/cuadra/tools.ts:64-74` · `src/lib/cuadra/normas/por_diferencia.ts:127-133` ·
`src/lib/cuadra/cuadre/guardia.ts:83`

`e50510c` cerró la mitad que dependía de `consultar_politica`, y lo verifiqué: con
esa tool llamada, las seis frases que probé salen **intactas**. Pero el permiso
sigue viajando *solo* con una tool, y el turno que la ronda 7 describió —el
operador pregunta y el modelo contesta de memoria— **no llama ninguna**.

Y ese turno pasa el portón de cifras: una frase normativa casi nunca trae `$` ni
coma de miles, y si trae "artículo" o "regla" el portón la declara sin dinero
(mismo mecanismo del CRÍTICO de arriba). Así que `textoDeterminista = false`,
`permitidas = []` y `guardiaFundamento` sí corre. Salida real:

```
ENTRA: Sí cuenta, pero ojo: el pago de diésel en efectivo tiene tope conforme al
       artículo 27, fracción III de la LISR.
SALE : Sí cuenta, pero ojo: el pago de diésel en efectivo tiene tope conforme al.

ENTRA: Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.
SALE : Te aplica el estímulo del diésel conforme al -A.

ENTRA: Tu caseta lleva el estímulo del 50% conforme al artículo 20, apartado A
       de la LIF.
SALE : Tu caseta lleva el estímulo del 50% conforme al artículo.

ENTRA: Ese consumo no trae comprobante fiscal y el artículo 29-A del CFF pide
       ese requisito.
SALE : Ese consumo no trae comprobante fiscal y el pide ese requisito.
```

Hay un segundo camino, más fino, que el arreglo tampoco cubre: `normasDePolitica`
solo habilita las normas de PISO más las del CONCEPTO que esté en la política del
tenant. Una flota que no captura `diesel` en su política deja `lif-2026-art-20-A`
fuera, y la frase del estímulo del diésel vuelve a salir **"conforme al -A."**
aunque el modelo sí haya llamado `consultar_politica` (verificado: con política
`[{alimentacion}]`, `permitidas = ['lisr-27-fr-III','lisr-28-fr-V']`).

Y el turno es alcanzable justo donde más duele: el resumen determinístico que el
sistema acaba de mandar **lleva citas dentro** (`engine.ts` mete "LISR 28-V" en
`d.nota`, lo vi en la salida real del cuadre), se guarda en
`wa_conversacion.estado.turns`, y en el turno siguiente el modelo las repite —
sin llamar tool, porque no hay nada nuevo que cuadrar.

**Consecuencia:** delante del contralor, la respuesta a *"¿en qué se basan?"* sale
mutilada. El estímulo del diésel —lo que se vende— sale como *"conforme al -A."*
Baja de CRÍTICO a ALTO porque el camino principal sí quedó cerrado.
**Causa raíz probable:** el permiso de citar se otorga por tool y no por hecho, y
sigue habiendo turnos legítimos sin ninguna tool.

---

### [ALTO] El XML del CFDI no toma la barrera ni el mutex, y `updateGastoCfdiXml` no mira si la liquidación ya se emitió
`src/lib/cuadra/processor.ts:572-632` (rama `document`: ni `intakeDelta` ni
`acquireViajeLock`) · `:643` (la barrera solo cuenta fotos) ·
`src/lib/cuadra/repo.ts:198-225` (`update … xml_verificado: true`) ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql:77` (`before **insert** on gasto`) ·
`src/lib/meta/client.ts:10,149-167`

Las fotos hacen `+1`/`-1` en el contador de intake y el "listo" las espera. **El
documento no hace nada de eso**, y tampoco toma el mutex del viaje. Y su ruta es
lenta: dos `fetch` a la Graph API con `AbortSignal.timeout(15_000)` cada uno
(`client.ts:10`), o sea hasta **30 s** que la barrera no puede ver.

El candado de la 0036 tampoco lo cubre: es `before insert on gasto`, y el camino
normal del XML es un **UPDATE** sobre un gasto que ya existe (`repo.ts:198-225`,
que además pone `xml_verificado: true`, `ieps_traslado`, `iva_traslado` y puede
**sobrescribir `monto` y `fecha`** con los del CFDI).

**Escenario con valores.** El cierre anterior le dijo al operador —es el texto de
`engine.ts:437`— *"La factura de diésel es de combustible: reenvía el XML"*. En el
viaje siguiente manda la foto del diésel de 1,850.5 L, reenvía el XML que le llegó
por correo, y 4 s después escribe *"listo"*. La descarga del XML en Meta tarda 12 s.
El "listo" no espera a nadie: `esperarIntake` ve el contador en 0 (el XML nunca lo
subió), corre el agente, y `guardar_liquidacion` calcula sobre un gasto con
`xml_verificado = null`. Resultado:

| dónde | qué dice |
|---|---|
| PDF y WhatsApp emitidos | `complemento_no_verificable` → *"reenvía el XML"*, y **0 litros** en "Acreditable (recuperable)" |
| fila `gasto` en la base, 8 s después | `xml_verificado = true`, con su `ieps_traslado` y su `iva_traslado` |

El motor solo cuenta litros y IVA acreditable de gastos con `xml_verificado`
(`engine.ts:724`, `:773`), así que el estímulo de esa carga no entra en la
liquidación emitida — y ya nunca entrará. Si el operador obedece el papel y
reenvía el XML otra vez, `getOpenViaje` devuelve `null` y recibe *"Tu viaje ya
estaba cerrado, así que tu contralor lo aplica desde el panel"* (`:275`), sobre
una liquidación que dice que el XML falta.

Hay una variante peor por el otro lado: si el XML llega **sin** foto previa, la
rama crea el gasto con `addGasto` (`:609`) **sin `try/catch`**. Con la liquidación
ya emitida eso lanza `CU001`, salta al `catch` general y el operador recibe *"se me
trabó tantito, ¿me reenvías tu último mensaje?"* — un mensaje falso para una
situación que no es transitoria. La traducción a lenguaje humano de `llegoTarde`
existe solo en la rama de imagen (`:524-527`).

**Consecuencia:** la flota pierde el acreditamiento de IVA y los litros del
estímulo de esa carga —el beneficio más grande que Likida enseña—, y la base
queda diciendo lo contrario que el papel que el contralor archivó, para siempre y
sin log.
**Causa raíz probable:** la barrera y el candado de la 0036 se diseñaron mirando
la foto; el XML es el otro intake y no participa en ninguno de los dos.

---

### [MEDIO] Ventana residual de AG-3: el gasto que entra entre el cálculo y el `guardar_liquidacion_tx` no lo ve el trigger
`src/lib/cuadra/tools.ts:151-181` · `supabase/migrations/0036_no_gastos_tras_liquidar.sql:64-73` ·
`supabase/migrations/0021_liquidacion_litros_diesel.sql:29-52` · `src/lib/cuadra/processor.ts:897-904`

El trigger de la 0036 rechaza el gasto si `exists(select 1 from liquidacion where
viaje_id = …)`, y se serializa con `perform 1 from viaje … for update`. Pero
`guardar_liquidacion_tx` **inserta la liquidación y solo después hace `update
viaje`** (0021:29-51). Un `addGasto` que tome el candado de `viaje` **antes** de
ese `update` no ve todavía ninguna liquidación y **pasa**.

Esa ventana va desde que `computeCuadre` lee los gastos (`tools.ts:152`) hasta el
RPC (`:181`), e incluye la generación de los dos PDF y sus dos subidas a Storage.
Medí la generación: **10–18 ms los dos ejemplares** (11 gastos, `pdf-lib`, tres
corridas), así que la ventana la dominan las dos subidas — del orden de 0.5–2 s
según red, no los segundos que temía la ronda 7.

**Escenario con valores.** La foto #6 (diésel $800) termina su OCR justo en esa
ventana. El gasto entra; la liquidación emitida sigue diciendo $4,850 y "Sobró
$150". El gasto queda huérfano de por vida, **y sin el mensaje de "llegó tarde"**,
porque el trigger no disparó. Si además la barrera había vencido, el aviso de
`:899` cuenta `getGastos` *después* del cierre y le dice "cuadré con los **6**
comprobantes que alcancé a procesar" sobre un PDF que solo tiene 5.

**Consecuencia:** el mismo daño que AG-3 —dinero fuera del papel, en silencio—
con probabilidad mucho menor. Lo reporto como MEDIO y no como CRÍTICO porque medí
la ventana y es corta, pero el comentario de la 0036 afirma que "solo la base
puede hacerlo atómico" y la atomicidad empieza un segundo tarde.
**Causa raíz probable:** el candado protege contra la *existencia* de la
liquidación, no contra la *lectura* que la produjo.

---

### [MEDIO] `loadConversation` traga el error de lectura: se descarta el historial entero y el turno del asistente no se guarda
`src/lib/cuadra/conv.ts:180-204` (el `const { data }` sin `error`) ·
`:239-244` (`saveConversation`) · `src/lib/cuadra/processor.ts:695`, `:946-950`

Es el **sexto sitio** del patrón que el MAPA persigue —*un fallo de consulta
disfrazado del valor que significa "no hay"*— y no está en ninguno de los cinco
ya cerrados. `loadConversation` destructura solo `data`; con un blip de Supabase
`data` viene `undefined`, el código concluye "no existe la conversación" y salta
al `insert`. Ese `insert` choca con `wa_conversacion_tenant_tel_uidx`
(`0005_concurrencia.sql:13-14`), `created` queda `undefined` y la función
devuelve `{ id: '', turns: [] }`.

**Escenario con valores.** El operador lleva 8 turnos de conversación y escribe
*"listo"*. El `select` de `loadConversation` falla una vez. El agente arranca con
`history` de **un solo turno**, sin el contexto de que ya se le dijo qué falta;
y al terminar, `saveConversation('')` hace `.eq('id', '')` sobre un uuid — no
escribe nada y no lanza, porque tampoco mira el `error`. El turno del asistente
que el operador sí leyó desaparece, y el siguiente mensaje arranca otra vez desde
cero.

Del mismo sitio, y ya reincidente por tercera ronda: `processor.ts:695` sigue
pasando `msg.from` crudo y no `op.telefono`, así que si Meta alterna `521…`/`52…`
se abren dos filas de conversación para el mismo operador y el historial se parte
en dos.

**Consecuencia:** el agente pierde memoria a media liquidación sin que nadie lo
note; en el mejor caso repite una pregunta, en el peor vuelve a proponer cerrar
algo que ya trató. Y el log no dice nada: el único rastro sería
`conv.historial_descartado`, que aquí tampoco se emite porque `data` es nulo.
**Causa raíz probable:** las dos funciones de conversación son las únicas de
`conv.ts` que quedaron sin la distinción `ConsultaFallida` que sus vecinas ya
tienen. (`getTenantContext`, `:142-162`, tiene la misma forma con daño menor:
ante error el agente se presenta como asistente de "la flota".)

---

### [MEDIO] Un fragmento de cita inventada sobrevive a la limpieza mientras el log afirma que se quitó
`src/lib/cuadra/normas/fundamento.ts:182-210` (`FORMA_DE_CITA`) · `:302-318` ·
`src/lib/cuadra/processor.ts:848-851`

La limpieza de `CITA_DESCONOCIDA` reusa `FORMA_DE_CITA`, y su primera alternativa
exige **dígito** después de la palabra clave (`(?:artículo|art\.|regla|fracción|fr\.)\s*\d+`).
Una fracción en romano no lo trae, así que se borra "artículo 32" y se queda
"fracción XX".

Salida real, con `consultar_politica` llamado (política sin diésel, permitidas
`['lisr-27-fr-III','lisr-28-fr-V','lif-2026-art-20-A']`):

```
ENTRA: El tope de alimentación es 900 y el diésel en efectivo lo cubre el
       artículo 32, fracción XX de la LISR.
SALE : El tope de alimentación es 900 y el diésel en efectivo lo cubre el,
       fracción XX de la LISR.
   log: agent.fundamento_forzado  quitadas: ["DESCONOCIDA"]
```

La cita inventada **sigue en el mensaje** ("fracción XX de la LISR") y el log dice
que se quitó. Es exactamente el modo de falla que el comentario de `:302-317`
declara cerrado —*"media guardia que además miente"*—, solo que ahora entra por el
romano en vez de por las cuatro listas a mano.

**Consecuencia:** el contralor con fiscalista lee una fracción que no existe en la
LISR, en una frase rota; y quien lea el log al día siguiente creerá que la guardia
la interceptó.
**Causa raíz probable:** el detector reconoce la cita por su forma completa y la
limpieza borra solo la parte que lleva dígito.

---

### [MEDIO · parcial de la ronda 7] El mensaje que pierde el mutex ya avisa, pero sigue sin contestarse ni entrar a la conversación
`src/lib/cuadra/processor.ts:676-685` · `:946-950` ·
`src/app/api/webhook/whatsapp/route.ts:70-76`

`b187427` cerró la mitad grave: hoy se avisa ("Un momento, todavía estoy
procesando tu mensaje anterior 🙏") y se libera el claim. Queda la otra mitad, que
el propio comentario declara deuda de FASE 3.

**Escenario con valores.** "¿cuánto llevo?" en t=0 y **"listo"** en t=3 s (o los
dos en el mismo POST, que `route.ts:72` corre con `Promise.all`). El turno A toma
el lease y corre el agente ~20 s. El turno B espera la barrera, pide el lock con
`reloj.acotar(12_000)`, se le acaba la ventana y sale. El **"listo" nunca corre el
agente** y **nunca entra a `wa_conversacion.estado.turns`** (el turno A guarda solo
los suyos, `:946-948`), así que el modelo tampoco sabrá en el turno siguiente que
el operador dijo que ya terminó. El viaje se queda abierto.

Anotación fina del mismo sitio: `releaseMessageClaim` aquí no compra reintento
—`route.ts` ya devolvió 200 y Meta no reintenta (`presupuesto.ts:4-7`)—, solo
deja la puerta abierta a reprocesar si algún día alguien reintenta.

**Consecuencia:** en el guion del demo es el paso 3: se teclea "listo" y llega una
cortesía en vez del cierre. Ya no es silencioso, pero el operador tiene que
adivinar cuándo reintentar.
**Causa raíz probable:** el mutex serializa el *viaje* y se usa como si serializara
el *mensaje*; no hay cola.

---

### [BAJO · resto del REINCIDENTE] `ctxCerro` sigue sin fijarse en el cierre parcial NO recuperado, y `guardiaEstado` sigue sin `try/catch`
`src/lib/cuadra/processor.ts:232` · `:742` · `:789` · `:804-809` · `:866-878` · `:976`

`95bbe01` puso la línea que faltaba en la rama recuperada (`:789`) y lo confirmé.
Falta la rama gemela: si `CUADRA_RECUPERAR_CIERRE_PARCIAL` está apagado —lo está
por defecto en el código (`:759`, `=== '1'`), aunque `.env.example:75` recomienda
`1`— y `partialToolCalls` **sí** trae un `guardar_liquidacion` sin error, se cae al
`else` de `:804-809`, que no toca `ctxCerro`. Si algo posterior lanza (p. ej.
`saveConversation`), el `catch` general escribe `cerroSinEntregar: false` sobre una
liquidación que sí quedó cerrada — el único campo diseñado para detectar
exactamente eso.

Aparte, `guardiaEstado` (`:866-878`) sigue siendo la única de las tres guardias sin
`try/catch`, con `guardiaCifras` (`:816-825`) y `guardiaFundamento` (`:845-854`)
envueltas. Lo bajo a BAJO tras intentar refutarlo: la función es regex pura sobre
un `string` que nunca es nulo en ese punto, y sus cuatro patrones están acotados
(`[^.!?]{0,40}`), así que no encontré una entrada que la haga lanzar. Queda como
asimetría de defensa, no como camino vivo.

**Consecuencia:** el ingeniero de guardia lee el campo hecho para encontrar
liquidaciones cerradas sin entregar y le dice que no hay nada que revisar.
**Causa raíz probable:** `closed` tiene tres sitios de escritura y `ctxCerro` está
enchufado a dos.

---

## Lo que revisé y está bien

- **AG-3, verificado ejecutando y no leyendo.** Llamé `guardiaCifras` con un
  `guardar_liquidacion` que trae `liq` y **sin variables de entorno de Supabase**:
  si tocara la base saldría el texto fail-closed, y no salió — narró exactamente
  el snapshot ($4,850 comprobado, $150 sobrante, más las dos observaciones). El
  mismo objeto `liq` alimenta los dos PDF (`tools.ts:176-177`), `saveLiquidacion`
  (`:181`) y el texto (`guardia.ts:105`). Un solo origen, tres consumidores.
- **AG-1, verificado.** Con solo `cuadrar_viaje` y sin cierre, `guardiaCifras` ya
  **no** dice "Listo, cuadré tu viaje": `cerro` (`guardia.ts:51`) es un booleano
  distinto de `cuadro` (`:38-40`) y es el que viaja a `resumenCuadre`.
- **El par `+1`/`-1` de la barrera ya es simétrico ante el error.** El `+1`
  (`processor.ts:352`) es fail-closed, avisa, libera el claim y sale **antes** del
  `try`; el `finally` del `-1` (`:562-564`) solo puede correr si hubo `+1`. Y todos
  los `return` tempranos del cuerpo (`:371`, `:382`, `:413`, `:417`, `:467`,
  `:493`, `:504`, `:511`, `:527`) pasan por el `finally`.
- **El contador de la barrera ya sabe olvidar.** `0031` sella `intake_pendientes_en`
  solo en el `+1` —no en el `-1`, y la razón escrita es correcta—, y reinicia a
  cero pasados 10 min también en el sondeo `p_delta = 0`, que es como lo llama
  `esperarIntake`. Con sonda de arranque propia sobre la columna que nace en esa
  migración (`startup.ts:100-104`), que es la única forma de que el sondeo pueda
  fallar de verdad.
- **La rejilla contra el cierre duplicado sigue siendo de tres capas y las tres
  miran igual.** `tool-executor.ts:100-117` cachea **la promesa** antes del `await`
  y se llavea por nombre; `openrouter.ts:565-586` dedup en ronda con
  `llaveDeCache`, que ignora `args` para las tools sin parámetros —lo verifiqué en
  `llaveDeCache`, no en el comentario—; y `guardar_liquidacion_tx` es
  `on conflict (viaje_id) do update` con el `update viaje` en la misma transacción.
- **El fallback de proveedor no puede re-ejecutar una mutación.** `complete()`
  (`openrouter.ts:497-524`) reintenta **solo** la llamada de completado; las tools
  corren fuera, en nuestro código.
- **La recuperación de cierre parcial hereda el snapshot.** `executed.push`
  (`openrouter.ts:594`) guarda el `result` crudo, y `PartialExecutionError` lo
  transporta, así que `agentTools = parcial` (`processor.ts:781`) le da a
  `guardiaCifras` el mismo `liq` del PDF. El `resumenCuadre` recalculado de `:799`
  queda descartado por la guardia; es redundante, no divergente.
- **La conversación ya guarda lo que el operador LEYÓ.** `say()` devuelve si Meta
  aceptó (`:299-304`) y `saveConversation` solo mete el turno del asistente si
  `entregado` (`:946-948`), con `wa.respuesta_no_entregada` si no. Cierra el modo
  "el agente cree haber saludado a alguien que nunca leyó nada" (`e0086a9`).
- **El destinatario sigue siendo el correcto en las tres salidas.** Los tres
  llamadores de `resumenCuadre` que van al chofer pasan `'operador'` explícito
  (`:716`, `:799`, `guardia.ts:114`), el PDF que se manda es
  `${viajeId}-operador.pdf` (`:919`) y `SOLO_CONTRALOR` (`resumen.ts:24-28`) deja
  fuera `complemento_no_verificable`, que es lo único que el operador sí arregla.
- **`guardiaEstado` con `entrego: 'pendiente'`** (`:873` + `estado_afirmado.ts:108`,
  `=== false`): la contradicción de la ronda 6 —desmentir un cierre real justo
  antes de mandar su PDF— sigue cerrada.
- **Sin aviso de privacidad no hay tratamiento.** `:313-325` corta el
  procesamiento entero, no solo registra. Es la única puerta del pipeline que
  se cierra sobre sí misma.
- **El presupuesto compartido está bien cableado.** `crearPresupuesto` arranca en
  la primera línea útil (`:222`) y las tres etapas caras lo consultan (`:643`
  barrera, `:676` mutex, `:730` agente), con la compuerta de `alcanza(15_000)` en
  `:712` que cae al resumen determinístico en vez de lanzar un agente que Vercel va
  a cortar. Sigue siendo la pieza mejor hecha del rubro.
- **`resolveOperador` se niega ante la ambigüedad** (`conv.ts:73`, `.limit(2)` +
  `OperadorAmbiguo`) y el `catch` general traduce las tres causas a tres mensajes
  distintos y ciertos (`:963-989`).
- **Intenté y descarté un CRÍTICO propio:** que la limpieza de
  `CITA_DESCONOCIDA` se comiera una cifra dentro de sus ventanas `[^.]{0,45}`. No
  puede: en las dos alternativas con ventana el instrumento va **después** del
  número, así que el match termina en la sigla y no alcanza a un monto anterior.
  Lo probé con "Tu tope de alimentación es $900.00 y el diésel va por el 20-A de la
  LIF" y el monto sale intacto.

---

## Lo que NO alcancé a revisar

- **Nada contra el modelo real, Supabase ni Meta.** Sin `.env`, sin OpenRouter y
  sin base. Todo lo de arriba es salida de módulos del repo importados de verdad,
  o lectura de código y SQL. En particular **no medí con qué frecuencia el modelo
  omite `cuadrar_viaje`** en un turno conversacional (el disparador del CRÍTICO):
  sé que el camino existe y que la guardia se escribió porque el prompt no basta,
  pero la frecuencia es inferencia.
- **Concurrencia real de Postgres.** El razonamiento del MEDIO nº5 sale de leer
  `0036` y `0021` juntos; no corrí dos transacciones en paralelo para verlo.
  Tampoco medí la latencia real de las dos subidas a Storage, que es lo que fija el
  ancho de esa ventana.
- **Si `CUADRA_RECUPERAR_CIERRE_PARCIAL` está de verdad en `1` en Vercel.** El
  BAJO nº9 cambia de gravedad según eso y no tengo acceso al panel.
- **La latencia real de la Graph API al bajar un media.** Para el ALTO del XML usé
  el techo del propio código (15 s × 2); el percentil real no lo medí.
- **El consumidor del panel.** No comprobé si el dashboard recalcula desde `gasto`
  o lee la fila de `liquidacion`; de eso depende si la divergencia del ALTO del XML
  también se ve en pantalla o solo en el PDF.
- **`prompts.ts` como superficie de inyección.** Lo leí y sus reglas (líneas 29-34)
  están bien puestas; auditarlas es del rubro de seguridad.
- **`registry.ts` y `types.ts`.** Leídos enteros (24 y 22 líneas), sin hallazgo,
  pero sin ejecución dirigida.
