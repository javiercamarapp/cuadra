# Frontend — auditoría 15

**Nota: 6.5/10** (ronda 14: 7/10). La vara no cambia: ¿aguanta que un contralor
de flota lo mire de frente, sin nadie explicándole, y que lo que lea sea
verdad?

**Razón del movimiento: el ALTO de la ronda 14 se cerró de verdad —y a medias
el resto.** El commit 8a33ce1 negó el IVA del diésel en efectivo en el panel
del contador (verificado en `ivaSostenible`), implementó el alta tri-estado y
la edición de la declaración del 15% en la consola, y llevó la elegibilidad a
`causasDe`, `avisoTope15` y la tool de chat. Pero la mitad del mismo hallazgo
que la ronda 14 anotó —**el recuadro "Efectivo en combustible contra el 15%" de
`combustible/page.tsx`, el que la nota de la ronda 14 llamó "el recuadro del
15%"— no se tocó**: una flota no elegible (o sin declarar) sigue viendo el
Gauge y "Todavía caben $X…" de una facilidad que no tiene. Y el tri-estado que
sí se implementó destapó una contradicción NUEVA entre el panel y el motor:
para el estado "sin declarar" (`undefined`), el motor dice "por confirmar, no
se afirma nada" y el panel dice "ya no se recupera". La pantalla ARCO nueva
(commit d7b171f) llegó con una frase falsa en su propio éxito ("El titular
recibió su respuesta por WhatsApp" — no se manda nada) y sin una sola prueba.
Los dos MEDIOs de la ronda 14 que eran condiciones del demo —la columna de RFC
desalineada y el `?rol=` que se pierde en 7d/30d— siguen exactamente igual,
segunda ronda. El breakpoint del asistente cumple su **cuarta** ronda abierto.

| Panel | Nota | Por qué |
|---|---|---|
| `/dashboard` (dueño) | 7 | El estado honesto, la CifraGrande con "—" y los cierres de la 13 siguen intactos; pero `AvanceCierre` sigue mintiendo con la consulta de viajes caída (`?? []`, 2ª ronda) y el `?rol=` sigue volteando la previsualización del encargado al panel del dinero (2ª ronda). |
| `/dashboard/contador` | 6 | El ALTO de la 14 (IVA del diésel en efectivo) quedó cerrado y verificado. Pero el recuadro del 15% sigue ignorando la elegibilidad (la mitad que el fix no tocó), y para flotas "sin declarar" el panel dice "ya no se recupera" donde el motor dice "por confirmar" — la misma familia de dos estándares que esta ronda cerró en el IVA. |
| `/dashboard/operadores` | 5 | La desalineación de la columna de RFC y la falta de validación siguen igual (2ª ronda): el input bajo "Licencia" y un typo que descarta viáticos válidos. Ningún commit de la 14 las tocó. |
| `/admin` | 6 | El alta tri-estado y la edición de la declaración funcionan (verificado); el ARCO llegó con un mensaje de éxito falso y sin pruebas; el cruce <1280 px del asistente expandido sigue abierto (4ª ronda). |
| `/chofer` (móvil) | 8 | Sin regresiones — los commits de la 14 no lo tocan. |

---

## Hallazgos por severidad

### [MEDIO] El recuadro del 15% de `combustible/page.tsx` sigue ignorando la declaración de elegibilidad — la mitad del MEDIO de la ronda 14 que el fix no tocó
`src/app/dashboard/contador/combustible/page.tsx:75` — `const tope = gastos && opts
? tope15DeGastos(gastos, opts) : null;` — y `src/lib/cuadra/fiscal.ts:609-618`
(`tope15DeGastos` calcula `evaluarTope15({efectivo, totalCombustible})` sin leer
jamás `o.elegible15`). El commit 8a33ce1 arregló "las superficies con la
elegibilidad" que su propio mensaje lista —`causasDe`, `avisoTope15`, el chat—
pero **no esta página**, y es justo la que la ronda 14 describió como "el
recuadro del 15% ignora la declaración de elegibilidad". El `ESTADO_TOPE` de
:92-97 tiene cuatro estados (holgado/cerca/excedido/sin_criterio) y ninguno
mira la declaración; el Gauge (:149-152) y el texto "Todavía caben $X" (:166-168)
se pintan igual para una flota elegible, una no elegible y una sin declarar.

**Escenario con valores.** Flota que declara `dedicacionExclusivaCarga:false`
(edición de la consola, ronda 14) o nunca declara (todas las flotas de
producción anteriores a la feature). Paga $4,200 de diésel en efectivo con CFDI
en el ejercicio. El motor la clasifica `efectivo_no_elegible` ("no deducible")
o `combustible_efectivo` ("por confirmar") en cada liquidación; la página de
Deducciones enseña la causa con su gravedad; **pero la pestaña Combustible del
mismo panel enseña el Gauge con "Todavía caben $X de combustible en efectivo
dentro del periodo sin pasarse"** — la facilidad que la ley le niega a esa
flota. El contralor ve en una pestaña "esto no es deducible" y en la otra "te
queda cupo dentro del 15%". Con el seed del demo no se ve (declaró true/true);
se ve con cualquier flota real que no haya pasado por el alta nueva.

**Estado: abierto** (es la segunda mitad del MEDIO de la ronda 14, sin tocar).

### [MEDIO] "Sin declarar" se lee distinto en el motor y en el panel — el tri-estado que la ronda 14 pidió destapó una contradicción nueva
`src/lib/cuadra/fiscal.ts:337` — `push(o.elegible15 === true ?
'combustible_efectivo' : 'efectivo_no_elegible')` — con el comentario "Mismo
estándar que el motor" que no es cierto: el motor distingue TRES estados y
`undefined` ("sin declarar") cae a `combustible_efectivo` **por confirmar** con
`monto: 0` (`engine.ts:341-346`: "sin esa declaración esto se revisa. No se
afirma nada" — el tipo está en `POR_CONFIRMAR`, no en `NO_DEDUCIBLE_ISR`), pero
el panel manda `undefined` a `efectivo_no_elegible`, que es **gravedad
'perdida'** ("Ya no se recupera", `fiscal.ts:279-284`) y suma el monto a
`montoPerdido`. El estado `undefined` es alcanzable y ahora está declarado en
la UI: el alta sin marcar (`flotas/page.tsx:38-39`) y la edición con "—"
(`flotas/page.tsx:56-70`) lo producen explícitamente.

Agrava el mismo hallazgo la omisión de `efectivo_no_elegible` de `ORDEN`
(`fiscal.ts:352-357`): la cubeta "Cuánto pesa cada causa" de Deducciones
(`deducciones/page.tsx:194-222`) se construye con `ORDEN`, así que la causa
nueva de la RFA 2.9 —la que esta ronda entera existe para decidir— **no aparece
en el desglose por causa**, mientras sus pesos SÍ entran a `montoPerdido`. Y en
el caso mixto (diésel en efectivo sin CFDI de una flota no elegible), `causasDe`
empuja `['sin_cfdi', 'efectivo_no_elegible']` y `causaDominante` elige `sin_cfdi`
→ "Se recupera pidiendo la factura" (`deducciones/page.tsx:79-81`): la factura
**no** la salva (el efectivo sigue sin ser deducible para esa flota). El propio
comentario de la página dice "si las sumas por causa no cuadran con el total,
el contador lo nota con una calculadora y deja de creerle a la pantalla" — y
con una sola flota sin declarar, no cuadran.

**Escenario con valores.** Flota sin declarar (ninguna de producción lo está),
un viaje con diésel de $4,200 en efectivo, CFDI vigente. El motor escribe en la
liquidación `combustible_efectivo` (monto 0): "se revisa", `totalNoDeducible`
sin los $4,200, estatus `revisar`. El panel del contador (pestaña Deducciones)
enseña "**$4,200 · Ya no se recupera**" y la cubeta por causa no lo lista. El
contador que cruza su PDF contra el panel ve el mismo comprobante "por
confirmar" en uno y "perdida" en el otro. Es la familia exacta de "mismo
hecho, dos estándares" que la ronda 13 cerró (37d75ee) y la 14 en el IVA.

**Estado: abierto** (introducido por el fix 8a33ce1; cero pruebas: `grep
efectivo_no_elegible` en `fiscal.test.ts` no devuelve ni un test).

### [MEDIO] El mensaje de éxito del ARCO afirma que el titular recibió su respuesta por WhatsApp — no se manda nada
`src/app/admin/compliance/page.tsx:45` — `return { ok: 'Solicitud marcada como
resuelta. El titular recibió su respuesta por WhatsApp.' }` — contra
`src/lib/cuadra/repo.ts:969-975`: `resolverSolicitudArco` solo hace un `update`
a `solicitud_arco` (`estado:'resuelta', resuelta_en, resolucion`). No hay un
solo `sendText` en el camino; lo verifiqué con grep (`PRIVACIDAD` solo aparece
en `processor.ts`/`privacidad.ts`, que es la ruta de REGISTRO, no la de
resolución). La pantalla de cumplimiento es la que la flota —responsable
obligada a contestar en 20 días hábiles, LFPDPPP art. 32— usa para dar su
respuesta, y le afirma al superadmin que ya se le notificó al titular.

**Escenario con valores.** Un operador escribe PRIVACIDAD (se registra la
solicitud y recibe el acuse inicial con los datos del responsable). El
superadmin abre `/admin/compliance`, escribe "Se respondió acceso parcial:
se le envió el historial…" y ve el banner verde "El titular recibió su
respuesta por WhatsApp". El operador **no recibe nada**: la respuesta vive
solo en la base y en esta consola. Si el titular ejerce su derecho en el
INAI —"nunca me respondieron"— la flota cree tener constancia de entrega que
no existe. El fix honesto es mínimo: "Quedó registrada la resolución. Falta
notificar al titular (el envío por WhatsApp no está construido)" o
implementar el `sendText`.

**Estado: abierto** (superficie nueva de la ronda 14, commit d7b171f).

### [MEDIO] La captura de RFC del operador sigue en la columna equivocada de su propia tabla — segunda ronda, sin cambios
`src/app/dashboard/operadores/page.tsx:243` — `<th>RFC (RLISR 57)</th>` como
columna 8 del encabezado (después de "% comprobado") — contra el cuerpo
`:259-267`: la celda `<FormaConAviso accion={accionRfc}>` con el input
`name="rfc"` se pinta inmediatamente después de "Teléfono" (`:258`), posición 3.
Ningún commit de la ronda 14 tocó este archivo (`git log -- operadores/page.tsx`
— el último cambio es 5ef6993).

**Escenario con valores (igual que la ronda 14).** Tabla con `veDinero`:
encabezado Operador · Teléfono · Licencia · Viajes · Anticipo · Comprobado · %
· **RFC (RLISR 57)** · Estado; cuerpo Operador · Teléfono · **input de RFC** ·
Licencia · Viajes · Anticipo · Comprobado · % · Estado. Todo lo que está entre
Licencia y Estado se corre una columna; el contralor teclea el RFC bajo
"Licencia". Con `!veDinero` (encargado) pasa igual (6 columnas cada lado). Es
la violación literal de "un rótulo tiene que ser verdad" a nivel de tabla, y
era la **condición #1 del veredicto de la ronda 14** si se enseña Operadores en
el demo. Sigue sin prueba que la atrape.

**Estado: abierto** (rondas 14 y 15).

### [MEDIO] La captura de RFC no valida nada — segunda ronda, sin cambios
`src/app/dashboard/operadores/page.tsx:168` — `const rfc = String(fd.get('rfc')
?? '').trim().toUpperCase();` y `:265` `maxLength={13}` — el action guarda
`rfc || null` sin pasar por `esRfcValido`/`rfcChecksumOk`, que existen y se
usan en el alta de flota (`administracion.ts:98`: "EL RFC SE RECHAZA AQUÍ SI
ESTÁ MAL"). Un typo convierte viáticos legítimos en "no deducible": el motor
compara `norm(g.rfcReceptor) === rfcOperador` (`engine.ts:457` y `:467`) y un
RFC mal tecleado cae a la rama `rfc_receptor` —"factura a nombre de otro, no
deducible"— en vez de la rama RLISR 57 que la captura existe para abrir.

**Escenario con valores.** Operador con RFC real `PERE880101XXX`; el capturista
teclea `PERE880101XYY`. Se guarda tal cual. Cada viático de ese operador,
timbrado a su RFC real, se descarta "con certeza" desde entonces. La nota del
propio motor dice que SIN RFC "no se puede confirmar NI descartar" — un RFC
mal tecleado es peor que ninguno.

**Estado: abierto** (rondas 14 y 15).

### [MEDIO] `AvanceCierre` sigue afirmando "No hay viajes iniciados en este periodo" con la consulta caída — segunda ronda
`src/app/dashboard/page.tsx:151` — `<AvanceCierre viajes={viajes ?? []}
ahoraMs={ahoraMs()} />` — y `src/app/dashboard/inicio-operacion.tsx:94`
(ídem). El commit ac58536 (ronda 13) arregló la CifraGrande y no esta línea,
que era la segunda mitad del mismo hallazgo. `estadoPanel` propaga bien el
fallo (`liquidacionesDeViajes(null)` → `null` → 'parcial'/'error') y el cuerpo
dice "esto NO significa que no haya liquidaciones"; pero el encabezado —fuera
del condicional de estado— sirve la barra con `[]`: `datos.dentro === 0` →
**"No hay viajes iniciados en este periodo."** (`avance-cierre.tsx:124`), una
afirmación positiva de ausencia a 20 px del texto que dice que no se pudo leer
nada. El `?? []` convierte el fallo en ausencia: la doctrina que la ronda 5
marcó CRÍTICO.

**Estado: abierto** (rondas 14 y 15; el fix ac58536 sigue sin prueba para el
branch `valor === undefined → '—'` de la CifraGrande).

### [MEDIO] `?rol=` se pierde al tocar 7d/30d y la previsualización "ver como encargado" se voltea al panel del dinero — segunda ronda
`src/app/dashboard/page.tsx:239` — `extra={sp?.tenant ? { tenant: sp.tenant } :
sp?.vista ? { vista: sp.vista } : undefined}` — y `src/app/dashboard/analitica/
page.tsx:51-52` (ídem): el `GlobalFilter` construye la URL sin `?rol=`, mientras
`sufijo.ts:20-25` y `sidebar-nav.tsx:81-82` sí lo arrastran. Bonus de esta
ronda: el tipo de `searchParams` de analitica (`:32`) ni siquiera declara
`rol`, mientras el runtime lo honra en el primer render — una mentira a nivel
tipo.

**Escenario con valores (el de la ronda 14, sin cambios).** Javier entra a
"Entrar a los otros paneles" → Jefe de tráfico →
`/dashboard?vista=demo&rol=encargado`: se pinta `InicioOperacion` (cero pesos,
correcto). Toca "30d": `/dashboard?vista=demo&rango=30` — sin rol. El server
re-resuelve `rolEfectivo('superadmin', undefined)` = 'superadmin' →
`puedeVerArea('superadmin','dinero')` = true → **se pinta el panel del DUEÑO
con el dinero completo**, y la cinta solo dice "Estás previsualizando el panel
del cliente" sin mencionar que ya no es la vista del encargado. En analitica
pasa igual (`veDinero = puedeVerArea(rol, 'dinero')`, `:41`).

**Estado: abierto** (rondas 14 y 15; era condición #2 del veredicto de la 14).

### [MEDIO] El cruce de breakpoint con el asistente expandido sigue abierto — CUARTA ronda del mismo hallazgo, en las dos instancias
`src/app/dashboard/rail.tsx:89` (`hidden xl:flex` + estado `expandido` que solo
se limpia al desmontar, `:46-49`), `src/app/globals.css:217-222`
(`:root[data-asistente="expandido"] .columna-centro { opacity: 0;
pointer-events: none }`) y `src/app/admin/asistente-expandible.tsx:45,61`
(`flex: expandido ? '0 1 0%' : '1 1 0%'` + `opacity: expandido ? 0 : 1`, aside
`hidden xl:flex`). Ninguno de los dos archivos tiene un
`matchMedia('(min-width: 1280px)')` (verificado con grep: cero coincidencias).

**Escenario con valores.** Laptop a 1366 px: Javier expande el asistente y
conecta el proyector a 1024 px. El aside pasa a `display:none` pero sigue
montado: en /dashboard la marca sigue en `<html>` y la columna queda
`opacity:0`; en /admin el estado React sigue `true` y el main queda
`flex: 0 1 0%` con `opacity:0`. El botón "Contraer" vive dentro del aside
oculto. Única salida: recargar — delante del cliente.

**Estado: abierto** (rondas 12/13/14/15).

---

### [BAJO] El box "Smart Insight" en error sigue a ~4.26:1
`src/app/dashboard/rail.tsx:118-119` — `color: var(--color-warn)` (#a16207)
sobre `color-mix(in srgb, var(--color-warn) 10%, transparent)`: ≈ 4.26:1, AA
pide 4.5:1 para texto de 10 px. Sin cambios desde la ronda 13.

**Estado: abierto** (rondas 13/14/15).

### [BAJO] La línea de términos del login sigue a ~2.9:1
`src/app/login/page.tsx:186` — `text-[#6b6b6b]/70` a 11 px: ≈ 2.9:1. Sin
cambios.

**Estado: abierto** (rondas 12/13/14/15).

### [BAJO] `inicio-operacion.tsx` sigue declarando un scroll que no implementa
`src/app/dashboard/inicio-operacion.tsx:72-79` — "Con `h-full` + `min-h-0` en
la cadena…" — contra el markup real en `:80`: `glass-panel overflow-hidden
shrink-0`. Sin cambios.

**Estado: abierto** (rondas 12/13/14/15).

### [BAJO] eslint: ahora 13 warnings — los 11 de la ronda 14 más DOS NUEVOS de los fixes de la propia ronda 14
Los 6 de `src/app/admin/page.tsx` y los 5 de prueba previos siguen, y los
commits que cierran la ronda 14 entraron sin pasar eslint: **`desde_db.ts:9`
(`supabaseAdmin` definido y nunca usado, del refactor de 8a33ce1)** y
**`stripe/webhook/route.test.ts:17` (`desmarcar` sin usar, de d7b171f)**. 0
errores. El fix de la 14 repitió el patrón que la ronda 13 anotó: los fixes
de frontend no pasan eslint.

**Estado: abierto** (11 preexistentes + 2 regresiones de la 14).

### [BAJO] El mensaje de la edición de la declaración del 15% miente en un caso de una sola condición
`src/app/admin/flotas/page.tsx:69` — `return { ok: ded !== undefined ?
'Declaración del 15% actualizada.' : 'Declaración del 15% borrada (sin
declarar).' }` — contra `src/lib/cuadra/repo.ts:926-928`: el repo borra la
llave salvo que **las dos** condiciones vengan definidas.

**Escenario con valores.** El superadmin cambia "Carga: Sí" y deja "Régimen: —"
(piensa "eso lo confirmo luego"). El repo borra la declaración completa (la
flota queda "sin declarar"); el mensaje dice "**Declaración del 15%
actualizada**". Al recargar, los selects vuelven a "—". La condición del
mensaje no es la condición del repo. BAJO (el estado final es seguro —nunca
inventa un "no"— pero el texto afirma lo contrario de lo que hizo).

**Estado: abierto** (introducido por 8a33ce1).

### [BAJO] "Vencen pronto (≤ 5 días hábiles)" cuenta días calendario
`src/app/admin/compliance/page.tsx:63` (rótulo) contra `:147` —
`Date.now() + 5 * 864e5` — cinco días de reloj, no hábiles. El vencimiento
ARCO se calcula en hábiles (`privacidad.ts` `venceArco`); el "vencen pronto"
no. Un viernes, una solicitud que vence el miércoles siguiente (3 hábiles)
no aparece; una que vence en 6 días calendario (sábado, p.ej. 4 hábiles) sí.
Rótulo que no describe el filtro real.

**Estado: abierto** (nuevo).

### [BAJO] `--faint` sobre `--canvas2` en 4.4987:1 — latente, sin cambios
`globals.css` (`--faint:#73737c`, `--canvas2:#fafafa`), usado en `kit.tsx:144`
(`ChartCard soft`). Sigue sin usarse en páginas vivas. Verificado con grep.

**Estado: abierto (latente).**

---

## Verificación de los cierres de la ronda 14 (uno por uno, contra el código ACTUAL)

- **[ALTO] IVA del diésel en efectivo en el panel del contador — CERRADO
  (8a33ce1), verificado.** `fiscal.ts:513`: `if (g.formaPago === '01' &&
  esCombustible(g, o)) return false;` en `ivaSostenible`. Corro el escenario
  de la ronda 14 en el código: flota elegible, diésel $4,200 en efectivo con
  `iva_traslado` $581.38 → `ivaSostenible` false → `ivaNoAcreditable` +581.38,
  `ivaAcreditable` 0. El motor ya escribía `iva_acreditable = 0` (persistido) y
  la página Liquidaciones lee lo persistido: **las tres superficies coinciden
  en $0**. **PERO sin prueba nueva**: `fiscal.test.ts` solo cambió el `OPTS`
  para poner `elegible15: true` (3 líneas); el branch nuevo de `ivaSostenible`
  y el de `efectivo_no_elegible` no tienen ni un test (`grep efectivo_no_elegible`
  en `fiscal.test.ts` = solo el comentario). El commit dice "todos corregidos
  con prueba" — el panel, no.
- **[MEDIO] RFA 2.9 en la UI: declaración solo al alta — CERRADO (8a33ce1),
  verificado con dos restos.** El alta es tri-estado de verdad:
  `flotas/page.tsx:38-39` manda `undefined` cuando la casilla no está marcada
  (ya no `false`), `administracion.ts:115-120` solo escribe la llave si las dos
  son booleanos, y la edición existe (`accionFacilidad` :56-70 +
  `actualizarFacilidad15` repo.ts:921-931). La migración 0083 exige la FORMA.
  Los dos restos: el **recuadro del 15% de combustible/page.tsx** (MEDIO
  nuevo arriba) y el **mensaje "actualizada"** cuando el repo borra (BAJO
  arriba).
- **[MEDIO] Columna RFC desalineada — ABIERTO** (2ª ronda, MEDIO arriba).
- **[MEDIO] RFC sin validación — ABIERTO** (2ª ronda, MEDIO arriba).
- **[MEDIO] AvanceCierre `?? []` — ABIERTO** (2ª ronda, MEDIO arriba; el fix
  ac58536 de la 13 solo cubrió la CifraGrande, confirmado).
- **[MEDIO] `?rol=` en GlobalFilter — ABIERTO** (2ª ronda, MEDIO arriba; la
  ronda 14 lo agravó de BAJO a MEDIO y esta ronda confirma el agravio).
- **[MEDIO] Cruce de breakpoint asistente — ABIERTO** (4ª ronda, MEDIO
  arriba).
- **[BAJO] Smart Insight / login / scroll / eslint / `--faint` — ABIERTOS**,
  con eslint en 13 (dos nuevos de los fixes de la 14).

## Lo que revisé y está bien (verificado en el código ACTUAL, con prueba)

- **El ALTO de la ronda 14 cerrado de verdad** — `ivaSostenible` niega el IVA
  del efectivo combustible (`fiscal.ts:513`), `causasDe` conoce la elegibilidad
  (:337), `SIN_ACREDITAMIENTO` del motor incluye las cuatro ramas
  (`engine.ts:963`), y las tres superficies del contador (panel recomputado,
  Liquidaciones persistido, motor) enseñan el mismo $0. Escenario corrido con
  valores de la ronda 14.
- **El alta tri-estado y la edición de la declaración funcionan end-to-end** —
  `flotas/page.tsx` (casillas → `undefined`; selects → si/no/—),
  `administracion.ts:115-120` (solo escribe con dos booleanos),
  `repo.ts:921-931` (borra si falta alguna), `negocio.ts:230` (la tabla lee la
  llave real para pintar los selects), seed.sql:106 (el demo declara
  true/true). `migraciones_verificadas.test.ts` (4) verde.
- **`avisoTope15` ya conoce la elegibilidad** — `aviso.ts:28-33`: `false` →
  "declaró que NO califica", `undefined` → "exige que declare… sale a
  revisión", `true` → los avisos de margen/excedente. Llega al chat vía
  `tools.ts:108-115`. 6 pruebas de `aviso.test.ts` verdes (aunque ninguna
  cubre los branches nuevos de `elegible`).
- **`opcionesDe` mapea el tri-estado correcto** — `comun.tsx:117-121`: solo
  con las dos condiciones definidas produce true/false; si no, `undefined`. Y
  `extraDe` ya arrastra `?rol=` (comun.tsx:39-46).
- **`estadoPanel` intacto** — `estado.ts:44-50` y `liquidacionesDeViajes`
  (null → null); 14 pruebas verdes. La CifraGrande sirve "—" con `undefined`
  (`cifra-grande.tsx:56-61`), aunque sigue sin prueba para ese branch.
- **`?rol=` viaja bien en TODO lo demás** — `sufijo.ts:20-25`,
  `sidebar-nav.tsx:81-82`, `extraDe`, y el rebote de
  `resolverTenantEfectivo` (`sufijoPrevisualizacion`). Solo el `GlobalFilter`
  lo pierde (las dos páginas de arriba).
- **La pantalla ARCO es honesta en casi todo** — la tabla lee la tabla real
  (`listarSolicitudesArco`, `traerTodo` con paginación), el EstadoVacio no
  miente ("Ninguna solicitud ARCO registrada…"), el action resuelve bajo el
  tenant de la solicitud (no el del orden del listado). El único problema es
  el mensaje de éxito (MEDIO arriba).
- **Alta de usuario valida el rol** (d7b171f) — el `<select>` no ofrece
  superadmin/operador y el POST directo rebota (`redirect` a `?error=2`).
  Backend, verificado de paso.
- **Pruebas del rubro en verde** — corrí `contraste` (8), `estado` (14),
  `avance-cierre` (4), `cifra-grande` (3), `confirmacion` (18),
  `etiquetas_panel` (3), `dinero_por_area` (6), `formato` (7),
  `foto_no_expuesta` (2), `contador/page` (2), `contador/periodo` (3),
  `fiscal` (57), `aviso` (6), `repo_acumulado` (5), `administracion` (27),
  `migraciones_verificadas` (4) y `engine` (114) — **283 verdes, 0 rojos**.

## Lo que no alcancé a revisar

1. **El render visual.** Esta sesión no levantó preview con Chrome headless
   (las páginas están detrás de sesión y otros auditores están sobre el árbol;
   además, `npx tsc --noEmit` NO pasa en el working tree — ver punto 4).
   La desalineación de RFC y el Gauge del 15% son verificables en markup, pero
   el recuadro del 15% de una flota no elegible merece una captura antes del
   demo si se va a enseñar el panel del contador.
2. **~15 páginas de /dashboard** (clientes, cobranza, suscripción, cotizador,
   mapa, políticas, rentabilidad, soporte, usuarios, incidencias, pod,
   unidades, viajes, documentos, chat). Verifiqué el patrón, no línea por línea.
3. **El render del PDF con un `efectivo_sobre_15` o `efectivo_no_elegible`
   real** — misma deuda de la ronda 14.
4. **Los 3 archivos `zzz-*`/`aud15-temporal.test.ts` de otro auditor** (sin
   commit, en el working tree) rompen `tsc` y agregan 7 pruebas a la suite
   (las corrí: pasan). No los borré — son del auditor de fiscal. **El árbol de
   trabajo NO pasa tsc por ellos**; el código commiteado sí.
5. **El motor con `totalCombustibleEjercicio = 0`** — no es mi rubro, pero lo
   confirmé de paso porque los probes del auditor paralelo lo evidencian y
   toca el demo: con la consulta del acumulado caída (`desde_db.ts:95-105`
   inyecta ceros "best-effort"), `elegible === true` calcula tope $0.00 y
   escribe `efectivo_sobre_15` **"NO se deduce"** con `totalNoDeducible`
   completo (probe P1: "el ejercicio lleva $1,000.00 … contra un tope de
   $0.00 … NO se deduce"). El comentario de `desde_db.ts` ("la rama 'sin datos
   del ejercicio' marca el efectivo para revisar") describe una rama que **no
   existe**: el estatus sí es `revisar`, pero la nota y el `totalNoDeducible`
   afirman la no-deducción. Es hallazgo del rubro fiscal/backend; lo dejo
   anotado para la síntesis porque se imprime en el PDF que el demo enseña.

---

## VEREDICTO

**Green light condicional — el demo no toca ninguna de las contradicciones
nuevas, pero las condiciones de la ronda 14 siguen en pie y la deuda se
acumula en dos superficies nuevas.**

Lo que el contralor toca en el camino del demo —el panel del dueño con el seed,
el WhatsApp, el panel del contador con la flota declarada true/true— está en
buen estado: el ALTO de la 14 (IVA del diésel en efectivo) está cerrado de
verdad y verificado con el escenario de la ronda, y las tres superficies del
contador coinciden. Pero esta ronda encontró que el fix del 15% fue a medias
(el recuadro de Combustible sigue sin la elegibilidad), que el tri-estado que
se implementó abrió una contradicción nueva panel-vs-motor para "sin
declarar" (el estado de TODAS las flotas de producción), y que la pantalla
ARCO nueva —que se estrenó esta ronda— afirma en su éxito que se notificó al
titular sin mandar nada. Ninguna de las tres se ve con el seed del demo; las
tres se ven el primer día con una flota real.

Condiciones antes de proyectar:

1. **Si se enseña `/dashboard/operadores`, la columna de RFC sigue corrida**
   (2ª ronda; el input cae bajo "Licencia"). El fix es mover la celda
   `FormaConAviso` de `operadores/page.tsx:259-267` a después de la celda de
   "% comprobado".
2. **Si alguien toca 7d/30d previsualizando "Jefe de tráfico"**, la pantalla
   se voltea al panel del dueño con el dinero (2ª ronda; una línea en
   `page.tsx:239` y `analitica/page.tsx:51`: incluir `rol` en `extra`).
3. **Si se demuestra `/admin/compliance`**, el mensaje "El titular recibió su
   respuesta por WhatsApp" es falso; es la superficie legal nueva y no tiene
   una sola prueba.
4. **Si el cuadre del demo toca diésel en efectivo y la consulta del ejercicio
   falla**, el motor imprime "NO se deduce" contra un tope de $0.00 (hallazgo
   del rubro fiscal, anotado arriba).

La suite no protege nada de esto: el ALTO de la 14 se cerró sin prueba nueva,
`efectivo_no_elegible` no tiene un solo test en todo el repo, `avisoTope15`
tiene 6 pruebas que no cubren los branches de `elegible`, la página ARCO no
tiene test, y los fixes de la 14 entraron con 2 warnings de eslint nuevos. Los
283 tests que corrí están verdes; miden lo que miden.
