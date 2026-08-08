# Arquitectura y mantenibilidad — auditoría 17

**Nota: 6/10** (antes 7). Razón del movimiento: se atacó y subió (dos de los tres
abiertos cerrados de verdad) · **deuda que cobró factura** (el guardarraíl de
`round2` sigue ciego, y el ALTO de la auditoría 12 sobre el bloque "Acreditable"
se "arregló" copiando una nota a mano en vez de importar la fuente — volvió a
divergir) · mirada más profunda (tres verdades de dinero con dos dueños).

Compuerta corrida hoy: `npx vitest run` → 249 archivos, 3148 verdes, 1 saltada.
`npx eslint src/` → 0 errores, 18 warnings.

**El riesgo mayor del rubro hoy:** el núcleo (motor puro, `formato.ts`, `normas/`,
tipos) tiene una sola fuente y está bien vigilado, pero **la capa de presentación
del dinero no**: la misma cifra fiscal se arma en dos lugares —pantalla y PDF,
panel del contador y rail del asistente, /admin y /dashboard— y en los tres casos
ya divergió. El contralor cruza esas superficies entre sí; es exactamente el
cruce que el producto invita a hacer.

---

## Hallazgos

### [ALTO · REINCIDENTE] El bloque "Acreditable" del panel reimplementa `filasAcreditables` y ya perdió tres advertencias legales

`src/app/dashboard/[id]/page.tsx:257-270` (y `397-409`) contra
`src/lib/likida/liquidacion/acreditable.ts:88-124`, que el PDF sí usa
(`src/lib/likida/liquidacion/pdf.ts:334`).

`acreditable.ts` existe, literal en su encabezado (líneas 4-11), porque «lo que el
contralor lee tiene que poder probarse sin abrir un PDF» y porque «una cifra en el
papel con un artículo citado al lado es una AFIRMACIÓN». El PDF la llama. **La
pantalla no**: pinta los cuatro renglones a mano con `<Tot>`.

Escenario: viaje V-2031, casetas con CFDI verificado por $11,600 (SubTotal
$10,000) → el motor persiste `peajeAcreditable = 5000` y `ivaAcreditable = 1600`.

* En el **PDF** sale: `Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a
  elegibilidad · $5,000.00`, con `BASE_ESTIMULO_PEAJE` («base usada: el subtotal
  SIN IVA…; si su contador toma el total con IVA, la cifra sube ~13.8%») y
  `CONDICIONES_ESTIMULO_PEAJE` (las cuatro condiciones verbatim: exclusividad,
  Red Nacional de Autopistas de Cuota, ingresos < $300M, no parte relacionada),
  más el pie general `NOTA_INGRESO_ACUMULABLE`. `IVA acreditable (LIVA art. 5)`.
  Litros y peaje van con `tono: 'condicionado'`.
* En **`/dashboard/<id>`** sale: `Peaje 50% · $5,000.00` en verde
  (`var(--color-ok)`, línea 398, `ok` en los cuatro renglones), con una sola nota
  de seis palabras («Sujeto a elegibilidad»), sin la base, sin las cuatro
  condiciones y sin la nota de ingreso acumulable. `IVA acreditable`, sin el
  artículo. `Diésel elegible para el estímulo` sin `NOTA_LITROS_DIESEL`.

Consecuencia: el contralor de una flota con ingresos ≥ $300M —o que no se dedica
EXCLUSIVAMENTE al transporte de carga, o cuyas casetas no son de la Red Nacional—
mira la pantalla (que es lo que se abre en la sala, no el PDF), ve $5,000 en verde
y se acredita un estímulo que no le corresponde. El propio módulo advierte
(líneas 56-62) que el criterio 1/LIF/PI del Anexo 3 alcanza a «quien preste
servicios»: esa práctica sería de Likida, no del cliente.

Y es reincidencia declarada: el comentario de `[id]/page.tsx:403-405` dice
«AUDITORÍA 12, ALTO (fiscal): … El PDF ya lo decía; el panel no». El arreglo de
esa ronda fue **copiar una** de las tres notas al panel en vez de llamar a la
función compartida — que es lo que garantizó que las otras dos siguieran
faltando. Ninguna prueba lo vigila: `etiquetas_panel.test.ts` cubre el renglón de
CONCEPTO panel↔PDF, `copias_un_origen.test.ts` cubre las copias, y el bloque
Acreditable no tiene equivalente.

Causa raíz probable: cuando la superficie de salida (PDF) y la de pantalla no
comparten runtime, se resolvió importando la función en una y transcribiéndola en
la otra; el arreglo de la ronda 12 consolidó la transcripción en vez de borrarla.

---

### [ALTO] "IVA acreditable" tiene dos motores y dos ventanas, y las dos cifras conviven en la misma pantalla

`src/lib/likida/cuadre/engine.ts:1024-1026` contra
`src/lib/likida/fiscal.ts:506-517` (`ivaSostenible`) y `535`.
Superficies: `src/app/dashboard/contador/page.tsx:141` y
`src/app/dashboard/chat.tsx:38` (vía `src/app/dashboard/rail.tsx`, montado en el
layout por `src/app/dashboard/chrome.tsx:100`, o sea en las ~31 páginas).

Dos implementaciones independientes de «¿este comprobante acredita IVA, y cuánto?»:

* **Motor** (`engine.ts`): exige `xmlVerificado`, excluye por
  `SIN_ACREDITAMIENTO` (13 tipos) y **aplica la proporción de LIVA 5-I** cuando
  el gasto es parcialmente deducible (línea 1024: `proporcionDeducible`).
  Se persiste en `liquidacion.iva_acreditable` y lo lee
  `analytics.getAcreditables()`.
* **Fiscal** (`fiscal.ts:ivaSostenible`): exige `cfdiUuid`, `estado_sat` ≠
  cancelado/pendiente/no_encontrado, no EFOS, y las reglas de efectivo. **No
  aplica ninguna proporción** — su propio bloque `LIMITES` (líneas 954-958) lo
  declara: «NO evalúa el tope de $750/día de alimentación (LISR 28-V)… Repetirlo
  aquí con otra implementación produciría dos cifras distintas para el mismo
  hecho». Omitirlo produce esas dos cifras igual.

Escenario con valores: comida de un operador el 3-ago, un solo CFDI vigente
pagado con tarjeta, total $2,000 (SubTotal $1,724.14, IVA trasladado $275.86).
Tope `viaticosTopeFiscalDiarioMxn = 750` (`config.ts:107`).

* Motor: `proporcionTimbrado = 750/2000 = 0.375` → acredita **$103.45**. Es lo que
  imprime el PDF, lo que muestra `/dashboard/<id>` y lo que suma
  `/dashboard/contador/liquidaciones` ("IVA acreditable (motor)").
* `/dashboard/contador` → `fiscal.ivaAcreditable` = **$275.86**, con la etiqueta
  «IVA acreditable documentado» y sin una sola nota que explique la diferencia.
* En **esa misma pantalla**, el rail del asistente responde a "iva" con
  `mxn(acred.iva)` + «de IVA acreditable este periodo (LIVA, Art. 5)» — la cifra
  del motor. Y encima con otra ventana: `getAcreditables(tenantId)` se llama sin
  `ventanaDias`, así que `corteVentana` devuelve `null`
  (`analytics.ts:42-47, 207-215`) y suma **toda la historia**, mientras el KPI de
  arriba es el mes de `resolverPeriodo`.

Consecuencia: dos números etiquetados «IVA acreditable» a 400 píxeles uno del
otro, distintos por dos razones acumuladas (regla + ventana). Es la pregunta que
el contralor hace en la sala y para la que no hay respuesta en pantalla; y la
divergencia crece con cada tipo de diferencia nuevo que se agregue a
`SIN_ACREDITAMIENTO` y no a `ivaSostenible`.

Causa raíz probable: el mismo dominio partido por *alcance* (por viaje / por
periodo) en vez de por *capa*, con la regla de acreditabilidad reimplementada en
cada mitad en lugar de compartir un predicado por comprobante.

---

### [ALTO] "Vencen pronto" ARCO: dos implementaciones, y la de la flota —la responsable legal— nunca avisa antes

`src/app/dashboard/arco/page.tsx:71` y `87` contra
`src/app/admin/compliance/page.tsx:180` y `67`.

La misma tabla (`solicitud_arco`), el mismo KPI, dos reglas:

* `/admin/compliance` (Javier): `vence_en <= hoy + 5 días`, rótulo
  «Vencen pronto (≤ 5 días hábiles)».
* `/dashboard/arco` (la flota): `venceEn(s.venceEn) <= hoy`, rótulo
  «Vencen pronto (≤ 5 días)».

Escenario con valores: hoy 2026-08-08. Una solicitud de acceso recibida el
2026-07-13 con `vence_en = '2026-08-12'` (LFPDPPP art. 32, 20 días hábiles).
`'2026-08-12' <= '2026-08-08'` → `false`.

* Javier ve **1** en su consola.
* La contralora de la flota —que es la **responsable** obligada a contestar— ve
  **0** bajo un rótulo que le promete cinco días de aviso. Su KPI solo se
  enciende el 12-ago, el día en que el plazo ya se agotó: un contador de
  vencimientos que solo cuenta lo ya vencido.

Consecuencia: el panel que Likida vende como "cumplimiento" incumple; y dos
pantallas del mismo producto reportan cifras contradictorias sobre las mismas
filas, lo que es peor que no reportar ninguna.

Causa raíz probable: la pantalla de la flota se derivó de la de /admin copiando
la forma (icono, rótulo, KPI) y reescribiendo el predicado, sin una función
compartida que lo defina.

---

### [MEDIO · REINCIDENTE] El guardarraíl de `round2` mide la declaración, no la operación — y ya hay una instancia viva que no ve

`src/lib/formato.test.ts:158-169` contra `src/lib/likida/crear_viaje_wa.ts:302`.

El guardarraíl que la auditoría 9 puso para cerrar un ALTO reincidente hace
`grep -rl "function round2\|const round2\s*="`. Solo caza a quien **declare** una
función con ese nombre. La forma que causó el bug original —`Math.round(n * 100) /
100` escrito en línea, sin nombre— pasa entera.

Escenario: alguien escribe en un módulo de dinero
`const total = Math.round(base * 100) / 100` con `base = 1.005`. Sale `1.00`
(1.005 se guarda como 1.00499999999999989, y `Math.round(100.4999…)` cae para
abajo); `round2(1.005)` da `1.01`. La suite sigue en **3148 verdes**. No es
hipotético: `crear_viaje_wa.ts:302` contiene hoy
`Math.round(base * factor * 100) / 100` sobre el **anticipo** de un viaje, y el
guardarraíl no lo reporta. (Comprobado por fuerza bruta que en ESE call site
concreto los valores alcanzables —≤ 2 decimales × factor ∈ {1, 1e3, 1e6}— no
divergen: el defecto vivo es el guardarraíl, no esa línea. El hermano
`toLocaleString('es-MX')`, en cambio, sí se mide sobre el uso real.)

Consecuencia: el hallazgo que sobrevivió tres rondas se declaró cerrado con una
red que no cubre la forma que lo produjo. La próxima copia entra en verde.

Causa raíz probable: el guardarraíl se escribió contra el síntoma que se había
visto (cuatro funciones llamadas `round2`) y no contra la expresión.

---

### [MEDIO] `crear_viaje_wa.ts`: 866 líneas y ~40 pruebas verdes de un módulo sin un solo consumidor de producción

`src/lib/likida/crear_viaje_wa.ts` (exports en `541`, `662`, `710`, `753`);
`src/lib/likida/crear_viaje_wa.test.ts`.

`interpretarPeticionViaje`, `resumenParaConfirmar`, `resolverOperadorPorNombre` y
`OperadorNombreAmbiguo` no aparecen en ningún archivo de producción. Barrido de
todo `src/`: los únicos consumidores son su propio test. No hay import dinámico
(`processor.ts` solo hace `import '@/lib/likida/tools'` por efecto), y `tools.ts`
registra tres tools (`consultar_politica`, `cuadrar_viaje`, `guardar_liquidacion`);
ninguna crea viajes.

Escenario: el jefe de flota escribe por WhatsApp *«nuevo viaje para Juan Pérez,
Puebla a Monterrey, anticipo 8000»* — exactamente el mensaje que la primera
aserción del test (`crear_viaje_wa.test.ts:52`) declara entendido. En producción
`processor.ts` nunca llama al parser: el mensaje cae al agente genérico y no se
crea nada.

Consecuencia: la suite afirma con 40 pruebas verdes una capacidad que el producto
no tiene. Quien mantenga esto —o quien prepare el demo leyendo qué está probado—
concluye que el despacho por WhatsApp funciona. Además el módulo consulta
Supabase por su cuenta (`supabaseAdmin()` en `resolverOperadorPorNombre`, líneas
760-780) saltándose `repo.ts`, así que si algún día se cablea entra por una puerta
que no es la del resto.

Causa raíz probable: feature diseñada, probada y nunca conectada; nada en el
repo mide "código exportado sin consumidor".

---

### [MEDIO] `KpiTile` recibe `valor: number`, así que el "no inventar una cifra" se resuelve a mano en 13 sitios — y ya se resuelve de dos formas en la misma grilla

`src/app/admin/ui/kit.tsx:20-47` (firma) y
`src/app/dashboard/combustible-casetas/page.tsx:172, 183, 186-188`.

El tipo no admite `null`, de modo que cada página coalesce por su cuenta
(`valor={x ?? 0}`, 13 apariciones en `src/app`). El contrato de "cero que no es
medición" existe (`vacio`), pero es opcional y su documentación lo describe como
el caso del sparkline, no el de la consulta caída.

Escenario: la flota tiene 4,820 L de diésel con XML verificado.
`getAcreditables` falla (timeout de PostgREST) → `safe()` devuelve `null`. La
grilla está gateada solo por `porConcepto === null` (línea 172), que sí cargó, así
que se pinta:

> **0.00 L** — Litros elegibles para el estímulo · *LIF 2026, Art. 20-A*

en la misma fila donde el tile de al lado (línea 186-188) sí usa
`vacio={pctSinCfdi === null ? '…' : undefined}` y dice honestamente que no sabe.
El contralor concluye que su flota no genera estímulo de IEPS y no lo reclama;
nada en pantalla indica que ese tile está ciego mientras sus tres vecinos ven.

Consecuencia: la regla número uno del producto depende de que 31 páginas se
acuerden, en vez de del tipo. Cada pantalla nueva es una tirada de dados.

Causa raíz probable: el componente compartido se diseñó para el caso feliz
(`number`) y el manejo de "no se sabe" se dejó del lado del llamador.

---

### [BAJO] `/api/dashboard/asistente` reimplementa la resolución de tenant/rol y no honra `rolEfectivo`: "ver como encargado" enseña dinero

`src/app/api/dashboard/asistente/route.ts:43-59` (el propio encabezado, líneas
12-15, dice «con el mismo criterio que `resolverTenantEfectivo`» — o sea, es una
copia declarada) y `src/app/dashboard/rail.tsx:59`.

El rail manda `?tenant=` y **nunca** `?rol=`; el handler gatea con `sesion.rol`
(el real), no con `rolEfectivo`.

Escenario: Javier abre `/dashboard/viajes?rol=encargado` para verificar qué ve el
jefe de tráfico antes del demo. La página se renderiza como encargado (sin
columnas de dinero, `resolverTenantEfectivo` aplica `rolEfectivo`), pero el rail
de la derecha llama a `/api/dashboard/asistente` sin `rol`, el handler ve
`superadmin`, y pinta el IVA acreditable, el comprobado total y las anomalías de
la flota junto a una página que los esconde.

Consecuencia: no es una fuga (un encargado real recibe 403 en la línea 43), es
peor para el mantenimiento: la herramienta que existe para *verificar* la matriz
de roles miente sobre ella. Javier concluye "el encargado sí ve el rail" y ajusta
la matriz a un hecho falso.

Causa raíz probable: `rolEfectivo` se aplicó en la puerta de los Server
Components; el rail es cliente y su endpoint quedó fuera de esa puerta.

---

### [BAJO] `CLAUDE.md` y `MAPA.md` fundan la regla número uno del producto en un archivo que ya no existe

`CLAUDE.md` («se dice qué falta y por qué (`dashboard/pendiente.tsx`,
`EstadoVacio`)») y `docs/auditoria-17/MAPA.md:57`, contra el árbol real:
`src/app/dashboard/pendiente.tsx` no existe en HEAD (existió hasta `ad7a91a`;
`git ls-tree -r HEAD` no lo encuentra).

Escenario: un agente nuevo —o un auditor— recibe la instrucción de que cuando no
hay dato real «se dice qué falta y por qué», abre la referencia canónica, no la
encuentra, y resuelve el vacío con su propio criterio. Es justamente el archivo
que enseñaba el formato (`falta` + `cuandoExista`) que hoy sobrevive solo
transcrito a mano en siete páginas (`rentabilidad`, `clientes`, `cobranza`,
`unidades`, `mapa`, `cotizador`, `soporte`).

Consecuencia: el documento que *sobreescribe el comportamiento por defecto* de
cada agente que toca este repo apunta a un 404. Verificado que las siete páginas
sí reimplementaron el patrón correctamente con `EstadoVacio`, así que hoy no hay
pantalla mintiendo — el costo es puramente de mantenibilidad, y es recurrente.

Causa raíz probable: `bc39cc1` («limpieza total») y el rediseño de esas siete
páginas movieron el código; nada obliga a `CLAUDE.md` a compilar.

---

## Lo que revisé y está bien

Vale la pena decirlo con precisión, porque el núcleo de este repo está
notablemente mejor que su periferia:

* **El motor de dinero sigue siendo puro.** `src/lib/likida/cuadre/engine.ts` no
  tiene un solo `await`, `fetch(`, `process.env`, `Date.now()` ni `new Date()`;
  sus nueve imports son puros (`engine.ts:11-20`). Lo mismo
  `cuadre/resumen.ts`, `liquidacion/deducibilidad.ts`,
  `liquidacion/acreditable.ts`, `liquidacion/omitidos.ts` y
  `laboral/pagadero.ts`: cero I/O. `cuadre/desde_db.ts` es la frontera correcta y
  entra por `repo.ts` (`desde_db.ts:7, 31-35`).
* **`formato.ts` no importa nada y es la única fuente**, con la prueba que lo
  exige medida sobre el código sin comentarios (`formato.test.ts:183-205`).
  `lib/utils.ts:13` y `app/dashboard/formato.ts:28` son reexportes, no copias.
* **El caso canónico del rubro está cerrado de verdad.** `otro: 'Otro'` es el
  mismo literal en `engine.ts:1201` y `[id]/page.tsx:31`, el PDF ya no tiene mapa
  propio (importa `etiquetaConcepto`), y hay dos redes:
  `etiquetas_sincronizadas.test.ts:32-67` (forma) y
  `app/dashboard/etiquetas_panel.test.ts:26-46` (salida, incluida la rama de
  combustible que la primera no veía). El mapa de ESTATUS se unificó en
  `app/dashboard/estatus.ts` y el test caza su reaparición
  (`etiquetas_sincronizadas.test.ts:107-115`).
* **`normas/` ↔ `indice.ts` está atado hueso por hueso**
  (`normas/normas_sincronizadas.test.ts:30-97`): biyección de fichas, estado de
  verificación, jerarquía, citas y `fecha_vigencia_desde`, ficha por ficha.
* **Un solo archivo de tipos** (`src/types/likida.ts`): `ConceptoGasto`,
  `TipoDiferencia`, `EstatusLiquidacion`, `Gasto` y `Liquidacion` se declaran una
  vez, y tres tests leen el tipo como texto para exigir cobertura.
* **La puerta de /dashboard no tiene excepciones**: las 32 `page.tsx` pasan por
  `resolverTenantEfectivo` (verificado una por una), y `AREA_POR_RUTA`
  (`visibilidad.ts:62-112`) cubre las 31 rutas estáticas; la dinámica `[id]` se
  gatea a mano y `dinero_por_area.test.ts` lo documenta. Ninguna página escribe a
  la base directamente (los únicos `.insert/.update/.delete` en `src/app` están en
  `admin/mi-perfil` y el webhook de Stripe).
* **`copias_un_origen.test.ts`** ata los tres consumidores de "¿qué gasto es
  copia?" (cuadre, reembolso, tabla del PDF) contra un solo origen — es el
  ejemplo del patrón que a los demás bloques les falta.
* **Abiertos de la ronda 13, cerrados:** `[id]` ya pasa por `rolEfectivo`
  (`[id]/page.tsx:47`); `/dashboard/chat` está clasificado `dinero`
  (`visibilidad.ts:75`) *y* además revalida el área adentro
  (`chat/page.tsx:47`) — cinturón y tirantes, aunque el comentario de las líneas
  36-37 quedó describiendo el estado viejo.
* **`Date.now()` en render: verificado y limpio.** Ningún componente con
  `'use client'` en `src/app` llama `Date.now()` ni `new Date()`. El reloj entra
  como prop desde el servidor (`lib/saludo.ts:56` → `dashboard/page.tsx:168`,
  `inicio-operacion.tsx:94`, `soporte/page.tsx:36`) y `avance-cierre.tsx:45` lo
  recibe. `arco/page.tsx:31` usa `new Date()` en un Server Component
  `force-dynamic`, que es el arreglo correcto, no el defecto.
* **El renombre Cuadra→Likida no dejó huérfanos ni dobles.** Cero imports a
  `lib/cuadra/`; las ~40 apariciones de "cuadra/cuadre" en `src/` son el verbo del
  dominio. No existe `lib/likida/marca.ts` compitiendo con nada: el nombre se
  vigila desde `marca.test.ts`, que además separa la marca del verbo con una regla
  gramatical. Barrido de módulos sin importador: solo `instrumentation.ts`,
  `proxy.ts` (entry points), `startup.ts`/`arranque.ts` (import dinámico desde
  `instrumentation.ts:23-26`), `tools.ts` (import por efecto en
  `processor.ts:9`) — y `crear_viaje_wa.ts`, que es el hallazgo de arriba.
* **La "limpieza total" (`bc39cc1`) no rompió importadores de código.** Los dos
  documentos que sí leen tests (`guion-demo.md`, `DEPLOY.md`) se movieron a
  `docs/conocimiento/` con sus rutas actualizadas y ambas pruebas pasan.

## Lo que NO alcancé a revisar

* **`src/lib/likida/facturacion/`** (adaptadores de portales, `al_vuelo.ts`,
  `comercios.ts`, `capufe.ts` — ~4,000 líneas). Es la subcarpeta más grande que no
  abrí a fondo; `capufe.ts:896` hace comparaciones de dinero con tolerancia y
  merece una pasada de fronteras propia.
* **`src/lib/agents/`** (`run.ts`, `registry.ts`, `prompts.ts`) y el reparto de
  responsabilidad entre `processor.ts` (1,400+ líneas) y `conv.ts` — `processor.ts`
  es hoy el archivo con más razones para cambiar del repo y no lo audité como tal.
* **Los cuatro subconjuntos de `TipoDiferencia` escritos a mano**
  (`NO_DEDUCIBLE_ISR`, `POR_CONFIRMAR` en `engine.ts:100-101`,
  `SIN_ACREDITAMIENTO` en `engine.ts:985`, `SOLO_CONTRALOR` en `resumen.ts:24`):
  no encontré una prueba de exhaustividad que obligue a clasificar cada tipo nuevo
  en los cuatro. Sospecho que es un hueco real —un `TipoDiferencia` nuevo cae por
  omisión en "acredita"— pero decidir *qué* subconjunto le toca a cada uno es del
  rubro fiscal, no del mío, y no quise emitir un veredicto de dinero sin esa
  lectura.
* **`src/lib/saas/`** (Stripe, suscripción, transferencia) y
  `src/app/api/cron/*`: los recorrí por encima buscando accesos a datos fuera de
  `repo.ts`, no por duplicación interna.
* **`supabase/migrations/`** (82 archivos): no comparé el esquema contra los tipos
  de `src/types/likida.ts`. Es el otro lugar clásico donde una verdad se duplica y
  no lo cubrí.
