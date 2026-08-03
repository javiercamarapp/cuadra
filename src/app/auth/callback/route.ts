// src/app/auth/callback/route.ts
// Supabase redirige aquí con ?code= tras el magic link o el consentimiento de
// Google. exchangeCodeForSession intercambia ese code por una sesión real y
// la deja en las cookies (mismo cliente/cookies que supabaseServer() usa en
// el resto del panel).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { destinoSeguro } from '@/lib/auth/destino';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next');
  // `null` cuando no vino un `next` utilizable: el superadmin sin destino
  // explícito aterriza en SU consola, no en el panel del tenant demo.
  const destinoExplicito = next && destinoSeguro(next) === next ? next : null;

  if (code) {
    try {
      const sb = await supabaseServer();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (!error) {
        // Sin `next` explícito, superadmin aterriza en SU consola (/admin),
        // no en el panel del tenant demo — antes de esto no tenía a dónde
        // ir que fuera suyo. Un `next` explícito (un link a /dashboard/[id]
        // que alguien mandó) se respeta tal cual, para todos los roles.
        let dest = destinoExplicito ?? '/dashboard';
        if (!destinoExplicito) {
          const s = await getSessionTenant();
          if (s?.rol === 'superadmin') dest = '/admin';
        }
        return NextResponse.redirect(new URL(dest, req.url));
      }
      // NUNCA el `code` ni el correo: el primero es una credencial de un solo
      // uso y el segundo es dato personal. El código y el status de Supabase
      // bastan para distinguir un link caducado de una config rota.
      logger.error('auth.callback_intercambio', {
        code: (error as { code?: string }).code,
        status: (error as { status?: number }).status,
        msg: error.message,
      });
    } catch (e) {
      // Fallo inesperado del SDK o supabaseServer() — cae al mismo fallback
      // para evitar que un error raro se vuelva un 500 genérico en la pantalla
      // de login más importante. Pero NO callado: un `catch` vacío además le
      // impide a `onRequestError` verlo, así que Sentry tampoco se enteraba
      // (auditoría 10, CRÍTICO de operabilidad).
      logger.error('auth.callback_excepcion', { err: e instanceof Error ? e.message : String(e) });
    }
  } else {
    // Sin `code` no hay nada que intercambiar. Se registra porque es el
    // síntoma de un link mal formado o de un `emailRedirectTo` equivocado —
    // exactamente lo que un deploy sin `NEXT_PUBLIC_APP_URL` produce.
    logger.warn('auth.callback_sin_code', {});
  }
  return NextResponse.redirect(new URL('/login?error=1', req.url));
}
