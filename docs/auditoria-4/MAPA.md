# Mapa del repo — para los auditores (ronda 4)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo 6-ago-2026. El comprador es el **contralor** de la flota.
Un error que el contralor vea en la sala cuesta el trato.

## LO PRIMERO, Y ES LO QUE DEFINE ESTA RONDA

**El código no cambió desde la auditoría 3, pero las notas de la auditoría 3 NO
califican este código.**

La síntesis de la ronda 3 lo dice con todas sus letras (líneas 38-47): *"Estas
notas califican el código que los auditores ENCONTRARON, no el que hay ahora.
Después de recibirlas se arreglaron los dos críticos y los cuatro altos. Esos
arreglos no están reflejados en la tabla — se medirán en la ronda 4, con
auditores frescos."*

Tú eres ese auditor fresco. Los arreglos entraron en dos commits y **nunca los ha
mirado nadie con contexto limpio**:

- `52adedb` — `repo.ts`, `analytics.ts`, `dashboard/page.tsx`,
  `fundamento.test.ts`, `combustible.test.ts`, migraciones 0021 y 0023.
- `59bc958` — `fundamento.ts`, `processor.ts`, `engine.ts`, `openrouter.ts`,
  `globals.css`, más tests en `engine.test.ts`, `fundamento.test.ts`,
  `openrouter_fallback_costo.test.ts`.

Tu trabajo no es confirmar que los arreglos funcionan. Es preguntarte **qué
abrieron al cerrarse**. Un arreglo hecho de madrugada bajo la presión de un
crítico es exactamente donde se esconde el siguiente bug, y el que lo escribió ya
venía cansado del tema.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O: entra un viaje con gastos, sale una liquidación con diferencias y totales.
  `guardia.ts` es el backstop determinístico que impide que el LLM narre cifras
  sin tool. `cifras.ts` es el portón de cifras. `resumen.ts` arma el texto de
  WhatsApp. `leyendas.ts`, descargos legales. `desde_db.ts` reconstruye desde
  Supabase.
- `src/lib/cuadra/normas/` — `indice.ts` (19 normas con jerarquía y estado de
  verificación), `fundamento.ts` (`guardiaFundamento`: el modelo solo puede citar
  una norma que una tool le devolvió EN ESE TURNO), `por_diferencia.ts`
  (TipoDiferencia → norma_id). La fuente de verdad son los YAML de `normas/`; el
  índice es copia con test de sincronía.
- `src/lib/cuadra/periodo/` — el 15% de combustible en efectivo es del
  EJERCICIO, no del viaje (RFA 2026 regla 2.9). `combustible.ts` (puro) y
  `aviso.ts`.
- `src/lib/cuadra/laboral/pagadero.ts` — deducible ≠ pagadero. LFT 263 fr. I
  obliga a pagar hospedaje y alimentación por demora ajena aunque rompa la
  política; LFT 110 fr. I pone DOS topes distintos al descuento.
- `src/lib/cuadra/intake/` — de la foto al gasto. `ocr.ts`, `cfdi.ts` (QR y
  código de barras con zxing), `sat.ts`, `emparejar.ts`, `decidir.ts`,
  `sanitizar.ts`, `fecha.ts`, `concepto.ts`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts` (pdf-lib), `deducibilidad.ts`,
  `omitidos.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts` es el orquestador de cada mensaje
  entrante. `repo.ts` es TODO el acceso a datos. `conv.ts` (mutex, barrera de
  ráfaga), `presupuesto.ts` (reloj compartido de la invocación), `privacidad.ts`
  (aviso LFPDPPP), `pg_errores.ts`, `config.ts`, `costos.ts`, `analytics.ts`,
  `duplicados.ts`, `startup.ts`, `tools.ts`, `export.ts`, `facturacion/`.
- `src/lib/llm/` — `openrouter.ts` (cliente, `generateStructured`,
  `generateWithTools`, fallback cross-provider, cálculo de costo), `models.ts`,
  `tool-executor.ts`.
- `src/lib/agents/` — `run.ts`, `registry.ts`, `prompts.ts`, `liquidacion/`.
- `src/app/api/webhook/whatsapp/route.ts` — entrada de Meta. Responde 200 y
  trabaja en `after()`.
- `src/app/dashboard/`, `src/app/(panel)/` — lo que ve el contralor.
- `supabase/migrations/` — 22 migraciones, la última `0023_indice_acumulado_combustible.sql`.
  `supabase/verificaciones.sql` son pruebas de concurrencia contra Postgres real.
- `normas/` — 19 fichas YAML, cada una con su `estado_verificacion`. Las
  `verificado_fuente_primaria` traen el texto transcrito literal.

## Convenciones

- TypeScript estricto. Vitest: `npm test` (501 tests, offline y reproducibles).
- Comentarios en español, explicando **por qué**, no qué.
- La regla fundacional: **ninguna cifra que vea el usuario sale del LLM**. Todas
  vienen del motor. `guardia.ts` y `cifras.ts` lo imponen en código.

## Estás en la nube — esto cambia lo que puedes correr

No hay `.env`, ni Supabase, ni OpenRouter, ni Facturapi, ni Upstash.

- **SÍ puedes correr:** `npm test`, `npx tsc --noEmit`, `npm run lint`. Los tres
  pasan hoy en `HEAD` — esa es la línea base, ya verificada por el orquestador:
  **501 tests en 50 archivos, tsc exit 0, eslint exit 0.**
- **NO corras `npm run build`**: pide credenciales que aquí no existen y su fallo
  no dice nada del código.
- **NO corras `pruebas-manuales/*.prueba.ts`**: hacen llamadas REALES de pago.
- **NO toques la base de datos** (no existe aquí).
- Puedes escribir scripts temporales fuera del repo (en `/tmp`) para reproducir
  un caso con `npx tsx` — la ronda 3 lo hizo y fue lo que produjo sus mejores
  hallazgos. Importar el módulo real y transcribir la salida real vale mucho más
  que leer el código y suponer.

Aquí `grep` es el binario real de GNU (`/usr/bin/grep`), no el wrapper de ugrep
que había en la máquina local. Aun así, para conclusiones que dependan de una
AUSENCIA ("esto no se usa", "no existe tal función"), corrobóralo con dos
búsquedas distintas: un falso negativo se lee como confirmación.

## No toques

- **No modifiques NINGÚN archivo del repo.** Esta es una auditoría de solo
  lectura. El orquestador arregla; tú encuentras y calificas.
- No escribas fuera de tu archivo de salida asignado
  (`docs/auditoria-4/<tu-rubro>.md`).

## Qué es esta ronda: LIGERA, por rotación

No hubo commits en `src/`, `supabase/` ni `normas/` desde la ronda 3, así que en
vez de repetir los 12 rubros sobre código idéntico, se rotan **3**: los de nota
más baja y los que menos profundidad dedicada recibieron. Los otros 9 conservan
su nota, marcados `no auditado esta ronda`.

Los 3: **Sistema agéntico y orquestación** (4), **Arquitectura y
mantenibilidad** (5), **Tool calling** (6). No es casualidad que sean también los
tres rubros sobre los que cayeron los arreglos de `59bc958` — `fundamento.ts` y
`processor.ts` son agéntico, `engine.ts` y `dashboard/page.tsx` son arquitectura,
`openrouter.ts` es tool calling.

## Auditoría anterior

`docs/auditoria-3/00-SINTESIS.md`, nota global **6.2**. Trae tu nota previa y los
hallazgos abiertos. **Léela antes de calificar**: sin el delta, la nota flota.
Tu archivo de rubro de la ronda 3 también está ahí
(`arquitectura-agentico.md`, `frontend-tools-rendimiento.md`).

## Cómo calificar

Escala 0-10 con las anclas de tu rubro. Reglas:

- **Cada hallazgo con `archivo:línea` y un fallo CONCRETO**: qué entrada produce
  qué salida incorrecta, con valores. Un hallazgo sin fallo describible es una
  opinión — etiquétalo como opinión y no lo cuentes.
- **No repitas hallazgos ya corregidos.** Verifica contra el código ACTUAL.
- Si algo te parece mal pero no puedes construir el caso que falla, dilo así.
- Prefiere 3 hallazgos verificados a 15 sospechas. El orquestador va a abrir cada
  uno contra el código, y los falsos entran al reporte como falsos.
