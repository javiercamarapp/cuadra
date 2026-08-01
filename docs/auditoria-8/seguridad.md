# Seguridad — auditoría 8

**Nota: 7/10** (antes 8). Razón del movimiento: **mirada más profunda — el código
no cambió en ese punto, la nota anterior estaba inflada.**

La ronda 6 describió con todas sus letras que `hayPasscode()` apaga a la vez las
DOS capas del panel, y decidió no elevarlo «porque no cambió». El ancla de este
rubro no pregunta si cambió: pregunta si *toda ruta privilegiada tiene dos capas
independientes*. No las tiene — `proxy.ts:38` y `guard.ts:33` comparten un solo
predicado, y ese predicado es una variable de entorno. Eso es exactamente el
«7: el diseño es correcto y las capas son una sola en algún punto». Además, la
propia ronda cobró una factura chica: la 0035 vino a fijar `search_path` en las
diez funciones que no lo tenían y la 0036 —la migración siguiente, del mismo
día— creó la undécima sin él y sin `revoke`.

Lo que sí sostiene el 7 y no el 6: **no encontré ningún crítico, ningún secreto
con fallback silencioso, y el barrido anónimo del 31-jul está bien hecho y bien
anotado.** Ataqué las dos páginas públicas nuevas —incluida la parametrizada por
tenant— y no filtran nada que no deba ser público.

**El riesgo mayor del rubro, hoy:** el panel del contralor no tiene dos candados
sino uno con dos cerraduras montadas sobre el mismo pestillo, y el pestillo es
`DASHBOARD_PASSCODE` en Vercel.

---

## Hallazgos

### [ALTO · REINCIDENTE r5→r6→r8] Las dos capas del panel comparten un solo predicado: sin `DASHBOARD_PASSCODE` abren las dos a la vez

`src/proxy.ts:38` · `src/lib/auth/guard.ts:33` · `src/lib/auth/passcode.ts:172-182`

`guard.ts:1-19` declara por escrito que existe para ser *la segunda capa, la que
no depende de un regex*, «si el proxy falla, esto sigue de pie». Pero las dos
consultan la misma función:

```
proxy.ts:38     if (hayPasscode() && !(await tokenMatches(cookie))) { …redirect… }
guard.ts:33     if (!hayPasscode()) return;                    // dev sin passcode
passcode.ts:172 function passcodeConfigurado() { const p = process.env.DASHBOARD_PASSCODE; if (!p) return null; … }
passcode.ts:180 export function hayPasscode() { return passcodeConfigurado() !== null; }
```

**Escenario, con valores.** En Vercel, `DASHBOARD_PASSCODE` queda definida solo
para el entorno *Preview* y no para *Production* (o se renombra, o se borra al
limpiar variables después del demo). `process.env.DASHBOARD_PASSCODE` es
`undefined` → `passcodeConfigurado()` devuelve `null` → `hayPasscode()` devuelve
`false`. Entonces:

```
GET https://<host>/dashboard        sin cookie, sin nada
  proxy.ts:38  → el `&&` corta en el primer operando: no redirige, devuelve `res`
  page.tsx:57  → exigirAcceso('/dashboard') → guard.ts:33 → return inmediato
  → 200 con getKpis / getLiquidaciones / detectarAnomalias del tenant
     11111111-1111-1111-1111-111111111111 (o el DEMO_TENANT_ID puesto):
     folios, fechas, nombres de operadores, montos comprobados y diferencias
GET https://<host>/dashboard/<uuid-de-liquidación>
  → 200 con el desglose por concepto y el botón al PDF
```

Nada falla, nada devuelve 500, no hay diferencia visible con el estado bueno: el
panel simplemente deja de pedir el código. Y ninguna de las dos capas puede
salvar a la otra, porque las dos evalúan la misma expresión.

Intenté refutarlo y encontré tres guardarraíles, ninguno suficiente:
1. `instrumentation.ts:24` → `arranque.ts:29,50` emite
   `logger.error('startup.config_silenciosa', { faltan: ['DASHBOARD_PASSCODE: proxy.ts no bloquea /dashboard'] })`
   en cada arranque desplegado. Es una **alarma, no un candado**, y depende de
   `SENTRY_DSN` para que alguien la vea fuera del runtime log de Vercel.
2. Con un passcode **débil** el comportamiento sí es fail-closed:
   `exigirPasscodeFuerte` (`passcode.ts:151-163`) lanza y el proxy responde 500.
   La asimetría es la prueba de que el fail-open de la ausencia no es una
   decisión, es un hueco: el mismo módulo cierra ante un secreto malo y abre
   ante un secreto ausente.
3. Las rutas de API sí fallan cerradas con el mismo secreto:
   `api/export/liquidaciones/route.ts:20` y `api/export/pdf/[id]/route.ts:36`
   llaman **solo** `tokenMatches`, que devuelve `false` sin passcode
   (`passcode.ts:238`) → 401. O sea: el repo tiene los dos criterios a la vez, y
   el que abre es el que protege el panel.

**Consecuencia.** El contralor: la contabilidad de su flota, los nombres de sus
operadores y sus liquidaciones quedan servidas a cualquiera que teclee
`/dashboard` en un host público, sin un solo error en pantalla. Y el operador:
su nombre y sus montos son datos personales tratados por cuenta de la flota —una
exposición así es el supuesto del art. 20 de la LFPDPPP.

**Causa raíz probable:** «sin passcode configurado = modo desarrollo = no
bloquear» es una decisión de *dev-ex* que quedó dentro del predicado compartido
por las dos capas, en vez de a un lado de él.

---

### [MEDIO · NUEVO] Tres RPC del pipeline se revocan de `public/anon/authenticated` y nunca se conceden a `service_role`: hoy corren por un GRANT implícito de Supabase que ninguna migración escribe

`supabase/migrations/0021_liquidacion_litros_diesel.sql:55` ·
`supabase/migrations/0017_enriquecer_gasto_atomico.sql:55` ·
`supabase/migrations/0018_aviso_privacidad.sql:65`

Seis migraciones conceden explícito y tres no. Las que sí:
`0012:16-18` (`try_lock_viaje`, `unlock_viaje`, `intake_delta`), `0013:56`
(`guardar_liquidacion_tx` de **11** argumentos), `0030:49`
(`indices_faltantes`), `0031:84` (`intake_delta`), `0033:145-146`
(`confirmar_aviso_privacidad`, `liberar_aviso_privacidad`). Las que no:

```
0017:55  revoke all on function enriquecer_gasto_codigo(uuid,uuid,jsonb,text) from public, anon, authenticated;
0018:65  revoke all on function marcar_aviso_privacidad(uuid,uuid,text)       from public, anon, authenticated;
0021:55  revoke all on function guardar_liquidacion_tx(…12 argumentos…)       from public, anon, authenticated;
                                        ← y aquí se acaba el archivo. No hay grant.
```

La de 0021 es la del dinero, y **no hereda el grant de 0013**: `0022` dropea la
firma de 11 argumentos (`0022:31`) y la de 12 es una función distinta, con ACL
nueva. Que hoy funcione demuestra una sola cosa —y es el hallazgo—: existe un
`ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS … TO service_role` en el
esquema `public` que el proyecto de Supabase trae de fábrica y del que estas tres
funciones dependen sin decirlo. La prueba está en el propio repo: la constancia
de aviso del 28-jul se escribió por `repo.ts:477 → rpc('marcar_aviso_privacidad')`
como `service_role`, sobre una función que solo tenía la línea de `revoke`.

**Escenario, con valores.** Se aplica `supabase/migrations/*` sobre un proyecto
donde ese default no está —self-host, un proyecto donde alguien endureció con
`alter default privileges in schema public revoke all on functions from
service_role`, o un `db push` corrido por un rol distinto de `postgres`—. El
esquema queda completo: las tablas, los índices, las 12 funciones. El arranque
sondea `try_lock_viaje`, `intake_delta` y una columna (`startup.ts:74,84,89`) —
las tres cubiertas por `0012:16-18`— y emite `startup.migraciones { ok: true }`.
El primer «listo» llega a `guardar_liquidacion` y PostgREST devuelve
`42501 permission denied for function guardar_liquidacion_tx`. La liquidación no
se guarda, el PDF no sale, y el diagnóstico de arranque dice verde.

`verificaciones.sql:629` solo comprueba `service_role` sobre `intake_delta`, que
es justamente una de las que **sí** tiene grant explícito: el bloque confirma la
que no hace falta confirmar.

**Consecuencia.** Quien mantenga esto: el modelo de privilegios de la función
que escribe el dinero no está en ningún archivo, así que no se puede revisar ni
reproducir. Y el día que se levante un segundo proyecto (el segundo cliente, un
staging), el money-path muere con un 42501 y el arranque certifica que todo está
bien.

**Causa raíz probable:** la convención del repo es «revoke + grant explícito» y
se aplicó en seis migraciones de nueve; en las tres restantes el `grant` se dio
por sobrentendido porque en Supabase funciona sin él.

---

### [MEDIO · REINCIDENTE r5→r6→r8, sin tocar] La URL firmada del PDF que se manda por WhatsApp sigue viva una hora

`src/lib/cuadra/processor.ts:880`

```ts
const path = `${op.tenantId}/${viajeId}-operador.pdf`;
const { data, error } = await supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600);
…
await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
```

**Escenario, con valores.** El único consumidor es Meta: `sendDocument`
(`meta/client.ts:106-118`) le pasa la URL en `document.link` y Meta la descarga
por su cuenta en segundos. La firma sigue válida **3,600 s**, o sea ~3,590
segundos más de lo que dura la necesidad. Cualquiera que dentro de esa hora
obtenga la cadena —un log de la cadena Graph, un proxy corporativo, un
reenvío del `link` antes de que Meta lo consuma— descarga el PDF con nombre del
operador, folio del viaje, anticipo, comprobados y diferencia, sin cookie y sin
passcode.

Lo mismo que la ronda 6: la plantilla correcta está a cien líneas, en
`api/export/pdf/[id]/route.ts:59`, que firma con **60**. Tercera ronda que la
línea 880 no se toca.

**Consecuencia.** El operador y la flota: el documento con su dinero es
descargable por quien intercepte la URL durante una hora.

**Causa raíz probable:** 3600 es el default de ejemplo de `createSignedUrl`; el
TTL se copió del ejemplo, no de la vida del consumidor.

---

### [BAJO · NUEVO] La 0036 crea la undécima función sin `search_path` y sin `revoke`, el día después de que la 0035 vino a cerrar exactamente eso

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:55-70`

```sql
create or replace function gasto_no_tras_liquidar()
returns trigger
language plpgsql
as $$ …
  select exists (select 1 from liquidacion where viaje_id = new.viaje_id) into ya;
```

Sin `set search_path`, sin `security definer` (o sea, INVOKER) y sin la línea de
`revoke` que el resto de las migraciones sí escribe. La 0035 fija `search_path`
en diez funciones y dice, en su encabezado, que son «las diez que no lo tenían»
según el linter del 31-jul; `indices_faltantes` (0030:31) y las dos de 0001
(`0001:96,102`) ya lo traían inline. Con la 0036 vuelven a ser once contra diez.

**Escenario, con valores.** Se corre el Security Advisor de Supabase antes del
demo (es lo que produjo la 0035): `function_search_path_mutable` vuelve a
reportar **1 WARN**, sobre `public.gasto_no_tras_liquidar`, en una base cuyo
barrido de ayer salió limpio. Y el modo de fallo que la 0035 nombra en su razón
nº1 —«el día que entre el auth por usuario, `authenticated` va a poder llamar
algunas de éstas»— aplica peor aquí que en las diez: si esta función llega a
correr bajo un rol con un esquema propio delante de `public`, `liquidacion`
resuelve a otra tabla, `ya` sale `false` y la barrera que cierra el último
crítico de las siete rondas deja pasar el gasto tardío en silencio. Lo mismo por
la otra puerta: al ser INVOKER, bajo cualquier rol sujeto a RLS la fila de
`liquidacion` queda invisible y el `exists` da `false`.

Lo refuté hasta donde llega: **hoy no hay explotación**. Solo `service_role`
inserta en `gasto`, y `service_role` bypasea RLS y no tiene esquema propio. Y
`returns trigger` hace que PostgREST no la exponga, así que la ausencia de
`revoke` tampoco abre nada llamándola directo.

**Consecuencia.** Quien mantenga esto: el barrido de seguridad de Supabase deja
de estar limpio a la vuelta de una migración, y el guardarraíl del dinero
depende de que el rol que inserte nunca cambie.

**Causa raíz probable:** la 0035 arregló la lista que el linter dio ese día en
vez de la regla; `create or replace` sin `set search_path` es el default de
Postgres, así que la próxima función lo vuelve a perder — y además borra el
`set` de cualquiera de las diez que alguien reemplace más adelante.

---

### [BAJO · NUEVO] El chequeo «rpc-abiertas-a-anon» del barrido usa una lista de nombres escrita a mano

`supabase/verificaciones.sql:738-745`

```sql
   where n.nspname = 'public'
     and p.proname in ('try_lock_viaje','unlock_viaje','intake_delta','enriquecer_gasto_codigo',
                       'guardar_liquidacion_tx','marcar_aviso_privacidad','confirmar_aviso_privacidad',
                       'liberar_aviso_privacidad','indices_faltantes')
     and has_function_privilege('anon', p.oid, 'execute');
```

Las otras dos comprobaciones del mismo bloque sí van contra el catálogo entero
(`sin_rls` recorre `pg_class`, `con_true` recorre `pg_policies`). Esta no: mira
nueve nombres literales.

**Escenario, con valores.** La 0036 —del mismo día que el barrido— añade
`gasto_no_tras_liquidar` a `public` sin `revoke`. Se vuelve a correr el bloque
18 y devuelve `rpc-abiertas-a-anon=—`, o sea «ninguna abierta», sin haber
mirado la función nueva. En este caso concreto no hay daño porque es un trigger
y PostgREST no lo expone; pero el bloque es el único mecanismo del repo que
vigila esta clase de hueco y su cobertura no crece con el esquema: la siguiente
función que alguien añada sin `revoke` produce el mismo `—` verde.

`migraciones_verificadas.test.ts` no cubre esto: obliga a que cada migración
tenga bloque o exención (la 0036 tiene el 19), no a que el bloque 18 conozca las
funciones nuevas.

**Consecuencia.** Quien mantenga esto: una comprobación que solo puede confirmar
lo que ya se sabía, con la apariencia de un barrido.

**Causa raíz probable:** la lista se escribió enumerando las RPC conocidas el
31-jul, en vez de derivarla del catálogo excluyendo las dos que son públicas a
propósito (`get_user_tenant_ids`, `is_superadmin`).

---

### [BAJO · REINCIDENTE r5→r6→r8, sin tocar] `bodyExcede` en `/api/demo` no vuelve a medir tras leer el cuerpo

`src/app/api/demo/route.ts:30` · `src/lib/ratelimit.ts:95-98`

**Escenario, con valores.** `POST /api/demo` con `Transfer-Encoding: chunked` y
sin `content-length`: `Number(null || 0)` da `0`, `bodyExcede(req, 65536)`
devuelve `false` = «cabe», y `req.json()` (línea 32) lee el cuerpo entero sin
tope propio. El webhook sí lo hace bien y sirve de contraste:
`webhook/whatsapp/route.ts:44-45` vuelve a medir con `raw.length` antes de la
firma.

**Consecuencia.** Acotada y así la dejo: el tope de 64 KB de esta ruta es en
realidad el de la plataforma. El propio `ratelimit.ts:88-93` documenta el hueco
y nombra el archivo; está anotado y sin atender por tercera ronda.

**Causa raíz probable:** el cap se pensó como una comprobación de cabecera, y
solo un llamador de dos aprendió que hay que remedir.

---

### [BAJO · REINCIDENTE r5→r6→r8, sin tocar] `/api/demo` publica sin autenticar qué grupos de secretos están configurados

`src/app/api/demo/route.ts:8-10` · `src/lib/env.ts:54-59`

**Escenario, con valores.** `GET /api/demo` sin cookie devuelve
`{"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}`. `envHealth()`
devuelve booleanos, nunca valores, así que lo que se filtra es reconocimiento:
un atacante sabe si el despliegue tiene WhatsApp y Supabase configurados antes de
gastar un intento contra `/acceso`.

**Consecuencia.** Baja, y la misma de la ronda 5: superficie de reconocimiento
sin autenticar sobre un host público.

**Causa raíz probable:** un health-check de demo que nunca se cerró al salir a
producción.

---

### [BAJO · REINCIDENTE r6, sin tocar] Las cabeceras de seguridad se pierden en la rama de redirección de `/dashboard`

`src/proxy.ts:13-16,32,42`

Las cuatro cabeceras generales y el `Cache-Control: no-store` se escriben sobre
`res`; la línea 42 devuelve un `NextResponse.redirect(url)` **nuevo**, que no las
hereda. Es el camino más frecuente —todo el que no tenga sesión— y en él la 307
sale sin `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` ni el `no-store`.

**Consecuencia.** La misma que midió la ronda 6, y la dejo en BAJO por la misma
razón: la 307 no lleva cuerpo, el único `Location` apunta a `/acceso`, y el HTML
con datos que sí se sirve va protegido por el `private, no-cache, no-store` que
Next pone en toda página dinámica (`dashboard/page.tsx:10`,
`dashboard/[id]/page.tsx:11` declaran `force-dynamic`). Lo que se pierde es
higiene sobre una respuesta vacía.

**Causa raíz probable:** `NextResponse.redirect()` construye la respuesta desde
cero y la rama se añadió sin revisar las dos salidas de la función.

---

## CVEs revisados y descartados

`npm audit` da **11** vulnerabilidades (2 críticas, 5 altas, 4 moderadas). Bajó
de 20 a 11 desde la ronda 6 **sin que nadie tocara una dependencia**:
`git diff abdc98d..HEAD -- package-lock.json` es vacío. El movimiento es de la
base de advisories, no del repo. Insumo, no veredicto — el recuento de abajo es
mío.

- **`vitest` + `@vitest/coverage-v8` (críticas, GHSA-5xrq-8626-4rwp).**
  El camino de explotación es el **servidor de UI de Vitest** sirviendo archivos
  arbitrarios. **No existe aquí:** `package.json:11` corre `vitest run`, nunca
  `--ui`; grep de `--ui` y de `@vitest/ui` en todo el repo no devuelve nada, y
  vitest es `devDependency` — no entra al bundle de ninguna función
  (`next.config.ts:74-101` además excluye `**/*.test.*` del trace).
  **Descartada.**
- **`vite`, `vite-node`, `esbuild`, `@vitest/mocker` (alta/moderadas).** Los tres
  vectores (path traversal en `.map` de deps optimizadas, bypass de
  `server.fs.deny` en rutas alternas de Windows, esbuild respondiendo a cualquier
  origen) exigen un **dev-server escuchando**. **No existe aquí:** el proyecto
  usa Turbopack para `next dev` (`package.json`), `vite` solo vive como
  dependencia de `vitest`, y en Vercel no corre ningún dev-server.
  El de Windows además exige Windows; el runtime es Linux. **Descartadas.**
- **`brace-expansion` < 1.1.17 (alta, GHSA-mh99-v99m-4gvg, DoS por expansión sin
  cota).** Llega por el árbol de ESLint/Vitest (`minimatch`/`glob`). El atacante
  tendría que **controlar un patrón glob**, y los únicos patrones glob del
  proyecto son literales escritos en `eslint.config.mjs`, `vitest.config.ts` y
  `next.config.ts:74-101`. Ninguna entrada de usuario alcanza un glob:
  el webhook no construye rutas, y `cfdi.ts:213` resuelve el `.wasm` con
  `require.resolve`, no con un patrón. **Descartada.**
- **`postcss` ≤ 8.5.17 (alta ×3: XSS por `</style>` sin escapar, lectura
  arbitraria y path traversal vía `sourceMappingURL`).** Instalado 8.5.23, o sea
  ya fuera de rango de las dos primeras; la tercera (`<=8.5.17`) tampoco aplica:
  las tres exigen **procesar CSS que el atacante controle**, y el único CSS que
  PostCSS ve es `src/app/globals.css` y el de Tailwind, ambos del repo, y solo en
  tiempo de build. No hay ninguna ruta que reciba CSS de fuera. **Descartada.**
- **`next` (alta) — no es un CVE de Next.** El JSON del audit lo lista con
  `"via": ["postcss","sharp"]` y `"effects": ["@sentry/nextjs"]`: es propagación
  hacia arriba de las dos de abajo, no una advisory contra `next@16.2.11`. En
  particular **no** es el bypass de middleware `CVE-2025-29927`, que ya se
  descartó por escrito en la ronda 5 y sigue descartado: la versión instalada
  está muy por encima del rango, y aunque no lo estuviera, `guard.ts` es la
  segunda capa dentro de la página (con la salvedad del hallazgo ALTO de arriba).
  **Descartada.**
- **`@sentry/nextjs` (moderada).** Vía `next`, o sea vía `postcss`/`sharp`. La
  misma cadena reetiquetada una vez más. **Descartada.**

**La única que NO descarto del todo, y sigue igual que en la ronda 6: `sharp`
0.34.5 (alta, GHSA-f88m-g3jw-g9cj — CVE-2026-33327/33328/35590/35591).**
`package.json:32` fija `^0.34.0`, arreglada en 0.35.0 (libvips 8.18.3). Es
dependencia de producción y con camino real de datos de tercero:
`cfdi.ts:249` corre `sharp(image).rotate().resize(…)` sobre bytes que bajaron de
WhatsApp. Lo que la contiene, verificado en código y no supuesto:

- El advisory nombra tres cargadores: **GIF (`VipsForeignLoadNsgif`), TIFF
  (`VipsForeignLoadTiff`) y VIPS (`VipsForeignLoadVips`)**.
- `sharp` solo se alcanza por la rama `msg.type === 'image'`
  (`processor.ts:315` → `353 downloadMediaAsDataUrl` → `ocr.ts:237
  decodeCodigosFromImage`). Las dos ramas de `document`
  (`processor.ts:269` y `532`) van a `downloadMediaAsText`, que devuelve texto y
  nunca toca sharp. Un `.tif` o un `.gif` enviado por WhatsApp viaja como
  `document`, y Meta solo acepta `image/jpeg` e `image/png` como `type: 'image'`.
- **Lo que la mantiene abierta y hay que decirlo:**
  `meta/client.ts:177,184` **no valida `mime_type`** —lo copia tal cual al
  data-URL— y sharp decide el cargador por los bytes, no por el mime. Todo el
  peso de la contención está en que Meta clasifique bien; el código no tiene una
  segunda línea. Sigue como observación vigilada, no como hallazgo: no pude
  construir el camino en que un TIFF llega como `image`.

---

## Lo que revisé y está bien

**Las dos páginas públicas nuevas: ataqué la parametrizada por tenant y no
filtra nada de otra flota.**

- `src/app/aviso/[tenant]/page.tsx:62` exige forma de UUID v4 antes de consultar,
  así que el ruido de un rastreador no llega a la base.
- La consulta está acotada a cuatro columnas por lista blanca:
  `repo.ts:435 .select('razon_social, domicilio_fiscal, url_aviso_privacidad, contacto_privacidad')`.
  No hay `select('*')` ni forma de pedir otra columna desde la URL: el RFC, el
  plan y `config` de `tenant` no salen por aquí.
- `notFound()` en los dos casos —`page.tsx:62` (id inválido) y `:69` (tenant
  inexistente **o** incompleto)— así que la ruta no es un detector de qué flotas
  están dadas de alta. Comprobado que `getDatosResponsable` colapsa los dos:
  `repo.ts:439` devuelve `null` si no hay fila y `repo.ts:451` devuelve `null`
  si falta razón social o domicilio.
- Enumeración: el `tenant_id` es un UUID v4 (`0001_init.sql`,
  `gen_random_uuid()`), no un serial. No se puede recorrer.
- Los cuatro campos de base viajan como **texto en JSX** a través de
  `ConNegritas` (`page.tsx:44-55`), que solo produce `<strong>`: React escapa. No
  hay `dangerouslySetInnerHTML` ni ningún `href` construido con dato de tenant en
  toda la página, así que un `razon_social` con `<script>` o un
  `contacto_privacidad` con `javascript:` no ejecutan nada.
- La página pasa por el proxy (el matcher solo excluye `api`, `_next/static`,
  `_next/image`, `favicon.ico`) → sale con las cuatro cabeceras. Y es
  `force-dynamic` (`:34`) con `robots: { index: false }` (`:40`).
- `src/app/privacidad/page.tsx` es estática pura, sin base y sin parámetros: los
  datos que faltan están como `null` literal (`:41-42`) y la página lo dice en
  pantalla (`:154-163`) en vez de inventarlos.

**El HMAC del webhook sigue en el orden correcto y no se tocó.**
`webhook/whatsapp/route.ts:42` (cap por `content-length`) → `:44` `req.text()` →
`:45` recheck con `raw.length` → `:46` `verifySignature` → **recién ahí** `:52`
`JSON.parse`. `meta/client.ts:33-40` compara con `timingSafeEqual` y con
comprobación de longitud previa, y devuelve `false` si falta el secreto o la
firma. El GET de verificación (`:33`, `client.ts:24-30`) también es timing-safe
y exige `mode === 'subscribe'`.

**Ningún secreto tiene fallback silencioso.** Comprobado uno por uno:
`DASHBOARD_SECRET` lanza en producción (`passcode.ts:85-89`) y su único fallback
—`likida:${DASHBOARD_PASSCODE}`— está detrás de ese throw; `DASHBOARD_PASSCODE`
débil lanza en producción (`:151-163`); `WHATSAPP_ACCESS_TOKEN` y
`WHATSAPP_PHONE_NUMBER_ID` lanzan (`meta/client.ts:14,19`); `supabaseAdmin()`
lanza si falta url o service key (`supabase/admin.ts:13`); `WHATSAPP_APP_SECRET`
ausente hace que `verifySignature` devuelva `false`, o sea que el webhook
rechaza todo — fail-closed. El único default es `DEMO_TENANT_ID`, que no es un
secreto y cuya ausencia grita en el arranque (`arranque.ts:28`).

**El token v2 sigue sin poder forjarse, alargarse ni bajar de formato**, y esta
vez lo verifiqué contra el código, no contra el reporte anterior: `tokenMatches`
(`passcode.ts:236-251`) exige `partes.length === 4`, versión `'2'`, nonce
`^[0-9a-f]{32}$`, firma `^[0-9a-f]{64}$`, edad ≤ 8 h con 5 min de tolerancia de
reloj, y recalcula el HMAC con el passcode **del servidor** (`:251`), que la
cookie nunca lleva. `constTimeEq` (`:216-221`) compara longitud y después acumula
XOR sin cortocircuito. No hay ningún endpoint que reemita una sesión sin pasar
por `/acceso`.

**`/acceso` no es un open redirect.** El `next` se valida en las dos puntas:
`acceso/page.tsx:11` al pintar y `:32` antes de redirigir, las dos con
`startsWith('/dashboard')`. `//evil.com` no pasa (no empieza por `/dashboard`) y
`/dashboardcualquiercosa` se queda en nuestro propio origen. La cookie se emite
con `httpOnly`, `sameSite: 'lax'`, `secure` en producción y `maxAge` igual al
`SESION_MAX_MS` del servidor (`:29-31` contra `passcode.ts:64`).

**El aislamiento por tenant en las rutas de datos es explícito, no confiado a
RLS.** `api/export/liquidaciones/route.ts:25` y `api/export/pdf/[id]/route.ts:46`
filtran `.eq('tenant_id', TENANT())`; `analytics.ts:181` lo mismo para el
detalle, así que un `id` de liquidación de otra flota resuelve a `null` → 404.
Las dos rutas están además detrás de `tokenMatches` **y** con rate-limit por IP
(`:17` 10/min y `:31` 30/min).

**`resolveOperador` sigue cerrado en dos capas de verdad.** `conv.ts:59-98` pide
`.limit(2)` y lanza `OperadorAmbiguo` ante dos filas en vez de elegir una
arbitraria, y `ConsultaFallida` distingue «la base no contestó» de «no existe».
La segunda capa no depende de que nadie toque `conv.ts`:
`0024_telefono_normalizado_unico.sql` impone un índice único global sobre
`telefono_normalizado(telefono) where activo` y `0028_fks_con_tenant.sql` ata
`gasto`/`liquidacion`/`codigo_pendiente` al tenant de su viaje. Esta es la única
ruta privilegiada del sistema que **sí** tiene dos capas independientes.

**Ninguna de las seis migraciones nuevas (0031-0036) crea una tabla, y ninguna
toca una policy de RLS.** Verificado con dos búsquedas: `grep 'create table'`
sobre las seis no devuelve nada, y `grep 'policy'` tampoco. Solo añaden columnas
(`0031`, `0033`, `0034`), reemplazan funciones existentes, ponen comentarios
(`0032`) y crean un trigger (`0036`). Todas reducen superficie salvo lo anotado
en el hallazgo de la 0036.

**El orden de las migraciones no borra el `search_path` de la 0035.** Las que
hacen `create or replace` sobre funciones de la lista —`0031:49` (`intake_delta`)
y `0033:64` (`marcar_aviso_privacidad`)— corren **antes** de la 0035, así que el
`alter function … set` queda encima. (Al revés sí lo perdería: un
`create or replace` sin `set` resetea la configuración de la función.)

**El barrido anónimo del 31-jul está bien hecho y bien anotado.**
`verificaciones.sql:22-40` deja la salida real copiada: 14 tablas leídas como
anónimo → 0 filas, y cinco escrituras rechazadas con `42501`. El bloque 18
(`:701-749`) sí recorre el catálogo entero para tablas sin RLS y para policies
cuya expresión sea literalmente `true`, que son las dos formas de perder el
aislamiento sin que nada falle.

**Refuté el «GRANT implícito que el revoke from public no alcanza» para las tres
RPC del mutex y la barrera, y lo dejo por escrito.** La teoría era buena:
`0012:13-15` revoca solo `from public` —no de `anon`/`authenticated`— y su propio
comentario (`0012:11-12`, repetido en `verificaciones.sql:614-615`) razona al
revés de como funciona `ALTER DEFAULT PRIVILEGES`. Pero la salida recordada del
bloque 16 corrida contra producción el 31-jul lo desmiente:
`anon-intake=f anon-lock=f anon-unlock=f` (`verificaciones.sql:22`). O sea: en
este proyecto no hay grant explícito a `anon` sobre funciones del esquema
`public`, y el `revoke from public` bastó. **No es un hallazgo.** Lo que sí queda
es el reverso, y ese sí lo reporto arriba: el default a `service_role`.

**Las dos funciones sin `revoke` que quedan son inofensivas, y las abrí para
comprobarlo.** `telefono_normalizado(text)` (`0024:60-72`) es `immutable`,
`parallel safe`, dos `regexp_replace` sobre su argumento, sin acceso a ninguna
tabla; `config_tenant_valida(jsonb)` (`0026:67-105`) es `immutable` y solo inspecciona
el jsonb que recibe. Un anónimo que las llame por PostgREST obtiene la
normalización de su propio número o la validación de su propio JSON.
`get_user_tenant_ids()` e `is_superadmin()` (`0001:96,102`) son `security
definer` ejecutables por `anon` **a propósito** —las usan las once policies— y
resuelven contra `auth.uid()`, que para un anónimo es NULL.

**El redactor del logger cubre el formato de teléfono de 13 dígitos que entrega
Meta.** `logger.ts:57` `\b\+?521?\d{10}\b|\b\d{10}\b`, aplicado en una sola
pasada con UUID y RFC (`:65`) para que una regla no coma la salida de otra. Los
UUID se huellan en vez de borrarse (`:82-90`) y los RFC/teléfonos se borran
enteros, con el razonamiento de entropía escrito (`:42-46`). `digest` está
exento por nombre (`:122`) porque son diez dígitos y se iba como `[TEL]`.

**`next.config.ts:74-101` saca `.env*`, `docs/`, `supabase/`, `pruebas-manuales/`
y los `*.test.*` del trace de la función**, y la medición está en el archivo: 145
archivos del proyecto / 4.22 MB → 20 / 2.51 MB. Es el arreglo del `.env.local`
con la service-role key colándose al bundle, y sigue en pie.

**Línea base reproducida en esta máquina:** `npm test` 1262 pruebas / 1 saltada /
127 archivos, exit 0. `npx tsc --noEmit` exit 0. `npm run lint` exit 0.

---

## Lo que NO alcancé a revisar

- **Si `DASHBOARD_PASSCODE` y `SENTRY_DSN` están puestas en Vercel hoy.** Es la
  pregunta que decide si el hallazgo ALTO está activo en producción ahora mismo,
  y no hay forma de contestarla desde aquí: no tengo acceso al dashboard de
  Vercel ni al runtime log donde sale `startup.config_silenciosa`. Es el mismo
  pendiente que dejaron las rondas 5 y 6; tres rondas es demasiado para una
  pregunta de un minuto para quien tenga la consola abierta.
- **El catálogo de Postgres en vivo.** No corrí ningún bloque de
  `verificaciones.sql` contra la base real —esta sesión no tiene credenciales—,
  así que las afirmaciones sobre privilegios en producción se apoyan en la salida
  del 31-jul copiada en el propio archivo (`:16-40`), no en una consulta mía. En
  particular no comprobé `has_function_privilege('service_role',
  'public.guardar_liquidacion_tx(…12 args…)', 'execute')`, que es lo que cerraría
  o abriría el hallazgo MEDIO de los grants.
- **Si Meta puede entregar un `type: 'image'` con bytes TIFF o GIF.** Es el único
  eslabón que sostiene el descarte de `sharp`, y probarlo exige mandar media real
  contra el número de producción.
- **Concurrencia real del rate-limit.** `ratelimit.ts:26` es un `Map` por
  instancia y el propio módulo lo admite (`:7-16`); medir cuántas instancias
  concurrentes abre Vercel bajo carga exige tráfico agresivo contra producción,
  prohibido en esta ronda.
- **El `wamid` en base64 con el teléfono codificado dentro**
  (`processor.ts`, `processInbound.fail`). Cuarto pendiente consecutivo: exige un
  `wamid` real de producción para saber si `redactarTexto` lo alcanza.
