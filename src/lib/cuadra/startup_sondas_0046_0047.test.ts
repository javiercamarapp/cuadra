import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-30 (residual) — el arranque no sondeaba la 0046 ni la 0047.
//
// `grep "0044\|0045\|0046\|0047" startup.ts` devolvía SOLO la 0045. Y el
// orden por default del despliegue es el peligroso: el push a `master`
// redespliega Vercel solo, mientras la migración se aplica a mano. Si el
// deploy llega primero:
//
//   0046 — `getSessionTenant` pide `avatar_url` en el MISMO select que
//   `tenant_id`. PostgREST contesta `42703 column app_user.avatar_url does not
//   exist` y falla la consulta ENTERA: `data` queda null y TODO usuario
//   —el contralor y Javier— sale con `tenantId: null` y aterriza en
//   /sin-acceso con un texto que le dice que pida su alta. Idéntico a la 0045,
//   que sí se sondeaba.
//
//   0047 — sin `pod`, `incidencia` ni `unidad`, las cuatro pantallas nuevas
//   del jefe de tráfico leen contra tablas que no existen. Falla en su turno,
//   no en el arranque.
//
// Y mientras tanto el arranque escribía `{ok:true}`: el semáforo verde con el
// panel cerrado para todos. Esto es exactamente lo que este archivo existe
// para impedir.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
const from = vi.fn();
const getBucket = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from, storage: { getBucket } }) }));

const error = vi.fn();
const warn = vi.fn();
const info = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => error(...a),
    warn: (...a: unknown[]) => warn(...a),
    info: (...a: unknown[]) => info(...a),
  },
}));

const { verificarMigracionesCriticas } = await import('./startup');

const COLUMNA_AUSENTE = { code: '42703', message: 'column does not exist' };
const TABLA_AUSENTE = { code: '42P01', message: 'relation does not exist' };

/**
 * Stub encadenable que responde según la TABLA y la COLUMNA pedidas: los
 * sondeos de la 0045 y la 0046 son los dos `from('app_user')`, y sin mirar el
 * `select` no se pueden distinguir.
 */
function baseCon(falla: (tabla: string, cols: string) => unknown) {
  from.mockImplementation((tabla: string) => {
    const enlace: Record<string, unknown> = {};
    let cols = '';
    enlace.select = (c?: string) => { cols = c ?? ''; return enlace; };
    for (const m of ['not', 'eq', 'limit']) enlace[m] = () => enlace;
    enlace.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ error: falla(tabla, cols) ?? null }).then(r);
    return enlace;
  });
}

const lineas = () => error.mock.calls.map((c) => JSON.stringify(c)).join('\n');

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); error.mockReset(); warn.mockReset(); info.mockReset();
  rpc.mockResolvedValue({ error: null });
  getBucket.mockReset();
  getBucket.mockResolvedValue({ data: { id: 'comprobantes' }, error: null });
  baseCon(() => null);
});

describe('G-30 · el arranque sonda la 0046 (app_user.avatar_url)', () => {
  it('sin la columna, GRITA — no arranca en verde con el panel cerrado para todos', async () => {
    baseCon((tabla, cols) => (tabla === 'app_user' && cols.includes('avatar_url') ? COLUMNA_AUSENTE : null));

    await verificarMigracionesCriticas();

    expect(error, 'el deploy llegó antes que la migración y el arranque dijo ok:true').toHaveBeenCalled();
    expect(lineas()).toContain('0046');
  });

  it('el aviso dice el síntoma que se va a reportar: "nadie tiene alta"', async () => {
    // Sin esto, lo que llega a soporte es "no me deja entrar" y se busca en
    // Auth, que es donde NO está.
    baseCon((tabla, cols) => (tabla === 'app_user' && cols.includes('avatar_url') ? COLUMNA_AUSENTE : null));

    await verificarMigracionesCriticas();

    expect(lineas()).toMatch(/sin-acceso|alta/i);
  });

  it('CONTROL · con la columna puesta no dice nada de la 0046', async () => {
    await verificarMigracionesCriticas();

    expect(lineas()).not.toContain('0046');
  });
});

describe('G-30 · el arranque sonda la 0047 (las tablas del jefe de tráfico)', () => {
  it('sin la tabla `pod`, GRITA', async () => {
    baseCon((tabla) => (tabla === 'pod' ? TABLA_AUSENTE : null));

    await verificarMigracionesCriticas();

    expect(error).toHaveBeenCalled();
    expect(lineas()).toContain('0047');
  });

  it('CONTROL · con las tablas puestas no dice nada de la 0047', async () => {
    await verificarMigracionesCriticas();

    expect(lineas()).not.toContain('0047');
  });

  it('un fallo de RED sobre las sondas nuevas no se reporta como migración faltante', async () => {
    // El defecto que `startup_diagnostico.test.ts` fijó para las viejas: tratar
    // cualquier error como "falta la migración" convierte el aviso que protege
    // el dinero en uno que se aprende a ignorar.
    baseCon(() => ({ code: '', message: 'TypeError: fetch failed' }));

    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });
});
