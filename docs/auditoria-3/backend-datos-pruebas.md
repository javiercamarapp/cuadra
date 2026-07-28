# Backend y API — nota 7/10 (antes 6)

Nota anterior: 6. El único hallazgo ALTO de la ronda pasada —el mutex perdido
que dejaba correr el agente sin protección— está corregido y ahora tiene test
de integración propio. Sube un punto por eso, no más: aparece un patrón nuevo
(cache de tools de solo lectura) que ya tenía un hueco de diseño y que el
código nuevo de esta ronda vuelve más caro, y una pieza de esta misma ronda
(el reembolso laboral por demora) está construida de punta a punta pero
desconectada de la base de datos.

## Hallazgos

### [CERRADO, verificado] El mutex ahora abandona el turno
`src/lib/cuadra/processor.ts:436-441`. Confirmado contra el código actual: el
`else` de `acquireViajeLock` ya no sigue de largo — hace `return` inmediato,
en silencio, con el comentario explicando por qué es seguro (`false` significa
"otro turno tiene el lease y va a responder"; los errores de RPC no llegan
aquí porque `acquireViajeLock` es fail-open). Y ahora hay
`src/lib/cuadra/processor_lock.test.ts`, que prueba la INTEGRACIÓN (no solo el
lock aislado): con lock ocupado, `runAgent` no se llama y tampoco se manda
`sendText` — con un test de control ("con el lock TOMADO, corre el agente")
que evita que el caso negativo pase vacío. Es exactamente lo que pedía el
hallazgo ALTO de la ronda anterior. No lo repito como hallazgo.

### [MEDIO] `cuadrar_viaje` no está en la lista de tools cacheables entre rondas — y ahora carga más
`src/lib/llm/openrouter.ts:399-400` define `READ_PREFIXES = ['get_', 'check_',
'list_', 'find_', 'consultar_', 'validar_']` y `isReadOnly` solo mira el
prefijo del nombre. `cuadrar_viaje` (`src/lib/cuadra/tools.ts:43`) no empieza
con ninguno de esos prefijos, así que `isReadOnly('cuadrar_viaje') === false`
— aunque su propia descripción diga "NO cierra la liquidación" y sea de
lectura pura. Consecuencia concreta en `openrouter.ts:501,509`: el
`crossRound` cache (que si evitaría la re-ejecución) nunca se puebla para esta
tool. Dentro de una MISMA ronda sí se deduplica (`inRound`, línea 506-507,
agnóstico de `isReadOnly`), pero si el agente la llama en la ronda 1 y otra
vez en la ronda 3 —nada en el prompt (`src/lib/agents/prompts.ts:23-31`) se lo
prohíbe, y con `maxRounds=6` hay margen— la tool se ejecuta OTRA VEZ completa.

Antes de esta ronda, repetir `cuadrar_viaje` costaba `cuadrarDesdeDB`: 3
queries en paralelo (`desde_db.ts:11-15` — `getViaje`, `getGastos`,
`getConfig`). Ahora (`tools.ts:64-72`) cada repetición además dispara
`getAcumuladoCombustible` — una CUARTA query que, como se detalla abajo, no
tiene índice que la sostenga y escanea `gasto` completa. El costo marginal de
una repetición pasó de "3 queries acotadas a un viaje" a "3 queries acotadas +
1 sequential scan de toda la tabla". Con 6 rondas de margen, el peor caso
(agente que llama la tool 2-3 veces por indecisión o por un round intermedio
con args mal formados) multiplica ese scan.

**Sí está protegida contra fallo** (respuesta a la pregunta del rubro): el
bloque entero está en `try { } catch (e) { logger.warn(...) }`
(`tools.ts:65-72`); si `getAcumuladoCombustible` truena, `periodo` queda
`undefined`, la respuesta de la tool simplemente omite
`combustible_efectivo_ejercicio`, y el cuadre no se cae. Eso está bien hecho.
Lo que falta es la parte de costo, no la de robustez.

### [ALTO] La sección de "lo que se le debe al operador por demora" nunca puede activarse: falta el `SELECT`
`src/lib/cuadra/repo.ts:37-53` (`getViaje`) selecciona
`'id, folio, origen, destino, anticipo, fecha_inicio, fecha_fin'` y el objeto
que devuelve (líneas 44-52) no incluye `demoraNoImputable` en ningún lado.

Esto importa porque el resto de la cadena SÍ está construida: la migración
`supabase/migrations/0020_viaje_demora_no_imputable.sql` agrega la columna
`viaje.demora_no_imputable`; `src/types/cuadra.ts` (bloque `Viaje`) ya declara
`demoraNoImputable?: boolean`; y `src/lib/cuadra/liquidacion/pdf.ts:312-317`
ya arma la sección "LO QUE SE LE REEMBOLSA AL OPERADOR" leyendo
`viaje.demoraNoImputable` para pasárselo a `resumenLaboral`. Pero el único
lugar del código que trae un `Viaje` desde la base —`getViaje`, usado tanto
por `cuadrarDesdeDB` como por el handler de `guardar_liquidacion` en
`tools.ts:115`— nunca pide esa columna. **Entra:** un contralor marca
`demora_no_imputable = true` en la fila del viaje (asumiendo que exista un
camino para escribirlo, ver hallazgo del rubro de datos). **Sale:** el PDF
nunca imprime la sección de obligación del art. 263 fr. I, porque
`viaje.demoraNoImputable` llega `undefined` a `resumenLaboral` sin importar lo
que diga la base — el `if (ctx.demoraNoImputable && OBLIGACION_263.has(...))`
de `laboral/pagadero.ts:56` nunca es cierto. La función está bien probada en
aislamiento (`pagadero.test.ts`), pero la integración real está rota desde el
primer eslabón.

## Lo que está sólido

- El mutex, ya descrito arriba: corregido y con test de integración honesto.
- `saveLiquidacion`/`addGasto` (ver rubro de Pruebas) ya no son el hueco que
  eran; el mapeo de ~25 campos a columnas está probado, incluyendo los casos
  `0`/`false` que `??` vs `||` suele romper.
- El manejo de errores de la nueva query (`getAcumuladoCombustible`) es
  correcto: lanza si Supabase falla (`repo.ts:419`), y el llamador en
  `tools.ts` decide no propagar ese fallo al cuadre.

## Qué subiría la nota

1. Agregar `'cuadrar_viaje'` (o un mecanismo explícito de "tool sin efectos
   secundarios" en vez de adivinar por prefijo) a lo que `isReadOnly` cachea
   entre rondas — es la forma más barata de neutralizar el costo nuevo.
2. Sumar `demora_no_imputable` al `select` de `getViaje` en `repo.ts:38`. Una
   línea, y desbloquea una función que ya está escrita, probada y conectada
   al PDF por los otros tres lados.
3. Verificar que exista (o crear) un camino de escritura para
   `viaje.demora_no_imputable` — hoy no hay ninguna ruta en `src/app` que la
   toque (ver rubro de datos). Sin eso, arreglar el punto 2 no cambia nada en
   producción: la columna seguiría siempre en `NULL`.

---

# Modelo de datos y esquema — nota 7/10 (antes 7)

Se sostiene en 7, no sube ni baja: lo sólido de la ronda anterior (RLS
completo pero con el mismo aislamiento manual de siempre, `uq_gasto_cfdi_uuid`
cerrando el hallazgo textual) sigue igual — no lo repito. Lo nuevo confirma un
patrón: el equipo construye la lógica pura y la conecta al PDF antes de que el
esquema tenga el dato completo que esa lógica necesita. Van tres ejemplos del
mismo patrón, no uno.

## Hallazgos

### [ALTO] El contador del 15% no sabe si la facilidad APLICA al tenant
`src/lib/cuadra/periodo/combustible.ts` y `repo.ts:408-430`
(`getAcumuladoCombustible`) calculan la razón efectivo/total sin verificar
ninguna de las dos condiciones que la propia ficha del proyecto exige para que
la facilidad exista:

```yaml
# normas/rfa-2026-2.9.yaml:32-36
condiciones_de_aplicacion:
  - "Dedicados EXCLUSIVAMENTE al autotransporte terrestre de carga federal"
  - "Tributar en Título II Cap. VII (coordinados) o Título IV Cap. II Secc. I (PF act. empresarial)"
  - "El efectivo no puede exceder el 15% del total pagado por combustible en el ejercicio"
```

`tenant` (`supabase/migrations/0001_init.sql:9-13`, más `config jsonb` de la
0004 y `razon_social`/`domicilio_fiscal`/`url_aviso_privacidad` de la 0018) no
tiene ningún campo de régimen fiscal ni de actividad exclusiva. **Entra:** un
tenant que tributa en un régimen distinto (o que no es exclusivamente
autotransporte federal de carga). **Sale:** el mismo aviso confiado —
`avisoTope15` (`periodo/aviso.ts:29`) dice "Vas en 12.4% del 15% que permite
la RFA 2026 regla 2.9" citando una facilidad que, para ESE tenant, podría no
aplicar en absoluto. La propia ficha lo marcaba como pendiente
(`pendiente_en_producto: "El CONTADOR del 15% por ejercicio no existe
todavía"`) — ahora el contador existe, pero la condición de elegibilidad que
la misma ficha lista arriba sigue sin capturarse en ningún lado.

### [ALTO] `viaje.demora_no_imputable` (migración 0020, sin comitear) no tiene camino de escritura
Además de que `repo.ts` no la lee (ver rubro de Backend), no encontré NINGUNA
ruta en `src/app` que la escriba — busqué `demora_no_imputable` y
`demoraNoImputable` en todo `src/` con `command grep` (no con el `grep`
envuelto, por la trampa del entorno) y las únicas apariciones son el tipo, la
migración, `pagadero.ts`/`pagadero.test.ts` y `pdf.ts`. La columna existe, el
motor la consume, el PDF la imprime — pero no hay UI, ni endpoint, ni RPC que
la ponga en `true`. Hoy es una columna que solo puede llegar a `NULL`, para
siempre, sin importar qué tan real sea la demora. No es solo un hueco de
backend: es un campo que el esquema tiene pero que el producto no expone —
tres capas construidas (DB, motor, PDF) alrededor de un dato que nadie puede
capturar todavía.

### [MEDIO] `operador` tampoco tiene el dato que `topeDescuento` necesita
`src/lib/cuadra/laboral/pagadero.ts:87-91` (`TopeDescuentoInput`) requiere
`salarioMensual` para aplicar los dos topes del art. 110 fr. I. `operador`
(`0001_init.sql:29-36`) tiene `nombre, telefono, numero_empleado, activo` —
sin salario. Confirmé con `command grep` que `topeDescuento` no tiene NINGÚN
caller fuera de su propio test: es la misma situación que
`getStatsPorOperador` en la auditoría anterior (código correcto, cero
consumidores) pero con una razón estructural adicional — aunque alguien lo
conectara hoy, no hay de dónde leer el salario. Tercer ejemplo del mismo
patrón (el primero es el régimen fiscal del tenant, el segundo la demora del
viaje): lógica legal correcta, escrita antes de que el esquema tenga el dato
que la alimenta.

### [MEDIO] `getAcumuladoCombustible` no tiene índice que la sostenga
Ver detalle de mecanismo en el rubro de Backend. Desde el ángulo de esquema:
`supabase/migrations/` (las 20, verificado con `command grep -n "create index"
*.sql | command grep gasto`) solo indexa `gasto(viaje_id)`
(`0001_init.sql:90`) y los dos únicos parciales de la 0015/0019
(`img_hash`, `cfdi_uuid`, ambos con alcance de tenant+viaje o tenant). No hay
`tenant_id` solo ni compuesto. La query nueva
(`repo.ts:412-418`: `.eq('tenant_id', ...).eq('concepto','diesel').gte('fecha',
...).lte('fecha', ...)`) no puede usar ningún índice existente para arrancar
el filtro — Postgres tiene que recorrer TODA la tabla `gasto` (de TODOS los
tenants, porque no hay índice que empiece por `tenant_id`) y descartar fila
por fila. Con un tenant de 50,000 gastos en el ejercicio esto no revienta por
memoria (son dos columnas numéricas, `.select('monto, forma_pago')`, sin
paginar pero acotado — el riesgo real no es la memoria, es el I/O del scan
completo, pagado en cada llamada, y potencialmente varias veces por turno por
el hallazgo de `isReadOnly` de arriba). Falta una migración con
`create index on gasto(tenant_id, concepto, fecha) where monto > 0` (o
similar) antes de que el volumen de datos lo haga doloroso.

## Lo que está sólido

- Todo lo que la auditoría anterior ya dio por bueno (RLS por tabla, el índice
  único de CFDI, el aislamiento manual sin fugas en los lectores que revisé)
  sigue exactamente igual — no encontré regresión.
- El manejo de `NULL` en `getAcumuladoCombustible` es correcto: un gasto sin
  `forma_pago` NO se cuenta como efectivo (`repo.ts:427`, comentario explícito
  de por qué: "no se sabe, y suponerlo inflaría el numerador contra la
  flota"). Coherente con el resto del proyecto (fail-closed en lo fiscal).

## Qué subiría la nota

1. Un campo de régimen/elegibilidad en `tenant` (aunque sea un booleano
   "aplica_rfa_2026_2.9" capturado a mano en el alta, mientras no haya UI) y
   que `evaluarTope15`/`avisoTope15` lo consulten antes de afirmar el 15%.
2. El índice de `gasto(tenant_id, concepto, fecha)` antes de que haya un
   segundo cliente con volumen real.
3. Decidir sobre `viaje.demora_no_imputable` y `operador.salario_mensual`: o
   se construye el camino de escritura (dashboard del contralor) en el mismo
   ciclo en que se construye el consumidor, o se documenta explícitamente como
   "listo para cuando exista la UI" — hoy no hay ninguna señal de cuál de las
   dos es, y así es indistinguible de un olvido.

---

# Pruebas — nota 7/10 (antes 6)

Sube un punto real: el hueco más caro de la ronda anterior — "el cálculo del
dinero está probado, la ESCRITURA no tiene ni un arnés" — está cerrado, y el
mutex tiene ahora su primer test de integración. La suite pasó de 360 tests
(39 archivos) a **486 tests (50 archivos)**, verificado corriendo
`npm test -- --run` contra el código actual: los 486 pasan.

## `saveLiquidacion`/`addGasto`: confirmado que ya tienen test, y son honestos
`src/lib/cuadra/repo_escritura.test.ts`. Hice el chequeo de mutación a mano
sobre cada aserción relevante:

- **`addGasto` — "un 0 NO se guarda como NULL"** (línea 53-61): si alguien
  cambia `g.iepsTraslado ?? null` por `g.iepsTraslado || null` en
  `repo.ts:99`, `0 || null` da `null` y el test truena. Real.
- **`addGasto` — "lo ausente sí va como NULL, no como undefined"** (línea
  70-78): si alguien deja de mapear un campo (lo omite del objeto en vez de
  poner `?? null`), Supabase omitiría la columna y el DEFAULT ganaría en
  silencio — el test compara contra `toBeNull()` explícito y fallaría. Real.
- **`addGasto`/`saveLiquidacion` — "un error de la base SÍ se lanza"**
  (líneas 80-83, 117-120): si se quita el `if (error) throw` de
  `repo.ts:105` o `:332`, el `await expect(...).rejects.toThrow(...)` falla.
  Real.
- **Gap encontrado, no descalificante:** "manda cada total a su parámetro"
  (repo_escritura.test.ts:104-111) usa `toMatchObject` con
  `p_tenant, p_viaje, p_total_comprobado, p_total_anticipo, p_diferencia,
  p_estatus, p_iva, p_peaje` — pero NO verifica `p_ieps` ni `p_diferencias`,
  aunque `saveLiquidacion` sí los manda (`repo.ts:327-328`). Si alguien
  intercambiara `p_ieps: liq.iepsAcreditable` por
  `p_ieps: liq.ivaAcreditable` por error, el nombre del test ("cada total")
  promete más de lo que la aserción cubre, y esa mutación específica pasaría
  sin ser detectada.

Veredicto: los tests de escritura son honestos en lo que afirman explícitamente
probar. El caso de arriba es un hueco de cobertura dentro de un archivo por lo
demás sólido, no un test que miente.

## Huecos por riesgo (lo siguiente en la fila)

Con la escritura y el mutex ya cubiertos, el hueco de mayor riesgo que sigue
sin tocar es el mismo que señalaba la ronda anterior y que sigue exactamente
igual, verificado con `command grep`:

- **`sat.ts` sigue sin un solo test.** `src/lib/cuadra/intake/sat.ts` decide
  fraude (lista 69-B) y cancelación por regex sobre la respuesta del SAT —
  cero referencias en archivos `*.test.ts`. Es la pieza que decide
  `cfdi_efos` (el veredicto más severo del motor, ahora con norma
  `cff-69-B` recién agregada) y no tiene arnés.
- **`generateWithTools` sigue con un solo archivo de test** que cubre
  exclusivamente costo por fallback (`openrouter_fallback_costo.test.ts`).
  `LoopGuardError`, `PartialExecutionError`, y el propio `isReadOnly`/
  `crossRound` (el mecanismo del hallazgo de Backend de arriba) no se
  disparan en ningún test — con la novedad de que ahora tienen un caso
  concreto y barato que probar: "una tool no-prefijada como `cuadrar_viaje`
  se re-ejecuta en la ronda 2 aunque los args sean idénticos" fallaría hoy
  si se escribiera, y confirmaría el hallazgo de Backend con un test en vez
  de con lectura de código.

## Los 4 tests elegidos (normas/, periodo/, laboral/) — ¿pasarían con el código roto?

**1. `periodo/combustible.test.ts:20-24` ("la razón es efectivo sobre el
total de COMBUSTIBLE") — SÍ pasaría con código roto, en el punto que más
importa legalmente.** Solo afirma `r.razon` y la constante `TOPE_EFECTIVO`;
NO afirma `r.estado`, aunque el caso usado (`efectivo:15_000,
totalCombustible:100_000`) cae EXACTO en el límite (razón = 0.15). Revisé
las 10 pruebas del archivo: ninguna otra usa una razón de exactamente 0.15
verificando `estado`. Mutación concreta que sobrevive: cambiar
`razon > TOPE_EFECTIVO` por `razon >= TOPE_EFECTIVO` en
`periodo/combustible.ts:85` — que decidiría "excedido" (deducción perdida)
justo en el caso límite en el que la norma sí protege ("no excedan el 15%").
Ningún test en el repo detecta ese cambio.

**2. `laboral/pagadero.test.ts:52-62` ("el art. 263 fr. I cubre hospedaje y
alimentación, NO cualquier gasto") — honesto.** Prueba con `concepto: 'otro'`
y `demoraNoImputable: true` que el veredicto sea `'sin_criterio'`, no
`true`. Mutación: si alguien agregara `'otro'` al `Set` `OBLIGACION_263`
(`pagadero.ts:42`), el veredicto pasaría a `true` con fundamento
`lft-110-111-263`, y la aserción `expect(r.pagadero).toBe('sin_criterio')`
fallaría. Real.

**3. `normas/por_diferencia.test.ts:74-82` ("el efectivo en combustible trae
la regla Y su excepción") — honesto, y con literales derivados a mano.**
Verifica que `combustible_efectivo` traiga TANTO `lisr-27-fr-III` COMO
`rfa-2026-2.9`, y además ancla `NORMAS['rfa-2026-2.9'].jerarquia` a `3` y
`NORMAS['lisr-27-fr-III'].jerarquia` a `1` — valores tecleados a mano, no
derivados del índice mismo. Si alguien quitara cualquiera de las dos normas
de `NORMA_POR_DIFERENCIA['combustible_efectivo']` en `por_diferencia.ts:28`,
el `expect.arrayContaining` fallaría. Real.

**4. `normas/normas_sincronizadas.test.ts:66-78` ("las CITAS coinciden con
las de la ficha, no solo su cantidad") — honesto, y con memoria de un bug
real.** Lee el YAML de disco de forma independiente (no importa `indice.ts`
para eso) y compara `NORMAS[f.id].citas` contra `citas_en_codigo` del YAML
campo por campo. El propio comentario del test documenta que la versión
anterior solo comparaba longitudes y dejó pasar `rlisr-57` con
`citas_en_codigo: []` en la ficha mientras el índice decía `["RLISR 57"]` —
exactamente el tipo de desincronización silenciosa que ya mordió una vez con
el mapa `CONCEPTO`. Mutación: cualquier cita que se edite en el índice sin
tocar el YAML (o viceversa) hace fallar este test. Real.

## Lo que está bien probado (nuevo desde la ronda anterior)

- **`processor_lock.test.ts`** — integración del mutex, con test de control.
  Ver detalle en Backend.
- **`repo_escritura.test.ts`** — mapeo de escritura, con el matiz de
  cobertura anotado arriba.
- **`normas/fundamento.test.ts`** — `guardiaFundamento` probado sobre texto
  real (no mocks): deja pasar cita permitida, quita cita inventada
  conservando la legítima, y suaviza lenguaje de obligación para normas no
  vinculantes (nivel 5/6) sin borrar la información. Las aserciones son sobre
  el string de salida real, no sobre texto fuente — no cae en el antipatrón
  que señalaba `writing-good-tests.md`.
- **`periodo/aviso.test.ts`** — encadena `evaluarTope15` → `avisoTope15` de
  verdad (no mockea el primero) y verifica cifras derivadas a mano
  ($2,000.00 de margen a partir de 13,000/100,000), no recalculadas con el
  propio código bajo prueba.
