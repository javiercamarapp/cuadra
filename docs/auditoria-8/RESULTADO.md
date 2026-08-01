PARCIAL: 11 de 12 rubros auditados — falta `pruebas.md` (su auditor seguía vivo
y escribiendo al cerrar la ronda, sin producir el archivo: INFRA, no un rubro
limpio; la nota de pruebas no se mueve).

Global 5.5 → 5.6 (▲0.1). Ronda COMPLETA por regla: sin PR de auditoría abierto y
con 34 commits en src/, supabase/ y normas/ desde `abdc98d`.

La décima esconde el mayor reacomodo de toda la serie: nueve de doce notas se
movieron, contra dos en la ronda 7. Cuatro suben, cinco bajan.

Las tres subidas grandes miden trabajo humano que ya estaba hecho en los 34
commits (operabilidad ▲3 por Sentry cableado de verdad, frontend ▲2 por
formato.ts como único origen, legal ▲2 por el aviso integral y la separación
reserva/constancia). Las dos bajadas grandes NO miden código que empeorara:
miden notas infladas. Backend 6→4 porque el brazo de DOCUMENTO de processInbound
no lo había abierto ninguna ronda y no tenía UNA prueba; rendimiento 7→4 porque
la ronda 6 sumó el peor caso usando el costo promedio, y la suma honesta da
126.1 s contra maxDuration = 120.

El hallazgo de la ronda: el mismo dinero se escribe dos veces por dos caminos
distintos del brazo del XML. El XML que no sabe a cuál de dos tickets pegarse
daba de alta un gasto nuevo — dos casetas de $500 el mismo día producían cuatro
gastos, $2,000 comprobados sobre $1,000 gastados, y estatus `cuadrada`.

Arreglados 3 con prueba que los reproduce, verificada roja antes y verde después
(tope de 3 vueltas alcanzado): 9edae2d (ARQ-1, dos nombres de producto en la
misma hoja del PDF), e447f70 (BE-1, el XML ambiguo), 8b621ea (AG-1, el PDF que
Meta rechaza y contaba como entregado).

6 críticos PENDIENTES con razón escrita: BE-2 y LEG-1 porque el arreglo pide una
decisión de diseño y no cabe en una vuelta quirúrgica; LEG-2, REND-1, REND-2 y
DAT-1 por tope de vueltas.

Ningún hallazgo resultó falso, con matiz: verifiqué abriendo el archivo los que
mueven nota o entran a arreglo, no los 60. Los medios y bajos entran con la
firma de su auditor, no con la mía.

Casi commiteo una prueba que pasaba en vacío: la primera versión de la de ARQ-1
buscó la marca en los bytes crudos del PDF y pasó EN VERDE con el bug puesto,
porque pdf-lib deflata los flujos. Corregida a inflar + decodificar hex, y con
una guarda del propio arnés. Queda escrito en el encabezado de la prueba.

Compuerta sobre el árbol final: npm test 1271 passed (base 1262), 1 saltada,
130 archivos, exit 0; tsc --noEmit exit 0; eslint exit 0. build no se corre en
la nube.

Tablero renderizado y mirado: tablero.png (12 rubros contados en la imagen,
67/12 = 5.6 cuadra con la síntesis, color por nota y no por delta).

INFRA: el clon vino sin node_modules por segunda ronda seguida (npm ci antes de
la línea base). `gh` no existe en este entorno; el listado de PR se hizo con el
MCP de GitHub.

PR: pendiente de verificar con gh pr list — se escribe abajo con la salida real.
