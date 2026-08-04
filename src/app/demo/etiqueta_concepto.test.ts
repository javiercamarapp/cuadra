import { describe, it, expect } from 'vitest';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { acuse } from './simulador';
import { PRESETS } from './presets';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (frontend) — «el simulador /demo llama al mismo gasto de
// dos formas en la misma conversación».
//
// Botón *Diésel $4,200 (sobre tope)*:
//
//     Recibí tu diesel de $4,200.00. ¿Tienes más o ya cerramos?      ← burbuja 2
//     …
//     Ojo con esto:
//     • Combustible de $4,200.00 excede el tope de política…          ← burbuja 6
//
// `diesel`, sin acento y en minúscula, es la CLAVE del union `ConceptoGasto`
// (`types/cuadra.ts:20-25`), no una etiqueta. `/demo` era la única superficie
// del producto sin mapa de conceptos: el panel de detalle tiene el suyo y
// además delega en el motor (`[id]/page.tsx:283-286`), y el PDF delega en el
// motor. `/demo` no hacía ninguna de las dos.
//
// Y `/demo` es el Plan B que `GUION_DEMO.md:35` manda tener abierto en otra
// pestaña: el que se usa exactamente cuando Meta falla, o sea en el peor
// momento posible para que el producto se contradiga solo. Dos nombres para el
// mismo gasto se leen como dos sistemas.
//
// Aquí se compara contra `etiquetaConcepto` EJECUTÁNDOLA, no contra una lista
// escrita a mano que se queda vieja en silencio: `etiquetas_panel.test.ts` fija
// la misma regla para el panel y el PDF, y no miraba `/demo`.
// ═══════════════════════════════════════════════════════════════════════════

describe('el simulador llama al gasto como lo llama el motor', () => {
  it('la burbuja del diésel NO dice «diesel» — dice lo que dirá la nota del cuadre', () => {
    const diesel = PRESETS.find((p) => p.concepto === 'diesel')!;
    const texto = acuse(diesel);
    expect(texto, 'la clave cruda del union se lee como un campo de base de datos').not.toContain('diesel');
    expect(texto.toLowerCase()).toContain(etiquetaConcepto('diesel', undefined).toLowerCase());
  });

  it('los cuatro presets usan la etiqueta del motor, ninguno la clave', () => {
    for (const p of PRESETS) {
      const delMotor = etiquetaConcepto(p.concepto, undefined);
      expect(p.etiqueta, `el preset «${p.label}» no trae la etiqueta del motor`).toBe(delMotor);
      expect(
        acuse(p).toLowerCase(),
        `la burbuja de «${p.label}» no dice «${delMotor}»`,
      ).toContain(delMotor.toLowerCase());
    }
  });

  it('cuando la etiqueta del motor difiere de la clave, la clave no aparece', () => {
    // El caso que importa: `diesel` → «Combustible». Los conceptos cuya
    // etiqueta es la clave capitalizada (`caseta` → «Caseta») no distinguen
    // nada, así que solo se exige donde de verdad hay dos nombres.
    for (const p of PRESETS) {
      const delMotor = etiquetaConcepto(p.concepto, undefined);
      if (delMotor.toLowerCase() === p.concepto.toLowerCase()) continue;
      expect(acuse(p), `«${p.concepto}» sigue saliendo crudo en la burbuja`).not.toContain(p.concepto);
    }
  });

  // CONTROL 1. El acuse sigue diciendo lo demás: monto y la palomita del CFDI
  // (que el preset de factura sí sostiene — trae `rfcReceptor`).
  it('control: el monto y el acuse de CFDI no se tocan', () => {
    const factura = PRESETS.find((p) => p.cfdiUuid)!;
    const texto = acuse(factura);
    expect(texto).toContain('$1,200.00');
    expect(texto).toContain('CFDI validado por QR');
    expect(texto).toContain('¿Tienes más o ya cerramos?');
    const caseta = PRESETS.find((p) => p.concepto === 'caseta')!;
    expect(acuse(caseta)).not.toContain('CFDI validado');
  });

  // CONTROL 2. La etiqueta del BOTÓN es otra cosa y no cambia: es interfaz del
  // demo («Diésel $4,200 (sobre tope)»), no el nombre del gasto.
  it('control: los rótulos de los botones siguen igual', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'Diésel $4,200 (sobre tope)',
      'Diésel $3,800',
      'Caseta $1,400',
      'Factura CFDI $1,200',
    ]);
  });
});
