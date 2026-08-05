# Frontend — auditoría 13

**Nota: 8/10** (auditoría 12 tras arreglos: 9/10 en la re-auditoría; esta ronda baja un
punto). La vara sigue siendo la misma de las rondas 10 y 12: ¿aguanta que un
contralor de flota lo mire de frente, sin nadie explicándole, y que lo que lea sea
verdad? 10 = puede llevarle la cifra a su contador sin traducción.

**Razón del movimiento: mirada más profunda tras los ~40 fixes — los cierres de la
ronda 12 son reales y quedan VERIFICADOS uno por uno (recuadro central, ContadorRetro,
pills AA, gráficas SSR, medidos por mí con la fórmula WCAG), pero la relectura línea por
línea encontró deuda que esa ronda no cubrió**: la `CifraGrande` del panel del dueño
sirve `$0.00 Señalado por el motor` en el HTML cuando la consulta de KPIs falló —el
mismo cero-que-se-lee-como-medición que la ronda 10 cerró en `KpiTile` y la 12 en
`ContadorRetro`, vivo en la cifra más grande de la pantalla—; el bug del cruce de
breakpoint con el asistente expandido (MEDIO de la ronda 12, que quedó abierto) tiene
una SEGUNDA instancia viva en `/admin/asistente-expandible.tsx` que el fix del recuadro
central (0071b9f) no tocó; y la afirmación de la síntesis 12 de que "cada fix trae su
prueba" es falsa para los 3 commits de frontend: `contraste.test.ts` sigue sin cubrir
los pares de pills que el fix cambió, y `graficas.test.tsx` solo existe en la rama
`claude/auditoria-11`, nunca mergeada a master.

| Panel | Nota | Por qué |
|---|---|---|
| `/dashboard` (dueño) | 7 | Los cierres de la 12 siguen cerrados (estado vacío honesto, cifra grande con valor real cuando hay datos), pero la cabecera sirve `$0.00` cuando `kpis` es null — el cero con consulta caída, la única superficie del producto que todavía lo hace. |
| `/dashboard/contador` | 8 | Sigue siendo lo mejor redactado del producto: `AvisoDeFallo` que no enseña cifras, comparativo solo con historia real, rango impreso con `fechaMx()`. |
| `/admin` | 7 | Recuadro central cerrado y verificado bajo 1280 px; pero el asistente expandido + cruzar el breakpoint deja la columna invisible SIN forma de recuperarla — mismo bug que el rail de /dashboard, que la ronda 12 reportó y no cerró. |
| `/chofer` (móvil) | 8 | Sin regresiones: TOQUE 48/56, barra sin anticipo que no se dibuja, cuatro vacíos honestos, pills ya AA (4.83/4.87). |

---

## Hallazgos por severidad

### [MEDIO] La `CifraGrande` del panel del dueño sirve `$0.00` cuando la consulta de KPIs falló — el cero-que-se-lee-como-medición, vivo en la cifra más grande del panel
`src/app/dashboard/page.tsx:159` — `valor={kpis?.diferenciaDetectada ?? 0}` — y
`dashboard/page.tsx:151` — `AvanceCierre viajes={viajes ?? []}` con su pie
`avance-cierre.tsx:122` (`'No hay viajes iniciados en este periodo.'`).

**Escenario con valores.** La base cae (o una consulta lanza): `safe()` devuelve `null`
para `kpis`. El `estadoPanel` pasa a `'error'` o `'parcial'` y el cuerpo SÍ lo anuncia
("No se pudieron cargar los datos" / "Faltan datos por cargar"), **pero el encabezado se
pinta siempre, fuera del condicional de estado**: la `CifraGrande` sirve `$0.00 Señalado
por el motor · Sobre política y duplicados · últimos 7 días` a opacidad plena en el HTML
servido. Un contralor que abre el panel con Supabase caído lee primero la cifra más
grande de la pantalla — `$0.00` — como una medición ("el motor no señaló nada"), cuando
en realidad no se pudo leer nada. Y `AvanceCierre` afirma "No hay viajes iniciados en
este periodo" con la consulta de viajes caída (`?? []` convierte el fallo en ausencia).
Es literalmente la doctrina que la ronda 10 escribió para `KpiTile` y que la ronda 12
verificó cerrada ahí y en `ContadorRetro` — este call site quedó sin tocar porque
ninguna de las dos rondas miró el valor *con la consulta fallada*, solo el valor *con
datos*. Con el seed del demo cargado no se ve (kpis responde); se ve el primer día que
Supabase tenga un bache.

**Estado: abierto.** El fix es el mismo patrón ya probado en el repo: cuando `kpis` es
null, la cabecera no enseña una cifra (o enseña el mismo "—" que `SinDato` usa en el
panel fiscal, `contador/comun.tsx:187`), y `AvanceCierre` recibe los viajes reales, no
`?? []`.

### [MEDIO] Expandir el asistente y cruzar bajo 1280 px deja la columna central invisible — el hallazgo de la ronda 12 sigue abierto, y ahora con una segunda instancia confirmada en /admin
`src/app/dashboard/rail.tsx:46-49` (la marca `data-asistente` en `document.documentElement`
con cleanup solo en desmontaje), `globals.css:217-222`
(`:root[data-asistente="expandido"] .columna-centro { opacity: 0; pointer-events: none }`),
y **NUEVO**: `src/app/admin/asistente-expandible.tsx:45-47` (`flex: expandido ? '0 1 0%' :
'1 1 0%'`, `opacity: expandido ? 0 : 1`) con el aside `hidden xl:flex` en `:61`.

**Escenario con valores (el mismo de la ronda 12, ahora verificado en los dos paneles).**
Laptop a 1366 px: el usuario expande el Asistente → en /dashboard se marca
`data-asistente="expandido"`; en /admin el estado React `expandido=true` encoge el main a
`flex: 0 1 0%` + `opacity: 0`. Luego la ventana encoge (o hace zoom al 90%) y cruza los
1280 px: el aside pasa a `display:none` por `hidden xl:flex` **pero sigue montado** — en
/dashboard el cleanup del efecto no corre porque no hay desmontaje, y en /admin el estado
React sigue `true`. Resultado en los dos paneles: la columna central queda invisible
(`opacity:0` / `flex:0 1 0%`) y el botón "Contraer" vive dentro del aside oculto → la
única salida es recargar la página. El fix de la ronda 12 (0071b9f) arregló el ANCHO del
recuadro bajo 1280 (verificado: ahora `flex: '1 1 0%'` llena la columna) pero no este
cruce con `expandido=true`.

**Estado: abierto** (era el MEDIO de la ronda 12; la instancia de /admin es extensión
confirmada de esta ronda — el propio comentario de `asistente-expandible.tsx:36-38`
documenta el `hidden xl:flex` sin considerar el caso expandido).

### [BAJO] El box "Smart Insight" en estado de error cae a 4.32:1 — el fix de pills de la ronda 12 no cubrió este par
`src/app/dashboard/rail.tsx:118-119` — `background: color-mix(in srgb, var(--color-warn)
10%, transparent)` con `color: var(--color-warn)` para la etiqueta "Smart Insight"
(`text-[10px] font-semibold uppercase`).

**Escenario con valores.** El rail no puede leer las cifras (`errorCarga=true`) y pinta el
box ámbar. Texto `#a16207` sobre su propio tinte al 10% sobre superficie:
**4.32:1** (medido con la fórmula WCAG, la misma del repo). AA pide 4.5:1 para texto
normal, y 10 px semibold NO es "texto grande" (eso empieza en 18.66 px negrita). La ronda
12 arregló los pills del kit (`--ok`/`--warn`/`--canvas`, ver verificación abajo) pero
este box usa el token VIEJO `--color-warn` (#a16207), no el nuevo `--warn` (#9a5c00), y
sobre un fondo teñido — el único par del rail que no pasó el cierre. El box verde
(`--color-ok` al 10%) sí pasa: 6.56:1.

**Estado: abierto.** Es estado transitorio (solo con fallo de carga), pero es texto real
que falla AA por 0.18.

### [BAJO] `?rol=` no sobrevive al `GlobalFilter` de /dashboard y /dashboard/analitica
`src/app/dashboard/page.tsx:239` — `extra={sp?.tenant ? { tenant: sp.tenant } : sp?.vista
? { vista: sp.vista } : undefined}` — y `src/app/dashboard/analitica/page.tsx:51-52`
(ídem), contra `dashboard/sufijo.ts` que SÍ arrastra `?rol=` en todos los links internos.

**Escenario con valores.** El superadmin entra desde /admin a `/dashboard?vista=demo&rol=
flota_admin` (el link de `selector-vista.tsx:44`) y toca 30d: el pill construye
`/dashboard?vista=demo&rango=30` — **sin `rol=flota_admin`**. `rolEfectivo` vuelve a
'superadmin'; el contenido no cambia (dueño y superadmin ven la misma área), pero la cinta
`AvisoRol` pierde el nombre del rol: pasa de "Estás viendo el panel como **Dueño de la
flota**" a la variante genérica "Estás previsualizando el panel del cliente". Es el mismo
patrón de bug que la ronda 12 cerró con `sufijoTenant` en los links internos — el filtro
de rango quedó fuera de esa regla.

**Estado: abierto.**

### [BAJO] La línea de términos del login sigue a ~2.75:1
`src/app/login/page.tsx:186` — `text-[#6b6b6b]/70` a 11 px: ≈ 2.75:1 sobre blanco
(medido con la fórmula WCAG). Los links "Términos" y "Aviso de Privacidad" van en
`#0a0a0a` (bien); la frase que los presenta no llega ni a 3:1. El placeholder
(`#6b6b6b99`, ≈ 1.66:1) sigue igual — WCAG tolera placeholders, pero es el mismo hábito.

**Estado: abierto** (BAJO de la ronda 12, sin cambios).

### [BAJO] `inicio-operacion.tsx` sigue declarando un scroll que no implementa
`src/app/dashboard/inicio-operacion.tsx:72-74` — el comentario "EL SCROLL VIVE DENTRO DE
CADA PANEL… Con `h-full` + `min-h-0` en la cadena…" sigue sin corresponder al markup
(`glass-panel overflow-hidden shrink-0`; el scroll real es el de la columna,
`MARCO_SCROLL`). El comportamiento es correcto; el comentario es el que hace perder una
tarde buscando un scroll interno que no existe.

**Estado: abierto** (BAJO de la ronda 12, sin cambios).

### [BAJO] eslint: ahora 10 warnings (los 6 de /admin siguen, +4 nuevos en archivos de prueba)
`src/app/admin/page.tsx:8-9,26,33` — `BarChart3`, `UserPlus2`, `MessageCircle`, `Sparkles`,
`FASE_ICONO`, `Insignia` sin usar (los mismos 6 de la ronda 12), y 4 más en archivos de
prueba de la propia ronda 12: `src/lib/cuadra/administracion.test.ts:304-305` (`a` sin
usar ×2), `src/lib/cuadra/analytics_por_dia.test.ts:13` (`pideConteo`), y
`src/lib/saas/transferencia_mensualidad.test.ts:25` (`registro`). 0 errores.

**Estado: abierto** (los 6 preexistentes; los 4 nuevos son regresión menor de la 12).

### [BAJO] `--faint` sobre `--canvas2` queda en 4.4987:1 — latente, pero es el par exacto que el fix de la 12 no midió
`src/app/globals.css` (`--faint: #73737c`, `--canvas2: #fafafa`) usado en
`src/app/admin/ui/kit.tsx:144` (subtítulo de `ChartCard` en su variante `soft`,
`kit.tsx:135`). **4.4987:1** < 4.5:1, medido con la fórmula WCAG. Hoy `ChartCard soft` no
se usa en ninguna página (verificado con grep: solo la definición), así que no es un
fallo vivo — es el mismo "se anota para cuando alguien lo use" que la ronda 12 escribió
para `--faint`/`--canvas`. El par `--faint`/`--canvas` (#f9f9fa) tampoco tiene texto vivo
encima hoy (4.46:1, solo íconos). Ambos quedan anotados: un `ChartCard soft` con subtítulo
reprueba AA por 0.0013.

**Estado: abierto (latente).**

---

## Verificación de los cierres de la ronda 12 (uno por uno, contra el código ACTUAL)

- **[ALTO] Recuadro central de /admin bajo 1280 px — CERRADO (0071b9f), verificado.**
  `asistente-expandible.tsx:44-51`: el main ahora es `flex: expandido ? '0 1 0%' : '1 1
  0%'` con `min-w-0` — bajo 1280 el aside `hidden xl:flex` no ocupa espacio y el main
  llena la columna. La aritmética de la ronda 12 (292 px de banda vacía) ya no existe.
- **[ALTO] `ContadorRetro` servía "000" — CERRADO (632abb2), verificado.**
  `contador-retro.tsx:41` arranca en `useState(valor)` (el valor real viaja en el HTML
  servido) y la animación solo corre cuando `valor` cambia tras montar
  (`contador-retro.tsx:54-56`). Los call sites reales (`agente-ocr/page.tsx:47`,
  `analitica/page.tsx:51`, `flotas/page.tsx:72`) pasan valores del server; el `valor={0}`
  de `admin/page.tsx:118` y `ejecutivo/page.tsx:37` es el MRR real (Likida no cobra), con
  comentario que lo declara.
- **[MEDIO] Pills AA — CERRADO (24ee4f1), verificado numéricamente por mí con la fórmula
  WCAG**: `--ok #137a38` sobre `--okbg #e7f5ec` = **4.83:1**; `--warn #9a5c00` sobre
  `--warnbg #fbf3e0` = **4.87:1**; `--bad #b91c1c` sobre `--badbg #fbeaea` = **5.56:1**;
  `--muted #6b7280` sobre `--canvas #f9f9fa` = **4.59:1**. Todos ≥ 4.5. Las pastillas del
  chofer (`chofer/vista.tsx:74-76`) usan los mismos tokens y pasan.
- **[MEDIO] Gráficas del kit vacías en el HTML — CERRADO (24ee4f1), verificado.**
  Las 11 gráficas de `graficas.tsx` tienen `const animar = true` (contados los 11); el
  `Gauge` sirve `stroke-dashoffset: 0` y las barras su ancho real en el HTML servido. El
  redondeo a 3 decimales de `Gauge.punto()` (anti-mismatch de hidratación) sigue.
- **[MEDIO] Pills de filtro y cinta de rol a 4.40:1 — CERRADO por el mismo cambio de
  `--canvas`**: `GlobalFilter`, `SelectorPeriodo` y `AvisoRol` usan `--muted` sobre
  `--canvas #f9f9fa` = **4.59:1**.
- **[BAJO] `CifraGrande` sin opacidad 0 — sigue cerrado**: `useCountUp` arranca en
  `valorFinal` (`use-count-up.ts:35`); con datos, el HTML sirve la cifra real.

**Pero la afirmación de la síntesis 12 "cada fix con su prueba" es FALSA para frontend**:
los 3 commits de cierre (0071b9f, 632abb2, 24ee4f1) no tocan ningún `.test.*` (verificado
con `git show --name-only`), `contraste.test.ts` sigue sin cubrir los pares de pills que
el fix cambió (solo mide `--color-ok`/`--color-bad`/`--faint`), y `graficas.test.tsx` solo
existe en la rama `claude/auditoria-11` (bc7fc86), nunca mergeada a master. Los fixes son
reales — pero mañana alguien puede revertir `--ok` a `#15803d` y la suite sigue verde.
Eso es deuda de proceso del rubro: hallazgo registrado, no cerrado.

---

## Lo que revisé y está bien (verificado en el código ACTUAL, con prueba)

- **Estado vacío del dueño intacto** — `dashboard/page.tsx:102` pasa
  `liquidacionesDeViajes(viajes)`; `estado.ts:44-50` filtra `estatus === 'liquidado'`;
  `estado.test.ts`: 14 verdes. Con el seed del demo (3 liquidaciones + VJ-2026-0847
  abierto + 2 gastos a `current_date-1`), el panel abre en `'datos'`, no en vacío — el
  riesgo anotado en la ronda 12 (default 7d abriendo en ceros) no se materializa porque
  el seed siembra fechas recientes.
- **`AvisoSinFlota` ANTES que los ceros** (`sin-flota.tsx:26-31`, `dashboard/page.tsx:169`),
  con el uuid real en pantalla.
- **Panel fiscal impecable** — `AvisoDeFallo` no enseña cifras (`comun.tsx:66-99`); el
  comparativo solo con historia real (`contador/page.tsx:63-66`); rango con `fechaMx()`
  ("01 ene 2026 – 31 dic 2026"); `SinDato` es `—` con `title`, nunca un cero. Pruebas:
  `periodo.test.tsx` (3), `contador/page.test.tsx` (2) verdes.
- **`estadoPanel` y el fallo parcial** — con una sección caída pinta `'parcial'` y avisa
  "Faltan datos por cargar" (`dashboard/page.tsx:216-228`); el error total dice "esto NO
  significa que no haya liquidaciones".
- **`/chofer`** — `Pastilla` ya en tokens nuevos (4.83/4.87); `Barra` con
  `role="progressbar"` y `aria-valuetext`; sin anticipo no se dibuja barra
  (`vista.tsx:284-288`); `Pendiente` nunca con ceros; `marco.test.tsx` (2) y
  `vista-chofer/page.test.tsx` (3) verdes.
- **Filtro de rango a prueba de balas** — `filtro_rango.test.ts`: 21 verdes; viaje
  redondo URL→parser conservando `?tenant=`/`?vista=`.
- **Sin barra fantasma** — `avance-cierre.tsx:90-98`: sin `pct` no se dibuja ni la pista;
  `avance-cierre.test.tsx`: 4 verdes.
- **`usd()`/`mxn()`/`litros()` viven solo en `lib/formato.ts`** — `formato.test.ts` (7
  verdes) escanea `src/` por `toLocaleString('es-MX')` fuera del archivo canónico; no
  hay fugas.
- **Hidratación** — `Gauge.punto()` y `puntoEnCirculo` redondean a 3 decimales; no hay
  `Math.cos`/`Math.sin` sin redondear en SVG servidos. `AvanceCierre` recibe `ahoraMs`
  del servidor (sin reloj de cliente, sin mismatch).
- **`Marco` y medidas** — los dos paneles siguen compartiendo `marco.ts`; el `aside` del
  rail y del asistente usan `ANCHO_ASISTENTE`/`MARCO_ASISTENTE` (276, `marco.ts:52`).
- **`dashboard/error.tsx`** — boundary con `digest` en pantalla y logueado; el mensaje
  "Esto NO significa que no haya liquidaciones" es exacto.
- **`loading.tsx`** — logo respirando con `prefers-reduced-motion` apagado.
- **Demo** — `/demo` (simulador con `🔴 INVENTADO` declarado) y el botón "Ver el demo"
  del estado vacío apuntan al componente real.

**Pruebas que corrí esta ronda**: `contraste`, `estado`, `filtro_rango`, `avance-cierre`,
`cifra-grande`, `kit`, `periodo`, `contador/page`, `despacho/vista`, `chofer/marco`,
`vista-chofer/page`, `formato`, `foto_no_expuesta`, `dinero_por_area`, `confirmacion`,
`etiquetas_panel` — **106 verdes, 0 rojos**. `npx tsc --noEmit -p .` limpio. eslint 0
errores / 10 warnings (los 6 de admin/page.tsx + 4 nuevos en pruebas).

## Lo que no alcancé a revisar

1. **El render visual.** Esta sesión no puede ver imágenes, así que no levanté el preview
   con Chrome headless: medí desde el código, el HTML servido y las pruebas. Los
   hallazgos de esta ronda (CifraGrande con consulta caída, cruce de breakpoint con
   asistente expandido) salen de aritmética de estado/clases verificable, no de una foto;
   valen una captura a 1366→1279 px antes del demo si se va a enseñar /admin con el
   asistente expandido.
2. **~15 páginas de /dashboard** (clientes, cobranza, suscripción, cotizador, mapa,
   operadores, políticas, rentabilidad, soporte, configuración, usuarios, incidencias,
   pod, unidades, viajes). Verifiqué el patrón (`EstadoVacio`/`Pendiente`/`vacio=`) pero
   no las leí línea por línea.
3. **`npm run build` completo** — corrí tsc, eslint y las pruebas del rubro; no el build
   para no pisar a otros auditores sobre el mismo árbol.
4. **El `-mt-8` de la cifra del `Gauge`** (graficas.tsx:68): la cifra se superpone al
   arco con margen negativo; no pude confirmar visualmente que no pise el trazo con
   valores de 3 dígitos. No lo reporto como hallazgo sin verlo.
5. **Contraste exacto del `color-mix` del box "Smart Insight" sobre el glass-panel real**
   (que es 92% de superficie sobre el shader oscuro): mi medición usa el tinte sobre
   blanco puro (4.32:1); el fondo real puede variar ±0.1 — en ningún caso llega a 4.5.

---

## VEREDICTO

**Green light condicional para frontend.**

Lo que el contralor toca en el demo —`/dashboard` del dueño con el seed sembrado, el
panel del contador, el chofer por WhatsApp— sigue en su mejor estado histórico: los
cierres de la ronda 12 están verificados uno por uno (el recuadro central ya no deja
banda vacía bajo 1280, el `ContadorRetro` sirve el valor real, los pills pasan AA, las
gráficas nacen con su valor), y el estado vacío + los avisos de fallo del panel fiscal
siguen siendo los mejores del producto. La regla del repo ("fallar cerrado y decirlo")
se respeta en todas las superficies del demo **menos una**: la cabecera del dueño con la
consulta caída.

Las condiciones antes de proyectar:

1. **Si se va a enseñar /admin y alguien expande el asistente**, el cruce bajo 1280 px
   deja la columna invisible sin forma de recuperarla — en los DOS paneles ahora. Es el
   MEDIO heredado de la ronda 12 (rail) más su gemelo nuevo en /admin. A 1024–1279 px el
   botón de expandir ni se ve; el caso real es expandir en la laptop y conectar el
   proyector.
2. **Si Supabase tiene un bache durante la demo**, el panel del dueño muestra
   `$0.00 Señalado por el motor` arriba con el aviso de fallo abajo — la cifra más
   grande mintiendo justo en el escenario que la ronda 5 marcó CRÍTICO. Es deuda que
   cobra factura en producción, no en el demo (el seed responde).
3. **La suite no protege los fixes de la 12**: los tres commits de frontend no trajeron
   prueba, y `contraste.test.ts` no cubre los pares de pills. Nada de lo verificado
   arriba está fijado por un test — si alguien toca `globals.css` a ojo, vuelve el 4.46:1
   sin que el CI se entere.

Los dos MEDIO de la ronda 12 quedaron: uno cerrado y verificado (pills AA), uno abierto
y ahora duplicado (cruce de breakpoint). Los hallazgos nuevos de esta ronda son el cero
de la cabecera con consulta caída, el `?rol=` que se pierde en el filtro de rango, y el
box "Smart Insight" a 4.32:1. Nada de esto rompe el guion del demo con el seed cargado;
todo cobra factura en la primera presentación con datos reales o en el primer bache de
la base.
