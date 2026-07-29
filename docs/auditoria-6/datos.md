# Modelo de datos y esquema — auditoría 6

**Nota: 7/10** (antes 5). Razones, las tres permitidas:

1. **Se atacó y subió.** Los dos CRÍTICOS de la ronda 5 — la migración 0022
   aplicada y ausente del repo, y la ambigüedad de teléfono→operador — están
   cerrados y **verificados de nuevo hoy contra producción**, no solo contra el
   commit: `supabase_migrations.schema_migrations` trae 27 filas (0001–0026,
   0028–0029; **0027 deliberadamente ausente**) y coinciden una a una con los
   archivos del repo; `operador` tiene hoy 3 filas activas, cero duplicados de
   teléfono normalizado. Tres de los cuatro ALTOS/MEDIOS de la ronda 5 también
   se cerraron con evidencia fresca (ver tabla).
2. **Mirada más profunda encontró lo que la ronda pedía encontrar.** El CHECK
   de dominio de `forma_pago` (mig. 0025) es correcto y protege un hueco real,
   pero **abrió una vía de pérdida de datos que no existía ayer**: el XML de un
   CFDI real, con UUID válido y monto correcto, puede fallar entero —sin
   guardar ni siquiera el respaldo crudo que exige el CFF art. 30— por un solo
   atributo `FormaPago` que no tenga forma de dos dígitos. Es exactamente el
   patrón que el brief de esta ronda pedía cazar: una restricción nueva que
   convierte un dato malo en un error de tiempo de ejecución que el código no
   está preparado para traducir. Es un hallazgo NUEVO, no heredado.
3. **No sube a 8+** porque quedan invariantes reales sin restricción en la
   base: `gasto.fecha` sigue nullable sin CHECK (la misma fila de la ronda 5
   sigue ahí, sin tocar), `wa_conversacion` sigue sin normalizar el teléfono y
   sin escribir `operador_id` (mismo MEDIO, sin tocar), y la deduplicación de
   fotos entre viajes sigue sin cerrar en producción porque **0027 está escrita
   y a propósito sin aplicar** — confirmado hoy: el hash
   `250a4e5b34ecba43…` sigue en dos gastos de dos viajes distintos.

Método: se leyeron las migraciones 0022 y 0024–0029 completas, se contrastaron
contra `pg_constraint`, `pg_indexes` y `supabase_migrations.schema_migrations`
de producción (`gngoqsvrxdguxvsizpbw`) por SQL de solo lectura, y se leyeron
`repo.ts`, `conv.ts`, `pg_errores.ts`, `processor.ts`, `cfdi_xml.ts`, `ocr.ts`
y `concepto.ts` para trazar cada invariante nuevo contra el único camino de
escritura que lo puede tocar. Se corrieron consultas de solo lectura contra las
filas vivas (`gasto`, `viaje`, `operador`, `wa_conversacion`, `tenant`). Ninguna
escritura contra Supabase.

---

## La pregunta de la ronda: qué abrieron los seis arreglos de ayer

Antes de los hallazgos, la respuesta corta, migración por migración:

| Migración | Protege un camino que la app SÍ usa | Qué pasa si truena |
|---|---|---|
| 0022 (RPC única) | Sí — `saveLiquidacion` → `guardar_liquidacion_tx` | No puede truena por ESTA migración: el `do $$` de la propia 0022 exige que quede una sola firma o la migración falla al aplicarse, no en producción. Aplicada y verificada: `pg_proc` trae una sola `guardar_liquidacion_tx` con `pronargs=13` (agregó `p_pdf_url` desde 0021/0022 combinadas). |
| 0024 (teléfono único) | No de escritura — ninguna línea de `src/` hace `insert into operador`. Sí de LECTURA: `resolveOperador` ya asumía la unicidad con `.limit(2)` + `OperadorAmbiguo`. | Si alguien la rompe por consola, `resolveOperador` ya no puede insertar el duplicado (bloqueado en la base) — antes solo se enteraba el operador con un mensaje confuso. Mejora pura. |
| 0025 (CHECK de dominio) | Sí — `addGasto` y `updateGastoCfdiXml`, los dos únicos escritores de `gasto`. `concepto`, `estado_sat` y el `forma_pago` de OCR están blindados por zod/switch **antes** de tocar la base. `forma_pago` del CFDI XML **no** — ver el hallazgo ALTO de abajo. | Para `concepto`/`estado_sat`: no truena nunca desde la app, solo protege altas a mano. Para `forma_pago` del XML: **sí puede truena, y sin manejo específico.** |
| 0026 (`tenant.config` con esquema) | No — las tres apariciones de `from('tenant')` en `src/` son `select`. | No puede truena desde la app hoy. Protege solo la consola. |
| 0028 (FK compuestas) | Sí — `addGasto`, `guardarCodigoPendiente`, `saveLiquidacion` (vía RPC) escriben `viaje_id`+`tenant_id` juntos. | `tenantId`/`viajeId` siempre viajan juntos desde el mismo `op` resuelto; no hay combinación mixta posible en el código actual. Defensa correcta, sin activar. |
| 0029 (un viaje abierto) | No — ninguna línea de `src/` hace `insert into viaje`. | No puede truena desde la app hoy. Protege solo la consola/el seed. |

Cuatro de las seis (0024, 0026, 0028, 0029) protegen caminos que la aplicación
**no usa para escribir** — son defensas contra la consola de Supabase, y en eso
hicieron exactamente lo que decían hacer, sin abrir nada. Las dos que sí tocan
un camino de escritura real (0022 y 0025) se verificaron con cuidado: 0022 se
blindó a sí misma: 0025 es la que dejó un hueco, documentado abajo.

---

## Hallazgos

### [ALTO] El CHECK de `forma_pago` (mig. 0025) puede tirar un CFDI real entero, sin guardar ni el XML crudo

`supabase/migrations/0025_dominios_check.sql:97-98` (`gasto_forma_pago_formato`,
`forma_pago is null or forma_pago ~ '^[0-9]{2}$'`) ·
`src/lib/cuadra/intake/cfdi_xml.ts:127` ·
`src/lib/cuadra/processor.ts:489-491,502-524` ·
`src/lib/cuadra/repo.ts:198-227` (`updateGastoCfdiXml`) ·
`src/lib/cuadra/pg_errores.ts`

**Evidencia.** El CHECK está aplicado en producción — confirmado en
`pg_constraint`: `gasto_forma_pago_formato | CHECK (((forma_pago IS NULL) OR
(forma_pago ~ '^[0-9]{2}$'::text)))`. El comentario de la propia 0025 explica
que se puso para cazar un fallo del mapeo de OCR (`ocr.ts:307`, `'efectivo' →
'01'`), y ESE camino está protegido de sobra: `ocr.ts:43` restringe
`forma_pago` a un `z.enum(['efectivo','tarjeta','otro'])` antes de mapear, y
`'otro'` mapea a `undefined` (repo.ts:156 lo escribe como `null`), que el CHECK
deja pasar.

Pero hay un SEGUNDO escritor de `forma_pago` que la 0025 no menciona:
`cfdi_xml.ts:127` — `formaPago: (comp['@_FormaPago'] as string) || undefined`
— lee el atributo `FormaPago` del XML **tal cual viene**, sin zod, sin regex,
sin comparar contra el catálogo `c_FormaPago` del SAT. `parseCfdiXml` solo
exige que exista un nodo `Comprobante` y, para el flujo del gasto, que haya
`uuid` (`processor.ts:468`); no valida que el CFDI esté bien formado más allá
de eso. Ese valor crudo llega a la base por dos caminos, los DOS únicos
escritores de `gasto` en todo `src/`:

- `processor.ts:489-491` → `updateGastoCfdiXml(..., eraTicket ? {...xml,...} :
  xml)` cuando el XML casa con un ticket que ya existía.
- `processor.ts:502-520` → `addGasto(..., { ..., formaPago: xml.formaPago,
  ... })` cuando el XML llega SIN foto previa y se crea el gasto desde cero.

**Escenario con valores.** Un operador reenvía por WhatsApp el XML que la
gasolinera le mandó por correo — el flujo documentado como "NIVEL 2 del
complemento de hidrocarburos", normal en el producto. El XML está bien
timbrado (UUID válido, RFC, total, fecha correctos) pero trae
`FormaPago="1"` en vez de `"01"` — un solo dígito. Es la clase de defecto que
CFDIs mal generados por software de facturación de terceros (gasolineras
independientes, no las cadenas grandes) sí producen; el parser no lo rechaza
porque no valida el catálogo, solo el atributo. `xml.claveProdServ` es de
combustible, así que `conceptoDesdeClave` devuelve `'diesel'` (en dominio) y
todo lo demás pasa el CHECK de `gasto_concepto_dominio` sin problema. Solo
`forma_pago = '1'` viola `gasto_forma_pago_formato` (23514, `check_violation`).

En la cadena: `addGasto` propaga el error preservando el código
(`repo.ts:176-178`, `e.code = error.code`), pero `pg_errores.ts` solo sabe
comparar **23505** contra un nombre de índice (`violaIndice`); no existe
ningún manejo para 23514. `processor.ts:406-422` solo reconoce
`uq_gasto_img_hash` y `uq_gasto_cfdi_uuid`; cualquier otro código —incluido
este— cae en `throw e;` (línea 422). Y `updateGastoCfdiXml` (repo.ts:198-227)
es peor: ni siquiera preserva `error.code` — `throw new Error(...)` liso — así
que ese camino no podría distinguir el 23514 aunque alguien quisiera, sin
tocar la función.

El error sube sin que nada lo atrape entre el punto del fallo y el `catch`
general de `processInbound` (processor.ts:803). Y la línea que preserva el
comprobante para el SAT —`saveCfdiXmlRaw(op.tenantId, xml.uuid, gastoId,
xmlText!)`, processor.ts:523— está DESPUÉS del `addGasto`/`updateGastoCfdiXml`
que acaba de tronar, así que **nunca se ejecuta**. El XML no queda ni como
gasto ni como respaldo crudo.

**Consecuencia.** El operador recibe el mensaje genérico de
`processor.ts:839` — *"Perdón, se me trabó tantito. ¿Me reenvías tu último
mensaje?"*— que no dice qué pasó. Reenviar el MISMO XML falla exactamente
igual: no es un error transitorio, es el mismo atributo mal formado. El
comprobante real, timbrado, con IEPS e IVA acreditables calculables, con
complemento de hidrocarburos, **desaparece del producto sin dejar rastro
recuperable** — ni gasto, ni XML crudo (CFF art. 30, la obligación que la
propia línea 522 dice estar cumpliendo). Antes de la 0025 el mismo XML se
habría guardado con `forma_pago = '1'` — un dato sucio que como mucho apagaba
la regla de LISR 27-III sobre ESE gasto, pero el comprobante y su IEPS
acreditable quedaban en la base. Ahora se pierde el gasto entero.

**Lo que no es.** No es un hallazgo contra el CHECK en sí — la regla es
correcta y cierra exactamente el hueco de OCR que describe. Y el camino de
fotos (OCR) queda intacto: solo el reenvío de XML crudo pasa por el atributo
sin validar. Tampoco encontré un CFDI real en producción con este defecto —es
un hueco de manejo de errores, no una corrupción presente— y no lo pude
reproducir sin escribir en Supabase, que el MAPA prohíbe.

**Causa raíz.** La 0025 mapeó su defensa contra el escritor que el propio
comentario investigó (OCR) y no contra el segundo escritor de la misma
columna. `pg_errores.ts` sigue con la forma de "un código, un índice" que
sirvió para 23505 y no se extendió a 23514, así que cualquier CHECK nuevo cae
en el `throw e;` genérico por diseño, no por descuido — pero ese diseño no
distingue "error interno" de "documento fiscal real que el usuario mandó y que
no se puede simplemente reintentar".

---

### [ALTO] Sin aplicar a propósito: la misma foto sigue siendo dos gastos si cae en dos viajes

`supabase/migrations/0027_gasto_img_hash_por_tenant.sql` (existe, no aplicada) ·
verificado en `pg_indexes` HOY: `uq_gasto_img_hash` sigue siendo
`(tenant_id, viaje_id, img_hash)`, sin el `viaje_id` fuera de la llave.

**Evidencia.** `supabase_migrations.schema_migrations` no trae la fila de 0027
(el salto es 0026 → 0028 → 0029, sin 0027). Consultado hoy en `gasto`: el hash
`250a4e5b34ecba43d043bf63b771c384296c5a62917bf326ab2826d1e9349d98` sigue en
DOS filas —`26fd8543-…` (viaje `…00ff`) y `19299f03-…` (viaje `…00fe`)—, el
mismo par que encontró la ronda 5. Nada cambió: es el estado esperado, porque
el MAPA de esta ronda dice explícitamente que 0027 se dejó sin aplicar **a
propósito**.

**Por qué sigue siendo ALTO y no una nota informativa.** El MAPA no dice por
qué se dejó sin aplicar, y la propia 0027 explica que su primer paso —antes de
crear el índice— es un `UPDATE` que DEGRADA los hashes duplicados actuales
(los mueve a `ocr_extra.imgHashDuplicado` y pone `img_hash = null`). Es una
migración con efecto en datos vivos, no solo en esquema, y por eso tiene
sentido tratarla distinto a las otras cinco. Pero mientras siga así, el hueco
que describía la ronda 5 sigue exactamente igual: un ticket sin folio ni UUID
(papel térmico, el caso normal) reenviado en dos viajes se comprueba dos veces
contra dos anticipos, y ni el motor (dedupe intra-viaje por `folio`) ni
`detectarDuplicadosEntreViajes` (solo corre después del cierre y empata por
UUID/folio, nunca por hash) lo cazan.

**Consecuencia.** Sin cambios respecto a la ronda 5: el fraude/reenvío número
uno del sector tiene barrera de base solo dentro de un viaje.

**Causa raíz.** Decisión deliberada de no tocar datos vivos a nueve días del
demo sin decidirlo a propósito. Correcta como decisión de secuencia, pero el
hueco de producto sigue abierto y hay que decirlo con la misma fuerza que la
ronda 5, no bajarle el tono porque ya se escribió el arreglo.

---

### [MEDIO] `wa_conversacion` sigue sin normalizar el teléfono; `operador_id` sigue en NULL siempre

`src/lib/cuadra/conv.ts:168-192` (`loadConversation`) ·
`src/lib/cuadra/processor.ts:571` ·
`supabase/migrations/0001_init.sql:81` (índice único sobre texto crudo, sin
tocar por 0024)

**Evidencia, verificado hoy contra producción.** `wa_conversacion` tiene 2
filas: `telefono = '+521111111101'` con `operador_id = null`, y
`telefono = '5219993700779'` con `operador_id = null` — la MISMA fila que
encontró la ronda 5, sin tocar. `operador.telefono` para el mismo operador es
`'529993700779'` (sin el "1"): son la misma persona, dos cadenas.
`loadConversation(op.tenantId, msg.from, viajeId)` (processor.ts:571) sigue
recibiendo `msg.from` —el crudo que manda Meta, no `op.telefono`— y
`conv.ts:174` sigue buscando con `.eq('telefono', telefono)` contra ese texto.
El `insert` de `conv.ts:188` sigue sin poner `operador_id` pese a que la
columna y su FK existen desde 0001.

**Por qué las migraciones de ayer no lo tocaron.** 0024 normalizó
`operador.telefono` con un ÍNDICE FUNCIONAL, no cambió la tabla
`wa_conversacion` ni su índice único (que sigue siendo el de 0005, sobre texto
crudo). Es una decisión de alcance correcta —0024 se escribió para el CRÍTICO
de `operador`—, pero el efecto es que este MEDIO, hermano del mismo patrón,
queda exactamente donde la ronda 5 lo dejó.

**Escenario con valores, sin cambios respecto a la ronda 5.** Si el mismo
número entra una vez como `5219993700779` y otra como `529993700779` —el MAPA
de esta ronda documenta que las dos formas siguen circulando—, se crea una
SEGUNDA fila de conversación, el contexto de hasta 12 turnos se parte en dos, y
sin `operador_id` no hay forma de reconciliarlas.

**Consecuencia.** No es dinero, es la sala del demo: el operador pierde el
hilo a media conversación.

---

### [MEDIO] `gasto.fecha` sigue nullable sin CHECK; la fila de la ronda 5 sigue ahí

`supabase/migrations/0001_init.sql:62` · `src/lib/cuadra/cuadre/engine.ts:198` ·
`src/lib/cuadra/repo.ts:552` (`getAcumuladoCombustible`, filtro `.gte('fecha',
...)`)

**Evidencia.** La 0025 agregó CHECK a `concepto`, `estado_sat`, `forma_pago`,
`estatus` (de `viaje` y `liquidacion`), `intake_pendientes`, `rol` y `fase`, y
tres `NaN` — pero NO a `fecha`. Verificado hoy: la fila
`5fc0c049-a317-441c-b9ab-ee524bcf5441` (el `alimentacion $1,050` del viaje
`…00ff`) sigue con `fecha = NULL`, exactamente como la encontró la ronda 5.

**Por qué sigue igual.** Un `NOT NULL` sí habría sido una opción barata —a
diferencia del CHECK de monto, que la 0019 argumenta que sería un retroceso,
aquí no hay un argumento equivalente documentado en ningún comentario de las
seis migraciones de ayer. Simplemente no se tocó.

**Consecuencia, sin cambios respecto a la ronda 5.** `getAcumuladoCombustible`
filtra con `.gte('fecha', ...)`, y en SQL `NULL >= '2026-01-01'` es `NULL`, no
`TRUE`: la fila queda fuera del contador del 15% de efectivo en combustible
(RFA 2026 regla 2.9) aunque sí sume a `totalComprobado`.

---

## Invariantes del código y si la base los impone (actualizado ronda 6)

| Invariante que el código asume | Dónde lo asume | Restricción en la base | Cambió esta ronda |
|---|---|---|---|
| Un teléfono → un operador activo | `conv.ts:59-97` (`resolveOperador`, `.limit(2)` + `OperadorAmbiguo`) | ✅ `uq_operador_telefono_activo` (0024), índice funcional GLOBAL sobre `telefono_normalizado()` | **Cerrado.** Antes: ninguna. Verificado en prod: 3 operadores activos, cero duplicados normalizados |
| `gasto.concepto` ∈ los 9 valores de `ConceptoGasto` | `types/cuadra.ts:20`, `ocr.ts:35` (zod), `concepto.ts:33-43` | ✅ `gasto_concepto_dominio` (0025) | **Cerrado**, y confirmado que los dos escritores de `gasto` (OCR con zod, XML con `conceptoDesdeClave`) ya solo emiten valores en dominio — el CHECK no puede tronar desde la app hoy |
| `gasto.forma_pago` tiene forma de 2 dígitos | `ocr.ts:307` (mapeo controlado) | ⚠️ `gasto_forma_pago_formato` (0025) — protege el camino de OCR, pero `cfdi_xml.ts:127` escribe el atributo del XML SIN pasar por ningún control | **Se agregó, y abrió el hallazgo ALTO de arriba**: el segundo escritor no estaba contemplado |
| `viaje.estatus` ∈ {abierto, en_cuadre, liquidado} | `conv.ts:129` | ✅ `viaje_estatus_dominio` (0025) | **Cerrado** (protege solo altas por consola: cero `insert into viaje` en `src/`) |
| `liquidacion.estatus` ∈ {cuadrada, con_diferencias, revisar} | `types/cuadra.ts:102` | ✅ `liquidacion_estatus_dominio` (0025) | **Cerrado** |
| `gasto.estado_sat` ∈ dominio | `sat.ts:18,54-58` (tipo + switch cerrado) | ✅ `gasto_estado_sat_dominio` (0025) | **Cerrado**, y el único escritor (`sat.ts`) ya solo puede emitir los 4 valores |
| `app_user.rol` ∈ dominio | `is_superadmin()` | ✅ `app_user_rol_dominio` (0025) | **Cerrado** (tabla vacía, momento barato) |
| Un operador tiene a lo más UN viaje abierto | `conv.ts:123-140` (`.limit(1)`) | ✅ `uq_viaje_abierto_por_operador` (0029), índice parcial | **Cerrado.** Protege solo altas por consola/seed: cero `insert into viaje` en `src/` hoy |
| `gasto.tenant_id` = `viaje.tenant_id` (y lo mismo para `liquidacion`, `codigo_pendiente`, `viaje.operador_id`) | implícito en todo `repo.ts` | ✅ FK compuestas `*_tenant_fkey` (0028) | **Cerrado y verificado en `pg_constraint`.** `tenantId`/`viajeId` viajan siempre juntos en el código actual, así que la defensa no se activa hoy — es red, no parche |
| `tenant.config` tiene la forma de `CuadraConfig` | `config.ts:109` (cast ciego, sin zod) | ✅ `tenant_config_valida` (0026), función que LANZA con el motivo | **Cerrado.** Sin escritor en `src/` (las tres apariciones de `from('tenant')` son `select`), así que solo protege la consola — pero blinda retroactivamente el cast ciego de `getConfig` |
| Una foto (mismo SHA-256) = un gasto | `processor.ts:410` (`violaIndice(e,'uq_gasto_img_hash')`) | ⚠️ **Sigue parcial.** El índice sigue siendo `(tenant, viaje, hash)` — 0027 escrita, sin aplicar a propósito | **Sin cambios.** Mismo par de gastos duplicados en producción que en la ronda 5 |
| `wa_conversacion` es una por (tenant, teléfono normalizado) | — | ⚠️ Sigue sobre texto crudo (0005), sin normalizar | **Sin cambios** |
| `gasto.fecha` siempre presente cuando se puede filtrar por ejercicio | `repo.ts:552` (`.gte/.lte`) | **Ninguna.** Sigue `date` nullable sin CHECK | **Sin cambios** |
| El esquema del repo = el esquema de producción | implícito en `supabase db push` | ✅ **Reparado.** 27 migraciones aplicadas, 27 versionadas (0027 es la única excepción, y está DOCUMENTADA como deliberada, no como fuga) | **Cerrado.** Era el riesgo mayor de la ronda 5 |
| Un error de Postgres en la escritura de `gasto` se traduce a un mensaje útil o se identifica su causa | `pg_errores.ts` (`violaIndice`), `processor.ts:406-422` | N/A — es una garantía de CÓDIGO, no de esquema, pero la trae esta ronda porque la pidió el brief | **Parcial.** Cubre 23505 contra dos índices nombrados. Un 23514 nuevo (como el de `forma_pago` de arriba) cae en el `throw e;` genérico sin diagnóstico específico |

---

## Lo que revisé y está bien

- **El esquema del repo volvió a ser la fuente de verdad.** Las 27 migraciones
  de `supabase/migrations/` (0001–0026, 0028–0029) están, una a una, en
  `supabase_migrations.schema_migrations` de producción. 0027 es la única
  ausencia, y está documentada como decisión, no como fuga — la diferencia
  exacta que la ronda 5 marcó como el riesgo mayor.
- **`resolveOperador` y `getOpenViaje` ya no confunden "no contestó" con "no
  existe".** `ConsultaFallida` y `OperadorAmbiguo` son tipos propios,
  distinguidos en el `catch` general de `processInbound` (processor.ts:814-815)
  con un mensaje DISTINTO para cada caso (`processor.ts:835-839`) — el patrón
  de "fallo de consulta disfrazado de negación" que el MAPA pedía perseguir no
  vive aquí. Es la cuarta vez que se cierra este patrón en el repo (startup,
  intakeDelta, y ahora operador+viaje).
- **`guardar_liquidacion_tx` quedó con una sola firma.** La 0022 se
  autoverifica (`raise exception` si quedan dos) y `pg_proc` confirma hoy una
  sola función con ese nombre.
- **Las FK compuestas y el índice de un-viaje-abierto son defensas correctas
  que no activan un solo camino vivo.** Confirmé con `command grep` (dos
  búsquedas) que no hay un solo `insert into operador` ni `insert into viaje`
  en `src/`: las dos migraciones que dependían de eso protegen exclusivamente
  la consola, y lo hacen sin fricción para la app.
- **`tenant.config` con esquema en la base blinda retroactivamente un cast
  ciego que ya existía en `config.ts:109`.** No se tocó una línea de `src/` y
  el riesgo de esa lectura bajó igual.
- **Los CHECK de dominio están bien acotados donde el argumento lo pide.** La
  0025 explícitamente NO puso CHECK a `monto` (por el argumento ya validado de
  la 0019) ni a `tenant.plan` (sin consumidor) ni al catálogo completo de
  `forma_pago` (solo la FORMA) — decisiones documentadas y correctas, no
  omisiones.
- **La mayoría de las migraciones nuevas SÍ documentan su reversa** (0022,
  0024, 0026, 0027, 0028, 0029 traen un bloque "Reversible:" con el SQL
  exacto), aunque siga sin existir tooling de `down` migrations. Mejora real
  sobre el BAJO de la ronda 5, aunque no lo cierra del todo.

## Lo que NO alcancé a revisar

- **El bucket `liquidaciones` de Storage** — mismo pendiente que la ronda 5,
  sigue sin revisar `storage.objects`.
- **Si `wa_mensaje_procesado` se purga** — sin cambios, sigue sin job de
  limpieza visible.
- **Reproducir el 23514 de `forma_pago` contra la base real.** El hallazgo
  ALTO de arriba se armó leyendo `cfdi_xml.ts`, `processor.ts`, `repo.ts` y
  `pg_errores.ts` y verificando la definición exacta del CHECK en
  `pg_constraint`; no construí un XML malformado y lo mandé por el flujo real
  porque el MAPA prohíbe escribir en Supabase y el `.env.local` no expone un
  atajo de solo-lectura para simular el INSERT sin persistirlo. Vale la pena
  confirmarlo con un bloque `DO … raise exception` en `verificaciones.sql`
  (que sí revierte), como quedó pendiente para el escenario de operador
  ambiguo en la ronda 5.
- **`llm_costo`** — sin cambios, sigue sin revisar si `liquidacion_id` se llena
  alguna vez.
- **El panel del contralor contra el esquema** — mismo pendiente, mejor
  situado el auditor de frontend.
