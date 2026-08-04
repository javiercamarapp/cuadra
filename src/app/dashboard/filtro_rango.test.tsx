import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalFilter } from '../admin/ui/global-filter';
import { RANGO_POR_DEFECTO } from './ventana';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-12 (ALTO, frontend) — "El botón 30d del panel no hace nada".
//
// `GlobalFilter` enlaza la opción `pordefecto` SIN el parámetro `?rango=`
// (`global-filter.tsx:34`), porque esa es la que la página asume cuando la URL
// viene limpia. El contrato solo se sostiene si el `pordefecto` que se le pasa
// es EL MISMO que la página resuelve sin `?rango=`.
//
// En /dashboard no lo era: la página resolvía '7' (`page.tsx:73`) y el filtro
// declaraba `pordefecto="30"`. Clic en "30d" → href sin parámetro →
// `/dashboard` → la página vuelve a resolver '7' → misma pantalla y el pill
// activo salta de vuelta a 7d. Los 30 días eran inalcanzables desde la
// interfaz, que es la única forma que tiene el contralor de mover la ventana
// de sus acreditables fiscales.
//
// Dos aserciones distintas, y las dos hacen falta:
//   1. el round-trip del componente (href → rango leído → misma opción), y
//   2. la coherencia con la página que lo monta, que es donde vivía el bug.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que la página lee de la URL: `?rango=` o, si no viene, el default. */
function rangoLeido(href: string, pordefecto: string): string {
  const qs = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  return new URLSearchParams(qs).get('rango') ?? pordefecto;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

describe('el filtro de rango: cada pill lleva a su propio rango', () => {
  for (const pordefecto of ['7', '30', 'todo']) {
    it(`con pordefecto="${pordefecto}", los tres enlaces vuelven a leerse como 7/30/todo`, () => {
      const html = renderToStaticMarkup(
        <GlobalFilter base="/dashboard" activo={pordefecto} pordefecto={pordefecto} />,
      );
      expect(hrefs(html).map((h) => rangoLeido(h, pordefecto))).toEqual(['7', '30', 'todo']);
    });
  }

  it('el `extra` (?tenant=) sobrevive a los tres clics', () => {
    const html = renderToStaticMarkup(
      <GlobalFilter base="/dashboard" activo="7" pordefecto="7" extra={{ tenant: 'abc' }} />,
    );
    for (const h of hrefs(html)) expect(h).toContain('tenant=abc');
  });
});

// ── La coherencia con las páginas que lo montan ────────────────────────────
//
// Se lee el fuente porque el defecto no vive en ninguno de los dos módulos por
// separado: cada uno es correcto solo, y el bug es la CONTRADICCIÓN entre el
// `pordefecto` que la página declara y el rango que la misma página resuelve.

const PAGINAS = [
  { archivo: new URL('./page.tsx', import.meta.url), nombre: 'dashboard/page.tsx' },
  { archivo: new URL('./analitica/page.tsx', import.meta.url), nombre: 'dashboard/analitica/page.tsx' },
];

/**
 * El default de la página: o lo resuelve `resolverVentana` (y entonces es
 * `RANGO_POR_DEFECTO`, o el segundo argumento si lo pasa), o es la última rama
 * del ternario que la página escribe a mano.
 */
function defaultDeLaPagina(fuente: string): string {
  const conHelper = fuente.match(/resolverVentana\(([^)]*)\)/);
  if (conHelper) {
    const args = conHelper[1].split(',');
    const explicito = args[1]?.trim().match(/^'([^']+)'$/);
    return explicito ? explicito[1] : RANGO_POR_DEFECTO;
  }
  const linea = fuente.split('\n').find((l) => /const rango = /.test(l));
  expect(linea, 'la página dejó de resolver `rango` con el patrón conocido').toBeTruthy();
  const m = linea!.match(/:\s*'([^']+)';\s*$/);
  expect(m, `no se pudo leer el default de: ${linea}`).toBeTruthy();
  return m![1];
}

function pordefectoDelFiltro(fuente: string): string {
  const m = fuente.match(/<GlobalFilter[^>]*pordefecto="([^"]+)"/);
  // Sin `pordefecto` explícito, `global-filter.tsx` usa '7'.
  return m ? m[1] : '7';
}

describe('el pill que la página asume es el mismo que el filtro enlaza sin parámetro', () => {
  for (const { archivo, nombre } of PAGINAS) {
    it(nombre, () => {
      const fuente = readFileSync(archivo, 'utf8');
      expect(
        pordefectoDelFiltro(fuente),
        'el pill que se enlaza SIN ?rango= tiene que ser el que la página resuelve sin ?rango=, o el clic no hace nada',
      ).toBe(defaultDeLaPagina(fuente));
    });
  }
});
