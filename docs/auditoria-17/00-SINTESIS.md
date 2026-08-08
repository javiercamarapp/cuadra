# Auditoría 17 — síntesis · 8-ago-2026

**Ronda COMPLETA.** 12 auditores con contexto fresco, en paralelo, sobre
`94c0733`. Árbol limpio al arrancar → autofix habilitado. Rama
`claude/auditoria-17`, sin tocar `master`.

## Nota global: 5.8/10 (antes 7.2 en la ronda 13) — **baja 1.4**

Y esa bajada es el resultado de la ronda, no un accidente. **El código no
empeoró en tres días.** Bajó porque:

1. **La ronda 16 declaró cerrado el ciclo de auditoría** ("el loop cierra aquí")
   y dos de sus afirmaciones no se sostuvieron al comprobarlas contra el código:
   - *"el barrido anual del 15% ya es un SUM en SQL (mig. 0084)"* — la migración
     existe, pero **nadie la llama**: `grep -rn sumar_combustible src/` solo
     encuentra la cadena dentro de un test. `getAcumuladoCombustible`
     (`repo.ts:803-836`) sigue paginando hasta 100 páginas en el camino caliente.
   - *"la válvula del 15% ya no se ofrece a cualquier tenant"* — cierto como
     compuerta, pero quedó conectada al **código de régimen equivocado**.
2. **La mirada fue más profunda en tres rubros** que llevaban rondas sin que
   nadie recorriera su ciclo completo (agéntico, legal, rendimiento).

Las rondas 14, 15 y 16 no regrabaron los 12 rubros —fueron de arreglo—, así que
el delta se mide contra la **13**, la última con tabla completa.

| Rubro | R13 | R17 | | Razón del movimiento |
|---|:--:|:--:|---|---|
| Frontend | 8 | **6** | ▼ | mirada más profunda + deuda que cobró factura: dos rótulos que mienten ("Vencen pronto ≤5 días" cuenta solo lo ya vencido; "Comprobación del periodo" no filtra por fecha) y el asistente <1280 px REINCIDENTE |
| Backend y API | 7 | **6** | ▼ | deuda que cobró factura: QStash entró al camino del dinero sin una sola prueba; el cron responde `corrio: true` cuando solo encoló |
| Agéntico | 8 | **5** | ▼ | mirada más profunda — la nota anterior estaba inflada: el ciclo nunca se había recorrido punto por punto. CRÍTICO del PDF del contralor + "Listo 👍" sin mutación |
| Tool calling | 7 | **7** | = | se atacó y subió (la regla `properties:{}` se respeta en todas las tools, verificado), compensado por 5 MEDIO acumulados |
| Seguridad | 8 | **7** | ▼ | mirada más profunda: sin camino sin autenticar a datos de un tenant, pero el callback público de QStash es frontera nueva y `operador_sube_su_pod` sigue |
| Fiscal | 6 | **4** | ▼ | deuda que cobró factura + mirada más profunda: **dos sitios donde el producto imprime una cifra fiscal equivocada**; 7 de 11 no-críticos son REINCIDENTES verificados |
| Legal | 7 | **4** | ▼ | deuda que cobró factura: ToS reincidente 4 rondas, ARCO con dos reglas de plazo, y la foto del operador viaja al modelo externo antes del aviso |
| Arquitectura | 7 | **6** | ▼ | deuda que cobró factura: la verdad duplicada volvió a ocurrir (bloque "Acreditable" reimplementa `filasAcreditables` y perdió tres advertencias legales) |
| Pruebas | 7 | **6** | ▼ | mirada más profunda: **10 experimentos de mutación, 6 sobrevivieron**. El motor de cuadre está anclado; el anillo que lo rodea, no |
| Operabilidad | 7 | **6** | ▼ | deuda que cobró factura: `seed.sh` sigue, y el sondeo de arranque soltaba un mutex ajeno |
| Rendimiento | 7.5 | **5** | ▼ | deuda que cobró factura: el ALTO del cron lleva 4 rondas, el 0084 nunca se llamó, y el cierre no cabe en su propia reserva |
| Modelo de datos | 7 | **7** | = | se atacó y subió (`operador_sube_su_pod` cerrado y verificado en `0081:15-19`), compensado por las 0082/0083/0085 que borran el `search_path` de `config_tenant_valida` |

**113 hallazgos: 7 CRÍTICO · 36 ALTO · 47 MEDIO · 23 BAJO.**

## Los 7 CRÍTICOS, uno por uno

Sin cuarta opción: commiteado con prueba, `pendiente` con razón, o `descartado`.

### Cerrados en esta ronda (3)

**C1 · [agéntico] Al contralor le llegaba el PDF censurado del operador** — `0d6bea7`
`processor.ts:2111` firmaba `{viaje}-operador.pdf` (filtrado con `SOLO_CONTRALOR`
para que el chofer no lea `cfdi_efos`/`cfdi_cancelado`/`rfc_receptor`) y reusaba
**esa misma liga** para `avisarCierreAlJefe`. A la oficina le llegaba un texto que
sí nombra "proveedor en lista 69-B" con un PDF adjunto que no trae esa línea, y
que contradice al que se baja del panel. En **todo** cierre.
Prueba: `cierre_pdf_del_jefe.test.ts` (3 casos) — sin el arreglo falla en 2.

**C2 · [operabilidad] El sondeo de arranque liberaba el mutex de un viaje ajeno** — `61cf600`
`unlock_viaje` (mig. 0005) es un `delete` sin token de dueño. El probe llamaba
`try_lock_viaje(viaje_real, 1ms)` y luego `unlock_viaje` **incondicionalmente**.
Si otra invocación tenía el lease, `try_lock` devuelve `false` —no un error, así
que nada se reportaba— y el probe le borraba el lock: el siguiente mensaje del
lote entra a liquidar en paralelo. La doble liquidación que la 0005 existe para
impedir, causada por el probe que la verifica.
Prueba: `startup_mutex_ajeno.test.ts` (3 casos, con control).

**C3 · [fiscal] La facilidad del 15% se abría al régimen equivocado** — `37612f1`
RFA 2.9 dice, literal (ficha `verificado_fuente_primaria`, DOF/SIDOF 5780249):
*"Título II, **Capítulo VII** o Título IV, Capítulo II, Sección I"*. Título II
Cap. VII = **Coordinados = 624**. El código usaba `['601','612']` con el
comentario *"601 (General de Ley PM — coordinados)"*, fundiendo dos claves
distintas del catálogo; y `624` no estaba ni en la lista ni en el CHECK de la
0056. Abría para quien no califica —con el PDF imprimiendo "deducible" citando
la regla— y cerraba para el coordinado real, al que ni se le podía capturar el
régimen. Es el error de jerarquía que `normas/README.md` llama *"el más caro del
dominio"*.
Prueba: `regimen_facilidad_15.test.ts` (4 casos) — sin el arreglo fallan 2.
Incluye migración `0086` + bloque 62 de `verificaciones.sql`.

### Pendientes (4) — con la razón

**C4 · [fiscal] El 15% se mide contra "el combustible que Likida vio"**
`engine.ts:337,354` · `repo.ts:826-834`. La norma dice *"del total de los pagos
efectuados por consumo de combustible"*; el denominador real es solo lo que pasó
por el producto, y con él el PDF imprime "No deducible".
**Razón de pendiente:** el denominador correcto exige un dato que el producto no
tiene (el gasto de combustible que NO pasó por Likida). No es un arreglo de
código, es una decisión de producto: o se declara el supuesto en el PDF, o se
captura el total del ejercicio. Se propone, no se inventa.

**C5 · [legal] La foto viaja al modelo externo antes del aviso**
`processor.ts:522-525` corre entero antes del bloqueo de `:647`. Sin viaje
abierto, `downloadMediaAsDataUrl` + `extraerComprobante` ya mandaron la imagen
del operador a un tercero sin aviso ni constancia. **Verificado el orden.**
**Razón de pendiente:** mover el bloqueo antes del intake cambia el flujo de
huérfanos (la sala de espera de comprobantes sin viaje, mig. 0040) y puede dejar
fotos sin recoger. Es un cambio de diseño del ciclo, no de una línea, y con el
tope de 3 vueltas agotado no se toca a ciegas.

**C6 · [pruebas] El callback de QStash emite CFDI y no tiene una sola prueba**
`api/cron/facturar/cola/route.ts:40,66`, 0% de cobertura. **Verificado en vivo:**
el auditor le quitó la verificación de firma (`if (false)`) y la re-validación de
`cfdi_uuid`, y los 3,148 tests siguieron verdes.
**Razón de pendiente:** el arreglo es escribir el arnés de un endpoint que
factura de verdad; es trabajo de una sesión propia, no de una vuelta de auditoría.

**C7 · [rendimiento] El cierre no cabe en la reserva que él mismo aparta**
`presupuesto.ts:37-72`. `avisarCierreAlJefe` (2 lecturas + 1 envío) **no está en
`PASOS_CIERRE`** — verificado. Con sus propios números nominales el tramo se va a
~13.2s contra `MARGEN_CIERRE_MS = 12_000`, y dos consultas del tramo van sin
`acotada` (techo de undici: 300s contra `maxDuration=120`).
**Razón de pendiente:** subir el margen le quita techo al agente (de 48s a menos)
y esa es una decisión de producto con efecto en el demo. Lo que sí se hizo:
**anotar el paso que este mismo arreglo agregó** (`a30f7b0`), para que la
contabilidad no siga mintiendo — el archivo advierte que meter un paso sin
anotarlo es cómo la reserva deja de ser cierta.

## Descartados

Ninguno. Los 7 críticos se abrieron uno por uno contra el código y los 7 son
reales. Lo que sí hubo fue **una prueba que fijaba el bug**:
`ruta_pdf_sincronizada.test.ts` exigía que `processor.ts` NO nombrara la ruta del
contralor. Su intención era buena —que el chofer no reciba el ejemplar completo—
pero el proxy era el archivo entero, y con un solo PDF firmado eso obligaba a
mandarle al jefe el del operador. Se acotó y la garantía real pasó a la prueba de
comportamiento.

## Compuerta (salida real, árbol final)

```
npx tsc --noEmit -p .   → 0 errores
npx vitest run          → 252 archivos, 3,159 pruebas verdes, 1 saltada
npm run lint            → 0 errores, 18 warnings (mismo número que la línea base)
```

Sin `npm run build` y sin `pruebas-manuales/*`: no hay credenciales en la nube y
esas pruebas hacen llamadas de pago.

## Lo que esta ronda dice del proceso

- **Un rubro que se autocalifica sube.** La ronda 16 se puso 7 en fiscal; con las
  fichas abiertas al lado del código, el rubro está en 4. La calificación de un
  arreglo no la puede dar quien lo hizo.
- **Una migración aplicada no es una migración usada.** La 0084 se dio por
  cerrada tres rondas seguidas sin que nadie comprobara la llamada.
- **La suite grande da falsa seguridad.** 3,148 pruebas verdes y 6 de 10 mutantes
  sobreviven: el motor de cuadre está anclado de verdad, el anillo que lo rodea
  no. Es el dato más accionable de la ronda.
