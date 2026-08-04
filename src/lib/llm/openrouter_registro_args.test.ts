import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — `ToolCallRecord.args` NO DESCRIBÍA QUÉ PRODUJO EL
// `result`.
//
// Cuando la caché acierta —entre rondas o dentro de la misma—, el registro se
// escribía con el `args` de ESTE llamador y el `result` de OTRO. Nada obliga a
// que `arguments` sea `{}` (los schemas de tools no llevan `strict: true`), así
// que el modelo varía el JSON entre llamadas: `{}`, `{"viaje_id":"v1"}`,
// `{"incluir_periodo":true}` — y las tres se sirven del mismo resultado, que es
// correcto (la llave colapsa por nombre porque el handler recibe `_args` y no lo
// lee) pero deja un registro que afirma una relación que no ocurrió.
//
// Hoy la consecuencia es cero —nadie persiste ni consulta `.args`— y por eso es
// BAJO. Se arregla ahora porque el día que una tool lleve parámetros de verdad,
// este registro es la única traza de qué se ejecutó con qué.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const MODEL = 'google/gemini-3.5-flash-lite';
const llamadas = (args: string[]) => ({
  choices: [{ message: { content: null, tool_calls: args.map((a, i) => ({ id: `c${i}`, type: 'function', function: { name: 'cuadrar_viaje', arguments: a } })) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: MODEL,
});
const final = () => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: MODEL,
});

const correr = () => generateWithTools({
  role: 'chat', system: 's', messages: [{ role: 'user', content: 'cómo voy, y ciérralo si está bien' }],
  tools: [{ type: 'function', function: { name: 'cuadrar_viaje', description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async (_n, args) => ({ success: true, result: { visto: args }, durationMs: 1 }),
});

describe('ToolCallRecord — el `args` describe lo que produjo el `result`', () => {
  beforeEach(() => { create.mockReset(); });

  it('dentro de la misma ronda: el segundo registro lleva el args del que sí corrió', async () => {
    create.mockResolvedValueOnce(llamadas(['{}', '{"viaje_id":"v1"}'])).mockResolvedValueOnce(final());
    const r = await correr();
    expect(r.toolCalls).toHaveLength(2);
    // El handler corrió UNA vez, con `{}`: los dos registros comparten resultado.
    expect(r.toolCalls[0].result).toEqual({ visto: {} });
    expect(r.toolCalls[1].result).toEqual({ visto: {} });
    // …así que los dos tienen que decir que fue `{}` lo que lo produjo.
    expect(r.toolCalls[1].args, 'el args no describe el result').toEqual({});
    expect(r.toolCalls[1].desdeCache, 'un acierto de caché no es una ejecución').toBe(true);
    expect(r.toolCalls[0].desdeCache).toBeUndefined();
  });

  it('entre rondas: lo mismo con el acierto de la caché de lectura', async () => {
    create
      .mockResolvedValueOnce(llamadas(['{}']))
      .mockResolvedValueOnce(llamadas(['{"incluir_periodo":true}']))
      .mockResolvedValueOnce(final());
    const r = await correr();
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[1].result).toEqual({ visto: {} });
    expect(r.toolCalls[1].args).toEqual({});
    expect(r.toolCalls[1].desdeCache).toBe(true);
  });

  it('sin caché de por medio, el args sigue siendo el del llamador', async () => {
    create.mockResolvedValueOnce(llamadas(['{"viaje_id":"v1"}'])).mockResolvedValueOnce(final());
    const r = await correr();
    expect(r.toolCalls[0].args).toEqual({ viaje_id: 'v1' });
    expect(r.toolCalls[0].result).toEqual({ visto: { viaje_id: 'v1' } });
  });
});
