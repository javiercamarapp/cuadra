import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PackageCheck } from 'lucide-react';
import { resolverTenantEfectivo, resolverTenantDeAction } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { getPods, marcarPodPedido, rechazarPod, codigoDeCaptura, type PodRow } from '@/lib/cuadra/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import AvisoCaptura from '../aviso-captura';
import { CifrasPod, TablaPod } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * POD — qué entrega falta y a quién pedírsela.
 *
 * LA FOTO NO SE ENSEÑA, y es la misma decisión que ya se tomó con los
 * comprobantes (auditoría 9, crítico legal): conservar un documento y
 * exhibírselo a un humano no son el mismo acto. Guardarlo tiene base —es la
 * prueba de la entrega—; enseñarlo en un clic desde el panel no la tiene si
 * la imagen trae por accidente un dato sensible sin consentimiento expreso
 * (LFPDPPP art. 8). Por eso aquí hay estado, fecha y nota, pero no un botón
 * "Ver foto".
 *
 * Tampoco hay botón de "pedir por WhatsApp" que mande el mensaje: fuera de la
 * ventana de 24 h eso necesita una plantilla aprobada, y la cuenta no tiene
 * ninguna propia. Un botón que falla en silencio es peor que no tenerlo, así
 * que lo que se registra es que YA SE PIDIÓ — que es la distinción que el
 * encargado necesita para saber a quién insistirle.
 */
export default async function PodPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/pod', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  /** A dónde volver después de una escritura, con su acuse o su motivo. */
  const volver = (clave: string, valor: string) =>
    `/dashboard/pod${sufijo ? `${sufijo}&` : '?'}${clave}=${valor}`;

  const pods = await safe<PodRow[]>(() => getPods(tenantId));

  /**
   * El tenant al que ESCRIBE el action. `resolverTenantDeAction` es la copia
   * única (G-34): la que vivía aquí descartaba el `error` de la consulta, así
   * que con un 503 transitorio `data` salía null, el `if` no entraba y la
   * escritura aterrizaba en el tenant de la SESIÓN — que para un superadmin es
   * el DEMO, con la píldora verde diciendo que se guardó.
   *
   * El gate de PERMISO se queda aquí porque el redirect de vuelta necesita el
   * `sufijo`, que es local a esta página.
   */
  async function tenantDelAction() {
    const s = await requireSessionTenant('/dashboard/pod');
    if (!puedeAsignar(s.rol)) redirect(`/dashboard/pod${sufijo}`);
    return resolverTenantDeAction('/dashboard/pod', sp);
  }

  async function accionPedir(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const viajeId = String(formData.get('viajeId') ?? '');
    if (!viajeId) redirect(`/dashboard/pod${sufijo}`);
    // El `try` no envuelve al `redirect`: `redirect()` funciona lanzando.
    let err: string | null = null;
    try {
      await marcarPodPedido(t, viajeId, String(formData.get('operadorId') ?? '') || null);
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }
    revalidatePath('/dashboard/pod');
    redirect(err ? volver('err', err) : volver('ok', 'pedido'));
  }

  async function accionRechazar(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const podId = String(formData.get('podId') ?? '');
    if (!podId) redirect(`/dashboard/pod${sufijo}`);
    let err: string | null = null;
    try {
      await rechazarPod(t, podId, String(formData.get('nota') ?? '').trim() || null);
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }
    revalidatePath('/dashboard/pod');
    redirect(err ? volver('err', err) : volver('ok', 'rechazado'));
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <PackageCheck width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">POD & Evidencias</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Qué entrega no ha llegado, de quién es, y cuál llegó pero no sirve
          </span>
        </div>
        {sp.ok === 'pedido' && <StatusPill estado="ok">Marcado como pedido</StatusPill>}
        {sp.ok === 'rechazado' && <StatusPill estado="ok">Evidencia rechazada</StatusPill>}
      </header>

      <AvisoCaptura codigo={sp.err} />

      {pods === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el estado de las evidencias.
        </div>
      ) : (
        <>
          <CifrasPod pods={pods} />
          <section className="glass-panel overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Viajes en curso
              </h2>
            </div>
            <TablaPod
              pods={pods}
              accionPedir={puede ? accionPedir : undefined}
              accionRechazar={puede ? accionRechazar : undefined}
            />
          </section>
        </>
      )}

      <div className="px-1">
        <EstadoVacio>
          La foto de la entrega se guarda pero no se muestra aquí: conservar un documento y exhibírselo a una
          persona no son el mismo acto, y es el mismo criterio que ya se aplicó a los comprobantes. Tampoco hay
          botón que le mande el recordatorio al chofer — pedir algo por WhatsApp fuera de la ventana de 24 horas
          necesita una plantilla aprobada por Meta, y la cuenta todavía no tiene ninguna propia. Lo que sí queda
          registrado es que ya se pidió, para distinguirlo de lo que nadie ha solicitado.
        </EstadoVacio>
      </div>
    </div>
  );
}
