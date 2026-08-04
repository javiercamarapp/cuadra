// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (fiscal) — el requisito de MEDIO DE PAGO de LISR 27-III
// estaba implementado como "no es efectivo".
//
// `engine.ts:281` decía `if (g.formaPago === '01' && esCombustible)`, así que los
// otros 29 códigos del catálogo `c_FormaPago` pasaban como si CUMPLIERAN. La ley
// dice lo contrario: no define lo que no cumple, enumera una lista CERRADA de lo
// que sí.
//
// `normas/lisr-27-III.yaml`, `texto_vigente`, 2º párrafo, literal:
//
//   «Tratándose de la adquisición de combustibles para vehículos marítimos,
//   aéreos y terrestres, el pago deberá efectuarse en la forma señalada en el
//   párrafo anterior, aun cuando la contraprestación de dichas adquisiciones no
//   excedan de $2,000.00»
//
// y el párrafo anterior, que es el que enumera la lista:
//
//   «...que los pagos cuyo monto exceda de $2,000.00 se efectúen mediante
//   transferencia electrónica de fondos...; cheque nominativo de la cuenta del
//   contribuyente, tarjeta de crédito, de débito, de servicios, o los
//   denominados monederos electrónicos autorizados por el Servicio de
//   Administración Tributaria.»
//
// El caso que importa no es exótico: `99` (Por definir) es el valor OBLIGATORIO
// en todo CFDI con `MetodoPago = PPD`, y una flota que compra diésel a crédito en
// la estación factura exactamente así. Con `99` o `17` el mismo hecho jurídico
// —un pago que no está en la lista del 2º párrafo— producía dos veredictos que
// difieren en $5,400 de deducción y $744.83 de IVA según el código de forma de
// pago.
//
// El motor ya tenía el veredicto correcto escrito y probado para esto:
// `combustible_efectivo` (POR_CONFIRMAR + SIN_ACREDITAMIENTO), que es el tercer
// estado —ni deducción afirmada, ni deducción declarada perdida— porque la RFA
// 2026 regla 2.9 salva la deducción hasta el 15% del combustible del ejercicio.
// Y la 2.9 acota su válvula a los MISMOS medios: "cuando los pagos por consumo
// de combustible se realicen con medios distintos a cheque nominativo...; tarjeta
// de crédito, de débito o de servicios; o monederos electrónicos autorizados por
// el SAT".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 10000 }];
const HC = { claves: ['15101505'], unidad: 'LTR', vigenteDesde: '2026-04-24' };
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

/** El diésel del hallazgo: $5,400, CFDI verificado, 200 L. Solo cambia el pago. */
const diesel = (formaPago: string): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 5400, folio: 'D1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I',
  complementoHidrocarburos: true, iepsTraslado: 400, ivaTraslado: 744.83,
  ocrExtra: { litros: 200 }, formaPago,
});

const cuadre = (formaPago: string) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5400, politica, hidrocarburos: HC, estimulos: EST, gastos: [diesel(formaPago)] });

describe('LISR 27-III: el combustible exige un medio de pago de la lista cerrada', () => {
  // EL CASO MEDIDO POR LA AUDITORÍA. Antes del arreglo: `totalDeducible 5400`,
  // `ivaAcreditable 744.83`, cero diferencias sobre el medio de pago — el PDF
  // imprimía "Deducible para ISR $5,400" y "IVA acreditable $744.83" en verde.
  it('compensación (17) NO es medio de pago del 2º párrafo: por confirmar, sin IVA', () => {
    const r = cuadre('17');
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.totalDeducible).toBe(0);
    expect(r.totalPorConfirmar).toBe(5400);
    expect(r.ivaAcreditable).toBe(0);
    expect(r.estatus).toBe('revisar');
  });

  // `99` es el valor obligatorio de todo CFDI con `MetodoPago = PPD`. Es el caso
  // que el commit `0d1fe65` describe como "una flota que compra diésel a crédito
  // en la estación factura exactamente así".
  it('por definir (99, el PPD) tampoco: es un pago que todavía no ocurrió', () => {
    const r = cuadre('99');
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.totalDeducible).toBe(0);
    expect(r.totalPorConfirmar).toBe(5400);
    expect(r.ivaAcreditable).toBe(0);
  });

  it('los demás códigos que no son medio de pago del párrafo tampoco', () => {
    // 12 dación en pago · 15 condonación · 23 novación · 30 aplicación de anticipos.
    for (const fp of ['12', '15', '23', '30']) {
      const r = cuadre(fp);
      expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo'), `formaPago ${fp}`).toBe(true);
      expect(r.totalDeducible, `formaPago ${fp}`).toBe(0);
    }
  });

  // La nota no puede seguir diciendo "EFECTIVO" sobre una compensación: el papel
  // lo lee un contralor que tiene el CFDI enfrente y ve `FormaPago 17`.
  it('la nota nombra el medio real, no "efectivo", y no afirma que sea no deducible', () => {
    const nota = cuadre('17').diferencias.find((d) => d.tipo === 'combustible_efectivo')!.nota;
    expect(nota).not.toMatch(/efectivo/i);
    expect(nota).not.toMatch(/no deducible/i);   // la RFA 2.9 lo salva hasta el 15%
    expect(nota).toMatch(/15\s*%/);
    expect(nota).toMatch(/2\.9/);
    // El efectivo SÍ se sigue nombrando efectivo.
    expect(cuadre('01').diferencias.find((d) => d.tipo === 'combustible_efectivo')!.nota).toMatch(/EFECTIVO/);
  });

  // CONTROL. Sin esto, "arreglar" el hallazgo mandando TODO a por confirmar
  // dejaría las pruebas de arriba verdes y a la flota sin la deducción que la ley
  // sí le concede — que es el error caro en la otra dirección.
  it('los seis medios que la ley SÍ admite conservan la deducción y el IVA', () => {
    for (const fp of ['02', '03', '04', '05', '28', '29']) {
      const r = cuadre(fp);
      expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo'), `formaPago ${fp}`).toBe(false);
      expect(r.totalDeducible, `formaPago ${fp}`).toBe(5400);
      expect(r.ivaAcreditable, `formaPago ${fp}`).toBe(744.83);
    }
  });

  // SIN FORMA DE PAGO no se afirma nada: un dato ausente no es un incumplimiento.
  // El acreditamiento del estímulo de litros sí exige el dato (LIF 20-A, 4º
  // párrafo, sin válvula del 15%) y ya lo cubre `engine_diesel_medio_pago.test.ts`.
  it('sin forma de pago conocida no se levanta el veredicto', () => {
    const sinPago = { ...diesel('03'), formaPago: undefined };
    const r = cuadrarViaje({ viajeId: 'v2', anticipo: 5400, politica, hidrocarburos: HC, estimulos: EST, gastos: [sinPago] });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(false);
    expect(r.totalDeducible).toBe(5400);
  });
});
