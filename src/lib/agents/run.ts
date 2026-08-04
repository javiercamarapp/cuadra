// Runner: corre un agente = carga su config + tools + prompt y ejecuta el
// ciclo de tool-calling con el contexto del tenant/operador.

import type OpenAI from 'openai';
import { generateWithTools, type ToolCallRecord, type UsoPorModelo } from '@/lib/llm/openrouter';
import { ROLE_PARAMS } from '@/lib/llm/models';
import { toolSchemas, makeExecutor, type ToolContext } from '@/lib/llm/tool-executor';
import { AGENT_REGISTRY } from './registry';
import { getSystemPrompt } from './prompts';
import type { AgentName, TenantContext } from './types';

export interface RunAgentResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
  /** Etiqueta del modelo que respondió la última ronda. Para contabilizar el
   *  consumo NO basta: un ciclo con fallback lo reparte entre dos proveedores y
   *  el reparto real va en `porModelo`. */
  model: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** Desglose del consumo por modelo que de verdad lo gastó (Σ == totales). */
  porModelo: UsoPorModelo[];
}

export async function runAgent(opts: {
  agent: AgentName;
  tenant: TenantContext;
  ctx: ToolContext;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
  timeoutMs?: number;
}): Promise<RunAgentResult> {
  const config = AGENT_REGISTRY[opts.agent];
  const system = getSystemPrompt(config.systemPromptKey, opts.tenant);
  const tools = toolSchemas(config.tools);

  const controller = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  const ctx: ToolContext = { ...opts.ctx, signal: controller.signal };

  // ME-1: aplicar los parámetros por rol (temp 0 + reasoning donde importa), en
  // vez del default mudo de 0.3. El cuadre orquesta dinero → determinístico.
  const params = ROLE_PARAMS[config.role];
  try {
    const res = await generateWithTools({
      role: config.role,
      system,
      messages: opts.history,
      tools,
      toolExecutor: makeExecutor(ctx),
      temperature: params.temperature,
      reasoning: params.reasoning,
      signal: controller.signal,
    });
    return {
      finalText: res.finalText,
      toolCalls: res.toolCalls,
      model: res.model,
      costUsd: res.cost,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      porModelo: res.porModelo,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
