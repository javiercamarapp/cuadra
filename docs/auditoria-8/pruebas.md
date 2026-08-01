# Pruebas — auditoría 8

**Nota: 7/10** (antes 5). Razón del movimiento: **se atacó y subió, de verdad**
— medí con el mismo mutante exacto los cuatro hallazgos abiertos que dejó la
ronda 7 (el CRÍTICO reincidente PR-1, el ALTO de `liberarEnvioAviso`, y los dos
MEDIO) y los cuatro murieron: ya no sobreviven. Además reconfirmé por mutación
AG-3 (el snapshot de cierre) y PR-2/PR-3, y medí 10 de los ~20 archivos de
prueba nuevos —los que tocan dinero o fiscal— con mutantes reales, no lectura:
todos matan al mutante. No sube más porque **los mismos cinco supervivientes de
la ronda 6 siguen exactamente iguales, sin que nadie los toque en tres rondas**
—uno de ellos apaga el bloqueo de "sin aviso no hay tratamiento" de datos
personales y la suite completa de 1300 pruebas sigue en verde—, y porque
encontré una instancia **nueva** del mismo patrón que ya lleva seis apariciones
en este repo: una prueba que verifica el cableado por texto en vez de por
comportamiento, y el cableado real se puede apagar entero sin que nada lo note.

**Riesgo mayor del rubro, hoy:** el bloqueo de tratamiento sin aviso de
privacidad (`processor.ts:314`) se puede borrar con una sola línea y las 1300
pruebas del repo siguen pasando. Es el mismo hallazgo que la ronda 6 reportó,
que la ronda 7 reconfirmó, y que nadie ha tocado.

---

## Método

Copia del repo fuera del árbol (`rsync` al scratchpad de la sesión, con
`node_modules` symlinkeado). Confirmé la copia fiel corriendo `npx vitest run`
antes de mutar: **133 archivos, 1299 pasan, 1 saltada** — igual que en el árbol
real, que corrí en paralelo para confirmarlo (la línea base de `MAPA.md` dice
1296/132; el repo avanzó un commit de más, `ac752de`, entre que se escribió el
mapa y que empecé — no es una prueba rota, es un commit de más).

Cada mutación se aplicó con un script de sustitución única (`assert
count(old)==1`), se corrió la prueba o la suite completa, y el archivo se
restauró desde el original antes de la siguiente. El árbol real
(`/Users/javiercamaraportepetit/javiercamarapp/cuadra`) nunca se tocó — toda la
mutación ocurrió en la copia del scratchpad. Confirmado al cierre (ver abajo).

---

## Los cuatro hallazgos abiertos de la ronda 7, verificados con su mutante exacto

| # | Hallazgo | Commit que dice cerrarlo | Mutante aplicado | Resultado |
|---|---|---|---|---|
| PR-1 | `resolveOperador` — mock de `.limit()` ciego | `8844874` | `conv.ts:73` `.limit(2)`→`.limit(1)` | **muere — 1 failed** |
| PR-2 | `saveLiquidacion` — 8 de 12 parámetros | `40b886c` (ronda 7) | `repo.ts:404-409` W1-W4 (litros, IEPS, diferencias, PDF) | **las 4 mueren** |
| PR-3 | `analytics_deriva` — copia de `derivoLaConfig` | `3fb1e81` (ronda 7) | `analytics.ts:391` se borra la comparación de tamaños | **muere — 1 failed** |
| ALTO | `liberarEnvioAviso` nunca ejecuta su cuerpo | nuevo: `repo_aviso.test.ts` | `repo.ts` filtro `p_tenant` hardcodeado | **muere — 2 failed** |
| MEDIO | migración 0030 sin bloque en `verificaciones.sql` | nuevo: `migraciones_verificadas.test.ts` | se borra "0030" del título del bloque 13 | **muere — 1 failed** |
| MEDIO | pruebas de tiempo se saltan y CI solo corre `--coverage` | nuevo: `pruebas_en_ci.test.ts` + paso nuevo en `ci.yml` | se borra el paso "Pruebas de tiempo" de `ci.yml` | **muere — 1 failed** |

Los seis cierran de verdad. El de `liberarEnvioAviso` es el más notable: la
ronda 7 encontró que el arnés existente (`aviso_constancia.test.ts`) mockeaba
la función que decía cubrir. El arreglo no fue "quitar el mock" — fue escribir
`repo_aviso.test.ts`, que importa `liberarEnvioAviso` real contra un PostgREST
de mentira y corre su cuerpo. El archivo viejo se quedó, pero su encabezado
ahora dice explícitamente que solo cubre orquestación y remite al nuevo para
el cuerpo — es honesto sobre su propio límite, que es justo lo que faltaba.

También reconfirmé por mutación **AG-3** (`2f79174`, "el cierre usa el
snapshot de `guardar_liquidacion`, no recalcula") aunque es hallazgo del rubro
agéntico: inyecté un `cuadrarDesdeDB` que devuelve `$500,000` en vez de
`$8,000` y forcé `snapshotCierre = undefined` en `guardia.ts:69-72` — la
prueba nueva de `guardia.test.ts` lo atrapa (1 failed, el número falso se
filtraba al texto de WhatsApp). Toca este rubro porque el mecanismo que lo
cierra es exactamente el que la ronda 7 pedía: una prueba que inyecta un valor
DELIBERADAMENTE distinto y verifica que nunca aparece, en vez de solo
verificar que la función se llamó.

---

## Diez archivos nuevos de dinero o fiscal, medidos con mutantes reales

| Archivo | Qué protege | Mutante | Resultado |
|---|---|---|---|
| `laboral/reembolso_sin_copias.test.ts` | no pagar 3 veces el mismo ticket | `pagadero.ts` se quita el filtro `idsDuplicados` | muere — 2 failed |
| `cuadre/duplicado_agrupado.test.ts` | una línea por comprobante, no por copia | `engine.ts:477` el monto excluido usa `g.monto` en vez de sumar copias | muere — 1 failed |
| `cuadre/duplicado_agrupado.test.ts` | agrupar sin fundir comprobantes distintos | `engine.ts:146` la llave de folio incluye `g.id` (nunca empareja) | muere — 2 archivos, 9 failed |
| `intake/voucher.test.ts` | el voucher de la terminal no se da de alta dos veces | `decidir.ts` siempre devuelve `{accion:'alta'}`, ignora el emparejamiento | muere — 3 failed |
| `cuadre/copias_un_origen.test.ts` | los 3 consumidores de "qué es copia" cuentan lo mismo | `omitidos.ts` `filasImprimibles` deja de excluir copias | muere — 4 failed |
| `migraciones_verificadas.test.ts` | toda migración tiene bloque o exención | se borra "0030" del título del bloque 13 | muere — 1 failed |
| `pruebas_en_ci.test.ts` | lo que se salta bajo `--coverage` corre en CI por otro lado | se borra el paso de `ci.yml` | muere — 1 failed |
| `repo_aviso.test.ts` | `liberarEnvioAviso` corre de verdad y respeta el tenant | `p_tenant` hardcodeado | muere — 2 failed |
| `cuadre/guardia.test.ts` (AG-3) | el cierre usa el snapshot, no recalcula | `guardia.ts` `snapshotCierre` siempre `undefined` | muere — 1 failed |
| `processor_lock.test.ts` | con el lock perdido se avisa y se libera el claim | `processor.ts:683` se comenta `releaseMessageClaim` | muere — 1 failed |

**10 de 10 matan al mutante.** Contra el 22% de la ronda 6 (10 de 12
sobrevivían) y el 4 de 18 de la ronda 7. La calidad de las pruebas *nuevas* de
esta ronda es la mejor medida hasta ahora — y tiene un patrón claro: casi todas
nacieron de leer un PDF real o correr fotos reales por el pipeline (`git log`:
"MEDIDO, NO SUPUESTO... se pasaron 14 fotos reales"; "LO ENCONTRÓ JAVIER
leyendo el primer PDF real"), no de imaginar un caso de borde. Eso se nota en
que cada prueba trae un caso de control explícito ("sin marcarlas lo paga TRES
veces — el bug que se vio en el PDF") que fija el ANTES, no solo el después.

---

## Hallazgos

### [CRÍTICO] Los mismos cinco supervivientes de la ronda 6 siguen exactamente iguales — tercera ronda sin que nadie los toque, y uno apaga el bloqueo de datos personales sin aviso

`processor.ts:314` · `repo.ts:451` · `processor.ts:742` · `src/lib/auth/passcode.ts:115` · `src/lib/cuadra/liquidacion/acreditable.ts:94`

**Escenario.** Repetí las cinco mutaciones que la ronda 6 encontró, que la
ronda 7 reconfirmó, y que hoy — con la suite crecida a 1300 pruebas y 20
archivos de prueba nuevos — siguen sin que ninguna las toque:

```
processor.ts:314    if (!avisoPuesto) { ... return; }
                     → if (false && !avisoPuesto) { ... }        → 1299/1300 pasan
repo.ts:451          return r.razonSocial && r.domicilio ? r : null;
                     → return r;                                  → 1299/1300 pasan
processor.ts:742     ctxCerro = closed;
                     → (comentada)                                → 1299/1300 pasan
passcode.ts:115      const LARGO_MINIMO = 24;
                     → const LARGO_MINIMO = 1;                    → 1299/1300 pasan
acreditable.ts:94    if (litros > 0) {
                     → if (litros !== 0) {                        → 1299/1300 pasan
```

El más grave: `processor.ts:314` es el bloqueo "SIN AVISO NO HAY TRATAMIENTO"
que la ronda 6 introdujo para el CRÍTICO de la constancia falsa — antes de
esta línea, una foto de comprobante (datos personales del operador: montos,
fechas, en algunos casos su nombre y RFC) se mandaba a un modelo externo sin
que el aviso de privacidad (LFPDPPP art. 16 fr. II) estuviera puesto. Se puede
desactivar la línea completa —el `if` entero— y ninguna de las 1300 pruebas
del repo lo nota. Busqué en todo `src/lib/cuadra/*.test.ts` quién referencia
`ponerAvisoADisposicion` o `avisoPuesto`: solo `aviso_constancia.test.ts` y
`repo_aviso.test.ts`, y ninguno de los dos pasa por `processInbound` — prueban
`ponerAvisoADisposicion` aislada, nunca lo que el processor hace con su
resultado. `repo.ts:451` es la mitad que lo alimenta: sin el guard
`razonSocial && domicilio`, `getDatosResponsable` puede devolver un objeto con
campos vacíos como si la flota sí hubiera terminado su alta, lo que hace que
`avisoPuesto` se calcule mal desde la raíz.

**Consecuencia.** Para el equipo que mantenga esto: cinco defectos con reporte
escrito, severidad asignada y ubicación exacta, sin tocar en tres auditorías
seguidas — no por ser difíciles, sino porque cada ronda atacó lo que llegó
recién reportado y nunca bajó a limpiar el backlog. El de `processor.ts:314`
es el que más pesa porque toca la obligación legal directa (art. 16), no un
número en pantalla: si algún refactor futuro toca esa rama —y `processor.ts`
se editó fuertemente esta ronda, en líneas vecinas (742 y 789)— nada en la
suite lo detendría antes de producción.

**Causa raíz probable.** Ninguna ronda desde la 6 ha tratado el backlog de
hallazgos ABIERTOS como una lista a cerrar; cada una ataca lo nuevo de la
propia ronda y dos MEDIO/ALTO que sí quedaron cerrados esta vez (ver arriba)
eran justamente los recién reportados por la ronda 7, no los más viejos.

**REINCIDENTE** — mutaciones M6, M7, M9, M10 y M12 de la ronda 6, R6/R7/R9/
R10/R12 de la ronda 7, sin cambio.

---

### [ALTO] `gasto_tarde.test.ts` prueba las funciones puras y el TEXTO del cableado, no el cableado — el branch entero se puede apagar y las 1300 pruebas del repo siguen verdes

`src/lib/cuadra/gasto_tarde.test.ts:47-69` · `src/lib/cuadra/processor.ts:524-528`

**Escenario.** Este archivo cierra "el último CRÍTICO de código de las siete
rondas" (según su propio encabezado): distinguir un gasto que llegó después de
emitida la liquidación (mig. 0036) de un duplicado benigno, y avisarle al
operador en vez de tragárselo en silencio. El primer `describe` (líneas 23-45)
prueba bien las funciones puras `llegoTarde`/`violaIndice` — confirmé que
rompen: cambiar el código de error las hace fallar.

El segundo `describe`, "el processor se lo dice al operador" (líneas 47-69),
es el que verifica que `processor.ts` de verdad ejecuta esa rama. Lo hace así:

```ts
const i = P.indexOf('llegoTarde(e)');
const rama = P.slice(i, i + 700);
expect(rama).toContain('sendText');
expect(rama).toMatch(/llegó después|llegó tarde|NO entró/i);
```

Es una búsqueda de texto sobre el archivo fuente, no una ejecución. Verifiqué
que un `if (llegoTarde(e))` cambiado a `if (false && llegoTarde(e))` en
`processor.ts:524` —que hace la rama COMPLETAMENTE inalcanzable, y con ella el
aviso al operador sobre el gasto perdido— deja el texto vecino intacto (los
700 caracteres siguientes no cambian) y por lo tanto la prueba de texto sigue
en verde. Corrí la suite entera con ese mutante puesto: **1299/1300 pasan.**
Ningún otro archivo del repo hace un test de comportamiento de este camino —
grep de `GASTO_TARDE`/`llegoTarde` en `*.test.ts` solo devuelve este archivo.

**Consecuencia.** Es la sexta aparición del patrón "función pura probada,
cableado no" en este repo (la ronda 6 ya lo nombró cinco veces), y la primera
vez que aparece en código escrito ESTA MISMA ronda — quien escribió el fix
sabe describir el patrón en el comentario del propio archivo pero lo repitió
al construir su arnés. Si el `if` se rompe en un refactor futuro de
`processor.ts` (que ya se tocó dos veces esta ronda en líneas cercanas: 676 y
742), el operador vuelve a recibir el bug original —el chat y el PDF narrando
cifras distintas y de signo contrario, con $800 de diferencia en el caso real
que lo originó— y la suite no dirá nada.

**Causa raíz probable.** `processInbound` no tiene, en este archivo, un arnés
que dispare `addGasto` con el código `GASTO_TARDE` de verdad (como sí hace
`processor_lock.test.ts` para el mutex o `repo_aviso.test.ts` para el aviso);
se sustituyó por una búsqueda de texto porque es más rápida de escribir.

---

## Lo que revisé y está bien

- **La escritura del dinero, ahora con arnés completo.** `repo_escritura.test.ts`
  cubre los 12 parámetros de `saveLiquidacion` (verifiqué las 4 mutaciones que
  la ronda 7 encontró huecas: todas mueren). Es el hallazgo central de las dos
  rondas anteriores, cerrado de verdad.
- **El mecanismo de "una sola verdad" se institucionalizó, no solo se parchó.**
  Tres archivos nuevos convierten un hallazgo puntual en un candado estructural
  para SIEMPRE: `migraciones_verificadas.test.ts` obliga a que toda migración
  nueva tenga bloque en `verificaciones.sql` o una exención con razón escrita
  (verifiqué que atrapa una migración sin decisión); `formato.test.ts` prohíbe
  cualquier copia nueva de `toLocaleString('es-MX')` fuera de `formato.ts`
  (grep sobre código sin comentarios, no una lista a mano); `pruebas_en_ci.test.ts`
  obliga a que toda prueba con `skipIf(CUADRA_COBERTURA)` esté cubierta por el
  paso sin instrumentar de CI. Los tres se rompen si alguien intenta reabrir la
  clase de bug que cierran, no solo la instancia puntual.
- **`copiasDeComprobante` (engine.ts:132) tiene sus tres consumidores
  cruzados en una sola prueba.** `copias_un_origen.test.ts` verifica que el
  cuadre, el reembolso laboral y la tabla del PDF cuentan la misma copia con el
  mismo criterio — until ahora cada uno se probaba aislado y se habían
  separado dos veces en el mismo día real (1-ago).
- **`processor_lock.test.ts` es integración de verdad, no aislada.** Importa
  `processInbound` real y solo mockea el borde de red (`fetch` hacia la Graph
  API) y el acceso a datos — confirmé con mutación que atrapa que se pierda
  `releaseMessageClaim` en el camino de "lock ocupado".
- **`guardia.test.ts` (AG-3) inyecta un valor deliberadamente falso** en vez de
  solo verificar una llamada: `cuadrarDesdeDB` mockeado a devolver $500,000
  cuando el snapshot real dice $8,000, y la prueba exige que el número falso
  NUNCA aparezca en el texto. Es el patrón correcto para esta clase de bug, y
  lo verifiqué rompiendo el snapshot real: muere.
- **`repo_aviso.test.ts` corre `liberarEnvioAviso`, `confirmarEnvioAviso` y
  `reclamarEnvioAviso` de verdad**, contra un PostgREST de mentira que solo
  hace de cable — no mockea las tres funciones que se supone que prueba, que
  era exactamente el hallazgo de la ronda 7.
- **CI sigue corriendo en cada push sin secretos**, y ahora con un paso extra
  (`Pruebas de tiempo (sin cobertura)`) que corre `fundamento` y `duplicados`
  sin instrumentación — cerrando el hueco donde vivían invisibles.
- **`pruebas-manuales/` sigue aislado.** Confirmé que su propio
  `vitest.config.ts` sigue fuera del `include` de la suite principal; no corrí
  ninguno de sus `*.prueba.ts` (hacen llamadas reales de pago), como piden las
  restricciones.
- **`intake/concepto.test.ts` cierra el hallazgo de "las claves del SAT en dos
  archivos"** con una prueba estructural (`config.ts` no puede reescribir la
  clave, tiene que importarla) más las de comportamiento de
  `conceptoDesdeClave`.
- **`npx tsc --noEmit` y `npm run lint`** corren limpios sobre el árbol real,
  exit 0 los dos, igual que reporta `MAPA.md`.

---

## Lo que NO alcancé a revisar

- **~10 de los ~20 archivos de prueba nuevos.** Medí con mutantes reales
  `reembolso_sin_copias`, `duplicado_agrupado`, `voucher`/`decidir`,
  `copias_un_origen`, `migraciones_verificadas`, `pruebas_en_ci`, `repo_aviso`,
  `guardia` (AG-3), `processor_lock` y `gasto_tarde` (donde encontré el hueco).
  No medí por mutación: `conversacion_entregada.test.ts`,
  `decidir_empareja.test.ts`, `facturacion/identificar.test.ts` (+114),
  `facturacion/permiso_cre.test.ts` (nuevo, 165 líneas — el catálogo CRE),
  `guion_demo.test.ts`, `marca.test.ts`, `normas/permiso_politica.test.ts`,
  `politica_un_origen.test.ts`, `processor_intake_delta_falla.test.ts`,
  `startup_diagnostico.test.ts`, `dominio_propio.test.ts`. Los leí (están en
  el diff) y su narrativa es consistente con el resto —bugs reales
  encontrados por uso, no de laboratorio— pero no rompí su función a propósito.
- **El resto del árbol que ninguna ronda ha mutado todavía**: `ocr.ts`,
  `sat.ts`, `caducidad.ts`, `tools.ts`, `barrera.ts`, `permiso_cre.ts`, todo
  `src/lib/llm/`, `src/lib/agents/` y `src/lib/meta/client.ts`. La tasa de
  mutación real del repo entero sigue sin medirse completa.
- **El reporte de cobertura línea por línea.** No corrí `npm run
  test:coverage`: habría saltado las dos pruebas de tiempo (por diseño) y mi
  señal viene de mutación dirigida, que dice más por línea que cobertura.
- **`supabase/verificaciones.sql` como SQL contra una base real.** Confirmé
  que el bloque 13 (0030) existe y que `migraciones_verificadas.test.ts` lo
  vigila estructuralmente, pero no hay Supabase en este entorno para correr
  los bloques. Que hagan lo que dicen es lectura, no medición.
- **Si alguna otra rama de `processor.ts` esconde el mismo patrón que
  `gasto_tarde`** (texto en vez de comportamiento). Encontré una por buscar
  específicamente en los archivos de dinero/fiscal nuevos; no recorrí las
  ~2600 líneas nuevas de prueba completas buscando el patrón en general.
- **`facturacion/permiso_cre.test.ts` y el catálogo CRE (12,625 permisos)**,
  que MAPA marca como cambio grande de esta ronda — es fiscal más que
  pruebas puras, y otro rubro lo cubre mejor con las fichas de `normas/`.

---

## Confirmación de árbol limpio

Toda la mutación ocurrió en una copia del árbol en el scratchpad de la sesión
(`/private/tmp/.../scratchpad/cuadra-mut`), restaurada archivo por archivo
después de cada medición. El repo real nunca se editó:

```
$ git status --short docs/ src/ supabase/ .github/
?? docs/auditoria-8/arquitectura.md      (de otro auditor en paralelo)
?? docs/auditoria-8/backend.md           (de otro auditor en paralelo)
?? docs/auditoria-8/datos.md             (de otro auditor en paralelo)
?? docs/auditoria-8/frontend.md          (de otro auditor en paralelo)
?? docs/auditoria-8/operabilidad.md      (de otro auditor en paralelo)
?? docs/auditoria-8/tool-calling.md      (de otro auditor en paralelo)

$ git diff --stat
(vacío)

$ git stash list
(vacío)
```
