import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (fiscal) — "Los litros del estímulo de diésel se cuentan
// con cualquier forma de pago que no sea efectivo, y el requisito que el código
// cita es una lista cerrada de cuatro".
//
// `engine.ts` contaba litros con `!!g.formaPago && g.formaPago !== '01'`,
// mientras su propio comentario, dos líneas arriba, dice qué requisito está
// implementando: "El medio de pago es requisito del 4º párrafo de la LIF
// 20-A-IV (monedero, tarjeta, cheque nominativo o transferencia) y NO tiene la
// válvula del 15% que la RFA 2.9 sí concede para ISR: la facilidad salva la
// deducción, no el acreditamiento."
//
// Cuatro medios nombrados; la negación del efectivo acepta los 30 restantes del
// catálogo `c_FormaPago`. El caso que importa no es exótico: `99 (Por definir)`
// es el valor obligatorio en todo CFDI con `MetodoPago = PPD`, y una flota que
// compra diésel a crédito en la estación factura exactamente así. También
// entraban `12` (dación en pago), `17` (compensación), `23` (novación) y `30`
// (aplicación de anticipos) — ninguno es un medio de pago del 4º párrafo.
//
// Consecuencia: el contador multiplica esos litros por la cuota semanal del DOF
// y acredita un estímulo cuyo requisito de medio de pago nadie verificó.
//
// El arreglo es estrictamente más conservador: cuenta solo los medios que el
// propio comentario del código enumera. Ninguna ficha de `normas/` transcribe
// ese 4º párrafo (queda anotado como hallazgo aparte), así que la lista se toma
// del comentario, no de una fuente que este repo pueda citar.
// ═══════════════════════════════════════════════════════════════════════════

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 50000 }];

const estimulos = { clavesDieselIeps: ['15101505'], precioDieselPorDefecto: 27.0 };

// $5,400 / 200 L = $27.00 por litro, justo el precio de referencia: la
// verificación de la auditoría 8 (0.5×–2×) no se dispara y no contamina el caso.
const dieselCon = (formaPago: string): Gasto => ({
  id: `g-${formaPago}`,
  concepto: 'diesel',
  monto: 5400,
  ocrConfianza: 0.95,
  folio: `D-${formaPago}`,
  cfdiUuid: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  rfcReceptor: 'REC010101AA1',
  estadoSat: 'vigente',
  xmlVerificado: true,
  claveProdServ: '15101505',
  claveUnidad: 'LTR',
  complementoHidrocarburos: true,
  formaPago,
  subTotal: 4655.17,
  ivaTraslado: 744.83,
  ocrExtra: { litros: 200 },
});

const litrosCon = (formaPago: string): number =>
  cuadrarViaje({ viajeId: `v-${formaPago}`, anticipo: 5400, politica, gastos: [dieselCon(formaPago)], estimulos })
    .litrosDieselAcreditables;

describe('los litros del estímulo solo cuentan con los medios de pago que la LIF exige', () => {
  it('el escenario del hallazgo: FormaPago 99 (el obligatorio en un CFDI PPD) NO acredita litros', () => {
    expect(
      litrosCon('99'),
      'antes del arreglo un diésel a crédito acreditaba sus 200 L sin que nadie verificara el medio de pago',
    ).toBe(0);
  });

  it('tampoco los medios que no son pago: dación, compensación, novación, anticipos', () => {
    for (const fp of ['12', '17', '23', '30']) {
      expect(litrosCon(fp), `FormaPago ${fp} no es un medio de pago del 4º párrafo de la LIF 20-A-IV`).toBe(0);
    }
  });

  it('control: los cuatro medios que la ley sí nombra siguen acreditando', () => {
    // 02 cheque nominativo · 03 transferencia · 04 tarjeta de crédito ·
    // 05 monedero electrónico · 28 tarjeta de débito · 29 tarjeta de servicios.
    for (const fp of ['02', '03', '04', '05', '28', '29']) {
      expect(litrosCon(fp), `FormaPago ${fp} sí está en el 4º párrafo y no puede perderse`).toBe(200);
    }
  });

  it('control: el efectivo (01) sigue sin acreditar, como antes del arreglo', () => {
    expect(litrosCon('01')).toBe(0);
  });

  it('control: el gasto de diésel del seed del demo (forma_pago 03) sigue acreditando', () => {
    // `supabase/seed.sql:121-124` inserta el diésel del viaje demo con
    // `forma_pago = '03'`. Si este arreglo lo apagara, apagaría el demo.
    expect(litrosCon('03'), 'el arreglo no puede apagar la única ruta que el demo tiene para enseñar litros').toBe(200);
  });
});
