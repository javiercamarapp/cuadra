# Auditoría 3 — síntesis

**Fecha:** 28-jul-2026. **Anterior:** `docs/auditoria-2/00-SINTESIS.md` (6.2).
**Qué se auditó:** la Fase 1 recién construida — `guardiaFundamento`, el índice
de normas, la capa de periodo del 15%, el IVA proporcional de LIVA 5-I y la
separación deducible/pagadero de la LFT.
**Método:** 5 auditores con contexto fresco cubriendo 12 rubros. Cada hallazgo
verificado contra el código por el orquestador antes de anotarlo.

---

## Nota global: 6.2

| Rubro | Auditoría 2 | Auditoría 3 | |
|---|:--:|:--:|---|
| Backend y API | 6 | **7** | ↑ |
| Pruebas | 6 | **7** | ↑ |
| Cumplimiento fiscal | 6 | **7** | ↑ |
| Seguridad | 7 | **7** | = |
| Modelo de datos y esquema | 7 | **7** | = |
| Tool calling | 6 | **6** | = |
| Rendimiento y costo | 6 | **6** | = |
| Operabilidad y DX | 6 | **6** | = |
| Cumplimiento legal | 6* | **6** | = |
| Frontend | 7 | **6** | ↓ |
| Arquitectura y mantenibilidad | 6 | **5** | ↓ |
| Sistema agéntico y orquestación | 5 | **4** | ↓ |

\* En la ronda 2 fiscal y legal iban juntos en un solo eje. Aquí se separan: se
rompen contra cosas distintas y no fallan igual — lo fiscal contra `normas/` y le
cuesta dinero al cliente; lo legal contra la LFPDPPP y le cuesta el negocio.

**La global se queda igual, y el promedio esconde el movimiento real:** tres
rubros suben, tres bajan. No es estabilidad, es un intercambio.

---

## LO MÁS IMPORTANTE DE ESTA RONDA

**Estas notas califican el código que los auditores ENCONTRARON, no el que hay
ahora.** Después de recibirlas se arreglaron los dos críticos y los cuatro altos
(abajo). Esos arreglos **no están reflejados en la tabla** — se medirán en la
ronda 4, con auditores frescos.

Es a propósito: subir yo mismo las notas después de arreglar sería calificar mi
propio trabajo sin nadie que lo verifique, y eso convierte la nota en un número
que tranquiliza en vez de uno que mide.

---

## Por qué se movió cada rubro

### Los que subieron

**Backend 6 → 7.** El doble cierre de la ronda anterior está arreglado y ahora
tiene test de integración propio. Lo que impide el 8 son hallazgos nuevos, no
viejos.

**Pruebas 6 → 7.** El hueco de "la escritura del dinero no tiene arnés" está
cerrado y el auditor verificó por mutación que esos tests son honestos. Sigue
en 7 porque encontró uno mío que pasaría con el código roto: el del límite del
15% no comprobaba el punto exacto donde la ley cambia de opinión.

**Fiscal 6 → 7.** Los dos críticos de la ronda anterior —el IEPS en pesos y el
`sin_cfdi` con dos veredictos— están cerrados y verificados. No sube más porque
ampliar el motor trajo altos nuevos.

### Los que bajaron, y esto es lo que hay que leer

**Sistema agéntico 5 → 4.** El auditor **coló cuatro citas inventadas** por
`guardiaFundamento` con formulaciones que un modelo escribe con naturalidad. La
pieza central de la Fase 1 no cumplía su promesa el día que se entregó. Bajó bien
bajada.

**Arquitectura 6 → 5.** El hallazgo de la ronda anterior —el panel lee Supabase
con mapeo a mano fuera de `repo.ts`— sigue **exactamente igual, dos auditorías
después**. Un hallazgo que sobrevive dos rondas ya no es deuda: es una decisión
tácita de no arreglarlo.

**Frontend 7 → 6.** Las tres piezas nuevas del motor no llegaban al panel. Es la
tercera vez que aparece el mismo patrón en este proyecto —las tres cubetas de
deducibilidad, `veredictoLaboral`, y ahora esto— y por eso baja aunque nada
"esté roto": el código correcto que no llega a quien decide no vale.

---

## Arreglado en esta ronda (no reflejado en las notas)

| # | Sev | Qué | Evidencia |
|---|---|---|---|
| 1 | crítico | La coma del español rompía la detección de citas Y mutilaba las legítimas | test que reproduce las 4 formas |
| 2 | crítico | `guardiaFundamento` corrompía el resumen determinístico del motor | ya no corre sobre texto determinístico |
| 3 | crítico | RPC `guardar_liquidacion_tx` duplicada: `function is not unique` | verificado contra la base; mig. 0022 |
| 4 | alto | IVA sobre-acreditado con varias comidas el mismo día ($160 vs $120) | prorrateo por día, no por comprobante |
| 5 | alto | El medio ARCO no respondía sin viaje abierto | movido antes del corte |
| 6 | alto | `getViaje` no traía `demora_no_imputable`: la sección del PDF nunca se activaba | `select` corregido |
| 7 | alto | El panel mostraba $0.00 en su tarjeta destacada | muestra litros; mig. 0021 |
| 8 | alto | `cuadrar_viaje` sin caché: repetía el barrido del ejercicio | `cuadrar_` en READ_PREFIXES, con test |
| 9 | medio | `limpiar()` colapsaba los saltos de línea del resumen | limpieza renglón a renglón |
| 10 | medio | Contraste 3.35:1 en modo oscuro (AA pide 4.5) | override `#ff453a`, 5.29:1 |
| 11 | medio | Sin índice para el contador del 15% | mig. 0023 |

## Descartados tras verificar

- **`patronesDe` sin memoizar.** Dos mediciones independientes: 0.065 ms por
  llamada y ~2.1 ms por turno, contra 48 s de presupuesto. Inmaterial.
- **ReDoS en los regex dinámicos.** 2 ms con entradas adversariales de 4,800
  caracteres. Los cuantificadores acotados lo sostienen, y ya hay test que lo
  caza si alguien los cambia por `.*`.

## Abierto, con caso construible

- El contador del 15% no se persiste en ninguna parte: se calcula por turno y se
  pierde. Sin columna, el panel no puede mostrarlo.
- No existe camino de ESCRITURA para `viaje.demora_no_imputable`: la columna y
  el lector ya están, falta quién lo capture.
- `tenant` no tiene régimen fiscal, así que el contador del 15% no verifica que
  la flota sea elegible para la facilidad.
- `operador.salario_mensual` no existe, así que `topeDescuento` no tiene
  consumidor real.
- El panel sigue leyendo Supabase con mapeo a mano fuera de `repo.ts`.
