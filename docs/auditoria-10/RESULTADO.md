LIGERA: frontend, cumplimiento fiscal, tool calling

Global 7.7 → 7.3 (▼0.4). Los 3 rubros rotados bajaron los tres, todos por
"mirada más profunda": el código no cambió (cero commits desde la ronda 9), la
nota anterior estaba inflada. Los otros 9 conservan nota, marcados
`no auditado esta ronda`.

27 hallazgos verificados, 0 falsos: 1 CRÍTICO · 3 ALTOS · 14 MEDIOS · 9 BAJOS.
Cerrados con arreglo, prueba que los reproduce y verificación por mutación: el
crítico (FE-1, `5365ca0`) y los dos altos fiscales (FISCAL-1 `65b90eb`,
FISCAL-2 `0d1fe65`+`de4b945`). Queda pendiente FE-2 (ALTO, verificado, sin
arreglar): se agotaron las 3 vueltas de arreglo del tope.

Compuerta verde sobre el árbol final: vitest 166 archivos / 1583 pruebas / 1
saltada / exit 0 · tsc exit 0 · lint exit 0. Sin `npm run build` (nube).

REQUIERE DECISIÓN HUMANA: el PR #6 (`claude/auditoria-8`) sigue abierto, 67
commits atrás de master, y lleva 3 arreglos con prueba que nunca aterrizaron
(`processor_entrega_rechazada.test.ts`, `processor_xml_ambiguo.test.ts`,
`pdf_un_solo_nombre.test.ts` — ninguno existe en el árbol de hoy). No se
continuó sobre esa rama porque su diff borraría las migraciones 0037-0043 y ~10
archivos de prueba que sí están en master.
