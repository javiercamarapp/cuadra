# Pruebas — auditoría 10

Ancla: empecé en `6d4ea7a` (HEAD al abrir). El árbol se movió bajo mis pies
mientras auditaba (el orquestador commiteó `d081176`, `56a85eb`, `8fb74d4`);
**re-verifiqué las dos mutaciones cabecera contra `8fb74d4`** y siguen vivas.
Línea base de hoy: `174 archivos · 1636 pruebas · 1 saltada`, verde.

**Nota: 5/10** (antes 9). Razón del movimiento: **deuda que cobró factura**. El
9 de la ronda 9 era un veredicto sobre el núcleo del dinero — y ese núcleo
sigue armado: volví a matar la mutación de `.is()→.eq()` en huérfanos (el ALTO
que dejé abierto: **cerrado de verdad**) y la del signo de `diferencia` en
`engine.ts`. Pero esta ronda entraron 5,743 líneas y **la superficie más grande
de todas —`src/app/admin/`, 3,839 líneas en 39 archivos— no tiene un solo
archivo de prueba**, y su única autorización se puede borrar con la suite
verde. Corrí siete mutaciones sobre código nuevo: **cinco sobrevivieron**. La
escala de este rubro dice «4 o menos si la suite pasa con la función rota» y
«6 si hay zonas de dinero sin arnés»; esto es las dos cosas a la vez, con el
motor todavía sano. De ahí el 5.

**Riesgo mayor del rubro, hoy:** las dos capas de autorización de `/admin`
—`requireSuperadmin()` en el layout y el matcher del proxy— no tienen ninguna
prueba: borrar cualquiera de las dos deja 174 archivos verdes y `tsc --noEmit`
en 0, y `/admin` enseña el correo de todos los usuarios de todas las flotas.

---

## Método

Copié el repo (sin `.git`, con `node_modules` symlinkeado) a
`scratchpad/mut` y `scratchpad/mut2` y ahí apliqué las mutaciones, corriendo la
suite COMPLETA en cada una. **El árbol real no lo toqué nunca**; lo que aparece
hoy en `git status` (`docs/auditoria-10/agentico.md`, `fiscal.md`,
`rendimiento.md`, `src/lib/cuadra/seed_rfc.test.ts`) es trabajo simultáneo de
otros auditores/del orquestador, no mío. Verificación al cierre en la sección
final.

### Las siete mutaciones sobre código de esta ronda

| # | Archivo mutado | Mutación | Resultado |
|---|---|---|---|
| 1 | `src/app/admin/layout.tsx:27` | `await requireSuperadmin()` → `const nombre = 'Javier'` (y fuera el import) | **SOBREVIVE** — 174/174 verdes, `tsc` 0 |
| 2 | `src/proxy.ts:44` | fuera `\|\| path.startsWith('/admin')` | **SOBREVIVE** — 174/174 verdes |
| 3 | `src/app/login/page.tsx:73` | `if (!(await dentroDelLimite('login:email')))` → `if (false && …)` | **SOBREVIVE** |
| 4 | `src/app/login/page.tsx:95` | `if (!esCorreoSinCuenta(error))` → `if (esCorreoSinCuenta(error))` | **SOBREVIVE** |
| 5 | `src/app/auth/callback/route.ts:13` | `next && next.startsWith('/dashboard') ? next : null` → `next ? next : null` | **SOBREVIVE** |
| 6 | `src/app/dashboard/[id]/page.tsx:51` + `page.tsx:222` | fuera los tres gates de rol del panel (`puedeAsignar` en el server action, `puedeExportar` ×2) | **SOBREVIVE** |
| 7 | `src/lib/admin/negocio.ts:185,252,260` | `getCostoPorFaseModelo` agrupa solo por fase; `getEquipo` sin join a tenant y con `rol: 'superadmin'` fijo | **SOBREVIVE** |

### Controles (mutaciones que SÍ tenían que morir, y murieron)

| # | Archivo mutado | Mutación | Prueba que lo mató |
|---|---|---|---|
| C1 | `src/lib/cuadra/cuadre/engine.ts:553` | `round2(input.anticipo - totalComprobado)` → orden invertido | 4 pruebas en 3 archivos |
| C2 | `src/lib/cuadra/repo.ts` (`getHuerfanos`) | `.is('resuelto_en', null)` → `.eq('resuelto_en', null)` | `repo_huerfanos.test.ts` (1 failed) |
| C3 | `supabase/verificaciones.sql` bloque 26 | cuerpo del bloque borrado, solo queda el título | `migraciones_verificadas.test.ts` **NO lo mató** → ver hallazgo 4 |

---

## Hallazgos

### [CRÍTICO] `/admin` — 3,839 líneas, 28 páginas, cero archivos de prueba, y sus DOS capas de autorización sin ancla: las dos mutaciones dejan la suite verde

`src/app/admin/layout.tsx:27` · `src/proxy.ts:44`

**Escenario (mutación 1).** Alguien edita `admin/layout.tsx` —el archivo con
más tráfico del repo esta semana: `151ccc5` y `fe2d11c` lo tocaron el mismo
día— y sustituye `const { nombre } = await requireSuperadmin();` por
`const nombre = 'Javier';` (o simplemente mueve el `requireSuperadmin()` a un
`page.tsx` mientras refactoriza el sidebar). Corrida real en mi copia:
**174 archivos, 1636 pruebas, todo verde; `npx tsc --noEmit` exit 0.** A partir
de ese commit, Ana Ruiz, `flota_admin` de Transportes Innovativos con sesión
legítima, teclea `/admin/equipo` y `getEquipo()` (`negocio.ts:248`) le devuelve
`id, email, rol, nombre` de **todos los `app_user` de todas las flotas**;
`/admin/ejecutivo` le da `costoIaUsd` y el desglose por modelo de Likida
completa. `requireSuperadmin()` está probada de sobra en `guard.test.ts:80-101`
—tres casos, con valores— pero **nada prueba que alguien la llame**.

**Escenario (mutación 2).** Se quita `|| path.startsWith('/admin')` del gate
del proxy, o se añade `admin` a la exclusión del `matcher` de la línea 81 (el
matcher tampoco tiene prueba). Verde igual. `proxy.test.ts` tiene cinco
pruebas: cuatro de `/dashboard` y una de `/mis-viajes`. `/admin` no aparece en
el archivo. El comentario de `proxy.ts:14-16` promete que «las dos tienen que
fallar a la vez para que el panel se sirva sin autorización» — para `/admin`,
las dos pueden caer una por una sin que nada suene.

**Consecuencia.** El correo, el nombre y el rol de los usuarios de cada flota
cliente (dato personal, LFPDPPP) y el costo de IA de Likida quedan a la vista
del contralor de cualquier flota que tenga sesión. En el demo del 6-ago, el
contralor de Transportes Innovativos es exactamente la persona con sesión.

**Causa raíz probable.** El único gate vive en un `layout.tsx`, y `layout.tsx`
está excluido a mano de la medición de cobertura (`vitest.config.ts:75`), así
que ni el trinquete ni una prueba lo miran: es un punto ciego doble por diseño.

---

### [ALTO] `no_autoregistro.test.ts` no prueba comportamiento, prueba texto fuente: rompí las TRES propiedades que dice proteger y las tres pruebas siguen verdes

`src/app/login/no_autoregistro.test.ts:27-38` (contra `src/app/login/page.tsx:73`, `:86`, `:95`)

**Escenario, con las tres mutaciones aplicadas a la vez.** El archivo lee
`page.tsx` como cadena (`readFileSync`, línea 22) y hace `expect(PAGINA).toMatch(/…/)`.
Basta con que el TEXTO siga ahí:

1. `if (!(await dentroDelLimite('login:email')))` → `if (false && !(await dentroDelLimite('login:email')))`.
   El texto `dentroDelLimite('login:email')` y `rateLimit(` siguen presentes →
   las dos assertions de la línea 31-32 pasan. El límite de 10 intentos / 5 min
   por IP deja de existir: 500 POST desde una IP queman la cuota diaria de SMTP
   de Supabase y **nadie puede entrar al panel el 6-ago**, sin un solo error en
   ningún log.
2. `if (!esCorreoSinCuenta(error))` → `if (esCorreoSinCuenta(error))`. El texto
   `esCorreoSinCuenta` y `otp_disabled` siguen ahí → la assertion de la línea 36-37
   pasa. Se invierte el sentido: `ana@innovativos.mx` (con cuenta) cae en
   `?enviado=1` y `quien@sea.com` (sin cuenta) cae en `?error=1` — el oráculo de
   enumeración que esa prueba existe para cerrar, reabierto; y una cuota de
   correo agotada ahora se le enseña al contralor como «te mandamos un link».
3. `shouldCreateUser: false` desactivado dejando el literal en el archivo.

Corrida real con las tres a la vez: **1629/1629 verdes** (medido sobre `6d4ea7a`;
el archivo no ha cambiado desde entonces).

**Consecuencia.** Las tres propiedades más caras de la única puerta de entrada
al producto están «cubiertas» por tres greps. El contralor se queda fuera el
día del demo, o el login vuelve a decir qué correos son reales.

**Causa raíz probable.** Los server actions viven dentro del componente y no se
pueden importar sueltos — el archivo lo dice en su cabecera y elige el atajo.
Es el mismo patrón que la ronda 9 celebró haber quitado de `gasto_tarde.test.ts`
(«ya NO prueba el texto fuente del cableado»), reintroducido en código nuevo.
**REINCIDENTE de patrón**, no del archivo.

---

### [ALTO] `permisos.ts` está probado como función pura y nunca como cableado: los tres gates de rol del panel se pueden borrar con la suite verde

`src/app/dashboard/[id]/page.tsx:51` · `src/app/dashboard/page.tsx:222` · `src/app/dashboard/[id]/page.tsx:95`

**Escenario.** `permisos.test.ts` (6 pruebas, con caso fail-closed) prueba que
`puedeAsignar('contador') === false`. `dashboard/[id]/page.tsx:45-51` dice por
escrito que ese chequeo se repite EN el server action «porque el `puedeAsignar`
de arriba solo decide si el `<form>` se pinta». Cambié esa línea a
`if (false && !puedeAsignar(r)) redirect(...)` y quité los dos
`puedeExportar(rol) &&` de la UI: **1629/1629 verdes**. Con esa mutación, un
`contador` de la flota arma el POST a mano (misma sesión válida, sin botón) con
`operadorId=o-2` y reasigna el viaje `v-1` de Juan Pérez a Ana Ruiz;
`reasignarOperador` (`repo.ts:112`) hace el UPDATE y el PDF y el CSV de esa
liquidación pasan a atribuirle el dinero al chofer equivocado.

**Consecuencia.** La atribución de un viaje —a quién se le repone el
anticipo— la puede mover un rol que la matriz de roles dice que no puede, y
ninguna prueba lo nota.

**Causa raíz probable.** La misma laguna que esta ronda produjo el CRÍTICO de
las rutas de export (que cinco rubros encontraron por separado y el orquestador
cerró con `src/app/api/export/rol.test.ts` **durante mi sesión** — verificado:
el commit `8fb74d4` es de hoy). Ese arreglo cubre las dos rutas de `/api/export`;
el server action de reasignación sigue sin arnés.

---

### [ALTO] `supabase/verificaciones.sql` bloque 26 —la única garantía de que el chofer no ve el dinero de toda la flota— nunca se ha corrido, y `migraciones_verificadas.test.ts` pasa con el bloque vacío

`supabase/verificaciones.sql:986-1020` · `src/lib/cuadra/migraciones_verificadas.test.ts:39-42` y `:90-102`

**Escenario, con valores.** La guardia lee SOLO las líneas de título
(`/^-- ── \d+\./`, línea 41) y comprueba que el número `0045` aparezca en
alguna. Borré el cuerpo entero del bloque 26 dejando la línea
`-- ── 26. El chofer solo ve sus propios viajes (mig. 0045) ──` y nada más:
`migraciones_verificadas.test.ts` → **4 pruebas, todas pasan**. La guardia mide
que alguien *escribió un título*, no que la garantía se comprobó.

Y no se ha comprobado. La cabecera del archivo declara «Última corrida:
**31-jul-2026**» (línea 15). Los bloques 22 y 23 llevan su salida real copiada
(«Corrido el 1-ago, salida real: 1 / f / 0 / t / 0»). Los bloques **20, 24, 25
y 26 no tienen ninguna salida registrada**, y el 26 se escribió el 2-ago. Es
decir: la migración `0045` —que quita a `operador` de la policy `tenant_data`
en `viaje`/`gasto`/`liquidacion` y la sustituye por tres policies de solo
lectura— tiene su verificación escrita y **nadie la ha ejecutado nunca**. Si
`operador_ve_su_viaje` estuviera mal formulada, el bloque reportaría
`2 / 2 / 2` en vez de `1 / 1 / 1` y no hay nadie mirando.

**Consecuencia.** `/mis-viajes` (`src/app/mis-viajes/page.tsx:23-30`) no lleva
un solo `.eq()` de cortesía: su comentario dice explícitamente que «el
aislamiento lo hace RLS de verdad (mig. 0045)». Toda la separación entre un
chofer y el dinero de la flota entera descansa en un SQL que no se corre en
CI, no se corre en un hook, y cuyo único vigilante en la suite se contenta con
el título.

**Causa raíz probable.** `migraciones_verificadas.test.ts` fue diseñada
—correctamente— para que ninguna migración se quede *sin decisión*; nunca
pretendió medir ejecución, y no hay ningún otro mecanismo que lo mida.

---

### [MEDIO] `src/app/auth/callback/route.ts` — 0 % de líneas ejecutadas; la lista blanca del `next` no tiene prueba y quitarla es un redirect abierto

`src/app/auth/callback/route.ts:13`

**Escenario.** `const destinoExplicito = next && next.startsWith('/dashboard') ? next : null;`
→ `const destinoExplicito = next ? next : null;`. **1629/1629 verdes.** Con eso,
`https://likidaai.vercel.app/auth/callback?code=<válido>&next=https://evil.example/panel`
hace `new URL('https://evil.example/panel', req.url)` → redirect absoluto fuera
del dominio **inmediatamente después de que la sesión quedó en las cookies**.
El contralor abre el magic link que le llegó por correo, el login funciona, y
aterriza en una copia de Likida.

**Consecuencia.** El archivo mide **0 % de líneas** en el reporte de cobertura
(medido: `src/app/auth/callback/route.ts 0.0% · 22 líneas`) y es una `route.ts`,
o sea que sí cuenta para el umbral — el umbral simplemente no se movió.

**Causa raíz probable.** La rama de auth trajo 505 líneas en `login/`,
`auth/callback/`, `cuenta/`, `sin-acceso/` y `mis-viajes/`, y el único archivo
de prueba que las acompaña es un grep de texto sobre `login/page.tsx`.

---

### [MEDIO] El rol `operador` completo —RLS 0045, `requireOperador`, `/mis-viajes`, bloque 26— cuelga de una columna que ningún camino del código escribe, y `provisionar.test.ts` no tiene caso para ese rol

`src/lib/auth/provisionar.ts:18-33` · `src/lib/auth/provisionar.test.ts:23-62`

**Escenario, con valores.** `provisionar.test.ts` prueba cuatro casos y afirma
la carga del INSERT al detalle: `flota_admin` (default), sin nombre,
`superadmin`, `encargado`. **No hay caso `rol: 'operador'`** — el único de los
cinco cuya fila queda incompleta. Javier abre `/admin/usuarios/nuevo`, elige
«Chofer (operador) — solo sus propios viajes» (la opción existe,
`usuarios/nuevo/page.tsx:12`) y da de alta `juan@innovativos.mx`.
`provisionarUsuario` inserta `{id, tenant_id, email, nombre, rol:'operador'}` y
**nunca `operador_id`** — confirmado por grep: ninguna línea de `src/` escribe
`app_user.operador_id`. Juan entra con su magic link, `getSessionTenant`
devuelve `operadorId: null`, `requireOperador` (`guard.ts:52`) lo manda a
`/sin-acceso`, para siempre, sin forma de arreglarlo desde ninguna pantalla.
Y del lado de Postgres, `get_user_operador_id()` devuelve NULL, así que las
tres policies de la 0045 no le dejan ver ni sus propios viajes.

**Consecuencia.** Todo el bloque de trabajo del chofer de esta ronda —la
migración 0045, `requireOperador`, `/mis-viajes`, el bloque 26 de
verificaciones— no es alcanzable por ningún usuario que el producto sepa crear,
y la suite dice que `provisionarUsuario` está bien probada.

**Causa raíz probable.** La prueba fija la forma exacta del INSERT
(`toHaveBeenCalledWith({id, tenant_id, email, nombre, rol})`) y con eso ancla
la carga incompleta en vez de detectarla.

---

### [MEDIO] `arranque.test.ts` ancla una consecuencia que ya es falsa: exige que producción grite por `DASHBOARD_PASSCODE`, que desde esta ronda no bloquea nada

`src/lib/observability/arranque.test.ts:59-68` · `src/lib/observability/arranque.ts:13` y `:33`

**Escenario.** `proxy.ts` ya no mira el passcode (línea 8 del archivo: «El gate
ya NO es un passcode compartido»); `/acceso` sigue existiendo pero la cookie
que emite no la lee nadie en el gate. Pese a eso, `arranque.ts:33` sigue
declarando `{ nombre: 'DASHBOARD_PASSCODE', consecuencia: 'proxy.ts no bloquea
/dashboard' }` y la prueba de la línea 59 —«grita cuando falta
DASHBOARD_PASSCODE: **el panel queda abierto**»— obliga a que siga ahí. El
6-ago, si Javier despliega sin `DASHBOARD_PASSCODE` (que ahora es lo correcto),
el arranque emite `startup.config_silenciosa` con `"level":"error"` a Sentry
diciendo que el panel está abierto. No lo está.

**Consecuencia.** Una alarma roja falsa en el arranque de producción tres días
antes del demo, sostenida por una prueba: quien la vea o pierde media hora, o
aprende a ignorar `startup.config_silenciosa` — que es el canal por el que sí
avisan `DEMO_TENANT_ID` y `NEXT_PUBLIC_APP_URL`, los dos que de verdad tumban
el demo.

**Causa raíz probable.** El reemplazo del passcode por Supabase Auth tocó
`proxy.ts` y las rutas, y no barrió el inventario de variables silenciosas que
lo describía.

---

### [MEDIO] `getEquipo` y `getCostoPorFaseModelo` de `negocio.ts` no tienen ninguna prueba: rompí las dos y la suite quedó verde

`src/lib/admin/negocio.ts:178-193` (`getCostoPorFaseModelo`) · `:248-264` (`getEquipo`)

**Escenario.** `negocio.test.ts` cubre bien —con valores exactos y un caso de
error que lanza— `getResumenNegocio` y `getConversacionesActivas`. Las otras
dos exportadas del archivo no aparecen ni una vez. Mutación aplicada:
(a) en `getCostoPorFaseModelo`, `const key = \`${f.fase}::${f.modelo}\`` →
`` `${f.fase}` ``, y (b) en `getEquipo`, `rol: u.rol as string` →
`rol: 'superadmin'` más el join a `tenant` fuera del `select`. **1629/1629
verdes.** Con (a), Model Ops y Agente OCR colapsan todos los modelos de una
fase en una fila que lleva el nombre del primero: la pantalla que existe para
contestar «¿qué costó OCR, desglosado por modelo?» atribuye $1.51 USD de
`gemini-3.6-flash` + `claude-5-sonnet` a un solo modelo. Con (b), la página
Equipo/RBAC le dice a Javier que los cinco usuarios de la flota demo son
superadmin.

**Consecuencia.** Dos pantallas que se presentan como datos reales (no como
maqueta) pueden mentir sobre costo y sobre permisos sin que nada falle.

---

### [BAJO] Lógica pura de `/admin` sin una sola prueba, en archivos que sí cuentan para el umbral de cobertura

`src/app/admin/notificaciones.tsx:14` (`calcularAlertas`) · `charts.tsx` · `chat.tsx` · `contador-retro.tsx` · `rango-costo.tsx` · `sidebar-nav.tsx` · `perfil.tsx` · `asistente-expandible.tsx`

**Escenario.** `calcularAlertas` es una función pura exportada, con un umbral
numérico (`r.tendenciaCosto >= 30`), llamada desde `admin/layout.tsx:35` y desde
`admin/notificaciones/page.tsx` — su comentario dice que vive ahí «para que
layout.tsx Y admin/notificaciones/page.tsx usen EXACTAMENTE el mismo cálculo».
Nada la prueba. Cambiar `>= 30` por `>= 300` apaga la campana de costo para
siempre y la suite no se entera. Medición de cobertura, corrida por mí:

```
0.0%   25 líneas  src/app/admin/notificaciones.tsx
0.0%  148 líneas  src/app/admin/charts.tsx
0.0%   77 líneas  src/app/admin/chat.tsx
0.0%   64 líneas  src/app/admin/contador-retro.tsx
0.0%   76 líneas  src/app/admin/sidebar-nav.tsx
0.0%   35 líneas  src/app/admin/perfil.tsx
0.0%   50 líneas  src/app/admin/asistente-expandible.tsx
0.0%   22 líneas  src/app/admin/rango-costo.tsx
```

Y aun así **el trinquete de cobertura no se movió**: `npx vitest run --coverage`
da hoy `Statements 83.23 % · Branches 86.81 % · Functions 87.19 % · Lines 83.23 %`
contra umbrales de 78/78/84/83. Entró un subsistema entero a 0 % y la puerta
que existe justo para detectar «zonas que nadie ejecuta»
(`vitest.config.ts:45-50`) subió de nota. El motivo es aritmético: 497 líneas a
0 % contra 7,344 no mueven el porcentaje, y las 28 `page.tsx` están excluidas a
mano.

---

### [BAJO] `numero()` — función nueva de formato de dinero/tokens, sin prueba de salida

`src/lib/formato.ts:68` · `src/lib/formato.test.ts`

`formato.test.ts` prueba `mxn`, `round2`, `litros` y `fechaMx` con valores, y
tiene dos guardias estructurales que impiden copias a mano. `numero()` entró
esta ronda, la usan cuatro sitios de `/admin` para pintar conteos de tokens y
de viajes, y no tiene ni un `expect`. `toLocaleString('es-MX')` sobre un
`NaN` o un `Infinity` (que es lo que devuelve `r.tokensIn + r.tokensOut` si una
fila de `llm_costo` trae `tokens_in` nulo) imprime «NaN» en la consola del
superadmin.

---

## Lo que revisé y está bien

- **El ALTO que dejé abierto en la ronda 9 está cerrado de verdad.**
  `src/lib/cuadra/repo_huerfanos.test.ts` es nuevo y usa el patrón correcto (un
  PostgREST de mentira que ejecuta la cadena real y registra tabla/método/args,
  igual que `repo_aviso.test.ts`). La mutación exacta que describí el año pasado
  —`.is('resuelto_en', null)` → `.eq('resuelto_en', null)`— **falla ahora**
  (control C2). No es reincidente.
- **El motor del dinero sigue armado.** Invertir el signo de
  `const diferencia = round2(input.anticipo - totalComprobado)` (`engine.ts:553`)
  mata 4 pruebas en 3 archivos (control C1).
- **`repo_operadores.test.ts`** (nuevo) prueba `listOperadores`/`reasignarOperador`
  contra la cadena real de métodos, con las dos aristas que importan: el error
  que lanza en vez de leerse como «no hay choferes», y el `.eq('tenant_id', …)`
  del UPDATE. Quitar ese `.eq` hace fallar la prueba.
- **`negocio.test.ts`** (nuevo) es una prueba de comportamiento seria para
  `getResumenNegocio`: valores exactos ($1.93, 1800/350 tokens), las 7 fechas
  con ceros, `hoy` inyectable (no depende del reloj), la tendencia `null`
  cuando la ventana anterior está vacía en vez de «creció ∞», y un caso que
  exige que un fallo de Supabase **lance** en vez de leerse como «cero negocio».
- **`guard.test.ts`, `session.test.ts`, `permisos.test.ts`, `provisionar.test.ts`**
  son pruebas de comportamiento reales, con casos de borde y valores concretos
  (superadmin con `tenant_id` null, operador sin `operador_id`, reintento de
  `getSessionTenant` tras un `fetch failed`, rol desconocido fail-closed). Mi
  crítica es al cableado, no a estos archivos.
- **`proxy.test.ts`** cubre lo más sutil del proxy y lo cubre bien: que el
  redirect a `/login` arrastre las cookies que `setAll` escribió durante
  `getUser()` (el borrado de la cookie muerta) y que también lleve las cabeceras
  de seguridad. Ese caso es difícil de ver leyendo y está probado.
- **CI (`.github/workflows/ci.yml`).** Sin cambios y sigue siendo bueno:
  `branches: ['**']`, `npm ci`, typecheck, lint, `test:coverage` con umbral, el
  paso separado `npx vitest run fundamento duplicados` sin instrumentar, y build
  al final con env de relleno. `pruebas_en_ci.test.ts` sigue vigilando que
  ningún `skipIf(CUADRA_COBERTURA)` se cuele en un archivo fuera del alcance de
  ese segundo comando.
- **Las mutaciones que la ronda 9 verificó siguen muriendo** en el sentido de
  que la suite completa que las cubría no perdió ningún archivo (163 → 174) ni
  ninguna prueba (1570 → 1636): no hubo pruebas borradas por comodidad. La única
  eliminación deliberada (`contraste.test.ts`, el caso de
  `prefers-color-scheme`) se quitó junto con el bloque CSS que medía, con la
  razón escrita en el propio archivo.
- **`identificar.test.ts`** (+9 líneas) ancla el arreglo del día: «ADO» es
  subcadena de «OPERADORA» y un ticket de café se identificaba como la línea de
  camiones. Es un arreglo histórico con su prueba pegada.
- **No hay pruebas que dependan de la red.** Verifiqué el único arnés de pago
  (`arnes_ticket_real.test.ts`): se salta solo si no hay `TICKET_PATH`
  (`describe.skipIf(GRUPOS.length === 0)`, línea 345) y ésa es la única prueba
  saltada de la suite. Los `pruebas-manuales/*.prueba.ts` (6 archivos) están
  fuera del include de vitest y **no los corrí**.
- **Dependencia de la hora:** `processor_cadena.test.ts:38` calcula
  `HOY = new Date().toISOString().slice(0,10)` y el motor deriva su ventana con
  `ventanaDelViaje` → `ahora.toISOString().slice(0,10)` (`fecha_dudosa.ts:58`).
  Los dos son UTC, así que **no hay desfase de zona horaria**; lo miré con
  cuidado porque era candidato a intermitente y no lo es.

---

## Lo que NO alcancé a revisar

- **No tengo Postgres.** Todo lo que digo de `supabase/verificaciones.sql`
  —incluido que el bloque 26 nunca corrió— sale de leer el SQL y su bitácora de
  corridas en la cabecera, más el cruce contra `0045_rls_operador.sql`. No corrí
  un solo bloque.
- **`src/app/admin/` lo audité como superficie, no pantalla por pantalla.**
  Verifiqué que no hay ningún `*.test.ts` bajo ese árbol y medí su cobertura,
  pero no revisé si cada una de las 28 páginas presume datos que no tiene (eso
  es de frontend, y MAPA.md ya advierte que hay maqueta declarada).
- **Los tres arreglos con prueba del PR #6** (`processor_entrega_rechazada`,
  `processor_xml_ambiguo`, `pdf_un_solo_nombre`): confirmé que los tres archivos
  **no existen** en el árbol de hoy. El tercero sí tiene cobertura por otra vía
  (`marca.test.ts` vigila que el PDF diga un solo nombre arriba y abajo). Para
  los otros dos no verifiqué si el defecto sigue vivo — necesitaría reproducir
  el rechazo de Meta y el XML ambiguo, que es trabajo de backend/agéntico. **No
  los des por arreglados.**
- **No corrí mutación sobre** `cuenta/page.tsx`, `sin-acceso/page.tsx`, el
  `matcher` del proxy, ni `src/lib/supabase/server.ts` (0 % de cobertura, pero
  su modo de falla es cerrado: sin cookies, RLS no devuelve nada).
- **`npm run lint` no lo corrí** en esta pasada; sí `npx tsc --noEmit` (exit 0)
  y la suite completa varias veces.
- **El árbol se movió mientras auditaba.** `8fb74d4` cerró el CRÍTICO de las
  rutas de export con `src/app/api/export/rol.test.ts` — lo leí y es un arnés
  correcto (403 vs 401 distinguidos, caso de control con `flota_admin`, y el
  espía que verifica que el 403 sale **antes** de consultar la base). Mis
  hallazgos 1, 2, 4, 5, 6, 7, 8, 9 y 10 los re-verifiqué contra `8fb74d4`; los
  archivos que tocan no han cambiado desde `6d4ea7a`.

---

## Estado del árbol al cerrar

`git status --short` sobre `/home/user/cuadra`:

```
 M docs/auditoria-10/agentico.md
 M docs/auditoria-10/fiscal.md
?? docs/auditoria-10/rendimiento.md
?? src/lib/cuadra/seed_rfc.test.ts
```

**Ninguno es mío.** Son entregables de otros auditores y una prueba en vuelo del
orquestador (`seed_rfc.test.ts` falla hoy: `rfcChecksumOk` rechaza el RFC del
tenant de demo — lo menciono porque lo vi al correr la suite, no es hallazgo de
este rubro). Yo no edité un solo archivo del repo salvo este entregable: todas
las mutaciones vivieron en
`scratchpad/mut/` y `scratchpad/mut2/`, copias con `node_modules` symlinkeado y
sin `.git`.
