import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FASE_LABEL, etiquetaFase, ICONO_POR_FASE } from './fases';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO de la auditoría 10 (arquitectura) — `FASE_LABEL` COPIADO EN CUATRO
// PÁGINAS DE `/admin`, Y YA DIVERGENTE.
//
// Es el caso canónico que este rubro persigue desde la ronda 5 (`otro: 'Gasto'`
// en el motor contra `otro: 'Otro'` en el PDF y el panel, y el operador leía
// una palabra por WhatsApp y el contralor otra en el papel), reproducido en
// código escrito la misma semana en que se cerró el anterior.
//
// Las cuatro páginas pintan la MISMA dona sobre el MISMO `r.porFase`
// (`getResumenNegocio`), y cada una traducía la fase con su propia copia:
//
//   admin/page.tsx, analitica, costos-facturacion → seis claves
//   model-ops/page.tsx                            → TRES
//
// Con una fila de `fase='escalacion'` en la base —la 0025 sigue admitiéndola
// en el `check` y las filas históricas siguen ahí— Javier miraba cuatro
// pantallas de su propia consola:
//
//   /admin, /admin/analitica, /admin/costos-facturacion → «Agente de Escalación»
//   /admin/model-ops                                    → «escalacion»
//
// Ninguna de las cuatro estaba tipada como `Record<FaseCosto, string>` —todas
// eran `Record<string, string>`— así que `tsc` no veía nada, y `model-ops`
// listaba además sus fases desde un séptimo literal (`FASES`).
//
// Esta prueba fija las dos mitades: que la verdad esté en un solo archivo, y
// que nadie escriba la quinta copia.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

/** Todos los `.ts`/`.tsx` de `src/app/admin/`, sin pruebas. */
function paginas(dir = join(RAIZ, 'src/app/admin')): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...paginas(p)); continue; }
    if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
    out.push(p);
  }
  return out;
}

describe('el nombre de una fase se decide en un solo archivo', () => {
  it('ninguna página de /admin declara su propio mapa de fases', () => {
    // El guardarraíl que impide la QUINTA copia. Se mide sobre el código, no
    // sobre una lista escrita a mano: la lista también se desactualiza, que es
    // justo cómo llegaron a ser cuatro.
    const copias = paginas()
      .filter((f) => !f.endsWith(join('admin', 'fases.ts')))
      .filter((f) => /const\s+(FASE_LABEL|FASE_ICONO|FASES)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(
      copias,
      `estas páginas traducen las fases por su cuenta en vez de importar de admin/fases.ts:\n${copias.join('\n')}`,
    ).toEqual([]);
  });

  it('y las cuatro donas traducen la fase con la MISMA función', () => {
    // Las cuatro pintan `r.porFase` de `getResumenNegocio`. Si una vuelve a
    // indexar un mapa local, aquí se ve.
    const donas = paginas().filter((f) => readFileSync(f, 'utf8').includes('<Dona'));
    expect(donas.length, 'se movieron las donas de /admin: revisa esta prueba').toBeGreaterThanOrEqual(4);
    for (const f of donas) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f.slice(RAIZ.length + 1)} no usa etiquetaFase para la dona de "Costo por fase"`)
        .toContain('etiquetaFase');
    }
  });
});

describe('el mapa cubre exactamente las fases que el tipo permite', () => {
  // `FASE_LABEL` está tipado `Record<FaseCosto, string>`, así que `tsc` ya caza
  // una fase nueva sin etiqueta. Esto lo mide TAMBIÉN en runtime para que
  // aflojar el tipo a `Record<string, string>` —que es exactamente lo que
  // tenían las cuatro copias— no pase inadvertido.
  const fuente = readFileSync(join(RAIZ, 'src/lib/cuadra/costos.ts'), 'utf8');
  const i = fuente.indexOf('export type FaseCosto');
  const decl = fuente.slice(i, fuente.indexOf(';', i));
  const fases = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('se pudo leer FaseCosto de costos.ts', () => {
    expect(fases.length).toBeGreaterThan(3);
  });

  it('ni de más ni de menos', () => {
    expect(Object.keys(FASE_LABEL).sort()).toEqual([...fases].sort());
  });

  it('y cada fase tiene ícono', () => {
    for (const f of fases) expect(ICONO_POR_FASE[f], `falta ícono para "${f}"`).toBeTruthy();
  });
});

describe('las filas que la base todavía guarda se siguen leyendo', () => {
  it('`escalacion` se retiró del código pero no de la base: no se pinta en crudo', () => {
    // La fase salió de `FaseCosto` esta misma ronda (commit 3f58e3b) porque
    // ningún camino podía producirla, pero la migración 0025 sigue
    // admitiéndola en el `check` de la columna y las filas viejas siguen ahí.
    // Sin esta traducción, la dona de las cuatro pantallas pintaría la clave
    // cruda de la base — que es precisamente lo que `model-ops` hacía.
    expect(etiquetaFase('escalacion')).toBe('Agente de Escalación');
    expect(ICONO_POR_FASE['escalacion'], 'y su ícono, para el chip de "agente más caro"').toBeTruthy();
  });

  it('y una fase que nadie reconoce sale como viene, no como undefined', () => {
    expect(etiquetaFase('fase_que_no_existe')).toBe('fase_que_no_existe');
  });
});
