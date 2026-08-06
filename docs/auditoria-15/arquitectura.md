# Arquitectura y mantenibilidad — auditoría 15

Ancla: commit `d7b171f` (HEAD, "fix(backend+legal): 7 hallazgos de backend de la ronda 13 + pantalla ARCO de cumplimiento (AUDITORÍA 14)");
árbol limpio salvo `docs/auditoria-15/`. Ronda anterior: `docs/auditoria-14/arquitectura.md`
(ancla `0fa305e`). El prompt pide auditar línea por línea tras la ronda 14 y sus fixes
(`8a33ce1` — RFA 2.9: excedente por comprobante, ejercicio desde comprobantes, superficies
con elegibilidad, IVA negado, tri-estado + edición, 0083, una sola barrida; `d7b171f` — 7
hallazgos de backend + pantalla ARCO + QStash). Verifico primero los cierres que la 14
declaró o dejó abiertos, luego los fixes nuevos, y luego lo que quedó y lo que se rompió.

**Nota: 5/10** (baja de 7). Razón: la ronda cerró de verdad tres deudas de la 14
(`resolverTenantApi` con 503, el tri-estado de la declaración con edición en consola, el
excedente POR COMPROBANTE) — pero la otra mitad del MEDIO fiscal de la 14, el escenario
EXACTO con valores que la 14 documentó (viaje de enero con ticket de diciembre), SIGUE
reproduciéndose en el motor real; el MEDIO de `[id]` (pierde `?rol=` con `?tenant=`) sigue
intacto; y la ronda introdujo DOS hallazgos ALTO de arquitectura: la pantalla ARCO de
cumplimiento (la bandera legal de esta ronda) es una pantalla muerta —su única audiencia
posible, el superadmin, tiene `tenant_id` NULL por diseño y la consulta devuelve `[[], 0]`
siempre, además de afirmar "el titular recibió su respuesta por WhatsApp" cuando no existe
ningún envío—, y el fallback best-effort a ceros de `desde_db.ts` convierte un bache de red
en un veredicto falso de NO DEDUCIBLE (el comentario promete "marca para revisar" y el motor
no tiene esa rama: verificado ejecutando el motor). Además, `getAcumuladoCombustible` (la
"una sola barrida" que reusa todo) se llama con DOS años distintos según el llamador
(`desde_db` ancla al viaje, `tools.ts` al reloj del proceso) — la divergencia que la 14 dijo
haber matado sigue viva, solo que mudada de criterio a año.

---

## Cierres de la ronda 14 — verificación línea por línea

### 1. `resolverTenantApi` traga el error de red (BAJO) — CIERRE VERIFICADO

`src/lib/auth/tenant-api.ts:56-63` ahora revisa `error` y devuelve `{ ok:false, status:503 }`:

```ts
const { data, error } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
if (error) {
  logger.error('tenant.api_pedido', { err: error.message });
  return { ok: false, status: 503, motivo: 'No se pudo verificar la flota pedida. Intenta de nuevo.' };
}
```

Y los dos exports manejan `!t.ok` con `t.motivo`/`t.status` (`api/export/liquidaciones/route.ts:31-32`,
`api/export/pdf/[id]/route.ts:55-56`). El escenario de la 14 —un parpadeo de red en el export de
CSV del superadmin con `?tenant=X`— ya no cae en silencio al tenant de la sesión: devuelve 503
y el usuario ve el motivo. **Estado: cerrado.**

### 2. RFA 2.9: el contador del ejercicio cuenta pagos de OTRO ejercicio (MEDIO) — CIERRE A MEDIAS, EL ESCENARIO DOCUMENTADO SIGUE REPRODUCIÉNDOSE

`8a33ce1` cambió el ancla del año: `desde_db.ts:63-65` ahora usa la fecha del viaje en vez del
reloj del proceso:

```ts
const anioEjercicio = String(
  (viaje.fechaInicio ?? gastos.find((g) => g.fecha)?.fecha ?? new Date().toISOString()).slice(0, 4),
);
```

Eso corrige el caso espejo que el commit describe ("una liquidación de diciembre cerrada en
enero declaraba todo el diésel NO deducible contra un tope de $0"). **PERO el escenario que la
ronda 14 documentó con valores era el otro lado de la frontera: un viaje que INICIA en enero
con un ticket del diciembre anterior, dentro de la tolerancia.** Lo verifiqué ejecutando el
motor real (scratch temporal, borrado):

```
viaje inicia 2-ene-2026; ticket diésel en efectivo $1,000 fechado 30-dic-2025
(fechaToleranciaDiasAntes=30; fechaDudosa lo marca solo 'otro_ejercicio', sin sacarlo).
anioEjercicio = 2026 (viaje.fechaInicio) → getAcumuladoCombustible(2026) NO cuenta el
ticket de 2025 → totalCombustibleEjercicio = 0; efectivoDeEsteViaje = $1,000 (sin filtro
de fecha, desde_db.ts:84-86); efectivoPrevEjercicio = max(0, 0−1000) = 0.
Motor (engine.ts:312-331): elegible===true, total=0 → tope=0 → cupoRestante=0 →
excedenteDeEste=1000 → efectivo_sobre_15 con el ticket ENTERO no deducible.
NOTA impresa: "el ejercicio lleva $1,000.00 de combustible en efectivo contra un tope de
$0.00 (15% de $0.00); el excedente de $1,000.00 de ESTE comprobante NO se deduce".
totalNoDeducible=1000, estatus=revisar.
```

El motivo real ("gasto de otro ejercicio") lo dice `fecha_sospechosa` en otra línea, pero la
cubeta de dinero es `efectivo_sobre_15` → NO DEDUCIBLE con la razón falsa del 15%. El contador
del 15% sigue sumando pagos de otro ejercicio contra el tope de este: el motor no filtra
`efectivoAcumuladoEjercicio` por el año del gasto (engine.ts:312 `efectivoAcumuladoEjercicio += g.monto`
sin mirar `g.fecha`), y `efectivoDeEsteViaje` (desde_db.ts:84-86) tampoco. La recomendación de la
14 ("sumar solo los pagos del ejercicio del gasto, o al menos excluir los de otro ejercicio del
acumulado") no se implementó; se cambió el ancla, que es otro bug. **Estado: abierto** — el
escenario con valores de la 14 se reproduce igual; el fix corrigió el caso espejo y dejó el
documentado intacto.

### 3. RFA 2.9: declaración PARCIAL se lee como "declaró que NO" (MEDIO) — CIERRE VERIFICADO (con una llave abierta)

- `administracion.ts:115-123`: `crearFlota` solo escribe la llave cuando AMBAS condiciones son
  `boolean` explícito; parcial → no escribe nada → el motor la lee "sin declarar" (por confirmar).
- `flotas/page.tsx:38-39`: alta tri-estado (`'on' ? true : undefined`); `:52-70` acción de
  edición `accionFacilidad` → `actualizarFacilidad15` (repo.ts:918-931) que también permite
  BORRAR la llave (volver a "sin declarar").
- `0083_config_facilidad15_forma.sql`: la base exige la forma (ambas booleanos o ausente); el
  "sí" rebota. Verificado en `supabase/migrations/0083_config_facilidad15_forma.sql:39-58`.
- `desde_db.ts:56-58` sigue evaluando `regimenElegible !== undefined` — con `null` eso es
  `true`, así que una fila pre-existente con `{dedicacionExclusivaCarga:true, regimenElegible:null}`
  (escrita antes del fix) TODAVÍA se lee como "declaró que NO". El fix cierra el alta y da
  edición, pero NO barre las filas ya parciales en la base real; la 0083 no las migra (solo
  redefine el validador). El seed del demo declara ambas `true`, así que el demo no se toca.

**Estado: cerrado para el alta nueva y con edición; abierto el barrido de filas parciales
pre-existentes** (riesgo bajo en la práctica — ninguna flota real las tiene, pero la filosofía
0026 "una llave presente no viene en null" sigue sin hacerse cumplir en datos ya escritos).

### 4. round2 sigue a medias y el guard sigue ciego a la expresión (MEDIO) — SIN MOVIMIENTO (quinta ronda)

`src/lib/cuadra/crear_viaje_wa.ts:302` sigue siendo la única copia inline:

```ts
const valor = Math.round(base * factor * 100) / 100;
```

El guard de `formato.test.ts:158-159` sigue greppeando solo el NOMBRE
(`function round2\|const round2\s*=`), y el guard de la EXPRESIÓN (`e85422c`) sigue sin ser
ancestro de HEAD (`git merge-base --is-ancestor e85422c HEAD` → NO). Quinta ronda con el
mismo hallazgo. **Estado: abierto** (reincidente 12/13/14/15).

### 5. La matriz de permisos TS↔SQL sigue sin guardarraíl (MEDIO) — SIN MOVIMIENTO

`ve_finanzas`, `administra_flota`, `is_operador` siguen apareciendo solo en comentarios de
tests (`visibilidad.test.ts:111`). Nada sincroniza los dos runtimes. **Estado: abierto**
(MEDIO de la 12, sin fix reclamado en la 13, 14 ni 15).

### 6. `efectivo_no_elegible` interrumpe al jefe (BAJO) — SIN MOVIMIENTO

`cierre_aviso.ts:144` sigue mapeando `efectivo_no_elegible: 'decision'` — el canal que
interrumpe al jefe por WhatsApp para una decisión que el jefe ya tomó al registrar la flota
(y que desde esta ronda SÍ se puede editar, pero no se le pide decidir por viaje). **Estado:
abierto** (juicio de producto, igual que en la 14).

### 7. Comentario obsoleto del chat + badge (BAJO) — SIN MOVIMIENTO

- `chat/page.tsx:36` sigue diciendo "su ruta está clasificada como `operacion`" cuando
  `visibilidad.ts:75` la clasifica `dinero` desde `de6416f`. Comentario que miente a un
  lector futuro sobre el propio gate que está leyendo.
- `[id]/page.tsx:162-164`: con `?tenant=X&rol=contador`, `volverQS` es truthy → badge "viendo
  como superadmin" mientras la página pinta la vista del CONTADOR. El rótulo describe la
  sesión, no lo que se ve.

**Estado: abierto** (los dos).

### 8. Observación: la reconstrucción depende del estado global del ejercicio — PARCIALMENTE ATENDIDA

`8a33ce1` eliminó la consulta duplicada en `desde_db` (ahora reusa `getAcumuladoCombustible`),
lo que es bueno. Pero la observación de fondo (la cubeta de UNA liquidación cerrada se
recalcula con el contador del ejercicio del MOMENTO, y `reconstruir` en `analytics.ts` paga el
agregado del año por vista) sigue vigente, y se le añadió una arista nueva: el ancla del año
difiere según el llamador (ver hallazgo MEDIO nuevo abajo). **Estado: abierto** (observación).

### 9. Observación: frontera saas↔cuadra — SIN CAMBIOS; QStash agregado pero sin uso

Cero `import ... from '@/app/...'` en `src/lib/*` (verificado por grep), cero ciclos nuevos,
`admin/negocio.ts` sigue siendo la única función cross-tenant. `@upstash/qstash` se agregó a
`package.json` (d7b171f) pero **no hay ni un import en `src/`**: la dependencia vive instalada
sin código que la llame. El commit lo declara ("el offload completo se deja para después del
demo") — honesto, pero una dependencia muerta en el manifiesto. **Estado: abierto** (observación).

---

## Hallazgos de código (nuevos de esta ronda y re-verificados)

### [ALTO] La pantalla ARCO de cumplimiento es una pantalla MUERTA para su única audiencia — y el EstadoVacio miente en la dirección que la ronda dijo haber matado

`src/app/admin/compliance/page.tsx:135-151`:

```ts
async function datosDeCompliance() {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s?.tenantId) return [[], 0];
  const [solicitudes, pendientes] = await Promise.all([
    listarSolicitudesArco(s.tenantId).catch(() => []),
    ...
```

`app_user.tenant_id` de un superadmin es `null` POR DISEÑO (0001: "null = superadmin"), y el
layout de `/admin` gatea con `requireSuperadmin()` (`admin/layout.tsx:17`). El ÚNICO rol que
puede abrir `/admin/compliance` es el superadmin, y para él `s.tenantId` es SIEMPRE `null` →
`datosDeCompliance` devuelve `[[], 0]` SIEMPRE. La página pinta "Ninguna solicitud ARCO
registrada" y KPIs en 0 aunque la base tenga solicitudes reales (el webhook las registra en
`processor.ts:157`).

**Escenario con valores**: el operador escribe PRIVACIDAD por WhatsApp → `registrarSolicitudArco`
inserta la fila bajo el tenant `11111111-…` (el demo). Javier (superadmin) abre
`/admin/compliance` → `getSessionTenant()` → `tenantId: null` → `return [[], 0]` → la pantalla
dice "Ninguna solicitud ARCO registrada" y "0 por responder", con la solicitud REAL sentada en
la base. Es exactamente la mentira del "no hay nada" que la ronda 14 celebró haber matado en
este mismo archivo ("el EstadoVacio ya no miente") — la pantalla de cumplimiento legal, la
bandera de esta ronda, está ciega por construcción y nadie la probó. La acción `accionResolver`
sí resuelve bien el tenant de la solicitud por id (`:37`), pero es inalcanzable: no hay filas
que listar.

Además, la resolución que la flota escribe **nunca llega al titular**: `resolverSolicitudArco`
(repo.ts:969-975) solo hace un `UPDATE` a la base, y el mensaje de éxito en `:45` afirma "El
titular recibió su respuesta por WhatsApp" — **no existe ningún envío de WhatsApp en esa ruta**
(verificado por grep: cero `sendText`/`sendTemplate` en el camino de resolución). La pantalla
le promete al jefe de la flota que cumplió un derecho ARCO (20 días hábiles, LFPDPPP art. 32)
cuando el titular no recibe nada.

**Estado: abierto** (nuevo). Candidato a fix: `requireSessionTenant` (con fallback al demo) o
`?tenant=` explícito, y o quitar el mensaje de envío o implementar el envío.

### [ALTO] El fallback best-effort a ceros de `desde_db.ts` convierte un bache de red en NO DEDUCIBLE con razón falsa — el comentario promete fail-closed y el motor no tiene esa rama

`src/lib/cuadra/cuadre/desde_db.ts:76-81`:

```ts
let totalesEjercicio = { efectivo: 0, totalCombustible: 0 };
try {
  totalesEjercicio = await getAcumuladoCombustible(tenantId, Number(anioEjercicio), clavesCombustible);
} catch (e) {
  logger.warn('desde_db.contador_15_no_disponible', { tenant: tenantId, err: ... });
}
```

El comentario de `:71-75` dice: "el motor recibe ceros y la rama 'sin datos del ejercicio'
marca el efectivo para revisar, que es el fail-cerrado honesto". **Esa rama NO existe en el
motor.** Con `totalCombustibleEjercicio = 0` y `facilidad15 = true`, el motor entra a la rama
`elegible === true` (engine.ts:308), `tope = 0.15 * 0 = 0`, y TODO el efectivo-combustible del
viaje sale `efectivo_sobre_15` → NO DEDUCIBLE, con la nota "contra un tope de $0.00".

**Escenario con valores (verificado ejecutando el motor real)**: `getAcumuladoCombustible`
falla por un parpadeo de red (o por superar las 100 páginas de `MAX_PAGINAS`, o por el propio
bug del hallazgo MEDIO anterior) → `desde_db` sigue con `{efectivo:0, totalCombustible:0}` →
un viaje con un ticket de diésel en efectivo de $1,000 con CFDI válido y RFC válido sale:
`totalNoDeducible = 1000`, diferencia `efectivo_sobre_15(1000)`, estatus `revisar`. El sistema
AFIRMA que el ticket no es deducible porque "el ejercicio lleva $1,000.00 contra un tope de
$0.00" — un veredicto de dinero fabricado a partir de un error de red. Antes de la RFA 2.9 ese
ticket caía en `combustible_efectivo` (por confirmar); el fail-closed honesto habría sido
devolver el acumulado como `undefined`/fallo y que el motor pusiera `combustible_efectivo`
(por confirmar, como dice el comentario), no ceros que el motor lee como "tope de $0".

El mismo patrón de ceros-falsos vive en el caso legítimo de frontera de año (hallazgo MEDIO
re-abierto arriba): no hace falta ni un bache de red; basta un ticket de diciembre en un viaje
de enero para que el motor reciba `total=0` por el filtro de año y produzca el mismo veredicto
falso.

**Estado: abierto** (nuevo, ALTO).

### [MEDIO] `tools.ts` y `desde_db.ts` llaman `getAcumuladoCombustible` con años DISTINTOS — la "una sola barrida" que la 14 declaró sigue siendo dos criterios

`desde_db.ts:63-65` ancla el año al viaje; `tools.ts:104` sigue usando el reloj:

```ts
const ejercicio = new Date().getUTCFullYear();
const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

**Escenario con valores**: el 5-ene-2027 se cuadra un viaje que inició el 28-dic-2026. El motor
(`desde_db`) evalúa el 15% contra el acumulado de 2026; el agente (`tools.ts`) le dice al jefe
"el ejercicio 2027 lleva $X de los $Y" con el acumulado de 2027 — el aviso del chat contradice
al PDF de la liquidación que se está cerrando, con el mismo tipo de divergencia de criterios
que `8a33ce1` dijo haber matado ("una sola barrida, no dos consultas duplicadas con criterios
que podían divergir"). La barrida es una sola; el criterio de qué año, dos. **Estado: abierto**
(nuevo, MEDIO).

### [MEDIO] `[id]` pierde el `?rol=` de la previsualización en la vuelta con `?tenant=` — RE-VERIFICADO, INTACTO

`src/app/dashboard/[id]/page.tsx:63-66` y `:79-84` (idénticos a la ronda 14):

```ts
if (rolReal === 'superadmin' && sp?.tenant) {
  tenantId = await resolverTenantPedido(...);
  volverQS = `?tenant=${tenantId}`;          // ← se cae el rol
}
...
if (!volverQS) { ... }                        // ← nunca corre cuando hay tenant
```

**Escenario con valores** (verificado que sigue pasando): `/admin/flotas` → "Ver dashboard" con
`?tenant=X&rol=contador` (`flotas/page.tsx:131`); el detalle arma `volverQS='?tenant=X'` y el
"← Panel" (`:162`) cae a `/dashboard?tenant=X` — el rol efectivo se apaga a media navegación.
**Estado: abierto** (tercera ronda; la mitad de render de `b286aa8` sigue, la mitad de vuelta no).

### [BAJO] KPI "Vencen pronto (≤ 5 días hábiles)" compara 5 días CALENDARIO contra un vencimiento de días HÁBILES

`compliance/page.tsx:147`:

```ts
return filas.filter((f) => (f.vence_en as string) <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)).length;
```

`vence_en` lo calcula `venceArco` en días HÁBILES (`privacidad.ts:618`), y el rótulo dice "≤ 5
días hábiles", pero la comparación suma 5×86,400 s = 5 días calendario. Un lunes, una solicitud
que vence el viernes (5 días hábiles = 7 calendarios) no aparece en "Vencen pronto". **Estado:
abierto** (nuevo, BAJO).

### [BAJO] Dependencia muerta: `@upstash/qstash` en `package.json` sin un solo import

`package.json` (d7b171f) agrega `@upstash/qstash`; `grep -rn "@upstash/qstash" src/` → cero
coincidencias. El offload se dejó documentado para después del demo; la dependencia debería
esperar en una rama, no en el manifiesto de producción, para no acumular peso y superficie de
ataque sin código que la use. **Estado: abierto** (BAJO).

---

## Lo que revisé y está bien

- **`resolverTenantApi` (BAJO 14) cerrado de verdad**: 503 con motivo, ambos exports lo manejan,
  y el `resolverTenantPedido` de páginas distingue "uuid inexistente" (fallback) de "no pude
  preguntar" (throw) — la doctrina de la 12 intacta en los dos lados.
- **Tri-estado + edición de la declaración**: `administracion.ts:115-123`, `flotas/page.tsx:38-39`
  y `:52-70`, `actualizarFacilidad15` en repo.ts, y la 0083 exigiéndole la forma a la base.
  Con una sola casilla marcada la flota nace "sin declarar", no "no elegible".
- **Excedente POR COMPROBANTE**: `engine.ts:305-335` con `cupoRestante`/`dentro`/`excedenteDeEste`
  — la suma de la columna cuadra con `totalNoDeducible` (verificado: 3×$1,000 contra tope
  $1,500 → suma $1,500, nunca $2,000+); la prueba nueva (`engine.test.ts:1455-1468`) lo fija.
- **Estatus honesto para no deducible**: `engine.ts:1133` agrega `efectivo_sobre_15` y
  `efectivo_no_elegible` a REVISAR — un viaje con efectivo no deducible ya no sale `cuadrada`.
- **Superficies con la elegibilidad**: `fiscal.ts:337` (`elegible15`), `aviso.ts:28-34`
  (aviso para no elegible / sin declarar), `comun.tsx:128-138`, `tools.ts:110-115` — el panel,
  el aviso y el chat ya no ofrecen la válvula del 15% a flotas que el motor declara no
  elegibles. La prueba de `fiscal.test.ts` se actualizó con `elegible15: true`.
- **`getAcumuladoCombustible` bien paginado** (`repo.ts:690-780`): `count exact` en la primera
  página, `order('fecha,id')` saliendo del índice de la 0023, `MAX_PAGINAS` con corte y throw
  (fail-loud) — la única barrida del ejercicio, bien construida; el problema es quién la llama
  con qué año (ver MEDIO arriba), no la función.
- **Pruebas del rubro**: `tsc --noEmit` limpio, `eslint src/` 0 errores (1 warning: import
  muerto `supabaseAdmin` en `desde_db.ts:9` tras la refactorización de la 14), y verdes
  `engine` (114), `visibilidad` (89), `tenant-efectivo` (45), `session` (16), `guard` (20),
  `formato` (21), `permisos`, `fiscal` (57), `aviso` (6), `cierre_aviso` (30),
  `repo_acumulado` (5), `migraciones_verificadas` (4), `crear_viaje_wa` (77), `analytics` (34)
  y el route-test del webhook de Stripe (5).
- **El webhook de Stripe por fin tiene route-test** (`api/stripe/webhook/route.test.ts`, 5
  casos: sin secreto 503, firma inválida 401, nuevo aplica, repetido no aplica, fallo → 500
  con desmarcado). La prueba del desmarcado es indirecta (no assertúa la llamada), pero la
  cubre el 500 con reintento.
- **ARCO en repo**: `registrarSolicitudArco` best-effort con rastro ruidoso, `listarSolicitudesArco`
  con `traerTodo` paginado, `resolverSolicitudArco` acotado por tenant. La capa de datos está
  bien; lo roto es la pantalla (ALTO de arriba).

## Lo que no alcancé a revisar

- La suite completa (3,155 según los commits; otro auditor la corre) y `npm run build`.
- La base real (us-east-2): no pude confirmar en vivo que la 0083 esté aplicada, que no existan
  filas parciales de la 0082, ni el estado de `solicitud_arco` — lo tomo del contexto del prompt.
- El flujo del demo con la pantalla ARCO: si el guion la muestra, se va a ver vacía con la
  solicitud real en la base (el ALTO de la pantalla muerta).
- Las ~31 páginas de `/dashboard` una por una contra su área declarada.

## Veredicto

**5/10 — sin luz verde.** En positivo: tres deudas reales de la 14 cerradas con prueba
(resolverTenantApi, tri-estado + edición, excedente por comprobante), y la consistencia
superficial de la RFA 2.9 mejoró (panel, aviso, chat, estatus). En negativo: (a) la otra mitad
del MEDIO fiscal de la 14 —el escenario exacto con valores, viaje de enero con ticket de
diciembre— sigue reproduciéndose en el motor real que ejecuté; (b) la bandera de esta ronda,
la pantalla ARCO de cumplimiento, es una pantalla muerta para su única audiencia (superadmin
con `tenant_id` NULL) y además afirma un envío por WhatsApp que no existe — el "EstadoVacio ya
no miente" de la 14 quedó desmentido por la propia ronda que lo presumió; (c) el fallback
best-effort a ceros fabrica un veredicto de NO DEDUCIBLE con razón falsa ante un bache de red,
exactamente la dirección de daño que la regla "nunca inventar una cifra" prohíbe, y el
comentario del código promete un fail-closed que el motor no implementa; y (d) los tres
pendientes estructurales (round2 quinta ronda, matriz TS↔SQL, `[id]` con `?rol=`) siguen
intactos, más la divergencia nueva de año entre `desde_db` y `tools.ts`. Cada fix de la 14
llegó con prueba — eso es nuevo y bueno — pero la ronda entregó dos pantallas/decisores que
mienten, y eso pesa más.
