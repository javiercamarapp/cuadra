# Cumplimiento legal — auditoría 11 (pase 2)

**Nota: 5/10** (antes 3). Razón del movimiento: **se atacó y subió**. Los cuatro
hallazgos del pase 1 que no dependían de una decisión humana se cerraron, y los
verifiqué uno por uno abriendo el archivo de hoy: el teléfono y la transcripción
íntegra del operador ya no salen de `/admin` (seudónimo en `negocio.ts:279`,
redacción en `:291-307`, y una prueba de grep que impide que `.telefono` vuelva a
`src/app/admin` — `negocio_seudonimo.test.ts:137`); la cita legal que sostenía
todo el análisis se corrigió (`privacidad.ts:570` ya dice **art. 2 fr. XII**, no
la fr. XX) y el fundamento en el Reglamento de la ley abrogada se retiró
(`privacidad.ts:632`); el aviso de la flota ya se enlaza desde el panel
(`chrome.tsx:78`) y desde `/mis-viajes` (`page.tsx:170`); y el detector de ARCO
reconoce hoy las trece frases que en el pase 1 daban `false` (medido con el
módulo real, ver §"Lo que revisé").

No sube más porque el producto siguió creciendo por el lado que el aviso no
describe: **la migración 0047 y `operacion.ts` construyen un expediente por
chofer —incidencias con descripción libre, entregas sin evidencia, % comprobado
frente a su patrón— y el catálogo del aviso integral sigue diciendo "tu nombre y
tu número de teléfono"** (`privacidad.ts:577`). Y el único derecho que este
producto activa por sí mismo sigue aterrizando en un `logger.info` que ninguna
persona de la flota puede leer.

**El riesgo mayor del rubro, hoy:** el aviso que el operador acepta describe un
producto que ya no existe — uno que solo recibe fotos de tickets por WhatsApp —
mientras el que corre acumula juicios sobre él, ordenados y comparables contra
sus compañeros.

Compuerta medida por mí sobre esta rama: `npx tsc --noEmit -p .` → exit 0.
`npx vitest run` → 2,530 pruebas, corrida **dos veces**: la primera con 4 fallos,
la segunda con 1. El único que se repitió es `normas/fundamento.test.ts:144`, una
aserción de reloj de pared (`expect(mejor).toBeLessThan(500)`) — o sea sensible a
la carga de la máquina, no al código, y los otros tres desaparecieron al correr
sola la suite. No es mi rubro medirlo; lo anoto porque el MAPA declara la
compuerta verde y aquí sale intermitente, y una compuerta intermitente es una que
nadie va a mirar cuando de verdad se ponga roja.

---

## Hallazgos

### [ALTO] REINCIDENTE — El expediente operativo por chofer creció otra ronda y el catálogo del aviso sigue siendo "nombre y teléfono"

`supabase/migrations/0047_operacion_encargado.sql:97-118` (tabla `incidencia`) ·
`:127-146` (tabla `pod`, con `operador_id`) · `src/lib/cuadra/operacion.ts:26-39`
(`CargaOperador`: `sinPod`, `incidenciasAbiertas`) · `:47-107` ·
`src/app/dashboard/despacho/vista.tsx:120-125` · `src/lib/cuadra/analytics.ts:491-541`
· `src/app/dashboard/operadores/page.tsx:107-131` · contra
`src/lib/cuadra/privacidad.ts:574-596` · ficha: `normas/lfpdppp-15-16.yaml`

**Texto de la ficha** (`normas/lfpdppp-15-16.yaml:14-20`, transcrito literal):
> "Artículo 15. El aviso de privacidad deberá contener, al menos, la siguiente
> información: […] II. Los datos personales que serán sometidos a tratamiento,
> identificando aquéllos que son sensibles; III. Las finalidades del tratamiento
> de datos personales, distinguiendo aquéllas que requieren el consentimiento de
> la persona titular;"

**Texto del aviso que se incumple**, transcrito del documento que el operador
abre en `/aviso/[tenant]`:
> `privacidad.ts:577` "Tu **nombre** y tu **número de teléfono**."
> `privacidad.ts:579` "El **contenido de tus mensajes** en esa conversación, y
> los **viajes y liquidaciones** en los que participas."
> `privacidad.ts:594` "Cualquier finalidad que no esté escrita aquí requiere que
> te vuelvan a pedir permiso. La ley vigente ya no permite ampararse en usos
> «compatibles o análogos»."

Las finalidades declaradas (`:587-593`) son cinco: liquidar viajes, comprobar
ante el SAT, responder por WhatsApp, detectar comprobantes repetidos o alterados,
y medir el uso del servicio. **Ninguna dice operación, incidencias, evidencia de
entrega ni desempeño.**

**Escenario, con valores.** El encargado abre `/dashboard/incidencias` y levanta
una contra el viaje `VJ-2026-0117` de Juan Pérez: `crearIncidencia` inserta
`tipo = 'faltante'` (dominio del constraint `incidencia_tipo_dominio`,
`0047:110-111`), `descripcion = "faltaron 3 tarimas en la entrega de Monterrey"`
(`operacion.ts:686-693`), y `viaje_id` — y el viaje tiene `operador_id`, así que
la incidencia queda atribuida a una persona identificada.

Al día siguiente, en `/dashboard/despacho`, `getCargaOperadores`
(`operacion.ts:47-107`) cuenta por operador los viajes sin POD y las incidencias
no resueltas, y `vista.tsx:120-125` pinta esta tabla, encabezado por encabezado:

| Operador | Carga | En curso | **Sin POD** | **Incidencias** | Estado |
|---|---|---|---|---|---|
| Juan Pérez | ▇▇▇▇ | 4 | 2 | 1 | Activo |

Y en `/dashboard/operadores` (`page.tsx:107-113`) la misma persona aparece con
**Operador · Teléfono · Viajes · Anticipo · Comprobado · % comprobado**, más su
número de empleado (`:121-123`), alimentado por `getOperadoresDetalle`
(`analytics.ts:491-541`).

Eso es fiabilidad operativa (incidencias), cumplimiento documental (POD) y
situación económica frente a su patrón (% comprobado). Son datos nuevos, para
finalidades nuevas, y el titular no se entera: el aviso no las menciona y no se
le reenvía nada — `versionAviso` (`privacidad.ts:255-262`) hashea el texto
armado con razón social, domicilio y liga del integral, y levantar una incidencia
no mueve ninguno de los tres, así que el reenvío del art. 15 fr. VI no dispara.

**Refutación que intenté, y una que se sostiene.** ¿Es el supuesto del art. 26
fr. II? **No.** La ficha `normas/lfpdppp-26-II.yaml:18-23` transcribe:
> "II. Sus datos personales sean objeto de un tratamiento automatizado […] y
> estén destinados a evaluar, **sin intervención humana**, determinados aspectos
> personales de la misma o analizar o predecir, en particular, su rendimiento
> profesional, situación económica, […] fiabilidad o comportamiento."

El vocabulario de la fracción describe estas tres columnas casi palabra por
palabra, pero la incidencia la teclea un humano y la lee un humano que decide:
el supuesto no se activa hoy. Lo digo aunque me quite el hallazgo más grande. La
otra refutación: ¿no lo cubre "los viajes y liquidaciones en los que participas"?
Un viaje es un hecho del trabajo; un contador de entregas que el chofer no
entregó y una descripción libre de lo que hizo mal son un juicio sobre quien lo
hizo.

**Consecuencia.** *Para el titular:* su patrón acumula un historial de conducta
sobre él del que el documento legal que le entregaron no dice una palabra, y de
ahí sale el descuento que el art. 110 fr. I de la LFT
(`normas/lft-110-111-263.yaml:12-17`) limita. *Para la flota ante la autoridad:*
aviso incompleto en dos fracciones del art. 15, con rastro documental que lo
prueba — las filas de `incidencia` contra el texto del aviso. *Para Likida:* el
argumento de venta "la flota cumple con solo usarnos" produce hoy un aviso más
corto que su propio producto, tercera ronda consecutiva.

**Causa raíz probable.** Añadir una tabla que describe a una persona no tiene
como paso obligado revisar el módulo que declara qué se trata y para qué.

---

### [ALTO] REINCIDENTE — La fotografía del usuario del panel no está en el catálogo de `/privacidad`, y la promesa publicada de borrado de cuenta no tiene una sola línea de código detrás

`supabase/migrations/0046_perfil_avatar.sql:10,17-19,42-45` ·
`src/app/admin/mi-perfil/acciones.ts:44-83` · `src/lib/admin/negocio.ts:369-377`
· contra `src/app/privacidad/page.tsx:61,90,109` · ficha: `normas/lfpdppp-15-16.yaml`,
`normas/lfpdppp-2-XII-XX.yaml`

**Texto de la ficha** (`normas/lfpdppp-15-16.yaml:17-18`, transcrito):
> "II. Los datos personales que serán sometidos a tratamiento, identificando
> aquéllos que son sensibles;"

Y (`normas/lfpdppp-2-XII-XX.yaml:16-18`, transcrito):
> "XX. Transferencia: Toda comunicación de datos personales dentro o fuera del
> territorio mexicano, realizada a persona distinta de la titular, del
> responsable o de la persona encargada del tratamiento."

**Dimensionamiento primero, porque el bucket público es decisión humana ya
tomada.** Lo que el pase 1 reportó como estructural se atacó a medias y hay que
decirlo: `acciones.ts:56` ya usa **ruta fija sin extensión** (`${userId}/avatar`),
así que subir un `.png` encima de un `.jpg` deja de producir objetos públicos
huérfanos; `avatar-validacion.ts:52-60` valida tamaño (4 MB) y tipo contra lista
blanca de tres MIME, con `image/svg+xml` explícitamente fuera; y
`negocio.ts:369-372` sube con el `contentType` que elige el servidor, no el que
manda el cliente. Todo eso es real y lo verifiqué línea por línea.

**Lo que queda, y no es decisión de nadie:**

1. **El catálogo del aviso.** `/privacidad` es el documento donde Likida es
   responsable (`page.tsx:52`), y su art. 15 fr. II dice, textual (`:61`):
   > "Tu **nombre**, tu **correo** y tu **teléfono**."

   Fotografía no aparece. Ni ahí ni en `privacidad.ts:577-580`, que además
   afirma "**No se tratan datos sensibles.** Ni […] ni **datos biométricos**" —
   afirmación que hay que volver a mirar el día que la columna se abra al rol
   `operador`, cosa que la propia migración anuncia en su encabezado
   (`0046:1-4`: *"la columna vive en `app_user` así que cualquier rol la puede
   usar el día que su propio panel tenga edición de perfil"*).

2. **La promesa de borrado que nada cumple.** El mismo documento publica
   (`page.tsx:105-110`):
   > `:90` "Tus datos de cuenta, mientras tengas el servicio y **hasta un año
   > después de darlo de baja**."
   > `:109` "**Se borran** tus datos de cuenta y de acceso." — sección "Cómo
   > pedir que se borre tu cuenta", cuyo `fundamento` declarado (`:106`) es
   > *"Requisito de Meta para apps en producción"*.

   Verificado hoy sobre este árbol: `grep -rn "storage.*remove\|\.delete()"` en
   `src/` devuelve **dos** resultados y ninguno borra a nadie
   (`repo.ts:548` y `conv.ts:452`, que libera el claim de un mensaje). Los dos
   `deleteUser` que existen (`provisionar.ts:105`, `autoregistro.ts:69`) son
   compensaciones de alta fallida, no un camino que un titular pueda pedir. No
   hay purga de `wa_conversacion`, ni del bucket `comprobantes`, ni del bucket
   `avatares`.

**Escenario, con valores.** Javier abre `/admin/mi-perfil`, sube `foto.jpg`.
`negocio.ts:374` llama `getPublicUrl` y `:56` de `acciones.ts` guarda la URL en
`app_user.avatar_url`. Resultado:
`https://<proyecto>.supabase.co/storage/v1/object/public/avatares/<uuid>/avatar`
devuelve su cara a cualquiera con la cadena, sin sesión y sin cabecera; y la
policy `avatares_lectura_publica … for select **to public**` (`0046:42-45`) deja
además al rol `anon` enumerar el bucket, cuyas carpetas son los `auth.uid()` de
todos los usuarios. Si mañana pide que se borre, el producto no tiene con qué:
existe la policy `avatares_propio_delete` (`0046:37-40`) —el titular *podría*
borrarlo con un cliente de Supabase en la mano— pero ninguna pantalla la ejerce.

**Por qué ALTO y no CRÍTICO hoy.** Lo digo sin adornarlo: el único titular con
foto es Javier, dueño de Likida, que es quien tomó la decisión del bucket
público, y esa decisión está registrada. La exposición se vuelve CRÍTICA el día
uno en que un contralor o un chofer suba la suya, sin que nadie tenga que tocar
una línea para que ocurra.

**Consecuencia.** *Para el titular:* su cara queda en la web abierta sin que
ningún documento del producto lo diga, y el camino de supresión que la política
promete por escrito no existe en el producto. *Para Likida frente a la autoridad:*
es responsable de estos datos (lo declara `/privacidad:52`), hay comunicación a
terceros indeterminados (art. 2 fr. XX) sin base en el catálogo del art. 15 fr.
II, y un plazo de conservación publicado que ningún mecanismo puede cumplir.
*Para la due diligence:* la sección de borrado de cuenta está publicada como
requisito de Meta y es la primera que un revisor abre.

**Causa raíz probable.** La mitad de ingeniería del hallazgo (huérfanos,
validación, `contentType`) tuvo dueño; la mitad documental —catálogo y
conservación— no es de ningún archivo de `src/`, así que no la arregló nadie.

---

### [ALTO] REINCIDENTE — Ejercer el derecho sigue sin producir efecto: ni registro que la empresa pueda ver, ni cambio en el tratamiento automatizado

`src/lib/cuadra/processor.ts:130-147` · `src/lib/cuadra/privacidad.ts:483,603,610`
· `src/lib/cuadra/analytics.ts:133-155` · `src/lib/logger.ts:148-150` ·
ficha: `normas/lfpdppp-15-16.yaml`, `normas/lfpdppp-26-II.yaml`

**Texto de la ficha** (`normas/lfpdppp-15-16.yaml:21-24`, transcrito):
> "IV. Las opciones y medios que el responsable ofrezca a las personas titulares
> para limitar el uso o divulgación de los datos; V. Los mecanismos, medios y
> procedimientos para ejercer los derechos ARCO, de conformidad con lo dispuesto
> en esta Ley, y"

**Texto del aviso que se incumple**, tres afirmaciones de hecho, transcritas:
> `privacidad.ts:483` "**Queda registrada tu solicitud para la empresa.** Tu
> liquidación sigue igual, esto no la afecta. 👍"
> `privacidad.ts:610` "Escribe **PRIVACIDAD** por el mismo chat de WhatsApp. **Tu
> solicitud queda registrada para la empresa** y tu liquidación sigue igual."
> `privacidad.ts:603` "Oponerte a esta revisión no detiene tu liquidación: **la
> empresa la hará a mano**."

**Escenario, con valores.** Juan escribe `PRIVACIDAD`. Corrí
`pideAtencionPrivacidad` con el módulo real de HEAD (bundle de `esbuild`, sin
mocks): devuelve `true`. `processor.ts:283` desvía a `atenderPrivacidad`, se
manda `respuestaPrivacidad` —que le dice las tres frases de arriba— y **el
registro completo de su ejercicio es esta línea** (`processor.ts:137-138`):

```ts
// Rastro para la flota: es ELLA quien tiene que resolver el ARCO.
logger.info('privacidad.solicitud_operador', { tenantId, operadorId });
```

Un `logger.info`. Verificado hoy sobre este árbol: no hay tabla ni columna de
solicitudes —`grep -rniE "solicitud|arco|consentimiento|oposicion|retencion"`
sobre `supabase/migrations/` solo devuelve las columnas del **envío** del aviso
(0018, 0033, 0034), nunca de su **ejercicio**—; ninguna de las ~31 páginas de
`/dashboard` las muestra (`grep -rn "privacidad.solicitud\|solicitudes"` sobre
`src/app/` → cero); y `logger.ts:148` solo replica a Sentry los niveles `warn` y
`error`, así que la línea **ni siquiera sale del proceso**. La empresa, que tiene
20 días hábiles para contestar (plazo que el propio aviso publica en
`privacidad.ts:620`), no se entera nunca de que corren.

La tercera promesa tampoco se cumple: `detectarAnomalias`
(`analytics.ts:133-155`) lee **todos** los `gasto` del tenant, sin predicado por
operador y sin bandera de oposición —porque esa bandera no existe en el esquema—,
así que el comprobante de Juan vuelve a pasar por la revisión automatizada y su
resultado vuelve a llegarle a la empresa.

**Refutación que intenté.** ¿No basta con que Likida sea persona encargada y le
toque a la flota resolver? La ficha `normas/lfpdppp-2-XII-XX.yaml:11-12` dice que
la encargada trata "por cuenta del responsable" — exactamente por eso el producto
tiene que **entregarle** la solicitud al responsable, y el aviso que Likida
redacta y aloja afirma por escrito que eso ocurre. Es la afirmación la que falla,
no el reparto de roles.

**Consecuencia.** *Para el titular:* ejerce el único derecho que este producto
activa por sí mismo, recibe un acuse que afirma un estado que no se produce, y
nada cambia. *Para la flota:* incumple plazos sin saber que corren y no tiene con
qué acreditar que atendió. *Para Likida:* la constancia del art. 16 se guarda con
esmero (migs. 0018/0033, reserva y constancia separadas); la del ejercicio del
derecho, que es la primera que pide un verificador, no se guarda en absoluto.

**Causa raíz probable.** Se construyó con cuidado la mitad de entrada del canal
ARCO (detección determinística, respuesta, constancia del envío) y la mitad de
salida —dónde aterriza, quién la ve, qué apaga— nunca se modeló.

---

### [MEDIO] El correo de un usuario sale sin redactar hacia Sentry, y el anexo que la política pública señala como "el detalle de esos subencargados" afirma lo contrario

`src/lib/auth/provisionar.ts:106-118` · `src/lib/logger.ts:49-57,65,93-99,148-150`
· contra `docs/conocimiento/52-anexo-subencargados.md:61,63-72` y
`src/app/privacidad/page.tsx:81-82` · ficha: `normas/lfpdppp-15-16.yaml`

**Texto de la ficha** (`normas/lfpdppp-15-16.yaml:9-12`, transcrito):
> "Artículo 14. El responsable tendrá la obligación de informar a la persona
> titular, a través del aviso de privacidad, la existencia y características
> principales del tratamiento al que serán sometidos sus datos personales, a fin
> de que pueda tomar decisiones informadas al respecto."

**Lo que el documento publicado afirma.** `/privacidad:82` remite por escrito:
> "El detalle de esos subencargados está en la documentación del producto y se
> actualiza cuando cambia."

Y ese anexo dice de Sentry (`52-anexo-subencargados.md:61`, fila de la tabla):
> "| 5 | **Sentry** | Solo `warn` y `error`, **ya redactados** | …"

y lo detalla (`:63-72`): *"se alimenta del `logger`, que antes de emitir **borra**
el RFC y el teléfono y **sustituye** el UUID por una huella"*, y *"RFC y teléfono
se borran (`[RFC]`, `[TEL]`)"*.

**Escenario, con valores.** El superadmin da de alta al contralor
`contralor@transportesinnovativos.mx` desde `/admin/usuarios/nuevo`. El
`createUser` de Auth funciona y el `insert` en `app_user` falla (un `tenant_id`
que ya no existe, un 503 de PostgREST). `provisionar.ts:106-113` emite:

```ts
logger.error('provisionar.huerfano', { msg: '…', userId, email, err, errBorrar });
```

`logger.ts:65` construye su redactor con **tres** reglas: `UUID | RFC | PHONE`
(`:49-57`). Ninguna casa un correo. Medido con el módulo real de HEAD (bundle de
`esbuild`, sin mocks):

```
"contralor@transportesinnovativos.mx" -> "contralor@transportesinnovativos.mx"
"Juan Pérez"                          -> "Juan Pérez"
"+5219993700779"                      -> "+[TEL]"
"XAXX010101000"                       -> "[RFC]"
```

Y `logger.ts:148-150` replica a Sentry todo `error` y `warn`. Sale, entonces, el
correo íntegro. La segunda rama (`:115-118`, `provisionar.compensado`) hace lo
mismo en `warn`, y esa es la que se dispara en el caso normal.

**Refutación que intenté.** (a) *¿No está Sentry declarado?* Sí — `/privacidad:81`
lo cubre como "monitoreo de errores" entre las personas encargadas, y `:61` sí
lista el **correo** en el catálogo. Por eso esto es MEDIO y no un CRÍTICO de
transferencia sin cobertura: el destinatario y el dato están declarados. Lo que
es falso es el **control** que el documento describe. (b) *¿No es de operabilidad?*
El defecto de redacción sí; lo que reporto es que un documento al que la política
pública remite por escrito describe una salvaguarda que el código no aplica, y
eso es lo que un auditor de datos personales verifica primero. (c) *¿Es
alcanzable?* `provisionar.ts` es el único camino de alta del producto y lo corre
un superadmin; las dos ramas están cubiertas por `provisionar.test.ts:110,121`,
que afirman literalmente el `email` en el log.

**Consecuencia.** *Para el titular:* un dato de contacto suyo sale del sistema en
claro hacia un tercero, contra lo que el documento que lo describe promete.
*Para Likida:* el anexo es lo que se entrega en una due diligence, y el
desmentido está a un `grep` de distancia.

**Causa raíz probable.** El redactor se calibró contra los datos **fiscales** que
el canal de WhatsApp mueve (RFC, teléfono, UUID) y el bloque de autenticación
metió una categoría —el correo— que ese inventario nunca contempló.

---

### [MEDIO] REINCIDENTE — El panel del cliente sigue afirmando por escrito que el correo no vive en `app_user`, y dos archivos más allá se inserta ahí

`src/app/dashboard/usuarios/page.tsx:52-55` · contra `src/lib/auth/provisionar.ts:99`
· `src/lib/admin/negocio.ts:383-388` · ficha: `normas/lfpdppp-15-16.yaml`

**Texto de la ficha:** art. 15 fr. II — *"Los datos personales que serán
sometidos a tratamiento"* (`lfpdppp-15-16.yaml:17-18`).

**El texto que sigue ahí**, palabra por palabra (`dashboard/usuarios/page.tsx:52-55`):
> "El correo NO se muestra: **vive en `auth.users`** (el esquema de Auth), **no en
> `app_user`**, y traerlo aquí obligaría a leer con service-role una tabla de
> credenciales para pintar una columna de cortesía."

**Es falso, y se comprueba en el mismo repo.** `provisionar.ts:99`:

```ts
const { error: errInsert } = await admin.from('app_user').insert({
  id: userId, tenant_id: tenantId, email, nombre: nombre ?? null, rol,
```

Y `negocio.ts:383-388` (`getCorreoPerfil`) lo lee de ahí:
`from('app_user').select('email')`.

**Escenario, con valores.** Alguien va a completar el catálogo del art. 15 fr. II
—que es exactamente el trabajo que este rubro lleva tres rondas pidiendo— abre
la pantalla que enumera a los usuarios de la flota, lee que el correo "no está en
`app_user`", y no lo agrega al aviso. Es el mecanismo por el que un hueco
documental se conserva: no porque nadie mire, sino porque quien mira encuentra
escrita la respuesta equivocada.

**Refutación que intenté.** ¿Se salva porque `/privacidad:61` sí lista el correo?
Para el usuario del panel, sí — por eso es MEDIO. Para el operador no: el
catálogo de su aviso (`privacidad.ts:577-580`) no lo incluye, y `app_user` admite
rol `operador` (`provisionar.ts:52`). Hoy ese alta **truena** antes de escribir
—`provisionar.ts:62-66` exige `operador_id` y el formulario de
`/admin/usuarios/nuevo:33` llama sin él—, así que el correo de un chofer no puede
entrar por el producto. Es deuda con fecha, no incumplimiento presente, y por eso
no lo reporto como ALTO.

**Consecuencia.** *Para la flota:* la revisión del aviso se hace contra un mapa
del modelo de datos que no corresponde al modelo de datos.

**Causa raíz probable.** El comentario se escribió cuando era cierto y sobrevivió
al refactor de auth que movió el correo a `app_user`; nada lo ata al esquema.

---

### [MEDIO] REINCIDENTE (residual) — La suplantación de flota deja rastro en la página y no lo deja en la API

`src/app/api/dashboard/asistente/route.ts:42-48` · contra
`src/lib/auth/tenant-efectivo.ts:62-73` · `src/lib/cuadra/privacidad.ts:570` ·
ficha: `normas/lfpdppp-2-XII-XX.yaml`, `normas/lfpdppp-15-16.yaml`

**Texto de la ficha** (`normas/lfpdppp-2-XII-XX.yaml:11-12`, transcrito):
> "XII. Persona encargada: Persona física o jurídica que sola o conjuntamente con
> otras trate datos personales **por cuenta del responsable**;"

**Texto del aviso que se afirma** (`privacidad.ts:570`, pintado en `/aviso/[tenant]`):
> "Likida […] es **persona encargada** (art. 2 fr. XII), trata los datos por
> cuenta de la empresa y **siguiendo sus instrucciones**, y no decide sobre
> ellos."

**Lo que se cerró, y lo verifiqué.** `tenant-efectivo.ts:70-73` ya emite
`logger.info('tenant.suplantacion', { userId, tenant, ruta })` cada vez que un
superadmin resuelve `?tenant=` sobre una página, y `:62-66` registra además el
caso en que la consulta falla. El pase 1 decía "no queda una sola línea en ningún
log" y eso ya no es verdad para el camino de las páginas.

**Escenario, con valores.** Lo que queda es el otro camino. El rail "Asistente de
negocio" se monta en el layout de las ~31 páginas y consulta
`/api/dashboard/asistente?tenant=8f3c…`. `route.ts:45-48`:

```ts
if (pedido && sesion.rol === 'superadmin') {
  const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', pedido).maybeSingle();
  if (t) { tenantId = t.id as string; tenantNombre = t.nombre as string; }
}
```

El archivo **no importa el logger** (`grep -c logger` sobre él → 0), así que ese
salto de flota no deja nada escrito, y devuelve `kpis`, `acred` y `anomalias` de
la flota ajena (`:77-83`). Además descarta el `error` por valor, que es el patrón
que `pg.ts:16-26` llama la familia de bugs más repetida del repo.

**Refutación que intenté.** (a) *¿No es rubro de seguridad?* La autorización
funciona —solo superadmin, uuid validado contra la tabla— y no la reporto. Lo que
reporto es que la afirmación "siguiendo sus instrucciones" del aviso queda sin
evidencia por esta vía, y que un ARCO de acceso (art. 15 fr. V, "quién ha visto
mis datos") no se puede contestar completo. (b) *¿Es dato personal lo que sale?*
`anomalias` viaja recortado a `{ detalle, monto }` (`:101`) y los KPI son cifras
del tenant, no de una persona — por eso baja de ALTO a MEDIO respecto del pase 1.

**Consecuencia.** *Para la flota:* tiene la mitad del rastro que necesita para
demostrar ante un verificador que los accesos de su proveedor fueron por
instrucción suya. Media bitácora no es una bitácora.

**Causa raíz probable.** El arreglo se hizo sobre `tenant-efectivo.ts`, que es
donde vive la regla, y la copia de esa regla que el handler de API tiene escrita
a mano (`:12-15` lo dice: *"con el mismo criterio que `resolverTenantEfectivo`"*)
no la heredó.

---

### [BAJO] REINCIDENTE — El anexo de subencargados no conoce dos destinos activos ni el bucket público

`docs/conocimiento/52-anexo-subencargados.md:53-61` · contra
`src/app/login/acciones.ts:67-72` (Google), `:89` (magic link) y
`supabase/migrations/0046_perfil_avatar.sql:17-19` · ficha: `normas/lfpdppp-2-XII-XX.yaml`

La tabla "La cadena real" (`:53-61`) tiene cinco filas: Meta, OpenRouter
(+Google/Anthropic/OpenAI), Supabase, Vercel, Sentry. Verificado hoy por grep,
faltan tres destinos que sí existen en el código:

- **El SMTP de Supabase Auth**: `acciones.ts:89` llama `signInWithOtp`, o sea un
  correo con el magic link hacia el correo del titular.
- **Google como proveedor de identidad**: `acciones.ts:71-72` llama
  `signInWithOAuth({ provider: 'google' })`. En la tabla Google solo aparece como
  subproveedor de OpenRouter para visión (`:57`), que es otra relación distinta.
- **El bucket público `avatares`** (`0046:17-19`), que no es un subencargado sino
  algo distinto: un destino abierto.

**Consecuencia.** *Para la due diligence:* la política pública remite a este
anexo por escrito (`/privacidad:82`) y el anexo ya no describe la cadena.

---

### [BAJO] REINCIDENTE (parcial) — El documento comercial sigue fundando su análisis en el Reglamento de la ley abrogada

`FISCAL_LEGAL.md:179-196`, `:250` · ficha: `normas/lfpdppp-2-XII-XX.yaml`

**Lo que se cerró:** el título de §2.3 ya dice *"Mandar la foto a un modelo de IA
**no** es una transferencia, pero sí es una subcontratación"* (`:152`), y el
párrafo cita la fr. XX correctamente y remite a la ficha (`:170-177`). Era lo que
el pase 1 reportó primero.

**Lo que queda.** Inmediatamente después, `:179`:
> "El **art. 52 del Reglamento** pone condiciones para usar cómputo en la nube."

y siete requisitos colgados de él (`:181-193`), más `:250`:
> "LFPDPPP (vigente 21-mar-2025) y su Reglamento, art. 52"

La `nota_verificacion` de la ficha (`lfpdppp-2-XII-XX.yaml:29-33`, transcrita)
marca esa clase de cita:
> "Esa palabra NO aparece ni una vez en la ley vigente: venía del **Reglamento de
> la ley abrogada**. **Citarla ante un cliente es citar derecho derogado.**"

**Consecuencia.** *Para Likida:* siete requisitos que el documento le exige a sus
proveedores están colgados de una norma que ya no está vigente. No es que los
requisitos sean malos; es que su fuente no se sostiene si alguien la abre.

---

### [BAJO] REINCIDENTE — La 0047 tiene abiertas las dos columnas de geolocalización del chofer, y la pantalla afirma que no se guarda una sola coordenada

`supabase/migrations/0047_operacion_encargado.sql:133-134` · `:190` (policy
`operador_sube_su_pod`) · contra `src/app/dashboard/mapa/page.tsx:19` y
`src/lib/cuadra/privacidad.ts:577` · ficha: `normas/lfpdppp-15-16.yaml`

`pod` nace con `lat double precision` y `lng double precision` (`0047:133-134`) y
la RLS ya autoriza al chofer a insertar el POD de sus propios viajes (`:190`).
Hoy nada las escribe —lo verifiqué: `grep -rn "\blat\b|\blng\b"` sobre `src/` no
devuelve un solo uso, y `proxy.ts:30` incluso manda
`Permissions-Policy: geolocation=()`—, así que el rótulo de `/dashboard/mapa:19`
(*"El sistema **no guarda una sola coordenada**"*) es cierto **hoy**. Lo que
reporto es que el día que el flujo de subida del POD mande la posición del
teléfono, entra la ubicación de una persona identificada, el catálogo del aviso
sigue diciendo "nombre y teléfono", y esa página seguirá afirmando lo contrario
— sin que nadie tenga que tocar el aviso para que ocurra.

**Consecuencia.** Deuda con fecha: la primera escritura a esas columnas convierte
un rótulo verdadero en falso y añade una categoría de dato sin declarar.

---

## Lo que revisé y está bien

- **El teléfono y la transcripción íntegra salieron de `/admin` de verdad, no en
  la prosa.** Seguí la cadena hasta el consumidor: `negocio.ts:317-337`
  (`getConversacionesActivas`) ya no devuelve `telefono` —el tipo lo prohíbe
  (`:234-241`, con el comentario *"NUNCA el teléfono"*)—, convierte en el borde
  con `seudonimoOperador` (`:279-287`) y pasa cada turno por `redactarTexto`
  (`:303-308`, que tapa correo, RFC, CURP y teléfono). Los cinco consumidores
  pintan el seudónimo: `conversaciones/page.tsx:53,73` (incluida la etiqueta del
  `HBars`, que era el hallazgo). `grep -rn "telefono" src/app/admin/` → **cero
  resultados**, y `negocio_seudonimo.test.ts:137` es una prueba de grep que lo
  mantiene así. El propio comentario declara su límite sin adornarlo
  (`negocio.ts:266-273`: *"no es anonimización irreversible… la sal es una
  constante del código"*), que es la forma correcta de documentar una medida.
- **Las dos citas legales del aviso publicado están corregidas.**
  `privacidad.ts:570` dice **art. 2 fr. XII** (era la fr. XX, la definición de
  transferencia), `/privacidad:53` igual, y `privacidad.ts:626-632` retiró
  `Reglamento art. 21` **sin sustituirlo a ojo**, razonándolo: *"cuál es su
  equivalente en la ley vigente no lo respalda ninguna ficha, y ponerlo a ojo
  sería el mismo error al revés"*. Esa es exactamente la disciplina que el rubro
  pide.
- **El aviso ya está enlazado desde el producto.** `chrome.tsx:76-84` pone
  "Aviso de privacidad" → `/aviso/${tenantId}` en el pie del sidebar de las ~31
  páginas de `/dashboard`, y `mis-viajes/page.tsx:162-171` hace lo mismo con su
  razón escrita. El pase 1 reportó que ninguna pantalla lo enlazaba; hoy lo
  enlazan las dos superficies con sesión.
- **El detector de ARCO aprendió las palabras que faltaban.** Corrí
  `pideAtencionPrivacidad` con el módulo real de HEAD (bundle de `esbuild`, sin
  mocks). Los ocho casos que el pase 1 documentó en `false` dan `true` hoy —
  "no quiero que un robot decida…", "…y no una maquina", "no estoy de acuerdo con
  que una computadora revise…", "borren mis datos", "quiero que borren mi
  información personal", "ya no quiero que tengan mi teléfono". La causa está en
  `privacidad.ts:291` (`ACTOR_AUTOMATIZADO` ahora incluye `maquina|computadora|
  algoritmo`) y `:405-411` (`CANCELACION` conoce `borr|elimin|quit|supri`).
  Residual anotado, no reportado: la **A** y la **R** de ARCO siguen fuera
  ("quiero ver mis datos", "corrijan mi nombre" → `false`), pero el mecanismo que
  el aviso documenta (`privacidad.ts:619`: *"escribe PRIVACIDAD por WhatsApp"*)
  sí funciona, así que no hay incumplimiento presente.
- **La foto del comprobante sigue sin salir por ningún lado.** El bucket
  `comprobantes` sigue privado (`0039`), `dashboard/[id]/page.tsx:93-99` conserva
  el comentario que explica por qué no se enseña y sigue sin enseñarla, y
  `pod/page.tsx:31` aplica el mismo criterio a la evidencia de entrega. Séptima
  ronda que se verifica.
- **`getPublicUrl` sigue apareciendo una sola vez en `src/`** y solo para
  `avatares` (`negocio.ts:374`). Los otros dos usos de Storage son subida a
  `liquidaciones` (`tools.ts:261`) y `createSignedUrl` con 60 s
  (`processor.ts:1663`), que es lo correcto.
- **`sanitizarProducto` está en el camino que corre, no solo en el archivo.**
  Lo seguí: `ocr.ts:480` la llama sobre `data.producto` antes de que nada se
  persista, y `sanitizar.ts:111-119` descarta el campo entero ante señales de
  salud, vida sexual o creencias. Su comentario sigue siendo honesto sobre su
  propio límite (`:46-49`: la foto ya viajó al modelo).
- **Toda la salida hacia modelos externos está declarada.** Los únicos dos sitios
  que salen a OpenRouter siguen siendo `intake/ocr.ts:327` y `agents/run.ts:45`;
  `api/dashboard/asistente/route.ts` no llama a ningún modelo (verificado por
  grep sobre `src/app/`). `PROVIDER_OPTS = { provider: { data_collection: 'deny' } }`
  (`openrouter.ts:239`) se aplica en las **tres** llamadas del módulo (`:285`,
  `:445`, `:741`), que es lo que el aviso afirma en `privacidad.ts:650` (*"a los
  que en cada llamada se les pide explícitamente que no retengan"*) — la
  afirmación y el código coinciden.
- **El PDF de liquidación se genera en proceso.** `liquidacion/pdf.ts:9` usa
  `pdf-lib`; no hay navegador headless ni servicio externo de render, así que el
  nombre del operador y las cifras no salen por ahí. Y `grep -rn "facturapi"` en
  `src/` → cero: no hay un timbrador recibiendo datos sin declarar.
- **`/aviso/[tenant]` sigue bien construida**: valida forma de UUID antes de
  consultar, `notFound()` indistinguible para no ser un detector de flotas,
  `robots: noindex` (`page.tsx:35-39`), y `getDatosResponsable` no trae RFC ni
  config.
- **La RLS de la 0047 excluye al chofer de `unidad`, `mantenimiento` e
  `incidencia`** (`:157-183`), así que un chofer no ve las incidencias de sus
  compañeros; la excepción de `pod` está acotada a sus propios viajes
  (`:187-190`) y sin borrado.
- **Custodia de credenciales de portales de terceros: sigue en cero.** Séptima
  ronda. No hay tabla, columna ni variable de entorno con credenciales del SAT,
  IMSS o de un portal de cliente.
- **Sentry se inicializa con `sendDefaultPii: false`** (`sentry.ts:89`) y razona
  por qué: el enriquecimiento automático adjunta IP y cabeceras que el redactor
  no ha visto. Es la decisión correcta.

## Lo que NO alcancé a revisar

- **Consentimiento expreso para datos patrimoniales.** Sigue siendo el hueco de
  fichas más caro del rubro: `FISCAL_LEGAL.md:144-151` afirma que los gastos de
  un operador identificado exigen consentimiento **expreso** y el producto no
  captura ningún acto afirmativo (verificado: no hay columna de consentimiento en
  ninguna migración). No lo reporto porque **no hay ficha en `normas/` que cubra
  el art. 7 ni el art. 9 vigentes**, y el único documento que lo razona se apoya
  en el reglamento abrogado. Con el expediente por chofer que entró esta ronda,
  la pregunta pesa más que antes. **Es el hueco de catálogo que la ronda 12
  debería llenar primero.**
- **`reportarExcepcion` no redacta su `contexto`.** `sentry.ts:195-208` pasa
  `{ ...contexto, digest }` crudo a `captureException`, sin `redactMeta` —solo el
  mensaje y el stack pasan por `anonimizar` (`:172-179`)—. Hoy el único llamador
  es `instrumentation.ts:75-79`, que manda ruta, tipo y método, así que no vi un
  valor personal saliendo por ahí y no lo reporto como hallazgo. Es un borde
  abierto: el siguiente llamador que pase un identificador lo saca en claro.
- **Si `wa_mensaje_procesado`** (que no tiene `tenant_id`) retiene algo del
  contenido del mensaje además del id de Meta.
- **`mantenimiento.descripcion` y `unidad`** (`0047:73-96`): los leí para el
  modelo de datos pero no audité si una orden de trabajo puede acabar
  describiendo la conducta del chofer. Es el mismo vector que la incidencia, un
  campo más allá.
- **El contrato Likida↔flota** y la autorización expresa de subcontratación:
  sigue sin vivir en el repo, séptima ronda igual.
- **Un barrido de las ~31 páginas de `/dashboard` y las ~30 de `/admin`** una por
  una: revisé las que mueven datos de personas (`operadores`, `despacho`,
  `incidencias`, `pod`, `usuarios`, `mapa`, `[id]`, `mi-perfil`,
  `conversaciones`, `notificaciones`) y las que el encargo nombra.
