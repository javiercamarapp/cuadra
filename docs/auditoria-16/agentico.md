# Sistema agéntico y orquestación — auditoría 16

**Nota: 7.5/10** (movimiento: 7 → 7.5, subió medio punto). El hallazgo más caro
de la ronda 15 —el contador del 15% caído afirmando "el excedente NO se deduce
contra un tope de $0.00" con dinero saliendo de la deducción— quedó cerrado de
verdad y con la forma correcta: `engine.ts:315-327` degrada a
`combustible_efectivo` (por confirmar) con nota honesta ("no se pudo calcular…
no se evaluó; no se afirma deducible ni no deducible"), hay tres pruebas nuevas
que ejercitan total=0 y el gasto de otro ejercicio, y el estatus sale 'revisar'.
También se cerraron el CRÍTICO ARCO de la 15 (la pantalla de /admin que filtraba
por tenant null y salía SIEMPRE vacía), la contradicción panel/motor del
tri-estado (`fiscal.ts:338` ya no pinta "perdida" para lo "sin declarar"), el
año del reloj vs. el del viaje en `tools.ts`, y el banner tri-estado del panel
de combustible. **Pero** la misma ronda que cerró el fail-closed le metió una
regresión al fix: el `continue` nuevo (`engine.ts:324`) se salta, para ese
gasto, TODOS los chequeos que vienen después — `sobre_politica`,
`fecha_sospechosa`, `monto_discrepante`, `comprobante_no_fiscal`,
`ocr_baja_confianza`, `rfc_receptor` — probado con valores: contador caído +
monto discrepante → la nota de discrepancia desaparece (con contador sano
aparece). Y la deflación del año cruzado —el MEDIO-1 de la 15— sigue intacta:
`desde_db.ts:84-87` resta `efectivoDeEsteViaje` sin filtro de año, así que un
gasto de dic-2025 dentro de un viaje de enero-2026 deflata el previo de 2026 en
su monto y le regala a los gastos de 2026 del mismo viaje hasta ese monto de
cupo extra (probado: previo 500 en vez de 1500; un gasto 2026 de $500 sale
"deducible" cuando debía salir excedente). La feature bandera de la ronda —la
entrega de la respuesta ARCO por WhatsApp— llegó con su propio rótulo falso: la
pantalla de /admin sigue diciendo "Likida no envía mensajes ARCO todavía"
(`compliance/page.tsx:45`) mientras `resolverSolicitudArco` ya los envía, y
descarta el resultado del envío; la plantilla lleva {{1}} = el literal "la
flota" en vez de la razón social (el comentario de la misma línea dice razón
social); y el camino completo no tiene UNA sola prueba.

> Método: leí línea por línea `engine.ts` (bloque 2.9 completo + cubetas +
> estatus), `desde_db.ts`, `tools.ts`, `cifras.ts`, `guardia.ts`, `resumen.ts`,
> `fiscal.ts` (causasDe), `periodo/aviso.ts` y `combustible.ts`, `repo.ts`
> (805-875, 920-1030), `privacidad.ts` (venceArco, ARCO), `processor.ts` (zona
> PRIVACIDAD), `meta/client.ts` (enviarRespuestaArco), `dashboard/arco/page.tsx`
> (nueva), `admin/compliance/page.tsx`, `admin/flotas/page.tsx`,
> `auth/visibilidad.ts`, `auth/tenant-efectivo.ts`, `auth/guard.ts`, y los
> diffs `d7b171f..96f2adc` y `96f2adc..c901226` completos. Cada hallazgo se
> probó con probes temporales (`zzz-a16-probe*`, borrados al terminar). Suites
> del rubro en verde: engine 117 + cifras 22 + aviso 6 + guardia 20 + processor
> 88 + repo_acumulado/administracion/meta/tools 57. `tsc --noEmit` limpio.
> Sha: `c901226`.

## Los cierres de la ronda 15 — verificados contra el código actual

| Hallazgo ronda 15 | Commit de cierre | Estado hoy | Cómo se verificó |
|---|---|---|---|
| [MEDIO] año cruzado: gasto de dic-2025 contra el contador de 2026 | `96f2adc` | **Cierre PARCIAL** | El motor ahora detecta por-gasto `mismoEjercicio` (`engine.ts:312-327`) y el gasto de otro año va a por-confirmar con nota honesta — la nota falsa "el excedente NO se deduce" ya no se imprime (test nuevo `engine.test.ts` "comprobante de OTRO ejercicio" pasa). PERO la deflación del previo en `desde_db.ts:84-87` sigue (sin filtro de año), y el test la enmascara pasando `efectivoPrevEjercicio` directo. Ver hallazgo 1. |
| [MEDIO] contador del 15% caído → "excedente contra tope de $0" | `96f2adc` | **Cerrado** | `engine.ts:315-327`: `!(total > 0)` → `combustible_efectivo` con `monto: 0`, nota "no se pudo calcular el total de combustible del ejercicio… no se evaluó". Probe: total 0 → `totalPorConfirmar: 1000`, `totalNoDeducible: 0`, estatus 'revisar'. 3 tests nuevos en `engine.test.ts:1525-1560`. **Con una regresión: ver hallazgo 2.** |
| [BAJO] nota "deducible por la facilidad" sobre gasto SIN CFDI | — | **Abierto** | `engine.ts:345-350` sin condición de `cfdiUuid`. Probe: ticket sin CFDI dentro del 15% → nota "**deducible** por la facilidad" con `totalPorConfirmar: 1000`, `totalDeducible: 0`. Ver hallazgo 3. |
| [MEDIO→BAJO] portón 1-10: "a las cinco", "salgo el seis" | — | **Abierto** | `cifras.ts:41-48` sin tocar desde la 13. Probe: los tres `true`. Ver hallazgo 4. |
| [MEDIO] "ochocientos" coincidente con un tope pasa el cotejo | — | **Abierto** | `cifras.ts:187-196` sin tocar. Probe: `fuera: []`. Ver hallazgo 5. |
| [BAJO] "X mil" mal-parseado + ficha `rfa-2026-2.9.yaml` niega el contador | — | **Abierto** | `cifras.ts:220` sin tocar (probe: "ocho mil"→1008, "quinientos mil"→1500) y `normas/rfa-2026-2.9.yaml:45-47` sin tocar (último commit `e5d6b46`). Ver hallazgo 6. |
| [BAJO] edición parcial borra TODA la declaración del 15% | — | **Abierto** | `admin/flotas/page.tsx:57-58,69` + `repo.ts:929-933` sin cambios: `ded`/`reg` independientes; si llega solo uno → `delete` de la llave; mensaje "actualizada". Ver hallazgo 7. |
| [BAJO] ARCO promete "recibió su respuesta por WhatsApp" — y nada se envía | `c901226` | **Cerrado en la dirección, con defectos nuevos** | `repo.ts:998-1022` ahora envía (`enviarRespuestaArco`), y las UIs dicen la verdad sobre el envío… salvo la de /admin, que quedó con el mensaje VIEJO y falso (hallazgo 8), y la plantilla lleva un parámetro literal (hallazgo 9). Cero pruebas del camino nuevo (hallazgo 11). |
| [BAJO] contador unificado a medias: misma función, argumentos distintos | `96f2adc` | **Cierre PARCIAL** | El año ya coincide (`tools.ts:105-108` usa el año del viaje). Los criterios siguen divergiendo: `tools.ts:109` llama SIN claves, `desde_db.ts:78` CON claves. Ver hallazgo 10. |
| [BAJO] `avisoTope15` con `elegible:false/undefined` y `actualizarFacilidad15` sin pruebas | — | **Abierto** | `aviso.test.ts` sigue pasando solo `true` como tercer argumento; `actualizarFacilidad15` tiene cero referencias en `*.test.ts`. Ver hallazgo 11. |

Los cierres de la ronda 13 (negación de oración, pregunta sin "¿", portón 1-10,
cardinales sin coincidencia) se mantienen: `cifras.ts`, `guardia.ts`,
`estado_afirmado.ts`, `fecha_dudosa.ts` sin cambios desde `e048de1`/`8d6eff7`/
`438c8f4`/`45de52c` (verificado por `git log` por archivo) y sus suites pasan.

## Hallazgos por severidad

### CRÍTICO

Ninguno. La regla estructural —`properties: {}` en las tres tools, IDs solo
desde `ToolContext`, handlers que ignoran `_args`, guardia que reemplaza SIEMPRE
el texto tras `cuadrar_viaje`/`guardar_liquidacion`— está intacta y byte-idéntica.
El fail-closed del contador del 15% ya no produce cifra fiscal falsa (cerrado y
probado arriba). El dinero del 15% mueve bien las cubetas en el caso medido.

### MEDIO

#### [MEDIO, abierto — cierre parcial del MEDIO-1 de la ronda 15] La deflación del año cruzado sigue: un gasto de dic-2025 dentro de un viaje de enero-2026 le regala a los gastos 2026 de ese viaje hasta $1,000 de cupo extra — y el test nuevo la enmascara

`src/lib/cuadra/cuadre/desde_db.ts:84-87` (`efectivoDeEsteViaje` **sin filtro de
año**: resta del contador de 2026 los gastos en efectivo del viaje SIN mirar su
`fecha`) · `desde_db.ts:78-79` (el contador SÍ filtra por año: `.gte('fecha',
'2026-01-01')` en `repo.ts:861-862`) · `engine.ts:312-327` (el gasto de otro año
se va a por-confirmar con `continue`, sin sumar al acumulado) ·
`engine.test.ts:1544-1554` (el test nuevo pasa `efectivoPrevEjercicio: 2000`
DIRECTO — nunca pasa por la resta de `desde_db`, así que la deflación no la ve
ninguna prueba)

El fix de la ronda 16 arregló la NOTA del gasto de otro ejercicio (ya no dice
"NO se deduce", dice "se revisa aparte"), pero no arregló la resta que lo
precede: `efectivoDeEsteViaje` sigue quitando del contador de 2026 el efectivo
de 2025, y como el motor ya no lo vuelve a sumar (el `continue`), el total de
efectivo 2026 que ve la facilidad queda **deflatado en el monto del gasto
cruzado**. El resultado es el inverso del que acusó la 15: en vez de que el
gasto de 2025 consuma cupo de 2026, ahora **libera** cupo de 2026 para los
gastos del mismo viaje. Probado (probe propia, replicando la aritmética exacta
de `desde_db.ts:84-87`):

```
contador 2026: { efectivo: 2000, totalCombustible: 10000 }  (incluye el viaje)
viaje enero-2026: G1 diésel cash $1,000 fechado 30-dic-2025 · G2 $500 fechado 05-ene-2026
efectivoDeEsteViaje = 1000 + 500 = 1500  →  previo = max(0, 2000 − 1500) = 500
   (correcto: 2000 − 500 = 1500 — G1 no está en el contador de 2026)
engine (G2): previoSinEste = 500, cupo = 1500 − 500 = 1000, dentro = 500
   → "combustible_efectivo_dentro15 … deducible por la facilidad"   ❌
   (correcto: previo 1500 → cupo 0 → G2 es excedente NO deducible por $500)
```

Es la dirección normal de enero: un viaje que empieza en 2026 cargando tickets
del año anterior. La condición para que el error se materialice en la cubeta es
que el previo real de 2026 esté cerca o sobre el tope del 15% — el caso
exacto en que la facilidad decide dinero. El test nuevo de `96f2adc`
(`engine.test.ts:1544-1554`, "comprobante de OTRO ejercicio no corre contra el
contador de este") aprueba con el previo ya restado a mano, y por eso la suite
está verde mientras producción deflata. Fix acotado (la misma recomendación #2
de la ronda 14, nunca aplicada): filtrar `efectivoDeEsteViaje` por el año de
`anioEjercicio` — y una prueba de integración `desde_db → engine` (o al menos
un test que compute el previo con la misma resta).

**Estado: abierto (cierre parcial de `96f2adc`).**

#### [MEDIO, abierto — nuevo. Regresión introducida por el propio fix del fail-closed] El `continue` del contador caído se salta los chequeos del resto del bucle: `sobre_politica`, `fecha_sospechosa`, `monto_discrepante`, `comprobante_no_fiscal`, `ocr_baja_confianza`, `rfc_receptor`

`src/lib/cuadra/cuadre/engine.ts:315-327` (la rama honesta del fail-closed
termina en `continue;` a la línea 324) · `engine.ts:381` (`monto_discrepante`),
`:399` (`noEsComprobanteFiscal`), `:416-424` (`fecha_sospechosa`), `:427-430`
(`folio_verificar`), `:433-438` (`sobre_politica`), `:446-449`
(`ocr_baja_confianza`) — todos DESPUÉS del `continue`, todos saltados para ese
gasto. Antes del fix no había `continue` en la rama `elegible === true`: el
gasto caía a los chequeos con su diferencia del 15% ya puesta.

Probado (probe propia con el motor real):

```
contador caído (total 0) + gasto diésel cash $1,000 con ocrExtra.montoDiscrepante:
  diferencias = ['combustible_efectivo', 'anticipo']   → monto_discrepante PERDIDO
contador caído + ocrExtra.noEsComprobanteFiscal:
  diferencias = ['combustible_efectivo', 'anticipo']   → comprobante_no_fiscal PERDIDO
MISMO gasto con contador sano (total 10000):
  diferencias incluyen 'monto_discrepante'             → aparece
```

El dinero no se mueve mal (el gasto cae a por-confirmar igual), pero se pierden
las señales que el contralor necesita para revisarlo: un diésel en efectivo de
$6,000 contra un tope de política de $4,000 pierde su "excede el tope de
política"; un ticket con el total del código ≠ lo leído por visión pierde su
aviso; un ticket que se declara a sí mismo no-comprobante-fiscal pierde su
advertencia; un gasto fechado fuera del viaje pierde su `fecha_sospechosa`.
Y el disparador no es raro: es exactamente el escenario que el fix quiere
atender (contador caído / frontera de año). El fix es estructural: no usar
`continue`, sino empujar la diferencia honesta y dejar que el resto del bucle
corra (la rama del 15% ya no toca nada más para ese gasto).

**Estado: abierto (introducido por `96f2adc`).**

#### [MEDIO, abierto — nuevo. La página nueva de ARCO de la flota es fail-open] Con la base caída, /dashboard/arco afirma "Ninguna solicitud ARCO registrada" y KPIs en 0 — la pantalla de una obligación legal ciega

`src/app/dashboard/arco/page.tsx:47` (`listarSolicitudesArco(tenantId).catch(()
=> [])`) · `dashboard/arco/page.tsx:49-51` (`pendientes`/`vencenPronto`
derivados de la lista vacía) · `dashboard/arco/page.tsx:60-63` (`solicitudes.length
=== 0` → `EstadoVacio` "Ninguna solicitud ARCO registrada…")

`listarSolicitudesArco` (`repo.ts:948-970`) usa `traerTodo`, que LANZA ante
error o lectura incompleta; el `.catch(() => [])` de la página convierte el
fallo en "no hay nada". Un bache de red o una base caída se leen como "tu flota
no tiene solicitudes pendientes" — la afirmación exacta que CLAUDE.md prohíbe
(fallar cerrado y decirlo), y aquí sobre una obligación con plazo legal (20 días
hábiles según el propio aviso). La misma página ignora `tenantExiste` del
`resolverTenantEfectivo` (devuelto y no leído): un superadmin apuntando a un
tenant inexistente también ve "Ninguna solicitud". El patrón hermano sobrevive
en /admin (`compliance/page.tsx:158-161`, `.catch(() => [])` en las dos
consultas) — preexistente, pero es la misma clase de mentira en la consola que
decidió la forma de este producto.

**Estado: abierto (introducido por `c901226` para /dashboard; preexistente en
/admin).**

### BAJO

#### [BAJO, abierto — nuevo. La pantalla de /admin quedó con el rótulo VIEJO y ahora falso] "Likida no envía mensajes ARCO todavía" se imprime justo cuando `resolverSolicitudArco` ya los envía — y el resultado del envío se descarta

`src/app/admin/compliance/page.tsx:44-46` (el mensaje de éxito de `accionResolver`
dice "La respuesta se entrega al titular por el canal que la flota defina —
Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente)") ·
`compliance/page.tsx:40` (`await resolverSolicitudArco(...)` sin leer el retorno)
· `repo.ts:998-1022` (la función ahora INTENTA el envío por WhatsApp y devuelve
`{ enviada, error }`)

El commit `c901226` implementó el envío y actualizó el mensaje de la página de
/dashboard ("Solicitud resuelta y la respuesta se envió al titular por
WhatsApp" / "…NO se pudo enviar… entrégala por otro canal"), pero dejó la página
de /admin con el mensaje de la ronda 15: si el envío SALE, el superadmin recibe
"Likida no envía mensajes ARCO todavía" — el rótulo niega lo que el código acaba
de hacer. Y como el retorno `{ enviada, error }` se descarta, el superadmin
nunca sabe si el titular recibió la respuesta (en la pantalla de /dashboard la
flota sí se entera; en la de /admin, no). Es la misma clase de rótulo que la
ronda 15 acusó en esta misma pantalla, reabierta por el commit que la cerró.

**Estado: abierto (regresión de `c901226`).**

#### [BAJO, abierto — nuevo. La plantilla `respuesta_arco` lleva {{1}} = el literal "la flota", no la razón social] El comentario de la propia línea promete la razón social; el código manda un marcador

`src/lib/meta/client.ts:465-468` — comentario: "La plantilla `respuesta_arco`
(creada 6-ago-2026) lleva {{1}} = razón social de la flota y {{2}} = la
respuesta"; código: `parameters: [{ type: 'text', text: 'la flota' }, { type:
'text', text: respuesta }]`. El primer parámetro es la cadena literal `'la
flota'` — no la razón social del tenant, que `resolverSolicitudArco` tiene a
mano vía `getDatosResponsable` (no se le pasa). Cuando Meta apruebe la plantilla,
el titular recibirá "…fue atendida por la empresa: la flota" con el nombre de su
patrón reemplazado por un sustantivo genérico. O el comentario miente o el
parámetro miente; los dos no pueden ser verdad.

**Estado: abierto (introducido por `c901226`).**

#### [BAJO, abierto — nuevo. Sin idempotencia ni guarda de estado: resolver dos veces una solicitud ARCO reenvía el WhatsApp y pisa la resolución]

`src/lib/cuadra/repo.ts:1003-1007` — el `UPDATE` a `resuelta` es incondicional
(no mira `estado`), y `repo.ts:1013-1020` reenvía el mensaje cada llamada. Un
doble clic en "Responder" (o dos admins resolviendo a la vez) manda la respuesta
dos veces al titular y deja la última `resolucion` escrita. Sin límite de
frecuencia tampoco: la acción de /dashboard solo exige sesión
(`requireSessionTenant`, sin gate de área — un `contador` no ve la página pero
la acción no lo verifica) y el envío es una llamada directa a Meta. Bajo impacto
(contenido del propio tenant), pero es el flujo legal más reciente del producto
sin una sola protección de doble envío.

**Estado: abierto (introducido por `c901226`).**

#### [BAJO, abierto — nuevo. La acción de /dashboard/arco resuelve contra el tenant de SESIÓN, la página lista contra el tenant EFECTIVO: el modo "ver como" de superadmin rompe el botón]

`src/app/dashboard/arco/page.tsx:22-24` (`requireSessionTenant(RUTA)` → para
superadmin devuelve `tenantDemo()`) · `page.tsx:37` (`resolverSolicitudArco(s.
tenantId, …)`) · `page.tsx:47` (`listarSolicitudesArco(tenantId)` con el tenant
efectivo de `resolverTenantEfectivo`). Un superadmin entrando a
`/dashboard/arco?tenant=<flotaX>` ve las solicitudes de la flota X y el botón
"Responder"; al enviarlo, la acción resuelve contra el tenant demo → "la
solicitud no existe en esta flota". Para los roles normales (flota_admin,
encargado) sesión = efectivo y funciona; el modo de previsualización del
superadmin —que es el que se usa en la sala para enseñar el panel del cliente—
tiene el botón muerto.

**Estado: abierto (introducido por `c901226`).**

#### [BAJO, abierto — nuevo. Fallback de teléfono: un UUID como número de WhatsApp]

`src/lib/cuadra/repo.ts:994` — `const telefono = (sol.titular_ref as string |
null) ?? (sol.operador_id as string | null) ?? null;` — `operador_id` es un
UUID; si `titular_ref` fuera null (hoy no puede: `registrarSolicitudArco`
siempre lo llena con el teléfono del webhook), el envío iría a
`destinatarioWhatsApp(uuid)` → un "número" de 32 dígitos que Meta rechaza.
Código muerto-riesgoso; el fallback correcto sería devolver `{enviada:false}`
sin inventar un destinatario.

**Estado: abierto (introducido por `c901226`).**

#### [BAJO, abierto — nuevo. "Vencen pronto (≤ 5 días hábiles)" se computa en días CALENDARIO]

`src/app/admin/compliance/page.tsx:67` (etiqueta "≤ 5 días hábiles") ·
`compliance/page.tsx:179` (`Date.now() + 5 * 864e5`). Cinco días calendario
pueden ser 3 días hábiles (fin de semana) — el rótulo promete una unidad y el
código computa otra, justo en el KPI que decide urgencia de una obligación
legal. La página de /dashboard dice "≤ 5 días" (sin "hábiles") y ahí el rótulo
sí es verdad. Un `venceEn` ya calculado con días hábiles (`venceArco`,
`privacidad.ts`) existe: lo que falta es el conteo hacia atrás con la misma
función, o quitarle "hábiles" al rótulo.

**Estado: abierto (introducido por `96f2adc`).**

#### [BAJO, abierto — nuevo. La "entrega por WhatsApp" de ARCO solo funciona dentro de la ventana de 24h hasta que Meta apruebe la plantilla]

`src/lib/meta/client.ts:442-459` (texto libre → ventana de 24h desde el
PRIVACIDAD; el comentario lo dice) · `client.ts:461-475` (fuera de ventana →
plantilla `respuesta_arco`, "aún en revisión de Meta — falla cerrado si no está
aprobada"). La resolución ARCO se contesta en días (el aviso promete 20 hábiles),
así que el camino real es: texto libre rechazado → plantilla no aprobada →
`{ok:false}` → la UI dice "entrégala por otro canal". Honesto, pero la feature
bandera de la ronda entrega "no se pudo" en el caso normal hasta que Meta
apruebe; conviene decirlo en el demo antes de que alguien lo muestre como
entregado.

**Estado: abierto (introducido por `c901226`).**

#### [BAJO, abierto — cierre parcial del MEDIO-2 de la ronda 15] Los criterios del contador siguen divergiendo entre la capa de periodo y el motor: `tools.ts` sin claves, `desde_db.ts` con claves

`src/lib/cuadra/tools.ts:105-109` (`getAcumuladoCombustible(ctx.tenantId,
ejercicio)` SIN claves → `repo.ts:855` cae a `concepto.eq.diesel` a secas) ·
`desde_db.ts:78` (`getAcumuladoCombustible(tenantId, Number(anioEjercicio),
clavesCombustible)` CON claves). El año ya coincide (fix de `96f2adc`), pero un
tenant con `hidrocarburos.claves` (gasolina 15101505, el caso real de
gasolineras) sigue viendo dos bases distintas en el mismo turno: el motor y sus
notas cuentan claves+diésel; el aviso de periodo cuenta solo diésel →
`evaluarTope15` sobre una base menor → 'holgado' → `combustible_efectivo_ejercicio`
ni se adjunta justo cuando el motor afirma excedentes. Misma línea que la 15
reportó; la mitad "año" se cerró, la mitad "criterio" no.

**Estado: abierto (cierre parcial de `96f2adc`).**

#### [BAJO, abierto — preexistentes de la ronda 15, sin tocar] Nota "deducible por la facilidad" sobre ticket SIN CFDI · portón 1-10 · "ochocientos" respaldado por el tope · "X mil" · edición parcial de la declaración · ficha `rfa-2026-2.9.yaml` · capa admin sin pruebas

- **Nota "deducible" sin CFDI** — `engine.ts:345-350`: `combustible_efectivo_dentro15`
  emite "…**deducible** por la facilidad del 15%" sin condición de `cfdiUuid`.
  Probe (motor real): ticket sin CFDI dentro del 15% → `totalPorConfirmar: 1000`,
  `totalDeducible: 0`, nota "deducible por la facilidad". El papel se contradice
  solo (recomendación #6 de la 14, sin aplicar).
- **Portón 1-10** — `cifras.ts:41-48`: `CARDINAL_SUELTO` incluye dos..diez y
  `NO_ES_DINERO` no trae `(?:a\s+las|el|al)\s+(dos|…|diez|…)`. Probe:
  "Llego a las cinco de la tarde." → `true`, "Salgo el seis por la mañana." →
  `true`, "El diez llego a Silao." → `true`. Un "¿a qué hora llegas?" →
  "llego a las cinco" recibe el cuadre determinístico.
- **"ochocientos"** — `cifras.ts:187-196` + `guardia.ts:102-104`: el cardinal
  que coincide con un tope de política sale "respaldado". Probe:
  `cifrasSinRespaldo("Te sobran ochocientos del anticipo y el tope del diésel es
  800.", [{politica:{topes:{diesel:800}}}])` → `[]`.
- **"X mil"** — `cifras.ts:220`: "ocho mil"→1008, "quinientos mil"→1500
  (probe). Riesgo: coincidencia por casualidad con un tope real (caseta $1,500
  del demo).
- **Edición parcial borra la declaración** — `admin/flotas/page.tsx:57-58,69` +
  `repo.ts:929-933`: cambiar solo "Carga" a "No" dejando "Régimen" en "—" →
  `delete` de la llave entera → la flota pasa de "elegible" a "sin declarar" —
  y el mensaje dice "Declaración del 15% actualizada." (solo el caso
  "ambos `undefined`" dice "borrada"). El fix de `96f2adc` agregó el chequeo de
  error de lectura (bien), pero no tocó este borrado silencioso.
- **Ficha `rfa-2026-2.9.yaml:45-47`** sigue diciendo "El CONTADOR del 15% por
  ejercicio no existe todavía" cuando `desde_db.ts`+`engine.ts` lo implementan
  desde `0d23f73`. Último commit `e5d6b46`.
- **Capa admin/narrativa sin pruebas**: `aviso.test.ts` pasa solo `true` como
  tercer argumento; `actualizarFacilidad15` tiene cero referencias en
  `*.test.ts`; `enviarRespuestaArco` y `resolverSolicitudArco` (nuevos) tampoco
  tienen ninguna.

**Estado: abiertos (todos, preexistentes o sin avance).**

## Lo que revisé y está bien (sin tocar)

- **Fail-closed del contador del 15% — cerrado con la forma correcta.**
  `engine.ts:315-327`: con `total <= 0` o gasto de otro ejercicio, el gasto va a
  `combustible_efectivo` (cubeta por_confirmar, estatus 'revisar') con nota
  honesta "no se pudo calcular… no se evaluó; no se afirma deducible ni no
  deducible". Probado: `totalPorConfirmar: 1000`, `totalNoDeducible: 0`,
  `estatus: 'revisar'`. El comentario de `desde_db.ts:70-74` que la ronda 15
  acusó de prometer una rama inexistente, ya describe una rama que EXISTE.
- **Estatus y cubetas**: `REVISAR` incluye `combustible_efectivo`,
  `efectivo_sobre_15`, `efectivo_no_elegible`; `cubetaDe` sigue siendo la única
  definición (NO_DEDUCIBLE_ISR / POR_CONFIRMAR). El dinero del caso medido suma
  las tres cubetas.
- **Tri-estado en el panel**: `fiscal.ts:338` — `elegible15 === false` →
  `efectivo_no_elegible` (perdida), cualquier otro → `combustible_efectivo`
  (en_riesgo). El panel ya no contradice al motor para "sin declarar"; el banner
  de `dashboard/contador/combustible/page.tsx:155-166` distingue los tres
  estados con el texto correcto.
- **Año del periodo**: `tools.ts:105-108` ancla al año del viaje, misma regla
  que `desde_db.ts:63-66`. La divergencia "año del proceso vs. año del viaje"
  de la ronda 15 quedó cerrada.
- **CRÍTICO ARCO de la 15**: `compliance/page.tsx:150-180` — el superadmin ya
  ve TODAS las flotas con columna de flota; la acción resuelve bajo el
  `tenant_id` de la solicitud (no el de la sesión, que es null). Verificado.
- **`guardia.ts` intacta**: `cuadro`/`cerro`/`consultoPolitica` separados,
  snapshot AG-3 de cierre (`guardia.ts:92-101`), `'operador'` explícito en
  `resumenCuadre`, fail-closed final (`guardia.ts:116-118`) — el mensaje neutral
  "Dame un momento…" sigue siendo el último muro.
- **`resumen.ts`**: `combustible_efectivo` (la rama honesta) NO está en
  `SOLO_CONTRALOR`, así que el operador recibe "no se pudo calcular… se revisa"
  — informativo, no acusatorio. `efectivo_sobre_15` tampoco (preexistente).
- **`enviarRespuestaArco` falla cerrado**: si Meta rechaza el texto libre y la
  plantilla no está aprobada, devuelve `{ok:false}` y la UI de /dashboard lo
  dice ("entrégala por otro canal") — no se miente como en la 15. El envío usa
  `destinatarioWhatsApp` (quita el "1" mexicano, probado por
  `destinatario.test.ts`) y `SEND_TIMEOUT_MS` 10s.
- **`venceArco`** sigue rastreando la promesa del aviso (20 días hábiles),
  documentado en `privacidad.ts:538` — consistente entre la base, el aviso y las
  dos pantallas (el "art. 32 = 15 días" es discusión legal, no de este rubro).
- **Suites del rubro en verde**: engine 117, cifras 22, aviso 6, guardia 20,
  processor+privacidad 88, repo_acumulado+administracion+meta+tools 57. `tsc
  --noEmit -p .` limpio. `eslint` sin hallazgos nuevos en los archivos del rubro.

## Lo que no alcancé a revisar

- **La suite completa (3,132+)** no la corrí — otros auditores la tienen; corrí
  los archivos del rubro (arriba).
- **El render real de `/dashboard/arco` y el envío vivo a Meta**: la plantilla
  `respuesta_arco` está en revisión de Meta; no hice llamadas reales (regla del
  rubro: solo lectura). El comportamiento del texto libre se razonó contra la
  documentación de la ventana de 24h, no se ejecutó.
- **El modo de falla de la deflación contra la base real**: razonado y probado
  con el motor puro; no medí contadores reales (no toco la base).
- **`huerfanos.ts`, `tool-executor.ts`, `openrouter.ts` (loop-guard)**: sin
  cambios desde la 13/14 (verificado por `git log`), no los re-leí línea por
  línea.
- **Los `zzz-*` de otros auditores**: los vi en el árbol, no los toqué.

## Veredicto

**Green light para el demo, con dos MEDIO nuevos que no se ven en la sala y la
deuda de siempre otra vez intacta.**

Lo que la ronda prometió cumplir, cumplió en lo central: el fail-closed del 15%
—el hallazgo más caro de la 15— quedó cerrado con la forma correcta y con
prueba (contador caído → por-confirmar con nota honesta, nunca "NO se deduce
contra tope de $0"); el CRÍTICO ARCO (pantalla de /admin vacía) quedó cerrado;
la contradicción panel/motor del tri-estado quedó cerrada; el año del periodo
se alineó al del motor. El camino feliz del guion (fotos → "listo" → cuadre →
PDF) sigue protegido por la guardia más fuerte del sistema y el diésel del seed
es electrónico (`forma_pago '03'`), así que ninguna de las válvulas nuevas se
enciende en la sala.

Pero la ronda volvió a demostrar el patrón de fondo: **un fix que se queda a
medias o que corta de más**. (1) El `continue` del fail-closed (`engine.ts:324`)
se salta `sobre_politica`, `fecha_sospechosa`, `monto_discrepante`,
`comprobante_no_fiscal` y `ocr_baja_confianza` para el gasto exacto que está
revisándose — probado con valores, y es la regresión que la propia ronda
introdujo al cerrar el hallazgo de la 15. (2) La deflación del año cruzado
sigue viva (`desde_db.ts:84-87` sin filtro de año) y el test nuevo la enmascara
pasando el previo a mano: el escenario normal de enero sigue regalando cupo del
15% de 2026 a los gastos 2026 de un viaje que carga tickets de 2025. (3) La
feature bandera —ARCO por WhatsApp— llegó con su propio rótulo falso: /admin
sigue imprimiendo "Likida no envía mensajes ARCO todavía" mientras el código ya
los envía (y descarta el resultado), la plantilla lleva el literal "la flota"
donde el comentario promete la razón social, y el camino entero —incluido el
envío nuevo— no tiene una sola prueba. (4) Y los cinco hallazgos de cifras y
admin de las rondas 13-15 (portón 1-10, "ochocientos", "X mil", edición parcial
de la declaración, ficha muerta) siguen exactamente donde estaban.

Recomendación para la ronda 17, en orden: (a) quitar el `continue` del
fail-closed (una línea + pruebas de que `sobre_politica` y `monto_discrepante`
siguen emitiéndose con el contador caído); (b) filtrar `efectivoDeEsteViaje` por
`anioEjercicio` y probar la ruta `desde_db → engine` completa; (c) arreglar el
mensaje y el retorno de la página de /admin para ARCO, pasar la razón social a
la plantilla, y añadir las pruebas del envío (fetch mockeado, doble clic, fuera
de ventana); (d) el gate de área en la acción de /dashboard/arco (y resolver
contra el tenant efectivo); (e) la deuda de cifras (patrón 1-10, "mil",
cardinales) y la edición parcial de la declaración — las cinco llevan tres
rondas en la lista.
