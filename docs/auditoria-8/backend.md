# Backend y API — auditoría 8

**Nota: 7/10** (antes 6). Razón del movimiento: **se atacó y subió**. Los tres
abiertos de la ronda 6 se revisaron primero, contra el código de hoy y no contra
el commit que dice haberlos cerrado:

- El brazo de imagen SÍ ganó una prueba de integración real este período
  (`processor_intake_delta_falla.test.ts`), y el mutex perdido y el
  `ctxCerro` de la ronda 7 están hoy probados de extremo a extremo, con PDF
  generado de verdad y `fetch` espiado en vez de mockeado
  (`processor_lock.test.ts`, `processor_cierre.test.ts`, `tools_cableado.test.ts`,
  `processor_cadena.test.ts`). Eso es trabajo real, no cosmético: antes esos
  archivos mockeaban `tools.ts` entero.
- Pero ninguno de los tres cerró del todo. El catch de `ConsultaFallida`/
  `OperadorAmbiguo` en `processInbound` sigue sin una prueba que lo dispare de
  verdad (aunque las funciones que lanzan esas excepciones sí ganaron prueba
  unitaria directa desde la ronda 7 — ver detalle abajo), el rate limit del
  webhook sigue tirando comprobantes en silencio exactamente como en la ronda
  6, y el grueso del brazo de imagen (duplicados, gasto tardío, protocolo de
  código pendiente, acuse) sigue corriendo sin integración.
- Mirando con la misma sospecha el código nuevo de este período (`tools.ts`,
  `repo.ts`, migración 0036), encontré dos huecos que nadie había reportado:
  el PDF del contralor puede perderse en silencio sin que el sistema se entere,
  y el trigger que impide escribir un gasto tras liquidar solo cubre el INSERT,
  no el UPDATE que trae el XML — el mismo tipo de carrera que ese trigger se
  escribió para cerrar, reabierta por la otra puerta.

No llega a 8 porque siguen existiendo caminos de dinero (el catch general, el
grueso del intake de fotos) que una suite verde no protege.

---

## El riesgo mayor hoy

Ya no es "todo está probado por lectura" — hay pruebas de integración de
verdad donde antes no las había. El riesgo hoy es más angosto pero sigue
siendo real: el único lugar donde `processInbound` decide qué decirle a un
operador cuando la base **no contestó** (vs. "no existe" vs. "ya cerró") nunca
se ha ejecutado en una prueba, y dos escrituras nuevas a `gasto` —el XML que
llega por su cuenta y el PDF del contralor— pueden fallar o divergir sin que
ni el operador, ni el contralor, ni un log que alguien mire se enteren en el
momento.

---

## Hallazgos

### [ALTO] El catch de `ConsultaFallida`/`OperadorAmbiguo` en `processInbound` sigue sin una sola prueba que lo dispare — aunque las funciones que lanzan esas excepciones sí ganaron prueba directa

`src/lib/cuadra/conv.ts:82` (`throw new ConsultaFallida` en `resolveOperador`),
`:94` (`throw new OperadorAmbiguo`), `:137` (`throw new ConsultaFallida` en
`getOpenViaje`). Consumidor único: `src/lib/cuadra/processor.ts:952-989` (el
catch general — selecciona `processInbound.operador_ambiguo` /
`processInbound.consulta_fallida` / `processInbound.fail` en `:965-968`, y el
mensaje que recibe el operador en `:984-988`).

**Lo que sí cambió desde la ronda 6, y hay que reconocerlo**: la ronda 7 (PR-1
del rubro pruebas) agregó `src/lib/cuadra/conv_directo.test.ts`, que prueba
DIRECTAMENTE que `resolveOperador`, `getOpenViaje` e `intakeDelta` lanzan (o
devuelven `null`) exactamente lo que deben ante un fallo de Supabase — con un
stub que replica `.limit(n)` de verdad, cerrando de paso el CRÍTICO PR-1 de esa
ronda. Eso reduce el riesgo real: si alguien rompe `conv.ts` para que un fallo
de red vuelva a leerse como "no existe", 11 pruebas caen en rojo ahí mismo.

**Lo que sigue sin cerrar**: ninguna prueba hace que `resolveOperador` o
`getOpenViaje` LANCEN *dentro de una llamada real a `processInbound`*. Verifiqué
los cuatro suites que sí importan el `processInbound` real
(`processor_cadena.test.ts:115-116`, `processor_lock.test.ts:50-51`,
`processor_cierre.test.ts:70-71`, `processor_intake_delta_falla.test.ts:50-51`):
las cuatro mockean `resolveOperador`/`getOpenViaje` para que SIEMPRE tengan
éxito. Confirmé con `command grep -rn "processInbound.consulta_fallida\|
processInbound.operador_ambiguo" src` que esas dos cadenas de log solo aparecen
en `processor.ts`, nunca en un `*.test.ts`. El único test que SÍ llega al catch
general por integración (`processor_cierre.test.ts:355-377`, la prueba de
`ctxCerro` heredada de AUD-7 ALTO-1) lo hace con un `Error('db down')` genérico,
no con `ConsultaFallida`/`OperadorAmbiguo`, así que ejercita `cerroSinEntregar`
pero NO la selección de mensaje (`ambiguo ? ... : noSePudoConsultar ? ...`) ni
la liberación del claim/mutex específica de esta rama.

**Escenario con valores (el mismo de las rondas 5 y 6, para poder comparar).**
Viaje `v1`, mutex ya tomado en `processor.ts:676`. En la re-verificación de
`:689` Supabase responde `57014 canceling statement due to statement timeout`.
`getOpenViaje` lanza `ConsultaFallida`. El código de hoy hace lo correcto por
lectura: mensaje "No pude consultar tus datos... vuelve a intentarlo en un
minuto", `cerroSinEntregar: false` en el log, se libera el claim y el mutex.
Pero si alguien "simplifica" esa cadena de `if`/`else` en `:984-988` — por
ejemplo, invierte `ambiguo`/`noSePudoConsultar` o borra una rama — los 1296
tests de la línea base siguen en verde.

**Severidad: ALTO**, sin cambio de nivel pero con alcance más angosto que la
ronda 6: el riesgo de que `conv.ts` mismo se rompa está cubierto; lo que sigue
descubierto es la traducción de esa excepción al mensaje del operador.
(REINCIDENTE, parcial — ver razonamiento arriba.)

---

### [ALTO] El brazo de imagen ganó una prueba de integración real, pero cubre solo la simetría del contador — el resto (duplicados, gasto tardío, protocolo de código pendiente, acuse) sigue sin ejecutarse a través de `processInbound`

`src/lib/cuadra/processor.ts:332-566` (todo el bloque `if (msg.type === 'image'
&& msg.mediaId)`). Dentro: `:352-368` (incremento de la barrera, SÍ probado),
`:495-529` (`addGasto` con el manejo de duplicado 23505 y gasto tardío CU001,
SIN prueba de integración), `:422-467` (protocolo de código pendiente
`pedir_ticket`, SIN prueba de integración), `:469-494` (`enriquecer`, SIN
prueba), `:552-561` (acuse "Voy recibiendo tus comprobantes" atado a
`registrados.length === 1`, SIN prueba de integración — solo la prueba
estructural `aviso_una_vez.test.ts`, que hace `grep` sobre el texto fuente, no
ejecuta el código).

**Lo que sí cambió**: `src/lib/cuadra/processor_intake_delta_falla.test.ts` es
nueva esta ronda (cierra AUD-7 ALTO-3) y SÍ llama a `processInbound({ ...,
type: 'image' })` de verdad, con `extraerComprobante` mockeado pero
`decidirFoto`/`addGasto` corriendo sin espiar. Eso es, literalmente, la primera
prueba de integración del brazo de imagen que ha tenido este repo, y cierra la
afirmación textual de la ronda 6 ("corre sin una sola prueba de integración").

**Lo que no cambió**: esa prueba solo ejercita el camino donde `intakeDelta(+1)`
falla y su control feliz (el `-1` gemelo). No toca ninguna de las ramas que
`decidirFoto` puede devolver aparte de `alta` implícito por el mock — no hay
`pedir_ticket`, no hay `enriquecer`, no hay una foto que choque contra
`uq_gasto_img_hash` o `uq_gasto_cfdi_uuid`, no hay una foto que llegue tarde
(CU001). `arnes_ticket_real.test.ts` sigue llamando `extraerComprobante`/
`decidirFoto` DIRECTAMENTE (confirmado línea por línea: `:3-4`, `:348-361`), no
a través de `processInbound`. Y `route_cableado.test.ts` sigue mockeando
`processInbound` entero (`:31-32`), como en la ronda 6.

**Consecuencia con valores.** Si un cambio futuro reordena el `try` de
`:369-561` — por ejemplo, mueve `pegarCodigoEnEspera` antes del `addGasto`, o
cambia el orden de los `if (decision.accion === ...)` — nada en la suite de
1296 pruebas lo detectaría, porque ninguna ejecuta esas ramas a través del
punto de entrada real. Un operador cuyo segundo ticket del día choca contra el
índice único de CFDI (`uq_gasto_cfdi_uuid`) depende de que `violaIndice`/
`llegoTarde` sigan distinguiéndose correctamente DENTRO de ese `try/catch`
específico — probado como función pura en `gasto_tarde.test.ts`, nunca como
comportamiento de `processInbound`.

**Severidad: ALTO**, bajado en riesgo pero no en clase: sigue siendo la zona
con más lógica de dinero que corre mayormente a ciegas del punto de entrada
real. (REINCIDENTE, parcial.)

---

### [MEDIO] El rate limit del webhook sigue tirando comprobantes sin avisar a nadie — sin cambios desde la ronda 6

`src/app/api/webhook/whatsapp/route.ts:10` (`MSGS_POR_MIN = 40`), `:58-63`
(`if (!ok) logger.warn('wa.ratelimit', { from: m.from })`). Confirmé con `git
log --oneline abdc98d..HEAD -- src/lib/ratelimit.ts src/app/api/webhook/
whatsapp/route.ts` que NINGUNO de los dos archivos se tocó en todo el período
que cubre esta auditoría (que incluye las rondas 7 y 8). El hallazgo es
idéntico, línea por línea, al de la ronda 6.

**Escenario con valores (sin cambio).** Un operador manda dos tandas de fotos
multi-seleccionadas (45 imágenes) en menos de un minuto: pierde las últimas 5,
que nunca llegan a `processInbound`. El `warn` no lleva `waMessageId`, así que
ni siquiera desde el log se puede reconstruir cuáles 5 fotos se descartaron. Si
esos 5 tickets suman $4,300, la liquidación carga esa diferencia contra el
operador sin que exista forma de saber por qué.

**Severidad: MEDIO**, sin cambio. (REINCIDENTE, exacto.)

---

### [MEDIO] `pdf_generado` solo mira el ejemplar del OPERADOR — si el del CONTRALOR falla al subir, la liquidación se archiva sin PDF y nadie se entera hasta que alguien lo busca

`src/lib/cuadra/tools.ts:162-186` (`guardar_liquidacion`, handler completo):
`pdfPath` (contralor, `:176`) y `pdfOperadorPath` (operador, `:177`) se suben
con la misma función `subir` (`:168-175`), que ante un fallo de storage hace
`logger.warn('pdf.upload', ...)` y devuelve `undefined` — sin lanzar. La
respuesta de la tool declara `pdf_generado: Boolean(pdfOperadorPath)` (`:186`)
— SOLO del operador. `src/lib/cuadra/repo.ts:385-413` (`saveLiquidacion`)
recibe ese `pdfPath` (contralor) y lo persiste tal cual, incluido `null` si
falló. Consumidores: `src/app/dashboard/[id]/page.tsx:71`
(`{d.pdfPath && (<a>Descargar PDF</a>)}`, sin `else`, sin aviso) y
`src/app/api/export/pdf/[id]/route.ts:55` (404 silencioso — indistinguible de
"nunca se generó" y de "esta liquidación no existe").

**Escenario con valores.** El viaje `v1` cierra. El upload del ejemplar del
CONTRALOR (`t1/v1.pdf`) falla —cuota de storage, colisión transitoria, lo que
sea que ya cubre el test simétrico para el operador—, y el upload del
OPERADOR sí sube. `pdf_generado` sale `true` porque solo mira
`pdfOperadorPath`. `processInbound` (`:914-923`) descarga y manda el PDF del
operador sin ningún problema: el chofer recibe su documento y nunca sabe que
algo falló. `saveLiquidacion('t1', liq, undefined)` guarda `pdf_url = null`.
El contralor —quien decide la compra— abre esa liquidación en el panel y
simplemente NO ve el botón "Descargar PDF", sin mensaje, sin alerta, y sin
ninguna forma de regenerarlo (no existe endpoint de regeneración; confirmé con
`command grep -rn "regenera" src` que no hay ninguno).

**Prueba: el caso simétrico SÍ está probado** (`processor_cadena.test.ts:317-334`,
"la cadena cuando el storage falla" — pero solo con
`storage.rechazaEjemplarDelOperador = true`). No existe el caso inverso
(`rechazaEjemplarDelContralor`) en ningún archivo — confirmé buscando
`up.error` y variantes de "rechaza...Contralor" en `*.test.ts`: cero
coincidencias.

**Consecuencia**: el registro que el propio comentario de `tools.ts:158` llama
"lo que el contralor archiva" puede desaparecer, para siempre, en la
liquidación de un viaje específico, mientras el sistema reporta éxito
completo (WhatsApp entregado, `pdf_generado: true`). Solo se descubre si
alguien va a buscar ese PDF exacto.

**Severidad: MEDIO.** No es dinero mal calculado ni duplicado — es un
documento del camino del dinero que se pierde en silencio y de forma
permanente, sin ningún indicio salvo un `warn` que nadie revisa.

---

### [MEDIO] La migración 0036 solo bloquea el INSERT de gastos tras liquidar; el UPDATE que trae el XML del CFDI puede seguir cambiando el monto de un gasto ya impreso en el PDF

`supabase/migrations/0036_no_gastos_tras_liquidar.sql` (el trigger
`trg_gasto_no_tras_liquidar` es `before insert on gasto`, exclusivamente).
`src/lib/cuadra/repo.ts:198-237` (`updateGastoCfdiXml` — un UPDATE, sin trigger
que lo alcance). `src/lib/cuadra/processor.ts:572-632` (rama DOCUMENTO/XML:
usa el `viajeId` resuelto en `:253` sin volver a llamar `getOpenViaje` antes de
actualizar — a diferencia de la rama TEXTO, que sí re-verifica en `:689`
después de tomar el mutex). `src/lib/cuadra/analytics.ts:71-95`
(`getStatsPorOperador`, que suma `gasto.monto` en vivo para el "diésel total"
del panel, independiente de lo que diga `liquidacion`).

**Por qué aplica el mismo razonamiento que 0036.** El propio comentario de la
migración explica que el bug (PDF y WhatsApp narrando dos cuadres distintos)
existe porque "las fotos entrantes NO toman mutex... y `addGasto`... insertaba
sin mirar nada". Los documentos (XML) tienen exactamente la misma propiedad —
tampoco toman mutex (mismo patrón que las fotos, sin re-verificación de
`getOpenViaje`) — pero su escritura sobre un gasto YA existente es un UPDATE,
y el trigger de la 0036 es `before INSERT`.

**Escenario con valores.** Un ticket de diésel se lee por OCR como $685.00
(dígito borroso) y se inserta como `gasto.monto = 685`. El operador escribe
"listo" casi al mismo tiempo que la oficina reenvía el XML timbrado de ESE
mismo ticket. El "listo" toma el mutex primero: `computeCuadre` lee
`gasto.monto = 685`, genera los dos PDF y `saveLiquidacion` archiva
`totalComprobado` con ese valor. Milisegundos después corre
`updateGastoCfdiXml` para el mismo gasto — el XML es autoritativo, así que
`repo.ts:211` sube `extra.monto = x.total`, digamos $658.00 (el monto real del
CFDI). Nada lo bloquea: no hay trigger de UPDATE, y la rama documento nunca
volvió a preguntar si el viaje seguía abierto.

**Consecuencia**: la fila `gasto` queda en $658, pero el PDF archivado y
`liquidacion.total_comprobado` de ese viaje ya dicen $685 — permanentemente,
porque esos campos son un snapshot congelado. El contralor ve dos cifras
distintas para el mismo comprobante según dónde mire: el PDF del viaje (fijo
en $685) o el KPI "diésel total" del operador en el panel (`analytics.ts:75`,
que sí lee `gasto.monto` en vivo y por lo tanto ya refleja $658). Es la misma
clase de discrepancia que 0036 se escribió para eliminar, reabierta por la
única otra puerta de escritura a `gasto` que existe.

**Prueba: ninguna.** `updateGastoCfdiXml` está mockeado (`vi.fn()`) en los
cuatro suites que corren `processInbound` de verdad; no hay caso que lo
ejecute contra un gasto de un viaje ya liquidado, ni verificación en
`supabase/verificaciones.sql` (revisé el archivo: solo prueba el trigger de
INSERT, bloque cerca de la línea 150-190, nunca un UPDATE).

**Severidad: MEDIO.** Exige una carrera real y específica (XML del mismo
ticket que se está cerrando) para manifestarse, así que no es diario; pero
cuando ocurre es silenciosa, permanente, y visible en dos pantallas distintas
del mismo producto sin que nada lo señale.

---

## Lo que revisé y está bien

- **El mutex perdido (ronda 7, ALTO) tiene hoy integración real y no
  simulada.** `processor_lock.test.ts` reemplazó los mocks de `tools.ts` y
  `@/lib/meta/client` por ejecución real, espiando `fetch` hacia la Graph API
  (`:29-43`) en vez de espiar una llamada interna — así que "no le escribió al
  operador" significa de verdad "no salió un byte hacia Meta". Confirmé
  corriendo el archivo: 4/4 verdes.
- **`ctxCerro` en la recuperación de cierre parcial (ronda 7, ALTO-1
  reincidente) tiene prueba de integración que fuerza el escenario completo**:
  `processor_cierre.test.ts:355-377` hace que `runAgent` lance
  `PartialExecutionError` CON `guardar_liquidacion` ya ejecutado, y que
  `saveConversation` truene DESPUÉS de la recuperación — el único punto donde
  el bug original podía sobrevivir. Confirmado en verde.
- **La simetría +1/-1 de la barrera (ronda 7, ALTO-3) tiene prueba de
  integración dedicada** (`processor_intake_delta_falla.test.ts`), incluida la
  liberación del claim que un commit del mismo día había vuelto a romper
  treinta líneas más abajo del arreglo original — el propio archivo lo
  documenta y lo prueba por separado (`:122-151`).
- **El fix AG-3 (snapshot de `guardar_liquidacion` reusado en vez de
  recalculado) NO se reabre en la recuperación de cierre parcial.** Tracé
  `guardia.ts:38-114` a mano: cuando `cerro` es verdadero (línea 51), la
  guardia SIEMPRE reemplaza `reply` con `resumenCuadre(snapshotCierre ?? ...)`
  en la línea 114 — así que el `reply` que `processor.ts:799` arma llamando a
  `cuadrarDesdeDB` en la rama de recuperación es solo un valor de paso: la
  guardia lo sobrescribe con el snapshot del `guardar_liquidacion` parcial
  (que si se ejecutó, trae `liq` en su `result`) antes de que `say()` lo
  mande. No encontré un camino donde el texto de la recuperación se quede sin
  pasar por la guardia.
- **`llegoTarde`/`violaIndice` (CU001 vs 23505) siguen bien distinguidos y
  probados** (`pg_errores.ts:28-45`, `gasto_tarde.test.ts` completo): un gasto
  tardío nunca se confunde con un duplicado benigno, y el processor SÍ le dice
  al operador qué pasó y qué hacer (verificado contra el texto real de
  `processor.ts:524-528`, no solo contra un comentario).
- **`emparejar.ts`** (protocolo de dos fotos, XML-con-ticket, voucher de
  terminal): las tres funciones de emparejamiento exigen candidato ÚNICO y se
  niegan a adivinar ante ambigüedad — diseño correcto, y el acoplamiento nuevo
  entre `processor.ts` (lista `EMPAREJAN`) y `decidir.ts` está fijado por
  `decidir_empareja.test.ts` con control (separadas: 2 rojas; juntas: verde).
- **`getAcumuladoCombustible` (repo.ts:595-652)**: paginación con `count:
  'exact'`, corte fail-closed si no se alcanza a leer todo el ejercicio. Sin
  cambios desde la ronda 6, sigue correcto.
- **`conv_directo.test.ts` (nuevo, ronda 7 PR-1)**: prueba directa y con stub
  fiel de `.limit(n)` de `resolveOperador`/`getOpenViaje`/`intakeDelta` ante
  éxito, "no hay", y fallo de consulta — las 11 pruebas corren verdes y
  cierran el CRÍTICO PR-1 (el mock anterior ignoraba `.limit(n)`, así que
  cambiar `.limit(2)` a `.limit(1)` era invisible para la suite).
- **`api/export/pdf/[id]/route.ts` y `api/export/liquidaciones/route.ts`**:
  filtro explícito por tenant (sin RLS por no haber sesión), error interno que
  no sale al cliente pero sí queda en el log con el tenant. Sin cambios desde
  la ronda 6, correcto.
- **El acuse de entrega del webhook** (`route.ts:108-120`, `extractStatuses`):
  sin cambios desde la ronda 6, sigue capturando `failed` y registrándolo con
  el `wamid` para poder cruzarlo contra el envío.

## Lo que NO alcancé a revisar

- **Verificación empírica del catch de `ConsultaFallida`/`OperadorAmbiguo`.**
  Igual que en la ronda 6: no pude escribir ni correr un test nuevo (el MAPA
  prohíbe editar el repo), así que el hallazgo ALTO 1 se sostiene por lectura
  exhaustiva del código y por confirmar, con grep, la ausencia de cobertura —
  no por ejecutarlo yo mismo con un mock nuevo.
- **Si `PartialExecutionError.partialToolCalls` preserva `result.liq` byte a
  byte** en un caso real (no simulado por el test de `processor_cierre.test.ts`,
  que mockea el `result` sin `liq`). Confié en el tipo `ToolCallRecord` y en
  que `tools.ts` lo devuelve; no rastreé `openrouter.ts` línea por línea para
  confirmar que nada lo recorta antes de construir la excepción — frontera con
  el rubro 4 (tool calling).
- **`middleware.ts`/`src/proxy.ts`**: sin cambios según `git log`, no lo
  releí a fondo — frontera con seguridad.
- **`api/demo/route.ts`**: no valida que `comprobantes[].monto` sea numérico
  antes de pasarlo al motor. Es un endpoint público sin tenant real y sin
  persistencia (demo determinístico), así que no lo escribí como hallazgo —
  pero no lo profundicé más allá de leerlo.
- **RLS y `GRANT`s de Supabase**: frontera con seguridad y modelo de datos, no
  duplicado aquí.
- **`tool-executor.ts` y el fallback de `openrouter.ts`**: frontera con el
  rubro 4, no revisado en profundidad.
