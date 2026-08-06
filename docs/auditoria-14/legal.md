# Cumplimiento legal — auditoría 14

**Nota: 6/10** (ronda 13: 7, re-auditoría: proclamó 8). Razón del movimiento:
**se atacó y subió a medias, y la mirada más profunda sobre lo nuevo cobró
factura.** Lo que sí se movió bien: los dos MEDIOs legales de la ronda 13
recibieron commit y los verifiqué en el código — `vence_en` ahora guarda 20
días (`94a3521`) y `buscarTenantPorTelefono` usa `.limit(2)` y se niega ante
ambigüedad (`574137c`). Pero los dos arreglos traen defectos propios: el
comentario del fix de `vence_en` cita la ley al revés ("la LFPDPPP art. 32
fija 15" — ni el art. 32 abrogado ni el art. 31 vigente dicen eso), y el fix
del ARCO convirtió "elige tenant arbitrario" en "le dice al operador activo
que no lo tiene identificado y NO registra la solicitud" — negación en vez de
pregunta, para la población exacta que el fix de la ronda 12 quería atender.
Los dos ALTOS de la 13 siguen intactos (ToS "No timbra facturas" sin mandato;
ARCO registrado que nadie lee, con `admin/compliance` repitiendo la mentira).
Y la implementación del deber ser de la RFA 2.9 —la pieza nueva de esta
ronda— llegó con un hueco legal propio: la declaración de dedicación/régimen
que decide la deducibilidad del 15% la captura el SUPERADMIN en `/admin/flotas`,
no la flota, sin constancia ni consentimiento; un checkbox desmarcado se
guarda como "declaró que NO califica" (una afirmación legal que nadie hizo); y
no hay una sola pantalla en `/dashboard` que la lea o la corrija. El seed del
demo, además, declara la elegibilidad fiscal de Transportes Innovativos sin
marcarla INVENTADO, contra su propio encabezado.

**Verificado hoy en el código actual (HEAD `0fa305e`), no por títulos de
commit:** los cierres `94a3521` y `574137c` abiertos línea por línea, los
circuitos de facturación releídos, `solicitud_arco` grepeado en todo `src/`
(una sola escritura, cero lecturas), y las pruebas del rubro corridas contra
HEAD: `privacidad` (40), `privacidad_ronda6` (37), `aviso_integral` (25),
`aviso_constancia` (8), `cierre_aviso` (30), `engine` (112),
`engine_diesel_medio_pago` (8), `diesel_estimulo` (6),
`permiso_cre_no_verificable` (8) — **274/274 verdes**.

## Hallazgos

### [ALTO, REINCIDENTE ronda 10/12/13] El ToS sigue diciendo "No timbra facturas" y los dos circuitos que lo desmienten no tienen cláusula de mandato — cuarta ronda sin una línea de cambio

`src/app/terminos/page.tsx:57` · `src/lib/cuadra/facturacion/agente.ts:10-21`
· `src/app/api/cron/facturar/route.ts:257` · `src/app/dashboard/suscripcion/page.tsx:172,326`

**El texto, idéntico al de la ronda 10** (`terminos/page.tsx:57`):

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa."

**Circuitos, releídos hoy, intactos:** `agente.ts:10-21` sigue documentando el
modo `emitir` ("apretar ese botón CREA UN CFDI REAL ante el SAT y no se
deshace"); `route.ts:257` sigue con `FACTURACION_MODO === 'emitir' ? 'emitir'
: 'ensayo'`; y `suscripcion/page.tsx:172` responde "Con estos se te va a
emitir el CFDI de cada mensualidad" y `:326` dice "Con estos se emite el CFDI
de cada mensualidad" sobre los datos fiscales capturados. `grep` de
`mandato|apoderad|en nombre de|autoriza a Likida` sobre `src/app/terminos/
src/app/legal/ src/app/privacidad/` → **vacío** (igual que en la 10, 12 y 13).

**Escenario, con valores.** Transportes Innovativos captura RFC/régimen/CP en
`/dashboard/suscripcion` leyendo "Con estos se emite el CFDI de cada
mensualidad" y firma un contrato que dice "No timbra facturas". Javier pone
`FACTURAPI_SECRET_KEY` + `FACTURACION_MODO=emitir` —dos variables de entorno,
cero revisión del contrato— y desde esa hora el párrafo citable es falso en
dos direcciones: Likida timbra la mensualidad vía Facturapi y el cron
`facturar` escribe el RFC de la flota en `receptor.rfc` de portales de
autofactura y aprieta "Facturar" sin que ningún papel autorice esa
representación. (No pude re-verificar la lista de envs de producción hoy; la
ronda 13 lo hizo con `vercel env ls`: 25 variables, sin las dos. El hallazgo
sigue siendo condicional a configuración, no una violación activa.)

**Estado: abierto** (decisión de Javier/abogado, anotada desde la ronda 10).

### [ALTO, REINCIDENTE ronda 12/13] El ARCO se registra y NADIE lo lee — la flota obligada a contestar en 20 días sigue sin poder enterarse, y `admin/compliance` sigue diciendo que el flujo no existe

`src/lib/cuadra/repo.ts:879` (única referencia de escritura en todo `src/`) ·
`src/app/admin/compliance/page.tsx:29` · `supabase/migrations/0053_...:98-204`

`grep -rn "solicitud_arco" src/` da exactamente: el insert en `repo.ts:879` y
comentarios. **Cero lecturas en toda la app** — ni `/admin`, ni `/dashboard`,
ni una server action. La RLS `solo_admin_flota` (0053:202-204) y los índices
`arco_pendientes_idx` (0053:122) y `solicitud_arco_operador_id_idx`
(0071:71) siguen esperando al lector que no existe. Y
`admin/compliance/page.tsx:29` sigue imprimiendo, hoy, sin cambio:

> "Solicitudes ARCO abiertas, datos por vencer retención, exports pendientes,
> audit log completo — Likida **no tiene estos flujos construidos hoy**."

Frase falsa desde la ronda 12: el flujo existe (el canal registra), la página
es la que no lo muestra.

**Escenario, con valores.** El 8-ago OP-101 escribe "quiero que borren mis
datos" por WhatsApp. Recibe "Queda registrada tu solicitud para la empresa"
(`privacidad.ts:407`) y la fila existe con `vence_en = 2026-08-28` (20 días
hábiles desde el 8-ago). El flota_admin entra al panel a buscarla: no hay
ninguna ruta que la lea. La única página con el rótulo "ARCO" dice que el
flujo no está construido. El 4-sep se vence el plazo del art. 31 (20 días
hábiles) sin que nadie haya visto la fila. El daño original del ALTO de la 12
—la flota no puede cumplir porque no sabe— persiste entero.

**Estado: abierto** (mitad de escritura cerrada con `a25a367`; mitad de
lectura sin construir — feature de producto pendiente desde la síntesis de la
12).

### [MEDIO, NUEVO — RFA 2.9] La declaración que abre la facilidad del 15% la hace el SUPERADMIN, no la flota: sin consentimiento, sin vista, sin corrección — y el checkbox desmarcado se registra como "la flota declaró que NO califica"

`src/app/admin/flotas/page.tsx:37-38,174-186` · `src/lib/cuadra/administracion.ts:110-120`
· `src/lib/cuadra/cuadre/desde_db.ts:55-57` · `src/lib/cuadra/cuadre/engine.ts:331-332`
· `src/lib/cuadra/config.ts:60-66` · `src/app/terminos/page.tsx` (sin mención)

**El mecanismo, verificado línea por línea.** El alta de flota
(`/admin/flotas`, gated por `requireSuperadmin()` — `page.tsx:7`) pide dos
checkboxes: "¿Exclusivamente autotransporte de carga federal?" y "¿Tributa en
coordinados (Título II Cap. VII) o persona física con actividad empresarial
(Título IV Cap. II Secc. I)?" (`page.tsx:174-186`). La server action los
convierte así (`page.tsx:37-38`):

```ts
dedicacionExclusivaCarga: fd.get('dedicacionExclusivaCarga') === 'on',
regimenElegible: fd.get('regimenElegible') === 'on',
```

Desmarcado → `false`, y `crearFlota` guarda `{ dedicacionExclusivaCarga:
false, regimenElegible: false }` en `tenant.config.facilidadCombustibleEfectivo`
(`administracion.ts:110-120`). El motor (`desde_db.ts:55-57`) calcula
`facilidad15 = false`, y la rama `efectivo_no_elegible` de `engine.ts:331-332`
le imprime al contador, en la liquidación:

> "la flota **declaró que NO califica** a la facilidad del 15% (dedicación
> exclusiva o régimen), así que el combustible exige pago electrónico (LISR
> 27-III) — no deducible."

**Tres defectos legales encadenados:**

1. **La declaración la hace quien no debe.** Es un hecho jurídico de la flota
   (su dedicación y su régimen fiscal, con efecto en la deducibilidad de sus
   gastos ante el SAT) y lo captura el superadmin de Likida. No hay
   confirmación de la flota, ni fecha, ni bitácora, ni "bajo protesta de decir
   verdad", ni cláusula en el ToS sobre quién declara y quién responde por la
   veracidad (`grep` de `facilidad|dedicación|15%` en `terminos/page.tsx`,
   `privacidad/page.tsx`, `legal/marco.tsx` → vacío). Si el dato es falso, el
   beneficio se aplicó igual: el riesgo del 27-III es de la flota, pero la
   declaración la escribió Likida.
2. **Ausencia de respuesta = "declaró que NO".** La rama honesta del propio
   doc (`undefined` → "por confirmar, nada se afirma") es **inalcanzable desde
   el formulario**: la server action siempre manda `true|false` para ambos
   campos, así que `crearFlota` siempre construye el objeto y `desde_db.ts:56`
   siempre evalúa a booleano. Un superadmin que no sabe el régimen de la flota
   (o que llena el formulario sin leer los checkboxes) deja registrada una
   declaración negativa que nadie hizo, y el motor se la presenta al contador
   como un hecho.
3. **La flota no puede verla ni corregirla.** Cero pantallas en `/dashboard`
   leen `facilidadCombustibleEfectivo` (grep en `src/` fuera de
   admin/administracion/engine/desde_db → vacío). No hay función de
   actualización: si el checkbox se marcó mal, solo un UPDATE a mano en la
   base lo corrige, y mientras tanto cada liquidación afirma un hecho legal
   falso.

**Escenario, con valores.** Javier da de alta "Flota del Bajío" desde
`/admin/flotas` y deja los checkboxes sin marcar (no le preguntaron al dueño).
Config queda `{dedicacionExclusivaCarga:false, regimenElegible:false}`. OP-201
paga $1,200 de diésel en efectivo; la liquidación sale con "la flota declaró
que NO califica a la facilidad del 15%… no deducible" — el contador lo registra
como no deducible por una declaración que la flota nunca hizo, y la flota no
tiene forma de verlo ni de corregirlo desde el panel. (Dirección fail-closed,
sí: no se regala una deducción; pero el producto afirma un hecho legal que no
existe, que es exactamente lo que este rubro audita.)

**Estado: abierto.**

### [MEDIO, REGRESIÓN del fix de la ronda 13] El camino ARCO pre-identidad ahora le dice "no te tengo identificado" al operador ACTIVO con teléfono en dos flotas, y NO registra la solicitud — el commit lo vende como "el caller pide identificar la flota"

`src/lib/cuadra/processor.ts:371-383` vs `src/lib/cuadra/processor.ts:395+`
· `src/lib/cuadra/conv.ts:641-652`

**El fix `574137c` sí existe y hace lo que dice en lo que dice:** `conv.ts:646-652`
ahora usa `.limit(2)` y devuelve `null` si hay dos filas. El problema es lo que
el caller hace con ese `null`. El commit afirma: "null → el caller pide
identificar la flota". El caller no pide nada (`processor.ts:378-383`):

```ts
if (tenantId) {
  await atenderPrivacidad(tenantId, null, msg.from, msg.text);
} else {
  await sendText(msg.from, 'Claro. No te tengo identificado con una flota en Likida, así que no sé a qué empresa reclamarle. …');
}
return;
```

**Escenario, con valores.** OP-102 dejó Transportes Innovativos (A, fila
`activo=false`) y desde el 1-sep es operador ACTIVO de Flota del Bajío (B,
mismo teléfono 52-…-779, `activo=true`). El 5-sep escribe "PRIVACIDAD" por el
mismo canal. El chequeo pre-identidad (línea 371) corre ANTES de
`resolveOperador` (línea 395): `buscarTenantPorTelefono` encuentra **dos
filas** → `null`; `resolverCuentaOficina` → `null` (un chofer no es cuenta de
oficina). Respuesta: "No te tengo identificado con una flota en Likida" — una
**afirmación falsa**: el remitente SÍ está identificado, es operador activo de
B, y `resolveOperador` lo habría resuelto. La solicitud no se registra en
ningún tenant: ni A ni B ven nada, y el titular se queda creyendo que no hay
responsable que atienda. La población que el fix de la ronda 12 quiso atender
—el que se muda de flota— pasó de "tenant arbitrario" (malo) a "negado y sin
registro" (peor en el ejercicio del derecho). El modo de falla correcto sería
caer al camino de identidad (`resolveOperador`) y, si la ambigüedad persiste,
PREGUNTAR a qué flota se refiere — no despedir con una negación falsa.

**Estado: abierto** (regresión introducida por el cierre `574137c` de la
ronda 13; el cierre no es falso positivo — el `.limit(2)` existe — pero el
comportamiento resultante es defectuoso).

### [MEDIO, NUEVO] El seed declara la elegibilidad fiscal del demo (dedicación exclusiva + régimen) sin marcarla INVENTADO — la liquidación del demo dirá "deducible por la facilidad del 15%" sobre un hecho legal no verificado

`supabase/seed.sql:104-107` vs `supabase/seed.sql:4` · `supabase/seed.sql:28`

El encabezado del seed ordena: "🔴🔴🔴 TODO LO MARCADO CON 'INVENTADO' ES DATO
DE FANTASÍA 🔴🔴🔴". La razón social y el domicilio del tenant están marcados
(`seed.sql:28`: "🔴 INVENTADOS los dos primeros… Los dos los tiene que capturar
la flota"). La declaración nueva, tres líneas abajo de la política, no:

```sql
'{facilidadCombustibleEfectivo}',
'{"dedicacionExclusivaCarga":true,"regimenElegible":true}'::jsonb   -- RFA 2026 regla 2.9: la flota del demo SÍ califica
```

Eso es un hecho jurídico-fiscal sobre **una empresa real** (el RFC
GMX0902279I1 es "real de un tercero que dio permiso", `seed.sql:20`): que se
dedica exclusivamente al autotransporte de carga federal y que tributa en un
régimen elegible. Nadie lo confirmó contra la Constancia. Y no es decorativo:
el motor (`desde_db.ts:55-57` + `engine.ts:301-314`) lo usa para imprimir en
la liquidación del demo "deducible por la facilidad del 15% (RFA 2026 regla
2.9)" si el ticket de diésel del guion llega pagado en efectivo. La sala
verá una afirmación de deducibilidad construida sobre una declaración que el
propio repo no distingue de sus datos de fantasía.

**Escenario, con valores.** En el demo se manda la foto de un ticket de diésel
pagado en efectivo. La liquidación muestra "el ejercicio lleva $X de $Y de
combustible en efectivo (Z% del total, tope 15%) … deducible por la facilidad
del 15%". Si alguien pregunta "¿ustedes confirmaron la dedicación y el régimen
de Innovativos?", la respuesta honesta es que no: lo declaró el seed. Es la
misma categoría del hallazgo de la razón social de la ronda 13, con un grado
más de daño: ya no es solo el aviso — es el tratamiento fiscal que el demo
enseña.

**Estado: abierto** (decisión de Javier: confirmar contra la Constancia, o
marcar la línea INVENTADO y que el guion la advierta).

### [BAJO, REINCIDENTE ronda 13] El segundo chequeo ARCO sigue siendo código muerto: `operador_id` queda NULL en toda solicitud de WhatsApp

`src/lib/cuadra/processor.ts:462-465` vs `src/lib/cuadra/processor.ts:371-383`

Sin cambios desde la ronda 13. Ambos bloques comparten la condición exacta
(`msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)`), y el
primero siempre hace `return` al final (línea 383). El segundo —el único que
pasa `op.operadorId` a `atenderPrivacidad`— es inalcanzable; su comentario
sigue llamándolo "red redundante". Consecuencia medible: **toda** solicitud
ARCO de WhatsApp se inserta con `operador_id = NULL`, y el índice de la 0071
(`solicitud_arco_operador_id_idx`) nunca se puebla. La flota solo puede
identificar al titular por `titular_ref` (el teléfono). Degrada el registro
construido para auditar el derecho, no rompe el derecho.

**Estado: abierto.**

### [BAJO, AGRAVADO por el fix de la ronda 13] Los comentarios y la prueba citan el plazo ARCO al revés: "15 días hábiles para contestar (LFPDPPP art. 32)" — ni el art. 32 abrogado ni el art. 31 vigente dicen eso; la prueba no fija el valor

`src/lib/cuadra/privacidad.ts:611-615` · `src/lib/cuadra/repo.ts:864` ·
`src/lib/cuadra/processor.ts:153` · `src/lib/cuadra/privacidad.test.ts:367-370`
· referencia interna: `docs/conocimiento/11-datos-personales.md:48,656`

**El número es correcto; el fundamento escrito es falso en cuatro lugares.**
El fix `94a3521` puso `DIAS_HABILES_ARCO = 20` (correcto: el aviso promete 20,
`privacidad.ts:538`) pero con este comentario (`privacidad.ts:611-615`):

> "La LFPDPPP art. 32 fija 15, pero el DOCUMENTO —la promesa que el titular
> leyó— dice 20… Si el aviso cambia a 15, que este número lo siga."

Eso es falso bajo cualquier lectura: el art. 32 de la ley 2010 (abrogada) dice
"veinte días hábiles" para responder y "quince días hábiles siguientes a la
fecha en que se comunique la respuesta" para hacerla efectiva; la ley vigente
(DOF 20-mar-2025) movió los plazos ARCO al art. 31 — así lo documenta la
propia tabla de equivalencias del repo (`docs/conocimiento/11-datos-personales.md:48`:
"Plazos ARCO | art. 32 | **art. 31**") y su build requirement
(`11-datos-personales.md:656`: "SLA de 20 días para responder y 15 para
ejecutar (art. 31)"). Y las otras dos citas en el código siguen afirmando lo
mismo falso: `repo.ts:864` ("la responsable con 15 días hábiles para
contestar, LFPDPPP art. 32") y `processor.ts:153` (ídem). El propio
`privacidad.test.ts:367` se llama "venceArco suma 15 DÍAS HÁBILES (LFPDPPP
art. 32), no calendario" — y su aserción solo verifica que el resultado caiga
en día entre semana, así que una regresión de 20 a 15 pasaría verde sin que
nadie la note. El daño no es de hoy (el texto al titular es correcto): es que
la única "verdad legal" escrita en el código invita a la próxima persona a
"corregir" el aviso a 15 días creyendo que así cumple la ley.

**Estado: abierto** (número corregido por `94a3521`; fundamento, citas y
prueba sin corregir).

### [BAJO, REINCIDENTE ronda 12/13] `/privacidad` promete borrado de cuenta con confirmación por escrito y retención "un año después de darlo de baja" — sin un solo mecanismo en código

`src/app/privacidad/page.tsx:88,108`

Sin cambios desde la 12: "Tus datos de cuenta, mientras tengas el servicio y
hasta un año después de darlo de baja" (`:88`) y "Se te confirma por escrito
cuando queda hecho" (`:108`). El único borrado del repo sigue siendo
`wa_mensaje_procesado` a los 30 días (`cron/purgar/route.ts:51`); `app_user`
no se toca. Promesa sin mecanismo; sin clientes reales que puedan ejercerla,
por eso BAJO.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 12/13] Los documentos legales no tienen versión congelada ni registro de qué versión aceptó el cliente

`src/app/legal/marco.tsx:88` ("Vigente al {fechaMx(new Date().toISOString())}") ·
`src/app/terminos/page.tsx:47-49` (§1, aceptación por uso, browsewrap)

Sin cambios: la página que el cliente aceptó la semana pasada es formalmente
un documento distinto al de hoy; §1 acepta por uso, sin casilla ni registro.
Se suma a los 🔴 de razón social, domicilio, jurisdicción y precios que el
propio texto declara pendientes.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13] El aviso del demo sigue publicando razón social y domicilio que el propio seed marca "INVENTADOS"

`supabase/seed.sql:24-45` · aviso vivo verificado por HTTP en la ronda 13

Sin cambios: `razon_social = 'TRANSPORTES INNOVATIVOS SA DE CV'` y
`domicilio_fiscal = 'Carretera Silao-Romita Km 4.5, Parque Industrial, 36100
Silao, Guanajuato'`, tres renglones abajo del comentario "🔴 INVENTADOS los
dos primeros… Los dos los tiene que capturar la flota". La página pública
sirve ese documento como el aviso legal de la flota. O los valores ya son los
reales (y el comentario quedó viejo), o el demo le enseña a la flota un aviso
con un responsable inventado. Se mantiene BAJO por ser decisión de Javier y
porque el camino del demo ya advierte del art. 29 pendiente.

**Estado: abierto** (decisión de Javier: confirmar contra la Constancia o
bajar el aviso a "pendiente" en el seed).

## Lo que revisé y está bien

- **Cierres de la ronda 13 verificados en el código, no por el título.**
  `94a3521` — `DIAS_HABILES_ARCO = 20` y `venceArco()` lo aplica
  (`privacidad.ts:615,618`); `574137c` — `.limit(2)` y `null` ante dos filas
  (`conv.ts:646-652`). Ambos existen y corren; sus defectos están anotados
  arriba, no escondidos.
- **El aviso integral mantiene los 11 elementos y los plazos correctos AL
  TITULAR.** `privacidad.ts:538` dice "20 días hábiles para contestarte y 15
  días hábiles más para hacerlo efectivo" — que es lo que la ley vigente
  efectivamente da (art. 31, según la propia documentación del repo), y el
  texto del integral no cita el número de artículo equivocado: la cita falsa
  vive solo en comentarios. Las citas visibles del integral (art. 15 fr. I-VI,
  art. 26 fr. II, art. 7, art. 35, art. 29) coinciden con la numeración de la
  ley 2025 según `normas/lfpdppp-15-16.yaml`, `normas/lfpdppp-26-II.yaml` y la
  tabla de `docs/conocimiento/11-datos-personales.md:48`.
- **Sin aviso no hay tratamiento** (`ponerAvisoADisposicion`): `sin_datos`
  bloquea, `no_entregado` libera el claim, la constancia se escribe solo
  después de `sendText` exitoso — sin cambios desde la 13.
- **Retención CFF art. 30 intacta.** `cron/purgar` borra solo
  `wa_mensaje_procesado` de más de 30 días (`route.ts:51`); `llm_costo` se
  consolida, no se purga; el bucket `comprobantes` no se toca. La promesa de
  5 años del aviso no tiene ningún camino de código que la acorte.
- **La mitad de escritura del ARCO respeta sus candados.** El insert
  (`repo.ts:879`) va por `supabaseAdmin()` (service_role — correcto: no hay
  sesión en el webhook), clasifica el tipo contra el CHECK `arco_tipo_dominio`,
  y es best-effort con rastro ruidoso (`arco.no_registrada`). La RLS
  `solo_admin_flota` (0053:202-204) sigue en su lugar — esperando al lector
  que no existe.
- **El motor RFA 2.9 falla cerrado hacia el contador y nunca acredita
  IVA/IEPS en efectivo.** La rama `undefined` (sin declaración → por
  confirmar) existe en `engine.ts:336-342` aunque el formulario no pueda
  producirla; los cuatro tipos nuevos entran en `NO_DEDUCIBLE_ISR` y en
  `SIN_ACREDITAMIENTO` (`engine.ts:97,956`); el contador del ejercicio se
  muestra en la nota con el acumulado y el tope a la vista. La matriz del doc
  (`docs/fiscal/rfa-2.9-deber-ser.md`) corresponde a lo que el código hace.
- **Pruebas del rubro corridas contra HEAD (`0fa305e`):** 274/274 verdes (9
  archivos listados arriba). `npx tsc`/`eslint` los corre otro rubro; no corrí
  la suite completa.

## Lo que no alcancé a revisar

- **El contrato de encargado del tratamiento** (LFPDPPP vigente, Regl. arts.
  54-55): sigue sin vivir en el repo; el propio §17 del ToS lo marca 🔴
  "pendiente de firma". Para la mesa de firma sigue siendo el documento que
  faltaría.
- **El anexo de subencargados con OpenRouter**: sin tocar; el aviso sigue
  diciendo lo que el código hace ("en cada llamada se les pide explícitamente
  que no retengan"), no una garantía contractual.
- **Verificar contra el SAT la razón social, el domicilio y el
  régimen/dedicación del seed** (GMX0902279I1): no tengo acceso a la
  Constancia; por eso el hallazgo de la declaración del demo queda como
  decisión de Javier, no como afirmación de falsedad.
- **La base real** (us-east-2): no la toco (regla). Lo que verifiqué es el
  código y el SQL de las migraciones 0053/0071/0082.
- **La matriz fiscal de la RFA 2.9 en profundidad** (acreditamiento de IVA en
  las fronteras, interacción con el tope de alimentación, permiso CRE): es
  rubro fiscal; aquí solo audité el ángulo de la declaración y de las notas
  que se imprimen.
- **Fuzzing nuevo de `pideAtencionPrivacidad` / `tipoDeSolicitudArco`**:
  solo corrí los casos documentados.

## Veredicto

**Sigue sin ser green light para firmar un cliente con el paquete legal
actual.** Ninguno de los dos ALTOS se movió en esta ronda: el ToS mantiene el
párrafo falso con la configuración de turno y sin cláusula de mandato, y el
ARCO que el aviso promete se registra en una tabla que **ninguna pantalla
lee**. A eso se suman las heridas nuevas: la declaración de la RFA 2.9 —el
dato que decide si el diésel en efectivo se deduce o no— la escribe el
superadmin por la flota, sin que ella la vea ni la pueda corregir, y el
formulario convierte el "no sé" en "declaró que no califica"; y el fix de la
ronda 13 convirtió la elección arbitraria de tenant en una negación falsa sin
registro para el operador con teléfono en dos flotas. La nota baja de 7 a 6
no por lo que se arregló (el número de `vence_en` y el `.limit(2)` son reales)
sino por lo que los arreglos trajeron encima y por el hueco legal que llegó
con el deber ser de la RFA 2.9.

**Para el demo de mañana, el rubro legal no bloquea el guion** — el aviso se
sirve, el canal ARCO responde y registra, la foto del ticket no se expone y
los bloqueos son fail-closed. Tres frases preparadas antes de la sala:

1. **La liquidación puede decir "deducible por la facilidad del 15% (RFA
   2026 regla 2.9)"** si el ticket de diésel del guion es en efectivo: esa
   nota descansa sobre la declaración que el seed puso (no marcada
   INVENTADO). Si sale, dígase que en producción la declaración la hará la
   flota — cuando el mecanismo exista.
2. **`admin/compliance` sigue diciendo "no tiene estos flujos construidos"**
   cuando el registro ARCO existe desde la ronda 12: es la consola de Javier,
   no la verá el cliente, pero es una mentira impresa en el código.
3. **El aviso del demo publica razón social, domicilio y régimen no
   confirmados**: si alguien abre la liga, la frase es "el dato lo captura la
   flota, no Likida" — igual que la ronda 13.
