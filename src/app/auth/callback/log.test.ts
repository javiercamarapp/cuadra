import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO de la auditoría 10 (operabilidad) — el login que falla sin testigo.
//
// `/auth/callback` es la última puerta del magic link y del consentimiento de
// Google: si algo se rompe aquí, el contralor ve «/login?error=1» y nada más.
// Del lado del servidor no quedaba UNA SOLA LÍNEA:
//
//  · el camino de `error` truthy de `exchangeCodeForSession` caía directo al
//    redirect final, sin log;
//  · el `catch` estaba VACÍO — y un catch vacío no solo se traga el error, le
//    impide además a `onRequestError` (instrumentation) enterarse, así que
//    Sentry tampoco lo veía.
//
// El 6-ago un contralor que no pueda entrar es el peor momento posible para
// que la respuesta a «¿por qué?» sea «no sé, no quedó registrado».
//
// Esta prueba EJECUTA el handler. El auditor de pruebas de esta misma ronda
// mostró que las pruebas que solo leen el fuente dejan pasar 5 de 7
// mutaciones; el caso de control de abajo es lo que impide que ésta se vuelva
// una de ésas.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const exchangeCodeForSession = vi.fn();
const supabaseServer = vi.fn(async () => ({ auth: { exchangeCodeForSession } }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: () => supabaseServer() }));

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { GET } = await import('./route');

/** `NextRequest` real es pesado de construir; el handler solo usa nextUrl y url. */
function pedir(qs: string) {
  const url = new URL(`https://likida.ai/auth/callback${qs}`);
  return GET({ nextUrl: url, url: url.toString() } as never);
}

beforeEach(() => {
  for (const m of [logger.info, logger.warn, logger.error]) m.mockReset();
  exchangeCodeForSession.mockReset();
  getSessionTenant.mockReset();
  getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin' });
});

describe('/auth/callback deja testigo cuando el login falla', () => {
  it('un error del intercambio queda registrado, no solo redirigido', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'code verifier missing', status: 400, code: 'flow_state_not_found' } });
    const res = await pedir('?code=abc123');
    expect(res.headers.get('location')).toContain('/login?error=1');
    expect(logger.error, 'sin esto, el fallo solo existe en el navegador del contralor').toHaveBeenCalled();
  });

  it('una excepción del SDK también queda registrada — el catch no puede ser mudo', async () => {
    exchangeCodeForSession.mockRejectedValue(new Error('fetch failed'));
    const res = await pedir('?code=abc123');
    expect(res.headers.get('location')).toContain('/login?error=1');
    expect(logger.error).toHaveBeenCalled();
  });

  it('llegar sin `code` también se registra: es el síntoma de un link mal formado', async () => {
    const res = await pedir('');
    expect(res.headers.get('location')).toContain('/login?error=1');
    expect(logger.warn).toHaveBeenCalled();
  });

  // CONTROL. Sin él, «registra siempre» pasaría igual y la prueba no mediría
  // nada: un log en el camino feliz es ruido que entierra las señales reales.
  it('el login que SÍ funciona no escribe ningún error', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await pedir('?code=abc123&next=%2Fdashboard');
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // El motivo no puede llevar el correo ni el `code`: el primero es dato
  // personal y el segundo es una credencial de un solo uso.
  it('lo registrado no arrastra el code del magic link', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'boom', status: 500, code: 'x' } });
    await pedir('?code=SECRETO123');
    const escrito = JSON.stringify(logger.error.mock.calls);
    expect(escrito).not.toContain('SECRETO123');
  });
});
