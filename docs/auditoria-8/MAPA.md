# Mapa del repo — para los auditores (ronda 8)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026** con Transportes Innovativos. El comprador es el
**contralor** de la flota. Un error que el contralor vea en la sala cuesta el
trato.

## QUÉ CLASE DE RONDA ES ESTA

**RONDA COMPLETA. Los doce rubros se auditan.** A diferencia de la ronda 7 —que
midió un árbol idéntico al de la 6— aquí **sí hay delta**: **34 commits** tocaron
`src/`, `supabase/` y `normas/` desde `abdc98d` (el sha base de la ronda 7).

```
git diff --stat abdc98d..HEAD -- src/ supabase/ normas/
70 archivos, +4761 −248
```

Las tres razones de movimiento están disponibles hoy: *se atacó y subió*, *deuda
que cobró factura*, *mirada más profunda*. Úsalas con precisión — «mirada más
profunda» significa que **la nota anterior estaba inflada**, no que estuviera
deflactada.

## LO QUE CAMBIÓ DESDE LA RONDA 7 — verificar esto es tu primer trabajo

**Los tres críticos que la ronda 7 dejó pendientes se reportan cerrados.** La
ronda 6 encontró dos veces el modo de falla *«se construyó el mecanismo, se le
escribieron pruebas unitarias, y nunca se conectó»*. Verificar que estos tres de
verdad quedaron cerrados —y no solo tocados— es trabajo obligatorio:

| ID | Qué era | Commit que dice cerrarlo |
|---|---|---|
| **AG-3** | el texto de WhatsApp y el PDF salían de dos fotografías distintas de la base; el mismo viaje con $800 de diferencia y signo contrario | `2f79174` — el cierre usa el snapshot de `guardar_liquidacion`, no recalcula |
| **AG-2** | `guardiaFundamento` corría siempre con `permitidas = []` y borraba normas legítimas: *«conforme al LIF 2026 Art. 20-A»* salía *«conforme al -A»* | `e50510c` — el permiso de citar viaja también con `consultar_politica` |
| **PR-1** | `conv_directo.test.ts:32` mockeaba `.limit()` sin mirar su argumento; cambiar `conv.ts:73` de `.limit(2)` a `.limit(1)` —dinero de una flota anotado en la de otra— era invisible | `8844874` — el mock de `resolveOperador` ahora SÍ mira `.limit(n)` |

**Bloques grandes de cambio, por si tocan tu rubro:**

- **Seguridad / esquema:** `0035_search_path_fijo.sql`, `0036_no_gastos_tras_liquidar.sql`
  (cierre: nada entra después de emitida la liquidación), `0031_intake_barrera_ttl.sql`,
  `0032_politica_gasto_muerta.sql`. Migraciones **31 → 36**. `verificaciones.sql`
  creció +409 líneas. Hubo un barrido de producción atacando como anónimo.
- **Legal / privacidad:** `src/app/privacidad/page.tsx` (política de Likida, que
  es **otro** documento que el aviso de la flota), `src/app/aviso/[tenant]/page.tsx`,
  `0033_aviso_reserva_aparte.sql` (reserva y constancia dejan de ser la misma
  fila), `0034_tenant_contacto_privacidad.sql`.
- **Dominio:** `cuadra.mx` **no es nuestro** y estaba impreso en cada PDF de
  liquidación (`87daa62`); el software se muda a `app.likida.ai` (`93be38a`).
  `src/lib/dominio_propio.test.ts` es nuevo.
- **Formato:** `src/lib/formato.ts` es **nuevo** — una sola definición de cómo se
  imprime una cifra (`60538b3`, cierra el reincidente x4 de los litros).
- **Facturación:** catálogo de comercios 13 → 33 → **37 portales**; cosecha CRE
  cerrada con **12,625 permisos** (`permisos_cre.json`); `permiso_cre.ts` nuevo,
  identifica la gasolinera por su permiso con tres estados.
- **Intake:** el voucher de terminal dejaba de contar el mismo gasto dos veces
  (`91da5f4`); contrato de la nota no fiscal en pesos y gratis (`ce867a1`); la
  lista de motivos de fallo de OCR tiene un solo origen (`c56dfbd`).
- **Concurrencia (`processor.ts`):** tres arreglos ALTO de la ronda anterior —el
  mensaje que pierde el mutex avisa y libera su claim; el `+1` de la barrera y su
  `-1` gemelo son simétricos ante el error; `ctxCerro` se actualiza también en el
  cierre parcial recuperado.
- **CI:** dos pruebas de tiempo existían y CI no las corría ni una vez (`cb392f5`);
  `pruebas_en_ci.test.ts` es nuevo.
- **Observabilidad:** Sentry vivo y verificado de punta a punta (`94d0174`).

## El patrón que ya apareció CINCO veces

*Un fallo de consulta disfrazado del valor que significa "no hay".*

| Dónde | Decía | Era |
|---|---|---|
| `startup.ts` | "FALTA la migración 0005" | `TypeError: fetch failed` |
| `conv.ts` · `resolveOperador` | "no te tengo registrado" | la base no contestó |
| `conv.ts` · `getOpenViaje` | "ese viaje ya quedó cerrado 👍" | la base no contestó |
| `conv.ts` · `intakeDelta` | "no hay fotos en vuelo" | la RPC devolvió error |
| `config.ts` | la política de la demo | PostgREST devolvió `error` por valor |

La ronda 6 descartó por escrito `analytics.ts`, `costos.ts` y `repo.ts`. Si hay
un **sexto** lugar, no está en esos tres — y **el código nuevo de esta ronda no
ha sido revisado con esta lente todavía** (`permiso_cre.ts`, `formato.ts`, las
páginas de privacidad, `intake/voucher`).

## Lo que está abierto y NO es código

No lo reportes como hallazgo tuyo; depende del cliente o de infraestructura:

- El RFC de la flota (con el genérico, toda factura sale *a revisión*, que es lo
  correcto).
- `cuota-diesel` y `vigilancia-normativa` llevan varias corridas **bloqueadas por
  egress de la sesión** (`0769d77`, `90569ef`). Es `INFRA`, no un hueco del rubro.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O. `guardia.ts` (cifras), `estado_afirmado.ts`, `cifras.ts`, `resumen.ts`,
  `leyendas.ts`, `desde_db.ts`.
- `src/lib/cuadra/normas/` — `indice.ts`, `fundamento.ts` (`guardiaFundamento`),
  `por_diferencia.ts`. Fuente de verdad: los YAML de `normas/` (**22 fichas**).
- `src/lib/cuadra/facturacion/` — `comercios.ts` (**37 portales**),
  `identificar.ts`, `caducidad.ts`, `permiso_cre.ts`, `permisos_cre.json`.
- `src/lib/cuadra/intake/` — `ocr.ts`, `cfdi.ts` (zxing), `sat.ts`, `emparejar.ts`,
  `decidir.ts`, `sanitizar.ts`, `concepto.ts`, `fecha.ts`, `hash.ts`, `voucher`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts`, `deducibilidad.ts`, `acreditable.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts`, `repo.ts` (TODO el acceso a datos),
  `conv.ts`, `presupuesto.ts`, `privacidad.ts`, `config.ts`, `costos.ts`,
  `analytics.ts`, `startup.ts`, `tools.ts`, `barrera.ts`, `export.ts`.
- `src/lib/` — `formato.ts` (**nuevo, un solo origen del formato de cifras**),
  `utils.ts`, `logger.ts`, `ratelimit.ts`, `env.ts`.
- `src/lib/llm/`, `src/lib/agents/`, `src/lib/meta/client.ts`, `src/lib/auth/`,
  `src/lib/observability/`, `src/proxy.ts`.
- `src/app/(dashboard)/`, `src/app/privacidad/`, `src/app/aviso/[tenant]/`.
- `src/app/api/webhook/whatsapp/route.ts` — `maxDuration = 120`.
- `supabase/migrations/` — **36 archivos**. `supabase/verificaciones.sql`.

## Convenciones

- TypeScript estricto. Comentarios en español, explicando **por qué**.
- **Ninguna cifra que vea el usuario sale del LLM.** `guardia.ts` y `cifras.ts` lo
  imponen en código.
- El catálogo de comercios y el de normas son **datos, no código**.
- Las tools declaran `properties: {}` **a propósito**: el modelo decide *cuándo*,
  nunca *con qué datos*. **No es un hallazgo.** Lo que sí hay que vigilar es que
  ninguna tool nueva rompa esa regla.

## Línea base verificada por el orquestador, hoy, en esta máquina

```
npm test        1262 pruebas, 1 saltada, 127 archivos   exit 0   (ronda 7: 1119 / 112)
npx tsc --noEmit                                        exit 0
npm run lint (eslint)                                   exit 0
```

El clon vino **sin `node_modules`**; se corrió `npm ci` antes de tomar la base.

## Estás en la NUBE, no en la máquina local

No hay `.env`, ni Supabase, ni OpenRouter, ni credenciales de ningún tipo.

- **SÍ:** `npm test`, `npx tsc --noEmit`, `npm run lint`, leer, buscar, y scripts
  temporales con `npx tsx` que importen módulos **puros** (sin red ni base).
  Importar el módulo real y transcribir su salida vale mucho más que suponer.
- **NO** corras `npm run build`: pide credenciales que aquí no existen y su fallo
  no dice nada del código.
- **NO** corras `pruebas-manuales/*.prueba.ts`: hacen llamadas reales de pago.

Para conclusiones que dependan de una AUSENCIA, corrobóralo con **dos búsquedas**
distintas antes de afirmarla.

## No toques

- **No modifiques NINGÚN archivo del repo.** Auditoría de solo lectura: tú
  encuentras y calificas, el orquestador arregla.
- No escribas fuera de `docs/auditoria-8/<tu-rubro>.md`.

## Auditoría anterior

`docs/auditoria-7/00-SINTESIS.md`, global **5.5**, y —si tu rubro se auditó ahí—
tu propio `docs/auditoria-7/<tu-rubro>.md`. La ronda 7 fue **ligera**: solo
auditó agéntico, arquitectura y pruebas. Para los otros nueve rubros el reporte
vigente es el de `docs/auditoria-6/<tu-rubro>.md`. **Léelo antes de calificar.**
