// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (reincidente) — un hotel guardado con el concepto
// heredado `viaticos` salía con "$1,250 no deducibles" citando LISR 28-V, y el
// papel lo llamaba "Alimentación".
//
// `engine.ts` aplicaba el tope diario a los dos conceptos:
//
//     const conTope = (c: string) => c === 'alimentacion' || c === 'viaticos';
//
// con el comentario «criterio conservador: se le sigue aplicando el tope».
//
// `normas/lisr-28-V.yaml` (`evidencia_corroborante`), literal: «Tratándose
// de gastos de viaje destinados a LA ALIMENTACIÓN, éstos sólo serán deducibles
// hasta por un monto que no exceda de $750.00 diarios...», y su
// `confirmado_del_codigo`: «Solo alimentación; EL HOSPEDAJE NACIONAL NO TIENE
// TOPE: CORRECTO».
//
// No es conservador: el lado conservador para el contribuyente es no declararle
// perdida una deducción que la ley le concede. `viaticos` es el cajón del OCR
// viejo —una noche de hotel guardada así— y el motor no sabe si es comida u
// hospedaje. Afirmar sobre eso "$1,250.00 no es deducible", y encima nombrarlo
// "Alimentación", es afirmar dos cosas que no constan.
//
// Alcance: el OCR de hoy no emite `viaticos` (`intake/ocr.ts`), pero
// `0025_dominios_check.sql` sigue admitiendo el valor y `repo.ts` lo lee tal cual.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

const politica: PoliticaGasto[] = [];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000 };

const g = (p: Partial<Gasto>): Gasto => ({ id: 'g1', concepto: 'otro', monto: 0, ocrConfianza: 0.95, ...p });

const cuadrar = (gastos: Gasto[]) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 0, politica, estimulos: EST, gastos });

/** El escenario del hallazgo: una noche de hotel de $2,000 guardada por el OCR viejo. */
const hotelViejo = g({
  concepto: 'viaticos', monto: 2000, fecha: '2026-08-01',
  cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', ivaTraslado: 275.86,
});

describe('el concepto heredado `viaticos` no puede llevar el tope de la ALIMENTACIÓN', () => {
  it('no declara perdidos $1,250 de un gasto que puede ser hospedaje', () => {
    const r = cuadrar([hotelViejo]);
    expect(r.totalDeducible).toBe(2000);
    expect(r.totalNoDeducible).toBe(0);
    expect(r.ivaAcreditable).toBe(275.86);   // LIVA 5-I: en proporción a lo deducible
  });

  it('pero no se calla: avisa que si es alimentación el tope aplica, sin afirmar la pérdida', () => {
    const d = cuadrar([hotelViejo]).diferencias.find((x) => x.tipo === 'viatico_excede_fiscal');
    expect(d, 'la señal no se pierde: sigue yendo a revisión').toBeDefined();
    expect(d!.monto, 'monto 0: es un aviso, no dinero declarado perdido').toBe(0);
    expect(d!.nota).not.toMatch(/^Alimentación/);      // el papel lo llamaba así
    expect(d!.nota).not.toMatch(/no es deducible/i);   // y afirmaba la pérdida
    expect(d!.nota).toContain('LISR 28-V');
    expect(d!.nota).toMatch(/hospedaje/i);             // dice por qué no se afirma
    expect(cuadrar([hotelViejo]).estatus).toBe('revisar');
  });

  // CONTROL. La alimentación de verdad sigue con su tope: sin esto, "arreglar"
  // el hallazgo quitando el tope entero le regalaría al cliente una deducción
  // que la ley no le da, que es el error caro en la otra dirección.
  it('la ALIMENTACIÓN timbrada sigue con su tope diario intacto', () => {
    const comida = g({ ...hotelViejo, concepto: 'alimentacion' });
    const r = cuadrar([comida]);
    expect(r.totalDeducible).toBe(750);
    expect(r.totalNoDeducible).toBe(1250);
    const d = r.diferencias.find((x) => x.tipo === 'viatico_excede_fiscal')!;
    expect(d.monto).toBe(1250);
    expect(d.nota).toContain('no es deducible');
    // Y su IVA se acredita SOLO en la proporción deducible (LIVA 5-I).
    expect(r.ivaAcreditable).toBe(103.45);
  });

  it('un día con comida Y un viático genérico: el tope lo lleva solo la comida', () => {
    const r = cuadrar([
      g({ id: 'g2', concepto: 'alimentacion', monto: 800, fecha: '2026-08-01', cfdiUuid: 'u2', xmlVerificado: true, rfcReceptor: 'REC010101AA1' }),
      hotelViejo,
    ]);
    // 800 de comida: 750 deducibles, 50 no. Los 2,000 del genérico, enteros.
    expect(r.totalDeducible).toBe(2750);
    expect(r.totalNoDeducible).toBe(50);
  });
});
