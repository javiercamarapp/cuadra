# Backend y API — auditoría 6

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió**. El CRÍTICO
de la ronda 5 (`resolveOperador`/`getOpenViaje` confundiendo "no hay" con "no pude
preguntar") y sus 2 ALTOS (barrera de ráfaga abierta en silencio; acuse de foto
mandado diecisiete veces) tienen commits que los cierran —`fa03b00`, `3bc0308`,
`dafd560`— y hoy los verifiqué **por lectura, línea por línea, trazando cada
llamador**, no dando por buena la nota del commit. Los tres están cerrados de
verdad: no encontré un solo camino donde el patrón original sobreviva.

Lo que impide subir más allá de 6 es exactamente el ancla que define ese número:
**correcto por lectura y no por prueba**. Las dos piezas de código que cierran el
CRÍTICO y uno de los ALTOS —el `throw`/`catch` de `ConsultaFallida`/
`OperadorAmbiguo` en `processInbound`, y el brazo de imagen entero que ahora
decide cuándo mandar el acuse— **no corren en ningún test de la suite**. La lógica
en sí no tiene bug que yo haya encontrado; lo que no tiene es una prueba que
avise el día que alguien la rompa sin querer, que es justo el modo en que este
mismo rubro se rompió antes (ronda 4: el arreglo de un crítico de la ronda 3 abrió
uno peor).

---

## El riesgo mayor hoy

No es un bug activo: es que el código más importante de este rubro —el que
decide qué se le dice al operador cuando la base no contesta, y el que decide si
un gasto se registra o no cuando llega una foto— vive fuera del alcance de
`npm test`. Si mañana alguien "simplifica" `processor.ts:565` o cambia el
`getGastos(...).length === 1` de la línea 447 sin darse cuenta de por qué está
así, los 990 tests siguen en verde y el producto vuelve a mentirle al operador o
a saturarlo de mensajes, exactamente como en la ronda 5.

---

## Hallazgos

### [ALTO] El `throw`/`catch` que cierra el CRÍTICO de la ronda 5 no corre en ningún test — ni el camino feliz de la re-verificación, ni el de excepción

`src/lib/cuadra/conv.ts:82` (`throw new ConsultaFallida`), `:94` (`throw new
OperadorAmbiguo`), `:137` (`throw new ConsultaFallida` en `getOpenViaje`).
Consumidores: `src/lib/cuadra/processor.ts:223` (única llamada a
`resolveOperador`), `:242` (primera llamada a `getOpenViaje`) y `:565`
(**re-verificación posterior al mutex** — el punto exacto del escenario A de la
ronda 5). Manejo: `processor.ts:803-843` (el `catch` general, con
`noSePudoConsultar`/`ambiguo` en `:814-815`, los mensajes en `:835-839`, y el
`finally` de `:841-843` que libera `lockedViaje`).

**Recorrí los tres call sites, no solo el que ya conocía.** `resolveOperador`
tiene una sola llamada real en todo el repo (confirmado con `command grep -rn
"resolveOperador" src --include="*.ts"`: solo aparece en `conv.ts` y
`processor.ts`). `getOpenViaje` tiene dos, y las dos están dentro del mismo
`try` que termina en el `catch` de `:803`, así que un `throw` en cualquiera de
las tres cae ahí. Verifiqué a mano el caso más delicado —el de `:565`, con el
mutex ya tomado (`lockedViaje = viajeId` en `:557`)—: la excepción salta al
`catch`, se registra `cerroSinEntregar: false` (porque `ctxCerro` nunca llegó a
asignarse), se libera el claim de idempotencia (`:831`) para que un reenvío
manual sí se reprocese, se le dice al operador la verdad ("No pude consultar tus
datos... vuelve a intentarlo en un minuto"), y **el `finally` SÍ libera el mutex**
(`:842`) porque corre después del `catch`, no antes. No encontré un camino donde
el lock se quede huérfano ni donde se pierda el mensaje al operador.

**Escenario con valores (el mismo de la ronda 5, para poder comparar).** Viaje
`v1`, 17 gastos, $8,940 comprobados, anticipo $6,000. El operador escribe
*listo*, la barrera pasa, el mutex se toma. En la re-verificación de `:565`
Supabase responde `57014 canceling statement due to statement timeout`.
`getOpenViaje` lanza `ConsultaFallida`. Con el código de hoy: el operador recibe
"No pude consultar tus datos en este momento 😕... Vuelve a intentarlo en un
minuto", el mutex se libera, y NO se afirma que el viaje cerró. Es exactamente lo
que se prometió al cerrar el CRÍTICO.

**Prueba que lo cubra: NINGUNA**, y lo verifiqué con dos búsquedas distintas.
`command grep -rn "mockRejectedValue" src --include="*.test.ts"` no trae ningún
caso sobre `resolveOperador`/`getOpenViaje`. `command grep -rln
"processInbound.consulta_fallida\|processInbound.operador_ambiguo\|cerroSinEntregar"
src` solo encuentra las líneas de `processor.ts` que las **producen**, no un test
que las lea. `consulta_fallida.test.ts` (3 casos) prueba únicamente que la clase
`ConsultaFallida` es distinguible de un `Error` normal — nunca importa
`resolveOperador` ni `getOpenViaje`. Y `OperadorAmbiguo` no tiene ni siquiera esa
prueba de clase: `command grep -rl "OperadorAmbiguo" src --include="*.test.ts"`
solo encuentra un comentario en `processor_cadena.test.ts:112` que explica por
qué el mock preserva la clase original (para que `instanceof` no cambie de rama),
no un test que la dispare. Los tres suites que sí ejecutan `processInbound`
(`processor_cadena`, `processor_lock`, `processor_cierre`) mockean
`resolveOperador`/`getOpenViaje` para que SIEMPRE tengan éxito — ninguno los hace
fallar ni con `null` ni con una excepción.

**Severidad: ALTO**, no crítico — no encontré el bug, encontré la ausencia de la
red que lo detectaría si volviera. Es el ancla textual del rubro: "correcto por
lectura y no por prueba".

---

### [ALTO] El brazo de imagen entero de `processInbound` — el que decide si un gasto se escribe, se ignora por duplicado o pega un acercamiento — corre sin una sola prueba de integración

`src/lib/cuadra/processor.ts:304-459`. Dentro de ese brazo vive el arreglo de
esta ronda que cierra el ALTO de la ronda 5 (acuse "voy recibiendo tus
comprobantes" mandado una vez por foto): `:445-449`, que ahora cuenta con
`getGastos(viajeId, op.tenantId)` y solo manda el acuse si `registrados.length
=== 1`. Y en el mismo brazo viven, sin separación de riesgo, `addGasto` con su
manejo de duplicados por índice único (`:404-423`), la bandeja de códigos
pendientes (`:354-377`), y el pegado de acercamientos (`:378-403`).

**El arreglo del acuse, leído con cuidado, es correcto**: cuenta filas reales en
la tabla en vez de un contador en memoria, así que el bug original (el contador
del intake volviendo a 0 entre fotos separadas) no puede reproducirlo. La única
carrera que le queda —dos fotos que insertan casi al mismo tiempo y ninguna ve
`length === 1`— está reconocida y razonada en el comentario de `:439-444`
("perder el acuse es molesto; mandar diecisiete es un producto roto"), así que no
la cuento como hallazgo nuevo: es una decisión, no un descuido.

**Lo que sí es hallazgo: nadie lo ejecuta.** Busqué con dos criterios distintos
si algún test manda un mensaje `type: 'image'` a `processInbound` de verdad.
`command grep -rn "type: 'image'" src --include="*.test.ts"` solo encuentra
`route_cableado.test.ts`, que mockea `processInbound` entero (`vi.mock('@/lib/
cuadra/processor', ...)` — línea 32) para probar que la RUTA entrega el mensaje
correcto, no que el PROCESADOR haga algo con él. `command grep -rln
"processInbound" src --include="*.test.ts"` da ocho archivos; de ellos, los tres
que sí importan el `processInbound` real (`processor_cadena.test.ts`,
`processor_lock.test.ts`, `processor_cierre.test.ts`) solo mandan mensajes
`type: 'text'` o `type: 'document'` (verificado leyendo los tres). Y
`arnes_ticket_real.test.ts` —el arnés que sí corre el pipeline de OCR con una
foto real— llama a `extraerComprobante`/`decidirFoto` directamente: nunca pasa
por `processInbound`.

**Consecuencia con valores.** Nada de lo que este brazo escribe —si un gasto se
crea, si se ignora por ser el mismo ticket reenviado, si un acercamiento se pega
al ticket correcto— tiene una sola prueba que confirme que `processInbound`
ORQUESTA esas piezas correctamente juntas. Un operador manda su primer ticket de
diésel de $3,500 del viaje `v1`: si un cambio futuro reordena el `try/finally` de
`:305-457` o mueve el `intakeDelta(viajeId, 1)` de `:309` después de la descarga
de la imagen, la suite completa (990 pruebas) puede seguir en verde mientras la
barrera de ráfaga deja de contar esa foto y el "listo" que llega justo después
cuadra sin ella.

**Severidad: ALTO.** El código no tiene un bug que yo haya encontrado, pero es la
zona con más lógica de dinero (escribir/no escribir un gasto) que corre
completamente a ciegas de `processInbound` para arriba.

---

### [MEDIO] El rate limit del webhook sigue tirando comprobantes sin avisar a nadie — no tocado esta ronda

`src/app/api/webhook/whatsapp/route.ts:9` (`MSGS_POR_MIN = 40`) y `:58-62`. Este
es el mismo MEDIO de la ronda 5 y **sigue exactamente igual**: lo confirmé
releyendo `route.ts` completo hoy. `ratelimit.ts` sí se tocó esta ronda (mejoró
la poda del `Map` y su comentario deja de prometer un límite global que nunca
tuvo), pero el punto de la ronda 5 no era ESE archivo — era que `route.ts`
descarta en silencio los mensajes que exceden el límite: `if (!ok)
logger.warn('wa.ratelimit', { from: m.from })` no lleva `waMessageId`, y el
mensaje descartado no llega a `processInbound`, así que el operador no recibe
ningún aviso y la ruta igual devuelve `200`.

**Escenario con valores (sin cambio respecto a la ronda 5).** Un operador manda
dos tandas de fotos multi-seleccionadas (45 imágenes) en menos de un minuto:
pierde las últimas 5, que nunca llegan a `gasto`. Si esos 5 tickets suman
$4,300, la liquidación carga esa diferencia contra el operador sin que exista
forma de reconstruir, desde el log, cuáles 5 fotos se perdieron —el `warn` no
trae el `waMessageId`—.

**Prueba que lo cubra: NINGUNA del comportamiento de descarte.**
`route_cableado.test.ts` (nuevo esta ronda) prueba HMAC y el parseo de mensajes
con detalle, pero ningún caso manda 41 mensajes del mismo teléfono para verificar
qué pasa con el 41. `ratelimit.test.ts` prueba `rateLimit` aislada.

**Severidad: MEDIO**, sin cambio. No es un hallazgo de esta ronda tanto como una
confirmación de que sigue abierto — lo anoto para que no se pierda entre los
arreglos de hoy.

---

## Búsqueda explícita del quinto lugar (pedida por el MAPA)

El patrón "un fallo de consulta disfrazado del valor que significa 'no hay'"
apareció cuatro veces en la ronda 5. Revisé a fondo los cuatro archivos que el
MAPA señala como sospechosos — `repo.ts`, `analytics.ts`, `config.ts`,
`costos.ts` — buscando un quinto lugar. **No encontré ninguno**, y lo digo con la
misma seriedad con la que reportaría uno:

- `analytics.ts:25-28` tiene un helper (`exigir`) que TRADUCE cualquier
  `{ data: null, error }` de Supabase a una excepción, en el borde, antes de que
  ningún KPI se calcule — así que un fallo de lectura no puede disfrazarse de "0
  liquidaciones".
- `costos.ts:246-249` tiene un tipo de tres estados (`ResumenCosto`) que hace
  imposible, a nivel de TypeScript, pintar un `$0.00` que nadie midió: fuera de
  `estado: 'medido'` no existe `totalUsd`.
- `config.ts:166-168` sí cae a `DEMO_CONFIG` en cualquier error de `getConfig`,
  pero es una degradación a valores seguros y explícitos ("demo-safe"), no una
  afirmación falsa sobre el mundo — no es la misma clase de bug. Lo dejo
  anotado, no como hallazgo: si algún día hay un tenant real con override propio
  (política, tabulador, estímulos distintos a los de demo) y Supabase falla en
  ese instante, la liquidación se calcularía con la política de DEMO sin que
  nadie se entere. Hoy, pre-revenue y sin overrides de cliente en producción, el
  riesgo es cero.
- `repo.ts`, las 17 funciones acotadas por `TOPE_CONSULTA_MS`, todas lanzan (o
  son best-effort DOCUMENTADO como tal: `saveCfdiXmlRaw`, `gastoExistePorHash`).
  Ninguna nueva convierte "no contestó" en "no hay".

---

## Lo que revisé y está bien

- **`TOPE_CONSULTA_MS` en las 17 llamadas de `repo.ts`.** Conté los `acotada(`
  con `command grep -c` (17, coincide con lo que dice el MAPA) y verifiqué que
  las 17 funciones exportadas del archivo pasan por ahí. `repo_tope.test.ts` lo
  prueba contra un servidor TCP real que acepta y nunca contesta —no un mock—,
  sobre 4 funciones representativas (`getViaje`, `saveLiquidacion` por RPC,
  `getGastos`, `gastoExistePorHash`), confirmando que el tope entra por el MISMO
  camino que un error de Postgres y que cada función conserva su semántica
  (lanza / best-effort) tal como estaba documentado.
- **La paginación de `getAcumuladoCombustible`** (`repo.ts:528-585`): pide
  `count: 'exact'` en la primera página, sigue paginando si `max_rows` de
  PostgREST recorta la respuesta, y falla ruidoso (`throw`) si se agota
  `MAX_PAGINAS` sin leer todo — no devuelve un acumulado parcial disfrazado de
  completo. `repo_acumulado.test.ts` lo cubre.
- **La barrera de ráfaga (ALTO de la ronda 5), cerrada Y bien probada.**
  `barrera_fail_closed.test.ts` inyecta directamente el `null` que `intakeDelta`
  devuelve ante un error de RPC y confirma que `esperarIntake` NO abre la
  barrera con eso — a diferencia del hallazgo de arriba, este SÍ tiene arnés
  dedicado, con 5 casos que incluyen el fallo transitorio que luego se recupera.
- **Los acuses de entrega del webhook** (`route.ts:78-105`,
  `extractStatuses`): `acuses.test.ts` cubre el caso real del 28-jul (un `failed`
  que antes se tiraba) con 5 casos, incluido que un acuse NO se procese como
  mensaje de operador.
- **`OperadorAmbiguo` como diseño**, aunque sin prueba (ver hallazgo de arriba):
  `resolveOperador` pide `.limit(2)` en vez de `.limit(1)` (`conv.ts:73`) y
  registra los tenants implicados antes de negarse a elegir (`:89-93`) — la
  lógica en sí, leída con cuidado, es la correcta: no hay forma de que dos filas
  ambiguas resuelvan en silencio a una.
- **El bloqueo por aviso de privacidad** (`processor.ts:144-183, 285-297`):
  tracé `ponerAvisoADisposicion` completo. `getDatosResponsable` (`repo.ts:415-436`)
  ya exige `razonSocial` y `domicilio` no vacíos antes de devolver algo, así que
  el camino que bloquea el tratamiento (`avisoPuesto === false`) solo se dispara
  cuando de verdad falta el responsable — no encontré un tenant válido que caiga
  ahí por error.
- **`vincularCostosALiquidacion`** (`costos.ts:168-220`): la desambiguación de
  "cero filas actualizadas" (¿no había costos, o ya estaban vinculados?) con una
  segunda consulta solo en esa rama rara es el diseño correcto para no gritar en
  cada recierre.

## Lo que NO alcancé a revisar

- **Verificación empírica (correr código, no solo leerlo) del `catch` de
  `processInbound` ante `ConsultaFallida`/`OperadorAmbiguo`.** El MAPA pide
  "importar el módulo real y transcribir su salida" cuando se pueda; no lo hice
  aquí porque habría requerido interceptar el módulo `@/lib/cuadra/conv` sin
  usar `vi.mock` (no se puede escribir un test nuevo en `src/`) y el tiempo no
  alcanzaba para un loader ESM a mano. Verifiqué por lectura exhaustiva, no por
  ejecución — es la limitación más honesta que puedo declarar sobre el hallazgo
  1.
- **`middleware.ts`/`proxy.ts`** (el BAJO de la ronda 5 sobre el runtime edge→
  node): no cambió esta ronda según el MAPA y no lo releí a fondo; sigue
  presumiblemente igual.
- **`api/demo/route.ts` y `api/export/liquidaciones/route.ts`** más allá de lo
  que ya señaló la ronda 5: no los reabrí.
- **`tool-executor.ts` y el fallback de `openrouter.ts`**: frontera con el rubro
  4, no lo dupliqué.
- **RLS y `GRANT`s de Supabase**: frontera con seguridad y modelo de datos.
