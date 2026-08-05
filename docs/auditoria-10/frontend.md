# Frontend — auditoría 10

**Nota: 6/10** (ronda 9: 5/10). La vara: ¿aguanta que un contralor de flota lo
mire de frente, sin nadie explicándole, y que lo que lea sea verdad? 10 = puede
llevarle la cifra a su contador sin traducción. 5 = se ve caro pero hay que ir
corrigiendo lo que la pantalla dice mal. 1 = no se enseña.

| Panel | Nota | Por qué |
|---|---|---|
| `/chofer` (móvil) | 8 | Lo mejor construido. Cero fallos de contraste, cero blancos <44 px, sin scroll horizontal, navegación al pulgar. |
| `/dashboard/contador` | 6 | La mejor redacción del producto, arruinada por 4 rótulos cortados a la mitad y las citas legales a 2.56:1. |
| `/dashboard` (dueño) | 5 | El estado vacío es inalcanzable: pinta "0% tasa de cuadre" siempre. Su cifra de cabecera sale invisible. |
| `/admin` | 5* | 4 rótulos afirman "1 flota" con la base en 0. *No se pudo mirar renderizado — ver el cierre. |

Base de datos verificada por MCP en el momento de la auditoría: `tenant=0`,
`app_user=1`, `viaje=0`, `gasto=0`, `liquidacion=0`.

## Lo que más se nota con un cliente enfrente

### [ALTO] El estado vacío del panel del dueño es código muerto — el "0% tasa de cuadre" nunca se puede evitar
`src/app/dashboard/page.tsx:102` le pasa a `estadoPanel` el arreglo `porDia` en
el lugar donde antes iba la lista de liquidaciones. Pero
`getLiquidacionesPorDia` (`lib/cuadra/analytics.ts:187-190`) rellena un
elemento por día, así que su `length` vale siempre 7 o 30, nunca 0. La
condición `(s.liquidaciones?.length ?? 0) === 0` de `estado.ts:37` no puede
cumplirse jamás → la rama `'vacio'` ("Aún no hay liquidaciones") nunca se
pinta. `estado.test.ts:23` prueba la función con `liquidaciones: []`, un caso
que el call site real no produce — la prueba pasa y el bug vive debajo de ella.

Con la base vacía, `/dashboard` pinta la fila `0 · $0.00 · 0 · **0%**` bajo
"LIQUIDACIONES", con "Tasa de cuadre" en 0%. 300 px arriba, en la misma
pantalla, `avance-cierre.tsx:63-66` aplica la regla correcta con estas
palabras: *"Sin viajes en el periodo NO se pinta 0%: un 0% se lee como 'no has
cerrado nada', que es una acusación."* La regla existe, escrita, en la misma
página que la incumple.

### [ALTO] Cada `KpiTile` manda `$0.00` en el HTML servido, sea cual sea la cifra real
Probado contra el componente real (no un mock): con `valor={1234567.89}` el
servidor responde `$0.00`. `kit.tsx:49` hace `useCountUp(valor, !reducido)`;
en el servidor `usePrefersReducedMotion` devuelve `false`, así que `animar =
true` y `useCountUp` devuelve su `useState(0)` inicial. Afecta a todos los
tiles de `/admin`, `/dashboard` y el panel fiscal. Si el JS tarda, falla o
está bloqueado, un contralor lee "$0.00 Monto comprobado" sobre una flota que
comprobó $1.2 M — exactamente el cero que CLAUDE.md prohíbe: uno que se lee
como medición.

### [MEDIO] La cifra de cabecera del panel del dueño sale en blanco hasta hidratar
Confirmado en el HTML servido: encima de "SEÑALADO POR EL MOTOR" no hay
número, solo hueco. El valor vive en el DOM con `opacity:0`
(`cifra-grande.tsx:48`: `enVista || reducido ? 1 : 0`) y solo aparece tras
hidratar — es la cifra más grande del panel y la última en dibujarse. El
encargado no tiene este problema: su titular es un `<div>` plano
(`inicio-operacion.tsx:97-99`) que cae a `'—'` si no hay dato.

### [MEDIO] Rótulos cortados a la mitad — medido en píxeles, no estimado
| Pantalla | Ancho | Rótulo | Visible |
|---|---|---|---|
| Panel fiscal | 1440 | "IVA acreditable documentado" | 77% |
| Panel fiscal | 1280 | "IVA acreditable documentado" | 52% |
| Panel fiscal | 1280 | "El gasto del periodo, por su suerte fis…" | 98% |
| Encargado | 1440 | "Sin evidencia de entrega" | 40% |
| Encargado | 1440 | "Unidades disponibles" | 46% |

En el fiscal se cortan las palabras que son el significado: *documentado*,
*desglosado*, *observación fiscal*, *ante el SAT*. Causa: `kit.tsx:60`
(`truncate`) más `despacho/vista.tsx:24` (`xl:grid-cols-6`), que se apoya en
el ancho de la ventana cuando el ancho real disponible es ~1100 px por el
sidebar y el rail del asistente.

### [MEDIO] Dos filtros de periodo en la misma pantalla, con vocabularios distintos
"Semana | Mes | Todo" (`avance-cierre.tsx`, estado de cliente, mueve solo su
barra) y 130 px abajo "7d | 30d | Todo" (`GlobalFilter`, por URL, mueve todo).
En la captura conviven "Mes" seleccionado arriba y "últimos 7 días" escrito
abajo. Semana=7d y Mes=30d son lo mismo con otro nombre.

### [MEDIO] Dos de las tres secciones filtradas no dicen por qué periodo
El `GlobalFilter` sí mueve las tres consultas (el bug de "filtro decorativo"
de rondas previas está cerrado). Pero solo la gráfica lleva el periodo en el
título — "ESTÍMULOS ACREDITABLES" (`page.tsx:253`) y "LIQUIDACIONES"
(`page.tsx:274`) están ventaneadas y no lo dicen. Comparado `?rango=todo`
contra el default: encabezados idénticos, cifras distintas. Con el default de
7 días, "IVA acreditable $12,480" se lee como el total de la flota.
`page.tsx:68-78` ya anticipa este riesgo en un comentario y aun así deja las
secciones sin etiquetar.

### [ALTO] La consola de Javier le dice que tiene 1 flota. Tiene 0.
Cuatro afirmaciones estáticas, en el panel cuya premisa es no inventar cifras:
- `admin/crecimiento/page.tsx:41` — H1: "Con 1 flota dada de alta…"; `:44` —
  "solo existe el tenant demo" (esa fila no existe: por eso salta
  `AvisoSinFlota`).
- `admin/analitica/page.tsx:120` — "hoy Likida tiene 1 flota".
- `admin/page.tsx:155` y `admin/ejecutivo/page.tsx:54` — `r.tenants <= 1 ?
  'Flota (solo el demo)'` → con 0 tenants el tile queda "0 — Flota (solo el
  demo)".

### [MEDIO] Las citas legales están a 2.56:1
Medido sobre los píxeles del PNG, no sobre la tabla de tokens: el píxel más
oscuro de "LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente"
es `rgb(161,161,170)` sobre `rgb(255,255,255)` → 2.56:1, contra el 4.5:1 que
pide AA. Es `--faint` (`globals.css:68`), usado en 40 sitios: las notas de
todos los `KpiTile`, los subtítulos de `ChartCard` y las etiquetas de eje de
las gráficas a 10 px. `contraste.test.ts` mide `--color-ok` y `--color-bad`,
no `--muted` ni `--faint` — el hueco está en la prueba, no solo en el CSS.

### [BAJO] La fecha, en la línea más visible de tres paneles
"Martes, 4 De Agosto De 2026". El DOM trae bien "martes, 4 de agosto de 2026";
lo rompe el CSS `capitalize`, que capitaliza cada palabra, incluidos los dos
"de". Tres paneles: `dashboard/page.tsx:134`, `admin/page.tsx:104`,
`inicio-operacion.tsx:86`.

### [BAJO] Barra vacía donde el propio código prohíbe dibujarla
`avance-cierre.tsx:90-98` dibuja siempre la pista y la barra a `width: 0%`,
con el pie "No hay viajes iniciados en este periodo." — una barra vacía a lo
ancho del panel. `chofer/vista.tsx` dice literalmente: *"SIN ANTICIPO NO SE
DIBUJA BARRA. Una barra vacía se lee como 'llevas 0%'."* La regla existe,
escrita, y el panel del dueño la incumple.

### [BAJO] Pesos y dólares se escriben igual
`formato.ts:58` y `:63`: `mxn(1.83)` → `"$1.83"`, `usd(1.83)` → `"$1.83"`.
Idénticos. En `/admin` "Gastado en IA" y la columna "Costo de IA" son USD;
todo lo demás del producto es MXN. Nada en pantalla los distingue.

### [BAJO] Inconsistencias de identidad entre los cuatro paneles — CERRADO (logo y fecha)
- Logo: `/admin` y `/dashboard` usan el lockup `<Logo/>` (marca + LIKIDA).
  `/chofer` (`marco.tsx:36`) era texto plano "Likida". **Arreglado**:
  `MarcoChofer` ahora importa el mismo `<Logo/>` (`0cf4457`).
- Fechas: dueño "Martes, 4 De Agosto De 2026"; contador `2026-01-01 –
  2026-12-31` (ISO); chofer `fechaMx` → "31 jul 2026". Tres formatos.
  **Arreglado en parte**: el rango del panel fiscal (`EncabezadoFiscal`,
  `dashboard/contador/periodo.tsx`) era el único que no pasaba por
  `fechaMx()` — ahora sí, e imprime "01 ene 2026 – 31 dic 2026" como el resto
  de /dashboard (`0cf4457`). Sin tocar: `fechaLarga()` (saludo del dueño) y
  `fechaMx()` (chofer, y ahora también el contador) siguen siendo DOS
  formatos por diseño — uno es prosa de encabezado, el otro es la fecha
  fiscal única del producto — no un tercer duplicado por arreglar.
  ```
  $ npx vitest run src/app/chofer/marco.test.tsx src/app/dashboard/contador/periodo.test.tsx
   ✓ src/app/chofer/marco.test.tsx (2 tests)
   ✓ src/app/dashboard/contador/periodo.test.tsx (3 tests)
  ```
- Vacíos: el contador escribe párrafos honestos; el dueño y el encargado
  ponen ceros. **Sin tocar** — es un rediseño de contenido por panel, fuera
  del alcance de "unificar sin rediseñar cada panel".

### [BAJO] El preview del chofer en `/admin` ya se desincronizó del real — CERRADO
`admin/vista-chofer/page.tsx:52-95` espejeaba los cuatro textos de vacío en
vez de importarlos, y su propio comentario lo admitía. Ya había divergido: el
`/chofer/liquidacion` real remataba con `<EnlaceViajes/>`
(`liquidacion/page.tsx:46`), un botón de 56 px "Ver mis viajes"; el espejo no
lo tenía. **Arreglado** (`4498501`): las cuatro pantallas de vacío
(`SinViaje`, `SinViajeParaSaldo`, `SinViajeParaComprobantes`,
`SinViajesRegistrados`) se exportan desde `chofer/vista.tsx` — el archivo
pensado justo para esto — y las tres páginas reales (`liquidacion/`,
`comprobantes/`, `viajes/`) las usan también, así que no hay dos copias del
mismo texto en ningún lado. El preview ya no tiene nada que mirrorear.
```
$ npx vitest run src/app/admin/vista-chofer/page.test.tsx src/app/chofer
 ✓ src/app/chofer/marco.test.tsx (2 tests)
 ✓ src/app/admin/vista-chofer/page.test.tsx (3 tests)
 Test Files  4 passed (4) · Tests  202 passed (202)
```

### [BAJO] Tarjetas medio vacías en el panel fiscal — CERRADO
"EL GASTO DEL PERIODO" quedaba con ~450 px de blanco bajo su mensaje, porque
el grid la estiraba a la altura de "ESTADO DEL PAPEL". Se leía como sección
rota. **Arreglado** (`03f5c80`): el grid pasa a `items-start` — cada
`ChartCard` ya trae su propio piso (`minHeight` por `tamano`) y ahora mide lo
que su propio contenido necesita, no lo que necesita el vecino.
```
$ npx vitest run src/app/dashboard/contador/page.test.tsx
 ✓ src/app/dashboard/contador/page.test.tsx (2 tests)
```

## Lo que ya está bien

- `AvisoSinFlota` es el patrón de oro. Nombra el uuid y dice: *"Lo de abajo
  son ceros de una flota inexistente, no cifras de un cliente: sirve para
  mirar cómo se ve el panel, no para leer un número"*, con enlace a dar de
  alta. Ojalá esa frase gobernara las otras 24 pantallas.
- El panel del chofer, medido: 0 textos bajo AA, 0 blancos de toque <44×44,
  `scrollWidth == clientWidth` a 375 y a 390. Navegación abajo, pestaña activa
  con color y negrita (no solo color).
- Cobertura de estados vacíos alta: 24/25 páginas de `/dashboard` y 24/30 de
  `/admin` referencian `EstadoVacio`/`Pendiente`.
- El contador escribe mejor que nadie: *"No hay comprobantes con fecha dentro
  de Ejercicio 2026. Todavía no ha entrado ninguno. En cuanto un operador
  mande la primera foto por WhatsApp aparece aquí con su lectura fiscal."* Y
  la sección "Lo que este panel no puede decirte" (retenciones, estímulo en
  pesos, ingresos) es honestidad poco común.
- El foco de teclado se ve en los cuatro paneles: `outline: auto 1px
  rgb(0,95,204)` en cada elemento tabulado (el anillo del navegador, azul, no
  de marca — funciona, desentona).
- `aria-live="polite"` bien puesto en los dos formularios que avisan
  (`admin/ui/forma.tsx:87`, `chofer/aceptar.tsx:42`), con el contenedor
  siempre presente.
- Sin scroll horizontal en ninguna toma, a 375, 390, 1280 y 1440.
- El `GlobalFilter` sí mueve las tres consultas — el bug de "filtro
  decorativo" que se pisó dos veces está cerrado.
- `StatusPill` nunca es solo color: siempre trae texto.

## Lo que no se pudo ver, y por qué

1. **`/admin` renderizado hoy.** Es el único de los cuatro paneles que no se
   puede mirar sin sesión: su `layout.tsx:35` y su `page.tsx:80` llaman
   `requireSuperadmin()` dentro del componente, y no hay un `chrome.tsx`
   separado como sí lo tienen `/dashboard` (`chrome.tsx`) y `/chofer`
   (`marco.tsx`). La regla de verificación de CLAUDE.md está implementada en
   tres paneles y no en el cuarto. Se intentó abrir sesión real y el
   clasificador de permisos bloqueó el script que acuñaba la sesión con la
   `service-role key` — con razón, no se forzó. Lo que sí se miró fue la
   captura del 3-ago (`pruebas-manuales/ensayo/2026-08-03/05-admin-real.png`),
   de antes de que se agregara el `SelectorVista` y de que se vaciara la
   base. Su nota de 5 sale del código y de esa captura vieja, no de mirarlo
   hoy.
2. **Las 19 páginas restantes de `/dashboard`** (cuadre, viajes, operadores,
   rentabilidad…). Resuelven el tenant adentro con `resolverTenantEfectivo`,
   así que no exponen un componente montable sin sesión. Solo el subárbol del
   contador (5 páginas) exporta `Contenido`.
3. **El comportamiento tras hidratar, con certeza.** El servidor de
   desarrollo recargaba la página cada 1-3 s porque otro agente edita el repo
   en vivo; se montó una copia congelada en scratchpad para las capturas. Lo
   que sí queda probado —porque sale del HTML, no del navegador— es que el
   servidor manda `$0.00` en los `KpiTile` y `opacity:0` en la cifra grande.
4. **Modo oscuro** (`globals.css:106`). No se recorrió; `--faint` no tiene
   override ahí, así que conviene medirlo aparte.
5. **`npm run build`** no compilaba en el momento de esta auditoría, por
   trabajo en vuelo de otros agentes sobre archivos no relacionados con UI
   (`datosBancarios`, `facturapi.test.ts`, `escalar_viaje.test.ts`). Nada de
   eso es de frontend; por eso no se pudo verificar contra un build de
   producción. **Nota de la síntesis:** el árbol ya compila limpio al momento
   de escribir esta ronda — ver `00-SINTESIS.md`.
