import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FASE_LABEL } from '../admin/fases';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-46 (ALTO, arquitectura) — «`FASE_LABEL` pasó de cuatro
// copias a cinco, y la quinta cruzó al panel del cliente».
//
// La ronda anterior consolidó las cuatro copias de /admin en `admin/fases.ts`
// y dejó un guardarraíl… que solo mira `src/app/admin/` (`fases.test.ts:39`).
// La quinta copia vivía en `dashboard/valor-ahorro/page.tsx`, fuera de ese
// barrido, tipada `Record<string, string>` —así que `tsc` tampoco la veía— y
// con SEIS claves contra las cinco de `FaseCosto`.
//
// No es cosmético: esa dona es la pantalla que existe para justificarle el
// precio al contralor. Una fase nueva sin etiqueta pinta su clave cruda ahí.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

function archivos(dir = join(RAIZ, 'src/app/dashboard')): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...archivos(p)); continue; }
    if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
    out.push(p);
  }
  return out;
}

describe('el panel del cliente no traduce las fases por su cuenta', () => {
  it('ninguna pantalla de /dashboard declara su propio mapa de fases', () => {
    const copias = archivos()
      .filter((f) => /const\s+(FASE_LABEL|FASE_ICONO|FASES)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));

    expect(copias, `importa el mapa de admin/fases.ts en vez de copiarlo:\n${copias.join('\n')}`).toEqual([]);
  });

  it('la que quedó traduce con el mapa tipado, que es exhaustivo por construcción', () => {
    const fuente = readFileSync(join(RAIZ, 'src/app/dashboard/valor-ahorro/page.tsx'), 'utf8');
    expect(fuente).toContain("from '../../admin/fases'");
    // Y ese mapa NO tiene la clave fantasma que traía la copia: `escalacion`
    // no está en `FaseCosto` desde que la fase se retiró.
    expect(Object.keys(FASE_LABEL)).not.toContain('escalacion');
  });
});
