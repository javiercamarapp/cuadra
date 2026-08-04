import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO — `guardar_liquidacion` devolvía 15.6 KB al modelo para
// que usara 132 bytes, con los RFC, UUID y rutas de foto de cada comprobante.
//
// El snapshot TIENE que viajar: `guardiaCifras` lo reusa para no recalcular y
// narrar dos cuadres distintos del mismo cierre (las fotos entrantes no toman
// mutex). Lo que estaba mal es que viajara por el MISMO canal que alimenta al
// modelo.
//
// Costo: ~4,000 tokens extra en el prompt de cada ronda posterior al cierre, a
// $2/1M de entrada de Sonnet 5 son ~$0.008 por ronda — 16-27% del objetivo de
// $0.03-0.05 por liquidación que declara `models.ts`. Minimización: 12 RFC de
// emisor, 12 de receptor, 12 UUID y 12 rutas de foto salen al proveedor sin que
// nadie los lea (ZDR no es minimización; `models.ts` fija las dos).
//
// Esta prueba fija la medida con 12 comprobantes como los que `repo.ts` lee de
// verdad.
// ═══════════════════════════════════════════════════════════════════════════

const GASTOS = Array.from({ length: 12 }, (_, i) => ({
  id: `2f7a1b3c-0000-4000-8000-00000000${String(i).padStart(4, '0')}`,
  concepto: 'diesel' as const,
  monto: 1200.5 + i,
  fecha: '2026-08-01',
  folio: `A-${100000 + i}`,
  folioNorm: `A${100000 + i}`,
  rfcEmisor: 'CCO8605231N4',
  rfcReceptor: 'TFL010203AB9',
  cfdiUuid: `11111111-2222-3333-4444-5555555${String(i).padStart(5, '0')}`,
  imagenUrl: `t1/v1/comprobante-${i}-4f3a9c1b8e2d.jpg`,
  imgHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  iepsTraslado: 320.15,
  ivaTraslado: 192.08,
  ocrConfianza: 0.94,
  estadoSat: 'vigente' as const,
  ocrExtra: { estacion: 'Estación Km 42 Autopista', litros: 55.3, webId: 'WB-99887766', producto: 'DIESEL', fechaRaw: '01/08/2026 14:22', codigoBarras: '9081726354' },
}));

const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1', totalComprobado: 14400, totalAnticipo: 15000, diferencia: 600, estatus: 'revisar',
  totalDeducible: 14400, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 3841.8, litrosDieselAcreditables: 663.6, ivaAcreditable: 2304.96, peajeAcreditable: 0,
  gastos: GASTOS,
  diferencias: [
    { tipo: 'anticipo', concepto: 'otro', monto: 600, nota: 'Quedan $600.00 a favor de la empresa.' },
    { tipo: 'sobre_politica', concepto: 'diesel', monto: 200, gastoId: GASTOS[0].id, nota: 'Diésel sobre el tope de política.' },
    { tipo: 'ocr_baja_confianza', concepto: 'diesel', monto: 0, gastoId: GASTOS[1].id, nota: 'Lectura dudosa: revisar a mano.' },
  ],
};

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(async () => LIQ) }));
vi.mock('./config', () => ({ getConfig: vi.fn(async () => ({ politica: [] })) }));
vi.mock('./liquidacion/pdf', () => ({ generarLiquidacionPDF: vi.fn(async () => new Uint8Array([1, 2, 3])) }));
vi.mock('./repo', () => ({
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 15000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Juan', telefono: '52199' })),
  saveLiquidacion: vi.fn(async () => 'liq-1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}));

await import('./tools');
const { executeTool } = await import('@/lib/llm/tool-executor');

const CTX = { tenantId: 't1', viajeId: 'v1', operadorId: 'o1', telefono: '52199' };

describe('guardar_liquidacion — el snapshot va al llamador, el resumen al modelo', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lo que ve el modelo son los cinco campos que usa, no el snapshot', async () => {
    const r = await executeTool('guardar_liquidacion', {}, CTX);
    expect(r.success, r.error).toBe(true);
    expect(r.paraModelo).toEqual({
      liquidacion_id: 'liq-1',
      estatus: 'revisar',
      diferencia: 600,
      pdf_generado: true,
      pdf_contralor_generado: true,
    });
    const bytes = JSON.stringify(r.paraModelo).length;
    expect(bytes, `el resumen mide ${bytes} bytes`).toBeLessThan(300);
  });

  it('el resumen no lleva NI UN RFC, UUID o ruta de foto al proveedor', async () => {
    const r = await executeTool('guardar_liquidacion', {}, CTX);
    const texto = JSON.stringify(r.paraModelo);
    expect(texto).not.toContain('CCO8605231N4');
    expect(texto).not.toContain('TFL010203AB9');
    expect(texto).not.toContain('11111111-2222');
    expect(texto).not.toContain('comprobante-0');
  });

  it('el llamador conserva el snapshot completo: la guardia lo reusa', async () => {
    const r = await executeTool('guardar_liquidacion', {}, CTX);
    const res = r.result as { liq: { gastos: unknown[]; totalComprobado: number } };
    expect(res.liq.gastos).toHaveLength(12);
    expect(res.liq.totalComprobado).toBe(14400);
  });

  it('el canal del modelo es una fracción del snapshot que sigue viajando al llamador', async () => {
    const r = await executeTool('guardar_liquidacion', {}, CTX);
    const completo = JSON.stringify(r.result).length;
    const resumen = JSON.stringify(r.paraModelo).length;
    // Este fixture mide ~8.3 KB; la medición de la auditoría, con un `ocrExtra`
    // más rico, dio 15,649. La propiedad no es el número exacto: es el ORDEN de
    // magnitud entre lo que necesita la guardia y lo que necesita el modelo.
    expect(completo, `snapshot ${completo} bytes`).toBeGreaterThan(8000);
    expect(resumen * 20, `resumen ${resumen} bytes vs snapshot ${completo}`).toBeLessThan(completo);
  });
});
