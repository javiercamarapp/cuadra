# Arquitectura y mantenibilidad — auditoría 13

Ancla: commit `caae369` (release de la ronda 12, HEAD actual; árbol limpio salvo
`docs/auditoria-13/` sin commitear). Ronda anterior: `docs/auditoria-12/arquitectura.md`
(ancla `8fc7e79`). El prompt de esta ronda pide auditar capas, deuda, la matriz de
permisos en dos archivos, `round2`, y **verificar los cierres de la 12** — la
re-auditoría de la 12 declaró "Arquitectura 7 → 8: round2 unificado". Ese es el
cierre que se verifica primero.

**Nota: 7/10** (sin cambio vs la 12, que también cerró en 7 con la re-auditoría
diciendo 8). Razón del movimiento: el cierre que la re-auditoría de la 12 presumió
—"round2 unificado"— **está incompleto**: el commit `3267a8a` arregló 2 de los 3
sitios que su propio reporte listaba, y el tercero (`crear_viaje_wa.ts:302`) sigue
redondeando con la expresión vieja; el guardarraíl de la ronda 10 que greppea la
EXPRESIÓN (`e85422c`) sigue sin estar en master, y el guard actual sigue
greppeando solo el nombre. El mismo patrón exacto que este rubro ya dejó pasar
entre la ronda 10 y la 12 vuelve a repetirse. A la vez, la matriz de permisos
TS↔SQL sigue sin guardarraíl (MEDIO abierto de la 12) y aparecieron DOS
inconsistencias nuevas dentro de la capa TS: la ruta `/dashboard/chat`
clasificada `operacion` con la página gateando `dinero` (el link del sidebar del
encargado muere en un recuadro "no puedes"), y `[id]/page.tsx` —la única página
de datos que no pasa por `resolverTenantEfectivo`— que rompe la previsualización
"ver como contador" enseñando y ejecutando acciones de superadmin. Lo que sí está
sólido: las capas no tienen ciclos ni importaciones lib→app, siguen en cero las
escrituras por cliente de sesión (el supuesto que sostiene toda la familia RLS),
y el perímetro de `repo.ts` se estabilizó (88% fuera vs 90% en la 12).

---

## Cierres de la ronda 12 — verificación línea por línea

### 1. "round2 unificado" (`3267a8a`) — CIERRE INCOMPLETO

El commit toca dos archivos:

```
 src/lib/cuadra/liquidacion/omitidos.ts | 3 ++-
 src/lib/cuadra/repo.ts                 | 3 ++-
```

Verificado en HEAD:
- `repo.ts:858` → `return { efectivo: round2(efectivo), totalCombustible: round2(totalCombustible) };` ✅
- `omitidos.ts:38` → `monto: round2(monto),` ✅
- **`crear_viaje_wa.ts:302` → `const valor = Math.round(base * factor * 100) / 100;` ❌ NO SE TOCÓ.**

El reporte de la ronda 12 listó **tres** sitios: "`repo.ts:841`, `omitidos.ts:37` y
`crear_viaje_wa.ts:302`". El fix dice "Dos copias más" — se le escapó la tercera,
que era la del anticipo parseado del WhatsApp. El guard actual
(`src/lib/formato.test.ts:158-159`) solo greppea `function round2\|const round2 =`
— que el sitio inline pasa porque no bautiza la función. El guardarraíl de la
ronda 10 que greppea la EXPRESIÓN (`e85422c`, "el guard de round2 vigila la
expresión, no el nombre") **sigue sin ser ancestro de HEAD**: vive únicamente en
`origin/claude/auditoria-10`, igual que en la ronda 12.

**Análisis honesto del impacto de dinero** (para no inflar): lo comprobé con node
sobre TODA la gramática alcanzable del parser (`base` con ≤2 decimales × factor
∈ {1, 1000, 1e6} — 30,003 combinaciones): `Math.round(x*100)/100` y `round2(x)`
coinciden en **0** casos. El caso que rompe la expresión (`1.005`) es inalcanzable
desde el regex `^\d+(?:\.\d{1,2})?$` de `crear_viaje_wa.ts:291`. El impacto de
dinero de ESTA línea es nulo hoy. El impacto arquitectónico es el de siempre:
el cierre quedó a medias, el guard no detecta la expresión, y la próxima copia en
un módulo donde la gramática SÍ alcance el medio-centavo (como los cuatro
originales de la ronda 9) volverá a pasar sin que ninguna prueba falle.

**Estado: abierto** (cierre parcial de la 12).

### 2. Matriz de permisos en dos archivos (TS + SQL) — sigue abierto

La re-auditoría de la 12 NO lo declaró cerrado (solo "round2 unificado"), y sigue
igual de abierto. Verificado en HEAD:
- TS: `visibilidad.ts:36-44` (`AREAS_POR_ROL`) y `permisos.ts:17-19`
  (`EXPORTA`/`ASIGNA`/`ADMINISTRA`).
- SQL: `0048:47-55` (`ve_finanzas()`: `rol in ('superadmin','flota_admin','contador')`),
  `0050:25-33` (`administra_flota()`: `rol in ('superadmin','flota_admin')`),
  `0045:26-29` (`is_operador()`: `rol = 'operador'`).
- Los valores coinciden HOY (verifiqué los tres contra las listas TS).
- **Sigue sin existir ninguna prueba que sincronice TS↔SQL**: busqué
  `ve_finanzas`, `administra_flota`, `is_operador` en todos los `*.test.ts` — solo
  comentarios (`session.test.ts:64`, `visibilidad.test.ts:111`). El día que
  alguien agregue un rol a `AREAS_POR_ROL.dinero` o a `ADMINISTRA` y no toque la
  migración, la UI pintará un panel que PostgREST devuelve vacío (o al revés),
  sin que ninguna prueba falle. Es la misma clase de duplicación que este repo ya
  quemó tres rondas en cazar para `mxn()`/`round2()`, pero en dos runtimes.

**Estado: abierto** (MEDIO de la 12 sin fix reclamado).

### 3. Perímetro de `repo.ts` y patrones copiados — sin cambio de decisión

Repetí la métrica (`.from('`/`.rpc('` con literal, sin tests):

```
ronda 10: repo.ts 26 · fuera 135 · total 161 · 84% fuera
ronda 12: repo.ts 26 · fuera 244 · total 270 · 90% fuera
ronda 13: repo.ts 28 · fuera 210 · total 238 · 88% fuera
```

La tendencia se estabilizó (la 12 consolidó consultas: paginado del export,
`traerTodo` en más lados), pero la pregunta del rubro —"¿dónde se lee/escribe una
liquidación?"— sigue sin una sola respuesta: `operacion.ts` (33), `analytics.ts`
(23), `suscripcion.ts` (16), `conv.ts` (14), `comercial.ts` (12)… y 4 consultas
directas desde páginas (`usuarios/page.tsx:23` a `app_user`,
`suscripcion/page.tsx:93` a `app_user`, `politicas/page.tsx:66` a `tenant`,
`cuadre/page.tsx:22`). La decisión ESCRITA de cuándo un módulo es satélite sigue
sin existir.

Los patrones copiados tampoco se movieron: `async function safe<` en **23
archivos**, `tenantDelAction`/`tenantYUsuarioDelAction` en **6 páginas**
(unidades, pod, incidencias, suscripcion, despacho, combustible-casetas), el
bloque `s.rol === 'superadmin' && sp?.tenant` en **10 archivos** (12 call sites
de `resolverTenantPedido`), y `[id]/page.tsx` sigue sin usar
`resolverTenantEfectivo`. Ver hallazgo MEDIO 4 — la omisión dejó de ser solo
estética.

---

## Hallazgos de código

### [MEDIO] El cierre de `round2` quedó a medias y el guard sigue ciego a la expresión

`src/lib/cuadra/crear_viaje_wa.ts:302`:

```ts
const valor = Math.round(base * factor * 100) / 100;
```

Sigue siendo la única copia inline de redondeo de dinero del repo (verificado por
grep: es el único `Math.round(...* 100) / 100` sobre dinero que queda). El guard
de `formato.test.ts:158-159` solo busca el NOMBRE `round2`; el guard de la
expresión (`e85422c`) sigue en `origin/claude/auditoria-10`, sin mergear
(verificado con `git merge-base --is-ancestor`). **Escenario:** alguien copia la
expresión en un módulo nuevo donde la entrada SÍ puede ser `1.005` (los cuatro
sitios originales de la ronda 9 lo eran) y el acumulado de efectivo que alimenta
el tope RFA 2026 2.9 vuelve a redondear un centavo abajo — exactamente el bug que
la ronda 9 marcó ALTO REINCIDENTE. Ninguna prueba falla: el guard nunca miró la
expresión. **Estado: abierto** (la 12 lo declaró cerrado; no lo está).

### [MEDIO] La matriz de permisos TS↔SQL sigue sin guardarraíl de sincronía

Detalle completo en "Cierres" punto 2. Aquí el escenario con valores: si el
producto decide "el encargado también ve el panel fiscal" y alguien edita solo
`visibilidad.ts:41-44` (`encargado: ['operacion', 'dinero']`), el sidebar y
`resolverTenantEfectivo` pintarán `/dashboard/contador/*` para el encargado y
PostgREST le devolverá **cero filas** (la RLS de la 0048/0049/0051/0052 lo excluye
vía `ve_finanzas()`): el panel afirma "sin datos" sobre datos que sí existen — la
mentira del "no hay nada" que este repo persigue desde la ronda 5, en la otra
dirección. O al revés: se abre la RLS y la UI no lo enseña. Ninguna prueba
falla. **Estado: abierto.**

### [MEDIO] `/dashboard/chat` está clasificado `operacion` pero la página gatea `dinero` — el link del encargado muere solo

La ruta está en el mapa como operación (`visibilidad.ts:75`:
`'/dashboard/chat': 'operacion'`), la página está en la sección INICIO del
sidebar (`rutas.ts:19`: "Chatea con tus Datos"), y el sidebar filtra con
`puedeVerRuta` (`sidebar-nav.tsx:94`) — así que **el encargado ve el link**. Pero
la página gatea dinero ANTES de consultar (`chat/page.tsx:47`:
`if (!puedeVerArea(rol, 'dinero'))`) y le devuelve un recuadro "Este chat
responde sobre dinero… pídeselo a quien lleva la contabilidad".

El propio comentario de la página lo dice: "su ruta está clasificada como
`operacion`, así que el ENCARGADO entraba por el link de su propio sidebar" — se
parcheó la página (el "gemelo sin parchar" de la ronda 12) y **no se
reclasificó la ruta**. Resultado hoy: el encargado de Transportes Innovativos (si
se le demuestra el panel) ve "Chatea con tus Datos" en su menú, hace clic y cae
en una pantalla que le dice que no puede. No es fuga (el gate es previo a la
consulta), pero es una contradicción viva de la matriz de permisos — la misma
familia que este rubro lleva dos rondas señalando— y **ninguna prueba la cubre**
(busqué `chat` en `visibilidad.test.ts`: no aparece). El mapa de rutas debió
decir `dinero` cuando se parcheó la página. **Estado: abierto** (nuevo).

### [MEDIO] `[id]/page.tsx` ignora `rolEfectivo` — la previsualización "ver como" enseña y EJECUTA acciones de superadmin

La página de detalle es la única de datos del dashboard que no pasa por
`resolverTenantEfectivo`: resuelve a mano con `requireSessionTenant`
(`[id]/page.tsx:40,96,123`) y gatea con el rol REAL, no el efectivo. Consecuencia
concreta, con valores:

1. Javier previsualiza al contador: `/dashboard/cuadre?rol=contador` (cuadre es
   `dinero`, el contador llega; `sufijoTenant` arrastra `?rol=contador` al link de
   detalle, `cuadre/page.tsx:196`).
2. El clic aterriza en `/dashboard/<id>?rol=contador`. La página resuelve con
   `requireSessionTenant` → `rol = 'superadmin'` (el real). El gate de la línea 46
   (`puedeVerArea(rol, 'dinero')`) pasa.
3. `puedeReasignar = puedeAsignar('superadmin')` → **true** → se pinta el
   formulario "Reasignar operador" que un contador jamás ve. `puedeReabrir =
   puedeAdministrar('superadmin') && estatus === 'liquidado'` → **true** para una
   liquidación cerrada → se pinta "Reabrir" (acción destructiva: borra la
   liquidación y el PDF, `reabrirViaje`).
4. Y no es solo pintura: el server action re-chequea con el rol REAL
   (`[id]/page.tsx:96,123`) — superadmin — así que el clic en "Reasignar" **se
   ejecuta**. La previsualización no es un rol limitado; es la sesión real con
   ojos de contador y botones de dueño.

Además, en el camino de vuelta: si el superadmin llegó con `?tenant=X&rol=contador`
(el demo cruza flota real + previsualización), `volverQS` se arma en la línea 59
como `?tenant=X` **sin `rol`** (el `if (!volverQS)` de la 72 no entra), mientras
`sufijoTenant` sí arrastra `rol` — el "← Panel" (línea 155) apaga la
previsualización a media navegación: Javier vuelve a cuadre con sus propios ojos
de superadmin, sin cinta. Es la "cadena rota" que la ronda 12 arregló para
`?vista=demo` en esta misma página, repitiéndose para la combinación
`?tenant=` + `?rol=`.

La ronda 12 lo listó como BAJO de patrón copiado; el escenario con valores lo
sube a MEDIO porque es parte del camino de demo (Javier previsualiza roles) y la
falla no es solo visual: ejecuta una acción que el rol previsualizado no podría.

### [BAJO] `resolverTenantApi` sigue tragándose el error de red del `?tenant=` en los exports

`src/lib/auth/tenant-api.ts:56-63`:

```ts
const pedido = new URL(url).searchParams.get('tenant');
if (pedido && s.rol === 'superadmin') {
  const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
  if (data) tenantId = data.id as string;
}
```

No mira `error`. La ronda 12 (`8ced786`) arregló los ~14 sitios de páginas con
`resolverTenantPedido` (fail-loud ante error de red, fallback silencioso solo ante
uuid inexistente), pero los dos exports siguen usando este helper
(`api/export/liquidaciones/route.ts:23`, `api/export/pdf/[id]/route.ts:39`).
**Escenario:** un superadmin exporta el CSV de la flota X con `?tenant=X`; en el
instante de la verificación hay un parpadeo de red → `data` null → cae en
silencio al tenant de la sesión (la demo) → el CSV sale con las liquidaciones de
la flota equivocada, sin aviso. Es lectura, no escritura (el daño es integridad
del archivo, no fuga), y requiere que la red falle justo en ese milisegundo —
pero es exactamente la clase de fallo que la 12 acaba de cerrar del lado de
escritura y que este lado dejó con la filosofía vieja. El docstring lo justifica
("un enlace viejo no debe fallar"), pero el error de red no es un enlace viejo:
es el caso que `resolverTenantPedido` distingue a propósito.

### [Observación] Capas: sin ciclos y sin lib→app, pero con una frontera `saas`↔`cuadra` borrosa

Verifiqué la dirección de dependencias en producción (excluyendo tests):
- Cero `import ... from '@/app/...'` en `src/lib/*` (solo tests lo hacen).
- Cero `src/lib/cuadra` → `src/lib/admin` (la única mención de `admin/negocio` en
  `analytics.ts:160` es un comentario).
- `lib/admin/negocio.ts` solo lo importan páginas de `/admin` — ninguna de
  `/dashboard` (el permiso cross-tenant sigue acotado).
- Sin ciclo cuadra↔saas: `cuadra/facturacion/flota_fiscal.ts:2` importa
  `saas/fiscal`, y `saas/fiscal.ts:2` importa `cuadra/intake/cfdi` — es un DAG,
  pero la frontera "saas = cobro de Likida" se desdibuja: `saas/fiscal.ts` es en
  realidad "los datos fiscales del RECEPTOR (la flota)", que el dominio cuadra
  necesita para su facturación. El nombre del folder promete una cosa y guarda
  otra; no rompe nada hoy, pero es el tipo de frontera que envejece mal.

---

## Lo que revisé y está bien

- **El cierre de los 2 de 3 sitios de round2**: `repo.ts:858` y `omitidos.ts:38`
  usan `round2()` importado de `formato.ts`; `round2` sigue siendo una sola
  definición con el fix de `Number.EPSILON` y el signo separado (`formato.ts:53-57`).
- **Las capas de datos**: cero escrituras por cliente de sesión en el repo
  (`supabaseServer().from(...).insert/update/delete` no existe — verificado por
  grep); todas las escrituras van por `supabaseAdmin()`, que es el supuesto que
  sostiene a toda la familia RLS (0078/0079) y el que CLAUDE.md exige. La
  doctrina de PostgREST vive centralizada en `pg.ts` (`exigir`, `traerTodo`,
  `LecturaIncompleta`) y el fix de paginado del export (`003f22e`) la usa bien.
- **`resolverTenantPedido` aplicado donde importa**: las 10 páginas con datos del
  dashboard (12 call sites) distinguen "uuid inexistente" (fallback silencioso,
  correcto) de "no pude preguntar" (fail-loud). El detalle está en
  `tenant-api.ts:95-115`.
- **La matriz TS está probada y fail-closed**: `visibilidad.test.ts` (89 tests),
  `session.test.ts` (16, incluido `SIN_ROL` que no abre nada), `tenant-efectivo.test.ts`
  (45) — 171 tests del rubro verdes en esta ronda; `npx tsc --noEmit -p .` limpio.
- **`sufijoTenant` y el sidebar llevan `?rol=`** (el fix de la 12 para la cadena
  rota del detalle funciona para `?vista=demo`; el hueco que encontré es solo la
  combinación `?tenant=` + `?rol=`).
- **`lib/admin/negocio.ts` sigue siendo la única función cross-tenant** y su
  comentario (negocio.ts:1-26) documenta el porqué y el riesgo — y ahora agrega en
  SQL (mig. 0062) para no morir en el día 50 de operación real.

## Lo que no alcancé a revisar

- La suite completa (3,132 pruebas) — otro auditor la corre; yo corrí los 171
  tests de mi rubro (formato, visibilidad, session, tenant-efectivo).
- Las ~31 páginas de `/dashboard` una por una contra su área declarada en
  `AREA_POR_RUTA` — el desajuste de chat lo encontré de rebote; puede haber otros
  del mismo tipo en rutas que no revisé (el guard de `AREA_POR_RUTA` contra
  `rutas.ts` cubre que existan, no que la página gatee lo mismo que declara).
- `npm run build` (otro auditor lo corre; tsc ya está limpio).
- El cuerpo de `guardar_liquidacion_tx` contra Postgres real (requiere base).

## Veredicto

**7/10 — sin luz verde para declarar cerrada la deuda de arquitectura de la 12,
y con una corrección obligada antes de enseñar el panel:**

1. **El cierre "round2 unificado" es falso a medias.** `3267a8a` arregló 2 de los
   3 sitios que su propio reporte listaba, y el guard sigue greppeando el nombre,
   no la expresión — el guardarraíl que la ronda 10 escribió y que nunca se
   mergeó sigue sin mergear. Es la tercera ronda consecutiva con este mismo
   hallazgo en alguna de sus formas; el rubro no puede volver a darlo por cerrado
   sin el guard de expresión en master.
2. **La matriz de permisos tiene hoy una contradicción viva dentro del propio TS**
   (chat `operacion` vs página `dinero`) y sigue sin guardarraíl TS↔SQL. El demo
   de mañana con Transportes Innovativos incluye enseñar roles (el guion
   previsualiza al contador); el detalle de liquidación va a enseñar botones de
   superadmin en esa previsualización, y un clic los ejecuta.

Lo que sí está sólido: capas sin ciclos ni inversiones, cero escrituras por
cliente de sesión (la familia RLS de la 12 se sostiene), la doctrina de datos en
`pg.ts`, y el perímetro de `repo.ts` estabilizado. La nota se queda en 7 porque
el movimiento que la 12 reportó como pago (round2) resultó a medias, la deuda de
la matriz sigue sin guardarraíl y ahora tiene manifestaciones nuevas y visibles.
Nada de esto bloquea el demo (no hay fuga de datos: el chat gatea antes de
consultar y la previsualización es la sesión real de Javier) — pero el patrón de
declarar cerrado lo que no está es exactamente lo que este rubro tiene la
obligación de no dejar pasar dos veces.
