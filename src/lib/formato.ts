// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA. UNA SOLA VEZ, PARA TODO EL PRODUCTO.
//
// POR QUÉ ESTE ARCHIVO EXISTE Y NO ESTÁ EN `utils.ts`, QUE ERA LO OBVIO:
// `utils.ts` importa `clsx` y `tailwind-merge` para `cn()`, que son librerías de
// CSS del panel. El motor del cuadre (`engine.ts`) es puro y sin I/O, y el PDF
// viaja en el bundle de la función del webhook: ninguno de los dos tiene por qué
// arrastrar el sistema de clases de Tailwind para escribir "$1,234.56".
//
// Hoy el tree-shaking de Next lo salva —se midió sobre el `.nft.json` del
// webhook y `clsx` no entra—, pero eso depende de que nadie añada un
// side-effect a `utils.ts`. Un archivo sin una sola importación no depende de la
// suerte. `utils.ts` reexporta de aquí para no romper al panel.
//
// ── EL HALLAZGO QUE CIERRA, Y VA POR SU TERCERA RONDA ──────────────────────
//
// `mxn()` estaba escrita A MANO en el producto, y el número CRECÍA entre rondas:
//
//     ronda 6 →  3 sitios
//     ronda 7 →  8 sitios
//     hoy     → 11 sitios  (7 de moneda + los de litros)
//
// Siete copias idénticas de la misma línea, cada una en un archivo que imprime
// dinero que el contralor lee: el PDF, el resumen de WhatsApp, el panel, el
// aviso del tope del 15%, los acreditables y el motor. Que sean idénticas HOY no
// es una defensa: el hallazgo gemelo de `litros()` ya se divergió una vez, y ahí
// el panel decía "1,235 L" donde el PDF decía "1,234.56 L".
//
// Una cifra fiscal que se lee distinta en dos pantallas se lee como dos
// cálculos distintos.
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente: la flota, el contralor y el SAT están todos aquí. */
export const TZ_MX = 'America/Mexico_City';

/**
 * Redondea a dos decimales (centavos) sin creerle a la coma flotante.
 *
 * AUDITORÍA 9, ALTO REINCIDENTE (arquitectura) — reimplementado a mano en
 * CUATRO archivos de dinero (`engine.ts`, `analytics.ts`, `pagadero.ts`,
 * `combustible.ts`), los cuatro con `Math.round(n * 100) / 100` y el mismo
 * bug: `round2(1.005)` daba `1`, no `1.01`. `1.005` no es representable
 * exacto en punto flotante —se guarda como `1.00499999999999989…`— y
 * `Math.round(100.4999…)` cae para abajo.
 *
 * ── AUDITORÍA 10, ALTO: EL PRIMER ARREGLO ERA UN NO-OP ─────────────────────
 *
 * La ronda 9 cerró la duplicación (cuatro copias → esta) y lo arregló con
 * `Math.abs(n) + Number.EPSILON` antes de multiplicar. `Number.EPSILON` es
 * 2.22e-16 y es ABSOLUTO: es el ULP del 1, no el de `n`. El ULP de un double
 * crece con la magnitud, así que a partir de |n| ≈ 2 sumarlo no mueve un solo
 * bit. Barrido de 3 000 000 de valores en [0, 100000): CERO divergencias
 * contra el `Math.round(n*100)/100` que decía sustituir. El caso motivador de
 * la ronda 9 —`round2(1000.55 * 0.30)`, el tope del 30% del art. 110-I LFT—
 * seguía dando 300.16 en vez de 300.17, dos rondas después, con un test verde
 * encima escrito sobre valores menores a $2 (los únicos donde el épsilon se
 * nota) mientras el importe más chico de este producto es una caseta de $150.
 *
 * LA CAUSA REAL no es la falta de un empujón: es que `n * 100` VUELVE A
 * REDONDEAR. `1000.55 * 0.30` ya vale 300.16499999999996 (el double más
 * cercano a 300.165), y multiplicarlo por 100 en binario da
 * 30016.499999999996, que cae para abajo con toda razón. Ningún épsilon
 * arregla eso sin romper otra cosa.
 *
 * LO QUE SÍ FUNCIONA: no multiplicar. `toExponential(14)` da los 15 dígitos
 * significativos del valor —los que un double representa de verdad—, que es
 * donde el ruido de representación (…99996) ya colapsó a …5. Correr el punto
 * decimal dos lugares se hace SOBRE ESE TEXTO, y `Number()` lo parsea con
 * redondeo correcto: `Number('3.00165000000000e+4')` es exactamente 30016.5, y
 * de ahí `Math.round` sube. La vuelta (`Number('30017e-2')`) es la misma
 * operación al revés.
 *
 * El signo se separa antes: se redondea sobre el valor absoluto y se restaura
 * al final, para que el medio centavo se vaya SIEMPRE hacia afuera del cero
 * (−1.005 → −1.01, no −1.00), que es como se lee una nota de descuento.
 */
export function round2(n: number): number {
  // `Infinity`/`NaN` no tienen forma decimal: `Number('Infinitye+2')` es NaN.
  // Un no-número entra y sale igual; inventarle un 0 sería peor.
  if (!Number.isFinite(n)) return n;
  const signo = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  // A partir de 2^53 un double ya no tiene decimales que redondear, y la
  // notación exponencial de `Math.round` rompería la concatenación de abajo.
  // No hay dinero de este producto ahí arriba, pero el número entra igual.
  if (abs >= 1e15) return n;
  const [mantisa, exp] = abs.toExponential(14).split('e');
  const centavos = Math.round(Number(`${mantisa}e${Number(exp) + 2}`));
  return signo * Number(`${centavos}e-2`);
}

/** Pesos mexicanos como los espera un contador: `$1,234.56`. */
export function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Dólares, para el costo interno de los modelos — nunca para el cliente. */
export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Un entero con separador de millares, sin moneda ni unidad — tokens, conteos. */
export function numero(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * Litros con separador de millares y hasta dos decimales, sin rellenar ceros.
 *
 * El motor redondea a dos decimales, así que el tope no puede recortar
 * información: solo evita que un `1234.5600000001` de coma flotante salga con
 * tres cifras donde el papel enseña dos.
 */
export function litros(n: number): string {
  return `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;
}

/**
 * Fecha en hora de México: `31 jul 2026`.
 *
 * Devuelve `—` ante una fecha ausente o ilegible en vez de `Invalid Date`: una
 * celda vacía es más honesta que una cadena de error en la columna que el
 * contralor usa para ordenar su corte.
 *
 * La zona es explícita porque `.slice(0,10)` sobre un `timestamptz` se queda con
 * la fecha UTC, y CST es UTC−6: todo lo cerrado después de las 18:00 hora local
 * salía fechado al día siguiente. Las liquidaciones se cierran de noche, al
 * terminar el viaje, así que en el corte mensual una del 31 de julio aparecía en
 * agosto.
 */
export function fechaMx(iso?: string | null): string {
  if (!iso) return '—';

  // UNA FECHA SIN HORA NO TIENE ZONA, Y CONVERTIRLA LA CORRE UN DÍA.
  //
  // `gasto.fecha` es `date` en Postgres y llega como '2026-07-15'. `new Date()`
  // lo interpreta como MEDIANOCHE UTC, y al formatearlo en America/Mexico_City
  // (UTC−6) sale «14 jul». TODAS las fechas del PDF salían un día antes.
  //
  // Se vio en el primer PDF real (1-ago-2026), y el propio documento se
  // contradecía: la tabla decía «18 jun 2026» y la línea de diferencias, tres
  // párrafos abajo, «(2026-06-19)». El ticket del Costco es del 1 de julio y
  // aparecía como «30 jun» — otro mes, otro periodo fiscal.
  //
  // La ironía: esta función nació para arreglar el problema INVERSO. Un
  // `.slice(0,10)` sobre un `timestamptz` se quedaba con la fecha UTC y los
  // cierres nocturnos salían fechados al día siguiente. Aquello se arregló
  // poniendo la zona, y esa misma zona rompió el caso sin hora.
  //
  // Un valor de solo fecha es un día del calendario, no un instante: tiene que
  // imprimirse tal cual está escrito. Se formatea en UTC —la zona en la que se
  // construyó— para que no se mueva.
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  const d = soloFecha ? new Date(`${iso.trim()}T00:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: soloFecha ? 'UTC' : TZ_MX,
  });
}
