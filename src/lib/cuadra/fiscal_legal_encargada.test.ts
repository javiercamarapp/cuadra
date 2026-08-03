import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO — `FISCAL_LEGAL.md` §2.3 contra la ficha que lo corrige.
//
// `FISCAL_LEGAL.md` es el documento resumen que un abogado del cliente leería
// primero, y §2.3 se titulaba *"Mandar la foto a un modelo de IA es una
// transferencia"*. La ficha `normas/lfpdppp-2-XII-XX.yaml` —verificada contra
// fuente primaria, y que dice expresamente que CORRIGE el análisis previo—
// concluye lo contrario: el art. 2 fr. XX define transferencia como la
// comunicación a persona "distinta de la titular, del responsable o de la
// PERSONA ENCARGADA", así que mandarle datos a quien los trata por cuenta del
// responsable no es transferencia por definición legal.
//
// No es una discrepancia cosmética: sobre esa conclusión descansa todo el
// análisis de riesgo del rubro —el aviso integral la afirma por escrito
// (`privacidad.ts`, sección de transferencias) y `/privacidad` la repite—, y el
// documento resumen decía lo opuesto en su encabezado.
//
// Esta prueba amarra las dos mitades: si alguien reescribe §2.3, se entera de
// que la ficha es la fuente de verdad; y si algún día la ficha cambiara de
// conclusión, esto falla hasta que el documento la siga.
// ═══════════════════════════════════════════════════════════════════════════

const DOC = readFileSync(new URL('../../../FISCAL_LEGAL.md', import.meta.url), 'utf8');
const FICHA = readFileSync(new URL('../../../normas/lfpdppp-2-XII-XX.yaml', import.meta.url), 'utf8');

describe('FISCAL_LEGAL.md no puede contradecir la ficha de persona encargada', () => {
  it('la ficha sigue concluyendo que NO es transferencia (si esto cambia, cambia todo)', () => {
    // La conclusión que el documento tiene que reflejar, leída de la ficha y no
    // de la memoria de quien escribe la prueba.
    expect(FICHA).toContain('EXCLUYE a la persona encargada');
    expect(FICHA).toContain('estado_verificacion: verificado_fuente_primaria');
  });

  it('el documento NO afirma que mandar la foto a un modelo sea una transferencia', () => {
    // La afirmación exacta que la ficha corrige. Se busca la forma afirmativa
    // sin negación delante, que es la que engaña a quien solo lee los títulos.
    expect(DOC).not.toMatch(/modelo de IA es una transferencia/i);
    expect(DOC).not.toMatch(/(?<!no )es una transferencia\b/i);
  });

  it('el documento dice por qué NO lo es, y cita el artículo que lo resuelve', () => {
    // Callarse tampoco sirve: §2.3 existe para responder esa pregunta, y quien
    // la lea tiene que salir con el fundamento, no solo sin el error.
    expect(DOC).toMatch(/no es una transferencia/i);
    expect(DOC).toMatch(/art\.?\s*2\b[^\n]*fr\.?\s*XX/i);
    expect(DOC).toMatch(/persona encargada/i);
  });

  it('el documento remite a la ficha, que es la fuente de verdad', () => {
    expect(DOC).toContain('normas/lfpdppp-2-XII-XX.yaml');
  });
});
