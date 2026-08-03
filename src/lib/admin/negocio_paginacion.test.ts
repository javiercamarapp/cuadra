import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// /admin: CUATRO ESCANEOS DE TABLA COMPLETA POR PÁGINA, SIN TECHO DE CONSULTA
// Y CON RECORTE SILENCIOSO A 1 000 FILAS. (auditoría 10, ALTO)
//
// Ninguna de las consultas de `negocio.ts` llevaba `.limit()`, `.range()` ni
// `acotada` — el archivo tenía 4 `supabaseAdmin()` y 0 `acotada`. Y vive en
// `admin/layout.tsx`, o sea que corre en las 30 páginas de `/admin`.
//
// Con valores: una flota real de 30 unidades × 4 viajes/mes × 10 comprobantes
// son 1 200 filas de `gasto` en el PRIMER MES. PostgREST recorta a `max_rows`
// (1 000 por default) EN SILENCIO: no lanza, no loguea. Es textualmente lo que
// este repo ya documentó y cerró para `analytics.ts` ("AUDITORÍA 8, ALTO
// REINCIDENTE") — el patrón `traerTodo` no viajó al archivo nuevo.
//
// A partir de la fila 1 001 el contador retro de facturas se CONGELA en 1 000 y
// no se mueve nunca más. Peor: sin `.order()` las 1 000 que vuelven son las que
// PostgREST decida —típicamente las más viejas—, así que `facturasPorDia`
// (últimos 7 días) pinta SIETE CEROS en un mes con actividad diaria. Lo mismo le
// pasa a `viajesProcesados`, `costoIaUsd`, `tokensIn/Out`, `porFase`,
// `porModelo` y a las dos tendencias.
//
// Es la pantalla desde la que se fija el precio del producto, porque de ahí sale
// el costo de IA por viaje. Enseñaba un negocio detenido en el mes 1 con la
// misma cara que si de verdad no hubiera pasado nada.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ROWS = 1_000;   // el `max_rows` por default de PostgREST

type Fila = Record<string, unknown>;
const tablas = new Map<string, Fila[]>();
/** Rangos que cada tabla recibió: sirve para probar que SÍ se pagina. */
const rangos = new Map<string, Array<[number, number]>>();
/** Consultas que llegaron con señal de aborto (o sea, por `acotada`). */
const conSenal = new Set<string>();

function crearBuilder(tabla: string) {
  let desde = 0, hasta = Infinity;
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit', 'is']) b[m] = self;
  b.range = (a: number, z: number) => {
    desde = a; hasta = z;
    rangos.set(tabla, [...(rangos.get(tabla) ?? []), [a, z]]);
    return b;
  };
  b.abortSignal = () => { conSenal.add(tabla); return b; };
  b.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
    const todas = tablas.get(tabla) ?? [];
    // PostgREST: recorta a `max_rows` EN SILENCIO, con o sin `range`.
    const trozo = todas.slice(desde, Math.min(hasta + 1, desde + MAX_ROWS));
    return Promise.resolve({ data: trozo, error: null }).then(ok, fail);
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getResumenNegocio, getCostoPorFaseModelo } = await import('./negocio');

/** 1 200 comprobantes: 1 000 del mes viejo y 200 de los últimos días. */
function mesRealDeUnaFlota(hoy: string) {
  const viejas = Array.from({ length: 1_000 }, (_, i) =>
    ({ created_at: `2026-07-0${(i % 5) + 1}T08:00:00Z` }));
  const recientes = Array.from({ length: 200 }, () => ({ created_at: `${hoy}T08:00:00Z` }));
  return [...viejas, ...recientes];
}

describe('la consola de negocio no se congela en la fila 1 000', () => {
  beforeEach(() => { tablas.clear(); rangos.clear(); conSenal.clear(); });

  it('el contador retro de facturas cuenta las 1 200, no 1 000', async () => {
    tablas.set('gasto', mesRealDeUnaFlota('2026-08-02'));
    const r = await getResumenNegocio('2026-08-02');
    expect(
      r.facturasTotal,
      'se congeló en el recorte silencioso de PostgREST: el negocio deja de crecer en pantalla',
    ).toBe(1_200);
  });

  it('y la gráfica de los últimos 7 días no pinta siete ceros con actividad diaria', async () => {
    tablas.set('gasto', mesRealDeUnaFlota('2026-08-02'));
    const r = await getResumenNegocio('2026-08-02');
    expect(r.facturasPorDia.find((d) => d.dia === '2026-08-02')?.n).toBe(200);
  });

  it('el costo de IA suma TODAS las filas de llm_costo, no las primeras mil', async () => {
    tablas.set('llm_costo', Array.from({ length: 1_500 }, () => ({
      tenant_id: 't1', fase: 'ocr', modelo: 'google/gemini-3.6-flash',
      tokens_in: 100, tokens_out: 10, costo_usd: 0.01, created_at: '2026-08-01T10:00:00Z',
    })));
    const r = await getResumenNegocio('2026-08-02');
    expect(r.costoIaUsd).toBe(15);          // 1 500 × $0.01, no 1 000 × $0.01
    expect(r.tokensIn).toBe(150_000);
    expect(r.porFase[0]).toEqual({ fase: 'ocr', n: 1_500, costoUsd: 15 });
  });

  it('`viajesProcesados` tampoco se detiene en mil', async () => {
    tablas.set('viaje', Array.from({ length: 1_200 }, (_, i) => ({ id: `v${i}`, tenant_id: 't1' })));
    const r = await getResumenNegocio('2026-08-02');
    expect(r.viajesProcesados).toBe(1_200);
  });

  it('`getCostoPorFaseModelo` (Model Ops / Agente OCR) pagina igual', async () => {
    tablas.set('llm_costo', Array.from({ length: 1_200 }, () => ({
      fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 0.01,
    })));
    const r = await getCostoPorFaseModelo();
    expect(r[0].n).toBe(1_200);
  });

  it('las cuatro tablas se piden por páginas, no de un tirón', async () => {
    tablas.set('gasto', mesRealDeUnaFlota('2026-08-02'));
    await getResumenNegocio('2026-08-02');
    for (const t of ['tenant', 'viaje', 'llm_costo', 'gasto']) {
      expect(rangos.get(t), `${t} se pidió sin \`range\`: entra con el recorte puesto`).toBeTruthy();
    }
    // 1 200 filas son DOS páginas, y la segunda tiene que pedirse de verdad.
    expect(rangos.get('gasto')!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('y ninguna de esas consultas se queda sin techo', () => {
  beforeEach(() => { tablas.clear(); rangos.clear(); conSenal.clear(); });

  it('las consultas llevan señal de aborto (`acotada`)', async () => {
    // Sin techo, un Supabase degradado no degrada la consola: la CUELGA. No hay
    // `export const maxDuration` en ninguna página de `src/app` — solo lo tiene
    // el webhook—, así que el techo es el default de undici: 300 s.
    tablas.set('gasto', [{ created_at: '2026-08-01T08:00:00Z' }]);
    await getResumenNegocio('2026-08-02');
    for (const t of ['tenant', 'viaje', 'llm_costo', 'gasto']) {
      expect(conSenal.has(t), `${t} se consulta sin \`acotada\``).toBe(true);
    }
  });

  it('el archivo entero: tantas `acotada` como `supabaseAdmin()`', () => {
    const src = readFileSync('src/lib/admin/negocio.ts', 'utf8');
    const clientes = [...src.matchAll(/supabaseAdmin\(\)/g)].length;
    const acotadas = [...src.matchAll(/acotada\(/g)].length;
    expect(clientes).toBeGreaterThan(0);
    expect(acotadas, `${clientes} supabaseAdmin() y solo ${acotadas} acotada(`).toBeGreaterThanOrEqual(clientes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// «COSTO POR MODELO» AGRUPABA `llm_costo.modelo` EN CRUDO, Y ESA COLUMNA GUARDA
// DOS COSAS DISTINTAS. (auditoría 10 — consumo de la atribución de costo)
//
// Unas filas traen un SLUG DE PROVEEDOR (`google/gemini-3.6-flash`,
// `anthropic/claude-sonnet-5`) y otras una ETIQUETA INTERNA que ningún
// proveedor de modelos facturó nunca: `whatsapp-utility` es el precio por
// mensaje saliente de Meta (`costos.ts:87`), no una llamada a un LLM.
//
// `/admin` las pintaba juntas bajo «Costo por modelo», con icono de proveedor y
// en fuente monoespaciada, y `/admin/integraciones` bajo «Proveedores de modelos
// (LLM) — los modelos reales que corrieron OCR y Cuadre». En la pantalla desde
// la que se fija el precio del producto, Meta aparecía como proveedor de LLM.
// ═══════════════════════════════════════════════════════════════════════════
describe('un slug de proveedor no es lo mismo que una etiqueta interna', () => {
  beforeEach(() => { tablas.clear(); rangos.clear(); conSenal.clear(); });

  const fila = (modelo: string, fase: string, costo: number) => ({
    tenant_id: 't1', fase, modelo, tokens_in: 10, tokens_out: 2,
    costo_usd: costo, created_at: '2026-08-01T10:00:00Z',
  });

  it('«Costo por modelo» solo lista modelos de verdad', async () => {
    tablas.set('llm_costo', [
      fila('google/gemini-3.6-flash', 'ocr', 0.015),
      fila('whatsapp-utility', 'whatsapp', 0.008),
      fila('whatsapp-utility', 'whatsapp', 0.008),
    ]);
    const r = await getResumenNegocio('2026-08-02');
    expect(r.porModelo.map((m) => m.modelo)).toEqual(['google/gemini-3.6-flash']);
  });

  it('y la etiqueta interna no se pierde: se agrupa aparte', async () => {
    tablas.set('llm_costo', [
      fila('google/gemini-3.6-flash', 'ocr', 0.015),
      fila('whatsapp-utility', 'whatsapp', 0.008),
      fila('whatsapp-utility', 'whatsapp', 0.008),
    ]);
    const r = await getResumenNegocio('2026-08-02');
    // 2 × USD 0.008 = 0.016, y así se reporta. Con el `round2` que esta
    // pantalla tenía salía $0.02: un 25% de más en la línea de WhatsApp de la
    // pantalla desde la que se fija el precio (auditoría 10, BAJO).
    expect(r.porServicio).toEqual([{ servicio: 'whatsapp-utility', n: 2, costoUsd: 0.016 }]);
  });

  it('los totales no se tocan: lo que cambia es el agrupado, no la suma', async () => {
    tablas.set('llm_costo', [
      fila('google/gemini-3.6-flash', 'ocr', 0.015),
      fila('whatsapp-utility', 'whatsapp', 0.008),
    ]);
    const r = await getResumenNegocio('2026-08-02');
    // 0.015 + 0.008 = 0.023, sin redondear a centavos (ver arriba).
    expect(r.costoIaUsd).toBe(0.023);
    expect(r.porFase.map((f) => f.fase).sort()).toEqual(['ocr', 'whatsapp']);
  });

  it('`getCostoPorFaseModelo` (Model Ops / Agente OCR) aplica el mismo criterio', async () => {
    tablas.set('llm_costo', [
      { fase: 'ocr', modelo: 'google/gemini-3.6-flash', costo_usd: 0.015 },
      { fase: 'whatsapp', modelo: 'whatsapp-utility', costo_usd: 0.008 },
    ]);
    const r = await getCostoPorFaseModelo();
    expect(r.map((x) => x.modelo)).toEqual(['google/gemini-3.6-flash']);
  });
});
