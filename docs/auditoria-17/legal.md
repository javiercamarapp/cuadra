# Cumplimiento legal — auditoría 17

**Nota: 4/10** (antes 7). Razón del movimiento: **mirada más profunda** sobre
caminos que las rondas anteriores no habían recorrido. Los tres abiertos que me
tocaban están, dos de ellos, cerrados de verdad (ARCO sí se ve en `/dashboard`;
`vence_en` usa 20 y no 15), pero al abrir el camino del chofer que manda fotos
**antes** de que la oficina le abra el viaje aparece el supuesto que este mismo
repo declara inadmisible: la foto se descarga, se guarda y se remite al modelo
externo sin que el aviso se haya puesto a disposición. Y de los cuatro derechos
ARCO que el aviso promete, tres no tienen ni compuerta que los reconozca ni
código que los ejecute.

**El riesgo mayor de hoy:** el bloqueo "sin aviso no hay tratamiento" solo
protege la rama con viaje abierto; la rama sin viaje —la que el propio código
documenta como el caso más común del chofer real— manda la imagen del
comprobante a OpenRouter antes de que exista aviso ni constancia.

---

## Hallazgos

### [CRÍTICO] La foto viaja al modelo externo antes del aviso cuando no hay viaje abierto
`src/lib/likida/processor.ts:470` (apertura de `if (!viajeId)`), `:522`, `:524`,
`:525`, `:602` (cierre de la rama) y `:636` (donde por fin se llama a
`ponerAvisoADisposicion`).

Escenario: operador `o1` de la flota `t1`, dado de alta hoy, con
`operador.aviso_privacidad_en = NULL`. Termina ruta a las 21:40, la oficina aún
no le abre viaje, y manda sus 11 fotos de golpe —el caso que el comentario de
`:513-517` describe con esas palabras—. `processInbound` resuelve al operador
(`:467`), `getOpenViaje` devuelve `null`, y dentro de esa rama, para cada foto:
`downloadMediaAsDataUrl` (`:522`) baja la imagen, `subirComprobante` (`:524`) la
persiste en el bucket, y `extraerComprobante` (`:525`) la manda a
OpenRouter → Gemini. Recién en `:636`, ciento sesenta líneas después y solo si
hubo viaje, se ejecuta el bloqueo `avisoPuesto !== 'puesto'`.

Consecuencia: once imágenes de comprobantes de una persona física identificada
—montos, fechas, folios, plaza, y lo que salga en la foto— salen del país hacia
un subencargado sin que el titular haya recibido el aviso simplificado que el
art. 16 fr. II exige "cuando los datos sean obtenidos por medio electrónico". Es
literalmente lo que `processor.ts:206-209` declara como el motivo de existir del
bloqueo: *"la foto se descargaba y se mandaba a un modelo externo igual. Eso es
una transferencia de datos personales sin el aviso que la ampare"*. Ante la
autoridad la carga de probar la puesta a disposición es del responsable —la
flota— y en este camino no hay ni fila que la sostenga.

Causa raíz probable: la rama "la foto tampoco se tira" se agregó después del
bloqueo y quedó por encima de él en el orden de ejecución; el único test que
ejercita el bloqueo (`aviso_bloqueo.test.ts:24`) mockea
`getOpenViaje: async () => 'v1'`, así que el camino sin viaje nunca se mide.

---

### [ALTO] "Que borren mis datos" no abre el canal ARCO: la compuerta es más angosta que el clasificador
`src/lib/likida/privacidad.ts:351-361` (`pideAtencionPrivacidad`) contra
`:602-609` (`tipoDeSolicitudArco`).

Escenario: el operador escribe `quiero que borren mis datos`. La compuerta pide
`privacidad` | `arco` | `mis datos personales` | `dar de baja mis datos`, o uno
de los patrones de oposición. Ninguno casa: la frase dice "mis datos", no "mis
datos personales". `pideAtencionPrivacidad` devuelve `false`, el mensaje cae al
agente conversacional, no se inserta nada en `solicitud_arco` y no se manda
`respuestaPrivacidad`. Mientras tanto `tipoDeSolicitudArco:604` tiene una rama
de cancelación entrenada para `borr…`, `elimin…`, `suprim…`, `quita mis datos`,
`ya no usen`, `ya no traten` — vocabulario que la compuerta rechaza, así que esa
rama es inalcanzable salvo que la misma frase traiga además una de las cuatro
llaves. Mismo resultado con `quita mis datos` y `ya no usen mis datos`.

Consecuencia: el derecho de cancelación —el que ejerce quien se acaba de ir de
la flota— no se registra, la flota no se entera, y el plazo del art. 31 no
empieza a correr porque nadie sabe que hay solicitud. El titular cree que pidió
la baja.

Causa raíz probable: la compuerta se calibró para la palabra clave que el aviso
enseña (`PRIVACIDAD`) y para la oposición (auditorías 6, 8 y 9); el clasificador
de tipo se escribió después, contra el lenguaje natural, y nadie cruzó las dos
listas.

---

### [ALTO] La revocación del consentimiento que el aviso enseña con esas palabras no la detecta nada
`src/lib/likida/privacidad.ts:546` (el texto: *"Puedes **retirar tu
consentimiento** en cualquier momento"*) contra `:351-361`.

Escenario: el operador abre el integral en `/aviso/<tenant>`, lee la sección
"Cómo revocar tu consentimiento" y contesta por el chat `quiero retirar mi
consentimiento` (o `revoco mi consentimiento`, o `ya no doy mi consentimiento`).
Ninguna de las tres casa con la compuerta: no hay `privacidad`, ni `arco`, ni
`mis datos personales`, ni `opon…`, ni `oposicion`, ni el patrón
`no (quiero|autorizo|acepto) que … (revisen|analicen|usen|traten)`. El mensaje
va al agente, que le contesta sobre su viaje.

Consecuencia: art. 7 último párrafo y Reglamento art. 21 exigen que la
revocación se pueda hacer **por el mismo medio** y de forma sencilla y gratuita.
El producto anuncia el medio y luego no escucha las palabras que él mismo puso
en la boca del titular. Es exactamente el fallo que la auditoría 6 corrigió para
la oposición (`:286-293` lo razona), dejado abierto para la revocación.

Causa raíz probable: `OPOSICION` se amplió con las conjugaciones reales del
español hablado; la revocación nunca recibió el mismo tratamiento y se apoyó
solo en que el titular teclee la palabra clave.

---

### [ALTO] La oposición al tratamiento automatizado se registra y no apaga nada
`src/lib/likida/privacidad.ts:516-522` (la promesa), `src/lib/likida/repo.ts:877-900`
(el registro), `src/lib/likida/repo.ts:976-1007` (la resolución). Ningún otro
archivo de `src/` lee `solicitud_arco`: solo `admin/compliance/page.tsx` y
`dashboard/arco/page.tsx`, las dos pantallas que la listan.

Escenario: el operador escribe `me opongo a que un programa revise mis
comprobantes`. La compuerta sí lo reconoce, se inserta
`solicitud_arco(tipo='oposicion', estado='recibida')` y se le contesta que su
solicitud queda registrada. Al día siguiente manda sus fotos: `cuadrarViaje`, el
cotejo de hash contra sus viajes anteriores y las diferencias corren idénticos,
y el mismo veredicto automatizado llega al contralor. No existe columna en
`operador`, ni bandera en `tenant.config`, ni lectura de `solicitud_arco` en el
camino del cuadre que cambie una sola decisión.

Consecuencia: el aviso integral dice, con negritas, *"tienes derecho a oponerte
a que se decida así"* y *"oponerte a esta revisión no detiene tu liquidación: la
empresa la hará a mano"*. La segunda frase describe un comportamiento que el
producto no tiene y que tampoco le ofrece a la flota una palanca para producir.
Es el único derecho que este producto activa por sí mismo (art. 26 fr. II) y es
el que menos efecto tiene.

Causa raíz probable: el trabajo de las rondas 12-16 se concentró en registrar y
mostrar la solicitud; ejecutarla quedó implícitamente delegada a "la flota lo
hará a mano", sin que el panel tenga con qué.

---

### [ALTO] Nada borra: la cancelación se "resuelve" escribiendo un texto
`src/lib/likida/repo.ts:985-1007` (`resolverSolicitudArco`),
`src/app/privacidad/page.tsx:104-108` ("Cómo pedir que se borre tu cuenta").
Los únicos `.delete()` de producción en todo `src/` son
`api/stripe/webhook/route.ts:82` (eventos), `repo.ts:548` (código pendiente),
`administracion.ts:440` (liquidación) y `conv.ts:628` (claim de idempotencia).

Escenario: llega una solicitud de cancelación (por la vía que sí funciona: el
titular escribió `dar de baja mis datos`). El contralor abre `/dashboard/arco`,
teclea `Se eliminaron sus datos` y aprieta Responder. `resolverSolicitudArco`
marca `estado='resuelta'`, guarda esa frase como `resolucion` y manda al titular
`Tu solicitud de derechos ARCO fue atendida por FLOTA DEMO SA DE CV: Se
eliminaron sus datos`. Las filas de `operador`, `gasto`, `conversacion` y los
objetos del bucket `comprobantes` quedan intactos: no hay una sola ruta de
supresión ni de bloqueo en el producto.

Consecuencia: el sistema produce y entrega al titular una afirmación falsa sobre
el ejercicio de su derecho, y deja en la base una constancia de "resuelta" que
es justamente la prueba que la flota exhibiría en una verificación. La misma
página `/privacidad` promete a los usuarios de Likida un borrado de cuenta que
tampoco tiene implementación.

Causa raíz probable: la resolución se modeló como un campo de texto libre
(igual que un ticket de soporte) sin distinguir que dos de los cuatro derechos
—cancelación y rectificación— exigen una operación sobre los datos, no una nota.

---

### [ALTO] La flota nunca se entera a tiempo: no hay aviso de solicitud nueva, y el único indicador se enciende el día del vencimiento
`src/app/dashboard/arco/page.tsx:71` y `:87`.

```
const vencenPronto = solicitudes.filter((s) => … && venceEn(s.venceEn) <= hoy);
…
<KpiTile etiqueta="Vencen pronto (≤ 5 días)" valor={vencenPronto.length} />
```

Escenario: solicitud recibida el 8-ago-2026 → `vence_en = venceArco(hoy)` = 20
días hábiles = 2026-09-04. El 2026-09-02, con dos días para responder, el filtro
`venceEn <= hoy` da `false` y el mosaico rotulado "Vencen pronto (≤ 5 días)"
muestra **0**. Solo el 2026-09-04 —el día del vencimiento— pasa a 1, y a partir
del 5 sigue contando como "vence pronto" algo ya vencido. Y no hay nada más: el
repo tiene cron de escalación de viajes sin aceptar (`api/cron/escalar`) que
manda WhatsApp al jefe de flota en menos de una hora, pero para una solicitud
ARCO no hay correo, ni WhatsApp, ni badge; depende de que alguien entre a la
página. (`admin/compliance/page.tsx:180` sí usa una ventana, pero de 5 días
**naturales** bajo el rótulo "≤ 5 días hábiles".)

Consecuencia: el rótulo miente en la dirección que cuesta —dice "no hay nada
próximo a vencer" cuando queda un día— y el mecanismo que sí existe para cosas
menos graves (un viaje sin aceptar) no existe para el plazo que la ley impone al
responsable.

Causa raíz probable: el umbral se escribió como "vencidas o vencen hoy" y el
rótulo se copió del panel de `/admin`, que sí resta 5 días; nadie comparó los
dos.

---

### [ALTO] Likida publica su propio aviso de privacidad y su contrato sin decir quién es el responsable
`src/app/privacidad/page.tsx:40-41` (`razonSocial: null`, `domicilio: null`) y
`src/app/terminos/page.tsx:36-40` (lo mismo para el prestador y la jurisdicción).

Escenario: el 6-ago el contralor abre `app.likida.ai/privacidad` —la URL que
Meta exige para sacar la app de `dev_mode`— y lee, arriba de todo, el recuadro
"Falta capturar la razón social y el domicilio fiscal de la empresa que opera
Likida". Ahí Likida no es encargada: es **responsable** de los datos del
contralor (nombre, correo, teléfono, RFC de su empresa, registros de uso), y el
art. 15 fr. I es el primer elemento del aviso. En `/terminos`, §1 dice que
entrar al panel equivale a aceptar un contrato cuyo obligado no tiene nombre.

Consecuencia: el único elemento que este repo trata como innegociable para una
flota —`getDatosResponsable` devuelve `null` y `/aviso/[tenant]` responde 404 si
falta la razón social— se publica con el hueco cuando el responsable es Likida.
Frente a la autoridad, el aviso del responsable incumple la fr. I; frente al
comprador, es lo primero que se ve en la sala.

Causa raíz probable: los datos son de Javier y nunca se capturaron; se eligió
declarar el hueco (criterio correcto del repo) pero sin bloquear la publicación,
que es lo que sí se hace en el caso simétrico.

---

### [ALTO] Upstash/QStash recibe filas completas de `gasto` y no aparece en ningún documento legal
`src/app/api/cron/facturar/route.ts:312-322` y el tipo `FilaCola` en `:161-171`;
`docs/conocimiento/52-anexo-subencargados.md:52-62` (la cadena declarada, cinco
subencargados, sin Upstash); `src/lib/likida/privacidad.ts:562` y
`src/app/privacidad/page.tsx:79` (las enumeraciones que se le dan al titular).

Escenario: con `UPSTASH_QSTASH_TOKEN` puesto en producción (ronda 16, commits
`4568121`, `4cd1eb4`, `88a0ee6` "verificación end-to-end del cron"), cada
corrida del cron de facturación hace
`q.publishJSON({ url: …/cola, body: { lote, quedaron } })` hacia
`qstash-us-east-1.upstash.io`, con hasta 8 filas de `gasto` que llevan
`id, tenant_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra`.
`ocr_extra` es el contenido leído del comprobante del operador. QStash conserva y
muestra el cuerpo del mensaje en su consola.

Consecuencia: un subencargado nuevo, en EE. UU., que retiene el cuerpo, y que no
está en el anexo que sostiene la autorización de subcontratación (Regl. arts. 54
y 55 — la carga de acreditar que la flota la otorgó es del encargado, o sea de
Likida). Tampoco cae en ninguna de las categorías que el aviso le enumera al
titular: "mensajería de WhatsApp", "alojamiento de la base de datos" y "modelos
de lenguaje" no incluyen una cola de mensajes. El aviso, tal como está escrito,
se lee como una lista cerrada.

Causa raíz probable: QStash se introdujo como decisión de infraestructura
(evitar el timeout de 300 s) sin pasar por el anexo de subencargados, que se
mantiene a mano y lleva la fecha del 28-jul.

---

### [MEDIO] ToS reincidente, cuarta ronda: "No timbra facturas" sigue publicado y el borrador vive solo en `docs/`
`src/app/terminos/page.tsx:57` contra
`docs/conocimiento/legal/tos-mandato-borrador.md:1-8` y `:29-40`.
`src/app/terminos/page.tsx:174` declara además: *"🔴 El contrato de encargado
del tratamiento está pendiente de firma."*

Escenario: el cliente activa la facturación (`FACTURACION_MODO`), Likida emite
CFDI con su RFC vía Facturapi (`src/lib/saas/facturapi.ts:178-185`) y entra a
portales de terceros presentando sus datos fiscales. El documento que ese cliente
aceptó dice, en la §2, que Likida **no timbra facturas**, y no contiene la
cláusula de mandato que el borrador redacta desde `91c41db`. El borrador nunca se
cableó a `/terminos`: no hay `import` ni referencia a ese archivo en `src/`.

Consecuencia: dos capas. (a) El contrato contradice al producto en lo que más
importa —actuar en nombre del cliente ante terceros sin mandato escrito—.
(b) Sin contrato de encargado firmado, la autorización de subcontratación del
Reglamento art. 54 no está acreditada por ninguna vía, y ese es el papel que
sostiene que OpenRouter, Meta, Supabase, Vercel, Sentry y ahora Upstash sean
subencargados y no terceros.

Causa raíz probable: la corrección se escribió como documento de trabajo "hasta
el visto bueno legal" y quedó fuera del camino que la auditoría revisa.

---

### [MEDIO] La plantilla ARCO manda el literal "la flota" donde el código documenta que va la razón social
`src/lib/meta/client.ts:467` contra `src/lib/likida/repo.ts:997-1002`.

Escenario: el titular escribió PRIVACIDAD el lunes; la flota responde el jueves,
fuera de la ventana de 24 h. `enviarRespuestaArco` cae a la plantilla
`respuesta_arco_v2` y publica
`parameters: [{ text: 'la flota' }, { text: respuesta }]`. `repo.ts:997-999`
había leído `tenant.razon_social` justamente para esto, y su comentario dice
*"AUDITORÍA 16, MEDIO: la plantilla lleva {{1}} = razón social REAL de la flota
(no el literal 'la flota')"*. El literal sigue ahí.

Consecuencia: el titular recibe una respuesta a su ejercicio de derechos en la
que `{{1}}` no identifica al responsable —lo único que el art. 15 fr. I
persigue—, y la razón social solo aparece embebida a media frase de `{{2}}`. El
panel, mientras tanto, reporta "la respuesta se envió al titular por WhatsApp".

Causa raíz probable: el arreglo de la ronda 16 se aplicó en `repo.ts` (armando
el texto) y no en el sitio que construye los parámetros de la plantilla; el
comentario quedó describiendo la mitad que sí se hizo.

---

### [MEDIO] Se cita la ley abrogada en pantalla: "LFPDPPP art. 32" para los plazos ARCO
`src/app/dashboard/arco/page.tsx:23` y `:80` (visible al cliente),
`src/app/admin/compliance/page.tsx:25`, `src/lib/likida/repo.ts:870-871`,
`src/lib/likida/processor.ts:153-154`, `src/lib/likida/privacidad.ts:612`,
`src/lib/likida/privacidad.test.ts:367`,
`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:96` y `:120`.
La tabla de equivalencias del propio repo
(`docs/conocimiento/11-datos-personales.md:48`) dice: **Plazos ARCO — 2010:
art. 32 · 2025: art. 31**.

Escenario: el contralor abre `/dashboard/arco` y lee "Solicitudes de tus
operadores y cómo responderlas a tiempo (LFPDPPP art. 32: 20 días hábiles)". La
ley vigente desde el 21-mar-2025 no numera ahí los plazos ARCO; el art. 32 es
numeración de la ley abrogada el mismo día. Encima, cuatro comentarios y el
título de una prueba siguen diciendo "15 días hábiles para contestar", cifra que
corresponde al plazo de **ejecución**, no al de respuesta.

Consecuencia: el argumento entero de este rubro es "citamos la norma y se puede
verificar"; una cita a ley derogada delante del comprador —que es contralor y
tiene abogado— destruye eso más rápido que no citar nada. El número (20) y el
cálculo (`DIAS_HABILES_ARCO = 20`, `privacidad.ts:615`) sí son correctos: el
hallazgo es la cita y los comentarios que la contradicen, no el plazo.

Causa raíz probable: los comentarios se escribieron en la ronda 12 contra la
numeración vieja y el número se corrigió después sin barrer las citas.

---

### [MEDIO] El aviso de Likida enumera a sus encargados y omite al procesador de pagos y al PAC
`src/app/privacidad/page.tsx:79` (la lista) contra
`src/lib/saas/stripe.ts:257-270` y `src/lib/saas/facturapi.ts:178-185`.

Escenario: el contralor contrata el plan. `crearSuscripcion` crea el customer en
Stripe con `email`, `name` y `tax_id_data: [{ type: 'mx_rfc', value: rfc }]`;
`emitirFactura` manda a Facturapi `legal_name`, `tax_id` y `email` del receptor.
La sección "Con quién se comparten" que esa misma persona leyó enumera cuatro
categorías —alojamiento, mensajería de WhatsApp, monitoreo de errores y modelos
de lenguaje— y ninguna cubre un procesador de pagos ni un PAC.

Consecuencia: la enumeración se lee como cerrada y no lo es; art. 15 fr. III y
art. 35 se apoyan en que el titular sepa por dónde pasan sus datos. Aquí Likida
es responsable, no encargada, así que la omisión es suya.

Causa raíz probable: `/privacidad` se escribió el 1-ago contra el flujo de
WhatsApp; el circuito de cobro y facturación del SaaS es de otra ronda y no
volvió a este archivo.

---

### [BAJO] La liga sembrada del aviso integral apunta al dominio de la landing, no al de la app
`supabase/seed.sql:55` (`https://likida.ai/aviso/1111…`) contra `README.md:19`
y `:94` ("En producción: app.likida.ai"), `scripts/deploy-vercel.sh:27`
(`APP_URL_PRODUCCION='https://app.likida.ai'`) y `CLAUDE.md:86`.

Escenario: `url_aviso_privacidad` es una URL absoluta guardada en la base; no se
deriva de `NEXT_PUBLIC_APP_URL`. El comentario del seed (`:46-51`) dice que la
línea "NO se adelanta" a la mudanza porque `app.likida.ai` daba 404 el 31-jul;
el README y el script de despliegue dicen que la mudanza ya ocurrió y que
`likida.ai` queda para la landing. Si la landing no sirve `/aviso/<uuid>`, el
operador recibe en su aviso simplificado una liga que `revisarAvisoIntegral`
califica `ok` —es una revisión de forma— y que no abre; y la base guarda la
constancia de habérselo entregado.

Consecuencia: es el bug que `dominio_propio.test.ts` y la migración 0033 vinieron
a cerrar, en su versión nueva. El único guardián real es
`verificarAvisoDePrivacidad` (`startup.ts:253-281`), que sondea la liga al
arrancar, solo para `DEMO_TENANT_ID` y solo escribiendo un `logger.error`.
No pude confirmar el código HTTP: no hay salida a red en este entorno.

Causa raíz probable: la URL del aviso vive en datos, no en configuración, así que
la mudanza de dominio no la arrastra y ninguna prueba cruza el seed contra
`APP_URL_PRODUCCION`.

---

### [BAJO] La ficha de la norma que sostiene el aviso apunta a un archivo que ya no existe
`normas/lfpdppp-15-16.yaml:65`: `usado_en_codigo: ["src/lib/cuadra/privacidad.ts"]`.

Escenario: `normas/` es la fuente de verdad declarada (MAPA, `normas/README.md:51`:
*"`usado_en_codigo` apunta a los archivos y líneas que dependen de la ficha"*).
El día que la LFPDPPP se reforme y la vigilancia normativa calcule el radio de
impacto de los arts. 15 y 16, apuntará a `src/lib/cuadra/privacidad.ts`, que el
renombre de `87426f8` borró. El archivo vivo es `src/lib/likida/privacidad.ts`.

Consecuencia: el mecanismo que existe para que una ficha contradicha llegue al
código no llega. Es la única ficha del rubro de datos personales que declara uso
en código, así que el radio de impacto queda vacío justo donde hay 600 líneas
que dependen de ella.

Causa raíz probable: el renombre barrió `src/` y `docs/` pero no los YAML de
`normas/` (quedan también `cff-69-B.yaml` y `lft-110-111-263.yaml`).

---

## Lo que revisé y está bien

- **Aviso integral, los once elementos.** `privacidad.ts:477-591` los cubre uno
  por uno con su fundamento, y `aviso_integral.test.ts:37-53` los mide por
  contenido, no por texto exacto. Las citas son a la ley de 2025 (arts. 15, 26
  fr. II, 29, 35, 7) y no a la abrogada.
- **Constancia separada de la reserva.** `0033_aviso_reserva_aparte.sql` divide
  `aviso_privacidad_claim_en` (reserva con TTL de 5 min) de
  `aviso_privacidad_en/_version` (constancia del art. 16, que solo escribe
  `confirmar_aviso_privacidad` tras un id de Meta y que `liberar_…` nunca
  toca). `processor.ts:239-249` lo respeta en el orden correcto.
- **La versión del aviso se deriva del texto.** `versionAviso` (`:255-262`) hace
  que un cambio de razón social, domicilio o liga reenvíe el aviso solo
  (art. 15 fr. VI), sin depender de que alguien suba un contador.
- **No se finge lo que falta.** `getDatosResponsable:659` devuelve `null` sin
  razón social o domicilio, `/aviso/[tenant]:69` responde 404, y la sección del
  art. 29 se marca `pendiente` y lo dice en pantalla
  (`aviso/[tenant]/page.tsx:100-109`).
- **`data_collection: 'deny'` en las tres salidas al modelo.** `PROVIDER_OPTS`
  (`openrouter.ts:207-213`) se aplica en `:271`, `:423` y `:705`; no hay ningún
  otro cliente HTTP hacia un proveedor de IA en `src/`. Y el aviso ya no promete
  un contrato de retención cero que nadie firmó (`privacidad.ts:554-562`).
- **Filtro de datos sensibles colados por el ticket.** `sanitizar.ts:71-119`
  descarta `producto` entero ante señales de salud, vida sexual o creencias, y
  documenta su propio límite (la imagen ya viajó; `emisor` no se filtra).
- **Custodia de credenciales.** `portal_credencial` (0063:68-101) guarda usuario
  y **referencia** al secreto, con un CHECK que rechaza cualquier cosa con pinta
  de contraseña; `rastreo_credencial` (0050:112-130) separa `token_cifrado` de
  `token_ultimos4` y no expone el token al panel. Las dos tablas están vacías.
- **Redacción en el pipeline de logs.** RFC y teléfono se borran, el UUID se
  pseudonimiza (`logger.ts`), `sendDefaultPii: false` en Sentry — verificado
  contra `52-anexo-subencargados.md:63-101`.
- **El medio ARCO responde a quien ya no es operador.** `processor.ts:371-383`
  atiende antes de resolver identidad y antes del corte por viaje abierto, y
  contesta con la verdad cuando no hay flota atribuible.
- **`/dashboard/arco` existe y está en el menú** (`rutas.ts:68`,
  área `operacion` en `visibilidad.ts:76`), con fail-cerrado en la lectura
  (`page.tsx:62-68`): una base caída no se pinta como "ninguna solicitud". El
  abierto de la ronda 13 ("nadie lo lee") está cerrado en cuanto a *poder* verlo;
  lo que sigue abierto es enterarse a tiempo (ver el ALTO de arriba).
- **`vence_en` usa 20 días hábiles**, que es lo que promete el aviso y lo que
  fija el art. 31 vigente para responder (`privacidad.ts:615-627`). El abierto
  "15 vs 20" está resuelto en el cálculo; sobrevive solo en comentarios.

## Lo que NO alcancé a revisar

- **Verificación en red.** El entorno no tiene salida (`CONNECT tunnel failed,
  403`), así que no pude comprobar qué devuelve `likida.ai/aviso/<uuid>` ni
  `app.likida.ai/aviso/<uuid>`, ni si la plantilla `respuesta_arco_v2` está
  aprobada por Meta. El BAJO del dominio queda sostenido solo por la
  contradicción interna del repo.
- **Los textos de `/soporte`, `/dashboard/politicas` y `/dashboard/usuarios`**,
  donde puede haber promesas sobre datos personales que no crucé contra el aviso.
- **El registro de aceptación del ToS.** El borrador lo anota como pendiente
  ("no tiene versión congelada ni registro de qué versión aceptó cada flota") y
  no busqué si existe algo equivalente para el aviso de la flota hacia Likida.
- **Retención efectiva de la conversación y del bucket `comprobantes`.** El
  único purgador es `0072` sobre `wa_mensaje_procesado`; no medí si el contenido
  de `conversacion` (que el aviso enumera como dato tratado) tiene algún plazo
  declarado en alguna parte.
- **`docs/conocimiento/11-huecos.md` y `31-cumplimiento-continuo.md`**, que
  probablemente listan pendientes de este rubro que no crucé.
