# Auditoría 4 — síntesis

**Fecha:** 28-jul-2026. **Anterior:** `docs/auditoria-3/00-SINTESIS.md` (6.2).
**Sha de esta ronda:** `de49468` (base) — la rama es `claude/auditoria-4`.
**Modo:** desatendido, en la nube. Árbol limpio al arrancar → autofix habilitado.
**Tipo:** **RONDA LIGERA**, 3 rubros por rotación.

---

## Nota global: 5.9 (antes 6.2, ▼0.3)

| Rubro | Aud. 3 | Aud. 4 | | Razón |
|---|:--:|:--:|---|---|
| Backend y API | 7 | 7 | = | no auditado esta ronda |
| Pruebas | 7 | 7 | = | no auditado esta ronda |
| Cumplimiento fiscal | 7 | 7 | = | no auditado esta ronda |
| Seguridad | 7 | 7 | = | no auditado esta ronda |
| Modelo de datos y esquema | 7 | 7 | = | no auditado esta ronda |
| Rendimiento y costo | 6 | 6 | = | no auditado esta ronda |
| Operabilidad y DX | 6 | 6 | = | no auditado esta ronda |
| Cumplimiento legal | 6 | 6 | = | no auditado esta ronda |
| Frontend | 6 | 6 | = | no auditado esta ronda |
| **Tool calling** | 6 | **5** | ▼ | mirada más profunda |
| **Arquitectura y mantenibilidad** | 5 | **4** | ▼ | deuda que cobró factura |
| **Sistema agéntico y orquestación** | 4 | **3** | ▼ | deuda que cobró factura |

**Los tres rubros auditados bajaron. Ninguno bajó porque el código empeorara.**

---

## Por qué es una ronda ligera, y por qué aun así valió la pena

La regla del PASO 1 se cumplió con comandos, no de memoria: no había PR de
auditoría abierto (`list_pull_requests state=open` → `[]`) y
`git log 2f7f066..HEAD -- src/ supabase/ normas/` salió **vacío**. Cero commits de
código desde la ronda 3.

Lo que impide que esto sea un no-op es que **las notas de la ronda 3 califican
código anterior a los arreglos de la ronda 3.** Su propia síntesis lo dice
(líneas 38-47) y difiere la medición a la ronda 4. Los arreglos viven en
`52adedb` y `59bc958`, y caen justo sobre los tres rubros rotados. Así que esta
ronda ligera midió, con auditores frescos, exactamente lo que la anterior no pudo
medir sobre sí misma.

Y lo que encontró justifica la existencia de la regla: **el arreglo de un crítico
de la ronda 3 abrió un crítico peor**, y otro crítico se declaró arreglado sin
que el commit tocara una sola línea del código responsable.

### Los rubros rotados y el criterio

La regla pide "los tres de nota más baja que no se hayan auditado en las últimas 3
rondas". Como la ronda 3 calificó los 12, **ningún rubro califica literalmente**;
el desempate fue nota más baja y profundidad dedicada recibida. Entraron agéntico
(4) y arquitectura (5) por nota, y tool calling (6, empatado con otros cuatro)
porque **nunca había tenido un auditor dedicado**: compartió agente con otros dos
rubros en las rondas 2 y 3, y su sección de la ronda 3 son 29 líneas. Fue el
rubro peor cubierto del repo estando en la frontera modelo↔mundo.

---

## Por qué se movió cada rubro

### Sistema agéntico 4 → 3 · deuda que cobró factura

De los cinco hallazgos declarados arreglados en la ronda 3, tres están cerrados de
verdad. Pero el CRÍTICO que causó la caída de 5 a 4 —`guardiaFundamento` ciego a
la cita sin palabra clave— **nunca se atacó**: `git show 59bc958` no toca
`FORMA_DE_CITA`, y los cuatro casos de la ronda 3 salían idénticos, verificado
ejecutando el módulo real.

Peor: el arreglo de la coma **abrió un agujero del mismo tipo pero peor**. El
patrón nuevo acepta artículo+fracción sin comprobar de qué ley se habla, así que
con permiso para `lisr-27-fr-III` la frase *"artículo 27, fracción III del Código
Fiscal de la Federación"* salía intacta **y aprobada**. CFF 27-III es el registro
del RFC. Antes la guardia se callaba ante una cita inventada; ahora la certificaba.

Y fuera de `normas/`, el hallazgo que fija el ancla del 3: existe un estado donde
la base dice "viaje abierto" y el operador cree que ya se liquidó, sin ninguna
guardia que pueda verlo.

### Arquitectura 5 → 4 · deuda que cobró factura

Tres de los cuatro abiertos siguen vivos y uno va por su **tercera ronda** (el
panel leyendo Supabase fuera de `repo.ts`). Pero lo que baja la nota no es la
reincidencia en abstracto: es que esta vez **se pudo construir el fallo que esa
deuda produjo**. Sin capa de acceso a datos, el cambio de `ieps_acreditable` a
`litros_diesel_acreditables` llegó a dos de sus cuatro consumidores, y `pdf.ts`
reconstruye por su cuenta la clasificación de dinero del motor y ya da otro
resultado. La misma lógica de dinero en más de un archivo es literalmente el ancla
del 4.

El conteo que amplía el hallazgo: `repo.ts` concentra **16 de 43** sitios de
consulta, y sobre la sola tabla `liquidacion` hay **cinco listas de columnas
escritas a mano** en cuatro archivos, ninguna en `repo.ts`. `MAPA.md` sigue
diciendo que `repo.ts` es "TODO el acceso a datos".

**Cerrado y verificado:** el hallazgo del orden de los gastos de la ronda 3.
`ivaAcreditable` da 86.67 en ambas permutaciones (antes 92 vs 80). El arreglo es
correcto de fondo, no un parche.

### Tool calling 6 → 5 · mirada más profunda

El código no cambió y la nota anterior estaba inflada. Con auditor dedicado por
primera vez aparecieron cuatro altos que ninguna ronda había visto, incluido uno
que es **regresión del arreglo de la ronda 3**: meter `cuadrar_` en
`READ_PREFIXES` hizo que también se cachearan los FRACASOS, convirtiendo un blip
de red de un segundo en un fallo permanente del turno.

El rubro conserva su propiedad estructural buena —ninguna tool acepta datos del
modelo, `properties: {}` a propósito— y el auditor lo verificó en vez de repetir
la sospecha. El 5 es del cliente que implementa la regla, no de la regla.

---

## Arreglado en esta ronda

Tope de 3 vueltas, las tres usadas. Cada una: prueba que reproduce → arreglo →
prueba verde → suite completa → commit atómico.

| Sev | Hallazgo | Commit | Evidencia |
|---|---|---|---|
| CRÍTICO | La guardia **certificaba** una cita de la ley equivocada, y "regla 2.9.1" pasaba por la regla 2.9 | `11c9529` | 6 pruebas que fallan sin el arreglo + 2 de regresión |
| CRÍTICO | Citas sin palabra clave, con sigla invertida o número en palabras no llegaban ni a `DESCONOCIDA` (REINCIDENTE) | `063d426` | 4 pruebas que reproducen + 2 de falsos positivos |
| ALTO | La caché de lectura guardaba los fracasos (REGRESIÓN de la ronda 3) | `5ca0456` | 1 ejecución en vez de 2 sin el arreglo |

`npm test` pasó de **501 a 517**. Ninguna prueba existente se tocó.

### Lo que el arreglo del detector NO cubre, dicho aquí para que no se pierda

`"conforme al 27-III"` a secas, sin nombrar ninguna ley, **sigue pasando**.
Ensanchar hasta ahí obliga a tratar cualquier `<número>-<romano>` suelto como
cita, y eso confunde un folio o un rango de fechas con un fundamento. Mutilar
mensajes legítimos para tapar ese caso es peor que el caso: necesita otra señal,
no un regex más ancho. Queda abierto y consciente.

---

## Pendiente con razón escrita

**[CRÍTICO] Ninguna guardia mira las afirmaciones de estado.**
`cuadre/guardia.ts:51` · `processor.ts:505`. Verificado: con `toolCalls: []`, el
texto *"Ya quedó cerrada tu liquidación ✅"* no tiene cifras, así que
`tieneCifrasDeDinero` sale falso y la guardia no toca el texto; `guardiaFundamento`
tampoco. Después `closed = false`, no sale PDF, y el viaje sigue `'abierto'`.

**No se arregla esta ronda a propósito.** No es un bug con un arreglo evidente:
requiere decidir qué hace el sistema cuando el modelo afirma un cierre que no
ocurrió —¿se sustituye el texto, se fuerza el resumen, se corrige explícitamente?—
y esa es una decisión de producto sobre lo que el operador lee en el peor momento.
Un backstop nuevo inventado de madrugada, sin nadie que lo mire, es exactamente lo
que esta rutina existe para no hacer. El dato que lo detectaría ya existe
(`processor.ts:505` calcula `closed`); falta decidir la respuesta.

Los demás altos y medios quedan **propuestos** en el tablero, con archivo:línea.

---

## Descartados tras verificar

- **"El descargo legal no sale por el canal principal" — FALSO.** `LEYENDA_CORTA`
  sí se renderiza, en `dashboard/page.tsx:197` y `dashboard/[id]/page.tsx:113`, que
  es el canal del contralor, a quien va dirigido. El WhatsApp va al operador y
  `resumen.ts:76-80` explica por escrito por qué a él no se le manda. Sobrevive
  degradado a **bajo**: la rama `'contralor'` de `resumen.ts:81` no tiene llamador
  de producción, así que cinco asserts validan una forma de llamada que el producto
  nunca produce.
- **"Una `tool_call` malformada podría hacer narrar cifras inventadas."** Cerrado
  por diseño: `openrouter.ts:500-505` registra `error:'args_parse'` sin ejecutar y
  `guardia.ts:37-38` exige `!t.error`. El propio auditor lo descartó tras intentarlo.
- **"`catalogoCuentas` no lo lee nadie, ni un test."** Impreciso: hay cuatro
  referencias en `config_merge.test.ts`. El fondo se sostiene (cero consumidores de
  producción, `export.ts:42-51` sin columna de cuenta) y queda como **bajo**.

---

## Compuerta sobre el árbol final

```
npm test          → 517 passed (51 archivos), 11.6s
npx tsc --noEmit  → exit 0
npm run lint      → exit 0
npm run build     → NO se corre en la nube (pide Supabase, OpenRouter,
                    Facturapi y Upstash; su fallo no diría nada del código)
```

## Lo que esta ronda no miró

Nueve rubros conservan nota sin haber sido auditados, y **sus notas califican
código anterior a los arreglos de la ronda 3** — el mismo desfase que esta ronda
vino a corregir en tres rubros sigue vigente en los otros nueve. Ningún auditor
pudo tocar Postgres ni OpenRouter: la concurrencia real (`try_lock_viaje`,
`guardar_liquidacion_tx`) y el ciclo de tool-calling contra un modelo vivo quedan
sin verificar en este entorno.

`MAPA.md` está desactualizado en un punto: lista `src/lib/agents/liquidacion/`,
que no existe en el repo.
