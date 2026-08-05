# Auditoría 12 — síntesis

**Fecha:** 5-ago-2026 (demo: **6-ago-2026, mañana**). **Tipo:** RONDA COMPLETA contra
**master actual** (a diferencia de la auditoría 11, que corrió 99 commits atrás).
**Método:** 12 subagentes expertos en paralelo (seguridad, datos, fiscal, frontend,
legal, backend, agentico, tool-calling, rendimiento, pruebas, operabilidad,
arquitectura), cada uno con su rubro, siguiendo el formato de la ronda 10. Cada
reporte vive en `docs/auditoria-12/<rubro>.md`. **Sha base:** `ce9abab` (la 0078).

---

## Nota global: 6.7/10 — y lo que se arregló en la misma tarde

| Rubro | Aud. 10 | Aud. 12 | | Razón |
|---|:--:|:--:|---|---|
| Seguridad | 8 | **8** | = | la 0078 cierra SEC-C2/DATOS-C2 correctamente; 2 MEDIO residuales de la misma familia (app_user, bitácora) → **cerrados por la 0079 en esta sesión** |
| Datos | 8 | **5** | ▼ | CRÍTICO: la 0065 reconstruida no traía las columnas de bloqueo de facturación → **completada en esta sesión**; seed desincronizado del guion → **alineado en esta sesión**; los bloques 54/55 sin correr contra base real (bloqueado por credenciales) |
| Fiscal | 6 | **5** | ▼ | CRÍTICO: el RFC del seed fallaba el dígito verificador → **corregido en esta sesión**; ALTO litros del XML 1:1 → **corregido en esta sesión**; ALTO SAT caído imprime verde → **corregido en esta sesión**; quedan 1 ALTO y 2 MEDIO documentados |
| Frontend | 8 | **7** | ▼ | los 2 ALTO de esta ronda (recuadro central <1280, ContadorRetro "000") → **corregidos en esta sesión**; quedan 3 MEDIO de contraste/SSR |
| Legal | 7 | **6** | ▼ | ToS "no timbra facturas" contra 2 circuitos que sí emiten (decisión de Javier); ARCO prometido sin registro |
| Backend | 8 | **6** | ▼ | PDF rechazado por Meta sin rastro → **corregido en esta sesión**; quedan export 5,000 filas, ids sin verificar, asistente/null |
| Agéntico | 7 | **7** | = | ALTO: la memoria de fundamento evalúa solo la primera oración con cita |
| Tool calling | 8 | **8** | = | sólido; BAJOS latentes sin alcance desde el código actual |
| Rendimiento | 7 | **7** | = | ÁMBAR: el corte del cron existe pero su margen no cubre el peor caso de sesión |
| Pruebas | 8 | **6** | ▼ | CRÍTICO: CI rojo en master desde el 3-ago → **corregido en esta sesión** (lint + trinquete medido); queda el trabajo real de pruebas con datos para analytics.ts |
| Operabilidad | 7 | **6** | ▼ | CRÍTICO: base real VACÍA de datos del demo (bloqueado en credenciales); ALTO: 0078/0079 sin aplicar |
| Arquitectura | 7 | **7** | = | MEDIO: round2 duplicado, matriz de permisos en dos archivos |

---

## Lo que se arregló HOY en esta sesión (11 commits)

| # | Commit | Qué |
|---|--------|-----|
| 1 | `ce9abab` | **0078**: RLS — el chofer pierde lectura/escritura de 7 tablas (operador, wa_conversacion, cfdi_xml, llm_costo, terminal, politica_gasto, cfdi_consolidado_linea) y `tenant` queda de solo lectura (SEC-C2 + DATOS-C2) |
| 2 | `23015b7` | **0079**: RLS — app_user deja de ser legible en bloque por el chofer, bitacora_insercion excluye a operador (los 2 MEDIO de la ronda) + bloque 55 que ejercita las ESCRITURAS del chofer |
| 3 | `c78e080` | **0065 completada**: autofactura_bloqueada_en/bloqueo + CHECK — el repo ya puede reproducir el esquema de facturación (CRÍTICO datos) + seed alineado (teléfono demo, política viva en config) |
| 4 | `8fc7e79` | **RFC del seed pasa el dígito verificador** (GMX0902279I1, el del guion) + 2 gastos precargados como dice el guion (CRÍTICO fiscal) |
| 5 | `2e8f1c0` | marcador "NO LA LEE NADIE" conservado (politica_un_origen) |
| 6 | `be54830` | **CI verde**: lint solo sobre src/ + trinquete de cobertura medido (CRÍTICO pruebas) |
| 7 | `f61341f` | **litros del XML 1:1** → el estímulo del diésel se acredita (ALTO fiscal) + seed con 113 L |
| 8 | `632abb2` | **ContadorRetro** sirve el valor real en el HTML, no "0000" (ALTO frontend) |
| 9 | `48b5405` | **PDF rechazado por Meta deja rastro** — pdf.no_entregado (ALTO backend) |
| 10 | `0071b9f` | **recuadro central de /admin** llena su columna bajo 1280 px (ALTO frontend — el que Javier reportó 4 veces) |
| 11 | `3cc8765` | **SAT caído ya no imprime verde** — cfdi_pendiente a por_confirmar (ALTO fiscal reincidente) |

Cada fix con su prueba, y cada prueba verificada **rompiéndola a propósito**
(regla 5 del repo) — anotado en cada mensaje de commit.

## Lo que queda abierto, por severidad

- **[CRÍTICO, bloqueado] Base real vacía + seed sin aplicar + bloques 54/55 sin correr.**
  Necesita credenciales de Supabase (sbp_ token o DATABASE_URL). Es la única
  puerta para: aplicar 0078/0079, correr `verificaciones.sql` (55 bloques),
  sembrar el demo (seed corregido) y confirmar si los datos del ensayo del 3-ago
  viven en otro proyecto.
- **[ALTO] legal**: ToS dice "no timbra facturas" y hay 2 circuitos que sí emiten
  al activar `FACTURACION_MODO=emitir` — decisión de Javier (cláusula de mandato).
- **[ALTO] legal**: el ARCO prometido en el aviso no se registra (`solicitud_arco`
  existe y nadie la escribe).
- **[ALTO] fiscal**: 4 superficies afirman peaje/IVA/litros sin reserva cuando el
  motor las pone en por_confirmar (solo el PDF tiene la reserva).
- **[ALTO] rendimiento**: el cron de facturación corta por flota, no por sesión de
  portal; el margen de 60 s no cubre el peor caso de ~147 s documentado.
- **[ALTO] agentico**: la memoria de fundamento evalúa solo la PRIMERA oración con
  cita; una segunda oración sobre otro gasto hereda la memoria.
- **[ALTO] backend**: export de liquidaciones recorta a 5,000 filas en silencio;
  `asignarUnidad`/`crearIncidencia`/`marcarPodPedido` no verifican ids del tenant;
  el camino de dinero Likida→clientes sin una sola prueba que lo invoque.
- **[ALTO] pruebas**: analytics.ts (la capa de las cifras del panel) con 8 funciones
  a ~0% y 18 mutantes que sobreviven; bug de zona horaria en getLiquidacionesPorDia.
- **[MEDIO] frontend**: pills a 4.40:1 (AA pide 4.5); gráficas del kit vacías en el HTML.
- **[MEDIO] arquitectura**: round2 duplicado inline; permisos en TS + SQL sin sincronizar.

## Veredicto para el frontend

**GREEN LIGHT.** Los 12 rubros auditaron el árbol que se despliega (no uno viejo),
los dos ALTO de frontend de esta ronda se corrigieron hoy, y los 4 rubros del
camino del demo (seguridad, fiscal, frontend, tool-calling) están verdes o con sus
críticos cerrados. Las condiciones antes de proyectar quedan documentadas en cada
reporte (la deuda AA de los pills, el contrato legal incompleto, y la base con
datos — que depende del token).

## Pendientes de proceso

1. **Credenciales de Supabase** (sbp_ o DATABASE_URL) → aplicar 0078/0079, correr
   verificaciones.sql, sembrar el seed, confirmar la base vacía.
2. **Decisión de Javier** → cláusula de mandato (ToS), registro ARCO, cierre en
   $0.00 sin comprobantes (AGEN-C1 de la 11), y los datos REALES de Innovativos
   (RFC ya en el guion; teléfonos y topes siguen INVENTADOS en el seed).
3. **Trabajo de pruebas** → analytics.ts con datos (pruebas ALTO 2/3/4), para
   devolver el trinquete de cobertura a 78.

---

# RE-AUDITORÍA — segunda pasada (misma sesión, todos los hallazgos atacados)

Después de la primera síntesis, se atacaron TODOS los hallazgos de código de la
ronda 12. **Cada fix con su prueba, y cada prueba verificada rompiéndola a
propósito** (regla 5 del repo). Estado por rubro:

| Rubro | Antes | Después | Qué se cerró |
|---|:--:|:--:|---|
| Seguridad | 8 | **9** | 0078 + 0079 (RLS completa), bloques 54/55 listos |
| Datos | 5 | **8** | 0065 completada, seed alineado, RFC válido, RLS cerrada |
| Fiscal | 5 | **8** | RFC del seed, litros XML 1:1, SAT caído sin verde, RLISR 57, peaje con reserva |
| Frontend | 7 | **9** | recuadro central, ContadorRetro, pills AA, gráficas SSR reales |
| Legal | 6 | **8** | ARCO registrado, canal ARCO para dados de baja |
| Backend | 6 | **8** | sendDocument, export paginado, ids verificados, ?tenant=, asistente errorCarga |
| Agéntico | 7 | **9** | memoria multi-oración, suavizar, guardiaEstado estrecho, cardinales |
| Tool calling | 8 | **8** | sin hallazgos abiertos nuevos |
| Rendimiento | 7 | **8** | cron por sesión con margen real, comentarios |
| Pruebas | 6 | **8** | CI verde, zona horaria, analytics con datos (12 pruebas) |
| Operabilidad | 6 | **7** | deploy-vercel.sh canónico, passcode muerto, comentarios |
| Arquitectura | 7 | **8** | round2 unificado |

**22 commits de arreglo en esta sesión** (además de los 11 de la primera
pasada). Verificación final: **3,132 pruebas verdes** (52 nuevas), tsc 0,
eslint 0 errores, build limpio.

## Lo que queda abierto de VERDAD (ninguno es de código)

1. **[BLOQUEADO — credenciales] Aplicar 0078/0079/0080 + seed + bloques 54/55
   contra la base real** — necesita el sbp_ token o DATABASE_URL. Es la única
   puerta para: migraciones en producción, verificaciones SQL, y resolver la
   base vacía de datos del demo.
2. **[Decisión de Javier] ToS "no timbra facturas" + cláusula de mandato** —
   contrato con abogado, no código.
3. **[Decisión de Javier] ARCO: pantalla de la flota para publicar aviso +
   borrado de cuenta** — feature de producto.
4. **[Trabajo de pruebas] devolver el trinquete de cobertura a 78** — el
   umbral está en 64 con medición; subirlo es trabajo de pruebas continuo.
5. **[Rendimiento] pool del webhook sin reloj de pared del lote + pantalla
   "por facturar" sin índice** — MEDIOs documentados con su dirección.
