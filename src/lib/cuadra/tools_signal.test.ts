import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — `ctx.signal` LLEGABA A LOS HANDLERS Y NINGUNO LO MIRABA.
//
// `run.ts` construye `ctx.signal` desde el `AbortController` del turno (40s) y
// lo pasa a `makeExecutor`; `grep -n "signal" src/lib/cuadra/tools.ts` estaba
// vacío. Mitigado, no cerrado: todo lo que tocan pasa por `acotada()` con su
// propio `TOPE_CONSULTA_MS`, así que nada se cuelga para siempre. El peor caso
// vigente era el turno agotándose, `generateWithTools` abortando, y una
// `guardar_liquidacion` siguiendo contra su propio reloj — generando dos PDF,
// subiéndolos a Storage y escribiendo la liquidación de un turno que ya nadie
// va a leer.
//
// La rejilla es de ENTRADA y de ANTES DE ESCRIBIR, nunca después: una vez que
// `saveLiquidacion` corrió, abortar no desharía nada y sí convertiría un cierre
// bueno en un error.
// ═══════════════════════════════════════════════════════════════════════════

const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1', totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0, estatus: 'cuadrada',
  totalDeducible: 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  gastos: [{ id: 'g1', concepto: 'caseta', monto: 1000 }],
  diferencias: [],
};

const cuadrarDesdeDB = vi.fn(async () => LIQ);
const saveLiquidacion = vi.fn(async () => 'liq-1');
const getConfig = vi.fn(async () => ({ politica: [] }));
const generarLiquidacionPDF = vi.fn(async () => new Uint8Array([1]));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...(a as [])) }));
vi.mock('./config', () => ({ getConfig: (...a: unknown[]) => getConfig(...(a as [])) }));
vi.mock('./liquidacion/pdf', () => ({ generarLiquidacionPDF: (...a: unknown[]) => generarLiquidacionPDF(...(a as [])) }));
vi.mock('./repo', () => ({
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 1000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Juan', telefono: '52199' })),
  saveLiquidacion: (...a: unknown[]) => saveLiquidacion(...(a as [])),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}));

await import('./tools');
const { executeTool } = await import('@/lib/llm/tool-executor');

const abortada = () => { const ac = new AbortController(); ac.abort(); return ac.signal; };
const CTX = (signal?: AbortSignal) => ({ tenantId: 't1', viajeId: 'v1', operadorId: 'o1', telefono: '52199', signal });

beforeEach(() => { vi.clearAllMocks(); });

describe('los handlers respetan el presupuesto del turno', () => {
  it('con el turno ya agotado, `cuadrar_viaje` no toca la base', async () => {
    const r = await executeTool('cuadrar_viaje', {}, CTX(abortada()));
    expect(r.success).toBe(false);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('`consultar_politica` tampoco', async () => {
    const r = await executeTool('consultar_politica', {}, CTX(abortada()));
    expect(r.success).toBe(false);
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('`guardar_liquidacion` no genera PDF ni escribe la liquidación', async () => {
    const r = await executeTool('guardar_liquidacion', {}, CTX(abortada()));
    expect(r.success).toBe(false);
    expect(generarLiquidacionPDF).not.toHaveBeenCalled();
    expect(saveLiquidacion).not.toHaveBeenCalled();
  });

  it('si el turno se agota MIENTRAS lee, no llega a escribir', async () => {
    const ac = new AbortController();
    cuadrarDesdeDB.mockImplementationOnce(async () => { ac.abort(); return LIQ; });
    const r = await executeTool('guardar_liquidacion', {}, CTX(ac.signal));
    expect(r.success).toBe(false);
    expect(saveLiquidacion, 'escribió el cierre de un turno que ya nadie va a leer').not.toHaveBeenCalled();
  });

  it('sin señal, o con una señal viva, todo corre igual que siempre', async () => {
    expect((await executeTool('cuadrar_viaje', {}, CTX())).success).toBe(true);
    expect((await executeTool('guardar_liquidacion', {}, CTX(new AbortController().signal))).success).toBe(true);
    expect(saveLiquidacion).toHaveBeenCalledTimes(1);
  });
});
