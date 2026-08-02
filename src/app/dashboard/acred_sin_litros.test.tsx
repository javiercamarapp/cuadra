import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Acred } from './acred';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · CRÍTICO (frontend) — "La tarjeta destacada del panel imprime
// `0 L` en las tres rutas que el demo puede tomar".
//
// El estímulo de diésel solo suma litros que cumplan DOS condiciones que
// entran por puertas distintas: `claveProdServ` (solo la escribe el parser del
// XML, `intake/cfdi_xml.ts:115`) y `ocrExtra.litros` (solo lo escribe el OCR
// de una foto, `intake/ocr.ts:406`). El gasto de diésel del viaje demo se
// inserta sin `ocr_extra` (`seed.sql:121-123`), y una foto por WhatsApp nunca
// produce `claveProdServ`. Resultado: `litrosDiesel = 0` por las dos rutas que
// el guion del demo puede tomar.
//
// Con eso, `dashboard/page.tsx` pintaba "0 L" en `text-4xl md:text-5xl`, en
// color de acento, como el elemento más grande de la pantalla, con el pie
// "LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente". El
// guion (`GUION_DEMO.md:113-120`) manda narrar ese número como "el dato duro:
// cuántos litros son elegibles... Él multiplica". El contralor multiplica cero.
//
// El panel de detalle ya distinguía las dos cosas (`[id]/page.tsx:138` oculta
// la tarjeta si no hay litros). El que se proyecta, no. Esta prueba fija que
// la tarjeta no vuelva a AFIRMAR una medición que no ocurrió.
//
// Se prueba EJECUTANDO el componente, no leyendo su texto fuente: la única
// prueba que tenía el panel (`foto_no_expuesta.test.ts`) hace lo segundo, y
// este repo ya documentó ese patrón como insuficiente en seis ocasiones.
// ═══════════════════════════════════════════════════════════════════════════

const BASE_LITROS = 'LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente';

const render = (valor: number) =>
  renderToStaticMarkup(
    <Acred titulo="Diésel elegible para el estímulo" valor={valor} unidad="litros" base={BASE_LITROS} destacar />,
  );

describe('la tarjeta de litros no afirma una medición que no ocurrió', () => {
  it('el escenario del demo: sin litros medidos NO imprime "0 L"', () => {
    const html = render(0);
    expect(html, 'un cero en el tamaño más grande de la pantalla se lee como un resultado medido').not.toContain('0 L');
  });

  it('en su lugar dice que no hubo medición, y lo dice en el pie', () => {
    const html = render(0);
    expect(html).toContain('—');
    expect(html, 'el contralor tiene que poder distinguir "cero elegibles" de "no medí"').toContain('Sin litros medidos');
  });

  it('sin medición la tarjeta deja de gritar: pierde el acento', () => {
    const html = render(0);
    expect(
      html,
      'un guion grande en verde acento se lee como un resultado igual que un cero grande',
    ).not.toContain('var(--accent)');
  });

  it('control: con litros medidos nada cambia — número, acento y pie original', () => {
    const html = render(113);
    expect(html).toContain('113');
    expect(html).toContain('L');
    expect(html, 'el arreglo no puede apagar la tarjeta cuando sí hay dato').toContain('var(--accent)');
    expect(html).toContain('LIF 2026');
    expect(html).not.toContain('Sin litros medidos');
  });

  it('control: las tarjetas en pesos no se tocan — un IVA de $0 sigue siendo $0', () => {
    const html = renderToStaticMarkup(
      <Acred titulo="IVA acreditable" valor={0} base="LIVA, Art. 5 — CFDI con IVA desglosado" />,
    );
    expect(html, 'cero pesos acreditables SÍ es una medición: no hubo IVA que acreditar').toContain('$0');
    expect(html).not.toContain('Sin litros medidos');
  });
});
