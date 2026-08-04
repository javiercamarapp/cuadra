import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { Wrench, Plus } from 'lucide-react';
import { resolverTenantEfectivo, resolverTenantDeAction } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import {
  getUnidades, crearUnidad, cambiarEstadoUnidad, codigoDeCaptura, type UnidadRow,
} from '@/lib/cuadra/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import AvisoCaptura from '../aviso-captura';
import { CifrasUnidades, TablaUnidades, FormaUnidad } from './vista';
import { safeLog } from '@/lib/cuadra/pg';

export const dynamic = 'force-dynamic';
// Techo explícito: sin él, una lectura lenta se lleva el default de la
// plataforma y la página cuelga sin decirlo (auditoría 11, G-52).
export const maxDuration = 60;

/** Los cuatro valores que admite `unidad_estado_dominio` (0047). Se valida
 *  aquí ADEMÁS del constraint: un valor fuera del dominio lo rechaza la base
 *  con un 500 feo, y el encargado solo vería "algo falló". */
const ESTADOS = new Set(['disponible', 'en_ruta', 'taller', 'baja']);

/** Un fallo de lectura NO es «no hay nada»: se registra y se devuelve `null`
 *  para que la pantalla lo declare, en vez de un `catch` vacío que lo borra
 *  (auditoría 11, G-32). */
const safe = <T,>(fn: () => Promise<T>) => safeLog(fn, 'dashboard/unidades');

/**
 * UNIDADES — el expediente operativo del vehículo.
 *
 * Hasta la migración 0047 esta página era un `SeccionPendiente` que decía la
 * verdad: no existía registro de vehículos, ni `viaje` guardaba cuál lo hizo.
 * Ya existe, así que la página deja de anunciar el hueco y lo llena.
 *
 * Lo que sigue faltando se dice abajo, no se disfraza: el COSTO por unidad
 * (no hay dónde registrar el gasto de un servicio) y el DVIR con foto (la
 * tabla `mantenimiento` acepta el tipo 'dvir', pero no hay subida de imagen
 * ni pantalla para que el operador la haga desde WhatsApp).
 */
export default async function UnidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/unidades', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  /** A dónde volver después de una escritura, con su acuse o su motivo. */
  const volver = (clave: string, valor: string) =>
    `/dashboard/unidades${sufijo ? `${sufijo}&` : '?'}${clave}=${valor}`;

  const unidades = await safe<UnidadRow[]>(() => getUnidades(tenantId));

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
    const s = await requireSessionTenant('/dashboard/unidades');
    if (!puedeAsignar(s.rol)) redirect(`/dashboard/unidades${sufijo}`);
    return resolverTenantDeAction('/dashboard/unidades', sp);
  }

  async function accionEstado(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const unidadId = String(formData.get('unidadId') ?? '');
    const estado = String(formData.get('estado') ?? '');
    if (!unidadId || !ESTADOS.has(estado)) redirect(`/dashboard/unidades${sufijo}`);
    // El `try` no envuelve al `redirect`: `redirect()` funciona lanzando.
    let err: string | null = null;
    try {
      await cambiarEstadoUnidad(t, unidadId, estado);
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }
    revalidatePath('/dashboard/unidades');
    redirect(err ? volver('err', err) : volver('ok', 'movida'));
  }

  async function accionAlta(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const numeroEconomico = String(formData.get('numeroEconomico') ?? '').trim();
    // Es lo ÚNICO obligatorio: es como la flota llama a la unidad en la radio
    // y en el papel, y la 0047 lo hace único por tenant. Sin él, la fila no
    // se puede nombrar en ninguna pantalla.
    if (!numeroEconomico) redirect(`/dashboard/unidades${sufijo}`);
    const anioBruto = String(formData.get('anio') ?? '').trim();
    const anio = anioBruto === '' ? null : Number(anioBruto);
    if (anio !== null && !Number.isInteger(anio)) redirect(`/dashboard/unidades${sufijo}`);

    let err: string | null = null;
    try {
      await crearUnidad(t, {
        numeroEconomico,
        placas: String(formData.get('placas') ?? '').trim() || null,
        marca: String(formData.get('marca') ?? '').trim() || null,
        modelo: String(formData.get('modelo') ?? '').trim() || null,
        anio,
      });
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }
    revalidatePath('/dashboard/unidades');
    redirect(err ? volver('err', err) : volver('ok', 'alta'));
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Wrench width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Unidades</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Dónde está cada unidad, qué papel se le vence y cuál trae orden de taller
          </span>
        </div>
        {sp.ok === 'movida' && <StatusPill estado="ok">Estado actualizado</StatusPill>}
        {sp.ok === 'alta' && <StatusPill estado="ok">Unidad dada de alta</StatusPill>}
      </header>

      <AvisoCaptura codigo={sp.err} />

      {unidades === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el listado de unidades.
        </div>
      ) : (
        <>
          <CifrasUnidades unidades={unidades} />

          <section className="glass-panel overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Toda la flota
              </h2>
            </div>
            <TablaUnidades unidades={unidades} accionEstado={puede ? accionEstado : undefined} />
          </section>

          {puede && (
            <section className="glass-panel p-5">
              <div className="flex items-center gap-2 mb-3">
                <Plus width={15} height={15} strokeWidth={1.75} />
                <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Dar de alta una unidad
                </h2>
              </div>
              <FormaUnidad accion={accionAlta} />
            </section>
          )}
        </>
      )}

      <div className="px-1">
        <EstadoVacio>
          Las fechas de póliza, permiso SICT y verificación ya tienen dónde guardarse, pero todavía no se capturan
          desde aquí: hoy entran por base de datos. Lo que sí falta de raíz es el <strong>costo por unidad</strong>
          {' '}—no hay dónde registrar lo que costó un servicio— y el <strong>DVIR con foto</strong>: la tabla acepta
          ese tipo de orden, pero no hay subida de imagen ni forma de que el operador la haga desde WhatsApp. La
          calibración por placa (km/L y tanque esperado, que usa el motor de cuadre) sigue viviendo aparte, en{' '}
          <Link href={`/dashboard/configuracion${sufijo}`} className="underline">Configuración</Link>.
        </EstadoVacio>
      </div>
    </div>
  );
}
