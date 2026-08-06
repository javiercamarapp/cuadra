# Seguridad — auditoría 14

**Nota: 7/10** (baja de 8 de la ronda 13). Razón del movimiento: **el cierre
del único MEDIO de la ronda 13 (`operador_sube_su_pod`, commit `4da0198` /
mig. 0081) atacó la VARIANTE del hallazgo, no su NÚCLEO — y el bloque 56 que
lo "verifica" codifica el vector que quedó abierto.** La 0081 amarra el
`tenant_id` del POD al del viaje (el "variante menor" que la propia ronda 13
calificó como lo que NO hacía falta para el MEDIO), pero el núcleo —el chofer
auto-certifica su propia entrega con `estado='subido'` sin subir nada, la
única puerta del código a ese estado— sigue intacto y ahora tiene un bloque de
verificación que afirma `pod-en-su-flota=t`, o sea que PRESERVA el INSERT del
chofer. Además, la RFA 2.9 (nueva en esta ronda) metió una llave nueva de
config **sin validación de forma** en el validador que acaba de reescribir
(0082 valida 9 de 10 llaves con mensajes de error de tres líneas), y el motor
lee esa llave con una asimetría `?? null` (escritor) vs `!== undefined`
(lector) que convierte una declaración a medias en la afirmación falsa "la
flota declaró que NO califica". Deuda que cobra factura + código nuevo con el
mismo apetito de siempre: *se valida una parte y se olvida la otra*.

---

## Verificación de los cierres de la ronda 13 (el encargo central)

Los 13 commits de la re-auditoría se abrieron y se leyeron. Lo que este rubro
reclama como suyo:

**`4da0198` (POD, MEDIO) — CERRADO A MEDIAS, reabierto como hallazgo 1.**
La 0081 (`0081_pod_tenant_amarrado.sql:14-19`) dejó la policy viva y solo le
añadió `and tenant_id = (select tenant_id from public.viaje where id = viaje_id)`.
El commit dice "el POD del chofer queda en SU flota" — cierto, y nada más.
El hallazgo de la ronda 13 decía otra cosa: su "Por qué MEDIO y no ALTO"
explica que el daño NO es la frontera de tenant ("el viaje es suyo; el
tenant_id foráneo solo crea filas huérfanas que ninguna pantalla muestra") sino
el **tamper de la constancia de entrega**: chofer inserta `estado='subido'` con
un `storage_path` cualquiera y la oficina lee "Recibido" (`pod/vista.tsx:17`)
y el tablero deja de perseguir esa evidencia (`operacion.ts:75`). Eso NO se
tocó. Peor: el bloque 56 (`verificaciones.sql:3108-3150`) siembra al chofer y
exige `pod-en-su-flota=t` con un INSERT de `estado='pendiente'` — el bloque
que la re-auditoría citó como prueba del cierre está **verificando que el
vector quede abierto**. Detalle en el hallazgo 1.

**`37d75ee` (panel contador, ALTO fiscal) — cerrado, correcto para este
rubro.** El diff es una línea en `fiscal.ts` (`ivaSostenible` descarta
`pendiente`/`no_encontrado`). No toca rutas, ni permisos, ni RLS. Sin
regresión de seguridad.

**`b286aa8` (`[id]/page.tsx` rolEfectivo, MEDIO) — cerrado, correcto.** El
render gatea con `rolEfectivo(rolReal, sp.rol)` (`[id]/page.tsx:40-47`) y las
dos acciones destructivas (`reabrir` :101-121, `reasignar` :123-141) re-chequean
con `requireSessionTenant` + `puedeAdministrar`/`puedeAsignar` sobre el rol
REAL de la sesión — el `?rol=` del query string no otorga nada. La resolución
del tenant demo sigue usando `rolReal` (:64). Verificado contra el código
actual, no solo el mensaje del commit.

**`574137c` (ARCO pre-identidad, MEDIO) — cerrado, correcto.**
`buscarTenantPorTelefono` (`conv.ts:641-657`) hace `.limit(2)` y ante dos
filas devuelve `null` (el caller pide identificar la flota). `.in()` no
duplica filas por variante, así que dos filas = dos operadores distintos;
falso rechazo solo si dos operadores de la MISMA flota comparten teléfono,
caso que el flujo resuelve igual que `resolveOperador`.

**`5ef6993` (operador.rfc, MEDIO) — cerrado, correcto.** `accionRfc`
(`operadores/page.tsx:157-181`) gatea con `puedeAdministrar(s.rol)` sobre la
sesión real y `actualizarRfcOperador` (`repo.ts:901-908`) filtra
`.eq('id', operadorId).eq('tenant_id', tenantId)` — el id del operador no
puede cruzarse a otra flota.

**`c563a0a` (seed.sh / passcode, ALTO+MEDIO) — cerrado, correcto.** El
passcode muerto ya no aparece en `src/` (solo la nota histórica en
`observability/arranque.ts:20-21` y `.env.example:44`); el script de seed
detecta el esquema antes de migrar. Sin superficie nueva.

**`de6416f` (chat → 'dinero'), `ac58536` (CifraGrande), `94a3521`
(vence_en), los tres agentico — verificados por sus rubros; para seguridad
son neutros** (un renglón en el mapa de rutas, un componente de frontend, un
cálculo de fecha en privacidad.ts, y guardias de texto). Ninguno toca
sesión, permisos, RLS ni secretos.

**Los 3 BAJOS de la ronda 13 — siguen abiertos, sin regresión ni ataque.**
Ninguno de los 13 commits los menciona: `bitacora_insercion` sigue con su
asimetría (`0079:33`, hallazgo 4 de este reporte), el bucket `avatares` sigue
aceptando cualquier mime de cualquier autenticado (`0046:17-30`, hallazgo 5),
y las policies de lectura del chofer siguen sin componer `tenant_id`
(`0045:52-60`, hallazgo 6).

**Superficie crítica intacta (sin regresión posible).** `git log caae369..HEAD`
sobre `proxy.ts`, `middleware.ts`, `api/webhook/*`, `api/cron/*`, `api/stripe/*`,
`api/export/*`, `api/dashboard/*`: **cero archivos tocados**. Todo lo que la
ronda 13 verificó ahí (HMAC del webhook, CRON_SECRET, firma de Stripe, CSP,
IDOR de dinero, `Cache-Control: no-store`) sigue exactamente como se verificó.

---

## Hallazgos

### [MEDIO, abierto — cierre incompleto de la ronda 13] `operador_sube_su_pod`: el núcleo del hallazgo (auto-certificación) sigue vivo, y el bloque 56 lo codifica

`supabase/migrations/0081_pod_tenant_amarrado.sql:14-19` ·
`supabase/verificaciones.sql:3108-3150` · `src/app/dashboard/pod/vista.tsx:17` ·
`src/lib/cuadra/operacion.ts:75`

La ronda 13 recomendó `drop policy operador_sube_su_pod` porque el chofer no
tiene ningún flujo legítimo que escriba `pod` desde la web (verificado de
nuevo: `'subido'` solo se LEE en `pod/vista.tsx:17,37,101` y
`operacion.ts:75,455`; ningún código de la app lo escribe). El fix elegido en
su lugar mantuvo la policy y le añadió el amarre de tenant:

```sql
create policy operador_sube_su_pod on public.pod for insert
  with check (
    viaje_id in (select id from public.viaje where operador_id = get_user_operador_id())
    and tenant_id = (select tenant_id from public.viaje where id = viaje_id)
  );
```

Eso cierra la "variante menor" de la ronda 13 (la fila cruzada a otro
tenant). El núcleo no: **el chofer sigue pudiendo insertar el POD de SU viaje
con `estado='subido'` y un `storage_path` cualquiera**, y la oficina lee
"Recibido". Y el bloque 56 —la prueba que la re-auditoría citó como cierre—
inserta con `estado='pendiente'` y exige `pod-en-su-flota=t`
(`verificaciones.sql:3133,3146`): el bloque **verifica que el INSERT del
chofer siga pasando**, exactamente el vector que el hallazgo original pedía
cerrar.

**Escenario, con valores.** El chofer de Transportes Innovativos (sesión web
`rol=operador`, la anon key pública y su access token) hace:

```
GET  /rest/v1/viaje?select=id&operador_id=eq.<su operador>   -- enumera SUS viajes (operador_ve_su_viaje, 0045:56)
POST /rest/v1/pod
Authorization: Bearer <access_token del chofer>
{ "tenant_id": "<A>", "viaje_id": "<VJ-2026-0847>",
  "operador_id": "<su operador>",
  "estado": "subido", "storage_path": "falso.jpg" }
```

Pasa el `with check` de la 0081 (el viaje es suyo y el tenant es el del
viaje), pasa `pod_estado_dominio` y `pod_subido_tiene_archivo`
(`0047:140-144`, cualquier string no nulo), y el `tenant_data` de `pod` no
interviene (INSERT del chofer, `not is_operador()` falla, no hay otra policy
de insert). Resultado: la pantalla POD pinta "Recibido" (`pod/vista.tsx:17`),
el tablero de despacho deja de contar el viaje como "sin POD"
(`operacion.ts:75`), y nadie vuelve a perseguir esa evidencia — sin foto, sin
subida, sin verificación. Detalle no cubierto por la policy: `operador_id` no
se valida contra el viaje, así que el chofer puede atribuir la entrega a
cualquier `operador_id` del esquema (la FK de `pod.operador_id` es global,
sin tenant).

**Por qué MEDIO y no ALTO**: igual que la ronda 13 — no cruza la frontera de
tenant (el amarre de la 0081 se respeta), requiere sesión web de chofer +
PostgREST directo (no es disparable desde la UI, y el guion del demo no usa
sesión de chofer), y la oficina conserva el botón de rechazo. Pero es tamper
de la constancia de entrega, la familia que este rubro persigue desde la
ronda 10, y la 0081 era el momento natural de barrerlo — en vez de eso, el
bloque 56 lo blindó con una expectativa verde.

**El arreglo honesto**: el que la ronda 13 ya escribió — `drop policy
operador_sube_su_pod` y extender el bloque 55/56 para que el INSERT del
chofer (con `estado='subido'` incluido) se exija rechazado; la policy vuelve
el día que exista la subida real desde `/chofer`, con verificación del
archivo en Storage. Estado: **abierto** (cierre incompleto de la ronda 13).

---

### [MEDIO, abierto — nuevo] RFA 2.9: `facilidadCombustibleEfectivo` no tiene validación de forma en la 0082, y el motor lee `null` como "declaró que NO"

`supabase/migrations/0082_config_facilidad15.sql:19-21` ·
`src/lib/cuadra/administracion.ts:110-120` · `src/lib/cuadra/cuadre/desde_db.ts:55-58` ·
`src/lib/cuadra/cuadre/engine.ts:329-334`

La 0082 reescribe `config_tenant_valida` —el CHECK que valida TODA la config
del tenant en la frontera de la base (`0026:337`)— para admitir la décima
llave. Valida la forma de las otras nueve con mensajes de error que explican
el daño ("Un cero o un null aquí produce una desviación de diésel infinita o
ninguna"). **Para `facilidadCombustibleEfectivo` no hay un solo bloque de
validación**: puede ser un string, un array, un número, lo que sea, y el CHECK
pasa. Y el par escritor/lector tiene una asimetría:

```ts
// administracion.ts:113-114 (escritor)
dedicacionExclusivaCarga: f.dedicacionExclusivaCarga ?? null,
regimenElegible: f.regimenElegible ?? null,

// desde_db.ts:56-58 (lector)
const facilidad15 = (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
  ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
  : undefined;
```

El escritor guarda `null` para el campo que no llegó; el lector distingue
`undefined` ("sin declarar") pero NO `null` — `null !== undefined` es true, y
`null === true` es false, así que **un solo campo en `null` convierte toda la
facilidad en `false`** y el motor cae en la rama que afirma:

> "la flota declaró que NO califica a la facilidad del 15% (dedicación
> exclusiva o régimen), así que el combustible exige pago electrónico (LISR
> 27-III) — no deducible." (`engine.ts:333`)

**Escenario, con valores.** `crearFlota` recibe una declaración a medias —
hoy solo puede venir de un llamador futuro o de un test, porque el form de
`/admin/flotas` (`flotas/page.tsx:37-38`) siempre manda los dos como
booleanos: `{ dedicacionExclusivaCarga: true, regimenElegible: undefined }`
(vía API, vía un editor futuro, vía SQL directo — la base lo acepta porque la
0082 no valida la forma). Se guarda
`config.facilidadCombustibleEfectivo = { dedicacionExclusivaCarga: true, regimenElegible: null }`.
El lector: `null !== undefined` → true; `true === true && null === true` →
false → `facilidad15 = false`. La liquidación de un viaje con $5,800 de
diésel en efectivo imprime "la flota declaró que NO califica" — **falso**: la
flota declaró dedicación sí y régimen sin llenar. El rótulo afirma lo que no
se verificó, la familia exacta de "Nunca inventar una cifra". Y si el valor
fuera un string (`"true"`), la 0082 también lo acepta y el resultado es el
mismo: `"true" === true` es false. El único sentido del fallo es negar la
deducción (nunca afirmarla de más), pero niega con una mentira dicha como
hecho.

**Por qué MEDIO y no BAJO**: no tiene llamador que lo dispare HOY (el único
productor es el form, que siempre manda booleanos), pero es la frontera de
base —el CHECK `config_tenant_valida`— la que quedó ciega para la llave que
esta misma ronda añadió, y el par `?? null` / `!== undefined` es un defecto
real del código nuevo. Cualquiera de las dos cosas se arregla sola con una
línea: validar la forma en la 0082 (`jsonb_typeof` de objeto + booleanos) y
escribir `?? undefined` en `crearFlota` (o leer con `=== true` en vez de
`!== undefined`). Estado: **abierto**.

---

### [BAJO, abierto — nuevo] El contador del 15% interpola `clavesCombustible` sin escapar en el filtro PostgREST

`src/lib/cuadra/cuadre/desde_db.ts:64-72`

```ts
.or(`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})`)
```

Las claves vienen de `config.hidrocarburos?.claves` — texto de la config del
tenant, que la 0082 valida solo como "array de strings", sin exigir el
formato de 8 dígitos del SAT ni prohibir los metacaracteres de PostgREST
(`,` `(` `)` `.`). Una clave como `x),(monto.gt.0` pasaría el CHECK y, al
cuadrar, cambiaría la semántica del `.or()` dentro del AND de tenant. HOY no
es explotable: nadie con sesión de tenant escribe `hidrocarburos` (los únicos
escritores de `tenant.config` son service-role: `crearFlota`,
`guardarPolitica` —que preserva la llave— y el seed/SQL), y el `.eq('tenant_id')`
exterior impide que una inyección cruce de tenant. Es deuda de defensa en
profundidad en código nuevo: la validación que acaba de escribirse (0082) es
el lugar natural para exigir `^\d{8}$` en las claves, y el `.or()` debería
armarse por `in.(${claves.map(escapear).join(',')})` o con un `.in()` nativo
del SDK. Estado: **abierto** (latente).

---

### [BAJO, abierto — residual de la ronda 13, sin cambios] `bitacora_insercion`: contador y encargado escriben lo que no pueden leer

`supabase/migrations/0079_rls_chofer_sin_lectura_personal.sql:33` ·
`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:197`

Sin cambios desde la ronda 13: el `with check`
`((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())`
sigue dejando INSERT a contador/encargado mientras la lectura exige
`administra_flota()`. Escenario de la ronda 13 intacto (el contador siembra
una entrada con el correo del dueño como actor por algo que nunca ocurrió;
solo el flota_admin la lee). No se atacó en la re-auditoría — la alineación
con `administra_flota()` es de una línea. Estado: **abierto** (documentado,
sin regresión).

---

### [BAJO, abierto — residual de la ronda 13, sin cambios] El bucket público `avatares` acepta cualquier tipo de archivo de cualquier autenticado

`supabase/migrations/0046_perfil_avatar.sql:17-20`

Sin cambios: `avatares_propio_insert` no restringe extensión ni content-type.
Cualquier chofer con sesión puede subir un `.html` a una URL pública en el
subdominio de Supabase (sin XSS en la app — otro origen — pero hosting
público de contenido arbitrario y bucket llenable sin límite de mime). El
arreglo de una línea de la ronda 13 (`lower(storage.extension(name)) in
('jpg','jpeg','png','webp','gif','avif')`) sigue sin aplicarse. Estado:
**abierto** (documentado, sin regresión).

---

### [BAJO, abierto — deuda de la ronda 12, sin cambios] Las policies de lectura del chofer siguen sin componer tenant

`supabase/migrations/0045_rls_operador.sql:52-60` ·
`supabase/migrations/0047_operacion_encargado.sql:187-193`

Sin cambios. Sigue sin ser explotable por las dos capas que ya documentó la
ronda 12 (la FK compuesta `viaje_operador_tenant_fkey` y que solo el
service-role escribe `app_user.operador_id`), pero la sugerencia de la ronda
13 —añadir `and tenant_id = any(get_user_tenant_ids())` a las cuatro— siguió
sin hacerse; la 0081 era el momento natural de incluir la de `pod` y no lo
hizo. Estado: **abierto** (documentado, sin regresión).

---

## Lo que revisé y está bien

**El cierre de la 0081 en lo que declara.** El amarre `tenant_id = (select
tenant_id from viaje where id = viaje_id)` es correcto y el bloque 56
(`verificaciones.sql:3108-3150`) lo prueba de verdad con dos tenants:
`pod-en-su-flota=t` (3133) y `pod-en-flota-ajena=f` (3139). El subquery
devuelve NULL para viaje inexistente y `tenant_id = NULL` falla — el INSERT
con `viaje_id` ajeno o nulo rebota. Lo que falla es la AMBICIÓN del cierre,
no su mecánica (hallazgo 1).

**La RFA 2.9 nueva — superficie de datos verificada.** `cuadrarDesdeDB`
(`desde_db.ts`) consulta con `supabaseAdmin()` y `tenant_id` que viene de
callers confiables (el processor lo resuelve del teléfono del mensaje con
HMAC; `analytics.ts:800` de la sesión) — sin parámetro de tenant que un
cliente controle. La matriz del motor está probada y la tracé a mano: el
gasto que cruza la frontera del 15% NO está en `NO_DEDUCIBLE_ISR`
(`engine.ts:97`), así que la cubeta proporcional (`engine.ts:1086-1108`)
aplica el reparto `dentro/excedente` y el test lo confirma
(`engine.test.ts`: `totalNoDeducible=900, totalDeducible=100`). Los tres
tipos nuevos están en `SIN_ACREDITAMIENTO` (`engine.ts:956`) — dentro de la
facilidad no se acredita IVA/IEPS, como dice la nota. `cierre_aviso.ts` y
`por_diferencia.ts` clasifican los tres tipos con su ruta y su ficha (la
`rfa-2026-2.9` ya existía).

**`crearFlota` sigue siendo superadmin-gated** (el action vive en
`/admin/flotas`, que re-pasa `requireSuperadmin`), escribe con service-role,
y el CHECK de la 0082 rechaza llaves que el tipo no conoce — el alta con la
llave nueva no puede romper la config de una flota existente. El seed del
demo declara `{dedicacionExclusivaCarga:true, regimenElegible:true}` con
`jsonb_set` anidado válido.

**Los 5 tests de la matriz RFA 2.9 pasan** (`engine.test.ts`, 112 verdes) y
los de este rubro: auth (guard/permisos/visibilidad/session/
tenant-efectivo/provisionar) **185 verdes**, `migraciones_verificadas` 4,
`por_diferencia` 9, `env` 6, `conv_directo`+`conv_lock` 17. Sin la suite
completa (otros auditores la corren).

**Sin regresión en la superficie crítica**: export de CSV/PDF, chat, export
fiscal, webhook de WhatsApp (HMAC + cap de body), crons (CRON_SECRET), Stripe
(firma), CSP del proxy, `next` del login — **cero archivos tocados** desde
`caae369` (verificado con `git log caae369..HEAD -- <rutas>`).

**RLS — inventario de esta ronda**: 0081 recrea una policy; 0082 no crea
ninguna. El esquema de policies queda idéntico al que la ronda 13 inventarió,
con la única diferencia el amarre de la 0081.

**Secretos**: `DASHBOARD_PASSCODE` muerto fuera del código y de la doc de
envs; ningún archivo nuevo con `use client` importa `supabaseAdmin`; los
secretos siguen solo en el lado servidor.

## Lo que no alcancé a revisar

- **No corrí los bloques 56 (ni 54/55) contra la base real.** Regla de esta
  ronda: no tocar la base. Verifiqué que el 56 existe y que sus expectativas
  son las que el código dice; no puedo afirmar que pasen en vivo.
- **Pen-test real del escenario del hallazgo 1 contra PostgREST de
  producción** (curl con sesión de chofer). Razonado contra las policies, no
  ejecutado.
- **El esquema de Auth de Supabase** (plantillas de magic link, OAuth, SMTP)
  sigue viviendo en el panel, no en migraciones.
- **La interacción del 15% con el cambio de ejercicio** (viaje de diciembre
  liquidado en enero: `desde_db.ts:59` usa el año del reloj del servidor, no
  el del viaje, y el contador del año nuevo arranca en cero) la vi y la dejé
  — es exactitud fiscal, rubro fiscal, y el hallazgo 2 de este reporte
  comparte raíz con su validación.
- **La suite completa** (3,132) no la corrí.

## VEREDICTO

**Green light para la demo, con un cierre incompleto reabierto y un MEDIO
nuevo documentado.** El camino del demo (WhatsApp real + `/dashboard`) no
toca ninguno de los hallazgos: el 1 exige sesión web de chofer + PostgREST
directo (el guion no provisiona esa sesión), el 2 no tiene llamador hoy, y
los BAJOs son deuda documentada. Los cierres de la ronda 13 que este rubro
puede reclamar —rolEfectivo en `[id]`, ARCO, `operador.rfc`, passcode,
chat→dinero— están puestos y hacen lo que dicen. Pero el reporte de la ronda
13 terminaba pidiendo, como "arreglo honesto", `drop policy
operador_sube_su_pod`; lo que se entregó fue un amarre de tenant + un bloque
de verificación que exige que el INSERT del chofer siga pasando. Eso baja la
nota: el rubro vuelve a la mesa con el mismo MEDIO que creía cerrado y con el
validador nuevo (0082) repitiendo el apetito de siempre — 9 llaves validadas
con esmero, la décima sin forma, y un lector que convierte el `null` en una
afirmación falsa. Los tres arreglos siguen siendo de una línea cada uno, con
su bloque de verificación: dropear la policy del POD y exigir el rechazo del
INSERT del chofer (incluido `estado='subido'`), validar la forma de
`facilidadCombustibleEfectivo` en la 0082 y alinear `?? null` con `=== true`,
y el mime del bucket avatares.
