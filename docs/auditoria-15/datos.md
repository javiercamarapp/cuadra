# Modelo de datos y esquema — auditoría 15

**Nota: 7/10** (se mantiene en el 7 de la ronda 14, con movimiento en los dos
sentidos otra vez). Sube porque los DOS MEDIOs que la 14 dejó abiertos en el
camino del 15% fueron atacados y uno quedó cerrado de verdad: la 0083 exige la
FORMA de `facilidadCombustibleEfectivo` en la base (verificado migración por
migración), y el contador del ejercicio dejó de tumbar el cuadre (best-effort
con log). No sube más porque los fixes de la 14 metieron dos MEDIOs NUEVOS al
rubro: (1) el fallback del contador —y el caso espejo de un gasto de diciembre
en un viaje de enero— alimenta al motor con `total=0` y el motor, que NO tiene
la guardia `sin_criterio` que sí tiene `evaluarTope15`, imprime en el PDF
"contra un tope de $0.00 … el excedente NO se deduce" —una afirmación fiscal
falsa generada por una lectura que falló o que midió el año equivocado—; y (2)
el fix del panel (`causasDe`) colapsa el estado "sin declarar" con "declaró que
NO", y el panel suma a "monto perdido" lo que el motor mantiene "por
confirmar", con el comentario del commit diciendo "Mismo estándar que el
motor" cuando no lo es. La vara del rubro sigue siendo la misma: el esquema y
los consumidores deben sostener, sin que nadie mire, que el PDF archivado y lo
que hay en `gasto` dicen lo mismo para siempre, que ningún tenant ve/escribe en
otro, y que cada migración nueva se comprueba contra Postgres real.

Anclado a `d7b171f5c53f5ac401503db63d313cf4c684cc2b` (`git rev-parse HEAD` al
empezar). Sin acceso a Postgres en esta sesión: toda la verificación es lectura
línea por línea de `supabase/migrations/` (0001–0083), `seed.sql`,
`verificaciones.sql`, `src/lib/cuadra/{config,repo,pg,desde_db,cuadre/engine,cuadre/desde_db,periodo/*,tools,facturacion/pendientes,fiscal}.ts`,
`src/lib/admin/negocio.ts` y `src/app/admin/flotas/page.tsx`. Lo que
necesitaría base real para confirmar está dicho como tal.

**Verificación del cierre de la ronda 14 (el encargo explícito).** Los dos
MEDIOs del rubro se atacaron en `8a33ce1`; los abro y compruebo uno por uno:

- **0082 sin forma → CERRADO, verificado en la 0083.** `0083_config_facilidad15_forma.sql:49-67`
  ahora valida: la llave `facilidadCombustibleEfectivo` debe ser un objeto; las
  DOS condiciones deben existir (no `null`) y ser `boolean`. Un `"true"` como
  texto, un número o un objeto con una sola llave rebotan con `raise exception`
  y el CHECK `tenant_config_valida` (que la 0083 alimenta por
  `create or replace`, mismo OID) bloquea el UPDATE. La exención de la 0083 en
  `migraciones_verificadas.test.ts` tiene razón sólida ("una config con 'sí' en
  la llave revienta ruidoso en el UPDATE"). El lado `null` de la llave (JSON
  `null` = sin declarar) pasa el validador y el motor lo lee como
  `facilidad15 = undefined` (`desde_db.ts:56-58` con `f15 && …` → null es
  falsy) — los dos extremos del estado "sin declarar" (llave ausente o `null`)
  son coherentes entre base, merge (`fusionarConfig`, `config.ts:142-153`) y
  motor.
- **Contador del ejercicio en cliente → CERRADO en su modo de fallo, no en su
  costo.** `desde_db.ts:76-81` ahora reusa `getAcumuladoCombustible` dentro de
  `try/catch` con `logger.warn`: la `LecturaIncompleta` a 100,000 filas ya no
  tumba el cuadre. Pero el fallback entrega `{efectivo: 0, totalCombustible: 0}`
  al motor, y el motor no tiene la rama "sin datos del ejercicio" que el mensaje
  del commit afirma ("el motor recibe ceros y la rama 'sin datos del ejercicio'
  marca el efectivo para revisar" — esa rama no existe: `engine.ts:311-326` no
  tiene ningún `if (total === 0)`; los ceros corren la aritmética normal). Es el
  MEDIO nuevo #1 abajo. Y la herramienta de periodo sigue llamando el contador
  SIN las claves y con el año del reloj — BAJO nuevo #5 abajo.
- **Alta tri-estado → CERRADO, verificado.** `flotas/page.tsx:37-38` manda
  `undefined` cuando el checkbox no está marcado y `administracion.ts:110-116`
  solo escribe la llave cuando AMBAS son booleanos; desmarcado ya no es "declaró
  que NO". La edición en consola existe (`accionFacilidad` + `actualizarFacilidad15`,
  `repo.ts:921-931`) — con el defecto del BAJO nuevo #3.
- **`getPorFacturar` recorte a 500 → CERRADO, verificado.** `pendientes.ts:122-130`
  pagina con `traerTodo` (con `count` exacto y doble ORDER BY `fecha, id`); el
  recorte silencioso ya no existe y el `resumen()` corre sobre la lista completa.
- **Los siete BAJOS heredados** — `getGastos` sin ORDER BY, `efectivoDeEsteViaje`
  sin filtro de año (el escenario NOMBRADO quedó cerrado por el ancla a
  comprobantes; la familia sigue en el espejo, ver MEDIO nuevo #1), cabecera de
  `verificaciones.sql` y bloque 56 sin estampa, drift de la 0082,
  `tenant_self`, `factura_viaje`, `.catch(() => null)` y XML del demo —
  **todos siguen abiertos**, re-verificados abajo uno por uno.

## Hallazgos

### [MEDIO, abierto] El motor no tiene la guardia de `total=0`: cuando el contador del ejercicio falla —o el gasto es del año anterior al del viaje— el PDF afirma "tope de $0.00, el excedente NO se deduce" sobre un dato que no se midió

`src/lib/cuadra/cuadre/desde_db.ts:76-81` captura el fallo del contador y
entrega ceros; `src/lib/cuadra/cuadre/engine.ts:311-326` los procesa sin
distinguirlos de una medición real:

```ts
const previoSinEste = (input.efectivoPrevEjercicio ?? 0) + efectivoAcumuladoEjercicio;
efectivoAcumuladoEjercicio += g.monto;
const total = input.totalCombustibleEjercicio ?? 0;
const acumulado = (input.efectivoPrevEjercicio ?? 0) + efectivoAcumuladoEjercicio;
const tope = 0.15 * total;
const cupoRestante = Math.max(0, tope - previoSinEste);
const dentro = Math.min(g.monto, cupoRestante);
const excedenteDeEste = Math.max(0, g.monto - dentro);
```

No hay ningún `if (total <= 0 && efectivo > 0)` — la guardia que
`periodo/combustible.ts:74-79` (`evaluarTope15`) sí tiene: "Sin denominador no
hay razón que calcular… no se afirma nada" → estado `sin_criterio`. El mismo
equipo escribió la guardia honesta en la capa de periodo y se le olvidó en el
motor, que es la que imprime.

**Escenario A (fallo del contador) con valores.** El 5-ene-2026 el tenant tiene
una flota grande: 101 páginas de 1,000 cargas de diésel en el ejercicio →
`getAcumuladoCombustible` lanza "solo se leyeron 100,000 de 101,237"
(`repo.ts:855-861`), el `catch` de `desde_db.ts:79` lo traga y loguea. El viaje
tiene un diésel en efectivo de $5,000. El motor recibe `total=0` → `tope=0` →
`cupoRestante=0` → `excedenteDeEste=5,000` → diferencia `efectivo_sobre_15`
con la nota: *"Diesel pagado en EFECTIVO — el ejercicio lleva $5,000.00 de
combustible en efectivo contra un tope de $0.00 (15% de $0.00); el excedente de
$5,000.00 de ESTE comprobante NO se deduce (RFA 2026 regla 2.9)"*. Eso va al
PDF: una afirmación fiscal tajante ("NO se deduce") construida sobre una
lectura que falló, en la dirección que nadie revisa (a la baja). Sí marca
`revisar` (porque `8a33ce1` metió `efectivo_sobre_15` en `REVISAR`,
`engine.ts:1130-1131`), pero el estatus de revisión no desimprime la nota ni
quita el monto de `totalNoDeducible` (`engine.ts:1115`: con
`proporcionDeducible = 0`, el monto entero cae a `totalNoDeducible`).

**Escenario B (gasto del año anterior al del viaje) con valores.** Viaje
iniciado el 4-ene-2026 (legal: la ventana de `ventanaDelViaje` admite gastos
hasta 30 días antes de `fecha_inicio`), con un diésel en efectivo de $5,000
fechado 29-dic-2025. El ancla de la 14 (`desde_db.ts:63-65`) toma
`viaje.fechaInicio` → `anioEjercicio = "2026"`. El contador 2026 sale
legítimamente en $0 (el gasto es de 2025, y la consulta filtra por fecha). Sin
ningún fallo, sin ningún log, el motor corre el mismo `tope=$0.00` y el mismo
"NO se deduce" contra un comprobante que debería evaluarse contra el ejercicio
2025. La 14 cerró el escenario espejo (viaje de diciembre cuadrado en enero,
gasto de diciembre: con el ancla nueva el gasto ya cae en su año y la nota sale
"15% de $5,000.00", correcta); este lado de la frontera —viaje que empieza en
enero con gastos de diciembre— quedó sin arreglar porque el arreglo movió el
reloj del proceso al reloj del VIAJE, no al del COMPROBANTE. La misma familia
que la 14 marcó "MEDIO si la flota cuadra viajes de diciembre en enero",
vuelta del revés.

El fix mínimo es la guardia del motor (`total <= 0 && efectivo > 0` → la nota
honesta de `sin_criterio`, "no se pudo calcular, se revisa a mano", sin restar
de `totalNoDeducible`), más filtrar `efectivoDeEsteViaje` por año
(`desde_db.ts:84-86` cuenta gastos de cualquier fecha). **Estado: abierto.**

### [MEDIO, abierto] `causasDe` colapsa "sin declarar" con "declaró que NO": el panel suma a "monto perdido" lo que el motor mantiene "por confirmar" — y el commit dice "Mismo estándar que el motor"

`src/lib/cuadra/fiscal.ts:337`:

```ts
push(o.elegible15 === true ? 'combustible_efectivo' : 'efectivo_no_elegible');
```

El motor distingue TRES estados (`engine.ts:301-341`): `true` →
`combustible_efectivo_dentro15`/`efectivo_sobre_15`; `false` →
`efectivo_no_elegible` (en `NO_DEDUCIBLE_ISR`, `engine.ts:97`); `undefined`
(sin declarar) → `combustible_efectivo` con monto 0 y la nota "sin esa
declaración **esto se revisa**", en `REVISAR` y en `POR_CONFIRMAR`
(`engine.ts:98`) → cubeta `por_confirmar`, no se afirma nada. El panel colapsa
los dos últimos: `undefined` recibe `efectivo_no_elegible`, que tiene
`gravedad: 'perdida'`, título "Combustible en efectivo sin facilidad" y el
detalle "el efectivo en combustible **no es deducible aunque tenga CFDI**"
(`fiscal.ts:277-283`).

**Escenario con valores.** Flota dada de alta sin marcar los checkboxes (el
tri-estado nuevo permite exactamente eso, y el motor la trata como sin
declarar). Tiene en el periodo un diésel en efectivo de $4,200 con CFDI
vigente. El motor, al cuadrar: `combustible_efectivo`, monto 0, estatus
`revisar`, cubeta `por_confirmar` — "se revisa", no se afirma pérdida. La
pantalla de deducciones del contador (`deducciones/page.tsx:97` →
`resumirPerdidas` → `causasDe`): `montoPerdido += 4,200` (`fiscal.ts:417`) y la
fila del comprobante muestra "Combustible en efectivo sin facilidad — no es
deducible aunque tenga CFDI". El mismo hecho, la misma base, dos veredictos
fiscales: "por confirmar" y "perdida". Es la familia exacta que la regla del
repo persigue ("una cifra fiscal que se lee distinto en dos pantallas se lee
como dos cálculos") y el comentario del fix (`fiscal.ts:335`, "Mismo estándar
que el motor") es falso. La prueba no lo ve porque `fiscal.test.ts:27-30`
construye `OPTS` con `elegible15: true` siempre — el caso sin declarar (y el
`false`) de `causasDe` no tiene ni una prueba.

Además, `efectivo_no_elegible` NO está en `ORDEN` (`fiscal.ts:352-355`), así
que aunque su monto entra a `montoPerdido` y a `porCausaMapa`
(`fiscal.ts:414-415`), el desglose `porCausa` —la gráfica "por causa" de la
misma pantalla (`deducciones/page.tsx:194-205`)— lo filtra con
`ORDEN.filter(...)` y la causa nunca aparece: la pantalla afirma "monto
perdido: $4,200" con una gráfica que no explica por qué. (Para el caso
`false` declarado también: el desglose no muestra la causa de su dinero
perdido.) **Estado: abierto** (el fix es un ternario de tres ramas + añadir la
causa a `ORDEN`; el motor ya tiene los tres estados, es copiarle el estándar).

### [MEDIO→BAJO, cerrado parcial, verificado] El contador ya no tumba el cuadre, pero sigue siendo un bucle de páginas secuenciales dentro del paso que `presupuesto.ts` tasa en 300 ms

El modo de fallo de la 14 (muere por `LecturaIncompleta` a 100,000 filas) quedó
cerrado: `desde_db.ts:76-81` lo atrapa y loguea, y el cuadre sale. Lo que queda:
`getAcumuladoCombustible` (`repo.ts:803-864`) sigue siendo una suma en cliente
de páginas de 1,000 (`range(leidas, leidas+999)`, hasta 100 vueltas), y ahora
corre dentro de TODOS los llamados a `cuadrarDesdeDB` —la tool
(`tools.ts:79`), la guardia de cada turno con cifras (`processor.ts:658`,
presupuestado en `presupuesto.ts:40` como 300 ms), el cierre
(`processor.ts:1838, 1939`) y la reconstrucción del panel (`analytics.ts:800`).

**Escenario con valores.** Flota con 5,000 cargas de combustible en el año → 5
viajes de red secuenciales (~0.3-0.8 s en us-east-2) sumados a CADA cuadre y a
CADA turno con cifras, sobre un paso presupuestado en 0.3 s. La 0063 cita 660
comprobantes/día como volumen de plataforma; una flota grande llega a 100,000
en un ejercicio y el cuadre deja de morir pero pierde el contador (cae al MEDIO
#1). La cifra que se necesita es un `sum()` de PostgREST; el loop es la decisión
de diseño que la 14 decidió no tocar ("no se reescribe la ruta del dinero la
víspera"). Para el demo no duele (2 filas, 1 página). **Estado: cerrado en el
modo de fallo; abierto en el costo** (la prueba `repo_acumulado.test.ts` cubre
el corte y el fail-closed; no hay medición del costo real).

### [BAJO, abierto] La frontera del 15% sigue atribuyendo el excedente según el orden de `getGastos`, que NO tiene ORDER BY — el mismo cuadre marca a un gasto distinto en cada corrida

`src/lib/cuadra/repo.ts:556-562`: `getGastos` hace `.eq('tenant_id', …)
.eq('viaje_id', …)` SIN `.order()`. El motor acumula el efectivo del viaje en el
orden de `input.gastos` (`engine.ts:311-326`). El fix de la 14 cambió la
fórmula a "excedente por comprobante" (`cupoRestante`), lo que eliminó el bug de
la columna que no sumaba — pero la ATRIBUCIÓN por renglón sigue dependiendo del
orden:

**Escenario con valores.** Viaje con dos diésel en efectivo A=$100 y B=$80;
previo del ejercicio $0; total del ejercicio $1,000 → tope $150.
- Orden A,B: A cabe (cupo 150 → dentro 100, 100%). B: previo 100 → cupo 50 →
  dentro 50, excedente 30 → B deducible al 62.5%.
- Orden B,A: B cabe (cupo 150 → dentro 80, 100%). A: previo 80 → cupo 70 →
  dentro 70, excedente 30 → A deducible al 70%.

El excedente total ($30) y `totalNoDeducible` son invariantes —por eso BAJO—,
pero el PDF marca un renglón distinto como "parcialmente no deducible" según el
orden que Postgres devuelva, y el acreditamiento de IVA (proporcional,
`engine.ts:1002`) cae sobre comprobantes distintos en cada corrida. El tope
de alimentación ya reparte por día y comenta explícitamente "no depende del
ORDEN del arreglo" (`engine.ts:1100`); la frontera del 15% no tiene ese orden.
Sigue siendo una línea (`repo.ts`, `.order('fecha, id')`). **Estado: abierto.**

### [BAJO, abierto] `efectivoDeEsteViaje` sigue sin filtrar por año ni por fecha — el contador previo se subestima cuando el viaje trae gastos fuera del ejercicio

`src/lib/cuadra/cuadre/desde_db.ts:84-87`:

```ts
const efectivoDeEsteViaje = gastos
  .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
  .reduce((s, g) => s + Number(g.monto ?? 0), 0);
```

Sin filtro de año (y sin filtro de `fecha` a secas). El contador
`totalesEjercicio.efectivo` sale de una consulta que filtra por fecha dentro del
ejercicio (`repo.ts:828-831`) y que además excluye los gastos sin fecha
(`gte('fecha', …)`). Restar de un total lo que el total no incluye subestima
`efectivoPrevEjercicio` (el `max(0, ·)` de la línea 87 devora la resta).

**Escenario con valores.** Viaje de enero con un diésel en efectivo de $5,000
fechado 29-dic-2025 (el mismo del MEDIO #1, caso B): `totalesEjercicio.efectivo`
(2026) = 0, `efectivoDeEsteViaje` = 5,000 → `efectivoPrevEjercicio` = 0 — y el
gasto, que no está en el contador, se suma al acumulado del motor contra un
total que no lo incluye. Variante sin fecha: un gasto de $5,000 sin `fecha`
tampoco está en el contador (excluido por `gte`), pero sí en `efectivoDeEsteViaje`.
Misma familia de la 14, lado espejo: el ancla del ejercicio cambió, la resta no.
**Estado: abierto** (BAJO por la estrechez de la ventana; es el mismo fix que el
MEDIO #1 pide: filtrar por año).

### [BAJO, abierto] `accionFacilidad` con una sola casilla en "—" borra la declaración ENTERA y el mensaje dice "actualizada"

`src/app/admin/flotas/page.tsx:56-73` + `src/lib/cuadra/repo.ts:921-931`:

```ts
const ded = fd.get('ded') === 'si' ? true : fd.get('ded') === 'no' ? false : undefined;
const reg = fd.get('reg') === 'si' ? true : fd.get('reg') === 'no' ? false : undefined;
...
if (ded !== undefined && reg !== undefined) {
  actual.facilidadCombustibleEfectivo = { dedicacionExclusivaCarga: ded, regimenElegible: reg };
} else {
  delete actual.facilidadCombustibleEfectivo;
}
```

El formulario de edición (`flotas/page.tsx:135-141`) tiene dos selects
independientes con la opción "—". Si el admin cambia SOLO uno —por ejemplo la
flota declaró `{true, true}` y él corrige "Régimen: No" dejando "Carga: —"—,
`ded` queda `undefined`, `reg` queda `false` → la rama `else` BORRA la llave
completa: la declaración de dedicación que existía (y que él no tocó) se
pierde, la flota queda "sin declarar", y el mensaje `ok` dice "Declaración del
15% actualizada" (la condición del mensaje, `ded !== undefined`, es falsa — el
mensaje miente). Efecto fiscal: todo el diésel en efectivo de la flota pasa de
deducible-con-contador a "por confirmar", sin que nadie haya declarado nada y
sin rastro en pantalla de que se borró la mitad que no se tocó. La 0083 no lo
atrapa porque borrar la llave es legal. **Estado: abierto** (BAJO — consola de
superadmin y el resultado es conservador, no dinero perdido; el fix es validar
que vengan las dos o avisar "faltó una casilla, no se guardó nada").

### [BAJO, abierto] La tool de periodo sigue usando OTRO criterio y OTRO año que el motor: sin claves del SAT y con el reloj del proceso

`src/lib/cuadra/tools.ts:104-105`:

```ts
const ejercicio = new Date().getUTCFullYear();
const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

El fix de la 14 ("una sola barrida del ejercicio (reusa
getAcumuladoCombustible)… se pasa la misma lista de claves que el motor;
tres contadores con tres criterios = el chat dice 8% y el motor 12%") se aplicó
solo en `desde_db.ts:78` (que sí pasa `clavesCombustible` y el año anclado a
comprobantes). La tool NO pasa claves — `getAcumuladoCombustible` sin `claves`
cae al criterio `concepto.eq.diesel` a secas (`repo.ts:827`) — y usa el año del
reloj del proceso.

**Escenario con valores.** Flota que paga gasolina (clave 15101514) en efectivo
además de diésel: el motor la cuenta (`esCombustible` incluye las claves, y el
contador de `desde_db` recibe las mismas claves), la tool no (solo
`concepto='diesel'`). El agente dice por WhatsApp "te quedan $3,000 antes de
perder la deducción, vas en 9%" mientras el PDF de la misma liquidación dice
"el ejercicio lleva $X … 14.8%". Y en enero, con un viaje de diciembre: la tool
cuenta 2026 y el motor 2025. La divergencia exacta que el comentario del fix
dice haber eliminado sigue existiendo entre las dos superficies que hablan del
mismo contador. **Estado: abierto** (BAJO — el aviso es contexto, no afirmación
del PDF; dos líneas).

### [BAJO, abierto] `desde_db.ts:44` — `.catch(() => null)` sigue enmascarando cualquier fallo de lectura del operador (heredado de la 13/14, re-verificado)

`src/lib/cuadra/cuadre/desde_db.ts:43-45`:

```ts
const operador = viaje.operadorId
  ? await getOperador(viaje.operadorId, tenantId).catch(() => null)
  : null;
```

Sin cambios desde la 14. El dinero falla cerrado (viáticos al RFC del operador
caen a `viatico_rfc_operador`, a revisión) pero la exención de la 0080 en
`migraciones_verificadas.test.ts` ("si la columna falta, `getOperador` falla
ruidoso") no se sostiene en este camino: un entorno sin la 0080 liquidaría todo
el día con viáticos "a revisión" y la única pista sería la nota del PDF. El
ruido es diagnóstico; este `catch` lo silencia. **Estado: abierto.**

### [BAJO, abierto] El XML del diésel del demo sigue sin cuadrar internamente y sigue predatado (heredado de la 13/14, re-verificado)

`supabase/seed.sql:145` — sin cambios desde la 14:

- `Base="3210.00" Impuesto="003" TasaOCuota="6.1740" Importe="408.62"` —
  3210.00 × 0.06174 = **198.19**, no 408.62.
- `Base="3618.62" Impuesto="002" TasaOCuota="0.160000" Importe="581.38"` —
  3618.62 × 0.16 = **578.98**, no 581.38 (el 581.38 se despejó para que la suma
  diera 4200, no del 16% declarado).
- `Cantidad="113.00" ValorUnitario="28.41" Importe="3210.00"` — 113 × 28.41 =
  **3210.33**.
- `Fecha="2026-05-15T09:14:00"` — tres meses antes del gasto (`current_date-1`)
  y del viaje.

El parser de la app suma los `Importe` declarados sin multiplicar base×tasa,
así que la demo no lo ve; el riesgo es el de la sala: es el CFDI de respaldo
del comprobante que el guion presenta como "deducible y ACREDITABLE" delante de
un contador con calculadora. **Estado: abierto** (BAJO, dato de demo — pero es
el dato que mañana se enseña).

### [BAJO, abierto] La cabecera de `verificaciones.sql` sigue diciendo 31-jul y los bloques 52-56 no traen estampa de corrida real (heredado de la 14, re-verificado)

`supabase/verificaciones.sql:15` — "Última corrida: **31-jul-2026**"; los únicos
bloques con salida pegada son el 41 (`:1764`) y el 43 (`:2026`). El bloque 56
(`:3108-3146`), el 54 (`:2979`) y el 55 (`:3047`) dicen "Corrida real esperada"
sin la salida. La garantía 3 del rubro (cada migración se comprueba contra
Postgres real) depende de que esta bitácora sea creíble; hoy su primera
afirmación está vencida y las corridas recientes viven solo en mensajes de
commit. **Estado: abierto** (una línea por corrida).

### [BAJO, abierto] La 0082 —y ahora también la 0083— heredan el drift: "El trigger 0026" cuando es un CHECK, y "Las 9 llaves" cuando ya son 10

`supabase/migrations/0082_config_facilidad15.sql:6-8` y
`0083_config_facilidad15_forma.sql:6-7` (repite la misma frase de la 0082):
"El trigger 0026 validaba las llaves de la config" — la 0026 crea un CHECK
(`tenant_config_valida`), no un trigger (grep de `create trigger`: 0
resultados). Y ambos comentarios dicen "Las 9 llaves de `CuadraConfig`" cuando
`llaves_ok` ya tiene 10 entradas. La 0083, que se escribió precisamente para
corregir un defecto de documentación-fiscal (el valor de la llave), copió el
drift del archivo que corrige. **Estado: abierto** (cuatro palabras en dos
archivos).

### [BAJO, abierto] `tenant_self` sigue dejando que el chofer lea `tenant.config` (heredado de la 13/14, re-verificado)

`supabase/migrations/0078_rls_chofer_sin_escritura.sql:56-58`: `tenant_self`
sigue con `using (id = any(get_user_tenant_ids()) or is_superadmin())`, y
`get_user_tenant_ids()` (0001) incluye al `operador`. Con sesión web + anon
key, un chofer puede leer `tenant.config` de su flota: la política completa
(topos de diésel, caseta, alimentación) contra la que el motor decide
`sobre_politica` en SU liquidación — información que el producto no le da en
ninguna pantalla. La 0079 acotó `app_user` con `not is_operador()`; a `tenant`
no se le aplicó el mismo brazo. Sin consumidor legítimo que se rompa
(re-verificado: la UI del chofer no lee `tenant` por RLS). **Estado: abierto.**

### [BAJO, abierto] `factura_viaje` sigue sin FK compuesta ni candado de viaje (heredado de la 13/14, re-verificado)

`supabase/migrations/0049_cobranza_factura_emitida_pago.sql:150-159`: la policy
`tenant_finanzas` de `factura_viaje` valida solo el lado `factura_id` (EXISTS
contra `factura_emitida` con tenant + `ve_finanzas`); el lado `viaje_id` queda
libre. Un `ve_finanzas` del tenant A puede insertar `{factura_id: <factura de
A>, viaje_id: <viaje de B>}`: el `with check` pasa y la vista `factura_saldo`
de A muestra una factura atada a un viaje ajeno. Sin consumidor en la app
(`fiscal.ts:942` declara que el código NO toca `factura_viaje` todavía) — hueco
latente, misma familia del MEDIO que la 0081 cerró para `pod`. **Estado:
abierto** (una línea cuando la tabla tenga su primer INSERT).

## Lo que revisé y está bien

- **La 0083, línea por línea.** Es la 0082 completa más el bloque de forma
  (`:49-67`). Verifiqué el diff contra la 0082: ninguna validación existente se
  alteró — `politica`, `estimulos`, `tabulador`, `empresa`, `salida`,
  `hidrocarburos`, `validacion`, `unidades`, `catalogoCuentas` quedan iguales;
  el CHECK de la 0026 sigue alimentándose por `create or replace` (mismo OID).
  El alta de flota (booleanos limpios), el seed (`{true,true}`) y la edición de
  la consola (booleanos o borrado) pasan el validador; un `"true"` texto o un
  objeto con una sola llave rebotan. La exención de la 0083 en
  `migraciones_verificadas.test.ts` tiene razón sólida.
- **El fix del contador, en su camino feliz.** `getAcumuladoCombustible`
  (`repo.ts:803-864`) con `count: 'exact'` solo en la primera página, corte con
  log y error fail-closed si la lectura queda incompleta, orden `fecha, id`
  (estable para el `range`), y el criterio de combustible ahora acepta las
  claves — que `desde_db.ts:78` sí pasa. La prueba `repo_acumulado.test.ts`
  (5) cubre el recorte de `max_rows` y el fail-closed. El ancla del ejercicio
  (`desde_db.ts:63-65`) resuelve el escenario NOMBRADO de la 14 (viaje de
  diciembre cuadrado en enero): el gasto de 29-dic-2025 se evalúa contra el
  contador 2025 y la nota sale con la base real, no contra $0.
- **El excedente por comprobante.** El nuevo algoritmo (`engine.ts:311-326`)
  con `cupoRestante` y `proporcionDeducible` por gasto hace que la suma de la
  columna cuadre con `totalNoDeducible` (prueba nueva: 3×$1,000, tope $1,500 →
  suma $1,500) y que un gasto nunca cargue el excedente acumulado ajeno. El
  total del excedente es invariante al orden (lo que no es invariante es la
  atribución — BAJO arriba). `efectivo_sobre_15` y `efectivo_no_elegible`
  entraron a `REVISAR` (`engine.ts:1130-1131`): el dinero no deducible ya no
  sale en estatus `cuadrada` (prueba nueva).
- **El tri-estado y su lectura.** `flotas/page.tsx:37-38` →
  `administracion.ts:110-116`: sin marcar = no se escribe nada = "sin
  declarar"; la edición lee `facilidad15?.dedicacionExclusivaCarga === true ?
  'si' : …` y el `defaultValue` distingue los tres estados. `fusionarConfig`
  (`config.ts:142-153`) con la llave ausente o `null` produce
  `f.facilidadCombustibleEfectivo = undefined/null` y el motor lo lee como
  "sin declarar" — los tres estados del motor son alcanzables desde la base.
- **Las superficies con la elegibilidad.** `comun.tsx:135` (opcionesDelPanel)
  usa la MISMA fórmula que el motor (`f15 && …` con las dos condiciones);
  `ivaSostenible` (`fiscal.ts:510-512`) niega el IVA a todo combustible en
  efectivo, consistente con `SIN_ACREDITAMIENTO` del motor; el aviso de la tool
  (`aviso.ts:22-37`) distingue los tres estados y `evaluarTope15` tiene la
  guardia `sin_criterio` que el motor no tiene (por eso es hallazgo, no
  invento). El seed del demo declara `{true,true}` → el demo no toca ninguna
  rama rota: ni la del fallback (2 filas, 1 página) ni la del panel
  (elegible=true → `combustible_efectivo`, igual que el motor).
- **El cierre del rubro backend que toca datos.** `getPorFacturar` pagina con
  `traerTodo` y doble ORDER BY (`pendientes.ts:122-130`); el export de
  liquidaciones desempata con `created_at + id` (`route.ts:69`); las funciones
  ARCO nuevas (`repo.ts:945-977`) usan `traerTodo` y `resolverSolicitudArco`
  filtra por `tenant_id` en el UPDATE.
- **Pruebas corridas en esta sesión (todas verdes):** `engine.test.ts` 114,
  `fiscal.test.ts` 57, `repo_acumulado` 5, `migraciones_verificadas` 4,
  `aviso` 6, `combustible` 15, `config`/`config_merge`/`config_tope`/
  `config_falla`/`repo_escritura`/`repo_operadores` 35. No corrí la suite
  completa (instrucción: otro auditor la corre).

## Lo que no alcancé a revisar

- **La base real (us-east-2).** El PROMPT-BASE declara migraciones hasta la
  0080 aplicadas y el release `caae369` en producción; los commits afirman la
  0081/0082/0083 aplicadas y el bloque 56 pasando. No tengo credenciales: los
  bloques los leí y son coherentes con el esquema, pero su salida real no la
  re-corro yo — y, como dice el BAJO de bitácora, las estampas de esas corridas
  no están en el archivo.
- **El costo real del contador en producción** (¿cuántas páginas por ejercicio
  tiene el tenant más grande hoy? el hallazgo MEDIO→BAJO es prospectivo).
- **El detalle de la matriz IVA/IEPS** (si "efectivo dentro del 15% no acredita
  IVA" es la lectura correcta de LIVA 5-I) — es del rubro fiscal; del lado de
  datos verifiqué que la regla se aplica de forma consistente en
  `SIN_ACREDITAMIENTO` y en `ivaSostenible`.
- **0056-0061 y los checks de la 0070/0075** — leídos en rondas anteriores y
  sin cambios; no los re-verifiqué constraint por constraint.
- **El render de la nueva columna de la consola** (selects por flota) — no
  levanto preview en esta sesión; verifiqué el código y los valores
  (`defaultValue` con los tres estados), no el píxel.
- **La suite completa (3,155 pruebas)** — no la corro yo en esta sesión.

## Veredicto

**Green light para la demo — 7/10.** El cierre más importante de la ronda 14
está, y está verificado en el código, no por el título del commit: la base
ahora exige la FORMA de la declaración fiscal del 15% (0083), y el contador del
ejercicio dejó de poder tumbar un cuadre. El camino del demo no toca ninguna
de las ramas rotas: la flota del seed declara `{true,true}`, el contador corre
sobre 2 filas, y el panel coincide con el motor para `elegible=true`. Las tres
garantías del rubro se sostienen para el guion.

Lo que mantiene la nota en 7 y no la sube: los fixes de la 14 metieron al rubro
dos MEDIOs nuevos que la ronda 14 no podía ver porque el código no existía —
el motor sin la guardia de `total=0` (una nota fiscal falsa "15% de $0.00" en
el PDF cuando el contador falla o cuando el gasto es del año anterior al del
viaje, el lado espejo de lo que la 14 sí arregló) y `causasDe` colapsando "sin
declarar" con "declaró que NO" (el panel afirma pérdida donde el motor afirma
"se revisa", con un comentario de commit que dice lo contrario)— más los ocho
BAJOs heredados que siguen abiertos y tres BAJOs nuevos del propio fix
(borrado parcial en la consola, tool con criterio/año distintos, causa perdida
sin renglón en el desglose).

Para mañana no es bloqueante: la demo no dispara ninguna de las dos ramas
medias (elegible=true, contador sano). Si sobra media hora antes de la sala,
lo que más vale sigue siendo el XML del demo (dos tasas y una fecha que un
contador puede cruzar con una calculadora) y la cabecera de
`verificaciones.sql`. La deuda de fondo, en orden: (1) la guardia `total=0` en
el motor + el filtro por año de `efectivoDeEsteViaje`, (2) el ternario de tres
ramas en `causasDe` + `efectivo_no_elegible` en `ORDEN`, (3) el ORDER BY de
`getGastos`, (4) pasar las claves y el ancla de año a la tool de periodo, (5)
los BAJOs heredados.
