# Backend y API — auditoría 12

**Nota: 6/10** (antes 8, auditoría 10). Razón del movimiento: la bajada no es
porque el código haya empeorado — los cierres de la ronda 10 se verificaron uno
por uno contra el código actual y los 10 siguen cerrados de verdad. Es porque
esta ronda le tocó a este rubro auditar **el fix de RLS que se escribió para
cerrar SEC-C2/DATOS-C2** (`0078`), y ese fix está **incompleto en una tabla que
es justo de la familia que decía cerrar**: `app_user` sigue legible por
cualquier rol del tenant, chofer incluido, con la misma anon key y el mismo
mecanismo que el propio encabezado de la 0078 describe. A eso se le suma que el
ALTO que la ronda 10 dejó **explícitamente pendiente** —`sendDocument` sin
revisar en `processor.ts:2083`— sigue abierto, y que el camino de dinero de
Likida a SUS clientes (`emitirMensualidad`, `timbrarFactura`, `suscripcion.ts`,
webhook de Stripe) sigue sin UNA sola prueba que lo invoque. Nada de esto es
nuevo de esta ronda; todo es verificable en el árbol actual. Lo que sí se
movió: esta ronda tenía el mandato de cerrar el hueco de RLS del chofer, y el
hueco quedó a medias.

---

## CRÍTICO

No encontré un CRÍTICO demostrable en esta ronda. Los caminos de dinero que
revisé a fondo (claim atómico de `al_vuelo.ts`, `reclamarEscalacion`,
idempotencia del webhook, `marcarEvento` de Stripe, `emitirMensualidad` con su
23505) están razonados y —los que tocan el doble CFDI— probados. El doble CFDI
no se puede producir por ninguna de las dos rutas que lo escriben.

## ALTO

### 1. `processor.ts:2083` — el PDF del operador sigue sin revisar el resultado de `sendDocument` (reincidente explícito de la ronda 10)

`src/lib/cuadra/processor.ts:2083`:

```ts
await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
```

`sendDocument` **no lanza** desde la ronda 10 (`src/lib/meta/client.ts:325-369`):
un rechazo de Meta devuelve `{ok:false, error, codigo}`. El propio comentario de
`meta/client.ts:318-324` lo dice con todas las letras: *"Los llamadores que
hacen `await sendDocument(...)` sin mirar el resultado siguen compilando sin
cambios… queda pendiente que esos dos la usen"*. La ronda 10 arregló UNO de los
dos call sites (`avisar_cierre.ts:127-133`, verificado: `if (!r.ok) logger.warn(...)`
está puesto) y dejó escrito en su reporte que este otro quedaba para quien lo
cerrara. Nadie lo cerró.

**Escenario con valores:** el chofer cierra su viaje; `guardar_liquidacion`
devuelve `pdf_generado: true`; se firma la URL (TTL 60 s) y se llama
`sendDocument`. Meta rechaza con `400 (#131030) Recipient phone number not in
allowed list` — el mismo error que ya pasó en producción (documentado en
`meta/client.ts:330-340`) — o con 429 por rate limit. `sendDocument` loguea
`wa.sendDocument` y devuelve `{ok:false}`. En `processor.ts` **no hay `if`**:
el flujo sigue a `registrarCostoWhatsApp` (el envío se cobra como hecho), al
aviso al jefe, y el `catch` de abajo —que es el único que escribía
`pdf.no_entregado` y el mensaje "no pude generarte el PDF"— **no se dispara**,
porque no hubo excepción. El operador se queda esperando el documento que el
prompt le prometió, la liquidación queda cerrada, y el acuse `wa.no_entregado`
del webhook **nunca llega** para un 4xx (Meta solo reporta `failed` para
mensajes que ACEPTÓ y luego no pudo entregar). Es el mismo estado
"registrado como entregado algo que no se entregó" que la ronda 10 calificó
ALTO en `avisar_cierre` y arregló; el mismo bug, un call site más arriba.

**Estado: abierto.** (Reincidente de ronda 10, dejado pendiente ahí a
propósito; el código no cambió.)

### 2. `0078` no cierra `app_user` — el chofer sigue leyendo el directorio de usuarios de la flota (el fix de RLS está incompleto)

La migración que esta ronda escribe para cerrar SEC-C2/DATOS-C2
(`supabase/migrations/0078_rls_chofer_sin_escritura.sql`) enumera en su
encabezado lo que un chofer con sesión + anon key podía leer:
`operador`, `wa_conversacion`, `cfdi_xml`, `cfdi_consolidado_linea`,
`llm_costo`, `terminal`, `politica_gasto` y `tenant`. Cierra las 7 primeras con
`not is_operador()` y `tenant` a solo lectura. **No toca `app_user`**, cuya
policy sigue siendo la de `0001_init.sql:127-128`:

```sql
create policy app_user_self on app_user for select
  using (id = auth.uid() or tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

`get_user_tenant_ids()` (`0001_init.sql:95-100`, SECURITY DEFINER) devuelve el
tenant de QUIEN LLAMA — y el chofer tiene `tenant_id` en su propia fila de
`app_user`. Así que la cláusula `tenant_id = any(get_user_tenant_ids())` le
devuelve **todas las filas de `app_user` de su flota**: `email` (columna
`text not null unique`, `0001_init.sql:17`), `nombre`, `rol`, `operador_id` y
`avatar_url`.

**Escenario con valores:** chofer de la flota A entra a `/chofer` (sesión de
Supabase válida) y, con la anon key pública, hace
`GET /rest/v1/app_user?select=email,nombre,rol` con su token. Respuesta: el
correo, el nombre y el rol del `flota_admin` de su flota, del `contador`, de
todos los demás choferes. Datos personales de terceros (LFPDPPP) — la MISMA
familia que la 0078 cierra para `operador` ("leer y MODIFICAR los teléfonos y
nombres de TODA la flota") y para `wa_conversacion`. No puede MODIFICAR
(no hay policy de UPDATE — RLS niega), así que el vector de robo de identidad
de WhatsApp no está; pero la lectura del directorio completo de la flota
(correos + nombres + roles) sigue abierta por la puerta que la 0078 no miró.

Además verifiqué que la app NO necesita esa cláusula amplia para nada:
`session.ts:35` lee `app_user` por `id = user.id` (self-only alcanza), y
`/dashboard/usuarios` lee con `supabaseAdmin()` (service-role, salta RLS).
La cláusula de tenant existe desde 0001 y no la usa ningún cliente de sesión.

**Estado: abierto.** Es un hueco del fix que esta misma ronda publicó; la
migración 0078 debería añadir `app_user_self` con
`using (id = auth.uid() or is_superadmin())` (o `and not is_operador()`).

### 3. El camino de dinero de Likida→clientes sigue sin una sola prueba que lo invoque (reincidente de ronda 10)

La ronda 10 lo documentó como "ALTO para la siguiente": `emitirMensualidad` y
`timbrarFactura` (`src/lib/saas/transferencia.ts:148-280`) — las dos funciones
que ESCRIBEN dinero en `factura_saas` y crean CFDI ante el SAT — no tenían
ningún test. Verificado esta ronda con `grep` y con la corrida:

- `src/lib/saas/transferencia.test.ts` (12 pruebas) solo cubre `clabeValida`,
  `referenciaDe` y `datosBancarios` — **cero invocaciones** de
  `emitirMensualidad(` o `timbrarFactura(`.
- `src/lib/saas/suscripcion.ts` (módulo completo: `marcarEvento`,
  `aplicarSuscripcion`, `aplicarFactura`, `estadoDesdeStripe`) **no tiene
  archivo de test** (`ls` no lo encuentra).
- `src/app/api/stripe/webhook/route.ts` — endpoint PÚBLICO que convierte un
  pago en plan activo — **no tiene route test**.

Los tres caminos protegen decisiones irreversibles: `emitirMensualidad` se
niega a emitir sin criterio de IVA y sin moneda MXN; `timbrarFactura` se niega
a timbrar sin `subtotal`/`iva` guardados; `marcarEvento` usa el insert como
candado de idempotencia con 23505. El código se LEE correcto (lo leí línea por
línea, incluida la rama `23505` de `transferencia.ts:198-201` y el
`desmarcar` del webhook en `route.ts:78-92`), pero es exactamente el sesgo que
este rubro tiene la obligación de nombrar: nada de esto se ha ejercitado ni
una vez, y un cambio futuro que invierta el criterio de IVA pasaría la suite
completa en verde mientras timbra el 16% de más.

**Estado: abierto.** Sin cambio desde la ronda 10.

## MEDIO

### 4. `/api/export/liquidaciones` recorta a 5,000 filas en silencio

`src/app/api/export/liquidaciones/route.ts:61`:

```ts
.limit(5000);
```

La consulta pide las `liquidacion` del tenant con `.limit(5000)`, sin `count`,
sin paginación y sin aviso. Un contralor baja el CSV para su ERP/Excel; si la
flota tiene 5,001+ liquidaciones, el archivo trae 5,000 y **nadie lo dice**.
Es exactamente el modo de fallo que `pg.ts` existe para cerrar
(`traerTodo`/`LecturaIncompleta`: "una página corta ahora significa pide la
siguiente, no ya terminamos") — la doctrina del repo es que un recorte
silencioso se lee como "esto es todo lo que hay", y aquí se reintroduce el
mismo recorte, con techo más alto. El dato que falta es el peor tipo: filas
viejas de `liquidacion` (el histórico que el contador cruza contra sus papeles
de meses anteriores).

**Escenario con valores:** flota con 5,300 liquidaciones acumuladas (a 22
gastos por viaje y 100 viajes/mes, ~4.4 años de operación). Export → CSV con
5,000 filas. La conciliación del contador no cuadra contra su ERP y no hay
forma de saber por qué desde el archivo.

**Estado: abierto.**

### 5. `asignarUnidad`, `crearIncidencia` y `marcarPodPedido` escriben ids de otras tablas sin verificar que sean del tenant

El patrón que la ronda 10 cerró para `crearViaje` (`operacion.ts:505-523`,
`unidadPropia`/`operadorPropio`, con su comentario "el `<select>` de
/dashboard/despacho solo ofrece los de `listOperadores(tenantId)`, pero eso es
la UI, no el servidor") **no se replicó** en las tres funciones vecinas del
mismo módulo:

- `src/lib/cuadra/operacion.ts:655-663` — `asignarUnidad`: acota el VIAJE por
  tenant pero escribe `unidad_id` sin comprobar que la unidad sea del tenant.
- `src/lib/cuadra/operacion.ts:705-727` — `crearIncidencia`: inserta
  `viaje_id` y `unidad_id` sin ninguna verificación de pertenencia.
- `src/lib/cuadra/operacion.ts:382-394` — `marcarPodPedido`: inserta
  `viaje_id` y `operador_id` sin verificación.

**Escenario con valores:** `flota_admin` de A arma un POST directo al server
action de `/dashboard/despacho` (devtools; misma sesión válida) con
`unidadId` = uuid de una unidad de la flota B, que conoce de un export o de un
id filtrado en algún log. `asignarUnidad` escribe `viaje.unidad_id` cruzando
flotas. La RLS de `unidad` protege las LECTURAS (acotadas por tenant), así que
hoy no hay fuga directa — a diferencia del `operador_id` de la ronda 10, que
SÍ filtraba en la RLS del chofer. Pero la fila queda con una referencia
cruzada que ningún JOIN futuro sin filtro va a saber que es ajena, y el patrón
es exactamente el que el repo documenta como su fallo más común: "se acota el
tenant y se olvida el segundo id".

**Estado: abierto.** (Misma familia que el ALTO/MEDIO cerrado en ronda 10 para
`crearViaje`; estas tres funciones se quedaron sin el candado.)

## BAJO

### 6. `/api/dashboard/asistente` convierte cualquier fallo de lectura en `null`, y el rail no lo distingue

`src/app/api/dashboard/asistente/route.ts:60-66`:

```ts
const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
  try { return await fn(); } catch { return null; }
};
```

Un error de base (o de red) deja `kpis: null`, y `src/app/dashboard/rail.tsx`
(consumidor cliente) pinta **nada**: `anomalias && ...` es false, `kpis &&
kpis.viajesLiquidados > 0` es false, renderiza `null`. No miente (no dice
"0%" ni "sin anomalías"), pero tampoco dice que no pudo leer — el patrón que
este mismo repo ya estableció en `costos-facturacion/page.tsx:230-240`
("No se pudieron leer los planes… Recarga en un momento") no se replica en el
rail que está en las 20 páginas del dashboard. Un bache de Supabase deja el
widget en blanco sin rastro en pantalla; solo el `logger` del server lo dice.

**Estado: abierto.**

### 7. `bitacora_insercion` permite a CUALQUIER usuario del tenant (chofer incluido) insertar filas de auditoría

`supabase/migrations/0053_cuentas_bitacora_arco_campanias.sql:199`:

```sql
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());
```

Append-only (no hay UPDATE/DELETE), así que no se puede borrar ni corregir lo
que ya está — pero un rol=operador puede **forjar** entradas ("flota.creada",
"operador.creado", "facturacion.aviso_enviado"…) dentro de su tenant. Una
bitácora de auditoría que acepta escritura de quien audita pierde valor como
evidencia. Impacto bajo hoy (no hay proceso que tome decisiones por la
bitácora), pero es la clase de política que la 0078 barrió para `llm_costo` y
`terminal` y no miró aquí.

**Estado: abierto.**

### 8. La resolución del `?tenant=` de superadmin se hace sin revisar `error` en 14 sitios

`src/lib/auth/tenant-api.ts:57` y las 13 páginas del dashboard
(`unidades:53`, `pod:53`, `incidencias:53`, `documentos:78`, `suscripcion:90`,
`politicas:65,83`, `operadores:131`, `despacho:68`, `combustible-casetas:116`,
`[id]:104`):

```ts
const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', sp.tenant).maybeSingle();
if (data) t = data.id as string;
```

Sin revisar `error`, un bache de red se ve idéntico a "ese uuid no existe": el
`data` es `null` en los dos casos. Consecuencia: un superadmin que aprieta
"Emitir mensualidad" o "Guardar política" en la página de la flota X con la
base parpadeando escribe en el tenant de su sesión (el demo) en silencio. Los
comentarios de `tenant-api.ts:49-52` justifican el silencio para el uuid que no
existe (correcto — un enlace viejo no debe fallar), pero no distinguen el caso
de error de red, que es la familia "error por valor" que este rubro persigue.
El write siguiente fallaría si la base sigue caída, pero un parpadeo de lectura
con escritura posterior exitosa sí alcanza a escribir en el tenant equivocado.

**Estado: abierto.**

---

## Ronda 10, verificado en el código actual: los cierres siguen cerrados

No los doy por buenos por el título del commit — los abrí uno por uno.

- **`avisar_cierre.ts` ya revisa `r.ok`** (`src/lib/cuadra/avisar_cierre.ts:127-133`):
  `const r = await sendDocument(...); if (!r.ok) logger.warn('cierre.pdf_al_jefe_falló', ...)`
  con el try/catch como red. El test que lo ata existe y pasa (9/9).
- **`escalar_viaje.ts` ya tiene el claim atómico** (`escalar_viaje.ts:239-245`
  y `reclamarEscalacion` en `:297-323`): UPDATE condicional
  `.is('escalado_en', null)` ANTES de mandar cualquier mensaje; cero filas =
  otra corrida ganó, y no es error. 28/28 verdes.
- **`al_vuelo.ts` claim intacto** (`al_vuelo.ts:613-656`): `reclamarIntentos`
  con `.is('cfdi_uuid', null).is('autofactura_bloqueada_en', null).or(...vencido)`
  devolviendo filas; 55/55 verdes, incluidas las pruebas de doble CFDI y del
  lote con cero ganadores que la ronda 10 agregó.
- **`reasignarOperador`/`crearViaje`** verifican pertenencia de
  `operador_id`/`unidad_id` (`repo.ts:125-140`, `operacion.ts:505-523`). El
  ALTO de seguridad de la ronda 10 está cerrado de verdad.
- **`reabrirViaje` toma el mutex** (`administracion.ts:375-390`:
  `acquireViajeLock` antes de leer la liquidación, con el `errLiq` comprobado).
- **23505 disciplinado**: `pg_errores.ts` (exige `code === '23505'` + nombre
  del índice, nunca mensaje suelto), `conv.ts:349-351` (claimMessage),
  `conv.ts:262-280` (carrera del insert de conversación: choca, relee, y
  cualquier otro índice lanza), `suscripcion.ts:282-293` (marcarEvento),
  `transferencia.ts:198-201` (mensualidad duplicada → `DatoInvalido` que dice
  "No se cobra dos veces el mismo mes").

## Lo que revisé y está bien

- **Permisos en server actions** — las ~30 acciones de los 20 archivos con
  `'use server'` pasan por su puerta: `requireSuperadmin` en las 6 de /admin
  (flotas, usuarios/nuevo, mi-perfil ×2, costos-facturacion ×3), y en
  /dashboard `requireSessionTenant` + `puedeAdministrar`/`puedeAsignar`
  re-chequeado DENTRO de la acción (nunca solo en el render). Verifiqué los
  que más escriben: `politicas`, `suscripcion` (3 acciones), `operadores`,
  `[id]` (reabrir + reasignar), `despacho`, `combustible-casetas`,
  `unidades`, `incidencias`, `pod`. El patrón `tenantDelAction` re-resuelve el
  tenant desde la sesión en cada petición, no del closure del render.
- **Permisos en rutas de API** — los tres crons exigen `Authorization: Bearer
  <CRON_SECRET>` y fallan 500 (no 200) sin secreto; el webhook de WhatsApp
  verifica HMAC + cap de body (413) + 429 con `Retry-After` cuando sobra
  trabajo (Meta reentrega, y la idempotencia por `waMessageId` hace el
  reintento seguro); el webhook de Stripe verifica HMAC, contesta 500 para que
  Stripe reintente y desmarca el evento antes de rendirse; las tres rutas de
  export exigen sesión + tenant resuelto de la sesión + `puedeVerArea('dinero')`
  + `puedeExportar` — el IDOR de operador/encargado sigue cerrado.
- **Errores por valor** — `exigir`/`traerTodo` (`pg.ts`) intactos y usados en
  `analytics.ts`, `fiscal.ts`, `operacion.ts`, `chofer.ts` (revisé los call
  sites nuevos: `getGastosFiscales` pide `conteo(desde)` en la primera página;
  `getLiquidacionDetalle` usa `exigir`). `session.ts` reintenta UNA vez antes
  de fallar cerrado y distingue `SIN_ROL`.
- **Webhook de WhatsApp** — el pool de 5 (`route.ts:74-96`), el 429 como cola
  (`:226-242`), los acuses `failed` con `wa.no_entregado`, y el `after()` con
  `flushObservabilidad`. Los 4 archivos de test de la ruta pasan (40 tests).
- **Corridas**: `npx vitest run` sobre el rubro (webhook, crons, conv,
  pg_errores, avisar_cierre, al_vuelo, escalar_viaje, transferencia) — 8
  archivos, 85 tests verdes en la primera pasada, más 55 de al_vuelo, 28 de
  escalar y 12 de transferencia. No corrí la suite completa (la corren otros
  rubros).

## Lo que no alcancé a revisar

- `src/lib/cuadra/facturacion/enrutar.ts` y `pendientes.ts` — los leí de
  pasada siguiendo el camino del cron (los usa `armar()`) pero no los audité
  como unidad propia; tampoco `adaptadores/capufe.ts` (~2,700 líneas), que
  sigue siendo de otro rubro (rendimiento/fiscal).
- Confirmación empírica contra Postgres real de que la 0078 aplica limpia y de
  que la 0072 (`mantenimiento_de_datos`) está aplicada — no tengo acceso de
  base de datos desde este rubro; el cron `purgar` depende de que esa RPC
  exista.
- El `demo/route.ts` usa `POLITICA` marcada explícitamente como "INVENTADO…
  Ajústala con la política real de Innovativos" (`route.ts:30-40`) — es el
  motor real cuadrando con una política de fantasía. Lo dejo anotado por si el
  guion del demo de mañana cuadra contra números que no son los de
  Innovativos; no es un bug del backend, es una decisión de demo.

## Veredicto

**No es green light para backend.** Dos ALTOs abiertos y verificables en el
código actual —el PDF del operador que se puede perder sin consecuencias en el
pipeline (`processor.ts:2083`) y el hueco de RLS de `app_user` que deja la
0078 a medias— más el ALTO reincidente de cobertura en el camino de dinero.
El fix estrella de esta ronda (0078) cierra 7 tablas y `tenant`, pero deja
abierta la octava con la información personal de TODA la flota, con el mismo
mecanismo (chofer + anon key) que el propio encabezado de la migración
describe como el vector. Ninguno de los tres es difícil de cerrar: el primero
es un `if (!r.ok)` más un `logger.error`/mensaje al operador (el patrón ya
existe dos líneas abajo en el mismo archivo); el segundo es una línea de
policy; el tercero es trabajo de pruebas de una ronda propia. Lo que está
sólido —guardias de rutas y server actions, 23505, claims atómicos, crons con
secreto, HMACs— se sostiene; lo que esta ronda debía cerrar no quedó cerrado.
