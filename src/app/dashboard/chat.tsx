'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import type { DashboardKpis, Acreditables } from '@/lib/cuadra/analytics';
import { mxn, litros } from '@/lib/formato';

/**
 * Mismo criterio que admin/chat.tsx: coincidencia de palabras clave contra
 * datos YA calculados en el servidor (`kpis`/`acred`), nunca lenguaje
 * natural a SQL con permisos de servicio. Aquí pesa MÁS que en admin —
 * un tenant real, no solo Javier, podría escribir cualquier cosa en esta
 * caja.
 */
const PREGUNTAS = [
  '¿Cuánto llevo comprobado?',
  '¿Cuántos viajes tengo con diferencia?',
  '¿Cuánto diésel es elegible para el estímulo?',
  '¿Cuál es mi tasa de cuadre?',
];

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-10 y G-25. Dos cosas que este chat no podía decir:
//
//  · DE QUÉ PERIODO habla. Decía "este periodo" sobre cifras que el rail traía
//    sin ventana (el histórico completo), mientras la tarjeta de al lado
//    mostraba 7 días bajo la MISMA cita de LIVA. Ahora el periodo llega con
//    los datos y se nombra tal cual ("los últimos 7 días").
//
//  · QUE NO PUDO LEER. `null` significaba tres cosas —no hay datos, no se pudo
//    leer, tu rol no ve el dinero— y las tres contestaban «Todavía no hay
//    liquidaciones» a un contralor con 40 cerradas. Es la peor de las tres
//    lecturas: una afirmación falsa sobre su negocio, dicha con aplomo.
// ═══════════════════════════════════════════════════════════════════════════

/** Por qué no hay cifras, cuando no las hay. */
export type MotivoSinDatos = 'error' | 'sin-permiso' | 'vacio';

const SIN_DATOS: Record<MotivoSinDatos, string> = {
  error: 'No pude leer tus liquidaciones ahora mismo. Eso NO quiere decir que no haya: vuelve a preguntarme en un momento.',
  'sin-permiso': 'Tu usuario no tiene acceso a las cifras de dinero de la flota.',
  vacio: 'Todavía no hay liquidaciones para calcular esto.',
};

/** Exportada para poder probarla: es donde vive la única regla de este
 *  componente —qué se puede afirmar y qué no— y desde el componente entero no
 *  se alcanza sin simular un clic. */
export function responder(
  pregunta: string,
  kpis: DashboardKpis | null,
  acred: Acreditables | null,
  periodo: string,
  motivo: MotivoSinDatos,
): string {
  const q = pregunta.toLowerCase();
  const nada = SIN_DATOS[motivo];
  if (q.includes('comprobad') || q.includes('monto')) {
    return kpis ? `Llevas ${mxn(kpis.montoComprobado)} comprobados en ${kpis.viajesLiquidados} viaje${kpis.viajesLiquidados === 1 ? '' : 's'} (${periodo}).` : nada;
  }
  if (q.includes('diferencia') || q.includes('revisar')) {
    return kpis ? `${kpis.conDiferencias + kpis.porRevisar} liquidaciones tienen diferencia o están por revisar, de ${kpis.viajesLiquidados} en total (${periodo}).` : nada;
  }
  if (q.includes('diesel') || q.includes('diésel') || q.includes('litro')) {
    return acred ? `${litros(acred.litrosDiesel)} elegibles para el estímulo en ${periodo} (LIF 2026, Art. 20-A).` : nada;
  }
  if (q.includes('tasa') || q.includes('cuadre') || q.includes('cuadra')) {
    return kpis ? `Tu tasa de cuadre es ${kpis.tasaCuadre}% — liquidaciones sin diferencias sobre el total de ${periodo}.` : nada;
  }
  if (q.includes('iva')) {
    return acred ? `${mxn(acred.iva)} de IVA acreditable en ${periodo} (LIVA, Art. 5).` : nada;
  }
  if (q.includes('peaje') || q.includes('caseta')) {
    return acred ? `${mxn(acred.peaje)} de peaje acreditable (50%) en ${periodo}.` : nada;
  }
  return 'Todavía no sé responder eso — pregúntame sobre lo comprobado, diferencias, diésel, IVA, peaje o tu tasa de cuadre.';
}

export default function ChatFlota({
  kpis, acred, periodo = 'todo el histórico', motivo = 'vacio', compacto = false,
}: {
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
  /** El periodo del que hablan las cifras, tal como se nombra en pantalla. */
  periodo?: string;
  /** Por qué vienen en `null`, cuando vienen en `null`. */
  motivo?: MotivoSinDatos;
  compacto?: boolean;
}) {
  const [historial, setHistorial] = useState<Array<{ q: string; a: string }>>([]);
  const [texto, setTexto] = useState('');

  function preguntar(q: string) {
    if (!q.trim()) return;
    setHistorial((h) => [...h, { q, a: responder(q, kpis, acred, periodo, motivo) }]);
    setTexto('');
  }

  const historialView = historial.length > 0 ? (
    <div className="space-y-3">
      {historial.map((h, i) => (
        <div key={i} className="text-sm">
          <div className="font-medium">{h.q}</div>
          <div style={{ color: 'var(--muted)' }}>{h.a}</div>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-sm" style={{ color: 'var(--muted)' }}>
      Pregúntame sobre lo comprobado, diferencias, diésel, IVA o peaje.
    </p>
  );

  const pie = (
    <>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(compacto ? PREGUNTAS.slice(0, 2) : PREGUNTAS).map((p) => (
          <button key={p} type="button" onClick={() => preguntar(p)}
            className="text-xs px-2.5 py-1.5 rounded-full hairline hover:opacity-70 text-left transition-opacity">
            {p}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} className="flex items-center gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Pregunta algo…"
          className="flex-1 min-w-0 text-sm px-3 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
        <button type="submit" aria-label="Enviar"
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-opacity hover:opacity-85"
          style={{ background: 'var(--marca)', color: 'white' }}>
          <Send width={15} height={15} strokeWidth={2} />
        </button>
      </form>
    </>
  );

  if (compacto) {
    return (
      <div>
        {historial.length > 0 && <div className="mb-3 max-h-56 overflow-y-auto">{historialView}</div>}
        {pie}
      </div>
    );
  }

  return (
    <div className="glass-panel p-6 h-full flex flex-col overflow-hidden">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-4 shrink-0" style={{ color: 'var(--muted)' }}>
        Pregunta a tus datos
      </h2>
      <div className="flex-1 min-h-0 overflow-y-auto">{historialView}</div>
      <div className="shrink-0 pt-4">{pie}</div>
    </div>
  );
}
