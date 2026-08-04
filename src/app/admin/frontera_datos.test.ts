import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// LA FRONTERA DE DATOS DE /admin, MEDIDA EN VEZ DE RECORDADA.
//
// AUDITORÍA 11 · G-49 (y la mitad estructural de G-33). La consola de
// superadmin tenía UNA regla arquitectónica de verdad —«/admin no habla con
// Supabase; habla con `@/lib/admin/negocio`»— y la ronda 10 la verificó
// intacta a mano. La ronda 11 la encontró rota: `admin/mi-perfil/page.tsx`
// había nacido con tres `supabaseAdmin()` propios (`:31`, `:38`, `:56`), y
// los tres descartaban el `error`.
//
// POR QUÉ IMPORTA, más allá del gusto por las capas: `negocio.ts` es la única
// función del repo con permiso de cruzar TODOS los tenants. Que sea un solo
// archivo es lo que hace posible auditarlo, ponerle el `exigir()` una vez, y
// que nadie copie desde aquí un patrón sin `.eq('tenant_id', …)` hacia una
// consulta de cliente. Cada consulta suelta en una página es una copia que
// nadie va a revisar, y `page.tsx` además está EXCLUIDO de la medición de
// cobertura: se escribe sin prueba y no se nota.
//
// Una regla que solo vive en un comentario dura hasta la siguiente página
// nueva. Esta la mide.
//
// LO QUE SÍ SE PERMITE: el cliente de SESIÓN (`supabaseServer()` para
// `auth.signOut()` en el layout). No lee ni escribe tablas de negocio.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/admin');

function archivosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) { salida.push(...archivosFuente(ruta)); continue; }
    if (!/\.(ts|tsx)$/.test(entrada) || entrada.includes('.test.')) continue;
    salida.push(ruta);
  }
  return salida;
}

/** Se mide el CÓDIGO, no los comentarios: este mismo archivo y el encabezado
 *  de `mi-perfil/acciones.ts` CITAN `supabaseAdmin()` para contar la historia
 *  del hallazgo, y una prueba que prohíbe explicar el bug que vigila obliga a
 *  borrar justo la explicación que hace falta para no repetirlo (mismo
 *  criterio que los guardarraíles de `formato.test.ts`). */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const fuentes = archivosFuente(RAIZ).map((f) => ({
  ruta: f.replace(`${process.cwd()}/`, ''),
  codigo: sinComentarios(readFileSync(f, 'utf8')),
}));

describe('/admin no habla con la base por su cuenta', () => {
  it('hay archivos que medir (si esto falla, el recorrido se rompió, no la regla)', () => {
    expect(fuentes.length).toBeGreaterThan(20);
  });

  it('ninguna página ni componente importa el cliente de servicio', () => {
    const culpables = fuentes
      .filter((f) => /@\/lib\/supabase\/admin/.test(f.codigo))
      .map((f) => f.ruta);
    expect(
      culpables,
      'estos archivos de /admin abren su propio cliente de servicio en vez de pasar por '
      + '@/lib/admin/negocio — que es el único sitio con permiso de cruzar tenants:\n'
      + culpables.join('\n'),
    ).toEqual([]);
  });

  it('ninguna página ni componente nombra una tabla', () => {
    const culpables = fuentes
      .filter((f) => /\.from\(['"`]|\.rpc\(['"`]/.test(f.codigo))
      .map((f) => f.ruta);
    expect(
      culpables,
      'estos archivos de /admin consultan tablas directamente. La consulta va en '
      + '@/lib/admin/negocio, donde el `error` se comprueba UNA vez y se puede auditar:\n'
      + culpables.join('\n'),
    ).toEqual([]);
  });

  it('ni el almacenamiento: el bucket `avatares` es público y su contentType se decide en un solo sitio', () => {
    const culpables = fuentes
      .filter((f) => /\.storage\b/.test(f.codigo))
      .map((f) => f.ruta);
    expect(culpables, culpables.join('\n')).toEqual([]);
  });
});
