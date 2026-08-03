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

  // ── ALTO de la auditoría 10 (frontend), 3-ago ────────────────────────────
  //
  // Esta prueba fijaba lo contrario, con esta premisa escrita: «cero pesos
  // acreditables SÍ es una medición: no hubo IVA que acreditar».
  //
  // Es falsa. `engine.ts:898` es un `continue` que descarta el gasto ANTES de
  // mirar `ivaTraslado` o `subTotal`:
  //
  //     if (!g.xmlVerificado) continue;
  //     ...
  //     if ((g.ivaTraslado ?? 0) > 0) ivaAcreditable += ...
  //     if (g.concepto === 'caseta' && ...) peajeAcreditable += ...
  //
  // Una FOTO nunca produce `xmlVerificado`. Y las fotos son el flujo que el
  // producto vende (GUION_DEMO.md:60-62: «Mandas fotos de tickets reales»).
  // Así que en el camino normal el panel imprimía «IVA acreditable $0.00» y
  // «Peaje (50%) $0.00» en el tamaño más grande de la pantalla, cuando lo
  // cierto es que no llegó ningún XML y no se pudo medir nada. Un CFDI de
  // diésel de $4,200 traslada ~$581 de IVA — lo trae el propio XML del seed.
  //
  // Es el mismo defecto del CRÍTICO de los litros, dos tarjetas a la derecha.
  // El arreglo de aquel se condicionó a `unidad === 'litros'` y por eso no las
  // alcanzó.
  it('un IVA de $0 tampoco se afirma: no es «no hubo IVA», es «no llegó ningún XML»', () => {
    const html = renderToStaticMarkup(
      <Acred titulo="IVA acreditable" valor={0} base="LIVA, Art. 5 — CFDI con IVA desglosado" />,
    );
    expect(html, 'el cero grande se lee como un resultado medido, y no lo es').not.toContain('$0');
    expect(html).toContain('—');
    expect(html, 'y el pie tiene que decir qué falta').toMatch(/CFDI|XML/);
  });

  it('el peaje en $0 recibe el mismo trato', () => {
    const html = renderToStaticMarkup(
      <Acred titulo="Peaje (50%)" valor={0} base="Estímulo de autopistas · LIF 2026, Art. 20-A" />,
    );
    expect(html).not.toContain('$0');
    expect(html).toContain('—');
  });

  // CONTROL. Con pesos de verdad medidos, la tarjeta no se apaga: el arreglo
  // distingue «no medí» de «medí y dio cero», no borra la cifra.
  it('control: con IVA medido la tarjeta imprime la cifra y su pie original', () => {
    const html = renderToStaticMarkup(
      <Acred titulo="IVA acreditable" valor={581.38} base="LIVA, Art. 5 — CFDI con IVA desglosado" />,
    );
    expect(html).toContain('581');
    expect(html).toContain('LIVA');
    // El pie original lleva su propio guion largo, así que la señal es la
    // cifra en la ranura del valor, no la ausencia del carácter.
    expect(html).toMatch(/>\$?581/);
    expect(html).not.toMatch(/Sin .* medid/);
  });
});
