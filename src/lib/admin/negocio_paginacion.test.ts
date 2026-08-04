import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-40, ALTO — LA CONSOLA DE COSTO SE CONGELA EN LA FILA 1,000.
//
// `negocio.ts` leía sus cinco consultas sin `.range()`, sin `.order()` y sin
// techo. PostgREST recorta en silencio a `max_rows` (1,000 por default): no
// lanza, no loguea, devuelve menos filas. Es el MISMO borde que `pg.ts:28-38`
// declara textualmente y que `analytics_paginacion.test.ts` ya vigila para el
// panel de una flota — solo que la consola de Javier no pasaba por ahí.
//
// Cada liquidación escribe ~19 filas de `llm_costo`: la tabla cruza las 1,000
// alrededor de la liquidación #46. Y sin `.order()` PostgREST entrega el
// primer bloque del plan, que para una tabla append-only son las filas MÁS
// VIEJAS: `porDia` deja de tener días recientes, `tendencia()` devuelve `null`
// y la flecha DESAPARECE en vez de gritar. Es el modo de fallo que
// `costos.ts:5-13` llama el peligroso: "bajó sola y nadie lo notó".
//
// Segundo defecto medido aquí: `round2` sobre dólares de costo unitario de IA.
// Una llamada de OCR cuesta $0.0027 y `round2` la imprime `$0.00 · 1 llamadas`
// en Model Ops — la pantalla que existe para responder "¿me sale más barato
// Gemini o Haiku?". La unidad correcta la declara `costos.ts:redondearUsd`
// (seis decimales): "no hay unidad más chica, hay un precio por token".
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

/** Filas por tabla. La página se corta con `.range()`, como PostgREST. */
let tablas: Record<string, Fila[]> = {};
const rangosPorTabla: Record<string, Array<[number, number]>> = {};
const ordenPorTabla: Record<string, string[]> = {};

function crearBuilder(tabla: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'limit']) b[m] = self;
  b.order = (col: string) => {
    (ordenPorTabla[tabla] ??= []).push(col);
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    (rangosPorTabla[tabla] ??= []).push([desde, hasta]);
    return Promise.resolve({ data: (tablas[tabla] ?? []).slice(desde, hasta + 1), error: null });
  };
  // Sin `.range()` una consulta sigue siendo awaitable: así es como estaban
  // escritas las cinco. Devuelve el bloque recortado a 1,000 — lo que hace
  // PostgREST de verdad, y lo que esta prueba tiene que ver fallar.
  b.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve({ data: (tablas[tabla] ?? []).slice(0, 1000), error: null }).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }),
}));

const { getResumenNegocio, getCostoPorFaseModelo } = await import('./negocio');

/** N filas de `llm_costo` de un centavo cada una, un día distinto cada 100. */
function filasCosto(n: number, extra: Fila[] = []): Fila[] {
  const base = Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(6, '0')}`,
    tenant_id: 't1', fase: 'ocr', modelo: 'google/gemini-3.6-flash',
    tokens_in: 10, tokens_out: 1, costo_usd: 0.01,
    created_at: '2026-07-01T10:00:00Z',
  }));
  return [...base, ...extra];
}

beforeEach(() => {
  tablas = {};
  for (const k of Object.keys(rangosPorTabla)) delete rangosPorTabla[k];
  for (const k of Object.keys(ordenPorTabla)) delete ordenPorTabla[k];
});

describe('getResumenNegocio — el gasto en IA ya no se congela en la fila 1,000', () => {
  it('con 1,001 filas de llm_costo, la 1,001 cuenta (dos páginas)', async () => {
    // La fila 1,001 es la ÚNICA del día de hoy: si se pierde, `porDia` no
    // tiene el día reciente y la consola dice que el gasto se detuvo.
    tablas.llm_costo = filasCosto(1000, [{
      id: 'c999999', tenant_id: 't1', fase: 'cuadre', modelo: 'anthropic/claude-sonnet-5',
      tokens_in: 500, tokens_out: 100, costo_usd: 5, created_at: '2026-08-02T09:00:00Z',
    }]);
    const r = await getResumenNegocio('2026-08-02');
    expect(r.porDia.map((d) => d.dia)).toContain('2026-08-02');
    expect(r.costoIaUsd).toBe(15);
    expect(r.porFase.map((f) => f.fase)).toContain('cuadre');
    expect(rangosPorTabla.llm_costo?.length ?? 0).toBeGreaterThan(1);
    expect(rangosPorTabla.llm_costo?.[0]).toEqual([0, 999]);
  });

  it('con 1,001 viajes, `viajesProcesados` los cuenta todos', async () => {
    tablas.viaje = Array.from({ length: 1001 }, (_, i) => ({ id: `v${i}`, tenant_id: 't1' }));
    const r = await getResumenNegocio('2026-08-02');
    expect(r.viajesProcesados).toBe(1001);
  });

  it('con 1,001 gastos, `facturasTotal` los cuenta todos', async () => {
    tablas.gasto = Array.from({ length: 1001 }, (_, i) => ({
      id: `g${i}`, created_at: '2026-08-01T08:00:00Z',
    }));
    const r = await getResumenNegocio('2026-08-02');
    expect(r.facturasTotal).toBe(1001);
  });

  it('las cuatro consultas piden un `order` explícito (sin él, la página es la que quiera el plan)', async () => {
    await getResumenNegocio('2026-08-02');
    for (const t of ['tenant', 'viaje', 'llm_costo', 'gasto']) {
      expect(ordenPorTabla[t] ?? [], `${t} sin .order()`).not.toEqual([]);
    }
  });

  it('un fallo de Supabase sigue LANZANDO, no se lee como "cero negocio"', async () => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ['select', 'eq', 'limit', 'order']) b[m] = self;
    b.range = () => Promise.resolve({ data: null, error: { message: 'fetch failed' } });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'fetch failed' } }).then(ok);
    const admin = await import('@/lib/supabase/admin');
    const spy = vi.spyOn(admin, 'supabaseAdmin').mockReturnValue({ from: () => b } as never);
    await expect(getResumenNegocio('2026-08-02')).rejects.toThrow('fetch failed');
    spy.mockRestore();
  });
});

describe('el costo unitario de IA se redondea en la unidad que tiene, no en centavos', () => {
  it('getCostoPorFaseModelo con $0.0027 NO imprime $0.00', async () => {
    tablas.llm_costo = [
      { id: 'c1', fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 0.0027 },
    ];
    const r = await getCostoPorFaseModelo();
    expect(r[0].costoUsd).toBe(0.0027);
  });

  it('y `porModelo`/`porFase` tampoco — es la columna con la que se compara Gemini contra Haiku', async () => {
    tablas.llm_costo = [
      { id: 'c1', tenant_id: 't1', fase: 'ocr', modelo: 'google/gemini-3.6-flash', tokens_in: 1, tokens_out: 1, costo_usd: 0.0027, created_at: '2026-08-01T10:00:00Z' },
      { id: 'c2', tenant_id: 't1', fase: 'ocr', modelo: 'anthropic/claude-haiku-4.5', tokens_in: 1, tokens_out: 1, costo_usd: 0.0041, created_at: '2026-08-01T10:00:00Z' },
    ];
    const r = await getResumenNegocio('2026-08-02');
    expect(r.porModelo.map((m) => m.costoUsd)).toEqual([0.0041, 0.0027]);
    expect(r.porFase[0].costoUsd).toBe(0.0068);
    // El costo por flota es la misma moneda: también en la unidad fina.
    tablas.tenant = [{ id: 't1', nombre: 'Transportes Innovativos', plan: 'demo' }];
    const r2 = await getResumenNegocio('2026-08-02');
    expect(r2.flotas[0].costoIaUsd).toBe(0.0068);
  });

  it('getCostoPorFaseModelo también pagina', async () => {
    tablas.llm_costo = Array.from({ length: 1001 }, (_, i) => ({
      id: `c${i}`, fase: i === 1000 ? 'cuadre' : 'ocr', modelo: 'm', costo_usd: 0.001,
    }));
    const r = await getCostoPorFaseModelo();
    expect(r.map((x) => x.fase)).toContain('cuadre');
  });
});
