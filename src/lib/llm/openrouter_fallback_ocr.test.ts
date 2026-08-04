import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO — EL FALLBACK DEL OCR, EL CAMINO FELIZ DEL DEMO, NO
// TENÍA NINGUNA PRUEBA Y ADEMÁS LLEGABA TARDE.
//
// Hay tres fallbacks cross-provider en el gateway y sólo uno estaba ejercitado
// (`generateWithTools`, en openrouter_fallback_costo.test.ts). `generateResponse`
// y `generateStructured` —el que usa `ocr.ts` con `role: 'ocr'`, el que salva la
// demo si Gemini se cae mientras el contralor mira la pantalla— no tenían
// ninguna: `openrouter_costo` y `openrouter_truncado` cubren truncado, JSON malo
// y presupuesto, y ninguno llega a `attempt(fallback, note)`.
//
// Y en ese camino el orden estaba mal. `generateResponse` cae al fallback
// inmediatamente; `generateStructured` no: tras el fallo transitorio ejecutaba
// `attempt(model, note)` —una segunda llamada COMPLETA al MISMO proveedor caído,
// con la imagen del ticket adjunta— y sólo si ésa también fallaba miraba el
// fallback.
//
// Con valores: `getClient()` no fija `maxRetries`, así que hereda el default 2
// del SDK de OpenAI y cada `attempt()` son hasta 3 peticiones con backoff
// (~0.5s + ~1s). Intento 1 ≈ 2.2s, intento 2 contra el proveedor muerto ≈ 2.2s,
// y recién entonces se prueba `anthropic/claude-haiku-4.5`: ~4.4s tirados por
// foto, dentro de una invocación de 60s que ya reserva 12s para el cierre. En la
// sala eso es "no pude leer tu ticket" por un parpadeo que el diseño prometía
// tapar.
//
// La escalera estaba ordenada por TIPO DE FALLO (formato → proveedor) y no por
// COSTO DEL REINTENTO. Un 503 no se arregla repitiéndole la petición al que lo
// devolvió.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, generateResponse } = await import('./openrouter');
const { modelFor } = await import('./models');

const OCR = modelFor('ocr');              // google/gemini-3.6-flash
const OCR_FALL = 'anthropic/claude-haiku-4.5';
const CHAT = modelFor('chat');            // google/gemini-3.5-flash-lite
const CHAT_FALL = 'openai/gpt-5.6-luna';

const schema = z.object({ monto: z.number() });
const R = (model: string, content: string) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 1200, completion_tokens: 300 }, model,
});
const caido = () => new Error('503 Service Unavailable: provider caído');

const extraer = () => generateStructured({
  role: 'ocr', system: 's', messages: [{ role: 'user', content: 'Extrae los datos de este comprobante.' }],
  images: ['data:image/jpeg;base64,AAAA'], schema, schemaName: 'comprobante',
});
/** El slug pedido en cada llamada al SDK, en orden. */
const modelosPedidos = () => create.mock.calls.map((c) => (c[0] as { model: string }).model);

describe('generateStructured — el fallback del OCR corre, y corre a tiempo', () => {
  beforeEach(() => { create.mockReset(); });

  it('con el proveedor caído, la SEGUNDA llamada ya es del otro proveedor', async () => {
    create
      .mockRejectedValueOnce(caido())
      .mockResolvedValueOnce(R(OCR_FALL, '{"monto":507.65}'));
    const r = await extraer();
    expect(r.data.monto).toBe(507.65);
    // Antes: [OCR, OCR, OCR_FALL] — una llamada de visión completa contra el
    // proveedor muerto, con la imagen adjunta, antes de probar el que sirve.
    expect(modelosPedidos()).toEqual([OCR, OCR_FALL]);
  });

  it('el fallback conserva la imagen y el schema: es la MISMA petición, otro proveedor', async () => {
    create
      .mockRejectedValueOnce(caido())
      .mockResolvedValueOnce(R(OCR_FALL, '{"monto":100}'));
    await extraer();
    const body = create.mock.calls[1][0] as { model: string; messages: { role: string; content: unknown }[]; response_format?: unknown };
    expect(body.model).toBe(OCR_FALL);
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,AAAA');
    expect(body.response_format).toBeDefined();
  });

  it('si el fallback también se cae, el error sale con el consumo de lo que se pagó', async () => {
    create.mockRejectedValue(caido());
    const err = await extraer().catch((e) => e);
    expect(err.name).toBe('StructuredError');
    expect(modelosPedidos()).toEqual([OCR, OCR_FALL]);
  });

  it('un JSON malo SÍ merece el reintento con nota en el mismo modelo (no es el proveedor)', async () => {
    // La escalera de formato no cambia: repetirle a un proveedor SANO con la
    // instrucción de responder sólo JSON es exactamente lo que hay que hacer.
    create
      .mockResolvedValueOnce(R(OCR, 'aquí va tu respuesta: no-json'))
      .mockResolvedValueOnce(R(OCR, '{"monto":42}'));
    const r = await extraer();
    expect(r.data.monto).toBe(42);
    expect(modelosPedidos()).toEqual([OCR, OCR]);
    expect((create.mock.calls[1][0] as { messages: { content: string }[] }).messages[0].content)
      .toContain('EXCLUSIVAMENTE con JSON válido');
  });

  it('formato malo dos veces sí acaba en el otro proveedor', async () => {
    create
      .mockResolvedValueOnce(R(OCR, 'no-json'))
      .mockResolvedValueOnce(R(OCR, 'tampoco'))
      .mockResolvedValueOnce(R(OCR_FALL, '{"monto":7}'));
    // El fallback de formato sólo se dispara si alguno de los dos fallos era
    // transitorio; con dos JSON malos seguidos, no lo es y se rinde.
    const err = await extraer().catch((e) => e);
    expect(err.name).toBe('StructuredError');
    expect(modelosPedidos()).toEqual([OCR, OCR]);
  });
});

describe('generateResponse — su fallback tampoco tenía prueba', () => {
  beforeEach(() => { create.mockReset(); });

  it('cae al otro proveedor a la primera y devuelve su texto', async () => {
    create
      .mockRejectedValueOnce(caido())
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ya quedó' } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: CHAT_FALL });
    const r = await generateResponse({ role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(r.text).toBe('ya quedó');
    expect(r.model).toBe(CHAT_FALL);
    expect(modelosPedidos()).toEqual([CHAT, CHAT_FALL]);
  });

  it('un error NO transitorio no gasta una segunda llamada', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(generateResponse({ role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
