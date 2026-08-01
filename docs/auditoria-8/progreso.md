# Diario de la ronda 8

Una línea por acción, escrita **mientras** avanza. Si la ronda muere a la mitad,
esto es lo único que sabe dónde se quedó.

| # | Acción | Resultado |
|---|---|---|
| 1 | `gh pr list --state open` (vía MCP de GitHub; **no hay `gh` CLI en este entorno**) | `[]` — sin PR de auditoría abierto |
| 2 | `git log --oneline abdc98d..HEAD -- src/ supabase/ normas/` | **34 commits** → **RONDA COMPLETA**, 12 auditores |
| 3 | `git checkout -b claude/auditoria-8` | rama creada; `git status --short` vacío → **árbol limpio, autofix HABILITADO** |
| 4 | Primer intento de compuerta | `vitest: not found` — el clon vino **sin `node_modules`**. `INFRA`, no un fallo del código. |
| 5 | `npm ci` | ok |
| 6 | Compuerta base: `npm test` | **1262 passed, 1 skipped, 127 archivos, exit 0** (ronda 7 cerró en 1119 / 112) |
| 7 | Compuerta base: `npx tsc --noEmit` | exit 0 |
| 8 | Compuerta base: `npm run lint` | exit 0 |
| 9 | `docs/auditoria-8/MAPA.md` | escrito con el delta de las 34 commits |
| 10 | 12 auditores lanzados en un solo mensaje | en paralelo, contexto fresco, uno por rubro |
| 11 | **frontend.md** entregado | 6/10 (antes 4) · 0 críticos, 2 altos, 3 medios, 2 bajos |
| 12 | Verificado FE-ALTO-1 (el `pie` fijo) | **CONFIRMADO**: `deducibilidad.ts:52` es cadena fija; `engine.ts:85` mete `rfc_receptor_no_verificable` en `POR_CONFIRMAR`; `pdf.ts:262` imprime ese mismo pie en el papel |
| 13 | Verificado FE-ALTO-2 (el hero sin estado de cero) | **CONFIRMADO**: `dashboard/page.tsx:134-143` solo tiene la rama `acred === null`; `Acred` (287-305) pinta el número sin distinguir cero de indeterminado |
| 14 | **legal.md** entregado | 6/10 (antes 4) · **2 críticos**, 4 altos, 3 medios, 2 bajos |
| 15 | Verificado LEG-CRÍTICO-2 (la ráfaga rompe «sin aviso no hay tratamiento») | **CONFIRMADO**: `0033:75-88` devuelve `false` por DOS razones —ya consta, u otro reservó hace <5 min— y `processor.ts:169` las colapsa en `return true` con el comentario «Ya se le puso a disposición antes» |
| 16 | Verificado LEG-ALTO (el XML se guarda antes del aviso) | **CONFIRMADO**: `processor.ts:269-275` descarga y persiste el XML dentro del corte «sin viaje abierto», que hace `return` en `:279`; `ponerAvisoADisposicion` está en `:296` y nunca corre en ese camino |
| 17 | **tool_calling.md** entregado | 7/10 (antes 8, ▼ deuda que cobró factura) · 0 críticos, 1 alto, 5 medios, 6 bajos |
| 18 | **backend.md** entregado | 4/10 (antes 6, ▼ mirada más profunda) · **2 críticos**, 3 altos, 2 medios, 2 bajos |
| 19 | Verificado BE-CRÍTICO-1 (el XML ambiguo inventa un gasto) | **CONFIRMADO**: `emparejar.ts:83-90` devuelve `null` a propósito ante ambigüedad; `processor.ts:561-587` lo trata como «es nuevo» y hace `addGasto` SIN `folio`, así que la llave de duplicado de `engine.ts` no lo ve |
| 20 | Verificado BE-CRÍTICO-2 (el XML se pega al viaje abierto) | **CONFIRMADO**: `processor.ts:539` hace `getGastos(viajeId…)` y `:569` `addGasto(…, viajeId, …)` con el viaje abierto de hoy; no hay cotejo de la fecha del CFDI contra el rango del viaje |
| 21 | **fiscal.md** entregado | 5/10 (=) · 0 críticos, 4 altos, 2 medios, 1 bajo |

