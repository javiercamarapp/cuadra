import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-08 (BAJO, fiscal) — `FISCAL_LEGAL.md` PROMETÍA UNA MEDICIÓN
// MENSUAL SOBRE UNA REGLA ANUAL.
//
// `normas/rfa-2026-2.9.yaml` está `verificado_fuente_primaria` (leída en el DOF
// vía SIDOF). Su `texto_vigente` dice, literal:
//
//   «...siempre que estos no excedan el 15 por ciento del TOTAL DE LOS PAGOS
//   EFECTUADOS POR CONSUMO DE COMBUSTIBLE PARA REALIZAR SU ACTIVIDAD.»
//
// El periodo de medición es el EJERCICIO (la RFA rige del 18-feb-2026 al
// 31-dic-2026 y su `condiciones_de_aplicacion` lo dice con esas palabras). No
// hay ningún corte mensual en la regla.
//
// `FISCAL_LEGAL.md` §1.2 ponía en boca del producto la frase que se le va a
// enseñar al contralor —«Llevas 11.4% de tu diésel en efectivo ESTE MES; el
// tope es 15%»— y §3 pedía el contador «por flota y por MES». Un porcentaje
// mensual del 11.4% puede convivir con un anual del 19%: la promesa consuela
// justo cuando el cliente ya excedió. Y el motor dice lo contrario en la nota
// que sí se imprime (`cuadre/engine.ts`: «cuenta contra el tope del 15% del
// combustible DEL EJERCICIO»), así que el documento fundacional contradecía al
// código y a la ficha verificada a la vez.
//
// `normas/README.md` es explícito: la ficha manda. Esta prueba ata el documento
// a la ficha para que no vuelvan a separarse.
// ═══════════════════════════════════════════════════════════════════════════

const raiz = new URL('../../../../', import.meta.url);
const doc = readFileSync(new URL('FISCAL_LEGAL.md', raiz), 'utf8');
const ficha = readFileSync(new URL('normas/rfa-2026-2.9.yaml', raiz), 'utf8');

/** La sección §1.2 completa, hasta el siguiente encabezado `###`. */
function seccion12(): string {
  const i = doc.indexOf('### 1.2');
  expect(i, '§1.2 (la facilidad del 15%) desapareció de FISCAL_LEGAL.md').toBeGreaterThanOrEqual(0);
  const resto = doc.slice(i + 7);
  const fin = resto.indexOf('\n### ');
  return fin >= 0 ? resto.slice(0, fin) : resto;
}

describe('el 15% de la RFA 2026 regla 2.9 se mide por EJERCICIO, no por mes', () => {
  it('la ficha verificada no conoce ningún corte mensual', () => {
    expect(ficha).toContain('estado_verificacion: verificado_fuente_primaria');
    expect(ficha).toContain('total de los pagos');
    // El texto de la regla, tal como se leyó en el DOF, no dice "mes".
    const texto = ficha.slice(ficha.indexOf('texto_vigente:'), ficha.indexOf('fecha_publicacion:'));
    expect(texto).not.toMatch(/\bmes(es|ual|ualmente)?\b/i);
    expect(ficha).toContain('en el ejercicio');
  });

  it('FISCAL_LEGAL.md §1.2 no promete una medición mensual', () => {
    const s = seccion12();
    // La frase que el documento pone EN BOCA DEL PRODUCTO — la que se le va a
    // enseñar al contralor — es la que no puede decir "mes". El resto de la
    // sección sí tiene que hablar del mes: para negarlo.
    const promesa = /\*"([^"]*15%[^"]*)"\*/.exec(s)?.[1] ?? '';
    expect(promesa, 'la frase de venta del contador desapareció de §1.2').not.toBe('');
    expect(promesa, 'decía "este mes" sobre una regla anual').not.toMatch(/\bmes(es|ual|ualmente)?\b/i);
    expect(promesa, 'y tiene que nombrar el periodo real').toMatch(/ejercicio/i);
    // Y la sección tiene que declarar el periodo, no dejarlo implícito.
    expect(s, '§1.2 no dice cuál es el periodo de medición').toMatch(/EJERCICIO/);
  });

  it('el contador que §3 pide es por ejercicio, no por mes', () => {
    const fila = doc.split('\n').find((l) => l.includes('contador del 15%')) ?? '';
    expect(fila, 'la fila de la tabla de §3 desapareció').not.toBe('');
    expect(fila).not.toMatch(/\bmes\b/i);
    expect(fila).toMatch(/ejercicio/i);
  });
});
