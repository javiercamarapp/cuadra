# Pruebas — auditoría 5

**Nota: 4/10** (antes 7). Razón: **mirada más profunda** — el 7 se heredó sin auditar
("no auditado esta ronda" en la ronda 4) y el chequeo que define este rubro nunca se
había corrido. Se corrió hoy: **de 21 mutaciones deliberadas sobre dinero, 12 dejaron
la suite en 628/628 verde**, `tsc` en 0 y `eslint` en 0. Y **deuda que cobró factura**:
el hallazgo ALTO de la ronda 4 (el chofer recibe el ejemplar del contralor) quedó
anclado en la función pura y no en el sitio que elige el destinatario, así que se puede
reintroducir sin que nada falle. El ancla del rubro es explícita: *"4 o menos si la
suite pasa con la función rota"*.

**Riesgo mayor hoy:** la suite prueba el **cálculo** del dinero y no prueba su
**impresión ni su cableado** — se puede imprimir "Total comprobado" diez veces mayor en
el PDF, invertir de quién es la diferencia en el WhatsApp, y volver a poner el `521`
que rebota con todo operador mexicano, y las 628 pruebas siguen verdes.

---

## Hallazgos

### [CRÍTICO] Ninguna cifra que ve el comprador está probada: ni en el PDF ni en WhatsApp

`src/lib/cuadra/liquidacion/pdf.ts:241` · `src/lib/cuadra/cuadre/resumen.ts:51,54,56` ·
`src/lib/cuadra/liquidacion/pdf.ts:246`

**Escenario.** Cambié `mxn(liq.totalComprobado)` por `mxn(liq.totalComprobado * 10)` en
la línea que imprime el total del PDF. Suite verde. Lo mismo en el mensaje de WhatsApp
(`resumen.ts:51`). Verde. Invertí el signo de la diferencia — que "Sobró $X del anticipo
(a favor de la empresa)" diga "Pusiste $X de tu bolsa (a favor tuyo)" — verde. Descablé
las tres cubetas de deducibilidad del PDF (`const deduc = null`), que son literalmente
"la cifra que compra el contralor" según el comentario del propio motor: verde.

`pdf.test.ts` **sí tiene** un extractor de texto del PDF que funciona (`textoDelPdf`,
línea 80) y lo usa para verificar qué secciones aparecen según el destinatario. No lo
usa **ni una vez** para verificar un monto. `resumen.test.ts` (169 líneas, 15 pruebas)
verifica exhaustivamente *quién ve qué*, y su fixture principal fija `diferencia: 0`, con
lo que la rama del signo nunca se afirma aunque sí se ejecuta.

**Consecuencia.** Un error de una línea en la impresión llega íntegro al PDF que el
contralor archiva y al mensaje que el operador cobra, con toda la suite en verde. En el
demo del 6-ago es el paso que el comprador mira.

**Causa raíz.** La frontera de las pruebas está en el motor (`engine.test.ts`, 1,238
líneas). Todo lo que pasa después del `return` del motor —formatear, imprimir, enviar—
se prueba por estructura, nunca por valor.

---

### [CRÍTICO] El bug de dinero de HOY se puede reintroducir tal cual y la suite no se entera

`src/lib/meta/client.ts:73` y `src/lib/meta/client.ts:98`

**Escenario.** `destinatario.test.ts` (5 pruebas, 9 assertions) ancla la función pura
`destinatarioWhatsApp` con el caso medido contra la Graph API. Dejé la función intacta y
correcta, y solo quité su llamada en los dos sitios que envían:

```
- to: destinatarioWhatsApp(to), type: 'text', ...   (sendText)
+ to: to, type: 'text', ...
- to: destinatarioWhatsApp(to),                     (sendDocument)
+ to: to,
```

Resultado transcrito: `Test Files 64 passed | 1 skipped` · `Tests 628 passed | 1 skipped`
· `tsc exit=0` · `eslint` sin salida. Cero señal.

Y hay un dato colateral que lo agrava: cuando rompí la **sintaxis** de `client.ts` a
propósito, solo falló **un** archivo de prueba. `src/lib/meta/client.ts` lo importa
exactamente un test en toda la suite. `processor_cierre.test.ts` y `processor_lock.test.ts`
hacen `vi.mock('@/lib/meta/client', …)`: el camino real de envío nunca se ejecuta.

**Consecuencia.** El bug que costó el día —la respuesta rebotando con **todo** operador
mexicano, en silencio, con webhook 200 y `agent.run` en verde— vuelve con un refactor
inocente. La prueba de regresión que se escribió hoy no lo impide: ancla un ayudante que
nadie está obligado a usar.

**Causa raíz.** Es el patrón dominante de esta suite: se extrae la lógica a una función
pura, se prueba la función pura, y **el cableado queda sin prueba**. El bug nunca estuvo
en la función; estuvo en que el call site no la usaba.

---

### [CRÍTICO] `src/app/` entero —el webhook y el export de dinero— tiene cero pruebas

`src/app/api/webhook/whatsapp/route.ts:45` · `:106` ·
`src/app/api/export/liquidaciones/route.ts` · `src/lib/cuadra/export.ts:46-47`

**Escenario.** Cuatro mutaciones, cuatro veces 628 verde:

1. `route.ts:45` — la ruta deja de validar la firma HMAC (`if (false && !verifySignature(...))`).
2. `client.ts:34` — `verifySignature` devuelve `true` para cualquier firma.
3. `route.ts:106` — `extractMessages` descarta **todas** las fotos entrantes: ningún gasto
   vuelve a entrar al sistema jamás.
4. `export.ts:46-47` — el CSV que va al ERP intercambia `total_comprobado` con `anticipo`.

Ningún test importa nada de `src/app/**` (verificado con dos búsquedas: `find src/app -name "*.test.ts*"`
vacío, y `command grep -rn "app/api" --include="*.test.ts" src` devuelve solo la lectura
de `route.ts` **como texto** que hace `presupuesto.test.ts:82` para comparar `maxDuration`).
`src/lib/cuadra/export.ts` no lo importa ninguna prueba: `toCsv` y `toLiquidacionRows`
tienen cero cobertura.

**Consecuencia.** El único punto de entrada del producto y la única salida hacia el ERP
del cliente no tienen arnés. El caso 4 es especialmente barato de introducir: es un mapeo
a mano de campo a campo, exactamente la clase de error para la que se escribió
`repo_escritura.test.ts` — pero solo se cubrió la escritura hacia la base, no la salida
hacia Excel.

**Causa raíz.** Decisión implícita de que "las rutas son pegamento". El pegamento aquí
lleva HMAC, filtro por tenant, rate limit y un mapeo de dinero.

---

### [ALTO] La tolerancia de la guardia de cifras —la regla fundacional— no está anclada

`src/lib/cuadra/cuadre/cifras.ts:89`

**Escenario.** `const TOL = 0.011` es lo que decide si una cifra que el modelo escribió
está respaldada por una tool. La cambié a `5000`: **628 verde**. Con esa tolerancia,
teniendo la tool devuelto `{ totalComprobado: 4812.5 }`, un texto inventado por el modelo
pasa como respaldado. Medido con el módulo real:

```
B) TOL actual = 0.011
   cifrasSinRespaldo("Te sobraron 4800 del anticipo.") = [ 4800 ]
   (con TOL=5000 la lista sale vacia = "todo respaldado" y el texto inventado se manda tal cual)
```

**Consecuencia.** El backstop de "ninguna cifra que vea el usuario sale del LLM" se puede
ampliar 450,000× sin que nada falle. `guardia.test.ts` prueba a fondo el *flujo* de la
guardia (M7, M8 y M9 abajo la atraparon), pero ninguna prueba fija el *umbral numérico*
del que depende su veredicto.

**Causa raíz.** Se probó la máquina de estados y no la constante que la alimenta.

---

### [ALTO] El requisito de medio de pago del estímulo de diésel (LIF 2026 20-A, ap. IV) no tiene prueba

`src/lib/cuadra/cuadre/engine.ts:583`

**Escenario.** Cambié `const pagoElectronico = !!g.formaPago && g.formaPago !== '01';`
por `const pagoElectronico = true;`. **628 verde.** Con esa mutación, el diésel pagado en
efectivo entra a `litrosDieselAcreditables`. Verificado con el motor real (script
temporal, sin red ni base):

```
A) diesel EN EFECTIVO, 200 L, claveProdServ 15101505
   litrosDieselAcreditables = 0 (correcto: 0, LIF 20-A-IV 4o parrafo)
   con formaPago 03 (transferencia) = 200
```

Con la mutación, el caso de efectivo devolvería 200 L y nadie se enteraría.

**Consecuencia.** Los litros elegibles son el dato que el PDF y el mensaje de WhatsApp le
entregan al contador para multiplicar por la cuota del DOF. Inflar ese número es reclamar
un estímulo sin derecho, y el papel se lo dio Likida. El comentario del código explica el
requisito con precisión (*"no tiene la válvula del 15% que la RFA 2.9 sí concede para
ISR"*): la regla está entendida y escrita, y no está probada.

---

### [ALTO] `arnes_ticket_real.test.ts` no tiene ni una assertion: no es una prueba, es un `console.log`

`src/lib/cuadra/arnes_ticket_real.test.ts:48-90`

**Escenario.** `command grep -c "expect" src/lib/cuadra/arnes_ticket_real.test.ts` → **0**.
Es el único archivo de la suite sin una sola assertion. Corre el pipeline completo (OCR
real + motor) e imprime todo por consola. Con `TICKET_PATH` puesto y ~$0.02 USD gastados,
**pasa siempre**, salvo que algo lance.

**Consecuencia.** Un arnés que nunca corre (se salta sin `TICKET_PATH`) y que, cuando
corre, no puede fallar, no es cobertura: es un visor. Responde la pregunta que se me pidió
evaluar — un test que casi nunca corre no cuenta como cobertura, y este ni siquiera
contaría si corriera todos los días. Su valor real es de instrumento de diagnóstico
manual, y como tal está bien construido (imita `decidirFoto`, pasa la config entera, agrupa
por comprobante). Lo que no hay es ningún `expect` sobre litros, montos, cubetas ni
estatus, ni un caso de oro guardado contra el que comparar.

Es también el único punto de la suite que depende de la hora del sistema
(`arnes_ticket_real.test.ts:38`, `new Date()`), aunque hoy no importa porque no corre.

---

### [ALTO] REINCIDENTE — el hallazgo ALTO de la ronda 4 quedó anclado en la función, no en el cableado

`src/lib/cuadra/tools.ts:139`

**Escenario.** La ronda 4 encontró que a`sendDocument(msg.from, …)` le mandaba al chofer un
PDF con los veredictos que `resumen.ts` le oculta en el texto. Se arregló generando dos
ejemplares y `pdf.test.ts:131-158` prueba muy bien que `generarLiquidacionPDF(..., 'operador')`
filtra y `'contralor'` no.

Cambié el argumento en el único sitio que elige el destinatario:

```
- pdfOperadorPath = await subir(await generarLiquidacionPDF(full, v, o, undefined, 'operador'), …)
+ pdfOperadorPath = await subir(await generarLiquidacionPDF(full, v, o, undefined, 'contralor'), …)
```

**628 verde.** El hallazgo ALTO de la ronda anterior vuelve a estar vivo sin que nada falle.

**Consecuencia.** `tools.ts` no lo ejecuta ninguna prueba: los dos tests del processor hacen
`vi.mock('@/lib/cuadra/tools', () => ({}))` (`processor_cierre.test.ts:31`,
`processor_lock.test.ts:32`). El archivo que orquesta el cierre del dinero —computa el
cuadre, genera los dos PDFs, sube a storage y llama `saveLiquidacion`— tiene cobertura cero.

**Causa raíz.** La regla del rubro: un arreglo histórico está anclado cuando su prueba falla
si alguien lo revierte. Este se probó a un nivel más abajo del que tenía el bug.

---

### [MEDIO] El CI no corre en cada push, y las cuatro puertas se corren a mano

`.github/workflows/ci.yml:9-12`

**Escenario.** El disparador es `push: branches: [master, main]` + `pull_request`. Un push
a cualquier otra rama **no corre nada** salvo que exista un PR abierto contra master. Hay
ramas vivas fuera de esas dos: `origin/claude/auditoria-4`, `origin/claude/auditoria-4-altos`,
`origin/rutinas/paquete-completo`, `origin/tooling/auditoria-diaria`. Las rutinas de nube
pushean precisamente a `claude/*`.

Además no hay hook de pre-commit: `.git/hooks/` solo trae los `.sample` y no hay husky. El
propio encabezado del workflow lo dice: *"Las cuatro puertas que hoy se corren a mano antes
de cada commit"*. Los 33 commits de hoy pasaron por la disciplina de una persona, no por
una puerta.

**Consecuencia.** El trabajo autónomo (rutinas, subagentes) puede aterrizar en una rama sin
que typecheck, lint, test ni build corran una sola vez.

El workflow en sí está bien hecho: `npm ci`, orden correcto (typecheck → lint → test →
build), `concurrency` con `cancel-in-progress`, y el comentario que documenta el fallo real
que solo el build atrapó (el `.wasm` del lector de códigos). No es un CI de adorno; es un CI
bien escrito con el disparador demasiado angosto.

---

### [MEDIO] No hay medición de cobertura: "628 pruebas" es un conteo de pruebas, no de código

`package.json:11` (`"test": "vitest run"`) · `vitest.config.ts` (12 líneas, sin `test:`)

**Escenario.** No existe `@vitest/coverage-v8` en devDependencies ni bloque `coverage` ni
umbral en `vitest.config.ts` (verificado con `command grep -n "coverage" package.json
vitest.config.ts` → sin resultados). No hay forma de que nadie vea, sin hacer a mano lo que
hice hoy, que `tools.ts`, `export.ts`, `analytics.ts`, `sanitizar.ts` y todo `src/app/`
tienen 0% de líneas ejecutadas.

**Consecuencia.** El número que se reporta a diario ("de 517 a 628") mide esfuerzo, no
protección. Sube cuando se prueban más casos de una función ya probada, exactamente igual
que cuando se cubre una zona nueva.

---

### [MEDIO] Cinco módulos nunca se ejecutan en la suite, tres de ellos por mock

`src/lib/cuadra/tools.ts` · `src/lib/cuadra/costos.ts` · `src/lib/cuadra/export.ts` ·
`src/lib/cuadra/analytics.ts` · `src/lib/cuadra/intake/sanitizar.ts`

`tools.ts` y `costos.ts` aparecen en dos archivos de prueba cada uno, pero siempre como
`vi.mock(...)` — nunca ejecutados. `export.ts`, `analytics.ts` y `sanitizar.ts` no los
importa ninguna prueba (verificado con dos búsquedas distintas y `command grep`).
`sanitizar.ts` es la defensa contra inyección en texto de OCR; `costos.ts` es la
contabilidad del gasto por operación; `export.ts` es el CSV al ERP.

---

## Pruebas que rompí a propósito y qué pasó

Método: mutación exacta con un script de sustitución única, `npm test` completo, y
`git checkout -- <archivo>` inmediato. Verificado `git status --short` después de cada una
(solo `?? docs/auditoria-5/` en todo momento) y `git stash list` vacío al cerrar. **21
mutaciones, 12 sobreviven.** Baseline restaurado y confirmado al final: `Test Files 64
passed | 1 skipped (65)` · `Tests 628 passed | 1 skipped (629)`.

### Las que SOBREVIVEN (la prueba es decoración en ese punto)

| # | Mutación | `archivo:línea` | Resultado |
|---|---|---|---|
| M1b | `sendText`/`sendDocument` dejan de llamar `destinatarioWhatsApp` — el bug de HOY | `meta/client.ts:73,98` | **628 verde**, `tsc` 0, `eslint` 0 |
| M3 | `TOL` de la guardia: `0.011` → `5000` | `cuadre/cifras.ts:89` | **628 verde** |
| M6 | `pagoElectronico = true` (borra el requisito de LIF 20-A-IV) | `cuadre/engine.ts:583` | **628 verde** |
| M10 | `const deduc = filasDeducibilidad(liq)` → `null`: el PDF deja de imprimir las 3 cubetas | `liquidacion/pdf.ts:246` | **628 verde** |
| M11 | El PDF imprime `Total comprobado × 10` | `liquidacion/pdf.ts:241` | **628 verde** |
| M14 | El WhatsApp dice `Comprobado × 10` | `cuadre/resumen.ts:51` | **628 verde** |
| M15 | `verifySignature` devuelve `true` siempre | `meta/client.ts:34` | **628 verde** |
| M16 | Se invierte el signo de la diferencia en el mensaje al operador | `cuadre/resumen.ts:54` | **628 verde** |
| M17 | La ruta del webhook deja de validar la firma | `api/webhook/whatsapp/route.ts:45` | **628 verde** |
| M18 | La ruta descarta **todas** las fotos entrantes | `api/webhook/whatsapp/route.ts:106` | **628 verde** |
| M19 | El PDF del chofer se genera con el ejemplar del contralor (ALTO ronda 4) | `cuadra/tools.ts:139` | **628 verde** |
| M21 | El CSV al ERP intercambia `total_comprobado` y `anticipo` | `cuadra/export.ts:46-47` | **628 verde** |

Salida real de la más grave (M1b), transcrita completa:

```
MUTADO src/lib/meta/client.ts: 'to: destinatarioWhatsApp(to), type: 'text'' -> 'to: to, type: 'text''
MUTADO src/lib/meta/client.ts: '      to: destinatarioWhatsApp(to),   // el PDF rebotaba igual que el ' -> '      to: to,'
--- npm test ---
 Test Files  64 passed | 1 skipped (65)
      Tests  628 passed | 1 skipped (629)
   Duration  7.08s
--- npx tsc --noEmit ---
tsc exit=0
--- npm run lint ---
> cuadra@0.1.0 lint
> eslint .
########## RESTAURO ##########
?? docs/auditoria-5/
```

Y la del PDF (M11), que es la cifra que el comprador mira primero:

```
MUTACION: M11 - el PDF imprime el TOTAL COMPROBADO multiplicado por 10
MUTADO src/lib/cuadra/liquidacion/pdf.ts: '  totalRow('Total comprobado', mxn(liq.totalComprobado), font);'
   -> '  totalRow('Total comprobado', mxn(liq.totalComprobado * 10), font);'
 Test Files  64 passed | 1 skipped (65)
      Tests  628 passed | 1 skipped (629)
```

### Las que la suite SÍ atrapa (esto es lo que la salva de un 3)

| # | Mutación | Pruebas que fallan |
|---|---|---|
| M1 | Revierto el cuerpo de `destinatarioWhatsApp` | 2 (`destinatario.test.ts`) |
| M2 | Apago el guardia de coherencia de las 3 cubetas (`deducibilidad.ts:42`) | 2 |
| M4 | Acredito el IVA completo, sin la proporción de LIVA 5-I | 4 |
| M5 | Acredito IVA/IEPS de comprobantes sin XML verificado | 1 |
| M7 | Reabro la puerta trasera de `consultar_politica` en la guardia | 2 |
| M8 | "ocho mil pesos" en palabras deja de forzar el resumen del motor | 1 |
| M9 | El detector de dinero vuelve a decidir sobre el turno que sí cuadró | 1 |
| M12 | Descablé `identificarComercio` del motor (el cableado de HOY, `b4de699`) | **11** |
| M13 | `?? null` → `\|\| null` en `addGasto` (control) | 1 |

Ejemplo transcrito (M4, la proporción de LIVA 5-I):

```
MUTACION: M4 - acredito el IVA COMPLETO ignorando la proporcion de LIVA 5-I
 Test Files  1 failed | 63 passed | 1 skipped (65)
      Tests  4 failed | 624 passed | 1 skipped (629)
```

**El patrón es nítido y no es aleatorio:** las 9 que atrapa son mutaciones **dentro** del
motor y de la guardia. Las 12 que sobreviven son, sin excepción, mutaciones en el
**cableado** (quién llama a qué) o en la **salida** (qué se imprime y qué se envía).

### Estado del árbol al terminar

Al cerrar la última mutación (M21, 16:57) el árbol quedó limpio y la suite en baseline:

```
$ git status --short
?? docs/auditoria-5/
$ git stash list
(vacío)
$ npm test
 Test Files  64 passed | 1 skipped (65)
      Tests  628 passed | 1 skipped (629)
```

**Aviso, y no es mío.** Entre las 16:57 y las 17:00, mientras redactaba este informe,
aparecieron cambios en `src/lib/cuadra/cuadre/engine.ts` y `src/types/cuadra.ts` que
**no hice yo**: introducen `rfc_receptor_no_verificable` y cambian el reparto del exceso
de LISR 28-V a proporción del día. Es el orquestador (u otra sesión) arreglando hallazgos
en paralelo. Con esos cambios a medias la suite está en `4 failed | 624 passed` — ese
estado es de ellos, no mío, y no lo toqué.

Verifiqué que mi huella es cero de dos formas: **(1)** los 22 puntos exactos que mutué
están todos en su valor original (comprobado uno por uno con `command grep -qF`);
**(2)** ninguna de mis cadenas de mutación (`MUTACION`, `_sinUsar_`, `to: to,`,
`TOL = 5000`, `* 10)`) aparece en los dos archivos modificados. Mi última escritura sobre
`engine.ts` fue a las 16:53 y el árbol se verificó limpio después, a las 16:56:43 y de
nuevo a las 16:57:31, así que ninguno de mis `git checkout --` pudo haber pisado ese
trabajo.

No usé `git stash`: el árbol estaba limpio salvo `docs/auditoria-5/` sin trackear, así que
`git checkout -- <archivo>` restaura desde el índice —idéntico a `HEAD`— sin riesgo de
arrastrar el directorio sin trackear a un stash, y sin tocar archivos que no fueran el
mutado. Los scripts de mutación viven fuera del repo, en el scratchpad de la sesión.

---

## Zonas de dinero sin arnés

Ordenadas por lo que cuesta que fallen:

1. **La impresión de toda cifra.** `pdf.ts` (393 líneas) y `resumen.ts` (91 líneas): cero
   assertions sobre montos. `pdf.test.ts` tiene el extractor de texto listo y solo lo usa
   para secciones, nunca para pesos.
2. **`src/app/` completo.** Webhook (firma HMAC, cap de body, rate limit, `extractMessages`,
   `after()`), export CSV, ruta demo. Cero pruebas.
3. **`tools.ts`.** El orquestador del cierre: computa cuadre, genera los DOS PDFs, sube a
   storage, llama `saveLiquidacion`. Mockeado a `{}` en las dos pruebas del processor.
4. **`export.ts`.** `toCsv` y `toLiquidacionRows`: mapeo a mano de dinero hacia el ERP del
   cliente. Cero pruebas.
5. **El cableado en general.** Ninguna prueba verifica que el motor esté conectado al PDF,
   que el PDF esté conectado al envío, ni que el envío normalice el destinatario. Es la
   forma exacta de los tres bugs que se encontraron hoy corriendo el producto.
6. **`costos.ts`.** Contabilidad de gasto por operación. Mockeado en las dos pruebas donde
   aparece.
7. **`sanitizar.ts`.** Defensa contra inyección en texto de OCR. Ningún test lo importa.
8. **Umbrales y constantes.** `TOL` de la guardia, `umbralConfianza` (default `0.85`),
   `MSGS_POR_MIN`, `MAX_BODY`. Se prueban los flujos que los usan, no los valores.

---

## Lo que revisé y está bien

- **El motor es genuinamente sólido.** `engine.test.ts` son 1,238 líneas y las mutaciones
  fiscales finas (proporción de LIVA 5-I, requisito de XML verificado, coherencia de las
  tres cubetas) las atrapa. Ahí no hay decoración.
- **La guardia de cifras.** Tres mutaciones distintas sobre su lógica (M7, M8, M9) y las
  tres fallan. `guardia.test.ts` (242 líneas) prueba el flujo, no la forma.
- **`repo_escritura.test.ts`.** El mapeo camelCase → snake_case de `addGasto` y
  `saveLiquidacion` está probado campo por campo, incluidos los casos que de verdad
  muerden: el `0` que no debe volverse `NULL`, el `false` que no debe volverse `NULL`, el
  `undefined` que sí. El control M13 falló como debía.
- **Las pruebas de sincronía entre archivos son el mejor patrón del repo.**
  `presupuesto.test.ts:77-84` lee `route.ts` como texto y compara el `maxDuration` real
  contra el presupuesto. `etiquetas_sincronizadas.test.ts` y `normas_sincronizadas.test.ts`
  hacen lo mismo con los mapas de etiquetas y las 19 fichas YAML. Es exactamente la técnica
  que le falta al cableado del dinero, y ya está inventada dentro de la casa.
- **La higiene de los arneses caros.** `pruebas-manuales/*.prueba.ts` queda fuera del
  `include` de vitest porque la extensión no es `.test.ts`. Verificado: `vitest.config.ts`
  no define `include`, y el default (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) no los alcanza.
  El CI no necesita secretos ni gasta dinero, y eso está bien pensado y bien documentado.
- **`processor_cierre.test.ts` y `processor_lock.test.ts`.** Los tres hallazgos ALTOS de la
  ronda 4 que cubren (cierre sin PDF, XML que llega tarde, claim indeterminado) están
  anclados con pruebas que fallan si se revierte el arreglo, y con el comentario que
  explica el bug. Incluyen la prueba de control ("con `pdf_generado=true` manda el
  documento — sin esto lo de abajo no prueba nada"), que es el detalle que separa una
  prueba de una ilusión.
- **La suite es rápida y determinista.** 7 segundos, 65 archivos, sin dependencia de red y
  con una sola dependencia de reloj (en el arnés que no corre). Nada intermitente.
- **`pdf.test.ts:54-62`** prueba que el propio fuente de `pdf.ts` no tenga bytes de control:
  una prueba sobre el archivo, no sobre su comportamiento, que atrapó un bug real. Buen
  instinto.

---

## Lo que NO alcancé a revisar

- **El panel (`src/app/(dashboard)/`, `(admin)`, `(portal)`, `(demo)`).** No tiene ninguna
  prueba y no lo mutamos: el rubro de frontend lo cubre y no quise duplicar.
- **`supabase/verificaciones.sql`.** Es parte de la definición del rubro y no lo abrí. No sé
  si se corre, cuándo, ni contra qué.
- **Mutación de las 23 migraciones** ni de las restricciones de la base. Es del rubro de
  modelo de datos, pero la pregunta "¿hay prueba que falle si se cae una restricción?"
  queda sin responder.
- **No corrí el arnés con `TICKET_PATH`** (prohibido, cuesta dinero). Mi juicio sobre él es
  por lectura del archivo y por el conteo de `expect` = 0, no por verlo correr.
- **No revisé si existen PRs abiertos** para las ramas `claude/*`, así que no puedo afirmar
  con certeza que esos pushes hayan quedado sin CI — solo que el disparador del workflow no
  los cubre por sí solo.
- **Cobertura real de líneas.** Sin `@vitest/coverage-v8` instalado, no la medí; las zonas
  sin arnés que reporto salieron de mutación dirigida y de búsqueda de importaciones, así
  que la lista es un piso, no un inventario completo.
- **Solo mutué 21 puntos.** Elegí los que tocan dinero y los que corresponden a los commits
  de hoy. Con 12 supervivientes en 21 intentos dirigidos, la tasa real de mutantes que
  sobreviven en el repo entero es probablemente peor, no mejor.
