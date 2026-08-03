import Simulador from './simulador';
import { PRESETS, ANTICIPO } from './presets';

/**
 * El simulador de WhatsApp — el Plan B que `GUION_DEMO.md:35` manda tener
 * abierto en otra pestaña por si Meta falla.
 *
 * La página es un SERVER COMPONENT y la conversación vive en `simulador.tsx`
 * ('use client'). La partición no es estética: los presets tienen que llegar
 * con la etiqueta que el motor le da a cada concepto (`etiquetaConcepto`), y
 * ese módulo importa `intake/cfdi.ts` → `sharp` y `node:fs`, que no pueden
 * entrar en el bundle del navegador. Se calcula aquí, en `presets.ts`, y viaja
 * como prop.
 *
 * Antes la burbuja de acuse interpolaba `c.concepto` —la clave cruda del
 * union— y decía «Recibí tu diesel de $4,200.00» mientras el motor, dos
 * burbujas después, llamaba al mismo gasto «Combustible» (auditoría 10,
 * frontend, MEDIO).
 */
export default function Demo() {
  return <Simulador presets={PRESETS} anticipo={ANTICIPO} />;
}
