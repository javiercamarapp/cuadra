# Demo Likida — Celinda (Dir. IT) y José Cárdenas (VP) — 6-ago-2026

> Regla del demo: **nada de cifras inventadas en vivo**. Si el dato no está en
> pantalla, no se afirma. Los operadores del demo son datos de demostración y
> así se presentan. La única excepción es la historia de negocio: se cuenta
> como lo que es (el problema del sector), no como métrica propia.

---

## 1. A quién le hablas

| | Celinda (Directora de IT) | José Cárdenas (VP) |
|---|---|---|
| Le importa | Seguridad (quién ve qué), dónde viven los datos, cómo se integra, cumplimiento (ARCO/LFPDPPP), qué pasa si se cae | Control del gasto de combustible, mermas/fraude, cash flow, que el SAT no los multe, adopción por los operadores |
| Lo que la convence | "Cada flota ve SOLO sus datos" (RLS probado), auditoría de 16 rondas, 3,147 pruebas, fail-closed | "El comprobante de cada litro está amarrado a la liquidación — nadie pone la cifra de memoria" |
| Su pregunta clave | "¿Dónde están nuestros datos y quién los toca?" | "¿Cuánto nos ahorra de verdad?" |

---

## 2. Guion de 10 minutos (4 actos)

### Acto 1 — El problema (30s, para ambos)
- Combustible y casetas = gasto #1 de una flota de carga.
- La liquidación manual: papel, semanas, errores, y el SAT exige el comprobante de cada litro.
- Hoy: un operador manda una foto por WhatsApp y la liquidación queda cerrada contra **cifras que el sistema respalda**, no contra lo que alguien escribió de memoria.

### Acto 2 — El demo vivo por WhatsApp (3 min, es el momento estrella)
- **Precondición (BLOQUEO #1):** el celular de Javier está whitelisted en el número de prueba de Meta. Sin eso, la foto no entra.
- Flujo: foto de gasolinazo → OCR → política de gastos → comprobante amarrado al anticipo.
- Frase para Cárdenas: *"Cada litro tiene comprobante. Si no lo tiene, el sistema lo marca 'por confirmar' — no lo adivina."*

### Acto 3 — El panel (3 min, para Cárdenas)
- Dashboard: liquidaciones cerradas, anticipos vs comprobado, excedentes.
- **Regla 2.9 RFA 2026 (el ahorro fiscal):** hasta 15% del combustible en efectivo sigue siendo deducible si el operador es "de cargo" y la flota declara la facilidad. Likida deriva la elegibilidad del régimen fiscal SAT (601/612) — no la decide un humano a ojo.
- Previsualización por rol: lo que ve el encargado, lo que ve el contador.

### Acto 4 — Confianza (3 min, para Celinda)
- **Seguridad real:** cada flota solo ve sus datos (RLS con pruebas automáticas, 56 bloques de verificación).
- **Cumplimiento ARCO / LFPDPPP:** pantalla de solicitudes con resolución y aviso al titular. *(Ojo: la plantilla de WhatsApp está en revisión en Meta — se presenta como "en proceso de aprobación", no como terminada.)*
- **Ingeniería:** 3,147 pruebas, 16 rondas de auditoría con subagentes, build automático, fail-closed (si algo no se puede verificar, el sistema dice "no pude verificar" — nunca inventa).

---

## 3. Los 3 bloqueos a resolver ANTES de mañana

1. **🔴 WHITELIST de WhatsApp (urgente, manual en Business Manager)**
   - Número de prueba: `+1 555-659-6430` · Celular de Javier: `529993700779`
   - Sin esto el demo vivo no responde. Si no se resuelve, el Acto 2 se cuenta con capturas en vez de en vivo — se avisa antes de empezar, no a mitad.

2. **🔴 Datos de demostración (decisión de honestidad)**
   - Los operadores del demo son "Juan Pérez Ramírez", etc. — nombres de fantasía.
   - Opción A (recomendada): abrir el demo diciendo *"estos son datos de demostración"* una sola vez, al inicio.
   - Opción B: si traen nombres reales de 2-3 operadores hoy, se cargan y el demo es 100% real.

3. **🟡 Régimen fiscal del tenant demo está VACÍO**
   - El RFC `GMX0902279I1` ya está cargado. Falta el régimen SAT (601/612) para que la facilidad del 15% se pinte "elegible".
   - Se resuelve en 1 minuto: preguntar a Innovativos su régimen y cargarlo.

---

## 4. Las 5 preguntas que van a hacer (y la respuesta honesta)

1. **"¿Dónde están nuestros datos?"** — En AWS us-east-2 (Supabase). Cada flota aislada por RLS; el chofer no ve los datos personales de otros ni escribe en tablas de negocio. Hay un mapa de quién puede tocar qué.
2. **"¿Cuánto cuesta?"** — El plan se configura por volumen (viajes/mes y operadores). Los precios están en la pantalla de suscripción — se muestran ahí, no se dicen de memoria.
3. **"¿Se integra con nuestro ERP?"** — Export de liquidaciones, CFDI en proceso (FacturAPI), cola de facturación vía QStash. La integración se hace contra las llaves que dé Innovativos.
4. **"¿Qué pasa si el sistema se cae?"** — Fail-closed: el motor se rehúsa a cerrar una liquidación con cifras que no puede respaldar; la facturación tiene cola con reintentos; nada se pierde en silencio.
5. **"¿Y si un operador no tiene WhatsApp?"** — La flota tiene su número de negocio; los operadores usan WhatsApp Web desde ese número sin instalar app.

## 5. Qué NO decir (la lista de lo que aún es verdad a medias)

- ❌ "La plantilla ARCO está aprobada" — está EN REVISIÓN en Meta (el código tiene respaldo, la plantilla no).
- ❌ "El régimen 601/612 ya está configurado" — está vacío en el demo.
- ❌ Cifras de ahorro "X% menos mermas" — no hay dato propio; se habla del problema y de cómo se ataca, no de números propios.
- ❌ "El whitelist está listo" — verificar antes del demo.
