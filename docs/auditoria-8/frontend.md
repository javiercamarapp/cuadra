# Frontend — auditoría 8

**Nota: 6/10** (antes 4). Razón del movimiento: **se atacó y subió**. Los tres
hallazgos vivos de la ronda 6 se tocaron de verdad y dos quedaron cerrados con
prueba que los reproduce: el CRÍTICO de `reconstruir()` ahora tiene el portón
`derivoLaConfig` (`analytics.ts:341,385-395`, probado en
`analytics_deriva.test.ts`), y el MEDIO de la fecha panel-contra-PDF se cerró
borrando la segunda implementación y poniendo una prueba que prohíbe la tercera
(`utils_fecha.test.ts:47-67`). El encargo de esta ronda también sale limpio:
`src/lib/formato.ts` **sí** es el único origen del formato, el panel lo consume
en las cuatro superficies que imprimen cifras, y hay un guardarraíl que hace
`grep` sobre `src/` y falla si aparece una segunda copia
(`src/lib/formato.test.ts:57-91`). Lo que impide pasar de 6: las dos páginas
nuevas nunca auditadas traen dos huecos, y —lo que pesa más— la sección de
dinero del panel no tiene estado para "cero porque no lo pude determinar", que
con el tenant tal como está hoy es exactamente lo que va a pintar el 6 de
agosto.

**El riesgo mayor hoy:** el minuto 4 del guion del demo proyecta `/dashboard` y
la sección hero —"Estímulos acreditables del periodo"— sale **0 L · $0.00 ·
$0.00**, y el detalle explica el "Por confirmar" con una razón que no es la
verdadera.

---

## Hallazgos

### [ALTO] El renglón "Por confirmar" nombra dos causas y, en el caso que hoy dispara, ninguna de las dos es la real — y el mismo texto va impreso al PDF que se archiva

`src/lib/cuadra/liquidacion/deducibilidad.ts:48-55` (el `pie`) ·
`src/app/dashboard/[id]/page.tsx:100-121` (lo pinta; línea 110 es el `pie`) ·
`src/lib/cuadra/liquidacion/pdf.ts:248` (el MISMO texto en el papel) ·
`src/lib/cuadra/cuadre/engine.ts:85` (`POR_CONFIRMAR` incluye
`rfc_receptor_no_verificable`)

**Escenario, ejecutado con el motor real** sobre los dos gastos que
`supabase/seed.sql:120-129` siembra en el viaje demo `VJ-2026-0847`, y con el
RFC de la flota tal como el propio seed lo deja (`TIN010101AAA`):

```
$ npx tsx  (cuadrarViaje con los gastos del seed)
  diésel $4,200 · CFDI b7e3f1a2… · estadoSat vigente · ClaveProdServ 15101505
                 · complemento HidroYPetro · FormaPago 03 · IVA $581.38
  caseta $1,400 · CFDI c8f4a2b3… · estadoSat vigente · FormaPago 04 · IVA $193.10

  deducible 0 · noDeducible 0 · porConfirmar 5600
  diferencias: sobre_politica(200), rfc_receptor_no_verificable ×2, anticipo(5000)
```

El panel entonces pinta, en la sección "De lo comprobado, cuánto es deducible":

> **Por confirmar — $5,600.00**
> *Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar.*

Las dos facturas **están timbradas** (traen UUID y `estadoSat: 'vigente'`) y las
dos **están pagadas por medio electrónico** (`FormaPago` 03 y 04). La causa real
—la única— es que el RFC de la flota no se puede usar para comparar, y eso el
motor sí lo dice, pero en otra sección de la pantalla (`Diferencias detectadas`:
*"No se puede verificar a nombre de quién está la factura de Combustible: el RFC
de la flota está mal capturado"*). El `pie` es una cadena fija que no deriva del
motivo: `deducibilidad.ts` solo recibe tres números y no sabe por qué son esos.

**Consecuencia.** En la sala: el guion acaba de decir, un minuto antes, *"cada
CFDI se valida contra el SAT: vigente, cancelado, lista negra del 69-B"*
(`GUION_DEMO.md` §5). El contralor abre el detalle y lee que falta timbrar la
factura que acaba de ver validada. Fuera de la sala es peor, porque
`pdf.ts:248` imprime el mismo pie en el documento archivado: el contador de la
flota recibe la instrucción de perseguir a la gasolinera por una factura que ya
existe, en vez de corregir un campo del alta.

**Causa raíz probable.** El `pie` explica una sola de las tres razones por las
que `cubetaDe` manda un gasto a `por_confirmar` (`engine.ts:102-111`): cubre
`!g.cfdiUuid` y `combustible_efectivo`, y no cubre
`rfc_receptor_no_verificable`, que se añadió a `POR_CONFIRMAR` después.

**Por qué no lo pongo en CRÍTICO.** Las cifras son correctas: $5,600 sí está por
confirmar. Lo que está mal es la explicación, no el dinero.

---

### [ALTO] El hero de acreditables no distingue "cero" de "no lo pude determinar", y con el tenant del demo pinta 0 L · $0.00 · $0.00 en la pantalla que el guion manda proyectar

`src/app/dashboard/page.tsx:134-143` (las tres tarjetas) ·
`src/app/dashboard/page.tsx:287-305` (`Acred`: sin rama para el cero) ·
`src/lib/cuadra/analytics.ts:130-145` (`getAcreditables`) ·
`src/app/dashboard/[id]/page.tsx:40,124-137` (`hayAcred`: la sección del detalle
desaparece entera)

**Escenario, con valores.** El tenant demo tal como lo deja `supabase/seed.sql`:

1. Las tres liquidaciones del historial (`seed.sql:145-148`) no escriben ninguna
   de las cuatro columnas de acreditables, y las cuatro son `not null default 0`
   (`0007_acreditamiento.sql:9-11`, `0021_liquidacion_litros_diesel.sql:13`).
2. La liquidación que se crea **en vivo** en la sala tampoco aporta nada:
   ejecutado con el motor real sobre los gastos del seed (ver el hallazgo
   anterior), `litrosDieselAcreditables = 0`, `ivaAcreditable = 0`,
   `peajeAcreditable = 0`, porque `rfc_receptor_no_verificable` está en
   `SIN_ACREDITAMIENTO` (`engine.ts:647,658`).

Resultado: `getAcreditables` devuelve `{ litrosDiesel: 0, iva: 0, peaje: 0 }` y
el panel pinta las tres tarjetas con `text-4xl md:text-5xl`, la primera en verde
acento por `destacar`:

```
Estímulos acreditables del periodo
┌──────────────────────────┬──────────────────┬──────────────────┐
│ Diésel elegible…  0 L    │ IVA acred. $0.00 │ Peaje (50%) $0.00│
│ LIF 2026, Art. 20-A …    │ LIVA, Art. 5 …   │ LIF 2026 20-A …  │
└──────────────────────────┴──────────────────┴──────────────────┘
```

`estadoPanel` devuelve `'datos'` (hay 3+ liquidaciones y los KPIs cargaron), así
que ni el estado vacío ni el aviso de carga parcial se activan; y `Acred` solo
tiene dos ramas, `acred === null` → "No se pudo cargar esta sección" y todo lo
demás → pintar el número. No hay tercera. En el detalle es al revés y tampoco
ayuda: `hayAcred` (línea 40) es falso con los cuatro en cero, así que la sección
"Acreditable / recuperable" **no se pinta**, y no queda ningún sitio donde leer
por qué.

**Consecuencia.** `GUION_DEMO.md:84-102` dedica el bloque 4 a esta sección
—*"Hoy el panel dice «Diésel elegible para el estímulo — N litros»… eso al
contralor le suena a rigor, no a que falta algo"*— y lo que el contralor va a
ver es un cero de 48 px bajo un título que promete estímulos. "$0.00 de IVA
acreditable" es una afirmación sobre el dinero de su flota, no un "no lo sé":
es la misma clase de falla silenciosa que el CRÍTICO de la ronda 5 ("Aún no hay
liquidaciones" con la base caída), con la diferencia de que aquí el cero sí
viene de la base.

**Causa raíz probable.** La sección de anomalías razona explícitamente que *"una
sección vacía que dice «0 anomalías» entrena a ignorarla"* (`page.tsx:163-167`)
y por eso se oculta cuando está vacía; ese mismo criterio no se aplicó al hero,
que es la sección donde más importa.

**Intento de refutación.** ¿Lo tapa el pie de cada tarjeta? No: `base` cita el
fundamento legal (*"LIF 2026, Art. 20-A — su contador aplica la cuota semanal
vigente"*), que junto a un cero se lee como "la ley dice que le toca cero". ¿Y
el RFC de la flota, que el MAPA declara fuera de rubro? Correcto, y no lo
reporto: el hallazgo es que **la pantalla no tiene forma de expresar un cero
indeterminado**, y ese hueco se dispara igual con cualquier flota real cuyo
primer día sean tickets sin timbrar — `xmlVerificado` es requisito duro del
acreditamiento (`engine.ts:664`).

---

### [MEDIO] `--color-warn` se usa como TINTA y mide 1.99:1 en modo claro, en la única página que un operador abre desde el celular

`src/app/aviso/[tenant]/page.tsx:118-122` ·
`src/app/globals.css:31` (`--color-warn: #ff9f0a`, sin override en oscuro) ·
`src/app/dashboard/contraste.test.ts:11-16,59-111`

**Escenario, medido con la misma fórmula de WCAG que usa la prueba del repo**
(`contraste.test.ts:25-35`, ejecutada sobre los valores reales de
`globals.css`):

```
#ff9f0a sobre --bg claro  #fbfbfd →  1.99:1
#ff9f0a sobre --surface   #ffffff →  2.06:1
#ff9f0a sobre --bg oscuro #0b0b0f →  9.56:1
```

AA pide 4.5:1 para texto normal y 3:1 hasta para texto grande. El renglón
*"Pendiente de capturar"* de `aviso/[tenant]/page.tsx:119` va en `text-xs
font-medium` (12 px) con ese color y **se renderiza para el tenant del demo**:
`seed.sql` no escribe `contacto_privacidad` (columna añadida en
`0034_tenant_contacto_privacidad.sql:19`), así que la sección del art. 29 sale
con `pendiente: true` (`privacidad.ts:530`).

**Consecuencia.** El operador abre su aviso integral de día, con el teléfono en
modo claro, y la única marca que le dice *qué parte de su aviso está incompleta*
es la menos legible de la página. La misma marca en modo oscuro pasa
holgadamente, así que el defecto solo existe para la mitad de los lectores —el
peor tipo de defecto de contraste, porque quien lo revisa de noche no lo ve.

**Causa raíz probable.** `contraste.test.ts` dice en su encabezado que mide *"los
tres tokens con significado en los dos modos"* y sus 7 pruebas solo miden
`--color-ok` y `--color-bad`: el tercero, `--color-warn`, nunca entró. El propio
sistema de diseño del repo ya sabía que #FF9F0A no sirve de tinta —
`design-system/styles.css:284` pinta `.tag-warn` con `#7A4A00` (7.48:1) sobre un
fondo teñido de warn, no con el warn puro.

---

### [MEDIO] La política de privacidad de Likida existe y ninguna superficie de la aplicación la enlaza

`src/app/privacidad/page.tsx` (la página entera) ·
`src/app/page.tsx:44-46` (el pie de la portada, donde tocaría) ·
`src/app/dashboard/page.tsx:279-281` y `src/app/dashboard/[id]/page.tsx:217-219`
(los dos pies del panel: solo `LEYENDA_CORTA`)

**Escenario.** El contralor —que es exactamente el titular del que Likida SÍ es
responsable, según la propia página (`privacidad/page.tsx:52`)— entra a la
portada, recorre el pie, entra al panel, recorre los dos pies del panel y abre
el detalle de una liquidación: en ninguna de las cuatro pantallas hay una liga a
`/privacidad`. La única forma de llegar es teclear la ruta. Verificado con dos
búsquedas: `grep -rn "/privacidad" src/app --include=*.tsx` solo devuelve el
import de `@/lib/cuadra/privacidad` en la página del aviso, y el barrido sobre
`href=` en `src/app` no devuelve ninguna.

**Consecuencia.** La página se escribió porque la app de Meta está en `dev_mode`
con `privacy_policy_url: null` y Meta exige una (su propio encabezado, líneas
19-23). Para ese trámite basta la URL. Pero para el comprador que la busque en
el producto no existe, y es el documento que le dice qué hace Likida con sus
datos y cómo ejercer ARCO — con un plazo de 20 días hábiles que empieza a correr
cuando la encuentra.

**Causa raíz probable.** La página se creó para satisfacer un requisito externo
(Meta) y no se le dio entrada desde la navegación; es el mismo patrón —"se
construyó el mecanismo y nunca se conectó"— que el MAPA de esta ronda pide
vigilar.

---

### [MEDIO] Un aviso integral incompleto cae en el 404 genérico, que le habla al chofer de liquidaciones y lo manda a una pantalla con passcode

`src/app/aviso/[tenant]/page.tsx:62,69` (los dos `notFound()`) ·
`src/app/not-found.tsx:10-20` · `src/app/dashboard/page.tsx:57`
(`exigirAcceso`)

**Escenario, con valores.** Una flota dada de alta con `tenant.razon_social`
vacío —el caso que `seed.sql:14-22` documenta como el estado normal hasta que la
flota captura sus datos— hace que `getDatosResponsable` devuelva `null`
(`repo.ts:451`) y la página llame `notFound()`. El operador, que llegó ahí desde
la liga de su aviso simplificado por WhatsApp, lee:

> **Esta página no existe**
> Puede que el enlace esté mal escrito o que **la liquidación** ya no esté
> disponible.
> `[ Ir al panel ]`

Y si toca el botón, `/dashboard` llama `exigirAcceso` y lo deja frente a la
pantalla del código de acceso del contralor.

**Consecuencia.** El titular que ejerce el art. 16 fr. II de la LFPDPPP —
consultar el aviso integral que su empresa le señaló— recibe un texto que habla
de un objeto que él no tiene (una liquidación) y una salida que no le sirve. La
decisión de responder 404 sin distinguir "no existe" de "está a medias" está
razonada en el archivo (líneas 28-31) y es correcta; lo que no está resuelto es
que la ruta pública no tiene su propio `not-found`, así que hereda el del panel.

**Causa raíz probable.** `not-found.tsx` se escribió para el segmento del
dashboard (su copia lo dice) y quedó como el único de toda la aplicación cuando
se añadieron dos rutas públicas dirigidas a otra persona.

---

### [BAJO] Un fallo del export se descarga como archivo en vez de verse: el contralor cree que bajó el CSV

`src/app/dashboard/page.tsx:202-205` (`<a href="/api/export/liquidaciones"
download>`) · `src/app/api/export/liquidaciones/route.ts:20,39`

**Escenario, con valores.** La cookie de acceso dura 8 horas
(`acceso/page.tsx:30`, `maxAge: 60*60*8`). Con la cookie caducada —o con la
lectura de Supabase caída— la ruta responde `401 No autorizado` o `500 No se
pudo generar el export…` en `text/plain` y **sin** `Content-Disposition`. Como
el ancla lleva el atributo `download`, el navegador guarda ese cuerpo como
archivo (nombre tomado del último tramo de la URL, `liquidaciones`, sin
extensión) en vez de mostrarlo. El panel no cambia en nada.

**Consecuencia.** El contralor ve la animación de descarga, asume que tiene su
corte en Excel, y se entera al abrirlo. Es el único botón del panel que no
tiene forma de reportar su propio fallo en pantalla.

---

### [BAJO] `getStatsPorOperador` sigue sin traducir el error-por-valor y sigue sin llamador — REINCIDENTE (ronda 6, BAJO)

`src/lib/cuadra/analytics.ts:71-95`

Sin cambios desde la ronda 6. Las otras cuatro lecturas del archivo pasan por
`exigir()` (líneas 44, 116, 135, 182); ésta destructura `{ data: ops }`,
`{ data: gastos }`, `{ data: viajes }` directo y usa `?? []`. Si cualquiera de
las tres consultas falla (host caído, RLS, llave rotada), devuelve
`OperadorStat[]` con `viajes: 0, dieselTotal: 0` para cada operador —
indistinguible de "este operador de verdad no tiene viajes". Sigue siendo BAJO
por la misma razón: dos búsquedas (`getStatsPorOperador` y `OperadorStat` sobre
`src/`) devuelven solo su propia definición, así que ninguna pantalla lo pinta
hoy. Se activa solo el día que alguien lo conecte a la vista de rendimiento por
operador, que es obviamente para lo que existe.

---

## Lo que revisé y está bien

**El encargo de la ronda sale limpio: el panel SÍ usa `src/lib/formato.ts`.** Las
cuatro superficies del panel importan de ahí: `dashboard/page.tsx:5,8`
(`mxn` vía `@/lib/utils`, que reexporta en `utils.ts:12`; `litros` y `fechaMx`
vía `dashboard/formato.ts:27`, que también reexporta), `[id]/page.tsx:8-9`,
`privacidad/page.tsx:1` y `aviso/[tenant]/page.tsx:4`. `formato.ts` no importa
nada (verificado a mano y fijado en `formato.test.ts:83-90`). Y el guardarraíl
que faltaba existe: `formato.test.ts:68-81` hace `grep -rl "toLocaleString('es-MX'"`
sobre `src/` y falla si aparece fuera de `formato.ts`, ignorando comentarios. Un
barrido propio de `toLocaleString` / `toFixed` / `Intl.NumberFormat` /
`toLocaleDateString` sobre `src/` no encontró ninguna copia de moneda ni de
fecha fuera de ahí. Corrí las 7 pruebas: verdes.

**El CRÍTICO de la ronda 6 está cerrado, y con el mecanismo correcto.**
`reconstruir()` ya no confía solo en `totalComprobado` —la cifra que un cambio
de config nunca mueve—: compara además el CONJUNTO DE TIPOS de diferencia
persistido contra el que produce el motor hoy (`analytics.ts:341` y
`derivoLaConfig`, líneas 385-395), y ante deriva se calla y cae al camino de
gastos crudos, que ya se marca "puede no sumar" (`[id]/page.tsx:210-215`). Leí
la función completa: la comparación de conjuntos es correcta (mismo tamaño + todo
`ahora` contenido en `antes`), y `!Array.isArray(persistidas) → false` evita
apagar el desglose por una liquidación vieja con `diferencias: null`.
`analytics_deriva.test.ts` la ejercita contra la función real, no contra una
copia dentro del test (su propio comentario dice que ese error se cometió y se
corrigió).

**El MEDIO de la ronda 6 —panel y PDF fechando días distintos— está cerrado
borrando la segunda copia.** `pdf.ts:15,51` importa `fechaMx` de `@/lib/formato`
y ya no formatea por su cuenta; `utils_fecha.test.ts:47-67` fija las dos cosas
que importan: que el PDF use la función compartida y que no vuelva a aparecer un
`toLocaleDateString` en ese archivo. Corrí sus 6 pruebas: verdes.

**Los mapas literales del panel siguen cuadrando con `src/types/cuadra.ts` —
comparación obligatoria hecha, clave por clave.** `CONCEPTO`
(`[id]/page.tsx:20-24`) tiene las 9 claves de `ConceptoGasto`
(`cuadra.ts:20-25`), incluidas `flete` y la heredada `viaticos`, con fallback
`?? g.concepto`. Los dos `ESTATUS` (`page.tsx:14-18`, `[id]/page.tsx:25-29`)
tienen las 3 de `EstatusLiquidacion` (`cuadra.ts:104`), los dos con fallback
`?? { label: crudo, color: var(--muted) }`. Y el dominio está cerrado también
del lado de la base: `0025_dominios_check.sql:126-127` restringe
`liquidacion.estatus` a esas mismas tres cadenas, así que el fallback es red,
no camino. No hay ningún mapa del panel sobre `TipoDiferencia`: la pantalla
imprime `df.nota`, que la escribe el motor.

**La etiqueta del renglón no puede volver a divergir del PDF.**
`etiquetaGasto` (`[id]/page.tsx:238-241`) llama `etiquetaConcepto` del motor con
el `ocrExtra` del gasto y solo cae al mapa local cuando el motor devuelve la
clave cruda. `etiquetas_panel.test.ts` mira la SALIDA (un ticket de MAGNA no
puede salir "Diésel"), no la forma. Corrí sus 3 pruebas: verdes.

**Los cuatro estados del panel están pintados a propósito y probados.**
`estado.ts` es puro y `estado.test.ts` cubre los seis casos, incluido el
traicionero (KPIs en cero legítimo + listado caído → `parcial`). Existen
`dashboard/loading.tsx`, `[id]/loading.tsx` —cuyo andamio sí corresponde al
detalle, `max-w-4xl` y tres tarjetas—, `dashboard/error.tsx` y
`global-error.tsx`, y los dos boundaries pintan el `digest` en pantalla
(`select-all`) y lo mandan al logger. `layout.tsx:17` ya declara el `viewport`.

**El detalle no publica un desglose que se contradiga con su propio total.**
`filasDeducibilidad` devuelve `null` si las tres cubetas no suman
`totalComprobado` con un centavo de tolerancia (`deducibilidad.ts:41-42`), y la
página no pinta nada en ese caso. Los `key` de esa lista son `f.label`, y los
tres labels posibles son distintos entre sí (líneas 46, 50, 58): no hay colisión
que reordene renglones de dinero. En la tabla de comprobantes el orden se fija
en `analytics.ts` con `fecha` + `id` de desempate en las DOS rutas (la
reconstruida y la de respaldo), así que recargar no baraja las filas.

**Las páginas nuevas no tienen fuga ni inyección.** `aviso/[tenant]` valida la
forma del UUID antes de tocar la base (línea 62), `getDatosResponsable` solo
selecciona cuatro columnas y ninguna es RFC/plan/config (`repo.ts:435`), y
`ConNegritas` —en las dos páginas— parte con regex y renderiza los tramos como
hijos de React, que escapan: una razón social con `<script>` sale como texto.
`getDatosResponsable` sí traduce el error-por-valor a excepción
(`repo.ts:438`), o sea que no cae en el patrón de "fallo disfrazado de no hay"
que el MAPA pide buscar por sexta vez.

**El contraste de los dos tokens que sí se miden no se ha desandado.** Corrí
`contraste.test.ts` (7 pruebas, verdes) y remedí a mano: `--color-ok` 7.67:1 en
claro / 8.12:1 en oscuro, `--color-bad` 5.38 / 5.29. `--muted` como texto
normal, que la prueba no cubre, da 4.68:1 en claro y 7.47:1 en oscuro: pasa AA
por poco pero pasa. `--accent` sobre blanco, 5.13:1.

**El demo determinístico corre y da lo que el guion promete.** Ejecuté
`cuadrarViaje` con los cuatro `PRESETS` de `demo/page.tsx:12-17` y la política de
`api/demo/route.ts:19-27`: comprobado $10,600 = anticipo, diferencia 0, y una
sola observación (`sobre_politica` $200, el diésel de $4,200 contra el tope de
$4,000). El `catch` de `cerrar()` (línea 65-67) evita que un fallo de red cuelgue
el simulador.

**El seed apuntando a `likida.ai/aviso/…` mientras el software se muda a
`app.likida.ai` NO es un hueco escondido:** `seed.sql:44-52` lo documenta como
decisión explícita (no adelantarse a un host que hoy da 404) y
`dominio_propio.test.ts` impide que vuelva a colarse un dominio ajeno. Lo dejo
anotado, no como hallazgo mío.

## Lo que NO alcancé a revisar

- **Sigo sin renderizar nada.** Todo lo de arriba es lectura, ejecución de
  funciones puras con `npx tsx`, y `vitest run` real: no levanté `next dev` ni
  tomé una captura. En concreto no vi: el reflow del encabezado del panel
  (`dashboard/page.tsx:76-86`, un flex sin `flex-wrap` ni `min-w-0` dentro de un
  `h-16` fijo) a 375 px, el `backdrop-filter` de `.glass` en un proyector, el
  foco de teclado, y el orden de tabulación de la tabla. Tres rondas seguidas
  con la misma deuda.
- **No verifiqué el residuo de `derivoLaConfig`.** Compara TIPOS como conjunto,
  así que un cambio de config que mueva los MONTOS sin añadir ni quitar un tipo
  —bajar `estimulos.viaticosTopeFiscalDiarioMxn` teniendo ya un
  `viatico_excede_fiscal` en la liquidación— pasaría el portón y volvería a
  mover el desglose. No lo reporto porque no encontré ninguna ruta de la
  aplicación que edite `tenant.config` y porque ese tope es una cifra de ley,
  no una preferencia de flota; queda anotado para quien toque ese archivo.
- **No audité `design-system/`** más allá de comparar `--color-warn` y
  `.tag-warn`. Es un kit HTML estático con otra marca entera (Jost, paleta
  ladrillo/marino/crema) que el producto no implementa; si eso es divergencia
  deliberada o deuda, no me consta.
- **No revisé `src/app/acceso/page.tsx` como superficie de seguridad** (rate
  limit, comparación en tiempo constante, cookie): lo leí y es territorio del
  rubro de seguridad.
- **No medí el costo de `reconstruir()` por request** (corre el motor entero y
  llama `getConfig`, `getViaje`, `getGastos` en cada carga del detalle). Es
  rendimiento, no frontend, pero es la misma función de los dos hallazgos ALTOS.
