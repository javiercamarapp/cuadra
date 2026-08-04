import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { Send, UserCog, PackageCheck, Plus } from 'lucide-react';
import { resolverTenantEfectivo, resolverTenantDeAction } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { listOperadores, reasignarOperador } from '@/lib/cuadra/repo';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, getUnidades,
  crearViaje, asignarUnidad, codigoDeCaptura,
  type TableroOperacion, type ViajeSinAsignar, type CargaOperador, type UnidadRow,
} from '@/lib/cuadra/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import AvisoCaptura from '../aviso-captura';
import { TableroCifras, TablaSinAsignar, TablaCarga, FormaAlta } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * DESPACHO — la pantalla del encargado (jefe de tráfico).
 *
 * Es la primera pantalla de la app donde alguien ESCRIBE en la base desde el
 * navegador: hasta aquí, crear un viaje o moverlo de chofer se hacía por
 * WhatsApp o con SQL a mano. Por eso los dos formularios repiten el chequeo
 * de permiso DENTRO del server action — el `puedeAsignar` de aquí arriba solo
 * decide si el formulario se pinta, y un contador que arme la petición a mano
 * (misma sesión válida, sin el botón) pasaría por encima de él. Es el mismo
 * criterio que ya usa `dashboard/[id]/page.tsx:59-66`.
 *
 * NO hay una sola cifra de dinero en esta pantalla, y no es un descuido: la
 * matriz de permisos (mig. 0044) le da al encargado asignar y exportar, no
 * ver finanzas. El anticipo se captura al crear el viaje porque el motor de
 * cuadre lo necesita, pero no se lista ni se suma en ninguna columna.
 */
export default async function DespachoPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/despacho', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  /** A dónde volver después de una escritura, con su acuse o su motivo. */
  const volver = (clave: string, valor: string) =>
    `/dashboard/despacho${sufijo ? `${sufijo}&` : '?'}${clave}=${valor}`;

  const [tablero, sinAsignar, carga, operadores, unidades] = await Promise.all([
    safe<TableroOperacion>(() => getTableroOperacion(tenantId)),
    safe<ViajeSinAsignar[]>(() => getViajesSinAsignar(tenantId)),
    safe<CargaOperador[]>(() => getCargaOperadores(tenantId)),
    safe<Array<{ id: string; nombre: string }>>(() => listOperadores(tenantId)),
    safe<UnidadRow[]>(() => getUnidades(tenantId)),
  ]);

  // ── Server actions ───────────────────────────────────────────────────────
  // Los dos resuelven el tenant OTRA VEZ desde la sesión en vez de confiar en
  // el `tenantId` que cerró el closure: un action es un endpoint con su propia
  // petición, y el valor capturado viene del render, no de quien hizo clic.

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
  async function tenantDelAction(destino: string) {
    const s = await requireSessionTenant(destino);
    if (!puedeAsignar(s.rol)) redirect(`${destino}${sufijo}`);
    return resolverTenantDeAction(destino, sp);
  }

  async function accionAsignar(formData: FormData) {
    'use server';
    const t = await tenantDelAction('/dashboard/despacho');
    const viajeId = String(formData.get('viajeId') ?? '');
    const operadorId = String(formData.get('operadorId') ?? '');
    const unidadId = String(formData.get('unidadId') ?? '');
    if (!viajeId || !operadorId) redirect(`/dashboard/despacho${sufijo}`);

    // El `try` NO envuelve al `redirect`: `redirect()` funciona lanzando, y
    // atraparlo aquí lo convertiría en "no se guardó" justo cuando sí se
    // guardó. Solo se atrapa lo que la escritura declara como error de
    // captura; cualquier otra excepción sube y es un bug de verdad.
    let err: string | null = null;
    try {
      await reasignarOperador(t, viajeId, operadorId);
      // La unidad es OPCIONAL: un viaje se despacha sin ella (el flujo de
      // WhatsApp nunca la pregunta). Un '' no debe borrar una ya puesta, así
      // que solo se escribe cuando viene algo.
      if (unidadId) await asignarUnidad(t, viajeId, unidadId);
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }

    revalidatePath('/dashboard/despacho');
    redirect(err ? volver('err', err) : volver('ok', 'asignado'));
  }

  async function accionCrear(formData: FormData) {
    'use server';
    const t = await tenantDelAction('/dashboard/despacho');
    const folio = String(formData.get('folio') ?? '').trim();
    const origen = String(formData.get('origen') ?? '').trim();
    const destino = String(formData.get('destino') ?? '').trim();
    const fecha = String(formData.get('fechaInicio') ?? '').trim();
    const operadorId = String(formData.get('operadorId') ?? '');
    const unidadId = String(formData.get('unidadId') ?? '');
    // Number y NO parseFloat: parseFloat("12abc") devuelve 12 en silencio, y
    // un anticipo mal tecleado que se guarda a medias descuadra la
    // liquidación entera sin que nadie lo note.
    const bruto = String(formData.get('anticipo') ?? '').trim();
    const anticipo = bruto === '' ? 0 : Number(bruto);
    if (!Number.isFinite(anticipo) || anticipo < 0) redirect(`/dashboard/despacho${sufijo}`);

    let err: string | null = null;
    try {
      await crearViaje(t, {
        folio: folio || null,
        origen: origen || null,
        destino: destino || null,
        fechaInicio: fecha || null,
        anticipo,
        operadorId: operadorId || null,
        unidadId: unidadId || null,
      });
    } catch (e) {
      err = codigoDeCaptura(e);
      if (err === null) throw e;
    }

    revalidatePath('/dashboard/despacho');
    redirect(err ? volver('err', err) : volver('ok', 'creado'));
  }

  const ops = operadores ?? [];
  const unidadesLibres = (unidades ?? []).filter((u) => u.estado === 'disponible' && u.activo);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Send width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Despacho</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Qué está sin repartir, quién trae cuánto, y a quién le toca
          </span>
        </div>
        {sp.ok === 'asignado' && <StatusPill estado="ok">Viaje asignado</StatusPill>}
        {sp.ok === 'creado' && <StatusPill estado="ok">Viaje creado</StatusPill>}
      </header>

      <AvisoCaptura codigo={sp.err} />

      {tablero === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el estado de la operación.
        </div>
      ) : (
        <TableroCifras t={tablero} />
      )}

      <section className="glass-panel overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
            Sin asignar
          </h2>
          {sinAsignar !== null && sinAsignar.length > 0 && (
            <StatusPill estado="warn">{String(sinAsignar.length)}</StatusPill>
          )}
        </div>

        {sinAsignar === null ? (
          <div className="px-5 pb-5 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la lista.</div>
        ) : sinAsignar.length === 0 ? (
          <div className="px-5 pb-5">
            <EstadoVacio icono={<PackageCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Esta lista está vacía por diseño, no porque se haya medido: hoy la base exige chofer para dar de alta un
              viaje (`viaje.operador_id` es NOT NULL), así que un viaje sin dueño no puede existir y esta consulta no
              puede devolver una fila. Reasignar sí se hace desde aquí — la carga por operador de abajo.
            </EstadoVacio>
          </div>
        ) : !puede ? (
          <div className="px-5 pb-5">
            <EstadoVacio>
              Hay {sinAsignar.length} viaje(s) sin chofer, pero tu rol no puede asignar. Pídeselo al encargado o al
              dueño de la flota.
            </EstadoVacio>
          </div>
        ) : ops.length === 0 ? (
          <div className="px-5 pb-5">
            <EstadoVacio icono={<UserCog width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Hay {sinAsignar.length} viaje(s) sin chofer y ningún operador activo a quien asignárselos. Los
              operadores se dan de alta cuando escriben por WhatsApp por primera vez.
            </EstadoVacio>
          </div>
        ) : (
          <TablaSinAsignar viajes={sinAsignar} operadores={ops} unidadesLibres={unidadesLibres} accion={accionAsignar} />
        )}
      </section>

      <section className="glass-panel overflow-hidden">
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
            Carga por operador
          </h2>
        </div>
        {carga === null ? (
          <div className="px-5 pb-5 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la carga.</div>
        ) : (
          <TablaCarga carga={carga} />
        )}
      </section>

      {puede && (
        <section className="glass-panel p-5">
          <div className="flex items-center gap-2 mb-3">
            <Plus width={15} height={15} strokeWidth={1.75} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Dar de alta un viaje
            </h2>
          </div>
          <FormaAlta operadores={ops} unidadesLibres={unidadesLibres} accion={accionCrear} />
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            El anticipo se guarda porque el motor de cuadre lo necesita para comparar contra lo comprobado. No se
            lista ni se suma en esta pantalla: el dinero es de otra vista y de otro rol.
          </p>
        </section>
      )}

      <div className="px-1">
        <EstadoVacio>
          El mapa en vivo, las geocercas y el ETA no aparecen porque no hay proveedor de rastreo conectado — no es
          una tabla que falte, es una integración que no existe. El margen por viaje tampoco: necesita el ingreso
          del flete, que hoy no se registra en ningún lado. Unidades, incidencias y POD sí tienen dónde vivir desde
          la migración 0047, y se administran en{' '}
          <Link href={`/dashboard/unidades${sufijo}`} className="underline">Unidades</Link> y{' '}
          <Link href={`/dashboard/viajes${sufijo}`} className="underline">Viajes</Link>.
        </EstadoVacio>
      </div>
    </div>
  );
}
