# Auditoría 13 — síntesis

**Fecha:** 5-ago-2026 (demo: **6-ago-2026, mañana**). **Tipo:** RONDA COMPLETA
contra **master actual** (tras los ~40 fixes de la ronda 12 y el deploy caae369).
**Método:** 12 subagentes expertos en paralelo, cada uno su rubro, con el
mandato de verificar los cierres de la ronda 12 Y buscar lo que quedó, lo que se
rompió al arreglar y las regresiones. Reportes en `docs/auditoria-13/`.

---

## Nota global: 7.2/10 (antes 6.7 con los fixes de la 12) — sube

| Rubro | Ronda 12 (re-aud) | Ronda 13 | | Razón |
|---|:--:|:--:|---|---|
| Seguridad | 9 | **8** | ▼ | los cierres RLS se mantienen; un MEDIO nuevo: el chofer puede auto-certificar PODs (`operador_sube_su_pod`) |
| Fiscal | 8 | **6** | ▼ | el ALTO del motor (SAT pendiente no acredita) NO se propagó al panel del contador; RLISR 57 a medias (nadie escribe operador.rfc); la válvula 15% sigue |
| Frontend | 9 | **8** | ▼ | cierres verificados; un MEDIO nuevo: CifraGrande sirve $0.00 si la consulta falla; el asistente expandido <1280 sigue |
| Backend | 8 | **7** | ▼ | los cierres se mantienen; quedan MEDIOs documentados de la 12 |
| Agéntico | 9 | **8** | ▼ | **regresiones del fix de la 12**: el salto por negación es de oración entera (mentira con "no" accesorio pasa); la pregunta sin ¿ se tacha; 1-10 y "diez" pasan el portón |
| Legal | 8 | **7** | ▼ | ARCO registrado pero NADIE lo lee (la flota no se entera); ToS reincidente 3 rondas; vence_en 15 vs 20 días |
| Pruebas | 8 | **7** | ▼ | los cierres se mantienen; cobertura sigue en trinquete |
| Rendimiento | 8 | **7.5** | ▼ | el ALTO del cron se atacó a medias: lote de 8 en una sesión sigue sin caber en 300 s |
| Operabilidad | 7 | **7** | = | seed.sh documentado pero no funciona contra base migrada; passcode vars siguen en Vercel |
| Tool calling | 8 | **7** | ▼ | deuda que cobró factura: hallazgos menores acumulados |
| Datos | 8 | **7** | ▼ | `operador_sube_su_pod` no amarra tenant_id del POD al viaje |
| Arquitectura | 8 | **7** | ▼ | round2 a medias (guard ciego); chat clasificado 'operacion' pero gatea 'dinero'; `[id]` ignora rolEfectivo |

**Lo importante de esta ronda: la subida real (6.7 → 7.2) es sólida — los ~40
cierres de la ronda 12 se verificaron uno por uno y NINGUNO se rompió en el
fondo.** Los hallazgos de la 13 son: (a) fixes que se quedaron a medias (el
estándar fiscal del motor no se propagó al panel; RLISR 57 sin productor; el
cron a medias), (b) regresiones estrechas de mis propios fixes (guardiaEstado
por oración, portón 1-10), y (c) decisiones/features que requieren producto
(ToS, ARCO legible por la flota, régimen del tenant).

---

## Hallazgos por severidad (detalle en cada reporte)

### ALTOS
1. **[fiscal] El panel del contador acredita IVA de CFDIs con estatus SAT
   `pendiente`/`no_encontrado`** — el motor se corrigió en la ronda 12
   (`cfdi_pendiente` → por_confirmar) y el panel (el export al ERP, la pantalla
   del contador) sigue acreditando. Mismo hecho, dos estándares.
2. **[legal, reincidente 3 rondas] ToS "No timbra facturas"** vs 2 circuitos que
   emiten al activar `FACTURACION_MODO=emitir` — decisión de Javier/abogado.
3. **[legal] ARCO registrado pero NADIE lo lee** — la flota obligada a contestar
   en 15/20 días no tiene forma de enterarse; `admin/compliance` dice que el
   flujo no existe.
4. **[rendimiento] El cron de facturación sigue sin caber el lote de 8 tickets
   en UNA sesión dentro de 300 s** — el margen cubre el peor caso de sesión
   única, no el lote completo.

### MEDIOS (los que se van a atacar en esta sesión)
- **[seguridad/datos] `operador_sube_su_pod`**: el chofer auto-certifica la
  entrega (la única escritura RLS que le queda) y no amarra el tenant del POD
  al del viaje — puede sembrar un POD en la flota de otro tenant.
- **[fiscal] RLISR 57 a medias**: `operador.rfc` existe pero nada la escribe —
  la rama buena sigue inalcanzable en producción.
- **[agéntico, regresiones del fix 12]**: (a) el salto por negación es de
  oración entera — "No te preocupes, ya cerré tu liquidación" pasa intacta;
  (b) la pregunta sin "¿" ("ya quedó cerrada mi liquidación?") se tacha; (c) el
  portón deja pasar "te sobran diez" (1-10 y "diez" fuera); (d) los cardinales
  en palabras no se cotejan contra la política.
- **[legal] `vence_en` 15 vs 20 días** — el art. 32 y el propio aviso dicen 20.
- **[legal] El camino ARCO pre-identidad elige tenant arbitrario si el teléfono
  está en dos flotas**.
- **[frontend] CifraGrande sirve $0.00 si la consulta de KPIs falló** — el
  cero-que-se-lee-como-medición en la cifra más grande del panel.
- **[operabilidad] seed.sh documentado pero no funciona contra base migrada**;
  passcode vars siguen en Vercel (DEPLOY.md miente).
- **[arquitectura] `/dashboard/chat` link del encargado muere solo; `[id]`
  ignora rolEfectivo** — la previsualización "ver como" ejecuta acciones de
  superadmin.

---

## VEREDICTO

**Green light para el demo** (los rubros del camino del demo —seguridad,
frontend, fiscal con el motor, tool-calling— están verdes o con sus ALTOS en
áreas que el demo no toca en vivo). Los 12 rubros promedian **7.2/10** (antes
6.7). Lo que se ataca AHORA en la sesión siguiente: las regresiones estrechas
del agéntico, la propagación del estándar fiscal al panel, el POD del chofer,
y el vence_en. Lo que queda de decisión: ToS/mandato, ARCO legible, régimen.

---

# RE-AUDITORÍA — segunda pasada (misma sesión, hallazgos atacados)

Los hallazgos de código de la ronda 13 se atacaron en la misma sesión (13
commits, cada uno con su prueba verificada rompiéndola a propósito):

| Hallazgo | Severidad | Commit |
|---|---|---|
| Regresiones de guardiaEstado (negación de oración entera; pregunta sin ¿) | MEDIO | `45de52c` |
| Portón de cifras 1-10 (y el 'un' que disparaba frases cotidianas) | MEDIO | `438c8f4`, `e048de1` |
| **El panel del contador acreditaba IVA de CFDIs sin confirmar** | **ALTO** | `37d75ee` |
| POD del chofer cruzaba tenant (mig. 0081 + bloque 56 pasando en la base real) | MEDIO | `4da0198` |
| vence_en rastrea los 20 días que el aviso promete | MEDIO | `94a3521` |
| CifraGrande sirve '—' con la consulta caída, no $0.00 | MEDIO | `ac58536` |
| operador.rfc por fin tiene productor (captura en el panel) | MEDIO | `5ef6993` |
| /dashboard/chat reclasificado 'dinero' | MEDIO | `de6416f` |
| [id] respeta rolEfectivo ('ver como' ya no ejecuta acciones de superadmin) | MEDIO | `b286aa8` |
| ARCO pre-identidad no elige tenant arbitrario | MEDIO | `574137c` |
| El cotejo contra la política ve los cardinales en palabras | MEDIO | `8d6eff7` |
| seed.sh funciona contra base migrada; passcode muerto fuera de .env.local y Vercel | ALTO+MEDIO | `c563a0a` |

**Verificación final: 3,143 pruebas verdes · tsc 0 · eslint 0 errores · build
limpio.** La base real ya tiene 0081 aplicada y el bloque 56 pasando.

## Lo que queda abierto de verdad (decisiones, no código)

1. **[Legal] ToS "No timbra facturas" + cláusula de mandato** — abogado de Javier.
2. **[Legal] ARCO registrado pero nadie lo lee** — la flota necesita una pantalla
   para ver/responder sus solicitudes (`admin/compliance` la confiesa).
3. **[Rendimiento] El lote de 8 tickets en UNA sesión sigue sin caber en 300 s**
   — ofuscar a QStash/cola real es el fix de fondo (FASE 3).
4. **[Fiscal] La válvula del 15% de la RFA 2.9 se ofrece a cualquier tenant**
   (régimen/dedicación no se capturan) — decisión de producto.
5. **[Datos] El perímetro de repo.ts sigue creciendo** — deuda estructural.
