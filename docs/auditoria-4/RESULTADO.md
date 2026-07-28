LIGERA: sistema agéntico (4→3) · arquitectura (5→4) · tool calling (6→5)

Global 6.2 → 5.9 (▼0.3). Los tres rubros auditados bajaron; ninguno porque el
código empeorara. Rotación elegida por nota más baja + profundidad dedicada
recibida, porque la ronda 3 calificó los 12 y ninguno cumplía "sin auditar en 3
rondas".

3 críticos, 12 altos. Arreglados 2 críticos + 1 alto (tope de 3 vueltas usado):
11c9529, 063d426, 5ca0456. 1 crítico PENDIENTE con razón escrita (afirmaciones de
estado: necesita decisión de producto, no un backstop inventado de madrugada).
3 hallazgos descartados tras verificar, uno de ellos falso.

Compuerta sobre el árbol final: npm test 517 passed (antes 501), tsc exit 0,
lint exit 0. build no se corre en la nube.

PR: https://github.com/javiercamarapp/cuadra/pull/3
