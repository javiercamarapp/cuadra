import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluarTope15, cuentaContraTope15, MEDIOS_LISR_27_III } from './combustible';
import { avisoTope15 } from './aviso';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTADOR DEL 15% ESTABA CIEGO, Y SU «MARGEN» RESPONDÍA OTRA PREGUNTA —
// auditoría 11, ALTO (G-04). Dos defectos independientes del mismo módulo.
//
// (a) EL NUMERADOR. `repo.ts` contaba `forma_pago === '01'` y nada más. Pero la
//     RFA 2026 regla 2.9 no habla del efectivo: acota su válvula del 15% a los
//     pagos hechos «con medios distintos a cheque nominativo…; tarjeta de
//     crédito, de débito o de servicios; o monederos electrónicos autorizados
//     por el SAT» — una lista CERRADA de seis códigos, y los otros treinta caen
//     dentro del tope. `engine.ts` ya lo corrigió por viaje en la ronda 10
//     (`medioFueraDeLista`); el contador del EJERCICIO se quedó atrás, así que
//     las dos mitades del mismo producto contestan distinto sobre el mismo
//     gasto.
//
//     `99` (Por definir) es el valor OBLIGATORIO de todo CFDI con
//     `MetodoPago = PPD`: la flota que carga diésel a crédito en la estación
//     factura exactamente así. Con $800,000 por transferencia y $200,000 en
//     PPD va en 20% del tope y el contador decía `holgado`, con el aviso en
//     `null` — o sea, en silencio.
//
// (b) EL MARGEN. `permitido − efectivo` contesta «cuánto falta para que el
//     efectivo de HOY llegue al 15% del total de HOY». La pregunta del
//     contralor es otra: «cuánto MÁS puedo pagar así sin pasarme», y ese peso
//     nuevo entra en los DOS lados de la razón:
//
//         (e + x) / (t + x) ≤ 0.15   ⇒   x = (0.15·t − e) / 0.85
//
//     Con $1,000,000 de combustible y $120,000 fuera de la lista, el corte
//     real está en $35,294.1176 y se imprimía $30,000.00: 17.6% menos, sobre la
//     cifra en pesos que el aviso presenta como «lo accionable». Se trunca a
//     $35,294.11 y no se redondea a $35,294.12, porque el margen AUTORIZA a
//     gastar y el centavo de más deja a la flota encima del tope.
// ═══════════════════════════════════════════════════════════════════════════

describe('(a) el numerador es «fuera de la lista cerrada», no «efectivo»', () => {
  it('el efectivo cuenta', () => {
    expect(cuentaContraTope15('01')).toBe(true);
  });

  it('los seis medios del 2º párrafo de LISR 27-III NO cuentan', () => {
    for (const fp of ['02', '03', '04', '05', '28', '29']) {
      expect(cuentaContraTope15(fp), `${fp} está en la lista cerrada`).toBe(false);
    }
  });

  it('«99 · Por definir» —el PPD de la flota que carga a crédito— SÍ cuenta', () => {
    expect(cuentaContraTope15('99')).toBe(true);
  });

  it('«17 · compensación» también: la lista es cerrada, no una lista de prohibidos', () => {
    expect(cuentaContraTope15('17')).toBe(true);
  });

  it('sin forma de pago NO se cuenta: un dato ausente no es un incumplimiento', () => {
    // Mismo criterio que `engine.ts` (`!!g.formaPago && !MEDIOS…`): suponerlo
    // inflaría el numerador contra la flota.
    expect(cuentaContraTope15(null)).toBe(false);
    expect(cuentaContraTope15(undefined)).toBe(false);
    expect(cuentaContraTope15('')).toBe(false);
  });

  it('la flota que compra TODO su diésel a crédito ya no sale «holgado» en silencio', () => {
    // $800,000 por transferencia + $200,000 en PPD = 20% del tope.
    const r = evaluarTope15({ efectivo: 200_000, totalCombustible: 1_000_000 });
    expect(r.estado).toBe('excedido');
    expect(avisoTope15(r, 2026), 'el aviso en null es el producto callándose').not.toBeNull();
  });
});

// La lista vive en dos archivos porque `engine.ts` (el motor, puro, de otro
// dominio) no la exporta. Que se separen es exactamente el modo de fallo que
// este grupo viene a cerrar, así que se comparan contra el fuente — mismo
// mecanismo con el que `presupuesto.test.ts` sincroniza `TECHO_ENVIO_META_MS`
// con `meta/client.ts`.
describe('la lista no se puede separar de la del motor', () => {
  it('`MEDIOS_LISR_27_III` dice lo mismo aquí que en `cuadre/engine.ts`', () => {
    const fuente = readFileSync('src/lib/cuadra/cuadre/engine.ts', 'utf8');
    const bloque = /const MEDIOS_LISR_27_III[^=]*=\s*\[([\s\S]*?)\]/.exec(fuente);
    expect(bloque, 'el motor dejó de declarar la lista con ese nombre').toBeTruthy();
    const delMotor = [...bloque![1].matchAll(/'(\d{2})'/g)].map((m) => m[1]);
    expect(delMotor.length).toBeGreaterThan(0);
    expect([...MEDIOS_LISR_27_III].sort()).toEqual(delMotor.sort());
  });
});

describe('(b) el margen es lo que TODAVÍA se puede pagar así', () => {
  it('$1,000,000 de combustible con $120,000 fuera de la lista → $35,294.11', () => {
    const r = evaluarTope15({ efectivo: 120_000, totalCombustible: 1_000_000 });
    // (0.15 × 1,000,000 − 120,000) / 0.85 = 35,294.1176…, truncado a centavos.
    expect(r.margen).toBe(35_294.11);
    expect(r.margen, 'y NO el despeje viejo, que era 17.6% más chico').not.toBe(30_000);
  });

  it('y gastarlo deja la razón EXACTAMENTE en el tope, no encima', () => {
    const r = evaluarTope15({ efectivo: 120_000, totalCombustible: 1_000_000 });
    const despues = evaluarTope15({
      efectivo: 120_000 + r.margen,
      totalCombustible: 1_000_000 + r.margen,
    });
    expect(despues.razon).toBeCloseTo(0.15, 6);
    expect(despues.estado, 'el 15% exacto no excede').not.toBe('excedido');
  });

  it('en el tope exacto el margen es 0', () => {
    expect(evaluarTope15({ efectivo: 15_000, totalCombustible: 100_000 }).margen).toBe(0);
  });

  it('pasado el tope el margen es 0, nunca negativo', () => {
    expect(evaluarTope15({ efectivo: 20_000, totalCombustible: 100_000 }).margen).toBe(0);
  });

  it('el EXCEDENTE no cambia: ése sí es sobre el total ya gastado', () => {
    // «Rebasar el 15% no reduce proporcionalmente la deducción: tira el
    // excedente completo». Eso mira hacia atrás; el margen mira hacia adelante.
    expect(evaluarTope15({ efectivo: 20_000, totalCombustible: 100_000 }).excedente).toBe(5_000);
  });
});
