# Arquitectura y mantenibilidad — auditoría 16

Ancla: commit `c901226` (HEAD, "feat(legal): ARCO de la flota en /dashboard + entrega de la
respuesta por WhatsApp (ronda 16)"). Ronda anterior: `docs/auditoria-15/arquitectura.md`
(ancla `d7b171f`, fixes en `96f2adc`). El prompt pide auditar línea por línea tras la 15 y sus
fixes: el CRÍTICO ARCO (superadmin ve todas las flotas, mensaje honesto), el fail-closed real
del contador del 15%, las regresiones del panel, el año común de `tools.ts`/`desde_db.ts` y el
error de lectura de `actualizarFacilidad15` — más la feature nueva de la 16 (`c901226`): la ruta
`/dashboard/arco` y la entrega de la respuesta ARCO por WhatsApp (`enviarRespuestaArco`).

Verifiqué los cierres de la 15 abriendo el código (no por el título del commit), luego la
feature nueva línea por línea, y re-ejecuté los escenarios con valores con el motor real.
Pruebas del rubro verdes (engine 117, visibilidad 90, tenant-efectivo 45, dinero_por_area 6,
formato 21, crear_viaje_wa 77 — 356 en total). `tsc --noEmit` limpio en el árbol commiteado.
**`npx eslint src/` tiene UN ERROR nuevo en el árbol de HEAD** (ver ALTO-1). `next build` pasa.

**Nota: 6/10** (sube de 5). Razón: los DOS ALTO de la 15 quedaron cerrados de verdad y con
prueba (el CRÍTICO ARCO y el fail-closed del contador), y la 16 atacó la deuda de producto que
la 15 anotó como techo del loop (ARCO de la flota en /dashboard + entrega por WhatsApp). Pero la
feature nueva —la bandera legal de la ronda— llega con cuatro defectos: un error de eslint que
rompe la puerta de verificación del repo, una pantalla cuyo server action es ciego al `?tenant=`
que la propia pantalla honra (el patrón que `b286aa8` estableció y que `[id]/page.tsx` sigue),
un mensaje en `/admin/compliance` que contradice al código que tiene debajo ("Likida no envía
mensajes ARCO todavía" cuando SÍ los envía), y cero pruebas para el único camino de envío nuevo.
Además, la otra mitad del MEDIO fiscal de la 14 —la que la 15 dijo haber cerrado— sigue viva en
`desde_db.ts`: el previo del contador resta gastos de OTRO año y el excedente impreso sale mal.

---

## Cierres de la ronda 15 — verificación línea por línea

### 1. CRÍTICO ARCO: la pantalla de /admin ya no está ciega — CIERRE VERIFICADO

`src/app/admin/compliance/page.tsx:138-180` (`datosDeCompliance`) ya no filtra por el tenant de
la sesión: `if (!s) return { solicitudes: [], pendientesVencen: 0 }` y la consulta
(`traerTodo` con `conteo`) lista TODAS las solicitudes sin `.eq('tenant_id', …)`, con el join
`flota:tenant_id(nombre)` para la columna de flota. El escenario de la 15 (superadmin con
`tenant_id` NULL por diseño, 0001) ya no produce `[[], 0]`: el superadmin ve las solicitudes de
todas las flotas. La acción `accionResolver` resuelve bien el tenant POR solicitud
(`:35-40`). **Estado: cerrado.**

### 2. Fail-closed real del contador del 15% (motor) — CIERRE VERIFICADO

`src/lib/cuadra/cuadre/engine.ts:306-322`: con `totalCombustibleEjercicio <= 0` o comprobante de
otro ejercicio (`mismoEjercicio = !anioComprobante || anioComprobante === input.anioEjercicio`),
el gasto sale `combustible_efectivo` (POR CONFIRMAR) con `monto: 0` y nota "No se afirma
deducible ni no deducible" — nunca `efectivo_sobre_15` contra un tope de $0. Las 3 pruebas
nuevas (`engine.test.ts:1523-1561`) lo fijan: contador caído → `totalPorConfirmar=1000`,
`totalNoDeducible=0`; comprobante 2025 en ejercicio 2026 → por confirmar; la nota no contiene
"NO se deduce". Ejecuté el motor: verdes. El comentario de `desde_db.ts:71-75` ("la rama 'sin
datos del ejercicio' marca el efectivo para revisar") ya es VERDAD — la rama existe. **Estado:
cerrado** (con una llave abierta: el previo, ver ALTO-2 abajo — el motor cierra la evaluación
directa del comprobante ajeno, pero `desde_db` sigue contaminando el PREVIO con él).

### 3. Regresiones del panel (sin declarar / recuadro del 15%) — CIERRE VERIFICADO

`src/lib/cuadra/fiscal.ts:336-340`: `elegible15 === false` → `efectivo_no_elegible`; `undefined`
(sin declarar) → `combustible_efectivo` (en riesgo, no perdido). `combustible/page.tsx:155-166`
distingue los tres estados. **Estado: cerrado.**

### 4. `tools.ts` y `desde_db.ts` con el MISMO año — CIERRE VERIFICADO (con residuo)

`tools.ts:107-108` ancla al viaje (`viajeCtx?.fechaInicio`) en vez del reloj; `desde_db.ts:62-65`
igualmente al viaje. El escenario de la 15 (viaje de dic-2026 cerrado el 5-ene-2027) ya no
divergue. **Residuo:** si `fechaInicio` es null, `desde_db` cae al año de los gastos
(`desde_db.ts:63-65`) y `tools` cae al reloj (`tools.ts:108`); y un bache de red en el
`getViaje` de `tools` (`.catch(() => null)`) cae al reloj — la divergencia de criterio sobrevive
solo en el caso de viaje sin `fechaInicio`, que no ancla a nada. **Estado: cerrado para el caso
normal; residuo documentado.**

### 5. `actualizarFacilidad15` comprueba el error de lectura — CIERRE VERIFICADO

`repo.ts:923-927`: `const { data: fila, error: errLee } = …` y `if (errLee) throw`. Un bache de
red ya no se lee como "la flota no tiene config" y ya no reemplaza la config entera por una
llave. **Estado: cerrado.**

### 6. El mensaje de éxito de /admin dejó de mentir… y la 16 lo volvió a romper (ver MEDIO-2)

La 15 corrigió el "el titular recibió su respuesta por WhatsApp" (`compliance/page.tsx:45` ahora
dice "se entrega por el canal que la flota defina — Likida no envía mensajes ARCO todavía"). La
16 implementó el envío… y dejó el mensaje. Contradicción viva, abajo.

---

## Hallazgos de código (nuevos de esta ronda y re-verificados)

### [ALTO] `desde_db.ts` resta del previo del contador los gastos de OTRO año (o sin fecha) — el excedente impreso sale mal

`src/lib/cuadra/cuadre/desde_db.ts:84-87`:

```ts
const efectivoDeEsteViaje = gastos
  .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
  .reduce((s, g) => s + Number(g.monto ?? 0), 0);
const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
```

El filtro NO mira `g.fecha`. El contador (`repo.ts:807-809`) sí: `.gte('fecha', ${ejercicio}-01-01).lte('fecha', ${ejercicio}-12-31)` — un gasto de 2025 (o sin fecha, que Postgres excluye del `gte`/`lte`) NO está en el contador, pero SÍ se resta del previo. El fix de la 15 cerró la evaluación directa del comprobante ajeno (engine.ts:315-322), pero el PREVIO que recibe el motor ya llegó contaminado.

**Escenario con valores (verificado ejecutando el motor real, scratch temporal):** flota con
facilidad15 declarada. Viaje que inicia el 2-ene-2026 con dos tickets en efectivo: G1 = $1,000
fechado 2026-03-01 y G2 = $1,000 fechado 2025-12-20 (dentro de la tolerancia de
`fechaToleranciaDiasAntes`, el escenario exacto que la 14 documentó). El contador del ejercicio
2026 midió `efectivo = $3,000` (incluye G1, NO incluye G2).

- `efectivoDeEsteViaje` = G1 + G2 = $2,000 (sin filtro de año) → `efectivoPrevEjercicio` = $3,000 − $2,000 = **$1,000**.
- El previo VERDADERO es $3,000 − G1 = **$2,000** (G2 no estuvo jamás en el contador 2026).
- Motor (engine): G1 contra previo $1,000 → acumulado $2,000 vs tope $1,500 (15% de $10,000) →
  `efectivo_sobre_15` = **$500**, `totalNoDeducible = $500`. Con el previo verdadero el excedente
  de G1 sería **$1,500**. El PDF imprime "el excedente de $500.00 de ESTE comprobante NO se
  deduce" — $1,000 por debajo de la cifra real, en la dirección que el propio repo documenta
  como la que nadie revisa ("a la baja es la dirección que nadie revisa", `repo.ts:857`).
  G2 sale `combustible_efectivo` por confirmar (eso sí quedó bien con el fix de la 15).

Misma resta indebida con un gasto SIN fecha (probe A16-4: el contador lo excluye, `efectivoDeEsteViaje` lo resta). La recomendación de la 14 —"sumar solo los pagos del ejercicio del gasto, o al menos excluir los de otro ejercicio del acumulado"— se implementó en el motor y NO en `desde_db`. **Estado: abierto** (es la otra mitad del MEDIO de la 14, que la 15 declaró cerrada y no lo está del todo; el caso espejo que la 15 corrigió era la evaluación directa, no la aritmética del previo).

### [ALTO] `arco/page.tsx:49` llama `Date.now()` en el render — el árbol de HEAD rompe la puerta de verificación del repo

`src/app/dashboard/arco/page.tsx:49` (dentro del cuerpo del Server Component):

```ts
const vencenPronto = solicitudes.filter((s) => … && s.venceEn <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
```

`npx eslint src/` (la puerta #2 de CLAUDE.md, "eslint src/ — limpios") falla en HEAD con un
error nuevo:

```
src/app/dashboard/arco/page.tsx
  49:130  error  Error: Cannot call impure function during render   react-hooks/purity
```

La propia base de código documenta el patrón y cómo evitarlo: `soporte/page.tsx:7-11` ("un
`Date.now()` en el render lo bloquea `react-hooks/purity`… llega como prop (`ahoraMs()`)"). La
página nueva de la 16 no lo sigue. `next build` PASA (Next 16 ya no corre eslint en build), así
que no rompe producción — pero el commit `c901226` declara "tsc 0 · build limpio" y el gate que
el repo manda correr (`npx eslint src/`) está rojo en el árbol commiteado desde la 16. Además el
render no es idempotente: el KPI "Vencen pronto" depende del instante de render. **Estado:
abierto** (nuevo).

### [MEDIO] El server action de `/dashboard/arco` es ciego al `?tenant=` que la propia pantalla honra

`src/app/dashboard/arco/page.tsx:27` pinta con `resolverTenantEfectivo(RUTA, sp)` — que resuelve
el tenant efectivo del superadmin (el `?tenant=X` de "Ver dashboard"). El action
`accionResponder` (`:29-42`) usa `requireSessionTenant(RUTA)` y `resolverSolicitudArco(s.tenantId, …)`
— que para superadmin devuelve SIEMPRE el tenant demo (`guard.ts:39-40`:
`if (s.rol === 'superadmin') return { ...s, tenantId: tenantDemo() }`).

**Escenario con valores:** dos flotas en producción: Transportes Innovativos (demo, id
`11111111-…`) y Carga Express (id `2222-…`). Javier (superadmin) abre `/admin/flotas` →
"Ver dashboard" → `/dashboard?tenant=2222…&rol=flota_admin` → navega a Privacidad (ARCO) →
`/dashboard/arco?tenant=2222…`. La pantalla lista las solicitudes de Carga Express
(`resolverTenantEfectivo` resolvió 2222). Javier escribe la respuesta y pulsa Responder →
`requireSessionTenant` devuelve `tenantId = 1111…` (demo) → `resolverSolicitudArco('1111…', id-de-2222, …)`
hace `.eq('tenant_id','1111…')` → `maybeSingle()` devuelve null →
"resolverSolicitudArco: la solicitud no existe en esta flota". La fila que tiene enfrente no se
puede responder, sin que la UI lo explique.

El patrón correcto ya existe en la misma base: `[id]/page.tsx:122-126` — el action `reabrir`
re-resuelve `?tenant=` dentro del action (`if (s.rol === 'superadmin' && sp?.tenant) t = await
resolverTenantPedido(...)`). Es la misma clase de "mitad render / mitad acción" que `b286aa8`
atacó en la 13 para el render, ahora reincidente en la acción de una página NUEVA. El error es
honesto (no miente sobre datos), por eso MEDIO y no ALTO. **Estado: abierto** (nuevo).

### [MEDIO] `/admin/compliance` ahora contradice al código que tiene debajo: "Likida no envía mensajes ARCO todavía" cuando SÍ los envía — y descarta el resultado del envío

`src/app/admin/compliance/page.tsx:45`:

```ts
return { ok: 'Solicitud marcada como resuelta. La respuesta se entrega al titular por el canal que la flota defina — Likida no envía mensajes ARCO todavía (anotado para la ronda siguiente).' };
```

La 16 (`repo.ts:992-1002`) implementó el envío: `resolverSolicitudArco` → `enviarRespuestaArco`
→ WhatsApp al titular. La acción de /admin (`compliance/page.tsx:40`) llama
`await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);` SIN usar el
resultado `{ enviada, error }` — y muestra el mensaje de la 15, que ahora es FALSO en ambas
direcciones: si el envío salió, el mensaje afirma que no se envió nada; si no salió, el
superadmin nunca se entera (la página hermana de /dashboard, `arco/page.tsx:39-41`, sí distingue
"se envió" de "no se pudo enviar — entrégala por otro canal"). Dos pantallas que hacen la misma
acción legal llegan a conclusiones contradictorias sobre el mismo hecho. **Estado: abierto**
(nuevo).

### [MEDIO] El encargado puede responder solicitudes ARCO — y mandar WhatsApp en nombre de la empresa — sin pasar por la matriz de permisos

`visibilidad.ts:76` clasifica `/dashboard/arco` como `operacion`, así que el encargado
(área `['operacion']`, `visibilidad.ts:27`) ve la página y su formulario "Responder". El action
`accionResponder` (`arco/page.tsx:31`) solo pasa por `requireSessionTenant` — NO consulta
`puedeAdministrar` (`permisos.ts:25-27`: `['superadmin', 'flota_admin']`). La doctrina del repo
es que el action re-chequea el permiso (el propio `[id]/page.tsx:118-121` lo hace para
"Reabrir": `if (!puedeAdministrar(s.rol)) return { error: 'Tu rol no puede reabrir…' }`). Aquí
la resolución ARCO —un acto legal de la responsable ante la autoridad, LFPDPPP art. 32— sale del
control del dueño sin que ninguna decisión de producto lo haya declarado: el jefe de tráfico
puede contestar en nombre de la empresa y disparar un envío de WhatsApp real al titular.
Puede ser una decisión de producto legítima (el encargado es agente de la flota), pero hoy es
una consecuencia NO DECIDIDA de una clasificación de área, y rompe el patrón de "el action
re-chequea el permiso" que el repo usa en el resto de páginas con acciones. **Estado: abierto**
(nuevo).

### [MEDIO] La feature bandera de la 16 (envío de la respuesta ARCO) no tiene UNA sola prueba

`grep -rln "enviarRespuestaArco|resolverSolicitudArco|/dashboard/arco" src/ --include="*.test.*"`
→ cero coincidencias. Ni el armado del mensaje, ni la clasificación `FUERA_VENTANA`
(`meta/client.ts:461-462`: `[131047, 131026, 131042]` — los códigos 131026/131042 no son
"fuera de la ventana", son "no entregable" y "no es usuario de WhatsApp"; la clasificación
dispara la plantilla por un motivo equivocado, aunque falla cerrado porque la plantilla también
rebotaría), ni el fallback de plantilla, ni el alcance por tenant de `resolverSolicitudArco`, ni
siquiera la clasificación de `/dashboard/arco` en `visibilidad.test.ts`. La ronda 15 fijó la
doctrina "cada fix con prueba" (3 pruebas para el fail-closed); la feature nueva de la 16 —la
única lógica de envío nueva de toda la ronda— llega sin ninguna. **Estado: abierto** (nuevo).

### [BAJO] La plantilla `respuesta_arco` lleva `{{1}}` con el literal "la flota", no la razón social

`src/lib/meta/client.ts:456-467`: el comentario dice "lleva {{1}} = razón social de la flota y
{{2}} = la respuesta", y el código manda:

```ts
components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
```

El valor `{{1}}` es el string fijo `'la flota'`. El llamador (`resolverSolicitudArco`) tiene el
`tenantId` y podría traer la razón social (`getConfig().empresa.razonSocial`), pero no la pasa.
Cuando Meta apruebe la plantilla y el titular esté fuera de la ventana de 24h, recibirá "la
flota" como nombre de la responsable — una respuesta ARCO (acto legal) que identifica mal a la
empresa obligada. Hoy es inalcanzable (la plantilla está "en revisión" según el commit), por eso
BAJO. **Estado: abierto** (nuevo).

### [BAJO] `resolverSolicitudArco` usa `operador_id` (un UUID) como teléfono de respaldo

`src/lib/cuadra/repo.ts:994`:

```ts
const telefono = (sol.titular_ref as string | null) ?? (sol.operador_id as string | null) ?? null;
```

`titular_ref` es el teléfono (el processor lo escribe con `titularRef: telefono`,
`processor.ts:160`) — la vía correcta. `operador_id` es el UUID del operador (0053:
`operador_id uuid references public.operador(id)`): si `titular_ref` fuera null, el código
mandaría un UUID como `to` a Meta (`destinatarioWhatsApp` le quita los no-dígitos y queda un
número basura), que Meta rechaza y la UI reporta "no se pudo enviar" — no miente, pero el
respaldo es código muerto con tipo equivocado: un teléfono nunca puede salir de ahí. **Estado:
abierto** (nuevo, BAJO).

### [BAJO] El KPI "Vencen pronto" sigue comparando 5 días CALENDARIO contra un vencimiento de días HÁBILES — ahora en dos pantallas

`admin/compliance/page.tsx:179` y `arco/page.tsx:49`: la comparación usa
`new Date(Date.now() + 5 * 864e5)` (5×86,400 s = 5 días calendario) sobre `vence_en`, que
`venceArco` calcula en días HÁBILES (`privacidad.ts:618-627`). La etiqueta de /admin sigue
diciendo "≤ 5 días hábiles" (`compliance/page.tsx:67`) — el BAJO de la 15, intacto; la de
/dashboard dice "≤ 5 días" (`arco/page.tsx:65`) y sufre el mismo desfase con la etiqueta más
honesta. Un lunes, una solicitud que vence el viernes (5 hábiles = 7 calendarios) no aparece en
"Vencen pronto". **Estado: abierto** (reincidente en /admin desde la 15; copiado a /dashboard en
la 16).

### [BAJO] Pendientes estructurales re-verificados en HEAD (sin movimiento desde la 15)

- **`round2` reimplementado, sexta ronda**: `crear_viaje_wa.ts:302` sigue siendo
  `Math.round(base * factor * 100) / 100`; el guard de `formato.test.ts:158-159` sigue greppeando
  solo el NOMBRE (`function round2\|const round2\s*=`), y el guard de la EXPRESIÓN (`e85422c`)
  sigue sin ser ancestro de HEAD (`git merge-base --is-ancestor e85422c HEAD` → NO).
- **Matriz de permisos TS↔SQL sin guardarraíl**: `ve_finanzas`, `administra_flota`,
  `is_operador` siguen solo en comentarios de tests; nada sincroniza los dos runtimes.
- **`[id]` pierde `?rol=` con `?tenant=`**: `[id]/page.tsx:66` (`volverQS = '?tenant=${tenantId}'`)
  y `:79` (`if (!volverQS)` — nunca corre cuando hay tenant). Con `?tenant=X&rol=contador`, el
  "← Panel" (`:163`) cae a `/dashboard?tenant=X` y el modo se apaga a media navegación.
- **Badge de `[id]`**: `:164` — con `?tenant=X&rol=contador`, `volverQS` es truthy y el badge dice
  "viendo como superadmin" mientras la página pinta la vista del contador.
- **Comentario obsoleto del chat**: `chat/page.tsx:35-36` sigue diciendo "su ruta está
  clasificada como `operacion`" cuando `visibilidad.ts:75` la clasifica `dinero` desde `de6416f`.
- **`@upstash/qstash` muerta**: `package.json:23` la declara; `grep -rn "@upstash/qstash" src/`
  → cero coincidencias.

**Estado: abiertos** (los seis, igual que en la 15).

### [BAJO] Higiene: probes de auditores en `src/` rompen `tsc` y la suite mientras están presentes

Al momento de auditar, el working tree tiene archivos untracked de otros rubros
(`src/lib/cuadra/cuadre/zzz-aud16-probe3.test.ts`, `zzz-aud16-probe4.test.ts`, etc.) que rompen
`npx tsc --noEmit` (4 errores: `PoliticaGasto` no existe en `@/types/cuadra`) y —por el
`include: ['src/**/*.{ts,tsx}']` de `vitest.config.ts:62`— romperían la suite completa si otro
auditor la corre con ellos puestos. El árbol commiteado está limpio (verificado moviéndolos
fuera: `tsc` exit 0). No los borré (son de otro auditor). La disciplina de las rondas anteriores
("scratch temporal, se borra al terminar") convendría aplicarla ANTES de dar la suite por verde.
**Estado: abierto** (higiene, transitorio).

---

## Lo que revisé y está bien

- **CRÍTICO ARCO cerrado de verdad**: `compliance/page.tsx:138-180` lista todas las flotas con
  columna de flota, y la acción resuelve el tenant por solicitud. El escenario de la 15
  (superadmin con tenant null → pantalla siempre vacía) no se reproduce.
- **Fail-closed del motor**: la rama `engine.ts:315-322` y sus 3 pruebas (`engine.test.ts:1523-1561`)
  — ejecutadas, verdes. El comentario de `desde_db.ts:71-75` que la 15 señaló como promesa sin
  rama YA tiene la rama.
- **Panel honesto**: `fiscal.ts:336-340` y `combustible/page.tsx:155-166` distinguen no-elegible
  de sin-declarar; "sin declarar" ya no se pinta como deducción perdida.
- **Año común**: `tools.ts:107-108` usa el año del viaje, igual que `desde_db`. La divergencia
  de criterio de la 15 (reloj vs viaje) no se reproduce en el caso normal.
- **`actualizarFacilidad15`**: `repo.ts:923-927` tira ante error de lectura; ya no reemplaza la
  config entera por un bache de red.
- **La capa de datos ARCO sigue bien construida**: `listarSolicitudesArco` paginada con `conteo`,
  `resolverSolicitudArco` acotada por tenant (`.eq('tenant_id', tenantId)` en la lectura y en el
  update), `registrarSolicitudArco` best-effort con rastro ruidoso. El alcance por tenant del
  action de /dashboard es correcto para flota_admin/encargado reales — el defecto es solo la
  sesión de superadmin (MEDIO-1).
- **Pruebas del rubro**: engine 117, visibilidad 90, tenant-efectivo 45, dinero_por_area 6,
  formato 21, crear_viaje_wa 77 — 356 verdes. `tsc --noEmit` limpio en el árbol commiteado.
  `next build` compila completo (Next 16 ya no corre eslint en build, por eso el error de
  `arco/page.tsx:49` no lo tumba — pero rompe el gate manual del repo).
- **El mensaje de /dashboard/arco es honesto**: `arco/page.tsx:39-41` distingue "se envió" de
  "NO se pudo enviar — entrégala por otro canal" — la dirección que la 15 exigió.

## Lo que no alcancé a revisar

- La suite completa (3,132 según el prompt; otro auditor la corre — con los probes de
  `src/lib/cuadra/cuadre/zzz-*` presentes, la cifra no es reproducible hoy).
- La base real (us-east-2): el estado de `solicitud_arco` sembrado para el demo y el contenido
  EXACTO de la plantilla `respuesta_arco` en Meta (su cuerpo define si `{{1}}='la flota'` es más
  o menos grave de lo que cité).
- Si la pantalla `/dashboard/arco` está en el GUION_DEMO de mañana: el MEDIO-1 (acción ciega a
  `?tenant=`) no se dispara en el demo de una sola flota (demo = Transportes Innovativos =
  `tenantDemo()`), pero sí con cualquier segunda flota real.
- El resto de ~31 páginas de /dashboard una por una.

## Veredicto

**6/10 — sin luz verde.** Lo bueno, real y verificado: los dos ALTO de la 15 quedaron cerrados
con prueba (CRÍTICO ARCO, fail-closed del motor), las regresiones del panel se corrigieron, y la
16 atacó la deuda de producto que la 15 anotó como techo del loop (ARCO de la flota +
entrega por WhatsApp) con un mensaje de éxito honesto en la pantalla nueva. Lo que pesa en
contra: la feature nueva llega rota en cuatro puntos que la ronda anterior habría cazado —un
error de eslint en el árbol commiteado (rompe la puerta de verificación del repo), un server
action ciego al `?tenant=` que la pantalla honra (el patrón que la propia base ya estableció en
`[id]`), un mensaje en /admin que contradice al envío que el código de debajo ahora hace, y cero
pruebas para el único camino de envío nuevo—; la otra mitad del MEDIO fiscal de la 14 sigue viva
en `desde_db.ts` y fabrica una cifra impresa $1,000 abajo de la real en el escenario de frontera
de año; y los seis pendientes estructurales (round2 por sexta ronda, matriz TS↔SQL, `[id]` con
`?rol=`, badge, comentario del chat, QStash) siguen intactos. La 15 enseñó que cada fix con
prueba sube la nota; la 16 demostró que una feature sin prueba la vuelve a bajar. Los hallazgos
de dinero (ALTO-2, previo contaminado) y de legal (MEDIO-2, mensaje contradictorio) deberían ir
antes del demo de mañana.
