# Frontend — auditoría 14

**Nota: 7/10** (ronda 13: 8/10, tras los fixes de la misma sesión). La vara no
cambia: ¿aguanta que un contralor de flota lo mire de frente, sin nadie
explicándole, y que lo que lea sea verdad? 10 = puede llevarle la cifra a su
contador sin traducción.

**Razón del movimiento: mirada línea por línea tras la RFA 2.9 (0d23f73 +
0fa305e) y la re-auditoría de la ronda 13 — y lo que encontré es que la
implementación del deber ser del 15% llegó al motor y NO a la superficie que el
contador lee**. La matriz nueva (`combustible_efectivo_dentro15` /
`efectivo_sobre_15` / `efectivo_no_elegible`) está en `engine.ts`, pero el
panel del contador —`fiscal.ts`, el módulo que alimenta la declaración y el
export al ERP— siguió **acreditando el IVA del diésel pagado en efectivo**, que
es exactamente la familia de "mismo hecho, dos estándares" que la ronda 13
cerró como ALTO para `pendiente`/`no_encontrado` (37d75ee) y que la ronda 12
cerró en el motor. Y el fix de la ronda 13 que sí tocó frontend (la captura
inline del RFC del operador, 5ef6993) llegó con una **columna desalineada** en
su propia tabla — el input de RFC se renderiza bajo el encabezado "Licencia" —
y **sin la validación de RFC** que la misma ronda exige en el alta de flota.
El MEDIO de la ronda 13 (CifraGrande) quedó **a medias**: el commit ac58536
arregló la cifra y dejó viva la otra mitad del mismo hallazgo, `AvanceCierre
viajes={viajes ?? []}`, que sigue afirmando "No hay viajes iniciados en este
periodo" con la consulta caída. El cruce de breakpoint del asistente expandido
sigue abierto por segunda ronda, y en las DOS instancias. Baja un punto.

| Panel | Nota | Por qué |
|---|---|---|
| `/dashboard` (dueño) | 7 | El guion del demo sigue intacto (estado honesto, `—` en la cabecera con consulta caída), pero la barra `AvanceCierre` sigue mintiendo la otra mitad del hallazgo de la 13, y `?rol=` al tocar 7d/30d puede **voltear la previsualización del encargado al panel del dinero**. |
| `/dashboard/contador` | 6 | Sigue siendo lo mejor redactado del producto en `AvisoDeFallo`/`SinDato`, **pero la RFA 2.9 no llegó a su superficie**: acredita IVA del diésel en efectivo (ALTO) y el recuadro del 15% ignora la declaración de elegibilidad (MEDIO). Dos cifras del mismo panel se contradicen con el motor. |
| `/dashboard/operadores` | 5 | La captura de RFC de la ronda 13 (RLISR 57) llegó **desalineada** (el input cae bajo "Licencia") y sin validación: un typo de RFC convierte viáticos válidos en "no deducible". Es la página con la regresión visible más clara de esta ronda. |
| `/admin` | 7 | El recuadro central cerrado en la 12 se mantiene; el cruce <1280 px con asistente expandido sigue abierto (ronda 3 de este hallazgo). El alta de flota con las dos casillas de la RFA 2.9 funciona, pero es el ÚNICO escritor de la declaración: sin edición posterior, y sin estado "no sé / sin declarar" en la UI. |
| `/chofer` (móvil) | 8 | Sin regresiones — no lo toca ningún commit de esta ronda; los cierres de la 12 se mantienen. |

---

## Hallazgos por severidad

### [ALTO] El panel del contador sigue acreditando el IVA del combustible pagado en efectivo — la RFA 2.9 se implementó en el motor y no en la superficie que el contador cruza contra su declaración
`src/lib/cuadra/fiscal.ts:493` — la rama de efectivo de `ivaSostenible`:
`if (g.formaPago === '01' && !esCombustible(g, o) && g.monto > o.efectivoTopeMxn) return false;`
— excluye el efectivo NO combustible sobre el tope, pero **no** el efectivo de
combustible. Consecuencia en `resumirFiscal` (`fiscal.ts:498-501`): el
`ivaTraslado` del diésel en efectivo entra a `ivaAcreditable`, que es el dato
de `src/app/dashboard/contador/page.tsx:141` ("IVA acreditable documentado").
Contra eso, el motor nuevo (`engine.ts:956` `SIN_ACREDITAMIENTO` incluye
`combustible_efectivo`, `combustible_efectivo_dentro15`, `efectivo_sobre_15` y
`efectivo_no_elegible`) excluye el IVA del efectivo en las CUATRO ramas, y el
deber ser lo fija por escrito (`docs/fiscal/rfa-2.9-deber-ser.md`, matriz:
IVA ❌ en las cuatro filas, "ni el IVA, por ser pago en efectivo").

**Escenario con valores.** Flota elegible (declaración del seed). Un viaje con
diésel de $4,200 pagado en EFECTIVO (`forma_pago '01'`), CFDI vigente,
`iva_traslado` $581.38. Al cerrar, el motor lo clasifica
`combustible_efectivo_dentro15` (o `efectivo_no_elegible` si no declaró) y
escribe `iva_acreditable = 0` en la `liquidacion`. El dashboard del dueño
(`getAcreditables`, lee la tabla persistida) enseña **$0.00 de IVA
acreditable**. El panel del contador (`resumirFiscal` recomputado)
enseña **"IVA acreditable documentado $581.38"**. Y la página
`/dashboard/contador/liquidaciones` (que lee los mismos valores persistidos)
enseña **$0** para ese viaje: el propio panel del contador se contradice
consigo mismo en dos pestañas, y las dos se contradicen con el motor. Es la
misma familia del ALTO de la ronda 13 (37d75ee cerró `pendiente`/
`no_encontrado` y dejó esta rama viva) — la RFA 2.9 la convirtió en el caso
que el motor ahora sí ve. Con el seed del demo no se ve (el diésel precargado
es `forma_pago '03'`, transferencia); se ve el primer día que un operador pague
diésel en efectivo — que es justo el caso que la 2.9 existe para decidir.

**Estado: abierto.** El fix es la línea que ya está escrita una rama arriba:
`if (g.formaPago === '01' && esCombustible(g, o)) return false;` (con el
matiz de si la facilidad debería salvar el IVA dentro del 15% — eso ya lo
decidió el motor: no lo salva).

### [MEDIO] La captura de RFC del operador (fix de la ronda 13, 5ef6993) quedó en la columna equivocada de su propia tabla — el input de RFC se pinta bajo el encabezado "Licencia"
`src/app/dashboard/operadores/page.tsx:243` — el `<th>RFC (RLISR 57)</th>` se
insertó DESPUÉS de "% comprobado" (columna 8 del encabezado), pero la celda
del body —`operadores/page.tsx:260-266`, el `<FormaConAviso accion={accionRfc}>`
con el `<input name="rfc">`— se insertó INMEDIATAMENTE después de la celda
"Teléfono" (`operadores/page.tsx:259`), es decir en la posición 3.

**Escenario con valores.** Tabla con `veDinero` (dueño/contador): encabezado
Operador · Teléfono · Licencia · Viajes · Anticipo · Comprobado · % ·
**RFC (RLISR 57)** · Estado; cuerpo Operador · Teléfono · **input de RFC** ·
Licencia · Viajes · Anticipo · Comprobado · % · Estado. Todo lo que está entre
Licencia y Estado se corre una columna: el contralor teclea el RFC del
trabajador **bajo el encabezado "Licencia"**, ve la licencia bajo "Viajes", los
viajes bajo "Anticipo", el anticipo bajo "Comprobado", el comprobado bajo "%"
y el % bajo "RFC". Con `!veDinero` (encargado) pasa igual (6 columnas en cada
lado, corridas una). Es la violación literal de "un rótulo tiene que ser
verdad" a nivel de tabla, y es una **regresión del propio fix de la ronda 13**
— el commit que debía darle productor a RLISR 57 la dejó así.

**Estado: abierto.**

### [MEDIO] La captura de RFC del operador no valida nada — un typo convierte viáticos legítimos en "no deducible" para siempre
`src/app/dashboard/operadores/page.tsx:157-174` (`accionRfc`: guarda
`rfc || null` sin pasar por `esRfcValido`/`rfcChecksumOk`) y
`operadores/page.tsx:262-266` (input libre, solo `maxLength={13}`), contra el
estándar que la MISMA ronda 13 escribió en el alta de flota
(`administracion.ts:87-95`: "EL RFC SE RECHAZA AQUÍ SI ESTÁ MAL" con su
mensaje al superadmin).

**Escenario con valores.** El operador Juan Pérez tiene RFC real `PERE880101XXX`;
el capturista teclea `PERE880101XYY` (un typo). `actualizarRfcOperador`
(`repo.ts:901-908`) lo guarda tal cual. El motor compara
`norm(g.rfcReceptor) === norm(operadorRfc)` (`engine.ts:459-460`): el viático
de Juan, timbrado a su RFC real, NO empata → cae a la rama `rfc_receptor`
("Factura ... timbrada al RFC ... no es de la empresa — no deducible"),
en vez de la rama RLISR 57 que la captura existe para abrir. La nota del propio
motor dice que SIN RFC "no se puede confirmar NI descartar" — un RFC mal
tecleado es peor que ninguno: descarta con certeza. Y el dígito verificador
está implementado y probado en el repo (`esRfcValido`/`rfcChecksumOk`); esta
pantalla es la única puerta de entrada del dato y no lo usa.

**Estado: abierto.**

### [MEDIO] El MEDIO de la ronda 13 quedó a medias: `AvanceCierre` sigue afirmando "No hay viajes iniciados en este periodo" con la consulta de viajes caída — el commit ac58536 solo arregló la CifraGrande
`src/app/dashboard/page.tsx:151` — `<AvanceCierre viajes={viajes ?? []}
ahoraMs={ahoraMs()} />` — e `src/app/dashboard/inicio-operacion.tsx:94`
(ídem). El commit ac58536 (verificado abajo) tocó `cifra-grande.tsx` y la
línea del `valor`; **no tocó esta línea, que era la segunda mitad del mismo
hallazgo de la ronda 13** ("AvanceCierre afirma 'No hay viajes iniciados en
este periodo' con la consulta de viajes caída — `?? []` convierte el fallo en
ausencia", docs/auditoria-13/frontend.md, MEDIO 1).

**Escenario con valores.** Supabase cae: `safe(getViajes)` devuelve `null`.
`estadoPanel` lo propaga bien (`liquidacionesDeViajes(null)` → `null` →
'parcial' o 'error') y el cuerpo dice "No se pudieron cargar los datos — esto
NO significa que no haya liquidaciones". Pero el encabezado —que se pinta
fuera del condicional de estado, igual que la CifraGrande que sí se arregló—
sirve la barra con `[]`: `datos.dentro === 0` → **"No hay viajes iniciados en
este periodo."** Es una afirmación positiva de ausencia con la consulta caída,
a 20 px del texto que dice que no se pudo leer nada. El `?? []` convierte el
fallo en ausencia, exactamente la doctrina que la ronda 5 marcó CRÍTICO y que
esta ronda verificó cerrada en `KpiTile`, `ContadorRetro` y la CifraGrande.

**Estado: abierto.**

### [MEDIO] `?rol=` se pierde al tocar 7d/30d y la previsualización "ver como encargado" se voltea al panel del dinero — el BAJO de la ronda 13 es peor de lo reportado
`src/app/dashboard/page.tsx:239` — `extra={sp?.tenant ? { tenant: sp.tenant }
: sp?.vista ? { vista: sp.vista } : undefined}` — y
`src/app/dashboard/analitica/page.tsx:51-52` (ídem): el `GlobalFilter`
construye la URL **sin `?rol=`**, mientras `dashboard/sufijo.ts` sí lo arrastra
en todos los links internos y el sidebar también (`sidebar-nav.tsx:81-82`).

**Escenario con valores (el que la ronda 13 no midió).** Javier entra a
"Entrar a los otros paneles" → **Jefe de tráfico** →
`/dashboard?vista=demo&rol=encargado`: `rolEfectivo('superadmin','encargado')`
= 'encargado' → `puedeVerArea('encargado','dinero')` = false → se pinta
`InicioOperacion` (cero pesos, la pantalla correcta). Toca "30d": el pill
construye `/dashboard?vista=demo&rango=30` — sin rol. El server re-resuelve:
`rolEfectivo('superadmin', undefined)` = 'superadmin' → `puedeVerArea(
'superadmin','dinero')` = true → **se pinta el panel del DUEÑO con el dinero
completo** ("Señalado por el motor", IVA acreditable, monto comprobado), y la
cinta —que sí se pinta— dice solo "Estás previsualizando el panel del
cliente", sin mencionar que ya no es la vista del encargado. La comparación
"qué ve el jefe de tráfico" que el selector existe para hacer se rompe a media
demo, en silencio, mostrando finanzas que el rol previsualizado no debería
ver. La ronda 13 lo reportó como "el contenido no cambia (dueño y superadmin
ven la misma área)" — eso solo vale para `rol=flota_admin`; para `encargado`
el contenido SÍ cambia, y cambia a dinero. En `/dashboard/analitica` pasa
igual: `veDinero = puedeVerArea(rol, 'dinero')` (analitica/page.tsx:43) — con
el rol caído, el encargado previsualizado ve la sección de dinero de esa
página.

**Estado: abierto** (upgrade del BAJO de la ronda 13: no es solo la cinta, es
un volteo de pantalla).

### [MEDIO] El cruce de breakpoint con el asistente expandido sigue abierto — tercera ronda del mismo hallazgo, en las DOS instancias
`src/app/dashboard/rail.tsx:89` (`hidden xl:flex` + `expandido` que solo se
limpia al desmontar, rail.tsx:46-49), `src/app/globals.css:217-222`
(`:root[data-asistente="expandido"] .columna-centro { opacity: 0;
pointer-events: none }`) y `src/app/admin/asistente-expandible.tsx:44-51`
(`flex: expandido ? '0 1 0%' : '1 1 0%'`, `opacity: expandido ? 0 : 1`) con
el aside `hidden xl:flex` en :61. Ninguno de los dos archivos tiene un
`matchMedia('(min-width: 1280px)')` que contraiga el estado al cruzar.

**Escenario con valores.** Laptop a 1366 px: Javier expande el asistente (para
enseñar el chat grande) y conecta el proyector a 1024 px (o hace zoom al
90%). El aside pasa a `display:none` pero sigue montado: en /dashboard el
`data-asistente="expandido"` sigue en `<html>` y la columna queda
`opacity:0`; en /admin el estado React sigue `true` y el main queda
`flex: 0 1 0%` con `opacity:0`. El botón "Contraer" vive dentro del aside
oculto. Única salida: recargar la página — delante del cliente. Es el MEDIO
de la ronda 12, confirmado en la 13, sin cambios en la 14.

**Estado: abierto** (rondas 12/13/14).

### [MEDIO] La RFA 2.9 en la UI: la declaración solo se captura al alta, sin edición ni camino para flotas existentes, y la casilla desmarcada es una declaración "no" que nadie hizo
`src/app/admin/flotas/page.tsx:37-38` (`fd.get('dedicacionExclusivaCarga') ===
'on'` — desmarcada = `false`) y `src/lib/cuadra/administracion.ts:110-114`
(el único escritor de `facilidadCombustibleEfectivo` es `crearFlota`; el
seed para el demo). El motor distingue TRES estados (`desde_db.ts:56-58`:
`true` → válvula abierta, `false` → "la flota declaró que NO califica",
`undefined` → por confirmar), pero la UI solo puede producir dos: la casilla
desmarcada **siempre** escribe `false`, y el `?? null` de
`administracion.ts:113-114` no es alcanzable desde el formulario.

**Escenario con valores.** (a) El superadmin no sabe si la flota tributa en
coordinados y deja la casilla sin marcar: el alta guarda `regimenElegible:
false` y el motor le escribe al contralor "la flota declaró que NO califica a
la facilidad — no deducible" (`engine.ts:332-337`). Una declaración que nadie
hizo, afirmada como hecha. (b) La flota se dio de alta antes de esta feature
— es decir, TODAS las de producción — y no hay ninguna pantalla para
declarar después: el deber ser dice que la flota "declara al registrarse" y
que sin declaración el efectivo "sale a revisar"; ese estado por-confirmar es
permanente y no se puede remediar. (c) El superadmin marca las dos por error
en el alta: la válvula abre y el diésel en efectivo de una flota que no
califica sale "deducible"; no hay edición para desmarcar. El panel de
Configuración (`/dashboard/configuracion`, solo lectura) lo enseña pero no lo
escribe; `guardarPolitica` sí conserva la llave pero no la edita.

**Estado: abierto.** Mínimo para cerrar: un camino de edición en
`/admin/flotas` (o configuración) y una tercera opción "No sé / por
confirmar" en el alta.

---

### [BAJO] El box "Smart Insight" en estado de error sigue a ~4.26:1 — el BAJO de la ronda 13 sin cambios
`src/app/dashboard/rail.tsx:118-119` — etiqueta "Smart Insight" en
`color: var(--color-warn)` (#a16207) sobre `color-mix(in srgb,
var(--color-warn) 10%, transparent)`. Medido con la fórmula WCAG (la misma
del repo): tinte al 10% sobre superficie ≈ **4.26:1** (la ronda 13 midió
4.32:1 sobre blanco puro; el glass-panel real lo baja un poco más). AA pide
4.5:1 para texto de 10 px semibold. Solo aparece con `errorCarga=true`
(estado transitorio), pero es texto real que falla por ~0.24. El box verde
(`--color-ok`) pasa.

**Estado: abierto.**

### [BAJO] La línea de términos del login sigue a ~2.9:1 — BAJO de la ronda 13 sin cambios
`src/app/login/page.tsx:186` — `text-[#6b6b6b]/70` a 11 px: 70% de #6b6b6b
sobre blanco ≈ **2.9:1** (la ronda 13 midió 2.75:1; varía por el redondeo del
canal). Los links "Términos" y "Aviso de Privacidad" van en `#0a0a0a` (bien);
la frase que los presenta no llega a 3:1. El placeholder
(`#6b6b6b99`, ~1.66:1) sigue igual — WCAG tolera placeholders.

**Estado: abierto** (BAJO de las rondas 12 y 13).

### [BAJO] `inicio-operacion.tsx` sigue declarando un scroll que no implementa — BAJO de la ronda 13 sin cambios
`src/app/dashboard/inicio-operacion.tsx:72-79` — "Con `h-full` + `min-h-0` en
la cadena, cada panel cierra donde debe y lo que no cabe se desplaza adentro"
— contra el markup real en `:80`: `glass-panel overflow-hidden shrink-0` (sin
`h-full` ni `min-h-0`; el scroll real es el de `MARCO_SCROLL` en el marco). El
comportamiento es correcto; el comentario hace perder una tarde buscando un
scroll interno que no existe.

**Estado: abierto** (rondas 12/13/14).

### [BAJO] eslint: ahora 11 warnings — los 10 de la ronda 13 más UNO NUEVO del arnés de la 2.9
Los 6 de `src/app/admin/page.tsx:8-9,26,33` (BarChart3, UserPlus2,
MessageCircle, Sparkles, FASE_ICONO, Insignia) y los 4 de prueba
(`administracion.test.ts:304-305`, `analytics_por_dia.test.ts:13`,
`transferencia_mensualidad.test.ts:25`) siguen — y el commit 0fa305e agregó
uno: `src/lib/cuadra/processor_cierre.test.ts:114` (`'tabla' is defined but
never used`). 0 errores. El arnés nuevo de la RFA 2.9 entró sin pasar eslint.

**Estado: abierto** (los 6 + 4 preexistentes; el nuevo es regresión de la 14).

### [BAJO] `--faint` sobre `--canvas2` en 4.4987:1 — latente, sin cambios
`src/app/globals.css` (`--faint: #73737c`, `--canvas2: #fafafa`) usado en
`src/app/admin/ui/kit.tsx:144` (subtítulo de `ChartCard soft`). Verificado
con grep: `soft` no se usa en ninguna página viva — solo la definición. Sigue
anotado: el día que alguien use un `ChartCard soft` con subtítulo, reprueba AA
por 0.0013.

**Estado: abierto (latente).**

---

## Verificación de los cierres de la ronda 13 (uno por uno, contra el código ACTUAL)

- **[MEDIO] CifraGrande `$0.00` con consulta caída — CERRADO A MEDIAS
  (ac58536), verificado.** `cifra-grande.tsx:56-61`:
  `{valor === undefined ? '—' : fmt(mostrado)}` y `dashboard/page.tsx:159`:
  `valor={kpis ? kpis.diferenciaDetectada : undefined}`. Con `kpis` null el
  HTML sirve "—" a opacidad plena. **PERO** la otra mitad del mismo hallazgo
  (`AvanceCierre viajes={viajes ?? []}`) sigue viva — reportado arriba como
  MEDIO. Y el commit no trajo prueba: `cifra-grande.test.tsx` (3 tests) no
  cubre el branch nuevo `valor === undefined → '—'`; si alguien revierte a
  `?? 0`, la suite sigue verde.
- **[MEDIO] operador.rfc por fin tiene productor (5ef6993) — ABIERTO CON
  REGRESIÓN.** El action `accionRfc` existe y escribe (`repo.ts:901-908`),
  pero la celda quedó en la columna equivocada de la tabla (MEDIO arriba) y el
  input no valida el RFC (MEDIO arriba). La feature funciona; la pantalla
  miente.
- **[ALTO] El panel del contador acreditaba IVA de `pendiente`/
  `no_encontrado` — CERRADO (37d75ee), verificado.** `fiscal.ts:491`:
  `if (g.estadoSat === 'pendiente' || g.estadoSat === 'no_encontrado') return
  false;` con sus 3 pruebas en `fiscal.test.ts`. **Pero la rama de efectivo de
  combustible quedó viva y la RFA 2.9 la convirtió en ALTO nuevo** (arriba).
- **[MEDIO] `[id]` respeta rolEfectivo (b286aa8) — CERRADO, verificado.**
  `dashboard/[id]/page.tsx:47`: `const rol = rolEfectivo(rolReal,
  (await searchParams).rol)`; las acciones destructivas (`reabrir` :124-126,
  `reasignar` :134-137) re-chequean con `requireSessionTenant` + permiso del
  rol REAL. La previsualización ya no pinta ni ejecuta el formulario de
  superadmin.
- **[MEDIO] `/dashboard/chat` reclasificado 'dinero' (de6416f) — CERRADO,
  verificado.** `visibilidad.ts:75` (`'/dashboard/chat': 'dinero'`); el
  sidebar filtra por `puedeVerRuta(rolMenu, href)` (`sidebar-nav.tsx:94`), así
  que el encargado ya no ve el link muerto.
- **[BAJO] `?rol=` en GlobalFilter — ABIERTO y AGRAVADO** (MEDIO arriba).
- **[BAJO] Smart Insight 4.32:1 — ABIERTO** (~4.26:1 medido esta ronda).
- **[BAJO] Login 2.75:1 — ABIERTO** (~2.9:1 medido esta ronda).
- **[BAJO] `inicio-operacion` scroll — ABIERTO.**
- **[BAJO] eslint 10 warnings — ABIERTO, ahora 11.**
- **[BAJO] `--faint`/`--canvas2` — ABIERTO (latente).**
- **[MEDIO, rondas 12/13] Cruce de breakpoint con asistente expandido —
  ABIERTO, en las dos instancias** (MEDIO arriba).

**La deuda de proceso de la ronda 13 sigue siendo cierta**: los commits de
frontend de la 13 (ac58536, 5ef6993) no traen ninguna prueba (`git show
--name-only`), `contraste.test.ts` sigue sin cubrir los pares de pills
(`--ok`/`--warn`/`--bad` sobre `--okbg`/`--warnbg`/`--badbg`) ni el box
"Smart Insight" ni la línea del login, y el fix nuevo de la 2.9 en
`admin/flotas/page.tsx` tampoco trae test. La suite está verde sin fijar
ninguno de los colores que esta ronda mide.

## Lo que revisé y está bien (verificado en el código ACTUAL, con prueba)

- **La matriz RFA 2.9 del motor está completa y con notas honestas** —
  `engine.ts:280-345`: las tres ramas (`elegible===true` con contador del
  ejercicio y corte proporcional, `false` → `efectivo_no_elegible`, `undefined`
  → `combustible_efectivo` por confirmar), ninguna acredita IEPS, y
  `SIN_ACREDITAMIENTO` (engine.ts:956) excluye el IVA del efectivo en las
  cuatro ramas. 112 pruebas de `engine.test.ts` verdes, incluidas las 5 nuevas
  de la matriz. `desde_db.ts:48-112` agrega el ejercicio con exclusión del
  viaje en curso y el `or(concepto, clave)` correcto.
- **El alta de flota con las dos casillas funciona end-to-end** —
  `admin/flotas/page.tsx:174-183` → `crearFlota` → `tenant.config` (con la
  migración 0082 que ya conoce la llave; `migraciones_verificadas.test.ts`
  verde). El seed del demo declara `{dedicacionExclusivaCarga:true,
  regimenElegible:true}` con `jsonb_set` anidado correcto.
- **`estadoPanel` y el fallo parcial del dueño intactos** — `estado.ts:44-50`;
  con `viajes` null, `liquidacionesDeViajes` propaga `null` (nunca `[]`) y el
  panel dice "Faltan datos por cargar" / "No se pudieron cargar los datos".
  `estado.test.ts`: 14 verdes.
- **`CifraGrande` sirve "—" en el HTML con consulta caída** — verificado en
  código y por el fix; `useCountUp` arranca en el valor real.
- **Panel fiscal: `AvisoDeFallo` no enseña cifras, comparativo solo con
  historia real, `SinDato` es "—"** — `contador/comun.tsx` y
  `contador/page.tsx` sin regresiones; `page.test.tsx` (2) y `periodo.test.tsx`
  (3) verdes.
- **`?rol=` viaja bien en TODO lo demás** — `sufijo.ts` (incluye `rol`),
  `sidebar-nav.tsx:81-82` (incluye `rol`), el detalle `[id]` (volverQS arma
  `vista`+`rol`), `AvisoRol` (salida que conserva tenant). Solo el
  `GlobalFilter` lo pierde.
- **`/chofer` sin regresiones** — los commits de la 14 no lo tocan; pills en
  tokens nuevos, barra sin anticipo que no se dibuja, `marco.test.tsx` verde.
- **Filtro de rango a prueba de balas** — `filtro_rango.test.ts`: 21 verdes,
  viaje redondo URL→parser conservando `?tenant=`/`?vista=` (el hueco es solo
  `?rol=`).
- **`usd()`/`mxn()`/`litros()` viven solo en `lib/formato.ts`** —
  `formato.test.ts` (7) escanea `src/`; no hay fugas.
- **tsc 0 errores; eslint 0 errores; pruebas del rubro en verde** — corrí
  `contraste` (8), `estado` (14), `avance-cierre` (4), `cifra-grande` (3),
  `filtro_rango` (21), `formato` (7), `foto_no_expuesta` (2), `periodo` (3),
  `contador/page` (2), `confirmacion` (18), `etiquetas_panel` (3),
  `dinero_por_area` (6), `kit` (7), más `engine` (112), `processor_cierre`
  (22), `por_diferencia` (9), `migraciones_verificadas` (4) — **247 verdes, 0
  rojos**.

## Lo que no alcancé a revisar

1. **El render visual.** Esta sesión no levantó el preview con Chrome headless
   (las páginas están detrás de sesión y el build lo están usando otros
   auditores): medí desde el código, el HTML servido y las pruebas. Los dos
   hallazgos visibles de esta ronda (columna de RFC desalineada, `?rol=`
   volteando el panel) salen de aritmética de columnas/estado verificable en
   el markup; la desalineación en particular es tan obvia que vale una
   captura de 30 segundos antes del demo si se va a enseñar Operadores.
2. **~15 páginas de /dashboard** (clientes, cobranza, suscripción, cotizador,
   mapa, políticas, rentabilidad, soporte, usuarios, incidencias, pod,
   unidades, viajes, documentos, chat). Verifiqué el patrón pero no las leí
   línea por línea.
3. **`npm run build` completo** — corrí tsc, eslint y las pruebas del rubro;
   no el build para no pisar a otros auditores sobre el mismo árbol.
4. **El `-mt-8` del `Gauge`** (graficas.tsx:68) — sin render no pude confirmar
   que la cifra no pise el arco con 3 dígitos. Sin cambios desde la ronda 13.
5. **El render del PDF/WhatsApp con los 3 tipos nuevos de la RFA 2.9** — el
   PDF imprime `d.nota` y `cierre_aviso.ts` los rutea bien (`panel`/`decision`),
   pero no verifiqué visualmente el PDF con un `efectivo_sobre_15` real.

---

## VEREDICTO

**Green light condicional para frontend — mismo estatus que la ronda 13, con
más deuda anotada y una regresión visible.**

Lo que el contralor toca en el camino del demo —el panel del dueño con el
seed sembrado, el WhatsApp, el panel del contador con la RFA 2.9 declarada en
el seed— sigue en buen estado: los cierres de la 13 se verificaron uno por uno
y el ALTO de la 13 (IVA de CFDIs sin confirmar) está cerrado de verdad. Pero
esta ronda encontró **un ALTO nuevo en la superficie del contador** (el IVA
del diésel en efectivo, justo la feature que la 2.9 implementó en el motor), **
una regresión visible de un fix de la 13** (la columna de RFC desalineada en
Operadores), y **el MEDIO de la 13 a medias** (AvanceCierre sigue mintiendo con
la consulta caída). El breakpoint del asistente cumple su tercera ronda
abierto, y el `?rol=` resultó peor de lo reportado: voltea la previsualización
del encargado al panel del dinero.

Condiciones antes de proyectar:

1. **Si se va a enseñar `/dashboard/operadores`** (la plantilla, muy probable
   en un demo con flota), la columna de RFC está corrida: el input cae bajo
   "Licencia" y toda la tabla se lee cruzada. Es el fix de una línea de
   `operadores/page.tsx` (mover la celda `FormaConAviso` a después de la de
   "% comprobado").
2. **Si alguien toca 7d/30d mientras se previsualiza "Jefe de tráfico"**
   (el selector de /admin lo ofrece), la pantalla se voltea al panel del
   dueño con el dinero en pantalla. El fix es una línea en `page.tsx:239` y
   `analitica/page.tsx:51` (`rol: sp.rol` en `extra`, o pasar `sufijoTenant`
   al filtro).
3. **El ALTO del IVA en efectivo no se ve en el demo** (el seed usa
   transferencia), pero es el primer caso real de la 2.9: una flota que pague
   diésel en efectivo verá "IVA acreditable $X" en el panel del contador y "$0"
   en el motor y en "Liquidaciones (lectura)". Es la misma factura que la
   ronda 13 cobró como ALTO, sin cerrar del todo.
4. **El cruce <1280 px con el asistente expandido** sigue siendo el riesgo de
   sala de las últimas tres rondas: si se enseña /admin o /dashboard con el
   chat expandido y se conecta el proyector, la columna desaparece sin forma
   de recuperarla.

La suite no protege nada de esto: los fixes de la 13 y la 14 no trajeron
pruebas, `contraste.test.ts` no cubre los pares de pills ni el box Smart
Insight, y la columna de RFC desalineada no tiene test que la atrape. Los 247
tests que corrí están verdes; miden lo que miden.
