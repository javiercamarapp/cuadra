// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE TOOLS — cada tool se registra al importarse (registerTool).
// executeTool mide tiempo, captura excepciones (nunca tumba el loop) y aplica
// scoping por tenant vía ToolContext. Las mutaciones llevan idempotencia.
// ═══════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import { logger } from '@/lib/logger';
import type { ToolExecResult } from './openrouter';

/** Contexto inyectado a cada handler: IDs scoped para no pedírselos al LLM. */
export interface ToolContext {
  tenantId: string;
  operadorId?: string;
  viajeId?: string;
  conversationId?: string;
  telefono?: string;
  signal?: AbortSignal;
}

export interface RegisteredTool {
  schema: OpenAI.Chat.ChatCompletionTool;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  isMutation?: boolean;
  /**
   * Qué parte del resultado ve el MODELO (el resto sigue yendo al llamador).
   *
   * Existe porque un solo `result` servía a dos consumidores con necesidades
   * opuestas: la guardia de cifras reusa el snapshot completo del cierre y el
   * modelo usa cinco campos. Sin separación, los 15.6 KB del snapshot —RFC,
   * UUID y rutas de foto de cada comprobante— se serializaban en el mensaje
   * `role:'tool'` y se pagaban en cada ronda posterior.
   *
   * Si no se declara, el modelo ve el resultado tal cual.
   */
  paraModelo?: (result: unknown) => unknown;
}

const REGISTRY = new Map<string, RegisteredTool>();

export function registerTool(name: string, tool: RegisteredTool): void {
  if (REGISTRY.has(name)) logger.warn('tool.reregister', { name });
  REGISTRY.set(name, tool);
}

/**
 * Devuelve los schemas (ChatCompletionTool) para los nombres dados.
 *
 * FALLA RUIDOSO. Antes resolvía por la llave y descartaba en silencio lo que no
 * encontraba, y ése era el único punto donde la superficie de tools completa
 * podía desaparecer sin poner una prueba en rojo: renombrar `registerTool` y
 * olvidar `registry.ts` devolvía 2 esquemas en vez de 3 —el modelo nunca ve
 * `cuadrar_viaje`, `guardiaCifras` calcula `cuadro = false` y el viaje NO
 * CIERRA—, y perder el import que puebla el registro devolvía `[]`, con el
 * agente narrando sin números en cada turno. Las dos cosas son errores de
 * cableado: se ven al arrancar, no a mitad de un cierre.
 */
export function toolSchemas(names: string[]): OpenAI.Chat.ChatCompletionTool[] {
  const faltan = names.filter((n) => !REGISTRY.has(n));
  if (faltan.length) {
    throw new Error(
      `tools no registradas: ${faltan.join(', ')} (registradas: ${[...REGISTRY.keys()].join(', ') || 'ninguna'})`,
    );
  }
  return names.map((n) => REGISTRY.get(n)!.schema);
}

/** Ejecuta una tool por nombre con timing + captura de errores. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecResult> {
  const started = Date.now();
  const tool = REGISTRY.get(name);
  if (!tool) {
    return { success: false, result: null, error: `tool desconocida: ${name}`, durationMs: 0 };
  }
  try {
    const result = await tool.handler(args, ctx);
    return {
      success: true,
      result,
      ...(tool.paraModelo ? { paraModelo: tool.paraModelo(result) } : {}),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    logger.error('tool.error', { name, err: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Fabrica un ToolExecutor cerrado sobre un ToolContext (para generateWithTools).
 * IDEMPOTENCIA DE MUTACIONES: una tool marcada `isMutation` no se re-ejecuta si el
 * agente la llama otra vez en el MISMO run — se devuelve el resultado cacheado.
 * Evita, p. ej., un doble guardar_liquidacion (doble PDF/costo). Solo se cachea el
 * éxito (un fallo sí puede reintentarse). El backstop de dinero sigue siendo la
 * DB (unique(viaje_id) + upsert), pero es un backstop: esta rejilla es la que
 * evita el trabajo, no solo la fila duplicada.
 */
export function makeExecutor(ctx: ToolContext) {
  // SE CACHEA LA PROMESA, NO EL RESULTADO — y por eso el tipo es Promise<…>.
  //
  // Con `ToolExecResult` la secuencia era `get` … `await` … `set`: una ventana
  // de check-then-act tan ancha como el handler. `generateWithTools` lanza TODAS
  // las tool_calls de una ronda con `Promise.all` (openrouter.ts), así que dos
  // invocaciones concurrentes pasaban las dos por el `if` con la caché vacía, el
  // handler corría dos veces y `tool.mutation_dedup` NO se disparaba: en el log
  // parecía que la rejilla había funcionado.
  //
  // Medido sobre `guardar_liquidacion`: 2 cuadres completos, 4 PDFs, 4 subidas a
  // Storage sobre las mismas dos rutas y 2 RPC de escritura. La otra rejilla
  // (`inRound`, en openrouter.ts) no lo tapaba: se llavea con
  // `nombre:JSON.stringify(args)` y basta un `{"confirmar":true}` para esquivarla
  // — nada obliga a que `arguments` sea `{}`, los schemas de tools no llevan
  // `strict: true`.
  //
  // Registrando la promesa ANTES del await, el segundo llamador se engancha a la
  // MISMA ejecución. No hay ventana: entre el `get` y el `set` no hay await.
  const mutacionesHechas = new Map<string, Promise<ToolExecResult>>();
  return async (name: string, args: Record<string, unknown>): Promise<ToolExecResult> => {
    if (REGISTRY.get(name)?.isMutation) {
      // LA LLAVE ES EL NOMBRE, no los args. Ninguna tool de Likida tiene
      // parámetros a propósito —el modelo decide CUÁNDO, nunca CON QUÉ DATOS, y
      // el efecto sale de ctx.tenantId/ctx.viajeId—, así que meter `args` en la
      // llave describía la llamada y no el efecto: un byte de diferencia, o las
      // mismas claves en otro orden, y la mutación corría dos veces. Si algún día
      // una tool sí decide sobre datos, esta llave tiene que volver a incluirlos
      // — y ese día habrá que revisar la regla de `properties: {}` antes que esta
      // línea.
      const key = name;
      const cache = mutacionesHechas.get(key);
      if (cache) { logger.warn('tool.mutation_dedup', { name }); return cache; }
      // `executeTool` nunca rechaza (captura y devuelve `success:false`), así que
      // esta promesa no puede quedar como rejection sin manejar.
      const p = executeTool(name, args, ctx);
      mutacionesHechas.set(key, p);
      const res = await p;
      // Un FALLO no se queda cacheado: un blip de un segundo no puede convertirse
      // en un fallo permanente del turno. Se compara la promesa antes de borrar
      // para no tirar el reintento de otro llamador que ya ocupó la llave.
      if (!res.success && mutacionesHechas.get(key) === p) mutacionesHechas.delete(key);
      return res;
    }
    return executeTool(name, args, ctx);
  };
}
