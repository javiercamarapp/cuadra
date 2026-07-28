# Cumplimiento fiscal — nota 7/10 (antes 6)

Método: verifiqué primero los dos críticos de la auditoría anterior contra el código
ACTUAL (no contra el reporte), corriendo `npm test` sobre los módulos tocados. Luego
audité lo nuevo: `normas/` (18→19 fichas), `periodo/combustible.ts` + `repo.ts:getAcumuladoCombustible`,
`laboral/pagadero.ts`, el reordenamiento de `engine.ts` y el prorrateo de IVA de LIVA
5-I. Usé `command grep` para toda conclusión de ausencia. Reproduje el hallazgo más
fuerte (IVA sobre-acreditado) con la fórmula exacta del código en un script aparte —
evidencia en el hallazgo 1.

## Verificación de los críticos anteriores

**Ambos quedaron cerrados. Verificado contra código, no contra el reporte.**

1. **IEPS acreditable ya no sale en pesos.** `engine.ts:382` fija `iepsAcreditable = 0`
   como constante ("no es una cifra que este motor pueda calcular"), y en vez de eso
   cuenta `litrosDieselAcreditables` (`engine.ts:438-440`, solo con pago electrónico:
   `pagoElectronico = !!g.formaPago && g.formaPago !== '01'`). `pdf.ts:288-292` imprime
   los litros ("Diésel elegible para el estímulo de IEPS... 1,234 L"), no una cifra en
   pesos, con la nota de que la cuota es semanal y el contador debe aplicarla. La ficha
   `lif-2026-20-A.yaml` sigue diciendo exactamente lo mismo que citaba el hallazgo
   original ("cuota vigente × LITROS. No es el IEPS trasladado"). `iepsAcreditable`
   sigue existiendo como campo (para no romper consumidores/columna BD) pero SIEMPRE es
   0 — ya no hay forma de que salga una cifra fabricada. Confirmado con
   `npx vitest run engine.test.ts` (83/83 verdes) y lectura directa de `pdf.ts:283-292`.

2. **`sin_cfdi` ya no da dos veredictos.** `engine.ts:470` (`NO_DEDUCIBLE_ISR`) ya NO
   incluye `sin_cfdi` — el comentario de las líneas 460-469 explica el porqué casi
   palabra por palabra del hallazgo original ("el veredicto dependía de un flag de
   configuración, no de la ley"). Ahora, tenga o no la política `requiereCfdi`, TODO
   gasto sin `cfdiUuid` cae en la misma rama genérica (`engine.ts:486`, `!g.cfdiUuid →
   totalPorConfirmar`), con el mismo pie ámbar "se puede recuperar". `NO_DEDUCIBLES_PDF`
   en `pdf.ts:16-19` coincide exactamente con `NO_DEDUCIBLE_ISR` de `engine.ts:470` (las
   mismas 6 entradas) — ya no hay dos fuentes de verdad divergentes. Un ticket sin
   timbrar categorizado como "factura" ($3,000, `requiereCfdi: true`) y uno de diésel
   sin timbrar ahora salen IGUAL: ámbar, "por confirmar".

## Hallazgos

### [ALTO] El prorrateo de IVA de LIVA 5-I sobre-acredita cuando varios gastos comparten el tope diario y el "ancla" no es el más grande

`src/lib/cuadra/cuadre/engine.ts:344-350` (elección del ancla) y `:404-410` (cálculo de
`proporcion`) — norma: LIVA art. 5, fr. I (ficha `liva-5.yaml`,
`verificado_fuente_primaria`): "en la proporción en la que dichas erogaciones sean
deducibles".

Qué hace el código: cuando varios gastos de `alimentacion`/`viaticos` caen el MISMO día
y juntos exceden el tope de $750 (LISR 28-V), el excedente completo se cuelga del
ÚLTIMO gasto del arreglo `input.gastos` de ese día (`delDia[delDia.length - 1]`, sin
ordenar por monto — el orden es el de llegada a la BD, no hay `ORDER BY` en la consulta
de `repo.ts`). Al calcular el IVA acreditable, la `proporcion` de CADA gasto se
computa por separado (`(monto - excedenteDeEste) / monto`) y se recorta con
`Math.max(0, ...)`. Cuando el excedente atribuido al ancla es MAYOR que el propio monto
del ancla, el recorte a 0 **pierde** la parte del excedente que debería haber reducido
el IVA de los OTROS gastos del día — que, al no tener el diff propio, se acreditan al
100%.

Caso concreto, reproducido con la fórmula exacta del motor
(`node -e` ejecutando línea por línea `engine.ts:337-359` y `:404-410`, no una
suposición):

    Mismo día: G1 = $1,000 alimentación, IVA trasladado $160 (llega primero)
               G2 = $50 alimentación,   IVA trasladado $8   (llega último → ancla)
    Tope diario: $750 → excedente = $300, colgado entero de G2.

    proporción(G1) = (1000 - 0)   / 1000 = 1.00  → IVA acreditado: $160 (COMPLETO)
    proporción(G2) = max(0, (50 - 300)/50) = 0   → IVA acreditado: $0

    ivaAcreditable del motor: $160
    Proporción agregada correcta del día: (1050-300)/1050 = 71.43%
    IVA correcto (71.43% × $168 de IVA total del día): $120

    Sobre-acreditamiento: $40 sobre este único día de un solo viaje.

`totalDeducible`/`totalNoDeducible` (los que ve el contralor en Totales) SÍ cuadran en
agregado por una casualidad de diseño (la resta negativa de `g.monto - excedente` en el
ancla compensa el exceso de los demás — ver `engine.ts:490-492`), pero el `ivaAcreditable`
NO tiene ese mismo mecanismo compensador porque se recorta con `Math.max(0, ...)` gasto
por gasto. Es exactamente la dirección cara que la propia ficha `liva-5.yaml` señala:
*"acreditar de más es del lado caro para el cliente: es el cliente quien responde ante
una revisión, y el papel se lo dio Likida."* Ningún test cubre este caso: los tests de
`viatico_excede_fiscal` con varios comprobantes el mismo día usan montos IGUALES
(`engine.test.ts:549-560`, 3×$400), donde el ancla-concentración da por casualidad el
mismo resultado que el prorrateo correcto (lo verifiqué algebraicamente: coincide solo
cuando todos los gastos del día tienen la misma tasa de IVA Y el excedente no supera el
monto del ancla). El test de LIVA 5-I (`engine.test.ts:1027-1037`) solo prueba UN gasto
por día, nunca varios el mismo día.

Le cuesta al cliente: nada directamente (es sobre-acreditamiento, no pérdida), pero le
sube el riesgo ante una revisión del SAT sobre una cifra que el PDF presenta en verde
como "recuperable" citando LIVA art. 5. Se agrava con más comprobantes por día (varias
comidas) y cuando el operador sube las fotos en un orden que no coincide con el monto.

### [ALTO] La obligación del LFT 263-I ("se debe pagar aunque no sea deducible") es inalcanzable en producción: el dato existe en la BD pero nadie lo lee

`supabase/migrations/0020_viaje_demora_no_imputable.sql:18` agrega la columna
`viaje.demora_no_imputable boolean` — norma: LFT arts. 110 fr. I, 111, 263 fr. I (ficha
`lft-110-111-263.yaml`, `verificado_fuente_primaria`, creada este mismo ciclo).

Qué hace el código: `src/lib/cuadra/laboral/pagadero.ts:56` solo declara "SE DEBE pagar"
(obligación dura del patrón, manda sobre política y sobre deducibilidad) cuando
`ctx.demoraNoImputable === true`. Ese valor llega desde `pdf.ts:317`
(`demoraNoImputable: viaje.demoraNoImputable`), y `viaje` sale de `getViaje()`
(`src/lib/cuadra/repo.ts:35-52`). Pero el `select` de esa función
(`repo.ts:38`) es:

    .select('id, folio, origen, destino, anticipo, fecha_inicio, fecha_fin')

— sin `demora_no_imputable`. La columna existe en la BD (migración 0020, la más nueva
del ciclo junto con 0021) y el objeto que arma `getViaje()` (líneas 44-52) tampoco la
mapea. `command grep -rn "demora_no_imputable" src/` solo encuentra la migración: NINGÚN
archivo de `src/` la lee de la base ni la escribe (no hay endpoint, tool ni pantalla de
dashboard que la capture). Resultado: `viaje.demoraNoImputable` es SIEMPRE `undefined`
en producción, así que la rama de `pagadero.ts:56` NUNCA se ejecuta, sin importar qué
tan claro sea el caso (bloqueo carretero de 3 días, demora de aduana documentada).

Es el mismo patrón que el hallazgo BAJO de RLISR 57 en la auditoría anterior
(`operadorRfc` no llegaba a `cuadrarViaje`) — una excepción legal bien fundamentada y
bien probada (`pagadero.test.ts`, 14 tests verdes) que hoy no hace su trabajo por un
eslabón de plomería faltante. Lo subo a ALTO (no BAJO como el de RLISR 57) porque aquí
sí hay consecuencia real y no solo neutra: sin esta rama, TODO caso de hospedaje/
alimentación que exceda política por una demora ajena al operador cae en el bucket
`sin_criterio` de `pagadero.ts:67-73` ("Descontarlo exige acuerdo con él... lo revisa el
contralor"), que en la práctica invita a NEGOCIAR algo que la ley ya obliga a pagar por
completo — el contralor no tiene ninguna señal de que el 263-I aplica, porque el dato
que lo activaría nunca llega. No es un número inventado (no rompe la regla fundacional
de `guardia.ts`), pero sí es la funcionalidad nueva de este ciclo llegando muerta al
producto.

### [MEDIO] El contador del 15% (RFA 2026 regla 2.9) consulta el AÑO EQUIVOCADO durante ~6 horas cada 31 de diciembre

`src/lib/cuadra/tools.ts:66` — norma: RFA 2026 regla 2.9 (ficha `rfa-2026-2.9.yaml`,
`verificado_fuente_primaria`) + `docs/fase1/spec-contadores-periodo.md` (ejercicio
fiscal = año calendario, CFF art. 11).

Qué hace el código: `const ejercicio = new Date().getUTCFullYear();`. México (CDMX,
donde opera la flota) está en UTC-6. De las 18:00 a las 23:59 hora de Ciudad de México
del 31 de diciembre, el reloj UTC YA cruzó a la medianoche del 1 de enero — `getUTCFullYear()`
devuelve el AÑO SIGUIENTE. `getAcumuladoCombustible(tenantId, ejercicio)`
(`repo.ts:408-419`) entonces consulta `gasto` filtrando `fecha >= {añoSiguiente}-01-01`,
un rango vacío (nada se ha registrado todavía en ese año). `evaluarTope15`
(`periodo/combustible.ts:69-91`) recibe `{efectivo: 0, totalCombustible: 0}` y cae en la
rama `total <= 0` (línea 75-78): devuelve `estado: 'holgado'` — el aviso MÁS
tranquilizador posible (`aviso.ts:24-25` retorna `null`, ni siquiera se le dice algo al
contralor) — exactamente en la ventana en que un tenant que va cerca del 15% (o ya lo
rebasó) más necesita ver el aviso `cerca` o `excedido`, porque es el cierre del
ejercicio y ya no hay margen para corregir el medio de pago.

Cuánto cuesta: no inventa una cifra en el PDF (el contador es "mejor esfuerzo", envuelto
en `try/catch` en `tools.ts:65-72`), pero silencia la única alerta que existe para este
tope precisamente en las últimas horas del año en que actuar todavía sirve de algo. Caso
concreto: una flota va en 14.9% de efectivo el 31-dic a las 20:00 hora CDMX (`estado`
real = `cerca` o `excedido`); ese día, cualquier `cuadrar_viaje` consulta el ejercicio
{año+1} vacío y responde `holgado` — cero aviso — cuando el correcto era avisar que ya
se pasó o está a punto.

### [MEDIO] El contador del 15% puede subcontar: filtra `concepto = 'diesel'` en la BD, pero `engine.ts` reconoce combustible por una definición más amplia

`src/lib/cuadra/repo.ts:416` (`.eq('concepto', 'diesel')`) contra
`src/lib/cuadra/cuadre/engine.ts:112` — norma: RFA 2026 regla 2.9 (ficha
`rfa-2026-2.9.yaml`), sección "Base de cálculo" de `docs/fase1/spec-contadores-periodo.md:52-73`,
que es explícita: *"El denominador es TODO el combustible pagado en el ejercicio... no
un monto fijo por ticket."*

Qué hace el código: por viaje, `esCombustible` (`engine.ts:112`) es
`g.concepto === 'diesel' || (!!h && h.claves.includes(g.claveProdServ ?? ''))` — es
decir, un gasto cuenta como combustible si su `concepto` dice "diesel" O si su clave SAT
(leída del XML) coincide con la lista de hidrocarburos, sin importar cómo se etiquetó el
`concepto`. Pero `getAcumuladoCombustible` (`repo.ts:408-419`), que alimenta el contador
del ejercicio, solo filtra `concepto = 'diesel'` — no considera `claveProdServ`.

Un ticket de diésel que el OCR clasificó como `concepto: 'otro'` (letra borrosa, mala
lectura) pero cuyo XML sí trae la clave `15101505` SÍ dispara el aviso
`combustible_efectivo` a nivel de viaje (`engine.ts:123-124`, "cuenta contra el tope del
15%"), pero NUNCA entra al numerador ni al denominador del contador real del ejercicio
— el `.eq('concepto', 'diesel')` lo descarta en la consulta SQL antes de sumarlo. El
aviso por-viaje y el contador del ejercicio quedan usando dos definiciones distintas de
"es combustible", y la más autorizada (la del contador real) es la más estrecha. El
riesgo es subcontar, no sobrecontar: el `razon` que ve el contralor puede estar por
debajo del real.

## Otras dos observaciones fiscales, sin caso que las rompa (opinión, no hallazgo)

- **`cff-69-B.yaml` no distingue "presunto" de "definitivo" en el código.** La propia
  ficha (líneas 28-35) es explícita: la consecuencia dura ("no producen ni produjeron
  efecto fiscal alguno") es del listado DEFINITIVO; el listado presunto todavía da al
  emisor un plazo para desvirtuarlo. `sat.ts:68` mapea el código `'100'` del SAT como
  *"presunto/definitivo 69-B (documentado)"* — un único código para dos estados con
  efectos distintos según la propia ficha — y `engine.ts:207` trata ambos igual
  (`cfdi_efos` → `NO_DEDUCIBLE_ISR`, veredicto duro). No tengo fuente en este repo sobre
  qué códigos exactos devuelve el `ConsultaCFDIService` del SAT para distinguir presunto
  de definitivo, así que no puedo construir el caso que falla — lo dejo como pregunta
  abierta, no como hallazgo verificado.
- **Peaje al 50% sobre `SubTotal` (H4 de `lif-2026-20-A.yaml`) sigue `SIN RESOLVER`.**
  No es nuevo — ya lo reportó la auditoría anterior como MEDIO y la propia ficha lo
  mantiene como pregunta abierta para un contador (usar el total podría duplicar el
  beneficio del IVA). Sigue igual en `engine.ts:412`. No lo vuelvo a puntuar aparte.
- **`combustible_efectivo` niega el IVA acreditable por completo, incluso dentro del
  15%.** Es intencional y conservador: `SIN_ACREDITAMIENTO` (`engine.ts:376`) excluye
  TODO diésel pagado en efectivo del cálculo de IVA, sin distinguir si ese pago
  específico cae dentro o fuera del 15% (el motor, puro y por viaje, no tiene ese dato).
  Es la dirección barata para el SAT y cara para el cliente — consistente con el
  principio que la propia ficha `liva-5.yaml` fija ("acreditar de más es lo caro"). No
  lo marco como hallazgo: es una decisión de diseño defendible, documentada en el propio
  comentario de `engine.ts:432-435`, no un error.

## Barrido de `por_diferencia.ts` contra `engine.ts`

Los 24 `TipoDiferencia` que emite `engine.ts` están cubiertos, cada uno, por
`NORMA_POR_DIFERENCIA` o por `SIN_NORMA` en `src/lib/cuadra/normas/por_diferencia.ts` —
ninguno queda sin clasificar. Verifiqué además que cada `norma_id` citado ahí existe en
`normas/indice.ts` y coincide con el `id:` real del YAML correspondiente (`command grep
-n "^id:" normas/*.yaml` contra el índice, uno por uno) — sin ids huérfanos ni
desincronizados. `npx vitest run` sobre `por_diferencia.test.ts` y
`normas_sincronizadas.test.ts` (9+9 tests) confirma que el propio repo ya se protege de
esta desincronización con un test dedicado.

## Lo que sigue sólido de la ronda anterior (no se tocó, sigue bien)

- RFA 2026 regla 2.9 (diésel en efectivo), LISR 28-V (tope $750/día), RLISR 57
  (viático a nombre del operador), LISR 27-III (tope $2,000 efectivo) — mismas
  líneas que en la auditoría anterior, sin cambios de fondo que las rompieran.
- El complemento de hidrocarburos sigue en dos niveles sin declarar fraude sin
  verificar (`engine.ts:218-236`).
- `privacidad.ts` y `leyendas.ts` no se tocaron en este ciclo (fuera del alcance del
  "qué cambió" del MAPA) — no los re-audité a fondo, confío en la verificación anterior.

## No cubrí

- No verifiqué a fondo `intake/sat.ts` más allá del punto EFOS del hallazgo de
  opinión — no es parte de "lo nuevo" del MAPA.
- No corrí `pruebas-manuales/*.prueba.ts` ni toqué la base de datos, según instrucción.
- No repetí el hallazgo ya documentado y sin resolver del complemento de hidrocarburos
  (fecha `2026-04-24` sin respaldo exacto) ni el de peaje al 50% sobre SubTotal más allá
  de la nota breve arriba — siguen abiertos en sus fichas, no cambiaron este ciclo.
