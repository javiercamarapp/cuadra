# Backend y API — auditoría 9

**Nota: 4/10** (antes 7). Razón del movimiento: deuda que cobró factura. Los
dos hallazgos ALTO de la ronda 8 se atacaron de verdad — `ConsultaFallida`/
`OperadorAmbiguo` hoy tienen prueba de integración real que dispara las
excepciones desde `resolveOperador` sin mock, y los duplicados benignos del
brazo de imagen (23505 de hash y de CFDI) también. Pero el mecanismo nuevo de
esta ronda — `foto_pendiente`, que el propio MAPA pidió revisar con cuidado —
tiene un camino de carrera donde un comprobante real se pierde sin que nadie
se entere, y la nueva acción `corregir_fecha` se apoya en un trigger que no
cubre la columna que toca. El rubro no retrocedió por descuido: retrocedió
porque el código nuevo de más riesgo de esta ronda no se armó ni se probó
contra la concurrencia que el propio comentario del archivo describe.

Riesgo mayor hoy: en el protocolo de dos fotos, si la descarga del ticket
reclamado falla justo después de que otro mensaje se lo lleva, ese comprobante
desaparece del sistema para siempre y al operador se le pide, por escrito, la
misma foto que ya mandó.

## Hallazgos

### [CRÍTICO] `foto_pendiente`: si la descarga del ticket reclamado falla, el comprobante se pierde y al operador se le pide la foto que ya mandó
`src/lib/cuadra/processor.ts:459-473`

Escenario: operador manda el ticket completo de diésel, $850.00, código de
barras ilegible en la foto amplia (pasa normal en gasolineras rurales). Entra
como "candidata a TICKET COMPLETO" (`processor.ts:477-497`): `guardarFotoPendiente`
guarda su `media_id` y la invocación espera hasta `HOLD_FOTO_MS` (3s por
default) a que llegue un acercamiento. 1.5s después, el operador manda un
acercamiento al código (código ahora sí legible). Esa segunda invocación entra
al `if (await tieneCodigoLegible(...))` (`:460-473`), llama
`reclamarFotoPendiente(op.tenantId, { viajeId })`, que hace un
`DELETE ... RETURNING` atómico (`repo.ts:404-414`) y **borra la fila** de
`foto_pendiente` devolviendo el `media_id` del ticket original. Acto seguido
intenta `downloadMediaAsDataUrl(pendiente.mediaId)` (`:468`). Si esa descarga
falla — timeout de la Graph API, blip de red en una zona de cobertura pobre a
un lado de la carretera, exactamente el entorno de este producto —
`downloadMediaAsDataUrl` devuelve `null` sin lanzar (`src/lib/meta/client.ts:179-198`),
y el código sigue de largo: `if (dataUrlPendiente) imagenes = [...]` nunca se
ejecuta, `imagenes` se queda como el único `dataUrl` del acercamiento
(`:469`). No hay ningún `else` que distinga este caso; el único log es el
`warn` genérico `wa.downloadMedia` que ya emite `downloadMediaAsDataUrl` por
sí mismo, indistinguible de cualquier otra foto que no descargó.

En paralelo, la PRIMERA invocación (la que esperaba el ticket) hace poll cada
`POLL_FOTO_MS` (400ms) sobre `existeFotoPendiente` (`processor.ts:75-87`); en
su siguiente sondeo ve que la fila ya no existe (la borró la segunda
invocación) y devuelve `laTomoOtro = true` — su propio `if (laTomoOtro) return;`
(`:496`) hace que esa invocación **termine sin haber corrido OCR ni
`addGasto` para el ticket de $850**, confiando en que la otra invocación
procese el par completo. Pero la otra invocación, con la descarga fallida,
solo tiene su propia foto (el acercamiento, solo código). `extraerComprobante`
la procesa sola, `decidirFoto` la clasifica `solo_codigo` sin comprobante que
emparejar (`decidir.ts:74-81`, `yaRegistrados` no trae nada porque el ticket
nunca se registró) → `decision.accion === 'pedir_ticket'`
(`processor.ts:563-614`) → el operador recibe: *"Ya tengo el código de ese
ticket 👍. Mándame también la foto del ticket completo para registrar el
gasto."*

Consecuencia: el ticket de $850 nunca se insertó como `gasto` — ni por la
primera invocación (cedió, confiando en la segunda) ni por la segunda (solo
tenía el código). El operador, que YA mandó el ticket completo, recibe un
mensaje que le dice que lo mande otra vez; si no entiende que debe reenviarlo
o asume que el sistema ya lo tiene, ese gasto real desaparece de la
liquidación sin que el motor, el log o el contralor tengan ninguna señal
distinta de un `warn` genérico de descarga. Es dinero que el operador puso y
no se le repone, y nadie en el sistema se entera de que fue justo el
mecanismo de `foto_pendiente` el que lo perdió.

Causa raíz probable: `reclamarFotoPendiente` borra la fila ANTES de confirmar
que la descarga del contenido reclamado tuvo éxito — el claim y la
recuperación del dato no son atómicos entre sí, a diferencia del resto del
archivo (`intakeDelta` sí es fail-closed ante error: auditoría 7, comentario
en `:374-387`). Aquí, en cambio, el fallo de descarga degrada en silencio a
"procesa lo que tengas" en vez de fallar cerrado.

Sin prueba: `src/lib/cuadra/processor_foto_pendiente.test.ts` tiene el caso
"CON código: si hay un ticket completo esperando, se manda junto" (líneas
143-153) pero `downloadMediaAsDataUrl` está mockeado para tener éxito
SIEMPRE (`:110`, `mockImplementation` incondicional) — ningún test de ese
archivo, ni de ningún otro, hace que la descarga de la foto RECLAMADA
específicamente falle mientras la del acercamiento tiene éxito.

---

### [ALTO] `corregir_fecha`: el trigger de la 0037 no cubre la columna `fecha`, así que el catch que se escribió para ese caso nunca se dispara
`supabase/migrations/0037_gasto_no_tras_liquidar_update.sql:18-27`, `src/lib/cuadra/repo.ts:187-205`, `src/lib/cuadra/processor.ts:621-639`

El `when` del trigger `trg_gasto_no_tras_liquidar_update` (0037) solo mira
`monto`, `sub_total`, `iva_traslado`, `ieps_traslado` y `cfdi_uuid`
(migración, líneas 22-26). `corregirFechaGasto` (nueva esta ronda, `repo.ts:187-205`)
hace `UPDATE gasto SET fecha = ...` — una columna que el trigger NO vigila.
Su propio docstring afirma lo contrario: *"El trigger de la 0037 sigue
mandando: si la liquidación ya se emitió, esto levanta CU001"* — falso: para
un UPDATE que solo toca `fecha`, el trigger ni siquiera se dispara (el `when`
lo filtra antes de llamar a la función). Lo confirma la propia
`supabase/verificaciones.sql:839-845` (bloque 20), que EXISTE justamente para
comprobar que un UPDATE fuera de esas cinco columnas "sigue pasando" tras
liquidar — probado ahí con `clave_prod_serv`, nunca con `fecha`, pero la
garantía aplica igual: cualquier columna fuera de la lista pasa.

Escenario con valores: viaje `v9`, ticket de Costco $620.00, `concepto:
'alimentacion'`, fecha leída por OCR `2026-01-08` (debía ser `2026-08-01`) →
se marca `fecha_sospechosa`, se le pide al operador otra foto
(`processor.ts:707-732`). El gasto YA quedó insertado (correcto: no se
descarta por fecha dudosa). El operador manda más tickets y escribe "listo"
antes de reenviar la foto corregida. `esperarIntake` espera hasta 20s
(`processor.ts:893`, `conv.ts:385`) — pero la visión de una foto tiene HASTA
25s de presupuesto propio (`processor.ts:507`, `reloj.senal(25_000)`), un
número mayor al de la barrera que se supone la espera. Si el reenvío de la
foto corregida llega solapado con el "listo" y su OCR tarda entre 20 y 25s
(vision lenta, imágenes fusionadas del protocolo de dos fotos, lo que sea), la
barrera del "listo" vence primero (`intakeOk = false`), el agente cuadra y
`guardar_liquidacion` cierra el viaje — PDF con el gasto marcado
`fecha_sospechosa` ya emitido, `liquidacion.total_comprobado` congelado.
Milisegundos después, la invocación de la foto (que sigue en vuelo, sostenida
por el `intakeDelta(+1)` que se pidió al principio) termina su OCR, encuentra
el emparejamiento por `emparejarCorreccionDeFecha` (`decidir.ts:58-66`,
candidato único: mismo monto, mismo concepto, fecha ya dudosa) y llama
`corregirFechaGasto('t9', 'g-costco', '2026-08-01')`. El `UPDATE` **tiene
éxito** — el trigger no lo ve — y el operador recibe: *"Ya quedó ✅ — ese
ticket de $620.00 ahora tiene fecha 01/08/2026."*

Consecuencia: `gasto.fecha` en la base ya dice `2026-08-01` para un
comprobante cuyo PDF archivado —el documento que el contralor tiene, ya
entregado— sigue diciendo `2026-01-08` con la nota de "fecha fuera de rango,
verifícala". Cualquier lectura en vivo de ese gasto (reporte fiscal, atribución
de periodo, la propia pantalla del panel si algún día lee `gasto` en vez de
solo `liquidacion`) contradice al documento ya emitido y firmado por el
sistema. Y el `catch (e) { if (llegoTarde(e)) ... }` que el mismo commit
escribió para este caso (`processor.ts:626-635`, con su mensaje "esa foto
llegó después de que cerré tu liquidación") es código muerto: nunca se
ejecuta, porque `corregirFechaGasto` nunca lanza `CU001` para una liquidación
que ya cerró.

Sin prueba: ningún test hace `corregirFechaGasto.mockRejectedValue` con
`code: 'CU001'` (confirmado con `grep` sobre `*.test.ts`), así que la rama
`foto.correccion_llego_tarde` nunca corrió ni en un mock — y tampoco existiría
forma de que corriera contra la migración real, porque el trigger no la
dispara.

---

### [ALTO REINCIDENTE] El brazo de imagen sigue sin integración en sus sub-caminos más nuevos: `pedir_ticket` solo tiene una prueba que lee el texto fuente, y `enriquecer` no tiene ninguna
`src/lib/cuadra/processor.ts:563-614` (pedir_ticket), `:641-666` (enriquecer)

La ronda 8 dejó esto abierto explícitamente ("duplicados, gasto tardío,
protocolo de código pendiente, acuse... sigue corriendo sin integración") y
`a66b828` lo cerró SOLO para los duplicados 23505 y `llegoTarde` — su propio
mensaje de commit lo dice: *"Faltan aún pedir_ticket/enriquecer del protocolo
de código pendiente y el acuse... quedan para la próxima ronda."* Esta ronda
no los atacó. Confirmé con `grep` que ningún test contiene
`accion === 'enriquecer'` ni ejercita esa rama vía `processInbound` — cero
cobertura, ni siquiera de texto fuente. Para `pedir_ticket`,
`src/lib/cuadra/aviso_una_vez.test.ts` es el MISMO patrón que la propia
ronda 8 (rubro pruebas) identificó y corrigió en `gasto_tarde.test.ts` vía
`3971651` — "prueba el TEXTO del cableado, no el cableado": lee
`processor.ts` con `readFileSync`, busca el índice de
`"accion === 'pedir_ticket'"` y hace `expect(rama).toMatch(/pendientes\.length <= 1/)`
contra el string fuente. Un cambio que invierta esa condición
(`>= 1` en vez de `<= 1`, o que borre el `getCodigosPendientes` y deje un
`true` fijo) puede dejar pasar exactamente el bug que ese archivo dice
prevenir —tres avisos idénticos seguidos en el demo— sin que ningún test se
entere, porque el patrón textual seguiría ahí en un comentario o en código
muerto.

Consecuencia: si alguien toca el conteo de `codigosPendientes` o el
emparejamiento por monto de `enriquecerGastoConCodigo` en una refactorización
futura, la suite completa (1330+ pruebas) puede quedar en verde con el folio
de facturación pegándose al gasto equivocado o con el aviso "una vez por
viaje" repitiéndose — ninguno de los dos lo detecta hoy un test que ejecute
`processInbound`.

(REINCIDENTE — parcial, sobre el mismo hallazgo ALTO de la ronda 8.)

---

### [MEDIO REINCIDENTE] `pdf_generado` sigue mirando solo el ejemplar del OPERADOR — sin cambios desde la ronda 8
`src/lib/cuadra/tools.ts:186`

`pdf_generado: Boolean(pdfOperadorPath)` no cambió (confirmé con
`git diff 43ebf41..HEAD -- src/lib/cuadra/tools.ts`: sin diferencias). Si el
upload del PDF del CONTRALOR falla y el del operador tiene éxito, `saveLiquidacion`
persiste `pdf_url = null` para el contralor sin que `pdf_generado` lo refleje;
el operador recibe su PDF sin problema y el contralor —quien decide la
compra— no ve el botón de descarga en el panel, sin aviso ni forma de
regenerarlo. Mismo escenario que documentó la ronda 8; no lo repito completo
aquí. (REINCIDENTE exacto — fuera de mi lista de verificación asignada, pero
sigue siendo un hallazgo de este rubro y no se atacó esta ronda.)

## Lo que revisé y está bien

- `src/lib/cuadra/processor_excepciones_consulta.test.ts` (nueva, cierra
  `d7e9191`): `resolveOperador` lanza `ConsultaFallida`/`OperadorAmbiguo`
  REALES (import de `./conv`, sin doble) y se verifica el mensaje exacto y la
  liberación del claim. Corrí el archivo: 3/3 verdes. El hallazgo ALTO-1 de
  la ronda 8 queda cerrado para el propósito con que se escribió: la
  selección de mensaje del catch general (`ambiguo`/`noSePudoConsultar`) ya
  no depende de lectura, depende de una excepción real disparándose dentro de
  `processInbound`.
- `src/lib/cuadra/foto_llego_tarde.test.ts` (ampliada, `a66b828`): los dos
  duplicados benignos (`uq_gasto_img_hash`, `uq_gasto_cfdi_uuid`) SÍ corren
  hoy contra un `addGasto` que lanza el 23505 real, dentro de `processInbound`
  de verdad. Corrí el archivo: 6/6 verdes.
- `src/lib/cuadra/foto_refoto_fecha.test.ts` (nueva): el camino FELIZ de
  `corregir_fecha` (re-fechar sin duplicar, dedup de la misma foto reenviada,
  fecha fuera de rango que sigue registrando el gasto) SÍ está probado de
  extremo a extremo vía `processInbound`, con `corregirFechaGasto` mockeado
  pero ejercitado con sus argumentos reales. Lo que falta es solo el camino
  de error (arriba).
- `src/lib/cuadra/conv.ts`: las seis funciones que antes llamaban a
  `supabaseAdmin()` en crudo ahora pasan por `acotada()` (tope de consulta) y
  `loadConversation`/`saveConversation` ya no descartan `error` — verificado
  línea por línea contra el diff de `43ebf41..HEAD`. Cierra el hallazgo de
  operabilidad de la ronda 8 desde el lado de backend también.
- `src/lib/cuadra/repo.ts::reclamarFotoPendiente` y `reclamarCodigoPendiente`:
  el patrón `delete().select()` es correctamente atómico a nivel de una sola
  sentencia SQL — confirmé que Postgres garantiza que un `DELETE ... RETURNING`
  concurrente entre dos sesiones solo puede devolver la fila a una — y
  `supabase/verificaciones.sql` bloque 21 lo comprueba contra Postgres real,
  no mockeado.
- `src/lib/cuadra/intake/emparejar.ts::emparejarCorreccionDeFecha`: las
  cuatro condiciones (fecha ya dudosa, mismo concepto, mismo monto, folio
  compatible) y la exigencia de candidato ÚNICO están bien pensadas para el
  riesgo real de este camino (pegarle la fecha al gasto equivocado) — el
  fallo que encontré no está en esta función, está en la capa de la base que
  se supone la protege después.
- `src/app/api/webhook/whatsapp/route.ts`: sin cambios desde la ronda 8
  (confirmado con `git diff`); firma HMAC antes de parsear, cap de body antes
  de leer, rate limit por teléfono no por IP, `after()` con `Promise.all`
  para concurrencia real de un lote — sigue correcto.

## Lo que NO alcancé a revisar

- Verificación empírica de los dos hallazgos nuevos contra Postgres real: el
  MAPA prohíbe editar el repo, así que no pude escribir un test ni correr una
  migración de prueba que confirme con datos reales que el trigger de la 0037
  no dispara para un UPDATE de solo `fecha` — me apoyé en leer el SQL del
  `when` y en el propio bloque 20 de `verificaciones.sql`, que ya prueba
  exactamente esa propiedad (con otra columna) contra el proyecto real.
- El resto del brazo de imagen que la ronda 8 marcó como frontera con otros
  rubros (`tool-executor.ts`, fallback de `openrouter.ts`, `RLS`/`GRANT`s) —
  no reabrí esa frontera.
- `src/proxy.ts`: lo leí completo (gate de passcode del dashboard, cabeceras
  de seguridad) pero es frontera con seguridad/auth, no con concurrencia o
  contratos de API — no encontré nada propio de mi rubro ahí.
- `src/app/api/demo/route.ts` y `src/app/api/export/*`: sin diff desde la
  ronda 8 según `git log`; no los releí a fondo esta ronda porque el tiempo
  se fue en `processor.ts`/`repo.ts`, que es donde vive el 90% del código
  nuevo y donde encontré los dos hallazgos que importan.
- No corrí `npm test` completo esta ronda (solo los archivos relevantes a mis
  hallazgos) para no gastar el tiempo asignado en una corrida de ~1330
  pruebas que otros rubros (pruebas, rendimiento) ya cubren con su propio
  paso.
