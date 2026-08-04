import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe } from './engine';
import { filasDeducibilidad } from '../liquidacion/deducibilidad';
import { filasAcreditables } from '../liquidacion/acreditable';
import { NORMA_POR_DIFERENCIA, SIN_NORMA } from '../normas/por_diferencia';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 — DEUDA ABIERTA del ALTO del medio de pago: el 2º párrafo de
// LISR 27-III (combustible) quedó cerrado con `MEDIOS_LISR_27_III`, y el
// PRIMERO —el de los gastos NO combustibles de más de $2,000— siguió
// implementado como «no es efectivo»:
//
//     } else if (g.formaPago === '01' && !esCombustible && g.monto > topeEfectivo)
//
// Los otros 29 códigos de `c_FormaPago` pasaban como si cumplieran.
//
// `normas/lisr-27-III.yaml` (`evidencia_corroborante`), `texto_vigente`, 1er
// párrafo, transcrito de la ficha, literal:
//
//   «...que los pagos cuyo monto exceda de $2,000.00 se efectúen mediante
//   transferencia electrónica de fondos...; cheque nominativo de la cuenta del
//   contribuyente, tarjeta de crédito, de débito, de servicios, o los
//   denominados monederos electrónicos autorizados por el Servicio de
//   Administración Tributaria.»
//
// Es una lista CERRADA: la fracción no describe lo que no cumple, enumera lo
// que sí. Medido antes del arreglo, con el hospedaje del hallazgo ($5,000,
// timbrado, XML verificado, IVA $689.66, `FormaPago 17` — compensación):
//
//   difs: []  ·  totalDeducible $5,000 tono 'bueno' → VERDE (pdf.ts:295)
//   ACRED: 'IVA acreditable (LIVA art. 5)' $689.66 tono 'bueno' → VERDE
//
// POR QUÉ UN TIPO NUEVO Y NO `efectivo_sobre_tope`. Ese veredicto es DURO
// (`NO_DEDUCIBLE_ISR`) y el caso que más aparece aquí es `99` — «Por definir»,
// el valor OBLIGATORIO de todo CFDI con `MetodoPago = PPD`, que significa que
// EL PAGO TODAVÍA NO OCURRIÓ y que el medio real se conocerá en el complemento
// de recepción de pagos. Declarar no deducible un gasto cuyo pago está por
// hacerse le quita al cliente una deducción que va a tener; y un efectivo de
// $5,000, que sí es un hecho consumado y fuera de la lista, no puede ablandarse
// para acompañarlo. Son dos veredictos distintos y necesitan dos tipos.
// ═══════════════════════════════════════════════════════════════════════════

// RFC con dígito verificador válido: si no lo es, el motor levanta
// `rfc_receptor_no_verificable` y manda TODO a por confirmar por otra razón
// (es el crítico del seed, `d08db8a`), y esta prueba mediría el hallazgo
// equivocado.
const RFC = 'TIN010101AA5';

const hospedaje = (formaPago?: string, monto = 5000): Gasto => ({
  id: 'g1', concepto: 'hospedaje', monto, fecha: '2026-07-15', cfdiUuid: 'uuid-h1',
  rfcReceptor: RFC, xmlVerificado: true, tipoComprobante: 'I',
  formaPago, ivaTraslado: 689.66,
});

const cuadre = (gastos: Gasto[]) => cuadrarViaje({
  viajeId: 'v-medio', anticipo: 5000, politica: [{ concepto: 'hospedaje' }, { concepto: 'diesel' }],
  empresaRfc: RFC,
  estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000 },
  gastos,
});

describe('LISR 27-III 1er párrafo — el medio de pago de un gasto NO combustible > $2,000', () => {
  it('un hospedaje de $5,000 con FormaPago 17 (compensación) deja de salir deducible en verde', () => {
    const liq = cuadre([hospedaje('17')]);
    const d = liq.diferencias.find((x) => x.tipo === 'medio_pago_sobre_tope');
    expect(d, 'el pago fuera de la lista cerrada del 1er párrafo pasa como si cumpliera').toBeDefined();
    expect(d!.nota).toMatch(/LISR 27-III/);
    expect(d!.nota).toMatch(/compensaci[oó]n/i);
    // El dinero no se declara perdido: se deja POR CONFIRMAR.
    expect(liq.totalDeducible).toBe(0);
    expect(liq.totalPorConfirmar).toBe(5000);
    expect(liq.totalNoDeducible).toBe(0);
    expect(cubetaDe(hospedaje('17'), liq.diferencias.filter((x) => x.gastoId === 'g1'))).toBe('por_confirmar');
  });

  it('y su IVA tampoco se afirma: LIVA 5-I ata el acreditamiento a la deducción', () => {
    const liq = cuadre([hospedaje('17')]);
    expect(liq.ivaAcreditable).toBe(0);
    expect(filasAcreditables(liq)).toBe(null);
  });

  it('`99` (PPD, el pago aún no ocurre) NO comparte el veredicto duro del efectivo', () => {
    const ppd = cuadre([hospedaje('99')]);
    const dPpd = ppd.diferencias.find((x) => x.tipo === 'medio_pago_sobre_tope');
    expect(dPpd).toBeDefined();
    expect(dPpd!.nota).toMatch(/a[uú]n no ocurre|todav[ií]a no se ha pagado|Por definir/i);
    expect(ppd.totalNoDeducible, 'un pago que no ha ocurrido no es una deducción perdida').toBe(0);
    expect(ppd.totalPorConfirmar).toBe(5000);

    // El control: el efectivo SÍ es un hecho consumado y sigue siendo duro.
    const efectivo = cuadre([hospedaje('01')]);
    expect(efectivo.diferencias.map((x) => x.tipo)).toContain('efectivo_sobre_tope');
    expect(efectivo.totalNoDeducible).toBe(5000);
    expect(efectivo.totalPorConfirmar).toBe(0);
  });

  it('un medio de la LISTA CERRADA sigue deducible y con su IVA: la lista no se invirtió', () => {
    for (const fp of ['02', '03', '04', '05', '28', '29']) {
      const liq = cuadre([hospedaje(fp)]);
      expect(liq.diferencias.map((x) => x.tipo), `FormaPago ${fp} está en la lista de LISR 27-III`).not.toContain('medio_pago_sobre_tope');
      expect(liq.totalDeducible, `FormaPago ${fp}`).toBe(5000);
      expect(liq.ivaAcreditable).toBe(689.66);
    }
  });

  it('DEBAJO de $2,000 no se levanta nada: el 1er párrafo tiene tope, a diferencia del 2º', () => {
    const liq = cuadre([hospedaje('17', 1500)]);
    expect(liq.diferencias.map((x) => x.tipo)).not.toContain('medio_pago_sobre_tope');
    expect(liq.totalDeducible).toBe(1500);
  });

  it('sin `formaPago` no se levanta nada: un dato ausente no es un incumplimiento', () => {
    const liq = cuadre([hospedaje(undefined)]);
    expect(liq.diferencias.map((x) => x.tipo)).not.toContain('medio_pago_sobre_tope');
    expect(liq.totalDeducible).toBe(5000);
  });

  it('el COMBUSTIBLE sigue por su propia rama: no se levantan los dos veredictos sobre el mismo CFDI', () => {
    const diesel: Gasto = {
      id: 'g2', concepto: 'diesel', monto: 5400, fecha: '2026-07-15', cfdiUuid: 'uuid-d1',
      rfcReceptor: RFC, xmlVerificado: true, tipoComprobante: 'I', claveProdServ: '15101505',
      formaPago: '17', ivaTraslado: 744.83,
    };
    const tipos = cuadre([diesel]).diferencias.map((x) => x.tipo);
    expect(tipos).toContain('combustible_efectivo');   // 2º párrafo, con la válvula de la RFA 2.9
    expect(tipos).not.toContain('medio_pago_sobre_tope');
  });

  it('el renglón del PDF lo dice: "Por confirmar", no "Deducible para ISR"', () => {
    const filas = filasDeducibilidad(cuadre([hospedaje('17')]))!;
    expect(filas.map((f) => f.label)).toEqual(['Por confirmar']);
    expect(filas[0].tono).toBe('pendiente');
    expect(filas[0].pie).toMatch(/medio de pago/i);
  });

  it('el tipo nuevo está clasificado: puede citar LISR 27-III al explicarlo', () => {
    expect(NORMA_POR_DIFERENCIA.medio_pago_sobre_tope).toContain('lisr-27-fr-III');
    expect('medio_pago_sobre_tope' in SIN_NORMA).toBe(false);
  });
});
