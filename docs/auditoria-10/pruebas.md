# Pruebas — auditoría 10

Ancla: commit `36533ff` (HEAD justo antes de los dos commits de esta nota).
Sesión con ~12 agentes editando el repo en paralelo — cada hallazgo de abajo
se verificó contra `git status` fresco en el momento exacto de tocarlo, no
contra una foto vieja.

**Nota: 8/10** (ronda 9: **9/10**, ▼1). Razón del movimiento, las dos formas
de la lista de `references/rubros.md` a la vez:

1. **Mirada más profunda.** El hallazgo del OCR que esta tarea pedía verificar
   —`ocr_confianza` salió 0.950 idéntico en ocho gastos— resultó ser un hueco
   de cobertura real y VERIFICADO POR MUTACIÓN: nadie en la suite comprobaba
   que ese campo viene del modelo. La ronda 9 mutó 12 puntos del código y
   ninguno era este.
2. **Deuda que cobró factura.** La ronda 9 nombró el patrón exacto —"fiscal
   nuevo sin arnés real"— para `comprobante_huerfano` y lo cerró. Hoy
   reapareció, sin que nadie lo pidiera, en `src/lib/saas/iva.ts`: un módulo
   fiscal nuevo (mig. `0066_iva_de_la_mensualidad`), ya cableado a
   `transferencia.ts`, con CERO pruebas — y con un bug real adentro que una
   prueba habría atrapado antes de que llegara a producción.

Cerré los dos hoy mismo, con la misma disciplina que pide este rubro
(mutación o TDD, no lectura), y quedan documentados abajo con commit. La nota
baja de todas formas porque la EXISTENCIA de dos huecos reales — uno heredado
de antes de la ronda 9, otro nuevo hoy y del mismo patrón que la ronda 9 ya
había cerrado una vez — es más evidencia de la que un rubro en "8+ sólido y
sostenido" debería producir en una sola ronda, incluso cerrada.

**Aclaración sobre la cifra "antes".** `docs/auditoria-9/pruebas.md` (el
archivo que esta tarea señala como referencia) dice "Nota: 8/10" — pero es el
borrador del auditor DE ANTES del cierre de esa misma ronda: nunca se
reescribió después de que el orquestador cerró su único ALTO
(`comprobante_huerfano`/`corregirFechaGasto` sin arnés real) el mismo día,
commit `e4e345f`, con `repo_huerfanos.test.ts`. `docs/auditoria-9/00-SINTESIS.md`
línea 19 registra el número que de verdad cerró la ronda: **9**, con la razón
"el único alto (`comprobante_huerfano` sin arnés real) cerró con el mismo
rigor de mutación que el rubro ya exigía". Uso ese 9 como referencia — es el
que la propia auditoría 9 declara autoritativo en su síntesis — y lo dejo
explícito para que esta nota no se lea como una subida cuando en realidad es
una bajada de un punto.

---

## Método

Corrí el suite completo varias veces a lo largo de la sesión (con ~12 agentes
editando el repo en paralelo, el resultado se movía de una corrida a la
siguiente — ver la sección de abajo) hasta anclar en un momento estable.
Verifiqué las dos hipótesis principales con **mutación real aplicada
directamente sobre el árbol de trabajo**, no con lectura de código:
confirmé primero con `git diff --stat -- <archivo>` que nadie más lo estaba
tocando, muté, corrí la prueba dirigida, y restauré con `git checkout --
<archivo>` de inmediato, confirmando el diff vacío otra vez antes de seguir.
Para el hallazgo de `iva.ts` seguí el ciclo TDD completo: prueba en rojo
primero (contra el código sin arreglar), arreglo de una línea, prueba en
verde, suite completa, commit atómico citando el hallazgo.

---

## Estado del suite, al momento de anclar (commit `36533ff`, 23:19 del día de la auditoría)

- `npx vitest run` → **222 archivos, 2936 pruebas, 1 saltada (legítima,
  gateada por `CUADRA_COBERTURA`), 0 fallos.**
- `npx tsc --noEmit -p .` → limpio salvo `.next/types/validator.ts` (un
  artefacto de build STALE que referencia `src/app/zzz-preview/[v]/page.js`,
  una página temporal de las que describe `CLAUDE.md` para capturas — ya no
  existe en el árbol. No es código fuente, es caché de un `npm run build`
  corrido por otro agente mientras esa página existía; no cuenta como
  hallazgo de este rubro.
- `npx eslint src/` → **0 errores, 6 warnings** (imports sin usar en
  `admin/page.tsx`, ajenos a pruebas).
- `.github/workflows/ci.yml` sin cambios desde la ronda 9: corre en
  `branches: ['**']`, `npm ci`, typecheck, lint, `test:coverage` con el
  umbral de `vitest.config.ts`, más el paso separado `vitest run fundamento
  duplicados` SIN instrumentar (lo que `pruebas_en_ci.test.ts` exige y
  verifica solo). Sigue siendo el mecanismo correcto.

**Durante la sesión, y por qué no cuenta como hallazgo de este rubro:** en
tres corridas distintas antes de anclar vi fallar, en momentos distintos,
`src/lib/cuadra/processor_cierre.test.ts`, `src/lib/cuadra/facturacion/al_vuelo.test.ts`,
`src/lib/cuadra/operacion.test.ts` y una `tsc` roja en
`src/lib/cuadra/repo_operadores.test.ts`, más un archivo transitorio
`src/lib/cuadra/normas/_zzz_repro_tema.test.ts` que existió y desapareció
entre dos corridas. Verifiqué cada uno con `git status --short -- <archivo>`
en el momento exacto de la falla: los cinco estaban `M` (modificados, sin
commit) por otro agente en ese instante — `operacion.test.ts` incluso traía
en su propio nombre de prueba `AUDITORÍA 10: crearViaje RECHAZA un
operadorId de OTRA flota`, o sea, el TDD rojo de un hallazgo de seguridad de
ESTA MISMA ronda, de otro rubro, a medio cerrar. Para cuando anclé en
`36533ff`, los cinco ya estaban verdes de nuevo (los agentes dueños los
cerraron). No los toqué en ningún momento — ni para arreglar ni para mirar
más allá de `git status` y el nombre de la prueba.

---

## Hallazgo 1 (verificado y cerrado): `ocr_confianza` existe en producción, pero ninguna prueba comprobaba que viniera del modelo

**El hallazgo específico de esta tarea, verificado.** En producción
`ocr_confianza` NO está hardcodeado: `src/lib/cuadra/intake/ocr.ts:385` hace
`ocrConfianza: data.confianza`, un paso directo de lo que el modelo de visión
contestó (`confianza: z.number().min(0).max(1)`, con instrucción explícita en
el prompt: *"'confianza' = qué tan seguro estás de haber leído bien el monto
y el folio (0 a 1)"*, `ocr.ts:96`). No hay ningún `0.95` fijo en el camino de
producción.

**Pero ninguna prueba lo comprobaba.** Los tres archivos que mockean
`generateStructured` y ejercitan `extraerComprobante` —`ocr_motivo.test.ts`,
`ocr_varias_fotos.test.ts`, `rfc_emisor_puntuado.test.ts`— construyen su
fixture con `confianza: 0.95` (dos de ellos) o `0.98` (el tercero) fijo en la
función `respuesta()`, y **ningún `it()` de los tres, en ninguna de sus
pruebas, leía `r.gasto.ocrConfianza`**. El arnés de ticket real
(`arnes_ticket_real.test.ts`), que es el único diseñado para afirmar "lo que
tiene que valer para CUALQUIER ticket real, sin saber cuál es"
(`afirmarFormaDeExtraccion`), tampoco lo tocaba: comprobaba `concepto`,
`monto`, `fecha`, costo y motivo, pero no `ocrConfianza`.

**Verificado por mutación, no por lectura.** Con el árbol limpio confirmado,
cambié `ocr.ts:385` de `ocrConfianza: data.confianza` a `ocrConfianza: 0.95`
(un hardcodeo real) y corrí las 36 pruebas de los tres archivos de arriba más
el arnés: **las 36 pasaron exactamente igual.** Ese es el mutante que
demuestra el hallazgo — la suite no puede distinguir "el campo viene del
modelo" de "el campo está fijo en 0.95", que es justo el patrón que hace
sospechoso el 0.950 idéntico que otro agente vio en ocho gastos reales hoy.
Restauré el archivo de inmediato (`git checkout --`, diff vacío confirmado).

**Por qué importa aunque `ocr_confianza` no sea un monto en pesos:**
`consulta_chofer.ts` y otros consumidores usan este campo como UMBRAL de
confianza para decidir qué mostrarle a un operador o a un contralor sobre la
calidad de una lectura. Un hardcodeo silencioso en ese campo no mueve dinero
directamente, pero apaga la señal que le dice a un humano cuándo revisar un
monto con más cuidado — que es, indirectamente, la misma clase de daño que
este rubro existe para atrapar.

**Cerrado, commit de esta ronda.** Agregué:
- `src/lib/cuadra/intake/ocr_motivo.test.ts` — 4 pruebas nuevas: confianza
  baja (0.42) llega intacta; DOS llamadas con confianza DISTINTA (0.99 y
  0.15) devuelven DOS `ocrConfianza` distintos —la afirmación que de verdad
  mata un hardcodeo, porque una prueba aislada con `toBe(0.99)` pasaría igual
  contra una constante fija—; confianza 0 (sin piso implícito); y el camino
  de `fallo_tecnico`, que SÍ hardcodea 0 a propósito (documentado como tal,
  para no confundirse con el bug).
- `src/lib/cuadra/arnes_ticket_real.test.ts` — `afirmarFormaDeExtraccion`
  ahora exige, cuando `legible` es `true`, que `ocrConfianza` esté definido,
  sea finito y caiga en `[0, 1]`. Añadí dos pruebas de control ("sin
  ocrConfianza no pasa", "fuera de rango no pasa") a la sección que verifica
  que el propio verificador SÍ puede fallar.
- Re-verifiqué con la MISMA mutación de arriba que ahora **sí muere** (3 de
  las pruebas nuevas fallan contra el hardcodeo) antes de restaurar el
  archivo real.

## Hallazgo 2 (encontrado, arreglado y cerrado): `iva.ts`, módulo fiscal nuevo, cero pruebas, con un bug real en el borde de la tolerancia

`src/lib/saas/iva.ts` es nuevo hoy: decide de qué lado del precio va el IVA
de cada mensualidad SaaS (mig. `0066_iva_de_la_mensualidad.sql`, ya cableado
desde `transferencia.ts:172` y `:303`). Su propio comentario de cabecera
documenta el bug que existe para cerrar: un plan de $10,000 se transfería por
$10,000 y se timbraba por $11,600 porque `emitirMensualidad` y
`timbrarMensualidad` leían el mismo número con convenciones de IVA
contradictorias — un CFDI que sale mal no se puede deshacer. **No tenía un
solo `.test.ts`.**

Al escribirle la cobertura con TDD (`src/lib/saas/iva.test.ts`), un caso de
borde salió en rojo contra el código real, no contra mi prueba:
`desgloseCuadra(10000.01, 8620.69, 1379.31)` debía dar `true` —la migración
0065/0066 documenta explícitamente "un centavo de tolerancia por el
redondeo", y $10,000.01 vs $8,620.69+$1,379.31 es una diferencia matemática
de exactamente un centavo— pero daba `false`. La causa: `10000.01 - 10000` en
punto flotante de JS no da `0.01` exacto, da `0.010000000000218279`, dos
billonésimas de centavo por encima del `<= 0.01` de la comparación. Es el
mismo tipo de trampa de punto flotante que ya vive en `round2()` (el
`Number.EPSILON` que usa esa función es exactamente la defensa contra esto),
solo que `desgloseCuadra` no la tenía.

**Escenario real, con el propio comentario del código como fuente:**
`desgloseCuadra` se llama —según su propio JSDoc— porque "una fila escrita
por otro camino (una corrección a mano en Supabase, un import) no pasaría por
el código de esta carpeta". Una corrección manual que cae justo en el borde
documentado como tolerado se habría rechazado, bloqueando el timbrado de una
mensualidad que sí estaba bien — por un error de representación de punto
flotante, no de negocio.

**Arreglado.** `iva.ts::desgloseCuadra` ahora compara contra `0.01 + 1e-9`:
el centavo de negocio sigue siendo exactamente eso, el `1e-9` es solo el
margen contra el ruido de representación. Verificado que un caso de DOS
centavos (una discrepancia real, no ruido) sigue rechazándose.

**Cerrado, commit de esta ronda.** `src/lib/saas/iva.test.ts`, 20 pruebas:
- `desglosarPrecio` con IVA incluido y con IVA aparte, con el invariante
  `subtotal + iva === total` verificado en 7 precios distintos por cada
  criterio (el mismo invariante que el `CHECK factura_saas_desglose_cuadra`
  de la 0065/0066 exige en la base).
- El criterio sin declarar (`null` Y `undefined`, que es lo que trae una
  columna nunca escrita al leerla de Supabase) LANZA, nunca elige un lado por
  default — la prueba explícita de que no hay lectura "provisional".
- Precio inválido (negativo, `NaN`, `Infinity`) lanza antes de mirar el
  criterio.
- `desgloseCuadra`: el caso exacto, el caso dentro de tolerancia, el caso
  fuera de tolerancia, y el caso límite exacto al centavo que reprodujo el
  bug — documentado en la prueba con la cifra exacta del error de punto
  flotante medido (`0.010000000000218279`) para que quien la lea entienda
  por qué existe sin tener que repetir la investigación.
- `etiquetaIva` en sus tres ramas.

---

## Lo que revisé y está bien

- **La familia `repo_*.test.ts` que la ronda 9 cerró sigue siendo el patrón
  correcto.** Releí `repo_huerfanos.test.ts` completo: un `from()` que
  registra tabla+método+argumentos en orden real (no un `vi.fn()` que
  contesta lo que se le pide) y distingue explícitamente `.is('resuelto_en',
  null)` de `.eq(..., null)` —el escenario exacto del hallazgo que cerró—,
  además de verificar que `error.code` (p. ej. `CU001`) sobrevive el viaje de
  vuelta y que el logging distingue "best-effort" (`warn`) de "cerrar mal SÍ
  importa" (`error`). Sigue siendo el estándar del repo, no decoración.
- **La disciplina de `skipIf` sigue enganchada a un self-check.**
  `pruebas_en_ci.test.ts` sigue fallando si aparece un `skipIf` nuevo que el
  paso separado de CI no alcance a correr — confirmé que los 4 usos actuales
  de `skipIf`/`describe.skipIf` en toda la suite son los mismos ya conocidos
  (dos pruebas de tiempo gateadas por `CUADRA_COBERTURA`, el arnés de ticket
  real gateado por `TICKET_PATH`) y ninguno es un skip silencioso.
- **`pagina_playwright.test.ts` (bajo reconciliación activa hoy, no lo
  toqué) es honesto sobre sus límites.** Corre un Chromium real contra un
  servidor HTTP local con la MISMA forma que CAPUFE, y su propio comentario
  de cabecera enumera explícitamente lo que NO puede probar (selectores del
  portal real, CAPTCHA, rate limiting, arranque de Chromium en Vercel) en vez
  de dejarlo implícito.
- **`npx eslint src/`** limpio: 0 errores.
- **Cero pruebas `.skip`/`.todo`/`xit` sin gatear**, cero archivos de prueba
  con nombre de respaldo (`_old`, `_v2`, `_copy`).

## Lo que no alcancé a revisar

- **No repetí el barrido de 12 mutantes que hizo la ronda 9.** Esta ronda fue
  un auditor solo sobre un solo rubro, no los doce en paralelo con
  orquestador; verifiqué por mutación las dos hipótesis específicas de esta
  tarea (`ocr_confianza`, y lo que salió de escribirle pruebas a `iva.ts`),
  no un barrido nuevo sobre el resto del código de dinero.
- **No verifiqué numéricamente el umbral de `test:coverage`** contra
  `vitest.config.ts`: no corrí `npm run test:coverage` con el umbral real,
  solo `vitest run` sin instrumentar.
- **No audité los mocks de Supabase fuera de la familia `repo_*.test.ts`** —
  el resto de la suite (processor, conv, facturación) usa patrones de mock
  más variados y no los comparé uno por uno contra el comportamiento real de
  PostgREST.
- **El hallazgo de seguridad que vi pasar por `operacion.test.ts`
  (`AUDITORÍA 10: crearViaje RECHAZA un operadorId de OTRA flota`)** es de
  otro rubro (backend/seguridad) y para cuando anclé ya estaba verde — no lo
  investigué más allá de confirmar que no era mío.
