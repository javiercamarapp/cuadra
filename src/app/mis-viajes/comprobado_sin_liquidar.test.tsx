import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (frontend) — «/mis-viajes imprime "$0.00 comprobado"
// para el viaje que el chofer tiene abierto y al que ya le mandó comprobantes».
//
// `VJ-2026-0847` está `'abierto'` (`seed.sql:116`) y ya tiene $5,600 en `gasto`
// (`seed.sql:123-129`), pero todavía no existe su fila en `liquidacion`. El
// mapeo colapsaba la ausencia con `Number(liq?.total_comprobado ?? 0)` y la
// columna de dinero imprimía:
//
//     VJ-2026-0847   03 ago 2026   $0.00   Sin liquidar
//
// La columna de ESTATUS sí sabe distinguir «no hay liquidación» y pinta «Sin
// liquidar». La de dinero, tres celdas a la izquierda, no: afirmaba cero para
// un viaje donde el chofer ya mandó $5,600 en fotos.
//
// El chofer que entra a revisar si su envío llegó lee «$0.00» y concluye que se
// perdió: reenvía las catorce fotos. Cada reenvío es otra pasada de OCR —costo
// real— y el motor las trata como duplicados que hay que explicar después en la
// liquidación.
//
// Es el mismo par «ausencia pintada como cero» que el CRÍTICO de la tarjeta de
// litros, en la pantalla del chofer.
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

beforeEach(() => {
  requireOperador.mockReset();
  requireOperador.mockResolvedValue({
    userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan Pérez', operadorId: 'o-9',
  });
});

const pintar = async () => renderToStaticMarkup(await MisViajes() as React.ReactElement);

/** El viaje del demo: abierto, con gastos mandados, sin fila en `liquidacion`. */
const VIAJE_ABIERTO = {
  id: 'v-847', folio: 'VJ-2026-0847', created_at: '2026-08-03T12:00:00Z', liquidacion: [],
};

describe('la columna de dinero no afirma un cero que nadie midió', () => {
  it('el viaje abierto del demo NO imprime «$0.00» comprobado', async () => {
    filas = [VIAJE_ABIERTO];
    const html = await pintar();
    expect(
      html,
      'el chofer lee $0.00, cree que sus fotos se perdieron y reenvía las catorce',
    ).not.toContain('$0.00');
  });

  it('en su lugar dice que todavía no hay nada medido, no que midió cero', async () => {
    filas = [VIAJE_ABIERTO];
    const html = await pintar();
    // La celda de dinero, no cualquier guion de la página (el subtítulo trae
    // uno): se busca dentro de la propia celda `text-right tabular`.
    const celda = html.match(/<td[^>]*text-right tabular[^>]*>(.*?)<\/td>/)?.[1];
    expect(celda, 'no encontré la celda de "Comprobado"').toBeDefined();
    expect(celda).toContain('—');
    // Y el folio y el estatus siguen ahí: no se oculta la fila, se le quita la
    // afirmación.
    expect(html).toContain('VJ-2026-0847');
    expect(html).toContain('Sin liquidar');
  });

  it('una liquidación con `total_comprobado` nulo recibe el mismo trato', async () => {
    // El otro camino a la ausencia: la fila existe y la columna viene vacía.
    filas = [{ ...VIAJE_ABIERTO, liquidacion: [{ total_comprobado: null, estatus: 'cuadrada', diferencias: [] }] }];
    expect(await pintar()).not.toContain('$0.00');
  });

  // CONTROL 1. Un cero MEDIDO sí se imprime: el arreglo distingue «no hay
  // liquidación» de «la liquidación dice cero», no borra la cifra.
  it('control: una liquidación cerrada en $0.00 sí lo dice — eso sí se midió', async () => {
    filas = [{ ...VIAJE_ABIERTO, liquidacion: [{ total_comprobado: 0, estatus: 'cuadrada', diferencias: [] }] }];
    const html = await pintar();
    expect(html).toContain('$0.00');
    expect(html).toContain('Cuadrada');
  });

  // CONTROL 2. El camino normal no se toca.
  it('control: un viaje liquidado imprime su monto igual que siempre', async () => {
    filas = [{ ...VIAJE_ABIERTO, liquidacion: [{ total_comprobado: 5600, estatus: 'cuadrada', diferencias: [] }] }];
    expect(await pintar()).toContain('5,600');
  });
});
