# MAPA — auditoría 17 (8-ago-2026)

## Ronda y anclaje

- Rama: `claude/auditoria-17` (desde `origin/master` = `94c0733`).
- Ronda anterior con **tabla completa de notas**: la **13** (global 7.2/10).
  Las rondas 14, 15 y 16 fueron de arreglo/re-auditoría y NO regrabaron los 12
  rubros. Por eso el delta de esta ronda se mide contra la 13.
- `docs/auditoria-*` fue **borrado de master** en `bc39cc1` ("limpieza total").
  Los reportes viejos solo existen en historia de git (`git show bc39cc1^:docs/auditoria-13/00-SINTESIS.md`).
- Desde la ronda 16 (`4e866fc`) hasta HEAD: **368 archivos cambiados,
  +1719 / −1169**. Cambio dominante: el renombre de marca `Cuadra → Likida`
  (`src/lib/cuadra/` → `src/lib/likida/`), la migración `0085`, el nuevo
  "Resumen de flota" del dashboard y los latidos de `normas/`.

## Compuerta (línea base real de esta ronda, corrida hoy)

```
npx tsc --noEmit -p .   → 0 errores
npx vitest run          → 249 archivos, 3148 pruebas verdes, 1 saltada
npm run lint            → 0 errores, 18 warnings (no-unused-vars)
```

**NO se corre `npm run build`**: en la nube no hay Supabase/OpenRouter/Facturapi/Upstash
y su fallo no dice nada del código.
**NO se corre `pruebas-manuales/*.prueba.ts`**: hacen llamadas reales de pago.

## Dónde está todo (rutas REALES — ojo, cambiaron)

Las referencias viejas hablan de `src/lib/cuadra/`. **Esa carpeta ya no existe.**
Hoy es `src/lib/likida/`. Si un path del brief no existe, búscalo bajo `likida/`.

| Área | Ruta real |
|---|---|
| Motor de cuadre / dinero | `src/lib/likida/cuadre/` (`engine.ts`, `guardia.ts`, `resumen.ts`, `desde_db.ts`) |
| Liquidación y PDF | `src/lib/likida/liquidacion/` (`deducibilidad.ts`, `pdf.ts`) |
| Intake (OCR, CFDI, SAT) | `src/lib/likida/intake/` |
| Repositorio / acceso a datos | `src/lib/likida/repo.ts`, `pg.ts`, `pg_errores.ts` |
| Orquestación conversacional | `src/lib/likida/processor.ts`, `conv.ts`, `barrera*.ts`, `presupuesto.ts`, `startup.ts` |
| Tools del modelo | `src/lib/likida/tools.ts` |
| Agentes | `src/lib/agents/` (`run.ts`, `registry.ts`, `prompts.ts`) |
| LLM / proveedor | `src/lib/llm/` |
| Auth y permisos | `src/lib/auth/`, `src/proxy.ts` |
| Panel cliente | `src/app/dashboard/` (~31 páginas, filtradas al tenant) |
| Consola superadmin | `src/app/admin/` (cruza tenants a propósito: `src/lib/admin/negocio.ts`) |
| API | `src/app/api/` |
| Formato de cifras | `src/lib/formato.ts` (**única** fuente; hay prueba que lo exige) |
| Tipos | `src/types/` |
| Esquema | `supabase/migrations/` (82 archivos, hasta `0085`), `supabase/verificaciones.sql` |
| Normas fiscales/legales | `normas/` (24 fichas YAML) — **fuente de verdad** |
| Observabilidad | `src/lib/observability/`, `src/lib/logger.ts`, `src/instrumentation.ts` |
| Analytics del panel | `src/lib/likida/analytics.ts` |

## Reglas del producto que NO se rompen (del CLAUDE.md)

1. **Nunca inventar una cifra.** Si no hay dato real, se dice qué falta y por qué
   (`dashboard/pendiente.tsx`, `EstadoVacio`). Ni datos de ejemplo ni ceros que
   parezcan medición. Una estimación se muestra declarada y con su supuesto a la
   vista (`MINUTOS_CAPTURA_MANUAL` en `analytics.ts`).
2. **Un rótulo tiene que ser verdad.** Si dice "del periodo", la consulta filtra
   por fecha. Un filtro en pantalla mueve TODO lo que hay debajo.
3. **El formato de cifras vive solo en `lib/formato.ts`.** Hay prueba que falla si
   aparece `toLocaleString('es-MX')` en otro archivo.
4. **Fallar cerrado y decirlo.** supabase-js reporta errores POR VALOR: sin
   comprobar `error`, una base caída se lee como "no hay nada". Ver `exigir()` y
   `traerTodo()` en `analytics.ts` (PostgREST recorta a 1,000 filas en silencio).

## Trampas ya pisadas (NO reportar como hallazgo nuevo)

- `gasto.ocr_raw` está **muerta** — `repo.ts` escribe `ocr_confianza`/`ocr_extra`.
  La prueba de que algo pasó por OCR es `ocr_confianza`.
- La tabla `politica_gasto` está **muerta**. La política viva es
  `tenant.config.politica`, vía `getConfig()`.
- `wa_mensaje_procesado` **no tiene** `tenant_id`: no se puede atribuir a una flota.
- `viaje.estatus` solo admite `abierto | en_cuadre | liquidado` (constraint
  `viaje_estatus_dominio`). `app_user.rol`: superadmin, flota_admin, contador,
  operador, encargado.
- `cliente`, `unidad`, `tarifa`, `factura_emitida`, `pago_recibido`, `posicion` y
  `geocerca` **SÍ existen** (migs. 0047–0050) y `viaje` tiene `km_recorridos` e
  `ingreso_flete`. Están **vacías**: nadie las escribe todavía. Antes de usarlas,
  mira si tienen filas; si no, la pantalla dice qué falta.
- `requireSessionTenant(destino)` arma su redirect a /login con string fijo y
  **pierde el query string** — por eso existe `dashboard/sufijo.ts`.
- Las tools declaran `properties: {}` **a propósito**: el modelo decide *cuándo*,
  nunca *con qué datos*; `tenantId`/`viajeId` salen del contexto resuelto en
  servidor. Eso cierra la inyección de prompt de forma estructural. Proponer
  "validar mejor los argumentos" = no leíste el código. Lo que sí se vigila es
  que ninguna tool **nueva** rompa esa regla.

## Contexto de negocio

Likida liquida viajes de autotransporte federal de carga por WhatsApp, para flotas
en México. Pre-revenue, sin clientes. El comprador es el **contralor de la flota**.
Demo el 6-ago-2026 con Transportes Innovativos. Un error que el contralor vea en la
sala cuesta el trato.
