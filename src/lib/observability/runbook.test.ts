import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
  'NODE_ENV', 'VERCEL_ENV', 'NEXT_RUNTIME',
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
    // `DASHBOARD_PASSCODE` salió de esta lista en la auditoría 10: desde que el
    // gate es la sesión de Supabase, su ausencia ya no abre nada (ver
    // `observability/arranque.ts`). Las dos que entraron son las que hoy
    // deciden si el contralor entra: `NEXT_PUBLIC_APP_URL` es el dominio contra
    // el que se arma el magic link (`login/page.tsx:10`) y
    // `NEXT_PUBLIC_SUPABASE_ANON_KEY` la que usan `proxy.ts` y el cliente de
    // servidor para verificar la sesión.
    for (const v of ['SENTRY_DSN', 'DASHBOARD_SECRET', 'DEMO_TENANT_ID', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      expect(texto, `DEPLOY.md no menciona ${v}`).toContain(v);
    }
  });

  it('dice dónde se miran los logs cuando algo falla', () => {
    // Es el documento al que se acude a las 3 a.m. y no contenía nada de lo que
    // a esa hora se necesita.
    expect(deploy()).toMatch(/vercel logs|runtime log/i);
  });

  // ── ALTO de la auditoría 10 (operabilidad) ─────────────────────────────────
  //
  // La tabla de "las cuatro que hay que revisar a mano" decía
  // `DASHBOARD_PASSCODE → proxy.ts **no bloquea** /dashboard`, y `.env.example`
  // repetía «`proxy.ts:22` NO bloquea /dashboard». `src/proxy.ts` no nombra esa
  // variable en ninguna línea. Escenario: el 5-ago alguien limpia la variable
  // muerta, lee esta tabla y cree que dejó el panel del contralor abierto al
  // público — o al revés, la conserva creyendo que protege algo.
  it('ningún documento le atribuye a proxy.ts un candado que no tiene', () => {
    const proxy = readFileSync(join(RAIZ, 'src/proxy.ts'), 'utf8');
    // La premisa, medida y no supuesta: si un día proxy.ts vuelve a leer un
    // passcode, esta prueba deja de aplicar y hay que reescribirla.
    expect(proxy, 'proxy.ts volvió a leer DASHBOARD_PASSCODE: revisa esta prueba').not.toContain('DASHBOARD_PASSCODE');
    for (const doc of ['DEPLOY.md', '.env.example']) {
      const texto = readFileSync(join(RAIZ, doc), 'utf8');
      expect(texto, `${doc} afirma que proxy.ts bloquea (o no) /dashboard con una variable que no lee`)
        .not.toMatch(/proxy\.ts[^\n]*bloquea/i);
    }
  });

  // El otro medio hallazgo: ningún archivo del repo documentaba el lado de
  // Supabase. Escenario frecuente: `NEXT_PUBLIC_APP_URL` perfectamente puesta,
  // pero `https://<dominio>/auth/callback` fuera de la lista de Redirect URLs
  // del proyecto → GoTrue ignora el `emailRedirectTo` y usa la Site URL (por
  // default `http://localhost:3000`). El correo llega, el contralor lo abre, y
  // el navegador va a localhost: Likida NUNCA recibe esa petición, así que no
  // hay ningún log que pueda existir. Solo el runbook arregla esto.
  it('documenta la configuración de Supabase que el login nuevo necesita', () => {
    const t = deploy();
    expect(t, 'sin la lista de Redirect URLs, el magic link aterriza en localhost').toMatch(/redirect url/i);
    expect(t, 'y la Site URL es el default al que cae GoTrue cuando la rechaza').toMatch(/site url/i);
    expect(t).toContain('/auth/callback');
    expect(t, 'el remitente de hoy es el sandbox de Resend, que solo entrega a una dirección').toMatch(/smtp|resend/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 · UNA MÁQUINA LIMPIA NO PODÍA ENTRAR AL PANEL.
//
// El camino, paso a paso, en una laptop recién clonada: `npm run seed` +
// `npm run dev` → /dashboard → `proxy.ts` redirige a /login → se teclea el
// correo → `signInWithOtp` con `shouldCreateUser:false` y sin `auth.users`
// → Supabase responde `otp_disabled` → la pantalla dice «Te mandamos un link»
// (a propósito, para no filtrar qué correos existen) y el link nunca llega.
//
// El único alta que existía en el árbol era `/admin/usuarios/nuevo`, que
// empieza con `requireSuperadmin()`: exige una fila `app_user` con
// `rol='superadmin'` que solo se puede crear con esa misma página. El
// comentario de esa página remite a `scripts/tmp-provisionar-*.ts`, borrado al
// construirla. Ni README, ni SEED.md, ni DEPLOY.md, ni TRASPASO.md decían
// cómo se crea el primero. Si la laptop del demo falla el 5-ago, no había
// procedimiento escrito para recuperar el acceso al panel.
// ═══════════════════════════════════════════════════════════════════════════
describe('una máquina limpia puede llegar al panel, no solo al WhatsApp', () => {
  const RUTA_SCRIPT = join(RAIZ, 'scripts/crear-superadmin.mjs');

  it('existe el procedimiento para crear el PRIMER superadmin', () => {
    expect(existsSync(RUTA_SCRIPT), 'no hay ningún camino de alta que no exija un superadmin previo').toBe(true);
  });

  it('el runbook lo nombra, y quien acaba de sembrar la base también lo encuentra', () => {
    expect(readFileSync(join(RAIZ, 'DEPLOY.md'), 'utf8'), 'un script que nadie sabe que existe no es un procedimiento')
      .toContain('crear-superadmin');
    expect(readFileSync(join(RAIZ, 'scripts/seed.sh'), 'utf8'), 'el seed termina diciendo "siguiente:" y no mencionaba el panel')
      .toContain('crear-superadmin');
  });

  it('el script escribe exactamente la fila que `requireSuperadmin` exige', () => {
    const s = readFileSync(RUTA_SCRIPT, 'utf8');
    // `guard.ts:requireSuperadmin` compara `rol === 'superadmin'`, y
    // `getSessionTenant` lee la fila de `app_user` por el `id` de `auth.users`.
    expect(s).toContain('app_user');
    expect(s).toContain('superadmin');
    expect(s, 'app_user.id TIENE que ser el id de auth.users').toContain('createUser');
  });

  it('y no inventa columnas: las mismas que `provisionar.ts`, que es el alta de verdad', () => {
    // El script no puede importar el TS, así que lo que lo mantiene honesto es
    // esto: si `provisionarUsuario` gana o pierde una columna de `app_user`, el
    // bootstrap deja de producir la misma fila y alguien tiene que enterarse.
    const prov = readFileSync(join(RAIZ, 'src/lib/auth/provisionar.ts'), 'utf8');
    const columnas = /insert\(\{([^}]*)\}/s.exec(prov)?.[1] ?? '';
    const nombres = columnas
      .split(',')
      .map((c) => c.split(':')[0].trim())   // `rol,` es abreviatura de `rol: rol`
      .filter((c) => /^\w+$/.test(c));
    expect(nombres.length, 'no se pudo leer el insert de provisionar.ts').toBeGreaterThan(3);
    const s = readFileSync(RUTA_SCRIPT, 'utf8');
    for (const c of nombres) {
      expect(s, `provisionar.ts escribe app_user.${c} y el bootstrap no`).toContain(`${c}:`);
    }
  });

  it('dice qué variables necesita y falla si no están, en vez de escribir a medias', () => {
    const s = readFileSync(RUTA_SCRIPT, 'utf8');
    expect(s).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(s).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });
});
