import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-36 · ALTO — `NEXT_PUBLIC_APP_URL` se comprobaba por
// PRESENCIA, no por VALOR.
//
// `arranque.ts` hacía `!process.env[v.nombre]`: cualquier cadena pasaba. Y
// `scripts/deploy-vercel.sh:47-51` le escribía lo que imprimiera
// `vercel --prod --yes`, que es la URL POR DEPLOY (`likida-a1b2c3d4-…`), no el
// alias estable. Ese host no está en las *Redirect URLs* de Supabase, así que
// GoTrue ignora el `emailRedirectTo`, el navegador se va a otro dominio y
// **Likida nunca recibe esa petición**: no hay log que pueda existir. El
// contralor teclea su correo, le llega el link, hace clic, y no entra.
//
// Mientras tanto `startup.config_silenciosa` salía `ok:true` — el semáforo que
// `GUION_DEMO.md:29` manda mirar como paso 3 antes de entrar a la sala iba a
// estar en VERDE con el login roto. Es el modo de fallo que este archivo
// entero existe para cerrar.
//
// Lo que NO decide esta prueba (es decisión humana, ver el plan): CUÁL de los
// cuatro valores es el bueno. Lo que sí exige es que el valor sea uno que
// PUEDA funcionar: https, sin barra final, y no la URL efímera del deploy.
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function ponerTodo() {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('DEMO_TENANT_ID', '11111111-1111-1111-1111-111111111111');
  vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', '0.008');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likidaai.vercel.app');
}

async function arrancar() {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { avisarConfiguracionSilenciosa } = await import('./arranque');
  avisarConfiguracionSilenciosa();
  return {
    alarma: err.mock.calls.map((c) => String(c[0])).join('\n'),
    normal: log.mock.calls.map((c) => String(c[0])).join('\n'),
  };
}

describe('G-36 · el arranque mira el VALOR de NEXT_PUBLIC_APP_URL, no solo que exista', () => {
  it('la URL EFÍMERA del deploy alarma — es justo lo que el script escribía', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likida-a1b2c3d4e-javier.vercel.app');

    const { alarma } = await arrancar();

    expect(alarma, 'el semáforo salió verde con el magic link apuntando a un host efímero')
      .toContain('NEXT_PUBLIC_APP_URL');
    expect(alarma).toContain('startup.config_silenciosa');
  });

  it('coincidir con VERCEL_URL alarma: esa variable ES la URL por deploy', async () => {
    ponerTodo();
    vi.stubEnv('VERCEL_URL', 'likida-zzz.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likida-zzz.vercel.app');

    expect((await arrancar()).alarma).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('http:// en un despliegue alarma — la cookie de sesión es `secure`', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://likidaai.vercel.app');

    expect((await arrancar()).alarma).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('localhost en producción alarma', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

    expect((await arrancar()).alarma).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('la barra final alarma: `${siteUrl()}/auth/callback` daría `//auth/callback`', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.likida.ai/');

    expect((await arrancar()).alarma).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('una cadena que ni siquiera es una URL alarma', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'app.likida.ai');

    expect((await arrancar()).alarma).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('el aviso dice qué tiene de malo el valor, no solo que hay algo mal', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likida-a1b2c3d4e-javier.vercel.app');

    // Quien lo lee a las 3 a.m. tiene que saber qué corregir sin abrir el código.
    expect((await arrancar()).alarma).toMatch(/deploy|efímera|efimera/i);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────
  // Sin estos, "alarmar siempre" pasaría las siete de arriba y el semáforo
  // quedaría en rojo permanente, que es la otra forma de apagarlo.

  it('CONTROL · el alias estable de Vercel NO alarma', async () => {
    ponerTodo();

    const { alarma, normal } = await arrancar();

    expect(alarma).not.toContain('startup.config_silenciosa');
    expect(normal).toContain('"ok":true');
  });

  it('CONTROL · el dominio propio NO alarma', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.likida.ai');

    expect((await arrancar()).alarma).not.toContain('startup.config_silenciosa');
  });

  it('CONTROL · en local, localhost NO alarma — ahí es lo correcto', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

    const { alarma, normal } = await arrancar();

    expect(`${alarma}\n${normal}`).not.toContain('startup.config_silenciosa');
  });

  it('el VALOR sigue sin salir en el log: se dice qué está mal, no cuál es', async () => {
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likida-a1b2c3d4e-javier.vercel.app');

    const { alarma } = await arrancar();

    expect(alarma, 'el aviso existe para vigilar la configuración, no para filtrarla')
      .not.toContain('a1b2c3d4e');
  });
});

describe('G-36 · el script de deploy no escribe la URL efímera', () => {
  const script = () => readFileSync(join(process.cwd(), 'scripts', 'deploy-vercel.sh'), 'utf8');

  it('ninguna línea junta `$url` con NEXT_PUBLIC_APP_URL', () => {
    // `url="$(vercel --prod --yes)"` es la URL POR DEPLOY. El script la
    // guardaba como la URL de la aplicación y cerraba con un `echo`
    // recordando redesplegar: un recordatorio impreso, no un paso.
    const culpables = script()
      .split('\n')
      .filter((l) => /\$url\b|\$\{url\}/.test(l) && /NEXT_PUBLIC_APP_URL/.test(l))
      .map((l) => l.trim());

    expect(culpables, 'el script escribe la URL efímera del deploy como la URL de la app').toEqual([]);
  });

  it('el valor que empuja sale de .env.local y se comprueba antes de escribirlo', () => {
    // Fallar cerrado también en el script: escribir un valor equivocado deja
    // el login roto sin un solo error, y eso no se descubre hasta la sala.
    const texto = script();
    expect(texto, 'el valor no sale de .env.local').toMatch(/grep[^\n]*NEXT_PUBLIC_APP_URL=[^\n]*\.env\.local/);
    // Y se detiene si no sirve, en vez de escribir algo que rompe el login.
    expect(texto, 'no rechaza la URL efímera del deploy').toMatch(/vercel\\?\.app\$[\s\S]{0,400}exit 1/);
    expect(texto).toMatch(/vercel env add NEXT_PUBLIC_APP_URL/);
  });
});
