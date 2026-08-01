# Frontend — auditoría 8

**Nota: 5/10** (antes 4). Razón del movimiento: *se atacó y subió* — hay
commits de esta ronda (`8f42529`, `60538b3`) que cerraron, con prueba real
contra el motor y no una reimplementación del criterio, los dos hallazgos
reportados en la ronda 6: el camino de RFC del CRÍTICO y el MEDIO de zona
horaria. Eso es trabajo verificable, no promesa. Pero no sube más porque mi
propia verificación adversarial encontró que el candado nuevo del CRÍTICO
('reconstruir()' → 'derivoLaConfig') solo mira el CONJUNTO de tipos de
diferencia, no el monto, y hay un segundo camino de config —el tope de
viáticos, no el RFC— que mueve la deducibilidad manteniendo exactamente el
mismo conjunto de tipos. Verificado con el motor real: el mismo bug de fondo
(panel contradice al PDF archivado, sin aviso) sigue vivo, con una llave
distinta — por eso queda anotado como CRÍTICO de esta ronda, no como cerrado.

El riesgo mayor hoy: el contralor abre una liquidación con viáticos de
alimentación cerrada, y si alguien ajusta el tope fiscal diario del tenant
(`estimulos.viaticosTopeFiscalDiarioMxn`, parte del override editable de
`tenant.config`) antes de que la vuelva a abrir, el panel recalcula un
"deducible" distinto al que está impreso en el PDF que ya se mandó al
contador — y el portón que se escribió esta ronda para justo este problema no
lo detecta, porque solo compara qué TIPOS de diferencia aparecen, no cuánto
valen.

---

## Hallazgos

### [CRÍTICO] El portón nuevo de `reconstruir()` cierra el camino del RFC pero no el del tope de viáticos — mismo bug, puerta distinta
`src/lib/cuadra/analytics.ts:298-394` (`reconstruir` y `derivoLaConfig`) ·
`src/lib/cuadra/cuadre/engine.ts:641-691` (bloque del tope de alimentación,
`tipo: 'viatico_excede_fiscal'` se empuja SIEMPRE que se exceda el tope,
sin importar cuál sea el tope) · `src/lib/cuadra/config.ts:43-49`
(`estimulos.viaticosTopeFiscalDiarioMxn` es parte del override `tenant.config`,
editable exactamente igual que el RFC que causó el CRÍTICO original)

**Contexto: el arreglo de esta ronda (commit `8f42529`, "AUDITORÍA 6 · CRÍTICO
de frontend") es real y está bien probado** — `analytics_deriva.test.ts` fija
con el motor de verdad que un cambio de RFC mueve las cubetas sin mover
`totalComprobado`, y que `derivoLaConfig` (que compara el CONJUNTO de tipos de
`diferencias` persistidas contra las recalculadas) lo detecta y apaga el
desglose. Corrí esas 7 pruebas: verdes. Ese camino específico —el que reportó
la ronda 6— está cerrado.

**Pero el candado que se eligió (comparar tipos, no montos) tiene un hueco
estructural, y lo verifiqué con el motor real, no lo inferí.** El bloque del
tope de viáticos (`engine.ts:675-690`) calcula `proporcionDia =
topeAlimentacion / total` y reparte esa proporción entre `totalDeducible` y
`totalNoDeducible` — pero empuja el MISMO `tipo: 'viatico_excede_fiscal'` sin
importar cuál sea `topeAlimentacion`, mientras el gasto siga excediendo el
tope en ambos casos. Repro con `cuadrarViaje` real (un gasto de alimentación
de $2,000 con CFDI y XML verificados, sin problema de RFC, para aislar
la variable):

```
=== al cerrar (tope 750, el vigente hoy) ===
totalDeducible: 1050   totalNoDeducible: 1250   totalPorConfirmar: 0
tipos: [ 'viatico_excede_fiscal' ]

=== al reabrir (tope 400 — alguien tocó el override del tenant) ===
totalDeducible: 700    totalNoDeducible: 1600   totalPorConfirmar: 0
tipos: [ 'viatico_excede_fiscal' ]

=== ¿el portón lo detecta? ===
derivoLaConfig(alCerrar.diferencias, alReabrir.diferencias) = false
|totalComprobado1 - totalComprobado2| = 0
|totalDeducible1  - totalDeducible2|  = 350
```

`totalDeducible` se movió $350 (de $1,050 a $700), `totalComprobado` no se
movió un centavo, y el ÚNICO portón que existe hoy —`derivoLaConfig`, que
compara el conjunto de `tipo`— dice que no hay deriva, porque
`'viatico_excede_fiscal'` está presente en los dos lados. El panel serviría
la cifra de $700 sin ninguna marca de que cambió, exactamente el mismo defecto
que el hallazgo de la ronda 6 describía para el RFC.

**No es de laboratorio.** `estimulos.viaticosTopeFiscalDiarioMxn` vive en
`CuadraConfig.estimulos` (`config.ts:45`) y `fusionarConfig` lo mezcla desde
`tenant.config` jsonb exactamente con el mismo mecanismo que sobrescribe el
RFC — el propio comentario de `config.ts:6-8` dice que "el día del demo se
captura la config real del cliente en la sala y se guarda como override del
tenant". Corregir un tope fiscal capturado mal el primer día (o ajustarlo
porque cambió la ley) es un evento tan mundano como corregir un RFC.

**Consecuencia.** Idéntica a la del CRÍTICO original: el contralor ya mandó el
PDF archivado a su contador citando "$1,050 deducibles". Si alguien ajusta el
tope de viáticos del tenant y el contralor vuelve a abrir esa MISMA
liquidación, el panel ahora dice "$700 deducibles" sin fecha, sin aviso, y sin
caer al camino de respaldo (`comprobantesCuadran: false`) que el propio diseño
previó para este caso — porque el portón que decide si cae a ese camino es
justo el que no lo ve.

**Causa raíz.** `derivoLaConfig` (`analytics.ts:385-394`) compara
`Set<tipo>`, no `Set<{tipo, monto}>` ni el valor de `esperado`/`real` que la
propia `Diferencia` de `'viatico_excede_fiscal'` ya trae (`engine.ts:687`:
`esperado: topeAlimentacion, real: round2(total)`). El dato para detectar esta
deriva específica ya existe en la estructura que se persiste — no se está
usando.

**Intento de refutación.** ¿El caso ya está cubierto por otra prueba? Busqué
`viaticosTopeFiscalDiarioMxn` en `analytics_deriva.test.ts` y no aparece — las
7 pruebas de ese archivo solo ejercitan el camino del RFC. ¿Lo cubre el
comentario que dice "un cambio de monto o de texto NO se cuenta como deriva,
a propósito, para no apagar el desglose por redondeo" (`analytics.ts:331-336`,
prueba en `analytics_deriva.test.ts:83-90`)? No: esa salvaguarda está pensada
para diferencias de centavos por redondeo (`monto: 200` vs `200.01`), no para
un tope que cambió $350 completos por una decisión de configuración — el
propio diseño no distingue entre las dos causas del cambio de monto.

**(No es REINCIDENTE en sentido estricto: el escenario exacto que reportó la
ronda 6 —RFC— está cerrado y probado. Es el mismo mecanismo de fondo
reapareciendo por una puerta que el arreglo de esta ronda no cubrió.)**

---

### [MEDIO → CERRADO] La discrepancia de zona horaria entre panel y PDF ya no puede volver a abrirse
`src/app/dashboard/formato.ts:27` (re-exporta `fechaMx` de `@/lib/formato`) ·
`src/lib/cuadra/liquidacion/pdf.ts:27,51` (`export { fechaMx } from
'@/lib/formato'`, y `const fecha = (iso) => fechaMx(iso)`) ·
`src/lib/formato.ts:61-89` (`fechaMx`, con manejo separado para fecha-sin-hora
en UTC y timestamp completo en `America/Mexico_City`) ·
`src/lib/formato.test.ts:75-88` (guarda con `grep` sobre el código, no sobre
comentarios, que prohíbe una copia nueva de `toLocaleString('es-MX')` fuera de
este archivo)

El hallazgo de la ronda 6 era exacto: el arreglo de esa ronda solo tocó
`formato.ts` del panel y dejó `pdf.ts` con su propia copia sin `timeZone`, así
que una liquidación cerrada después de las 18:00 hora local salía con DÍAS
distintos en las dos superficies. Repetí el mismo repro con `TZ=UTC` (el reloj
del servidor) sobre el ISO `2026-08-01T02:00:00.000+00:00` (31-jul, 20:00
CDMX): `dashboard/formato.ts` → `fechaMx()` da `31 jul 2026`. Y ahora
`liquidacion/pdf.ts:51` llama literalmente a la MISMA función — no una copia
con el mismo resultado, la misma referencia de código — así que no hay margen
para que las dos vuelvan a divergir sin que alguien borre el import. Corrí
`formato.test.ts` (7 pruebas), `dashboard/formato.test.ts` (7 pruebas): las
15 en verde, incluida la del cierre nocturno y la guarda anti-copia.

Cerrado con red, no solo de palabra: la prueba de `sinComentarios` +
`execSync(grep)` es justo lo que le faltaba a este hallazgo para no
sobrevivir una cuarta ronda (el propio archivo documenta que el número de
copias creció de 3 a 8 a 11 entre rondas 6-7-31jul, antes de este arreglo).

---

### [BAJO] `getStatsPorOperador` sigue sin usar `exigir()` — REINCIDENTE, sin cambios
`src/lib/cuadra/analytics.ts:71-95`

Sin cambios desde la ronda 6, verificado línea por línea contra el archivo de
hoy: las tres consultas (`operador`, `gasto`, `viaje`) siguen
desestructurando `{ data }` directo, sin pasar por `exigir()` como sí hacen
hoy `getKpis`, `getAcreditables`, `detectarAnomalias` y
`getLiquidacionDetalle` en el mismo archivo. Un fallo de lectura sigue
produciendo `OperadorStat[]` con ceros, indistinguible de "sin viajes".

**Sigue sin consumidor.** `command grep -rn "getStatsPorOperador"
--include="*.ts" --include="*.tsx" src/` (excluyendo `node_modules`) solo
devuelve su propia definición — ninguna pantalla la llama todavía, así que
sigue en BAJO y no en un severidad mayor. El día que alguien conecte una
vista de rendimiento por operador a esta función, hereda el bug ya escrito.

---

## Lo que revisé y está bien

**El demo y el saludo del agente ya dicen "Likida" en las dos superficies
donde importa.** `src/app/demo/page.tsx:22` — el primer mensaje del
simulador dice "¡Hola! Soy Likida", y `command grep -rn "Cuadra\b"
src/app/` no devuelve ninguna ocurrencia de marca visible al usuario (las dos
coincidencias que salen, "Cuadra exacto" en `dashboard/[id]/page.tsx:88` y
`demo/page.tsx:57`, son el verbo "cuadrar", no el nombre del producto).
Confirma lo que dice el `MAPA.md` sobre `b476a9e`.

**`src/app/demo/page.tsx` dejó de tener su propia copia de `mxn()`.** Ahora
importa `mxn` de `@/lib/formato` (línea 4) en vez de la función local que
tenía antes — una copia menos de las que documenta `formato.ts` haber
perseguido durante tres rondas.

**Falta la etiqueta `viewport` se agregó y se ve mirando, no solo leyendo.**
`src/app/layout.tsx:15` agrega `export const viewport = { width:
'device-width', initialScale: 1 }`, con un comentario que documenta haberlo
encontrado capturando `/aviso/[tenant]` a 430px — exactamente la pantalla que
un operador abre desde el celular. Sin esto, todo el sitio maquetaba contra
un lienzo de 980px en móvil.

**Las páginas nuevas (`/aviso/[tenant]`, `/privacidad`) usan los tokens de
color del sistema, no clases fijas de Tailwind.** Verificado: ambas usan
`var(--ink)`, `var(--muted)`, `var(--line)`, `var(--color-warn)` en vez de
`text-neutral-900` — el comentario de `aviso/[tenant]/page.tsx:75-80`
documenta explícitamente por qué (un fondo oscuro con texto fijo casi
invisible, la pantalla que se abre de noche desde la cabina). Corrí
`contraste.test.ts` (7 pruebas, verdes) — no cambiaron los tokens que mide.

**Los estados de estas dos páginas nuevas están pintados, no dejados en
blanco.** `getDatosResponsable` (`repo.ts:425-452`) lanza sobre error real
(no lo disfraza de `null`) y devuelve `null` explícitamente solo cuando falta
razón social o domicilio — la página responde `notFound()` en ambos casos
"no existe" y "existe pero incompleto", con el comentario explicando por qué
eso es preferible a distinguirlos (`aviso/[tenant]/page.tsx:29-31`). El caso
"falta un dato pero el aviso sí se puede armar" se pinta con una franja de
aviso visible (`pendientes.length > 0`), no se esconde. `privacidad.test.ts`
(6 pruebas) y `aviso` — corrí ambos, verdes.

**`estadoPanel` sigue cubriendo la combinación traicionera.** Releí
`estado.ts:29-39` contra `estado.test.ts` (6 pruebas, verdes): la
combinación "KPIs en cero legítimo + listado caído" sigue devolviendo
`'parcial'`, no `'vacio'` — el arreglo de la ronda 5 no se desactualizó.

**Los mapas literales del panel siguen sincronizados con `types/cuadra.ts`.**
Comparación obligatoria hecha de nuevo, no heredada de la ronda pasada:
`CONCEPTO` (`dashboard/[id]/page.tsx:20-24`, 9 claves) cubre las 9 de
`ConceptoGasto`; `ESTATUS` en `dashboard/page.tsx:14-18` y
`dashboard/[id]/page.tsx:25-29` (3 claves cada uno) cubre exactamente
`EstatusLiquidacion` (`types/cuadra.ts:104`). Los tres tienen fallback para
valor desconocido. `etiquetas_sincronizadas.test.ts` (7 pruebas) y
`ruta_pdf_sincronizada.test.ts` (4 pruebas): verdes.

**El signo de la diferencia sigue pegado a la cifra en la lista y en el
detalle**, y **las tres cubetas de deducibilidad siguen llegando al panel**
reusando `filasDeducibilidad` (`dashboard/[id]/page.tsx:46-48`) — la misma
función que consume el PDF, no una cuarta copia de la lógica de dinero.
Verificado leyendo el código, no heredado del reporte anterior.

**El boundary de error raíz (`global-error.tsx`) cubre las páginas nuevas.**
`/aviso/[tenant]` y `/privacidad` no tienen su propio `error.tsx`, pero al
estar fuera del segmento `/dashboard` caen al boundary raíz
(`global-error.tsx:8-13`, el comentario documenta explícitamente que esto
cubre "/acceso, /demo, la portada" — y por construcción, cualquier otra
superficie fuera del panel). Revisé que no imprime stack trace, solo el
`digest` y un mensaje en español.

**La deduplicación de comprobantes ya llega correctamente a la tabla del
PDF** (no es mi rubro directo, pero consume la misma `filasImprimibles` que
podría afectar al detalle vía `reconstruir()`): corrí
`copias_un_origen.test.ts` (7 pruebas, verdes) para confirmar que el insumo
que `reconstruir()` reutiliza (línea 342, `filasImprimibles(liq)`) no arrastra
el bug de duplicados que `0d5fa06` cerró esta ronda.

## Lo que NO alcancé a revisar

- **Seguí sin renderizar nada con un navegador real.** Todo lo de arriba es
  lectura de código, `npx tsx` sobre el motor puro, y `npx vitest run`
  dirigido — no levanté `next dev` ni tomé una captura. El reflow real del
  nuevo `viewport` en un teléfono físico, el `backdrop-filter` de `.glass` en
  una sala con proyector, y el foco de teclado en las páginas nuevas siguen
  sin verse. La memoria del proyecto dice "verificar mirando"; esta ronda,
  igual que la 6, no miré.
- **No verifiqué si existe hoy algún camino en la UI o la API para editar
  `estimulos.viaticosTopeFiscalDiarioMxn` u otras claves de `tenant.config`.**
  `command grep -rn "estimulos" src/app/api/` no devolvió nada — hoy ese
  cambio, igual que el RFC, solo puede llegar por SQL o consola de Supabase.
  Eso no reduce el riesgo del CRÍTICO (`config.ts` lo describe como el flujo
  de onboarding esperado), pero no confirmé cuántas manos median.
- **No repetí la revisión de `DEMO_TENANT_ID`** (repetido literal en
  `dashboard/page.tsx:12` y `dashboard/[id]/page.tsx:13`) — la ronda 5 ya lo
  dejó fuera de este rubro por ser territorio de backend/datos.
- **No audité `design-system/` ni `globals.css` a fondo.** Verifiqué con
  `git log` que ninguno de los dos cambió desde antes de la ronda 6
  (`design-system/` desde `9569c13`, `globals.css` desde `fa03b00`), así que
  no hay delta que revisar esta ronda, pero tampoco repetí una auditoría
  completa desde cero.
- **No evalué si otras claves de `estimulos` o `politica` (más allá de
  `viaticosTopeFiscalDiarioMxn`) tienen el mismo hueco.** Revisé
  `efectivoTopeMxn` y confirmé que ESE es un umbral binario (cambia el
  `tipo` de diferencia si cruza el tope, así que `derivoLaConfig` sí lo
  vería), pero no agoté sistemáticamente cada clave de `CuadraConfig` contra
  el portón — es plausible que `politica[].topeMonto` (que alimenta
  `sobre_politica`, ni siquiera parte de las cubetas de deducibilidad) tenga
  un comportamiento distinto que no verifiqué a fondo.
- **No medí el costo de `reconstruir()` en cada carga del detalle**
  (`getConfig` + `getViaje` + `getGastos` + motor completo, por request) —
  territorio de rendimiento, no de frontend, señalado también por la ronda 6.
