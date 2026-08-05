# Operabilidad y DX — auditoría 12

Ancla: deployment de producción `likida-1wg3j8cg7-likida.vercel.app` (commit
`56c267a`, 2026-08-05 11:33:41 -0600) — el último que existe; el árbol siguió
subiendo mientras escribía esto (4 commits más de otros rubros entre 11:53 y
13:00, ninguno con `[deploy]`, ninguno desplegado). Todo lo verificado con
`vercel ls/inspect/env ls`, `git`, `ls` y lecturas directas del código en el
momento en que se corrió, no de memoria. La base de datos real no se tocó y no
se consultó: está prohibido por el encargo, así que lo que digo de ella es lo
que el orquestador reporta más lo que el código demuestra sobre los caminos
para tocarla.

**Nota: 6/10** (antes 7). El mecanismo central de la ronda 10 —el deploy
opt-in con `[deploy]`— se verificó funcionando EN VIVO, no citando el commit
que lo dice: el push de `56c267a` (11:33:37, con bandera) produjo un deployment
de producción 4 segundos después (11:33:41), y el push de `ce9abab` (11:53:59,
sin bandera) no produjo ninguno. Los tres crons, los probes de arranque, el CI
en cada push y la suite de observabilidad siguen verdes y verificados. Pero
esta misma ronda encontró el hallazgo que importa mañana: **el único camino
documentado para cargar los datos del demo (`npm run seed`) no puede funcionar
contra la base real ya migrada**, y el orquestador reporta que esa base está
vacía de datos del demo. Además, el "borrado" del passcode compartido quedó a
medias —el código se fue, las variables siguen en Vercel y `.env.local`— y
`DEPLOY.md` afirma un estado que las envs reales contradicen. Los dos son
exactamente el tipo de trampa a las 3 a.m. que este rubro existe para cazar.

## Hallazgos

### [CRÍTICO, abierto] La base real está vacía de datos del demo, y el único camino documentado para cargarlos (`npm run seed`) no puede funcionar contra una base ya migrada

Dos hechos independientes, los dos verificados por vías distintas:

1. **La base está vacía del seed.** El orquestador lo reporta en el encargo
   ("la base de datos real está VACÍA de datos del demo — el seed no está
   aplicado"). No lo verifiqué yo: no tengo acceso a la base y está prohibido
   tocarla. El guion del demo da por hecho lo contrario — `GUION_DEMO.md`: *"Tu
   viaje abierto existe. El 1-ago se corrigió: el viaje `VJ-2026-0847`
   (Silao→Nuevo Laredo, anticipo **$10,600**)… Ahora es del operador con
   `529993700779`. Compruébalo mandando un 'hola'"* —. Con la base vacía, ese
   "hola" contesta *"No tienes un viaje abierto"* y el dashboard pinta cero
   liquidaciones: el demo muere en el minuto uno.

2. **El camino documentado para arreglarlo no puede correr.** `SEED.md:8`
   documenta UN comando: `DATABASE_URL="postgres://…" npm run seed`. Ese
   comando ejecuta `scripts/seed.sh`, que primero re-aplica TODAS las
   migraciones con psql crudo y `ON_ERROR_STOP=1`:

   ```bash
   # scripts/seed.sh:17-21
   echo "▸ Aplicando migraciones…"
   for f in supabase/migrations/*.sql; do
     echo "  → $(basename "$f")"
     psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
   done
   ```

   Y la migración 0001 no es re-ejecutable: crea sus policies RLS sin
   `drop policy if exists` previo —

   ```sql
   -- supabase/migrations/0001_init.sql:114 y :122
   create policy tenant_data on %I for all
   ...
   create policy tenant_self on tenant for all
   ```

   — así que en una base donde la 0001 ya se aplicó (la real: la app funciona
   sobre ella desde hace días), Postgres responde `SQLSTATE 42P07: policy
   "tenant_data" for table "terminal" already exists`, `ON_ERROR_STOP=1`
   aborta el script en el PRIMER archivo y `seed.sql` (línea 28) jamás se
   ejecuta. Con `set -euo pipefail` encima, el script entero muere ahí.

   El camino que SÍ funciona — `psql "$DATABASE_URL" -f supabase/seed.sql` a
   secas: el seed es idempotente (`on conflict do nothing`/`do update`, 9
   inserts, y los gastos entran ANTES que las liquidaciones para no chocar con
   el trigger de la 0036) — no está documentado en ningún lado del repo.
   `SEED.md`, `scripts/seed.sh` y el propio `GUION_DEMO.md` asumen que el
   comando mágico existe; no existe.

**Escenario con valores:** 5-ago 23:59, ensayo del demo. Se corre
`DATABASE_URL="postgres://postgres.gngoqsvrxdguxvsizpbw:…" npm run seed` como
dice SEED.md. A los 3 segundos falla en `0001_init.sql` con "policy
tenant_data for table terminal already exists". La persona (a) concluye que el
seed "no se puede aplicar" y se va a dormir, o (b) prueba `supabase db push`
que sí respeta las aplicadas pero no carga el seed, o (c) descubre a las 2 a.m.
que hay que correr `psql -f supabase/seed.sql` a secas — un camino que no está
escrito en ninguna parte. Mañana en la sala: "hola" → "No tienes un viaje
abierto".

**Estado: abierto.** Es además un hallazgo doble de operabilidad: el estado
vacío (hecho del orquestador) y el camino roto para salir de él (verificado en
código, `scripts/seed.sh:18-21` contra `0001_init.sql:114`). El seed en sí se
arregló y alineó con el guion esta misma ronda (`c78e080`: OP-101 =
`529993700779`, política viva en `tenant.config.politica`, gastos que cuadran
comprobado = anticipo = $10,600 con única diferencia diésel $200 sobre tope) —
falta el vehículo para aplicarlo.

### [ALTO, abierto] Las migraciones RLS 0078/0079 están commiteadas "pendientes de correr contra la base real", y ningún probe de arranque detecta su ausencia

El commit `ce9abab` (11:53:59, auditoría 11) dice textualmente en su cuerpo:
*"Bloque 54 en verificaciones.sql… Pendiente de correr contra la base real."*
`0078_rls_chofer_sin_escritura.sql` cierra el CRÍTICO SEC-C2/DATOS-C2 (chofer
leyendo/escribiendo teléfonos de toda la flota, chats, XML de CFDI, RFC del
tenant) y `0079_rls_chofer_sin_lectura_personal.sql` (12:54, auditoría 12) los
dos MEDIO de la misma familia (`app_user`, `bitacora`). Las dos tienen su
bloque en `supabase/verificaciones.sql` (54 y 55) y la prueba
`migraciones_verificadas.test.ts` las cubre (4/4 verde, verificado). Pero la
aplicación a la base real es la parte que nadie verificó, y el arranque no la
verifica:

`src/lib/cuadra/startup.ts` sondea las migraciones 0005, 0011, 0031, 0016,
0017, 0019 (índices vía 0030), 0022, 0033, 0036/0037 (triggers vía 0043) —
**ninguna línea sondea 0078 ni 0079**. Si las dos migraciones no se aplicaron,
`startup.migraciones` sale `ok:true` igual, y el agujero de RLS que la
auditoría 11 declaró CRÍTICO sigue abierto en producción durante el demo.

**Escenario con valores:** la base real tiene aplicadas hasta la 0077 (así lo
reportaba la ronda 10 para la 0076; la 0077 y la 0078/0079 son posteriores).
Nadie corre `0078`/`0079`. El 6-ago, un chofer con sesión web + la anon key
pública (que es pública por diseño) hace `select * from operador` por
PostgREST y ve los teléfonos de los 5 operadores del seed, o `update tenant
set rfc='X'` y reescribe la flota que lo juzga. El arranque dice que todo
está bien. Es exactamente el modo de falla que los probes existen para evitar,
y la lista de probes no los cubre.

**Estado: abierto.** No es el rubro de seguridad quien tiene que aplicarlas
—es una ejecución de migración, de datos/operación— pero el ángulo de
operabilidad es este: **no hay ni probe ni checklist de pre-demo que haga
visible la falta**. El commit mismo la declara pendiente y nada desde entonces
la confirmó.

### [MEDIO, abierto] `scripts/deploy-vercel.sh` pisa `NEXT_PUBLIC_APP_URL` en producción con la URL EFÍMERA del deployment, no con `https://app.likida.ai`

```bash
# scripts/deploy-vercel.sh:44-49
url="$(vercel --prod --yes)"
echo "✅ Desplegado: $url"
echo "▸ Fijando NEXT_PUBLIC_APP_URL=$url …"
vercel env rm NEXT_PUBLIC_APP_URL production -y >/dev/null 2>&1 || true
printf '%s' "$url" | vercel env add NEXT_PUBLIC_APP_URL production >/dev/null
```

`vercel --prod` imprime la URL generada del deployment (`likida-xxx-likida.vercel.app`), **no** el alias canónico. El comentario de la línea 38 dice "se fija al dominio real abajo" — y abajo se fija a un subdominio aleatorio. `CLAUDE.md` es explícito: *"`NEXT_PUBLIC_APP_URL` debe ser `https://app.likida.ai`; si no coincide con el Site URL de Supabase (Auth → URL Configuration), el login deja la cookie en otro dominio y el usuario queda fuera de su propia cuenta."* Y `DEPLOY.md` documenta este script como el camino para entornos: *"Para un entorno nuevo desde cero, `bash scripts/deploy-vercel.sh`… fija `NEXT_PUBLIC_APP_URL` al dominio real."* — la afirmación del runbook es falsa sobre lo que el script hace.

**Escenario con valores:** alguien corre el script (hoy el valor de Vercel tiene 8 días y presumiblemente es el correcto; el script no se ha corrido desde entonces, pero es el camino documentado). `NEXT_PUBLIC_APP_URL` production pasa a `https://likida-1wg3j8cg7-likida.vercel.app`. El siguiente build hornea esa URL en el bundle del cliente: los magic links de login y el retorno de Google apuntan al subdominio efímero, la cookie de Supabase Auth se escribe en el dominio equivocado, y nadie entra al panel — sin un solo error, exactamente la clase de fallo que la variable existe para prevenir.

**Estado: abierto.** El arreglo es trivial (constante `https://app.likida.ai` en vez de `$url`), y `runbook.test.ts` no lo caza porque solo cruza código↔`.env.example`↔`DEPLOY.md`, no los scripts de deploy.

### [MEDIO, abierto] El "borrado" del passcode compartido fue a medias: el código se fue el 5-ago, pero `DASHBOARD_PASSCODE`/`DASHBOARD_SECRET` siguen en Vercel (production Y preview) y en `.env.local`, y `deploy-vercel.sh` las vuelve a empujar en cada corrida

`DEPLOY.md:110-111` afirma: *"El passcode compartido (`DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`, la ruta `/acceso`) se borró el 5-ago-2026."* El código sí se borró (verificado: cero lecturas en `src/`, solo comentarios históricos en `arranque.ts:20-21` y `.env.example:44`). Pero:

- `vercel env ls production` (5-ago, 12:40): `DASHBOARD_PASSCODE` (created 3d ago) y `DASHBOARD_SECRET` (created 8d ago) **siguen ahí, cifradas, en producción**.
- `vercel env ls preview`: `DASHBOARD_PASSCODE` (3d) y `DASHBOARD_SECRET` (8d) también.
- `.env.local` (gitignored, pero es la fuente que empuja el script) contiene ambas con valor.
- `scripts/deploy-vercel.sh:38-40` empuja TODAS las variables no vacías de `.env.local` a production + preview — sin filtro de variables muertas. Es exactamente el mecanismo por el que siguen ahí: cualquier corrida del script las reactiva.

**Escenario con valores:** un operador sigue el propio `DEPLOY.md` ("Para listarlas: `vercel env ls production`") y ve `DASHBOARD_PASSCODE` — concluye que el mecanismo de passcode sigue vivo, o que hay un segundo gate además de Supabase Auth, y pierde tiempo buscando una ruta `/acceso` que no existe. Peor: una corrida de `deploy-vercel.sh` re-empuja las dos variables muertas a producción, perpetuando el inventario que el runbook declara borrado. `runbook.test.ts` no lo detecta: su contrato es `.env.example`↔código, y `.env.example` ya no las nombra — la contradicción vive entre el documento y las envs reales, que la suite nunca mira.

**Estado: abierto.**

### [BAJO, abierto] `FACTURAPI_SECRET_KEY` existe en Vercel preview pero no en production — los dos entornos divergen sin que nada lo diga

`vercel env ls preview` muestra `FACTURAPI_SECRET_KEY` (created 21h ago);
`vercel env ls production` no la tiene. El código la lee (`src/lib/saas/facturapi.ts:37,46,52`): con ella, el flujo TIMBRA CFDI de verdad; sin ella, la factura queda "cobrada sin timbrar" (degradación documentada y correcta). Que una preview timbre y producción no es en sí un problema —es el estado esperado mientras el PAC no esté conectado—, pero es exactamente la clase de asimetría que produce un "en el preview sí facturaba" en el momento equivocado, y no hay ningún check que compare entornos entre sí. `runbook.test.ts` valida código↔documento, no Vercel↔Vercel.

**Estado: abierto.** BAJO.

### [BAJO, abierto, reincidente] La numeración de migraciones sigue con huecos (0066→0070) y el número del archivo no es el identificador real de la migración

`ls supabase/migrations/`: `0065`, `0066`, `0070`–`0079` — las `0067`, `0068`, `0069` nunca existieron. La ronda 10 documentó el mismo síntoma (dos archivos "0065" en paralelo, uno renombrado a 0066) y lo cerró como ALTO; el hueco quedó como deuda cosmética. La recomendación de fondo de la ronda 10 —un guardarraíl que cruce `supabase/migrations/*.sql` contra lo aplicado en la base real— **sigue sin implementarse**: `runbook.test.ts` cruza código-vs-documento, no archivo-vs-base-real, y nada en CI ni en las pruebas compara el árbol de migraciones con `list_migrations`. El caso 0022 (aplicada por MCP sin bajar al repo, `startup.ts:188-199`) demuestra que la divergencia entre las dos fuentes de verdad ya pasó una vez y solo se caza por el error de una llamada.

**Estado: abierto** (cosmético; la deuda estructural sigue).

## Lo que revisé y está bien

- **El deploy opt-in funciona, verificado en vivo y no citando el doc.** Deployment de producción actual: `likida-1wg3j8cg7-likida.vercel.app`, creado 11:33:41 del 5-ago, 4 segundos después del commit `56c267a` (11:33:37, asunto con `[deploy]`). El commit `ce9abab` (11:53:59, sin bandera) no produjo ningún deployment nuevo — `vercel ls` solo muestra el de las 11:33. La semántica del `ignoreCommand` (`vercel.json:3`, `grep -qi '[deploy]' && exit 1 || exit 0`) es: exit 0 = skip, no-cero = build — coincide con lo que el repo documenta y con lo observado. Los alias del deployment vigente incluyen `https://app.likida.ai` (`vercel inspect`, verificado).
- **CI como red de seguridad del modo silencioso.** `.github/workflows/ci.yml` corre typecheck, lint, `test:coverage` con umbral, las pruebas de tiempo sin instrumentar y `npm run build` en CADA push de cualquier rama. Un commit sin `[deploy]` no publica, pero sí se verifica — el modo de falla silencioso del opt-in tiene red.
- **Los tres crons fallan cerrado.** `escalar`/`facturar`/`purgar` devuelven 500 sin `CRON_SECRET` y 401 con bearer equivocado; `CRON_SECRET` existe en producción (18h ago). `purgar` es idempotente y declara `llmCostoPurgado`; `facturar` solo emite con `FACTURACION_MODO=emitir` a mano y responde 503 con los tres intentos de binario si Chromium no arranca, sin marcar tickets. El ALTO de rendimiento de la ronda 10 (8 tickets × 60 s = 480 s contra 300 s) está cerrado EN EL CÓDIGO: el `for` de flotas consulta `Date.now() - inicioLote >= PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS` (240 s) antes de abrir cada navegador y deja lo que no entra `sinTiempo`, sin marcar.
- **Suite de observabilidad verde:** `npx vitest run src/lib/observability src/lib/cuadra/migraciones_verificadas.test.ts` → 33/33 (arranque 7, sentry 5, reportar 11, runbook 6, migraciones 4). `.env.example` está al día con el código (ni de más ni de menos) y `DEPLOY.md` menciona `SENTRY_DSN`/`DEMO_TENANT_ID` y dónde mirar logs.
- **Probes de arranque con diagnóstico honesto:** `startup.ts:35-55` distingue "la base no contestó" (warn, no afirma nada) de "la migración no existe" (error con mensaje de consecuencia) — el falso positivo del 28-jul está cerrado y explicado con nombre.
- **Sentry opcional, silencioso y redactor:** `sentry.ts` no se carga sin DSN, el arranque grita `startup.observabilidad sentry:false` en despliegue real, y `SENTRY_DSN` está puesto en producción (5d ago). `flushObservabilidad` se llama al final del `after()` del webhook — el hallazgo de la ronda 6 ("el mecanismo existía y nadie lo llamaba") sigue cerrado.
- **El logger sigue con su doctrina correcta:** UUID → huella estable derivable (`huellaId`, documentada en `DEPLOY.md:18-29`), RFC/teléfonos → borrado entero. El `wa.no_entregado` (acuses de entrega de Meta) se registra con wamid — el incidente del 28-jul no se repite por ese camino.
- **`next.config.ts`:** el trace del webhook quedó sin `.env*`, `.md`, `docs/`, `supabase/` (medido, no prometido); `serverExternalPackages` incluye `@sparticuz/chromium`/`playwright-core`/`zxing-wasm` con la razón de cada uno; `outputFileTracingIncludes` solo en las dos funciones que lo necesitan. El webhook responde 200 antes de trabajar y procesa en `after()` con pool de 5 y reloj propio — los modos de fallo caros (deploy "bien" que truena en runtime) están atacados por diseño.
- **El seed quedó alineado con el guion** (`c78e080`, 12:57): OP-101 = `529993700779`, tenant `11111111-…`, política en `tenant.config.politica` (no en `politica_gasto`, que está muerta), gastos que cuadran comprobado = anticipo = $10,600 con única diferencia el diésel $200 sobre tope, y el orden de inserts (gastos antes que liquidaciones) no choca con el trigger de la 0036. Es idempotente (9 inserts con `on conflict`).
- **`respaldo.sh` sigue existiendo y con sentido** (valida >2000 bytes, retiene 14 días, `npx supabase` sin instalación global) — y sigue bloqueado por la parte humana: `npx supabase projects list` responde "Access token not provided"; no hay `supabase login`/`link`. No invento que esté resuelto.
- **El acceso de Javier a Vercel por CLI sigue vivo:** `vercel whoami` → `likidaai-8016`.

## Esto depende de Javier

1. **Cargar los datos del demo en la base real.** El camino que funciona es
   `psql "$DATABASE_URL" -f supabase/seed.sql` (el seed es idempotente y está
   alineado); `npm run seed` NO funciona contra la base ya migrada (hallazgo
   CRÍTICO). Hacerlo y verificar con un "hola" real.
2. **Aplicar 0078 y 0079 a la base real** (y correr el bloque 54/55 de
   `verificaciones.sql` contra ella) — están commiteadas y declaradas
   "pendientes de correr".
3. **Borrar `DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`** de Vercel (production y
   preview) y de `.env.local`, o el hallazgo MEDIO se reabre solo en la
   siguiente corrida de `deploy-vercel.sh`.
4. **`supabase login` + `supabase link`** — sin esto `respaldo.sh` no corre.
   Sin cambio desde la ronda 10.
5. **Segundo proyecto o branch de Supabase para desarrollo** — `npm run dev` y
   producción siguen siendo la misma base (`NEXT_PUBLIC_SUPABASE_URL` en
   `.env.local` = `gngoqsvrxdguxvsizpbw.supabase.co`, el proyecto de
   producción). Riesgo estructural sin cambio.

## Esto lo puede arreglar el código (sin depender de Javier)

1. **`scripts/seed.sh`:** saltar las migraciones ya aplicadas (leer
   `supabase_migrations.schema_migrations` si existe, o usar `supabase db push`
   para las migraciones y psql solo para `seed.sql`), o al menos detectar una
   base ya migrada y ofrecer el modo "solo seed". Hoy el script falla con un
   error de Postgres que no explica el camino alternativo.
2. **`scripts/deploy-vercel.sh:47-49`:** fijar `NEXT_PUBLIC_APP_URL` a
   `https://app.likida.ai` como constante, nunca a `$url`.
3. **`scripts/deploy-vercel.sh:38-40`:** filtrar variables muertas conocidas
   (`DASHBOARD_PASSCODE`, `DASHBOARD_SECRET`).
4. **El guardarraíl de migraciones archivo↔base real** que la ronda 10 dejó
   como recomendación: sigue sin existir y el caso 0022 demuestra que la
   divergencia es real, no teórica.
5. **Un probe o checklist de pre-demo** que nombre 0078/0079 como pendientes de
   verificación — hoy `startup.migraciones` puede salir `ok:true` con el
   CRÍTICO de RLS sin aplicar.

## Lo que no alcancé a revisar

- **El estado real de la base** (si el seed se aplicó, si 0078/0079 están
  aplicadas): sin acceso y prohibido tocar. El orquestador reporta la base
  vacía; yo verifiqué solo el mecanismo que impide cargarla por el camino
  documentado. Es posible que un agente en paralelo la haya cargado mientras
  escribía esto — el hallazgo CRÍTICO se lee como "estado al momento de
  escribir".
- **El plan de Vercel (Pro vs Hobby):** no es observable desde el CLI que tengo;
  afecta `maxDuration` (webhook 120 s, facturar 300 s) y la existencia misma de
  los crons. `DEPLOY.md` afirma Pro.
- **Log drain:** esta versión del CLI no expone `log-drains`; `DEPLOY.md` dice
  que no hay ninguno configurado. No pude confirmarlo ni negarlo por otra vía.
- **Valores de las envs cifradas** (`NEXT_PUBLIC_APP_URL`, `DEMO_TENANT_ID`,
  `SENTRY_DSN` en Vercel): solo verifiqué que existen, no su contenido.
- **El modo dev de Meta** (`is_live`), el estado de las 11 plantillas y el
  webhook registrado: externos al repo.
- **La suite completa** (3,079 pruebas): otro auditor la corre; corrí solo los
  5 archivos de mi rubro (33 pruebas) y la re-corrida de los 2 que tocan
  migraciones tras los commits de las 12:54-12:57 — verde.

## Veredicto

**No es green light para el demo tal como está.** Los mecanismos de
operabilidad están en su mejor estado histórico y verificados en vivo —deploy
opt-in funcionando, CI en cada push, crons que fallan cerrado, probes con
diagnóstico honesto, redacción de logs correcta—. Pero el demo de mañana
depende de dos ejecuciones que nadie ha hecho y cuyos caminos están rotos u
ocultos: los datos del seed no están en la base y el único comando documentado
para cargarlos falla en una base ya migrada; y las migraciones 0078/0079
(declaradas CRÍTICO en seguridad) están commiteadas "pendientes de aplicar" sin
que ningún probe las reclame. Es el patrón exacto que este rubro caza: el
sistema está verde, el log dice `ok:true`, y la sala ve "No tienes un viaje
abierto". **Green light para el código, con la condición explícita de ejecutar
`psql -f supabase/seed.sql` + aplicar 0078/0079 + verificar con un "hola" real
antes de la sala.**
