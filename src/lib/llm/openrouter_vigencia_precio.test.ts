import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-42 — LA VIGENCIA DE UNA TARIFA DEJA DE SER UN COMENTARIO.
//
// `openrouter.ts:87` decía, al final del renglón: «intro VIGENTE hasta
// 31-ago-2026; revertir a [3,15] después». `PRICES` es la ÚNICA fuente de
// costo del producto: nadie reconcilia nunca contra un importe del proveedor.
// El 1-sep —25 días después del demo— todas las filas de `llm_costo` del
// modelo de cuadre se iban a registrar con un 50% de subestimación sin una
// sola línea de aviso, mientras `llm.modelo_sin_precio` sí grita cuando el
// modelo es desconocido.
//
// LA PRUEBA QUE IMPORTA es la última: falla sola el 1-sep-2026 si nadie tocó
// `PRICES`. Las otras fijan la maquinaria para que cuando falle se sepa qué
// hacer.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { PRICES, VIGENCIAS, preciosCaducados, avisarPreciosCaducados, calcCost } =
  await import('./openrouter');

beforeEach(() => { logger.error.mockReset(); logger.warn.mockReset(); });

describe('VIGENCIAS — la tabla dice hasta cuándo vale un precio y a cuánto vuelve', () => {
  it('todo lo que declara vigencia existe en PRICES', () => {
    for (const model of Object.keys(VIGENCIAS)) {
      expect(PRICES[model], `${model} tiene vigencia y no tiene precio`).toBeDefined();
    }
  });

  it('la fecha es una fecha ISO real, no prosa', () => {
    for (const [model, v] of Object.entries(VIGENCIAS)) {
      expect(v.hasta, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(v.hasta)), model).toBe(false);
      expect(v.despues, model).toHaveLength(2);
    }
  });

  it('dentro de la vigencia no hay nada que reportar', () => {
    expect(preciosCaducados('2026-08-31')).toEqual([]);
  });

  it('un día después SÍ, con el importe correcto al lado', () => {
    const caducados = preciosCaducados('2026-09-01');
    expect(caducados.map((c) => c.model)).toContain('anthropic/claude-sonnet-5');
    const sonnet = caducados.find((c) => c.model === 'anthropic/claude-sonnet-5')!;
    expect(sonnet.debeSer).toEqual(VIGENCIAS['anthropic/claude-sonnet-5'].despues);
  });

  it('y el aviso es un `error`, no un `warn`: la cifra que se está guardando es falsa', () => {
    avisarPreciosCaducados('2026-09-01');
    expect(logger.error).toHaveBeenCalledWith('llm.precio_caducado', expect.objectContaining({
      model: 'anthropic/claude-sonnet-5',
    }));
    const meta = logger.error.mock.calls[0][1] as { err: string };
    expect(meta.err).toContain('POR DEBAJO');
    expect(meta.err).toContain('[3, 15]');
  });

  it('no se repite en cada llamada: un error por token ahoga el log donde hay que verlo', () => {
    logger.error.mockReset();
    avisarPreciosCaducados('2026-09-01');
    avisarPreciosCaducados('2026-09-01');
    expect(logger.error).toHaveBeenCalledTimes(0); // ya avisó en la prueba anterior
  });

  it('`calcCost` sigue cobrando con la tabla, avise o no', () => {
    // 1M in + 1M out de Sonnet a la tarifa intro: $2 + $10.
    expect(calcCost('anthropic/claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(12, 6);
  });
});

describe('EL TRINQUETE DE LA FECHA', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // ESTA PRUEBA ESTÁ ESCRITA PARA FALLAR SOLA.
  //
  // Cuando falle, el arreglo NO es mover la fecha: es confirmar la tarifa
  // real contra el proveedor y actualizar `PRICES` a `despues` (o extender
  // `hasta` si el proveedor extendió la promoción, con la fuente anotada).
  // Cambiar `hasta` sin mirar el precio es apagar el medidor.
  // ═══════════════════════════════════════════════════════════════════════
  it('ningún precio de PRICES está fuera de su vigencia HOY', () => {
    const caducados = preciosCaducados();
    expect(
      caducados,
      caducados.map((c) => `${c.model}: la tarifa venció el ${c.hasta}; PRICES sigue en `
        + `[${c.vigente?.join(', ')}] y debe ser [${c.debeSer.join(', ')}]. `
        + 'Confírmalo contra el proveedor ANTES de tocar la tabla.').join('\n'),
    ).toEqual([]);
  });
});
