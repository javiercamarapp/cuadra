# Arquitectura y mantenibilidad — auditoría 5

**Nota: 5/10** (antes 4). Razón: **se atacó y subió**, con freno. Tres de los cuatro
hallazgos de la ronda 4 se cerraron **por mecanismo, no a mano**: `pdf.ts` ya no
reconstruye la clasificación de dinero (importa `cubetaDe` del motor), los litros de
diésel llegaron a `resumen.ts` y al `select` del detalle, `config.portales` se borró,
`facturacion/` se cableó y el concepto `flete` nació con su prueba de sincronía. Eso
saca al rubro del ancla del 4 —"la misma lógica de dinero vive en más de un
archivo"—: hoy la clasificación en cubetas vive en un solo sitio.

Lo que impide el 6 es que las fugas conocidas ya no son "dos o tres": el
**ejemplo canónico del rubro volvió a ocurrir por TERCERA vez**, ahora entre
`etiquetaConcepto` y el mapa del panel, **con el test que existe para impedirlo en
verde**; y la frontera de `repo.ts` va por su **cuarta ronda**, con más sitios de
consulta que en la ronda 4 (49 contra 43), no menos.

**El riesgo mayor hoy:** el mecanismo antifuga más citado del repo
(`etiquetas_sincronizadas.test.ts`) pasa verde sobre una divergencia que ya existe en
pantalla — el papel dice "Combustible Magna" y el panel dice "Diésel" del mismo
comprobante — porque el test compara el mapa que el PDF **ya no usa**.

---

## Hallazgos

### [ALTO] Las etiquetas de concepto divergieron por tercera vez, y el test que las vigila está verde
`src/lib/cuadra/cuadre/engine.ts:680-687` (`etiquetaConcepto`) ·
`src/lib/cuadra/liquidacion/pdf.ts:200` · `src/app/dashboard/[id]/page.tsx:15-19,107` ·
`src/lib/cuadra/etiquetas_sincronizadas.test.ts:36,39-44,50-55` ·
`src/lib/cuadra/analytics.ts:143`

**(REINCIDENTE — tercera ocurrencia del ejemplo canónico del rubro.)** La primera fue
`viaticos` partido en tres; la segunda, `otro: 'Gasto'` contra `otro: 'Otro'`.

El arreglo de la ronda 4 borró `CONCEPTO_LABEL` del PDF y lo hizo importar
`etiquetaConcepto`. Pero `etiquetaConcepto` **no es** `label()`: para `diesel`
(engine.ts:681) se salta el mapa entero y devuelve el producto impreso del ticket. El
panel sigue con su copia literal del mapa. El test compara `label()` contra el mapa del
panel —los dos idénticos, verde— y aparte verifica que el PDF *contenga la cadena*
`etiquetaConcepto`. Ninguna de las dos asserts puede ver la rama que sí se ejecuta.

**Escenario, corrido contra el módulo real** (`npx tsx`, importando `engine.ts` del
repo, contra el mapa literal copiado de `page.tsx:15-19`):

```
producto=PLUS     | PDF/WhatsApp: Combustible Plus     | Panel: Diésel   | DISTINTO
producto=MAGNA    | PDF/WhatsApp: Combustible Magna    | Panel: Diésel   | DISTINTO
producto=—        | PDF/WhatsApp: Combustible          | Panel: Diésel   | DISTINTO
producto=DIESEL   | PDF/WhatsApp: Diésel               | Panel: Diésel   | igual
```

`ocrExtra.producto` lo llena el extractor en **todo** ticket (`intake/ocr.ts:340`), así
que la tercera fila —sin producto legible— hace que **cualquier** comprobante de
combustible discrepe entre el papel y la pantalla, no solo los de gasolina. Y el panel
no puede alinearse aunque quiera: `analytics.ts:143` pide `concepto, monto, folio` y
**no trae `ocr_extra`**.

**Consecuencia.** Para el contralor: el PDF archivado dice "Combustible Magna $1,240" y
el renglón del panel de esa misma liquidación dice "Diésel $1,240". Y es exactamente la
lectura que `engine.ts:667-678` documenta querer evitar —"un ticket real de PLUS salía
etiquetado 'Diésel', y eso invita a reclamar un estímulo que NO aplica: el de IEPS es
solo diésel (LIF 20-A fr. IV)"—: el arreglo movió ese error del PDF al panel. Para el
equipo es peor que el bug: es un test verde que apaga la sospecha sobre el único
mecanismo antifuga del repo.

**Causa raíz.** El test valida una *forma* (que el PDF importe un símbolo) en vez de la
*salida* (que las tres superficies produzcan la misma cadena para el mismo gasto).

### [ALTO] `politica_gasto` es el segundo catálogo que sobrevivió al borrado de `config.portales` — y el seed instruye a usarlo
`src/lib/cuadra/repo.ts:21-33` (`getPolitica`) ·
`supabase/migrations/0001_init.sql:38-45` · `supabase/seed.sql:60-72` ·
`src/lib/cuadra/config.ts:8,57-67` · `src/lib/cuadra/cuadre/desde_db.ts:25`

Tiene la forma exacta de `config.portales`: **tabla propia, seed propio, tipo propio y
función de búsqueda propia, y cero lectores**. `getPolitica` aparece en **un solo
archivo de todo `src/`** — el que la define (verificado con dos métodos: `grep -rnw` y
`find | xargs grep`). Nadie la importa, ningún test la toca, y nada escribe en
`politica_gasto`. El motor toma la política de `config.politica` (`desde_db.ts:25`), que
sale de `DEMO_CONFIG` fusionado con `tenant.config` jsonb.

**Y ya divergió.** El seed sigue en el concepto heredado:

| `politica_gasto` (seed.sql:67-71) | `DEMO_CONFIG.politica` (config.ts:57-67) |
|---|---|
| diesel 4000 · caseta 1500 · **viaticos 800** · factura CFDI | diesel 4000 · caseta 1500 · **alimentacion 800 · hospedaje 2500 · transporte 800 · flete (sin tope)** · factura CFDI |

Le faltan los cuatro conceptos que existen desde que se partió `viaticos` y desde que
nació `flete`. Ninguna prueba lo mira.

**Escenario, 6-ago en la sala.** `seed.sql:63` afirma, en mayúsculas de bloque, *"El
motor de cuadre usa `tope_monto` por comprobante y `requiere_cfdi`"* y *"AJUSTA cada
tope con la política real"*. Alguien abre la consola de Supabase y captura la política de
Innovativos donde el propio seed dice que va: `update politica_gasto set tope_monto=500
where concepto='alimentacion'`. El motor sigue con los $800 de `DEMO_CONFIG`; una comida
de $650 no levanta `sobre_politica` y el contralor ve "cuadra exacto" sobre un gasto que
su propia política rechaza. No hay error en ningún log: la tabla se escribió bien, solo
que nadie la lee. `config.ts:8` documenta el camino correcto (`tenant.config` jsonb) y
contradice al seed sin que ninguno de los dos lo sepa.

**Consecuencia.** Dos documentos del repo dan instrucciones incompatibles para el acto
que define el demo —capturar la política del cliente en vivo— a nueve días de la
demostración.

**Causa raíz.** La configuración migró de tabla relacional a jsonb y se dejó la tabla,
su seed y su lector muerto en el árbol, igual que había pasado con `config.portales`.

### [ALTO] El nombre de cada tool vive en 21 literales sueltos, y `toolSchemas` descarta en silencio el que no reconoce
`src/lib/llm/tool-executor.ts:35-39` · `src/lib/agents/types.ts:11` (`tools: string[]`) ·
`src/lib/agents/registry.ts:21` · `src/lib/cuadra/tools.ts:25,29,43,47,101,106` ·
`src/lib/agents/prompts.ts:22,23,24,27,31` ·
`src/lib/cuadra/cuadre/guardia.ts:38,40` ·
`src/lib/cuadra/processor.ts:545,548,582,673` ·
`src/lib/agents/prompts.test.ts:18-22`

Tres tools, **21 apariciones** de sus nombres como cadenas libres, repartidas en cinco
capas: el registro por efecto colateral (`tools.ts`), el catálogo del agente
(`registry.ts`, tipado `string[]`), el prompt en prosa, la guardia determinística y el
processor. Ninguna está ligada a otra por el tipo. Y el punto de unión es
**silencioso**:

```ts
// tool-executor.ts:35-39
export function toolSchemas(names: string[]) {
  return names.map((n) => REGISTRY.get(n)?.schema).filter(Boolean);
}
```

**Escenario.** Se renombra la tool a `cerrar_liquidacion` en `tools.ts:101,106` (por
ejemplo, al añadir una segunda tool de cierre). `npx tsc --noEmit` pasa: todo son
strings. `npm test` pasa los 628: `prompts.test.ts:18-22` solo comprueba la **ausencia**
de dos nombres obsoletos (`extraer_comprobante`, `validar_cfdi`) y la presencia del
literal en el prompt, que no cambió. En producción, `toolSchemas` devuelve **2 schemas
en vez de 3** sin un log; el modelo recibe un prompt que le ordena en el paso 3 llamar
una tool que no le fue ofrecida; `processor.ts:545` deja `closed = false`; el viaje
queda abierto y el operador nunca recibe su PDF.

**Consecuencia.** Es el mismo modo de falla que ya cobró factura esta semana —`flete` en
el prompt y no en el esquema: *una instrucción imposible no falla, degrada*— sobre el
camino del cierre del dinero en vez de sobre un concepto de gasto. Para el equipo, la
única defensa que existe es acordarse de los cinco sitios.

**Causa raíz.** `AgentConfig.tools` es `string[]` en vez de la unión de los nombres
registrados, y el resolvedor filtra los desconocidos en lugar de lanzar.

### [ALTO, REINCIDENTE — CUARTA RONDA] El acceso a datos sigue fuera de `repo.ts`, y esta ronda creció
`src/app/dashboard/page.tsx:27-42` · `src/lib/cuadra/analytics.ts:21,109,135` ·
`src/app/api/export/liquidaciones/route.ts:22` · `src/lib/cuadra/repo.ts` ·
`docs/auditoria-5/MAPA.md:71`

Conteo de consultas Supabase reales (`.from('` + `.rpc('`) en código de producción, hoy:

| archivo | consultas |
|---|--:|
| `src/lib/cuadra/repo.ts` | 16 |
| `src/lib/cuadra/conv.ts` | 11 |
| `src/lib/cuadra/analytics.ts` | 8 |
| `src/lib/cuadra/startup.ts` | 5 |
| `src/lib/cuadra/costos.ts` | 3 |
| `config.ts` · `tools.ts` · `processor.ts` · `auth/session.ts` · `dashboard/page.tsx` · `export/liquidaciones/route.ts` | 1 c/u |
| **total** | **49** |

`repo.ts` concentra **16 de 49**. La ronda 4 midió 16 de 43: en 33 commits la frontera
se **ensanchó**. `MAPA.md:71` sigue afirmando "`repo.ts` es TODO el acceso a datos".

Sobre la sola tabla `liquidacion` hay **cinco listas de columnas escritas a mano en
cuatro archivos** (`analytics.ts:22,110,136`, `dashboard/page.tsx:29`,
`export/.../route.ts:23`) y **ninguna en `repo.ts`**, que a esa tabla solo escribe por
RPC (`repo.ts:326`). `getLiquidacionDetalle` (`analytics.ts:136`) ya trae
`litros_diesel_acreditables` —eso se arregló—, pero por la misma razón por la que le
faltaba: alguien tuvo que acordarse de una quinta lista.

**Escenario.** Es la misma mecánica que produjo el hallazgo A de esta ronda: el detalle
del panel no puede mostrar el producto del combustible porque su `select`
(`analytics.ts:143`) no pide `ocr_extra`, y no hay un solo lugar donde arreglarlo para
todos.

**Consecuencia.** Cada cambio de significado de una columna es una búsqueda manual en
cinco sitios, y el síntoma de olvidar uno es una pantalla que calla, no un error.

**Causa raíz.** No existe capa de lectura: `repo.ts` cubre el camino de WhatsApp y el
panel se sirve solo.

### [MEDIO] `/api/demo` corre el mismo motor con otra configuración: cinco reglas fiscales no corren
`src/app/api/demo/route.ts:19-27,41` · `src/lib/cuadra/config.ts:57-67` ·
`src/lib/cuadra/cuadre/desde_db.ts:21-37` · `src/app/demo/page.tsx:46,59-62`

La ruta del demo interactivo declara **su propia copia** de la política (tercera del
repo) y llama `cuadrarViaje` **sin** `estimulos`, **sin** `hidrocarburos`, **sin** `hoy`
y **sin** `empresaRfc`. En el motor, cada uno de esos parámetros es la llave de una
regla: sin `estimulos` no corre el tope diario de LISR 28-V ni el peaje al 50% ni los
litros de diésel; sin `hidrocarburos` no corre el complemento; sin `hoy` no corren ni el
aviso de factura por vencer ni la detección de ejercicio ajeno.

**Escenario, corrido con el motor real** — tres comidas de $400 el mismo día, timbradas,
misma política:

```
/api/demo   → totalDeducible 1200 · noDeducible    0 · diferencias: alimentacion_sin_soporte ×3
WhatsApp    → totalDeducible  750 · noDeducible  450 · diferencias: alimentacion_sin_soporte ×3
                                                                  + viatico_excede_fiscal
                "Alimentación del 2026-07-20: $1,200.00 (3 comprobantes del día) excede
                 el tope fiscal de $750.00 por día (LISR 28-V) — el excedente de $450.00
                 no es deducible."
```

`demo/page.tsx:59-62` pinta las `nota` de las diferencias tal cual, así que esa frase
—la regla insignia del producto— simplemente no aparece. Los comprobantes precargados de
hoy (diésel, caseta, factura) no tocan el caso, así que **no es un bug visible hoy**;
basta añadir un botón de alimentación para que lo sea.

**Consecuencia.** Dos superficies del mismo producto dan cifras distintas sobre los
mismos hechos, y la que un prospecto puede tocar sin credenciales es la que se queda
corta.

**Causa raíz.** La ruta se escribió antes de que `getConfig`/`desde_db` existieran y se
quedó armando su propio `CuadreInput` a mano.

### [MEDIO] Catorce lugares definen o subclasifican la lista de conceptos; nueve no tienen prueba de sincronía, y cuatro de esos deciden dinero
`src/types/cuadra.ts:20-25` · `src/lib/cuadra/cuadre/engine.ts:62,421,458,680,690` ·
`src/lib/cuadra/laboral/pagadero.ts:42` · `src/lib/cuadra/config.ts:57-67,75-82` ·
`src/app/api/demo/route.ts:19-27` · `supabase/seed.sql:67-71` ·
`src/lib/cuadra/repo.ts:424` · `src/lib/cuadra/analytics.ts:55`

El inventario completo está abajo. Lo que importa aquí son las **subclasificaciones
semánticas**, que no son mapas de etiquetas sino reglas fiscales escritas como arrays
literales y que ninguna prueba de sincronía cubre:

```ts
engine.ts:62   const ES_VIATICO = ['alimentacion', 'hospedaje', 'transporte', 'viaticos'];
engine.ts:421  vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
engine.ts:458  const conTope = (c) => c === 'alimentacion' || c === 'viaticos';
pagadero.ts:42 const OBLIGACION_263 = new Set(['hospedaje', 'alimentacion']);
```

**Escenario.** Se añade `casetas_urbanas` a `ConceptoGasto` (hoy el prompt lo mete a
`transporte`, `ocr.ts:78`). `etiquetas_sincronizadas.test.ts` y
`conceptos_coinciden.test.ts` **fallan en rojo** y obligan a tocar el esquema, el prompt,
`label()` y el mapa del panel — ese mecanismo funciona. Pero las cuatro líneas de arriba
quedan sin él, en verde: el concepto nuevo no ampara un viático de alimentos
(engine.ts:421), no lleva el tope de RLISR 57 (engine.ts:255), no entra en la obligación
del patrón del art. 263-I (pagadero.ts:42), y `repo.ts:424` no lo cuenta contra el 15%
de la RFA 2.9. Cuatro decisiones fiscales tomadas por omisión.

Es la misma anatomía del fallo de `flete` que se arregló esta semana, un nivel más abajo:
las listas visibles ya están atadas; las que deciden **qué significa** cada concepto, no.

**Consecuencia.** El costo de añadir un concepto es hoy "toca cinco sitios que el test te
señala y cuatro que no te señala nadie".

**Causa raíz.** El mecanismo de sincronía se construyó sobre las etiquetas (lo que se
ve) y no sobre las clasificaciones (lo que decide).

### [MEDIO, REINCIDENTE — TERCERA RONDA] `tools.ts` tiene lógica de negocio y sigue sin una sola prueba
`src/lib/cuadra/tools.ts:79,127,138-139,143`

`ls src/lib/cuadra/tools*` devuelve **solo `tools.ts`**; no hay `tools.test.ts` entre los
64 archivos de prueba. Y desde la ronda 4 el archivo **creció**: además de la regla de
`rfa-2026-2.9` (línea 79) ahora arma la capa de periodo, decide qué normas puede citar el
agente y genera **dos** ejemplares del PDF con destinatarios distintos (líneas 138-139),
que es la defensa de `SOLO_CONTRALOR` en el canal del adjunto.

```ts
tools.ts:79  if (periodo && periodo.estado !== 'holgado' && !fundamentos.includes('rfa-2026-2.9'))
               fundamentos.push('rfa-2026-2.9');
```

**Escenario.** Alguien invierte la condición de `estado !== 'holgado'` o borra la línea
139 (el PDF del operador). El motor, el PDF, la guardia y las normas siguen verdes: los
628 tests no ejecutan `tools.ts`. El síntoma sería que al chofer le llega, por adjunto,
el veredicto de que su proveedor está en la lista negra del SAT — lo que `resumen.ts`
filtra a propósito del texto.

**Consecuencia.** El único archivo que decide qué se le entrega a quién no tiene arnés.
`normas/por_diferencia.ts` sigue siendo el contraejemplo: puro, con prueba exhaustiva y
lista `SIN_NORMA` explícita.

### [MEDIO] `startup.ts` anuncia que verifica la migración 0019 y no la verifica
`src/lib/cuadra/startup.ts:93-103` · `supabase/migrations/0019_gasto_cfdi_uuid_unico.sql`

El comentario dice literal: *"Las **dos** migraciones nuevas del camino del dinero. La
0017 hace el merge de ocr_extra con claim…; **la 0019 impide que el mismo CFDI se
liquide dos veces**."* Debajo hay **un solo** probe (`enriquecer_gasto_codigo`, línea
96) y, si pasa, `logger.info('startup.migraciones', { ok: true })` en la línea 103.

**Escenario.** Se despliega contra una base a la que le falta la 0019 (el índice
`uq_gasto_cfdi_uuid`). El arranque escribe `ok: true`. Dos fotos de la misma factura de
$8,100 en la misma ráfaga de WhatsApp corren en paralelo; la defensa de aplicación es
read-then-write —el propio SQL de la 0019 lo explica— y entre el "¿ya existe?" y el
INSERT cabe el otro INSERT. El total comprobado sube $8,100 de dinero que no se gastó, y
el aviso que existe para avisarlo dijo que todo estaba bien.

**Consecuencia.** Un chequeo que declara cobertura que no tiene es peor que no tenerlo:
la próxima vez que alguien lea `startup.migraciones ok: true` va a creerle. Tampoco se
prueban la 0013 (`guardar_liquidacion_tx`, la RPC que escribe el dinero) ni la 0018.

**Causa raíz.** El comentario se actualizó al añadir la migración y el probe no.

### [BAJO] Siete exportados sin ningún consumidor, tres de ellos reincidentes
Verificado con dos métodos (`grep -rnw` sobre `src/` y `find | xargs grep`), contando
también los tests:

| símbolo | archivo:línea | consumidores | nota |
|---|---|--:|---|
| `getPolitica` | `repo.ts:21` | 0 | ver hallazgo del segundo catálogo |
| `getStatsPorOperador` | `analytics.ts:51` | 0 | hace 3 consultas a Supabase |
| `getResumenCosto` | `costos.ts:79` | 0 | el margen real del negocio, sin lector |
| `citaDe` | `normas/indice.ts:271` | 0 | |
| `getSessionTenant` | `auth/session.ts:11` | 0 | consulta Supabase fuera de `repo.ts` |
| `generateResponse` | `llm/openrouter.ts:122` | 0 | |
| `topeDescuento` | `laboral/pagadero.ts:123` | solo su test | **REINCIDENTE** |
| `catalogoCuentas` | `config.ts:31,75-82` | solo `config_merge.test.ts` | **REINCIDENTE** |
| `LEYENDA_INLINE` | `cuadre/leyendas.ts:25` | 0 | **REINCIDENTE** |
| `comercio()`, `RestriccionCampo`, `requiereCuenta`, `ClaveCampo` | `facturacion/comercios.ts:31,41,57,295` | solo `identificar.test.ts` | el encabezado del archivo (líneas 15-17) promete un extractor "dirigido por comercio"; `intake/ocr.ts` no importa `COMERCIOS` |

`topeDescuento` es el que pesa: calcula los dos topes del art. 110 fr. I —el saldo
exigible y el 30% **del excedente** del salario mínimo— que es justo lo que impide
imprimir un neto ilegal, y no lo llama nadie. `veredictoLaboral`, que la ronda 4 marcó
igual, **sí se cerró**: `resumenLaboral` lo consume (`pagadero.ts:186`) y llega al PDF.

### [BAJO] `CLAVES_PEAJE` está escrita dos veces
`src/lib/cuadra/intake/concepto.ts:27` · `src/lib/cuadra/config.ts:99`

Las mismas dos claves del SAT (`95111602`, `95111603`), con el mismo comentario largo
sobre por qué `93151505` queda fuera, en dos archivos. Hoy es inerte —`processor.ts:432`
pasa `cfg.estimulos.clavesPeaje`, así que el default de `concepto.ts` solo lo usan los
tests— pero es una lista exportada que puede quedarse atrás sin que nada falle. Si
alguien añade una clave a `config.ts` y no a `concepto.ts`, el test de `concepto.ts`
sigue verde probando la lista vieja.

### [BAJO] El identificador que imprime el PDF no existe en la base
`src/lib/cuadra/tools.ts:127,143` · `src/lib/cuadra/liquidacion/pdf.ts:73,150` ·
`src/lib/cuadra/analytics.ts:148` · `supabase/migrations/0001_init.sql:52` (`folio text`, nulable)

`tools.ts:127` fabrica `id: randomUUID()` para armar el objeto que va al PDF; el id real
lo devuelve la base en `saveLiquidacion` (línea 143) y es **otro**. El PDF cae en ese id
solo cuando `viaje.folio` es nulo (`pdf.ts:73,150`), y `folio` es nulable en el esquema.
El panel usa el id real (`analytics.ts:148`).

**Escenario.** Se abre un viaje a mano en la consola de Supabase sin folio (no hay
ninguna ruta de aplicación que cree viajes: solo `seed.sql` y `verificaciones.sql`, y
este último inserta **sin folio**). El PDF encabeza `Folio 3F9A2C71`, el panel lista
`Folio 8B04D1E0`, y no hay forma de cruzarlos. Latente porque el seed del demo sí pone
folio.

---

## Inventario: cuántas copias hay de cada verdad

### La lista de conceptos de gasto

| # | dónde | qué es | ¿prueba de sincronía? |
|--:|---|---|---|
| 0 | `types/cuadra.ts:20-25` | `ConceptoGasto` — **la fuente** | — |
| 1 | `intake/ocr.ts:26` | `CONCEPTOS_OCR` (enum zod) | **SÍ** — `conceptos_coinciden.test.ts:20-24`, falla en compilación |
| 2 | `intake/ocr.ts:78` | texto del prompt | **parcial** — `conceptos_coinciden.test.ts:26-33` solo comprueba `toContain`; un concepto de más en el prompt (el fallo de `flete`, al revés) no lo caza |
| 3 | `cuadre/engine.ts:690` | `label()` | **SÍ** — `etiquetas_sincronizadas.test.ts:46-66` |
| 4 | `app/dashboard/[id]/page.tsx:15-19` | `CONCEPTO` | **SÍ** — mismo test |
| 5 | `cuadre/engine.ts:680-687` | `etiquetaConcepto` (sobrescribe `diesel`) | **NO** — **ya divergió** |
| 6 | `cuadre/engine.ts:62` | `ES_VIATICO` (RLISR 57) | **NO** |
| 7 | `cuadre/engine.ts:421` | `haySoporte` (LISR 28-V) | parcial — `flete_no_ampara.test.ts` cubre un caso, no la lista |
| 8 | `cuadre/engine.ts:458` | `conTope` (tope diario) | **NO** |
| 9 | `laboral/pagadero.ts:42` | `OBLIGACION_263` (LFT 263-I) | **NO** |
| 10 | `config.ts:57-67` | `DEMO_CONFIG.politica` | **NO** |
| 11 | `config.ts:75-82` | `catalogoCuentas` | **NO** — y cero consumidores |
| 12 | `app/api/demo/route.ts:19-27` | `POLITICA` | **NO** |
| 13 | `supabase/seed.sql:67-71` | filas de `politica_gasto` | **NO** — **ya divergió** (`viaticos`, sin `flete`) |
| 14 | `repo.ts:424` · `analytics.ts:55` | `.eq('concepto','diesel')` | **NO** |

**Catorce copias. Tres con prueba completa, dos parciales, nueve sin nada. Dos ya
divergieron.**

### El resto

| verdad | dónde vive | ¿sincronía? |
|---|---|---|
| Política de gastos de la flota | `config.ts:57-67` · `api/demo/route.ts:19-27` · `politica_gasto` (tabla+seed+`repo.getPolitica`) | **NO** — tres copias, la tercera muerta y divergida |
| Nombres de las tools | `tools.ts` (×6) · `registry.ts:21` · `prompts.ts` (×5) · `guardia.ts` (×2) · `processor.ts` (×4) — 21 literales | **NO** — `prompts.test.ts:18-22` solo veta dos nombres obsoletos |
| Columnas de `liquidacion` | `analytics.ts:22,110,136` · `dashboard/page.tsx:29` · `export/.../route.ts:23` | **NO** — cinco listas, ninguna en `repo.ts` |
| Claves SAT de peaje | `intake/concepto.ts:27` · `config.ts:99` | **NO** |
| Claves SAT de combustible | `config.ts:86,94` (una sola lista, parametrizada) | **N/A** — bien: un solo sitio |
| `maxDuration` ↔ presupuesto | `webhook/route.ts` · `presupuesto.ts:PRESUPUESTO_WEBHOOK_MS` | **SÍ** — `presupuesto_camino.test.ts`. **El patrón correcto.** |
| Fichas de normas ↔ YAML | `normas/indice.ts` ↔ `normas/*.yaml` | **SÍ** — `normas_sincronizadas.test.ts` |
| Etiquetas de estatus | `dashboard/page.tsx` · `dashboard/[id]/page.tsx` | **SÍ** — `etiquetas_sincronizadas.test.ts:93-113` |
| Clasificación en cubetas de deducibilidad | `engine.ts:85-95` (`cubetaDe`), importada por `pdf.ts:319` | **N/A** — un solo sitio. **Cerrado esta ronda.** |
| Etiqueta de concepto en el PDF | `pdf.ts` importa `etiquetaConcepto` | parcialmente cerrado — ver hallazgo ALTO |

---

## Lo que revisé y está bien

- **El hallazgo A de la ronda 4 está cerrado, y por mecanismo.** `cubetaDe`
  (`engine.ts:85-95`) es hoy la única definición de en qué cubeta cae un gasto, está
  exportada con un comentario que explica exactamente por qué, y `pdf.ts:319` la importa
  en vez de reconstruirla desde `diferencias`. La sección "LO QUE SE LE REEMBOLSA AL
  OPERADOR" ya no depende de un flag de política. Es el arreglo correcto de fondo, no un
  parche, y es lo que saca al rubro del ancla del 4.
- **El hallazgo B de la ronda 4 está cerrado en los dos consumidores que faltaban.**
  `resumen.ts:78-83` emite los litros de diésel al mensaje de WhatsApp (y el comentario
  documenta que la rama muerta del IEPS se borró), y `analytics.ts:136,158` ya pide
  `litros_diesel_acreditables` en el `select` del detalle. El panel lo pinta en
  `[id]/page.tsx:76`.
- **`facturacion/` está cableada.** `identificarComercio` y `calcularCaducidad` se llaman
  desde `engine.ts:351,373`; el módulo dejó de ser código escrito, probado y sin llamar.
  Y el borrado de `config.portales` se hizo bien: `comercios.ts:247-259` documenta qué se
  conservó de la tabla vieja y qué se descartó y **por qué** (los `campos` con llaves
  nuestras, el `includes('arco')` que casaba con "MARCO", el `plazoHoras: 72` sin
  verificar). Es el modelo de cómo se borra un catálogo duplicado.
- **`flete` nació con su mecanismo.** `conceptos_coinciden.test.ts` ata el enum zod, el
  prompt y el tipo del dominio, y el encabezado del archivo transcribe el fallo real que
  lo motivó. Sobre las listas *visibles* de conceptos, el problema está cerrado.
- **El motor sigue siendo puro, incluso después de absorber `facturacion/`.** Dos
  búsquedas independientes sobre `cuadre/`, `normas/`, `periodo/`, `laboral/`,
  `liquidacion/` y `facturacion/`: **cero** `Date.now()`, `process.env`, `Math.random`,
  `randomUUID`, `fetch(` o `supabaseAdmin`. Los únicos `new Date()` sin argumento están
  en `desde_db.ts:17,36` — el borde, donde deben estar. Los de `caducidad.ts:40,57` y
  `pdf.ts:49` reciben argumento: son parseo determinístico, no lectura de reloj. Sigue
  siendo la mejor propiedad arquitectónica del repo.
- **`presupuesto.ts` es el patrón correcto de sincronía entre dos sitios que no se pueden
  importar** (Next exige `maxDuration` literal): una constante con el comentario que
  explica el acoplamiento y un test que compara los dos números. Es lo que le falta a
  `etiquetaConcepto` y a los nombres de tools.
- **`normas/por_diferencia.ts` e `indice.ts`** siguen siendo el buen patrón: puros, con
  test contra los YAML y lista `SIN_NORMA` explícita que convierte el olvido en decisión
  declarada.
- **La idempotencia de mutaciones** (`tool-executor.ts:74-95`) tiene la llave correcta —
  el nombre y no los args — con el comentario que explica en qué condición habría que
  cambiarla. Buena documentación de un acoplamiento futuro.
- **Línea base intacta:** `npx vitest run` → **64 archivos, 628 tests, 1 saltado, todos
  verdes** (9.76 s). No modifiqué ningún archivo del repo; los scripts de reproducción
  viven en el scratchpad (`repro_etiqueta.ts`, `repro_demo.ts`, `muertos.sh`).
- Nota menor de inventario: `supabase/migrations/` tiene **22 archivos**, no 23
  (`MAPA.md:83`). El número 0022 nunca existió — `git log --all` no encuentra ningún
  commit que lo haya creado ni borrado. Un hueco en la numeración es inocuo para el
  runner, pero el conteo del mapa está mal.

## Lo que NO alcancé a revisar

- **`conv.ts` (11 sitios de consulta).** Es el segundo archivo con más acceso a datos del
  repo, lo conté para el hallazgo de la frontera pero **no audité su semántica interna**:
  mutex, barrera, historial y `variantesTelefono` conviven ahí y no tiene dueño declarado
  en `MAPA.md`.
- **`processor.ts` (709 líneas), el archivo más grande de producción.** Solo leí los
  bloques 400-600. No evalué si sus responsabilidades —ruteo de tipo de mensaje, XML,
  presupuesto, mutex, recuperación de ejecución parcial, entrega del PDF— justifican
  vivir en un solo archivo, ni dónde estarían las costuras.
- **`llm/openrouter.ts` (fallback, caché, truncado).** Vi los nombres de sus exportados
  para el barrido de código muerto, pero no leí el módulo. Se solapa con tool calling y
  con rendimiento, y ahí es donde vive la contabilidad de costo.
- **La correspondencia columna a columna entre las 22 migraciones y los `select` de los
  cinco lugares que leen `liquidacion`.** Sin base de datos aquí, un desajuste solo se ve
  en runtime; lo dejé al rubro de modelo de datos.
- **`intake/` como conjunto (10 módulos).** Verifiqué `concepto.ts`, `cfdi_xml.ts` y las
  cabeceras de `ocr.ts`, pero no si `emparejar.ts`, `decidir.ts` y `duplicados.ts`
  comparten o duplican la noción de "es el mismo gasto" con el bloque 0 de
  `engine.ts:121-138`. La divergencia menor que la ronda 4 anotó
  (`engine.ts:134` normaliza con `strip_accents`, `duplicados.ts` no) sigue sin poder
  convertirse en un caso que falle, porque `ConceptoGasto` no tiene acentos.
- **No leí los reportes de los otros auditores de esta ronda**, así que puede haber solape
  con lo que fiscal, pruebas u operabilidad hayan encontrado por su lado — en particular
  el hallazgo de `startup.ts`, que es tan suyo como mío.
