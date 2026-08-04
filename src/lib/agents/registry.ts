// Fuente única de verdad de los agentes de Cuadra. A diferencia de atiende
// (~18 agentes médicos), Cuadra es mono-propósito: un agente de liquidación.

// EL REGISTRO DE TOOLS SE PUEBLA POR EFECTO SECUNDARIO, Y ESTE ES EL ARCHIVO
// QUE LAS NOMBRA. Colgaba de una sola línea —`import '@/lib/cuadra/tools'` en
// `processor.ts`—, en otro módulo y sin ninguna prueba: un reordenamiento de
// imports o un linter de "imports sin uso" la borraba y `toolSchemas` devolvía
// `[]` sin que nada fallara. Si aquí se declara `tools: ['cuadrar_viaje', …]`,
// aquí se garantiza que esos nombres existan.
import '@/lib/cuadra/tools';
import type { AgentConfig, AgentName } from './types';

export const AGENT_REGISTRY: Record<AgentName, AgentConfig> = {
  orchestrator: {
    name: 'orchestrator',
    role: 'router',
    description: 'Clasifica el mensaje entrante y decide si arrancar una liquidación',
    tools: [],
    systemPromptKey: 'orchestrator',
  },
  liquidacion: {
    name: 'liquidacion',
    role: 'cuadre', // Claude Sonnet — razonamiento con dinero de por medio
    description:
      'Recibe comprobantes del operador por WhatsApp, los cuadra contra el anticipo y la política, detecta diferencias y cierra la liquidación',
    // extraer_comprobante corre en el pipeline al llegar la foto (el LLM no
    // pasa bytes de imagen); el agente ve el gasto extraído como contexto.
    tools: ['consultar_politica', 'cuadrar_viaje', 'guardar_liquidacion'],
    systemPromptKey: 'liquidacion',
  },
};
