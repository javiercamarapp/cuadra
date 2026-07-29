# Arquitectura y mantenibilidad — auditoría 6

**Nota: 4/10** (antes 5). Razón: **deuda que cobró factura**, en dos formas
distintas, sobre el camino del dinero — y hay progreso real que no alcanza a
compensarlo.

Lo bueno primero, porque es real: el hallazgo ALTO más citado del rubro
—`etiquetaConcepto` divergiendo del panel, tercera reincidencia en ronda 5— está
**cerrado por mecanismo**: `[id]/page.tsx` ya no reconstruye una etiqueta, delega
en la función del motor y solo usa su copia local como red cuando esa función no
sabe qué decir. `analytics.ts` ya trae `ocr_extra` en el detalle. `tools.ts` — sin
una sola prueba durante tres rondas — tiene hoy `tools_cableado.test.ts`, que
genera el PDF de verdad y prueba los bytes, no un mock.

Lo que baja la nota es que la pregunta de esta ronda —qué costuras se abrieron
entre los territorios de los siete agentes de ayer— tiene dos respuestas
concretas, verificadas contra el código y reproducidas con valores:

1. El sondeo que se escribió AYER para por fin verificar la migración 0019 —el
   mismo hallazgo MEDIO de ronda 5, "anuncia que verifica y no verifica"— **sigue
   sin poder verificarla**, y ahora lo hace con un comentario de seis líneas que
   afirma lo contrario.
2. La fecha del PDF archivado —el documento que el propio código llama "el papel
   que se archiva"— **no se arregló** cuando se arregló la del panel: el
   comentario del archivo nuevo lo admite, y la salida se reprodujo distinta
   carácter por carácter.

Y la pregunta central de la ronda —cuántas copias de acceso a datos viven fuera
de `repo.ts`— tiene una respuesta que ya lleva cinco rondas seguidas en la misma
dirección: **subió otra vez**, de 49 a 55.

---

## Hallazgos

### [CRÍTICO] El sondeo de la migración 0019, escrito ayer para cerrar el hallazgo de ronda 5, no puede detectar que falte
`src/lib/cuadra/startup.ts:108-121` · `supabase/migrations/0019_gasto_cfdi_uuid_unico.sql:1-21` · `supabase/migrations/0001_init.sql` (columna `cfdi_uuid`, preexistente)

Ronda 5 encontró (MEDIO): *"`startup.ts` anuncia que verifica la migración 0019 y
no la verifica"* — en ese momento el comentario prometía cobertura y no había
ningún probe para 0019. Ayer se escribió uno, con un comentario largo que explica
por qué importa y afirma cómo se prueba:

```ts
// startup.ts:108-113
// Migración 0019 (unique de cfdi_uuid). Sin ella, el MISMO CFDI de diésel
// entra dos veces: el gasto se cuenta doble en el comprobado, su IVA se
// acredita doble y el operador aparece habiendo gastado lo que no gastó. El
// motor deduplica por UUID en memoria, pero solo dentro de UNA liquidación:
// dos fotos del mismo XML en turnos distintos las escribe la base, y ahí no
// había nada que lo impidiera. Se sonda leyendo el índice, no escribiendo.
const { error: e19 } = await admin
  .from('gasto')
  .select('cfdi_uuid')
  .not('cfdi_uuid', 'is', null)
  .limit(1);
```

**El comentario dice "se sonda leyendo el índice". La consulta no toca el índice
en absoluto.** `uq_gasto_cfdi_uuid` es un índice ÚNICO PARCIAL que la migración
0019 crea sobre la columna `cfdi_uuid` (`0019_gasto_cfdi_uuid_unico.sql:19-21`).
Esa columna existe desde `0001_init.sql` — mucho antes de la 0019. Un
`SELECT ... WHERE cfdi_uuid IS NOT NULL LIMIT 1` es una lectura ordinaria: en
PostgreSQL/PostgREST tiene éxito exactamente igual con el índice presente,
ausente, o nunca creado. No hay forma de que este `SELECT` falle por la ausencia
de un índice único — solo fallaría si la COLUMNA no existiera, y esa migración es
otra.

**Escenario.** Se despliega contra una base a la que le falta la 0019 (proyecto
nuevo, rama que se saltó una migración, réplica restaurada de un backup viejo).
El arranque corre los siete sondeos; los otros seis SÍ pueden fallar de verdad
(`try_lock_viaje`, `intake_delta`, `codigo_pendiente`, `enriquecer_gasto_codigo`,
`guardar_liquidacion_tx` con SQLSTATE 42725) — pero el de la 0019 siempre pasa,
porque `gasto.cfdi_uuid` siempre existe. `logger.info('startup.migraciones', { ok:
true })`. Dos fotos del mismo CFDI de diésel de $8,100 —un reenvío por WhatsApp,
o dos operadores del mismo viaje subiendo el mismo ticket— entran en turnos
distintos; sin el índice único no hay nada que las rechace; el total comprobado
sube $8,100 de dinero que no se gastó y su IVA se acredita dos veces. El aviso
que existe específicamente para prevenir esto —y que ronda 5 señaló como
ausente— dijo que todo estaba bien.

**Consecuencia.** Es el mismo daño que describe ronda 5, pero peor: antes el
comentario mentía sobre una intención ("debería verificar esto"); ahora hay
código nuevo, con six líneas de justificación, que **aparenta cerrar** el
hallazgo. La próxima persona que lea este archivo y vea el bloque de la 0019 va
a asumir que está resuelto — que es exactamente el mecanismo por el que
`startup.migraciones: ok:true` mintió la primera vez, ahora reconstruido a mano.

**Severidad.** CRÍTICO: protege contra dinero contado dos veces en el motor
central, el aviso que debería avisarlo no puede hacerlo, y el código nuevo hace
más difícil notarlo que antes.

---

### [CRÍTICO] La fecha del PDF archivado no se arregló cuando se arregló la del panel — reproducido con el mismo caso que cerró el bug del panel
`src/lib/cuadra/liquidacion/pdf.ts:49-50` (`fecha`) · `src/app/dashboard/formato.ts:16-27,44-58` (`fechaMx`, comentario) · `src/app/dashboard/formato.test.ts:32-47`

Ronda 5 (frontend, MEDIO 3) encontró que el panel mostraba la fecha UTC del
servidor en vez de la de México, y que una liquidación cerrada después de las
18:00 hora local aparecía fechada al día siguiente. Ayer se arregló **el panel**:
`formato.ts` exporta `fechaMx()`, que fija `timeZone: 'America/Mexico_City'`, y
trae el test que ancla el caso exacto del bug (`formato.test.ts:33-39`).

El comentario del archivo nuevo dice, literal:

```
// La fecha tenía el mismo problema con otra causa: `.slice(0, 10)` sobre un
// `timestamptz` se queda con la fecha UTC, y CST es UTC−6 [...]
// La casa natural de estas dos funciones es `src/lib/utils.ts` [...]
// Ese archivo quedó fuera del alcance de esta ronda; mientras tanto viven aquí y
// `pdf.ts` sigue con su propia copia (misma salida en litros, distinta zona
// horaria en fechas).
// ═══════════════════════════════════════════════════════════════════════════
```

Es decir: **quien escribió el arreglo de ayer sabía que el PDF quedaba con el
mismo bug** y lo dejó fuera de alcance a propósito. `pdf.ts:49-50` sigue así:

```ts
const fecha = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
```

Sin `timeZone`. Ronda 5 (frontend) ya documentó que en Vercel el reloj del
servidor es UTC (`docs/auditoria-5/frontend.md:217`).

**Escenario, reproducido con el mismo caso que `formato.test.ts:33-39` usa para
probar que el panel quedó bien** (Node con `TZ=UTC`, simulando el runtime de
Vercel, sobre las dos funciones reales carácter por carácter):

```
iso = '2026-08-01T02:00:00.000+00:00'   // liquidación cerrada 31-jul 20:00 CDMX

pdf.ts    fecha(iso)     → "01 ago 2026"   ← el bug que se creyó cerrado
panel     fechaMx(iso)   → "31 jul 2026"   ← correcto (formato.ts, arreglado ayer)
```

El PDF es el documento que se archiva y que el contralor le manda a su contador;
`formato.ts` lo dice en su propio comentario ("está escogida para coincidir con
la del PDF, **que es el papel que se archiva**"). Hoy el papel que se archiva
tiene la fecha mala y la pantalla tiene la buena — exactamente al revés de lo
que el comentario asume.

**Consecuencia.** Toda liquidación cerrada después de las 18:00 hora de México
(el momento normal de cierre, al terminar el viaje) sale con un día de
diferencia entre lo que el contralor ve en pantalla y lo que archiva en papel.
En el corte mensual, una liquidación del 31 de julio aparece en el PDF fechada
en agosto — el mismo daño fiscal que ronda 5 describió, ahora solo en el
documento que sobrevive: el PDF es lo que se manda al contador, no la pantalla.

**Severidad.** CRÍTICO: es una regresión conocida y documentada por quien la dejó,
sobre el documento fiscal que se archiva, y el caso de prueba que hoy pasa en
verde (`formato.test.ts`) prueba solo la mitad del par que tiene que coincidir.

---

### [ALTO, REINCIDENTE — QUINTA RONDA] El acceso a datos fuera de `repo.ts` volvió a crecer: 55 sitios, contra 49 de ronda 5
`src/lib/cuadra/repo.ts` · `src/lib/cuadra/startup.ts` · `src/lib/cuadra/costos.ts` ·
`src/app/api/export/pdf/[id]/route.ts` (nuevo) · `docs/auditoria-5/MAPA.md:71`

Conteo real de `.from('` + `.rpc('` en código de producción (no tests), hoy:

| archivo | ronda 5 | ronda 6 | Δ |
|---|--:|--:|--:|
| `src/lib/cuadra/repo.ts` | 16 | 17 | +1 |
| `src/lib/cuadra/conv.ts` | 11 | 11 | — |
| `src/lib/cuadra/analytics.ts` | 8 | 8 | — |
| `src/lib/cuadra/startup.ts` | 5 | 7 | +2 |
| `src/lib/cuadra/costos.ts` | 3 | 4 | +1 |
| `src/app/api/export/pdf/[id]/route.ts` | — (no existía) | 2 | **nuevo** |
| `config.ts`, `tools.ts`, `processor.ts`, `auth/session.ts`, `dashboard/page.tsx`, `export/liquidaciones/route.ts` | 1 c/u (6) | 1 c/u (6) | — |
| **total** | **49** | **55** | **+6** |

`repo.ts` sigue concentrando la minoría: 17 de 55 (31%), casi el mismo porcentaje
que en ronda 5 (16/49, 33%). Es la **quinta ronda consecutiva** que este conteo
sube (ronda 4: 43 · ronda 5: 49 · ronda 6: 55), y en ninguna bajó.

El sitio nuevo es `src/app/api/export/pdf/[id]/route.ts`, escrito ayer para
cerrar un MEDIO de frontend (el PDF existía y no tenía puerta de descarga). Está
bien escrito —filtra por `tenant_id` explícito, firma la URL con TTL corto, usa
el mismo passcode del panel— pero es, otra vez, una ruta nueva que habla
directo con `supabaseAdmin()` en vez de pedirle la fila a `repo.ts`. `startup.ts`
sumó dos sondeos nuevos (0019, 0022) contra tablas/RPCs directamente, y
`costos.ts` sumó un `.insert` más.

**Escenario.** Es el mismo que ronda 4 y 5 ya describieron: cambiar el
significado de una columna de `liquidacion` (por ejemplo, qué cuenta como "PDF
disponible") exige buscar en al menos seis archivos que la leen por su cuenta,
y el síntoma de olvidar uno no es un error — es una pantalla o una respuesta que
calla.

**Consecuencia.** `MAPA.md` de ronda 5 seguía afirmando "`repo.ts` es TODO el
acceso a datos"; el propio mapa de esta ronda (línea 85) ya no lo dice así
("`repo.ts` (TODO el acceso a datos)" sigue en la lista de dónde está todo, pero
el conteo real lleva tres rondas sin sostenerlo). La frontera no se defendió en
ninguno de los 55 arreglos de ayer, ni siquiera en el que específicamente creaba
una ruta nueva de lectura de `liquidacion`.

**Severidad.** ALTO, reincidente: es la advertencia de ronda 5 —"vuelve a
ocurrir, no es advertencia, es hallazgo"— aplicada a sí misma por quinta vez.

---

### [ALTO, SIN TOCAR — SEGUNDA RONDA] `politica_gasto` sigue siendo una tabla muerta con seed divergente, y nadie de los siete agentes de ayer la tocó
`src/lib/cuadra/repo.ts:82-88` (`getPolitica`) · `supabase/seed.sql:60-72` · `src/lib/cuadra/config.ts:57-67`

Ronda 5 encontró (ALTO) que `getPolitica()` no tiene ningún consumidor en todo
`src/` y que su seed (`politica_gasto`) quedó con el concepto heredado
`viaticos` y sin `flete`, mientras `DEMO_CONFIG.politica` —la que el motor
realmente usa, vía `desde_db.ts`— ya tiene los cuatro conceptos que nacieron al
partir `viaticos`. Verificado de nuevo hoy, línea por línea: **nada cambió**.

```sql
-- seed.sql:67-71, hoy
('...', 'diesel',   null, 4000, false, ...),
('...', 'caseta',   null, 1500, false, ...),
('...', 'viaticos', null, 800,  false, ...),   -- concepto que ya no existe en ConceptoGasto
('...', 'factura',  null, null, true,  ...)
```

```ts
// config.ts:57-67, hoy — sin cambios
politica: [
  { concepto: 'diesel', topeMonto: 4000 },
  { concepto: 'caseta', topeMonto: 1500 },
  { concepto: 'alimentacion', topeMonto: 800 },
  { concepto: 'hospedaje', topeMonto: 2500 },
  { concepto: 'transporte', topeMonto: 800 },
  { concepto: 'flete' },
  { concepto: 'factura', requiereCfdi: true },
],
```

`getPolitica` (`repo.ts:82`) sigue apareciendo solo en el archivo que la define
(confirmado con `grep -rn` sobre `src/`, cero consumidores). El seed sigue
instruyendo, en mayúsculas, "AJUSTA cada tope con la política real" sobre una
tabla que el motor no lee.

**Escenario.** Sin cambios respecto a ronda 5: a nueve días del demo, alguien que
siga la instrucción del seed y capture la política del cliente en
`politica_gasto` vía consola de Supabase no cambia nada — el motor sigue leyendo
`tenant.config` jsonb. No hay error, no hay log: la tabla se escribió, solo que
nadie la lee.

**Consecuencia.** La regla del rubro aplica sin matices: una advertencia que
sigue sin atenderse una ronda entera —con 55 arreglos de por medio, ninguno en
este archivo— no es más leve por seguir latente. Es deuda declarada que nadie
cobró todavía, y cada ronda que pasa sin tocarla es una ronda más cerca del
6-agosto en la que alguien sí la use.

**Severidad.** ALTO, sin cambios.

---

### [MEDIO] Tres funciones de dinero nuevas, tres copias nuevas o casi-nuevas del mismo formateo
`src/lib/utils.ts:8-10` (`mxn`) · `src/lib/cuadra/liquidacion/pdf.ts:33-34` (copia local, preexistente) ·
`src/lib/cuadra/liquidacion/acreditable.ts:16` (copia local, **nueva**) ·
`src/app/dashboard/formato.ts:40-42` (`litros`) · `src/lib/cuadra/liquidacion/acreditable.ts:89-95` (formato propio de litros) ·
`src/lib/cuadra/cuadre/resumen.ts:78-80` (litros sin formatear)

`utils.ts` exporta `mxn()` desde antes de esta ronda, y ya se importa sin
problema en dos páginas del panel (`[id]/page.tsx:8`, ninguna restricción de
runtime). `pdf.ts` trae su propia copia local desde antes (deuda preexistente,
no nueva). Lo nuevo es que **`acreditable.ts`, escrito ayer, agregó una TERCERA
copia** en vez de importar la que ya existía:

```ts
// acreditable.ts:16 — nuevo, idéntico a utils.ts:8-10 y a pdf.ts:33-34
const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
```

Las tres fórmulas son hoy idénticas — no hay bug visible. Pero es exactamente el
patrón que ya costó `etiquetaConcepto`/panel dos veces: nadie decidió que
hubiera una copia; cada archivo la escribió porque fue más rápido que importar.

Aparte, la representación de litros de diésel elegible tiene **tres** caminos
independientes, y uno de los tres ya se ve distinto:

```
formato.ts:41     n.toLocaleString('es-MX', { maximumFractionDigits: 2 })  → dashboard
acreditable.ts:95  litros.toLocaleString('es-MX')                          → PDF (vía filasAcreditables)
resumen.ts:80      `${liq.litrosDieselAcreditables} L`                     → mensaje de WhatsApp, SIN formatear
```

Reproducido con `node`, para 1,850 L elegibles: el dashboard y el PDF dicen
`"1,850 L"`; el mensaje de WhatsApp que el operador y el contralor reciben dice
`"1850 L"` — sin separador de millares. No es una cifra mal calculada, es la
misma cifra con tres formatos, y el mensaje que llega primero (WhatsApp) es el
que se ve distinto de los otros dos.

**Consecuencia.** Ninguna hoy. El riesgo es el de siempre en este rubro: si
`formato.ts` cambia de dos a tres decimales (por ejemplo, para litros con más
precisión), `acreditable.ts` y `resumen.ts` no se enteran, porque no hay una
sola fuente ni una prueba que compare las tres salidas entre sí —
`formato.test.ts` solo prueba `formato.ts` contra `pdf.ts`, no contra
`acreditable.ts` ni `resumen.ts`.

**Severidad.** MEDIO: deuda nueva de la misma forma que la deuda vieja, sin daño
hoy.

---

### [MEDIO] La guardia del estado afirmado promete dos textos distintos y solo tiene uno; el parámetro que distinguiría los casos está fijo en `false`
`src/lib/cuadra/cuadre/estado_afirmado.ts:53-61,85-96` · `src/lib/cuadra/processor.ts:736`

`estado_afirmado.ts` es el arreglo del CRÍTICO de ronda 5 (agéntico) sobre
afirmaciones de estado falsas, y está bien pensado — el análisis de por qué el
detector es angosto (líneas 23-27) es correcto. Pero su propio comentario
distingue dos motivos de falla y promete tratarlos distinto:

```ts
// estado_afirmado.ts:56-58
* Se separa del cierre porque el PDF puede fallar con la liquidación cerrada de
* verdad, y ahí el texto correcto es otro.
```

El código no tiene "otro texto". `guardiaEstado` devuelve el MISMO
`reply` fijo (línea 92) sea cual sea el motivo:

```ts
// estado_afirmado.ts:85-96
export function guardiaEstado(reply: string, real: EstadoReal): ResultadoEstado {
  const motivos: string[] = [];
  if (!real.cerro && AFIRMA_CIERRE.some((r) => r.test(reply))) motivos.push('cierre_no_ocurrido');
  if (!real.entrego && AFIRMA_ENVIO.some((r) => r.test(reply))) motivos.push('envio_no_ocurrido');
  if (motivos.length === 0) return { reply, forzado: false, motivos: [] };
  return {
    reply: 'Todavía no he cerrado tu liquidación. Cuando ya no te falte ningún comprobante, escribe *listo* y la cierro. 🚛',
    ...
  };
}
```

Y el único llamador pasa `entrego` fijo en `false`, siempre:

```ts
// processor.ts:736
const est = guardiaEstado(reply, { cerro: closed, entrego: false });
```

Eso significa que `AFIRMA_ENVIO` —la mitad del detector dedicada a "ya te lo
mandé"— **nunca puede resolver a verdadero**: si el modelo dice "ya te lo mandé"
en cualquier turno, `real.entrego` es `false` por construcción y el texto se
sustituye, sea cierto o no. Y si SÍ era cierto (el PDF se entregó en un turno
anterior y el modelo lo confirma ahora), el reemplazo —"Todavía no he cerrado tu
liquidación... escribe *listo*"— es una mentira nueva sobre un viaje que además
puede ya estar cerrado, pidiéndole al operador una acción que no hace falta.

**Por qué no lo marco más alto:** no logré construir, dentro del tiempo de esta
ronda, la secuencia de conversación exacta que hace que el modelo produzca esa
frase sobre un envío YA ocurrido en un turno anterior — depende de cómo
`conv.ts` arma el historial que ve el modelo, y es territorio que no audité a
fondo esta ronda (ver abajo). Lo que sí verifiqué en el código, sin necesidad de
esa secuencia: el parámetro existe, el comentario promete una rama que usarlo, y
esa rama es hoy inalcanzable.

**Consecuencia.** Una pieza de la guardia que el propio archivo documenta como
necesaria para un caso ("el PDF puede fallar con la liquidación cerrada de
verdad") no distingue ese caso de ningún otro. Si algún día se corrige el
`false` fijo, el reemplazo de texto seguirá siendo el mismo para los dos casos,
que es exactamente el problema que el comentario dice que existe.

**Severidad.** MEDIO: la mitad más citada de la guardia (afirmar un cierre falso)
funciona y está bien probada; la otra mitad (afirmar un envío falso) es
estructuralmente inerte.

---

### [BAJO] `CLAVES_PEAJE` sigue escrita dos veces
`src/lib/cuadra/intake/concepto.ts:27` · `src/lib/cuadra/config.ts:99`

Sin cambios desde ronda 5: las mismas dos claves SAT del peaje
(`95111602`, `95111603`), en dos archivos, sin sincronía ni prueba. Sigue inerte
porque `processor.ts` siempre pasa el valor de `config.ts`, así que el default de
`concepto.ts` solo lo usan sus propios tests. Riesgo latente sin cambios.

### [BAJO] Ocho símbolos exportados siguen sin consumidor
`repo.ts:82` (`getPolitica`) · `analytics.ts:51` (`getStatsPorOperador`) ·
`costos.ts:252` (`getResumenCosto`) · `normas/indice.ts:271` (`citaDe`) ·
`auth/session.ts:11` (`getSessionTenant`) · `llm/openrouter.ts:122`
(`generateResponse`) · `laboral/pagadero.ts:123` (`topeDescuento`) ·
`config.ts:31,75-82` (`catalogoCuentas`)

Verificado con `grep -rn` sobre `src/` (dos veces cada uno, incluyendo tests):
ninguno tiene un consumidor fuera de su propia definición o su propio test.
Lista idéntica a la de ronda 5; ninguno de los 55 arreglos de ayer los tocó.
`getResumenCosto` sigue siendo el que más pesa: es el margen real del negocio, y
sigue sin quien lo lea.

### [BAJO] El id que fabrica `tools.ts` para el objeto que va al PDF sigue sin ser el id real
`src/lib/cuadra/tools.ts:127` (`randomUUID()`) · `src/lib/cuadra/liquidacion/pdf.ts:74`

Sin cambios desde ronda 5. Mitigado por `viaje.folio`, que en la práctica casi
siempre existe (el seed del demo lo trae).

---

## Inventario: cuántas copias hay de cada verdad

### La lista de conceptos de gasto (comparado contra las 14 filas de ronda 5)

| # | dónde | qué es | ronda 5 | ronda 6 |
|--:|---|---|---|---|
| 0 | `types/cuadra.ts:20-25` | `ConceptoGasto` — la fuente | — | — |
| 1 | `intake/ocr.ts:26` | `CONCEPTOS_OCR` (enum zod) | SÍ (compilación) | SÍ, sin cambios |
| 2 | `intake/ocr.ts:78` | texto del prompt | parcial | sin cambios |
| 3 | `cuadre/engine.ts` | `label()` / `m` | SÍ (`etiquetas_sincronizadas.test.ts`) | SÍ, sin cambios |
| 4 | `app/dashboard/[id]/page.tsx:20-24` | `CONCEPTO` (mapa del panel) | SÍ, pero **ya divergía** | **CERRADO** — ahora es solo la red de `etiquetaGasto()`, que delega en `etiquetaConcepto` primero (ver abajo) |
| 5 | `cuadre/engine.ts` | `etiquetaConcepto` (sobrescribe `diesel`) | NO — ya divergió del panel | **el panel deja de tener copia propia; delega.** Sigue sin prueba de que el PDF y el panel produzcan la MISMA cadena para `producto=PLUS/MAGNA/—`, pero ya no puede divergir por tener dos mapas — solo puede fallar por no llamar a la función |
| 6 | `cuadre/engine.ts:77` | `ES_VIATICO` | NO | NO, sin cambios |
| 7 | `cuadre/engine.ts` | `haySoporte` | parcial | sin cambios |
| 8 | `cuadre/engine.ts:540` | `conTope` | NO | NO, sin cambios |
| 9 | `laboral/pagadero.ts:42` | `OBLIGACION_263` | NO | NO, sin cambios |
| 10 | `config.ts:57-67` | `DEMO_CONFIG.politica` | NO | NO, sin cambios |
| 11 | `config.ts:75-82` | `catalogoCuentas` | NO — cero consumidores | NO, sin cambios |
| 12 | `app/api/demo/route.ts:19-27` | `POLITICA` | NO | NO, sin cambios (ver hallazgo heredado abajo) |
| 13 | `supabase/seed.sql:67-71` | filas de `politica_gasto` | NO — ya divergió | **SIGUE divergido**, sin tocar (ver ALTO arriba) |
| 14 | `repo.ts:424` · `analytics.ts:55` | `.eq('concepto','diesel')` | NO | NO, sin cambios |

**Catorce filas, igual que ronda 5. Una se cerró de verdad (la 5/4, por
mecanismo de delegación); las otras trece siguen exactamente como estaban,
incluidas las dos que ya habían divergido.**

### El acceso a datos fuera de `repo.ts`

**49 → 55.** Ver hallazgo ALTO arriba. Tabla completa por archivo ahí.

### El resto

| verdad | dónde vive | ¿sincronía? | cambio vs ronda 5 |
|---|---|---|---|
| Formateo de pesos (`mxn`) | `utils.ts` · `pdf.ts` (copia) · `acreditable.ts` (copia, **nueva**) | NO | **empeoró**: tercera copia |
| Formateo de litros | `formato.ts` (dashboard) · `acreditable.ts` (PDF) · `resumen.ts` (WhatsApp, sin formatear) | parcial — `formato.test.ts` solo ancla `formato.ts` contra la fórmula de `pdf.ts`, no contra las otras dos | nuevo hallazgo (MEDIO) |
| Formateo de fecha | `formato.ts` (`fechaMx`, con TZ) · `pdf.ts` (`fecha`, sin TZ) | **NO — divergieron, reproducido** | **nuevo CRÍTICO** — la mitad que se "arregló" en ronda 5 dejó viva la otra mitad |
| Política de gastos de la flota | `config.ts` · `api/demo/route.ts` · `politica_gasto` (tabla+seed+`repo.getPolitica`, muerta) | NO — tres copias, la tercera muerta y divergida | sin cambios (ALTO persistente) |
| Nombres de las tools | `tools.ts` · `registry.ts` · `prompts.ts` · `guardia.ts` · `processor.ts` | NO estructural, pero `tools.ts` ganó su primera prueba de comportamiento real | mejoró parcialmente — no evalué si los 21 literales bajaron en número esta ronda |
| Verificación de invariantes de migración en `startup.ts` | siete probes, uno por migración | **6 de 7 son probes reales; el de la 0019 es un placebo** | nuevo CRÍTICO |
| Clasificación deducible/no deducible/por confirmar | `engine.ts` (`cubetaDe`) → consumida sin reimplementar por `deducibilidad.ts` (nuevo) y `pdf.ts` | SÍ — un solo sitio de criterio, dos de presentación pura | **bien: el patrón correcto**, ver abajo |
| IVA/peaje/litros acreditables | `engine.ts` (cálculo) → consumido sin reimplementar por `acreditable.ts` (nuevo) y `pdf.ts` | SÍ — mismo patrón que arriba | **bien** |
| Estatus del panel (datos/vacío/parcial/error) | `dashboard/estado.ts` (nuevo) → `dashboard/page.tsx` | SÍ — un solo sitio, con prueba propia | **bien: cierra el CRÍTICO de frontend de ronda 5 con la arquitectura correcta** |
| Etiquetas de estatus de liquidación | `dashboard/page.tsx` · `dashboard/[id]/page.tsx` | SÍ | sin cambios |
| Fichas de normas ↔ YAML | `normas/indice.ts` ↔ `normas/*.yaml` | SÍ | sin cambios |
| `maxDuration` ↔ presupuesto | `webhook/route.ts` · `presupuesto.ts` | SÍ | sin cambios — sigue siendo el patrón modelo |

---

## Lo que revisé y está bien

- **`acreditable.ts` y `deducibilidad.ts` (los dos archivos nuevos de
  `liquidacion/`) no duplican criterio fiscal — lo consumen.** Verificado
  leyendo `engine.ts:590-727` completo: `totalDeducible`/`totalNoDeducible`/
  `totalPorConfirmar` salen de `cubetaDe`, e `ivaAcreditable`/`peajeAcreditable`/
  `litrosDieselAcreditables` salen de un bloque separado con su propia lista de
  exclusión (`SIN_ACREDITAMIENTO`), documentada línea por línea sobre por qué es
  distinta de la de deducibilidad (`combustible_efectivo` es deducible pero no
  acreditable). Los dos archivos nuevos son funciones puras que solo formatean
  campos ya calculados — la pregunta del MAPA ("¿comparten criterio o
  divergen?") tiene una respuesta limpia: ninguno de los dos define criterio,
  los dos importan el mismo. `filasDeducibilidad` incluso verifica en runtime
  que las tres cubetas sumen `totalComprobado` (tolerancia de un centavo) antes
  de imprimir nada — una defensa que no existía.
- **`etiquetaConcepto`/panel, cerrado por mecanismo.** `[id]/page.tsx:238-241`
  (`etiquetaGasto`) llama primero a `etiquetaConcepto` del motor y solo cae al
  mapa local cuando esa función no reconoce el concepto — la misma regla que
  `engine.ts` usa internamente. Ya no hay dos mapas independientes del mismo
  hecho; hay una función y una red declarada como tal.
- **`analytics.ts:237` ya selecciona `ocr_extra`** en `getLiquidacionDetalle`,
  cerrando el hueco que ronda 5 señaló como la causa de que el panel no pudiera
  alinearse con el PDF aunque quisiera.
- **`tools.ts` tiene su primera prueba de comportamiento real**
  (`tools_cableado.test.ts`), y está bien construida: genera el PDF de verdad,
  lo sube a un storage falso, e infla los bytes reales para leer el texto — no
  espía el argumento, prueba el resultado, siguiendo la regla que el propio
  archivo de test enuncia ("un arreglo histórico está anclado cuando su prueba
  FALLA si alguien lo revierte"). Cubre la mutación M19 (destinatario del PDF
  del operador) que ronda 5 encontró viva. **No cubre** la lógica de
  `rfa-2026-2.9` (`tools.ts:79`) ni la capa de periodo — verificado con
  `grep` sobre el archivo de test, cero menciones.
- **El motor sigue siendo puro**, incluidos los cinco archivos nuevos. Dos
  búsquedas sobre `cuadre/`, `normas/`, `laboral/`, `liquidacion/`,
  `facturacion/`: cero `Date.now()`, `process.env`, `Math.random`,
  `randomUUID`, `fetch(`, `supabaseAdmin`.
- **`dashboard/estado.ts` es la arquitectura correcta para el CRÍTICO de
  frontend de ronda 5** (el panel afirmaba "no hay liquidaciones" sobre una
  consulta que había fallado, no sobre datos vacíos de verdad): separa la
  DECISIÓN de qué pantalla mostrar de la CARGA de datos, en una función pura
  con su propio test, en vez de dos booleanos sueltos dentro del componente.
- **`observability/arranque.ts` no duplica `verificarEntornoCritico` de
  `startup.ts`** — verificado: cubren listas de variables disjuntas
  (`DASHBOARD_SECRET` uno, `DEMO_TENANT_ID`/`DASHBOARD_PASSCODE`/
  `CUADRA_WHATSAPP_MSG_USD` el otro) y el propio archivo declara la condición
  bajo la que sobraría ("si aquella crece hasta cubrir estas"). Ambos
  correctamente cableados: `verificarMigracionesCriticas` llama a
  `verificarEntornoCritico` (`startup.ts:66`); falta verificar quién llama a
  `avisarConfiguracionSilenciosa` (no lo rastreé esta ronda).
- **Línea base intacta** por verificación del orquestador: 990 pruebas (103
  archivos, 1 saltada), `tsc` 0, `eslint` 0, `build` 0. No modifiqué ningún
  archivo del repo — los scripts de reproducción (la fecha del PDF, los
  formatos de litros) corrieron con `node -e` sobre las fórmulas transcritas
  literalmente de los archivos, no sobre supuestos.

## Lo que NO alcancé a revisar

- **Si la secuencia de conversación puede hacer que el modelo afirme un envío
  YA ocurrido en un turno anterior**, que es el escenario que volvería
  explotable el hallazgo MEDIO de `estado_afirmado.ts`. Depende de cómo
  `conv.ts` arma el historial que ve el modelo entre turnos y viajes — territorio
  que no es mío esta ronda (lo señalé también en ronda 5).
- **`conv.ts` (11 sitios de consulta) por dentro.** Lo conté para la frontera de
  `repo.ts` otra vez, no audité su semántica.
- **`processor.ts` (más de 800 líneas ahora)** — no evalué si sus
  responsabilidades justifican seguir en un solo archivo.
- **Si los 21 literales de nombres de tools bajaron o subieron esta ronda** —
  verifiqué que `tools.ts` ganó pruebas, no reconté las apariciones en las
  cinco capas que ronda 5 catalogó.
- **`llm/openrouter.ts`** — se solapa con tool calling y rendimiento.
- **No leí los reportes de los otros auditores de esta ronda**; puede haber
  solape, en particular con backend sobre `startup.ts` y con operabilidad sobre
  el sondeo falso de la 0019 — ambos rubros tienen motivo legítimo para
  encontrarlo también.
