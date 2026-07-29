# Mapa del repo — para los auditores (ronda 7)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026**. El comprador es el **contralor** de la flota.
Un error que el contralor vea en la sala cuesta el trato.

## QUÉ CLASE DE RONDA ES ESTA, Y POR QUÉ IMPORTA PARA TU TRABAJO

**RONDA LIGERA. El código NO cambió desde la ronda 6.** `HEAD` es exactamente el
commit que cerró la ronda anterior (`abdc98d`); no hay ni un commit en `src/`,
`supabase/` ni `normas/` posterior a él.

Eso cambia la naturaleza de tu trabajo, y hay que decirlo sin rodeos:

**No hay delta que medir. Lo único que puedes aportar es profundidad.** Si tu
reporte repite lo que la ronda 6 ya escribió, la ronda entera no produjo nada.
La única razón legítima para mover tu nota hoy es **mirada más profunda** — el
código no cambió, la nota anterior estaba inflada, y lo dices con esas palabras.
"Se atacó y subió" es imposible hoy: no hubo ataque. "Deuda que cobró factura"
solo aplica si encuentras que algo marcado como advertencia YA está ocurriendo.

Tres rubros se auditan hoy, por rotación: **sistema agéntico**, **arquitectura**
y **pruebas**. Los otros nueve conservan su nota y se marcan *no auditado esta
ronda*.

## POR QUÉ TE TOCÓ A TI, Y QUÉ SE ESPERA DE TU RUBRO

La ronda 6 cerró su síntesis nombrando por escrito la pregunta de la ronda 7. No
es una sugerencia; es tu encargo:

> 1. **¿Cuántas copias de cada verdad hay?** Arquitectura lleva cinco rondas
>    midiendo lo mismo en la misma dirección: el acceso a datos fuera de
>    `repo.ts` subió **de 49 a 55**. Dos de los críticos de la ronda 6 —la fecha
>    del PDF y el reconocimiento de citas— son exactamente eso: dos copias que se
>    separaron.
> 2. **¿Los arreglos de la ronda 6 nacieron con arnés?** El rubro de pruebas
>    midió 10 de 12 mutaciones nuevas sobreviviendo (83%, peor que el 57% de la
>    ronda 5). La ronda 6 escribió las pruebas mirando el cable; hay que medir si
>    eso cambió el número o solo cambió el discurso.

- **Arquitectura:** la métrica de 55 accesos fuera de `repo.ts` es tuya. Cuéntala
  otra vez tú mismo y di el número. Si subió, es deuda cobrando factura. Y busca
  la **tercera** pareja de copias divergentes: ya aparecieron dos (fecha del PDF,
  reconocimiento de citas) y el rubro tiene el ejemplo canónico documentado
  (`engine.ts` con `otro: 'Gasto'` contra `pdf.ts` con `otro: 'Otro'`).
- **Pruebas:** repite la medición de mutantes sobre las pruebas que escribió la
  ronda 6, no sobre las de la ronda 5. El número que se pide es *de las pruebas
  nuevas, cuántas sobreviven a romper la función que dicen cubrir*. Un número
  medido vale más que un párrafo.
- **Agéntico:** es la nota más baja del repo (3/10) y la única en el tramo "existe
  un estado donde la base dice una cosa y el usuario cree otra". Nadie lo ha
  atacado dirigidamente desde la ronda 4. Recorre el ciclo de vida punto por
  punto con la pregunta del rubro: *si el proceso muere aquí, ¿qué ve el humano y
  qué quedó en la base?*

## El patrón que ya apareció CINCO veces — la quinta fue en la ronda 6

*Un fallo de consulta disfrazado del valor que significa "no hay".*

| Dónde | Decía | Era |
|---|---|---|
| `startup.ts` | "FALTA la migración 0005" | `TypeError: fetch failed` |
| `conv.ts` · `resolveOperador` | "no te tengo registrado" | la base no contestó |
| `conv.ts` · `getOpenViaje` | "ese viaje ya quedó cerrado 👍" | la base no contestó |
| `conv.ts` · `intakeDelta` | "no hay fotos en vuelo" | la RPC devolvió error |
| `config.ts` | la política de la demo | PostgREST devolvió `error` por valor |

La ronda 6 descartó por escrito `analytics.ts`, `costos.ts` y `repo.ts`. Si hay
un sexto lugar, no está en esos tres.

## Lo que la ronda 6 dejó abierto, y NO es código

No lo reportes como hallazgo tuyo; ya está anotado y depende del cliente:

- La URL del aviso de privacidad (`transportesinnovativos.mx` → NXDOMAIN).
- El RFC de la flota (con el genérico, toda factura sale *a revisión*, que es lo
  correcto).
- `SENTRY_DSN` sin existir en Vercel.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O. `guardia.ts` (cifras), `estado_afirmado.ts` (afirmaciones de estado),
  `cifras.ts`, `resumen.ts`, `leyendas.ts`, `desde_db.ts`.
- `src/lib/cuadra/normas/` — `indice.ts`, `fundamento.ts` (`guardiaFundamento`),
  `por_diferencia.ts`. Fuente de verdad: los YAML de `normas/`.
- `src/lib/cuadra/facturacion/` — `comercios.ts` (13 comercios), `identificar.ts`,
  `caducidad.ts`.
- `src/lib/cuadra/intake/` — `ocr.ts`, `cfdi.ts` (zxing), `sat.ts`, `emparejar.ts`,
  `decidir.ts`, `sanitizar.ts`, `concepto.ts`, `fecha.ts`, `hash.ts`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts`, `deducibilidad.ts`, `acreditable.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts`, `repo.ts` (TODO el acceso a datos),
  `conv.ts`, `presupuesto.ts`, `privacidad.ts`, `config.ts`, `costos.ts`,
  `analytics.ts`, `startup.ts`, `tools.ts`, `barrera.ts`.
- `src/lib/llm/`, `src/lib/agents/`, `src/lib/meta/client.ts`, `src/lib/auth/`,
  `src/lib/observability/`, `src/proxy.ts`, `src/app/(dashboard)/`.
- `src/app/api/webhook/whatsapp/route.ts` — `maxDuration = 120`.
- `supabase/migrations/` — 30 archivos (la **0027 escrita y SIN aplicar** a
  propósito; la **0030 aplicada**). `normas/` — 21 fichas YAML.

## Convenciones

- TypeScript estricto. Comentarios en español, explicando **por qué**.
- **Ninguna cifra que vea el usuario sale del LLM.** `guardia.ts` y `cifras.ts` lo
  imponen en código.
- El catálogo de comercios y el de normas son **datos, no código**.
- Las tools declaran `properties: {}` **a propósito**: el modelo decide *cuándo*,
  nunca *con qué datos*. No es un hallazgo.

## Línea base ya verificada por el orquestador, hoy, en esta máquina

```
npm test        1115 pruebas, 1 saltada, 112 archivos   exit 0
npx tsc --noEmit                                        exit 0
npm run lint (eslint)                                   exit 0
```

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
- No escribas fuera de `docs/auditoria-7/<tu-rubro>.md`.

## Auditoría anterior

`docs/auditoria-6/00-SINTESIS.md`, global **5.3**, y tu propio
`docs/auditoria-6/<tu-rubro>.md`. **Léelos antes de calificar.** Los 13 hallazgos
de la ronda 6 (8 críticos, 5 altos) se reportan **todos cerrados** con commit.
Verificar que de verdad quedaron cerrados es parte de tu trabajo: la ronda 6
encontró exactamente ese modo de falla —*se construyó el mecanismo, se le
escribieron pruebas unitarias, y nunca se conectó*— dos veces.
