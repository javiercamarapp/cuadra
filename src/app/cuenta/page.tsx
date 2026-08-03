import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function Cuenta() {
  const s = await requireSessionTenant('/cuenta');
  const { data: tenant } = await supabaseAdmin()
    .from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle();
  // EL CORREO, NO EL UUID. El campo "Nombre" del alta es opcional por diseño
  // (`admin/usuarios/nuevo/page.tsx:57`), así que `app_user.nombre` puede
  // quedar en `null`; esta pantalla resolvía con `s.nombre ?? s.userId` y bajo
  // la etiqueta "Usuario" imprimía `3f2a1c88-9b04-4e11-…`. Es la única pantalla
  // que el contralor abre para confirmar "sí, soy yo", y le contestaba con un
  // identificador interno (auditoría 10, frontend, BAJO).
  //
  // `app_user.email` es `not null unique` (schema.sql:22) y `session.ts` no lo
  // selecciona; se pide aquí, que es donde hace falta, en vez de engordar el
  // select de la puerta de autorización.
  const { data: usuario } = await supabaseAdmin()
    .from('app_user').select('email').eq('id', s.userId).maybeSingle();
  const quienEs = s.nombre ?? (usuario?.email as string | undefined) ?? '—';

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/');
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Mi cuenta</div>
        <dl className="mt-6 text-sm space-y-3">
          <div>
            <dt style={{ color: 'var(--muted)' }}>Flota</dt>
            <dd>{(tenant?.nombre as string) ?? '—'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--muted)' }}>Usuario</dt>
            <dd>{quienEs}</dd>
          </div>
        </dl>
        {/* Mismo criterio que /mis-viajes: el aviso del titular es el de SU
            empresa (/aviso/[tenant]), no el de Likida — que es encargada, no
            responsable. Estaba publicado y sin enlazar desde ninguna pantalla
            (auditoría 10, MEDIO de legal). */}
        <p className="mt-6 text-xs" style={{ color: 'var(--muted)' }}>
          Tus datos los trata tu empresa. Consulta su{' '}
          <a href={`/aviso/${s.tenantId}`} className="underline underline-offset-2">
            Aviso de Privacidad
          </a>.
        </p>
        <form action={cerrarSesion} className="mt-6">
          <button type="submit"
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium hairline"
            style={{ color: 'var(--ink)' }}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
