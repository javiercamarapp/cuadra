# Cumplimiento legal — auditoría 10

**Nota: 4/10** (antes 7). Razón del movimiento: **deuda que cobró factura**, y es
**la misma deuda de la ronda 9**. Verifiqué primero los dos cierres de esa ronda
y los dos anclaron de verdad: `b99b0fe` retiró la columna "Ticket" y el enlace
"Ver foto" de `dashboard/[id]/page.tsx` (queda el comentario explicativo en
`:57-60` y el guard `foto_no_expuesta.test.ts`, 2 pruebas verdes), y `2c4c3b8`
metió `RECHAZA_AUTOMATIZADO` (`privacidad.ts:336`) — corrí yo mismo
`pideAtencionPrivacidad` con el código de HEAD contra las tres frases del
hallazgo de la ronda 9 y las tres dan hoy `true`. También confirmé el pendiente
que la ronda 9 no alcanzó: el PDF **no** incrusta ni enlaza la foto (`grep` de
`imagen`/`ligaComprobante` sobre `liquidacion/pdf.ts` y las dos rutas de
`api/export/` → cero). 114 pruebas del rubro verdes.

Lo que baja la nota no es que se haya reabierto nada de eso. Es que el
diagnóstico de causa raíz de la ronda 9 —*"una decisión legítima retiró la
premisa sobre la que se escribió el aviso, y nadie volvió al aviso"*— se repitió
a escala mucho mayor: entraron ~5,743 líneas (auth real con correo, `/mis-viajes`,
`/cuenta` y una consola `/admin` de 39 archivos) y **`privacidad.ts` no se tocó
ni una línea** (`git log 96dc577..HEAD -- src/lib/cuadra/privacidad.ts` → vacío).
El aviso de la flota sigue describiendo un producto que solo vive en WhatsApp.

**El riesgo mayor hoy:** la consola de Likida pinta el teléfono y la
transcripción completa de la conversación de un operador identificable, en un
reporte de uso del producto, mientras el aviso que ese operador puede leer le
promete por escrito que la medición de uso del servicio es "sin identificarte en
los reportes".

## Hallazgos

### [CRÍTICO] `/admin` enseña la conversación íntegra y el teléfono de operadores identificables, para una finalidad de Likida que el aviso de la flota no cubre — y que contradice por escrito

`src/lib/admin/negocio.ts:212-229` (`getConversacionesActivas`) ·
`src/app/admin/conversaciones/page.tsx:70,86` ·
`src/app/admin/page.tsx:303-316` · `src/app/admin/agente-whatsapp/page.tsx:78-88` ·
`src/app/admin/whatsapp-infra/page.tsx:104-114` ·
`src/app/admin/layout.tsx:33` · `src/lib/cuadra/privacidad.ts:509-512`

**Texto que se incumple.** El aviso integral de la flota, el documento público
que el operador consulta en `/aviso/[tenant]`, enumera sus finalidades
distinguiéndolas (art. 15 fr. III) y cierra así:

> `:509` "**Finalidades que NO son necesarias, y a las que puedes oponerte sin
> que eso afecte tu liquidación:**"
> `:511` "· Medir cómo funciona el servicio para mejorarlo (**estadísticas de
> uso, sin identificarte en los reportes**)."
> `:512` "Cualquier finalidad que no esté escrita aquí requiere que te vuelvan a
> pedir permiso. La ley vigente ya no permite ampararse en usos «compatibles o
> análogos»."

Y `:488` describe a Likida como **persona encargada** que "trata los datos por
cuenta de la empresa y siguiendo sus instrucciones, y no decide sobre ellos".

**Escenario, con valores.** El operador Juan Pérez, `+5219993700779`, escribe por
WhatsApp: *"jefe se me perdió el ticket del diésel de Querétaro, ¿me lo puedo
brincar?"*. `processor.ts:1124` guarda ese texto literal como
`{ role: 'user', content: msg.text }` y `saveConversation` (`conv.ts:255`) lo
persiste en `wa_conversacion.estado.turns`.

1. `getConversacionesActivas()` (`negocio.ts:214-218`) lee `wa_conversacion` con
   `supabaseAdmin()` **sin filtro de tenant** —a propósito, el encabezado del
   archivo lo declara: *"Cruza TODOS los tenants a propósito: es la única función
   del repo con permiso de ver toda la base a la vez"* (`:3-5`)— y devuelve
   `telefono`, `tenantNombre` y `turns` completos de las 20 conversaciones más
   recientes.
2. `/admin/conversaciones` (`page.tsx:70`) pinta `+5219993700779` como título de
   la tarjeta y (`:86`) el `content` de **cada** turno, sin recorte — su propio
   comentario lo dice: *"aquí se enseñan TODOS los turns"* (`:20-21`). Encima
   monta dos KPI de producto: "Conversaciones activas" y "Mensajes totales en
   estas conversaciones" (`:42,51`). Eso es literalmente un reporte de
   estadísticas de uso del servicio, con el titular identificado.
3. No es una pantalla que haya que ir a buscar: `layout.tsx:33` llama a
   `getConversacionesActivas()` en **cada** carga de cualquier página de `/admin`,
   y las mismas transcripciones se repiten en `/admin` (Inicio, `:303-316`),
   `/admin/agente-whatsapp` (`:78-88`) y `/admin/whatsapp-infra` (`:104-114`).
4. Para quién es esa consola lo dice el guard: `auth/guard.ts:56-60` — *"la
   consola de negocio de Likida. Ningún otro rol la ve, ni `flota_admin`: lo que
   vive aquí […] **es de Javier, no de un cliente**"*.

**Por qué no se salva con la figura de persona encargada.** La calificación de
encargada del art. 2 fr. XII exige tratar los datos **por cuenta del
responsable**. El propio código declara lo contrario: estas pantallas existen
para el negocio de Likida, cruzando flotas, no por instrucción de ninguna. Un
encargado que trata para finalidad propia deja de serlo (es el mismo
razonamiento que `docs/conocimiento/11-datos-personales.md:342` aplica a
OpenRouter, y que este repo usa como bisagra de todo su análisis de riesgo).
Aquí Likida pasa a ser responsable de ese tratamiento — y como responsable no
tiene aviso alguno hacia el operador: `/privacidad` (la política de Likida) dice
expresamente en `:53-54` que los datos del operador **no** son suyos y que
"Esta página no es tu aviso".

**Refutación que intenté.** (a) *¿No es soporte, que sí es prestar el servicio?*
No hay nada de soporte en la página: no hay colas, ni asignación, ni handoff —
el propio pie de `/admin/conversaciones:98` explica que eso no existe y que
"antes de construirlo hay que decidir si de verdad aplica". Lo que hay son dos
contadores agregados y el expediente abierto. (b) *¿No está ya declarado el dato?*
Sí, el catálogo (`:497`, "el contenido de tus mensajes en esa conversación")
cubre el DATO; lo que falta es la FINALIDAD, y el art. 11 vigente perdió la
válvula de "compatible o análogo" — el propio aviso lo dice en `:512`. (c) *¿No
basta con que esté detrás de `requireSuperadmin()`?* El control de acceso es de
otro rubro y funciona; aquí el problema es que el acceso autorizado es
precisamente el que el aviso excluyó por escrito. (d) *¿Es solo el tenant demo?*
Hoy sí, un solo tenant. Pero la función está escrita para cruzar todos y el
código no cambia el día que entre el primer cliente.

**Consecuencia.** *Para el titular:* Juan Pérez leyó que la medición de uso del
servicio no lo identifica, y su transcripción íntegra —incluido lo que le pidió
al "jefe"— está siendo leída fuera de su empresa, por una persona que no
pertenece a ella, en una pantalla que no puede consultar ni conocer. *Para
Likida frente a la autoridad:* es tratamiento para finalidad propia sin aviso
propio hacia ese titular (art. 15 fr. III y art. 16) y contra el texto del aviso
que la propia herramienta genera — el supuesto del art. 58 con multa del art. 59
fr. III recayendo esta vez sobre Likida, no sobre la flota. *Para el demo:* si el
6-ago se enseña `/admin` en la misma sesión en que se abre `/aviso/[tenant]`,
las dos pantallas se desmienten a un clic de distancia.

**Causa raíz probable.** `getConversacionesActivas` se escribió como consulta de
negocio (el comentario del archivo razona el aislamiento **de costo**, no el de
datos personales) y nadie cruzó la lista de finalidades del aviso al construir la
consola.

---

### [ALTO] El correo del chofer se trata sin estar en el catálogo del aviso, y el aviso jamás se reenvía para incluirlo

`src/app/admin/usuarios/nuevo/page.tsx:12,34` · `src/lib/auth/provisionar.ts:25-30`
· `src/lib/cuadra/privacidad.ts:204,495-498` · `:255-262` (`versionAviso`)

**Texto que se incumple.** Art. 15 fr. II — *"Los datos personales que serán
sometidos a tratamiento"* (`normas/lfpdppp-15-16.yaml`). El aviso que la
herramienta genera enumera exactamente cuatro cosas y no admite lectura
extensiva: el simplificado (`:204`) *"Qué se trata: tu nombre y teléfono, y las
fotos de comprobantes de gasto…"*, y el integral (`:495-497`) *"Tu **nombre** y
tu **número de teléfono**"* + fotos + *"el contenido de tus mensajes"* + viajes.
**Correo electrónico no aparece en ninguno de los dos.**

**Escenario, con valores.** El superadmin abre `/admin/usuarios/nuevo`, elige la
flota "Transportes Innovativos", teclea `juan.perez@gmail.com`, nombre "Juan
Pérez" y en el desplegable de roles elige la cuarta opción, que existe y está
etiquetada: *"Chofer (operador) — solo sus propios viajes"* (`:12`). El submit
llama `provisionarUsuario(tenantId, 'juan.perez@gmail.com', 'Juan Pérez',
'operador')` (`:34`), que crea el `auth.users` con `email_confirm: true` y
escribe la fila en `app_user` con `email` y `rol` (`provisionar.ts:25-30`).
A partir de ahí el correo personal de Juan vive en dos tablas, se enseña en
`/admin/equipo` (`page.tsx`, columna Nombre, subtítulo `{u.email}`) y es la
llave con la que entra a `/mis-viajes`.

Juan no se entera nunca. `createUser` con `email_confirm: true` no manda correo.
Y el aviso tampoco se reenvía: `ponerAvisoADisposicion` (`processor.ts:166`)
reenvía solo cuando cambia `versionAviso(texto)`, que es un hash del texto
armado con razón social, domicilio y liga del integral (`privacidad.ts:255-262`)
— dar de alta un correo no cambia ninguno de los tres, así que el hash es el
mismo y el reenvío del art. 15 fr. VI no dispara.

**Refutación que intenté.** ¿Es una pantalla de maqueta, de las que el MAPA
advierte? No: es la única página de `/admin` con `'use server'` que **escribe**,
usa `provisionarUsuario` real (probada en `provisionar.test.ts`, 5 casos verdes,
uno de ellos con `rol` explícito) y su propio comentario dice que reemplaza al
script manual `scripts/tmp-provisionar-*.ts` que hasta hoy se corría a mano. ¿Y
no será que ese correo lo captura la flota, que es la responsable? Da igual quién
lo teclee: el obligado a informar el catálogo es el responsable, y el único
mecanismo que la flota tiene para hacerlo es este producto —
`normas/lfpdppp-15-16.yaml`, *impacto_en_producto*: *"Sin el mecanismo, la flota
no puede cumplir aunque quiera, y ese es un hueco de producto"*.

**Consecuencia.** *Para el titular:* un dato de contacto personal suyo —el correo
con el que se identifica en la red— entra a la base de su patrón y de Likida sin
que se lo digan y sin que aparezca en el documento que le prometieron que
describe todo lo que se trata. *Para la flota ante la autoridad:* aviso
incompleto en el elemento 2 del checklist propio del repo
(`11-datos-personales.md:220`), con un rastro documental que lo prueba (la fila
de `app_user` frente al texto del aviso). *Para Likida:* el mecanismo que vende
como "la flota cumple con solo usarnos" produce hoy un aviso que se quedó corto
respecto de su propio producto.

**Causa raíz probable.** El bloque de auth creció el modelo de datos personales
(correo, rol, vínculo cuenta↔chofer) y `privacidad.ts` es un módulo que solo se
edita cuando alguien piensa en WhatsApp.

---

### [ALTO] Ejercer el derecho no produce ningún efecto: ni registro que la empresa pueda ver, ni cambio en el tratamiento automatizado

`src/lib/cuadra/processor.ts:135-137` · `src/lib/cuadra/privacidad.ts:407,521` ·
`src/lib/cuadra/analytics.ts:146-167` (`detectarAnomalias`) ·
`src/app/admin/compliance/page.tsx:31-34`

**Texto que se incumple.** Art. 26 fr. II (`normas/lfpdppp-26-II.yaml`) y art. 15
fr. IV y V. El aviso promete dos cosas concretas y verificables:

> `privacidad.ts:407` "**Queda registrada tu solicitud para la empresa.**"
> `privacidad.ts:521` "Oponerte a esta revisión no detiene tu liquidación: **la
> empresa la hará a mano**."

**Escenario, con valores.** Juan Pérez escribe *"PRIVACIDAD"* por WhatsApp.
`pideAtencionPrivacidad` da `true` (verificado corriendo el módulo real),
`processor.ts:264` desvía a `atenderPrivacidad`, se le manda
`respuestaPrivacidad(datos)` y **el registro completo de su ejercicio es esta
línea**:

```ts
// processor.ts:136-137
// Rastro para la flota: es ELLA quien tiene que resolver el ARCO.
logger.info('privacidad.solicitud_operador', { tenantId, operadorId });
```

Un `logger.info`. No hay tabla —`grep -rn "consentimiento\|oposicion" supabase/
migrations src/lib/cuadra/repo.ts src/lib/cuadra/analytics.ts` → **cero
resultados**—, no hay columna, no hay pantalla en `/dashboard` que lo muestre, y
Sentry solo recibe `warn` y `error` (`52-anexo-subencargados.md`, fila 5), así que
ni siquiera sale del proceso. La empresa —la responsable, la que tiene 20 días
hábiles para contestar— no tiene ninguna forma de enterarse. La consola de Likida
lo confirma por escrito: `/admin/compliance:32-34`, *"Solicitudes ARCO abiertas,
datos por vencer retención, exports pendientes, audit log completo — Likida no
tiene estos flujos construidos hoy"*.

Y la segunda promesa tampoco se cumple: al día siguiente el contralor abre
`/dashboard`, que llama `detectarAnomalias(tenantId)` (`dashboard/page.tsx:74`).
Esa función lee **todos** los `gasto` del tenant (`analytics.ts:150-158`) sin
ningún predicado por operador y sin ninguna bandera de oposición, porque esa
bandera no existe en el esquema. El comprobante de Juan vuelve a pasar por la
revisión automatizada, y su resultado vuelve a llegarle a la empresa —
exactamente el tratamiento al que se opuso, con el mismo efecto sobre su
liquidación.

**Refutación que intenté.** ¿No basta con responderle bien al operador? No: `:407`
no dice "avísale a tu empresa", dice que **queda registrada para la empresa** —
afirma un estado que el sistema no produce. Y `:521` no dice "puedes pedirlo",
dice que la empresa la hará a mano. Las dos son afirmaciones de hecho sobre lo
que ocurre después, y ninguna ocurre. ¿No es esto ya lo que reportó la ronda 9?
No: la ronda 9 reportó que ciertas frases **no se reconocían**. Aquí el
reconocimiento funciona perfectamente y el ejercicio muere igual, un paso más
adelante.

**Consecuencia.** *Para el titular:* ejerce el único derecho que este producto
activa por sí mismo, recibe un acuse que le dice que quedó registrado, y no queda
registrado en ninguna parte ni cambia nada de lo que se hace con sus datos.
*Para la flota ante la autoridad:* incumple los plazos del art. 32/35 sin saber
siquiera que corren, y no tiene con qué acreditar que atendió — la
`normas/lfpdppp-26-II.yaml` avisa en *impacto_en_producto* que la revisión humana
es justamente lo que mantiene el cuadre fuera del supuesto de la fracción II.
*Para Likida:* la constancia del art. 16 sí se guarda con esmero (mig. 0018/0033,
reserva y constancia separadas); la del ejercicio del derecho, que es la que un
verificador pide primero, no se guarda en absoluto.

**Causa raíz probable.** Se construyó con cuidado quirúrgico la mitad de entrada
del canal ARCO (detección determinística, respuesta, constancia del aviso) y la
mitad de salida —dónde aterriza la solicitud, quién la ve, qué apaga— nunca se
modeló.

---

### [MEDIO] Al chofer que entra a `/mis-viajes` se le dice que acepta un aviso que en su propio texto declara no ser el suyo, y el panel no tiene ninguno

`src/app/login/page.tsx:180-186` · `src/app/privacidad/page.tsx:53-54` ·
`src/app/mis-viajes/page.tsx` (completo) · `src/app/cuenta/page.tsx` (completo)

**Texto que se incumple.** Art. 16 fr. II — cuando los datos se obtienen por medio
electrónico, el aviso simplificado *"deberá ser proporcionado"* con las
fracciones I a IV del art. 15, y la fr. I es la identidad del **responsable**.

**Escenario, con valores.** Juan Pérez, rol `operador`, abre `likida.ai/login`
para ver sus viajes. Teclea `juan.perez@gmail.com` y debajo del botón lee
(`login/page.tsx:181-185`):

> "Al continuar, aceptas el **Aviso de Privacidad de Likida**." → enlace a
> `/privacidad`

Hace clic y el primer bloque de esa página le dice (`privacidad/page.tsx:53-54`):

> "**Los datos de los operadores son otra cosa.** Cuando un chofer manda sus
> comprobantes por WhatsApp, la responsable de esos datos es **su empresa**, no
> Likida […] Si eres operador y llegaste aquí buscando tus datos, el aviso que te
> toca es el de tu empresa."

O sea: se le pidió aceptar un documento que en su segundo párrafo le dice que no
es el suyo y que nombra al responsable equivocado. `/mis-viajes` y `/cuenta` no
tienen liga a `/aviso/[tenant]` ni mención alguna de privacidad — lo verifiqué
leyendo los dos archivos enteros (106 y 44 líneas).

**Refutación que intenté.** ¿El chofer no entra al panel, solo a WhatsApp? Sí
entra: `/mis-viajes` existe para él, `requireOperador()` (`guard.ts:48-53`) lo
deja pasar y lo rebota a `/dashboard` si NO es operador, y la mig. 0045 construyó
RLS propia para ese caso. ¿Ya recibió su aviso por WhatsApp? Solo si además usa
WhatsApp y solo si su flota tenía razón social y domicilio capturados; y ese
aviso describe el canal de WhatsApp, no un panel web.

**Consecuencia.** *Para el titular:* el único texto legal que se le pone delante
en el momento de entregar su correo nombra a la empresa equivocada como
responsable y se autodescarta. *Para la flota:* obtiene un dato de su operador
por medio electrónico sin poner a disposición su aviso en ese punto.

**Causa raíz probable.** El pie del login se escribió pensando en el contralor
(para quien es correcto) y `/mis-viajes` se construyó como pantalla de solo
lectura, sin que el rol `operador` cruzara la revisión de qué aviso le toca a
quién.

---

### [MEDIO] REINCIDENTE (residual) — la oposición sigue perdiéndose cuando el rechazo a lo automatizado no usa la palabra "programa", y una cancelación en cristiano no se detecta

`src/lib/cuadra/privacidad.ts:336` (`RECHAZA_AUTOMATIZADO`) · `:319`
(`OBJETO_DE_PAPEL`) · `:357` · `processor.ts:264`

**Escenario, con valores.** Corrí `pideAtencionPrivacidad` con el código de HEAD
(sin mocks) contra frases nuevas. El arreglo `2c4c3b8` sí cerró las tres del
hallazgo de la ronda 9, pero `RECHAZA_AUTOMATIZADO` solo conoce cuatro
sustantivos (`programa|sistema|robot|bot`) y solo pegados a la negación:

```
false  no quiero que un robot decida sobre mi ticket, que lo vea alguien
false  quiero que lo revise un humano y no una maquina, ese comprobante está bien
false  no estoy de acuerdo con que una computadora revise mis comprobantes
false  quiero que alguien de verdad vea mi recibo, no el robot
true   que lo revise una persona, no una máquina      ← (pasa solo por no nombrar papel)
```

La primera trae **las dos señales** que el arreglo declara buscar —rechazo
explícito a lo automatizado ("no quiero que un robot decida") y petición de
humano ("que lo vea alguien")— y da `false`, porque la negación va pegada a
"quiero" y no a "robot". La segunda y la tercera usan "máquina" y "computadora",
que son las palabras que un operador de carretera usa. La cuarta muestra que el
rechazo pospuesto ("…, no el robot") tampoco cuenta.

En la misma corrida, tres formas de cancelación (art. 15 fr. V, la **C** de ARCO)
también dan `false`: `'borren mis datos'`, `'quiero que borren mi información
personal'`, `'ya no quiero que tengan mi teléfono'`. El detector reconoce `'dar de
baja mis datos'` (`:357`) pero no *borrar* ni *eliminar* — una asimetría de
vocabulario, no de diseño.

En los cinco casos el mensaje sigue de largo hacia el agente conversacional
(`processor.ts:264` es el único punto de entrada) y el operador recibe una
respuesta sobre su ticket.

**Consecuencia.** *Para el titular:* la misma que la ronda 9 — el derecho se
pierde sin dejar rastro. El alcance es menor que entonces (la vía que el aviso
induce con sus propias palabras, "no el programa", sí funciona hoy), por eso es
MEDIO y no ALTO.

**Causa raíz probable.** El arreglo se calibró contra las tres frases exactas del
hallazgo anterior en vez de contra la clase de frases, y quedó atado a un
vocabulario cerrado y a una posición fija de la negación.

---

### [BAJO] El anexo de subencargados —al que la política de Likida remite como fuente— no conoce el bloque de autenticación

`docs/conocimiento/52-anexo-subencargados.md:52-64` (la tabla "cadena real") ·
`src/app/privacidad/page.tsx:82` · `src/app/login/page.tsx:59-64,79-88`

**Escenario, con valores.** `/privacidad:82` le dice al contralor: *"El detalle de
esos subencargados está en la documentación del producto **y se actualiza cuando
cambia**"*. La tabla de esa documentación tiene cinco filas: Meta, OpenRouter
(con Google/Anthropic/OpenAI debajo), Supabase, Vercel y Sentry. Desde entonces
entraron dos flujos que no están: el **SMTP de Supabase Auth**, que envía el
magic link con el correo del titular como destinatario (`login/page.tsx:79-88`,
y el propio comentario `:17-18` advierte que "cada intento del camino de email
manda un correo real por el SMTP de Supabase"), y **Google como proveedor de
identidad** vía `signInWithOAuth` (`:59-64`), a quien se le comunica que ese
correo está entrando a Likida. La fila 3 de la tabla describe a Supabase como
"todo lo que se guarda: gastos, montos, folios, RFC, liquidaciones" — no
menciona ni `auth.users` ni el envío de correo.

Aparte, en la misma familia: `FISCAL_LEGAL.md:142` sigue titulando *"Mandar la
foto a un modelo de IA es una transferencia"*, cuando `normas/lfpdppp-2-XII-XX.yaml`
—que es fuente de verdad y corrige expresamente ese análisis— concluye que **no**
lo es, porque el art. 2 fr. XX excluye a la persona encargada. Es el documento
que un abogado del cliente leería primero.

**Consecuencia.** Deuda que cobra factura en la primera due diligence: la
política pública remite a un anexo que ya no describe la cadena, y el documento
resumen contradice a la ficha normativa vigente en el punto exacto sobre el que
descansa todo el análisis de riesgo del rubro.

## Lo que revisé y está bien

- **Los dos cierres de la ronda 9 anclaron.** `dashboard/[id]/page.tsx` no vuelve
  a firmar ligas de comprobante (`grep` de `ligaComprobante` en `src/` → solo su
  definición en `almacen.ts:76`, sin un solo llamador), y `foto_no_expuesta.test.ts`
  vigila la regresión. `RECHAZA_AUTOMATIZADO` funciona para el vector principal
  — corrí las tres frases del hallazgo de la ronda 9 y las tres dan `true`.
- **El pendiente que la ronda 9 no alcanzó: cerrado.** El PDF de liquidación
  **no** incrusta ni enlaza la foto del ticket (`liquidacion/pdf.ts` y las dos
  rutas de `api/export/` no mencionan `imagen`, `foto` ni `ligaComprobante`). El
  segundo canal de salida que se temía no existe.
- **El bucket sigue cerrado.** `0039_bucket_comprobantes.sql` con `public: false`
  y sin policies; `getPublicUrl` no aparece en `src/` (quinta ronda que lo
  verifico). La liga se firma con TTL y nadie la firma hoy.
- **`sanitizarProducto` (`sanitizar.ts:111-119`) sigue descartando el campo
  completo** ante señales de salud, vida sexual o creencias, y su comentario
  sigue siendo honesto sobre su propio límite (`:46-49`).
- **El chat de `/admin` no manda nada a ningún modelo.** `admin/chat.tsx:23-43`
  es coincidencia de palabras clave contra un resumen ya calculado en el
  servidor; no hay ni una llamada a `generateWithTools`/`generateStructured` bajo
  `src/app/admin/` ni bajo `src/app/api/` (verificado por `grep`). `/admin/playground`
  se declara inexistente en vez de simular un sandbox.
- **`getStatsPorOperador` (`analytics.ts:101-135`) —"rendimiento por operador",
  el candidato natural a ranking de personas— sigue sin estar cableado a ninguna
  página**: `grep` en todo `src/` solo lo encuentra en su propia definición. No
  hay evaluación ni score de choferes en pantalla hoy.
- **Custodia de credenciales de portales de terceros: sigue en cero.** Quinta
  ronda consecutiva. `facturacion/permiso_cre.ts` es una tabla pública del CRE.
- **La constancia del art. 16 se escribe con rigor**: reserva y constancia
  separadas (mig. 0033), la constancia solo cuando Meta devolvió un id
  (`processor.ts:196-203`), y liberación de la reserva si el envío falla.
- 114 pruebas del rubro verdes contra HEAD, corridas por mí: `privacidad.test.ts`
  (36), `privacidad_ronda6.test.ts` (37), `aviso_integral.test.ts` (25),
  `app/privacidad/privacidad.test.ts` (6), `foto_no_expuesta.test.ts` (2),
  `provisionar.test.ts` (5), `no_autoregistro.test.ts` (3).

## Lo que NO alcancé a revisar

- **Consentimiento expreso para datos patrimoniales.** El repo sostiene
  (`11-datos-personales.md:105-127`, art. 7 vigente) que un comprobante de gasto
  de un operador identificado es dato patrimonial y exige consentimiento
  **expreso**; el producto solo pone el aviso a disposición y no captura ningún
  acto afirmativo (no existe columna de consentimiento en ninguna migración —
  verificado). Las finalidades necesarias probablemente caen en la excepción del
  art. 9 (relación jurídica), pero las dos "no necesarias" del `:509-511` no
  obviamente. No lo reporto como hallazgo porque no verifiqué el texto del art. 9
  vigente contra fuente primaria y no hay ficha en `normas/` que lo cubra —
  **es el hueco de fichas más caro del rubro hoy**.
- **Retención.** Nada purga `wa_conversacion`, `gasto` ni el bucket
  `comprobantes`; el aviso integral no tiene sección de plazo de conservación
  fuera de los cinco años del CFF. No medí si el art. 11 vigente lo exige en el
  integral con la fuerza que tenía el Regl. art. 30 fr. VII.
- El contrato Likida↔flota y la autorización expresa de subcontratación
  (Regl. arts. 54-55): sigue sin vivir en el repo, mismo estado que las cinco
  rondas anteriores.
- Si el pendiente de "confirmar el régimen de retención de OpenRouter"
  (`52-anexo-subencargados.md`, abierto desde la ronda 8) tiene respuesta fuera
  del repo.
- Un barrido sistemático del resto de las 26 páginas de `/admin`: revisé las que
  importan datos reales (`grep` de imports de `@/lib` sobre los 26 `page.tsx`) y
  las que el encargo nombra; las que solo son texto no las leí una por una.
