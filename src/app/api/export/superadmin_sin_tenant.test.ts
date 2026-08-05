import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · PASE 2 · A11P2-C3 · CRÍTICO — «Descargar PDF» y «Exportar
// CSV» le contestan 401 en texto plano a QUIEN PROYECTA EL DEMO.
//
// `scripts/crear-superadmin.mjs:109` escribe la fila del superadmin con
// `tenant_id: null` — por diseño (0001_init.sql:17): un superadmin no
// pertenece a ninguna flota. Todo el resto del producto lo compensa:
// `guard.ts:34` le da el tenant de la demo en las páginas, y
// `api/dashboard/asistente/route.ts:36-40` hace lo mismo en su ruta.
//
// Las dos rutas de export no. Cortan en `if (!s.tenantId) → 401` ANTES de
// mirar el rol, así que el botón se pinta —`permisos.ts` sí deja pasar a
// superadmin— y al hacer clic sale «No autorizado» en texto plano, en la
// sala, delante del contralor. De tres rutas tocadas por el mismo arreglo,
// una recibió el fallback y dos no.
//
// El fallback NO puede reabrir A11P2-C1: es para superadmin, y el gate de rol
// sigue corriendo después. Los controles de abajo lo fijan.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant }));

// —— CSV ——————————————————————————————————————————————————————————————————
const range = vi.fn(async () => ({
  data: [{
    created_at: '2026-08-01T12:00:00Z',
    total_comprobado: 100, total_anticipo: 100, diferencia: 0,
    estatus: 'cuadrado', diferencias: [],
    viaje: { folio: 'V-0', operador: { nombre: 'Juan' } },
  }], error: null,
}));
const limit = vi.fn(async () => ({ data: [], error: null }));

// —— PDF ——————————————————————————————————————————————————————————————————
const maybeSingle = vi.fn(async () => ({ data: { pdf_url: 't/v.pdf' }, error: null }));
const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: 'https://storage.example/firmada?token=abc' }, error: null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ range, limit }),
          eq: () => ({ maybeSingle }),
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

const { GET: GET_CSV } = await import('./liquidaciones/route');
const { GET: GET_PDF } = await import('./pdf/[id]/route');

const LIQ = '22222222-2222-2222-2222-222222222222';

/** La sesión REAL de Javier: superadmin, `tenant_id` nulo. */
const superadminSinTenant = {
  userId: 'u-super', tenantId: null, rol: 'superadmin',
  nombre: 'Javier', operadorId: null, avatarUrl: null,
};
const conTenant = (rol: string) => ({
  userId: 'u-1', tenantId: '11111111-1111-1111-1111-111111111111', rol,
  nombre: 'X', operadorId: null, avatarUrl: null,
});

let ip = 0;
/** IP distinta por llamada: el rate-limit es por IP y en memoria. */
const cabeceras = () => ({ 'x-forwarded-for': `10.9.0.${++ip}` });
const pedirCsv = () =>
  GET_CSV(new Request('http://localhost/api/export/liquidaciones', { headers: cabeceras() }));
const pedirPdf = () =>
  GET_PDF(
    new Request(`http://localhost/api/export/pdf/${LIQ}`, { headers: cabeceras() }),
    { params: Promise.resolve({ id: LIQ }) },
  );

beforeEach(() => { getSessionTenant.mockReset(); });

describe('A11P2-C3 · el superadmin sin flota propia sí exporta', () => {
  it('CSV · superadmin con tenant_id null NO recibe 401', async () => {
    getSessionTenant.mockResolvedValue(superadminSinTenant);

    const res = await pedirCsv();

    expect(res.status, 'el botón se pinta y al hacer clic sale «No autorizado»').toBe(200);
    expect(await res.text()).toContain('V-0');
  });

  it('PDF · superadmin con tenant_id null NO recibe 401', async () => {
    getSessionTenant.mockResolvedValue(superadminSinTenant);

    const res = await pedirPdf();

    // 302 a la URL firmada ES el camino feliz de esta ruta (`route.ts`, última
    // línea): no devuelve el PDF, devuelve la descarga.
    expect(res.status, 'el botón se pinta y al hacer clic sale «No autorizado»').toBe(302);
    expect(res.headers.get('location')).toContain('storage.example');
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────
  // Sin estos, "dejar pasar a quien no traiga tenant" pasaría las dos de
  // arriba y abriría el panel entero.

  it('CONTROL · sin sesión sigue siendo 401 en las dos', async () => {
    getSessionTenant.mockResolvedValue(null);
    expect((await pedirCsv()).status).toBe(401);
    getSessionTenant.mockResolvedValue(null);
    expect((await pedirPdf()).status).toBe(401);
  });

  it('CONTROL · un rol NO superadmin sin tenant sigue fuera — no se le inventa flota', async () => {
    getSessionTenant.mockResolvedValue({ ...superadminSinTenant, rol: 'flota_admin' });
    expect([401, 403]).toContain((await pedirCsv()).status);
  });

  it('CONTROL · A11P2-C1 sigue cerrado: el ENCARGADO con tenant sigue en 403', async () => {
    getSessionTenant.mockResolvedValue(conTenant('encargado'));
    expect((await pedirCsv()).status).toBe(403);
    getSessionTenant.mockResolvedValue(conTenant('encargado'));
    expect((await pedirPdf()).status).toBe(403);
  });

  it('CONTROL · el CHOFER con tenant sigue en 403', async () => {
    getSessionTenant.mockResolvedValue(conTenant('operador'));
    expect((await pedirCsv()).status).toBe(403);
  });
});
