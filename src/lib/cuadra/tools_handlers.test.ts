import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO — `cuadrar_viaje` Y `consultar_politica` ERAN LAS DOS
// ÚNICAS TOOLS SIN ARNÉS, Y SON LAS QUE DECIDEN QUÉ LEY PUEDE INVOCAR EL
// PRODUCTO DELANTE DEL CONTRALOR.
//
// `grep -rn "executeTool(" src --include=*.test.ts` devolvía UNA sola línea en
// todo el repo, y sólo para `guardar_liquidacion`. La prueba que parecía cubrir
// a `consultar_politica` (`normas/permiso_politica.test.ts:31-44`) no
// reconstruye la forma del resultado: COPIA el cuerpo de la función. Es un clon
// que se prueba a sí mismo — si alguien edita el handler, la copia sigue verde.
//
// Las dos mutaciones que la auditoría dejó escritas y que nada ponía en rojo:
//
//   · invertir `tools.ts` `periodo.estado !== 'holgado'` a `===` quita el
//     permiso de citar `rfa-2026-2.9` justo cuando la flota va rebasando el 15%
//     de combustible en efectivo —que es cuando importa— y se lo da cuando va
//     holgada. El agente explica el diésel en efectivo citando sólo LISR 27-III
//     ("no deducible, punto") en vez de LISR 27-III + la facilidad del 15%.
//   · invertir `verificada` hace que afirme tajante sobre una ficha
//     `sin_verificar`.
//
// El arnés va en la FRONTERA (`executeTool`), que es donde está el riesgo, y no
// un nivel por debajo. El índice de normas es el REAL a propósito: el permiso de
// citar sólo vale si sale del índice que la guardia sabe reconocer.
// ═══════════════════════════════════════════════════════════════════════════

const base: Omit<Liquidacion, 'id' | 'creadaEn' | 'diferencias'> = {
  viajeId: 'v1', totalComprobado: 9400, totalAnticipo: 10000, diferencia: 600, estatus: 'revisar',
  totalDeducible: 9400, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  gastos: [{ id: 'g1', concepto: 'diesel', monto: 9400, rfcEmisor: 'CCO8605231N4', imagenUrl: 't1/v1/foto.jpg' }],
};

/** Lo que devuelve el motor en cada prueba. */
let LIQ: Liquidacion | Omit<Liquidacion, 'id' | 'creadaEn'> = { ...base, diferencias: [] };
/** Lo que devuelve el acumulado del ejercicio (o el error que lanza). */
let ACUM: { efectivo: number; totalCombustible: number } | Error = new Error('sin base');
/** La política de la flota. */
let POLITICA: Array<{ concepto: string; tope: number }> = [];

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(async () => LIQ) }));
vi.mock('./config', () => ({ getConfig: vi.fn(async () => ({ politica: POLITICA })) }));
vi.mock('./liquidacion/pdf', () => ({ generarLiquidacionPDF: vi.fn(async () => new Uint8Array([1])) }));
vi.mock('./repo', () => ({
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 10000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Juan', telefono: '52199' })),
  saveLiquidacion: vi.fn(async () => 'liq-1'),
  getAcumuladoCombustible: vi.fn(async () => { if (ACUM instanceof Error) throw ACUM; return ACUM; }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}));

await import('./tools');
const { executeTool } = await import('@/lib/llm/tool-executor');

const CTX = { tenantId: 't1', viajeId: 'v1', operadorId: 'o1', telefono: '52199' };
type Fundamento = { norma_id: string; cita: string; jerarquia: number; verificada: boolean; vinculante: boolean };
type ResCuadre = {
  total_comprobado: number; total_anticipo: number; diferencia: number; estatus: string;
  diferencias: { tipo: string; monto: number; nota?: string }[];
  combustible_efectivo_ejercicio?: { estado: string; razon: number; margen: number; excedente: number; aviso: string | null };
  fundamentos: Fundamento[];
};

const cuadrar = async (): Promise<ResCuadre> => {
  const r = await executeTool('cuadrar_viaje', {}, CTX);
  expect(r.success, r.error).toBe(true);
  return r.result as ResCuadre;
};

beforeEach(() => {
  LIQ = { ...base, diferencias: [] };
  ACUM = new Error('sin base');
  POLITICA = [];
});

describe('cuadrar_viaje — cifras y permiso de citar, por la frontera de executeTool', () => {
  it('devuelve las cifras del motor y de cada diferencia SÓLO tipo/monto/nota', async () => {
    LIQ = { ...base, diferencias: [
      { tipo: 'sobre_politica', concepto: 'diesel', monto: 200, gastoId: 'g1', nota: 'Diésel sobre el tope de política.' },
    ] };
    const r = await cuadrar();
    expect(r.total_comprobado).toBe(9400);
    expect(r.total_anticipo).toBe(10000);
    expect(r.diferencia).toBe(600);
    expect(r.estatus).toBe('revisar');
    expect(r.diferencias).toEqual([{ tipo: 'sobre_politica', monto: 200, nota: 'Diésel sobre el tope de política.' }]);
    // El `gastoId` y el `concepto` no cruzan: el modelo narra, no audita filas.
    expect(JSON.stringify(r.diferencias)).not.toContain('gastoId');
  });

  it('sin viaje activo, el handler falla y `executeTool` lo captura', async () => {
    const r = await executeTool('cuadrar_viaje', {}, { tenantId: 't1' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/sin viaje activo/);
  });

  it('el diésel en efectivo llega con LAS DOS normas: la prohibición y la facilidad', async () => {
    LIQ = { ...base, diferencias: [
      { tipo: 'combustible_efectivo', concepto: 'diesel', monto: 9400, gastoId: 'g1', nota: 'Diésel pagado en efectivo.' },
    ] };
    const ids = (await cuadrar()).fundamentos.map((f) => f.norma_id);
    expect(ids).toContain('lisr-27-fr-III');   // "no deducible, punto"
    expect(ids).toContain('rfa-2026-2.9');     // …salvo hasta el 15%
  });

  it('cada fundamento trae la cita, la jerarquía y si obliga — con valores, no con la fórmula', async () => {
    LIQ = { ...base, diferencias: [
      { tipo: 'combustible_efectivo', concepto: 'diesel', monto: 9400, gastoId: 'g1', nota: 'n' },
    ] };
    const f = (await cuadrar()).fundamentos;
    expect(f.find((x) => x.norma_id === 'lisr-27-fr-III')).toEqual({
      norma_id: 'lisr-27-fr-III', cita: 'LISR 27-III', jerarquia: 1, verificada: true, vinculante: true,
    });
    expect(f.find((x) => x.norma_id === 'rfa-2026-2.9')).toEqual({
      norma_id: 'rfa-2026-2.9', cita: 'RFA 2026 regla 2.9', jerarquia: 3, verificada: true, vinculante: true,
    });
  });

  it('una ficha SIN VERIFICAR sale marcada como tal y como no vinculante', async () => {
    // El plazo de un portal de autofacturación no es una obligación fiscal, y su
    // ficha no está verificada: el agente tiene que poder condicionar en vez de
    // afirmar tajante.
    LIQ = { ...base, diferencias: [
      { tipo: 'factura_por_vencer', concepto: 'diesel', monto: 0, gastoId: 'g1', nota: 'Te quedan 2 días para facturar.' },
    ] };
    const f = (await cuadrar()).fundamentos.find((x) => x.norma_id === 'politica-portales-plazos-facturacion');
    expect(f).toBeDefined();
    expect(f!.verificada, 'ficha sin_verificar marcada como verificada').toBe(false);
    expect(f!.vinculante, 'una política de un tercero no obliga').toBe(false);
    expect(f!.jerarquia).toBe(6);
  });

  it('la flota que va rebasando el 15% GANA el permiso de citar la facilidad', async () => {
    // Sin diferencia que la traiga: el permiso tiene que venir del ejercicio.
    LIQ = { ...base, diferencias: [{ tipo: 'sobre_politica', concepto: 'diesel', monto: 200, gastoId: 'g1', nota: 'n' }] };
    ACUM = { efectivo: 13_000, totalCombustible: 100_000 };  // 13% → 'cerca'
    const r = await cuadrar();
    expect(r.combustible_efectivo_ejercicio?.estado).toBe('cerca');
    expect(r.fundamentos.map((f) => f.norma_id)).toContain('rfa-2026-2.9');
  });

  it('la flota holgada NO lo gana: citar el 15% sin motivo es ruido', async () => {
    LIQ = { ...base, diferencias: [{ tipo: 'sobre_politica', concepto: 'diesel', monto: 200, gastoId: 'g1', nota: 'n' }] };
    ACUM = { efectivo: 1_000, totalCombustible: 100_000 };   // 1% → 'holgado'
    const r = await cuadrar();
    expect(r.combustible_efectivo_ejercicio?.estado).toBe('holgado');
    expect(r.fundamentos.map((f) => f.norma_id)).not.toContain('rfa-2026-2.9');
  });

  it('si el acumulado del ejercicio no se puede leer, el cuadre sale igual (best-effort)', async () => {
    ACUM = new Error('db down');
    const r = await cuadrar();
    expect(r.combustible_efectivo_ejercicio).toBeUndefined();
    expect(r.total_comprobado).toBe(9400);
  });
});

describe('consultar_politica — los topes y el permiso de citar viajan juntos', () => {
  it('devuelve la política de la flota tal cual la trae la config', async () => {
    POLITICA = [{ concepto: 'diesel', tope: 5000 }, { concepto: 'alimentacion', tope: 750 }];
    const r = await executeTool('consultar_politica', {}, CTX);
    expect(r.success, r.error).toBe(true);
    expect((r.result as { politica: unknown }).politica).toEqual(POLITICA);
  });

  it('emite `norma_id` —la llave que lee la guardia— con las normas de la política', async () => {
    POLITICA = [{ concepto: 'diesel', tope: 5000 }];
    const r = await executeTool('consultar_politica', {}, CTX);
    const f = (r.result as { fundamentos: Fundamento[] }).fundamentos;
    expect(f.every((x) => typeof x.norma_id === 'string' && x.norma_id.length > 0)).toBe(true);
    const ids = f.map((x) => x.norma_id);
    expect(ids).toContain('lisr-27-fr-III');       // piso: efectivo
    expect(ids).toContain('lisr-28-fr-V');         // piso: tope diario de alimentación
    expect(ids).toContain('rfa-2026-2.9');         // del diésel de la política
    expect(ids).toContain('lif-2026-art-20-A');    // estímulo del diésel
  });

  it('el estímulo del diésel NO se emite si la política no trae diésel', async () => {
    POLITICA = [{ concepto: 'alimentacion', tope: 750 }];
    const r = await executeTool('consultar_politica', {}, CTX);
    const ids = (r.result as { fundamentos: Fundamento[] }).fundamentos.map((x) => x.norma_id);
    expect(ids).not.toContain('lif-2026-art-20-A');
  });

  it('cada fundamento sale con su cita y su peso legal, en valores', async () => {
    POLITICA = [{ concepto: 'diesel', tope: 5000 }];
    const r = await executeTool('consultar_politica', {}, CTX);
    const f = (r.result as { fundamentos: Fundamento[] }).fundamentos;
    expect(f.find((x) => x.norma_id === 'lisr-28-fr-V')).toEqual({
      norma_id: 'lisr-28-fr-V', cita: 'LISR 28-V', jerarquia: 1, verificada: true, vinculante: true,
    });
  });
});
