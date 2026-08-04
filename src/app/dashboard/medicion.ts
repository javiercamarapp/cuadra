import type { Acreditables } from '@/lib/cuadra/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// UN CERO ACREDITABLE NO ES UNA MEDICIÓN — y el panel tenía que poder decirlo.
//
// AUDITORÍA 11 · G-09. Las tres tarjetas fiscales de /dashboard (diésel
// elegible, IVA acreditable, peaje 50%) se pintan con la cita de ley al pie
// —"LIF 2026, Art. 20-A", "LIVA, Art. 5"—, así que un `$0.00` ahí no se lee
// como "no hay dato": se lee como el resultado de aplicar esa ley a los
// comprobantes de la flota.
//
// Y ese cero es, casi siempre, la ausencia de un XML:
//
//   · el IVA y el peaje se suman DESPUÉS de `if (!g.xmlVerificado) continue;`
//     (`cuadre/engine.ts`), y una FOTO de ticket nunca produce `xmlVerificado`;
//   · los litros exigen ADEMÁS `claveProdServ` (solo lo escribe el parser del
//     XML) y `ocrExtra.litros` (solo lo escribe el OCR de una foto).
//
// El flujo que el producto vende es la foto por WhatsApp. Así que el camino
// normal daba tres ceros grandes con respaldo legal citado debajo.
//
// La regla, entonces, tiene tres estados y no dos:
//   consulta caída      → no se afirma NADA (ni cero, ni "no hay")
//   sin liquidaciones   → no hay de dónde acreditar todavía, y se dice
//   sin XML             → sí hubo liquidaciones y ninguna trajo comprobante
//                         medible: eso es lo que falta, y es accionable
//
// `getAcreditables` devuelve `liquidaciones` justamente para poder separar los
// dos últimos: sin ese dato, "no hay nada que acreditar" y "no llegó un solo
// XML" se ven idénticos, y el segundo es un problema que el contralor puede
// resolver pidiéndole la factura a la gasolinera.
// ═══════════════════════════════════════════════════════════════════════════

export type CampoAcreditable = 'iva' | 'peaje' | 'litrosDiesel';

/** Qué le falta a cada acreditable cuando la suma da cero teniendo filas. */
export const NOTA_SIN_MEDICION: Record<CampoAcreditable, string> = {
  iva: 'Ningún comprobante del periodo trae IVA desglosado en un XML — se acredita con el CFDI, no con la foto del ticket.',
  peaje: 'Ningún comprobante de caseta del periodo trae XML — se acredita con el CFDI, no con la foto del ticket.',
  litrosDiesel: 'Ningún CFDI de diésel del periodo trae los litros (complemento de hidrocarburos) — sin ellos no se pueden contar.',
};

/**
 * El valor que la tarjeta puede AFIRMAR, o `null` si no hay medición que
 * afirmar. `null` viaja hasta `KpiTile`, que lo pinta como "—".
 */
export function acreditableMedido(acred: Acreditables | null, campo: CampoAcreditable): number | null {
  if (!acred) return null;
  const v = acred[campo];
  return v > 0 ? v : null;
}

/**
 * El pie de la tarjeta: la cita legal cuando SÍ hay medición, y qué falta
 * cuando no. La cita se retira a propósito en ese caso — es lo que convierte
 * un hueco en una afirmación fiscal.
 */
export function notaAcreditable(acred: Acreditables | null, campo: CampoAcreditable, base: string): string {
  if (!acred) return 'No se pudo leer esta cifra — no significa que sea cero.';
  if (acred[campo] > 0) return base;
  if (acred.liquidaciones === 0) return 'Todavía no hay liquidaciones cerradas en el periodo de las que acreditar.';
  return NOTA_SIN_MEDICION[campo];
}
