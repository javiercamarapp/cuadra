import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filasAcreditables, BASE_ESTIMULO_PEAJE, CONDICIONES_ESTIMULO_PEAJE } from './acreditable';
import { cuadrarViaje } from '../cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTÍMULO DE PEAJE SE IMPRIMÍA COMO UN DERECHO YA GANADO.
//
// Caseta timbrada de $1,160 (SubTotal $1,000 + IVA $160) → el motor devuelve
// `peajeAcreditable = 500` y el PDF imprimía, en VERDE y en negritas:
//
//     Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)        $500.00
//
// con dos huecos que el papel no confesaba:
//
//  1. LA BASE. `normas/lif-2026-20-A.yaml` dice "50% del GASTO TOTAL EROGADO";
//     el motor usa el SubTotal SIN IVA. Sobre $1,160 la ley admite leerse como
//     $580, no $500. Es el hallazgo H4 de la ficha, `estado: SIN RESOLVER`, y
//     resolverlo hacia el total podría duplicar el beneficio del IVA que ya se
//     acredita aparte — pregunta para un contador. Lo exigible al papel es
//     decir cuál de las dos usó.
//  2. LA ELEGIBILIDAD. El motor dispara con `concepto === 'caseta'` a secas: no
//     conoce los ingresos de la flota, ni su relación de partes, ni si la
//     caseta es de la Red Nacional de Autopistas de Cuota (H5 y H6). Una flota
//     con ingresos ≥ $300M se llevaba el estímulo impreso con el artículo al
//     lado, y el criterio 1/LIF/PI alcanza a "quien preste servicios".
// ═══════════════════════════════════════════════════════════════════════════

const liq = (extra: Partial<Parameters<typeof filasAcreditables>[0]> = {}) => ({
  ivaAcreditable: 0, peajeAcreditable: 0, litrosDieselAcreditables: 0, ...extra,
});

describe('filasAcreditables — el peaje deja de afirmarse solo', () => {
  it('sin nada que acreditar no hay sección', () => {
    expect(filasAcreditables(liq())).toBe(null);
  });

  it('el renglón de peaje dice CUÁL BASE usó', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.valor).toBe('$500.00');
    expect(peaje.pies).toContain(BASE_ESTIMULO_PEAJE);
    expect(BASE_ESTIMULO_PEAJE).toContain('subtotal SIN IVA');
    // Y que la otra lectura existe, con su magnitud: $1,160 × 50% = $580.
    expect(BASE_ESTIMULO_PEAJE).toContain('gasto total erogado');
  });

  it('el renglón de peaje enumera las CUATRO condiciones de elegibilidad', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.pies).toContain(CONDICIONES_ESTIMULO_PEAJE);
    for (const condicion of ['EXCLUSIVAMENTE', 'Red Nacional de Autopistas de Cuota', '$300 millones', 'parte relacionada']) {
      expect(CONDICIONES_ESTIMULO_PEAJE).toContain(condicion);
    }
    // Y dice quién NO las verificó, que es lo que evita que el papel se lea como
    // un dictamen de elegibilidad.
    expect(CONDICIONES_ESTIMULO_PEAJE).toContain('Likida NO verifica');
  });

  it('el peaje NO se pinta como cifra sostenida entera', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.tono).toBe('condicionado');
    // La condición también en el label: es el renglón lo que se skimmea.
    expect(peaje.label).toContain('sujeto a elegibilidad');
  });

  // AUDITORÍA 10: el título decía "el IVA sí se sostiene entero" a secas y eso
  // ya no es cierto siempre — depende de que no haya nada condicionando la
  // deducción para ISR del mismo viaje (LIVA 5-I; ver el bloque de abajo). Sin
  // diferencias, que es este caso, sigue siendo la única cifra en verde.
  it('sin nada condicionando la deducción, el IVA es la única cifra en verde', () => {
    const r = filasAcreditables(liq({ ivaAcreditable: 689.66, peajeAcreditable: 500, litrosDieselAcreditables: 200 }))!;
    const buenas = r.filas.filter((f) => f.tono === 'bueno').map((f) => f.label);
    expect(buenas).toEqual(['IVA acreditable (LIVA art. 5)']);
  });

  it('los litros de diésel siguen entregándose en LITROS, no en pesos', () => {
    const r = filasAcreditables(liq({ litrosDieselAcreditables: 200 }))!;
    expect(r.filas[0].valor).toBe('200 L');
    expect(r.filas[0].pies.join(' ')).toContain('cuota SEMANAL');
  });

  // AUDITORÍA 8 · CRÍTICO de pruebas (superviviente de la ronda 6): `litros > 0`
  // mutado a `litros !== 0` seguía verde en 1299/1300 pruebas — nada probaba un
  // valor negativo, que las dos condiciones tratan distinto.
  it('litros negativos NO arman el renglón del estímulo (litros > 0, no !== 0)', () => {
    expect(filasAcreditables(liq({ litrosDieselAcreditables: -5 }))).toBe(null);
  });

  it('el aviso de ingreso acumulable sigue debajo de todo el bloque', () => {
    const r = filasAcreditables(liq({ ivaAcreditable: 100 }))!;
    expect(r.piesGenerales.join(' ')).toContain('ingreso acumulable');
  });

  it('cuadra con la cifra que produce el motor real sobre una caseta timbrada', () => {
    // El escenario del hallazgo, corrido de punta a punta.
    const cuadre = cuadrarViaje({
      viajeId: 'v-peaje', anticipo: 1160, politica: [{ concepto: 'caseta' }],
      estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000 },
      gastos: [{
        id: 'g1', concepto: 'caseta', monto: 1160, fecha: '2026-07-20', cfdiUuid: 'u-caseta',
        // AUDITORÍA 8: CFDI ya verificado — receptor presente a propósito.
        rfcReceptor: 'REC010101AA1',
        xmlVerificado: true, subTotal: 1000, ivaTraslado: 160, formaPago: '03',
      }],
    });
    expect(cuadre.peajeAcreditable).toBe(500);
    const r = filasAcreditables(cuadre)!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.valor).toBe('$500.00');
    expect(peaje.pies.length).toBe(2);
  });

  it('el PDF ya no arma la sección por su cuenta', () => {
    // La sección vivía dibujada a mano dentro de pdf.ts, que es donde no se
    // puede probar lo que dice. Si alguien la reconstruye ahí, esto avisa.
    const src = readFileSync(new URL('./pdf.ts', import.meta.url), 'utf8');
    expect(src).toContain('filasAcreditables');
    expect(src).not.toContain("acred('Estímulo de peaje");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (fiscal, reincidente) — "el renglón 'IVA acreditable
// (LIVA art. 5)' sale VERDE en la misma hoja donde el de ISR sale
// CONDICIONADO por el mismo hecho".
//
// `normas/liva-5.yaml` (`verificado_fuente_primaria`), fracción I, literal:
//
//   «...se consideran estrictamente indispensables las erogaciones efectuadas
//   por el contribuyente QUE SEAN DEDUCIBLES PARA LOS FINES DEL IMPUESTO SOBRE
//   LA RENTA, aun cuando no se esté obligado al pago de este último impuesto.»
//
// y su propia `nota_verificacion`: «El IVA solo es acreditable si la erogación
// es DEDUCIBLE para ISR. No es un requisito aparte: la ley DEFINE
// "estrictamente indispensable" como "deducible para los fines del ISR"».
//
// Medido antes del arreglo, con el diésel de $5,800 del hallazgo (XML
// verificado, clave 15101505, complemento presente, IVA $689.66):
//
//   DEDUC → 'Deducible para ISR — sujeto a permiso CRE vigente' $5,800 'condicionado'
//   ACRED → 'IVA acreditable (LIVA art. 5)'                     $689.66 'bueno' → VERDE
//
// El mismo hecho —un requisito de la DEDUCCIÓN que el motor no verifica—
// condicionaba una cifra y dejaba la otra afirmada sin una sola reserva.
//
// EL ARREGLO ES DE PRESENTACIÓN, NO DE CIFRA. Meter estos tres tipos en
// `SIN_ACREDITAMIENTO` (`engine.ts`) pondría el IVA en CERO en todo diésel bien
// facturado —incluido el del demo, donde `permiso_cre_no_verificable` se
// dispara SIEMPRE que hay XML— y sería peor que el hallazgo: se le quitaría al
// cliente un acreditamiento que la ley sí le concede. Lo que la ley pide es que
// el papel no afirme entero lo que depende de algo sin verificar.
// ═══════════════════════════════════════════════════════════════════════════

describe('filasAcreditables — el IVA no se afirma solo cuando el ISR va condicionado', () => {
  const dieselConPermisoSinVerificar = () => cuadrarViaje({
    viajeId: 'v-iva', anticipo: 5800, politica: [{ concepto: 'diesel' }],
    hidrocarburos: { claves: ['15101505'], unidad: 'LTR', vigenteDesde: '2026-04-24' },
    estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] },
    gastos: [{
      id: 'g1', concepto: 'diesel', monto: 5800, fecha: '2026-07-15', cfdiUuid: 'uuid-1',
      rfcReceptor: 'REC010101AA1', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR',
      tipoComprobante: 'I', complementoHidrocarburos: true,
      formaPago: '03', ivaTraslado: 689.66, iepsTraslado: 400, ocrExtra: { litros: 200 },
    }],
  });

  it('permiso CRE sin verificar: el IVA deja de salir en verde y dice de qué depende', () => {
    const liq = dieselConPermisoSinVerificar();
    // Premisa del escenario: la cifra NO cambia, solo cómo se presenta.
    expect(liq.ivaAcreditable).toBe(689.66);
    expect(liq.diferencias.some((d) => d.tipo === 'permiso_cre_no_verificable')).toBe(true);

    const iva = filasAcreditables(liq)!.filas.find((f) => f.label.startsWith('IVA acreditable'))!;
    expect(iva.valor).toBe('$689.66');
    expect(iva.tono, 'el IVA sigue afirmándose entero mientras el ISR va condicionado').toBe('condicionado');
    // La condición también en el LABEL: el renglón es lo que se skimmea, mismo
    // criterio que el peaje y que 'Deducible para ISR — sujeto a permiso CRE'.
    expect(iva.label).toMatch(/sujeto a la deducibilidad para ISR/i);
    // Y el pie tiene que decir POR QUÉ, con la norma que ata las dos cifras.
    expect(iva.pies.join(' ')).toContain('LIVA art. 5');
    expect(iva.pies.join(' ')).toMatch(/deducible para .*ISR/i);
    expect(iva.pies.join(' ')).toMatch(/permiso CRE/i);
  });

  it('el mismo criterio aplica al complemento no verificable y a la alimentación sin soporte', () => {
    for (const tipo of ['complemento_no_verificable', 'alimentacion_sin_soporte']) {
      const r = filasAcreditables({ ...liq({ ivaAcreditable: 100 }), diferencias: [{ tipo }] })!;
      const iva = r.filas.find((f) => f.label.startsWith('IVA acreditable'))!;
      expect(iva.tono, `${tipo} no condiciona el IVA`).toBe('condicionado');
      expect(iva.pies.length).toBeGreaterThan(0);
    }
  });

  it('sin ninguna condición abierta el IVA SIGUE en verde y sin pies: la cifra no se castiga de más', () => {
    const r = filasAcreditables({ ...liq({ ivaAcreditable: 689.66 }), diferencias: [{ tipo: 'sobre_politica' }] })!;
    const iva = r.filas.find((f) => f.label.startsWith('IVA acreditable'))!;
    expect(iva.tono).toBe('bueno');
    expect(iva.label).toBe('IVA acreditable (LIVA art. 5)');
    expect(iva.pies).toEqual([]);
  });

  it('el arreglo es de PRESENTACIÓN: el motor sigue acreditando el IVA del diésel bien facturado', () => {
    // El guardarraíl del hallazgo. Si alguien "arregla" esto metiendo los tres
    // tipos en `SIN_ACREDITAMIENTO`, el demo del 6-ago imprime IVA $0.00 sobre
    // un CFDI impecable y esta prueba se pone roja.
    expect(dieselConPermisoSinVerificar().ivaAcreditable).toBe(689.66);
  });
});
