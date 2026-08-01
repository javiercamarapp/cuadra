# Mapa del repo — para los auditores (ronda 9)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026** (5 días). El comprador es el **contralor** de
la flota. Un error que el contralor vea en la sala cuesta el trato.

## QUÉ CLASE DE RONDA ES ESTA, Y POR QUÉ IMPORTA PARA TU TRABAJO

**RONDA COMPLETA, no ligera.** Desde el sha base de la ronda 8 (`43ebf41`)
hasta `HEAD` hay **18 commits, 75 archivos, +7836/-271 líneas**. Los doce
rubros se auditan hoy con contexto fresco.

Dos sesiones de Claude Code trabajaron el árbol en paralelo hoy — uno de los
commits (`42ac86d`) lo dice explícitamente en su mensaje ("VA MEZCLADO, y no
se puede separar"). No es motivo para descontar nada per se, pero sí para
revisar con más cuidado que las dos piezas interactúan bien: en particular,
`processor.ts` y `repo.ts` llevan cambios de ambas.

## LO QUE YA SE ARREGLÓ DESDE LA RONDA 8 — VERIFICA QUE DE VERDAD CERRÓ

La ronda 8 dejó un crítico pendiente (diseño validado, aplicación diferida) y
14 altos. Los commits dicen que todos se cerraron. **No lo des por hecho — es
tu trabajo confirmarlo o reportarlo como reincidente:**

| ID | Qué era | Commit que dice haberlo cerrado |
|---|---|---|
| Crítico #6 | CFDI sin RFC receptor sale deducible en verde | `70b970d` |
| Agéntico | El aviso de barrera vencida manda a hacer algo que la 0036 ya prohíbe | `470f5f3` |
| Agéntico/Datos | La 0036 solo blindaba el INSERT; el UPDATE de XML podía reescribir cifras post-liquidación | `1e3c5db` (mig. 0037) |
| Agéntico REINCIDENTE | Sin ninguna tool en el turno, `guardiaFundamento` corre con `permitidas=[]` y mutila cualquier cita | `b65eb4f` — permite repetir una cita ya legítima de un turno anterior del mismo viaje |
| Agéntico | El XML del CFDI no toma la barrera de intake ni el mutex del viaje | `8433db4` (mig. 0038 reusada) |
| Legal | El aviso prometía "retención cero"; el detector de oposición secuestraba quejas de tickets | `1bf8469` |
| Pruebas | `gasto_tarde.test.ts` probaba el TEXTO del cableado, no el cableado (6ª aparición del patrón) | `3971651` |
| Backend | `ConsultaFallida`/`OperadorAmbiguo` nunca se disparaban DENTRO de una llamada real a `processInbound` | `d7e9191` |
| Backend | Duplicados benignos del brazo de imagen (23505) sin prueba de integración | `a66b828` |
| Operabilidad | `loadConversation`/`saveConversation` descartaban `error` de Supabase | `01afba0` |
| Rendimiento | `analytics.ts` recortaba a 1,000 filas en silencio | `ebd2062` |
| Rendimiento | El tope de consulta (repo.ts) no cubría `conv.ts`/`costos.ts`/`config.ts` — 11 de 13 pasos del cierre sin techo | `d7dbe51` |
| Fiscal | El permiso CRE es requisito de deducibilidad de LISR 27-III/RFA 2026 2.9 y no se validaba ni mencionaba en ningún lado | `7301adc` — aviso a REVISAR, decisión explícita de NO bajar la cubeta (ver el propio commit) |
| Rendimiento REINCIDENTE | El protocolo de dos fotos pagaba visión completa dos veces | `42ac86d` (mig. 0038) — retiene el ticket sin código unos segundos por si llega el acercamiento |

Si alguno de los catorce sigue roto pese al commit, es el hallazgo más
valioso que puedes traer hoy: significa que el arreglo no ancló.

## Un hallazgo de la ronda 8 que NO se atacó — sigue abierto

**Arquitectura:** `round2()` reimplementado en 4 archivos de dinero distintos,
con el mismo bug de redondeo (`round2(1.005)` da `1`, no `1.01`) en las
cuatro copias. La síntesis de la ronda 8 lo marcó explícitamente como "no se
atacó esta ronda". Verifica si sigue en los mismos 4 sitios.

## Otros cambios grandes de este período, por si tocan tu rubro

- **Intake / dos fotos:** además del ahorro de visión (arriba), una sesión
  concurrente encontró y arregló un bug real con datos del ensayo del
  1-ago-2026: `soloCodigo` se evaluaba antes que `soloPago` en `ocr.ts`, así
  que un voucher de terminal (que también trae código de barras) se
  clasificaba como "acercamiento" y el operador recibía un mensaje sin
  sentido pidiendo un ticket que no existe (`3a937dd`).
- **Corrección de fecha por segunda foto:** cuando una fecha sale dudosa
  (`cuadre/fecha_dudosa.ts`, nuevo — compartido entre motor e intake), se le
  pide al operador la foto otra vez, y esa foto ahora RE-FECHA el gasto que
  ya existe en vez de darlo de alta de nuevo (`intake/decidir.ts`,
  `intake/emparejar.ts::emparejarCorreccionDeFecha`, `intake/pedir_fecha.ts`,
  `repo.ts::corregirFechaGasto`, todo en `42ac86d`). Revisa el emparejamiento
  con cuidado: es un camino nuevo que toca qué gasto se factura.
- **OCR de fechas:** el prompt de `intake/ocr.ts` cambió de "México puede
  imprimir MES/DÍA como EEUU" a "México imprime DÍA/MES, con Costco como
  única excepción confirmada" (`b1804f9`) — verifica que la ficha no esté
  sobre-generalizando de un solo ticket real.
- **Modelo de datos:** dos migraciones nuevas, `0037` (UPDATE tras liquidar,
  gemela de la 0036) y `0038` (`foto_pendiente`, con `unique(viaje_id)`).
  Ambas aplicadas al proyecto real (`gngoqsvrxdguxvsizpbw`) y verificadas
  contra Postgres real, no solo mockeado — bloques 20 y 21 de
  `supabase/verificaciones.sql`.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` puro y sin
  I/O. `guardia.ts`, `resumen.ts`, `cifras.ts`, `leyendas.ts`, `fecha_dudosa.ts`
  (nuevo).
- `src/lib/cuadra/processor.ts` — el pegamento: WhatsApp → intake → agente →
  respuesta. El archivo más tocado de esta ronda (+189 líneas): barrera del
  XML, retención de foto pendiente, corrección de fecha.
- `src/lib/cuadra/repo.ts` — acceso a datos. Nuevo: `guardarFotoPendiente`,
  `existeFotoPendiente`, `reclamarFotoPendiente`, `corregirFechaGasto`.
- `src/lib/cuadra/intake/` — OCR y decisión de qué hacer con cada foto/XML.
  `ocr.ts` (`tieneCodigoLegible` nuevo), `decidir.ts` (acción
  `corregir_fecha` nueva), `emparejar.ts` (`emparejarCorreccionDeFecha`
  nuevo), `cfdi_xml.ts`, `pedir_fecha.ts` (nuevo).
- `src/lib/cuadra/normas/` — `fundamento.ts` (guardia de citas),
  `por_diferencia.ts` (qué norma respalda cada `TipoDiferencia`,
  `permiso_cre_no_verificable` nuevo aquí).
- `src/lib/cuadra/facturacion/permiso_cre.ts` — tabla de 12,625 permisos CRE.
  Sigue sin un consumidor real (identifica gasolinera desde el TICKET
  impreso, no desde el XML) — la ronda 9 debe verificar si esto sigue siendo
  cierto tras el commit `7301adc`, que deliberadamente NO conecta esta tabla
  (ver el propio mensaje de commit para el razonamiento).
- `src/types/cuadra.ts` — `TipoDiferencia` con `permiso_cre_no_verificable`
  nuevo.
- `supabase/migrations/` — `0037`, `0038` nuevas, ambas aplicadas al proyecto
  real y verificadas contra Postgres real (`supabase/verificaciones.sql`,
  bloques 20 y 21).

## Qué NO tocar

`pruebas-manuales/*.prueba.ts` hacen llamadas reales de pago — no se corren.
No editar código: los doce auditores encuentran y califican, el orquestador
arregla después.
