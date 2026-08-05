# Rendimiento y costo — auditoría 10

Anclado a `cbbdcb023fa715bc40700357e25dd387ce25ccb4` (HEAD al empezar).

**Arranco con el árbol sucio** (~30 archivos modificados sin commitear, otras
sesiones activas en el mismo repo, una de ellas con `npm run dev` corriendo en
el puerto 3117). Por la regla del skill, esto apaga el autofix: audito y
documento, no toco código. El único hallazgo que habría sido candidato a
arreglo rápido —el desfase de presupuesto del cron de facturación, abajo— vive
en un archivo (`route.ts`) que otra sesión pudo estar tocando; se deja
propuesto.

**Nota: 7/10** (igual que ronda 9). Razón del no-movimiento, con las tres
formas que exige el criterio de la síntesis:

1. **Se atacó y subió**: los dos hallazgos ALTO/MEDIO de la ronda 9 —la espera
   bloqueante de `esperarReclamoDeFoto` cobrándose del presupuesto de intake—
   ya NO EXISTEN. El protocolo de dos fotos se rediseñó de raíz hoy (commit
   `b89aa32`): de un `while` que sondeaba y esperaba hasta 3.8-19s dentro de
   los 20s de `esperarIntake`, a un check-and-claim no bloqueante
   (`pegarCodigoEnEspera`, `processor.ts:81-93`) que consulta una bandeja, hace
   un claim atómico y sigue — sin esperar a nadie. Verificado por ausencia: no
   queda ni un `HOLD_FOTO_MS`, `POLL_FOTO_MS` ni `esperarReclamoDeFoto` en el
   repo.
2. **Deuda que cobró factura, antes de que cobrara de verdad**: la ronda 9
   dejó anotado que `traerTodo()` cortaba a 100,000 filas sin loguear "si un
   tenant algún día supera 100,000 filas... el bucle simplemente termina sin
   log". Hoy (`1cc1e2a`) eso se cerró de raíz: `traerTodo` (`pg.ts:137-175`)
   ahora **lanza** `LecturaIncompleta` con `logger.error` si no puede probar
   que trajo todo, y el mismo commit calculó la fecha en que iba a doler
   (`llm_costo`: 100,000/2,000 filas·día = día 50) y la migración 0062 sacó esa
   tabla del camino moviendo la agregación a SQL **antes** de que llegara ese
   día. Es prevención medida, no reacción.
3. **Pero apareció un hallazgo nuevo, del mismo calibre, en la superficie más
   nueva y de mayor riesgo del día**: el motor de portales de facturación
   (creado hoy, `0e9f7e6`) tiene un presupuesto de tiempo que su propio
   comentario contradice a sí mismo — ver el ALTO de abajo. No es "lo mismo
   otra vez": es código que no existía en la ronda 9, con un defecto de la
   misma familia que el que se acaba de cerrar (peor caso que no cabe en su
   límite). Compensa el progreso real de arriba.

## Hallazgos

### [ALTO] El cron de facturación puede necesitar más tiempo del que su propio comentario admite, y no hay ningún corte que lo detenga a medio camino
`src/app/api/cron/facturar/route.ts:17` (comentario de arriba), `:99`
(`TOPE_POR_CORRIDA = 8`), `:320` (`for (const [tenantId, porPortal] of
porFlota)`), `:349` (`await conNavegador(...)`, sin deadline),
`src/lib/cuadra/facturacion/adaptadores/pagina_playwright.ts:71-73` (el
supuesto: "el arranque... se paga UNA vez por lote")

**La aritmética no cuadra en el propio comentario del archivo.** `route.ts:14`
dice: *"Un lote abre UN navegador por flota y una sesión de portal por ticket:
10-60 s cada una."* Y `route.ts` (comentario de `TOPE_POR_CORRIDA`, línea ~94)
dice: *"A 60 s el peor caso, ocho llenan el presupuesto de 300 s con margen."*
8 × 60 s = 480 s. Eso no cabe en 300 s con margen — lo excede por 180 s, un
60% de más. La cuenta que el propio archivo escribe para justificar el tope no
prueba lo que dice probar.

**Por qué el peor caso es real y no un accidente de redacción.** La cola se
arma con los 8 gastos más viejos **de toda la base, cruzando tenants**
(`route.ts:225-232`: `.order('autofactura_intentada_en', ...).order
('created_at', ...).limit(TOPE_POR_CORRIDA + 1)`), sin ninguna preferencia por
agrupar. El diseño de esta ronda SÍ agrupa por flota y dentro por portal
(`correrLote`, `route.ts:288-303`) para amortizar el costo de la sesión — pero
esa agrupación ocurre DESPUÉS de elegir los 8, no antes. Si esos 8 gastos
pertenecen a 8 flotas distintas —escenario común, no exótico: son 96 empresas
censadas como prospecto, y basta que unas pocas operen ya con 1-2 tickets
pendientes cada una en el momento en que corre el cron cada hora—, la
agrupación no amortiza nada: son 8 sesiones independientes, cada una pagando
su propio arranque de navegador y su propia sesión de portal completa.

Sumado con los topes documentados del propio archivo
(`pagina_playwright.ts:84,99,117,120,123,129`): `TOPE_LANZAR_MS=30_000` +
`TOPE_NAVEGAR_MS=20_000` + 4 `escribir` de datos fiscales × `TOPE_ACCION_MS
=8_000` (`capufe.ts:846-849`) + selector de régimen con su camino de reserva
(`escribir`+`hacerClic`+`leerTexto` ≈ 19s, `capufe.ts:997-1020`) + clic de
continuar (8s) + escribir el código del ticket (8s) + clic "Validar Código"
(8s) + leer la fila resultante, 4 columnas × `TOPE_LECTURA_MS=3_000`
(`capufe.ts:920-923`) + `TOPE_CAPTURA_MS=10_000` (la captura de evidencia
siempre viaja en modo ensayo) ≈ **147 s por sesión de una sola flota, un solo
ticket**, en el peor caso donde cada espera se acerca a su techo sin fallar
(el mismo criterio de "sumar el peor caso de la cadena" que la ronda 9 usó
para el protocolo de dos fotos). Con solo **dos** flotas en ese escenario ya
se rebasan los 300 s de `maxDuration`.

**Y no hay ningún freno.** El `for` de `route.ts:320` no consulta el reloj
antes de abrir el siguiente navegador — a diferencia de `presupuesto.ts`/
`acotada()`, que sí llevan ese criterio en el resto del repo (`TOPE_CONSULTA_MS`,
`PASOS_CIERRE`). Nada impide que la corrida entre a la sesión número 3 con 10 s
de presupuesto restantes.

**Consecuencia, y por qué no es solo lentitud.** El claim
(`autofactura_intentada_en`, `al_vuelo.ts:203`) se escribe ANTES de abrir el
navegador — eso sí está bien pensado, evita que un portal caído acapare la
cola. Pero si Vercel mata la invocación a los 300 s **a media sesión de
portal, en modo `emitir`**, el CFDI puede haberse timbrado YA en el SAT (es lo
que el propio portal advierte como irreversible) sin que `cfdi_uuid` se
alcance a escribir de vuelta (`al_vuelo.ts` escribe el UUID después del
intento, no antes). El claim expira a los `CLAIM_MINUTOS=10` minutos
(`al_vuelo.ts:590`) y ese mismo ticket vuelve a entrar a la cola la corrida
siguiente — con riesgo real de una segunda emisión sobre un consumo que ya
tiene CFDI. Hoy el modo por defecto es `ensayo` (no emite de verdad), así que
el riesgo está dormido — pero es exactamente el patrón que CLAUDE.md ya marca
como el día que importa: el defecto se estrena el día que `FACTURACION_MODO`
se ponga en `emitir`.

**No se arregla en esta ronda** (árbol sucio, y el archivo es del trabajo en
vuelo de hoy). La dirección más barata sería que el `for` de `route.ts:320`
compruebe el tiempo transcurrido contra `maxDuration` antes de abrir cada
navegador nuevo y corte el lote ahí — el mismo patrón que `acotada()` ya
resuelve para consultas. TOPE_POR_CORRIDA en 8 asumiendo un solo navegador por
corrida (como dice `pagina_playwright.ts:71-73`) contradice el diseño real
(un navegador por flota, `route.ts:320`); conviene que los dos comentarios se
pongan de acuerdo con el código antes de tocar el número.

## Lo que revisé y está bien

- **El protocolo de dos fotos, rediseñado.** Ya no existe el `while` que
  sondeaba (`esperarReclamoDeFoto`/`HOLD_FOTO_MS`/`POLL_FOTO_MS` del ALTO y el
  MEDIO de la ronda 9, verificado por `grep` que no aparecen en ningún
  archivo). El mecanismo nuevo (`pegarCodigoEnEspera`, `processor.ts:81-93`;
  `getCodigosPendientes`/`reclamarCodigoPendiente`/`enriquecerGastoConCodigo`,
  `repo.ts:439-515`) consulta una bandeja UNA vez, hace un claim atómico
  (`UPDATE ... RETURNING`) y sigue sin esperar — el presupuesto de
  `esperarIntake` (20s) ya no paga ningún impuesto de esperar a un
  acercamiento que quizás nunca llega. Explícitamente declarado sin tocar en
  el commit `b89aa32`: el bloqueo del lector de códigos se midió en 613 ms
  (no 1.7 s como se creía) y el pool de abajo ya lo reduce 7-13×.
- **Pool de concurrencia en el webhook de WhatsApp** (`route.ts:40-59` del
  webhook, `MAX_EN_PARALELO=5`, función `conPool`). Antes `Promise.all` sin
  tope dejaba que N fotos de una ráfaga compartieran los 120 s de una
  invocación sin que ninguna lo supiera; si Vercel mataba la invocación se
  perdían las N fotos sin una línea de log (el `finally` del intake no corre).
  El número 5 está medido, no adivinado: en una M2 de 8 núcleos, 20 fotos en
  paralelo bloquean el event loop hasta 1.7 s de golpe (el lector de códigos
  de barras es síncrono); con 5 baja a menos de 0.5 s. Tiene su propia prueba
  (`route_pool.test.ts`).
- **Los índices de escala (0060, 0061, 0071) — verificados contra la base
  real, no solo leídos.** Confirmé con el MCP de Supabase que las tres
  migraciones están aplicadas en el proyecto `Likida`
  (`gngoqsvrxdguxvsizpbw`): `indices_para_escala`, `indices_de_paginacion`,
  `0071_indices_de_borrado` aparecen en `list_migrations`. Las tres traen
  `EXPLAIN ANALYZE` antes/después contra volumen sembrado realista (10
  tenants, hasta 400 mil filas), no contra la base de 40 filas de hoy —
  0061 documenta explícitamente la trampa del tenant único que habría dado un
  falso verde. Ganancias medidas: 43× en `gasto` por `created_at desc limit
  100`, 286× en el trigger de FK de `llm_costo` al borrar una flota, 5.2× en
  el borrado completo de un tenant con 2,000 viajes. El costo del lado
  contrario también se midió, no se asumió: 1.1 µs extra por INSERT en
  `gasto` por los dos índices nuevos de escritura.
- **Cross-check contra el advisor de rendimiento de Supabase.** De los 17
  `unindexed_foreign_keys` que el advisor reporta hoy, todos caen en una de
  las categorías que 0071 ya descartó por escrito y a propósito: FK contra
  `tenant` (padre chico, `campania_tenant_id_fkey`, `terminal_tenant_id_fkey`,
  `codigo_pendiente_tenant_id_fkey`), FK compuestas cuya primera columna ya
  quedó indexada por 0071 (`gasto_viaje_tenant_fkey`,
  `liquidacion_viaje_tenant_fkey`, `viaje_operador_tenant_fkey`,
  `comprobante_huerfano_operador_tenant_fkey`), o FK contra tablas catálogo /
  de personal (`ticket_mensaje_autor_id_fkey`, `factura_saas_suscripcion_id
  _fkey`, `politica_gasto_tenant_id_fkey` — esta última de la tabla MUERTA que
  CLAUDE.md ya marca). El advisor no encontró ningún hueco que 0071 no hubiera
  razonado ya. (Los 33 `unused_index` del mismo reporte son ruido esperado:
  los índices se acaban de crear hoy sobre una base casi vacía, cero tráfico
  real que los haya usado todavía — no es señal de nada.)
- **El agregado de costo de IA movido a SQL (0062, `resumen_costo_ia`).**
  Comparó TRES estrategias con `EXPLAIN ANALYZE` contra 400,131 filas
  sembradas — CTE materializada (2,870 ms), seis subconsultas independientes
  (9,132 ms, 174,551 buffers), y `GROUPING SETS` en un solo recorrido (7,488
  ms, 36,023 buffers, 4.8× menos páginas leídas). Y hay un dato que dice más
  del rigor que cualquiera de las ganancias: PROBÓ el índice de cobertura
  obvio y lo DESCARTÓ porque, medido, salía más lento (975 ms contra 848 ms
  sin él) pese a que el planeador lo hubiera elegido — el tipo de verificación
  que esta misma auditoría le pide al resto del repo ("el número contra el
  número, no 'se siente rápido'"). `getResumenNegocio`/`getCostoPorFaseModelo`
  (`negocio.ts`) ahora cruzan la red UNA fila en vez de traer `llm_costo`
  entera dos veces.
- **Los tres módulos nuevos del panel (`comercial.ts`, `operacion.ts`,
  `negocio.ts`) — cero N+1.** Los tres siguen el mismo patrón: `Promise.all`
  trayendo cada tabla completa (vía `traerTodo`/`conteo`), y toda la
  agregación —por cliente, por operador, por unidad, por tenant— ocurre
  DESPUÉS, en memoria, con `Map`. Ningún `for` de esos archivos hace una
  consulta por vuelta; los `for (const v of viajes)` que aparecen recorren un
  arreglo ya traído completo. Revisé `getCartera`, `getRentabilidad`,
  `getCargaOperadores`, `getUnidades` y `getResumenNegocio` línea por línea
  con ese criterio.
- **`KpiTile`/`useCountUp` — sin costo notable.** Cada tile corre su propio
  `requestAnimationFrame` durante 600 ms, pero React 18 batchea los `setState`
  que caen en el mismo frame (todos los rAF programados para el mismo tick se
  ejecutan juntos), así que N tiles no son N re-renders del árbol, son un solo
  commit por frame con N componentes hoja actualizados. Y el máximo real
  medido por archivo es 8 tiles en una sola página (`valor-ahorro/page.tsx`);
  la mayoría tiene 3-4. No es el hallazgo de rendimiento que parecía a
  simple vista — el `$0.00` en el HTML servido que reporta `frontend.md` de
  esta misma ronda es un bug de CORRECCIÓN (SSR sin animar), no de costo.
- **Costo de IA / caché de prompt — sin cambios hoy.** `openrouter.ts` no
  aparece en el log de hoy. `cache_control: { type: 'ephemeral' }` sigue
  puesto en el system prompt de `generateWithTools`
  (`openrouter.ts:600-606`), y el modelo por rol (OCR barato, cuadre caro
  solo donde importa) sigue igual. Nada que reportar porque nada cambió; ya
  quedó cubierto en rondas anteriores.

## Lo que no alcancé a revisar

- **La ruta de XML del CFDI** (`processor.ts:858-972`) contra el reloj
  compartido de la ráfaga — la ronda 9 tampoco la sumó a mano y yo tampoco
  esta vez; el tiempo se fue al cron de facturación, que es la superficie más
  nueva y arriesgada del día.
- **El costo real medido en producción de una liquidación completa.** Sigue
  siendo una estimación en el código ($0.015/visión, $0.03-0.05/liquidación),
  no un dato de facturación de OpenRouter contrastado — no tengo acceso a esa
  cuenta.
- **`round2()` duplicado en 4 archivos de dinero** (deuda de arquitectura de
  rondas previas). Sigue sin ser de este rubro; lo dice `MAPA.md`.
- **Si el escenario de 8-flotas-distintas del hallazgo ALTO ocurre HOY en la
  práctica.** No tengo el conteo real de cuántos tenants tienen gastos
  pendientes de facturar en este momento — el hallazgo es sobre el peor caso
  que el propio código admite, no sobre una medición en producción con datos
  reales (la base de este proyecto Supabase está casi vacía).
- **El comportamiento exacto de Vercel al matar una invocación a mitad de
  `page.goto()` o `page.fill()` de Playwright** — si el proceso del navegador
  queda huérfano, si `SesionNavegador.cerrar()` alcanza a correr en un
  `finally` truncado. Es más una pregunta de operabilidad (fuga de procesos)
  que de presupuesto de tiempo, y así la dejo para ese rubro.
