import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-25 (a) — «el rail se monta sin condición de rol».
//
// El gate de la RUTA quedó cerrado en `2fb1982` (`rol_no_mirado.test.ts`), y
// esa es la capa que de verdad protege el dato. Lo que queda es que la pieza
// más visible del panel se monte igual para todos y dependa de UNA sola capa:
// si mañana alguien toca el handler, el jefe de tráfico ve una caja que le
// pregunta "¿cuánto llevo comprobado?" y le contesta.
//
// `chrome.tsx` ya recibe el rol —lo pinta en el badge del sidebar— así que la
// segunda capa cuesta una condición. Y de paso el encargado deja de cargar con
// 300 px de una herramienta que solo sabe responder de dinero.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const DashboardChrome = (await import('./chrome')).default;

const render = (rol: string) =>
  renderToStaticMarkup(<DashboardChrome nombre="Quien sea" rol={rol}><p>contenido</p></DashboardChrome>);

describe('el rail del asistente no se monta para quien no ve el dinero', () => {
  it('el ENCARGADO no recibe la caja que responde de pesos', () => {
    expect(render('encargado')).not.toContain('Asistente de negocio');
  });

  it('el OPERADOR tampoco', () => {
    expect(render('operador')).not.toContain('Asistente de negocio');
  });

  it('CONTROL · el dueño de la flota sí', () => {
    expect(render('flota_admin')).toContain('Asistente de negocio');
  });

  it('CONTROL · el contador vive del dinero y sí', () => {
    expect(render('contador')).toContain('Asistente de negocio');
  });

  it('el contenido de la página se pinta para todos', () => {
    expect(render('encargado')).toContain('contenido');
    expect(render('flota_admin')).toContain('contenido');
  });
});

// ── AUDITORÍA 11 · G-56 (MEDIO, legal) ────────────────────────────────────
//
// El aviso de privacidad de la flota estaba publicado en `/aviso/[tenant]` y
// ninguna de las 20 páginas del panel lo enlazaba. La LFPDPPP art. 15 exige
// que esté DISPONIBLE al titular; un aviso que nadie enlaza está archivado, no
// disponible. `/mis-viajes` ya lo enlazaba desde el PR #7; el panel no.
describe('el aviso de privacidad de la flota se alcanza desde el panel', () => {
  it('el marco enlaza /aviso/<tenant> cuando hay tenant', () => {
    const html = renderToStaticMarkup(
      <DashboardChrome nombre="Javier" rol="flota_admin" tenantId="t-123"><p>x</p></DashboardChrome>,
    );
    expect(html).toContain('/aviso/t-123');
  });

  it('sin tenant no se inventa un enlace roto', () => {
    const html = renderToStaticMarkup(
      <DashboardChrome nombre="Javier" rol="superadmin" tenantId={null}><p>x</p></DashboardChrome>,
    );
    expect(html).not.toContain('/aviso/');
  });
});
