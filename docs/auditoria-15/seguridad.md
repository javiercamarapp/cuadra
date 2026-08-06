# Seguridad — auditoría 15

**Nota: 7/10** (se mantiene respecto de la 14). Razón del movimiento: **la
ronda 14 atacó bien SU MEDIO más sustantivo —la frontera de base de la RFA
2.9— y eso se verifica de verdad**, pero dejó intacto el núcleo del hallazgo
que este rubro arrastra desde la ronda 10 (la auto-certificación del POD del
chofer, tercera ronda abierta, con su bloque de verificación todavía exigiendo
que el INSERT del chofer pase), y la edición nueva en la consola
(`actualizarFacilidad15`) repite la familia canónica de este repo: **leer sin
comprobar el error y escribir destructivo**. Es el mismo apetito que la 0082
tenía y que la 0083 sí cerró para la configuración — la puerta de la consola
quedó con el defecto que la frontera de base acaba de eliminar. Una ganancia
real (0083 + escritor tri-estado + los 7 backend) y dos deudas nuevas
(`actualizarFacilidad15` y la pantalla ARCO que no puede mostrar nada).

---

## Verificación de los cierres de la ronda 14 (el encargo central)

Se abrieron los cuatro commits de la ronda 14 (`0d23f73`, `0fa305e`,
`8a33ce1`, `d7b171f`) y se leyó el código ACTUAL de cada cierre. Lo que este
rubro reclama:

**`8a33ce1` (0083 + escritor tri-estado — el MEDIO #2 de la ronda 14) —
CERRADO, bien cerrado.** La `0083_config_facilidad15_forma.sql` reescribe
`config_tenant_valida` con un bloque para `facilidadCombustibleEfectivo`
(`0083:54-68`) que cubre las cuatro formas malas: llave ausente → válido
("sin declarar", `o is null or o = 'null'::jsonb`); objeto no-objeto → `raise
exception`; objeto con UNA sola condición (la otra `is null` o `'null'::jsonb`)
→ `raise exception`; condición no-booleana → `raise exception`. El caso de la
ronda 14 —`{dedicacionExclusivaCarga: true, regimenElegible: null}`— ya no se
guarda: rebota en el CHECK. Y el escritor se alineó: `crearFlota`
(`administracion.ts:110-120`) solo escribe la llave cuando AMBAS son
`typeof boolean`; si falta una, no escribe nada (`undefined` → la llave ni
existe), que es el tercer estado honesto. El lector (`desde_db.ts:56-58`)
conserva la asimetría `!== undefined` frente a `null`, pero quedó sellada:
con la 0083 en la base, una config con un `null` a medias no puede existir, y
la llave entera en `null` cae al cortocircuito `f15 && …` → `undefined` →
"sin declarar". Verifiqué además que no hay datos viejos que la 0083 no
atrapara: el escritor anterior (`0d23f73:administracion.ts:110-114`) hacía
`?? null`, pero su form (`0d23f73:flotas/page.tsx:37-38`) mandaba `=== 'on'`
— siempre booleanos explícitos—, y ese código nunca llegó a producción
(caae369 es pre-2.9); el seed del demo declara `true/true`
(`seed.sql:106`). Estado: **cerrado**.

**`d7b171f` (los 7 backend) — los que tocan seguridad, correctos.** (1)
`resolverTenantApi` (`tenant-api.ts:58-63`) revisa `error` y devuelve
`503` con `logger.error` — el "uuid inexistente" sigue cayendo en silencio a
la sesión, pero el bache de red ya no. (5) El alta de usuario
(`admin/usuarios/nuevo/page.tsx:35-37`) rechaza `superadmin`/`operador` en el
POST directo; los tres roles restantes son los que el `<select>` ofrece. (7)
El `route.test.ts` de Stripe (5 tests, verdes en esta ronda) cubre firma,
idempotencia y 500+reintento. (2)(3)(4)(6) — desempate `created_at+id` en el
export, `traerTodo` en `getPorFacturar`, el texto del rechazo de PDF y el
comentario muerto de `meta/client.ts` — sin superficie de seguridad nueva.

**El MEDIO #1 de la ronda 14 (POD) — sigue ABIERTO (hallazgo 1 de este
reporte).** Ninguno de los cuatro commits lo menciona. La policy de la 0081
está intacta (`0081:15-19`), el bloque 56 sigue esperando `pod-en-su-flota=t`
(`verificaciones.sql:3133,3146`) y ningún código de la app escribe
`'subido'` — solo PostgREST directo con la anon key. Reabierto, tercera
ronda.

**Los tres BAJOS de la ronda 14 — siguen abiertos, sin regresión.**
`bitacora_insercion` (`0079:33`), el bucket `avatares` (`0046:28-31`) y las
policies de lectura del chofer (`0045:52-60`, `0047:187-189`) no se tocaron.
El BAJO del `.or()` (claves del SAT sin escapar) se MOVIÓ: ahora vive en
`repo.ts:831` dentro de `getAcumuladoCombustible`, el mismo contador que la
ronda 14 reusó desde `desde_db.ts`. Mismo vector, misma latencia (solo el
service-role escribe `tenant.config`), sigue abierto.

**Superficie crítica intacta.** `git log caae369..HEAD` sobre `proxy.ts`,
`api/webhook/*`, `api/cron/*`, `api/stripe/*`, `api/export/*`: solo `d7b171f`
tocó `api/export/liquidaciones` (una línea: el `order('id')` de desempate) y
`lib/auth/tenant-api.ts` (el 503). HMAC del webhook (cap de body antes de
leer, `route.ts:90-95`), `CRON_SECRET` con 500-fail-closed, firma de Stripe,
CSP con `frame-ancestors 'none'`, `Cache-Control: no-store` del proxy: todo
exactamente como la ronda 14 lo verificó.

---

## Hallazgos

### [MEDIO, abierto — tercera ronda] `operador_sube_su_pod`: el chofer sigue pudiendo auto-certificar su entrega sin subir nada

`supabase/migrations/0081_pod_tenant_amarrado.sql:15-19` ·
`supabase/verificaciones.sql:3133,3146` · `src/app/dashboard/pod/vista.tsx:17` ·
`src/lib/cuadra/operacion.ts:75` · `supabase/migrations/0047_operacion_encargado.sql:139-144`

Sin cambios desde la ronda 14, que lo dejó abierto por segunda vez. La 0081
amarra `tenant_id` al del viaje (la "variante menor"), pero el `with check`
sigue siendo:

```sql
create policy operador_sube_su_pod on public.pod for insert
  with check (
    viaje_id in (select id from public.viaje where operador_id = get_user_operador_id())
    and tenant_id = (select tenant_id from public.viaje where id = viaje_id)
  );
```

Y las constraints de `pod` (`0047:139-144`) exigen para `estado='subido'`
solo `storage_path is not null` — cualquier string. `'subido'` no lo escribe
ningún código de la app (verificado de nuevo: solo se LEE en
`pod/vista.tsx:17,37,101` y `operacion.ts:75,455`), así que la única puerta a
ese estado es el INSERT RLS del chofer.

**Escenario, con valores.** El chofer de Transportes Innovativos con sesión
web (`rol=operador`, su access token, la anon key pública — las dos cosas que
el cliente de Supabase del navegador ya tiene):

```
GET  /rest/v1/viaje?select=id&operador_id=eq.<su operador_id>
POST /rest/v1/pod
Authorization: Bearer <access_token del chofer>
{ "tenant_id": "<A>", "viaje_id": "<VJ-2026-0847>",
  "operador_id": "<su operador>",
  "estado": "subido", "storage_path": "falso.jpg" }
```

Pasa el `with check` de la 0081 (viaje suyo + tenant del viaje), pasa
`pod_estado_dominio` y `pod_subido_tiene_archivo` (`'falso.jpg'` no es nulo),
y no hay otra policy de INSERT que intervenga (`tenant_data` de `pod`,
`0047:183`, excluye a `is_operador()`). Resultado: la pantalla POD pinta
"Recibido" (`vista.tsx:17`), el tablero de despacho deja de contar el viaje
como "sin POD" (`operacion.ts:75`) y nadie vuelve a perseguir esa evidencia —
sin foto, sin subida a Storage, sin verificación. El chofer puede además
atribuir la entrega a cualquier `operador_id` del esquema (la FK es global,
sin tenant). La oficina conserva el botón "Rechazar", que es lo que lo
mantiene en MEDIO y no más.

**El arreglo honesto sigue siendo el de la ronda 13**, sin cambios:
`drop policy operador_sube_su_pod`, y extender el bloque 56 para exigir que
el INSERT del chofer —incluido `estado='subido'` con `storage_path`— rebote;
la policy vuelve el día que exista la subida real desde `/chofer` con
verificación del archivo en Storage. El bloque 56 actual
(`verificaciones.sql:3133`) inserta con `estado='pendiente'` y exige
`pod-en-su-flota=t`: codifica que el vector siga abierto. Estado: **abierto**
(cierre incompleto de las rondas 13 y 14).

---

### [MEDIO, abierto — nuevo] `actualizarFacilidad15`: lee la config sin comprobar el error y, con un bache de red, la REEMPLAZA entera por una llave

`src/lib/cuadra/repo.ts:923-931` · `src/app/admin/flotas/page.tsx:52-62`

```ts
export async function actualizarFacilidad15(tenantId: string, ded: boolean | undefined, reg: boolean | undefined): Promise<void> {
  const admin = supabaseAdmin();
  const { data: fila } = await acotada(admin.from('tenant').select('config').eq('id', tenantId).maybeSingle(), 'actualizarFacilidad15.leer');
  const actual = { ...((fila?.config as Record<string, unknown> | null) ?? {}) } as Record<string, unknown>;
  if (ded !== undefined && reg !== undefined) {
    actual.facilidadCombustibleEfectivo = { dedicacionExclusivaCarga: ded, regimenElegible: reg };
  } else {
    delete actual.facilidadCombustibleEfectivo;
  }
  const { error } = await acotada(admin.from('tenant').update({ config: actual }).eq('id', tenantId), 'actualizarFacilidad15');
  if (error) throw new Error(`actualizarFacilidad15: ${error.message}`);
}
```

La lectura es un LEE-MODIFICA-ESCRIBE sobre `tenant.config`, y el error de la
lectura **no se comprueba** — la línea 931 comprueba el del UPDATE, la 923 no
comprueba el del SELECT. `supabase-js` reporta el fallo por valor
(`{ data: null, error }`), y `acotada` (`presupuesto.ts:148-164`) resuelve
con `{ data: null, error: { message: 'sin respuesta…' } }` cuando agota el
tope — en los dos caminos `fila` es `null` y la función SIGUE. El spread
`{ ...(null ?? {}) }` produce `{}`, y el UPDATE escribe `config =
{facilidadCombustibleEfectivo: {...}}` — o `{}` si el edit borra la
declaración. **Toda la config previa del tenant —politica, tabulador,
hidrocarburos, estimulos, empresa, salida, validacion, unidades,
catalogoCuentas— desaparece en una sola escritura**, y el CHECK de la 0083
pasa (el objeto nuevo es válido), así que la base no dice nada.

Compárese con `guardarPolitica` (`administracion.ts:270-271`), que SÍ
comprueba `errLee` y lanza antes de tocar nada — el patrón correcto para este
LEE-MODIFICA-ESCRIBE está a veinte líneas de distancia. `actualizarFacilidad15`
no tiene UNA sola prueba (verificado: `grep actualizarFacilidad15` en
`*.test.ts` da cero).

**Escenario, con valores.** El superadmin abre `/admin/flotas`, edita la
declaración de la facilidad de Transportes Innovativos y guarda. En ese
instante la red da un parpadeo (o el SELECT pasa del tope de consulta):
`fila = null`, `actual = {}`, UPDATE con `config =
{"facilidadCombustibleEfectivo": {"dedicacionExclusivaCarga": true,
"regimenElegible": true}}`. La política sembrada por el seed —tope de diésel
$4,000, caseta $1,500, alimentación $800— deja de existir. `getConfig`
fusiona con `DEMO_CONFIG`, que trae OTROS topes genéricos, y el motor deja de
marcar las diferencias `sobre_politica`: **la liquidación sale sin una sola
diferencia y parece que la flota cumple** — el modo de fallo que las propias
excepciones de la 0082/0083 describen como el peor de su clase. El daño es
permanente (la config anterior no está en la bitácora: `accionFacilidad` no
anota) y silencioso (la pantalla responde "Declaración del 15% actualizada").

**Por qué MEDIO y no ALTO**: el gatillo exige sesión de superadmin (el action
repasa `requireSuperadmin`, `flotas/page.tsx:53`) y un fallo transitorio de
lectura — no es explotable por un cliente ni por un atacante externo. Pero es
pérdida destructiva de configuración en código NUEVO de esta ronda, en la
familia exacta que el repo documenta como su fallo más caro ("leer sin
comprobar y escribir"), y a diferencia del caso del POD no hay ninguna
mitigación posterior: la config no tiene respaldo. El arreglo es una línea —
comprobar `error` en la lectura y lanzar como hace `guardarPolitica`— más una
prueba que siembre el `{ data: null, error }` y exija que NO se escriba.
Estado: **abierto**.

---

### [BAJO, abierto — nuevo, raíz legal] La pantalla ARCO de cumplimiento no puede mostrar una sola solicitud

`src/app/admin/compliance/page.tsx:135-138` · `:37`

```ts
async function datosDeCompliance(): Promise<[...]> {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s?.tenantId) return [[], 0];
  ...
```

La pantalla vive en `/admin` (layout con `requireSuperadmin()`,
`admin/layout.tsx`), y el único lector posible —el superadmin— tiene
`app_user.tenant_id` **nulo por diseño** (0001_init.sql:17; confirmado por
`session.test.ts:98-102`: superadmin → `tenantId: null`). Con `tenantId`
nulo, `datosDeCompliance` devuelve `[[], 0]` **siempre**: la página pinta
"Ninguna solicitud ARCO registrada" aunque haya solicitudes de la flota del
demo o de cualquier otra. Y la flota —la responsable obligada a responder en
20 días hábiles (LFPDPPP art. 32)— no puede entrar a `/admin` en absoluto.
El cierre legal de la ronda 14 ("la flota ve sus solicitudes y responde")
quedó inalcanzable: ni quien puede entrar puede ver nada, ni quien debe
responder puede entrar. Adicional: `accionResolver` (línea 37) tampoco
comprueba el `error` de su lectura — con un bache de red responde "La
solicitud no existe" a una solicitud que sí existe (fail-closed, pero con una
afirmación falsa).

**Por qué BAJO para seguridad y no MEDIO**: no expone datos ni cruza tenants
— falla cerrado hacia el vacío. Es sobre todo un hallazgo legal (la
obligación ARCO sigue sin ser atendible desde el producto); para este rubro
vale como afirmación falsa ("Ninguna solicitud ARCO registrada" leída como
constancia de cumplimiento) y como deuda de disponibilidad del camino de
respuesta. El arreglo: `datosDeCompliance` debe listar las solicitudes que el
superadmin debe administrar (todas, como `getResumenNegocio`), o la pantalla
debe vivir en `/dashboard` con `getSessionTenant` de la flota. Estado:
**abierto**.

---

### [BAJO, abierto — residual de la ronda 14, mudado de archivo] El contador del 15% interpola `clavesCombustible` sin escapar en el `.or()` de PostgREST

`src/lib/cuadra/repo.ts:831`

```ts
.or(claves?.length ? `concepto.eq.diesel,clave_prod_serv.in.(${claves.join(',')})` : 'concepto.eq.diesel')
```

El hallazgo BAJO de la ronda 14 vivía en `desde_db.ts:64-72`; el refactor de
la 0083/8a33ce1 lo movió a `getAcumuladoCombustible` sin tocar la
interpolación. Las claves vienen de `config.hidrocarburos?.claves`, que la
0083 valida solo como "array de strings" (`0083:228-233`) sin exigir el
formato `^\d{8}$` del SAT ni prohibir los metacaracteres de PostgREST
(`,` `(` `)` `.`). Sigue latente por las mismas dos capas de la ronda 14: los
únicos escritores de `tenant.config` son service-role (`crearFlota`,
`guardarPolitica`, `actualizarFacilidad15`, seed/SQL) y el `.eq('tenant_id')`
exterior impide cruzar de tenant. Pero `actualizarFacilidad15` acaba de añadir
un tercer escritor de config —y el día que la edición de política o claves
llegue a una pantalla de cliente, el vector se calienta. Deuda de defensa en
profundidad: exigir `^\d{8}$` en la 0083 (o al menos prohibir `,()`) y armar
el filtro por `in.()` con escapes o un `.in()` nativo del SDK. Estado:
**abierto** (latente).

---

### [BAJO, abierto — residual de la ronda 14, sin cambios] `bitacora_insercion`: contador y encargado escriben lo que no pueden leer

`supabase/migrations/0079_rls_chofer_sin_lectura_personal.sql:33` ·
`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:197`

Sin cambios: el `with check` sigue siendo
`((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())`
mientras la lectura exige `administra_flota()`. El contador/encargado puede
sembrar una entrada con el correo del dueño como actor por algo que nunca
ocurrió; solo el flota_admin la lee. No se atacó en la ronda 14 — la
alineación con `administra_flota()` es de una línea. Estado: **abierto**
(documentado, sin regresión).

---

### [BAJO, abierto — residual de la ronda 14, sin cambios] El bucket público `avatares` acepta cualquier tipo de archivo de cualquier autenticado

`supabase/migrations/0046_perfil_avatar.sql:28-31`

Sin cambios: `avatares_propio_insert` restringe solo la carpeta
(`foldername(name))[1] = auth.uid()`) y el bucket, no la extensión ni el
content-type. Cualquier chofer con sesión puede subir un `.html` a una URL
pública en el subdominio de Supabase — sin XSS en la app (otro origen), pero
hosting público de contenido arbitrario y bucket llenable sin límite de mime.
El arreglo de una línea de la ronda 13 sigue sin aplicarse. Estado:
**abierto** (documentado, sin regresión).

---

### [BAJO, abierto — deuda de la ronda 12, sin cambios] Las policies de lectura del chofer siguen sin componer tenant

`supabase/migrations/0045_rls_operador.sql:52-60` ·
`supabase/migrations/0047_operacion_encargado.sql:187-189`

Sin cambios. Sigue sin ser explotable por las dos capas que ya documentaron
las rondas 12-14 (la FK compuesta `viaje_operador_tenant_fkey` y que solo el
service-role escribe `app_user.operador_id`), pero la sugerencia —añadir
`and tenant_id = any(get_user_tenant_ids())` a las cuatro— no se hizo; la
0081 era el momento natural de incluir la de `pod` y no lo hizo. Estado:
**abierto** (documentado, sin regresión).

---

## Lo que revisé y está bien

**El cierre de la 0083, en su mecánica y en su alcance.** Probé el validador
a mano contra las cuatro formas: llave ausente → `true`; `null` → `true` (sin
declarar); `"sí"` → `raise`; `{}` → `raise` (e y r `is null`); una sola
condición → `raise`; `"true"` como string → `raise` (`jsonb_typeof`).
`jsonb_exists` + `->` cubren tanto la llave ausente (SQL NULL) como el literal
`null` (`'null'::jsonb`) — las dos variantes se distinguen explícitamente. Y
el caso "ambas en null" que la ronda 14 temía como afirmación falsa ya no
puede escribirse desde ningún lado: ni el escritor (`crearFlota` tri-estado),
ni la base (0083), ni el edit de consola (que borra la llave en vez de
escribir `null`). El lector `!== undefined` queda como deuda muerta, no como
vector.

**Los 7 backend de `d7b171f`, verificados contra el código actual, no contra
el mensaje del commit.** El `503` de `resolverTenantApi` ante `error` (con
`logger.error` para que el bache deje rastro), el gate de rol en el alta de
usuario, el desempate `order('id')` del export, `traerTodo` en
`getPorFacturar` con su `LecturaIncompleta`, el texto del PDF al chofer, el
comentario muerto y el test de Stripe (firma, idempotencia, 500+reintento —
5 tests verdes). Ninguno abre superficie nueva: todos escriben con
service-role con `.eq('tenant_id')` explícito o están detrás de
`requireSuperadmin`.

**RFA 2.9 — la matriz y sus superficies.** Los 114 tests de `engine.test.ts`
verdes (incluida la matriz del 15%); `causasDe`/`ivaSostenible` en `fiscal.ts`
usan el MISMO `elegible15` que el motor (la rama `efectivo_no_elegible` es
nueva y alcanzable); `comun.tsx:opcionesDe` lo propaga al panel del contador;
`avisoTope15` recibe `elegible` y las tres ramas dicen exactamente lo
verificado; `tools.ts` reusa `getAcumuladoCombustible` — el chat y el motor ya
no pueden divergir en el criterio de combustible. `actualizarFacilidad15` y
`accionFacilidad` escriben tri-estado y la consola permite ver/corregir la
declaración (salvo por el defecto del hallazgo 2).

**Superficie de sesión y tenant intacta.** `session.ts` (SIN_ROL, reintento
antes de fail-closed), `guard.ts` (las tres puertas), `tenant-efectivo.ts`
(`?tenant=` validado contra la tabla real; `?rol=` solo quita visibilidad y
solo para superadmin), `proxy.ts` (CSP, HSTS, `no-store`, matcher que excluye
`/api`), webhook de WhatsApp (cap de body → HMAC → rate-limit por teléfono →
after()), crons (CRON_SECRET con 500), Stripe (firma) — **cero archivos
tocados** desde `caae369` salvo la línea del export y el 503 de tenant-api.
Sin `use client` que importe `supabaseAdmin` (verificado con grep), sin
secretos nuevos en `.env.example` (el passcode muerto sigue fuera).

**Pruebas de este rubro, todas verdes (768, sin la suite completa que corre
otro auditor):** auth (guard/permisos/visibilidad/session/tenant-efectivo/
provisionar/proxy) 206; engine 114 + fiscal 57 + por_diferencia 9 + stripe 5 +
conv 11; aviso/periodo + env + facturación 306; operacion 33 + administracion
27. `migraciones_verificadas.test.ts` incluye 0082/0083 (4 verdes).

**El seed del demo.** Declara `facilidadCombustibleEfectivo` con
`jsonb_set` anidado válido (`seed.sql:104-106`), la config pasa la 0083, y el
viaje VJ-2026-0847 está abierto — el camino del demo (WhatsApp real +
`/dashboard`) no cruza ninguno de los hallazgos: el POD exige sesión web de
chofer + PostgREST directo (el guion no provisiona esa sesión; `GUION_DEMO.md`
no la menciona), `actualizarFacilidad15` exige editar en la consola durante
un bache (el guion no edita la facilidad), y la pantalla ARCO no está en el
guion.

## Lo que no alcancé a revisar

- **No corrí los bloques 56 (ni 54/55) contra la base real.** Regla de la
  ronda: no tocar la base. Verifiqué que el 56 existe y que sus expectativas
  son las que el código dice; no puedo afirmar que pasen en vivo. Tampoco sé
  si la base real tiene el bloque 56 dentro de su set de verificación.
- **Pen-test real del escenario del hallazgo 1 contra PostgREST de
  producción** (curl con sesión de chofer). Razonado contra las policies, no
  ejecutado.
- **Si la base real tiene configs escritas por el `crearFlota` de la 0d23f73**
  (form de checkboxes que mandaba `false` explícito para casilla sin marcar →
  "declaró que NO" en vez de "sin declarar"). Razoné que 0d23f73 nunca llegó a
  producción, pero no pude mirar la tabla real.
- **El esquema de Auth de Supabase** (plantillas de magic link, OAuth, SMTP)
  sigue viviendo en el panel, no en migraciones.
- **La suite completa** (3,155) no la corrí — otros auditores la tienen.

## VEREDICTO

**Green light para la demo, con un MEDIO reabierto por tercera ronda, un
MEDIO nuevo en la consola y la pantalla ARCO muerta.** El camino del demo no
toca ninguno: el 1 exige sesión web de chofer + PostgREST directo (el guion
no la provisiona), el 2 exige editar la facilidad en la consola en el
instante exacto de un bache de red (el guion no la edita), y los BAJOs son
deuda documentada. Los cierres de la ronda 14 que este rubro puede reclamar
están puestos y hacen lo que dicen — el de la RFA 2.9, con la 0083 en la base
real, es de los mejores que ha recibido este rubro: la frontera de la base
ahora valida la forma de la décima llave con el mismo esmero que las otras
nueve.

La nota no sube porque el patrón de fondo no cambió: el rubro vuelve a la mesa
con el mismo MEDIO que creía cerrado en la 13 y en la 14 (y cuyo bloque de
verificación sigue codificando el vector abierto), y la edición nueva de la
consola —`actualizarFacilidad15`— repite la familia de siempre sin una sola
prueba: lee sin comprobar el error y, con un parpadeo de red, borra la
config de una flota entera en una escritura que la 0083 considera válida.
Tres arreglos de una línea con su prueba: dropear la policy del POD y exigir
el rechazo del INSERT del chofer en el bloque 56, comprobar el error de la
lectura en `actualizarFacilidad15`, y decidir quién ve la pantalla ARCO (el
superadmin con todas las solicitudes, o la flota en `/dashboard`).
