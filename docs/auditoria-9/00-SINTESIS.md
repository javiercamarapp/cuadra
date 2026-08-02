# Auditoría 9 — síntesis

**Fecha:** 1-ago-2026 (demo: 6-ago-2026). **Anterior:** `docs/auditoria-8/00-SINTESIS.md` (6.5).
**Sha base:** `cc2a576` (ancla de la mayoría de los auditores) → `93a0c42` (26
commits de código nuevo + arreglo entre el ancla y el cierre de esta ronda).
**Modo:** local, con el operador presente. **Tipo:** RONDA COMPLETA, doce
auditores con contexto fresco, más una sesión concurrente construyendo
feature (comprobante_huerfano, corrección de fecha por segunda foto, guardado
de fotos, `foto_pendiente`) durante la propia auditoría — documentado en
`agentico.md`/`backend.md`/`pruebas.md`, que lo señalan explícitamente.

---

## Nota global: 7.7 (antes 6.5, ▲1.2)

| Rubro | Aud. 8 | Los 12 auditores (pre-arreglo) | Tras los arreglos | | Razón del movimiento final |
|---|:--:|:--:|:--:|---|---|
| Sistema agéntico | 5 | 4 | **8** | ▲▲ | 1 crítico + 3 altos + 4 medios, los 8 cerrados |
| Pruebas | 8 | 8 | **9** | ▲ | el único alto (`comprobante_huerfano` sin arnés real) cerró con el mismo rigor de mutación que el rubro ya exigía |
| Backend y API | 7 | 4 | **8** | ▲ | 1 crítico + 1 alto + 1 alto reincidente + 1 medio reincidente, los 4 cerrados |
| Modelo de datos | 8 | 7 | **8** | ▲ | el único alto (trigger de la 0037 sin `fecha`) cerró — mismo fix que backend/seguridad |
| Rendimiento y costo | 6 | 7 | **8** | ▲ | los 3 hallazgos eran sobre `foto_pendiente`; el mecanismo se revirtió, quedaron sin objeto |
| Seguridad | 8 | 7 | **8** | ▲ | 1 alto + 3 medios cerrados (incluido un reincidente de 4 rondas); 2 bajos quedan propuestos |
| Cumplimiento fiscal | 4 | 5 | **7** | ▲▲ | los 4 altos cerraron; 2 medios + 1 bajo quedan propuestos |
| Legal | 6 | 4 | **7** | ▲ | 1 crítico + 1 alto, los 2 cerraron |
| Operabilidad y DX | 6 | 5 | **7** | ▲ | 2 críticos + 1 alto, los 3 cerraron |
| Frontend | 6 | 5 | **7** | ▲ | el único alto (viaje demo a "Por revisar" en rojo) cerró |
| Arquitectura | 6 | 6 | **7** | ▲ | el único alto (`round2()` en 4 archivos) cerró y quedó con guardarraíl |
| Tool calling | 8 | 8 | **8** | = | no atacado esta ronda — 2 medios + 5 bajos, todos reincidentes ya conocidos, quedan propuestos |

**Once de doce rubros subieron; ninguno bajó.** Cada CRÍTICO y cada ALTO que
los 12 auditores confirmaron esta ronda quedó cerrado con TDD (prueba roja →
arreglo → prueba verde → suite completa → commit atómico citando el hallazgo),
y cada uno se verificó además por MUTACIÓN — reintroducir el bug de vuelta y
confirmar que la prueba nueva lo atrapa — antes de darlo por bueno. Es la
primera ronda desde la 8 en la que el orquestador cierra absolutamente todo lo
crítico y alto encontrado en la misma ronda en que se encontró.

---

## Los hallazgos, verificados uno por uno antes de tocar código

### Cerrados por revertir `foto_pendiente` (una sola causa raíz, seis hallazgos)

El mecanismo nuevo de esta ronda —retener una foto sin código unos segundos
por si llegaba su acercamiento, para pagar una sola visión en vez de dos—
tenía una carrera real: `reclamarFotoPendiente` podía llevarse CUALQUIER foto
pendiente del viaje sin verificar que fuera el par correcto, y un fallo de
descarga tras el reclamo perdía el comprobante sin dejar rastro. Dos
auditores independientes (agéntico, backend) y una tercera mirada
(operabilidad, sobre el log) lo confirmaron por separado, contra el propio
código, con escenarios de carrera distintos. El ahorro (~$0.015/ticket de dos
fotos) no justificaba el riesgo a 5 días del demo — decisión explícita de
Javier, 1-ago-2026. `cc6c30e` revierte el mecanismo: cada foto vuelve a pagar
su propia visión, como antes de la auditoría 8.

| # | Hallazgo | Rubro | Severidad |
|---|---|---|---|
| 1 | La retención fusiona dos comprobantes distintos en uno, y el otro desaparece | Agéntico | CRÍTICO |
| 2 | El reclamo puede fallar DESPUÉS de borrar la fila, y el comprobante ya no existe en ningún lado | Agéntico | ALTO |
| 3 | Un blip en el sondeo procesa el mismo ticket dos veces | Agéntico | ALTO |
| 4 | Si la descarga del ticket reclamado falla, se pierde el comprobante y se le pide al operador la foto que ya mandó | Backend | CRÍTICO |
| 5 | El probe de arranque no cubre las migraciones 0036-0040 | Operabilidad | CRÍTICO — cerrado aparte, `ef10484` (migración 0043) |
| 6 | `foto_pendiente` puede perder un comprobante sin ningún log que lo diga | Operabilidad | CRÍTICO — moot: el camino que lo produce ya no existe |
| 7 | `esperarReclamoDeFoto` se cobra en toda foto sin código, aunque nunca vaya a tener pareja | Rendimiento | ALTO — moot |
| 8 | Una sola consulta lenta puede inflar la espera "de 3 segundos" a ~19s | Rendimiento | MEDIO — moot |
| 9 | `foto_pendiente` no caduca: una fila huérfana empareja horas después | Agéntico | MEDIO — moot |
| 10 | El `img_hash` del par fusionado es el del acercamiento, no el del ticket | Agéntico | MEDIO — moot |
| 11 | `foto_pendiente` nace sin la FK compuesta con `tenant_id` | Seguridad | MEDIO — moot |
| 12 | `decodeCodigosFromImage` corre dos veces sobre la misma foto | Rendimiento | BAJO — moot |

### Cerrados con arreglo dirigido, cada uno con su propio commit

| # | Hallazgo | Rubro(s) | Severidad | Commit |
|---|---|---|---|---|
| 13 | El `when` de la 0037 no cubre `fecha` — `corregirFechaGasto` reescribe un gasto ya liquidado sin que la base lo impida | Backend, Datos, Seguridad (3 auditores) | ALTO ×3 | `da52502` (migración 0042) + `42870dd`/`e4e345f` (pruebas) |
| 14 | El permiso CRE manda el viaje demo a "Por revisar" en rojo por una regla que nadie puede resolver | Fiscal, Frontend (2 auditores) | ALTO ×2 | `f25d44f` |
| 15 | El probe de arranque no cubre 0036-0040 | Operabilidad | CRÍTICO | `ef10484` |
| 16 | `round2()` reimplementado en 4 archivos de dinero, mismo bug de redondeo | Arquitectura | ALTO REINCIDENTE | `818dd6a` |
| 17 | Un EFOS solo PRESUNTO se declara "lista negra" y tira la deducción entera | Fiscal | ALTO | `4d8b4f4` |
| 18 | El tope de $750/día imprime un excedente "no deducible" que el desglose desmiente | Fiscal | ALTO | `72b565b` |
| 19 | Comida amparada SOLO por transporte y sin tarjeta de crédito sale deducible sin observación | Fiscal | ALTO | `c64c74c` |
| 20 | La oposición real al tratamiento automatizado se traga cuando además nombra el objeto que revisa | Legal | ALTO | `2c4c3b8` |
| 21 | La foto del ticket se guarda y se enseña sin filtro de contenido sensible, contradiciendo el aviso de privacidad | Legal | CRÍTICO | `b99b0fe` |
| 22 | `guardiaFundamento` certifica una cita bien nombrada y mal aplicada (memoria por id, no por tema) | Agéntico | ALTO | `522725f` |
| 23 | El aviso de barrera vencida afirma un cuadre que no ocurrió | Agéntico | MEDIO | `fbcd241` |
| 24 | Dos XML del mismo total en el mismo lote se pisan sobre el mismo gasto (carrera sin mutex) | Agéntico | MEDIO | `d493250` |
| 25 | `pdf_generado` solo refleja el ejemplar del operador — el del contralor podía fallar en silencio | Backend | MEDIO REINCIDENTE | `c4781be` |
| 26 | `pedir_ticket`/`enriquecer` sin integración real; `aviso_una_vez.test.ts` leía el texto fuente | Backend | ALTO REINCIDENTE | `5bd08f8` |
| 27 | `comprobante_huerfano` (4 funciones) y `corregirFechaGasto` nunca ejecutan su cuerpo real en ninguna prueba | Pruebas | ALTO | `e4e345f` |
| 28 | `foto.pendiente_error` de `pegarCodigoEnEspera` se registraba sin viaje/tenant/gasto | Operabilidad | ALTO (mitad del hallazgo — la colisión de nombres quedó moot por el revert) | `366acfc` |
| 29 | La liga firmada del PDF del operador vive una hora — reincidente en las rondas 5, 6, 8 y 9 | Seguridad | MEDIO REINCIDENTE ×4 | `93a0c42` |

**Veintinueve hallazgos, veintinueve cerrados.** Doce por una sola decisión
de diseño (revertir `foto_pendiente`), diecisiete por arreglo dirigido — cada
uno con prueba roja antes, verde después, y verificación por mutación.

---

## Lo que queda propuesto (medios y bajos, no atacados esta ronda)

Por el alcance por default de esta skill ("autofix: críticos y altos") y por
el tiempo que queda hasta el demo, estos MEDIOS y BAJOS se quedan en el
tablero como *propuestos*, no como pendientes olvidados:

- **Fiscal, MEDIO:** un hospedaje de $1 sin timbrar apaga la advertencia de
  LISR 28-V del mismo comprobante.
- **Fiscal, MEDIO:** el plazo de facturación cita distinto según si la ficha
  está VERIFICADA o SIN VERIFICAR, y 33 de 37 comercios del censo caen en la
  rama sin verificar.
- **Fiscal, BAJO:** `rmf-2026-2.7.1.21.yaml` declara que no se usa en código,
  y sí se usa (autoinconsistencia de la ficha, no del motor).
- **Seguridad, BAJO REINCIDENTE:** `gasto_no_tras_liquidar` sigue sin
  `search_path` fijo, y la 0037 le colgó un segundo trigger encima.
- **Seguridad, BAJO:** sin tope de tamaño en la descarga de media; el XML
  crudo se guarda entero en la base.
- **Tool calling** (2 MEDIO + 5 BAJO, todos REINCIDENTE "sin cambio"):
  atribución de costo tras fallback, `ToolCallRecord.args` sin describir qué
  produjo el `result`, `cuadrar_viaje`/`consultar_politica` sin prueba de
  handler real, `ctx.signal` sin consumirse, falso positivo de
  `isTransientError`, error crudo de Postgres sin filtrar al modelo,
  loop-guard que ejecuta la ronda completa antes de tirar el resultado. Ni la
  sesión concurrente ni esta ronda los tocaron — deuda conocida, no nueva.

Ninguno de estos MEDIOS/BAJOS bloquea el demo del 6-ago: todos son de calidad
de señal, higiene de esquema o deuda de pruebas de baja severidad, no rutas
que muevan dinero incorrectamente ni expongan datos sensibles.

---

## Evidencia

```
$ npx tsc --noEmit
(sin salida — exit 0)

$ npm run lint
> cuadra@0.1.0 lint
> eslint .
(sin salida — exit 0)

$ npx vitest run
Test Files  163 passed (163)
     Tests  1570 passed | 1 skipped (1571)
```

La única prueba saltada es la misma que ya se saltaba en rondas previas, sin
relación con esta ronda (`pruebas-manuales/*.prueba.ts`, llamadas reales de
pago, no se corren por regla del proyecto).

`git status --short` limpio al cierre de cada commit de esta síntesis.

---

## Nota metodológica: por qué "tras los arreglos" es una estimación del orquestador, no un re-audit

Igual que en la síntesis de la ronda 8, la columna "tras los arreglos" es mi
lectura de qué tan sostenido queda cada rubro una vez cerrado lo que sus
auditores encontraron — no una re-corrida de los 12 auditores con contexto
fresco. Esa re-corrida es, por diseño, el Paso 1 de la ronda 10: solo un
auditor nuevo, sin el contexto de haber escrito el arreglo, puede confirmar
de forma independiente que estos 29 cierres sostienen bajo una mirada que no
sabe dónde se acaba de tocar código.
