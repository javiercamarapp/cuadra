import { requireSuperadmin } from '@/lib/auth/guard';
import { provisionarUsuario, type RolAppUser } from '@/lib/auth/provisionar';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ROLES: Array<{ valor: RolAppUser; etiqueta: string }> = [
  { valor: 'flota_admin', etiqueta: 'Dueño (flota_admin) — control total de su flota' },
  { valor: 'encargado', etiqueta: 'Encargado — asigna viajes, exporta, sin facturación' },
  { valor: 'contador', etiqueta: 'Contador — solo lectura y exportar' },
  { valor: 'operador', etiqueta: 'Chofer (operador) — solo sus propios viajes' },
];

/**
 * Traduce lo que LANZA `provisionarUsuario` a algo que se pueda pintar.
 *
 * El caso normal del camino de error es **correo repetido**, y Supabase Auth
 * lo reporta como «A user with this email address has already been
 * registered»: jerga de API, en inglés, en la consola del equipo. Los demás
 * mensajes de `provisionar.ts` ya están escritos para una persona («Ese chofer
 * no pertenece a esta flota.») y se conservan tal cual.
 */
export function mensajeDeAlta(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e ?? '');
  if (/already been registered|already registered|already exists|duplicate key/i.test(bruto)) {
    return 'Ese correo ya tiene cuenta. Búscalo en el equipo antes de volver a darlo de alta.';
  }
  return bruto.trim() || 'No se pudo crear el usuario. Inténtalo de nuevo.';
}

/**
 * Reemplaza el script `scripts/tmp-provisionar-*.ts` que hasta hoy había que
 * escribir y correr a mano cada vez — usa la misma `provisionarUsuario` que
 * ya está probada (provisionar.test.ts). El botón "+ Nuevo Agente" de la
 * referencia no tenía equivalente real en Likida (no hay agentes que un
 * superadmin cree); esto sí es una tarea real y recurrente.
 *
 * ES LA ÚNICA TAREA DE ESCRITURA REAL DE /admin, y no acusaba ni recibo ni
 * error: el action escribía `?creado=1` y `?error=1` en la URL y ninguna de
 * las dos páginas recibía `searchParams` (auditoría 10, frontend, MEDIO). El
 * éxito aterrizaba en `/admin`, una pantalla idéntica a la de antes —el roster
 * vive en `/admin/equipo`, otra página—, así que no había forma de saber si se
 * creó; y el fallo más probable (correo repetido) subía como throw hasta
 * `global-error.tsx`, que reemplaza la consola entera por «Código del
 * incidente: …», porque bajo /admin no hay `error.tsx` en ningún segmento.
 *
 * Ahora las dos respuestas vuelven a ESTA pantalla, que es la que tiene el
 * formulario para el siguiente usuario y la liga al roster donde la fila nueva
 * sí se ve.
 */
export default async function NuevoUsuario({
  searchParams,
}: {
  searchParams: Promise<{ creado?: string; error?: string }>;
}) {
  await requireSuperadmin();
  const { flotas } = await getResumenNegocio();
  const sp = await searchParams;
  const creado = sp?.creado?.trim();
  const error = sp?.error?.trim();

  async function crear(formData: FormData) {
    'use server';
    await requireSuperadmin();
    const tenantId = String(formData.get('tenantId') ?? '');
    const email = String(formData.get('email') ?? '').trim();
    const nombre = String(formData.get('nombre') ?? '').trim() || undefined;
    const rol = formData.get('rol') as RolAppUser;
    if (!tenantId || !email || !rol) {
      redirect(`/admin/usuarios/nuevo?error=${encodeURIComponent('Faltan la flota, el correo o el rol.')}`);
    }
    // El `redirect` de Next LANZA (`NEXT_REDIRECT`), así que ni el de éxito ni
    // el de fallo pueden ir dentro del `try`: se los tragaría el `catch` y el
    // alta correcta se reportaría como error.
    let motivo: string | null = null;
    try {
      await provisionarUsuario(tenantId, email, nombre, rol);
    } catch (e) {
      motivo = mensajeDeAlta(e);
    }
    if (motivo) redirect(`/admin/usuarios/nuevo?error=${encodeURIComponent(motivo)}`);
    redirect(`/admin/usuarios/nuevo?creado=${encodeURIComponent(email)}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center px-5">
        <span className="text-sm font-medium">Nuevo usuario</span>
      </header>
      <main className="max-w-md space-y-4">
        {creado && (
          <div className="glass-panel p-4 text-sm" style={{ borderColor: 'var(--color-ok)' }}>
            <p className="font-medium m-0" style={{ color: 'var(--color-ok)' }}>Se creó la cuenta de {creado}</p>
            <p className="mt-1 m-0" style={{ color: 'var(--muted)' }}>
              Ya puede entrar con su magic link. Revísala en{' '}
              <Link href="/admin/equipo" className="underline underline-offset-2">el equipo</Link>, o da de alta al
              siguiente aquí abajo.
            </p>
          </div>
        )}
        {error && (
          <div className="glass-panel p-4 text-sm" style={{ borderColor: 'var(--color-bad)' }}>
            <p className="font-medium m-0" style={{ color: 'var(--color-bad)' }}>No se pudo crear el usuario</p>
            <p className="mt-1 m-0" style={{ color: 'var(--muted)' }}>{error}</p>
          </div>
        )}
        <form action={crear} className="glass-panel p-6 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Flota</label>
            <select name="tenantId" required className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Correo</label>
            <input name="email" type="email" required placeholder="persona@flota.com"
              className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Nombre (opcional)</label>
            <input name="nombre" type="text" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Rol</label>
            <select name="rol" required defaultValue="flota_admin" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full text-sm px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
            style={{ background: 'var(--ink)', color: 'white' }}>
            Crear usuario
          </button>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Crea la cuenta de Auth y la fila en app_user (mismo camino que el script manual). El primer login (magic link) confirma la cuenta.
          </p>
        </form>
      </main>
    </div>
  );
}
