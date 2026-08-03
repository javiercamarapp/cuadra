import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO — LA ATRIBUCIÓN MODELO↔TOKENS TRAS EL FALLBACK.
//
// El gateway devuelve UN slug de modelo y UN acumulado de tokens, pero el
// acumulado puede ser de N llamadas a M proveedores distintos. Los tres caminos
// con fallback mienten, cada uno a su manera:
//
//   · `generateStructured`, éxito: `model` = el ÚLTIMO que respondió, con el
//     consumo de TODOS los intentos (incluidos los del primario caído).
//   · `generateStructured`, error: `model` = el PRIMARIO, con el consumo
//     acumulado que ya incluye el del fallback. El error opuesto.
//   · `generateWithTools`: `used` = el modelo de la ÚLTIMA ronda, con los tokens
//     de todas.
//   · `PartialExecutionError` no llevaba modelo NINGUNO, y por eso el processor
//     escribe literalmente `modelo: 'parcial'` en `llm_costo` — una fila con un
//     "modelo" que ningún proveedor facturó nunca.
//
// Hasta la ronda 9 la atenuante era "hoy no la lee nadie". Ya no: `llm_costo`
// se pinta agrupado por `modelo` en siete pantallas de /admin, y es el panel con
// el que se va a fijar el precio por liquidación.
//
// El arreglo que vive en este módulo: el gateway deja de fingir que el consumo
// es de un solo modelo y emite el desglose REAL, `porModelo`, con la suma
// invariante `Σ porModelo == total`. Quien escribe la fila decide cuántas filas
// escribe; lo que ya no puede es inventarse la etiqueta.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, generateWithTools, calcCost } = await import('./openrouter');
const { modelFor } = await import('./models');

// Del registro real: fijar los slugs a mano dejaría de probar el camino vivo.
const OCR = modelFor('ocr');              // google/gemini-3.6-flash
const OCR_FALL = 'anthropic/claude-haiku-4.5';
const CHAT = modelFor('chat');            // google/gemini-3.5-flash-lite
const CHAT_FALL = 'openai/gpt-5.6-luna';

const schema = z.object({ monto: z.number() });
const R = (model: string, content: string, tokIn: number, tokOut: number) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut },
  model,
});
// `isTransientError` mira el mensaje: un 503 dispara el fallback cross-provider.
const caido = () => new Error('503 Service Unavailable: provider caído');

const extraer = () => generateStructured({
  role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }], schema, schemaName: 'x',
});

describe('generateStructured — el consumo se atribuye al modelo que lo gastó', () => {
  beforeEach(() => { create.mockReset(); });

  it('éxito tras fallback: el desglose separa lo de Google de lo de Anthropic', async () => {
    create
      .mockResolvedValueOnce(R(OCR, 'esto no es json', 1200, 300))   // primario: se pagó y no sirvió
      .mockRejectedValueOnce(caido())                                 // reintento con nota: 503
      .mockResolvedValueOnce(R(OCR_FALL, '{"monto":507.65}', 1200, 300)); // fallback: resuelve
    const r = await extraer();

    // Lo que se devolvía: model = haiku con tokensIn = 2400. 1200 fueron de Google.
    expect(r.tokensIn).toBe(2400);
    expect(r.porModelo).toEqual([
      { model: OCR, tokensIn: 1200, tokensOut: 300, cost: calcCost(OCR, 1200, 300) },
      { model: OCR_FALL, tokensIn: 1200, tokensOut: 300, cost: calcCost(OCR_FALL, 1200, 300) },
    ]);
    // Invariante: el desglose suma exactamente el total que se reporta.
    expect(r.porModelo.reduce((s, u) => s + u.tokensIn, 0)).toBe(r.tokensIn);
    expect(r.porModelo.reduce((s, u) => s + u.tokensOut, 0)).toBe(r.tokensOut);
    expect(r.porModelo.reduce((s, u) => s + u.cost, 0)).toBeCloseTo(r.cost, 12);
  });

  it('un solo modelo: el desglose es una sola entrada y suma el total', async () => {
    create
      .mockResolvedValueOnce(R(OCR, 'no-json', 100, 40))
      .mockResolvedValueOnce(R(OCR, '{"monto":42}', 120, 50));
    const r = await extraer();
    expect(r.porModelo).toEqual([
      { model: OCR, tokensIn: 220, tokensOut: 90, cost: calcCost(OCR, 100, 40) + calcCost(OCR, 120, 50) },
    ]);
  });

  it('error tras fallback: la etiqueta deja de decir "primario" y viaja el desglose', async () => {
    create
      .mockResolvedValueOnce(R(OCR, 'no-json', 1200, 300))
      .mockRejectedValueOnce(caido())
      .mockResolvedValueOnce(R(OCR_FALL, 'tampoco es json', 1200, 300));
    const err = await extraer().catch((e) => e);
    const u = (err as { usage?: { model: string; tokensIn: number; porModelo?: unknown } }).usage;
    expect(u).toBeDefined();
    // Escribía `model: OCR` (el primario) con el consumo que YA incluía el del
    // fallback: la mitad de esos tokens los facturó Anthropic.
    expect(u!.model, 'la etiqueta debe ser el modelo que respondió de verdad').toBe(OCR_FALL);
    expect(u!.tokensIn).toBe(2400);
    expect(u!.porModelo).toEqual([
      { model: OCR, tokensIn: 1200, tokensOut: 300, cost: calcCost(OCR, 1200, 300) },
      { model: OCR_FALL, tokensIn: 1200, tokensOut: 300, cost: calcCost(OCR_FALL, 1200, 300) },
    ]);
  });
});

// ── generateWithTools ───────────────────────────────────────────────────────
const conTool = (model: string, tokIn: number, tokOut: number) => ({
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut }, model,
});
const final = (model: string, tokIn: number, tokOut: number) => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut }, model,
});
const correr = () => generateWithTools({
  role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }],
  tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async () => ({ success: true, result: { ok: 1 }, durationMs: 1 }),
});

describe('generateWithTools — cada ronda se atribuye a quien la respondió', () => {
  beforeEach(() => { create.mockReset(); });

  it('ronda en primario + ronda en fallback: el desglose las separa', async () => {
    create
      .mockResolvedValueOnce(conTool(CHAT, 100, 20))
      .mockRejectedValueOnce(caido())
      .mockResolvedValueOnce(final(CHAT_FALL, 150, 30));
    const r = await correr();
    // El importe ya sumaba bien; lo que mentía era la etiqueta: `model` = el de
    // la última ronda, con los 250 tokens de las dos.
    expect(r.tokensIn).toBe(250);
    expect(r.porModelo).toEqual([
      { model: CHAT, tokensIn: 100, tokensOut: 20, cost: calcCost(CHAT, 100, 20) },
      { model: CHAT_FALL, tokensIn: 150, tokensOut: 30, cost: calcCost(CHAT_FALL, 150, 30) },
    ]);
    expect(r.porModelo.reduce((s, u) => s + u.cost, 0)).toBeCloseTo(r.cost, 12);
  });

  it('PartialExecutionError lleva el modelo y el desglose de lo que ya se pagó', async () => {
    create
      .mockResolvedValueOnce(conTool(CHAT, 100, 20))            // ronda 1: se pagó
      .mockRejectedValueOnce(new Error('boom irrecuperable'));  // ronda 2: revienta
    const err = await correr().catch((e) => e);
    expect(err.name).toBe('PartialExecutionError');
    // Sin esto el processor no tiene con qué etiquetar la fila y escribe
    // `modelo: 'parcial'`, que no es un modelo de ningún proveedor.
    expect(err.model).toBe(CHAT);
    expect(err.porModelo).toEqual([
      { model: CHAT, tokensIn: 100, tokensOut: 20, cost: calcCost(CHAT, 100, 20) },
    ]);
  });
});
