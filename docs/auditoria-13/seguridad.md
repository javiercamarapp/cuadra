# Seguridad — auditoría 13

**Nota: 8/10** (baja de 9 de la re-auditoría de la ronda 12). Razón del
movimiento: **los cierres de la ronda 12 están correctos y verificados línea
por línea, pero el barrido de esta ronda encontró un MEDIO nuevo de la MISMA
familia que este rubro persigue desde la ronda 10 —"se acota un id y se
olvida el otro"— y que las rondas 11 y 12 no habían mirado porque su
inventario se concentró en las políticas de LECTURA y en las dos que la 0079
cerró.** La 0078/0079/0080 cierran bien lo que declaran; lo que quedó está
FUERA de sus listas: `operador_sube_su_pod` (0047:190) es la única policy de
ESCRITURA viva del chofer en el esquema, y es la única puerta del código al
estado `'subido'` de la evidencia de entrega — ningún código de la app lo
escribe, y el panel de POD y el tablero de despacho lo leen como "Recibido".
El chofer puede auto-certificar una entrega sin subir nada. Ver hallazgo 1.

---

## Verificación de los cierres de la ronda 12 (el encargo central)

Los tres commits de RLS se abrieron y se leyeron contra el esquema vivo del
repo (todas las migraciones, no solo los archivos):

**0078 (cerrado, correcto).** El `do $$` recorre
`terminal, operador, politica_gasto, wa_conversacion, llm_costo, cfdi_xml,
cfdi_consolidado_linea` y recrea `tenant_data` con
`using`/`with check` = `(tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin()`
(`0078:43`). Para el chofer: SELECT → 0 filas (el brazo `not is_operador()`
falla); INSERT → `with check` rechaza; UPDATE → `using` pasa pero `with check`
falla → 0 filas; DELETE → `using` falla → 0 filas. `tenant_self` quedó
`for select` (`0078:56`) y verifiqué que ninguna escritura de `tenant` usa el
cliente de sesión: `crearFlota` (`administracion.ts:101`), `guardarPolitica`
(`administracion.ts:253`) y `aplicarSuscripcion` (`suscripcion.ts:381`) van
todas por `supabaseAdmin()`. El único SELECT de `tenant` con cliente de sesión
que encontré (`app/cuenta/page.tsx:11`) en realidad usa `supabaseAdmin()` en
la línea 10. Un detalle de prosa: el encabezado del bloque 1 dice "Las SEIS
tablas" y el array trae SIETE — cosmético, no de seguridad.

**0079 (cerrado, correcto).** `app_user_self` quedó
`using (id = auth.uid() or (tenant_id = any(...) and not is_operador()) or is_superadmin())`
(`0079:27`): el chofer conserva la lectura de SU fila (la que `session.ts:70`
necesita con `.eq('id', user.id)`) y pierde la de sus compañeros.
`bitacora_insercion` quedó con `not is_operador()` (`0079:33`): el chofer ya no
siembra la bitácora. El commit `9b625db` corrigió el bloque 55 para esperar
`lee-app_user-ajeno=1` (su propia fila), y lo verifiqué en
`verificaciones.sql:3093-3102` — es la expectativa correcta.

**0080 (cerrado, correcto).** `operador.rfc` es una columna opcional; la
cubre la policy de la 0078 sobre `operador` (oficina lee, chofer no). La
exención de bloque en `migraciones_verificadas.test.ts:53` tiene razón (el
comportamiento se prueba en TS; la columna ausente falla ruidoso).

**Bloques 54 y 55.** Existen (`verificaciones.sql:2967-3131`), siembran filas
en las tablas de la 0078/0079, impersonan a un chofer por
`request.jwt.claims`, y exigen los valores correctos: el 54 las siete lecturas
en cero + UPDATE de tenant en cero + regresión del flota_admin en 2; el 55 las
ESCRITURAS (UPDATE de operador en 0, UPDATE de app_user en 0, INSERT de
bitácora rechazado, `lee-app_user-ajeno=1`, admin-inserta=t) — el hueco de
cobertura que la ronda 12 dejó documentado quedó cerrado.

---

## Hallazgos

### [MEDIO, abierto — nuevo] `operador_sube_su_pod`: el chofer auto-certifica la entrega; es la ÚNICA puerta del código al estado `'subido'`

`supabase/migrations/0047_operacion_encargado.sql:190-191` ·
`src/app/dashboard/pod/vista.tsx:17` · `src/lib/cuadra/operacion.ts:75,455`

```sql
create policy operador_sube_su_pod on public.pod for insert
  with check (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));
```

La policy nació para una función —"el chofer sube SU pod desde la web"— que
**no existe en la app**: el panel `/chofer` no tiene subida de POD, y el
procesador de WhatsApp no escribe `pod` (barrido de `from('pod')`: solo
`operacion.ts`, que inserta `'pendiente'` en `marcarPodPedido` y actualiza
`'rechazado'` en `rechazarPod`). Ningún código de la app escribe
`estado='subido'` en ningún lado (grep de `'subido'`: solo lecturas en
`pod/vista.tsx` y `operacion.ts`). El único camino para que un pod llegue a
`'subido'` es el INSERT directo por PostgREST del propio chofer — la puerta
exacta que la 0078/0079 se proponían cerrar.

**Escenario, con valores.** El chofer de la flota A (sesión web
`rol=operador`, la que el seed del demo provisiona) tiene la anon key pública
y su access token. Para su propio viaje abierto hace:

```
POST /rest/v1/pod
Authorization: Bearer <access_token del chofer>
{ "tenant_id": "<A>", "viaje_id": "<su viaje>",
  "operador_id": "<su operador>",
  "estado": "subido", "storage_path": "falso.jpg" }
```

El `with check` pasa (el `viaje_id` es suyo). Los checks `pod_estado_dominio`
y `pod_subido_tiene_archivo` (`0047:140-144`) pasan con cualquier string no
nulo. Resultado en la oficina: la pantalla POD pinta "Recibido"
(`pod/vista.tsx:17`), el tablero de despacho cuenta el viaje como "con POD"
(`operacion.ts:75` — "Viajes en curso sin POD subido" baja), y nadie vuelve a
perseguir esa evidencia. No hay foto, no hay subida, no hay verificación —
solo el INSERT. Variante menor: con `estado='pendiente'` el chofer gana la
carrera contra `pod_viaje_unico` (`0047:151`) y el `marcarPodPedido` de la
oficina revienta con unique violation.

**Por qué MEDIO y no ALTO**: no cruza la frontera de tenant (el viaje es
suyo; el `tenant_id` foráneo solo crea filas huérfanas que ninguna pantalla
muestra), y la oficina conserva el botón de rechazo sobre un pod `'subido'`
(`pod/vista.tsx:101`), así que el daño se puede revertir a mano. Pero es
tamper de la constancia de entrega —el mismo apetito que la 0078 documenta
cerrar para el teléfono y la bitácora— y el bloque 28 (`verificaciones.sql:1068`)
solo ejercita la LECTURA del chofer sobre pod (`pods-visibles=1,
pod-ajeno-por-id=0`); el INSERT no está verificado por nadie.

**El arreglo honesto**: el chofer no tiene hoy ningún flujo legítimo que
escriba `pod` desde la web, así que la policy sobra: `drop policy
operador_sube_su_pod` (y su gemela de lectura se puede dejar o acotar con
`and tenant_id = any(get_user_tenant_ids())` para cerrar también el BAJO de
la ronda 12). El día que exista la subida real desde `/chofer`, la policy
vuelve con la verificación del archivo en Storage. Estado: **abierto**.

---

### [BAJO, abierto — residual de la 0079] `bitacora_insercion` dejó la asimetría para contador y encargado: escriben lo que no pueden leer

`supabase/migrations/0079_rls_chofer_sin_lectura_personal.sql:33` ·
`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:197`

La 0079 cerró al chofer (el MEDIO de la ronda 12) con `not is_operador()`, y
el fix es correcto para él. Pero el `with check` resultante
`((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())`
sigue dejando INSERT a **contador y encargado**, que la lectura (`bitacora_lectura`
exige `administra_flota()` = solo flota_admin/superadmin, `0053:197`) NO les
permite ver. El que escribe no tiene por qué ser quien pueda leer — exactamente
la frase que la ronda 12 usó para calificar el MEDIO original.

**Escenario, con valores.** El contador de A (misma sesión, rol `contador`,
que SÍ puede leer `ve_finanzas` pero no `administra_flota`) hace:

```
POST /rest/v1/bitacora_auditoria
{ "tenant_id": "<A>", "actor_email": "jorge@transportes-a.mx",
  "accion": "flota.politica.cambiada", "entidad": "tenant",
  "entidad_id": "<A>", "detalle": { "tope_diesel": 20000 } }
```

Pasa el `with check`. El `flota_admin` —el único que lee la bitácora— encuentra
una entrada con el correo del dueño como actor por algo que nunca ocurrió. El
riesgo es menor que con el chofer (contador y encargado son roles de oficina
con acceso a datos sensibles de todas formas), pero la 0079 era el momento
natural de alinear la escritura con la lectura: `administra_flota()` en el
`with check`, igual que el `bitacora_lectura`. Estado: **abierto** (residual,
misma familia).

---

### [BAJO, abierto — nuevo] El bucket público `avatares` acepta cualquier tipo de archivo de cualquier autenticado

`supabase/migrations/0046_perfil_avatar.sql:17-20,28-30`

El bucket es público a propósito (avatares) y la policy de INSERT permite a
TODO `authenticated` escribir en su carpeta `{auth.uid()}/` sin restringir
tipo de archivo ni content-type. La app solo sube imágenes (`mi-perfil`
filtra `accept="image/*"` del lado del cliente, y el server action es de
superadmin), pero la puerta de PostgREST no distingue: cualquier chofer con
sesión puede subir un `.html` a una URL pública en
`<proyecto>.supabase.co/storage/v1/object/public/avatares/<uid>/...`.

**Escenario, con valores.** El chofer de A (sesión web) sube `phish.html`
con un formulario que imita la pantalla de login de Likida a su carpeta de
avatares, y comparte la URL pública. Se sirve desde el dominio de Supabase
(no `app.likida.ai`), así que no hay XSS en la app — pero es hosting público
de contenido arbitrario en un subdominio de confianza del proyecto, y el
bucket puede llenarse sin límite de mime. El arreglo de una línea:
`with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','gif','avif'))`.
Estado: **abierto**.

---

### [BAJO, abierto — deuda de la ronda 12, sin cambios] Las policies de lectura del chofer siguen sin componer tenant

`supabase/migrations/0045_rls_operador.sql:52-58` ·
`supabase/migrations/0047_operacion_encargado.sql:187-193`

`operador_ve_su_viaje/gastos/liquidaciones/pod` siguen sin comparar
`tenant_id`. Sigue sin ser explotable por las dos capas que ya documentó la
ronda 12: la FK compuesta `viaje_operador_tenant_fkey` (`0028:96`) hace
imposible un viaje de A apuntando al operador de B, y `app_user.operador_id`
solo lo escribe el service-role (la 0079 no añadió policy de UPDATE, y el
bloque 55 prueba que el UPDATE del chofer toca 0 filas). Deuda de defensa en
profundidad, no vulnerabilidad explotable. La sugerencia del hallazgo 1
(`and tenant_id = any(...)` en las cuatro) la cerraría en el mismo movimiento.
Estado: **abierto** (documentado, sin regresión).

---

## Lo que revisé y está bien

**Los dos IDOR de dinero de la ronda 10, re-verificados.** Export CSV
(`export/liquidaciones/route.ts:58-73`) y PDF (`export/pdf/[id]/route.ts:63-78`)
comprueban `puedeVerArea(t.rol, 'dinero')` ANTES de `puedeExportar` y ANTES de
tocar la base, con el tenant resuelto de la sesión (`resolverTenantApi`), y el
PDF filtra `.eq('tenant_id', tenantId)` explícito. El rail
(`api/dashboard/asistente/route.ts:40-46`) y el chat
(`dashboard/chat/page.tsx:47`) comprueban `dinero` antes de llamar a
`getKpis`/`getAcreditables`. El export fiscal (`contador/cfdi/export/route.ts`)
tiene TRES puertas (`getSessionTenant` + `puedeVerRuta` + `puedeExportar`) y
el `?tenant=` solo lo honra un superadmin contra un uuid existente.

**El fix del MEDIO backend de la ronda 12, verificado en los tres sitios.**
`marcarPodPedido` (`operacion.ts:382-400`), `asignarUnidad`
(`operacion.ts:686-694`) y `crearIncidencia` (`operacion.ts:736-746`) llaman
`viajePropio`/`operadorPropio`/`unidadPropia` ANTES de escribir; los demás
writes de `operacion.ts` (rechazarPod, cambiarEstadoUnidad,
cambiarEstadoIncidencia) filtran `.eq('tenant_id', tenantId)` en el propio
UPDATE. `crearViaje` mantiene su candado doble (`operacion.ts:531-556`).

**`resolverTenantPedido` (nuevo en ronda 12) está en las 14 acciones que
escriben** (`[id]/page.tsx`, politicas, operadores, unidades, pod,
incidencias, documentos, despacho, suscripcion, combustible-casetas): falla
ruidoso ante error de red y solo un superadmin lo invoca. Las acciones
re-chequean su permiso adentro (`puedeAdministrar`/`puedeAsignar`/
`puedeVerRuta`), incluidas las de /admin que re-pasan `requireSuperadmin`
(flotas, usuarios/nuevo, mi-perfil).

**RLS — inventario completo de las 46 `create policy`.** El chofer quedó sin
ninguna policy de escritura en el esquema público salvo
`operador_sube_su_pod` (hallazgo 1) y los avatares (hallazgo 3). Las 8 tablas
de servicio (wa_mensaje_procesado, codigo_pendiente, comprobante_huerfano,
viaje_lock, portal_credencial, llm_costo_mensual, evento_stripe) siguen en
deny-all sin policy, que es lo correcto. `factura_viaje`, `ticket_mensaje` y
`cfdi_consolidado_linea` resuelven el tenant por EXISTS/columna propia, sin
segunda copia desincronizable.

**Helpers de RLS endurecidos**: `get_user_tenant_ids`, `is_superadmin`,
`is_operador`, `get_user_operador_id`, `ve_finanzas`, `administra_flota` son
SECURITY DEFINER con `search_path = public, pg_temp` (0074 + definiciones), y
`ve_finanzas`/`administra_flota` con EXECUTE revocado de `public`/`anon`
(0054:48-52). `factura_saldo` es `security_invoker` (0054:42).

**CSP vigente y escrita contra el inventario real** (`proxy.ts:59-78`):
`script-src 'unsafe-inline'` documentado (Next `__next_f.push`), `connect-src
'self'` verificado contra los dos `fetch` de cliente, `frame-ancestors 'none'`
+ `X-Frame-Options: DENY`, HSTS en producción, `Cache-Control: no-store` en
las rutas autenticadas. Sin `dangerouslySetInnerHTML` ni `eval` en `src/` (el
`new Function` de `tenants_reales.test.ts:77` es de un test que evalúa
expresiones de sus propios fixtures).

**Endpoints expuestos**: webhook de WhatsApp verifica HMAC con
`timingSafeEqual` y cap de body (`webhook/whatsapp/route.ts:95-101`), los tres
cron exigen `Authorization: Bearer <CRON_SECRET>` y fallan cerrado sin él, el
webhook de Stripe verifica la firma y contesta 503 si no hay secreto
(`stripe/webhook/route.ts:44-60`), `/api/demo` es cómputo puro con rate-limit.
El `next` del login/callback solo acepta rutas `/dashboard` (sin open
redirect).

**Secretos**: cero clientes con `use client` importan `supabaseAdmin` o leen
variables de secreto; `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`WHATSAPP_APP_SECRET`, `STRIPE_SECRET_KEY`, `FACTURAPI_SECRET_KEY` viven solo
del lado servidor; `.env.local` no está versionado; `.env.example` no trae
valores. `next.config` documenta y excluye `.env*` del bundle de funciones
(lección del 28-jul).

**Storage**: `comprobantes` y `liquidaciones` privados sin policies (solo
service-role escribe y firma; `ligaComprobante` 3600 s, `ligaPdf`/chofer 600 s).
El chofer solo recibe ligas firmadas de filas que su propia RLS ya filtró
(`chofer.ts:414-424`).

**Pruebas de este rubro**: `npx vitest run` sobre proxy, guard, permisos,
visibilidad, tenant-efectivo, session, provisionar, migraciones_verificadas,
env, ratelimit — **217 pruebas, 10 archivos, todo verde**. `npx tsc --noEmit
-p .` limpio (exit 0).

---

## Lo que NO alcancé a revisar

- **No corrí los bloques 54/55 contra la base real.** Regla de esta ronda: no
  tocar la base. Verifiqué que los bloques existen y que sus expectativas son
  correctas contra las policies, pero no puedo afirmar que pasen en vivo —
  la síntesis de la ronda 12 dice que 26/28/44/53/54/55 pasan; no lo
  re-ejecuté.
- **Pen-test real contra PostgREST de producción** (curl con sesión de chofer
  para el escenario del hallazgo 1). Razonado contra las policies, no
  ejecutado.
- **El esquema de Auth de Supabase** (plantillas de magic link, proveedores
  OAuth, SMTP) vive en el panel, no en migraciones.
- **La suite completa** no la corrí (otros auditores la corren); corrí las 217
  de mi rubro.
- **La pérdida del query string en `next` del login** (las ligas profundas
  `/chofer/...` aterrizan en `/chofer` home tras iniciar sesión, porque el
  login solo honra `/dashboard`) la vi y la dejé — es UX/frontend, no
  seguridad (y la dirección segura del `next`, que no permite open redirect,
  es correcta).

---

## VEREDICTO

**Green light para la demo, con un MEDIO nuevo documentado.** Los cierres de
la ronda 12 (0078, 0079, 0080, bloques 54/55, los IDOR de dinero, los candados
de `operacion.ts`, `resolverTenantPedido`, el export paginado) están puestos y
hacen lo que dicen. El hallazgo 1 (`operador_sube_su_pod`) es la única policy
de escritura viva del chofer y la única puerta al estado `'subido'` de la
evidencia de entrega: no bloquea la demo (requiere sesión web de chofer +
PostgREST directo + conocer el `viaje_id`; no es disparable desde la UI), pero
es exactamente la familia que este rubro cobra desde la ronda 10 y la 0079 era
el momento natural de barrerla — la lista de "tablas del chofer" de la 0078
miró LECTURA y la 0079 miró las dos que se habían reportado; el pod de
ESCRITURA se quedó fuera de ambas.

Recomendación de cierre, con su prueba (la regla del candado sin arnés):
`drop policy operador_sube_su_pod` + extensión del bloque 55 que intente el
INSERT del chofer y exija rechazo; alinear el `with check` de
`bitacora_insercion` con `administra_flota()`; y el mime check del bucket
avatares. Cualquiera de los tres es de una línea y con bloque de verificación.
