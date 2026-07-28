# Mapa del repo — para los auditores

Repo: `~/javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo 6-ago-2026. El comprador es el **contralor** de la flota.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O: entra un viaje con gastos, sale una liquidación con diferencias y totales.
  `guardia.ts` es el backstop determinístico que impide que el LLM narre cifras
  sin tool. `resumen.ts` arma el texto de WhatsApp. `leyendas.ts`, descargos
  legales. `desde_db.ts` reconstruye desde Supabase.
- `src/lib/cuadra/intake/` — de la foto al gasto. `ocr.ts` (visión), `cfdi.ts`
  (QR y código de barras con zxing), `sat.ts` (consulta al SAT), `emparejar.ts`
  (a qué gasto pertenece cada foto), `decidir.ts` (qué hacer con una foto),
  `sanitizar.ts`, `fecha.ts`, `concepto.ts`.
- `src/lib/cuadra/liquidacion/` — la salida: `pdf.ts` (pdf-lib),
  `deducibilidad.ts`, `omitidos.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts` es el orquestador de cada mensaje
  entrante. `repo.ts` es TODO el acceso a datos. `conv.ts` (mutex, barrera de
  ráfaga, conversación), `presupuesto.ts` (reloj compartido de la invocación),
  `privacidad.ts` (aviso LFPDPPP), `pg_errores.ts`, `config.ts`, `costos.ts`,
  `analytics.ts`, `duplicados.ts`, `startup.ts`, `tools.ts`.
- `src/lib/llm/` — `openrouter.ts` (cliente, `generateStructured`,
  `generateWithTools`, fallback cross-provider, cálculo de costo),
  `models.ts` (qué modelo por rol).
- `src/lib/agents/` — `run.ts`, `registry.ts`, `prompts.ts`, `liquidacion/`.
- `src/app/api/webhook/whatsapp/route.ts` — entrada de Meta. Responde 200 y
  trabaja en `after()`.
- `src/app/dashboard/`, `src/app/(panel)/` — lo que ve el contralor.
- `supabase/migrations/` — 19 migraciones. `supabase/verificaciones.sql` son
  pruebas de concurrencia contra Postgres real (con rollback).
- `normas/` — 17 fichas YAML de normas fiscales/legales, cada una con su
  `estado_verificacion`. Las marcadas `verificado_fuente_primaria` traen el texto
  transcrito literal.
- `docs/conocimiento/` — investigación. `50-auditoria-fase0.md` y
  `51-boletin-tecnico.md` son la auditoría ANTERIOR (la que estás re-evaluando).

## Convenciones

- TypeScript estricto. Tests con Vitest: `npm test` (360, offline y
  reproducibles). `npm run typecheck`, `npm run lint`, `npm run build`.
- Los arneses `pruebas-manuales/*.prueba.ts` hacen llamadas REALES de pago y
  quedan FUERA de `npm test`. No los corras.
- Comentarios en español, explicando **por qué**, no qué.
- La regla fundacional: **ninguna cifra que vea el usuario sale del LLM**. Todas
  vienen del motor. `guardia.ts` lo impone en código.

## No toques

- No modifiques NADA. Esta es una auditoría de solo lectura.
- No corras `pruebas-manuales/*.prueba.ts` (cuestan dinero).
- No toques la base de datos.
- No escribas fuera de tu archivo de salida asignado.

## Trampa del entorno, importante

En esta máquina `grep` es una función de shell que envuelve `ugrep -I` y **salta
los archivos que parezcan binarios EN SILENCIO**, devolviendo "no encontrado"
sobre archivos que sí contienen el patrón. Para cualquier conclusión que dependa
de una AUSENCIA ("esto no se usa", "no existe tal función"), usa **`command
grep`**, que es el binario real. Un falso negativo aquí se lee como confirmación.

## Cómo calificar

Nota **1-10** por tu rubro, con el mismo criterio que el boletín anterior
(`docs/conocimiento/51-boletin-tecnico.md`, léelo para calibrar: la nota global
era 6.4).

Reglas:
- **Cada hallazgo con `archivo:línea` y un fallo CONCRETO**: qué entrada produce
  qué salida incorrecta. Un hallazgo sin fallo describible es una opinión —
  etiquétalo como opinión.
- **No repitas hallazgos ya corregidos.** Muchos bugs del boletín anterior ya se
  arreglaron; verifica contra el código ACTUAL antes de reportar.
- Si algo te parece mal pero no puedes construir el caso que falla, dilo así.
- Prefiere 3 hallazgos verificados a 15 sospechas.
