# Cumplimiento fiscal y legal — nota 6/10

Método: contrasté cada `diferencias.push` de `cuadre/engine.ts` contra las 17 fichas de
`normas/`, seguí el dato hasta `liquidacion/pdf.ts` (lo que de verdad lee el contralor) y
usé `command grep` para las búsquedas de ausencia (por la trampa de `grep`/`ugrep` descrita
en `MAPA.md`). No repito los cuatro casos históricos que el propio repo documenta como ya
corregidos (diésel en efectivo, RFC del trabajador subordinado, ticket sin CFDI tratado como
deducible) — los verifiqué contra el código actual y están bien: `engine.ts:122-128` (RFA
2026 regla 2.9), `engine.ts:182-201` (RLISR 57), `engine.ts:418-423` (ticket ≠ factura, salvo
el bug nuevo del hallazgo 1). Encontré un patrón nuevo del mismo género (política interna
disfrazada de regla fiscal) y dos violaciones directas de lo que las propias fichas —ya
verificadas— prohíben.

## Hallazgos

### [CRÍTICO] `sin_cfdi` mezcla política interna con regla fiscal y declara "no deducible" lo que en realidad es recuperable

`src/lib/cuadra/cuadre/engine.ts:176-178` y `:407` — norma: LISR 27-III / 28-V (ficha
`lisr-27-III`: evidencia_corroborante) contra el propio diseño del motor (comentario en
`engine.ts:418-422`, sin ficha porque es lógica interna, no una cita).

Qué hace el código: el diff `sin_cfdi` solo se genera cuando la **política interna del
tenant** (`pol?.requiereCfdi`, columna `politica_gasto.requiere_cfdi`, default `false`) lo
exige y el gasto no trae `cfdiUuid` (`engine.ts:176-178`). Ese tipo está incluido en
`NO_DEDUCIBLE_ISR` (`engine.ts:407`), así que ese monto entero cae en la cubeta roja "No
deducible" del PDF (`deducibilidad.ts:56-63`, `pdf.ts:237` con color `RED`), con el pie fijo
"Ver las diferencias detectadas abajo" — no "se puede recuperar".

Pero el MISMO hecho —gasto sin `cfdiUuid`— para cualquier concepto cuya política **no** trae
`requiereCfdi:true` cae en la rama genérica de `engine.ts:418-423`: `totalPorConfirmar +=
g.monto`, con el pie "Falta timbrar la factura... **Se puede recuperar**"
(`deducibilidad.ts:48-54`). El propio código lo explica con esas palabras en el comentario de
la línea 418: *"UN TICKET NO ES UNA FACTURA... Tampoco es pérdida: se puede timbrar. Por eso
POR CONFIRMAR."* — y dos líneas después trata exactamente ese caso como pérdida cuando pasa
por `sin_cfdi`.

`DEMO_CONFIG` (`src/lib/cuadra/config.ts:73`, la que usa la demo del 6-ago y cualquier tenant
sin config propia) trae `{ concepto: 'factura', requiereCfdi: true }`. Entrada concreta: el
operador manda la foto de un ticket de refacción o servicio categorizado como "factura", $3,000,
sin timbrar todavía (común: se factura después en el portal del taller). Salida: el PDF le
dice al contralor, en rojo, "No deducible $3,000" — cuando el mismo ticket sin timbrar de
diésel o caseta, con el mismo hecho, habría salido en ámbar como "Por confirmar, se puede
recuperar". Es exactamente el patrón que el propio comentario de `sobre_politica`
(`engine.ts:405-406`, *"exceder la política INTERNA de la flota no vuelve el gasto no
deducible ante el SAT"*) dice que NO debe pasar — pero sí pasa, para `sin_cfdi`.

Le cuesta al cliente: desincentiva pedir la factura a tiempo (el papel ya dice "perdido") y
le muestra al contralor una cifra de deducibilidad más baja de la real. No hay test que lo
cubra: `engine.test.ts:39-46` solo verifica que `sin_cfdi` aparece como diff y que el
`estatus` es `revisar`, no las cubetas de deducibilidad.

### [CRÍTICO] El "IEPS acreditable" que imprime el PDF no es el estímulo del LIF 2026 art. 20, ap. A — es el IEPS trasladado en el CFDI, y las propias fichas ya lo prohíben

`src/lib/cuadra/cuadre/engine.ts:289-293`, `src/lib/cuadra/liquidacion/pdf.ts:274` — norma:
LIF 2026 art. 20-A fr. IV (ficha `lif-2026-20-A`: **verificado_fuente_primaria**) y criterio
1/LIF/PI del Anexo 3 RMF 2026 (ficha `criterio-1-LIF-PI`: evidencia_corroborante).

La ficha `lif-2026-20-A.yaml` transcribe el texto vigente y aclara en `como_se_calcula`: *"cuota
IEPS vigente al momento de la compra × LITROS. **No es el IEPS trasladado en el CFDI**."* El
código hace justo eso: `iepsAcreditable += g.iepsTraslado` (el importe del nodo `Traslado
Impuesto=003` del XML) y el PDF lo imprime como `mxn(liq.iepsAcreditable)` bajo el rótulo
"IEPS de diésel acreditable vs ISR (LIF 2026 art. 20, ap. A)". El propio comentario de
`types/cuadra.ts:47` y `intake/cfdi_xml.ts:31` repite el error como si fuera un hecho: *"IEPS
desglosado (Traslado 003) → acreditable vs ISR"*.

La ficha `criterio-1-LIF-PI.yaml` es más explícita todavía: *"El estímulo del IEPS de diésel
se calcula con la CUOTA SEMANAL DISMINUIDA, no con la cuota entera... `pendiente_en_producto`:
el motor de cuotas semanales NO existe. **Hasta que exista, el producto NO debe imprimir una
cifra de estímulo de diésel en pesos: solo litros, cuota fechada y rango.**" El propio roadmap
del proyecto (`docs/conocimiento/00-ROADMAP.md:208,742-748`, decisión D2) llega a la misma
conclusión: *"La demo enseña una cifra de estímulo de diésel en pesos. No lo hagas"* —
recomienda mostrar litros + cuota fechada, "sin discusión". El código actual sigue
imprimiendo la cifra en pesos.

Cuánto cuesta: la propia ficha lo cuantifica — *"la cuota es SEMANAL y varió ~3.5x durante
2026. Para una flota de 200,000 litros al mes, usar una cuota fija [o, como aquí, el IEPS
trasladado] es del orden de $1 millón de pesos de error mensual."* Es dinero que el contralor
ve en un renglón verde con cita de ley y que no corresponde al cálculo real del estímulo.

### [ALTO] Complemento de hidrocarburos: se declara "no deducible" desde una fecha que la propia ficha dice sin respaldar

`src/lib/cuadra/config.ts:93`, aplicado en `src/lib/cuadra/cuadre/engine.ts:218-236` — norma:
RMF 2026 regla 2.7.1.48 (ficha `rmf-2026-2.7.1.48`: evidencia_corroborante) + CFF 29-A.

`config.ts:93` fija `vigenteDesde: '2026-04-24'`. Todo CFDI de diésel/gasolina tipo I/E con
fecha ≥ ese día sin el complemento se marca `complemento_hidrocarburos`, que está en
`NO_DEDUCIBLE_ISR` (`engine.ts:407`) — pierde la deducción completa, citando CFF 29-A.

La propia ficha dice: *"La fecha exacta de EXIGIBILIDAD no está confirmada. La regla,
reformada el 09-jul-2026, sigue redactada en futuro ('que al efecto publique el SAT'), así
que la obligación puede estar latente y no vigente. El código usa 2026-04-24... y ESA FECHA
NO ESTÁ RESPALDADA por esta ficha."* Hoy —con la fecha del sistema en julio de 2026— el motor
ya está declarando no deducibles, en producción y en cada liquidación con diésel facturado,
comprobantes que quizá sí cumplan la ley vigente, si la obligación real todavía no es
exigible. Es la misma familia de error que el diésel en efectivo (caso histórico 1): una regla
absoluta aplicada sin la verificación que la propia norma pide.

### [MEDIO] Estímulo de peaje: base de cálculo y elegibilidad sin verificar (ya documentado en la ficha, sigue sin corregirse)

`src/lib/cuadra/cuadre/engine.ts:284` — norma: LIF 2026 art. 20-A (ficha `lif-2026-20-A`:
verificado_fuente_primaria, sección `hallazgos_que_el_codigo_tiene_MAL`).

No es un hallazgo nuevo — la propia ficha lo declara `SIN RESOLVER` — pero sigue vivo en el
código actual, así que lo repito porque cuesta dinero: `peajeAcreditable += g.subTotal *
0.5` usa el SubTotal (sin IVA), y la ley dice *"hasta en un 50% del gasto total EROGADO"*
(H4, severidad alta según la ficha, ~13.8% menos estímulo del que correspondería — aunque la
propia ficha marca esto como pregunta abierta para un contador, no como bug resuelto: usar el
total podría duplicar el beneficio del IVA que ya se acredita aparte). Además el 50% se aplica
a TODO gasto con `concepto === 'caseta'` sin verificar que sea de la Red Nacional de
Autopistas de Cuota (H5) ni que el tenant cumpla ingresos <$300M / no sea parte relacionada
(H6) — ambos pueden ACREDITAR de más, exposición ante el SAT.

### [BAJO] La excepción de RLISR 57 está bien codificada pero es inalcanzable hoy

`src/lib/cuadra/cuadre/desde_db.ts:21-33` no pasa `operadorRfc` a `cuadrarViaje` — el objeto
que arma no tiene esa clave. Confirmé además que la tabla `operador`
(`supabase/migrations/0001_init.sql:29-36`) no tiene columna `rfc` (el `rfc text` que
devuelve `command grep` en la línea 11 pertenece a `tenant`, no a `operador`) — la ficha
`rlisr-57.yaml` lo dice igual en su campo `pendiente`. Consecuencia: la rama que confirmaría
limpio un viático a nombre del operador (`engine.ts:192-193`, *"Es del operador: correcto por
RLISR 57, no se reporta nada"*) nunca se ejecuta en producción; todo viático a nombre de una
persona cae siempre en `viatico_rfc_operador` (revisión manual permanente). No mueve la nota
porque no declara nada no-deducible — es una excepción bien fundamentada que hoy no hace su
trabajo, no una regla mal aplicada. Ya está declarado como pendiente en la propia ficha.

## Reglas del código SIN norma que las respalde

- **EFOS (`cfdi_efos` / `cfdi_efos_indeterminado`, `engine.ts:206-209`)**: se declara "no
  deducible" citando solo "lista negra del SAT (EFOS)" en el mensaje — sin artículo. El
  fundamento real sería CFF art. 69-B, y **no existe `normas/cff-69-B.yaml`** en la carpeta.
  Es probablemente correcto (es la consecuencia estándar y muy conocida del listado 69-B),
  pero por la propia regla de la carpeta ("ninguna ficha `sin_verificar` debe sostener una
  cifra que el producto imprime") esto es peor: no hay ficha en absoluto, ni siquiera
  `sin_verificar`.
- **`cfdi_cancelado` / `cfdi_no_encontrado` (`engine.ts:202-205`)**: mismo patrón — el mensaje
  no cita ningún artículo ("está CANCELADO ante el SAT — no deducible"). `cff-29-A.yaml` cubre
  requisitos generales del comprobante, no específicamente la consecuencia de cancelación o
  UUID inexistente sobre la deducibilidad.

## Fichas sin_verificar cuya regla ya se aplica como cierta

- **`liva-5.yaml` (sin_verificar)** — es la más clara del lote. El motor suma `ivaTraslado`
  del XML en `ivaAcreditable` (`engine.ts:282`) y el PDF lo imprime tal cual, con cita:
  `acred('IVA acreditable (LIVA art. 5)', liq.ivaAcreditable)` (`pdf.ts:275`). La propia
  ficha lo advierte: *"El artículo NO se leyó en esta investigación... Si el artículo exige
  alguna condición adicional que hoy no se valida, la cifra impresa está de más. Es una cifra
  que el contralor usa."* Es dinero mostrado como acreditable con la apariencia de estar
  fundamentado en ley, sobre una ficha que el propio repo marca como no apta para afirmarse
  (tabla de estados en `normas/README.md`: `sin_verificar` → "No. Marcar como pendiente").
- **Contraste positivo**: `politica-portales-plazos.yaml` también es `sin_verificar`
  (jerarquía 6, política de un tercero) y el código **no** la usa como si fuera cierta —
  `engine.ts:312` corre la regla general del mes natural, no los plazos por cadena. Es el
  patrón correcto que `liva-5` debería seguir.

## Lo que está bien fundamentado

- RFA 2026 regla 2.9 (diésel en efectivo, hasta 15%) — `engine.ts:122-124`, ficha
  `verificado_fuente_primaria`, la nota al contralor distingue correctamente deducción de
  acreditamiento.
- RLISR 57 (viático a nombre del operador) — lógica correcta cuando `operadorRfc` está
  presente; ver hallazgo BAJO sobre por qué hoy nunca se activa.
- LISR 28-V, tope de $750/día de alimentación — `engine.ts:363-393`, agrupado por día y solo
  sobre alimentación (no hospedaje ni transporte); la propia ficha (`verificado_fuente_primaria`)
  confirma la cifra y el criterio "por día y por beneficiario" contra el código actual.
- LISR 28-V, requisito de soporte de hospedaje/transporte para la alimentación —
  implementado como aviso de revisión (`alimentacion_sin_soporte`), no como rechazo duro:
  diseño conservador correcto, documentado en la propia ficha como `IMPLEMENTADO_COMO_AVISO`.
- LISR 27-III, tope de $2,000 en efectivo para gasto no-combustible — `engine.ts:125-128`,
  cifra confirmada en la ficha.
- Complemento de hidrocarburos, niveles 1/2 — nunca declara fraude sin verificar (manda a
  revisión cuando falta el XML) y excluye correctamente los esquemas alternos (ECC, Carta
  Porte) de la regla 2.7.1.48. Sobre Carta Porte específicamente: el producto no la genera ni
  la valida — solo la reconoce para EXCLUIRLA del complemento de hidrocarburos
  (`cfdi_xml.ts:95-98`), lo cual es correcto y evita un falso positivo.
- `privacidad.ts` — el aviso simplificado cubre las fracciones I-IV del art. 15 (identidad y
  domicilio, qué datos, finalidades, opciones para limitar uso) y señala el aviso integral
  por el art. 16 fr. II, con la atribución correcta de responsable (la flota) vs. persona
  encargada (Likida, arts. 2 fr. XII/XX). Ficha `lfpdppp-15-16`: `verificado_fuente_primaria`,
  texto transcrito literal. El mecanismo ARCO (`pideAtencionPrivacidad` /
  `respuestaPrivacidad`) es determinístico y corre antes del agente — no depende de que un LLM
  "decida" atenderlo.
- `leyendas.ts` / `pdf.ts` — el descargo del CFF art. 52 y la referencia al criterio 1/CFF/PI
  (Anexo 3 RMF) están fundamentados en una ficha `evidencia_corroborante` con la fracción IV
  citada verbatim y consistente entre ficha y código; el texto no se presenta como dictamen.

## No cubrí

- No verifiqué `guardia.ts` ni el enrutamiento operador/contralor del contenido fiscal (ya
  cubierto por el boletín técnico anterior, es un asunto de arquitectura/seguridad, no de
  corrección de la regla en sí).
- No verifiqué la RFA 2026 regla 2.2 (facilidad del 8%) ni RMF 2.7.1.21 (factura global): están
  en `normas/` pero `usado_en_codigo` confirma que ninguna se usa en el motor (solo en
  documentación), así que no hay riesgo de aplicación en producto hoy.
- No leí el texto completo de LIVA art. 5, CFF 69-B ni el Anexo 3 fracciones II/III del
  criterio 1/CFF/PI contra el DOF — señalé su ausencia/estado, no los verifiqué yo mismo (no
  tengo fuente primaria a la mano y la regla de evidencia de este encargo lo prohíbe).
- No corrí `pruebas-manuales/*.prueba.ts` (instrucción del MAPA) ni toqué la base de datos.
