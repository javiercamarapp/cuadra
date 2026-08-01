# Mapa del repo — para los auditores (ronda 8)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026**. El comprador es el **contralor** de la flota.
Un error que el contralor vea en la sala cuesta el trato.

## QUÉ CLASE DE RONDA ES ESTA, Y POR QUÉ IMPORTA PARA TU TRABAJO

**RONDA COMPLETA, no ligera.** Desde el sha base de la ronda 7 (`abdc98d`) hasta
`HEAD` hay **41 commits, 78 archivos, +5427/-284 líneas** en `src/`, `supabase/`
y `normas/`. Los doce rubros se auditan hoy — la rotación de 3 solo aplica
cuando no hay delta que medir, y aquí sí lo hay, y es grande.

## LO QUE YA SE ARREGLÓ DESDE LA RONDA 7 — VERIFICA QUE DE VERDAD CERRÓ

La ronda 7 dejó tres críticos pendientes y un reincidente. Los commits dicen
que los cuatro se cerraron. **No lo des por hecho — es tu trabajo confirmarlo
o reportarlo como reincidente:**

| ID | Qué era | Commit que dice haberlo cerrado |
|---|---|---|
| AG-2 | `guardiaFundamento` corre siempre con `permitidas=[]`; borra una norma legítima al citarla | `e50510c` — el permiso de citar viaja con `consultar_politica` |
| AG-3 | El texto de WhatsApp y el PDF archivado salen de dos fotografías distintas de la base | `2f79174` — el cierre usa el snapshot de `guardar_liquidacion`, no recalcula (más `0d5fa06`, hoy: "un solo origen para los TRES consumidores") |
| PR-1 | El mock de `resolveOperador` no miraba `.limit(n)` — invisible para la prueba el bug de "fila arbitraria decide el tenant" | `8844874` |
| Litros reincidente ×4 | `1,850.5 L` en el PDF, `1850.5 L` en WhatsApp — mismo dato, dos formatos | `fa8a8db` |

Si alguno de los cuatro sigue roto pese al commit, es el hallazgo más valioso
que puedes traer hoy: significa que el arreglo no ancló.

## Otros cambios grandes de este período, por si tocan tu rubro

- **Seguridad:** `3e9eb82` — "barrido de producción, atacado como anónimo, y
  `search_path` fijo" + migración `0035_search_path_fijo.sql`.
- **Modelo de datos:** seis migraciones nuevas, `0031` a `0036`. La `0036` es
  `no_gastos_tras_liquidar` — una restricción nueva que vale la pena mirar con
  la pregunta del rubro (¿la base la impone, o "la aplicación se encarga"?).
- **Fiscal:** catálogo de comercios de 13 → 37 portales; permisos CRE
  cosechados (12,625, 88% del padrón nacional) en `facturacion/permiso_cre.ts`;
  primera corrida de `cuota-diesel` (bloqueada por egress, ver `.latido-cuota-diesel`).
- **Legal:** `privacidad.ts` reescrito, `src/app/privacidad/page.tsx` nuevo, la
  reserva y la constancia dejan de ser la misma fila (0033), tenant_contacto
  para el aviso (0034).
- **Frontend:** `marca: el operador leía DOS nombres del producto en su primera
  pantalla` (`b476a9e`) — confirma que ya no aparecen ambos.
- **Operabilidad:** el software se muda a `app.likida.ai` (`93be38a`) — repasa
  que nada quede apuntando al dominio viejo (`87daa62`: `cuadra.mx` no es
  nuestro y estaba impreso en el PDF).

## El patrón que ya apareció CINCO veces hasta la ronda 6

*Un fallo de consulta disfrazado del valor que significa "no hay".* Ya
descartado en `analytics.ts`, `costos.ts`, `repo.ts` (ronda 6) y confirmado en
`startup.ts`, `conv.ts` (×3), `config.ts` (rondas anteriores). Si encuentras un
sexto lugar, no está en esos.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` puro y sin
  I/O. `guardia.ts`, `resumen.ts`, `cifras.ts`, `leyendas.ts`.
- `src/lib/cuadra/normas/` — `indice.ts`, `fundamento.ts` (`guardiaFundamento`),
  `por_diferencia.ts`, `permiso_politica.ts`. Fuente de verdad: YAML en `normas/`.
- `src/lib/cuadra/facturacion/` — `comercios.ts` (37), `identificar.ts`,
  `permiso_cre.ts` (nuevo), `caducidad.ts`.
- `src/lib/cuadra/intake/` — `ocr.ts`, `cfdi.ts`, `sat.ts`, `decidir.ts`,
  `concepto.ts`, `voucher.ts`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts`, `deducibilidad.ts`, `acreditable.ts`,
  `omitidos.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts`, `repo.ts` (TODO el acceso a datos),
  `conv.ts`, `presupuesto.ts`, `privacidad.ts`, `config.ts`, `startup.ts`,
  `tools.ts`, `barrera.ts`.
- `src/lib/llm/`, `src/lib/agents/`, `src/lib/meta/client.ts`, `src/lib/auth/`,
  `src/lib/observability/`, `src/app/(dashboard)/`, `src/app/privacidad/` (nuevo),
  `src/app/aviso/[tenant]/` (nuevo).
- `supabase/migrations/` — 36 archivos (0027 sigue sin aplicar a propósito).
  `normas/` — fichas YAML + `permisos_cre.json`.

## Convenciones

- TypeScript estricto. Comentarios en español, explicando **por qué**.
- **Ninguna cifra que vea el usuario sale del LLM.** `guardia.ts` y `cifras.ts`
  lo imponen en código.
- El catálogo de comercios y el de normas son **datos, no código**.
- Las tools declaran `properties: {}` a propósito: el modelo decide *cuándo*,
  nunca *con qué datos*. No es un hallazgo.

## Línea base ya verificada por el orquestador, hoy, en esta máquina

```
npm test        1296 pruebas, 1 saltada, 132 archivos   exit 0   (antes 1119)
npx tsc --noEmit                                        exit 0
npm run lint (eslint)                                   exit 0
```

## Restricciones

- **No modifiques NINGÚN archivo del repo.** Solo lectura: tú encuentras y
  calificas, el orquestador arregla.
- **No corras `pruebas-manuales/*.prueba.ts`**: hacen llamadas reales de pago.
- **No corras `npm run build`**: pide credenciales de despliegue.
- Puedes correr `npm test`, `npx tsc --noEmit`, `npm run lint`, leer y buscar.
- No escribas fuera de `docs/auditoria-8/<tu-rubro>.md`.

## Auditoría anterior

`docs/auditoria-7/00-SINTESIS.md` (global **5.5**) y tu propio
`docs/auditoria-7/<tu-rubro>.md` si tu rubro fue de los tres auditados esa
ronda (agéntico, arquitectura, pruebas). Si tu rubro NO fue auditado en la 7,
tu última nota real viene de `docs/auditoria-6/`. Léelos antes de calificar.
