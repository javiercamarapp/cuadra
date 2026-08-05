# Arquitectura y mantenibilidad — auditoría 12

Ancla: commit `8fc7e79` al momento de las mediciones; HEAD siguió moviéndose
mientras escribía el reporte (otros agentes de la ronda commiteaban en paralelo:
`2e8f1c0` al cierre). El árbol se MOVIÓ durante la ronda — ver nota final. Ronda anterior: `docs/auditoria-10/arquitectura.md`,
commit `56c267a` (la ronda 11 no dejó archivo de arquitectura; su único legado es
la migración 0078, que se revisa aquí como pide el prompt).

**Nota: 7/10** (sin cambio vs ronda 10). Razón del movimiento: la ronda se movió
hacia arriba por un lado (la 0078/0079 cierra de verdad la familia de RLS que la
ronda 10 dejó como apuesta abierta en `reabrirViaje`, y el patrón `not
is_operador()` se sostiene en las 9 migraciones que lo usan) y hacia abajo por
otro (el guardarraíl de `round2` que la ronda 10 presumió como cerrado —"vigila
la expresión, no el nombre"— **nunca llegó a master**: el commit que lo escribió,
`e85422c`, vive en una rama sin mergear, y los tres sitios de dinero que debía
cazar siguen redondeando con la expresión vieja). El perímetro de `repo.ts` que
la ronda 9 celebró (62% fuera → 84% en la 10) sigue creciendo: **90% hoy**. Y la
migración que cierra los CRÍTICO de RLS (0078) existe **solo en el árbol local**:
4 commits sin publicar, ninguno con `[deploy]` — el fix no está ni en
`origin/master` ni desplegado.

---

## Revisión de la 0078 (pedida por el prompt) — línea por línea

`supabase/migrations/0078_rls_chofer_sin_escritura.sql` (60 líneas):

1. **El bloque 1 (líneas 39-47)** — loop sobre 7 tablas (`terminal`, `operador`,
   `politica_gasto`, `wa_conversacion`, `llm_costo`, `cfdi_xml`,
   `cfdi_consolidado_linea`): hace `drop policy if exists tenant_data` y recrea
   con el patrón verificado de la 0045/0047/0050/0051/0053 —
   `((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())`.
   **Correcto y consistente.** Verifiqué con grep que las 6 migraciones hermanas
   usan exactamente el mismo texto de policy (0045:2, 0047:4, 0050:4, 0051:4,
   0053:4, 0078:3 ocurrencias de `not is_operador()) or is_superadmin()`).

2. **El bloque 2 (líneas 55-59)** — `tenant_self` pasa de `for all` (0001:122) a
   `for select` con comentario que afirma: *"la app escribe tenant SIEMPRE por
   service_role en server actions — verificado: cero escrituras anon en el repo"*.
   **El claim se sostiene**: las únicas escrituras a `tenant` del repo son
   `supabaseAdmin().from('tenant').update(...)` en `src/lib/cuadra/administracion.ts:253`
   y `src/lib/saas/suscripcion.ts:381` — las dos por service-role. No hay ninguna
   escritura a `tenant` por cliente de sesión (`supabaseServer()`) en el repo.

3. **Verificación del fix: hay bloque 54 en `supabase/verificaciones.sql:2970`**
   que impersona a un chofer y espera `0/0/0/0/0/0/0/0/1/2` en las 7 tablas +
   tenant-update + tenant-select + regresión de flota_admin. El bloque es real y
   cubre lo que la migración promete.

**PERO la 0078 no cierra la familia entera.** Dejó dos MEDIO que la 0079
(`0079_rls_chofer_sin_lectura_personal.sql`, commit `23015b7`, escrita **hoy en
esta misma ronda**) tuvo que cerrar después:

- `app_user_self` (0001:127) era `for select using (id = auth.uid() or
  tenant_id = any(get_user_tenant_ids()) or is_superadmin())`: **un chofer con
  sesión web podía leer los correos, nombres, roles y `operador_id` de TODA la
  flota** — el mapa quién-es-quién entre cuentas web e identidades de WhatsApp.
  La 0079 lo cierra con `not is_operador()` en el brazo de tenant.
- `bitacora_insercion` (0053:199) era `for insert` sin mirar rol: **un chofer
  podía sembrar entradas falsas en la bitácora de auditoría de su flota** (con el
  correo del dueño como actor). La 0079 lo cierra igual.

**Estado de publicación — hallazgo operativo de arquitectura:** `0078` y `0079`
**no están en `origin/master`** (que sigue en `56c267a`, el último deploy). Hay 4
commits locales sin publicar (`ce9abab`, `23015b7`, `c78e080`, `8fc7e79`), y
ninguno lleva `[deploy]` en el asunto. El fix de los CRÍTICOS SEC-C2/DATOS-C2
existe solo en el árbol local de esta máquina.

---

## Hallazgos de código

### [MEDIO] `round2` duplicado inline sigue en master — y el guard de la ronda 10 nunca llegó

`src/lib/cuadra/repo.ts:841`, `src/lib/cuadra/liquidacion/omitidos.ts:37` y
`src/lib/cuadra/crear_viaje_wa.ts:302` siguen redondeando dinero con la
expresión inline `Math.round(x * 100) / 100` en lugar de importar `round2` de
`src/lib/formato.ts:53`:

```ts
// repo.ts:841 — getAcumuladoCombustible, el acumulado que dispara el tope RFA 2026 2.9
return { efectivo: Math.round(efectivo * 100) / 100, totalCombustible: Math.round(totalCombustible * 100) / 100 };
// omitidos.ts:37 — el monto del renglón «… y N comprobantes más» IMPRESO en el PDF
monto: Math.round(monto * 100) / 100,
// crear_viaje_wa.ts:302 — el anticipo parseado del WhatsApp
const valor = Math.round(base * factor * 100) / 100;
```

La ronda 10 escribió el guardarraíl que debía cazarlos (`e85422c`, "el guard de
round2 vigila la expresión, no el nombre", que greppea `Math.round(x * 100) /
100` con `sinComentarios`), y **verificado en rojo antes** devolvía exactamente
`["src/lib/cuadra/repo.ts", "src/lib/cuadra/liquidacion/omitidos.ts"]`. Ese
commit **no es ancestro de HEAD** (vive en `origin/claude/auditoria-10`, sin
mergear), y el guard actual de `src/lib/formato.test.ts:158-159` solo greppea
`function round2\|const round2 =` — que los tres sitios pasan porque ninguno
bautiza la función.

**Escenario con valores:** `getAcumuladoCombustible` acumula efectivo del
ejercicio en JS (suma de floats de `gasto.monto`). Si la suma cae en `1.005`
(p.ej. 0.335 + 0.335 + 0.335), `Math.round(1.005 * 100) / 100` da **1.00**,
mientras `round2(1.005)` da **1.01**. Comprobado con node:

```
inline(1.005) = 1        round2(1.005) = 1.01   (dif 1 centavo)
inline(0.145) = 0.14     round2(0.145) = 0.15   (dif 1 centavo)
```

Ese acumulado es el denominador del tope de 15% de efectivo de la RFA 2026 regla
2.9 (`periodo/combustible.ts`): un denominador un centavo abajo hace parecer
holgada a una flota que está al filo — el mismo bug que la ronda 9 marcó como
ALTO REINCIDENTE y que la ronda 10 dio por cerrado. **No lo está en master.**

### [MEDIO] La matriz de permisos vive en DOS archivos (TS + SQL) y nadie los sincroniza

`src/lib/auth/visibilidad.ts:36-44` define `AREAS_POR_ROL` (quién ve qué área del
panel) y `src/lib/auth/permisos.ts:17-19` define `EXPORTA`/`ASIGNA`/`ADMINISTRA`.
Su espejo en la base vive en `supabase/migrations/0048_comercial_cliente_tarifa_ingreso.sql:57`
(`ve_finanzas()`: `rol in ('superadmin','flota_admin','contador')` — literalmente
el comentario dice "Espeja `AREAS_POR_ROL.dinero` de `lib/auth/visibilidad.ts`") y
en `supabase/migrations/0050_rastreo_posicion_geocerca.sql:34` (`administra_flota()`:
`rol in ('superadmin','flota_admin')` — espejo de `ADMINISTRA`). Y `is_operador()`
(0045:26) es el espejo del chequeo `rol === 'operador'` de `guard.ts:73`.

**No hay ninguna prueba que sincronice TS ↔ SQL.** Busqué `ve_finanzas`,
`administra_flota` e `is_operador` en todos los `*.test.ts`: solo aparece un
comentario (`visibilidad.test.ts:111`). `verificaciones.sql` prueba el
comportamiento por rol (bloque 29: el encargado no ve finanzas), pero **no
prueba que las dos matrices sigan siendo la misma** si alguien agrega un rol a
`AREAS_POR_ROL.dinero` en TS y se olvida de `ve_finanzas()` en SQL.

**Escenario:** hoy `ve_finanzas()` y `AREAS_POR_ROL.dinero` coinciden
(superadmin/flota_admin/contador). El día que el producto decida "el encargado
también ve el panel fiscal" y alguien edite solo `visibilidad.ts:42-44`, la UI
pintará el panel y PostgREST devolverá cero filas — o al revés, se abre la RLS y
la UI no lo enseña. Ninguna prueba falla. Es exactamente la clase de duplicación
que este repo ya quemó tres rondas en cazar para `mxn()`/`round2()`, pero aquí la
matriz vive en dos runtimes y no hay guardarraíl.

### [Observación] El perímetro de `repo.ts` sigue creciendo: 90% del acceso a datos está fuera

Repetí la métrica de la ronda 10 (`.from('`/`.rpc('` con literal, sin
`*.test.ts`):

```
ronda 9:   repo.ts 26 · fuera 42 · total 68 · 62% fuera   (la ronda lo celebró)
ronda 10:  repo.ts 26 · fuera 135 · total 161 · 84% fuera
ronda 12:  repo.ts 26 · fuera 244 · total 270 · 90% fuera  (+109 sitios fuera)
```

`repo.ts` no creció (26 sitios, igual que en la 9 y la 10); todo el crecimiento
fue fuera: `operacion.ts` (31), `analytics.ts` (23), `saas/suscripcion.ts` (16),
`conv.ts` (13), `comercial.ts` (12), `administracion.ts` (11), `startup.ts` (10),
`intake/consolidado.ts` (9), y 11 páginas de `/dashboard` que consultan con
`supabaseAdmin()` directo (cuadre, unidades, pod, incidencias, documentos,
usuarios, suscripcion, politicas, operadores, despacho, combustible-casetas,
`[id]`). La pregunta del rubro —"¿dónde se lee/escribe una liquidación?"— ya no
tiene una respuesta, tiene ~doce. La ronda 10 lo dejó como observación con la
esperanza de una decisión ESCRITA sobre cuándo un módulo es satélite; esa
decisión sigue sin existir y la tendencia empeoró.

### [BAJO] Patrones copiados de página en página

- `async function safe<T>` duplicada en **23 archivos** de `src/app/`.
- `tenantDelAction`/`tenantYUsuarioDelAction` (server action que re-resuelve
  tenant + revalida rol) duplicada en **6 páginas** (unidades, pod, incidencias,
  suscripcion, despacho, combustible-casetas).
- El bloque `if (s.rol === 'superadmin' && sp?.tenant) { supabaseAdmin().from('tenant').select('id')... }`
  está copiado en **12 archivos** (`[id]/page.tsx` lo repite 3 veces: líneas 57,
  104 y 130).
- `src/app/dashboard/[id]/page.tsx` **no usa `resolverTenantEfectivo`** (que
  existe exactamente para centralizar esto): resuelve a mano con
  `requireSessionTenant` + el bloque de arriba, en un archivo que además ya
  importa la mitad de las capas de lib. Es la única página del dashboard con
  datos que no pasa por el resolver.

Estos cuatro no son bugs — son la señal de que la capa "qué tenant estoy viendo
y quién soy" se sigue escribiendo a mano por página en vez de vivir una vez.

---

## Lo que revisé y está bien

- **`round2()` centralizado y probado**: un solo `export function round2` en
  `src/lib/formato.ts:53` con el fix de `Number.EPSILON` y el signo separado
  antes de sumar el épsilon. `formato.test.ts` (21 tests) verde, incluido el
  caso `1.005 → 1.01` y el guard de nombre.
- **`reabrirViaje` ya toma el mutex** (cierre de la ronda 10, `cec429c` en HEAD):
  `administracion.ts:381` llama `acquireViajeLock(viajeId)` y el comentario
  (líneas 334-352) documenta la carrera real con `guardar_liquidacion_tx` que la
  ronda 10 dejó como pregunta abierta. El hallazgo MEDIO de la ronda 10 está
  cerrado de verdad, no solo declarado.
- **La 0078 es correcta en su alcance**: patrón consistente con las 6
  migraciones hermanas, claim de "cero escrituras anon a tenant" verificado
  contra el repo (todas pasan por `supabaseAdmin()`), y bloque 54 de
  `verificaciones.sql` que ejercita exactamente lo que promete.
- **La capa de visibilidad/permisos en TS está bien probada**: `visibilidad.test.ts`
  (89 tests) fija quién ve qué ruta, el guard de `AREA_POR_RUTA` contra `rutas.ts`
  (una pantalla nueva sin área declarada falla, no se sirve a nadie), y
  `rolEfectivo` solo puede QUITAR visibilidad — un `?rol=flota_admin` en la barra
  no es escalada.
- **`SIN_ROL` (session.ts:31-46)**: una sesión sin fila legible en `app_user` ya
  no nace como flota_admin (el `?? 'flota_admin'` que el 4-ago-2026 dejó de ser
  teórico se eliminó); `guard.test.ts` lo cubre con su propio test.
- **Cero escrituras por cliente de sesión en tablas de negocio**: verifiqué que
  no existe `supabaseServer().from(...).insert/update/delete` en el repo — toda
  escritura va por service-role, que es el supuesto que sostiene la 0078 y el
  que CLAUDE.md exige para "la app escribe tenant por service_role".
- **tsc y lint**: `npx tsc --noEmit -p .` limpio; `npx eslint src/` 0 errores, 8
  warnings (unused vars, preexistentes). 202 tests de `lib/auth/` + `formato`
  verdes en esta ronda (no corrí la suite completa — otro auditor la corre).

## Lo que no alcancé a revisar

- Las ~31 páginas de `/dashboard` completas contra `/admin` en busca de
  duplicación de KPIs — solo revisé la muestra con precedente (cuadre, despacho,
  combustible-casetas, `[id]`).
- El cuerpo de `guardar_liquidacion_tx` — el hallazgo de la ronda 10 sobre
  `reabrirViaje` quedó cerrado por el lado del lock, pero no verifiqué la RPC
  contra Postgres real (requiere base).
- La 0078/0079 **aplicadas a una base real**: el bloque 54/55 de
  `verificaciones.sql` está escrito pero el commit de la 0078 dice "pendiente de
  correr contra la base real" y la base del demo está vacía. El fix existe solo
  como SQL sin ejecutar contra Postgres.
- El `seed.sql` recién modificado (sin commitear, lo está tocando otro agente de
  la ronda) — no lo audité por ser de datos, no de arquitectura.

## Nota metodológica — el árbol se movió durante la ronda

Comencé la auditoría en `ce9abab` y la cierro en `8fc7e79`: **otros agentes de la
ronda 12 commiteaban en paralelo** sobre el mismo árbol (la 0079 de RLS, la 0065
de datos, el RFC del seed). Todo lo que cito con archivo:línea fue verificado
contra el estado final del working tree al cierre (`git show HEAD:...`), y las
conclusiones que dependen de commits (que `e85422c` no esté en HEAD, que
`origin/master` no tenga la 0078) se verificaron con `git merge-base
--is-ancestor` y `git cat-file -e`, no de memoria.

---

## Veredicto

**7/10 — sin luz verde para cerrar la deuda pendiente, con dos cosas que deben
moverse antes del demo:**

1. **La familia RLS (0078+0079) no está publicada ni desplegada.** Es el fix de
   los CRÍTICOS SEC-C2/DATOS-C2 de la ronda 11: existe en el árbol local, en 4
   commits sin `[deploy]`. Para el demo de mañana no bloquea (la base está
   vacía), pero la afirmación "el chofer ya no lee ni escribe lo que no es suyo"
   solo es cierta en esta máquina, no en lo que Vercel corre ni en lo que está en
   GitHub.
2. **El guard de `round2` que la ronda 10 celebró como cerrado no está en
   master**, y los tres sitios de dinero que debía cazar siguen redondeando con
   la expresión vieja. Es un MEDIO de dinero real (el tope RFA 2026 2.9 y el
   renglón impreso del PDF) que se reportó cerrado y no lo está — el patrón
   exacto que este rubro tiene la obligación de no dejar pasar dos veces.

Lo que sí está sólido: la 0078 en sí es correcta y consistente con el resto del
esquema, el claim de escrituras service-role se sostiene, `reabrirViaje` cerró su
deuda de concurrencia de verdad, y la capa de visibilidad/permisos TS está
probada y fail-closed. La nota se queda en 7 porque la deuda que la ronda 10
reportó como pagada (round2) resultó no estarlo, y porque el perímetro de
`repo.ts` sigue la tendencia equivocada sin una decisión escrita.
