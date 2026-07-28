# Progreso — auditoría 4

Una línea por acción, escrita MIENTRAS avanza. Si esta corrida muere a medias,
esto es lo único que dice dónde se quedó.

## Contexto de la corrida

- Fecha: 28-jul-2026. Modo: **desatendido, en la nube** (routine de Claude).
- Rama: `claude/auditoria-4`, creada desde `master` en `de49468`.
- Árbol limpio al arrancar (`git status --porcelain` sin salida) → **autofix HABILITADO**.

## Decisión de tamaño de ronda (PASO 1, antes de gastar tokens en auditores)

- `list_pull_requests state=open` → `[]`. **No hay PR de auditoría abierto.**
- `git log --oneline 2f7f066..HEAD -- src/ supabase/ normas/` → **vacío**. Cero
  commits de código desde la síntesis de la ronda 3.
- → **RONDA LIGERA.** 3 rubros por rotación, los otros 9 conservan nota.

Rubros elegidos y por qué. La regla pide "los tres de nota más baja que no se
hayan auditado en las últimas 3 rondas"; como la ronda 3 calificó los 12,
**ningún rubro califica literalmente** y el desempate va por nota más baja y por
profundidad dedicada recibida:

| Rubro | Nota | Por qué entra |
|---|:--:|---|
| Sistema agéntico y orquestación | 4 | La más baja del tablero |
| Arquitectura y mantenibilidad | 5 | Segunda más baja |
| Tool calling | 6 | Empatado con otros cuatro 6s; entra porque **nunca tuvo auditor dedicado** — compartió agente con otros dos rubros en las rondas 2 y 3, y su sección de la ronda 3 son 29 líneas |

**Lo que hace que esta ronda ligera no sea un no-op:** la síntesis de la ronda 3
(líneas 38-47) dice que sus notas califican el código PRE-arreglo y que los 11
arreglos "se medirán en la ronda 4, con auditores frescos". Esos arreglos viven
en `52adedb` y `59bc958`, y caen justo sobre los tres rubros rotados:
`fundamento.ts`/`processor.ts` → agéntico · `engine.ts`/`dashboard/page.tsx` →
arquitectura · `openrouter.ts` → tool calling.

## Bitácora

| # | Acción | Resultado | sha |
|---|---|---|---|
| 1 | `git status --porcelain` | limpio, autofix ON | — |
| 2 | `list_pull_requests state=open` | `[]` | — |
| 3 | `git log 2f7f066..HEAD -- src/ supabase/ normas/` | vacío → ronda ligera | — |
| 4 | `git checkout -b claude/auditoria-4` | ok, desde `de49468` | — |
| 5 | `npm ci` | exit 0 (no había `node_modules` en el contenedor) | — |
| 6 | `npm test` | **501 passed / 50 archivos**, 11.70s | — |
| 7 | `npx tsc --noEmit` | **exit 0** | — |
| 8 | `npm run lint` | **exit 0** | — |
| 9 | Escrito `MAPA.md` de la ronda 4 | — | — |
| 10 | Lanzados 3 auditores en paralelo, contexto fresco | agéntico · arquitectura · tool calling | — |
| 11 | Vuelve **arquitectura**: 4/10 (antes 5). 0 críticos, 2 altos, 1 medio, 1 bajo | verificado abajo | — |

### Verificación adversarial — arquitectura

Abrí cada hallazgo contra el código antes de anotarlo. Tres sobreviven, uno se cae.

- **A [ALTO] `pdf.ts` reconstruye la clasificación del motor — CONFIRMADO.**
  `pdf.ts:16-19` (`NO_DEDUCIBLES_PDF`) es copia literal de `engine.ts:496`
  (`NO_DEDUCIBLE_ISR`), sin test de sincronía. `pdf.ts:315` arma `idsPorConfirmar`
  con **un** criterio (`sin_cfdi || combustible_efectivo`) mientras el motor usa
  **dos** (`POR_CONFIRMAR` en `engine.ts:497` *más* `if (!g.cfdiUuid)` en
  `engine.ts:512`). Y `DEMO_CONFIG.politica` (`config.ts:66-73`) solo pone
  `requiereCfdi: true` en `factura` — verificado leyendo el literal. Así que con la
  config del demo, un hospedaje sin timbrar cae en `porConfirmar` para el motor y
  en ningún lado para el PDF. La sección "LO QUE SE LE REEMBOLSA AL OPERADOR" no se
  activa. Es exactamente la contradicción que `engine.ts:486-495` documenta haber
  eliminado del lado fiscal, resucitada en el PDF.

- **B [ALTO] El dato que sustituyó al IEPS llegó a 2 de 4 consumidores — CONFIRMADO,
  y es MÁS fuerte de lo que reportó el auditor.** `engine.ts:408` fija
  `const iepsAcreditable = 0`. Verifiqué el único camino que podría revivirlo:
  `desde_db.ts:5,21` **recalcula con `cuadrarViaje`**, no lee la columna — así que
  no existe ninguna ruta en la que `liq.iepsAcreditable > 0`. La rama de
  `resumen.ts:73` es código muerto sin excepción, no solo "para liquidaciones
  nuevas". Y `analytics.ts:136` pide `ieps_acreditable` sin pedir
  `litros_diesel_acreditables`, así que `dashboard/[id]/page.tsx:35,73` (que solo
  conoce `d.ieps`) no puede mostrar litros ni aunque quisiera.

- **C [MEDIO] "El descargo legal no sale por el canal principal" — DESCARTADO por
  falso en su parte sustantiva.** El auditor concluye que la mitigación del Anexo 3
  RMF / arts. 89-90 CFF "no sale por el canal principal". No es cierto:
  `LEYENDA_CORTA` **sí se renderiza**, en las dos pantallas del panel —
  `dashboard/page.tsx:6,197` y `dashboard/[id]/page.tsx:3,113`. `leyendas.ts:19`
  dice "Para WhatsApp y el dashboard" y la mitad del dashboard está cableada y
  llega justo a quien va dirigido el descargo: el contralor. El mensaje de WhatsApp
  va al **operador**, y `resumen.ts:76-80` explica por escrito por qué a él no se le
  manda. El auditor leyó una rama muerta y le atribuyó una consecuencia legal que
  el código no tiene.
  **Lo que SÍ sobrevive, degradado a [BAJO]:** la rama `destinatario === 'contralor'`
  de `resumen.ts:81` no tiene llamador de producción (verificado: `processor.ts:487`,
  `processor.ts:555` y `guardia.ts:79` pasan los tres `'operador'`), así que cinco
  asserts —`resumen.test.ts:52,73,99,129` y `liquidacion_completa.test.ts:134`—
  validan una forma de llamada que el producto nunca produce. Es deuda de prueba,
  no exposición legal. `LEYENDA_INLINE` (`leyendas.ts:25`) sí tiene cero consumidores.

- **D [BAJO] `catalogoCuentas` sin consumidor — CONFIRMADO en sustancia, con una
  imprecisión.** El auditor dice que grep devuelve "solo la declaración y el literal";
  en realidad hay cuatro referencias en `config_merge.test.ts:22,55,56,67`. Pero el
  fondo se sostiene: cero consumidores de **producción**, y `export.ts:42-51`
  (`toLiquidacionRows`) no tiene columna de cuenta contable — verificado leyendo las
  ocho columnas que sí emite.

| 12 | Vuelve **agéntico**: 3/10 (antes 4). 3 críticos, 5 altos, 2 medios | verificado con `npx tsx` sobre el módulo real | — |
| 13 | Vuelve **tool calling**: 5/10 (antes 6). 4 altos, 3 medios, 2 bajos | mirada más profunda | — |
| 14 | Verificados los 3 críticos ejecutando `guardiaFundamento` real | los 3 CONFIRMADOS | — |
| 15 | **Vuelta 1/3** — prueba que reproduce el crítico 2 (instrumento equivocado) | 6 fallan, 2 de regresión pasan | — |
| 16 | Arreglo `patronesDe`: `FIN_DE_NUMERO` + veto de ley ajena | 26/26 · suite 509 · tsc 0 · lint 0 | `11c9529` |
| 17 | **Vuelta 2/3** — prueba que reproduce el crítico 1 (reincidente) | 4 fallan, 2 de falsos positivos pasan | — |
| 18 | Arreglo `FORMA_DE_CITA` ensanchado (3 de las 4 formas) | 32/32 · suite 515 · tsc 0 · lint 0 | `063d426` |
| 19 | **Vuelta 3/3** — prueba que reproduce la regresión de caché | 1 ejecución en vez de 2 | — |
| 20 | Arreglo `crossRound.set` solo con `exec.success` | 2/2 · suite 517 · tsc 0 · lint 0 | `5ca0456` |
| 21 | Tope de 3 vueltas alcanzado. Crítico 3 queda PENDIENTE con razón | necesita decisión de producto | — |
| 22 | `tablero.html` + captura headless, y **mirado**: 12 rubros, 71/12 = 5.9 | coincide con la síntesis | — |
| 23 | `00-SINTESIS.md` y `RESULTADO.md` escritos | — | — |
