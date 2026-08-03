import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (pruebas) — ESTE ARCHIVO ERA DECORACIÓN.
//
// Leía `page.tsx` con `readFileSync` y hacía `expect(PAGINA).toMatch(/…/)`. El
// auditor rompió LAS TRES propiedades que decía proteger y las tres siguieron
// verdes, porque el TEXTO seguía en el archivo:
//
//   1. `if (!(await dentroDelLimite('login:email')))` → `if (false && …)`.
//      Las cadenas `rateLimit(` y `dentroDelLimite('login:email')` no se
//      movieron. El límite de 10 intentos / 5 min por IP dejó de existir: 500
//      POST desde una IP queman la cuota diaria de SMTP de Supabase y nadie
//      entra al panel el 6-ago, sin un solo error en ningún log.
//   2. `if (!esCorreoSinCuenta(error))` → `if (esCorreoSinCuenta(error))`. Se
//      invierte el sentido: el correo CON cuenta cae en `error=1` y el que no
//      tiene cuenta cae en `enviado=1` — el oráculo de enumeración que este
//      manejo existe para cerrar, reabierto al revés.
//   3. `shouldCreateUser: false` desactivado dejando el literal en el archivo.
//      Cualquier correo tecleado en la caja crea un `auth.users` real, justo lo
//      contrario de la decisión 1 del spec.
//
// La causa estaba escrita en la cabecera anterior: «los server actions viven
// dentro del componente y no se pueden importar sueltos». Ya no viven ahí —
// `login/acciones.ts` los saca sin cambiar una línea de su cuerpo (ninguno
// cerraba sobre nada del componente: leen `next` del `<input type="hidden">`).
// Este archivo ya NO lee texto: EJECUTA los dos actions.
//
// Precedente del idioma: `admin/gate.test.tsx`, `dashboard/acred.tsx`.
// ═══════════════════════════════════════════════════════════════════════════

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp, signInWithOAuth } }),
}));

const rateLimit = vi.fn();
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// `redirect()` de Next LANZA (NEXT_REDIRECT) — el resto de la función no corre.
// Reproducirlo es lo que hace que «rebotó por límite» y «siguió y mandó el
// correo» sean estados distinguibles aquí, igual que en producción.
class Redirigido extends Error {
  constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); }
}
vi.mock('next/navigation', () => ({
  redirect: (d: string) => { throw new Redirigido(d); },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '187.190.1.1' }),
}));

const { entrarConEmail, entrarConGoogle } = await import('./acciones');

/** Corre el action y devuelve a dónde redirigió (siempre redirige). */
async function correr(fn: (f: FormData) => Promise<void>, campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  try {
    await fn(f);
  } catch (e) {
    if (e instanceof Redirigido) return e.destino;
    throw e;
  }
  throw new Error('el action terminó sin redirigir, cosa que nunca hace');
}

beforeEach(() => {
  signInWithOtp.mockReset(); signInWithOtp.mockResolvedValue({ error: null });
  signInWithOAuth.mockReset(); signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/x' }, error: null });
  rateLimit.mockReset(); rateLimit.mockReturnValue(true);
  logger.warn.mockReset(); logger.error.mockReset();
});

describe('nadie se da de alta solo', () => {
  it('el magic link se pide con shouldCreateUser:false', async () => {
    await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ana@innovativos.mx',
      options: expect.objectContaining({ shouldCreateUser: false }),
    }));
  });

  it('y el destino del link se arma contra la lista blanca, no contra el `next` crudo', async () => {
    // Un `next` fuera de los tres paneles se reescribe a /dashboard ANTES de
    // viajar dentro del `emailRedirectTo` del correo.
    await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: 'https://evil.example/panel' });
    const opciones = signInWithOtp.mock.calls[0][0].options as { emailRedirectTo: string };
    expect(opciones.emailRedirectTo).not.toContain('evil.example');
    expect(opciones.emailRedirectTo).toContain(encodeURIComponent('/dashboard'));
  });
});

describe('el límite por IP existe de verdad, no como texto', () => {
  it('cuando el límite se excede NO se llama a Supabase: el correo no sale', async () => {
    // Ésta es la mutación 3 del auditor. Con `if (false && …)`, `signInWithOtp`
    // se llamaba igual: 500 POST desde una IP queman la cuota de SMTP y el
    // 6-ago nadie puede entrar, sin un error en ningún log.
    rateLimit.mockReturnValue(false);
    const destino = await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(signInWithOtp, 'el límite no paró el envío').not.toHaveBeenCalled();
    expect(destino).toContain('error=1');
  });

  it('se cuenta por IP y con la ventana del passcode que reemplaza (10 / 5 min)', async () => {
    await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(rateLimit).toHaveBeenCalledWith('login:email:187.190.1.1', 10, 5 * 60_000);
  });

  it('el camino de Google lleva su propio contador, no el del correo', async () => {
    await correr(entrarConGoogle, { next: '/dashboard' });
    expect(rateLimit).toHaveBeenCalledWith('login:google:187.190.1.1', 10, 5 * 60_000);
  });

  it('y Google también se para en seco al exceder el límite', async () => {
    rateLimit.mockReturnValue(false);
    const destino = await correr(entrarConGoogle, { next: '/dashboard' });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(destino).toContain('error=1');
  });

  // CONTROL. Sin él, un action que rebotara SIEMPRE pasaría las dos de arriba.
  it('dentro del límite sí manda el correo', async () => {
    const destino = await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(signInWithOtp).toHaveBeenCalled();
    expect(destino).toContain('enviado=1');
  });
});

describe('el correo sin cuenta no se distingue del enviado', () => {
  const SIN_CUENTA = [
    { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
    { code: 'signup_disabled', status: 422, message: 'Signups not allowed for this instance' },
    // El `code` solo existe en las versiones nuevas del SDK: si un día llega
    // sin él, fallar a "error" reabriría el oráculo.
    { code: undefined, status: 422, message: 'Signups not allowed for otp' },
  ];

  for (const error of SIN_CUENTA) {
    it(`«${error.code ?? 'sin code'}» cae en enviado=1, igual que un correo real`, async () => {
      // Mutación 4 del auditor: `if (!esCorreoSinCuenta(error))` →
      // `if (esCorreoSinCuenta(error))`. Con ella este caso caía en `error=1` y
      // /login volvía a ser un oráculo para enumerar qué correos son
      // contralores reales — al revés, pero igual de legible.
      signInWithOtp.mockResolvedValue({ error });
      const destino = await correr(entrarConEmail, { email: 'quien@sea.com', next: '/dashboard' });
      expect(destino).toContain('enviado=1');
      expect(destino).not.toContain('error=1');
      expect(logger.error, 'un correo sin cuenta no es un fallo del sistema').not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('login.otp_sin_cuenta', expect.anything());
    });
  }

  // CONTROL, y el otro lado de la misma mutación: un fallo de VERDAD sí sale
  // como error y sí deja testigo (CRÍTICO de operabilidad de esta ronda).
  it('una cuota de SMTP agotada SÍ es error, y queda registrada', async () => {
    signInWithOtp.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' } });
    const destino = await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(destino).toContain('error=1');
    expect(logger.error).toHaveBeenCalledWith('login.otp_error', { code: 'over_email_send_rate_limit', status: 429 });
  });

  it('y lo registrado no arrastra el correo del usuario', async () => {
    signInWithOtp.mockResolvedValue({ error: { code: 'x', status: 500, message: 'boom' } });
    await correr(entrarConEmail, { email: 'ana@innovativos.mx', next: '/dashboard' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('ana@innovativos.mx');
  });
});
