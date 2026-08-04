import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO de la auditoría 10 (agéntico) — el chofer ve en /mis-viajes el
// semáforo que se construyó para el contralor.
//
// `SOLO_CONTRALOR` (`cuadre/resumen.ts:24-33`) existe con esta regla escrita:
// «veredictos que el operador no puede arreglar y que se leen como si se le
// estuviera auditando. Van al contralor, que sí puede hacer algo. Al operador
// se le pide lo que falta; no se le juzga».
//
// `cfdi_efos` está en esa lista Y en `REVISAR` (`engine.ts`), así que la
// liquidación sale con `estatus: 'revisar'` y `/mis-viajes` lo pintaba «Por
// revisar» en `--color-bad`, rojo, en la fila del chofer. Traducido: al chofer
// se le enseña en rojo que el proveedor de diésel de su empresa está en la
// lista negra del SAT — un hecho que él no causó, no puede arreglar, y que
// además es información fiscal de su patrón.
//
// El filtro por destinatario ya existe para WhatsApp (`resumen.ts:67`); esta
// pantalla, que nació después, no lo aplicaba. Y no podía: la consulta ni
// siquiera traía `diferencias`.
// ═══════════════════════════════════════════════════════════════════════════

const requireOperador = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireOperador: (...a: unknown[]) => requireOperador(...a) }));

let filas: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    from: () => ({
      select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: filas, error: null }) }) }),
    }),
  }),
}));

const MisViajes = (await import('./page')).default;

const viaje = (estatus: string, diferencias: Array<{ tipo: string }>) => ({
  id: 'v-1', folio: 'V-001', created_at: '2026-08-01T12:00:00Z',
  liquidacion: [{ total_comprobado: 5600, estatus, diferencias }],
});

beforeEach(() => {
  requireOperador.mockReset();
  requireOperador.mockResolvedValue({
    userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan Pérez', operadorId: 'o-9',
  });
});

const pintar = async () => renderToStaticMarkup(await MisViajes() as React.ReactElement);

describe('el chofer no ve el semáforo del contralor', () => {
  it('un «revisar» cuya ÚNICA causa es del contralor no se le pinta en rojo', async () => {
    filas = [viaje('revisar', [{ tipo: 'cfdi_efos' }])];
    const html = await pintar();
    expect(html, 'el proveedor de su patrón en lista negra del SAT no es su semáforo').not.toContain('Por revisar');
    expect(html).not.toContain('var(--color-bad)');
  });

  it('pero tampoco se le miente: se le dice que su empresa la está revisando', async () => {
    filas = [viaje('revisar', [{ tipo: 'cfdi_efos' }])];
    expect(await pintar()).toMatch(/revis/i);
  });

  // CONTROL 1. Si la causa SÍ es suya, el semáforo se conserva tal cual: el
  // arreglo filtra por destinatario, no apaga el estado.
  it('control: un «revisar» que el chofer sí puede resolver conserva su aviso', async () => {
    filas = [viaje('revisar', [{ tipo: 'alimentacion_sin_soporte' }])];
    const html = await pintar();
    expect(html).toContain('Por revisar');
  });

  // CONTROL 2. Mezcla: si hay al menos una causa suya, es suya.
  it('control: con una causa suya y otra del contralor, sigue siendo suya', async () => {
    filas = [viaje('revisar', [{ tipo: 'cfdi_efos' }, { tipo: 'alimentacion_sin_soporte' }])];
    expect(await pintar()).toContain('Por revisar');
  });

  // CONTROL 3. Los otros dos estatus no se tocan.
  it('control: «cuadrada» y «con diferencias» se pintan igual que siempre', async () => {
    filas = [viaje('cuadrada', [])];
    expect(await pintar()).toContain('Cuadrada');
    filas = [viaje('con_diferencias', [{ tipo: 'sobre_politica' }])];
    expect(await pintar()).toContain('Con diferencias');
  });
});
