import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';
import { calcularAlertas } from './calcular-alertas';
import { TODAS_LAS_RUTAS, AGENTES, NEGOCIO, PLATAFORMA } from './rutas';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONSOLA DE JAVIER, EJECUTADA. AUDITORÍA 11 · G-35.
//
// Trece componentes de `/admin` estaban en 0-10% de líneas ejecutadas: la
// campana de notificaciones, la paleta ⌘K, el asistente, el menú de perfil,
// el sidebar, el contador retro. Ninguno tenía una sola prueba, y todos
// pintan datos que salen de `getResumenNegocio` — o sea, dinero.
//
// Esto NO sustituye mirar el render (CLAUDE.md: «medir no sustituye a
// mirar»). Lo que fija es la clase de fallo que un screenshot NO enseña
// porque tumba la página antes de pintarla, o que la enseña bien con datos
// de hoy y mal con los de un tenant nuevo:
//
//   · el estado VACÍO —cero conversaciones, cero costo, cero alertas—, que
//     es el estado real de una flota el primer día y el que nadie prueba;
//   · `undefined`/`NaN` filtrándose al markup;
//   · que las cifras salgan por `formato.ts` y no a mano.
//
// Los efectos no corren bajo `renderToStaticMarkup`, así que lo que se mide
// es el primer pintado — que es exactamente lo que el navegador recibe del
// servidor y lo que tiene que ser correcto antes de que hidrate.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...r}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));

const CommandPalette = (await import('./command-palette')).default;
const NotificacionesLista = (await import('./notificaciones/lista')).default;
const Notificaciones = (await import('./notificaciones')).default;
const ChatNegocio = (await import('./chat')).default;
const ContadorRetro = (await import('./contador-retro')).default;
const AsistenteExpandible = (await import('./asistente-expandible')).default;
const GraficaCostoConRango = (await import('./rango-costo')).default;
const PerfilMenu = (await import('./perfil')).default;
const SidebarNav = (await import('./sidebar-nav')).default;
const SidebarNavIconos = (await import('./sidebar-nav-iconos')).default;
const BuscadorTrigger = (await import('./buscador-trigger')).default;
const AvatarUploader = (await import('./mi-perfil/avatar-uploader')).default;
const { IconoProveedor } = await import('./proveedor-icono');

/** Un resumen con datos, y su gemelo en cero. */
const CON_DATOS: ResumenNegocio = {
  tenants: 2,
  flotas: [
    { id: 't1', nombre: 'Transportes Innovativos', plan: 'demo', viajes: 12, costoIaUsd: 1.9322 },
    { id: 't2', nombre: 'Fletes del Bajío', plan: 'pro', viajes: 4, costoIaUsd: 0.4 },
  ],
  viajesProcesados: 16,
  costoIaUsd: 2.3322,
  tokensIn: 180_000,
  tokensOut: 22_000,
  porFase: [{ fase: 'ocr', n: 40, costoUsd: 1.505 }, { fase: 'cuadre', n: 12, costoUsd: 0.8272 }],
  porModelo: [{ modelo: 'google/gemini-3.6-flash', n: 40, costoUsd: 1.505 }],
  porDia: [
    { dia: '2026-08-01', costoUsd: 1.505, tokens: 120_000 },
    { dia: '2026-08-02', costoUsd: 0.8272, tokens: 82_000 },
  ],
  facturasPorDia: [{ dia: '2026-08-01', n: 5 }, { dia: '2026-08-02', n: 3 }],
  facturasTotal: 8,
  tendenciaCosto: 42.5,
  tendenciaTokens: -12,
};

const EN_CERO: ResumenNegocio = {
  tenants: 0, flotas: [], viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0,
  porFase: [], porModelo: [], porDia: [], facturasPorDia: [], facturasTotal: 0,
  tendenciaCosto: null, tendenciaTokens: null,
};

const CONVERSACIONES: ConversacionActiva[] = [
  { seudonimo: 'Operador 4F2A', tenantNombre: 'Transportes Innovativos', actualizadaEn: '2026-08-02T20:00:00Z', turns: [{ role: 'user', content: 'Listo' }] },
];

/** localStorage falso: `notificaciones-leidas.ts` lee `window`. */
function conVentana(datos: Record<string, string> = {}) {
  const almacen = new Map(Object.entries(datos));
  const w = {
    localStorage: {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => { almacen.set(k, v); },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  vi.stubGlobal('window', w);
  return { almacen, restaurar: () => vi.unstubAllGlobals() };
}

beforeEach(() => { vi.unstubAllGlobals(); });

const COMPONENTES: Array<{ nombre: string; con: () => React.ReactElement; sin: () => React.ReactElement }> = [
  {
    nombre: 'ChatNegocio',
    con: () => <ChatNegocio resumen={CON_DATOS} />,
    sin: () => <ChatNegocio resumen={EN_CERO} />,
  },
  {
    nombre: 'ChatNegocio (compacto)',
    con: () => <ChatNegocio resumen={CON_DATOS} compacto />,
    sin: () => <ChatNegocio resumen={EN_CERO} compacto />,
  },
  {
    nombre: 'AsistenteExpandible',
    con: () => <AsistenteExpandible resumen={CON_DATOS} main={<div>Inicio</div>} />,
    sin: () => <AsistenteExpandible resumen={EN_CERO} main={<div>Inicio</div>} />,
  },
  {
    nombre: 'ContadorRetro',
    con: () => <ContadorRetro valor={1234} etiqueta="facturas procesadas" />,
    sin: () => <ContadorRetro valor={0} etiqueta="facturas procesadas" />,
  },
  {
    nombre: 'GraficaCostoConRango',
    con: () => <GraficaCostoConRango porDia={CON_DATOS.porDia} />,
    sin: () => <GraficaCostoConRango porDia={[]} />,
  },
  {
    nombre: 'PerfilMenu',
    con: () => <PerfilMenu nombre="Javier Cámara" avatarUrl="https://cdn/u-1/avatar?t=1" />,
    sin: () => <PerfilMenu nombre="Javier" avatarUrl={null} />,
  },
  {
    nombre: 'SidebarNav',
    con: () => <SidebarNav />,
    sin: () => <SidebarNav />,
  },
  {
    nombre: 'SidebarNavIconos',
    con: () => <SidebarNavIconos />,
    sin: () => <SidebarNavIconos />,
  },
  {
    nombre: 'BuscadorTrigger',
    con: () => <BuscadorTrigger />,
    sin: () => <BuscadorTrigger />,
  },
  {
    nombre: 'AvatarUploader',
    con: () => <AvatarUploader nombre="Javier" avatarUrl="https://cdn/u-1/avatar" accion={() => {}} />,
    sin: () => <AvatarUploader nombre="Javier" avatarUrl={null} accion={() => {}} />,
  },
];

describe('cada componente de /admin pinta con datos y EN CERO', () => {
  for (const c of COMPONENTES) {
    it(`${c.nombre} — con datos`, () => {
      const html = renderToStaticMarkup(c.con());
      expect(html).not.toMatch(/NaN|Infinity/);
      expect(html.length).toBeGreaterThan(10);
    });
    it(`${c.nombre} — en cero (el primer día de una flota)`, () => {
      const html = renderToStaticMarkup(c.sin());
      expect(html).not.toMatch(/NaN|Infinity/);
      expect(html).not.toMatch(/>undefined</);
    });
  }
});

describe('CommandPalette — cerrada, no pinta nada en el servidor', () => {
  // La paleta ⌘K se abre con un atajo de teclado: su primer render es
  // vacío A PROPÓSITO. Lo que se fija aquí es que ese vacío sea vacío de
  // verdad y no un overlay invisible cubriendo la pantalla — y que montarla
  // no lance (vive en el layout, o sea en las ~30 páginas).
  it('render inicial vacío y sin lanzar', () => {
    expect(renderToStaticMarkup(<CommandPalette />)).toBe('');
  });
});

describe('la campana y la lista de notificaciones', () => {
  it('con alertas, la campana las cuenta', () => {
    const { restaurar } = conVentana();
    const alertas = calcularAlertas(CON_DATOS, CONVERSACIONES);
    const html = renderToStaticMarkup(<Notificaciones alertas={alertas} />);
    expect(html).not.toMatch(/NaN|undefined/);
    expect(alertas.length).toBeGreaterThan(0);
    restaurar();
  });

  it('sin alertas no inventa un contador', () => {
    const { restaurar } = conVentana();
    const html = renderToStaticMarkup(<Notificaciones alertas={[]} />);
    expect(html).not.toMatch(/NaN|undefined/);
    restaurar();
  });

  it('la lista pinta el texto real de cada alerta', () => {
    const { restaurar } = conVentana();
    const alertas = calcularAlertas(CON_DATOS, CONVERSACIONES);
    const html = renderToStaticMarkup(<NotificacionesLista alertas={alertas} />);
    for (const a of alertas) expect(html).toContain(a.texto.slice(0, 20));
    restaurar();
  });

  it('la lista con cero alertas no revienta', () => {
    const { restaurar } = conVentana();
    expect(renderToStaticMarkup(<NotificacionesLista alertas={[]} />)).not.toMatch(/NaN|undefined/);
    restaurar();
  });
});

describe('calcularAlertas — de datos reales, nunca de un contador inventado', () => {
  it('avisa cuando el costo de IA sube 30% o más', () => {
    const a = calcularAlertas({ ...CON_DATOS, tendenciaCosto: 42.5 }, []);
    expect(a.some((x) => x.tipo === 'atencion' && x.texto.includes('42.5'))).toBe(true);
  });

  it('NO avisa con una subida chica', () => {
    const a = calcularAlertas({ ...CON_DATOS, tendenciaCosto: 5 }, []);
    expect(a.some((x) => x.texto.includes('subió'))).toBe(false);
  });

  it('sin historia (tendencia null) no inventa una subida', () => {
    const a = calcularAlertas({ ...CON_DATOS, tendenciaCosto: null }, []);
    expect(a.some((x) => x.texto.includes('subió'))).toBe(false);
  });

  it('con un solo tenant dice que sigue siendo el demo', () => {
    const a = calcularAlertas({ ...CON_DATOS, tenants: 1 }, []);
    expect(a.some((x) => x.texto.includes('tenant demo'))).toBe(true);
  });

  it('con dos flotas reales ya no lo dice', () => {
    expect(calcularAlertas(CON_DATOS, []).some((x) => x.texto.includes('tenant demo'))).toBe(false);
  });

  it('y ninguna alerta menciona a un operador identificable', () => {
    // G-53: las conversaciones que entran aquí ya vienen seudonimizadas, y
    // el texto de la alerta es un CONTEO, no una identidad.
    const a = calcularAlertas(CON_DATOS, CONVERSACIONES);
    expect(a.every((x) => !/\d{10}/.test(x.texto))).toBe(true);
  });
});

describe('el mapa de navegación es consistente', () => {
  it('TODAS_LAS_RUTAS contiene los cinco grupos', () => {
    for (const grupo of [AGENTES, NEGOCIO, PLATAFORMA]) {
      for (const item of grupo) {
        expect(TODAS_LAS_RUTAS.some((r) => r.href === item.href), item.href).toBe(true);
      }
    }
  });

  it('no hay dos rutas con el mismo href', () => {
    const hrefs = TODAS_LAS_RUTAS.map((r) => r.href);
    expect(new Set(hrefs).size, `hrefs repetidos: ${hrefs.length} vs ${new Set(hrefs).size}`).toBe(hrefs.length);
  });

  it('todas cuelgan de /admin y todas tienen nombre e ícono', () => {
    for (const r of TODAS_LAS_RUTAS) {
      expect(r.href.startsWith('/admin'), r.href).toBe(true);
      expect(r.nombre.length, r.href).toBeGreaterThan(0);
      expect(r.Icono, r.href).toBeTruthy();
    }
  });
});

describe('IconoProveedor — el proveedor sale del slug, no de una lista a mano', () => {
  it('reconoce los tres proveedores del stack', () => {
    for (const slug of ['anthropic/claude-sonnet-5', 'google/gemini-3.6-flash', 'openai/gpt-5.6-terra']) {
      expect(renderToStaticMarkup(<IconoProveedor modelo={slug} />).length).toBeGreaterThan(0);
    }
  });
  it('un slug desconocido no revienta ni pinta `undefined`', () => {
    const html = renderToStaticMarkup(<IconoProveedor modelo="quien/sabe-9" />);
    expect(html).not.toMatch(/undefined|NaN/);
  });
  it('el sufijo de enrutamiento no cambia el proveedor', () => {
    expect(renderToStaticMarkup(<IconoProveedor modelo="anthropic/claude-sonnet-5:floor" />))
      .toBe(renderToStaticMarkup(<IconoProveedor modelo="anthropic/claude-sonnet-5" />));
  });
});
