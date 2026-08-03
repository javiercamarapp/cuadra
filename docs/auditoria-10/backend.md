# Backend y API — auditoría 10

**Nota: 5/10** (antes 8). Razón del movimiento: **deuda que cobró factura**. Los
cuatro hallazgos de la ronda 9 están cerrados de verdad —lo verifiqué uno por
uno y lo detallo abajo—, así que el retroceso no es una relectura del mismo
árbol. Es que las ~5,700 líneas nuevas de esta ronda metieron **superficie de
servidor nueva que decide quién ve el dinero de la flota, y esa decisión se
tomó solo en la capa que pinta botones**. `permisos.ts:6-8` promete por escrito
que estas funciones deciden "qué botón se pinta **y qué endpoint acepta la
petición**"; ningún endpoint las llama. Las dos rutas de `src/app/api/` que
cambiaron de contrato esta ronda (`export/liquidaciones`, `export/pdf/[id]`)
tienen **cero pruebas** — ni una. El ancla de 8 pide que cada camino que toca
dinero tenga prueba propia; el contrato que cambió esta ronda no tiene ninguna.

Riesgo mayor hoy: un chofer con cuenta del panel entra por el camino normal de
login y aterriza en `/dashboard` —los KPIs, las anomalías y las 20
liquidaciones de **toda** la flota— y desde ahí puede pedir
`/api/export/liquidaciones` y bajarse el CSV completo, porque las dos capas que
debían pararlo (RLS de la 0045 y `puedeExportar`) están apagadas en ese camino.

## Hallazgos

### [CRÍTICO] El chofer que inicia sesión aterriza en `/dashboard` y se le sirve el panel completo de la flota: la 0045 se escribió para impedirlo y el camino no pasa por RLS

`src/app/login/page.tsx:49` · `src/app/login/page.tsx:54` · `src/app/login/page.tsx:70` · `src/app/auth/callback/route.ts:13` · `src/lib/auth/guard.ts:27-37` · `src/app/dashboard/page.tsx:62-69`

Escenario, con valores y sin ningún paso adversarial:

1. Javier da de alta al chofer en `/admin/usuarios/nuevo` con
   `tenantId = 11111111-…`, `email = juan@innovativos.mx`, `rol = 'operador'`.
   La fila queda `app_user{ tenant_id: '1111…', rol: 'operador' }`.
2. Juan abre `https://likida.ai/mis-viajes`. El proxy no ve sesión y redirige a
   `/login?next=%2Fmis-viajes` (`src/proxy.ts:60-72`) — hasta aquí correcto, y
   `src/proxy.test.ts:71-76` lo prueba explícitamente.
3. `/login` recibe ese `next` y lo **descarta**: `sp.next.startsWith('/dashboard')`
   es falso para `/mis-viajes`, así que `next` se reescribe a `'/dashboard'`
   (`login/page.tsx:49`). Los dos server actions repiten el mismo filtro sobre
   el campo oculto del formulario (`:54` para Google, `:70` para el magic
   link), y `auth/callback/route.ts:13` lo repite una tercera vez. El destino
   `/mis-viajes` no sobrevive a ninguna de las tres.
4. Juan abre el magic link → `/auth/callback?next=/dashboard` →
   `NextResponse.redirect('/dashboard')` (`callback/route.ts:29`).
5. `requireSessionTenant` (`guard.ts:27-37`) solo pregunta dos cosas: ¿hay
   sesión? ¿hay `tenantId`? Juan tiene las dos. **No mira el rol.** Devuelve.
6. `dashboard/page.tsx:69` solo desvía a `superadmin`. Para `operador` sigue de
   largo y llama `getKpis`, `getLiquidaciones`, `detectarAnomalias` y
   `getAcreditables` — todas con `supabaseAdmin()` (service-role, **salta
   RLS**). Juan ve "12 viajes liquidados · $47,300 comprobado", el listado de
   las 20 liquidaciones más recientes de todos sus compañeros con folio, monto
   y diferencia, y el panel de anomalías/fraude.

La migración 0045 existe literalmente para impedir esto — su propia cabecera
dice: *"Repetirlo para `operador` sería un IDOR: un chofer con sesión vería los
viajes de TODA la flota, no solo los suyos, y la UI de /mis-viajes sería el
único candado"*. La RLS que escribió es correcta, pero `/dashboard` no la
consulta: lee con service-role. Y `/mis-viajes`, que sí usa `supabaseServer()`
y sí respeta la policy (`mis-viajes/page.tsx:24-31`), **no está enlazado desde
ningún lado**: confirmé con `grep` que la única mención de `/mis-viajes` fuera
de su propia carpeta está en `proxy.ts`, `guard.ts` y sus pruebas. La pantalla
del chofer es inalcanzable y el panel del contralor es su destino por default.

Consecuencia: el chofer ve el dinero de sus compañeros —cuánto comprobó cada
quien, quién quedó "a favor de la empresa", qué viajes tienen anomalía de
fraude marcada— y ve el nombre de operadores que no son él. Para el contralor,
que compra este producto para tener control sobre lo que el chofer sabe y no
sabe, es exactamente el escenario que la conversación de venta promete cerrar.
Si en el demo alguien pregunta "¿y el chofer qué ve?", la respuesta honesta hoy
es "lo mismo que usted".

Causa raíz probable: la autorización por ROL se delegó a la RLS de la 0045,
pero el panel del contralor lee con service-role, así que `requireSessionTenant`
tenía que hacer el reverso de `requireOperador` (`guard.ts:48-54`) y no lo hace;
y la lista blanca de destinos (`startsWith('/dashboard')`) se copió sin
extenderla al panel nuevo.

Prueba que lo cubra: **ninguna**. `guard.test.ts:56-70` prueba el reverso
(`requireOperador` manda a `/dashboard` a quien no es operador) pero no existe
ningún caso de `requireSessionTenant` con `rol: 'operador'`; `proxy.test.ts:71`
afirma que `next=/mis-viajes` se conserva —una propiedad que la capa siguiente
anula— y nada prueba las dos juntas.

---

### [CRÍTICO] `/api/export/liquidaciones` y `/api/export/pdf/[id]` no miran el rol: cualquier sesión con `tenantId` baja el CSV de toda la flota, incluido el chofer

`src/app/api/export/liquidaciones/route.ts:17-19` · `src/app/api/export/pdf/[id]/route.ts:32-33` · `src/lib/auth/permisos.ts:6-8`

El cambio de contrato de esta ronda (`c6c9c3b`, "CSV y PDF leen el tenant de la
sesión") sustituyó `DEMO_TENANT_ID` por `getSessionTenant()`, y la puerta quedó
así, en las dos rutas:

```ts
const s = await getSessionTenant();
if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
```

Eso es *autenticación*, no *autorización*. `puedeExportar` existe
(`permisos.ts:21-23`), dice `false` para `'operador'` y tiene su propia prueba
(`permisos.test.ts:14-16`), pero solo se usa en dos JSX:
`dashboard/page.tsx:222` y `dashboard/[id]/page.tsx:95`. Confirmé con `grep`
que **ninguna ruta de `src/app/api/` lo importa**. La cabecera de `permisos.ts`
afirma lo contrario en su línea 8: *"estas funciones deciden qué ACCIÓN se les
ofrece… qué botón se pinta y qué endpoint acepta la petición"*.

Escenario con valores: Juan (el mismo chofer del hallazgo anterior,
`rol='operador'`, `tenant_id='1111…'`) pide
`GET /api/export/liquidaciones`. `getSessionTenant()` devuelve `tenantId`
no nulo → pasa el `if` → la consulta corre con `supabaseAdmin()` (service-role,
RLS saltada, filtro `.eq('tenant_id', '1111…')`) y le devuelve un CSV con
`created_at, total_comprobado, total_anticipo, diferencia, estatus,
diferencias, folio, **nombre del operador**` de hasta las últimas 1,000
liquidaciones de la flota entera (`route.ts:21-26`). Con
`GET /api/export/pdf/<uuid-de-cualquier-liquidación-del-tenant>` obtiene además
la URL firmada del PDF **del contralor** —el ejemplar con los veredictos— de un
viaje que no es suyo (`pdf/[id]/route.ts:41-58`). El botón no está pintado para
él; el endpoint sí responde, y `/api` está excluido del matcher del proxy
(`proxy.ts:81`), así que tampoco hay una capa previa que lo filtre.

Consecuencia: el aislamiento por chofer que la 0045 construyó a nivel de base
—tres policies de solo lectura, `is_operador()`, `get_user_operador_id()`— se
rodea con una petición GET. El contralor pierde el control sobre la nómina
efectiva de su flota (cada chofer puede ver cuánto se le repuso a los demás), y
el PDF archivado, que es el documento que el contralor entrega, queda al alcance
de cualquier cuenta del tenant.

Causa raíz probable: al mover el gate del passcode compartido a la sesión, se
tradujo "¿tiene la llave?" por "¿tiene sesión?" en vez de por "¿tiene sesión **y
el rol que este recurso exige**"; el service-role de la consulta hace que no
haya una segunda red debajo.

Prueba que lo cubra: **ninguna, ni antes ni ahora**. No existe ningún
`*.test.ts` que importe ninguna de las dos rutas (`grep` sobre `api/export`,
`export/liquidaciones`, `export/pdf`: cero coincidencias fuera de los propios
`route.ts` y del JSX que enlaza). Las dos rutas que cambiaron de contrato esta
ronda son las dos rutas sin una sola prueba.

---

### [ALTO] El CSV que va al ERP se recorta en silencio a 1,000 renglones: `.limit(5000)` no gana contra `max_rows`, y el repo ya documenta esa trampa dos veces

`src/app/api/export/liquidaciones/route.ts:21-26`

La consulta pide `.limit(5000)` y entrega lo que venga, sin `count`, sin
paginar y sin decir nada. PostgREST aplica `db-max-rows` como techo duro por
encima del `limit` del cliente, y el default de la plataforma —el número que el
propio repo cita— son **1,000 filas**: ver `repo.ts:731-741` (*"`max_rows`…
recorta la respuesta EN SILENCIO —sin error, sin cabecera que el cliente mire,
sin nada— y el default de la plataforma son 1 000 filas"*) y
`analytics.ts:29-41` (auditoría 8, ALTO REINCIDENTE, arreglado ahí con
`traerTodo`). El export nunca se movió.

Escenario con valores: flota de 40 unidades, ~25 liquidaciones cerradas por
día. En el mes 3 lleva ~1,800 liquidaciones. El contralor pulsa "Exportar CSV"
para conciliar el trimestre contra su ERP. La consulta ordena
`created_at desc` y PostgREST devuelve **1,000**: el archivo trae de hoy hacia
atrás y **corta a mitad del segundo mes**, sin encabezado de advertencia, sin
fila de corte, con `HTTP 200` y `Content-Disposition: attachment`. El contralor
abre el .csv en Excel, ve 1,000 renglones bien formados y concilia contra un
universo que le falta el 44% — y lo que falta es lo más viejo, que es
justamente lo que ya nadie va a revisar.

Consecuencia: una conciliación que cuadra por accidente y una cifra de gasto
subestimada que entra al ERP como buena. Es el mismo modo de falla que el repo
persiguió en `getAcumuladoCombustible` —donde sí falla cerrado y lanza
(`repo.ts:805-810`)— pero aquí, en la única salida de datos hacia el sistema
contable del cliente, no hay ni el `count: 'exact'` que costaría cero viajes de
red extra.

Causa raíz probable: `.limit(5000)` se leyó como "cabe todo lo que un tenant va
a tener" y como si el `limit` del cliente mandara sobre el techo del servidor;
son las dos cosas falsas.

Prueba que lo cubra: **ninguna**. `export.test.ts` prueba `toCsv`/
`toLiquidacionRows` (el formateo), no la lectura.

---

### [ALTO] `reasignarOperador` acepta cualquier `operadorId` que le manden: un viaje puede quedar apuntando a un chofer de OTRO tenant, y la policy de la 0045 no filtra por tenant

`src/lib/cuadra/repo.ts:109-116` · `src/app/dashboard/[id]/page.tsx:43-56` · `supabase/migrations/0045_rls_operador.sql:52-53`

El server action hace bien las dos cosas obvias: revalida la sesión y revalida
el permiso (`[id]/page.tsx:50-51`, con un comentario que explica por qué). Lo
que no valida es el **valor**: toma `formData.get('operadorId')`, comprueba
solo que no esté vacío (`:53`) y lo pasa tal cual. `reasignarOperador` acota el
`UPDATE` por `tenant_id` **del viaje** (`repo.ts:112-114`) pero no comprueba
que el `operador_id` que va a escribir pertenezca a ese tenant; el `<select>`
que lista solo los choferes propios (`listOperadores`, `repo.ts:91`) es una
lista en el navegador, no una restricción. La FK `viaje.operador_id references
operador(id)` (`0001_init.sql:49`) acepta cualquier operador de cualquier
flota.

Escenario con valores: el dueño de la flota A (`rol='flota_admin'`, sesión
legítima) reenvía la acción con
`operadorId = 'aaaa…' `, el UUID de un chofer de la flota B —visible, por
ejemplo, en un CSV que alguna vez compartieron, o simplemente probado. El
`UPDATE` corre: `viaje{tenant_id: A}.operador_id = <chofer de B>`. Ahora la
policy `operador_ve_su_viaje` de la 0045 dice, textualmente,
`using (operador_id = get_user_operador_id())` — **sin `tenant_id`**. Y lo
mismo `operador_ve_sus_gastos` y `operador_ve_sus_liquidaciones`, que cuelgan
de ella. El chofer de la flota B abre `/mis-viajes` y lee el viaje, los gastos
y la liquidación de la flota A.

Consecuencia: fuga entre flotas por una escritura que el producto ofrece como
botón normal. Hoy hay un solo tenant real, así que no es explotable en el
demo — pero es el único punto del repo donde una escritura de aplicación puede
romper el aislamiento multi-tenant que todo lo demás defiende, y el día que
haya dos clientes ya está puesto. Aparte, y con o sin malicia: el `UPDATE` no
pide `.select()` ni mira filas afectadas, así que si el `id` del viaje no
empata (viaje borrado, tenant equivocado) la función **no lanza**, el server
action redirige a `/dashboard/<id>` como si hubiera funcionado y el panel
sigue mostrando el chofer anterior sin un solo renglón de log.

Causa raíz probable: la validación del `operadorId` se dejó implícita en el
`<select>`, y la policy de la 0045 asumió que `operador_id` nunca cruza tenants
porque hasta esta ronda nadie lo podía escribir desde la web.

Prueba que lo cubra: **ninguna**. `repo_operadores.test.ts` cubre
`listOperadores`/`reasignarOperador` en su camino feliz; no hay caso con un
`operadorId` de otro tenant ni con un `viajeId` que no empata.

---

### [ALTO] `provisionarUsuario`: dos escrituras sin compensación, y el rol `operador` que el formulario ofrece nace roto y no se puede volver a intentar

`src/lib/auth/provisionar.ts:25-33` · `src/app/admin/usuarios/nuevo/page.tsx:26-36`

Son dos escrituras a dos sistemas: `auth.admin.createUser()` (Auth) e
`insert` en `app_user` (Postgres). Si la segunda falla, la función lanza y
**deja el usuario de Auth vivo**. No hay `deleteUser` de compensación, ni un
log que diga qué correo quedó a medias.

Escenario con valores: Javier abre `/admin/usuarios/nuevo`, escribe
`juan@innovativos.mx`, elige "Chofer (operador)" y da Crear. `createUser`
devuelve `id = u-77`. El `insert` falla —basta un blip de red, o el
`check app_user_rol_dominio` si algún día el `<select>` y la 0044 se
desincronizan, o el `unique(email)` de `0001_init.sql:18` si la fila ya
existía—. El action lanza; Javier ve un error. Vuelve a intentar: ahora
`createUser` responde *"A user with this email address has already been
registered"*, la función lanza en `:26` y **no hay forma de dar de alta a Juan
desde el producto, nunca más**, hasta que alguien entre a la consola de
Supabase a borrar el `auth.users` huérfano. Mientras tanto ese huérfano sí
puede pedir magic link (`shouldCreateUser:false` lo deja pasar porque el
usuario existe) y entrar a una sesión sin fila en `app_user`.

Y en el camino feliz, el mismo formulario ofrece un rol que no puede completar:
`provisionarUsuario` no recibe ni escribe `operador_id`, así que **todo chofer
dado de alta por esta pantalla nace con `operador_id = null`**. `requireOperador`
lo manda a `/sin-acceso` (`guard.ts:52`) y no existe ninguna otra pantalla ni
script en el repo que llene esa columna (`grep operador_id` sobre `src/`: solo
lecturas). El `<option>` dice "Chofer (operador) — solo sus propios viajes"
(`nuevo/page.tsx:12`) y el resultado real es una cuenta que no puede entrar a
`/mis-viajes` — y que, por el primer CRÍTICO, sí entra a `/dashboard`.

Consecuencia: para el equipo que mantiene esto, cada alta fallida es cirugía
manual en la consola de Supabase y un correo quemado para siempre desde la UI.
Para el chofer, una cuenta que existe y no sirve. Para el demo: si alguien
enseña "así doy de alta a un chofer", la cuenta creada no puede ver nada suyo.

Causa raíz probable: dos sistemas sin transacción y sin `try/catch` que
deshaga el primero; y el contrato de la función (`tenantId, email, nombre, rol`)
se quedó corto respecto de los roles que el formulario expone.

Prueba que lo cubra: **ninguna** para el fallo. `provisionar.test.ts:40-44`
cubre que Auth falle (y ahí sí verifica que no se inserte), pero **no existe
ningún caso donde `insert` falle**: `beforeEach` lo fija en `{ error: null }`
(`:19`) y ningún test lo mueve. El huérfano nunca se ejerció.

---

### [MEDIO] `getResumenNegocio` lee `gasto` y `viaje` sin paginar ni ordenar: el contador de facturas se estanca en 1,000 y la gráfica de 7 días se va a cero sin avisar

`src/lib/admin/negocio.ts:52-57` · `:136-143` · `:162`

El archivo se defiende del error por valor (`:62-65`, correcto y con prueba en
`negocio.test.ts:114`), pero repite el otro error que este repo ya persiguió
dos veces: `admin.from('gasto').select('created_at')` y
`admin.from('viaje').select('id, tenant_id')` van **sin `.range()` y sin
`.order()`**. El comentario de cabecera justifica la falta de paginación con
*"hoy son 131 filas de llm_costo y 1 tenant"* — pero las tablas que no cita,
`gasto` y `viaje`, son justo las que crecen con el uso.

Escenario con valores: la flota lleva un año; `gasto` tiene 14,300 filas.
PostgREST corta en 1,000 sin `order by`, o sea las que el planner entregue
primero (en la práctica, las más antiguas por orden físico). Resultado en la
consola: el contador retro junto al saludo dice **"1,000 facturas
procesadas"** —y seguirá diciendo 1,000 para siempre, dé lo que dé el negocio—
y `facturasPorDia`, que solo cuenta filas de los últimos 7 días
(`:140-143`), encuentra **cero** en las 1,000 filas viejas que le llegaron: la
gráfica de barras del panel de inicio se pinta plana en cero mientras el
sistema procesa cientos de facturas al día. `viajesProcesados` (`:154`) miente
igual.

Consecuencia: Javier mira su propia consola para decidir precio y capacidad, y
la ve congelada en un número redondo que parece un tope de producto. No es
dinero mal calculado, pero sí es una cifra afirmada que nadie va a dudar
porque viene con dos decimales y una gráfica.

Causa raíz probable: se aplicó el criterio "hoy son pocas filas" a un archivo
que consulta cuatro tablas y solo se contó la más chica.

Prueba que lo cubra: **ninguna** — `negocio.test.ts` tiene 7 casos y ninguno
toca truncamiento ni paginación.

---

### [MEDIO] `/acceso` sigue vivo y todavía "acepta" el passcode: te da la cookie, te redirige al panel y el proxy te rebota a `/login` sin explicar nada

`src/app/acceso/page.tsx:14-34` · `src/proxy.ts:44-73`

El login por passcode se reemplazó, pero la página quedó servida y funcional:
valida el `DASHBOARD_PASSCODE`, escribe la cookie `ACCESS_COOKIE` firmada
(`:28-31`) y redirige a `/dashboard`. El proxy ya no lee esa cookie —solo
pregunta por sesión de Supabase (`proxy.ts:59`)— así que el redirect termina en
`/login?next=/dashboard`.

Escenario con valores: el 6-ago alguien del equipo abre el bookmark de
`/acceso` (era la única puerta hasta hace tres días), teclea el passcode
correcto, la pantalla **no da ningún error**, y aparece la pantalla de login
pidiendo un correo. Nada en ninguna de las dos pantallas dice que el passcode
dejó de existir. Si eso pasa en la sala, se ve como que el panel no reconoce
una credencial que sí es correcta.

Consecuencia: un camino de acceso que reporta éxito y no concede nada, tres
días antes del demo; y `DASHBOARD_PASSCODE` sigue siendo un secreto vivo en el
`.env` que ya no protege nada.

Causa raíz probable: el reemplazo del mecanismo no incluyó retirar el anterior.

Prueba que lo cubra: `passcode.test.ts` sigue verde probando la criptografía de
un mecanismo que ya no autoriza — eso es parte del problema, no de la
cobertura.

---

## Lo que revisé y está bien

- **Los cuatro hallazgos de la ronda 9, cerrados de verdad** (los verifiqué
  antes que nada, no me apoyé en el `00-SINTESIS.md`):
  - CRÍTICO `foto_pendiente`: el mecanismo entero se **revirtió**
    (`processor.ts:493-506`, comentario que cita a los dos auditores y la
    decisión de Javier del 1-ago). Ya no hay claim que borre una fila antes de
    confirmar la descarga porque ya no hay fila. Cerrado por eliminación, que
    es la forma más sólida.
  - ALTO trigger de la 0037 sin `fecha`: la migración
    `0042_gasto_fecha_no_tras_liquidar.sql:19-31` agrega
    `new.fecha is distinct from old.fecha` al `when` del mismo trigger. El
    `catch (llegoTarde(e))` de `processor.ts` ya puede dispararse.
  - ALTO `pedir_ticket`/`enriquecer` sin integración: existe
    `processor_pedir_ticket_enriquecer.test.ts` (ejecuta `processInbound`, no
    lee el fuente).
  - MEDIO `pdf_generado`: `c4781be` lo separó por ejemplar.
- `src/proxy.ts:36-77` — el gate reescrito es correcto en lo suyo: `setAll`
  reasigna `res` y las cabeceras se aplican **al final**, en un solo lugar
  (`:25-34`, `:72`, `:77`), así que un refresh de token no las tira; y el
  redirect a `/login` arrastra las cookies que el SDK pidió escribir
  (`:71`), con prueba real que lo ejerce (`proxy.test.ts:53-56`). El matcher
  excluye `/api`, que es lo correcto para el webhook.
- `src/lib/auth/session.ts:25-62` — el reintento único antes de fallar cerrado
  está bien acotado (dos intentos, no un loop) y, sobre todo, el `error` del
  `select` a `app_user` **se registra** (`:38`) en vez de confundirse con "este
  correo no está dado de alta". Es exactamente el tipo de error de segunda
  lectura que este rubro persigue, y aquí sí quedó escrito con `userId`.
- `src/app/auth/callback/route.ts:15-37` — el `exchangeCodeForSession` revisa
  `error` antes de redirigir, y el `catch` cae al mismo fallback en vez de
  volverse un 500 en la pantalla de login. El `next` sí está en lista blanca
  (el problema del primer hallazgo es que la lista es demasiado angosta, no que
  falte).
- `src/app/dashboard/[id]/page.tsx:43-51` — el server action de reasignar
  **revalida sesión y permiso dentro del action**, no confía en que el `<form>`
  no se pintó. Ese es el patrón correcto para server actions y está bien
  argumentado en el comentario; lo que falta es validar el valor (hallazgo
  arriba).
- `src/lib/admin/negocio.ts:62-65`, `:181`, `:219`, `:254` — las cuatro
  funciones traducen el fallo por valor de supabase-js a una excepción con el
  nombre de la consulta. Nada de "0 tenants, $0 gastados" con la base caída.
- `src/app/api/export/pdf/[id]/route.ts:48-66` — el manejo de errores de esta
  ruta es de los mejores del repo: distingue fallo de lectura (500) de fallo de
  firma (502), loguea **ambos con `tenant` + `liquidacion` + `path`**, y
  devuelve 404 idéntico para "no existe" y "existe sin PDF". El problema de
  esta ruta es quién entra, no cómo falla.
- `src/lib/cuadra/repo.ts`, `conv.ts`, `duplicados.ts`, `pg_errores.ts`,
  `processor.ts` — sin cambios funcionales desde la ronda 9 salvo
  `listOperadores`/`reasignarOperador` (`git diff 96dc577..HEAD`: +32 líneas,
  todas ahí). No reabrí lo que la ronda 9 ya verificó.
- `src/app/api/webhook/whatsapp/route.ts` — sigue sin diff. Firma HMAC antes de
  parsear, cap de body, rate limit por teléfono, `after()` con `Promise.all`.

## Lo que NO alcancé a revisar

- **La cobertura de los server actions de `/login` es textual, no ejecutable.**
  `src/app/login/no_autoregistro.test.ts` lee `page.tsx` con `readFileSync` y
  hace `expect(PAGINA).toMatch(/shouldCreateUser:\s*false/)`. Es el mismo
  patrón que la ronda 8 (rubro pruebas) corrigió en `gasto_tarde.test.ts` y que
  la ronda 9 marcó reincidente en `aviso_una_vez.test.ts`: un `shouldCreateUser:
  false` que quede en un comentario o en una rama muerta sigue pasando la
  prueba. No lo cuento como hallazgo propio porque el archivo declara la
  limitación en su cabecera y es frontera con el rubro de pruebas — pero deja a
  los dos server actions de la única puerta de entrada del producto sin una
  sola línea ejecutada en la suite.
- No pude verificar empíricamente el techo de `max_rows` contra el proyecto
  real de Supabase (no hay `.env` en esta ronda ni se permite editar el repo);
  me apoyé en que el propio repo afirma el valor por escrito en dos archivos y
  lo trata como cierto en dos correcciones ya aterrizadas (`repo.ts`,
  `analytics.ts`).
- Las 26 páginas de `/admin` las revisé solo por su capa de datos
  (`negocio.ts`) y por su puerta (`layout.tsx:27`, `requireSuperadmin` en el
  layout). No audité si el `requireSuperadmin` en el layout basta contra
  peticiones RSC a segmentos anidados — eso es frontera con seguridad y con
  arquitectura, y no quise reportar algo que no pude ejecutar.
- No corrí `npm test` completo (el MAPA ya da la línea base verde); corrí solo
  los `grep` de cobertura que sostienen cada "prueba que lo cubra: ninguna".
