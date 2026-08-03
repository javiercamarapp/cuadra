import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO de la auditoría 10 — lo encontraron por separado backend, seguridad,
// arquitectura, modelo de datos y frontend, los cinco contra el mismo hueco.
//
// `permisos.ts:9` promete por escrito que estas funciones deciden «qué botón se
// pinta Y QUÉ ENDPOINT ACEPTA LA PETICIÓN». `puedeExportar` excluye a
// `operador` a propósito. Ningún endpoint la llamaba: las dos rutas de export
// comprobaban `s.tenantId` y nada más, así que cualquier sesión del tenant
// —incluido el chofer— bajaba el CSV con las liquidaciones de TODA la flota
// (folio, monto, diferencia y nombre del operador de cada viaje) o firmaba la
// URL del PDF de cualquier liquidación.
//
// Y no lo tapaba nada más: estas rutas leen con `supabaseAdmin()` (service-role,
// salta RLS), así que la policy `operador_ve_sus_liquidaciones` de la 0045
// nunca se evalúa aquí; y viven fuera del matcher del proxy, así que la primera
// capa tampoco las mira. La puerta de rol tenía que estar en el handler.
//
// El caso de control (flota_admin sí baja el CSV) es lo que impide que este
// arnés pase con la puerta cerrada de más.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: () => true,
  clientIp: () => '10.0.0.1',
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// Si el rol se comprueba DESPUÉS de leer, este espía lo delata: un 403 que
// primero consultó la base ya expuso la fila al proceso.
const supabaseAdmin = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => supabaseAdmin() }));

const { GET: getCsv } = await import('./liquidaciones/route');
const { GET: getPdf } = await import('./pdf/[id]/route');

const FILA = {
  created_at: '2026-08-01T18:00:00Z',
  total_comprobado: 10600,
  total_anticipo: 10600,
  diferencia: 0,
  estatus: 'cuadrada',
  diferencias: [],
  viaje: { folio: 'V-001', operador: { nombre: 'Juan Pérez' } },
};

/** Cliente mínimo que responde las dos cadenas reales de estas rutas. */
function clienteFalso() {
  const csv = { data: [FILA], error: null };
  const pdf = { data: { pdf_url: 't-1/v-1.pdf' }, error: null };
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q; q.order = () => q;
  q.limit = () => Promise.resolve(csv);
  q.maybeSingle = () => Promise.resolve(pdf);
  return {
    from: () => q,
    storage: {
      from: () => ({
        createSignedUrl: () =>
          Promise.resolve({ data: { signedUrl: 'https://storage.example/firmada' }, error: null }),
      }),
    },
  };
}

const pedirCsv = () => getCsv(new Request('https://likida.ai/api/export/liquidaciones'));
const pedirPdf = () =>
  getPdf(new Request('https://likida.ai/api/export/pdf/liq-1'), { params: Promise.resolve({ id: 'liq-1' }) });

const CHOFER = { userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9' };
const CONTRALOR = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null };

beforeEach(() => {
  getSessionTenant.mockReset();
  supabaseAdmin.mockReset();
  supabaseAdmin.mockImplementation(() => clienteFalso());
});

describe('las rutas de export autorizan por rol, no solo autentican', () => {
  it('el chofer NO baja el CSV de la flota — 403, y sin llegar a consultar la base', async () => {
    getSessionTenant.mockResolvedValue(CHOFER);
    const res = await pedirCsv();
    expect(res.status).toBe(403);
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it('el chofer NO firma la URL del PDF de una liquidación — 403, y sin llegar a consultar la base', async () => {
    getSessionTenant.mockResolvedValue(CHOFER);
    const res = await pedirPdf();
    expect(res.status).toBe(403);
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  // CONTROL. Sin esto, cerrar las dos puertas de golpe pasaría igual y el
  // arnés no habría probado nada: mide que la puerta discrimina por ROL, no
  // que rechaza a todos.
  it('el contralor (flota_admin) sí baja el CSV, con las filas dentro', async () => {
    getSessionTenant.mockResolvedValue(CONTRALOR);
    const res = await pedirCsv();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('V-001');
  });

  it('el contralor (flota_admin) sí obtiene la redirección a la URL firmada del PDF', async () => {
    getSessionTenant.mockResolvedValue(CONTRALOR);
    const res = await pedirPdf();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://storage.example/firmada');
  });

  // El 401 de "sin sesión" ya existía y se conserva: 401 es "no sé quién eres",
  // 403 es "sé quién eres y no te toca". Distinguirlos es lo que hace legible
  // el log del 6-ago si un contralor reporta que no puede exportar.
  it('sin sesión sigue siendo 401, no 403', async () => {
    getSessionTenant.mockResolvedValue(null);
    expect((await pedirCsv()).status).toBe(401);
    expect((await pedirPdf()).status).toBe(401);
  });
});
