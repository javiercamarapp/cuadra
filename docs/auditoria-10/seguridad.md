# Seguridad — auditoría 10

**Nota: 6/10** (antes 8, auditoría 9). Razón del movimiento: **deuda que
cobró factura** — el patrón que dos hallazgos de esta misma mañana cerraron
("se acota el tenant y se olvida el rol o el dueño del segundo id") apareció
una **tercera vez** en el mismo día, en una ruta de escritura distinta; y
**mirada más profunda** — el commit de esta mañana declaró ese tercer hueco
"compensado en el código" sin haberlo verificado, y no lo estaba. Las tres
instancias quedan cerradas con prueba al final de esta ronda; una variante
hermana del mismo patrón (`unidadId`, más abajo) queda documentada y sin
tocar, y CSP sigue sin existir — reincidente desde al menos la ronda 8, según
el propio texto de la ronda 9.

---

## Lo que ya traía el día: A1 y A2, verificadas

El commit `b71058b` ("Seguridad 6/10: dos fronteras de privilegio abiertas,
con botón") cerró, ANTES de que esta ronda empezara a escribir, dos IDOR
reales. Los verifiqué contra el código actual, no contra el mensaje del
commit:

- **A1 — el export de CSV/PDF le daba dinero al `encargado`.**
  `puedeExportar` incluye a `encargado`, pero la matriz de la 0044 solo le da
  el área `operacion`. `src/app/api/export/liquidaciones/route.ts:39-47` y
  `src/app/api/export/pdf/[id]/route.ts` ahora exigen
  `puedeVerArea(t.rol, 'dinero')` **antes** de `puedeExportar`. Confirmado:
  las dos rutas tienen el `if (!puedeVerArea(...))` con `return` antes de
  tocar la base.
- **A2 — `/dashboard/chat` era el gemelo sin parchar de
  `/api/dashboard/asistente`.** `src/app/dashboard/chat/page.tsx:35-52` ahora
  llama `puedeVerArea(rol, 'dinero')` **antes** de `getKpis`/`getAcreditables`
  — comprobé el orden de las líneas, no solo que la función exista: un 403
  que ya trajo el dato no cierra nada, y aquí sí cierra antes.

Nota sobre el título del commit: **"con botón" no es una mitigación
manual** — lo pensé al revisar el encargo de esta ronda y es un error de
lectura. El propio cuerpo del commit lo dice: *"las dos tenían control
visible, no hacía falta un curl"*. Es una descripción de qué tan fácil era
explotarlas (clic en un botón del panel, no una petición armada a mano), no
de cómo se cerraron. Las dos se cerraron con código, en servidor, antes de
consultar — igual que el hallazgo nuevo de abajo.

También verifiqué **`TENANT_DEMO` unificado**: `src/lib/auth/tenant-demo.ts`
existe y es la única fuente (`tenantDemo()`); `guard.ts` la importa de ahí.
Cierto, como afirma el commit.

---

## Hallazgos

### [ALTO] `reasignarOperador` y `crearViaje` escribían `operador_id` sin comprobar que el operador fuera de la misma flota — la RLS del chofer no vuelve a filtrar, así que un chofer de OTRA flota vería el viaje

`src/lib/cuadra/repo.ts:104-135` (`reasignarOperador`) ·
`src/lib/cuadra/operacion.ts:457-524` (`crearViaje`) ·
`supabase/migrations/0045_rls_operador.sql:52-53` (policy `operador_ve_su_viaje`) ·
`supabase/migrations/0001_init.sql:49` (`viaje.operador_id` es un FK simple, sin componer con `tenant_id`) ·
`src/app/dashboard/despacho/page.tsx:74-120` (los dos server actions que llaman a las funciones de arriba)

Es la misma familia que A1 y A2, en una tercera ruta. El comentario que
encabeza la sección de escrituras de `operacion.ts` afirma, en presente:

> *"cada una comprueba el tenant en el WHERE además del id — un id de otro
> tenant no debe poder tocarse aunque alguien lo adivine."*

Cierto para el `viajeId`/`unidadId` que se **actualizan** (van en el
`.eq(...)` del WHERE). Falso para el `operadorId` que se **escribe**: no hay
ningún WHERE que lo pueda detener, porque no es lo que se busca, es el valor
que se guarda.

```ts
// repo.ts, ANTES del arreglo
export async function reasignarOperador(tenantId: string, viajeId: string, operadorId: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('viaje')
    .update({ operador_id: operadorId })   // ← nunca se comprobó de quién es
    .eq('id', viajeId)
    .eq('tenant_id', tenantId), 'reasignarOperador');
  ...
}
```

El `<select>` de `/dashboard/despacho` solo ofrece los operadores de
`listOperadores(tenantId)` (tenant-scoped), pero eso es la UI — el server
action recibe `operadorId` de `formData.get('operadorId')` tal cual
(`despacho/page.tsx:78,99`) y no hay nada del lado del servidor que confirme
que ese id es de esta flota antes de llamar a `reasignarOperador`/`crearViaje`.

**Escenario, con valores.** Tenant A tiene un `flota_admin` con permiso de
despachar (`puedeAsignar`). Tenant B tiene un chofer con cuenta web —
`app_user.operador_id = 'o-b-1'` — dado de alta bajo la 0045 (RLS "real para
el chofer, ANTES de que exista login de chofer", que ya está en producción
según el propio comentario de la migración). El `flota_admin` de A abre
devtools en `/dashboard/despacho`, y en vez de mandar el formulario tal cual
edita el campo oculto `operadorId` a `o-b-1` (lo adivinó, lo vio en otro
lugar, o simplemente lo probó) y aprieta "Reasignar" sobre uno de sus propios
viajes `v-a-7`. El server action:

1. `tenantDelAction('/dashboard/despacho')` resuelve el tenant desde la
   SESIÓN (correcto, no confía en el cliente) → `t = 'A'`.
2. `reasignarOperador('A', 'v-a-7', 'o-b-1')` hace
   `UPDATE viaje SET operador_id='o-b-1' WHERE id='v-a-7' AND tenant_id='A'`
   — pasa: el WHERE solo protege QUÉ viaje se toca, nunca A QUIÉN se asigna.
3. `viaje.tenant_id` sigue siendo `'A'`; `viaje.operador_id` ahora es
   `'o-b-1'`, de la flota B. No hay ninguna restricción de base que lo
   impida: `viaje.operador_id` es `references operador(id)`, no
   `references operador(id, tenant_id)` — el mismo patrón de FK simple que la
   0028 vino a cerrar en `gasto`/`liquidacion`/`codigo_pendiente`, y que
   `viaje.operador_id` nunca tuvo desde la 0001.
4. El chofer de B entra a `/chofer` con su sesión normal. La policy
   `operador_ve_su_viaje` (`0045:52-53`) es
   `using (operador_id = get_user_operador_id())` — **no** compara
   `tenant_id`. Ve `v-a-7`: origen, destino, anticipo. Las policies gemelas de
   `gasto` y `liquidacion` (`0045:55-59`) filtran por
   `viaje_id in (select id from viaje where operador_id = ...)`, así que
   también le llegan los gastos y la liquidación del viaje de A.

**Consecuencia.** El chofer de B —que no hizo nada— ve en su propio panel el
origen, destino, anticipo, gastos y liquidación de un viaje de la flota A: su
nombre, folio, montos y comprobantes. Es exposición de datos operativos y
financieros de un tenant a un USUARIO AUTENTICADO de otro, sin que ninguno de
los dos necesite adivinar un endpoint — el chofer de B solo tiene que abrir
su panel normal. Y a diferencia de A1/A2 (que exponían dinero DENTRO del
mismo tenant, a un rol que no debía verlo), esto cruza la frontera de tenant
que el rubro trata como la más grave.

**Por qué "compensado en el código" era una afirmación sin verificar.** El
commit de esta mañana escribió, sobre este mismo archivo de RLS: *"la RLS del
chofer no filtra por flota (compensado en el código, pero la app no es la
única puerta a PostgREST)"* — y lo dejó fuera de alcance. Es cierto que la
app no es la única puerta, pero la frase "compensado en el código" implica
que el código SÍ lo compensaba, y no era así: ni `reasignarOperador` ni
`crearViaje` comprobaban nada antes de escribir. Son las únicas dos
escrituras de `operador_id` en la tabla `viaje` que existen en el repo —
`marcarPodPedido` (`operacion.ts:382-389`) y `guardarHuerfano`
(`repo.ts:289-297`) también escriben un `operador_id`, pero en `pod` y
`comprobante_huerfano`, tablas que las policies de la 0045 no miran, y con un
`operadorId` que llega ya resuelto por el pipeline de WhatsApp, no tecleado
en un formulario. El hueco no estaba fuera de alcance por ser pequeño: estaba
fuera de alcance porque nadie había abierto las dos funciones que sí escriben
ese campo en `viaje`.

**Arreglado.** Las dos funciones comprueban ahora, ANTES de escribir, que el
operador pertenece al tenant:

- `reasignarOperador` reusa `getOperador(operadorId, tenantId)` (ya definida
  en el mismo archivo, `repo.ts:68-84`, `.eq('id',...).eq('tenant_id',...)`) y
  lanza si devuelve `null`.
- `crearViaje` (que no tenía una función así a la mano en `operacion.ts`) hace
  la misma comprobación con el patrón de lectura que el propio archivo ya usa
  en todos lados (`traerTodo` + `conteo`, para no reimplementar el borde de
  PostgREST) y lanza si no encuentra el operador acotado por tenant.

Prueba roja→verde→mutación en `src/lib/cuadra/repo_operadores.test.ts` (caso
nuevo: *"RECHAZA reasignar a un operador de OTRA flota, y no toca el
viaje"*) y `src/lib/cuadra/operacion.test.ts` (caso nuevo: *"crearViaje
RECHAZA un operadorId de OTRA flota, y no inserta el viaje"*). Confirmé la
mutación a mano: revertí las dos comprobaciones, corrí ambas suites, las tres
pruebas nuevas fallaron con el mensaje esperado ("promise resolved... instead
of rejecting" / "expected... to throw... but got..."), y las 27 pruebas
combinadas de los dos archivos vuelven a pasar con el arreglo puesto.
`npx tsc --noEmit -p .` limpio, `npx vitest run` completo: 222 archivos, 2,936
pruebas, 1 saltada — todas en verde.

---

### [MEDIO, mismo patrón, NO arreglado esta ronda] `asignarUnidad`/`crearViaje` tampoco comprueban que `unidadId` sea de la flota

`src/lib/cuadra/operacion.ts:599-603` (`asignarUnidad`) ·
`src/lib/cuadra/operacion.ts` (`crearViaje`, el mismo insert que `operadorId`)

Idéntica forma que el hallazgo de arriba, sin arreglar: `unidad_id` se
escribe en `viaje` sin comprobar que la unidad sea del tenant que despacha.
La diferencia que lo baja de ALTO a MEDIO y lo deja fuera del arreglo de hoy:
`unidad` no tiene ninguna policy de RLS que la exponga a un USUARIO de otro
tenant por su cuenta — no hay login de "operador de unidad" análogo al del
chofer. El riesgo real es más angosto: el propio `flota_admin` de A, que ya
sabe o adivina el UUID de una unidad de B, puede hacer que su PROPIO panel
muestre número económico, placas, marca y modelo de esa unidad (vía el join
que pinta `/dashboard/despacho`) — un IDOR de lectura de un dato mucho menos
sensible que dinero o datos de un chofer, y que exige conocer el UUID de
antemano (no hay lista para adivinar de ahí). Se documenta sin arreglo
especulativo: el mismo candado de `getOperador` no existe para `unidad`
(`getUnidad(unidadId, tenantId)` no está escrito), y escribirlo a las
apuradas sin su propia prueba sería repetir el error que este mismo rubro
señala en `foto_pendiente` (ronda 9): un candado nuevo sin arnés es un
candado que nadie sabe si cierra.

---

### [BAJO, reincidente ronda 9] Sigue sin existir CSP

`next.config.ts` (sin bloque `headers()`) · `src/proxy.ts:25-34`
(`withSecurityHeaders`, que pone `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` y HSTS en producción — nunca
`Content-Security-Policy`)

`command grep -rn "Content-Security-Policy" next.config.ts src/proxy.ts` no
devuelve nada. Es la misma ausencia que la ronda 9 dejó escrita como
pendiente ("sigo sin haber recorrido `privacidad/page.tsx` buscando un
sumidero de XSS con el detalle que eso merece"). No repetí esa revisión esta
ronda — se anota como reincidente, no como confirmado de nuevo.

---

### [BAJO, informativo — no es una vulnerabilidad explotable] `/acceso` sigue vivo, pero ya no autentica nada, y el aviso de arranque describe un mecanismo que dejó de existir

`src/app/acceso/page.tsx` · `src/lib/auth/passcode.ts:180,236`
(`hayPasscode`/`tokenMatches`, exportadas y sin ningún llamador fuera de sus
propias pruebas — `command grep -rn "tokenMatches\|hayPasscode" src/ --include="*.ts*" | grep -v .test.`
solo devuelve las definiciones) · `src/lib/observability/arranque.ts:13,33`

El gate real de `/dashboard` es 100% Supabase Auth desde que `proxy.ts` se
reescribió (`proxy.ts:62-93`, `createServerClient(...).auth.getUser()`) — no
lee `DASHBOARD_PASSCODE` ni la cookie `likida_access` en ningún punto del
camino. `/acceso` sigue siendo una pantalla pública que acepta un passcode,
lo compara en tiempo constante, emite `ACCESS_COOKIE` con `accessToken(...)`
— y esa cookie no la comprueba nada. `tokenMatches`, la única función que
podría validarla, no tiene ni un llamador en código de producción.

No es un hallazgo de acceso: no hay ningún dato detrás de `/acceso` que se
filtre, y el formulario no abre ninguna puerta que el proxy ya no cierre por
su cuenta. Es deuda de observabilidad, y concreta: `arranque.ts:13` dice
*"`DASHBOARD_PASSCODE` ausente → `proxy.ts` no bloquea `/dashboard`: el panel
del contralor queda abierto y tampoco avisa"* — y eso es falso hoy.
`proxy.ts` bloquea `/dashboard` exista o no `DASHBOARD_PASSCODE`, porque ya
no lo mira. Si alguien lee ese aviso de arranque (o su ausencia) para decidir
si el panel está protegido, está leyendo la señal equivocada. No lo arreglé
esta ronda porque tocar `arranque.ts`/`/acceso` es una decisión de
arquitectura (¿se borra el mecanismo entero, o se documenta como legado
consciente?) y no una comprobación de una línea — encaja mejor en
arquitectura o en la próxima limpieza de deuda que en un fix reactivo de
seguridad.

---

## Lo que revisé y está bien

**Service-role sin fallback derivado, otra vez verificado, no heredado.**
`src/lib/supabase/admin.ts:11-15` lanza `'Supabase service-role no
configurado'` si falta `SUPABASE_SERVICE_ROLE_KEY` o la URL — no hay ningún
valor que se derive de otro secreto. `DASHBOARD_SECRET` (passcode.ts:85-89)
sigue sin fallback en producción, igual que la ronda 9 lo dejó.

**`/admin` tiene su gate en el LAYOUT, no repetido (ni olvidado) por
página.** Encontré 21 páginas bajo `src/app/admin/` sin `requireSuperadmin`
directo y lo perseguí pensando que era un hueco — no lo es:
`src/app/admin/layout.tsx:37` llama `requireSuperadmin()` una sola vez y
gatea TODO el árbol, con un comentario explícito de por qué vive ahí ("así
ninguna página nueva bajo /admin puede olvidarlo"). Confirmé que efectivamente
ninguna página nueva lo olvidó porque no tiene que traerlo. Dos capas
independientes: `proxy.ts` (matcher, `RUTAS_CON_SESION` incluye `/admin`) +
el layout — igual que `/dashboard`.

**El diseño de dos capas de `/dashboard` y `/chofer` sigue firme.**
`proxy.ts:45` (`RUTAS_CON_SESION`) es la primera capa; `requireSessionTenant`
/ `requireOperador` (`guard.ts`) es la segunda, y viaja con la página, no con
el matcher. Verificé que `/chofer` está en la lista (`proxy.ts:45`) — el
comentario del propio archivo cuenta que faltó en su momento y ya se
corrigió.

**A1 y A2 (ver arriba), verificadas línea por línea, no solo por el mensaje
del commit.** El orden de las comprobaciones importa y en las dos está bien:
se pregunta ANTES de tocar la base.

**`TENANT_DEMO` unificado**, verificado (ver arriba).

**No hay secretos en texto plano en archivos versionados.** Barrido con
patrones de claves de OpenAI/Google/Slack/llaves privadas sobre
`git ls-files` — cero resultados fuera de `.test.ts` (que usan valores
sintéticos de prueba, no llaves reales).

**`npx tsc --noEmit -p .` limpio** (fuera de un artefacto de tipos generado
por `.next/` de una sesión de screenshot ya cerrada, sin relación con este
rubro: `src/app/zzz-preview*` no existe en el árbol, así que no es un archivo
vivo, es caché estale). **`npx vitest run` completo: 222 archivos, 2,936
pruebas, 1 saltada, todo en verde**, incluidas las 5 nuevas de este rubro.

---

## Lo que NO alcancé a revisar

- **RLS contra Postgres real.** El hallazgo de `operador_ve_su_viaje` está
  leído línea por línea contra la migración y contra el único par de
  escrituras que existen en el repo, pero no ejecuté el escenario completo
  (crear el segundo tenant, el chofer, el UPDATE cruzado, y loguearse como
  ese chofer) contra una base Supabase real. Es el mismo pendiente que la
  ronda 9 dejó para su propio hallazgo de trigger.
- **CSP / sumidero de XSS en `privacidad/page.tsx`.** Reincidente sin
  revisar de nuevo esta ronda (ver hallazgo BAJO).
- **`get_advisors` de Supabase contra el proyecto vivo.** No lo corrí esta
  ronda; el rubro de `search_path` mutable que la ronda 8 encontró ahí sigue
  sin revalidarse contra el catálogo real.
- **Decisión sobre `/acceso`.** Documenté que está muerto, no decidí si se
  borra o se documenta como legado — es una llamada de producto/arquitectura,
  no algo que un rubro de seguridad deba resolver solo.
