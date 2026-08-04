import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (frontend) — «/cuenta imprime el UUID del usuario cuando
// el alta no capturó nombre».
//
// El campo "Nombre" de `/admin/usuarios/nuevo` es OPCIONAL por diseño, así que
// `app_user.nombre` puede quedar en `null` y `session.ts:44` lo propaga como
// `null`. La pantalla resolvía con `{s.nombre ?? s.userId}` y bajo la etiqueta
// **Usuario** el contralor leía:
//
//     3f2a1c88-9b04-4e11-a7d3-6c0f5e2b8d41
//
// Es la única pantalla que se abre para confirmar «sí, soy yo», y contestaba
// con un identificador interno. El correo —que sí existe, `app_user.email` es
// `not null unique`— era la respuesta natural y no se consultaba.
// ═══════════════════════════════════════════════════════════════════════════

const UUID = '3f2a1c88-9b04-4e11-a7d3-6c0f5e2b8d41';

const requireSessionTenant = vi.fn();
vi.mock('@/lib/auth/guard', () => ({
  requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a),
}));

vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut: async () => {} } }) }));

let filaUsuario: { email?: string | null } | null = { email: 'contralor@innovativos.mx' };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: tabla === 'tenant' ? { nombre: 'Transportes Innovativos' } : filaUsuario,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const Cuenta = (await import('./page')).default;

beforeEach(() => {
  filaUsuario = { email: 'contralor@innovativos.mx' };
  requireSessionTenant.mockReset();
  requireSessionTenant.mockResolvedValue({
    userId: UUID, tenantId: 't-1', rol: 'flota_admin', nombre: null, operadorId: null,
  });
});

const pintar = async () => renderToStaticMarkup(await Cuenta() as React.ReactElement);

describe('«Mi cuenta» contesta quién eres, no tu identificador interno', () => {
  it('un alta sin nombre NO imprime el UUID', async () => {
    const html = await pintar();
    expect(html, 'es la pantalla que se abre para confirmar «sí, soy yo»').not.toContain(UUID);
  });

  it('en su lugar imprime el correo, que es la respuesta natural', async () => {
    expect(await pintar()).toContain('contralor@innovativos.mx');
  });

  it('sin nombre y sin correo legible, un guion — nunca el UUID', async () => {
    filaUsuario = null;
    const html = await pintar();
    expect(html).not.toContain(UUID);
    expect(html).toContain('—');
  });

  // CONTROL. Cuando el alta SÍ capturó nombre, manda el nombre.
  it('control: con nombre capturado se sigue imprimiendo el nombre', async () => {
    requireSessionTenant.mockResolvedValue({
      userId: UUID, tenantId: 't-1', rol: 'flota_admin', nombre: 'Javier Cámara', operadorId: null,
    });
    const html = await pintar();
    expect(html).toContain('Javier Cámara');
    expect(html).not.toContain(UUID);
  });
});
