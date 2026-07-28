# Cumplimiento legal — auditoría 5

**Nota: 4/10** (antes 6). Razón: **deuda que cobró factura · mirada más profunda**.
El producto salió a producción y trató datos personales de una persona física real
bajo un aviso cuyo aviso integral **no existe** (dominio NXDOMAIN), y dejó en la base
una constancia de puesta a disposición que casi con certeza es falsa. Los cuatro
pendientes que el propio `52-anexo-subencargados.md` declaró abiertos el 28-jul
siguen abiertos y ahora tienen datos reales encima. La nota de 6 se dio en la
auditoría 3 leyendo el *mecanismo*; nadie había abierto la liga, comparado la
constancia contra un envío real, ni contrastado las finalidades que el aviso promete
contra las que el código ejecuta.

> **El riesgo mayor hoy:** el aviso de privacidad que Likida mandó por WhatsApp hoy a
> las 21:26:39Z apunta a `https://transportesinnovativos.mx/aviso-de-privacidad`, un
> dominio que **no resuelve** — y esa misma liga es la única respuesta que el producto
> da cuando alguien ejerce un derecho ARCO. El titular no tiene forma de acceder,
> rectificar, cancelar, oponerse ni revocar, y la base afirma que sí se le informó.

**Escala usada.** CRÍTICO = hay datos personales saliendo hacia un tercero o
subencargado sin que el aviso los cubra, o un dato personal expuesto. ALTO = el
producto incumple una obligación de la Ley por un camino real y nadie se entera.

**Nota metodológica.** Todo lo de abajo se verificó contra el código de HEAD
(`86e23aa`), contra la **base de producción** (solo lecturas, vía REST con la
service-role de `.env.local`) y reproduciendo el texto real del aviso con `npx tsx`.
La ley citada es la **LFPDPPP vigente (DOF 20-mar-2025, últ. reforma 14-nov-2025)**;
las fichas `normas/lfpdppp-*.yaml` están las cuatro en `verificado_fuente_primaria`.

---

## Hallazgos

### [CRÍTICO] El aviso integral no existe: la liga que se le manda al operador es un dominio NXDOMAIN, y es también la única respuesta a un ARCO

**`supabase/seed.sql:34`** · **`src/lib/cuadra/privacidad.ts:66`** · **`src/lib/cuadra/privacidad.ts:123`**

**Artículo y texto aplicable.** Art. 16 fr. II (`normas/lfpdppp-15-16.yaml`,
`verificado_fuente_primaria`): cuando los datos se obtienen por medio electrónico el
aviso *"deberá ser proporcionado en su modalidad simplificada […] y señalar el sitio
donde se podrá consultar el aviso de privacidad integral"*. Y el art. 15 pone en el
integral lo que el simplificado no lleva: fr. V (mecanismos y procedimiento ARCO),
fr. VI (cómo se comunicarán los cambios), más el art. 35 (cláusula de aceptación o
rechazo de transferencias) y el art. 7 último párrafo (mecanismo de revocación).

**Escenario, con valores.** Estado real de la base de producción, leído hoy:

```
tenant 11111111-1111-1111-1111-111111111111
  razon_social         = TRANSPORTES INNOVATIVOS SA DE CV
  url_aviso_privacidad = https://transportesinnovativos.mx/aviso-de-privacidad
operador 33333333-0000-0000-0000-0000000000ff  "Javier Cámara"  tel 529993700779
  aviso_privacidad_en      = 2026-07-28T21:26:39.521473+00:00
  aviso_privacidad_version = siugtv
```

Reproduje el texto exacto que salió por WhatsApp importando el módulo real:

```
$ npx tsx -e "import {avisoSimplificado,versionAviso} from './src/lib/cuadra/privacidad'…"
🔒 *Aviso de privacidad*
Responsable de tus datos: *TRANSPORTES INNOVATIVOS SA DE CV*, con domicilio en …
Cómo limitarlo o ejercer tus derechos ARCO: escribe *PRIVACIDAD* por este chat…
Aviso completo: https://transportesinnovativos.mx/aviso-de-privacidad
---version: siugtv          ← idéntico al de la base
```

Y el dominio:

```
$ host transportesinnovativos.mx
Host transportesinnovativos.mx not found: 3(NXDOMAIN)
```

No es un 404: el dominio **no está registrado o no tiene zona DNS**. El operador que
toca la liga desde WhatsApp obtiene un error de red del navegador.

Y el agravante: `privacidad.ts:118-127` (`respuestaPrivacidad`) contesta el ejercicio
del medio ARCO devolviendo **esa misma liga** como el lugar donde *"vienen los pasos
para acceder, corregir, cancelar u oponerte al uso de tus datos"*. El único camino
que el producto ofrece para ejercer un derecho termina en un dominio inexistente.

**Consecuencia.** *Para el titular:* no puede ejercer ARCO, no puede oponerse, no
puede revocar y no sabe a qué transferencias está expuesto — todas las fracciones del
art. 15 que viven en el integral son inalcanzables. *Para la autoridad:* la Secretaría
Anticorrupción y Buen Gobierno (art. 2 fr. XV; el INAI no existe) encuadra esto en el
art. 58 fr. V — *omitir en el aviso alguno o todos los elementos del art. 15* — con
multa de **100 a 160,000 UMA** (art. 59 fr. II, `normas/lfpdppp-59.yaml`). *Para
Likida:* el módulo entero de privacidad, que es su mejor argumento de cumplimiento
ante un contralor, se cae al primer clic en la sala del demo del 6-ago.

**Causa raíz.** El seed marca los tres campos del responsable como `🔴 INVENTADO` y
avisa en el comentario que *"la liga tiene que APUNTAR A ALGO REAL antes de enseñarle
esto a nadie"* (`seed.sql:28-31`), pero nada impide correrlo contra producción, y de
hecho se corrió. `avisoSimplificado` valida que los tres campos **no estén vacíos**
(`privacidad.ts:42`), no que la URL exista. La validación de forma pasó; la de fondo
no existe.

---

### [CRÍTICO] La constancia de puesta a disposición se escribe ANTES del envío, el envío no puede fallar ruidosamente, y no hay reintento nunca

**`src/lib/cuadra/processor.ts:148-150`** · **`src/lib/meta/client.ts:69-81`** · **`supabase/migrations/0018_aviso_privacidad.sql:52-63`**

**Artículo y texto aplicable.** Reglamento de la LFPDPPP art. 31: *"Para efectos de
demostrar la puesta a disposición del aviso de privacidad en cumplimiento del
principio de información, la carga de la prueba recaerá, **en todos los casos**, en el
responsable."* La constancia de la migración 0018 existe precisamente para satisfacer
esa carga (así lo dice su propio encabezado, líneas 25-27).

**Escenario, con valores.** El orden en `processor.ts` es:

```ts
148  if (!(await reclamarEnvioAviso(tenantId, operadorId, versionAviso(texto)))) return;
149  await say(texto);
150  logger.info('privacidad.aviso_enviado', { tenantId, operadorId });
```

`reclamarEnvioAviso` ejecuta el `UPDATE operador SET aviso_privacidad_en = now(), …`
de la 0018 **antes** de intentar el envío. Y `sendText` no lanza nunca:

```ts
75  if (!res.ok) { logger.error('wa.sendText', { status: res.status, … }); return; }
```

Un 400, un 401 por token vencido, un 429 o un #131030 producen exactamente lo mismo
que un éxito desde el punto de vista del flujo: la constancia ya está puesta y la
línea 150 registra `privacidad.aviso_enviado`.

**Esto ya ocurrió, con fecha y hora.** La constancia del operador `…00ff` es de
**2026-07-28T21:26:39.521Z**. El commit `4b30dfb` *"La respuesta rebotaba con TODO
operador mexicano"* es de **2026-07-28T15:37:04-06:00 = 21:37:04Z**: **diez minutos y
veinticinco segundos después**. El propio `client.ts:45-53` documenta la medición
contra la Graph API de ese mismo día:

```
to: 5219993700779  →  (#131030) Recipient phone number not in allowed list
to: 529993700779   →  aceptado
```

Antes de `4b30dfb`, `say()` mandaba a `msg.from`, que es el `wa_id` que Meta entrega
con el "1" mexicano (`5219993700779`) — el que Meta **rechaza**. La conclusión de que
ese envío concreto rebotó es una **inferencia** (no leí los logs de Vercel), pero es
la única lectura compatible con el timestamp, con el mensaje del commit y con la
medición transcrita en el código.

Y no se corrige solo: `marcar_aviso_privacidad` (0018:57-59) solo dispara cuando
`aviso_privacidad_en is null` **o** cambió la versión. La versión sigue siendo
`siugtv` porque los datos del tenant no han cambiado. **Ese operador no volverá a
recibir el aviso jamás**, y la base seguirá afirmando que lo recibió.

El mismo defecto está en el camino ARCO: `atenderPrivacidad` (`processor.ts:112-128`)
llama `sendText` y a continuación registra `privacidad.solicitud_operador` como si se
hubiera atendido, sin saber si el mensaje salió.

**Consecuencia.** *Para el titular:* fue tratado —su foto fue a un modelo externo—
sin que se le pusiera el aviso a disposición, y sin ningún camino de recuperación.
*Para la autoridad:* en una verificación (art. 55) el responsable presenta como prueba
un registro que afirma una entrega que no ocurrió; eso no es un incumplimiento
omisivo, es prueba fabricada por diseño. *Para Likida:* el artefacto que vende como
"constancia" es el que la hunde, porque lo construyó Likida y es demostrablemente
independiente del hecho que dice probar. El día del demo, con operadores nuevos cuyos
números aún no estén en la allowed-list de Meta, se repite con cada uno.

**Causa raíz.** El claim atómico se diseñó para resolver la ráfaga concurrente
(comentario en 0018:38-41: evitar mandar el aviso dos o tres veces). Resolvió eso y,
de paso, convirtió "reservé el derecho a enviarlo" en "consta que se envió". Son dos
hechos distintos y la base solo modela uno.

---

### [ALTO] El aviso declara responsable a una empresa que no lo es, con un domicilio inventado

**`supabase/seed.sql:26-34`** · confirmado en la base de producción

**Artículo y texto aplicable.** Art. 15 fr. I: el aviso debe contener *"la identidad y
domicilio del responsable"*.

**Escenario, con valores.** El mensaje que salió hoy dice, literal: *"Responsable de
tus datos: **TRANSPORTES INNOVATIVOS SA DE CV**, con domicilio en Carretera
Silao-Romita Km 4.5, Parque Industrial, 36100 Silao, Guanajuato."* Los tres datos —
razón social, domicilio y RFC `TIN010101AAA`— están marcados `🔴 INVENTADO` en el
propio seed, y el RFC no pasa el dígito verificador (`engine.ts:106`,
`cuadre/rfc_empresa_invalido.test.ts:8` ya lo dejan por escrito). Transportes
Innovativos es un **prospecto sin contrato**: no ha instruido nada a Likida, no ha
autorizado subcontratación (Regl. arts. 54-55) y no sabe que un producto está
declarándola responsable del tratamiento frente a una persona física.

**Consecuencia.** *Para el titular:* el art. 15 fr. I existe para que sepa **a quién
reclamarle**; un domicilio inventado significa que no puede emplazar a nadie — el
aviso cumple la forma y falla en lo único que la fracción persigue. *Para la
autoridad:* art. 58 fr. V otra vez (100 a 160,000 UMA, art. 59 fr. II). *Para
Likida:* está atribuyéndole a un tercero identificado una calidad jurídica y una
responsabilidad que ese tercero no aceptó, en un mensaje enviado a una persona real.
Si ese mensaje se enseña en el demo del 6-ago, el contralor de Innovativos ve a su
empresa firmando un documento legal que nadie le mostró, con un domicilio que no es
el suyo.

**Causa raíz.** El seed escribe contra producción con `on conflict (id) do update set`
sobre los tres campos del responsable (`seed.sql:35-40`): aunque alguien capture los
datos reales, la siguiente corrida del seed los **revierte a los inventados** en
silencio. El comentario del propio archivo pide reemplazarlos "antes del demo"; nada
lo impone.

---

### [ALTO] Cierre automático sin intervención humana — contra la ficha del propio proyecto, que dice literalmente que no se construya

**`src/lib/cuadra/tools.ts:100-150`** · **`src/lib/cuadra/processor.ts:652`** · **`normas/lfpdppp-26-II.yaml:50-58`**

**Artículo y texto aplicable.** Art. 26 fr. II (ficha `verificado_fuente_primaria`,
transcrita literal en `normas/lfpdppp-26-II.yaml:18-23`): el titular puede oponerse
cuando sus datos *"sean objeto de un tratamiento automatizado, el cual le produzca
efectos jurídicos no deseados o afecte de manera significativa sus intereses […] y
estén destinados a evaluar, **sin intervención humana**, determinados aspectos
personales […] su rendimiento profesional, situación económica […] fiabilidad o
comportamiento."*

La ficha del repo, en `impacto_en_producto` (líneas 50-58), concluye: *"Un modo
'cierra solo, sin que nadie mire' sí metería a la flota en ese supuesto […] **No
construir cierre automático sin revisión humana sin volver aquí.**"* Y remata con
`usado_en_codigo: []` — nadie volvió.

**Escenario, con valores.** El operador escribe "listo". El agente llama
`guardar_liquidacion` (`tools.ts:101`), que **en el mismo turno**: computa el cuadre,
genera los dos PDF, sube ambos a storage y persiste la liquidación. De vuelta en
`processor.ts:652`, se manda al operador el resumen determinístico — *"• Sobró
$X del anticipo (a favor de la empresa)"* / *"• Pusiste $X de tu bolsa"*
(`cuadre/resumen.ts:55-59`) — y a continuación el PDF por URL firmada
(`processor.ts:679-682`). **En ningún punto de esa cadena interviene una persona.** El
contralor ve el resultado en el panel *después*, no antes.

Y el cuadre sí evalúa fiabilidad: `engine.ts:189` levanta `texto_sospechoso`
(*"traía texto dirigido al lector automático"* — una sospecha de manipulación sobre
el titular) y `resumen.ts:24-28` la mete en `SOLO_CONTRALOR`, es decir, **se guarda,
se le enseña al patrón y se le oculta deliberadamente al titular**, con el motivo
escrito en el código: *"avisarle al operador, que es quien pudo haberlo intentado,
únicamente le enseña a hacerlo mejor"* (`engine.ts:185-188`).

**Consecuencia.** *Para el titular:* tiene un derecho de oposición que la Ley le da,
sobre una evaluación de su fiabilidad que ni siquiera sabe que existe, y el aviso no
se lo menciona — el elemento 11 del checklist de `docs/conocimiento/11-datos-personales.md`
§5.4 ("advertencia sobre tratamiento automatizado y derecho de oposición") no está en
`privacidad.ts` ni en ningún lado, porque vive en el integral y el integral no existe.
*Para la autoridad:* el supuesto de la fr. II se activa y la negativa u omisión de
atender la oposición cae en art. 58 fr. IV / XIX. *Para Likida:* está vendiendo
"el sistema cuadra solo" y su propia ficha verificada dice que ese es el modo que
mete a la flota en el supuesto.

**Causa raíz.** La ficha se escribió el 28-jul (`verificado_el: 2026-07-28`) y se dejó
con `usado_en_codigo: []`: es una conclusión sin gancho. Nada en el CI ni en las
pruebas relaciona `guardar_liquidacion` con ella.

---

### [ALTO] El aviso cierra las finalidades con "Nada más" y el producto hace más

**`src/lib/cuadra/privacidad.ts:55`** · **`src/lib/cuadra/analytics.ts:79-101`** · **`src/app/dashboard/page.tsx:52`** · **`src/lib/cuadra/cuadre/engine.ts:189`**

**Artículo y texto aplicable.** Art. 11 vigente: *"El tratamiento […] deberá limitarse
al cumplimiento de las finalidades previstas en el aviso de privacidad, sin embargo,
si el responsable pretende tratar los datos para **una finalidad distinta a las
establecidas en el aviso**, se requerirá obtener nuevamente el consentimiento."* Las
palabras *"compatible o análogo"* de la ley abrogada **ya no existen** — no hay
válvula. Y como el gasto de un operador identificado es dato patrimonial, ese
consentimiento nuevo tendría que ser **expreso** (art. 7 párrafo quinto).

**Escenario, con valores.** El aviso enviado dice: *"Para qué: liquidar los viajes y
comprobar los gastos ante el SAT. **Nada más.**"* Esa frase cierra la enumeración.
Lo que el producto además ejecuta:

1. **Detección de fraude entre viajes.** `analytics.ts:86 detectarAnomalias` lee
   `gasto` de todo el tenant y corre `detectarDuplicadosEntreViajes`, cuyo encabezado
   dice *"Es el fraude número uno del sector"* (`duplicados.ts:1-4`). Está cableada al
   panel del contralor en `dashboard/page.tsx:52`. No es cuadrar un viaje: es
   correlacionar el historial del operador entre viajes para imputarle una conducta.
2. **Marca de manipulación.** `engine.ts:189` persiste `texto_sospechoso` en
   `ocr_extra` y lo entrega al contralor.
3. **Rendimiento por operador.** `analytics.ts:51 getStatsPorOperador` devuelve
   nombre + diésel total + viajes por persona. *(Hoy no está cableada a ninguna
   página — verificado con `command grep`; la anoto como finalidad escrita y lista
   para encenderse, no como tratamiento activo.)*

**Consecuencia.** *Para el titular:* se le dijo "nada más" y sobre sus datos se corre
una analítica de fiabilidad cuyo resultado ve su empleador. *Para la autoridad:*
art. 58 fr. IX — *cambiar sustancialmente la finalidad originaria sin observar el
art. 11* — con multa de **200 a 320,000 UMA** (art. 59 fr. III). *Para Likida:* si la
finalidad se ejecuta fuera de las instrucciones de la flota, el Reglamento art. 53
segundo párrafo fr. I la convierte en **responsable** por derecho propio frente a cada
operador de cada flota, con aviso, ARCO y sanción propios.

*Contraargumento que consideré:* detectar el mismo CFDI dos veces **dentro** de un
viaje sí es liquidar. Lo que no cabe en "liquidar los viajes y comprobar los gastos
ante el SAT" es correlacionar **entre** viajes para producir una señal de fraude sobre
la persona, y guardarle una marca de sospecha que se le oculta. Por eso el hallazgo
apunta a `detectarAnomalias` y a `texto_sospechoso`, no al motor de cuadre.

---

### [ALTO] No hay filtro de datos sensibles colados: lo comprado se guarda verbatim, y antes pasó por Gemini

**`src/lib/cuadra/intake/ocr.ts:36`** (campo `producto`) · **`src/lib/cuadra/intake/sanitizar.ts:17-26`** · **`src/lib/cuadra/repo.ts:109`**

**Artículo y texto aplicable.** Art. 2 fr. VI define datos sensibles, incluyendo los
referidos a **estado de salud**. El art. 8, párrafo segundo, prohíbe crear bases con
datos sensibles sin justificación; el art. 58 fr. XVIII lo sanciona con **200 a
320,000 UMA** (art. 59 fr. III), el art. 59 fr. IV permite incrementar la sanción
*"hasta por dos veces"* tratándose de sensibles y el art. 64 duplica las penas
penales. Y `docs/conocimiento/11-datos-personales.md` §8.6, último bullet, lo lista
como cosa a construir: *"Filtro de datos sensibles colados: un ticket de farmacia
revela salud […] Detecta y excluye."*

**Escenario, con valores.** El esquema de extracción pide `producto` (`ocr.ts:36`) y
`repo.ts:109` lo persiste en `gasto.ocr_extra`. Lo que hay hoy en producción, leído
de la base:

```json
"producto": "2 MT MD CL, Md Mundet, Md Coca, Cuarto de Libra con Queso"
"producto": "CONSUMO DE ALIMENTOS"
```

Cambia el ticket y cambia el dato: un operador que compra su medicamento en el camino
y lo mete a gastos produce `producto: "METFORMINA 850MG 30 TABS"` — un dato de salud,
del titular, escrito en la base y **ya enviado íntegro a Gemini vía OpenRouter** dentro
de la imagen. Lo único que hay en el camino es `sanitizarTexto` (`sanitizar.ts:17-26`),
que corta a 80 caracteres y quita `< > \``: es defensa contra inyección de prompt, no
contra contenido sensible, y no fue escrita para eso.

**Consecuencia.** *Para el titular:* su empleador y un subencargado extranjero acaban
con un dato de salud que él nunca consintió — y el consentimiento para sensibles
requiere ser expreso **y por escrito con firma o mecanismo de autenticación** (art. 8),
que aquí no existe en ninguna forma. *Para la autoridad:* base con sensibles sin
justificación, en la banda alta de multa y con el incremento del art. 59 fr. IV
disponible. *Para Likida:* es el único hallazgo de este informe que puede duplicar
la sanción.

**Causa raíz.** El diseño minimiza bien la imagen (no se persiste) pero no minimiza el
**texto extraído**: `producto` entra por su valor operativo (distinguir abarrotes de
comida, `ocr.ts:79`) y sale sin ningún clasificador de contenido. Nadie decidió
guardar salud; nadie decidió no guardarla.

---

### [ALTO] El teléfono mexicano tal como Meta lo entrega esquiva la redacción del logger — y el anexo de subencargados afirma lo contrario

**`src/lib/logger.ts:11`** · **`src/app/api/webhook/whatsapp/route.ts:60`** · **`docs/conocimiento/52-anexo-subencargados.md:64-69`**

**Artículo y texto aplicable.** Art. 18: deber de seguridad; y su segundo párrafo,
*"los responsables no adoptarán medidas de seguridad menores a aquellas que mantengan
para el manejo de su información"*. El anexo de subencargados presenta la redacción
como **la medida** que justifica que Sentry solo reciba datos filtrados.

**Escenario, con valores.** La regex es
`PHONE = /\b\+?52\d{10}\b|\b\d{10}\b/g` (`logger.ts:11`). Ejecutada:

```
$ node -e "…"
"5219993700779"   ->  "5219993700779"     ← NO redacta
"+5219993700779"  ->  "+5219993700779"    ← NO redacta
"5215512345678"   ->  "5215512345678"     ← NO redacta
"529993700779"    ->  "[TEL]"
"9993700779"      ->  "[TEL]"
```

`5219993700779` es exactamente el formato que Meta entrega en el `wa_id` de todo
operador mexicano — el hecho central de la ronda, documentado en `client.ts:47`. Trece
dígitos: el `\b` posterior nunca cae donde la alternancia lo necesita.

El camino real: `route.ts:60` ejecuta `logger.warn('wa.ratelimit', { from: m.from })`
con `m.from` = `5219993700779` sin normalizar. `logger.ts:39-41` replica todo `warn` y
`error` a Sentry. Resultado: el teléfono del titular, en claro, en los logs de runtime
de Vercel y en Sentry.

**Consecuencia.** *Para el titular:* su número identificable queda en dos sistemas de
terceros con retención y control de acceso que Likida no fijó. *Para la autoridad:*
no es transferencia sin cobertura —Vercel y Sentry están declarados subencargados en
el anexo— pero sí es una medida de seguridad que no hace lo que su documentación dice
que hace, y ese documento es justo el que se le enseñaría a un auditor. *Para
Likida:* `52-anexo-subencargados.md:64-69` afirma que Sentry *"es el único de la tabla
que recibe datos filtrados: se alimenta del logger, que redacta RFC, UUID de CFDI y
**teléfonos** antes de emitir"*. Esa afirmación es **falsa para el único formato de
teléfono que el sistema recibe de verdad**. Una afirmación falsa en el anexo vale más
que el bug: es lo que se firma.

**Causa raíz.** La regex se escribió para el formato "bonito" (`+52` + 10 dígitos), que
es el que trae el seed (`+521111111101`, que sí redacta por casualidad porque son 12
dígitos). El formato real solo apareció el 28-jul y `4b30dfb` lo arregló **en el
envío**, no en la redacción.

---

### [ALTO] Si al tenant le faltan los datos del responsable, no se manda ningún aviso — y la foto se procesa igual

**`src/lib/cuadra/processor.ts:136-142`** vs **`:254`** · **`supabase/migrations/0018_aviso_privacidad.sql:14-16`**

**Artículo y texto aplicable.** `docs/conocimiento/11-datos-personales.md` §4.3, sobre
el art. 9 fr. IV: *"Esto no te exime del deber de informar: la excepción es al
consentimiento, no al aviso de privacidad. **El aviso se pone a disposición
siempre.**"*

**Escenario, con valores.** Las tres columnas se agregaron nullable y sin `CHECK`
(`0018:14-16`: `alter table tenant add column if not exists razon_social text;` …).
Una flota dada de alta desde la consola de Supabase o por un script —el camino normal
para el segundo cliente— queda con las tres en `NULL`. Entonces:

```
136  const datos = await getDatosResponsable(tenantId);
137  if (!datos) { logger.error('privacidad.tenant_sin_datos_responsable', …); return; }
```

Se registra un `error` y se **retorna**… de `ponerAvisoADisposicion`, no del
procesamiento. El flujo sigue a la línea 254, descarga la foto y la manda a Gemini. El
operador nunca ve un aviso, y nada en el producto se detiene ni se degrada.

**Consecuencia.** *Para el titular:* tratamiento y remisión al extranjero sin que se le
haya puesto a disposición aviso alguno — el supuesto que la Ley no admite en ninguna
lectura. *Para la autoridad:* incumplimiento del principio de información (art. 58
fr. IV). *Para Likida:* la flota no puede cumplir aunque quiera —que es exactamente el
problema que este módulo dice existir para resolver (`privacidad.ts:4-8`)— y además no
se entera, porque el único rastro es una línea de log.

**Refutación que intenté.** El comentario de `privacidad.ts:29-37` defiende con razón
devolver `null` en vez de un aviso a medias: *"un aviso con el responsable equivocado
—o sin él— es peor que no tenerlo"*. Estoy de acuerdo y no es eso lo que reporto. Lo
que no está decidido en ningún lado es qué hace el **pipeline** cuando no hay aviso
que poner. Hoy: seguir.

---

### [MEDIO] "El gateway fuerza ZDR" es falso, y de esa afirmación cuelga la calificación de OpenRouter y Google como encargados

**`src/lib/llm/models.ts:19-23`** · **`src/lib/llm/openrouter.ts:119`** · **`docs/conocimiento/52-anexo-subencargados.md:114-118`**

**Artículo y texto aplicable.** Reglamento art. 52 fr. II inciso d: el proveedor de
cómputo en la nube debe *"garantizar la supresión de los datos personales una vez que
haya concluido el servicio"*. Y `11-datos-personales.md` §8.1: es remisión —y por tanto
no requiere consentimiento ni cláusula— **solo si el proveedor califica como encargado**;
si trata para finalidad propia, *"todo se convierte en transferencia internacional de
datos patrimoniales sin consentimiento expreso"* (art. 58 fr. XIII, 200 a 320,000 UMA).

**Escenario, con valores.** El comentario de cabecera afirma: *"El gateway fuerza ZDR
con `data_collection:'deny'` en cada llamada"* (`models.ts:21`). Lo que existe es
`const PROVIDER_OPTS = { provider: { data_collection: 'deny' } }` (`openrouter.ts:119`),
aplicado —correctamente y sin huecos— en las tres llamadas del cliente
(`:138`, `:289`, `:473`, incluido el camino de fallback). Pero eso es un **filtro de
ruteo de OpenRouter**, no un acuerdo de Zero Data Retention: el propio
`11-datos-personales.md` §8.3 dice que ZDR *"no viene por default […] requiere
aprobación previa del proveedor y se habilita por organización"*, y §8.6 lo pone como
lo primero a construir: *"negociar ZDR por escrito antes de tener el primer cliente
pagado. No después."* No hay contrato: `52-anexo-subencargados.md:114-118` lista como
pendientes abiertos el anexo con OpenRouter, la autorización de subcontratación de la
flota (Regl. arts. 54-55) y *"confirmar el régimen de retención de OpenRouter para las
imágenes"*.

**Consecuencia.** *Para el titular:* la calificación jurídica de a dónde van sus fotos
—remisión inocua o transferencia internacional sancionable— hoy descansa en un flag de
ruteo y en una frase de comentario que no es cierta. *Para la autoridad:* el inciso
II.d del art. 52 no está acreditado, y la carga de acreditar que la subcontratación fue
autorizada **corresponde al encargado**, o sea a Likida (Regl. art. 54). *Para Likida:*
es MEDIO y no ALTO porque no está demostrado que OpenRouter o Google traten para
finalidad propia — pero tampoco está demostrado lo contrario, y quien tiene que
demostrarlo es Likida.

**Causa raíz.** Un comentario ambicioso escrito antes de que existiera el contrato que
lo respalde. `data_collection: 'deny'` es la decisión correcta; llamarla ZDR no.

---

### [MEDIO] No existe política de retención ni supresión en ninguna parte del repo

**`supabase/migrations/` (23 archivos)** · **`src/lib/cuadra/conv.ts:171-176`**

**Artículo y texto aplicable.** Reglamento art. 50 fr. V: la persona encargada debe
*"suprimir los datos personales objeto de tratamiento una vez cumplida la relación
jurídica con el responsable"*. Art. 12 de la Ley: el tratamiento debe ser necesario,
adecuado y relevante. `11-datos-personales.md`, "Qué cambia esto en Likida" #12, pide
política de retención con *"imágenes crudas con borrado programado"*.

**Escenario, con valores.** Busqué borrado programado por dos vías —`grep` de
`retenci|purg|borrado|delete from|supresión|caducid` sobre `src/` y `supabase/`, y
revisión de las 23 migraciones—. Los únicos `delete` son operativos: el lease del
mutex (`0005:49`) y el claim de idempotencia (`conv.ts:315`). No hay cron, no hay TTL
de datos, no hay `on delete` con criterio temporal. `saveConversation`
(`conv.ts:171-176`) conserva los turnos indefinidamente aunque el viaje cierre.
Tampoco hay ningún camino que borre a un operador dado de baja.

**Consecuencia.** *Para el titular:* sus mensajes, montos y liquidaciones se quedan
para siempre, incluso después de dejar la flota. *Para la autoridad:* incumplimiento
del art. 50 fr. V del Reglamento el día que termine una relación con una flota, y
tratamiento excedido del art. 12. *Para Likida:* el primer contralor con auditor
externo pide la política de retención el día uno.

**Mitigante real, verificado:** las imágenes crudas **no se persisten**. `imagen_url` y
`ocr_raw` están en `NULL` en las 8 filas de `gasto` de producción, y el único bucket
de storage es `liquidaciones` (PDF). La foto vive en memoria y en Meta, no en Likida.
Eso es exactamente lo que §8.6 pide y por eso este hallazgo es MEDIO y no ALTO.

---

## Lo que revisé y está bien

- **El hallazgo ALTO de la auditoría 3 está cerrado.** El medio ARCO ya corre
  **antes** del corte por "sin viaje abierto": `processor.ts:200-203` está por encima
  de `getOpenViaje` en `:205`. La promesa del aviso se cumple ahora también para el
  operador entre cargas, que era el caso más probable de ejercerla. Verificado leyendo
  el orden actual, no el reporte anterior.
- **`pideAtencionPrivacidad` es determinístico y precede al agente**
  (`privacidad.ts:102-108`): normaliza acentos, tolera mayúsculas y no exige el mensaje
  completo. Un derecho ARCO no queda a criterio del LLM. Bien resuelto.
- **La versión del aviso se deriva del contenido, no de un contador manual**
  (`privacidad.ts:82-89`, FNV-1a). Si la flota cambia domicilio o liga, el aviso se
  reenvía solo — art. 15 fr. VI resuelto estructuralmente. Reproduje el hash: `siugtv`.
- **`marcar_aviso_privacidad` filtra por `tenant_id` Y por `id`** (`0018:52-56`) y
  tiene `revoke all … from public, anon, authenticated` (`0018:65`). Sin fuga entre
  tenants por esta vía.
- **No hay bóveda de credenciales de ningún tipo.** Buscado por dos métodos
  (`grep -iE "e\.?firma|fiel|ciec|contraseña|credencial|csd|\.key"` sobre `src/` y
  `supabase/`, y revisión de `package.json`). Cero. El §9 de `11-datos-personales.md`
  —el tipo penal del art. 62 LFPDPPP, de tres meses a tres años— **no aplica hoy**, y
  esa es la decisión de producto más valiosa del proyecto en este rubro.
- **No hay automatización de portales de terceros.** Verificado por tres vías: (1)
  `grep` de `puppeteer|playwright|selenium|chromium|captcha|browserbase|stagehand` en
  `src/`, `package.json` y `scripts/` → cero; (2) extracción de **todas** las URLs
  literales de `src/` → las de portales viven únicamente en `facturacion/comercios.ts`
  como **datos** que se le enseñan a una persona, y el único `fetch` saliente de
  `src/lib/cuadra/` es `intake/sat.ts:44`; (3) `node_modules` sin ninguna librería de
  automatización. El semáforo de §10 se respeta sin proponérselo.
- **El catálogo de 13 comercios no toca ni un portal de la cubeta ROJA** de §10
  (EdiFactMx, Facturama, Factura Digital, ioFacturo, PdP, iAudita). Son casetas,
  gasolineras y retail — la cubeta ámbar, y ni siquiera automatizada.
- **El SAT se consulta por el servicio público, sin credenciales**
  (`intake/sat.ts:15`, `consultaqr.facturaelectronica.sat.gob.mx`). Es la ruta limpia
  de §9.5 y es cierto lo que se puede vender sobre ella.
- **`PROVIDER_OPTS` se aplica sin huecos**, incluidos los dos caminos de fallback
  cross-provider (`openrouter.ts:138`, `:289`, `:473`). El control es débil (ver el
  MEDIO de arriba), pero no tiene fugas de implementación.
- **El aviso se pone a disposición ANTES del OCR**: `processor.ts:247` precede a la
  rama de imagen en `:254`. El orden es el correcto.
- **Los PDF salen por URL firmada con TTL de 1 hora** (`processor.ts:679`) desde un
  bucket privado (`0008:4-6`), y el ejemplar del operador lleva su propio filtro
  (`tools.ts:122-137`): los veredictos de `SOLO_CONTRALOR` no viajan en un adjunto que
  el chofer pueda reenviar.
- **Descartado por escrito — `facturacioncapufe.com.mx`.** `11-datos-personales.md`
  §SIN VERIFICAR #10 lo marca como dominio dudoso que *"devuelve una página vacía
  (literalmente ':D')"*. Lo comprobé hoy: resuelve a `72.172.186.60`, devuelve 200 y
  sirve el portal con `<title>Caminos y Puentes Federales</title>`. La nota de la
  investigación está **desactualizada**; `comercios.ts:92` no es un hallazgo.
- **Descartado por escrito — `operadorRfc`.** `engine.ts:40` acepta el RFC del
  operador (dato personal no listado en el aviso), pero no existe columna `rfc` en
  `operador` (`0001_init.sql:29-36`) y **nadie pasa ese campo**: `grep "operadorRfc:"`
  sobre `src/` sin tests devuelve cero. No es un tratamiento activo. Anotado para el
  día que se conecte — ese día entra al catálogo del art. 15 fr. II.
- **El anexo de subencargados sigue reflejando el código.** Verifiqué la cadena
  renglón por renglón contra `openrouter.ts:24`, `models.ts:31-45`, la tabla `FALLBACK`
  de `openrouter.ts:50-55`, `supabase/admin.ts` y `sat.ts:15`. La única afirmación del
  anexo que el código desmiente es la de la redacción de teléfonos (hallazgo ALTO
  arriba).

---

## Lo que NO alcancé a revisar

- **Los logs reales de Vercel del 28-jul entre 21:20Z y 21:40Z.** Habrían convertido
  la inferencia del CRÍTICO #2 (que el envío del aviso rebotó con `#131030`) en un
  hecho leído. Sin ellos, la constancia falsa está probada como **defecto estructural**
  y sostenida por el timestamp; no como incidente verificado. **Es lo primero que hay
  que mirar mañana.**
- **`SENTRY_DSN` en producción.** No está en `.env.local` (comprobado), así que en
  local Sentry no carga. Si está puesto en Vercel, el teléfono sin redactar ya llegó a
  Sentry; si no, el hallazgo se queda en los logs de runtime de Vercel. No lo pude
  determinar sin tocar la configuración del proyecto.
- **El contrato entre Likida y la flota.** No existe en el repo. Los pendientes #1 y
  #2 de `52-anexo-subencargados.md` (anexo con OpenRouter, autorización de
  subcontratación) son contractuales y no se pueden auditar desde el código. Mientras
  no existan, la calificación de "encargada" descansa en una descripción, no en un
  instrumento — y el Reglamento art. 54 pone la carga de acreditarlo en Likida.
- **El aviso propio de Likida como responsable** (pendiente #4 del anexo), para el
  contralor, el dueño y los leads. No hay ruta `/aviso-de-privacidad` en `src/app/`
  (verificado: las cinco `page.tsx` son `acceso`, `dashboard`, `dashboard/[id]`,
  `demo` y la raíz). No lo cuento como hallazgo del rubro porque lo cubre ese pendiente
  ya declarado, pero sigue abierto.
- **Los términos de uso vigentes de OpenRouter** sobre retención de imágenes. Es el
  pendiente #3 del anexo y es lo que decide si el MEDIO del ZDR sube o baja.
- **El valor de la UMA 2026.** No lo verifiqué (§SIN VERIFICAR #6 del propio
  documento sigue abierto). Por eso todas las multas de este informe van en **UMA** y
  ninguna en pesos.
- **Los criterios que la Secretaría Anticorrupción y Buen Gobierno haya emitido para
  el sector privado.** Laguna declarada en §SIN VERIFICAR #4; sigue sin cerrarse y es
  la que más podría mover cualquier interpretación de arriba.
