# Auditoría 2 — síntesis

**Fecha:** 28-jul-2026. **Anterior:** `docs/conocimiento/51-boletin-tecnico.md` (6.4).
**Método:** 6 auditores con contexto fresco, uno por eje, cada uno con su archivo.
Todo hallazgo aquí está **verificado contra el código** por el orquestador, no
copiado del reporte del agente.

## Nota global: 6.2 (antes 6.4)

| Rubro | Antes | Ahora | |
|---|:--:|:--:|---|
| Backend y API | 8 | 6 | ↓↓ |
| Tool calling | 7 | 6 | ↓ |
| Arquitectura y mantenibilidad | 7 | 6 | ↓ |
| Sistema agéntico y orquestación | 6 | 5 | ↓ |
| Seguridad | 7 | 7 | = |
| Pruebas | 6 | 6 | = |
| Operabilidad y DX | 6 | 6 | = |
| Modelo de datos y esquema | 6 | 7 | ↑ |
| Frontend | 6 | 7 | ↑ |
| Rendimiento y costo | 5 | 6 | ↑ |
| *Cumplimiento fiscal y legal* | — | 6 | eje nuevo |

**Bajó, y no es un fracaso: es la lectura correcta.** Los tres rubros que se
atacaron directamente subieron. Los cuatro que bajaron lo hicieron por dos
razones distintas, y conviene no confundirlas:

1. **Deuda que cobró su factura.** Arquitectura bajó porque la desincronización
   que el boletín anterior señaló *como advertencia* ya volvió a ocurrir: hoy
   `engine.ts:467` dice `otro: 'Gasto'` y `pdf.ts:27` dice `otro: 'Otro'`.
2. **Miradas más profundas.** Backend, tool calling y agéntico bajaron por bugs
   que **ya estaban** y nadie había visto — el bypass de la guardia lleva ahí
   desde que existe el regex. La nota anterior estaba inflada, no es que el
   código haya empeorado.

## Lo que hay que arreglar, en orden

### 1. [CRÍTICO] Se puede colar una cifra inventada — la regla fundacional
`cuadre/cifras.ts:9` · `cuadre/guardia.ts:29`
El portón `tieneCifrasDeDinero` exige `$`, coma de miles, `.XX`, "pesos/mxn" o
una de 8 palabras clave junto al número. Frases naturales lo evaden, **medido**:

    SE ESCAPA → "Tu resultado final: 8000"
    SE ESCAPA → "Te sobraron ocho mil pesos"
    SE ESCAPA → "Quedó así: 8000 contra 8500"
    SE ESCAPA → "Tu saldo: 500 a tu favor"

`guardia.ts:29` corta ahí mismo, así que esas frases pasan sin verificación
**incluso cuando `cuadrar_viaje` se llamó** y el reemplazo forzado debería
dispararse. Es la garantía sobre la que se vende el producto.

### 2. [CRÍTICO] El IEPS impreso es la cifra equivocada
`cuadre/engine.ts:290` · `liquidacion/pdf.ts`
Se suma el **IEPS trasladado del CFDI**. El estímulo del LIF 2026 art. 20-A es
**cuota semanal disminuida × litros**. La ficha propia del proyecto
—`normas/lif-2026-20-A.yaml`, `verificado_fuente_primaria`— dice literal: *"No es
el IEPS trasladado en el CFDI."* Y esa cifra sale en el PDF, en verde, citando
ese artículo. Riesgo estimado en la propia ficha: ~$1M MXN/mes para una flota
mediana. Un contador lo detecta en la primera revisión.

### 3. [ALTO] Doble cierre: dos PDFs y dos cobros de LLM
`processor.ts:417`
Si `acquireViajeLock` devuelve `false` (que tras el arreglo de B22 **solo**
significa ocupación real), no se hace `return`: se sigue sin mutex. Dos "listo"
seguidos → el segundo espera 12s, no consigue el lock, ve el viaje aún abierto y
corre el agente también. La BD impide la doble fila (upsert), pero como el upsert
no lanza, ambas ejecuciones reportan éxito.

### 4. [ALTO] `sin_cfdi` recibe dos veredictos opuestos
`cuadre/engine.ts:176` y `:407`
`sin_cfdi` está en `NO_DEDUCIBLE_ISR`, que se evalúa **antes** que la regla de
"ticket sin timbrar → POR CONFIRMAR". El mismo hecho sale rojo o ámbar según el
flag `requiereCfdi` del tenant, no según la ley. **Introducido el 28-jul** al
añadir la regla del ticket.

### 5. [ALTO] Hueco en el reloj de presupuesto: el OCR no lo consulta
`intake/ocr.ts` · `processor.ts:205-402`
Las ramas de foto y documento nunca miran el reloj, y `generateStructured` no
pasa `AbortSignal` → cae al default del SDK de OpenAI (10 min). Como el webhook
procesa el lote con `Promise.all` en UNA invocación, una foto lenta puede tumbarla
aunque el "listo" esté bien presupuestado.

### 6. [ALTO] Contabilidad de costo incompleta en el camino de error
`llm/openrouter.ts:339` · `processor.ts`
`PartialExecutionError` no carga el costo acumulado, y la rama de error nunca
llama `registrarCosto`. El gasto de una liquidación que cae en recuperación de
cierre parcial —flag ya activo por default— es invisible para un negocio que va a
cobrar por liquidación.

### 7. [MEDIO] `complemento_no_verificable` está mal enrutado
`cuadre/resumen.ts:24`
Su propia nota pide "reenvía el XML", pero el tipo está en `SOLO_CONTRALOR`: la
petición se filtra y nunca llega a quien tiene el XML.

### 8. [MEDIO] Seguridad, los dos de siempre, confirmados vivos
`passcode.ts:12` — sin `DASHBOARD_SECRET` el HMAC se deriva del propio passcode:
capturar una cookie permite crackearlo offline sin el rate-limit.
`middleware.ts:18` — autorización en una sola capa (hoy sin ruta expuesta, pero
estructuralmente frágil).

### 9. [BAJO] Baratos, ~10 min los dos
`engine.ts:467` vs `pdf.ts:27` — `otro: 'Gasto'` contra `otro: 'Otro'`.
`processor.ts:506` — `agent.fail` no dice qué viaje ni qué tenant falló.

## Un hallazgo que resultó FALSO

Un auditor sospechó que las RPC de 0017/0018 fallarían en producción por no
regrantar `EXECUTE` a `service_role`. **Verificado contra la base: las cinco
funciones tienen el privilegio.** Lo reportó como hipótesis a verificar, que fue
lo correcto — pero conviene dejar constancia de que se comprobó.

## Lo que sí quedó sólido (no romperlo)

- HMAC del webhook de Meta, con longitudes comparadas antes de `timingSafeEqual`.
- `repo.ts`, `analytics.ts`, `conv.ts` y todas las RPC filtran por `tenant_id`
  sin una sola excepción.
- Migraciones 0016-0019 con RLS y `revoke` correctos, sin `security definer`.
- La defensa de prompt-injection del OCR, con recorrido completo hasta el panel.
- El bug del destinatario de `guardia.ts` —el más caro del boletín anterior— está
  corregido y con regresión honesta.
- El mapa `CONCEPTO`, que era bloqueante, ya está sincronizado en sus 3 fuentes.
- El peor caso del camino "listo" ya cabe en `maxDuration`, con prueba.
