import type { Estado } from '../../admin/ui/kit';
import type { EstadoSat } from '@/lib/cuadra/intake/sat';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ DICE EL SAT DE ESTE COMPROBANTE — los cuatro estados, no dos.
//
// AUDITORÍA 11 · G-15. Vivía dentro de `page.tsx` y traducía `vigente` y
// `cancelado`; los otros dos caían en un `if (d.estadoSat) return { label:
// d.estadoSat, estado: 'warn' }` que pintaba LA CLAVE CRUDA en ámbar.
//
// `no_encontrado` es el peor veredicto que puede dar la validación —el CFDI
// no existe en el SAT, misma cubeta de no deducible que `cancelado`— y salía
// en amarillo, escrito «no_encontrado», al lado de un «Cancelado» en rojo por
// la misma consecuencia fiscal.
//
// Se saca del archivo de la página para poder EJECUTARLO en una prueba, que
// es la única forma de exigir exhaustividad contra la unión de tipos.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que la tarjeta necesita del comprobante — no la fila entera, para que la
 *  prueba no tenga que fabricar un `DocumentoRow` completo. */
export interface ComprobanteSat {
  cfdiUuid: string | null;
  estadoSat: string | null;
  efos: boolean | null;
}

/** Exhaustivo por tipo: agregar un estado a `EstadoSat` sin etiquetarlo aquí
 *  no compila. Ese es el guardarraíl que le faltaba al mapa anterior. */
const SAT: Record<EstadoSat, { label: string; estado: Estado }> = {
  vigente: { label: 'Vigente', estado: 'ok' },
  cancelado: { label: 'Cancelado', estado: 'bad' },
  // No es "atención": es no deducible. El CFDI no está en el SAT.
  no_encontrado: { label: 'No encontrado en el SAT', estado: 'bad' },
  pendiente: { label: 'Verificación pendiente', estado: 'warn' },
};

/**
 * `null` en `cfdiUuid` = no hay CFDI que validar (un ticket de papel sin
 * factura), que NO es lo mismo que "no válido": pintarlos igual haría ver como
 * problema lo que es normal.
 */
export function estadoSat(d: ComprobanteSat): { label: string; estado: Estado } {
  if (d.efos) return { label: 'Emisor en lista EFOS', estado: 'bad' };
  if (!d.cfdiUuid) return { label: 'Sin CFDI', estado: 'neutral' };
  if (!d.estadoSat) return { label: 'Sin verificar', estado: 'warn' };
  // Un valor que el tipo no contempla (una migración futura, una fila vieja)
  // no se traduce a la brava: se dice que no se sabe.
  return SAT[d.estadoSat as EstadoSat] ?? { label: 'Sin verificar', estado: 'warn' };
}
