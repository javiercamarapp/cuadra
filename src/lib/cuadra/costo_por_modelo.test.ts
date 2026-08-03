import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// LA FILA DE `llm_costo` TIENE QUE DECIR QUÉ MODELO LA PRODUJO.
// (auditoría 10 — el CONSUMO de la atribución de costo)
//
// El gateway ya emite el desglose real: `res.porModelo` (`UsoPorModelo[]`, con
// la invariante `Σ porModelo == { tokensIn, tokensOut, cost }`), y
// `PartialExecutionError` carga `model` + `porModelo`. Lo que faltaba era que
// alguien lo ESCRIBIERA.
//
// Un turno puede correr en DOS modelos: el ciclo de tools cambia de proveedor
// cuando el primero falla (`FALLBACK`, openrouter.ts:54-64) y cada ronda se
// cobra al precio del modelo que respondió ESA ronda. Quien escribía la fila
// tomaba solo el acumulado y lo etiquetaba con UN modelo —el último—, así que en
// `/admin` el gasto del fallback quedaba facturado al slug equivocado. Sonnet 5
// y GPT-5.6-terra no cuestan lo mismo, y esa es la pantalla de la que sale el
// precio del producto.
//
// Y en la rama de cierre parcial —la que MÁS tokens consume— el modelo se
// escribía como el literal `'parcial'`: una constante que ningún proveedor
// facturó nunca, agrupada junto a los slugs reales bajo «Costo por modelo».
// Igual el `'ocr'` del camino de error de la visión.
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

describe('registrarCostoDesglosado', () => {
  beforeEach(() => { insertados.length = 0; });

  it('escribe UNA fila por modelo que de verdad corrió', async () => {
    await registrarCostoDesglosado(
      { tenantId: 't1', viajeId: 'v1', fase: 'cuadre' },
      {
        model: 'openai/gpt-5.6-terra', tokensIn: 1_300, tokensOut: 250, cost: 0.031,
        porModelo: [
          { model: 'anthropic/claude-sonnet-5', tokensIn: 1_000, tokensOut: 200, cost: 0.024 },
          { model: 'openai/gpt-5.6-terra', tokensIn: 300, tokensOut: 50, cost: 0.007 },
        ],
      },
    );
    expect(insertados).toHaveLength(2);
    expect(insertados.map((f) => f.modelo)).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-5.6-terra']);
    // Y la suma de las filas sigue siendo el total: la invariante del gateway
    // no se puede romper al escribirla.
    expect(insertados.reduce((s, f) => s + Number(f.costo_usd), 0)).toBeCloseTo(0.031, 6);
    expect(insertados.reduce((s, f) => s + Number(f.tokens_in), 0)).toBe(1_300);
  });

  it('sin desglose, una sola fila con el modelo del acumulado (lo de siempre)', async () => {
    await registrarCostoDesglosado(
      { tenantId: 't1', viajeId: 'v1', fase: 'ocr' },
      { model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 20, cost: 0.002 },
    );
    expect(insertados).toHaveLength(1);
    expect(insertados[0].modelo).toBe('google/gemini-3.6-flash');
  });

  it('la fase se deriva POR FILA, no una vez para todas', async () => {
    // Si una ronda escaló a un modelo más caro, es esa fila la que tiene que
    // decirlo: agrupar las dos bajo la fase del último modelo esconde justo el
    // caso que se quiere ver.
    await registrarCostoDesglosado(
      { tenantId: 't1', viajeId: 'v1', fase: 'cuadre' },
      {
        model: 'anthropic/claude-opus-5', tokensIn: 2, tokensOut: 2, cost: 0.02,
        porModelo: [
          { model: 'anthropic/claude-sonnet-5', tokensIn: 1, tokensOut: 1, cost: 0.01 },
          { model: 'anthropic/claude-opus-5', tokensIn: 1, tokensOut: 1, cost: 0.01 },
        ],
      },
    );
    expect(insertados.map((f) => f.fase)).toEqual(['cuadre', 'escalacion']);
  });
});

describe('los dos escritores de `llm_costo` consumen el desglose', () => {
  // Sin comentarios: lo que se comprueba es lo que el código HACE. El porqué del
  // cambio sí queda escrito al lado, y esa prosa no puede tumbar la prueba.
  const processorSrc = sinComentarios(readFileSync('src/lib/cuadra/processor.ts', 'utf8'));
  const ocrSrc = sinComentarios(readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8'));

  it('el turno del agente escribe por modelo, no una fila con el último', () => {
    expect(processorSrc).toMatch(/registrarCostoDesglosado\([\s\S]{0,400}res\.porModelo/);
  });

  it('el literal `\'parcial\'` ya no se escribe como si fuera un slug de proveedor', () => {
    expect(
      processorSrc,
      "`modelo: 'parcial'` es una constante que ningún proveedor facturó nunca, " +
      'escrita en la rama que más tokens consume y agrupada junto a los slugs reales.',
    ).not.toMatch(/modelo: 'parcial'/);
    // Y en su lugar va lo que el error SÍ trae.
    expect(processorSrc).toMatch(/registrarCostoDesglosado\([\s\S]{0,400}e\.porModelo/);
  });

  it('la visión devuelve su desglose, no solo el acumulado', () => {
    expect(ocrSrc).toMatch(/porModelo/);
    // Los dos caminos: el bueno (`res.porModelo`) y el de error
    // (`err.usage.porModelo`).
    expect(ocrSrc).toMatch(/porModelo: res\.porModelo/);
    expect(ocrSrc).toMatch(/porModelo: u\?\.porModelo/);
  });

  it('y el processor lo escribe en los dos call-sites del OCR', () => {
    const sitios = [...processorSrc.matchAll(/registrarCostoDesglosado\(/g)].length;
    expect(sitios, 'faltan call-sites: OCR sin viaje, OCR con viaje, agente y cierre parcial')
      .toBeGreaterThanOrEqual(4);
  });
});
