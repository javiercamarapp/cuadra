import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-52 (ALTO REINCIDENTE, rendimiento) — «el panel corre sin un
// solo techo de consulta».
//
// `presupuesto.ts` tiene `acotada()` desde la ronda 8 y las escrituras del
// encargado la usan. Las LECTURAS del panel no: `traerTodo`/`exigir` son el
// borde por el que pasan las once consultas de `analytics.ts`, y ninguna
// llevaba tope.
//
// Con Supabase degradado eso no es lento, es indefinido: `safeLog` atrapa
// EXCEPCIONES, no esperas, así que la página no pinta el fallback para el que
// se diseñó — se queda en blanco hasta que la plataforma corta la invocación.
// El rail, además, repite tres consultas en las 20 páginas.
//
// El tope vive en el BORDE y no en cada llamador por la misma razón que
// `exigir`: son once consultas y basta olvidar una.
// ═══════════════════════════════════════════════════════════════════════════

// La firma lleva los DOS parámetros (la etiqueta se afirma más abajo), así
// que el segundo se nombra aunque el doble no lo use.
const acotada = vi.fn(<T,>(consulta: PromiseLike<T>, etiqueta: string) => {
  void etiqueta;
  return Promise.resolve(consulta);
});
vi.mock('./presupuesto', () => ({ acotada }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { exigir, traerTodo } = await import('./pg');

beforeEach(() => acotada.mockClear());

describe('toda lectura del panel lleva techo de tiempo', () => {
  it('`traerTodo` pasa cada página por `acotada`', async () => {
    await traerTodo(async () => ({ data: [{ id: 1 }], error: null }), 'prueba');
    expect(acotada, 'sin tope, una base degradada deja la página en blanco').toHaveBeenCalled();
  });

  it('la etiqueta que se registra al agotarse el tope identifica la consulta', async () => {
    await traerTodo(async () => ({ data: [], error: null }), 'getKpis');
    expect(acotada.mock.calls[0][1]).toContain('getKpis');
  });

  it('cada página de una lectura larga lleva su propio techo', async () => {
    const pagina = (desde: number) =>
      Promise.resolve({ data: Array.from({ length: desde === 0 ? 1000 : 3 }, (_, i) => ({ i })), error: null });
    await traerTodo((desde) => pagina(desde), 'larga');
    expect(acotada).toHaveBeenCalledTimes(2);
  });

  it('el tope no cambia el resultado del camino bueno', async () => {
    const filas = await traerTodo(async () => ({ data: [{ id: 7 }], error: null }), 'prueba');
    expect(filas).toEqual([{ id: 7 }]);
  });

  it('y un error por valor sigue lanzando: fallar cerrado no se toca', () => {
    expect(() => exigir({ data: null, error: { message: 'fetch failed' } }, 'x')).toThrow(/fetch failed/);
  });
});
