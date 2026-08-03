// ═══════════════════════════════════════════════════════════════════════════
// LA SECCIÓN "ACREDITABLE / RECUPERABLE", EN RENGLONES LISTOS PARA IMPRIMIR.
//
// Es la sección que vende, y por eso es la que más se puede sobrepromever. Vive
// aquí y no dentro del dibujado del PDF por la misma razón que
// `filasDeducibilidad`: lo que el contralor lee tiene que poder probarse sin
// abrir un PDF.
//
// LA REGLA DE ESTA SECCIÓN: una cifra en el papel con un artículo citado al
// lado es una AFIRMACIÓN. Si el motor no puede sostenerla entera, el renglón
// tiene que decir qué parte no sostiene — en el mismo papel, no en un YAML.
// ═══════════════════════════════════════════════════════════════════════════

import type { Liquidacion } from '@/types/cuadra';
// `litros` va con alias: este archivo tiene una VARIABLE con ese nombre (el
// número de litros) y el import la haría sombra dentro de la función.
import { mxn, litros as fmtLitros } from '@/lib/formato';


/** `bueno` = cifra que el motor sostiene entera. `condicionado` = depende de
 *  algo que el motor NO verifica, y el pie dice de qué. */
export type TonoAcreditable = 'bueno' | 'condicionado';

export interface FilaAcreditable {
  label: string;
  /** Ya formateado: pesos o litros. Quien dibuja no decide la unidad. */
  valor: string;
  tono: TonoAcreditable;
  /** Notas al pie de ESTE renglón. Van pegadas a él, no juntas al final: un pie
   *  que se lee bajo otro renglón dice lo contrario de lo que quiere decir. */
  pies: string[];
}

/**
 * El estímulo de peaje se calcula sobre el SubTotal (sin IVA) de las casetas.
 *
 * `normas/lif-2026-20-A.yaml` dice "hasta en un 50 por ciento del GASTO TOTAL
 * EROGADO por este concepto", y el motor usa la base SIN IVA: ~13.8% menos
 * estímulo del que podría corresponder. Es el hallazgo H4 de la ficha,
 * `severidad: alta`, `estado: SIN RESOLVER` — resolverlo hacia el total podría
 * DUPLICAR el beneficio del IVA, que ya se acredita por separado (LIVA art. 5),
 * así que es una pregunta para un contador y no se resuelve sola aquí.
 *
 * Lo que sí es exigible al papel: decir cuál de las dos bases usó. Sin esa
 * línea, el contralor no puede ni reproducir la cifra ni discutirla.
 */
export const BASE_ESTIMULO_PEAJE =
  'Base usada: el subtotal SIN IVA de las casetas con CFDI verificado. La ley dice "50% del gasto total erogado"; ' +
  'si su contador toma el total con IVA, la cifra sube alrededor de 13.8%.';

/**
 * Las cuatro condiciones de elegibilidad del estímulo de peaje, transcritas de
 * `estimulo_peaje.condiciones` en `normas/lif-2026-20-A.yaml`
 * (`evidencia_corroborante`: su nota admite dos reproducciones del articulado,
 * no el DOF — auditoría 10).
 *
 * El motor no conoce NINGUNA: no sabe los ingresos de la flota, ni si es parte
 * relacionada, ni si la caseta pertenece a la Red Nacional de Autopistas de
 * Cuota — dispara con `concepto === 'caseta'` a secas (hallazgos H5 y H6 de la
 * ficha). Imprimir la cifra en verde y en negritas sin decirlo le entrega el
 * estímulo, con el artículo citado al lado, a una flota con ingresos ≥ $300M o
 * que sea parte relacionada. Y el criterio 1/LIF/PI del Anexo 3 alcanza a
 * "quien preste servicios": esa práctica sería de Likida, no del cliente.
 */
export const CONDICIONES_ESTIMULO_PEAJE =
  'Likida NO verifica la elegibilidad. El estímulo exige las cuatro: dedicarse EXCLUSIVAMENTE al transporte terrestre ' +
  'de carga, pasaje o turismo; que las casetas sean de la Red Nacional de Autopistas de Cuota; ingresos anuales ' +
  'menores a $300 millones; y no ser parte relacionada (LISR art. 179). Confírmelas con su contador.';

/** El estímulo del art. 20 ap. A es ingreso acumulable: el neto es menor. */
export const NOTA_INGRESO_ACUMULABLE =
  'Los estímulos del art. 20 ap. A son ingreso acumulable para ISR: el beneficio neto es menor.';

/**
 * El IEPS de diésel se entrega en LITROS, no en pesos: el estímulo es cuota
 * SEMANAL disminuida × litros y sin el acuerdo del DOF no se puede calcular
 * aquí. Decisión D2 del roadmap.
 */
export const NOTA_LITROS_DIESEL =
  'El estímulo de diésel se calcula con la cuota SEMANAL vigente al momento de cada compra; se entregan los litros ' +
  'para que su contador aplique la cuota fechada.';

/**
 * Lo que condiciona la DEDUCIBILIDAD para ISR de un gasto condiciona también su
 * IVA, porque LIVA 5-I no pone dos requisitos: pone uno solo.
 *
 * `normas/liva-5.yaml` (`verificado_fuente_primaria`), fracción I, literal:
 *
 *   «...se consideran estrictamente indispensables las erogaciones efectuadas
 *   por el contribuyente QUE SEAN DEDUCIBLES PARA LOS FINES DEL IMPUESTO SOBRE
 *   LA RENTA, aun cuando no se esté obligado al pago de este último impuesto.»
 *
 * Estos tres veredictos NO bajan la cubeta de deducibilidad (son "el sistema no
 * verifica un requisito", no "el requisito falta"), y por eso mismo NO pueden
 * estar en `SIN_ACREDITAMIENTO` de `engine.ts`: eso pondría el IVA en CERO en
 * todo diésel bien facturado —`permiso_cre_no_verificable` se dispara SIEMPRE
 * que hay XML— y le quitaría al cliente un acreditamiento que la ley le
 * concede. La cifra se queda; lo que cambia es que el papel deja de afirmarla
 * entera, igual que ya hace `deducibilidad.ts` con el renglón de al lado.
 *
 * El texto de cada motivo es el HECHO, no el nombre interno del veredicto: el
 * contralor lee el pie, no el union de `types/cuadra.ts`.
 */
const CONDICIONAN_LA_DEDUCCION_ISR: Record<string, string> = {
  permiso_cre_no_verificable: 'el permiso CRE vigente del proveedor de combustible, que el sistema no valida (LISR 27-III y RFA 2026 regla 2.9)',
  complemento_no_verificable: 'el complemento de hidrocarburos del CFDI de combustible, que sin el XML no se puede verificar',
  alimentacion_sin_soporte: 'el comprobante de hospedaje o transporte que ampare la alimentación (LISR 28-V)',
};

/** Cómo se dice, en el papel, que el IVA cuelga de la deducción para ISR. */
export function pieIvaAtadoAlIsr(motivos: string[]): string {
  return 'LIVA art. 5, fr. I define "estrictamente indispensable" como lo DEDUCIBLE para los fines del ISR: no son dos requisitos, es uno. '
    + `Esta liquidación depende de ${motivos.join('; y de ')} — mientras eso no se confirme, este IVA tampoco está sostenido. Confírmelo con su contador.`;
}

/**
 * Devuelve los renglones de la sección, o `null` si no hay nada que acreditar.
 *
 * `piesGenerales` va debajo del bloque entero (aplica a todos los renglones);
 * lo específico de un renglón va en su propio `pies`.
 */
export function filasAcreditables(
  liq: Pick<Liquidacion, 'ivaAcreditable' | 'peajeAcreditable' | 'litrosDieselAcreditables'> & {
    // Estructural y no `Liquidacion['diferencias']` por la misma razón que en
    // `filasDeducibilidad`: hay llamadores que traen `tipo` como `string` suelto
    // (una fila ya leída de la base), y lo único que se hace aquí es comparar
    // el texto. Opcional: quien solo prueba el reparto de cifras no tiene por
    // qué construir un arreglo vacío a mano.
    diferencias?: { tipo: string }[];
  },
): { filas: FilaAcreditable[]; piesGenerales: string[] } | null {
  const litros = liq.litrosDieselAcreditables ?? 0;
  const filas: FilaAcreditable[] = [];

  if (litros > 0) {
    filas.push({
      label: 'Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A)',
      valor: fmtLitros(litros),
      tono: 'condicionado',
      pies: [NOTA_LITROS_DIESEL],
    });
  }
  if (liq.ivaAcreditable > 0) {
    // AUDITORÍA 10, MEDIO (fiscal): este renglón salía en VERDE en la misma hoja
    // donde 'Deducible para ISR' salía condicionado POR EL MISMO HECHO. Medido
    // con el diésel de $5,800 del hallazgo: ISR `condicionado` con su pie, IVA
    // $689.66 `bueno` y `pies: []`.
    const motivos = [...new Set((liq.diferencias ?? []).map((d) => d.tipo))]
      .map((t) => CONDICIONAN_LA_DEDUCCION_ISR[t])
      .filter((m): m is string => !!m);
    filas.push(motivos.length
      ? {
          label: 'IVA acreditable (LIVA art. 5) — sujeto a la deducibilidad para ISR',
          valor: mxn(liq.ivaAcreditable),
          tono: 'condicionado',
          pies: [pieIvaAtadoAlIsr(motivos)],
        }
      : {
          label: 'IVA acreditable (LIVA art. 5)',
          valor: mxn(liq.ivaAcreditable),
          tono: 'bueno',
          pies: [],
        });
  }
  if (liq.peajeAcreditable > 0) {
    filas.push({
      // La condición va en el LABEL y no solo en el pie: el renglón es lo que se
      // skimmea, y "Estímulo de peaje 50%" a secas se lee como un derecho ya
      // ganado.
      label: 'Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad',
      valor: mxn(liq.peajeAcreditable),
      tono: 'condicionado',
      pies: [BASE_ESTIMULO_PEAJE, CONDICIONES_ESTIMULO_PEAJE],
    });
  }

  if (!filas.length) return null;
  return { filas, piesGenerales: [NOTA_INGRESO_ACUMULABLE] };
}
