// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-25 (ALTO) — «el rail traduce un fallo de lectura a
// "Todavía no hay liquidaciones"».
//
// El handler respondía **200** con `{"kpis":null,"acred":null,"anomalias":null}`
// tanto si la base se cayó, como si el tenant no ha liquidado nada, como si el
// rol de quien pregunta no puede ver el dinero. Tres situaciones que exigen
// tres respuestas distintas, colapsadas en una que el rail no puede
// desambiguar: el contralor de una flota con 40 liquidaciones cerradas teclea
// "¿cuánto llevo comprobado?" y lee «Todavía no hay liquidaciones».
//
// Es exactamente el CRÍTICO que `pg.ts` existe para no volver a cometer —
// supabase-js reporta POR VALOR y un fallo se lee como "no hay nada"— pero una
// capa más arriba: aquí el `null` ya no viene del driver, lo produce el
// `catch` del propio handler.
//
// Regla: fallar cerrado y DECIRLO. Un motivo discriminado en el cuerpo, y un
// estado HTTP que no afirme éxito sobre una lectura que no ocurrió.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant }));

const maybeSingle = vi.fn(async () => ({ data: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) })),
}));

const getKpis = vi.fn();
const getAcreditables = vi.fn();
const detectarAnomalias = vi.fn();
vi.mock('@/lib/cuadra/analytics', () => ({ getKpis, getAcreditables, detectarAnomalias }));

const { GET } = await import('./route');
const { NextRequest } = await import('next/server');

const TENANT = '11111111-1111-1111-1111-111111111111';
const pedir = (url = 'http://localhost/api/dashboard/asistente') => GET(new NextRequest(url));

const KPIS = { montoComprobado: 47300, viajesLiquidados: 40, conDiferencias: 1, porRevisar: 2, tasaCuadre: 92, diferenciaDetectada: 1200 };
const ACRED = { iva: 8412, peaje: 3100, ieps: 0, litrosDiesel: 1850, liquidaciones: 40 };

beforeEach(() => {
  getKpis.mockReset(); getAcreditables.mockReset(); detectarAnomalias.mockReset();
  getKpis.mockResolvedValue(KPIS);
  getAcreditables.mockResolvedValue(ACRED);
  detectarAnomalias.mockResolvedValue([]);
  getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'flota_admin', nombre: 'Javier' });
});

describe('el rail dice POR QUÉ no hay cifras', () => {
  it('con la lectura caída no responde 200: el 200 afirma que la consulta ocurrió', async () => {
    getKpis.mockRejectedValue(new Error('fetch failed'));

    const res = await pedir();

    expect(res.status, 'un 200 con nulos es indistinguible de una flota sin liquidaciones').not.toBe(200);
  });

  it('y lo dice en el cuerpo, con un motivo que el rail pueda ramificar', async () => {
    getKpis.mockRejectedValue(new Error('fetch failed'));

    const body = await (await pedir()).json();

    expect(body.motivo).toBe('error');
    expect(body.kpis).toBeNull();
  });

  it('el rol sin acceso al dinero NO es un error: es su propia respuesta', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: TENANT, rol: 'encargado', nombre: 'Tráfico' });

    const res = await pedir();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.motivo).toBe('sin-permiso');
    expect(body.kpis).toBeNull();
  });

  it('la flota que de verdad no ha liquidado nada tampoco es un error', async () => {
    getKpis.mockResolvedValue({ ...KPIS, viajesLiquidados: 0, montoComprobado: 0 });

    const body = await (await pedir()).json();

    expect(body.motivo).toBe('ok');
  });

  it('CONTROL · con todo sano el motivo es «ok» y las cifras viajan', async () => {
    const res = await pedir();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.motivo).toBe('ok');
    expect(body.kpis.montoComprobado).toBe(47300);
    expect(body.acred.iva).toBe(8412);
  });

  it('si lo único que se cae es el detector de anomalías, se dice igual', async () => {
    // Es el caso que pinta el recuadro VERDE de "todo bien": el ternario del
    // rail cae al lado bueno cuando `anomalias` es null, y ese recuadro es el
    // que su propio comentario dice que entrena a ignorar.
    detectarAnomalias.mockRejectedValue(new Error('fetch failed'));

    const body = await (await pedir()).json();

    expect(body.motivo).toBe('error');
  });
});
