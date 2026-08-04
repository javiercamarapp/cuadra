import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — EL `error.message` CRUDO DE POSTGRES ENTRABA SIN FILTRO
// AL CONTEXTO DEL MODELO.
//
// `executeTool` ponía `err.message` tal cual en `ToolExecResult.error` y
// `openrouter.ts` lo serializa en el `content` del mensaje `role:'tool'`. El
// ejemplo más directo es `guardar_liquidacion`, que llama `saveLiquidacion` sin
// try/catch propio: si el RPC `guardar_liquidacion_tx` devuelve error,
// `repo.ts` lanza `saveLiquidacion: ${error.message}` con el texto de Postgres
// —nombre de función plpgsql, constraint, columna— y eso entra al contexto del
// modelo en la tool que cierra el dinero.
//
// Consecuencia acotada y verificada: si `guardar_liquidacion` falla,
// `guardia.ts` calcula `cerro = false` y `cuadro = false`, así que el texto sólo
// se sustituye si el modelo narró cifras — un mensaje del tipo "se trabó por un
// problema con `liquidacion_viaje_id_key`" puede salir tal cual al chofer.
// Higiene, no dinero.
//
// La distinción que se fija aquí: un mensaje que ESCRIBIMOS NOSOTROS para el
// modelo ("sin viaje activo") viaja; el texto de una excepción de infraestructura
// no. Nadie pierde diagnóstico: el mensaje completo sigue yendo al log.
// ═══════════════════════════════════════════════════════════════════════════

const logError = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => logError(...a) } }));

const { registerTool, executeTool, ToolErrorVisible } = await import('./tool-executor');

const schema = (name: string): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name, parameters: { type: 'object', properties: {}, additionalProperties: false } },
});

const PG = 'saveLiquidacion: duplicate key value violates unique constraint "liquidacion_viaje_id_key" en la función guardar_liquidacion_tx(uuid,jsonb)';

registerTool('test_pg_falla', {
  isMutation: true, schema: schema('test_pg_falla'),
  handler: async () => { throw new Error(PG); },
});
registerTool('test_visible_falla', {
  schema: schema('test_visible_falla'),
  handler: async () => { throw new ToolErrorVisible('sin viaje activo'); },
});

describe('executeTool — lo que el modelo lee de un fallo', () => {
  it('el texto de Postgres NO viaja al contexto del modelo', async () => {
    const r = await executeTool('test_pg_falla', {}, { tenantId: 't' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).not.toContain('liquidacion_viaje_id_key');
    expect(r.error).not.toContain('guardar_liquidacion_tx');
    expect(r.error).not.toContain('unique constraint');
  });

  it('el diagnóstico completo sigue yendo al log, que es donde sirve', async () => {
    logError.mockClear();
    await executeTool('test_pg_falla', {}, { tenantId: 't' });
    expect(logError).toHaveBeenCalledWith('tool.error', expect.objectContaining({ name: 'test_pg_falla', err: PG }));
  });

  it('un mensaje escrito por nosotros para el modelo sí viaja', async () => {
    const r = await executeTool('test_visible_falla', {}, { tenantId: 't' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('sin viaje activo');
  });

  it('la tool desconocida sigue diciendo cuál (es nuestro texto, no de la base)', async () => {
    const r = await executeTool('no_existe', {}, { tenantId: 't' });
    expect(r.error).toContain('no_existe');
  });
});
