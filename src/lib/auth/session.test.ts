import { describe, it, expect, vi, beforeEach } from 'vitest';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, from: (...a: unknown[]) => from(...(a as [])) }),
}));

const { getSessionTenant } = await import('./session');

describe('getSessionTenant', () => {
  beforeEach(() => {
    getUser.mockReset(); maybeSingle.mockReset(); eq.mockClear(); select.mockClear(); from.mockClear();
    logger.error.mockReset(); logger.warn.mockReset();
  });

  it('sin usuario autenticado, regresa null', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionTenant()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('con usuario y fila en app_user, regresa tenantId/rol/nombre', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(from).toHaveBeenCalledWith('app_user');
    expect(select).toHaveBeenCalledWith('tenant_id, rol, nombre, operador_id');
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(r).toEqual({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null });
  });

  // ── CRÍTICO de la auditoría 10 (modelo de datos) ──────────────────────────
  //
  // `operador_id` NACE en la migración 0045. Va en el MISMO select que
  // `tenant_id`, así que si la 0045 no está aplicada PostgREST falla la
  // consulta ENTERA: `data` queda null y TODO usuario —el contralor y también
  // el superadmin— sale con `tenantId: null` y aterriza en /sin-acceso, con
  // un texto que le dice que pida su alta. El panel no se ve roto; se ve como
  // si nadie tuviera cuenta, que es el síntoma más caro de diagnosticar que
  // puede tener este producto. Y solo quedaba un `warn`.
  //
  // Un dato del chofer que falta no puede tumbar la sesión de los otros cuatro
  // roles. El chofer sí queda sin `operadorId` —`requireOperador` lo manda a
  // /sin-acceso, que es correcto mientras su RLS no exista— pero el contralor
  // entra a su panel.
  it('si falta la columna de la 0045, el contralor NO se queda fuera del panel', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-9' } } });
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column app_user.operador_id does not exist' } })
      .mockResolvedValueOnce({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(r?.tenantId, 'con la 0045 ausente seguía saliendo null y lo echaba a /sin-acceso').toBe('t-1');
    expect(r?.rol).toBe('flota_admin');
    expect(r?.operadorId, 'el dato del chofer sí falta, y eso es honesto').toBeNull();
    expect(select).toHaveBeenNthCalledWith(2, 'tenant_id, rol, nombre');
  });

  it('y el fallo de esquema se grita, no se susurra: es un despliegue incompleto', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-9' } } });
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column app_user.operador_id does not exist' } })
      .mockResolvedValueOnce({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    await getSessionTenant();
    expect(logger.error).toHaveBeenCalled();
  });

  // CONTROL: un error que NO es de esquema (RLS, permisos, bache) conserva el
  // comportamiento anterior —fallar cerrado con `warn`—, que en la puerta de
  // autorización es lo correcto y no se toca.
  it('un error que no es de esquema sigue fallando cerrado, con warn', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-8' } } });
    maybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table app_user' } });
    const r = await getSessionTenant();
    expect(r?.tenantId).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    expect(select, 'y no reintenta: no hay nada que degradar').toHaveBeenCalledTimes(1);
  });

  it('usuario autenticado sin fila en app_user, tenantId null y valores por defecto', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-2' } } });
    maybeSingle.mockResolvedValue({ data: null });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-2', tenantId: null, rol: 'flota_admin', nombre: null, operadorId: null });
  });

  it('superadmin con fila app_user pero tenant_id null, preserva rol/nombre reales', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-3' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: null, rol: 'superadmin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-3', tenantId: null, rol: 'superadmin', nombre: 'Ana', operadorId: null });
  });

  it('chofer: trae operadorId — la vista /mis-viajes lo necesita para saber qué es "lo suyo"', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-4' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'operador', nombre: 'Juan', operador_id: 'o-9' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-4', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9' });
  });

  // ── ALTO de la auditoría 10 (operabilidad) ────────────────────────────────
  //
  // `auth-js` NO LANZA en el caso más frecuente. `_getUser` atrapa cualquier
  // `isAuthError` y devuelve `{ data: { user: null }, error }`
  // (GoTrueClient.js:2666-2676), y `AuthRetryableFetchError` —lo que produce un
  // `fetch failed`, un timeout o un 5xx del endpoint de auth— ES un AuthError.
  // Como el `error` de esa línea se descartaba, un bache de 800 ms contra
  // Supabase Auth salía por `if (!user) return null`: ni reintento, ni log, y
  // el contralor expulsado a /login a media demo con CERO líneas escritas,
  // indistinguible de "este usuario nunca inició sesión".
  it('un bache de red en auth.getUser NO es "no hay sesión": reintenta y recupera', async () => {
    getUser
      .mockResolvedValueOnce({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' } })
      .mockResolvedValue({ data: { user: { id: 'u-6' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(r?.tenantId, 'el error venía por VALOR de retorno, no lanzado: el for no reintentaba').toBe('t-1');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('y si el bache dura los dos intentos, queda escrito CUÁL fue el fallo', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'fetch failed' } });
    expect(await getSessionTenant()).toBeNull();
    expect(logger.error, 'expulsado a /login sin una sola línea que lo explique').toHaveBeenCalled();
    const msgs = logger.error.mock.calls.map((c) => String(c[0]));
    expect(msgs.join('|')).toContain('session.auth_error');
  });

  // CONTROL: el visitante que simplemente no ha iniciado sesión es el camino
  // NORMAL de esta función, y `auth-js` también lo señala con un error
  // (`AuthSessionMissingError`). Si eso se registrara, cada visita anónima
  // dejaría una línea de error y enterraría la de arriba — que es la que
  // importa a las 3 a.m. Ni log, ni reintento, ni 250 ms de espera.
  it('CONTROL: sin sesión (AuthSessionMissingError) sale callado y sin reintentar', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } });
    expect(await getSessionTenant()).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // CONTROL: y el camino bueno tampoco escribe nada.
  it('CONTROL: la sesión que sí abre no deja rastro de error', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-7' } }, error: null });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'contador', nombre: 'Ana' } });
    expect((await getSessionTenant())?.tenantId).toBe('t-1');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('si Supabase truena las DOS veces, regresa null en vez de lanzar', async () => {
    getUser.mockRejectedValue(new Error('fetch failed'));
    expect(await getSessionTenant()).toBeNull();
  });

  it('si Supabase truena una vez pero se recupera al reintentar, regresa la sesión — no expulsa a alguien recién logueado por un bache', async () => {
    getUser.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue({ data: { user: { id: 'u-5' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'superadmin', nombre: 'Javier' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-5', tenantId: 't-1', rol: 'superadmin', nombre: 'Javier', operadorId: null });
  });
});
