# Frontend — nota 7/10

Nota anterior: 6. Los dos riesgos nombrados en el boletín anterior se
verificaron contra el código actual:

- **El mapa `CONCEPTO` obsoleto (bloqueante #2 del boletín) YA ESTÁ CORREGIDO.**
  `src/app/dashboard/[id]/page.tsx:14-18` trae los 8 conceptos de
  `src/types/cuadra.ts:10-14` (incluidos `alimentacion`, `hospedaje`,
  `transporte`), con un comentario explícito (líneas 11-13) que dice mantenerlo
  en sintonía con `CONCEPTO_LABEL` de `liquidacion/pdf.ts:23-27` y `label()` de
  `cuadre/engine.ts:466-469` — verifiqué los tres y hoy están sincronizados.
  Además el fallback `CONCEPTO[g.concepto] ?? g.concepto` (línea 98) hace que un
  concepto futuro sin mapear muestre el valor crudo, nunca `undefined`.
- **"Sin prueba ni lint" — el lint ya existe y pasa limpio.** `eslint.config.mjs`
  está creado, `npm run lint` corre `eslint .` (antes invocaba `next lint`, que
  Next 16 quitó) y termina sin errores ni warnings sobre `src/app/dashboard/`.
  `jsx-a11y` está activo (verificado con `eslint --print-config`). La parte de
  "sin prueba" sigue exactamente igual — ver rubro Pruebas.
- **`loading.tsx` y `error.tsx` (bloqueante #3 y mejora #14) ya existen** para
  `/dashboard` y `/dashboard/[id]` — antes cero, ahora cuatro archivos con
  skeleton y manejo de error por segmento.

Con eso, el riesgo central del boletín anterior (un dato en blanco frente al
comprador) está cerrado. Lo que sigue son problemas nuevos o no cubiertos por
esa auditoría, y uno estructuralmente idéntico al que ya mordió una vez.

## Hallazgos

### [medio] El mapa `ESTATUS` está duplicado sin fuente única — el mismo patrón que causó el bug de `CONCEPTO`
`src/app/dashboard/page.tsx:11-15` y `src/app/dashboard/[id]/page.tsx:19-23`
declaran el mismo objeto `ESTATUS` (`cuadrada`/`con_diferencias`/`revisar`) por
separado, copiado a mano, sin importar de un módulo común. Hoy coincide con
`EstatusLiquidacion` en `types/cuadra.ts:91`, así que no hay fallo visible
todavía — pero es exactamente la forma en la que se desincronizó `CONCEPTO`: si
mañana se agrega un cuarto estatus, hay que acordarse de tocar dos archivos y
nada avisa si se te olvida uno. Si el mapa se actualiza en un solo archivo, el
otro muestra el fallback `{ label: l.estatus, color: 'var(--muted)' }` — no
"undefined" (el fallback ya es defensivo), pero sí una etiqueta cruda y sin
color de semáforo en una de las dos pantallas.

### [bajo] Cero `<h1>` en la pantalla que el comprador ve primero
`src/app/dashboard/page.tsx` no tiene ningún `<h1>` — el nombre "Likida" del
header (línea 61) es un `<span>`, y las secciones usan `<h2>`. Solo
`src/app/dashboard/[id]/page.tsx:45` tiene un `<h1>`. Es el mismo hallazgo #27
del boletín anterior, sin corregir en la página de listado (sí corregido,
aparentemente sin querer, en la de detalle). `eslint-config-next` con
`jsx-a11y` no lo detecta porque no es una regla de ese plugin — no basta con
que el lint pase limpio.

### [bajo] Contraste insuficiente en el único mensaje de error visible al usuario del panel
`src/app/acceso/page.tsx:42-44` — el texto de error ("Código incorrecto" /
"Demasiados intentos...") usa `color: var(--color-bad)` = `#ff3b30` sobre fondo
`--surface: #ffffff` (tema claro, `globals.css:58`), en `text-xs` (12px). Ratio
calculado ≈3.59:1, contra el mínimo AA de 4.5:1 para texto normal. Es el mismo
hallazgo #27 del boletín anterior, sin corregir. `jsx-a11y` no evalúa contraste
computado, así que el lint limpio tampoco lo cubre.

### [bajo] La tabla de liquidaciones recorta en vez de deslizar en pantalla angosta
`src/app/dashboard/page.tsx:155` y `src/app/dashboard/[id]/page.tsx:93` usan
`className="card overflow-hidden"` para envolver una tabla de 5 y 3 columnas
respectivamente. En un viewport angosto (el comprador viendo el panel desde el
teléfono) el contenido que no cabe se CORTA, no se desliza — `overflow-hidden`
en vez de `overflow-x-auto`. Mismo hallazgo #27 del boletín anterior, sin
corregir.

### [bajo] Sin `not-found.tsx` en ninguna ruta del panel
No existe `not-found.tsx` en `src/app/` (verificado con `find`). Si el
contralor sigue un link viejo a una liquidación borrada o mal copiada,
`dashboard/[id]/page.tsx:28` llama a `notFound()` y cae en la página 404
genérica de Next, sin la marca ni un link de regreso al panel — a diferencia de
`dashboard/error.tsx`, que sí está cuidado.

### [bajo] Estado "Comprobantes" sin mensaje vacío
`src/app/dashboard/[id]/page.tsx:91-106` — la sección "Comprobantes" siempre
renderiza el `<h2>` y la tabla, sin condicionar a `d.gastos.length > 0` (a
diferencia de las secciones "Acreditable" y "Diferencias detectadas", que sí
se ocultan cuando no aplican, líneas 64 y 76). Si una liquidación llega a
cerrarse sin gastos capturados, el comprador ve un encabezado seguido de una
tabla vacía sin explicación, en vez de un mensaje.

### [opinión, bajo] `getStatsPorOperador` sigue exportando una cifra que miente, y sigue sin consumidores
`src/lib/cuadra/analytics.ts:73` — `diferencias: 0` hardcodeado, exactamente
como en el boletín anterior (#21). Verifiqué con `grep` que hoy no se llama
desde ningún componente del dashboard — no es un hallazgo visible en la demo,
pero sigue siendo una trampa exportada para quien la conecte después sin leer
el comentario que falta.

### [opinión, bajo] `demo/page.tsx` duplica el formateador de moneda en vez de importar el compartido
`src/app/demo/page.tsx:18` define su propio `const mxn = (n) =>
n.toLocaleString('es-MX', {...})` en vez de importar `mxn` de `@/lib/utils.ts`.
Hoy produce el mismo resultado — no es un bug — pero es una segunda fuente de
verdad del formato de moneda: si `lib/utils.ts` cambia (p. ej. para forzar
`minimumFractionDigits`, como ya hace `usd()` en el mismo archivo), esta copia
no se entera.

# Pruebas — nota 6/10

Nota anterior: 6. El riesgo nombrado era puntual: "el cálculo del dinero está
probado; la ESCRITURA del dinero no tiene ni un arnés." Verificado contra el
código actual (39 archivos, 360 tests, todos pasan en 5.46s): **ese hueco
sigue exactamente ahí**, sin un solo test nuevo sobre la escritura. Al mismo
tiempo hubo progreso real en otro punto específico del boletín anterior (el
bug del destinatario de `guardia.ts` ya tiene su regresión), así que la nota
se sostiene en 6 por movimiento lateral: lo que se cerró compensa lo que
debería haberse cerrado y no se cerró.

## Tests que no prueban lo que dicen

**`src/lib/agents/prompts.test.ts:8-30`** — las cuatro aserciones de
`'instruye CERRAR en el mismo turno con guardar_liquidacion'` y las cuatro de
`'0.2: incluye las defensas anti-inyección...'` hacen `expect(p).toContain(...)`
sobre el texto ESTÁTICO del prompt (`'mismo turno'`, `'no cierres'`,
`'diferencias no'`, `'seguridad'`, `'datos, nunca instrucciones'`, `'nunca
inventes ni narres los números'`, `'modo administrador'`). Esto prueba que el
prompt CONTIENE ciertas palabras, no que el modelo se comporte como ellas
dicen. Pasaría igual si alguien reescribe la regla con las mismas reglas y
otras palabras (falso rojo en un refactor de redacción sin bug), y pasaría
igual si alguien pega la frase mágica en un lugar irrelevante del prompt sin
que la regla realmente aplique (falso verde). Es el antipatrón "greppear texto
fuente" que `writing-good-tests.md` nombra explícitamente. Las dos aserciones
negativas del segundo test (`not.toContain('extraer_comprobante')`,
`not.toContain('validar_cfdi')`, regresión CR-4) sí protegen algo concreto —
que no se reintroduzca el nombre de una tool que ya no existe— pero conviven
en el mismo archivo con las de arriba, que no.

## Huecos por riesgo

- **La ESCRITURA del dinero sigue sin arnés — el hallazgo #7/#15/#34 del
  boletín anterior no se tocó.** `saveLiquidacion` (`src/lib/cuadra/repo.ts:307`,
  la función que llama a `guardar_liquidacion_tx` y cierra el viaje) y
  `addGasto` (`repo.ts:73`) no aparecen en NINGÚN archivo `*.test.ts` del
  repo — confirmado con `grep` sobre los 39 archivos. Es la única función que
  de verdad mueve dinero a la base de datos, y hoy "el SQL se ve bien" sigue
  siendo la única evidencia.
- **El bucle agéntico que llama a `guardar_liquidacion` casi no tiene prueba
  propia — el hallazgo #16 del boletín anterior tampoco se tocó.**
  `generateWithTools` (`src/lib/llm/openrouter.ts:349-467`) tiene un solo
  archivo de test, `openrouter_fallback_costo.test.ts`, y cubre EXCLUSIVAMENTE
  la atribución de costo por ronda al cambiar de modelo. `LoopGuardError`
  (línea 463, se lanza si el ciclo excede `maxRounds`), `PartialExecutionError`
  (líneas 464-466, envuelve tool calls parciales cuando algo truena a medio
  ciclo) y el dedup intra-ronda/cross-ronda de tools de solo lectura (líneas
  433-460, `inRound`/`crossRound`) no se disparan en ningún test. Si alguien
  agrega una 4ª tool o toca esa función, un doble `guardar_liquidacion` no lo
  agarra `npm test` — literalmente la advertencia que ya hacía el boletín
  anterior, todavía cierta.
- **`sat.ts` sigue sin ni un test — hallazgo #13 del boletín anterior, sin
  tocar.** `src/lib/cuadra/intake/sat.ts` decide fraude (lista 69-B),
  cancelado, y alimenta `totalNoDeducible` con parseo por regex sobre la
  respuesta del SAT. Cero referencias en los archivos de test (confirmado con
  `grep`). Un typo en el regex de `Estado>` rompe la detección de fraude en
  silencio, igual que hace un año.
- **`claimMessage`/`releaseMessageClaim` (`src/lib/cuadra/conv.ts:84,241`)
  — capa de idempotencia de mensajes, sin test directo.** Solo
  `acquireViajeLock` (el mutex del viaje) tiene arnés propio
  (`conv_lock.test.ts`); el claim que evita reprocesar el mismo mensaje de
  WhatsApp dos veces no aparece en ningún test.
- **Frontend: cero tests `.tsx` en todo el repo** (confirmado con `find`).
  Ningún componente de `src/app/dashboard/` tiene arnés automatizado —
  la única red hoy es el lint, que no cubre lógica de datos ni mapeos.

## Lo que está bien probado

- **El motor de cuadre sigue siendo la base sólida de la nota.**
  `src/lib/cuadra/cuadre/engine.test.ts` (878 líneas, 73 casos) cubre el
  cálculo puro con casos anclados a bugs reales.
- **El bug del destinatario de la guardia (hallazgo #1, el más caro del
  boletín anterior) YA ESTÁ CORREGIDO Y PROBADO.**
  `src/lib/cuadra/cuadre/guardia.test.ts:87-103` — verificado leyendo el
  código: `guardia.ts` ahora pasa `'operador'` como tercer argumento a
  `resumenCuadre`, y el test afirma sobre el TEXTO de la respuesta
  (`not.toMatch(/69-B/)`, `not.toMatch(/no sustituye|dictamen/i)`) — si alguien
  vuelve a omitir el tercer argumento, el resumen vuelve a incluir los
  veredictos fiscales completos y el test truena. Es una prueba honesta.
- **`src/lib/cuadra/cuadre/injeccion.test.ts`** — 12 casos adversarios/legítimos
  contra el backstop determinístico (`guardiaCifras`), con aserciones sobre el
  texto real de salida (`g.reply).not.toBe(reply)`, `g.reply).toContain('Este
  es el cuadre')`) — protege contra inyección de cifras narradas por el LLM.
- **`src/lib/cuadra/conv_lock.test.ts`** — el mutex del viaje: verificado que
  la rama "error transitorio: reintenta" y la rama "RPC ausente: abre de
  inmediato" están separadas correctamente (líneas 47-70) y que un reintento
  agotado sí abre pero solo tras la ventana, no al primer tropiezo. Mutación
  mental: si se colapsan ambas ramas en un solo `catch` que siempre abre, el
  test "transitorio que no cede" seguiría pasando pero "ocupado todo el
  tiempo: devuelve false" fallaría — cubierto.
- **`src/lib/cuadra/repo_enriquecer.test.ts`** — el merge-patch de
  `enriquecerGastoConCodigo` (evita el lost-update de escrituras concurrentes
  de OCR): la aserción `p_extra).not.toHaveProperty('montoDiscrepante')`
  fallaría de inmediato si alguien vuelve a mandar `gasto.ocrExtra` completo en
  vez del parche.
- **`src/lib/cuadra/liquidacion/pdf.test.ts`** — mejora real frente al boletín
  anterior, que solo conocía el arnés manual `pruebas-manuales/pdf.prueba.ts`
  (aserción única `bytes.length > 1000`, "arnés de mirar"). Este archivo SÍ
  corre en `npm test` y, aunque sus aserciones también son
  `byteLength > 1000`, verifiqué en el código (`pdf.ts:81-98`, comentario en
  línea 89) que el bug que dice proteger —el saneador WinAnsi dejando pasar
  bytes de control— hacía que `drawText` TRONARA ("WinAnsi cannot encode"); si
  se revierte el saneador, la llamada async no completa y el test falla por
  excepción no capturada, no solo por el valor del assert. Sigue sin verificar
  contenido/paginación del PDF (eso permanece en huecos — ver hallazgo #34 del
  boletín anterior, no evaluado aquí por no ser parte del camino de dinero
  crítico para el demo).
- **`src/lib/llm/openrouter_fallback_costo.test.ts`** — verificado: si se
  revierte a "precificar todo al final con el modelo activo", el caso mixto
  (ronda 1 en primario, ronda 2 en fallback) cobraría las 250+50 tokens al
  precio del fallback en vez de partirlo por ronda, y la aserción
  `r.cost).toBeCloseTo(calcCost(PRIM,100,20) + calcCost(FALL,150,30))` fallaría.
