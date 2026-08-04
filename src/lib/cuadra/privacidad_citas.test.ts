import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { avisoIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// EL FUNDAMENTO SE PINTA EN LA PÁGINA — auditoría 11, G-54 (parte de código).
//
// `SeccionAviso.fundamento` existe, en palabras del propio archivo, «para que
// quien lo revise pueda comprobarlo», y `aviso/[tenant]/page.tsx` lo imprime.
// O sea que una cita equivocada no es un typo de comentario: es el documento
// legal citando mal delante de quien lo va a revisar.
//
// Dos citas mal puestas, las dos verificables contra `normas/lfpdppp-2-XII-XX.yaml`
// (estado `verificado_fuente_primaria`, texto transcrito literal de
// diputados.gob.mx):
//
//  1. «Likida es persona encargada (art. 2 fr. XX)». La fr. XX es la definición
//     de TRANSFERENCIA. La de persona encargada es la fr. XII. El documento que
//     sostiene «esto no es una transferencia» citaba como fundamento la
//     definición de transferencia.
//
//  2. La revocación se fundaba en «Reglamento art. 21» — el reglamento de la
//     ley ABROGADA. La ficha ya corrigió una vez este mismo error en otro
//     párrafo: «venía del Reglamento de la ley abrogada. Citarla ante un
//     cliente es citar derecho derogado». Se retira la cita muerta y no se
//     sustituye por otra: cuál es su equivalente en la ley vigente no lo
//     respalda ninguna ficha, y inventarlo sería el mismo error al revés.
//
// Lo demás de G-54 —qué datos y qué finalidades se declaran— es decisión de una
// persona, no de una prueba.
// ═══════════════════════════════════════════════════════════════════════════

const DATOS = {
  razonSocial: 'TRANSPORTES INNOVATIVOS SA DE CV',
  domicilio: 'Calle 1, Mérida, Yucatán',
  urlAvisoIntegral: 'https://likida.ai/aviso/t1',
  contactoPrivacidad: 'datos@flota.mx',
};

const FUENTES = ['src/lib/cuadra/privacidad.ts', 'src/app/privacidad/page.tsx'];

describe('la persona encargada se funda en la fr. XII, no en la fr. XX', () => {
  it('el aviso integral no funda «persona encargada» en la definición de transferencia', () => {
    const texto = avisoIntegral(DATOS).flatMap((s) => [s.titulo, s.fundamento, ...s.parrafos]).join('\n');
    expect(texto, 'el documento tiene que decir quién trata por cuenta de quién').toMatch(/persona encargada/i);
    // La frase que nombra a la encargada no puede apoyarse en la fr. XX.
    for (const oracion of texto.split(/(?<=\.)\s+/)) {
      if (!/persona encargada/i.test(oracion)) continue;
      if (/transferencia/i.test(oracion)) continue;   // ahí la fr. XX SÍ es la buena
      expect(oracion, `funda «persona encargada» en la fr. XX: «${oracion.trim()}»`)
        .not.toMatch(/art\.?\s*2\s*fr\.?\s*XX\b/i);
    }
  });

  it('y la fr. XII aparece donde se define a la encargada', () => {
    const texto = avisoIntegral(DATOS).flatMap((s) => s.parrafos).join('\n');
    expect(texto).toMatch(/art\.?\s*2\s*fr\.?\s*XII\b/);
  });

  it('la fr. XX se conserva donde de verdad va: la transferencia', () => {
    // La ficha apoya la conclusión en que la definición de transferencia
    // EXCLUYE a la persona encargada. Quitar esa cita rompería el argumento.
    const texto = avisoIntegral(DATOS).flatMap((s) => s.parrafos).join('\n');
    const sobreTransferencia = texto.split('\n').filter((p) => /no es una transferencia/i.test(p));
    expect(sobreTransferencia.length).toBeGreaterThan(0);
    expect(sobreTransferencia.join(' ')).toMatch(/fr\.?\s*XX\b/);
  });

  it('ninguna línea de las dos fuentes sigue diciendo «encargada (art. 2 fr. XX)»', () => {
    // Se mira línea por línea y se exceptúa la que habla de transferencia: ahí
    // la fr. XX es la cita buena, y es donde el argumento se apoya.
    const culpables: string[] = [];
    for (const f of FUENTES) {
      readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        if (!/encargad[ao]/i.test(linea)) return;
        if (/transferencia/i.test(linea)) return;
        if (/fr\.?\s*XX\b/i.test(linea)) culpables.push(`${f}:${i + 1}`);
      });
    }
    expect(culpables, `funda a la encargada en la fr. XX: ${culpables.join(', ')}`).toEqual([]);
  });
});

describe('no se cita el reglamento de una ley abrogada', () => {
  it('la revocación ya no se funda en «Reglamento art. 21»', () => {
    const seccion = avisoIntegral(DATOS).find((s) => /revocar/i.test(s.titulo));
    expect(seccion, 'la sección de revocación es obligatoria (fr. IV/V del art. 15)').toBeTruthy();
    expect(seccion!.fundamento, 'el Reglamento de la LFPDPPP anterior murió con su ley')
      .not.toMatch(/Reglamento/i);
    // Se retira la cita muerta, no el fundamento: el que queda es de la ley.
    expect(seccion!.fundamento).toMatch(/LFPDPPP/);
  });

  it('y no aparece en ninguna otra sección del aviso', () => {
    const fundamentos = avisoIntegral(DATOS).map((s) => s.fundamento).join(' | ');
    expect(fundamentos).not.toMatch(/Reglamento/i);
  });
});
