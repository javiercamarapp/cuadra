# Frontend — auditoría 6

**Nota: 4/10** (antes 5). Razón: mixta, y hay que decirla completa. Lo cerrado
ayer —el CRÍTICO y los 2 ALTOS de la ronda 5— **sí se atacó y sí se cerró**, con
pruebas de verdad (funciones puras extraídas y testeadas, contraste medido con
la fórmula de WCAG contra el CSS real, no recordado). Pero **mirada más
profunda sobre el código nuevo** —exactamente el que la ronda pedía auditar—
encontró un CRÍTICO que no existía antes porque el mecanismo que lo abre no
existía antes: `reconstruir()` (`analytics.ts`) recalcula la cifra que vende el
producto con la configuración VIGENTE del tenant, no con la que estaba activa
al cerrar, y el único candado que se escribió no puede verlo. La anchor del
rubro ata a 4-o-menos cualquier cifra que el comprador vea mal; esta no es un
error de formato, es una contradicción fiscal silenciosa contra un PDF que ya
se mandó.

**El riesgo mayor hoy:** el contralor abre una liquidación ya cerrada y
archivada en PDF, y el panel le muestra una cifra de "cuánto es deducible"
distinta a la que tiene impresa — sin ningún aviso de que eso pasó — apenas
alguien corrija el RFC de la flota o cualquier otro dato de configuración
después del cierre.

---

## Hallazgos

### [CRÍTICO] El detalle recalcula la deducibilidad con la configuración VIGENTE del tenant, no con la del cierre, y el candado de `reconstruir()` no lo puede ver

`src/lib/cuadra/analytics.ts:296-326` (`reconstruir`) · `src/lib/cuadra/cuadre/desde_db.ts:10-38` (`cuadrarDesdeDB` llama `getConfig(tenantId)` fresco en cada carga) · `src/lib/cuadra/config.ts:145-169` (`getConfig`: el RFC se re-lee de la columna `tenant.rfc` en CADA llamada, y si la lectura de Supabase falla, cae a `DEMO_CONFIG` en silencio, línea 166-168) · `src/lib/cuadra/cuadre/engine.ts:82-83,100-110,118-148,171-174` (RFC decide la cubeta; `totalComprobado` no depende del RFC) · consumido en `src/app/dashboard/[id]/page.tsx:41-48,100-121`

**Escenario, ejecutado con el motor real — no leído.** `cuadrarViaje` es puro,
así que corrí el MISMO CFDI de diésel ($5,800, timbrado, XML verificado,
`rfcReceptor: 'TRA850101AB1'`) con dos configuraciones distintas, simulando lo
que pasa entre el cierre de una liquidación y una recarga posterior del
detalle:

```
=== cierre original (sin RFC de la flota configurado — normal en un tenant nuevo) ===
totalComprobado: 5800
totalDeducible: 5800  totalNoDeducible: 0  totalPorConfirmar: 0
diferencias: [ 'anticipo' ]

=== detalle reabierto tras capturar tenant.rfc (a un RFC DISTINTO del receptor) ===
totalComprobado: 5800
totalDeducible: 0  totalNoDeducible: 0  totalPorConfirmar: 5800
diferencias: [ 'rfc_receptor_no_verificable', 'anticipo' ]

=== ¿el candado de reconstruir() lo detecta? ===
|totalComprobado1 - totalComprobado2| = 0   (tolerancia: 0.015)
```

El mismo gasto pasa de **"Deducible para ISR: $5,800.00"** a **"Por confirmar:
$5,800.00"** sin que `totalComprobado` se mueva un centavo, porque
`totalComprobado` es una suma de montos (`engine.ts:171-174`) que **no lee
ninguna clave de `config`**: ni política, ni RFC, ni `hidrocarburos`, ni
`estimulos`. El único portón de `reconstruir()` —`Math.abs(liq.totalComprobado
- totalPersistido) > 0.015` (`analytics.ts:299`)— compara justo la cifra que el
cambio de configuración nunca toca, así que siempre pasa cuando lo que cambió
fue el RFC, un tope de política, la fecha de vigencia del complemento de
hidrocarburos o el tope fiscal de alimentación.

**No es un caso de laboratorio: es el flujo de onboarding documentado.**
`config.ts:6-8` lo dice en el encabezado del propio archivo: *"El día del demo
se captura la config real del cliente en la sala y se guarda como override del
tenant (DB `tenant.config` jsonb)"*. Y el RFC específicamente ni siquiera
necesita ese override: `getConfig` (líneas 150-164) SIEMPRE sobre-escribe
`cfg.empresa.rfc` con lo que haya en la columna `tenant.rfc`, en cada llamada.
Corregir un RFC —el paso más mundano de dar de alta a un cliente real— basta
para que cada liquidación YA CERRADA cambie de deducibilidad la próxima vez que
alguien la abra en el panel.

**Consecuencia.** El contralor ya mandó el PDF archivado a su contador citando
"$X deducibles / $Y por confirmar". Si vuelve a abrir esa MISMA liquidación en
el panel —el caso de uso explícito de esta sección, que es la razón por la que
compra (comentario de `analytics.ts:259`)— puede leer una cifra distinta, sin
ninguna marca de que se recalculó, sin fecha de cuándo, y sin forma de saber
cuál de las dos confiar. Para un producto cuyo argumento de venta es
precisamente esta cifra, que dejen de coincidir dos veces el mismo dato es el
peor lugar posible para tener un bug.

**Causa raíz.** El comentario de `analytics.ts:275-286` sí razona sobre
`totalComprobado` cambiando (gastos añadidos después del cierre), pero nunca
considera que `getConfig(tenantId)` —y por tanto la política, el RFC, los
topes fiscales— puede haber cambiado entre el cierre y la carga. Las tres
cubetas SIEMPRE suman `totalComprobado` por construcción del bucle en
`engine.ts:697-727` (cada gasto cae en exactamente una), así que el propio
invariante que `filasDeducibilidad` verifica de nuevo en `[id]/page.tsx:46-48`
es matemáticamente redundante con el de `reconstruir()`: los dos protegen
contra lo mismo (gastos que cambiaron) y ninguno contra el config.

**Intento de refutación.** ¿Lo cubre el disclaimer *"Estimación con la
información capturada; la determinación final es de su contador"*
(`[id]/page.tsx:118`)? No: ese texto habla de incertidumbre fiscal genérica
(que el SAT pueda resolver distinto), no de que la MISMA pantalla, para el
MISMO registro, pueda decir algo diferente de lo que ya está impreso y
archivado. ¿Hay ya una prueba que cubra esto? Revisé `analytics.test.ts`
completo: **`cuadrarDesdeDB` está mockeado en las 12 pruebas del archivo**
(línea 190, 200, 209, 254, 273…), así que ninguna ejercita la cadena real
`getConfig → cuadrarDesdeDB → reconstruir` a través de dos configuraciones
distintas. El hueco no está tapado por accidente ni por diseño: no se probó.

---

### [MEDIO] El arreglo de zona horaria del panel abrió una discrepancia NUEVA con el PDF: ahora dicen días distintos, no solo formatos distintos

`src/app/dashboard/formato.ts:51-58` (`fechaMx`, con `timeZone: TZ_MX`) · `src/lib/cuadra/liquidacion/pdf.ts:48-49` (`fecha`, sin `timeZone`, sin cambios desde la ronda 5) · `src/app/dashboard/[id]/page.tsx:64,71-75` (la fecha corregida y el botón "Descargar PDF" están a dos líneas de distancia)

**Escenario, ejecutado con `TZ=UTC` para reproducir el reloj del servidor**
(Vercel corre en UTC, hecho ya establecido y no refutado en la auditoría 5;
`pdf.ts:48-49` no cambió desde entonces):

```
$ TZ=UTC npx tsx -e "..."
iso = '2026-08-01T02:00:00.000+00:00'  (31-jul-2026, 20:00 hora CDMX)

pdf.ts fecha()        [sin timeZone, servidor en UTC]:        01 ago 2026
formato.ts fechaMx()  [con timeZone America/Mexico_City]:     31 jul 2026
```

La ronda 5 (MEDIO 3) encontró que panel y PDF mostraban el MISMO día
equivocado, con formato distinto ("2026-08-01" contra "01 ago 2026" — los dos
en UTC, los dos de acuerdo en que era el 1 de agosto). El arreglo de esta ronda
corrigió solo `formato.ts`, así que ahora, para una liquidación cerrada después
de las 18:00 hora local, **el panel dice 31 de julio y el PDF de la misma
liquidación dice 1 de agosto**: ya no es un desacuerdo de formato, es un
desacuerdo sobre qué día fue. Y el botón para bajar ese PDF
(`[id]/page.tsx:71-75`) está a dos renglones de la fecha que ahora sí está
corregida (línea 64).

**Consecuencia.** El caso más común del producto —liquidaciones que se cierran
al terminar el viaje, de noche— es justo el que dispara esto. Un contralor que
compare la fecha en pantalla contra la fecha impresa del mismo documento, en la
misma sesión, ve dos fechas distintas para el mismo evento.

**Causa raíz.** `formato.ts:23-26` lo documenta él mismo: *"la casa natural de
estas dos funciones es `src/lib/utils.ts`... `pdf.ts` sigue con su propia copia
(misma salida en litros, distinta zona horaria en fechas)"* — el autor sabía
que dejaba el PDF sin el `timeZone` y lo anotó como alcance pendiente, no como
bug cerrado. El efecto de dejarlo así es peor que antes de tocar nada: antes
las dos superficies acertaban juntas o erraban juntas; ahora una acierta y la
otra no, y eso se nota.

---

### [BAJO] `getStatsPorOperador` repite, sin usar hoy, el patrón de fallo disfrazado de cero que esta ronda debía cerrar

`src/lib/cuadra/analytics.ts:71-95`

**Verificado por lectura y por `command grep`.** Las otras tres funciones de
lectura de este mismo archivo (`getKpis`, `getAcreditables`,
`detectarAnomalias`) pasan su respuesta por `exigir()` (línea 25-28), que
traduce el error-por-valor de supabase-js en una excepción — el arreglo mismo
del CRÍTICO de la ronda 5. `getStatsPorOperador` no: destructura `{ data: ops
}`, `{ data: gastos }`, `{ data: viajes }` directo (líneas 73-77) y usa `??
[]`. Si cualquiera de las tres consultas falla (host caído, RLS, llave
rotada), la función no lanza: devuelve `OperadorStat[]` con `viajes: 0,
dieselTotal: 0` para cada operador — indistinguible de "este operador de
verdad no tiene viajes".

**Por qué es BAJO y no MEDIO o ALTO.** `command grep -rn
"getStatsPorOperador" .` (excluyendo `node_modules`) solo devuelve su propia
definición: **ninguna página ni ruta la llama hoy**. No hay pantalla que
pueda mentir con este dato porque no hay pantalla que lo pinte. Queda como
hallazgo porque es la quinta ocurrencia exacta del patrón que la ronda pidió
buscar ("un fallo de consulta disfrazado del valor que significa 'no hay'"),
en el mismo archivo que ya lo arregló tres veces, y el día que alguien conecte
esta función a una vista de rendimiento por operador —que es obviamente para
lo que existe— el bug se activa solo.

---

## Lo que revisé y está bien

**El CRÍTICO de la ronda 5 está cerrado de verdad, no de palabra.** Corrí
`npx vitest run src/app/dashboard` (23 pruebas, 4 archivos, verdes) y leí
`estado.ts`/`estado.test.ts` completos: la decisión "error / parcial / vacío /
datos" salió de dos booleanos acoplados al componente a una función pura con
seis casos probados, incluida la combinación "traicionera" que la ronda 5
señaló (KPIs en cero legítimo + listado caído → `parcial`, no `vacio`). Las
tres consultas de `page.tsx` y las cuatro de `analytics.ts` ya lanzan sobre
error-por-valor (`exigir()`), verificado leyendo cada una.

**Los dos ALTOS de la ronda 5 están cerrados y con prueba.** El signo de la
diferencia va pegado a la cifra en la lista (`page.tsx:253-264`, "a favor de la
empresa"/"a favor del operador"), igual que en el detalle. Las tres cubetas de
deducibilidad llegan al panel (`[id]/page.tsx:100-121`) reusando
`filasDeducibilidad`, la misma función que el PDF — no una cuarta copia de la
lógica de dinero, que es justo lo que la ronda 5 pidió evitar.

**El contraste ya no se recuerda, se mide.** `contraste.test.ts` lee
`globals.css` con regex y calcula la fórmula de luminancia relativa de WCAG
sobre el archivo real, para los dos temas y los dos tokens con significado.
Corrí las 7 pruebas: verdes. `--color-ok` pasa de 2.22:1 a 7.67:1 en claro
(`#14602c`) y usa `#34c759` (8.12:1) en oscuro — confirmado también a mano,
son los mismos valores que reporté en la ronda 5 como el arreglo pendiente.

**Los mapas literales siguen sin desincronizarse — comparación obligatoria
hecha.** `CONCEPTO` (`[id]/page.tsx:20-24`, 9 claves) y los dos `ESTATUS`
(`page.tsx:14-18`, `[id]/page.tsx:25-29`, 3 claves cada uno) cubren
exactamente `ConceptoGasto` y `EstatusLiquidacion` de `types/cuadra.ts`, con
fallback para valor desconocido en los tres. Corrí
`etiquetas_sincronizadas.test.ts` y `ruta_pdf_sincronizada.test.ts` (11
pruebas, verdes): siguen vigentes. La etiqueta de un ticket de combustible ya
sale de `etiquetaConcepto(concepto, ocrExtra)` —la misma función que el
PDF— y no del mapa local, así que "Diésel" contra "Combustible Magna" del
mismo comprobante (ALTO de arquitectura, ronda 5) tampoco puede volver a pasar
en esta ruta.

**`litros()` sí coincide con el PDF, verificado carácter por carácter.** El
PDF (`acreditable.ts:95`) usa `toLocaleString('es-MX')` a secas sobre un valor
que el motor ya redondeó a 2 decimales; `formato.ts` usa `maximumFractionDigits:
2`. Para cualquier valor con ≤2 decimales las dos salidas son idénticas —
`formato.test.ts` lo prueba con seis valores distintos y pasa.

**Los boundaries de error ya no tiran el único hilo.** `dashboard/error.tsx` y
el `global-error.tsx` que antes no existía (`find` vacío en la ronda 5) están
los dos, cada uno pinta el `digest` en pantalla y lo manda al logger. Verifiqué
`logger.ts:122`: `CLAVES_NO_PII` ahora incluye `'digest'`, así que el puente
entre lo que ve el usuario y la línea del log ya no sale redactado como
`[TEL]` por parecer un celular de diez dígitos.

**Las dos piezas invisibles de la ronda 5 (MEDIO 5) ya tienen botón.** El CSV
(`page.tsx:202-205`) y el PDF (`[id]/page.tsx:71-75`, condicionado a
`d.pdfPath`) están enlazados desde la interfaz.

## Lo que NO alcancé a revisar

- **Seguí sin renderizar nada.** Todo lo de arriba es lectura de código,
  ejecución de funciones puras/motor con `npx tsx`, y `vitest run` real — no
  levanté `next dev` ni tomé una captura. La memoria del proyecto dice
  "verificar mirando"; esta ronda tampoco miré. El reflow en móvil, el
  `backdrop-filter` de `.glass` en un proyector real y el foco de teclado
  siguen sin verse.
- **No verifiqué si hoy existe algún camino en la aplicación (UI o API) para
  editar `tenant.config` o `tenant.rfc`.** `command grep -rn "tenant.*config"
  src/app/api/` no devolvió nada, así que hoy ese cambio solo puede llegar por
  SQL/consola de Supabase — lo cual no reduce el riesgo del CRÍTICO (el propio
  `config.ts` lo describe como el flujo esperado), pero no confirmé cuántas
  manos humanas median antes de que ocurra.
- **No repetí la revisión de `DEMO_TENANT_ID`** (`page.tsx:12`,
  `[id]/page.tsx:13`, el mismo literal repetido). La ronda 5 lo dejó fuera de
  este rubro por ser territorio de backend/datos; no encontré nada que me
  obligara a reabrirlo.
- **No audité `design-system/`** ni el simulador de `/demo` más allá de lo que
  ya toqué al revisar `etiquetaConcepto`; ninguno de los dos cambió esta ronda
  según el diff que reconstruí con `git log`.
- **No verifiqué el costo de recalcular `reconstruir()` en cada carga del
  detalle** (llama `getConfig`, `getViaje`, `getGastos` y corre el motor
  entero por request) — es territorio de rendimiento, no de frontend, pero es
  la misma función del CRÍTICO de arriba y vale la pena que ese rubro lo mire.
