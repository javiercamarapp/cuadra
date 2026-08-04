import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-37 (residual) — la segunda pantalla de login que no
// autoriza nada, y la variable que grita una consecuencia falsa.
//
// El gate del panel es la sesión de Supabase, en dos capas: `src/proxy.ts` y
// `requireSessionTenant` en cada página. `/acceso` sobrevivió a ese cambio
// como una SEGUNDA pantalla de login, con otro branding, que compara un
// passcode compartido y emite una cookie que ningún gate lee: quien acierta el
// código acaba en `/login` igual, y quien falla ve "Código incorrecto" de una
// puerta que no da a ningún lado.
//
// Lo caro no es la pantalla, es lo que arrastra: `DASHBOARD_PASSCODE` seguía
// declarada en `.env.example` con la consecuencia `proxy.ts NO bloquea
// /dashboard`, que es FALSA —`proxy.ts` no nombra esa variable en ninguna
// línea—. Quien la quitara, que es lo correcto, se comía un `error` en cada
// arranque en frío en el MISMO `msg` (y por tanto el mismo cubo de Sentry) que
// el aviso real de `DEMO_TENANT_ID`. El anti-patrón está escrito con nombre y
// fecha en `cuadra/startup.ts`: cuando el aviso resulta ser mentira una vez,
// se aprende a ignorarlo — y el que se aprende a ignorar es el que más importa
// el 6 de agosto.
//
// `arranque.ts` y `DEPLOY.md` YA daban por hecho este retiro y nombraban este
// archivo. Existía la prosa y no el borrado: esta prueba es la que lo mide.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    // Solo CÓDIGO: las pruebas nombran la variable justamente para vigilar que
    // nadie la lea, y contarlas como lectoras dejaría este trinquete sin poder
    // pasar nunca.
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

describe('G-37 · el passcode del panel no le quedó un solo lector', () => {
  it('`DASHBOARD_PASSCODE` no se lee en ningún archivo de `src/`', () => {
    const lectores = fuentes(join(RAIZ, 'src'))
      .filter((f) => /DASHBOARD_PASSCODE/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));

    expect(lectores, 'un secreto vivo que no protege nada sigue siendo un secreto que rotar').toEqual([]);
  });

  it('`.env.example` ya no la declara con una consecuencia falsa', () => {
    const declaradas = readFileSync(join(RAIZ, '.env.example'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0].trim());

    expect(declaradas).not.toContain('DASHBOARD_PASSCODE');
  });

  it('la segunda pantalla de login ya no está publicada', () => {
    expect(existsSync(join(RAIZ, 'src', 'app', 'acceso', 'page.tsx')),
      '/acceso sigue sirviéndose: otra pantalla de login que no autoriza nada').toBe(false);
  });

  it('y el módulo del passcode tampoco: 252 líneas sin consumidor', () => {
    expect(existsSync(join(RAIZ, 'src', 'lib', 'auth', 'passcode.ts'))).toBe(false);
  });

  // ── CONTROL ──────────────────────────────────────────────────────────────
  // Lo que sí tiene que seguir en pie: el gate de verdad.

  it('CONTROL · el gate del panel sigue siendo la sesión de Supabase', () => {
    const proxy = readFileSync(join(RAIZ, 'src', 'proxy.ts'), 'utf8');
    expect(proxy).toContain('auth.getUser()');
    expect(proxy).toMatch(/\/dashboard/);
  });
});
