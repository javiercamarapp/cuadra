// ═══════════════════════════════════════════════════════════════════════════
// Ruteo de modelos por rol (arquitectura híbrida, fundamentada en benchmarks).
//
// Regla: calidad de frontera DONDE un error cuesta dinero (el cuadre), y
// modelos baratos/rápidos donde no (chat, router, OCR de lectura). Todo es
// override-able por env porque los modelos rotan rápido (2026). Los defaults
// son slugs de OpenRouter; se pueden apuntar a proveedor directo.
//
// Fundamento (2 investigaciones independientes convergen — jul-2026):
//   OCR      → Gemini Flash: #1 calidad en recibos ruidosos ES + el más barato.
//              El OCR y el JSON se FUSIONAN en una llamada (generateStructured
//              con images + response_format) → elimina un paso y su costo.
//   Cuadre   → Claude Sonnet: élite en tool-use multi-turno bajo política
//              (τ²-bench), a 1/3 del precio de Opus.
//   Chat     → Gemini Flash-Lite: mejor español barato + baja latencia.
//   Router   → Gemini Flash-Lite / clasificación de una línea, centavos.
//
// ── CUÁNTO CUESTA UNA LIQUIDACIÓN: LO QUE SE SABE Y LO QUE NO ──────────────
//
// Aquí decía «Costo ≈ $0.03–0.05 / liquidación», a secas y sin fuente. La
// aritmética con las constantes del propio repo lo contradice por 2.4×
// ANTES de que el agente gaste un token (auditoría 11 · G-42):
//
//   8 fotos (el lote que `api/webhook/whatsapp/route.ts:68` dimensiona)
//   × ~$0.015 por llamada de visión (`processor.ts:863`)  =  $0.12
//
// Y eso es solo el OCR: falta el cuadre (Sonnet, hasta 6 rondas de tools con
// `DEFAULT_MAX_TOKENS = 4000`), el router y el chat. El peor caso sumado
// ronda los $0.49, o sea 10-16× el número que estaba escrito.
//
// El rango de arriba no se borra porque sí ni se sustituye por otro
// inventado: se marca por lo que es —una ASPIRACIÓN de diseño, no una
// medición— y se dice dónde está el dato para cerrarlo. Likida YA lo está
// guardando: `llm_costo.costo_usd` con `viaje_id` y `liquidacion_id`
// (`costos.ts`), y `/admin/model-ops` lo enseña por fase y modelo desde la
// auditoría 11. Nadie ha hecho la división.
//
//   Objetivo declarado (no medido): $0.03–0.05 / liquidación.
//   Cota inferior calculada hoy con las constantes del repo: ~$0.12.
//   Medición real: PENDIENTE — sale de `llm_costo`, no de este comentario.
//
// Mientras la división no se haga, este archivo NO afirma un costo unitario.
//
// ⚖️ SOBERANÍA DE DATOS FISCALES (LFPDPPP, DOF 20-mar-2025): RFC y CFDI son
//   datos personales. Todo lo que lleve RFC/CFDI va SOLO a proveedores US/EU
//   con Zero Data Retention. El gateway fuerza ZDR con `data_collection:'deny'`
//   en cada llamada. NUNCA usar APIs chinas directas (DeepSeek/Qwen/Kimi); si
//   se usan sus pesos, solo vía host occidental. Fallbacks aquí son US.
//
// 🔌 PLAN B DEMO: OpenRouter es punto único de falla (caídas ago-2025, feb-2026).
//   Para el demo en vivo, tener keys directas de Google/Anthropic como respaldo.
// ═══════════════════════════════════════════════════════════════════════════

// AUDITORÍA 10, BAJO: aquí estaba declarado `cuadre_fallback` —con su default
// Opus, su variable de entorno, sus `ROLE_PARAMS` y su comentario de "escalación
// por baja confianza / monto alto / caso ambiguo"— y `grep -rn "cuadre_fallback"
// src` devolvía SÓLO esas cuatro líneas: ningún camino lo seleccionaba. Quien
// leyera este archivo para saber qué corre en producción estaba leyendo una
// promesa. Cuando la escalación se implemente, el rol vuelve CON su llamador.
// (`models.test.ts` fija el inventario.)
export type ModelRole = 'ocr' | 'cuadre' | 'chat' | 'router';

const DEFAULTS: Record<ModelRole, string> = {
  // OCR de comprobantes (visión). Gemini 3.6 Flash (21-jul-2026): #1 OCR Arena
  // en recibos ruidosos ES; visión + JSON en una sola llamada.
  ocr: 'google/gemini-3.6-flash',
  // Cerebro de conciliación. Sonnet 5 (30-jun-2026): mejor que 4.5 en todo, con
  // precio intro $2/$10 hasta 31-ago — justo la ventana del demo.
  cuadre: 'anthropic/claude-sonnet-5',
  // Chat de alto volumen con el operador (español MX, latencia baja).
  chat: 'google/gemini-3.5-flash-lite',
  // Clasificador de intención por mensaje entrante.
  router: 'google/gemini-3.5-flash-lite',
};

const ENV_KEY: Record<ModelRole, string> = {
  ocr: 'CUADRA_MODEL_OCR',
  cuadre: 'CUADRA_MODEL_CUADRE',
  chat: 'CUADRA_MODEL_CHAT',
  router: 'CUADRA_MODEL_ROUTER',
};

/** Devuelve el slug del modelo para un rol, respetando override por env. */
export function modelFor(role: ModelRole): string {
  return process.env[ENV_KEY[role]] || DEFAULTS[role];
}

/** Parámetros por defecto por rol (esfuerzo de razonamiento, temperatura). */
export const ROLE_PARAMS: Record<ModelRole, { temperature: number; reasoning?: 'low' | 'medium' | 'high' }> = {
  ocr: { temperature: 0 },                    // extracción determinística
  cuadre: { temperature: 0, reasoning: 'high' }, // razonamiento profundo donde importa
  chat: { temperature: 0.4 },                 // tono natural
  router: { temperature: 0 },
};
