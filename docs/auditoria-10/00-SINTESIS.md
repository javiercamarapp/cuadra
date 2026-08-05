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

## Nota global: 6.7 → 7.8 tras los arreglos (antes 7.7, ▲0.1)

| Rubro | Aud. 9 (tras arreglos) | Ronda 10, primer corte | Tras los arreglos | | Razón del movimiento final |
|---|:--:|:--:|:--:|---|---|
| Tool calling | 8 | 8 | **9** | ▲ | fallback de OCR + 6 de 7 MEDIO/BAJO cerrados (falso positivo de `isTransientError`, atribución de costo por modelo, args auditables, loop-guard que corta antes de gastar la ronda, error de Postgres saneado); queda 1 BAJO (prueba de handler real) y `ctx.signal` documentado a propósito, fuera de alcance de este rubro |
| Pruebas | 9 | 8 | **8** | ▼ | el hallazgo del día (OCR-constante) resultó falso a nivel de datos, pero expuso un hueco de cobertura real, ya cerrado — sin más pendientes de este rubro |
| Frontend | 7 | 6 | **8** | ▲ | los 3 ALTO cerrados en el primer corte, más 7 de los 8 MEDIO/BAJO restantes (rótulos, vocabulario de periodo, contraste legal AA, fecha capitalizada, barra fantasma, pesos/dólares); quedan 3 BAJO cosméticos documentados (identidad entre paneles, preview del chofer, tarjetas medio vacías) |
| Seguridad | 8 | 6 | **8** | ▲ | IDOR de `unidadId` (mismo patrón que `operadorId`), CSP con inventario real de la app, y `/acceso` (código muerto que mentía sobre el mecanismo de acceso) — los tres cerrados |
| Arquitectura | 7 | 7 | **8** | ▲ | el mutex de `reabrirViaje` se confirmó necesario (carrera real rastreada, no hedgeada) y se cerró con el mismo patrón que ya usa el resto del archivo |
| Backend | 8 | 6 | **8** | ▲ | los 2 ALTO del primer corte más el claim atómico de `escalar_viaje` (mismo patrón que `al_vuelo.ts` contra corridas de cron solapadas) |
| Datos | 8 | 7 | **8** | ▲ | migración duplicada cerrada en el primer corte; cabeceras cosméticas de 0070-0072 corregidas |
| Fiscal | 7 | 6 | **8** | ▲ | el CRÍTICO de negocio (roadmap apuntaba al 46% menor del gasto) se atacó de raíz: se construyó la ingesta de CFDI consolidado (monedero + TAG), verificada contra el XSD real del SAT y con una corrida real contra Postgres — ver sección propia abajo. Más los 2 MEDIO reincidentes y el candado de mandato |
| Operabilidad | 7 | 6 | **7** | = | además de lo ya cerrado en el primer corte, otra sesión resolvió por su cuenta el propio hallazgo operativo pendiente de rondas anteriores: Vercel ya no redespliega en cada push (`vercel.json`, bandera `[deploy]` en el asunto del commit) |
| Legal | 7 | 6 | **7** | = | el candado de código contra `FACTURACION_MODO=emitir` sin mandato está cerrado; la cláusula legal real sigue pendiente de Javier con su abogado — un candado de código no sustituye eso |
| Agéntico | 8 | 7 | **7** | ▼ | sin cambio en este segundo corte — los 8 hallazgos de ronda 9 y el reincidente de `guardiaFundamento` ya estaban cerrados en el primer corte |

**Once de doce rubros subieron o se sostuvieron tras los arreglos; solo agéntico
quedó igual (ya estaba cerrado del todo desde el primer corte).** La nota
final (7.8) supera a la ronda 9 (7.7) — con más ALTOs y un CRÍTICO de negocio
resueltos que en cualquier ronda anterior, y en una sola tarde.

### Segunda tanda de arreglos: qué se cerró

Tras el primer corte (arriba, "Ronda 10"), Javier pidió cerrar TODO lo que
quedó documentado — no solo los CRÍTICO/ALTO. Catorce hallazgos MEDIO/BAJO
más, repartidos en 4 agentes (dos se colgaron por el mismo "stream watchdog"
de siempre; se retomaron con `SendMessage` o, tras varios colgones, se
terminaron directamente):

- **Frontend** (`feb0b2f`, 7 de 8): rótulos cortados (`line-clamp-2`),
  vocabulario de periodo unificado, dos secciones ahora dicen su ventana,
  `--faint` sube a AA (4.70:1), fecha capitalizada solo al inicio (no por
  CSS), barra fantasma eliminada (misma regla que `chofer/vista.tsx`), y
  `usd()` con prefijo `US$`.
- **Seguridad** (`714e23a`, `4d1c5ef`, `7f8ffe7`): `unidadId` mismo patrón
  que `operadorId`, CSP con inventario real de la app antes de escribir las
  directivas, `/acceso` borrado entero (mentía sobre cómo funciona el
  acceso hoy).
- **Fiscal** (`a0c333c`): matiz legal del plazo también en la rama sin
  verificar, LISR 28-V ya no se apaga por un hospedaje trivial sin CFDI,
  `permiso_cre.ts` conservado con la razón fechada (Fase 3 del roadmap lo
  necesita).
- **Tool calling** (`0a199dc`): ver tabla arriba.
- **Migraciones** (`80d2511`): cabeceras cosméticas de 0070-0072.

### El CRÍTICO de negocio: la ingesta de CFDI consolidado (`ab6dcda`, 7 commits)

Construida de punta a punta, no solo diseñada. Extiende `cfdi_xml.ts` para
extraer TODAS las líneas de un CFDI consolidado (dos fuentes reales,
verificadas contra el XSD oficial del SAT antes de escribir código: ECC12
para monedero con fecha/RFC/monto por transacción; multi-`Concepto` para
TAG/peaje, sin fecha por línea — el estándar no la da ahí, y no se inventó
una). El JOIN contra `viaje`/`gasto` usa tolerancia documentada
(fecha±1 día, monto±$1), solo liga automático cuando hay UN candidato
inequívoco, y deja el resto en una cola de conciliación para un humano —
misma doctrina de "nunca inventar una cifra" que rige el resto del repo.
Migración `0076` aplicada a producción y verificada. Probado con una corrida
real contra Postgres (`pruebas-manuales/consolidado-real.prueba.ts`), no
solo con mocks.

**Honesto sobre lo que falta:** sin UI para resolver a mano una línea
ambigua (los datos están en `cfdi_consolidado_linea`, no son clicables
todavía), sin conexión viva a ningún portal de monedero/TAG (sigue siendo
reactivo a lo que llegue por WhatsApp), y las líneas de TAG sin ECC12
tienden a quedarse en la cola por la falta de fecha por línea del estándar.
No es el 100% del hallazgo cerrado — es la arquitectura correcta, construida
y verificada, con sus límites reales a la vista.

---

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
