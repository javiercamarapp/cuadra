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
