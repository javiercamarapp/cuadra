import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-24 · CRÍTICO — el CSV de la flota AUTENTICABA sin AUTORIZAR,
// y se recortaba en silencio a 1,000 renglones.
//
// Dos defectos en la misma ruta:
//
// (a) El único `if` preguntaba "¿hay sesión y tiene tenant?". Con la cookie de
//     un `operador` —el rol al que esta ronda le cerró todas las pantallas del
//     panel— `curl https://app.likida.ai/api/export/liquidaciones` bajaba la
//     nómina de viajes de sus compañeros: folio, operador, anticipo,
//     comprobado y diferencia de CADA liquidación de la flota. `/api` está
//     fuera del matcher del proxy (`proxy.ts:81`) y la consulta corre con
//     `supabaseAdmin()` (service-role, salta la RLS de la 0045), así que esta
//     línea ERA la única puerta. `permisos.ts:9` afirmaba por escrito que
//     decidía «qué endpoint acepta la petición» y ninguna ruta de `src/app/api`
//     lo importaba.
//
// (b) `.limit(5000)` pierde contra el `max_rows` de PostgREST (1,000 por
//     default): la conciliación del trimestre corta a mitad del segundo mes,
//     con HTTP 200 y sin una fila de advertencia. Es el borde que
//     `lib/cuadra/pg.ts` documenta y que `traerTodo` existe para cerrar.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant }));

// Cada página de PostgREST responde lo que le toque de `FILAS`, recortada al
// tamaño de la ventana pedida — que es exactamente lo que hace `max_rows`.
let FILAS: Array<Record<string, unknown>> = [];
const rangos: Array<[number, number]> = [];
const range = vi.fn(async (desde: number, hasta: number) => {
  rangos.push([desde, hasta]);
  return { data: FILAS.slice(desde, hasta + 1).slice(0, 1000), error: null };
});
const limit = vi.fn(async () => ({ data: FILAS.slice(0, 1000), error: null }));
const supabaseAdmin = vi.fn(() => ({
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range, limit }) }) }) }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

const { GET } = await import('./route');

const TENANT = '11111111-1111-1111-1111-111111111111';
const sesion = (rol: string) => ({
  userId: 'u-1', tenantId: TENANT, rol, nombre: 'X', operadorId: null, avatarUrl: null,
});

let ip = 0;
/** IP distinta por llamada: el rate-limit (10/min) es por IP y en memoria. */
const pedir = () =>
  GET(new Request('http://localhost/api/export/liquidaciones', {
    headers: { 'x-forwarded-for': `10.0.0.${++ip}` },
  }));

function filaCruda(i: number) {
  return {
    created_at: `2026-0${(i % 9) + 1}-01T12:00:00Z`,
    total_comprobado: 100, total_anticipo: 100, diferencia: 0,
    estatus: 'cuadrado', diferencias: [],
    viaje: { folio: `V-${i}`, operador: { nombre: 'Juan' } },
  };
}

beforeEach(() => {
  getSessionTenant.mockReset();
  range.mockClear(); limit.mockClear(); rangos.length = 0;
  FILAS = [filaCruda(0)];
});

describe('G-24(a) · el CSV de la flota no se le entrega a quien no puede exportar', () => {
  it('el CHOFER con sesión NO baja el CSV — su interfaz es WhatsApp', async () => {
    getSessionTenant.mockResolvedValue(sesion('operador'));

    const res = await pedir();

    expect(res.status, 'un operador con sesión se bajó la nómina de la flota').toBe(403);
    expect(await res.text()).not.toMatch(/folio|operador|anticipo/i);
  });

  it('un rol que nadie clasificó tampoco — fail closed, igual que `puedeExportar`', async () => {
    getSessionTenant.mockResolvedValue(sesion('gerente_regional'));

    expect((await pedir()).status).toBe(403);
  });

  it('no se consulta siquiera: el dinero no se trae para luego tirarlo', async () => {
    getSessionTenant.mockResolvedValue(sesion('operador'));

    await pedir();

    expect(range).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it('sin sesión sigue siendo 401', async () => {
    getSessionTenant.mockResolvedValue(null);

    expect((await pedir()).status).toBe(401);
  });

  // ── LOS CONTROLES ────────────────────────────────────────────────────────
  // Sin estos, "responder 403 siempre" pasaría las de arriba sin probar nada.

  it('CONTROL · el CONTADOR sí — la consola lo ofrece como «solo lectura y exportar»', async () => {
    getSessionTenant.mockResolvedValue(sesion('contador'));

    const res = await pedir();

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('V-0');
  });

  it('CONTROL · el DUEÑO sí', async () => {
    getSessionTenant.mockResolvedValue(sesion('flota_admin'));

    expect((await pedir()).status).toBe(200);
  });
});

describe('G-24(b) · el CSV del trimestre no se corta en silencio en la fila 1,000', () => {
  it('con 2,400 liquidaciones salen las 2,400, no las primeras 1,000', async () => {
    getSessionTenant.mockResolvedValue(sesion('flota_admin'));
    FILAS = Array.from({ length: 2400 }, (_, i) => filaCruda(i));

    const res = await pedir();
    const csv = await res.text();

    expect(res.status).toBe(200);
    // -1 por el encabezado, -1 por el salto final que `toCsv` deja.
    expect(csv.trim().split('\n').length - 1,
      'PostgREST recortó a max_rows y el CSV salió incompleto con HTTP 200').toBe(2400);
    expect(csv, 'la última liquidación del trimestre no viajó').toContain('V-2399');
  });

  it('pagina por ventanas de 1,000 — no le pide 5,000 a PostgREST de un jalón', async () => {
    getSessionTenant.mockResolvedValue(sesion('flota_admin'));
    FILAS = Array.from({ length: 2400 }, (_, i) => filaCruda(i));

    await pedir();

    expect(rangos.slice(0, 3)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
