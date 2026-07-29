LIGERA: sistema agéntico (3→3) · arquitectura (4→5) · pruebas (4→5)

Global 5.3 → 5.5 (▲0.2). Los dos rubros que subieron NO subieron porque el
código mejorara esta madrugada: HEAD era exactamente el commit que cerró la
ronda 6 y no había ni un commit en src/, supabase/ ni normas/ posterior a él.
Subieron porque esta es la primera ronda que mide los arreglos de la ronda 6 —
sus auditores escribieron los reportes antes de que esos arreglos aterrizaran.

Rotación: ningún rubro cumplía "sin auditar en las últimas 3 rondas" (las rondas
5 y 6 calificaron los doce), así que se aplicó la convención que dejó escrita la
ronda 4 —nota más baja— desempatando con el encargo que la ronda 6 dejó por
escrito para la 7.

6 críticos, 5 altos, 6 medios y 2 bajos, verificados uno por uno abriendo el
archivo. Arreglados 3 críticos con prueba que los reproduce, verificada roja
antes y verde después (tope de 3 vueltas alcanzado): 2c73e8e (AG-1), 3fb1e81
(PR-3), 40b886c (PR-2). 3 críticos PENDIENTES y 5 altos PROPUESTOS, todos con
razón escrita. Ningún hallazgo resultó falso esta ronda.

El hallazgo de la ronda: tres pruebas que dicen proteger el dinero no protegen
nada. Una corría una COPIA de la función y no la función — verificado rompiendo
analytics.ts y viendo las 7 pruebas seguir verdes. Mutantes que sobreviven en la
escritura de la liquidación, nunca medida en seis rondas: 6 de 6. En las pruebas
escritas por la ronda 6: 19%, contra el 83% de esa ronda.

Se corrigió una métrica mal etiquetada durante tres rondas: los "accesos fuera
de repo.ts" que se venían citando (43/49/55) eran el TOTAL bajo src/. Reproducido
hoy: 55 total, 38 fuera, 17 dentro. La serie honesta de fuera es 33 → 38 → 38.

Dos calificaciones propuestas por los auditores se discutieron con evidencia:
arquitectura pedía 5 y se aceptó tras verificar que sus dos críticos están
cerrados por mecanismo (CONCEPTO_LABEL borrado de pdf.ts, con prueba que impide
su regreso); pruebas pedía subir por una razón que no es una de las tres formas,
y el 5 se sostuvo por otra razón (se atacó y subió).

INFRA: el primer auditor de arquitectura murió sin entregar (transcripción
detenida a las 11:10, archivo nunca escrito). Se relanzó con alcance más ajustado
y entregó a las 11:46. No es un rubro sin hallazgos.

Compuerta sobre el árbol final: npm test 1119 passed (antes 1115), 1 saltada,
112 archivos, exit 0; tsc --noEmit exit 0; eslint exit 0. build no se corre en
la nube.

Tablero renderizado y mirado: tablero.png (12 rubros, notas cuadran con la
síntesis, 66/12 = 5.5, 11 hallazgos críticos+altos en la tabla).

PR: https://github.com/javiercamarapp/cuadra/pull/5
