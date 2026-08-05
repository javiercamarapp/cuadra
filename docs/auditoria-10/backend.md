# Backend y API — auditoría 10

**Nota: 6/10** (antes 4, auditoría 9). Razón del movimiento: los dos CRÍTICOs
de la ronda 9 están cerrados de verdad — verificados contra el código, no
contra el mensaje de un commit — y el mecanismo nuevo de esta ronda (el claim
atómico de `al_vuelo.ts` contra el doble CFDI) está bien razonado. Pero el
sesgo que este rubro tiene que vigilarse a sí mismo volvió a aparecer: leí
como correcto un camino de dinero (`facturarLoteAlVuelo`, el que de verdad
ejecuta el cron) que tenía CERO pruebas, y hasta que no abrí
`avisar_cierre.ts` no había forma de ver que un cambio de contrato en
`meta/client.ts` había dejado un `catch` muerto que silencia el fallo de un
PDF. Cerré los dos con prueba. Lo que queda abierto: `emitirMensualidad`/
`timbrarFactura` — la lógica
de IVA nueva de esta ronda, en el camino de facturación de Likida a SUS
clientes — sigue sin una sola prueba de integración, y `escalar_viaje.ts`
(feature nueva) no lleva el mismo candado atómico que `al_vuelo.ts` acaba de
ganar contra la misma clase de carrera.

---

## Ronda 9, verificado: los dos CRÍTICO/ALTO están cerrados

No los doy por buenos por el título del commit — los busqué en el código.

- **CRÍTICO — `foto_pendiente` perdía el comprobante en una carrera.** No se
  parchó: se **revirtió la feature completa**. `src/lib/cuadra/processor.ts:703-714`
  trae el comentario de la reversión: dos auditores independientes (agéntico,
  backend) encontraron que `reclamarFotoPendiente` reclamaba CUALQUIER foto
  pendiente del viaje sin verificar que fuera el par correcto, y Javier decidió
  el 1-ago-2026 que el ahorro (~$0.015/ticket) no justificaba el riesgo a 5
  días del demo. Cada foto vuelve a pagar su propia visión. Es la salida más
  segura posible para un CRÍTICO fiscal: no queda superficie de la que
  desconfiar.
- **ALTO — `corregir_fecha` se apoyaba en un trigger que no cubría `fecha`.**
  Cerrado en `supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql`
  (commit `da52502`, ya en el árbol antes de esta ronda): agrega
  `new.fecha is distinct from old.fecha` al `when` de
  `trg_gasto_no_tras_liquidar_update`. El `catch (e) { if (llegoTarde(e)) ... }`
  que `processor.ts:879-887` ya tenía escrito para este caso deja de ser código
  muerto — confirmé que la migración toca la MISMA función y el MISMO trigger
  que documentó el hallazgo, no una copia nueva.

Los otros dos hallazgos de la ronda 9 siguen abiertos, sin cambio, y no los
reproceso completos aquí porque no eran mi asignación de esta ronda — los dejo
anotados para que no se pierdan:

- **ALTO REINCIDENTE** — la rama `accion === 'enriquecer'` de `processor.ts`
  sigue sin una sola prueba que la ejecute vía `processInbound` (confirmé con
  `grep` sobre `*.test.ts`: cero resultados).
- **MEDIO REINCIDENTE** — `pdf_generado: Boolean(pdfOperadorPath)` en
  `src/lib/cuadra/tools.ts:186` sigue mirando solo el ejemplar del operador; el
  propio comentario en la línea 187 todavía dice "AUDITORÍA 8/9, MEDIO
  REINCIDENTE".

---

## Lo nuevo de hoy: `reclamarIntentos`/`reclamarIntento` — el diseño es sólido

`src/lib/cuadra/facturacion/al_vuelo.ts:613-656`. Leí los comentarios largos
del archivo (líneas 349-357, 613-624) y el razonamiento se sostiene: el
candado viejo contra el doble CFDI era un `if (data.cfdi_uuid)` en memoria, y
entre esa lectura y la escritura hay una sesión de portal de 10-60 s. Con
Vercel Cron entregando *at-least-once*, dos corridas solapadas leían las dos
`cfdi_uuid IS NULL`, las dos sellaban, las dos facturaban: dos CFDI del mismo
ticket. El arreglo mueve la decisión a Postgres: un `UPDATE` condicional
(`.is('cfdi_uuid', null).is('autofactura_bloqueada_en', null).or(intentada_en
is null o vencida)`) que solo el primero en llegar puede ganar, porque la
misma columna que filtra es la que el propio `UPDATE` pisa. Fila devuelta =
ganó; cero filas = perdió, y eso NO es un error.

### El hueco de cobertura que pedía verificar esta ronda: sí existía, y era más grande de lo que parecía

La instrucción era verificar que `al_vuelo.test.ts` cubriera "otra corrida ya
ganó el claim, cero filas, sin error". La parte de UN SOLO gasto
(`facturarAlVuelo`) SÍ lo tenía: `al_vuelo.test.ts:621-644`,
*"EL DOBLE CFDI: si otra corrida ganó el claim, no se abre el portal"* — y ese
test corre de verdad (`idsReclamados = []` simula el `UPDATE` devolviendo cero
filas), no es lectura de texto.

Lo que NO tenía ninguna prueba es `facturarLoteAlVuelo`
(`al_vuelo.ts:314-440`) — y ese es el que **de verdad ejecuta el cron**:
`src/app/api/cron/facturar/route.ts` llama `facturarLoteAlVuelo`, no
`facturarAlVuelo`. Confirmé con `grep` que ningún test del archivo lo invocaba
en absoluto, y que `route.test.ts` lo dobla por completo
(`vi.mock('@/lib/cuadra/facturacion/al_vuelo', …)`), así que la lógica real
del claim dentro del lote nunca se había ejercitado en ningún punto del
árbol. Es exactamente el sesgo que este rubro tiene que vigilarse a sí mismo:
"este código se lee correcto" — y de hecho el código SÍ estaba correcto, pero
nada lo probaba, y un cambio futuro que invirtiera el `ganados.has(gastoId)`
habría pasado la suite completa en verde mientras factura dos veces la misma
caseta.

**Arreglado, con commit atómico**, en `src/lib/cuadra/facturacion/al_vuelo.test.ts`:

- `.in()` agregado al doble de lectura (`cadenaLectura`), que no lo tenía —
  por eso nadie había podido llamar `facturarLoteAlVuelo` desde una prueba.
- Dos pruebas nuevas: un lote de dos tickets donde solo uno gana el claim
  (`facturarLoteConAgente` solo ve al ganador; el otro sale con
  `motivo: 'ya_en_proceso'`), y el caso extremo, cero ganadores
  (`facturarLoteConAgente` no se llama ni una vez).
- En el camino encontré un segundo bug de la propia suite: `facturarLoteConAgente`
  nunca se reseteaba en `beforeEach` — nadie lo había necesitado porque nadie
  lo llamaba — así que la primera prueba real que lo usó dejaba su llamada
  registrada para la prueba siguiente. Corregido en el mismo commit.
- 50/50 verdes, suite completa de `facturacion/` (280 tests) verde, `tsc`
  limpio, `eslint` limpio, suite completa del repo verde (223 archivos, 2951
  tests, 1 skip preexistente).

---

## El hallazgo que encontré fuera de la lista: `avisar_cierre.ts` reporta éxito sobre un PDF que nunca llegó

`src/lib/meta/client.ts` (modificado hoy, no soy quien lo tocó) le cambió el
contrato a `sendDocument`: antes tragaba el error y devolvía `void`; ahora
devuelve `{ok:false, error, codigo}` en vez de lanzar. El propio comentario del
cambio es honesto sobre lo que falta: *"los dos call sites viven en archivos
de otros agentes (`processor.ts:1840` y `avisar_cierre.ts:117`)... queda
pendiente que esos dos la usen."*

`processor.ts` está en reconciliación de otro agente — no lo toco, solo lo
dejo dicho aquí. `src/lib/cuadra/avisar_cierre.ts` no estaba tocado por nadie
(`git status` limpio en ese archivo al momento de revisarlo) y no tenía **ni
un solo test** en todo el árbol. Ahí sí hay bug real, no solo hipotético:

```
if (args.urlPdf) {
  try {
    await sendDocument(tel, args.urlPdf, ...);   // YA NO LANZA
  } catch (e) {
    logger.warn('cierre.pdf_al_jefe_falló', ...); // código muerto desde hoy
  }
}
...
return { enviado: true };                          // siempre, pase lo que pase
```

Escenario: Meta rechaza el PDF de una liquidación (rate limit, número
bloqueado, lo que sea) → `sendDocument` devuelve `{ok:false}` → el `catch` no
se dispara porque no hubo excepción → cero logs → `avisarCierreAlJefe`
devuelve `{enviado: true}` → el jefe de flota nunca recibe el documento que
archiva para su contador, y el sistema entero cree que sí salió.

**Arreglado**, con `src/lib/cuadra/avisar_cierre.test.ts` (archivo nuevo, 9
pruebas — no existía ninguno): se revisa `r.ok` explícitamente y se loguea el
fallo con el mensaje real de Meta; el `try/catch` se conserva como red por si
algo de ahí sí llega a lanzar en el futuro. `enviado: true` se mantiene a
propósito cuando falla solo el PDF — es el diseño que el propio archivo ya
declaraba ("perder el adjunto no debe borrar el aviso que sí llegó") — pero
ahora el fallo queda dicho en el log en vez de desaparecer. Confirmé que el
test reproduce el bug: corrido contra el archivo sin el arreglo (`git stash`
del solo archivo de producción), falla exactamente donde se espera.

**Pendiente, fuera de mi alcance esta ronda**: `processor.ts:1840` tiene el
mismo `await sendDocument(...)` sin revisar el resultado, y está bajo
reconciliación de otro agente ahora mismo. Queda para quien lo cierre.

---

## `escalar_viaje.ts` (feature nueva, verde, no lo edité): buen diseño, un hueco de la misma clase que hoy se cerró en `al_vuelo.ts`

`npx vitest run src/lib/cuadra/escalar_viaje.test.ts` → 27/27 verdes. Lo leí
completo tras confirmar que estaba estable.

**Lo que está bien pensado:**

- **Falla hacia adelante, con intención.** `escalado_en` se marca AUNQUE el
  aviso al jefe falle (`escalar_viaje.ts:143-148`), con el mismo argumento que
  ya usa el resto del repo: no marcar convertiría un teléfono mal capturado en
  un reintento infinito, y el registro dejaría de distinguir "no revisado" de
  "revisado y sin a quién avisar".
- **`sendTemplate` en su propio `try/catch` aunque hoy nunca lance**
  (`:199-206`, comentario explícito de por qué: la invariante de arriba
  depende de que ningún `await` desnudo pueda tumbar el lote completo). Es la
  misma disciplina que le faltó a `avisar_cierre.ts` con `sendDocument` — aquí
  SÍ está.
- **El teléfono del jefe se deriva de la MISMA lista de viajes**
  (`:154-158`), no de una segunda consulta — cierra una ventana de carrera
  real entre leer viajes y leer contactos.
- **`armarRecordatorioChofer` reemplaza el reenvío de la plantilla de
  asignación**, que llegaba idéntica a la primera y no distinguía un
  recordatorio de un duplicado del sistema — bug real que el propio archivo
  documenta haber corregido.

**El hueco:** el cron corre cada hora (`vercel.json`, `0 * * * *`) y Vercel
Cron entrega *at-least-once* — la MISMA premisa que hoy justificó el claim
atómico de `al_vuelo.ts`. Pero `escalarViajesSinAceptar` no reclama el viaje
ANTES de procesarlo: `viajesSinAceptar()` selecciona por
`escalado_en is null`, se manda el recordatorio al chofer y el aviso al jefe,
y solo AL FINAL se hace `UPDATE ... SET escalado_en = ...` (`:239-245`). Dos
corridas solapadas sobre el mismo viaje vencido verían las dos
`escalado_en IS NULL`, las dos mandarían los dos WhatsApp (recordatorio al
chofer + aviso al jefe, duplicados), y las dos marcarían al final sin
conflicto. No es fiscal ni irreversible como el CFDI —es un WhatsApp de más,
no un documento ante el SAT—, así que no lo califico CRÍTICO; pero es
exactamente el patrón que el propio autor de `al_vuelo.ts` acaba de escribir
tres párrafos de comentario explicando por qué un sello puesto al final "no es
una carrera". Confirmé que no hay ninguna prueba de dos corridas solapadas en
`escalar_viaje.test.ts` (busqué "otra corrida", "concurren", "solapad" — cero
resultados). No lo arreglé: el archivo está en reconciliación de otro agente
ahora mismo.

---

## El motor de portales (CAPUFE / Playwright): estable, no profundicé más allá del diseño

`npx vitest run src/lib/cuadra/facturacion/adaptadores/` → 138/138 verdes
(incluye `resolucion_chromium.test.ts`, nuevo, 23 pruebas). Por instrucción no
lo edito y otro agente lo está reconciliando; lo que evalué es diseño, no
línea por línea de los ~2,700 líneas de `capufe.ts` + `pagina_playwright.ts`:

- El CAPTCHA se detecta y sale del camino automático hacia una persona
  (`MENSAJE_CAPTCHA`, `SELECTORES_CAPTCHA`) — no se intenta evadir, que es la
  decisión correcta (evadir CAPTCHA es justo el patrón que hace que un portal
  empiece a bloquear la IP, según el propio comentario de la 0065).
- Hay un "pre-vuelo" que reporta TODOS los campos faltantes juntos antes de
  escribir cualquiera (`playwright_base.ts`), en vez de fallar campo por
  campo — evita que un ticket se quede a medio llenar en el portal.
- El presupuesto de tiempo tiene su propia red de seguridad para cuando
  Playwright no devuelve nunca (`playwright_base.test.ts`, "la red de
  seguridad corta aunque Playwright no devuelva nunca") — no hay forma de que
  una sesión colgada se coma el `maxDuration` del cron completo.
- Se conecta al claim de `al_vuelo.ts` ya revisado arriba: el portal solo se
  abre para los tickets que ganaron el claim, así que el trabajo de diseño de
  las dos capas es consistente entre sí.

No encontré TODO/FIXME ni código evidentemente a medias. No es una auditoría
completa de esta pieza — es una lectura de diseño sobre un motor que ya está
verde y estable.

---

## Migraciones nuevas (`supabase/migrations/006*`–`007*`): sensatas, dos notas de higiene

Las siete migraciones nuevas (`0065_cfdi_de_varias_casetas`,
`0066_iva_de_la_mensualidad`, `0070`–`0075`) tienen razonamiento sólido —
`>= 0` vs `> 0` justificado columna por columna, `NOT VALID` validado porque la
base está vacía y es el único momento gratis, índices elegidos por el costo
real (`filas_padre × tamaño_hijo`, no "toda FK sin índice"), `search_path` con
`pg_temp` en las cuatro funciones `SECURITY DEFINER` de RLS. No encontré una
sola que no tuviera sentido.

- **Colisión de numeración (ya resuelta durante esta misma ronda, en vivo).**
  Encontré `0065_cfdi_de_varias_casetas.sql` y `0065_iva_de_la_mensualidad.sql`
  compitiendo por el mismo número — dos migraciones de dos agentes distintos,
  contenido no relacionado, ninguna aplicada todavía. Antes de que terminara
  de escribir este reporte, otro agente ya la renombró a `0066` (lo vi con mis
  propios ojos: un `git stash` intermedio mostró el árbol cambiar bajo mis
  pies). No queda nada que hacer aquí.
- **Sin resolver: los encabezados internos de `0070`–`0072` todavía dicen
  `0065`/`0066`/`0067`.** `0070_montos_no_negativos.sql` abre con
  `-- 0065 — Las dos columnas...`, `0071_indices_de_borrado.sql` con
  `-- 0066 — Borrar una flota...`, `0072_purga_y_consolidado_ia.sql` con
  `-- 0067 — Nada se purgaba...`. Son residuo de una renumeración a medias:
  ahora esos números vuelven a colisionar, esta vez con el contenido real de
  `0065`/`0066` (los que sí quedaron bien nombrados) y con `0067`, que no
  existe. No es un bug de SQL —el archivo corre igual—, es que `grep "0066"`
  trae el archivo equivocado. Cosmético, BAJO, no lo toqué: no es mío y otro
  agente está tocando este mismo directorio en tiempo real.
- **Sin confirmar si ya se aplicaron.** No tengo acceso de base de datos desde
  este rubro. `0072` crea `mantenimiento_de_datos()`, que
  `src/app/api/cron/purgar/route.ts` (nuevo hoy, también sin commitear) ya
  llama por RPC — si la migración no se ha aplicado a Supabase, ese cron
  (agendado diario, `15 4 * * *`) va a fallar en producción hasta que se
  aplique. Igual con `0075` y el `viaje_lock_viaje_id_fkey` que usa
  `escalar_viaje.ts`. Es de las primeras cosas que hay que confirmar antes de
  este deploy.

---

## Billing SaaS (`src/lib/saas/`): el criterio de IVA está bien resuelto, la integración no tiene prueba

`src/lib/saas/iva.ts` (nuevo hoy) es el módulo que decide de qué lado del
precio está el IVA para las mensualidades que Likida le cobra A SUS clientes
— el bug que cierra es real y está bien contado: `emitirMensualidad` guardaba
`monto = precio_mensual` y `timbrarMensualidad` mandaba ese mismo número a
Facturapi con `tax_included: false`, que le suma 16% encima. Plan de $10,000 →
depósito de $10,000 → CFDI de $11,600, irreversible ante el SAT. El arreglo
(`CriterioIva = boolean | null`, `null` = "nadie lo declaró" y ahí se niega a
operar, nunca inventa un lado) tiene 20 pruebas puras en `iva.test.ts` que
cubren el borde del redondeo (`10000/1.16` no cae exacto en centavos) y el
`null`/`undefined` sin excepción.

**Lo que no tiene prueba:** `desglosarPrecio`/`desgloseCuadra` son puras y
están bien probadas, pero las dos funciones que de verdad ESCRIBEN dinero —
`emitirMensualidad` y `timbrarFactura`, las dos en
`src/lib/saas/transferencia.ts`— no tienen NINGÚN test que las invoque.
Confirmé con `grep` en todo `*.test.ts`: cero resultados para
`emitirMensualidad(` o `timbrarFactura(`. Eso significa que ninguno de estos
tres caminos nuevos de esta ronda está probado en integración:

1. `emitirMensualidad` se niega a emitir si `plan.precio_iva_incluido` es
   `null` (vía `desglosarPrecio`).
2. `emitirMensualidad` se niega si `plan.moneda !== 'MXN'` (bug real que
   arregla de paso: una mensualidad en dólares se veía idéntica a una en pesos
   porque `mxn()` imprime todo con signo de peso).
3. `timbrarFactura` se niega a timbrar si la factura no tiene
   `subtotal`/`iva` guardados (facturas de antes de la 0065, o las que
   registra el webhook de Stripe).

Los tres son exactamente la clase de camino que este rubro tiene la
obligación de nombrar explícitamente si tiene prueba o no (ver la ancla del
rubro). No lo arreglé: `transferencia.ts` apareció modificado por otra sesión
durante toda la ronda (`git status` lo mostró `M` de principio a fin) y
construir los dobles de Supabase para las dos funciones —dos tablas, dos
`insert`/`update` distintos, más `facturapiConfigurado`— no es un arreglo
chico ni rápido; es trabajo de una ronda propia. Lo documento como ALTO para
la siguiente.

Nota menor, BAJA: `facturapi.ts` agregó `totalEsperado` — compara el total que
regresa el PAC contra lo que se cobró y deja un `logger.error` el mismo día en
vez de que el contador lo descubra meses después en su conciliación — pero esa
rama tampoco tiene prueba (`facturapi.test.ts` no la ejercita). Solo logging,
no cambia qué se escribe, así que no lo subo de severidad.

---

## Lo que revisé y quedó bien, sin tocar

- `src/lib/cuadra/confirmar_viaje.ts`: el contador de reintentos que dependía
  de un regex sobre el TEXTO del mensaje (que nunca empataba, así que el freno
  `intento >= 2` era inalcanzable) ahora viaja como dato tipado
  (`estado?: EstadoInicio`). Verifiqué que el único llamador
  (`processor.ts:1502`) se actualizó consistente con el cambio. 8/8 verde.
- `src/lib/saas/facturapi.ts`: el parámetro que se llamaba `monto` con un
  JSDoc que decía "Subtotal SIN IVA" —la clase de descuido que produce
  exactamente el bug que `iva.ts` cierra— se renombró a `subtotal`. El nombre
  ahora no se puede confundir con "lo que se cobró".
- Rate limiting (`src/lib/ratelimit.ts`), idempotencia del webhook de WhatsApp
  y de `wa_mensaje_procesado`, y `src/lib/cuadra/conv_lock.ts`: sin cambios
  desde rondas anteriores según `git log`; no reabrí esa frontera esta ronda.

## Lo que no alcancé a revisar

- `src/lib/cuadra/facturacion/enrutar.ts` y `pendientes.ts` (45 y 25 líneas de
  diff hoy respectivamente) — los leí de pasada al seguir el camino de
  `al_vuelo.ts` pero no los audité como unidad propia.
- `src/lib/cuadra/intake/huerfanos.ts` y `src/lib/cuadra/acuse_ticket.ts` —
  modificados hoy, no llegué a ellos.
- Confirmación empírica contra Postgres real de que las migraciones nuevas
  aplican sin romper nada — no tengo acceso de base de datos desde este
  rubro; ver la nota de arriba sobre `0072`/`0075` sin confirmar aplicadas.
