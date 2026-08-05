# Frontend — auditoría 11 (pase 2)

**Nota: 7/10** (antes 5). Razón del movimiento: **se atacó y subió**. De los 13
hallazgos del pase 1, **10 están cerrados y lo verifiqué con la línea de hoy**,
no con la prosa del commit: `KpiTile` acepta `valor: number | null` y pinta `—`
(`admin/ui/kit.tsx:43,67,81`), las tres tarjetas fiscales pasan por
`acreditableMedido`/`notaAcreditable` (`dashboard/medicion.ts:52-56,66-71`,
consumido en `dashboard/page.tsx:259,262,270`), el `pordefecto` del filtro bajó a
`"7"` y ahora sale de un módulo compartido (`dashboard/page.tsx:228`,
`dashboard/ventana.ts:22,35`), `--faint` dejó de ser tinta —queda **un** uso, una
línea divisoria (`globals.css:68-76`, `admin/ui/graficas.tsx:428`)—, `CifraGrande`
y `AvanceCierre` distinguen `null` de cero (`cifra-grande.tsx:40,60,68`,
`avance-cierre.tsx:36,40,107-108`), `EstadoSat` es exhaustivo por tipo y
consumido (`documentos/estado-sat.ts:30-35`, importado en
`documentos/page.tsx:8`), `/mis-viajes` pinta `—` (`mis-viajes/page.tsx:73,131`),
hay `aria-current` (`sidebar-nav.tsx:51,121`), las 20 tablas de `/dashboard`
llevan `scope` (72 de 106 `<th>` del producto; las 34 sin él ya son todas de
`/admin`), y `soporte`/`mapa` gatean (`soporte/page.tsx:11`, `mapa/page.tsx:11`).

No sube más porque lo que queda es exactamente **el defecto de costura que el
MAPA predijo**: seis agentes arreglaron seis dominios y las juntas quedaron
abiertas. Tres de los cuatro hallazgos graves de abajo son *el mismo arreglo
aplicado en un archivo y no en su gemelo*, y uno es **la trampa documentada,
reproducida verbatim**: `deducible.tsx` existe, tiene su prueba, tiene cero
consumidores, y `[id]/page.tsx` sigue montando la copia inline con el ternario
de dos ramas.

**El riesgo mayor del rubro, hoy:** los dos botones de exportación que el panel
pinta para el superadmin —«Descargar PDF» y «Exportar CSV»— devuelven **401 «No
autorizado» en texto plano**, porque el `app_user.tenant_id` de Javier es `null`
por diseño y las dos rutas de export son las únicas del repo que no lo compensan.
Es la pantalla del minuto 6 del guion, y el contralor lo ve.

---

## Hallazgos

### [CRÍTICO] «Descargar PDF» y «Exportar CSV» devuelven `401 No autorizado` en texto plano al superadmin — que es quien proyecta el demo

`src/app/dashboard/[id]/page.tsx:135-138` (el `<a href="/api/export/pdf/${d.id}">`,
pintado si `d.pdfPath && puedeExportar(rol)`) · `src/app/dashboard/cuadre/page.tsx:172-177`
· `src/app/dashboard/analitica/page.tsx:113-125` · contra
`src/app/api/export/pdf/[id]/route.ts:33` y
`src/app/api/export/liquidaciones/route.ts:21`, los dos
`if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 })`.

**Escenario, con valores.** `scripts/crear-superadmin.mjs:109` escribe la fila de
Javier con **`tenant_id: null`** —y `provisionar.ts:9-12` + `0001_init.sql:17`
declaran que ese `null` *significa* superadmin, no "sin alta"—. Por eso
`guard.ts:33` existe: `requireSessionTenant` lo traduce a `TENANT_DEMO()`
(`11111111-…`). Las páginas usan esa función, así que renderizan bien, y
`permisos.ts:21` incluye `'superadmin'` en `EXPORTA`, así que **los dos botones
se pintan**.

Las rutas de API no usan `requireSessionTenant`: usan `getSessionTenant()` en
crudo (`session.ts:43`, `tenantId: (data?.tenant_id) ?? null`). Con la sesión de
Javier eso es `null`, el `if` de la línea 33/21 entra, y sale:

```
GET /api/export/pdf/<uuid>  →  401
Content-Type: text/plain
No autorizado
```

Es un `<a href>` sin `download`, así que **el navegador navega**: pantalla blanca
con «No autorizado» en Times New Roman, encima de la liquidación que se acaba de
cerrar en la sala. El CSV es un `<a download>`: baja un archivo cuyo contenido es
la cadena `No autorizado`.

**Intento de refutación.** ¿Alguna capa lo salva? No: `getSessionTenant` no
inventa tenant, y `puedeExportar` ya pasó. Y el repo **sabe** compensar esto —
`src/app/api/dashboard/asistente/route.ts:36-40` hace exactamente
`if (!tenantId) { if (rol !== 'superadmin') 403; tenantId = TENANT_DEMO(); }`. De
las tres rutas que el arreglo `489ff54`/`2fb1982` tocó, **una recibió el fallback
y dos no**. Las pruebas no lo ven porque las dos fijan
`sesion = { tenantId: TENANT, rol }` siempre
(`export/pdf/[id]/autorizacion.test.ts:34-36`,
`export/liquidaciones/autorizacion.test.ts`): nunca se prueba el único rol cuyo
`tenantId` es `null`.

**Consecuencia.** El contralor pide el PDF —el entregable del producto— y ve un
error de servidor crudo. Y hay un daño gemelo que no se ve: si el `tenant_id` de
Javier estuviera puesto (otro despliegue), el CSV entregaría **200 OK con las
liquidaciones de OTRA flota**, porque la ruta filtra por `s.tenantId` mientras la
tabla de arriba se llenó con `resolverTenantEfectivo(?tenant=…)`. Silencio y
datos equivocados es peor que el 401.

**Causa raíz probable.** `requireSessionTenant` es la única función que conoce la
regla «superadmin ⇒ tenant demo», y las rutas de `/api` no la pueden llamar
(hace `redirect()`); cada una reimplementó la puerta y dos olvidaron la regla.

---

### [ALTO] Debajo de 1024 px el sidebar del panel del cliente esconde 15 de sus 23 rutas y **no deja forma de abrirlas** — Cuadre incluido

`src/app/dashboard/sidebar-nav.tsx:37` (el botón que pliega/despliega la sección
es `className="w-full hidden lg:flex …"`) · `:25`
(`useState(() => defaultAbierto || items.some((it) => it.href === pathname))`) ·
`:43` (`{abierto && items.map(…)}`) · `:127-131` (solo `INICIO` lleva
`defaultAbierto`) · `src/app/marco.ts:22-23` (`w-[72px] lg:w-[232px]`) ·
`src/app/dashboard/chrome.tsx:54` (el `<aside>` que lo aplica).

**Escenario, paso a paso.** Se abre `/dashboard` en una ventana de 900 px (o un
iPad en vertical, 768). `lg` es `min-width:1024px`, así que:

1. El carril colapsa a 72 px — el arreglo de G-17 funcionando.
2. `pathname === '/dashboard'`, que no pertenece a ninguna `<Seccion>`, así que
   `NEGOCIO`, `OPERACION`, `DOCUMENTOS_DINERO` y `GESTION` arrancan con
   `abierto === false` y **no pintan un solo `<Link>`**.
3. Su único disparador —el `<button>` de la línea 37— es `hidden` a ese ancho:
   `display:none`, ni visible ni clicable.

Lo que queda en pantalla, contado contra `dashboard/rutas.ts:16-54`: Resumen,
Valor & Ahorro, Analítica y Chat. **4 de 24.** Despacho, Viajes, Unidades, POD,
Incidencias, Documentos, **Cuadre / Liquidación**, Facturación, Cobranza,
Usuarios, Políticas y Configuración no existen y no hay gesto que las traiga.

**Intento de refutación.** ¿Es el mismo diseño que `/admin`? No, es el contrario:
`admin/layout.tsx:81-82` monta `<div className="hidden lg:block"><SidebarNav/></div>`
+ `<div className="lg:hidden"><SidebarNavIconos/></div>`, y
`admin/sidebar-nav-iconos.tsx:15-16` es una **lista plana de `TODAS_LAS_RUTAS`**:
las 27 se alcanzan siempre. El panel del cliente reusó el acordeón y le escondió
el mando. La prueba no lo ve porque fija `usePathname: () => '/dashboard/cuadre'`
(`sidebar_marco.test.tsx:22`), que casualmente abre `DOCUMENTOS_DINERO`, y solo
afirma que existe la clase `hidden lg:inline` (`:49`).

**Consecuencia.** El arreglo de G-17 cambió «23 etiquetas apiladas en 56 px, pero
todas alcanzables» por «tipografía correcta y el 65% del producto inalcanzable».
Un contralor que abra el panel en la tableta concluye que Likida no tiene pantalla
de liquidaciones.

**Causa raíz probable.** El estado de plegado y el disparador viven en el mismo
componente, y solo al disparador se le puso el breakpoint.

---

### [ALTO · REINCIDENTE] La trampa documentada, verbatim: `deducible.tsx` deriva la tinta del tipo, tiene su prueba, y **nadie lo importa** — la pantalla sigue con el ternario de dos ramas

`src/app/dashboard/[id]/page.tsx:191-200`, en particular `:198`
(`style={{ color: f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)' }}`) ·
contra `src/app/dashboard/deducible.tsx:25-31`
(`TINTA_TONO: Record<TonoDeducibilidad, string>` con los cuatro tonos) y `:48-58`
(`FilaDeduc`) · cuyo **único** consumidor en todo `src/` es
`src/app/dashboard/deducible.test.tsx:3` (`grep -rn "FilaDeduc\|TINTA_TONO" src/`
no devuelve una sola página) · `src/app/dashboard/[id]/page.tsx:1-14` no importa
`./deducible`.

**Escenario, con valores.** Una liquidación con combustible pagado en efectivo:
`filasDeducibilidad` devuelve una fila `tono:'condicionado'` («Deducible para ISR
— sujeto a permiso CRE vigente») y una `tono:'pendiente'` («Por confirmar»,
$2,250). El guion abre pantalla y PDF del mismo viaje:

| Fila | PDF (`liquidacion/pdf.ts:295`) | Pantalla (`[id]/page.tsx:198`) |
|---|---|---|
| Deducible para ISR | VERDE | `--ink` |
| No deducible | ROJO | `--color-bad` |
| Sujeto a permiso CRE | INK | `--ink` |
| **Por confirmar** | **ÁMBAR** | **`--ink`** |

Tres de cuatro salen en la misma tinta en pantalla y en tres colores en el PDF.
«Por confirmar» —dinero que todavía se puede perder— se lee idéntico a «Deducible
para ISR».

**Intento de refutación.** El archivo del arreglo existe y su prueba es verde
(`deducible.test.tsx:39,51-52,58-59,86`): 6 aserciones que miden un componente que
ningún usuario ve. Es literalmente el patrón que `RESULTADO.md:115-119` describe
para `login/page.tsx`. Además el comentario que justifica la tinta plana
(`[id]/page.tsx:182-184`: *«`--color-ok` mide 2.22:1 sobre blanco»*) lleva **cuatro
rondas vencido**: `globals.css:35` es `#14602c`, y `contraste.test.ts` lo verifica.

**Consecuencia.** El único renglón que el contralor tiene que mirar dos veces —el
dinero recuperable— se pinta como si ya estuviera ganado. Y para quien mantenga
esto: la suite dice que el defecto está cerrado.

**Causa raíz probable.** El agente sacó el componente para poder probarlo y no
cambió el `import` de la página; nada en el repo falla cuando un componente queda
sin consumidores.

---

### [ALTO] El asistente sigue afirmando «0 L elegibles para el estímulo (LIF 2026, Art. 20-A)» y «$0.00 de IVA acreditable (LIVA, Art. 5)» — al lado de la tarjeta que acaba de decir que no lo midió

`src/app/dashboard/chat.tsx:64` (`return acred ? \`${litros(acred.litrosDiesel)} elegibles
para el estímulo en ${periodo} (LIF 2026, Art. 20-A).\` : nada`) · `:70` (IVA,
LIVA art. 5) · `:73` (peaje 50%) · `:18` (la pregunta sugerida
**«¿Cuánto diésel es elegible para el estímulo?»**, un clic) · montado en el rail
de todas las páginas de dinero (`chrome.tsx:113` → `rail.tsx:168,171`) y en
`chat/page.tsx:63`.

**Escenario, con los datos que hay hoy.** `getAcreditables` devuelve un objeto
válido con `litrosDiesel: 0, iva: 0, peaje: 0, liquidaciones: 3` — el caso normal,
porque el IVA y el peaje se suman después de `if (!g.xmlVerificado) continue;` y
una foto de WhatsApp nunca produce `xmlVerificado` (lo explica `medicion.ts:16-22`).
En `/dashboard`, en la misma pantalla y a 300 px de distancia:

| Pieza | Qué dice |
|---|---|
| Tarjeta «Diésel elegible» (`page.tsx:259-260`) | **—** · *«Ningún CFDI de diésel del periodo trae los litros (complemento de hidrocarburos) — sin ellos no se pueden contar.»* |
| El rail, al clic en la pregunta sugerida | **«0 L elegibles para el estímulo en los últimos 7 días (LIF 2026, Art. 20-A).»** |

`acred` no es `null`, así que el `? :` de `:64` toma la rama afirmativa. El
producto entero se rediseñó para no decir esa frase, y la dice el componente que
tiene un botón que la provoca.

**Intento de refutación.** ¿Lo cubre la prueba? No: `rail_no_afirma.test.tsx`
cubre `motivo` y `periodo`, y su propio fixture (`:48`) es
`{ iva: 774.48, peaje: 0, ieps: 0, litrosDiesel: 0, liquidaciones: 3 }` — el mismo
objeto que produciría «0 L … LIF 20-A» si se le preguntara por el diésel. El
arreglo de G-09 se aplicó a `KpiTile` y a `medicion.ts`; `chat.tsx` formatea a
mano con `litros()`/`mxn()` y nunca pasó por ahí.

**Consecuencia.** El §4 del guion es exactamente esta cifra («lo que le
entregamos es el dato duro: cuántos litros son elegibles»). Que el asistente
conteste `0 L` con la cita de ley al lado, mientras la tarjeta dice que no lo
midió, es una pantalla que se contradice a sí misma sobre el número que sostiene
la venta.

---

### [ALTO] La página de Chat, con la base caída, le dice al contralor «Todavía no hay liquidaciones» — el rail gemelo ya no lo hace

`src/app/dashboard/chat/page.tsx:63` (`<ChatFlota kpis={kpis} acred={acred} />` —
**sin `motivo` ni `periodo`**) · contra `src/app/dashboard/chat.tsx:79`
(`motivo = 'vacio'` es el default) y `:39-43`
(`SIN_DATOS.vacio = 'Todavía no hay liquidaciones para calcular esto.'`) · contra
`src/app/dashboard/rail.tsx:85,168` (el gemelo **sí** propaga el `motivo`
discriminado que la ruta calcula en `api/dashboard/asistente/route.ts:89`).

**Escenario, con valores.** Supabase pausa —el guion lo contempla—. En
`/dashboard/chat` los dos `safe()` de `:46-47` devuelven `null` y se registran.
El contralor, con 40 liquidaciones cerradas, escribe «¿cuánto llevo comprobado?» y
lee:

> **Todavía no hay liquidaciones para calcular esto.**

**Intento de refutación.** Es literalmente el hallazgo G-25 que
`rail_no_afirma.test.tsx:24-27` declara cerrado —*«una lectura caída se leía como
una flota que nunca liquidó»*—, cerrado en `chat.tsx` (el `motivo`), en
`route.ts` (el 503) y en `rail.tsx` (el paso de la prop); la **cuarta** superficie
que monta el mismo componente se quedó con el default. La prueba solo llama a
`responder()` y a `<ChatFlota motivo="error">` a mano: nunca monta `ChatPage`.

**Consecuencia.** La afirmación más cara que este producto puede hacer, dicha con
aplomo, en la pantalla que el sidebar llama «Chatea con tus Datos». Y `periodo`
tampoco viaja, así que las respuestas dicen «todo el histórico» por default aunque
las consultas de `:46-47` sí lo sean — coincide por accidente, no por contrato.

---

### [MEDIO] «Ver como \<rol\>» se cae al tocar el filtro 7d/30d/Todo: el `?rol=` se arregló en dos de las tres fuentes de links

`src/app/dashboard/page.tsx:228`
(`extra={sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined}`
— sin `rol`) · `src/app/dashboard/analitica/page.tsx:60-61` (ídem) ·
`src/app/admin/ui/global-filter.tsx:32-36` (`new URLSearchParams(extra)`, no ve
nada más) · contra `src/app/dashboard/sufijo.ts:26-33` y
`src/app/dashboard/sidebar-nav.tsx:98-99`, que **sí** lo arrastran.

**Escenario, con las URLs.** Javier abre `/dashboard?vista=demo&rol=contador`; la
cinta de `aviso-rol.tsx` anuncia «Estás viendo el panel como Contador» y el
sidebar queda filtrado. Clic en **30d**:

```
construir('30') → params = {vista: 'demo'} + rango=30
href = "/dashboard?vista=demo&rango=30"      ← el `rol` no está
```

`rolEfectivo` vuelve a `superadmin`, la cinta desaparece, el sidebar se repuebla
con las 23 rutas y las cifras cambian de alcance. La comparación se terminó sola,
en el clic de un filtro de fechas.

**Intento de refutación.** El propio `sufijo.ts:6-11` nombra el daño («un link que
lo pierde devuelve la sesión a los privilegios reales de superadmin mientras el
sidebar de esa misma pantalla sigue filtrado»). `ver_como_rol.test.ts` prueba
`sufijoTenant` y que las páginas tipen `rol?` en sus `searchParams`; ninguna
aserción toca `GlobalFilter`, que es la tercera fuente de links del panel.

**Consecuencia.** Es herramienta interna, por eso MEDIO — pero el modo de falla es
que Javier crea estar viendo lo que ve un contador y esté viendo otra cosa.

---

### [MEDIO] `/dashboard/valor-ahorro` imprime `$0.00` de una consulta caída y lo suma al total como si fuera cero medido

`src/app/dashboard/valor-ahorro/page.tsx:62`
(`const dineroAnomalias = anomalias?.reduce((s, a) => s + a.monto, 0) ?? 0`) ·
`:63` (`dineroObservado = (kpis?.diferenciaDetectada ?? 0) + dineroAnomalias`) ·
`:115-117` (la tarjeta) · `:118-120` (el total, con la nota «Suma de los dos
anteriores»).

**Escenario, con valores.** `detectarAnomalias` truena (recorre viajes y gastos,
es la consulta más pesada de la página) y `getKpis` no. `safe()` devuelve `null`
solo para la primera. La sección «Dinero que el motor puso sobre la mesa» pinta:

```
Observado por el cuadre                    $12,400.00
En comprobantes repetidos entre viajes     $0.00      ← "No se pudo revisar"
Total puesto a revisión                    $12,400.00 ← "Suma de los dos anteriores"
```

El `$0.00` grande y el desmentido en `text-xs` debajo es exactamente la forma que
G-09 cerró en `KpiTile` —y el componente **ya sabe** recibir `null` y pintar `—`
(`kit.tsx:43,81`)—; esta página no lo usa. Peor: el total no declara que le falta
un sumando, así que el contralor lee $12,400 como el número completo.

**Consecuencia.** Es la página que existe para justificar el precio. Una cifra que
subestima el valor por una consulta caída, presentada como suma cerrada, es el
mismo error que el resto del panel ya no comete.

---

### [MEDIO] Dos pantallas siguen anunciando como inexistente lo que la 0047 creó y Despacho ya escribe

`src/app/dashboard/configuracion/page.tsx:111` (texto visible dentro de un
`EstadoVacio`: *«Esto NO es un registro de unidades (no existe)»*) ·
`src/app/dashboard/analitica/page.tsx:154` (*«necesita datos que hoy no se
capturan: kilómetros recorridos, **unidad asignada al viaje** e ingreso del
flete»*) · `src/app/dashboard/pendiente.tsx:8-10` (el docstring del componente que
sirve seis pantallas sigue listando «Unidades» y «ni de vehículos») · contra
`supabase/migrations/0047_operacion_encargado.sql:36-52` (tabla `unidad` con su
dominio) y `:65` (`viaje.unidad_id`) · contra
`src/lib/cuadra/operacion.ts:621-635` (`asignarUnidad`, que escribe `unidad_id` y
mueve el estado de la unidad a `en_ruta`) · consumido por
`src/app/dashboard/despacho/page.tsx:107` y `:142`.

**Escenario, textual.** El contralor asigna una unidad a un viaje en **Despacho**
(el `<select name="unidadId">` de `despacho/vista.tsx:82`), ve la unidad en
**Unidades** con estado «En ruta», entra a **Configuración** y lee que un registro
de unidades «no existe», y en **Analítica** que la unidad asignada al viaje es un
dato «que hoy no se captura» — acaba de capturarlo, dos pantallas antes, en el
mismo menú.

**Intento de refutación.** El guardarraíl existe y no cubre estas dos:
`huecos_reales.test.ts:45-54` ata frases **literales** a tablas, y su propio
comentario (`:38-42`) dice que la lista es literal a propósito. Las nueve regex
cubren «no hay tabla de vehículos», «no guarda unidad», «no tiene unidad_id»…
ninguna cubre «no es un registro de unidades (no existe)» ni «unidad asignada al
viaje … no se captura». El hallazgo del pase 1 se cerró en `viajes` y `soporte`,
que eran las dos que la lista nombraba.

**Consecuencia.** El recuadro de hueco honesto es el activo de credibilidad del
panel (`pendiente.tsx:67-68`). Un hueco que ya no lo es convierte esa declaración
en algo que hay que verificar, y el comprador que le crea descarta una función que
sí tiene.

---

### [MEDIO · REINCIDENTE, SIN CAMBIO] `/admin` sigue reservando 292 px para un panel oculto, en las ~30 páginas

`src/app/admin/asistente-expandible.tsx:36`
(`width: expandido ? 0 : \`calc(100% - ${ANCHO_ASIDE + 16}px)\``, con
`ANCHO_ASIDE = ANCHO_ASISTENTE = 276` en `:10` y `marco.ts:43` — **sin condición
de breakpoint**) · `:52` (el `<aside>` que ocuparía esos 292 px es
`hidden xl:flex`) · `src/app/admin/layout.tsx:126` (envuelve `children`).

**Escenario, con números.** Ventana de 1200 px. `xl` es `min-width:1280px`, así
que el `<aside>` es `display:none` pero el `<div>` hermano sigue midiendo
`calc(100% - 292px)`. La columna útil de `/admin` es
`1200 − 32 − 232 − 16 = 920 px`; el contenido se encoge a **628 px** y quedan 292 px
de fondo naranja vacío a la derecha. **32% del área útil.**

**Intento de refutación.** `/dashboard` no lo tiene: ahí el rail es hermano flex
con `shrink-0` y la columna es `flex-1 min-w-0` (`marco.ts:36`, `chrome.tsx:104`),
así que al ocultarse el rail el flex reparte solo. El defecto es exclusivo de
`/admin`, que calcula el ancho a mano. Verificado hoy, línea por línea, sin
cambios desde el pase 1.

**Consecuencia.** Es la consola de Javier y no la del contralor, por eso MEDIO.
Cobra factura el día que se enseñe en una laptop que no sea la de siempre.

---

### [MEDIO] El `aria-current` llegó y la marca visual no: en las 24 páginas el sidebar se ve idéntico para quien mira

`src/app/dashboard/sidebar-nav.tsx:15` (la constante `ITEM`, **la misma cadena
para todos los items**) · `:47` y `:119` (`className={ITEM}` sin rama por
`pathname`) · `:51,:121` (el `aria-current`, que sí distingue) ·
`src/app/globals.css` no tiene una sola regla `[aria-current]`
(`grep -n "aria-current" src/app/globals.css` → vacío) ·
`src/app/admin/sidebar-nav.tsx:35` (mismo patrón, y ahí ni `aria-current` hay).

**Escenario.** Javier recorre Inicio → Cuadre → Documentos → Despacho →
Incidencias. En los cinco el menú es pixel por pixel idéntico: ningún fondo,
ninguna tinta, ningún peso cambia. La única pista de dónde estás es el `<h1>` del
header. En `/dashboard/despacho` e `/dashboard/incidencias`, que además comparten
el bloque «Estado de la operación» con las mismas seis tarjetas
(`despacho/vista.tsx` reusado por `inicio-operacion.tsx`), dos pantallas distintas
abren con la misma fila de números y el mismo menú sin marca.

**Intento de refutación.** `sidebar_marco.test.tsx:31-42` prueba que el atributo
existe y que solo uno lo lleva — y ahí se detuvo. Un atributo sin regla de estilo
resuelve al lector de pantalla y a nadie más.

**Consecuencia.** Es orientación, no datos, por eso MEDIO: en un recorrido de
cinco pantallas en dos minutos el comprador pierde el hilo y las páginas se le
mezclan.

---

### [BAJO] `acred.tsx` es un componente muerto con dos archivos de prueba encima

`src/app/dashboard/acred.tsx:23` (`export function Acred`) · sus dos únicos
consumidores en `src/` son `src/app/dashboard/acred_sin_litros.test.tsx:3` y
`src/app/dashboard/peaje_condicionado.test.tsx:6` · el camino que corre es
`KpiTile` + `medicion.ts`, que reimplementa la misma regla
(`page.tsx:259-271`, `facturacion/page.tsx:110-119`,
`combustible-casetas/page.tsx:101-102`) ·
`src/lib/cuadra/liquidacion/reserva_una_sola_fuente.test.ts:72` incluso lo exenta
por nombre (`PENDIENTE_OTRO_DOMINIO = ['src/app/dashboard/acred.tsx']`).

**Escenario.** Alguien cambia la regla de «un cero acreditable no es una
medición». Cambia `acred.tsx` porque es el archivo que la documenta en 30 líneas
de comentario y el que tiene las pruebas; la suite queda verde y **la pantalla no
cambia**, porque la regla viva está en `medicion.ts:52-56`.

**Consecuencia.** Deuda que ya cobró factura en este mismo repo dos veces
(`login/page.tsx`, `deducible.tsx`). Aquí el camino que corre es correcto, así que
hoy no hay daño al usuario — solo cobertura que mide otra cosa.

---

### [BAJO · REINCIDENTE, REDUCIDO] Quedan 3 tablas sin `scope`, y las tres son de `/admin`

`src/app/admin/flotas/page.tsx:56-60` · `src/app/admin/page.tsx:205-209` ·
`src/app/admin/equipo/page.tsx:63-66`. Las 20 tablas de `/dashboard` y la de
`/mis-viajes` ya lo llevan (`grep -rn "<th" src/app | grep -v test` → 106, con
`scope` 72; los 34 restantes son estos tres `<thead>` más los ejes de
`admin/ui/graficas.tsx:348-350`, que no son tablas de datos). Ninguna lleva
`<caption>`.

**Consecuencia.** No es del demo. Baja de gravedad respecto al pase 1 (era 4 de
106): lo que queda es la consola interna.

---

## Lo que revisé y está bien

**Los 10 cierres del pase 1, verificados con la línea de hoy, no con el commit.**
Cada uno lo abrí y seguí la cadena hasta el consumidor real:

| Hallazgo pase 1 | Cerrado en | Consumidor real verificado |
|---|---|---|
| `KpiTile` siempre imprime el número | `admin/ui/kit.tsx:43,67,81` | `dashboard/page.tsx:259,262,270`; `facturacion:110,115,118`; `combustible-casetas:101`; `incidencias/vista.tsx:54` |
| Las tres tarjetas fiscales afirman un cero | `dashboard/medicion.ts:52-56,66-71` | importado y usado en las tres páginas ✓ |
| El botón 30d no hacía nada | `dashboard/page.tsx:228` (`pordefecto="7"`) + `ventana.ts:22,35` | `RANGO_POR_DEFECTO` es la misma constante que resuelve la página ✓ |
| `--faint` a 2.56:1 como tinta | `globals.css:68-76` | queda **un** uso y es una línea divisoria (`graficas.tsx:428`); las citas legales pasaron a `--muted` (`kit.tsx:100`, `cifra-grande.tsx:70`) ✓ |
| `$0.00` sobre el cartel de error | `cifra-grande.tsx:40,60,68`; `avance-cierre.tsx:36,40,107` | `page.tsx:156` pasa `kpis ? … : null` y `:148` pasa `viajes` sin `?? []` ✓ |
| «IVA acreditable» en tres ventanas | `ventana.ts` + `facturacion:49`, `combustible-casetas:55`, `cuadre:81` con `null` **explícito** y el rótulo cambiado a «todo el histórico» (`facturacion:103`, `cuadre:101`) | y `api/dashboard/asistente/route.ts:75` resuelve con el MISMO módulo ✓ |
| Viajes/Soporte negando la 0047 | `viajes/page.tsx:143-153` (ahora enlaza Unidades/POD/Despacho), `soporte/page.tsx:18-27` | atado por `huecos_reales.test.ts` ✓ |
| `EstadoSat` 2/4 y clave cruda | `documentos/estado-sat.ts:30-35` (`Record<EstadoSat,…>`, `no_encontrado` → `bad`) | **importado** en `documentos/page.tsx:8` ✓ — este sí llegó al camino que corre |
| `/mis-viajes` con `$0.00` | `mis-viajes/page.tsx:73` (`== null ? null : Number(…)`) y `:131` (`—`) | + el renglón de `:156-160` que explica por qué no reenviar ✓ |
| Rol crudo en el pill de Usuarios | `usuarios/page.tsx:117` (`etiquetaRol(u.rol)`) | sale de `admin/roles.ts:18`, `Record<RolAppUser, string>` ✓ |
| `soporte`/`mapa` sin gate | `soporte/page.tsx:11`, `mapa/page.tsx:11` (`exigirVerRuta`) | vigilado por `guardas_de_pagina.test.ts` ✓ |
| Sufijo pierde `?rol=` | `sufijo.ts:26-33` | consumido por todas las páginas server; falta solo en `GlobalFilter` (hallazgo arriba) |

**El cotejo obligatorio, mapa por mapa, contra `src/types/` y los `check` de las
migraciones. Enumeré los 18 mapas literales de `src/app/` y abrí cada uno:**

| Mapa | Dónde | Contra | Resultado |
|---|---|---|---|
| `ESTILO_ESTADO` | `admin/ui/kit.tsx:109` | `Estado` | **tipado** ✓ |
| `FASE_LABEL` / `FASE_ICONO` | `admin/fases.ts:34,43` | `FaseCosto` | **tipado** — la quinta copia que había cruzado al panel del cliente se retiró (`valor-ahorro:14`) ✓ |
| `ROL_LABEL` | `admin/roles.ts:18` | `RolAppUser` | **tipado** ✓ |
| `SAT` | `documentos/estado-sat.ts:30` | `EstadoSat` | **tipado, 4/4** ✓ |
| `SIN_DATOS` | `chat.tsx:39` | `MotivoSinDatos` | **tipado** ✓ |
| `NOTA_SIN_MEDICION` | `medicion.ts:37` | `CampoAcreditable` | **tipado** ✓ |
| `TINTA_TONO` | `deducible.tsx:25` | `TonoDeducibilidad` | tipado **y sin consumidor** → hallazgo |
| `ESTATUS` (3) | `estatus.ts:17` | `EstatusLiquidacion` (`types/cuadra.ts:120`) | 3/3 · fallback `:26` ✓ · y `mis-viajes:5` ya **importa** este módulo en vez de copiarlo |
| `CONCEPTO` (9) | `[id]/page.tsx:31` | `ConceptoGasto` (`types/cuadra.ts:20-25`) | **9/9** ✓ y solo es red: `:324` delega en el motor |
| `ESTATUS_VIAJE` (3) | `viajes/page.tsx:21` | `viaje_estatus_dominio` | 3/3 · fallback `:122` ✓ |
| `ESTADO_UNIDAD` (4) | `unidades/vista.tsx:15` | `0047:46-47` (`disponible, en_ruta, taller, baja`) | **4/4** ✓ |
| `TIPOS` (5) | `incidencias/vista.tsx:11` | `0047:110-111` | **5/5** ✓ |
| `PRIORIDADES` (3) / `ESTADOS` (3) | `incidencias/vista.tsx:14,19` | `0047:112-115` | **3/3 y 3/3** ✓ |
| POD (3+`null`) | `pod/vista.tsx:13-19` | `0047:139-140` | **3/3 + null** ✓ |
| `ROLES` (5) | `usuarios/page.tsx:24` | `app_user.rol` | 5/5 ✓ |
| `ROL_BADGE` (5) | `chrome.tsx:27` | ídem | 5/5 · fallback ✓ |
| `NOMBRE` (3) | `aviso-rol.tsx:7` | `PREVISUALIZABLES` (`visibilidad.ts:124`) | **3/3 exacto** ✓ |
| Rutas (23) | `rutas.ts:16-54` | `AREA_POR_RUTA` | 23/23 — ninguna cae al `undefined` que la negaría ✓ |

**Ningún mapa está desincronizado con `src/types/` hoy.** Los dos que lo estaban
en el pase 1 (`EstadoSat` 2/4, `TonoDeducibilidad` 2/4) se resolvieron derivando
del tipo; el segundo no llegó a la pantalla, que es el hallazgo, no el mapa.

**Los estados de error, vacío y parcial, seguidos hasta el render.**
`estado.ts:29-38` distingue los cuatro y `estado.test.ts` fija la combinación
traicionera. Las 21 páginas con datos envuelven cada consulta en `safeLog`
—no un `catch` vacío— y tienen fallback **por sección** (`page.tsx:251,284`;
`facturacion:74,105`; `combustible-casetas:86,134`; `cuadre:103,179`;
`analitica:87`). `cuadre/page.tsx:40` y `usuarios/page.tsx` **lanzan** ante el
error por valor de supabase-js. `error.tsx` pinta el `digest`; `loading.tsx`
respeta `prefers-reduced-motion`, igual que `use-count-up`, `avance-cierre.tsx:93`
y `cifra-grande.tsx:55`.

**El formateo del dinero sigue siendo uno solo.** `formato.test.ts` (el grep de
`toLocaleString('es-MX')`) verde; `formato-preset.ts` reexporta de
`lib/formato.ts`; `mis-viajes`, `[id]` y las 60 cifras de `KpiTile` pasan por ahí.
No encontré una sola cifra mal formateada.

**Llaves de React estables en toda fila de dinero.** `key={l.id}` (`cuadre:208`),
`key={v.id}` (`viajes:124`, `mis-viajes:124`), `key={u.id}` (`usuarios:110`),
`key={i.id}` (`incidencias/vista:99`), `key={f.label}` (`[id]:192`). Las de índice
que quedan (`cuadre:150`, `combustible-casetas:146`, `[id]:270`) están sobre
listas de anomalías y comprobantes en Server Components que no reordenan.

**La foto del ticket sigue sin llegar a pantalla** (`[id]/page.tsx:93-99`,
`pod/page.tsx`), `foto_no_expuesta.test.ts` verde.

**Compuerta medida hoy:** `npx tsc --noEmit -p .` → exit 0. `npm run lint` → exit
0, cero warnings. `npx vitest run` → **3 pruebas rojas de 2,530**, todas fuera de
este rubro y todas de tiempo de reloj: `intake/ocr_imagen_cara.test.ts` (2) y
`normas/fundamento.test.ts` («un mensaje normal cuesta una fracción de
milisegundo», 13,045 ms). Lo anoto porque la línea base del MAPA decía exit 0.

---

## Lo que NO alcancé a revisar

- **Séptima ronda seguida sin renderizar nada en un navegador.** Todo lo de
  arriba es lectura de código: `npm run build` está prohibido y el preview bajo
  `src/app/zzz-preview-*` exige escribir en el repo, que también lo está. Los tres
  hallazgos que un screenshot cerraría o tumbaría en diez segundos: el sidebar de
  `/dashboard` a 900 px (ALTO), el hueco de 292 px de `/admin` a 1200 px, y la
  ausencia de marca visual de página activa.
- **No tengo el proyecto real de Supabase.** El CRÍTICO del 401 lo sostengo con
  `scripts/crear-superadmin.mjs:109` (`tenant_id: null`) y con que `guard.ts:33`
  exista para compensarlo; si en producción alguien le puso tenant a mano a la
  fila de Javier, el 401 se convierte en el otro modo de falla —CSV de la flota
  equivocada con 200 OK—, que es peor. No pude confirmar cuál de los dos se ve
  mañana.
- **No medí tamaños de toque renderizados.** Los `<select>`/`<button>` de los
  cinco formularios de operación (`px-2.5 py-1.5`, ~32 px) y los items del sidebar
  (`py-2`, ~34 px) calculan por debajo de los 44 px recomendados; sin pantalla no
  lo reporto.
- **`/admin`: leí el marco, el kit, `asistente-expandible`, `layout`, `fases.ts`,
  `roles.ts` y las gráficas, no las ~30 páginas.** Sobre `/admin` esta ronda
  aporta el 292 px, las tres tablas sin `scope` y la falta de estado activo.
- **No perseguí las 37 claves de `TipoDiferencia`** buscando textos rotos: siguen
  llegando a `[id]/page.tsx:231` como `nota` libre del motor, y eso es del rubro
  del motor.
- **`/demo`**: verifiqué que los dos hallazgos de la ronda 10 cerraron —el
  `rfcReceptor` viaja con el preset (`presets.ts:32` → `api/demo/route.ts:88`), así
  que «CFDI validado por QR ✅» (`simulador.tsx:47`) ya no se desdice dos burbujas
  después; y la etiqueta cruda `diesel` la resuelve el motor
  (`presets.ts:43`)—. Lo que **no** verifiqué es la burbuja final
  (`simulador.tsx:95`, «Te mando tu liquidación en PDF»), que se emite siempre y en
  este camino no hay PDF: no supe decidir si es simulación declarada o promesa
  incumplida, y sin poder ejecutarlo preferí no reportarlo.
- **No abrí `design-system/`** (los HTML/CSS sueltos que nadie importa desde
  `src/`): no pude establecer si todavía describe lo que `globals.css` sirve hoy.
