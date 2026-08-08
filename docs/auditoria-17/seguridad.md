# Seguridad — auditoría 17

**Nota: 7/10** (antes 8). Razón del movimiento: mirada más profunda · deuda que
cobró factura. Los cierres de RLS de las rondas 11–13 se mantienen y las dos
fronteras nuevas (QStash, migración 0085) no abrieron acceso sin autenticar —
pero el hallazgo abierto de la ronda 13 (`operador_sube_su_pod`) **sigue vivo**
(la 0081 arregló el tenant, no la auto-certificación), el rol de `/admin`
descansa en **una sola capa** para 20 de sus 27 páginas, y hay un CVE con camino
real de explotación (`sharp` 0.34.5 sobre bytes que manda un chofer por
WhatsApp). El ancla de "8+" pide dos capas independientes en toda ruta
privilegiada; hoy en `/admin` y en `/cuenta` la capa de autorización es una.

**El riesgo mayor del rubro, hoy:** el rol de superadmin se comprueba en UN solo
sitio (`src/app/admin/layout.tsx:36`) para 13 páginas que pintan datos de TODOS
los tenants —incluidas las transcripciones de WhatsApp de todos los choferes—
y el proxy, la otra capa, solo pregunta "¿hay sesión?", no "¿qué rol?".

---

## Hallazgos

### [ALTO] `sharp` 0.34.5 decodifica bytes que elige el chofer, dentro del proceso que tiene el service-role
`src/lib/likida/intake/cfdi.ts:249` · `package.json` (`"sharp": "^0.34.0"`, instalado **0.34.5**)
· ruta de llegada: `src/lib/meta/client.ts:413-427` → `src/lib/likida/processor.ts:522,724` → `src/lib/likida/intake/ocr.ts:244`

Escenario: el chofer Juan (fila en `operador` con `telefono = 5219993700779`,
así que `resolveOperador` lo reconoce) manda por WhatsApp un archivo de 900 KB
cuyo `mime_type` que reporta Meta es `image/jpeg` pero cuyos bytes son un TIFF
con un IFD manipulado. `downloadMediaAsDataUrl` lo baja sin ningún tope de
tamaño ni validación de formato (`client.ts:426`: `Buffer.from(await
bin.arrayBuffer())`), y `decodeCodigosFromImage` hace
`sharp(image).rotate().resize({width:1600}).jpeg().toBuffer()`. `sharp` no mira
el mime declarado: enruta por *magic bytes* al cargador de libvips
correspondiente, así que un solo canal de entrada alcanza todos los decodificadores
(TIFF, WebP, HEIF, JPEG2000). `sharp <0.35.0` arrastra las CVE de libvips
CVE-2026-33327 / -33328 / -35590 / -35591 (GHSA-f88m-g3jw-g9cj, HIGH), que son
corrupción de memoria en esos cargadores.

Sale mal: corrupción de heap dentro de la invocación de
`/api/webhook/whatsapp`, que es un proceso Node cuyo `process.env` tiene
`SUPABASE_SERVICE_ROLE_KEY` (salta TODA la RLS de todos los tenants),
`WHATSAPP_ACCESS_TOKEN` y `OPENROUTER_API_KEY`. En el caso benigno, el
`catch {}` de `cfdi.ts:255` se traga el crash y la foto se pierde en silencio.

Consecuencia: el adversario que el producto modela explícitamente —el chofer que
quiere que sus números cuadren— es el que tiene el canal de entrada. Con éxito,
lectura y escritura de la base entera, incluidas liquidaciones y CFDI de otras
flotas. Sin éxito, el intake de esa flota se muere sin una línea de log.

Causa raíz probable: la única dependencia de producción que decodifica bytes de
un tercero está pineada a un rango (`^0.34.0`) que no alcanza la versión con
libvips parcheado, y no hay ningún tope de tamaño ni validación de formato antes
del decodificador.

Refutación intentada: `resolveOperador` (`processor.ts:384`) sí cierra el paso a
un número desconocido —no es un ataque anónimo— y `FACTURACION_MODO` no
interviene aquí. Pero el número de un chofer dado de alta no es una credencial:
es un dato que la flota captura en el panel, y el propio chofer lo controla.
No encontré ningún guardarraíl entre el `arrayBuffer()` y el `sharp()`.

---

### [MEDIO · REINCIDENTE] El chofer sigue certificando su propio POD — la 0081 amarró el tenant, no el `estado`
`supabase/migrations/0081_pod_tenant_amarrado.sql:15-19` · tabla en `supabase/migrations/0047_operacion_encargado.sql:127-146` · escritura del panel en `src/lib/likida/operacion.ts:394-398`

La política vigente es:

```sql
create policy operador_sube_su_pod on public.pod for insert
  with check (
    viaje_id in (select id from public.viaje where operador_id = get_user_operador_id())
    and tenant_id = (select tenant_id from public.viaje where id = viaje_id)
  );
```

Restringe `viaje_id` y `tenant_id`. **No restringe `estado`, ni `storage_path`,
ni `operador_id`, ni `capturado_en`.**

Escenario: Juan es `app_user.rol='operador'` con `operador_id = op-7` y sesión web
en `/chofer`. Toma la anon key del bundle del navegador
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`, pública por diseño) y hace:

```
POST https://<proj>.supabase.co/rest/v1/pod
apikey: <anon>   Authorization: Bearer <su access token>
{"viaje_id":"<V-9, suyo>","tenant_id":"<tenant de V-9>","estado":"subido",
 "storage_path":"pod/V-9.jpg","capturado_en":"2026-08-08T09:00:00Z",
 "operador_id":"<op-3, su compañero>","lat":25.68,"lng":-100.31}
```

Pasa el `with check` (el viaje es suyo, el tenant coincide) y la fila queda
insertada. Sale mal en dos sitios a la vez:

1. `getPods` (`operacion.ts:330`) y `tableroOperacion` (`operacion.ts:450`) leen
   `estado` y muestran el viaje F-1042 como **entrega comprobada**;
   `podPendientes` baja en uno. Ningún camino de la aplicación escribe jamás
   `estado='subido'` —`marcarPodPedido` inserta `'pendiente'`
   (`operacion.ts:398`) y `rechazarPod` actualiza a `'rechazado'`
   (`operacion.ts:411`)—, así que ese valor SOLO puede venir del chofer.
2. `storage_path` apunta a un objeto que no existe: **no hay bucket `pod`** en
   ninguna migración (0008 crea `liquidaciones`, 0039 `comprobantes`, 0046
   `avatares`, y nada más). El constraint `pod_subido_tiene_archivo` solo exige
   que la columna no sea nula, no que el archivo exista.
3. El índice `pod_viaje_unico` (`0047:151`) es único por `viaje_id`: una vez que
   el chofer insertó, el encargado que aprieta "Pedir POD" recibe un error de
   llave duplicada y no puede volver a pedirlo.

Consecuencia: el contralor cierra el viaje con la entrega marcada como probada.
Treinta días después el cliente de la flota disputa la entrega y detrás de
`storage_path` no hay nada — ni foto, ni firma, ni coordenada verificable, y el
`operador_id` de la fila apunta a un compañero que no llevó ese viaje.

Causa raíz probable: la política se corrigió por el eje que la auditoría 13
nombró (el tenant) sin volver a preguntar qué OTRAS columnas escribe ese mismo
`insert` sin control.

---

### [MEDIO] El rol de `/admin` es una sola capa: 13 páginas con datos de todos los tenants y ninguna puerta propia
`src/app/admin/layout.tsx:36` (`await requireSuperadmin()`) · `src/proxy.ts:94,111` · `src/app/admin/conversaciones/page.tsx:16` · `src/app/admin/ejecutivo/page.tsx:18` · `src/app/admin/crecimiento/page.tsx:20`

El propio repo escribe la regla dos veces —`src/proxy.ts:14-16` ("las dos tienen
que fallar a la vez") y `src/lib/auth/guard.ts:2-7`— y `/dashboard` la cumple:
las **31** páginas pasan por `resolverTenantEfectivo`, que vuelve a comprobar el
rol con `puedeVerRuta` (`tenant-efectivo.ts:105`). `/chofer` también: layout **y**
página llaman a `requireOperador`.

`/admin` no. La primera capa (`proxy.ts:111`) solo pregunta si hay sesión —
cualquier rol la pasa. La segunda vive únicamente en el layout, y **20 de las 27
páginas** no tienen comprobación propia:

```
notificaciones · configuracion · salud-sistema · crecimiento · cobranza
conversaciones · conocimiento-rag · agente-whatsapp · capacidad-forecast
chat · equipo · integraciones · agente-ocr · comunicacion · model-ops
ejecutivo · soporte · playground · agente-cuadre · whatsapp-infra
```

De ellas, **13 importan `@/lib/admin/negocio`** — la única función del repo con
permiso de cruzar todos los tenants (CLAUDE.md).

Escenario: Celinda, contadora de Transportes Innovativos
(`app_user.rol='contador'`, sesión válida). Pide `/admin/conversaciones` con
cabeceras `RSC: 1` y un `Next-Router-State-Tree` que declara el segmento
`admin` ya renderizado. Next resuelve el árbol y renderiza solo el segmento que
cambió; el layout —donde vive el único `requireSuperadmin()`— no vuelve a
correr. La respuesta trae el payload de `ConversacionesPage`, o sea
`getConversacionesActivas()`: `telefono`, `tenantNombre` y los `turns` completos
de las conversaciones de WhatsApp de **todas** las flotas de la base. Por
`/admin/ejecutivo` y `/admin/crecimiento`, `getResumenNegocio()`: gasto de IA en
USD por flota y conteo de viajes de cada cliente.

Consecuencia: un contador de una flota lee los teléfonos y las conversaciones de
los choferes de otra flota (dato personal de terceros, LFPDPPP) y las cifras de
negocio internas de Likida. Y si eso se ve en la sala: el contralor de
Innovativos descubre que su panel y la consola interna comparten puerta.

Causa raíz probable: `/admin` se construyó con la puerta en el layout y el
comentario de `layout.tsx:26-27` lo declara como virtud ("ninguna página nueva
puede olvidarlo"), que es exactamente el patrón que la documentación de Next
desaconseja para autorización — un layout no se re-ejecuta cuando el árbol de
router dice que no cambió.

*Lo que verifiqué y lo que no:* verificado que 20 páginas no tienen puerta
propia, que 13 leen `lib/admin/negocio`, y que el proxy no mira el rol. NO pude
ejecutar la app (`npm run build` está prohibido y no hay entorno) para confirmar
que Next 16 omita el layout ante un árbol forjado. Aun si no lo omitiera hoy, el
hallazgo se sostiene por el ancla del rubro: es una sola capa sobre datos
cruzados de tenants, y cualquier cambio de versión de Next la vuelve cero.

---

### [MEDIO] QStash: el productor arranca con menos configuración que el consumidor, y el cron se queda verde mientras nadie factura
`src/app/api/cron/facturar/route.ts:308` · `src/app/api/cron/facturar/cola/route.ts:22-28` · `src/lib/env.ts:29-38` · `src/lib/observability/arranque.ts:33-41`

El enqueue se dispara con **una** variable:

```js
if (process.env.UPSTASH_QSTASH_TOKEN && lote.length > 0) {   // route.ts:308
```

El callback exige **tres**:

```js
if (!token || !currentKey || !nextKey) return ... { status: 503 }   // cola/route.ts:25-28
```

Y son valores distintos que se copian de pantallas distintas de Upstash (el
token, de la cola; las signing keys, de Settings → Signing Keys — lo dice el
propio commit `4cd1eb4`).

Escenario, con valores: en Vercel queda puesto
`UPSTASH_QSTASH_TOKEN=eyJVc2VySUQiOi…` y **no** `QSTASH_CURRENT_SIGNING_KEY` /
`QSTASH_NEXT_SIGNING_KEY`. A las 12:30 el cron (`vercel.json`, `30 * * * *`)
llama `GET /api/cron/facturar` con su Bearer, lee 8 gastos sin `cfdi_uuid`, los
publica y contesta **HTTP 200** con
`{"corrio":true,"encolado":true,"messageId":"msg_2x…","tickets":8,"quedaron":3}`.
QStash entrega el callback; `cola/route.ts:27` devuelve 503 "QStash no
configurado"; QStash reintenta dos veces (`retries: 2`) y manda el mensaje al
DLQ. Ningún ticket se intenta, ni ese día ni ninguno: cada corrida vuelve a
encolar y a morir igual.

Sale mal: el panel de crons de Vercel queda **verde** para siempre, que es
literalmente el modo de falla que `facturar/route.ts:86-96`, `escalar/route.ts:20-26`
y `purgar/route.ts:40-47` están escritos para no tener. Y no hay aviso por otro
lado: `env.ts:29-38` (`GROUPS`) y `arranque.ts:33-41` (`SILENCIOSAS`) no
mencionan ninguna `QSTASH_*`, así que `avisarConfiguracionSilenciosa()` reporta
`ok:true` con la configuración rota.

Consecuencia: la autofacturación deja de correr sin que nadie se entere. El
plazo real para pedir el CFDI son 7–15 días en gasolineras y el mes fiscal en
casetas (`facturar/route.ts:54-55`): lo que caduca en ese silencio es la
deducción y el IVA acreditable de la flota. Hoy el daño monetario está topado
porque `FACTURACION_MODO` viene en `ensayo` y no se emite nada de todos modos;
el día que se ponga en `emitir`, este mismo camino lo apaga sin decirlo.

Causa raíz probable: la condición del productor es un subconjunto estricto de la
del consumidor, y ninguna de las dos entró al inventario de entorno que el
arranque vigila.

---

### [BAJO] La 0082/0083/0085 borraron el `search_path` que la 0035 le había fijado a `config_tenant_valida`
`supabase/migrations/0085_fix_config_tenant_valida_tipo.sql:17-21` · `supabase/migrations/0082_config_facilidad15.sql:11` · `supabase/migrations/0083_config_facilidad15_forma.sql:8` · contra `supabase/migrations/0035_search_path_fijo.sql:27`

La 0035 hizo `alter function public.config_tenant_valida(p_config jsonb) set
search_path = public, pg_catalog;`. Las tres migraciones siguientes que tocan
esa función usan `CREATE OR REPLACE FUNCTION` **sin** la cláusula `SET`:

```sql
CREATE OR REPLACE FUNCTION public.config_tenant_valida(p_config jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
```

En PostgreSQL, `CREATE OR REPLACE FUNCTION` conserva dueño y permisos pero
reasigna **todas** las demás propiedades a lo que diga el comando — `proconfig`
incluido. Entra: aplicar la 0085. Sale: `pg_proc.proconfig` de
`config_tenant_valida` queda en `NULL`, o sea la función que valida la
configuración de dinero de cada flota vuelve a resolver nombres con el
`search_path` de quien la invoca. Es la misma regresión que la 0035 cerró y
exactamente contra la lección que la 0074 dejó escrita en sus líneas 26-28
("se usa `alter function … set search_path` a propósito, y NO un `create or
replace`").

Consecuencia: la función vuelve a encender el linter
`function_search_path_mutable` de Supabase, y la próxima persona que lea la
0035 creerá que el endurecimiento sigue puesto.

Causa raíz probable: tres migraciones seguidas copiaron el cuerpo de la función
sin copiar su cláusula `SET`; ninguna verificación del repo compara `proconfig`
contra lo que la 0035/0074 declaran.

**Refutación (por qué es BAJO y no más):** la función NO es `SECURITY DEFINER`
(ni la 0026 ni la 0085 lo declaran), así que corre con los permisos del
invocante; no referencia ninguna tabla, solo funciones de `pg_catalog`; y
Postgres nunca busca funciones en `pg_temp` a menos que se nombre explícitamente
en el `search_path`. Para explotarla haría falta un rol que pueda CREAR objetos
en un esquema y anteponerlo a `pg_catalog` en su propio `search_path` — que
`anon`/`authenticated` de Supabase no pueden. Es deuda de endurecimiento
revertida, no un camino de acceso.

---

### [BAJO] `/cuenta` tiene una sola capa: llama a `requireSessionTenant` y no está en el matcher del proxy
`src/proxy.ts:94` (`RUTAS_CON_SESION = ['/dashboard','/mis-viajes','/chofer','/admin']`) · `src/app/cuenta/page.tsx:9` · `src/proxy.test.ts:136-145`

Escenario: `GET /cuenta` sin cookie de sesión. El proxy no reconoce el prefijo,
así que no evalúa sesión y solo aplica cabeceras; el `Cache-Control: no-store`
de `proxy.ts:141` tampoco se pone, porque vive dentro de la rama de
`RUTAS_CON_SESION`. La única puerta es `requireSessionTenant('/cuenta')` dentro
de la página. Hoy esa puerta funciona y redirige a `/login`, así que no hay fuga
— pero la promesa del archivo ("las dos tienen que fallar a la vez") no se
cumple para esta ruta, que enseña el nombre de la flota y el nombre del usuario.

La prueba que debía atraparlo es una igualdad literal contra cuatro strings
(`proxy.test.ts:142-144`) y su propio comentario lo admite: "si mañana nace
/taller o /cliente con su `requireX` en el layout, esta prueba no lo va a
atrapar sola". `/cuenta` ya nació así y la prueba pasa en verde.

Consecuencia: mínima hoy (nombre de flota y de usuario). Importa como señal: la
lista de secciones gateadas y la lista de páginas con `requireX` divergieron sin
que nada lo dijera, que es cómo `/chofer` se quedó fuera en su momento.

Causa raíz probable: la lista del proxy se mantiene a mano y la prueba que la
vigila compara contra una constante escrita a mano, no contra lo que el árbol de
rutas realmente exige.

---

### [BAJO] El callback de QStash no comprueba el destino de la firma ni tiene defensa de repetición
`src/app/api/cron/facturar/cola/route.ts:36-39`

```js
const valido = await receiver.verify({
  signature: req.headers.get('upstash-signature') ?? '',
  body: raw,
});
```

Falta el campo `url`. En `@upstash/qstash` (`chunk-JYPXGFWX.mjs:1148-1152`) la
comprobación del `sub` del JWT —que es la URL de destino— es condicional:
`if (request.url !== void 0 && p.sub !== request.url) throw`. Sin `url`, ese
`if` no entra y el `sub` no se mira.

Escenario: las signing keys de QStash son de **cuenta**, no de endpoint. Un
mensaje firmado por esta cuenta para cualquier otro destino
(`sub: "https://otra-cosa/webhook"`) —por ejemplo uno reenviado desde el DLQ de
la consola de Upstash, o el de un segundo endpoint que se agregue mañana— se
acepta aquí como legítimo mientras su `exp` no haya vencido. Lo mismo vale para
un reenvío del mismo mensaje dentro de su ventana de expiración: `jose` valida
`exp` y `iss`, pero no hay caché de `jti`/nonce, así que un cuerpo repetido se
vuelve a procesar.

Consecuencia hoy: acotada. Solo existe un endpoint de QStash, y el daño de un
reproceso está cerrado aguas abajo — `cola/route.ts:62-69` re-lee los gastos con
`cfdi_uuid is null`, `facturarAlVuelo` re-lee con `.eq('tenant_id', …)`
(`al_vuelo.ts:186`) y `facturarLoteAlVuelo` también (`al_vuelo.ts:346`), y
`reclamarIntento` es la carrera real. Cuenta porque es la frontera de confianza
nueva de esta ronda y la comprobación de destino está a un campo de distancia.

Causa raíz probable: se pasó al `verify()` lo mínimo que hace pasar la prueba
(firma + cuerpo) sin el tercer campo que ata la firma a ESTE endpoint.

---

## CVEs: cuáles descarté y por qué

`npm audit` reporta 13 (2 críticas, 8 altas, 3 moderadas). Una a una:

| Paquete | Sev. | Camino en ESTA app | Veredicto |
|---|---|---|---|
| **`sharp` <0.35.0** (GHSA-f88m-g3jw-g9cj: CVE-2026-33327/-33328/-35590/-35591 en libvips) | HIGH | **Sí.** Dependencia de producción, instalada 0.34.5. `cfdi.ts:249` decodifica bytes que un chofer manda por WhatsApp, sin tope de tamaño ni validación de formato, dentro del proceso que tiene `SUPABASE_SERVICE_ROLE_KEY`. | **HALLAZGO ALTO arriba** |
| **`vitest` <3.2.6** (GHSA-5xrq-8626-4rwp, CVSS 9.8) | CRITICAL | No. Requiere que el **servidor de Vitest UI** esté escuchando. La suite corre con `npx vitest run` (MAPA, compuerta) y no hay `--ui` ni `@vitest/ui` en `package.json`. `vitest` es `devDependency`: no viaja al bundle de Vercel. | **DESCARTADO** |
| **`@vitest/coverage-v8` ≤3.2.5** | CRITICAL | No. Es solo el arrastre de `vitest` (su `via` es literalmente `["vitest"]`, sin advisory propio). Mismo alcance dev-only. | **DESCARTADO** |
| **`vite` ≤6.4.2** (GHSA-fx2h-pf6j-xcff, `server.fs.deny` bypass en Windows) | HIGH | No. El bypass es del **dev server** de Vite, que este repo no levanta nunca —Next usa su propio servidor— y además la variante alta es específica de rutas alternas de Windows; el entorno es Linux. `vite` entra solo como dependencia de `vitest`. | **DESCARTADO** |
| **`vite-node`, `@vitest/mocker`, `esbuild` ≤0.24.2** | MOD | No. Los tres cuelgan de `vite`/`vitest`. El de `esbuild` (GHSA-67mh-4wv8-2f99) exige que el dev server de esbuild esté escuchando y que la víctima visite una web hostil con él encendido. Dev-only. | **DESCARTADO** |
| **`brace-expansion`** (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 — DoS por expansión sin cota) | HIGH | No. `npm ls` lo pone bajo `eslint`, `@eslint/config-array`, `@eslint/eslintrc`, `eslint-plugin-import/jsx-a11y/react` y `test-exclude`. Todas dev. Los patrones que expande son los globs de configuración que escribimos nosotros, no entrada de usuario. Un DoS en el linter no es un DoS del producto. | **DESCARTADO** |
| **`js-yaml` 4.0.0–4.3.0** (GHSA-5p4m-2wfm-xmqj — CPU cuadrática en `!!omap`) | HIGH | No. `npm ls js-yaml` da **un solo** camino: `@eslint/eslintrc` → `js-yaml`. Dev. Ojo con la trampa: las 24 fichas de `normas/` son YAML, pero `src/lib/likida/normas/indice.ts` no pasa por `js-yaml` (no aparece en el árbol de producción) y esas fichas son del repo, no entrada de un tercero. | **DESCARTADO** |
| **`fast-uri` 3.0.0–3.1.4** (GHSA-7p8r-x3mc-p8w7 — confusión de host por `\`) | HIGH | No. Camino único: `@sentry/nextjs` → `@sentry/webpack-plugin` → `webpack` → `schema-utils` → `ajv` → `fast-uri`. Ese `ajv` valida **esquemas de configuración de webpack** en tiempo de build. Ninguna URL de una petición pasa por ahí; la app no usa `ajv` en runtime (valida con `zod`). | **DESCARTADO** |
| **`nanoid` <3.3.17** (GHSA-2v37-7h3g-55p8 — bucle infinito con `size = 0` y generador propio) | HIGH | No. Camino único: `postcss` → `nanoid`, y `postcss` lo usa con tamaño fijo para ids de source-map. Nada en este repo llama a `nanoid` con generador propio ni con `size` controlado por un tercero. Build-time. | **DESCARTADO** |
| **`postcss` ≤8.5.22** (GHSA-6g55-p6wh-862q / -r28c-9q8g-f849 / -fxqj-rqcc-2cmp — lectura de `.map` arbitrarios por `sourceMappingURL`; GHSA-qx2v-qp2m-jg93 XSS por `</style>`) | HIGH | No. El CSS que `postcss` procesa es el nuestro (`@tailwindcss/postcss` sobre `src/**/*.css`), en el build. No hay ninguna ruta que meta CSS de un usuario en postcss en runtime. El XSS por `</style>` requiere CSS de tercero en el stringify: el repo pinta estilos con `style={{}}` (1,178 sitios, `proxy.ts:36-41`), no genera CSS a partir de datos. | **DESCARTADO** |
| **`next`** (HIGH, agregado) | HIGH | Su `via` son exactamente `postcss` y `sharp`, sin advisory propio de Next. `postcss` queda descartado arriba; `sharp` es el hallazgo ALTO. | **Cubierto por `sharp`** |

**Resumen honesto:** de las 10 críticas/altas, **una sola** tiene camino real de
explotación en esta app (`sharp`). Las otras nueve son dev-only o build-time y
las descarto por escrito arriba. Subir `vitest` a 4.x es semver-major y no
compra seguridad de producción; subir `sharp` a ≥0.35.0 sí.

---

## Lo que revisé y está bien

- **Firma del webhook de WhatsApp.** HMAC-SHA256 comparado con
  `crypto.timingSafeEqual` y guardia de longitud previa
  (`src/lib/meta/client.ts:40-46`); tope de cuerpo ANTES de leer y otra vez
  después con `raw.length` (`src/app/api/webhook/whatsapp/route.ts:91-94`) —
  cierra el hueco de `Transfer-Encoding: chunked` que `ratelimit.ts:99-108`
  documenta. El challenge del GET también es timing-safe (`client.ts:31-37`).
- **Firma de Stripe.** Tolerancia de tiempo verificada antes del HMAC, firma
  sobre el cuerpo crudo, `timingSafeEqual`, y 503 —no 200— si falta
  `STRIPE_WEBHOOK_SECRET` (`src/lib/saas/stripe.ts:326-354`,
  `src/app/api/stripe/webhook/route.ts:37-51`). Idempotencia por `evento_stripe`
  antes de aplicar (`route.ts:64`).
- **Ningún secreto con fallback derivado de otro secreto.** Barrí todos los
  `process.env.X ?? …` y `|| …` del árbol: los únicos fallbacks son de URL
  pública (`NEXT_PUBLIC_APP_URL`), de tenant de demo
  (`src/lib/auth/tenant-demo.ts:37`) y de entorno de observabilidad. `supabaseAdmin()`
  **lanza** si falta la service-role key (`src/lib/supabase/admin.ts:12`).
- **Nada de secretos en el repo.** `88a0ee6` ("CRON_SECRET renovado") es un
  commit VACÍO: `git show --stat` no lista un solo archivo — el secreto se movió
  en Vercel, no en git. `.gitignore` cubre `.env*`; el único archivo rastreado es
  `.env.example`, con todos los valores en blanco. Barrido de
  `eyJ…`/`sk-…`/`sk_live`/`whsec_…`/`EAA…`/`qstash_…` sobre `*.ts,*.tsx,*.md,*.json,*.sql`:
  cero aciertos reales (solo cadenas de documentación y un PNG de 1×1 en tests).
- **URLs firmadas: los cuatro TTL son cortos y proporcionales.** PDF del
  contralor **60 s** (`api/export/pdf/[id]/route.ts:95`), PDF que se manda por
  WhatsApp **60 s** (`processor.ts:2123`), PDF en el panel del chofer **600 s**
  con su razón escrita (`chofer.ts:424`), foto de comprobante **600 s** en el
  panel del chofer y 3600 s por default en `almacen.ts:93`. Ninguna es una URL
  pública; los buckets `liquidaciones` y `comprobantes` son privados y sin
  políticas de storage (0008, 0039), así que solo el service-role firma.
- **La ruta del PDF tiene las tres puertas.** Rate limit por IP, tenant resuelto
  desde la sesión (no de la URL), área `dinero` **y** `puedeExportar`, y filtro
  `.eq('tenant_id')` explícito porque el service-role salta RLS; 404 indistinguible
  entre "no existe" y "existe sin PDF" (`api/export/pdf/[id]/route.ts:30-91`).
- **`?tenant=` no se cree nunca.** Solo un superadmin lo honra y el uuid se
  comprueba contra la tabla, distinguiendo "no existe" de "no pude preguntar"
  (503) para no escribir en la flota equivocada (`lib/auth/tenant-api.ts:56-73`,
  `86-100`).
- **`/dashboard` sí tiene dos capas de rol.** Las 31 `page.tsx` pasan por
  `resolverTenantEfectivo`, que llama a `puedeVerRuta` antes de resolver nada
  (`tenant-efectivo.ts:105`). Comprobado con `grep -L`: cero excepciones.
- **Los server actions no confían en el layout.** Los 24 archivos con
  `'use server'` re-comprueban rol dentro de la acción: `puedeAdministrar` en
  políticas (`dashboard/politicas/page.tsx:79`) y en reabrir
  (`dashboard/[id]/page.tsx:105`), `puedeAsignar` en despacho/unidades/incidencias/pod
  (`tenantDelAction`), `requireSuperadmin` en flotas/usuarios/mi-perfil/compliance.
- **Sin rol legible no hay rol.** `SIN_ROL` en vez del viejo `?? 'flota_admin'`
  (`lib/auth/session.ts:34,96`); toda matriz lo niega por default
  (`visibilidad.ts:48`, `permisos.ts:17-19`). `rolEfectivo` solo QUITA
  visibilidad y solo para una sesión real de superadmin (`visibilidad.ts:167-171`).
- **Sin redirección abierta.** `next` se acota con `startsWith('/dashboard')` en
  los tres puntos donde se acepta (`login/page.tsx:53,58,74`,
  `auth/callback/route.ts:13`) — `//evil.com` no pasa.
- **Enumeración de correos cerrada.** `shouldCreateUser:false` y respuesta
  idéntica para correo con y sin cuenta, con el motivo solo en el log
  (`login/page.tsx:90-103`); el exceso de rate limit devuelve el error genérico,
  no "vas muy rápido".
- **RLS: ninguna tabla quedó sin activar.** Crucé las 43 `create table` de
  `supabase/migrations/` contra los `enable row level security` (incluidos los
  dos bucles `execute format` de 0001:112 y 0047:162): cobertura completa. Las
  tablas con RLS y sin política (`viaje_lock`, `wa_mensaje_procesado`,
  `codigo_pendiente`, `foto_pendiente`, `comprobante_huerfano`, `evento_stripe`,
  `portal_credencial`, `llm_costo_mensual`) niegan todo a `anon`/`authenticated`
  por default — fallar cerrado, y está dicho en el comentario de la 0063.
- **Los cierres de las rondas 11–13 siguen puestos.** `not is_operador()` en las
  7 tablas de la 0078, `tenant` de solo lectura por RLS, `app_user_self` y
  `bitacora_insercion` de la 0079. Ninguna migración posterior (0080–0085) las
  vuelve a abrir.
- **Grants explícitos donde el `revoke from public` no basta.** Cada función
  `SECURITY DEFINER` nueva lleva `revoke all … from public, anon, authenticated`
  + `grant … to service_role`; verificado hasta la última (0084:27-28). Las dos
  de la 0048/0050 recibieron su `revoke from public` en la 0054 cuando se
  descubrió que `from anon` no revocaba nada.
- **`search_path` de las cuatro funciones de las que cuelga toda la RLS**
  (`is_superadmin`, `get_user_tenant_ids`, `is_operador`,
  `get_user_operador_id`) sigue con `public, pg_temp` de la 0074: ninguna
  migración posterior las recrea.
- **Secretos en la base: no hay ninguno.** `portal_credencial` guarda el NOMBRE
  de la variable, con un CHECK que rechaza cualquier cosa que parezca un secreto
  (`0063:98-104`), y no tiene políticas RLS. `rastreo_credencial` es de solo
  lectura para `administra_flota()` y hoy no la escribe nadie
  (`grep`: un solo lector en `comercial.ts:330`).
- **Los tres crons fallan cerrado sin `CRON_SECRET`** (500, no 200) y devuelven
  401 sin cuerpo (`escalar:34-46`, `purgar:53-60`, `facturar:249-256`).
- **Cabeceras de seguridad y CSP** se aplican en un solo punto y también al
  redirect a `/login` (`proxy.ts:73-83,139`), con las cookies de refresco
  arrastradas para no dejar una cookie muerta en bucle.
- **Compuerta verde a mi paso:** `npx vitest run` → 249 archivos, **3148 pruebas
  verdes, 1 saltada** — la línea base del MAPA, sin regresiones.

---

## Lo que NO alcancé a revisar

- **Confirmar en ejecución el hallazgo del layout de `/admin`.** Haría falta
  levantar la app (prohibido `npm run build`, sin entorno) y mandar la petición
  RSC con `Next-Router-State-Tree` forjado. Lo verificado es estático.
- **El estado REAL del catálogo de Postgres.** Todo lo de RLS, grants y
  `search_path` sale de leer las 82 migraciones y componerlas mentalmente. No
  hay conexión a Supabase desde aquí, así que no pude correr
  `supabase/verificaciones.sql` ni consultar `pg_policies`/`pg_proc.proconfig`
  para ver si alguien aplicó algo a mano fuera de las migraciones.
- **Políticas de `storage.objects` vigentes en el proyecto.** Solo la 0046 crea
  políticas de storage; si en la consola de Supabase se agregaron otras a mano,
  no se ven desde el repo. En particular no pude comprobar si existe un bucket
  `pod` creado fuera de migraciones.
- **Las claves de firma reales de QStash y la ventana de `exp` de sus JWT.** El
  análisis de repetición asume el comportamiento por defecto de `jose`
  (`exp`/`iss` sí, `jti` no); no pude observar un token real.
- **`src/lib/agents/` y `src/lib/llm/`** desde el ángulo de inyección de prompt
  con efectos: el MAPA declara cerrada la superficie por diseño
  (`properties: {}`) y confirmé que ninguna tool nueva la rompe, pero no audité
  el contenido de los prompts ni el `registry`.
- **Superficie de `pruebas-manuales/*.prueba.ts`** (prohibido correrlas) y del
  adaptador de Playwright contra portales reales: solo lectura de código.
