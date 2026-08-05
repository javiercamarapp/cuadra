# Cumplimiento legal — auditoría 12

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura +
mirada más profunda.** Lo que la ronda 10 dejó verificado (foto no expuesta,
oposición al automatizado, aviso integral, POD, PDF sin liga a comprobantes)
sigue verificado — lo volví a abrir y a correr. La 0078 (RLS) cierra de verdad
un hueco de LFPDPPP que estaba abierto desde la 0001: cualquier chofer con la
anon key pública leía el historial de chats de TODA la flota, los teléfonos de
todos sus compañeros y el XML crudo de los CFDI. Eso bajó. Pero el ALTO de la
ronda 10 (ToS dice "no timbra facturas") sigue abierto, sin una sola línea de
cambio, y aparece un ALTO **nuevo**: el producto le promete al operador que su
solicitud ARCO "queda registrada para la empresa", y la única tabla construida
para eso (`solicitud_arco`, mig. 0053) no la escribe **ningún** código del
repo — una solicitud ARCO se hunde en un log de Sentry y la flota, que es la
obligada a contestar en 20 días (art. 32), no tiene cómo enterarse.

**Verificado hoy, no asumido:** `vercel env ls production` (corrido por mí,
5-ago-2026) lista 25 variables; **no** están `FACTURACION_MODO` ni
`FACTURAPI_SECRET_KEY` — o sea que hoy ningún circuito de timbrado está activo
en producción. La distancia entre el ToS y la realidad sigue siendo una
variable de entorno, no una revisión legal.

## Hallazgos

### [ALTO, REINCIDENTE ronda 10] El ToS sigue diciendo "No timbra facturas" y ya son DOS circuitos los que lo desmienten al activarse — sin cláusula de mandato en ningún lado

`src/app/terminos/page.tsx:57` · `src/lib/cuadra/facturacion/agente.ts:10-21`
· `src/app/api/cron/facturar/route.ts:251` · `src/lib/saas/facturapi.ts:7-21`
· `src/app/dashboard/suscripcion/page.tsx:326` ·
`src/lib/cuadra/facturacion/flota_fiscal.ts:14-19` ·
`src/app/dashboard/suscripcion/page.tsx:465-469`

**El texto, sin cambio desde la ronda 10** (`terminos/page.tsx:57`):

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa."

**Circuito 1 — la autofactura de gastos (el hallazgo de la ronda 10, intacto).**
`agente.ts:10-21` sigue documentando el modo `emitir` ("aprieta [el botón].
Existe porque apretar ese botón CREA UN CFDI REAL ante el SAT y no se
deshace"), `route.ts:251` sigue con `const modo = process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'`, y el cron sigue corriendo cada hora.
`suscripcion/page.tsx:326` sigue diciendo "Con estos se emite el CFDI de cada
mensualidad" sobre los cinco datos fiscales que `flota_fiscal.ts:14-19` relee
para llenar el portal del tercero. **No apareció ninguna cláusula de mandato**
(`grep -rn "mandato|apoderad|en nombre de|autoriza a Likida" src/app/terminos/
src/app/legal/ src/app/privacidad/` → vacío, igual que en la ronda 10).

**Circuito 2 — el CFDI de la mensualidad vía Facturapi (matiz nuevo).** No
hacía falta activar la autofactura para que el párrafo fuera potencialmente
falso: `facturapi.ts:7-21` timbra el CFDI 4.0 de la suscripción de la flota
con `FORMA_PAGO_TRANSFERENCIA = '03'` y `CLAVE_UNIDAD_SERVICIO = 'E48'` —
"no se puede timbrar por cuenta propia — pasa OBLIGATORIAMENTE por un PAC".
"Likida no es un PAC" (§16) sigue siendo cierto; "no timbra facturas" es
falso en cuanto `FACTURAPI_SECRET_KEY` exista, y el propio
`suscripcion/page.tsx:465-469` hoy lo admite ("El CFDI de estas facturas no se
timbra todavía… Si necesitas CFDI de tu mensualidad, pídeselo a Likida") —
el texto legal no tiene esa salvedad.

**Escenario, con valores.** Transportes Innovativos contrata el plan, captura
su RFC/razón social/régimen/CP/uso en `/dashboard/suscripcion` leyendo "Con
estos se emite el CFDI de cada mensualidad", y firma el ToS que dice "No
timbra facturas". Javier pone `FACTURAPI_SECRET_KEY` en producción (o
`FACTURACION_MODO=emitir`) — dos variables de entorno, cero cambios de
código, cero revisión del contrato — y desde esa hora el párrafo citable del
contrato es falso en dos direcciones: Likida timbra el CFDI de la mensualidad
y, en el otro circuito, un cron escribe el RFC de la flota en
`receptor.rfc` de un portal de autofactura y aprieta "Facturar" sin que
ningún papel autorice esa representación.

**Estado: abierto.** Verifiqué `vercel env ls production` — no hay violación
activa hoy, y eso lo digo con la lista en la mano. Pero el hallazgo no es de
hoy, es de configuración: no hay cláusula de mandato, no hay salvedad en §2, y
la decisión de cuándo el contrato deja de ser cierto no pasa por ninguna
revisión legal.

### [ALTO] "Queda registrada tu solicitud" — el ARCO prometido en el aviso no se registra en ningún lado; `solicitud_arco` existe y nadie la escribe

`src/lib/cuadra/processor.ts:144-151` · `src/lib/cuadra/privacidad.ts:407,528`
· `supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:98-115` ·
`src/app/admin/compliance/page.tsx:19-30`

**Lo que el aviso promete, en tres lugares:**
- Simplificado (`privacidad.ts:227`): "escribe *PRIVACIDAD* por este chat y te
  pasamos con la empresa".
- Respuesta al ejercicio (`privacidad.ts:407`): "**Queda registrada tu
  solicitud para la empresa.** Tu liquidación sigue igual, esto no la afecta."
- Integral, sección "Cómo limitar" (`privacidad.ts:528`): "Tu solicitud queda
  registrada para la empresa y tu liquidación sigue igual."

**Lo que el código hace** (`processor.ts:144-151`, `atenderPrivacidad`):
manda el texto y hace `logger.info('privacidad.solicitud_operador',
{ tenantId, operadorId })`. Eso es todo. La única "constancia" es una línea
de Sentry. Verifiqué con `grep -rn "solicitud_arco" src/` → **cero
referencias en todo `src/`**. La tabla que la migración 0053 construyó
expresamente para esto —con `tipo`, `estado`, `vence_en date not null` y el
comentario "un plazo que se calcula al leer se vence sin que nadie lo vea
(LFPDPPP art. 32)"— no la inserta nadie, `vence_en` no se calcula nunca, y
`admin/compliance/page.tsx:19-30` lo confiesa: "Likida no tiene estos flujos
construidos hoy."

**Escenario, con valores.** El 8-ago, el operador OP-101 de Transportes
Innovativos escribe "quiero que borren mis datos" por WhatsApp (frase que
`pideAtencionPrivacidad` reconoce, `privacidad.ts:349-363`). Recibe la
respuesta "Queda registrada tu solicitud para la empresa". La flota —la
responsable legal, la que tiene 20 días hábiles para contestar— no ve nada:
ni el panel (`admin/compliance` está vacío), ni un correo, ni una fila en
`solicitud_arco`. El 7-sep la solicitud se vence sin que nadie la haya
visto. El aviso que la propia flota publica (vía Likida) afirmó que quedó
registrada; el registro no existe.

**Causa raíz.** La migración 0053 creó el esquema antes que el flujo, y el
flujo nunca se construyó; mientras tanto el texto del aviso se escribió
describiendo el comportamiento que el esquema anticipaba, no el que el código
produce. Es la misma clase de distancia texto-código que el ALTO del ToS, en
el documento que el operador sí lee.

### [MEDIO] El canal ARCO es inalcanzable para quien más lo necesita: un operador dado de baja escribe PRIVACIDAD y le contestan "no te tengo registrado como operador"

`src/lib/cuadra/processor.ts:350-426` · `src/lib/cuadra/conv.ts:100-114` ·
`src/lib/cuadra/processor.ts:414`

**El flujo.** `processor.ts:350`: `resolveOperador(msg.from)`; si no hay
operador, se prueba cuenta de oficina y, si tampoco, `processor.ts:414`:
"no te tengo registrado como operador. Pídele a tu flota que te dé de alta."
El chequeo ARCO (`processor.ts:425-427`) vive **dentro** de la rama `if (op)`.
Y `resolveOperador` filtra `.eq('activo', true)` (`conv.ts:105`).

**Escenario, con valores.** Transportes Innovativos da de baja a OP-102
(`operador.activo = false`, el único mecanismo que el panel ofrece — el
dashboard inactiva, no borra). OP-102 dejó la empresa y quiere ejercer
**cancelación**: escribe "PRIVACIDAD". `resolveOperador` devuelve `null`
(activo=false), no es cuenta de oficina, y recibe "no te tengo registrado
como operador. Pídele a tu flota que te dé de alta." El aviso que leyó
mientras trabajaba ahí le prometió que escribiendo PRIVACIDAD "te pasamos con
la empresa" — la población más probable de ejercer cancelación/oposición es
exactamente la que el canal rechaza. Una cuenta de oficina tampoco pasa: el
flota_admin que escribe PRIVACIDAD recibe el mensaje de oficina
(`processor.ts:405-412`), no el medio ARCO.

**Estado: abierto.** No es un diseño deliberado (la migración 0053 prevé
explícitamente el ARCO del titular "después de que se borre su fila en
`operador`"); es que el chequeo de privacidad quedó después del de identidad.

### [MEDIO] La flota no tiene ninguna pantalla para publicar su aviso: razón social, domicilio y contacto del art. 29 solo viven en el seed o en la base, a mano

`src/lib/cuadra/administracion.ts:101-102` ·
`supabase/seed.sql:24,60-61` · `src/lib/cuadra/startup.ts:248-260` ·
`src/lib/cuadra/processor.ts:600-622` · `GUION_DEMO.md:171-173`

**La evidencia de que no hay camino de producto.** `crearFlota`
(`administracion.ts:101-102`) inserta en `tenant` solo
`{ nombre, rfc, ciudad }`. Un `grep` de `domicilio_fiscal`,
`url_aviso_privacidad` y `contacto_privacidad` sobre `src/app/admin` y
`src/app/dashboard` no encuentra **ninguna** escritura. Los únicos que
escriben esos campos son `seed.sql` (el tenant del demo) y la instrucción de
`startup.ts:248`: "Captura `razon_social` y `domicilio_fiscal` en la tabla
`tenant`" — o sea, a mano en la base. `contacto_privacidad` (art. 29) no lo
escribe **nadie**, ni el seed.

**Escenario, con valores.** Mañana en la demo, el operador manda su primer
comprobante y `ponerAvisoADisposicion` funciona porque el seed puso los datos
de Transportes Innovativos. El lunes, Javier crea una segunda flota desde
`/admin/flotas` (es el flujo de alta que existe): el primer mensaje de su
primer operador cae en `processor.ts:613-615` — "No puedo procesar tus
comprobantes todavía: tu empresa aún no ha terminado de configurar su aviso de
privacidad" — y **no hay ninguna pantalla que le permita a esa empresa
configurarlo**. El fallo es fail-closed (legalmente correcto), pero el
mecanismo que el producto le da a la flota para cumplir el art. 16 fr. II no
existe fuera del demo.

**Estado: abierto.** Matiz: la dirección del fallo es la segura; esto es
operabilidad del cumplimiento, no una violación activa.

### [BAJO] `/privacidad` promete borrado de cuenta con confirmación por escrito y retención "un año después de darlo de baja" — sin un solo mecanismo en código

`src/app/privacidad/page.tsx:88` · `src/app/privacidad/page.tsx:101-108`

**El texto.** "Se borran tus datos de cuenta y de acceso… Se te confirma por
escrito cuando queda hecho" (sección "Cómo pedir que se borre tu cuenta", que
además es requisito de revisión de Meta) y "Tus datos de cuenta, mientras
tengas el servicio y hasta un año después de darlo de baja" (sección de
conservación).

**La realidad.** No existe ningún flujo de baja de cuenta, ni de borrado, ni
de confirmación: el único borrado del repo es `wa_mensaje_procesado` a los 30
días (`src/app/api/cron/purgar/route.ts`), que no toca `app_user`. El camino
es un correo a `likida.ai@gmail.com` y la acción manual de Javier. No es una
contradicción activa —es una promesa sin mecanismo, exactamente la clase de
brecha que el ALTO de ARCO demuestra que cobra factura cuando alguien la
ejerce.

**Estado: abierto**, severidad BAJO porque hoy no hay clientes reales que
puedan ejercerla.

### [BAJO] Los documentos legales no tienen versión congelada ni registro de qué versión aceptó el cliente

`src/app/legal/marco.tsx:76-81` ("Vigente al {hoy}") ·
`src/app/terminos/page.tsx:47-49` (§1, aceptación por uso)

"Vigente al" se calcula con `fechaMx(new Date().toISOString())` en cada
render: la página que el cliente aceptó la semana pasada es, formalmente, un
documento distinto al de hoy. §1 define la aceptación por uso (browsewrap),
sin casilla ni registro de aceptación. Es consistente con lo redactado, pero
débil para un contrato B2B — y se suma al resto de datos 🔴 (razón social,
domicilio, jurisdicción, precios) que el propio texto declara que faltan.

**Estado: abierto.**

---

## Lo que revisé y está bien

- **Migración 0078 (RLS) — la revisé línea por línea como pidió el prompt, y
  es correcta.** El patrón `(tenant_id = any(get_user_tenant_ids()) and not
  is_operador()) or is_superadmin()` para `terminal`, `operador`,
  `politica_gasto`, `wa_conversacion`, `llm_costo`, `cfdi_xml`,
  `cfdi_consolidado_linea` es el mismo que ya usaban la 0047/0050/0051, y
  `tenant_self` pasa de `for all` a `for select` (las escrituras de `tenant`
  van por `supabaseAdmin()`, service_role, que bypasea RLS). Verifiqué que no
  queda ninguna otra `tenant_data` vulnerable: las de viaje/gasto/liquidacion
  (0045), unidad/mantenimiento/incidencia/pod (0047), posicion/geocerca
  (0050), ticket_soporte/ticket_mensaje (0051) y campania/envio_mensaje
  (0053) ya tenían `not is_operador()`; rastreo_credencial e invitacion usan
  `administra_flota()`; bitacora y solicitud_arco tienen policies propias. El
  bloque 54 de `supabase/verificaciones.sql:2970-3035` lo comprueba con una
  corrida real (impersona a un chofer y espera 0 filas visibles en las 7
  tablas, 0 filas afectadas al intentar editar `tenant`, y que el flota_admin
  siga viendo las suyas). El chofer web no se rompe: lee viaje/gasto/
  liquidacion por las policies de la 0045 (propias) y el resto por
  `supabaseAdmin()`. **Implicación legal directa:** desde la 0001, cualquier
  rol=operador con la anon key leía `wa_conversacion` (chats de toda la
  flota), `operador` (teléfonos de todos) y `cfdi_xml` (RFC/montos de
  proveedores) — exposición de datos personales de terceros bajo LFPDPPP que
  la 0078 cierra de verdad.
- **El CRÍTICO de la ronda 9 sigue cerrado y con guardarraíl.** Corrí
  `src/app/dashboard/foto_no_expuesta.test.ts` — 2/2 verdes. El POD
  (`src/app/dashboard/pod/page.tsx:167-168`) tampoco muestra la foto, citando
  el mismo criterio. Y el PDF (`api/export/pdf/[id]`) no firma ligas sobre
  `comprobantes`: el único `createSignedUrl` del flujo de export es sobre el
  bucket de liquidaciones.
- **El acceso del chofer a SUS comprobantes sigue razonado correctamente**
  (`chofer.ts:332,424`): liga firmada de 600 s detrás de `requireOperador` y
  del query acotado — derecho de acceso del titular (art. 22), no exposición
  a terceros.
- **Aviso simplificado e integral — contenido y entrega.** Las fracciones
  I-IV del art. 15 caben en el mensaje y se señala el integral (art. 16 fr.
  II); el integral trae los 11 elementos del checklist
  (`docs/conocimiento/11-datos-personales.md` §5.4), con la finalidad
  secundaria separada y la oposición al art. 26 fr. II anunciada; la liga del
  integral se sondea (startup) y, si no abre, el aviso lo dice en vez de
  prometerla. `getDatosResponsable` (`repo.ts:625`) selecciona solo 4
  columnas — no hay fuga de RFC/plan/config por la página pública. `robots:
  noindex` en el integral, correcto.
- **Sin aviso no hay tratamiento** (`processor.ts:600-622`): un fallo del
  envío libera el claim y deja que el operador reintente; `sin_datos` no se
  libera a propósito y el bloqueo se distingue del error nuestro. Fail-closed
  y con el mensaje correcto.
- **Retención CFF art. 30 intacta.** El cron de purga solo borra
  `wa_mensaje_procesado` (>30 días, tabla de idempotencia sin tenant_id);
  `llm_costo` se consolida, no se purga; el bucket `comprobantes` no se toca.
  No hay ningún camino nuevo que acorte la promesa de 5 años del aviso.
- **Producción verificada hoy** (`vercel env ls production`, 25 variables):
  sin `FACTURACION_MODO` (cron en `ensayo` por default, confirmado además por
  `route.test.ts:398-404`) y sin `FACTURAPI_SECRET_KEY` (pantalla de
  suscripción dice "Sin timbrar").
- **Pruebas del rubro:** `privacidad.test.ts` (36), `privacidad_ronda6.test.ts`
  (37), `aviso_integral.test.ts` (25), `repo_datos_responsable.test.ts` (4),
  `aviso_constancia.test.ts` (8), `cierre_aviso.test.ts` (30),
  `aviso_blip_de_red.test.ts` (5), `aviso_barrera_cerrado.test.ts` (3),
  `startup_aviso.test.ts` (7), `operacion_aviso.test.ts` (8),
  `route.test.ts` (20), `foto_no_expuesta.test.ts` (2) — **165/165 verdes**
  contra HEAD (`ce9abab`).

## Lo que NO alcancé a revisar

- **El contrato de encargado del tratamiento** (LFPDPPP, Regl. arts. 54-55):
  sigue sin vivir en el repo. El propio §17 del ToS lo marca: "🔴 El contrato
  de encargado del tratamiento está pendiente de firma." No hay nada nuevo que
  decir — sigue ausente, y para una demo en la que se hable de firmar a un
  cliente real es el documento que faltaría en la mesa.
- **El anexo de subencargados con OpenRouter** (`docs/conocimiento/
  52-anexo-subencargados.md:188-192`): el pendiente contractual ("Anexo de
  subencargado con OpenRouter que cubra su cadena" y "confirmar el régimen de
  retención de OpenRouter para las imágenes") no se tocó esta ronda; el aviso
  sigue diciendo que "en cada llamada se les pide explícitamente que no
  retengan lo que procesan", que es lo que el código hace — no una garantía
  contractual.
- **La base real**: no la toqué (regla). PROMPT-BASE dice que está vacía de
  datos del demo; la consecuencia legal-operativa es que, sin el seed, el
  flujo WhatsApp del demo muere antes del aviso (`resolveOperador` → "no te
  tengo registrado"). Eso es hallazgo de datos/operabilidad, no mío, pero lo
  dejo anotado porque el aviso es el primer punto de bloqueo del guion.
- **El detalle del seed vs. el dominio**: la liga del integral en el seed
  apunta a `https://likida.ai/aviso/<tenant>` y `GUION_DEMO.md:171` confirma
  que ese dominio sirve el aviso hoy; si el sitio se muda a `app.likida.ai`
  antes del demo sin tocar el seed, `sondearAvisoIntegral` lo marcará en el
  arranque. Lo dejo como dependencia del despliegue, no como hallazgo.
- **Fuzzing más amplio de `pideAtencionPrivacidad`** (nuevas conjugaciones,
  variantes con acentos/emojis): solo corrí los casos ya documentados.

## Veredicto

**No es green light para firmar un cliente con el paquete legal actual** —
no por el demo, sino por lo que el demo va a dejar firmado: el ToS no tiene
razón social ni jurisdicción, su §2 deja de ser cierto con una variable de
entorno, no hay cláusula de mandato, no hay contrato de encargado, y el canal
ARCO que el aviso promete no registra nada. Dos ALTOS abiertos, uno de ellos
reincidente de la ronda 10.

**Para el demo de mañana como demostración (no firma), el rubro legal no
bloquea el guion**: el aviso se sirve y se entrega con el seed, la foto del
ticket no se expone, y los bloqueos son fail-closed. Lo que sí conviene
decidir antes de la sala (como ya advierte `GUION_DEMO.md:171-173`) es cómo se
presenta la marca "pendiente" del art. 29 y, si alguien abre `/terminos`, que
la página diga con todas sus letras que el contrato está incompleto — es
verdad y está diseñado así, pero en una sala de ventas se ve como lo que es:
un producto que aún no tiene sus papeles.
