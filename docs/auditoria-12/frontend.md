# Frontend — auditoría 12

**Nota: 7/10** (auditoría 10 tras arreglos: 8/10; primer corte de esa ronda: 6/10).
La vara, igual que en la ronda 10: ¿aguanta que un contralor de flota lo mire de
frente, sin nadie explicándole, y que lo que lea sea verdad? 10 = puede llevarle
la cifra a su contador sin traducción. 5 = se ve caro pero hay que ir corrigiendo
lo que la pantalla dice mal. 1 = no se enseña.

**Razón del movimiento: mirada más profunda — los 3 ALTO de la ronda 10 están
cerrados y VERIFICADOS en el código actual (el 0% de cuadre inalcanzable, el
$0.00 servido del KpiTile, los "1 flota" estáticos), pero la relectura línea por
línea encontró deuda nueva que esa ronda no cubrió**: el recuadro central de
`/admin` queda 292 px angosto bajo 1280 px de ventana (el mismo `marco.ts` que
existe para que los dos paneles midan igual), el `ContadorRetro` sigue sirviendo
"000" en el HTML cuando la cifra real es otra (el hermano del bug que sí se
arregló en `KpiTile`), y los pills de estado y de filtro fallan AA por un pelo
(4.40–4.46:1 contra el 4.5:1 que la propia prueba de contraste dice exigir).

| Panel | Nota | Por qué |
|---|---|---|
| `/chofer` (móvil) | 8 | Sigue siendo lo mejor construido: TOQUE 48/56 px, navegación al pulgar, barra que no se dibuja sin anticipo, cuatro pantallas de vacío honestas importadas por el preview. Sus dos pills de estado ("Registrado"/"Reenvíala") fallan AA por 0.04–0.05. |
| `/dashboard` (dueño) | 8 | El vacío ya es alcanzable y dice la verdad ("Aún no hay liquidaciones" / "No hay flota, así que no hay nada que liquidar"). Cifra grande servida con el valor real y opacidad plena. El filtro 7d/30d/Todo mueve las tres consultas y los rótulos dicen su ventana. |
| `/dashboard/contador` | 7 | La mejor redacción del producto intacta ("Lo que este panel no puede decirte", `AvisoDeFallo` que no enseña cifras). Le bajan los pills del selector de periodo a 4.40:1 y las gráficas del kit servidas vacías en SSR. |
| `/admin` | 6 | **El recuadro central mide 292 px menos que su columna bajo 1280 px de ventana** (la banda naranja vacía a la derecha). `ContadorRetro` sirve "000" con la base en 0 —hoy es verdad, pero será mentira el día que `facturasTotal` sea 42— y el MRR/flotas no se ven en pantallas <640 px (`hidden sm:flex`). |

Los ALTO de la ronda 10 que esta ronda verificó uno por uno contra el código
actual: `dashboard/page.tsx:102` ya pasa `liquidacionesDeViajes(viajes)` a
`estadoPanel` (no `porDia`), `useCountUp` arranca en `valorFinal` y `CifraGrande`
no sirve `opacity:0`, y las cuatro afirmaciones "1 flota" son dinámicas. Ver
"Lo que ya está bien" abajo, con las pruebas que lo fijan.

---

## [ALTO] El recuadro central de /admin mide 292 px menos que su columna debajo de 1280 px
`src/app/admin/asistente-expandible.tsx:36` — `width: expandido ? 0 : 'calc(100% - ${ANCHO_ASIDE + 16}px)'`
sobre el div que envuelve TODO el contenido de /admin, junto a
`asistente-expandible.tsx:52` (`hidden xl:flex` en el aside) y la constante
`marco.ts:52` (`ANCHO_ASISTENTE = 276`).

**Escenario con valores.** Proyector o laptop a 1024×768 (resolución típica de
sala; el sidebar está en `lg` = 232 px). Columna de /admin = 1024 − 32 (`p-4`) −
16 (`gap-4`) − 232 = **744 px**. El `main` pide `calc(100% − 292px)` = **452 px**.
El aside del asistente tiene `hidden xl:flex`: bajo 1280 su `display:none` lo
saca del flex y no ocupa espacio, así que la banda derecha de **292 px queda
vacía**, mostrando el fondo naranja al 22%. La misma vista en `/dashboard` da 744 px
de contenido (su columna es `flex-1`, `dashboard/chrome.tsx:69`) — los dos paneles
que `marco.ts` existe para que midan igual ("Aquí es igual por construcción",
`marco.ts:14-15`) divergen justo debajo del breakpoint. A 1279 px: columna 999,
`main` 707, banda 292. A 1280+: `main` = columna − 292, exacto y correcto, porque
el aside sí se ve — el bug solo existe en el rango que un proyector de sala usa.

**Estado: abierto.** El fix es mecánico: `flex-1 min-w-0` en el `main` y dejar que
el `hidden xl:flex` del aside gobierne, en vez de restar su ancho en el `calc`
siempre.

## [ALTO] `ContadorRetro` sirve "000" en el HTML — el mismo bug que la ronda 10 cerró en `KpiTile`, vivo en su hermano
`src/app/admin/contador-retro.tsx:74` — `const [mostrado, setMostrado] = useState(0);`
y el `useEffect` de `:76` que sube hasta `valor` con `setInterval`. Tres call sites
con valores que algún día no serán cero:
`admin/agente-ocr/page.tsx:47` (`valor={r.facturasTotal}`),
`admin/analitica/page.tsx:51` (ídem) y `admin/flotas/page.tsx:72` (`valor={r.tenants}`).

**Escenario con valores.** `r.facturasTotal = 42`: el HTML servido dice
`000 Facturas procesadas — histórico` y solo sube a 42 cuando el JS hidrata y el
intervalo de 30 pasos × 45 ms termina (~1.35 s). Con JS lento, bloqueado o una
red que corta a mitad, Javier lee **0 facturas** con la base llena. Es
literalmente la doctrina que la ronda 10 escribió para `KpiTile` (`kit.tsx:49`,
"en el servidor NO corre NINGÚN `useEffect`, así que ese 0 inicial era
literalmente lo que salía en el HTML servido… el cero que CLAUDE.md prohíbe") —
el `ContadorRetro` quedó sin tocar porque esa ronda lo leyó como "reloj animado
de la consola interna". Hoy los tres valores son 0 (base vacía) y la mentira es
invisible; se vuelve visible el primer día con datos. El count-up al montar es
diseño (revelación); el problema es el HTML servido con el estado inicial.

**Estado: abierto.**

## [MEDIO] Los pills de estado fallan AA por un pelo: `--ok`/`--warn` sobre sus fondos
`src/app/globals.css:102-105` — `--ok: #15803d`, `--okbg: #e7f5ec`,
`--warn: #a16207`, `--warnbg: #fbf3e0`; usados como texto en
`admin/ui/kit.tsx:89-90` (`StatusPill`), `chofer/vista.tsx:74-75` (`Pastilla`),
`chofer/vista.tsx:176` (`ViajeAceptado`), `chofer/vista.tsx:311` (aviso de fotos
mal leídas) y `admin/ui/forma.tsx:63` (aviso de alta exitosa).

**Escenario con valores.** La pastilla "Registrado" del chofer (verde, `text-base`
= 16 px, que NO es "texto grande" — eso empieza en 18.66 px negrita): **4.46:1**.
"Reenvíala"/"Atender" (ámbar): **4.45:1**. AA pide 4.5:1 para texto normal.
Medido con la fórmula de luminancia relativa WCAG, la misma del repo. La prueba
`dashboard/contraste.test.ts` (8 verdes) mide `--color-ok`, `--color-bad`,
`--faint` y el orden `faint < muted` — no cubre los pares bg/fg de los pills, que
es justo donde viven los 0.04–0.05 que faltan. El comentario de `globals.css:96`
dice "Estos también pasan AA sobre blanco" — cierto sobre BLANCO (5.02/4.92:1),
falso sobre sus propios fondos.

**Estado: abierto.**

## [MEDIO] Pills de filtro y cinta de rol a 4.40:1 — `--muted` sobre `--canvas`
`src/app/admin/ui/global-filter.tsx:96-100` (fondo `var(--canvas)` + opción
inactiva `color: var(--muted)`), `dashboard/contador/periodo.tsx:90-91`
(`SelectorPeriodo`), `dashboard/contador/cfdi/page.tsx:165-169` (filtros de la
bandeja CFDI), `dashboard/aviso-rol.tsx:65-68` (la cinta "Estás viendo el panel
como CONTADOR").

**Escenario con valores.** "30d" inactivo en el `GlobalFilter` (`text-[11px]`
medium): `#6b7280` sobre `#f4f4f5` = **4.40:1** < 4.5:1. Es el control que la demo
toca enfrente del cliente para mover las tres consultas. Y la cinta de
previsualización —la ÚNICA cosa en pantalla que anuncia que un superadmin está
viendo con ojos de otro rol— está al mismo 4.40:1. El `--faint` sobre `--canvas`
(4.27:1) hoy solo pinta íconos (pasa el 3:1 de no-texto), se anota para cuando
alguien ponga texto ahí.

**Estado: abierto.**

## [MEDIO] Las gráficas del kit se sirven vacías en el HTML — pista de gauge sin arco
`src/app/admin/ui/graficas.tsx:31` y los otros 10 `const animar = enVista || reducido`
(`:79`, `:111`, `:163`, `:213`, `:253`, `:303`, `:339`, `:384`, `:415`, `:455`).

**Escenario con valores.** El `Gauge` de "tasa de cuadre" en
`/dashboard/cuadre` (con `kpis.tasaCuadre = 62`): el HTML servido trae el arco con
`stroke-dashoffset: largoAprox` — pista vacía — y el número real "62%" debajo.
Con JS lento o bloqueado, la gráfica se queda en pista vacía: el ojo lee "0%"
contra el número que dice 62. Es el mismo patrón que `CifraGrande` tenía
(opacity:0 hasta `useInView`) y que la ronda 10 cerró para esa cifra — aquí el
estado pre-animación sigue siendo el estado servido. `HBars`, `StackedBars`,
`Funnel`, `Waterfall`, `Histogram`, `Heatmap`, `CalendarHeatmap`,
`MarginDivergingBars` y `ParetoBars` sirven barras a 0% / opacity 0. Mitigación
real: el número sí viaja en el HTML (`fmt(valor)`); lo que se pierde es la forma.

**Estado: abierto.**

## [MEDIO] Expandir el asistente y cruzar bajo 1280 px deja la columna central invisible, sin forma de recuperarla
`src/app/dashboard/rail.tsx:46-49` (la marca `data-asistente` en
`document.documentElement` con cleanup solo en desmontaje), `globals.css:217-222`
(`:root[data-asistente="expandido"] .columna-centro { opacity: 0; pointer-events: none }`),
`marco.ts:73` (`MARCO_ASISTENTE_EXPANDIDO`).

**Escenario con valores.** Laptop a 1366 px: el usuario expande el Asistente →
`data-asistente="expandido"` en `<html>`, la columna central se desvanece
(`opacity:0`). Luego encoge la ventana (o hace zoom al 90% y cruza los 1280 px):
el rail pasa a `display:none` por `hidden xl:flex` pero SIGUE montado — el
cleanup del efecto no corre porque no hay desmontaje — y el botón "Contraer"
vive dentro de ese rail invisible. La columna central queda `opacity:0;
pointer-events:none` para siempre; la única salida es recargar la página. El
propio comentario de `rail.tsx:42-43` conoce la mitad del problema (el
desmontaje) y no la otra mitad (el cruce de breakpoint).

**Estado: abierto.**

## [BAJO] La línea de términos del login a ~2.8:1
`src/app/login/page.tsx:186` — `text-[#6b6b6b]/70` a 11 px: ≈ 2.81:1 sobre
blanco (medido con la fórmula WCAG). Los links "Términos de Servicio" y "Aviso de
Privacidad" van en `#0a0a0a` (bien); la frase que los presenta no llega ni a 3:1.

**Estado: abierto.** (El placeholder `login/page.tsx:163`, `#6b6b6b99` ≈ 2.4:1, se
anota igual: WCAG tolera placeholders, pero es el mismo hábito.)

## [BAJO] `inicio-operacion.tsx` declara un scroll que no implementa
`src/app/dashboard/inicio-operacion.tsx:72-74` — "EL SCROLL VIVE DENTRO DE CADA
PANEL… Con `h-full` + `min-h-0` en la cadena…". El markup de abajo no tiene
`h-full` ni `overflow-y-auto` en los `glass-panel` (solo `overflow-hidden
shrink-0`); el scroll real es el de la columna (`MARCO_SCROLL`). El
comportamiento es correcto —el comentario es el que quedó de una intención
anterior— pero es exactamente el tipo de comentario que hace perder una tarde
buscando un scroll interno que no existe.

**Estado: abierto.**

## [BAJO] eslint: 6 warnings de imports sin usar en /admin
`src/app/admin/page.tsx:8-9,26,33` — `BarChart3`, `UserPlus2`, `MessageCircle`,
`Sparkles`, `FASE_ICONO`, `Insignia` sin usar. 0 errores, preexistentes de
rondas anteriores.

**Estado: abierto.**

---

## Lo que revisé y está bien (verificado en el código ACTUAL, con prueba)

- **El estado vacío del dueño ya es alcanzable** — `dashboard/page.tsx:102` pasa
  `liquidacionesDeViajes(viajes)` (viajes reales filtrados a `estatus ===
  'liquidado'`, `estado.ts:44-50`), no `porDia`. La rama `'vacio'` pinta "Aún no
  hay liquidaciones" con su explicación y, sin tenant, "No hay flota, así que no
  hay nada que liquidar" (más `AvisoSinFlota` ANTES que los ceros,
  `sin-flota.tsx:26-31`). `estado.test.ts`: 14 verdes.
- **`KpiTile` sirve la cifra real en el HTML** — `useCountUp` arranca en
  `valorFinal` (no en 0) y la animación solo corre cuando el valor CAMBIA tras
  montar. `kit.test.tsx`: `$1,234,567.89` servido, no `$0.00`; cero real sí se
  sirve como cero. 7 verdes.
- **`CifraGrande` sin hueco ni opacidad 0** — `cifra-grande.test.tsx` (3 verdes):
  el HTML servido trae el valor real y sin `opacity:0`.
- **Los "1 flota" estáticos desaparecieron** — `admin/crecimiento/page.tsx:39-47`
  y `admin/analitica/page.tsx:119-120` condicionan por `r.tenants`; el KpiTile de
  /admin dice "Flotas (ninguna dada de alta)" con 0 y "Flota (solo el demo)" solo
  si `esSoloDemo` comprueba el uuid real (`admin/page.tsx:155-158`).
- **`--faint` pasó a 4.70:1** (#73737c) y la prueba `contraste.test.ts` (8
  verdes) lo fija contra blanco y contra `--bg`, y conserva `faint < muted`.
- **Rótulos completos** — `line-clamp-2` en `KpiTile.etiqueta` y `ChartCard`
  (`kit.tsx:60-63`), verificado por `kit.test.tsx` ("IVA acreditable
  documentado" entero en el DOM).
- **Filtro de rango a prueba de balas** — `filtro_rango.test.ts` (21 verdes):
  viaje redondo URL→parser para las 9 combinaciones de opción×default, y
  conserva `?tenant=`/`?vista=`. Vocabulario unificado 7d/30d/Todo en
  `AvanceCierre` (`avance-cierre.tsx:29-34`).
- **Sin barra fantasma** — `avance-cierre.tsx:90-98`: sin `pct` no se dibuja ni
  la pista; el pie dice "No hay viajes iniciados en este periodo." Sin 0%
  acusador (`:84-86`).
- **La fecha capitalizada solo al inicio** — `fechaLarga()` ya capitaliza el
  primer carácter; el CSS `capitalize` de Tailwind se quitó de los tres paneles.
- **`usd()` distingue moneda** — `US$1,234.50` vs `$1,234.50`; `formato.test.ts`
  lo fija.
- **Panel fiscal impecable en la doctrina** — `AvisoDeFallo` distingue lectura
  incompleta de caída y "NO se enseña ninguna cifra" (`comun.tsx:66-99`);
  `PieDeAlcance` declara el alcance; el comparativo contra el periodo anterior
  solo se pinta con historia real (`contador/page.tsx:63-66`); el rango se
  imprime con `fechaMx()` ("01 ene 2026 – 31 dic 2026").
- **`/chofer`** — `MarcoChofer` usa el `<Logo/>` real (`marco.test.tsx`, 2
  verdes); TOQUE 48/56; nav inferior con `aria-current`; barra de avance con
  `role="progressbar"` y `aria-valuetext`; sin anticipo no se dibuja barra
  (`vista.tsx:140-146`); cuatro pantallas de vacío importadas por el preview de
  /admin (cero espejos).
- **Accesibilidad de proceso** — `aria-live="polite"` con contenedor siempre
  presente (`forma.tsx:70-73`, `aceptar.tsx:42`); foco visible por outline del
  navegador; `StatusPill` nunca color solo; el error boundary de /dashboard
  muestra el `digest` y lo loguea (`error.tsx`).
- **`AvisoRol`** — la cinta se pinta también sin `?rol=` (la mitad que faltaba
  en la ronda 9) y "Quitar el rol" conserva `?tenant=`; el sidebar arrastra
  `sufijoTenant` (`sidebar-nav.tsx`).
- **Pruebas que corrí esta ronda**: `contraste`, `kit`, `filtro_rango`, `marco`,
  `estado`, `avance-cierre`, `cifra-grande`, `contador/page`, `despacho/vista` —
  64 verdes. `npx tsc --noEmit -p .` limpio; eslint 0 errores (6 warnings).

## Lo que no alcancé a revisar

1. **El render visual.** Esta sesión no puede ver imágenes, así que no pude
   mirar capturas ni levantar un preview: medí desde el código, el HTML servido
   (`renderToStaticMarkup`) y las pruebas. Los hallazgos de ancho (recuadro
   central, banda vacía) salen de aritmética de clases verificable, no de una
   foto; valen una captura a 1024 y a 1279 antes del demo.
2. **Modo oscuro** (`globals.css:117-124`). No hay switch que lo active; el
   bloque queda listo para uno. `--faint`/`--canvas`/`--okbg` no tienen override
   ahí y el día que exista el switch hay que medir esos pares.
3. **~15 páginas de `/dashboard`** (clientes, cobranza, suscripción,
   valor-ahorro, cotizador, documentos, facturación, mapa, operadores, políticas,
   rentabilidad, soporte, configuración, usuarios, incidencias). Verifiqué el
   patrón (40 archivos referencian `EstadoVacio`/`Pendiente`) pero no las leí
   línea por línea.
4. **`npm run build`** completo. Corrí tsc, eslint y las pruebas del rubro;
   no corrí el build para no pisar a otros auditores sobre el mismo árbol.
5. **El demo con datos.** La base real está vacía de datos del demo (el seed no
   está aplicado — hallazgo de datos, no de frontend). Las pantallas se ven hoy
   en su estado vacío; el comportamiento con `VJ-2026-0848` cargado no se pudo
   observar, y `dashboard/page.tsx:64-70` deja anotado el riesgo conocido de que
   el default de 7 días abra en ceros si el viaje del demo es más viejo que una
   semana (el fix es cambiar `'7'` por `'30'` en esa línea).

---

## VEREDICTO

**Green light condicional para frontend.**

Lo que el contralor toca en el demo —`/dashboard` del dueño, el panel del
contador, el chofer por WhatsApp— está en su mejor estado histórico: los ceros
que se leen como medición están resueltos y probados, los rótulos dicen su
ventana, el estado vacío es alcanzable y honesto, y el contraste de las notas
legales pasa AA. La regla del repo ("un rótulo tiene que ser verdad", "fallar
cerrado") se respeta en las pantallas que la demo va a mostrar.

Las condiciones antes de proyectar:

1. **Si la sala o el equipo proyecta a menos de 1280 px y se va a enseñar
   `/admin`**, el ALTO del recuadro central (292 px de banda vacía) se ve al
   primer vistazo. `/dashboard` no lo sufre; `/admin` sí, y es la consola que
   Javier abre para "Ver los otros paneles".
2. **El `ContadorRetro` sirve 000** — hoy es verdad (base vacía), pero es el
   mismo bug que la ronda 10 declaró ALTO en `KpiTile`; el día que haya datos,
   la consola miente en el HTML servido. Conviene cerrarlo con el mismo patrón
   (arrancar en `valorFinal` y animar solo cambios) antes de que exista el
   primer dato real.
3. **Los pills a 4.40–4.46:1** son la única deuda AA del rubro y están a menos
   de 0.1 de la línea; la prueba de contraste no los cubre. Un cambio de un
   paso en `--canvas` o `--okbg` los arregla sin tocar el diseño.

Nada de esto rompe el guion del demo (WhatsApp real + `/dashboard`); es deuda
que cobra factura en la primera presentación de la consola interna o en la
primera flota con datos. Los hallazgos de la ronda 10 verificados como cerrados
siguen cerrados; los seis de esta ronda son nuevos y están abiertos.
