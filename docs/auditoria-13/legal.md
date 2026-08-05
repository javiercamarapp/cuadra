# Cumplimiento legal — auditoría 13

**Nota: 7/10** (el reporte de la 12 cerró en 6, la re-auditoría proclamó 8).
Razón del movimiento: **se atacó y subió, pero la re-auditoría de la 12
sobrevendió dos cierres y la mirada más profunda encontró tres cosas nuevas.**
Lo que sube: el ALTO de ARCO de la 12 tiene ahora su mitad de escritura real —
`registrarSolicitudArco` inserta en `solicitud_arco` con tipo clasificado del
texto y `vence_en`, y el canal responde al operador DADO DE BAJA (verifiqué
ambos en el código y los cierres `a25a367`/`036c088`/`1480671` hacen lo que
dicen). Lo que no subió tanto como decía la síntesis: **el registro no lo lee
nadie** — la flota, la obligada a contestar en 20 días (art. 32), sigue sin
poder enterarse, y `admin/compliance` sigue diciendo que el flujo no existe
cuando ya existe. Y aparecen tres hallazgos que la 12 no vio: el `vence_en`
guarda 15 días hábiles etiquetados como "el plazo para responder" cuando el
art. 32 —y el propio aviso, dos pantallas arriba— dicen 20; el camino ARCO
pre-identidad elige un tenant arbitrario si el teléfono existe en dos flotas
(le dice al titular que el responsable es la empresa equivocada); y el segundo
chequeo ARCO del processor es código muerto que el commit creía "red
redundante", así que `operador_id` queda NULL en toda solicitud de WhatsApp.

**Verificado hoy, no asumido:** corrí `vercel env ls production` (5-ago-2026,
25 variables) — no están `FACTURACION_MODO` ni `FACTURAPI_SECRET_KEY`, así que
el ALTO del ToS sigue siendo condicional a configuración, no una violación
activa. Y con curl en vivo: `likida.ai/aviso/<tenant>` y `app.likida.ai/aviso/
<tenant>` sirven ambos el aviso del demo (200, "TRANSPORTES INNOVATIVOS SA DE
CV", art. 29 marcado pendiente), y `/terminos` en producción sigue diciendo "No
timbra facturas" y "Faltan por capturar".

## Hallazgos

### [ALTO, REINCIDENTE ronda 10/12] El ToS sigue diciendo "No timbra facturas" y los dos circuitos que lo desmienten no tienen cláusula de mandato — sin una línea de cambio en 3 rondas

`src/app/terminos/page.tsx:57` · `src/lib/cuadra/facturacion/agente.ts:10-21`
· `src/app/api/cron/facturar/route.ts:257` · `src/lib/saas/facturapi.ts:7-21`
· `src/app/dashboard/suscripcion/page.tsx:326,465-469`

**El texto, idéntico al de la ronda 10** (`terminos/page.tsx:57`):

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa."

**Circuitos, verificados intactos:** `agente.ts:10-21` sigue documentando el
modo `emitir` ("aprieta. Existe porque apretar ese botón CREA UN CFDI REAL ante
el SAT y no se deshace"), `route.ts:257` sigue con
`process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'` y el cron
corre cada hora, y `suscripcion/page.tsx:326` sigue diciendo "Con estos se
emite el CFDI de cada mensualidad" sobre los cinco datos que `flota_fiscal.ts`
relee para el portal del tercero. `grep` de `mandato|apoderad|en nombre de|
autoriza a Likida` sobre `src/app/terminos/ src/app/legal/ src/app/privacidad/
src/lib/cuadra/privacidad.ts` → **vacío** (igual que en la 10 y la 12).

**Escenario, con valores.** Transportes Innovativos contrata, captura su
RFC/régimen/CP en `/dashboard/suscripcion` leyendo "Con estos se emite el CFDI
de cada mensualidad", y firma un contrato que dice "No timbra facturas". Javier
pone `FACTURAPI_SECRET_KEY` o `FACTURACION_MODO=emitir` en producción —dos
variables, cero revisión del contrato— y desde esa hora el párrafo citable es
falso en dos direcciones: Likida timbra la mensualidad vía Facturapi y un cron
escribe el RFC de la flota en `receptor.rfc` de un portal de autofactura y
aprieta "Facturar" sin que ningún papel autorice esa representación.

**Estado: abierto.** Hoy no es violación activa (lo confirmé con la lista de
envs en la mano: 25 variables, sin las dos). Es el hallazgo de configuración
que lleva tres rondas: la verdad del contrato depende de una variable de
entorno y nadie la re-lee cuando cambia. Decisión de Javier (cláusula de
mandato / salvedad en §2), anotada en la síntesis de la 12.

### [ALTO, cierre PARCIAL de la 12] El ARCO ya se registra, pero nadie lo lee: la flota obligada a contestar en 20 días sigue sin poder enterarse, y la página que debería mostrarlo dice que el flujo no existe

`src/lib/cuadra/repo.ts:879` (única referencia de escritura en todo `src/`) ·
`src/app/admin/compliance/page.tsx:19-30` ·
`src/lib/cuadra/privacidad.ts:407,528` · `supabase/migrations/0053_...:202-204`

**La mitad de escritura sí se cerró** (`a25a367`, verificado): `processor.ts`
clasifica el texto, inserta con `tipo`, `canal`, `estado 'recibida'` y
`vence_en`, y las restricciones de la 0053 (`arco_tipo_dominio`,
`arco_estado_dominio`, `arco_cierre_coherente`) se respetan. Eso es real.

**La mitad de lectura no existe.** `grep -rn "solicitud_arco" src/` da solo:
el insert en `repo.ts:879` y comentarios en `privacidad.ts`/`processor.ts`.
**Cero lecturas en toda la app** — ni `/admin`, ni `/dashboard`, ni una server
action. La RLS de la 0053 (`solo_admin_flota`, línea 202-204) ya le permite al
flota_admin leer las suyas, pero ninguna pantalla la llama. Y
`admin/compliance/page.tsx:29` sigue imprimiendo: "Solicitudes ARCO abiertas,
datos por vencer retención, exports pendientes, audit log completo — Likida
**no tiene estos flujos construidos hoy**". Esa frase ahora es **falsa**: el
flujo existe desde ayer; la página es la que no lo muestra. El aviso le dice al
titular "**Queda registrada tu solicitud para la empresa**"
(`privacidad.ts:407,528`) — y la empresa no puede consultarla.

**Escenario, con valores.** El 8-ago OP-101 de Transportes Innovativos escribe
"quiero que borren mis datos" por WhatsApp. Recibe "Queda registrada tu
solicitud para la empresa". La fila existe en `solicitud_arco` con
`vence_en = 2026-08-28` (15 días hábiles desde el 8-ago). El flota_admin entra
al panel a buscarla: no hay ninguna ruta que la lea. La página de Compliance
(la única con el rótulo "ARCO") dice que el flujo no está construido. El 4-sep
—20 días hábiles después, el plazo del art. 32— se vence sin que nadie haya
visto la fila. El
daño original del ALTO de la 12 (la flota no puede cumplir el art. 32 porque no
sabe) persiste entero; lo que cambió es que ahora hay una fila en la base que
lo demuestra.

**Estado: abierto** (mitad cerrada con `a25a367`, mitad de lectura sin
construir — feature de producto, según la síntesis de la 12). No es un falso
positivo de la 12: el fix existe; lo que la re-auditoría no dijo es que no
alcanza para que el responsable se entere.

### [MEDIO, NUEVO] `vence_en` guarda 15 días hábiles como "el plazo para responder" — el art. 32 y el propio aviso dicen 20; la prueba lo consagra

`src/lib/cuadra/privacidad.ts:611-615` · `src/lib/cuadra/privacidad.ts:538` ·
`src/lib/cuadra/privacidad.test.ts:367-373` · `src/lib/cuadra/repo.ts:879`

**La contradicción, en el mismo archivo.** El aviso que la flota le publica al
operador dice la cifra correcta (`privacidad.ts:538`): "la empresa tiene **20
días hábiles** para contestarte y **15 días hábiles** más para hacerlo efectivo
si procede" — que es exactamente el art. 32 LFPDPPP (20 para responder; 15
adicionales, **después de comunicar la respuesta**, para hacerla efectiva).
Tres líneas abajo del mismo archivo (`privacidad.ts:611-615`):
`/** 15 días hábiles (LFPDPPP art. 32): el plazo para responder al titular. */
const DIAS_HABILES_ARCO = 15;` — y `venceArco()` calcula con 15. El mensaje de
`a25a367` repite el error ("la responsable, 15 días hábiles para contestar") y
la prueba `privacidad.test.ts:367-373` lo congela: "venceArco suma 15 DÍAS
HÁBILES (LFPDPPP art. 32)".

**Escenario, con valores.** Solicitud recibida el lunes 10-ago-2026.
`vence_en` = 10-ago + 15 días hábiles = **viernes 28-ago**. El plazo legal de
respuesta vence **viernes 4-sep** (20 días hábiles). La fila dice que la
solicitud "vence" 5 días hábiles antes de lo que la ley —y el aviso que la
flota publica— prometen. Hoy nadie lee `vence_en`, así que el daño es latente;
pero la tabla se construyó (0053) expresamente para que "un plazo que se
calcula al leer se vence sin que nadie lo vea", y el número que guarda es el
equivocado. Ninguna lectura de la ley hace que 15 sea correcto: ni como plazo
de respuesta (20), ni como plazo para hacer efectivo (15 **después** de la
respuesta).

**Estado: abierto.** BAJO si solo se mira el efecto de hoy (nadie lo lee);
MEDIO porque es el registro construido para auditar el plazo legal, se
contradice con el texto que la flota publica, y la prueba lo vuelve
permanente.

### [MEDIO, NUEVO] El camino ARCO pre-identidad elige tenant ARBITRARIO si el teléfono existe en dos flotas — le dice al titular que el responsable es la empresa equivocada

`src/lib/cuadra/processor.ts:371-383` · `src/lib/cuadra/conv.ts:641-648` ·
`src/lib/cuadra/conv.ts:100-118`

**El mecanismo.** El chequeo ARCO global (el fix de la 12 para el dado de baja)
resuelve el tenant así: `buscarTenantPorTelefono(msg.from)` — que en
`conv.ts:641-648` es `.select('tenant_id').in('telefono', variantesTelefono(...))
.limit(1)`, **sin `order` y sin filtro de `activo`**. La función que SÍ detecta
la ambigüedad, `resolveOperador`, usa `.limit(2)` y falla cerrado ante dos
filas (`conv.ts:113-118`) — pero el camino ARCO no pasa por ella: el bloque de
abajo que sí la usa (`processor.ts:462-465`) es inalcanzable (ver siguiente
hallazgo).

**Escenario, con valores.** El 15-ago, OP-102 deja Transportes Innovativos
(tenant A, `operador.activo=false`) y el 1-sep entra a Flota del Bajío
(tenant B, mismo número 52-…-779, `activo=true`). El 5-sep OP-102 escribe
"PRIVACIDAD" — es un derecho legítimo sobre los datos que A y B tratan. El
camino ARCO consulta `operador` por teléfono: **dos filas** (la de A y la de
B), `.limit(1)` sin `order` devuelve cualquiera — digamos A. El operador recibe
"El responsable de tus datos es *Transportes Innovativos*" (la empresa que ya
lo dio de baja, que quizá ya ni tiene sus datos) y la solicitud se registra con
`tenant_id = A`. La flota B —la que hoy trata sus datos y la que legalmente
debe contestar— no ve nada. La respuesta le mintió al titular sobre quién es su
responsable, y el registro quedó en la flota equivocada. La misma ambigüedad
que `resolveOperador` negocia fallando cerrado, el canal ARCO la negocia
eligiendo al azar.

**Estado: abierto.** Probabilidad baja (requiere el mismo teléfono en dos
flotas), pero es exactamente la población que el fix de la 12 quería atender
(el que se va de una flota y se muda a otra), y el modo de falla es el peor
posible para un derecho: afirmar el responsable equivocado.

### [BAJO, NUEVO] El segundo chequeo ARCO es código muerto: el commit lo llama "red redundante" y no puede dispararse nunca; `operador_id` queda NULL en toda solicitud de WhatsApp

`src/lib/cuadra/processor.ts:462-465` vs `src/lib/cuadra/processor.ts:371-383`

Ambos bloques tienen la **misma condición** (`msg.type === 'text' &&
pideAtencionPrivacidad(msg.text)`), y el primero **siempre hace `return`** al
final de su rama (línea 383). El segundo —que sí pasa `op.operadorId` a
`atenderPrivacidad`— es inalcanzable: el commit `036c088` lo dejó escrito como
"El chequeo redundante dentro de `if(op)` queda como red", pero una red que
comparte la condición exacta con la puerta que ya la atendió y retornó no es
una red, es código muerto. Consecuencia medible: **toda** solicitud ARCO de
WhatsApp se inserta con `operador_id = NULL` (el primer camino llama
`atenderPrivacidad(tenantId, null, ...)`), y la columna que la 0053 diseñó con
su comentario ("se guarda aparte del FK porque el titular puede pedir la
SUPRESIÓN de su fila") y el índice de la 0071 (`solicitud_arco_operador_id_idx`)
nunca se pueblan. La flota solo puede identificar al titular por `titular_ref`
(el teléfono). No rompe el derecho; degrada el registro que se construyó para
auditarlo.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 12] `/privacidad` promete borrado de cuenta con confirmación por escrito y retención "un año después de darlo de baja" — sin un solo mecanismo en código

`src/app/privacidad/page.tsx:88,108`

Sin cambios desde la 12: "Tus datos de cuenta, mientras tengas el servicio y
hasta un año después de darlo de baja" y "Se te confirma por escrito cuando
queda hecho". El único borrado del repo sigue siendo `wa_mensaje_procesado` a
los 30 días (`cron/purgar`); `app_user` no se toca. Promesa sin mecanismo;
hoy no hay clientes reales que puedan ejercerla, por eso BAJO.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 12] Los documentos legales no tienen versión congelada ni registro de qué versión aceptó el cliente

`src/app/legal/marco.tsx:88` ("Vigente al {fechaMx(new Date().toISOString())}") ·
`src/app/terminos/page.tsx:47-49` (§1, aceptación por uso, browsewrap)

Sin cambios: la página que el cliente aceptó la semana pasada es formalmente un
documento distinto al de hoy; §1 acepta por uso, sin casilla ni registro. Se
suma a los 🔴 de razón social, domicilio, jurisdicción y precios que el propio
texto declara pendientes.

**Estado: abierto.**

### [BAJO, NUEVO] El aviso del demo publica una razón social y un domicilio que el propio seed marca como "INVENTADOS"

`supabase/seed.sql:24-45` · aviso vivo verificado con curl hoy

El seed inserta `razon_social = 'TRANSPORTES INNOVATIVOS SA DE CV'` y
`domicilio_fiscal = 'Carretera Silao-Romita Km 4.5, Parque Industrial, 36100
Silao, Guanajuato'` y tres renglones arriba el comentario dice: "🔴 INVENTADOS
los dos primeros. La razón social va TAL CUAL esté en el RFC y el domicilio es
el FISCAL… Los dos los tiene que capturar la flota." La base real quedó
sembrada con esos valores (f148966) y la página pública
`likida.ai/aviso/<tenant>` los sirve hoy como el documento legal de la flota.
O los valores ya son los reales (y el comentario quedó viejo), o el demo le
enseña a la flota un aviso que identifica a un responsable inventado — que
legalmente es peor que el que dice "pendiente", porque aparenta cumplimiento.
Es el mismo pendiente de datos que la 12 dejó anotado (datos REALES de
Innovativos), pero tiene una arista legal propia: el documento no debería
citar una razón social que el propio repo declara inventada sin que alguien la
haya confirmado contra el RFC.

**Estado: abierto** (decisión de Javier: confirmar los datos contra la
Constancia o bajar el aviso a "pendiente" en el seed).

## Lo que revisé y está bien

- **Cierres de la 12 verificados en el código, no por el título del commit.**
  `a25a367` — el insert existe, respeta los CHECK de la 0053 y es best-effort
  con rastro ruidoso (`arco.no_registrada`); `036c088` — el canal ARCO corre
  ANTES de la resolución de identidad y `buscarTenantPorTelefono` no filtra
  `activo` (verifiqué `conv.ts:641-648`), así que el dado de baja ya no recibe
  "no te tengo registrado"; `1480671` — "darme de baja" clasifica como
  `cancelacion` (probado: `Denme de baja del sistema` → cancelación).
- **RLS 0078/0079 — lo legal sigue cerrado.** `solicitud_arco` (0053) tiene
  policy propia `solo_admin_flota`: el flota_admin lee/inserta las de su
  tenant, el chofer no ve ninguna; `tenant_self` quedó de solo lectura y
  `app_user`/`bitacora` cerrados por la 0079. La escritura del ARCO va por
  `supabaseAdmin()` (service_role), que bypasea RLS — correcto: no hay sesión
  en el webhook.
- **Aviso integral: los 11 elementos siguen en su lugar** (`privacidad.ts`),
  con el contacto del art. 29 declarado "pendiente" cuando falta, la oposición
  al art. 26 fr. II anunciada en simplificado e integral, y la liga sondada
  antes de prometerse. La página `/aviso/[tenant]` sigue exponiendo solo 4
  columnas de `tenant`, 404 ante id desconocido y `noindex`.
- **Sin aviso no hay tratamiento** (`ponerAvisoADisposicion`): `sin_datos`
  bloquea, `no_entregado` libera el claim para reintentar, `error` no se le
  echa al patrón; la constancia se escribe solo después de `sendText` exitoso.
- **Retención CFF art. 30 intacta.** `cron/purgar` borra solo
  `wa_mensaje_procesado` (30 días, idempotencia sin tenant_id); `llm_costo` se
  consolida, no se purga; el bucket `comprobantes` no se toca. La promesa de 5
  años del aviso no tiene ningún camino de código que la acorte.
- **Sin exposición nueva por los fixes de la 12.** El export paginado
  (`003f22e`) es de los datos de la propia flota; los ids verificados por
  tenant van en la dirección de cerrar fugas entre flotas; el `?tenant=` de
  superadmin distingue "no existe" de "no pude preguntar".
- **Producción verificada hoy** (`vercel env ls production`, 25 variables):
  sin `FACTURACION_MODO` ni `FACTURAPI_SECRET_KEY` — el cron corre en `ensayo`
  (default en `route.ts:257`) y la pantalla de suscripción dice "Sin timbrar".
- **Pruebas del rubro corridas contra HEAD (`caae369`):** `privacidad` (40),
  `privacidad_ronda6` (37), `aviso_integral` (25), `aviso_constancia` (8),
  `repo_datos_responsable` (4), `cierre_aviso` (30), `aviso_blip_de_red` (5),
  `aviso_barrera_cerrado` (3), `startup_aviso` (7), `operacion_aviso` (8),
  `route.test` del cron (20), `foto_no_expuesta` (2) — **189/189 verdes**.

## Lo que NO alcancé a revisar

- **El contrato de encargado del tratamiento** (LFPDPPP, Regl. arts. 54-55):
  sigue sin vivir en el repo; el propio §17 del ToS lo marca 🔴 "pendiente de
  firma". Para la mesa de firma es el documento que faltaría.
- **El anexo de subencargados con OpenRouter** (`docs/conocimiento/52-anexo-
  subencargados.md`): sin tocar esta ronda; el aviso sigue diciendo lo que el
  código hace ("en cada llamada se les pide explícitamente que no retengan"),
  no una garantía contractual.
- **La base real**: no la toqué (regla). Lo que sí pude verificar fue el
  aviso por HTTP en producción (curl a ambos dominios, 200 y con el contenido
  del seed).
- **Verificar contra el SAT** que la razón social y el domicilio del seed
  corresponden al RFC GMX0902279I1 — no tengo acceso al registro; por eso el
  hallazgo BAJO del aviso con datos "inventados" queda como decisión de Javier,
  no como afirmación de que sean falsos.
- **Fuzzing más amplio de `pideAtencionPrivacidad` / `tipoDeSolicitudArco`**
  (nuevas conjugaciones, variantes con emojis): solo corrí los casos ya
  documentados y los de la 12.

## Veredicto

**Sigue sin ser green light para firmar un cliente con el paquete legal
actual** — por los mismos motivos que la 12, ninguno removido: el ToS no tiene
razón social ni jurisdicción, su §2 deja de ser cierto con una variable de
entorno, no hay cláusula de mandato, no hay contrato de encargado, y el canal
ARCO que el aviso promete registra en una tabla que **ninguna pantalla lee** —
la flota obligada a contestar en 20 días sigue sin poder enterarse, que era el
corazón del ALTO de la 12. A eso se suman esta ronda: el `vence_en` que
audita el plazo guarda el número equivocado (15, no 20) y un camino ARCO que
ante un teléfono en dos flotas le dice al titular que su responsable es la
empresa equivocada.

**Para el demo de mañana como demostración, el rubro legal no bloquea el
guion**: el aviso se sirve y se entrega con el seed, el canal ARCO responde y
sí deja registro, la foto del ticket no se expone y los bloqueos son
fail-closed. Lo nuevo que hay que decidir antes de la sala: (1) la página
`admin/compliance` dice "no tiene estos flujos construidos" cuando el registro
ARCO ya existe — es la consola de Javier, no la verá el cliente, pero es una
mentira que quedó impresa; (2) el aviso del demo publica una razón social que
el seed declara inventada y el guion ya advierte del art. 29 pendiente — si
alguien abre la liga, que sea con la frase preparada: el dato lo captura la
flota, no Likida.
