# Progreso — auditoría 17 (8-ago-2026)

Una línea por acción, con su sha. Se escribe MIENTRAS avanza, no al cerrar.

| # | Acción | Resultado | sha |
|---|---|---|---|
| 1 | `git status` al arrancar | **limpio** (HEAD detached en `94c0733`) → autofix HABILITADO | — |
| 2 | Decisión de tamaño de ronda | **COMPLETA** — ver nota abajo | — |
| 3 | Rama `claude/auditoria-17` creada desde `origin/master` (`94c0733`) | ok | — |
| 4 | `npm ci` | 623 paquetes; `npm audit`: 13 vulns (2 críticas, 8 altas, 3 moderadas) | — |
| 5 | Compuerta base `npx tsc --noEmit -p .` | **0 errores** | — |
| 6 | Compuerta base `npx vitest run` | **249 archivos, 3148 pasan, 1 saltada** | — |
| 7 | Compuerta base `npm run lint` | **0 errores, 18 warnings** | — |
| 8 | `MAPA.md` escrito | ok | — |
| 9 | 12 auditores lanzados en paralelo, un archivo cada uno | — | — |

## Por qué esta ronda es COMPLETA y no de continuación

El PASO 1 del encargo manda continuar si hay PR de auditoría abierto. Hay **tres**
abiertos (#6 `claude/auditoria-8`, #7 `claude/auditoria-10`, #8 `claude/auditoria-11`),
pero ninguno es un destino válido de continuación:

- `origin/master` está **50 commits adelante de los tres**, y las ramas divergieron
  83, 441 y 251 commits respectivamente.
- El propio último commit de `claude/auditoria-11` se titula *"la rama 99 commits
  detrás de master"*.
- Master ya absorbió las rondas **12 a 16** por su cuenta y luego borró
  `docs/auditoria-*` completo en `bc39cc1` ("limpieza total").

Continuar sobre `claude/auditoria-11` y hacer `--force` habría producido un PR cuyo
diff **revierte** las rondas 12–16 y la limpieza. Eso no es una continuación, es una
regresión. La última ronda real (la 16) aterrizó directo en master sin PR, así que
para la línea de trabajo viva **no hay PR abierto**, y sí hubo commits en `src/`,
`supabase/` y `normas/` (368 archivos, +1719/−1169 desde `4e866fc`) → **RONDA COMPLETA**.

**Pendiente para el dueño:** los PRs #6, #7 y #8 están muertos y conviene cerrarlos.
Mientras sigan abiertos, la regla de continuación del PASO 1 va a apuntar a ellos en
cada corrida.
