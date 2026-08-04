import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (fiscal) — "Después del arreglo de EFOS, un CFDI que el
// SAT marca sale 'Deducible para ISR' en verde con su IVA acreditable".
//
// La auditoría 9 arregló un falso positivo real: `sat.ts` mapeaba
// `ValidacionEFOS = '100'` directo a `efos: true`, y eso declaraba fraude
// confirmado (`cfdi_efos` → `NO_DEDUCIBLE_ISR`, tinta roja, "lista negra del
// SAT") sobre un emisor que podía estar solo PRESUNTO. `normas/cff-69-B.yaml`
// (verificado_fuente_primaria) es explícito: el efecto de "no producen ni
// produjeron efecto fiscal alguno" es SOLO del listado DEFINITIVO. Ese arreglo
// fue correcto y NO se revierte aquí.
//
// Lo que el arreglo dejó abierto es el otro lado. Tras él, `efos` solo puede
// valer `false` o `null` (`intake/sat.ts:82`), así que `g.efos === true`
// (`engine.ts:405`) es inalcanzable desde el pipeline real y TODO EFOS entra
// por `cfdi_efos_indeterminado`. Ese tipo no estaba en `NO_DEDUCIBLE_ISR` ni en
// `POR_CONFIRMAR` ni en `SIN_ACREDITAMIENTO`: el gasto caía en la cubeta
// `deducible` y el papel imprimía "Deducible para ISR" en verde, con su IVA
// acreditable al 100%, sobre un comprobante que el SAT sí marcó.
//
// Se pasó de "siempre duro" a "nunca duro". El estado correcto es el tercero,
// el que este mismo motor ya usa para el RFC no verificable: POR CONFIRMAR y
// sin acreditamiento — ni fraude declarado, ni deducción afirmada.
// ═══════════════════════════════════════════════════════════════════════════

const politica: PoliticaGasto[] = [{ concepto: 'factura', topeMonto: 50000 }];

// Un CFDI que el SAT marcó con un código EFOS que no es limpio (200/201): el
// intake lo entrega como `efosRevisar: true` con `efos: null`, que es lo único
// que `sat.ts` puede producir hoy.
const gastoMarcadoPorElSat = (): Gasto => ({
  id: 'g-efos',
  concepto: 'factura',
  monto: 11600,
  ocrConfianza: 0.95,
  folio: 'F-1',
  cfdiUuid: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  rfcReceptor: 'REC010101AA1',
  estadoSat: 'vigente',
  xmlVerificado: true,
  ivaTraslado: 1600,
  subTotal: 10000,
  efos: null,
  efosRevisar: true,
});

describe('un CFDI marcado por el SAT no se afirma deducible ni acredita IVA', () => {
  it('el escenario del hallazgo: $11,600 marcado por el SAT NO cae en la cubeta deducible', () => {
    const r = cuadrarViaje({
      viajeId: 'v-efos',
      anticipo: 11600,
      politica,
      gastos: [gastoMarcadoPorElSat()],
    });

    expect(
      r.diferencias.map((d) => d.tipo),
      'el camino que ejercemos es el indeterminado, que es el único que sat.ts puede producir',
    ).toContain('cfdi_efos_indeterminado');

    // El corazón del hallazgo: antes del arreglo esto era 11600 / 0.
    expect(
      r.totalDeducible,
      'un comprobante que el SAT marcó no puede imprimirse como deducción afirmada',
    ).toBe(0);
    expect(
      r.totalPorConfirmar,
      'el estado correcto es el tercero: ni fraude declarado, ni deducción afirmada',
    ).toBe(11600);
    expect(r.totalNoDeducible, 'y tampoco se declara fraude: eso es lo que la auditoría 9 cerró').toBe(0);
  });

  it('tampoco acredita el IVA: LIVA 5-I ata el acreditamiento a que la erogación sea deducible para ISR', () => {
    const r = cuadrarViaje({
      viajeId: 'v-efos-iva',
      anticipo: 11600,
      politica,
      gastos: [gastoMarcadoPorElSat()],
    });
    expect(r.ivaAcreditable, 'antes del arreglo el papel prometía $1,600 de IVA recuperable').toBe(0);
  });

  it('control: el mismo CFDI sin marca del SAT sí es deducible y sí acredita', () => {
    const limpio = { ...gastoMarcadoPorElSat(), id: 'g-limpio', efos: false as const, efosRevisar: false };
    const r = cuadrarViaje({
      viajeId: 'v-limpio',
      anticipo: 11600,
      politica,
      gastos: [limpio],
    });
    expect(r.diferencias.map((d) => d.tipo)).not.toContain('cfdi_efos_indeterminado');
    expect(r.totalDeducible, 'el arreglo no puede castigar a un comprobante limpio').toBe(11600);
    expect(r.ivaAcreditable).toBe(1600);
  });
});
