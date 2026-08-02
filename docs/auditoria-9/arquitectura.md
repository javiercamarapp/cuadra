# Arquitectura y mantenibilidad — auditoría 9

Ancla: commit `cc2a5761075f67d56c64db5a2f79ea92055d9a37` (HEAD al empezar esta auditoría).

**Nota: 6/10** (antes 6). Razón del movimiento: sin cambio neto — una fuga
real se cerró bien esta ronda (el perímetro de `repo.ts` mejoró en vez de
seguir creciendo, y `fecha_dudosa.ts` es exactamente el mecanismo que evitó
una copia nueva), pero el hallazgo explícito que la síntesis de la ronda 8
dejó anotado —`round2()` en 4 archivos, mismo bug de redondeo en los
cuatro— **sigue exactamente igual, carácter por carácter, tras una ronda
entera en la que se atacaron 14 pendientes distintos y ninguno fue éste**.
Por la regla del rubro, eso pesa más que la mejora y ancla la nota en el
mismo punto.

El riesgo mayor del rubro, hoy: la aritmética de dinero (nómina LFT 110-I,
tope de efectivo RFA 2026 2.9, cubetas fiscales del motor, panel) sigue
redondeándose en cuatro sitios distintos con el mismo defecto, sin una sola
prueba que los junte — dos rondas seguidas.

## Hallazgos

### [ALTO] `round2()` sigue reimplementado en 4 archivos de dinero, con el mismo bug de redondeo en los cuatro — REINCIDENTE, sin tocar en toda la ronda
`src/lib/cuadra/cuadre/engine.ts:954-956` · `src/lib/cuadra/analytics.ts:463-465` · `src/lib/cuadra/laboral/pagadero.ts:107` · `src/lib/cuadra/periodo/combustible.ts:63`

Las cuatro definiciones son, hoy, literalmente el mismo cuerpo:

```ts
// engine.ts:954-956 y analytics.ts:463-465
function round2(n: number): number { return Math.round(n * 100) / 100; }

// pagadero.ts:107 y combustible.ts:63
const round2 = (n: number) => Math.round(n * 100) / 100;
```

`grep -rn "import.*round2" src/` no devuelve nada: cero de las cuatro
importa de las otras tres. No existe `dinero.ts` ni `math.ts` compartido.

**Escenario, con valores — reproducido en Node.js, sobre datos de dominio
reales.** `pagadero.ts:140`, tope de nómina del art. 110-I LFT: un operador
con salario mensual que excede el mínimo por `excedente = $1,000.55` (una
cifra de excedente perfectamente ordinaria):

```
excedente * 0.30        = 300.16499999999996   (representación IEEE-754 de 300.165)
round2(excedente * 0.30) = 300.16               ← lo que el código produce
redondeo correcto        = 300.17               ← lo que el art. 110-I exige (30% exacto)
```

`descuentoPeriodo` sale un centavo por debajo del tope legal, en el string
que arma la nota para el contralor (`pagadero.ts:149`,
`.toFixed(2)`). No es un caso aislado: barrido en Node sobre excedentes de
$1,000 a $20,000 con paso de un centavo, **48,840 valores** de esa franja
disparan la misma desviación (el patrón se repite cada vez que el producto
cae en una frontera `x.xx5` de tercer decimal, ~1 de cada 5 valores
posibles). El mismo defecto, con el mismo cuerpo de función, corre hoy
sobre: el excedente de efectivo que dispara la alerta RFA 2026 2.9
(`combustible.ts:88-89`), las cubetas fiscales del motor —incluida
`litrosDieselAcreditables`, el número que `resumen.ts` le manda al
operador y que también se imprime— (`engine.ts:920-949`), y los
acumulados del panel (`analytics.ts:84-190`).

Consecuencia: el desvío es de un centavo por cifra, así que hoy no rompe
una demo por sí solo. El riesgo real es el que ya describió la ronda 8 y
que se confirma intacto: el día que alguien note el centavo mal —porque se
ve en un PDF, que es donde primero se mira— y lo arregle en la copia que
vio (probablemente `engine.ts`, la más visible), las otras tres se quedan
con el defecto, en silencio, porque ninguna prueba las compara entre sí.
La única prueba que menciona `round2` (`deducibilidad.test.ts:77`) tolera
el centavo de desviación **dentro** de `engine.ts`; no es el guardarraíl
cruzado que sí existe para `mxn()` y para las etiquetas de concepto
(`etiquetas_sincronizadas.test.ts`, verificado esta ronda: sigue pasando y
sigue comparando panel contra motor carácter por carácter).

**Causa raíz probable:** la misma que documentó la ronda 8 —ningún módulo
satélite de `cuadre/` importa de `cuadre/engine.ts` por diseño, para evitar
ciclos, así que cada uno que necesitó redondear a centavos escribió su
propia línea— y nada cambió esta ronda porque los 18 commits del período
se dirigieron a los 14 pendientes de la tabla de arriba (todos verificados
cerrados) y no a este, que la propia síntesis de la ronda 8 marcó
explícitamente como "no se atacó esta ronda".

(REINCIDENTE — 2ª ronda consecutiva sin tocar, ya anotado sin ataque desde
la síntesis de la ronda 8.)

## Lo que revisé y está bien

- **`fecha_dudosa.ts` — el caso de estudio que sí funcionó.** Verificado
  que la lógica de "¿esta fecha es creíble?" y de "ventana del viaje" vive
  en un único módulo (`src/lib/cuadra/cuadre/fecha_dudosa.ts`) y que los
  cuatro consumidores nuevos de esta ronda la importan en vez de
  reimplementarla: `cuadre/engine.ts:12`, `cuadre/desde_db.ts:6`,
  `intake/decidir.ts:12`, `intake/pedir_fecha.ts:22`. `grep -rn` por los
  nombres del dominio (`otro_ejercicio`, `fuera_de_rango`, `ventanaDelViaje`,
  `fechaDudosa`) no encontró ninguna copia paralela fuera de ese archivo y
  sus importadores. Es exactamente el mecanismo que el hallazgo de arriba
  necesita y no tiene: se separó la lógica ANTES de que hubiera una segunda
  copia divergente, con el comentario del propio archivo citando
  `copiasDeComprobante` como el precedente que motivó hacerlo así.
- **`engine.ts` sigue puro.** `grep` por `Date.now`, `new Date()`, `fetch(`,
  `Math.random`, `process.env`, `supabase`, `await` dentro del archivo:
  cero resultados. El motor de dinero no hace I/O.
- **La frontera de `repo.ts` mejoró, no empeoró.** Repetido el criterio
  exacto de la ronda 8 (`.from('`/`.rpc('` con literal, sin `*.test.ts`):
  `repo.ts` pasó de 17 a 26 sitios (absorbió `guardarFotoPendiente`,
  `existeFotoPendiente`, `reclamarFotoPendiente`, `corregirFechaGasto`,
  todos correctamente adentro), y el porcentaje **fuera** de `repo.ts` bajó
  de 70% (40/57) a 62% (42/68) — primera mejora desde que se mide. El
  módulo nuevo de esta ronda que sí toca `supabaseAdmin()` directo
  (`intake/almacen.ts`, storage de fotos) es consistente con el patrón
  satélite ya conocido (`conv.ts`, `analytics.ts`, `startup.ts`,
  `costos.ts`), no lo agrava: es tenant-scoped por ruta, dos funciones,
  bien documentado, y no duplica ninguna verdad que viva en otro sitio.
  También se corrigió la afirmación falsa que la ronda 8 señaló: `MAPA.md`
  ya no dice "TODO el acceso a datos" sobre `repo.ts`, y el comentario del
  propio archivo (línea 1) dice solo "Acceso a datos de Cuadra", sin la
  palabra "todo".
- **Los tres mapas duplicados que se cerraron por mecanismo en rondas
  pasadas (`litros()`, `mxn()`, etiquetas de concepto/estatus) siguen
  cerrados.** Corrí `etiquetas_sincronizadas.test.ts` (7/7) y confirmé que
  sigue comparando `engine.ts` contra `dashboard/[id]/page.tsx` carácter
  por carácter, y las dos páginas del panel (`ESTATUS`) entre sí. El nuevo
  `TipoDiferencia` de esta ronda, `permiso_cre_no_verificable`, está
  cubierto en `NORMA_POR_DIFERENCIA` y hay una prueba de exhaustividad
  (`por_diferencia.test.ts`) que falla si algún `TipoDiferencia` nuevo
  queda sin clasificar en `NORMA_POR_DIFERENCIA` o `SIN_NORMA` — mismo
  mecanismo, aplicado a un mapa distinto.
- **La tabla de 12,625 permisos CRE (`facturacion/permiso_cre.ts`) sigue
  sin un consumidor real**, tal como pedía verificar el `MAPA.md`. Es una
  decisión documentada y deliberada (commit `7301adc`, fiscal: el permiso
  se lee del TICKET impreso, no del XML, y extraerlo del XML sin confirmar
  el atributo exacto del SAT sería peor que no afirmar nada), no un
  descuido de este rubro — lo dejo anotado por transparencia, no como
  hallazgo propio.
- **No encontré funciones puras que hayan empezado a hacer I/O esta
  ronda**, ni una dependencia que apunte "al revés" (p. ej. `cuadre/`
  importando de `intake/` o de `repo.ts` fuera de `desde_db.ts`, que existe
  justo para eso).
- `npx tsc --noEmit` limpio sobre el árbol completo.

## Lo que NO alcancé a revisar

- No corrí la suite completa de `npm test` (cientos de archivos); corrí
  dirigido los tres archivos relevantes a lo que audité
  (`etiquetas_sincronizadas.test.ts`, `plazo_fecha_dudosa.test.ts`,
  `almacen.test.ts`, 23/23 verdes) más `tsc --noEmit`. No verifiqué el
  resto de la suite ni corrí `npm run lint`.
- No audité a fondo `conv.ts` (11 sitios fuera de `repo.ts`, sin abrir
  desde hace más de cuatro rondas según la serie de la ronda 8) ni
  `startup.ts` — quedan fuera del perímetro y nadie los ha vuelto a mirar
  esta ronda tampoco.
- No revisé si `intake/almacen.ts` deja fotos huérfanas en el bucket
  cuando `subirComprobante` sube el archivo pero el `INSERT` del gasto
  falla después (orden de operaciones I/O, más territorio de backend que
  de arquitectura, pero lo anoto como duda abierta).
- No perseguí exhaustivamente si hay otras constantes o umbrales
  numéricos duplicados fuera de los que grepeé puntualmente
  (`TOPE_EFECTIVO`, `UMBRAL_ALERTA`, `round2`); solo confirmé que esos no
  tienen copia adicional.
