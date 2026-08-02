# Modelo de datos y esquema — auditoría 9

**Nota: 7/10** (antes 8). Razón del movimiento: deuda que cobró factura — la
misma familia de bug que la 0037 vino a cerrar (un `UPDATE` que reescribe un
gasto ya liquidado sin que la base lo vea) se volvió a abrir esta MISMA ronda
por una puerta distinta: la 0037 protege `monto`/`sub_total`/`iva_traslado`/
`ieps_traslado`/`cfdi_uuid`, pero la función nueva de esta ronda,
`corregirFechaGasto`, solo toca `fecha` — la columna que el `when` del trigger
no mira — y `fecha` no es cosmética: decide en vivo si un gasto de combustible
sale deducible, no deducible o "por confirmar".

Anclado a `b35daafcd484b1742729aaa6c2130dbd84b9f40e` (`git rev-parse HEAD` al
empezar).

El riesgo mayor del rubro hoy: la garantía "el PDF archivado y lo que hay en
`gasto` dicen lo mismo, para siempre" —el propósito explícito de 0036/0037—
sigue sosteniéndose solo por partes: cubre INSERT (0036) y UPDATE de
monto/impuestos/UUID (0037), pero no UPDATE de fecha, y el propio código
(`repo.ts:300-301`, `processor.ts:695-698`) da por hecho que sí, con un
comentario que hoy es falso.

## Hallazgos

### [ALTO] El `when` de la 0037 no incluye `fecha` — `corregirFechaGasto` reescribe un gasto ya liquidado sin que la base lo impida, y el código cree lo contrario

`supabase/migrations/0037_gasto_no_tras_liquidar_update.sql:21-27` (el `when`
del trigger solo compara `monto, sub_total, iva_traslado, ieps_traslado,
cfdi_uuid` — `fecha` no aparece) · `src/lib/cuadra/repo.ts:303-321`
(`corregirFechaGasto`, hace `update({ fecha }).eq('id', gastoId).eq('tenant_id',
tenantId)` — toca exactamente la columna que el `when` no vigila) ·
`src/lib/cuadra/repo.ts:300-301` (el comentario de la propia función: *"El
trigger de la 0037 sigue mandando: si la liquidación ya se emitió, esto levanta
`CU001` ... igual que en el alta"* — falso para este UPDATE concreto) ·
`src/lib/cuadra/processor.ts:689-707` (rama `corregir_fecha`: llama a
`corregirFechaGasto` dentro de un `try`, y el `catch` solo tiene un camino para
`llegoTarde(e)` — que nunca se dispara porque el `UPDATE` nunca lanza) ·
`src/lib/cuadra/intake/emparejar.ts:64-75` (`emparejarCorreccionDeFecha` empareja
por monto+concepto+folio contra `gastos` sin mirar el estatus del viaje ni de la
liquidación) · `src/lib/cuadra/cuadre/engine.ts:426,430,455-466` (`g.fecha`
decide `miraElComplemento` y `exigible`, que deciden si un gasto de combustible
cae en `complemento_hidrocarburos` (no deducible) o en `complemento_no_verificable`
(por confirmar)) · `src/lib/cuadra/analytics.ts:347-390` (`reconstruir()`
recalcula el detalle EN VIVO llamando a `cuadrarDesdeDB` con la `fecha` actual de
`gasto`, y el "portón" de la línea 355 solo compara `totalComprobado` —que no se
mueve cuando solo cambia la fecha— así que no detecta esta deriva).

**Por qué es alcanzable.** `corregirFechaGasto` es el escritor de la 0037 en la
que nadie pensó: la migración se escribió para blindar `updateGastoCfdiXml`
(auditoría 8), y esta ronda agregó un SEGUNDO `UPDATE` sobre `gasto` —
`corregirFechaGasto`— sin volver a tocar el `when` del trigger que se supone lo
cubre. El camino que llega ahí es la misma clase de carrera que 0036/0037 ya
documentan para sus propios casos: `viajeId` se resuelve al principio de
`processInbound` (vía `getOpenViaje`) y no se vuelve a verificar antes del
`UPDATE`; entre que se le pide al operador la segunda foto (porque la primera
trajo una fecha dudosa, `fecha_dudosa.ts`) y que esa foto llega, el resto del
viaje puede cerrarse con "listo" — `getGastos`/`emparejarCorreccionDeFecha` no
filtran por estatus, así que el gasto sigue siendo un candidato válido aunque su
viaje ya tenga liquidación emitida.

**Escenario con valores.** Viaje con anticipo $6,000. El operador manda la foto
de un ticket de diésel de $5,800 con complemento de hidrocarburos ya verificado
(`xmlVerificado = true`); la fecha se lee `2026-07-31` pero la ventana del viaje
la marca dudosa (`fecha_dudosa.ts`, motivo `fuera_de_rango`) y el sistema le pide
al operador otra foto. El operador sigue mandando el resto de tickets y escribe
"listo"; el viaje se liquida con ese gasto de diésel adentro, con su fecha
dudosa y su clasificación fiscal calculada en ese momento (supongamos
`exigibleDesde = '2026-08-01'`: con fecha `2026-07-31`, `exigible = false` →
el motor lo manda a `complemento_no_verificable`, "por confirmar", no resta de
lo deducible). El PDF se genera y se manda al operador y —eventualmente— al
contralor con esa cifra. Un minuto después llega la foto que sí se le había
pedido, ahora con fecha `2026-08-02` (la real). `emparejarCorreccionDeFecha` la
empareja contra el mismo gasto ($5,800, mismo concepto, fecha ya marcada
dudosa) y `corregirFechaGasto` ejecuta `UPDATE gasto SET fecha='2026-08-02'
WHERE id=...`. Como `monto`, `sub_total`, `iva_traslado`, `ieps_traslado` y
`cfdi_uuid` no cambian, el `when` de la 0037 es `false`, la función
`gasto_no_tras_liquidar()` —que toma el candado sobre `viaje` y comprueba si ya
hay liquidación— **nunca se ejecuta**, y el `UPDATE` pasa sin error. El operador
recibe *"Ya quedó ✅ — ese ticket de $5,800.00 ahora tiene fecha 2 de
agosto"*. La próxima vez que el contralor abre el detalle de esa liquidación
(`analytics.ts::reconstruir()`), `cuadrarDesdeDB` vuelve a correr el motor con
la fecha YA cambiada: con `2026-08-02 >= exigibleDesde`, `exigible` pasa a
`true` y el mismo gasto de $5,800 se reclasifica a `complemento_hidrocarburos`
— no deducible. El "portón" que compara `totalComprobado` no ve nada raro
(la suma sigue siendo la misma, solo cambió qué cubeta ocupa cada peso), así
que el panel muestra $5,800 no deducibles donde el PDF archivado —el que ya se
mandó— decía "por confirmar". Nadie recibe aviso de la reclasificación; ni
log, ni mensaje al operador (que ya se fue con un "ya quedó" en la mano), ni
marca en el detalle de que el número cambió después de emitido.

**Consecuencia.** El mismo daño que 0036/0037 nombran en sus propios
comentarios —"el texto y el PDF de la misma respuesta salían de dos
fotografías distintas"— reabierto por la columna que faltó en la lista. El
contralor puede ver un desglose fiscal que contradice el PDF que ya archivó
(CFF art. 30) sin ninguna marca de que algo cambió, y el sistema le confirmó al
operador que su corrección "quedó" cuando en realidad violó la regla que el
propio producto cree tener cerrada — el peor de los dos mundos: no hay error
que alguien pueda investigar, y hay una confirmación positiva que refuerza la
falsa seguridad.

**Cómo se confirmó, no solo se leyó.** `supabase/verificaciones.sql:810-849`
(bloque 20, el que prueba la 0037) ejercita exactamente `monto` +
`cfdi_uuid` como el `UPDATE` bloqueado y `clave_prod_serv` como el control que
sí debe pasar — nunca `fecha`. El propio archivo de verificación contra
Postgres real nunca corrió el caso que está roto, así que no hay contradicción
entre "se verificó contra producción" y este hallazgo: el hueco está
exactamente donde nadie miró.

**Causa raíz probable.** Mismo patrón que el hallazgo ALTO de la ronda 8 (y el
de `forma_pago` de la ronda 6): una restricción se escribe mirando al escritor
que causó el incidente conocido, y el siguiente escritor de la misma tabla
—aquí, uno que se agregó en la MISMA ronda que "cerró" el problema— queda
fuera porque nadie vuelve a preguntarse "¿qué más escribe esta tabla?" cada vez
que aparece una función nueva.

## Lo que revisé y está bien

- **`foto_pendiente` (0038): el `unique(viaje_id)` sí impide dos filas vivas
  del mismo viaje, sin atajo.** No hay soft-delete: `reclamarFotoPendiente`
  hace `delete ... returning`, así que una fila reclamada o vencida
  desaparece de verdad y dos llamadores que compiten por la misma fila
  (`repo.ts:520-530`) no pueden llevarse las dos la copia — es atómico por
  construcción del `DELETE ... RETURNING`. `guardarFotoPendiente`
  (`repo.ts:486-497`) trata el `23505` del unique como señal de "ya hay una
  esperando", no como error, y el bloque 21 de `verificaciones.sql` lo prueba
  contra Postgres real: segunda fila rechazada con `23505`, primer reclamo se
  lleva la fila, segundo reclamo no encuentra nada. `viaje_id` solo (sin
  `tenant_id` en el unique) es correcto: un `viaje_id` ya implica un único
  tenant por la FK, así que no hay fuga entre flotas posible por esa vía.
- **`comprobante_huerfano` (0040): RLS deny-all verificado leyendo como
  `anon`, no solo mirando el catálogo.** El bloque 23 de `verificaciones.sql`
  hace `set local role anon` contra una fila sembrada y confirma 0 filas
  visibles, y por separado confirma que `service_role` sigue viendo todo
  (`BYPASSRLS`) — exactamente lo que el rubro pide: que el candado no dependa
  de que la aplicación se porte bien, y que el pipeline (`service_role`) siga
  operando. Sin policy sobre una tabla con `anon`/`authenticated` con
  SELECT/INSERT/UPDATE/DELETE por el default del esquema `public` —el propio
  comentario de la migración lo señala— es la única defensa real, y se probó
  como tal.
- **La cadena hasta el dinero real de `comprobante_huerfano` sigue protegida
  por los CHECK existentes.** La columna `gasto jsonb not null` no restringe
  la forma del contenido (no hay CHECK de shape), y `getHuerfanos`
  (`repo.ts:251-258`) hace un cast ciego `r.gasto as Gasto` — en principio un
  tipo de TS más estricto que la columna. Pero verifiqué que el único camino
  real hacia dinero es `addGasto(op.tenantId, viajeId, h.gasto)`
  (`processor.ts:1062`), que sí pasa por las columnas con CHECK de la 0025
  (`gasto_concepto_dominio`, `gasto_monto_no_nan`) y por el `NOT NULL` de
  `monto`/`concepto` de `0001_init.sql`; un JSON malformado truena ahí con un
  error de Postgres capturado en el `try/catch` de `processor.ts:1061-1069`,
  no entra silencioso. No lo elevo a hallazgo porque el punto de entrada real
  al dinero sigue blindado.
- **Las tres migraciones nuevas (0037, 0038, 0040) son reversibles con un
  `DROP` simple** — un trigger, una tabla, una tabla — sin dependencias
  cruzadas que compliquen deshacerlas.
- **`gasto.monto numeric(12,2) not null`, `gasto_concepto_dominio` y el resto
  de los CHECK de la 0025 siguen aplicados y sin tocar** por ninguna de las
  cuatro migraciones nuevas de esta ronda — confirmé que ninguna las
  modifica ni las reemplaza.
- **`TipoDiferencia` con `permiso_cre_no_verificable` (`types/cuadra.ts:92`)
  es solo una etiqueta de UI/motor**, sin columna ni CHECK asociado en la
  base — correcto: la 0025 explícitamente no restringe dominios sin
  consumidor real, y `diferencias` vive en `jsonb` sin dominio desde antes.

## Lo que NO alcancé a revisar

- **RLS de `foto_pendiente` (0038) no se probó leyendo como `anon`**, a
  diferencia de `comprobante_huerfano` (bloque 23). El bloque 21 solo
  ejercita la unicidad y el reclamo atómico; la migración usa el mismo
  mecanismo verificado en 0012/0016/0040 (`enable row level security` sin
  policy = deny-all), así que no lo reporto como hallazgo, pero no está
  confirmado con la misma rigurosidad que su tabla gemela — valdría un bloque
  análogo al 23 en `verificaciones.sql`.
- **No hay job de limpieza visible para `foto_pendiente` si una fila queda
  huérfana** (proceso caído entre `guardarFotoPendiente` y el reclamo). No es
  un riesgo de integridad —el `unique` sigue sosteniéndose y el peor caso es
  que ese viaje deje de beneficiarse de la optimización de una sola visión,
  cayendo al camino de "se procesa sola"— así que lo dejo fuera de un
  hallazgo formal de este rubro; lo anoto porque toca rendimiento/operabilidad
  y no lo until de otro auditor.
- **No reproduje el `UPDATE` del hallazgo ALTO contra Postgres real.** Lo
  armé leyendo el `when` de la 0037 letra por letra, `corregirFechaGasto`,
  el `catch` de `processor.ts` y el propio bloque 20 de
  `verificaciones.sql` (que confirma qué SÍ prueba y qué no toca). No escribí
  ni corrí un `DO $$...$$` de prueba porque el MAPA no autoriza escrituras
  fuera de lectura — igual que la auditoría 8 dejó pendiente para el
  hallazgo gemelo del monto. Valdría un bloque 24 en `verificaciones.sql`
  análogo al 20 pero con un `UPDATE ... SET fecha = ...` tras liquidar.
  contra un tenant de prueba.
- **`wa_conversacion` sin normalizar y `gasto.fecha` nullable sin CHECK** —
  los dos MEDIOS reincidentes de la ronda 8 — no los re-verifiqué contra
  producción esta ronda por presupuesto de tiempo; ninguna de las cuatro
  migraciones nuevas los toca, así que asumo que siguen igual, sin
  confirmarlo con una consulta fresca.
- **El bucket `liquidaciones` de Storage y sus policies** — mismo pendiente
  arrastrado desde la ronda 5.
- **`round2()` reimplementado en cuatro archivos de dinero** — lo señala el
  MAPA como sin atacar esta ronda; lo dejo para el rubro de arquitectura, que
  es donde se documentó, y no dupliqué la verificación aquí.
