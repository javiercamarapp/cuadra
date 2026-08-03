import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO de backend + BAJO de seguridad (auditoría 10) — `/acceso` seguía viva,
// seguía "aceptando" el passcode, y no concedía nada.
//
// El login por passcode se reemplazó por sesión de Supabase, pero la página
// quedó servida y funcional: comparaba `DASHBOARD_PASSCODE` en tiempo constante,
// escribía la cookie firmada `likida_access` con 8 h de vida y redirigía a
// `/dashboard`. El proxy ya no lee esa cookie —solo pregunta por sesión de
// Supabase (`proxy.ts:59`)—, así que el redirect terminaba en
// `/login?next=/dashboard`.
//
// Escenario del 6-ago: alguien del equipo abre el bookmark de `/acceso` (era la
// única puerta hasta hace tres días), teclea el código CORRECTO, la pantalla no
// da ningún error, y aparece otra pantalla de login pidiendo un correo. Nada en
// ninguna de las dos dice que el passcode dejó de existir: en la sala se ve como
// que el panel no reconoce una credencial que sí es válida. Y si
// `DASHBOARD_PASSCODE` sigue puesto en Vercel con un valor débil,
// `passcodeConfigurado()` lanza y esa ruta responde 500 en producción.
//
// El arreglo es el que el propio plan de la migración de auth dejó escrito y
// nunca se ejecutó (`docs/superpowers/plans/2026-08-02-auth-panel.md:1085`):
// borrar la página, el módulo del passcode y su prueba.
//
// LÍMITE DE ESTA PRUEBA, dicho aquí y no en el commit: es ESTRUCTURAL. Un
// server action de una página borrada no se puede ejercer, así que lo único
// comprobable es que ni la ruta ni su mecanismo siguen en el árbol y que el
// secreto se quedó sin lector. Lo que NO demuestra es que el bookmark devuelva
// 404 en producción — eso lo decide el router de Next sobre este mismo árbol.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

/** Todos los `.ts`/`.tsx` de `src/`, sin pruebas. */
function fuentes(dir = join(RAIZ, 'src')): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) { out.push(...fuentes(p)); continue; }
    if (!/\.tsx?$/.test(entrada) || /\.test\.tsx?$/.test(entrada)) continue;
    out.push(p);
  }
  return out;
}

describe('la puerta del passcode ya no está servida', () => {
  it('`/acceso` no existe como ruta', () => {
    expect(existsSync(join(RAIZ, 'src/app/acceso/page.tsx'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/app/acceso'))).toBe(false);
  });

  it('el módulo del passcode se fue con ella', () => {
    // Mientras `passcode.ts` siga en el árbol, su criptografía sigue verde en la
    // suite y da la impresión de que hay un mecanismo de acceso vivo. No lo hay:
    // `tokenMatches` no tenía un solo consumidor fuera de su propia prueba.
    expect(existsSync(join(RAIZ, 'src/lib/auth/passcode.ts'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/lib/auth/passcode.test.ts'))).toBe(false);
  });

  it('`DASHBOARD_PASSCODE` se quedó sin un solo lector en el código', () => {
    // Es la mitad que importa para seguridad: un secreto vivo en el entorno que
    // ya no protege nada sigue siendo un secreto que rotar, auditar y filtrar.
    const lectores = fuentes()
      .filter((f) => readFileSync(f, 'utf8').includes('DASHBOARD_PASSCODE'))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(lectores, 'algo volvió a leer el passcode del panel').toEqual([]);
  });

  it('la cookie `likida_access` ya no la emite nadie', () => {
    const emisores = fuentes()
      .filter((f) => readFileSync(f, 'utf8').includes('likida_access'))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(emisores, 'volvió a emitirse una cookie de acceso que ningún gate lee').toEqual([]);
  });
});
