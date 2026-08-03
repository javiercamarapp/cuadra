import type { EstatusLiquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE LEE EL ESTATUS DE UNA LIQUIDACIÓN. UNA SOLA VEZ, PARA LAS TRES
// PANTALLAS QUE LO PINTAN.
//
// MEDIO de la auditoría 10 (arquitectura). Este mapa ya se había desincronizado
// dos veces —`viaticos` partido en tres, y `otro: 'Gasto'` contra `otro: 'Otro'`—
// y por eso existía `etiquetas_sincronizadas.test.ts`. Pero ese guardarraíl
// comparaba DOS ARCHIVOS POR NOMBRE (`dashboard/page.tsx` y
// `dashboard/[id]/page.tsx`), así que la página nueva de esta ronda,
// `/mis-viajes`, añadió una TERCERA copia idéntica justo fuera de su alcance.
//
// EL CAMBIO QUE LO IBA A HACER ESTALLAR, con valores: se agrega un cuarto
// estatus a `types/cuadra.ts` (p. ej. `'en_revision'`). El test fallaba y
// obligaba a actualizar las dos páginas del panel — hacía su trabajo.
// `mis-viajes/page.tsx` pasaba verde y caía a su fallback: el chofer veía la
// columna Estatus con el texto crudo `en_revision`, en gris, en la única
// pantalla web que tiene. El contralor leía «Por revisar» y el chofer una clave
// de base de datos.
//
// El mecanismo que costó tres rondas construir protegía dos de tres
// consumidores y nada avisaba del tercero. Ahora no hay a quién desincronizar:
// el mapa está aquí, tipado `Record<EstatusLiquidacion, …>` para que `tsc` cace
// el estatus nuevo sin etiqueta, y el guardarraíl DESCUBRE a quien declare otro
// en vez de nombrar archivos.
//
// Vive en `src/app/dashboard/` y no en `lib/`: el color es una variable CSS del
// panel, no un dato del dominio. `/mis-viajes` ya importaba de aquí (`fechaMx`
// de `../dashboard/formato`), así que no estrena dependencia.
// ═══════════════════════════════════════════════════════════════════════════

export interface EtiquetaEstatus {
  label: string;
  color: string;
}

/** Los estatus que el tipo permite, con su etiqueta y su color. Exhaustivo. */
export const ESTATUS: Record<EstatusLiquidacion, EtiquetaEstatus> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

/**
 * Etiqueta de un estatus leído de la base.
 *
 * Llega como `string` —viene de `liquidacion.estatus`, no del tipo—, así que se
 * acepta `string` y se cae hacia atrás en la clave cruda en gris: un estatus
 * que nadie reconoce se lee como viene, nunca como `undefined`. Ese fallback es
 * la red, no el plan: quien agregue un estatus tiene que etiquetarlo aquí, y
 * `tsc` no lo deja compilar sin hacerlo.
 */
export function etiquetaEstatus(estatus: string): EtiquetaEstatus {
  return ESTATUS[estatus as EstatusLiquidacion] ?? { label: estatus, color: 'var(--muted)' };
}
