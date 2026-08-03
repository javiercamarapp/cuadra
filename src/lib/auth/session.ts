import { supabaseServer } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export interface SessionTenant {
  userId: string;
  tenantId: string | null;
  rol: string;
  nombre: string | null;
  /** Solo llena cuando rol='operador' (0045) — liga con la fila de `operador`. */
  operadorId: string | null;
}

/**
 * ¿El error dice que la COLUMNA no existe (esquema incompleto), o es cualquier
 * otro fallo (RLS, permisos, bache de red)? Solo el primero se degrada; los
 * demás siguen fallando cerrado, que en la puerta de autorización es lo
 * correcto. `42703` es `undefined_column` de Postgres; PostgREST también
 * contesta `PGRST204` cuando no encuentra la columna en su caché de esquema.
 */
function esColumnaAusente(error: { code?: string; message?: string }): boolean {
  return error.code === '42703' || error.code === 'PGRST204';
}

/**
 * ¿El error de `auth.getUser()` dice "esta sesión no vale", o dice "no pude
 * preguntar"?
 *
 * La distinción existe porque `auth-js` NO LANZA en el caso más frecuente:
 * `_getUser` atrapa cualquier `isAuthError` y devuelve
 * `{ data: { user: null }, error }` (GoTrueClient.js:2666-2676). Ahí caen
 * juntas dos cosas opuestas:
 *
 *   · `AuthSessionMissingError` (400) — no hay cookie de sesión. Es el camino
 *     NORMAL de un visitante anónimo, igual que `refresh_token_not_found` es
 *     el de una sesión caducada. Registrarlos dejaría una línea de error por
 *     visita y enterraría la de abajo, que es la que importa.
 *   · `AuthRetryableFetchError` (status 0 en un `fetch failed`, o 5xx) — el
 *     endpoint de auth no contestó. La MISMA sesión válida que un momento
 *     antes pasó `/auth/callback` se lee como "nunca inició sesión" y el
 *     contralor sale rebotado a /login a media demo.
 *
 * Mismo criterio que `sinRespuesta()` en `cuadra/startup.ts`: sin respuesta no
 * se afirma nada. Un 4xx sí es una respuesta y dice que la sesión no sirve.
 */
function noPudePreguntar(error: { name?: string; status?: number }): boolean {
  if (error.name === 'AuthRetryableFetchError') return true;
  return error.status === undefined || error.status === 0 || error.status >= 500;
}

/**
 * Devuelve el tenant del usuario autenticado, o null si no hay sesión/config.
 *
 * Reintenta UNA vez antes de fallar cerrado: un `fetch failed`/timeout
 * transitorio de Supabase aquí no es "no hay sesión" — es la MISMA sesión
 * válida que un momento antes pasó `/auth/callback`, pero `requireSuperadmin`
 * trata `null` exactamente igual que "nunca inició sesión" y rebota a
 * /login. Sin el reintento, un usuario recién autenticado podía entrar y
 * ser expulsado a los pocos segundos por un bache de red que no tenía nada
 * que ver con su login. Dos intentos, no un loop: si el segundo también
 * truena, el problema ya no es un bache — sigue fallando cerrado.
 */
export async function getSessionTenant(): Promise<SessionTenant | null> {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const sb = await supabaseServer();
      const { data: { user }, error: errAuth } = await sb.auth.getUser();
      // El `error` de esta línea se descartaba, y con él el fallo transitorio
      // MÁS probable de toda la función: un bache de 800 ms contra Supabase
      // Auth salía por el `if (!user)` de abajo —sin reintento, porque no se
      // lanzó nada, y sin una sola línea— con un resultado idéntico byte por
      // byte a "este usuario nunca inició sesión" (auditoría 10, ALTO).
      if (!user && errAuth && noPudePreguntar(errAuth)) {
        if (intento === 0) {
          logger.warn('session.reintento', { err: errAuth.message, fuente: 'auth.getUser' });
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        // Dos veces seguidas ya no es un bache. El llamador solo ve `null` y
        // redirige a /login: este es el único sitio donde el motivo se escribe.
        logger.error('session.auth_error', {
          msg: 'Supabase Auth no contestó dos veces seguidas: la sesión NO se pudo verificar y el usuario sale rebotado a /login como si nunca hubiera entrado. Esto no es "no tiene cuenta".',
          err: errAuth.message, name: errAuth.name, status: errAuth.status,
        });
        return null;
      }
      if (!user) return null;
      let { data, error } = await sb.from('app_user').select('tenant_id, rol, nombre, operador_id').eq('id', user.id).maybeSingle();

      // `operador_id` NACE en la 0045 y viaja en el MISMO select que
      // `tenant_id`. Si esa migración no está aplicada, PostgREST falla la
      // consulta ENTERA y TODO usuario —el contralor y también el superadmin—
      // salía con `tenantId: null` rumbo a /sin-acceso, con un texto que le
      // dice que pida su alta. El panel no se ve roto: se ve como si nadie
      // tuviera cuenta (auditoría 10, CRÍTICO de modelo de datos).
      //
      // Un dato que solo le sirve al chofer no puede tumbar la sesión de los
      // otros cuatro roles: se reintenta sin esa columna. El chofer sí queda
      // sin `operadorId` y `requireOperador` lo manda a /sin-acceso, que es lo
      // correcto mientras su RLS no exista.
      if (error && esColumnaAusente(error)) {
        logger.error('session.esquema_incompleto', {
          msg: 'FALTA la migración 0045 (app_user.operador_id). El panel sigue sirviendo a los roles que no son chofer, en modo degradado. Corre `supabase db push`.',
          code: error.code, err: error.message,
        });
        ({ data, error } = await sb.from('app_user').select('tenant_id, rol, nombre').eq('id', user.id).maybeSingle());
      }

      // Sin este log, un bache de Supabase o una regresión de RLS es
      // INDISTINGUIBLE de "este correo nunca se dio de alta": las dos acaban con
      // `tenantId: null`, y `requireSessionTenant` manda al contralor a
      // /sin-acceso con un texto que le dice que pida su alta. El
      // comportamiento no cambia a propósito (fallar cerrado es lo correcto en
      // la puerta de autorización); lo que cambia es que ahora quede rastro.
      if (error) logger.warn('session.app_user_error', { userId: user.id, err: error.message });
      return {
        userId: user.id,
        tenantId: (data?.tenant_id as string) ?? null,
        rol: (data?.rol as string) ?? 'flota_admin',
        nombre: (data?.nombre as string) ?? null,
        operadorId: (data?.operador_id as string) ?? null,
      };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (intento === 0) {
        logger.warn('session.reintento', { err: mensaje });
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      // Lo que llega aquí ya no es "no hay sesión", es que el SDK tronó DOS
      // veces seguidas: red caída, URL/anon key mal puestas, respuesta
      // ilegible. El llamador solo ve `null` y redirige a /login, así que
      // este es el único sitio donde el motivo puede quedar escrito.
      logger.error('session.excepcion', { err: mensaje });
      return null;
    }
  }
  return null; // inalcanzable — el for siempre retorna o cae al catch final
}
