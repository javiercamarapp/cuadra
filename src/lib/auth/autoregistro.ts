// ═══════════════════════════════════════════════════════════════════════════
// «NADIE SE DA DE ALTA SOLO» — LA MITAD QUE FALTABA
//
// El camino del magic link cierra el autoregistro EN EL CÓDIGO:
// `signInWithOtp({ options: { shouldCreateUser: false } })` (`login/page.tsx`).
// El botón de Google no tiene equivalente: `signInWithOAuth` no acepta esa
// bandera. Lo único que impedía que un consentimiento de Google creara un
// `auth.users` era el interruptor «Allow new users to sign up» del proyecto en
// el dashboard de Supabase — y el hecho de que el otro camino se moleste en
// poner `shouldCreateUser:false` dice que ese interruptor está ENCENDIDO
// (auditoría 10, MEDIO de seguridad).
//
// ESCENARIO. Cualquiera con una cuenta de Google pulsa «Continuar con Google»
// en app.likida.ai/login. Obtiene un `auth.users` real y un JWT con
// `role=authenticated` FIRMADO POR EL SECRETO DEL PROYECTO. En la app no ve
// nada —`getSessionTenant` devuelve `tenantId: null` y `requireSessionTenant`
// lo manda a /sin-acceso—, pero el JWT sí sirve contra PostgREST, donde queda a
// merced de que TODAS las policies estén bien escritas para un
// `get_user_tenant_ids()` vacío. Hoy todas deniegan; el punto es que la puerta
// de entrada dejó de estar cerrada por código y pasó a estar cerrada por una
// casilla que ninguna prueba mira. Colateral: registro ilimitado de cuentas
// contra el proyecto (MAU facturable, cuota de correo).
//
// LO QUE HACE ESTA FUNCIÓN. Se llama DESPUÉS del intercambio del code, en
// `/auth/callback`, que es el único punto por el que pasan los dos caminos. Si
// el usuario recién autenticado no tiene fila en `app_user`, deshace el alta:
// cierra la sesión (mata las cookies y con ellas el JWT) y borra el
// `auth.users`, que es exactamente el efecto que `shouldCreateUser:false` tiene
// del otro lado.
//
// POR QUÉ NO FALLA CERRADO. Si la consulta a `app_user` no se puede hacer —un
// bache de red, la base caída—, NO se revierte nada: cerrarle la sesión a un
// contralor legítimo por un bache es cambiar un problema chico por uno que
// pasa en la sala. La existencia se pregunta con `service_role`, no con la
// sesión del usuario, para que una policy mal escrita no se lea como «no tiene
// alta» y acabe borrando una cuenta buena.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * ¿Este login creó una cuenta que nadie dio de alta? Si sí, la deshace.
 *
 * @returns `true` cuando revirtió un alta espontánea (el llamador NO debe
 * dejar entrar a esa sesión); `false` cuando el usuario sí tiene alta, cuando
 * no hay sesión, o cuando no se pudo comprobar.
 */
export async function revertirAltaEspontanea(): Promise<boolean> {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabaseAdmin()
      .from('app_user').select('id').eq('id', user.id).maybeSingle();
    if (error) {
      logger.warn('auth.alta_no_verificable', {
        msg: 'No se pudo comprobar si esta sesión tiene alta en app_user: se la deja pasar. Las puertas de rol (`require*`) siguen mandándola a /sin-acceso si de verdad no la tiene.',
        userId: user.id, err: error.message,
      });
      return false;
    }
    if (data) return false;

    // Aquí ya no hay duda: hay usuario de Auth y no hay fila de alta. Es el
    // autoregistro que el producto no permite.
    await sb.auth.signOut();
    const { error: eBorrar } = await supabaseAdmin().auth.admin.deleteUser(user.id);
    if (eBorrar) {
      logger.error('auth.autoregistro_no_revertido', {
        msg: 'Alguien creó una cuenta de Auth sin alta (probablemente por el botón de Google) y NO se pudo borrar. La sesión sí se cerró, pero el `auth.users` sigue ahí: cuenta para MAU y su JWT vale contra PostgREST hasta que caduque. Apaga «Allow new users to sign up» en el proyecto de Supabase.',
        userId: user.id, err: eBorrar.message,
      });
    } else {
      logger.warn('auth.autoregistro_revertido', {
        msg: 'Login sin alta previa: se cerró la sesión y se borró el usuario de Auth recién creado. Si esto se repite, el interruptor «Allow new users to sign up» del proyecto de Supabase está encendido.',
        userId: user.id,
      });
    }
    return true;
  } catch (e) {
    // Mismo criterio que el `error` de arriba: sin certeza no se revierte.
    logger.warn('auth.alta_no_verificable', { err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
