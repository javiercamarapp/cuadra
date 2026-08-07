# REPORTE DE ESTADO — Likida

> Última actualización: **6 de agosto de 2026**. Un solo reporte del estado
> real del software, verificado contra el código y la base de producción.
> Los 15 reportes de auditoría previos (rondas 2–16) se retiraron: sus
> hallazgos están cerrados y esto resume lo que importa saber hoy.

---

## 1. Qué es

**Likida** liquida viajes de autotransporte federal por WhatsApp. El operador
fotografía sus comprobantes (diésel, casetas, viáticos), el agente hace OCR,
lee el CFDI, cuadra contra el anticipo y la política de la empresa, aplica la
ley fiscal mexicana y entrega la liquidación en PDF con el registro listo para
el ERP de la flota. No reemplaza el ERP: lo alimenta.

- **Repo:** github.com/javiercamarapp/likida.ai · rama `master`
- **Prod:** app.likida.ai (Vercel) · Supabase us-east-2 · WhatsApp Cloud API (Meta)

---

## 2. Salud del código (verificado hoy)

| Indicador | Estado |
|---|---|
| Pruebas | **3,149 verdes** (1 saltada, regla de pago manual) · 249 archivos |
| `tsc --noEmit` | 0 errores |
| `eslint src/` | 0 errores (18 warnings) |
| Build de producción | limpio |
| Cobertura | 68% líneas · trinquete 67 (sube de 64) — el objetivo 78 requiere tests de UI (jsdom), sesión dedicada |

---

## 3. Garantías verificadas contra la base real

- **42 tablas, 42 con RLS activo** · 26 funciones · 61 bloques de verificación
  en `supabase/verificaciones.sql`, corridos contra la DB de producción:
  mutex de doble liquidación, un CFDI = un gasto, aislamiento entre flotas,
  chofer sin escritura ni lectura de datos ajenos, POD amarrado a tenant,
  bitácora inmutable, triggers de "nada entra tras liquidar".
- **Migraciones:** 81 en el repo · aplicadas hasta la 0085 en la DB (la 0085
  arregla el crash de `config_tenant_valida` con la facilidad del 15%).
- **Fail-closed:** lo que no se puede verificar se marca "por confirmar" —
  nunca se inventa una cifra, un régimen ni una deducción.

## 4. En producción (verificado hoy)

- App y `/demo` responden 200.
- Webhook de WhatsApp verificado con el token real, apuntando a
  `app.likida.ai/api/webhook/whatsapp`.
- Whitelist de WhatsApp confirmado (Meta acepta envíos al número de prueba).
- Cron de facturación corriendo: `/api/cron/facturar` 200 (playwright
  empaquetado), encola a QStash con verificación de firma y fallback síncrono.
- Datos demo genéricos: FLOTA DEMO SA DE CV · RFC ficticio válido ·
  5 operadores · viajes · liquidaciones · solicitud ARCO.

## 5. Pendientes (lo que falta para el "máximo")

| Tema | Qué falta | Depende de |
|---|---|---|
| ToS + cláusula de mandato | borrador en `docs/conocimiento/legal/` | abogado |
| Régimen fiscal real | `tenant.regimen_fiscal` (601/612) de la flota piloto | dato del cliente |
| Plantilla ARCO v2 | aprobación de Meta (días) | Meta |
| Cobertura 78 | tests de componentes UI (jsdom) | sesión dedicada |
| Piloto | 2 empresas, solución a medida, mejora continua | proceso comercial |

---

## 6. Decisiones clave (para no repetir historia)

- **El motor de cuadre es el producto**, no el OCR: veredictos de
  deducibilidad con fundamento citado y contadores fiscales (15% efectivo,
  viáticos, estímulos) que nadie más lleva.
- **Un rótulo tiene que ser verdad**: datos de demo se marcan como tales;
  los RFC son ficticios con dígito verificador válido, no de terceros reales.
- **Complemento, no sustituto**: Likida se integra a lo que la flota ya usa
  (WhatsApp, ERP, Excel) y escribe el ERP en vez de reemplazarlo.
- **Fail-closed sobre inventar**: si el contador del ejercicio no está o el
  gasto es de otro año → `por_confirmar` con nota honesta, nunca
  "excedente contra $0".

## 7. Estructura del repo

- `src/` — la aplicación (Next.js + motor de cuadre + agentes + SaaS)
- `supabase/` — migraciones SQL, verificaciones, seed
- `normas/` — las normas legales como datos vivos del motor fiscal (YAML)
- `pruebas-manuales/` — arneses que sí llaman a los modelos reales
- `docs/REPORTE-ESTADO.md` — este reporte (el único de estado)
- `docs/conocimiento/` — fiscal, legal, industria e investigaciones (agrupado)
- `README.md` — qué es, arquitectura y cómo correrlo
