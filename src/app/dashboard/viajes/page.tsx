import Link from 'next/link';
import { Truck, MapPin, Wallet, Clock } from 'lucide-react';
import { getViajes, type ViajeRow } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { fechaMx } from '../formato';
import { sufijoTenant, type SearchParamsPanel } from '../sufijo';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';
import { safeLog } from '@/lib/cuadra/pg';

export const dynamic = 'force-dynamic';
// Techo explícito: sin él, una lectura lenta se lleva el default de la
// plataforma y la página cuelga sin decirlo (auditoría 11, G-52).
export const maxDuration = 60;

/** Los TRES estatus que `viaje` de verdad admite — el dominio está fijado en
 *  la base (`viaje_estatus_dominio`, 0025_dominios_check.sql:112:
 *  `estatus in ('abierto','en_cuadre','liquidado')`), no es una convención.
 *  Un cuarto valor cae al `??` de abajo y sale con su clave cruda: nunca
 *  `undefined` ni una etiqueta inventada. */
const ESTATUS_VIAJE: Record<string, { label: string; estado: Estado }> = {
  abierto: { label: 'Abierto', estado: 'warn' },
  en_cuadre: { label: 'En cuadre', estado: 'warn' },
  liquidado: { label: 'Liquidado', estado: 'ok' },
};

/** Un fallo de lectura NO es «no hay nada»: se registra y se devuelve `null`
 *  para que la pantalla lo declare, en vez de un `catch` vacío que lo borra
 *  (auditoría 11, G-32). */
const safe = <T,>(fn: () => Promise<T>) => safeLog(fn, 'dashboard/viajes');

/**
 * Viajes (PASO 12 del documento) — la tabla real de `viaje`.
 *
 * El PASO 12 pide columnas de unidad, POD y margen por viaje. Desde la
 * migración 0047 las dos primeras SÍ existen (`viaje.unidad_id`, tablas
 * `unidad` y `pod`) y tienen pantalla propia — Unidades y POD & Evidencias —,
 * así que el recuadro de abajo las manda ahí en vez de declararlas
 * inexistentes: un hueco que ya no es hueco vuelve sospechoso a todo lo demás
 * que esta pantalla afirma.
 *
 * El margen sigue sin poderse calcular, y esa sí es una pieza que falta de
 * raíz: no se registra el ingreso del flete en ningún lado, y `viaje.anticipo`
 * es lo que se le adelanta al operador, no lo que paga el cliente.
 */
export default async function ViajesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsPanel>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/viajes', sp);
  const sufijo = sufijoTenant(sp);
  const viajes = await safe<ViajeRow[]>(() => getViajes(tenantId));

  // "Sin liquidar" son los DOS estatus previos al cierre (`abierto` y
  // `en_cuadre`), no solo `abierto`: contar uno solo dejaría fuera justo los
  // viajes que están a media liquidación, que son los que el dueño persigue.
  const sinLiquidar = viajes?.filter((v) => v.estatus !== 'liquidado') ?? [];
  const abiertos = sinLiquidar.length;
  const anticipoAbierto = sinLiquidar.reduce((s, v) => s + v.anticipo, 0);
  const conPendientes = viajes?.filter((v) => v.intakePendientes > 0).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Truck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Viajes</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Cada viaje, su operador y su anticipo</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {viajes === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado de viajes.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Estado de la operación
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Viajes registrados" valor={viajes.length} formato="entero" />
                <KpiTile icono={<MapPin width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Abiertos (sin liquidar)" valor={abiertos} formato="entero" />
                <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Anticipo en viajes abiertos" valor={anticipoAbierto} formato="mxn" />
                <KpiTile icono={<Clock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con comprobantes en camino" valor={conPendientes} formato="entero"
                  nota="Fotos que el operador mandó y el agente todavía está procesando" />
              </div>
            </section>

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Todos los viajes
              </h2>
            </div>
            {viajes.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no hay viajes registrados para esta flota.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th scope="col" className="px-5 py-2.5 font-medium">Folio</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Ruta</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Operador</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Inicio</th>
                      <th scope="col" className="px-5 py-2.5 font-medium text-right">Anticipo</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Estatus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viajes.map((v) => {
                      const e = ESTATUS_VIAJE[v.estatus] ?? { label: v.estatus, estado: 'neutral' as Estado };
                      return (
                        <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-5 py-3 font-medium">{v.folio}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                            {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? '—')}
                          </td>
                          <td className="px-5 py-3">{v.operadorNombre ?? '—'}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
                          <td className="px-5 py-3 text-right tabular">{v.anticipo > 0 ? mxn(v.anticipo) : '—'}</td>
                          <td className="px-5 py-3">
                            <StatusPill estado={e.estado}>{e.label}</StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                Esta tabla lista el viaje y su dinero. La unidad que lo hizo y la evidencia de entrega existen desde
                la migración 0047, pero se administran en su propia pantalla:{' '}
                <Link href={`/dashboard/unidades${sufijo}`} className="underline">Unidades</Link>,{' '}
                <Link href={`/dashboard/pod${sufijo}`} className="underline">POD &amp; Evidencias</Link> y{' '}
                <Link href={`/dashboard/despacho${sufijo}`} className="underline">Despacho</Link>, que es donde se
                crea y se asigna un viaje sin pasar por WhatsApp. Lo que sigue sin poderse calcular es el{' '}
                <strong>margen por viaje</strong>: no se registra el ingreso del flete en ningún lado, y el anticipo
                es lo que le adelantas al operador, no lo que te paga tu cliente. El estimador de casetas +
                combustible y el OTIF necesitan esa misma pieza y los kilómetros de la ruta, que tampoco se guardan.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
