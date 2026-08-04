# Plan de arreglo — auditoría 11

**Ancla:** `claude/auditoria-11` = `master` (`e4326f9`) + `docs/`. Demo **6-ago-2026**.
**Compuerta de esta fase:** `npx vitest run` · `npx tsc --noEmit -p .` · `npm run lint`.
Aquí **no hay** Supabase/Postgres, ni `.env`, ni OpenRouter, ni red a servicios de
pago. **No se corre `npm run build`.**

---

## Resumen

Los once rubros levantaron **158 hallazgos**. Uno está **cerrado** (`A11-BE-1/SEC-1`,
el rail sin gate de rol, commit `2fb1982`) y uno **descartado por falso**
(`A11-ARQ-1`, el `if (false && …)` de `tenant-efectivo.ts:55` — era un mutante en el
árbol de trabajo de otro agente; el código commiteado está bien). Quedan **156
hallazgos vivos**, que agrupados por **causa raíz y archivo** son **63 grupos
únicos**.

| Clase de viabilidad | Grupos |
|---|---:|
| **ARREGLABLE** aquí, con prueba que lo reproduce | **31** |
| **YA ARREGLADO EN EL PR #7** (rama `claude/auditoria-10`, sin mergear) | **23** |
| **NO REPRODUCIBLE AQUÍ** (exige base, credenciales o red) | **5** |
| **DECISIÓN HUMANA** (aviso, umbral, política, ordinales) | **4** |
| **Total** | **63** |

### El dato que decide la mitad del plan

Medido hoy, no inferido:

```
$ git merge-base origin/master claude/auditoria-10   →  fe2d11c
$ comm -12 <(git diff --name-only fe2d11c origin/master  | sort) \
           <(git diff --name-only fe2d11c claude/auditoria-10 | sort)
21 archivos
```

**Solo 21 archivos fueron tocados por las dos ramas.** Y de esos 21, en `src/lib`
únicamente: `admin/negocio.ts`, `auth/guard.ts`, `auth/session.ts` (5 líneas),
`cuadra/analytics.ts`, y dos `*.test.ts`.

Consecuencia práctica: **`processor.ts`, `conv.ts`, `repo.ts`, `tools.ts`,
`presupuesto.ts`, `privacidad.ts`, `costos.ts`, `cuadre/*`, `intake/*`, `llm/*`,
`agents/*`, `meta/*`, `mis-viajes/`, `supabase/seed.sql` y `supabase/migrations/`
(salvo el choque de ordinales) NO los tocó `master`.** Los arreglos que el PR #7 les
hizo aterrizan **sin un solo conflicto**. Rehacerlos aquí no es "arreglar dos veces":
es crear una segunda variante del mismo arreglo sobre un archivo que el merge va a
sobrescribir. Por eso 23 grupos se marcan **YA ARREGLADO EN EL PR #7** y su acción es
**cherry-pick, no reescritura**.

Los 14 archivos que sí conflictúan son casi todos de `src/app/` — `/dashboard/page.tsx`,
`/dashboard/[id]/page.tsx`, `estatus.ts`, `globals.css`, `login/page.tsx` y nueve
páginas de `/admin` — más `analytics.ts`, `session.ts`, `guard.ts`, `negocio.ts` y
`verificaciones.sql`. **Ahí sí hay que escribir el arreglo nuevo**, y es exactamente
donde se concentran los 31 grupos ARREGLABLES.

### Regla de decisión que se aplicó a cada grupo

1. ¿El arreglo vive en un archivo que `master` **no** tocó y el PR #7 **sí**?
   → **YA ARREGLADO EN EL PR #7**. No se reescribe.
2. ¿Se puede escribir una prueba que lo reproduzca con `vitest` + mocks, sin base,
   sin red, sin credenciales? → **ARREGLABLE**.
3. ¿La prueba exige ejercer una migración, una policy de RLS, un grant o un servicio
   externo? → **NO REPRODUCIBLE AQUÍ**.
4. ¿La respuesta correcta es una decisión de producto, de aviso legal o de umbral?
   → **DECISIÓN HUMANA**.

---

## Dominios de archivo (disjuntos)

Seis agentes en paralelo. **Ningún archivo aparece en dos dominios.** Las
sustracciones (`menos …`) son deliberadas y hay que respetarlas al pie de la letra.

| Dominio | Archivos que le pertenecen | Grupos |
|---|---|---|
| **D1 · Panel del cliente y su capa de datos** | `src/app/dashboard/**` **menos** `despacho/`, `pod/`, `unidades/`, `incidencias/`, `viajes/`, `soporte/`, `mapa/` · `src/app/mis-viajes/**` · `src/app/api/dashboard/asistente/route.ts` · `src/app/admin/ui/kit.tsx` · `src/app/admin/ui/global-filter.tsx` · `src/app/globals.css` · `src/lib/cuadra/analytics.ts` · `src/lib/cuadra/pg.ts` | G-09 G-10 G-11 G-12 G-13 G-14 G-15 G-16 G-17 G-25 G-32 G-41 G-46 G-47 G-52 G-56 → **16** |
| **D2 · Motor fiscal, el papel y las normas** | `src/lib/cuadra/cuadre/**` · `src/lib/cuadra/liquidacion/**` · `src/lib/cuadra/intake/sat.ts` · `src/lib/cuadra/facturacion/**` · `normas/**` · `supabase/seed.sql` · `FISCAL_LEGAL.md` · `docs/fase1/spec-contadores-periodo.md` | G-01 G-02 G-03 G-05 G-06 G-07 G-08 → **7** |
| **D3 · Puerta de entrada: auth, sesión, API pública, arranque y despliegue** | `src/lib/auth/**` · `src/proxy.ts` · `src/instrumentation.ts` · `src/app/login/**` · `src/app/auth/**` · `src/app/acceso/**` · `src/app/sin-acceso/**` · `src/app/api/export/**` · `src/app/api/demo/**` · `src/lib/observability/**` · `src/lib/cuadra/startup.ts` · `DEPLOY.md` · `README.md` · `.env.example` · `scripts/**` | G-24 G-26 G-30 G-31 G-34 G-36 G-37 G-38 G-50 G-61 G-62 → **11** |
| **D4 · WhatsApp: processor, conversación, presupuesto y privacidad** | `src/lib/cuadra/processor.ts` · `conv.ts` · `repo.ts` · `tools.ts` · `presupuesto.ts` · `duplicados.ts` · `pg_errores.ts` · `src/lib/cuadra/periodo/**` · `src/lib/cuadra/intake/**` **menos** `sat.ts` · `src/lib/cuadra/privacidad.ts` · `src/lib/meta/**` · `src/app/api/webhook/**` · `src/app/privacidad/**` · `src/app/aviso/**` | G-04 G-18 G-19 G-22 G-23 G-44 G-54 G-55 G-58 G-59 G-60 → **11** |
| **D5 · Operación del encargado y esquema de base** | `src/lib/cuadra/operacion.ts` · `src/app/dashboard/{despacho,pod,unidades,incidencias,viajes,soporte,mapa}/**` · `supabase/migrations/**` · `supabase/verificaciones.sql` · `src/lib/cuadra/migraciones_verificadas.test.ts` | G-20 G-21 G-27 G-28 G-29 G-48 G-51 G-57 G-63 → **9** |
| **D6 · Costo de IA, gateway de modelos, consola `/admin` y CI** | `src/lib/llm/**` · `src/lib/agents/**` · `src/lib/cuadra/costos.ts` · `src/lib/admin/negocio.ts` · `src/app/admin/**` **menos** `ui/kit.tsx` y `ui/global-filter.tsx` · `src/lib/formato.ts` · `vitest.config.ts` · `.github/workflows/ci.yml` | G-33 G-35 G-39 G-40 G-42 G-43 G-45 G-49 G-53 → **9** |

### Los cinco arreglos que cruzan dominios (owner único declarado)

| Grupo | Cruza | Owner | Qué hacen los demás |
|---|---|---|---|
| G-32 `safe()` × 16 | D1 (11 archivos) + D5 (4) + D3 (1) | **D1** escribe `safeLog()` en `src/lib/cuadra/pg.ts` con `logger.error` | D5 y D3 sustituyen su copia por el import **después** de que D1 publique |
| G-34 `tenantDelAction` × 8 | D3 + D5 (4 actions) + D1 (2) | **D3** escribe `resolverTenantDeAction()` en `tenant-efectivo.ts` con `exigir()` + `logger` | D1 y D5 sustituyen sus copias por la llamada |
| G-47 "ver como" `?rol=` | D1 (13 páginas) + D5 (4) | **D1** fija el contrato en `sufijo.ts` (arrastrar `rol`) y corrige sus páginas | D5 aplica el mismo cambio de una línea en el tipo de `searchParams` de sus 4 páginas |
| G-09 `KpiTile` | D1 + D5 (`incidencias/vista.tsx`) | **D1** añade `valor: number \| null` a `KpiTile` y corrige sus consumidores | D5 corrige `incidencias/vista.tsx:49-52` (`mediana ?? 0` → `mediana`) contra el nuevo tipo |
| G-05 peaje sin condiciones | D2 (motor + PDF) + D1 (4 pantallas) | **D2** — expone la etiqueta condicionada desde `acreditable.ts` | D1 consume la etiqueta; no reescribe la regla |
| G-29 bucket `avatares` | D5 (migración) + D6 (server action) + D4 (aviso) | **D5** — la migración es donde tiene que aterrizar | La validación del server action va en G-33 (D6); el aviso, en G-54 (D4) |

`src/lib/cuadra/repo.ts` y `src/lib/cuadra/tools.ts` son de **D4 y solo de D4**. Los
hunks que fiscal (`repo.ts:775-809`, el 15%) y operación (`repo.ts:109-116`,
`reasignarOperador`) necesitan se entregan a D4 con el grupo correspondiente
(G-04 y G-21), no se editan desde fuera.

---

## Los grupos

Ordenados por **daño real que el contralor puede ver el 6-ago**, no por severidad
declarada.

---

### BLOQUE A · Las cifras fiscales que el contralor cruza contra su PDF

#### G-01 · [YA ARREGLADO EN EL PR #7] El RFC del tenant del demo no pasa nuestro propio dígito verificador · dominio: D2 · severidad: CRÍTICO
Reportado por: fiscal.
`supabase/seed.sql:26` (`'TIN010101AAA'`) · `src/lib/cuadra/config.ts:186-215` ·
`src/lib/cuadra/cuadre/engine.ts:188-231` · `src/lib/cuadra/liquidacion/deducibilidad.ts:74-80`.
`esRfcValido` da `true` y `rfcChecksumOk` da `false` (el dígito esperado es `5`, no
`A`), así que `rfcEmpresaInservible` se vuelve `true` y **toda** la liquidación del
demo sale `Por confirmar $5,600.00`, cero deducible, sin la sección ACREDITABLE, y
con un pie falso ("Falta timbrar la factura") sobre dos CFDI timbrados.
**Reproducción:** `expect(rfcChecksumOk(RFC_DEL_SEED)).toBe(true)` — una aserción.
**PR #7:** `d08db8a`. `master` nunca tocó `seed.sql` → cherry-pick limpio.
**Si el PR no se mergea, esto se hace igual: es un carácter y el arreglo es idéntico
al del PR, no una variante.** Todas las cifras fiscales del demo cuelgan de este dato.

#### G-02 · [YA ARREGLADO EN EL PR #7] Un CFDI que el SAT reporta en EFOS imprime `Deducible para ISR $11,600` en verde · dominio: D2 · severidad: CRÍTICO
Reportado por: fiscal (REINCIDENTE).
`src/lib/cuadra/intake/sat.ts:82,84` · `src/lib/cuadra/cuadre/engine.ts:86`
(`POR_CONFIRMAR`), `:407-408`, `:866` (`SIN_ACREDITAMIENTO`).
`efos: true` es inalcanzable desde producción; el único camino vivo,
`cfdi_efos_indeterminado`, no está en ninguna de las dos listas duras: solo en
`REVISAR`, que mueve el estatus y ninguna cifra.
**Reproducción:** `cuadrarViaje` con `efosRevisar: true` → esperar
`totalPorConfirmar = 11600`, `ivaAcreditable = 0`.
**PR #7:** `65b90eb`, `4d8b4f4`. Verificado: en esa rama `engine.ts:150` y `:1084`
ya incluyen `cfdi_efos_indeterminado` en las dos listas. `master` no tocó `engine.ts`.

#### G-03 · [YA ARREGLADO EN EL PR #7] "Efectivo" está implementado como `formaPago === '01'`: un diésel con `FormaPago 99` acredita deducción, IVA y 200 litros · dominio: D2 · severidad: ALTO
Reportado por: fiscal (dos hallazgos REINCIDENTES).
`src/lib/cuadra/cuadre/engine.ts:271`, `:273`, `:929` (`pagoElectronico = formaPago !== '01'`).
La norma define lo contrario: una **lista cerrada** de medios que sí cumplen
(RFA 2026 2.9, LISR 27-III 2º párrafo). Hoy `99` (PPD — el CFDI que emite una
gasolinera a crédito), `15` (condonación), `17` (compensación) y seis códigos más
salen deducibles, con IVA acreditable y con los litros del estímulo del LIF 20-A.
**Reproducción:** barrido de los 13 códigos de `c_FormaPago` contra `cuadrarViaje`.
**PR #7:** `b4d277b`, `40a5e54`, `0d1fe65`, `f85a194` (introduce `MEDIOS_LIF_20A`, que
grepeado **no existe en `master`**).

#### G-04 · [ARREGLABLE] El contador del 15% de la RFA 2.9 está ciego y su "margen" está mal despejado · dominio: D4 · severidad: ALTO
Reportado por: fiscal (dos hallazgos, los dos **NUEVOS** — el módulo `periodo/` llegó
en los 40 commits que nadie había auditado).
`src/lib/cuadra/repo.ts:790` (`if (g.forma_pago === '01') efectivo += monto`) ·
`src/lib/cuadra/periodo/combustible.ts:69-91` y `:89` · `src/lib/cuadra/periodo/aviso.ts:22-25,29`
· `src/lib/cuadra/tools.ts:104-107` · `src/lib/cuadra/repo.ts:775` (`.eq('concepto','diesel')`).
Dos defectos independientes en el mismo módulo: (a) el numerador cuenta solo `'01'`,
así que una flota que compra **todo** su diésel a crédito sale `holgado` con el aviso
en `null` cuando va en 20%; (b) `margen = permitido − efectivo` responde a otra
pregunta — la correcta es `(0.15·total − efectivo) / 0.85`, y la diferencia es 17.6%
sobre una cifra en pesos que el aviso presenta como "lo accionable".
**Reproducción:** `evaluarTope15` y `avisoTope15` son funciones puras. Dos casos:
$800k transferencia + $200k `FP 99` → `excedido`; $1M con $120k `FP 01` → margen
$35,294.12. Falla hoy y pasa con el arreglo. La prueba existente
`combustible.test.ts:67-72` **fija el valor equivocado** y hay que corregirla.
**No está en el PR #7:** `periodo/` no existe en esa rama.

#### G-05 · [ARREGLABLE] El estímulo de peaje se afirma en verde en cinco superficies sin ninguna de sus cuatro condiciones; y el IVA sale verde donde el ISR va condicionado · dominio: D2 (D1 consume) · severidad: ALTO
Reportado por: fiscal (dos hallazgos REINCIDENTES, uno con alcance ampliado).
`src/lib/cuadra/liquidacion/acreditable.ts:110-119` (el PDF **sí** cumple: tono
`condicionado` + "Likida NO verifica la elegibilidad" + las 4 condiciones) contra
`src/app/dashboard/page.tsx:245-246`, `[id]/page.tsx:211`, `facturacion/page.tsx:98`,
`combustible-casetas/page.tsx:85` y `src/lib/cuadra/cuadre/resumen.ts:96` (WhatsApp).
Y `acreditable.ts:102-108` vs `deducibilidad.ts:64-72`: `permiso_cre_no_verificable`,
`complemento_no_verificable` y `alimentacion_sin_soporte` no están en
`SIN_ACREDITAMIENTO` (`engine.ts:866`), así que el IVA se acredita al 100% en verde
dos renglones debajo de un ISR condicionado por el mismo hecho.
**Reproducción:** una prueba que exija que toda superficie que imprima
`peajeAcreditable` lea su etiqueta de `acreditable.ts` (grep-test, del mismo estilo
que `formato.test.ts`), más `cuadrarViaje` con diésel de $5,400 y clave `15101505`.
**PR #7:** `fe31209` y `d6d160f` cubren 3 de las 5 superficies y el `SIN_ACREDITAMIENTO`;
`facturacion` y `combustible-casetas` son **nuevas de `master`** y hay que extenderlo.

#### G-06 · [YA ARREGLADO EN EL PR #7] Un hospedaje de $1 sin timbrar apaga las dos advertencias de LISR 28-V; un hotel en `viaticos` pierde $1,250 citando el tope de la alimentación · dominio: D2 · severidad: MEDIO + BAJO
Reportado por: fiscal (REINCIDENTE, agravado).
`src/lib/cuadra/cuadre/engine.ts:681`, `:730`, `:773`.
El soporte se modela por existencia de un `concepto`, sin mirar `cfdiUuid` ni monto —
y ahora la liquidación no cae a `con_diferencias` sino a **`cuadrada`**, entera en verde.
**PR #7:** `e4ae360`, `6b3b916`.

#### G-07 · [YA ARREGLADO EN EL PR #7] 34 de 38 comercios afirman una fecha límite sin decir que el plazo legal es todo el ejercicio · dominio: D2 · severidad: MEDIO
Reportado por: fiscal (REINCIDENTE).
`src/lib/cuadra/cuadre/engine.ts:600,623-625,645` · `src/lib/cuadra/facturacion/comercios.ts`
· fichas `politica-portales-plazos.yaml` (**`sin_verificar`**) y `rmf-2026-2.7.1.21.yaml`
(`texto_vigente: null`). El matiz legal es propiedad de `cierreComercio`, que solo
existe cuando el plazo está verificado. `normas/README.md:55` prohíbe exactamente esto.
**PR #7:** `5e31f0c` (las cuatro ramas dicen que el plazo es el ejercicio).

#### G-08 · [YA ARREGLADO EN EL PR #7] El `estado` de verificación de una ficha no decide nada en runtime; `usado_en_codigo` miente; el 4º párrafo del LIF 20-A no está transcrito; `FISCAL_LEGAL.md` pone el 15% "por mes" · dominio: D2 · severidad: MEDIO + BAJO ×3
Reportado por: fiscal (cuatro hallazgos).
`src/lib/cuadra/tools.ts:71` (`verificada: estado !== 'sin_verificar'` — colapsa tres
estados en dos) · `normas/rfa-2026-2.9.yaml:42-47` · `normas/lif-2026-20-A.yaml` ·
`FISCAL_LEGAL.md:49-53,196`.
**PR #7:** `5bcc3be` (los tres estados llegan al agente), `35d708d`, `f85a194`.
Residual **ARREGLABLE aquí sin tocar `tools.ts`**: `FISCAL_LEGAL.md:49-53` sigue
prometiendo una medición **mensual** sobre una regla **anual**, y
`normas_sincronizadas.test.ts` nunca compara `usado_en_codigo` — esa prueba se puede
escribir (D2 es dueño de `normas/`).

---

### BLOQUE B · La pantalla que se proyecta en la sala

#### G-09 · [ARREGLABLE] `KpiTile` no sabe decir "no lo medí": tres tarjetas fiscales, los litros y la mediana de incidencias afirman una medición que nunca ocurrió · dominio: D1 (+ `incidencias/vista.tsx` a D5) · severidad: CRÍTICO
Reportado por: frontend (CRÍTICO REINCIDENTE, reabierto y peor).
`src/app/admin/ui/kit.tsx:59` (`{fmt(mostrado)}` — sin rama para "no hay dato";
`vacio` y `nota` solo añaden texto **debajo**) · `src/app/dashboard/page.tsx:238-246`
(Diésel elegible con `destacar`, IVA acreditable, Peaje 50%) ·
`combustible-casetas/page.tsx:83-85` (`acred?.litrosDiesel ?? 0` **fuera** del guard
de esa consulta) · `facturacion/page.tsx:93-101` · `incidencias/vista.tsx:49-52`
(cuyo propio comentario dice *"un 0 se leería como 'se resuelven al instante'"* y la
línea siguiente escribe `mediana ?? 0`).
Con los datos del seed y sin ninguna falla, el panel imprime **`0 L`** bajo "LIF 2026,
Art. 20-A" y **`$0.00`** bajo "LIVA, Art. 5". Un cero fiscal con respaldo legal.
**Reproducción:** render de `KpiTile` con `valor={null}` (hoy imprime `$0.00`);
más un caso de `combustible-casetas` donde `getAcreditables` truena y
`getGastoPorConcepto` no → "31 cargas" al lado de "0 L elegibles".
**El arreglo del PR #7 (`acred.tsx`, `0af4a7e`/`5365ca0`) NO aplica:** ese archivo se
escribió contra un `/dashboard/page.tsx` que `master` reestructuró, y el frontend de
esta ronda dice explícitamente que el arreglo correcto es una capacidad de `KpiTile`
(`valor: number | null`), no un componente aparte. **Exige que `getAcreditables`
(D1, `analytics.ts`) devuelva si hubo filas** — cambio de tipo compartido, mismo dominio.

#### G-10 · [ARREGLABLE] "IVA acreditable" son tres números en cuatro pantallas, y "del periodo" es "de siempre" · dominio: D1 · severidad: ALTO
Reportado por: frontend (NUEVO).
`src/app/dashboard/page.tsx:80,82` (`getAcreditables(tenantId, ventana)` — 7 días) ·
`facturacion/page.tsx:35` y `combustible-casetas/page.tsx:41` (**sin ventana** = histórico)
· `api/dashboard/asistente/route.ts:48-49` (sin ventana, alimenta el rail de las 20
páginas) · `chat.tsx:31,37,40` (*"este periodo"*) · `cuadre/page.tsx:67` con `:87`
(**"Comprobación del periodo"** sobre `getKpis(tenantId)` sin ventana, o sea
`corteVentana(undefined) = null` y sin `.gte('created_at', …)`).
En `/dashboard` el rail contesta $4,120.00 "este periodo" mientras la tarjeta a su
izquierda dice $774.48, **con el mismo rótulo y la misma cita de LIVA**.
El encabezado de `analytics.ts:28-34` documenta este mismísimo bug como ya cerrado.
**Reproducción:** hacer `ventanaDias` obligatorio en `getKpis`/`getAcreditables`
(`tsc` caza a los ocho llamadores), más una prueba que exija que toda pantalla con
rótulo "del periodo" pase una ventana.

#### G-11 · [ARREGLABLE] Con la base caída, la cifra más grande del panel dice `$0.00` justo encima del cartel que avisa que no se pudo leer nada · dominio: D1 · severidad: ALTO
Reportado por: frontend (NUEVO).
`src/app/dashboard/page.tsx:145-150` (`<CifraGrande valor={kpis?.diferenciaDetectada ?? 0}>`)
· `:138` (`<AvanceCierre viajes={viajes ?? []}>`) · `:168` (donde recién empieza
`{estado === 'error' ? …}`) · `src/app/dashboard/estado.ts:32`.
El encabezado se sacó fuera del condicional al fijar el scroll, y con él salió del
alcance del estado: la misma pantalla dice a la vez "no pude leer nada" y "medí, y
dio cero". El repo ya lo resolvió bien en el otro Inicio
(`inicio-operacion.tsx:93` escribe `?? '—'`).
**Reproducción:** `estadoPanel` = `'error'` con `kpis = null` → esperar que la cifra
grande no se renderice (o renderice `—`). `estado.test.ts` ya tiene el andamio.

#### G-12 · [ARREGLABLE] El botón "30d" del panel no hace nada · dominio: D1 · severidad: ALTO
Reportado por: frontend (NUEVO).
`src/app/dashboard/page.tsx:73` (default `'7'`) · `:211` (`pordefecto="30"`) ·
`src/app/admin/ui/global-filter.tsx:34` (`if (rango !== pordefecto) params.set(…)`).
Clic en 30d → no escribe el parámetro → `href="/dashboard"` → `rango = '7'` → misma
pantalla y el pill salta de vuelta a 7d. Los 30 días son **inalcanzables desde la
interfaz**. Es la única combinación rota del repo; `admin/page.tsx` y
`analitica/page.tsx` están bien. El docstring de `global-filter.tsx:26-32` describe
este mismo bug al revés como algo ya arreglado.
**Reproducción:** una prueba pura sobre `construir()` de `global-filter.tsx`: para
cada página que lo monta, `pordefecto` debe coincidir con el default que la página
resuelve cuando no hay `?rango=`.

#### G-13 · [ARREGLABLE] `--faint` mide 2.56:1: las citas legales que sostienen cada cifra fiscal son el texto menos legible del panel · dominio: D1 · severidad: ALTO
Reportado por: frontend (NUEVO; mismo hueco que en la ronda 10 dejó pasar `--color-warn`).
`src/app/globals.css:68` (`--faint: #a1a1aa` → **2.56:1** sobre `#ffffff`, 2.48:1
sobre `--bg`) · `src/app/admin/ui/kit.tsx:64,71` (el pie de **todos** los `KpiTile`)
· `src/app/dashboard/contraste.test.ts:59-101`, que mide **solo** `--color-ok` y
`--color-bad` y se llama a sí mismo "los tres tokens con significado".
Con ese token se pintan "LIF 2026, Art. 20-A", "LIVA, Art. 5" y el mensaje que declara
el supuesto de `MINUTOS_CAPTURA_MANUAL` — la defensa del producto contra "¿de dónde
salió ese número?". Segundo caso: `StatusPill` (`kit.tsx:88-95`) da 4.46:1 y 4.45:1.
**Reproducción:** reescribir `contraste.test.ts` para que descubra **todo token que
aparezca como `color:`** en `src/app/`, no una lista fija. Falla hoy con `--faint`.

#### G-14 · [ARREGLABLE] "Avance de cierre — Todo" se calcula sobre 100 filas, `getDocumentos(1000)` pide exactamente el `max_rows`, y el día se agrupa en UTC · dominio: D1 · severidad: ALTO
Reportado por: backend, rendimiento (el mismo defecto), y backend (el UTC).
`src/lib/cuadra/analytics.ts:328-334` (`getViajes(tenantId, limite = 100)` — la única
lectura del archivo que **no** pasa por `traerTodo`) · `src/app/dashboard/page.tsx:89,138`
· `avance-cierre.tsx:41-56` (el filtro por periodo corre en el cliente, y se ordena
por `created_at` mientras se filtra por `fecha_inicio`) · `analytics.ts:358-364` +
`facturacion/page.tsx:34` y `combustible-casetas/page.tsx:44` (`.limit(1000)`) ·
`analytics.ts:171-174` (`(r.created_at).slice(0,10)` — el mismo archivo documenta
este bug treinta líneas más arriba como ya pagado en otro sitio).
Flota de 25 viajes/día: la pestaña "Todo" pinta 25% donde el histórico es ~95%, y da
el mismo número que "Mes". Una liquidación cerrada el viernes 31-jul a las 20:00 de
México se pinta en la barra del sábado.
**Reproducción:** `getViajes` mockeado con 120 filas; `getLiquidacionesPorDia` con un
`created_at` de `2026-08-01T02:00:00Z` → esperar el 31-jul.
**PR #7 no lo cubre:** `getViajes`/`getDocumentos` son nuevas de `master`.

#### G-15 · [ARREGLABLE] Mapas de etiqueta incompletos: el veredicto del SAT sale en ámbar y en crudo, "Por confirmar" se ve idéntico a "Deducible", el chofer lee claves de base de datos · dominio: D1 (+ `viajes/page.tsx` a D5) · severidad: MEDIO
Reportado por: frontend (3 hallazgos) y arquitectura (2).
`src/app/dashboard/documentos/page.tsx:23-30` (`EstadoSat` **2 de 4**: un CFDI
`no_encontrado` —la misma cubeta de no deducible que `cancelado`— sale en **ámbar** y
con la clave cruda) · `src/app/dashboard/[id]/page.tsx:189-190` (`TonoDeducibilidad`
**2 de 4**: un ternario para una unión de cuatro; `pdf.ts:295` sí pinta los cuatro,
así que pantalla y PDF del mismo viaje no coinciden) · `usuarios/page.tsx:106` (el
pill imprime `flota_admin` en crudo teniendo el repo tres mapas de rol escritos) ·
`mis-viajes/page.tsx:8-12` (tercera copia de `ESTATUS`, byte a byte idéntica a
`dashboard/estatus.ts:19-21`, **fuera** de la lista de `etiquetas_sincronizadas.test.ts:116`)
· `dashboard/viajes/page.tsx:45` (`SIN_CERRAR` niega donde `operacion.ts:21` y
`conv.ts:130` enumeran).
**Reproducción:** extender `etiquetas_sincronizadas.test.ts` para que **descubra** los
mapas (no los nombre) y exija exhaustividad contra la unión de `src/types/cuadra.ts`.
El comentario de `[id]/page.tsx:174-175` que justifica la tinta plana lleva **tres
rondas vencido**: `globals.css:35` es `#14602c`, 7.67:1.

#### G-16 · [YA ARREGLADO EN EL PR #7] `/mis-viajes` imprime "$0.00 comprobado" y le enseña al chofer el semáforo del contralor · dominio: D1 · severidad: MEDIO
Reportado por: frontend y agéntico (los dos REINCIDENTES).
`src/app/mis-viajes/page.tsx:38` (`Number(liq?.total_comprobado ?? 0)`) · `:87` · `:80`.
La columna de estatus **sí** distingue `null`; la de dinero colapsa a `0` y lo formatea
como medición. El chofer concluye que su envío se perdió y reenvía catorce fotos —
cada reenvío es otra pasada de OCR pagada. Y `cfdi_efos`, que `SOLO_CONTRALOR` filtra
del WhatsApp, le llega igual como "Por revisar" en rojo, sin nota y sin nada que pueda
hacer.
**PR #7:** `7ffd930`, `5da92af`. `master` no tocó `mis-viajes/page.tsx`.

#### G-17 · [ARREGLABLE] Marco y accesibilidad: 23 etiquetas dentro de 56 px bajo 1024, cero `aria-current` en todo el producto, 292 px muertos en las 30 páginas de `/admin`, 4 de 106 `<th>` con `scope` · dominio: D1 (+ `admin/asistente-expandible.tsx` a D6) · severidad: MEDIO ×3 + BAJO
Reportado por: frontend (4 hallazgos, dos REINCIDENTES).
`src/app/dashboard/chrome.tsx:55-57` + `src/app/marco.ts:22-23` + `sidebar-nav.tsx:36-38`
(una sola variante) contra `src/app/admin/layout.tsx:81-82` y
`src/app/admin/sidebar-nav-iconos.tsx`, **que existe exactamente para esto** ·
`sidebar-nav.tsx:35-39` (el `<Link>` usa una constante idéntica para los 23 items) ·
`admin/asistente-expandible.tsx:36` (`calc(100% - 292px)` **sin condición de
breakpoint** mientras el `<aside>` que ocuparía esos px es `hidden xl:flex`, y desde
esta ronda envuelve `children` en el layout: 32% del área útil a 1200 px) ·
106 `<th>` en `src/app/`, cuatro con `scope`.
**Reproducción:** los tres primeros son de render y en este entorno no hay navegador;
lo que **sí** se puede escribir aquí es la prueba estructural: que `chrome.tsx` monte
las dos variantes como `admin/layout.tsx`, que todo `<Link>` de navegación reciba
`aria-current`, y un grep-test de `scope` sobre `<th>` (el PR #7 ya escribió
`encabezados_tabla.test.tsx`).
**PR #7:** `88c8138` (los 292 px, sobre un archivo que **sí** conflictúa) y `526a5ef`
(tres tablas, no las veinte).

---

### BLOQUE C · Lo que tumba el demo en vivo

#### G-18 · [YA ARREGLADO EN EL PR #7] «listo» con la sala de espera llena cierra la liquidación en $0.00, y la oferta se marca como hecha antes de entregarse · dominio: D4 · severidad: CRÍTICO
Reportado por: agéntico (CRÍTICO + ALTO + 2 MEDIOS, todos REINCIDENTES).
`src/lib/cuadra/processor.ts:1058-1059` (**carácter por carácter** el mismo `if` de la
ronda 10), `:1061` y `:1063` (se marca `ofrecido_en` y luego se envía, tirando el
resultado de `say`), `:1010-1026` (el único brazo que inserta gastos sin barrera ni
mutex y cuyo `catch` no reconoce `llegoTarde`), `:313,321-324` (el `imgHash` se
calcula y se tira).
Con 6 comprobantes de $16,244 en espera, el chofer escribe `listo` y recibe
**"Comprobado: $0.00 · Sobró $18,000.00 (a favor de la empresa)"** más el PDF.
**PR #7:** `8f615d4`, `584be01`, `17e2bf5`, `5eee2c6`. `master` no tocó `processor.ts`
ni `repo.ts` → cherry-pick limpio.

#### G-19 · [ARREGLABLE] La afirmación no está atada ni a la oferta ni al viaje: un «ok» suelto adjunta comprobantes de otro viaje; un «no» descarta todo y promete un rescate que no existe · dominio: D4 · severidad: CRÍTICO
Reportado por: agéntico (dos hallazgos).
`src/lib/cuadra/processor.ts:1004` (`enEspera.filter(h => h.ofrecidoEn)`) · `:1010`
(`if (ofrecidos.length && esAfirmacion(msg.text))`) · `:1047-1051` ·
`src/lib/cuadra/intake/huerfanos.ts:109,122` · `src/lib/cuadra/repo.ts:274-291`
(`getHuerfanos` **no filtra por viaje**) · `supabase/migrations/0040:57`
(`ofrecido_en` es un timestamp: no guarda EN QUÉ VIAJE se preguntó, ni caduca).
Un «va» escrito el 20-jul adjunta a V3 los $6,412 que se ofrecieron en V2 el 15-jul,
sin una marca de fecha sospechosa (la tolerancia son 30 días). Es la frase literal de
la migración que creó la tabla. Y un «no» resuelve las 6 filas para siempre mientras
el mensaje dice *"si alguno sí era de aquí, dime cuál y lo pongo"* — no hay ningún
lector de esa frase.
**Reproducción:** `processInbound` con el repo mockeado: huérfanos ofrecidos en el
viaje A, mensaje «va» con el viaje B abierto → esperar que **no** se adjunten.
**Verificado que el PR #7 NO lo cubre:** en `claude/auditoria-10`,
`processor.ts:1026` sigue siendo `enEspera.filter(h => h.ofrecidoEn)` y `:1032`
sigue siendo `if (ofrecidos.length && esAfirmacion(...))`.

#### G-20 · [NO REPRODUCIBLE AQUÍ] `viaje.operador_id` es `NOT NULL` y todo el módulo del encargado está construido sobre que sea nullable · dominio: D5 · severidad: CRÍTICO
Reportado por: datos (CRÍTICO).
`supabase/migrations/0001_init.sql:49` · `grep "alter column operador_id"` sobre las 47
migraciones → **vacío** · `src/lib/cuadra/operacion.ts:477` (`operador_id: v.operadorId || null`),
`:124` (`.is('operador_id', null)`), `:442` · `src/app/dashboard/despacho/vista.tsx:164`
(`<option value="">Asignar después</option>` — **la opción seleccionada por default**).
Dos mitades: crear un viaje sin chofer es un `23502` que tumba la pantalla, y
"Viajes sin asignar" —lo primero que el encargado abre— **no puede devolver una fila
jamás**, así que el panel afirma *«Todo lo que está en curso ya trae chofer»* y el KPI
"Por asignar" pinta **0** con su nota. Es "nunca inventar una cifra" roto por el esquema.
**Por qué no aquí:** el arreglo es `alter table viaje alter column operador_id drop not null`
y toca la FK compuesta de la 0028 y la RLS del chofer de la 0045; sin Postgres no se
puede ejercer. `operacion.test.ts:293-294` pasa hoy **porque el mock acepta null**.
**Mitigación ARREGLABLE mientras tanto (D5):** que `getViajesSinAsignar` y el KPI
"Por asignar" declaren que la consulta no puede producir filas en vez de afirmar cero,
y que `crearViaje` rechace `operadorId` vacío con un mensaje en vez de un 23502.

#### G-21 · [ARREGLABLE] Las siete escrituras nuevas de `operacion.ts`: un 23505 tumba la pantalla, un update de cero filas se anuncia en verde, y los ids vienen del formulario sin comprobar tenant · dominio: D5 · severidad: CRÍTICO
Reportado por: backend (CRÍTICO + ALTO), datos (MEDIO), seguridad (BAJO), operabilidad.
`src/lib/cuadra/operacion.ts:376-383, 391-395, 471-486, 490-494, 497-501, 512-524, 536-549, 563-567`
· `src/lib/cuadra/repo.ts:109-116` (`reasignarOperador`, REINCIDENTE — **hunk de D4**,
ver G-23) · `src/app/dashboard/despacho/page.tsx:74-120`, `pod/page.tsx:58-66`,
`unidades/page.tsx:70-90`, `incidencias/page.tsx:70-93` · `src/lib/cuadra/pg_errores.ts:40-45`
(`violaIndice`, escrita exactamente para esto, con su prueba, y que **ninguna** de las
siete importa).
Tres defectos: (a) el 23505 de `uq_viaje_abierto_por_operador` / `unidad_economico_unico`
/ `pod_viaje_unico` propaga y `dashboard/error.tsx` pinta *"No se pudo cargar el panel
— hubo un problema al leer los datos"* con un hash; el texto es doblemente falso.
En el tenant del demo son **dos clics**: dar de alta un viaje al único chofer con datos.
(b) PostgREST responde 204 sin error con cero filas empatadas, así que "no había nada
que actualizar" y "se actualizó" entran por el mismo camino y las cuatro acciones
pintan su píldora verde. (c) `asignarUnidad`, `crearIncidencia` y `marcarPodPedido`
escriben `unidadId`/`viajeId` del `<form>` sin comprobar de quién son, contra FK de
una sola columna.
**Reproducción:** `operacion.test.ts` ya mockea el constructor. Hay que corregir el
mock —`operacion.test.ts:44-46` **codifica el cero-filas como éxito**
(`{data: null, error: null}`)— y añadir casos: 23505 traducido a mensaje, update sin
filas que lanza, id de otro tenant rechazado. Ningún test toca hoy los server actions.

#### G-22 · [ARREGLABLE] `guardar_liquidacion` sube dos PDF con `fetch` pelado y persiste después; `sendDocument` devuelve `void`; `PASOS_CIERRE` apunta a trece líneas que no existen · dominio: D4 · severidad: CRÍTICO
Reportado por: rendimiento (CRÍTICO ×2), agéntico (ALTO + BAJO).
`src/lib/cuadra/tools.ts:169` (`storage.upload` **sin `acotada`**), llamado en `:176`
y `:177`; `:181` (`saveLiquidacion` **después** de las dos subidas) ·
`src/lib/cuadra/processor.ts:1158` (`reloj.acotar(40_000)`, la **última** línea del
archivo que menciona `reloj`) hasta `:1482` · `src/lib/meta/client.ts:115`
(`Promise<void>`) y `:127` · `src/lib/cuadra/presupuesto.ts:37-51` (los trece `donde`
apuntan a `processor.ts:591,595,658,715,734,755,757,774,814` — **ninguna contiene el
paso que dice contener**).
Storage degradado hereda el default de undici (300,000 ms × 2) dentro del tramo que el
presupuesto cree acotado a 40,000: la tool terminaría a los **643,500 ms** y Vercel
corta a los 120,000, **antes** de `saveLiquidacion`. No queda liquidación, no queda
PDF, no queda log, y Meta no reintenta. Es el paso 3 del guion del demo.
Y el envío del PDF no tiene acuse: un 400 de Meta se registra y se retorna normal, así
que no sale el mensaje *"…pero no pude generarte el PDF"* que existe justo para eso, y
se cobra el costo de WhatsApp de un documento que no salió.
**Reproducción:** prueba de contrato — que ninguna llamada a `storage` del camino del
cierre salga sin `acotada` (grep-test del mismo estilo que `formato.test.ts`); que
`sendDocument` devuelva el `wamid` y que `processor.ts` registre `pdf.no_entregado`
cuando sea `null`; y que `presupuesto.test.ts` verifique que cada `donde` de
`PASOS_CIERRE` apunte a una línea que **contiene** el símbolo que nombra.
**Verificado que el PR #7 NO lo cubre:** en `claude/auditoria-10`, `tools.ts:244`
sigue con el `upload` pelado y `saveLiquidacion` en `:256`; `meta/client.ts:115` sigue
`Promise<void>`. Lo que **sí** trae el PR #7 es `8c02436` (el cierre consulta el reloj,
125,000 → 48,500) y `a985540` (`ctx.signal?.throwIfAborted()`), que mitigan pero no
cierran la subida.

#### G-23 · [YA ARREGLADO EN EL PR #7] El mutex del "listo" sin techo (300,000 ms), la barrera de intake que espera 20 s por un OCR de 25 s, y 50 `INSERT` en serie sin mirar el reloj · dominio: D4 · severidad: ALTO ×2 + MEDIO
Reportado por: rendimiento (3 REINCIDENTES).
`src/lib/cuadra/conv.ts:287` (el cliente se hoistea fuera del `for(;;)`), `:292` (RPC
sin `acotada`), `:316` (el vencimiento se comprueba **después** del `await`) ·
`processor.ts:1071` (`esperarIntake(…, 20_000)`) contra `:314,506`
(`extraerComprobante(…, 25_000)`) · `processor.ts:1015-1017` + `repo.ts:281`.
Prefijo 58,000 + 300,000 = **358,000 ms contra 120,000**: Vercel mata la función
238,000 ms antes de que el `fetch` se rinda, y el agente ni arrancó.
**PR #7:** `17c6fce`, `a9cd06b`, `53a2c37`. También aquí va `d6ba851`
(`reasignarOperador` valida pertenencia y confirma la escritura) — el hunk de `repo.ts`
que G-21 necesita.

---

### BLOQUE D · Quién ve el dinero de la flota

#### G-24 · [YA ARREGLADO EN EL PR #7] `/api/export/liquidaciones` y `/api/export/pdf/[id]` autentican sin autorizar, y el CSV se recorta en silencio a 1,000 renglones · dominio: D3 · severidad: CRÍTICO
Reportado por: backend (CRÍTICO ×2), seguridad (ALTO), arquitectura (CRÍTICO), datos (ALTO).
Cinco rubros, un defecto.
`src/app/api/export/liquidaciones/route.ts:17-19,21-26` · `src/app/api/export/pdf/[id]/route.ts:32-34`
· `src/lib/auth/permisos.ts:9,17,21` · `src/proxy.ts:81` (`/api` fuera del matcher).
`git diff fe2d11c..HEAD -- src/app/api` devuelve **solo** `dashboard/asistente/route.ts`:
las dos rutas no tienen una línea distinta. `permisos.ts:9` sigue afirmando por escrito
que decide "qué botón se pinta **y qué endpoint acepta la petición**", y **ninguna de
las cinco rutas de `src/app/api/` importa `permisos`**. `puedeAdministrar` tiene cero
consumidores en todo `src/`. Con la cookie de un `operador` —el rol al que esta ronda
le cerró todas las pantallas— sale un CSV con la nómina de viajes de sus compañeros, y
con cualquier `id` de esa lista, la URL firmada del PDF **del contralor**.
Y `.limit(5000)` pierde contra el `max_rows` de 1,000 que el propio repo afirma dos
veces por escrito: la conciliación del trimestre corta a mitad del segundo mes con
HTTP 200 y sin una fila de advertencia.
**PR #7:** `8fb74d4`, `123e023`. `master` no tocó ninguno de los dos `route.ts`.

#### G-25 · [ARREGLABLE] El rail del asistente: el gate de rol ya cerró, pero el rail se monta sin condición de rol, responde 200 con nulos, y traduce un fallo de lectura a «Todavía no hay liquidaciones» · dominio: D1 · severidad: ALTO
Reportado por: seguridad (residual del CRÍTICO cerrado), agéntico (ALTO), operabilidad (MEDIO), rendimiento (MEDIO).
`src/app/dashboard/chrome.tsx:90` (`<RailAsistente />` en las 20 páginas, sin mirar el
rol) · `src/app/api/dashboard/asistente/route.ts:56-65` (el `safe()` que traga la
excepción) y `:67-73` (**200** con `{"kpis":null,"acred":null,"anomalias":null}`) ·
`src/app/dashboard/chat.tsx:25,28,34` · `src/app/dashboard/rail.tsx:58,107,112-131`.
El gate de rol está cerrado (`2fb1982`, verificado en el árbol). Lo que queda:
(a) la autorización de la pieza más visible del panel descansa en **una sola** capa;
(b) `null` significa ya **tres cosas** que se renderizan idénticas — "no hay datos",
"no se pudo leer" y "tu rol no puede ver el dinero" —, así que el contralor teclea
"¿cuánto llevo comprobado?" y lee **«Todavía no hay liquidaciones»** sobre una flota
con 40 cerradas; (c) si el que falla es `detectarAnomalias`, el ternario cae al recuadro
**verde** de "todo bien" que el propio comentario de `rail.tsx:110-111` dice que
entrena a ignorar; (d) el rail repite `getKpis` + `getAcreditables` +
`detectarAnomalias` en las 20 páginas, incluidas las 6 que no pintan un peso.
**Reproducción:** el handler devuelve 200 con nulos → prueba de contrato del status
(503 o un campo `error` discriminado); `chat.tsx` con `kpis: null` y `motivo:'error'`
→ esperar que **no** afirme sobre el negocio.

#### G-26 · [ARREGLABLE] Tres rutas clasificadas como "operación" enseñan pesos de la flota · dominio: D3 (owner de `visibilidad.ts`) · severidad: ALTO
Reportado por: seguridad (NUEVO).
`src/lib/auth/visibilidad.ts:67,71,74` (`AREA_POR_RUTA` pone `/dashboard/viajes`,
`/analitica` y `/documentos` en `'operacion'`) · `dashboard/viajes/page.tsx:48,76,118`
("Anticipo en viajes abiertos" + columna por viaje) · `analitica/page.tsx:89`
("Gasto por concepto · Todo el histórico de la flota") · `documentos/page.tsx:124`.
La contradicción está escrita en el repo: `despacho/page.tsx:36-39` declara del mismo
rol *«NO hay una sola cifra de dinero en esta pantalla, y no es un descuido»*, y el
link de al lado en su propio sidebar la lista y la suma.
**Reproducción:** `visibilidad.test.ts` ya tiene el andamio de la tabla pura. Prueba
nueva: ninguna ruta de área `'operacion'` puede renderizar un componente de dinero —
se ancla con una lista explícita de rutas que sí lo hacen, y `puedeVerArea` decide.
El arreglo es reclasificar las tres a `'dinero'` (y, si el encargado necesita ver
viajes, partir la pantalla). **Cross-domain:** el mapa es de D3 y decide todo; D1 y D5
no tocan `visibilidad.ts`.

#### G-27 · [ARREGLABLE] `/dashboard/mapa` y `/dashboard/soporte` no llaman a ninguna guarda, y el sidebar les sale vacío al rol que no debería estar ahí · dominio: D5 · severidad: MEDIO
Reportado por: frontend (MEDIO), seguridad (BAJO), arquitectura (BAJO).
`src/app/dashboard/soporte/page.tsx:6` · `src/app/dashboard/mapa/page.tsx:6` — las dos
únicas de las 22 sin `resolverTenantEfectivo` ni `exigirVerRuta` ·
`src/lib/auth/guard.ts:69-78` (cuyo docstring dice que existe **exactamente** para los
stubs) · `src/app/dashboard/layout.tsx:19-20` (la única puerta: "¿hay sesión?").
Un chofer con sesión teclea la URL: el logo, un badge que dice **OPERADOR**, un `<nav>`
totalmente vacío y la página de Soporte. No hay fuga de datos (las dos son estáticas),
pero es un estado que la UI no sabe pintar y el rol que no debería estar ahí es el que
lo ve. Sus cuatro hermanas (`clientes`, `cobranza`, `cotizador`, `rentabilidad`) sí la
llaman.
**Reproducción:** prueba estructural — toda `page.tsx` bajo `src/app/dashboard/` debe
llamar a una de las tres guardas. Falla hoy con dos archivos.

#### G-28 · [NO REPRODUCIBLE AQUÍ] La RLS del chofer cubre 3 de 7 tablas, el contador escribe en 10, `app_user.operador_id` no lleva tenant, y las siete FK de la 0047 van a `(id)` a secas · dominio: D5 · severidad: CRÍTICO + ALTO ×3
Reportado por: seguridad (CRÍTICO + ALTO), datos (ALTO ×3 + MEDIO).
`supabase/migrations/0045_rls_operador.sql:39` (el `foreach` solo recorre
`viaje, gasto, liquidacion`) · `0001_init.sql:110-116` (las siete) · `0003:24`
(`llm_costo`), `0009:15` (`cfdi_xml`) · `0045:20-21,31-34,52-59`
(`app_user.operador_id` FK simple; `get_user_operador_id()` no compara tenants) ·
`0047:167-185` (el contador nace con `for all` sobre las cuatro tablas nuevas: son
diez) · `0047:65,76,100-101,106,130-131` (FK sin `tenant_id`) y `:151`
(`pod_viaje_unico` **única global**: una fila de POD de la flota A bloquea para siempre
el POD de un viaje de la flota B, invisible para las dos) · `0047:190-191`
(`operador_sube_su_pod` no mira `tenant_id`, ni `estado`, ni que el archivo exista:
el chofer declara entregada su carga con `storage_path='x'`).
**Por qué no aquí:** son policies y grants. Verificarlos exige `set local role
authenticated` contra Postgres. El bloque 26 de `verificaciones.sql` solo **cuenta
filas visibles** y nunca intenta escribir.
**PR #7 cubre parte:** `abbf9e8` (la RLS del chofer cubre las 7, mig. 0046 de esa rama),
`9f053e3` (el contador, mig. 0048), `aff7f63` (`operador_id` con tenant). **Lo de la
0047 es nuevo de `master` y no está en ningún lado.**

#### G-29 · [NO REPRODUCIBLE AQUÍ + DECISIÓN HUMANA] El bucket `avatares` es público, sin tope de tamaño ni de MIME, escribible por cualquier autenticado, y la cara del usuario no está en el catálogo de ningún aviso ni tiene camino de borrado · dominio: D5 · severidad: CRÍTICO
Reportado por: legal (CRÍTICO), seguridad (MEDIO), datos (ALTO).
`supabase/migrations/0046_perfil_avatar.sql:17-19` (`insert into storage.buckets` con
**tres** columnas: `file_size_limit` y `allowed_mime_types` quedan `null`) · `:28-30`
(`avatares_propio_insert` — la única condición es la **carpeta**) · `:42-45`
(`for select to public`, que además permite **enumerar** el bucket: listar todos los
`auth.uid()` y bajar cada foto) · `:32-35` (`avatares_propio_update` sin `with check`).
Un `operador` de cualquier flota sube `aviso.html` de 2 GB con el `Content-Type` que
elija, servido sin sesión bajo el dominio del proyecto — el sitio ideal para un
phishing dirigido a los propios operadores. Y `grep -rn "deleteUser\|storage.*remove"`
sobre `src/` → **cero**: el aviso publica un plazo de conservación de un año que ningún
mecanismo puede cumplir.
**Por qué no aquí:** la migración exige base. **Y qué decidir:** si el bucket es
público (URL firmada vs. render barato) y qué dice el aviso son decisiones de producto
y legales, no de código. La validación del server action sí es arreglable → **G-33**;
el catálogo del aviso → **G-54**.

---

### BLOQUE E · Fallos que no dejan una línea

#### G-30 · [YA ARREGLADO EN EL PR #7 + residual ARREGLABLE] `getSessionTenant` detecta el error y no corta, tira el `error` de `auth.getUser()`, y pide dos columnas que nacen en la 0045 y la 0046 sin que ninguna sonda las mire · dominio: D3 · severidad: CRÍTICO
Reportado por: backend (ALTO), operabilidad (ALTO REINCIDENTE), datos (CRÍTICO REINCIDENTE agravado).
`src/lib/auth/session.ts:31` (`const { data: { user } } = await sb.auth.getUser()` —
`auth-js` **no lanza**: devuelve `AuthRetryableFetchError` por valor, así que el `for`
de `:28` no reintenta y no se emite una sola línea) · `:33`
(`.select('tenant_id, rol, nombre, operador_id, avatar_url')`) · `:40-48`
(el `if (error)` **no hace `return`**: `rol: ?? 'flota_admin'` no es un default, es una
invención) · `src/lib/cuadra/startup.ts:65-230`
(`grep "0044\|0045\|0046\|0047"` → **cero**) y `:222` (`{ok: true}`).
Si el deploy de Vercel llega antes que la migración —que es el orden por default,
porque el push a `master` redespliega solo— PostgREST responde `42703 column
app_user.avatar_url does not exist` para **todos**: el contralor y **Javier** acaban en
`/sin-acceso` con un texto que les dice que pidan su alta, mientras el arranque escribió
`{ok:true}`. El único rastro es un `warn`.
**PR #7:** `3dccbaf` (el bache de Auth deja de leerse como "nunca inició sesión"),
`3a38488` (la 0045 se sonda al arranque + reintento por `esColumnaAusente`).
**Residual ARREGLABLE:** la sonda de la **0046** y la **0047** es nueva y hay que
escribirla igual (`startup.ts` es de D3).

#### G-31 · [YA ARREGLADO EN EL PR #7] `/auth/callback` y `/login` no escriben una línea cuando el login falla, y `proxy.ts` corre en el 100% del tráfico autenticado sin importar el logger · dominio: D3 · severidad: CRÍTICO ×2 + BAJO
Reportado por: operabilidad (CRÍTICO ×2 + ALTO), backend (BAJO).
`src/app/auth/callback/route.ts:15-37` (el `if (!error)` de `:19`, el `catch {}` de
`:31-35` — que además impide que `onRequestError` lo vea — y el redirect mudo de `:37`)
· `src/app/login/page.tsx:95-100` (la única llamada a `logger` cubre el caso
**inocuo**: un correo sin cuenta; el caro —Resend 403, SMTP caído, `redirectTo`
rechazado— sale por el `redirect` de `:96` sin tocar el logger) y `:64` (Google igual)
· `src/proxy.ts:59` (`const { data: { user } } = …`, y el archivo entero no importa
`@/lib/logger`).
El repo ya sabe que el remitente es el sandbox de Resend y solo entrega a una
dirección. El contralor teclea su correo, ve *"Algo falló. Intenta otra vez."* y genera
**cero evidencia**; al décimo intento el rate-limit lo corta con el mismo mensaje.
**PR #7:** `31276b2`, `406a565`. `login/page.tsx` **sí conflictúa** (los dos lados lo
tocaron) — resolver ese hunk es trabajo de merge, no de reescritura.

#### G-32 · [ARREGLABLE] Dieciséis copias del mismo `catch` vacío se tragan todos los errores de lectura del panel, incluida la página del dinero, y apagan `onRequestError` · dominio: D1 (owner del contrato) · severidad: CRÍTICO
Reportado por: operabilidad (CRÍTICO), arquitectura (MEDIO).
Quince archivos bajo `src/app/dashboard/` (verificado con `grep -rln "async function safe<T>"`)
más `src/app/api/dashboard/asistente/route.ts:56-58`. Todas idénticas byte a byte:
```ts
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}
```
El caso más caro es `cuadre/page.tsx`: `getLiquidaciones` **lanza a propósito** en
`:31` —el CRÍTICO de la auditoría 5, los paneles que decían "12 viajes liquidados" con
la base caída— y once líneas más abajo el `safe()` de `:43` se come ese throw. La
intención sobrevive de cara al usuario y muere de cara al operador del sistema: de todo
`src/app/`, solo **seis** archivos importan `@/lib/logger`, y ninguna de las 20 páginas
de `/dashboard` ni de las ~30 de `/admin` está entre ellos.
**Reproducción:** `safeLog()` en `src/lib/cuadra/pg.ts` que registre y devuelva `null`,
más un grep-test que falle si aparece `catch { return null }` fuera de ese archivo.
**Cross-domain:** owner **D1** (escribe el helper y corrige sus 11); D5 sustituye sus 4
copias y D3 la del handler cuando D1 publique.

#### G-33 · [ARREGLABLE] `/admin/mi-perfil` afirma "guardado" con el `error` descartado, y la primera subida de archivo del producto no valida tipo ni tamaño · dominio: D6 · severidad: ALTO
Reportado por: operabilidad (ALTO), seguridad, datos, legal.
`src/app/admin/mi-perfil/page.tsx:38` (`update({nombre})` sin `error`, sin log), `:39`
("Nombre guardado."), `:44-52` (el server action solo comprueba
`archivo instanceof File && archivo.size !== 0`: ni tipo, ni tamaño, y pasa
`contentType: archivo.type` **tal cual del cliente**), `:48` (la extensión sale de
`archivo.name.split('.').pop()`, así que un `.png` no pisa el `.jpg` anterior y queda
un objeto público huérfano), `:51` (redirect sin log), `:56` (segundo `update` sin
`error`) · `avatar-uploader.tsx:56` (`accept="image/*"` es del navegador) ·
`src/app/admin/mi-perfil/page.tsx:9` (`ROL_LABEL` copiado perdiendo el
`Record<RolAppUser,…>` que lo hacía exhaustivo) · `:31` (rompe la frontera que la
ronda 10 verificó intacta: `/admin` importaba **solo** de `@/lib/admin/negocio`).
Con la 0046 sin aplicar, la pantalla dice **"Foto de perfil actualizada."** y en la
siguiente carga vuelve el círculo con la inicial. Sin log, el síntoma que se reporta es
"se borra sola".
**Reproducción:** ejercer el server action con el cliente mockeado devolviendo
`{error}` → esperar que no redirija a `?ok=`; y un caso con `archivo.type = 'text/html'`
→ esperar rechazo. `ROL_LABEL` se cierra con `tsc` cambiando el tipo.

#### G-34 · [ARREGLABLE] La suplantación de tenant no deja una línea, y si la consulta falla cambia de flota en silencio — también en las cuatro escrituras · dominio: D3 (owner) · severidad: ALTO
Reportado por: arquitectura (ALTO), operabilidad (ALTO), seguridad (MEDIO), legal (ALTO).
Cuatro rubros, un defecto, ocho copias:
`src/lib/auth/tenant-efectivo.ts:67-73` · `dashboard/despacho/page.tsx:68` ·
`incidencias/page.tsx:53` · `pod/page.tsx:52` · `unidades/page.tsx:53` ·
`dashboard/[id]/page.tsx:53` y `:77` · `api/dashboard/asistente/route.ts:40`.
Las ocho son la misma línea y las ocho **descartan el `error`** — el patrón que
`pg.ts:9-21` llama "la familia de bugs más repetida del repo" y que `exigir()` existe
para cerrar. El encabezado de `tenant-efectivo.ts:1-2` dice, textual: *«un solo lugar,
no 20 copias»*.
Con un 503 transitorio: `data = null`, el `if` no entra, y la función devuelve el
tenant de la sesión, que para un superadmin es el **demo**. Cuatro de las ocho copias
están **dentro de server actions que escriben**: el viaje que Javier crea delante del
contralor aterriza en el tenant demo, la píldora verde dice *"Viaje creado"*, y el
badge que decía de qué flota se hablaba solo existe en Inicio.
Y `grep "logger\." src/lib/auth/` devuelve tres líneas, todas en `session.ts`:
`tenant-efectivo.ts` **ni siquiera importa el logger**, así que a la pregunta "¿quién
de ustedes vio mis liquidaciones el martes?" no hay respuesta.
**Reproducción:** `resolverTenantDeAction()` con el cliente mockeado devolviendo
`{data:null, error}` → esperar que **lance** (no que caiga al demo) y que registre.
**Cross-domain:** owner D3; D1 y D5 sustituyen sus copias.

#### G-35 · [DECISIÓN HUMANA + ARREGLABLE] El CI de `master` lleva rojo desde el 3-ago y el paso de Build no ha corrido una sola vez sobre el código del demo · dominio: D6 · severidad: CRÍTICO
Reportado por: operabilidad (CRÍTICO).
`.github/workflows/ci.yml:67-68` · `vitest.config.ts:88-93` (`lines: 78`,
`statements: 78`, `functions: 83`).
Reproducido aquí: `npm run test:coverage` → exit 1, **1668 pruebas pasan** y lo que
falla es el trinquete (64.05% de líneas contra 78). Como el trinquete vive **dentro del
mismo paso** que las pruebas, GitHub salta los dos siguientes: las pruebas de tiempo
(la guardia de ReDoS y la de crecimiento no lineal del deduplicador) y el **Build**,
cuyo comentario dice que ya cazó un fallo real que solo aparecía ahí — *Turbopack no
resolvía el `.wasm` del lector de códigos*, que es el que lee el código de barras de
los tickets del demo. El mensaje del commit `5fcfb38` afirma "build limpio" y su CI
terminó en `failure` 100 segundos después; se siguió pusheando cinco veces ese día.
**Lo ARREGLABLE hoy (sin decidir nada):** separar el trinquete de cobertura a su propio
paso, para que una regresión de prueba y "entró código sin prueba" dejen de producir el
mismo rojo, y que **Build siempre corra**.
**Lo que es DECISIÓN HUMANA:** el umbral. Subirlo exige escribir pruebas para las
~9,700 líneas nuevas de UI; bajarlo es apagar el medidor. Ninguna de las dos es un
arreglo quirúrgico de madrugada.

#### G-36 · [DECISIÓN HUMANA + ARREGLABLE] `NEXT_PUBLIC_APP_URL` tiene cuatro valores según dónde se lea, el script la fija a la URL efímera del deploy, y el arranque solo comprueba que exista · dominio: D3 · severidad: ALTO
Reportado por: operabilidad (ALTO).
`CLAUDE.md:64-66` (`https://app.likida.ai`) · `DEPLOY.md:3,14,124`
(`https://likidaai.vercel.app`) · `src/app/login/page.tsx:11` (`https://likida.ai`) ·
`scripts/deploy-vercel.sh:47-51` (lo que imprima `vercel --prod --yes`, que es la URL
**por deploy**, no el alias) · `src/lib/observability/arranque.ts:55`
(`!process.env[v.nombre]` — presencia, **no valor**).
Si el host no está en las *Redirect URLs* de Supabase, GoTrue ignora el
`emailRedirectTo`, el navegador va a otro dominio y **Likida nunca recibe esa
petición**: no hay log que pueda existir. Y `startup.config_silenciosa` sale `ok:true`
— el semáforo que `GUION_DEMO.md:29` manda mirar como paso 3 antes de entrar a la sala
va a estar en verde con el login roto. La última línea del script es un `echo`
recordando redesplegar: un recordatorio impreso, no un paso.
**ARREGLABLE aquí:** que `arranque.ts` valide el **valor** (host esperado, `https`,
sin sufijo de deploy) y que el script deje de escribir la URL efímera.
**DECISIÓN HUMANA:** cuál de los cuatro es el bueno, y alinear el Site URL de Supabase.

#### G-37 · [YA ARREGLADO EN EL PR #7] `DASHBOARD_PASSCODE` grita una consecuencia falsa —y ahora hay una prueba que la fija—, y `/acceso` sigue publicada sin autorizar nada · dominio: D3 · severidad: MEDIO
Reportado por: operabilidad (MEDIO REINCIDENTE), arquitectura (MEDIO REINCIDENTE), seguridad (BAJO REINCIDENTE).
`src/lib/observability/arranque.ts:13-14,33` (`{nombre:'DASHBOARD_PASSCODE',
consecuencia:'proxy.ts no bloquea /dashboard'}` — `proxy.ts` no menciona la variable en
ninguna línea) · `src/lib/observability/runbook.test.ts:100` (**exige por prueba** que
`DEPLOY.md` la siga nombrando: el guardarraíl que existía para que el runbook no
mintiera obliga hoy a que mienta) · `src/lib/auth/passcode.ts:1-252` (252 líneas y 19
tests; `tokenMatches` y `hayPasscode` con cero consumidores) · `src/app/acceso/page.tsx:9-35`
(segunda pantalla de login, con otro branding, que emite una cookie que nadie lee).
Quien quite la variable —lo correcto— hace que cada arranque en frío emita un `error` a
Sentry en el **mismo cubo de `msg`** que el aviso real de `NEXT_PUBLIC_APP_URL`.
**PR #7:** `26dc5d0`, `7b1efe6`, `9d1b9b1`.

#### G-38 · [YA ARREGLADO EN EL PR #7] Una máquina limpia no queda corriendo, y el runbook nombra los mensajes de arranque equivocados · dominio: D3 · severidad: MEDIO + BAJO
Reportado por: operabilidad (MEDIO REINCIDENTE + BAJO).
`README.md:70-77` (no menciona migraciones ni seed, ni el script `setup` que sí existe
en `package.json:13`; sigue titulándose "Cuadra" y describiendo un portal que no
existe) · `supabase/seed.sql` (`grep app_user` → **cero filas**) ·
`src/app/login/page.tsx:87` (`shouldCreateUser: false`) ·
`src/app/admin/usuarios/nuevo/page.tsx` (empieza con `requireSuperadmin()`) — o sea que
no hay ningún camino de alta del primer usuario · `DEPLOY.md:34-39` (nombra
`startup.entorno`, que solo cubre `DASHBOARD_SECRET`, y **omite**
`startup.config_silenciosa` y `startup.entorno_grupos`, que son los que el guion del
demo usa como semáforo).
**PR #7:** `518e1eb` (bootstrap del primer superadmin), `dfc2c8b`.

---

### BLOQUE F · El costo de IA y la consola interna

#### G-39 · [YA ARREGLADO EN EL PR #7] La atribución modelo↔tokens tras el fallback miente en los tres caminos, y `parcial`/`ocr` se pintan como proveedores · dominio: D6 · severidad: ALTO
Reportado por: tool-calling (ALTO + BAJO, REINCIDENTES).
`src/lib/llm/openrouter.ts:329` (éxito: `model` del último intento junto al consumo
acumulado de todos), `:339` (error: modelo **primario** con consumo del fallback),
`:537` (`used = res.model || activeModel`), `:394-415` (`PartialExecutionError` sin
modelo, aunque `used` y `activeModel` están en alcance en el `catch` de `:603`),
`:98-101` (el sufijo `:nitro`/`:floor` se normaliza para el **precio** y no para la
identidad, así que Model Ops enseña dos renglones del mismo modelo) ·
`processor.ts:1200` (`modelo: 'parcial'`) · `intake/ocr.ts:281` (`'ocr'`) ·
`admin/page.tsx:195-208`.
Cinco rondas con Sonnet y dos con el fallback escriben **una** fila que dice que
gpt-5.6-terra consumió 6,700 tokens de entrada; 4,800 fueron de Anthropic.
**PR #7:** `6beb677`, `917f8e8`, `bf89b70`, `e5cf48a`. `src/lib/llm/` es **byte-idéntico**
entre `master` y el árbol base → cherry-pick sin conflicto.

#### G-40 · [ARREGLABLE] `negocio.ts` lee cinco tablas sin paginar, sin `order` y sin techo: el gasto en IA se congela en la fila 1,000, y `round2` imprime `$0.00 · 1 llamadas` · dominio: D6 · severidad: ALTO
Reportado por: tool-calling (ALTO NUEVO + MEDIO NUEVO), rendimiento (ALTO REINCIDENTE), backend (MEDIO REINCIDENTE).
`src/lib/admin/negocio.ts:62-65` (las cuatro consultas), `:189` (la quinta, sobre
`llm_costo`), `:145,163,171` (los agregados), `:113,200` (`round2` sobre dólares de
costo unitario de IA) · `src/app/admin/layout.tsx:42` (vive en el **layout**: corre en
las ~30 páginas) · contra `src/lib/cuadra/pg.ts:28-38`, que declara este borde
textualmente, y `analytics_paginacion.test.ts`, que tiene una prueba entera para él.
Cada liquidación escribe ~19 filas de `llm_costo`; la tabla pasa las 1,000 alrededor de
la liquidación #46. Sin `.order()`, PostgREST entrega el primer bloque del plan —para
una tabla append-only, las **más viejas**— así que `porDia` deja de tener días
recientes, `tendencia()` devuelve `null` y **la flecha simplemente desaparece en vez de
gritar**. Es el modo de fallo que `costos.ts:5-13` llama el peligroso: "bajó sola y
nadie lo notó". Y `round2` sobre `$0.0027` da `$0.00`: la comparación "¿me sale más
barato Gemini o Haiku?" no se puede hacer en la pantalla que existe para hacerla.
**Reproducción:** mock con 1,001 filas (el patrón de `analytics_paginacion.test.ts` ya
existe); y `getCostoPorFaseModelo` con $0.0027 → esperar `round6`.
**PR #7 tiene `01ed442` y `a06f83c`, pero `negocio.ts` es uno de los 21 archivos que
`master` también tocó (+21 líneas de `ventanaDias`)** → hay que reescribirlo o resolver
el hunk a mano.

#### G-41 · [ARREGLABLE] Los envíos de WhatsApp se cuentan como "acciones resueltas por los agentes", y los comprobantes descartados como "amarrados a su viaje" · dominio: D1 · severidad: ALTO
Reportado por: agéntico (ALTO), tool-calling (MEDIO NUEVO).
`src/lib/cuadra/analytics.ts:308` (`huerfanos.filter(h => h.resuelto_en !== null)` — la
columna que distingue los dos desenlaces es `resolucion`, `'adjuntado' | 'descartado'`,
y la consulta no la mira) · `:283-293,310` (`accionesPorAgente` cuenta filas de
`llm_costo` por `fase`) · `src/lib/cuadra/costos.ts:86-88`
(`registrarCostoWhatsApp` escribe una fila por **mensaje saliente**, con `tokensIn: 0`
y `modelo: 'whatsapp-utility'`) · `src/app/dashboard/valor-ahorro/page.tsx:51,83-85,120-122,170-176`.
El chofer contesta «no» a 6 comprobantes por $16,244 y el contralor lee **«Llegaron sin
viaje: 6 · Amarrados a su viaje: 6»** con la nota *"acabaron en su liquidación"* — no
están en ninguna. Y el KpiTile dice **19 acciones resueltas por los agentes**, de las
cuales 10 consumieron 0 tokens; la barra más larga es **"Agente de WhatsApp"**, por
delante del OCR y del cuadre. Es la pantalla que el propio código declara *"la más
fácil de convertir en mentira"*, y las dos cifras se caen en la primera pregunta.
**Reproducción:** `getValorAhorro` con filas `resolucion:'descartado'` y con
`fase:'whatsapp'` → esperar que no se cuenten. Funciones puras sobre el mock.

#### G-42 · [ARREGLABLE + DECISIÓN HUMANA] El precio de Sonnet 5 es una tarifa introductoria que caduca 25 días después del demo, con la vigencia guardada en un comentario; el costo por liquidación excede su presupuesto 2.4× solo con el OCR · dominio: D6 · severidad: MEDIO + ALTO
Reportado por: tool-calling (MEDIO NUEVO), rendimiento (ALTO + MEDIO REINCIDENTE + BAJO).
`src/lib/llm/openrouter.ts:87` (`'anthropic/claude-sonnet-5': [2, 10], // intro VIGENTE
hasta 31-ago-2026`) · `:106-120` (`PRICES` es la **única** fuente; nadie reconcilia
jamás contra un importe del proveedor) · `src/lib/llm/models.ts:17`
(`$0.03–0.05 / liquidación`) · `processor.ts:503,506` ($0.015 por visión, una por foto)
· `api/webhook/whatsapp/route.ts:68` ("un lote de 8") · `openrouter.ts:50`
(`DEFAULT_MAX_TOKENS = 4000`), `:476` (`maxRounds = 6`) ·
`grep -rn "cache_control\|prompt_cache" src/` → **0**.
Aritmética con las constantes del propio repo: 8 fotos × $0.015 = **$0.12**, o sea
**2.4× el techo declarado, antes de que el agente gaste un token**. Peor caso sumado
≈ **$0.49 → 10-16×**. Y el 1-sep, cuando Anthropic revierta a $3/$15, todas las filas
se van a registrar con un **50% de subestimación** sin una línea de aviso, mientras
`llm.modelo_sin_precio` sí grita cuando el modelo es desconocido.
**ARREGLABLE hoy:** una prueba que falle a partir del 31-ago-2026 si `PRICES` no se
actualizó (la vigencia deja de ser un comentario), y `cache_control` sobre el prefijo
invariante de 1,200 tokens.
**DECISIÓN HUMANA:** el número de `models.ts:17`. El dato para cerrarlo **ya se está
guardando** (`llm_costo.tokens_in/costo_usd`); nadie ha hecho la división.
**PR #7:** `120f19a` (la foto que paga tokens deja de ir a resolución nativa).

#### G-43 · [YA ARREGLADO EN EL PR #7] El registro de tools cuelga de un import por efecto secundario y no tiene prueba; las dos tools que deciden qué ley se cita no tienen arnés; el fallback del OCR llega tarde y sin prueba · dominio: D6 (+ `tools.ts` a D4) · severidad: MEDIO ×3
Reportado por: tool-calling (3 REINCIDENTES).
`src/lib/cuadra/processor.ts:9` (`import '@/lib/cuadra/tools';` — **una línea**; `run.ts`
no lo importa) · `src/lib/agents/registry.ts:21` · `src/lib/llm/tool-executor.ts:35-39`
(`toolSchemas` descarta en silencio lo que no encuentra) ·
`grep -rn "toolSchemas\|AGENT_REGISTRY" src --include=*.test.ts` → **vacío** ·
`grep -rn "executeTool(" src --include=*.test.ts` → **una sola línea** ·
`permiso_politica.test.ts:32-44` (**copia el cuerpo** de `tools.ts:65-74`, carácter por
carácter, en vez de reconstruir la forma) · `openrouter.ts:345-379` (tras el fallo
transitorio ejecuta una **segunda** llamada completa al mismo proveedor caído, con la
imagen adjunta, antes de mirar el fallback: ~4.4 s tirados por foto).
Un linter "de imports sin uso" que se lleve `processor.ts:9` deja `REGISTRY` vacío,
ningún viaje cierra, y `tsc`, `eslint` y las 1,670 pruebas salen en verde.
**PR #7:** `c8caec2`, `cae6ee7`, `4a5d9a6`.

#### G-44 · [YA ARREGLADO EN EL PR #7] `guardar_liquidacion` devuelve 12.5 KB al modelo para que use 153 bytes, con 24 RFC dentro, y `fechaRaw`/`codigoBarras` viajan sin sanear · dominio: D4 · severidad: MEDIO ×2
Reportado por: tool-calling (2 REINCIDENTES, uno remedido hoy).
`src/lib/cuadra/tools.ts:209` · `src/lib/llm/openrouter.ts:595` (`JSON.stringify(exec.result)`
empujado a `convo` como `role:'tool'`) · `src/lib/cuadra/intake/ocr.ts:404,418` ·
`src/lib/cuadra/intake/cfdi.ts:251`.
~3,100 tokens de entrada extra en cada ronda posterior al cierre (12-20% del objetivo
de `models.ts:17`, gastados en datos que el modelo no lee), y un PDF417 que codifique
1,100 caracteres de texto libre entra al contexto en el turno que cierra el dinero.
**PR #7:** `1d65a92` (el snapshot va al llamador y un resumen de 132 bytes al modelo),
`de00f96`.

#### G-45 · [YA ARREGLADO EN EL PR #7] Seis menores del gateway: `isTransientError`, tres roles muertos, `.args`, `ctx.signal`, el `error.message` de Postgres al modelo, la ronda 6 del loop-guard · dominio: D6 · severidad: BAJO ×6
Reportado por: tool-calling (6 REINCIDENTES).
`openrouter.ts:73-80` (la ventana 400-599 del offset del `SyntaxError` se lee como
proveedor caído y dispara una tercera llamada de visión pagada) · `models.ts:29,40,42,44,50,64`
(de los cinco `ModelRole` solo `ocr` y `cuadre` corren; `orchestrator` nunca se ejecuta
y `generateResponse` no tiene un solo llamador, así que la fase `'escalacion'` es
inalcanzable y `valor-ahorro/page.tsx:12-14` mapea etiquetas para tres agentes que no
existen) · `openrouter.ts:582,594` · `tool-executor.ts:18,60` · `openrouter.ts:528-600`.
**PR #7:** `6fa4fed`, `eace503`, `3f58e3b`, `9bb0d01`, `a985540`, `c99c32a`, `6a30ea5`.

---

### BLOQUE G · Duplicación y guardarraíles que dejaron de guardar

#### G-46 · [ARREGLABLE] `FASE_LABEL` pasó de cuatro copias a cinco, y la quinta cruzó al panel del cliente · dominio: D6 (+ `dashboard/valor-ahorro/page.tsx` a D1) · severidad: ALTO
Reportado por: arquitectura (ALTO REINCIDENTE, empeorado).
`src/app/admin/page.tsx:19` · `admin/analitica/page.tsx:11` ·
`admin/costos-facturacion/page.tsx:12` · `admin/model-ops/page.tsx:29` (con **tres**
claves de seis, igual que en la ronda 10) · `src/app/dashboard/valor-ahorro/page.tsx:12`
· contra `src/lib/cuadra/costos.ts:41` (`FaseCosto`, la verdad).
**Ninguna de las cinco** está tipada `Record<FaseCosto, string>`: las cinco son
`Record<string, string>`, así que `tsc` no ve nada. Una séptima fase pinta la clave
cruda en la dona de `/dashboard/valor-ahorro`, que es la pantalla que existe para
justificarle el precio al contralor.
**Reproducción:** exportar el mapa desde `costos.ts` tipado contra la unión — `tsc`
caza a los cinco. **PR #7 tiene `7bbaa31`, pero la quinta copia es nueva de `master`.**

#### G-47 · [ARREGLABLE] "Ver como" vive en tres sitios con tres reglas distintas, y ya funciona en 1 de 17 páginas · dominio: D1 (owner) + D5 (4 páginas) · severidad: ALTO
Reportado por: arquitectura (ALTO), frontend (MEDIO).
`src/app/dashboard/sidebar-nav.tsx:73-88` (cliente: arrastra `tenant`, `vista` **y
`rol`**) · `src/app/dashboard/sufijo.ts:7-17` (servidor: arrastra `tenant` o `vista`,
**no conoce `rol`**, y su comentario afirma *"Misma regla, dos fuentes de entrada"*) ·
`src/lib/auth/tenant-efectivo.ts:44` (`rolEfectivo(sesionReal.rol, sp?.rol)`).
De las 17 páginas que llaman a `resolverTenantEfectivo`, **solo `dashboard/page.tsx:291`
declara `rol?: string`** en el tipo de `searchParams`; las otras 16 lo tipan
`Promise<{vista?: string; tenant?: string}>`, así que `sp.rol` es `undefined` y
`rolEfectivo` devuelve siempre el rol REAL. `tsc` no ve nada: pasar un objeto sin `rol`
a un parámetro con `rol?` es legal. Javier abre `/dashboard?rol=encargado`, hace clic
en "Viajes", y la página corre con privilegios de superadmin mientras el sidebar de esa
misma pantalla sigue filtrado — media pantalla previsualiza y media no. Y
`analitica/page.tsx:115` es el único link desnudo del panel: pierde hasta `?tenant=`, y
`resolverTenantEfectivo` cae al tenant **demo** con los folios y montos de otra empresa
bajo el mismo encabezado.
**Reproducción:** un tipo compartido `SearchParamsPanel` y una prueba estructural que
exija que toda página que llame a `resolverTenantEfectivo` lo use. Falla hoy con 16.

#### G-48 · [ARREGLABLE] Dos páginas declaran inexistentes tres tablas que la 0047 creó, con sus pantallas vivas dos renglones más arriba en el mismo menú · dominio: D5 · severidad: ALTO
Reportado por: arquitectura (ALTO), frontend (MEDIO).
`src/app/dashboard/viajes/page.tsx:131-136` (*"no existen en el sistema: `viaje` no
guarda unidad, no hay tabla de vehículos, no hay campo de POD"*) ·
`src/app/dashboard/soporte/page.tsx:17-18,26` (*"Las incidencias de un viaje tampoco
tienen dónde vivir"*, y las lista como funcionalidad futura) ·
`src/app/dashboard/pendiente.tsx:8-9` (el docstring repite el error) · contra
`supabase/migrations/0047:31,65,97,127` — cuyo **propio encabezado cita
`viajes/page.tsx:130-137` textualmente** como su razón de existir — y contra
`dashboard/despacho/page.tsx:217-220`, que dice lo contrario.
Estos recuadros son el activo de credibilidad del panel: *"prefiero enseñarte un hueco
honesto que cifras de ejemplo"*. Un hueco que ya no es hueco convierte esa declaración
en una más que hay que verificar, y el comprador que le cree descarta tres funciones
que sí tiene.
**Reproducción:** el texto de "qué falta" no deriva de nada verificable. La prueba es
un grep-test: ninguna cadena de `EstadoVacio`/`SeccionPendiente` puede nombrar una
tabla que exista en `supabase/migrations/`.

#### G-49 · [ARREGLABLE] Deuda estructural medible: el acceso directo a la base fuera de `repo.ts` pasó de 67% a 80%, tres funciones exportadas no tienen consumidores, el guardarraíl de `round2` cuenta declaraciones · dominio: D6 · severidad: MEDIO + BAJO ×2
Reportado por: arquitectura (MEDIO REINCIDENTE + BAJO ×2).
**129 sitios** de `.from('`/`.rpc('` con literal, 26 en `repo.ts` → **103 fuera (80%)**,
de los cuales **19 están en `src/app/`**. `operacion.ts` no es el problema (usa
`traerTodo`/`exigir`, comprueba `error` y acota por `tenant_id`); lo es
`dashboard/usuarios/page.tsx:23` (define `getUsuarios()` con `supabaseAdmin()` **dentro
del archivo de la página**) y `admin/mi-perfil/page.tsx:31,38,56`, que rompe la
frontera que la ronda 10 verificó intacta. `viaje` se toca desde **seis** módulos.
`getResumenCosto()` (`costos.ts:253`), `topeDescuento()` (`laboral/pagadero.ts:122`, que
formatea dinero con `toFixed(2)` — sin `$`, sin miles, fuera de `formato.ts`, y el
guardarraíl solo greppea `toLocaleString('es-MX'`) y `puedeAdministrar()`
(`permisos.ts:29`): cero consumidores.
`repo.ts:808` y `liquidacion/omitidos.ts:37` siguen con `Math.round(x*100)/100` inline.
**Reproducción:** una prueba que cuente los sitios y falle si sube; un grep-test que
vigile la **expresión** `Math.round(… * 100) / 100`, no el nombre `round2`.
**PR #7:** `cd2c1d2`, `e85422c`, `818dd6a`.

#### G-50 · [ARREGLABLE] `resolverTenantEfectivo` —el único chokepoint de autorización de las 20 páginas— no tiene una sola prueba · dominio: D3 · severidad: ALTO
Reportado por: arquitectura (la mitad verdadera del CRÍTICO descartado por falso).
`grep -rln "resolverTenantEfectivo" src/ --include=*.test.ts` → **vacío**.
La función pura que decide quién ve qué (`visibilidad.ts`) tiene 83 pruebas; el único
sitio donde se aplica no tiene ninguna. La demostración es incontestable y está medida:
el auditor de pruebas dejó `tenant-efectivo.ts:55` como `if (false && !puedeVerRuta(…))`
en el árbol de trabajo y **`vitest`, `tsc` y `eslint` salieron los tres verdes**
(`eslint` no marca los identificadores como sin usar porque siguen citados en la rama
muerta, y `no-constant-condition` no mira el operando izquierdo de un `&&`).
Cualquiera —una resolución de merge del PR #7, un `git checkout` a medias, un
refactor— puede borrar ese gate y desplegar verde el 6-ago.
**Reproducción:** una prueba que ejercite `resolverTenantEfectivo` con
`{rol:'encargado'}` y `destino:'/dashboard/rentabilidad'` → esperar `redirect`.
Es la prueba de mayor valor por línea de todo el plan.

#### G-51 · [DECISIÓN HUMANA + ARREGLABLE] Los ordinales 0046/0047 nombran migraciones distintas en las dos ramas: al mergear, la base se salta en silencio las dos de RLS del PR · dominio: D5 · severidad: CRÍTICO
Reportado por: datos (CRÍTICO), arquitectura (MEDIO).
`supabase/migrations/0046_perfil_avatar.sql` y `0047_operacion_encargado.sql` (este
árbol) contra `0046_rls_operador_resto.sql` y `0047_rls_operador_tenant.sql` (rama del
PR #7, que llega hasta `0053`) · `src/lib/cuadra/migraciones_verificadas.test.ts:78,93`
(identifica una migración por su **número**: `f.slice(0,4)` y
`new RegExp("\\b"+num+"\\b").test(TITULOS)`).
Los cuatro `.sql` tienen rutas distintas, así que git **no reporta conflicto** y los
cuatro aterrizan. Entonces: `\b0046\b` aparece en TITULOS, así que las **dos** 0046
cuentan como comprobadas y la garantía del bucket de avatares se queda sin verificar
con la suite en verde; y `supabase db push` aplica por `version` = prefijo numérico,
así que o bien las dos migraciones de RLS **nunca corren** (y el chofer conserva
escritura sobre la tabla de identidades de sus compañeros con el sistema afirmando que
la migración que lo cerraba ya se aplicó), o el push se corta a media serie.
**DECISIÓN HUMANA:** renumerar las del PR #7 a `0048`+ es trabajo de merge, y las dos
ramas además refactorizaron `/dashboard` de forma independiente.
**ARREGLABLE aquí y hay que hacerlo pase lo que pase:** que
`migraciones_verificadas.test.ts` falle ante **dos archivos con el mismo ordinal**. Es
la prueba que convierte este riesgo silencioso en un rojo.

#### G-52 · [ARREGLABLE] El panel corre sin un solo techo de consulta y sin `maxDuration`; `/dashboard/despacho` son 17 consultas por carga · dominio: D1 · severidad: ALTO + MEDIO
Reportado por: rendimiento (ALTO REINCIDENTE agravado + MEDIO ×2).
`src/lib/cuadra/analytics.ts`: **11 `supabaseAdmin()` / 0 `acotada`** ·
`src/lib/cuadra/pg.ts:40-51` (`traerTodo` **no importa `acotada`** — es el borde por el
que pasan todas las lecturas del panel) · `src/lib/cuadra/operacion.ts`: las 8
escrituras sí, las **6 lecturas** no · `grep -rn maxDuration src/` → **una sola ruta en
todo el repo**, el webhook · `src/app/dashboard/chrome.tsx:90` + `rail.tsx:58` (5
consultas más **por página**, en las 20) · `src/proxy.ts:59` + `src/lib/auth/session.ts:31,33`
(~900 ms de red serializada antes del primer dato de negocio, en cada navegación).
Con Supabase degradado: 300,000 (proxy) + 600,000 (sesión, en serie, con reintento) +
300,000 (la peor lectura) = **1,200,000 ms** para pintar una pantalla que no declara
`maxDuration`. Y `safe()` atrapa **excepciones, no esperas**: la página no pinta el
fallback para el que se diseñó, se queda en blanco hasta que la plataforma corta.
**Reproducción:** una prueba de contrato — que `traerTodo`/`exigir` pasen por `acotada`
(`presupuesto.ts` es de D4: se importa, no se edita), y un grep-test de `maxDuration`
sobre las rutas dinámicas. **PR #7:** `5e4c45c` (8 consultas del panel, 300 s → 9.5 s),
sobre un `analytics.ts` que **sí** conflictúa.

---

### BLOQUE H · Cumplimiento legal

#### G-53 · [YA ARREGLADO EN EL PR #7] `/admin` exhibe el teléfono y la transcripción íntegra de operadores identificables, cruzando flotas, para una finalidad que el aviso excluye por escrito · dominio: D6 · severidad: CRÍTICO
Reportado por: legal (CRÍTICO REINCIDENTE, agravado).
`src/lib/admin/negocio.ts:220-236` (`getConversacionesActivas` lee con `supabaseAdmin()`
**sin un solo `.eq('tenant_id', …)`** y devuelve `telefono`, `tenantNombre` y los
`turns` completos) · `src/app/admin/layout.tsx:42` (la llama en **cada carga de
cualquier página de `/admin`**) · `admin/conversaciones/page.tsx:47,67,83`
(un `HBars` cuya etiqueta de cada barra **es el teléfono del operador**, encima de dos
KPI de uso) · `admin/notificaciones/page.tsx:18` (consumidor **nuevo** de esta ronda) ·
`admin/page.tsx:267-286` · `agente-whatsapp/page.tsx:57-76` · `whatsapp-infra/page.tsx:105-124`
· contra `src/lib/cuadra/privacidad.ts:511-512`, el texto que el operador abre:
*"Medir cómo funciona el servicio para mejorarlo (**estadísticas de uso, sin
identificarte en los reportes**)"*.
Si en la misma sesión del demo se abre `/admin` y `/aviso/[tenant]`, las dos pantallas
se desmienten a un clic.
**PR #7:** `5b43fd8` (seudónimo estable y texto redactado). **Advertencia de merge:**
cinco de esas páginas están entre los 21 archivos que las dos ramas tocaron.

#### G-54 · [DECISIÓN HUMANA + ARREGLABLE] El aviso está congelado: no cubre la foto de perfil, el expediente por chofer, el correo ni la geolocalización de la 0047, y cita el art. 2 fr. XX donde va la fr. XII · dominio: D4 · severidad: CRÍTICO + ALTO ×2 + MEDIO + BAJO
Reportado por: legal (5 hallazgos).
`src/lib/cuadra/privacidad.ts` **sin una sola línea nueva** desde `cce7543`, mientras
entraban 50 commits y 11,578 líneas en `src/`.
- **Catálogo (art. 15 fr. II):** `privacidad.ts:495-497` dice *"tu nombre y tu número
  de teléfono"*; faltan la **fotografía** (mig. 0046), el **correo** —que
  `provisionar.ts:29` inserta en `app_user` y `negocio.ts:261` lee de ahí, mientras
  `dashboard/usuarios/page.tsx:38-41` afirma por escrito lo contrario ("vive en
  `auth.users`, no en `app_user`"), y mientras el código lo crea nadie lo va a agregar—
  y las columnas `pod.lat`/`pod.lng` de `0047:133-134`, que hoy nadie escribe y que el
  día que se escriban convierten el rótulo de `/dashboard/mapa:14` en falso.
- **Finalidades (fr. III):** el expediente operativo por chofer —incidencias con dueño
  (`operacion.ts:73-76,91-93`), entregas que faltan, y el "% comprobado" cuyo propio
  comentario dice *"el cruce que el dueño usa para la conversación difícil"*
  (`analytics.ts:412-414`)— no está en la lista, y `versionAviso` (`privacidad.ts:255-262`)
  no cambia al levantar una incidencia, así que **el reenvío del art. 15 fr. VI no
  dispara**.
- **ARREGLABLE hoy, y es un typo con consecuencia:** `privacidad.ts:488` y
  `src/app/privacidad/page.tsx:53` fundan "Likida es persona encargada" en el
  **art. 2 fr. XX**, que es la definición de *Transferencia*; la de persona encargada es
  la **fr. XII**. El documento que sostiene "esto no es una transferencia" cita como
  fundamento la definición de transferencia. Y `privacidad.ts:544` funda la revocación
  en el **Reglamento art. 21** — el reglamento de la ley abrogada. El `fundamento` se
  **pinta en la página** (`aviso/[tenant]/page.tsx:117`) *"para que quien lo revise
  pueda comprobarlo"*.
- **Ningún panel liga a un aviso:** ni `dashboard/`, ni `mis-viajes/`, ni `cuenta/`
  contienen la cadena `aviso` o `privacidad`; y al chofer se le pide en `/login`
  aceptar el aviso de Likida, que en su propio texto se autodescarta y nombra al
  responsable equivocado.
**PR #7:** `74e7ef6`, `c2b0dfc`, `14f42d6` cubren el aviso por flota y las citas.
**DECISIÓN HUMANA:** qué datos y qué finalidades se declaran, y si la foto sigue siendo
pública. El texto lo escribe una persona, no una prueba.

#### G-55 · [NO REPRODUCIBLE AQUÍ] Ejercer el derecho ARCO no produce ningún efecto: ni registro que la empresa vea, ni cambio en el tratamiento automatizado · dominio: D4 · severidad: ALTO + MEDIO
Reportado por: legal (ALTO REINCIDENTE + MEDIO REINCIDENTE).
`src/lib/cuadra/processor.ts:133-140` (el registro completo del ejercicio es **un
`logger.info`**; Sentry solo recibe `warn` y `error`, así que ni sale del proceso) ·
`src/lib/cuadra/privacidad.ts:407,521,528` (tres afirmaciones de hecho: *"Queda
registrada tu solicitud para la empresa"*, *"la empresa la hará a mano"*) ·
`src/lib/cuadra/analytics.ts:125-146` (`detectarAnomalias` lee **todos** los `gasto` del
tenant, sin bandera de oposición — porque esa bandera no existe en el esquema) ·
`grep -rniE "retencion|consentimiento|oposicion" supabase/migrations` → **cero**.
La empresa, que tiene 20 días hábiles para contestar, no se entera nunca.
**Por qué no aquí:** el arreglo es una tabla de solicitudes (migración) más una pantalla
en `/dashboard`. Sin base no se puede ejercer.
**PR #7 cubre la mitad detectable:** `36a4ca5` — hoy `pideAtencionPrivacidad` devuelve
`false` para *"no quiero que un robot decida sobre mi ticket, que lo vea alguien"*
(que trae **las dos** señales), y para *máquina*, *computadora*, *borrar* y *eliminar*.

#### G-56 · [YA ARREGLADO EN EL PR #7] Al chofer se le pide aceptar un aviso que en su propio texto declara no ser el suyo · dominio: D1 · severidad: MEDIO
Reportado por: legal (MEDIO REINCIDENTE, empeorado a 20 páginas).
`src/app/login/page.tsx:181-186` · `src/app/privacidad/page.tsx:53-55`.
**PR #7:** `74e7ef6`. Ampliar el enlace a las 20 páginas de `/dashboard` y a
`/mis-viajes` es trabajo de D1 tras el merge.

---

### BLOQUE I · El resto, verificado y acotado

#### G-57 · [ARREGLABLE] El despacho asigna la unidad al viaje y nunca la saca de "disponible" · dominio: D5 · severidad: MEDIO
Reportado por: backend (MEDIO).
`src/lib/cuadra/operacion.ts:490-494` (`asignarUnidad` escribe `viaje.unidad_id` y
punto) · `:443` (`unidadesDisponibles`) · `dashboard/despacho/page.tsx:123`
(`unidadesLibres`) · `supabase/migrations/0047:56-57`, cuyo comentario promete lo
contrario: *"disponible | en_ruta | taller | baja. **Lo mueve el despacho**, no un
humano tecleando"*. `grep` confirma que **nada en `src/` escribe `unidad.estado`** salvo
el botón manual de `/dashboard/unidades`.
El encargado despacha las 8 unidades de la mañana y al mediodía el tablero sigue
diciendo **"8 disponibles"** con los 8 camiones en carretera, el `<select>` vuelve a
ofrecer C2-08 para el noveno viaje, y nada impide que dos viajes abiertos compartan la
misma unidad.
**Reproducción:** `operacion.test.ts` no ejercita `asignarUnidad` en absoluto. Caso
nuevo: asignar → esperar el `update` de `unidad.estado` a `'en_ruta'`.

#### G-58 · [ARREGLABLE] Un blip de Supabase le dice al chofer que su flota no configuró el aviso, y le tira la foto · dominio: D4 · severidad: ALTO
Reportado por: agéntico (ALTO NUEVO).
`src/lib/cuadra/processor.ts:206-210` (el `catch` devuelve `false` ante **cualquier**
excepción, así que "el tenant no tiene razón social" y "la base no contestó" son
indistinguibles) · `:375-387` (el corte y su único texto; el `return` de `:386` va
**antes** del brazo de imagen, así que la foto se descarta sin guardarse, y el claim del
mensaje tampoco se libera, al revés que sus dos vecinos de `:428` y `:865`) ·
`src/lib/cuadra/repo.ts:595` · `src/lib/cuadra/presupuesto.ts:148-169` (`acotada`
convierte un cuelgue en ese mismo error).
A las 10:12 del demo el chofer lee: **«tu empresa aún no ha terminado de configurar su
aviso de privacidad»** — el producto acusa por escrito al comprador, delante del
comprador, por un tropiezo de red. La regla del repo es "fallar cerrado **y decirlo**";
aquí falla cerrado y dice otra cosa. `resolveOperador` y `getOpenViaje` ya corrigieron
este mismo error con `ConsultaFallida`.
**Reproducción:** `ponerAvisoADisposicion` con `getDatosResponsable` lanzando → esperar
que distinga los dos hechos y que la foto **se guarde**.

#### G-59 · [YA ARREGLADO EN EL PR #7] `guardiaFundamento` certifica una cita bien nombrada y mal aplicada · dominio: D4 · severidad: ALTO
Reportado por: agéntico (ALTO REINCIDENTE de las rondas 8, 9 y 10).
`src/lib/cuadra/normas/fundamento.ts:204-215` (`citaEsMismoTema`), umbral en `:197`,
llamada en `:367`, cableado en `processor.ts:1293-1300`.
La memoria se concede si la oración comparte **≥2 palabras** de tema con la que la trajo
antes — y el vocabulario lo puso el propio sistema en el turno anterior. Ejecutado
contra el código de hoy: *"Tu **caseta** pagada en efectivo cuenta contra el tope del
15% del combustible del ejercicio (RFA 2026 regla 2.9)"* **pasa entera**. La 2.9 es el
tope del 15% del **combustible**; ni una caseta ni una comida caben.
**PR #7:** `959cfb6` (la memoria se ata al gasto del que habla, no al vocabulario).

#### G-60 · [ARREGLABLE] La única recuperación del cierre a medias está detrás de un flag apagado por default, y nada verifica que esté puesto · dominio: D4 · severidad: ALTO
Reportado por: agéntico (ALTO).
`src/lib/cuadra/processor.ts:1187` (`process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1'`),
`:1206-1207`, `:1232-1237` · `src/lib/cuadra/startup.ts:21-28`
(`verificarEntornoCritico` solo mira `DASHBOARD_SECRET`) · `.env.example:75` (lo
recomienda ON) · `src/lib/llm/openrouter.ts:402-403` (afirma que el flag está **"activo
por default"**, que no es cierto en el código de hoy).
Con el flag ausente: la liquidación está cerrada, los dos PDF en storage y el contralor
la ve en el panel, mientras el chofer lee *"se me trabó, ¿me reenvías?"* y al reenviar,
*"No tienes un viaje abierto para liquidar ahorita"*. La información para cerrar el
ciclo **está en memoria** (`parcial`, `:1188`) y se tira por una variable de entorno.
Y ni `pdf.no_entregado` ni el log de `cerroSinEntregar` se disparan, porque los dos
viven dentro de `if (closed)`.
**Reproducción:** `processInbound` con `PartialExecutionError` que lleve
`guardar_liquidacion` en `partialToolCalls`, sin la variable → esperar que **recupere**.
El comportamiento debe dejar de ser un flag.

#### G-61 · [YA ARREGLADO EN EL PR #7 + NO REPRODUCIBLE parcial] El botón de Google sin `shouldCreateUser:false`, `/api/demo` publicando el inventario de configuración y aceptando `anticipo: NaN`, y los grants de `try_lock_viaje` · dominio: D3 · severidad: MEDIO + BAJO ×3
Reportado por: seguridad (MEDIO + BAJO ×2), backend (BAJO).
`src/app/login/page.tsx:60-62` (el camino de correo cierra el autoregistro en código,
con prueba que lo ancla; `signInWithOAuth` no tiene la bandera y nadie la sustituye —
que el otro camino se moleste en apagarlo explícitamente dice que el interruptor del
proyecto está encendido) · `src/app/api/demo/route.ts:7-10` (`envHealth()` sin sesión,
sin rate-limit, fuera del matcher — cuarta ronda idéntica) y `:32-41` (`req.json()` sin
`try`; `{"anticipo": "cinco mil"}` hace cuadrar el motor con `NaN` y devuelve
`"diferencia": null`) · `supabase/migrations/0012_seguridad_rls.sql:13-14` (el
`revoke … from public` **no alcanza** el grant explícito de Supabase, y el repo ya lo
sabía dos migraciones después: la 0013 revoca de `public, anon, authenticated`).
El de los grants **no cierra hoy** —ninguna de las dos funciones es `security definer`
y `viaje_lock` tiene RLS sin policies— así que es defensa en profundidad perdida, no
explotación. Y exige base: **NO REPRODUCIBLE AQUÍ**.
**PR #7:** `5c325f0`, `7ab5fd7`, `ce0abc4`.

#### G-62 · [YA ARREGLADO EN EL PR #7] El alta de "Chofer (operador)" produce una cuenta que no puede entrar a **nada** · dominio: D3 · severidad: MEDIO
Reportado por: seguridad (MEDIO REINCIDENTE, agravado), datos (MEDIO REINCIDENTE).
`src/lib/auth/provisionar.ts:27-32` (inserta `{id, tenant_id, email, nombre, rol}` **sin
`operador_id`**) · `src/app/admin/usuarios/nuevo/page.tsx:12` (la consola sigue
ofreciendo *"Chofer (operador) — solo sus propios viajes"*) · `src/lib/auth/guard.ts:52`
· `src/lib/auth/tenant-efectivo.ts:55` · `supabase/migrations/0045:23-24` (el comentario
declara la invariante y **no hay `CHECK` que la imponga**).
La ronda 11 cerró la fuga (`operador` no está en `AREAS_POR_ROL`) y con eso el rol quedó
**sin ninguna puerta**: `/dashboard` lo rebota, `/mis-viajes` exige un `operadorId` que
la consola no llenó. Si el demo incluye dar de alta a un chofer —que es la
demostración obvia de "cada quien ve lo suyo"— la pantalla que sale es `/sin-acceso`.
**PR #7:** `e48d986`, `57132d4`.

#### G-63 · [NO REPRODUCIBLE AQUÍ] La 0047 no es idempotente ni deja escrita su reversión, sus cuatro enteros no tienen dominio, `triggers_faltantes` sonda por nombre, y `app_user.id` no tiene FK a `auth.users` · dominio: D5 · severidad: MEDIO ×2 + BAJO ×2
Reportado por: datos (4 hallazgos).
`supabase/migrations/0047:172-176,183-191` (`create policy` dentro del `do $$` **sin
`drop policy if exists` delante**, mientras todo lo demás del archivo sí es idempotente
— y la 0046, a dos archivos de distancia, lo hace bien en `:27,32,37,42`) ·
`0047:38,80,107` (`anio`, `km_servicio`, `sla_horas` sin `CHECK`: un `sla_horas = -5`
nace **con el SLA vencido**, en rojo, en la pantalla del encargado) ·
`0043_triggers_faltantes.sql:31` (sonda `tgname` y la 0042 **reemplaza** el trigger
conservando el nombre, así que la sonda que se construyó para que el arranque dejara de
mentir sobre esos dos triggers puede seguir mintiendo sobre el que el propio arreglo
modificó) · `0001_init.sql:16` (`id uuid primary key, -- = auth.users.id`: un
comentario, no una restricción; `provisionarUsuario` tampoco es atómico).
**Por qué no aquí:** las cuatro son SQL contra una base que no existe en este entorno.
**PR #7:** `1b29ed6` (la 0045 se puede reaplicar y su reversión está escrita — el molde
a copiar), `dde6ef0` (el arranque sonda el **cuerpo** del trigger), `732ef68`.

---

## No arreglables aquí, con la razón

| Grupo | Clase | Qué exige que este entorno no tiene |
|---|---|---|
| **G-20** `viaje.operador_id` NOT NULL | NO REPRODUCIBLE | `alter column … drop not null` ejercido contra Postgres. Toca la FK compuesta de la 0028 y la RLS de la 0045. `operacion.test.ts` pasa hoy **porque el mock acepta null**: sin base, la prueba que lo reproduce no existe. *(Mitigación de UI sí es arreglable en D5.)* |
| **G-28** RLS del chofer 3/7, contador con escritura, FK de la 0047 sin tenant, `pod_viaje_unico` global, `operador_sube_su_pod` sin `with check` | NO REPRODUCIBLE | Policies y `WITH CHECK`. Verificarlos exige `set local role authenticated` + PostgREST. El bloque 26 de `verificaciones.sql` solo cuenta filas visibles y nunca intenta escribir. |
| **G-29** Bucket `avatares` público, sin `file_size_limit` ni `allowed_mime_types` | NO REPRODUCIBLE **+** DECISIÓN HUMANA | La migración exige base. Y si el bucket sigue público (render barato vs. URL firmada) y qué dice el aviso sobre la fotografía son decisiones de producto y legales. |
| **G-55** ARCO sin efecto | NO REPRODUCIBLE | Tabla de solicitudes (migración) + pantalla. *(La mitad detectable —el vocabulario del detector— sí está cerrada en el PR #7.)* |
| **G-63** 0047 no idempotente, enteros sin `CHECK`, `triggers_faltantes` por nombre, `app_user.id` sin FK | NO REPRODUCIBLE | SQL contra una base. Reaplicar la 0047 para ver el `42710` exige un Postgres al que aplicarla dos veces. |
| **G-35** CI rojo / umbral de cobertura 78% vs 64.05% | DECISIÓN HUMANA | Subirlo son pruebas para ~9,700 líneas de UI; bajarlo es apagar el medidor. *(Separar el trinquete de la suite para que Build vuelva a correr sí es arreglable hoy.)* |
| **G-36** `NEXT_PUBLIC_APP_URL` con cuatro valores | DECISIÓN HUMANA | Cuál es el bueno y qué dice el Site URL de Supabase no se puede leer desde el repo. *(Validar el valor en `arranque.ts` y arreglar el script sí.)* |
| **G-51** Ordinales 0046/0047 duplicados entre ramas | DECISIÓN HUMANA | Renumerar las del PR #7 y reconciliar dos refactors independientes de `/dashboard` es una decisión del dueño, no de una corrida desatendida. *(Que la prueba detecte ordinales duplicados sí es arreglable, y hay que hacerlo pase lo que pase.)* |
| **G-54** Catálogo y finalidades del aviso | DECISIÓN HUMANA | Qué datos y qué finalidades se declaran, y si la foto sigue siendo pública. *(Las dos citas equivocadas —art. 2 fr. XX por fr. XII, y Reglamento art. 21 de la ley abrogada— sí son arreglables hoy.)* |
| **G-42** (parcial) El presupuesto de `$0.03–0.05 / liquidación` | DECISIÓN HUMANA | El número es de producto. *(La prueba que caduca con la tarifa intro el 31-ago y el `cache_control` sí son arreglables.)* |
| **G-61** (parcial) Grants de `try_lock_viaje`/`unlock_viaje` | NO REPRODUCIBLE | `has_function_privilege('anon', …)` contra la base. Hoy no cierra por la RLS de `viaje_lock`, así que es defensa en profundidad, no explotación. |

---

## Nota de ejecución para quien reparta el trabajo

1. **Antes de escribir una línea, decidir el PR #7.** Veintitrés de los 63 grupos ya
   están arreglados y probados ahí, incluidos cinco de los siete críticos que la
   síntesis dejó propuestos. Los archivos donde viven esos 23 arreglos **no los tocó
   `master`**: el merge los aplica sin conflicto. Reescribirlos aquí produce una segunda
   variante del mismo arreglo sobre un archivo que el merge va a sobrescribir, y las
   +460 pruebas que los anclan tampoco llegan.
2. **G-01 se hace pase lo que pase.** Es un carácter en `supabase/seed.sql` y de él
   cuelgan todas las cifras fiscales del demo del 6-ago. El arreglo es idéntico al del
   PR #7, así que no crea variante.
3. **G-50 es la prueba de mayor valor por línea del plan.** Que un `if (false && …)` en
   el único chokepoint de autorización de 20 páginas pase `vitest`, `tsc` y `eslint` ya
   está medido en este árbol. Mientras esa prueba no exista, cualquier resolución de
   merge puede desactivar el gate y desplegar verde.
4. **Los seis arreglos cross-domain van en dos tiempos.** D1 y D3 publican primero sus
   contratos (`safeLog()`, `resolverTenantDeAction()`, el tipo de `searchParams`, el
   `valor: number | null` de `KpiTile`); D5 y los demás los consumen después. Dos
   agentes tocando el mismo archivo se pisan; dos agentes tocando el mismo *contrato* en
   orden, no.
5. **Ningún agente corre `npm run build`, `pruebas-manuales/*.prueba.ts`, ni
   `supabase db push`.** La compuerta es `npx vitest run` + `npx tsc --noEmit -p .` +
   `npm run lint`, y cada arreglo entra con la prueba que lo reproduce, en un commit
   atómico.
