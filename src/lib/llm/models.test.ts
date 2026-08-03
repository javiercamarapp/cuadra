import { describe, it, expect } from 'vitest';
import { modelFor, ROLE_PARAMS, type ModelRole } from './models';
import { AGENT_REGISTRY } from '@/lib/agents/registry';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — UN ROL DECLARADO, PRESUPUESTADO Y DOCUMENTADO QUE NO
// EJECUTA NADIE.
//
// `grep -rn "cuadre_fallback" src` devolvía SÓLO las cuatro declaraciones de
// `models.ts`: nadie llamaba `modelFor('cuadre_fallback')` y ningún agente lo
// usaba. Con eso, "Escalación por baja confianza / monto alto / caso ambiguo" y
// "Fallback Opus por confianza" describían algo que el código no hace, y quien
// leyera `models.ts` para saber qué corre en producción estaba leyendo una
// promesa.
//
// Este inventario hace que agregar un rol sea una decisión: si se declara uno
// sin un camino que lo seleccione, hay que escribir aquí cuál es — y si no
// existe, la prueba no deja.
// ═══════════════════════════════════════════════════════════════════════════

/** Rol → quién lo selecciona. Exhaustivo por tipo: `Record<ModelRole, …>`. */
const QUIEN_LO_SELECCIONA: Record<ModelRole, string> = {
  ocr: 'src/lib/cuadra/intake/ocr.ts — generateStructured con la foto del comprobante',
  cuadre: 'AGENT_REGISTRY.liquidacion → run.ts → generateWithTools',
  router: 'AGENT_REGISTRY.orchestrator → run.ts',
  chat: 'rol genérico del gateway para respuestas sin tools (generateResponse)',
};

describe('roles de modelo — lo declarado es lo que corre', () => {
  it('no hay más roles declarados que los que alguien selecciona', () => {
    expect(Object.keys(ROLE_PARAMS).sort()).toEqual(Object.keys(QUIEN_LO_SELECCIONA).sort());
  });

  it('cada rol resuelve a un slug y trae sus parámetros', () => {
    for (const rol of Object.keys(QUIEN_LO_SELECCIONA) as ModelRole[]) {
      expect(modelFor(rol), rol).toMatch(/^[a-z0-9-]+\/[a-z0-9.\-]+$/);
      expect(ROLE_PARAMS[rol], rol).toBeDefined();
    }
  });

  it('los roles que usan los agentes están declarados', () => {
    for (const agente of Object.values(AGENT_REGISTRY)) {
      expect(Object.keys(QUIEN_LO_SELECCIONA), agente.name).toContain(agente.role);
    }
  });
});
