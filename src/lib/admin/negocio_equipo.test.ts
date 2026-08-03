import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (pruebas) — las dos exportadas de `negocio.ts` que
// ninguna prueba tocaba con un valor.
//
// `negocio.test.ts` cubre bien `getResumenNegocio` y `getConversacionesActivas`;
// `negocio_paginacion.test.ts` cubre que `getCostoPorFaseModelo` PAGINE y que
// filtre las etiquetas internas. Ninguna de las dos mide lo que estas dos
// funciones DEVUELVEN. Re-verificado hoy contra el árbol actual, con la suite
// completa (233 archivos):
//
//   (a) `getCostoPorFaseModelo`, la llave del agrupado:
//         ``const key = `${f.fase}::${f.modelo}`;``  ->  ``const key = `${f.fase}`;``
//       SOBREVIVE. Model Ops y Agente OCR colapsan todos los modelos de una
//       fase en UNA fila que lleva el nombre del primero: la pantalla que
//       existe para contestar «¿qué costó OCR, desglosado por modelo?»
//       atribuye el gasto de gemini + claude a un solo modelo.
//
//   (b) `getEquipo`: `rol: u.rol as string` -> `rol: 'superadmin'`, y el join a
//       `tenant` fuera del `select`.
//       SOBREVIVE. La página Equipo/RBAC le dice a Javier que TODOS los
//       usuarios de la flota demo son superadmin, y ninguno pertenece a
//       ninguna flota.
//
// Las dos pantallas se presentan como datos reales, no como maqueta.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();
/** Columnas pedidas por tabla — para poder afirmar que el join viaja. */
const selects = new Map<string, string>();

function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['eq', 'order', 'limit', 'is', 'range', 'abortSignal']) b[m] = self;
  b.select = (cols: string) => { selects.set(tabla, cols); return b; };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getCostoPorFaseModelo, getEquipo } = await import('./negocio');

beforeEach(() => { respuestas.clear(); selects.clear(); });

describe('getCostoPorFaseModelo — el eje es fase Y modelo, no fase a secas', () => {
  it('dos modelos dentro de la MISMA fase salen en dos renglones', async () => {
    // Es la pregunta para la que existe la pantalla. Con la llave mutada a
    // solo `fase`, esto devuelve un renglón de $1.51 rotulado con el primer
    // modelo que pasó — y es la cifra desde la que se fija el precio.
    respuestas.set('llm_costo', {
      data: [
        { fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 1.005 },
        { fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 0.5 },
        { fase: 'ocr', modelo: 'anthropic/claude-5-sonnet', costo_usd: 0.4272 },
      ],
      error: null,
    });
    expect(await getCostoPorFaseModelo()).toEqual([
      { fase: 'ocr', modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.51 },
      { fase: 'ocr', modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.43 },
    ]);
  });

  it('y el MISMO modelo en dos fases tampoco se junta', async () => {
    // El otro eje de la misma llave: agrupar solo por modelo perdería en qué
    // fase se gastó, que es la mitad de la pregunta.
    respuestas.set('llm_costo', {
      data: [
        { fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 0.30 },
        { fase: 'cuadre', modelo: 'google/gemini-3.6-flash', costo_usd: 0.10 },
      ],
      error: null,
    });
    const r = await getCostoPorFaseModelo();
    expect(r.map((x) => x.fase)).toEqual(['ocr', 'cuadre']);
    expect(r.map((x) => x.costoUsd)).toEqual([0.3, 0.1]);
  });

  it('ordena por costo descendente: lo caro arriba', async () => {
    respuestas.set('llm_costo', {
      data: [
        { fase: 'cuadre', modelo: 'anthropic/claude-5-sonnet', costo_usd: 0.05 },
        { fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 2.00 },
      ],
      error: null,
    });
    expect((await getCostoPorFaseModelo()).map((x) => x.costoUsd)).toEqual([2, 0.05]);
  });

  it('sin filas devuelve una lista vacía, no una fila fantasma', async () => {
    expect(await getCostoPorFaseModelo()).toEqual([]);
  });
});

describe('getEquipo — la página Equipo/RBAC dice el rol real de cada quien', () => {
  const FILAS = [
    { id: 'u-1', tenant_id: null, rol: 'superadmin', nombre: 'Javier', email: 'javier@likida.ai', operador_id: null, tenant: null },
    { id: 'u-2', tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana Ruiz', email: 'ana@innovativos.mx', operador_id: null, tenant: { nombre: 'Transportes Innovativos' } },
    { id: 'u-3', tenant_id: 't-1', rol: 'contador', nombre: 'Marisol', email: 'marisol@innovativos.mx', operador_id: null, tenant: { nombre: 'Transportes Innovativos' } },
    { id: 'u-4', tenant_id: 't-1', rol: 'operador', nombre: null, email: 'juan@innovativos.mx', operador_id: 'op-7', tenant: { nombre: 'Transportes Innovativos' } },
  ];

  it('cada fila conserva SU rol, no el del primero ni uno fijo', async () => {
    respuestas.set('app_user', { data: FILAS, error: null });
    const r = await getEquipo();
    expect(r.map((u) => u.rol)).toEqual(['superadmin', 'flota_admin', 'contador', 'operador']);
  });

  it('trae el nombre de la flota de cada usuario, no solo su id', async () => {
    // Sin el join, la columna «Flota» de la pantalla queda vacía para todos y
    // un roster de varias flotas se vuelve ilegible.
    respuestas.set('app_user', { data: FILAS, error: null });
    const r = await getEquipo();
    expect(r.map((u) => u.tenantNombre)).toEqual([null, 'Transportes Innovativos', 'Transportes Innovativos', 'Transportes Innovativos']);
    expect(selects.get('app_user'), 'el join a `tenant` no viaja en el select').toContain('tenant:tenant_id(nombre)');
  });

  it('superadmin sin flota no es un error: `tenant_id` nulo es una fila válida', async () => {
    // 0001_init.sql:21 — un superadmin no pertenece a ninguna flota. Si esto se
    // leyera como error, la pantalla no podría listar al dueño del producto.
    respuestas.set('app_user', { data: [FILAS[0]], error: null });
    expect(await getEquipo()).toEqual([{
      id: 'u-1', email: 'javier@likida.ai', nombre: 'Javier', rol: 'superadmin',
      tenantId: null, tenantNombre: null, operadorId: null,
    }]);
  });

  it('el chofer trae su `operador_id`: es la columna de la que cuelga /mis-viajes', async () => {
    respuestas.set('app_user', { data: [FILAS[3]], error: null });
    const [chofer] = await getEquipo();
    expect(chofer.operadorId).toBe('op-7');
    // Sin nombre capturado se devuelve null, no la cadena 'null' ni el correo.
    expect(chofer.nombre).toBeNull();
  });

  it('una lectura caída LANZA, no se lee como «no hay equipo»', async () => {
    // Mismo criterio que el resto del archivo: una pantalla de permisos vacía
    // por un blip de red es peor que una pantalla que dice que falló.
    respuestas.set('app_user', { data: null, error: { message: 'fetch failed' } });
    await expect(getEquipo()).rejects.toThrow(/fetch failed/);
  });
});
