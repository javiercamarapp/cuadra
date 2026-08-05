# Cumplimiento fiscal — auditoría 12

**Nota: 5/10** (auditoría 10 cerró en 6/10 con sus arreglos; auditoría 11 cerró
en 6/10 sobre su propia rama). Razón del movimiento: **baja, y la causa es un
hecho de git, no una regresión del motor.** Casi todos los arreglos fiscales que
la auditoría 11 documentó como CERRADOS —medidos en su rama (`origin/claude/
auditoria-11`, anclada al PR #8)— **nunca llegaron a `master`**. Verifiqué uno
por uno: `992045b`, `0492635`, `fe31209` y `989ca62` (el commit que "trae a
master los arreglos de la ronda 10 que no chocan con nada") **no son ancestros
de `master`**. Lo único que la ronda 11 dejó en master es `ce9abab` (RLS 0078).
El resultado: tres hallazgos ALTO/MEDIO que esa ronda reportó como cerrados
siguen **abiertos en el código que corre hoy**, y dos de ellos le pegan a la
demo de mañana en el centro fiscal del guion.

Lo que sí está intacto y lo verifiqué corriendo el motor real, no leyendo
commits: el candado de mandato (`modo.ts`), el desglose de IVA de la mensualidad
(frozen subtotal/iva + `totalEsperado`), el EFOS que nunca afirma fraude, la
migración RLS 0078, el JOIN del consolidado (0076/0077) y el matiz legal del
plazo en las dos ramas. Eso es lo que evita que la nota caiga más abajo.

**El riesgo mayor del rubro, hoy:** la liquidación del demo —la pieza central
del guion del 6-ago— sale con **$0 deducibles, $0 de IVA, $0 de peaje y 0
litros** por una sola razón: `seed.sql` sigue sembrando el RFC inválido
`TIN010101AAA` (falla nuestro propio dígito verificador) en el tenant, en los
dos gastos y en el XML. Lo medí con el motor real. La auditoría 11 lo había
corregido a `TIN010101AA5` en su rama; `master` no lo recibió.

---

## Hallazgos

### [CRÍTICO] El seed del demo siembra un RFC que falla el dígito verificador (`TIN010101AAA`), y con él la liquidación del demo sale `por_confirmar` entera: $0 deducibles, $0 IVA, $0 peaje, 0 litros

`supabase/seed.sql:26` (tenant.rfc) · `seed.sql:125,128` (rfc_receptor de los
dos gastos) · `seed.sql:135` (Receptor@Rfc del XML) ·
`src/lib/cuadra/cuadre/engine.ts:188-196` (`rfcsOk` filtra con
`rfcChecksumOk`) · `engine.ts:228-231` (`rfcEmpresaInservible`) ·
`engine.ts:358-360` (`rfc_receptor_no_verificable` → `POR_CONFIRMAR`,
`engine.ts:86`) · `GUION_DEMO.md:163-164` (exige un RFC válido)
· `normas/rlisr-57.yaml` (verificado_fuente_primaria) · **NUEVO en master**
(arreglado en la rama de auditoría 11, nunca fusionado)

`seed.sql:26` sigue sembrando `'TIN010101AAA'` con el comentario
`-- 🔴 INVENTADO: RFC real de Innovativos`. Corrí el algoritmo de
`cfdi.ts:rfcChecksumOk` contra él: **`TIN010101AAA` falla** (esperado `5`, tiene
`A`); `TIN010101AA5` pasa. La auditoría 11 lo midió igual y corrigió las cuatro
apariciones en su rama — `master` conserva las cuatro.

**Medido con el motor real (vite-node, `cuadrarViaje` con los dos gastos
exactos del seed, anticipo $10,600, `DEMO_CONFIG`):**

```
empresaRfc = TIN010101AAA   → estatus con_diferencias
   deducible 0 · noDed 0 · porConfirmar 5,600 · iva 0 · peaje 0 · litros 0
   diferencias: sobre_politica, rfc_receptor_no_verificable ×2,
                permiso_cre_no_verificable, anticipo

empresaRfc = TIN010101AA5 (solo el RFC del tenant corregido) →
   NO BASTA: los gastos del seed siguen con receptor TIN010101AAA
   → rfc_receptor → NO DEDUCIBLE $5,600.

empresaRfc = TIN010101AA5 Y receptor TIN010101AA5 →
   deducible 5,600 · iva 774.48 · peaje 603.45 · litros 0   ← el demo que el guion promete
```

**Consecuencia:** `rfc_receptor_no_verificable` está en `POR_CONFIRMAR`
(`engine.ts:86`) y en `SIN_ACREDITAMIENTO` (`engine.ts:892`): con el seed tal
cual, la sección "Acreditable / recuperable" **no aparece**, el detalle de la
liquidación enseña "Por confirmar $5,600", y el panel de Combustible & Casetas
marca "Litros 0" e "IVA $0". El propio `GUION_DEMO.md:163-164` lo avisa con
todas las letras: el RFC tiene que ser **válido** —"solo para que la validación
de receptor funcione—, con el genérico del SAT, todas las facturas saldrían 'a
revisión'"— y además dice que el RFC configurado es `GMX0902279I1` (de un
tercero), que tampoco aparece en el seed. Seed y guion se contradicen; el guion
es el que describe el demo que se va a dar.

**Causa raíz probable:** la rama de auditoría 11 corrigió el seed y `master`
siguió adelante con `ce9abab` sin traerse ese arreglo; nadie detectó que la
corrección de datos del demo era parte del paquete de fiscal.

**Por qué CRÍTICO y no ALTO:** es la pieza central del demo de mañana y no es
una cifra equivocada impresa — es la sección fiscal **completa desaparecida** de
la pantalla que el contralor va a mirar. El criterio del rubro reserva el 3-4
para "el producto imprime una cifra fiscal equivocada"; aquí imprime $0 de algo
que el guion promete enseñar en pesos.

---

### [ALTO] El parser del XML sigue sin leer `Cantidad` en el camino 1:1: la liquidación del demo entrega 0 litros sobre un CFDI que dice `Cantidad="113.00" ClaveUnidad="LTR"`

`src/lib/cuadra/intake/cfdi_xml.ts:214-250` (el `map` de conceptos lee
`ClaveProdServ`/`ClaveUnidad`/complemento; `cantidad` solo existe dentro de
`lineas` de consolidado, `cfdi_xml.ts:81,235,248`) ·
`src/lib/cuadra/cuadre/engine.ts:952-954`
(`const litros = Number((g.ocrExtra as Record<string, unknown> | undefined)?.litros ?? 0)`)
· `src/lib/cuadra/intake/ocr.ts:406` (único productor de `litros` es la foto) ·
`supabase/seed.sql:135` (XML con `Cantidad="113.00"`) ·
ficha `normas/lif-2026-20-A.yaml` · **NUEVO en master** (cerrado en la rama 11,
nunca fusionado)

El único productor de `litros` sigue siendo el OCR de una **foto**
(`ocr.ts:406`). `CfdiXmlData` no tiene un campo `cantidad` a nivel comprobante:
el parser lee `Cantidad` únicamente cuando arma `lineas` de un consolidado
(`lineasEcc` / `lineasConceptoBase`), y el CFDI del demo tiene UN solo Concepto,
así que `lineasConceptoBase` queda `[]` y los 113 L se descartan. El comentario
de `engine.ts:953-954` —"el XML del CFDI no siempre trae la cantidad desglosada
por concepto"— es falso para este caso: el XML del propio seed la trae.

**Medido** (mismo script del hallazgo anterior, RFC corregido a `TIN010101AA5`
en los dos lados): `litros 0`; la fila "Diésel elegible para el estímulo" no
existe en el PDF ni en el panel, aunque `parseCfdiXml` sí vio
`claveProdServ 15101505` y el complemento `HidroYPetro`.

**Escenario en pesos:** flota que manda el XML (el flujo que la oficina
prefiere) con 200,000 L/año: Likida entrega **0 L**. Con la banda de cuota de la
ficha (`criterio-1-LIF-PI`, $2.09–$7.36/L), son $418,000–$1,472,000 de estímulo
que el contador nunca ve. En el demo: 113 L = $236–$832 sobre un comprobante
impecable, y el guion manda decir *"cuántos litros son elegibles"*.

**Causa raíz:** los litros se modelaron como dato de visión cuando el CFDI los
lleva estructurados en el mismo nodo del que el parser ya lee el atributo de al
lado. El fix de la rama 11 no llegó a master.

---

### [ALTO] (REINCIDENTE DE AUDITORÍA 11, SIN FUSIONAR) Con el SAT caído o en timeout (4 s), el papel imprime "Deducible para ISR $X" e "IVA acreditable $Y" en verde — el mismo tercer estado que el motor sí aplica a EFOS, al RFC y al complemento

`src/lib/cuadra/intake/sat.ts:50,89` (catch → `estado: 'pendiente'`) ·
`src/lib/cuadra/cuadre/engine.ts:409-410` (`cfdi_pendiente` solo avisa) ·
`engine.ts:84-88` (`POR_CONFIRMAR` no lo incluye) · `engine.ts:892`
(`SIN_ACREDITAMIENTO` no lo incluye) · fichas `normas/cff-29-A.yaml`
(`texto_vigente: null`) y `normas/liva-5.yaml` (verificado_fuente_primaria)
· **ABIERTO**

**Medido con el motor real.** CFDI de $700, XML verificado, IVA $96.55,
`FormaPago 04`, receptor correcto, `estadoSat: 'pendiente'`:

```
difs: [cfdi_pendiente]        estatus: revisar
deducible 700 · ivaAcreditable 96.55          ← ambas en verde en el PDF y en el panel
```

El propio motor documenta su criterio en los otros tres casos —"no se puede
confirmar NI descartar → a revisión. Nunca deducible, nunca acreditable"—
(`engine.ts:259-268` para el RFC, `:532-533` para el complemento, `:140-150`
para EFOS). `cfdi_pendiente` es el único punto donde "no se pudo verificar"
sigue cayendo en `deducible` con IVA verde, y es justo el que depende del
servicio externo más intermitente. Una tarde con el `ConsultaCFDIService` lento
—lo normal en cierre de mes— produce liquidaciones enteras afirmadas en verde
sin que un solo UUID se haya confirmado. El guion del demo lo narra como
diseño —"si el SAT no responde, la liquidación queda pendiente y sigue"— pero
en el papel la cifra no dice que quedó pendiente: lo dice una observación entre
cinco, y las dos grandes cifras salen verdes.

---

### [ALTO] (REINCIDENTE DE AUDITORÍA 11, SIN FUSIONAR) Cuatro superficies afirman peaje, IVA y litros sin ninguna reserva; la única con reserva es el PDF

`src/app/dashboard/[id]/page.tsx:261-264` (`Tot ... ok` →
`var(--color-ok)`, `:394-395`) · `src/lib/cuadra/cuadre/resumen.ts:94-96`
(WhatsApp: `• Peaje 50%: $X` a secas) · `src/app/dashboard/chat.tsx:41`
(`$X de peaje acreditable (50%) este periodo`) ·
`src/app/dashboard/politicas/page.tsx:276` ("Del gasto de peaje es acreditable —
estímulo de autopistas, LIF 2026 Art. 20-A") contra
`src/lib/cuadra/liquidacion/acreditable.ts:115` (el label del PDF: "— sujeto a
elegibilidad") · ficha `normas/lif-2026-20-A.yaml` · **ABIERTO**

Verificado por grep en todo `src/`: `ETIQUETA_PEAJE_CORTA` / `NOTA_PEAJE_PANEL`
no existen en master; la única ocurrencia de "sujeto a elegibilidad" es
`acreditable.ts:115`. Los commits que las traían a las otras superficies
(`fe31209`, `992045b`) no son ancestros de master.

**Escenario:** flota con ingresos ≥ $300M (o parte relacionada, o casetas fuera
de la Red Nacional de Autopistas de Cuota). Su liquidación imprime en el
detalle del panel `Peaje 50% $603.45` en verde 3xl con el artículo al lado, el
WhatsApp dice `Peaje 50%: $603.45`, y el chat del panel responde
`$603.45 de peaje acreditable (50%) este periodo.` Ninguna de las cuatro dice
que el motor no verifica ninguna de las cuatro condiciones de la ficha
(`acreditable.ts:93-101`). El PDF de esa MISMA liquidación sí lo dice — y así,
el mismo hecho sale afirmado en verde en el navegador y condicionado en el
papel, delante del contralor, que es el caso que la auditoría 11 midió y que
master no corrigió.

---

### [MEDIO] (REINCIDENTE DE AUDITORÍA 11, SIN FUSIONAR) `operadorRfc` no tiene productor: la rama buena de RLISR 57 es inalcanzable y todo viático a nombre del operador manda la liquidación a `revisar`

`src/lib/cuadra/cuadre/engine.ts:390-396` (la rama buena exige
`input.operadorRfc`) · `src/lib/cuadra/cuadre/desde_db.ts:44-60` (arma el
`CuadreInput` y no pasa `operadorRfc`) · `grep -rn "operadorRfc" src/`
→ dos apariciones fuera de pruebas, las dos dentro de `engine.ts` ·
ficha `normas/rlisr-57.yaml` (verificado_fuente_primaria) · **ABIERTO**

**Medido.** Hospedaje de $2,000 timbrado al RFC del operador
(`CAPJ800101AA1`), XML verificado, IVA $275.86, receptor de la flota bien
configurado:

```
difs: [viatico_rfc_operador]   estatus: REVISAR
nota: «…captura su RFC para confirmarlo.» — sin campo ni pantalla donde capturarlo
```

`cuadrarDesdeDB` es el único llamador de producción (`processor.ts:1796`,
`analytics.ts:788`, `tools.ts:79`) y no pasa el dato; la rama de
`engine.ts:391-393` —"es del operador: correcto por RLISR 57" — no se puede
alcanzar desde WhatsApp ni desde el panel. El caso NORMAL de una flota (hotel a
nombre del chofer) tiñe de "Por revisar" liquidaciones correctas.

---

### [MEDIO] (REINCIDENTE) La válvula del 15% de la RFA 2.9 se ofrece a cualquier tenant: no se captura régimen ni dedicación, y el aviso las da por cumplidas

`src/lib/cuadra/cuadre/engine.ts:352-361` (la nota) ·
`src/lib/cuadra/periodo/combustible.ts:130-161` ·
`src/lib/cuadra/config.ts:44-51,93-99` (`estimulos` sin régimen ni dedicación) ·
`grep -rn "regimen\|dedicacion\|exclusiv" src/lib/cuadra/config.ts
src/types/cuadra.ts` → cero ·
ficha `normas/rfa-2026-2.9.yaml` (verificado_fuente_primaria,
`condiciones_de_aplicacion` 1ª y 2ª: "Dedicados EXCLUSIVAMENTE al
autotransporte terrestre de carga federal" · "Tributar en Título II Cap. VII
(coordinados) o Título IV Cap. II Secc. I") · **ABIERTO**

Sin cambios desde la ronda 11: un tenant que **no** califica (régimen general,
o cualquier tenant que aún no declara — el estado de todos hoy) recibe la nota
"cuenta contra el tope del 15%… dentro del 15% SIGUE SIENDO DEDUCIBLE" y, con
datos, el aviso en pesos "te quedan $35,294.11 antes de perder la deducción".
Para esa flota ambas frases son falsas en direcciones opuestas: le promete una
deducción que sin la facilidad no tiene, y le autoriza gastar más efectivo que
para ella no deduce.

---

### [BAJO] (REINCIDENTE) `precioDieselPorDefecto` vive en `tabulador` y el motor lo busca en `estimulos`: la banda anti-decimal-corrido siempre usa el literal 27.0

`src/lib/cuadra/config.ts:30,74` (vive en `tabulador`) ·
`src/lib/cuadra/cuadre/engine.ts:63,965`
(`input.estimulos?.precioDieselPorDefecto ?? 27.0`) ·
`src/lib/cuadra/cuadre/desde_db.ts:53` (`estimulos: config.estimulos`, donde el
campo no existe) · ficha `normas/lif-2026-20-A.yaml` · **ABIERTO**

El tenant que captura `precioDieselPorDefecto: 14.0` (diésel subsidiado por
contrato) calibra la banda 0.5×–2× con 27.0: un ticket de $5,400 leído como 760 L
(OCR corrió el decimal de 76.0) da razón 3.8 contra 27.0 → `diesel_desviacion`,
no se acreditan litros que la banda del propio tenant habría aceptado (razón
1.97 con su precio). El panel de configuración le enseña el valor que capturó
como si estuviera en uso.

### [BAJO] (REINCIDENTE) El denominador del 15% filtra `concepto = 'diesel'` mientras el motor define combustible con dos criterios

`src/lib/cuadra/repo.ts:826` (`.eq('concepto', 'diesel')`) contra
`src/lib/cuadra/cuadre/engine.ts:324`
(`g.concepto === 'diesel' || h.claves.includes(g.claveProdServ)`) ·
ficha `normas/rfa-2026-2.9.yaml` · **ABIERTO**

Combustible capturado como `otro`/`factura` (p. ej. XML pegado a un ticket que
el OCR clasificó distinto) queda fuera del numerador **y** del denominador:
$150,000/año omitidos hacen parecer holgada a una flota que ya va en 14.1% del
total real, o al revés. El motor por viaje sí lo cuenta; el contador del
ejercicio no. Las dos mitades del producto contestan distinto sobre el mismo
gasto.

### [BAJO] (REINCIDENTE, 3ª ronda en master) `facturacion/permiso_cre.ts` sigue sin un solo consumidor en producción

`src/lib/cuadra/facturacion/permiso_cre.ts` (verificado con grep sobre `src/`;
cero llamadas fuera de su propia prueba) · contraste:
`src/lib/cuadra/cuadre/engine.ts:1055` usa el literal
`permiso_cre_no_verificable`, que **no** llama a `identificarPorPermiso`.
12,625 permisos CRE tabulados, método listo para resolver marca desde el
permiso, y el motor sigue emitiendo "permiso CRE no validado" en todo CFDI de
diésel con XML. Activo construido y no conectado; adyacente al CRÍTICO de
auditoría 10 (la porción monedero/TAG se resolvió por otro camino, este no).

---

## Verificaciones puntuales que pidió esta ronda

**Migración 0078 (`supabase/migrations/0078_rls_chofer_sin_escritura.sql`),
revisada línea por línea en su efecto sobre el camino fiscal — correcta.** Las
dos tablas fiscales que arrastraban el patrón vulnerable (`cfdi_xml` desde la
0009, `cfdi_consolidado_linea` desde la 0076) pasan a
`using/with check ((tenant_id = any(get_user_tenant_ids()) and not
is_operador()) or is_superadmin())` — el mismo patrón de la 0047/0050/0051. El
bucle de la 0078 cubre las 7 tablas que nacieron con `tenant_data` a secas
(`terminal, operador, politica_gasto, wa_conversacion, llm_costo, cfdi_xml,
cfdi_consolidado_linea`); verifiqué por grep que las demás tablas con
`tenant_data` (`unidad, mantenimiento, incidencia, pod, posicion, geocerca,
ticket_soporte, ticket_mensaje, campania, envio_mensaje`) ya usaban el patrón
seguro desde su propia migración. `tenant_self` queda `for select`; la app
escribe `tenant` siempre por service_role. El bloque 54 de `verificaciones.sql`
impersona a un chofer y cuenta en las 7 tablas (esperado 0), verifica que el
UPDATE al tenant toca 0 filas y que el `flota_admin` sigue viendo lo suyo —
completo. No encontré hueco en las tablas del dinero. (El barrido fino de RLS
es del rubro seguridad; esto es lo que toca al camino fiscal.)

**`FACTURACION_MODO`: el default sigue siendo `ensayo`, y ahora con doble
candado.** `src/app/api/cron/facturar/route.ts:251` —
`process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo'`; y
`src/lib/cuadra/facturacion/modo.ts:70-83` degrada `emitir` a `ensayo` sin
`FACTURACION_MANDATO_ACEPTADO=si`, con `logger.error`. Los dos llamadores de
producción de `al_vuelo.ts:242,424` pasan por `modoEfectivo()`. Verificado con
las pruebas de `al_vuelo.test.ts` (el describe del candado) — verdes.

**La cláusula de mandato (hallazgo ALTO de auditoría 10): el candado de código
sigue en su lugar; la cláusula legal sigue sin existir.** `modo.ts` documenta
que redactarla no es trabajo del archivo. `/terminos` (§16,
`terminos/page.tsx:57`) sigue diciendo "Likida no es un despacho contable, ni un
PAC… No timbra facturas" — sin la cláusula de representación. Estado honesto:
candado de código cerrado y verificado; cláusula pendiente de Javier y su
abogado (decisión humana, no de código).

**El desglose de IVA de la mensualidad sigue correcto, de punta a punta.**
`desglosarPrecio` lanza si el criterio no está declarado (`saas/iva.ts:82-96`),
`timbrarFactura` se niega a timbrar sin `subtotal`/`iva` congelados y con
`desgloseCuadra` (`transferencia.ts:290-306`), y `timbrarMensualidad` compara el
`factura.total` del PAC contra `totalEsperado` con `logger.error` si no cuadra
(`facturapi.ts:213-216`). `desgloseCuadra` con margen `1e-9` documentado. La
suite `src/lib/saas/` → 157 pruebas verdes.

**El EFOS nunca afirma fraude desde este código.** `sat.ts:76-90`: `efos` solo
puede ser `false` (limpio, 200/201) o `null`; cualquier otro código →
`efosDesconocido` → bandeja. Verificado de nuevo esta ronda.

**La ingesta del CFDI consolidado (0076/0077) está sólida y con la cola
resoluble.** `intake/consolidado.ts`: JOIN con tolerancia documentada
(±$1, ±1 día), sin fecha → cero intento de match, idempotencia real por
`(cfdi_xml_id, indice)`, y `resolverLineaAMano` con guardia anti-doble-cierre
(estatus en el WHERE) y restricción de candidatos ya ofrecidos. La migración
0077 agrega `sin_match` y el índice parcial sigue cubriendo solo
`por_conciliar` — el contador que vacía la cola baja el número, y el que marca
`sin_match` también. Probado: `intake/consolidado.test.ts` y
`analytics_consolidado.test.ts` verdes.

**Cerrado en master, verificado en código — los arreglos de la ronda 10 que sí
llegaron:**
- **Hospedaje $1 con folio ya no apaga `alimentacion_sin_soporte`**
  (`engine.ts:705-707`: `esAmparoReal = monto > 50 || cfdiUuid`). Medido con el
  motor real: hospedaje de $1 con folio `X1` → la señal SÍ aparece. (Cierra el
  MEDIO de auditoría 11 y el reincidente de la 10.)
- **Matiz legal del plazo en las dos ramas** (`engine.ts:632-634`): la rama sin
  verificar ya dice "…y legalmente puedes exigir la factura dentro del
  ejercicio". El catálogo tiene 4 `plazoVerificado: true` contra 34 `false`.
- **El simulador `/demo`** no imprime cifras acreditables ni deducibles
  (`api/demo/route.ts:120-126`), así que la puerta que corre sin
  `empresaRfc`/`estimulos`/`hidrocarburos` no puede enseñar un cero fiscal. Pero
  **ojo**: el simulador tampoco aplica el tope de $750, el complemento ni el RFC
  (no pasa `estimulos` ni `hidrocarburos`), así que como Plan B no muestra las
  reglas fiscales del producto — ver "lo que no alcancé".

**La suite fiscal, verde.** `npx vitest run` sobre `cuadre/`, `intake/`,
`liquidacion/`, `saas/`, `facturacion/`, `app/api/cron/facturar/` y
`migraciones_verificadas`: 675 pruebas, 0 fallos. `npx tsc --noEmit -p .` sobre
los archivos del rubro: limpio (la corrida completa no la lancé; ver abajo).

**Fichas:** las que sostienen las cifras del motor (`lisr-28-V`, `liva-5`,
`lif-2026-20-A`, `rfa-2026-2.9`, `rlisr-57`) están declaradas
`verificado_fuente_primaria` en master, y `cff-29-A` sigue con
`texto_vigente: null` — la deuda más vieja del rubro, que funda
`rfc_receptor`, `cfdi_cancelado` y `cfdi_no_encontrado` dentro de
`NO_DEDUCIBLE_ISR`. Sin red esta ronda no puedo re-verificar el DOF; lo dejo
como está declarado en las fichas.

---

## Lo que revisé y está bien (el resto del camino del dinero)

- **La carrera del doble CFDI sigue cerrada.** `al_vuelo.ts:reclamarIntentos`
  hace el claim con UPDATE condicional atómico (`cfdi_uuid is null`,
  `autofactura_bloqueada_en is null`, `.or(intentada is null, intentada <
  vencido)`), `CLAIM_MINUTOS = 10`, y `escribirUuid` bloquea en vez de reintentar
  cuando el CFDI ya existe y no se pudo guardar (`CU001`/`23505`). El lote
  (`facturarLoteAlVuelo`) reutiliza el mismo mecanismo y reparte el UUID con
  `cfdi_orden` en el orden de entrada al portal.
- **El cron corta por reloj antes de que Vercel lo mate** (`route.ts:242-244,
  386-395`): `MARGEN_LOTE_MS = 60s`, flota sin tiempo queda SIN marcar y se dice
  en la respuesta (`sinTiempo`). Es el hallazgo de rendimiento de la ronda 10
  cerrado y re-verificado.
- **El monto de CAPUFE nunca se adivina**: el adaptador no emite si el costo del
  portal no cuadra con el del ticket (probado de punta a punta con navegador
  real: "NO emite cuando el costo del portal no cuadra" — verde).
- **`totalComprobado` y las tres cubetas siguen sumando** con portón en
  `deducibilidad.ts:54-55` (si no cuadra, no se imprime el desglose).
- **El estímulo de IEPS sigue en litros y `iepsAcreditable` sigue `const 0`**
  (`engine.ts:897-900`); la base del peaje sigue en subtotal SIN IVA con la nota
  `BASE_ESTIMULO_PEAJE` al pie — sin cambios, y correcto como está mientras la
  decisión del 50% no se resuelva con un contador.
- **LIVA 5-I proporcional**: el bloque de acreditamiento corre después del tope
  diario y aplica `proporcionDeducible` (`engine.ts:884-887, 919-921`).
- **`cfdi_consolidado_linea` no tiene fugas de tenant**: RLS 0078 + índice
  parcial por tenant, y `getLineasPorConciliar` hace join contra `gasto`→`viaje`
  con `exigir()` (fail-closed).

## Lo que NO alcancé a revisar

- **No generé el PDF renderizado.** Verifiqué las estructuras que le llegan
  (`filasDeducibilidad`, `filasAcreditables` con tonos y pies) y leí `pdf.ts`
  (los dos sitios donde el tono se vuelve color: `:295` y `:348`), pero no miré
  el papel. Para el hallazgo del `[id]` me apoyé en `Tot` (`page.tsx:394-395`),
  que no deja lugar a duda.
- **El prompt del OCR y la clasificación de concepto** (`intake/ocr.ts`,
  `decidir.ts`, `emparejar.ts`): deciden qué regla fiscal aplica (tope de LISR
  28-V, estímulo de peaje, contador del 15%) y no los audité.
- **La ventana temporal del contador del 15%** (año natural vs transitorio de la
  RFA) y la interpretación del excedente: sin fuente, no dictamino.
- **La suite completa** (3,079 pruebas): otro auditor puede estar corriéndola;
  corrí solo lo de mi rubro (675 pruebas).
- **El simulador `/demo` como Plan B**: no pasa `estimulos`/`hidrocarburos`/
  `empresaRfc` al motor (solo `politica`), así que como respaldo no ejercita el
  tope de $750 ni el complemento — lo anoto como decisión, no lo audité a fondo.

## Veredicto

**No es green light para la demo en su parte fiscal, y la nota baja por eso.**
El motor determinístico es sólido y falla cerrado — el problema no está en las
decisiones de dinero, está en dos capas distintas:

1. **Datos del demo (CRÍTICO):** el seed siembra un RFC que nuestro propio
   validador rechaza, y eso vacía la sección fiscal entera de la liquidación
   que el guion enseña. Es un `sed` de cuatro literales en `seed.sql` — pero
   nadie lo ha hecho, y la auditoría 11 lo hizo en su rama sin que llegara a
   master. Hay que corregirlo ANTES de aplicar el seed mañana.
2. **Superficies (ALTO):** el SAT caído imprime verde, y el detalle de la
   liquidación + WhatsApp + chat + políticas afirman peaje/IVA/litros sin las
   reservas que el propio PDF de la misma liquidación imprime. Son los dos
   hallazgos de la ronda 11 que master no fusionó.

Lo que sostiene el 5: el camino del dinero en lo nuevo de esta ronda está
impecable — consolidado 0076/0077 con su cola resoluble, RLS 0078 correcta en
las tablas fiscales, mensualidad con desglose congelado, mandato con doble
candado, y 675 pruebas de rubro verdes. Pero un producto fiscal no puede
presentarse mañana con la sección que vende vacía por un RFC inválido en su
propio seed, y esa es la conversación que decide el demo.
