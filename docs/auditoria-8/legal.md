# Cumplimiento legal — auditoría 8

**Nota: 6/10** (antes 4). Razón del movimiento: **se atacó y subió**. Los tres
hallazgos abiertos de la ronda 6 están cerrados y lo verifiqué ejecutando el
módulo real, no leyéndolo: `sondearAvisoIntegral` ya la llama alguien que corre
(`src/instrumentation.ts:32` → `startup.ts:230`), el filtro de rellenos ya usa
frontera de palabra (`https://transportistaindependiente.mx/aviso` → `ok`,
medido), y `"me quiero oponer"` → `true`. Encima existe el aviso integral con sus
diez secciones, la reserva dejó de ser la constancia (0033), y el dominio ajeno
salió del PDF. Lo que impide pasar de 6 es que **el camino de revocación y
oposición existe en el texto y no existe en el sistema**: el ancla de 8+ pide
"camino de revocación", y el que hay termina en una línea de `logger.info`.

**El riesgo mayor hoy:** el aviso le promete al operador que si se opone a la
revisión automática "la empresa la hará a mano" y que su solicitud "queda
registrada" — y el producto no tiene tabla, ni columna, ni pantalla, ni efecto
alguno: `atenderPrivacidad` manda un texto y escribe un `info` que nadie
consulta.

**Escala usada.** CRÍTICO = dato personal sale hacia un tercero o subencargado
sin el aviso que lo ampare, o el mecanismo que la ley exige para ejercer un
derecho no lleva a ningún lado real. ALTO = se incumple una obligación de la Ley
por un camino real y nadie se entera.

**Nota metodológica.** Todo se leyó en HEAD (`337e1a8`). Los comportamientos que
afirmo de `privacidad.ts` los medí importando el módulo con `npx tsx`, no
infiriéndolos. La ley citada es la **LFPDPPP vigente (DOF 20-mar-2025, últ.
reforma 14-nov-2025)**, transcrita en `normas/lfpdppp-15-16.yaml`,
`normas/lfpdppp-2-XII-XX.yaml`, `normas/lfpdppp-26-II.yaml` y
`normas/lfpdppp-59.yaml`, las cuatro en `verificado_fuente_primaria`. No hay base
ni red aquí, así que no repetí la comprobación DNS/HTTP de la ronda 6.

---

## Hallazgos

### [CRÍTICO] El único camino de ARCO, revocación y oposición del art. 26 fr. II termina en un `logger.info`, y el aviso le dice al titular que "queda registrada"

`src/lib/cuadra/processor.ts:114-121` · `src/lib/cuadra/privacidad.ts:373` ·
`src/lib/cuadra/privacidad.ts:484-488` · `src/lib/cuadra/privacidad.ts:512` ·
ficha `normas/lfpdppp-26-II.yaml` (`usado_en_codigo: []`)

**Texto de la norma.** Art. 15 fr. V: el aviso debe contener «*los mecanismos,
medios y procedimientos para ejercer los derechos ARCO*». Art. 26 fr. II: el
titular puede oponerse cuando sus datos sean objeto de «*un tratamiento
automatizado… destinados a evaluar, sin intervención humana… su… fiabilidad o
comportamiento*».

**Escenario.** El operador `+521111111101` lee el aviso que Likida le mandó, que
dice literal (`privacidad.ts:222`): *"Esa revisión la hace un programa, sin que
una persona la mire antes. Tienes derecho a oponerte a que se decida así y a
pedir que la revise alguien."* Abre el integral y lee además
(`privacidad.ts:487`): *"Oponerte a esta revisión no detiene tu liquidación: la
empresa la hará a mano."* Escribe `me opongo`. Entra por `pideAtencionPrivacidad`
(medido: `true`) → `atenderPrivacidad` → sale este texto
(`respuestaPrivacidad`, `privacidad.ts:373`): *"Queda registrada tu solicitud
para la empresa."* Lo único que ocurre del lado del sistema es
`logger.info('privacidad.solicitud_operador', { tenantId, operadorId })`
(`processor.ts:120`).

Qué NO ocurre, comprobado con dos búsquedas distintas: no hay tabla de
solicitudes —las 14 `create table` de `supabase/migrations/` son `tenant`,
`app_user`, `terminal`, `operador`, `politica_gasto`, `viaje`, `gasto`,
`liquidacion`, `wa_conversacion`, `wa_mensaje_procesado`, `llm_costo`,
`viaje_lock`, `cfdi_xml`, `codigo_pendiente`—; no hay columna de oposición en
`operador`; `grep -rn "privacidad\|solicitud\|ARCO\|oposicion" src/app/dashboard/`
devuelve cero — el contralor no tiene dónde verla. Y el tratamiento no cambia:
el siguiente viaje del mismo operador vuelve a producir `texto_sospechoso`
(`cuadre/engine.ts:255`) y las demás diferencias de `REVISAR`
(`engine.ts:779`) sin que nadie mire antes; no existe modo manual en
`guardar_liquidacion`. El `info` tampoco llega a Sentry: el pipeline solo replica
`warn` y `error` (`docs/conocimiento/52-anexo-subencargados.md:62`), así que el
único rastro vive en los logs de la plataforma, que rotan.

**Consecuencia.** *Para el titular:* ejerció el derecho por el único medio que el
aviso le ofrece, recibió una confirmación afirmativa, y su oposición no existe en
ningún lado ni cambia nada. *Para la flota (responsable):* en una verificación la
carga de probar que atendió la solicitud es suya, y lo que hay es una línea de
log rotada — peor que no haber ofrecido el canal, porque el aviso documenta por
escrito que lo prometió. Encuadra el art. 58 (omisión de atender ARCO/oposición),
sancionable en el rango del art. 59 fr. III, 200 a 320,000 UMA. *Para Likida:* el
texto del aviso lo escribió Likida y promete un comportamiento que su propio
código no implementa.

**Causa raíz probable.** El aviso se redactó contra el checklist del art. 15 y no
contra lo que el sistema sabe hacer: se escribió el derecho antes que su
almacenamiento.

---

### [CRÍTICO] "Sin aviso no hay tratamiento" se cae cuando dos fotos llegan juntas: perder la reserva se lee como "ya consta", y la foto viaja al modelo externo sin que ningún aviso se haya entregado nunca

`src/lib/cuadra/processor.ts:169` · `supabase/migrations/0033_aviso_reserva_aparte.sql:74-85`
· ficha `normas/lfpdppp-15-16.yaml`

**Texto de la norma.** Art. 16 fr. II: el responsable «*debe poner a disposición
de las personas titulares el aviso de privacidad*» cuando los datos se obtienen
por medio electrónico. El propio `processor.ts:298-302` lo enuncia como
invariante del producto: *"SIN AVISO NO HAY TRATAMIENTO."*

**Escenario, con valores.** Operador `+521111111101`, alta nueva, viaje abierto,
nunca ha recibido el aviso (`aviso_privacidad_en is null`). Manda **tres fotos de
una vez**, que es como un chofer entrega sus tickets. Cada foto es un webhook
distinto y las fotos **no toman el mutex** —está declarado en
`processor.ts:312`, y el mutex se toma hasta `:637`—, así que las tres corren en
paralelo por `ponerAvisoADisposicion` (`:296`).

- Foto 1 gana la reserva: `marcar_aviso_privacidad` pone
  `aviso_privacidad_claim_en = now()` y devuelve `true`.
- Fotos 2 y 3 llaman `reclamarEnvioAviso` dentro de la ventana de 5 minutos. El
  `WHERE` de la 0033 (`0033:78-85`) no toca ninguna fila porque
  `aviso_privacidad_claim_en` está puesto → `tocadas = 0` → `false`.
- `processor.ts:169`: `if (!(await reclamarEnvioAviso(...))) return true;` —
  comentario incluido: *"Ya se le puso a disposición antes"*. Las fotos 2 y 3
  siguen: `downloadMediaAsDataUrl`, `extraerComprobante` → **la imagen viaja a
  Gemini vía OpenRouter** y el gasto se inserta.
- Foto 1 llama `sendText` y Meta la rechaza — el caso `(#131030) Recipient phone
  number not in allowed list`, documentado en este repo con fecha (28-jul-2026,
  `meta/client.ts`) y exactamente el que se repite con números nuevos el día del
  demo. `sendText` devuelve `null`, se llama `liberarEnvioAviso`, se devuelve
  `false`.

Resultado final: dos fotos del operador ya se transfirieron al modelo externo y
dos gastos quedaron escritos; `aviso_privacidad_en` sigue en `NULL` — la base
dice, correctamente, que a ese titular nunca se le puso el aviso a disposición.

**Consecuencia.** *Para el titular:* fue tratado y sus imágenes salieron hacia un
subencargado sin que se le informara nada, en el supuesto que el art. 8 no admite
en ninguna lectura. *Para la flota:* el incumplimiento del art. 16 queda
documentado por su propia base, que es honesta y dice `NULL`. *Para Likida:* es
el único invariante que el producto declara por escrito en este rubro, y se rompe
por el camino más común de uso (varias fotos seguidas).

**Causa raíz probable.** `reclamarEnvioAviso` devuelve **un solo booleano** para
dos hechos distintos —"ya consta" y "otro lo está mandando ahora"—, que es
exactamente la confusión entre reserva y constancia que la 0033 separó en SQL y
que el call site volvió a mezclar.

---

### [ALTO] La respuesta a quien ejerce un derecho ARCO no comprueba que salió, y el log la da por atendida — REINCIDENTE de la auditoría 5

`src/lib/cuadra/processor.ts:118-120` · `src/lib/meta/client.ts:82-96`

**Texto de la norma.** Art. 15 fr. V — el mecanismo ARCO tiene que ser real.

**Escenario.** El operador escribe `PRIVACIDAD`. `atenderPrivacidad` ejecuta
`await sendText(telefono, respuestaPrivacidad(datos));` **sin mirar el valor
devuelto**, y en la línea siguiente escribe
`logger.info('privacidad.solicitud_operador')`. `sendText` devuelve
`string | null` desde `client.ts:82` y ya no lanza: con un 400, un token vencido,
un 429 o el `#131030` de la allowed-list devuelve `null` y deja un
`logger.error('wa.sendText')` que no dice de qué operador era. El titular no
recibe ni la identidad del responsable ni la liga del integral, y el rastro dice
que su solicitud se atendió.

Esto es el mismo defecto que la auditoría 5 marcó CRÍTICO
(`docs/auditoria-5/legal.md:150-152`, *"`atenderPrivacidad` … registra
`privacidad.solicitud_operador` como si se hubiera atendido, sin saber si el
mensaje salió"*). Se arregló **el camino del aviso** —`processor.ts:176-181` sí
mira el `id` y libera— y **no el camino ARCO**, que es el que más pesa.

**Consecuencia.** *Para el titular:* ejerció un derecho, no recibió respuesta y
el sistema afirma que sí. *Para la flota:* prueba falsa de atención en una
verificación. *Para Likida:* el arreglo de la ronda anterior se aplicó a una de
las dos llamadas a `sendText` que dependían de él.

**Causa raíz probable.** El cambio de firma de `sendText` (`void` → `string|null`)
se aprovechó donde había una constancia que escribir, y no donde solo había un
log.

---

### [ALTO] El XML que el producto pide expresamente se descarga y se guarda ANTES de poner el aviso a disposición

`src/lib/cuadra/processor.ts:269-275` (descarga y persiste) vs.
`src/lib/cuadra/processor.ts:296` (donde se pone el aviso) ·
`src/lib/cuadra/repo.ts:75-80` (`saveCfdiXmlRaw`)

**Texto de la norma.** Art. 16 fr. II — el aviso se pone a disposición cuando los
datos se obtienen por medio electrónico.

**Escenario.** Operador dado de alta al que la flota todavía no le asigna viaje —
o al que ya se lo cerraron, que es el caso que el propio comentario de `:262-268`
describe: el mensaje de cierre le pide *"reenvía el XML (el que te manda la
gasolinera por correo)"*. Manda el documento. El flujo es:
`resolveOperador` → `getOpenViaje` devuelve `null` → `:270`
`downloadMediaAsText(mediaId)` descarga el XML desde Meta → `:273`
`saveCfdiXmlRaw(tenantId, uuid, null, xmlText)` lo guarda entero y crudo en
`cfdi_xml` → `return`. `ponerAvisoADisposicion` está treinta líneas más abajo y
**nunca se ejecuta en ese camino**.

El XML crudo no es un dato de la empresa cuando el comprobante es de viáticos: el
propio repo lo dice —*"la exposición personal se concentra en los viáticos
timbrados al RFC del operador"*
(`docs/conocimiento/52-anexo-subencargados.md:139-141`)—, y ahí viajan RFC y
nombre del receptor persona física.

**Consecuencia.** *Para el titular:* obedece una instrucción del producto y su
comprobante queda persistido sin que se le haya informado nada. *Para la flota:*
tratamiento sin aviso, art. 58. *Para Likida:* la barrera "sin aviso no hay
tratamiento" solo cubre la rama con viaje abierto; la rama que el producto mismo
induce se le escapa.

**Causa raíz probable.** El rescate del XML se insertó dentro del corte por "sin
viaje abierto", que está aguas arriba de la puerta del aviso.

---

### [ALTO] `sondearAvisoIntegral` acepta cualquier 200 — es ciego justo al dominio parkeado, que es el modo de falla que este repo ya pagó

`src/lib/cuadra/privacidad.ts:152-159` · `src/lib/cuadra/startup.ts:245-254` ·
`src/lib/dominio_propio.test.ts:16-21`

**Texto de la norma.** Art. 16 fr. II — «*señalar el sitio donde se podrá
consultar el aviso de privacidad integral*».

**Escenario.** Segunda flota, `FLETES DEL BAJÍO SA`, captura
`url_aviso_privacidad = https://fletesdelbajio.mx/aviso` — un dominio que dejó
vencer y que hoy está **parkeado**: responde `200` a cualquier ruta con un
redirect a la página de venta del registrador. `revisarAvisoIntegral` →`ok`
(bien escrito). `sondearAvisoIntegral` hace `HEAD` con `redirect: 'follow'` y
solo comprueba `res.ok` (`:158`) → `{ abre: true }` → `startup.ts:246` registra
`startup.aviso_privacidad { ok: true }`. El operador recibe *"Aviso completo:
https://fletesdelbajio.mx/aviso"* y abre el anuncio de un desconocido desde el
aviso de privacidad de su empresa.

No es hipotético: `dominio_propio.test.ts:16-21` documenta este comportamiento
palabra por palabra sobre `cuadra.mx` — *"responde `200` a cualquier ruta con un
redirect a `/lander`… comprobarlo con `curl -o /dev/null -w %{http_code}` daba
200 y se leía como 'el dominio funciona'"* — y añade *"el daño de un dominio
parkeado es peor que el de uno muerto"*. La lección se convirtió en una prueba de
lista negra sobre el código y **no** en un criterio del sondeo, que sigue
midiendo lo mismo que el `curl` que engañó a todos.

Segundo hueco del mismo mecanismo: `verificarAvisoDePrivacidad` solo sondea
`process.env.DEMO_TENANT_ID` (`startup.ts:231`). Con dos flotas dadas de alta,
la liga de la segunda no se comprueba nunca.

**Consecuencia.** *Para el titular:* no tiene aviso integral ni canal ARCO, y el
producto afirma que sí. *Para la flota:* art. 58 fr. V. *Para Likida:* el paso 4
del plan de mudanza de dominio (`93be38a`: *"`likida.ai` a la landing"*) mueve el
ápice que hoy sirve `/aviso/<tenant>`, y este sondeo es lo único que debería
avisarlo.

**Causa raíz probable.** La comprobación de existencia se definió como "el
servidor contestó" en vez de "esta URL devuelve el documento que se prometió".

---

### [ALTO] El aviso le afirma al titular que los modelos están "contratados con retención cero", y el propio repo lista ese régimen como pendiente de confirmar y sin anexo firmado

`src/lib/cuadra/privacidad.ts:522` · `src/app/privacidad/page.tsx:81` ·
`docs/conocimiento/52-anexo-subencargados.md:188-192` ·
ficha `normas/lfpdppp-2-XII-XX.yaml`

**Texto de la norma.** Art. 14: el responsable debe informar «*la existencia y
características principales del tratamiento*» para que el titular «*pueda tomar
decisiones informadas*». La ficha `lfpdppp-2-XII-XX.yaml` (`impacto_en_producto`)
lo dice sin rodeos: *"NO quita el pendiente contractual: hace falta que el
contrato con la flota autorice la subcontratación y que el de OpenRouter cubra su
propia cadena."*

**Escenario.** El aviso integral que se publica en `/aviso/<tenant>` dice,
literal: *"…y los modelos de lenguaje que leen las fotos, **contratados con
retención cero (no conservan lo que procesan)**"*. La política de Likida repite la
frase en `page.tsx:81`. Lo único que sostiene esa afirmación en el código es
`openrouter.ts:123`, `PROVIDER_OPTS = { provider: { data_collection: 'deny' } }`
— un parámetro de **ruteo** que evita proveedores que recopilan para entrenar; no
es un contrato, no cubre lo que OpenRouter mismo retenga, y no es lo mismo que
"no conservan lo que procesan". Y a tres archivos de distancia, la lista de
pendientes del anexo de subencargados dice: *"1. Anexo de subencargado con
OpenRouter que cubra su cadena… 3. **Confirmar el régimen de retención de
OpenRouter para las imágenes**"* (`52-anexo-subencargados.md:188-192`).

**Consecuencia.** *Para el titular:* toma una decisión informada sobre una
afirmación de hecho que nadie ha verificado. *Para la flota:* es **ella** quien
publica ese aviso como responsable; si la Secretaría pide el contrato que
respalda "retención cero", no existe. *Para Likida:* redactó una declaración
contractual por cuenta de su cliente sobre un contrato que no ha firmado.

**Causa raíz probable.** El texto del aviso se escribió con la intención de
diseño (`data_collection: 'deny'`) tratada como si fuera el hecho contractual.

---

### [MEDIO] La política de Likida se declara responsable y no dice quién es ni dónde está — art. 15 fr. I

`src/app/privacidad/page.tsx:36-43` · `src/app/privacidad/page.tsx:136`

**Texto de la norma.** Art. 15 fr. I: el aviso deberá contener «*la identidad y
domicilio del responsable*».

**Escenario.** `RESPONSABLE.razonSocial = null`, `domicilio = null`. La página
—que es la que va a apuntar `privacy_policy_url` de la app de Meta, según su
propio encabezado (`page.tsx:19-23`)— se sirve igual y pinta un recuadro que
dice *"Falta capturar la razón social y el domicilio fiscal de la empresa que
opera Likida"* (`:162`). Quien quiera ejercer un derecho tiene el correo
`likida.ai@gmail.com` y nada más: ni persona moral a la que emplazar, ni
domicilio donde presentarse por escrito, que es el otro medio que la propia
página ofrece (`:99` remite a escribir al correo; el domicilio no existe).

**Consecuencia.** *Para el titular (el contralor, el lead):* no puede emplazar a
nadie. *Para la autoridad:* art. 58 fr. V, omisión de un elemento del art. 15, en
el único aviso donde **Likida** es la responsable — este sí es riesgo propio, no
del cliente. *Para Likida:* se publica como política oficial ante Meta.

**Causa raíz probable.** El dato es de negocio y no de código; el hueco está
anotado a propósito, lo que lo baja a MEDIO pero no lo quita: la página se sirve
igual.

---

### [MEDIO] El aviso integral cita el Reglamento de la ley abrogada como fundamento, sin ficha que verifique que sigue vigente

`src/lib/cuadra/privacidad.ts:510` (`fundamento: 'LFPDPPP art. 7 último párrafo;
Reglamento art. 21'`) · `src/lib/cuadra/privacidad.ts:394` ·
`FISCAL_LEGAL.md:147` (`art. 52 del Reglamento`) · `normas/` (22 fichas, **cero**
sobre el Reglamento)

**Texto de la norma.** La `nota_verificacion` de `normas/lfpdppp-2-XII-XX.yaml`
fijó el criterio de la casa: *"CORRIGE el análisis previo, que apoyaba la
conclusión en la figura de 'REMISIÓN'. Esa palabra NO aparece ni una vez en la
ley vigente: venía del Reglamento de la ley abrogada. **Citarla ante un cliente
es citar derecho derogado.**"*

**Escenario.** La sección *"Cómo revocar tu consentimiento"* del aviso integral
se sirve en una página pública con el fundamento impreso debajo del título
(`app/aviso/[tenant]/page.tsx:117` pinta `s.fundamento`), y ese fundamento es
`LFPDPPP art. 7 último párrafo; Reglamento art. 21`. El Reglamento de 2011 es el
de la ley abrogada el 21-mar-2025. Ninguna de las 22 fichas de `normas/` verifica
su vigencia bajo la ley nueva — lo comprobé por listado del directorio y por
búsqueda de `reglamento` en los YAML. El mismo repo que se autocorrigió por
apoyarse en el Reglamento derogado lo imprime hoy delante del titular.

**Consecuencia.** *Para el titular:* un fundamento que puede no existir. *Para la
autoridad:* en una verificación, una cita muerta en el aviso resta credibilidad a
todo el documento. *Para Likida:* es el error de método que este repo ya
diagnosticó por escrito y ahora reincide en otro archivo. Lo mismo aplica a
`FISCAL_LEGAL.md:142-160`, cuya §2.3 titula *"Mandar la foto a un modelo de IA es
una transferencia"* — contradicción directa con la ficha verificada, que concluye
lo contrario por la definición del art. 2 fr. XX — y apoya su exigencia de
retención cero en el art. 52 del mismo Reglamento.

**Causa raíz probable.** Las fichas de `normas/` cubren la Ley y no el
Reglamento, así que las citas reglamentarias entran al producto sin pasar por el
mismo filtro que las legales.

---

### [MEDIO] La cláusula de transferencias dice que los modelos "leen las fotos", y también leen la conversación completa del operador

`src/lib/cuadra/privacidad.ts:522` · `src/lib/agents/run.ts:40-48` ·
`docs/conocimiento/52-anexo-subencargados.md:56-58`

**Texto de la norma.** Art. 15 fr. II y art. 14 — informar qué datos se someten a
tratamiento y las características principales de éste.

**Escenario.** El aviso integral enumera los subencargados y de los modelos dice
solo *"los modelos de lenguaje que **leen las fotos**"*. Pero `runAgent` manda a
OpenRouter `messages: opts.history` — los turnos de la conversación de WhatsApp,
hasta 12 (`conv.ts:152`), que son las palabras del operador— más los resultados
de las tools (montos, folios, RFC, diferencias). El propio anexo lo tabula así:
*"OpenRouter, Inc. | Las fotos (OCR) **y el texto de la conversación**"*, y
*"Anthropic | El texto del cuadre"*. La sección "Qué datos se tratan" del aviso sí
enumera *"El contenido de tus mensajes"* (`privacidad.ts:463`), pero la de
transferencias —la que le dice al titular **por dónde pasa** cada cosa— lo omite.

**Consecuencia.** *Para el titular:* cree que a los modelos solo van sus fotos;
también va lo que escribe. *Para la flota:* la enumeración de encargados de su
aviso es incompleta respecto de la cadena real que Likida documentó. *Para
Likida:* la discrepancia está entre dos archivos suyos, uno de los cuales es el
documento público.

**Causa raíz probable.** La sección se redactó pensando en el OCR, que es el
camino visible, y no en el ciclo de tools.

---

### [BAJO] El detector no reconoce la forma más natural de pedir cancelación: "borren mis datos"

`src/lib/cuadra/privacidad.ts:324` · `src/lib/cuadra/privacidad.ts:283-303`

**Escenario, medido con el módulo real:**

```
"me quiero oponer"        -> true
"quiero que lo revise una persona" -> true
"borren mis datos"        -> false
"quiero que me borren"    -> false
"me quiero dar de baja"   -> false
```

La lista incluye la frase exacta `dar de baja mis datos` pero no sus variantes
naturales, y la **C** de ARCO —cancelación— es el derecho que un operador pide
con esas palabras. El mensaje no entra por `atenderPrivacidad`: sigue al agente
conversacional, que no tiene manejo de ARCO.

**Refutación que intenté y por qué queda en BAJO:** el aviso instruye
explícitamente *"escribe **PRIVACIDAD** por WhatsApp"* (`privacidad.ts:494`,
`:503`), así que quien sigue las instrucciones sí es atendido. Lo reporto porque
la lista ya intenta cubrir lenguaje natural para oposición y para baja, y deja
fuera la conjugación más frecuente de una de las dos.

**Consecuencia.** Un ejercicio de cancelación se pierde sin rastro.

---

### [BAJO] `cuadra.mx` sigue vivo como fixture del test del aviso integral

`src/lib/cuadra/aviso_integral.test.ts:27` (`urlAvisoIntegral:
'https://cuadra.mx/aviso/11111111-…'`) · `src/lib/pruebas/codigo.ts:46-55`

El guardarraíl `dominio_propio.test.ts` excluye las pruebas a propósito
(`fuentesDeProduccion` filtra `.test.`), así que el dominio ajeno —parkeado y de
un tercero— sobrevive precisamente en el archivo que sirve de plantilla para el
siguiente aviso que alguien escriba. No sale hacia ningún usuario hoy;
lo anoto como deuda con nombre y apellido.

---

## Inventario de salidas de datos personales

| Qué dato | A dónde sale | ¿Lo cubre el aviso? | Dónde lo dice |
|---|---|---|---|
| Teléfono y nombre del operador | Meta (WhatsApp Cloud API) | **Sí** | `privacidad.ts:463` (qué datos) + `:522` ("proveedor de mensajería de WhatsApp") |
| Foto del comprobante (data-URL completa) | OpenRouter → Google/Anthropic/OpenAI | **Sí** | `privacidad.ts:522` — pero con la afirmación no respaldada de "retención cero" (ALTO arriba) |
| Texto de los mensajes del operador (hasta 12 turnos) | OpenRouter → modelo del rol `cuadre` | **Parcial** | Declarado como dato tratado (`:463`); **omitido** en la cláusula de transferencias (`:522`) — MEDIO arriba |
| Montos, folios, RFC, diferencias (resultado de tools) | OpenRouter, dentro del ciclo agéntico | **Parcial** | igual que el renglón anterior |
| Gastos, liquidaciones, `ocr_extra` | Supabase | **Sí** | `privacidad.ts:522` ("el de alojamiento de la base de datos") |
| XML CFDI crudo (puede traer RFC/nombre del operador en viáticos) | Supabase (`cfdi_xml`) | **Sí en general; NO en la rama sin viaje abierto**, donde se guarda antes del aviso | ALTO arriba, `processor.ts:269-275` |
| UUID, montos y contexto de error | Sentry | **Sí**, y con RFC/teléfono borrados y UUID huellado | `logger.ts:11-47`, `52-anexo-subencargados.md:64-83` |
| UUID, RFC emisor/receptor, total | SAT (`consultaqr…sat.gob.mx`) | **Sí** | `privacidad.ts:523` ("a la autoridad fiscal cuando la ley lo exige") |
| Nombre del operador, montos, diferencias | CSV de export y PDF | **Sí** — es la finalidad primaria | `privacidad.ts:472-474`; export tras passcode (`api/export/liquidaciones/route.ts:19-20`) |
| Razón social, domicilio y contacto art. 29 de la flota | Página pública `/aviso/<tenant>` | **Sí**, por obligación del art. 15 fr. I y art. 29 | `app/aviso/[tenant]/page.tsx:13-31` razona el alcance |
| Credenciales de portales de terceros | **Ninguna** — no existen | n/a | verificado abajo |

---

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 6 está cerrado de verdad, no solo tocado.**
  `src/instrumentation.ts:32` llama `verificarAvisoDePrivacidad`, y
  `startup.ts:230-245` importa y ejecuta `sondearAvisoIntegral`. Ya no es código
  muerto. (Su criterio de éxito es demasiado laxo — ALTO arriba —, pero el
  cableado que faltaba existe.)
- **Los dos ALTOS de la ronda 6 están cerrados, medidos con el módulo real.**
  `privacidad.ts:112-121` cambió el `includes` por frontera de palabra:
  `https://transportistaindependiente.mx/aviso` → `ok` (antes `inservible`);
  `http://localhost:3000/aviso/x` → `inservible`. Y `privacidad.ts:294` añadió la
  perífrasis: `"me quiero oponer"` → `true`, `"no me quiero oponer"` → `true`.
- **La reserva dejó de ser la constancia.** `0033_aviso_reserva_aparte.sql`
  separa `aviso_privacidad_claim_en` (con TTL de 5 min) de `aviso_privacidad_en`,
  `liberar_aviso_privacidad` (`0033:127-140`) ya **no** puede borrar una
  constancia buena, y `confirmar_aviso_privacidad` es lo único que la escribe,
  solo tras un `wamid` de Meta (`processor.ts:176-186`). La migración además se
  niega a "limpiar" filas históricas por si acaso (`0033:148-155`), que es la
  decisión correcta.
- **El aviso integral existe y trae los diez elementos.** Lo ejecuté: art. 15
  fr. I, II, III, IV, V, VI + art. 26 fr. II + art. 7/Reglamento (revocación) +
  art. 35 (transferencias) + art. 29 (marcado `[PENDIENTE]` cuando la flota no ha
  designado contacto, `privacidad.ts:530`). El hueco se enseña al titular
  (`app/aviso/[tenant]/page.tsx:100-112`) en vez de rellenarse.
- **Los dos documentos no se confunden.** `/privacidad` (Likida responsable) y
  `/aviso/[tenant]` (flota responsable) están separados y cada uno remite al otro
  (`page.tsx:52-55` y `:179-182`). Es la distinción correcta del art. 14 vs.
  art. 2 fr. XII, y estaba pendiente desde la ronda 5.
- **Ninguna liga que salga hacia un usuario nombra un dominio ajeno.**
  `grep` sobre `src/` y `supabase/`: `cuadra.mx` solo sobrevive en comentarios y
  en un fixture de prueba; `pdf.ts:393` imprime `likida.ai`; `openrouter.ts:31`
  usa `NEXT_PUBLIC_APP_URL || 'https://likida.ai'`; `seed.sql:55` apunta a
  `https://likida.ai/aviso/<tenant>`, y el comentario de `seed.sql:46-52`
  explica por qué **no** se adelantó a `app.likida.ai` (hoy da 404). El
  razonamiento es correcto y está documentado.
- **Las dos páginas de privacidad son públicas.** `src/proxy.ts:27` solo cierra
  `/dashboard`; `/aviso/*` y `/privacidad` no pasan por el gate. Un aviso detrás
  de un login no estaría "puesto a disposición", y no lo está.
- **`/aviso/[tenant]` no filtra más de lo que debe.** `getDatosResponsable`
  (`repo.ts:435`) selecciona cuatro columnas y no trae RFC, plan ni config; un id
  sin forma de UUID no llega a la base (`page.tsx:62`) y `notFound()` no
  distingue "no existe" de "está a medias" (`:69`).
- **Toda salida hacia un modelo pasa por un solo archivo y lleva
  `data_collection: 'deny'`.** `grep` de `completions.create` fuera de
  `llm/openrouter.ts` devuelve cero; las tres funciones
  (`:142`, `:293`, `:512`) hacen spread de `PROVIDER_OPTS`, incluidos los caminos
  de fallback. La objeción es sobre lo que ese parámetro *significa* (ALTO
  arriba), no sobre su cableado.
- **El filtro de datos sensibles sigue cableado y cubre el hueco de la
  presentación pegada al número.** `sanitizar.ts:81` usa `(^|[^a-z])` a la
  izquierda: `"VITACILINA 10TAB"` ya no se guarda. El límite honesto —protege lo
  que se persiste, no la imagen que ya viajó— sigue escrito en `:46-49`.
- **Las fotos no se almacenan.** Solo se guarda su hash
  (`0014`/`0015`/`0027`); lo único que va al bucket es el PDF, y el bucket es
  privado (`0008:4-5`) servido con `createSignedUrl` de 1 h
  (`processor.ts:880`). El historial de conversación está acotado a 12 turnos
  (`conv.ts:152`, `:184`, `:230`).
- **No hay bóveda de credenciales ni automatización de portales.** Repetí las dos
  búsquedas de rondas anteriores (`e\.?firma|fiel|ciec|contraseña|credencial|csd|\.key`
  y `puppeteer|playwright|selenium|chromium|captcha|browserbase|stagehand`) sobre
  `src/`, `supabase/` y `package.json`: cero. Sigue siendo la mejor decisión de
  producto de este rubro, y `getStatsPorOperador` (`analytics.ts:71`) —el único
  ranking de personas del repo— no lo llama nadie: verificado con `grep`, es
  código muerto y por eso no lo cuento como hallazgo.

## Lo que sigue igual (confirmado, no es hallazgo nuevo — así lo pide el MAPA)

- Razón social, domicilio y RFC del tenant siguen siendo los `🔴 INVENTADO` del
  seed. No es arreglable en código y ya está anotado.
- El cierre sigue sin intervención humana: `normas/lfpdppp-26-II.yaml` conserva
  `usado_en_codigo: []`. El aviso ahora nombra el derecho en los dos documentos;
  lo que falta es que ejercerlo haga algo (CRÍTICO #1).

## Lo que NO alcancé a revisar

- **La red.** No hay salida a Internet en esta sesión: no repetí el `host`/`curl`
  contra `likida.ai`, `app.likida.ai` ni contra la liga del tenant. Todo lo que
  digo del dominio sale del código y de los commits, no de una resolución hecha
  hoy.
- **La base de producción.** Sin credenciales; no pude leer `tenant` para
  confirmar el valor vigente de `url_aviso_privacidad` ni si
  `contacto_privacidad` ya está capturado. La ronda 6 sí pudo.
- **Los logs de Vercel/Sentry.** Pendiente desde la ronda 5. En particular no
  pude medir cuánto sobrevive un `privacidad.solicitud_operador` real, que es el
  dato que decidiría si el CRÍTICO #1 es "rastro corto" o "sin rastro".
- **El contrato Likida–flota y el anexo con OpenRouter.** No viven en el repo;
  siguen siendo los pendientes 1 y 2 de `52-anexo-subencargados.md:188-191`.
- **Si el Reglamento de 2011 sobrevive bajo la ley de 2025.** Requiere leer los
  transitorios del DOF 20-mar-2025, que no puedo descargar aquí. Por eso el
  hallazgo del Reglamento es MEDIO y está redactado como "sin ficha que lo
  verifique", no como "cita derogada".
