import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (backend) — el CSV que va al ERP se recortaba en
// silencio a 1,000 renglones.
//
// La consulta pedía `.limit(5000)` y entregaba lo que viniera. PostgREST
// aplica `db-max-rows` como TECHO DURO por encima del `limit` del cliente, y el
// default de la plataforma son 1,000 filas. El propio repo lo documenta dos
// veces —`repo.ts` («recorta la respuesta EN SILENCIO —sin error, sin cabecera
// que el cliente mire, sin nada») y `analytics.ts`, donde ya se arregló con
// `traerTodo`—. El export nunca se movió.
//
// Escenario: flota de 40 unidades, ~25 liquidaciones cerradas por día. En el
// mes 3 lleva ~1,800. El contralor pulsa «Exportar CSV» para conciliar el
// trimestre contra su ERP y recibe 1,000 renglones bien formados, HTTP 200,
// `Content-Disposition: attachment`, sin fila de corte ni advertencia. Concilia
// contra un universo al que le falta el 44% — y lo que falta es lo más viejo,
// que es justo lo que ya nadie va a revisar.
//
// Esta prueba simula el techo del servidor: la primera página devuelve
// exactamente 1,000 filas (que es como se ve un recorte) y la segunda el resto.
// Sin paginación, el CSV sale con 1,000 renglones.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => true, clientIp: () => '10.0.0.1' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** Filas que el "servidor" tiene. Más de un techo de 1,000. */
const TOTAL = 1_450;
const TODAS = Array.from({ length: TOTAL }, (_, i) => ({
  created_at: `2026-0${(i % 3) + 1}-01T12:00:00Z`,
  total_comprobado: 100 + i,
  total_anticipo: 100 + i,
  diferencia: 0,
  estatus: 'cuadrada',
  diferencias: [],
  viaje: { folio: `V-${String(i).padStart(5, '0')}`, operador: { nombre: 'Juan Pérez' } },
}));

const rangos: Array<[number, number]> = [];

function builder() {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = () => q;
  // El `limit` del cliente NO gana contra el techo del servidor: se ignora, que
  // es exactamente lo que hace PostgREST.
  q.limit = () => Promise.resolve({ data: TODAS.slice(0, 1_000), error: null });
  q.range = (desde: number, hasta: number) => {
    rangos.push([desde, hasta]);
    return Promise.resolve({ data: TODAS.slice(desde, Math.min(hasta + 1, desde + 1_000)), error: null });
  };
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));

const { GET } = await import('./liquidaciones/route');

beforeEach(() => {
  rangos.length = 0;
  getSessionTenant.mockReset();
  getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' });
});

const pedir = () => GET(new Request('https://likida.ai/api/export/liquidaciones'));

describe('el export a CSV no se recorta contra el techo de PostgREST', () => {
  it('trae las 1,450 liquidaciones, no las primeras 1,000', async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    const csv = await res.text();
    // Una línea de encabezado + una por liquidación.
    const renglones = csv.trim().split('\n').length - 1;
    expect(renglones, 'el contralor conciliaría contra un universo incompleto').toBe(TOTAL);
  });

  it('la primera y la última liquidación están las dos en el archivo', async () => {
    const csv = await (await pedir()).text();
    expect(csv).toContain('V-00000');
    expect(csv).toContain(`V-0${TOTAL - 1}`.slice(0, 6));
  });

  it('pagina con `range`, que es lo único que el techo del servidor respeta', async () => {
    await pedir();
    expect(rangos.length, 'con una sola vuelta el techo vuelve a morder').toBeGreaterThan(1);
    expect(rangos[0]).toEqual([0, 999]);
  });
});
