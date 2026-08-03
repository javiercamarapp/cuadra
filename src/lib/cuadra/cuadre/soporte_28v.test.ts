// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (reincidente) — un hospedaje de $1 SIN TIMBRAR apagaba
// las dos advertencias de LISR 28-V del mismo viaje.
//
// Las dos condiciones se evaluaban por EXISTENCIA DE UN CONCEPTO, sin mirar si
// ese gasto ampara algo:
//
//     const haySoporte   = vivos.some((g) => g.concepto === 'hospedaje' || g.concepto === 'transporte');
//     const hayHospedaje = vivos.some((g) => g.concepto === 'hospedaje');
//
// `normas/lisr-28-V.yaml` (`evidencia_corroborante`), `texto_vigente`, 2º
// párrafo, literal:
//
//   «...y el contribuyente acompañe EL COMPROBANTE FISCAL O LA DOCUMENTACIÓN
//   COMPROBATORIA QUE AMPARE el hospedaje o transporte. Cuando a la
//   documentación que ampare el gasto de alimentación el contribuyente
//   únicamente acompañe el comprobante fiscal relativo al transporte, la
//   deducción... sólo procederá cuando el pago se efectúe mediante tarjeta de
//   crédito de la persona que realiza el viaje.»
//
// Lo que la ley pide acompañar es un COMPROBANTE, no un concepto. El efecto
// medido era discontinuo y perverso: $0 de hospedaje → advertencia; $1 sin
// factura → silencio. El renglón que apagaba las señales es el mismo que el
// motor acababa de clasificar en "por confirmar" con el pie "Falta timbrar la
// factura", y como estas dos reglas ADVIERTEN en vez de quitar deducción,
// apagarlas no deja rastro en ninguna cifra: el contralor no puede notar que
// faltó.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

const politica: PoliticaGasto[] = [];
const g = (p: Partial<Gasto>): Gasto => ({ id: Math.random().toString(36).slice(2), concepto: 'otro', monto: 0, ocrConfianza: 0.95, ...p });

const tipos = (gastos: Gasto[]) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 0, politica, gastos }).diferencias.map((d) => d.tipo);

/** La comida del escenario: $700, timbrada, IVA $96.55. */
const comida = (extra: Partial<Gasto> = {}) =>
  g({ concepto: 'alimentacion', monto: 700, cfdiUuid: 'c1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', ivaTraslado: 96.55, fecha: '2026-08-01', ...extra });

/** El hospedaje de $1 del hallazgo: sin UUID, sin RFC, sin XML. */
const hospedajeFantasma = g({ concepto: 'hospedaje', monto: 1, fecha: '2026-08-01' });

describe('LISR 28-V: lo que ampara la comida tiene que ser un comprobante, no un concepto', () => {
  it('una comida sola sigue levantando la advertencia', () => {
    expect(tipos([comida()])).toContain('alimentacion_sin_soporte');
  });

  // EL HALLAZGO. Antes: `[]` — ni una sola diferencia de LISR 28-V.
  it('un hospedaje de $1 SIN TIMBRAR no la apaga', () => {
    expect(tipos([comida(), hospedajeFantasma])).toContain('alimentacion_sin_soporte');
  });

  // CONTROL. Sin esto, "arreglar" el hallazgo dejando la advertencia siempre
  // encendida pasaría las pruebas de arriba y llenaría de ruido el papel de toda
  // flota que sí comprueba su hospedaje.
  it('un hospedaje TIMBRADO sí la apaga', () => {
    const conFactura = g({ concepto: 'hospedaje', monto: 1200, cfdiUuid: 'h1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', fecha: '2026-08-01' });
    expect(tipos([comida(), conFactura])).not.toContain('alimentacion_sin_soporte');
  });

  it('y un transporte TIMBRADO también (la ley admite cualquiera de los dos)', () => {
    const transporte = g({ concepto: 'transporte', monto: 450, cfdiUuid: 't1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', fecha: '2026-08-01' });
    expect(tipos([comida({ formaPago: '04' }), transporte])).not.toContain('alimentacion_sin_soporte');
  });

  // CONTROL DEL LADO CONTRARIO, y es el que fija el criterio: la ley admite «el
  // comprobante fiscal O LA DOCUMENTACIÓN COMPROBATORIA que ampare el hospedaje o
  // transporte». Un ticket de hotel todavía sin timbrar es documentación
  // comprobatoria, y el flujo que el producto vende son fotos de tickets: exigir
  // CFDI aquí marcaría sin soporte un viaje real. Lo que no ampara es un renglón
  // sin ningún rastro de documento.
  it('un ticket de hotel SIN TIMBRAR pero con folio sí ampara: la ley admite documentación comprobatoria', () => {
    const ticketHotel = g({ concepto: 'hospedaje', monto: 1450, folio: 'HOT-1', fecha: '2026-08-01' });
    expect(tipos([comida(), ticketHotel])).not.toContain('alimentacion_sin_soporte');
  });
});

describe('LISR 28-V: el hospedaje que quita la condición de tarjeta de crédito también', () => {
  const transporte = g({ concepto: 'transporte', monto: 450, cfdiUuid: 't1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', fecha: '2026-08-01' });

  it('comida pagada con débito (28) amparada SOLO por transporte → se exige la tarjeta de crédito', () => {
    expect(tipos([comida({ formaPago: '28' }), transporte])).toContain('alimentacion_transporte_sin_tarjeta_credito');
  });

  // EL HALLAZGO, segunda mitad. Antes: `[]`.
  it('el mismo hospedaje de $1 sin timbrar no vuelve "no únicamente transporte" al viaje', () => {
    expect(tipos([comida({ formaPago: '28' }), transporte, hospedajeFantasma]))
      .toContain('alimentacion_transporte_sin_tarjeta_credito');
  });

  // CONTROL: con hospedaje timbrado ya no es "únicamente" transporte y la
  // condición de la 3ª oración no aplica.
  it('con hospedaje TIMBRADO la condición deja de aplicar', () => {
    const conFactura = g({ concepto: 'hospedaje', monto: 1200, cfdiUuid: 'h1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', fecha: '2026-08-01' });
    expect(tipos([comida({ formaPago: '28' }), transporte, conFactura]))
      .not.toContain('alimentacion_transporte_sin_tarjeta_credito');
  });
});
