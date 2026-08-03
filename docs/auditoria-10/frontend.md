# Frontend — auditoría 10 (continuación 3-ago)

**Nota: 6/10** (antes 5). Razón del movimiento: *se atacó y subió* — pero a
medias, y por eso no sube más.

Lo que justifica el punto: el CRÍTICO del 2-ago **cerró de verdad**
(`src/app/dashboard/acred.tsx`), y cerró con la primera prueba que este rubro ha
tenido que **ejecuta** un componente en vez de leer su texto fuente
(`acred_sin_litros.test.tsx`, `renderToStaticMarkup`). Y los 39 archivos nuevos
de `/admin` —la mayor superficie que ha entrado de golpe— resultaron ser
**estados vacíos honestos**, no UI de escaparate con cifras inventadas: abrí las
26 páginas y ninguna presume un dato que no tiene.

Lo que lo frena: el arreglo **aterrizó en una de las tres tarjetas**. Las otras
dos siguen imprimiendo `$0.00` en `text-5xl` afirmando una medición que el motor
nunca hizo, y la propia prueba del arreglo fija por escrito la premisa
equivocada. Además, de los cinco hallazgos que dejé el 2-ago, **cuatro siguen
exactamente donde los dejé** y uno empeoró (se quitó el modo oscuro que lo
tapaba).

El riesgo mayor del rubro, hoy: la fila destacada del panel —la que el guion
manda narrar en el minuto 5— distingue "no medí" de "cero" **solo en la tarjeta
de litros**; en las dos de pesos sigue pintando "no lo pude medir" como si fuera
"medí y dio cero", y hoy lo único que impide que el contralor lo vea el 6-ago es
que el `seed.sql` trae XML.

---

## Hallazgos

### [ALTO] El arreglo del CRÍTICO cubrió una de las tres tarjetas: "IVA acreditable $0.00" y "Peaje (50%) $0.00" siguen afirmando una medición que nunca ocurrió

`src/app/dashboard/acred.tsx:56` (`const sinMedicion = unidad === 'litros' && !(valor > 0)`
— la regla nueva está **condicionada a la unidad**) · `acred.tsx:57` (la rama de
pesos cae directo en `mxn(valor)`) · `src/app/dashboard/page.tsx:160-161` (las
dos tarjetas de pesos, mismo `text-4xl md:text-5xl` de la de litros) ·
`src/lib/cuadra/cuadre/engine.ts:898` · `src/app/dashboard/[id]/page.tsx:64,169`
· `src/app/dashboard/acred_sin_litros.test.tsx:68-74`.

**Escenario, medido sobre el motor** (`npx tsx` sobre `cuadrarViaje`, sin mocks).
`engine.ts:898` es un `continue` que descarta el gasto **antes** de mirar
`ivaTraslado` o `subTotal`:

```
if (!g.xmlVerificado) continue;
...
if ((g.ivaTraslado ?? 0) > 0) ivaAcreditable += ...      // línea 916
if (g.concepto === 'caseta' && ...) peajeAcreditable += ... // línea 918
```

Entra: una flota cuyos operadores mandan **fotos** por WhatsApp —el flujo que el
producto vende y el que `GUION_DEMO.md:60-62` describe: *"Mandas fotos de tickets
reales (diésel, caseta, una comida)"*—. Una foto nunca produce `xmlVerificado`.
Sale: `iva = 0`, `peaje = 0`, `litros = 0`. El panel imprime:

| Tarjeta | Lo que pinta hoy | Pie |
|---|---|---|
| Diésel elegible | `—` + "Sin litros medidos en el periodo" | **arreglado** |
| IVA acreditable | **`$0.00`** en `text-5xl` | "LIVA, Art. 5 — CFDI con IVA desglosado" |
| Peaje (50%) | **`$0.00`** en `text-5xl` | "Estímulo de autopistas · LIF 2026, Art. 20-A" |

Ese `$0.00` **no significa** "no hubo IVA que acreditar": un CFDI de diésel de
$4,200 traslada ~$581 de IVA (lo trae el propio XML del seed,
`seed.sql:129`: `iva_traslado=581.38`). Significa "no llegó ningún XML, así que
no se pudo medir". Es literalmente el mismo defecto que el CRÍTICO describía para
los litros, migrado dos tarjetas a la derecha. Y las dos pantallas siguen sin
ponerse de acuerdo: `[id]/page.tsx:64` calcula `hayAcred` y `:169` **oculta la
sección entera** cuando las cuatro cifras son cero; `page.tsx:160-161` las
imprime igual, en el tamaño más grande de la página.

**Intento de refutación — y aquí está lo grave.** El guardarraíl existe y dice lo
contrario. `acred_sin_litros.test.tsx:68-74`:

```
it('control: las tarjetas en pesos no se tocan — un IVA de $0 sigue siendo $0', () => {
  expect(html, 'cero pesos acreditables SÍ es una medición: no hubo IVA que acreditar').toContain('$0');
```

Esa premisa es falsa por `engine.ts:898`. La prueba no es un descuido: es una
decisión escrita, fijada con un mensaje de assert, que impide que el arreglo se
complete sin borrarla.

**Segunda refutación — ¿lo salva el demo del 6-ago?** Sí, por accidente y no por
código. Los dos gastos sembrados de `VJ-2026-0847` traen `xml_verificado = true`
(`supabase/seed.sql:122-129`), así que al cerrar el viaje en la sala el panel
suma `iva = $774.48` y `peaje = $603.45`. Lo que protege la demo es el seed, no
la pantalla: cualquier tenant nuevo, cualquier resiembra sin esos dos gastos, y
el primer cliente real que solo mande fotos, reproducen los dos ceros. Por eso es
ALTO y no CRÍTICO.

**Consecuencia.** El contralor lee `$0.00` bajo "IVA acreditable" con una cita de
LIVA art. 5 debajo, y la única lectura disponible es "mi flota no tiene IVA que
acreditar" — que es una conclusión de dinero, y es falsa. Peor: es la conclusión
opuesta a la que el producto existe para vender.

**Causa raíz probable.** La regla "no afirmes una medición que no hiciste" se
implementó como una propiedad de la **unidad** (`unidad === 'litros'`) en vez de
como una propiedad del **dato** (¿hubo algo que medir?).

---

### [ALTO · REINCIDENTE] FE-2 — el simulador `/demo` afirma "CFDI validado por QR ✅" y dos burbujas después se desdice: "el receptor no se pudo leer del comprobante"

`src/app/demo/page.tsx:38` (`${c.cfdiUuid ? ' (CFDI validado por QR ✅)' : ''}`)
· `demo/page.tsx:16` (el preset `Factura CFDI $1,200` trae `cfdiUuid`) ·
`src/app/api/demo/route.ts:33-40` (el gasto se arma sin `rfcReceptor`, sin
`estadoSat`, sin `xmlVerificado`) · `demo/page.tsx:59-62` (las notas se imprimen
crudas bajo *"Ojo con esto:"*).

**Escenario, re-medido hoy** (los cuatro presets, anticipo $10,600, la política
real de `api/demo/route.ts:19-27`, `npx tsx` sobre el motor):

```
estatus con_diferencias | comprobado 10600 | dif 0
 - sobre_politica              | Combustible de $4,200.00 excede el tope de política ($4,000.00) por $200.00.
 - rfc_receptor_no_verificable | No se puede verificar a nombre de quién está la factura de Factura:
                                 el receptor no se pudo leer del comprobante. Queda a revisión —
                                 reenvía el XML o una foto más clara del QR.
```

Se aprieta *Factura CFDI $1,200* → **"Recibí tu factura de $1,200.00 (CFDI
validado por QR ✅)"**. Se aprieta *cerrar* → **"reenvía… una foto más clara del
QR"**, sobre ese mismo comprobante. La palomita no corresponde a ninguna
validación: es una cadena literal que se dispara porque el preset trae el campo.

**Consecuencia.** `/demo` es el Plan B que `GUION_DEMO.md:35` manda tener abierto
en otra pestaña — el que se usa exactamente cuando Meta falla, o sea en el peor
momento posible para que el producto se contradiga solo.

**Causa raíz probable.** La burbuja de acuse la escribe el cliente a partir del
preset; el veredicto lo escribe el motor a partir de un payload que no lleva los
campos que la burbuja afirma.

*(REINCIDENTE. Verificado sin cambios desde el 2-ago; el MAPA lo declara con el
tope de 3 vueltas de arreglo agotado.)*

---

### [ALTO] El chofer que sigue el link de `/mis-viajes` acaba en el panel del contralor: el `next` del login descarta todo lo que no empiece con `/dashboard`

`src/app/login/page.tsx:49` (`sp.next.startsWith('/dashboard') ? sp.next : '/dashboard'`)
· `login/page.tsx:54` y `:70` (lo mismo dentro de los dos server actions) ·
`src/app/auth/callback/route.ts:13` (tercera copia de la misma lista blanca) ·
`src/lib/auth/guard.ts:50` (`requireOperador` manda `/login?next=%2Fmis-viajes`)
· `src/proxy.ts:44-51` (el gate también arma `next=/mis-viajes`) ·
`src/app/dashboard/page.tsx:62` (`requireSessionTenant` no mira el rol; solo
rebota a `superadmin`, en `:69`).

**Escenario, con valores.** Un chofer con `app_user.rol='operador'`,
`tenant_id` puesto y `operador_id` ligado (el alta que crea
`/admin/usuarios/nuevo`) abre `https://likida.ai/mis-viajes`:

1. `proxy.ts:47` no ve sesión → `302 /login?next=/mis-viajes`.
2. `login/page.tsx:49` lo lee, **no empieza con `/dashboard`**, y lo reescribe a
   `/dashboard`. El `emailRedirectTo` que se manda por correo ya lleva
   `next=/dashboard` (`:82`).
3. `/auth/callback:13` recibe `next=/dashboard` y redirige ahí.
4. `/dashboard` corre `requireSessionTenant('/dashboard')`, que solo comprueba
   que haya `tenantId`. El chofer lo tiene. **Se sirve el panel de la flota
   completa.**

Y lo que ve ahí no está acotado por la RLS que la migración `0045` construyó
justo para él: `analytics.ts:68,103,151,177,227` usa `supabaseAdmin()`
(service-role), que salta RLS. `getLiquidaciones` (`dashboard/page.tsx:34`)
también. El chofer ve las 20 liquidaciones más recientes de **todos** los
choferes de la flota, con folio, monto comprobado y diferencia a favor/en contra
de cada uno.

Confirmado además que **no hay salida**: `grep -rn "mis-viajes" src/` fuera de su
propio `page.tsx` devuelve solo el proxy, el guard y tres pruebas. Ni un `<Link>`
en toda la aplicación apunta a `/mis-viajes`. La única forma de llegar es teclear
la URL **después** de haber iniciado sesión.

El mismo recorte se come `/admin` (`guard.ts:64`) —ahí sí se recupera, porque
`dashboard/page.tsx:69` rebota al superadmin— y `/cuenta`
(`cuenta/page.tsx:9`), que se pierde sin recuperación.

**Consecuencia.** El panel de solo lectura del chofer, con RLS propia y una
migración dedicada, es inalcanzable por el único camino que la interfaz ofrece; y
el camino que sí funciona lo deja en la pantalla contraria, viendo el dinero de
sus compañeros. Para el equipo: se construyeron `0045_rls_operador.sql`,
`requireOperador` y una pantalla entera que hoy nadie puede alcanzar.

**Causa raíz probable.** La lista blanca del `next` se escribió cuando
`/dashboard` era el único destino autenticado, y se copió a tres archivos; al
añadir dos destinos nuevos se actualizaron los emisores del `next` y no sus tres
receptores.

*(La mitad de autorización de esto es del rubro de seguridad; lo que reporto aquí
es la navegación y el destino de pantalla, que es lo que se puede leer en
`src/app/`.)*

---

### [MEDIO · REINCIDENTE] La nota del permiso CRE sale rota en las dos ramas: "El CFDI de Combustible **de combustible**:" y "2 CFDI de combustible ($8,000.00) **de combustible**:"

`src/lib/cuadra/cuadre/engine.ts:499-503` (se arma `sujeto` y se le concatena
` de combustible:`; la rama singular ya termina en el concepto —
`etiquetaConcepto('diesel', undefined) === 'Combustible'` — y la plural ya dice
"de combustible") · se pinta en `src/app/dashboard/[id]/page.tsx:191`
(`{df.nota}`, texto libre sin filtro) y en `src/app/demo/page.tsx:62`.

**Escenario, medido hoy** (`npx tsx`, un CFDI de diésel con XML y luego dos, con
`DEMO_CONFIG.hidrocarburos`):

```
- El CFDI de Combustible de combustible: LISR 27-III y RFA 2026 regla 2.9 exigen que conste
  el permiso CRE vigente del proveedor. El sistema todavía no lo valida — …
- 2 CFDI de combustible ($8,000.00) de combustible: LISR 27-III y RFA 2026 regla 2.9 exigen …
```

**Consecuencia.** Es el renglón que el contralor lee bajo *"Diferencias
detectadas"*, y el mismo texto viaja al PDF que le manda a su contador, pegado a
una cita de LISR 27-III. Una frase agramatical junto a una cita legal le quita
autoridad a la cita, justo en el párrafo donde el producto pide que le crean
sobre la ley.

**Causa raíz probable.** El sujeto se volvió variable y el predicado se quedó
escrito para el sujeto viejo. `permiso_cre_no_verificable.test.ts` afirma
`toMatch(/permiso CRE/i)` sobre la nota, y ese regex pasa con la frase rota.

---

### [MEDIO · REINCIDENTE] `TonoDeducibilidad` tiene cuatro miembros y el panel sigue conociendo dos: en pantalla, "Por confirmar" se ve idéntico a "Deducible para ISR"

`src/lib/cuadra/liquidacion/deducibilidad.ts:17`
(`'bueno' | 'malo' | 'pendiente' | 'condicionado'`) contra
`src/app/dashboard/[id]/page.tsx:158`
(`style={{ color: f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)' }}` — un
ternario de dos ramas para una unión de cuatro) · `src/lib/cuadra/liquidacion/pdf.ts:295`
(`bueno`→VERDE, `malo`→ROJO, `condicionado`→INK, resto→ÁMBAR).

**Escenario, medido hoy.** La misma liquidación de diésel con XML devuelve

```
[{"label":"Deducible para ISR — sujeto a permiso CRE vigente","monto":5600,"tono":"condicionado", …}]
```

y con el RFC de la flota sin capturar devuelve `tono:'pendiente'`. En el PDF esas
dos filas salen en **dos colores distintos** (INK y ÁMBAR) y una tercera,
`bueno`, en VERDE. En el panel las tres salen en `--ink`: mismo color, mismo
peso. El contralor abre la pantalla y el PDF del mismo viaje —el guion lo hace en
el minuto 6— y ve dos codificaciones de color distintas para el mismo desglose.

**Consecuencia.** "Por confirmar" es dinero que todavía se puede perder y se lee
con la misma tinta que "Deducible para ISR". Lo único que los distingue en
pantalla es el texto de la etiqueta.

**Causa raíz probable.** El tono se añadió al tipo y al PDF; el panel es la
superficie sin prueba de render y no se actualizó. El comentario que justifica la
tinta plana (`[id]/page.tsx:143-144`: *"`--color-ok` mide 2.22:1 sobre blanco"*)
sigue **vencido**: `globals.css:30` es `#14602c`, 7.67:1 sobre blanco, verificado
por `contraste.test.ts:63-67`.

*(Este es el resultado del cotejo obligatorio mapa-por-mapa; el detalle completo
va abajo, en "lo que revisé y está bien".)*

---

### [MEDIO · REINCIDENTE, AGRAVADO] "Pendiente de capturar" se pinta con `--color-warn`: 1.99:1 — y ya no hay modo oscuro donde el token sí pasaba

`src/app/aviso/[tenant]/page.tsx:119` (`text-xs font-medium`,
`color: var(--color-warn)`) · `src/app/globals.css:31` (`--color-warn: #ff9f0a`,
**sin override en ninguno de los dos bloques `[data-theme]`**) ·
`src/app/dashboard/contraste.test.ts:59-111` (mide `--color-ok` y `--color-bad`;
su encabezado dice medir "los tres tokens con significado", y son dos).

**Escenario, con la fórmula de luminancia WCAG 2.1 — la misma de
`contraste.test.ts:25-35`:** `#ff9f0a` sobre `#ffffff` = **2.06:1**; sobre
`#fbfbfd`, el fondo real de esa página, = **1.99:1**. AA pide 4.5:1 para texto
normal y 3:1 hasta para texto grande; esto es `text-xs`.

**Qué cambió desde el 2-ago, y por qué empeoró.** Entonces escribí que el defecto
"solo existe de día", porque el mismo token daba 8.76:1 en oscuro. Ese bloque
`@media (prefers-color-scheme: dark)` **se eliminó** (`globals.css:53-59`, y la
prueba que lo medía se retiró con él, `contraste.test.ts:103-110`). Hoy no hay
modo oscuro automático ni switch manual: `[data-theme]` no se pone en ningún
lado. El modo claro es el único que existe, así que el defecto pasó de ser el
peor caso a ser **el único caso**.

Y se dispara con los datos de hoy: `privacidad.ts` marca la sección como
`pendiente: !contacto`, y ninguna migración ni el seed llenan
`tenant.contacto_privacidad` (`0034_tenant_contacto_privacidad.sql` la crea y
nadie la escribe).

**Consecuencia.** El operador abre su aviso de privacidad desde WhatsApp, en el
celular, a plena luz, y el único señalamiento del documento —el que le avisa que
la flota no capturó a quién reclamarle sus derechos ARCO— es el texto menos
legible de la página. Es un documento con obligación legal de ser comprensible.

**Causa raíz probable.** El token nació como color de punto de estatus (fondo) y
se reusó como tinta; la prueba que existía para exactamente esto se escribió
sobre una lista de tokens que no incluyó el tercero.

---

### [MEDIO] Dar de alta un usuario en `/admin` no acusa recibo ni error: los dos parámetros que el server action escribe en la URL no los lee nadie

`src/app/admin/usuarios/nuevo/page.tsx:33` (`redirect('/admin/usuarios/nuevo?error=1')`)
· `:35` (`redirect('/admin?creado=1')`) · `:22`
(`export default async function NuevoUsuario()` — **no recibe `searchParams`**) ·
`src/app/admin/page.tsx:100` (`export default async function Admin()` — tampoco).

**Escenario, con valores.** Javier abre `/admin/usuarios/nuevo`, elige
"Transportes Innovativos", teclea `contralor@innovativos.mx`, rol "Contador", y
aprieta *Crear usuario*. Sale bien → aterriza en `/admin?creado=1`, una pantalla
**idéntica** a la de antes: ningún toast, ninguna fila nueva visible (el roster
vive en `/admin/equipo`, otra página). No hay forma de saber si se creó.

Y en el camino de error es peor: `provisionarUsuario`
(`src/lib/auth/provisionar.ts:26`) hace `throw new Error(...)` cuando
`admin.auth.admin.createUser` falla — el caso normal es **correo repetido**. Ese
throw sale del server action, y bajo `/admin` **no hay `error.tsx` en ningún
segmento**: `find src/app -name error.tsx` devuelve solo
`src/app/dashboard/error.tsx`. El error sube hasta `global-error.tsx`, que
reemplaza la página entera por "Código del incidente: 8f3c…". Teclear dos veces
el mismo correo tira toda la consola a una pantalla de incidente.

**Consecuencia.** La única tarea de escritura real de `/admin` —la que sustituye
al script `scripts/tmp-provisionar-*.ts`, según su propio comentario— no confirma
el éxito y convierte el error más probable en una pantalla de fallo genérico.
Quien la use va a crear el mismo usuario dos veces para asegurarse.

**Causa raíz probable.** El server action se escribió con el patrón
"redirect con query param" y nunca se escribió la mitad que lo lee.

---

### [MEDIO] `/mis-viajes` imprime "$0.00 comprobado" para el viaje que el chofer tiene abierto y al que ya le mandó comprobantes

`src/app/mis-viajes/page.tsx:38` (`comprobado: Number(liq?.total_comprobado ?? 0)`)
· `:85` (`{mxn(v.comprobado)}`) · `:93` (la columna de estatus sí sabe decir
"Sin liquidar") · `:26-29` (el `select` sobre `viaje` **no filtra por estatus**).

**Escenario, con los datos del demo.** `VJ-2026-0847` está `'abierto'`
(`seed.sql:116`) y ya tiene $5,600 en `gasto` (`seed.sql:123-129`), pero todavía
no existe su fila en `liquidacion`. El chofer entra a su panel y ve:

```
VJ-2026-0847   03 ago 2026   $0.00   Sin liquidar
```

La columna "Comprobado" —dinero— afirma cero para un viaje donde ya mandó $5,600
en fotos. La columna de estatus sabe distinguir "no hay liquidación" y pinta
"Sin liquidar"; la de dinero, tres celdas a la izquierda, no: colapsa `null` a
`0` y lo formatea como una cifra medida.

**Consecuencia.** El chofer que revisa si su envío llegó lee "$0.00" y concluye
que se perdió: reenvía las catorce fotos. Cada reenvío es otra pasada de OCR
—costo real— y el motor las trata como duplicados que hay que explicar después en
la liquidación. Es el mismo par "ausencia pintada como cero" del ALTO de arriba,
en la otra pantalla nueva.

**Causa raíz probable.** El `?? 0` del mapeo decide antes que la pantalla; el
componente ya distingue los dos casos para el estatus y no recibió la misma
distinción para el monto.

---

### [MEDIO] El simulador `/demo` llama al mismo gasto de dos formas en la misma conversación: "Recibí tu **diesel**" y, dos burbujas después, "**Combustible** de $4,200.00"

`src/app/demo/page.tsx:38` (`Recibí tu ${c.concepto} de ${mxn(c.monto)}` — pinta
la **clave cruda** de `ConceptoGasto`) · `src/types/cuadra.ts:20-25` (las nueve
claves: `diesel`, `caseta`, `factura`, …) · `demo/page.tsx:62` (dos burbujas
después imprime la nota del motor, que usa `etiquetaConcepto`) ·
`src/lib/cuadra/cuadre/engine.ts` (`etiquetaConcepto('diesel', undefined) === 'Combustible'`,
verificado ejecutando).

**Escenario, medido.** Botón *Diésel $4,200 (sobre tope)*:

```
Recibí tu diesel de $4,200.00. ¿Tienes más o ya cerramos?      ← burbuja 2
…
Ojo con esto:
• Combustible de $4,200.00 excede el tope de política…          ← burbuja 6
```

`diesel` sin acento y en minúscula es la clave del `union`, no una etiqueta:
`/demo` es la **única** superficie del producto sin mapa de conceptos. El panel
de detalle tiene el suyo (`[id]/page.tsx:20-24`, 9/9) y además delega en el motor
(`:283-286`); el PDF delega en el motor; `/demo` no hace ninguna de las dos. El
renglón `la factura de Factura` del hallazgo FE-2 es el mismo defecto por el otro
lado.

**Consecuencia.** El Plan B del demo es donde el contralor ve el producto sin
red. Dos nombres para el mismo gasto en la misma pantalla se leen como dos
sistemas, y "diesel" en crudo se lee como un campo de base de datos que se
escapó a la interfaz.

**Causa raíz probable.** El simulador se escribió antes que `etiquetaConcepto` y
nunca se enganchó; `etiquetas_panel.test.ts` fija la regla para el panel y el
PDF, y no mira `/demo`.

---

### [MEDIO] `/admin` Inicio reserva 292 px para un panel que está oculto: por debajo de 1280 px la consola deja una columna muerta

`src/app/admin/asistente-expandible.tsx:32`
(`width: expandido ? 0 : `calc(100% - ${ANCHO_ASIDE + 16}px)``, con
`ANCHO_ASIDE = 276` en `:8` — es decir `calc(100% - 292px)`, **sin condición de
breakpoint**) · `:43` (el `<aside>` que ocuparía esos 292 px es
`hidden xl:flex`) · `src/app/admin/layout.tsx:95` (la columna de contenido).

**Escenario.** Se abre `/admin` en una ventana de 1200 px de ancho (o un
proyector de 1152×864, o el navegador sin maximizar en un portátil de 1366). El
breakpoint `xl` de Tailwind es `min-width: 1280px`, así que el `<aside>` pasa a
`display:none` — pero el `<div>` de la izquierda **sigue** midiendo
`calc(100% - 292px)`. Resultado: el contenido de Inicio (saludo, contador de MRR,
gráfica de barras, tablas) se encoge a ~68% del ancho disponible y queda un hueco
de 292 px a la derecha, con el fondo difuminado a la vista y nada encima.
También desaparece sin sustituto el bloque "Smart Insight" y los cuatro accesos
rápidos, que solo viven dentro de ese `aside` (`admin/page.tsx:351-387`).

**Consecuencia.** Es la pantalla que el equipo usa a diario, no la del contralor,
y por eso es MEDIO y no más. Cobra factura el día que alguien enseñe la consola
en una laptop que no sea la de siempre.

**Causa raíz probable.** El ancho del hermano se calculó a mano en línea en vez
de dejarlo al flexbox (`flex-1`), y el `hidden xl:` se añadió después solo al
elemento que se oculta.

---

### [BAJO · REINCIDENTE, EXTENDIDO] Dos de las tres tablas de dinero no marcan sus encabezados; la tercera sí

`src/app/dashboard/page.tsx:236-240` (cinco `<th>` sin `scope="col"`) ·
`src/app/mis-viajes/page.tsx:72-75` (cuatro `<th>` sin `scope`, tabla nueva de
esta ronda) · contra `src/app/dashboard/[id]/page.tsx:223-225` y `:240`
(`scope="col"` y `scope="row"`, puestos por el BAJO 2 de la auditoría 5).

**Escenario.** Un lector de pantalla recorre la tabla principal —Folio, Fecha,
Comprobado, Diferencia, Estatus— y anuncia "$1,500.00, a favor de la empresa" sin
decir de qué columna. Tres pantallas después, en el detalle, sí lo dice. La tabla
nueva del chofer nació con el mismo hueco.

**Consecuencia.** No es del demo: nadie va a usar un lector de pantalla el 6 de
agosto. Cobra factura el día que un cliente lo pida, y cuesta más porque la
inconsistencia entre las tres tablas hace pensar que ya estaba hecho.

---

### [BAJO] El guardarraíl que impide una segunda copia del formato tiene un hueco, y una página nueva ya se coló por él

`src/lib/formato.test.ts:122-135` (el grep es literal:
`grep -rl "toLocaleString('es-MX'" src/`) · `src/app/admin/page.tsx:22`
(`new Date().toLocaleDateString('es-MX', { weekday:'long', … })`) ·
`src/app/dashboard/formato.ts:22-24` (el comentario que afirma que la prueba
"busca `toLocaleString('es-MX')` en todo `src/`").

**Escenario.** `toLocaleDateString` no contiene la subcadena `toLocaleString`, así
que el grep no lo ve. `admin/page.tsx:22` formatea fechas por su cuenta y la
compuerta pasa en verde. Hoy el daño es cosmético —el saludo de `/admin` dice
"lunes, 3 de agosto de 2026" y `fechaMx` dice "03 ago 2026", y son cosas
distintas— pero el hallazgo que este archivo documenta *sobrevivió tres rondas*
por exactamente esto: se arreglaban las copias conocidas y no se impedía la
siguiente.

**Consecuencia.** Para el equipo: la prueba dice que protege algo que no protege
del todo, y el comentario del panel repite la afirmación. La siguiente copia va a
entrar por la misma puerta y nadie se va a enterar.

---

### [BAJO] `/cuenta` imprime el UUID del usuario cuando el alta no capturó nombre

`src/app/cuenta/page.tsx:31` (`{s.nombre ?? s.userId}`) ·
`src/lib/auth/session.ts:44` (`nombre: (data?.nombre as string) ?? null`) ·
`src/app/admin/usuarios/nuevo/page.tsx:57` (el campo "Nombre" del alta es
**opcional**).

**Escenario.** Se da de alta `contralor@innovativos.mx` sin llenar "Nombre"
—posible por diseño—. El contralor abre "Mi cuenta" desde el panel
(`dashboard/page.tsx:101`) y bajo la etiqueta **Usuario** lee
`3f2a1c88-9b04-4e11-a7d3-6c0f5e2b8d41`. El correo, que sí existe en `app_user` y
sería la respuesta natural, no se selecciona (`session.ts:31`).

**Consecuencia.** Deuda de pulido con una arista: es la única pantalla que el
contralor abre para confirmar "sí, soy yo", y le contesta con un identificador
interno.

---

## Lo que revisé y está bien

**El CRÍTICO del 2-ago cerró de verdad, y lo verifiqué ejecutando la prueba, no
leyendo el commit.** `src/app/dashboard/acred.tsx:56-64` saca el componente de
`page.tsx` para poder correrlo, distingue "sin medición" de "cero", cambia el
guion por el número, apaga el acento y reescribe el pie.
`acred_sin_litros.test.tsx` (5/5) lo fija **renderizando** con
`renderToStaticMarkup` — es la primera prueba de este rubro que ejecuta un
componente en vez de leer su texto fuente, y eso es un cambio de método, no un
parche. **No es REINCIDENTE.** (Su prueba de control, en cambio, es de dónde sale
mi ALTO 1.)

**El cotejo obligatorio, mapa por mapa, sobre todo `src/app/`.** Enumeré cada
mapa literal y cada unión consumida:

| Mapa / unión | Dónde | Contra | Resultado |
|---|---|---|---|
| `ESTATUS` (3) | `dashboard/page.tsx:15-19` | `EstatusLiquidacion`, `types/cuadra.ts:106` | 3/3 · fallback en `:245` |
| `ESTATUS` (3) | `dashboard/[id]/page.tsx:25-29` | ídem | 3/3 · fallback en `:39` |
| `ESTATUS` (3) | `mis-viajes/page.tsx:8-12` **nuevo** | ídem | 3/3 · fallback en `:80` · además distingue `null` = "Sin liquidar" |
| `CONCEPTO` (9) | `dashboard/[id]/page.tsx:20-24` | `ConceptoGasto`, `types/cuadra.ts:20-25` | 9/9 · y solo es red: `:283-286` delega en el motor |
| `EstadoPanel` (4) | `dashboard/estado.ts:23-27` | consumido en `page.tsx:109,119,136` | 4/4 pintados |
| `TipoDiferencia` (37) | — | `types/cuadra.ts:62-93` | **no hay mapa**: se pinta `nota` libre (`[id]/page.tsx:191`) — por ahí entró el MEDIO del permiso CRE |
| `TonoDeducibilidad` (4) | `[id]/page.tsx:158` | `deducibilidad.ts:17` | **2/4** → MEDIO de arriba |
| `RolAppUser` (5) | `admin/equipo/page.tsx:11` **nuevo** | `provisionar.ts:16` | 5/5, y **tipado como `Record<RolAppUser, …>`**: un rol nuevo rompe `tsc`. Es el único mapa del repo que deriva del tipo en vez de repetirlo. |
| `RolAppUser` (4 de 5) | `admin/usuarios/nuevo/page.tsx:8-13` | ídem | 4/5 — omite `superadmin` **a propósito** y correctamente |
| `FaseCosto` (6) | `admin/page.tsx:28-35`, `analitica:9-12` | `costos.ts:41` | 6/6 en las dos |
| `FaseCosto` (3 de 6) | `admin/model-ops:48`, `costos-facturacion:10` | ídem | 3/6 y 6/6 · los dos con fallback `?? f.fase`; `escalacion` (que `faseDeModelo` sí emite, `costos.ts:103`) saldría crudo en la dona de Model Ops. Anotado, no reportado: es una etiqueta interna en una página del equipo. |
| `Alerta.tipo` (2) | `admin/notificaciones.tsx:5` | local | 2/2 |

**`/admin` no presume datos que no tiene, y esto lo verifiqué página por
página.** El MAPA advertía que podía ser "UI de escaparate construida a gran
velocidad". No lo es. Abrí las 26: `cobranza`, `compliance`, `comunicacion`,
`soporte`, `calidad-evals`, `conocimiento-rag`, `trust-safety`, `playground` y
`dev` son estados vacíos que **nombran la métrica que no tienen y por qué**;
`ejecutivo/page.tsx:88-96` se niega explícitamente a inventar ARR/burn/runway;
`capacidad-forecast/page.tsx:22-28` devuelve `null` en vez de proyectar sobre
cero y rotula su propia extrapolación como "no es un modelo de forecasting";
`whatsapp-infra/page.tsx:73-76` se niega a enseñar un número de teléfono de
ejemplo; `negocio.ts:62-65` **lanza** en los cuatro `.error` en vez de dejar que
una base caída se lea como "0 tenants, $0 gastados" —el mismo error que ya se
cerró para el panel de flota—; `calcularAlertas` (`notificaciones.tsx:14-26`) no
tiene un solo contador inventado; el chat (`chat.tsx:8-15`) es coincidencia de
palabras clave sobre el resumen ya calculado, declarado así en el código, y
responde "todavía no sé responder eso" en vez de inventar. El `ContadorRetro` del
MRR muestra `$0000000` y su comentario dice que es el número verdadero
(`admin/page.tsx:136-139`). No encontré una sola cifra fabricada en 4,103 líneas.

**`/admin` sí está detrás de autorización de verdad, no solo de un matcher.**
`admin/layout.tsx:27` llama `requireSuperadmin()` en el **layout**, que gatea las
26 páginas de una vez —ninguna página nueva puede olvidarlo—; y `guard.ts:62-67`
rebota a `/dashboard` a cualquier rol que no sea `superadmin`, incluido
`flota_admin`. El proxy (`proxy.ts:44`) es la primera capa y solo pregunta "¿hay
sesión?", como su propio comentario declara. Las dos tienen que fallar a la vez.

**Los cuatro estados del panel del contralor siguen pintados a propósito, y el
peor —el parcial— también.** `estado.ts:29-40` distingue `error`/`parcial`/
`vacio`/`datos` y `estado.test.ts` (6/6) fija la combinación traicionera (KPIs en
cero legítimo + listado caído → `parcial`, no `vacio`). `page.tsx:136-147` pinta
el aviso de carga incompleta **arriba** de las cifras, y cada sección conserva su
fallback propio (`:154, :171, :229`). `getLiquidaciones` sigue lanzando ante el
error por valor de supabase-js (`page.tsx:44`).

**Los estados de error y de carga.** `dashboard/error.tsx:66-73` pinta el
`digest` seleccionable y lo registra; `global-error.tsx` no depende de
`globals.css`; `not-found.tsx` sustituye el 404 crudo; `dashboard/loading.tsx` y
`[id]/loading.tsx` siguen el andamio real de su página. Ningún camino manda un
error de servidor crudo a pantalla: `api/export/liquidaciones/route.ts:36-39` y
`api/export/pdf/[id]/route.ts:52-55,64-70` devuelven texto humano y dejan el
detalle en el log. `layout.tsx:27` conserva el `viewport`.

**El formateo del dinero sigue siendo uno solo, donde importa.**
`formato.ts:27` reexporta de `src/lib/formato.ts`; `formato.test.ts` (7/7) y
`lib/formato.test.ts` siguen verdes; `grep -rn "round2" src/app/` no devuelve
nada, así que el redondeo del motor no se reimplementa en el panel. El signo de
la diferencia va pegado a la cifra en las dos pantallas
(`page.tsx:275-286`, `[id]/page.tsx:131-135`) y dicen lo mismo. `mis-viajes`
importa `mxn` y `fechaMx` de la misma fuente (`:3-4`). (El hueco del guardarraíl
va como BAJO arriba; ninguna **cifra de dinero** se coló por él.)

**Las llaves de React de las filas de dinero son estables.** `key={l.id}`
(`page.tsx:257`), `key={v.id}` (`mis-viajes:82`), `key={f.label}`
(`[id]/page.tsx:151`), `key={m.modelo}` / `key={f.id}` / `key={c.telefono}` /
`key={d.dia}` en `/admin`. Las de índice que quedan (`[id]/page.tsx:189,229`;
`page.tsx:193`; `charts.tsx:70,152`; `chat.tsx:61`) están o en Server Components
sin reordenamiento, o sobre listas que solo crecen al final (el historial del
chat), o sobre series de gráfica de longitud fija: no hay un camino por el que
barajen filas.

**El desglose se sigue callando antes que contradecirse.** `filasDeducibilidad`
devuelve `null` si las tres cubetas no suman el total (`deducibilidad.ts:54-55`,
un centavo de tolerancia), y `[id]/page.tsx:70-72` le pasa a propósito el total
**persistido** junto a las cubetas **reconstruidas**.

**La foto del ticket sigue sin llegar a pantalla.** `[id]/page.tsx` no referencia
`imagenUrl` ni una vez; `foto_no_expuesta.test.ts` (2/2) lo fija. El CRÍTICO
legal de la ronda 9 aguanta. Verifiqué también que `/mis-viajes` no la expone: su
`select` (`:27`) no pide `gasto` siquiera.

**Contraste de los dos tokens que sí se miden.** `contraste.test.ts` (6/6):
`--color-ok` 7.67:1 y `--color-bad` 5.38:1 sobre blanco. Recalculé a mano
`--muted` (#6b7280 sobre #ffffff = 4.83:1) y `--accent` como tinta (#0e7c66 =
5.13:1): pasan. El único que reprueba es `--color-warn`, arriba.

**Compuerta.** `npx vitest run src/app` → 10 archivos, **57/57** verdes
(eran 8/50 el 2-ago; los dos nuevos son `acred_sin_litros` y
`login/no_autoregistro`).

---

## Lo que NO alcancé a revisar

- **Quinta ronda seguida sin renderizar nada en un navegador.** Todo lo de arriba
  es lectura de código, `npx tsx` sobre el motor y `vitest` dirigido. El hueco de
  292 px de `/admin` está deducido de las clases y del `style` en línea, no visto;
  el `$0.00` del ALTO 1 está medido en el dato, no en el píxel. Si alguien puede
  abrir `/admin` a 1200 px de ancho antes del 6-ago, ese hallazgo se confirma o se
  cae en diez segundos.
- **No tengo acceso al proyecto real de Supabase.** Todo lo que digo del estado de
  los datos sale de `seed.sql` y de las migraciones. En particular no pude
  confirmar si alguna liquidación ya cerrada tiene `iva_acreditable > 0`, que es
  lo que decide si el ALTO 1 se ve o no el 6-ago.
- **No medí tamaño de toque renderizado.** Los botones de `/demo` (`px-3 py-1.5`,
  ~30 px), los enlaces "Exportar CSV"/"Descargar PDF" (`py-2`, ~36 px) y los items
  del sidebar de `/admin` (`py-2`, ~34 px) calculan por debajo de los 44 px
  recomendados, pero no lo verifiqué en pantalla y por eso no lo reporto.
- **`/admin`: leí las 26 páginas, pero solo ejecuté el razonamiento de datos de
  `negocio.ts`.** No tracé `agente-ocr`, `agente-cuadre`, `agente-whatsapp`,
  `observabilidad`, `integraciones`, `crecimiento`, `costos-facturacion` ni
  `conversaciones` línea por línea contra sus consultas; los leí buscando cifras
  fabricadas y no encontré ninguna, que es una comprobación más débil.
- **`/admin` no tiene `loading.tsx` en ningún segmento** y cada navegación paga
  `getResumenNegocio()` **dos veces** (layout + página, declarado en
  `layout.tsx:30-32`). No medí cuánto tarda; lo dejo anotado para rendimiento.
- **No perseguí las otras 35 claves de `TipoDiferencia`** buscando textos rotos
  como el del permiso CRE. Las notas se arman con plantillas en `engine.ts` y
  ninguna prueba compara la cadena completa, así que puede haber más.
- **No audité `/privacidad` ni `/aviso/[tenant]` a fondo** — solo el camino del
  contraste. El contenido legal es de otro rubro.
- **No revisé `design-system/`** (14 archivos HTML/CSS sueltos, sin importar desde
  `src/`): no pude establecer si sigue describiendo lo que `globals.css` sirve
  hoy, sobre todo después de que se quitara el modo oscuro.
- **El export CSV sigue entregando el estatus crudo** (`export.ts:73`:
  `con_diferencias`, no "Con diferencias"), a diferencia de las tres pantallas. El
  archivo declara ser para Excel y no para una persona; lo dejo anotado y no como
  hallazgo, igual que el 2-ago.
