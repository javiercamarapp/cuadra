# Backend y API — nota 6/10

## Hallazgos

### [ALTO] El mutex del viaje no protege cuando de verdad hace falta
`src/lib/cuadra/processor.ts:417-425` + `src/lib/cuadra/conv.ts:128-174`.

`acquireViajeLock` devuelve `false` exactamente en el caso "otro proceso lo
tiene vigente ahora mismo" (ocupado los `maxWaitMs` completos, sin error). El
comentario de `conv.ts:161-169` razona ese `false` como "el otro va a
responder" — implica que el llamador debe RETIRARSE. Pero el llamador no lo
hace:

```ts
if (await acquireViajeLock(viajeId, { maxWaitMs: reloj.acotar(12_000) })) lockedViaje = viajeId;
else logger.warn('viaje.lock_timeout', { viaje: viajeId, restanteMs: reloj.restante() });
// ... sin return ...
if ((await getOpenViaje(op.tenantId, op.operadorId)) !== viajeId) { ... return; }
```

No hay `return` en el `else`. El chequeo de "viaje ya cerrado" que sigue solo
detecta el caso en que el otro proceso YA TERMINÓ y cambió `viaje.estatus`;
mientras el otro sigue corriendo (estatus sigue `abierto`/`en_cuadre`), este
chequeo pasa de largo y el código continúa hacia `runAgent` **sin el lock**.

**Caso concreto:** un operador manda "listo" dos veces casi seguidas (doble
tap, dos dispositivos, o Meta entrega el batch con las dos en el mismo POST).
El primer "listo" corre el agente — el propio código documenta
`COSTO_AGENTE_MS = 15_000` como "mínimo realista de un turno con tools"
(`processor.ts:444`). El segundo "listo" espera el lock hasta
`reloj.acotar(12_000)` (12s o menos, según cuánto presupuesto ya se gastó en
la barrera de intake). 12s < 15s: el segundo agota su ventana con el primero
AÚN corriendo, `acquireViajeLock` devuelve `false`, y el segundo sigue de
largo. Los dos llaman `runAgent`, los dos pueden llamar `guardar_liquidacion`.

La base sí impide la doble FILA (`liquidacion_viaje_uidx` + `on conflict` de
`guardar_liquidacion_tx`, migración 0013) — así que el dinero persistido
queda correcto, una sola liquidación. Pero como el `upsert` no lanza error en
el conflicto, **ambas** ejecuciones del tool `guardar_liquidacion`
(`src/lib/cuadra/tools.ts:71-103`) reportan éxito: ambas generan y suben el
PDF (`upload(..., { upsert: true })`), ambas ponen `closed = true` en
`processor.ts:467`, y ambas ejecutan el bloque final
(`processor.ts:521,534-545`) — el operador recibe el texto de cierre **dos
veces** y el PDF **dos veces**, y se paga el LLM **dos veces**. Es
precisamente el escenario que el mutex existe para evitar ("dos 'listo' a la
vez"), en el canal que va a ver el comprador el día de la demo.

Ningún test cubre esto: `conv_lock.test.ts` prueba que `acquireViajeLock`
devuelve `false` correctamente quedado ocupado (línea 42-45), pero nada prueba
qué hace `processor.ts` con ese `false`. Es exactamente el hueco que el
boletín anterior señaló como riesgo ("la concurrencia que protege el dinero no
tiene un solo test propio") — ahora con un defecto real detrás, no solo con
la ausencia de arnés.

### [MEDIO] `analytics.ts` sí suma el `monto` sin pasar por el filtro del motor
`src/lib/cuadra/analytics.ts:51-75` (`getStatsPorOperador`), línea 64:

```ts
dieselPorOp.set(op, (dieselPorOp.get(op) ?? 0) + Number(gr.monto));
```

Esto lee `gasto.monto` directo de Supabase y lo suma sin el filtro
`!(g.monto > 0)` que `cuadre/engine.ts` aplica en sus cinco puntos de contacto
con el dinero (líneas 99, 107, 308, 371, 414 — ver hallazgo del rubro de
datos). Hoy `getStatsPorOperador` no tiene ningún caller fuera de sus propias
declaraciones (`grep` confirmado: cero imports en `src/app` o en el resto de
`src/lib`) — es la misma función que el boletín anterior ya marcó como
"exportada y miente" por el `diferencias: 0` fijo de la línea 73. Pero el día
que alguien la conecte al dashboard (es el tipo de cambio de una tarde), un
comprobante con OCR fallido —el caso que la migración 0019 dice explícitamente
que SIGUE entrando a la tabla, a propósito— reduce `dieselTotal` en silencio,
sin el estatus `REVISAR` que sí recibe en la liquidación formal. Ver el
`CONFLICTO` correspondiente en la sección de datos.

### [OPINIÓN A VERIFICAR] Dos RPC nuevas podrían no tener EXECUTE para `service_role`
`supabase/migrations/0017_enriquecer_gasto_atomico.sql:55` y
`supabase/migrations/0018_aviso_privacidad.sql:65`.

No pude construir el caso que falla sin tocar la base (fuera de alcance de
esta auditoría), así que esto es una hipótesis con evidencia, no un defecto
confirmado — lo marco así a propósito.

`0013_guardar_liquidacion_tx.sql:51-56` hace `revoke ... from public, anon,
authenticated` **y luego** `grant execute ... to service_role`, con un
comentario que documenta por qué: "Supabase concede EXECUTE a
anon/authenticated de forma EXPLÍCITA por default privileges... Verificado
post-migración: exec_roles = {postgres, service_role}". `0012_seguridad_rls.sql:16-18`
hace lo mismo para las tres RPC de la 0005. Pero `0017` y `0018` —las dos RPC
nuevas desde la auditoría anterior, ambas llamadas desde `repo.ts` vía
`supabaseAdmin().rpc(...)`— solo tienen el `revoke`, sin el `grant ... to
service_role` que las hermanas sí llevan:

```sql
-- 0017:55
revoke all on function enriquecer_gasto_codigo(uuid, uuid, jsonb, text) from public, anon, authenticated;
-- 0018:65
revoke all on function marcar_aviso_privacidad(uuid, uuid, text) from public, anon, authenticated;
```

Si el EXECUTE de `service_role` sobre estas dos funciones dependiera solo del
GRANT implícito a `PUBLIC` que Postgres pone al crear la función (y no de un
`ALTER DEFAULT PRIVILEGES` de proyecto que cubra a `service_role` aparte),
revocar de `public` se lo llevaría también a `service_role`, y
`enriquecerGastoConCodigo` (`repo.ts:190-209`) y `reclamarEnvioAviso`
(`repo.ts:375-387`) fallarían en producción con "permission denied" — no en
`verificaciones.sql`, que corre como el rol del editor SQL, no como
`service_role` vía PostgREST. `startup.ts:12-56` tampoco lo detectaría: solo
sondea 0005, 0011 y 0016 (el boletín anterior ya pedía sumar 0012/0013 —
sigue sin hacerse, y ahora 0017/0018 se suman a la lista de huecos del mismo
tipo). Verificación de una línea, no destructiva:
`select has_function_privilege('service_role', 'enriquecer_gasto_codigo(uuid,uuid,jsonb,text)', 'execute');`

## Lo que está sólido

- **Cierre atómico real y ahora verificado contra Postgres de verdad.**
  `guardar_liquidacion_tx` (0013) sigue siendo insert+update en una sola
  transacción, y `supabase/verificaciones.sql` bloque 2 ahora demuestra en
  vivo que dos cierres concurrentes producen una sola fila, con el mismo id,
  con el PDF del primero preservado.
- **El claim de la 0017 cierra el lost-update real y está probado en dos
  capas.** `repo_enriquecer.test.ts` fija el contrato JS (qué se manda, qué
  se omite); `verificaciones.sql` bloque 3 lo prueba contra Postgres real,
  incluyendo que `montoDiscrepante` sobrevive al segundo acercamiento.
- **`acquireViajeLock` en sí mismo está bien probado.** `conv_lock.test.ts`
  cubre los cinco caminos (ok, ocupado-y-libera, ocupado-todo-el-tiempo,
  RPC ausente, error transitorio) — el defecto de arriba no está en esta
  función, está en cómo se usa su resultado.
- **Manejo de errores de Postgres por nombre de índice, no por adivinanza.**
  `pg_errores.ts:violaIndice` obliga código 23505 + nombre del índice en el
  mensaje antes de tratar un choque como benigno — evita que un 23505
  cualquiera se trague un bug real.
- **`detectarDuplicadosEntreViajes` (`duplicados.ts`) es función pura y
  probada**, y desde la 0019 el caso más grave que cubre (mismo CFDI en dos
  viajes) ya no depende de que alguien mire esa tarjeta: la base lo rechaza
  con `uq_gasto_cfdi_uuid` antes de que llegue a existir dos veces.
- El reloj compartido (`presupuesto.ts`), la guardia fail-closed, y la
  disciplina de comentarios "por qué" se mantienen igual de sólidas que en la
  auditoría anterior — no encontré regresiones ahí.

## Qué subiría la nota

1. Un `return` (o un mensaje de "dame un segundo, estoy cerrando el viaje")
   en el `else` de `processor.ts:418` cuando `acquireViajeLock` devuelve
   `false` por ocupación genuina — no cuando abre por error transitorio/RPC
   ausente, que sí debe seguir. Es la línea que le falta al hallazgo ALTO.
2. Un test de integración (aunque sea con Supabase mockeado a nivel de
   `processor.ts`, no solo de `conv.ts`) que simule el lock devolviendo
   `false` y verifique que NO se manda una segunda respuesta/PDF. Cierra el
   hueco que el boletín anterior pedía y que el nuevo hallazgo demuestra que
   sigue abierto en la integración, aunque las piezas por separado ya estén
   probadas.
3. Verificar (una consulta, sin tocar nada) el `has_function_privilege` de
   `service_role` sobre `enriquecer_gasto_codigo` y `marcar_aviso_privacidad`,
   y si falta, agregar el `grant ... to service_role` que sus hermanas 0012 y
   0013 sí llevan. Sumar esas dos RPC (y la 0013) a los probes de
   `startup.ts`.
4. Filtrar `monto > 0` en `getStatsPorOperador` o borrar la función si sigue
   sin consumidor — ya estaba señalada por el `diferencias: 0` hardcodeado;
   ahora hay una segunda razón independiente para lo mismo.

---

# Modelo de datos y esquema — nota 7/10

## Hallazgos

### CONFLICTO: la razón de no poner `CHECK (monto > 0)` es válida pero no universal
`supabase/migrations/0019_gasto_cfdi_uuid_unico.sql:27-37` argumenta que el
`CHECK` sería un retroceso porque "el motor lo marca `monto_invalido`
(engine.ts:107), lo excluye del total... El contralor lo ve y lo corrige a
mano". Verifiqué el engine: el filtro `!(g.monto > 0)` en efecto se aplica en
los cinco puntos donde `cuadre/engine.ts` toca dinero (líneas 99, 107, 308,
335, 371, 414) — la liquidación formal (`total_comprobado`,
`ieps_acreditable`, etc., lo que escribe `saveLiquidacion`) está protegida de
verdad, no solo de palabra.

Pero el comentario da a entender que "el motor" es la única puerta de
entrada al dato, y ya no lo es: `src/lib/cuadra/analytics.ts:64`
(`getStatsPorOperador`) suma `gasto.monto` directo, sin ese filtro (ver
hallazgo MEDIO del rubro de backend). Hoy es inofensivo porque esa función no
tiene consumidor. La decisión de NO poner el `CHECK` sigue siendo la correcta
— perder la fila entera en vez de marcarla `REVISAR` sería peor, y ese
argumento no lo tumba nada de lo que encontré—, pero el respaldo real hoy no
es "el motor", es "el motor, y con suerte cualquier otro lector que se
acuerde de filtrar `monto > 0` por su cuenta". Vale la pena dejarlo escrito
explícitamente en el comentario de la 0019 (o mejor, en una vista/helper
compartido) para que el próximo lector de `gasto.monto` no repita el mismo
hueco.

### [BAJO] RLS está completo en el esquema y ausente en el camino real
`supabase/migrations/0001_init.sql:94-129` arma RLS correctamente: helper
`get_user_tenant_ids()` `SECURITY DEFINER` que nunca devuelve NULL, policy
uniforme `USING + WITH CHECK` sobre las siete tablas de negocio, y las
adendas de la 0009/0012 (RLS también en `cfdi_xml`, `wa_mensaje_procesado`,
`codigo_pendiente`) siguen el mismo patrón.

Pero en el código vivo, RLS no protege nada hoy: confirmé por grep que el
único cliente que respeta sesión (`src/lib/supabase/server.ts`, con
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) solo lo importa `src/lib/auth/session.ts`
(`getSessionTenant`), y **nada más en `src` importa `auth/session`** — es
código muerto, scaffolding para una auth que el roadmap ya declaraba
pendiente. Todo lo que de verdad lee o escribe (webhook, dashboard, export)
pasa por `supabaseAdmin()` (`service_role`, RLS bypassed) con
`tenant_id`/`id` filtrado a mano — revisé cada función de `repo.ts`,
`conv.ts`, `analytics.ts`, `dashboard/page.tsx` y el export route, y en todas
el filtro está presente y correcto: no encontré una fuga activa. Lo que hay
es un aislamiento que descansa 100% en que cada función nueva se acuerde de
poner el `.eq('tenant_id', ...)`, sin que Postgres lo respalde en ese camino.
Esto ya estaba en el roadmap de la auditoría anterior (ítem de seguridad,
"antes del segundo cliente") — lo confirmo aquí porque el rubro lo pide
explícitamente y hoy sigue exactamente así.

## Lo que está sólido

- **`unique(tenant_id, cfdi_uuid) where cfdi_uuid is not null`** (0019) cierra
  el hallazgo textual de la auditoría anterior — mismo CFDI, dos veces, dos
  viajes del mismo tenant. Verificado no solo por lectura: el bloque 4 de
  `verificaciones.sql` lo prueba contra Postgres real, incluyendo que el
  mensaje de error nombra el índice (`uq_gasto_cfdi_uuid`) — que es justo lo
  que `pg_errores.ts` necesita para distinguirlo de un bug real — y que los
  tickets sin timbrar (NULL) siguen entrando todos.
- **`supabase/verificaciones.sql` es la pieza nueva más valiosa del lote.**
  Cuatro escenarios de concurrencia contra Postgres de verdad (no un mock),
  autolimpiables por diseño (excepción a propósito + rollback), con la fecha
  y el resultado de la última corrida anotados. Es exactamente lo que un
  test con Supabase mockeado NO puede probar (un `ON CONFLICT`, un `WHERE`
  con condición de carrera, un índice único) — cierra en la práctica buena
  parte de la brecha de evidencia que el boletín anterior señaló para este
  rubro.
- **0017 resuelve un lost-update real con la técnica correcta**: el merge
  (`||` de jsonb) y el claim (condición en el `WHERE`) viven en SQL, donde la
  fila está bloqueada durante el `UPDATE` — no en la app, que era
  exactamente el bug (B13).
- **0018 modela el aviso de privacidad con la separación correcta de quién es
  responsable** (la flota) vs. quién solo pone el mecanismo (Likida), y el
  claim de envío único sigue el mismo patrón que 0017 en vez de inventar uno
  nuevo.
- Las columnas fiscales acumuladas (0003-0007, 0010) siguen sin un solo
  `CHECK` de dominio más allá de RLS — pero ninguna de ellas participa
  directamente en una suma de dinero fuera del motor, así que el riesgo
  real sigue concentrado en `gasto.monto` y `gasto.concepto`.

## Qué subiría la nota

1. `CHECK`/enum sobre `gasto.concepto` y `politica_gasto.concepto` (ítem ya
   señalado en la auditoría anterior, sigue sin resolverse en las 19
   migraciones): sigue siendo `text` libre, y es la llave contra la que
   `politica_gasto` compara para aplicar topes.
2. La FK compuesta `tenant_id` → tenant del `viaje` referenciado (ítem #33 de
   la auditoría anterior) tampoco se tocó. Sigue sin ser alcanzable con el
   diseño actual (`tenantId` siempre sale del teléfono verificado, nunca de
   un parámetro), así que no urge, pero conviene no perderla de vista si
   algún día se abre una vía de escritura que no pase por `processInbound`.
3. Verificar el grant de `service_role` de 0017/0018 (ver hallazgo del rubro
   de backend) — es una migración, no una prueba, así que cae también en
   este rubro.
4. Mover la exclusión `monto > 0` a un único punto (vista, o un helper que
   todo lector de `gasto` use) en vez de confiar en que cada nuevo consumidor
   la repita a mano — es la forma de que el `CONFLICTO` de arriba no vuelva
   a aparecer con otro nombre de función.
