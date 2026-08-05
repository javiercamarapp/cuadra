# Cumplimiento legal — auditoría 10

**Nota: 6/10** (antes 4). Razón del movimiento: **se atacó y subió** — el
CRÍTICO y el ALTO de la ronda 9 cerraron de verdad, verificado por mí
corriendo el código (no solo leyendo el commit): `foto_no_expuesta.test.ts`
(2/2 verdes) y un arnés propio de cuatro casos contra `pideAtencionPrivacidad`
(4/4 correctos, incluido el negativo que debe seguir dando `false`). Lo que
frena la nota más arriba es un hallazgo **nuevo**, no reincidente: el ToS que
se publicó **hoy mismo** (`70d8744`, 4-ago-2026) le promete al cliente que
"Likida no timbra facturas", mientras el código —ya construido, ya probado,
apagado por una sola variable de entorno— sabe entrar a portales de
autofacturación de terceros y apretar el botón que crea un CFDI real con los
datos fiscales del cliente, sin que ningún papel autorice esa actuación.

El riesgo mayor hoy: nadie conectó la redacción del `/terminos` de esta mañana
con lo que `agente.ts`/`al_vuelo.ts`/`route.ts` ya saben hacer desde hace
varias rondas. Verifiqué que la función sigue apagada en producción
(`vercel env ls production`, sin rastro de `FACTURACION_MODO`), así que hoy no
hay violación activa — pero la distancia entre "cierto" y "falso" en ese
párrafo del contrato es una variable de entorno, no una revisión legal.

## Hallazgos

### [ALTO] El ToS de hoy dice "no timbra facturas"; el código ya sabe entrar a un portal de terceros y apretar el botón que crea un CFDI real con los datos del cliente, sin cláusula que lo autorice

`src/app/terminos/page.tsx:57` (§2, publicado hoy, commit `70d8744`) ·
`src/lib/cuadra/facturacion/agente.ts:10-21` · `src/lib/cuadra/facturacion/adaptadores/capufe.ts:233-242`
· `src/app/api/cron/facturar/route.ts:75,199` · `.env.example:196-209` ·
`src/lib/cuadra/facturacion/al_vuelo.ts:46` · `src/app/dashboard/suscripcion/page.tsx:319-327`
· `src/lib/cuadra/facturacion/flota_fiscal.ts:14-19`

**Lo que dice el texto legal, hoy.** `/terminos` §2 ("Qué es Likida y qué
no es"), la página que la flota acepta al usar el servicio:

> "**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No
> timbra facturas, no presenta declaraciones, no dictamina estados financieros
> y no sustituye al contador de la empresa. Lo que entrega es un documento de
> trabajo, y así hay que tratarlo." (`terminos/page.tsx:57`)

Es una afirmación sin matiz: dice que Likida no participa en absoluto en que
se genere una factura real.

**Lo que el código ya sabe hacer.** `agente.ts:10-21` documenta dos modos:

> "`ensayo` → navega, llena TODOS los campos, captura la pantalla y SE DETIENE
> antes del botón de emitir. [...] `emitir` → hace lo mismo y aprieta. Existe
> porque apretar ese botón CREA UN CFDI REAL ante el SAT y no se deshace."

`capufe.ts:233-242` confirma que los campos que se llenan son
`receptor.regimenFiscalReceptor` y `receptor.usoCfdi` — el CLIENTE es el
receptor del CFDI, el proveedor (CAPUFE, la gasolinera) es quien timbra con su
propio PAC. Eso hace cierto, en sentido estricto, que "Likida no es un PAC"
(§16 lo dice bien). Pero no hace cierto "no timbra facturas": el bot de
Likida es quien entra al portal del tercero, quien escribe el RFC del cliente
en el campo del receptor, y quien —en modo `emitir`— aprieta el botón que
produce el documento. Es un acto de representación ante un tercero, no de
certificación; ser fiel a "quién certifica" no exime de ser fiel a "quién
actúa".

**El interruptor es una variable de entorno, no una revisión legal.**
`route.ts:199`: `const modo = process.env.FACTURACION_MODO === 'emitir' ? ... : 'ensayo'`.
`.env.example:200-208` es explícito: el default es `ensayo` "A PROPÓSITO", y
`emitir` "es una decisión que se toma a mano en el ambiente, nunca desde el
código". La única compuerta contra emitir sin que un humano haya visto ESE
ticket es `CONFIANZA_MINIMA_AUTOFACTURA = 0.9` (`al_vuelo.ts:46`) — un umbral
del OCR, corriendo dentro de un cron por hora (`route.ts`), no una aprobación
humana del ticket concreto.

**Verifiqué el estado real, no asumí.** `vercel env ls production` (corrido
por mí, 4-ago-2026) lista 24 variables en Production; `FACTURACION_MODO` no
está entre ellas, así que hoy el cron corre en `ensayo` por default —
confirmado también por los 18/18 tests de `route.test.ts`, que corrí. **No
hay una violación activa hoy.** El hallazgo es que el texto y el código ya no
están de acuerdo sobre lo que el sistema puede hacer, y lo único que falta
para que la discrepancia se vuelva real es que Javier decida activarlo — la
decisión que él mismo tiene pendiente.

**El hueco no es solo de redacción: la captura del dato tampoco avisa.** La
ÚNICA pantalla donde la flota entrega su RFC, razón social, régimen fiscal,
código postal y uso de CFDI es `/dashboard/suscripcion`
(`suscripcion/page.tsx:319-327`), y dice, con estas palabras exactas:

> "Datos para tu factura [...] **Con estos se emite el CFDI de cada
> mensualidad.**"

Es decir: la flota captura esos cinco datos leyendo que sirven para UNA cosa
(la factura de su propia suscripción a Likida). `flota_fiscal.ts:14-19`
confirma que `getFiscalDeFlota` — la función que arma lo que se llena en el
portal del tercero para el autofactura de gastos de viaje — **relee esas
mismas cinco columnas de `tenant`** vía `getDatosFiscales`
(`saas/fiscal.ts`). El mismo dato, capturado bajo una finalidad declarada,
alimenta en silencio una segunda finalidad que la propia pantalla no
menciona.

**Escenario, con valores.** Hoy, "Transportes Innovativos" entra a
`/dashboard/suscripcion`, lee "Con estos se emite el CFDI de cada
mensualidad", captura su RFC y firma el ToS que dice "No timbra facturas". El
día que Javier active `FACTURACION_MODO=emitir` — sin tocar código, sin volver
a `/terminos`, sin volver a `/dashboard/suscripcion` — el cron toma el
próximo ticket de caseta con confianza OCR ≥0.9, abre Chromium, escribe el RFC
de Transportes Innovativos en `receptor.rfc` de `facturacioncapufe.com.mx` y
aprieta "Facturar". Nadie de la flota vio ese ticket en particular antes de
que el CFDI naciera, y el contrato que firmaron dice que eso no pasa.

**Consecuencia.** *Para el cliente:* un documento fiscal real e irreversible
—cancelarlo fuera de plazo "se le queda en su contabilidad", como el propio
código advierte— aparece en su nombre usando datos que entregó bajo una
finalidad distinta a la que se usó. *Para Likida:* el ToS firmado dice, en
palabras que un operador o su abogado pueden citar textualmente, que esto no
ocurre — la misma clase de contradicción que costó el CRÍTICO de la ronda 9,
ahora en el documento que sí es un contrato y no un aviso.

**Refutación que intenté.** ¿Basta con que §16 ya aclare que Likida "no es un
PAC" para cubrir esto? No: §16 habla de quién CERTIFICA el CFDI de la
liquidación (correcto, es el PAC del proveedor), no de quién ACTÚA para
producirlo. Son dos preguntas distintas y el ToS solo contesta la primera.
¿El hecho de que hoy el modo sea `ensayo` cierra el hallazgo? No: lo que hace
`ensayo` es posponer el momento en que el texto se vuelve falso, no evitarlo
— y activar `emitir` no pasa por ninguna revisión de este texto, solo por una
variable de entorno. ¿La captura de datos fiscales en `/dashboard/suscripcion`
ya es consentimiento genérico para cualquier uso fiscal futuro? No: la propia
pantalla acota la finalidad con sus palabras ("de cada mensualidad"), el mismo
principio de finalidad específica que `privacidad.ts` ya aplica en otros
lugares del producto (finalidades necesarias vs. no necesarias) — extenderla
sin decirlo repite, con datos fiscales de empresa, el patrón que costó el
CRÍTICO de la ronda 9 con datos personales de operador.

**Causa raíz.** `/terminos` se escribió describiendo el producto de HOY (con
la autofactura apagada) en presente absoluto, sin la salvedad de que existe
una función ya construida y probada que, activada, sí provoca la emisión de
un CFDI real ante un tercero usando los datos del cliente. Quien redactó el
ToS no cruzó el texto contra `agente.ts`/`al_vuelo.ts`/`flota_fiscal.ts`.

**No es reincidente** — `/terminos` no existía antes de hoy.

---

## Lo que revisé y está bien

- **El CRÍTICO de la ronda 9 (foto del ticket expuesta al contralor) cerró de
  verdad.** El botón "Ver foto" salió de `dashboard/[id]/page.tsx` en
  `b99b0fe`, y queda un guardarraíl activo: corrí
  `src/app/dashboard/foto_no_expuesta.test.ts` yo mismo — 2/2 verdes, y falla
  si alguien reintroduce el enlace o vuelve a importar `ligaComprobante` en
  esa página.
- **El mismo criterio se extendió por cuenta propia a una función nueva, sin
  que yo lo pidiera.** `dashboard/pod/page.tsx:20-29` (POD, entregas): la
  foto de prueba de entrega tampoco se enseña en un clic, citando
  explícitamente "la misma decisión que ya se tomó con los comprobantes
  (auditoría 9, crítico legal)" y LFPDPPP art. 8. Es la señal más fuerte de
  que el principio de CLAUDE.md ("conservar un comprobante no es lo mismo que
  exhibirlo") se institucionalizó y no fue un parche de una sola vez.
- **El ALTO de la ronda 9 (oposición real perdida por `OBJETO_DE_PAPEL`) cerró
  de verdad.** `privacidad.ts:336` agregó `RECHAZA_AUTOMATIZADO`. No confié en
  el test del repo: escribí y corrí mi propio arnés contra los tres casos que
  la ronda 9 documentó como falsos negativos más el caso negativo original —
  4/4 correctos (`quiero que una persona revise mi comprobante en vez del
  programa` → `true`; `que revise una persona el folio porque el sistema lo
  leyó mal` → sigue en `false`, sin regresión).
- **Una pregunta abierta de la ronda 9 quedó contestada: el PDF no expone la
  foto.** Leí `src/app/api/export/pdf/[id]/route.ts` completo: el único
  `createSignedUrl` que hace es sobre el bucket `liquidaciones` (el PDF
  mismo), nunca sobre `comprobantes`. El segundo canal de salida que la ronda
  9 dejó sin medir no existe.
- **Acceso del propio operador a su foto, razonado correctamente.**
  `chofer.ts:misComprobantes` / `chofer/comprobantes/page.tsx` (función
  nueva): el chofer ve SUS propios comprobantes con liga firmada de 600 s. El
  comentario del código distingue explícitamente esto del caso de la ronda 9
  — "aquí el que mira es el TITULAR de esos datos [...] derecho de acceso,
  LFPDPPP art. 22" — y está detrás de `requireOperador` con el query acotado a
  `tenant_id` + el viaje propio. Es la distinción correcta entre exhibir a un
  tercero y dejar ver a su titular.
- **La retención de 5 años (CFF art. 30) sigue respetada.** El cron nuevo
  `src/app/api/cron/purgar/route.ts` (mig. 0072) solo borra
  `wa_mensaje_procesado` a los 30 días — una tabla de idempotencia sin
  `tenant_id`, no atribuible a ninguna flota — y explícitamente NO purga
  `llm_costo` ni toca el bucket `comprobantes`. Leí la ruta completa: no hay
  ningún camino nuevo que acorte la ventana de 5 años que `privacidad.ts:507`
  le promete al operador.
- **No hay ningún lenguaje de mandato en ningún lugar del sitio legal**
  (`command grep -rn "mandato|apoderad|en nombre de|autoriza a Likida a
  actuar" src/app/terminos/ src/app/legal/ src/app/privacidad/ src/app/aviso/`
  → vacío) — confirma que el hueco del hallazgo de arriba es total, no algo
  que esté parcialmente cubierto en otra sección que se me haya escapado.
- Los datos pendientes del ToS (razón social, domicilio, jurisdicción,
  precios, §5/§9/§17/§19, marcados con 🔴) siguen sin capturarse — pero
  **se declaran**, no se rellenan con datos inventados
  (`legal/marco.tsx:44-53`, `FaltaDato`). Es el mismo criterio correcto que
  ya usa el aviso integral.
- Corrí `npx vitest run src/app/dashboard/foto_no_expuesta.test.ts
  src/app/api/cron/facturar/route.test.ts` — 20/20 verdes contra HEAD.

## Lo que NO alcancé a revisar

- El contrato de encargado del tratamiento entre Likida y la flota (LFPDPPP,
  Regl. arts. 54-55) sigue sin vivir en el repo — mismo estado que las rondas
  8 y 9. El propio §17 del ToS ya lo marca: "El contrato de encargado del
  tratamiento está pendiente de firma." No profundicé más allá de confirmar
  que sigue ausente.
- El pendiente de "confirmar el régimen de retención de OpenRouter"
  (`docs/conocimiento/52-anexo-subencargados.md`) — no se tocó esta ronda, no
  verifiqué si hay respuesta fuera del repo.
- Las pantallas nuevas de cobro por transferencia SPEI (`LIKIDA_CLABE`,
  `LIKIDA_BANCO`, `LIKIDA_BENEFICIARIO`) y el timbrado de la mensualidad vía
  Facturapi: confirmé que es un circuito separado del de autofactura de
  gastos (Likida facturándose a sí misma su propio servicio, no actuando ante
  un tercero por cuenta del cliente), pero no audité a fondo sus
  implicaciones de protección al consumidor.
- Un fuzzing más amplio de `RECHAZA_AUTOMATIZADO` contra más variantes del
  contraste programa/persona — solo verifiqué los cuatro casos puntuales que
  la ronda 9 dejó documentados.
- Si existe, fuera del repo, algún documento o cláusula que Javier ya haya
  discutido con un abogado sobre la automatización de portales de
  autofactura. Documenté el hueco tal como vive HOY en el código y en el
  sitio; no es asesoría legal ni una cláusula lista para pegar — es la
  decisión de Javier si se escribe esa cláusula antes de activar
  `FACTURACION_MODO=emitir`, o si el modo se queda en `ensayo` hasta que
  exista. Una variable de entorno no debería ser lo único que separa el
  texto legal de hoy de dejar de ser cierto.
