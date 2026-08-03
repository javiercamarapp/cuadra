import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CAMINO DEL WEBHOOK TIENE TECHO; EL DEL PANEL NO TENÍA NINGUNO.
// (auditoría 10, MEDIO)
//
// La ronda 9 verificó «toda consulta tiene techo» contando `supabaseAdmin()`
// contra `acotada(` en `repo.ts`, `conv.ts`, `costos.ts` y `config.ts`.
// `analytics.ts` no estaba en esa lista, y daba **5 vs 0**.
//
// Con valores: una flota de 30 unidades acumula ~14 400 filas de `gasto` en un
// año. `detectarAnomalias` encadena 15 consultas secuenciales de 1 000 filas —
// 15 × 0.3 s = 4.5 s solo esa tarjeta, en CADA carga del panel, sin caché
// (la página es dinámica por `requireSessionTenant`). Y basta una de esas 15
// lenta para que la carga no tenga piso: sin `acotada` el techo es el default de
// undici, **300 000 ms**, y ninguna página de `src/app` declara `maxDuration`.
//
// Consecuencia: en un episodio de Supabase degradado el panel se cuelga EN
// BLANCO en vez de pintar el fallback que `safe()` (dashboard/page.tsx) fue
// diseñado para pintar — `safe()` atrapa excepciones, no esperas. Con `acotada`,
// agotar el tope entra por el MISMO camino que un error de Postgres
// (`{ data: null, error }`), que es justo lo que `exigir()` convierte en
// excepción y `safe()` sabe atrapar.
// ═══════════════════════════════════════════════════════════════════════════

/** Tablas que recibieron señal de aborto (o sea, que pasaron por `acotada`). */
const conSenal = new Set<string>();

function crearBuilder(tabla: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit', 'is', 'range', 'maybeSingle']) b[m] = self;
  b.abortSignal = () => { conSenal.add(tabla); return b; };
  b.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getKpis, getStatsPorOperador, detectarAnomalias, getAcreditables } = await import('./analytics');

describe('el panel del contralor también tiene techo de consulta', () => {
  beforeEach(() => { conSenal.clear(); });

  it('getKpis', async () => {
    await getKpis('t1');
    expect(conSenal.has('liquidacion'), 'getKpis consulta sin `acotada`').toBe(true);
  });

  it('getStatsPorOperador — las tres consultas en paralelo', async () => {
    await getStatsPorOperador('t1');
    for (const t of ['operador', 'gasto', 'viaje']) {
      expect(conSenal.has(t), `getStatsPorOperador/${t} sin \`acotada\``).toBe(true);
    }
  });

  it('detectarAnomalias — la que encadena hasta 15 páginas', async () => {
    await detectarAnomalias('t1');
    expect(conSenal.has('gasto'), 'detectarAnomalias sin `acotada`: 15 consultas de 300 s cada una').toBe(true);
  });

  it('getAcreditables', async () => {
    await getAcreditables('t1');
    expect(conSenal.has('liquidacion'), 'getAcreditables sin `acotada`').toBe(true);
  });

  it('el archivo entero: ninguna consulta se escapa', () => {
    const src = sinComentarios(readFileSync('src/lib/cuadra/analytics.ts', 'utf8'));
    // Cada `supabaseAdmin()` que se consulta, y cada `admin.from(` de un cliente
    // hoisteado, tiene que ir dentro de `acotada(` — la lección del mutex del
    // "listo": el techo va por LLAMADA, no por cliente.
    const consultas = [...src.matchAll(/(supabaseAdmin\(\)|\badmin)\s*\n?\s*\.from\(/g)].length;
    const acotadas = [...src.matchAll(/acotada\(/g)].length;
    expect(consultas).toBeGreaterThan(0);
    expect(acotadas, `${consultas} consultas y solo ${acotadas} \`acotada(\``).toBeGreaterThanOrEqual(consultas);
  });
});
