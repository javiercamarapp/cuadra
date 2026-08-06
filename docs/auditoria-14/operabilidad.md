# Operabilidad y DX — auditoría 14

Ancla: HEAD `0fa305e` (2026-08-05 18:10:09 -0600, "feat(fiscal): RFA 2.9 deber
ser — migración 0082, seed del demo, doc, y fixes de arneses"). Todo lo que este
reporte afirma sobre el entorno se verificó en vivo con `vercel ls/inspect/env
ls`, `curl`, `git`, `ls` y lecturas directas del código en el momento de
escribir — no de memoria y no citando mensajes de commit sin abrir el archivo.
La base de datos real no se tocó ni se consultó (prohibido por el encargo).

**Nota: 7.5/10** (era 7 en la ronda 13). El movimiento es real y medible: las
dos condiciones de código que la ronda 13 dejó pendientes para el demo —el seed
contra base ya migrada (ALTO) y el passcode muerto en Vercel y `.env.local`
(MEDIO)— están **cerradas en los hechos**, verificadas una por una, y la ronda
14 no rompió nada del rubro: tsc 0, eslint 0 errores, 235 pruebas de mi bloque
verdes. Pero la misma ronda confirma dos deudas que le quitan el "8": la RFA 2.9
—el trabajo fiscal de HOY, con su migración aplicada a la base real— **no está
desplegada**: producción sigue en `caae369` (17 commits atrás), o sea que la
base está adelante del código desplegado; y el guard de `seed.sh` que cerró el
ALTO de la ronda 13 volvió a quedar por debajo del nivel que `seed.sql` exige
(0082), por el propio cambio de la ronda 14. Además el respaldo sigue sin poder
correr (sin `supabase login`), ahora con la base que tiene la 0082 y la
declaración del demo.

## Hallazgos

### [MEDIO, abierto — nuevo] Producción está 17 commits detrás de master: la RFA 2.9 completa no está desplegada, y la base quedó adelante del código desplegado

Verificado en vivo: `vercel inspect https://app.likida.ai` →
`url https://likida-4h09tz7eg-likida.vercel.app` (created 14:49:22 = `caae369`,
el release de la ronda 13). `vercel ls` muestra los pushes posteriores —
`0d23f73` (motor RFA 2.9) y `0fa305e` (migración 0082 + seed + alta de flota)—
como **Canceled** (3 s, el `ignoreCommand` del deploy opt-in haciendo su
trabajo). `git log --oneline caae369..HEAD` = 17 commits, ninguno con `[deploy]`
en el asunto. El checklist del GUION ("Antes de entrar a la sala") no incluye el
cruce `git log -1` vs deployment que `DEPLOY.md` documenta, así que el estado
llega a la sala sin que nada lo grite.

Mientras tanto, la base real fue avanzada por el camino del MCP: la 0082 quedó
aplicada y el seed escribió `tenant.config.facilidadCombustibleEfectivo`
(`supabase/seed.sql:105`, "la flota del demo SÍ califica") — según el mensaje de
`0fa305e`, no verificable sin tocar la base. El código desplegado es ANTERIOR a
ese dato: el motor de producción no conoce la llave, la ignora, y el alta de
flota de producción (`/admin/flotas`) no tiene los dos checkboxes de
dedicación/régimen que el master sí trae (`src/app/admin/flotas/page.tsx:173-186`).

**Escenario con valores:** 6-ago, en la sala. El contralor de Innovativos
pregunta por la regla del 15% de diésel en efectivo (el DOF, el trabajo que se
acaba de terminar): producción responde con la regla vieja —el motor de
`caae369` marca `combustible_efectivo` contra "el tope del 15% del combustible
del ejercicio" sin contador—, o el operador manda un ticket de diésel en
efectivo durante el demo y el número que sale no es el de la RFA 2.9. Ninguna
prueba del repo puede cazarlo: `runbook.test.ts` cruza código↔documento, nunca
master↔Vercel. Alternativa: alguien entra a `/admin/flotas` en producción
esperando la declaración nueva y no está.

**Estado: abierto.** No rompe el GUION tal como está escrito (no menciona la RFA
2.9), pero es el hecho operativo más importante del día: **el código y la base
están en versiones distintas**, y el modo de falla es silencioso por diseño.

### [MEDIO, abierto — nuevo] `scripts/seed.sh:21` detecta el esquema por la tabla `viaje`, pero `seed.sql` ahora exige la migración 0082: una base migrada <0082 se salta las migraciones y revienta en el `update` del config

`c563a0a` (ronda 13) arregló el ALTO: correr TODAS las migraciones contra una
base ya migrada reventaba con `policy already exists`. El guard quedó así:

```bash
# scripts/seed.sh:21-22
if psql "$DB" -q -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='viaje'" | grep -q 1; then
  echo "▸ Esquema ya aplicado — solo se siembran los DATOS …"
```

Mide "existe la tabla `viaje`", no "el esquema que `seed.sql` necesita". Y
`0fa305e` —la misma ronda que verifica el cierre— agregó a `seed.sql:105` una
dependencia que ese guard no ve:

```sql
-- supabase/seed.sql:104-106
'{facilidadCombustibleEfectivo}',
'{"dedicacionExclusivaCarga":true,"regimenElegible":true}'::jsonb
```

Ese `update tenant set config` pasa por el CHECK de la 0026
(`supabase/migrations/0026*.sql:337`, `check (config is null or
config_tenant_valida(config))`). La función de la 0026 tiene la lista cerrada de
9 llaves; `facilidadCombustibleEfectivo` solo existe en la versión de la 0082.
Una base con el esquema pero sin la 0082 → el guard salta las migraciones →
`seed.sql` muere en el primer tenant con *"tenant.config trae la llave
facilidadCombustibleEfectivo, que CuadraConfig no conoce"*.

**Escenario con valores:** el día después del demo, alguien restaura un backup
de antes de la 0082 (o una base migrada a 0081) y corre
`DATABASE_URL="postgres://…" npm run seed` para re-sembrar. `seed.sh` ve `viaje`,
salta las migraciones, y a los 2 segundos el `ON_ERROR_STOP=1` aborta en
`seed.sql` con el error del CHECK — que NO dice "te falta la 0082". El mensaje
final "✅ Listo" jamás se imprime, pero la mitad de los inserts ya entró: la
persona queda con una base a medias y un error que apunta a la llave de config,
no a la migración.

**Estado: abierto.** El fix de la ronda 13 funciona para la base ACTUAL (que sí
tiene la 0082), pero el guard quedó por debajo del nivel que el propio seed de
la ronda 14 exige. El guard correcto sondea la firma/llaves de
`config_tenant_valida` o un marcador de la 0082, no la existencia de `viaje`.

### [MEDIO, abierto — reincidente ronda 10/11/12/13] `respaldo.sh` sigue sin poder correr: sin `supabase login`, la base que tiene el demo y la 0082 no tiene respaldo documentado que funcione

Verificado ahora mismo: `npx --yes supabase projects list` responde *"Access
token not provided. Supply an access token by running `supabase login`…"*; no
hay `supabase/config.toml` ni `.supabase/` (el proyecto no está enlazado), así
que `respaldo.sh:28` (`npx --yes supabase db dump --file … --data-only`) no
puede correr. El encabezado del script lo dice con nombre: plan FREE de
Supabase, sin respaldo automático ni PITR, y el 4-ago se borró la base entera y
la salvó un dump a mano.

El costo de que siga abierto volvió a subir: la base sin respaldo operativo es
ahora la que tiene la migración 0082, la declaración de la facilidad del demo y
el seed completo. No hay ninguna otra vía escrita en el repo. Siguen siendo dos
comandos humanos (`supabase login`, `supabase link`).

**Estado: abierto** (sin cambio desde la ronda 10).

### [BAJO, abierto — nuevo] `desde_db.ts:60-73`: la consulta del ejercicio (RFA 2.9) agrega una superficie de fallo nueva a CADA cuadre, con un filtro construido desde config

La RFA 2.9 metió al camino del dinero una consulta que antes no existía —corre
en cada `cuadrarDesdeDB`, o sea en cada "listo" y en cada re-cuadre del agente—:

```ts
// src/lib/cuadra/cuadre/desde_db.ts:60-73
const clavesCombustible = config.hidrocarburos?.claves ?? [];
…
.or(`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})`)
```

Tres puntas, ninguna probada contra la base real:

1. **Lista vacía.** La validación de la 0082 solo revisa `hidrocarburos.claves`
   *si la llave existe* (`0082_config_facilidad15.sql:181-188`). Un tenant con
   `config: {"hidrocarburos": {"unidad": "LTR"}}` —válido para el trigger— deja
   `clavesCombustible = []` y el filtro queda `clave_prod_serv.in.()`. El
   comportamiento de PostgREST ante la lista vacía no está probado en ningún
   arnés del repo; si rechaza el filtro, `traerTodo` lanza (`pg.ts:33-36,
   exigir`) y **toda liquidación de ese tenant muere** con un error que no dice
   qué config lo causó. Si lo acepta como "nada", el contador del 15% se
   calcula solo sobre `concepto = 'diesel'` y omite las claves SAT de gasolina —
   un número equivocado sin error.
2. **Inyección en el filtro.** Una clave con `,` o `)` (el trigger solo exige
   que sea texto, no que sea una clave SAT de 8 dígitos) se convierte en valores
   extra del `in.()`.
3. **La página del año.** `traerTodo` pagina de 1,000 en 1,000 con
   `MAX_PAGINAS = 100` (`pg.ts:44-47`): una flota con >100,000 filas de
   combustible en el ejercicio corta con `LecturaIncompleta` → cuadre falla. La
   0023 indexa `(tenant_id, concepto, fecha)`, pero la consulta filtra además
   por `clave_prod_serv` dentro de un OR.

El demo no lo toca (2 gastos, 0 en efectivo), pero es la nueva superficie de
fallo del camino del dinero, y se activa en la primera liquidación de un tenant
con una config que el propio trigger aprueba.

**Estado: abierto.**

### [BAJO, abierto — reincidente ronda 13] `startup.ts` sigue sin sondear las migraciones 0078/0079/0080, y tampoco 0081/0082

Verificado: `grep -n "0078\|0079\|0080\|0081\|0082" src/lib/cuadra/startup.ts`
→ cero líneas. `startup.ts` sondea 0005, 0011, 0031, 0016, 0017, 0019/0024
(índices), 0036/0037 (triggers), 0033, 0022 — y ninguna de las cinco
migraciones nuevas. La 0081 tiene bloque 56 en `verificaciones.sql` y la 0082
está exenta con razón en `migraciones_verificadas.test.ts:54` — pero el ARRANQUE
no las conoce: si mañana se restaura una base sin el trío de RLS (0078/0079) o
sin la 0082, `startup.migraciones` sale `ok:true` con los huecos abiertos, y el
alta de flota con checkboxes revienta en el CHECK con un error que la línea de
arranque no anticipó.

**Estado: abierto** (BAJO; era la recomendación #5 de la ronda 12, sin
implementar).

### [BAJO, abierto — reincidente ronda 13] `deploy-vercel.sh:65-69` sigue sugiriendo registrar el webhook contra la URL EFÍMERA y subir `maxDuration` a 120 cuando ya está en 120/300

```bash
# scripts/deploy-vercel.sh:65-69
── SIGUIENTE ──
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan: … Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
```

`$url` es el subdominio efímero del deployment recién creado, no el canónico
(`https://app.likida.ai/api/webhook/whatsapp`, el que `DEPLOY.md` documenta y el
que debe quedar registrado en Meta). Y el paso 2 quedó viejo: el webhook ya está
en `maxDuration = 120` (`route.ts:77`), los crons en 120/120/300, con el plan
Pro verificado el 28-jul (comentario en `route.ts:62-71`). `c563a0a` arregló la
parte de envs del script y dejó esta guía anacrónica intacta.

**Estado: abierto** (cosmético).

### [BAJO, abierto — reincidente ronda 13] `FACTURAPI_SECRET_KEY` sigue solo en preview, re-creada hace 24 h; producción y preview divergen en timbrado sin que ningún check lo diga

`vercel env ls preview`: `FACTURAPI_SECRET_KEY` (Encrypted, **1d ago** — se ha
vuelto a crear/empujar desde la ronda 13, que la vio a 24 h). `vercel env ls
production`: no existe. `.env.local:48` la tiene con valor
(`sk_test_FkHv…`). El código la lee (`src/lib/saas/facturapi.ts:37,46,52`): con
ella se timbra CFDI de verdad; sin ella la factura queda "cobrada sin timbrar"
(degradación documentada y correcta). La asimetría preview-timbra/producción-no
es el estado esperado — pero es exactamente la que produce el "en el preview sí
facturaba" en el momento equivocado, y `runbook.test.ts` cruza código↔documento,
nunca Vercel↔Vercel.

**Estado: abierto.** La divergencia además se mantiene activa (re-creación a las
24 h).

### [BAJO, abierto — reincidente ronda 10/12/13] La numeración de migraciones sigue con huecos (0066→0070)

`ls supabase/migrations/`: `0065`, `0066`, `0070`–`0082` — las `0067`, `0068`,
`0069` nunca existieron. Cosmético, ya documentado; el guardarraíl archivo↔base
real sigue sin implementarse (`runbook.test.ts` cruza código↔docs, nunca
archivo↔`supabase_migrations.schema_migrations`).

**Estado: abierto** (cosmético).

## Cierres de la ronda 13 — verificados

- **[ALTO, cerrado con `c563a0a`]** `scripts/seed.sh` ya no re-aplica todas las
  migraciones contra una base migrada: detecta `viaje` en
  `information_schema` y solo siembra los DATOS (`seed.sh:21-29`). Verificado en
  el archivo actual, no citando el commit. **Con el matiz del hallazgo MEDIO
  nuevo**: el guard quedó por debajo del nivel (0082) que `seed.sql` ahora
  exige.
- **[MEDIO ×2, cerrado en los hechos]** El passcode muerto salió de verdad de
  los dos inventarios: `.env.local` no tiene `DASHBOARD_PASSCODE` ni
  `DASHBOARD_SECRET` (grep vacío), `vercel env ls production` y `vercel env ls
  preview` tampoco los listan, y `arranque.ts` ya no los menciona (su encabezado
  documenta el borrado del 5-ago). `DEPLOY.md:110-111` y `.env.example:43-44`
  ahora dicen la verdad. El filtro del script (`deploy-vercel.sh:47-49`) quedó
  como cinturón.
- **[MEDIO, sin cambio]** `respaldo.sh` bloqueado — ver hallazgo MEDIO arriba.
- **[BAJO, sin cambio]** `FACTURAPI_SECRET_KEY` solo en preview — ver arriba.
- **[BAJO, sin cambio]** hueco 0066→0070 y guardarraíl archivo↔base — ver arriba.
- **[BAJO, sin cambio]** `startup.ts` sin sondear 0078/0079/0080 — ver arriba.
- **[BAJO, sin cambio]** `deploy-vercel.sh:65-69` — ver arriba.

## Lo que revisé y está bien

- **El demo responde en vivo, en el dominio canónico.** `curl` a
  `https://app.likida.ai/` → 200 (1.20 s), `/login` → 200, `/demo` → 200,
  `/aviso/11111111-…` → 200 en `app.likida.ai` y en `likida.ai` (el host que
  `seed.sql` cita en `url_aviso_privacidad`); el webhook responde 403 al GET sin
  token válido. El deployment vigente es exactamente `caae369` (14:49:22) — lo
  que la ronda 13 dejó verificado sigue verificado, y las superficies del GUION
  no cambiaron.
- **La RFA 2.9 no rompió el rubro en código.** `npx tsc --noEmit -p .` → 0;
  `npx eslint src/` → 0 errores (11 warnings pre-existentes); 235 pruebas de mi
  bloque verdes: observabilidad/startup/logger/env 78/78 (incluye
  `migraciones_verificadas`, `runbook`, `arranque`, `sentry`) y
  engine/por_diferencia/processor 157/157. El harness que `0fa305e` tocó
  (mocks de `processor_cadena`/`processor_cierre` con eq/gte/lte/or/range) es
  coherente con la consulta nueva de `desde_db`.
- **El seed sigue alineado con el GUION y la RFA 2.9 es inerte en los números
  del demo.** El diésel precargado es `forma_pago = '03'` (transferencia,
  `seed.sql:119`), no efectivo: la facilidad declarada en `seed.sql:105` no
  cambia ningún número del arco (la ÚNICA diferencia sigue siendo la de política
  $200). El caseta $1,400 está bajo tope; anticipo $10,600 = 4,200 + 1,400 +
  ~$5,000 en vivo. El `update` del config es idempotente (`jsonb_set` doble,
  sin `on conflict` pero sin estado que acumular).
- **Crons que fallan cerrado.** Las tres rutas devuelven 500 sin `CRON_SECRET` y
  401 con bearer equivocado (verificado en `escalar/route.ts`, `purgar/route.ts`
  y `facturar/route.ts:248-254`); `CRON_SECRET` existe en producción (24 h).
  `facturar` corta por reloj con `MARGEN_LOTE_MS = 150_000` y deja lo que no
  entra `sinTiempo`, anunciándolo en la respuesta.
- **Webhook con 200-antes-de-trabajar, pool de 5 y flush al final.** El
  `after()` único, `conPool` con 5 obreros, `flushObservabilidad` al cierre
  (`route.ts:168-194`), `maxDuration = 120` con el plan Pro verificado el
  28-jul. Los acuses `failed` de Meta se loguean como `wa.no_entregado` con
  código y detalle.
- **Observabilidad encendida antes de sondear.** `instrumentation.ts` enciende
  Sentry ANTES de `verificarMigracionesCriticas`; `startup.observabilidad` grita
  `sentry:false` si falta el DSN. Las envs que el checklist del GUION exige
  (`SENTRY_DSN`, `DEMO_TENANT_ID`, `NEXT_PUBLIC_APP_URL`,
  `CUADRA_WHATSAPP_MSG_USD`) están todas en producción.
- **0081 con bloque y 0082 con exención razonada.** `verificaciones.sql` bloque
  56 (el POD del chofer queda en SU flota, con impersonación de rol y valores
  esperados escritos); `migraciones_verificadas.test.ts:54` exenta la 0082 con
  razón honesta ("redefine config_tenant_valida; si falta, el alta revienta
  ruidoso"). La 0082 en sí es una copia íntegra de la 0026 con la décima llave —
  leída, coherente.
- **El alta de flota no rompió a los llamadores viejos.** `administracion.ts`
  solo escribe `config` si llega la declaración (`facilidad15` undefined → sin
  config, mismo comportamiento de antes). El caso `undefined` de una llave con
  la otra presente guarda `null` — el motor lo lee como "por confirmar", que es
  la rama honesta.

## Lo que no alcancé a revisar

- **La base real en sí** (prohibido consultarla): si la 0082 está aplicada de
  verdad, si la declaración del demo quedó en `tenant.config`, si las filas del
  seed siguen intactas hoy, si los bloques 54/55/56 dieron lo esperado.
- **El comportamiento exacto de PostgREST ante `in.()` vacío** (el caso del
  hallazgo BAJO de `desde_db`): no hay forma de probarlo sin tocar la base o
  levantar una instancia, y ninguna prueba del repo lo cubre.
- **Valores de las envs cifradas de Vercel** (verifiqué existencia, no
  contenido).
- **Ejecución real de los crons** y el estado de Meta (`dev_mode`, webhook
  registrado, plantillas).
- **La suite completa (~3,148 pruebas)**: otro auditor la corre; corrí las 235
  de mi bloque.
- **La RFA 2.9 en su contenido fiscal** (matriz, 15%, IEPS): es el rubro del
  auditor fiscal; yo solo verifiqué el impacto operativo (consultas, seed,
  despliegue).

## Veredicto

**Green light condicionado para el demo de mañana.** Las dos condiciones de
código que la ronda 13 dejó escritas están cerradas en los hechos y verificadas
en vivo (seed contra base migrada; passcode fuera de `.env.local` y de Vercel en
production y preview). No hay ningún CRÍTICO ni ALTO nuevo en el rubro: la ronda
14 no rompió nada del camino del demo (tsc/eslint/235 pruebas verdes, superficies
respondiendo 200). Pero el veredicto de la ronda 13 decía que el CRÍTICO se
convertiría en "el de la ronda 14 si el demo necesita re-sembrado y alguien
sigue el runbook" — eso quedó cerrado, y en su lugar hay dos cosas que decidir
ANTES de la sala:

1. **Decide el estado de la RFA 2.9.** Producción está en `caae369`, 17 commits
   atrás de master; la base tiene la 0082 y la declaración del demo que el
   código desplegado no lee. O se publica (la suite está verde: `[deploy]` en el
   asunto de un commit, o Redeploy), o se va a la sala sabiendo que el 15% de
   diésel en efectivo no se demuestra. El GUION no lo pide, pero es el trabajo
   de hoy — no puede quedar en "no me di cuenta".
2. **NO restaures un backup viejo y corras `npm run seed`.** El guard de
   `seed.sh` no detecta el nivel de esquema que `seed.sql` exige: una base sin
   la 0082 revienta en el `update` del config con un error que no nombra la
   migración. El camino que sí funciona contra la base actual sigue siendo el
   mismo de la ronda 13: `psql "$DATABASE_URL" -f supabase/seed.sql`.
3. **El respaldo sigue sin existir operativamente** (`supabase login` +
   `supabase link`), y la base que no se puede respaldar es ahora la que tiene
   la RFA 2.9. Es la deuda más vieja del rubro, con el costo más alto de la
   historia del repo.

**Green light para el código, condicionado al despliegue.** El código de master
no rompió nada del rubro; el problema operativo es que el código de master no es
el que está sirviendo, y la base ya se movió al esquema nuevo.
