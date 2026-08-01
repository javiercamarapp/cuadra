# Modelo de datos y esquema — auditoría 8

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura**. La
ronda escribió la migración que cierra «el último crítico de código de las siete
rondas» (`0036`) y la ancló al instante equivocado: la regla dispara cuando
existe la fila de `liquidacion`, pero las cifras del PDF se congelan **segundos
antes**, en `computeCuadre`. En esa ventana el gasto entra, la base lo acepta, y
—por el arreglo de AG-3 de esta misma ronda, que hizo que el texto de WhatsApp
reúse el snapshot en vez de recalcular— ya nadie lo ve. El mecanismo que antes
gritaba la incoherencia ($800 con signo contrario) fue silenciado el mismo día
que se puso el candado que no cubre la ventana. Lo bueno también es real —0027
aplicada, 0031, 0033 y su bloque 17 verificado contra Postgres, 0028 y 0025
intactas— y por eso baja uno, no tres.

**El riesgo mayor del rubro, hoy:** la base cree que «nada entra después de
liquidar» y solo sabe impedir un `INSERT` **después** de que la fila de
liquidación existe; el `UPDATE`, el `DELETE` y los segundos que van del cuadre a
esa fila siguen abiertos, y ahora en silencio.

---

## Invariantes del código y quién las impone

| Invariante | La asume el código en | ¿La impone la base? | Dónde |
|---|---|---|---|
| Un teléfono → un operador activo | `conv.ts:63-73` (`.in(variantes)` + `.limit(2)` + `OperadorAmbiguo`) | **Sí** (con una fuga: ver M2) | `uq_operador_telefono_activo` (0024:120), funcional sobre `telefono_normalizado()` |
| Un operador → a lo más un viaje abierto | `conv.ts:128-131` (`.limit(1)`) | **Sí** | `uq_viaje_abierto_por_operador` (0029:71), índice parcial |
| Una liquidación por viaje | `repo.ts:397` (upsert vía RPC) | **Sí** | `liquidacion_viaje_uidx` (0005:9) |
| Un CFDI → un gasto por flota | `processor.ts:469` (`violaIndice(e,'uq_gasto_cfdi_uuid')`) | **Sí** | `uq_gasto_cfdi_uuid` (0019:20), parcial |
| Una foto (SHA-256) → un gasto por flota | `processor.ts:461` | **Sí en el esquema, NO en la práctica** | `uq_gasto_img_hash` (0027:132); `img_hash` solo se escribe si `CUADRA_DEDUP_FOTOS==='1'` (`processor.ts:361`) → hoy siempre NULL → el índice nunca choca. **Ver A2** |
| `gasto.concepto` ∈ los 9 de `ConceptoGasto` | `types/cuadra.ts:20-25` | **Sí** | `gasto_concepto_dominio` (0025:87) |
| `gasto.estado_sat`, `viaje.estatus`, `liquidacion.estatus`, `app_user.rol`, `llm_costo.fase` ∈ dominio | `types/cuadra.ts:27,104`, `conv.ts:129` (`.in('estatus', …)`), `costos.ts` | **Sí** | 0025:93,111,126,138,146 |
| `gasto.forma_pago` con forma de 2 dígitos | `ocr.ts` (mapeo) | **Sí** | `gasto_forma_pago_formato` (0025:97) |
| `gasto.tenant_id` = `viaje.tenant_id` | implícito en todo `repo.ts` | **Sí** | FK compuestas (0028:107-112) |
| `tenant.config` con la forma de `CuadraConfig` | `config.ts` (cast ciego) | **Sí** | `tenant_config_valida` (0026:337) |
| `viaje.intake_pendientes ≥ 0` | `intake_delta` `greatest(0,…)` | **Sí** | `viaje_intake_pendientes_no_negativo` (0025:120) |
| El contador de la barrera olvida un `-1` que nunca llegó | `processor.ts:523` (`finally`) | **Sí** | `intake_delta` con TTL de 10 min (0031:49-72) |
| La constancia del art. 16 sobrevive a un envío fallido | `repo.ts:537` (`liberarEnvioAviso`) | **Parcial** | `liberar_aviso_privacidad` (0033:118) solo toca la reserva. Pero **nada en la base** impide que otra función o la consola pongan `aviso_privacidad_en = NULL`. **Ver M3** |
| **Nada entra a `gasto` tras emitirse la liquidación** | `processor.ts:484` (`llegoTarde(e)`), `pg_errores.ts:29` | **NO — solo `INSERT`, y solo después de que la fila de `liquidacion` existe** | `trg_gasto_no_tras_liquidar` (0036:76-78). **Ver C1 y A1** |
| Los gastos de un viaje liquidado suman `liquidacion.total_comprobado` | `0027:53-55` lo escribe como razón para NO borrar filas; `analytics.ts:41` lo asume al pintar KPIs | **NO** | ninguna. Un `UPDATE`/`DELETE` sobre `gasto` de un viaje liquidado pasa |
| `viaje.anticipo` es un monto no negativo | `engine.ts:425` (`input.anticipo - totalComprobado`) | **NO** | 0025:114 solo prohíbe `NaN`. **Ver M1** |
| `gasto.fecha` presente cuando se filtra por ejercicio | `repo.ts:619-620` (`.gte/.lte`) | **NO** | ninguna (`0001:62`, `date` nullable). **REINCIDENTE ronda 6** |
| Una conversación por (tenant, teléfono normalizado) | `conv.ts:171-175` | **NO** | `wa_conversacion_tenant_tel_uidx` (0005:13) es sobre texto crudo, y `tenant_id` es nullable (`0001:80`). **REINCIDENTE ronda 6** |
| El esquema del repo = el esquema de producción | implícito en `supabase db push` | **NO se verifica desde el repo** | `migraciones_verificadas.test.ts` vigila **cobertura por bloque**, no estado aplicado. **Ver M6** |

---

## Hallazgos

### [CRÍTICO] C1 — La 0036 protege desde la fila de `liquidacion`, pero las cifras se congelan segundos antes: en esa ventana el gasto entra sin `CU001` y sin que nadie lo vea

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:64-68` ·
`src/lib/cuadra/tools.ts:152` (`computeCuadre`) ·
`src/lib/cuadra/tools.ts:176-177` (los dos PDF + dos subidas a Storage) ·
`src/lib/cuadra/tools.ts:181` (`saveLiquidacion` → la fila de `liquidacion`)

El trigger pregunta `select exists (select 1 from liquidacion where viaje_id = …)`.
Esa fila la escribe `guardar_liquidacion_tx`, llamada en `tools.ts:181`. Pero el
número que se imprime en el PDF y que se persiste como `total_comprobado` se
calcula en `tools.ts:152`, y entre las dos líneas ocurren, en orden:
`generarLiquidacionPDF` del ejemplar del contralor, su `upload` a Storage,
`generarLiquidacionPDF` del ejemplar del operador y su `upload`. Son dos
renderizados de PDF y dos viajes de red — segundos, no microsegundos.

**Escenario, con valores.** Anticipo $5,000. El operador manda cinco tickets
($4,850) y una sexta foto (un diésel de $800). Escribe *listo*. La barrera
(`processor.ts:603`) espera a los OCR en vuelo y devuelve; el agente corre; el
sexto OCR de una ráfaga que entró justo antes termina mientras el agente
redacta. La llamada que se ejecuta es:

```
insert into gasto (tenant_id, viaje_id, concepto, monto)
values ('1111…', '4444…-0001', 'diesel', 800);
```

Llega **después** de `tools.ts:152` (el cuadre ya dijo $4,850) y **antes** de
`tools.ts:181` (la fila de `liquidacion` todavía no existe). El trigger toma el
candado de `viaje`, consulta `liquidacion`, no encuentra nada, y **deja pasar el
INSERT**. No hay `CU001`, así que `processor.ts:484` no dispara y el operador no
recibe el mensaje de «llegó tarde». Después `saveLiquidacion` escribe
`total_comprobado = 4850` sobre un viaje que tiene $5,650 en gastos.

Antes de esta ronda ese desajuste al menos se veía: `guardiaCifras` recalculaba
(T2) y el texto de WhatsApp decía otra cifra que el PDF. El arreglo de AG-3
(`guardia.ts:69-72`, `tools.ts:189-201`: el cierre reúsa el snapshot y ya no toca la
base) eliminó esa segunda lectura. Hoy el PDF, el texto y `liquidacion` dicen los
tres $4,850, coherentes entre sí y **falsos** respecto de la tabla `gasto`.

*(Nota de la misma línea: el `for update` de `0036:62` tampoco cierra del todo el
caso concurrente. Si el `INSERT` toma el candado de `viaje` mientras
`guardar_liquidacion_tx` está entre su `insert into liquidacion` y su `update
viaje`, en READ COMMITTED el trigger no ve la fila aún sin confirmar y deja pasar
el gasto. Esa ventana sí es de microsegundos; la de arriba es de segundos.)*

**Consecuencia.** El operador puso $800 de su bolsa por un comprobante que la
base **sí** guardó y que ningún papel reconoce. No recibe aviso —el insert tuvo
éxito—, el PDF que archiva el contralor dice «sobró $150 a favor de la empresa» y
el panel, que lee `liquidacion.total_comprobado` (`analytics.ts:41`), lo
confirma. El gasto queda huérfano exactamente como describe el encabezado de la
propia 0036, con la diferencia de que ahora no hay ninguna cifra contradictoria
que lo delate.

**Causa raíz probable.** La regla se ancló al instante en que la liquidación se
*persiste*, no al instante en que sus cifras se *congelan*, que es el `computeCuadre`
de `tools.ts:152`; entre los dos hay dos PDF y dos subidas.

---

### [ALTO] A1 — «Nada entra» significa solo `INSERT`: la base acepta mover el monto de un gasto de un viaje ya liquidado

`supabase/migrations/0036_no_gastos_tras_liquidar.sql:77` (`before insert on gasto`) ·
`src/lib/cuadra/repo.ts:211` (`if (x.total != null && x.total > 0) extra.monto = x.total;`) ·
`src/lib/cuadra/repo.ts:213` (`.from('gasto').update(...)`) ·
`src/lib/cuadra/processor.ts:556` ·
`supabase/migrations/0017_enriquecer_gasto_atomico.sql:37-49` (`update gasto … set cfdi_uuid`)

El trigger es `for each row` **`before insert`**. No hay trigger de `UPDATE` ni de
`DELETE`. Y sí existen dos escritores por `UPDATE` en el camino del dinero:
`updateGastoCfdiXml` —que **cambia `monto`** (`repo.ts:211`)— y la RPC
`enriquecer_gasto_codigo` de la 0017, que escribe `cfdi_uuid` (de él depende la
deducibilidad ante el SAT). Ninguno de los dos pasa por el trigger.

**Escenario, con valores.** El viaje `4444…-0001` cerró con cinco gastos,
`liquidacion.total_comprobado = 4850`, PDF emitido y archivado. Uno de esos
gastos es un ticket de gasolinera sin timbrar, `monto = 200`, `cfdi_uuid = NULL`.
Llega el XML de ese mismo consumo, con `Total="1800"` (el ticket era un parcial):

```
update gasto
   set monto = 1800, cfdi_uuid = 'b7e3f1a2-…', xml_verificado = true
 where id = '5555…-0007' and tenant_id = '1111…';
```

La base lo acepta sin una palabra. Hay dos entradas: por la aplicación, el
mensaje del XML pasó por `getOpenViaje` (`processor.ts:253`) cuando el viaje
seguía abierto y llega a `updateGastoCfdiXml` (`processor.ts:556`) segundos
después, con el cierre ya hecho; y por la consola de Supabase o un script, sin
ninguna condición. El mismo hueco vale para `delete from gasto where viaje_id =
'<liquidado>'` — que es literalmente el comando que la 0027 le pide correr a
quien ensaya el demo (`0027:69`), en un archivo cuyo encabezado (`0027:53-55`)
declara que borrar un gasto de un viaje liquidado «dejaría
`liquidacion.total_comprobado` sin cuadrar contra la suma de sus gastos». El
esquema documenta el invariante y no lo impone.

**Consecuencia.** El PDF archivado y las filas dejan de coincidir sin que nada
falle. El contralor que abra el panel ve un total; el que abra el PDF ve otro;
el `export` a ERP sale de una tercera. Y el IVA/IEPS del XML se suma a un gasto
que la liquidación emitida ya no incluye con ese monto.

**Causa raíz probable.** La migración se escribió contra el escenario que la
motivó —una foto nueva— y no contra la tabla: `gasto` tiene tres verbos y solo
uno quedó cubierto.

---

### [ALTO] A2 — `uq_gasto_img_hash` no puede dispararse: la 0027 tocó datos vivos para imponer una restricción que hoy nunca ve un valor

`supabase/migrations/0027_gasto_img_hash_por_tenant.sql:132-134`
(`create unique index … on gasto (tenant_id, img_hash) where img_hash is not null`) ·
`src/lib/cuadra/processor.ts:360-367` (`let imgHash: string | undefined;` … `if (process.env.CUADRA_DEDUP_FOTOS === '1')`) ·
`src/lib/cuadra/repo.ts:171` (`img_hash: g.imgHash ?? null`)

`img_hash` **solo** se calcula dentro del `if` de `processor.ts:361`. Sin la
variable puesta, `imgHash` queda `undefined`, `processor.ts:456` inserta el gasto
sin él y `repo.ts:171` escribe `null`. En un índice único de Postgres los NULL no
colisionan entre sí, y el índice de la 0027 es además **parcial** (`where img_hash
is not null`): las filas ni siquiera se indexan.

**Escenario, con valores.** El operador manda la misma foto de un ticket de fonda
de $199 (papel térmico: `folio` que el OCR no leyó, `cfdi_uuid` NULL) dos veces
en el mismo viaje, con dos `waMessageId` distintos:

```
insert into gasto (tenant_id, viaje_id, concepto, monto, img_hash)
values ('1111…','4444…-0001','alimentacion',199, null);   -- pasa
insert into gasto (tenant_id, viaje_id, concepto, monto, img_hash)
values ('1111…','4444…-0001','alimentacion',199, null);   -- TAMBIÉN pasa
```

Los dos entran. El motor deduplica intra-viaje por `concepto|folio|monto` y sin
folio no hay llave; `detectarDuplicadosEntreViajes` empata por UUID o
`folio+monto`, nunca por hash. $398 comprobados sobre $199 gastados.

Lo verifiqué con dos búsquedas: `CUADRA_DEDUP_FOTOS` aparece en `src/` una sola
vez (`processor.ts:361`) y no está puesta en ningún archivo de configuración del
repo salvo `.env.example:76`.

**Consecuencia.** La protección que la 0027 describe como «el fraude número uno
del sector» está inerte. Y la 0027 no es inocua: para instalarla se degradaron
hashes de filas vivas (`0027:91-99`), o sea que se pagó el costo de una migración
de datos por una garantía que hoy no puede activarse. La 0015 quedó igual desde
julio; lo nuevo es que ahora *parece* cerrado en el esquema.

**Causa raíz probable.** La restricción vive en la base pero su **entrada**
depende de una bandera de la aplicación apagada por defecto; el esquema no puede
exigir que la columna se llene. (Documentado desde antes como `M0.1` en
`docs/conocimiento/00-MEJORAS.md:24`; lo traigo porque esta ronda aplicó la 0027
sobre datos vivos sin resolverlo.)

---

### [MEDIO] M1 — `viaje.anticipo` acepta un número negativo, y es la única cifra de dinero que se captura a mano

`supabase/migrations/0001_init.sql:52` (`anticipo numeric(12,2) not null default 0`) ·
`supabase/migrations/0025_dominios_check.sql:114-115` (solo `anticipo <> 'NaN'`) ·
`src/lib/cuadra/cuadre/engine.ts:425` (`const diferencia = round2(input.anticipo - totalComprobado)`)

La 0025 argumenta con cuidado por qué **no** pone `CHECK (monto > 0)` en `gasto`:
un comprobante ilegible visible vale más que uno ausente, y el motor lo marca
`monto_invalido`. Ese argumento **no aplica a `anticipo`**: no viene de un OCR,
viene de una persona tecleando en la consola de Supabase (la 0029:37-42 lo
documenta: «ninguna línea de `src/` inserta en `viaje`»), y no existe ningún
`TipoDiferencia` para un anticipo inválido (`types/cuadra.ts:62-91`).

**Escenario, con valores.** Quien captura el viaje del demo teclea el signo de
más de la fila anterior:

```
insert into viaje (tenant_id, operador_id, folio, anticipo, estatus)
values ('1111…','3333…-0001','VJ-2026-0847', -10600, 'abierto');
```

La base lo acepta. El operador comprueba $5,000 y `engine.ts:425` calcula
`-10600 - 5000 = -15600`.

**Consecuencia.** El PDF y el WhatsApp le dicen al chofer que puso **$15,600 de
su bolsa**, y el panel del contralor lo cuenta como dinero a favor del operador.
Nada en el sistema lo marca como sospechoso: es un número perfectamente válido
para el motor.

**Causa raíz probable.** La 0025 heredó el argumento de `gasto.monto` a toda la
familia de columnas de dinero sin separar las que sí tienen un origen humano.

---

### [MEDIO] M2 — La clave natural del canal está escrita en dos idiomas: la base indexa `telefono_normalizado()`, la app busca cuatro variantes de texto crudo

`supabase/migrations/0024_telefono_normalizado_unico.sql:63-72` (`telefono_normalizado` = quitar **todo** lo que no sea dígito) ·
`supabase/migrations/0024_telefono_normalizado_unico.sql:120-122` (el índice único) ·
`src/lib/cuadra/conv.ts:43-56` (`variantesTelefono`, líneas 43-56) · `src/lib/cuadra/conv.ts:63`
(`.in('telefono', variantesTelefono(telefono))`)

`telefono_normalizado` colapsa cualquier separador. `variantesTelefono` genera un
conjunto cerrado: la cadena tal cual, sus dígitos, con y sin el `1` mexicano,
cada una con y sin `+`. Son cuatro o cinco cadenas exactas, y `resolveOperador`
compara por igualdad contra la columna cruda.

**Escenario, con valores.** El contralor da de alta a su operador tal como lo
tiene en su nómina:

```
insert into operador (tenant_id, nombre, telefono, activo)
values ('1111…','Juan Pérez Ramírez','+52 999 370 0779', true);
```

La base lo acepta: `telefono_normalizado` da `529993700779`, que no choca con
nada. Llega el mensaje de Meta con `wa_id = '5219993700779'`;
`variantesTelefono` produce `{'5219993700779','529993700779','+5219993700779',
'+529993700779'}` y **ninguna** iguala `'+52 999 370 0779'`. `resolveOperador`
devuelve `null` — no lanza, no es un error — y el operador recibe *«No tienes un
viaje abierto…»* o el equivalente de «no te tengo registrado».

**Consecuencia.** Un operador dado de alta correctamente queda mudo, y el
síntoma («no te tengo registrado») apunta al dato, no al formato. En una sala de
demo es el primer minuto del guion. El mismo desfase vale al revés:
`'9993700779'` (10 dígitos, sin lada de país) es un operador distinto para el
índice y por tanto convive activo con `'529993700779'`, aunque sea la misma
persona.

**Causa raíz probable.** La 0024 eligió a propósito un índice funcional para no
tocar `src/`, pero eso dejó dos definiciones de «el mismo número»: la de la base
y la del `.in()`.

---

### [MEDIO] M3 — La constancia del art. 16 es una celda mutable; que «nadie la borre» lo garantiza la aplicación, no la base

`supabase/migrations/0033_aviso_reserva_aparte.sql:40-41` («La CONSTANCIA … Nadie la borra») ·
`supabase/migrations/0033_aviso_reserva_aparte.sql:104-108` (`confirmar_aviso_privacidad`, `update … set aviso_privacidad_en = now()` **sin condición**) ·
`supabase/migrations/0018_aviso_privacidad.sql:28-29` (las dos columnas, nullable, sin CHECK ni trigger)

La 0033 resuelve bien lo que se propuso: separó la reserva del hecho, y el bloque
17 de `verificaciones.sql:657-698` lo demuestra contra Postgres. Lo que **no**
hizo es proteger la columna. `aviso_privacidad_en` sigue siendo un `timestamptz`
nullable sin restricción, y `confirmar_aviso_privacidad` la sobrescribe con
`now()` sin comprobar que quien llama tuviera la reserva ni que no haya ya una
constancia previa. No existe tabla de constancias: hay una celda por operador.

**Escenario, con valores.** El operador `3333…-0001` recibió el aviso v1 el
15-may-2026 y consta. Cualquiera de estas dos entradas la destruye y la base no
dice nada:

```
-- (a) desde la consola, corrigiendo "un dato viejo":
update operador set aviso_privacidad_en = null, aviso_privacidad_version = null
 where id = '3333…-0001';

-- (b) desde la app, al confirmar la v2 tres meses después:
select confirmar_aviso_privacidad('3333…-0001','1111…','v2');
--     → aviso_privacidad_en = now(); la fecha del 15-may deja de existir
```

**Consecuencia.** Ante el INAI la carga de probar el art. 16 es del responsable
(la flota). Con (a) la base afirma que nunca se le puso el aviso a disposición —
el estado que la propia 0033 llama «el peor posible». Con (b) no se puede
acreditar qué versión vio el titular ni cuándo, que es exactamente lo que exige
el art. 15 fr. VI cuando el aviso cambia.

**Causa raíz probable.** Un hecho histórico (una entrega, con fecha y versión)
está modelado como dos columnas de la tabla del sujeto, no como filas de un
registro append-only.

---

### [MEDIO] M4, REINCIDENTE (ronda 6) — `wa_conversacion` sigue sobre teléfono crudo, con `tenant_id` nullable y `operador_id` que nunca se escribe

`supabase/migrations/0001_init.sql:78-84` · `supabase/migrations/0005_concurrencia.sql:13-14`
(`wa_conversacion_tenant_tel_uidx on (tenant_id, telefono)`) ·
`src/lib/cuadra/conv.ts:171-175` (lectura) · `src/lib/cuadra/conv.ts:187-190` (inserción)

Sin cambios respecto de la ronda 6: ni la 0024 ni ninguna de las seis nuevas la
tocaron. Tres huecos en la misma tabla:

1. El índice único es sobre el texto crudo, no sobre `telefono_normalizado()`, así
   que `'5219993700779'` y `'529993700779'` son dos conversaciones.
2. `tenant_id` es **nullable** (0001:80) y en un índice único los NULL no
   colisionan: `insert into wa_conversacion (telefono, estado) values
   ('5219993700779','{}')` se puede repetir sin límite. La 0028:57-59 lo dejó
   explícitamente fuera de las FK compuestas por esa misma nulabilidad.
3. `operador_id` existe con FK desde 0001:81 y `conv.ts:188` no lo escribe nunca
   (`insert({ tenant_id, telefono, viaje_id, estado })`). Ninguna línea de `src/`
   escribe esa columna — la única aparición de `operador_id` en `conv.ts` es la
   línea 128, sobre `viaje`.

**Consecuencia.** El contexto de hasta 12 turnos se parte en dos si el número
entra por las dos formas, y sin `operador_id` no hay forma de reconciliar las
filas. En la sala del demo se ve como un agente que perdió el hilo. Además
`conv.ts:191` devuelve `id: ''` en silencio si el insert choca.

---

### [MEDIO] M5, REINCIDENTE (ronda 6) — `gasto.fecha` sigue nullable sin CHECK, y es el filtro del contador del 15%

`supabase/migrations/0001_init.sql:62` (`fecha date`) ·
`src/lib/cuadra/repo.ts:619-620` (`.gte('fecha', …)` / `.lte('fecha', …)`)

La 0025 puso CHECK a siete columnas y ninguna es `fecha`. Ninguna de las seis
migraciones nuevas la toca.

**Escenario, con valores.**
`insert into gasto (tenant_id, viaje_id, concepto, monto, forma_pago, fecha)
values ('1111…','4444…-0001','diesel', 9000, '01', null);` — aceptado. En SQL
`NULL >= '2026-01-01'` es `NULL`, no `TRUE`, así que esa carga queda fuera de las
dos ramas de `getAcumuladoCombustible` pero **sí** suma a `totalComprobado`.

**Consecuencia.** $9,000 de diésel pagados en efectivo que no entran ni al
numerador ni al denominador del 15% de la RFA 2026 regla 2.9: la flota parece
holgada cuando ya se pasó, y el contralor recibe una cifra de cumplimiento
calculada sobre menos cargas de las que hubo.

---

### [MEDIO] M6 — Ninguna sonda de arranque cubre la 0036, y `migraciones_verificadas.test.ts` vigila la cobertura, no el estado aplicado

`src/lib/cuadra/startup.ts:142-159` (`const INDICES = { uq_gasto_cfdi_uuid, uq_operador_telefono_activo }`) ·
`supabase/migrations/0030_indices_faltantes.sql:26-43` (`indices_faltantes` consulta `pg_indexes`) ·
`src/lib/cuadra/migraciones_verificadas.test.ts:87-99`

El arranque sondea 0016, 0017, 0022, 0031, 0033 y **dos** índices. Un trigger no
es un índice, así que `indices_faltantes` no lo puede ver aunque quisiera, y
nadie llama a nada que pruebe `trg_gasto_no_tras_liquidar`. Tampoco están en
`INDICES` los otros cuatro índices únicos del camino del dinero
(`uq_gasto_img_hash`, `uq_viaje_abierto_por_operador`, `liquidacion_viaje_uidx`,
`wa_conversacion_tenant_tel_uidx`).

**Escenario.** Se levanta un proyecto nuevo de Supabase para el ensayo del demo y
`supabase db push` corre hasta la 0035 y falla en la 0036 (o alguien restaura un
respaldo previo). El arranque escribe `startup.migraciones { ok: true }` — porque
las dos sondas que mira pasan — y `processor.ts:484` (`llegoTarde(e)`) se vuelve
código muerto sin que nada lo diga.

Sobre el conteo que pidió el encargo: `f6a193f` («34 de 34») es del 31-jul
16:44, y `3e9eb82` (0035) y `45a0e08` (0036) son **posteriores, del mismo día**.
Con 36 archivos hoy, quien lea ese mensaje de commit sacará una cuenta vieja. La
afirmación vigente es un comentario a mano en `supabase/verificaciones.sql:86-90`
(«0031 … 0036 → APLICADAS el 31-jul»). `migraciones_verificadas.test.ts` **no lo
vigila**: sus cuatro pruebas comprueban que cada `.sql` tenga un bloque en
`verificaciones.sql` o una razón en `EXENTAS` (y eso lo hace bien: verifiqué que
las 18 cubiertas por bloque más las 18 exentas dan 36). No compara contra
`supabase_migrations.schema_migrations` ni puede hacerlo desde el test.

**Consecuencia.** El único invariante nuevo del camino del dinero de esta ronda
es el que no tiene sonda, y el conteo de migraciones aplicadas descansa en un
comentario que hay que actualizar a mano.

---

### [BAJO] B1 — La función nueva de la 0036 nace sin `search_path` fijo, un día después de que la 0035 se lo pusiera a las otras diez

`supabase/migrations/0035_search_path_fijo.sql:27-36` (las diez `alter function … set search_path`) ·
`supabase/migrations/0036_no_gastos_tras_liquidar.sql:55-70` (`create or replace function gasto_no_tras_liquidar()` — sin `set search_path`)

`gasto_no_tras_liquidar()` resuelve `viaje` y `liquidacion` sin calificar el
esquema, y es la undécima función de `public` sin `search_path` fijo — la misma
condición (`function_search_path_mutable`) que la 0035 acaba de cerrar por las
dos razones que ella misma escribe: el día que `authenticated` pueda ejecutar
algo, un rol con esquema propio antes que `public` resuelve a otra tabla.

**Escenario.** Es una regresión de regla, no un agujero abierto hoy: la función
es SECURITY INVOKER y solo `service_role` inserta en `gasto`. Lo reportable es que
nada lo caza: el bloque 18 de `verificaciones.sql:739-745` mira ejecutabilidad
por `anon`, no `proconfig`, y la exención `'0035'` de
`migraciones_verificadas.test.ts:69` da el asunto por cerrado. La siguiente
migración con una función volverá a olvidarlo.

**Causa raíz probable.** La 0035 arregló las diez instancias existentes y no dejó
un chequeo que impida la número once.

---

### [BAJO] B2 — `permisos_cre.json` en `src/`: defendible como archivo, no como tabla

`src/lib/cuadra/facturacion/permisos_cre.json` (436 KB, 12,625 pares
permiso→marca) · `src/lib/cuadra/facturacion/permiso_cre.ts:70` (`import PERMISOS
from './permisos_cre.json'`)

Veredicto: **no debe vivir en la base.** Es un catálogo de referencia inmutable,
idéntico para todas las flotas, de solo lectura, sin `tenant_id`, sin
transacción, sin RLS que aplicar y sin nada que la base pueda imponer sobre él.
Ponerlo en Postgres añadiría un viaje de red en el camino del intake a cambio de
cero garantías; el mismo criterio que ya rige a `comercios.ts` y a los YAML de
`normas/`, y que el MAPA fija como convención («el catálogo de comercios y el de
normas son datos, no código»).

Lo que sí es deuda: no tiene validación de forma. El propio encabezado de
`permiso_cre.ts:47-49` documenta que la cosecha ya produjo una marca corrida
(`Ciudad/Municipio Tixkokob` en vez de una compañía) y otra sencillamente
equivocada. Un `permisos_cre.json` regenerado con la columna desplazada entra sin
que nada lo note, porque un `import` de JSON no tiene esquema. Es una validación
de datos, no de esquema, y por eso es BAJO en este rubro.

---

## Lo que revisé y está bien

- **La 0031 hace exactamente lo que dice, y de la única forma que funciona.** El
  olvido ocurre también en el sondeo (`0031:66-68`: el `case` se evalúa antes de
  sumar `p_delta`, así que `p_delta = 0` limpia igual), que es como lo llama
  `esperarIntake`. El `create or replace` con `int` —alias de `integer`— reemplaza
  la de la 0011 en vez de dejar dos firmas vivas (`0031:77-84`), y el bloque 14 lo
  confirmó contra Postgres (`verificaciones.sql:20-21`, `sondeo-lo-olvida=0`).
- **La 0033 es la mejor migración de la ronda.** Separa reserva de constancia,
  el TTL de 5 min impide dejar a un operador sin aviso para siempre
  (`0033:84`), `liberar_aviso_privacidad` exige `aviso_privacidad_claim_en is not
  null` para que el booleano signifique algo (`0033:134`), y el paso de datos
  decide **no tocar nada** (`0033:148-155`) en vez de adivinar cuáles reservas
  viejas eran constancias. El bloque 17 lo prueba contra Postgres, no contra un
  mock, y la salida está copiada (`verificaciones.sql:24-25`).
- **No hay unicidad vieja bloqueando lo nuevo en la 0033.** Verifiqué con dos
  búsquedas: la 0018 no crea un solo índice ni constraint, solo tres columnas y
  una función. `aviso_privacidad_claim_en` es una columna nueva sin restricción, y
  ninguna unicidad previa la alcanza. Tampoco **falta** una: la reserva es un
  claim por fila, no por pareja de filas, y el `where` del UPDATE ya es el candado.
- **Las FK compuestas de la 0028 y su razonamiento sobre qué queda fuera.** Las
  tres exclusiones (`cfdi_xml.gasto_id`, `llm_costo.viaje_id/liquidacion_id`,
  `wa_conversacion`) están argumentadas por la incompatibilidad real entre
  `on delete set null` y un `tenant_id not null` (`0028:52-59`), no por descuido.
- **La 0025 sigue siendo la referencia de cómo se pone un CHECK:** cuenta las
  filas que lo violarían y dice cuántas antes de intentarlo (`0025:165-173`), es
  idempotente (`0025:158-163`), y documenta las tres cosas que decidió **no**
  restringir con su razón.
- **La 0032 es correcta y es el sitio correcto.** `comment on table` es lo único
  que se ve desde el explorador de Supabase, que es donde está parado el contralor
  que iba a caer en la trampa de `politica_gasto`; el `getPolitica` muerto ya se
  borró (`repo.ts:82-94`) y `politica_un_origen.test.ts` lo fija.
- **La 0034 está bien acotada:** columna nullable, comentario que explica que
  NULL significa «la flota no lo ha designado», y `getDatosResponsable`
  (`repo.ts:435`) la trae en el mismo `select` en vez de abrir una segunda
  consulta.
- **La 0035 no reintroduce el bug de la 0022:** `alter function … set` no toca el
  cuerpo, así que no puede dejar dos firmas vivas; verifiqué que la firma de
  `guardar_liquidacion_tx` de `0035:30` coincide tipo por tipo con la de
  `0021:22-26`.
- **El barrido de RLS del bloque 18 mira las tres formas de perder aislamiento
  sin que nada falle** (tabla sin RLS, política que dice `true`, RPC ejecutable
  por `anon`), y deja escrito qué **no** es un hallazgo (`verificaciones.sql:716-722`):
  `codigo_pendiente`, `viaje_lock` y `wa_mensaje_procesado` con RLS y cero
  políticas son denegación total, correcta.
- **`updateGastoCfdiXml` ya preserva `error.code`** (`repo.ts:233-234`), que era
  el ALTO de la ronda 6: el camino del XML ya puede distinguir un 23514 de un
  fallo cualquiera. El hueco de traducción del CHECK de `forma_pago` sigue sin
  manejo específico, pero eso es `pg_errores.ts`, no esquema.
- **`migraciones_verificadas.test.ts` cumple lo que promete.** Lee los TÍTULOS de
  los bloques y no el archivo entero (`:39-42`), lo que evita el falso verde de un
  bloque que solo cita una migración en su prosa; exige razón de ≥20 caracteres
  por exención y detecta exenciones fantasma. Corrí las tres pruebas relevantes:
  18/18 en verde.

## Lo que NO alcancé a revisar

- **Que `CU001` llegue a `error.code` de supabase-js.** Toda la respuesta al
  operador del camino de la 0036 cuelga de `llegoTarde(e)`
  (`pg_errores.ts:29`), que compara `e.code === 'CU001'`. La única prueba en el
  repo es el bloque 19, que lee `SQLSTATE` **dentro de plpgsql**
  (`verificaciones.sql:792`) — no a través de PostgREST. PostgREST mapea las
  clases de SQLSTATE que no conoce a HTTP 500; si además normaliza el `code` del
  cuerpo, la rama de `processor.ts:484` nunca corre y el operador recibe el
  mensaje genérico. No lo pude comprobar: no hay base aquí.
- **El bucket `liquidaciones` de Storage.** Tercer round consecutivo sin revisar
  `storage.objects` ni sus políticas. `tools.ts:169` sube con `upsert: true` a una
  ruta `${tenantId}/${viajeId}.pdf`, y quién puede leer esa ruta no lo verifiqué.
- **Si `wa_mensaje_procesado` se purga.** Sin cambios: la tabla crece sin job de
  limpieza visible y su PK es el `wa_message_id` de Meta.
- **`llm_costo.liquidacion_id`.** Existe `vincularCostosALiquidacion`
  (`processor.ts:707`) pero no verifiqué contra el esquema si la columna se llena
  siempre ni qué pasa con las filas de un cierre que falló.
- **El estado real de las 36 migraciones en producción.** No hay base en este
  entorno; la afirmación «todas aplicadas» sale de leer
  `supabase/verificaciones.sql:55-90`, que es prosa escrita a mano el 31-jul.
- **El panel del contralor contra el esquema** (`analytics.ts:41`, `:132`, `:178`
  leen `liquidacion` sin `.limit()`/`.range()`, expuestas al recorte silencioso de
  `max_rows` que `repo.ts:571-593` documenta para otra consulta). Lo dejo anotado
  porque es esquema-adyacente, pero el dueño es rendimiento/backend.
