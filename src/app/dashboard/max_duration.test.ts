import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-52 (MEDIO, rendimiento) — «`grep -rn maxDuration src/` →
// una sola ruta en todo el repo», y es el webhook.
//
// Toda página de /dashboard es `force-dynamic`: se renderiza en cada carga y
// consulta la base. Sin `maxDuration`, el techo es el de la plataforma (300 s
// en el plan pro), y una Supabase degradada deja la pestaña girando cinco
// minutos contra un contralor en una sala.
//
// El tope por consulta ya existe (`acotada`, 8 s + gracia), así que este es el
// segundo cinturón: acota la SUMA — una página monta hasta cinco lecturas en
// paralelo más la sesión. 60 s deja margen de sobra al peor caso legítimo y
// convierte "girando para siempre" en un error que Vercel registra.
//
// ALCANCE: las páginas de este dominio. Las de operación (`despacho`, `pod`,
// `unidades`, `incidencias`, `viajes`, `operadores`) las declara su dominio.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/dashboard');

const PENDIENTES = new Set([
  'despacho/page.tsx', 'pod/page.tsx', 'unidades/page.tsx',
  'incidencias/page.tsx', 'viajes/page.tsx', 'operadores/page.tsx',
  // `mapa` y `soporte` son stubs estáticos de otro dominio de esta ronda.
  'mapa/page.tsx', 'soporte/page.tsx',
]);

function paginas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...paginas(p));
    else if (e === 'page.tsx') out.push(p);
  }
  return out;
}

const dinamicas = paginas(RAIZ)
  .map((p) => ({ rel: p.slice(RAIZ.length + 1).split('\\').join('/'), src: readFileSync(p, 'utf8') }))
  .filter(({ src }) => src.includes("dynamic = 'force-dynamic'"))
  .filter(({ rel }) => !PENDIENTES.has(rel));

describe('ninguna página del panel puede colgarse hasta el techo de la plataforma', () => {
  it('hay páginas dinámicas que revisar', () => {
    expect(dinamicas.length).toBeGreaterThan(5);
  });

  for (const { rel, src } of dinamicas) {
    it(`${rel} declara maxDuration`, () => {
      const m = src.match(/export const maxDuration = (\d+)/);
      expect(m, `${rel} hereda el techo de la plataforma (300 s en pro)`).toBeTruthy();
      expect(Number(m![1]), 'un techo por debajo del tope de consulta corta lecturas sanas').toBeGreaterThan(10);
      expect(Number(m![1]), 'un techo de minutos no es un techo').toBeLessThanOrEqual(120);
    });
  }
});
