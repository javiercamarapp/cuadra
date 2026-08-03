import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO de seguridad (auditoría 10) — `shouldCreateUser:false` solo protegía el
// camino del correo; el botón de Google no tenía equivalente en código.
//
// `signInWithOAuth` no acepta esa bandera. Lo único que impedía que un
// consentimiento de Google creara un `auth.users` real era el interruptor
// «Allow new users to sign up» del proyecto en el dashboard de Supabase — una
// casilla que ninguna prueba mira. Que el OTRO camino se moleste en poner
// `shouldCreateUser:false` dice que está encendido.
//
// Lo que sale de ahí es un JWT con `role=authenticated` firmado por el secreto
// del proyecto: en la app no ve nada (`requireSessionTenant` lo manda a
// /sin-acceso) pero contra PostgREST vale, y queda a merced de que TODAS las
// policies estén bien escritas para un `get_user_tenant_ids()` vacío.
//
// El arreglo se prueba SOBRE LA RUTA REAL (`/auth/callback`), que es el único
// punto por el que pasan los dos caminos — no sobre el helper suelto.
//
// Los dos casos de control son la mitad importante: un contralor con alta tiene
// que entrar (si no, esto sería un candado que cierra el producto entero), y un
// fallo al preguntar NO puede cerrar sesiones buenas.
// ═══════════════════════════════════════════════════════════════════════════

const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const maybeSingle = vi.fn();
const deleteUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
      getUser: (...a: unknown[]) => getUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
  }),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { GET } = await import('@/app/auth/callback/route');
const { NextRequest } = await import('next/server');

const CALLBACK = (dest = '/dashboard') =>
  new NextRequest(`https://app.likida.ai/auth/callback?code=abc123&next=${encodeURIComponent(dest)}`);

beforeEach(() => {
  exchangeCodeForSession.mockReset(); exchangeCodeForSession.mockResolvedValue({ error: null });
  getUser.mockReset(); getUser.mockResolvedValue({ data: { user: { id: 'u-google' } }, error: null });
  signOut.mockReset(); signOut.mockResolvedValue({ error: null });
  deleteUser.mockReset(); deleteUser.mockResolvedValue({ error: null });
  maybeSingle.mockReset();
  logger.warn.mockReset(); logger.error.mockReset();
});

describe('nadie se da de alta solo, tampoco por Google', () => {
  it('un consentimiento de Google sin alta previa no deja sesión ni usuario de Auth', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });   // no hay fila en app_user

    const res = await GET(CALLBACK());

    expect(signOut).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith('u-google');
    expect(res.headers.get('location')).toContain('/sin-acceso');
    expect(res.headers.get('location')).not.toContain('/dashboard');
  });

  it('si el usuario de Auth no se pudo borrar, la sesión igual se cierra y queda escrito', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    deleteUser.mockResolvedValue({ error: { message: 'service unavailable' } });

    await GET(CALLBACK());

    expect(signOut).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('auth.autoregistro_no_revertido', expect.objectContaining({
      userId: 'u-google',
    }));
  });

  // ── CONTROL 1: el candado no puede cerrar el producto ─────────────────────
  it('el contralor que SÍ tiene alta entra a su panel, sin tocarle la sesión', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'u-google' }, error: null });

    const res = await GET(CALLBACK());

    expect(signOut).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('/dashboard');
  });

  // ── CONTROL 2: sin certeza no se revierte ────────────────────────────────
  it('si no se pudo PREGUNTAR si tiene alta, no se le cierra la sesión a nadie', async () => {
    // Un bache de red aquí cerrándole la sesión a un contralor legítimo sería
    // cambiar un problema chico por uno que pasa en la sala el 6-ago. Las
    // puertas de rol siguen mandando a /sin-acceso a quien de verdad no tenga.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });

    const res = await GET(CALLBACK());

    expect(signOut).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(logger.warn).toHaveBeenCalledWith('auth.alta_no_verificable', expect.objectContaining({
      userId: 'u-google',
    }));
  });
});
