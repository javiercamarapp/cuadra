import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// TODA página de /dashboard llama a una guarda. Sin excepción de "es un stub".
//
// `dashboard/layout.tsx` solo pregunta "¿hay sesión?" — no "¿este rol puede
// estar aquí?". Una página que no llama a ninguna guarda le sale al rol
// equivocado con el sidebar VACÍO (el sidebar sí filtra por rol): un estado
// que la UI no sabe pintar, y precisamente al que no debería estar ahí.
//
// Y un stub también filtra: "Cobranza" vacía le anuncia a un jefe de tráfico
// qué mira su patrón. El día que deje de ser stub, el gate ya está puesto en
// vez de ser algo que alguien tenga que acordarse de agregar.
// ═══════════════════════════════════════════════════════════════════════════

/** Las tres puertas válidas. Cualquiera sirve; ninguna no. */
const GUARDAS = ['resolverTenantEfectivo', 'exigirVerRuta', 'requireSessionTenant'] as const;

const RAIZ = join(process.cwd(), 'src/app/dashboard');

function paginas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...paginas(p));
    else if (e === 'page.tsx') out.push(p);
  }
  return out;
}

describe('toda page.tsx de /dashboard pasa por una guarda', () => {
  const encontradas = paginas(RAIZ);

  it('encuentra las páginas del panel (si no, la prueba no está probando nada)', () => {
    expect(encontradas.length).toBeGreaterThan(15);
  });

  it.each(encontradas.map((p) => [p.slice(RAIZ.length + 1), p]))(
    '%s llama a una guarda',
    (_rel, ruta) => {
      const src = readFileSync(ruta as string, 'utf8');
      const usa = GUARDAS.filter((g) => src.includes(`${g}(`));
      expect(usa, `${_rel} no llama a ninguna de: ${GUARDAS.join(', ')}`).not.toHaveLength(0);
    },
  );
});
