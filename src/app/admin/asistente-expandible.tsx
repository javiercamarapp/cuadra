'use client';

import { useState } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import ChatNegocio from './chat';
import type { ResumenNegocio } from '@/lib/admin/negocio';

export const ANCHO_ASIDE = 276;
const GAP = 16;
/**
 * Lo que el panel del Asistente le quita a la columna de contenido: su ancho
 * más el gap. Solo desde `xl` (1280px), que es donde el `<aside hidden xl:flex>`
 * empieza a existir — ver la clase de abajo.
 */
export const HUECO_ASIDE = ANCHO_ASIDE + GAP; // 292
const DURACION = '480ms cubic-bezier(0.22, 1, 0.36, 1)'; // easeOutQuint — la misma curva "premium" que usan los paneles de macOS/iOS al expandirse

/**
 * Envuelve `main` (las gráficas centrales) y el panel del Asistente —
 * ambos ya renderizados en el servidor, se pasan como children/props, no
 * se reconstruyen aquí. Solo esto necesita ser cliente: el botón de
 * expandir. Al expandir, el centro se encoge a 0 (con fade) y el
 * Asistente crece a todo el ancho, mostrando el chat COMPLETO
 * (`compacto={false}`) en vez de la versión chica pegada abajo.
 */
export default function AsistenteExpandible({
  main, asideTop, resumen,
}: {
  main: React.ReactNode;
  asideTop: React.ReactNode;
  resumen: ResumenNegocio;
}) {
  const [expandido, setExpandido] = useState(false);

  return (
    <div className="flex items-start relative" style={{ gap: expandido ? 0 : GAP, transition: `gap ${DURACION}` }}>
      {/* EL ANCHO VA EN CLASES, NO EN UN `style` EN LÍNEA, porque el hueco que
          descuenta solo existe a partir de `xl`.
          Esto era `width: calc(100% - 292px)` en línea, sin condición de
          breakpoint, mientras el `<aside>` de al lado es `hidden xl:flex`. Por
          debajo de 1280px —un proyector de 1152×864, el navegador sin
          maximizar en un portátil de 1366— el aside pasaba a `display:none` y
          la columna seguía midiendo 292px menos: el contenido se encogía al
          ~68% y quedaba una franja de fondo difuminado con nada encima
          (auditoría 10, frontend, MEDIO).
          `w-full` por debajo de xl, el descuento solo desde xl. La clase es
          estática para que Tailwind la genere, y `columna_muerta.test.tsx`
          comprueba que su número siga siendo `ANCHO_ASIDE + GAP`. */}
      <div
        className={expandido ? 'w-0 min-w-0 overflow-hidden' : 'w-full xl:w-[calc(100%-292px)] min-w-0 overflow-hidden'}
        style={{
          opacity: expandido ? 0 : 1,
          transition: `width ${DURACION}, opacity 250ms ease`,
        }}
      >
        {main}
      </div>

      <aside
        className="glass-panel shrink-0 hidden xl:flex flex-col sticky top-0 self-start h-[calc(100dvh-2rem)]"
        style={{ width: expandido ? '100%' : ANCHO_ASIDE, transition: `width ${DURACION}` }}
      >
        <div className="flex items-center gap-2 px-4 pt-4 shrink-0">
          <Sparkles width={15} height={15} strokeWidth={1.75} />
          <span className="font-semibold text-sm">Asistente de negocio</span>
          <button type="button" onClick={() => setExpandido((v) => !v)}
            aria-label={expandido ? 'Contraer chat' : 'Expandir chat a pantalla completa'}
            className="ml-auto w-7 h-7 rounded-lg hairline flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ background: 'var(--surface)' }}>
            {expandido
              ? <Minimize2 width={13} height={13} strokeWidth={1.75} />
              : <Maximize2 width={13} height={13} strokeWidth={1.75} />}
          </button>
        </div>

        {!expandido && (
          <div className="flex-1 min-w-0 overflow-y-auto px-4 pt-2 space-y-4">
            {asideTop}
          </div>
        )}

        <div className={expandido ? 'flex-1 min-w-0 flex flex-col px-4 pb-4 pt-2 overflow-hidden' : 'shrink-0 px-4 py-3 border-t'}
          style={expandido ? undefined : { borderColor: 'var(--line)' }}>
          {expandido ? (
            <div className="flex-1 min-w-0 overflow-y-auto">
              <ChatNegocio resumen={resumen} />
            </div>
          ) : (
            <ChatNegocio resumen={resumen} compacto />
          )}
        </div>
      </aside>
    </div>
  );
}
