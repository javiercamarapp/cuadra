import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd } from '@/lib/formato';
import { Settings2, Smartphone } from 'lucide-react';
import { Dona } from '../charts';
import { FASE_LABEL, FASE_ICONO, etiquetaFase } from '../fases';
import type { FaseCosto } from '@/lib/cuadra/costos';

export const dynamic = 'force-dynamic';

/** Insignia monocromo — mismo patrón que admin/page.tsx (Truck/DollarSign/…
 *  dentro de una caja con borde `var(--line)`), recreado local porque
 *  `page.tsx` no lo exporta. */
function Insignia({ Icono }: { Icono: typeof Settings2 }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

/** Ícono de proveedor por el prefijo real `proveedor/modelo` — mismo patrón
 *  que `IconoProveedor` en admin/page.tsx, recreado local a propósito (así
 *  lo pidió el encargo: es una función chica, no vale la pena compartirla
 *  entre rutas). */
function IconoProveedor({ modelo }: { modelo: string }) {
  if (modelo.toLowerCase().includes('whatsapp')) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <Smartphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
      </div>
    );
  }
  const proveedor = modelo.includes('/') ? modelo.split('/')[0] : modelo;
  const letra = proveedor.charAt(0).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--ink)', color: 'white' }}>
      {letra}
    </div>
  );
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/** Las TRES fases reales del pipeline — en ese orden, porque es el orden en
 *  el que de verdad corren para cada viaje. No hay una cuarta fase, ni un
 *  "crear agente nuevo": Likida no tiene tool-calling configurable, son
 *  pasos fijos en código. Son las tres de `FaseCosto` que algún
 *  `registrarCosto` escribe hoy; `chat` y `router` existen en el tipo y
 *  ningún camino las produce, así que no se listan como agentes.
 *
 *  El NOMBRE y el ÍCONO salen de `admin/fases.ts`, no de un literal local:
 *  eran el séptimo y el sexto sitio donde había que acordarse de la misma
 *  traducción (auditoría 10, MEDIO). Aquí solo queda lo que es de esta
 *  pantalla y de ninguna otra: qué hace cada agente. */
const REGISTRO: Array<{ fase: FaseCosto; queHace: string }> = [
  { fase: 'ocr', queHace: 'Lee la foto de un comprobante (diésel, caseta, factura) y extrae monto, folio y CFDI.' },
  { fase: 'cuadre', queHace: 'Compara los gastos ya capturados contra el anticipo y la política de la flota.' },
  { fase: 'whatsapp', queHace: 'Lleva la conversación con el operador de principio a fin: recibe fotos, confirma y cierra la liquidación.' },
];

/**
 * Model Ops — registro real de las 3 fases fijas del pipeline de Likida, no
 * un editor de agentes. No existe UI para crear/versionar/asignar modelo por
 * fase: eso sería funcionalidad decorativa que no hace nada, prohibido por
 * la regla del proyecto. Todo lo que se ve aquí sale de `llm_costo`
 * (`getResumenNegocio`/`getCostoPorFaseModelo`).
 */
export default async function ModelOpsPage() {
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const porFaseMap = new Map(r.porFase.map((f) => [f.fase, f]));

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Settings2 width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Model Ops</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Registro de las 3 fases fijas del pipeline y su costo real</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Registro de agentes</TituloSeccion>
          <div className="space-y-3 mt-3">
            {REGISTRO.map(({ fase, queHace }) => {
              const nombre = FASE_LABEL[fase];
              const Icono = FASE_ICONO[fase];
              const datos = porFaseMap.get(fase);
              const modelos = porFaseModelo.filter((m) => m.fase === fase);
              return (
                <div key={fase} className="card p-4">
                  <div className="flex items-start gap-3">
                    <Insignia Icono={Icono} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="text-sm font-semibold">{nombre}</div>
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular">{datos ? usd(datos.costoUsd) : usd(0)}</div>
                          <div className="text-xs" style={{ color: 'var(--muted)' }}>{datos ? `${datos.n} llamadas` : 'sin llamadas'}</div>
                        </div>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{queHace}</p>

                      {modelos.length > 0 ? (
                        <div className="mt-3 divide-y" style={{ borderColor: 'var(--line)' }}>
                          {modelos.map((m) => (
                            <div key={m.modelo} className="py-2 flex items-center justify-between gap-3 text-xs">
                              <span className="font-mono truncate" style={{ color: 'var(--muted)' }}>{m.modelo}</span>
                              <span className="tabular shrink-0">{usd(m.costoUsd)} · {m.n} llamadas</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>Sin llamadas registradas para esta fase todavía.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Costo por fase y tráfico por modelo</TituloSeccion>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            {r.porFase.length > 0 ? (
              <div className="card p-4">
                <Dona segmentos={r.porFase.map((f) => ({ etiqueta: etiquetaFase(f.fase), valor: f.costoUsd }))} />
              </div>
            ) : (
              <div className="card p-4 flex items-center text-sm" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
            )}

            {r.porModelo.length === 0 ? (
              <div className="card p-4 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="px-4 py-3 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas · todas las fases</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Roadmap</TituloSeccion>
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            Versionado de prompts, rollback, guardrails configurables — Fase 2 del roadmap. Hoy los prompts viven en código
            (<code className="font-mono text-xs">src/lib/agents/prompts.ts</code>), sin historial de versiones ni UI de edición.
            No existe tampoco un selector de modelo por fase ni tenant: cambiar de modelo hoy es un cambio de código y un deploy.
          </p>
        </section>
      </div>
    </div>
  );
}
