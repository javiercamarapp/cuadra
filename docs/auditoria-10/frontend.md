# Frontend — auditoría 10

**Nota: 5/10** (antes 7). Razón del movimiento: *mirada más profunda (el código
no cambió, la nota anterior estaba inflada)*.

El alto de la ronda 9 **sí cerró de verdad** —lo verifiqué corriendo el motor,
no leyendo el commit— y eso vale. Pero el 7 se puso sobre un rubro que nadie
había ejecutado: la carta más grande del panel, la que `GUION_DEMO.md:113-120`
le pone en la boca a Javier frente al contralor, imprime **`0 L`** en las tres
rutas que el demo puede tomar. Eso no es una regresión nueva: llevaba ahí desde
antes de la ronda 9 y ninguna ronda lo miró, porque nadie corrió el panel con
los datos del demo. El rubro está bien construido —los cuatro estados del panel
están pintados a propósito, el formato es único, el contraste se mide— y aun así
el 6 de agosto se proyecta un cero donde va la cifra que vende.

El riesgo mayor del rubro, hoy: la tarjeta destacada del panel dice `0 L` en el
minuto 5 del guion, y el guion manda narrarla como el dato duro que el contador
multiplica.

## Hallazgos

### [CRÍTICO] La tarjeta destacada del panel — "Diésel elegible para el estímulo" — imprime `0 L` en las tres rutas que el demo puede tomar

`src/app/dashboard/page.tsx:138` (pinta `acred.litrosDiesel` con `destacar`, en
`text-4xl md:text-5xl` y color `--accent`, el elemento más grande de la pantalla)
· `src/app/dashboard/page.tsx:296` (`litros(0)` → `"0 L"`) ·
`src/lib/cuadra/analytics.ts:175-192` (`getAcreditables` suma la columna
persistida `litros_diesel_acreditables`) · `src/lib/cuadra/cuadre/engine.ts:906`
(`esDieselIeps` exige `g.claveProdServ`) · `engine.ts:928-930` (los litros salen
de `ocrExtra.litros`) · `src/lib/cuadra/intake/cfdi_xml.ts:115,168`
(`claveProdServ` solo se escribe parseando el XML) ·
`src/lib/cuadra/intake/ocr.ts:406` (`litros` solo se escribe leyendo la foto) ·
`supabase/seed.sql:121-129` (el gasto del viaje demo se inserta sin `ocr_extra`)
· `GUION_DEMO.md:104,113-120`.

**Escenario, medido con el motor real** (`npx tsx` sobre `cuadrarViaje`, sin
mocks, con el gasto exacto del seed: diésel $4,200, `clave_prod_serv=15101505`,
`clave_unidad=LTR`, `complemento_hidrocarburos=true`, `forma_pago=03`,
`ieps_traslado=408.62`, más la caseta de $1,400, RFC de flota válido
`GMX0902279I1`):

```
estatus: con_diferencias
cubetas: 5600 / 0 / 0
acreditables: { litros: 0, iva: 774.48, peaje: 603.45 }
```

`iva` y `peaje` salen bien. **`litros` sale 0.** Las tres rutas por las que puede
llegar la liquidación del 6 de agosto dan lo mismo:

| Ruta | `claveProdServ` | `ocrExtra.litros` | litros acreditables |
|---|:--:|:--:|:--:|
| A — cerrar el viaje sembrado (`VJ-2026-0847`) con *listo* | 15101505 (del XML del seed) | **ausente**: `seed.sql:121-123` no inserta `ocr_extra` | **0** |
| B — fotos reales por WhatsApp, que es lo que manda el guion §2 | **ausente**: una foto nunca produce `claveProdServ` | presente | **0** |
| C — foto **y** XML de la misma compra, emparejados | presente | presente | > 0 |

Solo C da un número, y C exige que el operador mande las dos cosas por el mismo
ticket. El `Cantidad="113.00"` que el propio XML del seed trae
(`seed.sql:135`) no se lee nunca: `grep -n "Cantidad" src/lib/cuadra/intake/`
no devuelve nada. Las tres liquidaciones del historial
(`seed.sql:145-148`) tampoco aportan: se insertan sin las cuatro columnas de
acreditables, que son `not null default 0` (`0007_acreditamiento.sql:9-11`,
`0021_liquidacion_litros_diesel.sql:13`).

Y las dos pantallas del panel no se ponen de acuerdo sobre qué hacer con ese
cero: `src/app/dashboard/[id]/page.tsx:138` **oculta** la tarjeta cuando
`d.litrosDiesel > 0` es falso; `src/app/dashboard/page.tsx:138` la imprime
igual, en el tamaño más grande de la página, con el pie *"LIF 2026, Art. 20-A —
su contador aplica la cuota semanal vigente"*.

**Consecuencia.** Minuto 5 del guion. Javier proyecta `/dashboard` y lee lo que
`GUION_DEMO.md:117-119` le indica decir: *"lo que le entregamos es el dato duro:
cuántos litros son elegibles, ya filtrados por los que sí traen complemento de
hidrocarburos. Él multiplica."* La pantalla dice `0 L`, en verde acento, arriba
del todo. El contralor multiplica cero. La única lectura disponible en la sala
es "su sistema no encontró nada", y es peor que no enseñar la tarjeta, porque la
tarjeta afirma haber medido.

**Causa raíz probable.** El dato que decide (`litros`) y el dato que habilita
(`claveProdServ`) entran por dos puertas distintas y ninguna las junta; el panel
no distingue "cero litros elegibles" de "nunca se midieron litros", así que pinta
la segunda como si fuera la primera.

**Intento de refutación.** ¿Lo cubre `guion_demo.test.ts`? No: fija que el panel
enseñe la **unidad** en litros (`PANEL` contiene `unidad="litros"` y
`litrosDiesel`) y que el guion no vuelva a prometer pesos. Ninguna assert toca el
valor. ¿Lo cubre el estado vacío? Tampoco: `estadoPanel` devuelve `'datos'`
porque `kpis.viajesLiquidados` es 3 (`estado.ts:37`), así que el camino de
"vacío" ni se roza. ¿Se arregla resembrando? No por sí solo: la ruta B —fotos
reales, la que el guion elige— da 0 con cualquier seed.

---

### [ALTO] El simulador `/demo` afirma "CFDI validado por QR ✅" y dos burbujas después se desdice: "el receptor no se pudo leer del comprobante"

`src/app/demo/page.tsx:38` (la burbuja se arma con `c.cfdiUuid ? ' (CFDI
validado por QR ✅)' : ''`) · `src/app/demo/page.tsx:16` (el preset
`Factura CFDI $1,200` lleva `cfdiUuid`) · `src/app/api/demo/route.ts:33-40` (el
gasto se construye sin `rfcReceptor`, sin `estadoSat` y sin `xmlVerificado`) ·
`src/lib/cuadra/cuadre/engine.ts:374-380` (`cfdiUuid && !rfcReceptor` →
`rfc_receptor_no_verificable`) · `src/app/demo/page.tsx:59-62` (las notas se
imprimen crudas bajo *"Ojo con esto:"*).

**Escenario, medido** (los cuatro presets del simulador, anticipo $10,600, la
política real de `api/demo/route.ts:19-27`, corrido con `tsx` sobre el motor):

```
estatus con_diferencias | comprobado 10600 | dif 0
- sobre_politica              | Combustible de $4,200.00 excede el tope de política ($4,000.00) por $200.00.
- rfc_receptor_no_verificable | No se puede verificar a nombre de quién está la factura de Factura:
                                el receptor no se pudo leer del comprobante. Queda a revisión —
                                reenvía el XML o una foto más clara del QR.
```

Se aprieta el botón *Factura CFDI $1,200*: la app contesta **"Recibí tu factura
de $1,200.00 (CFDI validado por QR ✅)"**. Se aprieta *cerrar*: la misma app, en
la misma conversación, dice **"reenvía… una foto más clara del QR"** sobre ese
mismo comprobante. La palomita verde no corresponde a ninguna validación: es una
cadena literal que se dispara solo porque el preset trae el campo `cfdiUuid`.
De paso, el renglón se lee *"la factura de Factura"* (el concepto `factura`
etiquetado con el mapa `CONCEPTO`).

**Consecuencia.** `/demo` es el Plan B que `GUION_DEMO.md:35` manda tener abierto
en otra pestaña, y es el que se usa exactamente cuando Meta falla — es decir, en
el peor momento posible para que el producto se contradiga solo. El contralor ve
una palomita verde de validación seguida del sistema admitiendo que no leyó el
comprobante. Cualquiera de las dos frases por separado está bien; juntas dicen
que la palomita no significa nada.

**Causa raíz probable.** La burbuja de acuse la escribe el cliente a partir del
preset, y el veredicto lo escribe el motor a partir del payload —que no lleva los
campos que la burbuja está afirmando.

---

### [MEDIO] La nota del permiso CRE sale rota en las dos ramas: "El CFDI de Combustible **de combustible**:" y "2 CFDI de combustible ($8,000.00) **de combustible**:"

`src/lib/cuadra/cuadre/engine.ts:489-494` (se arma `sujeto` y se le concatena
`de combustible:`; la rama singular ya termina en el concepto y la plural ya dice
"de combustible") · se pinta en `src/app/dashboard/[id]/page.tsx:153` (`{df.nota}`,
texto libre, sin ningún filtro) y en el chat del simulador
(`src/app/demo/page.tsx:62`).

**Escenario, medido** (mismo `tsx`, dos corridas):

- Un CFDI de diésel con XML → `El CFDI de Combustible de combustible: LISR 27-III
  y RFA 2026 regla 2.9 exigen que conste el permiso CRE vigente del proveedor…`
- Dos CFDI de diésel ($4,200 + $3,800) → `2 CFDI de combustible ($8,000.00) de
  combustible: LISR 27-III y RFA 2026 regla 2.9 exigen…`

Antes de `f25d44f` la frase era `El CFDI de ${etiqueta} **es** de combustible:
…` y cerraba bien. El refactor que agrupó el aviso en uno solo se llevó el verbo
y dejó el complemento.

**Consecuencia.** Es el renglón que el contralor lee bajo *"Diferencias
detectadas"* —y el mismo texto viaja al PDF que él le manda a su contador— justo
debajo de una cita de LISR 27-III. Una frase agramatical pegada a una cita legal
le quita autoridad a la cita: es el párrafo donde el producto está pidiendo que
le crean sobre la ley.

**Causa raíz probable.** El sujeto de la oración se volvió variable y el
predicado se quedó escrito para el sujeto viejo. Nadie compara la cadena
resultante contra nada: `permiso_cre_no_verificable.test.ts` afirma
`toMatch(/permiso CRE/i)` sobre la nota, y ese regex pasa con la frase rota.

*(No es REINCIDENTE: nace en `f25d44f`, el commit con el que la ronda 9 cerró mi
único alto.)*

---

### [MEDIO] `TonoDeducibilidad` ganó un cuarto miembro en la ronda 9 y el panel sigue conociendo dos: en pantalla, "Por confirmar" se ve idéntico a "Deducible para ISR"

`src/lib/cuadra/liquidacion/deducibilidad.ts:17` (`type TonoDeducibilidad =
'bueno' | 'malo' | 'pendiente' | 'condicionado'`, el último añadido por
`f25d44f`) contra `src/app/dashboard/[id]/page.tsx:120`
(`f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)'` — un ternario de dos
ramas para una unión de cuatro) · `src/lib/cuadra/liquidacion/pdf.ts:295`
(`bueno`→VERDE, `malo`→ROJO, `condicionado`→INK, resto→ÁMBAR).

**Escenario, medido.** La misma liquidación del demo ($5,600 comprobados, diésel
con XML) produce `filasDeducibilidad` = `[{label:'Deducible para ISR — sujeto a
permiso CRE vigente', monto:5600, tono:'condicionado'}]`. Con el RFC de la flota
sin capturar produce `[{label:'Por confirmar', monto:5600, tono:'pendiente'}]`.
En el PDF esas dos filas salen en **dos colores distintos** (INK y ÁMBAR) y una
tercera, `bueno`, en VERDE. En el panel las tres salen en `--ink`: el mismo
carácter, el mismo peso, el mismo color. El contralor abre la pantalla y el PDF
del mismo viaje —el guion lo hace en el minuto 6— y ve dos codificaciones de
color distintas para el mismo desglose.

**Consecuencia.** La mitad visible del arreglo de la ronda 9 no aterrizó en la
pantalla: el commit `f25d44f` dice que "el renglón sale con tono `condicionado`
… la afirmación que el motor no sostiene entera va junto al número", y en el
panel ese tono no existe. Lo único que distingue esos estados en pantalla es el
texto de la etiqueta. Y "Por confirmar" —dinero que todavía se puede perder— se
lee con la misma tinta que "Deducible para ISR".

**Causa raíz probable.** El tono nuevo se añadió al tipo y al PDF; el panel es la
única superficie sin prueba y no se actualizó. El comentario que justifica la
tinta plana (`[id]/page.tsx:104-106`: *"`--color-ok` mide 2.22:1 sobre blanco"*)
está **vencido**: `globals.css:30` cambió `--color-ok` a `#14602c`, que mide
7.67:1 sobre blanco y lo verifica `contraste.test.ts:63-67`.

*(Este es el resultado del cotejo obligatorio mapa-por-mapa. Los tres mapas
literales del panel están completos; el desajuste con `src/types/` está aquí, en
la unión que el arreglo de la ronda 9 amplió.)*

---

### [MEDIO] "Pendiente de capturar" se pinta con `--color-warn`: 1.99:1 sobre el fondo del documento, y la prueba de contraste no mide ese token

`src/app/aviso/[tenant]/page.tsx:119` (`text-xs font-medium`, `color:
var(--color-warn)`) · `src/app/globals.css:31` (`--color-warn: #ff9f0a`, sin
override para modo claro ni oscuro) · `src/app/dashboard/contraste.test.ts:59-111`
(mide `--color-ok` y `--color-bad`; su encabezado dice medir "los tres tokens con
significado", y son dos).

**Escenario, medido con la fórmula de luminancia de WCAG 2.1** (la misma que usa
`contraste.test.ts:25-35`): `#ff9f0a` sobre `#ffffff` = **2.06:1**; sobre
`#fbfbfd`, que es el fondo real de esa página, = **1.99:1**. AA pide 4.5:1 para
texto normal y 3:1 hasta para texto grande; esto es `text-xs`. En modo oscuro el
mismo token da 8.76:1, así que el defecto solo existe de día.

Y se dispara con los datos de hoy: `getDatosResponsable` (`repo.ts:550-576`) trae
`contacto_privacidad`, `privacidad.ts:570` marca la sección como
`pendiente: !contacto`, y ninguna migración ni el seed escriben esa columna
(`0034_tenant_contacto_privacidad.sql:19` la crea y nadie la llena). El tenant del
demo entra por esa rama.

**Consecuencia.** El operador abre su aviso de privacidad desde WhatsApp, en el
celular, a plena luz —el escenario que el propio archivo describe en su
encabezado— y el único señalamiento del documento, el que le avisa que la flota
no capturó a quién reclamarle sus derechos ARCO, es el texto menos legible de la
página. Es un documento con obligación legal de ser comprensible.

**Causa raíz probable.** `--color-warn` nació como color de punto de estatus
(fondo, no tinta) y se reusó como tinta en otra página; el guardarraíl que
existía para exactamente esto se escribió sobre una lista de tokens que no
incluyó el tercero.

---

### [MEDIO] "Por confirmar" explica siempre la misma causa, y con el RFC de la flota inservible manda al contralor a perseguir facturas que ya existen

`src/lib/cuadra/liquidacion/deducibilidad.ts:74-80` (el `pie` es una constante:
*"Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar."*) ·
`src/lib/cuadra/cuadre/engine.ts:86` (`POR_CONFIRMAR` tiene DOS miembros:
`combustible_efectivo` y `rfc_receptor_no_verificable`) · se pinta en
`src/app/dashboard/[id]/page.tsx:117`.

**Escenario, medido.** Con `tenant.rfc = 'TIN010101AAA'` —el valor que
`supabase/seed.sql:26` sigue teniendo hoy, y que **falla el dígito verificador**
(`rfcChecksumOk('TIN010101AAA') === false`, comprobado)— la misma liquidación del
demo devuelve `cubetas: 0 / 0 / 5600`, y el panel imprime una sola fila:

```
Por confirmar                                              $5,600.00
Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar.
```

Los dos CFDI **están timbrados** (UUID, `estado_sat = vigente`) y **están pagados
por transferencia** (`forma_pago = 03`). Las dos cosas que el pie le pide hacer ya
están hechas. La causa real —"el RFC de la flota está mal capturado"— aparece dos
secciones más abajo, en las diferencias.

**Consecuencia.** El contralor lee la cifra grande y su explicación, en ese
orden, y sale a pedirle al operador facturas que ya tiene. `docs/HANDOFF.md:307-311`
dice que el RFC ya se corrigió en el proyecto real (`GMX0902279I1`), así que en la
sala del 6-ago probablemente no se vea; pero cualquiera que aplique `seed.sql`
—entorno local, proyecto nuevo, resiembra antes del demo— reproduce lo de arriba,
y la ruta del combustible en efectivo mantiene el pie a medias en producción.

**Causa raíz probable.** Un renglón con dos causas posibles y un solo pie escrito
para una de ellas; la fila no recibe las diferencias que la explican aunque
`filasDeducibilidad` ya las tiene en la mano (`deducibilidad.ts:44`).

---

### [BAJO] La tabla de dinero del panel no marca sus encabezados; la del detalle sí

`src/app/dashboard/page.tsx:214-218` (cinco `<th>` sin `scope="col"`) contra
`src/app/dashboard/[id]/page.tsx:185-187` y `:202` (`scope="col"` y `scope="row"`,
puestos ahí por el BAJO 2 de la auditoría 5).

**Escenario.** Un lector de pantalla recorre la tabla principal —Folio, Fecha,
Comprobado, Diferencia, Estatus— y anuncia las celdas sin su encabezado: "$1,500.00,
a favor de la empresa" sin decir de qué columna. En la tabla del detalle, tres
pantallas después, sí lo dice. El arreglo de la ronda 5 se aplicó a una de las dos
tablas.

**Consecuencia.** Es deuda, no demo: nadie va a usar un lector de pantalla el 6 de
agosto. Cobra factura el día que un cliente lo pida por accesibilidad, y cuesta
más porque la inconsistencia entre las dos tablas hace pensar que ya estaba hecho.

---

## Lo que revisé y está bien

**El ALTO de la ronda 9 cerró de verdad, y lo verifiqué ejecutando, no leyendo el
commit.** `src/lib/cuadra/cuadre/engine.ts:1029`: la lista `REVISAR` ya no incluye
`permiso_cre_no_verificable`. Corrí `cuadrarViaje` con el gasto exacto de
`seed.sql:121-129` (diésel $4,200 con XML, complemento, IEPS/IVA desglosados) más
la caseta, con la política del demo y `hidrocarburos`/`estimulos` de `config.ts`:
`estatus: con_diferencias`. Ámbar, no rojo. La causa raíz también quedó cerrada —
no se silenció el síntoma: el aviso se sigue emitiendo (`engine.ts:487-496`),
simplemente dejó de tener prioridad sobre `hayDif`. **No es REINCIDENTE.**

**El cotejo obligatorio mapa por mapa contra `src/types/cuadra.ts`.** Enumeré
todos los mapas literales y uniones consumidas en `src/app/`:

| Mapa / unión | Dónde | Contra | Resultado |
|---|---|---|---|
| `ESTATUS` (3 claves) | `dashboard/page.tsx:14-18` | `EstatusLiquidacion`, `types/cuadra.ts:106` | 3/3 · fallback en `:223` |
| `ESTATUS` (3 claves) | `dashboard/[id]/page.tsx:25-29` | `EstatusLiquidacion`, `types/cuadra.ts:106` | 3/3 · fallback en `:39` |
| `CONCEPTO` (9 claves) | `dashboard/[id]/page.tsx:20-24` | `ConceptoGasto`, `types/cuadra.ts:20-25` | 9/9 |
| `EstadoPanel` (4 arms) | `dashboard/estado.ts:23-27` | consumido en `page.tsx:89,99,116,129` | 4/4 pintados |
| `TipoDiferencia` (37) | — | `types/cuadra.ts:62-93` | **no hay mapa**: se pinta `nota` libre (`[id]/page.tsx:153`) |
| `TonoDeducibilidad` (4) | `[id]/page.tsx:120` | `deducibilidad.ts:17` | **2/4** → MEDIO de arriba |

Sobre `permiso_cre_no_verificable` (`types/cuadra.ts:93`) en concreto: no necesita
entrada en ningún mapa del panel, y lo confirmé — las diferencias se pintan por
`nota` y el simulador solo filtra `tipo !== 'anticipo'` (`demo/page.tsx:59`). El
precio de no tener mapa es que nada revisa el texto que llega a pantalla, que es
por dónde entró el MEDIO de la frase rota.

**Los cuatro estados del panel están pintados a propósito, y el peor de todos
—el parcial— también.** `estado.ts:29-39` distingue `error` / `parcial` / `vacio`
/ `datos`, y `page.tsx:116-127` pinta el aviso de carga incompleta arriba de las
cifras, no en gris al pie. `estado.test.ts` (6/6) fija la combinación traicionera
(KPIs en cero legítimo + listado caído → `parcial`, no `vacio`). Cada sección
tiene además su propio fallback (`page.tsx:135, 152, 208`).

**El formateo sigue siendo uno solo.** `formato.ts:27` reexporta de
`src/lib/formato.ts` y `formato.test.ts` (7/7) sigue fallando si aparece un
`toLocaleString('es-MX')` fuera de ahí. `grep -rn "round2" src/app/` no devuelve
nada: el bug de redondeo del motor no le llega al panel. El signo de la diferencia
va pegado a la cifra en las dos pantallas (`page.tsx:253-263`,
`[id]/page.tsx:93-97`) y dicen lo mismo.

**Las llaves de React de las filas de dinero son estables.** `key={l.id}`
(`page.tsx:235`). Las de índice que quedan (`[id]/page.tsx:151,191`;
`page.tsx:173`) están en Server Components sin reordenamiento ni estado local: no
hay un camino por el que barajen filas. Y el orden de los comprobantes se fija
explícitamente en `analytics.ts:400-402` para que las dos rutas pinten la misma
tabla.

**El desglose se calla antes que contradecirse.** Verifiqué los tres portones:
`filasDeducibilidad` devuelve `null` si las cubetas no suman el total
(`deducibilidad.ts:54-55`), `reconstruir` descarta si el total reconstruido no
cuadra con el persistido (`analytics.ts:355`), y `derivoLaConfig`
(`analytics.ts:437-462`) sigue comparando `tipo` **y** `esperado` — el CRÍTICO de
la ronda 8 no se desandó.

**La foto del ticket sigue sin llegar a pantalla.** `imagenUrl` viaja en el tipo
(`analytics.ts:207`) y `[id]/page.tsx` no lo referencia ni una vez;
`foto_no_expuesta.test.ts` (2/2) lo fija. El CRÍTICO legal de la ronda 9 aguanta.

**Los estados de error y de carga están hechos con intención.** `error.tsx:66-70`
y `global-error.tsx:72-80` pintan el `digest` seleccionable y lo registran;
`global-error.tsx` no depende de `globals.css`; `not-found.tsx` sustituye el 404
crudo; los dos esqueletos (`loading.tsx`) siguen el andamio real de su página.
Ningún camino manda un error de servidor crudo a pantalla: `api/export/liquidaciones/route.ts:37-40`
devuelve texto humano y deja el detalle en el log.

**Contraste de los dos tokens que sí se miden.** `contraste.test.ts` (7/7):
`--color-ok` 7.67:1 y `--color-bad` 5.38:1 en claro, ambos ≥4.5:1 en oscuro, y
`@theme` coincide con `[data-theme="light"]`. Recalculé `--muted` (#6b7280 sobre
blanco = 4.83:1) y `--accent` como tinta (#0e7c66 sobre blanco = 5.13:1; #2dd4bf
sobre #16161c = 9.68:1): pasan. El único que reprueba es `--color-warn`, arriba.

**El `<meta viewport>` sigue puesto** (`layout.tsx:17`) y las dos tablas van en
`overflow-x-auto`.

**Compuerta.** `npx vitest run src/app` → 8 archivos, 50/50 verdes.

## Lo que NO alcancé a revisar

- **Cuarta ronda seguida sin renderizar nada en un navegador.** Todo lo de arriba
  es lectura de código, `npx tsx` sobre el motor y `vitest` dirigido. No vi con los
  ojos el `0 L` proyectado, ni el reflow del panel en la resolución del proyector,
  ni el aviso a 430 px. El hallazgo crítico está medido en el dato, no en el píxel.
- **No tengo acceso al proyecto real de Supabase** (`gngoqsvrxdguxvsizpbw`). No pude
  confirmar si `tenant.rfc` ya es `GMX0902279I1` como dice `HANDOFF.md:307`, ni si
  alguna liquidación ya cerrada tiene litros distintos de cero. Todo lo que digo del
  estado de los datos sale de `seed.sql` y de las migraciones.
- **No medí tamaño de toque en tableta.** La fila de la tabla es el blanco completo
  gracias al pseudo-elemento estirado (`page.tsx:238`), pero los botones de
  `/demo` (`px-3 py-1.5`, ~30 px de alto) y los enlaces "Exportar CSV" /
  "Descargar PDF" (`py-2`, ~36 px) quedan por debajo de los 44 px recomendados. No
  lo reporto porque no lo verifiqué renderizado.
- **No audité `/privacidad` ni `/aviso/[tenant]` a fondo** — solo el camino del
  contraste. El contenido legal es de otro rubro.
- **No revisé `design-system/`** (no existe en el árbol de hoy) ni el resto de
  `globals.css` más allá de los tokens de color.
- **No perseguí las otras 35 claves de `TipoDiferencia`** buscando textos rotos
  como el del permiso CRE. Encontré ese porque lo produce el arreglo que venía a
  verificar; las notas se arman con plantillas en `engine.ts` y ninguna prueba
  compara la cadena completa, así que puede haber más.
- **El export CSV entrega el estatus crudo** (`export.ts:73`: `con_diferencias`,
  no "Con diferencias"), a diferencia de las dos pantallas. El archivo declara
  ser para Excel y no para una persona (`export.ts:25-27`), así que lo dejo
  anotado y no como hallazgo: no verifiqué si alguien lo abre en la sala.
