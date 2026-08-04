'use client';

import { useState, useRef, useEffect } from 'react';
import { mxn } from '@/lib/formato';

export interface Comprobante {
  concepto: string;
  monto: number;
  folio?: string;
  cfdiUuid?: string;
  rfcReceptor?: string;
  /** Lo que dice el BOTÓN. Es de la interfaz del demo, no del dominio. */
  label: string;
  /**
   * Cómo se llama el gasto EN LA CONVERSACIÓN — la etiqueta del motor
   * (`etiquetaConcepto`), la misma que sale en las notas del cuadre y en el
   * PDF. Llega calculada desde el servidor (`presets.ts`): el motor importa
   * `intake/cfdi.ts`, que arrastra `sharp` y `node:fs`, así que no puede
   * entrar en un bundle de cliente.
   */
  etiqueta: string;
}

interface Bubble { from: 'op' | 'cuadra'; text: string }

/**
 * La burbuja de acuse, con el gasto llamado por su nombre.
 *
 * Decía `Recibí tu ${c.concepto}` — la CLAVE CRUDA de `ConceptoGasto` — y dos
 * burbujas después, en la nota del motor, el mismo gasto aparecía como
 * «Combustible de $4,200.00 excede el tope de política…». Dos nombres para el
 * mismo comprobante en la misma conversación se leen como dos sistemas, y
 * «diesel» sin acento y en minúscula se lee como un campo de base de datos que
 * se escapó a la interfaz (auditoría 10, frontend, MEDIO).
 *
 * `/demo` era la única superficie del producto sin etiqueta de concepto: el
 * panel de detalle delega en el motor y el PDF también.
 *
 * Se exporta para poder EJECUTARLA en una prueba: la conversación no se puede
 * pulsar sin un DOM, y leer el texto fuente no sirve.
 */
export function acuse(c: Comprobante): string {
  // En minúscula porque va a media frase («Recibí tu combustible de …»); es la
  // MISMA etiqueta, no otra: `etiquetaConcepto` la entrega capitalizada porque
  // en sus notas abre renglón.
  const nombre = c.etiqueta.toLocaleLowerCase('es-MX');
  const qr = c.cfdiUuid ? ' (CFDI validado por QR ✅)' : '';
  return `Recibí tu ${nombre} de ${mxn(c.monto)}${qr}. ¿Tienes más o ya cerramos?`;
}

export default function Simulador({ presets, anticipo }: { presets: Comprobante[]; anticipo: number }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { from: 'cuadra', text: `¡Hola! Soy Likida. Ya casi cierras tu viaje Silao → Laredo (anticipo ${mxn(anticipo)}). Mándame las fotos de tus comprobantes.` },
  ]);
  const [added, setAdded] = useState<Comprobante[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje cuando entra una burbuja nueva. ME-16.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  const add = (c: Comprobante) => {
    setAdded((a) => [...a, c]);
    setBubbles((b) => [
      ...b,
      { from: 'op', text: `📎 ${c.label}` },
      { from: 'cuadra', text: acuse(c) },
    ]);
  };

  const cerrar = async () => {
    setLoading(true);
    setBubbles((b) => [...b, { from: 'op', text: 'Ya no tengo más, ciérralo' }]);
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobantes: added, anticipo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      const lines: string[] = [
        `Listo, cuadré tu viaje 👇`,
        `• Comprobado: ${mxn(r.totalComprobado)}`,
        `• Anticipo: ${mxn(r.totalAnticipo)}`,
        r.diferencia > 0 ? `• Sobró ${mxn(r.diferencia)} (a favor de la empresa)` : r.diferencia < 0 ? `• Pusiste ${mxn(-r.diferencia)} de tu bolsa` : `• Cuadra exacto ✅`,
      ];
      const obs = r.diferencias.filter((d: { tipo: string }) => d.tipo !== 'anticipo');
      setBubbles((b) => [...b, { from: 'cuadra', text: lines.join('\n') }]);
      if (obs.length) {
        setBubbles((b) => [...b, { from: 'cuadra', text: 'Ojo con esto:\n' + obs.map((d: { nota: string }) => `• ${d.nota}`).join('\n') }]);
      }
      setBubbles((b) => [...b, { from: 'cuadra', text: '📄 Te mando tu liquidación en PDF. ¡Buen viaje! 🚛' }]);
    } catch {
      // ME-16: si el cuadre falla (red/servidor), avisar en vez de colgar el demo.
      setBubbles((b) => [...b, { from: 'cuadra', text: 'Uy, no pude cerrar el cuadre ahorita. Inténtalo de nuevo en un momento.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-10 px-4">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Demo — Likida por WhatsApp</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Simula al operador mandando sus comprobantes. El cuadre es real.</p>
      </div>

      {/* Teléfono */}
      <div className="w-full max-w-sm card overflow-hidden flex flex-col" style={{ height: 560 }}>
        <div className="glass px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--line)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>L</div>
          <div>
            <div className="text-sm font-medium">Likida</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>en línea</div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: 'color-mix(in srgb, var(--muted) 6%, transparent)' }}>
          {bubbles.map((b, i) => (
            <div key={i} className={`flex ${b.from === 'op' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line"
                style={b.from === 'op'
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderBottomRightRadius: 4 }
                  : { background: 'var(--surface)', border: '1px solid var(--line)', borderBottomLeftRadius: 4 }}>
                {b.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div className="w-full max-w-sm mt-4 flex flex-wrap gap-2 justify-center">
        {presets.map((p, i) => (
          <button key={i} onClick={() => add(p)}
            className="text-xs px-3 py-1.5 rounded-full hairline hover:opacity-70">{p.label}</button>
        ))}
      </div>
      <button onClick={cerrar} disabled={loading || !added.length}
        className="mt-4 px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
        {loading ? 'Cuadrando…' : 'Ya no tengo más — cerrar liquidación'}
      </button>
    </div>
  );
}
