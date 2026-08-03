'use server';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS SERVER ACTIONS DE /login, EN UN ARCHIVO QUE SE PUEDE IMPORTAR.
//
// Vivían DENTRO del componente de `page.tsx`, y esa era la razón —escrita en la
// cabecera de `no_autoregistro.test.ts`— por la que su única prueba leía el
// TEXTO FUENTE con `readFileSync` + `toMatch(/…/)` en vez de ejecutarlos. El
// auditor de pruebas de la auditoría 10 rompió las TRES propiedades que ese
// archivo dice proteger —el límite por IP, el sentido de `esCorreoSinCuenta` y
// `shouldCreateUser:false`— y las tres pruebas siguieron verdes, porque el
// texto seguía ahí.
//
// Salen aquí SIN cambiar una sola línea de su comportamiento: los dos siguen
// leyendo `next` del `<input type="hidden">` del formulario (no cierran sobre
// nada del componente), así que mudarlos es literalmente mover el cuerpo. Lo
// que cambia es que ahora se pueden `import`ar y correr —
// `login/no_autoregistro.test.ts` los ejecuta con Supabase, el rate-limit y
// `redirect()` falsos, y mide COMPORTAMIENTO en vez de leer este archivo.
//
// Precedente en el repo: `dashboard/acred.tsx` y `admin/gate.test.tsx`.
// ═══════════════════════════════════════════════════════════════════════════

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { destinoSeguro } from '@/lib/auth/destino';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai';
}

/**
 * Mismo límite por IP que el passcode que este login reemplaza (10 / 5 min,
 * `app/acceso/page.tsx`): quitarlo al cambiar de mecanismo habría sido una
 * regresión. Aquí pesa MÁS que allá — cada intento del camino de email manda
 * un correo real por el SMTP de Supabase, que tiene cuota diaria: quemarla
 * deja el panel sin la única vía de entrada que hoy funciona.
 */
async function dentroDelLimite(llave: string): Promise<boolean> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')) ?? 'desconocida';
  return rateLimit(`${llave}:${ip}`, 10, 5 * 60_000);
}

/**
 * Correo que NO tiene cuenta, con `shouldCreateUser:false`.
 *
 * Supabase lo marca con el código `otp_disabled` (422, «Signups not allowed for
 * otp»); `signup_disabled` es el mismo caso con los registros apagados a nivel
 * proyecto. Se mira también el mensaje porque el `code` solo existe en las
 * versiones nuevas del SDK, y fallar a "error" aquí reabriría el oráculo de
 * enumeración que este manejo existe para cerrar.
 */
function esCorreoSinCuenta(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'otp_disabled' ||
    error.code === 'signup_disabled' ||
    /signups not allowed/i.test(error.message ?? '')
  );
}

export async function entrarConGoogle(formData: FormData) {
  const dest = destinoSeguro(String(formData.get('next') ?? ''));
  if (!(await dentroDelLimite('login:google'))) {
    redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
  });
  if (error || !data.url) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
  redirect(data.url);
}

export async function entrarConEmail(formData: FormData) {
  const dest = destinoSeguro(String(formData.get('next') ?? ''));
  // Al exceder el límite se responde el error GENÉRICO, no "vas muy rápido":
  // la diferencia le diría a quien prueba correos cuándo dejó de contar.
  if (!(await dentroDelLimite('login:email'))) {
    redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
  }
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}`,
      // Nadie se da de alta solo (decisión 1 del spec): las cuentas las crea
      // `provisionarUsuario`. Sin esto, Supabase por default crea el
      // `auth.users` de CUALQUIER correo que alguien teclee aquí.
      shouldCreateUser: false,
    },
  });
  // Un correo sin cuenta se responde EXACTAMENTE igual que uno con cuenta: si
  // "no existe" se viera distinto de "te mandamos el link", esta pantalla
  // sería un oráculo para enumerar qué correos son contralores reales. Solo un
  // fallo de otra naturaleza (cuota de correo, correo malformado, config rota)
  // sale como error.
  if (error) {
    if (!esCorreoSinCuenta(error)) {
      // ESTE es el fallo que importa y el que no dejaba rastro: cuota de
      // correo agotada, SMTP mal configurado, proyecto de Supabase caído. El
      // usuario ve `error=1` y se acabó; sin esta línea, el único testigo era
      // su navegador (auditoría 10, CRÍTICO de operabilidad). Sin el correo:
      // el código y el status distinguen una cuota agotada de una config
      // rota, y el correo es dato personal que no hace falta para eso.
      logger.error('login.otp_error', { code: error.code, status: error.status });
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    // El usuario ve "enviado"; el motivo real solo queda aquí. Sin correo en el
    // log: el código y el status bastan para distinguirlo de una cuota agotada.
    logger.warn('login.otp_sin_cuenta', { code: error.code, status: error.status });
  }
  redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
}
