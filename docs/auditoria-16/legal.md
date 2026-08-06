# Cumplimiento legal — auditoría 16

**Nota: 6/10** (ronda 15: 5). Razón del movimiento: **la ruta ARCO de la flota
—el entregable que la 15 prometió y llegó roto— esta vez sí funciona: lista,
responde y su mensaje de éxito es honesto; y el CRÍTICO de la 15 (la pantalla
vacía para siempre) está cerrado y verificado en el código.** Pero el envío
nuevo por WhatsApp trae sus propios defectos —el {{1}} de la plantilla es el
literal `'la flota'` en vez de la razón social que el propio commit dice mandar,
la notificación no identifica al responsable, la pantalla de `/admin` quedó
mintiendo en el sentido contrario, el encargado puede responder un acto legal
sin gate de rol, el `.catch(() => [])` fail-open se copió a la pantalla nueva,
y la entrega del acto legal no tiene una sola prueba ni un wamid en el log— y
la deuda de fondo (ToS, mandato) entra a su sexta ronda sin una línea de
cambio. La cita falsa (art. 32) se propagó tres lugares más. Sube porque la
pieza central ya no es un espejo; no sube más por lo que se enumeró y porque el
estándar de verificación del repo (`eslint src/` limpio) falla hoy con un error
nuevo en la página recién estrenada.

**Verificado hoy en el código actual (HEAD `c901226`), no por títulos de
commit:** la página nueva abierta línea por línea (`dashboard/arco/page.tsx`),
`resolverSolicitudArco` y `enviarRespuestaArco` seguidos hasta `destinatarioWhatsApp`,
la plantilla `respuesta_arco` con sus parámetros, el `/admin/compliance` actual
frente al nuevo comportamiento de `resolverSolicitudArco`, `accionResponder`
frente a `resolverTenantEfectivo`, el bloque ARCO pre-identidad de
`processor.ts` releído, `buscarTenantPorTelefono` con su `.limit(2)`, la 0053
(RLS `for all`, CHECK, `operador_id uuid`), los cuatro cierres fiscales de la
15 abiertos en `engine.ts`, `fiscal.ts`, `repo.ts` y `desde_db.ts`, la cita
legal en `privacidad.ts`, `privacidad.test.ts`, `repo.ts`, `processor.ts`,
`0053` y las DOS pantallas, el ToS, `/privacidad`, el seed, y `npx eslint src/`
completo sobre HEAD. Pruebas corridas contra HEAD: `privacidad` (40),
`guard` (20), `tenant-efectivo` (45), `visibilidad` (90), `aviso_integral`
(25), `privacidad_ronda6` (37), `cierre_aviso` (30), `aviso_constancia` (8),
`processor_cadena` (14) — **309/309 verdes.** `tsc --noEmit -p .` limpio.
`eslint src/` → **1 ERROR** (`react-hooks/purity` en la página nueva) + 20
warnings (varias en probes sin trackear de otros rubros; el error es de código
commiteado — ver hallazgo [BAJO]).

## Hallazgos

### [ALTO, REINCIDENTE ronda 10/12/13/14/15] El ToS sigue diciendo "No timbra facturas" y los dos circuitos que lo desmienten no tienen cláusula de mandato — sexta ronda sin una línea de cambio

`src/app/terminos/page.tsx:57` · `src/lib/cuadra/facturacion/agente.ts:12-21`
· `src/app/api/cron/facturar/route.ts:257` ·
`src/app/dashboard/suscripcion/page.tsx:172,326`

Sin cambios desde la ronda 10, releído hoy. El texto (`terminos/page.tsx:57`):

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa."

Circuitos intactos: `agente.ts:12-14` documenta el modo `emitir`, `route.ts:257`
sigue con `FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'`, y
`suscripcion/page.tsx:172,326` responden "Con estos se te va a emitir el CFDI de
cada mensualidad" / "Con estos se emite el CFDI de cada mensualidad". `grep` de
`mandato|apoderad|en nombre de|autoriza a Likida` en `terminos/`, `legal/`,
`privacidad/` → vacío (igual que en las rondas 10, 12, 13, 14 y 15).

**Escenario, con valores.** Transportes Innovativos captura RFC/régimen/CP
leyendo "Con estos se emite el CFDI de cada mensualidad" y firma un contrato
que dice "No timbra facturas". Javier pone `FACTURAPI_SECRET_KEY` +
`FACTURACION_MODO=emitir` — dos variables de entorno, cero revisión del
contrato— y desde esa hora el párrafo citable es falso en dos direcciones.
Sigue siendo condicional a configuración, no una violación activa; pero es la
sexta ronda que el rubro lo reporta con la misma línea y la misma decisión
pendiente.

**Estado: abierto** (decisión de Javier/abogado, anotada desde la ronda 10).

### [MEDIO, NUEVO — regresión del fix 96f2adc] La pantalla de `/admin/compliance` quedó mintiendo en el sentido contrario: su ok dice "Likida no envía mensajes ARCO todavía" y el `resolverSolicitudArco` que acaba de llamar SÍ intenta enviarlos — y descarta el resultado

`src/app/admin/compliance/page.tsx:40,45` · `src/lib/cuadra/repo.ts:985-1001`

El fix de la ronda 15 dejó el mensaje honesto: "la respuesta se entrega al
titular por el canal que la flota defina — **Likida no envía mensajes ARCO
todavía** (anotado para la ronda siguiente)". La ronda 16 (c901226) cambió
`resolverSolicitudArco` para que SÍ intente el envío por WhatsApp, y la
pantalla de `/admin` quedó intacta:

```ts
await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);  // :40 — ahora ENVÍA
...
return { ok: 'Solicitud marcada como resuelta. La respuesta se entrega al titular por el canal que la flota defina — Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente).' };  // :45
```

El retorno de `resolverSolicitudArco` (`{ enviada, error }`) se descarta: el
superadmin nunca sabe si el WhatsApp salió o falló. "La ronda siguiente" es
esta — la frase quedó muerta el mismo día que nació el envío.

**Escenario, con valores.** El 8-ago el webhook registra una solicitud
(OP-101, `titular_ref 529993700779`). El 9-ago Javier abre `/admin/compliance`
y responde "Procedente, se elimina tu operador". `resolverSolicitudArco`
intenta el texto libre; OP-101 está dentro de la ventana de 24h y **sí recibe**
el WhatsApp. El ok que Javier ve dice "Likida no envía mensajes ARCO todavía" —
falso, el titular acaba de recibirlo. Si el envío falla, el mensaje tampoco lo
dice (ni `r.error` se muestra, ni la flota se entera por ningún canal: la
pantalla de la flota es otra ruta). Es exactamente la clase de rótulo que la
regla del repo prohíbe ("un rótulo tiene que ser verdad"), en el sentido
inverso al que la 15 cerró.

**Estado: abierto** (defecto propio del cierre `c901226` sobre el cierre
`96f2adc`).

### [MEDIO, NUEVO — el defecto central del envío nuevo] La notificación ARCO no identifica al responsable: el texto libre dice "por la empresa" sin nombre, y la plantilla manda el literal `'la flota'` donde el commit dice que va la razón social

`src/lib/cuadra/repo.ts:998` · `src/lib/meta/client.ts:455-467` · `src/lib/cuadra/repo.ts:633-653` (`getDatosResponsable`)

El texto libre (`repo.ts:998`):

```ts
`Tu solicitud de derechos ARCO fue atendida por la empresa: ${resolucion}`
```

La plantilla (`client.ts:466-468`):

```ts
name: 'respuesta_arco', language: { code: 'es_MX' },
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```

El comentario del commit dice "{{1}} = razón social de la flota". El código pasa
el literal `'la flota'`: la razón social existe y está a una consulta
(`getDatosResponsable` trae `razon_social` de `tenant`, `repo.ts:643-649`) y
`resolverSolicitudArco` ni siquiera la pide. La respuesta al ejercicio de un
derecho es un acto del **responsable** (la flota); ninguna de las dos vías
dice qué empresa responde — el titular con dos empleadores no sabe quién le
contestó, y ante la autoridad la "constancia" no identifica al emisor. Cuando
Meta apruebe `respuesta_arco`, cada envío por plantilla dirá literalmente que
el responsable se llama "la flota".

**Escenario, con valores.** OP-101 trabajó para Transportes Innovativos y
Flota del Bajío. Pide cancelación; la flota que responde es Innovativos. El
titular recibe "Tu solicitud de derechos ARCO fue atendida por la empresa:
Procedente, se elimina tu operador." — sin razón social, sin fecha, sin folio.
No puede distinguir qué empresa respondió ni citar la respuesta ante la
autoridad. Y con la plantilla aprobada: "…fue atendida por la flota: …".
Hoy la plantilla está "en revisión" y el camino falla cerrado; el texto libre
es el que sale — igual de anónimo.

**Estado: abierto** (defecto propio del cierre `c901226`; la identidad del
responsable es fr. I del aviso y no se puede fingir).

### [MEDIO, NUEVO] La respuesta ARCO es un acto legal del responsable y la acción no tiene gate de rol: el encargado —que no puede ver Usuarios, Políticas ni Configuración— puede obligar a la empresa respondiendo una solicitud; y nadie queda registrado como autor

`src/app/dashboard/arco/page.tsx:29-44` · `src/lib/auth/visibilidad.ts:22,73`
· `src/lib/auth/permisos.ts:31-33` · `src/app/dashboard/rutas.ts:68`

`/dashboard/arco` está en el área `operacion` (`visibilidad.ts:73`), el
encargado tiene exactamente esa área (`visibilidad.ts:22`), y
`accionResponder` (`page.tsx:29-44`) solo pasa por `requireSessionTenant` — un
gate de sesión, no de rol. El mismo encargado al que `permisos.ts` niega
`puedeAdministrar` (solo `superadmin`/`flota_admin`, `permisos.ts:31-33`) y al
que la visibilidad le esconde `usuarios`, `politicas` y `configuracion`, puede
escribir la resolución de un derecho ARCO — un acto que obliga a la empresa
ante el titular y ante la autoridad. Y no hay rastro de QUIÉN respondió: la
fila guarda `resolucion` y `resuelta_en`, pero no `actor_id` (la 0053 no tiene
columna de actor) ni una entrada en `bitacora_auditoria` (append-only, 0053) ni
un insert en `envio_mensaje` (0053:106-110 la creó para "el registro de CADA
plantilla de WhatsApp que Likida manda — un envío fallido no deja rastro y el
panel no puede decir 'se intentó y falló'"; el envío ARCO solo escribe en el
logger).

**Escenario, con valores.** El 10-ago OP-101 pide cancelación. El 12-ago
"Miguel", el encargado de Innovativos (jefe de tráfico, sin acceso a la
configuración de la cuenta), entra a `/dashboard/arco` y responde "Procedente,
se elimina tu operador". La solicitud queda `resuelta` con esa resolución y
OP-101 recibe el WhatsApp. La empresa queda obligada por un texto que nadie
puede atribuir a una persona: `bitacora_auditoria` no tiene el evento y la
solicitud no guarda quién la resolvió. Si la autoridad pide el expediente, el
producto no puede decir quién emitió la respuesta.

**Estado: abierto.**

### [MEDIO, NUEVO — fail-open copiado] La pantalla nueva convierte una base caída en "Ninguna solicitud ARCO registrada" y KPIs en 0 — el patrón ciego que el repo prohíbe, en la pantalla que nació para que la responsable no quedara ciega

`src/app/dashboard/arco/page.tsx:47-49,72` · `src/app/admin/compliance/page.tsx:159,164`

```ts
const solicitudes = await listarSolicitudesArco(tenantId).catch(() => []);   // :47
```

`listarSolicitudesArco` es fail-closed por construcción (`traerTodo` + `exigir`
lanzan ante un error o un paginado incompleto, `pg.ts:137-167`) — y la página
le quita el candado en la puerta de entrada. Una base caída se lee como "no hay
solicitudes": el `EstadoVacio` (`:72`) imprime "Ninguna solicitud ARCO
registrada" y los dos KPIs marcan 0/0. Es la misma clase de mentira que el
CRÍTICO de la ronda 15 ("una base caída se lee como 'no hay nada'") y que la
regla del repo enuncia en `analytics.ts`. La responsable —la obligada a
contestar en plazo— ve "todo en orden" estando ciega; el plazo del art. 31 se
vence sin que nadie lo sepa. El mismo `.catch(() => [])` sigue en
`/admin/compliance` (`:159,164`), donde la 15 ya lo anotó.

**Escenario, con valores.** El 1-sep Supabase tiene un bache de 40 s. En ese
lapso la flota abre `/dashboard/arco`: la pantalla dice "Ninguna solicitud ARCO
registrada" y "Por responder: 0". Hay dos solicitudes pendientes, una a 3 días
de vencer. La flota cierra la pestaña tranquila; el plazo se vence sin
respuesta y sin que la pantalla —ni su dueña— lo sepan.

**Estado: abierto.**

### [MEDIO, REINCIDENTE ronda 13/14/15] El ARCO pre-identidad sigue negando el derecho al operador ACTIVO con teléfono en dos flotas: "no te tengo identificado" es falso y su solicitud no se registra en ningún lado

`src/lib/cuadra/processor.ts:371-383` · `src/lib/cuadra/conv.ts:641-652` ·
`src/lib/cuadra/contactos.ts:54-75`

Sin cambios desde la ronda 14 (c901226 no tocó `processor.ts`). El chequeo
pre-identidad (`processor.ts:371`) corre ANTES de `resolveOperador` (`:384`);
`buscarTenantPorTelefono` con `.limit(2)` devuelve `null` ante dos filas
(`conv.ts:646-652`); `resolverCuentaOficina` solo mira `app_user`
(`contactos.ts`), y un chofer no es cuenta de oficina. Resultado
(`processor.ts:378-383`):

> "Claro. No te tengo identificado con una flota en Likida…"

y `return` — sin registro en ningún tenant.

**Escenario, con valores.** OP-102 dejó Transportes Innovativos (A,
`activo=false`) y desde el 1-sep es operador ACTIVO de Flota del Bajío (B,
mismo teléfono, `activo=true`). El 5-sep escribe "PRIVACIDAD". El chequeo
pre-identidad encuentra dos filas → `null` → la respuesta le dice que no está
identificado cuando **sí lo está** (B lo habría resuelto en la línea 384), y ni
A ni B reciben la solicitud. El modo de fallo correcto —caer al camino de
identidad y, si la ambigüedad persiste, PREGUNTAR a qué flota se refiere— sigue
sin implementarse. Con la pantalla nueva operativa, el costo subió: la
solicitud que el diseño promete mostrar en `/dashboard/arco` ni siquiera se
inserta.

**Estado: abierto.**

### [MEDIO, REINCIDENTE ronda 15] La edición del 15% en la consola sigue siendo atómica al revés: cambiar UN solo select borra la declaración ENTERA en silencio

`src/app/admin/flotas/page.tsx:56-69,133-145` · `src/lib/cuadra/repo.ts:921-935`

Sin cambios desde la 15 (c901226 no lo tocó). La UI presenta dos selects
independientes — "Carga: —/Sí/No" y "Régimen: —/Sí/No" (`flotas/page.tsx:137,143`)
— y `actualizarFacilidad15` hace (`repo.ts:930-933`):

```ts
if (ded !== undefined && reg !== undefined) {
  actual.facilidadCombustibleEfectivo = { dedicacionExclusivaCarga: ded, regimenElegible: reg };
} else {
  delete actual.facilidadCombustibleEfectivo;   // ← un solo select tocado
}
```

**Escenario, con valores.** La flota declaró `{dedicacionExclusivaCarga:true,
regimenElegible:true}`. El superadmin quiere corregir solo el régimen: pone
"Régimen: No" y deja "Carga: —". `ded === undefined` → se borra la llave
entera: la dedicación exclusiva que la flota sí declaró desaparece y todo el
diésel en efectivo pasa de "deducible" a "se revisa" desde la siguiente
liquidación. Fail-closed en dirección (no regala deducción), pero borra una
declaración sin confirmar y sin bitácora de quién/cuándo.

**Estado: abierto.**

### [BAJO, NUEVO — el estándar de verificación del repo falla en HEAD] La página nueva rompe `eslint src/`: `react-hooks/purity` — y el envío del acto legal no tiene UNA prueba

`src/app/dashboard/arco/page.tsx:49:130` · (la página completa, c901226 no
agregó ningún archivo de prueba)

```ts
const vencenPronto = solicitudes.filter((s) => ... s.venceEn <= new Date(Date.now() + 5 * 864e5)...);   // :49
```

`npx eslint src/` sobre HEAD: **1 error** — `react-hooks/purity` ("Cannot call
impure function during render", `Date.now()` en el cuerpo del componente,
`page.tsx:49:130`) — más 20 warnings (varios en probes sin trackear de otros
rubros). El estándar del repo ("npx eslint src/ — limpios", CLAUDE.md) falla
con un error de código commiteado; el commit dice "build limpio", pero el
`lint` no. La misma línea es la del KPI "Vencen pronto" (ver hallazgo de
calendario abajo).

Y el flujo legal nuevo no tiene ni una prueba: `grep` de
`resolverSolicitudArco|enviarRespuestaArco|respuesta_arco` en `src/` devuelve
solo los cuatro archivos de implementación; `visibilidad.test.ts` (90 pruebas)
no menciona `/dashboard/arco`; `git show c901226 --stat` no agrega ningún
test. El mapeo de códigos de error de Meta (`FUERA_VENTANA = [131047, 131026,
131042]`, `client.ts:461`), el fallback a plantilla, el `operador_id` como
teléfono y el mensaje al titular se entregan sin verificación.

**Escenario, con valores.** Un futuro fix cambia `FUERA_VENTANA` o el orden
texto→plantilla; la suite completa sigue verde (no hay prueba que lo note) y el
primer envío real de una respuesta ARCO sale mal en producción. Hoy: el primer
fix que toque esa página arrastra el error de lint, y nadie en la CI lo ve
porque `npm run build` (Next 16) no corre eslint.

**Estado: abierto.**

### [BAJO, NUEVO — registro sin evidencia] El envío ARCO no guarda el wamid ni toca `envio_mensaje`: "se envió" se afirma con un 200 que no se puede rastrear

`src/lib/meta/client.ts:453` · `src/lib/cuadra/repo.ts:985-1001`

`sendText` —el estándar del repo— registra el `id` del mensaje aceptado
(`client.ts:88-103`: "El ÉXITO también deja rastro… El id del mensaje es lo que
permite rastrearlo después en Meta"). `enviarRespuestaArco` no:

```ts
if (res.ok) { logger.info('arco.envio_ok', { telefono }); return { ok: true }; }   // :453 — sin wamid
```

Y la 0053 definió `envio_mensaje` precisamente para "el registro de CADA
plantilla de WhatsApp que Likida manda… un envío fallido no deja rastro y el
panel no puede decir 'se intentó y falló'" (0053:106-110) — el envío ARCO no
inserta nada. La evidencia de la notificación —el dato que ante la autoridad
prueba que la respuesta se intentó entregar— es un log de texto sin id.

**Escenario, con valores.** El 12-ago la flota responde y la UI dice "se envió
al titular". El titular dice que nunca recibió nada. Para verificarlo no hay
wamid que buscar en Meta, no hay fila en `envio_mensaje`, no hay webhook de
acuse correlacionado: solo un log `arco.envio_ok {telefono}` que dice que la
API aceptó.

**Estado: abierto.**

### [BAJO, NUEVO] El fallback de teléfono usa `operador_id` — un UUID — como número de WhatsApp

`src/lib/cuadra/repo.ts:994` · `supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:101`

```ts
const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;
```

`operador_id` es `uuid references public.operador(id)` (0053:101), no un
teléfono. Hoy el único escritor (`registrarSolicitudArco`) siempre pone
`titular_ref`, así que el fallback no dispara; pero si una fila llegara con
`titular_ref` vacío y `operador_id` poblado, `destinatarioWhatsApp` convertiría
el UUID en dígitos ("123e4567-e89b-12d3-a456-426614174000" →
"1234567123456426614174000", 25 dígitos) y Meta lo rechazaría. Fail-closed,
pero el tipo está mal y la defensa es basura que se lee como teléfono.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13/14/15 — AGRAVADO] La cita legal falsa (art. 32) se propagó a la ruta nueva, al repo y sigue en la prueba que no fija el valor

`src/app/dashboard/arco/page.tsx:22,58,76` · `src/lib/cuadra/repo.ts:870-871`
· `src/lib/cuadra/processor.ts:153-154` · `src/app/admin/compliance/page.tsx:22`
· `supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:96,120` ·
`src/lib/cuadra/privacidad.ts:611-615` · `src/lib/cuadra/privacidad.test.ts:367-370` ·
referencia interna: `docs/conocimiento/11-datos-personales.md:48`

La tabla del propio repo (`11-datos-personales.md:48`) es inequívoca: "Plazos
ARCO | art. 32 (ley 2010, abrogada) | **art. 31** (vigente)". La ley vigente
(DOF 20-mar-2025) da 20 días hábiles para responder y 15 para hacerla efectiva
— en el art. 31, no en el 32. El código dice:

- `dashboard/arco/page.tsx:22` (JSDoc) y `:58` (subtítulo visible): "LFPDPPP
  art. 32: 20 días hábiles" — el NÚMERO correcto, el FUNDAMENTO falso;
- `repo.ts:870-871`: "la responsable con **15 días hábiles** para contestar
  (LFPDPPP art. 32)" — falso en los dos extremos (ni 15 ni art. 32);
- `privacidad.ts:611-615`: "La LFPDPPP art. 32 fija 15" — falso (art. 32
  abrogado; el 31 vigente fija 20);
- `0053:96,120` y `compliance/page.tsx:22`: "art. 32" de nuevo;
- `privacidad.test.ts:367`: la prueba se llama "venceArco suma 15 DÍAS HÁBILES
  (LFPDPPP art. 32)" y su aserción solo verifica que el resultado caiga en día
  entre semana (`:370`) — una regresión de 20 a 15 pasaría verde sin que nadie
  la note.

La ronda 16 lo copió a **una pantalla nueva** (dos lugares visibles + JSDoc)
con el número correcto y el fundamento falso. Lo que el titular lee
(`privacidad.ts:538`, "20 días hábiles para contestarte y 15 más para hacerlo
efectivo") es lo que la ley vigente da; las citas internas y las pantallas de
la responsable son las que mienten.

**Estado: abierto** (número correcto desde `94a3521`; fundamento, citas y
prueba sin corregir, y ahora propagado a la ruta nueva).

### [BAJO, REINCIDENTE ronda 12/13/14/15] `/privacidad` promete borrado de cuenta con confirmación por escrito y retención "un año después de darlo de baja" — sin un solo mecanismo en código

`src/app/privacidad/page.tsx:88,108`

Sin cambios desde la 12: "Tus datos de cuenta, mientras tengas el servicio y
hasta un año después de darlo de baja" (`:88`) y "Se te confirma por escrito
cuando queda hecho" (`:108`). El único borrado del repo sigue siendo
`wa_mensaje_procesado` a los 30 días (`cron/purgar/route.ts:51`); `app_user` no
se toca. Promesa sin mecanismo; sin clientes reales que puedan ejercerla, por
eso BAJO.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 12/13/14/15] Los documentos legales no tienen versión congelada ni registro de qué versión aceptó el cliente

`src/app/legal/marco.tsx:88` ("Vigente al {fechaMx(new Date().toISOString())}")
· `src/app/terminos/page.tsx:47-49` (§1, aceptación por uso, browsewrap)

Sin cambios: la página que el cliente aceptó la semana pasada es formalmente un
documento distinto al de hoy; §1 acepta por uso, sin casilla ni registro. Se
suma a los 🔴 de razón social, domicilio, jurisdicción y precios que el propio
texto declara pendientes.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13/14/15] El seed sigue publicando razón social/domicilio "INVENTADOS" y declara la elegibilidad fiscal del demo sin marcarla

`supabase/seed.sql:24-45,104-107`

Sin cambios: razón social y domicilio "INVENTADOS" (`seed.sql:28`) y la
declaración de la RFA 2.9 del demo sin la marca (`seed.sql:104-107`: "la flota
del demo SÍ califica" — un hecho jurídico-fiscal sobre el RFC real
GMX0902279I1 que nadie confirmó contra la Constancia). Impacto de sala
reducido: los tickets del seed son `forma_pago '03'/'04'`, no efectivo, así que
el 15% no se imprime en la liquidación del demo.

**Estado: abierto** (decisión de Javier: confirmar contra la Constancia o
marcar la línea INVENTADO).

### [BAJO, REINCIDENTE ronda 15 — AGRAVADO] La RLS de `solicitud_arco` es `for all`: la flota puede BORRAR el registro de la solicitud, y la pantalla nueva la presume auditable

`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:202-204`

```sql
create policy solo_admin_flota on public.solicitud_arco for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check (...);
```

`for all` = SELECT + INSERT + UPDATE + DELETE. El diseño de la tabla es
explícito sobre su propósito (`0053:106-108`: "la solicitud tiene que seguir
siendo auditable después de eso" — por eso `titular_ref` vive aparte del FK), y
la bitácora vecina se blindó append-only ("No hay policy de UPDATE ni de DELETE
a propósito", `0053:186-187`). La solicitud ARCO —la constancia de un derecho
ejercido contra la flota— puede borrarse por SQL sin rastro en
`bitacora_auditoria`. La pantalla nueva la presenta como el registro oficial
("Cuando un operador escribe PRIVACIDAD… la solicitud queda registrada aquí",
`dashboard/arco/page.tsx:74-76`); el registro que la flota puede eliminar no es
constancia. No hay UI que borre — el hueco es la política.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 15 — AGRAVADO] "Vencen pronto" mide 5 días de CALENDARIO contra un `vence_en` de días hábiles, en las DOS pantallas; la nueva además rompe el lint con la misma línea

`src/app/dashboard/arco/page.tsx:49,65` · `src/app/admin/compliance/page.tsx:67,165`

El KPI de la pantalla nueva (`:65`) se llama "Vencen pronto (≤ 5 días)" y su
cálculo (`:49`) es:

```ts
s.venceEn <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)
```

5 × 86,400 s = 5 días de calendario, contra un `vence_en` calculado en días
hábiles (`venceArco` salta fines de semana). El KPI se enciende cuando quedan
~3-4 días hábiles reales, no 5: el rótulo promete una unidad y mide otra
(adelantarse es la dirección segura para un plazo, pero la cifra del rótulo no
es la cifra medida). La 15 lo anotó en `/admin` con el rótulo "≤ 5 días
hábiles" (`compliance/page.tsx:67`, mismo cálculo en `:165`); la 16 lo copió a
la pantalla nueva con el rótulo suavizado pero el mismo desajuste, y en esa
copia la línea además es el error de `react-hooks/purity` (ver hallazgo BAJO
del lint).

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 15] El plazo de 15 días hábiles para HACER EFECTIVA la respuesta (art. 31) no se registra ni se muestra — solo existe en el texto del aviso

`src/lib/cuadra/privacidad.ts:538` · `supabase/migrations/0053_...:98-119` ·
`src/app/dashboard/arco/page.tsx` (columnas: Recibida/Vence/Estado)

El aviso promete "20 días hábiles para contestarte y 15 días hábiles más para
hacerlo efectivo". El registro guarda `vence_en` (los 20) y `resuelta_en`, pero
no hay columna ni cálculo para los 15 de ejecución: ni la pantalla nueva ni la
de `/admin` pueden decirle a la flota cuándo se le vence la segunda fase. Y el
hallazgo de la entrega (arriba) lo vuelve más agudo: `resuelta_en` se escribe
cuando la flota TECLEA la resolución, no cuando el titular la recibe — el
reloj de los 15 días que la ley corre desde la notificación se fija en un
instante que la notificación aún no ocurrió.

**Estado: abierto.**

### [BAJO, NUEVO] `resolverSolicitudArco` no es idempotente: la actualización ocurre ANTES del envío y sin guardar `estado`, un doble envío manda DOS WhatsApp al titular

`src/lib/cuadra/repo.ts:985-1001`

La lectura previa (`:987-989`) no filtra por `estado`; el `UPDATE` es
idempotente pero el envío no. El botón de `FormaConAviso` se deshabilita
mientras corre, pero una pestaña vieja o un doble submit del formulario con la
página sin revalidar vuelve a pasar por el flujo completo: segunda
actualización (inofensiva) + segundo WhatsApp al titular.

**Escenario, con valores.** El contador de la flota responde y el `revalidatePath`
tarda; vuelve a dar "Responder" en la pestaña sin refrescar. OP-101 recibe el
mismo texto dos veces. Para un derecho ARCO, el titular recibe dos notificaciones
idénticas del mismo acto — ruido que la ley no pide y que un titular
litigioso puede leer como dos respuestas distintas.

**Estado: abierto.**

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 15 está cerrado y verificado en el código.** La
  pantalla de `/admin/compliance` ya no filtra por el tenant del superadmin:
  `datosDeCompliance` (`compliance/page.tsx:147-166`) consulta TODAS las
  solicitudes con join a `tenant(nombre)` y columna de flota. El mensaje de
  éxito de la 15 fue honesto el día que nació — y la 16 lo volvió falso en el
  otro sentido (hallazgo MEDIO de arriba).
- **Los cuatro cierres fiscales de la 15 existen y hacen lo que dicen.**
  (1) `engine.ts:306-330`: contador del ejercicio caído (total ≤ 0) o
  comprobante de otro ejercicio → `combustible_efectivo` en revisión con nota
  honesta ("No se afirma deducible ni no deducible"), NUNCA "excedente contra
  un tope de $0". (2) `fiscal.ts:336-340`: `elegible15 === false` →
  `efectivo_no_elegible`; `undefined` (sin declarar) → `combustible_efectivo`
  (en_riesgo), no "perdida" — la contradicción panel/motor de la 15 quedó
  cerrada. (3) `actualizarFacilidad15` comprueba el error de lectura
  (`repo.ts:926-928`) — no reemplaza la config entera por un bache de red.
  (4) `tools.ts`/`desde_db.ts` anclan el ejercicio al año del viaje.
- **La ruta nueva cumple su promesa central.** `/dashboard/arco` es accesible
  para la flota (sidebar `GESTION` + `puedeVerRuta` + `resolverTenantEfectivo`
  con gate por rol), lista las solicitudes del tenant con
  `listarSolicitudesArco` (tenant-scoped en la consulta), y el mensaje de éxito
  de `accionResponder` distingue "se envió al titular por WhatsApp" de "NO se
  pudo enviar — entrégala por otro canal" (`page.tsx:40-41`) — el ALTO de la 15
  ("el titular recibió su respuesta" sin envío) está cerrado en ESTA pantalla.
- **`resolverSolicitudArco` está acotada al tenant en lectura y escritura**
  (`.eq('tenant_id', tenantId)` en ambos, `repo.ts:987-989,992-993`): un
  `solicitudId` de otra flota devuelve "la solicitud no existe en esta flota",
  no la modifica. El fallback a `operador_id` está mal tipado (hallazgo BAJO)
  pero no alcanza a cruzar tenants.
- **El aviso integral mantiene los plazos correctos AL TITULAR.** "20 días
  hábiles para contestarte y 15 días hábiles más para hacerlo efectivo"
  (`privacidad.ts:538`), y `venceArco` suma 20 días hábiles saltando fines de
  semana — el `vence_en` guardado coincide con la promesa que el titular leyó.
  Las citas visibles del aviso (art. 15 fr. I-VI, 26 fr. II, 7, 35, 29)
  coinciden con la numeración 2025; la cita falsa vive en comentarios,
  migraciones y las pantallas de la responsable.
- **Sin aviso no hay tratamiento** (`ponerAvisoADisposicion`): `sin_datos`
  bloquea, `no_entregado` libera el claim, la constancia se escribe solo
  después de `sendText` exitoso — sin cambios desde la 13, releído hoy.
- **Retención CFF art. 30 intacta.** `cron/purgar` borra solo
  `wa_mensaje_procesado` de más de 30 días; el bucket `comprobantes` no se
  toca; la promesa de 5 años del aviso no tiene ningún camino de código que la
  acorte.
- **`tsc --noEmit -p .` limpio sobre HEAD.** `eslint src/` NO (1 error, la
  página nueva — hallazgo BAJO). Pruebas del rubro: 309/309 verdes (9 archivos,
  listados arriba). El commit dice "3,159 verdes · tsc 0 · build limpio": las
  dos primeras afirmaciones se sostienen; el lint no.

## Lo que no alcancé a revisar

- **La solicitud ARCO sembrada en la base real (demo)** por el commit: no toco
  la base (regla). Su `titular_ref`, tipo y `recibida_en` importan para el demo
  — en particular, si se insertó por SQL, NO hay ventana de 24h (no hubo
  mensaje entrante del titular), así que el envío de la respuesta en la sala
  caerá al camino de plantilla y fallará cerrado ("entrégala por otro canal").
  La UI lo dice con honestidad; el momento del demo mostrará el camino de
  fallo, no el de éxito. Vale decidir la narrativa antes de la sala.
- **Los códigos de error de Meta** `[131047, 131026, 131042]` como
  "fuera de ventana": son plausibles (131026/131042 son los documentados para
  re-engagement/fuera de 24h) pero no pude verificarlos contra la
  documentación de la Graph API desde este entorno, y no hay prueba que los
  fije — si el código real de "fuera de ventana" no está en la lista, la
  plantilla nunca se intenta y la flota ve "HTTP 400" sin explicación (sigue
  siendo fail-closed, pero mudo).
- **La fila real del superadmin en la base de producción**: no la toco. El
  cierre del CRÍTICO de la 15 no depende de ella (la consulta ya no filtra por
  tenant).
- **La matriz fiscal de la RFA 2.9 en profundidad** (LIF, CRE, acreditamiento
  en frontera): es rubro fiscal; aquí solo audité la afirmación legal y el
  cierre de la contradicción panel/motor.
- **El contrato de encargado y el anexo de subencargados con OpenRouter:**
  siguen sin vivir en el repo (el §17 del ToS los marca 🔴 pendientes).
- **Las probes sin trackear** (`audit16_fiscal_probe.test.ts`,
  `zzz-aud16-probe2/3/4`, `zzz-aud16-toolcalling-probe.test.ts`): no son mías
  y no las borro; varias traen warnings de eslint y una (`zzz-aud16-probe4`)
  un warning de variable sin usar. No son código commiteado.

## Veredicto

**No es green light, pero el entregable central de esta ronda SÍ funciona** — a
diferencia de la 15, donde la pantalla estrella era un espejo vacío. La flota
responsable ya tiene su ruta (`/dashboard/arco`), ve sus solicitudes, responde,
y la UI distingue "se envió" de "no se pudo enviar" sin mentir; el CRÍTICO de
la 15 está cerrado y los cierres fiscales de la 15 están en el código. Lo que
mantiene la nota en 6:

1. **La notificación al titular no identifica al responsable** — el texto libre
   dice "por la empresa" y la plantilla manda el literal `'la flota'` donde el
   commit dice que va la razón social (que el código tiene a una consulta). El
   acto más formal del producto se entrega anónimo.
2. **`/admin/compliance` quedó mintiendo en el sentido contrario** — "Likida no
   envía mensajes ARCO todavía" mientras el `resolverSolicitudArco` que acaba
   de llamar sí los envía, y descarta el resultado.
3. **El encargado —que no administra nada— puede responder el acto legal**, y
   nadie queda registrado como autor: ni actor en la fila, ni bitácora, ni
   `envio_mensaje`, ni wamid en el log.
4. **La deuda de fondo sigue cobrando**: ToS "No timbra" + mandato (6ª ronda),
   la cita art. 32 propagada a la pantalla nueva, la RLS `for all` que permite
   borrar la constancia, la promesa de borrado sin mecanismo, las versiones sin
   congelar, el seed con razón social inventada.
5. **El estándar del repo falla en HEAD**: `eslint src/` con un error de la
   página nueva, y el flujo legal nuevo —el envío por WhatsApp, la plantilla,
   los códigos de error— sin una sola prueba.

**Para el demo de mañana, el rubro legal no bloquea el guion**, con tres
frases preparadas:

1. **Si la sala abre `/dashboard/arco`** (el seed sembró una solicitud): la
   pantalla SÍ muestra la solicitud de prueba, y si se responde en vivo, el
   envío por WhatsApp probablemente falle (la solicitud sembrada no tiene
   ventana de 24h y la plantilla `respuesta_arco` está en revisión de Meta) —
   la frase honesta es la del propio producto: "la respuesta se marcó y se
   intentó enviar; como el titular está fuera de la ventana de 24h y la
   plantilla aún no está aprobada, se entrega por otro canal". Es un buen
   momento de diseño, no un bug: la UI no miente.
2. **No le muestres a un cliente la respuesta desde `/admin/compliance`**
   mientras el mensaje diga "Likida no envía mensajes ARCO todavía": es falso
   desde la 16 y se ve en la proyección.
3. **El ToS sigue diciendo "No timbra facturas"** mientras la suscripción
   promete "Con estos se emite el CFDI de cada mensualidad": si alguien lo lee,
   es la misma decisión de Javier/abogado desde la ronda 10 — no es un desliz
   de esta ronda.
