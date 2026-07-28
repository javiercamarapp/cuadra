# Seguridad — nota 7/10 (antes 7)

## Verificación de lo arreglado en la ronda anterior

- **`passcode.ts:12-32` — el fallback SÍ desapareció en producción.** `secret()`
  lanza (`throw new Error(...)`) si `NODE_ENV==='production'` y falta
  `DASHBOARD_SECRET`; el fallback `likida:${DASHBOARD_PASSCODE}` solo se
  alcanza cuando `NODE_ENV !== 'production'` (línea 26). Rastreé los tres
  consumidores de `secret()` (`hmacHex` → `accessToken`/`tokenMatches`, usados
  en `middleware.ts`, `acceso/page.tsx` y `guard.ts`) y ninguno atrapa esa
  excepción: sin la variable, `/dashboard` y `/acceso` truenan con un 500 de
  Next, no sirven la página. Es "ruidoso" en el sentido correcto (el fallo se
  ve en la primera visita, no en un log que nadie mira) aunque no en el
  sentido de "avisa antes de que alguien lo note" — ver el hallazgo de
  Operabilidad sobre `startup.ts` abajo.
- **`startup.ts:21-28` (`verificarEntornoCritico`) NO tumba el arranque.** Solo
  hace `logger.error(...)` y sigue. Confirmé que `instrumentation.ts` la
  llama sin `try/catch` alrededor de un posible throw — pero como la función
  nunca lanza, eso no importa: el servidor arranca igual con o sin
  `DASHBOARD_SECRET`, y el primer indicio real de que falta es el 500 en
  `/dashboard`. No es un camino donde "el fallback vuelve" — el fallback
  sigue muerto en producción — pero el aviso de arranque es un log, no un
  bloqueo. Congruente con "best-effort, demo-safe" que el propio comentario
  declara.
- **`guard.ts` cubre las dos páginas del panel.** `src/app/dashboard/page.tsx:1,46`
  y `src/app/dashboard/[id]/page.tsx:1,30` llaman `exigirAcceso(...)`.
  Confirmé con `find` que hoy solo existen esas dos páginas bajo `/dashboard`
  (`loading.tsx`/`error.tsx` no sirven datos) y que los cuatro route groups
  vacíos (`(portal)`, `(dashboard)`, `(demo)`, `(admin)`) siguen sin un solo
  `page.tsx` — verificado con `find ... -type f`, cero resultados. Ninguna
  ruta nueva quedó sin la segunda capa.
- **`constTimeEq` ya se usa en `/acceso`.** `src/app/acceso/page.tsx:25`
  (`constTimeEq(code, expected)`), no `===`. El hallazgo bajo del boletín
  anterior está cerrado.
- **Sentry no puede tumbar el flujo del operador.** `sentry.ts:39-60`: la
  carga es un `import()` dinámico dentro de un `try/catch` que nunca relanza
  (el catch cae a `sentry = null` y solo hace `console.error` directo, no
  `logger`, para no reentrar). `reportar()` (líneas 68-76) no hace `await`
  del envío — es `void intento.then(...)` con su propio `try/catch` interno.
  Ningún call-site de `logger.warn/error` espera a que Sentry responda.
  Verificado también que `captureException` (tipada en `SentryLike`) **nunca
  se llama** — solo `captureMessage`, siempre con el `msg`/`meta` que
  `logger.ts:39-41` ya pasó por `redact()`. Confirmé con `command grep` que
  **cero** `console.error/warn/log` fuera de `logger.ts` y del propio
  `sentry.ts:57` existen en `src/` — así que ni por un breadcrumb de consola
  se cuela algo sin redactar. `sendDefaultPii:false` y `tracesSampleRate:0`
  cierran los otros dos canales de fuga (IP/cabeceras automáticas, trazas de
  request). Verificado: sí va redactado, y sí es imposible que tumbe el turno.

## Hallazgos

### [CRÍTICO] `guardiaFundamento` deja pasar una cita fabricada cuando el modelo escribe la forma MÁS natural del español: con coma entre el artículo y la fracción

`src/lib/cuadra/normas/fundamento.ts:156-164` (limpieza de `CITA_DESCONOCIDA`) y `:41-48` (`patronesDe`, los patrones de la norma específica)

El ataque no requiere ningún esfuerzo adversarial: es cómo cualquier
hispanohablante —o un LLM— escribe la cita por defecto. Verificado
ejecutando la función real (no una reimplementación) contra el código actual:

```
texto:      "No es deducible según el artículo 27, fracción III de la LISR."
permitidas: []   // el modelo no invocó ninguna tool este turno
```

```
citasEnTexto(texto)        → ['DESCONOCIDA']       // SÍ detecta que hay algo raro
guardiaFundamento(texto, []).reply
  → "No es deducible según el, fracción III de la LISR."
```

**La cita sobrevive.** `guardiaFundamento` reporta `forzado: true` y
`quitadas: ['DESCONOCIDA']` — como si hubiera limpiado el mensaje — pero
"fracción III de la LISR" queda legible en el texto que se manda a
`say(reply)` (`processor.ts:583`). La causa: tanto el patrón que reconoce la
norma específica (`fundamento.ts:46-47`, `${art}${fr}` unidos por `\s*`,
whitespace puro) como el patrón de limpieza genérica para `DESCONOCIDA`
(`fundamento.ts:161-163`, mismo `\s*`) exigen que "artículo 27" y "fracción
III" estén separados solo por espacios. Una coma —la puntuación estándar de
esa frase en español— rompe ambos regex a la vez: el de detección específica
(por eso ni siquiera se reconoce como la norma real cuando SÍ está permitida,
ver caso de control abajo) y el de limpieza (por eso lo que sobra no se
borra del todo).

**Peor todavía — ni se detecta — cuando el modelo parte la cita en dos
oraciones**, otro patrón de escritura común en respuestas largas de un LLM:

```
texto: "Aplica el artículo 27. La fracción III de la LISR lo dice así."
guardiaFundamento(texto, []).reply
  → "Aplica el La fracción III de la LISR lo dice así."
```

Aquí "fracción III" (con número romano, no dígito) nunca activa
`FORMA_DE_CITA` (`fundamento.ts:77-81`, que exige `\d+` tras "fracción" —
los romanos no cuentan), así que `citasEnTexto` ni siquiera la marca como
sospechosa: la segunda oración pasa 100% intacta, con "La" duplicado
delante ("el La fracción"), un indicio de que algo se rompió pero no una
garantía de que un lector lo note antes de creerse la cita.

**Caso de control, para confirmar que el fallo es el regex y no la
autorización:** con la MISMA frase (coma incluida) y `permitidas:
['lisr-27-fr-III']` —es decir, la cita SÍ vino de una tool este turno—
`guardiaFundamento` la marca IGUAL como no reconocida (`forzado: true`) y
la mutila (`"No es deducible según el, fracción III de la LISR."`). El
patrón específico de la norma tampoco tolera la coma, así que una cita
LEGÍTIMA se rompe con el mismo bug que dejaría pasar una INVENTADA — dos
caras del mismo defecto de regex.

**Por qué es CRÍTICO y no un matiz de redacción:** este archivo existe
explícitamente para que "el modelo solo pueda citar una norma que una tool
le devolvió EN ESE TURNO" (comentario propio, líneas 14-16) y el propio
encabezado dice por qué importa: *"Frente a un contralor con fiscalista, una
cita inventada cuesta más que un número mal puesto... dejar pasar una
inventada cuesta la venta."* El escenario no exige que nadie ataque nada: el
modelo llama `consultar_politica` (que no devuelve `norma_id` alguno,
`tools.ts:34-37`) en un turno donde el operador pregunta algo del estilo
"¿por qué no me cuadra esto?", y narra su respuesta citando de memoria "el
artículo 27, fracción III de la LISR" — sea porque la norma real aplica y el
modelo la sabe de memoria, o porque alucina un artículo completo. En ambos
casos, la guardia que se vende como la propiedad de código que impide
justo eso, no lo impide. Los 491 tests de `npm test` pasan porque
`fundamento.test.ts` no cubre coma ni oraciones partidas — verificado
leyendo el archivo completo, no adivinado.

**No es ReDoS, y eso SÍ está bien cubierto.** Medí independientemente
(1.4MB de texto adversarial repetido, y variantes con puntuación intercalada
como las del propio `coste y resistencia` de `fundamento.test.ts:106-120`):
281ms en el peor caso, sin señal de backtracking catastrófico. Los
cuantificadores están acotados (`[^.]{0,45}`, nunca `.*`) y `esc()`
(`fundamento.ts:52`) escapa el set completo de metacaracteres de regex antes
de interpolar cualquier dato del índice — no hay caracteres de una ficha que
puedan romper `new RegExp(...)` porque `citas`/`articulo`/`fraccion` son
strings fijos en `indice.ts` (compile-time, no datos externos) y de
cualquier forma pasan por `esc()`. El propio `fundamento.test.ts:94-105`
documenta la medición y el motivo. Confirmado, no es el riesgo.

### [MEDIO] `getAcumuladoCombustible` sí filtra por tenant — verificado, no es el hallazgo

`src/lib/cuadra/repo.ts:409-431` — el `select` lleva `.eq('tenant_id',
tenantId)` (línea 416) antes de cualquier otro filtro, y su único llamador
(`tools.ts:67`) le pasa `ctx.tenantId`, que sale del teléfono verificado por
HMAC de Meta (mismo patrón que el resto de `tools.ts`, ya auditado como
sólido). No hay entrada del modelo en ningún parámetro de esta función —
`ejercicio` es `new Date().getUTCFullYear()`, calculado en el servidor
(`tools.ts:66`), no algo que el LLM pueda inyectar. **No es un hallazgo de
fuga entre flotas**: lo dejo documentado como verificación negativa, tal
como pide el MAPA, y lo bajo a MEDIO solo para que quede registrado que sí
se revisó a fondo (índice de soporte, migración 0023, incluido) y no se
omitió.

## Riesgos anteriores que siguen igual (sin cambios, no repito el detalle)

- `middleware.ts` sigue siendo la única capa fuera de `guard.ts` para rutas
  que algún día existan fuera de `/dashboard` — mitigado por `guard.ts`
  nuevo, que es justo la segunda capa que pedía el hallazgo anterior. Bajo
  de MEDIO a **cerrado**: ya no es de punto único de falla, hay dos capas
  independientes.

## Lo que está sólido

- Multi-tenancy sigue sin una sola excepción: revisé `repo.ts` completo
  (incluida la función nueva) y las tres tools de `tools.ts`.
- `normasDeToolCalls` (`fundamento.ts:190-202`) lee `norma_id` de lo que las
  TOOLS devolvieron, nunca del texto del modelo — el modelo no puede
  autoconcederse permiso de cita inventando un resultado de tool.
- HMAC del webhook, rate-limits, cap de body: sin cambios, sin regresión.

## Lo que no cubrí

No revisé a fondo `engine.ts` (reorden del acreditamiento, IVA parcial) ni
la corrección fiscal de `normas/lisr-27-fr-III` etc. — es el rubro del
auditor fiscal, no el mío. No corrí `pruebas-manuales/*` ni toqué la base de
datos, conforme al MAPA.

---

# Cumplimiento legal — nota 6/10 (primera calificación separada)

Método: seguí el dato personal desde que entra por WhatsApp
(`privacidad.ts`) hasta donde se guarda constancia (migración 0018) y hasta
la cadena de subencargados (`docs/conocimiento/52-anexo-subencargados.md`).
Verifiqué cada afirmación del anexo contra el código, no contra el propio
documento.

## Hallazgos

### [ALTO] El medio ARCO que el aviso promete "SIEMPRE" no responde cuando el operador no tiene un viaje abierto

`src/lib/cuadra/processor.ts:157-161` vs `:183`

El comentario del propio código es explícito sobre la intención: *"Va aquí
[antes del agente]. Si el aviso dice que escribiendo PRIVACIDAD se le
atiende, tiene que atenderse SIEMPRE — no casi siempre"* (líneas 179-182).
Pero el flujo real:

```
157  const viajeId = await getOpenViaje(op.tenantId, op.operadorId);
158  if (!viajeId) {
159    await sendText(msg.from, 'No tienes un viaje abierto para liquidar ahorita...');
160    return;                              // ← SALE AQUÍ, antes de leer el mensaje
161  }
...
183  if (msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)) {
```

Si un operador —que no tiene un viaje abierto ahora mismo, el estado normal
entre cargas— escribe "PRIVACIDAD" para ejercer un derecho ARCO sobre datos
de liquidaciones YA guardadas (nombre, teléfono, montos de viajes previos,
que siguen en Supabase con independencia de si hay un viaje abierto), el
código nunca llega a la línea 183: ya salió en la 160 con el mensaje
genérico de "no tienes viaje abierto". El operador no recibe la respuesta
ARCO ni el aviso "Déjame checarlo con la empresa" — recibe un mensaje que no
tiene nada que ver con lo que pidió, y el sistema no vuelve a intentarlo: el
webhook ya respondió, el mensaje ya se marcó procesado.

Esto contradice directamente el propio texto del aviso
(`privacidad.ts:58`: *"Cómo limitarlo o ejercer tus derechos ARCO: escribe
PRIVACIDAD por este chat y te pasamos con la empresa"* — sin condicionarlo a
tener un viaje abierto) y el art. 15 fr. IV LFPDPPP, que exige señalar el
medio para limitar el uso o divulgación de los datos: un medio que solo
funciona cuando coincide con tener una liquidación en curso no es el medio
que se anunció. Es un hallazgo describible y reproducible con solo leer el
orden de las líneas — no necesita ejecución para confirmarse, aunque el
comportamiento de `getOpenViaje` (repo.ts) y el flujo completo de
`processInbound` sí los verifiqué contra el código, no los supuse.

Nota aparte, sin bajar más la nota: el envío del AVISO inicial
(`ponerAvisoADisposicion`, línea 176) sí tiene sentido que espere a que haya
un viaje —es defendible que el tratamiento "empieza" cuando hay datos que
capturar—, pero el mecanismo de RESPUESTA a un ARCO ya ejercido sobre datos
YA existentes no debería depender de lo mismo.

### [BAJO / verificado, no hallazgo] El salario del operador (`laboral/pagadero.ts`) no es un dato nuevo tratado hoy

`src/lib/cuadra/laboral/pagadero.ts:86-150` (`TopeDescuentoInput`,
`topeDescuento`) define un flujo que SÍ requiere `salarioMensual` — un dato
personal laboral sensible que no aparece en `avisoSimplificado`
(`privacidad.ts:52`, "Qué se trata: tu nombre y teléfono, y las fotos de
comprobantes..."). Pero verifiqué con `command grep -rn "topeDescuento("
src/` que la única llamada existe en `pagadero.test.ts` — **`topeDescuento`
no se invoca desde ningún camino de producción** (`tools.ts`, `processor.ts`
ni `pdf.ts` la importan), y confirmé con `command grep -rln "salario"
supabase/migrations/ src/types/` que no existe columna de salario en ningún
lado del esquema. `resumenLaboral` (la función que SÍ está conectada, en
`pdf.ts:312`) no toca salario en absoluto. No es un hallazgo activo hoy —lo
dejo anotado para el día que alguien conecte `topeDescuento` a un flujo
real: en ese momento, `salarioMensual` sí necesita entrar al aviso.

## Lo que está bien fundamentado (verificado contra el código, no contra el anexo)

- **El anexo de subencargados (`52-anexo-subencargados.md`) SÍ refleja la
  realidad tras cablear Sentry.** La fila 5 de la tabla (línea 62) y la nota
  de las líneas 64-69 describen exactamente lo que verifiqué en
  `sentry.ts`/`logger.ts`: solo `warn`/`error`, ya redactados,
  `sendDefaultPii:false`. No encontré ninguna afirmación del anexo que el
  código actual desmienta.
- **`marcar_aviso_privacidad` (migración 0018) filtra por `tenant_id` Y por
  `id` del operador** (`0018_aviso_privacidad.sql:55-56`) y el `revoke` a
  `public, anon, authenticated` está presente (línea 65) — mismo patrón
  correcto que 0013/0017.
- **`pideAtencionPrivacidad` es determinístico y corre antes del agente**
  cuando SÍ se alcanza (comprobado: normaliza acentos, tolerante a
  mayúsculas, no exige el mensaje completo). El problema no es el
  reconocimiento del texto, es el `return` temprano de la línea 160 que le
  impide correr.
- **El aviso inicial no se manda a medias**: `avisoSimplificado` devuelve
  `null` si falta razón social, domicilio o URL del aviso integral —
  preferible a un aviso con el responsable equivocado.

## Lo que no cubrí

No verifiqué el texto legal de fondo (si LISR 27-III, LFT 263-I, etc. están
bien citadas en cuanto a CONTENIDO) — ese es el rubro fiscal. No evalué el
contrato entre Likida y las flotas (pendiente #2 del propio anexo, fuera de
mi alcance de código). No verifiqué el estado real de `SENTRY_DSN` en
producción, solo el comportamiento del código ante su presencia/ausencia.

---

# Operabilidad y DX — nota 6/10 (antes 6)

## Hallazgos

### [MEDIO] El log de `guardiaFundamento` no permite distinguir un forzado exitoso de uno incompleto — agrava el hallazgo CRÍTICO de arriba

`src/lib/cuadra/processor.ts:576` —
```
logger.warn('agent.fundamento_forzado', { viaje: viajeId, tenant: op.tenantId, quitadas: f.quitadas });
```
Este log se dispara exactamente en el escenario del hallazgo CRÍTICO —una
cita con coma o partida en dos oraciones— y registra `quitadas:
['DESCONOCIDA']` como si la limpieza hubiera funcionado. No hay forma de
saber, leyendo el log a las 3am, que el `reply` que salió por WhatsApp
todavía contenía "fracción III de la LISR". El log dice "actué", no dice "y
funcionó". Ni `f.reply` (aunque sea recortado) ni un hash/longitud del texto
antes/después viajan al log. Diagnosticar un reporte de "el bot me citó una
ley rara" hoy exige reproducir el mensaje exacto del operador, no leer
Vercel.

### [BAJO] Las migraciones nuevas (0018-0023) no tienen probe de arranque, a diferencia de 0005/0011/0016/0017

`src/lib/cuadra/startup.ts:30-88` — el patrón "avisa ruidoso al arrancar si
falta la migración" se aplicó a 0005, 0011, 0016 y 0017, pero no se extendió
a 0018 (aviso de privacidad), 0019 (unique CFDI), 0020 (demora no
imputable), 0021 (litros diésel) ni 0023 (índice del acumulado). El impacto
está parcialmente mitigado: `processor.ts:126-129` ya envuelve
`ponerAvisoADisposicion` en try/catch con `logger.error` propio, y
`tools.ts:70-71` hace lo mismo con `getAcumuladoCombustible` — así que si
falta 0018 o 0023 en una base fresca, el fallo SÍ se loguea, solo que la
primera vez que alguien lo nota es a media conversación con un operador real
en vez de en el arranque. No es el "silencio total" que el `startup.ts`
existe para evitar, es un aviso más tardío de lo que el propio patrón del
archivo establece como estándar.

### [BAJO] El contador del 15% sí avisa cuando no se pudo calcular — verificado, no hallazgo

`src/lib/cuadra/periodo/aviso.ts:37-38` (`case 'sin_criterio'`) devuelve un
texto explícito para el contralor: *"hay pagos en efectivo pero no se pudo
calcular el total de combustible del ejercicio... Conviene revisarlo a
mano."* Y el catch duro en `tools.ts:70-71` sí loguea
`periodo.combustible_no_disponible` con el error real. Cubre tanto el fallo
duro (excepción en la consulta) como el estado de datos inconsistentes
(`total<=0` con `efectivo>0`, `combustible.ts:75-77`). Único matiz: el
estado `sin_criterio` "suave" (sin excepción, solo datos raros) no genera
un `logger.warn` propio — solo llega al contralor vía el texto del agente,
condicionado a que la guardia de fundamento no lo estropee (ver hallazgo
CRÍTICO de Seguridad: `rfa-2026-2.9` se agrega a `fundamentos` en
`tools.ts:79`, así que ese aviso específico SÍ pasa por
`guardiaFundamento`, y si el modelo lo redacta con la puntuación
equivocada corre el mismo riesgo). No lo cuento como hallazgo aparte porque
es el mismo bug, no uno nuevo.

## Lo que está sólido

- El log de `agent.fail` (`processor.ts`) sigue trayendo `viajeId`/tenant —
  no encontré regresión del hallazgo histórico sobre logs sin identificador.
- `idx_gasto_acumulado` (migración 0023) es exactamente el tipo de anticipo
  de operabilidad que faltaba en rondas anteriores: el propio comentario
  reconoce "hoy hay 2 gastos en la base y no se nota" y pone el índice antes
  de que haga falta, no después de un incidente.
- Sentry queda cableado de forma que nunca compite por presupuesto de tiempo
  con el turno del operador (fire-and-forget, ver Seguridad).
- Los módulos nuevos que son puros (`periodo/combustible.ts`,
  `periodo/aviso.ts`, `laboral/pagadero.ts`) no logean nada — correcto,
  consistente con `engine.ts`: la responsabilidad de logear vive en el call
  site (`tools.ts`), no en la función pura.

## Lo que no cubrí

No verifiqué CI (`.github/ci.yml.pendiente`) ni corrí lint — sin cambios
reportados en el MAPA para ese frente desde la ronda anterior, y no es
donde apunta el "qué cambió" de esta ronda. No medí el rendimiento de
`cuadrar_viaje` con la llamada nueva a `getAcumuladoCombustible` en
producción real (solo el índice que la sostiene).
