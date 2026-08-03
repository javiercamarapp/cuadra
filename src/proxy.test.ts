import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// REVISIÓN FINAL de la rama de auth — las cookies del refresh NO se pierden en
// el camino a /login.
//
// `getUser()` puede pedir escribir cookies ANTES de contestar que no hay
// sesión: es lo que hace el SDK cuando el refresh token está muerto (manda
// borrarla). Esas escrituras van a `res` vía `setAll`, y el redirect a /login
// es OTRO objeto de respuesta. Sin copiarlas, el navegador nunca recibe el
// borrado y sigue mandando la cookie muerta: cada petición paga un refresh
// fallido para acabar, otra vez, en este mismo redirect.
// ═══════════════════════════════════════════════════════════════════════════

type Cb = { getAll: () => unknown[]; setAll: (l: { name: string; value: string; options?: object }[]) => void };
let cookiesCb: Cb;
let usuario: { id: string } | null = null;
let errorAuth: { name?: string; status?: number; message: string } | null = null;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: Cb }) => {
    cookiesCb = opts.cookies;
    return {
      auth: {
        getUser: async () => {
          // El SDK manda borrar la cookie muerta ANTES de contestar.
          cookiesCb.setAll([{ name: 'sb-proyecto-auth-token', value: '', options: { path: '/', maxAge: 0 } }]);
          return { data: { user: usuario }, error: errorAuth };
        },
      },
    };
  },
}));

const { NextRequest } = await import('next/server');
const { proxy } = await import('./proxy');

function pedir(path: string) {
  const req = new NextRequest(`https://likidaai.vercel.app${path}`);
  req.cookies.set('sb-proyecto-auth-token', 'token-muerto');
  return proxy(req);
}

describe('proxy · gate de /dashboard sin sesión', () => {
  beforeEach(() => { usuario = null; errorAuth = null; logger.warn.mockReset(); logger.error.mockReset(); });

  it('redirige a /login conservando el destino', async () => {
    const res = await pedir('/dashboard');
    const destino = new URL(res.headers.get('location')!);
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('next')).toBe('/dashboard');
  });

  it('el redirect ARRASTRA las cookies que Supabase escribió durante getUser', async () => {
    const res = await pedir('/dashboard');
    expect(res.cookies.get('sb-proyecto-auth-token')?.value).toBe('');
  });

  it('el redirect sigue llevando las cabeceras de seguridad', async () => {
    const res = await pedir('/dashboard');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('con sesión no redirige y el panel no se cachea', async () => {
    usuario = { id: 'u-1' };
    const res = await pedir('/dashboard');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  // CRÍTICO de la auditoría 10 (pruebas): `/admin` estaba en la lista del
  // matcher y NADA lo anclaba — borrarlo de `proxy.ts:44` dejaba la suite
  // entera en verde. Es la consola de negocio de Likida (cuántos tenants,
  // cuánto se gasta en IA); su primera capa no puede depender de que nadie
  // toque esa línea por accidente.
  it('/admin (consola de negocio) pasa por el mismo gate de sesión', async () => {
    const res = await pedir('/admin');
    expect(res.status).toBe(307);
    const destino = new URL(res.headers.get('location')!);
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('next')).toBe('/admin');
  });

  it('una página interna de /admin tampoco se sirve sin sesión', async () => {
    const res = await pedir('/admin/costos-facturacion');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('/mis-viajes (panel del chofer) pasa por el mismo gate que /dashboard', async () => {
    const res = await pedir('/mis-viajes');
    const destino = new URL(res.headers.get('location')!);
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('next')).toBe('/mis-viajes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (operabilidad) — la primera capa del gate corre en el
// 100% del tráfico del panel y NO importaba el logger en ninguna línea.
//
// Escenario: rotación de la anon key, o 30 s de caída del endpoint de auth de
// Supabase. `getUser()` devuelve `{ user: null, error }` —por VALOR, no
// lanzado (GoTrueClient.js:2666-2676)—, entra el `if (!user)` y cada petición
// se contesta con un 307 a /login. Lo que se escribía: cero líneas. Y como no
// se lanza, `onRequestError` tampoco se dispara; peor, el middleware corre en
// el runtime EDGE, donde `register()` retorna de inmediato y ningún aviso de
// arranque existe. Si el 6-ago el panel "no abre", el primer sitio donde mirar
// era el único sin huella.
// ═══════════════════════════════════════════════════════════════════════════
describe('proxy · el gate deja testigo cuando rebota por un fallo, no por falta de sesión', () => {
  beforeEach(() => { usuario = null; errorAuth = null; logger.warn.mockReset(); logger.error.mockReset(); });

  it('un fallo del endpoint de auth queda escrito, y con la RUTA que se rebotó', async () => {
    errorAuth = { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' };
    const res = await pedir('/dashboard');
    expect(res.status, 'sigue fallando cerrado').toBe(307);
    expect(logger.error, 'el gate rebotó a todos y no escribió una línea').toHaveBeenCalled();
    const [msg, meta] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe('proxy.auth_error');
    expect(meta.ruta, 'un log que no dice QUÉ ruta se rebotó no sirve a las 3 a.m.').toBe('/dashboard');
    expect(String(meta.err)).toContain('fetch failed');
  });

  it('también en /admin y en /mis-viajes, que son el mismo gate', async () => {
    errorAuth = { name: 'AuthRetryableFetchError', status: 503, message: 'service unavailable' };
    await pedir('/admin');
    await pedir('/mis-viajes');
    const rutas = logger.error.mock.calls.map((c) => (c[1] as Record<string, unknown>).ruta);
    expect(rutas).toEqual(['/admin', '/mis-viajes']);
  });

  // CONTROL 1: el visitante que simplemente no ha iniciado sesión es el caso
  // NORMAL de esta capa —cualquier bot que toque /dashboard cae aquí—. Si
  // dejara línea, el log del panel sería ruido y la línea de arriba, la que
  // importa, se perdería dentro.
  it('CONTROL: sin sesión y sin fallo, el redirect a /login NO escribe nada', async () => {
    const res = await pedir('/dashboard');
    expect(res.status).toBe(307);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('CONTROL: la sesión caducada (4xx de GoTrue) tampoco es un incidente', async () => {
    errorAuth = { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' };
    await pedir('/dashboard');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // CONTROL 2: y el camino feliz —el contralor con su sesión buena, que son
  // TODAS las peticiones de una demo que va bien— tampoco.
  it('CONTROL: con sesión válida el gate no escribe nada', async () => {
    usuario = { id: 'u-1' };
    await pedir('/dashboard');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // CONTROL 3: y una ruta fuera del matcher del gate ni siquiera lo consulta.
  it('CONTROL: una ruta pública no pasa por el gate ni lo registra', async () => {
    errorAuth = { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' };
    await pedir('/login');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
