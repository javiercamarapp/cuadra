import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO de la auditoría 10 (pruebas) — las DOS capas de /admin sin ancla.
//
// `/admin` son 3,839 líneas y 28 páginas con cero archivos de prueba. El
// auditor mutó las dos capas de autorización y la suite siguió VERDE:
//
//   · `src/proxy.ts:44`        — quitar '/admin' de la lista del matcher
//   · `src/app/admin/layout.tsx:27` — quitar el `await requireSuperadmin()`
//
// La primera queda anclada en `src/proxy.test.ts`. Ésta ancla la segunda, que
// es la que decide el ROL: el proxy solo pregunta «¿hay sesión?», así que sin
// esta línea CUALQUIER usuario con cuenta —el contralor de una flota cliente,
// o un chofer— entraría a ver cuántos tenants tiene Likida y cuánto gasta en
// IA. El propio layout lo dice: «lo que vive aquí es de Javier, no de un
// cliente».
//
// Un layout de servidor es una función async: se puede invocar. No se renderiza
// el árbol —eso exigiría react-dom/server y los 26 hijos—; lo que se mide es
// que la puerta se llame ANTES de leer un solo dato de negocio, que es la
// propiedad que la mutación rompía.
// ═══════════════════════════════════════════════════════════════════════════

const requireSuperadmin = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: (...a: unknown[]) => requireSuperadmin(...a) }));

const getResumenNegocio = vi.fn();
const getConversacionesActivas = vi.fn();
vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: (...a: unknown[]) => getResumenNegocio(...a),
  getConversacionesActivas: (...a: unknown[]) => getConversacionesActivas(...a),
}));

vi.mock('@/lib/supabase/server', () => ({ supabaseServer: vi.fn(async () => ({ auth: { signOut: vi.fn() } })) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }) }));

const AdminLayout = (await import('./layout')).default;

const RESUMEN = { tenants: 1, mrr: 0, liquidaciones: 0, costoMes: 0, porDia: [], porModelo: [], flotas: [] };

beforeEach(() => {
  requireSuperadmin.mockReset();
  getResumenNegocio.mockReset();
  getConversacionesActivas.mockReset();
  requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin', nombre: 'Javier' });
  getResumenNegocio.mockResolvedValue(RESUMEN);
  getConversacionesActivas.mockResolvedValue([]);
});

describe('/admin gatea por ROL en el layout, no solo por sesión en el proxy', () => {
  it('pide requireSuperadmin al servir la consola', async () => {
    await AdminLayout({ children: null });
    expect(requireSuperadmin).toHaveBeenCalled();
  });

  it('si la puerta rebota, la consola NO llega a leer datos de negocio', async () => {
    // `requireSuperadmin` rebota con `redirect()`, que en Next lanza. Lo que se
    // mide es que ese lanzamiento ocurra ANTES de `getResumenNegocio`: si la
    // puerta se moviera debajo de la lectura, los datos de Likida ya habrían
    // salido de la base para un usuario que no puede verlos.
    requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(AdminLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT');
    expect(getResumenNegocio, 'la puerta va antes de la lectura').not.toHaveBeenCalled();
    expect(getConversacionesActivas).not.toHaveBeenCalled();
  });

  // CONTROL. Sin él, un layout que rebotara a todo el mundo pasaría las dos de
  // arriba y la prueba no mediría que la puerta DISCRIMINA.
  it('con superadmin sí sigue y lee el resumen del negocio', async () => {
    await AdminLayout({ children: null });
    expect(getResumenNegocio).toHaveBeenCalled();
  });
});
