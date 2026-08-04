import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (pruebas) — `permisos.ts` probado como función pura y
// NUNCA como cableado.
//
// `permisos.test.ts` afirma con seis casos que `puedeAsignar('contador')` es
// `false`, incluido el fail-closed de un rol desconocido. Nada probaba que
// alguien la LLAMARA. El auditor cambió `dashboard/[id]/page.tsx:51` a
// `if (false && !puedeAsignar(r)) redirect(...)` y quitó los dos
// `puedeExportar(rol) &&` de la UI: 1629/1629 verdes, `tsc --noEmit` en 0.
//
// Escenario que abría esa mutación, con valores: Marisol, `contador` de
// Transportes Innovativos, tiene sesión legítima y NO ve el `<select>` de
// chofer (la UI sí la excluye). Arma el POST a mano contra el server action
// con `operadorId=o-2` y reasigna el viaje `v-1` de Juan Pérez a Ana Ruiz.
// `reasignarOperador` (`repo.ts:112`) hace el UPDATE, y el PDF y el CSV de esa
// liquidación pasan a atribuirle el anticipo al chofer equivocado.
//
// El `<form>` que no se pinta NO es la puerta: el action lo es. Esta prueba lo
// EJECUTA — por eso el cuerpo salió a `reasignar.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const requireSessionTenant = vi.fn();
vi.mock('@/lib/auth/guard', () => ({
  requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a),
}));

const reasignarOperador = vi.fn();
vi.mock('@/lib/cuadra/repo', () => ({
  reasignarOperador: (...a: unknown[]) => reasignarOperador(...a),
}));

// `redirect()` de Next LANZA. Sin eso, «rebotó» y «siguió» son indistinguibles.
class Redirigido extends Error {
  constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); }
}
vi.mock('next/navigation', () => ({
  redirect: (d: string) => { throw new Redirigido(d); },
}));

// `permisos.ts` va SIN mockear a propósito: lo que esta prueba mide es
// justamente que la matriz real esté cableada a esta ruta.
const { reasignarChofer } = await import('./reasignar');

async function intentar(rol: string, operadorId = 'o-2') {
  requireSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol });
  const f = new FormData();
  f.set('operadorId', operadorId);
  try {
    await reasignarChofer('liq-1', 'v-1', f);
  } catch (e) {
    if (e instanceof Redirigido) return e.destino;
    throw e;
  }
  return null;
}

beforeEach(() => {
  requireSessionTenant.mockReset();
  reasignarOperador.mockReset();
  reasignarOperador.mockResolvedValue(undefined);
});

describe('reasignar chofer respeta la matriz de roles DENTRO del server action', () => {
  // `puedeAsignar`: superadmin, flota_admin y encargado. Los demás, no.
  for (const rol of ['contador', 'operador', 'rol-que-no-existe']) {
    it(`un ${rol} con sesión válida NO mueve el viaje, aunque arme el POST a mano`, async () => {
      const destino = await intentar(rol);
      expect(reasignarOperador, `${rol} llegó al UPDATE`).not.toHaveBeenCalled();
      expect(destino).toBe('/dashboard/liq-1');
    });
  }

  // CONTROL. Sin estos tres, un action que rebotara a TODO el mundo pasaría los
  // casos de arriba y la prueba no mediría que la puerta discrimina.
  for (const rol of ['superadmin', 'flota_admin', 'encargado']) {
    it(`un ${rol} sí reasigna`, async () => {
      const destino = await intentar(rol);
      expect(reasignarOperador).toHaveBeenCalledWith('t-1', 'v-1', 'o-2');
      expect(destino).toBe('/dashboard/liq-1');
    });
  }

  it('el UPDATE va con el tenant de la SESIÓN, no con uno que venga del formulario', async () => {
    // El único dato de pertenencia que no se puede falsificar desde el
    // navegador es el que sale de `requireSessionTenant`.
    await intentar('flota_admin');
    expect(reasignarOperador.mock.calls[0][0]).toBe('t-1');
  });

  it('sin `operadorId` no se toca la base: un POST vacío no borra la asignación', async () => {
    const destino = await intentar('flota_admin', '');
    expect(reasignarOperador).not.toHaveBeenCalled();
    expect(destino).toBe('/dashboard/liq-1');
  });

  it('y la sesión se exige por la ruta de VUELTA correcta', async () => {
    // Sin sesión, `requireSessionTenant` manda a /login con este `next`: si el
    // destino se perdiera, el contralor volvería al panel general en vez de a
    // la liquidación que estaba moviendo.
    await intentar('flota_admin');
    expect(requireSessionTenant).toHaveBeenCalledWith('/dashboard/liq-1');
  });
});
