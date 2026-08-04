import { mxn } from '@/lib/utils';
import type { FilaDeducibilidad, TonoDeducibilidad } from '@/lib/cuadra/liquidacion/deducibilidad';

/**
 * La tinta de cada cubeta del desglose «De lo comprobado, cuánto es deducible».
 *
 * SE DERIVA DEL TIPO, NO SE REPITE. `Record<TonoDeducibilidad, string>` es lo
 * único que impide que esto vuelva a pasar: un tono nuevo en
 * `deducibilidad.ts` rompe `tsc` aquí en vez de salir en pantalla con la tinta
 * de otra cosa. Es el mismo patrón que `admin/equipo/page.tsx` usa para
 * `RolAppUser`, y hoy era el único mapa del repo que lo hacía.
 *
 * Los cuatro tonos son los del PDF (`liquidacion/pdf.ts:295`), en los tokens
 * que sí pasan AA en pantalla:
 *
 *   bueno        → verde     · «esto sobrevive una revisión»
 *   malo         → rojo      · «esto ya se perdió»
 *   pendiente    → ámbar     · «falta algo del operador; se puede recuperar»
 *   condicionado → tinta     · «el sistema no verifica un requisito legal»
 *
 * `pendiente` y `condicionado` NO comparten color a propósito: el primero le
 * pide algo al operador y el segundo no —confundirlos le pide resolver algo
 * que no puede—, y así lo dice el propio comentario del PDF.
 */
export const TINTA_TONO: Record<TonoDeducibilidad, string> = {
  bueno: 'var(--color-ok)',
  malo: 'var(--color-bad)',
  pendiente: 'var(--color-warn)',
  condicionado: 'var(--ink)',
};

/**
 * Un renglón del desglose de deducibilidad.
 *
 * Vivía dentro de `[id]/page.tsx` con un ternario de DOS ramas
 * (`f.tono === 'malo' ? bad : ink`) para una unión de CUATRO miembros, así que
 * «Por confirmar» —dinero que todavía se puede perder— se pintaba con la misma
 * tinta y el mismo peso que «Deducible para ISR». Lo único que los distinguía
 * en pantalla era el texto de la etiqueta, mientras el PDF del MISMO viaje los
 * pintaba en tres colores distintos; el guion abre las dos cosas en el minuto 6
 * (auditoría 10, frontend, MEDIO reincidente).
 *
 * Se saca a su propio archivo para poder EJECUTARLO en una prueba, igual que
 * `acred.tsx`: el rubro ya documentó que leer el texto fuente no sirve.
 */
export function FilaDeduc({ fila }: { fila: FilaDeducibilidad }) {
  return (
    <div className="px-6 py-4 flex items-start justify-between gap-4">
      <div>
        <div className="text-base font-medium">{fila.label}</div>
        {fila.pie && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{fila.pie}</div>}
      </div>
      <span className="tabular font-semibold whitespace-nowrap" style={{ color: TINTA_TONO[fila.tono] }}>
        {mxn(fila.monto)}
      </span>
    </div>
  );
}
