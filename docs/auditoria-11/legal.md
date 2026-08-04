# Cumplimiento legal — auditoría 11

**Nota: 3/10** (antes 4). Razón del movimiento: **deuda que cobró factura, otra vez
y peor**. La ronda 10 bajó la nota a 4 escribiendo que habían entrado 5,743 líneas
que tratan datos personales y que `privacidad.ts` no se había tocado. Medido hoy
sobre este árbol: desde el último commit que tocó `src/lib/cuadra/privacidad.ts`
(`cce7543`, 3-ago) han entrado **50 commits y 11,578 líneas nuevas en `src/`**
(`git diff --shortstat cce7543..HEAD -- src`), y entre ellas están las dos cosas
que más datos personales nuevos meten al producto: la **fotografía de la cara de
un usuario** (mig. 0046) y el **expediente operativo por chofer** (mig. 0047 +
`operacion.ts`). `privacidad.ts` sigue sin una sola línea nueva. El ancla del
encargo es explícita —"3 o menos si hay transferencia de datos personales sin
cobertura"— y hoy hay una: la foto de perfil se publica en un bucket legible por
cualquiera en internet, que es una comunicación a persona distinta de la titular,
del responsable y de la encargada (art. 2 fr. XX), sin base en ningún aviso.

**El riesgo mayor del rubro, hoy:** el producto empezó a construir juicios sobre
personas —incidencias con dueño, entregas que faltan, % comprobado por chofer, y
la cara del usuario en la web abierta— con el aviso de privacidad congelado en la
versión que solo describe fotos de tickets por WhatsApp.

Compuerta medida por mí sobre este árbol: `npx vitest run` → 172 archivos, 1670
pruebas, 1 saltada, exit 0. Coincide con la línea base del MAPA.

---

## Hallazgos

### [CRÍTICO] REINCIDENTE — `/admin` sigue exhibiendo el teléfono y la transcripción íntegra de operadores identificables, cruzando flotas, para una finalidad que el aviso excluye por escrito

`src/lib/admin/negocio.ts:220-236` · `src/app/admin/conversaciones/page.tsx:17,47,67,83` ·
`src/app/admin/layout.tsx:42` · `src/app/admin/notificaciones/page.tsx:18` ·
`src/app/admin/page.tsx:267-286` · `src/app/admin/agente-whatsapp/page.tsx:57-76` ·
`src/app/admin/whatsapp-infra/page.tsx:105-124` · contra `src/lib/cuadra/privacidad.ts:511-512`
· ficha: `normas/lfpdppp-15-16.yaml`, `normas/lfpdppp-2-XII-XX.yaml`

**Texto de la norma** (`lfpdppp-15-16.yaml`, transcrito):
> "Artículo 15. El aviso de privacidad deberá contener, al menos, la siguiente
> información: […] III. Las finalidades del tratamiento de datos personales,
> distinguiendo aquéllas que requieren el consentimiento de la persona titular;"

Y (`lfpdppp-2-XII-XX.yaml`, transcrito):
> "XII. Persona encargada: Persona física o jurídica que sola o conjuntamente con
> otras trate datos personales **por cuenta del responsable**;"

**Texto del aviso que se incumple**, palabra por palabra, del documento que el
operador abre en `/aviso/[tenant]` (`privacidad.ts:511-512`):
> "· Medir cómo funciona el servicio para mejorarlo (**estadísticas de uso, sin
> identificarte en los reportes**)."
> "Cualquier finalidad que no esté escrita aquí requiere que te vuelvan a pedir
> permiso. La ley vigente ya no permite ampararse en usos «compatibles o análogos»."

**Escenario, con valores.** El operador Juan Pérez, `+5219993700779`, escribe por
WhatsApp *"jefe se me perdió el ticket del diésel de Querétaro"*. `conv.ts:255-258`
persiste ese texto literal en `wa_conversacion.estado.turns`.
`getConversacionesActivas()` (`negocio.ts:220-227`) lo lee con `supabaseAdmin()`,
**sin un solo `.eq('tenant_id', …)`**, `limit(20)`, y devuelve `telefono`,
`tenantNombre` y los `turns` completos. `/admin/conversaciones:67` pinta
`+5219993700779` como título de la tarjeta, `:83` pinta el `content` de **cada**
turno sin recortar, y `:47` monta un `HBars` cuya etiqueta de cada barra **es el
teléfono del operador**, encima de dos KPI ("Conversaciones activas", "Mensajes
totales") — o sea, literalmente el reporte de estadísticas de uso del servicio con
el titular identificado que el aviso promete que no existe. No hay que ir a
buscarlo: `layout.tsx:42` llama a esa función en **cada carga de cualquier página
de `/admin`**.

**Qué cambió desde la ronda 10 (y por qué sube, no baja).** Entró un consumidor
nuevo: `/admin/notificaciones/page.tsx:18` — las transcripciones ahora también
alimentan la campana de alertas.

**Refutación que intenté.** (a) *¿Se salva con la figura de persona encargada?* No:
la fr. XII exige tratar **por cuenta del responsable**, y el encabezado del propio
`negocio.ts` declara que esta función "cruza TODOS los tenants a propósito"; la
finalidad es el negocio de Likida. Un encargado que trata para finalidad propia
pasa a ser responsable, y como responsable no tiene aviso hacia ese operador:
`/privacidad:53` dice expresamente que los datos del operador no son suyos.
(b) *¿Es soporte?* La propia página cierra diciendo que no hay colas, ni handoff,
ni búsqueda, y que "antes de construirlo hay que decidir si de verdad aplica".
(c) *¿Basta con `requireSuperadmin()`?* El control de acceso funciona; el problema
es que el acceso autorizado es exactamente el que el aviso excluyó por escrito.

**Consecuencia.** *Para el titular:* Juan leyó que la medición de uso no lo
identifica y su conversación íntegra se lee fuera de su empresa, en una pantalla
que no puede conocer. *Para Likida frente a la autoridad:* tratamiento para
finalidad propia sin aviso propio (art. 15 fr. III y art. 16), con la multa del
art. 59 recayendo sobre Likida, no sobre la flota. *Para el demo del 6-ago:* si en
la misma sesión se abre `/admin` y `/aviso/[tenant]`, las dos pantallas se
desmienten a un clic.

**Causa raíz probable.** `getConversacionesActivas` se escribió razonando el
aislamiento **de costo** entre tenants, no el de datos personales, y desde
entonces cinco pantallas la reusaron sin volver a la lista de finalidades.

---

### [CRÍTICO] La fotografía de la cara de un usuario se publica en un bucket legible sin sesión, no está en el catálogo de ningún aviso, y no existe un solo camino de borrado en el repo

`supabase/migrations/0046_perfil_avatar.sql:17-18,42-45` ·
`src/app/admin/mi-perfil/page.tsx:48-56` · `src/lib/auth/session.ts:33,47` ·
contra `src/app/privacidad/page.tsx:61,90,109` · ficha: `normas/lfpdppp-15-16.yaml`,
`normas/lfpdppp-2-XII-XX.yaml`

**Texto de la norma** (`lfpdppp-15-16.yaml`, transcrito):
> "Artículo 15. El aviso de privacidad deberá contener, al menos, la siguiente
> información: […] II. **Los datos personales que serán sometidos a tratamiento**,
> identificando aquéllos que son sensibles;"

Y (`lfpdppp-2-XII-XX.yaml`, transcrito):
> "XX. Transferencia: **Toda comunicación de datos personales** dentro o fuera del
> territorio mexicano, realizada **a persona distinta de la titular, del
> responsable o de la persona encargada** del tratamiento."

**Escenario, con valores.** Javier abre `/admin/mi-perfil`, elige `foto.jpg`. El
Server Action (`page.tsx:48-50`) arma `ruta = "<uuid-de-auth>/avatar.jpg"` y la
sube al bucket `avatares`, que la migración creó con `public = true`
(`0046:17-18`) y con una policy adicional `avatares_lectura_publica … for select
**to public** using (bucket_id = 'avatares')` (`0046:42-45`). `page.tsx:52` llama
`getPublicUrl` —la **primera** aparición de `getPublicUrl` en `src/` en toda la
historia del repo; cinco rondas de auditoría verificaron que no existía ninguna— y
`:56` guarda la URL resultante en `app_user.avatar_url`. `session.ts:33,47` la
trae en cada sesión y el sidebar la pinta como `<img src>` en las ~30 páginas de
`/admin`.

Resultado, con valores: `https://<proyecto>.supabase.co/storage/v1/object/public/avatares/<uuid>/avatar.jpg`
devuelve la cara de esa persona **a cualquiera que tenga la cadena, sin sesión,
sin cabecera y para siempre**. Y la policy `to public` sobre `storage.objects`
además permite al rol `anon` **enumerar** el bucket: listar todas las carpetas
—que son los `auth.uid()` de todos los usuarios— y bajar cada foto.

**El segundo tramo, que es el que lo vuelve irreversible.** Mañana Javier sube
`foto.png`. `ext` sale del nombre del archivo del usuario (`page.tsx:48`), así que
la ruta nueva es `<uuid>/avatar.png` y el `upsert: true` **no pisa** el `.jpg`
anterior: queda un objeto huérfano, público, al que ya no apunta ninguna fila.
Y no hay forma de quitarlo: `grep -rn "deleteUser\|storage.*remove"` sobre `src/`
→ **cero resultados**. No existe una sola llamada de borrado de usuario ni de
objeto en todo el código.

**Contra qué texto choca.** El aviso de Likida —el que aplica a quien entra al
panel, `/privacidad`— enumera su catálogo en `:61`:
> "Tu **nombre**, tu **correo** y tu **teléfono**."

Fotografía no aparece. Y dos secciones más abajo promete lo que el código no puede
cumplir:
> `:90` "Tus datos de cuenta, mientras tengas el servicio y **hasta un año después
> de darlo de baja**."
> `:109` "**Se borran** tus datos de cuenta y de acceso." (sección "Cómo pedir que
> se borre tu cuenta", cuyo `fundamento` declarado es *"Requisito de Meta para apps
> en producción"*)

El aviso integral de la flota tampoco lo cubre: `privacidad.ts:498` afirma "**No se
tratan datos sensibles.** Ni […] ni **datos biométricos**", una afirmación que hay
que volver a mirar el día que la columna se abra al rol `operador` —cosa que la
propia migración anuncia en su encabezado: *"la columna vive en `app_user` así que
cualquier rol la puede usar el día que su propio panel tenga edición de perfil"*.

**Refutación que intenté.** (a) *¿No es "la misma sensibilidad que un avatar de
cualquier app", como argumenta la migración?* El argumento es de comodidad de
render (no re-firmar la URL), y es legítimo como decisión de ingeniería; lo que no
resuelve es que una foto de la cara de una persona identificada es un dato personal
que ningún aviso del producto declara, ni tiene camino de supresión. (b) *¿La URL
es adivinable?* No hace falta adivinarla: la policy `to public` sobre
`storage.objects` habilita el listado, y además la URL viaja en el HTML de todas
las páginas del panel. (c) *¿Hoy hay víctima?* Hoy el único titular con foto es
Javier, que es dueño de Likida — lo digo sin adornarlo. Aun así lo califico
CRÍTICO porque la exposición es **estructural y no revocable** (bucket + policy +
cero borrado), contradice por escrito el catálogo y el plazo de conservación de
`/privacidad`, y el primer contralor o chofer que edite su perfil la hereda intacta
el día uno. (d) *¿Se valida que sea una imagen?* `accept="image/*"`
(`avatar-uploader.tsx:56`) es del navegador; en el servidor no hay validación de
tipo ni de tamaño, y `contentType` sale del archivo. Un titular puede subir por
error el escaneo de su INE a un bucket público.

**Consecuencia.** *Para el titular:* su cara queda en la web abierta sin que ningún
documento se lo haya dicho, y el producto no tiene con qué quitarla ni siquiera si
la pide. *Para Likida frente a la autoridad:* es responsable de estos datos —lo
dice `/privacidad:52`— y hay comunicación a terceros indeterminados (art. 2 fr. XX)
sin base en el aviso, más un plazo de conservación publicado que ningún mecanismo
puede cumplir. *Para la due diligence:* la promesa de borrado de cuenta está
publicada como requisito de Meta y no tiene una línea de código detrás.

**Causa raíz probable.** El bucket se diseñó por su costo de render (evitar firmar
URLs) y nadie cruzó esa decisión con el catálogo del art. 15 fr. II ni con la
sección de conservación que la misma página ya publicaba.

---

### [ALTO] El producto empezó a llevar un expediente operativo por chofer —incidencias con dueño, entregas que faltan, % comprobado— y ninguna de esas finalidades ni de esos datos está en el aviso

`src/lib/cuadra/operacion.ts:25-38,73-76,91-93,97-105` ·
`src/app/dashboard/despacho/vista.tsx:117-134` ·
`src/lib/cuadra/analytics.ts:412-414,415-466` ·
`src/app/dashboard/operadores/page.tsx:103-130` ·
`supabase/migrations/0047_operacion_encargado.sql:106-125` ·
contra `src/lib/cuadra/privacidad.ts:495-497,505-512` · ficha: `normas/lfpdppp-15-16.yaml`,
`normas/lfpdppp-26-II.yaml`

**Texto de la norma** (`lfpdppp-15-16.yaml`, transcrito):
> "Artículo 15. […] II. Los datos personales que serán sometidos a tratamiento […]
> III. Las finalidades del tratamiento de datos personales, distinguiendo aquéllas
> que requieren el consentimiento de la persona titular;"

**Texto del aviso, completo, para que se vea qué falta.** Catálogo de datos
(`privacidad.ts:495-497`): *"Tu **nombre** y tu **número de teléfono**"*, *"las
**fotos de comprobantes**… montos, fechas, folios, RFC del establecimiento"*, *"el
**contenido de tus mensajes**… y los **viajes y liquidaciones** en los que
participas"*. Finalidades (`:505-512`): liquidar viajes, comprobar ante el SAT,
responder por WhatsApp, detectar comprobantes repetidos o alterados, y medir el uso
del servicio. **Nada de operación, incidencias, evidencia de entrega ni desempeño.**
Y el propio aviso cierra la puerta en `:512`: *"Cualquier finalidad que no esté
escrita aquí requiere que te vuelvan a pedir permiso."*

**Escenario, con valores.** La mig. 0047 (`:106-125`) crea `incidencia` con
`tipo check (… 'dano', 'faltante', 'desvio')`, `descripcion text` libre y
`viaje_id` — y el viaje tiene `operador_id`, así que la incidencia queda atribuida
a una persona. El encargado abre `/dashboard/incidencias` y levanta una:
`tipo = 'faltante'`, `descripcion = "faltaron 3 tarimas en la entrega de
Monterrey"`, contra el viaje `VJ-2026-0117` de Juan Pérez
(`incidencias/page.tsx:85-93`, `crearIncidencia`).

Al día siguiente, en `/dashboard/despacho`, `getCargaOperadores`
(`operacion.ts:73-76,91-93`) cuenta por operador los viajes sin POD subido y las
incidencias no resueltas, y `vista.tsx:117-134` pinta la tabla:

| Operador | Carga | En curso | **Sin POD** | **Incidencias** | Estado |
|---|---|---|---|---|---|
| Juan Pérez | ▇▇▇▇ | 4 | 2 | 1 | Activo |

Y en `/dashboard/operadores` (`page.tsx:103-130`) aparece la misma persona con
**nombre, teléfono, número de empleado y "% comprobado"**, alimentado por
`getOperadoresDetalle`, cuyo propio comentario dice para qué es
(`analytics.ts:412-414`):
> "Operadores con su anticipo abierto y qué tanto comprobaron — **el cruce que el
> dueño usa para la conversación difícil**."

Eso es una evaluación de una persona: fiabilidad operativa (incidencias),
cumplimiento documental (POD) y situación económica frente a su patrón (%
comprobado). Es tratamiento nuevo, de datos nuevos, para una finalidad nueva, y el
titular no lo sabe: el aviso que recibió no lo menciona, y no se le reenvía nada —
`versionAviso` (`privacidad.ts:255-262`) es un hash del texto armado con razón
social, domicilio y liga del integral, y ninguno de los tres cambia al levantar una
incidencia, así que el reenvío del art. 15 fr. VI no dispara.

**Refutación que intenté, y una que se sostiene.** ¿No es esto el supuesto del
art. 26 fr. II? **No, y lo digo aunque me quite un hallazgo más grande.** La ficha
`lfpdppp-26-II.yaml` transcribe:
> "II. Sus datos personales sean objeto de un tratamiento automatizado […] y estén
> destinados a evaluar, **sin intervención humana**, determinados aspectos
> personales de la misma o analizar o predecir, en particular, **su rendimiento
> profesional, situación económica, […] fiabilidad o comportamiento**."

El vocabulario de la fracción describe exactamente estas tres columnas, pero la
incidencia la teclea un humano y la lee un humano que decide: el supuesto de la
fracción II **no se activa hoy**. Lo que sí se incumple es el art. 15 fr. II y III.
La otra refutación que intenté: ¿no está cubierto por "los viajes y liquidaciones
en los que participas"? Un viaje no es una incidencia de faltante con descripción
libre, ni un contador de entregas que el chofer no entregó — el primero es un hecho
del trabajo, el segundo es un juicio sobre quien lo hizo.

**Consecuencia.** *Para el titular:* su patrón acumula un historial de conducta
sobre él, ordenado y comparable contra sus compañeros, del que el documento legal
que le entregaron no dice una palabra; y de ahí sale la "conversación difícil" que
el código nombra, con el art. 110 fr. I de la LFT
(`normas/lft-110-111-263.yaml`) al final del camino. *Para la flota ante la
autoridad:* aviso incompleto en dos fracciones del art. 15, con rastro documental
que lo prueba (las filas de `incidencia` frente al texto del aviso). *Para Likida:*
el argumento de venta "la flota cumple con solo usarnos" produce hoy un aviso que
se quedó corto respecto de su propio producto, por segunda ronda consecutiva.

**Causa raíz probable.** `operacion.ts` y la 0047 se diseñaron desde la pregunta
del jefe de tráfico ("¿a quién no le cargo otro?") y el módulo que declara qué se
trata y para qué no es parte de ninguna lista de verificación al añadir una tabla.

---

### [ALTO] Un superadmin de Likida abre el panel de cualquier flota y ve el expediente de sus choferes sin que quede una sola línea en ningún log

`src/lib/auth/tenant-efectivo.ts:66-73` · `src/app/dashboard/despacho/page.tsx:45` ·
`src/app/api/dashboard/asistente/route.ts:36-41` · contra `src/lib/cuadra/privacidad.ts:488`
· ficha: `normas/lfpdppp-2-XII-XX.yaml`, `normas/lfpdppp-15-16.yaml`

**Texto de la norma** (`lfpdppp-2-XII-XX.yaml`, transcrito):
> "XII. Persona encargada: Persona física o jurídica que sola o conjuntamente con
> otras trate datos personales **por cuenta del responsable**;"

**Texto del aviso que se afirma** (`privacidad.ts:488`, publicado en `/aviso/[tenant]`):
> "Likida opera la herramienta con la que se procesan: es **persona encargada**…,
> trata los datos por cuenta de la empresa y **siguiendo sus instrucciones**, y no
> decide sobre ellos."

**Escenario, con valores.** Javier, rol `superadmin`, teclea
`/dashboard/despacho?tenant=8f3c…-Transportes-Innovativos`.
`resolverTenantEfectivo` (`tenant-efectivo.ts:66-73`) valida el uuid contra la
tabla `tenant` y cambia el tenant efectivo. A partir de ahí ve, de esa flota que no
es la suya: los nombres y teléfonos de todos los operadores
(`operacion.ts:97-105`), quién trae cuántos viajes, quién no entregó evidencia,
cuántas incidencias tiene cada uno, y —en `/dashboard/operadores`— el % comprobado
de cada persona con su número de empleado.

**Lo que queda escrito de eso: nada.** `grep -c logger src/lib/auth/tenant-efectivo.ts`
→ **0**. El archivo no importa el logger. Tampoco `visibilidad.ts` (0) ni
`negocio.ts` (0). La cinta de la UI (`dashboard/aviso-rol.tsx`) anuncia el modo al
que lo usa, que es lo contrario de dejar rastro para el responsable. Y el mismo
salto existe en la API: `api/dashboard/asistente/route.ts:36-41` honra `?tenant=`
para superadmin, sin log.

**Refutación que intenté.** (a) *¿No es legítimo que el encargado de tratamiento
entre a dar soporte?* Sí, perfectamente — la fr. XII lo permite **por cuenta del
responsable**. El problema no es el acceso, es que no hay forma de acreditar que
ocurrió ni bajo qué instrucción, y sin eso la afirmación del aviso ("siguiendo sus
instrucciones") es indemostrable. (b) *¿No lo cubre el control de acceso?* El
control funciona (solo superadmin, uuid validado); esto es otra cosa. (c) *¿No es
rubro de seguridad?* La escalada de privilegio lo es y no la reporto; lo que
reporto es la imposibilidad de contestar un ARCO de acceso (art. 15 fr. V) y de
sostener la calificación de persona encargada.

**Consecuencia.** *Para el titular:* si Juan pregunta quién ha visto sus datos, no
hay respuesta posible. *Para la flota:* es la responsable, y no tiene con qué
demostrar ante un verificador que los accesos de su proveedor fueron por
instrucción suya — ni con qué detectar uno que no lo fuera. *Para Likida:* la
figura de persona encargada, sobre la que descansa **todo** el análisis de riesgo
del rubro, no tiene evidencia que la sostenga.

**Causa raíz probable.** `tenant-efectivo.ts` nació para resolver un problema de
producto (comparar qué ve cada rol sin tener sus contraseñas) y se escribió sin la
contraparte de auditoría que ese poder exige.

---

### [ALTO] REINCIDENTE — Ejercer el derecho sigue sin producir ningún efecto: ni registro que la empresa pueda ver, ni cambio en el tratamiento automatizado

`src/lib/cuadra/processor.ts:133-140,264-265` · `src/lib/cuadra/privacidad.ts:407,521,528` ·
`src/lib/cuadra/analytics.ts:125-146` · ficha: `normas/lfpdppp-26-II.yaml`, `normas/lfpdppp-15-16.yaml`

**Texto de la norma** (`lfpdppp-15-16.yaml`, transcrito):
> "Artículo 15. […] IV. Las opciones y medios que el responsable ofrezca a las
> personas titulares para limitar el uso o divulgación de los datos; V. Los
> mecanismos, medios y procedimientos para ejercer los derechos ARCO…"

**Texto del aviso que se incumple**, tres afirmaciones de hecho:
> `privacidad.ts:407` "**Queda registrada tu solicitud para la empresa.**"
> `privacidad.ts:521` "Oponerte a esta revisión no detiene tu liquidación: **la
> empresa la hará a mano**."
> `privacidad.ts:528` "Tu solicitud **queda registrada para la empresa**…"

**Escenario, con valores.** Juan escribe `PRIVACIDAD`. Corrí `pideAtencionPrivacidad`
con el módulo real de HEAD (bundle de `esbuild`, sin mocks): devuelve `true`.
`processor.ts:264-265` desvía a `atenderPrivacidad`, se manda `respuestaPrivacidad`
—que le dice las tres frases de arriba— y **el registro completo de su ejercicio es
esta línea** (`processor.ts:137-138`):

```ts
// Rastro para la flota: es ELLA quien tiene que resolver el ARCO.
logger.info('privacidad.solicitud_operador', { tenantId, operadorId });
```

Un `logger.info`. Verificado hoy sobre este árbol: no hay tabla ni columna de
solicitudes (`grep -rniE "retencion|consentimiento|oposicion"` sobre
`supabase/migrations` → cero), no hay pantalla en `/dashboard` que las muestre —y
las 8 páginas nuevas de esta ronda tampoco la trajeron—, y Sentry solo recibe
`warn` y `error`, así que ni sale del proceso. La empresa, que tiene 20 días
hábiles para contestar, no se entera nunca.

La tercera promesa tampoco se cumple: `detectarAnomalias` (`analytics.ts:125-146`)
lee **todos** los `gasto` del tenant, sin predicado por operador y sin bandera de
oposición —porque esa bandera no existe en el esquema—, así que el comprobante de
Juan vuelve a pasar por la revisión automatizada y su resultado vuelve a llegarle a
la empresa.

**Consecuencia.** *Para el titular:* ejerce el único derecho que este producto
activa por sí mismo, recibe un acuse que afirma un estado que no se produce, y nada
cambia. *Para la flota:* incumple plazos sin saber que corren y no tiene con qué
acreditar que atendió. *Para Likida:* la constancia del art. 16 se guarda con
esmero (migs. 0018/0033); la del ejercicio del derecho, que es la primera que pide
un verificador, no se guarda en absoluto.

**Causa raíz probable.** Se construyó con cuidado la mitad de entrada del canal
ARCO (detección determinística, respuesta, constancia) y la mitad de salida —dónde
aterriza, quién la ve, qué apaga— nunca se modeló.

---

### [ALTO] REINCIDENTE — El correo del chofer se trata fuera del catálogo del aviso, el reenvío del art. 15 fr. VI no dispara, y el código sigue afirmando por escrito que ese correo no existe donde sí está

`src/app/admin/usuarios/nuevo/page.tsx:12,34` · `src/lib/auth/provisionar.ts:25-30` ·
`src/lib/admin/negocio.ts:259-262` · `src/app/dashboard/usuarios/page.tsx:38-41` ·
contra `src/lib/cuadra/privacidad.ts:204,495-497` · ficha: `normas/lfpdppp-15-16.yaml`

**Texto de la norma** (transcrito arriba): art. 15 fr. II — *"Los datos personales
que serán sometidos a tratamiento"*.

**Escenario, con valores.** El superadmin abre `/admin/usuarios/nuevo`, elige
"Transportes Innovativos", teclea `juan.perez@gmail.com`, y en el desplegable
selecciona la cuarta opción, que existe y está etiquetada así
(`page.tsx:12`): *"Chofer (operador) — solo sus propios viajes"*. El submit
(`:34`) llama `provisionarUsuario(...)`, que crea el usuario de Auth con
`email_confirm: true` —o sea, **sin mandar correo**— y escribe la fila de
`app_user` con `email` y `rol` (`provisionar.ts:25-30`). El correo personal de Juan
queda en dos tablas y se pinta en `/admin/equipo` vía `getEquipo`
(`negocio.ts:261`, que lo trae en el `select`). El aviso que Juan tiene dice
(`privacidad.ts:204`) *"Qué se trata: tu nombre y teléfono, y las fotos de
comprobantes…"* y (`:495-497`) *"Tu **nombre** y tu **número de teléfono**"*.
**Correo electrónico no aparece en ninguno de los dos.** Y no se reenvía nada: el
hash de `versionAviso` depende de razón social, domicilio y liga del integral, no
del catálogo.

**Lo que agrava respecto de la ronda 10, y es nuevo de este árbol.** El modelo
mental que dejó el correo fuera del aviso sigue escrito, ahora en una página del
panel del cliente. `src/app/dashboard/usuarios/page.tsx:38-41`:
> "El correo NO se muestra: **vive en `auth.users`** (el esquema de Auth), **no en
> `app_user`**, y traerlo aquí obligaría a leer con service-role una tabla de
> credenciales…"

Es falso, y se comprueba dos archivos más allá: `provisionar.ts:29` inserta `email`
**en `app_user`**, `negocio.ts:261` lo lee de ahí, y `mi-perfil/page.tsx:31` hace
`from('app_user').select('email')`. Mientras el código crea que el correo no está
en el modelo de datos del producto, nadie lo va a agregar al catálogo del aviso.

**Consecuencia.** *Para el titular:* un dato de contacto personal entra a la base de
su patrón y de Likida sin que se lo digan y sin figurar en el documento que le
prometieron que describe todo. *Para la flota:* aviso incompleto en el art. 15 fr. II.

**Causa raíz probable.** El bloque de auth creció el modelo de datos personales
(correo, rol, vínculo cuenta↔chofer) y `privacidad.ts` solo se edita cuando alguien
piensa en WhatsApp.

---

### [MEDIO] El aviso publicado cita el artículo equivocado justo en la bisagra de todo el análisis, y funda la revocación en el Reglamento de la ley abrogada

`src/lib/cuadra/privacidad.ts:488,544` · `src/app/privacidad/page.tsx:53` ·
renderizado en `src/app/aviso/[tenant]/page.tsx:117` · ficha: `normas/lfpdppp-2-XII-XX.yaml`

**Texto de la norma** (`lfpdppp-2-XII-XX.yaml`, transcrito):
> "XII. Persona encargada: Persona física o jurídica que sola o conjuntamente con
> otras trate datos personales por cuenta del responsable;
> […]
> **XX. Transferencia:** Toda comunicación de datos personales…"

Y su `nota_verificacion`, transcrita:
> "CORRIGE el análisis previo, que apoyaba la conclusión en la figura de
> 'REMISIÓN'. Esa palabra NO aparece ni una vez en la ley vigente: venía del
> **Reglamento de la ley abrogada**. **Citarla ante un cliente es citar derecho
> derogado.**"

**Escenario, con valores.** Un abogado de la flota abre
`app.likida.ai/aviso/8f3c…`. La primera sección le dice (`privacidad.ts:488`,
pintada por `aviso/[tenant]/page.tsx:117` con su `fundamento` a la vista):
> "Likida […] es **persona encargada (art. 2 fr. XX)**"

La fr. XX es la definición de **Transferencia**. La de persona encargada es la
fr. XII — el propio encabezado de `privacidad.ts:5` la cita bien, y `:562` usa la
fr. XX correctamente para el argumento contrario ("no es una transferencia"). O
sea: el documento que sostiene "esto no es una transferencia" cita, como fundamento
de que Likida es encargada, **la definición de transferencia**. El mismo error está
en `/privacidad:53`, la política pública de Likida.

Y dos secciones más abajo, el mismo documento público declara como fundamento
(`privacidad.ts:544`):
> `fundamento: 'LFPDPPP art. 7 último párrafo; **Reglamento art. 21**'`

El Reglamento de 2011 es el de la ley abrogada; es exactamente la clase de cita que
la ficha vigente marca como derecho derogado.

**Refutación que intenté.** ¿Es un typo sin consecuencia? El `fundamento` de cada
sección **se pinta en la página** (`aviso/[tenant]/page.tsx:117`), y su razón de ser
declarada en `privacidad.ts:457` es *"para que quien lo revise pueda comprobarlo"*.
Un fundamento que no se puede comprobar porque apunta a otra fracción cumple lo
contrario de su función.

**Consecuencia.** *Para la flota:* su aviso publicado contiene una cita legal
incorrecta y una a normativa derogada, en el punto exacto sobre el que descansa la
defensa de que no hay transferencia. *Para Likida:* es el primer documento que un
abogado del cliente lee, y el error es visible en treinta segundos.

**Causa raíz probable.** La corrección que trajo la ficha (dejar de apoyarse en
"remisión") se aplicó al razonamiento y no a las citas del texto que se publica.

---

### [MEDIO] REINCIDENTE — Al chofer se le pide aceptar un aviso que en su propio texto declara no ser el suyo, y ninguna de las 20 páginas del panel ni `/mis-viajes` liga a un aviso

`src/app/login/page.tsx:181-186` · `src/app/privacidad/page.tsx:53-55` ·
`src/app/mis-viajes/`, `src/app/cuenta/`, `src/app/dashboard/` (grep sin resultados)
· ficha: `normas/lfpdppp-15-16.yaml`

**Texto de la norma** (`lfpdppp-15-16.yaml`, transcrito):
> "Artículo 16. […] II. Cuando los datos personales sean obtenidos por cualquier
> medio electrónico […] deberá ser proporcionado en su modalidad simplificada la
> que deberá contener al menos la información a que se refieren las fracciones
> **I a IV** del artículo anterior…"

**Escenario, con valores.** Juan, rol `operador`, abre `app.likida.ai/login` para
ver sus viajes. Teclea `juan.perez@gmail.com` y debajo del botón lee
(`login/page.tsx:181-186`): *"Al continuar, aceptas el **Aviso de Privacidad** de
Likida"*, con enlace a `/privacidad`. Hace clic, y el primer bloque le dice
(`privacidad/page.tsx:53-55`): *"**Los datos de los operadores son otra cosa.**
[…] la responsable de esos datos es **su empresa**, no Likida […] Si eres operador
y llegaste aquí buscando tus datos, el aviso que te toca es el de tu empresa."*
Le pidieron aceptar un documento que se autodescarta y que nombra al responsable
equivocado (art. 15 fr. I).

**Lo que empeoró en este árbol.** La ronda 10 lo reportó para `/mis-viajes` y
`/cuenta`. Hoy son además las **20 páginas de `/dashboard`**: verifiqué por grep
que ni `dashboard/`, ni `mis-viajes/`, ni `cuenta/` contienen la cadena `aviso` ni
`privacidad` en ningún archivo. El único enlace a `/aviso/[tenant]` en toda la app
es el que sale por WhatsApp.

**Consecuencia.** *Para el titular:* el único texto legal que se le pone delante en
el momento de entregar su correo nombra a la empresa equivocada. *Para la flota:*
obtiene un dato de su operador por medio electrónico sin poner a disposición su
aviso en ese punto (art. 16 fr. II).

**Causa raíz probable.** El pie del login se escribió pensando en el contralor —para
quien es correcto— y ningún rol cruzó la pregunta "¿qué aviso le toca a quién?" al
reestructurar el panel.

---

### [MEDIO] REINCIDENTE (residual) — La oposición y la cancelación se siguen perdiendo cuando el operador usa las palabras que de verdad usa, y el vocabulario nuevo del producto no está contemplado

`src/lib/cuadra/privacidad.ts:336` (`RECHAZA_AUTOMATIZADO`) · `:319` · `:357` ·
`processor.ts:264` · ficha: `normas/lfpdppp-26-II.yaml`

**Texto de la norma** (`lfpdppp-26-II.yaml`, transcrito):
> "Artículo 26. La persona titular tendrá derecho **en todo momento** y por causa
> legítima a oponerse al tratamiento de sus datos o exigir que se cese en el mismo
> cuando: […]"

**Escenario, con valores.** Corrí `pideAtencionPrivacidad` con el código de HEAD,
compilado con `esbuild` desde `src/lib/cuadra/privacidad.ts`, sin mocks. Salida
literal:

```
false  no quiero que un robot decida sobre mi ticket, que lo vea alguien
false  quiero que lo revise un humano y no una maquina, ese comprobante está bien
false  no estoy de acuerdo con que una computadora revise mis comprobantes
false  quiero que alguien de verdad vea mi recibo, no el robot
true   que lo revise una persona, no una máquina
false  borren mis datos
false  quiero que borren mi información personal
false  ya no quiero que tengan mi teléfono
false  no quiero que me pongan incidencias
false  no quiero salir en la lista de choferes
false  quiero ver mi expediente
false  que me borren la foto
true   PRIVACIDAD
```

La primera frase trae **las dos señales** que el arreglo de la ronda 9 declara
buscar —rechazo a lo automatizado ("no quiero que un robot decida") y petición de
humano ("que lo vea alguien")— y da `false`, porque `RECHAZA_AUTOMATIZADO`
(`:336`) exige la negación **pegada** al sustantivo y solo conoce cuatro:
`programa|sistema|robot|bot`. "Máquina" y "computadora" no están, y son las
palabras de un operador de carretera. Las tres formas de **cancelación** (la C de
ARCO) también fallan: `:357` reconoce `dar de baja mis datos` pero no *borrar* ni
*eliminar*.

**Lo nuevo de esta ronda.** Las cuatro últimas frases son del mundo que las migs.
0046 y 0047 acaban de crear: incidencias, listas de choferes, expediente, foto de
perfil. El detector no las conoce porque el módulo no se enteró de que ese mundo
existe — es el mismo hecho que sostiene la nota entera.

En los doce casos `false`, el mensaje sigue de largo hacia el agente
(`processor.ts:264` es el único punto de entrada) y el operador recibe una
respuesta sobre su ticket.

**Consecuencia.** *Para el titular:* el derecho se pierde sin dejar rastro. Es MEDIO
y no ALTO porque la vía que el aviso induce con sus propias palabras ("no el
programa") sí funciona.

**Causa raíz probable.** El detector se calibró contra las frases exactas de los
hallazgos anteriores en vez de contra la clase de frases, y quedó atado a un
vocabulario cerrado y a una posición fija de la negación.

---

### [BAJO] La 0047 abrió columnas de geolocalización del chofer que ningún aviso cubre, mientras el panel afirma que "el sistema no guarda una sola coordenada"

`supabase/migrations/0047_operacion_encargado.sql:133-134` · `:186-190` (policy
`operador_sube_su_pod`) · contra `src/app/dashboard/mapa/page.tsx:14` y
`src/lib/cuadra/privacidad.ts:495-497` · ficha: `normas/lfpdppp-15-16.yaml`

**Escenario, con valores.** `pod` nace con `lat double precision` y `lng double
precision` (`0047:133-134`), y la RLS ya autoriza al chofer a insertar el POD de
sus propios viajes (`operador_sube_su_pod`). Hoy nada escribe esas dos columnas —lo
verifiqué: `grep -rn "\blat\b|\blng\b"` sobre `src/` no devuelve un solo uso—, así
que el rótulo de `/dashboard/mapa:14` (*"El sistema **no guarda una sola
coordenada**"*) es cierto **hoy**. Lo que reporto es que el día que el flujo de
subida del POD mande la posición del teléfono, entra la ubicación de una persona
identificada a la base, el catálogo del aviso (`privacidad.ts:495-497`) sigue
diciendo "nombre y teléfono", y esa página seguirá afirmando que no se guarda
ninguna coordenada. Es deuda con fecha, no un incumplimiento presente.

**Consecuencia.** Deuda: la primera escritura a esas columnas convierte un rótulo
verdadero en falso y añade una categoría de dato sin declarar, sin que nadie tenga
que tocar el aviso para que ocurra.

---

### [BAJO] REINCIDENTE — El documento resumen sigue contradiciendo a la ficha vigente, y el anexo de subencargados no conoce ni el bloque de autenticación ni el bucket público de avatares

`FISCAL_LEGAL.md:142-146` · `docs/conocimiento/52-anexo-subencargados.md:52-64` ·
`src/app/privacidad/page.tsx:80` · ficha: `normas/lfpdppp-2-XII-XX.yaml`

`FISCAL_LEGAL.md:142` sigue titulando §2.3 **"Mandar la foto a un modelo de IA es
una transferencia"**, cuando `normas/lfpdppp-2-XII-XX.yaml` —fuente de verdad, que
corrige expresamente ese análisis— concluye que **no** lo es, porque la fr. XX
excluye a la persona encargada. Y el mismo bloque (`:146-152`) apoya el análisis en
el **art. 52 del Reglamento**, o sea el reglamento de la ley abrogada.

El anexo al que `/privacidad:80` remite por escrito (*"El detalle de esos
subencargados está en la documentación del producto y se actualiza cuando
cambia"*) tiene cinco filas: Meta, OpenRouter (+Google/Anthropic/OpenAI), Supabase,
Vercel, Sentry. Faltan, verificado hoy: el **SMTP de Supabase Auth** (manda el
magic link con el correo del titular), **Google como proveedor de identidad**
(`login/page.tsx`, `signInWithOAuth`), y ahora el **bucket público `avatares`**,
que no es un subencargado sino algo peor — un destino abierto.

**Consecuencia.** Deuda que cobra factura en la primera due diligence: la política
pública remite a un anexo que ya no describe la cadena, y el documento resumen
contradice a la ficha vigente en el punto exacto sobre el que descansa todo el
análisis de riesgo del rubro.

---

## Lo que revisé y está bien

- **La foto del comprobante sigue sin salir por ningún lado nuevo.** `getPublicUrl`
  aparece ahora en `src/` (`admin/mi-perfil/page.tsx:52`) pero **solo** para
  `avatares`; el bucket `comprobantes` sigue privado y sin policies
  (`0039_bucket_comprobantes.sql`), `ligaComprobante` (`intake/almacen.ts:76`) sigue sin un
  solo llamador, y `dashboard/[id]/page.tsx:86` conserva el comentario que explica
  por qué no se enseña. Sexta ronda que se verifica.
- **`pod` guarda la ruta, no la imagen, y lo razona**: `0047:147-148` —*"La foto
  vive en Storage (bucket privado), aquí solo la ruta — mismo criterio que
  comprobante: se conserva, no se exhibe sin base legal"*— y el constraint
  `pod_subido_tiene_archivo` impide un "entregado" sin evidencia.
- **`rechazarPod` no borra el archivo** (`operacion.ts:388-395`), y dice por qué:
  borrarlo dejaría la discusión sin prueba. Es la decisión correcta también para
  datos personales: se conserva lo que el titular mandó.
- **La RLS de la 0047 excluye al chofer de `unidad`, `mantenimiento` e
  `incidencia`** (`:170-181`, `not is_operador()`), así que un chofer no ve las
  incidencias de sus compañeros. La excepción de `pod` está acotada a sus propios
  viajes y sin borrado.
- **El asistente del panel no manda nada a ningún modelo.**
  `api/dashboard/asistente/route.ts` solo agrega `getKpis`/`getAcreditables`/
  `detectarAnomalias`; verifiqué por grep que no hay ni una llamada a
  `generateWithTools`/`generateStructured` bajo `src/app/`. Los únicos dos sitios
  que salen a OpenRouter siguen siendo `intake/ocr.ts:253` y `agents/run.ts:40`.
- **`sanitizarProducto` (`sanitizar.ts:111-119`) sigue descartando el campo entero**
  ante señales de salud, vida sexual o creencias, y su comentario sigue siendo
  honesto sobre su propio límite (`:46-49`: la foto ya viajó al modelo).
- **`/aviso/[tenant]` está bien construida**: valida forma de UUID antes de
  consultar, `notFound()` indistinguible entre "no existe" y "a medias" para no
  ser un detector de flotas, `robots: noindex`, y `getDatosResponsable` no trae RFC
  ni config (`aviso/[tenant]/page.tsx:13-31,62-68`).
- **`getCargaOperadores` no devuelve un solo peso** y el archivo lo razona
  (`operacion.ts:6-9`): el encargado no ve finanzas, y `visibilidad.ts:38-46` lo
  gatea de verdad en la página, no solo en el sidebar.
- **Custodia de credenciales de portales de terceros: sigue en cero.** Sexta ronda.
  No hay tabla, columna ni env var con credenciales del SAT, IMSS o de un portal de
  cliente; `facturacion/permiso_cre.ts` es una tabla pública del CRE.
- **`/dashboard/mapa` y `/dashboard/operadores` declaran lo que no tienen** en vez de
  simularlo (`mapa/page.tsx:13-17`, `operadores/page.tsx:138`: sin scorecard de
  conducción, sin licencia, sin telemática). Es la regla del producto bien aplicada
  a un dato de persona.
- **La constancia del art. 16 se sigue escribiendo con rigor**: reserva y constancia
  separadas (mig. 0033), la constancia solo cuando Meta devolvió un id, y liberación
  de la reserva si el envío falla.
- Compuerta verde sobre este árbol: 172 archivos / 1670 pruebas / 1 saltada, exit 0.

## Lo que NO alcancé a revisar

- **Consentimiento expreso para datos patrimoniales.** Sigue siendo el hueco de
  fichas más caro del rubro: `FISCAL_LEGAL.md:134-140` afirma que los gastos de un
  operador identificado exigen consentimiento **expreso** y el producto no captura
  ningún acto afirmativo (no hay columna de consentimiento en ninguna migración —
  verificado). No lo reporto porque **no hay ficha en `normas/` que cubra el art. 7
  ni el art. 9 vigentes**, y el único documento que lo razona se apoya en el
  reglamento abrogado. Con las incidencias y el % comprobado por chofer que entraron
  esta ronda, la pregunta pesa más que antes.
- **Plazo de conservación.** Nada purga `wa_conversacion`, `gasto`, el bucket
  `comprobantes` ni el bucket `avatares` (`grep` de `delete from`/`storage.remove`
  sobre `src/` y `supabase/` → solo el claim de `codigo_pendiente` y el lock de
  viaje). Lo reporté dentro del CRÍTICO del avatar porque ahí hay un plazo
  **publicado** contra el que medir (`/privacidad:90`); para el resto no verifiqué
  si el art. 11 vigente lo exige con la fuerza que tenía el Regl. art. 30 fr. VII, y
  no hay ficha.
- **El contrato Likida↔flota** y la autorización expresa de subcontratación: sigue
  sin vivir en el repo, sexta ronda igual.
- **`mantenimiento.descripcion` y `unidad`**: los leí para el modelo de datos pero no
  audité si una orden de trabajo puede acabar describiendo la conducta del chofer
  ("se le quemó el clutch a Juan"). Es el mismo vector que la incidencia, un campo
  más allá.
- **Si `wa_mensaje_procesado`** (que no tiene `tenant_id`) retiene algo del contenido
  del mensaje además del id de Meta.
- **Un barrido de las ~30 páginas de `/admin`** una por una: revisé las que importan
  datos reales y las que el encargo nombra.
