# Arquitectura y mantenibilidad — auditoría 10

Ancla: árbol de `claude/auditoria-10` al 3-ago-2026 (`master` ya mergeado,
`6d4ea7a`). `npx tsc --noEmit` exit 0. Corridos dirigidos: `formato.test.ts`,
`etiquetas_sincronizadas.test.ts`, `src/lib/auth/` (68/68 verdes).

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura**.
El ALTO REINCIDENTE de la ronda 9 —`round2()` en cuatro archivos— se cerró de
verdad **como duplicación**: hoy solo `src/lib/formato.ts` lo define y hay un
guardarraíl que greppea `src/` entero (`formato.test.ts:93-107`, verificado
verde). Ese es el mecanismo que este rubro venía pidiendo dos rondas y hay que
reconocerlo. Pero no cerró **como número**: el valor exacto que la ronda 9
documentó sigue dando el mismo centavo mal, y el test nuevo certifica lo
contrario (H2). Y las 5,743 líneas nuevas reprodujeron la misma clase de
duplicación que el rubro persigue desde la ronda 5 —el mapa de conceptos
copiado— en **cuatro páginas nuevas de `/admin`, ya divergentes entre sí**
(H4), más una tercera copia de `ESTATUS` fuera del guardarraíl que existe
justo para eso (H5). La limpieza del passcode que el propio plan del auth
listaba como último paso no se hizo, y dos documentos + un test siguen fijando
la verdad vieja (H3).

**El riesgo mayor del rubro, hoy:** `src/lib/auth/permisos.ts` se declara —en
su comentario y en su prueba— la única tabla que decide "qué botón se pinta Y
qué endpoint acepta la petición", y **ningún endpoint la llama**: los dos
`/api/export/*` tienen su propia regla, más floja, y contradicen a la
migración 0045 que se escribió esta misma ronda para lo contrario.

## Hallazgos

### [CRÍTICO] La tabla de permisos dice gobernar la API y ningún endpoint la consulta: el chofer descarga el CSV de toda la flota
`src/lib/auth/permisos.ts:9` · `src/lib/auth/permisos.ts:17` ·
`src/app/api/export/liquidaciones/route.ts:17-19` ·
`src/app/api/export/pdf/[id]/route.ts:32-34` ·
`supabase/migrations/0045_rls_operador.sql:41-56`

Hay **tres** lugares que contestan "¿qué puede ver un `operador`?", y se
contradicen:

1. `permisos.ts:17` — `EXPORTA = {superadmin, flota_admin, encargado,
   contador}`. `operador` fuera. El comentario de la línea 9 dice que esta
   tabla decide «qué botón se pinta **y qué endpoint acepta la petición**», y
   `permisos.test.ts:5-7` lo repite: «la misma tabla decide qué botón se pinta
   en el panel **Y qué le permite hacer la API** — un solo lugar, no dos
   copias que se desincronicen».
2. `0045_rls_operador.sql:41-56` — excluye a `rol='operador'` de la policy
   `tenant_data` en `viaje`/`gasto`/`liquidacion` y la reemplaza por SELECT
   scoped a su `operador_id`. El comentario de la migración dice, textual, que
   sin esto «un chofer con sesión vería los viajes de TODA la flota… y la UI
   de /mis-viajes sería el único candado — el que un token robado se salta».
3. `export/liquidaciones/route.ts:18` — la regla real que corre:
   `if (!s || !s.tenantId) return 401`. Nada más. `puedeExportar` no se
   importa en el archivo. Idéntico en `export/pdf/[id]/route.ts:33`.

`grep -rn "puedeExportar" src/` (sin tests) devuelve exactamente dos sitios:
`dashboard/page.tsx:222` y `dashboard/[id]/page.tsx:95`, los dos para **pintar
o no el botón**. Cero endpoints. Y `/api` está excluido del matcher del proxy
(`src/proxy.ts:81`), así que tampoco hay primera capa.

**Escenario, con valores.** Fila real de `app_user` creada por la pantalla que
se agregó esta ronda (`admin/usuarios/nuevo/page.tsx:12`, opción «Chofer
(operador)»): `{rol:'operador', tenant_id:'11111111-…', operador_id:'op-A'}`.
El chofer entra por magic link a `/mis-viajes` —donde la 0045 le enseña solo
sus viajes— y pide a mano `GET /api/export/liquidaciones`.
`getSessionTenant()` devuelve `tenantId` no nulo → pasa el `if` de la línea
18. La consulta usa `supabaseAdmin()` (service-role, **salta RLS**, así que la
0045 no aplica) y filtra solo por `tenant_id`. Sale un CSV de hasta 5,000
filas con las columnas `folio_viaje, operador, fecha, total_comprobado,
anticipo, diferencia, estatus, num_diferencias`
(`src/lib/cuadra/export.ts:4-13`): el nombre de **cada chofer de la flota** y
el anticipo y la diferencia de **cada viaje**. `puedeExportar('operador')`
devuelve `false` y habría cortado exactamente esto.

Consecuencia: un chofer —o cualquiera con su sesión— se lleva la nómina de
viajes de sus compañeros y las diferencias de cada uno, que es material de
conflicto laboral directo. Y para el equipo: la migración 0045, escrita esta
ronda con 40 líneas de comentario explicando por qué la UI no puede ser el
único candado, quedó desactivada por una ruta que se salta RLS por diseño.

Causa raíz probable: `permisos.ts` nació con `exigirAcceso` vivo y se aplicó
donde había un componente que pintar; las dos rutas de `/api` se migraron
del passcode a `getSessionTenant()` cambiando **de dónde sale el tenantId**,
sin volver a preguntar quién puede pedirlo.

(No es reincidente: `permisos.ts` y las dos rutas son de esta ronda.)

### [ALTO] El REINCIDENTE de la ronda 9 se cerró como duplicación pero no como número, y el guardarraíl nuevo certifica lo contrario — REINCIDENTE
`src/lib/formato.ts:39-55` · `src/lib/formato.test.ts:68-90` ·
`src/lib/cuadra/laboral/pagadero.ts:138`

La centralización es real y la doy por buena: las cuatro copias importan hoy
de `formato.ts` (`engine.ts:20`, `analytics.ts:11`, `pagadero.ts:21`,
`combustible.ts:22`) y `formato.test.ts:93-107` greppea `src/` para impedir la
quinta. Lo que no cerró es el defecto que la ronda 9 usó para justificar el
hallazgo.

El arreglo es `Math.abs(n) + Number.EPSILON` antes de multiplicar
(`formato.ts:54`), y su comentario (`formato.ts:44-46`) afirma que «empuja el
valor lo suficiente para que el redondeo caiga del lado correcto». `EPSILON`
es 2.22e-16 **absoluto**; el ULP de un double crece con la magnitud, así que
la suma es un no-op para todo `|n| ≳ 2`. Barrido en Node, 3,000,000 de valores
aleatorios en `[0, 100000)`: **cero divergencias** entre `round2()` de
`formato.ts` y el `Math.round(n*100)/100` que sustituyó. El arreglo no cambia
un solo importe del producto.

**Escenario, con valores — el mismo de la ronda 9, reproducido hoy.**
`pagadero.ts:138`, tope de descuento del art. 110-I LFT, operador con
`excedente = 1000.55`:

```
excedente * 0.30          = 300.16499999999996
round2(...)  hoy, formato.ts  = 300.16     ← idéntico a la ronda 9
lo que la ronda 9 documentó como correcto = 300.17
```

`formato.test.ts` prueba `1.005`, `0.145`, `-1.005`, `35.645`, `1234.567`,
`839.7`, `0`, `500`. Solo los tres primeros distinguen la implementación nueva
de la vieja, y los tres son menores a $2; el importe más chico que este
producto maneja de verdad es una caseta de ~$150. La suite pasa verde sobre un
arreglo que no cubre su propio caso motivador.

Consecuencia: el centavo sigue exactamente donde estaba, dos rondas después, y
ahora hay un test verde y un comentario de nueve líneas que dicen que no. El
siguiente que abra este archivo lo lee como cerrado. Para el contralor: la
nota de descuento de nómina que `pagadero.ts:149` imprime queda un centavo por
debajo del tope legal.

Causa raíz probable: se atacó la duplicación (que era el título del hallazgo)
y se dio por atacado el número (que era el escenario), con un test escrito
sobre valores elegidos para que el `EPSILON` se note.

(REINCIDENTE — 3ª ronda con el mismo valor produciendo el mismo resultado.)

### [ALTO] El passcode no se retiró: dos verdades de autenticación conviviendo, y dos documentos + un test fijan la que ya no es cierta
`src/lib/auth/passcode.ts:1-252` · `src/app/acceso/page.tsx:29` ·
`src/proxy.ts:44-59` · `src/lib/observability/arranque.ts:33` ·
`DEPLOY.md:99` · `src/lib/observability/runbook.test.ts:100`

`src/proxy.ts:44-59` gatea `/dashboard`, `/mis-viajes` y `/admin` con
`supabase.auth.getUser()`; no menciona el passcode. `exigirAcceso` ya no
existe. Pero:

- `passcode.ts` sigue completo (252 líneas) con su prueba de 218
  (`passcode.test.ts`, 19 tests verdes). `grep` por sus consumidores fuera del
  propio archivo: **`tokenMatches` y `hayPasscode` tienen cero**. El
  verificador de la cookie no lo llama nadie.
- `/acceso` sigue siendo una ruta pública (el matcher solo excluye `/api` y
  `_next`) que pide un código, lo compara con `DASHBOARD_PASSCODE`, emite la
  cookie `likida_access` (`acceso/page.tsx:29`) y redirige a `/dashboard`.
  Nadie lee esa cookie. Nada del producto enlaza a `/acceso`.
- `docs/superpowers/plans/2026-08-02-auth-panel.md:1058-1090` —el plan del
  propio cambio— lista textualmente el borrado de `acceso/page.tsx`,
  `passcode.ts`, `passcode.test.ts`, la salida de `DASHBOARD_PASSCODE` de
  `SILENCIOSAS` («su `consecuencia`, "proxy.ts no bloquea…"») y la limpieza
  del runbook. Es el único paso del plan que no se ejecutó.

**Escenario A, con valores.** Se despliega para el demo sin
`DASHBOARD_PASSCODE` (correcto: no gatea nada). En cada arranque en frío,
`avisarConfiguracionSilenciosa()` emite
`logger.error('startup.config_silenciosa', {ok:false, faltan:['DASHBOARD_PASSCODE: proxy.ts no bloquea /dashboard']})`
(`arranque.ts:33`). Sentry recibe un ERROR que dice que el panel del contralor
está abierto. Es falso. Quien esté de guardia el 6-ago persigue un incidente
de seguridad inexistente mientras el demo corre.

**Escenario B.** Alguien lee `DEPLOY.md:99` —«`DASHBOARD_PASSCODE` → `proxy.ts`
**no bloquea** `/dashboard`: el panel queda abierto»— y para callar la alarma
pone la variable. Ahora `/acceso` es una segunda puerta viva: acepta el
código, escribe la cookie, redirige a `/dashboard`, y el usuario acaba en
`/login` sin un solo mensaje de error. El candado "funcionó" y no abrió nada.
Si además el valor es adivinable, `accessToken()` lanza en producción
(`passcode.ts:159`) y `/acceso` responde 500 tras teclear el código correcto.

Y `runbook.test.ts:100` **exige** que `DEPLOY.md` siga nombrando
`DASHBOARD_PASSCODE`: el guardarraíl que existía para que el runbook no
mintiera ahora obliga a que mienta.

Consecuencia: 470 líneas de código y prueba que describen un mecanismo de
autenticación que no corre, más dos documentos operativos y un test que
afirman que sí. El siguiente que toque auth tiene que averiguar cuál de las
dos es la real antes de poder cambiar nada.

Causa raíz probable: el último paso del plan (borrado + limpieza de docs) se
quedó sin hacer y el test del runbook lo volvió costoso de hacer después.

### [MEDIO] `FASE_LABEL` copiado en cuatro páginas de `/admin` y **ya divergente**: la misma gráfica dice "Agente de Escalación" en tres pantallas y "escalacion" en la cuarta
`src/app/admin/model-ops/page.tsx:48` · `src/app/admin/page.tsx:28-31` ·
`src/app/admin/analitica/page.tsx:9-12` ·
`src/app/admin/costos-facturacion/page.tsx:10-13` ·
`src/lib/cuadra/costos.ts:41`

La verdad está en `costos.ts:41`:
`type FaseCosto = 'ocr' | 'cuadre' | 'escalacion' | 'chat' | 'router' | 'whatsapp'`.
Tres de las cuatro copias tienen las seis claves, carácter por carácter.
`model-ops/page.tsx:48` tiene **tres**: le faltan `escalacion`, `chat` y
`router`. Ninguna de las cuatro está tipada como `Record<FaseCosto, string>`
—todas son `Record<string, string>`— así que `tsc` no ve nada.

Es el caso canónico que este rubro persigue desde la ronda 5 (`otro: 'Gasto'`
vs `otro: 'Otro'`), reproducido en código escrito la misma semana en que se
cerró el anterior.

**Escenario, con valores.** Una liquidación escala a Opus:
`processor.ts:1171` llama `faseDeModelo('anthropic/claude-opus-5','cuadre')`,
que devuelve `'escalacion'` (`costos.ts:103`), y se escribe una fila de
`llm_costo` con `fase='escalacion'`, `costo_usd=0.11`. Las cuatro páginas
pintan la MISMA dona sobre el MISMO `r.porFase`
(`admin/page.tsx:234`, `analitica:98`, `costos-facturacion:95`,
`model-ops:127`, las cuatro con `FASE_LABEL[f.fase] ?? f.fase`):

```
/admin, /admin/analitica, /admin/costos-facturacion → «Agente de Escalación · $0.11»
/admin/model-ops                                    → «escalacion · $0.11»
```

Además `model-ops` lista las fases desde otro literal más (`FASES`, línea 54,
tres entradas fijas), así que la fase de escalación —la cara, la que dispara
Opus— **no aparece en el "Registro de agentes"** de la página que se llama
Model Ops. La pantalla que existe para vigilar el costo por modelo es la única
que no enseña el modelo caro.

Consecuencia: Javier mira cuatro pantallas de su propia consola y dos le dan
nombres distintos para el mismo gasto; una le esconde la fase que más cuesta.
Para el equipo: siete literales (cuatro `FASE_LABEL`, `FASE_ICONO`, `FASES`, y
el tipo) hay que tocar para agregar una fase, y ninguno falla si se olvida.

Causa raíz probable: `FaseCosto` es exportable y nadie la usó para tipar los
mapas; los comentarios de `model-ops:9` y `costos-facturacion:15` documentan
explícitamente la decisión de «recrear local» los helpers de `admin/page.tsx`,
y el mapa se copió con ellos.

### [MEDIO] Tercera copia de `ESTATUS`, en `/mis-viajes`, justo fuera del guardarraíl que existe para las otras dos
`src/app/mis-viajes/page.tsx:8-12` ·
`src/lib/cuadra/etiquetas_sincronizadas.test.ts:94-95` ·
`src/types/cuadra.ts:106`

`etiquetas_sincronizadas.test.ts` existe porque este mapa ya se desincronizó
dos veces; su comentario lo dice. Compara exactamente dos archivos:
`dashboard/page.tsx` y `dashboard/[id]/page.tsx` (líneas 94-95), y verifica
contra `EstatusLiquidacion` que ninguno se quede corto. La página nueva de
esta ronda añadió una tercera copia idéntica que el test no mira.

**El cambio concreto que la hace estallar.** Se agrega un cuarto estatus a
`types/cuadra.ts:106` (p. ej. `'en_revision'`). El test falla y obliga a
actualizar las dos páginas del panel — hace su trabajo. `mis-viajes/page.tsx`
pasa verde y cae a su fallback de la línea 80,
`{ label: v.estatus, color: 'var(--muted)' }`: el chofer ve la columna Estatus
con el texto crudo **`en_revision`**, en gris, en la única pantalla web que
tiene.

Consecuencia: el chofer lee una clave de base de datos donde el contralor lee
«Por revisar». Para el equipo: el mecanismo que costó tres rondas construir
protege dos de tres consumidores y nada avisa del tercero.

Causa raíz probable: el guardarraíl nombra archivos concretos en vez de
descubrir a los que declaran el mapa.

### [BAJO] Dos agregadores de `llm_costo` con semántica distinta, y el "oficial" no tiene un solo consumidor
`src/lib/cuadra/costos.ts:253-290` · `src/lib/admin/negocio.ts:50-166`

`getResumenCosto()` agrega `llm_costo` por fase con `round6` (`costos.ts:299`)
y devuelve una unión discriminada de tres estados —`medido` /`sin_registros` /
`no_medido`— cuyo comentario (líneas 235-246) explica que existe para que
**no se pueda pintar un 0 que nadie midió**. `grep -rn "getResumenCosto" src/`
fuera de su archivo y sus tests: **cero**. `negocio.ts:50` reimplementó la
misma agregación sobre la misma tabla, con `round2` y sin la distinción.

**El cambio concreto que la hace estallar.** El día que el panel de la flota
necesite enseñar su costo —está en el roadmap: el comentario de `costos.ts:252`
dice «para el panel: margen real»— habrá dos funciones que suman `llm_costo`
por fase, con distinto redondeo y distinto contrato de error. Si además cambia
la atribución de costo (p. ej. usar `liquidacion_id` en vez de `viaje_id`, que
`vincularCostosALiquidacion` ya escribe), se arreglará en el archivo que se
llama `costos.ts` y `/admin` seguirá con su copia: dos cifras distintas para
"cuánto costó esto".

Consecuencia: para el equipo, `costos.ts` parece la capa de costo y no lo es
para la única pantalla que hoy enseña costo.

### [BAJO] El guardarraíl de `round2` cuenta declaraciones, no la expresión: dos sitios de dinero la conservan inline
`src/lib/cuadra/repo.ts:808` · `src/lib/cuadra/liquidacion/omitidos.ts:37` ·
`src/lib/formato.test.ts:98`

El test greppea `function round2\|const round2\s*=`. Una expresión inline se
le escapa entera, y quedan dos:

```
repo.ts:808     return { efectivo: Math.round(efectivo * 100) / 100, totalCombustible: Math.round(totalCombustible * 100) / 100 };
omitidos.ts:37    monto: Math.round(monto * 100) / 100,
```

`repo.ts:808` es `getAcumuladoCombustible`, el acumulado de efectivo del
ejercicio que alimenta la alerta del tope RFA 2026 2.9
(`periodo/combustible.ts:88-89`, uno de los cuatro sitios que la ronda 9
nombró). `omitidos.ts:37` es el monto de la línea «… y N comprobantes más» que
va impresa en la liquidación archivada.

Hoy los tres redondeos dan lo mismo (ver H2: `round2` es un no-op sobre estos
importes), así que **no hay bug visible**. El cambio que la hace estallar: el
día que se arregle `round2` de verdad —cambiando `EPSILON` por un redondeo
decimal que sí funcione arriba de $2— `formato.test.ts` pasa verde y estos dos
sitios se quedan con el comportamiento viejo, en el acumulado que decide si
salta la alerta de efectivo y en el renglón que el contralor suma con
calculadora.

Causa raíz probable: el guardarraíl se escribió contra el síntoma que la ronda
9 describió (cuatro *declaraciones*) y no contra el defecto (la expresión).

### [BAJO] Cuatro sitios repiten a mano el `.eq('tenant_id', …)` sobre `liquidacion`, uno de ellos dentro de un componente de página
`src/app/dashboard/page.tsx:33-52` · `src/lib/cuadra/analytics.ts:69,178,229` ·
`src/app/api/export/liquidaciones/route.ts:21-26` ·
`src/app/api/export/pdf/[id]/route.ts:41-46`

Los cuatro usan `supabaseAdmin()` (service-role: **RLS no aplica**) y el
aislamiento entre flotas depende de que cada uno acuerde poner el `.eq`.
`dashboard/page.tsx:34` es el peor colocado: una función de consulta
(`getLiquidaciones`) definida dentro del archivo de la página, cuando
`analytics.ts` —que ya tiene `getKpis`, `getAcreditables`,
`getLiquidacionDetalle` con la misma firma `(…, tenantId)`— está al lado.

Medida repetida con el criterio exacto de las rondas 8 y 9 (`.from('`/`.rpc('`
con literal, sin `*.test.ts`): `repo.ts` sigue con 26 sitios; el total subió de
68 a **79**, y el porcentaje fuera de `repo.ts` de 62% a **67%** (53/79). La
"primera mejora desde que se mide" que anotó la ronda 9 se revirtió: los 11
sitios nuevos están todos fuera (`negocio.ts` 7, `export/pdf` 2, y uno cada
uno en `session.ts`, `provisionar.ts`, `mis-viajes`, `cuenta`,
`export/liquidaciones`).

El cambio que la hace estallar: la primera consulta a `liquidacion` que se
escriba en el sitio nuevo copiando del vecino equivocado. No hay dónde poner
el filtro una sola vez.

Consecuencia: para el equipo, "¿dónde se lee una liquidación?" tiene cuatro
respuestas y ninguna es `repo.ts`.

## Lo que revisé y está bien

- **El ALTO de la ronda 9 cerró como duplicación, con mecanismo.** Verificado:
  `round2` se define solo en `src/lib/formato.ts:53`; `engine.ts:20`,
  `analytics.ts:11`, `pagadero.ts:21` y `combustible.ts:22` lo importan;
  `formato.test.ts:93-107` greppea `src/` y falla si aparece otra declaración.
  Corrido: 13/13 verde. Es el mecanismo correcto, aplicado al síntoma
  correcto — mis reservas están en H2 (el número) y H7 (el alcance del grep),
  no en la centralización.
- **`/admin` respeta su frontera de datos.** Las 26 páginas y los tres
  componentes de `src/app/admin/` importan **solo** de `@/lib/admin/negocio`
  (`getResumenNegocio`, `getCostoPorFaseModelo`, `getConversacionesActivas`,
  `getEquipo`); `grep` por `.from('`/`.rpc('`/`supabaseAdmin` en
  `src/app/admin/`: cero, salvo `layout.tsx:38`, que usa `supabaseServer()`
  únicamente para `auth.signOut()` — no es acceso a datos. `negocio.ts` a su
  vez no se importa desde ninguna ruta de flota, así que la única función con
  permiso de cruzar todos los tenants no se filtró al panel del cliente.
- **`engine.ts` sigue puro.** `grep` por `Date.now`, `new Date(`, `fetch(`,
  `Math.random`, `process.env`, `supabase`, `await` dentro del archivo: cero
  resultados, igual que la ronda 9. Los dos módulos nuevos que importó esta
  ronda (`facturacion/caducidad.ts`, `facturacion/identificar.ts`) son
  funciones puras con `hoy` inyectado.
- **No hay dependencia apuntando al revés.** `grep` por `from '@/app` y
  `from '../../app` dentro de `src/lib/` (sin tests): cero. `src/app/` importa
  de `src/lib/`, nunca al contrario.
- **El formato de cifras sigue con una sola fuente.** `utils.ts:12` y
  `app/dashboard/formato.ts:27` son reexports puros de `@/lib/formato`, no
  copias. La página nueva `/mis-viajes` importa `mxn` de `@/lib/utils` y
  `fechaMx` de `../dashboard/formato` — dos rutas, un solo cuerpo. Confirmado
  que `toLocaleString('es-MX')` sigue apareciendo solo en `formato.ts`.
- **Los mapas de rol están razonablemente atados.** `RolAppUser`
  (`provisionar.ts:16`) tipa `ROL_LABEL` en `admin/equipo/page.tsx:12` como
  `Record<RolAppUser, string>` — exhaustivo, `tsc` caza un rol nuevo sin
  etiqueta. `permisos.ts` recibe `string` y falla cerrado ante un rol
  desconocido, con prueba (`permisos.test.ts:17-19`). La lista de
  `admin/usuarios/nuevo:8-13` omite `superadmin` a propósito (se crea por otra
  vía). El único par sin guardarraíl es `RolAppUser` (TS) contra el CHECK
  `app_user_rol_dominio` de la 0044: divergir ahí rompe **ruidosamente** en el
  INSERT, así que lo dejo anotado y no lo cuento como hallazgo.
- **El mecanismo de `migraciones_verificadas.test.ts` sigue vivo y absorbió la
  0044**, con exención razonada. Es el patrón que este rubro premia.
- **El sidebar de `/admin` no tiene links muertos**: los 28 `href` de
  `sidebar-nav.tsx` corresponden uno a uno con `page.tsx` existentes.
- **`calcularAlertas` está bien colocada** (`admin/notificaciones.tsx:14`):
  una sola función consumida por `layout.tsx:34` y por
  `admin/notificaciones/page.tsx`, no dos copias. Y `chat.tsx` sirve a la
  página y al panel lateral con un prop `compacto`, sin duplicar `responder()`.
- `npx tsc --noEmit` limpio sobre el árbol completo.

## Lo que NO alcancé a revisar

- **No corrí `npm test` completo.** Corrí dirigido `formato.test.ts`,
  `etiquetas_sincronizadas.test.ts` y los cinco de `src/lib/auth/` (68/68), más
  `tsc --noEmit`. No corrí `npm run lint`.
- **No abrí las 26 páginas de `/admin` una por una.** Verifiqué la frontera de
  datos de las 26 (imports + grep de acceso directo) y leí a fondo seis
  (`page.tsx`, `layout.tsx`, `model-ops`, `analitica`, `costos-facturacion`,
  `equipo`, `usuarios/nuevo`) más los tres componentes compartidos. Puede haber
  más literales copiados en las veinte que solo grepeé.
- **No audité `conv.ts` (11 sitios de acceso directo) ni `startup.ts` (10).**
  Siguen sin abrirse desde hace cinco rondas; nadie los tocó esta tampoco.
- **No verifiqué el escenario del CSV (H1) contra un Supabase real** — no hay
  base en este entorno. La cadena está leída línea por línea en el código y no
  encontré ningún guardarraíl intermedio, pero no la ejecuté.
- **No perseguí duplicación dentro de `src/app/admin/*/page.tsx` más allá de
  `FASE_LABEL`**: los umbrales y textos de las pantallas declaradas como
  maqueta quedaron fuera del barrido.
- No revisé `charts.tsx` (227 líneas de SVG) contra los otros lugares del repo
  que dibujan barras, ni `contador-retro.tsx`.
