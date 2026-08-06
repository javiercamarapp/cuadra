# Operabilidad y DX — auditoría 15

Ancla: HEAD `d7b171f` (2026-08-05 18:58:47 -0600, "fix(backend+legal): 7
hallazgos de backend de la ronda 13 + pantalla ARCO de cumplimiento (AUDITORÍA
14)"). Todo lo que este reporte afirma sobre el entorno se verificó en vivo con
`vercel ls/inspect`, `curl`, `git`, `npx supabase projects list`, `npx tsc
--noEmit`, `npx eslint` y lecturas directas del código en el momento de
escribir — no de memoria y no citando mensajes de commit sin abrir el archivo.
La base de datos real no se tocó ni se consultó (prohibido por el encargo).

**Nota: 6.5/10** (era 7.5 en la ronda 14). El movimiento real de la ronda es
medible: los 7 arreglos de backend están en el código y hacen lo que dicen
(503 del `resolverTenantApi`, desempate del export, `traerTodo` en
`getPorFacturar`, aviso al chofer cuando el PDF no se entrega, validación de
rol en el alta de usuario, comentario de `meta/client.ts` al día, y el
route-test de Stripe), y la RFA 2.9 quedó con la barrida única
(`getAcumuladoCombustible` reusado) y el alta tri-estado. Pero la misma ronda
baja el promedio por tres hechos que pesan más que los fixes: **producción
quedó 19 commits atrás de master** (la RFA 2.9 completa, el ARCO y los 7
backend NO están desplegados y la base ya tiene la 0083 — el código desplegado
es anterior al dato); **la pantalla ARCO que esta ronda estrenó es una
pantalla muerta para su público** (superadmin-only, siempre vacía para el
superadmin diseñado) **y su mensaje de éxito es falso** ("el titular recibió su
respuesta por WhatsApp" — ningún código la envía); y **el contador del 15% que
falla produce cifras inventadas**: el comentario de `desde_db.ts:74` promete
una rama "sin datos del ejercicio" que no existe en el motor, y con el contador
caído el PDF afirma "el ejercicio lleva $X contra un tope de $0.00; el
excedente NO se deduce" sobre datos que no se midieron. Las deudas operativas
de la ronda 14 (seed.sh bajo nivel, respaldo imposible, startup sin sondear
0078-0083, FACTURAPI solo en preview, script de deploy anacrónico, hueco de
numeración) siguen todas abiertas, y encima quedó un archivo de prueba sin
trackear (`zzz-a15-probe.test.ts`) que rompe `tsc --noEmit`.

## Hallazgos

### [MEDIO, abierto — reincidente ronda 14] Producción está 19 commits detrás de master: la RFA 2.9 completa, el ARCO y los 7 backend no están desplegados, y la base quedó dos migraciones adelante del código que la sirve

Verificado en vivo ahora: `vercel ls` → el deployment Ready de producción más
reciente es `likida-4h09tz7eg` (created 14:49:22, aliases `app.likida.ai` /
`likida.ai`) — el mismo release de la ronda 14, cuyo commit `caae369` tiene
fecha 14:49:17. Los cinco pushes posteriores (`dd64068`, `0d23f73`, `0fa305e`,
`8a33ce1`, `d7b171f`) aparecen como **Canceled** (3-4 s, el `ignoreCommand` de
`vercel.json` haciendo su trabajo: `git log -1 --pretty=%s | grep -qi
'\[deploy\]'`). `git rev-list --count caae369..HEAD` = **19**, ninguno con
`[deploy]` en el asunto. El checklist del GUION_DEMO.md ("Antes de entrar a la
sala", líneas 18-41) sigue sin incluir el cruce `git log -1` vs deployment que
`DEPLOY.md:178-183` documenta, así que el estado llega a la sala sin que nada
lo grite.

Mientras tanto, la base real avanzó por el camino del MCP: la síntesis de la
ronda 14 afirma que la 0083 está aplicada ("el 'sí' rebota, la declaración del
demo intacta" — no verificable sin tocar la base, prohibido). El código
desplegado (`caae369`) es ANTERIOR a la 0082 y a la 0083: no conoce la llave
`facilidadCombustibleEfectivo` ni la declara en el alta de flota
(`src/app/admin/flotas/page.tsx:38-39` y `210-217` no existen en `caae369` —
verificado con `git show caae369:src/app/admin/flotas/page.tsx`, cero
menciones). La pantalla ARCO (`/admin/compliance`) y los 7 fixes de backend
tampoco están en producción.

**Escenario con valores:** 6-ago, en la sala. El contralor de Innovativos
pregunta por la regla del 15% de diésel en efectivo (el DOF, el trabajo que se
acaba de terminar): producción responde con la regla vieja —el motor de
`caae369` ni conoce el contador del ejercicio—. O alguien entra a
`/admin/flotas` en producción esperando la declaración tri-estado y no está, o
entra a `/admin/compliance` esperando el ARCO nuevo y no existe. Ninguna prueba
del repo puede cazarlo: `runbook.test.ts` cruza código↔documento, nunca
master↔Vercel.

**Estado: abierto** (empeoró: 17 → 19 commits; se agregaron la 0083, el ARCO y
los 7 backend a lo no desplegado).

### [MEDIO, abierto — nuevo] La pantalla ARCO de cumplimiento (`d7b171f`) es superadmin-only, siempre vacía para el superadmin diseñado, y su mensaje de éxito miente: "El titular recibió su respuesta por WhatsApp" y ningún código la envía

Tres puntas, todas verificadas en el archivo actual:

1. **Superadmin-only.** Vive en `src/app/admin/compliance/page.tsx`, bajo el
   layout que corre `requireSuperadmin()` (`src/app/admin/layout.tsx:38`). La
   flota —la responsable obligada a contestar en 20 días hábiles (LFPDPPP art.
   32)— no tiene ruta a esta pantalla: no existe ningún
   `dashboard/*/compliance` ni enlace en el panel de la flota. El commit la
   anuncia como "la flota ve sus solicitudes"; ninguna flota puede verla.
2. **Siempre vacía para el superadmin diseñado.** `datosDeCompliance`
   (`compliance/page.tsx:136-138`) hace `const s = await getSessionTenant(); if
   (!s?.tenantId) return [[], 0];`. El superadmin, por diseño documentado en
   `guard.ts` ("SUPERADMIN ES EL CASO APARTE. `app_user.tenant_id` nulo…"),
   tiene `tenant_id` nulo → la pantalla pinta "Ninguna solicitud ARCO
   registrada" y KPIs en 0 **siempre**, aunque las flotas tengan solicitudes.
   Si en la base real el superadmin tuviera `tenant_id` puesto (el otro
   escenario), la pantalla mostraría SOLO las solicitudes de ese tenant en una
   consola que cruza TODOS los tenants a propósito (`lib/admin/negocio.ts`) —
   el caso "parece que veo todo y veo una flota".
3. **El mensaje de éxito es falso.** `compliance/page.tsx:45`: `return { ok:
   'Solicitud marcada como resuelta. El titular recibió su respuesta por
   WhatsApp.' }`. `resolverSolicitudArco` (`repo.ts:969-976`) solo hace un
   `update` de `estado/resuelta_en/resolucion` en `solicitud_arco`. Busqué
   cualquier envío de la resolución al titular: no existe — ningún `sendText` /
   `sendTemplate` referencia `resolucion`, y el único llamador de
   `resolverSolicitudArco` es esta página. La resolución queda en la base,
   visible únicamente en una pantalla que (punto 2) no muestra nada.

**Escenario con valores:** un operador escribe *PRIVACIDAD* por WhatsApp →
`atenderPrivacidad` (`processor.ts:141-167`) responde el texto del aviso y
registra la solicitud (`registrarSolicitudArco`, `repo.ts:877`). El 6-ago el
contralor pregunta "¿y las solicitudes ARCO dónde se ven?". En producción no
existe la pantalla (está a 19 commits); en master, si Javier entra con su
superadmin, ve "Ninguna solicitud registrada" aun con la solicitud en la base.
Si alguien la "resuelve" desde un tenant con datos, la página le dice "El
titular recibió su respuesta por WhatsApp" y el titular no recibe nada: pasan
los 20 días hábiles y la constancia de respuesta (art. 16) que la app presume
no se entregó.

**Estado: abierto.** El "fix ARCO" de la ronda 14 no cierra lo que prometía
cerrar; la pantalla es inerte y el rótulo que afirma la entrega viola la regla
del repo ("un rótulo tiene que ser verdad").

### [MEDIO, abierto — nuevo] El contador best-effort del 15% que falla produce cifras inventadas: `desde_db.ts:74` promete una rama "sin datos del ejercicio" que el motor no tiene

`desde_db.ts:70-80`:

```ts
// Best-effort a propósito: el contador del 15% es CONTEXTO valioso…
// el motor recibe ceros y la rama 'sin datos del ejercicio' marca el efectivo
// para revisar, que es el fail-cerrado honesto.
let totalesEjercicio = { efectivo: 0, totalCombustible: 0 };
try {
  totalesEjercicio = await getAcumuladoCombustible(...);
} catch (e) {
  logger.warn('desde_db.contador_15_no_disponible', ...);
}
```

Esa rama no existe. En `engine.ts:301-337`, con `facilidad15 === true`, el
motor hace `const total = input.totalCombustibleEjercicio ?? 0` (línea 313) y
`const tope = 0.15 * total`; no hay ningún centinela que distinga "cero medido"
de "no se pudo medir". Con el contador caído (red, `LecturaIncompleta` de
`getAcumuladoCombustible` por >100,000 filas en el ejercicio — `repo.ts:861`
—, o un filtro de PostgREST rechazado), el motor entra a la rama de "excedente"
y emite (líneas 331-332):

> "pagado en EFECTIVO — el ejercicio lleva $1,000.00 de combustible en efectivo
> contra un tope de $0.00 (15% de $0.00); el excedente de $1,000.00 de ESTE
> comprobante NO se deduce (RFA 2026 regla 2.9)."

Donde "$1,000.00" es solo el efectivo de ESTE viaje (`efectivoAcumuladoEjercicio`
+ previo 0) — **no** el total del ejercicio, que quedó sin medir. El PDF afirma
una cifra fiscal del ejercicio que no se leyó, con el número del viaje en su
lugar, y la estatus de la liquidación es `revisar` con una nota que no dice "no
se pudo leer el contador" — dice "NO se deduce". Es exactamente la familia que
la regla "nunca inventar una cifra" prohíbe, y el comentario de `desde_db.ts:74`
la da por cerrada cuando está abierta.

**Escenario con valores:** un tenant con >100,000 gastos de combustible en el
ejercicio (o un parpadeo de red en el `getAcumuladoCombustible`) cierra un viaje
con diésel en efectivo: `repo.ts:861` lanza → `desde_db.ts:80` traga →
`engine.ts:313` recibe 0 → la nota fabrica "el ejercicio lleva $X contra un
tope de $0.00" y marca el excedente como no deducible. El contralor cruza
contra su contador, el número no coincide, y el log `desde_db.contador_15_no_disponible`
es lo único que lo explica — si alguien lo busca. La sonda P1 del archivo
`zzz-a15-probe.test.ts` (sin trackear, ver abajo) demuestra el output exacto:
"P1: contador caído (ceros) → nota afirma excedente sobre tope de $0".

**Estado: abierto.** Es el residual de la ronda 14 (BAJO #4): la lista vacía
sí se cerró (`repo.ts:831` ahora cae a `'concepto.eq.diesel'`), pero el
fail-soft que se eligió produce afirmaciones fiscales no medidas.

### [MEDIO, abierto — reincidente ronda 14] `scripts/seed.sh:21` sigue detectando el esquema por la tabla `viaje`, y `seed.sql:105` ahora exige la 0082 + la FORMA de la 0083

Sin cambio desde la ronda 14, y el nivel que `seed.sql` exige subió otra vez:
`8a33ce1` agregó la 0083 (que valida la FORMA de `facilidadCombustibleEfectivo`
— `0083_config_facilidad15_forma.sql:54-64`), y el guard de `seed.sh:21-22`
sigue midiendo solo "existe la tabla `viaje`". Una base con el esquema pero sin
la 0082 (o con la 0082 y sin la 0083) → el guard salta las migraciones →
`seed.sql:104-107` (el `update tenant set config` con
`facilidadCombustibleEfectivo`) muere en el CHECK de la 0026/0082 con *"la
llave facilidadCombustibleEfectivo, que CuadraConfig no conoce"* (o el error de
forma de la 0083) — un error que no nombra la migración que falta, con la mitad
de los inserts ya dentro.

**Escenario con valores:** el día después del demo, alguien restaura un backup
de antes de la 0082 y corre `DATABASE_URL="postgres://…" npm run seed`. El
guard ve `viaje`, salta las migraciones, y `ON_ERROR_STOP=1` aborta en el
`update` del config con el error del CHECK. El mensaje final "✅ Listo" no se
imprime, la base queda a medias y el error apunta a la llave de config, no a la
migración.

**Estado: abierto.** El guard correcto sondea la firma de `config_tenant_valida`
o un marcador de la 0083, no la existencia de `viaje`.

### [MEDIO, abierto — reincidente ronda 10/11/12/13/14] `respaldo.sh` sigue sin poder correr: sin `supabase login`, la base que tiene el demo, la 0082 y la 0083 no tiene respaldo documentado que funcione

Verificado ahora mismo: `npx --yes supabase projects list` responde *"Access
token not provided. Supply an access token by running `supabase login`…"*; no
hay `supabase/config.toml` ni `.supabase/` (el proyecto no está enlazado), así
que `respaldo.sh:28` (`npx --yes supabase db dump --file … --data-only`) no
puede correr. El costo de que siga abierto volvió a subir: la base sin respaldo
operativo es ahora la que tiene la 0083, la declaración de la facilidad del
demo y el seed completo. Siguen siendo dos comandos humanos (`supabase login`,
`supabase link`).

**Estado: abierto** (sin cambio desde la ronda 10).

### [BAJO, abierto — nuevo] `compliance/page.tsx:37` repite el patrón que la propia ronda arregló en `tenant-api.ts`: desestructura `data` sin revisar `error`, y un bache de red se lee como "La solicitud no existe"

`d7b171f` arregló en `src/lib/auth/tenant-api.ts:58-63` exactamente este bug
(round 13, MEDIO: "sin revisar `error`, un bache de red se ve idéntico a 'ese
uuid no existe'"). El archivo nuevo de la misma ronda lo reintroduce:

```ts
// compliance/page.tsx:37
const { data: sol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
if (!sol?.tenant_id) return { error: 'La solicitud no existe.' };
```

**Escenario con valores:** el superadmin responde una solicitud; en el
`maybeSingle` hay un parpadeo de red → `data: null, error: {message: 'fetch
failed'}` → la página devuelve "La solicitud no existe." y la solicitud real
queda sin resolver, con un diagnóstico que apunta al lugar equivocado. El
arreglo correcto ya existe en el mismo repo (`tenant-api.ts:60-63`).

**Estado: abierto.** La pantalla además no tiene ni una prueba
(`grep -rn "listarSolicitudesArco\|resolverSolicitudArco" src --include="*.test.ts"` →
vacío).

### [BAJO, abierto — nuevo] `compliance/page.tsx:63,147`: el KPI "Vencen pronto (≤ 5 días hábiles)" cuenta días CALENDARIO

```ts
// compliance/page.tsx:147
filas.filter((f) => (f.vence_en as string) <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10))
```

`5 * 864e5` son cinco días de reloj, no hábiles. **Escenario:** viernes por la
tarde, una solicitud vence el miércoles siguiente (5 días calendario = 3
hábiles): el KPI la cuenta como "vence pronto" y el rótulo dice "días hábiles".
El resto del repo sí distingue hábiles (`venceArco`, `privacidad.ts:618` — el
mismo archivo que calcula `vence_en`). Cosmético (la pantalla de todos modos no
muestra nada, ver MEDIO #2) pero el rótulo miente.

**Estado: abierto.**

### [BAJO, abierto — reincidente ronda 14] `desde_db.ts:66` / `repo.ts:831`: la inyección en el filtro y el corte a 100,000 filas siguen

La lista vacía quedó cerrada (`repo.ts:831`: `claves?.length ? … :
'concepto.eq.diesel'`). Quedan dos puntas de la ronda 14:

1. **Inyección en el filtro.** `config.hidrocarburos.claves` solo se valida como
   "array no vacío de strings" (`0082/0083:226-234`), no como claves SAT de 8
   dígitos. Una clave con `,` o `)` entra interpolada a `clave_prod_serv.in.(${claves.join(',')})`
   y agrega valores/filtros que la config no declara. El alcance es limitado
   (la config la escribe el admin, no un atacante externo), pero el filtro
   resultante no es el que la config parece pedir.
2. **Corte a 100,000.** `repo.ts:812` (`MAX_PAGINAS = 100`) y `repo.ts:861`:
   un tenant con >100,000 cargas de combustible en el ejercicio lanza
   `LecturaIncompleta`. Ahora ese throw ya no tumba el cuadre (se traga en
   `desde_db.ts:80`) — pero alimenta el MEDIO #3: ceros → nota inventada.

**Estado: abierto** (parcialmente cerrado: la lista vacía sí).

### [BAJO, abierto — reincidente ronda 13/14] `startup.ts` sigue sin sondear las migraciones 0078/0079/0080/0081/0082/0083

Verificado: `grep -n "0078\|0079\|0080\|0081\|0082\|0083" src/lib/cuadra/startup.ts`
→ cero líneas. `startup.ts` sondea 0005, 0011, 0031, 0016, 0017, 0019/0024
(índices), 0036/0037 (triggers), 0033, 0022 — y ninguna de las seis
migraciones nuevas. La 0081 tiene bloque 56 en `verificaciones.sql` y la
0082/0083 están exentas con razón en `migraciones_verificadas.test.ts:54-55` —
pero el ARRANQUE no las conoce: si mañana se restaura una base sin el trío de
RLS (0078/0079), sin la 0081 o sin la 0082/0083, `startup.migraciones` sale
`ok:true` con los huecos abiertos, y el alta de flota con la declaración
revienta en el CHECK con un error que la línea de arranque no anticipó.

**Estado: abierto** (BAJO; era la recomendación #5 de la ronda 12, sin
implementar).

### [BAJO, abierto — reincidente ronda 13/14] `deploy-vercel.sh:65-69` sigue sugiriendo registrar el webhook contra la URL EFÍMERA y subir `maxDuration` a 120 cuando ya está en 120/300

```bash
# scripts/deploy-vercel.sh:65-69
── SIGUIENTE ──
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan: … Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
```

`$url` es el subdominio efímero del deployment recién creado, no el canónico
(`https://app.likida.ai/api/webhook/whatsapp`). El paso 2 quedó viejo: el
webhook ya está en `maxDuration = 120` (`route.ts:77`), los crons en
120/120/300, con el plan Pro verificado el 28-jul (`route.ts:62-71`).

**Estado: abierto** (cosmético).

### [BAJO, abierto — reincidente ronda 13/14] `FACTURAPI_SECRET_KEY` sigue solo en preview

`vercel env ls production` → no existe; `vercel env ls preview` →
`FACTURAPI_SECRET_KEY` (Encrypted, **1d ago**). `.env.local:48` la tiene con
valor. El código la lee (`src/lib/saas/facturapi.ts:37,46,52`). La asimetría
preview-timbra/producción-no es el estado esperado de degradación (factura
queda "cobrada sin timbrar"), pero es exactamente la que produce el "en el
preview sí facturaba" en el momento equivocado, y `runbook.test.ts` cruza
código↔documento, nunca Vercel↔Vercel.

**Estado: abierto.** La divergencia además se mantiene activa (re-creación a
las 24 h).

### [BAJO, abierto — reincidente ronda 10/12/13/14] La numeración de migraciones sigue con huecos (0066→0070)

`ls supabase/migrations/`: `0066` → `0070`, las `0067/0068/0069` nunca
existieron. Cosmético; el guardarraíl archivo↔base real sigue sin
implementarse.

**Estado: abierto** (cosmético).

### [BAJO, abierto — nuevo, DX] `src/lib/cuadra/cuadre/zzz-a15-probe.test.ts` — archivo de sonda SIN trackear que rompe `npx tsc --noEmit -p .`

`git status --short` → `?? src/lib/cuadra/cuadre/zzz-a15-probe.test.ts`. El
archivo (sonda de la ronda 15, presumiblemente del rubro fiscal) está en el
árbol de trabajo y rompe el gate del repo:

```
src/lib/cuadra/cuadre/zzz-a15-probe.test.ts(3,22): error TS2305: Module '"@/types/cuadra"' has no exported member 'PoliticaGasto'.
src/lib/cuadra/cuadre/zzz-a15-probe.test.ts(12,29): error TS2353: Object literal may only specify known properties, and 'viajeId' does not exist in type 'Gasto'.
```

Además usa `Math.random()` en los ids de los gastos (prueba no determinista en
la forma del id, aunque no en las aserciones) y `console.log` de sonda. No está
commiteado, así que el árbol commiteado compila; pero HOY, en el árbol de
trabajo, `npx tsc --noEmit -p .` falla — la primera verificación de CLAUDE.md.
Misma familia que el incidente de los `zzz-preview-*` que `sin_previews.test.ts`
documenta (el 4-ago llegaron a producción): la regla "se borra al terminar" no
funciona cuando el repo tiene varios agentes. La sonda P1 además confirma el
MEDIO #3 (nota "contra un tope de $0.00" con el contador caído).

**Estado: abierto** — borrarlo antes de cerrar la ronda; `tsc` debe volver a 0.

## Cierres de la ronda 14 — verificados

- **[MEDIO, cerrado en el código]** La barrida del ejercicio quedó en UNA:
  `desde_db.ts:78` reusa `getAcumuladoCombustible` (mismo criterio que la tool
  de periodo), y el caso de lista vacía quedó con fallback (`repo.ts:831`). El
  excedente es por comprobante (`engine.ts:311-333`, `previoSinEste` +
  `cupoRestante` — la suma de la columna cuadra con `totalNoDeducible`,
  verificado con la sonda P4: 3×$1,000 → suma $1,500 = noDed). El ancla del
  ejercicio es la fecha del viaje/comprobantes (`desde_db.ts:63-65`), no el
  reloj del proceso.
- **[MEDIO, cerrado]** El alta tri-estado: `administracion.ts:110-119` solo
  escribe `facilidadCombustibleEfectivo` cuando AMBAS son booleanos explícitos;
  casilla sin marcar = sin declarar (el motor cae en la rama "por confirmar",
  `engine.ts:340-345`). Verificado en el archivo actual.
- **[MEDIO, cerrado con `8a33ce1`]** La 0083 aplicada a la base real exige la
  FORMA de la llave (`0083_config_facilidad15_forma.sql:54-64`); el "sí" rebota
  (afirmación de la síntesis de la ronda 14; la base no se tocó en esta ronda).
- **[MEDIO ×2, cerrado]** El passcode muerto sigue fuera de los inventarios:
  `grep DASHBOARD .env.local` → vacío, `vercel env ls production/preview` → no
  aparecen, y `deploy-vercel.sh:48-49` los sigue saltando como cinturón.
- **[7 backend, cerrados en el código]** Verificados uno por uno en `d7b171f`:
  `tenant-api.ts:58-63` devuelve 503 con log ante error de lectura;
  `export/liquidaciones/route.ts:69` agrega `.order('id')` de desempate;
  `pendientes.ts:120-135` pagina con `traerTodo` + `conteo` y ordena por
  `fecha,id`; `processor.ts:2136-2140` avisa al chofer con `sendText` (importado
  en `processor.ts:56`) cuando el PDF no se entrega; `usuarios/nuevo/page.tsx:36-37`
  rechaza `superadmin`/`operador` en el POST; `meta/client.ts:315-322` corrige
  el comentario; `stripe/webhook/route.test.ts` (98 líneas, 5 pruebas) cubre
  firma, idempotencia y 500+reintento — las 5 pasan.
- **[BAJO, sin cambio]** `respaldo.sh` bloqueado, `startup.ts` sin sondear
  0078-0083, `deploy-vercel.sh:65-69`, `FACTURAPI_SECRET_KEY` solo en preview,
  hueco 0066→0070 — todos arriba como reincidentes.
- **[BAJO, falso positivo parcial]** El hallazgo de la ronda 14 sobre
  `desde_db.ts` (lista vacía) quedó cerrado por el cambio de `8a33ce1`; las
  otras dos puntas (inyección, paginación) siguen, y el fail-soft que se eligió
  en su lugar abrió el MEDIO #3 de esta ronda.

## Lo que revisé y está bien

- **El demo responde en vivo en el dominio canónico.** `curl` a
  `https://app.likida.ai/` → 200 (1.11 s), `/login` → 200, el aviso del tenant
  del demo → 200, y el webhook responde 403 al GET con token inválido. El
  deployment vigente sigue siendo `caae369` (Ready, 14:49:22, aliases
  `app.likida.ai`/`likida.ai`) — lo que la ronda 14 verificó sigue verificado.
- **Los crons fallan cerrado.** Las tres rutas devuelven 500 sin `CRON_SECRET`
  y 401 con bearer equivocado (`escalar/route.ts:35-39`, `purgar/route.ts:54-58`,
  `facturar/route.ts:248-254`); `CRON_SECRET` existe en producción (1d).
  `facturar` corta por reloj con `MARGEN_LOTE_MS = 150_000` (`route.ts:157`),
  deja lo que no entra `sinTiempo`, y el `for` de flotas envuelve cada
  `avisarPorFacturar` en try/catch (`route.ts:196-216`) — un throw de
  `traerTodo` no mata el lote.
- **Webhook con 200-antes-de-trabajar, pool de 5 y flush al final.** El
  `after()` único, `conPool`, `flushObservabilidad` al cierre (`route.ts:168-194`),
  `maxDuration = 120` con plan Pro verificado. Los acuses `failed` de Meta se
  loguean como `wa.no_entregado`.
- **Observabilidad encendida antes de sondear.** `instrumentation.ts` enciende
  Sentry ANTES de `verificarMigracionesCriticas`; `startup.observabilidad`
  grita si falta el DSN. Las envs del checklist del GUION (`SENTRY_DSN`,
  `DEMO_TENANT_ID`, `NEXT_PUBLIC_APP_URL`, `CUADRA_WHATSAPP_MSG_USD`) están en
  producción; `runbook.test.ts` (código↔documento) pasa.
- **Pruebas del bloque verdes.** 78/78 de observabilidad/arranque/logger/env
  (`observability`, `env.test.ts`, `logger.test.ts`, `startup_*`,
  `migraciones_verificadas`), 67/67 de engine/fiscal/repo_acumulado/stripe
  webhook, 40/40 de webhook whatsapp + aviso + barrera, 1/1
  `sin_previews.test.ts`. `npx eslint src/` → 0 errores, 19 warnings.
- **El seed sigue alineado con el GUION y la RFA 2.9 es inerte en los números
  del demo** (diésel precargado con `forma_pago = '03'`, `seed.sql:119`): la
  facilidad declarada no cambia el arco; la única diferencia sigue siendo la de
  política ($200). El `update` del config es idempotente (`jsonb_set` doble).
- **0083 coherente con su propósito.** La migración es la 0082 más la
  validación de FORMA (`0083:54-64`: las dos llaves booleanas y completas);
  `migraciones_verificadas.test.ts:54-55` exenta 0082/0083 con razón honesta, y
  la 0081 tiene el bloque 56 (POD del chofer en SU flota).

## Lo que no alcancé a revisar

- **La base real en sí** (prohibido consultarla): si la 0083 está aplicada de
  verdad, si la declaración del demo sigue en `tenant.config`, si el
  `tenant_id` del superadmin es nulo (determina si la pantalla ARCO muestra algo
  — ver MEDIO #2, escrito con ambos escenarios).
- **Ejecución real de los crons** y el estado de Meta (`dev_mode`, webhook
  registrado, plantillas).
- **Valores de las envs cifradas de Vercel** (verifiqué existencia, no
  contenido).
- **La suite completa (~3,155)**: otro auditor la corre; corrí las 186 de mis
  bloques + la sonda `zzz-a15-probe` (5/5 verde — pero rompe tsc, ver hallazgo).
- **El contenido fiscal de la RFA 2.9** (matriz, 15%, IEPS): es el rubro del
  auditor fiscal; yo solo verifiqué el impacto operativo (contador, seed,
  despliegue, pantallas).

## Veredicto

**Yellow light para el demo de mañana — el código de master no está en
producción, y lo que esta ronda estrenó tiene dos defectos que la ronda misma
no vio.**

Los 7 fixes de backend están bien hechos y verificados en código (503, export,
paginación, aviso al chofer, rol, comentario, test de Stripe); la RFA 2.9 quedó
con la barrida única y el alta tri-estado. Eso es real. Pero para la sala:

1. **Decide el estado del despliegue.** Producción sigue en `caae369`, ahora
   **19 commits** atrás, y la base tiene la 0082/0083 que el código desplegado
   no lee. La RFA 2.9, el ARCO y los 7 backend no están vivos. O se publica
   (`[deploy]` en el asunto, o Redeploy — la suite está verde salvo el archivo
   de sonda), o se va a la sala sabiendo que el 15% no se demuestra y que la
   declaración no está en `/admin/flotas`.
2. **No enseñes la pantalla ARCO.** La que `d7b171f` construyó es superadmin-only,
   para el superadmin diseñado siempre está vacía, y su mensaje de éxito afirma
   que el titular recibió una respuesta que ningún código envía. Es una deuda
   legal nueva, no un logro de la ronda.
3. **Borra `zzz-a15-probe.test.ts` antes de cerrar la ronda** — hoy `tsc
   --noEmit` falla por un archivo sin trackear, el mismo accidente que ya mandó
   previews a producción.
4. **NO restaures un backup viejo y corras `npm run seed`** — el guard de
   `seed.sh` sigue sin detectar el nivel que `seed.sql` exige (ahora la 0083).
   El camino que funciona contra la base actual sigue siendo
   `psql "$DATABASE_URL" -f supabase/seed.sql`.
5. **El respaldo sigue sin existir operativamente** (`supabase login` +
   `supabase link`), y la base que no se puede respaldar es ahora la que tiene
   la 0083. La deuda más vieja del rubro, con el costo más alto de la historia
   del repo.
6. **El contador del 15% que falla no puede afirmar números.** El best-effort
   de `desde_db.ts:80` alimenta a un motor que no distingue "cero medido" de
   "no se pudo medir" — y el PDF lo escribe como "el ejercicio lleva $X contra
   un tope de $0.00". Arreglar la rama "sin datos del ejercicio" que el
   comentario promete es condición para que la RFA 2.9 sea honesta el día que
   se despliegue.

**Yellow light: el código commiteado no rompió el camino del demo** (las 186
pruebas de mis bloques verdes, las superficies respondiendo 200, el seed
alineado con el GUION), pero el estado operativo empeoró respecto a la ronda 14
en los tres frentes que importan: producción más atrás, una pantalla nueva que
miente y un contador que inventa cifras cuando falla.
