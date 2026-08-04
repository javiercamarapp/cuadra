import { requireSuperadmin } from '@/lib/auth/guard';
import { getCorreoPerfil } from '@/lib/admin/negocio';
import { UserRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import AvatarUploader from './avatar-uploader';
import { actualizarNombre, subirAvatar } from './acciones';
import { etiquetaRol } from '../roles';
import { MENSAJE_ERROR } from './mensajes';

export const dynamic = 'force-dynamic';

/**
 * Editable de verdad — nombre y foto de perfil escriben a `app_user`
 * (0046_perfil_avatar.sql), no son un formulario decorativo. Correo y rol
 * se muestran pero NO son editables aquí: el correo está ligado a la
 * cuenta de Supabase Auth (cambiarlo es un flujo de verificación aparte,
 * no un campo de texto) y el rol lo asigna otro superadmin, no uno mismo.
 *
 * AUDITORÍA 11 · G-33: los dos server actions salieron de aquí a
 * `acciones.ts` —inline no se pueden importar, y por eso la única escritura
 * de perfil del producto no tenía una sola prueba— y las tres lecturas/
 * escrituras directas a Supabase salieron a `@/lib/admin/negocio`, que es la
 * frontera que el resto de `/admin` respeta.
 */
export default async function MiPerfilPage({
  searchParams,
}: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSuperadmin();
  const sp = await searchParams;
  const correo = await getCorreoPerfil(s.userId);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <UserRound width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Mi perfil</span>
      </header>

      <div className="glass-panel p-6" style={{ maxWidth: 480 }}>
        {sp.ok && (
          <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
            <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
            {sp.ok === 'avatar' ? 'Foto de perfil actualizada.' : 'Nombre guardado.'}
          </div>
        )}
        {sp.error && (
          <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
            <AlertTriangle width={15} height={15} strokeWidth={1.75} />
            {MENSAJE_ERROR[sp.error] ?? MENSAJE_ERROR.avatar}
          </div>
        )}

        <AvatarUploader nombre={s.nombre ?? 'Javier'} avatarUrl={s.avatarUrl} accion={subirAvatar} />

        <form action={actualizarNombre} className="space-y-4 mt-6 pt-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div>
            <label className="text-sm font-medium block mb-1.5">Nombre</label>
            <input name="nombre" type="text" defaultValue={s.nombre ?? ''} required
              className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <button type="submit" className="text-sm px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
            style={{ background: 'var(--marca)', color: 'white' }}>
            Guardar nombre
          </button>
        </form>

        <dl className="mt-6 pt-6 border-t space-y-3 text-sm" style={{ borderColor: 'var(--line)' }}>
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--muted)' }}>Correo</dt>
            <dd className="text-right">{correo ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--muted)' }}>Rol</dt>
            <dd className="text-right">{etiquetaRol(s.rol)}</dd>
          </div>
        </dl>
        <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
          Correo y rol no son editables aquí — el correo está ligado a tu cuenta de acceso y el rol lo asigna otro superadmin.
        </p>
      </div>
    </div>
  );
}
