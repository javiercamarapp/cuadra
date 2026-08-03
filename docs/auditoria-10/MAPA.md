# Mapa del repo — para los auditores (ronda 10, **continuación del 3-ago-2026**)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México.
Pre-revenue, sin clientes. Demo **6-ago-2026** (3 días). El comprador es el
**contralor** de la flota. Un error que el contralor vea en la sala cuesta el
trato.

## QUÉ CLASE DE RONDA ES ESTA, Y POR QUÉ IMPORTA PARA TU TRABAJO

**RONDA DE CONTINUACIÓN sobre el PR #7 (`claude/auditoria-10`), que sigue
abierto.** El 2-ago esta ronda corrió LIGERA: 3 rubros rotados (frontend,
fiscal, tool calling) porque el delta de código desde la ronda 9 era cero. Hoy
3-ago la situación es la opuesta:

```
$ git log --oneline 96dc577..HEAD -- src/ supabase/ normas/ | wc -l
49
$ git diff --stat 96dc577..HEAD -- src/ supabase/ normas/ | tail -1
 82 files changed, 5743 insertions(+), 215 deletions(-)
```

`master` avanzó 58 commits (49 de código) mientras el PR esperaba. La rama de
la auditoría ya tiene ese `master` mergeado (`6d4ea7a`, un solo conflicto en
`src/app/dashboard/page.tsx`, resuelto tomando la unión de imports: `fechaMx` +
`Acred` del arreglo FE-1 de esta ronda, `puedeExportar` del auth nuevo).

Por eso la ronda **se abre a los 12 rubros**: nueve nunca se auditaron en la
ronda 10, y los tres que sí (frontend, fiscal, tool calling) se escribieron
contra un árbol que ya no existe. **No es una ronda ligera.** Es la ronda 10
completada sobre código nuevo.

**Lo que cambió es enorme y toca casi todos los rubros.** Dos bloques:

### Bloque 1 — Autenticación real, reemplazando el passcode (≈30 commits)

Esto es lo más grande que le ha pasado al repo desde el motor de cuadre. El
panel dejó de abrirse con un passcode compartido y ahora exige sesión de
Supabase.

- `src/lib/auth/session.ts` · `guard.ts` (`requireSessionTenant`, reemplaza a
  `exigirAcceso`) · `permisos.ts` (funciones puras por rol) · `provisionar.ts`
  (alta de usuario en `app_user`) · `passcode.ts` (¿sigue vivo? ¿quién lo usa?).
- `src/proxy.ts` — el gate de `/dashboard` valida sesión de Supabase, ya no
  passcode. Cabeceras de seguridad, refresh de sesión, redirect a `/login`
  arrastrando cookies.
- `src/app/login/` (magic link + Google, `shouldCreateUser:false`, límite por
  IP) · `src/app/auth/callback/route.ts` · `src/app/cuenta/` ·
  `src/app/sin-acceso/`.
- **Cinco roles**, incluido `encargado` (mig. `0044`) y el chofer con
  **RLS propia** (mig. `0045_rls_operador.sql`).
- `src/app/mis-viajes/` — panel de solo lectura del chofer.
- El `tenantId` sale de la sesión, ya no de `DEMO_TENANT_ID`; export CSV/PDF
  gateados por rol.

### Bloque 2 — Consola de superadmin `/admin` (≈20 commits, 39 archivos nuevos)

`src/app/admin/` con 26 páginas nuevas, sidebar, gráficas en CSS, chat de
asistente, contadores. `src/lib/admin/negocio.ts` detrás.

**Advertencia honesta para quien audite esto:** buena parte de `/admin` parece
ser UI de escaparate construida a gran velocidad en un día. Antes de reportar
que una página "no tiene datos reales", verifica si es una pantalla de maqueta
declarada como tal o si presume datos que no tiene. La segunda es hallazgo; la
primera, a lo sumo, deuda. Y pregunta lo que importa: **¿está `/admin` detrás
de autorización de verdad, o solo detrás de un matcher?**

## Tu encargo

1. **Audita tu rubro sobre el árbol de hoy.** El código nuevo es el 80% del
   riesgo de esta ronda.
2. **Lee tu archivo de la ronda anterior antes de empezar**:
   `docs/auditoria-9/<tu-rubro>.md`, y también `docs/auditoria-10/<tu-rubro>.md`
   si existe (solo existe para frontend, fiscal y tool calling). Los hallazgos
   que quedaron abiertos ahí se verifican **primero** y se reportan como
   REINCIDENTE si siguen.
3. **Si tu nota previa está inflada, bájala** con la razón *mirada más
   profunda*. Que la global baje es un resultado válido.

## De dónde vienes — notas vigentes

| Rubro | Nota | Fuente |
|---|:--:|---|
| Pruebas | 9 | ronda 9 |
| Sistema agéntico | 8 | ronda 9 |
| Backend y API | 8 | ronda 9 |
| Modelo de datos | 8 | ronda 9 |
| Rendimiento y costo | 8 | ronda 9 |
| Seguridad | 8 | ronda 9 |
| Cumplimiento legal | 7 | ronda 9 |
| Operabilidad y DX | 7 | ronda 9 |
| Arquitectura | 7 | ronda 9 |
| Tool calling | 7 | ronda 10 (bajó de 8, mirada más profunda) |
| Cumplimiento fiscal | 6 | ronda 10 (bajó de 7, mirada más profunda) |
| Frontend | 5 | ronda 10 (bajó de 7, mirada más profunda) |

Global vigente: **7.3**.

**Pendiente conocido y verificado, sin arreglar (frontend):** FE-2 (ALTO) — el
simulador `/demo` afirma «CFDI validado por QR ✅» y dos burbujas después se
desdice. `src/app/demo/page.tsx:38` y `src/app/api/demo/route.ts:33-40`. Se
agotó el tope de 3 vueltas de arreglo el 2-ago.

## Un PR viejo que NO está en `master` — contexto, no trabajo tuyo

El PR #6 (`claude/auditoria-8`) sigue abierto y lleva 3 arreglos con prueba que
**nunca aterrizaron en `master`**: `processor_entrega_rechazada.test.ts` (un PDF
que Meta rechaza contaba como entregado), `processor_xml_ambiguo.test.ts` (un
XML que no sabe a qué ticket pegarse inventaba un gasto), y
`pdf_un_solo_nombre.test.ts` (la liquidación llevaba DOS nombres de producto en
la misma hoja). Ninguno de esos tres archivos existe en el árbol de hoy.
**No los des por arreglados.**

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` puro y sin
  I/O. `guardia.ts`, `resumen.ts`, `cifras.ts`, `leyendas.ts`,
  `fecha_dudosa.ts`.
- `src/lib/cuadra/processor.ts` — el pegamento: WhatsApp → intake → agente →
  respuesta.
- `src/lib/cuadra/repo.ts`, `repo_operadores.ts` — acceso a datos.
- `src/lib/cuadra/intake/` — OCR y decisión de qué hacer con cada foto/XML:
  `ocr.ts`, `decidir.ts`, `emparejar.ts`, `cfdi_xml.ts`, `cfdi.ts`, `sat.ts`,
  `pedir_fecha.ts`.
- `src/lib/cuadra/liquidacion/` — `deducibilidad.ts`, `pdf.ts`.
- `src/lib/cuadra/facturacion/` — `permiso_cre.ts` (tabla de 12,625 permisos
  CRE).
- `src/lib/cuadra/normas/` — `fundamento.ts` (guardia de citas),
  `por_diferencia.ts`.
- `src/lib/cuadra/tools.ts` — definición de tools.
- `src/lib/llm/` — `openrouter.ts` (`generateWithTools`, `generateStructured`),
  `models.ts`, `tool-executor.ts`.
- **`src/lib/auth/`** — `session.ts`, `guard.ts`, `permisos.ts`,
  `provisionar.ts`, `passcode.ts`. **NUEVO, sin auditar nunca.**
- **`src/proxy.ts`** — el gate. **Reescrito, sin auditar.**
- `src/app/` — `dashboard/`, **`admin/` (NUEVO, 39 archivos)**, **`login/`**,
  **`auth/callback/`**, **`cuenta/`**, **`sin-acceso/`**, **`mis-viajes/`**,
  `demo/`, `acceso/`, `aviso/`, `privacidad/`, `api/`, `globals.css`.
- **`src/lib/admin/negocio.ts`** — la capa de datos de `/admin`. NUEVO.
- `src/types/cuadra.ts` — los tipos que el panel debe reflejar.
- `normas/*.yaml` — **22 fichas**, fuente de verdad fiscal y legal.
- `supabase/migrations/` — hasta la **`0045`** (`0044_rol_encargado.sql`,
  `0045_rls_operador.sql` son nuevas). `supabase/verificaciones.sql` es nuevo.

## La compuerta, hoy, ya corrida (línea base de esta ronda)

Esta ronda corre **en la nube**: no hay `.env`, ni Supabase, ni OpenRouter.
Por eso la compuerta es `npm test` + `npx tsc --noEmit` + `npm run lint`, sin
`npm run build` (pide credenciales que aquí no existen y su fallo no dice nada
del código).

```
$ npx tsc --noEmit      → exit 0, sin salida
$ npm run lint          → exit 0, sin salida
$ npm test              → exit 0
  Test Files  173 passed (173)
       Tests  1629 passed | 1 skipped (1630)
  Duration 31.40s
```

Contra la línea base del 2-ago (163 archivos / 1570 pruebas): **+10 archivos de
prueba, +59 pruebas** para +5743 líneas de código. Ese cociente es en sí mismo
un dato para los rubros de pruebas y arquitectura.

El árbol estaba **limpio** al arrancar → autofix habilitado.

## Qué NO tocar

`pruebas-manuales/*.prueba.ts` hacen llamadas reales de pago — **no se
corren**. `npm run build` **no se corre** (pide credenciales). No editar
código: los auditores encuentran y califican, el orquestador arregla después.
