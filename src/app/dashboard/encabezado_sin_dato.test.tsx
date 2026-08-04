import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import CifraGrande from './cifra-grande';
import AvanceCierre from './avance-cierre';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-11 (ALTO, frontend) — «Con la base caída, la cifra más
// grande del panel dice `$0.00` justo encima del cartel que avisa que no se
// pudo leer nada».
//
// El encabezado de /dashboard se sacó FUERA del condicional al arreglar el
// scroll, y con él salió del alcance de `estadoPanel`. Así que con `kpis =
// null` la misma pantalla dice, a 3.25rem, "Señalado por el motor $0.00" y
// diez centímetros más abajo "No se pudieron cargar los datos… esto NO
// significa que no haya liquidaciones, significa que no se pudieron leer".
//
// La barra de avance tenía la variante barata del mismo fallo: `viajes ?? []`
// convierte una lectura caída en la frase "No hay viajes iniciados en este
// periodo", que es una afirmación sobre la operación del cliente.
//
// El repo ya lo resolvió bien en el otro Inicio: `inicio-operacion.tsx:93`
// escribe `?? '—'`.
// ═══════════════════════════════════════════════════════════════════════════

describe('la cifra grande no inventa un cero cuando no hubo lectura', () => {
  it('sin dato pinta una raya, no $0.00', () => {
    const html = renderToStaticMarkup(
      <CifraGrande valor={null} etiqueta="Señalado por el motor" formato="mxn" nota="Sobre política y duplicados" />,
    );
    expect(html, 'la cifra más grande de la pantalla afirmando cero sobre una base caída').not.toContain('$0.00');
    expect(html).toContain('—');
  });

  it('con dato no se apaga (el count-up arranca en 0, así que se afirma la rama, no el dígito)', () => {
    const html = renderToStaticMarkup(
      <CifraGrande valor={12400} etiqueta="Señalado por el motor" formato="mxn" />,
    );
    expect(html).toContain('$');
  });
});

describe('el avance de cierre no afirma sobre viajes que no se leyeron', () => {
  it('con la consulta caída NO dice «no hay viajes iniciados»', () => {
    const html = renderToStaticMarkup(<AvanceCierre viajes={null} ahoraMs={Date.parse('2026-08-04T12:00:00Z')} />);
    expect(html, 'una lectura caída se estaba leyendo como una flota parada').not.toContain('No hay viajes iniciados');
    expect(html).toMatch(/no se pudo/i);
  });

  it('con cero viajes leídos SÍ lo dice: ahí es una medición', () => {
    const html = renderToStaticMarkup(<AvanceCierre viajes={[]} ahoraMs={Date.parse('2026-08-04T12:00:00Z')} />);
    expect(html).toContain('No hay viajes iniciados');
  });
});

// El defecto no vive en los componentes sino en cómo la página los alimenta:
// con `?? 0` y `?? []` el componente nunca llega a ver el null.
describe('la página no rellena el hueco antes de llegar al componente', () => {
  const fuente = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

  it('la cifra grande recibe el null tal cual', () => {
    expect(fuente).not.toMatch(/valor=\{kpis\?\.[a-zA-Z]+\s*\?\?\s*0\}/);
  });

  it('el avance de cierre recibe el null tal cual', () => {
    expect(fuente).not.toMatch(/viajes=\{viajes\s*\?\?\s*\[\]\}/);
  });
});
