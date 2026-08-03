import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Acred } from './acred';
import { resumenCuadre } from '@/lib/cuadra/cuadre/resumen';

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (fiscal) — el estímulo de peaje se afirma en verde,
// citando el artículo, sin ninguna de las cuatro condiciones que el PDF sí
// imprime.
//
// La ficha `normas/lif-2026-20-A.yaml` (verificado_fuente_primaria) dice, en
// `estimulo_peaje.texto_vigente`, que el estímulo es para quien se dedique
// EXCLUSIVAMENTE al transporte, que UTILICE la Red Nacional de Autopistas de
// Cuota, con ingresos anuales MENORES A 300 MILLONES, y que NO aplica a partes
// relacionadas (LISR 179). Los propios hallazgos de la ficha lo dicen: el motor
// «aplica el 50% a TODO gasto con concepto caseta» y «no conoce los ingresos de
// la flota ni su relación de partes».
//
// `liquidacion/acreditable.ts` ya resuelve esto bien para el PDF: label con
// «— sujeto a elegibilidad», `tono: 'condicionado'` (tinta neutra) y dos pies,
// uno de los cuales dice literalmente que **Likida NO verifica la
// elegibilidad**. Las otras tres superficies —el panel, el detalle y
// WhatsApp— lo pintaban como un derecho ya ganado.
//
// Un contralor que lea «Peaje (50%) $12,400» en verde a 5xl y lo meta en su
// declaración está tomando una posición fiscal que nadie verificó.
// ═══════════════════════════════════════════════════════════════════════════

describe('el panel no afirma el estímulo de peaje como un derecho ganado', () => {
  const pintar = () => renderToStaticMarkup(
    <Acred titulo="Peaje (50%)" valor={12400} base="Estímulo de autopistas · LIF 2026, Art. 20-A" condicionado />,
  );

  it('el renglón dice que está sujeto a elegibilidad — es lo que se skimmea', () => {
    expect(pintar()).toMatch(/sujeto a elegibilidad/i);
  });

  it('y el pie dice quién NO la verifica, que es el dato accionable', () => {
    expect(pintar()).toMatch(/no verifica/i);
  });

  it('no se pinta con el color de acento: un condicionado no se lee como un logro', () => {
    expect(pintar()).not.toContain('var(--accent)');
  });

  // CONTROL. El IVA acreditable SÍ es una cifra medida del XML; el arreglo no
  // puede volver condicional todo lo acreditable.
  it('control: una tarjeta no condicionada conserva su base y su cifra', () => {
    const html = renderToStaticMarkup(
      <Acred titulo="IVA acreditable" valor={581.38} base="LIVA, Art. 5 — CFDI con IVA desglosado" />,
    );
    expect(html).toContain('581');
    expect(html).toContain('LIVA');
    expect(html).not.toMatch(/sujeto a elegibilidad/i);
  });
});

describe('WhatsApp tampoco lo afirma', () => {
  const liq = {
    viajeId: 'v1', totalComprobado: 24800, totalAnticipo: 24800, diferencia: 0,
    estatus: 'cuadrada' as const, diferencias: [],
    ivaAcreditable: 0, peajeAcreditable: 12400, litrosDieselAcreditables: 0, iepsAcreditable: 0,
  };

  it('el bloque acreditable del contralor lleva la reserva, como el PDF', () => {
    const texto = resumenCuadre(liq as never, true, 'contralor');
    expect(texto).toContain('12,400');
    expect(texto, 'el PDF sí lo dice y el mensaje no').toMatch(/sujeto a elegibilidad/i);
  });
});
