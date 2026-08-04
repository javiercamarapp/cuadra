import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import type { Comprobante } from './simulador';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CUATRO COMPROBANTES DEL SIMULADOR, Y CÓMO SE LLAMAN.
//
// Vive en el SERVIDOR y no dentro del componente de cliente por una razón
// concreta: `etiquetaConcepto` está en `cuadre/engine.ts`, que importa
// `intake/cfdi.ts`, que importa `sharp` y `node:fs`. Ese árbol no puede entrar
// en el bundle del navegador. La etiqueta se calcula aquí, una vez, y viaja
// como prop — así `/demo` delega en el motor igual que el panel y el PDF, sin
// una segunda copia del mapa de conceptos.
//
// (auditoría 10, frontend, MEDIO: la burbuja de acuse decía «Recibí tu diesel»
// —la clave cruda del union— y dos burbujas después la nota del motor decía
// «Combustible de $4,200.00 excede el tope de política». Dos nombres para el
// mismo gasto en la misma conversación.)
// ═══════════════════════════════════════════════════════════════════════════

// 🔴 INVENTADO: escenario de demo Silao→Laredo. Anticipo = total comprobado,
// así la ÚNICA diferencia es el diésel $200 sobre política (luce el diferenciador).
export const ANTICIPO = 10600;

const BASE: Array<Omit<Comprobante, 'etiqueta'>> = [
  { concepto: 'diesel', monto: 4200, folio: 'DS-8801', label: 'Diésel $4,200 (sobre tope)' },
  { concepto: 'diesel', monto: 3800, folio: 'DS-8802', label: 'Diésel $3,800' },
  { concepto: 'caseta', monto: 1400, folio: 'CA-4471', label: 'Caseta $1,400' },
  // El receptor viaja con el preset: la burbuja de acuse afirma «CFDI validado
  // por QR ✅», y sin este campo el motor —con razón— pedía dos burbujas
  // después «reenvía una foto más clara del QR» sobre ese mismo comprobante
  // (FE-2, auditoría 10). Un QR que de verdad se leyó entrega el receptor.
  { concepto: 'factura', monto: 1200, folio: 'FA-9007', cfdiUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', rfcReceptor: 'TIN010101AA5', label: 'Factura CFDI $1,200' },
];

/**
 * Los presets con su etiqueta del motor. `ocrExtra` va indefinido porque estos
 * comprobantes no pasan por OCR: `etiquetaConcepto('diesel', undefined)` es
 * «Combustible», que es exactamente lo que el motor escribirá dos burbujas
 * después en sus notas.
 */
export const PRESETS: Comprobante[] = BASE.map((p) => ({
  ...p,
  etiqueta: etiquetaConcepto(p.concepto, undefined),
}));
