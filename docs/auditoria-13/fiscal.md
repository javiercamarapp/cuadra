# Cumplimiento fiscal — auditoría 13

**Nota: 6/10** (la ronda 12 cerró en 5→8 en su síntesis; este rubro la deja en
6). Razón del movimiento: **sube del 5 real, y se queda corta del 8 que la
síntesis de la ronda 12 declaró**. Los tres críticos del demo (RFC del seed,
litros del XML 1:1, SAT caído sin verde) están **cerrados de verdad** — los
verifiqué en el código y **medí el motor real con los datos exactos del seed**:
la liquidación del demo sale `deducible 5,600 · IVA 774.48 · peaje 603.45 ·
113 L`, estatus `con_diferencias` con solo la diferencia de $200 de política que
el guion promete. Pero la ronda 13 encontró lo que la 12 no barrió: **el panel
del contador (`fiscal.ts`) contradice el cierre del SAT** — el mismo CFDI que el
motor pone en `por_confirmar` con IVA en cero se imprime ahí como "IVA
acreditable documentado", medido con el módulo real (`resumirFiscal` →
`ivaAcreditable = 137.93` con `estadoSat='pendiente'`). Y el fix de RLISR 57
(2c39d15) quedó **a medias**: la columna `operador.rfc` existe y se lee, pero
**nada en el producto la escribe** — no hay campo en la UI de operadores, ni
`crearOperador` la inserta, ni el seed la siembra; la rama buena sigue
inalcanzable en producción. Eso es lo que separa el 6 del 8.

---

## Hallazgos

### [ALTO] (NUEVO) El panel del contador acredita el IVA de CFDIs cuyo estatus SAT es `pendiente` o `no_encontrado` — el mismo estándar que la ronda 12 fijó para el motor, sin propagar

`src/lib/cuadra/fiscal.ts:488-495` (`ivaSostenible`: solo descarta `cancelado`,
`efos === true` y efectivo sobre tope — **no mira `estadoSat === 'pendiente'`
ni `'no_encontrado'`**) · `fiscal.ts:496-545` (`resumirFiscal` suma
`ivaAcreditable` con ese criterio) · `fiscal.ts:675` (COLUMNAS lee
`estado_sat` pero no lo usa para el IVA) · `src/app/dashboard/contador/
page.tsx:141` ("IVA acreditable documentado" en `KpiTile` con `formato="mxn"`)
· contraste: `engine.ts:84-88` (`cfdi_pendiente` → `POR_CONFIRMAR`) y
`engine.ts:892-895` (`SIN_ACREDITAMIENTO` incluye `cfdi_pendiente`, fix
`3cc8765` de la ronda 12) · `intake/ocr.ts:353` (el SAT se consulta una vez, al
ingresar la foto; el timeout persiste `estado_sat='pendiente'` en la base) ·
**ABIERTO (regresión de cobertura del fix de la ronda 12)**

**Medido con el módulo real** (`resumirFiscal` sobre un `GastoFiscal` con
`cfdiUuid`, `estadoSat: 'pendiente'`, `ivaTraslado: 137.93`, medio de pago
electrónico): `ivaAcreditable = 137.93`, `porValidar = 1`. El motor
(`cuadrarViaje`) sobre el MISMO gasto: `cfdi_pendiente` → `por_confirmar`,
`ivaAcreditable = 0`, estatus `revisar`.

**Escenario:** una tarde con el `ConsultaCFDIService` lento (lo normal en
cierre de mes), 40 CFDIs entran con `estado_sat='pendiente'`. La liquidación
de cada viaje dice "Por confirmar $X" y no acredita IVA — el estándar que la
ronda 12 cerró. Pero el panel del contador, en la MISMA semana, imprime "IVA
acreditable documentado $40,000" en la tarjeta que él cruza contra su
declaración, y el propio panel cuenta esos mismos UUID como `porValidar` — se
contradice a sí mismo en la misma pantalla (`fiscal.ts:539-541` cuenta
`porValidar` y `fiscal.ts:502-506` suma su IVA). Con `no_encontrado` (UUID
fabricado: el motor lo declara NO deducible, `engine.ts:117-119`) el panel
también acredita el IVA y el export al ERP le pone "Sin observación".

**Por qué ALTO:** es la misma familia del ALTO que la ronda 12 cerró (3cc8765)
— "una cifra afirmada en verde sobre un UUID que no se confirmó" —, solo que en
la superficie que alimenta la declaración, no en la del demo. El fix de la
ronda 12 se aplicó al motor y no se propagó a `fiscal.ts`, que es el módulo que
su propio encabezado dice que evalúa "las mismas reglas que el motor"
(`fiscal.ts:24-27`). La frase "documentado" del rótulo atenúa pero no salva: el
número es el que el contador teclea.

### [MEDIO] (NUEVO) El panel del contador no conoce `rfc_receptor`: un CFDI timbrado a un tercero sale "Sin observación" en el export al ERP y con IVA "acreditable"

`src/lib/cuadra/fiscal.ts:675` (COLUMNAS no selecciona `rfc_receptor`) ·
`fiscal.ts:47-91` (`GastoFiscal` no tiene el campo) · `fiscal.ts:301-339`
(`causasDe` no tiene caso para receptor ajeno) · `fiscal.ts:905-922`
(`aFilasExport`: `situacion_fiscal = dominante ? dominante.titulo : 'Sin
observación'`) · contraste: `engine.ts:118-121` (`rfc_receptor` →
`NO_DEDUCIBLE_ISR`) y `engine.ts:890-892` (`SIN_ACREDITAMIENTO`) ·
**ABIERTO**

**Escenario:** flota con RFC `GMX0902279I1`; un CFDI de $11,600 timbrado al RFC
de un tercero. El motor: `rfc_receptor` → no deducible, sin acreditamiento.
El panel del contador (mismo periodo, mismo gasto): el CFDI aparece con su IVA
en `ivaAcreditable` (pasa `ivaSostenible` — no hay forma de que sepa), y el CSV
que el contador importa a su ERP dice `situacion_fiscal = "Sin observación"`.
El export de la liquidación sí reporta la diferencia, pero el export del
periodo —el que va a la contabilidad— afirma lo contrario. Es el mismo gasto
juzgado dos veces, y la superficie del ERP es la que se archiva.

**Causa raíz probable:** `fiscal.ts` se escribió cuando `rfc_receptor` no se
validaba (la época del genérico); el motor aprendió el tercer estado y el
rechazo duro, y este módulo no se actualizó. La nota de `LIMITES`
(`fiscal.ts:950-966`) no declara esta omisión — declara lo que NO hace por
elección, y esto no está en esa lista.

### [MEDIO] (CIERRE A MEDIAS DE LA RONDA 12) RLISR 57: la columna `operador.rfc` existe y se lee, pero nada la escribe — la rama buena sigue inalcanzable en producción

`supabase/migrations/0080_operador_rfc.sql` (columna agregada) ·
`src/lib/cuadra/cuadre/desde_db.ts:44-51` (lee `operador?.rfc` y lo pasa) ·
`engine.ts:390-396` (la rama buena exige `input.operadorRfc`) ·
`src/lib/cuadra/administracion.ts:171-190` (`crearOperador` **no inserta
`rfc`**) · `src/app/dashboard/operadores/page.tsx` (no tiene campo RFC; el
único llamador de `crearOperador`) · `grep -rn "from('operador')" src/` → cero
escrituras de `rfc` en todo el árbol (los únicos `.insert`/`.update` sobre
`operador` son `crearOperador` y `reasignarOperador`, ninguno toca `rfc`) ·
`supabase/seed.sql:38-44` (los 5 operadores del demo sin `rfc`) ·
**ABIERTO (el fix de 2c39d15 está a medias)**

**Escenario:** flota con hotel de $2,000 timbrado al RFC del operador
(`CAPJ800101AA1`), XML verificado, receptor de la flota bien configurado. El
motor emite `viatico_rfc_operador` → estatus `revisar`, con la nota "…captura
su RFC para confirmarlo" (`engine.ts:396-398`). El flota_admin abre la
pantalla de operadores: **no hay campo donde capturarlo**. La única forma de
escribir `operador.rfc` es SQL directo contra la base. El fix de la ronda 12
movió el dato de "inexistente" a "sin escritor": la prueba de `engine.test.ts`
pasa porque inyecta `operadorRfc` directo en la función pura — el camino de
producción (`cuadrarDesdeDB` → `getOperador` → `operador.rfc`) siempre recibe
`undefined`. El caso normal de una flota (viático a nombre del chofer) sigue
tiñendo de "Por revisar" liquidaciones correctas, y el guion de la pantalla
promete una acción que no existe.

### [MEDIO] (REINCIDENTE, verificada de nuevo) La válvula del 15% de la RFA 2.9 se ofrece a cualquier tenant: no se captura régimen ni dedicación, y el aviso las da por cumplidas

`src/lib/cuadra/cuadre/engine.ts:352-361` (la nota de `combustible_efectivo`
"cuenta contra el tope del 15%… dentro del 15% SIGUE SIENDO DEDUCIBLE") ·
`src/lib/cuadra/periodo/aviso.ts:27-31` ("te quedan $X antes de perder la
deducción") · `src/app/dashboard/contador/combustible/page.tsx:161`
("Todavía caben $X de combustible en efectivo") · `src/lib/cuadra/config.ts:
44-51,93-99` (`estimulos` sin régimen ni dedicación) · `grep -rn
"regimen\|dedicacion\|exclusiv" src/lib/cuadra/config.ts src/types/cuadra.ts`
→ cero · ficha `normas/rfa-2026-2.9.yaml` (verificado_fuente_primaria:
"Dedicados EXCLUSIVAMENTE al autotransporte terrestre de carga federal" ·
"Tributar en Título II Cap. VII (coordinados) o Título IV Cap. II Secc. I") ·
**ABIERTO**

Sin cambios desde la ronda 12: un tenant en régimen general —o cualquier
tenant que aún no declara, que es el estado de todos hoy— recibe la nota
"cuenta contra el tope del 15%… SIGUE SIENDO DEDUCIBLE" y, con datos, el aviso
en pesos "te quedan $35,294.11 antes de perder la deducción". Para esa flota
ambas frases son falsas en direcciones opuestas: le promete una deducción que
sin la facilidad no tiene, y le autoriza a gastar más efectivo que para ella no
deduce. El numerador/denominador del contador además arrastra el hallazgo BAJO
de abajo (filtro por `concepto='diesel'`).

### [BAJO] (REINCIDENTE, 3ª ronda) `precioDieselPorDefecto` vive en `tabulador` y el motor lo busca en `estimulos`: la banda anti-decimal-corrido siempre usa el literal 27.0

`src/lib/cuadra/config.ts:74` (vive en `tabulador`) ·
`src/lib/cuadra/cuadre/engine.ts:972`
(`input.estimulos?.precioDieselPorDefecto ?? 27.0`) ·
`src/lib/cuadra/cuadre/desde_db.ts:53` (`estimulos: config.estimulos`, donde
el campo no existe) · `src/app/dashboard/configuracion/page.tsx:86` (el panel
enseña `config.tabulador.precioDieselPorDefecto`, "en uso") ·
**ABIERTO**

El tenant que captura `precioDieselPorDefecto: 14.0` (diésel subsidiado por
contrato) calibra la banda 0.5×–2× con 27.0: un ticket de $5,400 leído como
760 L (OCR corrió el decimal de 76.0) da razón 3.8 contra 27.0 →
`diesel_desviacion`; con su precio la razón sería 1.97 y los litros pasarían.
La configuración enseña un valor que el motor no usa.

### [BAJO] (REINCIDENTE) El denominador del 15% filtra `concepto = 'diesel'` mientras el motor define combustible con dos criterios

`src/lib/cuadra/repo.ts:825-827` (`.eq('concepto', 'diesel')`) contra
`src/lib/cuadra/cuadre/engine.ts:324`
(`g.concepto === 'diesel' || h.claves.includes(g.claveProdServ)`) · ficha
`normas/rfa-2026-2.9.yaml` · **ABIERTO**

Combustible capturado como `otro`/`factura` (p. ej. XML pegado a un ticket que
el OCR clasificó distinto) queda fuera del numerador **y** del denominador:
$150,000/año omitidos hacen parecer holgada a una flota que ya va en 14.1% del
total real, o al revés. El motor por viaje sí lo cuenta; el contador del
ejercicio no. (Nota: `fiscal.ts:tope15DeGastos` sí usa los dos criterios —
`fiscal.ts:281-284` —, así que dentro del panel del contador la cifra del 15%
depende de cuál de las dos funciones la produzca; `getAcumuladoCombustible` y
`tope15DeGastos` pueden divergir sobre el mismo ejercicio.)

### [BAJO] (REINCIDENTE, 4ª ronda en master) `facturacion/permiso_cre.ts` sigue sin un solo consumidor en producción

`src/lib/cuadra/facturacion/permiso_cre.ts` (verificado con grep sobre `src/`;
cero llamadas fuera de su propia prueba) · contraste:
`src/lib/cuadra/cuadre/engine.ts:1055` usa el literal
`permiso_cre_no_verificable`, que **no** llama a `identificarPorPermiso`.
12,625 permisos CRE tabulados y el motor sigue emitiendo "permiso CRE no
validado" en todo CFDI de diésel con XML. La ronda 12 documentó la decisión de
conservarlo (roadmap Pemex Fase 3); el hallazgo sigue abierto como activo sin
conectar.

### [BAJO] (REINCIDENTE) El seed declara `xml_verificado=true` para la caseta del demo sin guardar su XML (CFF 30)

`supabase/seed.sql:130-133` (la caseta: `xml_verificado=true`, `estado_sat=
'vigente'`, sin fila en `cfdi_xml`) contra `seed.sql:135-143` (el diésel sí
guarda su XML crudo). El diesel cumple la conservación de 5 años del CFF 30; la
caseta afirma una verificación que no tiene respaldo almacenado. Es dato de
demo marcado INVENTADO — no bloquea la proyección —, pero la columna
`xml_verificado` significa "se recibió y parseó el XML", y aquí se siembra un
`true` sin XML. Si mañana alguien reenvía el XML de esa caseta, `processor.ts:
1422` lo emparejaría por UUID y `updateGastoCfdiXml` le sobreescribiría fecha
y monto con los del XML — que no existe. **ABIERTO (BAJO, solo datos del demo)**

---

## Verificaciones puntuales que pidió esta ronda (cierres de la ronda 12)

**RFC del seed (CRÍTICO de la 12, `8fc7e79`) — CERRADO y medido con el motor
real.** `seed.sql:26` siembra `GMX0902279I1`, que **pasa el dígito verificador**
(lo verifiqué con el algoritmo exacto de `cfdi.ts:rfcChecksumOk`, incluida la
excepción del alfabeto con `&`/`Ñ` y el espacio=37; `GMX0902279I1` → true,
`TIN010101AAA` → false). Corrí `cuadrarViaje` con los dos gastos exactos del
seed (diésel $4,200 con `ocr_extra.litros=113`, caseta $1,400), política del
seed, `empresaRfc=GMX0902279I1`, `estimulos` de `DEMO_CONFIG`, anticipo
$10,600:

```
estatus con_diferencias · comprobado 5,600 · deducible 5,600 · noDed 0 ·
porConfirmar 0 · IVA acreditable 774.48 · peaje 603.45 · litros 113
diferencias: sobre_politica ($200, la del guion) · permiso_cre_no_verificable
(informativo, no baja estatus) · anticipo ($5,000 hasta que lleguen las fotos
en vivo)
```

Es exactamente la sección fiscal que el guion promete. La validación de
receptor está encendida (el RFC del seed es válido) y los dos gastos salen
deducibles. Cierre verificado.

**Litros del XML 1:1 (ALTO de la 12, `f61341f`) — CERRADO y verificado.**
`cfdi_xml.ts:208-211` lee `@_Cantidad` en el camino 1:1 y la expone en
`CfdiXmlData.cantidad` (`:295`); `processor.ts:1469-1470` hace nacer el gasto
con `ocrExtra.litros`; `repo.ts:404-418` MERGEA la cantidad del XML sobre
`ocr_extra` sin pisar `producto/estacion` (lectura+fusión+escritura). El
comentario viejo de `engine.ts:951-953` ("el XML del CFDI no siempre trae la
cantidad…") quedó obsoleto en parte pero la decisión sigue correcta: el XML es
la verdad de referencia y el OCR es el respaldo. La prueba nueva del parser
pasa, y mi medición del demo confirma 113 L hasta el panel.

**SAT caído sin verde (ALTO de la 12, `3cc8765`) — CERRADO en el motor, y ese
cierre es justo el que no se propagó (ver el ALTO de esta ronda).** En
`engine.ts`: `cfdi_pendiente` está en `POR_CONFIRMAR` (`:84-88`) y en
`SIN_ACREDITAMIENTO` (`:890-895`); la prueba `engine.test.ts:112-126` ("SAT
pendiente NO tumba… y NO se afirma deducible", con `ivaAcreditable` en 0)
existe y pasa. El hueco está en `fiscal.ts`, que no recibió el estándar.

**Peaje con reserva en todas las superficies (ALTO de la 12, `2c39d15`) —
CERRADO, verificado por grep en todo `src/`.** `[id]/page.tsx:260` (`Tot …
nota="Sujeto a elegibilidad"`, renderizada en `:399`), `chat.tsx:41`
("…— sujeto a elegibilidad."), `resumen.ts:96` ("(sujeto a elegibilidad)"),
`politicas/page.tsx:276` ("…, sujeto a elegibilidad"). El PDF sigue con su
`CONDICIONES_ESTIMULO_PEAJE` (`acreditable.ts:62-66`) y el tono `condicionado`
→ tinta neutra (`pdf.ts:342-348`). Ninguna superficie afirma el peaje a secas.

**RLISR 57 (MEDIO de la 12, `2c39d15` + `0080`) — CIERRE A MEDIAS (ver el
MEDIO de esta ronda).** La columna existe y `desde_db.ts:44-51` la lee; pero no
hay escritor en el producto.

**El resto de lo que la ronda 12 dio por cerrado y verifiqué intacto:** el
candado de mandato (`modo.ts:70-83` + `route.ts:257` + `al_vuelo.ts:242,424`,
doble candado), el desglose de IVA de la mensualidad (`saas/iva.ts:
desglosarPrecio` lanza con criterio `null`; `transferencia.ts:292-306` exige
`subtotal`/`iva` congelados; `facturapi.ts:213-216` compara `totalEsperado`),
el EFOS que nunca afirma fraude (`sat.ts:76-90`, solo `false`/`null`), el JOIN
del consolidado con su cola resoluble (`intake/consolidado.ts`, sin cambios),
las migraciones 0078/0079/0080 presentes en master, y `npx tsc --noEmit` limpio.

## Lo que revisé y está bien (el resto del camino del dinero)

- **El motor corre el demo exacto del seed y produce las cifras del guion**
  (medición arriba): deducible 5,600, IVA 774.48, peaje 603.45, 113 L, y la
  única diferencia de política es la de $200 del diésel. La sección fiscal que
  la ronda 12 reportó VACÍA ahora está entera.
- **`cubetaDe` y las tres cubetas siguen sumando el comprobado** con el portón
  de `deducibilidad.ts:52-57` (si no cuadra, no se imprime el desglose).
- **El acreditamiento sigue en proporción a lo deducible** (LIVA 5-I,
  `engine.ts:919-921` consume `proporcionDeducible`), con `iepsAcreditable`
  fijo en 0 y la base del peaje en subtotal SIN IVA con su nota al pie
  (`BASE_ESTIMULO_PEAJE`).
- **El permiso CRE informa, no baja estatus**: `permiso_cre_no_verificable`
  quedó fuera de `REVISAR` (`engine.ts:1066-1074`) y fuera de `SIN_ACREDITAMIENTO`,
  y `deducibilidad.ts:66-72` lo imprime como tono `condicionado` ("Deducible
  para ISR — sujeto a permiso CRE vigente"). El viaje del demo no cae a
  `revisar` por esta causa.
- **Los litros del diésel pasan la banda anti-decimal-corrido** en el demo:
  113 L vs 4,200/27 = 155.6 esperados → razón 0.73, dentro de 0.5×–2×.
- **El export del periodo (`fiscal.ts`) es fail-closed**: `traerTodo` con
  `conteo` exacto, y `getAcumuladoCombustible` lanza si no leyó todo
  (`repo.ts:844-849`).
- **No hay `toLocaleString('es-MX')` fuera de `formato.ts`** (grep sobre todo
  `src/`; las dos ocurrencias son comentarios).
- **El cron de facturación** conserva el corte por reloj
  (`route.ts:412`: `PRESUPUESTO_LOTE_MS - MARGEN_LOTE_MS` = 150 s de margen
  sobre `maxDuration` 300) y el modo `emitir` degrada a `ensayo` sin el mandato.
- **Pruebas del rubro, verdes**: `engine` (107), `cfdi_xml` (17),
  `liquidacion` + `periodo` + `saas` + `modo` + `guion_demo` (196),
  `diesel_estimulo` + `fiscal` + `repo_acumulado` + `rfc_dv` (77) → ~400
  pruebas, 0 fallos. `tsc --noEmit` limpio.

## Lo que no alcancé a revisar

- **El PDF renderizado**: verifiqué estructuras y tonos (`pdf.ts:295,348`),
  no miré el papel.
- **El prompt del OCR y la clasificación de concepto** (`intake/ocr.ts`,
  `decidir.ts`, `emparejar.ts`): deciden qué regla fiscal aplica.
- **La ventana temporal del contador del 15%** (año natural vs transitorio de
  la RFA) y la interpretación del excedente: sin fuente, no dictamino.
- **La suite completa** (3,132 pruebas): otro auditor puede estar corriéndola;
  corrí solo lo de mi rubro (~400).
- **`diagnosticoRetencion`** (`fiscal.ts:642-696`): lo declaré fuera de
  alcance, no lo audité a fondo.
- **El barrido fino de RLS** es del rubro seguridad; solo verifiqué que las
  migraciones 0078/0079/0080 estén en master.

## Veredicto

**Green light para el demo en su parte fiscal — la sección que la ronda 12
encontró vacía está entera y medida.** Los tres críticos de la ronda 12 se
sostienen en el código que corre hoy, la liquidación del demo sale con las
cifras del guion (medido con el motor real, no leyendo commits), y el motor
sigue fallando cerrado. La nota sube del 5 al 6 porque el cierre del SAT no se
propagó al panel del contador (ALTO: IVA "acreditable documentado" sobre UUID
`pendiente`/`no_encontrado`, la superficie que alimenta la declaración) y el
fix de RLISR 57 quedó a medias (MEDIO: la rama buena sigue sin escritor). Son
dos deudas de la misma familia —el estándar "nunca afirmar sin verificar" no
cubre todo el árbol—, y ninguna de las dos toca la pieza que se proyecta
mañana. Lo que sí toca el demo —el RFC del seed, los litros, el peaje con
reserva— está cerrado, verificado y medido. Las condiciones antes de
proyectar, si se quiere: nada nuevo en fiscal; el ALTO del contador es trabajo
de la semana siguiente, no de la noche de hoy.
