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

