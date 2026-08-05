# Backend y API — auditoría 13

**Nota: 7/10** (antes 8, re-auditoría de la ronda 12; 6 en la primera pasada).
Razón del movimiento: los cuatro hallazgos de backend de la ronda 12 están
cerrados de verdad — los abrí uno por uno contra el árbol actual (`caae369`,
que es lo que está en producción) y el código hace lo que el commit dice. Lo
que baja la nota es que **el cierre de uno de ellos quedó a medias en la
propia línea que la ronda 12 citó**: el `?tenant=` de superadmin sin revisar
`error` sigue vivo en `resolverTenantApi` (`tenant-api.ts:56-64`) — el primer
sitio de la lista de "14 sitios" del BAJO #8 — y de ahí cuelgan las DOS rutas
de export, que son justo el camino que produce un archivo con datos de la
flota equivocada. A eso se suman dos recortes silenciosos que esta ronda
encontró en el código actual: el export paginado de la ronda 12 viola el
contrato de `traerTodo` (ordena por `created_at` sin desempate único, con el
`count` dando por completa una lectura que puede duplicar/saltar filas), y
`getPorFacturar` (`pendientes.ts:119-125`) recorta a 500 sin decir nada — la
misma familia "una página corta se lee como ya terminamos" que este rubro
lleva tres rondas persiguiendo, ahora en el número que el aviso de WhatsApp
le manda al encargado. Ninguno es crítico para el demo de mañana; los tres
son verificables en el árbol actual.

---

## CRÍTICO

No encontré un CRÍTICO demostrable. Los caminos que revisé a fondo esta ronda
—cierre atómico (`saveLiquidacion` → `guardar_liquidacion_tx`), claims de
`al_vuelo.ts` y `escalar_viaje.ts`, idempotencia del webhook de Stripe
(`marcarEvento` con 23505 + `desmarcar` en 500), doble CFDI bloqueado en
`timbrarFactura`, mutex de `reabrirViaje`, puertas de las ~30 server actions y
de las 8 rutas de API— están razonados y, donde tocan dinero, probados.

## ALTO

No encontré un ALTO nuevo demostrable. Los tres ALTO de la ronda 12
(`sendDocument` sin revisar, RLS de `app_user`, camino de dinero sin pruebas)
están cerrados; lo que queda de ellos es un residual BAJO (ver #4) y una
cobertura parcial del webhook de Stripe (ver #7).

## MEDIO

### 1. El `?tenant=` sin revisar `error` sigue en la línea que la ronda 12 citó — `resolverTenantApi` (cierre parcial del BAJO #8 de la ronda 12)

`src/lib/auth/tenant-api.ts:56-64`:

```ts
const pedido = new URL(url).searchParams.get('tenant');
if (pedido && s.rol === 'superadmin') {
  const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
  if (data) tenantId = data.id as string;
}
```

El commit `8ced786` ("fix(backend): el ?tenant= de superadmin distingue 'no
existe' de 'no pude preguntar' (AUDITORÍA 12, BAJO ×14 sitios)") creó
`resolverTenantPedido` y convirtió **las 10 páginas del dashboard (12 call
sites)**, pero no tocó esta función — que es **el primer sitio de la lista
que la propia ronda 12 citó** (`tenant-api.ts:57`) y la que usan las DOS rutas
de export (`/api/export/liquidaciones/route.ts:23` y
`/api/export/pdf/[id]/route.ts:39`). El `error` se sigue descartando en el
destructuring.

**Escenario con valores:** superadmin abre la flota X desde /admin/flotas
("Ver dashboard" → `?tenant=<X>`), la base parpadea un instante en la
comprobación del uuid, `data` es `null`, y `tenantId` se queda en el tenant
demo de la sesión. Aprieta "Exportar a CSV": la ruta responde **200** con el
CSV de la flota demo completo (folio, operador, anticipo, comprobado,
diferencia por viaje) mientras la pantalla que lo ofreció dice Transportes
Innovativos. El encabezado del propio archivo (`tenant-api.ts:30-40`) lo
define: "un archivo con datos de otra flota es peor que un botón muerto". El
comentario de `:59-62` justifica el silencio para el uuid que NO existe (un
enlace viejo no debe fallar — correcto), pero no distingue el error de red,
que es la familia "error por valor" que este rubro persigue.

Misma familia, misma ronda, sin cerrar:
- `src/app/api/dashboard/asistente/route.ts:56-58` — el rail de las 20
  páginas resuelve el `?tenant=` a mano, sin `error`. Un parpadeo deja
  `tenantId` en el demo y el rail pinta las KPIs del demo debajo de la página
  de la flota X — la "dos verdades distintas en la misma pantalla" que el
  encabezado del propio archivo describe como el bug que esta ruta existe
  para evitar.
- `src/lib/auth/tenant-efectivo.ts:121-126` — la resolución de `?tenant=`
  para las páginas tampoco revisa `error` (el chequeo de existencia posterior,
  `:133-136`, sí lo maneja — pero solo para el tenant ya resuelto, que en el
  blip ya es el equivocado).
- `src/app/dashboard/contador/cfdi/export/route.ts:53-57` — mismo patrón,
  pero ahí el superadmin no tiene tenant de sesión, así que el blip cae a
  400 (fail-loud, mensaje ligeramente engañoso, sin datos equivocados).

**Estado: abierto (cierre parcial).** Los writes de las páginas quedaron
fail-loud vía `resolverTenantPedido`; los reads de API y el rail no.

### 2. El export paginado de la ronda 12 viola el contrato de `traerTodo`: ordena por `created_at` sin desempate único

`src/app/api/export/liquidaciones/route.ts:65-72`:

```ts
filas = await traerTodo(
  (d, h) => supabaseAdmin().from('liquidacion')
    .select('created_at, …', conteo(d))
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(d, h),
  'export.liquidaciones',
);
```

El contrato de `traerTodo` lo dice con todas las letras (`pg.ts:197-199`):
*"LA CONSULTA TIENE QUE VENIR ORDENADA POR ALGO ÚNICO. […] Todos los llamadores
desempatan con `id`"*. Los 13 llamadores de `analytics.ts` lo cumplen
(`.order('id')`); este —el único que la ronda 12 agregó— ordena solo por
`created_at`, que no es único. Y el escenario concreto ya existe en la base
del demo: el seed (`seed.sql:151-158`) inserta las 3 liquidaciones de
historial en UN solo `INSERT`, y `created_at default now()` =
`transaction_timestamp()`, así que las tres comparten el MISMO timestamptz.

**Escenario con valores:** flota con 5,300 liquidaciones (el caso que la
ronda 12 cerró para el techo de 5,000), de las cuales 3 comparten `created_at`
—las del seed, o dos cierres del mismo lote— y ese grupo cae exactamente en
una frontera de página (posiciones 999-1001 del `range`). Postgres no
garantiza orden entre filas empatadas sin ORDER BY único: la página siguiente
puede repetir una fila que ya salió y saltarse otra. El `count` de la primera
página da `filas.length >= esperadas` y `traerTodo` devuelve "completa" — con
una fila duplicada y otra ausente en el CSV que el contralor cruza contra su
ERP. Probabilidad baja (necesita >1,000 filas + empate en la frontera + orden
no determinista), consecuencia cara: el recorte silencioso exacto que este
rubro persigue, ahora con un techo que se declara "demostrado completo". El
fix es una línea: `.order('created_at', { ascending: false }).order('id')`.

**Estado: abierto.** (Defecto introducido por el propio cierre `003f22e`.)

### 3. `getPorFacturar` recorta a 500 filas en silencio — la pantalla "por facturar" y el aviso de WhatsApp subestiman

`src/lib/cuadra/facturacion/pendientes.ts:119-125`:

```ts
const { data, error } = await supabaseAdmin()
  .from('gasto')
  .select('…')
  .eq('tenant_id', tenantId)
  .is('cfdi_uuid', null)
  .order('fecha', { ascending: true, nullsFirst: false })
  .limit(500);
```

Sin `count`, sin paginación, sin aviso. Y el número cortado no es decorativo:
`avisarPorFacturar` (`avisar.ts:110`) consume esta misma función, y el
parámetro que la plantilla `plazo_factura` manda al encargado por WhatsApp es
`String(cuantos)` — el conteo de `armarAviso` sobre los tickets recortados.

**Escenario con valores:** flota con 23 viajes sin facturar (22 gastos por
viaje ≈ 506 tickets sin CFDI — el 95% real que el propio comentario de
`pendientes.ts:9-12` documenta). El encargado recibe: "Tienes 500
comprobante(s) sin factura" cuando hay 506; el "…y N más en el panel" del
final también nace del arreglo recortado. La corrida del cron NO se afecta
(trae su propia consulta con `TOPE_POR_CORRIDA+1` y su propio conteo), pero la
pantalla y el canal que despierta a la persona sí. Es la misma doctrina que
`pg.ts` existe para cerrar y que este rubro marcó en la ronda 12 en el export
de 5,000: aquí con techo más bajo y en el dato que decide si alguien va a
facturar a tiempo.

**Estado: abierto.** (Nuevo; `pendientes.ts` quedó fuera de la lista de la
ronda 12, que solo lo leyó de pasada.)

## BAJO

### 4. El rechazo de Meta al PDF del operador deja rastro, pero no le dice nada al operador (residual del cierre de la ronda 12)

`src/lib/cuadra/processor.ts:2131-2140`:

```ts
const enviado = await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
if (!enviado.ok) {
  logger.error('pdf.no_entregado', { … });
} else {
  await registrarCostoWhatsApp(op.tenantId, viajeId);
}
```

El ALTO de la ronda 12 (PDF rechazado sin rastro y cobrado como enviado) está
cerrado: hay `logger.error('pdf.no_entregado')` y el costo solo se registra en
el `else`. Pero la ronda 12 recomendó explícitamente "un `if (!r.ok)` más un
`logger.error`/**mensaje al operador** (el patrón ya existe dos líneas abajo
en el mismo archivo)" — y el mensaje al operador solo existe en la rama de
EXCEPCIÓN (el `catch` de `:2158-2166`), no en la de rechazo.

**Escenario con valores:** el chofer cierra su viaje; `sendDocument` devuelve
`{ok:false, codigo:131030}` (destinatario fuera de la lista de Meta — el error
que ya pasó en producción, documentado en `meta/client.ts:330-340`). Se loguea
`pdf.no_entregado` y el flujo sigue: el jefe SÍ recibe su PDF por el otro
`sendDocument` de `avisarCierreAlJefe`, la conversación se guarda, y el
operador se queda esperando el documento que el prompt le prometió, sin ningún
mensaje de reposición. El `catch` que sí le habla no se dispara porque no hubo
excepción. En el demo es el paso 3 del guion fallando con rastro en el log y
silencio en el teléfono del chofer.

**Estado: abierto** (residual — el ALTO está cerrado con commit `48b5405`;
queda la mitad del remedio que la propia ronda 12 prescribió).

### 5. `provisionarUsuario` acepta cualquier rol del dominio desde el POST, sin validar contra la UI

`src/app/admin/usuarios/nuevo/page.tsx:29-34`:

```ts
const rol = formData.get('rol') as RolAppUser;
if (!tenantId || !email || !rol) redirect('/admin/usuarios/nuevo?error=1');
await provisionarUsuario(tenantId, email, nombre, rol);
```

El `<select>` solo ofrece 4 de los 5 roles (sin `superadmin`), pero la action
no valida que el valor venga de esa lista: un POST directo con `rol=superadmin`
crea una segunda cuenta de superadmin; con `rol=operador` crea un chofer sin
`operador_id` (que queda en /sin-acceso). Un valor fuera del dominio lo frena
el CHECK `app_user_rol_dominio` de la 0044, y el único que puede llamar esto es
un superadmin (que ya podría crear superadmins por SQL directo), así que el
impacto es de consistencia, no de escalada. El comentario de `provisionar.ts`
("`superadmin` se pide explícito") promete una restricción que el server
action no aplica.

**Estado: abierto.**

### 6. Comentario muerto en `meta/client.ts`: "queda pendiente que esos dos la usen"

`src/lib/meta/client.ts:318-324` (comentario de `sendDocument`):

> "Los llamadores que hacen `await sendDocument(...)` sin mirar el resultado
> siguen compilando sin cambios: el arreglo es retrocompatible a propósito,
> porque los dos call sites viven en archivos de otros agentes
> (`processor.ts:1840` y `avisar_cierre.ts:117`). Lo que este cambio hace es
> DAR la información; queda pendiente que esos dos la usen — ver la nota en el
> reporte."

Los dos call sites YA la usan desde la ronda 12: `processor.ts:2131` revisa
`enviado.ok` y `avisar_cierre.ts:127-133` revisa `r.ok`. El comentario apunta
además a líneas que ya no existen. Un auditor futuro (o un agente) que lea el
comentario va a ir a "arreglar" algo ya arreglado. Cosmético, pero es
exactamente el tipo de rastro que esta ronda verifica línea por línea.

**Estado: abierto** (cosmético).

### 7. El webhook de Stripe sigue sin route-test (cierre parcial del ALTO 3 de la ronda 12)

El ALTO 3 ("el camino de dinero sin una sola prueba") está cerrado de verdad
en lo sustantivo: `transferencia_mensualidad.test.ts` (11 pruebas) invoca
`emitirMensualidad` y `timbrarFactura` —incluida la rama del 23505 y la del
desglose faltante— y `suscripcion_eventos.test.ts` (6 pruebas) cubre
`marcarEvento` (idempotencia), `estadoDesdeStripe` y `aplicarSuscripcion`.
Corridas y verdes (41/41 en los cuatro archivos de saas). Pero
`src/app/api/stripe/webhook/route.ts` —el endpoint PÚBLICO que convierte un
pago en plan activo— sigue sin un solo test de ruta: las ramas del HMAC
inválido, del 503 sin secreto, del `desmarcar` en el 500 y del evento repetido
que contesta 200 no se ejercitan desde fuera. No es un defecto de código (la
ruta se lee correcta), es cobertura que sigue sin existir donde el error es
irreversible.

**Estado: abierto (parcial).**

---

## Ronda 12, verificado en el código actual: los cierres siguen cerrados

No los doy por buenos por el título del commit — los abrí uno por uno.

- **`sendDocument` revisado en `processor.ts:2131-2140`** — `if (!enviado.ok)`
  con `logger.error('pdf.no_entregado')` y `registrarCostoWhatsApp` solo en el
  `else` (el envío rechazado ya no se cobra como hecho). El comentario del fix
  está puesto. `avisar_cierre.ts:127-133` también revisa `r.ok` (verificado).
- **`app_user` y `bitacora_insercion` cerrados por la 0079** —
  `supabase/migrations/0079_rls_chofer_sin_lectura_personal.sql`: `app_user_self`
  con `id = auth.uid() or (tenant_id = any(get_user_tenant_ids()) and not
  is_operador()) or is_superadmin()` y `bitacora_insercion` con
  `with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador())
  or is_superadmin())`. El chofer ya no lee el directorio de la flota ni
  forja bitácora. El comentario de la 0079 documenta el porqué con las dos
  referencias exactas.
- **Ids referidos verificados por flota** — `marcarPodPedido`
  (`operacion.ts:387-393`: `viajePropio` + `operadorPropio`), `asignarUnidad`
  (`operacion.ts:686-688`: `unidadPropia`), `crearIncidencia`
  (`operacion.ts:740-745`: `viajePropio` + `unidadPropia`). Los helpers
  `viajePropio`/`unidadPropia`/`operadorPropio` existen en `operacion.ts:501-525`.
- **Export paginado** — `traerTodo` + `conteo(d)` + manejo de
  `LecturaIncompleta` con 500 explícito (ver MEDIO #2 para el defecto de orden).
- **`?tenant=` de las páginas** — las 10 páginas usan `resolverTenantPedido`
  (fail-loud con `error` comprobado, `tenant-api.ts:70-90`). Ver MEDIO #1 para
  lo que quedó fuera.
- **Rail con `errorCarga`** — `asistente/route.ts:60-72`: `safe` devuelve
  `{ok:false}` y la respuesta trae `errorCarga: true`; `rail.tsx:73,117` pinta
  "no se pudo leer" en vez de nada.
- **Camino de dinero con pruebas** — ver BAJO #7; 41/41 verdes en los cuatro
  archivos de `lib/saas`.
- **`al_vuelo.ts` / `escalar_viaje.ts` / `reabrirViaje`** — claims intactos
  (`al_vuelo.ts:627-668` con `.is('cfdi_uuid', null).is('autofactura_bloqueada_en', null)`;
  `escalar_viaje.ts:302` `reclamarEscalacion` con `.is('escalado_en', null)`;
  `administracion.ts:381` `acquireViajeLock` antes de leer la liquidación, con
  `errLiq` comprobado). 124/124 en los cinco archivos de prueba que los atan.

## Lo que revisé y está bien

- **Permisos en server actions** — las ~30 acciones de los 20 archivos con
  `'use server'` pasan por su puerta y la repiten DENTRO de la acción:
  `requireSuperadmin` en las de /admin (flotas, usuarios/nuevo, mi-perfil ×2,
  costos-facturacion ×3 — verificadas `accionPrecio`/`accionEmitir`/
  `accionConciliar`), y en /dashboard `requireSessionTenant` +
  `puedeAdministrar`/`puedeAsignar`/`puedeVerRuta` re-chequeado dentro
  (despacho ×2, [id] reabrir+reasignar, politicas, suscripcion ×3, operadores,
  unidades ×2, incidencias ×2, pod ×2, documentos, combustible-casetas). El
  patrón `tenantDelAction`/`tenantYUsuarioDelAction` re-resuelve el tenant de
  la sesión en cada petición y pasa por `resolverTenantPedido` (fail-loud)
  para el `?tenant=` de superadmin.
- **Permisos en rutas de API** — los tres crons exigen `Authorization: Bearer
  <CRON_SECRET>` y fallan 500 (no 200) sin secreto; el webhook de WhatsApp
  verifica HMAC timing-safe + cap de body (413) + pool de 5 + 429 con
  `Retry-After` y los acuses `failed` → `wa.no_entregado`; el webhook de
  Stripe verifica HMAC, contesta 503 sin secreto, 500 con `desmarcar` antes de
  rendirse; las rutas de export exigen sesión + tenant resuelto + `puedeVerArea('dinero')`
  + `puedeExportar` (el IDOR de operador/encargado sigue cerrado, con su
  comentario).
- **Errores por valor** — `exigir`/`traerTodo`/`LecturaIncompleta` (`pg.ts`)
  intactos; los 13 llamadores de `traerTodo` en `analytics.ts` ordenan por
  `id`; `session.ts` reintenta una vez y distingue `SIN_ROL` (con su log
  `session.app_user_error`); `reabrirViaje` comprueba `errLiq`; `conv.ts`
  maneja la carrera del insert con `violaIndice` y relee; `costos.ts` no
  registra el costo del PDF no enviado; `claimMessage` devuelve
  'indeterminado' en vez de abandonar.
- **Camino de dinero** — `emitirMensualidad` exige precio, moneda MXN y
  criterio de IVA; `timbrarFactura` exige desglose + `cfdi_uuid` + estado
  'pagada'; `conciliar` exige referencia de banco; `facturapi.ts` impide
  timbrar en producción con llave de sandbox; `aplicarSuscripcion` upserta por
  `stripe_subscription_id` y cierra la prueba previa. Todo con su prueba nueva.
- **Demo de mañana** — seed con VJ-2026-0847 abierto (anticipo $10,600), los 2
  gastos precargados con `ocr_confianza` 0.97/0.96 (no `ocr_raw`), el XML del
  diésel con complemento HidroYPetro, RFC `GMX0902279I1` y las 3 liquidaciones
  de historial; la política viva va en `tenant.config.politica` (la tabla
  muerta no se toca). El `demo/route.ts` sigue con su `POLITICA` marcada
  🔴 INVENTADO — decisión de demo, no bug de backend.
- **Corridas**: webhook (60), saas (41), auth (184), facturacion (294),
  administracion/conv/avisar/escalar/al_vuelo (124), export/operacion/
  analytics (81) — 784 pruebas del rubro, todas verdes en primera pasada.

## Lo que no alcancé a revisar

- `adaptadores/capufe.ts` y `pagina_playwright.ts` (~2,700 líneas) — rubro
  fiscal/rendimiento; aquí solo verifiqué que el cron los consume con el corte
  por reloj (MARGEN_LOTE_MS) y que las 294 pruebas de facturacion pasan,
  incluidas las dos de CAPUFE con navegador real.
- `lib/admin/negocio.ts` línea por línea — verifiqué que ningún archivo de
  /dashboard lo importa (solo /admin), pero no audité sus consultas.
- Confirmación empírica contra Postgres real de la 0079/0080 aplicadas — no
  tengo acceso de base desde este rubro; los bloques 54/55 de `verificaciones.sql`
  existen y la síntesis de la ronda 12 reporta que pasan en us-east-2.
- El motor agéntico (`guardiaCifras`, memoria multi-oración) — rubro agentico.

## Veredicto

**Green light condicionado para backend.** Los tres ALTO de la ronda 12 están
cerrados de verdad (verificado en el árbol que está en producción), y no
encontré un ALTO nuevo. Lo que queda son tres MEDIO honestos y verificables:
el `?tenant=` sin revisar `error` que la ronda 12 citó y no cerró en
`resolverTenantApi` (con su CSV de la flota equivocada en el blip), el export
paginado que viola el contrato de `traerTodo` (desempate por `id`), y el
`.limit(500)` silencioso de `getPorFacturar` que subestima el aviso al
encargado. Ninguno bloquea el demo de mañana; los tres tienen arreglo de una
línea o de una consulta, y el primero es literalmente el cierre que la ronda
12 dejó a medias en su propia línea citada. Lo que está sólido —puertas de
server actions y rutas, claims atómicos, 23505 disciplinado, HMACs, fail-loud
de `pg.ts`, el cierre atómico de la liquidación— se sostiene.
