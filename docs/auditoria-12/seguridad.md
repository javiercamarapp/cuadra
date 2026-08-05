# Seguridad — auditoría 12

**Nota: 8/10** (igual que auditoría 10 tras arreglos). Razón del movimiento:
**se atacó y se verificó el grueso, y quedaron dos MEDIO de la misma familia
sin tocar.** La migración 0078 (SEC-C2 + DATOS-C2) se revisó línea por línea
contra el inventario completo de políticas RLS del esquema y **cierra bien lo
que declara**: las 7 tablas que arrastraban `tenant_data` a secas y el
`tenant` escribible. Pero la familia que este rubro persigue desde la ronda 10
—"se acota el tenant y se olvida el rol/dueño del segundo id"— tiene **dos
instancias que la 0078 no cubrió**: `app_user` sigue siendo leíble ENTERA por
un chofer (0001:127), y `bitacora_auditoria` sigue siendo escribible por un
chofer (0053:199). Ninguna de las dos está en la lista de la 0078 ni en su
bloque de verificación. No bajan la nota porque ninguna cruza la frontera de
tenant — pero son la misma clase de deuda que este rubro lleva tres rondas
cobrando, y la 0078 era el momento natural de cerrarlas.

---

## La 0078, línea por línea (el encargo central de esta ronda)

`supabase/migrations/0078_rls_chofer_sin_escritura.sql` — 61 líneas, dos
movimientos. Los verifiqué contra el esquema vivo del repo (todas las
migraciones, no solo el archivo):

**Bloque 1 (`0078:25-46`)** — el `do $$` recorre
`terminal, operador, politica_gasto, wa_conversacion, llm_costo, cfdi_xml,
cfdi_consolidado_linea`, hace `drop policy if exists tenant_data` y recrea con
`for all` + `using` + `with check`:

```sql
((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
```

Es exactamente el patrón que la 0045/0047/0050/0051/0053 ya usaban, y el
análisis de cada verbo sale correcto:

- **SELECT**: el chofer falla `not is_operador()` → 0 filas. Un `flota_admin`
  o `contador` sigue viendo lo suyo (regresión comprobada por el propio bloque
  54 de `verificaciones.sql:2970-3034`, que impersona a un `flota_admin` y
  espera `admin-ve-operador=2`).
- **INSERT**: solo aplica `with check` → chofer rechazado.
- **UPDATE**: aplican `using` (fila vieja) Y `with check` (fila nueva). Para un
  chofer sobre filas de SU tenant, `using` pasa (su `tenant_id` está en
  `get_user_tenant_ids()`), pero `with check` falla (`not is_operador()` es
  false) → el UPDATE no toca ni una fila. Es el caso correcto: un `for all`
  con `using` y `with check` idénticos cierra escritura y borrado a la vez.
- **DELETE**: solo `using` → falla por `not is_operador()` → 0 filas.

**Bloque 2 (`0078:54-61`)** — `tenant_self` pasa de `for all` a `for select`
con `using (id = any(get_user_tenant_ids()) or is_superadmin())`. El chofer
puede LEER su fila (nombre, rfc, `config.politica` — que de todas formas ya le
llega por la herramienta `consultar_politica` del WhatsApp), y ya NO puede
UPDATEAR ni BORRAR. Verifiqué que la app no escribe `tenant` con el cliente de
sesión en ningún punto: las escrituras del repo (`administracion.ts:101` —
INSERT de `crearFlota`; `administracion.ts:253` — UPDATE de `config`
(política); `suscripcion.ts:381` — UPDATE de `plan`) van todas por
`supabaseAdmin()` (service-role, salta RLS), y las lecturas también
(`repo.ts:619`). El único SELECT con cliente de sesión que encontré
(`app/cuenta/page.tsx:11`) en realidad usa `supabaseAdmin()` en la línea 10.
**No hay regresión posible por el cambio a select-only.**

**Verificación en vivo**: existe el bloque 54 de `supabase/verificaciones.sql`
(`2970-3034`), que siembra filas en las 7 tablas + tenant, impersona a un
chofer con `set local role authenticated` + JWT claims, y exige
`0/0/0/0/0/0/0/0/1/2` (siete lecturas en cero, un UPDATE de tenant que no toca
nada, un SELECT de tenant que sí ve, y un `flota_admin` que sigue viendo sus 2
operadores). El `migraciones_verificadas.test.ts` obliga a que la 0078 tenga
bloque, y lo tiene.

**El inventario completo confirma que no quedó ningún `tenant_data` a secas:**
barrido de las 28 `create policy ... for all` del esquema — todas las que
filtran por tenant excluyen ya al chofer (`not is_operador()`), piden
`ve_finanzas()` (dinero), `administra_flota()` (control), o son de
catálogo/superadmin. Las tablas de servicio (wa_mensaje_procesado,
codigo_pendiente, comprobante_huerfano, viaje_lock, portal_credencial,
llm_costo_mensual) siguen en deny-all sin policy, que es lo correcto.

**Veredicto de la 0078: el fix es correcto y no tiene huecos en lo que
declara.** Los huecos que encontré están FUERA de su lista (ver hallazgos 1 y
2) y en su cobertura de verificación (hallazgo 4).

---

## Hallazgos

### [MEDIO, abierto] `app_user_self` sigue dándole al chofer la lectura de TODA su flota — la 0078 no la tocó

`supabase/migrations/0001_init.sql:127` (policy `app_user_self`) ·
`src/lib/auth/session.ts:70` (el chofer SÍ necesita leer SU fila con el cliente
de sesión, así que la policy no se puede simplemente borrar)

```sql
create policy app_user_self on app_user for select
  using (id = auth.uid() or tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

El encabezado de la 0078 declara que el chofer "pierde la lectura de lo que no
es suyo" — y luego lista siete tablas. `app_user` no está entre ellas, y la
razón que la 0078 da para cerrar `wa_conversacion` ("datos personales de
terceros, LFPDPPP") aplica igual aquí.

**Escenario, con valores.** Tenant A con un `flota_admin` (email
`jorge@transportes-a.mx`, rol `flota_admin`) y un contador. El chofer de A
tiene sesión web (`rol=operador`) y la anon key pública (que es pública por
definición en Supabase). Con un `fetch` directo a PostgREST:

```
GET /rest/v1/app_user?select=email,nombre,rol,operador_id
Authorization: Bearer <access_token del chofer>
```

`tenant_id = any(get_user_tenant_ids())` es verdadero (su propio tenant) → la
policy pasa → recibe las filas de TODOS los usuarios de su flota: los correos
corporativos, los nombres completos, los roles y —la más jugosa— el `operador_id`
de cada cuenta web, es decir el mapa de quién es quién entre cuentas y
identidades de WhatsApp. La UI del chofer no muestra nada de esto; la puerta es
PostgREST directo, que es exactamente la puerta que la 0078 dice estar cerrando
en su encabezado ("la app no es la única puerta a PostgREST").

**Por qué es MEDIO y no ALTO**: no cruza la frontera de tenant (solo su propia
flota), y no hay escritura (no existe policy de UPDATE en `app_user`, así que
ni el chofer ni nadie autenticado puede modificarla — solo service-role, vía
`provisionar.ts`). Es exposición de datos personales de terceros dentro del
tenant, no una fuga entre inquilinos.

**El arreglo correcto cabe en una línea y respeta el uso legítimo**: el chofer
necesita leer SU fila (`session.ts:70` la consulta con `.eq('id', user.id)`):

```sql
create policy app_user_self on app_user for select
  using (id = auth.uid()
      or (tenant_id = any(get_user_tenant_ids()) and not is_operador())
      or is_superadmin());
```

No está hecho en la 0078. Estado: **abierto**.

---

### [MEDIO, abierto] `bitacora_insercion` deja al chofer escribir en la bitácora de auditoría de su flota

`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:199-200`

```sql
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

Misma familia que la 0078, en la dirección contraria: ahí el chofer perdía
ESCRITURA; aquí conserva INSERT sobre la tabla que registra las acciones de su
flota (`anotar()` en `administracion.ts:39` escribe `accion, entidad,
entidad_id, detalle, actor_email`). La lectura sí está bien cerrada
(`bitacora_lectura` exige `administra_flota()`, 0053:197-198) — pero el que
escribe no tiene por qué ser quien pueda leer.

**Escenario, con valores.** El chofer de A (misma sesión que arriba) hace:

```
POST /rest/v1/bitacora_auditoria
{ "tenant_id": "<A>", "actor_email": "jorge@transportes-a.mx",
  "accion": "flota.politica.cambiada", "entidad": "tenant",
  "entidad_id": "<A>", "detalle": { "tope_diesel": 20000 } }
```

El `with check` pasa (`tenant_id` es de su flota). El `flota_admin` de A abre
su bitácora (la lee por `administra_flota`) y encuentra una entrada de cambio
de política que nunca ocurrió, con el correo del dueño como actor. En un
conflicto donde la bitácora sea la evidencia (cambios de política, avisos de
privacidad, ARCO), un chofer puede sembrar ruido o falsas constancias — no
puede borrar ni corregir las reales (no hay policy de UPDATE/DELETE), pero
puede hacer que la evidencia deje de ser confiable.

**Por qué MEDIO y no BAJO**: es una tabla de auditoría, y la 0053 la define
como append-only "para que nadie la corrija ni la borre" — la protección está
pensada contra la alteración, pero dejó el INSERT abierto al rol que la
alteración intenta documentar. El fix es el mismo `not is_operador()` de la
0078 en el `with check`. Estado: **abierto**.

---

### [BAJO, abierto — deuda de defensa en profundidad] Las policies de lectura del chofer no componen tenant; el aislamiento vive en una FK, no en la RLS

`supabase/migrations/0045_rls_operador.sql:52-59` (`operador_ve_su_viaje`,
`operador_ve_sus_gastos`, `operador_ve_sus_liquidaciones`) ·
`0047_operacion_encargado.sql:187-193` (`operador_ve_su_pod`,
`operador_sube_su_pod`)

```sql
create policy operador_ve_su_viaje on public.viaje for select
  using (operador_id = get_user_operador_id());
```

Ninguna compara `tenant_id`. La 0045 lo documenta a propósito ("un chofer ve
SOLO lo suyo" vía el `operador_id`), y hoy **no es explotable** porque hay dos
capas que lo impiden: la FK compuesta de la 0028
(`0028_fks_con_tenant.sql:96` — `viaje_operador_tenant_fkey
(operador_id, tenant_id) references operador(id, tenant_id)`) hace imposible
que un viaje de A apunte al operador de B, y `app_user.operador_id`
(`0045:21`) solo lo escribe el service-role (no hay policy de UPDATE en
`app_user` y ningún código del repo —ni `scripts/`— lo setea; la liga se hace
a mano fuera del repo, vía SQL de administración).
Además la app compensa con `.eq('tenant_id')` + `.eq('operador_id')` explícitos
en cada lectura (`chofer.ts:231-232,256,317,380`; `mis-viajes/page.tsx:66-67`).

**El problema honesto**: la promesa de aislamiento del chofer vive en una
constraint (la FK de la 0028) y en la disciplina de la app, NO en las policies.
Si la FK se dropeara, o un bug de service-role escribiera un `operador_id` de
otra flota en `viaje` o en `app_user.operador_id` (que es una FK SIMPLE a
`operador(id)`, sin tenant — `0045:21`), el chofer leería los viajes, gastos,
liquidaciones y PODs de otro tenant en silencio, porque `operador_ve_su_viaje`
no le exige que el viaje sea de su flota. Es el escenario exacto del ALTO de la
auditoría 10, con la diferencia de que hoy la base SÍ lo bloquea. Documentado
como deuda, no como vulnerabilidad explotable. Estado: **abierto** (defensa en
profundidad pendiente).

---

### [BAJO, informativo — hueco de cobertura] El bloque 54 de `verificaciones.sql` no ejercita las ESCRITURAS del chofer, que son el escenario titular de la 0078

`supabase/verificaciones.sql:2970-3034`

El encabezado de la 0078 describe como daño principal "leer y **MODIFICAR** los
teléfonos y nombres de TODA la flota". El bloque 54 prueba las siete lecturas
en cero, el UPDATE de `tenant` en cero filas, y la regresión del `flota_admin`.
No prueba ni un INSERT, ni un UPDATE, ni un DELETE del chofer sobre las 7
tablas — por ejemplo, el `UPDATE operador SET telefono='<su número>' WHERE
tenant_id='<A>'` que el encabezado describe como robo de identidad de WhatsApp.

La policy lo bloquea por construcción (el `with check` con `not is_operador()`
falla en UPDATE, y el `using` también), así que **no es un bug, es una laguna
de verificación**: el escenario más caro de la migración es el único que la
base no demuestra en vivo. Un bloque 55 (o una extensión del 54) que intente el
UPDATE y exija `ROW_COUNT = 0` cerraría la laguna. Estado: **abierto** (cobertura).

---

## Lo que revisé y está bien

**El cierre doble del ALTO de la auditoría 10, verificado.** El hallazgo de
`reasignarOperador`/`crearViaje` quedó cerrado en DOS capas, y la segunda ya
existía cuando la auditoría 10 lo escribió: la 0028 (`0028:96`) creó
`viaje_operador_tenant_fkey (operador_id, tenant_id) → operador(id, tenant_id)`
el 28-jul, así que la afirmación de aquella ronda de que "no hay restricción de
base" era incorrecta — el UPDATE cruzado revienta por FK. La capa de app quedó
puesta igualmente: `repo.ts:125-128` (`reasignarOperador` llama `getOperador`
antes de escribir) y `operacion.ts:516-520` (`crearViaje` comprueba el operador
por tenant antes del insert). Cinturón y tirantes, y los dos verificados en el
código actual.

**Inventario RLS completo, tabla por tabla.** Las 28 `create policy ... for
all` del esquema y las 6 tablas deny-all vigentes (wa_mensaje_procesado,
codigo_pendiente, comprobante_huerfano, viaje_lock, portal_credencial,
llm_costo_mensual — `foto_pendiente` ya no existe, la revirtió la 0041):
ninguna deja al chofer con lectura o escritura de lo que no es suyo fuera de
los dos MEDIO de arriba. La 0078 no dejó ninguna tabla de la familia
`tenant_data` sin el `not is_operador()`.

**Las tres rutas de dinero de la auditoría 10, re-verificadas en orden de
líneas.** Export CSV (`export/liquidaciones/route.ts:46-51`) y PDF
(`export/pdf/[id]/route.ts:63-68`) preguntan `puedeVerArea(t.rol, 'dinero')`
ANTES de `puedeExportar` y ANTES de tocar la base, con `tenantId` resuelto de la
sesión (`resolverTenantApi`). El rail (`api/dashboard/asistente/route.ts:42`)
y el chat (`dashboard/chat/page.tsx:47`) comprueban `dinero` antes de llamar
a `getKpis`/`getAcreditables`. El `?tenant=` solo lo honra un superadmin y
contra un uuid que exista (`tenant-api.ts:44-50`, `tenant-efectivo.ts:120-123`).

**CSP existe y está escrito contra el inventario real de la app.**
`proxy.ts:59-78` — `script-src 'unsafe-inline'` documentado (Next inyecta
`__next_f.push`), `connect-src 'self'` verificado contra los dos `fetch` de
cliente, `frame-ancestors 'none'` además de `X-Frame-Options: DENY`. El BAJO
reincidente desde la ronda 8 quedó cerrado en la 10 y sigue cerrado.

**`/acceso` y `passcode.ts` borrados enteros; `arranque.ts` ya no miente.**
El aviso de arranque que describía un gate que no existía se reescribió
(`observability/arranque.ts:20-33`). El BAJO informativo de la ronda 10 está
cerrado.

**Escrituras de `tenant` solo por service-role** (`administracion.ts:101,253`,
`suscripcion.ts:381` — todas `supabaseAdmin()`; lecturas también por admin,
`repo.ts:619`). El cambio a select-only de la 0078 no rompe ningún flujo.

**Storage**: buckets `comprobantes` y `liquidaciones` privados sin policies
(deny-all, service-role escribe y firma; `ligaComprobante` con TTL 3600s por
default, `ligaPdf` 600s). Bucket `avatares` público a propósito y solo avatares.

**Endpoints expuestos**: webhook de WhatsApp verifica HMAC
(`webhook/whatsapp/route.ts:95`), los tres cron exigen `Authorization: Bearer
<CRON_SECRET>`, Stripe verifica la firma, `/api/demo` es cómputo puro sin DB
con rate-limit. El matcher del proxy excluye `/api` a propósito.

**Helpers de RLS endurecidos**: las cuatro funciones de las que cuelga toda la
seguridad (`get_user_tenant_ids`, `is_superadmin`, `is_operador`,
`get_user_operador_id`) son SECURITY DEFINER con `search_path = public, pg_temp`
(0074:31-33); `ve_finanzas` y `administra_flota` lo traen en su definición y
tienen EXECUTE revocado de `public`/`anon` (0054:48-52). La única vista
(`factura_saldo`) es `security_invoker` (0054:42).

**Sin sumideros de XSS**: cero `dangerouslySetInnerHTML`, cero `eval`/`new
Function` en `src/`.

**Pruebas de este rubro**: `npx vitest run` sobre proxy, guard, permisos,
visibilidad, tenant-efectivo, chofer, repo_operadores — **218 pruebas, 7
archivos, todo verde**. `npx tsc --noEmit -p .` limpio (exit 0).

---

## Lo que NO alcancé a revisar

- **No corrí el bloque 54 contra la base real.** Regla de esta ronda: no tocar
  la base de datos. Verifiqué que el bloque existe y que su construcción es
  correcta, pero no puedo afirmar que la 0078 esté aplicada en producción ni
  que el bloque pase en vivo — si la migración aún no se aplicó, los huecos que
  describe su encabezado siguen abiertos en el proyecto real. Es una
  verificación de una línea para quien tenga acceso al SQL editor.
- **El esquema de Auth de Supabase** (auth.users, proveedores OAuth, SMTP,
  plantillas de magic link) no se audita desde este repo — vive en el panel de
  Supabase, no en migraciones.
- **Pruebas de penetración reales** (curl contra PostgREST de producción con
  una sesión de chofer). El escenario de los hallazgos 1 y 2 está razonado
  contra la policy, no ejecutado.
- La suite completa (3,079) no la corrí — otros auditores la corren; corrí las
  218 de mi rubro.

---

## VEREDICTO

**Green light para seguridad, con dos MEDIO documentados y sin arreglar.**
La 0078 cierra correctamente SEC-C2 y DATOS-C2: las 7 tablas que arrastraban el
`tenant_data` viejo quedan con `not is_operador()` en `using` y `with check`, y
`tenant` queda en solo lectura, sin romper ningún flujo de la app (todas las
escrituras van por service-role) ni la regresión de oficina (verificada por el
bloque 54). Los tres hallazgos de la auditoría 10 —export con dinero, chat,
CSP— siguen cerrados y verificados en el código actual.

Para la demo de mañana no hay nada en este rubro que bloquee: los dos MEDIO
abiertos requieren una sesión de chofer + PostgREST directo, no son
disparables desde la UI, y no cruzan la frontera de tenant. La recomendación de
cierre es la misma familia de siempre: `app_user_self` y `bitacora_insercion`
merecen su `not is_operador()` (el primero con el `id = auth.uid()` conservado,
porque `session.ts:70` depende de leer la propia fila), y el bloque 54 merece
una extensión que ejercite el UPDATE del chofer. Cualquiera de los dos, si se
toca, con su prueba — el candado sin arnés es el error que este rubro ya
documentó dos veces.
