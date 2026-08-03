import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (pruebas), la otra mitad — los dos gates de EXPORTAR.
//
// El auditor quitó los dos `puedeExportar(rol) &&` del panel a la vez que el
// `puedeAsignar` del server action (`reasignar.test.ts` cierra ese) y la suite
// completa quedó verde. `api/export/rol.test.ts` ya prueba que las DOS RUTAS
// contestan 403 a quien no puede — o sea que el daño de esta mitad no es
// filtrar el CSV, es OFRECERLO: el chofer que abriera el panel vería
// «Exportar CSV» y «Descargar PDF», los pulsaría, y recibiría un 403 seco. Una
// puerta que se pinta y luego rebota es peor que no pintarla.
//
// Se prueba RENDERIZANDO el componente, no leyendo su fuente: el gate está en
// el JSX, y lo que se mide es el HTML que sale. Mismo idioma que
// `admin/columna_muerta.test.tsx` y `dashboard/acred_sin_litros.test.tsx`.
// ═══════════════════════════════════════════════════════════════════════════

const requireSessionTenant = vi.fn();
vi.mock('@/lib/auth/guard', () => ({
  requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a),
}));

/** Detalle con `pdfPath` puesto: es lo que hace al enlace de PDF candidato. */
const DETALLE = {
  id: 'liq-1', viajeId: 'v-1', folio: 'V-001', estatus: 'cuadrada',
  operadorId: 'o-1', operadorNombre: 'Juan Pérez', creadoEn: '2026-08-01T10:00:00Z',
  totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0,
  ieps: 0, litrosDiesel: 0, iva: 0, peaje: 0,
  diferencias: [], gastos: [{ concepto: 'diesel', monto: 1000 }],
  comprobantesExcluidos: 0, comprobantesCuadran: true,
  deducibilidad: null, pdfPath: 'liq/liq-1.pdf',
};

vi.mock('@/lib/cuadra/analytics', () => ({
  getKpis: async () => ({
    viajesLiquidados: 2, montoComprobado: 1000, diferenciaDetectada: 0,
    conDiferencias: 0, porRevisar: 0, tasaCuadre: 100,
  }),
  getAcreditables: async () => ({ litrosDiesel: 0, ieps: 0, iva: 0, peaje: 0 }),
  detectarAnomalias: async () => [],
  getLiquidacionDetalle: async () => DETALLE,
}));

vi.mock('@/lib/cuadra/repo', () => ({
  listOperadores: async () => [{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }],
  reasignarOperador: async () => undefined,
}));

// Una sola liquidación, con `pdf_url` puesto: es la condición que hace que el
// enlace de PDF del detalle sea siquiera candidato a pintarse.
const FILA = {
  id: 'liq-1', estatus: 'cuadrada', total_comprobado: 1000, diferencia: 0,
  created_at: '2026-08-01T10:00:00Z', viaje: { folio: 'V-001' },
};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [FILA], error: null }) }) }),
      }),
    }),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (d: string) => { throw new Error(`NEXT_REDIRECT ${d}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const DashboardPage = (await import('./page')).default;
const Detalle = (await import('./[id]/page')).default;

async function panelDe(rol: string): Promise<string> {
  requireSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol });
  const el = await DashboardPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(el);
}

async function detalleDe(rol: string): Promise<string> {
  requireSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol });
  const el = await Detalle({ params: Promise.resolve({ id: 'liq-1' }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => { requireSessionTenant.mockReset(); });

describe('«Exportar CSV» solo se le ofrece a quien la ruta va a dejar exportar', () => {
  // `puedeExportar`: superadmin, flota_admin, encargado y contador. El chofer
  // no —su interfaz es WhatsApp— y un rol desconocido tampoco (fail closed).
  for (const rol of ['flota_admin', 'encargado', 'contador']) {
    it(`${rol} sí ve el enlace de exportar`, async () => {
      const html = await panelDe(rol);
      expect(html).toContain('/api/export/liquidaciones');
      expect(html).toContain('Exportar CSV');
    });
  }

  for (const rol of ['operador', 'rol-que-no-existe']) {
    it(`${rol} NO ve el enlace: pulsarlo le daría un 403 seco`, async () => {
      const html = await panelDe(rol);
      expect(html, 'se ofrece una descarga que la ruta va a rechazar').not.toContain('/api/export/liquidaciones');
      expect(html).not.toContain('Exportar CSV');
    });
  }

  it('y el panel se pinta igual para los dos: lo único que cambia es el botón', async () => {
    // CONTROL. Sin él, una página que reventara con `operador` pasaría los
    // casos de arriba sin medir el gate.
    const conBoton = await panelDe('flota_admin');
    const sinBoton = await panelDe('operador');
    for (const html of [conBoton, sinBoton]) {
      expect(html).toContain('Detalle por liquidación');
      expect(html).toContain('V-001');
    }
  });
});

describe('«Descargar PDF» del detalle, el mismo gate en la otra pantalla', () => {
  for (const rol of ['flota_admin', 'contador']) {
    it(`${rol} sí ve el enlace al PDF`, async () => {
      expect(await detalleDe(rol)).toContain('/api/export/pdf/liq-1');
    });
  }

  for (const rol of ['operador', 'rol-que-no-existe']) {
    it(`${rol} NO ve el enlace al PDF`, async () => {
      const html = await detalleDe(rol);
      expect(html).not.toContain('/api/export/pdf/liq-1');
      // CONTROL en la misma assertion: la página SÍ se pintó, con su folio.
      expect(html).toContain('V-001');
    });
  }
});

describe('y el <select> de reasignar chofer sigue la misma matriz', () => {
  // `puedeAsignar` excluye a `contador`, que `puedeExportar` sí admite: es el
  // caso que distingue las dos funciones y el que un solo gate confundiría.
  it('flota_admin ve el selector de chofer', async () => {
    expect(await detalleDe('flota_admin')).toContain('Ana Ruiz');
  });

  it('contador NO lo ve, aunque sí pueda exportar', async () => {
    const html = await detalleDe('contador');
    expect(html).not.toContain('Ana Ruiz');
    expect(html, 'sí ve el chofer asignado, solo no puede cambiarlo').toContain('Juan Pérez');
  });
});
