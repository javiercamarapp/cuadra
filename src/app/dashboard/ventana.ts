// ═══════════════════════════════════════════════════════════════════════════
// LA VENTANA DE TIEMPO DEL PANEL — resuelta UNA vez, para que el rail y la
// página hablen del mismo periodo.
//
// AUDITORÍA 11 · G-10. `/dashboard` resolvía su rango a mano y el handler del
// rail (`/api/dashboard/asistente`) consultaba sin ventana ninguna. En la
// misma pantalla, con la misma cita de LIVA al pie, la tarjeta decía $774.48
// (7 días) y el rail contestaba $4,120.00 "este periodo" (todo el histórico).
// El contralor no tiene forma de saber cuál de las dos es la de su corte.
//
// `null` significa histórico A PROPÓSITO, y por eso el parámetro de
// `getKpis`/`getAcreditables` es obligatorio: omitirlo era la forma silenciosa
// de traer "de siempre" bajo un rótulo de periodo.
// ═══════════════════════════════════════════════════════════════════════════

export type Rango = '7' | '30' | 'todo';

/** El rango que /dashboard asume cuando la URL no trae `?rango=`. Es el mismo
 *  que el `pordefecto` del `GlobalFilter` de esa pantalla — si los dos se
 *  separan, el clic en el pill no hace nada (G-12, `filtro_rango.test.tsx`). */
export const RANGO_POR_DEFECTO: Rango = '7';

export interface Ventana {
  rango: Rango;
  /** Días de la ventana; para 'todo' son los 30 que pinta la gráfica de barras. */
  ventanaDias: number;
  /** Lo que se le pasa a `getKpis`/`getAcreditables`: días, o `null` = histórico. */
  ventana: number | null;
  /** Cómo se dice en pantalla. Un rótulo tiene que ser verdad. */
  etiqueta: string;
}

export function resolverVentana(crudo: string | null | undefined, pordefecto: Rango = RANGO_POR_DEFECTO): Ventana {
  const rango: Rango = crudo === '7' ? '7' : crudo === '30' ? '30' : crudo === 'todo' ? 'todo' : pordefecto;
  const ventanaDias = rango === '30' ? 30 : rango === 'todo' ? 30 : 7;
  return {
    rango,
    ventanaDias,
    ventana: rango === 'todo' ? null : ventanaDias,
    etiqueta: rango === 'todo' ? 'todo el histórico' : `los últimos ${ventanaDias} días`,
  };
}
