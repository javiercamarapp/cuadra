# Rendimiento y costo — auditoría 17

**Nota: 5.0/10** (antes 7.5). Razón del movimiento: **deuda que cobró factura**.
Los dos hallazgos abiertos que traía este rubro siguen abiertos. El barrido anual
del 15% se declaró resuelto en la ronda 16 con la migración `0084` — y la
migración está escrita pero **no la llama nadie**: el camino caliente sigue
paginando exactamente igual que antes, y ahora además hay una prueba que afirma
lo contrario. QStash no cerró el lote de 8: lo movió a un worker que declara 600 s
y sigue cortando a los 150 s del presupuesto viejo. Encima, el código nuevo de la
ronda (`563c507`) volvió a poner en la pantalla de inicio del cliente los barridos
de tabla completa que la migración `0064` había sacado.

**El riesgo mayor hoy:** el CIERRE del webhook —lo que corre después de que el
agente devuelve— no cabe en la reserva de 12 s que él mismo se aparta, ni con los
costos nominales que `presupuesto.ts` escribe. Y ese es el único tramo de la ruta
que no consulta el reloj: `reloj.acotar()` no aparece ni una vez después de
`runAgent`. Cuando se pasa, Meta ya tiene su 200, la liquidación ya está escrita,
y nadie se entera.

---

## Sumas de peor caso

Techos REALES vigentes en el árbol: `TOPE_CONSULTA_MS = 8_000`
(`presupuesto.ts:101`, lo impone `acotada`), `SEND_TIMEOUT_MS = 10_000` y
`DOWNLOAD_TIMEOUT_MS = 15_000` (`meta/client.ts:10,17`). Los costos *nominales*
son los que la propia tabla `PASOS_CIERRE` usa: 0.3 s consulta, 1.5 s `sendText`,
2.5 s `sendDocument`, 0.5 s URL firmada.

| # | Cadena | Suma a mano | Límite escrito | ¿Cabe? |
|---|---|---|---|---|
| A | **Cierre feliz del webhook**, NOMINAL: `COSTO_CIERRE_MS` 8.9 s − 0.3 s (guardia usa snapshot, no reconsulta) + `avisarCierreAlJefe` (0.3 telefonosJefe + 0.3 resumenDeCierre + 1.5 sendText jefe + 2.5 sendDocument jefe = 4.6 s) | **13.2 s** | `MARGEN_CIERRE_MS = 12_000` (`presupuesto.ts:72`) | **NO** — 1.2 s de más, y eso ANTES de que nada salga lento |
| B | **Cierre feliz**, con cada paso en SU TECHO: 7×8 s (registrarCosto, vincularCostosALiquidacion, registrarCostoWhatsApp ×2, createSignedUrl, saveConversation, releaseViajeLock) = 56 + 4×10 s (sendText respuesta, sendDocument PDF, sendText jefe, sendDocument jefe) = 40 | **96 s** + 2 consultas SIN techo | reserva 12 s / ruta `maxDuration = 120` (`webhook/whatsapp/route.ts:77`) | **NO** — 8× la reserva |
| C | **Cierre con barrera vencida y recuperación parcial**: B + getGastos 8 + sendText aviso 10 + registrarCostoWhatsApp 8 + `cuadrarDesdeDB` (viaje‖gastos‖config 8 + getOperador 8 + getAcumuladoCombustible ≥8) | **146 s** | 120 s de invocación entera | **NO** — la invocación muere antes de terminar el cierre |
| D | **`/api/cron/escalar`**, NOMINAL: `limit(100)` viajes × (0.3 claim + 1.5 sendText chofer + 1.5 sendText jefe) | **330 s** | `maxDuration = 120` (`cron/escalar/route.ts:10`) | **NO** — muere en el viaje ~36 de 100 |
| E | **`/api/cron/escalar`**, en techos: 100 × (claim sin techo + 10 + 10 + 10) | **≥3 000 s** | 120 s | **NO** |
| F | **Worker de QStash**, peor caso: flota 1 abre a t≈0 y corre 147 s; flota 2 abre a t=147 (< 150) y corre a t=294; flota 3 se corta | **294 s usados** | `cola/route.ts:11` declara **600 s**, pero `PRESUPUESTO_LOTE_MS` sale del `maxDuration=300` del cron (`cron/facturar/route.ts:129`) y `MARGEN_LOTE_MS=150_000` | Cabe, **pero solo procesa 2 de 8 flotas por corrida**: 306 s de los 600 declarados se quedan sin usar |
| G | **CFDI consolidado en el webhook**: 1 `UPDATE` secuencial por línea conciliada (`consolidado.ts:268`), sin tope de líneas | 300 líneas × 0.3 s = **90 s** nominal; 400 líneas = **120 s**; en techo 300 × 8 s = **2 400 s** | 120 s de la invocación | **NO** a partir de ~400 líneas — y un TAG mensual de 20 unidades trae miles |
| H | **`/dashboard` (Resumen de flota)**: 12 llamadas de analytics; `gasto` barrido ENTERO 3 veces, `viaje` 2, `liquidacion` 1. Con 10 800 `gasto` / 2 160 `viaje` / 2 000 `liquidacion` | **≈65 viajes de red**, cadena secuencial más larga 12 páginas, ≈38 700 filas transferidas | ninguno: la página **no declara `maxDuration`**; `traerTodo` LANZA a las 100 páginas (`pg.ts:48`) | El propio archivo (`analytics.ts:325`) fecha el tope de `gasto` en **mes 5** de operación |

---

## Hallazgos

### [CRÍTICO] El cierre del webhook no cabe en la reserva que él mismo se aparta, ni con sus propios números nominales
`src/lib/likida/presupuesto.ts:37-72` (tabla `PASOS_CIERRE` y `MARGEN_CIERRE_MS`)
· `src/lib/likida/processor.ts:2160` (`avisarCierreAlJefe`, ausente de la tabla)
· `src/lib/likida/avisar_cierre.ts:52-58,95,109,127`

**Escenario:** un viaje cierra con una diferencia que el jefe tiene que decidir
(`requiereDecision === true` en `armarAvisoJefe`). El agente devuelve, y a partir
de ahí el código NO vuelve a consultar `reloj` ni una sola vez —`reloj.acotar()`
aparece por última vez en `processor.ts:1853`—. Los pasos que corren son:

```
COSTO_CIERRE_MS declarado                              8 900 ms
 − guardiaCifras→cuadrarDesdeDB (usa el snapshot,
   guardia.ts:105, no reconsulta en el camino feliz)     −300 ms
 + telefonoJefeDe        → contactos.ts:118               300 ms
 + resumenDeCierre       → avisar_cierre.ts:53            300 ms
 + sendText al jefe      → avisar_cierre.ts:109         1 500 ms
 + sendDocument al jefe  → avisar_cierre.ts:127         2 500 ms
                                                     ───────────
                                                       13 200 ms   vs MARGEN_CIERRE_MS = 12 000
```

Como `restante() = 120 000 − 12 000 − transcurrido`, el agente puede legítimamente
devolver en t = 108 s. Cierre nominal → t = 121.2 s contra `maxDuration = 120`.
Con los techos reales en vez de los nominales (fila B), 96 s de cierre → t = 204 s.
Y dos de esos pasos **no tienen techo ninguno**: `telefonosJefe`
(`contactos.ts:118`) y `resumenDeCierre` (`avisar_cierre.ts:52-58`) llaman a
`supabaseAdmin()` en crudo, sin `acotada`, así que heredan el default de undici:
300 000 ms. Un solo socket que acepte y calle ahí se lleva la invocación entera.

**Consecuencia:** Vercel mata la función. La liquidación YA está en la base, el
`viaje` ya está `liquidado`, el chofer ya recibió su PDF — pero `saveConversation`
(`processor.ts:2189`) nunca corre, así que el turno se pierde y el agente vuelve
sin memoria de haber cerrado; `releaseViajeLock` del `finally` nunca corre, así
que el lease queda tomado; el contralor —el comprador— **no recibe el aviso de
cierre ni el PDF** que es justo lo que archiva para su contador; y no hay ni una
línea de log, porque el proceso muere antes del `catch`. Meta tiene su 200 desde
`route.ts:250`: no reintenta.

**Causa raíz probable:** la reserva se calibró contra una tabla escrita a mano y
su prueba es un checksum (`presupuesto.test.ts:107-119`: `toHaveLength(13)` +
`suma === COSTO_CIERRE_MS`), que por construcción no puede detectar un paso que
nadie anotó — y `avisarCierreAlJefe`, con sus dos consultas y sus dos envíos, no
se anotó. Además la tabla usa costos *promedio* para dimensionar una reserva cuyo
propósito es sobrevivir al *peor* caso.

---

### [ALTO · REINCIDENTE] El barrido anual del 15% sigue paginando: la migración `0084` está escrita y no la llama nadie
`supabase/migrations/0084_sumar_combustible_ejercicio.sql`
· `src/lib/likida/repo.ts:803-869` (`getAcumuladoCombustible`, sigue paginando)
· `src/lib/likida/cuadre/desde_db.ts:78` · `src/lib/likida/tools.ts:109`
· `src/lib/likida/migraciones_verificadas.test.ts:56`

**Escenario:** `grep -rn "sumar_combustible_ejercicio" --include=*.ts` sobre todo
el repo devuelve **una sola línea, y es un comentario de prueba**. No hay ni un
`.rpc('sumar_combustible_ejercicio', …)`. `getAcumuladoCombustible` sigue siendo
el bucle de `repo.ts:819-853`: `PAGINA = 1 000`, `MAX_PAGINAS = 100`, páginas
**secuenciales**, cada una envuelta en `acotada` (8 s de techo). Una flota con
9 000 cargas de diésel en el ejercicio = 10 viajes de red seguidos, ~3 s nominales
y **80 s en techos**, dentro de un turno acotado a 40 s y de una invocación de
120 s. Y corre por dos caminos calientes a la vez: `cuadrarDesdeDB` (todo cierre)
y la tool `consultar_periodo` que el modelo puede pedir.

Agravante medido por el propio repo: `openrouter.ts:565-571` documenta que con
llaves de caché rotas el ciclo repitió `cuadrar_viaje` **3 veces en un turno**, y
cada una arrastra este barrido completo. La caché por nombre ya está arreglada,
pero el barrido sigue siendo el costo unitario que se multiplica.

Y lo peor: `migraciones_verificadas.test.ts:56` afirma *"RPC
sumar_combustible_ejercicio: si falta, getAcumuladoCombustible lanza ruidoso en el
primer cuadre (el RPC no existe)"*. Es falso —`getAcumuladoCombustible` no invoca
ningún RPC— y esa línea verde es la que hace que el hallazgo se lea como cerrado.

**Consecuencia:** la operación fiscal más cara del cierre sigue costando N viajes
de red que crecen con el histórico del cliente; a 100 páginas (100 000 cargas)
lanza y el contador del 15% de la RFA 2026 regla 2.9 se apaga con un `warn`
(`desde_db.ts:80`), dejando el efectivo marcado "a revisar" en la liquidación que
el contralor está mirando.

**Causa raíz probable:** se escribió la migración y se dio por hecho el cableado;
la prueba que debía cubrirlo verifica que el archivo SQL existe, no que alguien lo
llame.

---

### [ALTO] `/api/cron/escalar` procesa 100 viajes en serie con 3 envíos cada uno, contra 120 s
`src/app/api/cron/escalar/route.ts:10` (`maxDuration = 120`)
· `src/lib/likida/escalar_viaje.ts:92` (`.limit(100)`) · `:192-268` (el `for`)

**Escenario:** `viajesSinAceptar` trae hasta 100 filas. El `for` de `:192` no
consulta el reloj ni una vez. Por viaje: `reclamarEscalacion` (1 `UPDATE`) +
`sendText` al chofer + (si rebota) `avisarAlChofer` + `sendText` al jefe + (si
rebota) `sendTemplate`. Nominal 0.3 + 1.5 + 1.5 = **3.3 s** → 100 × 3.3 = **330 s
contra 120**. Vercel corta alrededor del viaje 36.

Peor todavía: **ningún** acceso a Supabase de este archivo pasa por `acotada`
(`grep -c acotada escalar_viaje.ts` → 1, y es un comentario). `viajesSinAceptar`
(`:84`) y `reclamarEscalacion` (`:307`) heredan los 300 s de undici, o sea 2.5×
el `maxDuration` de la ruta.

**Consecuencia:** `reclamarEscalacion` marca `escalado_en` **antes** de mandar
nada, y el propio archivo documenta que ese sello es definitivo y sin ventana de
reintento (`:288-296`). El viaje que estaba en vuelo cuando cayó el hacha queda
marcado como escalado **para siempre, sin que nadie haya avisado a nadie**: el
jefe de flota nunca se entera de que su chofer lleva 5 h sin aceptar el viaje, y
el cron se ve verde en el panel de Vercel. Es el modo de falla que el encabezado
de esa misma ruta (`:19-26`) declara querer evitar.

**Causa raíz probable:** el lote se dimensionó por lo que cabe en una consulta
(`limit(100)`), no por lo que cabe en el presupuesto de la invocación. `MARGEN_LOTE_MS`
—el corte por reloj que `cron/facturar` sí tiene— no se replicó aquí.

---

### [ALTO] El "Resumen de flota" barre `gasto` entero tres veces por carga de página
`src/app/dashboard/page.tsx:87-113` (12 llamadas en `Promise.all`)
· `analytics.ts:135` (detectarAnomalias) · `:537` (getGastoPorConcepto)
· `:562-570` (getGastoPorRuta, nuevo en `563c507`) · `:608-628` (getOperadoresDetalle)

**Escenario:** el commit `563c507` pasó la landing del cliente de 5 a 12 consultas.
Las nuevas **no reciben `ventana`** —`getGastoPorConcepto(tenantId)`,
`getGastoPorRuta(tenantId)`, `getOperadoresDetalle(tenantId)`,
`contarViajes(tenantId)`— así que cada una lee la tabla del tenant **completa, sin
filtro de fecha**, paginando de 1 000 en 1 000 de forma secuencial. Contando
viajes de red con 10 800 `gasto`, 2 160 `viaje`, 2 000 `liquidacion`, 60 `operador`:

```
detectarAnomalias    gasto  11 pág. + 1 vacía = 12
getGastoPorConcepto  gasto  11 + 1            = 12
getGastoPorRuta      gasto  11 + 1  +  viaje 3+1 = 16
getOperadoresDetalle operador 2 + viaje 4 + liquidacion 3 = 9
getValorAhorro (RPC 0064)                      =  5
getKpis / getAcreditables / porDia / getViajes / 2×contarViajes / getPorFacturar ≈ 11
                                              ────
                                              ≈ 65 viajes de red, ≈38 700 filas
```

…para pintar una dona de 6 rebanadas y 5 barras. La página **no declara
`maxDuration`**. Y el rail del asistente (`dashboard/chrome.tsx:100` →
`rail.tsx:59` → `api/dashboard/asistente/route.ts:21`) llama otra vez a
`detectarAnomalias`: **el mismo barrido completo de `gasto` corre dos veces por
carga de la landing**, en dos procesos, sin caché entre ellos.

**Consecuencia:** con el volumen que el propio `analytics.ts:325` toma como
diseño (~660 comprobantes/día), `gasto` pasa de 100 000 filas en el **mes 5** y
`traerTodo` lanza `LecturaIncompleta` (`pg.ts:48,172`). `safe()` en
`page.tsx:32` se lo traga y devuelve `null` → tres tarjetas del Resumen se
apagan a la vez sin decir por qué, en la pantalla del comprador. Es exactamente
la caducidad que la migración `0064` se escribió para eliminar de esta misma
página, reintroducida.

**Causa raíz probable:** se reusó el patrón de "traer todo y agrupar en memoria"
de `getStatsPorOperador` (lo dice el mensaje del commit) sin pasarle la ventana
del `GlobalFilter` que la página ya tiene resuelta en `r`.

---

### [ALTO] N+1 sin tope: un `UPDATE` por línea de CFDI consolidado, dentro del webhook
`src/lib/likida/intake/consolidado.ts:259-270` · `:168-181` (`ligarLineaAGasto`)
· `src/lib/likida/processor.ts:1370-1375` (llamada, sin presupuesto)

**Escenario:** la oficina reenvía por WhatsApp el CFDI mensual del TAG o del
monedero de combustible. `esConsolidado` solo pide `lineas.length > 1`
(`cfdi_xml.ts:126`) — **no hay tope de líneas en ningún lado**. Por cada línea
conciliada se hace un `UPDATE` secuencial. Una flota de 20 unidades con ~12
casetas al día y 22 días operados son ~5 000 líneas; el TAG las manda en un solo
CFDI. Nominal: 300 líneas = 90 s, 400 = 120 s = la invocación entera. En techo
(8 s por `acotada`): 300 × 8 = 2 400 s. `guardarYConciliarConsolidado` no recibe
el `reloj` y no lo consulta.

**Consecuencia, y es la mala:** el `upsert` de `cfdi_xml` va **antes** del bucle
(`:202-221`) y el `insert` de `cfdi_consolidado_linea` va **después**. Si Vercel
mata la invocación a media pasada, queda: fila en `cfdi_xml`, K gastos con
`cfdi_uuid` escrito, y **cero** filas en `cfdi_consolidado_linea`. El guardia de
idempotencia de `:229-236` solo dispara con `existentes.length > 0`, así que al
reenviar el archivo vuelve a correr el JOIN — y los K gastos ya ligados quedan
fuera de `candidatosDb` (filtra `.is('cfdi_uuid', null)`), así que **sus líneas se
reportan como huérfanas**. Es literalmente el fallo que el comentario de `:222-229`
dice estar evitando. El operador recibe un resumen que dice que N líneas no
conciliaron cuando sí lo hicieron, y el contralor persigue facturas que ya están.

Agravante en la misma función: `candidatosDb` (`:241-247`) se lee **sin `traerTodo`
y sin `.range()`** → PostgREST la recorta a 1 000 filas en silencio, que es la
trampa que `pg.ts` existe para cerrar.

**Causa raíz probable:** el camino consolidado se escribió como excepción del
camino de foto (1 comprobante = 1 escritura) y heredó su forma secuencial, sin
revisar que aquí el N lo elige el emisor del CFDI y no el chofer.

---

### [MEDIO] QStash movió el hallazgo del lote de 8, no lo cerró: el worker declara 600 s y corta a los 150 s del presupuesto viejo
`src/app/api/cron/facturar/cola/route.ts:11,75` · `src/app/api/cron/facturar/route.ts:25,129,158,469,509`

**Escenario:** el callback declara `maxDuration = 600` y su comentario dice que
existe porque *"el techo de 300 s de una invocación directa es justo lo que esta
cola existe para romper"*. Pero llama a `procesarLoteEnCola`, que es la MISMA
función del cron y usa la MISMA constante de módulo:
`PRESUPUESTO_LOTE_MS = maxDuration * 1000` donde `maxDuration` es el **300 del
cron** (`route.ts:129`). El corte de `:469` y `:509` sigue siendo
`Date.now() − inicioLote >= 300 000 − 150 000 = 150 s`.

Cuenta con el peor caso medido de una sesión de portal (~147 s, `:135-141`):
flota 1 abre a t≈0 y termina a t=147; flota 2 pasa el corte (147 < 150) y termina
a t=294; flota 3 en adelante se corta. **2 flotas por corrida, de las 8 del lote**,
usando 294 s de los 600 declarados. Ocho flotas con un ticket cada una tardan
**4 horas** en drenar.

**Consecuencia:** el hallazgo reincidente "el lote de 8 no cabe" sigue vivo con
otra forma: ya no se muere a medias (eso sí lo arregló `MARGEN_LOTE_MS`), pero el
lote tampoco se procesa. Y la respuesta lo reporta como `sinTiempo`, que es
honesto — pero el operador del sistema ve un cron verde cada hora facturando 2 de
8 tickets y no tiene señal de que el worker está dejando la mitad de su
presupuesto sin tocar.

**Causa raíz probable:** el presupuesto se extrajo junto con la lógica sin
parametrizarse; sigue siendo una constante de módulo del archivo del cron.

---

### [MEDIO] La foto va al modelo de visión a resolución nativa — el mismo archivo ya sabe redimensionar, pero solo para lo gratis
`src/lib/likida/intake/ocr.ts:253-261` · `src/lib/llm/openrouter.ts:379-384`
· `src/lib/likida/intake/cfdi.ts:249` (el contraste)

**Escenario:** `downloadMediaAsDataUrl` (`meta/client.ts:426-427`) devuelve el
JPEG **tal cual lo mandó el teléfono**, en base64. `extraerComprobante` lo pasa a
`generateStructured({ images: [principal] })`, y `openrouter.ts:383` lo adjunta
como `image_url: { url }` sin `detail` ni preprocesado. Un teléfono de gama media
manda 4 000 × 3 000 px. Gemini tesela en cuadros de 768 px: `ceil(4000/768) ×
ceil(3000/768) = 6 × 4 = 24` teselas ≈ **6 200 tokens de entrada**. La misma foto
a 1 024 px de ancho —más que suficiente para un ticket térmico— son 2 teselas ≈
**520 tokens**: **~12× menos entrada por comprobante**.

Lo que lo hace un descuido y no una decisión: `decodeCodigosFromImage`
(`cfdi.ts:249`) YA usa `sharp(...).rotate().resize({ width: 1600 })` sobre la
misma imagen, y su comentario explica que la pasada a resolución nativa "cuesta
segundos y no encuentra nada". O sea: se redimensiona para el lector de códigos,
que es gratis, y no para la llamada de visión, que es lo que se paga.

**Consecuencia:** el costo por comprobante está dominado por tokens de imagen que
nadie midió — la medición del 4-ago (`models.ts:36-47`) comparó **modelos** con
la misma imagen inflada, así que el ahorro de entrada no aparece en esa tabla.
Y a 5 fotos en vuelo (`MAX_EN_PARALELO`, `route.ts:40`) son 5 payloads de varios
MB de base64 saliendo a la vez de la función, con la copia de `subirComprobante`
en memoria además.

**Causa raíz probable:** el redimensionado se añadió cuando se optimizó el lector
de códigos por latencia; la llamada de visión nunca se revisó por costo de
entrada porque el costo se midió por modelo, no por payload.

---

### [MEDIO] `cola/route.ts` declara `maxDuration = 600` contra el techo de 300 s que este mismo repo verificó
`src/app/api/cron/facturar/cola/route.ts:11` vs `src/app/api/webhook/whatsapp/route.ts:69-71`

**Escenario:** el webhook documenta una verificación explícita: *"VERIFICADO el
28-jul-2026 contra la API de Vercel: el equipo `likida` … está en plan **pro**,
donde el tope es 300 s"*, y por eso se quedó en 120 en vez de subir más. El
callback de QStash declara 600. `vercel.json` no trae bloque `functions` ni nada
que declare Fluid Compute. Si Fluid no está activo, la plataforma no honra 600:
la función se corta en 300 s.

**Consecuencia:** hoy no muerde, porque el corte real es a los 150 s (hallazgo
anterior). Muerde el día que alguien arregle el `PRESUPUESTO_LOTE_MS`: el worker
creería tener 600 s, abriría una sesión de portal a t=440 s en modo `emitir`, y
moriría a los 300 con el CFDI posiblemente timbrado en el SAT y `cfdi_uuid` sin
escribir — que es exactamente el escenario que `MARGEN_LOTE_MS` documenta como
inaceptable (`route.ts:100-109`). Dos números que dicen cosas distintas sobre el
mismo plan; uno de los dos está mal y no hay prueba que los enfrente (la que
existe, `presupuesto.test.ts:80-89`, solo cubre el webhook).

**Causa raíz probable:** el 600 se copió del `timeout: 600` de QStash
(`route.ts:321`), que es el tope del **publisher**, no el de la función.

---

### [BAJO] 12 de 14 `traerTodo` no piden `conteo()` y pagan una página vacía de más
`src/lib/likida/pg.ts:126-131,158-166` · `analytics.ts:968,1023` (los dos únicos que sí)

**Escenario:** `traerTodo` prueba que trajo todo por una de dos vías: el `count`
de PostgREST (gratis, viene en la primera respuesta) o **una página vacía**. Los
llamadores que no piden `conteo(desde)` caen siempre a la segunda: un viaje de
red extra por barrido, siempre. En la landing del dashboard son 8 barridos sin
`conteo` → **+8 viajes de red de los ~65**, ~12% del total, por no pasar un
argumento que el helper ya expone y que dos llamadores ya usan.

**Consecuencia:** latencia constante añadida a la primera pantalla que ve el
contralor. Es el hallazgo más barato de la lista y el único cuyo tamaño no crece
con el cliente.

**Causa raíz probable:** `conteo()` se añadió después que la mayoría de los
llamadores y solo se retrofiteó donde se estaba tocando el código.

---

## Lo que revisé y está bien

- **El reloj compartido de la invocación** (`presupuesto.ts:213-231`,
  `processor.ts:351`) hace lo que dice hasta que el agente devuelve:
  `esperarIntake` (`:1718`), el mutex (`:1751`, `:1390`), el OCR (`:525`, `:798`)
  y `runAgent` (`:1853`) piden todos por `reloj.acotar()`/`reloj.senal()`, así que
  la fase pre-agente no puede sumar 20+12+40 = 72 s a ciegas. `senal()` devuelve
  una señal YA abortada cuando no queda nada (`:227`) en vez de agendar un
  `timeout(0)` — detalle correcto y probado.
- **`acotada()`** (`presupuesto.ts:148-169`) impone `abortSignal` **y** una
  carrera contra temporizador, y devuelve el fallo por el mismo canal
  `{data:null,error}` que Postgres, así que no cambia la semántica de ningún
  llamador. `repo.ts` y `costos.ts` la usan en todas sus llamadas.
- **Los timeouts del cliente de Meta** ya existen: `SEND_TIMEOUT_MS = 10_000`,
  `DOWNLOAD_TIMEOUT_MS = 15_000` (`meta/client.ts:10,17`) en las 10 llamadas.
  El comentario de `presupuesto.ts:66-70` que dice que siguen con `fetch` pelado
  a 300 s está **desactualizado** (no lo cuento como hallazgo: no hay daño).
- **El pool de 5 del webhook** (`route.ts:40-59`): el índice sin candado es
  correcto, `fn` nunca lanza, y la justificación del 5 está anclada en una
  medición del bloqueo síncrono de zxing-wasm, no en una corazonada.
- **Caché de prompt en el ciclo de tools** (`openrouter.ts:645-669`): el
  breakpoint va en el system, que es el bloque invariante, y solo para
  `anthropic/`. Medido contra liquidaciones reales (~72 000 tokens reenviados en
  8 vueltas). Es la optimización correcta y está bien puesta.
- **La llave de caché de tools sin parámetros** (`openrouter.ts:565-593`): el bug
  medido —3 rondas, 0 aciertos, porque el modelo variaba el JSON de `arguments`—
  está cerrado llaveando por nombre cuando el schema no declara propiedades.
- **`MARGEN_LOTE_MS` en `cron/facturar`** (`route.ts:158,469,509`): el corte por
  reloj antes de cada `conNavegador` y antes de cada portal nuevo dentro de una
  flota es correcto, y lo no intentado NO se marca. El mecanismo está bien; lo que
  falla es la constante de la que se alimenta (hallazgo MEDIO de arriba).
- **Agregados movidos a SQL de la 0064**: `resumen_documentos_tenant` y
  `resumen_costo_ia_tenant` (`analytics.ts:337-388`, `costos.ts:295-318`) sí están
  cableados y sí eliminaron los dos barridos que caducaban en día 50 y mes 5.
  El patrón funciona — por eso duele que `0084` no lo siga.
- **`traerTodo` avanza por filas leídas y no por número de página** (`pg.ts:145-152`),
  lo que lo hace correcto ante un `max_rows` bajo de proyecto, y falla cerrado
  con `LecturaIncompleta` en vez de devolver una cifra corta.
- **`consultarCFDI`** (`intake/sat.ts:36-48`) acotado a 4 s y grácil a
  `'pendiente'`: la llamada externa dentro del OCR no puede colgar el turno.
- **El freno de presupuesto antes del agente** (`processor.ts:1834-1846`): si no
  alcanzan 15 s se manda el resumen determinístico en vez de arrancar un ciclo
  que se va a cortar. Es el patrón correcto — el problema es que no existe su
  gemelo para el cierre.

---

## Lo que NO alcancé a revisar

- **Latencia real Vercel ↔ Supabase.** Todas mis sumas usan los costos nominales
  que el repo escribe (0.3 s/consulta) y los techos que impone. Nadie ha medido
  el p99 real, y `presupuesto.ts:97-99` lo admite. Si el p99 está por encima de
  0.3 s, todas las filas de la tabla empeoran proporcionalmente.
- **Los topes internos de `pagina_playwright.ts` y `capufe.ts`.** Tomé el ~147 s
  del peor caso de una sesión como dado (viene de la auditoría 10 y está citado
  en `route.ts:135-141`); no volví a sumar cada tope del adaptador.
- **`/api/export/liquidaciones` y `/api/export/pdf/[id]`**: vi que el primero usa
  `traerTodo` con ventana, pero no sumé su peor caso contra su `maxDuration`
  (ninguno de los dos declara uno).
- **Costo por liquidación medido de punta a punta.** `models.ts` promete
  $0.03–0.05 y hay mediciones por comprobante (18 tickets, 4-ago), pero no
  encontré una medición del ciclo completo con la caché de prompt ya activa. Sin
  ese número, "el costo por operación está medido" no se puede afirmar.
- **`/dashboard` bajo carga real.** Conté viajes de red y filas; no medí tiempo
  de pared contra un Supabase real ni verifiqué qué `maxDuration` hereda una
  página del App Router en este proyecto.
- **`api/cron/purgar`**: es un solo RPC (`route.ts:68`), así que el trabajo pesado
  vive en `mantenimiento_de_datos` en SQL. No leí la función de la base.
