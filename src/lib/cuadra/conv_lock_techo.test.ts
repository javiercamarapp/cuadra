import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOPE_CONSULTA_MS } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL MUTEX DEL "LISTO" HACÍA SU RPC SIN TECHO, DENTRO DE UN `for (;;)`.
// (auditoría 10, ALTO — REINCIDENTE del ALTO de la ronda 8)
//
// `acquireViajeLock` construye el cliente UNA vez fuera del bucle
// (`const admin = supabaseAdmin()`) y llamaba `admin.rpc('try_lock_viaje', …)`
// en crudo. Sin `acotada`, esa llamada hereda el default de undici:
// **300 000 ms**. Y el `Date.now() - start >= maxWaitMs` se evalúa DESPUÉS del
// `await`, así que los 12 000 ms de `maxWaitMs` no llegaban a leerse nunca.
//
// La suma: 300 000 ms contra un `maxDuration` de 120 000. Vercel mata la función
// 180 s antes de que el `fetch` se rinda, y lo hace ANTES de que el agente
// arranque: el operador escribió "listo" y no recibe nada — ni resumen, ni PDF,
// ni error —, no hay `logger.error` porque el proceso muere antes del `catch`, y
// Meta ya recibió su 200 así que no reintenta.
//
// Por qué la ronda 9 lo declaró cerrado: el conteo de `tope_consulta.test.ts`
// busca `await supabaseAdmin()`. Aquí el cliente se HOISTEA, así que el patrón
// no aparece y un solo `supabaseAdmin()` contado alimenta un número ilimitado de
// RPC sin techo. Lo que falló fue el método de verificación, no el arreglo — por
// eso esta prueba mide el TIEMPO y no cuenta líneas.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { acquireViajeLock } = await import('./conv');

/** Margen de `acotada` sobre el tope antes de disparar la red de seguridad. */
const GRACIA_TOPE_MS = 1_500;
/** Lo que un intento puede costar como máximo con techo puesto. */
const TECHO_INTENTO_MS = TOPE_CONSULTA_MS + GRACIA_TOPE_MS;   // 9 500

describe('el mutex del viaje tiene techo', () => {
  beforeEach(() => { rpc.mockReset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('un Supabase que acepta y calla NO cuelga la invocación: se rinde cerca de maxWaitMs', async () => {
    // El modo de fallo medido en este repo (`presupuesto.ts:78-82`): el socket se
    // acepta y no contesta nunca. Sin techo esto no resuelve jamás dentro de los
    // 120 s de la función.
    rpc.mockReturnValue(new Promise(() => {}));

    let resuelto: boolean | undefined;
    void acquireViajeLock('v1', { maxWaitMs: 12_000 }).then((v) => { resuelto = v; });

    // A los 12 000 ms —el `maxWaitMs` pedido— todavía puede estar en vuelo el
    // intento que empezó antes del vencimiento: eso es la holgura de UN techo.
    await vi.advanceTimersByTimeAsync(12_000 + TECHO_INTENTO_MS + 2_000);

    // Peor caso con techo: maxWaitMs (12 000) + un intento (9 500) + el backoff
    // = 21 500 ms. Sin techo: 300 000 ms, y `resuelto` sigue `undefined`.
    expect(resuelto).toBe(true);
  });

  it('cada intento del bucle está acotado, no solo el primero', async () => {
    // El cliente se hoistea fuera del `for (;;)`: si el techo se pusiera al
    // construirlo y no a cada llamada, el segundo intento volvería a ser
    // ilimitado.
    rpc.mockReturnValue(new Promise(() => {}));

    let resuelto: boolean | undefined;
    void acquireViajeLock('v1', { maxWaitMs: 30_000 }).then((v) => { resuelto = v; });

    // Con 30 000 ms de ventana y 9 500 por intento hacen falta VARIAS vueltas.
    await vi.advanceTimersByTimeAsync(30_000 + TECHO_INTENTO_MS + 5_000);

    expect(resuelto).toBe(true);
    expect(rpc.mock.calls.length).toBeGreaterThan(1);
  });
});
