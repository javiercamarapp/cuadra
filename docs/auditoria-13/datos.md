# Modelo de datos y esquema — auditoría 13

**Nota: 7/10** (sube de 5, que era la nota con el CRÍTICO abierto; se queda un
punto abajo del 8 que la re-auditoría de la ronda 12 declaró). La vara del
rubro, heredada de la ronda 10: ¿el esquema puede sostener, sin que nadie lo
esté mirando, las tres garantías que este producto vende —el PDF archivado y lo
que hay en `gasto` dicen lo mismo para siempre, ningún tenant ve dinero de otro,
y toda migración nueva se comprueba contra Postgres real antes de darla por
buena—?

Anclado a `caae369e5474b767bf8e85a92e80cfb543eb47d6` (`git rev-parse HEAD` al
empezar). Sin acceso a Postgres en esta sesión: toda la verificación es lectura
línea por línea de `supabase/migrations/` (0001–0080), `seed.sql`,
`verificaciones.sql` y el código que consume el esquema. Lo que necesitaría
base real para confirmar está dicho como tal.

**Verificación de cierres de la ronda 12 (el encargo explícito).** Los dos
cierres que el PROMPT-BASE pide comprobar —la 0065 y la 0080— están y hacen lo
que dicen:

- **0065** (`supabase/migrations/0065_cfdi_de_varias_casetas.sql:62-72`):
  `autofactura_bloqueada_en`, `autofactura_bloqueo` y el CHECK
  `gasto_bloqueo_coherente` ya viven en el archivo. Los tres consumidores que
  la ronda 12 citó leen las columnas (`pendientes.ts:121,174-175`,
  `cron/facturar/route.ts:287`, `al_vuelo.ts:559-564,594,647`) y el bloque 44
  de `verificaciones.sql:2282-2287` las ejercita. El CHECK que reconstruyó el
  repo es exactamente el que el bloque 44 presupone: `update gasto set
  autofactura_bloqueada_en = now()` con `autofactura_bloqueo` nulo → `(false) =
  (true)` → `check_violation`. El CRÍTICO de la ronda 12 está cerrado en el
  repo. (Lo único que no puedo comprobar sin base es que el CHECK real de
  producción tenga el mismo nombre/definición — el bloque 44 prueba el
  comportamiento, no el nombre, así que el nombre puede diferir sin daño.)
- **0080** (`supabase/migrations/0080_operador_rfc.sql`): la columna
  `operador.rfc` existe y la cadena de consumo está completa: `repo.ts:73`
  la selecciona, `desde_db.ts:44` la pasa como `operadorRfc`, y `engine.ts:390-398`
  usa la rama buena de RLISR 57 (viático al RFC del operador subordinado ya no
  cae a `rfc_receptor`). El caso "sin RFC" sigue cayendo a `viatico_rfc_operador`
  (a revisión, no rechazado), que es el comportamiento declarado.
- **0078/0079/seed** — verificados en las secciones de abajo.

## Hallazgos

### [MEDIO, abierto] `operador_sube_su_pod` no amarra el `tenant_id` del POD al de su viaje — el chofer puede sembrar un POD en la flota de OTRO tenant, y es la ÚNICA escritura RLS que le queda

`supabase/migrations/0047_operacion_encargado.sql:190-192`:

```sql
create policy operador_sube_su_pod on public.pod for insert
  with check (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));
```

El `with check` valida SOLO `viaje_id`; `tenant_id` y `operador_id` de la fila
nueva no se comparan contra nada. Y `pod` es la única tabla del esquema —de
todas las que nacieron con tenant— sin la FK compuesta que la 0028 puso en
`gasto`/`liquidacion`/`codigo_pendiente`/`viaje`: nació en la 0047, después de
la 0028, y nadie le aplicó el patrón `(viaje_id, tenant_id) → viaje(id,
tenant_id)`. Verificado: `grep pod.*tenant_fkey` → 0 resultados.

**Escenario con valores.** Un chofer (rol=operador, sesión web válida + anon
key, el mismo modelo de amenaza que los bloques 54/55 impersonan) hace:

```
POST /rest/v1/pod {"tenant_id": "11111111-1111-1111-1111-111111111111",   -- OTRA flota
                   "viaje_id": "44444444-0000-0000-0000-000000000001"}    -- SU viaje
```

- El `with check` pasa: su viaje está en `select id from viaje where operador_id
  = get_user_operador_id()`.
- La FK `pod.tenant_id → tenant(id)` pasa: el tenant de la otra flota existe.
- La FK `pod.viaje_id → viaje(id)` pasa.
- No hay FK compuesta que exija `viaje.tenant_id = pod.tenant_id` → **la fila
  entra**. Con `estado='subido'` y `storage_path` nulo además violaría
  `pod_subido_tiene_archivo` (elegir `estado='pendiente'` la evita), pero la
  fila `pendiente` entra limpia.

**La consecuencia.** El tablero de operación de la OTRA flota (`operacion.ts:62`,
que filtra `.eq('tenant_id', tenantId)` con la policy `tenant_data` de pod que
NO excluye esta fila —el `tenant_id` es el suyo) muestra un POD fantasma cuyo
`viaje_id` apunta a un viaje que no es de esa flota: un "pendiente de evidencia"
que no se puede resolver (el viaje no es suyo, y `marcarPodPedido` del viaje
legítimo rebotará con 23505 por `pod_viaje_unico`). No es dinero —por eso MEDIO
y no ALTO—, pero es exactamente la familia que las 0078/0079 cerraron en las
otras tablas ("se acota una dimensión y se olvida la otra"), sobreviviendo en la
única policy de INSERT que el chofer conserva en todo el esquema: verifiqué el
inventario completo — `tenant_data` en las 20 tablas de negocio lleva
`not is_operador()`, `bitacora_insercion` (0079) también, y las demás son
`ve_finanzas`/`administra_flota`/`is_superadmin`. `operador_sube_su_pod` es el
único INSERT alcanzable por `rol=operador`.

**Estado: abierto.** Arreglo sugerido (no lo hago, este rubro solo reporta):
una línea en el `with check` — `and tenant_id = (select tenant_id from public.viaje
where id = viaje_id)` — o la FK compuesta `pod (viaje_id, tenant_id) references
viaje(id, tenant_id)` con su índice único en `viaje(id, tenant_id)` (el patrón
de la 0028). La policy `operador_ve_su_pod` (solo lectura) tiene el mismo hueco
en sentido inverso —no filtra tenant— pero el `viaje_id` ya viene scoped por la
policy del viaje, así que la lectura no cruza.

### [BAJO, abierto] `tenant_self` de la 0078 deja que el chofer lea `tenant.config` — la política que lo juzga — y `contacto_privacidad`

`supabase/migrations/0078_rls_chofer_sin_escritura.sql:56-58`:

```sql
create policy tenant_self on tenant for select
  using (id = any(get_user_tenant_ids()) or is_superadmin());
```

`id = any(get_user_tenant_ids())` incluye al `operador`: con sesión + anon key,
`GET /rest/v1/tenant?id=eq.<flota>&select=config,contacto_privacidad` le
devuelve el objeto `config` completo —los topes de `politica` (diésel $4,000…)
que es exactamente la regla que decide `sobre_politica` en su liquidación—, el
`catalogoCuentas`, `estimulos` y el contacto del art. 29. La ronda 12 validó la
0078 como "solo lectura, no rompe ningún camino" y eso es cierto: la UI del
chofer no lee `tenant` por RLS en ningún lado (verificado: los únicos lectores
por cliente de sesión son `session.ts:70` sobre `app_user` y `chofer.ts`/
`mis-viajes` sobre viaje/gasto/liquidacion), así que acotar el brazo de tenant a
`not is_operador()` —el mismo patrón que la 0079 aplicó a `app_user`— no rompe
nada. El argumento de la 0079 ("datos personales de terceros") no aplica aquí
(es la fila de la propia flota), pero el chofer leyendo los topes antes de
cuadrar es información que el producto no le da en pantalla y que puede
usar para moldear sus comprobantes. **Estado: abierto** — decisión de diseño de
la 0078, documentada aquí como residual, no como fuga de terceros.

### [BAJO, abierto] `factura_viaje` sin FK compuesta ni candado de viaje en su policy — un `ve_finanzas` puede ligar la factura de SU flota a un viaje de OTRA

`supabase/migrations/0049_cobranza_factura_emitida_pago.sql:150-159`: la policy
`tenant_finanzas` de `factura_viaje` valida el lado `factura_id` (EXISTS contra
`factura_emitida` con tenant+`ve_finanzas`) pero no el lado `viaje_id`. La tabla
no tiene `tenant_id` propio (hereda por la factura) y nació después de la 0028,
así que no hay FK compuesta `(viaje_id)` → viaje que exija coherencia.

**Escenario con valores.** Un `contador` del tenant A:
`POST /rest/v1/factura_viaje {"factura_id": "<factura de A>", "viaje_id": "<viaje de B>"}`
— el `with check` pasa (su factura es de A), las FKs pasan (ambos ids existen),
y queda una fila que ata la factura de A al viaje de B. La vista `factura_saldo`
de A la muestra con un viaje que no es suyo. **No hay consumidor en la app**
(`src/lib/cuadra/fiscal.ts:941` declara explícitamente que el código NO toca
`factura_viaje` todavía), así que es un hueco de esquema latente, no un bug
activo. Misma familia que el MEDIO de arriba y mismo arreglo cuando la tabla
tenga consumidor: FK compuesta o candado de viaje en el `with check`. **Estado:
abierto** (sin costo hoy; una línea cuando se escriba el primer INSERT).

### [BAJO, abierto] La cabecera de `verificaciones.sql` dice "Última corrida: 31-jul" cuando el propio archivo trae salidas reales del 5-ago

`supabase/verificaciones.sql:15` — "Última corrida: **31-jul-2026**, contra el
proyecto Likida" — pero los bloques 41 (`:1764`), 43 (`:2026`), 52 (`:2857+`) y
53 llevan "CORRIDO EL 5-AGO-2026 CONTRA EL PROYECTO LIKIDA. SALIDA REAL:"
pegada en su prosa. El archivo es la bitácora de corridas contra Postgres real;
su primera afirmación quedó 5 días vencida y ahora hay DOS fechas que
contradicen: quien lea solo la cabecera (es lo que se lee primero) cree que las
verificaciones tienen una semana de atraso. No cambia ninguna garantía —es
documentación— pero es exactamente el tipo de deriva que hace que mañana nadie
sepa si el bloque nuevo se corrió. **Estado: abierto** (una línea).

### [BAJO, abierto] `desde_db.ts:42` — `.catch(() => null)` enmascara cualquier fallo de lectura del operador como "RFC no capturado"

`src/lib/cuadra/cuadre/desde_db.ts:42-44`:

```ts
const operador = viaje.operadorId
  ? await getOperador(viaje.operadorId, tenantId).catch(() => null)
  : null;
const operadorRfc = operador?.rfc ?? undefined;
```

El `catch` traga TODOS los errores de `getOperador` (base caída, timeout,
permisos, **columna `rfc` inexistente en un entorno fresco**). El dinero falla
cerrado —sin `operadorRfc`, los viáticos al RFC del operador caen a
`viatico_rfc_operador` (a revisión), no a deducible—, pero la exención de la
0080 en `migraciones_verificadas.test.ts` dice "si la columna falta, `getOperador`
falla ruidoso", y este `catch` silencia justamente ese ruido: un entorno sin la
0080 liquidaría todo el día con viáticos "a revisión" y el único rastro sería
una nota que dice "captura su RFC para confirmarlo" cuando el problema es el
esquema. El fallo cerrado de dinero está bien; la afirmación "falla ruidoso"
de la exención no se sostiene en este camino. **Estado: abierto** (BAJO — el
daño es diagnóstico, no dinero).

### [BAJO, abierto] El XML del seed (el respaldo del gasto estrella del demo) no cuadra internamente — no pasaría una validación SAT

`supabase/seed.sql:141` — el XML del diésel declara:

- `Base="3210.00" Impuesto="003" TasaOCuota="6.1740" Importe="408.62"` — pero
  3210.00 × 0.06174 = **198.19**, no 408.62. (408.62 tampoco es 113 L × 6.1740
  = 697.66; sería ~$3.616/L, que no es lo que dice `TasaOCuota`.)
- `Base="3618.62" Impuesto="002" TasaOCuota="0.160000" Importe="581.38"` — pero
  3618.62 × 0.16 = **578.98**, no 581.38. El 581.38 se despejó del Total
  (4200 − 3210 − 408.62) para que la suma diera, no del 16% declarado.

El parser de la app (`cfdi_xml.ts:271-277`) suma los `Importe` DECLARADOS sin
multiplicar base×tasa, así que la demo no lo ve y el `iva_traslado` guardado
(581.38) es consistente con el XML leído. El riesgo es otro: es el CFDI de
respaldo del comprobante que el guion presenta como "deducible y ACREDITABLE",
y si alguien en la sala pide ver el XML —o el contador lo abre en su PAC—, los
impuestos no cuadran con sus propias bases. Es dato INVENTADO (el archivo lo
declara), pero la inconsistencia interna de un comprobante fiscal que se
muestra como evidencia es un detalle que se puede pulir gratis antes de la
demo. **Estado: abierto** (BAJO, dato de demo).

### [BAJO, abierto] `getPorFacturar` recorta la cola a 500 filas y el resumen cuenta sobre la lista recortada

`src/lib/cuadra/facturacion/pendientes.ts:125-126` — `.limit(500)` sin aviso de
"hay más", y `resumen()` (`:182-189`) calcula `total`, `vencidos`, `urgentes` y
`montoTotal` sobre la lista ya recortada. La propia 0063 cita 660 comprobantes
por día como volumen normal; con más de 500 tickets por facturar, el panel dice
"total: 500" y el monto vencido subestimado — un rótulo que no es verdad, la
segunda regla de CLAUDE.md. No es modelo de datos (es la frontera con backend,
que ya paginó el export en la ronda 12 y no llegó a esta consulta), pero es una
cifra que el esquema alimenta y el panel presenta como total. **Estado:
abierto** (BAJO, pre-existente, frontera con el rubro backend).

## Lo que revisé y está bien

- **Inventario RLS final tabla por tabla (33 tablas de `public` + storage).**
  Simulé el estado final aplicando drops/recreates en orden de migración
  (script sobre el árbol de migraciones, no de memoria):
  - Con `tenant_data` y `not is_operador()`: `viaje`/`gasto`/`liquidacion`
    (0045, con `operador_ve_*` de solo lectura scoped), `terminal`/`operador`/
    `politica_gasto`/`wa_conversacion` (0078), `llm_costo`/`cfdi_xml`/
    `cfdi_consolidado_linea` (0078), `unidad`/`mantenimiento`/`incidencia`/`pod`
    (0047, POD con las dos policies del chofer — ver el MEDIO), `posicion`/
    `geocerca` (0050), `ticket_soporte`/`ticket_mensaje` (0051, la segunda por
    EXISTS contra la primera), `campania`/`envio_mensaje` (0053).
  - Con `ve_finanzas()`: `cliente`/`tarifa` (0048), `factura_emitida`/
    `pago_recibido`/`factura_viaje` (0049), `cotizacion` (0051),
    `suscripcion`/`factura_saas` (lectura, 0052).
  - Con `administra_flota()`: `rastreo_credencial` (0050), `invitacion`/
    `solicitud_arco` (0053). `plan` lectura pública + escritura superadmin
    (0052). `evento_stripe` solo superadmin (0055). `app_user`/`bitacora`
    (0079, verificadas línea por línea: `id = auth.uid() or (tenant and not
    is_operador()) or is_superadmin()`; bitácora `not is_operador()` en INSERT,
    sin UPDATE/DELETE = append-only). `tenant` solo lectura (0078).
  - RLS ON y CERO policies (deny-all, correcto): `wa_mensaje_procesado` (0012),
    `viaje_lock` (0005), `codigo_pendiente` (0016), `comprobante_huerfano`
    (0040), `portal_credencial` (0063), `llm_costo_mensual` (0072, con `revoke`
    extra). `foto_pendiente` sigue inexistente (0041) y sin referencias vivas
    en `src/` (solo comentarios que narran su reversión).
  - **Los únicos lectores por cliente de sesión (RLS real)** son
    `session.ts:70` (app_user, su propia fila), `chofer.ts:227-229,313-316` y
    `mis-viajes/page.tsx:42-50` (viaje/gasto/liquidacion con las policies del
    0045). Todo lo demás —administración, usuarios, facturación, bitácora,
    tenant, pod, incidencias— escribe y lee por `supabaseAdmin()` (service_role,
    salta RLS). Verificado con un barrido de `supabaseServer()`/`supabaseAdmin()`
    en `src/`.
- **Integridad referencial.** Ninguna tabla con `tenant_id` carece de FK a
  `tenant` (barrido de `create table` completo). Las compuestas de la 0028
  (`gasto_viaje_tenant_fkey`, `liquidacion_viaje_tenant_fkey`,
  `codigo_pendiente_viaje_tenant_fkey`, `viaje_operador_tenant_fkey`) están como
  sus encabezados dicen, y son las que hacen que el `with check` de
  viaje/gasto/liquidacion no pueda cruzar de flota ni escribiendo el id de un
  viaje ajeno. `viaje_lock` tiene su FK (0075) y las dos `NOT VALID`
  (`viaje_ingreso_no_negativo`, `viaje_km_sanos`) quedaron validadas (0075). Los
  checks de la 0070 (`gasto.monto >= 0`, `viaje.anticipo >= 0`), el desglose de
  la 0066 con su CHECK de centavo, y los dominios de la 0025 + 0044
  (`encargado`) + 0073 (`sin_match`) están como declaran. El trigger de "nada
  entra tras liquidar" cubre INSERT (0036), UPDATE de monto/sub_total/iva/ieps/
  cfdi_uuid (0037) y UPDATE de fecha (0042), todos con el mismo `CU001` y el
  search_path fijado por la 0074.
- **Permisos de funciones.** `resumen_costo_ia` (0062)/`resumen_costo_ia_tenant`
  (0064) revocadas de `public, anon, authenticated`; `ve_finanzas`/
  `administra_flota` revocadas de `PUBLIC` y concedidas solo a `authenticated`
  (0054); `factura_saldo` con `security_invoker` (0054); `guardar_liquidacion_tx`
  ejecutable solo por `service_role` (0013, con el revoke de los tres roles);
  `consolidar_llm_costo_mensual`/`purgar_wa_mensaje_procesado`/
  `mantenimiento_de_datos` revocadas (0072); `triggers_faltantes` solo
  service_role (0043). Las cuatro funciones que resuelven TODA la RLS tienen
  `search_path = public, pg_temp` (0074) y `gasto_no_tras_liquidar()` también.
- **Seed (`supabase/seed.sql`), línea por línea.** El CRÍTICO/ALTO de la ronda
  12 está cerrado: OP-101 (el del viaje demo) usa `529993700779` (`:75`), la
  política viva se escribe en `tenant.config.politica` (`:99-105`) y el diseño
  del viaje ya dice la verdad —diésel $4,200 vs tope $4,000 → $200 de
  diferencia, anticipo $10,600 = total comprobado solo después de las fotos en
  vivo (~$5,000), que es lo que narra el GUION—. El RFC `GMX0902279I1` pasa el
  dígito verificador con el propio `rfcChecksumOk` del repo (lo corrí en esta
  sesión: `esRfcValido=true checksum=true`), y `getConfig` (`config.ts:179-216`)
  lo mete a `empresa.rfc` desde `tenant.rfc` sin mutar `DEMO_CONFIG` (la fuga
  entre tenants de la ronda 12 está cerrada con el `{ ...cfg, empresa: {...} }`).
  Los montos desglosados cuadran ($3,210 + $408.62 + $581.38 = $4,200;
  $1,206.90 + $193.10 = $1,400), los estatus cumplen los dominios de la 0025,
  `cfdi_xml` respeta `unique (tenant_id, cfdi_uuid)`, los 5 teléfonos
  normalizan distinto (0024) y no hay `app_user` sembrado —deliberado, la
  creación va por provisionar—. El seed es idempotente (`on conflict` con
  `do nothing`/`do update`) incluso re-corrido después de la demo (los gastos
  del viaje ya liquidado no reinsertan, así que el trigger CU001 no se dispara).
  Las 3 liquidaciones de historial están vacías por dentro A PROPÓSITO y el
  GUION lo declara ("No las abras"), así que no las cuento como hallazgo.
- **Bloques 54 y 55 (0078/0079).** El ajuste `9b625db` (el chofer ve SU propia
  fila de `app_user`, que `session.ts:70` necesita) está bien aplicado: el
  bloque 55 espera `lee-app_user-ajeno=1` y la policy de la 0079 devuelve
  exactamente 1 para el chofer (la suya) y 0 para la del admin. El 54 siembra
  las siete tablas, impersona al chofer, espera 0/0/0/0/0/0/0/0/1/2, y el
  `update tenant` tocando 0 filas es coherente con `tenant_self for select`.
- **Pruebas corridas en esta sesión (todas verdes):** `migraciones_verificadas`
  4/4 (la 0080 sigue exenta con razón), `politica_un_origen` 3/3, `chofer` 32,
  `config_merge` 8, `config_tope` 1, `cuadre/engine` 107, `intake/consolidado`
  25. No corrí la suite completa (instrucción: otro auditor la corre).
- **Número de migraciones coherente:** el salto 0067-0069 es un renombrado
  documentado (`80d2511`: las 0070-0072 se autonombraban 0065-0067 antes del
  reordenamiento); no hay archivos perdidos ni dobles en el historial de
  `migrations/` (77 archivos, 0001→0080).

## Lo que no alcancé a revisar

- **La base real (us-east-2).** No tengo MCP/credenciales en esta sesión, así
  que el estado que el PROMPT-BASE declara —0078/0079/0080 aplicadas, bloques
  26/28/44/53/54/55 pasando, seed sembrado— lo tomo como evidencia de la ronda
  12, no como verificación propia. Los bloques están escritos y son coherentes
  con el esquema (los leí); su salida real no la re-corro yo.
- **El nombre/definición exacta del CHECK `gasto_bloqueo_coherente` en la base
  real** — el repo reconstruyó `(autofactura_bloqueada_en is null) =
  (autofactura_bloqueo is null)`; si la base real tiene otra definición (p. ej.
  con `bloqueo <> ''`), un entorno fresco y producción divergirían en un caso
  borde (bloqueo con cadena vacía). El bloque 44 no lo distinguiría (prueba
  comportamiento, no definición). Necesita `pg_constraint` para cerrarse.
- **0056-0061 y 0030-0037/0042-0043** — los leí en esta ronda (los que tocan el
  modelo: 0056 catálogos SAT, 0058 marcas de aceptación, 0059 teléfono único
  global, 0060/0061 índices), pero no constraint por constraint contra datos
  vivos.
- **El truncamiento de `getPorFacturar`** lo reporto sin medir cuántas flotas
  pasan de 500 tickets (el volumen real no lo tengo).
- **La suite completa de pruebas** (3,132) — no la corro yo en esta sesión.

## Veredicto

**Green light condicionado — 7/10.** Los tres cierres que esta ronda debía
verificar están, comprobados en el código y no por el mensaje del commit: la
0065 reconstruida ya reproduce el esquema de facturación (columnas + CHECK +
bloque 44 coherentes), el seed está alineado con el guion (teléfono del demo,
política viva, RFC con dígito verificador válido, montos que cuadran), y la
familia RLS de la 0078/0079 quedó cerrada con sus bloques 54/55 corregidos. La
garantía 1 (PDF ≡ gasto para siempre) y la garantía 3 (migraciones comprobadas)
se sostienen; la garantía 2 (ningún tenant ve/escribe en otro) se sostiene con
UNA excepción de escritura recién encontrada: `operador_sube_su_pod`
(0047:190-192) permite al chofer —la única escritura RLS que le queda— sembrar
un POD en la flota de otro tenant, porque `pod` nació después de la 0028 y
nunca recibió su FK compuesta. Es el mismo modo de falla que la ronda pasada
atacó y que se le escapó por la tabla que la 0047 trajo al mundo; una línea lo
cierra.

Para la demo de mañana no es bloqueante: el guion no sube PODs por el chofer
web (la oficina los escribe por service_role, que salta RLS) y el MEDIO no toca
dinero. La deuda es: (1) cerrar el `with check` de pod (o su FK compuesta), (2)
los seis BAJOS de arriba —la cabecera de verificaciones y el XML del seed
valen una línea cada uno y se pueden hacer antes de la sala—. Con eso el rubro
vuelve al 8 que la ronda 12 declaró y que yo no puedo dar por bueno con la
excepción de pod abierta.
