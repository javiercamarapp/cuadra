# Backend y API — auditoría 16

**Nota: 6.5/10** (antes 7). Razón del movimiento: **deuda pagada a medias y
deuda nueva a cuestas**. Los fixes de la ronda 15 (`96f2adc`) son reales y los
verifiqué abriendo el código y con pruebas propias: el ALTO #1 (panel "sin
declarar" como pérdida) está cerrado (`fiscal.ts:336-338` ahora distingue
`false` de `undefined` y el motor/panel coinciden en "por confirmar"), el
MEDIO #2 (la rama `total=0` ya no afirma "excede el tope de $0.00") está
cerrado con su rama fail-closed y 3 pruebas nuevas que pasan, el MEDIO #3
(ancla de año) quedó cerrado para `tools.ts` y `desde_db.ts` con el MISMO año
del viaje, el MEDIO #4 (recuadro del 15%) honra la declaración, y
`actualizarFacilidad15` comprueba su error de lectura. Todo eso lo confirmé
con suites del rubro: engine+periodo+resumen (153 verdes), pdf+fiscal (70),
cierre+aviso (39), administracion+tenant-efectivo (72) — 334 pruebas en
primera pasada, `tsc` limpio en cero.

Lo que baja la nota —tres cosas, cada una de una familia distinta—:

1. **El propio fix de la ronda 15 abrió una puerta fail-OPEN**: la rama nueva
   del motor hace `continue` sobre el gasto, así que cuando el contador del
   ejercicio no responde, el motor deja de evaluar TODO lo demás de ese
   comprobante — un CFDI **cancelado** o timbrado a un **tercero** pasa de
   "no deducible" (hecho duro que el motor SÍ tiene en la mano) a "por
   confirmar" (probado con el motor: `cfdi_cancelado` desaparece de las
   diferencias y `totalNoDeducible` cae a 0). El fix curó la mentira "excede
   contra $0" y sembró la opuesta: callarse los veredictos que sí podía
   afirmar.
2. **La ronda 16 desmintió su propia pantalla**: `c901226` hizo que
   `resolverSolicitudArco` INTENTE enviar la respuesta por WhatsApp, pero la
   pantalla de `/admin/compliance` —que no se tocó— sigue jurando "Likida no
   envía mensajes ARCO todavía (anotado para la ronda siguiente)" y **tira el
   resultado del envío**. El superadmin lee un rótulo falso mientras el
   titular quizá ya recibió el WhatsApp. Es la misma familia de rótulo-que-no-
   es-verdad que este rubro persigue hace cinco rondas, recién re-sembrada por
   el propio release.
3. **Los cierres a medias de la ronda 15 siguen a medias**: el MEDIO #5
   (`cubetaDe` clasifica el excedente del 15% como `deducible`, confirmado
   con el motor: cubeta `deducible` contra `totalNoDeducible=5000`), el BAJO
   #6 (`SOLO_CONTRALOR` sin los veredictos del 15%), el BAJO #7
   (`efectivoDeEsteViaje` resta lo que el contador nunca sumó), el BAJO #8
   (los dos `.maybeSingle()` sin mirar `error`), y el BAJO #9 (el cosmético
   "Las 9 llaves" cuando ya son 10) — ninguno fue atacado.

**Método:** código actual en HEAD (`c901226`), línea por línea; verifiqué los
cierres de la ronda 15 contra `docs/auditoria-15/backend.md` abriendo cada
archivo y con pruebas temporales (borradas al terminar: `aud16-probe`); corrí
las suites del rubro (334 pruebas, verdes); `tsc` limpio. **No hice git
commit, no toqué la base, no desplegué.**

---

## CRÍTICO

No encontré un CRÍTICO demostrable. El camino del dinero sigue razonado y
probado (cierre atómico, motor determinístico, RLS, fallo por valor corregido
en las rondas anteriores), y ninguno de los hallazgos de abajo fabrica una
cifra en la liquidación persistida ni deja escapar datos entre tenants. El
ALTO #1 es una contradicción de rótulos y un resultado tirado, no una fuga.

## ALTO

### 1. `/admin/compliance` jura "Likida no envía mensajes ARCO todavía" DESPUÉS de que la ronda 16 implementó el envío — y tira el resultado

`src/app/admin/compliance/page.tsx:40-45`:

```ts
await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);
...
return { ok: 'Solicitud marcada como resuelta. La respuesta se entrega al titular por el canal que la flota defina — Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente).' };
```

El mensaje se escribió en `96f2adc` (cuando el envío NO existía y era honesto),
y `c901226` —el commit que creó `enviarRespuestaArco` y lo conectó en
`resolverSolicitudArco` (`repo.ts:1001-1008`)— no tocó esta pantalla. El
resultado: el superadmin resuelve una solicitud ARCO desde /admin, el código
SÍ manda el WhatsApp al titular (texto libre o plantilla, `repo.ts:1002-1006`),
y la UI le contesta que "no se envía todavía". Es el MISMO defecto que la ronda
15 cerró en esta pantalla (el mensaje anterior juraba "el titular recibió su
respuesta por WhatsApp" cuando no se enviaba nada) — ahora por la otra puerta:
se niega un envío que sí ocurrió. Y al descartar el `{enviada, error}` que la
función devuelve, el panel tampoco puede decir si el titular recibió algo.

La página gemela (`/dashboard/arco/page.tsx:37-43`) SÍ consume el resultado y
dice la verdad ("se envió" vs "entrégala por otro canal") — la misma función,
dos verdades, en el mismo release. Un superadmin que resuelva la solicitud
sembrada para el demo desde /admin leerá "no se envía todavía" mientras el
teléfono del titular recibe el mensaje, o peor: nadie revisa la entrega porque
el panel dijo que no había envío que revisar.

**Escenario con valores:** la solicitud ARCO de prueba sembrada en la base real
(6-ago). El superadmin la resuelve en /admin/compliance con una resolución de
10 caracteres. `resolverSolicitudArco` envía el texto al `titular_ref` (el
wa_id `521...` normalizado), Meta acepta (200), `enviarRespuestaArco` devuelve
`{ok:true}` — y la pantalla imprime "Likida no envía mensajes ARCO todavía".
El titular tiene la respuesta en el teléfono; el registro de cumplimiento dice
que no se envió nada.

**Estado: abierto** (regresión de `c901226` sobre el cierre de la ronda 15).
Fix de una línea: consumir `const r = await resolverSolicitudArco(...)` y
devolver el mismo mensaje honesto que `/dashboard/arco`; el texto "no envía
todavía" ya no es verdad en ninguna rama.

## MEDIO

### 2. La rama fail-closed del 15% hace `continue` y se traga los veredictos DUROS que el motor sí tiene — un CFDI cancelado pasa a "por confirmar"

`src/lib/cuadra/cuadre/engine.ts:306-330`:

```ts
if (!mismoEjercicio || !(total > 0)) {
  ...
  diferencias.push({ tipo: 'combustible_efectivo', ..., gastoId: g.id });
  continue;   // ← engine.ts:324
}
```

El `continue` se salta TODO lo demás del bucle para ese gasto: `estadoSat`
(cfdi_cancelado/cfdi_no_encontrado), `efos`, `rfc_receptor` (factura a nombre
de un tercero), `complemento_hidrocarburos` (con fecha exigible), `sobre_
politica`, `sin_cfdi`, `fecha_sospechosa`, `folio_verificar`. El gasto cae en
`por_confirmar` (`combustible_efectivo` ∈ `POR_CONFIRMAR`) aunque el motor
tenga en la mano la prueba de que es NO deducible. El fix de la ronda 15 curó
"afirmar un exceso contra un tope de $0 que no se midió" y sembró el
complementario: **no afirmar lo que sí se midió**.

**Confirmado empíricamente** (probe temporal, borrada): `cuadrarViaje({facili
dad15: true, totalCombustibleEjercicio: 0, gastos: [diésel $5,000 efectivo,
cfdiUuid, estadoSat: 'cancelado', fecha 2026-07-15], anioEjercicio: '2026'})`
→ diferencias `['combustible_efectivo']`, **sin `cfdi_cancelado`**,
`totalNoDeducible: 0`, `totalPorConfirmar: 5000`, estatus `revisar`. Antes del
fix, ese mismo gasto salía `cfdi_cancelado` → `totalNoDeducible: 5000`. El
mismo probe con `rfcReceptor` de un tercero: `['combustible_efectivo']`, sin
`rfc_receptor`.

**Escenario con valores:** flota elegible, bache de red en
`getAcumuladoCombustible` (o tenant con >100,000 cargas en el ejercicio —
`repo.ts:877-880` lanza fail-loud) → `desde_db.ts:79-82` inyecta ceros → el
motor manda TODO el diésel en efectivo a "por confirmar" — incluido el CFDI
cancelado de $5,000 que el papel anterior imprimía "no deducible". El
contralor ve la cubeta ámbar y asume que todavía puede moverse algo que el SAT
ya cerró.

**Estado: abierto** (regresión del propio cierre `96f2adc`). El fix es
estructural: la rama fail-closed debería emitir SOLO la diferencia del 15% y
dejar que el gasto siga por el resto del bucle, o al menos correr antes las
verificaciones de hechos duros (estadoSat/efos/rfc).

### 3. La pantalla ARCO de /dashboard traga el error de lectura y afirma "Ninguna solicitud ARCO registrada" a ciegas — en una página con plazos legales

`src/app/dashboard/arco/page.tsx:47`:

```ts
const solicitudes = await listarSolicitudesArco(tenantId).catch(() => []);
```

Es el patrón exacto que este repo prohibió en la ronda 13 (fallar cerrado y
decirlo): un bache de red se lee como "no hay nada" y la página —la única
ventana que la FLOTA tiene sobre sus obligaciones ARCO, con vencimientos de 20
días hábiles— enseña el `EstadoVacio` "Ninguna solicitud ARCO registrada"
cuando está ciega. El contador "Por responder" y "Vencen pronto" también
pintan cero. La flota que no puede leer su bandeja cree que no debe nada, y el
siguiente aviso es la autoridad. La página gemela de /admin hace lo mismo
(`admin/compliance/page.tsx:159-164`, `.catch(() => [])` en las dos lecturas),
y el resto del panel usa el patrón correcto (`safe(...)` + `AvisoDeFallo`,
como `contador/combustible/page.tsx:22-24`).

**Escenario con valores:** Supabase tose a las 9:00. La flota abre
/dashboard/arco y lee "Ninguna solicitud ARCO registrada" con 2 solicitudes
por vencer en la base. El jefe de tráfico no contesta nada; la solicitud vence
el día 20 sin que nadie la haya visto. La base decía la verdad; la pantalla
mintió por no revisar `error`.

**Estado: abierto** (nuevo, `c901226`).

### 4. El parámetro {{1}} de la plantilla `respuesta_arco` está hardcodeado como "la flota" — el mensaje legal nombrará mal al responsable el día que Meta la apruebe

`src/lib/meta/client.ts:467`:

```ts
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```

El comentario de la misma función dice "{{1}} = razón social de la flota"
(`client.ts:460-462`). El código no manda la razón social de NINGUNA flota:
manda el placeholder literal "la flota". El día que Meta apruebe la plantilla
(está "en revisión" desde el 6-ago), la respuesta ARCO que reciba el titular
dirá "Tu solicitud de derechos ARCO fue atendida por *la flota*" — sin nombre
de la empresa responsable, que es justo el dato que la LFPDPPP (art. 15 fr. I
y la propia respuesta por texto libre de `repo.ts:1003`) sí entrega. Y no hay
razón social disponible en el call site actual: `resolverSolicitudArco`
(`repo.ts:994-1008`) no consulta `tenant.razon_social` — tendría que
traerla para que el parámetro diga la verdad.

**Escenario con valores:** plantilla aprobada; la flota responde una solicitud
de cancelación fuera de la ventana de 24h. El titular recibe "…fue atendida
por la empresa: la flota" donde debería decir "Transportes Innovativos S.A. de
C.V.". Un documento legal que no dice quién lo emite.

**Estado: abierto** (nuevo, `c901226`; inalcanzable hoy solo porque la
plantilla aún no está aprobada — es una mentira en espera).

### 5. `cubetaDe` —"LA ÚNICA definición de en qué cubeta cae un gasto"— sigue clasificando el excedente del 15% como DEDUCIBLE — MEDIO #5 de la ronda 15, sin atacar

`src/lib/cuadra/cuadre/engine.ts:100`: `efectivo_sobre_15` NO está en
`NO_DEDUCIBLE_ISR` (ni en `POR_CONFIRMAR`), así que `cubetaDe`
(`engine.ts:118-123`) devuelve `'deducible'` para el gasto cuyo excedente el
propio motor acaba de declarar no deducible. Los totales se salvan por
`proporcionDeducible` (`engine.ts:321`), pero el consumidor exportado —el PDF,
`liquidacion/pdf.ts:374`, que arma `idsNoDeducibles` para "LO QUE SE LE
REEMBOLSA AL OPERADOR" (`pagadero.ts`)— no ve el excedente: el renglón de
reembolso omite el dinero del 15%, y la sección puede desaparecer entera en un
papel que dos pulgadas arriba imprime "No deducible: $5,300.00".

**Confirmado empíricamente** (probe temporal, borrada): viaje con un solo
gasto diésel efectivo $5,000, CFDI, flota elegible, previo $2,000, total
$10,000 → `efectivo_sobre_15(5000)`, `totalDeducible: 0`,
`totalNoDeducible: 5000`, y `cubetaDe` del MISMO gasto → `'deducible'`. El
papel imprimiría "No deducible $5,000" y el renglón de reembolso trataría el
gasto como deducible.

**Estado: abierto** (residual de la ronda 15, verificado en HEAD).

### 6. La tool `cuadrar_viaje` sigue SIN las claves SAT — MEDIO #3 (b) de la ronda 15, sin atacar

`src/lib/cuadra/tools.ts:109`:

```ts
const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
```

El fix de la ronda 15 alineó el AÑO (`tools.ts:104-108` lee `viaje.fechaInicio`
— bien, lo verifiqué) pero no las CLAVES: `getAcumuladoCombustible` sin claves
filtra SOLO `concepto='diesel'` (`repo.ts:828-829`), mientras el motor
(`desde_db.ts:78`) cuenta también por `clave_prod_serv` (15101505/14/15). El
denominador del chat y el del motor siguen divergiendo en el MISMO turno.

**Escenario con valores:** flota con 3 gastos de diésel por clave SAT pero
clasificados `otro` por el OCR. El motor cierra el viaje con el contador al
40% de efectivo; el agente, en el mismo turno, consulta `cuadrar_viaje` y su
capa de periodo le reporta 55%. Dos cifras para el mismo hecho en la misma
conversación — el escenario exacto que la ronda 15 prometió cerrar.

**Estado: abierto** (cierre parcial del MEDIO #3 de la ronda 15).

## BAJO

### 7. `resolverSolicitudArco` marca `resuelta` ANTES de intentar el envío, y una entrega fallida no deja rastro para reintentar

`src/lib/cuadra/repo.ts:986-1008`: el `update({ estado: 'resuelta',
resuelta_en, resolucion })` corre antes del envío best-effort. Cuando el envío
falla (fuera de la ventana de 24h y plantilla en revisión — el caso NORMAL en
producción, porque la flota tiene 20 días hábiles), la solicitud queda
`resuelta` en la base, sale de "Por responder" (`arco/page.tsx:48` filtra
`recibida|en_proceso`), y no existe estado "por entregar" ni mecanismo de
reintento: la UI dice "entrégala por otro canal" y si la flota se olvida, el
registro oficial sigue diciendo resuelta y nadie vuelve a preguntar. La UI es
honesta con el humano que está delante; el registro y la cola no lo son con el
que viene después.

**Estado: abierto** (nuevo, `c901226`).

### 8. El fallback de teléfono en `resolverSolicitudArco` es un UUID

`src/lib/cuadra/repo.ts:994`:

```ts
const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;
```

`operador_id` es un UUID, no un número: si `titular_ref` viniera null (una
solicitud registrada por otro canal sin teléfono), `destinatarioWhatsApp` se
comería los dígitos del UUID y mandaría la respuesta a un número aleatorio de
8-14 dígitos. Meta lo rechazará (fail-cerrado por suerte), pero el intento va
a un destinatario inventado. Hoy `titular_ref` siempre es el teléfono
(`processor.ts:157-162` lo pasa como `titularRef: telefono`), así que la rama
es código muerto peligroso: mejor devolver `{enviada:false, error:'sin
teléfono'}` sin intentar.

**Estado: abierto** (nuevo, `c901226`).

### 9. El MEDIO #1 de la ronda 13 sigue cerrado en 1 de sus 3 sitios — y ahora son 4

`src/lib/auth/tenant-efectivo.ts:121-122` y
`src/app/api/dashboard/asistente/route.ts:57-60` siguen con `const { data: t }
= … .maybeSingle()` sin mirar `error` — el parpadeo de red deja `data` null y
el superadmin ve el panel de la flota DEMO con un `?tenant=<flota real>` en la
URL (el escenario completo de la ronda 15, BAJO #8, sin tocar). Y la ronda 16
agregó un CUARTO sitio del mismo patrón: `admin/compliance/page.tsx:38`
(`const { data: sol } = … .maybeSingle()` sin revisar `error`) — con un bache
de red, "La solicitud no existe." sobre una solicitud que sí existe.

**Estado: abierto** (residual de la ronda 13, ahora en 4 sitios).

### 10. `efectivoDeEsteViaje` resta lo que el contador del ejercicio nunca sumó — BAJO #7 de la ronda 15, sin atacar

`src/lib/cuadra/cuadre/desde_db.ts:84-88`: la resta del previo suma TODOS los
gastos del viaje en efectivo-diésel — duplicados incluidos (el motor los
excluye, `engine.ts:275`), montos ≤ 0 incluidos (el motor los excluye,
`engine.ts:279-282`), y gastos SIN FECHA o de otro año incluidos, que
`getAcumuladoCombustible` nunca contó (filtra por la ventana del ejercicio,
`repo.ts:830-832`). Un ticket duplicado reduce el previo y agranda el cupo del
viaje de hoy; un gasto sin fecha ESCAPA del 15% por completo. Se autocorrige
en la siguiente liquidación; hoy regala un poquito de espacio.

**Estado: abierto.**

### 11. `SOLO_CONTRALOR` sigue sin los veredictos del 15% — BAJO #6 de la ronda 15, sin atacar

`src/lib/cuadra/cuadre/resumen.ts:24-38`: `SOLO_CONTRALOR` no incluye
`efectivo_sobre_15` ni `efectivo_no_elegible`, así que el resumen que el cierre
le manda al CHOFER (`processor.ts:1939`, `resumenCuadre(…, 'operador')`) le
enseña "la flota declaró que NO califica… no deducible" y "el excedente de $X
de ESTE comprobante NO se deduce" — decisiones de la flota que el operador no
puede arreglar. El aviso al jefe sí los clasifica (`cierre_aviso.ts`); el del
chofer no.

**Estado: abierto.**

### 12. Cosmético: "Las 9 llaves" cuando ya son 10, en la 0082 y en la 0083 — BAJO #9 de la ronda 15, sin atacar

`supabase/migrations/0083_config_facilidad15_forma.sql:17-20` (y la 0082):
el comentario dice "Las 9 llaves de CuadraConfig" y `llaves_ok` ya trae 10
(`facilidadCombustibleEfectivo` es la décima). La 0083 cumplió su función real
(la FORMA se valida); esto es el rastro que la ronda 13 marcó como clase de
error.

**Estado: abierto.**

### 13. La ruta nueva `/dashboard/arco` y su envío de WhatsApp no tienen una sola prueba

Ni `enviarRespuestaArco` (`meta/client.ts:435-479`) ni `resolverSolicitudArco`
(`repo.ts:973-1009`) ni la página tienen tests (lo verifiqué con grep: cero
archivos de prueba tocan esos símbolos). El resto del camino de dinero de este
repo tiene su suite; el camino nuevo —una comunicación legal con plazos, que
dispara un fetch a Meta y escribe el estado de una obligación— no tiene
ninguna. `resolverSolicitudArco` es testeable con un mock del import dinámico;
hoy una regresión en el orden "marcar resuelta / enviar" no la cazaría nadie
(ver MEDIO de hecho, el ALTO #1 ya es una regresión así, viva).

**Estado: abierto** (nuevo, `c901226`).

---

## Ronda 15, verificada en el código actual: cierres y parciales

Los abrí uno por uno contra HEAD.

- **ALTO #1 (panel: "sin declarar" pintado como pérdida) — CERRADO de verdad.**
  `fiscal.ts:336-338`: `if (o.elegible15 === false) push('efectivo_no_
  elegible'); else push('combustible_efectivo')` — `undefined` cae en
  `combustible_efectivo` (`gravedad: 'en_riesgo'`, `fiscal.ts:281-285`), el
  panel lo cuenta en "En riesgo" (`contador/page.tsx:195`) y ya no en "Ya no
  se recupera" (línea 196). El motor y el panel vuelven a decir lo mismo para
  el estado sin declarar.
- **MEDIO #2 (la rama `total=0` afirmaba "excede el tope de $0") — CERRADO.**
  `engine.ts:306-330`: con `total <= 0` o comprobante de otro ejercicio, el
  gasto va a `combustible_efectivo` con nota honesta ("no se pudo calcular el
  total… no se evaluó") y `continue`; las 3 pruebas nuevas de
  `engine.test.ts:1524-1562` lo fijan y las corrí (verdes). PERO el `continue`
  es el MEDIO #2 de esta ronda: se llevó los veredictos duros por delante.
- **MEDIO #3 (año del reloj) — PARCIAL.** `tools.ts:104-108` ahora ancla el
  año a `viaje.fechaInicio` — el escenario dic-2026/en-2027 queda resuelto en
  las DOS capas. La mitad (b) —las claves SAT— sigue abierta (MEDIO #6 de esta
  ronda).
- **MEDIO #4 (recuadro del 15% para flotas no elegibles) — CERRADO.**
  `contador/combustible/page.tsx:155-166`: ramas explícitas para `false`
  (rojo, "no es deducible") y `undefined` (ámbar, "sale a revisión… declárala").
  El Gauge se sigue pintando para flotas no elegibles, pero con la nota roja
  debajo — aceptable.
- **MEDIO #5 (cubetaDe / efectivo_sobre_15) — ABIERTO** (MEDIO #5 de esta
  ronda, confirmado con probe).
- **BAJO #6 (SOLO_CONTRALOR) — ABIERTO** (BAJO #11 de esta ronda).
- **BAJO #7 (efectivoDeEsteViaje) — ABIERTO** (BAJO #10 de esta ronda).
- **BAJO #8 (tenant-efectivo + asistente) — ABIERTO** (BAJO #9 de esta ronda,
  con un cuarto sitio nuevo).
- **BAJO #9 (cosmético "9 llaves") — ABIERTO** (BAJO #12 de esta ronda).
- **ARCO superadmin ve todas las flotas — CERRADO.** `admin/compliance/
  page.tsx:150-164`: `traerTodo` sin filtro de tenant con join a `tenant`
  (columna Flota) y `pendientesVencen` global. Verifiqué que la query ya no
  lleva `.eq('tenant_id', …)`.
- **`actualizarFacilidad15` comprueba el error de lectura — CERRADO.**
  `repo.ts:923-925`: `errLee` lanza antes de reemplazar la config.

## Lo que revisé y está bien

- **La matriz 2.9 en el motor tras el fix**: excedente por comprobante,
  proporción nunca negativa, la rama fail-closed no promete deducción (la nota
  de la prueba nueva no contiene "NO se deduce"), `SIN_ACREDITAMIENTO` cubre
  los tipos del efectivo, y las tres cubetas siguen sumando el comprobado
  (la tolerancia la validan las pruebas existentes, verdes).
- **`desde_db`**: el contador del ejercicio en try/catch (un fallo no tumba la
  liquidación), el ancla del año es la de los comprobantes, pasa las claves SAT
  y `getAcumuladoCombustible` conserva el fail-loud cuando la lectura queda
  corta.
- **La 0083** sigue validando la FORMA (objeto, dos booleanos o `null`) y
  `crearFlota` (`administracion.ts:110-115`) sigue escribiendo la declaración
  solo cuando AMBAS son booleanos — el estado `undefined` (sin declarar) sigue
  siendo alcanzable y el motor lo trata como "por confirmar".
- **`resumenCuadre`** (el resumen determinístico del cierre): las cubetas y el
  truncado "…y N observaciones más" se cuentan sobre la lista YA filtrada por
  destinatario; los litros no se inventan en pesos.
- **La ruta `/dashboard/arco`** está en `visibilidad.ts:76` como `operacion`,
  el server action acota por tenant (`resolverSolicitudArco` con
  `.eq('tenant_id', …)` en lectura y escritura), y la respuesta al titular va
  precedida de un aviso honesto de entrega/no-entrega — en la página de
  /dashboard, no en la de /admin.
- **Corridas del rubro**: engine+periodo+resumen 153, pdf+fiscal 70,
  cierre+aviso 39, administracion+tenant-efectivo 72 — 334 verdes en primera
  pasada. `tsc --noEmit` limpio.

## Lo que no alcancé a revisar

- El render de las páginas nuevas ARCO a pantalla (rubro frontend); aquí solo
  verifiqué las funciones, el gating de ruta y los server actions.
- El motor agéntico y la guardia de cifras (rubro tool-calling/agentico).
- El contenido real de la plantilla `respuesta_arco` en Meta (está en revisión;
  no puedo verla — el parámetro {{1}} se juzgó por el comentario del código).
- Confirmación contra Postgres real del seed ARCO sembrado (no toco la base).
- El resto del repo: la suite completa la corre otro auditor; yo corrí solo las
  suites del rubro (334).

## Veredicto

**NO para backend.** La ronda 15 pagó su deuda (los dos ALTOS y el MEDIO #2
están cerrados de verdad, verificados con prueba propia) — pero la ronda 16
dejó la casa con dos contradicciones nuevas, cada una de la familia que este
rubro lleva seis rondas persiguiendo: (1) el fix fail-closed de la ronda 15
hace `continue` y se traga los hechos duros — un CFDI cancelado pasa a "por
confirmar" (probado con el motor); (2) el release que implementó el envío
WhatsApp de la respuesta ARCO dejó a la pantalla de /admin jurando que "no
envía mensajes ARCO todavía" y tirando el resultado del envío. A eso se suman
los cierres a medias que la ronda 15 dejó listados (MEDIO #5 `cubetaDe`, BAJO
#6 `SOLO_CONTRALOR`, BAJO #7 `efectivoDeEsteViaje`, BAJO #8, BAJO #9) — todos
verificados vivos en HEAD, ninguno atacado. El camino del dinero sigue intacto
y razonado (por eso no hay CRÍTICO), pero un release que se promete "no se
miente" no puede salir con un rótulo que niega un envío que su propio código
acaba de hacer.
