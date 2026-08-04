// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · CRÍTICO (backend) — la ruta del rail no miraba el ROL.
//
// `visibilidad.ts` se escribió esta ronda para que el jefe de tráfico dejara de
// ver las finanzas de la flota: `encargado: ['operacion']`, sin `'dinero'`. Se
// aplicó en las dos capas que su cabecera enumera —el sidebar y la página— y
// entonces se estrenó `/api/dashboard/asistente`, que copió el gate de TENANT
// de `resolverTenantEfectivo` y no el de ROL que va tres líneas antes.
//
// El rail que consume esta ruta lo pinta `chrome.tsx:90` en las 20 páginas, sin
// mirar el rol. Así que:
//
//   entra  → `trafico@innovativos.mx`, rol `encargado`, abre /dashboard/despacho
//   sale   → JSON con `kpis.montoComprobado`, `acred.iva`, `acred.peaje` y el
//            detalle de `anomalias` — el comprobado, los acreditables fiscales
//            y el detector de fraude de la flota.
//
// Y con la cookie de sesión del CHOFER, `curl` a la misma URL devuelve lo
// mismo: `/api` está fuera del matcher del proxy (`proxy.ts:81`) y la consulta
// corre con `supabaseAdmin()` (service-role, salta la RLS de la 0045). El único
// `if` del handler preguntaba si había sesión, no de quién era.
//
// El rail ya tolera nulos (`rail.tsx:66-68`, `kpis && …`), así que negar el
// dinero es devolverlo vacío, no romperle la pantalla a quien sí debe entrar.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant }));

// Nunca se debe llegar a la base para un rol sin acceso al dinero.
const maybeSingle = vi.fn(async () => ({ data: null }));
const supabaseAdmin = vi.fn(() => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

const getKpis = vi.fn(async () => ({
  montoComprobado: 47300, viajesLiquidados: 12, conDiferencias: 1,
  porRevisar: 2, tasaCuadre: 75,
}));
const getAcreditables = vi.fn(async () => ({ iva: 8412, peaje: 3100 }));
const detectarAnomalias = vi.fn(async () => [
  { detalle: 'CFDI en más de un viaje', monto: 9400 },
]);
vi.mock('@/lib/cuadra/analytics', () => ({ getKpis, getAcreditables, detectarAnomalias }));

const { GET } = await import('./route');
const { NextRequest } = await import('next/server');

const pedir = async (url = 'http://localhost/api/dashboard/asistente') =>
  (await GET(new NextRequest(url))).json();

const TENANT = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  getKpis.mockClear(); getAcreditables.mockClear(); detectarAnomalias.mockClear();
});

describe('el rail no entrega dinero a quien no puede verlo', () => {
  it('el ENCARGADO no recibe comprobado, ni acreditables, ni anomalías', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'encargado', nombre: 'Tráfico' });

    const body = await pedir();

    expect(body.kpis, 'el jefe de tráfico recibió los KPIs del dinero').toBeNull();
    expect(body.acred, 'el jefe de tráfico recibió los acreditables fiscales').toBeNull();
    expect(body.anomalias, 'el jefe de tráfico recibió el detector de fraude').toBeNull();
    // Su saludo sí: el rail es suyo, lo que no es suyo es el dinero.
    expect(body.nombre).toBe('Tráfico');
  });

  it('no se consulta siquiera: el dinero no se trae para luego tirarlo', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'encargado', nombre: 'Tráfico' });

    await pedir();

    expect(getKpis).not.toHaveBeenCalled();
    expect(getAcreditables).not.toHaveBeenCalled();
    expect(detectarAnomalias).not.toHaveBeenCalled();
  });

  it('el CHOFER con sesión tampoco — `curl` con su cookie no es una puerta', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'operador', nombre: 'Juan' });

    const body = await pedir();

    expect(body.kpis).toBeNull();
    expect(body.acred).toBeNull();
    expect(body.anomalias).toBeNull();
  });

  it('un rol que nadie clasificó tampoco — fail closed, igual que `areasDe`', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'gerente_regional', nombre: 'X' });

    expect((await pedir()).kpis).toBeNull();
  });

  // ── LOS CONTROLES ────────────────────────────────────────────────────────
  // Sin estos, "devolver null siempre" pasaría las cuatro de arriba y no habría
  // probado nada: el rail se apagaría para todos y nadie lo notaría en la suite.

  it('CONTROL · el DUEÑO sí recibe las tres cosas', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'flota_admin', nombre: 'Javier' });

    const body = await pedir();

    expect(body.kpis?.montoComprobado).toBe(47300);
    expect(body.acred?.iva).toBe(8412);
    expect(body.anomalias).toEqual([{ detalle: 'CFDI en más de un viaje', monto: 9400 }]);
  });

  it('CONTROL · el CONTADOR vive del dinero y sí lo recibe', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'contador', nombre: 'Ana' });

    expect((await pedir()).acred?.iva).toBe(8412);
  });

  it('sin sesión sigue siendo 401, no un 200 con nulos', async () => {
    getSessionTenant.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/dashboard/asistente'));
    expect(res.status).toBe(401);
  });
});
