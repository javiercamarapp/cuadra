# Pruebas — auditoría 9

Ancla: commit `f34066f6714a142fa22075cd09e5430314341354` (HEAD al empezar esta auditoría).

**Nota: 8/10** (antes 8). Razón del movimiento: sin cambio neto — el trabajo
nuevo de la ronda se sometió a mutación real (no solo lectura) sobre una
muestra de las zonas de mayor riesgo (dos-fotos, folioNorm, sala de espera de
huérfanos, re-fecha, fundamento con historial, PDF sin truncar, y los cinco
supervivientes de rondas 6-7) y las doce mutaciones aplicadas murieron todas —
ninguna es decoración. Pero la tabla `comprobante_huerfano`, nueva esta
ronda y con dinero real detrás (comprobantes de gasto en espera de viaje), se
escribió con el mismo patrón que esta base de código ya pagó dos veces y ya
tiene el mecanismo para evitar (`repo_aviso.test.ts`, `repo_datos_responsable.test.ts`):
sus cuatro funciones de acceso a datos nunca corren su cuerpo real en ninguna
prueba. Eso compensa la mejora y deja la nota plana.

**Riesgo mayor del rubro, hoy:** `guardarHuerfano`/`getHuerfanos`/`resolverHuerfanos`/`marcarHuerfanosOfrecidos`
(`repo.ts`, nuevas esta ronda) están detrás de un mock de módulo completo en
las 16 pruebas que las tocan — ninguna ejercita la cadena real de Supabase. Es
la reaparición, en código nuevo, del defecto que ya costó dos rondas de
auditoría en `resolveOperador`/`liberarEnvioAviso`.

---

## Método

Copié el repo (sin `.git`, con `node_modules` symlinkeado) al scratchpad de la
sesión y ahí apliqué mutaciones reales, restaurando el archivo original después
de cada una — el árbol real nunca se tocó (confirmado al cierre: `git status
--short` y `git diff --stat` vacíos). Elegí las mutaciones por dónde pesa el
dinero y dónde MAPA.md pedía mirar con cuidado, no al azar.

## Los doce mutantes aplicados, todos muertos

| # | Archivo mutado | Mutación | Prueba que lo mató |
|---|---|---|---|
| 1 | `processor.ts` — `esperarReclamoDeFoto` | `if (laTomoOtro) return;` → `if (false) return;` | `processor_foto_pendiente.test.ts` (1 failed) |
| 2 | `processor.ts` — batching CON código | `[dataUrlPendiente, dataUrl]` → orden invertido | `processor_foto_pendiente.test.ts` (1 failed) |
| 3 | `cuadre/engine.ts:161` — `copiasDeComprobante` | llave vuelve a `g.folio` crudo, sin `folioNorm` | `cuadre/duplicados.test.ts` (1 failed) |
| 4 | `processor.ts` — adjuntar huérfanos | `puestos.push(h.id)` movido ANTES del `addGasto` (marca como resuelto aunque falle) | `huerfanos_flujo.test.ts` (1 failed) |
| 5 | `processor.ts:1263` — permitidas de fundamento | filtro `role === 'assistant'` → `role === 'user'` | `processor_fundamento_historial.test.ts` (1 failed) |
| 6 | `intake/emparejar.ts:73` — `emparejarCorreccionDeFecha` | guardia de folio distinto quitada (`true` fijo) | `intake/correccion_fecha.test.ts` (1 failed) |
| 7 | `liquidacion/pdf.ts:413-423` | `envolverMedido` revertido a `cortar` (una línea) | `liquidacion/pdf.test.ts` (2 failed) |
| 8 | `processor.ts:401` — bloqueo de aviso | `if (!avisoPuesto)` → `if (false && !avisoPuesto)` | `aviso_bloqueo.test.ts` (1 failed) |
| 9 | `repo.ts:605` — `getDatosResponsable` | `return r.razonSocial && r.domicilio ? r : null` → `return r` | `repo_datos_responsable.test.ts` (2 failed) |
| 10 | `passcode.ts:115` | `LARGO_MINIMO = 24` → `= 1` | `passcode.test.ts` (1 failed) |
| 11 | `liquidacion/acreditable.ts:94` | `litros > 0` → `litros !== 0` | `liquidacion/acreditable.test.ts` (1 failed) |
| 12 | `processor.ts:1194` — `ctxCerro` en recuperación de cierre parcial | asignación comentada | `processor_cierre.test.ts` (1 failed) |

Los mutantes 8-12 son los "cinco supervivientes" que la ronda 6 encontró, la
7 reconfirmó, y que la propia ronda 8 (antes de que empezara ésta, commit
`9bbfa35`, ancestro de `43ebf41`) cerró con arnés real. Los verifiqué de
nuevo porque son el ejemplo textual de "REINCIDENTE" que este rubro debe
vigilar — y los cinco siguen muriendo. **Cerrados de verdad, sostenidos.**

Los mutantes 1-7 son sobre código escrito ESTA ronda. Los elegí por ser los
puntos donde un bug movería dinero o rompería el demo en vivo: qué imagen se
manda a visión y en qué orden, qué folio se considera "el mismo ticket", qué
pasa si un `addGasto` falla a medias dentro de un lote, si una cita legal
persiste entre turnos, si el emparejamiento de re-fecha puede pegarle la
fecha a un ticket equivocado, si el PDF sigue truncando la única cita que el
contralor archiva. Los siete mueren. Es la evidencia más fuerte que puedo dar
de que el trabajo nuevo de la ronda no es decoración.

## El caso específico que pedía MAPA.md: `foto_pendiente` y la concurrencia real

`processor_foto_pendiente.test.ts` mockea `guardarFotoPendiente`/`existeFotoPendiente`/`reclamarFotoPendiente`
directamente (confirmado leyendo el archivo completo, líneas 49-66). Esto
prueba el ENRUTAMIENTO en `processor.ts` — qué hace cada invocación según lo
que esas funciones devuelvan — y lo prueba bien: los mutantes 1 y 2 de arriba
lo confirman. Lo que **no puede** demostrar, porque un mock no compite con
nada, es que dos invocaciones reales de Postgres no se lleven la misma fila.

Esa garantía sí está, y está donde tiene que estar: `supabase/verificaciones.sql:851-898`
(bloque 21), contra Postgres real, con el mismo shape de llamada que usa
`repo.ts::reclamarFotoPendiente` (`delete().eq(...).select('id, media_id')`,
verificado línea por línea contra `repo.ts:490-500`). El bloque demuestra dos
cosas que solo la base puede demostrar: (a) el `unique(viaje_id)` rechaza la
segunda foto sin código del mismo viaje con `23505`, y (b) un `DELETE ...
RETURNING` sobre la misma fila solo entrega el registro una vez — la segunda
llamada no encuentra nada que reclamar. Es un único bloque `DO` serializado,
no dos conexiones concurrentes de verdad, pero es la forma correcta y ya
establecida en este repo (mismo patrón que el bloque 17 para la reserva de
aviso) de probar una garantía de atomicidad: la unicidad del índice y la
semántica de `RETURNING` son justo los primitivos que Postgres serializa, así
que probarlos una vez basta para la garantía — no hace falta reproducir la
carrera con dos transacciones abiertas a la vez.

**Conclusión sobre este punto:** la combinación es sana. `processor_foto_pendiente.test.ts`
cubre el enrutamiento (con mutantes verificados), el bloque 21 cubre la
atomicidad (con Postgres real). Ninguno de los dos sustituye al otro, y no
hace falta que lo hagan.

---

## Hallazgos

### [ALTO] `comprobante_huerfano` (mig. 0040) — cuatro funciones de `repo.ts` nunca ejecutan su cuerpo real en ninguna prueba, y guardan dinero de por medio

`src/lib/cuadra/repo.ts:194` (`guardarHuerfano`) · `:212` (`getHuerfanos`) · `:235` (`marcarHuerfanosOfrecidos`) · `:250` (`resolverHuerfanos`) · también `:273` (`corregirFechaGasto`, misma familia)

**Escenario, con valores.** Un operador manda 11 fotos de comprobantes sin
viaje abierto (el caso que motivó esta migración). Cada una entra a
`comprobante_huerfano` vía `guardarHuerfano`. Al abrir su siguiente viaje y
escribir "hola", `processor.ts:991` llama `getHuerfanos(tenantId,
operadorId)`, que filtra con `.is('resuelto_en', null)` (`repo.ts:217`).
Supón que alguien, en un refactor futuro, cambia ese filtro por
`.eq('resuelto_en', null)` — un error fácil de cometer porque el resto del
archivo usa `.eq()` para casi todo, y `.eq(col, null)` no es semánticamente
lo mismo que `.is(col, null)` en PostgREST. La consulta deja de encontrar
filas. `getHuerfanos` no lanza: el propio diseño (comentario en
`repo.ts:206-210`) dice que ante CUALQUIER fallo de lectura devuelve `[]`,
"a propósito", para no bloquear el cierre del viaje que sí tiene. El
operador nunca vuelve a ver la oferta de sus $3,870 en comprobantes. No hay
mensaje de error, no hay log distinguible de "no había nada" — el camino
feliz vacío y el camino roto se ven idénticos desde afuera.

Ninguna de las 16 pruebas que mencionan estas cuatro funciones lo detectaría:
todas reemplazan el módulo `@/lib/cuadra/repo` entero con `vi.fn()` a mano
(`huerfanos_flujo.test.ts:47-68`, `foto_refoto_fecha.test.ts:51-76`,
`processor_cadena.test.ts`, `xml_llego_tarde.test.ts`, etc. — confirmado por
grep: las 16 tienen `vi.mock('@/lib/cuadra/repo', ...)` con estas cuatro
sustituidas por espías). `getHuerfanos` en esas pruebas siempre devuelve
exactamente lo que el test le ordena (`getHuerfanos.mockResolvedValue([...])`)
— nunca pasa por el `.select().eq().eq().is().order().limit()` real.

**Consecuencia.** Para el contralor esto no se ve como un bug: se ve como
"los comprobantes nunca llegaron", que es peor que el defecto original que
esta migración arregló (antes se le decía explícitamente "no tienes un viaje
abierto" y perdía sus fotos con aviso; con este defecto silencioso las
perdería sin aviso, mientras el producto promete justo lo contrario). Y
`resolverHuerfanos`/`marcarHuerfanosOfrecidos` comparten el riesgo simétrico:
un `.in('id', ids)` roto dejaría comprobantes marcados como resueltos sin
estarlo, o re-ofreciéndose para siempre.

**Causa raíz probable.** Esta base de código ya encontró y cerró exactamente
esta clase de hueco dos veces — `resolveOperador`'s `.limit()` ciego (ronda
7, PR-1) y `liberarEnvioAviso` mockeada por completo (ronda 7, cerrado en
ronda 8 con `repo_aviso.test.ts` contra un PostgREST de mentira que sí
ejecuta el cuerpo real) — y dejó el mecanismo correcto instalado y
documentado en el propio repo (`repo_aviso.test.ts`, `repo_datos_responsable.test.ts`,
`repo_escritura.test.ts`, `repo_tope.test.ts`, `repo_enriquecer.test.ts`,
`repo_acumulado.test.ts`). Las ocho funciones nuevas de `repo.ts` esta ronda
(las cuatro de huérfanos, `corregirFechaGasto`, y las tres de
`foto_pendiente`) no recibieron ese mismo tratamiento — para `foto_pendiente`
la garantía que más importa (atomicidad del reclamo) sí quedó cubierta por
otra vía (ver arriba), pero para las de huérfanos y `corregirFechaGasto` no
hay ninguna red de este tipo.

No es un hallazgo teórico: verifiqué que los nombres de columna en `repo.ts`
sí coinciden con la migración `0040_comprobante_huerfano.sql` — hoy no hay
bug. Es una superficie sin arnés, no un defecto activo, y por eso ALTO y no
CRÍTICO.

---

## Lo que revisé y está bien

- **CI.** `.github/workflows/ci.yml` corre en `branches: ['**']` (no solo
  main), con `npm ci` (falla si el lockfile se desincroniza), `test:coverage`
  con el paso separado `npx vitest run fundamento duplicados` sin
  instrumentar (lo que el propio `pruebas_en_ci.test.ts` exige), y build al
  final con env de relleno. Consistente con lo que la ronda 8 cerró.
- **`gasto_tarde.test.ts` — el hallazgo abierto que me tocaba verificar.**
  Confirmado que ya NO prueba el texto fuente del cableado: el segundo
  `describe` que hacía `P.slice(...).toContain('sendText')` fue reemplazado.
  Hoy el archivo solo prueba las funciones puras (`llegoTarde`, `violaIndice`)
  y el comportamiento vive en `foto_llego_tarde.test.ts` y
  `xml_llego_tarde.test.ts`, que corren `processInbound` real con errores
  `CU001`/`23505` de verdad (`err.code = 'CU001'; addGasto.mockRejectedValue(err)`)
  y verifican el texto de salida, el `guardarHuerfano` con `motivo:
  'tras_liquidar'`, y el silencio ante duplicados benignos. Cerrado de
  verdad, no reincidente.
- **Los cinco supervivientes de la ronda 6/7** (aviso de privacidad,
  `getDatosResponsable`, `ctxCerro` en dos caminos, `LARGO_MINIMO`, `litros
  > 0`) siguen cerrados — los cinco mutantes originales mueren hoy (tabla de
  arriba, filas 8-12).
- **`migraciones_verificadas.test.ts`** sigue obligando a que toda migración
  nueva tenga bloque o exención con razón. Corrí la prueba sobre el árbol
  real: pasa, y confirmé a mano que las migraciones `0037`-`0040` de esta
  ronda tienen sus cuatro bloques (20-23) en `supabase/verificaciones.sql`
  con el número exacto en el título.
- **`supabase/verificaciones.sql` bloque 21 (`foto_pendiente`)**: demuestra
  contra Postgres real —no mockeado— que el `unique(viaje_id)` de la 0038
  rechaza una segunda foto sin código del mismo viaje (`23505`) y que el
  reclamo (`DELETE ... RETURNING`) es atómico: la segunda llamada sobre la
  misma fila no encuentra nada. Verifiqué que el shape de la llamada en el
  bloque coincide exactamente con `repo.ts::reclamarFotoPendiente`.
- **`cuadre/duplicados.test.ts` (folioNorm)**: mutación confirma que el
  dedup por `folioNorm` en vez de folio crudo (`05461` vs `5461`) está
  realmente enganchado en `copiasDeComprobante`, no solo declarado.
- **`liquidacion/pdf.test.ts` (truncamiento)**: renderiza el PDF real y
  extrae el texto del stream (no un mock del generador); la mutación que
  revierte a `cortar` hace que dos pruebas fallen, incluida la que busca
  puntos suspensivos de recorte.
- **`intake/correccion_fecha.test.ts`**: cubre los bordes que mueven dinero
  —dos candidatos (no se adivina), folios distintos (no son el mismo
  ticket), monto distinto, comprobante sin fecha dudosa previa (no se
  re-fecha)— y la mutación sobre la guardia de folio muere.
- **`rfc_receptor_faltante.test.ts`** (CRÍTICO fiscal cerrado en ronda 8):
  asserts numéricos exactos ($11,600 / $1,600 / $0), no genéricos, con un
  caso de control que confirma que el candado no apaga el camino bueno.
- **`npx tsc --noEmit`**: limpio, exit 0, sobre el árbol completo.
- **`npx vitest run`** (suite completa, no dirigida): **157 archivos, 1483
  pasan, 1 saltada** (la misma que ya se saltaba en rondas previas, sin
  relación con esta ronda) — igual a lo que reportan los mensajes de commit
  de esta ronda.
- **`pruebas-manuales/*.prueba.ts`** no se corrieron, como piden las
  restricciones.

---

## Lo que NO alcancé a revisar

- **No corrí mutación sobre `xml_barrera.test.ts` (8433db4), `permiso_cre_no_verificable.test.ts`,
  `plazo_fecha_dudosa.test.ts`, `config_tope.test.ts`/`tope_consulta.test.ts`
  (d7dbe51/54e0ce9), `analytics_paginacion.test.ts` (ebd2062),
  `conv_error_disfrazado.test.ts` (01afba0), ni `intake/ocr_varias_fotos.test.ts`.**
  Los leí por encima y su narrativa es consistente con el resto (casos con
  valores concretos, no genéricos), pero no rompí su función a propósito.
- **No verifiqué con mutación el resto de `xml_llego_tarde.test.ts` /
  `xml_sin_foto_llego_tarde.test.ts`** más allá de confirmar por lectura que
  corren `processInbound` real — el patrón es el mismo que `foto_llego_tarde.test.ts`,
  que sí mediÍ, pero no repetí la medición en el gemelo de XML.
  (nota: el guion, `f61e8f3`, solo tocó `GUION_DEMO.md`, sin código ni prueba —
  fuera del alcance de este rubro.)
- **No tengo acceso a un Postgres real** para correr `supabase/verificaciones.sql`
  yo mismo; lo que reporto sobre los bloques 20-23 es lectura del SQL y
  cruce contra `repo.ts`, no una corrida.
- **`round2()` reimplementado en 4 archivos** (arquitectura lo trae esta
  ronda como REINCIDENTE) tiene una arista de pruebas — no hay guardarraíl
  cruzado tipo `etiquetas_sincronizadas.test.ts` que compare las cuatro
  copias entre sí — pero es hallazgo de arquitectura, no lo repito aquí.
- **No corrí `npm run lint`** en esta pasada (sí `tsc --noEmit` y la suite
  completa de `vitest`).
- **`corregirFechaGasto`** comparte el hueco del hallazgo ALTO (nunca
  ejecuta su cuerpo real) pero no profundicé en un escenario de falla
  específico para ella con la misma extensión que para las de huérfanos —
  el riesgo es más acotado (toca una sola columna, `fecha`, con guardia de
  emparejamiento ya probada por mutación aparte).
