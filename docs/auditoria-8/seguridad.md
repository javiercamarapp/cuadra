# Seguridad — auditoría 8

**Nota: 8/10** (antes 8). Razón del movimiento: **deuda que cobró factura**, y
por eso no sube. El barrido de producción de `3e9eb82` es trabajo real y sus
afirmaciones **se sostienen contra el catálogo vivo** —las comprobé yo, una por
una, no las leí del mensaje del commit—: cero tablas sin RLS, cero políticas que
digan `true`, once políticas todas acotadas por `get_user_tenant_ids()`, bucket
`liquidaciones` privado, ninguna de las nueve RPC internas ejecutable por `anon`,
ninguna vista. Y de paso cierra dos de los cinco pendientes que la ronda 6 dejó
escritos como "no alcancé a revisar". Eso apunta hacia arriba.

Lo que lo cancela: **los cuatro hallazgos de la ronda 6 siguen exactamente
igual, ninguno se tocó** —dos de ellos llevan abiertos desde la ronda 5, y el de
la URL firmada es su tercera aparición—, y la única migración de seguridad de
este período **quedó regresada por la migración siguiente, del mismo día**: el
linter de Supabase, consultado hoy contra la base real, reporta un
`function_search_path_mutable`, y es `gasto_no_tras_liquidar` de la 0036. La
`0035` cerró diez y la `0036` abrió uno, con minutos de diferencia, y no hay
nada en el repo que lo vea.

El ancla del 8 se cumple y por eso la nota no baja: toda ruta privilegiada
tiene dos capas independientes (proxy + `exigirAcceso` en las páginas;
`tokenMatches` + filtro explícito por tenant en los dos export; RLS + `.eq` a
mano en el pipeline) y ningún secreto tiene fallback silencioso. El ancla del 9
no se cumple: el arreglo de seguridad de esta ronda no aguantó un día, lo que
demuestra que no está anclado por ninguna comprobación.

**No encontré ningún crítico ni ningún alto.** No hay acceso sin autenticar a
datos de un tenant, ni un secreto con fallback derivado, ni un identificador
externo que decida una fila sin comprobarse en servidor.

El riesgo mayor del rubro hoy: **el trabajo de seguridad se hace por barrido
manual y nada lo sostiene entre barridos** — la prueba es que la regresión de la
`0036` ocurrió el mismo día del barrido que la cerró y nadie la vio.

---

## Hallazgos

### [BAJO] `gasto_no_tras_liquidar` (0036) nace sin `search_path` fijo, el día que la 0035 lo cerró en las otras diez

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:55-70`

```sql
create or replace function gasto_no_tras_liquidar()
returns trigger
language plpgsql
as $$                                    -- ← sin `set search_path`
...
  perform 1 from viaje where id = new.viaje_id for update;
  select exists (select 1 from liquidacion where viaje_id = new.viaje_id) into ya;
```

**Escenario, con la secuencia y los valores reales.** El 31-jul a las 23:34,
`3e9eb82` aplica la `0035` y cierra los diez WARN de
`function_search_path_mutable`. El commit siguiente, `45a0e08`, aplica la `0036`,
que crea `public.gasto_no_tras_liquidar()` sin `set search_path`. Consultado hoy
(1-ago-2026) contra el proyecto real `gngoqsvrxdguxvsizpbw`:

```
pg_proc.proconfig de las 14 funciones de `public`:
  las diez de la 0035 ........... {"search_path=public, pg_catalog"}
  get_user_tenant_ids ........... {"search_path=public"}
  is_superadmin ................. {"search_path=public"}
  indices_faltantes ............. {"search_path=public, pg_catalog"}
  gasto_no_tras_liquidar ........ null          ← el único
```

y el linter de Supabase (`get_advisors type=security`) devuelve hoy **un solo**
`function_search_path_mutable`, y es esa función. O sea: el conteo real no pasó
de 10 a 0, pasó de 10 a 1, y el mensaje del commit dice 10 → cerrados.

El daño concreto no es teórico para esta función en particular: el trigger
resuelve `viaje` y `liquidacion` **sin calificar el esquema**. Bajo un
`search_path` en el que otro esquema con una tabla `liquidacion` vaya primero, el
`select exists (...)` de la línea 64 lee la tabla equivocada, devuelve `false`, y
el gasto tardío entra — que es literalmente el crítico que la 0036 existe para
cerrar, movido de sitio.

**Consecuencia:** para el contralor, la reaparición del defecto que la 0036
cierra (el PDF archivado y el WhatsApp narrando cifras de signo contrario). Para
el equipo, algo peor: el argumento escrito en la propia 0035 —"arreglarlo hoy es
una línea, arreglarlo el día que entre el auth por usuario es acordarse"— quedó
desmentido por la migración de al lado, sin que ninguna prueba, ningún bloque de
`verificaciones.sql` y ninguna revisión lo notara.

**Causa raíz probable:** `set search_path` es una decisión que hay que recordar
en cada `create function`, y la única comprobación del repo que mira el catálogo
(bloque 18) no lo mira. No hay linter en CI que corra el advisor de Supabase.

---

### [BAJO] La 0035 fija el `search_path`, pero al valor que deja a `public` ganarle a `pg_catalog`

`supabase/migrations/0035_search_path_fijo.sql:27-36`

```sql
alter function public.telefono_normalizado(p_telefono text) set search_path = public, pg_catalog;
```

**Escenario.** Postgres documenta que `pg_catalog` se busca implícitamente
**primero** cuando no se nombra en el `search_path`; nombrarlo lo saca de esa
posición y lo pone donde se escribió. Aquí se escribió **al final**, así que en
las diez funciones un nombre definido en `public` **gana** al builtin.
`telefono_normalizado` (0024) llama `regexp_replace` y `right` sin calificar, y
es la función que evalúa el índice único global `uq_operador_telefono_activo` —
el que impide que dos operadores activos compartan número, que es la capa 2 del
ALTO de la ronda 5.

Contrástese con las dos funciones que sostienen **las once políticas de RLS**,
verificadas hoy en el catálogo: `get_user_tenant_ids` e `is_superadmin` llevan
`search_path=public`, sin nombrar `pg_catalog` — o sea la forma segura, con el
catálogo implícito y primero. Las diez que la 0035 tocó llevan la forma
invertida. Dos criterios distintos en la misma base, y el que se escribió esta
ronda es el flojo.

**Lo intenté refutar y lo dejo en BAJO por esto, dicho con todas sus letras:**
no es explotable hoy. Comprobado en vivo,
`has_schema_privilege('anon','public','CREATE') = false` y lo mismo para
`authenticated`, así que nadie que llegue por PostgREST puede crear el objeto que
haría sombra. La consecuencia vive exactamente en el horizonte que la propia
migración nombra —"el día que entre el auth por usuario"— y lo que se reporta es
que la migración escrita para ese día ship-ea la precedencia que lo empeora, no
la que lo protege.

**Consecuencia:** para el equipo que herede esto, un `search_path` fijado que
parece cerrado en la lista del linter (el WARN desaparece) y que conserva la
única propiedad que el WARN quería quitar.

**Causa raíz probable:** `set search_path = public, pg_catalog` se lee como "los
dos, en orden de uso" y en realidad significa "los builtins al final".

---

### [BAJO] El chequeo que el commit vende como "lo duradero" mira dos cosas en el catálogo y la tercera en una lista escrita a mano

`supabase/verificaciones.sql:740-745`

```sql
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '—') into rpc_abierta
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('try_lock_viaje','unlock_viaje','intake_delta','enriquecer_gasto_codigo',
                       'guardar_liquidacion_tx','marcar_aviso_privacidad','confirmar_aviso_privacidad',
                       'liberar_aviso_privacidad','indices_faltantes')
     and has_function_privilege('anon', p.oid, 'execute');
```

El mensaje de `3e9eb82` presenta el bloque 18 así: *"El ataque fue una foto de un
momento. El bloque 18 se puede volver a correr y mira las TRES formas de perder
el aislamiento sin que nada falle"*. Las dos primeras sí barren el catálogo
entero. La tercera solo ve nueve nombres que alguien tecleó.

**Escenario, con el caso que ya ocurrió.** La 0036 creó
`public.gasto_no_tras_liquidar`. Comprobado hoy en la base real:
`has_function_privilege('anon', 'public.gasto_no_tras_liquidar()', 'execute') =
true` — la concede el default privilege de Supabase, la misma vía que el
comentario de la 0013 documenta como "el `revoke from public` NO basta". Y el
bloque 18, corrido hoy, sigue reportando `rpc-abiertas-a-anon = —`, porque el
nombre no está en el `in (...)`. La comprobación dice limpio sobre una función
que nunca miró.

Que hoy sea inofensivo (una función de trigger llamada directo revuelve *trigger
functions can only be called as triggers*) es suerte del caso, no del chequeo: la
siguiente RPC que se agregue nace ejecutable por `anon` por default y el bloque
18 la dará por revisada igual.

El mismo punto ciego, más pequeño, en la primera comprobación
(`verificaciones.sql:729`): filtra `c.relkind = 'r'`, o sea solo tablas. Una
VISTA en `public` no lleva RLS propia y por default corre con los permisos de su
dueño, que es exactamente cómo se pierde el aislamiento sin que ninguna tabla
aparezca "sin RLS". Hoy no hay vistas —lo verifiqué—, así que es punto ciego, no
agujero.

**Consecuencia:** el equipo que corra el bloque 18 dentro de tres migraciones va
a leer `— / — / —` y va a creer que barrió el catálogo, que es precisamente la
lectura que el bloque se escribió para dar. Es la forma de fallo que la propia
0030 documenta: un chequeo que dice verificar algo que no verifica.

**Causa raíz probable:** la lista se escribió enumerando lo que existía el
31-jul en vez de preguntándole al catálogo qué funciones hay.

---

### [BAJO, REINCIDENTE de la ronda 6] Las cabeceras de seguridad y el `no-store` se siguen perdiendo en la rama de redirección de `/dashboard`

`src/proxy.ts:42`

Sin un solo cambio desde la ronda 6: las cinco cabeceras se escriben sobre `res`
(líneas 13-16, 24 y 32) y la rama de sesión inválida devuelve un objeto nuevo con
`NextResponse.redirect(url)`, que no hereda nada.

**Verificado en vivo hoy (1-ago-2026), y esta vez contra el dominio nuevo**
—porque el software se mudó a `app.likida.ai` (`93be38a`) y la mudanza tampoco
lo destapó—, sin cookie:

```
GET https://app.likida.ai/dashboard
→ 307
  cache-control: public, max-age=0, must-revalidate       ← el default de Vercel, no el no-store del código
  strict-transport-security: max-age=63072000             ← el de Vercel, no el max-age=31536000 de proxy.ts:24
  (sin x-content-type-options, sin x-frame-options,
   sin referrer-policy, sin permissions-policy)

GET https://app.likida.ai/aviso/1111…1111
→ 200
  x-content-type-options: nosniff
  x-frame-options: DENY
  referrer-policy: strict-origin-when-cross-origin
  permissions-policy: geolocation=(), microphone=(), camera=()
  strict-transport-security: max-age=31536000             ← este SÍ es el del código
```

La comparación de las dos respuestas del mismo proxy, tomadas con dos segundos de
diferencia, es la prueba: la rama que sí devuelve `res` lleva las cinco; la que
redirige no lleva ninguna.

**Consecuencia:** la misma que se midió en la ronda 6, y por eso sigue BAJO — la
307 no lleva cuerpo con datos y el contenido real del panel queda cubierto por el
`private, no-cache, no-store` que Next pone en cualquier página dinámica. Lo que
cambió es el dato nuevo: **ninguna prueba cubre `proxy.ts`** (`command grep -rln
"proxy" src/ --include="*.test.ts"` solo devuelve `guard.test.ts`, que prueba
`exigirAcceso`, no el proxy). Un defecto de cabeceras sin prueba y sin arreglar
en dos rondas es deuda que solo se ve mirando en vivo, y este rubro es el único
que mira.

**Causa raíz probable:** `NextResponse.redirect()` construye la respuesta desde
cero; las cabeceras se ponen en un solo camino de salida de los dos que tiene la
función.

---

### [MEDIO, REINCIDENTE ×3 — rondas 5, 6 y 8] La URL firmada del PDF que manda WhatsApp sigue viva una hora

`src/lib/cuadra/processor.ts:920`

```ts
const { data, error } = await supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600);
if (error || !data?.signedUrl) throw new Error(...);
await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
```

Nada tocó la línea. Cambió de número (era la 783) por las 170 líneas nuevas del
processor, no de contenido.

**Escenario, con valores.** El único consumidor de esa URL es Meta, que descarga
el `link` en segundos. El objeto es `{tenantId}/{viajeId}-operador.pdf` del bucket
privado `liquidaciones` —comprobado hoy: `storage.buckets.public = false`— y el
documento lleva el nombre del operador, el folio del viaje y los montos. Durante
3,600 segundos, cualquiera que vea esa URL en tránsito por la cadena Meta-Graph
descarga el PDF sin credencial ninguna. Con 60 segundos, la ventana es la que la
necesidad dura.

Y la plantilla correcta está en el mismo repo, escrita por el mismo equipo:
`src/app/api/export/pdf/[id]/route.ts:59` firma con **60**. Son dos caracteres de
diferencia y tres rondas de distancia.

**Consecuencia:** el operador y la flota — un documento con nombre propio y cifras
de nómina expuesto a quien intercepte el enlace dentro de la hora. Para el
contralor, es la clase de detalle que un auditor de su lado pregunta.

**Causa raíz probable:** el TTL se eligió cuando el PDF era lo único y nunca se
revisó; la ruta nueva del panel sí nació con el número correcto y no se propagó
hacia atrás.

---

### [BAJO, REINCIDENTE de la ronda 5] `bodyExcede` en `/api/demo` sigue sin remedir tras leer el cuerpo

`src/app/api/demo/route.ts:30` · `src/lib/ratelimit.ts:95-98`

```ts
if (bodyExcede(req, 64 * 1024)) return NextResponse.json({ error: 'payload muy grande' }, { status: 413 });
...
const body = (await req.json()) as { comprobantes: Partial<Gasto>[]; anticipo: number };   // sin remedir
```

Mismo código, tercera ronda. `ratelimit.ts:88-93` documenta el hueco en su propio
comentario y nombra al culpable por archivo y línea (*"`api/demo/route.ts:30` no
lo hace, así que ahí el tope de 64 KB es el de la plataforma, no el de aquí"*), y
el webhook —`webhook/whatsapp/route.ts:44-45`— sí hace el recheck con
`raw.length`. O sea: la asimetría está anotada, tiene dueño y no se atendió.

**Escenario:** una petición con `Transfer-Encoding: chunked` y sin
`content-length` hace que `Number(null || 0)` dé 0, `bodyExcede` diga "cabe", y el
cuerpo entero se materialice en `req.json()`.

**Consecuencia:** acotada, igual que en la ronda 5 — Vercel corta el cuerpo en su
propio límite de plataforma antes de que el de 64 KB importe. Se reporta porque
es una defensa que el código anuncia y no ejerce, no porque el ataque llegue a
algún lado.

---

### [BAJO, REINCIDENTE de la ronda 5] `/api/demo` sigue publicando sin autenticar qué grupos de secretos están configurados

`src/app/api/demo/route.ts:8-10` · `src/lib/env.ts:54-60`

Verificado en vivo hoy, contra el dominio nuevo:

```
GET https://app.likida.ai/api/demo
→ 200 {"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}
```

Idéntico a la ronda 5 y a la 6. `envHealth()` sigue devolviendo booleanos, nunca
valores, así que el riesgo sigue siendo solo de reconocimiento: le dice a un
anónimo qué integraciones están vivas y, cuando alguna se caiga, cuál.

**Consecuencia:** para el equipo, un canal que confirma el estado de la
configuración de producción a quien no tiene por qué saberlo. El mensaje de
`3e9eb82` lo mira y lo declara bien (*"`/api/demo` responde 200 y está bien"*) —
lo cual es cierto del POST, que es cálculo puro, y pasa de largo el GET, que es
lo que se reportó.

---

### [BAJO] Un ayudante de sesión muerto que, ante un usuario desconocido, contesta `rol: 'flota_admin'` — y traga el fallo de consulta

`src/lib/auth/session.ts:16-25`

```ts
const { data } = await sb.from('app_user').select('tenant_id, rol, nombre').eq('id', user.id).maybeSingle();
return {
  userId: user.id,
  tenantId: (data?.tenant_id as string) ?? null,
  rol: (data?.rol as string) ?? 'flota_admin',     // ← 20
  ...
} catch { return null; }                            // ← 23-25
```

**Escenario, con valores.** `passcode.ts:33-37` nombra el auth por usuario
(Supabase Auth + RLS con `auth.uid()`) como el siguiente paso y como bloqueante
del segundo cliente. El día que se enchufe, `getSessionTenant()` es la función que
está ahí esperando. Un usuario que existe en `auth.users` y **no** tiene fila en
`app_user` —el estado natural de cualquiera que se registre antes de que lo den de
alta en una flota— produce `{ userId: '…', tenantId: null, rol: 'flota_admin' }`.
Cualquier gate que lea `rol` para decidir recibe "administrador de flota" sobre un
desconocido. El default debería ser el rol sin privilegios, o `null`, no el que
manda.

Y la línea 23 es el patrón que este repo lleva cinco rondas persiguiendo —*un
fallo de consulta disfrazado del valor que significa "no hay"*—: el `catch`
convierte "Supabase no contestó" en "no hay sesión", sin log. Es el **sexto**
sitio, y no está en los cinco que el MAPA lista (`analytics.ts`, `costos.ts`,
`repo.ts`, `startup.ts`, `conv.ts`, `config.ts`). Aquí el disfraz es
fail-**closed** por casualidad —"no hay sesión" corta— pero sin una sola línea que
distinga una caída de Supabase de un visitante anónimo.

Confirmado que hoy está muerto: `command grep -rn "auth/session" src/` no
devuelve nada, ni una importación. **Por eso es BAJO y no más:** hoy no corre.

**Consecuencia:** el equipo que implemente el auth por usuario va a encontrar
esta función escrita, en `src/lib/auth/` junto a las dos que sí son el candado, y
la va a usar. Un ayudante de autorización sin uso es la peor clase de deuda:
parece revisado.

**Causa raíz probable:** quedó de un diseño anterior (Supabase Auth) que se
sustituyó por el passcode y nadie lo borró.

---

### [BAJO] `/aviso/[tenant]` es la única puerta sin autenticar que llega a la base y no tiene límite de tasa

`src/app/aviso/[tenant]/page.tsx:34,62-64`

```ts
export const dynamic = 'force-dynamic';
...
if (!/^[0-9a-f]{8}-…$/i.test(tenant)) notFound();
const datos = await getDatosResponsable(tenant);   // supabaseAdmin(), service-role
```

**Escenario, con valores.** El UUID del tenant demo,
`11111111-1111-1111-1111-111111111111`, está en `supabase/seed.sql` de un repo
público. Verificado hoy en vivo: `GET
https://app.likida.ai/aviso/11111111-1111-1111-1111-111111111111` → 200, con la
razón social pintada. Cada petición es una invocación de función con
`force-dynamic` y una consulta `select … from tenant` con la llave service-role.
No hay `rateLimit` en ninguna parte de este archivo.

Todas las demás puertas sin credencial sí lo tienen, y con número:
`/api/demo` 30/min por IP (`route.ts:31`), `/api/export/liquidaciones` 10/min
(`route.ts:17`), `/api/export/pdf/[id]` 30/min (`route.ts:31`), el webhook 40/min
por teléfono (`route.ts:10`). Esta es la excepción, y es la más nueva.

**Consecuencia:** egress de Supabase e invocaciones de Vercel quemadas por
cualquiera con la URL, en un proyecto donde el egress **ya bloqueó dos trabajos
programados** (`0769d77` y `90569ef`, y el `.latido-cuota-diesel` que el MAPA
nombra). Si el 6-ago la base está estrangulada por egress, el demo se cae por una
puerta que nadie está mirando.

**Causa raíz probable:** la página se escribió como documento legal —que tiene que
ser público— y el límite de tasa se pensó como propiedad de las rutas `/api`, que
es donde está en todos los demás casos.

---

## Lo que revisé y está bien

**El aislamiento entre flotas, comprobado por mí contra el catálogo vivo**
(proyecto `gngoqsvrxdguxvsizpbw`, 1-ago-2026, todo consultas de solo lectura).
Esto cierra el pendiente que la ronda 6 dejó escrito como *"no repetí la consulta
al catálogo esta ronda"*:

```
tablas de `public` sin RLS ........................ —   (ninguna)
políticas PERMISSIVE cuya expresión es `true` ..... —   (ninguna)
políticas en `public` ............................. 11, TODAS con
    qual = (tenant_id = ANY (get_user_tenant_ids())) OR is_superadmin()
vistas en `public` ................................ —   (ninguna)
storage.buckets: liquidaciones .................... public = false
has_schema_privilege('anon','public','CREATE') .... false
```

Y las dos capas que cerraron el ALTO de la ronda 5, que la ronda 6 dio por
buenas con la fuente del MAPA y yo ahora leí de `pg_indexes` y `pg_constraint`:

```
uq_operador_telefono_activo ....... UNIQUE btree (telefono_normalizado(telefono)) WHERE activo
uq_operador_tenant_telefono_norm .. UNIQUE btree (tenant_id, telefono_normalizado(telefono))
gasto_viaje_tenant_fkey ........... FK (viaje_id, tenant_id) → viaje(id, tenant_id)
liquidacion_viaje_tenant_fkey ..... FK (viaje_id, tenant_id) → viaje(id, tenant_id)
codigo_pendiente_viaje_tenant_fkey  FK (viaje_id, tenant_id) → viaje(id, tenant_id)
viaje_operador_tenant_fkey ........ FK (operador_id, tenant_id) → operador(id, tenant_id)
```

Existen las dos y las cuatro, tal cual. La capa 1 en aplicación sigue firme:
`conv.ts:59-98` pide `.limit(2)`, registra `operador.ambiguo` y lanza; nada se
escribe en `gasto`/`viaje`/`liquidacion` en ninguna de las tres ramas de
`processor.ts`.

**Los cuatro WARN que `3e9eb82` declinó por escrito están bien declinados, y lo
comprobé en vez de creerlo.** `get_user_tenant_ids()` e `is_superadmin()` son
`prosecdef = true` y ejecutables por `anon` — a propósito: las usan las once
políticas. Resuelven contra `auth.uid()`, que para un anónimo es NULL, así que
devuelven arreglo vacío y `false`, y `tenant_id = ANY('{}')` es falso para toda
fila. Revocarlas rompería el aislamiento en vez de cerrarlo, tal como dice el
commit. Los tres INFO de `rls_enabled_no_policy` (`codigo_pendiente`,
`viaje_lock`, `wa_mensaje_procesado`) son denegación total y es lo que la 0012
buscaba.

**`DASHBOARD_PASSCODE` SÍ está puesta en Vercel hoy** — el otro pendiente que la
ronda 6 dejó abierto con nombre y apellido. `GET /dashboard` sin cookie devuelve
307 a `/acceso`, lo que solo ocurre si `hayPasscode()` es cierto. El escenario
que la ronda 6 dejó anotado —variable borrada por error → `proxy.ts:38` y
`guard.ts:33` tratan "sin passcode" como modo desarrollo y el panel queda
abierto— sigue siendo posible como diseño, pero **no está ocurriendo**. Dato
nuevo de esta ronda sobre ese mismo diseño: los dos export **no** usan
`hayPasscode()`, solo `tokenMatches`, que devuelve `false` sin passcode
configurado. O sea que sin la variable las páginas del panel abrirían y el CSV
seguiría en 401 — dos comportamientos opuestos sobre el mismo candado. Lo dejo
escrito y no lo subo a hallazgo porque no cambió respecto a la ronda 6.

**La superficie HTTP sin credenciales, medida hoy contra `app.likida.ai`:**

```
/dashboard ........................ 307 → /acceso        (ver hallazgo de cabeceras)
/api/export/liquidaciones ......... 401 No autorizado
/api/export/pdf/<uuid> ............ 401 No autorizado
/api/demo (GET) ................... 200 {"ok":true,"config":{…}}   (ver hallazgo)
/aviso/<uuid del seed> ............ 200, con las CINCO cabeceras y
                                    meta robots="noindex, nofollow"
```

**El token v2 sigue sin vía de forja, downgrade, reúso ni extensión.** No repetí
el ataque completo de la ronda 6 porque `src/lib/auth/passcode.ts` no tiene un
solo cambio desde entonces (`git diff abdc98d HEAD -- src/lib/auth/` está vacío);
sí corrí sus 24 pruebas (`passcode.test.ts` 18, `guard.test.ts` 6) y pasan. La
comparación en tiempo constante (`constTimeEq`, 216-221) y el rechazo del formato
viejo (`partes.length !== 4 || partes[0] !== VERSION`) siguen tal cual.

**El HMAC del webhook, sin regresión.** El orden se mantiene: cap por
`content-length` → `req.text()` → recheck por `raw.length` → `verifySignature`
timing-safe (`meta/client.ts:33-40`) → recién ahí `JSON.parse`, y el
`rateLimit` por teléfono va **después** de la firma, no antes. `verifySignature`
devuelve `false` sin `WHATSAPP_APP_SECRET`: fail-closed.

**Ningún secreto con fallback silencioso, sin cambios.** `DASHBOARD_SECRET`
lanza en producción; `exigirPasscodeFuerte` lanza ante un passcode adivinable;
`supabaseAdmin()`, `meta/client.ts` y el cliente de OpenRouter lanzan sin sus
llaves. `next.config.ts` excluye `./.env*` del trace del bundle, con la medición
del 28-jul escrita al lado.

**Ninguna redirección abierta.** `/acceso` valida `next` con
`startsWith('/dashboard')` en los dos puntos (`page.tsx:11` y `:32`); `//evil.com`
y `//dashboard.evil.com` fallan el prefijo, y todo lo que lo pasa es una ruta
relativa del mismo origen. El `next` que arma `exigirAcceso` viene del pathname,
no del cliente.

**La redacción del logger cubre lo que esta ronda agregó.** Los campos nuevos
(`viaje`, `tenant`, `operadorId`, `monto`, `id` de wamid) pasan todos por
`redactMeta`; los UUID salen como huella estable, RFC y teléfono se borran. El
único `body` crudo que se registra es el de los errores de Graph
(`meta/client.ts`), y también pasa por el redactor.

**`sharp` 0.34.5, misma observación vigilada de la ronda 5 y 6, sin cambio.**
`npm audit` bajó de 20 a 11 vulnerabilidades (2 críticas, 5 altas, 4 moderadas);
las críticas siguen siendo `vitest` y `@vitest/coverage-v8`, la misma advisory
contada dos veces, devDependency, nunca `--ui`. La única con camino de producción
sigue siendo `sharp` (GHSA-f88m-g3jw-g9cj, ahora con cuatro CVE de libvips):
`cfdi.ts:249` corre `sharp(image).rotate().resize(…)` sobre bytes que bajan de
WhatsApp. El razonamiento de descarte no cambió y lo revalidé leyendo las ramas:
`sharp` solo se alcanza desde `msg.type === 'image'` (`processor.ts:332`), y por
ese canal Meta entrega JPEG/PNG; un TIFF o un GIF viajan como `document`
(`processor.ts:269,572`), rama que no toca `sharp`. Lo que sí cambió es que ahora
**hay arreglo publicado** (`sharp@0.35.3`) y `package.json` sigue fijando
`^0.34.0`. Sigue como observación vigilada, no como hallazgo.

**El sondeo de red del aviso integral, mirado y no reportado.**
`startup.ts:230-258` llama `sondearAvisoIntegral(tenant.url_aviso_privacidad)`,
que hace `fetch(destino, { redirect: 'follow' })` en cada arranque en frío. El
valor lo pone el cliente de la flota, así que en cuanto exista una pantalla donde
la flota lo capture, es una SSRF ciega: `revisarAvisoIntegral`
(`privacidad.ts:104-121`) bloquea IP desnudas y `localhost` por la regla del TLD
alfabético, pero `redirect: 'follow'` deja que un host público redirija a donde
quiera. **No lo reporto como hallazgo** porque hoy nadie fuera de Likida puede
escribir esa columna (no hay ruta de la app que lo haga) y el resultado que se
filtra es solo `res.ok` y un status en un log. Queda anotado para la ronda en que
aparezca la pantalla de configuración del tenant.

**Los `GRANT` anchos de Supabase, mirados y no reportados.** `anon` y
`authenticated` tienen `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES` sobre
las doce tablas de `public` — el default de Supabase. RLS los detiene en los
cuatro primeros, y el barrido de `3e9eb82` lo midió (14 tablas → 0 filas, cinco
escrituras → 42501). **`TRUNCATE` no está cubierto por RLS** —las políticas solo
aplican a SELECT/INSERT/UPDATE/DELETE—, así que la afirmación de la 0012 ("RLS on,
sin policy = deny-all a anon/authenticated") no es literalmente cierta para
`codigo_pendiente`, `viaje_lock` y `wa_mensaje_procesado`. No lo reporto como
hallazgo porque no encontré vía para emitir un `TRUNCATE`: PostgREST no lo expone
y la llave publicable es un JWT, no una credencial de conexión a Postgres. Lo dejo
escrito porque es exactamente el "GRANT implícito que el `revoke from public` no
alcanza" que este rubro manda vigilar, y porque deja de ser teórico el día que
algo abra una conexión directa o una función `security definer` que trunque.

---

## Lo que NO alcancé a revisar

- **El `wamid` en base64 con el teléfono codificado dentro**
  (`processor.ts`, `processInbound.fail`). Mismo pendiente que las rondas 5 y 6:
  confirmar si `redactarTexto` lo alcanza exige un `wamid` real de producción, y
  no tengo uno.
- **Iniciar sesión de verdad contra `/acceso`.** Mismo criterio que la ronda 6:
  fallar gasta intentos de un usuario legítimo, y acertar me deja con una sesión
  real sobre datos de un tenant real sin que el encargo lo pida. Me limité a
  cookies inválidas por construcción y a la verificación de que el gate responde
  307, que ya prueba lo que hay que probar.
- **Concurrencia real del rate-limit.** Sigue sin medirse si el `Map` en memoria
  por instancia aguanta bajo tráfico concurrente: exige tráfico agresivo contra
  producción, que esta ronda prohíbe. La cabecera de `ratelimit.ts:7-16` ya dice
  que no es un límite global y que la defensa que cierra es la fuerza del
  passcode.
- **Si `SENTRY_DSN` está puesto en Vercel hoy.** `94d0174` dice "Sentry vivo y
  verificado de punta a punta", pero eso solo se confirma leyendo el runtime log
  de Vercel y no tengo acceso al dashboard desde aquí. Lo doy por bueno con esa
  fuente, no con una comprobación propia.
- **El contenido real de `tenant.contacto_privacidad` en producción.** La página
  pública `/aviso/[tenant]` lo publica cuando existe. Hoy sale en blanco para el
  tenant demo (la sección aparece como pendiente), así que no hay nada expuesto;
  no verifiqué qué se piensa capturar ahí ni si podría llevar un dato personal de
  un empleado de la flota que no sea el de contacto que el art. 29 pide.
- **CSP.** No hay `Content-Security-Policy` en `proxy.ts` ni en `next.config.ts`.
  No lo reporto porque no encontré un sumidero de XSS —React escapa todo lo que
  `/aviso` y el panel pintan desde la base—, pero tampoco recorrí las 186 líneas
  nuevas de `privacidad/page.tsx` buscando uno con el detalle que eso merecería.
