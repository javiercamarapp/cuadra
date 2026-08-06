# Modelo de datos y esquema — auditoría 14

**Nota: 7/10** (se mantiene en el 7 de la ronda 13, con movimiento en ambos
sentidos: sube porque el único MEDIO que tenía —`operador_sube_su_pod`— quedó
cerrado y verificado en código; no sube más porque la RFA 2026 regla 2.9, que
es lo que esta ronda implementó, metió al camino de datos dos MEDIOs que la 13
no veía: el validador de `tenant.config` admite la llave nueva SIN validar su
forma, y el contador del 15% del ejercicio es una suma en cliente de páginas
secuenciales que corre dentro de `cuadrarDesdeDB`, el paso que
`presupuesto.ts` tasa en 300 ms). La vara del rubro, heredada de la ronda 10:
¿el esquema puede sostener, sin que nadie lo esté mirando, las tres garantías
que este producto vende —el PDF archivado y lo que hay en `gasto` dicen lo
mismo para siempre, ningún tenant ve/escribe en otro, y toda migración nueva se
comprueba contra Postgres real antes de darla por buena—?

Anclado a `0fa305e8c4f0e740b7f22c6d0ba4840ae9904a05` (`git rev-parse HEAD` al
empezar). Sin acceso a Postgres en esta sesión: toda la verificación es lectura
línea por línea de `supabase/migrations/` (0001–0082), `seed.sql`,
`verificaciones.sql`, `src/lib/cuadra/{config,repo,pg,desde_db,cuadre/engine}.ts`
y el resto de los consumidores. Lo que necesitaría base real para confirmar
está dicho como tal.

**Verificación del cierre de la ronda 13 (el encargo explícito).** El único
cierre del rubro —`4da0198`, el MEDIO de `operador_sube_su_pod`— está y hace lo
que dice:

- **0081** (`supabase/migrations/0081_pod_tenant_amarrado.sql:14-17`): el
  `with check` ahora exige las DOS cosas — `viaje_id in (select id from
  public.viaje where operador_id = get_user_operador_id())` **and**
  `tenant_id = (select tenant_id from public.viaje where id = viaje_id)`. Un
  POD con el tenant de OTRA flota ya no entra: la segunda cláusula compara el
  tenant del POD contra el del viaje. El bloque 56 (`verificaciones.sql:3108-3146`)
  ejercita exactamente eso (siembra dos tenants, impersona al chofer del A,
  POD con tenant A debe entrar, POD con tenant B debe rebotar con
  `insufficient_privilege`). El `raise` final espera `pod-en-su-flota=t
  pod-en-flota-ajena=f`. El subquery `select tenant_id from viaje where id =
  viaje_id` corre con RLS del chofer (ve su propio viaje), así que devuelve el
  tenant correcto. Cierre verificado en el código, no por el título del commit.

## Hallazgos

### [MEDIO, abierto] La 0082 admite la llave `facilidadCombustibleEfectivo` sin validar su forma — un valor basura pasa el CHECK y el motor calla, o cierra la válvula en silencio

`supabase/migrations/0082_config_facilidad15.sql:19-21`:

```sql
llaves_ok text[] := array['empresa','politica','tabulador','unidades',
                         'catalogoCuentas','salida','hidrocarburos',
                         'estimulos','validacion','facilidadCombustibleEfectivo'];
```

La 0082 agrega la llave a la lista cerrada —y eso es todo. Recorrí la función
entera línea por línea: hay bloque de validación para `politica` (conceptos,
topeMonto numérico > 0, requiereCfdi booleano), `estimulos` (rangos numéricos
por llave), `tabulador`, `empresa`, `salida`, `hidrocarburos`, `validacion`,
`unidades`, `catalogoCuentas` — y NO hay un solo `if jsonb_exists(p_config,
'facilidadCombustibleEfectivo')` en todo el archivo. Es la ÚNICA llave de las
diez sin validación de valor. El estándar que la propia 0026 fijó —"una llave
mal escrita no da error: se guarda, no la lee nadie" — queda reintroducido para
el valor de esta llave, que es una declaración FISCAL (dedicación + régimen) de
la que depende si el combustible en efectivo se deduce.

**Escenario con valores.** Un `update tenant set config = config || '{
"facilidadCombustibleEfectivo": {"dedicacionExclusivaCarga": "true",
"regimenElegible": true}}'` (un "true" como TEXTO — el error que el validador
atrapa en TODAS las demás llaves) pasa el CHECK sin chistar. Después, en
`desde_db.ts:56-58`:

```ts
const facilidad15 = (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
  ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
  : undefined;
```

`"true" !== undefined` → verdadero, pero `"true" === true` → falso →
`facilidad15 = false` → el motor marca cada diésel en efectivo como
`efectivo_no_elegible` → **no deducible**, con la nota "la flota declaró que NO
califica". La flota sí califica; un typo de escritura la dejó sin deducción
con el validador diciendo que todo está bien. El lado inverso (un objeto sin
las dos llaves, o un string) cae a `undefined` → "sin declarar" → por
confirmar, que es el modo conservador; el daño es el primero.

**Estado: abierto.** (El camino de escritura de hoy —`administracion.ts:108-115`
desde `flotas/page.tsx`— escribe booleanos limpios; el hueco es para todo lo
demás: edición manual, futuros callers, migraciones de datos. Es exactamente
el trabajo que la función dice hacer.)

### [MEDIO, abierto] El contador del 15% del ejercicio es una suma en CLIENTE de páginas secuenciales dentro del paso que `presupuesto.ts` tasa en 300 ms — y muere por `LecturaIncompleta` pasadas 100,000 filas

`src/lib/cuadra/cuadre/desde_db.ts:61-83`:

```ts
const [totalesEjercicio] = await Promise.all([
  (async () => {
    const filas = await traerTodo<{ monto: unknown; forma_pago: unknown }>(
      (desde, hasta) => supabaseAdmin()
        .from('gasto')
        .select('monto, forma_pago', conteo(desde))
        .eq('tenant_id', tenantId)
        .gte('fecha', `${anioEjercicio}-01-01`)
        .lte('fecha', `${anioEjercicio}-12-31`)
        .or(`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})`)
        .order('id')
        .range(desde, hasta),
      'desde_db.totalCombustibleEjercicio',
    );
    let total = 0, efectivo = 0;
    for (const f of filas) { ... }
```

`cuadrarDesdeDB` corre en CADA cuadre: la tool `cuadrar_viaje` (`tools.ts:79`),
la guardia determinística en cada turno con cifras (`guardia.ts:20-21` →
`processor.ts:1957`, presupuestado en `presupuesto.ts:40` como
`guardiaCifras → cuadrarDesdeDB, ms: 300`), el cierre (`processor.ts:1838,
1939`) y la reconstrucción del panel (`analytics.ts:800`). El contador convierte
ese paso de "una consulta" a "N páginas secuenciales de 1,000 filas", sin tope
de tiempo medido: `presupuesto.ts` sigue diciendo 300 ms porque es un supuesto
estático, no una medición — la prueba del presupuesto compara SUMAS de supuestos
contra el margen, no el costo real del paso.

**Escenario con valores.** Una flota con 5,000 gastos de combustible en el
año → 5 viajes de red secuenciales (cada uno ~60-150 ms en us-east-2) → 0.3-0.8
s añadidos a CADA cuadre, sobre un paso presupuestado en 0.3 s. Una flota con
120,000 gastos de combustible al año (la 0063 cita 660 comprobantes/día como
volumen de plataforma; una flota grande llega) → `traerTodo` lanza
`LecturaIncompleta` (`pg.ts:104-107`, el tope de 100 páginas) → **el cuadre
falla entero**, fail-closed, pero el panel ve un error en vez de una
liquidación. La cifra que se necesita es un `sum()`, y PostgREST lo ofrece; la
lectura completa en cliente es la decisión de diseño que convierte un agregado
de una vuelta en un bucle de red. Para el demo no duele (2 filas, 1 página);
para el segundo cliente, sí. **Estado: abierto.**

### [BAJO, abierto] La frontera del 15% atribuye el excedente según el orden de `getGastos`, que NO tiene ORDER BY — el mismo cuadre puede marcar a un gasto distinto en cada corrida

`src/lib/cuadra/cuadre/engine.ts:304-326`: el acumulado del ejercicio se suma
gasto por gasto en el orden de `input.gastos`:

```ts
efectivoAcumuladoEjercicio += g.monto;
const acumulado = (input.efectivoPrevEjercicio ?? 0) + efectivoAcumuladoEjercicio;
const tope = 0.15 * total;
...
const excedente = Math.max(0, acumulado - tope);
const dentro = Math.max(0, g.monto - excedente);
if (g.monto > 0) proporcionDeducible.set(g.id, dentro / g.monto);
```

Y `getGastos` (`repo.ts:555-561`) hace `.eq('tenant_id', ...).eq('viaje_id',
...)` SIN `.order()`: PostgREST/Postgres devuelve las filas en el orden que le
dé la gana (hoy, casi siempre orden de inserción; sin ninguna garantía). El
módulo se llama a sí mismo "Cuadre determinístico" (`desde_db.ts:1-2`).

**Escenario con valores.** Viaje con dos diésel en efectivo: A=$60 y B=$80;
efectivo previo del ejercicio $0; total del ejercicio $1,000 → tope $150.
- Orden A,B: A cabe (60 ≤ 150) deducible al 100%; B cruza (140 > 150) →
  excedente $30, B queda deducible al 62.5% (50/80).
- Orden B,A: B cabe (80 ≤ 150) deducible al 100%; A cruza → excedente $30, A
  queda deducible al 50% (30/60).

El total de excedente ($30) es invariante —por eso BAJO y no MEDIO: el dinero
total no cambia— pero el PDF marca un renglón distinto como "parcialmente no
deducible" según el orden de las filas que devolvió la base, y el
acreditamiento de IVA (que salta el gasto entero por SIN_ACREDITAMIENTO,
`engine.ts:974`) cae sobre comprobantes distintos. Un comprobante fiscal que
se lee distinto en dos corridas del mismo hecho es exactamente la familia que
este rubro persigue. El tope de alimentación (LISR 28-V) ya reparte por día y
comentó explícitamente "no depende del ORDEN del arreglo" (`engine.ts:1100`);
la frontera del 15% no tiene ese orden y tampoco un ORDER BY aguas arriba.
**Estado: abierto** — una línea (`repo.ts`, `.order('fecha, id')` o
`.order('id')`) y la atribución queda fijada.

### [BAJO, abierto] El contador del ejercicio resta de un total que no incluye: `efectivoDeEsteViaje` no filtra por año y puede contar dos veces un gasto del ejercicio anterior

`src/lib/cuadra/cuadre/desde_db.ts:86-89`:

```ts
const efectivoDeEsteViaje = gastos
  .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
  .reduce((s, g) => s + Number(g.monto ?? 0), 0);
const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
```

`totalesEjercicio.efectivo` sale de la consulta de las líneas 68-69, que filtra
`fecha` dentro del año en curso; `efectivoDeEsteViaje` NO filtra fecha. Un
gasto de combustible en efectivo del viaje fechado en el año ANTERIOR (legal:
la tolerancia de `ventanaDelViaje` es 30 días antes de `fecha_inicio`, y un
viaje que cruza año es normal en esta industria) se resta de un total que no lo
incluyó.

**Escenario con valores.** Viaje iniciado 28-dic-2025, cuadrado el 5-ene-2026,
con un diésel en efectivo de $5,000 fechado 29-dic-2025. El total del ejercicio
2026 es $0 (el gasto es de 2025). `efectivoDeEsteViaje` = 5,000 →
`efectivoPrevEjercicio = max(0, 0 − 5000) = 0`. El motor suma el gasto:
`acumulado = 5000`, `total = 0` → rama `else` (`engine.ts:316-326`) →
`excedente = 5000` → `efectivo_sobre_15` con la nota "el ejercicio ya excede el
tope del 15% ($5,000.00 vs $0.00)". Dos problemas: (1) el gasto de 2025 se
cuenta como efectivo de 2026 (infla el contador del año correcto en 5,000 —
el clamp del `max(0,·)` devoró la resta que debía sacarlo); (2) la nota
"vs $0.00" es un sin sentido que se imprime en un comprobante legítimo. El
gasto debería evaluarse contra el ejercicio 2025 (donde quizá cabe en el 15%),
no contra un 2026 vacío. **Estado: abierto** — BAJO por la estrechez de la
ventana (solo muerde cerca del cambio de año), MEDIO si la flota cuadra viajes
de diciembre en enero.

### [BAJO, abierto] El alta de flota no puede expresar "sin declarar": checkbox desmarcado = declaración explícita de NO, y la rama `undefined` del motor es inalcanzable desde la UI

`src/app/admin/flotas/page.tsx:37-38`:

```ts
dedicacionExclusivaCarga: fd.get('dedicacionExclusivaCarga') === 'on',
regimenElegible: fd.get('regimenElegible') === 'on',
```

`FormData.get` devuelve `null` para un checkbox no marcado, y `null === 'on'`
es `false`. El formulario SIEMPRE envía booleanos, así que
`administracion.ts:108-115` siempre escribe `facilidadCombustibleEfectivo:
{dedicacionExclusivaCarga: false|true, regimenElegible: false|true}`. Nunca
`undefined`. Consecuencia en el motor: la rama "sin declarar → por confirmar"
(`engine.ts:337-341`, `desde_db.ts:58`) —la única que no afirma nada y la que
el doc `docs/fiscal/rfa-2.9-deber-ser.md` describe como el default— es
**inalcanzable desde el alta de flota**. Un admin que no entiende el checkbox
(o cuya flota sí es elegible pero no lo marca) declara en silencio "NO
califica" y TODA la gasolina en efectivo de su flota sale no deducible, con la
nota "la flota declaró que NO califica", sin que nadie haya declarado nada. El
estado "sin declarar" solo existe si alguien escribe la config por otro camino.
Es una decisión de UX con efecto fiscal; del lado de datos, el modelo no
puede distinguir "contestó no" de "no contestó", y el formulario es el único
productor del dato. **Estado: abierto** (decisión de producto; el fix mínimo
es mandar `undefined`/`null` y que el motor distinga, o pedir contestación
obligatoria).

### [BAJO, abierto] El bloque 56 no lleva estampa de corrida real en `verificaciones.sql`, y la cabecera del archivo sigue diciendo 31-jul

`supabase/verificaciones.sql:15` — "Última corrida: **31-jul-2026**", cinco
días vencida; los únicos bloques con estampa "CORRIDO EL 5-AGO-2026 CONTRA EL
PROYECTO LIKIDA. SALIDA REAL:" son el 41 (`:1764`) y el 43 (`:2026`). El
bloque 56 (`:3108-3146`) —el que verifica el cierre de la ronda 13— dice
"Corrida real esperada" pero NO trae la salida pegada, igual que el 52, 53, 54
y 55. El commit `4da0198` afirma "bloque 56 corre y pasa (pod-en-su-flota=t,
pod-en-flota-ajena=f)" y el PROMPT-BASE lista 26/28/44/53/54/55 pasando — pero
el archivo que es la bitácora de corridas no registra ninguna de esas salidas.
La garantía 3 (cada migración se comprueba contra Postgres real) depende de que
esta bitácora sea creíble; hoy su primera afirmación está vencida y las
corridas recientes viven solo en mensajes de commit. **Estado: abierto** (una
línea por corrida; el 56 y la cabecera valen dos minutos).

### [BAJO, abierto] La 0082 hereda el drift de la 0026: dice "El trigger 0026" cuando es un CHECK, y "Las 9 llaves" cuando ya son 10

`supabase/migrations/0082_config_facilidad15.sql:8-10` — "El trigger 0026
validaba las llaves de la config contra una lista cerrada". Verificado: la
0026 (`0026_tenant_config_esquema.sql:325-336`) crea un **CHECK constraint**
(`alter table tenant add constraint tenant_config_valida check (config is null
or config_tenant_valida(config))`), no un trigger — grep de `create trigger` en
las migraciones: 0 resultados. Y el comentario de la línea 17-18 dice "Las 9
llaves de `CuadraConfig`" cuando `llaves_ok` ya tiene 10 entradas (la lista
sí está completa — solo el número del comentario quedó atrás). Documentación
de una migración fiscal: el tipo de error que hace dudar de la pieza cuando
algo falla en producción. **Estado: abierto** (dos palabras).

### [BAJO, abierto] `tenant_self` sigue dejando que el chofer lea `tenant.config` — los topes que deciden su liquidación — (heredado de la 13, re-verificado)

`supabase/migrations/0078_rls_chofer_sin_escritura.sql:56-58`:

```sql
create policy tenant_self on tenant for select
  using (id = any(get_user_tenant_ids()) or is_superadmin());
```

`get_user_tenant_ids()` (`0001_init.sql:95-100`) devuelve TODOS los tenants del
`app_user` sin filtrar por rol — incluye al `operador`. Con sesión web + anon
key, `GET /rest/v1/tenant?id=eq.<flota>&select=config,contacto_privacidad` le
devuelve la política completa (topes de diésel, caseta, etc.) — la regla
exacta contra la que el motor decide `sobre_politica` en su liquidación. La 0079
cerró esto para `app_user` ("datos personales de terceros"); para `tenant` no
se aplicó el mismo `not is_operador()`. No hay consumidor legítimo que se rompa
(verificado en la 13: la UI del chofer no lee `tenant` por RLS), así que el
arreglo es acotar el brazo, no rediseñar. Sin cambio desde la ronda 13.
**Estado: abierto** (BAJO — información que el producto no da en pantalla, no
fuga de terceros).

### [BAJO, abierto] `factura_viaje` sigue sin FK compuesta ni candado de viaje (heredado de la 13, re-verificado)

`supabase/migrations/0049_cobranza_factura_emitida_pago.sql:150-159`: la policy
`tenant_finanzas` de `factura_viaje` valida el lado `factura_id` (EXISTS contra
`factura_emitida` con tenant+`ve_finanzas`) pero no el lado `viaje_id`, y la
tabla no tiene `tenant_id` propio ni FK compuesta hacia `viaje`. Un
`ve_finanzas` del tenant A puede insertar `{factura_id: <factura de A>,
viaje_id: <viaje de B>}` — el `with check` pasa, las FKs sueltas pasan, y la
vista `factura_saldo` de A muestra una factura atada a un viaje ajeno. Sin
consumidor en la app (`fiscal.ts:942` declara que el código NO toca
`factura_viaje` todavía), así que es un hueco latente, misma familia que el
MEDIO que la 0081 cerró para pod. **Estado: abierto** (una línea cuando la
tabla tenga su primer INSERT).

### [BAJO, abierto] `desde_db.ts:44` — `.catch(() => null)` sigue enmascarando cualquier fallo de lectura del operador (heredado de la 13, re-verificado)

`src/lib/cuadra/cuadre/desde_db.ts:43-45`:

```ts
const operador = viaje.operadorId
  ? await getOperador(viaje.operadorId, tenantId).catch(() => null)
  : null;
```

El `catch` traga TODOS los errores de `getOperador` (base caída, timeout,
columna `rfc` inexistente en un entorno sin la 0080). El dinero falla cerrado
(viáticos al RFC del operador caen a `viatico_rfc_operador`, a revisión), pero
la exención de la 0080 en `migraciones_verificadas.test.ts:54` dice "si la
columna falta, `getOperador` falla ruidoso" — y este `catch` silencia
justamente ese ruido: un entorno sin la 0080 liquidaría todo el día con
viáticos "a revisión" y la única pista sería la nota "captura su RFC para
confirmarlo". La afirmación de la exención no se sostiene en este camino.
**Estado: abierto** (BAJO — el daño es de diagnóstico, no de dinero).

### [BAJO, abierto] El XML del diésel del demo sigue sin cuadrar internamente — y ahora hay que sumarle la fecha (heredado de la 13, re-verificado y ampliado)

`supabase/seed.sql:145` — el CFDI de respaldo del gasto estrella del demo:

- `Base="3210.00" Impuesto="003" TasaOCuota="6.1740" Importe="408.62"` —
  3210.00 × 0.06174 = **198.19**, no 408.62. (Y 408.62 no es 113 L × 6.1740 =
  697.66; sería ~$3.616/L.)
- `Base="3618.62" Impuesto="002" TasaOCuota="0.160000" Importe="581.38"` —
  3618.62 × 0.16 = **578.98**, no 581.38. El 581.38 se despejó del Total para
  que la suma diera (3210 + 408.62 + 581.38 = 4200), no del 16% declarado.
- `Cantidad="113.00" ValorUnitario="28.41" Importe="3210.00"` — 113 × 28.41 =
  **3210.33**, no 3210.00 (el décimo de centavo se perdió redondeando al
  importe).
- `Fecha="2026-05-15T09:14:00"` y `FechaTimbrado="2026-05-15T09:14:05"` — el
  CFDI está fechado el 15-MAY-2026, TRES MESES antes de la fecha del gasto
  (`current_date - 1`, el 4-ago) y del viaje (5-ago). Un contador que abra el
  XML —o que valide el UUID en el portal del SAT— vería un comprobante que
  predata el viaje por 3 meses y cuyos impuestos no salen de sus propias bases.

El parser de la app (`cfdi_xml.ts:271-277`) suma los `Importe` DECLARADOS sin
multiplicar base×tasa, así que la demo no lo ve y `iva_traslado` guardado
(581.38) es consistente con lo leído. El riesgo es el de la sala: es el CFDI de
respaldo del comprobante que el guion presenta como "deducible y ACREDITABLE".
**Estado: abierto** (BAJO, dato de demo — pero es el dato que mañana se
enseña).

### [BAJO, abierto] `getPorFacturar` sigue recortando la cola a 500 y el resumen cuenta sobre la lista recortada (heredado de la 13, re-verificado)

`src/lib/cuadra/facturacion/pendientes.ts:125` — `.limit(500)` sin aviso de
"hay más", y `resumen()` (`:181-189`) calcula `total`, `vencidos`, `urgentes`
y `montoTotal` sobre la lista ya recortada. Con más de 500 tickets por
facturar, el panel dice "total: 500" y el monto vencido sale subestimado — un
rótulo que no es verdad (la segunda regla de CLAUDE.md). La propia 0063 cita
660 comprobantes/día como volumen normal. **Estado: abierto** (BAJO,
pre-existente, frontera con el rubro backend — el export ya paginó; esta
consulta no).

## Lo que revisé y está bien

- **El cierre de la 0081, completo y coherente.** La política nueva convive
  con las otras dos de `pod` sin romperlas: `tenant_data` (oficina, `not
  is_operador()`, 0047:183-185) sigue cubriendo a la oficina; `operador_ve_su_pod`
  (solo lectura, 0047:187-188) no filtra tenant pero el `viaje_id` ya viene
  scoped por la policy del viaje; `operador_sube_su_pod` (0081) es el único
  INSERT del chofer y amarra tenant+viaje. El chofer no tiene UPDATE ni DELETE
  sobre pod (0 policies → deny). `pod_viaje_unico` sigue intacto
  (0047:151), así que un POD legítimo no puede pisar a otro.
- **La 0082 es una copia fiel de la 0026 más la décima llave.** Hice el diff
  de las dos funciones: los únicos cambios son `llaves_ok` (9→10) y el
  `comment on function`. Ninguna otra validación se alteró — lo que la 0026
  rechazaba sigue rechazándose, incluido el CHECK `tenant_config_valida` que la
  0026 creó y que la 0082 alimenta por `create or replace` (mismo OID, cuerpo
  nuevo; el constraint no necesita recrearse).
- **El seed del demo, línea por línea, con la facilidad nueva.** El
  `jsonb_set` anidado (`seed.sql:99-106`) preserva las llaves existentes de
  `tenant.config` y escribe `{politica: [...], facilidadCombustibleEfectivo:
  {dedicacionExclusivaCarga: true, regimenElegible: true}}` — que pasa el CHECK
  de la 0082 (booleano, llave conocida). Idempotente: re-correrlo reescribe los
  mismos valores. El diésel del viaje demo es `forma_pago '03'`
  (transferencia), así que la facilidad declarada NO dispara la rama del 15% en
  el demo — el guion no se ve afectado: sigue mostrando la ÚNICA diferencia de
  $200 sobre política. Los montos del viaje siguen cuadrando (3210 + 408.62 +
  581.38 = 4200; 1206.90 + 193.10 = 1400), los estatus cumplen los dominios, y
  el RFC `GMX0902279I1` pasa el dígito verificador (verificado en la 13).
- **La matriz del 15% en el motor, con sus 5 pruebas.** Las ramas
  `facilidad15 === true/false/undefined` de `engine.ts:301-341` hacen lo que la
  matriz de `docs/fiscal/rfa-2.9-deber-ser.md` declara: dentro → deducible con
  diferencia informativa (`combustible_efectivo_dentro15`, monto 0); excede →
  excedente no deducible por PROPORCIÓN (`proporcionDeducible`,
  `engine.ts:322`); no elegible → no deducible completo (en `NO_DEDUCIBLE_ISR`,
  `engine.ts:97`); sin declarar → por confirmar (`POR_CONFIRMAR`,
  `engine.ts:98`). El excedente total es invariante al orden (ver hallazgo
  BAJO de determinismo: la atribución por renglón no lo es). `efectivo_sobre_15`
  y `efectivo_no_elegible` están en `SIN_ACREDITAMIENTO` (`engine.ts:956`):
  nunca acreditan IVA/IEPS, consistente con la decisión declarada. La exención
  de la 0082 en `migraciones_verificadas.test.ts:54` tiene razón sólida: si la
  función vieja queda, el seed mismo revienta ruidoso al escribir la llave.
- **`fusionarConfig` maneja bien la llave nueva.** `facilidadCombustibleEfectivo`
  no existe en `DEMO_CONFIG`; la mezcla profunda (`config.ts:142-153`) la toma
  del override tal cual. Un tenant sin la llave → `undefined` → "sin declarar";
  con `{false,false}` → `false` → "declaró que no"; con `{true,true}` → `true`.
  Los tres estados del motor son alcanzables según lo que haya en la base.
- **El camino de escritura de la declaración está limpio.** `administracion.ts:108-115`
  escribe exactamente lo que el motor lee, `flotas/page.tsx` los captura como
  checkbox booleanos, y la validación del RFC de la flota sigue firme en el
  alta. No hay ninguna otra escritura de `tenant.config` en `src/` que pueda
  contaminar la llave.
- **Pruebas corridas en esta sesión (todas verdes):** `engine.test.ts` 112,
  `migraciones_verificadas` 4, `config`/`config_merge`/`config_tope`/
  `config_falla` 13, `por_diferencia` + `presupuesto` + `processor_cadena` +
  `processor_cierre` 60, `repo_escritura`/`repo_operadores`/`guardia` 36.
  No corrí la suite completa (instrucción: otro auditor la corre).
- **Inventario de escrituras RLS del chofer, re-verificado:** la 0081 dejó
  `operador_sube_su_pod` como la única INSERT; UPDATE/DELETE siguen en cero.
  `tenant_self` (0078) sigue siendo solo lectura para todos; `bitacora_auditoria`
  (0079) sigue con `not is_operador()` en INSERT y sin UPDATE/DELETE.

## Lo que no alcancé a revisar

- **La base real (us-east-2).** El PROMPT-BASE declara 0078/0079/0080 aplicadas,
  bloques 26/28/44/53/54/55 pasando y seed sembrado; los commits de esta ronda
  afirman la 0081 y la 0082 aplicadas y el bloque 56 pasando. No tengo
  credenciales en esta sesión: los bloques los leí y son coherentes con el
  esquema, pero su salida real no la re-corro yo. Y como nota del hallazgo de
  bitácora: las estampas de esas corridas no están en el archivo.
- **El costo real de la consulta del ejercicio** en la base de producción (¿qué
  tamaño de año tiene hoy el tenant del demo? casi seguro 2 filas; el hallazgo
  MEDIO es prospectivo, no medido).
- **El detalle de la matriz IVA/IEPS** (si "efectivo dentro del 15% no acredita
  IVA" es la lectura correcta de LIVA 5-I) — es del rubro fiscal; del lado de
  datos lo que verifiqué es que la regla se aplica de forma consistente en
  `SIN_ACREDITAMIENTO` y que la nota lo declara.
- **0056-0061 y los checks de la 0070/0075** — leídos en rondas anteriores y
  sin cambios desde entonces; no los re-verifiqué constraint por constraint.
- **La suite completa (3,148 pruebas)** — no la corro yo en esta sesión.

## Veredicto

**Green light para la demo — 7/10.** El cierre de la ronda 13 está, verificado
en el código y no por el título del commit: `operador_sube_su_pod` amarra el
tenant del POD al del viaje y el bloque 56 ejercita exactamente la fuga que
cerró. Las tres garantías del rubro se sostienen para el camino del demo: el
seed (con la facilidad nueva) es coherente con el guion —el diésel es
transferencia, así que la declaración no altera la narrativa de la única
diferencia de $200—, el aislamiento entre tenants no tiene escritura RLS
cruzable que yo haya encontrado, y las migraciones nuevas (0081 con bloque, 0082
con exención razonada) están comprobables.

Lo que mantiene la nota en 7 y no en 8: la RFA 2.9 entró al rubro con dos MEDIOs
que la ronda 13 no podía ver porque el código no existía —el validador admite
la llave nueva sin validar su valor (una declaración FISCAL que un typo puede
volver "no elegible" en silencio) y el contador del 15% es una suma en cliente
de páginas secuenciales dentro del paso presupuestado en 300 ms, que además
muere por `LecturaIncompleta` pasadas 100,000 filas— más los seis BAJOS
heredados que siguen abiertos (cabecera de verificaciones, XML del demo,
`.catch`, `getPorFacturar`, `tenant_self`, `factura_viaje`).

Para mañana no es bloqueante: el demo no dispara la rama del 15% (no hay diésel
en efectivo en el guion), el contador corre sobre 2 filas, y la declaración del
seed pasa el CHECK. Si sobra media hora antes de la sala, lo que más vale es el
XML del demo (una fecha y dos tasas que un contador en la sala puede cruzar con
una calculadora) y la cabecera de `verificaciones.sql` — los dos son de una
línea. La deuda de fondo, en orden: (1) validar la forma de
`facilidadCombustibleEfectivo` en la 0082, (2) mover el agregado del ejercicio a
un `sum()` en SQL, (3) fijar el ORDER BY de `getGastos`, y (4) los BAJOS
heredados.
