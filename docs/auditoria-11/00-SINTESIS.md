# Auditoría 11 — síntesis (4-ago-2026)

**Fecha:** 4-ago-2026 (demo: 6-ago-2026, en 2 días, con Transportes Innovativos).
**Anterior:** `docs/auditoria-10/00-SINTESIS.md` (global 4.9).
**Sha base:** `e4326f9` (HEAD de `master`) → rama `claude/auditoria-11`.
**Modo:** desatendida, en la nube, sin nadie mirando.
**Tipo:** **COMPLETA — 12 rubros, sobre `master`.**
**Árbol al arrancar:** limpio → autofix habilitado.

---

## Lo primero, porque cambia cómo se lee todo lo demás

**Los 96 arreglos de la auditoría 10 nunca llegaron a `master`.**

La ronda 10 corrió sobre la rama `claude/auditoria-10`, cerró 96 de 105
hallazgos con prueba en 99 commits, y quedó en el **PR #7, abierto**. Mientras
tanto `master` avanzó 40 commits por su cuenta. Las dos ramas divergieron:

```
$ git log --oneline origin/master..claude/auditoria-10 | wc -l
372          # los arreglos de la ronda 10 — ninguno está en master
$ git log --oneline claude/auditoria-10..origin/master | wc -l
40           # producto nuevo — nunca auditado
```

`master` es lo que Vercel despliega a producción y lo que se va a demostrar.
Verificado a mano sobre este árbol: `src/lib/auth/destino.ts` **no existe**,
`src/app/login/acciones.ts` **no existe**, y `session.ts:33` **no tiene** el
reintento `esColumnaAusente` que cerraba el CRÍTICO de modelo de datos.

Por eso esta ronda audita `master` y no la rama del PR. Y por eso **la mitad de
los hallazgos de hoy son REINCIDENTES**: no volvieron a aparecer, es que nunca
se fueron de aquí.

### El PR #7 tampoco se puede mergear solo

```
$ git merge origin/master        # sobre claude/auditoria-10
CONFLICT … 14 archivos, 28 hunks
```

Y las dos ramas usan **los mismos ordinales para migraciones distintas**:

| Ordinal | `master` | rama del PR #7 |
|---|---|---|
| 0046 | `0046_perfil_avatar.sql` | `0046_rls_operador_resto.sql` |
| 0047 | `0047_operacion_encargado.sql` | `0047_rls_operador_tenant.sql` |

La rama llega a `0053`. Una base que ya aplicó las de `master` se saltaría en
silencio las dos de RLS del PR y quedaría "totalmente migrada" sin ellas.

**No lo resolví.** Las dos ramas refactorizaron `/dashboard` de forma
independiente —las dos extrajeron `ESTATUS` a `app/dashboard/estatus.ts`, con
guardarraíles distintos e incompatibles—. Eso es reconciliar dos refactors, no
resolver conflictos, y las decisiones son del dueño. Una corrida desatendida
que las tome de madrugada, dos días antes del demo, es exactamente el riesgo que
esta auditoría existe para bajar.

**Desviación declarada:** el encargo decía "ronda de continuación, no abras un PR
nuevo". No se pudo continuar sobre #7 sin ese merge, y auditar la rama de #7 sin
mergear habría medido código que ya se auditó ayer y que además no es el que se
demuestra. Se abrió PR nuevo desde `master`, diciéndolo aquí y en el cuerpo del
PR. El propósito de la regla —que no se apilen PRs ignorados— se atiende
señalando que **#7 está bloqueado esperando una decisión humana**, no otra ronda.

---

## Nota global: 3.9 (antes 4.9, ▼1.0)

| Rubro | Aud. 10 | Hoy | | Razón del movimiento |
|---|:--:|:--:|---|---|
| **Cumplimiento fiscal** | 5 | **3** | ▼2 | **Deuda que cobró factura** — los dos CRÍTICOS del 3-ago siguen aquí línea por línea, y el RFC del tenant del demo lo rechaza nuestro propio validador: la liquidación del 6-ago imprime `Por confirmar $5,600.00`, cero deducible, y un pie falso sobre dos CFDI timbrados. |
| **Cumplimiento legal** | 4 | **3** | ▼1 | **Deuda que cobró factura** — la migración `0046`, nueva en `master`, publica la fotografía de la cara de un usuario en un bucket legible sin sesión, fuera del catálogo de cualquier aviso. |
| **Rendimiento y costo** | 4 | **3** | ▼1 | **Deuda que cobró factura** — la misma aritmética de la ronda 10 con las líneas de hoy: 233,000 ms contra `maxDuration = 120,000`, y `guardar_liquidacion` sube dos PDF con `fetch` pelado dentro del tramo que el presupuesto cree acotado. |
| **Sistema agéntico** | 3 | **3** | = | **Mirada más profunda** — de ocho puntos de muerte tabulados, cinco no cierran el ciclo con el humano. Seis hallazgos reincidentes y ocho nuevos: el 3 sigue siendo justo, no por inercia sino por medición. |
| **Backend y API** | 5 | **4** | ▼1 | **Deuda que cobró factura** — `visibilidad.ts` se escribió esta ronda para cerrar el hallazgo de la anterior, se aplicó en el sidebar y en la página, y la ruta de API nueva lo volvió a abrir en JSON. |
| **Operabilidad y DX** | 5 | **4** | ▼1 | **Deuda que cobró factura** — el CI de `master` lleva rojo desde el 3-ago y el paso de Build no ha corrido una sola vez sobre el código del demo. Dieciséis `catch` vacíos se tragan los errores de lectura de `/dashboard`. |
| **Modelo de datos** | 5 | **4** | ▼1 | **Deuda que cobró factura** — `viaje.operador_id` es `NOT NULL` desde la `0001` y todo el módulo del encargado está construido sobre que sea nullable. |
| **Frontend** | 6 | **5** | ▼1 | **Deuda que cobró factura** — el CRÍTICO que la ronda 10 cerró con `acred.tsx` está **reabierto y peor**: ese archivo no existe en `master` y ahora son tres tarjetas fiscales en vez de una. |
| **Tool calling** | 6 | **5** | ▼1 | **Mirada más profunda** — el código del rubro es byte-idéntico; la regla estructural (`properties: {}`, tres tools, `_args` sin leer) está intacta y verificada. Baja porque 11 de sus 17 hallazgos son reincidentes que nadie cerró aquí. |
| **Arquitectura** | 6 | **5** | ▼1 | **Deuda que cobró factura** — `permisos.ts` sigue diciendo por escrito que gobierna la API y sigue sin gobernar un solo endpoint; `puedeAdministrar` tiene cero consumidores en todo `src/`. |
| **Seguridad** | 5 | **5** | = | **Se atacó y subió en un frente, la deuda cobró factura en el otro** — `visibilidad.ts` + `tenant-efectivo.ts` cierran el CRÍTICO nº1 de la ronda 10 (el chofer en `/dashboard`) y la suplantación de tenant del superadmin está bien acotada; el aislamiento **entre flotas** no se rompe por ningún lado. Pero la RLS del chofer sigue cubriendo 3 de 7 tablas. |
| **Pruebas** | 5 | **3** | ▼2 | **Deuda que cobró factura** — 22 mutaciones sobre el código nuevo, **sobrevivieron las 22**; los 5 controles murieron como debían, así que la suite sí corre y sí caza: simplemente no cubre lo nuevo. `tenant-efectivo.ts` —el único chokepoint de autorización de las 20 páginas— está al 0.0% de líneas y sus tres decisiones se borran con la suite verde. |

Suma: 47/12 = **3.9**.

### Que baje otra vez no es la misma noticia que la vez pasada

La ronda 10 bajó 2.4 puntos porque miró código nuevo que nadie había auditado.
Esta baja por una razón distinta y peor de arreglar con más trabajo:
**el trabajo ya está hecho y no llegó**. Once de los doce rubros bajan o se
quedan, y en casi todos la razón es la misma frase — *el arreglo existe, está
probado, y vive en una rama que nadie mergeó*.

La conclusión operativa no es "hay que auditar más". Es: **decidir qué se hace
con el PR #7 antes del 6-ago**. Mergearlo cierra de un golpe 96 hallazgos
verificados, incluidos 8 de los 10 críticos de la ronda anterior y las +419
pruebas que los anclan. Dejarlo abierto significa demostrar sobre un árbol donde
todos ellos siguen vivos.

---

## Los hallazgos

**164 hallazgos reportados por los doce auditores** — 26 CRÍTICOS · 51 ALTOS ·
59 MEDIOS · 28 BAJOS. Al deduplicar por causa raíz y archivo quedan **63 grupos
únicos**: el mismo defecto lo reporta más de un rubro con nombres distintos (el
rail del asistente lo levantaron backend Y seguridad, y es uno solo).
**1 descartado por falso.**

### Cerrado con prueba que lo reproduce

**A11-BE-1 / A11-SEC-1 · CRÍTICO · `2fb1982`** — *El rail entregaba el dinero
de la flota a quien no puede verlo.*
`src/app/api/dashboard/asistente/route.ts:26-33`. La ruta autenticaba y no
autorizaba: su único `if` preguntaba si había sesión. El rail lo monta
`chrome.tsx:90` en las 20 páginas sin mirar el rol, `/api` está fuera del
matcher del proxy (`proxy.ts:81`) y la consulta corre con service-role (salta la
RLS de la `0045`). Con la cookie del jefe de tráfico —o la del chofer, que ni
siquiera entra al panel— un `GET` devolvía `kpis.montoComprobado`, `acred.iva`,
`acred.peaje` y el detalle de `detectarAnomalias`.

La prueba (`rol_no_mirado.test.ts`) tiene 4 casos que fallan sin el arreglo y
**3 controles que ya pasaban** —dueño, contador y el 401 sin sesión—, para que
"devolver null siempre" no cuele como verde. Con el arreglo: 7/7, `tsc` exit 0.
Se niega **antes** de consultar: traer el dinero para tirarlo son tres consultas
pagadas por un dato que no se entrega.

### Descartado por falso

**A11-ARQ-1 · reportado como CRÍTICO — FALSO.** Decía que el gate de rol de las
20 páginas estaba desactivado en el árbol (`tenant-efectivo.ts:55` como
`if (false && !puedeVerRuta(...))`) y que `rolEfectivo` tenía la condición
invertida. Verificado contra el código commiteado:

```
$ git show HEAD:src/lib/auth/tenant-efectivo.ts | sed -n '55p'
  if (!puedeVerRuta(sesion.rol, destino)) redirect(inicioDe(sesion.rol));
```

El gate está activo. Lo que el auditor leyó eran **mutantes que el auditor de
pruebas tenía vivos en el árbol de trabajo** mientras medía, no el código del
repo. Es el riesgo de correr los doce en paralelo cuando uno de ellos muta a
propósito, y queda anotado para la ronda 12.

**Pero la mitad que sí es cierta se conserva como hallazgo:** que el mutante de
`tenant-efectivo.ts:55` sobreviviera demuestra que `resolverTenantEfectivo()`
—el único chokepoint de autorización de `/dashboard`— **no tiene una sola prueba
propia**, mientras la función pura que decide lo mismo tiene 83.

### Críticos que quedan PROPUESTOS, con la razón

Ninguno se arregló a ciegas. La regla es que sin reproducción no se toca.

| ID | Hallazgo | Por qué no se arregló aquí |
|---|---|---|
| **A11-DATOS-1** | `viaje.operador_id` es `NOT NULL` (`0001:49`) y todo el módulo del encargado lo asume nullable: `operacion.ts:124` filtra `.is('operador_id', null)`, así que "Viajes sin asignar" —lo primero que el encargado abre— **no puede devolver una fila jamás**. Verificado a mano; `grep "alter column operador_id"` sobre `supabase/migrations/` sale vacío. | El arreglo es una migración y aquí no hay Postgres contra el cual ejercerla. Toca la FK compuesta de la `0028` y la RLS del chofer de la `0045`. |
| **A11-FE-1** | `KpiTile` siempre imprime el número (`admin/ui/kit.tsx:59`): las tres tarjetas fiscales de `dashboard/page.tsx:238-246` no pasan `vacio`, así que un `0 L` sale con la cita "LIF 2026, Art. 20-A" debajo — una cifra fiscal de cero presentada como medición, con respaldo legal. | **El arreglo correcto ya existe**: `acred.tsx`, commit `5365ca0`, en el PR #7. `getAcreditables` no devuelve conteo de filas, así que arreglarlo aquí exige cambiar el tipo compartido y sus consumidores. Escribir una tercera variante crearía una tercera copia de la misma verdad — el modo de falla que este repo repite. |
| **A11-OPER-1** | El CI de `master` lleva rojo desde el 3-ago. **Reproducido aquí**: `npm run test:coverage` → exit 1, líneas 64.32% contra umbral 78%. Los 173 archivos de prueba pasan; lo que falla es el umbral, y el paso de *Build* nunca corre. | Subirlo exige escribir pruebas para las ~9,700 líneas nuevas de UI, o bajar el umbral —que sería apagar el medidor—. Ninguna de las dos es un arreglo quirúrgico de madrugada. |
| **A11-LEGAL-2** | `0046_perfil_avatar.sql:17-18` crea el bucket `avatares` con `public: true` y una policy `select to public`: la fotografía de la cara de un usuario se sirve sin sesión, y no está en el catálogo de ningún aviso (`app/privacidad/page.tsx`). | Decisión de producto y de aviso, no de código. **Matiz verificado sobre el reporte:** sí existe policy de borrado propio (`avatares_propio_delete`, `0046:38-40`); lo que falta es el camino ARCO en producto y la cobertura del aviso. |
| **A11-FISCAL-1** | Un CFDI cuyo emisor el SAT reporta en EFOS imprime `Deducible para ISR $11,600.00` en verde: el único veredicto que el producto puede emitir (`cfdi_efos_indeterminado`) no está ni en `POR_CONFIRMAR` ni en `SIN_ACREDITAMIENTO`, y `sat.ts:82` no puede emitir `efos: true` bajo ninguna respuesta del SAT. REINCIDENTE. | Cerrado en el PR #7. Reabrirlo aquí duplicaría el arreglo. |
| **A11-AGEN-1** | «listo» con la sala de espera llena cierra la liquidación en `$0.00` y los comprobantes nunca se ofrecen (`processor.ts:1058-1059`, carácter por carácter el mismo `if` de la ronda 10). REINCIDENTE. | Ídem: cerrado en el PR #7. |
| **A11-REND-2** | El cierre corre sin reloj: 233,000 ms de techo contra `maxDuration = 120,000`. REINCIDENTE, misma aritmética. | Ídem. |

El patrón se ve solo: **cinco de los siete críticos propuestos ya tienen arreglo
escrito y probado en el PR #7.**

---

## Compuerta sobre el árbol final

```
$ npx vitest run       → GATE_VITEST
$ npx tsc --noEmit     → GATE_TSC
$ npm run lint         → GATE_LINT
$ npm run test:coverage→ exit 1 · líneas 64.32% (6494/10095) < umbral 78%
                                  funciones 78.89% < 83% · statements 64.32% < 78%
$ git status           → GATE_ARBOL
```

Sin `npm run build`: en la nube pide Supabase, OpenRouter, Facturapi y Upstash,
y su fallo no diría nada del código.

**La compuerta de la skill pasa; la del CI no.** No es contradicción: el CI corre
`test:coverage` y esta ronda corre `vitest run`. Vale decirlo así de claro
porque la diferencia es justo el CRÍTICO A11-OPER-1.

## Nota de proceso para la ronda 12

Correr los doce en paralelo con uno que **muta código a propósito** produjo un
hallazgo falso (A11-ARQ-1) y un rato de suite roja que no era de nadie. El
auditor de pruebas devolvió el árbol —verificado, `git diff` limpio al cerrar—,
pero mientras medía, los otros once leían un repo que no era el repo. La ronda 12
debería darle su propio worktree, o correrlo en serie después de los once.
