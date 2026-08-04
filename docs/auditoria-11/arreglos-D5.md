# D5 — Operación del encargado y esquema · arreglos

Rama `claude/auditoria-11`. Árbol con `989ca62`, `2fb1982` y `2e332ae` ya dentro
(cada grupo se verificó abriendo el archivo, no contra el plan).

**Suite al terminar:** `npx vitest run` → **255 archivos, 2 389 pruebas, 0 fallos**
(1 skip preexistente). `npx tsc --noEmit -p .` y `npx eslint src/` limpios *para
los archivos de D5*; lo que queda rojo es de otros dominios y está anotado abajo.
`npm run build` compila las 24 rutas del panel.

---

## Cerrados

### G-21 · CRÍTICO — las siete escrituras de `operacion.ts` · **CERRADO**
Prueba: `src/lib/cuadra/operacion.test.ts` (16 casos nuevos; los 16 fallaban antes
del arreglo). Código: `src/lib/cuadra/operacion.ts`, `dashboard/aviso-captura.tsx`
y los cuatro `page.tsx` de `despacho/`, `pod/`, `unidades/`, `incidencias/`.

Los tres defectos, cada uno con su reproducción:

**(a) El 23505 tumbaba la pantalla.** `violaIndice()` existía en `pg_errores.ts`
—escrita exactamente para esto— y ninguna de las siete la importaba. Ahora
`operacion.ts` tiene `CHOQUES`, que ata los tres índices reales
(`uq_viaje_abierto_por_operador`, `unidad_economico_unico`, `pod_viaje_unico`) a
un texto que el encargado puede leer y actuar. El caso del demo —dos clics: dar
de alta un segundo viaje al único chofer con datos— ya no pinta *«No se pudo
cargar el panel — hubo un problema al leer los datos»* con un hash, sino
«Ese chofer ya trae un viaje abierto. Ciérralo o liquídalo antes de darle otro».
Un 23505 contra un índice que **no** está en la lista sigue subiendo como error
de verdad, y hay una prueba que lo fija (`un 23505 contra un índice DESCONOCIDO
sigue siendo un error de verdad`): tragarse cualquier 23505 escondería el bug.

**(b) Un UPDATE de cero filas se anunciaba en verde.** Los cuatro updates piden
ahora `.select('id')` y `tocadas(data) === 0` lanza. El mock de la prueba
codificaba el cero-filas **como éxito** (`then` devolvía `{data: null, error: null}`);
se corrigió para devolver las filas de la tabla, que es lo que hace PostgREST.

**(c) Los ids venían del `<form>` sin comprobar de quién son.** Las FK de la 0047
son de una sola columna (`references public.unidad(id)`, sin tenant), así que la
base aceptaba feliz una unidad de otra flota colgada de un viaje de ésta. Nuevo
`exigirDelTenant(tabla, id, tenantId)`, aplicado en `crearViaje` (operador y
unidad), `asignarUnidad` (unidad), `crearIncidencia` (viaje y unidad) y
`marcarPodPedido` (viaje y operador). No sustituye al `tenant_id` del WHERE:
cubre el otro caso, el del id que va como VALOR de una columna con FK simple.

**Cómo se ve en pantalla.** `ErrorDeCaptura` lleva un **código**, no el texto, y
las páginas redirigen con `?err=<codigo>`; `AvisoCaptura` lo resuelve contra el
catálogo `CAPTURA`. El texto nunca viaja por el query string a propósito: la URL
no puede ser un sitio donde alguien ponga la frase que quiera bajo el encabezado
de Likida. Un código que no está en el catálogo no pinta nada.
El `try` **no** envuelve al `redirect`: `redirect()` funciona lanzando, y
atraparlo convertiría un guardado bueno en «no se guardó».

### G-27 · MEDIO — `/dashboard/mapa` y `/dashboard/soporte` sin guarda · **CERRADO**
Prueba: `src/app/dashboard/guardas_de_pagina.test.ts` — estructural, recorre TODA
`page.tsx` bajo `src/app/dashboard/` y exige una de las tres guardas. Fallaba con
esos dos archivos exactos. Las dos llaman ya a `exigirVerRuta`, que es la que su
docstring dice que existe para los stubs.

### G-48 · ALTO — dos páginas declaraban inexistentes tres tablas de la 0047 · **CERRADO**
Prueba: `src/app/dashboard/huecos_reales.test.ts`. No es un grep de frases sueltas:
lee `create table` de `supabase/migrations/` y solo exige la corrección si la tabla
**existe de verdad** — el día que alguien revierta la 0047, la frase vuelve a ser
cierta y la prueba deja de pedir nada. Fallaba con cuatro frases de
`viajes/page.tsx` (soporte se corrigió en el mismo paso que G-27).

- `dashboard/viajes/page.tsx`: el recuadro decía *«`viaje` no guarda unidad, no hay
  tabla de vehículos, no hay campo de POD»* con Unidades y POD vivas en el mismo
  menú. Ahora manda a Unidades, POD & Evidencias y Despacho, y deja como hueco
  **solo el margen**, que sí falta de raíz (no se registra el ingreso del flete).
- `dashboard/soporte/page.tsx`: decía *«No hay tabla de tickets, ni cola, ni reloj
  de SLA»* teniendo `incidencia` con `estado`, `prioridad` y `sla_horas`. Se
  reescribió para separar lo que sí existe (la incidencia operativa, en su
  pantalla) de lo que de verdad falta (la queja del CLIENTE — no hay tabla de
  clientes, ni CSAT, ni plazos de reclamación).

### G-57 · MEDIO — el despacho no sacaba la unidad de «disponible» · **CERRADO**
Prueba: `operacion.test.ts`, bloque `G-57` (4 casos, ninguno existía: la suite no
ejercitaba `asignarUnidad` en absoluto). `asignarUnidad` lee la unidad **previa**
antes del update —después ya no se sabe cuál traía— y luego mueve estados: la
vieja a `disponible`, la nueva a `en_ruta`. `crearViaje` con unidad también la
ocupa. Es lo que la 0047 promete de su columna: *«Lo mueve el despacho, no un
humano tecleando»*.

### G-20 · CRÍTICO — mitigación de UI · **CERRADA la mitigación; la migración va abajo**
Prueba: `operacion.test.ts`, bloque `G-20 (mitigación)`.
- `crearViaje` rechaza `operadorId` vacío con `sin_chofer` **antes** de escribir,
  en vez de mandarle a la base un 23502 que tumba la pantalla.
- `despacho/vista.tsx`: `<option value="">Asignar después</option>` era la opción
  **seleccionada por default** y no se podía guardar. Ahora el chofer es
  obligatorio, y el comentario dice por qué.
- El KPI «Por asignar» y el estado vacío de «Sin asignar» ya **no afirman** un
  cero medido: declaran que la consulta no puede producir filas mientras
  `viaje.operador_id` sea NOT NULL. Es la regla de "nunca inventar una cifra"
  aplicada a un cero que venía del esquema, no de la operación.

### G-51 · CRÍTICO — guardarraíl de ordinales duplicados · **CERRADO el guardarraíl**
Prueba: `src/lib/cuadra/migraciones_verificadas.test.ts`, caso `ningún ordinal
nombra dos migraciones distintas`. Verificado que reproduce: con un
`0047_choque_de_prueba.sql` temporal la suite se pone roja; sin él, verde.
Este archivo identifica una migración por su NÚMERO (`f.slice(0,4)` y
`\b0046\b`), así que con dos 0046 **las dos** contarían como comprobadas.
La renumeración en sí queda propuesta (abajo).

### G-09 · CRÍTICO (slice de D5) — `incidencias/vista.tsx` · **CERRADO**
D1 ya publicó `valor: number | null` en `KpiTile`. `mediana ?? 0` escribía justo
el cero que el comentario de dos líneas arriba dice que no se puede escribir
(*«un 0 se leería como "se resuelven al instante"»*). Ahora se pasa el `null`.

### G-34 · ALTO (slice de D5) — `tenantDelAction` × 4 · **CERRADO**
D3 ya publicó `resolverTenantDeAction()` en `tenant-efectivo.ts`. Las cuatro
copias de `despacho/`, `pod/`, `unidades/` e `incidencias/` descartaban el
`error` de la consulta: con un 503 transitorio `data` salía null, el `if` no
entraba, y la escritura aterrizaba en el tenant de la SESIÓN —el DEMO para un
superadmin— con la píldora verde diciendo «Viaje creado». Sustituidas por la
llamada única. El gate de permiso se queda en la página porque su redirect
necesita el `sufijo`, que es local (es lo que pide el docstring del helper).

### G-47 · ALTO (slice de D5) — `rol?: string` en `searchParams` · **CERRADO**
Los cuatro `page.tsx` de escritura declaran ya `rol?: string`, así que `sp.rol`
llega a `rolEfectivo` en vez de ser siempre `undefined`. El contrato de
`sufijo.ts` (arrastrar `rol` en los links) sigue siendo de D1.

---

## Propuestos, NO ejercidos — este entorno no tiene Postgres

Ninguna migración se tocó. El SQL de abajo es propuesta: **no se aplicó, no se
probó contra una base**, y ejercerlo exige revisar el efecto sobre RLS y FK.

### G-20 — `viaje.operador_id` es NOT NULL
```sql
-- Toca la FK compuesta de la 0028 y la RLS del chofer de la 0045: hay que
-- releerlas antes de aplicar. Y hay que decidir si `uq_viaje_abierto_por_operador`
-- (0029) debe seguir siendo `(tenant_id, operador_id)` con NULLs dentro —en
-- Postgres varios NULL no chocan entre sí, así que N viajes sin dueño conviven,
-- que probablemente es lo que se quiere.
alter table public.viaje alter column operador_id drop not null;
```
Mientras no se aplique, la mitigación de UI de arriba es la que sostiene la
pantalla. **Si se aplica, hay que revertir tres cosas de este PR**: el
`ErrorDeCaptura('sin_chofer')` de `crearViaje`, el `required` del `<select>` de
`despacho/vista.tsx`, y las dos declaraciones de "esta consulta no puede
producir filas" (KPI «Por asignar» y estado vacío de «Sin asignar»).

### G-28 — RLS del chofer, grants del contador, FK sin tenant
Cuatro cosas, ninguna comprobable sin `set local role authenticated`:
1. `0045:39` — el `foreach` solo recorre `viaje, gasto, liquidacion`; faltan las
   otras cuatro de las siete de `0001:110-116` (más `llm_costo` de la 0003 y
   `cfdi_xml` de la 0009). El PR #7 lo cubre en su `abbf9e8`.
2. `0047:167-185` — el contador nace con `for all` sobre las cuatro tablas
   nuevas: escribe en diez. PR #7 `9f053e3`.
3. `0045:20-21,31-34` — `app_user.operador_id` con FK simple y
   `get_user_operador_id()` sin comparar tenants. PR #7 `aff7f63`.
4. **Nuevo de `master`, en ningún lado**: las siete FK de la 0047 van a `(id)` a
   secas (`:65,76,100-101,106,130-131`), `pod_viaje_unico` (`:151`) es única
   **global** —una fila de POD de la flota A bloquea para siempre el POD de un
   viaje de la flota B, invisible para las dos— y `operador_sube_su_pod`
   (`:190-191`) no mira `tenant_id`, ni `estado`, ni que el archivo exista.
   ```sql
   drop index if exists public.pod_viaje_unico;
   create unique index pod_viaje_unico on public.pod (tenant_id, viaje_id);
   ```
   El defecto (c) que sí se cerró arriba (`exigirDelTenant`) es la mitigación de
   aplicación de las FK sin tenant: cierra el camino del panel, **no** el de
   cualquier otro cliente de la base.

### G-29 — bucket `avatares` público, sin tope ni MIME
```sql
update storage.buckets
   set public = false,
       file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'avatares';
-- y `avatares_propio_update` necesita su `with check`, hoy ausente (0046:32-35).
```
Además de la migración hay **decisión humana**: si el bucket deja de ser público
hay que servir URL firmada (hoy se renderiza directo), y el catálogo del aviso y
el camino de borrado son G-54/G-33, de otros dominios. `grep -rn
"deleteUser\|storage.*remove" src/` sigue dando **cero**: el aviso publica un
plazo de conservación que ningún mecanismo puede cumplir.

### G-51 — renumerar las migraciones del PR #7
`0046_perfil_avatar.sql` / `0047_operacion_encargado.sql` (este árbol) contra
`0046_rls_operador_resto.sql` / `0047_rls_operador_tenant.sql` (PR #7, que llega
hasta `0053`). Rutas distintas ⇒ git no reporta conflicto y los cuatro aterrizan.
La propuesta es renumerar **las del PR** a `0048`+ conservando su orden relativo,
y mover su bloque en `supabase/verificaciones.sql` al ordinal nuevo. Es trabajo de
merge y las dos ramas además refactorizaron `/dashboard` por separado: no se hace
a ciegas. El guardarraíl ya está puesto y se pondrá rojo en cuanto los cuatro
archivos coexistan.

### G-63 — la 0047 no es idempotente ni tiene reversión escrita
```sql
-- (1) idempotencia: las cuatro `create policy` del `do $$` (0047:172-176,183-191)
--     no llevan `drop policy if exists` delante, mientras TODO lo demás del
--     archivo sí es idempotente y la 0046, a dos archivos, lo hace bien.
drop policy if exists <nombre> on public.<tabla>;
create policy <nombre> ...;

-- (2) los cuatro enteros sin dominio (0047:38,80,107). Un `sla_horas = -5`
--     nace CON EL SLA VENCIDO, en rojo, en la pantalla del encargado.
alter table public.unidad        add constraint unidad_anio_rango
  check (anio is null or anio between 1950 and 2100);
alter table public.mantenimiento add constraint mantenimiento_km_positivo
  check (km_servicio is null or km_servicio >= 0);
alter table public.incidencia    add constraint incidencia_sla_positivo
  check (sla_horas is null or sla_horas > 0);
```
Falta además la reversión escrita (el molde a copiar es la 0045 del PR #7,
`1b29ed6`), que `0043_triggers_faltantes.sql:31` sondee el **cuerpo** del trigger
y no `tgname` (PR #7 `dde6ef0`), y la FK de `app_user.id → auth.users(id)`, que
hoy es un comentario en `0001:16`.

---

## Fuera de mi dominio — para quien corresponda

- **`src/app/dashboard/pendiente.tsx:8-9`** (D1): el docstring sigue listando
  «Unidades» y «Soporte» entre las siete secciones que no tienen una sola fila
  que las alimente. Unidades ya tiene pantalla real desde la 0047. Es solo un
  comentario —no lo lee ningún usuario, por eso el grep-test de G-48 no lo
  marca—, pero es el mismo error que G-48 cerró en la pantalla.
- **G-32** (`safe()` × 16): sigue **bloqueado**. `grep -rn safeLog src/` → vacío;
  D1 todavía no publica el helper en `pg.ts`. Las cuatro copias de D5
  (`despacho/`, `pod/`, `unidades/`, `incidencias/`) están intactas y listas para
  sustituirse en una línea cada una.
- **G-15** (`viajes/page.tsx:45`): `SIN_CERRAR` sigue negando (`!== 'liquidado'`)
  donde `operacion.ts:21` y `conv.ts:130` enumeran. No se tocó: el arreglo que
  pide el plan es que `etiquetas_sincronizadas.test.ts` **descubra** los mapas, y
  ese archivo es de D1. Hoy no cambia ningún número — el constraint
  `viaje_estatus_dominio` garantiza los tres valores.
- **`src/lib/auth/tenant-efectivo.test.ts`** (D3, archivo nuevo) y
  **`src/app/admin/consola_render.test.tsx`** (D1): dan errores de `tsc` en el
  árbol compartido. Ninguno es de D5 — con esos dos archivos fuera, `tsc` sale
  limpio. `eslint src/` deja 4 warnings de imports sin usar, los cuatro en
  `src/app/admin/`.

---

## Archivos tocados

```
src/lib/cuadra/operacion.ts                     G-21, G-57, G-20(mitigación)
src/lib/cuadra/operacion.test.ts                +16 casos, mock corregido
src/lib/cuadra/migraciones_verificadas.test.ts  G-51 (guardarraíl)
src/app/dashboard/aviso-captura.tsx             NUEVO — G-21
src/app/dashboard/guardas_de_pagina.test.ts     NUEVO — G-27
src/app/dashboard/huecos_reales.test.ts         NUEVO — G-48
src/app/dashboard/despacho/page.tsx             G-21, G-34, G-47, G-20
src/app/dashboard/despacho/vista.tsx            G-20
src/app/dashboard/pod/page.tsx                  G-21, G-34, G-47
src/app/dashboard/unidades/page.tsx             G-21, G-34, G-47
src/app/dashboard/incidencias/page.tsx          G-21, G-34, G-47
src/app/dashboard/incidencias/vista.tsx         G-09
src/app/dashboard/viajes/page.tsx               G-48
src/app/dashboard/mapa/page.tsx                 G-27
src/app/dashboard/soporte/page.tsx              G-27, G-48
```

`supabase/migrations/**` y `supabase/verificaciones.sql`: **solo lectura**.
