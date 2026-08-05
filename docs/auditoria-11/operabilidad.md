# Operabilidad y DX — auditoría 11 (pase 2)

Ancla: rama `claude/auditoria-11`, HEAD `f601061` (`707c749` es el último commit
de código). Medido el 5-ago-2026 entre las 11:03 y las 11:30 UTC.

**Nota: 6/10** (antes 4). Razón del movimiento: **se atacó y subió**, con una
**mirada más profunda** que encontró tres frentes nuevos.

Lo que justifica subir dos puntos, verificado siguiendo la cadena de llamada
hasta el consumidor real y no leyendo la prosa del commit: los dieciséis `catch`
vacíos **ya no existen** —`grep -rn "catch\s*{\s*}"` sobre `src/` devuelve UNA
línea y es un comentario (`pg.ts:77`)—; quince páginas de `/dashboard` y el
handler del rail pasan por `safeLog` (`pg.ts:92-111`), que sí escribe
`lectura.fallida`, y lo comprobé viéndolo salir en la corrida de la suite
(`{"level":"error","msg":"lectura.fallida","meta":{"contexto":"api/dashboard/asistente","err":"fetch failed"}}`).
`proxy.ts:60-87` pasó de cero llamadas al logger a distinguir el rebote legítimo
del fallo de auth. `auth/callback/route.ts` tiene tres líneas donde tenía cero.
El camino del email de `/login` vive en `acciones.ts` y **es el que montan los
`<form>`** (`page.tsx:2,65` — la trampa del PR #7 aquí está cerrada).
`mi-perfil` dejó de felicitar con el `error` tirado. El arranque sonda 0045,
0046 y 0047. El README y `seed.sh` ya dejan una máquina limpia corriendo.

**El riesgo mayor del rubro, hoy:** aunque el fallo genere una línea, **no hay
nadie del otro lado y no hay forma de saber qué versión está viva.** El propio
runbook lo dice (`DEPLOY.md:245-247`: «Hoy no hay nadie asignado ni ningún
canal»), no hay log drain (`DEPLOY.md:16-19`), el CI de `master` —la rama que
Vercel construye— lleva **60+ corridas seguidas en rojo** y hoy falla *más
arriba* que en el pase 1, y `/admin/salud-sistema` pinta tres semáforos verdes
sin medir ninguno. Ese conjunto es el techo de la nota: el ancla de 8 pide
alerta con identificador, y aquí hay línea sin destinatario.

---

## El estado de la compuerta y del CI, medido hoy

Salida real, sobre este árbol, sin tocar un archivo.

```
$ npx tsc --noEmit
EXIT=0

$ npm run lint
> eslint .
EXIT=0                                    (cero warnings)

$ npx vitest run                          [256.83 s]
 Test Files  269 passed (269)
      Tests  2529 passed | 1 skipped (2530)
EXIT=0
```

**`npm run test:coverage` — el último paso del CI, y el comando que `bc7fc86`
dice haber desbloqueado — falló las DOS veces que lo corrí, por dos causas
distintas.**

Corrida 1 (11:03–11:12):

```
⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: ENOENT: no such file or directory, open
  '/home/user/cuadra/node_modules/.cache/coverage/.tmp/coverage-115.json'
 ❯ V8CoverageProvider.readCoverageFiles node_modules/vitest/dist/coverage.js:158:11
 ❯ V8CoverageProvider.generateCoverage node_modules/@vitest/coverage-v8/dist/provider.js:2570:5
EXIT=1
```

No imprimió resumen de pruebas, ni porcentajes, ni el veredicto del trinquete.

Corrida 2 (11:13–11:22, con `node_modules/.cache/coverage` borrado antes):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/lib/cuadra/intake/codigos.test.ts > decodeQrFromImage — el camino que ya
       usa el intake > aguanta una foto de celular grande y con orientación EXIF
 FAIL  src/lib/cuadra/intake/ocr_imagen_cara.test.ts > … > una foto de 24 Mpx se
       acota antes de gastar la llamada de visión
Error: Test timed out in 5000ms.
 FAIL  src/lib/cuadra/intake/ocr_imagen_cara.test.ts > … > el lado corto se mantiene
       en proporción: no se deforma el ticket
AssertionError: expected 1500 to be 500 // Object.is equality
 ❯ src/lib/cuadra/intake/ocr_imagen_cara.test.ts:94:20

 Test Files  2 failed | 267 passed (269)
      Tests  3 failed | 2524 passed | 3 skipped (2530)
   Duration  493.40s
EXIT=1
```

Tampoco llegó al trinquete: los fallos cortan antes. **Así que el
`exit 0 · líneas 84.19% · funciones 85.03%` que `RESULTADO.md:39-44` deja
escrito no lo pude reproducir ninguna de las dos veces.** No es solo cosa de la
instrumentación: `npx vitest run` sobre esos dos archivos **solos** también sale
en rojo aquí (`Tests 3 failed | 6 passed (9)`, 31.24 s), mientras la suite
completa sin cobertura sale verde. Ver el hallazgo ALTO correspondiente.

### El CI de verdad, contra la API de GitHub (no inferido)

| Corrida | Rama | Commit | Fecha | Conclusión | Paso que rompe | Build |
|---|---|---|---|---|---|---|
| #336 | `claude/auditoria-11` | `f601061` | 5-ago 11:13Z | **success** | — | ✅ corrió |
| #335 | `master` | `0f0a91e` (**HEAD de master**) | 5-ago 09:55Z | **failure** | **6 · Lint** | **skipped** |
| #334 | `master` | `feb0b2f` | 5-ago 09:53Z | failure | — | skipped |
| #330 | `master` | `c547f24` | 5-ago 07:05Z | failure | — | skipped |
| #327 | `master` | `33de62c` | 5-ago 06:59Z | failure | — | skipped |
| … | `master` | … | … | failure ×~57 | — | skipped |
| #256 | `master` | `6b0d9f8` | 4-ago 03:07Z | failure | — | skipped |
| #247 | `claude/auditoria-10` | `0fb5fe6` | 3-ago 22:27Z | success | — | ✅ |

Log del paso 6 de la #335, textual:

```
✖ 3254 problems (217 errors, 3037 warnings)
  0 errors and 27 warnings potentially fixable with the `--fix` option.
##[error]Process completed with exit code 1.
```

Y los pasos que GitHub saltó después: `7 · Tests (con umbral de cobertura)`
skipped, `8 · Pruebas de tiempo` skipped, `9 · Build` **skipped**.

Dos lecturas, las dos importantes:

1. **La rama está verde y el arreglo del CI es real — en la rama.** `ci.yml` de
   este árbol separa Tests / Build / Trinquete en tres pasos (`ci.yml`, bloque
   «DOS ROJOS DISTINTOS, DOS PASOS DISTINTOS»), y la corrida #336 lo demuestra:
   Build corrió.
2. **`master` no recibió nada de eso.** Su `ci.yml` sigue siendo el de un solo
   paso (el nombre «Tests (con umbral de cobertura)» de la #335 lo delata), y
   ahora rompe **antes**: en Lint, con 217 errores. El pase 1 midió el rojo en
   el paso de Tests; hoy el rojo subió un escalón, así que ni siquiera se ejecuta
   una prueba. Y `master` es la rama sobre la que vive `vercel.json` y la que
   Vercel construye.

---

## Hallazgos

### [CRÍTICO] Este árbol documenta un despliegue que ya no ocurre, no trae la compuerta que sí ocurre, y nada en la app dice qué versión está viva

`CLAUDE.md:63-68` · `DEPLOY.md:215-229` · ausencia de `vercel.json` ·
`src/app/api/` (sin `health`).

Lo que verifiqué, en este orden:

- `git ls-files | grep -i vercel` en `HEAD` → **solo** `scripts/deploy-vercel.sh`.
  `vercel.json` **no existe en el árbol que audito**.
- `git log --all --oneline -- vercel.json` → `33de62c` (5-ago 00:59 -0600) y
  `b1f9eeb` (5-ago 01:04 -0600), y `git branch -a --contains` los pone **solo en
  `remotes/origin/master`**.
- Contenido en `master`:
  `"ignoreCommand": "git log -1 --pretty=%s | grep -qi '\\[deploy\\]' && exit 1 || exit 0"`.
  La semántica es correcta (exit 1 = construye, exit 0 = salta) y sí lee **solo
  el asunto**, como dice el encargo.
- `CLAUDE.md:65` de **este** árbol dice, literal: «Vercel redeploya PRODUCCIÓN
  en cada push a `master`.» Es exactamente lo contrario.
- `DEPLOY.md:215-229` («## Desplegar») dice `vercel --prod` y **no menciona la
  bandera en ninguna línea**. La versión que sí la explica vive en `master`
  (`c547f24`), no aquí.
- `grep -rn "VERCEL_GIT\|COMMIT_SHA" src/` → **cero**. No hay `/api/health`, ni
  sello de versión, ni ninguna pantalla que diga qué commit está sirviendo.
  `/admin/salud-sistema` y `/admin/observabilidad` enlazan al panel de Vercel en
  vez de decirlo.

Escenario con valores, mañana por la mañana: a las 07:40 del 6-ago se arregla el
redondeo de casetas que salió en el ensayo y se commitea
`fix(cuadre): redondeo de casetas` (sin `[deploy]`). El push a `master` se ve
normal en GitHub (verde no, porque el CI lleva 60 corridas en rojo, pero
«normal»). `ignoreCommand` no encuentra `[deploy]` en el asunto → exit 0 → Vercel
**no construye**. A las 10:00 el contralor ve el redondeo viejo en la sala. Para
detectarlo antes hay que abrir el panel de Vercel y comparar a ojo el hash del
último deployment contra `git log -1`: **desde el producto no hay forma de
preguntarlo**, y el runbook de esta rama ni siquiera dice que haya que hacerlo.

Consecuencia: el modo de falla es silencioso por diseño, y el único documento que
enseña a defenderse de él no está en la rama que se está por mergear. Quien
resuelva el conflicto de `CLAUDE.md`/`DEPLOY.md` a favor de esta rama —que es lo
natural, es «lo nuevo»— **reinstala la prosa falsa**.

Causa raíz probable: la compuerta se puso en `master` el 5-ago a la 01:00, tres
horas después del último commit de código de esta rama; nadie la trajo, y esta
rama sigue afirmando el modelo anterior en los dos archivos que se leen a las
3 a.m.

### [ALTO] `npm run test:coverage` es no determinista: dos corridas, dos rojos distintos, ninguna igual a la que `RESULTADO.md` da por buena

`src/lib/cuadra/intake/ocr_imagen_cara.test.ts:70-95` ·
`src/lib/cuadra/intake/codigos.test.ts` · `vitest.config.ts` (sin `testTimeout`)
· `.github/workflows/ci.yml`, paso «Trinquete de cobertura».

Los dos archivos que fallan construyen y redimensionan imágenes de varios
megapíxeles con `sharp` y `zxing-wasm` dentro del `testTimeout` por defecto de
vitest, **5 000 ms**. En mi corrida 1 `ocr_imagen_cara.test.ts` tardó **4 345 ms**
— 655 ms de margen — y pasó. En la corrida 2, con la misma máquina y el mismo
árbol, tardó **9 901 ms** y reventó.

Y el fallo se propaga: cuando la prueba 1 muere por timeout, su
`extraerComprobante(foto(5657,4243))` **sigue corriendo** y acaba llamando al
mock; el `generateStructured.mockReset()` del `beforeEach` (`:68`) ya pasó, así
que la prueba 3 lee `generateStructured.mock.calls[0]` (`:59`) y mide la imagen
de la prueba 1 → `AssertionError: expected 1500 to be 500` en `:94`. Un timeout
produce dos rojos, y el segundo miente sobre qué se rompió.

Escenario con valores para quien opera: el 6-ago a las 08:15 alguien pushea el
arreglo del redondeo. El CI tarda 8 minutos y sale rojo con
`expected 1500 to be 500` en el módulo de OCR. Nadie sabe si el arreglo rompió el
escalado de imágenes o si es el flake, porque **el rojo de fondo lleva 60
corridas**. Se decide sin dato, que es la definición del hallazgo que puso este
rubro en 4.

Consecuencia: la puerta que se acaba de reconstruir (tres pasos separados, un
diseño correcto) descansa sobre un medidor que no repite. Un trinquete que a
veces dice rojo sin causa se apaga solo, en la cabeza de la gente, antes de que
alguien lo apague en el YAML.

Causa raíz probable: dos pruebas CPU-bound heredan el timeout por defecto pensado
para pruebas de lógica; nadie les puso presupuesto propio ni las sacó del paso
del trinquete, y el `mock.calls` compartido convierte un timeout en un fallo de
aserción en otra prueba.

### [ALTO] `/admin/salud-sistema` pinta tres semáforos verdes que no mide, y `sentryActivo()` —la función que sabría la verdad— no tiene un solo consumidor

`src/app/admin/salud-sistema/page.tsx:35,56` ·
`src/app/admin/observabilidad/page.tsx:55,62` ·
`src/app/admin/page.tsx:283-290` · `src/app/admin/integraciones/page.tsx:51` ·
`src/lib/observability/sentry.ts:43,110`.

`SaludSistemaPage` (`:35`) es `export default function` **sin `async`**: no
consulta nada. Recorre tres tarjetas fijas —Sentry, Vercel, Supabase— y a cada
una le cuelga `<Semaphore estado="ok" etiqueta="Conectado" />` (`:56`).
`grep -rn "sentryActivo" src/` fuera de `sentry.ts` → **cero**.

Y la misma página, doce líneas más abajo (`:64-68`), declara que **no** mide
eso: «Estado de integraciones en semáforo dentro de este panel (sin llamar sus
APIs en vivo) … no está instrumentado aquí hoy». O sea: dice que no lo mide y
pinta el semáforo igual.

Escenario con valores, y es un estado que este repo ya vivió
(`README.md:53-57`, `.env.example:62-67`): `SENTRY_DSN` no está puesta en Vercel
production. A las 03:10 del 7-ago el contralor reporta que el panel falló.
Javier abre `/admin/salud-sistema` y lee **«Errores — Sentry · Conectado»** en
verde. Va a sentry.io: cero eventos, porque `sentryActivo()` (`sentry.ts:43`)
devuelve `false` y `reportar()` retorna en `:110` antes de tocar nada. La única
señal que existía —`startup.observabilidad {"sentry":false}`, un `error` del
arranque en frío— vive en el runtime log de Vercel, cuya retención `DEPLOY.md:16-19`
describe como corta y sin drain: «un fallo del sábado de madrugada puede no
existir el lunes».

Consecuencia: la pantalla que existe para contestar «¿tengo alertas?» contesta
que sí sin haber preguntado, sobre la variable cuya ausencia significa que nadie
va a recibir el siguiente fallo. Rompe «un rótulo tiene que ser verdad» en la
superficie del rubro.

Causa raíz probable: las tarjetas nacieron como enlaces («se enlaza en vez de
reconstruirse», comentario de `:9-15`), que es la decisión correcta; al pasarlas
al design system v2 se les añadió el `<Semaphore>` como decoración de la tarjeta
y nadie notó que un semáforo afirma un estado.

### [ALTO · REINCIDENTE] Tres copias del `{ data }` sin `error` del `?tenant=` sobrevivieron a G-34 — y una está dentro de un server action que ESCRIBE

`src/app/api/dashboard/asistente/route.ts:46` ·
`src/app/dashboard/[id]/page.tsx:61` y **`:85`** ·
`src/app/cuenta/page.tsx:10,22`.

`tenant-efectivo.ts:46-74` sí quedó bien: usa `exigir()`, falla cerrado y emite
`tenant.suplantacion` / `tenant.suplantacion_ilegible` con `userId`, `tenant` y
`ruta`. Pero el arreglo no llegó a estas tres, que son literalmente la misma
línea:

```ts
const { data: tFila } = await supabaseAdmin()
  .from('tenant').select('id').eq('id', sp.tenant).maybeSingle();   // [id]/page.tsx:85
if (tFila) t = tFila.id as string;
```

Escenario con valores, la escritura (`[id]/page.tsx:84-92`): Javier está en
`/dashboard/9f2c…?tenant=22222222-2222-2222-2222-222222222222`
(Transportes Innovativos) y pulsa «Reasignar» sobre una liquidación. Un bache de
800 ms contra Supabase → PostgREST devuelve `{ data: null, error: 'fetch failed' }`
→ el `if (tFila)` no entra → `t` se queda en `tDemo`, que para un superadmin sin
`tenant_id` es **el tenant DEMO** (`guard.ts`) →
`reasignarOperador(t, d!.viajeId, operadorId)` (`:90`) escribe contra la flota
equivocada → `redirect(/dashboard/9f2c…?tenant=2222…)` y la pantalla vuelve como
si nada. **Cero líneas**: `supabaseAdmin()` no lanza, `redirect()` lanza
`NEXT_REDIRECT` que Next filtra, y `onRequestError` no ve nada.

Y la lectura (`asistente/route.ts:46`): mismo bache mientras el rail refresca.
`tenantId` se queda en el DEMO, `tenantNombre` en `null`, ninguna de las tres
consultas falla, así que `fallo` sigue en `false` y `motivo` sale **`'ok'` con
status 200** (`:89,106`). El rail muestra el comprobado y los acreditables de la
flota demo al lado de una página que muestra los de Innovativos — que es
palabra por palabra lo que la cabecera de ese mismo archivo (`:6-9`) dice que
existe para impedir: «dos verdades distintas en la misma pantalla».

Consecuencia: la función de suplantación quedó auditable en un archivo y muda en
tres, y el modo de fallo de uno de ellos es escribir en la flota equivocada
anunciando éxito.

Causa raíz probable: G-34 se cerró donde el patrón estaba centralizado
(`tenant-efectivo.ts`) y no donde estaba copiado; `grep` por
`from('tenant').select` habría dado las tres.

### [ALTO · REINCIDENTE] `session.ts:31` sigue tirando el `error` de `auth.getUser()`, y el arreglo hermano de `proxy.ts` cita por nombre una función que nunca se escribió

`src/lib/auth/session.ts:31` · `src/proxy.ts:76-81`.

La línea, hoy, sin cambio respecto del pase 1:

```ts
const { data: { user } } = await sb.auth.getUser();   // session.ts:31
if (!user) return null;
```

`proxy.ts` sí aprendió la lección: `:60` desestructura `error`, `:79-81` define
el criterio `noContesto` (`AuthRetryableFetchError`, `status` ausente/0/≥500) y
`:83-86` emite `proxy.auth_error` con un mensaje excelente. Y su comentario de
`:76` dice: «Mismo criterio que `noPudePreguntar` en lib/auth/session.ts; va
repetido aquí y no importado porque este archivo corre en el runtime EDGE».
**`grep -rn "noPudePreguntar" src/` devuelve UNA línea, y es ese comentario.**
La función no existe en `session.ts` ni en ningún otro archivo: el arreglo
documenta un gemelo que no se construyó.

Escenario con valores: bache de 800 ms del endpoint de auth mientras el contralor
navega de `/dashboard` a `/dashboard/cuadre`. `auth-js` **no lanza** en ese caso
—atrapa cualquier `isAuthError` y hace `return { data: { user: null }, error }`—,
así que `getUser()` devuelve `{ user: null, error: AuthRetryableFetchError }` →
`if (!user) return null` en `:32` → `requireSessionTenant` redirige a
`/login?next=/dashboard/cuadre`. El `for` de `:28` **no reintenta** (no se lanzó
nada), `session.reintento` no sale, `session.excepcion` no sale, y
`session.app_user_error` tampoco porque la consulta a `app_user` nunca corrió.
Total escrito: **cero líneas**, y el resultado es indistinguible byte por byte de
«este correo nunca se dio de alta» — que es justo lo que el comentario de
`:18-25` promete evitar.

Consecuencia: el contralor sale expulsado a `/login` a media demo por un bache
ajeno, y a la mañana siguiente el log de `proxy` dice que el gate estuvo bien
(su `getUser()` sí funcionó al entrar) mientras la segunda capa lo tiró en
silencio.

Causa raíz probable: `proxy.ts` y `session.ts` cayeron en dominios de arreglo
distintos; el que arregló `proxy.ts` describió el criterio compartido en un
comentario en vez de en un módulo, y el otro nunca llegó.

### [ALTO] El script de despliegue manda apuntar el webhook de Meta a la URL EFÍMERA del deploy — justo el valor que él mismo rechaza doce líneas antes

`scripts/deploy-vercel.sh:81,88` contra `:69-73`, y contra `DEPLOY.md:233`.

El script cerró G-36 bien para `NEXT_PUBLIC_APP_URL`: `:69-73` **aborta** si el
valor huele a URL por deploy
(`grep -Eq -- '-[a-z0-9]{8,}(-[a-z0-9-]+)?\.vercel\.app$'`), con el argumento
correcto («ese host no está en las *Redirect URLs* de Supabase»). Y once líneas
después:

```bash
url="$(vercel --prod --yes)"                                    # :81
...
1) Webhook de Meta →  $url/api/webhook/whatsapp                 # :88
```

`$url` es exactamente lo que `:69-73` acaba de prohibir: la URL por deploy,
`https://likidaai-k3f9x2p-javiercamarapp.vercel.app`.

Escenario con valores: se corre `bash scripts/deploy-vercel.sh` el 5-ago para
levantar el entorno de respaldo, y se sigue el paso 1 impreso: en Meta Business
se pone el webhook en `https://likidaai-k3f9x2p-…/api/webhook/whatsapp`. Esa URL
**sigue viva para siempre** en Vercel y sirve **ese** deployment, congelado. El
6-ago se despliega el arreglo del redondeo: el sitio se actualiza, y WhatsApp
sigue entrando por el build de ayer. El operador manda su ticket, recibe
respuesta, todo «funciona» — con el código viejo, sin un solo error en ninguna
parte. `DEPLOY.md:233` dice el alias estable
(`https://likidaai.vercel.app/api/webhook/whatsapp`); el script dice otra cosa, y
el script es el que se lee justo después de desplegar.

Consecuencia: el único canal de entrada del producto se puede clavar a una
versión muerta siguiendo la instrucción impresa por el propio repo, y el síntoma
es «los arreglos no llegan» sin ningún log que lo diga.

Causa raíz probable: G-36 se razonó sobre la variable de entorno y no sobre el
concepto («la URL por deploy no sirve para nada estable»); el `cat <<EOF` final
del script se quedó como estaba desde antes.

### [ALTO · REINCIDENTE] `NEXT_PUBLIC_APP_URL` sigue con tres dominios distintos según dónde se lea, y el arranque acepta los tres

`CLAUDE.md:66` · `DEPLOY.md:3,109,177,185,233` · `TRASPASO.md:42` ·
`src/app/login/acciones.ts:32` y `src/lib/llm/openrouter.ts:31` ·
`src/lib/observability/arranque.ts:75-102`.

| Dónde | Qué dice |
|---|---|
| `CLAUDE.md:66` | «**debe ser** `https://app.likida.ai`» |
| `DEPLOY.md:3` | «Producción: **https://likidaai.vercel.app**» |
| `DEPLOY.md:177` | Site URL de Supabase: `https://likidaai.vercel.app` |
| `DEPLOY.md:185` | Redirect URL: `https://likidaai.vercel.app/auth/callback` |
| `DEPLOY.md:233` | Webhook de Meta: `https://likidaai.vercel.app/...` |
| `login/acciones.ts:32` | fallback del código: `https://likida.ai` |
| `TRASPASO.md:42` | «`likidaai.vercel.app`: es el que tiene configurado el webhook de Meta» |

La mitad ALTA del hallazgo del pase 1 **sí se cerró**: `defectoDeAppUrl()`
(`arranque.ts:75-102`) ya mira el VALOR y no la presencia, y caza la URL efímera
por `VERCEL_URL` y por patrón. Lo que queda abierto es que ninguno de sus seis
criterios distingue entre los tres dominios de arriba: los tres son `https`, sin
barra final, sin ruta, sin `localhost` y sin sufijo de hash. **El semáforo sale
`startup.config_silenciosa {"ok":true}` con cualquiera de los tres puesto**, y
ese es el paso 3 que `GUION_DEMO.md:28-29` manda mirar antes de entrar a la sala.

Escenario con valores: en Vercel queda `NEXT_PUBLIC_APP_URL=https://app.likida.ai`
(lo que manda `CLAUDE.md`, el archivo que lee todo agente que toca el repo) y en
Supabase → Auth → URL Configuration la Redirect URL es
`https://likidaai.vercel.app/auth/callback` (lo que manda `DEPLOY.md:185`, el
archivo que lee quien configura). El contralor teclea su correo →
`acciones.ts:92` arma
`emailRedirectTo=https://app.likida.ai/auth/callback?next=%2Fdashboard` → ese
origen no está en la lista blanca → GoTrue lo ignora y usa la Site URL. Si esa
tampoco coincide, **Likida nunca recibe la petición**: no hay log que pueda
existir, y `arranque.ts` dice `ok:true`.

Consecuencia: es la decisión #1 de `RESULTADO.md:96-100` y sigue sin tomarse a
menos de 24 h del demo, con dos documentos del repo dando instrucciones
incompatibles a dos personas distintas.

Causa raíz probable: la decisión es humana (`RESULTADO.md` lo dice), pero nada en
el árbol la fuerza: no hay una constante única de la que salgan los tres
documentos, y ninguna prueba compara `CLAUDE.md` con `DEPLOY.md`.

### [MEDIO · REINCIDENTE] Tres páginas de `/dashboard` nunca recibieron `safeLog` y conservan el `catch` mudo de G-32, byte por byte

`src/app/dashboard/politicas/page.tsx:37-42` ·
`src/app/dashboard/configuracion/page.tsx:36-41` ·
`src/app/dashboard/usuarios/page.tsx:65-70`.

Las quince páginas que migraron declaran
`const safe = <T,>(fn) => safeLog(fn, 'dashboard/<x>')`. Estas tres no aparecen
en esa lista y siguen con:

```ts
let config;
try { config = await getConfig(tenantId); }
catch { config = null; }        // politicas/page.tsx:40
```

`grep -c logger` en las tres → **0, 0, 0**.

Escenario con valores: el contralor abre `/dashboard/politicas` para enseñar los
topes contra los que el motor cuadra. `getConfig(tenantId)` lanza —`config.ts`
convierte el error por valor en `ConsultaFallida`, o `acotada` agota su tope de
8 s— → el `catch` de `:40` lo vuelve `null` → la pantalla dice «No se pudo leer
la configuración de esta flota.» (`:58`). **Cero líneas escritas**, y como no
salió excepción `onRequestError` (`instrumentation.ts:56-86`) tampoco se dispara.
El caso de `usuarios/page.tsx` es idéntico y más engañoso: `getUsuarios` (`:40`)
lanza **a propósito** (`throw new Error('getUsuarios: …')`) y el `catch` de `:68`
se lo come catorce líneas más abajo — el mismo patrón exacto que hacía CRÍTICO al
de `cuadre/page.tsx` en el pase 1.

Consecuencia: `/dashboard/configuracion` es la pantalla que enseña el RFC contra
el que se validan los CFDI y los topes del motor. Que se rinda sin dejar rastro
es el mismo agujero de antes, solo que ahora en tres pantallas en vez de
dieciséis — por eso MEDIO y no CRÍTICO.

Causa raíz probable: la migración a `safeLog` se hizo sobre la lista de páginas
del hallazgo (las que el pase 1 enumeró), no sobre un `grep` de `catch` en
`src/app/dashboard/`; estas tres no estaban en la enumeración original.

### [MEDIO] La línea que `safeLog` escribe no dice de qué flota habla

`src/lib/cuadra/pg.ts:92-111`, y sus dieciséis llamadores
(p. ej. `dashboard/cuadre/page.tsx:54`).

Lo que sale, capturado tal cual de la corrida de la suite:

```json
{"t":"2026-08-05T11:11:23.054Z","level":"error","msg":"lectura.fallida",
 "meta":{"contexto":"api/dashboard/asistente","err":"fetch failed"}}
```

`contexto` es la PÁGINA (`'dashboard/cuadre'`), no el tenant. El `tenantId` está
disponible en el llamador —`cuadre/page.tsx:54` lo tiene en la línea de arriba,
`safe<LiqRow[]>(() => getLiquidaciones(tenantId))` en `:63`— y no viaja.

Escenario con valores: el 7-ago a las 03:00 fallan las lecturas de
`/dashboard/cuadre`. En el log quedan cuarenta líneas
`lectura.fallida {contexto:"dashboard/cuadre"}` idénticas. No se puede decir si
es una flota o todas, ni cuál, ni si el contralor de Innovativos fue uno de los
afectados. `DEPLOY.md:21-28` promete lo contrario: «Los identificadores del
camino del dinero (`tenant`, `viaje`, `operador`, `gasto`, `liquidacion`) salen
como huella `id:xxxxxxxxxxxx`», y `huellaId` (`logger.ts:82-90`) existe
exactamente para esto.

Consecuencia: el panel pasó de invisible a visible —que es el salto que sube la
nota— pero se quedó a un campo de ser reconstruible. Es la diferencia entre el
ancla de 6 y la de 8 de este rubro.

Causa raíz probable: `safeLog` se diseñó con la firma mínima que cerraba G-32
(«qué se estaba leyendo»), y el `contexto` se documentó con el ejemplo
`"dashboard/cuadre.liquidaciones"` — un nombre de consulta, no un identificador
de fila.

### [MEDIO · REINCIDENTE] El arranque grita en `error`, en cada instancia nueva, una consecuencia falsa sobre un candado que se borró — y una prueba fija su gemela en el runbook

`src/lib/cuadra/startup.ts:12-28` (llamada desde `:66`) ·
`src/lib/observability/runbook.test.ts:103` · `DEPLOY.md:39,111,124`.

`verificarEntornoCritico()` sí se ejecuta (`startup.ts:66`, dentro de
`verificarMigracionesCriticas`, que `instrumentation.ts:27` sí llama). Lo que
emite, textual (`:25`):

> `FALTA DASHBOARD_SECRET: el panel va a fallar al intentar entrar. Sin él, el
> HMAC de la cookie del panel se deriva del propio passcode y una cookie
> capturada permite crackearlo offline.`

Las tres afirmaciones son falsas hoy: `/acceso` y `lib/auth/passcode.ts` se
borraron (`ls src/app/acceso` → no existe; `DEPLOY.md:115-122` lo confirma), no
hay ninguna cookie con HMAC, y el panel entra por Supabase Auth. Nada del panel
falla si esa variable no está.

Escenario con valores: alguien lee `DEPLOY.md:119-122` («un secreto vivo que no
protege nada sigue siendo un secreto que rotar») y borra también
`DASHBOARD_SECRET` de Vercel. A partir de ahí, **cada arranque en frío** emite
`{"level":"error","msg":"startup.entorno","meta":{"msg":"FALTA DASHBOARD_SECRET: el panel va a fallar al intentar entrar…"}}`,
que por `logger.ts:148-150` va a Sentry como un issue permanente titulado
`startup.entorno` diciendo que el panel está roto cuando no lo está.

`arranque.ts:20-38` documenta este anti-patrón con nombre, fecha y razón —y por
eso sacó la variable gemela de su propia lista— pero la lección no cruzó al
archivo de al lado. Y en la otra dirección, `runbook.test.ts:103` **exige por
prueba** que `DEPLOY.md` mencione `DASHBOARD_PASSCODE`, una variable que
`acceso_retirado.test.ts` demuestra que no tiene un solo lector en `src/`:
limpiarla del runbook pone la suite en rojo.

Consecuencia: el canal de alerta que tiene que servir a las 3 a.m. arranca con
una alarma falsa garantizada, y la compuerta ancla una variable muerta en el
runbook. Es exactamente lo que `startup.ts:34-46` describe: «cuando el aviso
resulta ser mentira una vez, se aprende a ignorarlo».

### [MEDIO · REINCIDENTE] El camino de Google y los dos cortes por límite de tasa siguen redirigiendo `error=1` sin escribir una línea

`src/app/login/acciones.ts:68`, `:75`, `:83-84`.

El arreglo del pase 1 llegó **solo al camino del correo**: `:112`
(`logger.error('login.otp_error', { code, status })`) y `:117`. Diez líneas más
arriba, la misma función hermana:

```ts
if (error || !data.url) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);   // :75
```

Sin log. Y los dos cortes por límite (`:68` para Google, `:83-84` para correo)
tampoco escriben nada.

Escenario con valores: el proveedor de Google no quedó encendido en Supabase, o
el *Authorized redirect URI* de la consola de Google no es
`https://<proyecto>.supabase.co/auth/v1/callback` (`DEPLOY.md:191-194`).
`signInWithOAuth` devuelve
`{ data: { url: null }, error: AuthApiError "Unsupported provider: provider is not enabled" }`
→ `:75` redirige → la pantalla dice «Algo falló. Intenta otra vez.»
(`login/page.tsx`). **Cero líneas.** El contralor lo intenta cuatro veces más;
al décimo intento el `rateLimit` de `:67` lo corta con **el mismo mensaje
genérico**, también sin log. En dos minutos hay que decidir si se tira del plan
B (`/demo`) y no hay nada que leer para distinguir «proveedor apagado» de
«límite de tasa» de «el contralor teclea mal».

Consecuencia: de los dos botones de la pantalla de entrada, uno quedó
instrumentado y el otro no, y el que no es el que un contralor de una flota con
Google Workspace va a usar primero.

Causa raíz probable: el arreglo se escribió sobre el escenario del hallazgo (el
sandbox de Resend, que es del camino del correo) y no sobre la función.

### [MEDIO · REINCIDENTE] `supabase/verificaciones.sql` sigue sin ningún invocador automático

`supabase/verificaciones.sql` (59 KB, 34 bloques) · `scripts/verificar-sql.sh` ·
`.github/workflows/ci.yml` · `package.json:6-17`.

`grep -rn "verificar-sql\|verificaciones.sql"` fuera de `docs/` da:
`scripts/verificar-sql.sh` (que es el archivo mismo) y `PROMPT-SESION-NUEVA.md:34,108`.
**Ni `ci.yml`, ni `package.json`, ni `DEPLOY.md`, ni `seed.sh` lo llaman.**
`supabase/andamiaje_local.sql` existe precisamente para poder correrlos contra un
Postgres desnudo y su propia cabecera dice por qué: «24 de los 34 bloques
llevaban meses escritos y sin ejercer».

Escenario con valores: la 0047 se aplica a producción pero una de sus policies
de RLS entra mal (o no entra: `MAPA.md:48-54` documenta que las dos migraciones
de RLS del PR #7 chocan de ordinal y una base «totalmente migrada» se las
saltaría en silencio). La sonda de `startup.ts:145` pregunta
`from('pod').select('id')`, que responde bien porque la TABLA sí está.
`verificaciones.sql` —lo único del repo que sabe distinguir «la tabla existe» de
«la policy hace lo que dice»— no lo corre nadie. El arranque emite
`startup.migraciones {"ok":true}`.

Consecuencia: el andamiaje y los 34 bloques son trabajo hecho y desconectado; la
verificación de esquema que sí llega a producción solo comprueba existencia.

### [BAJO] El `catch` de último recurso del webhook registra sin decir qué mensaje

`src/app/api/webhook/whatsapp/route.ts:74`.

```ts
processInbound(m).catch((e) => logger.error('processInbound', { err: … }))
```

Sin `id` (el wamid), sin `de`, sin `tenant`. El `catch` general **dentro** de
`processInbound` (`processor.ts:1715-1730`) sí lleva los cinco identificadores y
está muy bien hecho —el contexto vive fuera del `try` a propósito, `:271-278`—,
así que este solo se dispara con lo que escape ANTES del `try` de `:279`: el
`claimMessage` de `:244` y `crearPresupuesto` de `:268`. Verifiqué que
`claimMessage` (`conv.ts:235-245`) no lanza (`acotada` resuelve con un error por
valor, `presupuesto.ts:276-297`), así que la probabilidad es baja — pero si pasa,
la única línea que queda no permite saber qué comprobante se perdió, y Meta no
reintenta (`DEPLOY.md:236-239`).

### [BAJO] `ratelimit.ts` justifica ser síncrono citando un archivo que se borró

`src/lib/ratelimit.ts:15-16`.

> «hoy no puede serlo porque `src/app/acceso/page.tsx:20` la llama en un `if`
> síncrono y un `Promise` ahí es siempre truthy»

`ls src/app/acceso` → no existe (se borró en la auditoría 10). El impedimento
que el módulo declara para no pasar a un backend compartido ya no está, y el
único consumidor que hoy depende de este límite es el envío de magic links
(`acciones.ts:42-46`), cuyo daño real —quemar la cuota de correo de Supabase— la
propia cabecera de `:36-41` describe como «deja el panel sin la única vía de
entrada que hoy funciona». Un límite en memoria por instancia no lo evita: en
Vercel el techo real es 10 × instancias concurrentes.

### [BAJO] El único boundary que cubre `/admin` y `/mis-viajes` ofrece una salida que esos usuarios no pueden usar

`src/app/global-error.tsx:67-70` · `find src/app -name error.tsx` →
solo `src/app/dashboard/error.tsx`.

`/admin` (31 `page.tsx`) y `/mis-viajes` no tienen boundary de segmento, así que
un fallo cae en `global-error.tsx`. Está bien hecho —loguea `app.global_error`
con el `digest` (`:31-38`) y lo pinta en pantalla (`:72-80`), que es el puente
que `DEPLOY.md:51-54` manda usar— pero su segundo botón es
`<a href="/dashboard">Ir al panel</a>`. Un chofer que llega ahí desde
`/mis-viajes` va a `/dashboard`, donde `puedeVerRuta` lo rebota a `inicioDe(rol)`;
un superadmin que llega desde `/admin` acaba en el panel del tenant demo en vez
de en su consola. Es una salida que devuelve al usuario a otro sitio en el peor
momento posible.

---

## Lo que revisé y está bien

- **Los dieciséis `catch` vacíos están cerrados en el camino que corre**, y lo
  comprobé siguiendo la cadena, no leyendo el commit: `pg.ts:92-111` define
  `safeLog`, quince páginas lo montan por nombre (`cuadre:54`, `page:38`,
  `pod:22`, `despacho:28`, …) y la línea `lectura.fallida` sale de verdad en la
  corrida de la suite. `grep -rn "catch\s*{\s*}"` sobre `src/` deja una sola
  ocurrencia y es un comentario (`pg.ts:77`).
- **`/api/dashboard/asistente` ya no responde 200 con nulos** (G-25):
  `route.ts:66-68` pasa un `alFallar` a `safeLog`, `:89` discrimina
  `ok | error | sin-permiso` y `:106` devuelve **503** cuando la lectura cayó.
  El contrato viaja en el status, que es donde tiene que ir.
- **`proxy.ts` pasó de cero a bien instrumentado.** `:60` desestructura `error`,
  `:79-81` define `noContesto` para no ahogar el log con el visitante anónimo, y
  `:83-86` emite `proxy.auth_error` con un mensaje que dice **qué hacer**
  («Revisa la anon key y el estado del endpoint de auth»). Es el mejor mensaje
  de log del repo.
- **`/auth/callback` cerró los dos huecos**: `auth.callback_intercambio` con
  `code`/`status`/`msg` (`:48-52`), `auth.callback_excepcion` en el `catch`
  (`:59`) y `auth.callback_sin_code` (`:65`) — este último es el síntoma exacto
  de un `NEXT_PUBLIC_APP_URL` mal puesto, y alguien pensó en ponerlo.
- **La trampa del PR #7 está cerrada en `/login`**: `page.tsx:2` importa de
  `./acciones` y `:65,+` monta ESAS en los `<form>`; `una_sola_copia.test.ts`
  (4 pruebas, verdes) impide que vuelvan a divergir. Abrí el archivo para
  comprobarlo.
- **`admin/mi-perfil/acciones.ts` es el arreglo modelo del pase**: tres caminos
  de fallo, tres `logger.error` distintos con `userId`
  (`perfil.nombre_no_guardado`, `perfil.avatar_no_subido`,
  `perfil.avatar_no_referenciado`), y ninguno anuncia «guardado».
- **El arranque sonda ahora 0045, 0046 y 0047** (`startup.ts:122,135,145`), con
  mensajes que dicen la consecuencia y el comando. `sinRespuesta()` (`:48-51`)
  sigue distinguiendo «no está» de «no pude preguntar», que es el cierre de la
  ronda 9 y aguanta.
- **El camino del dinero sigue siendo lo mejor instrumentado del repo, con
  identificador.** `processor.ts:1715-1730` emite
  `processInbound.fail` / `.consulta_fallida` / `.operador_ambiguo` con `id`,
  `de`, `tenant`, `viaje` y `cerroSinEntregar`, y el contexto vive fuera del
  `try` a propósito (`:271-278`). `route.ts:108-119` cierra el circuito de los
  acuses con `wa.no_entregado {id, para, codigo, err, detalle}`.
  `api/export/pdf/[id]/route.ts` emite con `{tenant, liquidacion}`.
- **Los server actions del encargado fallan cerrado y suben lo que no saben
  traducir**: `despacho/page.tsx:109-111` y `:145-147` hacen
  `err = codigoDeCaptura(e); if (err === null) throw e;` — un choque conocido se
  traduce al idioma del encargado, cualquier otra cosa sube y `onRequestError`
  la ve. Idéntico en `pod`, `incidencias` y `unidades`.
- **`deploy-vercel.sh` cerró bien la mitad de G-36**: valida el valor de
  `NEXT_PUBLIC_APP_URL` **antes** de desplegar (`:60-73`), aborta con mensaje
  útil, y el `echo` de `:78` ya no es un recordatorio sino un hecho («El deploy
  de abajo ya lo toma»).
- **Una máquina limpia ya queda corriendo**: `README.md:70-95` tiene los cuatro
  pasos reales, incluido `scripts/crear-superadmin.mjs`, y `seed.sh:40-46`
  imprime el mismo aviso al terminar. `DEPLOY.md:130-168` lo repite con la
  variante de producción. Era MEDIO REINCIDENTE en el pase 1 y está cerrado.
- **`.env.example` está vigilado por la suite de verdad**: `runbook.test.ts:61-95`
  comprueba las dos direcciones (nada que el código lea falta, nada declarado
  sobra), que no haya duplicados, y que no se prometan palancas inexistentes.
  Es el mejor mecanismo anti-deriva del repo.
- **`arranque.ts` mira el VALOR de `NEXT_PUBLIC_APP_URL`** (`:75-102`), con seis
  criterios y dos formas de cazar la URL efímera. `DASHBOARD_PASSCODE` salió de
  `SILENCIOSAS`, y el comentario de `:20-38` explica por qué con nombre y fecha.
- **`DEPLOY.md:34-49` ya nombra los mensajes correctos** —`startup.config_silenciosa`
  y `startup.entorno_grupos`, los dos que el guion del demo usa de semáforo—.
  Era el BAJO del pase 1 y está cerrado.
- **`DEPLOY.md:243-251` es honesto sobre lo que NO cubre** (nadie de guardia,
  ningún canal, ningún log drain). Prefiero un runbook que declare el hueco a
  uno que lo esconda; es parte de por qué la nota sube.
- **`logger.ts` y `sentry.ts` no se degradaron**: `digest` sigue exento de
  redacción (`CLAVES_NO_PII`), el `fingerprint` lleva el nivel además del mensaje
  (`sentry.ts:82`) para que un aviso y su desmentido no caigan en el mismo cubo,
  y `flushObservabilidad()` sigue esperado en los dos puntos donde se puede
  esperar (`instrumentation.ts:82`, `webhook/route.ts:90`).
- **`/api/demo` dejó de servir el mapa de configuración a cualquiera**:
  `route.ts:23-26` exige `superadmin` y responde **404** en vez de 401, con la
  razón escrita.

## Lo que NO alcancé a revisar

- **Qué valor tiene hoy `NEXT_PUBLIC_APP_URL` en Vercel, y cómo está el proyecto
  de Supabase** (Site URL, Redirect URLs, proveedor de Google, remitente SMTP
  real vs. el sandbox de Resend). Ahí vive la mitad del riesgo del hallazgo del
  dominio y no es visible desde el repo.
- **Qué deployment está publicado ahora mismo.** No tengo credenciales de Vercel
  y no hay ningún endpoint del producto que lo diga — que es precisamente el
  CRÍTICO.
- **Si el `ignoreCommand` de `master` se salta también en un *Redeploy* del
  panel de Vercel.** `DEPLOY.md` de `master` (`c547f24`) propone Redeploy como
  salida rápida; no pude comprobar si la plataforma reevalúa el `ignoreCommand`
  en ese camino. Si lo reevalúa, la salida rápida documentada no funciona.
- **Las ~30 páginas de `/admin` una por una.** Verifiqué que solo cuatro
  archivos de `/admin` llevan `'use server'` (`layout.tsx`, `mi-perfil/acciones.ts`,
  `mi-perfil/avatar-uploader.tsx`, `usuarios/nuevo/page.tsx`), leí `mi-perfil`,
  `observabilidad`, `salud-sistema` e `integraciones` completas, y no audité el
  resto buscando lecturas que descarten el `error`.
- **`operacion.ts` en el caso de «0 filas afectadas».** Vi que existe `tocadas()`
  (`:542-545`) y `exigirDelTenant()` (`:554-561`), que apuntan a que se cerró,
  pero no recorrí las siete escrituras comprobando que todas las usen. No lo doy
  por cerrado.
- **El log real de producción.** Todo lo de arriba es lectura de código y de la
  API de GitHub; no tengo acceso a `vercel logs`, así que no puedo decir qué
  líneas están saliendo hoy ni si Sentry tiene eventos.
- **Los dos hallazgos de la ronda 9 sobre `foto_pendiente`** (pérdida silenciosa
  de comprobante y colisión del `msg` `foto.pendiente_error`) tampoco los
  reverifiqué esta ronda. No los des por cerrados.
