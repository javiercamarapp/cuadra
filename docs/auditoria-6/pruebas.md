# Pruebas — auditoría 6

**Nota: 4/10** (igual que la ronda 5). Razón: **deuda que cobró factura**. El
4/10 de ayer no estaba inflado —se ganó corriendo el chequeo que define este
rubro por primera vez— así que no hay "mirada más profunda" que aplicar. Y no
hay "se atacó y subió": aunque las 12 mutaciones de dinero de la ronda 5 sí
quedaron cerradas (lo verifiqué por lectura de los tests nuevos, no las repetí:
la instrucción de esta ronda es no repetirlas), el propio cierre de esa ronda
diagnosticó por escrito el patrón que iba a seguir pasando —*"se extrae la
lógica a una función pura, se prueba la función pura, y el cableado queda sin
prueba"*— y terminaba con una predicción explícita: *"la tasa real de mutantes
que sobreviven en el repo entero es probablemente peor, no mejor"*. Diseñé 12
mutaciones nuevas, exclusivamente sobre las líneas que los commits de ayer
escribieron en `conv.ts`, `estado_afirmado.ts`, `fundamento.ts`, `passcode.ts`,
`acreditable.ts`, `repo.ts` y `processor.ts` (verificado línea por línea contra
`git show` de los commits `dafd560`, `3bc0308` y `fa03b00`). **Sobrevivieron
10 de 12** — una tasa peor que el 12/21 de ayer, exactamente lo que la
predicción decía.

**La pregunta de la ronda, respondida:** los 55 arreglos de ayer nacieron
**sin arnés**, con dos excepciones verificadas (`fundamento.ts`, protegido por
`fundamento_ronda5.test.ts`, y una de las cinco frases de
`estado_afirmado.test.ts` que por casualidad ejercita la rama que intenté
romper). El resto —incluidos tres de los CRÍTICOS que los propios mensajes de
commit de ayer nombran como cerrados— se puede revertir sin que ni una sola de
las 990 pruebas se entere.

**Riesgo mayor hoy:** el patrón "función pura probada, cableado sin probar" ya
no es una hipótesis de la ronda pasada. Lo encontré en cinco sitios nuevos hoy:
quién decide el tenant del dinero (`resolveOperador`), si un viaje sigue
abierto (`getOpenViaje`), si hay que detener el tratamiento de datos por falta
de aviso de privacidad (el `if` en `processor.ts`), si la constancia de un
aviso enviado se deshace cuando el envío falló (`liberarEnvioAviso`), y si el
modelo puede afirmar un cierre que no ocurrió (el cableado de `guardiaEstado`
en `processor.ts`). Los cinco están un `git revert` de distancia de volver, y
la suite seguiría en verde.

---

## Hallazgos

### [CRÍTICO] Las tres funciones que decidieron quién es dueño del dinero no tienen ni una prueba directa

`src/lib/cuadra/conv.ts:59-98` (`resolveOperador`) · `:123-140` (`getOpenViaje`)
· `:325-334` (`intakeDelta`)

**Escenario.** Las tres se reescribieron ayer en los commits `dafd560` y
`fa03b00` para cerrar tres CRÍTICOS/ALTOS: `resolveOperador` pasó de
`.limit(1)` (adivinaba un tenant arbitrario ante un teléfono ambiguo) a
`.limit(2)` + `throw OperadorAmbiguo`; `getOpenViaje` pasó de `if (error ||
!data) return null` (afirmaba "ese viaje ya quedó cerrado" ante un simple
fallo de red) a `if (error) throw ConsultaFallida`; `intakeDelta` pasó de
`return 0` a `return null` ante un fallo de RPC, para que la barrera de ráfaga
sea fail-closed. Confirmé con `command grep -rn "from './conv'" --include
"*.test.ts"` que **ningún archivo de prueba importa estas tres funciones para
correrlas de verdad**: `barrera.test.ts` y `barrera_fail_closed.test.ts`
prueban `esperarIntake` con un `probe` inyectado que reemplaza a
`intakeDelta` por completo, y `consulta_fallida.test.ts` prueba únicamente que
la clase `ConsultaFallida` es distinguible de un `Error` —nunca llama a la
función que decide cuándo lanzarla. En los tests de `processor.ts`,
`resolveOperador` y `getOpenViaje` están `vi.mock`eados en las tres
suites que los mencionan.

Revertí las tres mutaciones sobre la COPIA (nunca el árbol real, ver método
abajo) y las tres corrieron con **990/990 verde**:

```
M1  .limit(2) → .limit(1)                    conv.ts:73   → 990 pasan
M2  throw ConsultaFallida → return null       conv.ts:137  → 990 pasan
M3  return null → return 0 (RPC error)        conv.ts:331  → 990 pasan
```

**Consecuencia.** `resolveOperador` roto reintroduce exactamente el bug que el
commit de ayer describe: "dinero de una flota anotado en la de otra, y en
silencio" — un teléfono que resuelve a dos operadores de dos flotas distintas
vuelve a escribir en la primera fila que Postgres devuelva, sin `order by`.
`getOpenViaje` roto hace que un operador con un viaje abierto reciba "no
tienes viaje abierto para liquidar" ante un simple timeout de red.
`intakeDelta` roto reabre la barrera de ráfaga en silencio: una foto en OCR
cuando llega "listo" se pierde del cuadre, con el PDF ya emitido.

**Severidad: CRÍTICO.** Money-routing en un producto multi-tenant, sin señal.

---

### [CRÍTICO] La guardia que impide que el modelo mienta sobre un cierre está probada como función pura; su cableado en `processor.ts` no tiene ni una prueba

`src/lib/cuadra/processor.ts:735-741`

**Escenario.** `estado_afirmado.test.ts` (68 líneas, 11 casos) prueba a fondo
`guardiaEstado` como función aislada, y lo hace bien. Pero ni
`processor_cadena.test.ts`, ni `processor_lock.test.ts`, ni
`processor_cierre.test.ts` —las tres suites que ejecutan `processInbound` de
punta a punta— hacen que el agente devuelva un texto que afirme un cierre
falso. El cableado que decide SI se llama a `guardiaEstado` nunca se ejerce.
Comenté el `if` completo:

```
M11  if (!textoDeterminista) { const est = guardiaEstado(...); ... }
     → if (false && !textoDeterminista) { ... }        processor.ts:735
     990/990 pasan
```

Es el mismo hallazgo que el reporte de la ronda 5 nombró como "el patrón
dominante de esta suite" —ahí fue `meta/client.ts` dejando de llamar a
`destinatarioWhatsApp`; aquí es `processor.ts` dejando de llamar a
`guardiaEstado`— y es la QUINTA vez que este patrón aparece en el repo, en un
sitio nuevo, sobre el CRÍTICO que el propio commit de ayer (`3bc0308`) llama
"REINCIDENTE de las rondas 3, 4 y 5".

Un dato colateral: al intentar romper `AFIRMA_ENVIO` en `estado_afirmado.ts`
(gutear el arreglo a `[]`, mutación M4) la suite SÍ atrapó el cambio — pero
por una casualidad de redacción, no por diseño: la frase de prueba "Ya le
mandé tu liquidación a tu contralor..." dispara `AFIRMA_ENVIO`, no
`AFIRMA_CIERRE`, aunque vive en el `describe` llamado *"afirmar un cierre que
no ocurrió"*. Es la única razón por la que esa rama tiene cobertura.

**Consecuencia.** Si alguien retira o reordena esa llamada en un refactor
—exactamente lo que pasó con `destinatarioWhatsApp` el 28-jul—, el modelo
puede volver a decir "ya quedó cerrada tu liquidación ✅" con el viaje
`abierto`, sin liquidación ni PDF, y las 990 pruebas siguen en verde.

**Severidad: CRÍTICO.**

---

### [CRÍTICO] `liberarEnvioAviso` —el arreglo de ayer para la "constancia falsa"— nunca se ejecuta en ninguna prueba

`src/lib/cuadra/repo.ts:476-483`

**Escenario.** Función nueva de ayer (commit `3bc0308`), escrita para
deshacer la reserva del aviso de privacidad cuando `sendText` no logra
entregarlo — sin ella, la base afirma ante la autoridad que un operador
recibió su aviso (art. 16 LFPDPPP) cuando nunca lo recibió, que es
textualmente lo que pasó el 28-jul. La reduje a un no-op:

```
M8  liberarEnvioAviso(...) { const {error} = await acotada(...update...); ... }
    →  liberarEnvioAviso(...) { return; }                repo.ts:476
    990/990 pasan
```

Confirmé por qué: en las tres suites de `processor.ts` que importan
`@/lib/cuadra/repo`, `liberarEnvioAviso` está `vi.fn()` — nunca corre el
cuerpo real. Ninguna prueba importa `repo.ts` para ejercer esta función
directamente (a diferencia de `addGasto` o `saveLiquidacion`, que sí tienen
suite propia en `repo_escritura.test.ts`).

**Consecuencia.** El bug que el commit de ayer describe como CRÍTICO —una fila
que certifica ante la autoridad un cumplimiento que no ocurrió— puede
reaparecer con un cambio de una línea en un archivo que ninguna prueba toca.

**Severidad: CRÍTICO.**

---

### [ALTO] El bloqueo de tratamiento sin aviso de privacidad nunca se ha probado de punta a punta

`src/lib/cuadra/processor.ts:144-183` (`ponerAvisoADisposicion`) · `:285-297`
(el `if (!avisoPuesto)`)

**Escenario.** Comentario del propio código: *"SIN AVISO NO HAY TRATAMIENTO...
Antes se seguía de largo: la foto se descargaba y se mandaba a un modelo
externo sin el aviso que lo ampare"* — arreglado ayer en `fa03b00`. En las
tres suites de `processor.ts`, `getDatosResponsable` está mockeado para
devolver SIEMPRE datos completos (`processor_cadena.test.ts:104`,
`processor_lock.test.ts:66`), así que `avisoPuesto` nunca sale `false` y la
rama de bloqueo nunca corre. La comprobé neutralizando la condición:

```
M10  if (!avisoPuesto) { ...; return; }
     →  if (false && !avisoPuesto) { ...; return; }      processor.ts:286
     990/990 pasan
```

**Consecuencia.** Si `ponerAvisoADisposicion` empieza a devolver `false` por
cualquier motivo nuevo (un cambio en `avisoSimplificado`, un tenant mal
configurado) y esta condición se pierde en un refactor, el sistema vuelve a
tratar datos personales —fotos de tickets, montos— sin aviso, sin que la
suite lo note.

**Severidad: ALTO.**

---

### [ALTO] `getDatosResponsable` —quién puede recibir el aviso— tampoco se prueba directamente

`src/lib/cuadra/repo.ts:415-436`

**Escenario.** El guard `return r.razonSocial && r.domicilio ? r : null;` se
tocó ayer (commit `1425b03`): antes exigía también `urlAvisoIntegral`, lo que
dejaba al operador sin ningún aviso cuando la liga del portal no existía.
Quité el guard entero:

```
M9  return r.razonSocial && r.domicilio ? r : null;
    →  return r;                                          repo.ts:435
    990/990 pasan
```

Igual que `liberarEnvioAviso`, esta función solo aparece mockeada en los tests
de `processor.ts`; ninguna prueba llama al `repo.ts` real con un tenant sin
razón social o domicilio para verificar que efectivamente se bloquea.

**Consecuencia.** Sin el guard, un tenant sin razón social ni domicilio
capturados —o sea, uno que nunca terminó de darse de alta— pasaría el aviso
con campos vacíos en vez de bloquear el tratamiento, exactamente el escenario
que el bloqueo de `processor.ts` (hallazgo anterior) existe para evitar. Los
dos huecos se refuerzan: si cualquiera de los dos se rompe solo, nada avisa.

**Severidad: ALTO.**

---

### [MEDIO] El passcode del panel puede debilitarse en su largo mínimo sin que la suite se entere

`src/lib/auth/passcode.ts:115`

**Escenario.** `LARGO_MINIMO = 24` es, según el propio comentario del código,
la defensa central contra fuerza bruta offline (el ataque que
`DASHBOARD_SECRET` viene a cerrar). La bajé a 1:

```
M6  const LARGO_MINIMO = 24;  →  const LARGO_MINIMO = 1;   passcode.ts:115
    990/990 pasan
```

Revisé por qué ninguno de los 9 casos de `passcode.test.ts` lo atrapa: cada
candidato "débil" de la lista (`'likida-demo-2026'`, `'qwertyqwertyqwerty...'`,
`'aaaaaa...'`) cae por la palabra predecible o por el conteo de caracteres
distintos, nunca por el largo en solitario. No hay un caso que sea "corto,
aleatorio, sin palabra predecible" — el único que aislaría este umbral.

**Consecuencia.** Un passcode corto pero sin palabra reconocible (p. ej. 8
caracteres aleatorios) pasaría `motivoPasscodeDebil` si `LARGO_MINIMO` se
debilitara por error, aunque sea muy poco entrópico para resistir fuerza
bruta offline. Mitigante real: haría falta ADEMÁS tocar este archivo, y el
resto de las defensas (palabra predecible, caracteres distintos) seguiría
activo — por eso MEDIO y no ALTO.

**Severidad: MEDIO.**

---

### [MEDIO] `acreditable.ts` no se defiende de un litros negativo, y nada lo prueba

`src/lib/cuadra/liquidacion/acreditable.ts:92`

**Escenario.** El renglón de diésel se imprime con `if (litros > 0)`. Cambié
la condición a `litros !== 0`:

```
M7  if (litros > 0) { ... }  →  if (litros !== 0) { ... }   acreditable.ts:92
    990/990 pasan
```

Sobrevive porque ningún caso de `acreditable.test.ts` pasa un valor negativo:
todos los fixtures usan 0 (para el caso "sin nada que acreditar") o positivos.
`litros > 0` y `litros !== 0` se comportan idéntico frente a cualquier entrada
que la suite pruebe.

**Consecuencia.** Si `litrosDieselAcreditables` llegara negativo por un bug
del motor (`engine.ts`) —hoy no debería, pero nada en `acreditable.ts` lo
verifica ni lo prueba—, el PDF imprimiría un renglón como "-50 L" bajo el
título "Diésel elegible para el estímulo de IEPS", con su cita de LIF 2026
art. 20-A al lado. Severidad contenida porque requiere una corrupción previa
en una capa que este archivo no controla.

**Severidad: MEDIO.**

---

### [MEDIO] La señal de "hay un PDF sin entregar, alguien tiene que entrar a mano" puede apagarse sin que la suite se entere

`src/lib/cuadra/processor.ts:618` (`ctxCerro = closed;`)

**Escenario.** Arreglo de ayer (`fa03b00`): el `catch` general no sabía si la
liquidación ya había cerrado antes de fallar, así que el log
`processInbound.fail` no distinguía un error banal de un huérfano de cierre
parcial. Comenté la asignación:

```
M12  ctxCerro = closed;  →  // ctxCerro = closed; (comentado)  processor.ts:618
     990/990 pasan
```

Ninguna de las tres suites de `processor.ts` verifica el campo
`cerroSinEntregar` del log (`command grep -rn "cerroSinEntregar"
--include="*.test.ts"` no devuelve nada).

**Consecuencia.** No es un bug de dinero: el dinero ya está escrito
correctamente en la base con o sin esta señal. Es una regresión de
operabilidad — el campo que le dice a quien revisa los logs a las 3 a.m. "hay
un PDF sin entregar, entra a mano" volvería a estar siempre en `false`, y el
caso volvería a ser indistinguible de un fallo banal sin que nadie lo note
hasta que un operador se queje de no haber recibido su PDF.

**Severidad: MEDIO.**

---

## Las mutaciones nuevas, todas

Método: cada mutación se aplicó en una **copia del repo fuera del árbol**
(`rsync -a --exclude node_modules --exclude .next --exclude .git` hacia el
scratchpad de la sesión, con `node_modules` symlinkeado — sin tocar el árbol
real ni una sola vez). Confirmé la copia fiel a la línea base corriendo
`npx vitest run` antes de mutar: **103 archivos, 990 pasan, 1 saltada**,
idéntico al número que reporta `docs/auditoria-6/MAPA.md`. Cada mutación se
aplicó con un script de sustitución única (`assert s.count(old) == 1`), se
corrió la suite completa, y el archivo se restauró desde el original antes de
la siguiente. El árbol real (`/Users/.../cuadra`) se verificó limpio al cerrar:

```
$ git status --short
?? docs/auditoria-6/
$ git stash list
(vacío)
$ git diff --stat
(vacío)
```

No usé `git stash` en ningún punto — toda la mutación ocurrió en la copia.

| # | Mutación | `archivo:línea` | Resultado |
|---|---|---|---|
| M1 | `resolveOperador`: `.limit(2)` → `.limit(1)` (mata la detección de `OperadorAmbiguo`) | `conv.ts:73` | **990 pasan** — sobrevive |
| M2 | `getOpenViaje`: `throw ConsultaFallida` → `return null` ante error (vuelve "ese viaje ya quedó cerrado" falso) | `conv.ts:137` | **990 pasan** — sobrevive |
| M3 | `intakeDelta`: `return null` → `return 0` ante error de RPC (reabre la barrera en silencio) | `conv.ts:331` | **990 pasan** — sobrevive |
| M4 | `estado_afirmado.ts`: vacía `AFIRMA_ENVIO` (deja de detectar "ya te lo mandé" falso) | `estado_afirmado.ts:58-61` | 1 falla — **muere** (por una frase que casualmente ejercita esa rama) |
| M5 | `fundamento.ts`: revierte la ventana lazy `{0,45}?` a codiciosa `{0,45}` en las dos direcciones | `fundamento.ts:65-66` | 2 fallan — **muere** (control: `fundamento_ronda5.test.ts` protege) |
| M6 | `passcode.ts`: `LARGO_MINIMO` de 24 a 1 | `passcode.ts:115` | **990 pasan** — sobrevive |
| M7 | `acreditable.ts`: `litros > 0` → `litros !== 0` (deja pasar negativos) | `acreditable.ts:92` | **990 pasan** — sobrevive |
| M8 | `repo.ts`: `liberarEnvioAviso` reducida a no-op (vuelve la "constancia falsa") | `repo.ts:476` | **990 pasan** — sobrevive |
| M9 | `repo.ts`: `getDatosResponsable` pierde el guard `razonSocial && domicilio` | `repo.ts:435` | **990 pasan** — sobrevive |
| M10 | `processor.ts`: el bloqueo `if (!avisoPuesto)` deja de ejecutarse | `processor.ts:286` | **990 pasan** — sobrevive |
| M11 | `processor.ts`: la llamada a `guardiaEstado` deja de ejecutarse | `processor.ts:735` | **990 pasan** — sobrevive |
| M12 | `processor.ts`: `ctxCerro = closed;` comentada (log `cerroSinEntregar` siempre falso) | `processor.ts:618` | **990 pasan** — sobrevive |

**10 de 12 sobreviven (83%).** Peor proporción que el 12/21 (57%) de la ronda
5, y sobre código escrito específicamente para cerrar los hallazgos de esa
misma ronda.

Salida real de M8, la más grave por tratarse literalmente del arreglo
etiquetado CRÍTICO ayer:

```
########## M8: repo.ts - liberarEnvioAviso deja de hacer el UPDATE ##########
mutated OK
 Test Files  103 passed (103)
      Tests  990 passed | 1 skipped (991)
   Duration  8.68s
--- restaurando ---
repo.ts restaurado OK
```

Y de M11, el cableado de la guardia de estado:

```
########## M11: processor.ts - la guardia de estado deja de correr (cableado) ##########
 Test Files  103 passed (103)
      Tests  990 passed | 1 skipped (991)
   Duration  9.04s
--- restaurando ---
processor.ts restaurado OK
```

---

## Lo que SÍ mejoró desde la ronda 5, y hay que decirlo

- **Las 12 mutaciones de dinero de la ronda 5 sí se cerraron.** No las repetí
  (instrucción explícita de esta ronda), pero confirmé por lectura que sus
  anclas existen: `destinatario.test.ts` sigue probando `destinatarioWhatsApp`
  y `processor_cierre.test.ts` ahora usa un `fetch` real interceptado en vez de
  espiar `@/lib/meta/client` completo —el cambio de arquitectura de pruebas que
  el propio reporte de ayer pedía—, así que el `to` que de verdad viaja a Meta
  se verifica, no un mock. `guardia.test.ts`, `deducibilidad.test.ts` y
  `engine.test.ts` (mutaciones M2–M9 de ayer) siguen presentes con la misma
  forma.
- **Cobertura con umbral que rompe el CI, y ya no es un MEDIO abierto.**
  `vitest.config.ts:75-78` tiene `thresholds: { lines: 78, branches: 84, ... }`
  y `@vitest/coverage-v8` está instalado. Cierra el MEDIO "no hay medición de
  cobertura" de la ronda 5.
- **El CI corre en TODAS las ramas, no solo master/main.** El comentario del
  propio `ci.yml` documenta el cambio y por qué: las rutinas de nube pushean a
  `claude/*`. Cierra el otro MEDIO de la ronda 5.
- **`fundamento_ronda5.test.ts` es un arnés bien dirigido.** Es la ÚNICA de
  las 12 mutaciones que apuntaba a un CRÍTICO de ayer y murió al primer
  intento (2 pruebas), confirmado arriba (M5). Vale la pena decir por qué
  funciona donde las otras no: se escribió reproduciendo el escenario EXACTO
  del bug (la frase con dos citas, una real y una a 45 caracteres), no una
  aserción genérica sobre la función.
- **990 pruebas, 103 archivos** (eran 628/65 en la ronda 5): crecimiento real,
  no solo de casos sobre funciones ya cubiertas — `estado_afirmado.test.ts`,
  `acreditable.test.ts`, `fundamento_ronda5.test.ts` y las pruebas ampliadas
  de `processor_cierre.test.ts` cubren código que no existía ayer.

---

## Zonas sin arnés, esta ronda

Ordenadas por lo que cuesta que fallen:

1. **`resolveOperador` y `getOpenViaje` (conv.ts).** Las dos funciones que
   decidieron los CRÍTICOS "dinero de otra flota" y "afirma un cierre falso"
   de ayer. Cero pruebas directas.
2. **El cableado de `guardiaEstado` en `processor.ts`.** Quinta aparición del
   patrón "función pura probada, cableado no".
3. **`liberarEnvioAviso` y `getDatosResponsable` (repo.ts).** Las dos piezas
   del CRÍTICO "constancia falsa" de ayer. Solo existen mockeadas.
4. **El bloqueo de tratamiento sin aviso (`processor.ts:286`).** Nunca se
   ejercitó `avisoPuesto = false` en ninguna prueba.
5. **`intakeDelta` (conv.ts).** Su cuerpo real —a diferencia de `esperarIntake`,
   que sí tiene arnés vía `probe`— nunca corre en la suite.
6. **Umbrales sueltos.** `LARGO_MINIMO` en `passcode.ts`, el `> 0` de litros en
   `acreditable.ts`: se prueban los flujos que los usan con valores típicos,
   no los valores límite.

---

## Lo que NO alcancé a revisar

- **El resto de las 55 líneas de cambio de ayer** que no caían en los 7
  archivos que me tocaron (p. ej. `meta/client.ts`, `startup.ts`,
  `webhook/route.ts`, `ratelimit.ts`): fuera de mi alcance esta ronda por
  instrucción explícita.
- **`arnes_ticket_real.test.ts`** — el ALTO de la ronda 5 (cero `expect`) no lo
  revisé de nuevo; no toqué `pruebas-manuales/*` ni nada con `TICKET_PATH`
  (prohibido).
- **Cobertura real de líneas de los 7 archivos.** No corrí
  `npm run test:coverage` por archivo; mi lista de zonas sin arnés sale de
  mutación dirigida y de búsqueda de imports (`command grep`), no de un
  reporte de cobertura línea por línea.
- **Si las 12 mutaciones de dinero de la ronda 5 siguen muertas hoy.** Las di
  por buenas por lectura de sus anclas (existen, con la forma correcta), no
  las corrí de nuevo — la instrucción de esta ronda es explícita en no
  repetirlas.
- **`supabase/verificaciones.sql`** y las restricciones de la base: fuera de
  este rubro.
