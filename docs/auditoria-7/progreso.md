# Progreso — ronda 7

Una línea por acción, escrita **mientras** avanza.

| # | Acción | Resultado |
|---|---|---|
| 1 | `git status` al arrancar | árbol limpio (HEAD separado en `abdc98d`) → autofix HABILITADO |
| 2 | PRs de auditoría abiertos (`list_pull_requests`, state=open) | `[]` — ninguno. No hay ronda de continuación. |
| 3 | `git log abdc98d..HEAD -- src/ supabase/ normas/` | vacío. Cero commits de código desde el cierre de la ronda 6 → **RONDA LIGERA** |
| 4 | `npm ci` | exit 0 (el clon venía sin `node_modules`; `vitest: not found` en el primer intento) |
| 5 | Compuerta base: `npm test` | 1115 pruebas, 1 saltada, 112 archivos — exit 0 |
| 6 | Compuerta base: `npx tsc --noEmit` | exit 0 |
| 7 | Compuerta base: `npm run lint` | exit 0 |
| 8 | Rama `claude/auditoria-7` creada desde `abdc98d` | ok |
| 9 | `docs/auditoria-7/MAPA.md` escrito | ok |
| 10 | 3 auditores lanzados en paralelo (agéntico · arquitectura · pruebas) | ver abajo |
| 11 | Checkpoint: `MAPA.md` + `progreso.md` commiteados y pusheados (`df99105`) | push OK → la infra de push está probada, no es una sorpresa del final |
| 12 | Auditor **agéntico** entrega | 3 CRÍTICOS · 3 ALTOS · 1 MEDIO. Nota 3/10 (sin movimiento) |

## Verificación adversarial — agéntico

Toda la verificación se hizo contra el **blob commiteado** (`git show abdc98d:…`),
no contra el árbol de trabajo: el auditor de pruebas muta archivos a propósito
para medir mutantes, y leer el árbol durante esa ventana daría una lectura falsa.

| Hallazgo | Veredicto | Evidencia con la que lo confirmé |
|---|---|---|
| CRÍT-1 · "Listo, cuadré tu viaje" en un turno que no cerró | **CONFIRMADO** | `guardia.ts:37-39` hace `cuadro` verdadero con solo `cuadrar_viaje`; `:79` pasa ese `cuadro` al parámetro que `resumen.ts:41` llama `cerrado` y que `:50` usa para elegir encabezado. El comentario de `resumen.ts:48-49` declara el contrato que el código viola. Fijado por `guardia.test.ts:48-52`, cuyo comentario dice *"afirma cierre porque sí cuadró"* |
| CRÍT-2 · toda cita normativa se borra a media frase | **CONFIRMADO, reproducido** | `git grep norma_id` → el único emisor es `tools.ts:88`, dentro de `cuadrar_viaje`. `processor.ts:719` condiciona `guardiaFundamento` a `!textoDeterminista`. Ejecuté el módulo real: `"…conforme al LIF 2026 Art. 20-A."` → `"…conforme al -A."`, con `quitadas: ["lif-2026-art-20-A"]` — es decir, **borra una norma legítima** |
| CRÍT-3 · texto y PDF de dos fotografías distintas de la base | **CONFIRMADO** | `tools.ts:113-143` calcula y genera los dos PDF en T1; `guardia.ts:71` vuelve a llamar `cuadrarDesdeDB` en T2. `processor.ts:305-308` documenta que las fotos NO toman el mutex, y `repo.ts:141-180` (`addGasto`) es un `insert` pelado que **no mira el estatus del viaje** |
| ALTO-1 · `ctxCerro` sin actualizar en recuperación de cierre parcial | **CONFIRMADO** (ver abajo) | |
| ALTO-3 · `+1` de la barrera sin proteger, `-1` incondicional | **CONFIRMADO** | `processor.ts:314` descarta el valor de `intakeDelta(viajeId, 1)`; `:461` decrementa en un `finally` "pase lo que pase" |

## Verificación adversarial — pruebas

El auditor midió **34 mutaciones** sobre copia fuera del árbol y lo devolvió
limpio (verificado: `git status --short` sin nada en `src/`). Números que trae:
**4 de 18 sobrevivientes** en las pruebas de la ronda 6 (19% descontando dos
equivalentes) contra el 83% de la ronda 6 — el arnés nuevo sí funciona — pero
**6 de 6 sobreviven** en la ESCRITURA de la liquidación, nunca medida en seis
rondas.

| Hallazgo | Veredicto | Evidencia con la que lo confirmé |
|---|---|---|
| CRÍT-1 · el mock ignora `.limit()`, el arreglo del multi-tenant se puede revertir en verde | **CONFIRMADO** | `conv_directo.test.ts:32` mete `limit` en la lista de métodos que devuelven el mismo enlace, y `:34` delega en el fixture `limit()` sin mirar el argumento. Cambiar `conv.ts:73` de `.limit(2)` a `.limit(1)` —que es exactamente el bug de "devuelve una fila arbitraria y decide el tenant con ella"— es invisible para la prueba |
| CRÍT-2 · la escritura de la liquidación verifica 8 de 12 parámetros | **CONFIRMADO** | `repo.ts:397-410` manda 12 parámetros; `repo_escritura.test.ts:106-110` usa `toMatchObject` con 8. Quedan sin mirar `p_diferencias`, `p_ieps`, `p_litros_diesel` y `p_pdf_url` — el IEPS y los litros de diésel son justo las cifras fiscales que el producto vende |
| CRÍT-3 · la prueba corre una COPIA de la función, no la de producción | **CONFIRMADO** | `derivoLaConfig` (`analytics.ts:385`) no se exporta y `git grep` confirma que la prueba no la importa: `analytics_deriva.test.ts:61-66` la reimplementa. La copia además **no es fiel** — le falta el `if (!Array.isArray(persistidas)) return false` de `analytics.ts:386`. El arreglo del CRÍTICO de frontend de la ronda 6 quedó sin anclar |



## Cierre

| # | Acción | Resultado |
|---|---|---|
| 13 | Arreglo **AG-1** (`guardia.ts`): `cerro` separado de `cuadro` | prueba roja antes / verde después · `2c73e8e` |
| 14 | Arreglo **PR-3** (`analytics_deriva.test.ts`): importa la función real | con mutante: 7 passed → 2 failed · `3fb1e81` |
| 15 | Arreglo **PR-2** (`repo_escritura.test.ts`): los 12 parámetros | con mutante: 10 passed → 1 failed · `40b886c` |
| 16 | **Tope de 3 vueltas alcanzado.** Se deja de arreglar | 3 críticos pendientes + 5 altos propuestos |
| 17 | Auditor de **arquitectura** (relanzado) entrega | 0 críticos · 0 altos · 3 medios · 2 bajos. Nota 5/10 |
| 18 | Verificación de arquitectura: `CONCEPTO_LABEL` borrado + prueba que lo prohíbe | **CONFIRMADO** → se acepta el 5 |
| 19 | Métrica reproducida por el orquestador | 55 total · **38 fuera de `repo.ts`** · 17 dentro. Las rondas 4–6 citaban el total mal etiquetado |
| 20 | `tablero.html` + `tablero.png` renderizado y **mirado** | 12 rubros, 66/12 = 5.5, 11 hallazgos crít+altos. Cuadra con la síntesis |
| 21 | Compuerta final | `npm test` 1119 (1 saltada, 112 archivos) exit 0 · `tsc` exit 0 · `eslint` exit 0 |

**INFRA de la corrida:** el primer auditor de arquitectura murió sin entregar
(transcripción detenida 11:10, archivo nunca escrito); relanzado, entregó 11:46.
El clon venía sin `node_modules`. Ninguna de las dos es un hallazgo de rubro.
