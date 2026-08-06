# Arquitectura y mantenibilidad — auditoría 14

Ancla: commit `0fa305e` (HEAD, "RFA 2.9 deber ser — migración 0082, seed del demo");
árbol limpio salvo `docs/auditoria-14/`. Ronda anterior: `docs/auditoria-13/arquitectura.md`
(ancla `caae369`). El prompt pide auditar línea por línea tras la ronda 13 Y tras la
implementación del deber ser de la RFA 2.9 (`0d23f73` + `0fa305e`), verificando los cierres
de la 13. Los dos cierres que la 13 reclamó para este rubro —`de6416f` (chat reclasificado
`dinero`) y `b286aa8` (`[id]` respeta `rolEfectivo`)— se verifican primero.

**Nota: 7/10** (sin cambio vs la 13, que cerró en 7). Razón del movimiento: los dos
cierres declarados SÍ están en master y hacen lo que dicen —pero a medias y sin prueba
que los cubra—, los tres pendientes de la 13 (round2, matriz TS↔SQL, exports con
`resolverTenantApi`) siguen intactos, y la implementación nueva de la RFA 2.9, que en
general es sólida (matriz determinística, notas honestas, fail-closed en lo no declarado),
trae dos bordes con efecto de dinero que verifiqué ejecutando el motor: el contador del
ejercicio cuenta pagos de OTRO ejercicio contra el tope de este, y una declaración PARCIAL
(un solo checkbox) se lee como "declaró que NO califica" —para siempre, porque no existe
camino de edición—. Nada de esto rompe el demo de mañana (el seed declara elegible y su
diésel precargado es transferencia, no efectivo), pero es deuda nueva sobre deuda vieja.

---

## Cierres de la ronda 13 — verificación línea por línea

### 1. `/dashboard/chat` reclasificado `dinero` (`de6416f`) — CIERRE VERIFICADO, sin prueba

El commit toca una línea (`visibilidad.ts`):

```
-  '/dashboard/chat': 'operacion',
+  '/dashboard/chat': 'dinero',
```

Verificado en HEAD — `visibilidad.ts:75` dice `'/dashboard/chat': 'dinero'`, y la página
sigue gateando dinero ANTES de consultar (`chat/page.tsx:47`:
`if (!puedeVerArea(rol, 'dinero'))`). Consecuencia comprobada con la matriz: el encargado
(`AREAS_POR_ROL.encargado = ['operacion']`) ya no ve el link en el sidebar
(`puedeVerRuta('encargado', '/dashboard/chat')` → `false`), y el contador sí entra. La
contradicción viva de la 13 quedó cerrada. **PERO**: `chat` sigue sin aparecer ni una vez
en `visibilidad.test.ts` (verificado por grep: cero coincidencias), y el comentario de la
página quedó MINTIENDO — `chat/page.tsx:35-36` todavía dice "su ruta está clasificada como
`operacion`" cuando ya es `dinero`. Es el mismo patrón que este rubro persigue: el fix
funciona hoy y nada impide que la clasificación regrese mañana sin que una prueba falle.

**Estado: cerrado (con residuo BAJO: comentario obsoleto + fix sin prueba).**

### 2. `[id]/page.tsx` respeta `rolEfectivo` (`b286aa8`) — CIERRE A MEDIAS

El commit agrega `rolEfectivo` al render. Verificado en HEAD:
- `[id]/page.tsx:47` → `const rol = rolEfectivo(rolReal, (await searchParams).rol);`
- `:53` → `if (!puedeVerArea(rol, 'dinero')) redirect(inicioDe(rol));`
- `:89` → `const puedeReasignar = puedeAsignar(rol);` (antes `rol` real)
- `:93` → `const puedeReabrir = puedeAdministrar(rol) && d.estatus === 'liquidado';`
- Las dos server actions re-chequean con el rol REAL (`:104` `puedeAdministrar(s.rol)`,
  `:131` `puedeAsignar(r)`), que es el contrato documentado ("el rol efectivo solo QUITA
  visibilidad; las escrituras se autorizan con la sesión real").

Con valores: Javier previsualiza al contador (`?rol=contador`), el formulario "Reasignar" y
"Reabrir" ya NO se pintan (contador no puedeAsignar/puedeAdministrar), y aunque alguien
armara el POST a mano, la acción re-chequea contra el rol REAL de la sesión —que SÍ es
superadmin—, así que el demo dejó de enseñar botones de dueño en la previsualización. La
mitad de pintura del hallazgo MEDIO 4 de la 13 quedó cerrada.

**La otra mitad NO.** La cadena de vuelta para la combinación `?tenant=X&rol=contador`
sigue rota: `[id]/page.tsx:63-66` arma `volverQS = '?tenant=' + tenantId` y el bloque
`:79-84` (`if (!volverQS)`) no entra, así que el `?rol=` se pierde en el "← Panel" (línea
~160). Detalle y escenario en el hallazgo MEDIO 1 de abajo. **Estado: cerrado a medias**
(render sí; cadena de vuelta no; y ningún test cubre ninguna de las dos mitades).

### 3. Los tres pendientes de la 13 — SIN MOVIMIENTO

- **round2**: `crear_viaje_wa.ts:302` sigue con `Math.round(base * factor * 100) / 100`
  (verificado por grep: es la única copia inline de dinero que queda); el guard de
  `formato.test.ts:158-159` sigue greppeando solo el NOMBRE
  (`function round2\|const round2\s*=`), y el guard de la EXPRESIÓN (`e85422c`) sigue sin
  ser ancestro de HEAD (`git merge-base --is-ancestor e85422c HEAD` → NO; vive solo en
  `origin/claude/auditoria-10`). Cuarta ronda consecutiva con este hallazgo en alguna forma.
- **Matriz TS↔SQL sin guardarraíl**: `ve_finanzas`, `administra_flota`, `is_operador` solo
  aparecen en comentarios de tests (`visibilidad.test.ts:111`). Los valores coinciden HOY
  (0048:57 `rol in ('superadmin','flota_admin','contador')`; 0050:34
  `rol in ('superadmin','flota_admin')`; 0045:28 `rol = 'operador'`), pero nada sincroniza
  los dos runtimes.
- **`resolverTenantApi` traga el error de red**: `tenant-api.ts:56-63` sigue sin mirar
  `error` (el docstring justifica el fallback silencioso para "uuid inexistente", que es la
  misma línea de código que produce el "no pude preguntar"); los dos exports lo siguen
  usando (`api/export/liquidaciones/route.ts:23`, `api/export/pdf/[id]/route.ts:39`).

---

## Hallazgos de código

### [MEDIO] `[id]` pierde el `?rol=` de la previsualización en la vuelta con `?tenant=` — la mitad que `b286aa8` no tocó

`src/app/dashboard/[id]/page.tsx:63-66`:

```ts
let volverQS = '';
if (rolReal === 'superadmin' && sp?.tenant) {
  tenantId = await resolverTenantPedido(supabaseAdmin(), tenantId, sp.tenant);
  volverQS = `?tenant=${tenantId}`;
}
```

y `:79-84`:

```ts
if (!volverQS) {
  const partes: string[] = [];
  if (sp?.vista) partes.push(`vista=${encodeURIComponent(sp.vista)}`);
  if (sp?.rol) partes.push(`rol=${encodeURIComponent(sp.rol)}`);
  ...
}
```

**Escenario con valores** (es el mismo de la ronda 13, verificado que sigue pasando):
1. Javier entra a `/dashboard?tenant=<id-flota>&rol=contador` (el panel de flota X con ojos
   de contador; `resolverTenantEfectivo` aplica `rolEfectivo` y el contador ve dinero).
2. El cuadre arrastra el sufijo COMPLETO (`cuadre/page.tsx:64` → `sufijoTenant(sp)` →
   `?tenant=X&rol=contador`) al link del detalle (`cuadre/page.tsx:196`).
3. En el detalle, `sp.tenant` existe → `volverQS = '?tenant=X'` SIN `rol`. El bloque de
   `:79` no entra (volverQS ya es truthy).
4. "← Panel" (`:162`) → `/dashboard?tenant=X` → el rol efectivo se apaga a media
   navegación: Javier vuelve a cuadre con sus propios ojos de superadmin, sin cinta, y el
   contador previsualizado desapareció en silencio.

El comentario de la propia página (`:69-78`) documenta la cadena rota para `?vista=demo` —
que la 12 arregló— y este es exactamente el mismo bug para la combinación `?tenant=`+`?rol=`,
que es la que el panel `/admin/flotas` produce con un clic (`flotas/page.tsx:131` →
`/dashboard/despacho?tenant=${f.id}&rol=encargado`). No es fuga (el rol efectivo solo quita)
pero es la previsualización mintiéndole al operador de la demo. **Estado: abierto** (la 13 lo
reportó como segunda mitad del MEDIO 4; `b286aa8` no lo tocó).

### [MEDIO] RFA 2.9: el contador del ejercicio cuenta pagos de OTRO ejercicio contra el tope de este

`src/lib/cuadra/cuadre/desde_db.ts:68-69` filtra el ejercicio con
`.gte('fecha', '2026-01-01').lte('fecha', '2026-12-31')`, pero `engine.ts:301-306` suma al
acumulado TODO efectivo-combustible del viaje sin mirar la fecha:

```ts
efectivoAcumuladoEjercicio += g.monto;
const total = input.totalCombustibleEjercicio ?? 0;
const acumulado = (input.efectivoPrevEjercicio ?? 0) + efectivoAcumuladoEjercicio;
```

Y la resta del previo (`desde_db.ts:86-89`) tampoco filtra por fecha:
`efectivoDeEsteViaje = gastos.filter(...)` sin `.fecha`. **Escenario con valores** (verificado
ejecutando el motor real): viaje que inicia el 2-ene-2026, ticket de diésel en efectivo de
$1,000 fechado el 30-dic-2025 (dentro de la tolerancia de 30 días de
`fechaToleranciaDiasAntes`, y `fechaDudosa` lo marca solo como `fecha_sospechosa` /
`otro_ejercicio`, sin sacarlo). Liquidado en enero de 2026 con la flota declarada elegible:
`totalCombustibleEjercicio(2026) = 0` (el ticket es de 2025 y es el único combustible),
`efectivoPrevEjercicio = max(0, 0 − 1000) = 0`. El motor entra a la rama `elegible === true`,
`total = 0` → `tope = 0` → `acumulado 1000 > 0` → **`efectivo_sobre_15` con el ticket ENTERO
no deducible** y la nota: *"el ejercicio ya excede el tope del 15% ($1,000.00 vs $0.00)"*.
El motivo real es "gasto de otro ejercicio, no se deduce en este" (que `fecha_sospechosa`
ya dice), no que haya excedido un tope contra una base de $0. Antes de la 2.9, ese ticket
caía en `combustible_efectivo` → **por confirmar / revisar** (recuperable timbrando). Ahora
es no deducible DEFINITIVO con una razón falsa, y el caso se repite cada frontera de año
(dic-2026 → ene-2027). El contador del 15% debería sumar solo los pagos del ejercicio del
gasto (o al menos excluir los de otro ejercicio del acumulado). **Estado: abierto** (nuevo).

### [MEDIO] RFA 2.9: una declaración PARCIAL se lee como "declaró que NO" — y no hay forma de corregirla

`src/lib/cuadra/administracion.ts:110-114` guarda `regimenElegible: f.regimenElegible ?? null`
cuando solo UNA de las dos casillas se marcó, y `desde_db.ts:54-58` evalúa:

```ts
const facilidad15 = (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
  ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
  : undefined;
```

`null !== undefined` es `true`, así que `{ dedicacionExclusivaCarga: true, regimenElegible: null }`
→ `facilidad15 = false` → "declaró que NO califica" → **todo el efectivo-combustible de la
flota es no deducible para siempre** (la nota lo dice: "la flota declaró que NO califica a la
facilidad"). **Escenario con valores**: el alta de flota pide dos checkboxes
(`flotas/page.tsx:174-187`); quien registra marca "dedicación exclusiva" y deja sin marcar
"régimen" (la distingue mal, o se le pasó). La flota nace con `facilidad15 = false` y cada
liquidación con un litro de diésel en efectivo sale con `efectivo_no_elegible`. Y no hay
vuelta atrás: `facilidadCombustibleEfectivo` solo se escribe en `crearFlota` (única
ocurrencia de escritura en todo `src/`, verificado por grep) — no existe pantalla de edición.
La propia filosofía de la 0026 ("una llave presente no puede venir en null") queda violada:
el validador de la 0082 acepta la llave sin validar su forma, y el motor convierte el null
interno en un veredicto definitivo. El camino seguro habría sido: parcial → `undefined`
(por confirmar), como ya hace el caso "sin declarar". **Estado: abierto** (nuevo).

### [MEDIO] El cierre de `round2` sigue a medias y el guard sigue ciego a la expresión

`src/lib/cuadra/crear_viaje_wa.ts:302` (sin cambio desde la ronda 12):

```ts
const valor = Math.round(base * factor * 100) / 100;
```

El guard de `formato.test.ts:158-159` solo mira el NOMBRE; el guard de la expresión
(`e85422c`) sigue sin mergear (ver "Cierres", punto 3). Reconfirmé el impacto con node sobre
la gramática alcanzable del parser (`^\d+(?:\.\d{1,2})?$`, factores 1/1000/1e6): la
expresión y `round2` coinciden en 0 de 30,003 combinaciones — el caso que rompe (`1.005`) es
inalcanzable DESDE ESTE parser. El daño de dinero hoy es nulo; el daño estructural es el de
siempre: la próxima copia en un módulo donde la entrada sí alcance el medio-centavo (como los
cuatro originales de la ronda 9) pasará sin que ninguna prueba la vea. Cuarta ronda con este
mismo hallazgo. **Estado: abierto** (reincidente 12/13/14).

### [MEDIO] La matriz de permisos TS↔SQL sigue sin guardarraíl de sincronía

Detalle completo en "Cierres", punto 3. Escenario: el producto decide "el encargado también
ve el panel fiscal" y alguien edita solo `visibilidad.ts:41-44`; el sidebar y las páginas
pintarán `/dashboard/contador/*` para el encargado y PostgREST le devolverá cero filas (RLS
0048/0049/0051/0052 vía `ve_finanzas()`): el panel afirma "sin datos" sobre datos que sí
existen — la mentira del "no hay nada" en la dirección contraria. Ninguna prueba falla.
**Estado: abierto** (MEDIO de la 12, sin fix reclamado en la 13 ni en la 14).

### [BAJO] `resolverTenantApi` sigue tragándose el error de red en los dos exports

`src/lib/auth/tenant-api.ts:56-63`:

```ts
const pedido = new URL(url).searchParams.get('tenant');
if (pedido && s.rol === 'superadmin') {
  const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
  if (data) tenantId = data.id as string;
}
```

**Escenario**: un superadmin exporta el CSV de la flota X con `?tenant=X`; un parpadeo de red
en la verificación → `data` null → cae en silencio al tenant de la sesión → el CSV sale con
las liquidaciones de OTRA flota sin aviso. La ronda 12 cerró el mismo patrón del lado de
páginas (`resolverTenantPedido` distingue "uuid inexistente" de "no pude preguntar"); los dos
exports (`api/export/liquidaciones/route.ts:23`, `api/export/pdf/[id]/route.ts:39`) quedaron
con la filosofía vieja. El docstring justifica el fallback para un enlace viejo, pero un
error de red no es un enlace viejo. **Estado: abierto** (BAJO de la 13, intacto).

### [BAJO] RFA 2.9: `efectivo_no_elegible` interrumpe al jefe con una "decisión" que él ya tomó

`src/lib/cuadra/cierre_aviso.ts:143-144` mapea `efectivo_sobre_15` y `efectivo_no_elegible`
a `'decision'` — el canal que interrumpe al jefe por WhatsApp. Para `efectivo_no_elegible`,
el jefe es quien DECLARÓ que no califica al registrar la flota; cada viaje con diésel en
efectivo le va a mandar un aviso que no puede resolver (no hay nada que decidir: la
declaración es la que es, y no se puede editar — ver MEDIO de arriba). Es el mismo ruido que
`RUTA_DE_DIFERENCIA` existe para evitar ("veinte mensajes enseñan a ignorar el canal").
Candidato a `'panel'`. **Estado: abierto** (nuevo, juicio de producto).

### [BAJO] Comentario obsoleto en el chat + badge de previsualización que dice lo contrario de lo que pinta

- `src/app/dashboard/chat/page.tsx:35-36`: "su ruta está clasificada como `operacion`" — ya
  no es cierto desde `de6416f` (`visibilidad.ts:75` la clasifica `dinero`). Un lector futuro
  entenderá mal por qué existe el gate.
- `src/app/dashboard/[id]/page.tsx:162-164`: con `?tenant=X&rol=contador`, la página pinta la
  vista del CONTADOR (el fix de la 13) y el badge dice "viendo como superadmin". El texto
  describe la sesión, no lo que se ve; en la previsualización es exactamente el rótulo que
  puede confundir en la sala. **Estado: abierto** (nuevos).

### [Observación] RFA 2.9: la reconstrucción del detalle ahora depende del estado GLOBAL del ejercicio

`desde_db.ts` + `reconstruir` (`analytics.ts:800`) hacen que la cubeta de UNA liquidación
cerrada se recalcule con el contador del ejercicio del MOMENTO. Consecuencia estructural: al
cerrar un viaje posterior que cruce el 15%, TODAS las liquidaciones anteriores con diésel en
efectivo pasan de `combustible_efectivo_dentro15` a `efectivo_sobre_15` en la
reconstrucción → `derivoLaConfig` detecta tipos distintos → el detalle de esas liquidaciones
pierde el desglose de deducibilidad (cae a gastos crudos). Es la dirección segura (callar,
igual que la auditoría 6), pero es una fuente NUEVA de deriva temporal que el portón de
`esperado` no puede distinguir, y además cada vista de detalle paga ahora el agregado del año
completo (`traerTodo` paginado sobre `gasto` con `or()`). Con 100,000 gastos de combustible
al año son ~100 páginas por vista. Funciona; cuesta y envejece — el rendimiento de la
reconstrucción es el punto donde se va a sentir primero. **Estado: abierto** (observación).

### [Observación] La frontera `saas`↔`cuadra` sigue siendo un DAG, con el mismo desdibujo

Verificado de nuevo: cero `import ... from '@/app/...'` en `src/lib/*` (prod), cero
`cuadra → admin` (la única mención en `analytics.ts:160` es comentario), `admin/negocio` solo
lo importan páginas de `/admin`, y el único cruce `cuadra ↔ saas` es
`cuadra/facturacion/flota_fiscal.ts:2 → saas/fiscal.ts:2 → cuadra/intake/cfdi` — DAG, sin
ciclo. `saas/fiscal` sigue siendo "los datos fiscales del RECEPTOR", no "el cobro de Likida":
el nombre del folder promete una cosa y guarda otra. No rompe nada; envejece mal.

---

## Lo que revisé y está bien

- **Los dos cierres de la 13 en su mitad de fondo**: `de6416f` (chat → `dinero`,
  `visibilidad.ts:75`) y la mitad de render de `b286aa8` (`rolEfectivo` en `[id]/page.tsx:47,53,89,93`;
  server actions re-chequean con el rol real en `:104,:131`). El demo de previsualización ya
  no pinta ni "Reasignar" ni "Reabrir" para el contador.
- **La matriz de la RFA 2.9 en el motor**: las 5 pruebas nuevas (`engine.test.ts:1417-1487`)
  cubren la matriz completa (dentro15 / sobre15 proporcional / no elegible / sin declarar /
  sin IVA-IEPS), y las verifiqué a mano: el cruce reparte por proporción de modo que las
  tres cubetas SIEMPRE suman `totalComprobado` (lo comprobé ejecutando el motor con dos
  gastos que cruzan la frontera: deducible 100 + no deducible 1900 = 2000 ✓); la suma es
  independiente del orden de gastos; el borde exacto (`acumulado === 15%`) cae DENTRO, como
  dice la regla ("no excede").
- **Fail-closed en lo no declarado**: sin declaración, `facilidad15 = undefined` →
  `combustible_efectivo` → por confirmar; la nota dice qué falta. El seed del demo declara
  `{dedicacionExclusivaCarga:true, regimenElegible:true}` y su diésel precargado es
  `forma_pago '03'` (transferencia), así que la RFA 2.9 no altera la narrativa del guion.
- **`traerTodo`/`exigir` bien usados en el agregado del ejercicio** (`desde_db.ts:63-69`:
  `.order('id')` + `conteo(desde)` — el contrato de `pg.ts` cumplido).
- **Capas**: sin ciclos, sin `lib→app`, sin escrituras por cliente de sesión (grep:
  `supabaseServer().from(...).insert/update/delete` no existe; las 26 archivos con escrituras
  van por `supabaseAdmin()` — el supuesto que sostiene la familia RLS 0078/0079).
- **Perímetro de `repo.ts`**: 29 consultas dentro · 211 fuera · 240 total · 88% fuera
  (ronda 13: 88% — estable; `administracion.ts` creció 10→11 por la RFA 2.9).
- **Pruebas del rubro**: `tsc --noEmit` limpio, `eslint` 0 errores, y 222+ tests de mi rubro
  verdes (formato, visibilidad, session, tenant-efectivo, permisos, engine, por_diferencia,
  processor_cadena/cierre, migraciones_verificadas, copias_un_origen, omitidos, pdf_cifras,
  estado_afirmado, cifras).
- **La 0082 y su exención son defendibles**: redefinir `config_tenant_valida` (la 0026 queda
  muerta por `create or replace`), el fallo de aplicar la migración es RUIDOSO (el CHECK de la
  0026 rechaza el alta/seed con la llave nueva), y el bloque 7 de `verificaciones.sql` sigue
  pasando porque no depende de la función nueva.

## Lo que no alcancé a revisar

- La suite completa (3,148 verdes según el commit; otro auditor la corre) y `npm run build`.
- La base real (us-east-2): no pude confirmar en vivo que la 0082 esté aplicada ni que los
  bloques 26/28/44/53/54/55 pasen — lo tomo del contexto del prompt, sin verificarlo.
- El flujo completo del demo con la RFA 2.9: si en la sala mandan un ticket de diésel en
  EFECTIVO en vivo, el contador del 15% (base ~$4,200 del seed) cruza rápido (tope 15% =
  $630 sobre el primer precargado; un diésel en efectivo de $800 ya excede) y el guion
  "la ÚNICA diferencia es la de política" cambia. El GUION_DEMO.md no menciona la 2.9. No
  llegué a leer el guion completo para confirmar qué tickets se mandan en vivo.
- Las ~31 páginas de `/dashboard` una por una contra su área declarada (el guard de
  `AREA_POR_RUTA` cubre que existan, no que la página gatee lo mismo que declara).

## Veredicto

**7/10 — sin luz verde para declarar cerrada la deuda de arquitectura.** En positivo: los
dos fixes de la 13 que este rubro exigía están en master y funcionan en su mitad de fondo
(chat reclasificado; la previsualización ya no pinta ni ejecuta acciones de dueño), y la RFA
2.9 es, en su núcleo, la mejor implementación fiscal del repo: matriz determinística, notas
que dicen exactamente qué se verificó, proporción que no rompe la suma de cubetas, fail-closed
cuando no hay declaración. En negativo: (a) cada fix de la 13 llegó sin prueba y a medias —el
`?rol=` de la vuelta con `?tenant=` sigue perdiéndose en `[id]/page.tsx:63-66`, que es la
segunda mitad del propio hallazgo que la 13 dijo haber cerrado—; (b) los tres pendientes
estructurales (round2 + guard ciego, matriz TS↔SQL, exports con `resolverTenantApi`) cumplen
su tercera/cuarta ronda sin movimiento; y (c) la implementación nueva trae dos bordes con
efecto de dinero —el contador del ejercicio que cuenta pagos de otro ejercicio
(verificado ejecutando el motor: un diésel en efectivo del 30-dic-2025 liquidado en enero de
2026 sale "no deducible — excede el 15% ($1,000 vs $0)") y la declaración parcial que se
congela como "declaró que NO" sin camino de edición—. Ninguno de los dos rompe el demo de
mañana; ambos son deuda que este rubro ya vio cobrar factura en rondas anteriores cuando se
dejó el patrón "funciona hoy, nadie lo prueba, nadie lo cierra". El rubro no puede volver a
dar por cerrado lo que está a medias.
