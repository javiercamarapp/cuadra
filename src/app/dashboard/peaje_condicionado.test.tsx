import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { KpiTile } from '../admin/ui/kit';
import { ETIQUETA_PEAJE_CORTA, NOTA_PEAJE_PANEL } from '@/lib/cuadra/liquidacion/acreditable';
import { Acred } from './acred';
import { resumenCuadre } from '@/lib/cuadra/cuadre/resumen';

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (fiscal) — el estímulo de peaje se afirma en verde,
// citando el artículo, sin ninguna de las cuatro condiciones que el PDF sí
// imprime.
//
// La ficha `normas/lif-2026-20-A.yaml` dice, en
// `estimulo_peaje.texto_vigente`, que el estímulo es para quien se dedique
// EXCLUSIVAMENTE al transporte, que UTILICE la Red Nacional de Autopistas de
// Cuota, con ingresos anuales MENORES A 300 MILLONES, y que NO aplica a partes
// relacionadas (LISR 179).
//
// (Esta prueba decía «(verificado_fuente_primaria)». El sello de esa ficha bajó
// a `evidencia_corroborante` / `fuente_secundaria` en `5bcc3be`: el proxy da 403
// contra diputados y DOF, así que su texto no se pudo cotejar contra fuente
// primaria. La reserva que este arreglo imprime vale MÁS con el sello bajo, no
// menos — pero el comentario ya no podía seguir afirmando lo contrario.)
//
// Los propios hallazgos de la ficha lo dicen: el motor
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

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-05, la mitad de D1 — «el panel CONSUME la etiqueta
// condicionada, no la reescribe».
//
// Las pruebas de arriba ejercen `Acred`, un componente que el panel de HOY no
// monta: `master` reestructuró /dashboard y las tres tarjetas fiscales son
// `KpiTile`. Así que la reserva estaba probada en una pieza que nadie ve, y la
// pantalla que se proyecta seguía diciendo «Peaje (50%) · Estímulo de
// autopistas · LIF 2026, Art. 20-A», sin ninguna de las cuatro condiciones.
//
// Las cadenas vienen de `liquidacion/acreditable.ts` —el motor, que es quien
// decide la reserva— y no se reescriben aquí: si el panel las teclea por su
// cuenta, vuelve a ser una cuarta superficie que puede divergir.
// ═══════════════════════════════════════════════════════════════════════════
describe('las pantallas que HOY se montan también llevan la reserva', () => {
  const fuentes = [
    ['dashboard/page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')],
    ['facturacion/page.tsx', readFileSync(new URL('./facturacion/page.tsx', import.meta.url), 'utf8')],
  ] as const;

  it.each(fuentes)('%s usa la etiqueta del motor, no una propia', (_n, src) => {
    expect(src, 'el rótulo del peaje se estaba escribiendo a mano en la pantalla').toContain('ETIQUETA_PEAJE_CORTA');
    expect(src).toContain('NOTA_PEAJE_PANEL');
  });

  it('y esa etiqueta dice lo que el PDF dice', () => {
    expect(ETIQUETA_PEAJE_CORTA).toMatch(/sujeto a elegibilidad/i);
    expect(NOTA_PEAJE_PANEL).toMatch(/no verifica/i);
  });

  it('el pie condicionado se puede leer en la tarjeta que sí se monta', () => {
    const html = renderToStaticMarkup(
      <KpiTile icono={<span />} etiqueta={ETIQUETA_PEAJE_CORTA} valor={12400} formato="mxn" nota={NOTA_PEAJE_PANEL} />,
    );
    expect(html).toMatch(/sujeto a elegibilidad/i);
    expect(html).toMatch(/no verifica/i);
  });
});
