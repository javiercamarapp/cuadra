// `fechaLarga` SE MUDÓ A `lib/formato.ts` y se reexporta desde aquí para no
// tocar a sus tres consumidores. Formateaba a mano con
// `toLocaleDateString('es-MX')`, que es la segunda declaración del formato
// mexicano que la regla del proyecto prohíbe — y el guardarraíl que lo vigila
// (`dashboard/formato.test.ts`) la cazó en cuanto entró al repo. Auditoría 11.
export { fechaLarga } from './formato';

/**
 * El encabezado "Buenas tardes, Javier · lunes, 3 de agosto de 2026" que
 * abre las DOS consolas (/admin y /dashboard).
 */
export function saludo(fecha: Date = new Date()): string {
  const h = fecha.getUTCHours() - 6; // hora de México, aproximada — un saludo no necesita el minuto exacto
  const hora = ((h % 24) + 24) % 24;
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}


/**
 * La hora del servidor en milisegundos.
 *
 * Existe para que las páginas server no llamen `Date.now()` directo en el
 * render: `react-hooks/purity` lo marca como impuro —con razón para un
 * componente cliente, que puede re-renderizar y dar otro resultado—, pero una
 * página `force-dynamic` se construye una vez por petición y ahí leer el
 * reloj es exactamente lo correcto. Mismo patrón que `saludo()` y
 * `fechaLarga()`, que llevan haciéndolo desde el principio.
 *
 * Lo que NO debe hacer es llamarse desde un componente cliente: ahí la
 * objeción del linter sí aplica.
 */
export function ahoraMs(): number {
  return Date.now();
}
