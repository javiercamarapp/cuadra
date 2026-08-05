import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · PASE 2 · A11P2-C4 · CRÍTICO — el arranque sonda una función
// que NO EXISTE en este repo, así que los triggers del dinero no se verifican
// NUNCA.
//
// `startup.ts` llama `triggers_desactualizados`, de la migración **0052**.
// `supabase/migrations/` de esta rama llega a la **0047**: la 0052 vive en la
// rama del PR #7, que no está mergeada. Lo introdujo el merge `989ca62`, que
// trajo la prosa del PR #7 sin traer su SQL — la trampa documentada del pase
// 1, esta vez dentro de un `rpc()` y no de un comentario.
//
// Efecto en producción: CADA arranque cae en la rama de error, escribe «falta
// la migración 0052» —una migración que nadie puede aplicar porque no existe
// en el repo—, `startup.migraciones {ok:true}` queda inalcanzable para
// siempre, y los triggers 0036/0037/0042 —«nada entra ni se reescribe tras
// liquidar», el peor bug histórico del camino del dinero— dejan de sondearse.
// El aviso que protege el dinero se convierte en ruido de cada boot.
//
// La suite no lo veía porque `startup_diagnostico.test.ts:280` mockea el RPC
// y afirma que el mensaje dice «0052»: mide que el mensaje esté bien escrito,
// no que la función exista.
//
// El arreglo NO es traer la 0052 (no hay Postgres aquí contra el cual
// ejercerla, y `supabase/migrations/` se dejó intacto a propósito): es que el
// arranque, ante `PGRST202`, caiga a `triggers_faltantes` — la 0043, que SÍ
// está en este repo — y verifique al menos la EXISTENCIA, diciendo que el
// sondeo del cuerpo quedó degradado. Cuando la 0052 llegue, la primera
// llamada funciona y el fallback no se usa.
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

const tabla = (resultado: { error: unknown } = { error: null }) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'eq', 'limit']) enlace[m] = () => enlace;
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return enlace;
};

/** Lo que Supabase responde HOY, con este repo: la 0052 no está aplicada. */
const NO_EXISTE_0052 = {
  error: { code: 'PGRST202', message: 'Could not find the function public.triggers_desactualizados' },
};

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); error.mockReset(); warn.mockReset(); info.mockReset();
  from.mockReturnValue(tabla());
  getBucket.mockReset();
  getBucket.mockResolvedValue({ data: { id: 'comprobantes' }, error: null });
});

/** Todo lo demás sano; solo `triggers_desactualizados` no existe. */
function baseSana(triggersFaltantes: string[] = []) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'triggers_desactualizados') return NO_EXISTE_0052;
    if (fn === 'triggers_faltantes') return { data: triggersFaltantes, error: null };
    return { data: null, error: null };
  });
}

describe('A11P2-C4 · sin la 0052, el arranque sigue verificando los triggers del dinero', () => {
  it('cae a `triggers_faltantes` (0043) en vez de rendirse', async () => {
    baseSana();

    await verificarMigracionesCriticas();

    const llamadas = rpc.mock.calls.map(([f]) => f);
    expect(
      llamadas,
      'ante PGRST202 el arranque se rinde y los triggers 0036/0037/0042 no se sondean en ningún boot',
    ).toContain('triggers_faltantes');
  });

  it('con la 0036 SIN aplicar, lo dice — hoy este boot no se entera', async () => {
    baseSana(['trg_gasto_no_tras_liquidar']);

    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('trg_gasto_no_tras_liquidar');
    expect(mensajes).toContain('0036');
  });

  it('dice que el sondeo quedó DEGRADADO — existencia sí, cuerpo no', async () => {
    baseSana();

    await verificarMigracionesCriticas();

    const todos = [...warn.mock.calls, ...error.mock.calls]
      .map((c) => (c[1] as { msg?: string })?.msg ?? '')
      .join(' | ');
    expect(
      todos,
      'sin decirlo, un boot degradado se lee igual que uno completo',
    ).toMatch(/0052/);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────

  it('CONTROL · con la 0052 aplicada NO se usa el fallback', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'triggers_desactualizados') return { data: [], error: null };
      return { data: null, error: null };
    });

    await verificarMigracionesCriticas();

    expect(rpc.mock.calls.map(([f]) => f)).not.toContain('triggers_faltantes');
  });

  it('CONTROL · un fallo de RED sigue sin reportarse como migración faltante', async () => {
    rpc.mockResolvedValue({ error: { code: '', message: 'TypeError: fetch failed' } });

    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  it('CONTROL · si las dos funciones faltan, se dice y no se inventa un trigger ausente', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'triggers_desactualizados') return NO_EXISTE_0052;
      if (fn === 'triggers_faltantes') {
        return { error: { code: 'PGRST202', message: 'Could not find the function public.triggers_faltantes' } };
      }
      return { data: null, error: null };
    });

    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).not.toContain('trg_gasto_no_tras_liquidar');
  });
});
