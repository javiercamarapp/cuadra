import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO de la auditoría 10 (arquitectura) — CUATRO ARCHIVOS REPETÍAN A MANO EL
// `.eq('tenant_id', …)` SOBRE `liquidacion`, UNO DENTRO DE UN COMPONENTE DE
// PÁGINA.
//
// Los seis sitios usaban `supabaseAdmin()` — service-role, RLS NO se evalúa —,
// así que el aislamiento entre flotas dependía de que cada consulta acordara
// poner el filtro. `dashboard/page.tsx` era el peor colocado: una función de
// consulta (`getLiquidaciones`) definida dentro del archivo de la página,
// teniendo `analytics.ts` al lado con `getKpis`/`getAcreditables`/
// `getLiquidacionDetalle` y la misma firma `(…, tenantId)`.
//
// El cambio que lo hace estallar es la PRÓXIMA consulta que alguien escriba
// copiando del vecino equivocado — y no había dónde poner el filtro una sola
// vez. La medida del rubro venía empeorando desde la ronda 8: el porcentaje de
// accesos directos fuera de `repo.ts` subió de 62% a 67%, y de los 11 sitios
// nuevos de esta ronda, los 11 están fuera.
//
// Esta prueba es lo que impide el quinto: se mide sobre el código, no sobre una
// lista escrita a mano.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const MODULO = join('lib', 'cuadra', 'liquidaciones.ts');

/** Todos los `.ts`/`.tsx` de `src/`, sin pruebas. */
function fuentes(dir = join(RAIZ, 'src')): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...fuentes(p)); continue; }
    if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
    out.push(p);
  }
  return out;
}

describe('leer una liquidación tiene UNA respuesta, y trae el tenant pegado', () => {
  it('nadie consulta `liquidacion` fuera del módulo que pone el filtro', () => {
    const sueltos = fuentes()
      .filter((f) => !f.endsWith(MODULO))
      .filter((f) => /\.from\(\s*'liquidacion'\s*\)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(
      sueltos,
      `estos archivos consultan liquidacion por su cuenta —con service-role, sin RLS— en vez de usar liquidacionesDe():\n${sueltos.join('\n')}`,
    ).toEqual([]);
  });

  it('y el módulo no puede consultar sin tenant: el filtro es un argumento, no una línea que se olvida', () => {
    const src = readFileSync(join(RAIZ, 'src', MODULO), 'utf8');
    expect(src, 'liquidacionesDe dejó de exigir el tenantId').toMatch(/export function liquidacionesDe[^(]*\(\s*\n?\s*tenantId: string/);
    expect(src, 'liquidacionesDe dejó de aplicar el .eq del tenant').toContain(".eq('tenant_id', tenantId)");
  });

  it('la página del panel no define su propia consulta: eso vive en analytics.ts', () => {
    // `getLiquidaciones` estaba dentro de `app/dashboard/page.tsx`. Un
    // componente de página no es donde se decide cómo se lee la tabla de
    // dinero de una flota.
    const pagina = readFileSync(join(RAIZ, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(pagina, 'volvió una función de consulta al archivo de la página')
      .not.toMatch(/async function get\w+\s*\([^)]*tenantId/);
    expect(readFileSync(join(RAIZ, 'src/lib/cuadra/analytics.ts'), 'utf8'))
      .toContain('export async function getLiquidaciones(');
  });
});
