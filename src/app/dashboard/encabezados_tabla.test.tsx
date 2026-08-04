import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO REINCIDENTE Y EXTENDIDO (frontend) — «dos de las tres
// tablas de dinero no marcan sus encabezados; la tercera sí».
//
// El BAJO 2 de la auditoría 5 puso `scope="col"` y `scope="row"` en la tabla de
// comprobantes del detalle (`[id]/page.tsx:223-225,240`). Las otras dos no lo
// heredaron: la tabla principal del panel —Folio, Fecha, Comprobado,
// Diferencia, Estatus— y la del chofer, que NACIÓ con el mismo hueco esta
// misma ronda.
//
// Sin `scope`, un lector de pantalla que recorra la tabla anuncia «$1,500.00,
// a favor de la empresa» sin decir de qué columna: la asociación celda↔
// encabezado deja de ser explícita y el usuario tiene que reconstruirla de
// memoria. Tres pantallas después, en el detalle, sí lo dice — y esa
// inconsistencia es lo que hace pensar que ya estaba hecho.
//
// No es del demo del 6-ago: nadie va a usar un lector de pantalla en la sala.
// Cobra factura el día que un cliente lo pida.
//
// Se prueba EJECUTANDO las dos páginas, no leyendo su texto fuente: un `grep`
// de `scope="col"` pasaría con el atributo puesto en cualquier `<th>` suelto,
// y lo que hay que fijar es que TODOS los `<th>` de las tablas de dinero lo
// lleven.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const requireSessionTenant = vi.fn().mockResolvedValue({
  userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Javier', operadorId: null,
});
const requireOperador = vi.fn().mockResolvedValue({
  userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan Pérez', operadorId: 'o-9',
});
vi.mock('@/lib/auth/guard', () => ({
  requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a),
  requireOperador: (...a: unknown[]) => requireOperador(...a),
}));

vi.mock('@/lib/cuadra/analytics', () => ({
  getKpis: async () => ({
    viajesLiquidados: 3, montoComprobado: 47300, diferenciaDetectada: 1500,
    conDiferencias: 1, porRevisar: 0, tasaCuadre: 67,
  }),
  getAcreditables: async () => ({ litrosDiesel: 113, ieps: 0, iva: 774.48, peaje: 603.45 }),
  detectarAnomalias: async () => [],
  // La consulta de las liquidaciones YA NO vive en `dashboard/page.tsx`: se movió
  // a `analytics.ts` como `getLiquidaciones` (auditoría 10, BAJO de arquitectura
  // — una función de consulta definida dentro del archivo de la página, con
  // `analytics.ts` al lado y la misma firma). Este mock servía esas filas por
  // abajo, a través de `supabaseAdmin`; ahora las sirve por donde la página las
  // pide. Las filas son las mismas.
  getLiquidaciones: async () => [{
    id: 'l-1', folio: 'VJ-2026-0847', creadoEn: '2026-08-01T18:00:00Z',
    comprobado: 8500, diferencia: 1500, estatus: 'con_diferencias',
  }],
}));

/** La consulta de `getLiquidaciones` — una liquidación con diferencia a favor. */
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: [{
                id: 'l-1', estatus: 'con_diferencias', total_comprobado: 8500, diferencia: 1500,
                created_at: '2026-08-01T18:00:00Z', viaje: { folio: 'VJ-2026-0847' },
              }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

/** La del chofer: mismo viaje, ya liquidado. */
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({
            data: [{
              id: 'v-1', folio: 'VJ-2026-0847', created_at: '2026-08-01T18:00:00Z',
              liquidacion: [{ total_comprobado: 8500, estatus: 'con_diferencias', diferencias: [] }],
            }],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

// LA TABLA DE LIQUIDACIONES SE MUDÓ A `/dashboard/cuadre`.
//
// Esta prueba nació apuntando a `dashboard/page.tsx`, que entonces era la
// lista. La reestructuración del panel (20 páginas) dejó ahí el inicio y se
// llevó la tabla —Folio, Fecha, Comprobado, Diferencia, Estatus— a su propia
// pantalla. El guardarraíl no se borra por eso: se reapunta. Auditoría 11.
const Dashboard = (await import('./cuadre/page')).default;
const MisViajes = (await import('../mis-viajes/page')).default;

/** Los `<th>` de la tabla, con sus atributos, tal como salen renderizados. */
function encabezados(html: string): string[] {
  return html.match(/<th\b[^>]*>/g) ?? [];
}

describe('las tres tablas de dinero marcan sus encabezados', () => {
  it('la tabla principal del panel: todos sus `<th>` llevan scope', async () => {
    const html = renderToStaticMarkup(
      await Dashboard({ searchParams: Promise.resolve({}) }) as React.ReactElement,
    );
    const ths = encabezados(html);
    // Folio, Fecha, Comprobado, Diferencia, Estatus.
    expect(ths.length, 'no se renderizó la tabla de liquidaciones').toBe(5);
    const sinScope = ths.filter((th) => !/scope="(col|row)"/.test(th));
    expect(sinScope, `estos <th> no dicen de qué son encabezado:\n${sinScope.join('\n')}`).toEqual([]);
  });

  it('la tabla del chofer: todos sus `<th>` llevan scope', async () => {
    const html = renderToStaticMarkup(await MisViajes() as React.ReactElement);
    const ths = encabezados(html);
    // Folio, Fecha, Comprobado, Estatus.
    expect(ths.length, 'no se renderizó la tabla de /mis-viajes').toBe(4);
    const sinScope = ths.filter((th) => !/scope="(col|row)"/.test(th));
    expect(sinScope, `estos <th> no dicen de qué son encabezado:\n${sinScope.join('\n')}`).toEqual([]);
  });
});
