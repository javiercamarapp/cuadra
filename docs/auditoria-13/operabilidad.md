# Operabilidad y DX — auditoría 13

Ancla: HEAD `caae369` (2026-08-05 14:49:17 -0600, "release: auditoría 12 completa a
producción — 38 commits de arreglo [deploy]"). Deployment de producción vigente:
`likida-4h09tz7eg-likida.vercel.app`, creado 14:49:22 -0600 — **5 segundos después
del commit con `[deploy]` en el asunto**, aliases `app.likida.ai`, `likida.ai`,
`likidaai.vercel.app` (verificado con `vercel inspect`). La base de datos real no
se tocó ni se consultó: está prohibido por el encargo. Todo lo demás se verificó
en vivo con `vercel ls/inspect/env ls`, `gh run list`, `curl`, `git`, `ls` y
lecturas directas del código en el momento de escribir — no de memoria, y no
citando mensajes de commit sin abrir el archivo.

**Nota: 7/10** (era 6 en la primera pasada de la ronda 12, 7 después de la
re-auditoría). El movimiento es real y medible: el CRÍTICO que mataba el demo de
mañana —base real vacía y camino roto para sembrarla— está resuelto en los
hechos (base sembrada según el orquestador; `seed.sql` alineado con el guion y
verificado línea por línea; el release está en producción y responde 200 en
todas las superficies del demo). Pero esta misma ronda confirma que **las cinco
recomendaciones de código que la ronda 12 dejó escritas en "Esto lo puede
arreglar el código" no se implementó ni una**: `scripts/seed.sh` sigue sin poder
correr contra una base ya migrada (la mitad de código del CRÍTICO, intacta desde
la ronda 10), el passcode muerto sigue en Vercel y en `.env.local` mientras
`DEPLOY.md` afirma que se borró, no hay guardarraíl archivo↔base real, y
`respaldo.sh` sigue bloqueado — ahora con más costo, porque la base que nadie
puede respaldar por el camino documentado es la que tiene el seed del demo y los
55 bloques verificados.

## Hallazgos

### [ALTO, abierto — reincidente, mitad de código del CRÍTICO de la ronda 12] `npm run seed` sigue sin poder correr contra una base ya migrada; el único camino que funciona (`psql -f supabase/seed.sql`) no está documentado en ningún lado

`SEED.md:8` sigue documentando UN comando: `DATABASE_URL="postgres://…" npm run seed`. Ese comando ejecuta `scripts/seed.sh`, que primero re-aplica TODAS las migraciones con psql crudo y `ON_ERROR_STOP=1`:

```bash
# scripts/seed.sh:17-21
echo "▸ Aplicando migraciones…"
for f in supabase/migrations/*.sql; do
  echo "  → $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
```

Y `0001_init.sql` sigue creando sus policies sin guarda:

```sql
-- supabase/migrations/0001_init.sql:114 y :122
create policy tenant_data on %I for all
...
create policy tenant_self on tenant for all
```

Cero `drop policy` en `0001_init.sql` (verificado: `grep -c "drop policy"` = 0;
`grep -c "create policy"` = 3). En una base donde la 0001 ya se aplicó —la real,
migrada hasta la 0080—, Postgres responde `SQLSTATE 42P07: policy "tenant_data"
for table "terminal" already exists`, `ON_ERROR_STOP=1` aborta en el PRIMER
archivo y `seed.sql` (línea 28) jamás se ejecuta. `git log -- scripts/seed.sh`
confirma que el archivo no se toca desde `2c7e4f1` (anterior a la ronda 10): la
ronda 12 arregló el `seed.sql` (alineado, idempotente) y aplicó los datos a mano,
pero **el vehículo documentado para sembrar o re-sembrar sigue roto**.

**Escenario con valores:** 6-ago, 07:00. El ensayo de la noche anterior dejó el
viaje demo con la liquidación emitida de más (o alguien probó "reabrir" y el
estado quedó raro). La persona abre `SEED.md:8`, corre
`DATABASE_URL="postgres://postgres.gngoqsvrxdguxvsizpbw:…" npm run seed` para
resetear. A los 3 segundos: `ERROR: policy "tenant_data" for table "terminal"
already exists`; `set -euo pipefail` mata el script. La persona (a) concluye que
"el seed no se puede aplicar" a esta base y se va en pánico, o (b) descubre que
`psql "$DATABASE_URL" -f supabase/seed.sql` a secas sí funciona (el seed es
idempotente: `on conflict (id) do nothing`/`do update` en los 9 inserts, y los
gastos entran ANTES que las liquidaciones, sin chocar con el trigger de la 0036)
— un camino que **no está escrito en ningún archivo del repo**. `SEED.md:10`
dice "Aplica migraciones + crea el bucket + siembra los datos", y `npm run
setup` (`package.json`) encadena el mismo script roto.

**Estado: abierto.** La mitad de datos del CRÍTICO de la ronda 12 está cerrada
(la base real quedó sembrada vía psql, según el orquestador); la mitad de código
—la que la ronda 12 marcó como "lo puede arreglar el código" #1— quedó intacta.

### [MEDIO, abierto — ronda 12 sin cerrar] El "borrado" del passcode fue a medias en los hechos: `DEPLOY.md:110-111` afirma que se borró, y las dos variables siguen en Vercel (production y preview) y en `.env.local`

`e845d0c` arregló SOLO la mitad de script: `deploy-vercel.sh:47-49` ahora salta
`DASHBOARD_PASSCODE`/`DASHBOARD_SECRET` al empujar envs (verificado en el diff).
La otra mitad —borrar las variables del inventario real— no se hizo:

- `vercel env ls production`: `DASHBOARD_PASSCODE` (created 3d ago) y
  `DASHBOARD_SECRET` (created 8d ago), ambas Encrypted, **siguen ahí**.
- `vercel env ls preview`: las dos también.
- `.env.local` (gitignored, pero es la fuente que alimenta el script): las dos,
  con valor (nombres verificados).

Y `DEPLOY.md:110-111` sigue diciendo: *"El passcode compartido
(`DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`, la ruta `/acceso`) se borró el
5-ago-2026"*. Lo mismo en `.env.example:43-44`. El código muerto se borró; el
inventario de entorno que el runbook invita a listar ("Para listarlas: `vercel
env ls production`", `DEPLOY.md:113`) lo contradice en vivo.

**Escenario con valores:** un operador sigue el runbook, lista las envs de
producción y ve `DASHBOARD_PASSCODE` → concluye que el gate de passcode sigue
vivo, o que hay un segundo candado además de Supabase Auth, y pierde tiempo
buscando una ruta `/acceso` que no existe. Peor: alguien corre `deploy-vercel.sh`
desde una copia vieja de `.env.local` —el filtro está en el script actual, pero
el valor sigue en la fuente— y la contradicción se perpetúa.

**Estado: abierto** (la mitad de código, cerrada con `e845d0c`; la mitad de
datos, sin hacer — era "Esto depende de Javier" #3 de la ronda 12).

### [MEDIO, abierto — reincidente ronda 10/11/12] `respaldo.sh` sigue sin poder correr: sin `supabase login`/`link`, la base de producción no tiene ni respaldo automático (plan free, según el propio script) ni el manual documentado

Verificado ahora mismo: `npx supabase projects list` responde *"Access token not
provided. Supply an access token by running `supabase login`…"*; no hay
`.supabase/` ni `supabase/config.toml` (no hay proyecto enlazado), así que
`respaldo.sh:14` (`npx --yes supabase db dump --file … --data-only`) no puede
correr. El encabezado del script lo dice con nombre: *"el proyecto está en plan
FREE de Supabase: no hay respaldo automático ni PITR… Ese mismo día se borró la
base entera y lo único que la salvó fue un dump hecho a mano."*

El costo de que esto siga abierto subió desde la ronda 12: la base que no se
puede respaldar por el camino documentado es ahora la que tiene el seed del demo
(5 operadores, viaje abierto, 3 liquidaciones), las migraciones 0078/0079/0080 y
los 55 bloques de verificación pasando. No hay ninguna otra vía de respaldo
escrita en el repo.

**Estado: abierto** (sin cambio desde la ronda 10; bloqueado por una acción
humana de dos comandos).

### [BAJO, abierto — reincidente y re-agravado] `FACTURAPI_SECRET_KEY` sigue solo en preview, y se re-creó hace 24 h; producción y preview divergen en comportamiento de timbrado sin que ningún check lo diga

`vercel env ls preview`: `FACTURAPI_SECRET_KEY` (created **24h ago** — la ronda
12 la vio a 21h, o sea que se ha vuelto a crear/empujar desde entonces).
`vercel env ls production`: no existe. El código la lee
(`src/lib/saas/facturapi.ts:37,46,52`): con ella se timbra CFDI de verdad; sin
ella la factura queda "cobrada sin timbrar" (degradación documentada y
correcta). Que una preview timbre y producción no, es el estado esperado —pero
es exactamente la asimetría que produce el "en el preview sí facturaba" en el
momento equivocado, y `runbook.test.ts` cruza código↔documento, nunca
Vercel↔Vercel: ninguna prueba puede cazarla.

**Estado: abierto.** BAJO. La divergencia además se está manteniendo activa
(re-creación a las 24 h), lo que sube la probabilidad de que alguien la use.

### [BAJO, abierto — reincidente ronda 10/12] La numeración de migraciones sigue con huecos (0066→0070) y el guardarraíl archivo↔base real sigue sin existir

`ls supabase/migrations/`: `0065`, `0066`, `0070`–`0080` — las `0067`, `0068`,
`0069` nunca existieron. Cosmético, ya documentado. La deuda estructural —un
check que cruce el árbol de `supabase/migrations/*.sql` contra
`supabase_migrations.schema_migrations` de la base real— **sigue sin
implementarse**: `runbook.test.ts` cruza código↔`.env.example`↔`DEPLOY.md`, y
`migraciones_verificadas.test.ts` solo cruza archivo↔`verificaciones.sql`
(bloque o exención), nunca archivo↔base real. El caso 0022 (aplicada por MCP sin
bajar al repo, `startup.ts` la detecta por el error de la llamada) demuestra que
la divergencia entre las dos fuentes de verdad es real, no teórica.

**Estado: abierto** (cosmético; la recomendación de fondo de la ronda 10 sigue
sin hacerse — era "lo puede arreglar el código" #4).

### [BAJO, abierto — nuevo] `startup.ts` sigue sin sondear las migraciones 0078/0079/0080, y no existe ningún checklist pre-demo que las nombre

Recomendación #5 de la ronda 12 ("Un probe o checklist de pre-demo que nombre
0078/0079") — sin implementar. `src/lib/cuadra/startup.ts` sondea 0005, 0011,
0031, 0016, 0017, 0019/0024 (índices vía 0030), 0036/0037 (triggers vía 0043),
0033, 0022 — **ninguna línea para 0078, 0079 ni 0080**. Las tres YA están
aplicadas en la base real (según el orquestador), así que esto no es un agujero
hoy: es deuda de defensa en profundidad. Si mañana alguien restaura una base sin
el trío de RLS, `startup.migraciones` saldrá `ok:true` con los huecos de RLS
abiertos.

**Estado: abierto** (BAJO; era ALTO en la ronda 12 mientras las migraciones
estaban "pendientes de correr").

### [BAJO, abierto — nuevo] `deploy-vercel.sh:66` sugiere registrar el webhook de Meta contra la URL EFÍMERA del deployment, y su paso 2 recomienda subir `maxDuration` a 120 cuando ya está en 120/300

```bash
# scripts/deploy-vercel.sh:65-68
── SIGUIENTE ──
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan: … Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
```

`$url` es el subdominio efímero (`likida-4h09tz7eg-likida.vercel.app`), no el
canónico. El webhook registrado contra esa URL funciona mientras viva ese
deployment; el canónico (`https://app.likida.ai/api/webhook/whatsapp`, el que
documenta `DEPLOY.md`) es el que hay que registrar. Y el paso 2 quedó viejo: el
webhook ya está en `maxDuration = 120` (`route.ts:79`) y el cron de facturación
en 300, con el plan Pro verificado el 28-jul (comentario en `route.ts:62-71`).
El script que la ronda 12 arregló en la parte de envs conserva esta guía
anacrónica.

**Estado: abierto** (cosmético).

## Cierres de la ronda 12 — verificados

- **[MEDIO ×2, cerrado con `e845d0c`]** `scripts/deploy-vercel.sh` fija
  `NEXT_PUBLIC_APP_URL` al dominio CANÓNICO (`APP_URL_PRODUCCION='https://app.likida.ai'`,
  líneas 27 y 59-62) y salta las dos variables muertas del passcode
  (líneas 47-49). Verificado en el diff y en el archivo actual — no citando el
  mensaje de commit.
- **[CRÍTICO datos, cerrado en los hechos]** La base real quedó sembrada (según
  el orquestador: Transportes Innovativos, VJ-2026-0847 abierto, 2 gastos, 3
  liquidaciones). Verifiqué lo verificable: `supabase/seed.sql` está alineado con
  `GUION_DEMO.md` — operador `529993700779` (línea 75), RFC `GMX0902279I1` que
  pasa el dígito verificador (línea 26), anticipo $10,600 (línea 116), diésel
  $4,200 vs tope $4,000 = única diferencia de $200 (líneas 100-101, 130), la
  política viva en `tenant.config.politica` (línea 100, no en
  `politica_gasto`), idempotente (9 inserts con `on conflict`), gastos antes que
  liquidaciones (líneas 126 vs 151) — no choca con el trigger de la 0036.
- **[ALTO RLS, cerrado]** 0078/0079/0080 aplicadas a la base real, bloques
  26/28/44/53/54/55 pasando (según el orquestador). Las tres migraciones existen
  y son coherentes al leerlas (`0078` cierra las 7 tablas + `tenant` de solo
  lectura; `0079` cierra `app_user`/`bitacora`; `0080` agrega `operador.rfc` con
  `if not exists`).
- **[Deploy opt-in, verificado en vivo]** `caae369` (asunto con `[deploy]`,
  14:49:17) → deployment de producción Ready 14:49:22. Los pushes posteriores
  sin bandera no producen deployment (entradas "Canceled" de 3 s en `vercel ls`
  — el `ignoreCommand` funcionando). CI verde para el release (`gh run list`:
  success, 2m52s).
- **[Suite de observabilidad]** `npx vitest run src/lib/observability
  src/lib/cuadra/migraciones_verificadas.test.ts
  src/lib/cuadra/startup_diagnostico.test.ts src/lib/logger.test.ts
  src/lib/env.test.ts` → 71/71 verde.

## Lo que revisé y está bien

- **El demo responde en vivo, en el dominio canónico y en el alias.** `curl` a
  `https://app.likida.ai/` → 200 (1.14 s), `/login` → 200, `/demo` → 200,
  `/aviso/11111111-…` → 200 (en `app.likida.ai` y en `likida.ai`, que es el host
  que el seed cita en `url_aviso_privacidad`). El webhook responde 403 al GET
  sin token válido (la ruta existe y rechaza).
- **Inventario de envs de producción contra el código.** Crucé las 35 variables
  que el código lee (medidas sobre `src/`, sin contar las de plataforma) contra
  `vercel env ls production` (24 presentes): están `DEMO_TENANT_ID`, `SENTRY_DSN`
  (5d), `CUADRA_WHATSAPP_MSG_USD`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` y las 4
  flags del demo (`CUADRA_INTAKE_GRACE_MS`, `CUADRA_RECUPERAR_CIERRE_PARCIAL`,
  `CUADRA_DEDUP_FOTOS`, `CUADRA_INTAKE_ESPERA_MS` — las cuatro en
  Preview+Production, 8d). Las ausencias son defaults deliberados con su
  degradación documentada (`FACTURACION_MODO` vacío = ensayo; `STRIPE_*` vacías =
  el botón de pago se esconde y dice qué falta; `CUADRA_TOPE_*` vacías =
  defaults del código; `LLM_RAZONAMIENTO_OCR` vacío = off a propósito). `env.ts`
  y `arranque.ts` reportan los grupos de configuración dura en el arranque.
- **Crons que fallan cerrado.** Las tres rutas devuelven 500 sin `CRON_SECRET`
  y 401 con bearer equivocado (verificado en `escalar/route.ts:35-43`,
  `purgar/route.ts`, `facturar/route.ts:248-254`); `CRON_SECRET` existe en
  producción. `facturar` corta por reloj con `MARGEN_LOTE_MS = 150_000` (cubre
  el peor caso de sesión de ~147 s — el ALTO de rendimiento de la ronda 12 está
  en el código, comentado con su razonamiento), deja lo que no entra
  `sinTiempo`, lo anuncia en la respuesta, y responde 503 con los tres intentos
  de binario si Chromium no arranca, sin marcar tickets.
- **Webhook con 200-antes-de-trabajar, pool de 5 y flush al final.** El
  `after()` único, `conPool` con 5 obreros, y `flushObservabilidad` al cierre
  (verificado en `route.ts:168-194`); `maxDuration = 120` con el plan Pro
  verificado el 28-jul.
- **Arranque con diagnóstico honesto.** `startup.ts` distingue "la base no
  contestó" de "falta la migración" (`sinRespuesta`/`reportarProbe`); la
  observabilidad se enciende ANTES de sondear migraciones (`instrumentation.ts`);
  `startup.observabilidad` grita `sentry:false` en despliegue real si falta DSN.
- **Logger con su doctrina intacta.** UUID → huella FNV-1a estable y derivable;
  RFC/teléfonos → borrado entero; el regex de teléfono cubre el `521…` de Meta;
  una sola pasada con las tres reglas alternadas (no se re-escanea lo ya
  sustituido).
- **`next.config.ts` con el trace acotado y medido** (excludes documentados con
  su medición del 28-jul; `outputFileTracingIncludes` solo en webhook y cron de
  facturación; `serverExternalPackages` con la razón de cada paquete).
- **CI como red del modo silencioso.** En cada push de cualquier rama:
  typecheck, lint, `test:coverage` con umbral, las pruebas de tiempo sin
  instrumentar y el build con envs de relleno.
- **`verificaciones.sql` con los bloques 44/52/53/54/55 presentes y su corrida
  real anotada** (las 52/53 con salida copiada del 5-ago; las 54/55 con el
  "esperado" documentado), y `migraciones_verificadas.test.ts` obligando a que
  cada migración tome decisión de bloque o exención con razón (4/4 verde;
  `0080` exenta con razón escrita).

## Lo que no alcancé a revisar

- **La base real en sí** (prohibido tocarla, sin credenciales): si las filas del
  seed siguen intactas HOY, si los bloques 54/55 dieron exactamente el "esperado"
  (el encabezado de `verificaciones.sql` registra la salida de las 52/53 pero no
  la de las 54/55 — un nit de documentación), y si el proyecto Supabase está en
  plan free (lo afirma `respaldo.sh`, no lo pude confirmar por API).
- **Valores de las envs cifradas de Vercel** (`NEXT_PUBLIC_APP_URL` content,
  `DEMO_TENANT_ID`, las 4 flags del demo): verifiqué existencia, no contenido.
- **El plan de Vercel** (Pro afirmado y verificado el 28-jul según el comentario
  de `route.ts`; no observable desde el CLI actual).
- **Ejecución real de los crons** (el panel de Vercel los muestra; el CLI no
  expone corridas).
- **Meta**: `dev_mode`/`is_live`, webhook registrado y su URL de destino, estado
  de las plantillas — externos al repo (el GUION ya advierte que esto se prueba
  DÍAS antes, no ese día).
- **La suite completa (3,132 pruebas)**: otro auditor la corre; corrí las 71 de
  mi rubro (54 del bloque de observabilidad/startup/migraciones + 17 de
  logger/env), verdes.

## Veredicto

**Green light para el demo de mañana, con tres condiciones explícitas.** El
camino crítico está verificado en vivo y no citando documentos: el release
`caae369` es el deployment vigente, `app.likida.ai` responde en todas las
superficies del demo, el seed está alineado con el guion línea por línea, la
base quedó sembrada y con las migraciones RLS aplicadas (según el orquestador),
y CI + la suite de observabilidad están verdes. Los hallazgos que quedan son las
deudas de la ronda 12 que se listaron para arreglar y no se arreglaron, ninguna
nueva que bloquee la sala:

1. **NO corras `npm run seed` contra la base real.** Si mañana hay que resetear
   datos del demo, el único camino que funciona es
   `psql "$DATABASE_URL" -f supabase/seed.sql` a secas (idempotente, alineado),
   y NO está escrito en ningún lado. Escríbelo en `SEED.md` antes de la sala —
   es un hallazgo ALTO que se convierte en el CRÍTICO de la ronda 14 si el demo
   necesita un re-sembrado y alguien sigue el runbook.
2. **Borra `DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`** de Vercel (production y
   preview) y de `.env.local`, o `DEPLOY.md` seguirá afirmando algo que
   `vercel env ls production` desmiente.
3. **`supabase login` + `supabase link`** (2 comandos) — el único respaldo
   documentado de la base que tiene el demo sigue sin poder correr.

**Green light para el código**, con esas tres ejecuciones pendientes — las tres
son acciones humanas, no código. El código, esta ronda, no rompió nada: los 38
fixes de la ronda 12 no introdujeron regresiones en el rubro (ninguno tocó
`startup.ts`, `logger.ts`, `sentry.ts`, `vercel.json`, `DEPLOY.md`, `SEED.md` ni
`ci.yml`; los únicos cambios de operabilidad fueron `deploy-vercel.sh` —verificado
correcto— y `seed.sql`/`verificaciones.sql` —verificados alineados—).
