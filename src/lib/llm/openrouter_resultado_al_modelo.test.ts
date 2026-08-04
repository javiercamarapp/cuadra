import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolExecResult } from './openrouter';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO — UN SOLO `result` SERVÍA A DOS CONSUMIDORES CON
// NECESIDADES OPUESTAS.
//
// El resultado de una tool viaja por un canal único: `ToolExecResult.result` se
// devuelve al llamador (la guardia de cifras REUSA el snapshot del cierre para
// no recalcular y narrar dos cuadres distintos del mismo cierre) y ADEMÁS se
// serializa entero como `content` del mensaje `role:'tool'` que el modelo lee.
//
// La guardia necesita todo; el modelo casi nada. Con 12 comprobantes reales el
// snapshot de `guardar_liquidacion` mide 15,649 bytes (~4,000 tokens) y lo que
// el modelo usa son 132: el resto son RFC de emisor y receptor, UUID de CFDI y
// rutas de foto que se pagan en cada ronda posterior al cierre y salen al
// proveedor sin que nadie los lea.
//
// Se separa el canal: una tool puede declarar QUÉ parte de su resultado ve el
// modelo. Lo que vuelve al llamador no cambia.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const GORDO = { liquidacion_id: 'liq-1', liq: { gastos: Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, rfcEmisor: 'AAA010101AAA', cfdiUuid: '11111111-2222-3333-4444-555555555555', imagenUrl: `t1/v1/foto-${i}.jpg` })) } };
const FLACO = { liquidacion_id: 'liq-1', estatus: 'cuadrada' };

const conTool = (nombre: string) => ({
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: nombre, arguments: '{}' } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'google/gemini-3.5-flash-lite',
});
const final = () => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'google/gemini-3.5-flash-lite',
});

const correr = (nombre: string, exec: ToolExecResult) => generateWithTools({
  role: 'chat', system: 's', messages: [{ role: 'user', content: 'ya' }],
  tools: [{ type: 'function', function: { name: nombre, description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async () => exec,
});

/** El `content` del mensaje `role:'tool'` de la 2ª llamada = lo que el modelo lee. */
const loQueVioElModelo = () => {
  const msgs = create.mock.calls[1][0].messages as { role: string; content?: string }[];
  return msgs.filter((m) => m.role === 'tool').map((m) => m.content ?? '');
};

describe('generateWithTools — el modelo ve lo que la tool declara para él', () => {
  beforeEach(() => { create.mockReset(); });

  it('con `paraModelo`, el prompt lleva el resumen y no el snapshot entero', async () => {
    create.mockResolvedValueOnce(conTool('guardar_liquidacion')).mockResolvedValueOnce(final());
    await correr('guardar_liquidacion', { success: true, result: GORDO, paraModelo: FLACO, durationMs: 1 });
    const vistos = loQueVioElModelo();
    expect(vistos).toEqual([JSON.stringify(FLACO)]);
    expect(vistos[0]).not.toContain('AAA010101AAA');
    expect(vistos[0]).not.toContain('imagenUrl');
  });

  it('el llamador SIGUE recibiendo el resultado completo (la guardia reusa el snapshot)', async () => {
    create.mockResolvedValueOnce(conTool('guardar_liquidacion')).mockResolvedValueOnce(final());
    const r = await correr('guardar_liquidacion', { success: true, result: GORDO, paraModelo: FLACO, durationMs: 1 });
    expect(r.toolCalls[0].result).toEqual(GORDO);
  });

  it('sin `paraModelo` no cambia nada: el modelo ve el resultado tal cual', async () => {
    create.mockResolvedValueOnce(conTool('cuadrar_viaje')).mockResolvedValueOnce(final());
    await correr('cuadrar_viaje', { success: true, result: { diferencia: 0 }, durationMs: 1 });
    expect(loQueVioElModelo()).toEqual([JSON.stringify({ diferencia: 0 })]);
  });

  it('el acierto de caché entre rondas sirve el MISMO resumen, no el snapshot', async () => {
    create
      .mockResolvedValueOnce(conTool('consultar_politica'))
      .mockResolvedValueOnce(conTool('consultar_politica'))
      .mockResolvedValueOnce(final());
    await correr('consultar_politica', { success: true, result: GORDO, paraModelo: FLACO, durationMs: 1 });
    const msgs = create.mock.calls[2][0].messages as { role: string; content?: string }[];
    const vistos = msgs.filter((m) => m.role === 'tool').map((m) => m.content ?? '');
    expect(vistos).toEqual([JSON.stringify(FLACO), JSON.stringify(FLACO)]);
  });
});
