# Mapa del repo — para los auditores (ronda 10)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México.
Pre-revenue, sin clientes. Demo **6-ago-2026** (4 días). El comprador es el
**contralor** de la flota. Un error que el contralor vea en la sala cuesta el
trato.

## QUÉ CLASE DE RONDA ES ESTA, Y POR QUÉ IMPORTA PARA TU TRABAJO

**RONDA LIGERA, 3 rubros.** Desde el cierre de la ronda 9 (`848487a`,
1-ago-2026 21:08) hasta `HEAD` hay **cero commits** en `src/`, `supabase/` y
`normas/`. El código es byte por byte el mismo que la ronda 9 dejó.

Eso cambia la naturaleza de tu trabajo, y conviene decirlo sin rodeos:

**No vienes a buscar regresiones. Vienes a auditar una calificación.**

La ronda 9 subió la nota global de 6.5 a 7.7 en una sola ronda — el salto más
grande de la serie. Su propia síntesis cierra con esta nota metodológica, que
citamos literal porque es el encargo de hoy:

> «la columna "tras los arreglos" es mi lectura de qué tan sostenido queda cada
> rubro una vez cerrado lo que sus auditores encontraron — **no una re-corrida
> de los 12 auditores con contexto fresco**. Esa re-corrida es, por diseño, el
> Paso 1 de la ronda 10: solo un auditor nuevo, sin el contexto de haber
> escrito el arreglo, puede confirmar de forma independiente que estos 29
> cierres sostienen bajo una mirada que no sabe dónde se acaba de tocar
> código.»

Tú eres ese auditor nuevo. Las notas post-arreglo de la ronda 9 **no fueron
verificadas por nadie con contexto fresco**. Trátalas como una hipótesis del
orquestador anterior, no como una línea base establecida.

Por lo tanto, para tu rubro:

1. **Abre los arreglos que la ronda 9 dice haber cerrado en tu rubro** (tabla
   abajo) y confirma que el arreglo ancló de verdad — no que existe el commit,
   sino que el camino de falla ya no existe. Un arreglo que cerró el síntoma y
   dejó la causa raíz es el hallazgo más valioso que puedes traer hoy.
2. **Si la nota que la ronda 9 te asignó está inflada, bájala.** La razón
   *mirada más profunda (el código no cambió, la nota anterior estaba
   inflada)* existe exactamente para este caso y hoy es el resultado esperado
   en más de un rubro. Que la global baje es un resultado válido de esta
   ronda, y probablemente el más útil.
3. Lo que la ronda 9 dejó como *propuesto* (medios y bajos) sigue ahí sin
   tocar. Verifícalo y repórtalo como REINCIDENTE si sigue.

## LOS TRES RUBROS DE ESTA RONDA, Y POR QUÉ ESTOS

Rotación por nota más baja y por abandono, no por repetición:

| Rubro | Nota que hereda | Por qué entra hoy |
|---|:--:|---|
| **Cumplimiento fiscal** | 7 (era 4) | El salto más violento de la ronda 9: 4 → 7 en una ronda. Cuatro altos cerrados de golpe. Es también el rubro que le cuesta dinero al cliente y el que un contador ve en la primera revisión. Si alguna nota está inflada, la probabilidad a priori está aquí. |
| **Frontend** | 7 (era 6) | Es literalmente lo que el contralor ve en la sala el 6-ago. Subió por UN solo alto cerrado. El rubro no tiene lint ni prueba propia: su modo de falla dominante (desincronización de mapas contra `src/types/`) no lo atrapa nadie. |
| **Tool calling** | 8 | **No se atacó en las rondas 7, 8 NI 9** — tres rondas consecutivas congelado en 8 mientras acumula 2 MEDIOS + 5 BAJOS reincidentes «sin cambio». Es el único rubro que satisface literalmente el criterio de rotación, y una nota que nadie mide desde la ronda 6 es exactamente lo que esta rutina existe para no permitir. |

Los otros nueve rubros conservan su nota de la ronda 9 y se marcan
`no auditado esta ronda`. No los toques.

## LO QUE LA RONDA 9 DICE HABER CERRADO EN TU RUBRO — CONFIRMA QUE ANCLÓ

**Cumplimiento fiscal** (4 altos, todos con commit propio):

| Qué era | Commit |
|---|---|
| Un EFOS solo PRESUNTO se declara "lista negra" y tira la deducción entera | `4d8b4f4` |
| El tope de $750/día imprime un excedente "no deducible" que el desglose desmiente | `72b565b` |
| Comida amparada SOLO por transporte y sin tarjeta de crédito sale deducible sin observación | `c64c74c` |
| El permiso CRE manda el viaje demo a "Por revisar" en rojo por una regla que nadie puede resolver (compartido con Frontend) | `f25d44f` |

Quedaron **propuestos** (verifica si siguen): hospedaje de $1 sin timbrar apaga
la advertencia de LISR 28-V del mismo comprobante · el plazo de facturación
cita distinto según si la ficha está VERIFICADA o SIN VERIFICAR, y 33 de 37
comercios del censo caen en la rama sin verificar · `rmf-2026-2.7.1.21.yaml`
declara que no se usa en código, y sí se usa.

**Frontend** (1 alto):

| Qué era | Commit |
|---|---|
| El permiso CRE manda el viaje demo a "Por revisar" en rojo por una regla que nadie puede resolver | `f25d44f` |

**Tool calling**: la ronda 9 **no tocó nada**. Los 7 hallazgos siguen abiertos
tal cual, todos marcados REINCIDENTE «sin cambio» desde la ronda 6:
atribución de costo tras fallback · `ToolCallRecord.args` sin describir qué
produjo el `result` · `cuadrar_viaje`/`consultar_politica` sin prueba de
handler real · `ctx.signal` sin consumirse · falso positivo de
`isTransientError` · error crudo de Postgres sin filtrar al modelo ·
loop-guard que ejecuta la ronda completa antes de tirar el resultado.

Tu primer trabajo es verificar cuáles de esos siete siguen ahí, con
`archivo:línea`. Una nota de 8 sostenida sobre siete hallazgos abiertos que
nadie ha vuelto a mirar en cuatro rondas necesita justificarse o bajar.

## Un PR viejo que NO está en `master` — contexto, no trabajo tuyo

El PR #6 (`claude/auditoria-8`) sigue abierto y lleva 3 arreglos con prueba
que **nunca aterrizaron en `master`**: `processor_entrega_rechazada.test.ts`
(un PDF que Meta rechaza contaba como entregado), `processor_xml_ambiguo.test.ts`
(un XML que no sabe a qué ticket pegarse inventaba un gasto), y
`pdf_un_solo_nombre.test.ts` (la liquidación llevaba DOS nombres de producto
en la misma hoja). Ninguno de esos tres archivos existe en el árbol de hoy.

**No los des por arreglados.** Si tu rubro toca esos caminos, audítalos como
si el arreglo no existiera — porque en `master` no existe.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` puro y sin
  I/O. `guardia.ts`, `resumen.ts`, `cifras.ts`, `leyendas.ts`,
  `fecha_dudosa.ts`.
- `src/lib/cuadra/processor.ts` — el pegamento: WhatsApp → intake → agente →
  respuesta.
- `src/lib/cuadra/repo.ts` — acceso a datos.
- `src/lib/cuadra/intake/` — OCR y decisión de qué hacer con cada foto/XML:
  `ocr.ts`, `decidir.ts`, `emparejar.ts`, `cfdi_xml.ts`, `cfdi.ts`, `sat.ts`,
  `pedir_fecha.ts`.
- `src/lib/cuadra/liquidacion/` — `deducibilidad.ts`, `pdf.ts`.
- `src/lib/cuadra/facturacion/` — `permiso_cre.ts` (tabla de 12,625 permisos
  CRE; verifica si sigue sin consumidor real).
- `src/lib/cuadra/normas/` — `fundamento.ts` (guardia de citas),
  `por_diferencia.ts`.
- `src/lib/cuadra/tools.ts` — definición de tools.
- `src/lib/llm/` — `openrouter.ts` (`generateWithTools`, `generateStructured`),
  `models.ts`, `tool-executor.ts`, y sus pruebas.
- `src/app/` — `dashboard/`, `demo/`, `acceso/`, `aviso/`, `privacidad/`,
  `api/`, `globals.css`, `global-error.tsx`, `not-found.tsx`.
- `src/types/cuadra.ts` — los tipos que el panel debe reflejar.
- `normas/*.yaml` — 21 fichas, **fuente de verdad fiscal y legal**.
- `supabase/migrations/` — hasta la `0043`.

## La compuerta, hoy, ya corrida (línea base de esta ronda)

Esta ronda corre **en la nube**: no hay `.env`, ni Supabase, ni OpenRouter.
Por eso la compuerta es `npm test` + `npx tsc --noEmit` + `npm run lint`, sin
`npm run build` (pide credenciales que aquí no existen).

```
$ npx tsc --noEmit      → exit 0, sin salida
$ npm run lint          → exit 0, sin salida
$ npx vitest run        → exit 0
  Test Files  163 passed (163)
       Tests  1570 passed | 1 skipped (1571)
```

Idéntica a la evidencia que declaró la ronda 9. El árbol está verde y limpio.

## Qué NO tocar

`pruebas-manuales/*.prueba.ts` hacen llamadas reales de pago — **no se
corren**. No editar código: los auditores encuentran y califican, el
orquestador arregla después.
