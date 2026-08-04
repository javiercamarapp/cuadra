import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — EL SUFIJO DE PROVEEDOR PARTÍA LA FILA DE COSTO EN DOS.
//
// `calcCost` documenta que "OpenRouter a veces devuelve el slug con sufijo de
// proveedor (`:nitro`, `:floor`)" y lo normaliza PARA EL PRECIO
// (`model.split(':')[0]`). El slug que se GUARDA no pasaba por esa
// normalización: `generateResponse`, `generateStructured` y `generateWithTools`
// conservaban `res.model` tal cual, y ése es el que llega a `llm_costo.modelo`.
//
// Escenario: dos liquidaciones idénticas, una respondida como
// `anthropic/claude-sonnet-5` y otra como `anthropic/claude-sonnet-5:floor`.
// Model Ops enseña DOS renglones para el mismo modelo, y `getCostoPorFaseModelo`
// (llave `fase::modelo`) hace lo mismo dentro de la fase. El importe total no
// cambia; el desglose por modelo sí.
//
// El archivo ya sabía que el sufijo existe: lo manejaba para el precio, no para
// la identidad.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, generateResponse, generateWithTools } = await import('./openrouter');
const { modelFor } = await import('./models');

const OCR = modelFor('ocr');
const CHAT = modelFor('chat');
const schema = z.object({ monto: z.number() });

describe('el slug que se contabiliza no lleva sufijo de proveedor', () => {
  beforeEach(() => { create.mockReset(); });

  it('generateStructured devuelve el slug limpio', async () => {
    create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: '{"monto":1}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 }, model: `${OCR}:floor`,
    });
    const r = await generateStructured({ role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }], schema, schemaName: 'x' });
    expect(r.model).toBe(OCR);
    expect(r.porModelo.map((u) => u.model)).toEqual([OCR]);
  });

  it('generateResponse también', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'listo' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }, model: `${CHAT}:nitro`,
    });
    const r = await generateResponse({ role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(r.model).toBe(CHAT);
  });

  it('generateWithTools: dos rondas del MISMO modelo con y sin sufijo son UNA fila', async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 }, model: CHAT,
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'listo', tool_calls: [] } }],
        usage: { prompt_tokens: 150, completion_tokens: 30 }, model: `${CHAT}:floor`,
      });
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }],
      toolExecutor: async () => ({ success: true, result: { ok: 1 }, durationMs: 1 }),
    });
    expect(r.model).toBe(CHAT);
    // Dos renglones para el mismo modelo era exactamente el defecto.
    expect(r.porModelo).toHaveLength(1);
    expect(r.porModelo[0]).toMatchObject({ model: CHAT, tokensIn: 250, tokensOut: 50 });
  });
});
