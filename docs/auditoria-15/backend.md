# Backend y API — auditoría 15

**Nota: 7/10** (antes 5.5). Razón del movimiento: **se atacó y subió** — los
diez hallazgos de código de la ronda 14 se corrigieron de verdad (lo verifiqué
abriendo el código y con pruebas propias, no por el título de los commits:
estatus `revisar` para el no deducible, IVA del efectivo negado en el panel,
excedente por comprobante — confirmado con 700+1000=1700 —, ejercicio anclado a
los comprobantes, alta tri-estado + edición en consola, 0083 con la forma
validada, contador único en `desde_db`), y los SIETE hallazgos de la ronda 13
se cerraron en `d7b171f` (503 en `resolverTenantApi`, desempate único del
export, `traerTodo` en `getPorFacturar`, el rechazo del PDF le habla al chofer,
el alta de usuario valida el rol, el comentario muerto, y el route-test del
webhook de Stripe — 6 de 7 completos; el MEDIO #1 de la ronda 13 quedó cerrado
en 1 de sus 3 sitios, ver MEDIO #4 de esta ronda).

Lo que baja la nota: el MISMO fix que alineó el panel con el motor sembró una
contradicción nueva y visible —`causasDe` confunde "sin declarar" con "declaró
que NO califica", y la pantalla del contador pinta el diésel en efectivo de
toda flota sin declarar como "Ya no se recupera" (pérdida definitiva) cuando
el motor lo tiene en "por confirmar" (no se afirma nada)—. A eso se suman
cierres a medias: la herramienta `cuadrar_viaje` sigue con el año del reloj y
sin las claves SAT (el MEDIO #6 de la ronda 14 quedó unificado en `desde_db`
pero no en la tool), y la rama `total=0` del motor sigue afirmando "excede el
tope de $0.00" —la misma familia de la ronda 14, por otra puerta— mientras el
comentario de `desde_db.ts:74` promete que "marca el efectivo para revisar",
que no existe como rama.

**Método:** código actual en HEAD (`d7b171f`), línea por línea; verifiqué los
cierres de la ronda 14 contra `docs/auditoria-14/backend.md` abriendo cada
archivo y corriendo pruebas temporales (borradas al terminar: `aud15-temporal`);
corrí las suites del rubro — cuadre+periodo+laboral 422, facturación+fiscal+
export+stripe 367, auth+administracion+repo+export+saas 300, processor+cierre+
normas+al_vuelo+escalar+negocio+meta 308 — todo verde, y `tsc` limpio salvo
dos errores en archivos `zzz-*` SIN trackear de otro auditor que corría en
paralelo (no son del repo). **No hice git commit, no toqué la base, no
desplegué.**

---

## CRÍTICO

No encontré un CRÍTICO demostrable. El camino de dinero sigue razonado y
probado (cierre atómico, claims, idempotencia de Stripe, RLS), y ninguno de los
hallazgos de abajo deja escapar datos entre tenants ni fabrica una cifra en la
liquidación persistida — el ALTO #1 es una contradicción panel-vs-motor, no una
fuga.

## ALTO

### 1. El panel pinta como PÉRDIDA DEFINITIVA el diésel en efectivo de una flota "sin declarar", mientras el motor lo tiene en "por confirmar" — introducido por el propio fix de la ronda 14

`src/lib/cuadra/fiscal.ts:337`:

```ts
push(o.elegible15 === true ? 'combustible_efectivo' : 'efectivo_no_elegible');
```

El fix de la ronda 14 (commit `8a33ce1`, "superficies con la elegibilidad")
confluye `false` (declaró que NO califica) con `undefined` (sin declarar) en la
misma causa. `efectivo_no_elegible` tiene `gravedad: 'perdida'`
(`fiscal.ts:279-285`), así que `resumirPerdidas` (`fiscal.ts:399-465`) suma el
monto a `montoPerdido`, y la pantalla del contador lo enseña como
**"Ya no se recupera"** (`app/dashboard/contador/page.tsx:196`) y en rojo en
Deducciones perdidas (`app/dashboard/contador/deducciones/page.tsx:126`).

El motor NO trata `undefined` así: `engine.ts:341-347` cae en la rama
`else` (elegible === undefined) y emite `combustible_efectivo`, que
`engine.ts:98` clasifica en `POR_CONFIRMAR` — la liquidación dice "por
confirmar" (no se afirma nada, la matriz del deber ser §2: `undefined` = sin
declarar → por confirmar). El propio comentario del fix dice "Mismo estándar
que el motor" (`fiscal.ts:335-336`) — pero el estándar del motor para
`undefined` NO es `efectivo_no_elegible`, es `combustible_efectivo`. El fix
leyó mal el motor al cerrar el ALTO #2 de la ronda 14 y sembró la misma
familia de contradicción por la otra puerta.

**Confirmado empíricamente** (probe del auditor fiscal en paralelo, que corrí):
`resumirPerdidas([gasto diesel, efectivo, CFDI vigente, $1,000], {elegible15:
undefined})` → `montoPerdido: 1000`, fila dominante `efectivo_no_elegible`. El
mismo gasto por el motor con `facilidad15: undefined` → `combustible_efectivo`
(por confirmar), `totalPorConfirmar = 1000`.

**Escenario con valores:** cualquier flota creada antes de la RFA 2.9 (o con la
casilla sin marcar) — es decir, el estado de TODO cliente existente el día que
la facilidad importe. Viaje con un ticket de diésel en efectivo $4,000 con CFDI
vigente. La liquidación imprime "Por confirmar $4,000" y el aviso al jefe dice
"exige que la flota declare su dedicación y régimen"; la pantalla del contador,
sobre el MISMO gasto, dice "Ya no se recupera $4,000.00" en rojo. El contralor
deja de perseguir la declaración porque el panel le dice que el dinero ya está
perdido. Es la frase exacta que este rubro persigue hace cinco rondas: dos
cálculos para el mismo hecho.

**Estado: abierto** (nuevo, regresión del propio cierre `8a33ce1`). El fix es
de una línea: `o.elegible15 === true ? 'combustible_efectivo' :
o.elegible15 === false ? 'efectivo_no_elegible' : 'combustible_efectivo'`.

## MEDIO

### 2. La rama `total = 0` del motor afirma "excede el tope de $0.00" — la mentira que la ronda 14 dijo haber cerrado, por otra puerta, y contra el comentario del propio `desde_db`

`src/lib/cuadra/cuadre/engine.ts:313-332`: con `facilidad15 === true` y
`totalCombustibleEjercicio = 0`, `tope = 0.15 × 0 = 0`, `cupoRestante = 0`,
`dentro = 0`, `excedenteDeEste = g.monto` → la rama `else` empuja
`efectivo_sobre_15` con la nota:

> "el ejercicio lleva $5,300.00 de combustible en efectivo contra un tope de
> $0.00 (15% de $0.00); el excedente de $5,300.00 de ESTE comprobante NO se
> deduce (RFA 2026 regla 2.9)".

`desde_db.ts:74` promete lo contrario: "el motor recibe ceros y la **rama 'sin
datos del ejercicio'** marca el efectivo para revisar, que es el fail-cerrado
honesto" — esa rama NO existe: con `elegible === true` y `total = 0` no hay
ningún chequeo de `total > 0`, y el motor no "marca para revisar": declara NO
deducible con una frase que afirma un exceso contra un tope de $0 que es un
hueco de consulta, no una medición. La propia tool tiene la rama honesta que el
motor no tiene: `avisoTope15` con `sin_criterio` dice "no se pudo calcular el
total de combustible del ejercicio, así que no se evaluó el 15%... Conviene
revisarlo a mano" (`periodo/aviso.ts:50`). El mismo estado, dos verdades: la
tool dice "no se evaluó", el motor dice "excede el tope de $0, NO se deduce".

**Confirmado empíricamente** (prueba temporal, borrada): `cuadrarViaje({anticipo:
5300, facilidad15: true, totalCombustibleEjercicio: 0, efectivoPrevEjercicio:
0, gastos: [diésel $5,300 efectivo con CFDI]})` → `efectivo_sobre_15(5300)`,
`totalNoDeducible: 5300`, `totalDeducible: 0`, estatus `revisar`, con la nota
de arriba.

**Escenario con valores:** `getAcumuladoCombustible` lanza (Supabase caído, o
tenant con >100,000 cargas en el ejercicio, `repo.ts:847-850` lanza fail-loud)
→ el catch de `desde_db.ts:79-82` inyecta `{efectivo: 0, totalCombustible: 0}`
→ la liquidación de hoy declara TODO el diésel en efectivo no deducible con una
nota que afirma un exceso que nunca se midió. El estatus `revisar` salva el
rótulo general, pero la cubeta y la nota —lo que lee el PDF— son afirmaciones.
El fix de la ronda 14 (año desde los comprobantes) resolvió la frontera de
año, no este caso: `total <= 0` debería caer en la misma rama por-confirmar
que usa para `undefined`, como hace `evaluarTope15` (`periodo/combustible.ts:
77-79`) y como el comentario de `desde_db` cree que hace.

**Estado: abierto** (residual de la ronda 14 MEDIO #3, por la puerta del
contador caído).

### 3. La herramienta `cuadrar_viaje` sigue con año del reloj y SIN las claves SAT — el MEDIO #6 de la ronda 14 quedó unificado en `desde_db` y no en la tool

`src/lib/cuadra/tools.ts:104-106`:

```ts
const ejercicio = new Date().getUTCFullYear();
const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

El fix de la ronda 14 prometió "una sola barrida del ejercicio (reusa
getAcumuladoCombustible)" — y `desde_db.ts:78` la hace bien: ancla el año a los
comprobantes y le pasa `clavesCombustible`. La tool NO: (a) sigue con el año
del reloj del proceso — en enero de 2027, liquidando un viaje de diciembre de
2026, consulta el ejercicio 2027 (vacío), `evaluarTope15` devuelve
`sin_criterio` y el aviso dice "no se pudo calcular el total de combustible del
ejercicio" cuando SÍ se pudo, con el año correcto que el motor ya usó; (b) no
le pasa las claves — `getAcumuladoCombustible` sin claves filtra SOLO
`concepto='diesel'` (`repo.ts:826-828`), mientras el motor cuenta también por
`clave_prod_serv` (15101505/14/15). El escenario exacto del MEDIO #6 de la
ronda 14 sigue vivo, ahora con el denominador de la tool divergiendo del motor
en el MISMO turno de chat.

**Escenario con valores:** flota con 3 gastos de diésel por clave SAT pero
clasificados `otro` por el OCR. El motor cierra el viaje con el contador al 40%
de efectivo; el agente, en el mismo turno, consulta `cuadrar_viaje` y su capa
de periodo le reporta 55% (denominador solo-`concepto`) o "no se pudo calcular"
(frontera de año). Dos cifras para el mismo hecho en la misma conversación.

**Estado: abierto** (cierre parcial del MEDIO #6 de la ronda 14).

### 4. El panel de "Combustible & casetas" sigue ofreciendo la válvula del 15% a flotas no elegibles y sin declarar

`src/app/dashboard/contador/combustible/page.tsx:74-75`:

```ts
const tope = gastos && opts ? tope15DeGastos(gastos, opts) : null;
```

y el `ChartCard` "Efectivo en combustible contra el 15%" (líneas 128-156) se
renderiza incondicionalmente: para una flota que declaró NO calificar (o que
no declaró nada), la gráfica sigue diciendo "Todavía caben $X de combustible en
efectivo dentro del periodo sin pasarse" o "Excedente del periodo: $X" — como
si la facilidad existiera para ella. `opcionesDe(cfg)` ya trae `elegible15`
(`contador/comun.tsx:130-135`, el fix de la ronda 14) y la página computa
`opts`, pero nunca lo lee para la gráfica. La tool sí lo hace
(`tools.ts:112-115` → `avisoTope15(t, ejercicio, elegible)`), así que el
contralor ve "la flota declaró que NO califica… el efectivo no es deducible"
en el chat y "Todavía caben $X" en la misma pantalla que abre al lado.

**Confirmado empíricamente** (probe del auditor fiscal, corrida por mí):
`tope15DeGastos([2 gastos diésel efectivo $3,000], {elegible15: false})` →
`{estado: 'excedido', excedente: 2550, margen: 0}` — el panel imprimiría
"Excedente del periodo $2,550" para una flota para la que el 15% no existe.

**Estado: abierto** (el fix de la ronda 14 tocó `causasDe`/`opcionesDe`/`aviso`/
tool, no esta página).

### 5. `cubetaDe` —"LA ÚNICA definición de en qué cubeta cae un gasto"— clasifica el excedente del 15% como DEDUCIBLE

`src/lib/cuadra/cuadre/engine.ts:97`:

```ts
const NO_DEDUCIBLE_ISR: TipoDiferencia[] = ['rfc_receptor', 'cfdi_cancelado', 'cfdi_efos', 'cfdi_no_encontrado', 'complemento_hidrocarburos', 'efectivo_sobre_tope', 'efectivo_no_elegible'];
```

`efectivo_sobre_15` no está en `NO_DEDUCIBLE_ISR` (ni en `POR_CONFIRMAR`), así
que `cubetaDe` (`engine.ts:114-123`) devuelve `'deducible'` para un gasto de
diésel con CFDI cuyo excedente del 15% el propio motor acaba de declarar no
deducible. Los TOTALES se salvan porque `proporcionDeducible` (`engine.ts:321`)
compensa en `engine.ts:1111-1116` (el gasto sale con `totalDeducible += monto ×
proporcion`), pero el consumidor exportado de `cubetaDe` —el PDF,
`liquidacion/pdf.ts:374`, que arma `idsNoDeducibles` para la sección "LO QUE SE
LE REEMBOLSA AL OPERADOR" (`laboral/pagadero.ts:190-220`)— no ve el excedente:
el renglón "X no son deducibles todavía, pero el operador puso el dinero: se le
reembolsan igual" omite el dinero del 15%, y la sección entera puede
desaparecer (devuelve `null` cuando lo único no deducible es el excedente) en
un papel que dos pulgadas arriba imprime "No deducible: $5,300.00".

**Escenario con valores:** viaje con un solo gasto: diésel en efectivo $5,300
con CFDI, flota elegible, previo del ejercicio que ya agotó el 15%. La hoja
imprime "No deducible $5,300" (totales) y el excedente en "DIFERENCIAS
DETECTADAS", pero `resumenLaboral` recorre el gasto con `deducible = true`
(`pagadero.ts:190-192`) y la sección de reembolso no lo menciona. La función
que su propio comentario declara "la decisión" no conoce uno de los veredictos
de la matriz que esta misma sesión estrenó.

**Estado: abierto** (nuevo; preexistente desde `0d23f73`, no atacado por
`8a33ce1`).

## BAJO

### 6. Los veredictos del 15% siguen sin entrar en `SOLO_CONTRALOR` — BAJO #9 de la ronda 14, sin atacar

`src/lib/cuadra/cuadre/resumen.ts:24-38`: `SOLO_CONTRALOR` no incluye
`efectivo_sobre_15` ni `efectivo_no_elegible`, así que el resumen que el cierre
le manda al CHOFER (`processor.ts:1939`, `resumenCuadre(…, 'operador')`) le
enseña "la flota declaró que NO califica… no deducible" y "el excedente de $X
de ESTE comprobante NO se deduce" — decisiones de la flota que el operador no
puede arreglar, justo lo que la doctrina del propio archivo manda filtrar. El
aviso al jefe sí los clasifica (`cierre_aviso.ts:143-144`); el del chofer no.
**Estado: abierto** (la ronda 14 lo dejó listado y `8a33ce1` no lo tocó).

### 7. `efectivoDeEsteViaje` resta gastos que el contador del ejercicio nunca sumó — BAJO #10 de la ronda 14, sin atacar

`src/lib/cuadra/cuadre/desde_db.ts:84-88`: la resta del previo suma TODOS los
gastos del viaje en efectivo-diesel — duplicados incluidos (el motor los
excluye, `engine.ts:273`), montos ≤ 0 incluidos (el motor los excluye,
`engine.ts:279-282`), y gastos SIN FECHA o de otro año incluidos, que
`getAcumuladoCombustible` nunca contó (filtra por la ventana del ejercicio,
`repo.ts:829-830`). Un ticket duplicado reduce el previo y agranda el cupo del
viaje de hoy; un gasto sin fecha (el OCR no la leyó) ESCAPA del 15% por
completo — el probe P6 del auditor fiscal lo confirmó: gasto sin `fecha` →
sale de `getAcumuladoCombustible` y su monto se descuenta del previo, neto
cero contra el tope. Se autocorrige en la siguiente liquidación; hoy regala un
poquito de espacio. **Estado: abierto.**

### 8. El MEDIO #1 de la ronda 13 quedó cerrado en 1 de sus 3 sitios: `tenant-efectivo.ts` y el rail del asistente siguen tragándose el `error`

`d7b171f` arregló `resolverTenantApi` (ahora 503 si la verificación falla,
`tenant-api.ts:56-64`) — bien. Pero los otros dos sitios que la ronda 13 citó
en el MISMO hallazgo siguen con `const { data: t } = … .maybeSingle()` sin
mirar `error`:

- `src/lib/auth/tenant-efectivo.ts:121-122` — un parpadeo de red deja `data`
  null y el superadmin ve el panel de la flota DEMO con un `?tenant=<flota
  real>` en la URL, sin badge (tenantNombre null) y con `tenantExiste = true`
  (la segunda consulta también falla → `if (!error)` no se cumple y la
  bandera queda en true).
- `src/app/api/dashboard/asistente/route.ts:57-60` — el mismo patrón: el rail
  enseña los KPIs de la flota demo junto a una página que muestra otra flota;
  la cabecera de ese archivo dice que existe exactamente para impedir "dos
  verdades distintas en la misma pantalla".

**Estado: abierto** (cierre parcial del MEDIO #1 de la ronda 13). El `error`
de un `.maybeSingle()` en un bloque de superadmin es el mismo fallo-por-valor
que el repo persigue; en lectura es menos grave que en escritura (nadie escribe
en la flota equivocada), pero el rótulo "de qué flota es esta pantalla" miente
en silencio.

### 9. Cosmético: "Las 9 llaves" cuando ya son 10, en la 0082 y en la 0083

`supabase/migrations/0083_config_facilidad15_forma.sql:14` (y la 0082): el
comentario dice "Las 9 llaves de CuadraConfig" y la lista ya trae 10
(`facilidadCombustibleEfectivo` es la décima). La 0083 cumplió su función real
(la FORMA se valida: "sí"/42 rebotan) — esto es el rastro que la ronda 13 marcó
como clase de error. **Estado: abierto** (cosmético).

---

## Ronda 14, verificada en el código actual: cierres y parciales

Los abrí uno por uno contra HEAD.

- **ALTO #1 (estatus 'cuadrada' con no deducibles) — CERRADO de verdad.**
  `engine.ts:1133`: `REVISAR` ahora incluye `efectivo_sobre_15` y
  `efectivo_no_elegible`; las pruebas nuevas (`engine.test.ts:1455-1485`)
  assertan `estatus === 'revisar'` para los dos, y mi prueba temporal lo
  confirmó (estatus `revisar` con `totalNoDeducible: 5300`). `combustible_
  efectivo_dentro15` correctamente NO está (informativo).
- **ALTO #2 (IVA del efectivo en el panel) — CERRADO.** `fiscal.ts:512-514`:
  `ivaSostenible` devuelve false para `formaPago === '01' && esCombustible`, y
  `resumirFiscal` lo consume (`fiscal.ts:523-530`); el KPI "IVA acreditable
  documentado" (`contador/page.tsx:141`) ya no lo suma.
- **MEDIO #3 (año del reloj) — PARCIAL.** `desde_db.ts:60-63` ancla el año a
  `viaje.fechaInicio ?? gastos[].fecha` — el escenario de la ronda 14 (viaje de
  dic cerrado en ene) queda resuelto. Pero ver MEDIO #2 y #3 de esta ronda:
  el caso `total=0` y la tool siguen mintiendo.
- **MEDIO #4 ("sin declarar" inalcanzable) — CERRADO en el alta.** El checkbox
  sin marcar produce `undefined` (`admin/flotas/page.tsx:37-38`), `crearFlota`
  solo escribe si AMBAS son booleanos (`administracion.ts:110-115`), y la 0083
  rechaza los estados parciales `{true, null}` que la ronda 14 demostró. La
  edición existe (`actualizarFacilidad15`, `repo.ts:916-933` + selects en
  `admin/flotas/page.tsx:132-146`). Residual BAJO: filas viejas escritas con el
  alta buggy (`{false,false}`) siguen en la base clasificando como "declaró
  no" hasta que alguien las edite — y el ALTO #1 de esta ronda es el nuevo
  problema del estado `undefined`.
- **MEDIO #5 (excedente acumulado) — CERRADO.** `engine.ts:317-321` calcula
  `cupoRestante` y `excedenteDeEste` por comprobante; verifiqué a mano
  (prueba temporal): previo $1,200, tope $1,500, gastos $1,000+$1,000 →
  excedentes [700, 1000], suma 1700 = excedente real, `totalDeducible 300`. La
  prueba del commit (`engine.test.ts:1455-1465`) cubre 3×$1,000 → suma 1500.
- **MEDIO #6 (tres contadores) — PARCIAL.** `desde_db` reusa
  `getAcumuladoCombustible` con las claves (un solo criterio motor/desde_db) —
  pero la tool no (MEDIO #3 de esta ronda) y el panel mantiene su ventana de
  periodo con rótulo honesto ("Ojo con el rango… mide ese mes, no el año",
  `combustible/page.tsx:169-171`).
- **BAJO #7 (0082 sin forma) — CERRADO.** La 0083 valida forma, contenido y
  las dos condiciones; aplicada en la base real (la síntesis lo confirma y el
  UPDATE del demo sobrevive).
- **BAJO #8 (sin edición) — CERRADO** (ver MEDIO #4).
- **BAJO #9 (SOLO_CONTRALOR) — ABIERTO** (BAJO #6 de esta ronda).
- **BAJO #10 (efectivoDeEsteViaje) — ABIERTO** (BAJO #7 de esta ronda).

**Ronda 13, los 7 de backend — 6 cerrados, 1 parcial:**

- `resolverTenantApi` revisa `error` → 503 — CERRADO, con los dos export
  consumiendo `t.status` directo (`export/liquidaciones/route.ts:26`,
  `export/pdf/[id]/route.ts:41`). Los otros dos sitios del mismo hallazgo
  siguen abiertos (BAJO #8 de esta ronda).
- Export con desempate único — CERRADO: `.order('created_at').order('id')`
  (`export/liquidaciones/route.ts:70`), y el resto de `traerTodo` del repo
  sigue el contrato (los nuevos llamadores de `d7b171f` también: `pendientes.
  ts:128-132`, `listarSolicitudesArco` con `.order('recibida_en').order('id')`).
- `getPorFacturar` sin recorte — CERRADO: `traerTodo` con `conteo` y desempate;
  los dos llamadores agarran la excepción (`cron/facturar/route.ts:205-216`
  try/catch por tenant, `documentos/page.tsx:83` en server action con
  `mensajeParaPantalla`). Un aviso que no sale por `LecturaIncompleta` se dice,
  no se recorta.
- El rechazo del PDF le habla al chofer — CERRADO: `processor.ts:2136-2142`
  manda texto "Tu liquidación ya quedó cerrada ✅… pídeselo a tu contralor".
- Alta de usuario valida el rol — CERRADO: `admin/usuarios/nuevo/page.tsx:34-37`
  rechaza `superadmin` y `operador` antes de `provisionarUsuario`.
- Comentario muerto de `meta/client.ts` — CERRADO: el comentario ahora cita los
  call sites reales y su manejo.
- Route-test del webhook de Stripe — CERRADO: `stripe/webhook/route.test.ts`
  cubre sin-secreto 503, firma 401, nuevo 200, repetido 200+`repetido:true`,
  500+desmarcado; la ruta (`stripe/webhook/route.ts`) firma el cuerpo crudo y
  desmarca antes del 500 para que el reintento de Stripe pueda volver a aplicar.

## Lo que revisé y está bien

- **La matriz 2.9 en el motor, tras el fix**: excedente por comprobante,
  proporción nunca negativa ni dependiente del orden (verificado con dos
  escenarios a mano), `SIN_ACREDITAMIENTO` completo (`engine.ts:963` incluye
  los cuatro tipos del efectivo), `REVISAR` con los no deducibles, y las
  cubetas suman el comprobado (`filasDeducibilidad` los valida con tolerancia
  de un centavo).
- **`desde_db` fail-cerrado en lo que importa**: el contador del ejercicio
  está en try/catch (un fallo no tumba la liquidación), el ancla del año es la
  de los comprobantes, y `getAcumuladoCombustible` conserva el `count` exacto,
  el desempate por `id` y el throw fail-loud cuando la lectura queda corta.
- **La 0083**: valida la FORMA (objeto, dos booleanos o `null`), rebota los
  estados parciales, y está exenta de `verificaciones.sql` con razón escrita
  (`migraciones_verificadas.test.ts`).
- **El aviso de cierre** (`cierre_aviso.ts:141-144`) clasifica bien los
  veredictos nuevos (`panel`/`decision`) y el `RUTA_DE_DIFERENCIA` es
  exhaustivo — los tipos nuevos romperían la compilación si alguien los
  olvidara.
- **Las 3 superficies de elegibilidad que SÍ se arreglaron**: `causasDe` ya no
  ofrece la válvula a `false` (el ALTO #1 de esta ronda es el caso `undefined`),
  `avisoTope15` con `elegible` distingue los tres estados y tiene rama honesta
  para `sin_criterio`, y la tool pasa la elegibilidad al aviso.
- **Los 7 de la ronda 13**, con las salvedades del BAJO #8.
- **Corridas del rubro**: 422 + 367 + 300 + 308 = 1,397 pruebas, verdes en
  primera pasada. `tsc` limpio salvo dos errores en archivos `zzz-*` SIN
  trackear de otro auditor (ruido de la sesión paralela, no del repo).

## Lo que no alcancé a revisar

- La pantalla ARCO de cumplimiento a fondo (rubro legal) — aquí solo verifiqué
  que las dos funciones nuevas del repo son tenant-scoped y usan `traerTodo`
  con desempate.
- El motor agéntico (guardia, memoria) — rubro tool-calling/agentico; hay
  probes de ese auditor en el árbol (untracked) que confirman que sus
  hallazgos siguen vivos, pero no son de este rubro.
- Confirmación contra Postgres real de la 0083 en la base de producción (la
  síntesis lo declara; no toco la base). Las filas viejas con el alta buggy
  (`{false,false}`) quedan sin verificar — solo SQL las mostraría.
- El render de las páginas del contador (rubro frontend): el ALTO #1 es
  verificable en la función y en el dato, no necesitó screenshot.

## Veredicto

**Green light CONDICIONADO para backend** (la ronda 14 fue "NO"; esta sube
porque la deuda se pagó: los dos ALTOS de la ronda 14 están cerrados de
verdad, verificados con prueba propia, y los 7 de la ronda 13 también). El
condicionante es el ALTO #1 de esta ronda: el fix que alineó el panel con el
motor sembró la contradicción opuesta — para toda flota SIN declarar, la
pantalla del contador afirma "Ya no se recupera $X" sobre dinero que el motor
tiene en "por confirmar". Es una línea de código (`fiscal.ts:337`), no rompe el
guion del demo (la flota demo declaró `true` y su diésel precargado es
transferencia `'03'`), pero es la misma familia que este rubro lleva cinco
rondas persiguiendo, recién re-sembrada por el propio cierre. A eso se suman
los cierres a medias que el mensaje del commit promete como totales ("una sola
barrida" sin la tool; "marca para revisar" sin rama) — la lección de esta
ronda: los fixes de la 14 fueron reales, pero dos de sus comentarios describen
un comportamiento que el código no tiene, y la próxima ronda debe verificar
esos dos puntos contra el comportamiento, no contra el comentario.
