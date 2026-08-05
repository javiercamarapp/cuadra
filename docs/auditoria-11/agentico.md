# Sistema agéntico — auditoría 11 (pase 2)

**Nota: 5/10** (antes 3). Razón del movimiento: **se atacó y subió** — verifiqué
uno por uno los 14 hallazgos del pase 1 contra el código de hoy y **11 están
cerrados con la línea que lo prueba**, incluidos los dos CRÍTICOS (`pareceCierre`
ya no existe: `processor.ts:1246` ofrece SIEMPRE; la afirmación quedó atada al
viaje en `:1086` con `ofrecidoParaViaje`). Dos están cerrados a medias y siguen
como REINCIDENTE. No sube más porque **mirada más profunda**: recorriendo el
ciclo aparecieron un CRÍTICO estructural que ningún arreglo tocó —el cierre en
$0.00 no tiene guarda determinística en ningún punto de la cadena— y un bucle sin
salida en el brazo que este mismo pase acaba de reforzar. De once puntos de
muerte tabulados, **cinco cierran el ciclo con el humano y seis no** (el pase 1
cerraba tres de ocho).

> Riesgo mayor de hoy: **nada, en ninguna capa, impide cerrar una liquidación
> sobre un viaje con CERO comprobantes.** Ni el prompt (que ordena lo contrario),
> ni `guardar_liquidacion` (`tools.ts:207`, sin guarda), ni `guardiaCifras`, ni el
> motor. Y el cierre es una puerta de un solo sentido: los triggers 0036/0037
> dejan el viaje inmutable y **no existe ninguna ruta —panel incluido— para
> agregarle un gasto después** (`addGasto` tiene exactamente tres llamadores, los
> tres en `processor.ts`).

---

## Cómo lo recorrí — los puntos de muerte, hoy

Once puntos, con la pregunta del rubro en cada uno («si el proceso muere AQUÍ,
¿qué ve el humano y qué quedó en la base?»).

| # | Punto exacto | Qué queda en la base | Qué ve el humano | Cierra |
|---|---|---|---|---|
| 1 | entre `claimMessage` (`:244`) y `resolveOperador` (`:280`) | mensaje reclamado | nada (Meta ya recibió su 200, `route.ts:121`) | ✗ REINCIDENTE |
| 2 | tras `guardarHuerfano` (`:366`), antes del acuse (`:378`) | la fila huérfana | nada; el siguiente mensaje sí la ofrece | ~ parcial |
| 3 | entre `say(mensajeOfrecer)` (`:1268`) y `marcarHuerfanosOfrecidos` (`:1273`) | sin marca | la oferta; peor caso, ofrecida dos veces | ✓ **arreglado** |
| 4 | dentro del `for` de `addGasto` (`:1146-1171`), antes de `resolverHuerfanos` (`:1172`) | N gastos dentro, N huérfanos pendientes | nada — y el reintento queda atrapado (H2) | ✗ **NUEVO** |
| 5 | `resolverHuerfanos` falla (`repo.ts:368`, no lanza) | gastos dentro, huérfanos pendientes | «Listo, agregué los N ✅» y después «No pude agregarlos» | ✗ **NUEVO** |
| 6 | tras `guardar_liquidacion`, ronda posterior tirada | liquidación + 2 PDF + viaje liquidado | el cuadre real + PDF (`:1454-1479`, ya sin flag) | ✓ **arreglado** |
| 7 | corte de Vercel entre `say(reply)` (`:1577`) y `sendDocument` (`:1671`) | todo cerrado | el cuadre sin PDF, **sin aviso y sin log** | ✗ REINCIDENTE |
| 8 | `sendDocument` devuelve `null` (`:1671`) | todo cerrado | «…pero no pude generarte el PDF» + `pdf.no_entregado` | ✓ **arreglado** |
| 9 | `say(reply)` rebota con `closed=true` (`131047`) | todo cerrado | **nada** (`wa.respuesta_no_entregada`, `:1701`) | ✗ |
| 10 | `ponerAvisoADisposicion` no pudo (`:238`) | nada | «se me trabó la conexión» + claim liberado | ✓ **arreglado** |
| 11 | barrera vencida con `closed` (`:1612-1618`) | liquidación sin ese comprobante | un aviso que lo manda a un trámite inexistente (H5) | ✗ |

---

## Hallazgos

### [CRÍTICO] Un «listo» sobre un viaje sin comprobantes cierra la liquidación en $0.00, y el cierre es irreversible
`src/lib/cuadra/tools.ts:207-213` (`guardar_liquidacion`: `throwIfAborted` y
`if (!ctx.viajeId)` son las dos únicas guardas) · `src/lib/cuadra/cuadre/desde_db.ts:29-59`
(`cuadrarDesdeDB` no mira si `gastos` está vacío) ·
`src/lib/agents/prompts.ts:27` («si el operador ya confirmó que terminó, CIERRA
en ese turno… NO le pidas que vuelva a confirmar… **Tener diferencias NO es
motivo para no cerrar**») · `src/lib/cuadra/cuadre/engine.ts:1274` (con cero
gastos la única diferencia es `anticipo` → `hayRevisar=false` → `estatus =
'con_diferencias'`) · `src/lib/cuadra/cuadre/resumen.ts:67` (la línea `anticipo`
se filtra de «Ojo con esto», así que no queda ni una advertencia).

**Escenario, con valores.** La oficina abre V1 con anticipo **$18,000.00**. El
chofer entregó su fajo de tickets **en papel en la oficina** —el hábito que
Likida viene a sustituir, y el que el contralor todavía tiene en la cabeza— y por
WhatsApp escribe **`listo`**. Cero filas en `gasto` para V1, cero huérfanos
(`enEspera.length === 0`, así que el bloque de `:1072` ni se entra).

1. `:1315` toma el mutex, `:1364` corre el agente.
2. El modelo hace lo que el prompt le ordena: `consultar_politica` →
   `cuadrar_viaje` (devuelve `total_comprobado: 0`, `total_anticipo: 18000`,
   `diferencia: 18000`) → `guardar_liquidacion`.
3. `guardar_liquidacion` persiste vía `guardar_liquidacion_tx` (`repo.ts:605`),
   que en la MISMA transacción pone `viaje.estatus = 'liquidado'`, y sube los dos
   PDF.
4. `guardiaCifras` (`guardia.ts:114`) sustituye el texto por
   `resumenCuadre(liq, true, 'operador')`:
   **«Listo, cuadré tu viaje 👇 · Comprobado: $0.00 · Anticipo: $18,000.00 ·
   Sobró $18,000.00 del anticipo (a favor de la empresa)»** + PDF.

**Variante igual de alcanzable, sin equivocación del chofer:** tiene 6
comprobantes en la sala de espera que de verdad son del viaje anterior, se le
ofrecen (`:1268`), contesta **`no`** —lo correcto—, `resolverHuerfanos(…,
'descartado', null)` los cierra (`:1214`), y su siguiente `listo` encuentra V1
con cero gastos.

**Consecuencia:** al chofer se le cargan $18,000.00. Y no hay reparación: la 0036
rechaza todo `addGasto` posterior (`llegoTarde`, `:797`) y la 0037 rechaza todo
UPDATE, así que sus tickets ya solo pueden ir al viaje SIGUIENTE. El contralor no
puede capturarlos desde el panel: **`addGasto` se llama en `processor.ts:739`,
`:1016` y `:1156` y en ningún otro sitio del repo** — no existe la puerta que el
propio producto le promete al operador en `:1616`.

**Causa raíz probable:** «¿alcanza para cerrar?» se dejó como decisión del
modelo. Es el único hecho del camino del dinero que no tiene su guardia
determinística, teniendo el sistema tres (`guardiaCifras`, `guardiaFundamento`,
`guardiaEstado`) para hechos menos caros.

*Refutación intentada:* «el modelo verá cero y preguntará». Con `temperature`
del rol `cuadre` y el prompt de `:27` ordenando cerrar en ese turno, es una
apuesta, no una guarda; y aunque preguntara, un `listo` más lo lleva al mismo
sitio. Segunda: «`guardiaEstado` lo desmiente». No: `closed` sale de las tool
calls y es `true` de verdad — la guardia coteja el cierre, no su sensatez.
Tercera: «`estatus` saldría `revisar` y alguien lo vería». Sale
`con_diferencias`, y la única diferencia (`anticipo`) está filtrada del mensaje.

---

### [ALTO] El «sí» que se reintenta choca contra `gasto_pkey`, que nadie reconoce: el comprobante queda dentro de la liquidación y el operador lee que no entró — para siempre
`src/lib/cuadra/processor.ts:1156` (`addGasto(op.tenantId, viajeId, h.gasto)`) ·
`:1161` (solo reconoce `uq_gasto_img_hash` y `uq_gasto_cfdi_uuid`) · `:1168`
(`llegoTarde`) · `:1197` (el mensaje) · `src/lib/cuadra/repo.ts:148`
(`id: g.id`) · `src/lib/cuadra/intake/ocr.ts:456` (`id: randomUUID()`, generado
UNA vez y guardado dentro del `gasto` jsonb del huérfano) ·
`src/lib/cuadra/pg_errores.ts:40-45` (`violaIndice` exige que el nombre del
índice aparezca en el mensaje).

El `id` del gasto se fija en la extracción y **viaja dentro de la fila huérfana**,
así que reinsertar el mismo huérfano no choca contra un índice de negocio: choca
contra la **primary key** (`23505` + `gasto_pkey`). `violaIndice(e,
'uq_gasto_img_hash')` → `false`; `violaIndice(e, 'uq_gasto_cfdi_uuid')` →
`false`; `llegoTarde(e)` → `false`. Cae al `logger.error('huerfano.adjuntar_error')`
de `:1169` y **no entra en `puestos`**, así que `resolverHuerfanos` nunca lo
cierra y `getHuerfanos` (`repo.ts:324`, `.is('resuelto_en', null)`) lo sigue
devolviendo. No hay salida: el siguiente intento produce el mismo choque.

**Escenario, con valores.** V1 abierto. Se le ofrecen 6 huérfanos por
**$16,244.00**; contesta **`sí`**. El bucle inserta 3 (diésel $8,412.00, caseta
$312.00, comida $340.00) y la invocación muere en el cuarto —Vercel corta a los
120 s, o `resolverHuerfanos` (`repo.ts:368`) devuelve error, que **no lanza**—.

- Base: 3 gastos dentro de V1, 6 filas huérfanas con `resuelto_en` nulo.
- Humano: nada, o el «Listo, agregué los 3 ✅» del caso de `resolverHuerfanos`.
- Reintenta `sí` → los 3 primeros revientan por PK, `ok.length = 0`,
  `tarde.length = 0` → lee **«No pude agregarlos ⚙️. Siguen guardados:
  contéstame *sí* otra vez y lo intento.»**
- Cierra V1 con `listo`. En V2 la oferta se repite (`ofrecidoParaViaje` ya no
  coincide, `:1086`), contesta `sí`, **vuelve a reventar por PK** — los ids ya
  existen en V1. El mismo mensaje, otra vez, en cada viaje futuro.
- Obedece a la única salida que le queda y **reenvía las fotos**: OCR nuevo →
  `randomUUID()` nuevo → entran en V2. Con `CUADRA_DEDUP_FOTOS` sin poner
  (default, `:509`) el `img_hash` va en `null` y el índice no colisiona: el
  diésel de **$8,412.00** queda comprobado en V1 **y** en V2.

**Consecuencia:** la base dice que el comprobante está en la liquidación y el
producto le dice al operador, en cada viaje, que no está y que insista. Es el
ancla literal del rubro. Y el desenlace natural —reenviar— duplica $8,412.00
entre dos liquidaciones.

**Causa raíz probable:** el `catch` clasifica el `23505` por los dos índices que
el camino de la FOTO puede producir; el camino de la SALA DE ESPERA puede
producir un tercero (la PK), porque es el único que reinserta una fila con id ya
asignado.

---

### [ALTO] La oferta que pide autorizar dinero no dice de cuándo es cada comprobante, y la ventana de 30 días no lo marca
`src/lib/cuadra/intake/huerfanos.ts:67-77` (`mensajeOfrecer`) y `:20-23`
(`Esperando = { monto, etiqueta }` — la fecha no viaja) ·
`src/lib/cuadra/processor.ts:1087-1090` (`comoLista` descarta `h.creadoEn` y
`h.gasto.fecha`, que `repo.ts:328-336` sí devuelve) ·
`src/lib/cuadra/config.ts:104` (`fechaToleranciaDiasAntes: 30`) ·
`src/lib/cuadra/cuadre/fecha_dudosa.ts:53-63` (`ventanaDelViaje`).

La confirmación humana es **toda** la defensa que la mig. 0040 puso contra «un
ticket del viaje anterior metido en el de hoy». Se le pide al chofer sin darle el
único campo con el que podría contestar bien.

**Escenario, con valores.** **14-jul**: V1 cierra; llegan dos fotos más —diésel
**$6,100.00** con fecha 14-jul y caseta **$312.00**— por `llegoTarde` (`:797`) y
quedan en la sala de espera. **5-ago**: la oficina abre V4 (`fechaInicio` 5-ago,
anticipo $9,000.00). El chofer escribe «hola» y lee:

> Ya tienes viaje abierto (GDL→MTY) ✅
> Tengo 2 comprobantes tuyos que quedaron sin viaje, $6,412.00 en total:
> • Diésel · **$6,100.00**
> • Caseta · **$312.00**
> ¿Los agrego a este viaje? Contesta *sí* o dime cuáles no van. 👍

Ni una fecha. Contesta **`va`** y entran en V4. `ventanaDelViaje(5-ago, 30)` da
`fechaMin = 2026-07-06`, así que 14-jul cae **dentro**: `fechaDudosa` devuelve
`null` y el motor no levanta `fecha_sospechosa`. En el PDF de V4 y en el panel no
queda una sola marca.

**Consecuencia:** $6,412.00 de julio quedan en la liquidación de agosto, con su
IVA y sus litros de diésel acreditados en el periodo equivocado, y el contralor
paga contra un PDF que no lo distingue. Es exactamente el daño que la 0040 dice
existir para impedir; el pase 1 lo cerró por el lado del «va» cruzado (`:1086`) y
lo dejó abierto por el lado del «va» consentido.

**Causa raíz probable:** `mensajeOfrecer` se diseñó para que el chofer pueda
reconocer el ticket por su MONTO, y el monto es justo lo que no lo distingue de
otro viaje.

---

### [MEDIO] El XML que llega tarde se descarta —el único documento del intake que no tiene sala de espera— y se manda al operador a un trámite que no existe (REINCIDENTE de forma, cerrado para la foto)
`src/lib/cuadra/processor.ts:994-997` y `:1036-1039` (los dos `return` del
`llegoTarde` del XML) contra `:1045` (`saveCfdiXmlRaw`, que queda detrás de esos
`return`) · comparar con `:807-816` (la foto tardía SÍ va a la sala de espera) y
con `:315-322` (el XML sin viaje abierto SÍ se conserva).

Los dos mensajes son idénticos y literales: *«El XML que mandaste llegó después de
que cerré tu liquidación, así que NO se aplicó. Guárdalo: mándalo en tu siguiente
viaje o pídele a la oficina que lo agregue.»* Es palabra por palabra el texto que
`intake/huerfanos.ts:36-39` documenta como retirado por mandar a un trámite
inexistente — «no hay forma de que la oficina agregue un comprobante a un viaje
cerrado, ni desde el panel ni desde ningún lado» (verificado: `addGasto` solo se
llama desde `processor.ts`).

**Escenario, con valores.** Meta entrega en el mismo POST el `listo` y el XML del
CFDI de la carga de diésel ($8,412.00, IVA $1,159.45, 412.7 L).
`route.ts:72-76` los corre con `Promise.all`; los dos leen `getOpenViaje` y
obtienen V1. El `listo` gana el mutex y cierra. El XML llega al `addGasto` de
`:1016`, choca con el trigger de la 0036 (`CU001`), se emite ese mensaje y
**`saveCfdiXmlRaw` nunca corre**: el XML crudo se pierde.

**Consecuencia:** el documento que desbloquea el estímulo de IEPS y el IVA
acreditable se tira —el CFF 30 obliga a conservarlo, y el brazo «sin viaje
abierto» lo conserva a tres pantallas de distancia— y al operador se le manda a
pedirle a la oficina algo que la oficina no puede hacer.

**Causa raíz probable:** la sala de espera (0040) se cableó en el brazo de imagen
y no en el de documento; el texto del brazo de documento se quedó en la versión
anterior al arreglo.

---

### [MEDIO] El aviso de barrera vencida promete la misma puerta inexistente, en el único caso en que de verdad faltó un comprobante
`src/lib/cuadra/processor.ts:1616`

```
⚠️ Ojo: cuadré con los N comprobantes que alcancé a procesar. Guárdalo: mándalo
en tu siguiente viaje o pídele a la oficina que lo agregue desde el panel.
```

**Escenario, con valores.** 6 fotos; el OCR de la del hospedaje ($900.00) tarda
34 s y `esperarIntake` vence a los 30 s (`presupuesto.ts`, `TOPE_BARRERA_INTAKE_MS`)
→ `intakeOk = false`. El agente cierra con 5 comprobantes. El operador recibe ese
aviso; segundos después, la foto rezagada choca con la 0036 y el brazo de imagen
le manda `mensajeGuardadoTrasLiquidar` (`:814`): *«no se perdió: te lo agrego en
cuanto abras tu siguiente viaje»*. **Dos instrucciones contradictorias sobre el
mismo ticket en el mismo chat, y la primera es imposible.** Encima el «Guárdalo»
no tiene antecedente: la frase anterior habla de los N que SÍ entraron.

**Consecuencia:** el operador pierde el tiempo con su oficina, que no puede
hacer nada, mientras el sistema ya guardó el comprobante por su cuenta.

**Causa raíz probable:** el mensaje se bifurcó por `closed` en la ronda 8 y no se
revisó cuando la sala de espera cambió lo que de verdad pasa con ese comprobante.

---

### [MEDIO] El huérfano `tras_liquidar` sigue perdiendo el `img_hash`: el arreglo entró en un brazo y no en el gemelo (REINCIDENTE, pase 1)
`src/lib/cuadra/processor.ts:807-811` (`gasto: ruta ? { ...gasto, imagenUrl: ruta }
: gasto` — sin `imgHash`) contra `:357-368` (el brazo `sin_viaje`, donde el hash
se calcula incondicionalmente y sí viaja) · `:508-509` (`imgHash` solo se calcula
si `CUADRA_DEDUP_FOTOS === '1'`, sin poner por default) ·
`src/lib/cuadra/startup.ts:21-27` (`verificarEntornoCritico` solo mira
`DASHBOARD_SECRET`).

El pase 1 reportó que la sala de espera adjuntaba gastos con `img_hash` nulo. Se
arregló el brazo `sin_viaje`; el brazo `tras_liquidar` —que corre con un viaje
abierto y depende de una bandera apagada— quedó igual.

**Escenario, con valores.** V1 ya liquidado. El chofer manda la foto de una
caseta de **$312.00** sin folio legible; WhatsApp marca fallo de envío y la
reenvía (otro `waMessageId`, `claimMessage` no la ve). Dos `addGasto` chocan con
la 0036 → **dos** filas en `comprobante_huerfano`, las dos con `imgHash`
ausente. En V2 se le ofrecen las dos («• Caseta · $312.00» dos veces), contesta
`sí`, y `:1156` inserta dos gastos con `img_hash = null` —NULL no colisiona— y
sin folio, así que `copiasDeComprobante` (`engine.ts:146`, `if (g.folio)`) tampoco
los ve. El comprobado sube **$312.00** de más y `mensajeAdjuntados` (`:1196`) lo
certifica calculando el neto con el mismo dedup ciego.

**Consecuencia:** la diferencia sale a favor del chofer por dinero que no gastó,
con acuse.

**Causa raíz probable:** el hash se movió a incondicional en el camino que lo
había perdido, y en el otro se dejó colgando de una bandera que nadie verifica al
arrancar.

---

### [MEDIO] La memoria de `guardiaFundamento` sigue certificando la cita mal aplicada cuando el modelo elide el sujeto (REINCIDENTE, rondas 8-11 — ahora sí bloquea el sujeto explícito)
`src/lib/cuadra/normas/fundamento.ts:267-290` (`citaEsMismoTema`), veto de sujeto
en `:282-284`, umbral en `:198` · cableado en `src/lib/cuadra/processor.ts:1541-1548`.

**Medido por mí**, ejecutando `guardiaFundamento(reply, [], historial)` con el
historial del motor *«Diésel pagado en EFECTIVO — cuenta contra el tope del 15%
del combustible del ejercicio (RFA 2026 regla 2.9).»*:

| respuesta del modelo, sin ninguna tool en el turno | resultado |
|---|---|
| «Tu **caseta** pagada en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).» | **forzado** — la cita se quita ✅ (era el hallazgo del pase 1) |
| «Sí, **eso** también cuenta contra el tope del 15% del ejercicio (RFA 2026 regla 2.9).» | **pasa entera** ❌ |
| «**También** cuenta contra el tope del 15% del ejercicio, conforme a la RFA 2026 regla 2.9.» | **pasa entera** ❌ |

El veto de `:282-284` recorre `sujetoActual`: si la oración de hoy no nombra
ningún gasto, el bucle no se ejecuta y decide la cuenta de palabras (4
compartidas contra un umbral de 2).

**Escenario, con valores.** V1 con diésel en efectivo por $8,412.00; el motor ya
mandó su observación con la cita. El chofer pregunta **«¿y la caseta de 312
también cuenta para ese tope?»**. Sin `$` en la respuesta, `guardiaCifras` sale en
`guardia.ts:83`, `textoDeterminista` queda `false` (`:1491`) y la guardia de
fundamento corre con `permitidas = []` —el caso en que la memoria decide sola—.
El modelo contesta con el pronombre y la RFA 2026 regla 2.9, que es el tope del
15% del **combustible** en efectivo, queda invocada sobre un peaje.

**Consecuencia:** una cita bien nombrada y mal aplicada, con el sello de la
guardia, frente a un contralor con fiscalista. Reincidente por cuarta ronda,
ahora en el caso más natural del español conversacional.

**Nota, dentro del mismo sitio:** en la fila que SÍ bloquea, lo que sale es *«Tu
caseta pagada en efectivo cuenta contra el tope del 15% del combustible del
ejercicio.»* — la guardia le quita la cita y **deja intacta la afirmación falsa**.
Está dentro del alcance declarado de la función; lo anoto porque quien lea el log
`agent.fundamento_forzado` va a creer que el mensaje quedó saneado.

---

### [MEDIO] Si Vercel corta entre el resumen y el PDF, no queda un solo rastro de que la liquidación cerró sin entregarse (REINCIDENTE, pase 1)
`src/lib/cuadra/processor.ts:1577` (`const entregado = await say(reply)`) ·
`:1612-1622` (el aviso de barrera, hasta 29 000 ms de techo, ANTES del PDF) ·
`:1663` (`createSignedUrl`) · `:1671` (`sendDocument`) · `:1677`
(`pdf.no_entregado`, dentro de un `catch` — solo cubre excepciones, no un
`SIGKILL`) · `:1726` (`cerroSinEntregar`, dentro del `catch` general — tampoco).

`hayPresupuestoPara` protege los pasos opcionales, pero `createSignedUrl` y
`sendDocument` no son opcionales y no consultan el reloj: si la invocación
alcanza `maxDuration` ahí, el proceso muere sin pasar por ningún `catch`. Base:
liquidación cerrada, dos PDF en storage, viaje `liquidado`. Humano: el cuadre y
nada más. Operador de guardia: nada, ni una línea.

**Consecuencia:** el modo de falla «se trabó» que este archivo lleva cuatro
rondas cerrando, en el último tramo que le queda. Es la fila 7 de la tabla.

---

### [BAJO] El claim se toma antes de que exista destinatario, y ahí no hay quien lo libere
`src/lib/cuadra/processor.ts:244` (`claimMessage`) · `:280` (`resolveOperador`) ·
`src/app/api/webhook/whatsapp/route.ts:121` (el 200 se devuelve fuera de
`after()`, así que Meta no reintenta) · `src/lib/cuadra/conv.ts:226-233` (el
propio comentario reconoce que ese reintento no existe).

Si el proceso muere entre esas dos líneas —o `after()` no llega a correr—, la
fila queda en `wa_mensaje_procesado` y el mensaje está perdido: reenviado por el
chofer trae otro `waMessageId`, así que se recupera solo si él insiste. Sin log.
Es la fila 1 de la tabla, y sigue igual que en el pase 1.

---

## Lo que revisé y está bien (con la línea que lo prueba)

- **CRÍTICO del pase 1, `pareceCierre`: CERRADO.** El identificador ya no existe
  en el árbol; `processor.ts:1246` es `if (!ofrecidos.length)` y ofrece siempre,
  con el razonamiento escrito en `:1228-1245`. Fijado por
  `huerfanos_flujo.test.ts:398` y `:407` («ya estuvo» / «es todo» tampoco
  cierran).
- **CRÍTICO del pase 1, el «va» cruzado: CERRADO en el camino que corre.**
  `:1086` filtra por `h.ofrecidoParaViaje === viajeId`; `repo.ts:348` exige
  `viajeId` no opcional en `marcarHuerfanosOfrecidos` y `:335` lo lee de
  `viaje_id`, columna que la 0040 ya tenía. Seguí la cadena hasta la consulta
  (`repo.ts:322`, el `select` incluye `viaje_id`): no hay copia inline que
  esquive el arreglo. Cinco pruebas en `huerfanos_atados_al_viaje.test.ts`.
- **La oferta ya no es de un solo tiro.** `:1268` envía primero y `:1273` marca
  después, con `return` sin marcar si `say` devolvió `false` (`:1269-1272`).
- **El PDF ya tiene acuse.** `meta/client.ts:127-146` devuelve el wamid o `null`
  (y `null` también cuando el 200 viene sin `messages[0].id`), y
  `processor.ts:1672` lo convierte en excepción → `pdf.no_entregado` + el mensaje
  al operador.
- **La recuperación de cierre parcial ya no es una bandera.** `:1454` decide por
  el hecho (`guardar_liquidacion` en `partialToolCalls` sin error), y `:1438-1453`
  registra además el costo de lo que se gastó antes de caerse.
- **El aviso de privacidad distingue los dos hechos.** `ResultadoAviso`
  (`:167`), `sin_datos` vs `no_se_pudo` (`:204`, `:223`, `:238`) y dos textos
  distintos en `:440-442`, con liberación del claim solo cuando reintentar sirve
  (`:454`).
- **El brazo de la sala de espera ya escribe como camino del dinero.**
  `intakeDelta(+1)` en `:1111`, mutex en `:1118`, `llegoTarde` traducido en
  `:1168` con `mensajeAdjuntarTrasCierre`, tope de presupuesto por inserto en
  `:1147` y aviso de cuántos faltaron en `:1201`.
- **El «no» ya promete lo que existe:** `:1224` («reenvíame su foto y lo
  agrego»), que sí funciona por el camino normal, y solo descarta `ofrecidos`
  (`:1214`), no la sala entera.
- **Valor & Ahorro cuenta por `resolucion`, no por `resuelto_en`**
  (`analytics.ts:366-367`), y el asistente ya declara el fallo en vez de
  afirmar vacío (`api/dashboard/asistente/route.ts:69-72`, `motivo`, y 503 en
  `:106`).
- **`/mis-viajes` ya no le enseña al chofer el semáforo del contralor**
  (`page.tsx:29` y `:120-122`).
- **Destinatario.** Los tres llamadores de `resumenCuadre` pasan `'operador'`
  explícito (`processor.ts:1355`, `:1475`, `guardia.ts:114`); el PDF que va por
  WhatsApp es `-operador.pdf` (`:1651`) y el completo queda en
  `liquidacion.pdf_path` (`tools.ts:268-269`). No encontré ruta por la que el
  ejemplar del contralor llegue al chofer.
- **Idempotencia de mutaciones.** `tool-executor.ts:151-175` cachea la PROMESA y
  se llavea por nombre, así que dos `guardar_liquidacion` en la misma ronda se
  enganchan a una sola ejecución; el `crossRound` de `openrouter.ts:820` solo
  cachea lecturas y solo éxitos.
- **El ciclo de tools gasta la última ronda en cerrar** (`openrouter.ts:765-806`,
  `tool_choice: 'none'`) y una respuesta truncada ya no se convierte en
  «Listo. 👍» (`:786-794`).
- **Barrera y mutex.** `intakeDelta` devuelve `null` —no 0— ante error
  (`conv.ts:373`) y `esperarIntake` es fail-closed con gracia de 2 s por default
  (`conv.ts:415-425`); `acquireViajeLock` separa RPC ausente de fallo transitorio
  (`conv.ts:317-327`); el turno re-verifica el viaje tras tomar el lock (`:1328`).
- **`PASOS_CIERRE` ya se puede auditar:** cada fila lleva `simbolo` y
  `presupuesto.test.ts` abre `processor.ts` en esa línea y comprueba que lo
  contenga (`presupuesto.ts:105-114`).
- **Salud del árbol, medida por mí:** `npx tsc --noEmit -p .` → exit 0;
  `npm run lint` → limpio; `npx vitest run` → 2 527 de 2 530 en verde, **2
  fallos en `src/lib/cuadra/intake/ocr_imagen_cara.test.ts:94`** (`expected 1500
  to be 500`) que **pasan al correr ese archivo solo** (4/4 en 7 s): es
  intermitencia bajo carga, no una regresión de mi rubro. Lo dejo señalado para
  *pruebas*, porque la línea base del MAPA dice exit 0.

---

## Lo que NO alcancé a revisar

- **Sigo sin montar el arnés de concurrencia.** Los puntos 4, 5 y el CU001 del
  XML están razonados sobre el código y sobre `route.ts:72` (`Promise.all`), no
  ejecutados con dos `processInbound` en vuelo. Es lo primero que escribiría, y
  es lo mismo que dijeron las rondas 10 y 11-pase-1.
- **No probé el CRÍTICO contra el modelo real.** No corrí el agente (exige
  OpenRouter); la ausencia de guarda determinística sí está verificada línea por
  línea, que es lo que sostiene el hallazgo.
- **El ciclo interno de `openrouter.ts`** (fallback cross-provider, contabilidad
  por ronda, `TruncatedError`) lo miré solo hasta donde `processor.ts:1364-1486`
  lo consume; el resto es del rubro de tool calling.
- **`pegarCodigoEnEspera` / `codigo_pendiente` (0016).** Verifiqué el claim
  atómico (`:84`) y el `foto.pendiente_reclamado_sin_pegar` (`:99`), pero sigo sin
  poder escribir un escenario con valores en el que el emparejamiento equivocado
  mueva dinero, así que no lo reporto.
- **`operacion.ts` y las páginas del encargado**: solo las abrí para confirmar
  que no crean una segunda vía de escritura a `gasto` durante una conversación
  viva. No la crean —y esa ausencia es parte del CRÍTICO de arriba.
