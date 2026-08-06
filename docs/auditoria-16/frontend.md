# Frontend — auditoría 16

**Nota: 6/10** (ronda 15: 6.5/10). La vara no cambia: ¿aguanta que un contralor
de flota lo mire de frente, sin nadie explicándole, y que lo que lea sea
verdad?

**Razón del movimiento: la ronda 16 estrenó la feature del demo —ARCO de la
flota en /dashboard con envío por WhatsApp— repitiendo los patrones que las
rondas 13-15 ya habían cobrado.** El mensaje de éxito de la pantalla hermana
(`/admin/compliance`) quedó MINTIENDO: la ronda 15 lo arregló con "Likida no
envía mensajes ARCO todavía", y el commit c901226 implementó el envío… sin
tocar ese texto. La página nueva entró con **un error de eslint** (la primera
vez que un commit de frontend rompe eslint con un *error*, no un warning: el
`Date.now()` impuro de `vencenPronto`), **cero pruebas** (ningún archivo de
prueba toca `resolverSolicitudArco`/`enviarRespuestaArco`/la página), el
mismo **fail-open** que la doctrina del repo marcó CRÍTICO en la ronda 5
(`catch(() => [])` → "Ninguna solicitud ARCO registrada" estando ciego), el
mismo **patrón de action rota para el superadmin que previsualiza** (`?tenant=`
real → "la solicitud no existe en esta flota", el patrón que `operadores`,
`documentos`, `suscripcion`, `unidades`, `pod` e `incidencias` ya resuelven
con `resolverTenantPedido`), y un **placeholder literal "la flota"** como razón
social en la plantilla de respaldo. El demo no toca nada de eso —el tenant del
superadmin ES el demo, así que el envío sí cuadra—, pero la deuda de las
rondas 14-15 (columna de RFC, validación, `AvanceCierre ?? []`, `?rol=`, cruce
de breakpoint) sigue abierta y ahora con 2-4 rondas encima.

| Panel | Nota | Por qué |
|---|---|---|
| `/dashboard/arco` (NUEVO) | 5 | La feature del demo es honesta en su núcleo ("se envió" vs "NO se pudo enviar — entrégala por otro canal") y el envío falla cerrado. Pero entró con un error de eslint, sin una sola prueba, con fail-open en el listado, con el action roto para `?tenant=` real, sin gate de rol y con el placeholder "la flota" en la plantilla. |
| `/admin/compliance` | 5 | El CRÍTICO de la ronda 15 está cerrado (el superadmin ve todas las flotas). Pero el mensaje de éxito quedó mintiendo al implementarse el envío ("Likida no envía mensajes ARCO todavía" — sí envía), y el action ignora el resultado del envío. |
| `/dashboard` (dueño) | 7 | Intacto respecto a la 15: `AvanceCierre` sigue con `?? []` (3ª ronda), `?rol=` sigue perdiéndose en 7d/30d (3ª ronda). Nada nuevo. |
| `/dashboard/contador` | 6.5 | El fail-closed del 15% es real y con 3 pruebas. Pero la rama `elegible15 === false` sigue con dos restos del hallazgo de la 15: `efectivo_no_elegible` fuera de `ORDEN` (la cubeta por causa no lo lista) y el caso mixto sin CFDI que se pinta "Se recupera pidiendo la factura". |
| `/dashboard/operadores` | 5 | Sin cambios: columna de RFC corrida y captura sin validación, 3ª ronda. |
| `/chofer` (móvil) | 8 | Sin regresiones — la ronda 16 no lo toca. |

---

## Hallazgos por severidad

### [MEDIO] El mensaje de éxito de `/admin/compliance` quedó mintiendo al implementarse el envío — "Likida no envía mensajes ARCO todavía" ya no es cierto
`src/app/admin/compliance/page.tsx:45` — `return { ok: 'Solicitud marcada
como resuelta. La respuesta se entrega al titular por el canal que la flota
defina — Likida no envía mensajes ARCO todavía (anotado para la ronda
siguiente).' }` — contra `src/lib/cuadra/repo.ts:997-1001`:
`resolverSolicitudArco` ahora **sí** llama a `enviarRespuestaArco` e intenta
mandar la respuesta por WhatsApp. El texto de la ronda 15 (que era el fix
honesto del CRÍTICO de esa ronda) quedó obsoleto el mismo día que se
implementó el envío, y el action **ignora el resultado**: `await
resolverSolicitudArco(...)` sin mirar `{enviada, error}`, cuando la nueva
página `/dashboard/arco` sí lo distingue (`page.tsx:38-41`). El superadmin de
la consola —la pantalla que la flota usó hasta ayer— resuelve y le dicen "se
entrega por el canal que la flota defina" mientras el código acaba de mandar
(o intentó mandar) la respuesta por WhatsApp. Es la violación literal de "un
rótulo tiene que ser verdad" en una superficie legal, y es la segunda vez que
este mensaje miente (la ronda 15 lo arregló en una dirección; la 16 lo dejó
mentir en la otra).

**Escenario con valores.** Operador escribe PRIVACIDAD; queda la solicitud.
El superadmin abre `/admin/compliance`, responde "acceso parcial" y ve el
banner verde "…Likida no envía mensajes ARCO todavía". 400 ms antes, el
código intentó `sendText` al teléfono del titular (y si estaba dentro de la
ventana de 24 h, **sí le llegó**). Si Meta lo rechazó, nadie se entera desde
esta pantalla: el `{enviada: false, error}` se tira. La ronda 15 cobró el
CRÍTICO de esta pantalla; este es el mismo estándar de verdad, dos rondas
después, en la misma línea.

**Estado: abierto** (regresión introducida por c901226 al no tocar el texto
de 96f2adc).

### [MEDIO] El action de `/dashboard/arco` usa el tenant de sesión y no el `?tenant=` — el superadmin que previsualiza una flota real no puede resolver
`src/app/dashboard/arco/page.tsx:31-37` — `const s = await
requireSessionTenant(RUTA); … resolverSolicitudArco(s.tenantId, solicitudId,
resolucion)` — contra el patrón que el resto del dashboard ya usa para la
misma situación: `operadores/page.tsx:133,165`, `documentos/page.tsx:79`,
`suscripcion/page.tsx:91`, `unidades`, `pod`, `incidencias`:
`if (s.rol === 'superadmin' && sp?.tenant) { t = await
resolverTenantPedido(supabaseAdmin(), t, sp.tenant); }`. `requireSessionTenant`
devuelve para superadmin `tenantId: tenantDemo()` (`guard.ts:33`), así que
la página (que resuelve el tenant con `resolverTenantEfectivo`, el correcto)
muestra las solicitudes de la flota real, pero el action las busca bajo el
tenant demo.

**Escenario con valores.** Superadmin entra a "Ver dashboard" de Transportes
Innovativos → `/dashboard/arco?tenant=<uuid-real>`. La tabla muestra la
solicitud sembrada del demo… no, del uuid real. Escribe la resolución y
aprieta Responder. El action llama `resolverSolicitudArco(tenantDemo(),
solicitudId, ...)` → `.eq('tenant_id', tenantDemo)` → cero filas → throw
"resolverSolicitudArco: la solicitud no existe en esta flota" → el form
muestra ese error. Con `?vista=demo` funciona (el tenant de sesión ES el demo)
— por eso el demo de mañana no lo pilla; el primer superadmin que mire una
flota real sí.

**Estado: abierto** (introducido por c901226).

### [MEDIO] El listado ARCO falla abierto: base caída = "Ninguna solicitud ARCO registrada" en la pantalla legal
`src/app/dashboard/arco/page.tsx:47` — `const solicitudes = await
listarSolicitudesArco(tenantId).catch(() => []);` — y el render :72-76:
`solicitudes.length === 0` → EstadoVacio "Ninguna solicitud ARCO registrada.
Cuando un operador escribe *PRIVACIDAD*…". Es la familia exacta que la ronda 5
marcó CRÍTICO y que CLAUDE.md documenta ("una base caída se lee como 'no hay
nada'"). Las páginas hermanas del contador usan `safe()` + `AvisoDeFallo`
("no se pudo leer"); esta página eligió el fail-open. La pantalla hermana de
/admin hace lo mismo (`compliance/page.tsx:159,164` `.catch(() => [])`), pero
en la ruta nueva el coste es peor: la responsable obligada a contestar en 20
días hábiles (LFPDPPP art. 32) puede abrir la página durante un bache y
concluir que no tiene nada que responder — y no hay ni un rastro de que la
consulta falló.

**Escenario con valores.** Supabase cae a las 9:00 (como el 28-jul, token de
WhatsApp — cualquier bache). La flota abre /dashboard/arco: "Ninguna
solicitud ARCO registrada", "Por responder: 0", "Vencen pronto: 0". Hay dos
solicitudes `recibida`, una vence en 4 días hábiles. La flota no responde
ninguna; el vencimiento pasa; el titular reclama en el INAI y la flota dice
"nunca nos llegó nada" — y la pantalla que se lo dijo fue esta.

**Estado: abierto** (introducido por c901226; mismo patrón en compliance
desde la ronda 14).

### [MEDIO] La plantilla de respaldo manda el literal "la flota" donde debería ir la razón social
`src/lib/meta/client.ts:466-468` — `components: [{ type: 'body', parameters:
[{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }]` —
contra el comentario de la misma función (:455-457): "lleva {{1}} = razón
social de la flota y {{2}} = la respuesta". El código pasa la cadena literal
`'la flota'` como parámetro {{1}}; la razón social real (que el propio
`resolverSolicitudArco` tiene a mano vía `tenantId`) nunca se busca. Cuando
Meta apruebe la plantilla `respuesta_arco` (creada 6-ago, en revisión), todo
envío fuera de la ventana de 24 h entregará al titular "…atendida por la
empresa: la flota" — un nombre que no es la razón social de ninguna empresa
mexicana.

**Escenario con valores.** 10-ago: Meta aprueba la plantilla. Una solicitud
de cancelación llega un viernes; la flota responde el lunes (fuera de la
ventana de 24 h). El titular recibe la plantilla con {{1}} = "la flota" en
vez de "Transportes Innovativos, S.A. de C.V.". La respuesta legal que se
supone que identifica al responsable identifica a un genérico.

**Estado: abierto** (introducido por c901226).

### [MEDIO] El action de ARCO no tiene gate de rol, y el área 'operacion' se la da al encargado y se la niega al contador
`src/lib/auth/visibilidad.ts:76` — `'/dashboard/arco': 'operacion'` — contra
`src/app/dashboard/arco/page.tsx:29-45`: `accionResponder` solo pasa por
`requireSessionTenant` (cualquier sesión del tenant), sin `puedeAdministrar`.
Las páginas hermanas que mutan datos sí gatean: `operadores/page.tsx:160-163`
(`puedeAdministrar(s.rol)` → "Tu rol no puede editar operadores"). Resultado:
el **encargado** (jefe de tráfico — ve solo 'operacion' por diseño: ni
finanzas ni administración) ve la página en su sidebar y puede marcar una
solicitud ARCO como resuelta y mandar el WhatsApp en nombre de la empresa; el
**contador** —el rol que vive del papel y la declaración, y para el que esta
pantalla es naturalmente suya— está fuera: su área es 'dinero' y la ruta es
'operacion', así que `puedeVerRuta('contador', '/dashboard/arco')` es false y
`resolverTenantEfectivo` lo rebota. La matriz de roles que decide qué ACCIÓN
se ofrece (permisos.ts) ya tiene la respuesta: resolver un derecho ARCO es
administrar la cuenta, no despachar un viaje.

**Escenario con valores.** El dueño le da a su jefe de tráfico acceso al
panel (rol `encargado`, lo único que ve es operación). El sidebar le enseña
"Privacidad (ARCO)" con la lista de solicitudes (con teléfonos de operadores)
y el botón Responder. El encargado contesta una solicitud de cancelación de
datos "para ayudar" — y esa respuesta queda como la respuesta oficial de la
flota ante el INAI. El contador, que es quien lleva los plazos, ni ve la
página.

**Estado: abierto** (introducido por c901226).

### [MEDIO] La rama `elegible15 === false` de Deducciones sigue con dos restos del hallazgo de la ronda 15 — la cubeta por causa no la lista y el caso mixto se pinta "se recupera"
`src/lib/cuadra/fiscal.ts:352-357` — `ORDEN` sigue sin `efectivo_no_elegible`
— y `:337-339`: `if (o.elegible15 === false) push('efectivo_no_elegible');
else push('combustible_efectivo');`. El fix 96f2adc cerró la mitad del
hallazgo (el estado `undefined` ya no se pinta "perdida"), pero la rama
`false` quedó con los dos problemas que la ronda 15 describió dentro del
mismo hallazgo:

1. **No aparece en la cubeta.** `resumirPerdidas` (`fiscal.ts:425-438`) mete
   el dominante en `porCausaMapa` y luego filtra con `ORDEN`: un diésel en
   efectivo con CFDI de una flota declarada NO elegible tiene dominante
   `efectivo_no_elegible` (`cs[0]`, gravedad 'perdida' → entra a
   `montoPerdido`) pero la cubeta "Cuánto pesa cada causa"
   (`deducciones/page.tsx:194-198`) no lo pinta. La página misma lo advierte:
   "si las sumas por causa no cuadran con el total, el contador lo nota con
   una calculadora y deja de creerle a la pantalla".
2. **El caso mixto miente en la dirección buena.** Diésel en efectivo **sin
   CFDI** de una flota no elegible: `causasDe` empuja `['sin_cfdi',
   'efectivo_no_elegible']` y `causaDominante` elige `sin_cfdi` (está en
   ORDEN, 'recuperable') → la fila dice "Se recupera pidiendo la factura"
   (`TEXTO_GRAVEDAD['recuperable']`). La factura **no** la salva: el efectivo
   en combustible de esa flota no es deducible con o sin CFDI (LISR 27-III),
   y el motor lo escribe `efectivo_no_elegible` "no deducible" en la
   liquidación.

**Escenario con valores.** Flota que declara `dedicacionExclusivaCarga:false`
(edición de la ronda 14). Un viaje con diésel de $4,200 en efectivo, **sin**
CFDI. El motor: `efectivo_no_elegible`, monto completo, "no deducible". El
panel de Deducciones: "**$4,200 · Se recupera pidiendo la factura**" en la
fila, y la causa que de verdad lo condena no aparece en la cubeta por causa.
El contralor cruza el PDF contra el panel y ve "no deducible" contra "se
recupera" para el mismo comprobante — la familia de dos estándares que la
ronda 13 cerró en el IVA y la 14-15 en el 15%.

**Estado: abierto** (resto del MEDIO de la ronda 15; el fix 96f2adc solo
cubrió el branch `undefined`; cero pruebas: `grep efectivo_no_elegible` en
fiscal.test.ts solo devuelve un comentario en :30-31).

### [MEDIO] La captura de RFC del operador sigue en la columna equivocada de su propia tabla — TERCERA ronda, sin cambios
`src/app/dashboard/operadores/page.tsx:243` — `<th>RFC (RLISR 57)</th>` como
columna 8 del encabezado — contra el cuerpo `:260-267`: la celda
`FormaConAviso accion={accionRfc}` con el input `name="rfc"` se pinta
inmediatamente después de "Teléfono" (`:258`), posición 3, justo debajo del
`<th>Licencia</th>` (`:238`). El action que la sirve sí gatea el rol
(`puedeAdministrar`, `:160-161`). Ningún commit de la 15 ni de la 16 tocó este
archivo.

**Escenario con valores (igual que las rondas 14-15).** Tabla con `veDinero`:
encabezado Operador · Teléfono · Licencia · Viajes · Anticipo · Comprobado ·
% · **RFC (RLISR 57)** · Estado; cuerpo Operador · Teléfono · **input de RFC**
· Licencia · Viajes · Anticipo · Comprobado · % · Estado. Todo lo que está
entre Licencia y Estado se corre una columna; el contralor teclea el RFC bajo
"Licencia". Con `!veDinero` (encargado) pasa igual (6 columnas cada lado).
Sigue sin prueba que lo atrape.

**Estado: abierto** (rondas 14, 15 y 16).

### [MEDIO] La captura de RFC no valida nada — TERCERA ronda, sin cambios
`src/app/dashboard/operadores/page.tsx:157-168` — `const rfc =
String(fd.get('rfc') ?? '').trim().toUpperCase(); … actualizarRfcOperador(t,
operadorId, rfc || null)` — y `:263` `maxLength={13}`. No pasa por
`esRfcValido`/`rfcChecksumOk` (que existen y se usan en el alta de flota,
`administracion.ts:98`). Un typo convierte viáticos legítimos en "no
deducible": el motor compara `norm(g.rfcReceptor)` contra `rfcsOk` y contra
`rfcOperador` (`engine.ts:479,488-489`) y un RFC mal tecleado cae a la rama
`rfc_receptor`.

**Escenario con valores (igual que las rondas 14-15).** Operador con RFC real
`PERE880101XXX`; el capturista teclea `PERE880101XYY`. Se guarda tal cual.
Cada viático de ese operador, timbrado a su RFC real, se descarta "con
certeza" desde entonces. Un RFC mal tecleado es peor que ninguno (la nota del
propio motor dice que SIN RFC no se puede confirmar NI descartar).

**Estado: abierto** (rondas 14, 15 y 16).

### [MEDIO] `AvanceCierre` sigue afirmando "No hay viajes iniciados en este periodo" con la consulta caída — TERCERA ronda
`src/app/dashboard/page.tsx:151` — `<AvanceCierre viajes={viajes ?? []}
ahoraMs={ahoraMs()} />` — y `src/app/dashboard/inicio-operacion.tsx:94`
(ídem). `estadoPanel` propaga bien el fallo y el cuerpo dice "esto NO
significa que no haya liquidaciones", pero el encabezado sirve la barra con
`[]`: `datos.dentro === 0` → "**No hay viajes iniciados en este periodo.**"
(`avance-cierre.tsx:124`) — una afirmación positiva de ausencia a 20 px del
texto que dice que no se pudo leer nada. El `?? []` convierte el fallo en
ausencia: la doctrina que la ronda 5 marcó CRÍTICO.

**Estado: abierto** (rondas 14, 15 y 16).

### [MEDIO] `?rol=` se pierde al tocar 7d/30d y la previsualización "ver como encargado" se voltea al panel del dinero — TERCERA ronda
`src/app/dashboard/page.tsx:239` — `extra={sp?.tenant ? { tenant: sp.tenant }
: sp?.vista ? { vista: sp.vista } : undefined}` — y `src/app/dashboard/
analitica/page.tsx:51-52` (ídem): el `GlobalFilter` construye la URL sin
`?rol=`, mientras `sufijo.ts:20-25` y `sidebar-nav.tsx:81-82` sí lo arrastran.
Bonus vigente: el tipo de `searchParams` de analitica (`:32`) ni siquiera
declara `rol`.

**Escenario con valores (el de las rondas 14-15, sin cambios).** Javier entra
a "Entrar a los otros paneles" → Jefe de tráfico →
`/dashboard?vista=demo&rol=encargado`: se pinta `InicioOperacion` (cero
pesos, correcto). Toca "30d": `/dashboard?vista=demo&rango=30` — sin rol. El
server re-resuelve `rolEfectivo('superadmin', undefined)` = 'superadmin' →
`puedeVerArea('superadmin','dinero')` = true → se pinta el panel del DUEÑO con
el dinero completo, y la cinta solo dice "Estás previsualizando el panel del
cliente". En analitica pasa igual.

**Estado: abierto** (rondas 14, 15 y 16; era condición #2 del veredicto de la
14).

### [MEDIO] El cruce de breakpoint con el asistente expandido sigue abierto — QUINTA ronda, en las dos instancias
`src/app/dashboard/rail.tsx:89` (`hidden xl:flex` + estado `expandido` que
solo se limpia al desmontar, `:46-49`), `src/app/globals.css:217-222`
(`:root[data-asistente="expandido"] .columna-centro { opacity: 0;
pointer-events: none }`) y `src/app/admin/asistente-expandible.tsx:45,61`
(`flex: expandido ? '0 1 0%' : '1 1 0%'` + `opacity: expandido ? 0 : 1`, aside
`hidden xl:flex`). Ninguno tiene un `matchMedia('(min-width: 1280px)')`
(verificado con grep: cero coincidencias).

**Escenario con valores (el de las rondas 12-15, sin cambios).** Laptop a
1366 px: Javier expande el asistente y conecta el proyector a 1024 px. El
aside pasa a `display:none` pero sigue montado: en /dashboard la marca sigue
en `<html>` y la columna queda `opacity:0`; en /admin el estado React sigue
`true` y el main queda `flex: 0 1 0%` con `opacity:0`. El botón "Contraer"
vive dentro del aside oculto. Única salida: recargar — delante del cliente.

**Estado: abierto** (rondas 12/13/14/15/16).

---

### [BAJO] La feature ARCO de la ronda 16 entró con un ERROR de eslint — y los fixes siguen sin pasar eslint
`src/app/dashboard/arco/page.tsx:49` — `new Date(Date.now() + 5 * 864e5)` en
el cuerpo del componente → **`error react-hooks/purity: Cannot call impure
function during render`** (verificado: `npx eslint src/` = 1 error, 21
warnings). Es la primera vez que un commit de frontend rompe eslint con un
error y no un warning; el patrón que las rondas 13-15 anotaron ("los fixes de
frontend no pasan eslint") escaló. El `Date.now()` correcto iría por
`ahoraMs()` de `lib/saludo` o se inyectaría desde el server. Además siguen los
warnings de las rondas anteriores: `desde_db.ts:9` (`supabaseAdmin` sin usar,
ronda 14), `stripe/webhook/route.test.ts:17` (`desmarcar`, ronda 14), los 6 de
`admin/page.tsx` (ronda 13), y uno NUEVO de la ronda 15:
`admin/compliance/page.tsx:6` (`listarSolicitudesArco` importado y sin usar
desde que `datosDeCompliance` usa `traerTodo` directo). El mensaje del commit
c901226 dice "build limpio" — `next build` no corre eslint, y la única
herramienta que lo atrapa sigue sin estar en el camino del commit.

**Estado: abierto** (error nuevo de c901226 + warnings acumulados).

### [BAJO] "Vencen pronto (≤ 5 días hábiles)" sigue contando días calendario — y la página nueva repite el cálculo
`src/app/admin/compliance/page.tsx:63` (rótulo) contra `:179` —
`new Date(Date.now() + 5 * 864e5)` — cinco días de reloj, no hábiles; el
vencimiento ARCO se calcula en hábiles (`privacidad.ts:618` `venceArco`).
Un viernes, una solicitud que vence el miércoles siguiente (3 hábiles) no
aparece; una que vence en 6 días calendario (4 hábiles) sí. La página nueva
(`arco/page.tsx:49,65`) copió el mismo cálculo con el rótulo ya sin "hábiles"
("≤ 5 días") — el rótulo ahora es honesto, pero el KPI de "Vencen pronto" en
ambas pantallas no coincide con la urgencia real en días hábiles que la ley
manda.

**Estado: abierto** (ronda 15 en /admin; copiado a /dashboard en la 16).

### [BAJO] El Gauge del 15% se sigue pintando para flotas sin la facilidad — el texto ya honra la declaración, el arco no
`src/app/dashboard/contador/combustible/page.tsx:147-152` — el `ChartCard`
"Efectivo en combustible contra el 15%" pinta el `Gauge` y el `StatusPill`
(`ESTADO_TOPE[tope.estado]`: "Holgado"/"Cerca del tope"/"Excedido") **antes**
de los branches de elegibilidad de `:155-165`. Para una flota que declaró
`false` o que no ha declarado, el texto de abajo ya es honesto ("La flota
declaró que NO califica…", "…sale a revisión…"), pero el arco arriba sigue
midiendo "X% del combustible pagado en efectivo" contra un "Tope legal: 15%"
que para esa flota no existe, y el pill puede decir "Excedido" sobre una
facilidad que la ley le niega. Es el resto visual del MEDIO que la ronda 15
cerró en el texto.

**Estado: abierto** (residual de la ronda 15).

### [BAJO] El box "Smart Insight" en error sigue a ~4.26:1
`src/app/dashboard/rail.tsx:118-119` — `color: var(--color-warn)` (#a16207)
sobre `color-mix(in srgb, var(--color-warn) 10%, transparent)`: ≈ 4.26:1, AA
pide 4.5:1 para texto de 10 px. Sin cambios desde la ronda 13.

**Estado: abierto** (rondas 13/14/15/16).

### [BAJO] La línea de términos del login sigue a ~2.9:1
`src/app/login/page.tsx:186` — `text-[#6b6b6b]/70` a 11 px: ≈ 2.9:1. Sin
cambios.

**Estado: abierto** (rondas 12/13/14/15/16).

### [BAJO] `inicio-operacion.tsx` sigue declarando un scroll que no implementa
`src/app/dashboard/inicio-operacion.tsx:72-79` — "Con `h-full` + `min-h-0` en
la cadena…" — contra el markup real en `:80`: `glass-panel overflow-hidden
shrink-0`. Sin cambios.

**Estado: abierto** (rondas 12/13/14/15/16).

### [BAJO] `--faint` sobre `--canvas2` en 4.4987:1 — latente, sin cambios
`globals.css` (`--faint:#73737c`, `--canvas2:#fafafa`), usado en `kit.tsx:144`
(`ChartCard soft`). Sigue sin usarse en páginas vivas. Verificado con grep.

**Estado: abierto (latente).**

### [BAJO] Cero pruebas para toda la feature ARCO de la ronda 16
Verificado con grep: ningún `*.test.*` referencia `resolverSolicitudArco`,
`enviarRespuestaArco`, `listarSolicitudesArco` ni `registrarSolicitudArco`; la
página `/dashboard/arco` no tiene test; `visibilidad.test.ts` no cubre la
ruta nueva. El commit que estrena la superficie legal del demo —envío de
WhatsApp incluido— no tiene una sola prueba del camino feliz ni del fail
cerrado. Es el mismo hueco que la ronda 15 anotó para la pantalla ARCO de
/admin, ahora con más código encima (el envío y sus dos ramas de error).

**Estado: abierto** (introducido por c901226).

### [BAJO] La solicitud queda 'resuelta' antes del envío y no hay reintento — el "otro canal" es terminal
`src/lib/cuadra/repo.ts:989-993` marca `estado:'resuelta'` ANTES del envío
best-effort. Si el envío falla (fuera de la ventana de 24 h, plantilla sin
aprobar, número no whitelisted), la UI dice "entrégala por otro canal" y el
form desaparece (la fila ya pinta la resolución como texto). No hay botón de
reintentar el envío ni registro del fallo en la base: la flota que quiera
intentarlo de nuevo —o el superadmin que resuelva desde /admin, que ni se
entera de que falló— no tiene camino. Honesto, pero de una sola vía.

**Estado: abierto** (introducido por c901226).

---

## Verificación de los cierres de la ronda 15 (uno por uno, contra el código ACTUAL)

- **[CRÍTICO] ARCO en /admin — CERRADO (96f2adc), verificado.** `datosDeCompliance`
  ya no filtra por tenant: `compliance/page.tsx:145-152` usa `traerTodo` sobre
  TODAS las solicitudes con el join `flota:tenant_id(nombre)` y la columna
  "Flota" se pinta (`:88,98`). El superadmin ya no ve una pantalla siempre
  vacía. **PERO** el texto de éxito que 96f2adc puso como fix quedó mintiendo
  5 horas después, cuando c901226 implementó el envío (MEDIO arriba).
- **[ALTO] Fail-closed del contador del 15% — CERRADO (96f2adc), verificado
  y con prueba.** `engine.ts:313-330`: contador sin datos o comprobante de
  otro ejercicio → `combustible_efectivo` con `monto: 0`, nota "no se pudo
  calcular… No se afirma deducible ni no deducible", `continue`. Corrí las 3
  pruebas nuevas (`engine.test.ts:1523-1561`): verdes (117 tests del archivo).
  `desde_db.ts:70-84` inyecta ceros best-effort con catch, y el comentario
  "la rama 'sin datos del ejercicio' marca el efectivo para revisar" ahora
  describe una rama que SÍ existe — el hallazgo de la ronda 15 sobre el
  comentario que describía una rama inexistente quedó cerrado de paso.
- **[MEDIO] "Sin declarar" ya no se pinta como perdida — CERRADO (96f2adc),
  verificado.** `fiscal.ts:337-339`: `false` → `efectivo_no_elegible`
  (perdida); `undefined` y `true` → `combustible_efectivo` (en_riesgo). El
  estado `undefined` ya no entra a `montoPerdido`. **Pero** la rama `false`
  quedó con los dos restos del MEDIO arriba (ORDEN + caso mixto).
- **[MEDIO] El recuadro del 15% del panel — CERRADO (96f2adc), verificado.**
  `combustible/page.tsx:155-165`: tres branches por `opts.elegible15` con
  textos honestos (false → "declaró que NO califica"; undefined → "sale a
  revisión… declárala"). El Gauge arriba sigue pintándose (BAJO arriba).
- **[MEDIO] tools.ts / desde_db.ts mismo año — CERRADO (96f2adc), verificado.**
  `tools.ts:107-109` ancla en `viajeCtx.fechaInicio`; `desde_db.ts:63-66` en
  `viaje.fechaInicio`. Los dos alimentan `getAcumuladoCombustible` con el
  mismo año.
- **[MEDIO] actualizarFacilidad15 lee el error — CERRADO (96f2adc),
  verificado.** `repo.ts:925-929`: `if (errLee) throw`. Un bache de red ya no
  reemplaza la config entera.
- **[MEDIO] Columna RFC — ABIERTO** (3ª ronda, MEDIO arriba).
- **[MEDIO] RFC sin validación — ABIERTO** (3ª ronda, MEDIO arriba).
- **[MEDIO] AvanceCierre `?? []` — ABIERTO** (3ª ronda, MEDIO arriba).
- **[MEDIO] `?rol=` en GlobalFilter — ABIERTO** (3ª ronda, MEDIO arriba).
- **[MEDIO] Cruce de breakpoint asistente — ABIERTO** (5ª ronda, MEDIO arriba).
- **[BAJO] Smart Insight / login / scroll / `--faint` — ABIERTOS**, sin
  cambios. eslint pasó de 13 warnings a **1 error + 21 warnings** (el error
  es de la feature nueva de la 16; el import muerto de compliance es de la
  15).

## Lo que revisé y está bien (verificado en el código ACTUAL, con prueba)

- **El envío ARCO falla cerrado y la UI lo dice.** `repo.ts:997-1005`: si el
  envío falla, devuelve `{enviada: false, error}` y la página de /dashboard
  lo traduce a "La respuesta NO se pudo enviar por WhatsApp (…) — entrégala
  al titular por otro canal" (`arco/page.tsx:40-41`). Nunca "recibió su
  respuesta". El envío va al `titular_ref` que el webhook guardó (el teléfono
  del operador, `processor.ts:157-163`), pasando por `destinatarioWhatsApp`
  (el "1" mexicano se corrige: `client.ts`).
- **El mensaje de éxito de la página NUEVA es honesto** — `arco/page.tsx:38-41`
  distingue "se envió" de "no se pudo", a diferencia del de /admin.
- **El fail-closed del 15% es real end-to-end** — motor (`engine.ts:313-330`),
  desde_db (ceros + catch), tools (año del viaje), y 3 pruebas nuevas verdes.
  El escenario de la ronda 15 ("NO se deduce contra un tope de $0") ya no se
  puede producir: lo verifiqué con las pruebas y con la rama.
- **`estadoPanel` y la CifraGrande intactos** — `estado.test.ts` (14) y
  `cifra-grande.test.tsx` (3) verdes; el branch `valor === undefined → '—'`
  sigue sin prueba propia (deuda de la ronda 13, sin cambios).
- **El alta tri-estado y la edición de la facilidad siguen bien** —
  `flotas/page.tsx`, `administracion.ts:115-120`, `repo.ts:921-931`
  (borra con error de lectura comprobado), `negocio.ts:230`.
- **La regla del formato sigue viva** — el único `toLocaleString('es-MX')`
  real fuera de `lib/formato.ts` no existe (los grep hits son comentarios y
  la prueba estructural `lib/pruebas/codigo.ts`).
- **Pruebas del rubro en verde** — corrí `engine` (117), `fiscal` (57),
  `estado` (14), `avance-cierre` (4), `cifra-grande` (3), `aviso` (6),
  `visibilidad` (90), `tenant-efectivo` (45), `formato` (21), `contador`
  (5), `administracion` (27), `analytics_por_dia` (3), `repo_operadores`
  (5), `etiquetas_panel` (3) y el batch de `foto_no_expuesta`/`contraste`/
  `dinero_por_area`/`formato` (31) — **~433 verdes, 0 rojos**.
- **tsc del código commiteado: limpio** — el único error de `npx tsc
  --noEmit` está en `src/lib/cuadra/cuadre/zzz-aud16-probe3.test.ts`
  (archivo SIN commit de otro auditor; `PoliticaGasto` no existe en
  `@/types/cuadra`). No lo toqué.

## Lo que no alcancé a revisar

1. **El render visual.** No levanté preview headless esta ronda (las páginas
   están detrás de sesión y otros auditores corren la suite). La columna de
   RFC y el Gauge del 15% son verificables en markup; el render de
   `/dashboard/arco` con la solicitud sembrada del demo merece una captura
   antes de proyectar la pantalla.
2. **El envío real de la respuesta ARCO en el demo** — depende de la base
   real (solicitud sembrada, ventana de 24 h, whitelist de Meta). El código
   falla cerrado; el guion (GUION_DEMO.md) **no menciona la pantalla ARCO** —
   si el demo la enseña, la narración está por escribir.
3. **~15 páginas de /dashboard** (clientes, cobranza, suscripción, cotizador,
   mapa, políticas, rentabilidad, soporte, usuarios, incidencias, pod,
   unidades, viajes, documentos, chat). Verifiqué el patrón, no línea por
   línea.
4. **El `searchParams` del arco con `?rol=`** — la página nueva no tiene
   links internos, así que no sufre el bug del GlobalFilter; pero no probé la
   previsualización "como contador" (rebota por área) en el navegador.
5. **Los probes `zzz-*` de otros auditores** (sin commit, en el working tree)
   rompen tsc y agregan pruebas a la suite; no los borré ni los conté en el
   total del rubro.

---

## VEREDICTO

**Green light para el demo — el camino que el guion toca está sano y el
fail-closed del 15% quedó de verdad — pero la ronda 16 estrenó su feature
estrella repitiendo cada patrón que las rondas 13-15 cobraron, y la deuda de
los hallazgos abiertos cumplió 2-4 rondas.**

Lo que el demo enseña funciona: el panel del dueño con el seed, el contador
con la flota declarada true/true (las tres superficies coinciden), el motor
fail-closed con su nota honesta, y el ARCO de la flota en /dashboard con
envío best-effort y mensaje honesto — el tenant del superadmin ES el demo, así
que ni el mismatch de `?tenant=` ni el placeholder "la flota" se ven mañana.
Pero la feature nueva entró con un error de eslint (primera vez que un commit
rompe eslint con error, no warning), cero pruebas, fail-open en el listado
legal, un action que no resuelve el `?tenant=` real (el patrón que seis
páginas hermanas ya resuelven), sin gate de rol, y dejó a la pantalla de
/admin con un mensaje que miente en la dirección contraria a la que la ronda
15 acababa de arreglar.

Condiciones antes de proyectar:

1. **Si se enseña `/dashboard/arco`**, sabes que el envío puede fallar en la
   sala (ventana de 24 h, plantilla en revisión) — la UI lo dice bien, pero
   narra el "entrégala por otro canal" con naturalidad. Y no hay GUION_DEMO
   para esta pantalla: está por escribir.
2. **Si se enseña `/dashboard/operadores`**, la columna de RFC sigue corrida
   (3ª ronda; el input cae bajo "Licencia"). El fix es mover la celda
   `FormaConAviso` de `operadores/page.tsx:260-267` a después de la celda de
   "% comprobado".
3. **Si alguien toca 7d/30d previsualizando "Jefe de tráfico"**, la pantalla
   se voltea al panel del dueño con el dinero (3ª ronda; una línea en
   `page.tsx:239` y `analitica/page.tsx:51`: incluir `rol` en `extra`).
4. **Si se demuestra `/admin/compliance`**, el mensaje "Likida no envía
   mensajes ARCO todavía" es falso desde el commit c901226; hay que
   actualizarlo al vocabulario de la página nueva ("se envió" vs "no se
   pudo") o se repite en la sala la mentira que la ronda 15 cerró.

La suite no protege nada de esto: la feature ARCO completa —página, action,
envío, plantilla— no tiene una sola prueba, `efectivo_no_elegible` sigue sin
test en todo el repo, el branch `undefined→'—'` de la CifraGrande sigue sin
prueba, y el commit de la ronda 16 entró con eslint en rojo. Los ~433 tests
que corrí están verdes; miden lo que miden.
