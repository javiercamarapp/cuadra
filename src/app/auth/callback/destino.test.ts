import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (pruebas) — `/auth/callback` con 0 % de líneas.
//
// Ese hallazgo se cerró a medias:
//   · `log.test.ts` (31276b2) ya EJECUTA el handler y ancla quién deja testigo.
//   · `destino.test.ts` de `lib/auth` (cbeccd2) ya prueba `destinoSeguro` a
//     fondo — como función pura.
// Faltaba el CABLEADO, que es donde vivía la mutación del reporte. Verificado
// hoy, antes de escribir esto:
//
//     `const destinoExplicito = next && destinoSeguro(next) === next ? next : null`
//        ->  `const destinoExplicito = next ? next : null`
//     SOBREVIVE: 5/5 pruebas del directorio verdes.
//
// Con esa mutación,
// `…/auth/callback?code=<válido>&next=https://evil.example/panel` hace
// `new URL('https://evil.example/panel', req.url)` y devuelve un redirect
// ABSOLUTO fuera del dominio, INMEDIATAMENTE DESPUÉS de que la sesión quedó en
// las cookies. El contralor abre el magic link que le llegó por correo, el
// login funciona, y aterriza en una copia de Likida ya autenticado.
//
// `destinoSeguro` NO se mockea: lo que se mide es que esta ruta la use.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const exchangeCodeForSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      exchangeCodeForSession,
      getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }) }),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  }),
}));

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { GET } = await import('./route');

/** El magic link SIEMPRE trae un `code` válido en estas pruebas: lo que se
 *  mide es a dónde aterriza la sesión ya creada, no si se crea. */
async function aterrizaEn(qs: string, rol = 'flota_admin'): Promise<string> {
  getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol });
  const url = new URL(`https://likida.ai/auth/callback${qs}`);
  const res = await GET({ nextUrl: url, url: url.toString() } as never);
  return res.headers.get('location') ?? '';
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  getSessionTenant.mockReset();
});

describe('el `next` del magic link pasa por la lista blanca ANTES de convertirse en Location', () => {
  // Lo controla quien manda el link: es entrada no confiable, y a estas alturas
  // del handler la sesión YA está en las cookies.
  const HOSTILES = [
    ['absoluto a otro dominio', 'https://evil.example/panel'],
    ['protocol-relative', '//evil.example/panel'],
    ['prefijo suelto, sin frontera de segmento', '/dashboardevil'],
    ['ruta del sitio que no es panel', '/api/export/liquidaciones'],
  ] as const;

  for (const [caso, next] of HOSTILES) {
    it(`${caso}: aterriza en /dashboard, nunca en el destino pedido`, async () => {
      const destino = await aterrizaEn(`?code=abc123&next=${encodeURIComponent(next)}`);
      expect(destino, 'el redirect salió del dominio con la sesión ya puesta').not.toContain('evil.example');
      expect(new URL(destino).origin).toBe('https://likida.ai');
      expect(new URL(destino).pathname).toBe('/dashboard');
    });
  }

  // CONTROL. Sin él, un handler que mandara TODO a /dashboard pasaría las
  // cuatro de arriba — y ese fue el bug real de la ronda: el chofer que abría
  // /mis-viajes acababa en el panel del contralor.
  it('un destino de panel legítimo se respeta tal cual', async () => {
    expect(new URL(await aterrizaEn('?code=abc123&next=%2Fmis-viajes', 'operador')).pathname).toBe('/mis-viajes');
    expect(new URL(await aterrizaEn('?code=abc123&next=%2Fdashboard%2Fliq-1')).pathname).toBe('/dashboard/liq-1');
  });
});

describe('sin `next` explícito, cada rol aterriza en SU panel', () => {
  it('superadmin va a su consola, no al panel del tenant demo', async () => {
    expect(new URL(await aterrizaEn('?code=abc123', 'superadmin')).pathname).toBe('/admin');
  });

  it('el resto va a /dashboard', async () => {
    expect(new URL(await aterrizaEn('?code=abc123', 'flota_admin')).pathname).toBe('/dashboard');
  });

  it('y un `next` explícito gana sobre el default del rol', async () => {
    // Un link a una liquidación que alguien mandó se respeta para todos los
    // roles: el default solo actúa cuando no hay destino pedido.
    expect(new URL(await aterrizaEn('?code=abc123&next=%2Fdashboard%2Fliq-1', 'superadmin')).pathname)
      .toBe('/dashboard/liq-1');
  });

  it('un `next` hostil NO se cuela por el camino del superadmin', async () => {
    // La lista blanca corre antes del reparto por rol: sin ella, el superadmin
    // habría sido el único que sí viajaba al dominio ajeno.
    const destino = await aterrizaEn('?code=abc123&next=https%3A%2F%2Fevil.example%2Fpanel', 'superadmin');
    expect(destino).not.toContain('evil.example');
    expect(new URL(destino).pathname).toBe('/admin');
  });
});
