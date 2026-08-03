import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO de la auditoría 10 (legal) — al chofer se le hace aceptar un aviso que
// en su propio texto declara no ser el suyo, y el panel donde vive no enlaza
// ninguno.
//
// `/login` cierra con: «Al continuar, aceptas el Aviso de Privacidad DE
// LIKIDA». Pero el responsable de los datos del operador es la FLOTA: Likida
// es persona encargada, y su propio aviso lo dice. El documento que le toca al
// chofer es el integral de su flota, en `/aviso/[tenant]`, y ni `/mis-viajes`
// ni `/cuenta` lo mencionaban — verificado por el auditor con `grep`: cero
// menciones en los dos archivos.
//
// La LFPDPPP de marzo 2025 (art. 15) exige que el aviso esté DISPONIBLE al
// titular, no solo que exista. Un aviso publicado en una ruta que ninguna
// pantalla enlaza no está disponible: está archivado.
//
// El componente es una función async: se invoca. No se renderiza el árbol de
// datos, se comprueba que la liga al aviso de SU flota esté en la página.
// ═══════════════════════════════════════════════════════════════════════════

const requireOperador = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireOperador: (...a: unknown[]) => requireOperador(...a) }));

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    from: () => ({
      select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  }),
}));

const MisViajes = (await import('./page')).default;

beforeEach(() => {
  requireOperador.mockReset();
  requireOperador.mockResolvedValue({
    userId: 'u-9', tenantId: '1111-2222', rol: 'operador', nombre: 'Juan Pérez', operadorId: 'o-9',
  });
});

describe('el panel del chofer enlaza el aviso de SU flota', () => {
  it('lleva la liga a /aviso/<su tenant>, no a la de Likida', async () => {
    const html = renderToStaticMarkup(await MisViajes() as React.ReactElement);
    expect(html, 'un aviso que ninguna pantalla enlaza está archivado, no disponible').toContain('/aviso/1111-2222');
  });

  it('y la nombra como lo que es: el aviso de su empresa', async () => {
    const html = renderToStaticMarkup(await MisViajes() as React.ReactElement);
    expect(html).toMatch(/aviso de privacidad/i);
  });
});
