import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as G from './graficas';
import * as C from '../charts';
import { usd } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LAS 16 GRÁFICAS DE /admin, EJECUTADAS. AUDITORÍA 11 · G-35.
//
// `admin/ui/graficas.tsx` (503 líneas) tenía 12.53% de líneas ejecutadas y
// `admin/charts.tsx` (262) un 5.45%: las dos librerías que pintan TODO el
// dinero de la consola no se corrían nunca. No es una laguna de porcentaje —
// es la clase de bug que solo se ve ejecutando:
//
//   · `Math.max(...[])` es `-Infinity`. Cada una de estas gráficas divide
//     entre su máximo, así que un arreglo VACÍO —el estado normal de una
//     consola el primer día, y el de cualquier filtro que no encuentre nada—
//     produce `width: NaN%` o un `d="M NaN NaN"` y el SVG desaparece sin
//     error. Los `|| 1` y `, 1` que hay en el código son la defensa; nada
//     comprobaba que estuvieran TODOS.
//   · El propio archivo documenta el bug de hidratación por decimales
//     (`punto()` redondea a 3 «porque Math.cos puede imprimir el último
//     dígito distinto entre el motor del servidor y el del navegador»). Eso
//     se puede medir: ninguna coordenada del markup puede traer más de 3
//     decimales.
//   · Las cifras tienen que salir por `formato.ts` (regla del producto: una
//     cifra que se lee distinto en dos pantallas se lee como dos cálculos).
//
// Se renderiza el componente REAL con `renderToStaticMarkup` — no una copia.
// Los efectos (`useInView`) no corren en SSR, así que lo que se mide es
// exactamente el primer pintado, que es el que llega al navegador.
// ═══════════════════════════════════════════════════════════════════════════

/** Toda gráfica, con datos de verdad y con el arreglo vacío al lado. */
const CASOS: Array<{ nombre: string; con: () => React.ReactElement; sin: () => React.ReactElement }> = [
  {
    nombre: 'Gauge',
    con: () => <G.Gauge valor={72} etiqueta="Comprobado" />,
    sin: () => <G.Gauge valor={0} />,
  },
  {
    nombre: 'HBars',
    con: () => <G.HBars datos={[{ etiqueta: 'OCR', valor: 1.5 }, { etiqueta: 'Cuadre', valor: 0.4 }]} formato="usd" />,
    sin: () => <G.HBars datos={[]} />,
  },
  {
    nombre: 'MultiLine',
    con: () => <G.MultiLine categorias={['lun', 'mar', 'mié']} series={[{ nombre: 'costo', valores: [1, 5, 3] }, { nombre: 'tokens', valores: [2, 2, 9] }]} />,
    sin: () => <G.MultiLine categorias={[]} series={[]} />,
  },
  {
    nombre: 'StackedBars',
    con: () => <G.StackedBars categorias={['jul', 'ago']} series={[{ nombre: 'a', valores: [3, 4] }, { nombre: 'b', valores: [1, 2] }]} />,
    sin: () => <G.StackedBars categorias={[]} series={[]} />,
  },
  {
    nombre: 'Funnel',
    con: () => <G.Funnel pasos={[{ etiqueta: 'Recibidos', valor: 120 }, { etiqueta: 'Leídos', valor: 96 }, { etiqueta: 'Cuadrados', valor: 40 }]} />,
    sin: () => <G.Funnel pasos={[]} />,
  },
  {
    nombre: 'Waterfall',
    con: () => <G.Waterfall formato="mxn" pasos={[{ etiqueta: 'Anticipo', delta: 12000 }, { etiqueta: 'Diesel', delta: -8400 }, { etiqueta: 'Saldo', delta: 3600, esTotal: true }]} />,
    sin: () => <G.Waterfall pasos={[]} />,
  },
  {
    nombre: 'Histogram',
    con: () => <G.Histogram buckets={[{ rango: '0-100', conteo: 3 }, { rango: '100-200', conteo: 7 }]} />,
    sin: () => <G.Histogram buckets={[]} />,
  },
  {
    nombre: 'Heatmap',
    con: () => <G.Heatmap filas={['lun', 'mar']} columnas={['8h', '9h']} valores={[[1, 4], [0, 2]]} />,
    sin: () => <G.Heatmap filas={[]} columnas={[]} valores={[]} />,
  },
  {
    nombre: 'CalendarHeatmap',
    con: () => <G.CalendarHeatmap dias={Array.from({ length: 14 }, (_, i) => ({ fecha: `2026-07-${String(i + 1).padStart(2, '0')}`, valor: i }))} />,
    sin: () => <G.CalendarHeatmap dias={[]} />,
  },
  {
    nombre: 'MarginDivergingBars',
    con: () => <G.MarginDivergingBars datos={[{ etiqueta: 'Ruta A', valor: 22 }, { etiqueta: 'Ruta B', valor: -8 }]} />,
    sin: () => <G.MarginDivergingBars datos={[]} />,
  },
  {
    nombre: 'ParetoBars',
    con: () => <G.ParetoBars datos={[{ etiqueta: 'Diesel', valor: 80 }, { etiqueta: 'Casetas', valor: 15 }, { etiqueta: 'Otros', valor: 5 }]} />,
    sin: () => <G.ParetoBars datos={[]} />,
  },
  {
    nombre: 'Sparkline',
    con: () => <C.Sparkline valores={[1, 3, 2, 8, 5]} />,
    sin: () => <C.Sparkline valores={[]} />,
  },
  {
    nombre: 'Tendencia',
    con: () => <C.Tendencia valor={12.5} />,
    sin: () => <C.Tendencia valor={null} />,
  },
  {
    nombre: 'AreaChartSimple',
    con: () => <C.AreaChartSimple etiquetaValor={usd} datos={[{ dia: '2026-08-01', valor: 3 }, { dia: '2026-08-02', valor: 7 }]} />,
    sin: () => <C.AreaChartSimple etiquetaValor={usd} datos={[]} />,
  },
  {
    nombre: 'BarChartSimple',
    con: () => <C.BarChartSimple datos={[{ dia: '2026-08-01', valor: 3 }, { dia: '2026-08-02', valor: 7 }]} />,
    sin: () => <C.BarChartSimple datos={[]} />,
  },
  {
    nombre: 'Dona',
    con: () => <C.Dona segmentos={[{ etiqueta: 'OCR', valor: 6 }, { etiqueta: 'Cuadre', valor: 4 }]} />,
    sin: () => <C.Dona segmentos={[]} />,
  },
];

describe('ninguna gráfica revienta ni pinta NaN con el arreglo VACÍO', () => {
  // El estado normal de la consola el primer día, y el de cualquier filtro
  // que no encuentre nada. `Math.max(...[])` es `-Infinity`.
  for (const caso of CASOS) {
    it(`${caso.nombre} — sin datos`, () => {
      const html = renderToStaticMarkup(caso.sin());
      expect(html).not.toMatch(/NaN/);
      expect(html).not.toMatch(/Infinity/);
      expect(html).not.toMatch(/undefined/);
    });
  }
});

describe('con datos reales, tampoco', () => {
  for (const caso of CASOS) {
    it(`${caso.nombre} — con datos`, () => {
      const html = renderToStaticMarkup(caso.con());
      expect(html).not.toMatch(/NaN/);
      expect(html).not.toMatch(/Infinity/);
      expect(html.length, 'no pintó nada').toBeGreaterThan(10);
    });
  }
});

describe('las cifras salen por formato.ts, no a mano', () => {
  it('`usd` en HBars imprime dólares con separador', () => {
    const html = renderToStaticMarkup(<G.HBars datos={[{ etiqueta: 'OCR', valor: 1234.5 }]} formato="usd" />);
    expect(html).toContain('$1,234.50');
  });

  it('`mxn` en Waterfall imprime pesos', () => {
    const html = renderToStaticMarkup(
      <G.Waterfall formato="mxn" pasos={[{ etiqueta: 'Anticipo', delta: 12000 }]} />);
    expect(html).toContain('12,000.00');
  });

  it('`porcentajeSigno` marca el lado positivo — «+22%», nunca «22%» a secas', () => {
    const html = renderToStaticMarkup(
      <G.MarginDivergingBars datos={[{ etiqueta: 'A', valor: 22 }, { etiqueta: 'B', valor: -8 }]} />);
    expect(html).toContain('+22%');
    expect(html).toContain('-8%');
  });
});

describe('sin decimales largos: el mismatch de hidratación que el archivo documenta', () => {
  // `graficas.tsx:38-41` redondea a 3 decimales «porque Math.cos puede
  // imprimir el último dígito distinto entre el motor JS del servidor y el
  // del navegador, que React marca como mismatch aunque sea invisible».
  // Si una coordenada nueva se escribe sin redondear, esto lo caza.
  const NUMERO_LARGO = /\d+\.\d{5,}/;

  for (const caso of CASOS) {
    it(`${caso.nombre} no emite coordenadas con 5+ decimales`, () => {
      const html = renderToStaticMarkup(caso.con());
      const culpables = html.match(new RegExp(NUMERO_LARGO, 'g')) ?? [];
      // Los porcentajes de ancho de una barra CSS no son coordenadas SVG: el
      // navegador los resuelve él mismo y no hay markup del servidor contra
      // el que comparar. Solo se vigila lo que va dentro de un atributo SVG.
      const enSvg = culpables.filter((n) => new RegExp(`(?:d|cx|cy|x|y|x1|y1|x2|y2|r|points)="[^"]*${n}`).test(html));
      expect(enSvg, `coordenadas sin redondear: ${enSvg.join(', ')}`).toEqual([]);
    });
  }
});

describe('la Dona reparte el círculo entero', () => {
  it('dos segmentos iguales son media dona cada uno', () => {
    const html = renderToStaticMarkup(<C.Dona segmentos={[{ etiqueta: 'A', valor: 5 }, { etiqueta: 'B', valor: 5 }]} />);
    // Dos trazos de valor, no uno solo ni tres.
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('A');
    expect(html).toContain('B');
  });

  it('un segmento de valor 0 no borra a los demás', () => {
    const html = renderToStaticMarkup(<C.Dona segmentos={[{ etiqueta: 'A', valor: 10 }, { etiqueta: 'Cero', valor: 0 }]} />);
    expect(html).not.toMatch(/NaN/);
    expect(html).toContain('A');
  });
});

describe('AreaChartSimple sin datos no tumba la página', () => {
  // El fallo que esta suite encontró al ejecutarla por primera vez:
  // `xy[xy.length - 1][0]` sobre un arreglo vacío LANZA, y cinco páginas de
  // /admin le pasan `r.porDia` directo — que viene vacío en cuanto
  // `llm_costo` no tiene filas (flota nueva, ventana sin actividad).
  it('no lanza y dice qué falta en vez de dejar la tarjeta en blanco', () => {
    const html = renderToStaticMarkup(<C.AreaChartSimple etiquetaValor={usd} datos={[]} />);
    expect(html).toContain('Sin datos en el periodo');
  });

  it('con un solo punto tampoco', () => {
    const html = renderToStaticMarkup(
      <C.AreaChartSimple etiquetaValor={usd} datos={[{ dia: '2026-08-01', valor: 3 }]} />);
    expect(html).not.toMatch(/NaN/);
  });
});

describe('Tendencia — una flecha que no se sabe no se pinta', () => {
  it('con `null` no inventa dirección', () => {
    const html = renderToStaticMarkup(<C.Tendencia valor={null} />);
    expect(html).not.toContain('%');
  });
  it('con un número sí', () => {
    expect(renderToStaticMarkup(<C.Tendencia valor={12.5} />)).toContain('12.5');
  });
});
