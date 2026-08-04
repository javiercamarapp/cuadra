import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-14 (ALTO, backend + rendimiento) — «"Avance de cierre —
// Todo" se calcula sobre 100 filas, `getDocumentos(1000)` pide exactamente el
// `max_rows`, y el día se agrupa en UTC».
//
//  · `getViajes(tenantId, limite = 100)` era la ÚNICA lectura del archivo que
//    no pasaba por `traerTodo`. La barra de avance de cierre filtra por
//    periodo EN EL CLIENTE sobre lo que esa consulta trajo, así que para una
//    flota de 25 viajes/día la pestaña "Todo" pintaba el avance de los últimos
//    cuatro días y lo rotulaba como el histórico: 25% donde el histórico real
//    es ~95%, y el mismo número que la pestaña "Mes".
//
//  · `.limit(1000)` es EXACTAMENTE el `max_rows` que PostgREST recorta en
//    silencio. Pedir el tope no distingue "hay 1,000" de "hay 12,000".
//
//  · `(r.created_at).slice(0, 10)` se queda con el día UTC. México es UTC−6:
//    una liquidación cerrada el viernes 31-jul a las 20:00 hora local se
//    pintaba en la barra del sábado. El propio archivo documenta este bug como
//    ya pagado treinta líneas más arriba, en otro sitio.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const filas = new Map<string, unknown[]>();
const rangosPedidos: Array<[number, number]> = [];
const limitesPedidos: number[] = [];

function crearBuilder(tabla: string) {
  let desde = 0, hasta = Number.MAX_SAFE_INTEGER;
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'in', 'gte', 'lte', 'is', 'not']) b[m] = self;
  b.limit = (n: number) => { limitesPedidos.push(n); hasta = n - 1; return b; };
  b.range = (d: number, h: number) => { desde = d; hasta = h; rangosPedidos.push([d, h]); return b; };
  const resp = (): Resp => ({ data: (filas.get(tabla) ?? []).slice(desde, hasta + 1), error: null });
  b.maybeSingle = () => Promise.resolve(resp());
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn() }));

const { getViajes, getDocumentos, getLiquidacionesPorDia } = await import('./analytics');

const TENANT = 't1';
beforeEach(() => { filas.clear(); rangosPedidos.length = 0; limitesPedidos.length = 0; });

describe('el avance de cierre se calcula sobre TODOS los viajes', () => {
  it('120 viajes en la base son 120 viajes en la barra, no 100', async () => {
    filas.set('viaje', Array.from({ length: 120 }, (_, i) => ({
      id: `v${i}`, folio: `VJ-${i}`, estatus: 'liquidado', anticipo: 0,
      fecha_inicio: '2026-07-01', intake_pendientes: 0,
    })));

    expect(await getViajes(TENANT)).toHaveLength(120);
  });

  it('y se traen paginando, no con un `limit` que corte en silencio', async () => {
    filas.set('viaje', Array.from({ length: 1500 }, (_, i) => ({ id: `v${i}`, estatus: 'abierto' })));

    expect(await getViajes(TENANT)).toHaveLength(1500);
    expect(rangosPedidos.length, 'una sola página son 1,000 filas: PostgREST recorta ahí').toBeGreaterThan(1);
  });
});

describe('la bandeja de documentos no pide exactamente el max_rows', () => {
  it('12,000 comprobantes se leen enteros', async () => {
    filas.set('gasto', Array.from({ length: 2400 }, (_, i) => ({ id: `g${i}`, concepto: 'diesel', monto: 100 })));

    expect(await getDocumentos(TENANT)).toHaveLength(2400);
  });

  it('nadie pide `.limit(1000)`: es el número que PostgREST corta sin avisar', async () => {
    filas.set('gasto', [{ id: 'g1', concepto: 'diesel', monto: 100 }]);
    await getDocumentos(TENANT);
    expect(limitesPedidos).not.toContain(1000);
  });
});

describe('el día de una liquidación es el día en México', () => {
  it('cerrada el 31-jul a las 20:00 CST, se cuenta el 31 y no el 1-ago', async () => {
    filas.set('liquidacion', [{ created_at: '2026-08-01T02:00:00.000+00:00' }]);

    const dias = await getLiquidacionesPorDia(TENANT, 7, '2026-08-01');
    const jul31 = dias.find((d) => d.dia === '2026-07-31');
    const ago01 = dias.find((d) => d.dia === '2026-08-01');

    expect(jul31?.valor, 'el viernes de la flota se pintaba en la barra del sábado').toBe(1);
    expect(ago01?.valor).toBe(0);
  });

  it('CONTROL · una cerrada al mediodía cae en su propio día', async () => {
    filas.set('liquidacion', [{ created_at: '2026-07-30T18:00:00.000+00:00' }]);

    const dias = await getLiquidacionesPorDia(TENANT, 7, '2026-08-01');
    expect(dias.find((d) => d.dia === '2026-07-30')?.valor).toBe(1);
  });
});
