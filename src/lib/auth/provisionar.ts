// ═══════════════════════════════════════════════════════════════════════════
// ALTA DE UN USUARIO DEL PANEL. `app_user.id` tiene que ser el mismo `id` de
// `auth.users`, así que la fila de `app_user` no se puede insertar antes de
// que exista el usuario de Auth. Se crea aquí con la Admin API (service-role,
// vía supabaseAdmin()) y `email_confirm: true` para que no haga falta un paso
// de confirmación aparte — el primer login real (magic link o Google) ya es
// la confirmación.
//
// `tenantId` acepta `null` porque `app_user.tenant_id` nulo es una fila
// válida: significa superadmin, no "sin asignar" (0001_init.sql:17). El
// default de `rol` es `flota_admin` porque es el caso común — dar de alta al
// contralor de una flota — y `superadmin` se pide explícito.
//
// ── DOS SISTEMAS, NINGUNA TRANSACCIÓN (auditoría 10, ALTO de backend) ───────
//
// Auth y Postgres son dos escrituras que no comparten transacción. Si la
// segunda falla, la primera queda hecha: un `auth.users` sin fila en
// `app_user`. Eso no era "un error y ya":
//
//   · El correo queda QUEMADO desde el producto. El segundo intento no llega
//     al insert: `createUser` responde «A user with this email address has
//     already been registered» y la función lanza en la primera línea. No hay
//     ninguna pantalla del panel que pueda destrabarlo — hay que entrar a la
//     consola de Supabase a borrar el huérfano a mano.
//   · Y el huérfano SÍ puede pedir magic link (`shouldCreateUser:false` lo deja
//     pasar porque el usuario existe) y entrar a una sesión sin fila en
//     `app_user`, que es la que sale con `tenantId: null` a /sin-acceso.
//
// Como no hay transacción distribuida, se compensa: si el insert falla, se
// borra el usuario de Auth recién creado. Si el borrado TAMBIÉN falla, el
// huérfano existe y lo único honesto es dejar escrito su correo y su id para
// poder limpiarlo — antes no quedaba ni una línea.
//
// ── EL ROL `operador` NACÍA ROTO ───────────────────────────────────────────
//
// El `<select>` de `/admin/usuarios/nuevo` ofrece «Chofer (operador) — solo sus
// propios viajes» y esta función no recibía ni escribía `operador_id`, así que
// TODO chofer dado de alta desde el producto nacía con `operador_id = null`:
// `requireOperador` lo manda a /sin-acceso (`guard.ts:62`) y ninguna otra
// pantalla del repo llena esa columna. Una cuenta que existe y no sirve, y el
// mensaje que ve el chofer es "pide tu alta" — acaban de dársela.
//
// Ahora `operador_id` es parte del contrato y el rol se niega a crearse sin
// él. Rechazar ANTES de tocar Auth es lo que hace que un alta mal pedida no
// deje nada a medias.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export type RolAppUser = 'superadmin' | 'flota_admin' | 'contador' | 'operador' | 'encargado';

export async function provisionarUsuario(
  tenantId: string | null,
  email: string,
  nombre?: string,
  rol: RolAppUser = 'flota_admin',
  operadorId?: string | null,
): Promise<{ userId: string }> {
  const admin = supabaseAdmin();

  // ── 1. TODO lo que se puede rechazar SIN escribir, se rechaza aquí ────────
  // Cada línea de esta sección es un `auth.users` huérfano que no se crea.
  if (rol === 'operador' && !operadorId) {
    throw new Error(
      'Un chofer necesita estar ligado a su fila de `operador` (la identidad con la que WhatsApp lo reconoce). Sin `operador_id`, la cuenta se crea y /mis-viajes lo manda a /sin-acceso: elige el chofer al que corresponde esta cuenta.',
    );
  }
  if (rol !== 'operador' && operadorId) {
    throw new Error(
      `\`operador_id\` solo se llena cuando el rol es 'operador' (0045); con rol '${rol}' la columna quedaría mintiendo sobre lo que significa.`,
    );
  }
  if (operadorId) {
    if (!tenantId) {
      throw new Error('Un chofer pertenece a una flota: no se puede ligar `operador_id` en una cuenta sin tenant.');
    }
    // El MISMO criterio que `reasignarOperador`: la pertenencia se comprueba
    // contra la base, no contra el `<select>` que pintó la lista. Un UUID de la
    // flota B pegado aquí daría lectura cruzada entre flotas, que es el único
    // daño que este esquema declara inaceptable desde la 0001.
    const { data: op, error: eOp } = await admin
      .from('operador').select('id').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle();
    if (eOp) throw new Error(`no se pudo verificar el operador: ${eOp.message}`);
    if (!op) throw new Error('Ese chofer no pertenece a esta flota.');
  }

  // ── 2. Auth ───────────────────────────────────────────────────────────────
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? 'no se pudo crear el usuario de Auth');
  const userId = data.user.id;

  // ── 3. Postgres, y la compensación si no entra ────────────────────────────
  // El objeto va INLINE en el `insert(...)` a propósito: `runbook.test.ts:194`
  // lee estas columnas del fuente para comprobar que el script de bootstrap del
  // primer superadmin escriba la misma fila. Sacarlas a una variable rompe ese
  // guardarraíl en silencio.
  //
  // `operador_id` solo se manda cuando hay valor: los otros cuatro roles no
  // dependen de que la 0045 esté aplicada para poder darse de alta.
  const { error: errInsert } = await admin.from('app_user').insert({
    id: userId, tenant_id: tenantId, email, nombre: nombre ?? null, rol,
    ...(operadorId ? { operador_id: operadorId } : {}),
  });
  if (errInsert) {
    const { error: errBorrar } = await admin.auth.admin.deleteUser(userId);
    if (errBorrar) {
      // Lo peor que puede pasar, y ahora se ve: el usuario de Auth existe, no
      // tiene fila en `app_user`, y el correo no se puede volver a dar de alta
      // desde el producto hasta que alguien lo borre en la consola de Supabase.
      logger.error('provisionar.huerfano', {
        msg: 'Quedó un usuario de Auth SIN fila en app_user y no se pudo borrar. Ese correo NO se puede volver a dar de alta desde el panel hasta que se borre a mano en la consola de Supabase (Authentication → Users). Mientras tanto puede pedir magic link y entrar a una sesión sin alta.',
        userId, email, err: errInsert.message, errBorrar: errBorrar.message,
      });
    } else {
      logger.warn('provisionar.compensado', {
        msg: 'El insert en app_user falló y se borró el usuario de Auth recién creado: el correo queda libre para reintentar el alta.',
        userId, email, err: errInsert.message,
      });
    }
    throw new Error(errInsert.message);
  }

  return { userId };
}
