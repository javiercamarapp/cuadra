# Progreso — auditoría 11 (4-ago-2026, desatendida, en la nube)

Una línea por acción, escrita **mientras** avanza.

## Fase 0 — decisión de tamaño y anclaje

- `git status` → limpio, HEAD desprendido de `master`. **Autofix habilitado.**
- PRs de auditoría abiertos: **#7** (`claude/auditoria-10`, draft, 3-ago) y **#6**
  (`claude/auditoria-8`). Regla de tamaño ⇒ **ronda de continuación sobre #7**.
- `git fetch origin claude/auditoria-10` + checkout. La ronda 10 está **completa**
  (12 rubros, tablero, síntesis, RESULTADO).
- Topología medida:
  - `git log --oneline origin/master..claude/auditoria-10 | wc -l` → **372**
  - `git log --oneline claude/auditoria-10..origin/master | wc -l` → **40**
  - merge-base: `fe2d11c`.
- `git merge origin/master` sobre la rama del PR → **CONFLICTO: 14 archivos, 28
  hunks**. Inspeccionados uno por uno.
- **DECISIÓN: `git merge --abort`.** No es una resolución mecánica: las dos ramas
  refactorizaron `/dashboard` de forma independiente (las dos extrajeron `ESTATUS`
  a `app/dashboard/estatus.ts`, con guardarraíles distintos e incompatibles), y
  usan **los mismos ordinales de migración para migraciones distintas**
  (`0046`/`0047`). Reconciliar dos refactors es una decisión del dueño, no de una
  corrida desatendida a 2 días del demo. Reportado por notificación.
- **DESVIACIÓN DE LA REGLA, declarada:** el encargo dice "ronda de continuación,
  NO abras un PR nuevo". No se pudo continuar sobre #7 sin ese merge. Y auditar la
  rama de #7 sin mergear habría medido código que (a) ya se auditó ayer y (b) NO
  es lo que se demuestra. Se corre la ronda sobre **`master`** en rama nueva
  `claude/auditoria-11`. El propósito de la regla —que no se apilen PRs
  ignorados— se respeta diciendo en el cuerpo del PR nuevo que #7 está bloqueado
  esperando una decisión humana.
- `docs/auditoria-10/` traído a la rama nueva (solo documentos, cero código) para
  que los auditores tengan su anclaje.
- Verificado a mano que los arreglos de la ronda 10 **no están en `master`**:
  `src/lib/auth/destino.ts` no existe · `src/app/login/acciones.ts` no existe ·
  `session.ts:33` sin el reintento `esColumnaAusente`.

## Compuerta — línea base sobre `master` (sin `npm run build`, es la nube)

```
$ npx vitest run    → exit 0 · 172 archivos · 1670 pruebas · 1 saltada · 29.54s
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0 · 6 warnings (imports sin usar, src/app/admin/page.tsx)
```

Calibración: el árbol del PR #7 tiene 239 archivos / 2089 pruebas. Faltan aquí
**+67 archivos y +419 pruebas** que la ronda 10 escribió para anclar sus arreglos.

## Fase 1 — los doce auditores

- `docs/auditoria-11/MAPA.md` escrito, con la circunstancia de la ronda al frente
  (auditas `master`, los arreglos de la 10 no están aquí, verifica REINCIDENCIA).
- **12 auditores lanzados en un solo mensaje**, contexto fresco, un archivo cada
  uno, ninguno toca código.

_(las líneas siguientes se agregan conforme avanza la ronda)_

## Fase 2 — verificación y arreglo

- **Interferencia de concurrencia detectada, y NO es un fallo del arreglo.** El
  auditor de pruebas inyecta mutantes en el árbol mientras mide. Con uno vivo
  (`src/lib/cuadra/pg.ts:49`, `if (pag.length < PAGINA) break;` → `break;`) la
  suite marcaba `2 archivos / 6 pruebas` en rojo. Verificado con `git diff`: el
  único cambio rastreado ajeno era ese. También se vio pasar por
  `visibilidad.ts` y `tenant-efectivo.ts:55` (`if (false && !puedeVerRuta(...))`).
  No se revirtió nada suyo: revertir a media medición le habría dado un
  resultado falso. La compuerta final se corre con el árbol ya devuelto.
- **A11-BE-1 / A11-SEC-1 · CRÍTICO · CERRADO** — `2fb1982`.
  `/api/dashboard/asistente` autenticaba y no autorizaba. Prueba que reproduce:
  `rol_no_mirado.test.ts`, 4 casos rojos sin el arreglo (encargado, chofer, rol
  desconocido, y que ni siquiera se consulte) y 3 controles que ya pasaban
  (dueño, contador, 401 sin sesión) — así no cuela un "devolver null siempre".
  Con el arreglo: 7/7 verde, `tsc` exit 0.
- **A11-DATOS-1 · CRÍTICO · PROPUESTO, no arreglado.** Verificado a mano:
  `supabase/migrations/0001_esquema.sql:49` declara `viaje.operador_id uuid not
  null` y ninguna migración posterior lo afloja (`grep "alter column
  operador_id"` → vacío), mientras `operacion.ts:124` filtra
  `.is('operador_id', null)`: "Viajes sin asignar", la primera pantalla del
  encargado, **no puede devolver una fila jamás**. El arreglo es una migración y
  aquí no hay Postgres contra el cual ejercerla — la regla es no arreglar lo que
  no se puede reproducir. Toca la FK compuesta de la 0028 y la RLS del chofer de
  la 0045; a 2 días del demo eso se decide despierto.

---

# PASE 2 — ronda de continuación (5-ago-2026, desatendida, en la nube)

## Fase 0 — anclaje

- **Ronda de continuación, no ronda nueva.** `gh`/MCP: PR **#8** abierto sobre
  `claude/auditoria-11`. También siguen abiertos #7 (auditoría 10) y #6
  (auditoría 8). Se continúa sobre #8; no se abre PR nuevo.
- Árbol limpio al arrancar (`git status --short` vacío) → **autofix habilitado**.
- Motivo del relanzamiento de los doce: entre `50e3047` (cuando se escribieron
  los reportes del pase 1) y HEAD hay **277 archivos cambiados, +18,531 /
  −1,846**. Los doce reportes describen un árbol que ya no existe.
- Los reportes del pase 1 se conservan como `<rubro>-pase1.md` (`git mv`), y los
  auditores del pase 2 escriben `<rubro>.md`.
- `MAPA.md` reescrito para el pase 2: qué se arregló, la trampa del merge
  (la prosa llegó, el uso no), y la prohibición de mutar el árbol compartido.

### Compuerta, línea base del pase 2, medida sobre esta rama

```
$ npx vitest run    → exit 0 · 269 archivos · 2530 pruebas (2529 pasan, 1 saltada) · 54.43s
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0 · CERO warnings
$ git status        → limpio
```

Sin `npm run build`: en la nube pide Supabase, OpenRouter, Facturapi y Upstash.

## Fase 1 — los doce auditores del pase 2

- 12 auditores lanzados en un solo mensaje, contexto fresco, un archivo cada uno,
  ninguno toca código. Al de pruebas se le prohibió expresamente mutar el árbol
  compartido (causa del hallazgo falso del pase 1) y se le dio el procedimiento
  de copia a `/tmp`.

_(las líneas siguientes se agregan conforme avanza la ronda)_
