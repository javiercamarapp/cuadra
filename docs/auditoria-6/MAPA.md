# Mapa del repo — para los auditores (ronda 6)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026**. El comprador es el **contralor** de la flota.
Un error que el contralor vea en la sala cuesta el trato.

## LA PREGUNTA DE ESTA RONDA, Y ES UNA SOLA

**¿Qué abrieron al cerrarse los 55 arreglos de ayer?**

La ronda 5 encontró 18 críticos y 37 altos, y **los 55 se cerraron el mismo día**,
muchos sobre el motor del dinero y todos con prisa de demo. Ese es exactamente el
sitio donde se esconde el siguiente bug, y este repo ya tiene precedente: en la
ronda 4, *el arreglo de un crítico de la ronda 3 abrió un crítico peor*.

Y ayer volvió a pasar, dos veces, en el mismo día:

- Al descartar un RFC de empresa mal formado por la mañana se cambió *"rechaza
  todo"* por **"aprueba todo"**: un CFDI de $11,600 timbrado a un TERCERO salía
  deducible, con $1,600 de IVA acreditable y cero diferencias.
- Al subir `maxDuration` se rompió el invariante que lo ata a
  `PRESUPUESTO_WEBHOOK_MS` y **se empujó en rojo**, porque el comando se encadenó
  con `;` en vez de `&&`.

**Tu trabajo no es confirmar que los 55 arreglos funcionan. Es preguntarte qué
rompieron.** Especialmente los que se escribieron en paralelo: siete agentes
distintos tocaron el repo a la vez, cada uno en su territorio, y nadie miró las
costuras entre territorios.

## Un patrón que apareció CUATRO veces en un día — búscalo otra vez

*Un fallo de consulta disfrazado del valor que significa "no hay".*

| Dónde | Decía | Era |
|---|---|---|
| `startup.ts` | "FALTA la migración 0005" | `TypeError: fetch failed` |
| `conv.ts` · `resolveOperador` | "no te tengo registrado" | la base no contestó |
| `conv.ts` · `getOpenViaje` | "ese viaje ya quedó cerrado 👍" | la base no contestó |
| `conv.ts` · `intakeDelta` | "no hay fotos en vuelo" | la RPC devolvió error |

Las cuatro se encontraron **por separado**, en sitios distintos y por auditores
distintos. Si sigue vivo en un quinto lugar, esta ronda es la que tiene que
encontrarlo. Mira especialmente `repo.ts`, `analytics.ts`, `config.ts` y
`costos.ts`.

## Lo que cambió desde la ronda 5

Once commits, y estos son los que más superficie mueven:

- **`conv.ts`** — `intakeDelta` devuelve `null` (no 0) cuando falla; la barrera de
  ráfaga es fail-closed; `resolveOperador` pide dos filas y lanza `OperadorAmbiguo`
  en vez de elegir.
- **`processor.ts`** — sin aviso de privacidad **no hay tratamiento** (se detiene y
  no manda la foto al modelo); el acuse va atado al primer comprobante del viaje;
  el `catch` general lleva tenant, viaje y `cerroSinEntregar`.
- **`cuadre/estado_afirmado.ts`** (nuevo) — guardia que desmiente al modelo cuando
  afirma un cierre que no ocurrió.
- **`normas/fundamento.ts`** — la limpieza usa el MISMO patrón que la detección, y
  la ventana que liga la cita a la ley pasó a lazy.
- **`meta/client.ts`** — `sendText` devuelve el wamid; los fallos de descarga de
  media ya no son mudos.
- **`webhook/route.ts`** — se leen los acuses de entrega (`value.statuses`).
- **`auth/passcode.ts`** — token con hora y nonce, caducidad en el servidor, y la
  fuerza del passcode exigida por código.
- **`repo.ts`** — `TOPE_CONSULTA_MS` impuesto en las 17 llamadas; paginación en
  `getAcumuladoCombustible`.
- **`liquidacion/acreditable.ts`** (nuevo), **`dashboard/estado.ts`** (nuevo),
  **`dashboard/formato.ts`** (nuevo), **`observability/arranque.ts`** (nuevo).
- **Migraciones 0022 y 0024–0026, 0028–0029 aplicadas en producción.** La **0027
  está escrita y SIN aplicar** a propósito.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O. `guardia.ts` (cifras), `estado_afirmado.ts` (afirmaciones de estado),
  `cifras.ts`, `resumen.ts`, `leyendas.ts`, `desde_db.ts`.
- `src/lib/cuadra/normas/` — `indice.ts`, `fundamento.ts` (`guardiaFundamento`),
  `por_diferencia.ts`. Fuente de verdad: los YAML de `normas/`.
- `src/lib/cuadra/facturacion/` — `comercios.ts` (13 comercios), `identificar.ts`,
  `caducidad.ts`.
- `src/lib/cuadra/intake/` — `ocr.ts`, `cfdi.ts` (zxing), `sat.ts`, `emparejar.ts`,
  `decidir.ts`, `sanitizar.ts`, `concepto.ts`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts`, `deducibilidad.ts`, `acreditable.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts`, `repo.ts` (TODO el acceso a datos),
  `conv.ts`, `presupuesto.ts`, `privacidad.ts`, `config.ts`, `costos.ts`,
  `analytics.ts`, `startup.ts`, `tools.ts`.
- `src/lib/llm/`, `src/lib/agents/`, `src/lib/meta/client.ts`, `src/lib/auth/`,
  `src/lib/observability/`, `src/proxy.ts`.
- `src/app/api/webhook/whatsapp/route.ts` — `maxDuration = 120`.
- `supabase/migrations/` — 29 archivos. `normas/` — 21 fichas YAML.

## Convenciones

- TypeScript estricto. Comentarios en español, explicando **por qué**.
- **Ninguna cifra que vea el usuario sale del LLM.** `guardia.ts` y `cifras.ts` lo
  imponen en código.
- El catálogo de comercios y el de normas son **datos, no código**.

## Línea base ya verificada por el orquestador

**990 pruebas (103 archivos, 1 saltada), `tsc` 0, `eslint` 0, `npm run build` 0.**
Cobertura **79.7% líneas · 85.1% ramas**, con umbral que rompe el CI si baja.

## Estás en la máquina local

Hay `.env.local` con credenciales REALES. Puedes gastar dinero y tocar datos.

- **SÍ:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, leer,
  buscar, y scripts temporales en `/tmp` con `npx tsx`. Importar el módulo real y
  transcribir su salida vale mucho más que leer y suponer.
- **NO** corras nada con `TICKET_PATH` ni `pruebas-manuales/*`: llamadas reales de
  pago.
- **NO escribas en Supabase.** Leer está bien.
- **NO mandes mensajes por la API de Meta.**

Para conclusiones que dependan de una AUSENCIA, corrobóralo con **dos búsquedas** y
usa `command grep`: el `grep` de esta máquina es un wrapper de ugrep que **salta
binarios en silencio**.

## No toques

- **No modifiques NINGÚN archivo del repo.** Auditoría de solo lectura: tú
  encuentras y calificas, el orquestador arregla.
- No escribas fuera de `docs/auditoria-6/<tu-rubro>.md`.

## Auditoría anterior

`docs/auditoria-5/00-SINTESIS.md`, global **5.2**. Trae tu nota previa y tus
hallazgos. **Léela antes de calificar.**

Y léela sabiendo esto: **esas notas NO califican el código que vas a ver.**
Califican lo que los auditores encontraron ANTES de los 55 arreglos. Tú eres quien
los mide por primera vez. Si un rubro merece subir, dilo con los commits que lo
justifican; si merece bajar, di cuál de las tres razones es.

## Cómo calificar

Escala 0-10 con las anclas de tu rubro (`references/rubros.md` de la skill).

- Cada hallazgo con `archivo:línea` y un fallo CONCRETO, **con valores**.
- Intenta refutar tu propio hallazgo antes de escribirlo: este código tiene
  defensas deliberadas documentadas en comentarios largos, y muchas se escribieron
  ayer. Proponer "validar mejor" algo ya cerrado quema el reporte entero.
- Prefiere 3 hallazgos verificados a 15 sospechas: el orquestador abre cada uno
  contra el código, y los falsos entran al reporte **como falsos**.
