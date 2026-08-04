# D3 · Puerta de entrada: auth, sesión, API pública, arranque y despliegue

Rama `claude/auditoria-11`. Suite completa al terminar: **255 archivos, 2,389
pruebas verdes** (1 skipped). `npx tsc --noEmit` limpio en todo lo de D3 —los
únicos errores que quedan son de `src/app/dashboard/rail.tsx`,
`src/app/admin/ui/graficas.test.tsx` y `src/lib/cuadra/analytics.test.ts`, que
son de otros dominios y estaban en vuelo—. `npx eslint src/ scripts/`: 0
errores (4 warnings de `src/app/admin/`, ajenos).

Cada arreglo se hizo con la prueba que lo reproduce primero, comprobada en
ROJO sin el arreglo. Donde había mutantes citados en el plan, se corrieron y se
verificó que la prueba nueva los mata.

| Grupo | Estado |
|---|---|
| **G-24** | **CERRADO** (pruebas: `src/app/api/export/liquidaciones/autorizacion.test.ts`, `src/app/api/export/pdf/[id]/autorizacion.test.ts`) |
| **G-26** | **CERRADO** (prueba: `src/lib/auth/visibilidad_dinero.test.ts`) · residual nombrado abajo |
| **G-30** | YA CERRADO por `989ca62` (el bache de Auth en `session.ts`) · **residual CERRADO** (prueba: `src/lib/cuadra/startup_sondas_0046_0047.test.ts`) |
| **G-31** | YA CERRADO por `989ca62` (`auth/callback`, `proxy.ts`) · **residual CERRADO** (prueba: `src/app/login/una_sola_copia.test.ts`) |
| **G-34** | **CERRADO** en el owner (prueba: `src/lib/auth/tenant-efectivo.test.ts`) · falta que D1/D5 adopten `resolverTenantDeAction` |
| **G-36** | **CERRADO** lo ARREGLABLE (prueba: `src/lib/observability/app_url.test.ts`) · la DECISIÓN HUMANA sigue abierta |
| **G-37** | YA CERRADO por `989ca62` (`arranque.ts`) · **residual CERRADO** (prueba: `src/lib/auth/acceso_retirado.test.ts`) |
| **G-38** | **CERRADO** (pruebas nuevas en `src/lib/observability/runbook.test.ts`) |
| **G-50** | **CERRADO** (prueba: `src/lib/auth/tenant-efectivo.test.ts`; 4 mutantes verificados) |
| **G-61** | YA CERRADO por `989ca62` (gate de `GET /api/demo`, autoregistro de Google) · **residual CERRADO** (prueba: `src/app/api/demo/entrada_invalida.test.ts`) |
| **G-62** | YA CERRADO por `989ca62` (`provisionar.ts` exige `operador_id`) · residual en `/admin/usuarios/nuevo`, que es de D6 |

---

## Lo que se arregló, en detalle

### G-24 · CRÍTICO · el CSV y el PDF de la flota autenticaban sin autorizar
Las dos rutas preguntaban «¿hay sesión?» y nada más, con `supabaseAdmin()`
(service-role, salta RLS) y `/api` fuera del matcher del proxy. Con la cookie
de un `operador` salía la nómina de viajes de sus compañeros en CSV, y con
cualquier `id` de esa lista, la URL firmada del PDF **del contralor**.

- Las dos importan `puedeExportar` (que existía, con 6 pruebas, y **cero
  consumidores**) y responden **403 antes de tocar la base ni storage**.
- El CSV pagina con `traerTodo` de `lib/cuadra/pg.ts` en vez de `.limit(5000)`:
  PostgREST recortaba a `max_rows` (1,000) con HTTP 200 y sin una fila de
  aviso — la conciliación del trimestre cortaba a mitad del segundo mes.
  Probado con 2,400 filas y con las ventanas exactas (`[0,999] [1000,1999] …`).
- Los errores ahora llegan por excepción (`exigir` dentro de `traerTodo`) y se
  registran igual que antes, sin sacar el texto de PostgREST al cuerpo.

### G-26 · ALTO · tres pantallas de "operación" enseñaban pesos
`/dashboard/viajes` ("Anticipo en viajes abiertos" + columna por viaje),
`/dashboard/analitica` ("Gasto por concepto · Todo el histórico de la flota") y
`/dashboard/documentos` (monto por comprobante) pasan de `'operacion'` a
`'dinero'` en `AREA_POR_RUTA`. El jefe de tráfico conserva Despacho, POD,
Incidencias, Unidades, Operadores, Mapa y el Inicio de operación.

La prueba nueva **ata la tabla al render**: recorre las `page.tsx` de
`/dashboard`, detecta el formato de pesos (`mxn(` / `formato="mxn"`) y exige
que ninguna ruta de `'operacion'` lo pinte, salvo que la página parta la
pantalla por rol (`puedeVerArea(rol,'dinero')`, que es lo que hace la raíz con
`inicio-operacion.tsx`). Se actualizó `visibilidad.test.ts`, que fijaba por
prueba la clasificación equivocada.

### G-30 (residual) · el arranque no sondeaba la 0046 ni la 0047
`grep "0046\|0047" startup.ts` daba cero. La 0046 es el **mismo** fallo que la
0045 y por la misma línea: `getSessionTenant` pide `avatar_url` en el mismo
`select` que `tenant_id`, así que sin la columna PostgREST devuelve `42703`,
falla la consulta entera y **todo** usuario —el contralor y Javier— acaba en
`/sin-acceso`, mientras el arranque escribía `{ok:true}`. Se sondean las dos
(0046 por la columna, 0047 por `pod`), con el mismo trato de "error de red ≠
migración faltante" que ya tenían las viejas.

### G-31 (residual) · `/login` montaba una copia de los actions que nadie probaba
`login/acciones.ts` llegó con `989ca62` —y `no_autoregistro.test.ts` EJECUTA
esos actions—, pero `page.tsx` se quedó con sus copias inline y seguía
montándolas en los dos `<form action={…}>`. O sea: **la versión que corre no era
la que la suite mide**, y la que corría era la vieja, la que ante un fallo real
del envío (cuota de SMTP, Resend 403, proyecto caído) redirigía con `error=1`
sin escribir una línea. La página ahora importa los actions probados; el `next`
pasa por `destinoSeguro` (un solo criterio, no dos).

### G-34 · ALTO · la suplantación de tenant no dejaba rastro y fallaba abierta
`const { data } = await …` descartaba el `error`: con un 503 transitorio `data`
salía null y se seguía con el tenant de la SESIÓN, que para un superadmin es el
**demo**. Ahora vive en un solo sitio (`flotaSuplantada`), con `exigir()` —falla
cerrado— y con log de quién, qué flota y qué ruta. Se publica
**`resolverTenantDeAction(destino, sp)`** para las ocho copias.

### G-36 (ARREGLABLE) · `NEXT_PUBLIC_APP_URL` se comprobaba por presencia
`arranque.ts` ahora valida el **valor**: URL absoluta, `https`, sin barra final
ni ruta, no localhost en despliegue, y **no la URL efímera del deploy** (por
`VERCEL_URL` cuando la plataforma la expone, y por el patrón del hostname
generado cuando no). El aviso dice qué está mal sin filtrar el valor.
`scripts/deploy-vercel.sh` deja de escribir la salida de `vercel --prod --yes`:
toma el dominio de `.env.local`, lo valida **antes** de desplegar y se detiene
si no sirve (así el deploy de abajo ya lo toma y desaparece el segundo redeploy
que solo estaba impreso como recordatorio).

### G-37 (residual) · `/acceso` y el passcode, retirados de verdad
`arranque.ts` y `DEPLOY.md` **ya afirmaban** que `/acceso` y
`lib/auth/passcode.ts` se habían borrado y nombraban un
`acceso_retirado.test.ts` que no existía. Existía la prosa, no el borrado: una
segunda pantalla de login, con otro branding, comparando un passcode compartido
y emitiendo una cookie que ningún gate lee. Se borraron
`src/app/acceso/page.tsx`, `src/lib/auth/passcode.ts` y su prueba;
`DASHBOARD_PASSCODE` sale de `.env.example` (donde declaraba la consecuencia
FALSA «`proxy.ts` NO bloquea /dashboard»), y la prueba que faltaba ahora existe
y lo mide.

### G-38 · la máquina limpia y los mensajes de arranque
`README.md` describe los **cuatro** pasos que dejan el sistema corriendo
(install, `npm run seed`, `node scripts/crear-superadmin.mjs`, `npm run dev`) y
se llama Likida. `DEPLOY.md` nombra `startup.config_silenciosa` y
`startup.entorno_grupos` —los dos que `GUION_DEMO.md` usa como semáforo— y dice
explícitamente que `startup.entorno` cubre **una sola** variable. Se añadió la
prueba que el propio `crear-superadmin.mjs` decía que existía: cruza sus
columnas contra las de `provisionar.ts`.

### G-50 · ALTO · el chokepoint de las 20 páginas ya tiene pruebas
28 pruebas sobre `resolverTenantEfectivo`, cada decisión con su control.
Mutantes corridos y **muertos**:

| Mutante | Pruebas que fallan |
|---|---|
| `if (false && !puedeVerRuta(…))` | 6 |
| `if (sesionReal.rol === 'superadmin' && sp?.tenant)` → `if (sp?.tenant)` | 3 |
| `rolEfectivo(...)` → `sp?.rol ?? sesionReal.rol` | 2 |
| `if (false && opts.esRaiz && …)` (el rebote a /admin) | 1 |
| `exigir(...)` → descartar el `error` (G-34) | 3 |

### G-61 (residual) · `/api/demo` cuadraba sobre basura
`req.json()` sin `try` (500 genérico en la pantalla que se proyecta cuando Meta
falla) y `{"anticipo":"cinco mil"}` entrando **tal cual** al motor real, que
devolvía `"diferencia": null`. Ahora los cuatro casos son 400 con mensaje, y el
control comprueba que un cuerpo válido sigue cuadrando.

---

## Lo que NO se tocó, y por qué

**Cross-domain (el owner publicó, falta que adopten):**
- **G-34 · las ocho copias de `tenantDelAction`.** `resolverTenantDeAction()`
  ya está exportada en `src/lib/auth/tenant-efectivo.ts` con `exigir()` + log.
  D1 (`api/dashboard/asistente/route.ts`, `dashboard/[id]/page.tsx` ×2) y D5
  (`despacho`, `incidencias`, `pod`, `unidades`) sustituyen su copia por la
  llamada. El gate de permiso (`puedeAsignar` + redirect con `sufijo`) se queda
  en la página a propósito: el `sufijo` es local.
- **G-32 · el `safe()` del handler del rail.** Espera a que D1 publique
  `safeLog()` en `lib/cuadra/pg.ts`.

**Residuales que no eran del hallazgo y necesitan una decisión:**
- **`/dashboard/operadores` sigue enseñando dinero al encargado** ("Anticipo
  entregado" y "Comprobado contra ese anticipo" por chofer). Lo encontró la
  prueba nueva de G-26; el hallazgo nombraba tres rutas y esta es una cuarta de
  la misma clase. No se reclasificó porque quitársela le deja al jefe de
  tráfico sin la lista de su propia gente, que **sí** es su trabajo: la salida
  buena es partir la pantalla como hace la raíz, y eso se decide en la página
  (D1/D5), no en la tabla. Queda como trinquete NOMBRADO en
  `visibilidad_dinero.test.ts`: la lista no puede crecer sin que la suite lo
  diga.
- **G-36 · cuál de los cuatro valores de `NEXT_PUBLIC_APP_URL` es el bueno.**
  `CLAUDE.md` dice `https://app.likida.ai`, `DEPLOY.md` dice
  `https://likidaai.vercel.app`, `login/acciones.ts` cae a `https://likida.ai`.
  El arranque ya rechaza los valores imposibles, pero elegir el dominio y
  alinearlo con el *Site URL* de Supabase (Auth → URL Configuration) es una
  decisión humana con un paso fuera del repo. **Antes del 6-ago hay que
  tomarla**: si no coincide, el login queda roto sin un solo error.
- **G-62 · `/admin/usuarios/nuevo` sigue ofreciendo «Chofer (operador)»** y
  llama a `provisionarUsuario` sin `operadorId`. Con `989ca62` eso ya no crea
  una cuenta rota en silencio: **lanza**. Pero la consola sigue ofreciendo un
  rol que su formulario no puede crear (falta el selector de chofer). El
  archivo es de D6.
