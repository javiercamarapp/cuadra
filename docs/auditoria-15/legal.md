# Cumplimiento legal — auditoría 15

**Nota: 5/10** (ronda 14: 6). Razón del movimiento: **se atacó la pieza que
faltaba —la pantalla ARCO de cumplimiento— y llegó rota de fábrica en su
función central; la deuda del ToS cumple su cuarta ronda sin una línea de
cambio.** Lo que sí se movió bien es la mitad fiscal del paquete: la
declaración de la RFA 2.9 pasó a tri-estado (sin marcar = sin declarar), se
puede ver y editar en la consola, y la migración 0083 exige la forma de la
llave — verifiqué los cuatro cierres en el código, no por el título. Pero el
entregable legal estrella de esta ronda (`d7b171f`, "la flota ve sus
solicitudes… y responde con resolución") es un espejo vacío: la pantalla vive
bajo `/admin` con `requireSuperadmin()` y `datosDeCompliance` filtra por
`s.tenantId`, que es `null` para el superadmin por diseño — así que **siempre**
imprime "Ninguna solicitud ARCO registrada", haya o no filas; y la flota —la
responsable obligada a contestar— no tiene acceso a la ruta. El ALTO de la
ronda 14 (ARCO registrado que nadie lee) sigue abierto en sustancia, con un
espejo nuevo enfrente. A eso se suman: el ok del formulario afirma "El titular
recibió su respuesta por WhatsApp" sin que ningún código envíe nada; el fix
del panel (8a33ce1) convirtió "sin declarar" en "no deducible (perdida)" — la
misma confusión que la ronda 14 cazó en el motor, ahora del lado del panel; y
la cita legal falsa (art. 32 = "15 días") se propagó a la pantalla nueva.

**Verificado hoy en el código actual (HEAD `d7b171f`), no por títulos de
commit:** la pantalla nueva abierta línea por línea (`admin/compliance`),
`datosDeCompliance` seguido hasta `getSessionTenant` y `tenant-demo.ts`, el
flujo de resolución grepeado en busca de cualquier envío (no existe), los
cuatro cierres fiscales de 8a33ce1 abiertos en `flotas/page.tsx`,
`administracion.ts`, `desde_db.ts`, `engine.ts`, `negocio.ts`, `fiscal.ts` y
0083, los dos bloques ARCO de `processor.ts` releídos, `solicitud_arco`
grepeada en todo `src/` (una escritura, un lector — el espejo), y las pruebas
del rubro corridas contra HEAD: `privacidad` (40), `privacidad_ronda6` (37),
`aviso_integral` (25), `aviso_constancia` (8), `cierre_aviso` (30),
`engine` (114), `engine_diesel_medio_pago` (8), `diesel_estimulo` (6),
`permiso_cre_no_verificable` (8), `processor_cadena` (14), `processor_cierre`
(22) — **312/312 verdes.** `tsc` y `eslint` limpios sobre el código
commiteado (hay tres archivos `zzz-*`/`aud15-*` sin trackear de otros rubros;
uno de ellos rompe `tsc` — ver abajo).

## Hallazgos

### [CRÍTICO, NUEVO — el cierre del ALTO de la ronda 14] La pantalla ARCO nueva nunca muestra NADA: filtra por el tenant de sesión, que es `null` para el único rol que puede abrirla — y la flota (la responsable) no tiene acceso a la ruta

`src/app/admin/compliance/page.tsx:30,135-138` · `src/lib/auth/session.ts:93`
· `src/lib/auth/guard.ts:84-89` · `src/lib/auth/tenant-demo.ts:1-5` ·
`src/lib/cuadra/repo.ts:939-966` · `src/app/admin/compliance/page.tsx:140-148`

**El mecanismo, verificado línea por línea.** La página abre con
`await requireSuperadmin()` (`page.tsx:30`): solo el superadmin puede
entrar; cualquier otro rol rebota a `/dashboard` (`guard.ts:87`). El
server component carga los datos así (`page.tsx:135-138`):

```ts
async function datosDeCompliance() {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s?.tenantId) return [[], 0];
  ...
```

Y `getSessionTenant` devuelve `tenantId: (data?.tenant_id as string) ?? null`
(`session.ts:93`). El superadmin tiene `app_user.tenant_id = NULL` **por
diseño** — lo dice el propio archivo que existe para eso
(`tenant-demo.ts:1-5`: "`app_user.tenant_id` de un superadmin es NULL por
diseño (0001: "null = superadmin"): no pertenece a ninguna flota"), y el
guard que sí sabe resolverlo (`requireSessionTenant`, `guard.ts`) mapea al
tenant de la demo — pero `datosDeCompliance` **no pasa por ese guard**: usa
`getSessionTenant` crudo. Resultado: para el único usuario que puede abrir la
página, `s.tenantId` es `null` → `[[], 0]` → el `EstadoVacio` imprime, siempre:

> "Ninguna solicitud ARCO registrada."

**La promesa del commit es falsa en las dos direcciones.** El mensaje del
commit `d7b171f` dice "la pantalla de cumplimiento ARCO — **la flota** ve sus
solicitudes (recibida/vence/resuelta) y responde con resolución". (a) La
flota no puede ver nada: la ruta es `/admin`, superadmin-only, y no existe
ninguna pantalla en `/dashboard` que lea `solicitud_arco` (grep en `src/`: el
único lector es esta página). (b) El superadmin que sí puede abrirla la ve
vacía para siempre por el bug del tenant. Y por si faltara, los dos
`.catch(() => [])` / `.catch(() => 0)` (`page.tsx:140,148`) convierten una
base caída en "ninguna solicitud" — el mismo patrón ciego que el repo prohíbe
("una base caída se lee como 'no hay nada'").

**Escenario, con valores.** El 8-ago OP-101 escribe "quiero que borren mis
datos" por WhatsApp; el webhook inserta la fila (`tenant_id =
11111111-…`, `vence_en = 2026-08-28`, 20 días hábiles). Javier abre
`/admin/compliance`: la tabla dice "Ninguna solicitud ARCO registrada" y los
KPIs en 0/0. El plazo del art. 31 se vence el 4-sep sin que nadie haya visto
la fila — idéntico al daño original de la ronda 12, ahora con una pantalla
que proclama lo contrario ("las solicitudes ARCO sí están operativas: las
registra el webhook… y se resuelven aquí", `page.tsx:125-126` — "aquí" es
donde nadie puede verlas). El fix de la ronda 14 no cerró el ALTO: lo
decoró.

**Estado: abierto.** (Si —contra el diseño— la fila real del superadmin
tuviera un `tenant_id` puesto, la pantalla listaría UN solo tenant: el de
Javier, no "la flota" ni todos. En ningún caso hace lo que el commit dice.)

### [ALTO, REINCIDENTE ronda 10/12/13/14] El ToS sigue diciendo "No timbra facturas" y los dos circuitos que lo desmienten no tienen cláusula de mandato — quinta ronda sin una línea de cambio

`src/app/terminos/page.tsx:57` · `src/lib/cuadra/facturacion/agente.ts:12-21`
· `src/app/api/cron/facturar/route.ts:257` ·
`src/app/dashboard/suscripcion/page.tsx:172,326`

Sin cambios desde la ronda 10, releído hoy línea por línea. El texto
(`terminos/page.tsx:57`):

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa."

Circuitos intactos: `agente.ts:12-14` documenta el modo `emitir` ("hace lo
mismo y aprieta" — el botón de emitir del portal), `route.ts:257` sigue con
`FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'`, y
`suscripcion/page.tsx:172` responde "Con estos se te va a emitir el CFDI de
cada mensualidad" y `:326` "Con estos se emite el CFDI de cada mensualidad".
`grep` de `mandato|apoderad|en nombre de|autoriza a Likida` en
`terminos/`, `legal/`, `privacidad/` → **vacío** (igual que en la 10, 12, 13
y 14). El commit de esta ronda no tocó ninguno de los dos archivos.

**Escenario, con valores.** Transportes Innovativos captura RFC/régimen/CP
leyendo "Con estos se emite el CFDI de cada mensualidad" y firma un contrato
que dice "No timbra facturas". Javier pone `FACTURAPI_SECRET_KEY` +
`FACTURACION_MODO=emitir` — dos variables de entorno, cero revisión del
contrato— y desde esa hora el párrafo citable es falso en dos direcciones:
Likida timbra la mensualidad vía Facturapi y el cron escribe el RFC de la
flota en `receptor.rfc` de portales de autofactura sin que ningún papel
autorice esa representación. Sigue siendo condicional a configuración, no una
violación activa; pero es la cuarta ronda que el rubro lo reporta con la
misma línea y la misma decisión pendiente.

**Estado: abierto** (decisión de Javier/abogado, anotada desde la ronda 10).

### [ALTO, NUEVO — latente tras el CRÍTICO] El formulario afirma "El titular recibió su respuesta por WhatsApp" — ningún código envía nada

`src/app/admin/compliance/page.tsx:45` · `src/lib/cuadra/repo.ts:969-978`

Cuando la acción resuelve, devuelve (`page.tsx:45`):

```ts
return { ok: 'Solicitud marcada como resuelta. El titular recibió su respuesta por WhatsApp.' };
```

`resolverSolicitudArco` (`repo.ts:969-978`) hace **una sola cosa**: un
`UPDATE` de la fila (`estado: 'resuelta', resuelta_en, resolucion`). No hay
`sendText`, no hay fila en `envio_mensaje`, no hay nada que contacte al
titular — el grepeo del flujo completo (acción → repo → cualquier helper)
no encuentra un solo envío. El titular ni siquiera tiene un medio de contacto
confiable en la fila: `titular_ref` es el teléfono, pero nadie lo usa para
escribirle.

**Escenario, con valores.** (Vale cuando se arregle el CRÍTICO; hoy el ok es
inalcanzable porque la lista siempre está vacía.) El 8-ago OP-101 pide
cancelación; el 15-ago la flota contesta "Procedente, se elimina tu
operador". El formulario imprime "El titular recibió su respuesta por
WhatsApp". OP-101 no recibe nada; los 15 días hábiles del art. 31 para hacer
efectivo el derecho corren contra un titular que no sabe que le contestaron.
Es exactamente la clase de rótulo que la regla del repo prohíbe ("un rótulo
tiene que ser verdad") y con peso legal: es la prueba de la notificación que
el aviso promete.

**Estado: abierto** (defecto propio del cierre `d7b171f`).

### [MEDIO, REINCIDENTE ronda 13/14] La regresión del ARCO pre-identidad sigue: el operador ACTIVO con teléfono en dos flotas recibe "no te tengo identificado" — afirmación falsa — y su solicitud no se registra en ningún lado

`src/lib/cuadra/processor.ts:371-383` · `src/lib/cuadra/conv.ts:641-652` ·
`src/lib/cuadra/contactos.ts:54-75`

Sin cambios desde la ronda 14 (el commit `d7b171f` solo tocó el mensaje del
PDF, no este bloque). El chequeo pre-identidad (`processor.ts:371`) corre
ANTES de `resolveOperador` (`:384`); `buscarTenantPorTelefono` con `.limit(2)`
devuelve `null` ante dos filas (`conv.ts:646-652`); `resolverCuentaOficina`
solo mira `app_user` (`contactos.ts`), y un chofer no es cuenta de oficina.
Resultado (`processor.ts:378-383`):

> "Claro. No te tengo identificado con una flota en Likida, así que no sé a
> qué empresa reclamarle…"

y `return` — sin registro en ningún tenant.

**Escenario, con valores.** OP-102 dejó Transportes Innovativos (A,
`activo=false`) y desde el 1-sep es operador ACTIVO de Flota del Bajío (B,
mismo teléfono, `activo=true`). El 5-sep escribe "PRIVACIDAD". El chequeo
pre-identidad encuentra dos filas → `null` → la respuesta le dice que no está
identificado cuando **sí lo está** (B lo habría resuelto en la línea 384), y
ni A ni B reciben la solicitud. La población que el fix de la ronda 12 quiso
atender sigue pagando el fix de la ronda 13: pasó de "tenant arbitrario" a
"negado y sin registro". El modo de fallo correcto —caer al camino de
identidad y, si la ambigüedad persiste, PREGUNTAR a qué flota se refiere—
sigue sin implementarse.

**Estado: abierto** (regresión introducida por el cierre `574137c`; el
`.limit(2)` existe, el comportamiento resultante es el defectuoso).

### [MEDIO, REGRESIÓN del fix 8a33ce1] El panel y la liquidación se contradicen para la flota SIN DECLARAR: el panel la cuenta como "no deducible (perdida)" y el motor como "por confirmar" — el comentario "Mismo estándar que el motor" es falso

`src/lib/cuadra/fiscal.ts:337,279-283` · `src/lib/cuadra/cuadre/engine.ts:341-345,98,1133`

El fix de la ronda 14 trajo la elegibilidad al panel con este ternario
(`fiscal.ts:337`):

```ts
push(o.elegible15 === true ? 'combustible_efectivo' : 'efectivo_no_elegible');
```

Con el comentario "Mismo estándar que el motor". No lo es para el caso
`undefined`. `elegible15` es `true | false | undefined` (sin declarar —
`comun.tsx:135`), y el ternario manda `false` **y** `undefined` a
`efectivo_no_elegible`, cuyo rótulo (`fiscal.ts:279-283`) es:

> gravedad: **'perdida'** · "Combustible en efectivo sin facilidad" · "la flota
> no califica a la facilidad del 15% (dedicación exclusiva o régimen **no
> declarados**), así que el efectivo en combustible **no es deducible** aunque
> tenga CFDI."

El motor, para `undefined` (`engine.ts:341-345`), emite
`combustible_efectivo` (en `POR_CONFIRMAR`, `engine.ts:98`, y en `REVISAR`,
`engine.ts:1133`):

> "la facilidad del 15%… exige que la flota declare su dedicación y régimen al
> registrarla; **sin esa declaración esto se revisa**."

**Escenario, con valores.** "Flota del Bajío" se da de alta con los checkboxes
sin marcar (tri-estado correcto → config sin la llave). OP-201 paga $1,200 de
diésel en efectivo. La liquidación sale con "por confirmar, se revisa"
(estatus `revisar`). El contador abre `/dashboard/contador/deducciones`: el
mismo comprobante aparece como **perdida** — "no es deducible aunque tenga
CFDI" — y suma $1,200 + su IVA a `montoPerdido` (`fiscal.ts:416`). La misma
flota, el mismo hecho jurídico (nadie declaró nada), dos respuestas: una
afirmación de pérdida definitiva en el panel y una revisión pendiente en el
PDF. Es exactamente la contradicción que la ronda 14 cazó en el motor —"un
checkbox desmarcado se guarda como 'declaró que NO'"— reaparecida del lado
del panel, donde el texto incluso admite que la causa es "no declarados" y aun
así lo cuenta como perdido. (El ivaSostenible del panel sí niega el IVA para
todo efectivo, consistente con el motor: el defecto es solo la rama ISR.)

**Estado: abierto** (defecto propio del cierre `8a33ce1`; el rubro fiscal
probablemente lo reporte también — aquí se audita la afirmación legal).

### [MEDIO, NUEVO — heredado del cierre 8a33ce1] La edición del 15% en la consola es atómica al revés: cambiar UN solo select borra la declaración ENTERA en silencio

`src/app/admin/flotas/page.tsx:56-69` · `src/lib/cuadra/repo.ts:921-930`

La UI de edición (`flotas/page.tsx:133-141`) presenta dos selects
independientes — "Carga: —/Sí/No" y "Régimen: —/Sí/No". La acción los
convierte (`page.tsx:58-59`) y `actualizarFacilidad15` (`repo.ts:925-928`)
hace:

```ts
if (ded !== undefined && reg !== undefined) {
  actual.facilidadCombustibleEfectivo = { dedicacionExclusivaCarga: ded, regimenElegible: reg };
} else {
  delete actual.facilidadCombustibleEfectivo;   // ← un solo select tocado
}
```

Si el superadmin cambia solo "Régimen: No" y deja "Carga: —" (el default),
`ded === undefined` → **se borra la llave entera**: la declaración previa
(ambas condiciones) desaparece y la flota pasa a "sin declarar". El ok que
ve (`page.tsx:69`) dice "Declaración del 15% borrada (sin declarar)" — técnicamente
verdad, pero el usuario pidió cambiar una condición y el sistema eliminó la
otra sin avisarle.

**Escenario, con valores.** La flota declaró `{dedicacionExclusivaCarga:true,
regimenElegible:true}` (válvula abierta, el diésel en efectivo dentro del 15%
se deduce). El superadmin quiere corregir solo el régimen: pone "Régimen: No"
y deja "Carga: —". La config queda sin la llave; desde la siguiente
liquidación todo el diésel en efectivo pasa de "deducible" a "se revisa" —
una afirmación legal (la dedicación exclusiva) que la flota sí declaró se
descarta por un medio-cambio. La dirección es fail-closed (no regala
deducción), pero borra una declaración sin confirmar, y no hay bitácora de
quién la cambió ni cuándo (ver hallazgo de RLS abajo).

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13/14] El segundo chequeo ARCO sigue siendo código muerto: `operador_id` queda NULL en toda solicitud de WhatsApp

`src/lib/cuadra/processor.ts:462-465` vs `src/lib/cuadra/processor.ts:371-383`

Sin cambios desde la ronda 13. Ambos bloques comparten la condición exacta
(`msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)`) y el
primero siempre hace `return` (`:383`). El segundo —el único que pasa
`op.operadorId`— es inalcanzable; su comentario sigue llamándolo "red
redundante". Consecuencia medible: **toda** solicitud ARCO de WhatsApp se
inserta con `operador_id = NULL`, el índice `solicitud_arco_operador_id_idx`
(0071:71) nunca se puebla, y la pantalla nueva —cuando el CRÍTICO se arregle—
mostrará "—" en la columna Titular para todas las filas históricas (el join
`operador:operador_id(nombre)` de `repo.ts:947` devuelve `null`). Degrada el
registro construido para auditar el derecho.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13/14 — AGRAVADO] La cita legal falsa (art. 32 = "15 días") sigue en cuatro lugares y se propagó a la pantalla nueva y a la 0083 — y la prueba sigue sin fijar el valor

`src/lib/cuadra/privacidad.ts:611-615` · `src/lib/cuadra/repo.ts:870-871` ·
`src/lib/cuadra/processor.ts:153-154` · `src/app/admin/compliance/page.tsx:25`
· `supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:95-98,119` ·
`src/lib/cuadra/privacidad.test.ts:367-370` · referencia interna:
`docs/conocimiento/11-datos-personales.md:48,656`

El número (20 días) es correcto y el aviso al titular también
(`privacidad.ts:538`). El fundamento escrito sigue falso: "La LFPDPPP art. 32
fija 15" (`privacidad.ts:612`), "la responsable con 15 días hábiles para
contestar (LFPDPPP art. 32)" (`repo.ts:870-871` y `processor.ts:153-154`),
"20 días hábiles (LFPDPPP art. 32)" (0053:95-98 y :119), y **la pantalla
nueva** (`compliance/page.tsx:25`: "la responsable obligada a contestar en 20
días hábiles (LFPDPPP art. 32) estaba ciega"). Ni el art. 32 abrogado ni el
art. 31 vigente dicen lo que el código les atribuye: la ley 2010 daba "veinte
días hábiles" para responder y "quince días hábiles siguientes" para hacerla
efectiva; la vigente (DOF 20-mar-2025) movió los plazos al art. 31 — lo dice
la propia tabla del repo (`11-datos-personales.md:48`) y su build requirement
(`:656`). La prueba sigue llamándose "venceArco suma 15 DÍAS HÁBILES (LFPDPPP
art. 32)" y su aserción solo verifica que el resultado caiga en día entre
semana (`privacidad.test.ts:367-370`): una regresión de 20 a 15 pasaría verde
sin que nadie la note. La ronda 14 lo dejó anotado; la ronda 15 lo copió a
una pantalla más.

**Estado: abierto** (número corregido por `94a3521`; fundamento, citas y
prueba sin corregir, y ahora propagado).

### [BAJO, REINCIDENTE ronda 12/13/14] `/privacidad` promete borrado de cuenta con confirmación por escrito y retención "un año después de darlo de baja" — sin un solo mecanismo en código

`src/app/privacidad/page.tsx:88,108`

Sin cambios desde la 12: "Tus datos de cuenta, mientras tengas el servicio y
hasta un año después de darlo de baja" (`:88`) y "Se te confirma por escrito
cuando queda hecho" (`:108`). El único borrado del repo sigue siendo
`wa_mensaje_procesado` a los 30 días (`cron/purgar/route.ts:51`); `app_user`
no se toca. Promesa sin mecanismo; sin clientes reales que puedan ejercerla,
por eso BAJO.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 12/13/14] Los documentos legales no tienen versión congelada ni registro de qué versión aceptó el cliente

`src/app/legal/marco.tsx:88` ("Vigente al {fechaMx(new Date().toISOString())}")
· `src/app/terminos/page.tsx:47-49` (§1, aceptación por uso, browsewrap)

Sin cambios: la página que el cliente aceptó la semana pasada es formalmente
un documento distinto al de hoy; §1 acepta por uso, sin casilla ni registro.
Se suma a los 🔴 de razón social, domicilio, jurisdicción y precios que el
propio texto declara pendientes.

**Estado: abierto.**

### [BAJO, REINCIDENTE ronda 13/14 — impacto del demo reducido] El seed sigue publicando razón social/domicilio "INVENTADOS" y declara la elegibilidad fiscal del demo sin marcarla

`supabase/seed.sql:24-45` · `supabase/seed.sql:104-107`

Sin cambios en la razón social y el domicilio (`seed.sql:28`: "🔴 INVENTADOS
los dos primeros… Los dos los tiene que capturar la flota"), y la
declaración de la RFA 2.9 sigue sin la marca:

```sql
'{facilidadCombustibleEfectivo}',
'{"dedicacionExclusivaCarga":true,"regimenElegible":true}'::jsonb   -- RFA 2026 regla 2.9: la flota del demo SÍ califica
```

Ese "SÍ califica" es un hecho jurídico-fiscal sobre una empresa real (el RFC
GMX0902279I1, `seed.sql:20`) que nadie confirmó contra la Constancia, en un
seed cuyo encabezado ordena marcar todo lo no verificado. **Baja el impacto
respecto a la ronda 14:** los tickets del seed son `forma_pago '03'` y `'04'`
(transferencia/tarjeta, `seed.sql:135,139`), no efectivo, así que la nota
"deducible por la facilidad del 15%" no saldrá en la liquidación del demo — la
declaración vive en la config y ahora se muestra ("Carga: Sí / Régimen: Sí")
en la consola de `/admin/flotas`, que la sala no proyecta. Sigue siendo una
afirmación legal sin verificar almacenada como si fuera el dato de la flota.

**Estado: abierto** (decisión de Javier: confirmar contra la Constancia o
marcar la línea INVENTADO; el impacto de sala se redujo porque el guion no
paga diésel en efectivo).

### [BAJO, NUEVO] La RLS de `solicitud_arco` es `for all`: la flota puede BORRAR el registro de la solicitud — el rastro que el diseño declara auditable

`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:202-204`

```sql
create policy solo_admin_flota on public.solicitud_arco for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check (...);
```

`for all` = SELECT + INSERT + UPDATE + DELETE. El diseño de la tabla es
explícito sobre su propósito (`0053:106-108`: "la solicitud tiene que seguir
siendo auditable después de eso" — por eso `titular_ref` se guarda aparte del
FK), y la bitácora vecina sí se blindó como append-only ("No hay policy de
UPDATE ni de DELETE a propósito", `0053:186-187`) — pero la solicitud ARCO,
que es precisamente la constancia de un derecho ejercido contra la flota,
puede ser borrada por el `flota_admin` de esa misma flota. No hay UI que lo
haga, pero la política lo permite desde SQL; un borrado no deja rastro en
`bitacora_auditoria`. Ante la autoridad, la constancia que la flota puede
eliminar no es constancia.

**Estado: abierto.**

### [BAJO, NUEVO] La pantalla nueva mide "Vencen pronto (≤ 5 días hábiles)" con 5 días CALENDARIO, y su fallo silencioso imprime el vacío

`src/app/admin/compliance/page.tsx:63,147-148,140`

El KPI (`:63`) se llama "Vencen pronto (≤ 5 días hábiles)" y su cálculo
(`:147`) es:

```ts
f.vence_en <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)
```

5 × 86,400 s = 5 días **de calendario**, contra un `vence_en` calculado en
días hábiles (`venceArco` salta fines de semana). El rótulo promete una
unidad y mide otra: una solicitud que vence un lunes aparecerá como "pronto"
el jueves anterior (3 días hábiles reales, 4 calendario) o no aparecerá
cuando debería. Y en el mismo `datosDeCompliance`, los `.catch(() => [])` /
`.catch(() => 0)` (`:140,148`) convierten una consulta caída en "Ninguna
solicitud ARCO registrada" / 0 — el patrón ciego que el repo prohíbe, en la
pantalla que nació para que la responsable no quedara ciega.

**Estado: abierto.**

### [BAJO, NUEVO] El plazo de 15 días hábiles para HACER EFECTIVA la respuesta (art. 31) no se registra ni se muestra — solo existe en el texto del aviso

`src/lib/cuadra/privacidad.ts:538` · `supabase/migrations/0053_...:98-119` ·
`src/app/admin/compliance/page.tsx` (columnas: recibida/vence/resuelta)

El aviso promete "20 días hábiles para contestarte y 15 días hábiles más para
hacerlo efectivo". El registro guarda `vence_en` (los 20) y `resuelta_en`,
pero no hay columna ni cálculo para los 15 de ejecución: la pantalla no puede
decirle a la flota cuándo se le vence la segunda fase. La ley vigente (art.
31) hace de esos 15 un plazo real; el producto los rastrea cero. Sin
clientes que puedan ejercer el derecho completo hoy, por eso BAJO — pero es
la mitad del plazo que el aviso promete y el registro no la conoce.

**Estado: abierto.**

## Lo que revisé y está bien

- **Los cuatro cierres fiscales de `8a33ce1` existen y hacen lo que dicen.**
  (1) Alta tri-estado: `flotas/page.tsx:38` mapea checkbox desmarcado a
  `undefined`, y `administracion.ts:110-120` solo escribe la config cuando
  AMBAS condiciones son booleanos — el "sin marcar = declaró que NO" del
  motor quedó cerrado en el alta. (2) Edición en la consola: `accionFacilidad`
  + `actualizarFacilidad15` (`repo.ts:921-930`) leen y escriben la llave, con
  opción explícita de "sin declarar". (3) `engine.ts:311-330`: el excedente
  del 15% se reporta por comprobante (la suma de la columna cuadra), y
  `desde_db.ts:60-62` ancla el ejercicio a la fecha del viaje, no al reloj.
  (4) 0083 exige la FORMA de la llave ("el 'sí' rebota") y
  `migraciones_verificadas.test.ts:54-55` la tiene registrada. La rama
  `undefined` del motor sigue siendo "por confirmar, se revisa"
  (`engine.ts:341-345`) y `efectivo_no_elegible`/`efectivo_sobre_15` entraron
  a `NO_DEDUCIBLE_ISR`, `SIN_ACREDITAMIENTO` y `REVISAR`
  (`engine.ts:97,963,1133`).
- **La mitad de escritura del ARCO sigue respetando sus candados.**
  `registrarSolicitudArco` (`repo.ts:877-901`) inserta con `vence_en =
  venceArco(new Date())` (20 días hábiles reales, `privacidad.ts:618-626`),
  clasifica contra el CHECK `arco_tipo_dominio`, es best-effort con rastro
  ruidoso (`arco.no_registrada`), y el flujo de `atenderPrivacidad`
  (`processor.ts:146-166`) responde primero y registra después — nunca deja
  al titular sin respuesta.
- **El aviso integral mantiene los plazos correctos AL TITULAR.** "20 días
  hábiles para contestarte y 15 días hábiles más para hacerlo efectivo"
  (`privacidad.ts:538`) — que es lo que la ley vigente da (art. 31, según la
  propia documentación del repo). Las citas visibles (art. 15 fr. I-VI, art.
  26 fr. II, art. 7, art. 35, art. 29) coinciden con la numeración 2025; la
  cita falsa vive solo en comentarios, migraciones y la pantalla nueva.
- **Sin aviso no hay tratamiento** (`ponerAvisoADisposicion`): `sin_datos`
  bloquea, `no_entregado` libera el claim, la constancia se escribe solo
  después de `sendText` exitoso — sin cambios desde la 13, releído hoy.
- **Retención CFF art. 30 intacta.** `cron/purgar` borra solo
  `wa_mensaje_procesado` de más de 30 días (`route.ts:51`); el bucket
  `comprobantes` no se toca; la promesa de 5 años del aviso no tiene ningún
  camino de código que la acorte.
- **El `vence_en` guardado es el prometido.** `venceArco` suma 20 días
  hábiles saltando fines de semana y `fechaMx` formatea `vence_en` (DATE sin
  zona) en UTC para no correrlo un día (`formato.ts:107-137`) — la columna
  "Vence" de la pantalla, cuando haya filas, mostrará la fecha correcta.
- **Pruebas del rubro corridas contra HEAD (`d7b171f`):** 312/312 verdes (11
  archivos, listados arriba). `tsc` y `eslint` limpios sobre el código
  commiteado.

## Lo que no alcancé a revisar

- **La fila real del superadmin en la base de producción** (us-east-2): no la
  toco (regla). El CRÍTICO descansa sobre el diseño documentado
  (`tenant-demo.ts:1-5`, `guard.ts`, `0001_init.sql:17`) — si Javier se creó
  su `app_user` con un `tenant_id` puesto contra el diseño, la pantalla
  listaría UNA flota (la suya), no la de todos; en ningún caso "la flota".
- **La matriz fiscal de la RFA 2.9 en profundidad** (interacción con LIF,
  permiso CRE, acreditamiento en frontera): es rubro fiscal; aquí solo audité
  el ángulo de la afirmación legal y la contradicción panel/motor del caso
  `undefined`.
- **El contrato de encargado y el anexo de subencargados con OpenRouter:**
  siguen sin vivir en el repo (el §17 del ToS los marca 🔴 pendientes).
- **Los archivos `zzz-a15-probe.test.ts`, `aud15-temporal.test.ts` y
  `zzz_auditoria15_tmp.test.ts`** (sin trackear, de otros rubros en curso):
  no son míos y no los borro; anoto que `zzz-a15-probe.test.ts` rompe `tsc`
  hoy (importa `PoliticaGasto` de `@/types/cuadra`, que no existe). No es un
  hallazgo del código commiteado, pero el "tsc limpio" de esta ronda depende
  de que se borren antes del cierre.
- **Verificar contra el SAT la razón social, el domicilio y el
  régimen/dedicación del seed** (GMX0902279I1): sin acceso a la Constancia;
  por eso el hallazgo del demo queda como decisión de Javier, no como
  afirmación de falsedad.

## Veredicto

**No es green light.** El entregable que esta ronda prometió cerrar —la
pantalla ARCO donde la responsable ve y responde sus solicitudes— no cierra
nada: es superadmin-only y su consulta filtra por un tenant que el superadmin
no tiene, así que imprime "Ninguna solicitud ARCO registrada" para siempre,
mientras la flota (la obligada) sigue sin ruta que la lea. El ALTO de la
ronda 14 queda abierto en sustancia con una fachada nueva, y encima el ok del
formulario afirma una notificación al titular que ningún código ejecuta. El
ToS cumple su quinta ronda sin tocarse, la regresión del ARCO pre-identidad
sigue negando el derecho al operador con teléfono en dos flotas, y el fix del
panel (8a33ce1) reintrodujo la confusión "sin declarar = no deducible" del
lado de la pantalla. La nota baja de 6 a 5 no por lo que se arregló (los
cuatro cierres fiscales son reales y los verifiqué) sino porque la pieza
legal que esta ronda sí intentó construir llegó rota en su función central, y
las deudas de fondo —ToS, mandato, lector ARCO— siguen cobrando.

**Para el demo de mañana, el rubro legal no bloquea el guion** (el aviso se
sirve, el canal ARCO responde y registra, los tickets del seed no son en
efectivo y el 15% no se imprime). Tres frases preparadas antes de la sala:

1. **No abras `/admin/compliance` en el demo.** Está rota de fábrica: siempre
   dice "Ninguna solicitud ARCO registrada" aunque el webhook haya insertado
   filas — el superadmin no tiene `tenant_id` y la pantalla filtra por él.
   Si alguien pregunta por la flota respondiendo sus ARCO, la respuesta
   honesta es que el registro existe y la pantalla de respuesta es la deuda
   inmediata (es la misma frase que se dijo en la ronda 14, porque el fix no
   funcionó).
2. **La consola de `/admin/flotas` muestra "Carga: Sí / Régimen: Sí" para
   Innovativos** (la declaración del seed, sin marca INVENTADO): si se ve, la
   frase es "el dato lo confirma la flota contra su Constancia antes de
   operar" — igual que la razón social, que sigue sin confirmarse.
3. **El ToS sigue diciendo "No timbra facturas"** mientras la suscripción
   promete "Con estos se emite el CFDI de cada mensualidad": si alguien lo
   lee, es la misma decisión de Javier/abogado desde la ronda 10 — no es un
   desliz de esta ronda.
