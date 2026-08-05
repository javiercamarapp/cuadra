# Cumplimiento fiscal — auditoría 10

**Nota: 6/10** (antes 5, auditoría 9). Razón del movimiento: **se atacó y
subió, y la mirada profunda encontró un riesgo nuevo que pesa tanto como lo
que se cerró.** Los tres ALTOS de la ronda 9 (EFOS presunto/definitivo, tope
de $750/día, LISR 28-V tercer párrafo) siguen cerrados y los verifiqué contra
el código, no contra el changelog — uno de ellos (EFOS) incluso se endureció
más de lo que pedía el hallazgo original. Hoy además se cerró, con TDD
completo y de punta a punta, un bug que habría sido CRÍTICO: la mensualidad de
Likida podía cobrarse por $10,000 y timbrarse por $11,600. No sube más porque
esta ronda confirma con evidencia de código dos cosas nuevas que ninguna ronda
había medido: **no existe la cláusula que autoriza al sistema a presentar el
RFC de un cliente ante el portal de un tercero para pedir un CFDI en su
nombre**, y **el 61% del código nuevo de `facturacion/` esta semana (CAPUFE,
61 KB) automatiza la porción MENOR del gasto fiscal de una flota — el peaje en
efectivo y ticket por ticket — mientras la porción MAYOR — diésel por
monedero y peaje por TAG, ~54% del gasto según INEGI — no tiene una sola línea
de código que la ingiera**, pese a que el propio repo ya lo sabe y lo escribió
en un documento el 29-jul.

El riesgo mayor del rubro, hoy: **si el equipo sigue el roadmap tal como está
documentado (`docs/investigacion/ROADMAP-INTEGRACIONES.md`), en dos semanas
puede tener 30 adaptadores de portal funcionando y seguir sin poder decirle a
un contralor cuánto de su diésel y su peaje son deducibles — porque esos dos
no pasan por ningún portal.**

---

## El hallazgo de negocio, verificado a fondo (INEGI, monedero, TAG, y qué hace el código hoy)

Se me pidió verificar la conclusión de un agente de investigación de
portales: que diésel y casetas son ~54% del gasto de una flota (INEGI, no la
tabla de CANACAR que el IMT documenta como nunca publicada), que son las
categorías que MENOS generan ticket facturable por portal porque se pagan con
monedero (CFDI consolidado del emisor) y TAG (factura mensual de CAPUFE), y
que el cuarto entregable no es un adaptador más sino la ingesta del CFDI
consolidado.

**Verifiqué el orden de magnitud con una fuente independiente.** Búsqueda
directa a la Encuesta Anual de Transportes (EAT) del INEGI, edición 2024,
autotransporte de carga general: combustibles y lubricantes = **42.6%** del
gasto — consistente con el 43.5% que reporta el hallazgo (la cifra exacta de
peaje, 10.8%, no la corroboré por separado; el orden de magnitud de
combustible sí, y con eso basta para no descartar el hallazgo por inventado).
No repito la cifra de 54% como verificada al centavo — la reporto como
consistente con una fuente pública distinta a la que usó el agente original,
que es lo que pedía la verificación.

**Lo que el código YA sabe, y es más de lo que esperaba encontrar:**

- `src/lib/cuadra/facturacion/comercios.ts:33` — comentario textual: *"El
  peaje además no se factura ticket por ticket: el TAG factura mensual contra
  la cuenta."* Y `:596-629`: IAVE, TAG PASE y TeleVía están marcados
  `requiereCuenta: true` con el comentario `"SISTEMA DE TAG, no de ticket: la
  factura llega CONSOLIDADA por periodo."`
- `src/lib/cuadra/facturacion/enrutar.ts:13-16` — la función que decide quién
  factura cada ticket ya declara que el TAG "factura mensual contra la
  cuenta, no ticket por ticket" y por eso enruta esos tres portales a
  `mensaje` (un humano), nunca a `automatico`.
- `docs/investigacion/00-DECISIONES.md:126-128` (29-jul-2026) — el propio
  repo ya escribió: *"Monederos de combustible (Edenred, Efectivale, Broxel):
  la mejor integración de combustible que existe, y hace irrelevantes las 61
  gasolineras cosechadas para el cliente que ya los tenga. **Sin evaluar.**"*

Es decir: el equipo **ya sabía** esto hace seis días, lo escribió, y lo dejó
"sin evaluar". El hallazgo de negocio de hoy no es una noticia nueva para el
repo — es la primera vez que alguien mide qué pasó con esa nota.

**Lo que el código NO tiene, verificado con grep, no por ausencia de mención:**

- **Cero entradas de monedero de combustible.** `comercios.ts` (34 KB, 37+
  entradas) no tiene ninguna fila para Edenred, Efectivale, Broxel ni ningún
  otro monedero. El diésel del 43% del gasto de una flota, si se paga con
  monedero, no tiene ningún camino de código que lo capture.
- **Cero mecanismo de ingesta por correo.** La Decisión #2 del 29-jul
  (`00-DECISIONES.md:24-54`) — *"el mecanismo es un BUZÓN DE CORREO por
  tenant… `facturas-<tenant>@likida.ai`"* — es exactamente el entregable que
  el hallazgo de hoy pide (es agnóstico del emisor: sirve igual para un CFDI
  de CAPUFE que para uno de Edenred), y **no existe en código**. Grep sobre
  `src/` por `correo_facturacion`, `inbound`, `mailgun`, `sendgrid`,
  `postmark`, `webhook.*correo`: cero resultados fuera de comentarios de
  `flota_fiscal.ts` sobre a quién avisar por correo (que es distinto — es
  salida, no entrada).
- **El adaptador más grande escrito esta semana automatiza precisamente la
  porción que el propio registro llama la variante EFECTIVO.**
  `src/lib/cuadra/facturacion/adaptadores/capufe.ts` (61 KB, el archivo más
  grande de todo `facturacion/`) apunta a
  `facturacioncapufe.com.mx/Capufe/facturacionrapida` — la ruta **SIN
  cuenta**, código de 18 caracteres por caseta, que es el camino de quien
  paga la caseta en efectivo o con tarjeta suelta. Una flota de carga federal
  real cruza casetas con IAVE o TAG PASE por velocidad operativa (no se
  detiene a pagar en la caseta), que es justo el 11-de-37 portales que
  `enrutar.ts` manda al humano porque "factura mensual contra la cuenta" — y
  para ESE camino no hay adaptador, ni buzón, ni ingesta: solo el mensaje al
  encargado que ya existía antes de esta semana.

**Conclusión de la verificación: el hallazgo de negocio se sostiene.** No es
una exageración retórica del agente de investigación — es una lectura
correcta de datos que el propio repo ya tenía documentados y no actuó. El
riesgo real no es que el equipo no lo supiera; es que **la inversión de
ingeniería de esta semana (CAPUFE, Playwright genérico, el registro de 37
comercios) fue hacia la porción del problema que el propio repo ya había
marcado como la de MENOR apalancamiento fiscal**, mientras la porción mayor
sigue en el estado de "sin evaluar" de hace seis días. Ver el hallazgo
[CRÍTICO] de abajo con la severidad razonada.

---

## Hallazgos

### [CRÍTICO] El roadmap de facturación no tiene una sola línea dedicada a la porción del gasto que factura sola (monedero + TAG, ~54% según INEGI); toda la ingeniería de la semana fue hacia portales de ticket individual

`docs/investigacion/ROADMAP-INTEGRACIONES.md` (Fase 1-4, completo) ·
`docs/investigacion/00-DECISIONES.md:126-128` · `src/lib/cuadra/facturacion/comercios.ts`
(37 entradas, cero monederos) · `src/lib/cuadra/facturacion/adaptadores/capufe.ts` (61 KB)

Escenario: una flota de 20 unidades usa Edenred para diésel (~43% de su gasto
operativo, INEGI EAT 2024) y TAG PASE para peaje (~11%). Llega a Likida.
`comercios.ts` no reconoce Edenred porque no está en el registro. El diésel
de esa flota nunca entra al flujo de facturación automática — no porque el
adaptador falle, sino porque no existe la fila. El peaje con TAG PASE sí está
reconocido (`comercios.ts:611-619`), pero se enruta a `mensaje` (un humano
captura a mano cada mes) porque el TAG "factura mensual contra la cuenta" —
sin buzón de correo ni agregador, ese CFDI consolidado nunca llega a la base
de Likida salvo que alguien lo reenvíe.

Consecuencia: el 54% del gasto de esa flota queda **fuera del motor fiscal**
—ni cuadrado, ni deducido, ni acreditado— mientras el roadmap documentado
(Fase 1: 13 portales sin cuenta, Fase 2: PINFRA 17 autopistas, Fase 3: los
tres sistemas de Pemex, Fase 4: ControlNet/Polcfdi) sigue prometiendo cubrir
"el gasto de una flota de carga" un portal a la vez. Para la flota del
ejemplo, cubrir sus **46 gastos que quedan** (autoservicio, viáticos,
refacciones) no mueve la aguja fiscal que el contralor de esa flota más va a
preguntar en la demo: "¿y mi diésel?"

**Por qué CRÍTICO y no ALTO:** el criterio del rubro es "8+ si cada cifra
fiscal impresa rastrea a una ficha verificada… 3 o menos si el producto
imprime una cifra fiscal equivocada". Aquí no hay una cifra equivocada — hay
una **cifra que nunca se imprime**, sobre la mayoría del gasto de una flota
real. Un contralor que compra Likida por su promesa fiscal y descubre en el
primer mes que el 54% de su gasto no tiene ni siquiera un intento de CFDI es
un cliente perdido, no un bug que se corrige con una nota de crédito — y es
exactamente el tipo de daño que la escala reserva para 3-4, salvo que aquí el
"3-4" no es de una cifra impresa sino de la cobertura del producto entero
sobre su propia promesa.

**Causa raíz probable:** la Decisión #2 (buzón de correo) y la nota sobre
monederos "sin evaluar" se escribieron el 29-jul y no se convirtieron en un
punto del roadmap de integraciones — el roadmap que sí se escribió esa misma
sesión (`ROADMAP-INTEGRACIONES.md`) lista portales por prioridad y no incluye
ni el buzón ni los monederos en ninguna fase. Sin un punto en el roadmap, no
hay ticket, y sin ticket la ingeniería de la semana fue exactamente adonde el
roadmap apuntaba: portales.

**No es un hallazgo especulativo de "podría pasar".** Es una medición directa
del inventario de código de esta semana contra el inventario del gasto de una
flota real, con la fuente del segundo verificada de forma independiente.

---

### [ALTO] No existe la cláusula que autoriza al sistema a presentar el RFC y los datos fiscales del cliente ante el portal de un tercero para pedir un CFDI a su nombre

`src/app/terminos/page.tsx:57` (lo que SÍ dice) · `src/lib/cuadra/facturacion/flota_fiscal.ts:14-19`
(qué datos se reúnen y para qué) · `src/app/api/cron/facturar/route.ts:199` (el switch real)

`terminos/page.tsx §2` dice: *"Likida no es un despacho contable, ni un PAC,
ni un asesor fiscal. No timbra facturas…"* — eso cubre que Likida no es quien
EMITE el CFDI (correcto: lo emite el portal del comercio, con su propio PAC).
Pero con `FACTURACION_MODO=emitir`, el sistema SÍ toma el RFC, la razón
social, el régimen fiscal, el código postal fiscal y el uso de CFDI del
cliente (`flota_fiscal.ts:14-19`, vía `getDatosFiscales`) y los **presenta
él mismo, sin intervención humana, ante el portal de un tercero** —CAPUFE,
Enerser, OXXO Gas— para solicitar un CFDI en nombre de esa empresa.

Ese acto —usar la identidad fiscal de un tercero ante otro tercero para
gestionarle un documento— es distinto del tratamiento de datos que cubre
LFPDPPP (§6 y §17 de los términos sí lo cubren) y distinto de ser el PAC
(§2 lo descarta correctamente). Es una gestión/representación, y ninguna
sección de `terminos/page.tsx` la autoriza por escrito. §6 dice que Likida
trata la información "por instrucción" de la empresa como encargado del
tratamiento — pero instrucción sobre datos no es lo mismo que facultad para
presentarlos ante un tercero solicitando un acto jurídico (la expedición de
un CFDI) en su nombre.

Escenario: el adaptador de CAPUFE, con `FACTURACION_MODO=emitir` puesto a
mano por alguien de Likida (el default es `ensayo`, ver el hallazgo
verificado abajo), rellena el RFC y régimen fiscal de la flota en el portal
público de CAPUFE y aprieta emitir. Si el CFDI sale con un dato equivocado
—el propio `capufe.ts` documenta que esto puede pasar si el costo del portal
no cuadra con el del ticket, y por eso NO emite en ese caso— la empresa
receptora tiene un CFDI mal emitido ante el SAT a su nombre, generado por un
tercero (Likida) sin que el contrato que firmó diga en ninguna parte "usted
autoriza a Likida a presentar sus datos fiscales ante estos portales para
este propósito".

**Consecuencia:** hoy el riesgo es bajo porque `FACTURACION_MODO` por default
es `ensayo` (verificado abajo) y nada emite sin que alguien de Likida lo
active a mano. Pero el contrato no debería depender de que el switch se
quede apagado — cuando se decida activar `emitir` en producción, el hueco
contractual ya está ahí y nadie lo va a notar porque no rompe nada en el
código: rompe en la sala, con un abogado, si algo sale mal con un CFDI.

**Causa raíz probable:** `terminos/page.tsx` (4-ago-2026, escrito el mismo
día que se cablea el cron de facturación) se modeló sobre usehandle.ai, que
no automatiza portales de terceros con datos fiscales de sus clientes — la
cláusula que este producto necesita no tenía de dónde copiarse.

---

### [MEDIO REINCIDENTE] El plazo de facturación sigue citando el matiz legal ("no es la ley, puedes exigir dentro del ejercicio") solo cuando el plazo del comercio está verificado — y sigue siendo la rama minoritaria

`src/lib/cuadra/cuadre/engine.ts:623-625`

Idéntico a la ronda 9. `cierreComercio` solo lleva el matiz `"(plazo del
portal de X, no de la ley: legalmente puedes exigir la factura dentro del
ejercicio)"` cuando `comercio?.plazoVerificado` es verdadero. La rama sin
verificar sigue diciendo únicamente `", y la ventana del comercio puede ser
menor"` — sin el matiz de que el plazo real de ley es el ejercicio completo.
No conté de nuevo la proporción exacta de comercios sin verificar esta ronda,
pero el mecanismo que la ronda 9 midió (33 de 37) no se tocó: `comercios.ts`
sigue con `plazoVerificado: false` como default declarado a propósito
(`comercios.ts` docstring de `Comercio`), y solo 2 portales en todo el repo
están verificados por factura real (G500, La Gas — confirmado en
`ROADMAP-INTEGRACIONES.md:16-18`).

**Consecuencia:** sin cambios respecto a la ronda 9 — un contralor que lee
"puedes timbrarlo hasta el 31-ago" en la rama sin verificar concluye que
pierde el CFDI el 1-sep, y legalmente no es así.

---

### [MEDIO REINCIDENTE] Un hospedaje de $1 SIN TIMBRAR sigue apagando la advertencia de LISR 28-V sobre una comida sin soporte

`src/lib/cuadra/cuadre/engine.ts:681`

`haySoporte = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto ===
'transporte')` — sin cambios respecto a la ronda 9. Sigue sin comprobar
`cfdiUuid`: un hospedaje de $1 que el propio motor clasifica en `por
confirmar` (porque no tiene CFDI, ver `cubetaDe` en `engine.ts:103-113`)
basta para silenciar la advertencia H1 sobre una comida de $700 sin soporte
real. La ronda 9 marcó esto como MEDIO y no fue parte de los tres ALTOS que
se cerraron esta semana (que fueron: EFOS, tope $750, y el H1b de tarjeta de
crédito — un hallazgo relacionado pero distinto, ver "lo que revisé y está
bien").

---

### [BAJO] `facturacion/permiso_cre.ts` sigue sin un solo consumidor en producción, tercera ronda

`src/lib/cuadra/facturacion/permiso_cre.ts` (verificado con `command grep`,
no el `grep` que salta binarios, sobre todo `src/`) · contraste:
`src/lib/cuadra/cuadre/engine.ts:493` usa el tipo de diferencia
`permiso_cre_no_verificable`, que es un literal de string independiente —
**no** llama a `identificarPorPermiso` ni a nada de `permiso_cre.ts`.

12,625 permisos CRE cosechados y tabulados (88% del padrón), con un método
`identificarPorPermiso` que resuelve marca desde el permiso impreso en el
ticket — la única forma estable de identificar el 46.6% de gasolineras que
son Pemex sin portal centralizado, según el propio comentario del archivo.
Cero llamadas fuera de su propia prueba. Es la misma nota que la ronda 9, sin
movimiento. No es un hallazgo fiscal de cifra —no imprime nada mal— es un
activo de ingeniería fiscal construido y no conectado, adyacente al hallazgo
CRÍTICO de arriba: la inversión de esta semana fue en CAPUFE y no en conectar
esto, que habría ampliado la cobertura de identificación de comercio sin
escribir un adaptador nuevo.

---

## Verificaciones puntuales que pidió esta ronda

**`FACTURACION_MODO`: el default sigue siendo `ensayo`, confirmado en dos
sitios y con prueba dedicada.** `src/app/api/cron/facturar/route.ts:199`:
`process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'` — cualquier
valor que no sea exactamente el string `'emitir'` (incluido `'EMITIR'` en
mayúsculas) cae en `ensayo`. `src/lib/cuadra/facturacion/al_vuelo.ts:161-162`
y `:317-318` repiten el mismo default con el mismo comentario ("El default es
deliberado"). La prueba `route.test.ts:310` se llama literalmente **"EL
DEFAULT ES ENSAYO: el cron no emite CFDI por su cuenta"** y hay una prueba
aparte para el caso `'EMITIR'` en mayúsculas (`:330-335`) que confirma que no
hay lectura floja del valor. Verificado corriendo la suite: las tres pruebas
pasan.

**El rename `monto` → `subtotal` en `facturapi.ts`: correcto en el código
fuente, no solo en la prueba.** `timbrarMensualidad` (`facturapi.ts:144-160`)
recibe `subtotal` (antes `monto`, con JSDoc que decía "Subtotal SIN IVA" pero
el llamador le pasaba el total con IVA incluido — el bug real). Hoy el
parámetro se llama `subtotal`, se manda a Facturapi como `price: subtotal`
con `tax_included: false` (`:191-195`), y se agregó un segundo campo,
`totalEsperado`, que compara el `factura.total` que regresa el PAC contra lo
que el cliente transfirió y lo grita a `logger.error` si no cuadra
(`:207-216`) — porque el CFDI ya existe y no se puede deshacer, solo dejar
rastro para cancelar dentro de las 24h. Verifiqué el lado que llama:
`transferencia.ts:280-325` lee `subtotal`/`iva` **congelados** en
`factura_saas` (no los recalcula al timbrar), se niega a timbrar si
cualquiera de los dos es `null` (`:292`), verifica `desgloseCuadra` antes de
llamar al PAC (`:303`), y pasa `subtotal` y `totalEsperado: total`
correctamente (`:315-325`). Cadena completa correcta, de punta a punta.

**La migración de IVA (`0065_iva_de_la_mensualidad.sql`) y `src/lib/saas/iva.ts`
(sin commitear al momento de escribir esto): el módulo es sólido y quedó
mejor de lo que esperaba encontrar.** El bug que cierra es real y habría sido
CRÍTICO: `emitirMensualidad` guardaba el TOTAL que el cliente transfiere
(`factura_saas.monto`) y `timbrarMensualidad` lo trataba como si fuera la
base SIN IVA — con un plan de $10,000, el cliente transfería $10,000 y el
CFDI salía por $11,600, y un CFDI ya emitido no se puede corregir, solo
cancelar. La migración 0065 fuerza a DECLARAR de qué lado está el IVA
(`plan.precio_iva_incluido`, leído de `tax_behavior` en Stripe, nunca
tecleado) y congela `subtotal`/`iva` en cada factura con un `CHECK` de un
centavo de tolerancia (`factura_saas_desglose_cuadra`). `desglosarPrecio` en
código LANZA si el criterio no está declarado — nunca elige un lado por
default. **Nota sobre el proceso de esta auditoría:** encontré un fallo real
en `iva.test.ts` (un `.toBe()` estricto sobre una suma de punto flotante que
fallaba de forma determinista para `precio=99.99`) y, mientras investigaba
cómo reportarlo, **otra sesión activa en este mismo repo lo corrigió en
tiempo real** — cambió la aserción a `toBeCloseTo(d.total, 9)` y añadió un
caso de borde (`desgloseCuadra` con margen `1e-9` para no confundir ruido de
punto flotante con una desviación real de un centavo) mientras yo tenía el
archivo abierto. Verificado después del cambio: `npx vitest run
src/lib/saas/iva.test.ts` → 20/20 verdes. No toqué este archivo — no era mío
que tocar, y el hallazgo se resolvió solo.

---

## Lo que revisé y está bien

- **Los tres ALTOS de la ronda 9 siguen cerrados, verificados contra el
  código y no contra el commit.**
  - **EFOS presunto/definitivo** (`intake/sat.ts:62-79`): mejor que lo que
    pedía el hallazgo original. `efos` ahora solo puede salir `false` (limpio,
    códigos 200/201) o `null` (cualquier otra cosa, incluidos los presuntos) —
    **nunca `true`** desde este código. Cualquier valor no-limpio cae en
    `efosDesconocido` → bandeja, nunca en "lista negra" con efecto duro. Es
    más conservador que distinguir presunto/definitivo con un tercer estado:
    directamente nunca afirma fraude confirmado.
  - **Tope de $750/día** (`cuadre/engine.ts:800-820`): `montoNoDeducible`
    ahora es estrictamente el exceso de lo TIMBRADO sobre el tope, y la nota
    tiene dos redacciones distintas según si hay o no excedente real — cerró
    tanto el dinero (ronda 8) como la frase (el hueco que dejó abierto la
    ronda 9).
  - **LISR 28-V, tercer párrafo (H1b, tarjeta de crédito)**
    (`cuadre/engine.ts:727-741`): `formaPago !== '04'` sobre comidas amparadas
    solo por transporte, sin hospedaje. Débito no cuenta, que es lo que pide
    la ley.
- **El motor sigue trazando cada cifra a una ficha `normas/*.yaml`.** Revisé
  `lisr-28-V.yaml`, `cff-69-B.yaml` y `rfa-2026-2.9.yaml` contra el código que
  las implementa — las tres siguen `verificado_fuente_primaria` y el texto
  citado en el comentario del código coincide con el de la ficha.
- **`normas_sincronizadas.test.ts` y la suite fiscal, verdes.**
  `npx vitest run src/lib/saas/ src/lib/cuadra/facturacion/
  src/app/api/cron/facturar/` → 339 pruebas, 0 fallos reproducibles (ver nota
  sobre `al_vuelo.test.ts` abajo). `npx tsc --noEmit -p .` sobre los archivos
  de este rubro: limpio.
- **El estímulo de IEPS sigue en litros y nunca en pesos** (`engine.ts`,
  `iepsAcreditable` sigue `const 0`), y **el estímulo de peaje sigue
  condicionado y con tono `'condicionado'`** en `acreditable.ts` — sin
  cambios desde la ronda 9, y siguen correctos.

## Lo que no pude confirmar como reproducible

- **Una prueba de `al_vuelo.test.ts` (el guardia contra el doble CFDI por
  lote) falló UNA vez, en una corrida que incluía muchos archivos de prueba a
  la vez, y no volvió a fallar en tres corridas posteriores del mismo comando
  ni en ninguna corrida aislada del archivo.** El escenario que reportó la
  falla —"si NADIE del lote gana el claim, el navegador nunca se abre"— sí se
  sostiene leyendo el código (`al_vuelo.ts:314-395`: si `tickets.length ===
  0` se retorna ANTES de llamar `facturarLoteConAgente`, y el filtro por
  `ganados.has(gastoId)` va antes de construir `tickets`). No até la causa —
  es compatible con contaminación de estado entre archivos de prueba corridos
  en el mismo proceso de Vitest (mocks con variables de módulo tipo `let
  idsReclamados`), no con un bug del guardia de dinero en sí. Lo dejo anotado
  como propuesto para el rubro de Pruebas y no como hallazgo fiscal, porque
  no lo pude reproducir de forma aislada ni de forma consistente —la regla de
  esta auditoría es no arreglar lo que no se reproduce.
- **Carta Porte.** Sigue sin implementarse (`analytics.ts:241`: "Likida no
  valida Carta Porte todavía"), y la decisión de qué PAC (SW Sapien vs
  Facturapi) sigue pendiente según `00-DECISIONES.md:84-97`. No es una
  regresión — es la misma deuda declarada desde el 29-jul, sin movimiento
  medible esta ronda.
- **El PDF renderizado**, igual que rondas anteriores: verifiqué las
  estructuras de datos que le llegan (`filasDeducibilidad`, `diferencias`),
  no generé el PDF y lo miré.
- **Fichas sin `texto_vigente`** (`cff-29-A`, `rmf-2026-2.7.1.21`, entre
  otras): mismo estado que la ronda 9, no revalidadas.
- **El buzón de correo (`facturas-<tenant>@likida.ai`) como posible mitigante
  parcial del hallazgo CRÍTICO**: confirmé que no existe en código, pero no
  evalué cuánto esfuerzo tomaría construirlo — es una decisión de producto,
  no algo que este rubro deba estimar.
