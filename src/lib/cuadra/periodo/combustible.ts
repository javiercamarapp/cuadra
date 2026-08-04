// ═══════════════════════════════════════════════════════════════════════════
// EL 15% DE COMBUSTIBLE EN EFECTIVO — un tope del EJERCICIO, no del viaje.
//
// `engine.ts` es puro y evalúa UN viaje, así que marcaba el diésel en efectivo
// como "por confirmar" a ciegas: sin saber si la flota va por el 3% del
// ejercicio —tranquila— o por el 14.8% —a punto de perder la deducción de todo
// lo que pague en efectivo el resto del año—. Es la misma información con dos
// valores completamente distintos para quien decide.
//
// RFA 2026 regla 2.9 (`normas/rfa-2026-2.9.yaml`, verificado_fuente_primaria):
// los pagos en efectivo por combustible valen "siempre que estos no excedan el
// 15 por ciento del total de los pagos efectuados por consumo de combustible
// para realizar su actividad".
//
// LA BASE ES COMBUSTIBLE CONTRA COMBUSTIBLE. No el gasto total de la flota, no
// las erogaciones totales, no un monto fijo por ticket. Ese denominador
// equivocado es el error que haría parecer holgada a una flota que ya se pasó.
//
// Especificación completa y sus huecos: `docs/fase1/spec-contadores-periodo.md`.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '@/lib/formato';

/** El tope de la facilidad. Es ley (bueno, RFA): no se toca sin cambiar la ficha. */
export const TOPE_EFECTIVO = 0.15;

/**
 * LOS MEDIOS QUE **NO** CUENTAN CONTRA EL TOPE — la lista cerrada del 2º párrafo
 * de LISR 27-III, que es a la que la RFA 2026 regla 2.9 le pone la válvula.
 *
 * La regla no dice «efectivo». Dice «cuando los pagos por consumo de combustible
 * se realicen con medios DISTINTOS a cheque nominativo…; tarjeta de crédito, de
 * débito o de servicios; o monederos electrónicos autorizados por el SAT». Es
 * una lista de lo que SÍ cumple, y los otros treinta códigos de `c_FormaPago`
 * caen dentro del tope, no fuera de él.
 *
 * ── POR QUÉ ESTÁ ESCRITA DOS VECES ─────────────────────────────────────────
 * `cuadre/engine.ts` la declara con este mismo nombre para el veredicto POR
 * VIAJE y no la exporta. Que las dos se separen es exactamente el modo de fallo
 * que la auditoría 11 (G-04) encontró —el motor contaba una cosa y el contador
 * del ejercicio otra—, así que `tope15_numerador_y_margen.test.ts` lee el
 * fuente del motor y falla si dejan de coincidir. Mismo mecanismo con el que
 * `presupuesto.test.ts` sincroniza `TECHO_ENVIO_META_MS` con `meta/client.ts`.
 */
export const MEDIOS_LISR_27_III: readonly string[] = [
  '02', // cheque nominativo de la cuenta del contribuyente
  '03', // transferencia electrónica de fondos
  '04', // tarjeta de crédito
  '05', // monedero electrónico autorizado por el SAT
  '28', // tarjeta de débito
  '29', // tarjeta de servicios
];

/**
 * ¿Este pago de combustible cuenta contra el 15% del ejercicio?
 *
 * AUDITORÍA 11, ALTO (G-04). El numerador era `forma_pago === '01'`, o sea solo
 * el efectivo. Una flota que carga diésel a crédito en la estación factura con
 * `MetodoPago = PPD`, y ese CFDI lleva `FormaPago 99` (Por definir) por
 * obligación: $200,000 así contra $800,000 de transferencia son el 20% del tope
 * y el contador decía `holgado`, con el aviso en `null`. En silencio, sobre la
 * cifra que decide si la flota pierde la deducción del resto del ejercicio.
 *
 * SIN forma de pago no se cuenta, igual que el motor: un dato ausente no es un
 * incumplimiento, y suponerlo inflaría el numerador contra la flota.
 */
export function cuentaContraTope15(formaPago: string | null | undefined): boolean {
  return !!formaPago && !MEDIOS_LISR_27_III.includes(formaPago);
}

/**
 * Cuándo avisar. DECISIÓN DE PRODUCTO, no regla legal — por eso vive aparte del
 * tope y se llama distinto.
 *
 * Avisar al 15% no sirve de nada: para entonces la deducción ya se perdió. El
 * valor del contador está en el aviso temprano, que es lo único que le permite
 * al contralor cambiar de medio de pago a tiempo.
 */
export const UMBRAL_ALERTA = 0.12;

export type EstadoTope =
  /** Lejos del tope. */
  | 'holgado'
  /** Pasó el umbral de aviso pero no el tope legal. Todavía se puede corregir. */
  | 'cerca'
  /** Se pasó del 15%: el excedente ya no es deducible. */
  | 'excedido'
  /** No se puede evaluar con los datos que hay. NO se afirma nada. */
  | 'sin_criterio';

export interface ResultadoTope15 {
  /** Efectivo / total de combustible del ejercicio. 0 si no hay base. */
  razon: number;
  estado: EstadoTope;
  /**
   * Cuánto efectivo pasa del 15%. Es el excedente AGREGADO del ejercicio, no un
   * comprobante concreto: cuál pago específico "es" el excedente no lo resuelve
   * ninguna fuente, y por eso va a la bandeja del contralor en vez de decidirse
   * por default (ver `sin_criterio` en la spec).
   */
  excedente: number;
  /**
   * Cuánto MÁS se puede pagar así sin pasarse. Es lo accionable: no "vas al
   * 12%", sino "te quedan $35,294.12 este año".
   *
   * AUDITORÍA 11, ALTO (G-04) — ESTABA MAL DESPEJADO. Era `permitido − efectivo`,
   * que contesta «cuánto le falta al efectivo de HOY para llegar al 15% del
   * total de HOY». Esa no es la pregunta: el peso que se pague de más entra en
   * los DOS lados de la razón, porque también es combustible.
   *
   *     (e + x) / (t + x) ≤ 0.15   ⇒   x ≤ (0.15·t − e) / 0.85
   *
   * Con $1,000,000 de combustible y $120,000 fuera de la lista salían
   * $30,000.00 donde caben $35,294.12: 17.6% menos, en pesos, sobre lo que el
   * aviso presenta como lo accionable — y a la baja, que es la dirección que el
   * contralor no revisa porque no le cuesta dinero hoy.
   */
  margen: number;
}

/**
 * @param efectivo         pagos de combustible del ejercicio hechos con un medio
 *                         FUERA de `MEDIOS_LISR_27_III` — el efectivo entre
 *                         ellos, y también el `99` de la carga a crédito. El
 *                         campo se sigue llamando así porque es el caso típico
 *                         y porque renombrarlo movería la interfaz del contador
 *                         entero; lo que cuenta lo decide `cuentaContraTope15`.
 * @param totalCombustible TODOS los pagos de combustible del ejercicio.
 */
export function evaluarTope15(acumulado: { efectivo: number; totalCombustible: number }): ResultadoTope15 {
  const efectivo = Math.max(0, acumulado.efectivo || 0);
  const total = Math.max(0, acumulado.totalCombustible || 0);

  // Sin denominador no hay razón que calcular. Dividir por cero daría NaN o
  // Infinity, y eso acabaría impreso en un PDF que alguien archiva.
  if (total <= 0) {
    // Efectivo sin total es un dato inconsistente: no se afirma nada.
    return { razon: 0, estado: efectivo > 0 ? 'sin_criterio' : 'holgado', excedente: 0, margen: 0 };
  }

  const razon = efectivo / total;
  const permitido = total * TOPE_EFECTIVO;

  return {
    razon,
    estado: razon > TOPE_EFECTIVO ? 'excedido' : razon >= UMBRAL_ALERTA ? 'cerca' : 'holgado',
    // "Rebasar el 15% no reduce proporcionalmente la deducción: tira el
    // excedente completo" — no el acumulado entero ni el gasto que lo cruzó.
    excedente: round2(Math.max(0, efectivo - permitido)),
    // El excedente mira hacia atrás (sobre el total ya gastado) y el margen
    // hacia adelante (sobre el total que habrá si se gasta). Por eso uno lleva
    // el `/ (1 − 0.15)` y el otro no.
    //
    // Y se TRUNCA a centavos en vez de redondearse —el único sitio del módulo
    // que no usa `round2`—: el margen es una cifra que autoriza a gastar, y
    // redondear hacia arriba le concede a la flota un centavo que la deja
    // ENCIMA del tope. Con $1,000,000 y $120,000 el corte real está en
    // $35,294.1176: redondeado son $35,294.12, que ya excede. La dirección del
    // error importa, y ésta es la barata.
    margen: Math.max(0, Math.floor(((permitido - efectivo) / (1 - TOPE_EFECTIVO)) * 100) / 100),
  };
}
