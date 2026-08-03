# Diario de la ronda 10

Una línea por acción, con su sha. Se escribe mientras avanza, no al cerrar.

## Anclaje

- `848487a` — sha de cierre de la ronda 9 (`docs(auditoria-9): síntesis`). Es
  también `HEAD` de `master` al arrancar esta ronda.
- Árbol **limpio** al arrancar (`git status --porcelain` sin salida) → autofix
  HABILITADO.
- Clon shallow al arrancar (`.git/shallow`, 50 commits). `git fetch
  --unshallow` → 308 commits. **Importante:** sin esto, `git merge-base`
  reportaba falsamente que `master` y `claude/auditoria-8` no tenían ancestro
  común. Toda conclusión sobre divergencia de ramas tomada antes del
  unshallow era un artefacto.
- Delta desde `848487a` en `src/`, `supabase/`, `normas/`: **cero commits**.
- Rama de trabajo creada: `claude/auditoria-10` (prefijo `claude/` obligatorio
  — las routines solo pueden pushear a ramas con ese prefijo).

## Decisión de tamaño de ronda

- PR abierto de auditoría: **#6** (`claude/auditoria-8`), título "Auditoría 8 —
  global 5.5 → 5.7". Existe y está abierto.
- PERO: la ronda 9 ya cerró completa y aterrizó en `master`
  (`docs/auditoria-9/` con sus 12 rubros + tablero + png + síntesis). El PR #6
  es de la ronda **8**, cuyos docs TAMBIÉN están ya en `master`
  (`docs/auditoria-8/` completo, 12 rubros + tablero.png).
- `claude/auditoria-8` bifurcó de `master` en `337e1a8` y quedó **67 commits
  atrás**. Continuar la ronda 8 sobre esa rama hoy produciría un PR cuyo diff
  BORRA las migraciones 0037–0043 y ~10 archivos de prueba que sí están en
  `master`.
- **Juicio:** el PR #6 está superado, no es continuable sobre el árbol de hoy.
  La regla de continuación existe para no encimar PRs, no para revivir una
  ronda que otra ronda ya reemplazó. Se documenta y se reporta al dueño; no se
  continúa sobre él.
- Delta de código desde el cierre de la ronda 9: **cero commits** →
  **RONDA LIGERA, 3 rubros rotados.**
- Rubros elegidos: **cumplimiento fiscal** (7, saltó de 4 en una ronda),
  **frontend** (7, lo que el contralor mira en el demo), **tool calling** (8,
  sin atacar en las rondas 7, 8 ni 9 — único que satisface literalmente el
  criterio de rotación).

## Hallazgo de proceso, antes de auditar una sola línea

El PR #6 lleva **3 arreglos con prueba que nunca aterrizaron en `master`**.
Verificado por ausencia de archivo en el árbol de hoy:

| Arreglo | Prueba que lo acompaña | ¿En `master`? |
|---|---|---|
| Un PDF que Meta rechaza contaba como entregado (AG-1) | `src/lib/cuadra/processor_entrega_rechazada.test.ts` | **NO existe** |
| Un XML que no sabe a qué ticket pegarse inventaba un gasto (BE-1) | `src/lib/cuadra/processor_xml_ambiguo.test.ts` | **NO existe** |
| La liquidación llevaba DOS nombres de producto en la misma hoja (ARQ-1) | `src/lib/cuadra/liquidacion/pdf_un_solo_nombre.test.ts` | **NO existe** |

Los tres son trabajo real, con prueba, perdido en una rama abierta. No es un
hallazgo de código de esta ronda; es un hallazgo de proceso, y va a la
síntesis.

## Línea base de la compuerta (nube: sin `npm run build`)

```
$ npx tsc --noEmit      → exit 0, sin salida
$ npm run lint          → exit 0, sin salida
$ npx vitest run        → exit 0
  Test Files  163 passed (163)
       Tests  1570 passed | 1 skipped (1571)
```

Idéntica a la evidencia declarada por la ronda 9. Verde y reproducible.

## Auditores

- Los 3 lanzados en un solo mensaje, en paralelo, con contexto fresco.
  Ninguno murió al arrancar → no hay fallo de INFRA en el despacho.

## Arreglos (tope: 3 vueltas — se usaron las 3)

| # | Hallazgo | Sev. | Prueba roja antes | Sha |
|---|---|---|---|---|
| 1 | FISCAL-1 · un CFDI marcado por el SAT salía "Deducible para ISR" en verde | ALTO | `efos_indeterminado_no_es_deducible.test.ts` (11600/1600 → 0/0) | `65b90eb` |
| 2 | FE-1 · la tarjeta del panel afirma `0 L` donde nunca midió litros | CRÍTICO | `acred_sin_litros.test.tsx` (3 de 5 rojas con el mutante) | `5365ca0` |
| 3 | FISCAL-2 · los litros del estímulo contaban con cualquier forma de pago ≠ efectivo | ALTO | `diesel_medio_de_pago.test.ts` (99 → 200 L) | `0d1fe65` |

- Suite completa verde después de cada uno. Ninguno se revirtió.
- Los tres verificados por MUTACIÓN: reintroducir el bug pone la prueba en rojo.
- `de4b945` — corrección de tipo en el fixture de la vuelta 3. Se detectó porque
  el comando del commit anterior leía el exit code de `tail` y no el de `tsc`:
  vitest pasaba en verde con `tsc --noEmit` en rojo (TS2739). La compuerta se
  corre ahora sin pipe.

## Trampa evitada, vale anotarla

La primera versión de la prueba de FISCAL-1 pasaba **antes** del arreglo: el
fixture llevaba `empresaRfc: 'REC010101AA1'`, cuyo dígito verificador no cuadra,
y eso disparaba `rfc_receptor_no_verificable` — que YA está en `POR_CONFIRMAR`.
La prueba medía otra regla. Lo delató el caso de control, que también falló.
Sin control, se habría commiteado una prueba que no probaba nada.

## No arreglado, y por qué

- **FE-2 (ALTO)** · el simulador `/demo` afirma "CFDI validado por QR ✅" y dos
  burbujas después se desdice. Verificado contra `demo/page.tsx:38` y
  `api/demo/route.ts:33-40`. **Razón: tope de 3 vueltas agotado.** Primer
  candidato de la ronda 11.
- **La causa de datos de FE-1** · el XML del seed trae `Cantidad="113.00"` y el
  parser nunca la lee. El arreglo escribe en Supabase y aquí no hay base para
  ejercer ese camino. Propuesto, no intentado a ciegas.

## Cierre

- `tablero.html` capturado en `tablero.png` y **mirado**: 12 rubros contados,
  88/12 = 7.3 verificado contra el encabezado, cifras de la compuerta cotejadas
  con la corrida real. La primera captura traía los conteos de severidad mal
  (25 = 1+2+15+7); corregidos a 27 = 1+3+14+9 y recapturado.
- `00-SINTESIS.md` y `RESULTADO.md` escritos.

---

# CONTINUACIÓN — 3-ago-2026 (desatendida, en la nube)

La ronda 10 se reabre sobre su propio PR (#7), que seguía abierto. Regla de
tamaño de ronda: hay PR de auditoría abierto → ronda de continuación sobre esa
misma rama, sin abrir PR nuevo.

- `git status` limpio al arrancar (HEAD desprendido de `master`) → **autofix habilitado**.
- `origin/master` avanzó **58 commits (49 de código, 82 archivos, +5743/-215)**
  mientras el PR esperaba. Mergeado a la rama: `6d4ea7a`. Un solo conflicto,
  `src/app/dashboard/page.tsx` (bloque de imports), resuelto por unión:
  `fechaMx` + `Acred` (del arreglo FE-1 de esta ronda) + `puedeExportar` (del
  auth nuevo). `litros` se cayó porque ya no se usa en ese archivo.
- Compuerta sobre el árbol mergeado, línea base de la continuación:
  `npm test` exit 0 · 173 archivos / 1629 pruebas / 1 saltada · 31.40s.
  `npx tsc --noEmit` exit 0. `npm run lint` exit 0. Sin `npm run build` (nube).
- `MAPA.md` reescrito para la continuación: el delta real, los dos bloques
  nuevos (auth por sesión de Supabase con 5 roles + RLS del chofer; consola
  `/admin` de 39 archivos), y las notas vigentes de los 12.
- Se relanzan **los 12 rubros**, no 3: nueve nunca se auditaron en esta ronda y
  los tres del 2-ago (frontend, fiscal, tool calling) se escribieron contra un
  árbol que ya no existe.
