# Modelo de datos y esquema — auditoría 8

**Nota: 8/10** (antes 7). Razón del movimiento: **se atacó y subió**, con
verificación fresca contra producción, no contra el commit.

Los dos ALTOS que dejó abiertos la ronda 6 están **cerrados de verdad**, y no
por el mensaje del commit: lo comprobé yo mismo contra `gngoqsvrxdguxvsizpbw`
hoy. (1) El CHECK de `forma_pago` que podía tirar un CFDI real entero ahora
tiene un normalizador dedicado (`formaPagoSat`, `cfdi_xml.ts:87-91`) con su
propia suite de pruebas que afirma explícitamente "ningún valor posible viola
el CHECK de la 0025". (2) La migración 0027 —que la ronda 6 marcó como
"sin aplicar a propósito" y que el propio MAPA de esta ronda seguía dando por
sin aplicar— **sí está aplicada**: la confirmé en `pg_indexes`
(`uq_gasto_img_hash` ya es `(tenant_id, img_hash)`, sin `viaje_id`) y con una
consulta directa (`select ... group by tenant_id, img_hash having count(*)>1`
→ cero filas). El MAPA de esta ronda estaba desactualizado en ese punto — vale
la pena que el orquestador lo sepa para la síntesis.

No sube a 9+ porque, revisando las seis migraciones nuevas migración por
migración —el encargo explícito de esta ronda—, encontré que **0036, la que
cierra "el último crítico de código de las siete rondas", solo protege la
mitad de los escritores de `gasto`**: el trigger es `before insert`, y el
segundo escritor real (`updateGastoCfdiXml`, un UPDATE) puede seguir
reescribiendo el monto y los impuestos acreditables de un gasto que ya forma
parte de una liquidación emitida, sin que la base lo impida y sin que nadie se
entere. Es un ALTO nuevo, de la misma familia que el que la 0036 vino a cerrar
— por eso no compensa del todo el cierre de los dos anteriores. Los dos MEDIOS
de la ronda 6 (`wa_conversacion` sin normalizar, `gasto.fecha` nullable) siguen
exactamente iguales, confirmado con las mismas dos filas y el mismo conteo.

El riesgo mayor del rubro hoy: la base ya impide que un gasto **nuevo** entre
después de liquidar un viaje, pero no impide que un gasto **existente** de ese
viaje cambie de monto después — la garantía que el producto necesita ("el PDF
archivado y lo que hay en `gasto` dicen lo mismo, para siempre") solo se
sostiene por la mitad.

## Hallazgos

### [ALTO] La 0036 blinda el INSERT en `gasto`, no el UPDATE — un XML tardío puede reescribir el monto de un gasto ya liquidado

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:76-78` (`before insert on
gasto`, no `before update`) · `src/lib/cuadra/repo.ts:198-237`
(`updateGastoCfdiXml`, hace `UPDATE ... WHERE id = gastoId AND tenant_id =
tenantId`, sin mirar `viaje_id` ni `liquidacion`) · `src/lib/cuadra/repo.ts:211`
(`if (x.total != null && x.total > 0) extra.monto = x.total`) ·
`src/lib/cuadra/processor.ts:568-631` (rama "DOCUMENTO: XML del CFDI") ·
`src/lib/cuadra/processor.ts:253` (`getOpenViaje`, la única verificación de
estatus, y no se repite antes del `update`) · `src/lib/cuadra/processor.ts:676`
(el mutex del viaje se toma para la rama de TEXTO; la rama de DOCUMENTO, igual
que la de IMAGEN, corre sin tomarlo — mismo diseño que abrió el hueco de 0036,
sin cerrarlo aquí).

**Evidencia.** Confirmé contra producción que el trigger de la 0036 es el único
que existe sobre `gasto` (`pg_trigger` → un solo `trg_gasto_no_tras_liquidar`,
`BEFORE INSERT`, cero triggers de `UPDATE`). `updateGastoCfdiXml` es uno de los
dos únicos escritores de `gasto` en todo `src/` —el propio comentario de
`repo.ts:227-232` lo dice, citando esta misma auditoría en la ronda 6— y hace
un `UPDATE` liso, sin `FOR UPDATE` sobre `viaje` y sin comprobar si ya existe
una `liquidacion` para ese `viaje_id`. `verificaciones.sql:770-808` (bloque 19,
el que prueba la 0036) solo ejerce dos `INSERT` —antes y después de
liquidar—; nunca un `UPDATE`. El hueco nunca se probó porque nunca se buscó ahí.

**Escenario con valores.** El operador manda un ticket de diésel en papel
térmico ($850, sin folio, sin UUID) → `addGasto` lo registra. Minutos después,
en el mismo tramo de mensajes, manda "listo" y —es el flujo documentado como
"NIVEL 2 del complemento de hidrocarburos"— adjunta el XML que la gasolinera le
mandó por correo para ESE mismo ticket. Las dos cosas llegan como mensajes
separados de WhatsApp y corren en invocaciones distintas de `processInbound`.
La rama de TEXTO toma el mutex y cierra: `guardar_liquidacion_tx` inserta la
`liquidacion` con `total_comprobado = 4,850` (entre otros gastos) y pone
`viaje.estatus = 'liquidado'`. La rama de DOCUMENTO, sin mutex, ya había leído
`getOpenViaje` con el viaje todavía `abierto` (o `en_cuadre`) — la misma
ventana de milisegundos que el propio comentario de la 0036 describe para el
`INSERT` tardío. Con ese `viajeId` en mano, `getGastos` trae el ticket de
$850, `emparejarXmlConTicket` lo empareja por monto+fecha, y
`updateGastoCfdiXml` corre: si el XML trae `Total="812.40"` (el monto real
timbrado, distinto del que leyó la visión del ticket), la columna `monto` del
gasto pasa de $850 a $812.40 —y con ella `iepsTraslado`, `ivaTraslado`,
`complementoHidrocarburos`, `formaPago`— **sin ningún error, sin ningún log,
después de que el PDF con "$850" ya se generó y se mandó**.

**Consecuencia.** El PDF archivado (CFF art. 30) y el WhatsApp que el operador
ya recibió siguen diciendo $850/`total_comprobado=4,850`; la fila viva de
`gasto` ya dice $812.40. Si el contralor abre el detalle de esa liquidación
después (`analytics.ts:298-341`, `reconstruir()`), el "portón" que ronda 5/6
de frontend construyó para OTRO problema (config que cambió tras el cierre)
compara el `totalComprobado` recalculado contra el persistido con 1.5¢ de
tolerancia — y aquí SÍ cambió, así que ese portón detecta la divergencia de
monto y cae al camino de "gastos crudos, puede no sumar" en vez de mostrar una
cifra falsa. Pero si el XML llega con el MISMO total que ya tenía el ticket
—el caso más común, porque la visión suele leer bien el total impreso— y solo
cambia `complementoHidrocarburos`/`formaPago`/`iepsTraslado`/`ivaTraslado`
(los campos que deciden deducible/no-deducible/por-confirmar), el portón de
`totalComprobado` NO se activa: el panel recalcula las "tres cubetas" con
datos que el PDF ya emitido nunca tuvo, y se las enseña al contralor como si
fueran las mismas. Nadie —ni un log, ni un aviso al operador— registra que el
gasto cambió. Es exactamente el daño que la 0036 nombra en su propio
comentario ("el texto y el PDF de la misma respuesta salían de dos
fotografías distintas"), reabierto por la puerta de al lado.

**Causa raíz probable.** La 0036 se escribió mirando el escritor que causó el
incidente real del 31-jul (`addGasto`, un `INSERT`) y no contra el segundo
escritor de la misma tabla, que es un `UPDATE` con la misma exposición
temporal. Mismo patrón que el hallazgo de `forma_pago` de la ronda 6: una
restricción nueva mapeada contra UN escritor, no contra los dos.

---

### [MEDIO, REINCIDENTE] `wa_conversacion` sigue sin normalizar el teléfono; `operador_id` sigue en NULL siempre

`src/lib/cuadra/conv.ts:180-204` (`loadConversation`, `.eq('telefono',
telefono)` contra texto crudo; el `insert` de la línea 200 no incluye
`operador_id`) · `supabase/migrations/0001_init.sql` (índice único original,
sin tocar por ninguna de las doce migraciones desde entonces).

**Evidencia, verificada hoy contra producción.** `wa_conversacion` sigue con
exactamente 2 filas: `telefono = '+521111111101'` y `telefono =
'5219993700779'`, las dos con `operador_id = null`. `operador.telefono` para
ese mismo operador es `'529993700779'` (sin el "1"): misma persona, dos
cadenas, sin forma de reconciliarlas. Ninguna de las seis migraciones nuevas
tocó `wa_conversacion` ni su índice. Nada cambió respecto a la ronda 6.

**Consecuencia.** Sin cambios: si el mismo número entra una vez con el "1" de
Telmex y otra sin él, se crea una segunda fila de conversación y el contexto
se parte en dos a media charla — en la sala del demo, no en el dinero.

---

### [MEDIO, REINCIDENTE] `gasto.fecha` sigue nullable sin CHECK

`supabase/migrations/0025_dominios_check.sql` (agregó CHECK a `concepto`,
`estado_sat`, `forma_pago`, `estatus`, `rol`, `fase`, NaN de monto — no a
`fecha`) · `src/lib/cuadra/repo.ts:552` (`getAcumuladoCombustible`, filtro
`.gte('fecha', ...)`, y en SQL `NULL >= X` es `NULL`, no `TRUE`).

**Evidencia, verificada hoy.** `information_schema.columns` confirma
`fecha | is_nullable = YES | date`. De 19 filas vivas en `gasto`, **1 sigue con
`fecha = NULL`** — el mismo hueco de dominio que las rondas 5 y 6 encontraron,
sin CHECK ni `NOT NULL` en ninguna de las doce migraciones que corrieron desde
entonces (0025 tocó siete columnas de dominio y se saltó ésta otra vez).

**Consecuencia.** Sin cambios: esa fila queda fuera del contador del 15% de
efectivo en combustible (RFA 2026 regla 2.9) aunque sí sume al comprobado
total — un hueco de cumplimiento fiscal silencioso, no de dinero visible al
operador.

---

### [BAJO] El chequeo de arranque no vigila el índice que más veces necesitó una migración correctiva

`src/lib/cuadra/startup.ts:142-145` (`INDICES` solo lista
`uq_gasto_cfdi_uuid` y `uq_operador_telefono_activo`) ·
`supabase/migrations/0030_indices_faltantes.sql` (el mecanismo, de propósito
general, existe desde esta ronda) · `src/lib/cuadra/processor.ts` (`violaIndice(e,
'uq_gasto_img_hash')`, el índice que asume que existe con el alcance de la
0027).

**Evidencia.** `indices_faltantes` (0030) es genérico y correcto — se lo probé
contra el listado real de `pg_indexes` y funciona—, pero la lista que
`startup.ts` le pasa no incluye `uq_gasto_img_hash`: el mismo índice que pasó
por TRES migraciones (0014, 0015, 0027) porque su alcance estuvo mal una vez
ya en producción. Es el candidato más probable a volver a moverse (por
ejemplo, si algún día se separa `img_hash` en su propia tabla) y es el único
de los tres índices "vivos" de este rubro sin vigilancia de arranque.

**Consecuencia.** Si ese índice desapareciera en un entorno nuevo o por un
rollback parcial, el arranque no lo diría — el síntoma sería fotos duplicadas
entre viajes sin ningún log de `startup.migraciones`, el mismo modo de fallo
silencioso que la ronda 5 ya cazó una vez para `uq_gasto_cfdi_uuid`.

**Causa raíz probable.** `INDICES` se escribió para las dos migraciones cuyo
fallo el propio comentario cita por nombre (0019, 0024); `uq_gasto_img_hash`
no estaba mentalmente en esa lista porque en la ronda 6 todavía no estaba
resuelto — quedó fuera cuando se resolvió, no antes.

## Lo que revisé y está bien

- **Los dos ALTOS de la ronda 6, cerrados y verificados hoy contra
  `gngoqsvrxdguxvsizpbw`, no contra el commit.** `pg_indexes` confirma
  `uq_gasto_img_hash` en `(tenant_id, img_hash)`; una consulta directa de
  duplicados por hash da cero filas; `cfdi_xml.ts:87-91` normaliza
  `FormaPago` antes de que toque la base y `forma_pago_sat.test.ts` prueba
  que ninguna salida posible viola el CHECK. `list_migrations` trae las 36
  (0001–0036, incluida la 0027) y coincide 1:1 con los 36 archivos de
  `supabase/migrations/`: el esquema del repo sigue siendo la fuente de
  verdad, sin fugas.
- **0031 (TTL del contador de la barrera) es correcto y está bien acotado.**
  El olvido a los 10 minutos solo dispara cuando `intake_pendientes > 0` Y el
  sello está vencido; un incremento sano refresca el sello y uno saludable
  nunca se reinicia a medio vuelo. Cinco veces el peor caso legítimo (120s de
  `maxDuration`) de margen, igual que documenta el propio comentario.
- **0033 separa correctamente reserva de constancia para el aviso de
  privacidad.** `marcar_aviso_privacidad` ya NO escribe `aviso_privacidad_en`
  — solo `confirmar_aviso_privacidad` lo hace, y solo tras un envío
  confirmado por Meta. Verifiqué que las tres funciones tienen `revoke
  all ... from public, anon, authenticated` + `grant ... to service_role`
  explícito, y que el bloque 17 de `verificaciones.sql` (corrido el 31-jul,
  salida real copiada en el archivo) prueba justo el caso que importaba: la
  constancia de un aviso v1 sobrevive al reintento fallido de un v2.
- **0035 fija `search_path` en las diez funciones que lo tenían mutable**,
  confirmado con la lectura de `alter function ... set search_path`. El
  propio comentario es honesto sobre que el hueco no estaba abierto hoy
  (todas `SECURITY INVOKER`, solo ejecutables por `service_role`) — cierra
  una defensa futura sin inflar el riesgo actual.
- **0032 documenta correctamente una tabla muerta.** Comprobé con `command
  grep` que ningún archivo de `src/` (fuera de comentarios) hace `from
  ('politica_gasto')`; la tabla sigue con 4 filas de semilla, pero el
  `comment on table` deja escrito en el explorador de Supabase que no la lee
  nadie — exactamente donde alguien la encontraría por accidente.
- **El aislamiento entre tenants sigue intacto.** Corrí el bloque 18 de
  `verificaciones.sql` (solo lectura) contra producción hoy: `tablas-sin-rls=—
  politicas-que-dicen-true=— rpc-abiertas-a-anon=—`, los tres vacíos, como
  promete el archivo.
- **Las FK compuestas (0028) y el un-viaje-abierto (0029) siguen siendo redes
  correctas sin activar**: confirmé de nuevo que no hay un solo `insert into
  operador` ni `insert into viaje` en `src/`.

## Lo que NO alcancé a revisar

- **El bucket `liquidaciones` de Storage** — mismo pendiente desde la ronda 5,
  sigue sin revisar `storage.objects` y sus políticas.
- **Si `wa_mensaje_procesado` se purga** — sin cambios, sigue sin job de
  limpieza visible en las migraciones.
- **Reproducir en vivo el hallazgo ALTO de arriba con un `INSERT`/`UPDATE`
  real.** Lo armé leyendo `0036`, `repo.ts`, `processor.ts` y
  `verificaciones.sql`, y verificando en `pg_trigger` que el trigger es
  `BEFORE INSERT` únicamente — no construí un `DO $$ ... $$` que ejecute el
  `UPDATE` tardío contra un tenant de prueba porque el MAPA no autoriza
  escrituras y no quise usar la ventana de solo-lectura del MCP de Supabase
  para una escritura de prueba sin permiso explícito. Vale la pena un bloque
  20 en `verificaciones.sql` que haga exactamente eso —análogo al bloque 19,
  pero con un `UPDATE` en vez de un segundo `INSERT`— para confirmarlo con la
  misma rigurosidad que el resto del archivo.
- **`llm_costo`** — sin cambios, sigue sin revisar si `liquidacion_id` se
  llena alguna vez.
- **El panel del contralor contra el esquema, más allá de `reconstruir()`** —
  lo que sí miré fue el "portón" de `analytics.ts` porque resultó relevante
  para el hallazgo ALTO; el resto del panel lo cubre mejor el auditor de
  frontend.
