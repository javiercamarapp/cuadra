# Sistema agéntico y orquestación — auditoría 10

**Nota: 3/10** (antes 8). Razón del movimiento: **mirada más profunda** — el
código del ciclo no cambió (`git diff 96dc577..HEAD -- src/lib/cuadra/processor.ts
src/lib/cuadra/conv.ts src/lib/cuadra/cuadre/guardia.ts src/lib/agents/` es
**vacío**), así que nada de esto es regresión de esta ronda: es lo que la ronda
9 no recorrió. Los ocho hallazgos de la ronda 9 **sí cerraron** —los verifiqué
uno por uno, incluida la reversión completa de `foto_pendiente` (mig. 0041,
`drop table`, sin rastro en el camino activo)— y por eso la nota subió a 8. Lo
que la ronda 9 no auditó es la **sala de espera de comprobantes** (mig. 0040,
`comprobante_huerfano`), que se metió en el camino del dinero en esa misma
ronda y hoy contiene los tres estados que el ancla del rubro nombra: la base
dice que al chofer ya se le preguntó cuando nadie le preguntó, y su liquidación
cierra en $0.00 con seis de sus comprobantes guardados en Likida.

> Riesgo mayor de hoy: el chofer que manda su fajo ANTES de que la oficina le
> abra el viaje —la persona exacta para la que se construyó la sala de espera—
> cierra con `listo` y recibe «Comprobado: $0.00 · Sobró $18,000.00 (a favor de
> la empresa)», con sus comprobantes intactos en la base y sin una sola línea
> que los mencione.

## Hallazgos

### [CRÍTICO] «listo» (o «ya») con la sala de espera llena cierra la liquidación en $0 y los comprobantes nunca se ofrecen
`src/lib/cuadra/processor.ts:1058-1065` (la condición está en `:1059`, el
`pareceCierre` en `:1058`); el bloque entero vive en `:1002-1066`, DESPUÉS del
corte por «sin viaje abierto» de `:272`.

```ts
const pareceCierre = /^\s*(listo|ya|ya est[aá]|termin[ée]|…)\b/i.test(msg.text);
if (!ofrecidos.length && !pareceCierre) { …ofrecer…; return; }
```

Escenario, con valores:

1. Martes 18:40. El chofer termina la ruta y **no tiene viaje abierto** (la
   oficina lo abre al día siguiente). Manda 6 fotos: diésel **$8,412.00**,
   casetas **$312.00** y **$180.00**, comida **$340.00**, hospedaje **$900.00**,
   diésel **$6,100.00** = **$16,244.00**. Cada una entra por `:309-334` →
   `guardarHuerfano(motivo:'sin_viaje')`. Recibe UNA vez
   (`:333`, `enEspera.length <= 1`) el mensaje de `huerfanos.ts:26-31`: *«…no se
   pierden: en cuanto tu flota te asigne uno te pregunto si van ahí. 👍»*
2. Miércoles: la oficina abre el viaje V1 con anticipo **$18,000.00**.
3. El chofer, que ya mandó todo ayer, escribe **`listo`**.
4. `enEspera.length = 6`, `ofrecidos.length = 0`, `pareceCierre = true` → la
   condición de `:1059` es **falsa** → el bloque entero se salta sin log y sin
   mensaje. Se sigue a la barrera (`:1071`), al mutex (`:1104`) y al agente.
5. `cuadrar_viaje` corre sobre **cero gastos** —no hay ninguna guarda de "viaje
   sin comprobantes" en `engine.ts` ni en `tools.ts`—, `guardar_liquidacion`
   cierra, y `guardiaCifras` sustituye el texto por
   `resumenCuadre(liq, true, 'operador')`: **«Listo, cuadré tu viaje 👇 ·
   Comprobado: $0.00 · Anticipo: $18,000.00 · Sobró $18,000.00 del anticipo (a
   favor de la empresa)»**, más el PDF.

Estado final: `liquidacion` cerrada con `total_comprobado = 0`, viaje
`liquidado`, y **6 filas en `comprobante_huerfano` con `resuelto_en` nulo y
`ofrecido_en` nulo**. Ya no hay forma de ofrecerlas en ESE viaje: el bloque vive
después del corte de `:272` y cualquier mensaje posterior recibe «No tienes un
viaje abierto». Cuando la oficina abra V2, esos seis comprobantes se ofrecerán
**ahí** — «un ticket del viaje anterior metido en el de hoy es dinero en la
liquidación equivocada», que es literalmente lo que `0040_comprobante_huerfano.sql`
dice existir para impedir.

Segunda puerta, idéntica y con la promesa aún más explícita: los huérfanos
`motivo:'tras_liquidar'` (`:739`) reciben *«no se perdió: lo guardé y te lo
agrego en cuanto abras tu siguiente viaje 📸»* (`huerfanos.ts:42-44`). Si el
primer mensaje del chofer en ese siguiente viaje empieza por `listo`/`ya`, la
promesa se rompe por la misma línea.

**Consecuencia:** al chofer se le descuentan $18,000.00 de anticipo por
comprobantes que sí mandó, que Likida tiene guardados y que el propio producto
le prometió por escrito. Es el ancla del rubro en su forma literal: la base dice
una cosa y el usuario cree otra. Y es demo-visible: el guion enseña justo el
cierre por WhatsApp.

**Causa raíz probable:** la decisión de `:1054-1057` («no interceptar un cierre
con una pregunta, se le vuelve a hacer») supone que habrá un turno posterior; el
cierre es precisamente el turno que garantiza que no lo haya, y nadie mira la
sala de espera en el camino del cierre.

*Intento de refutación:* «el modelo verá cero gastos y no cerrará». No sostiene:
`prompts.ts:27` es explícito («si el operador ya confirmó que terminó, CIERRA en
ese turno… NO le pidas que vuelva a confirmar»), y aun si el modelo se negara,
`guardiaCifras` sustituye el texto por el cuadre determinístico —el chofer lee
«Comprobado: $0.00» igual—. Segunda: «escribiría otra cosa antes». La lista de
`pareceCierre` incluye `ya`, y la persona a la que este mecanismo atiende ya
mandó todo: no le queda nada que escribir salvo un cierre.
`huerfanos_flujo.test.ts:247-254` fija este comportamiento como correcto, así
que hoy es una decisión probada, no un descuido.

---

### [ALTO] La oferta se marca como hecha ANTES de entregarse, y es de un solo tiro: si rebota, nadie vuelve a preguntar
`src/lib/cuadra/processor.ts:1059-1064` (marca en `:1061`, envío en `:1063`) ·
`src/lib/cuadra/repo.ts:297-303`

```ts
if (!ofrecidos.length && !pareceCierre) {
  await marcarHuerfanosOfrecidos(op.tenantId, enEspera.map((h) => h.id));  // :1061
  await say(mensajeOfrecer(comoLista(enEspera), …));                        // :1063
  return;
}
```

`say` **devuelve si el mensaje salió** —para eso se cambió (`:361-366`, con su
propio comentario sobre el `131030` del 1-ago)— y aquí el resultado se tira. Y
la condición de re-oferta es `!ofrecidos.length`: una vez que `ofrecido_en` está
puesto, **el bloque de oferta no puede volver a ejecutarse nunca**.

Escenario, con valores: los 6 huérfanos del hallazgo anterior ($16,244.00). El
chofer escribe «hola» con V1 abierto → `marcarHuerfanosOfrecidos` pone
`ofrecido_en` en las 6 filas → `sendText` devuelve `null` porque Meta rechaza
con `131047` (ventana de 24 h cerrada; el último mensaje del chofer fue ayer) o
`131030`. El chofer **no ve nada**. Cualquier mensaje suyo posterior encuentra
`ofrecidos.length = 6` → `:1059` falso → no se re-ofrece. Solo un «sí» pelado
—respuesta a una pregunta que nunca leyó— los adjuntaría.

Misma familia, punto de muerte exacto: si la invocación muere entre `:1061` y
`:1063` (Vercel corta, `sendText` se cuelga sin techo — `presupuesto.ts:66-71`
avisa de que los envíos de `meta/client.ts` siguen con `fetch` pelado), la base
queda diciendo «ya se le preguntó» sobre una pregunta que nadie hizo.

**Consecuencia:** $16,244.00 de comprobantes existentes en la base, invisibles
para el chofer y para el contralor, y la liquidación cierra sin ellos. El propio
archivo ya pagó esta lección dos veces y las dos veces la escribió al lado: la
constancia del aviso de privacidad va DESPUÉS del envío (`:199-203`) y el turno
del asistente solo se guarda si `entregado` (`:1437-1441`). Este sitio quedó con
el patrón viejo.

**Causa raíz probable:** `marcarHuerfanosOfrecidos` se modeló como
"anti-repetición" (best-effort, `repo.ts:295`) y de hecho es el único registro
de que la conversación pidió algo — un estado de la máquina, no un contador.

---

### [ALTO] La memoria por tema de `guardiaFundamento` sigue certificando una cita bien nombrada y mal aplicada (REINCIDENTE, rondas 8 y 9)
`src/lib/cuadra/normas/fundamento.ts:204-217` (`citaEsMismoTema`), umbral en
`:197` · llamada en `:367` · cableado en `src/lib/cuadra/processor.ts:1293-1300`

El arreglo de la ronda 9 sustituyó la memoria por `norma_id` por una memoria por
"tema": se concede si la oración que trae la cita hoy comparte **≥2 palabras**
(fuera de la cita, quitando 40 palabras de relleno) con la oración que la trajo
antes. Cierra la frase del ejemplo de la ronda 9 y **no la clase**.

Ejecutado contra el código de hoy (`guardiaFundamento(reply, [], historial)`,
`permitidas` vacío, historial = el resumen del motor con *«Diésel pagado en
EFECTIVO — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026
regla 2.9)»*):

| respuesta del modelo, sin ninguna tool en el turno | resultado |
|---|---|
| «Sí, la caseta es deducible al 100%; la regla 2.9 de la RFA 2026 lo permite.» | quitada (y sale mutilada: *«…la 2026 lo permite.»*) |
| **«Tu caseta pagada en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).»** | **PASA ENTERA** |
| **«La comida que pagaste en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).»** | **PASA ENTERA** |

La regla 2.9 de la RFA 2026 es el tope del 15% del **combustible** pagado en
efectivo. Ni una caseta ni una comida están dentro. Y el turno es alcanzable:
verifiqué que `tieneCifrasDeDinero` devuelve `false` sobre esas frases (no hay
`$`), así que `guardiaCifras` sale en `guardia.ts:83` sin forzar,
`textoDeterminista` queda `false` y la guardia de fundamento sí corre — con
`permitidas = []`, que es el caso en que la memoria decide sola.

**Consecuencia:** exactamente el daño que `fundamento.ts:9-12` dice existir para
evitar, «frente a un contralor con fiscalista una cita inventada cuesta más que
un número mal puesto», con el sello de la guardia encima. Basta con que el
chofer pregunte «¿y la caseta también cuenta para ese tope?» después de un
cuadre con diésel en efectivo.

**Causa raíz probable:** la memoria sigue sin atar la cita a la AFIRMACIÓN; la
ata al vocabulario. Y el vocabulario compartido lo puso el propio sistema en el
turno anterior, así que el modelo que reformula la frase del sistema aplicándola
a otro gasto obtiene la memoria **por reformularla bien**.

---

### [MEDIO] El brazo de la sala de espera no toma la barrera ni el mutex, y su `addGasto` es el único que no distingue "llegó tarde"
`src/lib/cuadra/processor.ts:1010-1026` (el `catch` en `:1019-1024`) ·
`src/lib/cuadra/pg_errores.ts` (`llegoTarde`, CU001)

El bloque de huérfanos corre **antes** de `esperarIntake` (`:1071`) y **antes**
del mutex (`:1104`), y no hace `intakeDelta(+1)`. Es el único camino que
inserta gastos sin ninguna de las dos protecciones: la foto tiene el contador
(`:414`), el XML tiene contador **y** mutex (`:861`, `:889`).

Escenario, con valores: el chofer contesta «sí» a la oferta de 17 huérfanos
(`$28,041.15`) y 3 s después escribe «listo». Los dos mensajes corren en
paralelo (`route.ts:72`, `Promise.all`, o dos invocaciones a la vez). El «listo»
ve el contador de intake en 0 —los huérfanos no lo tocan—, pasa la barrera, toma
el mutex y cierra. Los `addGasto` que aún no habían corrido chocan con el
trigger de la 0036 (`CU001`): el `catch` de `:1019` solo reconoce
`uq_gasto_img_hash` y `uq_gasto_cfdi_uuid`, así que `llegoTarde(e)` no se
evalúa, la fila no entra en `puestos`, y el chofer recibe **«No pude agregarlos
⚙️. Siguen guardados; lo intento otra vez en un momento.»** (`:1043`).

Ese reintento **no existe**: no hay cron (no hay `vercel.json`), no hay job, y
la re-oferta está bloqueada por el hallazgo anterior (`ofrecido_en` ya está
puesto). Con el viaje ya liquidado, el siguiente mensaje del chofer recibe «No
tienes un viaje abierto».

**Consecuencia:** el chofer se queda esperando un reintento inventado mientras
su liquidación ya cerró sin esos comprobantes. Y el mensaje es lo único que
existe: los otros dos brazos traducen CU001 a la verdad («llegó después de que
cerré tu liquidación»), éste no.

**Causa raíz probable:** la sala de espera se modeló como un flujo de
conversación (pregunta/respuesta) y no como una escritura al camino del dinero,
que es lo que es.

---

### [MEDIO] Un comprobante de la sala de espera entra sin `img_hash`: el tercer candado del dedup no lo cubre
`src/lib/cuadra/processor.ts:321-324` (se guarda `ex.gasto`, que nunca lleva
`imgHash` — ver `intake/ocr.ts:375`) · `src/lib/cuadra/repo.ts:148`
(`img_hash: g.imgHash ?? null`) · `src/lib/cuadra/cuadre/engine.ts:156`
(`if (g.folio)` — sin folio no hay dedup)

En el camino sin viaje no hay ningún dedup: `guardarHuerfano` es un `insert`
pelado y `0040_comprobante_huerfano.sql` no tiene índice único. El hash de la
imagen SÍ se calcula (`:313`, para `subirComprobante`) y se tira.

Escenario, con valores: sin viaje abierto, el chofer manda la foto de una caseta
de **$312.00** cuyo ticket no trae folio legible; WhatsApp marca fallo de envío
y él la reenvía (`waMessageId` distinto → `claimMessage` no lo ve) → **dos**
filas en `comprobante_huerfano`. Al abrir el viaje se le ofrecen las dos («•
Caseta · $312.00» dos veces), contesta «sí», y `addGasto` inserta dos gastos con
`img_hash = null` (el índice `uq_gasto_img_hash` no colisiona con NULL) y sin
folio → `copiasDeComprobante` no los ve → el comprobado sube **$312.00** de más,
y `mensajeAdjuntados` lo confirma («En este viaje llevas … comprobado»)
calculando el neto con el mismo dedup ciego.

**Consecuencia:** la diferencia sale a favor del chofer por dinero que no gastó.
Es la misma causa raíz del MEDIO de la ronda 9 («el `img_hash` del par fusionado
es el del acercamiento») por otra puerta: aquel murió con `foto_pendiente`, éste
sigue vivo. El reenvío manual no es hipotético — el 1-ago se midió un fajo donde
DIEZ fotos fueron rechazadas por ese índice.

**Causa raíz probable:** `imgHash` se calcula en el camino de la foto con viaje
y se pega en el `addGasto` de allí; la sala de espera se escribió con
`ex.gasto` crudo y nadie movió el hash con él.

---

### [MEDIO] El chofer ve en `/mis-viajes` el semáforo que se construyó para el contralor
`src/app/mis-viajes/page.tsx:8-12` y `:80` · `src/lib/cuadra/cuadre/engine.ts:1070-1072`
· `src/lib/cuadra/cuadre/resumen.ts:24-33`

`SOLO_CONTRALOR` filtra del WhatsApp los veredictos que el chofer no puede
arreglar y que además lo señalan (`cfdi_efos`, `cfdi_cancelado`,
`rfc_receptor`…). Esos mismos tipos están en la lista `REVISAR` de
`engine.ts:1070`, que produce `estatus = 'revisar'`, y `/mis-viajes` pinta ese
estatus con `--color-bad` y la etiqueta **«Por revisar»**.

Escenario, con valores: viaje V1, comprobado $16,244.00, cuadra exacto contra el
anticipo; la única diferencia es `cfdi_efos` —la gasolinera está en la lista 69-B
del SAT—. Por WhatsApp el chofer recibe el resumen **sin** esa observación (es
correcto, `resumen.ts:67`). Entra a `/mis-viajes` y ve su viaje en **rojo, «Por
revisar»**, sin nota, sin explicación y sin nada que pueda hacer.

**Consecuencia:** el canal nuevo del chofer entrega justo «la sensación de que
se le está auditando» que `resumen.ts:14-22` argumenta por escrito que hay que
evitarle, y sin la información que la haría accionable. No se filtra el
veredicto (la tabla no selecciona `diferencias`), se filtra su semáforo.

**Causa raíz probable:** el mapa `ESTATUS` se copió tal cual de
`dashboard/[id]/page.tsx:25-29` —el panel del contralor— sin pasar por la
pregunta de destinatario que el resto del sistema sí se hace.

## Lo que revisé y está bien

- **Los ocho hallazgos de la ronda 9, verificados en el código y no en el
  commit.** (1) `foto_pendiente` está revertido de verdad: `0041` hace
  `drop table` y en `processor.ts` solo queda el comentario de `:494-505`; no
  hay una sola llamada viva a `reclamarFotoPendiente`/`guardarFotoPendiente`
  (grep sobre `src/`). Con eso mueren los tres hallazgos del mecanismo (CRÍTICO
  + 2 ALTO) y los dos MEDIO que colgaban de él. (2) El aviso de barrera vencida
  ya no afirma un cuadre que no ocurrió: `:1360-1366` bifurca la frase ENTERA
  por `closed`. (3) El XML toma el mutex del viaje (`:889`) y avisa en vez de
  proceder sin exclusividad; `xml_race_mutex.test.ts` lo fija.
- **El destinatario en el canal de WhatsApp.** Los tres llamadores de
  `resumenCuadre` pasan `'operador'` explícitamente (`:1144`, `:1227`,
  `guardia.ts:114`); el default `'contralor'` está razonado en la dirección
  segura. Los dos PDF salen del mismo cierre (`tools.ts:176-177`) y el que va
  por WhatsApp es `-operador.pdf` (`:1399`), mientras `liquidacion.pdf_path`
  guarda el del contralor. `api/export/pdf/[id]` sigue entregando el ejemplar
  del contralor detrás de sesión. No encontré ruta por la que el ejemplar
  completo llegue al chofer.
- **Los cinco roles no tocan el ciclo de WhatsApp.** `processInbound` resuelve
  al chofer por `operador` (tabla de WhatsApp) y nunca por `app_user`; ningún
  mensaje del ciclo sale a un teléfono que no sea `msg.from`. `permisos.ts` es
  fail-closed ante un rol desconocido y `requireOperador` manda a `/dashboard`,
  no a `/sin-acceso`, a quien sí tiene otro panel.
- **Presupuesto y muerte por tiempo.** El reloj arranca en la primera línea útil
  (`:239`), `PRESUPUESTO_WEBHOOK_MS` está sincronizado con `maxDuration` por
  prueba, el agente se salta con el resumen determinístico si no alcanzan 15 s
  (`:1140-1150`), y `acotada` cubre repo, conv, costos, config y
  `createSignedUrl`.
- **Claim, mutex y barrera.** `claimMessage` distingue los tres estados y el
  `indeterminado` sigue en vez de perder el mensaje; los `return` que abandonan
  trabajo real liberan el claim (`:428`, `:865`, `:1111`, `:1471`);
  `acquireViajeLock` separa error permanente de transitorio y re-verifica el
  viaje tras tomarlo (`:1117`); `intakeDelta` devuelve `null` —no 0— ante error
  y `esperarIntake` es fail-closed con gracia de 2 s.
- **`turns` sigue acotado al viaje** (`conv.ts:200-204`) y el turno del
  asistente solo se guarda si `say` devolvió id (`:1437-1441`).
- **Orden de las guardias.** `guardiaCifras` sustituye siempre que hubo
  `cuadrar_viaje`/`guardar_liquidacion` usando el snapshot de la tool;
  `guardiaFundamento` y `guardiaEstado` no corren sobre texto ya determinístico.
  El prompt invita a narrar cifras (`prompts.ts:25`), pero el determinismo lo
  impone el código.
- Salud del árbol, comprobada por mí: `npx tsc --noEmit` limpio,
  `npm test` 173 archivos / 1629 pruebas en verde (35 s).

## Lo que NO alcancé a revisar

- **No monté un arnés de concurrencia.** El MEDIO de la sala de espera vs. el
  cierre está razonado sobre el código y sobre `route.ts:72`, no ejecutado con
  dos `processInbound` en vuelo. Ese arnés es lo que convertiría ese hallazgo
  (y el CRÍTICO) en pruebas en rojo, y es lo primero que escribiría.
- **`/admin` y su chat.** Lo abrí lo justo para descartar que hubiera un segundo
  agente: `admin/chat.tsx` es coincidencia de palabras clave contra un resumen
  ya calculado en el servidor, sin LLM y sin tools. Todo lo demás de `/admin`
  queda para arquitectura y seguridad.
- **`pegarCodigoEnEspera` / `codigo_pendiente` (mig. 0016) a fondo.** Verifiqué
  el claim atómico y el log de `reclamado_sin_pegar`, y noté que
  `emparejarPendiente` (`emparejar.ts:98-101`) exige unicidad en la BANDEJA pero
  no entre los tickets candidatos, al revés que su gemela `emparejarPorMonto`.
  No conseguí escribir un escenario con valores donde eso mueva dinero (dos
  casetas del mismo total intercambian folio, sin cambiar el comprobado), así
  que no lo reporto.
- **El ciclo de tool-calling de `openrouter.ts`** (loop-guard, rondas,
  construcción de `PartialExecutionError`): lo di por bueno del rubro de tool
  calling, salvo su consumo en `:1187-1231`, que sí recorrí.
- **La reasignación de chofer** (`repo.ts:110-116`) solo la miré desde el
  destinatario: no valida que `operadorId` pertenezca al tenant y la policy
  `operador_ve_su_viaje` (mig. 0045) no lleva predicado de tenant. Es de
  seguridad/backend, no del ciclo agéntico, y lo dejo señalado sin reportarlo
  aquí.
