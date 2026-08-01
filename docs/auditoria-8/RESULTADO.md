COMPLETA

Global 5.5 → 5.7 (▲0.2). Los doce rubros auditados, los doce entregaron. Ronda
COMPLETA por regla: sin PR de auditoría abierto y con 34 commits en src/,
supabase/ y normas/ desde `abdc98d`.

Las dos décimas esconden el mayor reacomodo de toda la serie: diez de doce notas
se movieron, contra dos en la ronda 7. Cinco suben, cinco bajan.

Las subidas grandes miden trabajo humano que ya estaba hecho en los 34 commits
(operabilidad ▲3 por Sentry cableado de verdad, frontend ▲2 por formato.ts como
único origen, legal ▲2 por el aviso integral y la separación reserva/constancia,
agéntico ▲2 por AG-3 cerrado). Las dos bajadas grandes NO miden código que
empeorara: miden notas infladas. Backend 6→4 porque el brazo de DOCUMENTO de
processInbound no lo había abierto ninguna ronda y no tenía UNA prueba;
rendimiento 7→4 porque la ronda 6 sumó el peor caso usando el costo promedio, y
la suma honesta da 126.1 s contra maxDuration = 120.

El hallazgo de la ronda: el mismo dinero se escribe dos veces por dos caminos
distintos del brazo del XML. El XML que no sabe a cuál de dos tickets pegarse
daba de alta un gasto nuevo — dos casetas de $500 el mismo día producían cuatro
gastos, $2,000 comprobados sobre $1,000 gastados, y estatus `cuadrada`.

El número que la ronda 7 pidió: mutantes que sobreviven 8 de 36 = 22%, con el
denominador el doble de grande. Serie 57% (r5) → 83% (r6) → 19% (r7) → 22% (r8).
La escritura del dinero pasó de 6/6 sobrevivientes a 0/4. PR-1 cerrado,
verificado con el mutante real.

Arreglados 3 con prueba que los reproduce, verificada roja antes y verde después
(tope de 3 vueltas alcanzado): 9edae2d (ARQ-1, dos nombres de producto en la
misma hoja del PDF), e447f70 (BE-1, el XML ambiguo), 8b621ea (AG-1, el PDF que
Meta rechaza y contaba como entregado).

9 críticos PENDIENTES con razón escrita: BE-2 y LEG-1 porque el arreglo pide una
decisión de diseño y no cabe en una vuelta quirúrgica; LEG-2, REND-1, REND-2,
DAT-1 y los 3 de pruebas por tope de vueltas.

Ningún hallazgo resultó falso, con matiz: verifiqué abriendo el archivo los que
mueven nota o entran a arreglo (nueve), no los 74. Los medios y bajos entran con
la firma de su auditor, no con la mía.

DOS ERRORES MÍOS, escritos porque son lo más útil de esta ronda:

1. Casi commiteo una prueba que pasaba en vacío. La primera versión de la de
   ARQ-1 buscó la marca en los bytes crudos del PDF y pasó EN VERDE con el bug
   puesto, porque pdf-lib deflata los flujos. Corregida a inflar + decodificar
   hex, con una guarda del propio arnés.

2. Di por muerto al auditor de pruebas y cerré la ronda como PARCIAL marcándolo
   INFRA. Era falso: estaba lento, no caído —corre suites enteras para medir
   mutantes— y entregó a los 35 minutos con tres críticos. La síntesis, este
   archivo, el tablero y el cuerpo del PR se corrigieron, y la global pasó de
   5.6 a 5.7. Es el error que desatendido.md advierte, cometido en la dirección
   contraria: declarar INFRA lo que solo era lento.

Compuerta sobre el árbol final: npm test 1271 passed (base 1262), 1 saltada,
130 archivos, exit 0; tsc --noEmit exit 0; eslint exit 0. build no se corre en
la nube.

Tablero renderizado y mirado dos veces: tablero.png (12 rubros contados en la
imagen, 68/12 = 5.7 cuadra con la síntesis, color por nota y no por delta).

INFRA de verdad: el clon vino sin node_modules por segunda ronda seguida (npm ci
antes de la línea base). `gh` no existe en este entorno; el listado de PR se hizo
con el MCP de GitHub. El CI del PR no se pudo consultar: get_check_runs devolvió
0 y get_status un 403.

PR: https://github.com/javiercamarapp/likida.ai/pull/6 (draft, abierto).
Verificado con list_pull_requests, no de memoria. OJO: el repo se renombró de
`cuadra` a `likida.ai` en GitHub; el remoto sigue respondiendo por el nombre
viejo.
