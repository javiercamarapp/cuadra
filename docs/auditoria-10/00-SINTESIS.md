# Auditoría 10 — síntesis

**Fecha:** 4/5-ago-2026 (demo: 6-ago-2026). **Anterior:** `docs/auditoria-9/00-SINTESIS.md` (7.7).
**Sha base:** ~12 agentes construyendo en paralelo durante todo el 4-ago dejaron
40 commits en producción y trabajo sin commitear de 7 features distintas
cuando la sesión que orquestaba se quedó sin contexto. Esta ronda arrancó
reconciliando ese árbol (tres agentes: `processor`/`conv`, `escalar_viaje`,
`cron facturar`+`capufe`) antes de que los doce auditores de rubro pudieran
correr — no fue un audit-then-fix en orden, fue reconciliación y auditoría al
mismo tiempo, con 2-3 sesiones de Claude Code adicionales trabajando el mismo
repo en vivo durante toda la ronda.

**Tipo:** RONDA COMPLETA, doce auditores con contexto fresco. **Modo:** cloud,
sin el operador presente hasta el reporte final.

---

## Nota global: 6.7 (antes 7.7, ▼1.0)

| Rubro | Aud. 9 (tras arreglos) | Ronda 10 | | Razón del movimiento |
|---|:--:|:--:|---|---|
| Pruebas | 9 | **8** | ▼ | el hallazgo del día (OCR-constante) resultó falso a nivel de datos, pero expuso un hueco de cobertura real — nadie verificaba por mutación que `ocr_confianza` viene del modelo y no de una constante; cerrado |
| Tool calling | 8 | **8** | = | un ALTO real cerrado: el fallback cross-provider no tenía entrada para el modelo de OCR que hoy corre en producción — un Gemini caído se quedaba reintentando contra el mismo proveedor muerto |
| Agéntico | 8 | **7** | ▼ | los 8 hallazgos de la ronda 9 siguen cerrados, más un ALTO reincidente de 3 rondas (`guardiaFundamento`) que existía arreglado en una rama sin mergear y seguía abierto en `master` — lo que Vercel despliega |
| Arquitectura | 7 | **7** | = | el hallazgo de negocio del día (ver abajo) verificado de forma independiente en el código; un mutex ausente en `reabrirViaje` documentado, sin arreglar |
| Datos | 8 | **7** | ▼ | CRÍTICO cerrado: dos migraciones sin commitear compartían el número 0065, desactivando en silencio la cobertura de `migraciones_verificadas.test.ts` — renombrada, aplicada, verificada contra Postgres real |
| Rendimiento | 8 | **7** | ▼ | el ALTO de la ronda 9 (bloqueo de presupuesto) confirmado cerrado de verdad; ALTO nuevo: el cron de portales puede tardar hasta 480s contra un límite de 300s |
| Fiscal | 7 | **6** | ▼ | el hallazgo de negocio se sostiene con fuente independiente (INEGI): el archivo más grande de la semana automatiza la porción MENOR del problema fiscal |
| Frontend | 7 | **6** | ▼ | dos ALTO nuevos que un contralor vería de frente: el estado vacío del panel del dueño es código muerto, y todo `KpiTile` sirve `$0.00` en el HTML inicial |
| Legal | 7 | **6** | ▼ | los 2 hallazgos de ronda 9 siguen cerrados; ALTO nuevo: sin cláusula de mandato para lo que la automatización de portales ya hace — inerte hoy, a una variable de entorno de contradecir `/terminos` |
| Operabilidad | 7 | **6** | ▼ | migración de IVA aplicada a producción; `DEPLOY.md` corregido; un `rm` accidental de un agente reconstruido y marcado para revisión (ver abajo) |
| Backend | 8 | **6** | ▼▼ | dos bugs reales cerrados con prueba: `facturarLoteAlVuelo` (lo que el cron REALMENTE llama) sin cobertura de su propia protección contra doble-CFDI; el catch de `avisar_cierre.ts` quedó muerto cuando `sendDocument` cambió su contrato de error |
| Seguridad | 8 | **6** | ▼▼ | tercer IDOR del mismo patrón del día (`reasignarOperador`/`crearViaje` sin verificar tenant del operador) — cerrado con TDD y verificación por mutación |

**Diez de doce rubros bajaron; dos se sostuvieron; ninguno subió.** Es el
patrón inverso al de la ronda 9. La razón no es que el código haya empeorado
en general — es que el día se gastó mayoritariamente en CONSTRUIR (40+
commits, 4 paneles, el motor de portales con Chromium serverless,
`escalar_viaje`, facturación por lote) con ~12 agentes en paralelo, varios de
los cuales murieron a medio camino. Cada rubro que bajó lo hizo por
hallazgos NUEVOS de código que se escribió HOY, no por regresión de lo que
la ronda 9 ya había cerrado — los 29 hallazgos de esa ronda se verificaron
uno por uno contra el código actual y los 29 siguen cerrados.

---

## El hallazgo del día: el roadmap de facturación apuntaba al problema equivocado

Verificado de forma independiente por tres rubros distintos (fiscal, con una
fuente externa — INEGI EAT 2024, combustibles+lubricantes 42.6% del gasto de
autotransporte de carga; arquitectura, leyendo el código; agéntico/backend,
de pasada). La tabla de CANACAR que circula en blogs está inventada — el
propio IMT documenta que CANACAR nunca la publicó.

Diésel y casetas (~54% del gasto real) son justo las categorías que MENOS
generan ticket facturable por portal: el diésel se paga con monedero
autorizado (CFDI consolidado del emisor, sin ticket individual) y las
casetas con TAG llegan en factura mensual (en CAPUFE el telepeaje ya es
56.9% del ingreso). El repo ya sabía esto desde el 29-jul
(`docs/investigacion/00-DECISIONES.md:126-128`, "Decisión #2: buzón de
correo", sin implementar). Pese a eso, el archivo más grande escrito esta
semana en `facturacion/` es `adaptadores/capufe.ts` (61 KB), que automatiza
específicamente la ruta SIN cuenta de peaje en efectivo — la porción MENOR
del problema. Cero código para monederos (Edenred/Efectivale/Broxel) y cero
mecanismo de ingesta de CFDI consolidado.

No hay número de adaptadores que cubra el 80% del gasto por esta vía. El
cuarto entregable que sí lo mueve no es un adaptador — es ingerir el CFDI
consolidado de los emisores de monedero/TAG y hacer el JOIN contra los
viajes vía Carta Porte, que es exactamente el foso que ya se había
identificado. Evidencia completa (72 archivos de portales reales
investigados) rescatada en `docs/investigacion/portales/`.

---

## Lo que se cerró esta ronda, con commit

| # | Hallazgo | Rubro(s) | Severidad | Commit |
|---|---|---|---|---|
| 1 | `guardiaEstado` solo detectaba mentiras de cierre con la palabra "ya" — "Listo, quedó liquidado tu viaje" se le escapaba | Agéntico | CRÍTICO | `4910afa` |
| 2 | `guardiaFundamento` certificaba una cita fiscal real pegada a un gasto inventado — fix completo existía en una rama sin mergear, nunca llegó a `master` | Agéntico | ALTO REINCIDENTE ×3 rondas | `2d64d8e` |
| 3 | `reasignarOperador`/`crearViaje` escribían `operador_id` sin verificar que fuera del mismo tenant — un `flota_admin` podía asignarle un viaje a un chofer de OTRA flota | Seguridad | ALTO | `9f496d6` |
| 4 | `facturarLoteAlVuelo` (lo que el cron real llama) sin cobertura de la protección contra doble-CFDI que sí tiene `facturarAlVuelo` | Backend | ALTO | `ac28a64` |
| 5 | El catch de `avisar_cierre.ts` quedó muerto cuando `sendDocument` dejó de lanzar y empezó a devolver `{ok:false}` — un PDF rechazado por Meta no dejaba rastro | Backend | ALTO | `ac28a64` |
| 6 | Dos migraciones sin commitear compartían el número 0065 — desactivaba en silencio la cobertura de `migraciones_verificadas.test.ts` | Datos | CRÍTICO | `36a28b4`* |
| 7 | El IVA de la mensualidad no se desglosaba: un plan de $10,000 se timbraba por $11,600 | Fiscal, Datos | CRÍTICO | `bc87500`, `be1d14b` |
| 8 | `escalar_viaje.test.ts`/`al_vuelo.test.ts`/`route.test.ts`/`capufe.test.ts` y 6 archivos más del motor de conversación: mocks desalineados de features nuevas, no bugs reales | Reconciliación | — | `c658f6a`, `da73b32`, `b6e9a0a` |

\* el fix de datos (migración renombrada a 0066) quedó aplicado y verificado; su
commit atómico se perdió en una colisión de índice de git entre agentes
concurrentes — el contenido sobrevivió intacto, solo la atribución del commit
no es la que el agente pretendía.

## Lo que queda documentado, no arreglado (por severidad de negocio, no por descuido)

- **[ALTO] Cron de facturación con presupuesto que no cuadra**: hasta 480s
  (8 tickets × 10-60s) contra un límite de 300s de Vercel. Matado a medio
  camino en modo `emitir`, riesgo de CFDI timbrado sin `cfdi_uuid` guardado
  → doble emisión en el reintento. (Rendimiento)
- **[ALTO] Sin cláusula de mandato** para que el sistema presente el RFC de
  un cliente ante un portal de tercero y apriete "emitir" en su nombre.
  `FACTURACION_MODO` sigue en `ensayo` (default, no seteado en producción),
  así que no hay violación activa hoy — pero activar `emitir` es una
  variable de entorno de distancia de contradecir `/terminos` ("Likida no
  timbra facturas"). (Legal)
- **[ALTO, negocio] El roadmap de adaptadores de portal** — ver arriba.
  (Fiscal, Arquitectura)
- **[ALTO] Dos bugs de corrección visibles para un contralor**: el estado
  vacío de `/dashboard` es inalcanzable (siempre pinta "0% tasa de cuadre"),
  y cada `KpiTile` sirve `$0.00` en el HTML servido sin importar la cifra
  real. (Frontend)
- **[MEDIO] `reabrirViaje` no toma el mismo mutex** que protege el resto del
  ciclo de vida del viaje — riesgo de concurrencia hedgeado, no confirmado
  como explotable. (Arquitectura)
- **[MEDIO] `escalar_viaje.ts` sin protección de claim atómico** contra
  corridas de cron solapadas — gap de diseño, no fiscal-crítico. (Backend)
- Reincidentes sin cambio: CSP ausente (seguridad, desde ronda 8), atribución
  de costo tras fallback mixto y `ToolCallRecord.args` desalineado
  (tool-calling), plazo de facturación con dos vocabularios y hospedaje $1
  sin timbrar (fiscal).

## Un incidente operativo, para que lo veas tú

Mientras investigaba la colisión de migraciones 0065, un agente compuso mal
un comando de shell y borró por accidente `0065_cfdi_de_varias_casetas.sql`
(nunca commiteado). La base de datos real no se tocó — lo reconstruyó desde
el esquema vivo de Supabase (índices, constraints, comentarios de columna) y
lo dejó marcado explícitamente como reconstrucción, no el original byte a
byte. Vale una revisión tuya de `supabase/migrations/0065_cfdi_de_varias_casetas.sql`
sin prisa.

---

## Evidencia

```
$ npx tsc --noEmit -p .
(sin salida — exit 0)

$ npx eslint src/
✖ 6 problems (0 errors, 6 warnings)   — imports sin usar, preexistentes

$ npx vitest run
Test Files  224 passed (224)
     Tests  2957 passed | 1 skipped (2958)

$ git status --short
(vacío)

$ git log --oneline --since="2026-08-04 00:00:00" --until="2026-08-05 00:00:00" | wc -l
59
```

La única prueba saltada es `pruebas-manuales/*.prueba.ts` (llamadas reales de
pago/portales, no se corren por regla del proyecto).

---

## Nota metodológica: doce agentes en paralelo sin worktrees, y lo que costó

A diferencia de la ronda 9 (un orquestador, doce auditores secuenciales en su
turno), esta ronda corrió doce auditores de rubro simultáneos sobre el MISMO
working tree, sin aislamiento de git worktree, mientras 2-3 sesiones humanas
adicionales de Claude Code editaban el mismo repo en vivo. Costó: al menos
tres colisiones de índice de git donde el `git add` de un agente terminó
dentro del commit de otro (contenido siempre íntegro, atribución a veces no),
dos agentes que se cortaron a media respuesta por error de conexión (uno con
el archivo ya completo en disco sin commitear, otro a mitad del reporte —
ambos se recuperaron: el primero commiteado directo, el segundo retomado con
`SendMessage` desde su transcript), y un `rm` accidental de un archivo sin
commitear. La técnica que terminó funcionando —`git commit -m "..." --
<ruta exacta>` en vez de `git add` + `git commit` separados— evita que el
índice sucio de otro proceso se cuele en tu commit, pero solo sirve para
archivos YA conocidos por git; uno nuevo sigue necesitando su propio `git
add` primero, con la ventana de carrera que eso reabre. Vale la pena para la
próxima ronda de este tamaño: aislar cada agente en su propio worktree, o
aceptar que la reconciliación post-ronda es parte del costo.
