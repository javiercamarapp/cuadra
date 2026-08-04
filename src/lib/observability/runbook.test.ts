import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 5 · `.env.example` y `DEPLOY.md` como parte del sistema, no como
// prosa suelta.
//
// Dos hallazgos con la misma forma: el código lee una variable, el documento al
// que manda el runbook no la menciona, y si falta **el sistema arranca igual,
// mal y en silencio**. Los casos medidos fueron `SENTRY_DSN` (nadie recibe los
// errores) y `DEMO_TENANT_ID` (el panel consulta otro tenant y pinta cero
// liquidaciones, que en un demo se lee como "el producto no guardó nada").
//
// Un documento no se puede "probar", pero sí se puede probar que no se ha
// quedado atrás del código, que es exactamente cómo se rompieron los dos.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

// Las pone la plataforma o el arnés de pruebas: no van en `.env.example`.
const DE_LA_PLATAFORMA = new Set([
  // `VERCEL_URL` la inyecta la plataforma con la URL POR DEPLOY. No se
  // configura: se LEE, precisamente para detectar que alguien la copió a
  // `NEXT_PUBLIC_APP_URL` (auditoría 11, G-36).
  'NODE_ENV', 'VERCEL_ENV', 'VERCEL_URL', 'NEXT_RUNTIME',
  'TICKET_PATH', 'TICKET_HOY', 'TICKET_ANTICIPO',
]);

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) archivosFuente(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Variables que el código lee de verdad, medidas sobre el árbol de fuentes. */
function leidasPorElCodigo(): Set<string> {
  const out = new Set<string>();
  for (const f of archivosFuente(join(RAIZ, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!DE_LA_PLATAFORMA.has(m[1])) out.add(m[1]);
    }
  }
  return out;
}

/** Variables declaradas (no comentadas) en `.env.example`. */
function declaradasEnEjemplo(): string[] {
  return readFileSync(join(RAIZ, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .filter(Boolean);
}

describe('.env.example no se queda atrás del código', () => {
  it('documenta TODAS las variables que el código lee', () => {
    const declaradas = new Set(declaradasEnEjemplo());
    const faltantes = [...leidasPorElCodigo()].filter((v) => !declaradas.has(v)).sort();
    expect(faltantes).toEqual([]);
  });

  it('no documenta variables que ya no lee nadie', () => {
    // `FACTURAPI_KEY`, `UPSTASH_*`, `QSTASH_TOKEN` sobrevivieron a que se
    // quitaran esas dependencias. Documentación muerta que ensucia el
    // inventario: al desplegar hay que decidir una por una si hace falta.
    const leidas = leidasPorElCodigo();
    const sobrantes = declaradasEnEjemplo().filter((v) => !leidas.has(v)).sort();
    expect(sobrantes).toEqual([]);
  });

  it('no declara la misma variable dos veces', () => {
    // `SENTRY_DSN` aparecía dos veces con dos comentarios distintos: al pegarlas
    // en Vercel una pisa a la otra y no hay forma de saber cuál manda.
    const todas = declaradasEnEjemplo();
    const repetidas = todas.filter((v, i) => todas.indexOf(v) !== i);
    expect(repetidas).toEqual([]);
  });

  it('no promete palancas que el código no tiene', () => {
    // El "Plan B demo en vivo" (ANTHROPIC_API_KEY / GOOGLE_API_KEY) no lo lee
    // nadie: `openrouter.ts` solo mira OPENROUTER_API_KEY. Descubrirlo durante
    // el demo cuesta el tiempo de ponerla y redesplegar antes de entender que no
    // había ruta. Peligroso porque las palancas CUADRA_MODEL_* del mismo bloque
    // comentado SÍ funcionan, y desde el archivo no se distingue cuál es cuál.
    const texto = readFileSync(join(RAIZ, '.env.example'), 'utf8');
    const leidas = leidasPorElCodigo();
    for (const v of ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'FACTURAPI_KEY', 'QSTASH_TOKEN']) {
      if (!leidas.has(v)) expect(texto).not.toContain(v);
    }
  });
});

describe('DEPLOY.md pide lo que hace falta para que el sistema no arranque ciego', () => {
  const deploy = () => readFileSync(join(RAIZ, 'DEPLOY.md'), 'utf8');

  it('nombra las variables cuya ausencia es silenciosa', () => {
    const texto = deploy();
    for (const v of ['SENTRY_DSN', 'DASHBOARD_SECRET', 'DASHBOARD_PASSCODE', 'DEMO_TENANT_ID']) {
      expect(texto, `DEPLOY.md no menciona ${v}`).toContain(v);
    }
  });

  it('dice dónde se miran los logs cuando algo falla', () => {
    // Es el documento al que se acude a las 3 a.m. y no contenía nada de lo que
    // a esa hora se necesita.
    expect(deploy()).toMatch(/vercel logs|runtime log/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-38 — una máquina limpia no quedaba corriendo, y el runbook
// nombraba los mensajes de arranque equivocados.
//
// El README describía un producto que ya no se llama así y un arranque de tres
// comandos que NO deja el sistema en pie: no menciona migraciones, ni seed, ni
// el script `setup` que sí existe en `package.json`, ni el alta del primer
// usuario. Y sin esa alta el camino se cierra solo: `/login` va con
// `shouldCreateUser:false`, `auth.users` está vacío, la pantalla dice «Te
// mandamos un link» (a propósito, para no filtrar qué correos existen) y el
// link no llega nunca. El único alta del árbol, `/admin/usuarios/nuevo`,
// empieza con `requireSuperadmin()`.
//
// Y `DEPLOY.md` listaba `startup.entorno` —que solo cubre `DASHBOARD_SECRET`—
// omitiendo `startup.config_silenciosa` y `startup.entorno_grupos`, que son
// justamente los que `GUION_DEMO.md` manda mirar como semáforo antes de entrar
// a la sala.
// ═══════════════════════════════════════════════════════════════════════════

describe('G-38 · una máquina limpia queda corriendo si se sigue el README', () => {
  const readme = () => readFileSync(join(RAIZ, 'README.md'), 'utf8');

  it('el arranque nombra las migraciones/seed, no solo `npm install`', () => {
    const texto = readme();
    expect(texto, 'el README arranca el server contra una base vacía').toMatch(/npm run (setup|seed)/);
  });

  it('y nombra el alta del primer superadmin, sin la cual nadie entra', () => {
    expect(readme(), 'sin el primer `app_user` el magic link no llega nunca')
      .toContain('scripts/crear-superadmin.mjs');
  });

  it('el README llama al producto por su nombre', () => {
    // «Un rótulo tiene que ser verdad» (CLAUDE.md). Una auditoría externa ya
    // calificó cuatro tecnologías que el proyecto no usa por leer este archivo.
    expect(readme().split('\n')[0]).toContain('Likida');
  });
});

describe('G-38 · DEPLOY.md nombra los mensajes de arranque que el código emite', () => {
  it('incluye los dos que el guion del demo usa como semáforo', () => {
    const texto = readFileSync(join(RAIZ, 'DEPLOY.md'), 'utf8');
    for (const msg of ['startup.config_silenciosa', 'startup.entorno_grupos']) {
      expect(texto, `DEPLOY.md no nombra ${msg}`).toContain(msg);
    }
  });

  it('el script del primer superadmin escribe las MISMAS columnas que `provisionar.ts`', () => {
    // Si divergen, el usuario que crea el script no es el mismo tipo de fila
    // que el que crea el producto, y el fallo aparece en la sesión, no aquí.
    const script = readFileSync(join(RAIZ, 'scripts', 'crear-superadmin.mjs'), 'utf8');
    for (const col of ['id', 'tenant_id', 'email', 'nombre', 'rol']) {
      expect(script, `el script no escribe ${col}`).toMatch(new RegExp(`\\b${col}\\s*:`));
    }
    expect(script).toContain("rol: 'superadmin'");
  });
});
