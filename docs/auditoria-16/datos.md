# Modelo de datos y esquema — auditoría 16

**Nota: 7/10** (se mantiene en el 7 de la ronda 15, con el mismo movimiento
pendular de las rondas anteriores: la 15 atacó sus DOS MEDIOs, uno quedó
cerrado de verdad y el otro a medias, pero el fix del primero metió al rubro un
MEDIO NUEVO por regresión — el previo del 15% se contamina más que antes cuando
el viaje mezcla ejercicios). Sube de hecho: la guardia `total=0` del motor
(`engine.ts:306-329`) está y tiene 3 pruebas, y `causasDe` ya no pinta "sin
declarar" como "deducción perdida". No sube más porque: (1) la guardia nueva
dejó de sumar al acumulado los gastos de otro ejercicio pero `efectivoDeEsteViaje`
(`desde_db.ts:84-87`) SIGUE restándolos del previo — el PDF ahora imprime
"el ejercicio lleva $3,000.00 de $20,000.00 (15%)" cuando el ejercicio real
lleva $8,000 (40%), una cifra fiscal falsa que antes de la 15 salía correcta
para el gasto del mismo ejercicio; (2) la mitad de `causasDe` que la 15 no tocó
(`efectivo_no_elegible` fuera de `ORDEN`) sigue haciendo que la gráfica "por
causa" no explique el dinero perdido de una flota no elegible; y (3) la feature
nueva de la 16 (ARCO en /dashboard) entró con una server action que resuelve
solicitudes sin re-chequear el rol — el encargado, que la RLS de la 0053
excluye de `solicitud_arco`, puede resolver y mandar por WhatsApp la respuesta
ARCO de la flota. La vara del rubro sigue igual: esquema y consumidores deben
sostener que el PDF archivado y la base dicen lo mismo para siempre, que ningún
rol ve/escribe lo que la RLS le niega, y que cada fix nuevo se comprueba contra
el caso que el fix anterior dejó a medias.

Anclado a `c9012269a52c377d61375562274b93069235ba98` (`git rev-parse HEAD` al
empezar). Sin acceso a Postgres en esta sesión: toda la verificación es lectura
línea por línea de `src/lib/cuadra/{cuadre/desde_db.ts,cuadre/engine.ts,fiscal.ts,repo.ts,tools.ts,periodo/combustible.ts}`,
`src/lib/meta/client.ts`, `src/app/dashboard/arco/page.tsx`,
`src/lib/auth/{visibilidad.ts,guard.ts}`, `supabase/migrations/` (0049, 0050,
0053, 0078, 0082, 0083), `supabase/seed.sql` y `supabase/verificaciones.sql`.
Lo que necesitaría base real para confirmar está dicho como tal. Pruebas
corridas en esta sesión: `engine.test.ts` 117, `fiscal.test.ts` 57,
`repo_acumulado` 5, `periodo/combustible` 15, `aviso` 6, `config*` 19,
`repo_escritura` 11, `repo_operadores` 5, `migraciones_verificadas` 4 — todas
verdes. No corrí la suite completa (instrucción: otro auditor la corre).

**Verificación del cierre de la ronda 15 (el encargo explícito).** Abro cada
uno de los hallazgos de `docs/auditoria-15/datos.md` contra el código actual:

- **MEDIO #1, el motor sin guardia de `total=0` → CERRADO, verificado.**
  `engine.ts:306-329` tiene la rama `if (!mismoEjercicio || !(total > 0))` que
  manda el gasto a `combustible_efectivo` con monto 0 y la nota honesta
  ("no se pudo calcular… No se afirma deducible ni no deducible"), y las 3
  pruebas nuevas de `engine.test.ts:1524-1560` verifican: contador caído →
  `totalPorConfirmar` y NO `efectivo_sobre_15`, comprobante de otro ejercicio →
  por confirmar, y la nota sin "NO se deduce". El gasto guardado cae a
  `POR_CONFIRMAR` (`engine.ts:101`), no acredita IVA (`combustible_efectivo`
  en `SIN_ACREDITAMIENTO`, `engine.ts:985`) y no entra a `totalNoDeducible`
  (`engine.ts:1116`). **Pero** el fix dejó una regresión que es el MEDIO #1 de
  esta ronda (abajo): `efectivoDeEsteViaje` sigue restando del previo los
  gastos que la guardia ya no deja sumar.
- **MEDIO #2, `causasDe` colapsando "sin declarar" con "declaró que NO" →
  CERRADO en su afirmación principal, NO en su segunda mitad.**
  `fiscal.ts:338-339` ahora hace `if (o.elegible15 === false)
  push('efectivo_no_elegible'); else push('combustible_efectivo')`: el
  `undefined` cae a `combustible_efectivo` (`en_riesgo`), que es lo que el
  motor mantiene por confirmar. **Pero** la segunda mitad que la propia 15
  reportó ("`efectivo_no_elegible` NO está en `ORDEN`… la gráfica 'por causa'
  lo filtra y la causa nunca aparece") NO se tocó: `ORDEN` (`fiscal.ts:354-356`)
  sigue sin la causa. Y la rama nueva no tiene ni una prueba: `fiscal.test.ts`
  construye `OPTS` con `elegible15: true` siempre (línea 31) y el único `grep`
  de `efectivo_no_elegible` en el archivo es un comentario. Es el MEDIO #3
  abajo.
- **MEDIO→BAJO, el contador en bucle de páginas → sigue abierto en el costo.**
  `repo.ts:803-864` sigue siendo la suma en cliente de páginas de 1,000 con
  `MAX_PAGINAS = 100`; el comentario de la línea 807-808 lo declara ("necesita
  un `sum()` en SQL… se corta y se dice"). Nadie lo reescribió. No es
  regresión: es la deuda que la 15 dejó anotada.
- **BAJO #4, `getGastos` sin ORDER BY → sigue abierto.** `repo.ts:556-562`
  termina en `.eq('viaje_id', viajeId)` sin `.order()`. La atribución por
  renglón del excedente del 15% sigue dependiendo del orden de Postgres
  (re-verificado abajo).
- **BAJO #5, `efectivoDeEsteViaje` sin filtro de año → sigue abierto y ahora
  es un MEDIO por regresión del fix de la 15** (MEDIO #1 abajo).
- **BAJO #6, `accionFacilidad` borrando la declaración entera → sigue abierto.**
  `repo.ts:929-933` mantiene `if (ded !== undefined && reg !== undefined) { …
  } else { delete actual.facilidadCombustibleEfectivo; }`; el formulario
  (`flotas/page.tsx`) sigue con los dos selects independientes con "—".
- **BAJO #7, la tool de periodo con criterio/año distintos → CERRADO a
  medias.** El año ya es el del viaje (`tools.ts:107-108`, con `getViaje`),
  verificado. **Pero** la tool sigue sin pasar `claves` a
  `getAcumuladoCombustible` (`tools.ts:109`): el criterio de la tool
  (`concepto.eq.diesel` a secas) sigue divergiendo del motor y de
  `desde_db.ts:78` (que sí pasa `clavesCombustible`). BAJO abajo.
- **BAJO #8, `.catch(() => null)` del operador → sigue abierto.**
  `desde_db.ts:44` intacto.
- **BAJO #9, XML del demo → sigue abierto, los 4 números intactos**
  (`seed.sql:145`), re-verificados abajo.
- **BAJO #10, cabecera de `verificaciones.sql` → sigue abierto.**
  `verificaciones.sql:15` sigue diciendo "Última corrida: **31-jul-2026**" y
  los bloques 54 (`:3039`), 55 (`:3048`) y 56 (`:3115`) siguen diciendo
  "Corrida real esperada:" sin la salida.
- **BAJO #11, drift 0082/0083 → sigue abierto.** La 0082 (`:6-8`) y la 0083
  (`:6-7`) repiten "El trigger 0026 validaba" (la 0026 crea un CHECK) y "Las 9
  llaves" con 10 entradas en `llaves_ok`.
- **BAJO #12, `tenant_self` → sigue abierto.** `0078:56-58` intacto: el
  operador sigue pudiendo leer `tenant.config` con la anon key.
- **BAJO #13, `factura_viaje` → sigue abierto.** `0049:150-159` sigue
  validando solo el lado `factura_id`.

## Hallazgos

### [MEDIO, abierto] Regresión de la 15: `efectivoDeEsteViaje` sigue restando del previo los gastos que la guardia nueva ya no deja sumar — el PDF imprime "el ejercicio lleva $3,000.00 (15%)" cuando el ejercicio real lleva $8,000 (40%) y el excedente desaparece

`src/lib/cuadra/cuadre/desde_db.ts:84-87`:

```ts
const efectivoDeEsteViaje = gastos
  .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
  .reduce((s, g) => s + Number(g.monto ?? 0), 0);
const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
```

Sin filtro de ejercicio (y sin filtro de `fecha` a secas). El contador
(`repo.ts:828-831`) filtra `gte/lte` dentro del año y EXCLUYE los gastos sin
fecha; `efectivoDeEsteViaje` resta todo lo que el contador no contó. Antes de
la 15 el error se autocompensaba: el gasto de otro ejercicio se restaba del
previo PERO el motor lo sumaba al acumulado (`efectivoAcumuladoEjercicio`), así
que el total impreso "el ejercicio lleva $X" salía correcto para los gastos
posteriores. La guardia de la 15 (`engine.ts:312-329`) hace `continue` ANTES de
sumar al acumulado — y la resta de `desde_db.ts` quedó sin su contraparte.

**Escenario con valores.** Flota elegible `{true,true}`. Viaje `VJ-2026-0850`
inicia 2026-01-04 (la ventana de `ventanaDelViaje` admite gastos hasta 30 días
antes). Gastos del viaje: A = diésel en efectivo $5,000 fechado 2025-12-29
(otro ejercicio), B = diésel en efectivo $3,000 fechado 2026-01-02. Contador
2026 real (DB): `total = 20,000`, `efectivo = 8,000` (incluye a B y a $5,000 de
otras liquidaciones; A no está: es de 2025).

- `efectivoDeEsteViaje` = 5,000 + 3,000 = **8,000** → `efectivoPrevEjercicio` =
  max(0, 8,000 − 8,000) = **0**. El previo real es **5,000**.
- Motor: A → `!mismoEjercicio` → `combustible_efectivo`, por confirmar, monto 0
  (correcto). B → `previoSinEste = 0`, `tope = 0.15 × 20,000 = 3,000` →
  `dentro = 3,000`, excedente 0 → nota impresa:
  *"Diesel pagado en EFECTIVO — deducible por la facilidad del 15%… el
  ejercicio lleva **$3,000.00** de **$20,000.00** de combustible en efectivo
  (**15%** del total, tope 15%)"*.
- Verdad: el ejercicio lleva **$8,000 (40%)**, ya excedido desde antes de este
  viaje (previo $5,000 > tope $3,000). El excedente de **$5,000** que debería
  marcarse "NO se deduce" no aparece en ninguna diferencia; B sale "deducible
  por la facilidad".

El PDF archiva una afirmación fiscal falsa (15% cuando es 40%, y "deducible"
cuando es excedente), en la dirección que nadie revisa (a favor de la flota,
no en contra). La variante sin fecha: un gasto de $5,000 sin `fecha` tampoco
está en el contador (excluido por `gte`), sí está en `efectivoDeEsteViaje`, y
con `mismoEjercicio = true` (`engine.ts:313`: `!anioComprobante`) sí corre
contra el tope — el previo se subestima igual (lo probó en paralelo otro
auditor: el total impreso neto queda bien porque el sin-fecha sí se suma, pero
la asignación por comprobante del cupo se corre).

El fix mínimo es el que la 15 ya pidió: filtrar `efectivoDeEsteViaje` por el
mismo año del ancla (`g.fecha?.slice(0,4) === anioEjercicio`), y decidir qué
hacer con el sin-fecha (hoy corre contra un tope cuyo contador no lo incluye).
**Estado: abierto** — y es una REGRESIÓN de la 15: antes el total impreso de B
era correcto (40%) y el excedente se marcaba (mal atribuido, pero marcado);
ahora el total y el excedente son ambos falsos, en silencio, sin log.

### [MEDIO, abierto] ARCO en /dashboard: la server action resuelve solicitudes sin re-chequear el rol — el encargado (que la RLS de `solicitud_arco` excluye) puede marcar resuelta y mandar la respuesta por WhatsApp

`src/app/dashboard/arco/page.tsx:30-39`:

```ts
async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const s = await requireSessionTenant(RUTA);
  ...
  const r = await resolverSolicitudArco(s.tenantId, solicitudId, resolucion);
```

`requireSessionTenant` (`guard.ts:27-39`) devuelve cualquier sesión con
`tenantId` — incluye al `encargado`. La página está clasificada como
`operacion` (`visibilidad.ts:76`), y `AREAS_POR_ROL` da `operacion` al
`encargado` (`visibilidad.ts:34-37`); el test `visibilidad.test.ts` ni siquiera
la lista en `PROHIBIDAS`. La RLS de la tabla dice lo contrario:
`solo_admin_flota` usa `administra_flota()` = superadmin y flota_admin SOLO
(`0050:25-39` — la función y su comentario: "Ni el contador ni el encargado"), y
`0053:192-193` cierra `solicitud_arco` con esa misma función. Pero la escritura
va por `supabaseAdmin()` (service role, `repo.ts:985-990`): la RLS no protege
nada, y la server action no repite el chequeo — el patrón que CLAUDE.md exige
("server actions que repiten el chequeo de permiso adentro",
`dashboard/[id]/page.tsx:59-66`) no se aplicó. La acción de /admin SÍ
re-chequea (`compliance/page.tsx:26`: `await requireSuperadmin()`); la de
/dashboard no.

**Escenario con valores.** Flota con una solicitud ARCO de un operador
(estado `recibida`, vence en 20 días hábiles). El encargado (jefe de tráfico)
abre `/dashboard/arco` (el sidebar se la pinta), ve el formulario "Responder",
teclea una resolución de 5+ caracteres y envía. `resolverSolicitudArco`
escribe `estado='resuelta'`, `resuelta_en`, `resolucion` y dispara
`enviarRespuestaArco` al teléfono del titular con "Tu solicitud de derechos
ARCO fue atendida por la empresa: …". Efecto: un puesto que la base excluye
expresamente de `solicitud_arco` ejecutó el acto legal de responder un derecho
ARCO en nombre de la responsable, y el titular recibió por WhatsApp un mensaje
que compromete a la flota. No es dinero, pero es el tipo de escritura que la
RLS existe para impedir y que el patrón del repo manda re-chequear. Sin prueba
alguna (no hay un solo test de `resolverSolicitudArco` ni de la página).
**Estado: abierto** (el fix es un `exigirAdministraFlota` o equivalente dentro
de `accionResponder`; y una prueba que falle si el encargado la alcanza).

### [MEDIO, abierto] `efectivo_no_elegible` sigue fuera de `ORDEN`: la gráfica "por causa" no explica el dinero perdido de una flota no elegible — la mitad sin cerrar del MEDIO #2 de la 15

`src/lib/cuadra/fiscal.ts:354-356`:

```ts
const ORDEN: CausaPerdida[] = [
  'efos', 'cfdi_cancelado', 'plazo_vencido', 'efectivo_sobre_tope',
  'efos_indeterminado', 'combustible_efectivo', 'sin_cfdi',
];
```

`resumirPerdidas` suma `efectivo_no_elegible` a `montoPerdido`
(`fiscal.ts:417-418`, vía la dominante que cae al `cs[0]` de `causaDominante`)
pero `porCausa` se construye con `ORDEN.filter((c) => porCausaMapa.has(c))`
(`fiscal.ts:429-438`): la causa no está en `ORDEN`, el desglose la omite.

**Escenario con valores.** Flota que declaró `{dedicacionExclusivaCarga: false,
regimenElegible: true}` → el motor la trata como no elegible
(`desde_db.ts:56-61`, `engine.ts:359-365`: `efectivo_no_elegible`, monto
completo, "no deducible"). En el periodo tiene $4,200 de diésel en efectivo con
CFDI vigente. La pantalla del contador (`contador/deducciones/page.tsx`):
`montoPerdido = 4,200`, fila con título "Combustible en efectivo sin facilidad",
pero la sección "Por causa" (`page.tsx:194-205`) no existe — `resumen.porCausa`
es `[]` — o, si hay otras causas, muestra las otras sin la del efectivo. El
contador ve "Perdido: $4,200" y la gráfica que promete "Cuánto pesa cada causa"
no pesa nada de eso. El comentario del fix de la 15 ("Mismo estándar que el
motor") arregló el colapso de los tres estados pero dejó sin renglón la causa
que sí es pérdida. Sin prueba: la rama `elegible15 === false` (y la
`undefined`) de `causasDe` no tiene cobertura en `fiscal.test.ts` (el `OPTS`
de la línea 31 es `elegible15: true` siempre). **Estado: abierto** (una línea
en `ORDEN` más una prueba con `elegible15: false`).

### [MEDIO→BAJO, abierto en el costo] El contador del 15% sigue siendo un bucle de páginas secuenciales dentro del paso que `presupuesto.ts` tasa en 300 ms (heredado de la 15, re-verificado)

`src/lib/cuadra/repo.ts:803-864` — sin cambios. `getAcumuladoCombustible` sigue
sumando en cliente con `.range(leidas, leidas+999)` hasta 100 vueltas, y ahora
corre dentro de TODOS los `cuadrarDesdeDB` (`tools.ts:79`, la guardia del
processor, el cierre, `analytics.ts`) y de la tool de periodo. El propio
comentario (`repo.ts:807-808`) lo declara: "Un tenant que las pase no necesita
más vueltas, necesita que esto sea un `sum()` en SQL". **Estado: cerrado en el
modo de fallo (fail-closed con log, `repo.ts:861-863`); abierto en el costo.**
Para el demo no duele (2 filas, 1 página).

### [BAJO, abierto] `getGastos` sigue sin ORDER BY — la atribución del excedente del 15% depende del orden que Postgres devuelva (heredado, re-verificado)

`src/lib/cuadra/repo.ts:556-562`: `.eq('tenant_id', tenantId).eq('viaje_id',
viajeId)` y nada más. El motor acumula el efectivo del viaje en el orden de
`input.gastos` (`engine.ts:311-326`).

**Escenario con valores.** Viaje con dos diésel en efectivo A=$100 y B=$80;
previo del ejercicio $0; total del ejercicio $1,000 → tope $150.
- Orden A,B: A cabe (cupo 150 → 100%). B: previo 100 → cupo 50 → excedente 30.
- Orden B,A: B cabe (cupo 150 → 80%). A: previo 80 → cupo 70 → excedente 30.

El total del excedente ($30) y `totalNoDeducible` son invariantes — por eso
BAJO —, pero el PDF marca un renglón distinto como "parcialmente no deducible"
en cada corrida y el acreditamiento proporcional del IVA (`engine.ts:1024-1026`)
cae sobre comprobantes distintos. El tope de alimentación ya comenta "no
depende del ORDEN del arreglo" (`engine.ts:1100`); la frontera del 15% no.
Una línea: `.order('fecha, id')` en `getGastos`. **Estado: abierto.**

### [BAJO, abierto] La tool de periodo ya usa el año del viaje pero sigue sin pasar las claves del SAT: dos contadores con dos criterios (la mitad del BAJO #7 de la 15)

`src/lib/cuadra/tools.ts:107-109`:

```ts
const viajeCtx = await getViaje(ctx.viajeId, ctx.tenantId).catch(() => null);
const ejercicio = viajeCtx?.fechaInicio ? Number(viajeCtx.fechaInicio.slice(0, 4)) : new Date().getUTCFullYear();
const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

El año ya es el del viaje (fix de la 15, verificado) pero la llamada NO pasa
`claves`, y sin ellas `getAcumuladoCombustible` cae a `concepto.eq.diesel`
(`repo.ts:830`). El motor y `desde_db.ts:78` sí pasan las claves del tenant.

**Escenario con valores.** Flota que paga gasolina (clave 15101514) en efectivo
además de diésel: el motor la cuenta, la tool no. El aviso por WhatsApp dice
"vas en 8%, te quedan $3,000" mientras el PDF de la misma liquidación dice "el
ejercicio lleva $X… 14.8%". El comentario del fix de la 15 dice haber eliminado
la divergencia ("dos barridos con dos criterios"); eliminó el año, no el
criterio. **Estado: abierto** (dos líneas: `getConfig` + pasar `claves`).

### [BAJO, abierto] `accionFacilidad` con una casilla en "—" borra la declaración ENTERA y el mensaje dice "actualizada" (heredado, re-verificado)

`src/lib/cuadra/repo.ts:929-933`: `if (ded !== undefined && reg !== undefined)
{ … } else { delete actual.facilidadCombustibleEfectivo; }`. Si el admin
corrige solo "Régimen: No" dejando "Carga: —", `ded` es `undefined` y la rama
`else` borra la llave completa: la flota queda "sin declarar" y todo su diésel
en efectivo pasa de deducible-con-contador a "por confirmar", sin rastro en
pantalla. La 0083 no lo atrapa (borrar la llave es legal). El fix de la 15
comprobó el error de LECTURA (bien), no la semántica de la escritura parcial.
**Estado: abierto.**

### [BAJO, abierto] `desde_db.ts:44` — `.catch(() => null)` sigue enmascarando el fallo de lectura del operador (heredado, re-verificado)

`src/lib/cuadra/cuadre/desde_db.ts:43-45`: el `getOperador(...).catch(() =>
null)` está intacto. Un entorno sin la 0080 liquidaría todo el día con viáticos
"a revisión" y la única pista sería la nota del PDF; el ruido del error es
diagnóstico y este catch lo silencia. **Estado: abierto.**

### [BAJO, abierto] El XML del diésel del demo sigue sin cuadrar internamente y sigue predatado — es el CFDI que mañana se enseña como "deducible y ACREDITABLE" (heredado, re-verificado)

`supabase/seed.sql:145` — los cuatro números intactos desde la 15:
- `Cantidad="113.00" ValorUnitario="28.41" Importe="3210.00"` — 113 × 28.41 =
  **3210.33**, no 3210.00.
- `Base="3210.00" Impuesto="003" TasaOCuota="6.1740" Importe="408.62"` — 3210 ×
  0.06174 = **198.19**, no 408.62; y como CUOTA por litro (TipoFactor="Cuota"),
  113 × 6.1740 = **697.66**, tampoco 408.62. Ninguna de las dos lecturas da el
  importe declarado.
- `Base="3618.62" Impuesto="002" TasaOCuota="0.160000" Importe="581.38"` —
  3618.62 × 0.16 = **578.98**, no 581.38 (el 581.38 se despejó para que
  SubTotal+IEPS+IVA = Total 4,200).
- `Fecha="2026-05-15T09:14:00"` — tres meses antes del gasto
  (`current_date-1`) y del viaje; el TFD timbra a las 09:14:05.

El parser de la app suma los `Importe` declarados sin multiplicar base×tasa,
así que la demo no lo ve; el riesgo es el de la sala: el respaldo del
comprobante que el guion presenta delante de un contador con calculadora.
**Estado: abierto.**

### [BAJO, abierto] La cabecera de `verificaciones.sql` sigue diciendo 31-jul y los bloques 54-56 no traen estampa (heredado, re-verificado)

`supabase/verificaciones.sql:15` — "Última corrida: **31-jul-2026**"; los
bloques 54 (`:3039`), 55 (`:3048`) y 56 (`:3115`) dicen "Corrida real
esperada:" sin salida. La garantía "cada migración se comprueba contra Postgres
real" depende de que esta bitácora sea creíble; hoy su primera afirmación está
vencida. **Estado: abierto** (una línea por corrida).

### [BAJO, abierto] La 0082 y la 0083 siguen con el drift: "El trigger 0026" cuando es un CHECK, y "Las 9 llaves" cuando son 10 (heredado, re-verificado)

`0082:6-8` y `0083:6-7`: "El trigger 0026 validaba las llaves de la config" —
la 0026 crea un CHECK (`tenant_config_valida`), no un trigger; y "Las 9 llaves
de `CuadraConfig`" con `llaves_ok` de 10 entradas. La 0083 copió el drift del
archivo que corrige. **Estado: abierto** (cuatro palabras en dos archivos).

### [BAJO, abierto] `tenant_self` sigue dejando que el chofer lea `tenant.config` (heredado, re-verificado)

`0078:56-58`: `tenant_self` sigue con `using (id = any(get_user_tenant_ids())
or is_superadmin())` y `get_user_tenant_ids()` (0001) incluye al `operador`.
Con sesión web + anon key, un chofer lee la política completa (topos de diésel,
caseta, alimentación) contra la que el motor decide `sobre_politica` en su
propia liquidación. La 0079 acotó `app_user` con `not is_operador()`; a
`tenant` no se le aplicó el mismo brazo. **Estado: abierto.**

### [BAJO, abierto] `factura_viaje` sigue sin FK compuesta ni candado del lado `viaje_id` (heredado, re-verificado)

`0049:150-159`: la policy valida solo el lado `factura_id`; un `ve_finanzas`
de A puede insertar `{factura_id: <factura de A>, viaje_id: <viaje de B>}`.
Sin consumidor en la app todavía — hueco latente. **Estado: abierto** (una
línea cuando la tabla tenga su primer INSERT).

### [BAJO, abierto] ARCO: el fallback de teléfono cae a `operador_id` (un UUID), que nunca es un número de WhatsApp (nuevo, ronda 16)

`src/lib/cuadra/repo.ts:994`:

```ts
const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;
```

Hoy el único canal que registra solicitudes es WhatsApp y `titularRef` es el
teléfono (`processor.ts:157-163`), así que el fallback no se dispara en el
camino actual; pero si `titular_ref` es null (un insert manual, un canal web
futuro, una supresión), `destinatarioWhatsApp('33333333-0000-…')`
(`client.ts:70-73`) devuelve los 32 dígitos del UUID y Meta responde 400: la UI
dice "NO se pudo enviar (HTTP 400)". Fallo honesto, pero el fallback es
basura: un UUID jamás es un número. **Estado: abierto** (devolver
`enviada: false` con "sin teléfono" si `titular_ref` no parece teléfono).

### [BAJO, abierto] La plantilla `respuesta_arco` recibe `'la flota'` como {{1}} en vez de la razón social que su propio comentario promete (nuevo, ronda 16)

`src/lib/meta/client.ts:467`:

```ts
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```

El comentario de `client.ts:458-462` dice que la plantilla "lleva {{1}} =
razón social de la flota"; el código manda el literal `'la flota'`. Cuando Meta
apruebe la plantilla, la respuesta ARCO entregada —evidencia legal de la
respuesta al titular— nombrará "la flota" y no a la responsable. `resolverSolicitudArco`
tiene el `tenantId` a la mano para consultar `tenant.razon_social`; no lo hace.
Hoy no se materializa (plantilla en revisión, el envío falla cerrado con el
mensaje honesto), por eso BAJO. **Estado: abierto.**

### [BAJO, abierto] ARCO en /dashboard: `listarSolicitudesArco(tenantId).catch(() => [])` — con la base caída la página afirma "Ninguna solicitud ARCO registrada" y "Por responder: 0" (nuevo, ronda 16)

`src/app/dashboard/arco/page.tsx:47`: `const solicitudes = await
listarSolicitudesArco(tenantId).catch(() => []);`. `listarSolicitudesArco`
lanza `LecturaIncompleta` si no puede probar que leyó todo (`repo.ts:943-971` +
`pg.ts:137`); el `.catch` lo convierte en "no hay solicitudes". La página
entonces pinta `Por responder: 0` y "Ninguna solicitud ARCO registrada" —
afirmaciones positivas sobre datos que no se leyeron, en una pantalla cuyo
propósito es vigilar un plazo legal de 20 días hábiles. Es exactamente el
antipatrón que CLAUDE.md prohíbe ("una base caída se lee como 'no hay nada'") y
que `dashboard/pendiente.tsx` resuelve con `EstadoVacio` explicando qué falta.
El mismo patrón existe en `admin/compliance/page.tsx` (heredado); la página
nueva lo copió. **Estado: abierto** (devolver el error al UI y decir "no se
pudo leer — inténtalo de nuevo", no el estado vacío).

### [BAJO, abierto] ARCO en /dashboard: la vista cross-tenant del superadmin siempre falla al responder — la server action resuelve contra `tenantDemo`, no contra la flota que se está viendo (nuevo, ronda 16)

`arco/page.tsx:34`: `resolverSolicitudArco(s.tenantId, …)` con `s =
requireSessionTenant(RUTA)`. Para un superadmin, `requireSessionTenant` devuelve
`tenantDemo()` (`guard.ts:31-33`) aunque la página esté resolviendo
`?tenant=<flota X>` vía `resolverTenantEfectivo` (`tenant-efectivo.ts:90-97`).
El formulario "Responder" de esa vista llama a `resolverSolicitudArco(
tenantDemo, solicitudId, …)` → `.eq('tenant_id', tenantDemo)` no encuentra la
solicitud → "la solicitud no existe en esta flota". Falla cerrado y con mensaje
confuso, sin corromper nada; es la misma familia del `dashboard/sufijo.ts`.
**Estado: abierto** (pasar el `tenantId` resuelto a la server action).

## Lo que revisé y está bien

- **La guardia de la 15, línea por línea, y sus pruebas.** `engine.ts:306-329`
  distingue el fallo del contador (`total <= 0`) del comprobante de otro
  ejercicio (`mismoEjercicio`), con notas distintas y honestas; el gasto
  guardado cae a `combustible_efectivo` monto 0, va a `POR_CONFIRMAR`
  (`engine.ts:101`), no acredita IVA (`SIN_ACREDITAMIENTO`, `engine.ts:985`) ni
  IEPS, y no entra a `totalNoDeducible` (`engine.ts:1116`). Las 3 pruebas
  nuevas (`engine.test.ts:1524-1560`) cubren el contador caído, el comprobante
  de otro ejercicio y la nota sin "NO se deduce". Corridas: verdes.
- **`causasDe` con el tri-estado.** `fiscal.ts:338-339`:
  `false` → `efectivo_no_elegible` (perdida), resto → `combustible_efectivo`
  (en_riesgo). El panel de combustible (`contador/combustible/page.tsx:155-168`)
  ahora distingue las tres ramas (declaró que NO / sin declarar / con
  contador) y el `Gauge` sigue en 0-100. La consistencia motor↔panel para
  `undefined` quedó — salvo la gráfica `porCausa` (MEDIO #3).
- **La tool con el año del viaje.** `tools.ts:107-108` ancla el ejercicio al
  `fechaInicio` del viaje, no al reloj del proceso; `desde_db.ts:63-66` usa el
  mismo ancla. La divergencia de año quedó cerrada (queda la de criterio, BAJO
  arriba).
- **`actualizarFacilidad15` comprueba la lectura.** `repo.ts:926-927`: el error
  del SELECT ahora lanza; un bache de red ya no reemplaza la config entera por
  una llave. El UPDATE sigue comprobando su error (`repo.ts:934-935`).
- **El cierre ARCO de /admin.** `compliance/page.tsx` re-chequea
  `requireSuperadmin()` en la acción (`:26`), ve TODAS las flotas con columna
  (`:95-99`) y su mensaje ya no miente ("se entrega por el canal que la flota
  defina"). El CRÍTICO de la 15 (tenant null → siempre vacío) está cerrado y
  verificado.
- **`resolverSolicitudArco` está acotada al tenant.** La lectura y el UPDATE
  llevan `.eq('tenant_id', tenantId)` (`repo.ts:980-990`); el UPDATE comprueba
  el error; el envío es best-effort con log y la UI distingue "se envió" de
  "entrégala por otro canal" (`arco/page.tsx:37-39`). `solicitud_arco` tiene
  `arco_cierre_coherente` (0053) que la escritura respeta.
- **`venceArco` rastrea la promesa.** `privacidad.ts:615-625`: 20 días hábiles,
  el número que el aviso promete, no el 15 de la ley; la página del dashboard
  dice lo mismo. Fechas `date` vs `timestamptz` bien separadas (`vence_en` es
  `date`, `resuelta_en` es `timestamptz`).
- **Los paginados que la 14 dejó.** `getPorFacturar` con `traerTodo` y doble
  ORDER BY `fecha, id` (`facturacion/pendientes.ts:122-130`); el export de
  liquidaciones con `created_at + id` (`api/export/liquidaciones/route.ts:67-69`);
  `listarSolicitudesArco` con `traerTodo` y `recibida_en + id` descendentes
  (`repo.ts:950-957`).
- **Formato de cifras.** `toLocaleString('es-MX')` solo vive en
  `src/lib/formato.ts` (grep en `src/` sin resultados fuera de comentarios y
  pruebas).
- **Pruebas corridas en esta sesión (todas verdes):** `engine` 117, `fiscal`
  57, `repo_acumulado` 5, `periodo/combustible` 15, `aviso` 6, `config*` 19,
  `repo_escritura` 11, `repo_operadores` 5, `migraciones_verificadas` 4. No
  corrí la suite completa (instrucción: otro auditor la corre). Nota: en el
  working tree hay archivos de prueba `zzz-aud16-probe*.test.ts` y
  `audit16_probe*.test.ts` SIN commitear (de otra sesión de auditoría en
  paralelo); no los consideré parte de HEAD y no los corrí.

## Lo que no alcancé a revisar

- **La base real (us-east-2).** El PROMPT-BASE declara 0078-0080 aplicadas y
  el seed del demo sembrado, y el commit de la 16 dice haber sembrado una
  solicitud ARCO de prueba. No tengo credenciales: la salida real de los
  bloques 54-56 no la re-corro yo, y la cabecera de `verificaciones.sql`
  sigue sin estampa (BAJO arriba).
- **El costo real del contador en producción** (cuántas páginas por ejercicio
  tiene el tenant más grande hoy; el hallazgo es prospectivo).
- **El render de `/dashboard/arco`** (píxel, no código) — no levanto preview en
  esta sesión; verifiqué el código y los valores, no la imagen.
- **La suite completa (3,159 según el commit de la 16)** — no la corro yo.
- **El lado legal de la respuesta ARCO por WhatsApp** (ventana de 24 h,
  códigos 131047/131026/131042, aprobación de la plantilla) — es del rubro
  legal; del lado de datos verifiqué que el fallo es cerrado y honesto, y que
  la escritura a `solicitud_arco` respeta el constraint de coherencia.
- **0056-0061 y los checks de 0070/0075** — leídos en rondas anteriores y sin
  cambios; no los re-verifiqué constraint por constraint.

## Veredicto

**Green light para la demo — 7/10.** El cierre más importante de la 15 está y
está verificado en el código: el motor ya no imprime "excedente contra un tope
de $0.00 que no se midió" cuando el contador falla o el comprobante es de otro
ejercicio — la rama va a por confirmar con nota honesta y 3 pruebas. El panel
ya no pinta "sin declarar" como deducción perdida. Y el camino del demo no toca
ninguna de las ramas rotas: el diésel del seed es transferencia (`forma_pago
'03'`, fuera del 15%), la flota declara `{true,true}`, el contador corre sobre
2 filas, y la respuesta ARCO del demo la da el flota_admin (rol que sí debería
poder). Las tres garantías del rubro se sostienen para el guion.

Lo que mantiene la nota en 7 y no la sube: el fix de la 15 metió al rubro una
regresión MEDIA que la 15 no podía ver porque el código no existía — la
guardia dejó de sumar al acumulado los gastos de otro ejercicio pero
`efectivoDeEsteViaje` sigue restándolos del previo, y el PDF archiva "el
ejercicio lleva $3,000.00 (15%)" cuando el ejercicio real lleva $8,000 (40%),
con el excedente desaparecido; el caso es el lado espejo exacto del que la 15
declaró arreglado. La feature nueva de la 16 (ARCO en /dashboard) entró con su
server action sin el re-chequeo de rol que el repo exige (el encargado puede
resolver solicitudes que la RLS le niega) y sin una sola prueba de la ruta de
escritura. Y la mitad del MEDIO #2 de la 15 (`efectivo_no_elegible` fuera de
`ORDEN`) sigue abierta, sin prueba de las ramas que el fix tocó.

La deuda de fondo, en orden: (1) el filtro por ejercicio de
`efectivoDeEsteViaje` (cierra de paso el BAJO de la tool y la asignación del
cupo), (2) el re-chequeo de rol en `accionResponder` + pruebas de
`resolverSolicitudArco`, (3) `efectivo_no_elegible` en `ORDEN` + pruebas de los
tres estados de `causasDe`, (4) el ORDER BY de `getGastos`, (5) pasar las
claves a la tool, (6) los BAJOs heredados — con el XML del demo y la cabecera
de `verificaciones.sql` primero si sobra media hora antes de la sala.
