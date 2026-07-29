# Arquitectura y mantenibilidad — auditoría 7

**Nota: 5/10** (antes 4). Razón del movimiento: **se atacó y subió**, con freno.
Los dos CRÍTICOS de la ronda 6 están cerrados **por mecanismo** —una copia
borrada, no dos copias sincronizadas— y eso es exactamente el arreglo que este
rubro pide; sube un punto. No sube dos porque la métrica de la frontera **no
bajó ni un sitio** (55, 38 fuera de `repo.ts`) y porque una *mirada más
profunda* encontró que la duplicación del formateo de dinero es mayor de lo que
la ronda 6 midió: no tres copias de `mxn`, **ocho**.

**Por qué 5 contra las anclas del rubro.** No es 6 ("las fronteras existen y hay
dos o tres fugas conocidas"): hay 38, no tres. No es 4 ("la misma lógica de
dinero vive en más de un archivo"): verifiqué que no — el criterio fiscal vive
solo en `engine.ts` y `deducibilidad.ts`/`acreditable.ts` lo consumen sin
reimplementarlo. Lo que está duplicado es la **presentación** del dinero, no su
cálculo.

> **Nota de método — por qué "se atacó y subió" sí aplica, contra lo que dice el
> MAPA.** El MAPA razona que `src/` no cambió desde `abdc98d`, luego no hubo
> ataque. Verificado: `git log abdc98d..HEAD -- src/` da tres commits, los del
> orquestador. Pero el REPORTE de la ronda 6 que me mandaron a leer se escribió
> **antes** de que los arreglos de la ronda 6 aterrizaran, y esos arreglos SÍ
> están en el árbol de hoy: `git log --oneline -- src/lib/utils.ts` trae
> `84aa979 "fecha y litros: una sola implementación, y el PDF usa la misma"`, y
> `git merge-base --is-ancestor 84aa979 abdc98d` confirma que quedó dentro del
> commit de cierre (10 commits entre uno y otro). O sea: los dos CRÍTICOS que el
> reporte de la ronda 6 describe como abiertos **están cerrados en el código que
> estoy leyendo**. La comparación honesta no es contra `abdc98d`, es contra lo
> que el reporte anterior afirmaba — y contra eso, hubo ataque y funcionó.

**Riesgo mayor del rubro, hoy:** el 69% del acceso a datos vive fuera de
`repo.ts` (38 de 55 sitios) y el `MAPA.md` lleva tres rondas afirmando lo
contrario; en segundo lugar, el formateo de pesos existe **ocho veces escrito a
mano** en producción y el de litros **tres**, sin una sola prueba que compare
dos de esas salidas entre sí.

**Conteo: 0 críticos · 0 altos · 3 medios · 2 bajos.** Los 2 CRÍTICOS que este
rubro abrió en la ronda 6 están cerrados **por mecanismo** (una copia borrada,
no dos copias sincronizadas), que es la única forma de cierre que este rubro
acepta.

---

## La métrica de accesos fuera de `repo.ts`

**Comando exacto** (corrido hoy, `HEAD = 40b886c`, desde `/home/user/cuadra`):

```bash
grep -rn "\.from('\|\.rpc('\|\.from(\`\|\.rpc(\`" src \
  --include=*.ts --include=*.tsx | grep -v "\.test\.ts" \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

**Criterio:** una ocurrencia = una llamada `.from(` o `.rpc(` con literal de
tabla/función en código de producción bajo `src/`. Se excluyen `*.test.ts`. Es
el mismo criterio que la ronda 6 declaró, para que los números sean comparables.

| archivo | r5 | r6 | **r7** | Δ r6→r7 |
|---|--:|--:|--:|--:|
| `src/lib/cuadra/repo.ts` | 16 | 17 | **17** | — |
| `src/lib/cuadra/conv.ts` | 11 | 11 | **11** | — |
| `src/lib/cuadra/analytics.ts` | 8 | 8 | **8** | — |
| `src/lib/cuadra/startup.ts` | 5 | 7 | **7** | — |
| `src/lib/cuadra/costos.ts` | 3 | 4 | **4** | — |
| `src/app/api/export/pdf/[id]/route.ts` | — | 2 | **2** | — |
| `tools.ts`, `processor.ts`, `config.ts`, `auth/session.ts`, `dashboard/page.tsx`, `export/liquidaciones/route.ts` | 6 | 6 | **6** | — |
| **TOTAL** | **49** | **55** | **55** | **0** |

**El número es 55. No subió y no bajó.** Es la primera ronda en cinco que no
sube — pero también es la primera en la que nadie tocó la frontera, así que no
cuenta como defensa: cuenta como que el código no cambió en esta dimensión.

**Fuera de `repo.ts` hay 38 de los 55 (69%).** Ese es el número que de verdad
mide la frontera, y quiero dejarlo escrito porque las rondas 4-6 vinieron citando
el total (49/55) bajo la etiqueta "fuera de `repo.ts`", que no es lo mismo.
Serie corregida, con el mismo criterio: r5 = 33 fuera, r6 = 38 fuera, **r7 = 38
fuera**.

**Segunda medición, independiente**, porque el MAPA pide dos búsquedas para
conclusiones que dependen de una ausencia:

```bash
grep -rn "supabaseAdmin(" src --include=*.ts --include=*.tsx | grep -v "\.test\.ts" \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

Da **46 menciones** en 13 archivos (repo.ts 18 · conv.ts 10 · analytics.ts 5 ·
costos.ts 4 · `supabase/admin.ts` 1 · tools.ts, startup.ts, processor.ts,
presupuesto.ts, config.ts, `dashboard/page.tsx`, `export/pdf/[id]`,
`export/liquidaciones` 1 c/u). Descontando `repo.ts` (18) y
`src/lib/supabase/admin.ts` (1, que es la fábrica), quedan **27 fuera** — y una
de esas 27 es falsa: **`src/lib/cuadra/presupuesto.ts:75`** menciona
`supabaseAdmin()` solo dentro de un comentario, verificado leyendo la línea.
**26 reales.** La segunda medición confirma la primera en forma y en reparto: los
mismos cuatro concentradores (`repo`, `conv`, `analytics`, `costos`) y la misma
cola de archivos con uno cada uno.

`repo.ts` sigue concentrando **31%** del acceso a datos (17/55), el mismo
porcentaje que en la ronda 5. El `MAPA.md` de esta ronda vuelve a decir, línea
94, "`repo.ts` (TODO el acceso a datos)". **Lleva tres rondas sin ser cierto.**

---

## Hallazgos

### [MEDIO, REINCIDENTE — TERCERA RONDA] Un comentario del panel afirma que `litros()` "es la única", y hay dos sitios más que formatean litros sin ella — uno ya divergido
`src/app/dashboard/page.tsx:292-296` (la afirmación) · `src/lib/cuadra/cuadre/resumen.ts:80` · `src/lib/cuadra/liquidacion/acreditable.ts:89,95` · `src/lib/utils.ts:44-49` (`litros`)

La afirmación, literal, en el archivo que sí se arregló:

```ts
// src/app/dashboard/page.tsx:292-296
// Con `maximumFractionDigits: 0` esta tarjeta decía "152 L" y el detalle,
// a un clic, "152.35 L" — y el PDF que el contralor le manda a su contador,
// una tercera cifra. En un dato fiscal, tres representaciones se leen como
// tres cálculos (auditoría 5, frontend, MEDIO 1). `litros()` es la única.
const texto = unidad === 'litros' ? litros(valor) : mxn(valor);
```

**`litros()` no es la única.** Verificado con
`grep -rn "litrosDieselAcreditables\|litrosDiesel" src | grep -v "\.test\."`:
el PDF **no** llama a `litros()` —lo formatea `acreditable.ts:95` con su propia
fórmula— y WhatsApp **tampoco** —`resumen.ts:80` interpola el número crudo—.
Las dos pantallas del panel sí la usan (`page.tsx:296`, `[id]/page.tsx:131`),
que es la mitad del problema que el comentario cree haber cerrado entero.

Tres fórmulas independientes imprimen **el mismo campo**
(`Liquidacion.litrosDieselAcreditables`), y una de las tres ya se ve distinta:

```ts
// src/lib/utils.ts:48 — panel (y la casa canónica, con su comentario de por qué)
return `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;

// src/lib/cuadra/liquidacion/acreditable.ts:95 — PDF, vía filasAcreditables
valor: `${litros.toLocaleString('es-MX')} L`,

// src/lib/cuadra/cuadre/resumen.ts:80 — WhatsApp, interpolación CRUDA
lines.push(`• Diésel elegible para el estímulo de IEPS: ${liq.litrosDieselAcreditables} L`);
```

**Escenario, con valores.** Un viaje con 1,850.5 litros de diésel elegibles
(`engine.ts:783` los entrega ya redondeados a dos decimales con `round2`):

| canal | archivo:línea | qué imprime |
|---|---|---|
| Panel del contralor | `utils.ts:48` | `1,850.5 L` |
| PDF archivado | `acreditable.ts:95` | `1,850.5 L` |
| **WhatsApp** | **`resumen.ts:80`** | **`1850.5 L`** |

El mensaje de WhatsApp es el que llega **primero** y es el único canal del
producto que existe hoy. Con un acumulado mensual de 12,400.75 litros la
diferencia es más visible: `12,400.75 L` en papel contra `12400.75 L` en el chat.

**Intenté refutarlo y esto es lo que aguanta y lo que no.** Lo que NO aguanta:
que se vea en el demo. El separador solo aparece a partir de 1,000 litros, y un
viaje suelto del corredor del seed (Silao→Laredo, ~800 km por tramo) queda por
debajo. **Lo que sí aguanta:** las tres fórmulas son distintas hoy, en el mismo
árbol, sobre el mismo campo, y ninguna prueba las compara. `utils.ts:44-47`
documenta por escrito que su tope de dos decimales está atado a que `engine.ts`
redondea a dos; la columna de la base ya es `numeric(12,3)`
(`0021_liquidacion_litros_diesel.sql:14`). El día que el motor redondee a tres,
`utils.ts` recortará a dos, `acreditable.ts` mostrará tres, y `resumen.ts`
mostrará lo que salga del flotante. Tres números para el mismo litraje.

**Consecuencia.** Para el que mantenga esto: el comentario del panel dice que el
problema está cerrado y no lo está, así que el próximo cambio de formato se hará
en un solo archivo con la confianza de haberlos tocado todos. Para el contralor:
el beneficio más grande que Likida le enseña —así lo llama `resumen.ts:76-77`—
llega escrito de dos maneras en la misma sesión.

**Por qué MEDIO y no ALTO.** Bajo el umbral de 1,000 L las tres salidas son
idénticas, así que no hay daño reproducible en el demo. Lo cuento igual porque
es la regla del rubro: la ronda 5 (frontend, MEDIO 1) y la ronda 6 (arquitectura,
MEDIO) lo reportaron, la ronda 6 **tocó** `litros` —la movió de `formato.ts` a
`utils.ts`— y aun así dejó las otras dos fórmulas fuera y escribió un comentario
diciendo lo contrario.

**Causa raíz probable:** `resumen.ts` y `acreditable.ts` viven bajo
`cuadra/`, donde nadie importa de `@/lib/utils`, y nadie declaró que `utils.ts`
fuera la casa de estas funciones para el motor.

---

### [MEDIO] `mxn()` está escrita a mano **ocho veces** en producción; la ronda 6 midió tres
`src/lib/utils.ts:8-10` · `src/lib/cuadra/cuadre/engine.ts:793-795` · `src/lib/cuadra/cuadre/resumen.ts:8` · `src/lib/cuadra/liquidacion/pdf.ts:34-35` · `src/lib/cuadra/liquidacion/acreditable.ts:16` · `src/lib/cuadra/laboral/pagadero.ts:199` · `src/lib/cuadra/periodo/aviso.ts:13` · `src/app/demo/page.tsx:18`

Conteo con el comando exacto:

```bash
grep -rn "mxn = (n\|function mxn(" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Devuelve exactamente **8 definiciones**, todas con el mismo cuerpo literal
`n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })`. Siete están
**fuera** de `utils.ts`, que es la casa que el propio comentario de
`formato.ts:26-28` nombra. Una de las siete —`pagadero.ts:199`— ni siquiera es
de módulo: está declarada **dentro del cuerpo de una función**, o sea que se
reconstruye en cada llamada y no hay forma de encontrarla mirando los `export`.

La ronda 6 midió **tres** (`utils.ts`, `pdf.ts`, `acreditable.ts`) y lo llamó
MEDIO. La cifra real es **ocho**, y estaba así ayer también: el hallazgo estaba
subdimensionado por no haber corrido este grep. Esto es la parte de *mirada más
profunda* de mi nota.

**Escenario, con valores.** El día que la flota pida montos sin centavos —
petición trivial de un contralor, `minimumFractionDigits: 0` — se cambia
`utils.ts:9`. El panel pasa a decir `$4,200`. El PDF (`pdf.ts:35`), el mensaje
de WhatsApp (`resumen.ts:8`), la nota del motor (`engine.ts:794`, que redacta
`"Diésel de $4,200.00 sigue sin factura"`), el resumen laboral
(`pagadero.ts:199`) y el aviso de combustible (`aviso.ts:13`) siguen diciendo
`$4,200.00`. No falla nada, no hay error, no hay test rojo: `npm test` pasa
igual, porque **ninguna prueba compara dos de esas ocho salidas entre sí**
(verificado: `formato.test.ts` ancla `formato.ts` sola).

**Consecuencia.** Quien mantenga esto cambia una línea y cree que cambió el
producto; en realidad cambió una de ocho superficies. Es el mecanismo exacto por
el que `etiquetaConcepto`/panel divergió dos veces y por el que la fecha del PDF
se quedó atrás una ronda entera: nadie decidió que hubiera copias, cada archivo
la escribió porque era más rápido que importar.

**Por qué MEDIO y no más:** las ocho son hoy **byte por byte idénticas** — lo
verifiqué leyendo las ocho líneas, no por grep de patrón. No hay divergencia
actual, no hay dinero mal, y el demo no se cae. Lo que hay es una superficie de
cambio ocho veces más grande de lo que el repo cree, y la evidencia de que este
patrón cobra factura ya está en el historial: `etiquetaConcepto` divergió dos
veces y la fecha del PDF una, todas por el mismo mecanismo.

**Causa raíz probable:** `utils.ts` importa `clsx` y `tailwind-merge`
(`utils.ts:1-2`), lo que la hace *parecer* un archivo de UI, y nadie quiso que
el motor puro dependiera de ella.

---

### [MEDIO, SIN TOCAR — TERCERA RONDA] `politica_gasto`: tabla escrita, seed divergido, cero lectores
`src/lib/cuadra/repo.ts:82-88` (`getPolitica`) · `supabase/seed.sql:60-72` · `src/lib/cuadra/config.ts:57-67`

Verificado otra vez hoy, con dos búsquedas (`grep -rn "getPolitica" src` y
`grep -rn "politica_gasto" src`): **`getPolitica` no tiene un solo consumidor
fuera de su propia definición**, y `politica_gasto` no aparece en `src/` salvo
dentro de esa función. El seed sigue con `viaticos` —concepto que
`types/cuadra.ts:20-25` marca como heredado— y sin `flete`, mientras
`config.ts:57-67` (lo que el motor de verdad lee, vía `desde_db.ts`) tiene los
siete conceptos vivos.

**Escenario.** A ocho días del demo, alguien captura la política real del
cliente en `politica_gasto` desde la consola de Supabase, siguiendo la
instrucción en mayúsculas del propio seed. El motor sigue leyendo
`tenant.config` jsonb. No hay error ni log: la tabla se escribió, nadie la lee,
y los topes que aplica el cuadre son los del demo.

**Consecuencia.** Tercera ronda con la misma advertencia sin atender. La bajo de
ALTO a MEDIO respecto de la ronda 6 por una razón concreta que verifiqué: el
único camino por el que un tope entra al motor es `config.ts` → `desde_db.ts`, y
no existe ninguna ruta de escritura desde el producto hacia `politica_gasto`, así
que la falla requiere que un humano vaya a la consola. Sigue siendo deuda
declarada.

**Causa raíz probable:** la tabla nació antes de que la política se moviera a
`tenant.config` jsonb, y el borrado nunca se hizo.

---

### [BAJO] `CLAVES_PEAJE` sigue escrita dos veces, y ahora las dos tienen el mismo comentario copiado
`src/lib/cuadra/intake/concepto.ts:27` · `src/lib/cuadra/config.ts:100`

Las mismas dos claves SAT (`95111602`, `95111603`) en dos archivos. Verificado:
`config.ts:98-101` copió el razonamiento de `concepto.ts:15-25` sobre por qué
`93151505` queda fuera, y remata con "Ver intake/concepto.ts" — o sea, quien lo
escribió sabía que era una copia. Sigue inerte porque `processor.ts` siempre
pasa el valor de `config.ts` y el default de `concepto.ts` solo lo usan sus
tests. Riesgo latente: agregar una tercera clave de peaje en un solo archivo no
falla, cambia el acreditamiento del 50% de LIF 20-A solo por un camino.

---

### [BAJO] `ESTATUS` de liquidación duplicado literalmente entre las dos pantallas
`src/app/dashboard/page.tsx:15-17` · `src/app/dashboard/[id]/page.tsx:26-28`

Mismo mapa `Record<string, {label, color}>` con los tres estatus, escrito dos
veces, hoy idéntico. Sin prueba que los compare. Es el mismo patrón que produjo
la divergencia de `etiquetaConcepto`, un nivel más abajo.

---

## Lo que revisé y está bien (los dos CRÍTICOS de la ronda 6, cerrados)

- **La fecha del PDF y la del panel ya no pueden divergir — cerrado por
  mecanismo, no por parche.** `src/lib/utils.ts:37-64` es hoy la única
  definición de `fechaMx` (con `TZ_MX = 'America/Mexico_City'`);
  `src/lib/cuadra/liquidacion/pdf.ts:15` la importa y `pdf.ts:53` es un alias de
  una línea (`const fecha = (iso?: string) => fechaMx(iso);`); y
  `src/app/dashboard/formato.ts:31` dejó de definirla y ahora **reexporta**
  (`export { TZ_MX, litros, fechaMx } from '@/lib/utils';`). Una sola función,
  tres consumidores. Además `fechaMx` ganó la guarda de `Invalid Date`
  (`utils.ts:59`) que no tenía. Es exactamente el arreglo correcto para este
  rubro: no se sincronizaron dos copias, se borró una.
- **El mapa gemelo de etiquetas de concepto en `pdf.ts` se BORRÓ.**
  `pdf.ts:30-33` deja el hueco documentado: *"Aquí vivía `CONCEPTO_LABEL`, un
  mapa gemelo del que tiene el motor. Se borró al pasar a `etiquetaConcepto`…
  Una función importada no puede desincronizarse."* Verificado con dos
  búsquedas (`grep -rn "CONCEPTO_LABEL" src` → dos hits, **ninguno es una
  definición**: el comentario de `pdf.ts:29` y una prueba que **prohíbe que
  vuelva**, `etiquetas_sincronizadas.test.ts:43`, que lee el fuente de `pdf.ts`
  y falla si reaparece `const CONCEPTO_LABEL`;
  `grep -rn "otro: '" src` → dos sitios, ambos `'Otro'`). **El ejemplo canónico
  del rubro —`engine.ts` con `otro: 'Gasto'` contra `pdf.ts` con `otro: 'Otro'`—
  ya no existe: `engine.ts:819` dice `otro: 'Otro'` con el comentario "tiene que
  decir lo MISMO que pdf.ts y el dashboard", y `pdf.ts` ya no tiene mapa.**
  El único mapa que queda (`[id]/page.tsx:20-24`) está declarado como red de
  respaldo y solo se usa cuando `etiquetaConcepto` devuelve la clave cruda
  (`[id]/page.tsx:239-241`).
- **El sondeo placebo de la migración 0019 se reemplazó por uno que sí puede
  fallar.** `startup.ts:108-142`: en vez de un `SELECT` que responde igual con o
  sin índice, hoy consulta el **catálogo** vía `admin.rpc('indices_faltantes',
  { p_esperados: [...] })` con un mapa `INDICES` que cubre
  `uq_gasto_cfdi_uuid` (0019) y `uq_operador_telefono_activo` (0024), cada uno
  con el daño concreto en el mensaje. El comentario de 15 líneas describe
  correctamente por qué el anterior no servía y qué pasa si falta la propia
  0030. Verificado que el error de la RPC se reporta como "no se pudo
  preguntar" y no como "falta la 0019" (`startup.ts:133-136`) — que es
  exactamente la clase de mentira que el MAPA cataloga cinco veces.
- **El sondeo de la 0022 tiene la aridad correcta.** `startup.ts:155-159` llama
  `guardar_liquidacion_tx` con **11** argumentos nombrados, que es la firma de
  `0013` — y esa es la aridad que produce el `42725` cuando 0013 y 0021 conviven.
  Verificado contra `0022_drop_guardar_liquidacion_tx_vieja.sql:31-33`, que
  dropea exactamente esa firma de 11. Que `repo.ts:397-409` llame con **12**
  (incluyendo `p_litros_diesel`) no es una inconsistencia: la sonda tiene que
  usar la aridad ambigua, no la de producción. Lo verifiqué porque parecía una
  divergencia y no lo es.
- **El motor sigue siendo puro.** Dos búsquedas independientes sobre `cuadre/`,
  `normas/`, `laboral/`, `liquidacion/`, `facturacion/`, `periodo/`:
  cero `Date.now(`, `process.env`, `Math.random`, `randomUUID`, `fetch(`,
  `supabaseAdmin`. `engine.ts` no importa nada de `@/lib/supabase`,
  `@/lib/utils` ni `next/*`.
- **`presupuesto.ts` no toca la base.** Aparece en el grep de `supabaseAdmin`
  solo por un comentario (`presupuesto.ts:75`); no hay llamada. Lo verifiqué
  para no inflar la métrica.
- **`acreditable.ts` y `deducibilidad.ts` siguen sin duplicar criterio fiscal**
  — lo consumen de `engine.ts` (`cubetaDe`, campos ya calculados). Reverificado.
- **`analytics.ts:127` y `analytics.ts:153`** declaran dos tipos con campos
  homónimos (`litrosDiesel/ieps/iva/peaje`), pero son agregados distintos (uno
  suma filas, otro lee una fila): no es duplicación de verdad, es la misma
  proyección en dos granularidades. No lo reporto.

## Lo que NO alcancé a revisar

- **`conv.ts` (11 sitios de consulta) por dentro.** Lo conté para la frontera,
  no audité su semántica. Es el segundo concentrador de acceso a datos y nadie
  lo ha abierto en tres rondas.
- **Si los 21 literales de nombres de tools bajaron o subieron** — sigo sin
  recontarlos, tercera ronda que lo dejo pendiente.
- **`processor.ts` (>800 líneas)** — no evalué si sus responsabilidades
  justifican un solo archivo.
- **`catalogoCuentas` (`config.ts:75-82`)**: verifiqué que sigue sin
  consumidores, pero no rastreé si el mapeo `viaticos→600-003` colisiona con
  `alimentacion/hospedaje/transporte→600-003` de forma que importe. Es tabla
  muerta, así que lo dejé.
- **No leí los reportes de los otros auditores de esta ronda.** Probable solape
  con pruebas sobre la ausencia de una prueba que compare las ocho salidas de
  `mxn`.
