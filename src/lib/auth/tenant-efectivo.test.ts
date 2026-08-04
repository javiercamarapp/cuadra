import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-50 · ALTO — el único chokepoint de autorización de las 20
// páginas de /dashboard no tenía UNA SOLA prueba.
//
// `visibilidad.ts` —la tabla PURA que decide quién ve qué— tiene 83 pruebas.
// El único sitio donde esa tabla se APLICA (esta función) tenía cero. El
// auditor de pruebas lo midió: dejó `tenant-efectivo.ts:55` como
// `if (false && !puedeVerRuta(…))` en el árbol de trabajo y `vitest`, `tsc` y
// `eslint` salieron los tres VERDES —`eslint` no marca los identificadores
// como sin usar porque siguen citados en la rama muerta, y
// `no-constant-condition` no mira el operando izquierdo de un `&&`—. Cualquier
// resolución de merge podía borrar el gate y desplegarlo en verde.
//
// Este archivo cubre las TRES decisiones de la función, cada una con su
// control (sin el control, "redirigir siempre" pasaría y no probaría nada):
//
//   1. ¿esta PANTALLA existe para este rol?      → `puedeVerRuta` + `inicioDe`
//   2. superadmin en la RAÍZ sin destino          → /admin, que es SU consola
//   3. ¿quién puede saltar de flota con `?tenant=`? → SOLO superadmin
//
// La (3) es el mutante más caro: `if (sesionReal.rol === 'superadmin' &&
// sp?.tenant)` → `if (sp?.tenant)` deja que cualquier `flota_admin` teclee
// `?tenant=<otra-flota>` y lea el panel de un competidor. La suite entera
// seguía verde con ese cambio.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn((destino: string) => { throw new Error(`NEXT_REDIRECT:${destino}`); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [string])) }));

const requireSessionTenant = vi.fn();
vi.mock('./guard', () => ({ requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a) }));

// La flota que un superadmin pide con `?tenant=`. Si esta consulta se ejecuta
// para alguien que no es superadmin, la prueba de arriba lo caza.
type Respuesta = { data: { id: string; nombre: string } | null; error: { message: string } | null };
const maybeSingle = vi.fn(
  async (): Promise<Respuesta> => ({ data: { id: 'flota-b', nombre: 'Transportes B' }, error: null }),
);
const eq = vi.fn(() => ({ maybeSingle }));
const supabaseAdmin = vi.fn(() => ({ from: () => ({ select: () => ({ eq }) }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { resolverTenantEfectivo, resolverTenantDeAction } = await import('./tenant-efectivo');

const sesion = (rol: string, tenantId = 'flota-a') => ({
  userId: 'u-1', tenantId, rol, nombre: 'X', operadorId: null, avatarUrl: null,
});

beforeEach(() => {
  redirect.mockClear();
  requireSessionTenant.mockReset();
  maybeSingle.mockClear(); eq.mockClear();
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
});

// ── DECISIÓN 1 · ¿esta pantalla existe para este rol? ──────────────────────

describe('G-50 · el gate de PANTALLA por rol', () => {
  it('el ENCARGADO no entra a /dashboard/rentabilidad — se le rebota a su inicio', async () => {
    requireSessionTenant.mockResolvedValue(sesion('encargado'));

    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', undefined),
      'el jefe de tráfico entró al margen de la flota',
    ).rejects.toThrow('NEXT_REDIRECT');

    // `inicioDe('encargado')` = /dashboard, que para él SÍ es de 'operacion'.
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('el CONTADOR no entra a /dashboard/despacho — no es su trabajo asignar viajes', async () => {
    requireSessionTenant.mockResolvedValue(sesion('contador'));

    await expect(resolverTenantEfectivo('/dashboard/despacho', undefined)).rejects.toThrow('NEXT_REDIRECT');
    // Y NO a /dashboard, que es de 'operacion' y lo rebotaría en bucle.
    expect(redirect).toHaveBeenCalledWith('/dashboard/cuadre');
  });

  it('una ruta que nadie clasificó se niega — fail closed, incluso al dueño', async () => {
    requireSessionTenant.mockResolvedValue(sesion('flota_admin'));

    await expect(resolverTenantEfectivo('/dashboard/pantalla-nueva', undefined)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('el gate corre ANTES de tocar la base: no se resuelve la flota de quien no entra', async () => {
    requireSessionTenant.mockResolvedValue(sesion('encargado'));

    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', { tenant: 'flota-b' }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(maybeSingle).not.toHaveBeenCalled();
  });

  // CONTROL — sin esto, "redirigir siempre" pasaría las cuatro de arriba.
  it('CONTROL · el ENCARGADO sí entra a /dashboard/despacho, que es lo suyo', async () => {
    requireSessionTenant.mockResolvedValue(sesion('encargado'));

    const r = await resolverTenantEfectivo('/dashboard/despacho', undefined);

    expect(redirect).not.toHaveBeenCalled();
    expect(r.tenantId).toBe('flota-a');
    expect(r.rol).toBe('encargado');
  });

  it('CONTROL · el CONTADOR sí entra a /dashboard/cuadre', async () => {
    requireSessionTenant.mockResolvedValue(sesion('contador'));

    await expect(resolverTenantEfectivo('/dashboard/cuadre', undefined)).resolves.toMatchObject({ rol: 'contador' });
  });
});

// ── DECISIÓN 2 · "ver como otro rol" solo QUITA, y solo al superadmin ──────

describe('G-50 · `?rol=` es una previsualización del superadmin, no un ascenso', () => {
  it('un ENCARGADO con `?rol=flota_admin` NO gana la pantalla del dinero', async () => {
    requireSessionTenant.mockResolvedValue(sesion('encargado'));

    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', { rol: 'flota_admin' }),
      'un jefe de tráfico se ascendió a dueño tecleando ?rol= en la URL',
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('un CONTADOR con `?rol=superadmin` sigue siendo contador', async () => {
    requireSessionTenant.mockResolvedValue(sesion('contador'));

    const r = await resolverTenantEfectivo('/dashboard/cuadre', { rol: 'superadmin' });

    expect(r.rol).toBe('contador');
  });

  it('CONTROL · el SUPERADMIN con `?rol=encargado` sí pierde el dinero — para eso existe', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', { rol: 'encargado' }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('CONTROL · el SUPERADMIN sin `?rol=` sí ve el dinero', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', undefined),
    ).resolves.toMatchObject({ rol: 'superadmin' });
  });
});

// ── DECISIÓN 3 · quién puede saltar de flota con `?tenant=` ────────────────

describe('G-50 · `?tenant=` NO es una puerta entre flotas', () => {
  it('un FLOTA_ADMIN con `?tenant=<otra-flota>` se queda en la SUYA', async () => {
    requireSessionTenant.mockResolvedValue(sesion('flota_admin', 'flota-a'));

    const r = await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' });

    expect(r.tenantId, 'el dueño de una flota leyó el panel de otra tecleando ?tenant=').toBe('flota-a');
    expect(r.tenantNombre).toBeNull();
    expect(maybeSingle, 'se consultó la flota ajena aunque no se fuera a usar').not.toHaveBeenCalled();
  });

  it('un CONTADOR con `?tenant=<otra-flota>` tampoco', async () => {
    requireSessionTenant.mockResolvedValue(sesion('contador', 'flota-a'));

    expect((await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' })).tenantId).toBe('flota-a');
  });

  it('un superadmin PREVISUALIZANDO como flota_admin sigue pudiendo cambiar de flota — manda la sesión REAL', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    const r = await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b', rol: 'flota_admin' });

    expect(r.tenantId).toBe('flota-b');
    expect(r.rol).toBe('flota_admin');
  });

  // CONTROL — sin esto, "ignorar ?tenant= siempre" pasaría las de arriba y
  // rompería "Ver dashboard" de /admin/flotas sin que la suite dijera nada.
  it('CONTROL · el SUPERADMIN sí cambia de flota, y se le pinta el badge con el nombre', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    const r = await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' });

    expect(r.tenantId).toBe('flota-b');
    expect(r.tenantNombre).toBe('Transportes B');
    expect(eq).toHaveBeenCalledWith('id', 'flota-b');
  });

  it('un `?tenant=` que no resuelve deja el tenant de la sesión, no uno vacío', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const r = await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'no-existe' });

    expect(r.tenantId).toBe('demo');
    expect(r.tenantNombre).toBeNull();
  });
});

// ── DECISIÓN 4 · la raíz es SU consola, no la de un cliente ────────────────

describe('G-50 · el superadmin que aterriza en /dashboard sin destino va a /admin', () => {
  it('sin `?tenant=`, `?vista=demo` ni `?rol=`, se rebota a /admin', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await expect(
      resolverTenantEfectivo('/dashboard', undefined, { esRaiz: true }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it('con `?vista=demo` se queda: pidió ver el panel del cliente', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await expect(
      resolverTenantEfectivo('/dashboard', { vista: 'demo' }, { esRaiz: true }),
    ).resolves.toMatchObject({ tenantId: 'demo' });
  });

  it('en una SUBPÁGINA nunca rebota, aunque llegue sin nada', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await expect(resolverTenantEfectivo('/dashboard/cuadre', undefined)).resolves.toMatchObject({ rol: 'superadmin' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('CONTROL · el DUEÑO en la raíz NO se va a /admin — es su panel', async () => {
    requireSessionTenant.mockResolvedValue(sesion('flota_admin'));

    await expect(
      resolverTenantEfectivo('/dashboard', undefined, { esRaiz: true }),
    ).resolves.toMatchObject({ tenantId: 'flota-a' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-34 · ALTO — la suplantación de tenant no dejaba una línea,
// y si la consulta fallaba cambiaba de flota EN SILENCIO.
//
// `const { data } = await supabaseAdmin()…` descarta el `error`: es el patrón
// que `pg.ts:9-21` llama «la familia de bugs más repetida del repo» y que
// `exigir()` existe para cerrar. Con un 503 transitorio, `data` es null, el
// `if` no entra, y la función devuelve el tenant de la SESIÓN — que para un
// superadmin es el DEMO. Cuatro de las ocho copias vivían dentro de server
// actions que ESCRIBEN: el viaje que Javier crea delante del contralor
// aterrizaba en el tenant demo con la píldora verde diciendo "Viaje creado".
//
// Y `grep "logger\." src/lib/auth/` no devolvía una sola línea de este archivo,
// así que a «¿quién de ustedes vio mis liquidaciones el martes?» no había
// respuesta.
// ═══════════════════════════════════════════════════════════════════════════

describe('G-34 · si la consulta del tenant falla, NO se cambia de flota en silencio', () => {
  it('un 503 al resolver `?tenant=` LANZA — no cae al tenant de la sesión', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } });

    await expect(
      resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' }),
      'la lectura falló y la página se sirvió con el tenant DEMO como si nada',
    ).rejects.toThrow(/fetch failed/);
  });

  it('y el motivo queda escrito', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } });

    await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' }).catch(() => {});

    expect(logger.error).toHaveBeenCalled();
  });

  it('la suplantación que SÍ ocurre deja rastro: quién, qué flota, qué ruta', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    await resolverTenantEfectivo('/dashboard/cuadre', { tenant: 'flota-b' });

    expect(logger.info, 'nadie puede contestar "¿quién vio mis liquidaciones?"').toHaveBeenCalled();
    const [msg, meta] = logger.info.mock.calls.at(-1)!;
    expect(msg).toMatch(/tenant/);
    expect(meta).toMatchObject({ userId: 'u-1', tenant: 'flota-b', ruta: '/dashboard/cuadre' });
  });

  it('el camino normal NO escribe nada: una línea por página sería ruido', async () => {
    requireSessionTenant.mockResolvedValue(sesion('flota_admin'));

    await resolverTenantEfectivo('/dashboard/cuadre', undefined);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ── `resolverTenantDeAction` — la copia que vivía ocho veces ───────────────
//
// Cuatro de las ocho copias están dentro de server actions que ESCRIBEN. Un
// action es un endpoint con su propia petición: el `tenantId` capturado por el
// closure viene del render, no de quien hizo clic, así que hay que resolverlo
// otra vez. Esta es la versión única, con `exigir()` y con log.

describe('G-34 · resolverTenantDeAction', () => {
  it('un fallo de lectura LANZA — la escritura no aterriza en otra flota', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: '503' } });

    await expect(
      resolverTenantDeAction('/dashboard/despacho', { tenant: 'flota-b' }),
      'el viaje se habría creado en el tenant DEMO con la píldora verde',
    ).rejects.toThrow(/503/);
  });

  it('un FLOTA_ADMIN con `?tenant=` escribe en la SUYA', async () => {
    requireSessionTenant.mockResolvedValue(sesion('flota_admin', 'flota-a'));

    expect(await resolverTenantDeAction('/dashboard/despacho', { tenant: 'flota-b' })).toBe('flota-a');
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('CONTROL · el SUPERADMIN sí escribe en la flota que eligió', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    expect(await resolverTenantDeAction('/dashboard/despacho', { tenant: 'flota-b' })).toBe('flota-b');
  });

  it('CONTROL · sin `?tenant=` devuelve el de la sesión, sin consultar nada', async () => {
    requireSessionTenant.mockResolvedValue(sesion('superadmin', 'demo'));

    expect(await resolverTenantDeAction('/dashboard/despacho', undefined)).toBe('demo');
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('pasa el `destino` a la guarda: un action sin sesión rebota a SU pantalla', async () => {
    requireSessionTenant.mockImplementation(async () => { throw new Error('NEXT_REDIRECT'); });

    await expect(resolverTenantDeAction('/dashboard/pod', undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(requireSessionTenant).toHaveBeenCalledWith('/dashboard/pod');
  });
});
