import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// LA FASE `'escalacion'` DESCRIBÍA UN AGENTE QUE YA NO EXISTE.
// (auditoría 10 — resto del rubro de tool calling)
//
// `faseDeModelo` clasificaba como escalación cualquier modelo cuyo slug tuviera
// «opus». Eso tenía sentido mientras hubo un rol `cuadre_fallback` con Opus por
// default y su párrafo de «escalación por baja confianza / monto alto / caso
// ambiguo». Ese rol se retiró (commit eace503) porque NADIE lo ejecutaba, y con
// él se fue el único camino que llevaba un modelo Opus al sistema:
//
//   · los cuatro roles por default son gemini-3.6-flash, claude-sonnet-5 y
//     gemini-3.5-flash-lite ×2 — ninguno lleva «opus»;
//   · la tabla `FALLBACK` (openrouter.ts:54-64) nunca APUNTA a Opus: lo tiene
//     como llave de origen, no como destino.
//
// Queda un solo camino, y por él la etiqueta es FALSA: si alguien configura
// `CUADRA_MODEL_CUADRE=anthropic/claude-opus-5`, ese Opus ES el agente de cuadre
// de esa instalación, no una escalación de nada. La fila de `llm_costo` diría
// «Agente de Escalación» —así lo rotulan tres pantallas de `/admin`— sobre el
// turno normal, y el costo del cuadre desaparecería de su propia fase.
//
// Se retira, con el mismo criterio con el que se retiró el rol: cuando la
// escalación se implemente, la fase vuelve CON el código que la escribe.
// ═══════════════════════════════════════════════════════════════════════════

const insertados: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (fila: Record<string, unknown>) => {
        insertados.push(fila);
        return { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) };
      },
    }),
  }),
}));

const { registrarCostoDesglosado } = await import('./costos');

describe('no se escribe una fase que ningún código produce', () => {
  beforeEach(() => { insertados.length = 0; });

  it('un Opus configurado como agente de cuadre se registra como CUADRE', async () => {
    // Es el único camino que queda hacia un modelo Opus, y por él la etiqueta
    // «escalación» es falsa: ese modelo ES el cuadre de esa instalación.
    await registrarCostoDesglosado(
      { tenantId: 't1', viajeId: 'v1', fase: 'cuadre' },
      { model: 'anthropic/claude-opus-5', tokensIn: 100, tokensOut: 20, cost: 0.05 },
    );
    expect(insertados[0].fase).toBe('cuadre');
  });

  it('la fase escrita es la que pidió el llamador, sin reinterpretarla por el slug', async () => {
    await registrarCostoDesglosado(
      { tenantId: 't1', viajeId: 'v1', fase: 'ocr' },
      {
        model: 'anthropic/claude-opus-5', tokensIn: 2, tokensOut: 2, cost: 0.02,
        porModelo: [
          { model: 'google/gemini-3.6-flash', tokensIn: 1, tokensOut: 1, cost: 0.01 },
          { model: 'anthropic/claude-opus-5', tokensIn: 1, tokensOut: 1, cost: 0.01 },
        ],
      },
    );
    expect(insertados.map((f) => f.fase)).toEqual(['ocr', 'ocr']);
  });

  it('`costos.ts` ya no declara ni escribe `escalacion`', () => {
    const src = sinComentarios(readFileSync('src/lib/cuadra/costos.ts', 'utf8'));
    expect(
      src,
      'una fase declarada que ningún camino puede producir es una promesa, no un dato: ' +
      'tres pantallas de /admin la rotulan «Agente de Escalación» y ese agente no existe.',
    ).not.toContain('escalacion');
  });

  it('y ningún modelo por default —ni ningún destino de FALLBACK— es un Opus', () => {
    // La razón de fondo, comprobada contra el código y no contra el recuerdo.
    const llm = sinComentarios(readFileSync('src/lib/llm/models.ts', 'utf8'));
    const defaults = llm.slice(llm.indexOf('const DEFAULTS'), llm.indexOf('const ENV_KEY'));
    expect(defaults).not.toMatch(/opus/);

    const or = sinComentarios(readFileSync('src/lib/llm/openrouter.ts', 'utf8'));
    const tabla = or.slice(or.indexOf('const FALLBACK'), or.indexOf('export function isTransientError'));
    const destinos = [...tabla.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(destinos.length).toBeGreaterThan(0);
    expect(destinos.filter((d) => d.includes('opus'))).toEqual([]);
  });
});
