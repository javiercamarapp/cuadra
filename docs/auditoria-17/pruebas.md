# Pruebas — auditoría 17

**Nota: 6/10** (antes 7). Razón del movimiento: **deuda que cobró factura** ·
**mirada más profunda**. El trinquete de cobertura sí mide (el hallazgo abierto
se cierra), pero el mecanismo con el que se subió resultó ser, en dos archivos
del camino del dinero, **borrar pruebas y llamarlo cobertura**. Y las dos zonas
de dinero que la ronda 16 estrenó —el callback de QStash y las tres rutas de
export— entraron con **cero** arnés.

> **El riesgo mayor del rubro, hoy:** el motor de cuadre está genuinamente
> anclado (tres mutaciones de control lo confirmaron), pero **todo lo que rodea
> al motor y toca dinero no lo está**. De 10 mutaciones dirigidas, **6
> sobrevivieron**, todas fuera de `cuadre/`: el endpoint público que emite CFDI,
> las tres descargas de dinero del contralor, el rollback del cobro de Stripe y
> la cifra que el chofer lee como "cuánto me falta".

---

## Compuerta, verificada por mí hoy

```
npx tsc --noEmit -p .   → 0 errores
npx vitest run          → 249 archivos · 3,148 verdes · 1 saltada
npm run lint            → 0 errores · 18 warnings
npx vitest run --coverage
   Statements 67.64% (12666/18723) · Branches 84.67% · Functions 79.86% · Lines 67.64%
   umbrales: 67 / 84 / 79 → PASA (margen 0.64 pt en líneas)
```

---

## Experimentos de mutación que corrí

Diez mutaciones, cada una revertida con `git checkout --` inmediatamente
después. Cuatro son **controles** (esperaba que fallaran) y sirven para
demostrar que el método detecta lo que hay que detectar.

| # | Qué rompí | Dónde | ¿La atraparon? | Salida real |
|---|---|---|---|---|
| 1 | `const resto = round2(anticipo - comprobado)` → sin `round2` | `src/lib/likida/chofer.ts:137` | ❌ **SOBREVIVIÓ** | `249 passed · 3148 passed \| 1 skipped` |
| 2 | `const tope = 0.15 * total` → `0.25 * total` (RFA 2.9) | `src/lib/likida/cuadre/engine.ts:337` | ✅ CAZADA | `2 failed` — `engine.test.ts:1470` `expected 500 to be 1500` |
| 3 | `if (!valido)` → `if (false)` **y** borrar `.is('cfdi_uuid', null)` | `src/app/api/cron/facturar/cola/route.ts:40,66` | ❌ **SOBREVIVIÓ** | `249 passed · 3148 passed \| 1 skipped` |
| 4 | `if (!puedeVerArea(t.rol,'dinero'))` y `if (!puedeExportar(t.rol))` → `if (false)` | `src/app/api/export/liquidaciones/route.ts:47,52` | ❌ **SOBREVIVIÓ** | `249 passed · 3148 passed \| 1 skipped` |
| 5 | `p_diferencia: liq.diferencia` → `-liq.diferencia` | `src/lib/likida/repo.ts:610` | ✅ CAZADA | `repo_escritura.test.ts:126` — `1 failed \| 10 passed` |
| 6 | `ok: porGasto.some(p => p.incluido)` → `ok: true` | `src/lib/likida/facturacion/agente.ts:325` | ❌ **SOBREVIVIÓ** | `249 passed · 3148 passed \| 1 skipped` |
| 7 | `mxn(liq.totalComprobado)` → `× 10` en el PDF | `src/lib/likida/liquidacion/pdf.ts:282` | ✅ CAZADA | `2 failed \| 28 passed` en `pdf_cifras.test.ts` |
| 8 | `total: round2(total)` → `round2(total * 2)` | `src/lib/likida/analytics.ts:582` | ❌ **SOBREVIVIÓ** | (corrida conjunta con la 9) `3148 passed` |
| 9 | `margenPct: … * 100` → `… * 1000` | `src/lib/likida/comercial.ts:147` | ❌ **SOBREVIVIÓ** | (corrida conjunta con la 8) `3148 passed` |
| 10 | borrar `await desmarcar(evt.id)` del `catch` | `src/app/api/stripe/webhook/route.ts:74` | ❌ **SOBREVIVIÓ** | `route.test.ts 5 passed`; suite completa `3148 passed` |

**Lectura:** el corazón (motor de cuadre, escritura del cierre, cifras del PDF)
está anclado de verdad — las tres mutaciones de control murieron en la primera
corrida y con mensajes que dicen exactamente qué se rompió. Todo lo que está a
un anillo de distancia, no.

---

## Hallazgos

### [CRÍTICO] El callback de QStash emite CFDI y no tiene una sola prueba: se le puede quitar la firma y la suite no se entera

`src/app/api/cron/facturar/cola/route.ts:40` y `:66`
(cobertura de líneas medida hoy: **0.0%**, 47 líneas)

**Escenario (experimento 3, corrido):** cambié `if (!valido) { … return 401 }`
por `if (false) { … }` —o sea, la verificación de firma de QStash se calcula y
se tira— y en el mismo commit borré el `.is('cfdi_uuid', null)` de la
re-validación de la cola. Corrí `npx vitest run` completo:

```
 Test Files  249 passed (249)
      Tests  3148 passed | 1 skipped (3149)
```

Cero fallos. Este endpoint es **público por diseño** (no lleva `CRON_SECRET`:
su única puerta es la firma) y lo que hace del otro lado es
`procesarLoteEnCola(...)`, que con `FACTURACION_MODO=emitir` teclea datos
fiscales en el portal del proveedor y **emite CFDI**. Con la firma bypasseada,
cualquiera que sepa la URL hace `POST` con
`{"lote":[{"id":"<uuid de gasto>", …}]}` y dispara la emisión. Con el `.is`
borrado, un ticket **que ya tiene `cfdi_uuid`** vuelve a entrar al portal: dos
CFDI por el mismo gasto.

Y no es solo el callback: la rama que lo encola —
`src/app/api/cron/facturar/route.ts:308` (`if (process.env.UPSTASH_QSTASH_TOKEN
&& lote.length > 0)`)— tampoco tiene prueba. `route.test.ts` (429 líneas, 24
casos) cubre a fondo el camino síncrono: la puerta del bearer, el orden de la
0063, un navegador por flota, el 503 de Chromium, el presupuesto de tiempo, el
modo ensayo. **Ninguno de los 24 pone `UPSTASH_QSTASH_TOKEN`.** El día que ese
env var exista en producción, el camino que corre es el que nadie probó nunca.

**Consecuencia:** un CFDI no se deshace. Cancelarlo fuera de plazo se le queda
al cliente en su contabilidad, y el propio portal lo advierte en rojo — es la
misma consecuencia irreversible que `registro.test.ts` documenta con tres
pruebas para el bug del `Map` por comercio. Aquí la superficie es más grande
(un endpoint abierto a internet) y las pruebas son cero.

**Causa raíz probable:** `91c41db` entró como cierre de ronda con cuatro
entregables en un commit ("QStash + régimen fiscal + ToS + plantilla Meta"); el
mensaje reporta `3,159 verdes · tsc 0 · build limpio` y ninguna prueba nueva
para las 127 líneas de código nuevo.

---

### [ALTO] La ronda 16 subió el trinquete BORRANDO anclas de dinero, y el archivo que decía arreglar sigue en el mismo 27%

`src/lib/likida/chofer.test.ts` (82 líneas hoy; 335 antes de `32d8f8a`)
`src/lib/likida/facturacion/agente.test.ts` (12 líneas hoy; 209 antes de `0867ab2`)

Esto responde al hallazgo abierto que me tocaba verificar. **El trinquete sí
mide** —lo corrí, da 67.64% contra un umbral de 67, y `test:coverage` es la
puerta de CI—, así que esa parte se cierra. Lo que no aguanta la lectura es
*cómo* se subió.

Los dos commits que el brief cita como la subida 64→67 son, en neto,
**borradores de pruebas**:

```
32d8f8a  "test(cobertura): +50 pruebas …"        266 insertions(+), 383 deletions(-)
0867ab2  "trinquete 64→67 … ~90 pruebas nuevas"   72 insertions(+), 239 deletions(-)
```

`chofer.test.ts` pasó de 335 a 81 líneas. Lo que se fue, con nombre y apellido:

- `'el faltante se redondea a centavos, que es lo que existe en un CFDI'` —
  probaba que `10600 − 8399.99` da `2200.01` y no `2200.0100000000002`.
- `'un anticipo negativo (captura errónea) se trata como sin anticipo'` — el
  lado del **panel**. El lado del WhatsApp sí sobrevive
  (`consulta_chofer.test.ts:517`); el del panel no.
- `describe('el panel y el WhatsApp no se contradicen')` — dos pruebas que
  ataban `resumenLiquidacion` (panel) con `armarRespuesta` (WhatsApp) a la
  misma cifra. Ese `describe` **ya no existe en ningún archivo del repo**
  (`grep -rn "armarRespuesta"` solo lo encuentra en `consulta_chofer.*`).
- `'el umbral es exclusivo: justo en 0.7 el comprobante está bien'` —
  `estadoComprobante(UMBRAL_OCR_DUDOSO)`. Hoy se prueba `0.5` y `0.95`: la
  frontera exacta quedó sin caso.

**Escenario (experimento 1, corrido):** quité `round2` de
`src/lib/likida/chofer.ts:137` — `const resto = anticipo - comprobado`. Con un
anticipo de $10,600.00 y $8,399.99 comprobados, el panel del chofer imprime
**`2200.0100000000002`** donde antes decía `$2,200.01`. Suite completa:
`249 passed · 3148 passed | 1 skipped`. Verde.

Y la razón declarada de aquel commit no se cumplió: el encabezado del archivo
dice *«COBERTURA (ronda 16): chofer.ts estaba a 27%»*. Medido hoy:

```
27.6   217  src/lib/likida/chofer.ts
28.8   146  src/lib/likida/facturacion/agente.ts
```

`chofer.ts` sigue en 27.6%. Y `agente.ts` —el que teclea el RFC en el portal—
bajó a 28.8% después de que `agente.test.ts` quedara reducido a dos
afirmaciones sobre `pideCaptcha`. (Refutación que sí prosperó: las tres pruebas
del `Map` por tenant **no se perdieron**, viven en
`facturacion/adaptadores/registro.test.ts:88-133` y son mejores que las
borradas. Ese ancla está bien. Las de `chofer` no se movieron a ningún lado.)

**Consecuencia:** el chofer compara la cifra del panel contra lo que le pagan.
Un `2200.0100000000002` en pantalla no es un bug que él reporte: es un motivo
para desconfiar del papel. Y peor que la cifra: el número de cobertura se puede
subir borrando casos, así que **el trinquete deja de ser señal** aunque el
mecanismo funcione.

**Causa raíz probable:** se optimizó la métrica (líneas ejecutadas) en vez de la
propiedad (mutaciones muertas) — exactamente lo que el propio
`vitest.config.ts:60-66` advierte que la métrica no prueba, escrito ahí por la
ronda 5.

---

### [ALTO] Las tres descargas de dinero del contralor están a 0%: el IDOR que el comentario dice arreglado se reabre sin que nada falle

`src/app/api/export/liquidaciones/route.ts:47,52` — 0.0%, 42 líneas
`src/app/api/export/pdf/[id]/route.ts:63,68` — 0.0%, 106 líneas
`src/app/dashboard/contador/cfdi/export/route.ts:43` — 0.0%, 64 líneas

**Escenario (experimento 4, corrido):** en la ruta del CSV convertí las dos
puertas de rol en `if (false)`:

```ts
// src/app/api/export/liquidaciones/route.ts
if (false) {                                  // era !puedeVerArea(t.rol,'dinero')
  return new NextResponse('Tu rol no ve las cifras de dinero…', { status: 403 });
}
if (false) {                                  // era !puedeExportar(t.rol)
  return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
}
```

Suite completa: `249 passed · 3148 passed | 1 skipped`. Verde.

Con eso, un usuario con rol `operador` —o `encargado`, que la 0044 deja fuera de
`ve_finanzas()`— hace `GET /api/export/liquidaciones` con su propia sesión y
baja el CSV con **folio, operador, anticipo, comprobado y diferencia de cada
viaje de la flota**. El comentario de esa misma ruta (líneas 31-37) narra ese
IDOR como un fallo ya cerrado y lo llama *«el patrón que este repo tiene
documentado como el fallo más común del código escrito por agentes»*. Lo cerró
un `if`, y ese `if` no tiene una sola prueba que lo sostenga.

Miré si algo estructural lo cubría por otro lado: `dinero_por_area.test.ts`
existe y es buena, pero su barrido es `readdirSync` sobre
`src/app/dashboard/*/page.tsx` + `vista.tsx`. **No mira `src/app/api/`**, que es
justo donde vive el archivo que entrega el CSV entero. `permisos.test.ts` y
`visibilidad.test.ts` prueban `puedeExportar`/`puedeVerArea` como funciones
puras — que la matriz es correcta —, nunca que la ruta las llame.

**Consecuencia:** el contralor compra el producto porque las cifras de nómina y
anticipo por chofer no se ven desde el piso. Un operador con el CSV de la flota
en la mano es una conversación de recursos humanos, y es el tipo de fallo que se
descubre después de que ya pasó.

**Causa raíz probable:** las rutas de API sí cuentan en la cobertura
(`vitest.config.ts` las excluye explícitamente de la exclusión de vistas), pero
nadie fue a por ellas: son las tres únicas rutas de dinero a 0% y no aparecen en
ningún `*.test.ts`.

---

### [ALTO] El rollback del candado de idempotencia de Stripe no se comprueba, y el warning de lint es exactamente el aviso

`src/app/api/stripe/webhook/route.ts:74`
`src/app/api/stripe/webhook/route.test.ts:17` (`'desmarcar' is assigned a value but never used`) y `:96`

Esto es el segundo de los warnings de `no-unused-vars` que el brief mandó
revisar, y sí resultó ser una aserción que se perdió.

El archivo de prueba declara el espía en la línea 17
(`const desmarcar = vi.fn(async () => {})`), nunca lo conecta a ningún mock, y
en la línea 96 escribe la confesión: `// desmarcar se verifica indirectamente:
el evento no queda clavado.` No se verifica de ninguna manera — el `expect` de
esa prueba es `expect(r.status).toBe(500)`, y el 500 lo devuelve el `catch`
tenga o no tenga rollback.

**Escenario (experimento 10, corrido):** borré `await desmarcar(evt.id);` del
`catch` de `route.ts`, dejando solo el `return … status: 500`.

```
 ✓ src/app/api/stripe/webhook/route.test.ts (5 tests) 14ms
 Test Files  1 passed (1) · Tests 5 passed (5)
```

Y la suite completa: `3148 passed | 1 skipped`. (Confirmé que no hay otro
archivo que lo cubra: solo `route.test.ts` y `suscripcion_eventos.test.ts`
mencionan `evento_stripe`, y el segundo prueba `marcarEvento`, no el webhook.)

Con esa línea fuera: llega `checkout.session.completed`, `marcarEvento` inserta
la marca, `aplicar(evt)` truena (un blip de red a Supabase basta), se devuelve
500, Stripe reintenta, `marcarEvento` ve el 23505 y responde `repetido: true`
con un 200 — y el plan **nunca se activa**. El propio código lo describe en
`route.ts:85-87`: *«es el caso que deja un pago cobrado sin plan activo, y se
arregla a mano desde /admin»*.

**Consecuencia:** hoy Likida es pre-revenue, así que nadie está afectado. Pero
este es el primer camino de dinero *entrante* que va a existir, y el ancla que
lo protege se puede borrar sin que nada se ponga rojo.

**Causa raíz probable:** el espía se creó con la intención de aseverar y la
aseveración nunca se escribió; el comentario "se verifica indirectamente"
selló el hueco en vez de abrirlo.

---

### [MEDIO] `comercial.ts` — seis pantallas de dinero del panel, 200 líneas, 0% y ningún test

`src/lib/likida/comercial.ts` (0.0%, 200 líneas) · `src/lib/likida/analytics.ts:560-585` (`getGastoPorRuta`)

**Escenario (experimentos 8 y 9, corridos juntos):**

- `analytics.ts:582` — `total: round2(total)` → `round2(total * 2)`. El bloque
  "gasto por ruta" del **Resumen de flota** (el que se proyecta en el demo)
  imprime el doble en cada una de sus cinco barras.
- `comercial.ts:147` — `margenPct: … * 100` → `… * 1000`. La pantalla
  `/dashboard/rentabilidad` reporta un margen de **182%** donde el real es
  18.2%.

Suite completa con las dos puestas: `249 passed · 3148 passed | 1 skipped`.

`comercial.ts` alimenta `/dashboard/clientes`, `/rentabilidad`, `/cobranza`,
`/cotizador`, `/mapa` y `/soporte`, y hace aritmética de dinero propia:
`margenPct`, `porCobrar`, `vencido`, la concentración del cliente más grande.
Cero pruebas. `getGastoPorRuta` entró en `563c507` con el commit diciéndolo por
escrito: *«No se agregó prueba nueva para getGastoPorRuta — sigue el mismo
patrón sin prueba directa que su hermana getStatsPorOperador»*. La premisa es
falsa: `getStatsPorOperador` **sí** tiene prueba directa
(`analytics_datos.test.ts:124-146`).

**Atenuante que sí aplica (y por eso es MEDIO y no ALTO):** `cliente`,
`factura_emitida`, `pago_recibido` y `viaje.ingreso_flete` están vacías (MAPA),
así que hoy esas pantallas caen al estado vacío y el `margenPct` devuelve `null`
por la guarda `ingreso > 0`. El riesgo se arma el día que alguien escriba la
primera fila. `getGastoPorRuta` **no** tiene ese atenuante: lee `gasto` y
`viaje`, que sí tienen datos, y ya está en la pantalla del demo.

**Causa raíz probable:** el módulo se escribió con la disciplina correcta
(`traerTodo`, `round2` importado, `null` en vez de cero) y sin el arnés que
demuestre que esa disciplina se sostiene.

---

### [MEDIO] `verificaciones.sql` no lo corre nadie, y `migraciones_verificadas.test.ts` solo comprueba que el número esté escrito en un título

`supabase/verificaciones.sql` (3,168 líneas, 61 bloques)
`src/lib/likida/migraciones_verificadas.test.ts:39-41` y `:98-108`

Busqué quién ejecuta ese archivo: `grep -rn "verificaciones.sql"` sobre
`*.sh`, `*.yml`, `*.json`, `*.ts` y `*.md` devuelve solo prosa (README,
HANDOFF, PROMPT-SESION-NUEVA) y el propio test. `.github/workflows/` tiene un
único archivo (`ci.yml`) y sus cinco pasos son `npm ci`, typecheck, lint,
`test:coverage`, `vitest run fundamento duplicados` y `build`. `scripts/` tiene
`seed.sh`, `respaldo.sh`, `deploy-vercel.sh` y `cosecha`. **Nada lo corre.**

Lo que `migraciones_verificadas.test.ts` hace es leer las líneas
`^-- ── \d+\.` de `verificaciones.sql` y exigir que el número de cada migración
aparezca en alguna. Es una buena red contra el olvido —así se cazó la 0030— pero
no ejecuta una sola sentencia.

**Escenario concreto con la 0085:** la 0085 arregla que
`config_tenant_valida` asignaba un `jsonb` a una variable `record`, con lo cual
**cualquier `UPDATE` de cualquier columna de un `tenant` que tenga
`facilidadCombustibleEfectivo` declarada** revienta con *"input of anonymous
composite types is not implemented"* — el alta y el panel no pueden guardar
nada. Si mañana alguien revierte ese `CREATE OR REPLACE FUNCTION` y hace push:
`tsc` limpio, `eslint` limpio, `3,148` verdes, `build` limpio, CI verde. La
prueba de la 0085 vive en el bloque 61 de `verificaciones.sql:3151-3164`, que
hay que abrir y pegar a mano en el SQL editor de Supabase.

**Consecuencia:** 61 garantías que solo la base puede demostrar —unicidad,
claims atómicos, permisos de `anon`, este CHECK— dependen de que alguien se
acuerde. El modo de falla es el mismo que el del `ignoreCommand` de Vercel que
el CLAUDE.md describe: silencioso.

**Causa raíz probable:** correr SQL en CI pide una base efímera (o el
`supabase` CLI con Docker), que es una inversión de infraestructura que nadie
ha hecho.

---

### [BAJO] La prueba saltada: qué es y qué deja fuera

`src/lib/likida/arnes_ticket_real.test.ts:365`

Es la única (`1 skipped` de 3,149; bajo `--coverage` son 3, las otras dos son
los `skipIf(CUADRA_COBERTURA)` de tiempo, que sí corren en su propio paso de
CI).

```ts
const GRUPOS = (process.env.TICKET_PATH ?? '').split(';')…      // línea 68
describe.skipIf(GRUPOS.length === 0)('arnés: tickets reales', …) // línea 365
```

**Por qué está saltada:** sin `TICKET_PATH` apuntando a fotos reales de
comprobantes, no hay nada que procesar. Corre con `npm run ticket` y hace
llamadas de visión de verdad (`extraerComprobante` → OpenRouter), o sea que
cuesta dinero por corrida. El salto es correcto y está bien construido: la
condición es la ausencia del insumo, no un `it.skip` puesto a mano.

**Qué deja sin cubrir:** es el **único** camino que va de una foto real a una
liquidación pasando por el código de producción entero —`extraerComprobante` →
`decidirFoto` → `cuadrarViaje` → `afirmarFormaDeLiquidacion`—. Nada en CI
comprueba que lo que el OCR de verdad devuelve tenga la forma que el motor
necesita. Atenuante fuerte: los dos afirmadores (`afirmarFormaDeExtraccion`,
`afirmarFormaDeLiquidacion`) sí se prueban con datos sintéticos en el mismo
archivo (líneas 340-363), incluido el caso del peso que se cae de las tres
cubetas. Lo que falta es el eslabón vivo, no la lógica de la aserción.

---

### [BAJO] Warnings de `no-unused-vars` en pruebas: revisé los seis, uno era real

Reporto el resultado del barrido que pedía el brief, para que nadie lo repita:

| Warning | Veredicto |
|---|---|
| `stripe/webhook/route.test.ts:17` `desmarcar` | **Aserción perdida de verdad** → hallazgo ALTO de arriba |
| `analytics_por_dia.test.ts:13` `pideConteo` | Falso positivo con olor: es un `const pideConteo = false` muerto dentro del mock. No perdió una aserción, pero delata que el mock devuelve `count: undefined` siempre, así que la prueba de completitud de `traerTodo` no se ejercita por ahí |
| `processor_cierre.test.ts:114` `tabla` | Real pero menor: el mock de `supabaseAdmin().from(tabla)` **ignora el nombre de la tabla** y devuelve el mismo constructor para todas. Las pruebas del processor no pueden distinguir en qué tabla se escribió |
| `suscripcion_eventos.test.ts:41` `planDePrice` | Falso positivo: el import de arriba sobra, pero `planDePrice` sí se prueba en `:108-111` con un re-import dinámico |
| `administracion.test.ts:304,305` `a` | Falso positivo: rest args de un `mockImplementation` |
| `transferencia_mensualidad.test.ts:25` `registro` | Falso positivo: objeto muerto dentro del constructor del mock |

---

## Lo que revisé y está bien

- **El CI corre en cada push de cada rama, y sus pasos son los correctos.**
  `.github/workflows/ci.yml:22-24` (`branches: ['**']` + `pull_request`),
  `concurrency` con `cancel-in-progress`, y **cinco** puertas: `npm ci`,
  typecheck, lint, `test:coverage` (el umbral, no `npm test` a secas) y
  `npx vitest run fundamento duplicados` para las dos que `--coverage` salta.
  Esto último es un cierre real de la ronda 7 y sigue vivo.
- **`pruebas_en_ci.test.ts` es la mejor red estructural del repo.** Escanea
  `src/` buscando `skipIf(…CUADRA_COBERTURA)` **sobre el código sin
  comentarios** para no detectarse a sí mismo, y falla si un archivo saltado no
  cae bajo ningún filtro del paso de tiempo (`:63-72`). Además exige que exista
  al menos un salto (`:52-56`): sin eso, la red pasaría por vacía el día que
  desapareciera el último `skipIf`.
- **El trinquete de cobertura mide de verdad.** Lo corrí: 67.64/84.67/79.86
  contra 67/84/79. No es un umbral movido a ciegas. **Aviso:** el comentario de
  `vitest.config.ts:107-112` declara la medición del 5-ago (líneas 68.07 ·
  ramas 84.74 · funciones 79.58) y ya no es la realidad — líneas y ramas
  bajaron, el margen en líneas pasó de ~1.07 a **0.64** puntos. `comercial.ts`
  sola (200 líneas a 0%) vale ~0.7 puntos.
- **El motor de cuadre está anclado donde importa.** La mutación del 15% de la
  RFA 2.9 (`engine.ts:337`) murió en `engine.test.ts:1470` con un mensaje que
  dice el número exacto, y la prueba de al lado exige además que el excedente
  se reporte **por comprobante** y no acumulado
  (`expect(sobre15.every(d => d.monto <= 1000)).toBe(true)`).
- **`repo_escritura.test.ts` es el modelo de cómo se prueba una escritura de
  dinero.** El fixture usa valores distintos entre sí a propósito
  (`:89-100`) para que una **permutación** de parámetros —mandar el IVA donde
  va el IEPS— también se vea. Mi mutación del signo de `p_diferencia` murió ahí
  en 587 ms.
- **`pruebas_en_ci.test.ts` — el archivo de arriba de todo (`resumen.ts`).**
  Cada mutación histórica (M14 ×10, M16 signo invertido) tiene su prueba con el
  ID de la mutación en el nombre del `it`, y cada rama **niega explícitamente**
  el texto de la otra (`expect(texto).not.toMatch(/de tu bolsa|a favor tuyo/)`)
  — sin esa negación, intercambiar las ramas dejaría la prueba verde.
- **Las dos pruebas de tiempo están endurecidas contra la intermitencia, no
  relajadas.** `fundamento.test.ts:148-168` y `duplicados.test.ts:151-185`
  usan mejor-de-nueve y mejor-de-cinco con calentamiento, y documentan la
  corrida real que las tumbó (28-jul, 126 ms y 10.8) y por qué el umbral nuevo
  sigue cazando lo que tiene que cazar (ReDoS son segundos, no milisegundos).
  Barrí la suite: solo 3 archivos usan `new Date()` y ninguna aserción depende
  de la hora de pared. **No encontré una sola prueba flaky.**
- **`registro.test.ts:88-133`** ancla el bug del CFDI con el RFC de otra flota
  con tres pruebas que miden `capturado` (lo que se habría tecleado en el
  portal), no la estructura del `Map` — y la de "una flota sin lote abierto"
  además exige `r.error).not.toContain(FLOTA_A.rfc)`.
- **`filasDeducibilidad`** (`deducibilidad.test.ts`) cubre la regla que importa
  —si las tres cubetas no suman el comprobado, **no se imprime**— con el caso
  real del render ($4,812 debajo de $4,600), la tolerancia del centavo y la
  liquidación vieja sin repartir. El tono `condicionado` del permiso CRE está
  cubierto aparte, en `permiso_cre_no_verificable.test.ts:85-89`.
- **`stripe.test.ts`** es real: construye el HMAC con `node:crypto` y prueba
  replay (t−400), cuerpo alterado, sin secreto, encabezado basura y rotación de
  llaves múltiples. Nada de mockear la función que se está probando.
- **`migraciones_verificadas.test.ts`** cierra sus dos huecos de simetría: una
  exención de una migración que ya no existe falla (`:114-119`) y una exención
  con razón de menos de 20 caracteres también (`:121-124`).
- **`dinero_por_area.test.ts`** lee `page.tsx` **y** su `vista.tsx` hermano
  como una sola superficie, que es el hueco que se tapó el 4-ago cuando mover
  una columna de pesos de un archivo al otro apagaba el despertador. Declara
  honestamente que es un despertador y no una demostración (`:26-32`).

---

## Lo que NO alcancé a revisar

- **`al_vuelo.test.ts` (46 KB, el archivo de prueba más grande del repo).** Lo
  leí en diagonal. Cubre `al_vuelo.ts` al 87.6%, pero **mockea
  `facturarLoteConAgente`** (`:27-43`), que es donde vive `completar()` — la
  función cuya mutación #6 sobrevivió. Queda por auditar si el resto de sus
  aserciones son sobre valor o sobre "se llamó".
- **`engine.test.ts` (86 KB).** Mutación puntual verde de mi parte, pero no
  barrí sus ~600 casos buscando aserciones flojas. Es la mitad del rubro que
  falta.
- **`repo.ts` al 56.7% de 557 líneas.** Verifiqué `addGasto` y
  `saveLiquidacion` (bien anclados). Las otras ~26 funciones exportadas
  —`resolverHuerfanos`, `corregirFechaGasto`, `updateGastoCfdiXml`,
  `reclamarCodigoPendiente`, `getAcumuladoCombustible`,
  `resolverSolicitudArco`— no las miré una por una.
- **`processor.ts` al 81.8% de 947 líneas.** No mapeé qué 18% falta.
- **`pruebas-manuales/`** (16 arneses). Los listé y no los corrí, por
  instrucción. No verifiqué si alguno quedó desalineado con el renombre
  `cuadra → likida`.
- **Cobertura de ramas por archivo.** Solo miré líneas y funciones; el 84.67%
  global de ramas puede esconder un archivo de dinero con ramas muertas.

---

## Estado del árbol

`git status --short` al terminar:

```
?? docs/auditoria-17/
```

Solo la carpeta de esta auditoría, sin trackear. **Cero archivos del producto
modificados.** Las diez mutaciones se revirtieron con `git checkout -- <archivo>`
inmediatamente después de cada corrida; verifiqué el árbol limpio después de
cada una. No hice ningún commit.
