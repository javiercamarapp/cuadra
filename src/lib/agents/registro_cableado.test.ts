import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO — EL NOMBRE DE UNA TOOL SE DECLARA CUATRO VECES Y EL
// REGISTRO ENTERO COLGABA DE UN IMPORT POR EFECTO SECUNDARIO, SIN PRUEBA.
//
// Las cuatro declaraciones, las cuatro `string` suelto:
//   1. la llave del registro          — `registerTool('cuadrar_viaje', …)`
//   2. el nombre que ve el modelo     — `schema.function.name`
//   3. la lista del agente            — `AGENT_REGISTRY.liquidacion.tools`
//   4. el prompt del sistema          — que le ORDENA llamarlas por nombre
//
// `toolSchemas` resolvía por la llave y descartaba EN SILENCIO lo que no
// encontraba (`.map(…?.schema).filter(Boolean)`), y `executeTool` resuelve por
// el nombre del schema. Los tres escenarios de la auditoría pasaban con las
// 1,629 pruebas, `tsc` y el lint en verde:
//
//   · renombrar la llave y olvidar `registry.ts` → 2 esquemas en vez de 3, sin
//     error ni log; el modelo nunca ve `cuadrar_viaje`, `guardiaCifras` calcula
//     `cuadro = false` y el viaje NO CIERRA.
//   · llave `consultar_politica` y schema `consultar_politicas` → el modelo la
//     llama por el nombre anunciado, `executeTool` responde "tool desconocida"
//     seis rondas seguidas (seis llamadas pagadas) hasta el LoopGuardError.
//   · un linter de imports sin uso se lleva `import '@/lib/cuadra/tools'` de
//     `processor.ts:9` → `REGISTRY` vacío, `tools: undefined` en la petición, y
//     el agente narra sin números en cada turno.
//
// Esta prueba es la que faltaba: ejecuta el cableado REAL —registro poblado,
// `toolSchemas` sobre la lista del agente, nombres del prompt— sin mockear
// `@/lib/agents/run`, que es lo que hacen TODAS las pruebas del processor.
// ═══════════════════════════════════════════════════════════════════════════

const { AGENT_REGISTRY } = await import('./registry');
const { getSystemPrompt } = await import('./prompts');
const { toolSchemas } = await import('@/lib/llm/tool-executor');

const CTX = { tenantId: 't1', nombreFlota: 'Flota Demo', agentName: 'Cuadra', timezone: 'America/Mexico_City' };
const nombreDe = (t: { type: string; function?: { name: string } }) => (t.type === 'function' ? t.function!.name : '');

describe('cableado del registro de tools', () => {
  it('el registro se puebla por importar el runner: no depende de processor.ts', async () => {
    // `run.ts` no importaba `tools.ts`: el registro entero colgaba de una sola
    // línea en un archivo de OTRO módulo.
    await import('./run');
    const schemas = toolSchemas(AGENT_REGISTRY.liquidacion.tools);
    expect(schemas).toHaveLength(AGENT_REGISTRY.liquidacion.tools.length);
  });

  it('cada nombre de la lista del agente existe Y anuncia EXACTAMENTE ese nombre', async () => {
    await import('./run');
    const schemas = toolSchemas(AGENT_REGISTRY.liquidacion.tools);
    // Si la llave y `schema.function.name` divergen, el modelo llama por el
    // nombre anunciado y `executeTool` —que resuelve por el schema— no lo
    // encuentra: seis rondas pagadas contra "tool desconocida".
    expect(schemas.map(nombreDe)).toEqual(AGENT_REGISTRY.liquidacion.tools);
  });

  it('una tool que no existe REVIENTA en vez de desaparecer en silencio', () => {
    expect(() => toolSchemas(['cuadrar_viaje_v2'])).toThrow(/cuadrar_viaje_v2/);
  });

  it('el agente sin tools sigue pudiendo no tener ninguna', () => {
    expect(toolSchemas(AGENT_REGISTRY.orchestrator.tools)).toEqual([]);
  });

  it('el prompt no nombra ninguna tool que no esté en la lista del agente', async () => {
    await import('./run');
    const prompt = getSystemPrompt(AGENT_REGISTRY.liquidacion.systemPromptKey, CTX);
    // Los nombres van entrecomillados en el prompt ("consultar_politica").
    const nombrados = [...prompt.matchAll(/"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g)].map((m) => m[1]);
    expect(nombrados.length, 'el prompt debe seguir ordenando llamarlas por nombre').toBeGreaterThan(0);
    for (const n of new Set(nombrados)) {
      expect(AGENT_REGISTRY.liquidacion.tools, `el prompt nombra "${n}"`).toContain(n);
    }
  });

  it('todas las tools del agente están nombradas en su prompt', async () => {
    const prompt = getSystemPrompt(AGENT_REGISTRY.liquidacion.systemPromptKey, CTX);
    for (const n of AGENT_REGISTRY.liquidacion.tools) expect(prompt).toContain(n);
  });
});
