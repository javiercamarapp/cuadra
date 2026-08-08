import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 17 · CRÍTICO (operabilidad) — el sondeo de arranque soltaba el
// mutex de un viaje que podía estar EN CURSO.
//
// `unlock_viaje` (migración 0005) es un `delete from viaje_lock where
// viaje_id = p_viaje` a secas: NO lleva token de dueño, así que quien lo llama
// libera el lease sea suyo o no.
//
// El probe de la 0005 toma un viaje REAL (`select id ... limit 1`) y hace
// `try_lock_viaje(viaje, ttl=1ms)`. Si otra invocación está liquidando ese
// mismo viaje, el lease sigue vigente y la función devuelve **false** — no un
// error, así que el `if (error)` de arriba no dispara y nada se reporta. Acto
// seguido el probe llamaba `unlock_viaje` INCONDICIONALMENTE y borraba el lock
// ajeno.
//
// Entra: un arranque en frío (cualquier despliegue, o un lambda nuevo por
// escalado) mientras el viaje v-en-curso está siendo liquidado. Sale: el lock
// desaparece, el siguiente mensaje del mismo lote adquiere el lease y entra a
// liquidar en paralelo — que es exactamente la doble liquidación que la
// migración 0005 existe para impedir.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from }) }));

const error = vi.fn();
const warn = vi.fn();
const info = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error: (...a: unknown[]) => error(...a), warn: (...a: unknown[]) => warn(...a), info: (...a: unknown[]) => info(...a) } }));

const { verificarMigracionesCriticas } = await import('./startup');

const tabla = (resultado: { error: unknown; data?: unknown } = { error: null }) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'eq', 'limit']) enlace[m] = () => enlace;
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return enlace;
};
const okTabla = tabla({ data: [{ id: 'v-en-curso' }], error: null });

/** Las llamadas a `unlock_viaje`, con el viaje que se pidió liberar. */
const desbloqueos = () => rpc.mock.calls.filter((c) => c[0] === 'unlock_viaje').map((c) => c[1]);

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); error.mockReset(); warn.mockReset(); info.mockReset();
  from.mockReturnValue(okTabla);
});

describe('el sondeo del mutex no libera un lock que no es suyo', () => {
  it('si el lease es de otra invocación (try_lock=false), NO llama unlock_viaje', async () => {
    rpc.mockImplementation(async (fn: string) => {
      // `false` = otro proceso tiene el lease vigente. NO es un error.
      if (fn === 'try_lock_viaje') return { data: false, error: null };
      return { data: null, error: null };
    });

    await verificarMigracionesCriticas();

    expect(desbloqueos()).toHaveLength(0);
  });

  it('y tampoco lo reporta como migración faltante: `false` es respuesta válida', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'try_lock_viaje') return { data: false, error: null };
      return { data: null, error: null };
    });

    await verificarMigracionesCriticas();

    const dichos = error.mock.calls.map((c) => JSON.stringify(c));
    expect(dichos.filter((d) => d.includes('0005'))).toHaveLength(0);
  });

  // CONTROL: cuando el lock SÍ se adquirió, hay que soltarlo — si no, el probe
  // deja bloqueado un viaje real durante todo el TTL en cada arranque.
  it('si el lock SÍ se adquirió (try_lock=true), lo suelta', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'try_lock_viaje') return { data: true, error: null };
      return { data: null, error: null };
    });

    await verificarMigracionesCriticas();

    expect(desbloqueos()).toEqual([{ p_viaje: 'v-en-curso' }]);
  });
});
