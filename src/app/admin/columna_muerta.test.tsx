import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AsistenteExpandible, { ANCHO_ASIDE, HUECO_ASIDE } from './asistente-expandible';
import type { ResumenNegocio } from '@/lib/admin/negocio';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (frontend) — «/admin Inicio reserva 292 px para un
// panel que está oculto: por debajo de 1280 px la consola deja una columna
// muerta».
//
// El `<aside>` del Asistente es `hidden xl:flex` — a partir de 1280 px. La
// columna de contenido de su izquierda medía `calc(100% - 292px)` en un
// `style` EN LÍNEA, sin condición de breakpoint. Abierta la consola en una
// ventana de 1200 px (un proyector de 1152×864, o el navegador sin maximizar
// en un portátil de 1366), el `aside` pasa a `display:none` y el contenido
// —saludo, contador de MRR, gráfica de barras, tablas— se encoge al ~68% del
// ancho disponible dejando 292 px de fondo difuminado con nada encima.
//
// Es la pantalla que el equipo usa a diario, no la del contralor; por eso es
// MEDIO. Cobra factura el día que alguien enseñe la consola en una laptop que
// no sea la de siempre.
//
// Se prueba EJECUTANDO el componente: el hallazgo está en el `style` que sale
// renderizado, no en el texto fuente.
// ═══════════════════════════════════════════════════════════════════════════

const RESUMEN = {
  tenants: 1, flotas: [], viajesProcesados: 12, costoIaUsd: 3.4, tokensIn: 1000, tokensOut: 500,
  porFase: [], porModelo: [], porServicio: [], porDia: [], facturasPorDia: [], facturasTotal: 8,
  tendenciaCosto: null, tendenciaTokens: null,
} satisfies ResumenNegocio;

const pintar = () => renderToStaticMarkup(
  <AsistenteExpandible
    main={<div id="contenido">gráficas</div>}
    asideTop={<div id="accesos">accesos rápidos</div>}
    resumen={RESUMEN}
  />,
);

describe('la consola no reserva el ancho de un panel que está oculto', () => {
  it('el ancho del `aside` NO se descuenta en un `style` en línea, que no tiene breakpoint', () => {
    expect(
      pintar(),
      `un style en línea aplica a TODOS los anchos, y el aside solo existe desde 1280px`,
    ).not.toMatch(/style="[^"]*width:\s*calc\(100% - \d+px\)/);
  });

  it('toda reserva del hueco del aside viaja detrás del mismo breakpoint que el aside', () => {
    const html = pintar();
    // Cualquier utilidad que mencione el hueco tiene que ir prefijada `xl:`,
    // que es donde el `<aside hidden xl:flex>` empieza a ocupar espacio.
    const reservas = [...html.matchAll(new RegExp(`[^\\s"]*${HUECO_ASIDE}px[^\\s"]*`, 'g'))].map((m) => m[0]);
    for (const r of reservas) {
      expect(r, `«${r}» reserva el hueco del aside sin condicionarlo a xl:`).toMatch(/(^|:)xl:/);
    }
  });

  it('por debajo de xl la columna de contenido ocupa el ancho completo', () => {
    expect(pintar()).toMatch(/class="[^"]*\bw-full\b/);
  });

  // EL HUECO Y EL ASIDE NO PUEDEN DIVERGIR. 292 = 276 del panel + 16 del gap;
  // si alguien mueve `ANCHO_ASIDE` y la clase se queda escrita a mano, vuelve
  // el mismo defecto con otro número.
  it('el hueco reservado es exactamente el ancho del aside más su gap', () => {
    expect(HUECO_ASIDE).toBe(ANCHO_ASIDE + 16);
    expect(pintar(), 'la clase con el hueco dejó de coincidir con ANCHO_ASIDE').toContain(`${HUECO_ASIDE}px`);
  });

  // CONTROL. El panel sigue ahí y el contenido también: el arreglo es de
  // ancho, no de contenido.
  it('control: se siguen pintando el contenido central y el panel del Asistente', () => {
    const html = pintar();
    expect(html).toContain('gráficas');
    expect(html).toContain('accesos rápidos');
    expect(html).toContain('Asistente de negocio');
  });
});
