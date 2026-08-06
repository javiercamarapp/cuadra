# Backend y API — auditoría 14

**Nota: 5.5/10** (antes 7). Razón del movimiento: **deuda que cobró factura** —
el deber ser de la RFA 2.9 (los commits `0d23f73` + `0fa305e`, el foco de esta
ronda) se implementó con un defecto de estatus que contradice su propia
clasificación, y dejó el panel del contador afirmando el IVA del combustible en
efectivo que el propio motor del deber ser niega — la misma familia del ALTO
que la ronda 13 cerró, por la otra puerta. A eso se suman los SIETE hallazgos
de backend de la ronda 13 (3 MEDIO + 4 BAJO) que siguen abiertos porque ningún
commit los atacó, y el contador del 15% que usa el año del reloj del servidor
—una liquidación de diciembre cerrada en enero declara todo el diésel en
efectivo NO deducible contra un tope de $0—. Lo sólido de fondo (traerTodo,
claims atómicos, RLS, HMACs, fail-loud de pg.ts) se sostiene; lo que falló es
todo nuevo, de esta misma sesión.

**Método:** código actual en HEAD (`0fa305e`), línea por línea; verifiqué los
cierres de la ronda 13 abriendo el código, no por el título del commit; corrí
las suites del rubro (cuadre 382, facturación+saas+auth 553, export/operacion/
analytics 81, normas/cierre/escalar/al_vuelo 181 — todo verde). **No hice git
commit, no toqué la base, no desplegué.** Nota: `docs/auditoria-14/00-SINTESIS.md`
todavía no existe (solo `PROMPT-BASE.md`), así que verifiqué los cierres contra
`docs/auditoria-13/`.

---

## CRÍTICO

No encontré un CRÍTICO demostrable. El camino de dinero (cierre atómico
`saveLiquidacion` → `guardar_liquidacion_tx`, claims de `al_vuelo.ts`/
`escalar_viaje.ts`, idempotencia de Stripe, mutex de `reabrirViaje`) sigue
razonado y probado; los dos ALTOS de abajo son contradicciones de
clasificación y de estándar, no fugas de datos ni de dinero entre tenants.

## ALTO

### 1. La RFA 2.9 introduce un estatus que contradice su propia clasificación: una liquidación con $X NO deducibles sale "Cuadrada" en verde

`src/lib/cuadra/cuadre/engine.ts:1126-1129`:

```ts
const REVISAR: TipoDiferencia[] = ['ocr_baja_confianza', …, 'combustible_efectivo', 'efectivo_sobre_tope', …]; // SIN los tipos nuevos
const hayRevisar = diferencias.some((d) => REVISAR.includes(d.tipo));
const hayDif = diferencias.some((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado' || d.tipo === 'diesel_desviacion') || Math.abs(diferencia) >= 0.5;
const estatus: EstatusLiquidacion = hayRevisar ? 'revisar' : hayDif ? 'con_diferencias' : 'cuadrada';
```

Los tres tipos nuevos de la matriz 2.9 (`combustible_efectivo_dentro15`,
`efectivo_sobre_15`, `efectivo_no_elegible`, `engine.ts:311,324,331`) NO están
en `REVISAR` ni en las condiciones de `hayDif`. `combustible_efectivo_dentro15`
es informativo y no debe manchar — correcto dejarlo fuera — pero
`efectivo_sobre_15` y `efectivo_no_elegible` son exactamente los veredictos
"no deducible" que el propio `NO_DEDUCIBLE_ISR` (`engine.ts:97`) clasifica como
pérdida, y el patrón de los demás no-deducibles (`rfc_receptor`, `cfdi_cancelado`,
`efectivo_sobre_tope`…) es forzar `revisar`. Los nuevos no fuerzan nada.

**Confirmado empíricamente** (prueba temporal, borrada al terminar):
`cuadrarViaje({ anticipo: 1000, facilidad15: false, gastos: [diésel $1,000 con CFDI] })`
→ `estatus: 'cuadrada'`, `totalNoDeducible: 1000`, `totalDeducible: 0`. El mismo
resultado con `facilidad15: true, totalCombustibleEjercicio: 10000,
efectivoPrevEjercicio: 900` (excede el 15%) → `'cuadrada'` con `totalNoDeducible: 400`.

**Escenario con valores:** flota que declaró NO calificar (o que excede el 15%
del ejercicio). Viaje con anticipo $5,300, un solo gasto: diésel en efectivo
$5,300 con CFDI. `diferencia = 0` → `hayRevisar = false`, `hayDif = false` →
**`estatus = 'cuadrada'`**. La liquidación se persiste con ese estatus
(`saveLiquidacion`), el panel la pinta **verde "Cuadrada"**
(`src/app/dashboard/estatus.ts:23`: `cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' }`),
el aviso de cierre al jefe la trata como cuadrada, y en la misma hoja el
renglón de deducibilidad dice "No deducible $5,300.00". Es la regla del repo
("un rótulo tiene que ser verdad") rota por el estatus más visible del
producto, y la familia "una página corta se lee como ya terminamos" — aquí
"una clasificación que no baja el estatus se lee como todo en orden". Las 5
pruebas de la matriz (`engine.test.ts:1417-1486`) verifican las cubetas pero
ninguna asserta `estatus`, por eso la suite está verde.

**Estado: abierto** (nuevo, introducido por el propio cierre `0d23f73`).

### 2. El panel del contador sigue acreditando el IVA del combustible en efectivo que el deber ser de la RFA 2.9 prohíbe — reincidencia del ALTO de la ronda 13 por la otra puerta

`src/lib/cuadra/fiscal.ts:493`:

```ts
function ivaSostenible(g: GastoFiscal, o: OpcionesFiscales): boolean {
  …
  if (g.formaPago === '01' && !esCombustible(g, o) && g.monto > o.efectivoTopeMxn) return false;
  return true;
}
```

El `!esCombustible` excluye al combustible de la única puerta que le negaba el
IVA al efectivo: para un gasto de diésel pagado en efectivo, `ivaSostenible`
devuelve `true` y `resumirFiscal` (`fiscal.ts:513`) suma `g.ivaTraslado` al
"IVA acreditable documentado" del dashboard del contador
(`app/dashboard/contador/page.tsx:141`). El deber ser de la RFA 2.9
(`docs/fiscal/rfa-2.9-deber-ser.md`, matriz) dice con todas las letras: IVA ❌
en TODAS las ramas del efectivo ("NO habilita el acreditamiento del IEPS (ni el
IVA, por ser pago en efectivo)"), y el motor lo cumple — los cuatro tipos del
efectivo están en `SIN_ACREDITAMIENTO` (`engine.ts:956`) y la liquidación sale
con `ivaAcreditable = 0`. El fix de la ronda 13 (`37d75ee`) cerró la puerta de
`pendiente`/`no_encontrado`; la puerta del efectivo quedó abierta y el
documento recién publicado la convierte en contradicción documentada.

**Escenario con valores:** flota elegible, dentro del 15%. Ticket de diésel en
efectivo $5,300 con CFDI vigente, IVA traslado $731.03. La liquidación imprime
"Deducible para ISR" con `ivaAcreditable $0.00` (el motor lo niega); el
dashboard del contador, sobre el MISMO gasto, muestra "IVA acreditable
documentado $731.03". El contralor cruza el PDF contra su panel y lee dos
cálculos para el mismo hecho — la frase exacta que este rubro lleva cuatro
rondas persiguiendo, recién sembrada por el deber ser de esta sesión.

**Estado: abierto** (nuevo; contradice el documento del propio commit `0d23f73`).

## MEDIO

### 3. El contador del 15% usa el año del reloj del servidor — una liquidación de diciembre cerrada en enero declara todo el diésel en efectivo NO deducible contra un tope de $0

`src/lib/cuadra/cuadre/desde_db.ts:59-70`:

```ts
const anioEjercicio = String(new Date().getFullYear());
…
.gte('fecha', `${anioEjercicio}-01-01`)
.lte('fecha', `${anioEjercicio}-12-31`)
```

El ejercicio se deriva del reloj del servidor en el momento del cuadre, no de
la fecha del viaje ni de los gastos. En la frontera de año —cuando MÁS se
liquidan los viajes de diciembre— los gastos del viaje quedan FUERA de la
ventana del contador: `totalesEjercicio` devuelve `total = 0` y el motor cae
en la rama `else` de `engine.ts:321-329`:

```ts
const excedente = Math.max(0, acumulado - tope);   // tope = 0.15 × 0 = 0
const dentro = Math.max(0, g.monto - excedente);   // 0
```

**Escenario con valores (confirmado empíricamente):** viaje del 28-dic-2026,
liquidado el 3-ene-2027. Diésel en efectivo $5,300 con CFDI, anticipo $5,300.
`totalCombustibleEjercicio = 0` → `tope = 0` → `proporcionDeducible = 0` →
`totalNoDeducible = 5,300`, `totalDeducible = 0`, estatus **`cuadrada`** (verde),
con la nota: *"el ejercicio ya excede el tope del 15% ($5,300.00 vs $0.00), así
que el excedente de $5,300.00 NO se deduce"*. La nota AFIRMA un exceso contra
un tope de $0 que es un hueco de consulta, no una medición — la regla "nunca
inventar una cifra" en la rama recién estrenada. El caso `total <= 0` debería
caer en la rama `undefined` (por confirmar, "no se afirma nada"), que es
exactamente lo que hace el OTRO contador del mismo repo
(`lib/cuadra/periodo/combustible.ts:88-92`: `total <= 0 → sin_criterio`). El
mismo reloj en `tools.ts:98` (`new Date().getUTCFullYear()`) alimenta el
porcentaje del ejercicio que el tool le reporta al agente.

**Estado: abierto** (nuevo).

### 4. "Sin declarar" es inalcanzable desde el alta: dejar los checkboxes vacíos guarda `{false, false}` y la flota cae en NO deducible, no en "por confirmar"

`src/app/admin/flotas/page.tsx:37-38` + `src/lib/cuadra/administracion.ts:110-115`:

```ts
dedicacionExclusivaCarga: fd.get('dedicacionExclusivaCarga') === 'on',   // false si no se marcó
regimenElegible: fd.get('regimenElegible') === 'on',
…
const facilidad15 = (f.dedicacionExclusivaCarga !== undefined || f.regimenElegible !== undefined)
  ? { facilidadCombustibleEfectivo: { dedicacionExclusivaCarga: f.dedicacionExclusivaCarga ?? null, regimenElegible: f.regimenElegible ?? null } }
  : undefined;
```

El checkbox binario sin marcar produce `false` (no `undefined`), y el `||`
con `!== undefined` sobre un booleano es siempre `true`, así que **todo alta
por la UI guarda una declaración**. Quien deja los checkboxes vacíos —o no
entiende la pregunta— no produce "sin declarar" (por confirmar, nada se
afirma) sino `{false, false}` → `desde_db.ts:56-58` → `facilidad15 = false` →
**`efectivo_no_elegible` (no deducible)**, con la nota del motor diciendo *"la
flota declaró que NO califica a la facilidad del 15%"* sobre una declaración
que nunca ocurrió. La matriz del propio deber ser
(`docs/fiscal/rfa-2.9-deber-ser.md` §2) define `undefined` = sin declarar →
por confirmar; la UI no puede producir `undefined`, y el estado intermedio
`{true, null}` (una sola casilla) también cae en `false` porque `null !==
undefined` pasa el chequeo (`desde_db.ts:56`). Una ausencia de datos se lee
como la negación más cara de la matriz.

**Escenario con valores:** en la sala del demo se registra una flota nueva
contra el reloj y no se marcan los checkboxes. Primer viaje con diésel en
efectivo $4,000: el motor lo declara NO deducible (27-III sin excepción) y el
aviso al jefe dice "la flota declaró que NO califica" — cuando la flota no
declaró nada. El estado "por confirmar" de la matriz es inalcanzable por la
interfaz que la implementa.

**Estado: abierto** (nuevo). Agravante: no existe camino de EDICIÓN — la
declaración solo se escribe en el alta (`administracion.ts:88-127` es el único
writer), así que una flota creada antes de `0d23f73` no puede declarar jamás
por el panel; solo por SQL.

### 5. El `monto` y la nota de `efectivo_sobre_15` son el excedente ACUMULADO, no el del comprobante: dos gastos que cruzan la frontera suman $2,000 de "excedente" cuando el real son $1,500

`src/lib/cuadra/cuadre/engine.ts:318-329`:

```ts
const excedente = Math.max(0, acumulado - tope);   // acumulado crece con CADA gasto del viaje
…
diferencias.push({
  tipo: 'efectivo_sobre_15', concepto: g.concepto, monto: excedente,
  nota: `… el ejercicio ya excede el tope del 15% (${mxn(acumulado)} vs ${mxn(tope)}), así que el excedente de ${mxn(excedente)} NO se deduce …`,
  gastoId: g.id,
});
```

`excedente` es el exceso acumulado del ejercicio en ese punto del bucle, no el
exceso atribuible al comprobante. Con más de un gasto después de la frontera,
cada diferencia repite el acumulado completo: el `monto` de la columna y la
frase "el excedente de $X NO se deduce" se duplican entre comprobantes (lo
midió en paralelo otro auditor de esta ronda: suma de montos reportados $2,000
contra excedente real $1,500). Las CUBETAS salen bien (la proporción se reparte
correctamente); lo que miente es la presentación por diferencia, que es lo que
lee el aviso de cierre (`cierre_aviso.ts` ordena por `|monto|`) y el PDF.

**Escenario con valores:** previo $0, total del ejercicio $10,000 (tope
$1,500). Dos gastos de diésel en efectivo: g2 = $500, g3 = $1,000. g2 reporta
"excedente de $500"; g3 reporta "excedente de $1,500" (el acumulado, ya
incluido en g2). Un contralor que suma la columna de excedentes lee $2,000;
el excedente real del ejercicio es $1,500.

**Estado: abierto** (nuevo).

### 6. Tres contadores del 15% con dos denominadores distintos: el tool puede decirle al operador un porcentaje que la liquidación no usa

- `desde_db.ts:70` (el contador que decide dinero): `or(concepto.eq.diesel, clave_prod_serv.in.(…))` — concepto O clave.
- `repo.ts:802-816` (`getAcumuladoCombustible`, el que usa el tool `cuadrar_viaje`): `.eq('concepto', 'diesel')` — SOLO concepto. Un gasto de combustible con concepto `otro` y clave `15101505` cuenta en el contador de la liquidación y NO en el del tool.
- `fiscal.ts:589-597` (`tope15DeGastos`, el panel del contador): concepto O clave, pero sobre la ventana del periodo (`resolverPeriodo`), no el ejercicio.

**Escenario con valores:** flota con 3 gastos de diésel por clave pero
clasificados `otro` por OCR (p. ej. el ticket de una franquicia que el prompt
no etiquetó). Al cerrar el viaje, la liquidación calcula 40% de efectivo
(dentro de su denominador); el agente, en el mismo turno, consulta el tool y le
dice al operador "el ejercicio lleva 55%" (fuera de su denominador, más chico).
Dos cifras para el mismo hecho en la misma conversación, y ninguna marcada
como distinta. El panel usa una tercera. La doctrina de este repo —"una cifra
fiscal que se lee distinto en dos pantallas se lee como dos cálculos"— aplica
tal cual.

**Estado: abierto** (nuevo; `getAcumuladoCombustible` es anterior, pero la RFA
2.9 convierte la divergencia en un hecho que se enseña).

## BAJO

### 7. La 0082 valida la llave pero no su contenido: `facilidadCombustibleEfectivo: "hola"` pasa el CHECK

`supabase/migrations/0082_config_facilidad15.sql`: `llaves_ok` gana la décima
llave pero el cuerpo de `config_tenant_valida` no tiene ningún bloque para
ella (a diferencia de `empresa`, `estimulos`, `tabulador`…). Un `"true"` de
texto o un `42` en el jsonb pasan la validación y clasifican como `false`
(fail-closed, por la razón equivocada). Además el comentario de la 0082 dice
"Las 9 llaves de CuadraConfig" cuando ya lista 10 — cosmético, pero es la
misma clase de rastro que la ronda 13 marcó.

**Estado: abierto** (nuevo).

### 8. La declaración no tiene edición: las flotas creadas antes de la RFA 2.9 no pueden declarar por el panel

Solo `crearFlota` escribe `facilidadCombustibleEfectivo`; no existe
`actualizarDeclaracion15` ni casilla en la edición de flota (el único editor de
config es `guardarPolitica`, `administracion.ts:251-274`). Una flota alta antes
del 5-ago-2026 queda en `por_confirmar` para siempre salvo SQL. Es una
decisión de producto — el doc solo promete el alta — pero operativamente es el
estado de TODO cliente existente el día que la facilidad importe.

**Estado: abierto** (nuevo; decisión, no bug de código).

### 9. Los veredictos nuevos del 15% no entran en `SOLO_CONTRALOR`: el operador recibe "el excedente NO se deduce" de una decisión de la flota

`src/lib/cuadra/cuadre/resumen.ts:30-42`: `SOLO_CONTRALOR` no incluye
`efectivo_sobre_15` ni `efectivo_no_elegible`, así que el resumen determinístico
que el cierre le manda al CHOFER (`processor.ts:1939`, `resumenCuadre(…,
'operador')`) le enseña "la flota declaró que NO califica… no deducible" —
un veredicto que el operador no puede arreglar ni le compete, justo lo que la
doctrina del propio archivo manda filtrar ("Veredictos que el OPERADOR no puede
arreglar y que además lo señalan"). El aviso al jefe sí los clasifica
(`cierre_aviso.ts:143-144` → `decision`); el resumen del chofer no.

**Estado: abierto** (nuevo).

### 10. `efectivoDeEsteViaje` descuenta duplicados y montos negativos que el motor no cuenta

`desde_db.ts:86-89`: la resta del contador previo suma TODOS los gastos del
viaje en efectivo (duplicados incluidos, montos ≤ 0 incluidos), mientras el
motor excluye ambos (`engine.ts:273` y `engine.ts:279-282`). Se autocorrige en
la siguiente liquidación (el numerador vuelve a cuadrar), pero en el cuadre de
hoy un ticket duplicado de diésel en efectivo reduce el numerador efectivo y
agranda el denominador: un poquito más de "espacio" del que la regla concede.

**Estado: abierto** (nuevo).

## Ronda 13, verificada en el código actual: los cierres siguen cerrados, los abiertos siguen abiertos

Los abrí uno por uno contra HEAD.

- **`37d75ee` (ALTO fiscal): el panel ya no acredita IVA de CFDIs sin confirmar** — `fiscal.ts:491`: `if (g.estadoSat === 'pendiente' || g.estadoSat === 'no_encontrado') return false;` en `ivaSostenible`. Cerrado de verdad. (Ver ALTO #2 de esta ronda: la puerta del efectivo quedó fuera.)
- **`4da0198` (POD del chofer amarrado al tenant)** — `migrations/0081_pod_tenant_amarrado.sql`: la política `operador_sube_su_pod` ahora exige `tenant_id = (select tenant_id from public.viaje where id = viaje_id)`. Cerrado.
- **`94a3521` (vence_en 20 días)** — `privacidad.ts:615`: `DIAS_HABILES_ARCO = 20`. Cerrado.
- **`5ef6993` (operador.rfc con productor)** — `app/dashboard/operadores/page.tsx:156-171` + `actualizarRfcOperador`; `desde_db.ts:48-52` lo lee. Cerrado.
- **`c563a0a` (seed.sh contra base migrada + passcode fuera)** — `scripts/seed.sh:20-31` detecta el esquema y solo siembra datos; `.env.local` sin passcode. Cerrado.
- **`de6416f` (chat como 'dinero')** — `app/dashboard/chat/page.tsx:47-52` gatea `puedeVerArea(rol, 'dinero')`. Cerrado.

**Los siete hallazgos abiertos de la ronda 13 siguen abiertos** (ningún commit
los atacó después de `dd64068`):

- **MEDIO #1 — `resolverTenantApi` sin revisar `error`** — `src/lib/auth/tenant-api.ts:56-64`: `const { data } = await … .maybeSingle(); if (data) tenantId = data.id;` — el `error` se sigue descartando en el sitio exacto que la ronda 12 citó, y de ahí cuelgan las DOS rutas de export. `resolverTenantPedido` (fail-loud) existe y NO lo usa esta función. Siguen igual `asistente/route.ts:56-58` y `tenant-efectivo.ts:121-126`.
- **MEDIO #2 — export paginado sin desempate único** — `app/api/export/liquidaciones/route.ts:65-72`: `.order('created_at', { ascending: false })` sin `.order('id')`, violando el contrato de `traerTodo` (`pg.ts:197-199`). El `count` da por completa una lectura que puede duplicar/saltar filas en la frontera de página.
- **MEDIO #3 — `getPorFacturar` con `.limit(500)` silencioso** — `lib/cuadra/facturacion/pendientes.ts:119-125`, y el aviso de WhatsApp al encargado nace del arreglo recortado (`avisar.ts:110`).
- **BAJO #4 — el rechazo de Meta al PDF del operador deja rastro pero no le habla** — `processor.ts:2131-2140`: `logger.error('pdf.no_entregado')` y el mensaje solo existe en el `catch` de excepción, no en la rama de rechazo (`{ok:false}`).
- **BAJO #5 — `provisionarUsuario` sin validar el rol contra la UI** — `app/admin/usuarios/nuevo/page.tsx:29-34`.
- **BAJO #6 — comentario muerto en `meta/client.ts:318-330`** — sigue apuntando a `processor.ts:1840` y `avisar_cierre.ts:117`, líneas que ya no existen, y dice "queda pendiente que esos dos la usen" cuando ya la usan.
- **BAJO #7 — el webhook de Stripe sin route-test** — solo `lib/saas/stripe.test.ts` (funciones), ninguna prueba de la ruta pública.

## Lo que revisé y está bien

- **RFA 2.9 — el motor en su núcleo**: la matriz (dentro15 deducible / excedente
  proporcional / no elegible no deducible / sin declarar por confirmar) está
  bien implementada en `engine.ts:296-341` y las cubetas suman el comprobado; el
  excedente en la frontera se reparte por proporción (nunca negativo, no
  depende del orden — lo verifiqué a mano con gastos de montos distintos);
  `SIN_ACREDITAMIENTO` (`engine.ts:956`) incluye los cuatro tipos del efectivo
  (no acredita IVA ni IEPS, como manda el doc); `NO_DEDUCIBLE_ISR` y
  `POR_CONFIRMAR` clasifican bien los tipos nuevos. Las 5 pruebas de la matriz
  pasan y los arneses de processor (`0fa305e`) soportan la consulta nueva
  (36/36 verdes).
- **`desde_db` fail-closed**: la consulta del ejercicio usa `traerTodo` con
  `conteo(desde)` y `.order('id')` (desempate único — el mismo contrato que el
  export de la ronda 13 sigue violando), y `cuadrarDesdeDB` está blindada por
  los catch de la guardia y del processor (un fallo del contador degrada el
  mensaje, no rompe el cierre).
- **Round 13 backend intacto en lo sustantivo**: puertas de las ~30 server
  actions y de las rutas de API, `resolverTenantPedido` fail-loud en las 10
  páginas, `exigir`/`traerTodo`/`LecturaIncompleta`, `session.ts` con reintento,
  claims atómicos (`al_vuelo.ts:627-668`, `escalar_viaje.ts:302`,
  `administracion.ts:381`), RLS de la 0078/0079/0081.
- **Corridas**: cuadre+periodo 382/382, facturación+saas+auth 553/553,
  export/operacion/analytics 81/81, normas+cierre+al_vuelo+escalar+conv+
  administracion 181/181 — 1,197 pruebas del rubro, verdes en primera pasada
  (corridas desde la raíz del repo; las 2 fallas de `copias_un_origen.test.ts`
  al correr desde `src/` eran un artefacto de CWD, no del código).

## Lo que no alcancé a revisar

- `docs/auditoria-14/00-SINTESIS.md` no existe aún; verifiqué los cierres de la
  ronda 13 contra `docs/auditoria-13/` y contra el árbol.
- `adaptadores/capufe.ts` y `pagina_playwright.ts` (~2,700 líneas) — rubro
  fiscal/rendimiento; aquí solo confirmé que las 294 pruebas de facturación
  pasan (incluidas las de CAPUFE con navegador real).
- El motor agéntico (guardiaCifras, memoria multi-oración) — rubro agentico; la
  guardia la toqué solo en su borde con `cuadrarDesdeDB`.
- Confirmación empírica contra Postgres real de la 0082 aplicada y de la
  semántica de PostgREST para `or(…in.(…))` con lista vacía (defensivo: la 0082
  impide `claves` vacías, pero no lo probé contra un PostgREST vivo).
- El render del panel con los tipos nuevos — rubro frontend; el ALTO #1 es
  verificable en el código y en el dato persistido, no necesitó screenshot.

## Veredicto

**NO es green light para backend.** El deber ser de la RFA 2.9 —el entregable
de esta sesión— llegó con un defecto que contradice su propia matriz: una
liquidación con $5,300 NO deducibles por la regla 2.9 se persiste y se pinta
**verde "Cuadrada"** (`engine.ts:1126-1129`), y el panel del contador sigue
acreditando el IVA del combustible en efectivo que el documento recién
publicado prohíbe (`fiscal.ts:493`). Ninguno de los dos rompe el guion del
demo de mañana tal como está sembrado (la flota demo declaró true y el diésel
precargado es transferencia `'03'`), pero ambos son verificables hoy, uno de
ellos con una prueba temporal que borré al confirmarla. A eso se suman el
contador con año del reloj (una liquidación de diciembre en enero declara todo
no deducible contra $0), el "sin declarar" inalcanzable desde el alta, el
excedente acumulado que se duplica en la presentación, y los siete hallazgos de
la ronda 13 sin tocar. Los arreglos son de una línea o de una consulta
(agregar los dos tipos a `REVISAR`; quitar el `!esCombustible` de la puerta de
efectivo o alinear la ficha; derivar `anioEjercicio` de `viaje.fechaInicio`;
hacer el contador único), pero mientras no se hagan, la regla del producto —un
rótulo tiene que ser verdad— se sostiene con una excepción nueva, grande y en
verde.
