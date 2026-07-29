# Cumplimiento legal — auditoría 6

**Nota: 4/10** (igual que la ronda 5). Razón: **mirada más profunda**. Los 55
arreglos de ayer cerraron trabajo real en este rubro —la constancia falsa del
CRÍTICO #2, cuatro de los seis ALTOS—, pero el commit que dice haber cerrado el
CRÍTICO #1 (`1425b03`, *"el aviso de privacidad dejó de depender de una liga
muerta"*) **no lo cerró para el único tenant que existe**: construyó la pieza
correcta (`sondearAvisoIntegral`, que abre la liga de verdad) y nunca la
conectó a nada que corra. El aviso simplificado que Likida manda HOY, y la
respuesta que da HOY a quien ejerce un derecho ARCO, siguen citando un dominio
que no resuelve — verificado en este momento, no por inferencia. Encima, el
propio módulo de validación que se escribió para prevenir justo esto tiene un
filtro nuevo que apaga avisos **reales** de tenants futuros por una coincidencia
de texto, y el detector nuevo de oposición del art. 26 fr. II no reconoce la
forma más común de decir "me opongo" en español hablado.

> **El riesgo mayor hoy:** `avisoSimplificado()` y `respuestaPrivacidad()`,
> ejecutados con los datos REALES del único tenant en producción, devuelven
> `Aviso completo: https://transportesinnovativos.mx/aviso-de-privacidad` — el
> mismo dominio NXDOMAIN que la auditoría 5 marcó CRÍTICO hace un día. La
> función que se escribió para detectar exactamente esto (`sondearAvisoIntegral`,
> que sí abre la liga por red) existe, está probada, y **no la llama nadie fuera
> de su propio test**. `revisarAvisoIntegral` —la que sí corre en cada mensaje—
> es una revisión de forma: ve que la cadena parece una URL y dice `ok`, sin
> preguntarle nunca a Internet si el sitio existe. El aviso del 6-ago sigue
> apuntando a la nada, y ahora lo hace con un módulo que parece haberlo resuelto.

**Escala usada.** CRÍTICO = hay datos personales saliendo hacia un tercero o
subencargado sin que el aviso los cubra, o un dato personal expuesto, o el
mecanismo que la ley exige para ejercer un derecho no lleva a ningún lado real.
ALTO = el producto incumple una obligación de la Ley por un camino real y nadie
se entera.

**Nota metodológica.** Todo lo de abajo se corrió contra el código real de
HEAD (`5b2ec76`) con `npx tsx`, importando los módulos —no leyéndolos y
suponiendo—, y contra la **base de producción** (solo lecturas, vía REST con la
service-role de `.env.local`). El estado NXDOMAIN del dominio se comprobó de
nuevo hoy con `host` y `curl`, no se copió del reporte anterior. La ley citada
es la **LFPDPPP vigente (DOF 20-mar-2025, últ. reforma 14-nov-2025)**; las
fichas `normas/lfpdppp-15-16.yaml` y `normas/lfpdppp-26-II.yaml` están en
`verificado_fuente_primaria`.

---

## Hallazgos

### [CRÍTICO] El arreglo del CRÍTICO de ayer construyó el detector correcto y no lo conectó: el aviso real de producción sigue citando un dominio NXDOMAIN, hoy, en el aviso Y en la respuesta ARCO

**`src/lib/cuadra/privacidad.ts:66-90`** (`revisarAvisoIntegral`, la que corre en
cada mensaje) · **`src/lib/cuadra/privacidad.ts:106-130`** (`sondearAvisoIntegral`,
la única que abre la liga por red) · **`src/lib/cuadra/privacidad.ts:203-205`**
(`avisoSimplificado`) · **`src/lib/cuadra/privacidad.ts:302-312`**
(`respuestaPrivacidad`)

**Artículo y texto aplicable.** Art. 16 fr. II (`normas/lfpdppp-15-16.yaml`,
`verificado_fuente_primaria`): el aviso simplificado debe *"señalar el sitio
donde se podrá consultar el aviso de privacidad integral"*. Y el art. 15 fr. V
pone en el integral los *"mecanismos, medios y procedimientos para ejercer los
derechos ARCO"*.

**Escenario, con valores.** El commit `1425b03` diagnosticó bien el problema de
ayer y escribió DOS funciones: `revisarAvisoIntegral` (revisión de forma, sin
red) y `sondearAvisoIntegral` (abre la liga de verdad). El propio comentario de
`sondearAvisoIntegral` dice para qué sirve la primera y por qué no basta:

> *"ES UNA REVISIÓN DE FORMA... Un dominio bien escrito y sin registrar
> (NXDOMAIN) pasa esta función y el operador igual se topa con un error de red.
> Lo único que prueba existencia es `sondearAvisoIntegral`... Va en un arranque,
> en un preflight de despliegue o en un cron, donde un fallo se puede mirar."*

Ese arranque, preflight o cron **no existe**. Lo comprobé por tres vías:

```
$ command grep -rn "sondearAvisoIntegral" src/
src/lib/cuadra/privacidad.ts:106:export async function sondearAvisoIntegral(
src/lib/cuadra/privacidad.test.ts:130-162   (solo las pruebas la llaman)
```

`src/lib/cuadra/startup.ts` no la importa ni la menciona (revisado completo:
solo verifica migraciones y `DASHBOARD_SECRET`). No hay `vercel.json` con cron.
No hay ninguna ruta en `src/app/api/` que la invoque
(`command grep -rln "privacidad|aviso" src/app/api/` solo devuelve un test).
La función que **es lo único que distingue un dominio bien escrito de un
dominio que no existe** —palabras del propio comentario— es código muerto en
producción.

Y el dominio del único tenant real sigue sin existir, comprobado de nuevo hoy:

```
$ host transportesinnovativos.mx
Host transportesinnovativos.mx not found: 3(NXDOMAIN)
```

Con `revisarAvisoIntegral` siendo puramente sintáctica, el resultado para ese
tenant es `ok` — importé el módulo real y lo corrí con los datos que están HOY
en la tabla `tenant` de producción:

```
$ npx tsx -e "…revisarAvisoIntegral('https://transportesinnovativos.mx/aviso-de-privacidad')…"
ok
```

Y `avisoSimplificado` con esos mismos datos (razón social, domicilio y URL
reales de la fila `11111111-1111-1111-1111-111111111111`) termina, línea por
línea, en:

```
Aviso completo: https://transportesinnovativos.mx/aviso-de-privacidad
```

— exactamente la liga rota, exactamente el mismo texto que el aviso simplificado
mandaba antes de `1425b03`. La rama degradada (*"la empresa aún no lo
publica"*) que el commit construyó **nunca se activa** para este tenant, porque
`revisarAvisoIntegral` no tiene forma de saber que el dominio no existe.

El camino ARCO tiene el mismo defecto: `respuestaPrivacidad` con los mismos
datos —lo corrí también— entrega:

```
Ahí vienen los pasos para acceder, corregir, cancelar u oponerte al uso de tus
datos (derechos ARCO), incluida la revisión automática de tus comprobantes:
https://transportesinnovativos.mx/aviso-de-privacidad
```

Quien ejerce un derecho ARCO hoy —el único camino que el producto ofrece— recibe
la misma dirección que un navegador no puede abrir. El defecto que la auditoría
5 marcó CRÍTICO (*"el titular no tiene forma de acceder, rectificar, cancelar,
oponerse ni revocar, y la base afirma que sí se le informó"*) sigue siendo
literalmente cierto hoy, con el módulo que se escribió para resolverlo ya en el
repo.

**Consecuencia.** *Para el titular:* exactamente la de ayer — cero mecanismos de
ARCO alcanzables, cero forma de consultar el aviso integral, cero forma de saber
a qué transferencias está expuesto. *Para la autoridad:* art. 58 fr. V (omitir
en el aviso los elementos del art. 15) sigue encuadrando, con la agravante de
que ahora existe en el propio repositorio la prueba escrita de que Likida
identificó el defecto, construyó la herramienta para corregirlo y no la conectó
— eso es peor en una verificación que no haberlo notado nunca, porque demuestra
conocimiento del riesgo sin remediarlo. *Para Likida:* si el 6-ago alguien en la
sala hace exactamente lo que hizo esta auditoría —correr el módulo con los
datos reales, o simplemente tocar la liga desde su teléfono— el resultado es el
mismo error de red que ya estuvo a punto de costar el trato hace un día.

**Refutación que intenté.** ¿Es esto "no arreglable en código", como el
domicilio inventado que el propio MAPA pide no redescubrir? No: el domicilio
inventado necesita que alguien capture datos reales del cliente, y eso es un
proceso de negocio. Este defecto es distinto — **la pieza de código que lo
arregla ya existe, está escrita, está probada, y solo le falta una llamada
en `startup.ts` o un cron**. Es exactamente el tipo de brecha que este rubro
existe para encontrar: un arreglo que se ve completo en el diff y no se ejecuta
nunca en producción.

**Causa raíz.** `sondearAvisoIntegral` se diseñó deliberadamente para NO correr
en el camino de cada mensaje (razón correcta: latencia y falsos negativos por
corte transitorio). Pero el diseño se quedó a medias: se escribió el "no aquí"
sin escribir el "entonces aquí". El resultado es una función que documenta su
propio propósito con precisión y que nadie invoca.

---

### [ALTO] El filtro de "rellenos" de la liga del aviso apaga dominios reales por contener una palabra española común, y el aviso miente diciendo que la empresa no ha publicado nada

**`src/lib/cuadra/privacidad.ts:45-50`** (lista `RELLENOS`) ·
**`src/lib/cuadra/privacidad.ts:86`** (`completa.includes(r)`)

**Artículo y texto aplicable.** Art. 16 fr. II — señalar el sitio del aviso
integral cuando existe. Y art. 15 fr. V — el mecanismo ARCO tiene que ser real.

**Escenario, con valores.** `RELLENOS` incluye las palabras sueltas `'todo'` y
`'pendiente'` (sin sufijo de dominio, a diferencia de `'example.com'` o
`'dominio.com'`), y la comparación en la línea 86 es una búsqueda de substring
sobre la URL COMPLETA (`completa.includes(r)`), sin límite de palabra. Cualquier
dominio que contenga esas cuatro u ocho letras en cualquier posición se marca
`inservible`, sin importar que sea un sitio real y funcionando. Corrí el módulo
real contra dominios plausibles del sector — muchos operadores de autotransporte
en México se anuncian como *"transportista independiente"* u *"operador
independiente"*, que es justo el segmento que censó `docs/conocimiento/`:

```
$ npx tsx -e "…"
https://transportistaindependiente.mx/aviso-de-privacidad   -> inservible
https://autotransportesindependientes.com.mx/privacidad     -> inservible
https://operadorindependiente.mx/aviso                      -> inservible
https://metodologiatransporte.mx/aviso                      -> inservible
https://grupotodo.mx/aviso                                  -> inservible
https://realdominio.mx/aviso-legal                          -> ok   (control)
```

Las tres primeras caen porque *"independiente(s)"* contiene *"pendiente"*
como substring (`in-de-PENDIENTE`); la cuarta porque *"metodología"* contiene
*"todo"* (*me-TODO-logía*). Ninguno de los cuatro es un marcador de relleno: son
nombres de empresa reales y plausibles en el giro exacto de Likida. Con
`avisoSimplificado`, una flota que se llame así y **sí publicó** su aviso
integral recibe de su propio proveedor el mensaje:

```
Aviso completo: la empresa aún no lo publica. Escríbeme *PRIVACIDAD* y queda
registrado para que te lo hagan llegar.
```

— una afirmación falsa, verificada por ejecución del código real (transcrito
completo en el script de esta auditoría). Y `respuestaPrivacidad` para el mismo
tenant le dice a quien ejerce ARCO: *"La empresa todavía no publica la liga con
el procedimiento, así que no tengo a dónde mandarte"* — negándole un canal que
existe y funciona, por una coincidencia de texto en el nombre de su propia
empresa.

**Consecuencia.** *Para el titular:* pierde acceso a un mecanismo ARCO real por
un bug de coincidencia de substrings, y ni el operador ni el contralor tienen
forma de notarlo — el mensaje se ve igual de razonable que el de un tenant que
de verdad no ha publicado nada. *Para la autoridad:* art. 58 fr. V — el aviso
omite señalar el sitio del integral cuando el sitio sí existe. *Para Likida:*
el defecto es indetectable desde el producto: no hay log, no hay error, la
función es pura y no registra por qué decidió `inservible`. El primer tenant
real cuyo nombre contenga estas ocho letras lo hereda sin que nadie lo busque.

**Causa raíz.** `'todo'` y `'cambiar'` y `'pendiente'` se escribieron pensando
en placeholders sueltos (`www.pendiente`, `por-definir`) pero se probaron solo
contra ese caso, no contra substrings dentro de palabras españolas reales. Las
demás entradas de la lista sí tienen esa protección implícita porque son
compuestas (`'tu-dominio'`, `'mi-dominio'`, `'por-definir'`) o van con sufijo
de dominio (`'example.com'`, `'test.com'`); las cuatro palabras sueltas no.

---

### [ALTO] El detector nuevo de oposición (art. 26 fr. II) no reconoce "me quiero oponer" — la conjugación más natural en español hablado — y el derecho se pierde sin rastro

**`src/lib/cuadra/privacidad.ts:249-256`** (`OPOSICION`) ·
**`src/lib/cuadra/privacidad.ts:271-280`** (`pideAtencionPrivacidad`)

**Artículo y texto aplicable.** Art. 26 fr. II (`normas/lfpdppp-26-II.yaml`,
`verificado_fuente_primaria`), transcrito literal: el titular puede oponerse
cuando sus datos son objeto de *"un tratamiento automatizado... destinados a
evaluar, sin intervención humana... su... fiabilidad o comportamiento"* — el
supuesto exacto que activa `engine.ts:189` (`texto_sospechoso`).

**Escenario, con valores.** El aviso que Likida manda hoy le enseña al operador
la frase exacta con la que se espera que ejerza el derecho: *"Tienes derecho a
oponerte a que se decida así y a pedir que la revise alguien"* (`privacidad.ts:188`).
`OPOSICION` reconoce `\bme opongo\b` y `\boponerme\b`, pero el español permite
subir el clítico antes del verbo conjugado con perífrasis (`quiero + infinitivo`):
*"me quiero oponer"* es tan correcto y tan común en el habla cotidiana mexicana
como *"quiero oponerme"*, y solo el segundo coincide con el regex. Lo corrí:

```
$ npx tsx -e "…"
"me opongo a eso"        -> true
"quiero oponerme"        -> true
"me quiero oponer"       -> false
"me quiero oponer a eso" -> false
```

Cuando un operador escribe *"me quiero oponer"* sin además decir "privacidad",
"arco" o alguna de las frases exactas de `OPOSICION`, `pideAtencionPrivacidad`
devuelve `false`. El mensaje **no entra** por `atenderPrivacidad`
(`processor.ts:236-239`): sigue el camino normal hacia el agente conversacional,
que no tiene ningún manejo del art. 26 fr. II — ni prompt, ni tool, ni registro.
El ejercicio del derecho se pierde sin que quede ningún rastro: no hay log de
`privacidad.solicitud_operador`, no hay respuesta que lo confirme, nada que un
contralor o un auditor pueda encontrar después.

**Consecuencia.** *Para el titular:* ejerció el derecho, con las palabras que el
propio aviso de Likida sugiere de forma natural, y el sistema no se dio cuenta.
*Para la autoridad:* art. 58 fr. IV/XIX — negativa u omisión de atender la
oposición, agravada porque el aviso explícitamente invita a ejercerla y el
producto falla en reconocerla. *Para Likida:* es el mismo patrón que el CRÍTICO
de arriba en miniatura — se construyó el mecanismo, se calibró "a favor de la
cobertura, no de la precisión" según su propio comentario, y aun así falta una
conjugación de uso diario del verbo que da nombre al derecho.

**Refutación que intenté.** El comentario del propio archivo admite que el
detector no cubrirá toda paráfrasis libre ("no quiero que una IA me juzgue",
etc.) y ESO lo acepto: ningún detector por palabras clave cubre lenguaje
abierto, y el diseño ya lo reconoce como límite conocido. Lo que reporto aquí
es distinto: no es una paráfrasis lejana, es la conjugación alternativa —
gramaticalmente intercambiable— del MISMO verbo que sí está en la lista. Si
`oponerme` entró a propósito, `me quiero oponer` debió entrar con él.

---

## Lo que revisé y está bien (verificado de nuevo, no heredado del reporte anterior)

- **La constancia falsa (CRÍTICO #2 de la ronda 5) SÍ está cerrada.**
  `processor.ts:163-176` reserva con `reclamarEnvioAviso` y libera con
  `liberarEnvioAviso` si `sendText` devuelve `null`; `meta/client.ts:82-93`
  ahora devuelve el wamid o `null` en vez de `void`. Lo corrí con
  `redactarTexto`/`sendText` reales: un `res.ok` falso ya no deja una fila
  afirmando un envío que no ocurrió. Bien cerrado.
- **"Sin aviso no hay tratamiento" es real, no solo el comentario que lo dice.**
  `processor.ts:285-297`: si `ponerAvisoADisposicion` devuelve `false`, el
  código hace `return` antes de la rama de imagen (`:304`) y antes de cualquier
  llamada a `extraerComprobante`. Verificado leyendo el flujo completo entre
  ambos puntos, no solo el comentario.
- **La redacción de teléfonos en el logger (ALTO de la ronda 5) está cerrada.**
  Corrí `redactarTexto('5219993700779')` contra el módulo real: `[TEL]`. El
  formato de 13 dígitos que Meta entrega para México ya no escapa.
- **El filtro de datos sensibles colados (ALTO de la ronda 5) existe y está
  cableado.** `sanitizarProducto` (`intake/sanitizar.ts:111-119`) descarta el
  valor completo cuando coincide con el catálogo de salud/creencias/vida sexual,
  y `ocr.ts:346` lo usa para `ocrExtra.producto` en vez de `sanitizarTexto`.
  Sigue siendo cierto el límite que el propio código declara: protege lo que se
  PERSISTE, no lo que ya viajó a Gemini dentro de la imagen — eso no cambió y no
  es nuevo.
- **El aviso ya no dice "Nada más".** El texto vigente (`privacidad.ts:179-181`)
  enumera la revisión de fraude entre viajes como finalidad separada, cerrando
  el ALTO de la ronda 5 sobre `detectarAnomalias` sin aviso.
- **El derecho de oposición ahora se nombra en el aviso mismo**
  (`privacidad.ts:188`), no solo en un documento integral que no existe. Es un
  avance real sobre el hallazgo de la ronda 5, aunque el detector que debe
  reconocerlo tenga el hueco de arriba.
- **No hay bóveda de credenciales ni automatización de portales de terceros.**
  Repetí las mismas búsquedas de la ronda 5
  (`grep -iE "e\.?firma|fiel|ciec|contraseña|credencial|csd|\.key"` y
  `puppeteer|playwright|selenium|chromium|captcha|browserbase|stagehand`) sobre
  `src/`, `supabase/` y `package.json`: cero en ambas. Sigue siendo la decisión
  de producto más valiosa del proyecto en este rubro.

## Lo que sigue igual (confirmado hoy, no es hallazgo nuevo — así lo pide el MAPA)

- **Razón social, domicilio y RFC del tenant siguen inventados en producción.**
  Confirmado por lectura directa de la tabla `tenant` hoy: `TRANSPORTES
  INNOVATIVOS SA DE CV`, el mismo domicilio de Silao que ya se documentó como
  `🔴 INVENTADO`. No es arreglable en código — hace falta que alguien capture
  los datos reales del prospecto — y coincide exactamente con lo que el MAPA
  pidió confirmar. No lo vuelvo a contar como ALTO nuevo.
- **El cierre automático sigue sin intervención humana.** `tools.ts:100-150`
  (`guardar_liquidacion`) no cambió esta ronda; `normas/lfpdppp-26-II.yaml:61`
  sigue con `usado_en_codigo: []`. El aviso ahora SÍ menciona el derecho de
  oponerse a esa revisión (mejora real, ver arriba), pero la arquitectura que
  activa el supuesto del art. 26 fr. II —decidir sin que una persona mire
  antes— es la misma que auditó la ronda 5.

## Lo que NO alcancé a revisar

- **Los logs reales de Vercel/Sentry.** Sigue pendiente desde la ronda 5; no
  cambia esta ronda.
- **El contrato entre Likida y la flota, y el aviso propio de Likida como
  responsable** (para el contralor y los leads). Ninguno de los dos vive en el
  repo; sigue igual que la ronda 5.
- **Si el mismo problema de substring de `RELLENOS`** afecta a algún otro punto
  del producto que use listas de palabras cortas para detectar "relleno" o
  "placeholder" — solo revisé `privacidad.ts`, que es el único archivo de este
  rubro; no descarté el patrón en otros módulos fuera de mi alcance.
- **Si existe, fuera del repo, algún runbook manual que ejecute
  `sondearAvisoIntegral`** (por ejemplo, a mano antes de cada demo). Solo pude
  verificar ausencia de automatización; no puedo verificar un proceso humano no
  documentado.
