# Backend y API — auditoría 8

**Nota: 4/10** (antes 6). Razón del movimiento: **mirada más profunda — el código
no cambió y la nota anterior estaba inflada**. Los tres arreglos de concurrencia
de la ronda 7 (`b187427`, `12bf3a6`, `95bbe01`) más `c07360a` **sí cerraron su
camino**, cada uno con prueba propia que puedo nombrar (abajo), y eso por sí solo
justificaba subir. Lo que baja la nota es otra cosa: la ronda 6 auditó el brazo de
TEXTO y el brazo de IMAGEN de `processInbound` y **nunca abrió el brazo de
DOCUMENTO** (`processor.ts:532-591`, el XML del CFDI). Ahí encontré dos caminos
—ninguno tocado esta ronda, los dos vivos desde antes de la ronda 5— donde **el
mismo dinero se escribe dos veces y nadie se entera**. Ese es literalmente el
ancla de "4 o menos", y no admite matiz por lo bien que esté el resto.

**El riesgo mayor hoy:** el brazo del XML da de alta un gasto nuevo cada vez que
no encuentra a quién pegarlo, sin ninguna evidencia de que ese dinero sea nuevo —
ni contra los tickets del mismo viaje, ni contra el viaje al que de verdad
pertenece— y la liquidación resultante se declara `cuadrada` sin levantar una sola
diferencia.

---

## Hallazgos

### [CRÍTICO] El XML que no encuentra su ticket da de alta un gasto NUEVO: el mismo consumo cuenta dos veces y la liquidación se declara `cuadrada`

`src/lib/cuadra/processor.ts:549-551` (el `null` de `emparejarXmlConTicket`) ·
`:553` (`if (match)`) · `:561-587` (el `else` que crea el gasto) ·
`src/lib/cuadra/intake/emparejar.ts:83-91`.

`emparejarXmlConTicket` está bien escrita y bien probada: ante dos candidatos del
mismo monto y la misma fecha **devuelve `null` a propósito** —"sin candidato
ÚNICO no se toca nada" (`emparejar.ts:72-75`), y `emparejar.test.ts:122` lo fija—.
El problema es lo que el processor hace con ese `null`: lo trata como "este XML
no corresponde a ningún gasto conocido, luego es un gasto nuevo". No es lo mismo.
`null` significa **"no sé cuál"**, y el `else` lo convierte en **"ninguno"**.

Es el mismo modo de falla que este repo lleva cinco rondas cerrando —un fallo de
resolución disfrazado del valor que significa "no hay"— pero al revés: aquí el
disfraz no niega dinero, lo **inventa**.

**Escenario, con valores (corrido, no razonado).** Viaje `v1`, anticipo $2,000.
El operador cruza dos casetas de **$500 el mismo día** —"dos casetas de $300 el
mismo día es corriente", lo dice el propio `emparejar.ts:28`— y fotografía los dos
tickets: `t1` y `t2`, $500 cada uno, `2026-08-03`, sin UUID (un ticket de caseta
no está timbrado). Después llegan los dos XML. Salida real de importar los módulos:

```
match XML A -> null          (candidatos [t1,t2], misma fecha → no desempata)
match XML B -> null          (t1,t2 siguen sin UUID; el gasto de A ya se filtró)
gastos en la base: 4
totalComprobado: 2000        (real: 1000)
diferencia: 0    estatus: cuadrada
diferencias tipo duplicado: 0
diferencias: []
```

Cuatro gastos por dos casetas. `$2,000` comprobados sobre `$1,000` gastados,
diferencia `$0`, estatus **`cuadrada`**, y **cero diferencias levantadas**: el
motor no lo ve porque su llave de duplicado es `cfdiUuid` (los dos XML traen UUID
distintos) o `concepto|folio|monto` (`engine.ts:180-191`), y el gasto que crea el
XML **no lleva folio** (`processor.ts:569-587` no pone `folio`). No hace falta
concurrencia ni ninguna carrera: basta con que dos comprobantes del mismo día
valgan lo mismo. Con un solo XML el sobrecosto es $500; con los dos, $1,000.

**Consecuencia:** la flota reembolsa al operador dinero que no gastó, y la
liquidación que el contralor firma dice `cuadrada` — el único estado que nadie
revisa. En una flota que hace 300 liquidaciones al mes con casetas de monto
redondo, esto no es un caso de laboratorio.

**Causa raíz probable:** el `else` de `:561` da por sentado que "no emparejó"
implica "es nuevo"; la ambigüedad y la ausencia entran al mismo `null`.

**Prueba que lo cubra: NINGUNA.** Verificado con dos búsquedas: `grep -rn "type:
'document'" src --include=*.test.ts` da tres sitios y ninguno ejercita este brazo
con viaje abierto (`route_cableado.test.ts:157` mockea `processInbound` entero;
`processor_cierre.test.ts:203` fija `getOpenViaje → null`, o sea el brazo de
arriba). `grep -rn "emparejarXmlConTicket" src` confirma que su único consumidor
real es `processor.ts:549` y que solo se prueba la función pura, nunca su
consumidor. Todo el brazo `:532-591` corre a ciegas.

---

### [CRÍTICO] El XML se aplica al viaje ABIERTO, no al viaje del gasto: un XML reenviado dos días tarde reembolsa el mismo diésel en la liquidación siguiente

`src/lib/cuadra/processor.ts:253` (`viajeId` = el viaje abierto de HOY) · `:539`
(`getGastos(viajeId, …)`) · `:569` (`addGasto(op.tenantId, viajeId, …)`) ·
`src/lib/cuadra/config.ts:103` (`fechaToleranciaDiasAntes: 30`).

El brazo del XML no coteja **nada** que ate el comprobante al viaje: ni la fecha
del CFDI contra el rango del viaje, ni la existencia del gasto en un viaje
anterior. Lo pega al que esté abierto en ese momento. Y el processor **sabe** que
los XML llegan tarde: el bloque `:256-277` existe justo para eso, con su propio
comentario ("el operador obedecía, el corte lo mandaba de vuelta, y el XML se
descartaba"). Se resolvió el caso "no hay viaje abierto" y **no** el caso "hay
otro viaje abierto", que es el mismo hecho con otra cara.

**Escenario, con valores (corrido).** Viaje `v1` Mérida→CDMX, 28→30-jul. El
operador fotografía su carga de diésel de **$4,812** el 29-jul; `v1` se liquida el
30-jul con `comprobado $4,812`. El 1-ago la flota le abre `v2` (la 0029 impide dos
abiertos, así que este es el orden normal). El 2-ago la gasolinera le manda por
correo el XML de esa carga y el operador lo reenvía por WhatsApp — que es
exactamente lo que el mensaje de cierre le pide hacer.

```
v1 comprobado: 4812  diferencia: 188  con_diferencias
match contra los gastos de v2 -> null        (v2 no tiene ese ticket)
v2 comprobado: 4812  diferencia: 188  con_diferencias
diferencias v2: ["anticipo"]                 (ni una sola sobre el gasto)
```

`fecha_sospechosa` **no salta**: `desde_db.ts:19-20` calcula `fechaMin =
inicio(v2) − 30 días` = 2-jul, y el 29-jul cae holgadamente dentro. Y el detector
de duplicados entre viajes tampoco lo ve — lo corrí:
`detectarDuplicadosEntreViajes([{v1, diesel, 4812, folio 'A-991'}, {v2, diesel,
4812, cfdiUuid 'AAAA'}])` devuelve **`[]`**, porque el gasto de `v1` tiene folio y
no UUID, y el que crea el XML tiene UUID y no folio: las dos llaves de
`duplicados.ts:86-105` fallan por construcción.

**Consecuencia:** el mismo tanque de diésel se le repone al operador dos veces,
$4,812 de más, y el panel de anomalías que existe justo para cazar "el mismo
comprobante en dos viajes" —"el fraude número uno del sector",
`duplicados.ts:1-6`— está ciego a esta variante porque la fabrica el propio
sistema. El SAT además ve dos deducciones distintas amparadas por un solo CFDI.

**Causa raíz probable:** `addGasto` recibe el viaje del contexto de la
conversación, no el que se deduzca del comprobante, y nadie compara `xml.fecha`
contra el rango del viaje destino antes de escribir.

**Prueba que lo cubra: NINGUNA** (mismo brazo sin cobertura que el hallazgo
anterior).

---

### [ALTO] "Recibí tu XML y ya quedó guardado ✅" se afirma sobre una escritura *best-effort* cuyo error nadie mira — y el warn no dice de qué XML habla

`src/lib/cuadra/processor.ts:273-276` · `src/lib/cuadra/repo.ts:75-80`.

`saveCfdiXmlRaw` está documentada como best-effort y **no lanza**: ante cualquier
error deja `logger.warn('cfdi_xml.save', { err: error.message })` y devuelve
`void` (`repo.ts:79`). La línea siguiente del processor (`:275`) le afirma al
operador que el documento **ya quedó guardado**, sin haber mirado nada. Es un
`await` cuyo resultado no existe y una promesa al usuario emitida como si sí.

**Escenario, con valores.** El viaje `v1` cerró y el mensaje de cierre llevaba la
nota de `complemento_no_verificable`: "reenvía el XML (el que te manda la
gasolinera por correo)". El operador obedece con el XML de su carga de **$4,812**.
`saveCfdiXmlRaw` se topa con el tope de consulta (`acotada`, `repo.ts:45-69`, que
resuelve `{data:null, error:'sin respuesta en … ms'}`) o con un 503 de PostgREST.
Sale: `warn cfdi_xml.save {err:"..."}` — **sin tenant, sin UUID, sin gasto** — y
al operador le sale `Recibí tu XML y ya quedó guardado ✅`. Borra el correo. El
contralor entra al panel y no hay nada. El único registro del UUID
`AAAA…`—el que ampara el IVA acreditable y los litros del estímulo del LIF 20-A—
no está en ningún lado y el log no permite saber cuál se perdió.

**Consecuencia:** el operador cree cumplido lo que se le pidió; la flota pierde
el acreditamiento de ese CFDI y la conservación que exige el CFF 30; y quien
mantenga esto no puede reconstruir qué fila falló. Es el patrón que la ronda 5
cerró en `resolveOperador`/`getOpenViaje`, invertido: allá se negaba un hecho
cierto, aquí se afirma uno falso.

**Causa raíz probable:** el contrato de `saveCfdiXmlRaw` (no lanza, no devuelve)
es correcto para el llamador de `:590` —donde el gasto ya está escrito— e
incorrecto para el de `:273`, donde esa escritura **es** todo el efecto del turno.

**Prueba que lo cubra: NINGUNA del camino de fallo.**
`processor_cierre.test.ts:210` y `:215` prueban el camino feliz con
`saveCfdiXmlRaw` mockeada como espía que siempre resuelve; `:225` prueba que si
**Meta** no entrega el media no se afirma nada — o sea, la clase de bug ya se
pensó y se cubrió para la descarga, pero no para la escritura.

---

### [ALTO] `pegarCodigoEnEspera` consume el código pendiente de forma irreversible y su `catch` no registra viaje, gasto ni código

`src/lib/cuadra/processor.ts:94-96` (el `catch`), con el claim en `:75` y la
llamada que puede lanzar en `:79-84`. `repo.ts:337-346` (`reclamarCodigoPendiente`
**borra** la fila) y `repo.ts:285` (`enriquecerGastoConCodigo` **lanza** ante
cualquier error).

La secuencia es: se reclama el código (DELETE … RETURNING — irreversible), y
*después* se intenta pegarlo. Si ese segundo paso **lanza** —el tope de consulta
de `acotada`, un 503, o la 0017 sin aplicar—, el control salta al `catch` de
`:94`, que registra `logger.warn('foto.pendiente_error', { err })` **y nada más**.
El folio ya no está en la bandeja y nunca llegó al gasto.

Lo delator es la comparación con la rama de al lado: `:90` cubre el caso análogo
pero **no lanzante** (`pegado === false`) y ahí sí se registra
`logger.error(..., { viaje, gasto, codigo })`, con el comentario de que "ese folio
es el que la oficina teclea en el portal — por eso es ERROR, no info". La versión
que puede perder exactamente lo mismo es un `warn` anónimo.

**Escenario, con valores.** Viaje `v1`. El operador manda primero el acercamiento
al código de barras de su ticket de $3,500 (queda en `codigo_pendiente` con
`folioPortal: 283665-K050042`) y luego la foto del ticket completo. Entra el gasto,
corre `pegarCodigoEnEspera`, `reclamarCodigoPendiente` **borra la fila**, y
`enriquecer_gasto_codigo` se pasa de `TOPE_CONSULTA_MS`. Sale una línea:
`warn foto.pendiente_error {err:"enriquecerGastoConCodigo: sin respuesta en … ms"}`.
El gasto de $3,500 queda sin `folioPortal`, la bandeja quedó vacía, y el log no
dice ni de qué viaje era.

**Consecuencia:** la oficina no puede timbrar ese ticket —sin folio del portal no
hay CFDI—, el gasto se queda sin factura, y a las 3 de la mañana no hay forma de
saber cuál. El operador no se entera de nada.

**Causa raíz probable:** el claim se toma antes de que exista garantía de poder
consumirlo, y el `catch` general del helper cubre dos fallos con consecuencias
muy distintas con el mismo registro mínimo.

**Prueba que lo cubra: NINGUNA.** `getCodigosPendientes`/`reclamarCodigoPendiente`
se mockean como `vi.fn()` en los cuatro suites de `processor_*`; ninguno hace
lanzar a `enriquecerGastoConCodigo` después de un claim exitoso.

---

### [ALTO] El brazo del XML no traduce un solo error de Postgres: la 0036 (`CU001`) y `uq_gasto_cfdi_uuid` caen al catch general y el operador recibe "se me trabó"

`src/lib/cuadra/processor.ts:569` (el `addGasto` sin `try`), contra
`:455-490` (el mismo `addGasto` en el brazo de foto, con sus tres traducciones).
`grep -n "llegoTarde\|violaIndice" src/lib/cuadra/processor.ts` da **tres usos, los
tres entre `:461` y `:484`** — ninguno en el brazo del documento.

**Escenario, con valores.** El operador escribe *listo* y 3 s después reenvía el
XML (o los dos llegan en el mismo POST, y `route.ts:70-76` los corre en
`Promise.all`). El XML **no toma el mutex del viaje** —solo el brazo de texto lo
hace, `:636`— así que `getOpenViaje` (`:253`) ve `v1` abierto mientras el agente
lo está cerrando. Cuando llega a `:569`, el trigger `trg_gasto_no_tras_liquidar`
de la 0036 lanza `CU001`. Como aquí no hay `llegoTarde(e)`, el error sube al catch
general: se escribe `logger.error('processInbound.fail')` —una caída del sistema,
en un caso que el sistema entiende perfectamente— y el operador recibe
`Perdón, se me trabó tantito. ¿Me reenvías tu último mensaje? 🙏`, en vez del
`Ese comprobante de $4,812.00 llegó después de que cerré tu liquidación` que la
foto sí sabe decir. Idéntico con un `uq_gasto_cfdi_uuid` de dos XML iguales
insertados en paralelo.

**Consecuencia:** en la sala del demo, el paso "reenvía el XML" contesta con un
mensaje de sistema caído por una condición esperada y documentada. Y `pg_errores.ts`
—escrito precisamente para que un 23505 no se confunda con un bug— queda sin
aplicar en la mitad de los sitios donde se inserta dinero.

**Causa raíz probable:** el arreglo de la 0036 se conectó al `addGasto` que la
motivó (el de la foto) y no al otro `addGasto` del mismo archivo.

**REINCIDENTE de clase**: es el modo de falla que la ronda 6 nombró dos veces —"se
construyó el mecanismo y nunca se conectó (del todo)".

`gasto_tarde.test.ts:47-69` **no lo detecta y no puede**: lee `processor.ts` como
texto (`readFileSync` + `sinComentarios`) y afirma que la cadena `llegoTarde(e)`
aparece y que dentro de los 700 caracteres siguientes hay un `sendText`. Nunca
ejecuta `processInbound`. Una prueba que verifica que el código está escrito, no
que el camino funcione — el ancla textual de este rubro, en forma de test.

---

### [MEDIO] La 0036 es `before insert` y `updateGastoCfdiXml` cambia el `monto`: en la ventana del cierre, el gasto y la liquidación emitida dejan de coincidir

`src/lib/cuadra/processor.ts:556-558` · `src/lib/cuadra/repo.ts:211`
(`if (x.total != null && x.total > 0) extra.monto = x.total;`) ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql` (`create trigger … before
insert on gasto`).

La 0036 cierra el camino por el que un gasto **entra** después del cierre. El
brazo del XML tiene un segundo camino que **mueve dinero sin insertar nada**:
cuando el XML empareja con un ticket, `updateGastoCfdiXml` sobreescribe el `monto`
con el total del CFDI, por diseño ("El monto del CFDI gana sobre el que leyó la
visión"). Un `before insert` no ve un `UPDATE`.

**Escenario, con valores.** Ticket de diésel leído por OCR en **$4,812**. El
operador escribe *listo*; el XML entra en paralelo, `getOpenViaje` lo ve abierto,
y mientras el agente cierra, `updateGastoCfdiXml` pone `monto = 5,582.00` (el
total timbrado con IVA). La `liquidacion` ya emitida y su PDF dicen `$4,812`; la
fila `gasto` dice `$5,582`. El contralor abre el detalle y las líneas no suman el
total del papel, con $770 sin explicación en ningún lado.

**Consecuencia:** el mismo síntoma que la 0036 vino a matar —"el texto y el PDF de
la misma respuesta salían de dos fotografías distintas"— por una puerta que el
candado no cubre. Ventana estrecha (2-3 s), pero es la ventana del cierre, que es
la que se abre en cada demo.

**Causa raíz probable:** el candado se puso contra el verbo (`insert`) y no contra
el hecho (cambiar el dinero de un viaje ya liquidado).

**Prueba que lo cubra: NINGUNA** (el brazo del documento con viaje abierto no se
ejecuta en la suite).

---

### [MEDIO] Un `-1` de la barrera que falla sostiene el contador diez minutos y produce el aviso FALSO de "cuadré con los N que alcancé"

`src/lib/cuadra/processor.ts:522-524` · `supabase/migrations/0031_intake_barrera_ttl.sql`.

`intakeDelta` devuelve `number | null` y `null` significa "no se pudo"
(`conv.ts:325-334`). El `+1` de `:335` **sí** mira ese valor desde `12bf3a6` — bien
—; el `-1` del `finally` lo descarta por completo. La 0031 introdujo un TTL, pero
olvida el contador **solo si el sello tiene más de 10 minutos**, y una ráfaga
seguida de *listo* vive dentro de esos 10 minutos.

**Escenario, con valores.** El operador manda 5 fotos; la #5 termina su OCR y su
gasto entra correctamente, pero su `intake_delta(v1,-1)` se topa con un 503
(`warn intake.delta`, sí queda registrado, con viaje — eso está bien). El
contador se queda en 1 con sello fresco. 40 s después el operador escribe *listo*:
`esperarIntake` sondea, ve 1, y **espera los 20 s completos** (un sexto del
presupuesto de la invocación) antes de devolver `false`. El operador recibe
`⚠️ Ojo: cuadré con los 5 comprobantes que alcancé a procesar` sobre una
liquidación que está **completa**, con sus 5 comprobantes.

**Consecuencia:** es exactamente el daño que la propia 0031 describe —"el peor
sitio para un aviso falso, porque es el que enseña a ignorarlos"— reducido de
"para siempre" a "diez minutos". En el demo, un ⚠️ delante del contralor sobre una
liquidación correcta.

**Causa raíz probable:** el `-1` se escribió como "libera el contador pase lo que
pase", pero puede no liberar nada y nadie comprueba si lo hizo.

Cubierto parcialmente por `barrera.test.ts` / `barrera_fail_closed.test.ts`, que
prueban `esperarIntake` con el contador colgado — pero desde el lado de la
barrera, no desde el `-1` que la deja colgada.

---

### [BAJO] `POST /api/demo` acepta cualquier cuerpo: JSON malformado tira un 500 sin log, y `comprobantes` no se valida

`src/app/api/demo/route.ts:32-33`. `await req.json()` sin `try`: un POST público
—sin passcode; el gate de `proxy.ts` excluye `/api`— con `Content-Type:
application/json` y cuerpo `{`  lanza `SyntaxError` y Next devuelve 500 sin que
quede una línea en `logger`. El `as { comprobantes: Partial<Gasto>[] }` es un
casting, no una validación: `{"comprobantes":"x"}` pasa el tipo y revienta en
`.map`. Consecuencia: quien opere esto ve 500s en Vercel sin correlato en el log;
es la ruta que el sitio de demo llama en vivo.

### [BAJO] El CSV de liquidaciones se trunca en silencio a 5,000 filas

`src/app/api/export/liquidaciones/route.ts:27` (`.limit(5000)`), sin `count:
'exact'` y sin aviso al que descarga. Es la misma clase que
`getAcumuladoCombustible` ya cerró explícitamente (`repo.ts:571-593`: "no llevaba
`.limit()`, y eso NO significaba traer todo"). Con una flota real por encima de
5,000 liquidaciones históricas, el contralor concilia contra su ERP con un archivo
recortado y coherente. Hoy, pre-revenue, el techo está lejos: por eso es BAJO y no
más.

---

## Lo que revisé y está bien

Para cada camino de concurrencia digo si hay prueba y la nombro.

- **`b187427` — el mensaje que pierde el mutex avisa y libera su claim. CERRADO.**
  `processor.ts:636-645`: el `else` avisa dentro de su propio `try/catch`
  best-effort (para que un fallo del aviso no impida la liberación) y **después**
  llama a `releaseMessageClaim`. **Prueba: `processor_lock.test.ts:132**` ("con el
  lock OCUPADO, avisa que ya está ocupado (no se calla) y libera el claim"), que
  además no espía el cliente de Meta sino el `fetch` hacia la Graph API — afirma
  que salió un byte, no que se llamó un doble. Con controles a los dos lados:
  `:106` (con el lock tomado sí corre el agente y sí sale mensaje) y `:140` (con
  el lock ocupado sigue sin correr el agente). **No abrió camino nuevo:** el
  `releaseMessageClaim` no puede provocar reproceso porque `route.ts:71` trabaja
  en `after()` tras un 200 y Meta no reintenta; el `finally` de `:938-940` sigue
  soltando el mutex después del `catch`, no antes.
- **`12bf3a6` — el `+1` de la barrera y su `-1` gemelo, simétricos ante el error.
  CERRADO.** `processor.ts:335-351`: `if (incrementado == null)` **sí retorna**, y
  el `return` está **fuera** del `try/finally` de `:352-524`, así que el `-1`
  gemelo no corre — que es justo el punto (decrementar recortaría el crédito de
  otra foto en vuelo; `greatest(0,…)` de la 0031 no distingue de quién es).
  **Prueba: `processor_intake_delta_falla.test.ts:81`** (el `-1` nunca corre),
  **`:95`** (se avisa al operador) y **`:108`** (control: con el `+1` bueno el `-1`
  sí corre). Verifiqué que el control llega de verdad hasta `addGasto`.
- **`c07360a` — el return de la barrera fallida libera su claim. CERRADO.**
  `processor.ts:349`. **Prueba: `processor_intake_delta_falla.test.ts:140`**. El
  archivo declara por escrito por qué no hay control del camino feliz (entraba al
  catch general y habría pasado por la razón equivocada) — eso es más honesto que
  la mayoría de los controles que sí existen.
- **`95bbe01` — `ctxCerro` en el cierre parcial recuperado. CERRADO.**
  `processor.ts:749`, gemela de `:702`. **Prueba: `processor_cierre.test.ts:369`**
  ("el log del catch general dice la verdad: la liquidación SÍ se cerró").
- **El `catch` general y su `finally`** (`:900-940`): recorrí otra vez los tres
  `throw` de `conv.ts` (`:82`, `:94`, `:137`) y sus tres call sites (`:234`,
  `:253`, `:649`); los tres caen en el mismo `catch`, el claim se libera (`:928`),
  el mutex se suelta en el `finally` (`:939`) **después** del catch, y
  `cerroSinEntregar` lleva el estado real. Sigue **sin prueba de ejecución** (el
  ALTO #1 de la ronda 6 no se atacó), pero ninguno de los mocks lo hace fallar, así
  que no lo cuento dos veces: lo dejo dicho aquí.
- **El fail-open de `acquireViajeLock`** (`conv.ts:264-297`): distingue RPC
  ausente (abre con `error`) de transitorio (reintenta con backoff) de persistente
  (abre tras agotar la ventana, con `error`). Con la 0005 sin aplicar, dos *listo*
  simultáneos pasarían los dos y `guardar_liquidacion_tx` (`on conflict (viaje_id)
  do update`) reportaría éxito a los dos — pero es una degradación deliberada,
  documentada, y `instrumentation.ts` grita al arrancar. **Prueba:
  `conv_lock.test.ts`.** No lo cuento como hallazgo.
- **La barrera de ráfaga en sí** (`conv.ts:344-385`): `null` no abre
  (`vacio()` exige `n !== null && n <= 0`), la gracia inicial de 2 s cierra la
  carrera fotos+*listo* del mismo lote. **Pruebas: `barrera.test.ts` (5 casos, con
  el control de gracia OFF) y `barrera_fail_closed.test.ts`.**
- **El claim de tres estados** (`conv.ts:215-225` y `processor.ts:198-211`):
  `indeterminado` se procesa a propósito y queda anotado como tal. **Prueba:
  `processor_cierre.test.ts:256, 263, 270`.**
- **`repo.ts` y el patrón del "sexto lugar".** Las funciones nuevas/tocadas de
  esta ronda no lo reintroducen: `getDatosResponsable` (`:425-452`) **lanza**
  ante error y solo devuelve `null` por dato faltante real; `getAcumuladoCombustible`
  (`:595-652`) falla ruidoso si no leyó todas las páginas. `acotada` sigue
  entrando por el mismo `{data:null,error}` que un error de Postgres, así que
  ninguna función cambia de semántica al agotarse el tope. **Prueba:
  `repo_tope.test.ts`** (servidor TCP real que acepta y calla).
- **`src/app/aviso/[tenant]/page.tsx`** (código nuevo, revisado con la lente del
  MAPA): valida la forma del UUID antes de tocar la base y `getDatosResponsable`
  **lanza** ante error de consulta — así que un fallo de Supabase da error, no un
  `notFound()` que se leería como "esa flota no existe". Limpio.
- **`proxy.ts`**: es el nombre correcto de middleware en Next 16 (verificado:
  `next@16.2.11` instalado), el matcher excluye `/api` a propósito, y el gate del
  dashboard exige sesión viva, no igualdad de cookie.
- **`export/pdf/[id]/route.ts`**: filtro explícito por tenant, 404 indistinguible
  entre "no existe" y "sin PDF", URL firmada de 60 s, y los dos fallos posibles
  con `logger.error` que trae `liquidacion` y `path`. Es el mejor handler del
  repo.
- **El brazo de imagen** (auditoría 6, ALTO #2 — "corre sin una sola prueba de
  integración"): **parcialmente cerrado**. `processor_intake_delta_falla.test.ts`
  sí manda `type: 'image'` a `processInbound` real y llega hasta `addGasto`. Lo que
  sigue sin ejercitarse es el acuse (`:512-516`, el mock de `getGastos` devuelve
  `[]`, así que `length === 1` nunca se evalúa a `true`), el pegado de
  acercamientos y las tres traducciones de error de `:455-490`.
- **El voucher de terminal (`91da5f4`)**: seguí el ciclo completo — `solo_pago` →
  `emparejarPorMonto` → `enriquecer` (silencioso) o `pedir_ticket` → bandeja →
  `pegarCodigoEnEspera` cuando llega el ticket. El voucher entra a la bandeja con
  todos los campos nulos y `enriquecer_gasto_codigo` (0017) toca la fila igual, así
  que devuelve `true` y **no** produce el `foto.pendiente_reclamado_sin_pegar`
  espurio que temí. La ampliación de `EMPAREJAN` en `:384` está atada a
  `decidirFoto` por `decidir_empareja.test.ts`. No encontré doble conteo por aquí.
- **El contrato de la nota no fiscal (`ce867a1`)**: es un archivo de pruebas
  (`voucher.test.ts`, +52 líneas) y no toca ninguna ruta, handler ni escritura.
  Nada que auditar en este rubro.

## Lo que NO alcancé a revisar

- **`tools.ts` / `guardar_liquidacion`** — la escritura de la liquidación en sí
  (idempotencia del `on conflict (viaje_id) do update`, `pdf_generado`, el orden
  de los dos PDF). Frontera con tool-calling; leí `saveLiquidacion` y la 0013 pero
  no tracé la tool.
- **No pude EJECUTAR ninguno de mis dos CRÍTICOS contra `processInbound`.** Corrí
  los módulos puros (`emparejarXmlConTicket`, `cuadrarViaje`,
  `detectarDuplicadosEntreViajes`) y transcribí su salida real, que es lo que
  fija los valores; el paso que une los dos —el `else` de `processor.ts:561`—
  lo verifiqué por lectura, porque escribir el test exigiría un archivo nuevo en
  `src/` y esta auditoría es de solo lectura.
- **`middleware.ts` no existe** en este repo (es `src/proxy.ts`). Lo leí, pero no
  medí si el matcher se comporta igual con las rutas nuevas `/privacidad` y
  `/aviso/[tenant]` en un despliegue real.
- **RLS, `GRANT`s y la 0035 (`search_path` fijo)** — frontera con seguridad y
  modelo de datos; no la abrí.
- **Los timeouts de `meta/client.ts`** (`sendText`/`sendDocument` con `fetch`
  pelado, 300 s de undici contra `maxDuration = 120`). Es real y sigue abierto,
  pero es hallazgo vigente del rubro de **rendimiento** (auditoría 6) y no lo
  duplico.
- **El rate limit del webhook** (`route.ts:59-63`, `MSGS_POR_MIN = 40`, descarte
  silencioso sin `waMessageId` en el log): releí el archivo y **sigue idéntico**
  al MEDIO de las rondas 5 y 6. No lo vuelvo a numerar como hallazgo propio para
  no inflar el conteo, pero que conste que no se atacó.
