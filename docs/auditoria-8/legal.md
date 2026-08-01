# Cumplimiento legal — auditoría 8

**Nota: 6/10** (antes 4/10, auditoría 6). Razón: **se atacó y subió**. El
CRÍTICO de la ronda 6 (el aviso real de producción citaba un dominio NXDOMAIN,
tanto en el aviso como en la respuesta ARCO) y sus dos ALTOS (filtro de
rellenos que apagaba dominios reales; detector de oposición que no reconocía
"me quiero oponer") están genuinamente cerrados — verificado corriendo el
código real, no leyéndolo, y contra la página pública en producción, no contra
un mock. Pero la misma ventana que cerró eso abrió dos ALTOS nuevos: una
afirmación de "retención cero" que ya se había marcado MEDIO en la auditoría 5
por no tener respaldo, y que ahora pasó de un comentario interno a texto legal
que leen operadores y contralores reales; y un patrón de "que lo revise una
persona" tan amplio que una queja normal sobre un ticket borroso se traga
entera por el canal de oposición del art. 26 fr. II, sin dejar rastro de la
queja real.

El riesgo mayor hoy: **`privacidad.ts:522` y `src/app/privacidad/page.tsx:81`
le dicen a un titular real que sus datos están "contratados con retención
cero (no conservan lo que procesan)"**, una afirmación que la propia
investigación de Likida (`docs/conocimiento/52-anexo-subencargados.md:192`,
28-jul) marca como pendiente de confirmar desde hace dos rondas, y que la
auditoría 5 ya había señalado como "una frase de comentario que no es
cierta" cuando vivía solo en un comentario de código. Ahora es una
representación directa a la persona titular en el documento cuyo único
trabajo es ser exacto sobre eso.

---

## Hallazgos

### [ALTO] REINCIDENTE (escalado) — la afirmación de "retención cero" que la auditoría 5 marcó sin respaldo pasó de comentario interno a texto legal que leen operadores y contralores reales

`src/lib/cuadra/privacidad.ts:522` (sección "Transferencias a terceros" de
`avisoIntegral()`, servida en `/aviso/[tenant]`) · `src/app/privacidad/page.tsx:81`
(política propia de Likida) · `src/lib/llm/openrouter.ts:123` (`PROVIDER_OPTS`)
· `src/lib/llm/models.ts:19-23` (el comentario que la auditoría 5 ya cuestionó)
· `docs/conocimiento/52-anexo-subencargados.md:192`

**Artículo y texto aplicable.** LFPDPPP art. 35 (transferencias a terceros) y
Reglamento art. 52 fr. II inciso d: el proveedor debe "garantizar la
supresión de los datos personales una vez que haya concluido el servicio"
para que el tratamiento califique como remisión (sin consentimiento) y no
como transferencia internacional sancionable (art. 58 fr. XIII).

**Escenario, con valores.** El texto que un operador lee hoy en
`https://likida.ai/aviso/11111111-1111-1111-1111-111111111111` (verificado
en vivo, contenido real de producción) dice, sin condicional ni matiz:

> "Sí pasan por proveedores que trabajan por instrucción de la empresa y no
> pueden usarlos para otra cosa [...]: el proveedor de mensajería de
> WhatsApp, el de alojamiento de la base de datos, y los modelos de lenguaje
> que leen las fotos, **contratados con retención cero (no conservan lo que
> procesan)**."

El texto en `/privacidad` (política propia de Likida, también en vivo) repite
la misma afirmación en la misma forma absoluta. La única evidencia técnica de
esto es `const PROVIDER_OPTS = { provider: { data_collection: 'deny' } }`
(`openrouter.ts:123`), aplicada en las tres llamadas del cliente
(`:142`, `:293`, `:512`, incluido el fallback). Pero eso es un **filtro de
ruteo de OpenRouter**, no un contrato de Zero Data Retention negociado —la
distinción exacta que la auditoría 5 ya hizo contra el comentario de
`models.ts:21` ("El gateway fuerza ZDR con `data_collection:'deny'`"), que
sigue sin cambiar una palabra. El propio pendiente #3 de
`52-anexo-subencargados.md`, fechado 28-jul-2026 —tres días antes de que este
mismo texto se escribiera en las dos páginas públicas (commits `9e4a7d8` y
`f984d8f`, 31-jul y 1-ago)— dice literalmente: *"Confirmar el régimen de
retención de OpenRouter para las imágenes."* Sigue sin marca de resuelto; lo
repetí con `git log -S` sobre todo el historial y ningún commit lo toca.

Contraté con OpenRouter, no con Google ni Anthropic directamente
(`52-anexo-subencargados.md`: *"Likida contrata con OpenRouter y con nadie
más para IA"*). `data_collection: 'deny'` le pide a OpenRouter que enrute
solo a proveedores que no retienen — pero no dice nada sobre si **OpenRouter
mismo**, como intermediario, guarda algo en sus propios sistemas (logs de
uso, facturación, observabilidad). Esa es exactamente la pregunta que el
pendiente #3 deja abierta, y es distinta de la que `data_collection: 'deny'`
contesta.

**Consecuencia.** *Para el titular:* recibe como hecho consumado una garantía
sobre el destino de sus fotos de comprobantes que la propia empresa no ha
verificado. Si algún día se confirma que OpenRouter retiene algo en su capa
—plausible para cualquier gateway con facturación por token—, el aviso no
solo omitió información: afirmó lo contrario de lo cierto. *Para la
autoridad:* el inciso II.d del art. 52 se presenta como acreditado en un
documento público cuando la propia empresa lo tiene como pendiente de
confirmar; es el mismo hueco que la auditoría 5 calificó MEDIO, ahora
impreso para que lo lea cualquiera, no enterrado en un comentario de código.
*Para Likida:* si el 6-ago alguien de Innovativos —o su propio abogado— le
pregunta a Likida "¿cómo saben que el modelo no guarda mis fotos?", la
respuesta honesta hoy es "no lo hemos confirmado con OpenRouter", que
contradice literalmente lo que el aviso que ellos mismos publicaron les dice
a sus operadores.

**Refutación que intenté.** ¿Es defendible decir que `data_collection: 'deny'`
sí equivale a "retención cero" en la práctica, aunque no esté en un contrato
firmado? No: la propia investigación de Likida (`11-datos-personales.md`
§8.3, citada en `52-anexo-subencargados.md`) es explícita en que ZDR "no
viene por default [...] requiere aprobación previa del proveedor y se
habilita por organización" — es una gestión con el proveedor, no un
parámetro en una llamada API. El código eligió correctamente pedir ZDR;
lo que no puede es afirmar que ya lo tiene.

**Causa raíz.** El comentario ambicioso de `models.ts` que la auditoría 5 ya
señaló nunca se corrigió, y el mismo texto se copió —ahora en prosa
dirigida al titular, no en un comentario para desarrolladores— a los dos
documentos nuevos de este período sin volver a `52-anexo-subencargados.md`
a revisar qué seguía pendiente.

(REINCIDENTE — auditoría 5, MEDIO, `docs/auditoria-5/legal.md:430-461`.
Escala a ALTO porque el mismo defecto sin resolver pasó de un comentario
interno a una representación directa al titular.)

---

### [ALTO] El patrón "que lo revise una persona" del detector de oposición se traga quejas normales sobre tickets, y la queja real desaparece sin rastro

`src/lib/cuadra/privacidad.ts:301-302` (`OPOSICION`, patrones preexistentes
no tocados por el arreglo de la ronda 6) · `src/lib/cuadra/processor.ts:247-249`
(intercepta y hace `return` antes de cualquier otro manejo) ·
`src/lib/cuadra/processor.ts:114-130` (`atenderPrivacidad`, responde solo el
texto de ARCO)

**Artículo y texto aplicable.** Art. 26 fr. II (oposición al tratamiento
automatizado) — el mecanismo tiene que reconocer el ejercicio real del
derecho, pero no puede secuestrar mensajes que no lo son: un falso positivo
le niega al operador la atención de su solicitud real sin que quede ningún
rastro de qué pidió.

**Escenario, con valores.** Corrí `pideAtencionPrivacidad` (el código real,
sin mocks) contra frases plausibles de un operador pidiendo que alguien
revise un ticket mal leído por el OCR — un motivo de queja documentado y
frecuente en este producto (`intake/ocr.ts:93,123,135` trata la
ilegibilidad como caso de primera clase; hay commits dedicados a "aviso de
folio borroso" y a la lista de motivos de fallo del OCR):

```
"que revise una persona el folio porque el sistema lo leyó mal"   -> true
"necesito que una persona vea este ticket, se ve mal la foto"     -> true
"oye que revise una persona mi comprobante, se ve rara la lectura" -> true
```

Los tres matchean `/\bque (lo |la )?(revise|revisen|vea|vean) (un |una )?
(persona|humano|humana|alguien|gente)\b/` (línea 301) — un patrón que ya
existía antes del arreglo de la ronda 6 y que esa ronda no tocó ni probó.
El propio suite de pruebas nuevo de la ronda 6
(`privacidad_ronda6.test.ts:69`) fija como caso que SÍ debe dispararse
`"quiero que lo revise una persona"` — tratándolo como inequívoco — pero
ninguno de los cinco casos negativos (`:78-84`) prueba la combinación con
"ticket", "folio" o "comprobante", que es exactamente donde el patrón se
confunde.

`processor.ts:247` intercepta el mensaje ANTES de cualquier otro manejo y
`atenderPrivacidad` (`:114-130`) contesta ÚNICAMENTE el texto de ARCO —
"Claro. El responsable de tus datos es..." — y hace `return`. La queja real
sobre el folio mal leído nunca llega al manejo normal de comprobantes: no se
reintenta el OCR, no se le pide otra foto, no queda ninguna fila ni log que
diga "este operador tuvo un problema con su ticket". El único rastro que
queda es `privacidad.solicitud_operador`, indistinguible de un ejercicio de
derechos genuino.

**Consecuencia.** *Para el operador:* pidió ayuda con un comprobante y
recibió, en su lugar, un aviso sobre sus derechos ARCO que no pidió; su
comprobante sigue sin resolverse y nada en el sistema sabe que tiene un
problema pendiente. En el demo del 6-ago, si un operador de Innovativos
escribe algo tan común como "que alguien revise mi ticket porque no se ve
bien", el contralor vería al bot responder con un discurso de privacidad en
vez de resolver el problema del ticket. *Para el análisis del derecho
mismo:* satura el canal de oposición con ruido, lo que en un tenant con
tráfico real dificultaría distinguir el ejercicio genuino del derecho
(que sí tiene que atenderse y registrarse para la flota) de una confusión de
patrón.

**Refutación que intenté.** El comentario del propio archivo dice que el
detector está "calibrado a favor de la cobertura y no de la precisión" y que
exige la "forma de PETICIÓN... para no secuestrar la conversación normal de
la caseta" (`privacidad.ts:276-281`) — es decir, el autor ya conocía el
riesgo de secuestrar mensajes normales y creyó que exigir la forma de
petición bastaba. Lo que muestro aquí es que la forma de petición
("que + revise + persona") es sintácticamente idéntica tanto para oponerse
a una decisión automatizada como para pedir ayuda con una foto borrosa — el
guardarraíl que se construyó no distingue el objeto de la revisión (una
decisión sobre mí vs. una lectura de un papel), que es lo único que en
realidad separa los dos casos.

**Causa raíz.** Los patrones amplios (`que + revise + persona/alguien`) ya
existían antes de la ronda 6 y nunca se probaron contra el vocabulario real
del dominio (tickets, folios, comprobantes) — la ronda 6 amplió la cobertura
de "oponerse" sin auditar la precisión de lo que ya estaba.

---

### [BAJO] La ficha normativa del art. 26 fr. II sigue sin apuntar al código que ya lo implementa

`normas/lfpdppp-26-II.yaml:61`

**Escenario.** `usado_en_codigo: []` — vacío — mientras que `OPOSICION` y
`pideAtencionPrivacidad` en `src/lib/cuadra/privacidad.ts` implementan
directamente el supuesto que esta ficha describe, y `processor.ts:247-249`
los invoca en producción. La ficha hermana, `lfpdppp-15-16.yaml:61`, sí trae
`usado_en_codigo: ["src/lib/cuadra/privacidad.ts"]` — así que el patrón
existe y aquí no se aplicó.

**Consecuencia.** Un auditor futuro (fiscal o legal) que confíe en este campo
para saber dónde vive cada norma en el código concluye que el art. 26 fr. II
no tiene ninguna implementación, cuando sí la tiene desde la ronda 6.

**Causa raíz.** El campo se llenó al crear la ficha (28-jul) antes de que el
mecanismo de oposición existiera en código (`96e7347`, también 28-jul, pero
en otro commit) y nadie volvió a actualizarlo.

---

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 6 (aviso citando un dominio NXDOMAIN) está
  cerrado, verificado en vivo, no por lectura.** `sondearAvisoIntegral`
  ahora SÍ corre — está cableada en `src/instrumentation.ts:26-33`
  (`verificarAvisoDePrivacidad`, que Next.js ejecuta al arrancar el
  servidor), y `docs/HANDOFF.md` documenta el log real de un arranque en
  frío el 1-ago: `{"msg":"startup.aviso_privacidad","meta":{"ok":true}}`.
  Confirmé además contra la página pública real:
  `curl -L https://likida.ai/aviso/11111111-1111-1111-1111-111111111111`
  devuelve `200` con las diez secciones del checklist, razón social y
  domicilio del tenant real, y fundamento LFPDPPP en cada una. Corrí
  `avisoSimplificado()` y `respuestaPrivacidad()` (el código real, con los
  datos actuales del seed) y ambas terminan en
  `https://likida.ai/aviso/11111111-1111-1111-1111-111111111111` — no en
  `transportesinnovativos.mx`. El commit intermedio `87daa62` que corrigió
  un segundo error (la primera versión de la liga apuntaba a `cuadra.mx`,
  un dominio parkeado ajeno) también está cerrado: `dominio_propio.test.ts`
  lo guarda contra los dos dominios malos conocidos, y pasa.
- **La secuencia de migración a `app.likida.ai` está correctamente
  ordenada, no es un hallazgo.** `docs/HANDOFF.md` y los comentarios de
  `seed.sql` dejan explícito que la liga del aviso solo se mueve DESPUÉS de
  repuntar Meta y probar un mensaje real, y que `likida.ai` no se convierte
  en landing hasta el último paso — el orden evita el escenario donde la
  liga del aviso se rompe a media migración. Lo reviso y lo dejo anotado
  porque toca directamente la continuidad del mismo aviso que audité, no
  porque haya encontrado algo mal.
- **Los dos ALTOS de la ronda 6 (filtro de rellenos, detector de "me quiero
  oponer") están cerrados — verificado con casos adversariales propios, no
  solo con las pruebas del repo.** Corrí `revisarAvisoIntegral` contra los
  cuatro dominios que la ronda 6 usó como prueba
  (`transportistaindependiente.mx`, `autotransportesindependientes.com.mx`,
  `operadorindependiente.mx`, `metodologiatransporte.mx`) más variantes
  propias (`cambiariza.mx`, `porendefinir.mx`, `pendientedecobro.com.mx`):
  los siete dan `ok`. Corrí `pideAtencionPrivacidad` contra "me quiero
  oponer", "me quiero oponer a eso", "no me quiero oponer a que me
  revisen": los tres dan `true`. El límite de frontera de palabra
  (`(?<![a-z0-9])...(?![a-z0-9])`) resiste además casos que no estaban en
  la ronda 6 (`transportecambiario.mx` no dispara porque "cambiar" queda
  pegado a "io").
- **La constancia del art. 16 (reserva vs. hecho) está bien separada en la
  migración 0033, y coincide con lo que el código realmente hace.** Leí
  `marcar_aviso_privacidad` / `confirmar_aviso_privacidad` /
  `liberar_aviso_privacidad` completas y las tres funciones que las llaman
  en `repo.ts:472-549`, y el flujo en `processor.ts:150-194`
  (`ponerAvisoADisposicion`): la constancia (`aviso_privacidad_en`) solo se
  escribe después de que `sendText` devuelve un id real; la reserva
  (`aviso_privacidad_claim_en`) es lo único que se libera si falla. El
  defecto que la 0033 describe en su propio comentario —deshacer la reserva
  borraba una constancia de un aviso ANTERIOR ya entregado— no puede
  volver a ocurrir con este diseño: `liberar_aviso_privacidad` tiene
  `is not null` en el `where` y nunca toca `aviso_privacidad_en`.
- **`getDatosResponsable` sigue bloqueando el tratamiento cuando falta el
  responsable, y ahora además avisa al operador.** Verifiqué
  `processor.ts:311-323`: si `ponerAvisoADisposicion` devuelve `false`, hay
  `return` antes de la rama de imagen Y se le manda al operador un mensaje
  explicando por qué no se procesa — más que lo que la ronda 6 verificó
  (que solo confirmó el `return`, sin el aviso al operador).
- **La contención de "retención cero" está correctamente aplicada donde
  el código sí puede aplicarla.** `PROVIDER_OPTS` con
  `data_collection: 'deny'` está en las tres llamadas de
  `openrouter.ts` (`:142`, `:293`, `:512`, incluido el fallback) sin
  huecos — el defecto que reporto arriba es sobre lo que el AVISO afirma,
  no sobre si el filtro de ruteo está bien puesto; el filtro sí está bien
  puesto.
- **Sigue sin existir bóveda de credenciales ni automatización de portales
  de terceros.** Repetí las mismas búsquedas de las rondas 5 y 6
  (`command grep -iE "e\.?firma|fiel|ciec|contraseña|credencial|csd|\.key"` y
  `puppeteer|playwright|selenium|chromium|captcha|browserbase|stagehand`)
  sobre `src/`, `supabase/` y `package.json`: cero en ambas, tercera ronda
  consecutiva.
- **`src/app/privacidad/page.tsx` (nuevo, política propia de Likida) no
  finge datos que no tiene.** `RESPONSABLE.razonSocial`/`domicilio` están en
  `null` y la página muestra un aviso visible en vez de inventarlos — mismo
  criterio que ya regía la liga rota y el contacto del art. 29. Verificado
  en vivo (`curl -L https://likida.ai/privacidad`): el banner
  "Falta capturar la razón social y el domicilio fiscal..." sale
  hoy en la página real. No lo cuento como hallazgo porque el propio código
  lo declara con un comentario explícito ("⚠️ REVISAR ANTES DE PUBLICARLA
  COMO LA OFICIAL") y no oculta el hueco al titular.
- **Las 101 pruebas de este rubro pasan contra el código de HEAD**
  (`privacidad.test.ts`, `privacidad_ronda6.test.ts`, `aviso_integral.test.ts`,
  `src/app/privacidad/privacidad.test.ts`, `dominio_propio.test.ts`) — corridas
  por mí, no tomadas del reporte de otra ronda.

## Lo que NO alcancé a revisar

- **Si el pendiente de "confirmar el régimen de retención de OpenRouter"
  tiene alguna respuesta fuera del repo** (un correo, un contrato firmado
  con OpenRouter). Solo puedo verificar ausencia en el repositorio; no
  puedo verificar una gestión comercial que no deja rastro en el código.
- **La cita exacta del art. 31 (plazos ARCO: 20 días hábiles para
  contestar, 15 más para hacerlo efectivo) que aparece en `avisoIntegral()`
  y en `/privacidad`.** No hay ficha `normas/lfpdppp-31.yaml` con
  `verificado_fuente_primaria` que la respalde — la única fuente es
  `docs/conocimiento/11-datos-personales.md:48,656`, un documento de
  investigación (no una ficha) que sostiene que el plazo no cambió respecto
  a la ley abrogada, solo se renumeró de art. 32 a art. 31. El contenido
  parece correcto por esa vía secundaria, pero no lo verifiqué yo mismo
  contra el texto del DOF esta ronda, así que no lo reporto ni como
  hallazgo ni como cerrado.
- **El contrato entre Likida y la flota, y la autorización expresa de
  subcontratación (Regl. arts. 54-55).** Sigue sin vivir en el repo; mismo
  estado que las rondas 5 y 6.
- **Los logs reales de Vercel/Sentry** más allá de lo que `docs/HANDOFF.md`
  transcribe. No tengo acceso directo a Vercel; confié en la transcripción
  del log de arranque que el propio equipo documentó el 1-ago.
- **Si el mismo patrón amplio de `OPOSICION` (`que + revise + persona`)
  produce falsos positivos con otro vocabulario del dominio** más allá de
  los ejemplos sobre tickets/folios que probé — no hice un barrido
  exhaustivo de todo el vocabulario de caseta.
