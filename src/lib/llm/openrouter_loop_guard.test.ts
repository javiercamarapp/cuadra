import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — EL LOOP-GUARD EJECUTABA LA ÚLTIMA RONDA ENTERA PARA
// TIRAR EL RESULTADO.
//
// El `for` corría las 6 rondas completas: las tools de la sexta se ejecutaban,
// se pagaban, se serializaban a `convo`… y entonces se lanzaba `LoopGuardError`,
// que se envuelve en `PartialExecutionError`. El conteo en sí era correcto; lo
// que se perdía era la oportunidad de usar la última ronda para CERRAR con lo
// que ya se tiene, en vez de correr a ciegas hasta el tope y salir por
// excepción.
//
// Ahora la última ronda se pide con `tool_choice: 'none'`: el modelo no puede
// pedir más herramientas y gasta ese turno en responder. Si aun así insiste con
// `tool_calls`, se conserva el `LoopGuardError` como respaldo — pero sin
// ejecutar ni pagar unas tools cuyo resultado nadie iba a leer.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const MODEL = 'google/gemini-3.5-flash-lite';
// `anotar_nota` a propósito: no matchea ningún prefijo de solo-lectura, así que
// la caché entre rondas no tapa lo que esta prueba mide (cuántas veces se
// EJECUTA de verdad).
const conTool = () => ({
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'anotar_nota', arguments: '{}' } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: MODEL,
});
const final = (texto: string) => ({
  choices: [{ message: { content: texto, tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: MODEL,
});

let ejecuciones = 0;
const correr = (maxToolRounds: number) => generateWithTools({
  role: 'chat', system: 's', messages: [{ role: 'user', content: 'ya' }],
  tools: [{ type: 'function', function: { name: 'anotar_nota', description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async () => { ejecuciones++; return { success: true, result: { ok: 1 }, durationMs: 1 }; },
  maxToolRounds,
});
const toolChoiceDe = (i: number) => (create.mock.calls[i][0] as { tool_choice?: string }).tool_choice;

describe('loop-guard — la última ronda se gasta en cerrar, no en pedir más tools', () => {
  beforeEach(() => { create.mockReset(); ejecuciones = 0; });

  it('la última ronda se pide sin permiso de llamar tools', async () => {
    create.mockResolvedValueOnce(conTool()).mockResolvedValueOnce(final('quedó así'));
    const r = await correr(2);
    expect(toolChoiceDe(0)).toBe('auto');
    expect(toolChoiceDe(1)).toBe('none');
    expect(r.finalText).toBe('quedó así');
    expect(ejecuciones).toBe(1);
  });

  it('si aun así insiste con tool_calls, no se ejecutan ni se pagan', async () => {
    create.mockResolvedValueOnce(conTool()).mockResolvedValueOnce(conTool());
    const err = await correr(2).catch((e) => e);
    expect(err.name).toBe('PartialExecutionError');
    expect(err.cause.name).toBe('LoopGuardError');
    // La primera ronda sí corrió; la de la última se descartaba DESPUÉS de
    // ejecutarla, pagarla y serializarla.
    expect(ejecuciones, 'se ejecutaron tools de una ronda que se iba a tirar').toBe(1);
  });

  it('un ciclo que termina antes no cambia: todas sus rondas piden tools', async () => {
    create.mockResolvedValueOnce(conTool()).mockResolvedValueOnce(final('listo'));
    const r = await correr(6);
    expect(toolChoiceDe(0)).toBe('auto');
    expect(toolChoiceDe(1)).toBe('auto');
    expect(r.finalText).toBe('listo');
  });
});
