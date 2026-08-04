import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-32 (CRÍTICO, operabilidad) — «Dieciséis copias del mismo
// `catch` vacío se tragan todos los errores de lectura del panel».
//
//     async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
//       try { return await fn(); } catch { return null; }
//     }
//
// Quince archivos bajo `src/app/dashboard/`, byte a byte idénticas, más el
// handler del rail. El caso más caro es `cuadre/page.tsx`: `getLiquidaciones`
// LANZA a propósito —es el CRÍTICO de la auditoría 5, los paneles que decían
// "12 viajes liquidados" con la base caída— y once líneas más abajo este
// `catch` se come ese throw. La intención sobrevive de cara al usuario (la
// pantalla dice "no se pudo cargar") y muere de cara a quien opera el sistema:
// de todo `src/app/`, seis archivos importaban `@/lib/logger`, y ninguna de
// las 20 páginas de /dashboard estaba entre ellos. En Next.js, además, un
// `catch` vacío en un Server Component apaga `onRequestError`.
//
// El helper vive en `pg.ts` con los otros dos bordes de PostgREST (`exigir`,
// `traerTodo`): es el mismo problema —un fallo que se lee como "no hay nada"—
// una capa más arriba.
// ═══════════════════════════════════════════════════════════════════════════

const error = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { safeLog } = await import('./pg');

beforeEach(() => error.mockClear());

describe('safeLog: se traga el fallo para la pantalla, no para el operador', () => {
  it('devuelve el valor cuando todo va bien, y no registra nada', async () => {
    await expect(safeLog(async () => ({ viajes: 12 }), 'x')).resolves.toEqual({ viajes: 12 });
    expect(error).not.toHaveBeenCalled();
  });

  it('devuelve null cuando lanza — la pantalla sigue pintando su fallback', async () => {
    await expect(safeLog(async () => { throw new Error('fetch failed'); }, 'x')).resolves.toBeNull();
  });

  it('y DEJA CONSTANCIA, con el contexto y el mensaje', async () => {
    await safeLog(async () => { throw new Error('fetch failed'); }, 'dashboard/cuadre.liquidaciones');

    expect(error).toHaveBeenCalledTimes(1);
    const [msg, meta] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(`${msg} ${JSON.stringify(meta)}`).toContain('dashboard/cuadre.liquidaciones');
    expect(`${msg} ${JSON.stringify(meta)}`).toContain('fetch failed');
  });

  it('un lanzamiento que no es Error tampoco se pierde', async () => {
    await safeLog(async () => { throw 'se cayó'; }, 'x');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('avisa al llamador que hubo fallo, para que pueda decirlo en su respuesta', async () => {
    const avisos: unknown[] = [];
    await safeLog(async () => { throw new Error('boom'); }, 'x', (e) => avisos.push(e));
    expect(avisos).toHaveLength(1);
  });
});

// ── Que no vuelva a haber una copia dieciséis ──────────────────────────────

const RAIZ = 'src';
const PATRON = /catch\s*(\([^)]*\))?\s*\{\s*return null;?\s*\}/;

/** Las copias que viven en dominios de otros agentes de esta ronda y migran
 *  cuando su dominio aterrice. La prueba exige que el conjunto de infractores
 *  sea SUBCONJUNTO de esta lista: quitar una de aquí sin arreglarla, o
 *  escribir una copia nueva en cualquier otro archivo, la pone en rojo. */
const PENDIENTES = new Set([
  // Las seis páginas de operación YA migraron (auditoría 11, cierre cruzado).
  // Queda una sola excepción, y no es deuda: el `catch` del parser de XML
  // decide "este XML no es CFDI", que es un VEREDICTO del dominio, no un fallo
  // de lectura que haya que registrar. Un `safeLog` ahí llenaría el log de
  // errores con archivos que simplemente no eran facturas.
  'src/lib/cuadra/intake/cfdi_xml.ts',
]);

function archivos(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) archivos(p, acc);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acc.push(p);
  }
  return acc;
}

describe('el catch vacío vive en UN archivo', () => {
  it('nadie más se traga un error de lectura en silencio', () => {
    const infractores = archivos(RAIZ)
      .filter((p) => !p.endsWith(join('lib', 'cuadra', 'pg.ts')))
      .filter((p) => PATRON.test(readFileSync(p, 'utf8')))
      .map((p) => p.split('\\').join('/'))
      .filter((p) => !PENDIENTES.has(p));

    expect(infractores, 'usa `safeLog` de `lib/cuadra/pg.ts`: registra y devuelve null').toEqual([]);
  });
});
