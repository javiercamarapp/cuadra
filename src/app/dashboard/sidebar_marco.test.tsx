import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-17 (MEDIO ×2, frontend, REINCIDENTE) — el marco del panel
// del cliente.
//
//  · CERO `aria-current` en todo el producto. El sidebar de /dashboard monta
//    23 links y ninguno le dice al lector de pantalla cuál es la página en la
//    que estás: se anuncian los 23 igual, y quien navega por teclado o con
//    voz no tiene forma de ubicarse. Es una línea por link.
//
//  · 23 ETIQUETAS DENTRO DE 56 px. `MARCO_SIDEBAR` colapsa el carril a 72 px
//    debajo de `lg` (el `w-[72px] lg:w-[232px]` que el propio marco declara)
//    pero `sidebar-nav.tsx` pinta el texto igual, en una sola variante. En una
//    tableta de 1024 px —el equipo del contralor en la sala— los 23 nombres se
//    apilan dentro de 56 px útiles. `/admin` ya resolvió esto con una variante
//    de solo íconos; el panel del cliente no.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/cuadre',
  useSearchParams: () => new URLSearchParams(),
}));

const SidebarNav = (await import('./sidebar-nav')).default;

const html = renderToStaticMarkup(<SidebarNav rol="flota_admin" />);

describe('el sidebar dice en qué página estás', () => {
  it('el link de la página activa lleva aria-current="page"', () => {
    expect(html, 'los 23 links se anunciaban idénticos').toMatch(/aria-current="page"/);
  });

  it('y solo uno lo lleva', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('el que lo lleva es el de la ruta actual', () => {
    const activo = html.match(/<a[^>]*aria-current="page"[^>]*>/)![0];
    expect(activo).toContain('/dashboard/cuadre');
  });
});

describe('debajo de lg el carril mide 72 px y las etiquetas lo saben', () => {
  it('el nombre de cada item se oculta en el carril angosto', () => {
    // La misma técnica que `chrome.tsx` ya usa para el badge de rol y el
    // nombre del usuario: el texto vive en un <span> que aparece desde `lg`.
    expect(html, '23 etiquetas dentro de 56 px útiles en una tableta').toContain('hidden lg:inline');
  });

  it('sin etiqueta visible, el ícono conserva el nombre accesible', () => {
    // Si el texto se oculta con CSS sigue en el DOM para el lector de
    // pantalla, pero el usuario con ratón necesita el tooltip.
    expect(html).toMatch(/title="[^"]+"/);
  });

  it('los encabezados de sección también se retiran del carril angosto', () => {
    // Un "DOCUMENTOS & DINERO" partido en cuatro renglones de 56 px es peor
    // que no ponerlo.
    expect(html).toMatch(/class="[^"]*hidden lg:[^"]*"[^>]*>\s*Documentos/i);
  });
});
