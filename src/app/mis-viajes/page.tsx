import { requireOperador } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../dashboard/formato';
import { SOLO_CONTRALOR } from '@/lib/cuadra/cuadre/resumen';

export const dynamic = 'force-dynamic';

const ESTATUS: Record<string, { label: string; color: string }> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

/**
 * El semáforo del chofer no es el del contralor.
 *
 * `SOLO_CONTRALOR` (`cuadre/resumen.ts`) existe con esta regla escrita:
 * «veredictos que el operador no puede arreglar y que se leen como si se le
 * estuviera auditando. Van al contralor, que sí puede hacer algo. Al operador
 * se le pide lo que falta; no se le juzga.» WhatsApp ya la aplica; esta
 * pantalla nació después y no (auditoría 10, MEDIO de agéntico).
 *
 * El caso concreto: `cfdi_efos` está en esa lista Y en `REVISAR`, así que al
 * chofer se le pintaba «Por revisar» en rojo porque el proveedor de diésel de
 * su empresa está en la lista negra del SAT — un hecho que él no causó, no
 * puede arreglar, y que además es información fiscal de su patrón.
 *
 * Basta UNA causa que sí sea suya para que el aviso siga siendo suyo: aquí no
 * se apaga el estado, se decide de quién es.
 */
function esDelContralor(diferencias: Array<{ tipo?: string }> | null): boolean {
  if (!diferencias?.length) return false;
  return diferencias.every((d) => SOLO_CONTRALOR.includes(d.tipo as never));
}

/** Lo que ve el chofer cuando la revisión no es cosa suya. Ni rojo, ni culpa. */
const EN_REVISION_EMPRESA = { label: 'En revisión por tu empresa', color: 'var(--muted)' };

/**
 * `comprobado` es `number | null`, y el `null` NO es un cero.
 *
 * El viaje abierto del demo (`VJ-2026-0847`) ya tiene $5,600 en `gasto` y
 * todavía no tiene fila en `liquidacion`: el motor no ha cuadrado nada. Con
 * `?? 0` la columna de dinero imprimía «$0.00 comprobado» para el viaje al que
 * el chofer acababa de mandarle catorce fotos — y el chofer que lee eso
 * concluye que su envío se perdió y las reenvía (auditoría 10, frontend,
 * MEDIO). La columna de estatus, tres celdas a la derecha, ya distinguía los
 * dos casos y pintaba «Sin liquidar»; la de dinero no recibió la misma
 * distinción.
 */
interface ViajeChofer { id: string; folio: string; creadoEn: string; comprobado: number | null; estatus: string | null; soloContralor: boolean }

/**
 * Cliente CON sesión (`supabaseServer`), no `supabaseAdmin`: aquí el
 * aislamiento lo hace RLS de verdad (mig. 0045, policy `operador_ve_su_viaje`
 * / `operador_ve_sus_liquidaciones`), no un `.eq()` de cortesía. Un `.eq()`
 * que se le olvide a alguien en este archivo seguiría sin filtrar de más:
 * la base ya no tiene los viajes de otro chofer que enseñarle.
 */
async function getMisViajes(): Promise<ViajeChofer[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('viaje')
    .select('id, folio, created_at, liquidacion(total_comprobado, estatus, diferencias)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getMisViajes: ${error.message}`);
  return (data ?? []).map((v) => {
    const liq = (Array.isArray(v.liquidacion) ? v.liquidacion[0] : v.liquidacion) as
      { total_comprobado?: number; estatus?: string; diferencias?: Array<{ tipo?: string }> } | null;
    return {
      id: v.id as string,
      folio: (v.folio as string) || (v.id as string).slice(0, 8),
      creadoEn: v.created_at as string,
      // Ausencia y cero son cosas distintas: sin fila de liquidación —o con
      // `total_comprobado` vacío— no hay nada medido que imprimir.
      comprobado: liq?.total_comprobado == null ? null : Number(liq.total_comprobado),
      estatus: liq?.estatus ?? null,
      soloContralor: esDelContralor(liq?.diferencias ?? null),
    };
  });
}

export default async function MisViajes() {
  const { nombre, tenantId } = await requireOperador();
  const viajes = await getMisViajes();

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-3xl mx-auto px-8 h-16 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-xl">Likida</span>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{nombre ?? 'Mis viajes'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mis viajes</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Solo lectura — para mandar comprobantes, sigue usando WhatsApp.
        </p>

        {viajes.length === 0 ? (
          <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>
            Todavía no tienes viajes cerrados.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                {/* `scope="col"` — esta tabla nació sin él, con el mismo hueco
                    que la del panel (auditoría 10, frontend, BAJO extendido). */}
                <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                  <th scope="col" className="px-6 py-3 font-medium">Folio</th>
                  <th scope="col" className="px-6 py-3 font-medium">Fecha</th>
                  <th scope="col" className="px-6 py-3 font-medium text-right">Comprobado</th>
                  <th scope="col" className="px-6 py-3 font-medium">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {viajes.map((v) => {
                  // Solo `revisar` cambia de dueño: `cuadrada` y
                  // `con_diferencias` son del chofer igual que siempre.
                  const e = v.estatus === 'revisar' && v.soloContralor
                    ? EN_REVISION_EMPRESA
                    : v.estatus ? (ESTATUS[v.estatus] ?? { label: v.estatus, color: 'var(--muted)' }) : null;
                  return (
                    <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-6 py-4 font-medium">{v.folio}</td>
                      <td className="px-6 py-4" style={{ color: 'var(--muted)' }}>{fechaMx(v.creadoEn)}</td>
                      {/* Un cero medido SÍ se imprime; la ausencia no se
                          disfraza de cero. Mismo criterio que la tarjeta de
                          litros del panel del contralor (`acred.tsx`). */}
                      <td className="px-6 py-4 text-right tabular">
                        {v.comprobado === null
                          ? <span style={{ color: 'var(--muted)' }} title="Se cuenta cuando se cierra el viaje">—</span>
                          : mxn(v.comprobado)}
                      </td>
                      <td className="px-6 py-4">
                        {e ? (
                          <>
                            <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: e.color }} />
                            {e.label}
                          </>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Sin liquidar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* El renglón que evita el reenvío. El guion «—» dice que no hay
            medición; esto dice por qué y que lo suyo no se perdió. Solo
            aparece cuando hay un viaje sin liquidar: una nota permanente se
            aprende a ignorar. */}
        {viajes.some((v) => v.comprobado === null) && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            El monto comprobado de un viaje sin liquidar aparece como «—»: se cuenta al cerrarlo.
            Los comprobantes que ya mandaste por WhatsApp están guardados — no hace falta reenviarlos.
          </p>
        )}
        {/* El aviso que le toca al chofer es el INTEGRAL DE SU FLOTA, no el de
            Likida: el responsable de sus datos es la empresa, y Likida es
            persona encargada — su propio aviso lo dice. Estaba publicado en
            /aviso/[tenant] y ninguna pantalla lo enlazaba (auditoría 10, MEDIO
            de legal). La LFPDPPP art. 15 exige que esté DISPONIBLE al titular;
            un aviso que nadie enlaza está archivado, no disponible. */}
        <p className="mt-10 text-xs" style={{ color: 'var(--muted)' }}>
          Tus datos los trata tu empresa. Consulta su{' '}
          <a href={`/aviso/${tenantId}`} className="underline underline-offset-2">
            Aviso de Privacidad
          </a>{' '}
          para saber qué se guarda, para qué, y cómo oponerte.
        </p>
      </main>
    </div>
  );
}
