COMPLETA (continuación del 3-ago sobre el PR #7, que seguía abierto)

Global 7.3 → 4.9 (▼2.4). Los 12 rubros auditados con contexto fresco sobre un
árbol con 5,743 líneas nuevas que nadie había mirado: auth real por sesión de
Supabase con 5 roles, RLS del chofer y la consola /admin. Once bajaron, uno
subió (frontend, 5 → 6, se atacó y subió).

108 hallazgos verificados, 0 falsos: 13 CRÍTICOS · 30 ALTOS · 38 MEDIOS · 27
BAJOS. Consolidados por causa raíz son 10 críticos distintos.

Cerrados con arreglo, prueba que los reproduce y verificación en rojo antes:
- d081176 · el chofer con cuenta entraba a /dashboard y veía la flota entera
- 8fb74d4 · las dos rutas de export autenticaban pero no autorizaban
- d08db8a · el RFC del tenant de demo reprobaba nuestro propio validador y
  apagaba TODAS las cifras fiscales del PDF del 6-ago

Quedan 7 críticos PROPUESTOS, todos verificados contra el código: se agotó el
tope de 3 vueltas de arreglo. Dos de ellos (RLS parcial de la 0045, y que nada
sonde que la 0045 esté aplicada) no son reproducibles sin base de datos y no se
tocaron a ciegas a propósito.

Compuerta verde sobre el árbol final: vitest 175 archivos / 1638 pruebas / 1
saltada / exit 0 · tsc exit 0 · lint exit 0. Sin `npm run build` (nube).
Tablero capturado y mirado.

REQUIERE DECISIÓN HUMANA: el crítico #4 (un «listo» con la sala de espera llena
cierra la liquidación en $0 y manda los comprobantes al viaje siguiente) es el
primer candidato de la ronda 11. Y el PR #6 (claude/auditoria-8) sigue abierto
desde el 1-ago, cada día más lejos de master.
