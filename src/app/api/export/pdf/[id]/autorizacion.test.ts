import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-24 · CRÍTICO — el PDF de la liquidación AUTENTICABA sin
// AUTORIZAR.
//
// El único `if` preguntaba "¿hay sesión y tiene tenant?". El CSV hermano
// (`/api/export/liquidaciones`) entregaba la lista de `id`s a cualquiera con
// sesión, y con cualquiera de esos `id` esta ruta firmaba una URL de descarga
// del ejemplar DEL CONTRALOR — el que lleva los veredictos y el que se archiva.
//
// `/api` está fuera del matcher del proxy (`proxy.ts:81`) y `admin.storage`
// corre con service-role: esta línea ERA la única puerta.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant }));

const maybeSingle = vi.fn(async () => ({ data: { pdf_url: 't/v.pdf' }, error: null }));
const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: 'https://storage.example/firmada?token=abc' }, error: null,
}));
const supabaseAdmin = vi.fn(() => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
  storage: { from: () => ({ createSignedUrl }) },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

const { GET } = await import('./route');

const TENANT = '11111111-1111-1111-1111-111111111111';
const LIQ = '22222222-2222-2222-2222-222222222222';
const sesion = (rol: string) => ({
  userId: 'u-1', tenantId: TENANT, rol, nombre: 'X', operadorId: null, avatarUrl: null,
});

let ip = 0;
const pedir = () =>
  GET(
    new Request(`http://localhost/api/export/pdf/${LIQ}`, {
      headers: { 'x-forwarded-for': `10.1.0.${++ip}` },
    }),
    { params: Promise.resolve({ id: LIQ }) },
  );

beforeEach(() => {
  getSessionTenant.mockReset();
  maybeSingle.mockClear(); createSignedUrl.mockClear();
});

describe('G-24 · el PDF del contralor no se firma para quien no puede exportar', () => {
  it('el CHOFER con sesión NO se lleva la URL firmada', async () => {
    getSessionTenant.mockResolvedValue(sesion('operador'));

    const res = await pedir();

    expect(res.status, 'un operador con sesión firmó el PDF del contralor').toBe(403);
    expect(res.headers.get('location'), 'salió una URL firmada de todos modos').toBeNull();
  });

  it('un rol que nadie clasificó tampoco — fail closed', async () => {
    getSessionTenant.mockResolvedValue(sesion('gerente_regional'));

    expect((await pedir()).status).toBe(403);
  });

  it('no se lee la liquidación ni se firma nada: se corta antes de tocar storage', async () => {
    getSessionTenant.mockResolvedValue(sesion('operador'));

    await pedir();

    expect(maybeSingle).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('sin sesión sigue siendo 401', async () => {
    getSessionTenant.mockResolvedValue(null);

    expect((await pedir()).status).toBe(401);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────

  it('CONTROL · el CONTADOR sí recibe la URL firmada', async () => {
    getSessionTenant.mockResolvedValue(sesion('contador'));

    const res = await pedir();

    expect(res.status).toBe(302);
    expect(createSignedUrl).toHaveBeenCalled();
  });

  it('CONTROL · el DUEÑO sí', async () => {
    getSessionTenant.mockResolvedValue(sesion('flota_admin'));

    expect((await pedir()).status).toBe(302);
  });
});
