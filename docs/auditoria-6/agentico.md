# Sistema agéntico y orquestación — auditoría 6

**Nota: 3/10** (antes 4). Razón: **deuda que cobró factura, y por partida doble**.
El ancla de "3 o menos" —*existe un estado donde la base dice una cosa y el
usuario cree otra*— llevaba una ronda con un solo camino vivo (afirmaciones de
estado, sin backstop). Hoy hay **tres caminos simultáneos**, verificados con
salida real de scripts que importan el módulo del repo, no con lectura:

1. El CRÍTICO de "la guardia certifica la ley equivocada" (ronda 4 y 5) **sigue
   exactamente igual**. Reproduje las CUATRO frases textuales del reporte de
   ronda 5 contra el código de HOY y las cuatro se aprueban idéntico. El
   `git diff` contra `86e23aa` (el commit que auditó ronda 5) confirma que el
   mecanismo responsable —`salvoOtraLey` y `FIN_DE_NUMERO`— **no se tocó**; el
   cambio de ayer (ventana lazy) arregló un bug hermano, distinto, y el reporte
   de esta ronda 6 lo presenta como si cerrara los cuatro.
2. El arreglo que SÍ tocó ese archivo (unificar detección y limpieza) cierra
   ese bug hermano pero abre uno nuevo: ahora la guardia **borra fundamento
   LEGÍTIMO** —una cita que una tool sí devolvió este turno— cuando el modelo
   la redacta en una forma que la detección ensanchada reconoce y el
   reconocimiento específico no. Le pasa al caso más vendido del producto (el
   estímulo del diésel, LIF 2026 Art. 20-A).
3. La guardia nueva de esta ronda (`estado_afirmado.ts`, la que por fin cierra
   el crítico de TRES rondas) tiene su propio falso positivo: cuando el cierre
   SÍ ocurrió y el modelo narra el envío del PDF en pretérito —una forma que el
   propio prompt empuja a producir—, la guardia tacha el mensaje correcto y lo
   sustituye por "todavía no he cerrado tu liquidación", y ACTO SEGUIDO manda
   el PDF real en el siguiente mensaje. El operador recibe una contradicción
   que la base nunca tuvo.

Contrapeso real, y por eso no baja más: la barrera de ráfaga (ALTO de ronda 5)
quedó fail-closed de verdad, `resolveOperador`/`getOpenViaje` ya no confunden
"no pude preguntar" con "no hay", y los acuses de entrega de Meta por fin se
leen. Eso es trabajo real y verificado. Pero el rubro se califica por el
ancla de 3-o-menos, y esa ancla hoy tiene más caminos abiertos que ayer, no
menos — dos de ellos nacidos en el mismo trabajo que el parte de esta ronda
presenta como el cierre del problema.

---

## Método

Todo lo de abajo es salida real de `npx tsx` importando los módulos del repo
desde `/private/tmp/.../scratchpad/test_fundamento.ts` y `test_estado.ts`, sin
modificar ningún archivo del repo. `HEAD` al escribir: `5b2ec76` (`Auditoría 5 ·
tablero y síntesis`), árbol limpio. Comparé contra `86e23aa`, el commit que
auditó el reporte de ronda 5, con `git diff 86e23aa..HEAD` por archivo.

---

## Verificación de lo que se declaró arreglado (los 4 críticos de ronda 5)

| Ronda 5 | Estado hoy | Evidencia |
|---|---|---|
| CRÍTICO 1 · guardia AUTORIZA citas fabricadas (distancia 45+, sufijo de letra) | **SIGUE IGUAL, sin tocar** | `fundamento.ts:52-65,77-78,110` sin diff contra `86e23aa`; las 4 frases de ronda 5 reproducidas idénticas → sigue abajo |
| CRÍTICO 2 · guardia detecta y no limpia | **CERRADO de verdad** | `fundamento.ts:264` (limpieza unificada), probado con las 4 frases de ronda 5 con `permitidas=[]`: las 4 salen mutiladas pero SIN la cita inventada → sigue abajo (`lo que revisé y está bien`) |
| CRÍTICO 3 · PDF dado por entregado, `statuses` sin leer | **MEJORADO, no cerrado del todo** | `route.ts:93-105` lee `value.statuses` y hace `logger.error('wa.no_entregado', …)`, que SÍ llega a Sentry (`logger.ts`). Pero nadie reintenta ni avisa al operador: el ingeniero se entera, el chofer sigue sin PDF → nota en "lo que revisé" |
| CRÍTICO 4 · ninguna guardia mira afirmaciones de estado | **CERRADO para el caso original, REABIERTO por otro lado** | `estado_afirmado.ts` existe y funciona para `closed=false`; falla exactamente al revés cuando `closed=true` → CRÍTICO nuevo, abajo |

---

## Hallazgos

### [CRÍTICO REINCIDENTE] La guardia de fundamento SIGUE aprobando citas que ninguna tool devolvió — el arreglo de ayer no tocó el mecanismo, tocó uno distinto
`src/lib/cuadra/normas/fundamento.ts:52-65` (`patronesDe`, ventana `{0,45}` de `salvoOtraLey`) · `:97-110` (`FIN_DE_NUMERO`)

`git diff 86e23aa..HEAD -- src/lib/cuadra/normas/fundamento.ts` muestra que el
único cambio en `patronesDe` fue volver LAZY (`{0,45}?`) las dos regex que
EXIGEN el alias de la ley cerca (líneas 65-66). Eso es un arreglo real, pero es
para el bug HERMANO (dos citas en la misma frase, una legítima y una
inventada — CRÍTICO 2 de ronda 5). El mecanismo del CRÍTICO 1 —`salvoOtraLey`
(línea 77, ventana fija `[^.]{0,45}`, no lazy: es un lookahead, la pereza no
aplica) y `FIN_DE_NUMERO` (línea 110, solo bloquea si lo que sigue es un
DÍGITO, nunca una letra)— **no aparece en el diff**. Reproduje las cuatro
frases EXACTAS del reporte de ronda 5 contra el código de hoy:

```
--- ronda5 caso1 - CFF lejos ---
permitidas: [ 'lisr-27-fr-III' ]
ENTRA: "Ese diésel no es deducible por el artículo 27, fracción III, que es la
        regla general de los pagos en efectivo que trae el Código Fiscal de la
        Federación."
citasEnTexto: [ 'lisr-27-fr-III' ]   forzado: false    ← la guardia lo APRUEBA

--- ronda5 caso2 - LIF 20-B inventado ---
permitidas: [ 'lif-2026-art-20-A' ]
ENTRA: "El estímulo del diésel sale del LIF 2026 Art. 20-B, apartado que aplica
        a tu caso."
citasEnTexto: [ 'lif-2026-art-20-A' ]   forzado: false

--- ronda5 caso3 - LIF 20-C inventado ---
permitidas: [ 'lif-2026-art-20-A' ]
ENTRA: "Te aplica el estímulo del 50% de peaje conforme al LIF 2026 Art. 20-C."
citasEnTexto: [ 'lif-2026-art-20-A' ]   forzado: false

--- ronda5 caso4 - CFF 29-AB inventado ---
permitidas: [ 'cff-29-A' ]
ENTRA: "Falta un requisito del CFF 29-AB."
citasEnTexto: [ 'cff-29-A' ]   forzado: false
```

Byte por byte el mismo resultado que documentó ronda 5. La razón, letra por
letra: en el caso 1, "Código Fiscal de la Federación" empieza ~63 caracteres
después de "fracción III" — más allá de la ventana fija de 45 de
`salvoOtraLey` (línea 77) — así que el patrón "a secas" (línea 78) no ve la
ley ajena y aprueba la cita como si fuera de la LISR. En los casos 2-4, la
cita PERMITIDA es la forma literal ("LIF 2026 Art. 20", "CFF 29-A") y
`FIN_DE_NUMERO` solo veta que la siga un DÍGITO: un guion+LETRA inventado
detrás ("-B", "-C", "-AB") no lo activa, así que el patrón literal casa el
prefijo real y dEja pasar el sufijo fabricado como si fuera parte de la misma
cita autorizada.

`lif-2026-art-20-A` es, otra vez, la norma del **caso más vendido del
producto**. Consecuencia: sin cambio respecto a ronda 4 y 5 — el contralor con
fiscalista en la sala puede recibir un apartado de ley que no existe, aprobado
por el propio sistema que existe para evitar justo eso, y sin una sola línea
de log que lo distinga de una cita real.
Causa raíz: el commit de ayer resolvió el bug que el propio comentario del
código describe (la ventana codiciosa que se traga una cita ajena en la MISMA
frase), y ese SÍ es un arreglo válido — pero el reporte que orienta esta ronda
6 lo presenta como si hubiera cerrado "los cuatro críticos" de ronda 5. No
cerró este. (**REINCIDENTE** de auditoría 3, 4 y 5, sin ningún cambio de
código en la parte responsable.)

### [CRÍTICO] La misma unificación que cierra el bug de arriba ahora BORRA fundamento LEGÍTIMO
`src/lib/cuadra/normas/fundamento.ts:129-157` (`FORMA_DE_CITA`, la detección ensanchada) vs `:32-81` (`patronesDe`, el reconocimiento específico) · `:264` (limpieza unificada) · `processor.ts:714-723`

El commit de ayer (bien documentado en el propio código: "SE LIMPIA CON EL
MISMO PATRÓN QUE DETECTÓ, no con una copia a mano") resuelve que la limpieza
de `CITA_DESCONOCIDA` ya no se quede corta — correcto, y lo verifiqué (ver
"lo que revisé y está bien"). Pero tiene una asimetría que el comentario no
contempla: `FORMA_DE_CITA` reconoce MÁS formas de cita de las que `patronesDe`
sabe atribuir a una norma específica. Cuando el modelo cita una norma que SÍ
está en `permitidas` —la tool SÍ la devolvió este turno— pero la redacta en
una de esas formas extra (número en palabras, sigla después del número), la
cita nunca entra a `citadas` (porque `patronesDe` no la reconoce como
perteneciente a ese id), así que nunca se PROTEGE en el paso 2, cae en
`CITA_DESCONOCIDA` por descarte, y el paso 3 la borra con el mismo
`FORMA_DE_CITA` que la detectó. Salida real, con la cita legítimamente
permitida:

```
--- legit, número en palabras (permitida: lisr-27-fr-III) ---
ENTRA: "No es deducible por el artículo veintisiete fracción tres de la LISR."
citasEnTexto: [ 'DESCONOCIDA' ]   forzado: true   quitadas: ['DESCONOCIDA']
SALE:  "No es deducible por el de la LISR."

--- legit, sigla después del número (permitida: lisr-27-fr-III) ---
ENTRA: "No es deducible conforme al 27-III LISR por ser pago en efectivo."
SALE:  "No es deducible conforme al LISR por ser pago en efectivo."

--- legit, LIF 2026 (permitida: lif-2026-art-20-A, EL CASO MÁS VENDIDO) ---
ENTRA: "Te aplica el estímulo conforme al 20-A LIF 2026."
SALE:  "Te aplica el estímulo conforme al."
```

El tercer caso es el que más pesa: es exactamente el estímulo del diésel del
LIF 2026, y la frase sale rota a la mitad ("conforme al.") — sin artículo, sin
ley, sin nada, aunque la norma SÍ vino de `consultar_politica`/`cuadrar_viaje`
este mismo turno.

Control (misma cita, forma que `patronesDe` SÍ reconoce): "No es deducible por
el artículo 27, fracción III de la LISR." → `forzado: false`, sale intacta.

Consecuencia: el log dice `agent.fundamento_forzado` con `quitadas:
['DESCONOCIDA']`, y quien lo lea a las 3am va a asumir que se protegió al
operador de una cita inventada — es literalmente lo mismo que se creyó del
lado contrario en ronda 5 ("el log dice forzado y el texto sale igual"; aquí
es "el log dice forzado y el texto que se quitó era el correcto"). En el
demo, el modelo no necesita alucinar nada: basta con que redacte la cita
legítima con una construcción gramatical distinta a las que `patronesDe`
anticipó, y el fundamento del veredicto desaparece de la respuesta.
Causa raíz: dos funciones que deberían reconocer EXACTAMENTE el mismo
lenguaje —una para detectar qué es cita, otra para saber DE QUÉ norma— se
ensancharon por separado. Es el mismo patrón de "dos catálogos que hay que
sincronizar a mano" que el propio comentario del commit de ayer identifica
como la causa raíz del bug anterior, aplicado sin querer a sí mismo: unificar
la LIMPIEZA con la DETECCIÓN no sirve si el RECONOCIMIENTO (a qué norma
pertenece) sigue siendo una tercera lista aparte.

### [CRÍTICO] `guardiaEstado` tacha un cierre REAL cuando el modelo narra el envío en pretérito, y manda el PDF de todas formas en el siguiente mensaje
`src/lib/cuadra/cuadre/estado_afirmado.ts:58-61` (`AFIRMA_ENVIO`) · `processor.ts:736` (`entrego: false` fijo) · `:769` (el bloque del PDF, ajeno a lo que dijo la guardia)

`guardiaEstado(reply, { cerro: closed, entrego: false })` en `processor.ts:736`
pasa `entrego` **fijo en `false`**, siempre, sin importar `closed`. Tiene
sentido en el punto exacto del código —el PDF todavía no se intenta enviar,
eso ocurre 30 líneas después, en el bloque `if (closed)` de la línea 769— pero
la guardia no distingue "no se ha intentado enviar TODAVÍA en este turno" de
"el modelo miente sobre haber enviado algo que nunca va a pasar". Cuando
`closed = true` (el cierre SÍ ocurrió: `guardar_liquidacion` corrió y tuvo
éxito) y el modelo narra la promesa del PDF en pretérito —una forma
gramatical perfectamente natural después de acabar de ejecutar la acción, y
que el propio prompt no prohíbe ("Avísale que le llega su liquidación en
PDF." no dice en qué tiempo verbal)—, la guardia lo trata como mentira:

```
--- cierre real (closed=true) + "ya te envié tu liquidación" ---
ENTRA: "Comprobaste $4,850.00 contra un anticipo de $5,000.00. Te quedan
        $150.00 a tu favor. Ya te envié tu liquidación, en un momento te
        llega el PDF. 🚛"
forzado: true   motivos: [ 'envio_no_ocurrido' ]
SALE:  "Todavía no he cerrado tu liquidación. Cuando ya no te falte ningún
        comprobante, escribe *listo* y la cierro. 🚛"

--- cierre real (closed=true) + "ya te la mandé" ---
ENTRA: "Quedó cuadrado tu viaje: comprobaste $4,850 contra $5,000 de
        anticipo. Ya te la mandé, checa tu liquidación en PDF."
forzado: true   motivos: [ 'envio_no_ocurrido' ]
SALE:  "Todavía no he cerrado tu liquidación..."
```

`closed` no lo toca esta guardia — solo reescribe `reply`. Así que en
`processor.ts:769`, `if (closed)` sigue siendo `true`: el bloque del PDF
corre exactamente igual, `pdfGenerado` sale `true`, y `sendDocument` manda el
PDF real. **El operador recibe, en la misma conversación, "todavía no he
cerrado tu liquidación" seguido inmediatamente del PDF de su liquidación ya
cerrada.** Es la contradicción que el rubro entero existe para prevenir,
producida por la guardia que se escribió específicamente para prevenirla.

Escenario con valores: viaje `v1`, anticipo $5,000, comprobado $4,850 en 6
tickets. El operador escribe "listo". El agente llama
`consultar_politica` → `cuadrar_viaje` → `guardar_liquidacion` (los tres en el
mismo turno, como pide el prompt), y redacta la respuesta resumiendo el
cuadre y anunciando el PDF en pretérito. `closed = true`. `guardiaCifras` no
fuerza (las cifras SÍ vienen de `cuadrar_viaje`). `guardiaFundamento` no
fuerza (no hay citas normativas en este turno). `guardiaEstado` SÍ fuerza, por
"ya te envié/mandé". El operador ve: 1) "Todavía no he cerrado tu
liquidación..."; 2) el PDF adjunto, con el caption "Aquí está tu liquidación
📄". Si el operador, confundido, reescribe "listo" para "de verdad" cerrar,
`getOpenViaje` ya no encuentra el viaje (está `liquidado`) → "No tienes un
viaje abierto para liquidar ahorita" — un TERCER mensaje que tampoco cuadra
con los dos anteriores.
Consecuencia: en el demo, frente al contralor, el bot se contradice a sí
mismo en dos mensajes consecutivos sobre el mismo hecho — que es exactamente
el escenario que MAPA.md pone como ejemplo de lo que cuesta el trato.
Causa raíz: la guardia compara la afirmación del modelo contra `entrego`, pero
`entrego` no es un hecho consultado — es una constante hardcodeada al valor
que SIEMPRE tiene en ese punto del código, así que la comparación no puede
distinguir "miente" de "lo cuenta con el verbo equivocado sobre algo que el
propio turno va a hacer cierto 30 líneas después". El comentario de
`estado_afirmado.ts:23-27` advierte del riesgo exacto ("un falso positivo
aquí tacha un mensaje correcto y le dice al operador que espere cuando ya
terminó") y lo hizo real en el camino más transitado del sistema: el cierre
que sí funciona.

### [ALTO] `ctxCerro` no se actualiza en la recuperación de cierre parcial, y `guardiaEstado` corre sin la misma red que sus guardias hermanas
`src/lib/cuadra/processor.ts:221` (declaración) · `:618` (se actualiza SOLO en el camino normal) · `:658` (se pone `closed = true` en la recuperación, SIN tocar `ctxCerro`) · `:735-741` (`guardiaEstado`, sin `try/catch`) · `:743` (`say(reply)`, sin `try/catch` local) · `src/lib/meta/client.ts:82-96` (`sendText`, el `fetch` no está envuelto)

`ctxCerro` es la variable que el `catch` general (línea 827,
`cerroSinEntregar: ctxCerro`) usa para decirle al ingeniero de guardia si una
liquidación quedó cerrada sin que el operador recibiera nada — la razón de
ser de ese campo, según su propio comentario (línea 216-218), es
precisamente no repetir el ALTO de ronda 5 ("el catch no sabe que hubo
cierre"). Se actualiza en el camino normal (`ctxCerro = closed;`, línea 618),
pero la rama de RECUPERACIÓN de cierre parcial (`cierreParcial`, activada con
`CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, confirmado en `.env.local:34` y en
`.vercel/.env.production.local`) pone `closed = true` en la línea 658 **sin
la línea gemela `ctxCerro = closed`**.

Esa rama existe justo para el turno que YA falló una vez (el agente lanzó
`PartialExecutionError` o `TruncatedError`). Si algo vuelve a fallar
DESPUÉS de la recuperación —y el candidato más real es `say(reply)` en la
línea 743: `sendText` (`client.ts:82-96`) hace `await fetch(...)` sin
`try/catch` propio y sin `AbortSignal.timeout` (a diferencia de las
descargas de media, que sí lo tienen), así que un blip de red hacia la Graph
API de Meta se propaga sin capturar— el control salta al `catch` general
(línea 803) SIN pasar por el bloque del PDF (línea 769-800). El log que se
escribe ahí (`processInbound.fail` o similar) trae `cerroSinEntregar: false`,
mintiendo exactamente sobre lo que ese campo se diseñó para evitar: la
liquidación SÍ está cerrada en la base (se recuperó en la línea 658), y nadie
que lea el log lo va a saber.

Nota aparte, misma familia: `guardiaEstado` (líneas 735-741) es la ÚNICA de
las tres guardias deterministas que corre SIN `try/catch` propio —
`guardiaCifras` (685-694) y `guardiaFundamento` (714-723) sí lo tienen, con
el mismo comentario de intención ("no debe tumbar el turno"). Si
`guardiaEstado` lanzara por cualquier razón, el efecto es el mismo salto al
`catch` general con `ctxCerro` potencialmente desactualizado.

Escenario con valores: viaje `v2`, el primer intento del agente truena por
`TruncatedError` DESPUÉS de que `guardar_liquidacion` ya corrió y devolvió
`liquidacion_id`. La recuperación (línea 654-672) marca `closed = true`,
arma `reply` con `resumenCuadre`, vincula costos. `say(reply)` en 743 golpea
un timeout de la Graph API (Meta tiene caídas puntuales documentadas por la
propia industria). Excepción no capturada → `catch` general → log con
`cerroSinEntregar: false`. La liquidación de `v2` quedó cerrada, con PDF en
storage, y el ingeniero que revisa logs al día siguiente —guiado por ese
mismo campo, que existe para decirle justo esto— concluye que no hay nada
que revisar.
Consecuencia: reproduce el ALTO que ronda 5 dio por cerrado ("cualquier error
entre el cierre y el bloque del PDF salta la entrega, y el log que existe
para eso no se dispara"), en un punto de entrada nuevo que el propio arreglo
de ayer no cubrió.
Causa raíz: `ctxCerro` se actualiza en UN solo sitio del código (línea 618)
que asume que `closed` solo cambia ahí; la recuperación de cierre parcial es
una segunda fuente de verdad para `closed` que no se conectó a la primera.

---

## Reincidentes sin cambio de código (ya reportados, no vueltos a auditar a fondo)

- **[ALTO] La foto que llega después del cierre se sigue tirando sin guardar
  nada** (`processor.ts:244-268`). El corte por "sin viaje abierto" solo tiene
  excepción para `msg.type === 'document'` (línea 258); `msg.type === 'image'`
  sigue sin ninguna. Nada en el diff de esta ronda toca esta rama.
- **[MEDIO] Sufijo de letra huérfano en la limpieza, sobrevive a la
  unificación**: probé `"Esto se basa en el LIF 2026 Art. 20-B, que no
  existe."` con `permitidas=[]` → sale `"Esto se basa en el -B, que no
  existe."` El patrón literal de `n.citas[0]` consume "LIF 2026 Art. 20" y dEja
  "-B" huérfano porque `FIN_DE_NUMERO` no lo bloquea (mismo mecanismo que el
  primer CRÍTICO de arriba). Reincidente de rondas 3 y 4.
- **[MEDIO] `loadConversation` sigue con el teléfono crudo**
  (`processor.ts:571`, pasa `msg.from` en vez de `op.telefono`). Sin cambio
  desde ronda 5.
- **[MEDIO] `cuadro=true` sigue tirando el 100% del texto del modelo**
  (`cuadre/guardia.ts:37-39,51,79`) y **`resumen.ts` sigue sin una sola
  aserción sobre sus tres líneas de dinero**. Ninguno de los dos archivos
  aparece en el diff desde `86e23aa` — sin cambios, sin nueva verificación
  esta ronda más allá de confirmar que siguen intactos.
- **[MEDIO] Abandono silencioso del mutex sin distinguir dueño vivo de dueño
  muerto** (`conv.ts:255-301`, sin heartbeat). Sin cambios.

---

## Lo que revisé y está bien

- **Barrera de ráfaga, de verdad fail-closed.** `conv.ts:325-334`
  (`intakeDelta`) devuelve `null` ante cualquier error de la RPC, no `0`.
  `conv.ts:373-376` (`vacio`) trata `null` como "no sé" y NUNCA abre la
  barrera con eso: `n !== null && n <= 0`. Antes un error transitorio abría
  la barrera en silencio y la liquidación salía corta sin avisar; ahora el
  camino de error converge con el de timeout normal (avisa al operador,
  cuadra con lo que alcanzó). Cierra el ALTO de ronda 5.
- **`resolveOperador` y `getOpenViaje` ya no confunden "no pude preguntar"
  con "no hay".** `conv.ts:82` y `:137` lanzan `ConsultaFallida` en vez de
  devolver `null`/falso ante un error de Supabase; `processor.ts:814-839`
  distingue esa excepción en el `catch` general y le dice al operador la
  verdad ("no pude consultar, inténtalo de nuevo") en vez de "no te tengo
  registrado" o "ese viaje ya quedó cerrado". Es el patrón de las cuatro
  "consultas disfrazadas de ausencia" que el MAPA de esta ronda pedía
  vigilar — en `conv.ts` ya está resuelto en los dos sitios donde vivía.
- **`resolveOperador` ya no adivina ante ambigüedad**: pide DOS filas
  (`.limit(2)`, línea 73) y lanza `OperadorAmbiguo` si hay más de una activa,
  en vez de tomar la primera sin `order by` (que ronda 4/5 marcó como el
  riesgo de escribir dinero de una flota en la de otra).
- **CRÍTICO 2 de ronda 5 (detecta y no limpia), cerrado de verdad.** Probé
  las cuatro frases inventadas del reporte anterior con `permitidas=[]`: las
  cuatro salen SIN la cita fabricada (mutiladas gramaticalmente, pero sin la
  mentira). El caso de la misma frase con una cita legítima y una inventada
  también se resuelve correctamente ahora: conserva la legítima, quita solo
  la inventada.
- **Los acuses de entrega de Meta ya se leen.** `route.ts:93-105`
  (`extractStatuses`) recorre `value.statuses` y hace `logger.error`
  (llega a Sentry, verificado en `logger.ts`) ante `status: 'failed'`, con el
  código y el mensaje de Meta. Cierra la parte de VISIBILIDAD del CRÍTICO 3
  de ronda 5 — la parte de REMEDIACIÓN (avisar al operador o reintentar)
  sigue sin existir, y por eso no lo cuento como cerrado del todo.
- **`sendText` devuelve el wamid** (`client.ts:82-96`) y el aviso de
  privacidad ya no escribe su constancia si el envío falló
  (`processor.ts:170-175`, `liberarEnvioAviso`). Cierra el hallazgo legal de
  ronda 5 sobre la constancia falsa del art. 16.
- **La firma HMAC y el rate limit corren ANTES de leer `messages`**, así que
  `extractStatuses` no es una superficie nueva sin autenticar: comparte la
  misma verificación que `extractMessages` sobre el mismo `raw` body.

## Lo que NO alcancé a revisar

- **La probabilidad real de que el modelo narre el envío en pretérito.** El
  CRÍTICO de `estado_afirmado.ts` está verificado como MECANISMO (la regex
  dispara, `closed` no se toca, el PDF se manda igual) pero no medí con el
  modelo real qué tan seguido Sonnet elige "ya te envié" sobre "en un
  momento te llega". Dado que el prompt no fija el tiempo verbal, y que
  "ya cerré tu viaje" con `closed=false` fue justamente el ejemplo que
  ronda 4 y 5 mostraron que el modelo SÍ produce con naturalidad, considero
  razonable que el pretérito para el envío sea igual de natural — pero es
  una inferencia, no una corrida contra el modelo.
- **Concurrencia real de Postgres** (`try_lock_viaje`, `intake_delta`,
  `guardar_liquidacion_tx`): leídos en SQL, no ejecutados en paralelo.
- **El envío real por Meta y el ciclo completo de `statuses`**: no mandé
  mensajes (prohibido). La lectura de `value.statuses` está verificada por
  código; que Meta realmente entregue un `failed` con la forma que
  `WaEstado` espera lo tomo de la documentación, no de una corrida.
- **`src/lib/agents/run.ts` y `registry.ts`**: no aparecen en el diff desde
  `86e23aa` (confirmado con `git diff --stat`), así que no los revisé de
  nuevo a fondo — la evaluación de ronda 5 sobre `run.ts` (el abort no deja
  tools a medias) sigue siendo mi mejor información.
