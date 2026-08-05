# Auditoría 11 — síntesis del PASE 2 (5-ago-2026)

**Fecha:** 5-ago-2026 (demo: **6-ago-2026, mañana**, con Transportes Innovativos).
**Tipo:** **RONDA DE CONTINUACIÓN** sobre `claude/auditoria-11` (PR #8), no ronda nueva.
**Anterior:** el pase 1 de esta misma ronda, 4-ago, global **3.9**. Sus doce
reportes se conservan como `docs/auditoria-11/<rubro>-pase1.md`.
**Sha base del pase 2:** `707c749`. **Modo:** desatendida, en la nube, sin nadie mirando.
**Árbol al arrancar:** limpio → autofix habilitado.

Por qué se relanzaron los doce: entre `50e3047` —cuando se escribieron los
reportes del pase 1— y el HEAD de hoy hay **277 archivos cambiados, +18,531 /
−1,846**. Los doce reportes describían un árbol que ya no existía.

---

## LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE TODO LO DEMÁS

**La rama que audita este PR está 99 commits detrás de `master`.**

Medido después de profundizar el clon (era superficial, ver más abajo):

```
$ git log --oneline HEAD..origin/master | wc -l    → 99
$ git diff --stat HEAD...origin/master | tail -1   → 398 archivos, +77,308 −1,773
$ git merge origin/master                          → 68 CONFLICTOS (abortado)
$ git ls-tree origin/master supabase/migrations/   → 0076   (esta rama: 0047)
```

`master` ya tiene el panel del contador (`/dashboard/contador/*`),
`/dashboard/suscripcion`, `/chofer` en lugar de `/mis-viajes` y **29 migraciones
más**. No se mergeó: reconciliar dos refactors divergentes de madrugada, un día
antes del demo, es exactamente el riesgo que esta rutina existe para bajar.

### Y aun así, dos de los cuatro CRÍTICOS están vivos en `master`

Esto es lo que hay que leer si solo se lee una cosa:

```
$ git show origin/master:src/lib/auth/permisos.ts | grep EXPORTA
const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);

$ git show origin/master:src/lib/auth/visibilidad.ts | grep "/dashboard/chat"
  '/dashboard/chat': 'operacion',
```

- **El jefe de tráfico se baja por `curl` el CSV con el comprobado, el anticipo
  y la diferencia de cada liquidación de la flota** — el dinero que el panel
  acaba de esconderle. Vivo en producción.
- **`/dashboard/chat` le contesta al jefe de tráfico cuánto lleva comprobado la
  flota y cuánto IVA acredita**, desde su propio sidebar. Vivo en producción.

Los arreglos están escritos y probados aquí: `c02f0c4` y `ceb1a13`. Son dos
cambios de una línea cada uno sobre archivos que en `master` están
byte-idénticos, así que se transplantan sin conflicto:

```
git checkout master && git cherry-pick c02f0c4 ceb1a13
```

Los otros dos CRÍTICOS son artefactos de la rama vieja: `master` ya resuelve el
401 del superadmin (por `tenant-api.ts`, distinto y mejor que el arreglo de
aquí) y nunca tuvo la regresión del arranque.

### El error que estuve a punto de reportar

`git merge-base` decía **«historias no relacionadas»** y la lectura obvia era
que alguien había reescrito `master` con un force-push. Es falso: el clon de la
nube es **superficial** (`.git/shallow`), y `git fetch --unshallow` demuestra
que `e4326f9` sí es ancestro común. Queda escrito porque un hallazgo de esa
gravedad, publicado sin comprobarlo, habría mandado al dueño a buscar un
incidente que no ocurrió.

---

## Nota global: 5.7 (antes 3.9, ▲1.8)

| Rubro | Pase 1 | Hoy | | Razón del movimiento |
|---|:--:|:--:|---|---|
| **Tool calling** | 5 | **8** | ▲3 | **Se atacó y subió** — 15 de sus 17 hallazgos del pase 1 verificados como cerrados en el camino que corre, no en la prosa del commit. La regla estructural (`properties: {}`, el modelo decide *cuándo*, nunca *con qué datos*) sigue intacta. Cero críticos. |
| **Frontend** | 5 | **7** | ▲2 | **Se atacó y subió** — 10 de 13 cerrados y verificados hasta el consumidor real. Su CRÍTICO no era de pintura: los botones de export devolvían 401 a quien proyecta el demo. |
| **Backend y API** | 4 | **6** | ▲2 | **Se atacó y subió** — las siete escrituras del encargado traducen el 23505 por nombre de índice, cuentan filas afectadas y comprueban pertenencia. Lo que impide subir más es que la matriz de permisos se partió en dos y la API implementaba la mitad permisiva. |
| **Cumplimiento fiscal** | 3 | **6** | ▲3 | **Se atacó y subió** — los dos CRÍTICOS del pase 1 cerrados, y el auditor lo verificó **ejecutando el motor real** fuera del repo, no leyendo el diff: el EFOS indeterminado sale `Por confirmar · IVA $0 · sin sección ACREDITABLE`, y el RFC del tenant del demo pasa nuestro propio dígito verificador. No llega a 8 porque el $750/día, el 50% del peaje y los litros cuelgan de fichas `evidencia_corroborante`, no de fuente primaria. |
| **Seguridad** | 5 | **6** | ▲1 | **Se atacó y subió en el camino que corre** — el rail tiene dos capas independientes, las rutas de export gatean en servidor, `/acceso` y el passcode están borrados del árbol, el autoregistro por Google se cierra en el único punto por el que pasan los dos caminos. Sube solo un punto porque encontró un CRÍTICO nuevo (el chat) y porque `supabase/migrations/` no se tocó: la RLS del chofer sigue cubriendo 3 de 7 tablas. |
| **Arquitectura** | 5 | **6** | ▲1 | **Se atacó y subió** — pero su CRÍTICO es el mismo que el de backend, encontrado por separado: dos tablas de permisos gobiernan el mismo dinero y las rutas consultan la que no lo niega. Una verdad en dos lugares, divergida a los dos días de nacer la segunda. |
| **Operabilidad y DX** | 4 | **5** | ▲1 | **Se atacó y subió, con un punto que le quita el orquestador.** El auditor midió 6: el CI de la rama está verde con Build incluido y la cobertura pasó de 64.32% a 84.19%. Le resto uno por **mirada más profunda**: nada en el repo ni en la app dice qué versión está viva, y esta ronda entera se gastó auditando un árbol 99 commits detrás del que se despliega. El auditor no podía verlo —el clon superficial lo escondía—, pero es exactamente la pregunta del rubro: si esto revienta a las 3 de la mañana, ¿qué tengo? |
| **Cumplimiento legal** | 3 | **5** | ▲2 | **Se atacó y subió** — el CRÍTICO del pase 1 (`/admin` sirviendo teléfono y transcripción íntegra cruzando flotas) cerrado y verificado hasta el consumidor: seudónimo, redacción, `grep -rn "telefono" src/app/admin/` en cero y una prueba de grep que lo sostiene. El bucket `avatares` baja de CRÍTICO a ALTO: su mitad de ingeniería está cerrada; falta el catálogo del aviso y el camino ARCO. |
| **Sistema agéntico** | 3 | **5** | ▲2 | **Se atacó y subió** — 11 de 14 cerrados con la línea que lo prueba, incluidos los dos CRÍTICOS (`pareceCierre` ya no existe; la afirmación quedó atada al viaje vía `ofrecidoParaViaje`). De once puntos de muerte tabulados, cinco cierran el ciclo con el humano y seis no; el pase 1 cerraba tres de ocho. |
| **Pruebas** | 3 | **5** | ▲2 | **Se atacó y subió** — los tres mutantes que definieron el CRÍTICO del pase 1 (`tenant-efectivo.ts` al 0.0%) hoy mueren los tres. Pero de **37 mutantes aplicados en una copia fuera del repo, 21 sobrevivieron**, y **12 de esos 21 están en `analytics.ts`**, el archivo que alimenta todas las cifras de dinero del panel. La escala dice «4 o menos si la suite pasa con la función rota»; aquí pasa con veintiuna. No baja de 5 porque el motor del cuadre, el rail y las dos rutas de export sí están anclados. |
| **Rendimiento y costo** | 3 | **5** | ▲2 | **Se atacó y subió** — los dos agujeros de 300,000 ms están cerrados con código en el camino que corre: `tools.ts:261` envuelve las subidas en `acotada`, `conv.ts:304` mete el RPC del mutex dentro del bucle, `pg.ts:60` le pone techo a cada página. El techo del peor caso baja de 233,000 a 140,900–194,500 ms. **Sigue sin caber en 120,000**, y por eso no llega a 6. |
| **Modelo de datos** | 4 | **4** | = | **Se atacó y subió en la aplicación, la deuda cobró factura en el esquema.** Los once commits cerraron o mitigaron cada hallazgo del pase 1 **en TypeScript**; `supabase/migrations/` sigue byte-idéntico en `0047` y no ganó una sola restricción. `tenant_self` (`0001:122`) es `for all` para cualquier `app_user` del tenant: el chofer puede reescribir el `rfc` y la `politica` de la flota — el auditado reescribe el reglamento que lo juzga. |

Suma: 68/12 = **5.7**.

### Qué significa que suba 1.8

No es que el código se haya vuelto bueno: es que **el pase 1 midió un árbol con
la deuda de dos rondas encima y el pase 2 mide el mismo árbol con 49 hallazgos
cerrados**. La subida es el trabajo de ayer haciéndose visible, no trabajo de
hoy. Lo que sí es de hoy son los cuatro CRÍTICOS nuevos: tres de ellos los
abrieron los propios arreglos de ayer, y ese es el patrón que hay que mirar —
**seis agentes arreglando en paralelo sobre dominios disjuntos cierran el
agujero de su dominio y abren la costura entre dos**.

Y hay un techo que ningún rubro puede superar mientras la rama no se mergee: la
nota mide un árbol que no es el que se despliega.

---

## Los hallazgos

**Los doce auditores reportaron 12 CRÍTICOS · 45 ALTOS · 48 MEDIOS · 26 BAJOS**
(131 hallazgos).
Al deduplicar por causa raíz quedan **4 CRÍTICOS únicos** (backend y
arquitectura levantaron el mismo por separado). **Cero falsos** — verifiqué los
doce críticos abriendo el archivo; los cuatro sobrevivieron.

### Cerrados con prueba que los reproduce

| ID | Qué era | Commit |
|---|---|---|
| **A11P2-C1** | `puedeExportar('encargado')` es `true` y `puedeVerArea('encargado','dinero')` es `false`. Las dos rutas de export gatean con la primera. **También vivo en `master`.** | `c02f0c4` |
| **A11P2-C2** | `/dashboard/chat` clasificada `'operacion'` mientras pide `getKpis` + `getAcreditables` — la misma caja del rail, a pantalla completa. **También vivo en `master`.** | `ceb1a13` |
| **A11P2-C3** | Las dos rutas de export cortaban en `!s.tenantId → 401` antes de mirar el rol; el superadmin tiene `tenant_id` nulo por diseño. Ya resuelto en `master` por otra vía. | `4504d90` |
| **A11P2-C4** | `startup.ts` llamaba `triggers_desactualizados`, función que no existe en ninguna migración de este repo ni de `master` — solo en la rama del PR #7. Cada boot dejaba de sondear los triggers del dinero. | `381af9d` |

Los cuatro con prueba roja antes del arreglo, controles que ya pasaban, y la
suite completa verde después de cada uno. En C3 la reversión se comprobó con
`git stash`: sin el arreglo, roja.

### Críticos que quedan PROPUESTOS, con la razón

| ID | Hallazgo | Por qué no se arregló aquí |
|---|---|---|
| **SEC-C2** | La RLS del chofer cubre 3 de 7 tablas: `operador`, `terminal`, `politica_gasto` y `wa_conversacion` le dan lectura **y** escritura. REINCIDENTE de las rondas 10 y 11-pase1. | Es una migración y aquí no hay Postgres contra el cual ejercerla. Las dos migraciones de RLS del PR #7 chocan de ordinal, y `master` ya llegó a la 0076: **hay que renumerarlas, no mergearlas.** |
| **DATOS-C2** | `tenant_self` (`0001:122`) es `for all` para cualquier `app_user` del tenant. El chofer, con la anon key, hace `PATCH /rest/v1/tenant` con `{"rfc":"XAXX010101000"}` y apaga la validación de receptor de CFDI de la flota entera. | Ídem: migración, sin base. |
| **AGEN-C1** | Un «listo» sobre un viaje sin comprobantes cierra la liquidación en $0.00, y el cierre es irreversible: no hay guarda determinística en ninguna capa y `addGasto` solo se llama desde `processor.ts`, así que la oficina no puede reparar después. | No es un cambio quirúrgico: exige decidir el comportamiento del producto ante un cierre vacío (¿se niega?, ¿se avisa y se espera?). Es decisión de producto, no de madrugada. |
| **REND-C1** | El cierre corre sin reloj en sus cinco pasos obligatorios: **58,000 ms** de techo sobre un transcurrido que el propio presupuesto acepta en 82,900, contra un `maxDuration` de 120,000. REINCIDENTE. | El arreglo es meter `hayPresupuestoPara` en seis pasos del `processor` y decidir cuál se sacrifica. Hacerlo a ciegas deja liquidaciones a medias, que es peor que tardar. |
| **PRU-C1/C2** | De 37 mutantes, 21 sobreviven; 12 en `analytics.ts`. Cinco lecturas pierden su `.eq('tenant_id', …)` con la suite verde, y `getKpis` no tiene una sola aserción de valor: se duplicó el comprobado de la flota ($47,300 → $94,600) y la suite no parpadeó. | El arreglo es escribir las pruebas que faltan sobre el archivo que alimenta todas las cifras del panel. Es trabajo de una sesión entera, no de una vuelta de arreglo. |

---

## Compuerta sobre el árbol final

Medida con la máquina en reposo, después del último commit:

```
$ npx vitest run     → exit 0 · 273 archivos · 2,554 pruebas (2,553 pasan, 1 saltada) · 46s
$ npx tsc --noEmit   → exit 0
$ npm run lint       → exit 0 · CERO warnings
$ git status         → limpio
```

Línea base al arrancar el pase 2: 269 archivos / 2,530 pruebas. **+4 archivos,
+24 pruebas**, todas anclando los cuatro CRÍTICOS.

Sin `npm run build`: en la nube pide Supabase, OpenRouter, Facturapi y Upstash.

**Sobre la intermitencia:** cuatro auditores reportaron entre 2 y 5 pruebas
rojas (`intake/ocr_imagen_cara`, `intake/ocr_varias_fotos`, `normas/fundamento`,
`intake/codigos`). Todas comparan tiempos de reloj contra umbrales fijos, y
todas pasan solas. **No es una regresión: es que doce auditores corrían la suite
a la vez en la misma máquina.** Con la máquina en reposo, exit 0 dos veces
seguidas. Que la suite dependa de la carga de la máquina sí es un hallazgo, y
está anotado en el rubro de pruebas.

## Nota de proceso para la ronda 12

1. **La prohibición de mutar el árbol compartido funcionó.** El auditor de
   pruebas aplicó 37 mutantes en una copia fuera del repo y devolvió el árbol
   limpio, verificado. Cero hallazgos falsos esta vez, contra uno en el pase 1.
2. **El clon de la nube es superficial.** Cualquier razonamiento sobre historia
   —merge-base, «esta rama está al día», «alguien reescribió master»— exige
   `git fetch --unshallow` **antes**. Va al `MAPA.md` de la ronda 12.
3. **Auditar una rama vieja tiene un costo que no se ve hasta el final.** La
   ronda 12 debe empezar comprobando `git log HEAD..origin/master | wc -l`.
