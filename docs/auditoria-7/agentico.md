# Sistema agéntico y orquestación — auditoría 7

**Nota: 3/10** (antes 3). **La nota no se mueve.** El código no cambió, así que
"se atacó y subió" es imposible; y de las tres formas legítimas ninguna aplica
en neto. Lo que sí cambió es *lo que sé*: recorrí el ciclo punto por punto y las
dos cosas se compensan con exactitud.

- Hacia **arriba**: el CRÍTICO REINCIDENTE de cuatro rondas —"la guardia de
  fundamento aprueba citas que ninguna tool devolvió"— **es inalcanzable en
  producción**, y lo demuestro abajo con el mismo tipo de argumento de camino de
  llamada con el que la ronda 6 tumbó un hallazgo mío. No lo repito como
  reincidente.
- Hacia **abajo**: el ancla de "3 o menos" —*existe un estado donde la base dice
  una cosa y el usuario cree otra*— hoy tiene **tres caminos vivos que ninguna
  ronda había nombrado**, y los tres nacen del mismo sitio: la capa
  determinística que existe para que eso no pase. No es que la nota anterior
  estuviera inflada; es que estaba bien puesta por razones distintas de las que
  se escribieron.

**El riesgo mayor del rubro, hoy:** en el turno que más importa —el "listo"— el
texto que lee el operador y el PDF que archiva el contralor son **dos cálculos
distintos, en dos momentos distintos, sobre una base que sigue cambiando**, y
uno de los dos afirma un cierre que puede no haber ocurrido.

---

## Método

Salida real de `npx tsx` importando los módulos del repo (`resumen.ts`,
`estado_afirmado.ts`, `fundamento.ts`) desde el scratchpad, sin tocar un solo
archivo del repo. `HEAD` = `abdc98d`, el mismo commit que auditó la ronda 6
(`git log` confirmado). Lo que no pude ejecutar (todo lo que toca Supabase o
Meta) va razonado sobre el código y dicho como tal.

---

## Hallazgos

### [CRÍTICO] El texto determinístico afirma "Listo, cuadré tu viaje" en un turno que NO cerró nada
`src/lib/cuadra/cuadre/guardia.ts:37-39` (`cuadro`) · `:79` (`resumenCuadre(liq, cuadro, 'operador')`) · `src/lib/cuadra/cuadre/resumen.ts:48-50` · `src/lib/cuadra/processor.ts:622` (`closed`) · `:689-696` · `:740` · `:780`

`cuadro` es verdadero si corrió **`cuadrar_viaje` O `guardar_liquidacion`**
(guardia.ts:37-39). `closed`, el hecho real del cierre, exige
`guardar_liquidacion` sin error (processor.ts:622). Son dos cosas distintas, y
`guardia.ts:79` le pasa **`cuadro`** al parámetro que `resumen.ts:48-50` llama
`cerrado` y que decide el encabezado. El propio comentario de `resumen.ts:48-50`
declara el contrato que el código viola: *"Si el viaje quedó cerrado en este
turno, se afirma el cierre; si la guardia solo está mostrando el cuadre (sin
cierre confirmado), encabezado neutral."*

Escenario, con valores. Viaje `v1`, anticipo $5,000, 5 tickets por $4,850. El
operador escribe **"¿cuánto llevo?"** (o el modelo cuadra y pregunta "¿la
cierro?", que es justo la conducta que la REGLA DE CIERRE de `prompts.ts:27`
existe para corregir). El agente llama `consultar_politica` + `cuadrar_viaje` y
**no** llama `guardar_liquidacion`. Entonces `closed = false`, `cuadro = true`,
`guardiaCifras` tira el texto del modelo y lo sustituye por:

```
Listo, cuadré tu viaje 👇
• Comprobado: $4,850.00
• Anticipo: $5,000.00
• Sobró $150.00 del anticipo (a favor de la empresa)
```

(salida real de `resumenCuadre(liq, true, 'operador')`). No se manda PDF
(`processor.ts:780`, `if (closed)` es falso). El viaje sigue `abierto` y la tabla
`liquidacion` está vacía.

Y la guardia escrita **exactamente** para desmentir un cierre falso no corre:
`processor.ts:740` la condiciona a `!textoDeterminista`, que aquí es `false`
porque `guardiaCifras` sí forzó. Aunque corriera, tampoco lo atraparía:
verificado con el módulo real, `guardiaEstado('Listo, cuadré tu viaje 👇…', {
cerro: false, entrego: false })` → `forzado: false, motivos: []`. Ninguna de las
cuatro regex de `AFIRMA_CIERRE` cubre la frase que produce su propia guardia
hermana.

El comportamiento está **fijado por una prueba**:
`src/lib/cuadra/cuadre/guardia.test.ts:48-52` afirma
`expect(r.reply).toContain('Listo, cuadré')` con un solo `cuadrar_viaje`, y el
comentario dice *"afirma cierre porque sí cuadró"*. La confusión entre "se
calculó" y "se cerró" está escrita como especificación.

**Consecuencia:** el chofer lee "Listo, cuadré tu viaje" con las cifras reales,
deja de mandar comprobantes y espera su PDF; el panel del contralor no tiene esa
liquidación porque nunca existió. Es el ancla literal del rubro, producida por la
capa determinística, sin que el modelo mienta en nada.
**Causa raíz probable:** un solo booleano (`cuadro`) sirve a dos preguntas —"¿hay
números que respaldar?" y "¿se cerró?"— y se pasa a un parámetro llamado
`cerrado`.

---

### [CRÍTICO] `guardiaFundamento` corre SIEMPRE con `permitidas = []`: toda cita normativa se borra a media frase
`src/lib/cuadra/processor.ts:719-721` · `src/lib/cuadra/normas/fundamento.ts:344-356` (`normasDeToolCalls`) · `:302-317` (limpieza por `FORMA_DE_CITA`) · `src/lib/cuadra/tools.ts:73-79, 87-95` · `src/lib/cuadra/cuadre/guardia.ts:37-39, 51, 79`

`permitidas` sale de `normasDeToolCalls`, que busca la llave `norma_id` en los
resultados de las tools (`fundamento.ts:351`). **El único sitio del repo que
emite `norma_id` es `tools.ts:88`, dentro de `cuadrar_viaje`** (verificado con
`grep -rn "norma_id" src/`: los otros dos aciertos son un comentario en
`fundamento.ts:338` y otro en `laboral/pagadero.ts:36`, cuyo campo se llama
`fundamento`, no `norma_id`, y que además no viaja en ningún resultado de tool).
Comprobado ejecutando el módulo:

```
normasDeToolCalls([{ politica: { topeEfectivo: 2000 } }])                → []
normasDeToolCalls([{ liquidacion_id:'x', estatus:'ok', pdf_generado:true }]) → []
```

Ahora el candado: `cuadrar_viaje` con éxito ⟹ `cuadro = true` (guardia.ts:37-39)
⟹ `guardiaCifras` **siempre** devuelve `forzado: true` (la línea 51 no sale y las
líneas 56-68 se saltan; el único `return` restante es el 79) ⟹
`textoDeterminista = true` ⟹ `processor.ts:719` **no ejecuta la guardia de
fundamento**. Dicho al revés: **el turno en que hay permisos es exactamente el
turno en que la guardia no corre; el turno en que la guardia corre nunca tiene
permisos.**

Con `permitidas = []` todo lo que `FORMA_DE_CITA` reconozca cae en
`CITA_DESCONOCIDA` y `fundamento.ts:317` lo borra. Salida real:

```
ENTRA: Ese diésel no cuenta porque el artículo 27, fracción III de la LISR limita a $2,000 los pagos en efectivo.
SALE : Ese diésel no cuenta porque el limita a $2,000 los pagos en efectivo.

ENTRA: El tope de efectivo es $2,000 por LISR 27-III, así que ese ticket queda a revisión.
SALE : El tope de efectivo es $2,000 por, así que ese ticket queda a revisión.

ENTRA: Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.
SALE : Te aplica el estímulo del diésel conforme al -A.
```

Escenario en la sala: cerrada la liquidación, el contralor pide *"¿y en qué se
basan para no contarme ese diésel?"*. El agente contesta de memoria, sin llamar
tools (no hay cifras nuevas que cuadrar), `guardiaCifras` no fuerza, y lo que
sale por WhatsApp es **"Ese diésel no cuenta porque el limita a $2,000 los pagos
en efectivo."** El tercer caso es el más caro: el estímulo del diésel —lo que se
vende— sale como *"conforme al -A."*

**Consecuencia:** el producto es estructuralmente incapaz de citar una norma a
través del modelo, y cuando lo intenta entrega una frase rota. La única vía por
la que un fundamento sí llega es `d.nota` de `engine.ts` dentro del resumen
determinístico (eso sí funciona, ver abajo) — pero nadie en el código lo sabe:
`tools.ts:73-77` afirma que `fundamentos` "es lo único que el agente puede
mencionar en este turno", y esa lista jamás se usa.
**Y cierra el reincidente de cuatro rondas:** reproduje hoy las cuatro frases de
la ronda 5 (`salvoOtraLey` ventana 45, `FIN_DE_NUMERO`) y las cuatro siguen
aprobándose `forzado: false` — **pero requieren `permitidas` no vacío, que es el
estado que el camino de llamada no puede producir**. Por eso no lo reporto como
CRÍTICO REINCIDENTE: la rama es inalcanzable, igual que lo fue mi hallazgo de
`guardiaEstado` en la ronda 6.
**Causa raíz probable:** el canal que otorga el permiso de citar y la guardia que
lo hace cumplir se activan con condiciones mutuamente excluyentes.

---

### [CRÍTICO] El texto y el PDF de la misma respuesta salen de dos fotografías distintas de la base; la foto que entra durante el cierre queda huérfana
`src/lib/cuadra/tools.ts:113-143` (T1: cuadre + PDF) · `src/lib/cuadra/cuadre/guardia.ts:70-79` (T2: se recalcula) · `src/lib/cuadra/processor.ts:780-796` (se manda el PDF de T1) · `:309-314, 460-463` (las fotos NO toman el mutex) · `:561` (el mutex solo lo toma el texto) · `src/lib/cuadra/repo.ts:141-180` (`addGasto` no mira el estatus del viaje)

`guardar_liquidacion` calcula el cuadre y **genera los dos PDF en ese instante**
(T1, tools.ts:113-139). Después el agente hace al menos una ronda más de LLM para
redactar, y ya en el processor `guardiaCifras` **vuelve a calcular** con
`cuadrarDesdeDB` (T2, guardia.ts:71) y con eso arma el texto que lee el operador.
Entre T1 y T2 hay segundos, y la entrada de ese cálculo —la tabla `gasto`— sigue
abierta a escritura: las fotos corren en su propio `processInbound`, **no toman
el mutex del viaje** (comentario explícito en processor.ts:305-308) y `addGasto`
no comprueba el estatus del viaje.

Escenario con valores. Anticipo $5,000, 5 tickets = $4,850. El operador escribe
"listo"; 6 segundos después manda **una foto más** (un diésel de $800 que se le
había pasado). Esa foto pasa `getOpenViaje` porque el viaje todavía está
`abierto`, entra a OCR (~10 s) y hace `addGasto` mientras el agente redacta.

| momento | qué se calcula | qué dice |
|---|---|---|
| T1 (guardar_liquidacion) | 5 gastos, $4,850 | PDF del operador y del contralor: **"Sobró $150.00 del anticipo (a favor de la empresa)"** |
| T2 (guardiaCifras) | 6 gastos, $5,650 | WhatsApp: **"Pusiste $650.00 de tu bolsa (a favor tuyo)"** |

El operador recibe las dos cosas seguidas, con $800 de diferencia y **de signo
contrario**, y lo que queda archivado en `liquidacion` y en el panel del
contralor es la versión chica. El sexto gasto queda huérfano: el viaje ya está
`liquidado`, nunca se vuelve a cuadrar, y el operador ni siquiera recibe acuse de
esa foto (el acuse solo sale con `registrados.length === 1`, processor.ts:452).

**Consecuencia:** dinero mal, en las dos direcciones a la vez, delante del
comprador. Es la contradicción más cara posible: el papel y el chat no coinciden,
y el chofer tiene por escrito que la empresa le debe $650.
**Causa raíz probable:** el mismo turno calcula la verdad dos veces contra una
entrada mutable, en vez de que la guardia reciba el resultado que la tool ya
persistió.

---

### [ALTO · REINCIDENTE de ronda 6] `ctxCerro` no se actualiza en la recuperación de cierre parcial, y `guardiaEstado` sigue sin `try/catch`
`src/lib/cuadra/processor.ts:226` (declaración) · `:623` (**único** sitio que la actualiza) · `:659-677` (la recuperación pone `closed = true` sin la línea gemela) · `:740-752` (`guardiaEstado`, sin `try/catch`) · `:838` (`cerroSinEntregar: ctxCerro`) · `src/lib/meta/client.ts:82-96` (`sendText` con `fetch` pelado)

Verificado hoy: `grep -n "ctxCerro"` devuelve **exactamente tres** líneas —226,
623 y 838—. La rama de recuperación de cierre parcial (`processor.ts:661-677`,
activa con `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, que `.env.example:75` y
`DECISIONES_PENDIENTES.md:17` recomiendan **encendida**) pone `closed = true` en
la línea 663 y no toca `ctxCerro`. El `tablero.html` de la ronda 6 no lista este
hallazgo entre los cerrados, y el diff lo confirma: solo se tocó `guardiaEstado`
(`25924be`) y `fundamento` (`01543e4`).

Escenario con valores: viaje `v2`, el agente truena con `TruncatedError` **después**
de que `guardar_liquidacion` devolvió `liquidacion_id`. La recuperación marca
`closed = true`, arma `reply` con `resumenCuadre` y vincula costos. En
`processor.ts:754`, `say(reply)` golpea la Graph API: `sendText` hace
`await fetch(...)` **sin `AbortSignal`** (a diferencia de las descargas de media,
que sí lo llevan) y sin `try/catch` propio; el propio `presupuesto.ts:64-68`
documenta que ahí el techo es el default de undici (300 s) contra un
`maxDuration` de 120. Si el fetch rechaza, el control salta al `catch` general y
el log sale con `cerroSinEntregar: false` — mintiendo justo sobre el campo que
existe para decir *"esta liquidación quedó cerrada y nadie recibió nada"*. Si en
cambio se **cuelga**, Vercel mata la invocación y no hay ni log ni
`saveConversation`.

Aparte, misma familia: `guardiaEstado` (740-752) sigue siendo la única de las
tres guardias sin `try/catch`; `guardiaCifras` (690-699) y `guardiaFundamento`
(719-728) sí lo tienen, con el mismo comentario de intención.

**Consecuencia:** el ingeniero de guardia lee el único campo diseñado para
detectar liquidaciones cerradas sin entregar, y ese campo dice que no hay nada
que revisar. El chofer se queda sin PDF y sin camino de vuelta (el viaje ya no
está abierto).
**Causa raíz probable:** `closed` tiene dos fuentes de escritura y `ctxCerro`
solo está enchufado a una.

---

### [ALTO] Dos mensajes de texto del mismo operador dentro de la ventana del agente: el segundo se descarta en silencio y para siempre
`src/lib/cuadra/processor.ts:192` (el claim ya se insertó) · `:561-566` (abandono silencioso) · `:813` (`saveConversation` solo escribe los turnos del que ganó) · `src/app/api/webhook/whatsapp/route.ts:70-76` (`Promise.all`) · `src/lib/cuadra/conv.ts:255-301`

Todo mensaje de texto toma el mutex del viaje (`processor.ts:561`). Si no lo
consigue, **se abandona el turno en silencio**. El comentario que lo justifica
dice: *"`false` significa una sola cosa: otro turno tiene el lease vigente y ESE
va a responder"*. Es cierto que ese otro turno responde — **pero a otro
mensaje**.

Escenario con valores. El operador escribe "¿cuánto llevo?" en t=0 y **"listo"**
en t=3 s (o los dos llegan en el mismo POST, que `route.ts:72` procesa con
`Promise.all`). El turno A toma el lease y corre el agente, que el propio
`presupuesto.ts:59` estima en ~20 s típicos y hasta 40 s de techo. El turno B
pasa la barrera (~2 s de gracia), pide el lock con `maxWaitMs = 12 000`, reintenta
con backoff, se le acaba la ventana, `acquireViajeLock` devuelve `false`, se
escribe `logger.warn('viaje.lock_ocupado_abandona')` y `return`.

Qué queda: el "listo" **nunca corre el agente**, **nunca entra a
`wa_conversacion.estado.turns`** (el turno A guarda solo los suyos, línea 813),
y **sigue reclamado** en `wa_mensaje_procesado` porque el `return` de la línea
565 no pasa por `releaseMessageClaim`. El operador ve sus dos palomitas azules y
una sola respuesta, sobre la pregunta equivocada. El viaje se queda abierto.

**Consecuencia:** el caso "se trabó" sin que nadie diga que se trabó. En el demo
es el paso 3 del guion: se teclea "listo" y no pasa nada, sin un error a la
vista.
**Causa raíz probable:** el mutex serializa *el viaje* pero se usa como si
serializara *el mensaje*; no hay cola ni reintento para el que pierde.

---

### [ALTO] Un `+1` fallido de la barrera no detiene la foto, pero el `-1` corre igual: la barrera abre sobre datos parciales y sin avisar
`src/lib/cuadra/processor.ts:314` (el valor devuelto se descarta) · `:460-462` (el `finally` decrementa incondicionalmente) · `src/lib/cuadra/conv.ts:325-334` (`intakeDelta` devuelve `null` ante error) · `:373-376` (`vacio()`)

La ronda 5/6 cerró el hueco de que `intakeDelta` devolviera `0` ante un error, y
lo hizo bien: hoy devuelve `null` y `vacio()` (conv.ts:375) exige
`n !== null && n <= 0`. Pero el **incremento** no está protegido de la misma
manera: `processor.ts:314` hace `await intakeDelta(viajeId, 1)` y descarta el
resultado —el comentario de las líneas 310-313 dice que se conserva la llamada
"porque su EFECTO —el incremento— es lo que sostiene la barrera", y nadie
comprueba que el efecto haya ocurrido—, mientras que el `finally` de la línea
461 decrementa **pase lo que pase**.

Escenario con valores. El operador manda 6 fotos y luego "listo". La foto #3 (el
diésel de $8,000) topa con un 503 transitorio en `intake_delta`: devuelve `null`,
el contador **no** sube, y el código sigue de largo a la descarga y el OCR. Las
otras cinco hacen su +1 y su −1 y quedan en 0. La #3 sigue en OCR y el contador
marca **0**. Llega "listo": `esperarIntake` ve 0, devuelve `true`, `intakeOk` es
`true` → **no se emite el aviso de "cuadré con los N que alcancé"**. Se cierra
con 5 comprobantes, $8,000 menos comprobados, PDF emitido y viaje `liquidado`. La
#3 termina su OCR y hace `addGasto` sobre un viaje ya cerrado (gasto huérfano) y
un `-1` que `greatest(0, …)` recorta.

**Consecuencia:** el operador termina debiendo de su bolsa $8,000 que sí gastó, y
es el único camino que no le avisa nada — exactamente el modo de falla que la
ronda 5 cerró, entrando por la puerta de al lado.
**Causa raíz probable:** la barrera trata el incremento como infalible y el
decremento como obligatorio; el par no es simétrico ante el error.

---

### [MEDIO] El contador de la barrera no tiene reset ni TTL: un `-1` perdido degrada el viaje para el resto de su vida
`src/lib/cuadra/processor.ts:461` · `src/lib/cuadra/conv.ts:325-334` · `supabase/migrations/0011_intake_barrera.sql:14-18`

`intake_delta` recorta con `greatest(0, …)`, así que el contador solo puede bajar
con `-1` exitosos. **Nada en el repo lo pone en cero**: dos búsquedas
independientes (`grep -rn "intake_pendientes" src/ supabase/` y `grep -rn
"intake_delta"`) no encuentran ni un `update … = 0`, ni un TTL, ni una limpieza
al cerrar la liquidación.

Escenario con valores: el `intakeDelta(viajeId, -1)` de la línea 461 falla por un
blip (devuelve `null`, deja un `logger.warn('intake.delta')` y nadie lo mira).
`viaje.intake_pendientes` se queda en 1 **permanentemente**. A partir de ahí,
cada "listo" de ese viaje espera los 20 s completos de la barrera, devuelve
`false`, y el operador recibe *"⚠️ Ojo: cuadré con los 6 comprobantes que alcancé
a procesar. Si te faltó alguno, reenvíalo y escribe *listo* otra vez"* — un aviso
falso. Si obedece y reenvía, con `CUADRA_DEDUP_FOTOS` apagado (default,
`processor.ts:324`) el mismo ticket entra como **segundo gasto**.

**Consecuencia:** 20 s de latencia añadidos a cada cierre de ese viaje, un aviso
que miente, y un empujón directo hacia el gasto duplicado.
**Causa raíz probable:** un contador persistente sin dueño de su reinicio.

---

## Verificación de lo que venía abierto de la ronda 6

| Hallazgo de ronda 6 | Estado hoy | Evidencia |
|---|---|---|
| CRÍTICO REINCIDENTE · la guardia aprueba citas fabricadas (`salvoOtraLey`, `FIN_DE_NUMERO`) | **INALCANZABLE**, no reincidente | las 4 frases siguen saliendo `forzado: false`, pero exigen `permitidas ≠ []`, estado que el camino de llamada no puede producir (ver CRÍTICO 2) |
| CRÍTICO · la unificación borra fundamento LEGÍTIMO | **CERRADO como bug, sustituido por uno peor** | `01543e4` añadió el reconocimiento "sigla después del número"; pero con `permitidas` siempre vacío se borra **toda** cita, legítima o no (CRÍTICO 2) |
| CRÍTICO · `guardiaEstado` tacha un cierre real | **declarado FALSO en ronda 6; lo confirmo** | `guardia.ts:37-39` + `:79` hacen `textoDeterminista = true` en todo cierre real; `processor.ts:747` ya pasa `entrego: closed ? 'pendiente' : false`. La rama sigue sin existir |
| ALTO · `ctxCerro` + `guardiaEstado` sin `try/catch` | **ABIERTO, REINCIDENTE** | `grep -n ctxCerro` → 226, 623, 838. No aparece en el `tablero.html` de cerrados |
| ALTO · la foto posterior al cierre se tira sin guardar nada | **ABIERTO** | `processor.ts:263` solo exceptúa `msg.type === 'document'`; `image` sigue sin excepción |
| MEDIO · `cuadro=true` tira el 100% del texto del modelo | **ABIERTO, y ahora con consecuencia nombrada** | es el mecanismo que apaga las otras dos guardias (CRÍTICO 1 y 2) |
| MEDIO · `loadConversation` con el teléfono crudo | **ABIERTO** | `processor.ts:576` sigue pasando `msg.from` y no `op.telefono`; si Meta alterna `521…`/`52…` se abren dos filas de conversación para el mismo operador |
| MEDIO · sufijo de letra huérfano en la limpieza | **ABIERTO y ahora en el camino vivo** | `"…conforme al LIF 2026 Art. 20-A."` → `"…conforme al -A."` (salida real, `permitidas=[]`) |
| MEDIO · mutex sin heartbeat, abandono silencioso | **ABIERTO y peor de lo que se creía** | ver ALTO del mensaje perdido |

---

## Lo que revisé y está bien

- **`guardiaEstado` ya no puede producir la contradicción de la ronda 6.**
  `processor.ts:747` pasa `entrego: closed ? 'pendiente' : false` y
  `estado_afirmado.ts:108` compara con `=== false`. Además demostré que
  `real.cerro` **nunca puede ser `true`** en ese punto (si hubo cuadre,
  `textoDeterminista` apaga la guardia), así que el falso positivo que reporté en
  la ronda 6 es doblemente imposible. El precio de esa seguridad es que la mitad
  `cerro: true` de la función es código inalcanzable.
- **La guardia de cifras es fail-closed de verdad.** `guardia.ts:80-86`: si
  `cuadrarDesdeDB` truena, sale un texto sin un solo número. Verificado también
  que con `cuadro = true` no hay `return` posible que no pase por
  `resumenCuadre` o por ese fail-closed.
- **El destinatario es el correcto en las tres salidas de WhatsApp.** Los tres
  llamadores de `resumenCuadre` que van al chofer pasan `'operador'` explícito
  (`processor.ts:597`, `:673`, `guardia.ts:79`); el default `'contralor'` de
  `resumen.ts:45` no lo usa ninguna ruta de WhatsApp. Y el PDF que se manda es
  `${viajeId}-operador.pdf` (`processor.ts:793`), el ejemplar filtrado, no el
  completo. `SOLO_CONTRALOR` (`resumen.ts:24-28`) deja fuera
  `complemento_no_verificable`, que es lo único que el operador sí puede
  arreglar.
- **El fundamento SÍ llega al operador, por la vía determinística.** Las notas de
  `engine.ts` traen la cita dentro del texto (`engine.ts:223` LISR 27-III,
  `:383` regla 2.7.1.48 RMF + CFF 29-A, `:614` LISR 28-V, `:700` LIF 2026 art.
  20 ap. A), y `resumenCuadre` las imprime. O sea: el veredicto citado que ve el
  operador nunca pasó por el modelo. Eso es correcto y es lo que salva el
  CRÍTICO 2 de ser aún peor.
- **La rejilla de mutaciones no puede duplicar un cierre.**
  `tool-executor.ts:94-117` cachea la **promesa** antes del `await` y se llavea
  por nombre, no por args; `openrouter.ts:513-518` reintenta solo la llamada de
  completado, nunca la ejecución de tools; y `guardar_liquidacion_tx`
  (`0021_…sql`) es `on conflict (viaje_id) do update` con el `update viaje` en la
  misma transacción. Tres capas, y las tres miran en la misma dirección.
- **El abandono por doble "listo" sí es correcto en el caso para el que se
  escribió.** `processor.ts:570-573` re-verifica el viaje después de tomar el
  lock y responde "ese viaje ya quedó cerrado" en vez de re-correr el agente.
- **La sonda de arranque de la 0022 no escribe nada.** `startup.ts:155-159` llama
  `guardar_liquidacion_tx` con `tenant`/`viaje` en ceros; la FK
  `liquidacion_viaje_tenant_fkey` (`0028_fks_con_tenant.sql:94`) lo rechaza, así
  que no se crea una liquidación fantasma en cada arranque en frío. Lo verifiqué
  porque el patrón "sondear con una mutación" suele dejar basura; aquí no.
- **La barrera de ráfaga del MISMO lote está razonablemente cubierta.** La gracia
  de 2 s (`conv.ts:366`, default ya no 0) cubre el desfase entre el "listo" y el
  `+1` de las fotos del mismo POST, que hacen las mismas tres llamadas de red
  antes. El hueco que queda es el de los ALTO/MEDIO de arriba, no éste.
- **`resolveOperador` y `getOpenViaje` siguen distinguiendo "no pude preguntar"
  de "no hay"** (`conv.ts:82`, `:137`, `ConsultaFallida`), y el `catch` general
  lo traduce a un mensaje cierto (`processor.ts:825-850`). El patrón de las cinco
  apariciones del MAPA no reaparece en `conv.ts`, `processor.ts`,
  `presupuesto.ts` ni `startup.ts`: los revisé los cuatro y `startup.ts:48-63`
  además tiene la distinción hecha explícita (`sinRespuesta`).
- **El presupuesto compartido está bien cableado.** `crearPresupuesto` arranca en
  la primera línea (`processor.ts:216`), y las tres etapas caras lo consultan
  (`:541` barrera, `:561` mutex, `:611` agente), con la compuerta de
  `alcanza(COSTO_AGENTE_MS)` en `:593` que cae al resumen determinístico en vez
  de lanzar un agente que Vercel va a cortar. Es la pieza mejor hecha del rubro.

---

## Lo que NO alcancé a revisar

- **Nada contra el modelo real ni contra Supabase.** Estoy en la nube, sin
  `.env`, sin OpenRouter y sin base. Todo lo de arriba es o salida de módulos
  puros importados de verdad, o lectura de código. En particular **no medí con
  qué frecuencia Sonnet omite `guardar_liquidacion`** tras un "listo" (el
  disparador del CRÍTICO 1): sé que el camino existe y que el prompt tuvo que
  añadir una REGLA DE CIERRE explícita para combatirlo, pero la frecuencia es
  inferencia.
- **La ventana real entre T1 y T2 del CRÍTICO 3.** Depende de cuánto tarda la
  ronda final del LLM; la estimé en segundos por la tabla de `PASOS_CIERRE`, no
  la cronometré.
- **Concurrencia real de Postgres.** `try_lock_viaje`, `intake_delta` y
  `guardar_liquidacion_tx` los leí en SQL; no los corrí en paralelo.
- **El ciclo completo de `statuses` de Meta.** La lectura está verificada por
  código (`route.ts:108-120`); que Meta entregue un `failed` con la forma que
  `WaEstado` espera lo tomo de la documentación.
- **`agents/run.ts`, `registry.ts`, `types.ts` a fondo.** Los leí enteros (61,
  24 y 22 líneas) y no encontré nada nuevo: el `AbortController` de `run.ts:32-34`
  aborta el completado, no las tools en vuelo, que es el comportamiento que hace
  seguro `PartialExecutionError`. No hay hallazgo, pero tampoco los ataqué con
  ejecución.
- **`prompts.ts` como superficie de inyección.** Lo leí y sus reglas de seguridad
  (líneas 29-34) están bien puestas; auditarlas de verdad es del rubro de
  seguridad, no del mío.
