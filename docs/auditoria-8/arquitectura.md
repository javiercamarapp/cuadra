# Arquitectura y mantenibilidad — auditoría 8

**Nota: 5/10** (antes 5). Razón del movimiento: **las dos primeras formas ocurrieron
a la vez y se cancelan.** *Se atacó y subió*: `formato.ts` es de verdad el único
origen —lo verifiqué contando definiciones, no leyendo el commit—, y con él
cayeron por mecanismo (copia borrada, no copias sincronizadas) los cuatro
hallazgos de duplicación que dejé abiertos en la ronda 7: `mxn()` 8→**1**,
`litros()` 3→**1**, `CLAVES_PEAJE` 2→**1**, el lector de `politica_gasto`
borrado. Es la mejor ronda que ha tenido este rubro. *Deuda que cobró factura*:
la métrica de la frontera subió **38 → 40**, quinta ronda sin bajar nunca, y el
mismo patrón que llevo cuatro rondas señalando —una verdad, N literales— cobró
factura en el sitio más caro que hay: **el papel que el contralor archiva se
contradice a sí mismo sobre cómo se llama el producto**, a cinco días del demo.

**Por qué no sube a 6.** El ancla de 6 dice "las fronteras existen y hay dos o
tres fugas conocidas". Hay **40**, y subieron. Ese es el mismo razonamiento con
el que la ronda 7 se negó a subir de 5, y hoy el número es peor.

**Por qué no baja a 4.** El ancla de 4 dice "la misma lógica de dinero vive en
más de un archivo". Reverifiqué: el **criterio fiscal** sigue viviendo solo en
`engine.ts` —`deducibilidad.ts` y `acreditable.ts` lo consumen sin
reimplementarlo, `analytics.ts` suma columnas ya persistidas sin recalcular
criterio—. Lo que está repartido es la **aritmética** (`round2`, cuatro copias) y
la **identidad del producto**, no el criterio.

**Riesgo mayor del rubro, hoy:** el PDF de liquidación lleva `Cuadra` de cabecera
en 20pt y `Generado por Likida` en el pie, en la misma hoja, y el bot de WhatsApp
se presenta como *Cuadra* mientras toda la web dice *Likida*. Es el patrón
histórico de este rubro (un concepto, cuatro literales) golpeando el entregable
que el comprador se lleva a su archivero.

**Conteo: 1 crítico · 1 alto · 3 medios · 2 bajos.**

---

## La métrica de la frontera

**Comando exacto** (corrido hoy, `HEAD = 337e1a8`, desde `/home/user/cuadra`),
el mismo criterio que declararon las rondas 6 y 7 para que la serie sea
comparable:

```bash
grep -rn "\.from('\|\.rpc('\|\.from(\`\|\.rpc(\`" src \
  --include=*.ts --include=*.tsx | grep -v "\.test\.ts" \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

**Salida real, literal:**

```
     17 src/lib/cuadra/repo.ts
     11 src/lib/cuadra/conv.ts
      9 src/lib/cuadra/startup.ts
      8 src/lib/cuadra/analytics.ts
      4 src/lib/cuadra/costos.ts
      2 src/app/api/export/pdf/[id]/route.ts
      1 src/lib/cuadra/tools.ts
      1 src/lib/cuadra/processor.ts
      1 src/lib/cuadra/config.ts
      1 src/lib/auth/session.ts
      1 src/app/dashboard/page.tsx
      1 src/app/api/export/liquidaciones/route.ts
```

**Total 57. Fuera de `repo.ts`: 40.** La serie honesta que dejé anotada
—accesos a datos FUERA de `repo.ts`— queda así:

| r5 | r6 | r7 | **r8** |
|--:|--:|--:|--:|
| 33 | 38 | 38 | **40** |

**Subió 2.** `repo.ts` concentra hoy el **29,8 %** (17/57), menos que el 31 % de
la ronda 7. El `MAPA.md` de esta ronda vuelve a decir, línea 106, "`repo.ts`
(TODO el acceso a datos)": **lleva cuatro rondas sin ser cierto.**

**Los dos sitios nuevos, identificados por diff contra `abdc98d`:**

```bash
git show abdc98d:src/lib/cuadra/startup.ts | grep -o "\.rpc('[a-z_]*'\|\.from('[a-z_]*'" | sort > a
grep -o "\.rpc('[a-z_]*'\|\.from('[a-z_]*'" src/lib/cuadra/startup.ts | sort > b
diff a b
> .from('viaje'
> .rpc('confirmar_aviso_privacidad'
```

Son `startup.ts:100` y `startup.ts:166`. **Intenté refutar que cuenten y en
parte lo logré:** las dos son sondas de esquema con argumentos deliberadamente
inválidos (`ZERO`, `'sonda'`), y pasarlas por `repo.ts` se tragaría el error que
la sonda existe para ver — es el mismo argumento que acepté en la ronda 7 para
`guardar_liquidacion_tx`. **Lo que sí aguanta:** `confirmar_aviso_privacidad`
tiene ahora **dos llamadores con la lista de parámetros escrita a mano**
(`repo.ts:503-505` con `p_operador/p_tenant/p_version` y `startup.ts:167` con los
mismos tres), y ninguno importa la firma del otro.

**Segunda medición independiente**, porque el MAPA pide dos búsquedas:

```bash
grep -rn "supabaseAdmin(" src --include=*.ts --include=*.tsx | grep -v "\.test\.ts" \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

Confirma el mismo reparto: los cuatro concentradores (`repo`, `conv`,
`analytics`, `costos`) y la misma cola de archivos con uno cada uno.

**Corrección de método que le debo a la serie.** Tres de las 57 ocurrencias no
son acceso a tablas sino a **Storage**: `tools.ts:170`, `processor.ts:880` y
`export/pdf/[id]/route.ts:58` son `supabaseAdmin().storage.from('liquidaciones')`
(el bucket de la migración `0008_storage_bucket.sql`), no `.from()` de PostgREST.
Las conté igual porque el criterio tiene que ser el de r6/r7 para que la serie
signifique algo, pero el número honesto de acceso a **datos** fuera de `repo.ts`
es **37**, no 40. Con ese criterio la serie sería 33 → 38 → 38 → 37 y no habría
subido. **Digo las dos y me quedo con la comparable**, porque cambiar el criterio
el año que el número sube es exactamente cómo una métrica deja de servir.

---

## El estado de `formato.ts`

**Es el único origen. No es la novena copia.** Verificado contando, no leyendo el
commit:

```bash
grep -rn "mxn = (n\|function mxn(\|mxn = (" src --include=*.ts --include=*.tsx | grep -v "\.test\."
→ src/lib/formato.ts:37:export function mxn(n: number): string {     (1 resultado)

grep -rn "style: 'currency'" src --include=*.ts --include=*.tsx | grep -v "\.test\."
→ src/lib/formato.ts:38  (MXN)   ·   src/lib/formato.ts:43  (USD)     (2 resultados, ambos ahí)

grep -rn "function litros\|litros = (" src --include=*.ts --include=*.tsx | grep -v "\.test\."
→ src/lib/formato.ts:53:export function litros(n: number): string {   (1 resultado)
```

Las ocho copias de `mxn()` que conté en la ronda 7 **se borraron**, no se
sincronizaron: los ocho archivos importan hoy de `@/lib/formato`
(`engine.ts:19`, `resumen.ts:6`, `pdf.ts:15`, `acreditable.ts:17`,
`pagadero.ts:21`, `aviso.ts:12`, `processor.ts:21`, `demo/page.tsx:4`), y
`utils.ts:12` y `dashboard/formato.ts:27` **reexportan** en vez de redefinir.
`8 → 1`.

**El reincidente x4 de los litros está cerrado.** `resumen.ts:83` ya no interpola
el número crudo: llama `litros(liq.litrosDieselAcreditables)`. `acreditable.ts:17`
importa `litros as fmtLitros` en vez de su fórmula propia. Los tres canales
—WhatsApp, PDF, panel— pasan hoy por `formato.ts:53`. El escenario que reporté
tres rondas seguidas (`1,850.5 L` en papel contra `1850.5 L` en el chat) **ya no
se puede producir**: hay una sola fórmula.

`formato.ts` además **no importa nada** (cero `import`), que era la razón
declarada de no meterlo en `utils.ts` —`clsx` y `tailwind-merge`— y hace que el
motor puro pueda depender de él sin arrastrar el sistema de clases del panel.
Es el arreglo correcto para este rubro.

**Lo que `formato.ts` dejó fuera y por eso no cierra el rubro:** la
**aritmética** del dinero (`round2`) sigue repartida en cuatro archivos. Ver
MEDIO 1.

---

## Hallazgos

### [CRÍTICO] El producto tiene dos nombres, y los dos salen impresos en la misma hoja de la liquidación

`src/lib/cuadra/liquidacion/pdf.ts:150` · `src/lib/cuadra/liquidacion/pdf.ts:387`
· `src/lib/cuadra/liquidacion/pdf.ts:76` · `src/lib/cuadra/conv.ts:147` ·
`src/app/demo/page.tsx:22`

Las líneas, abiertas y leídas:

```ts
// pdf.ts:150 — encabezado del documento, 20pt bold, el texto más grande de la página
text('Cuadra', M, y, 20, bold, INK);

// pdf.ts:387 — pie del MISMO documento
text(`Generado por Likida · ${fecha(liq.creadaEn)}`, M, PISO_PIE - 26, 8, font, MUTED);

// pdf.ts:76 — metadatos del archivo
doc.setProducer('Cuadra');

// conv.ts:147 — con qué nombre se presenta el bot de WhatsApp
agentName: 'Cuadra',

// demo/page.tsx:22 — lo que la página del demo ensaya que dirá el bot
{ from: 'cuadra', text: `¡Hola! Soy Likida. Ya casi cierras tu viaje Silao → Laredo…` },
```

`conv.ts:147` alimenta `src/lib/agents/prompts.ts:17`, que arma el system prompt
literal: `` `Eres ${ctx.agentName}, el asistente de liquidación de viajes de
${ctx.nombreFlota}` ``. O sea: el agente real se llama **Cuadra**.

**Escenario, con valores.** Demo del 6-ago con Transportes Innovativos.
`GUION_DEMO.md:60` manda enseñar, en este orden, el mensaje de WhatsApp y
**después el PDF**.

| momento | archivo:línea | qué ve el contralor |
|---|---|---|
| landing / panel | `app/page.tsx:8`, `dashboard/page.tsx:79` | **Likida** |
| página del demo | `demo/page.tsx:22` | *"¡Hola! Soy **Likida**"* |
| bot real por WhatsApp | `conv.ts:147` → `prompts.ts:17` | *"Soy **Cuadra**"* |
| PDF, encabezado 20pt | `pdf.ts:150` | **Cuadra** |
| PDF, pie de la misma hoja | `pdf.ts:387` | *"Generado por **Likida**"* |
| propiedades del archivo PDF | `pdf.ts:76` | Producer: **Cuadra** |

El mismo documento, la única hoja que el contralor se lleva, se presenta como
producto de dos empresas distintas.

**Intenté refutarlo.** Busqué el guardarraíl y **no existe**:
`grep -rn "Cuadra" src --include=*.test.ts` da dos resultados y ninguno cubre
esto — `prompts.test.ts:5` *fija* `agentName: 'Cuadra'` como valor esperado (o
sea, el test defiende el nombre viejo), y `pdf_cifras.test.ts:156` busca
`/^Cuadra exacto$/`, que es el **verbo** "cuadrar" en el renglón "Cuadra
exacto", no la marca. `dominio_propio.test.ts` —creado justo para esto— vigila
**dominios ajenos** (`cuadra.mx`, `transportesinnovativos.mx`), no el nombre del
producto, así que pasa en verde con `text('Cuadra', …)` intacto.

Lo más elocuente: el commit `87daa62` que arregló el pie del PDF tocó la línea
387 y **dejó la 150**, 237 líneas más arriba en el mismo archivo. Su propio
comentario (`pdf.ts:391-392`) explica por qué se le escapó: *"EN EL FUENTE NO SE
VE. `right('cuadra.mx', …)` se lee como una marca."* Exactamente lo mismo aplica
a `text('Cuadra', …)` y ahí sigue.

**Consecuencia.** Para el contralor de la flota, en la sala, el 6-ago: le están
vendiendo Likida y el papel que va a archivar —el entregable, el que suma con
calculadora, el que le puede enseñar a su contador o a una autoridad— dice
Cuadra arriba y Likida abajo. El `MAPA.md` lo dice en su primer párrafo: *"Un
error que el contralor vea en la sala cuesta el trato."* Para quien mantenga
esto: renombrar el producto exige tocar cinco literales en cuatro archivos y
ninguna prueba avisa si se olvida uno — es la razón por la que ya se olvidó uno.

**Por qué CRÍTICO y no ALTO.** No tumba el proceso, pero el entregable que el
comprador se lleva se contradice a sí mismo sobre la identidad del vendedor,
delante del comprador, en la sesión que decide el trato. Si el orquestador
prefiere ALTO, el hecho verificable no cambia: `pdf.ts:150` y `pdf.ts:387` están
en el mismo `generarLiquidacionPDF`.

**Causa raíz probable:** el nombre del producto nunca tuvo casa —ni una constante
ni un módulo—, así que el cambio de marca se hizo grep por grep y `text('Cuadra',
…)` no matchea `cuadra.mx`.

---

### [ALTO] El PDF declara como "comprobantes duplicados" los que solo traían un monto inválido

`src/lib/cuadra/liquidacion/omitidos.ts:73` · `src/lib/cuadra/liquidacion/pdf.ts:224`

```ts
// omitidos.ts:72-73
const filas = liq.gastos.filter((g) => !dup.has(g.id) && g.monto > 0);
return { filas, duplicados: liq.gastos.length - filas.length };
```

`duplicados` se calcula por **resta**, no contando el conjunto `dup`. El filtro
tiene dos criterios (duplicado **y** `monto > 0`) y el contador atribuye los dos
al primero. `pdf.ts:224` lo imprime como hecho:

```ts
text(`${nDup} ${nDup === 1 ? 'comprobante duplicado, excluido' : 'comprobantes duplicados, excluidos'} del total`, …)
```

**Escenario, con valores. Corrido contra el módulo real** (`npx tsx`, importando
`omitidos.ts`, sin mocks):

```
entra:  a caseta $300 · b caseta $300 (duplicado real) · m otro $0 (OCR leyó mal el total) · c diésel $4,200
salida: filas impresas: [ 'a', 'c' ]
        nDup que el PDF imprime: 2
        duplicados REALES:       1
```

El PDF imprime **"2 comprobantes duplicados, excluidos del total"** cuando hubo
**uno**. El gasto `m` desaparece de la tabla sin un solo renglón que lo explique,
recategorizado como duplicado del operador. `monto: 0` no es hipotético: es el
caso que `engine.ts:206` emite como `monto_invalido` (*"tiene un monto inválido
(…) — revisar a mano"*), y el motor lo excluye del total por la misma razón
(`engine.ts:196-199`).

**Intenté refutarlo y el guardarraíl falla justo ahí.** `omitidos.test.ts:89-94`
cubre el caso exacto —`filasImprimibles(liq([a, malo], [], 300))` con
`malo.monto = -50`— pero **solo comprueba `r.filas`**; nunca asserta
`r.duplicados`, que en ese mismo caso vale `1` con cero duplicados. Los otros
tres tests del bloque (líneas 72, 78, 83) **sí** comprueban `r.duplicados`, pero
solo en escenarios sin montos inválidos. La prueba que tocaba el caso es la única
que dejó el campo sin mirar.

**Consecuencia.** El contralor lee en el papel archivado que su operador mandó
dos fotos repetidas cuando mandó una, y no se entera de que hay un comprobante
que el sistema no pudo leer y que alguien tiene que capturar a mano. La
diferencia importa: una repetición es descuido del chofer, un monto ilegible es
dinero pendiente de comprobar. Además el número de renglones impresos no cuadra
con la explicación que el propio documento da de lo que falta — en un papel cuya
razón de existir, según `omitidos.ts:8-10`, es *"cuadrar consigo mismo"*.

**Causa raíz probable:** `omitidos.ts` reimplementa el filtro `monto > 0` de
`engine.ts:196` en lugar de recibir el conjunto que el motor ya calculó, y al
mezclarlo con el de duplicados en una sola resta pierde de cuál de los dos vino
cada exclusión.

---

### [MEDIO] `round2` —la aritmética del dinero— está escrita cuatro veces, más una quinta en línea; `formato.ts` cerró la presentación y la dejó fuera

`src/lib/cuadra/cuadre/engine.ts:803` · `src/lib/cuadra/analytics.ts:396` ·
`src/lib/cuadra/laboral/pagadero.ts:107` ·
`src/lib/cuadra/periodo/combustible.ts:63` ·
`src/lib/cuadra/liquidacion/omitidos.ts:35` (la quinta, sin nombre)

Conteo con el comando exacto:

```bash
grep -rn "function round2\|const round2\|round2 =" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Devuelve **cuatro definiciones**, las cuatro con el cuerpo literal
`Math.round(n * 100) / 100`, leídas una por una. La quinta no aparece en ese
grep porque `omitidos.ts:35` la escribe suelta: `monto: Math.round(monto * 100) / 100`.

Ninguna está en `formato.ts`, que es la casa que este repo acaba de crear para
"cómo se imprime una cifra" (`formato.ts:1-2`). El arreglo de `mxn()` unificó el
**formato** y dejó la **aritmética** exactamente igual de repartida que antes.

**Escenario, con valores.** La columna de litros de la base es `numeric(12,3)`
(`0021_liquidacion_litros_diesel.sql`) y `formato.ts:47-51` documenta que su tope
de dos decimales *"está atado a que el motor redondea a dos"*. El día que el
motor redondee a tres —cambio de una línea en `engine.ts:803`— para dejar de
perder el tercer decimal que la base ya guarda:

| dónde | archivo:línea | 1,850.523 L acumulados sobre 12 viajes |
|---|---|---|
| el motor y el PDF | `engine.ts:803` (cambiado) | `1,850.523` |
| el acumulado del panel | `analytics.ts:396` (sin cambiar) | `1,850.52` |
| el neto del operador | `pagadero.ts:107` (sin cambiar) | recorta a 2 |
| el 15% de combustible | `combustible.ts:63` (sin cambiar) | recorta a 2 |

No hay error, no hay test rojo: **ninguna prueba compara dos de las cuatro
salidas entre sí**. El mismo mecanismo por el que `mxn()` llegó a ocho copias
antes de que alguien lo midiera.

**Intenté refutarlo.** Lo que **no** aguanta: que haya divergencia hoy. Las
cuatro son byte por byte idénticas, lo verifiqué leyendo las cuatro líneas.
Lo que **sí** aguanta: es el mismo patrón que este rubro acaba de cerrar en
`formato.ts` tras cuatro rondas de reincidencia, sobre el mismo dato (dinero) y
con el mismo número de superficies invisibles. Y hay una asimetría real ya: dos
son `function` (`engine`, `analytics`) y dos son `const` de módulo (`pagadero`,
`combustible`), así que el grep por `export function round2` no las encuentra
todas — que es exactamente cómo la ronda 6 midió tres `mxn()` donde había ocho.

**Consecuencia.** Para quien mantenga esto: cambiar cómo redondea el dinero
parece un cambio de una línea y son cinco superficies, una de ellas anónima.
El precedente de que este patrón cobra factura está en el historial de este
mismo repo, cuatro veces.

**Causa raíz probable:** `formato.ts` se definió como "cómo se imprime una
cifra" y no como "cómo se trata una cifra", así que la aritmética no tuvo dónde
mudarse.

---

### [MEDIO] El nombre de cada tool vive en cinco archivos y el ensamblador descarta en SILENCIO el nombre que no resuelve

`src/lib/llm/tool-executor.ts:36-38` · `src/lib/agents/registry.ts:21` ·
`src/lib/cuadra/tools.ts:29,85,144` · `src/lib/cuadra/cuadre/guardia.ts:39,51,52`
· `src/lib/cuadra/processor.ts:701,705,739,874`

```ts
// tool-executor.ts:35-39
export function toolSchemas(names: string[]): OpenAI.Chat.ChatCompletionTool[] {
  return names
    .map((n) => REGISTRY.get(n)?.schema)
    .filter((s): s is OpenAI.Chat.ChatCompletionTool => Boolean(s));
}
```

Conteo:

```bash
grep -rn "'consultar_politica'\|'cuadrar_viaje'\|'guardar_liquidacion'" src \
  --include=*.ts --include=*.tsx | grep -v "\.test\." | wc -l
→ 15
```

**15 literales para 3 nombres, en 5 archivos**: `tools.ts` (6, donde se definen),
`prompts.ts` (5, dentro del texto del system prompt), `processor.ts` (4),
`guardia.ts` (4), `registry.ts` (1, la lista que se le ofrece al modelo). Ninguno
importa una constante; los quince son cadenas escritas a mano.

**Escenario, con valores.** Alguien renombra la tool en `tools.ts:144`
(`'guardar_liquidacion'` → `'cerrar_liquidacion'`) y actualiza `guardia.ts` y
`processor.ts`, pero olvida `registry.ts:21`. Entonces:

- `toolSchemas(['consultar_politica','cuadrar_viaje','guardar_liquidacion'])`
  devuelve **2 schemas en vez de 3**. `.filter(Boolean)` se come el tercero:
  **sin excepción, sin log, sin advertencia.** `registerTool` sí avisa de un
  re-registro (`tool-executor.ts:30`) y `executeTool` sí devuelve
  `"tool desconocida: …"` (`tool-executor.ts:49-50`), pero a `executeTool` nunca
  se llega: el modelo jamás vio la tool.
- Al modelo se le ofrecen dos herramientas. Cierra en prosa —"listo, ya te cerré
  tu liquidación de $4,200"— sin llamar a nada.
- `guardia.ts:51` (`cerro = toolCalls.some(t => t.toolName === 'guardar_liquidacion')`)
  ve `false`, así que el encabezado no afirma el cierre… y no hay liquidación,
  ni PDF, ni fila en la base.

`npm test` pasa: no hay ninguna prueba que ate `registry.ts:21` a los nombres de
`tools.ts` (`grep -rln "registry" src --include=*.test.ts` → **cero archivos**).

**Intenté refutarlo.** Hoy los tres nombres coinciden, lo verifiqué literal a
literal, así que no hay falla en curso — por eso es MEDIO y no ALTO. Lo que lo
sostiene es que la junta entre las cinco copias **no la sostiene nada**, y su
modo de fallo es el silencio: `.filter(Boolean)` convierte un error de
configuración en menos capacidades ofrecidas al modelo, que es indistinguible de
que el modelo simplemente no quiso usarla.

**Consecuencia.** Para quien mantenga esto: la única herramienta que escribe en
la base se puede desconectar con un renombre incompleto y el sistema no lo dice
en ningún lado. Es la tercera aparición del modo *"se construyó el mecanismo y
nadie los conectó"* que el MAPA cataloga, con la variante peor: aquí la
desconexión se produciría después de haber estado conectado.

**Causa raíz probable:** el registro de tools es por efecto de importación
(`tools.ts:2`) y `toolSchemas` trata un nombre que no resuelve como una lista
opcional en vez de como un error de arranque.

---

### [MEDIO, REINCIDENTE — QUINTA RONDA] La métrica de la frontera subió otra vez, y el `MAPA.md` lleva cuatro rondas afirmando lo contrario

`src/lib/cuadra/startup.ts:100` · `src/lib/cuadra/startup.ts:166` ·
`docs/auditoria-8/MAPA.md:106`

Serie con criterio constante: **33 → 38 → 38 → 40**. Nunca ha bajado. El
`MAPA.md:106` de esta ronda dice, literal, "`repo.ts` (TODO el acceso a datos)"
— y `repo.ts` tiene 17 de 57 sitios, el **29,8 %**.

**Escenario, con valores.** Alguien lee el MAPA, necesita blindar el scoping por
tenant y añade el filtro en `repo.ts`, confiando en la frase. `conv.ts` (11
sitios), `analytics.ts` (8), `startup.ts` (9) y `costos.ts` (4) no lo reciben. El
precedente exacto está en el árbol: `export/pdf/[id]/route.ts:40-46` tuvo que
escribir a mano `.eq('tenant_id', TENANT())` con un comentario explicando *"El
filtro por tenant es EXPLÍCITO: sin sesión de Supabase no hay RLS que scopee"*,
porque no pasa por `repo.ts`. Cada sitio fuera de la frontera es una repetición
de esa decisión que alguien tiene que acordarse de tomar.

**Intenté refutarlo, y es la parte más honesta de esto.** Los dos sitios nuevos
son sondas de diagnóstico con argumentos inválidos, y pasarlas por `repo.ts` se
tragaría el error que existen para ver; acepté ese mismo argumento en la ronda 7.
Y tres de las 57 son Storage, no tablas (ver la sección de la métrica): con el
criterio estricto el número sería 37 y habría bajado uno. **Lo reporto igual
porque es la regla del rubro:** una advertencia que vuelve a ocurrir es un
hallazgo, y lo que no admite matiz es que el `MAPA.md` afirma un invariante que
el `grep` desmiente desde la ronda 5.

**Consecuencia.** Para quien mantenga esto: el documento que se le entrega a cada
auditor y a cada persona nueva describe una arquitectura que el código no tiene,
y esa frase es la que hace que nadie sienta que hay una fuga que cerrar.

**Causa raíz probable:** nadie es dueño de la frase; la métrica se mide en la
auditoría y el MAPA se escribe aparte.

---

### [BAJO] `permiso_cre.ts` y sus 436 KB de JSON no los usa nadie en producción, y una prueba prohíbe conectarlos

`src/lib/cuadra/facturacion/permiso_cre.ts:67` (`import PERMISOS from './permisos_cre.json'`)
· `src/lib/cuadra/facturacion/permiso_cre.test.ts:156-164`

```bash
grep -rn "identificarPorPermiso\|permisoDelTicket\|permisosDelTicket\|coberturaTablaCre" src \
  --include=*.ts --include=*.tsx | grep -v "permiso_cre.ts:"
→ 23 resultados, TODOS en permiso_cre.test.ts
```

Cero consumidores de producción. Y el propio módulo trae el candado que lo
mantiene así (`permiso_cre.test.ts:161-163`): lee el fuente de `identificar.ts`
y falla si aparece `permiso_cre` o `identificarPorPermiso`.

**El encargo era verificar si el catálogo se respetó como dato y no como código:
sí se respetó.** `permisos_cre.json` (436 KB) es un mapa plano `string → string`
sin una sola rama, y `permiso_cre.ts` es formato + búsqueda con tres estados
(`reconocido` / `desconocido` / `sin_permiso`), sin colapsar "no sé" en "no
existe" — que es justo el patrón que el MAPA cataloga cinco veces. `comercios.ts`
igual: 742 líneas, 37 entradas, **una** función (`comercio()`, línea 740). No hay
lógica escondida en el dato. Eso está bien y lo digo abajo también.

**Escenario, con valores.** El módulo se importa desde `facturacion/`, que sí
entra al bundle del webhook por `identificar.ts` → `engine.ts:461`. Un
`import` estático de 436 KB de JSON en un módulo que ningún camino de producción
ejecuta es peso muerto que solo el tree-shaking evita, y `permiso_cre.ts` no
tiene ninguna importación desde producción que lo delate como muerto: parece
vivo desde el `git log` (`688b8c2`, `f2c4768`) y desde el índice del `MAPA.md`
(línea 101), que lo lista junto a los módulos activos.

**Consecuencia.** Para quien mantenga esto: 12,625 filas que hay que regenerar,
un `.test.ts` de 165 líneas que hay que mantener verde, y un módulo que aparece
en el mapa de arquitectura como si participara — todo sostenido por una decisión
correcta (*la marca es una pista, no un veredicto*) que solo está escrita dentro
del archivo que nadie llama.

**Causa raíz probable:** la cosecha se cerró antes de decidir quién consume su
resultado, y la decisión que se tomó fue "nadie, por ahora".

---

### [BAJO] `RestriccionCampo`: una interfaz de cinco campos, una sola entrada la usa en 37 comercios, y no la lee nadie

`src/lib/cuadra/facturacion/comercios.ts:31-38` (la interfaz) ·
`src/lib/cuadra/facturacion/comercios.ts:288` (la única entrada que la puebla)

```bash
grep -rn "largoMax\|largoMin\|soloDigitos\|mayusculas" src --include=*.ts --include=*.tsx | grep -v "\.test\."
→ comercios.ts:32,33,36,37 (la declaración)  ·  comercios.ts:288 (Office Depot)
```

Cinco campos declarados, **un** uso en 37 comercios, **cero** consumidores en
producción. Los dos únicos lectores son asserts de test (`identificar.test.ts:111-112`).

El comentario de `comercios.ts:26-29` la vende como *"un validador gratis y
determinista sobre lo que leyó la visión. Verificado en Office Depot, cuyo campo
de ITU es `maxlength="30"`: una lectura de 31 caracteres es demostrablemente
inválida sin necesidad de volver a mirar la foto."*

**Escenario, con valores.** El OCR lee el ITU de un ticket de Office Depot con 31
caracteres. El catálogo dice `{ largoMax: 30, mayusculas: true }` en la línea 288.
Nadie compara las dos cosas: el gasto entra tal cual, el operador teclea 31
caracteres en un portal que acepta 30, y el CFDI no se emite. El validador que el
comentario describe existe como esquema y no como código.

**Intenté refutarlo:** los hermanos de este mismo registro **sí** están
conectados —`plazoVerificado` lo lee `engine.ts:482,505,511` y `etiquetaPortal`
lo lee `engine.ts:520`—, así que no es un módulo entero desconectado, es un campo
concreto del contrato que quedó sin lector.

**Consecuencia.** Para quien mantenga el catálogo: al leer las etiquetas del
portal 38 va a rellenar `restriccion` creyendo que sirve para algo, porque el
comentario lo afirma y hay un precedente en la línea 288.

**Causa raíz probable:** el esquema del catálogo se diseñó completo de una vez,
y el consumidor de una de sus partes se pospuso sin dejar marca de que faltaba.

---

## Lo que revisé y está bien

- **`formato.ts` es el único origen, verificado contando.** 1 definición de
  `mxn` (`formato.ts:37`), 1 de `litros` (`formato.ts:53`), 1 de `fechaMx`
  (`formato.ts:70`), 1 de `usd` (`formato.ts:42`). Las ocho copias de `mxn` de la
  ronda 7 se **borraron**; `utils.ts:12` y `app/dashboard/formato.ts:27`
  reexportan en vez de redefinir. Cero `import` en `formato.ts`, que era la razón
  declarada de no meterlo en `utils.ts`. Cierre por mecanismo, no por
  sincronización: la única forma que este rubro acepta.
- **El reincidente x4 de los litros está cerrado.** `resumen.ts:83` llama
  `litros(...)`; `acreditable.ts:17` importa `litros as fmtLitros`. Los tres
  canales pasan por la misma fórmula. El escenario `1,850.5 L` vs `1850.5 L` ya
  no se puede producir.
- **`CLAVES_PEAJE` dejó de estar duplicada.** `concepto.ts:27` la define,
  `config.ts:15` la importa y `config.ts:101` la usa (`clavesPeaje: CLAVES_PEAJE`),
  con el comentario `config.ts:97-100` explicando que estaba escrita a mano en los
  dos sitios. Mi BAJO de la ronda 7, cerrado.
- **`politica_gasto` ya no tiene lector.** `repo.ts:82-88` es hoy el hueco
  documentado donde vivía `getPolitica`; `grep -rn "getPolitica\|politica_gasto" src`
  no devuelve una sola llamada en producción. `0032_politica_gasto_muerta.sql`
  pone el `comment on table`. Mi MEDIO de tres rondas, cerrado por borrado.
- **`ESTATUS` duplicado, cerrado por prueba.** `dashboard/page.tsx:14-18` y
  `dashboard/[id]/page.tsx:25-29` siguen siendo dos copias, pero
  `etiquetas_sincronizadas.test.ts:93-113` compara ahora las dos —claves,
  etiquetas y colores— y además exige que cubran todo `EstatusLiquidacion`. Es
  más débil que borrar una copia, pero cierra el modo de falla. Mi BAJO de la
  ronda 7, atendido.
- **La ruta del PDF del operador, escrita en dos archivos, tiene guardarraíl.**
  `tools.ts:177` sube a `${ctx.tenantId}/${ctx.viajeId}-operador.pdf` y
  `processor.ts:879` reconstruye `${op.tenantId}/${viajeId}-operador.pdf` a mano
  (la tool devuelve `pdf_generado: boolean` y tira la ruta). Iba a reportarlo y
  **existe `ruta_pdf_sincronizada.test.ts`**, que normaliza las dos plantillas a
  `{}/{}-operador.pdf` y falla si divergen. Refutado, con razón.
- **El motor sigue puro.** Dos búsquedas sobre `cuadre/`, `normas/`, `laboral/`,
  `liquidacion/`, `facturacion/`, `periodo/`: cero `Date.now(`, `process.env`,
  `Math.random`, `randomUUID`, `fetch(`, `supabaseAdmin`. El único `new Date()` de
  toda esa zona está en `desde_db.ts:17,36`, que es el adaptador de frontera y no
  el motor. `engine.ts` importa exactamente dos cosas: los tipos y `mxn`.
- **Las dependencias apuntan en la dirección correcta.** Recorrí los imports
  absolutos de los seis directorios del motor: solo `@/types/cuadra`,
  `@/lib/formato`, `@/lib/logger` y librerías externas. Nada bajo `cuadra/*/`
  importa de `app/`, de `repo.ts`, de `processor.ts` ni de `conv.ts`. `guardia.ts:24`
  importa `ToolCallRecord` de `@/lib/llm/openrouter` y es `import type`.
- **El criterio fiscal no está duplicado.** Reverificado: `acreditable.ts` y
  `deducibilidad.ts` consumen `cubetaDe` y campos ya calculados de `engine.ts`;
  `analytics.ts:136-143` suma **columnas persistidas**
  (`ieps_acreditable`, `iva_acreditable`, `peaje_acreditable`,
  `litros_diesel_acreditables`) sin recalcular nada; `detectarAnomalias`
  (`analytics.ts:106-123`) delega en `duplicados.ts` puro. Este es el motivo
  concreto por el que la nota no baja a 4.
- **Los catálogos son datos, no código — el encargo explícito de esta ronda.**
  `comercios.ts`: 742 líneas, 37 entradas, **una** función (`comercio()`, línea
  740, un `find`); ningún `if`, `switch` ni `map` de lógica. `permisos_cre.json`:
  mapa plano `permiso → marca`, sin estructura anidada.
  `normas/indice.ts` con su `ficha:` apuntando a los YAML de `normas/`. La regla
  se respetó.
- **La lista de motivos de fallo de OCR tiene un solo origen.** `ocr.ts:153`
  (`MOTIVOS_FALLO`) y `ocr.ts:154` deriva el tipo de ella; el prompt de
  `ocr.ts:94` no reenumera los motivos, y `decidir.ts:27,32` compara contra los
  valores del tipo. `c56dfbd` hizo lo que dice.
- **`etiquetaConcepto` sigue con una sola definición.** `engine.ts:819` y
  `engine.ts:829` (el mapa `label`); `pdf.ts:202` la importa
  (`grep -rn "CONCEPTO_LABEL" src` → dos hits, ninguno es definición).
  `etiquetas_sincronizadas.test.ts:39-44` impide que el mapa vuelva al PDF, y
  `:57-66` exige que el motor cubra todo `ConceptoGasto`. El ejemplo canónico del
  rubro sigue muerto, como pedía el encargo.
- **El cambio de dominio se hizo con una sola verdad.** `openrouter.ts:31` usa
  `process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai'`, `.env.example` lo
  documenta, y `dominio_propio.test.ts` prohíbe `cuadra.mx` y
  `transportesinnovativos.mx` en fuente **y** en `seed.sql`, ignorando comentarios
  vía `sinComentarios()`. Es el mecanismo correcto — con el agujero que reporto
  como CRÍTICO: vigila dominios, no el nombre del producto.

## Lo que NO alcancé a revisar

- **`conv.ts` por dentro, cuarta ronda que lo dejo.** Lo conté para la frontera y
  abrí tres funciones, pero no audité su semántica. Vi algo que **no es mío**
  —`conv.ts:143`, `getTenantContext` desestructura solo `{ data }` y sin
  comprobar `error` cae a `nombreFlota: 'la flota'`, que huele al sexto caso del
  patrón que el MAPA cataloga cinco veces— y lo dejo escrito aquí para quien
  lleve agéntico o backend, sin reclamarlo como hallazgo de arquitectura.
- **`processor.ts` (>900 líneas)** — no evalué si sus responsabilidades
  justifican un solo archivo. Tercera ronda pendiente.
- **`verificaciones.sql` (+409 líneas esta ronda)** — no lo crucé contra
  `startup.ts` para ver si los dos afirman lo mismo sobre qué migraciones existen.
  Es un candidato claro a dos verdades sobre el esquema.
- **Las 36 migraciones entre sí** — no verifiqué si alguna redefine lo que otra
  ya declaraba (p. ej. los dominios de `0025` contra los checks de `0026`).
- **`normas/indice.ts` (22 fichas) contra los YAML de `normas/`** — no comprobé
  si el índice en TypeScript y las fichas en YAML pueden divergir sin que nada
  falle. Es el mismo patrón de "dos copias de un catálogo" en un sitio que no
  toqué.
- **No leí los reportes de los otros auditores de esta ronda.** Probable solape
  con pruebas (el assert que falta en `omitidos.test.ts:89-94`) y con frontend o
  legal (el nombre del producto en el PDF).
