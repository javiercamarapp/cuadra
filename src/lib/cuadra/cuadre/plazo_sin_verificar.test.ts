// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (reincidente) — 33 de los 37 comercios del catálogo caen
// en la rama que AFIRMA una fecha límite sin decir que el plazo legal es todo el
// ejercicio, y esa fecha no la sostiene ninguna ficha.
//
// El matiz legal era propiedad de `cierreComercio`, que solo existe cuando
// `plazoVerificado` es `true` (4 entradas de 37):
//
//     const cierreComercio = comercio?.plazoVerificado
//       ? ' (plazo del portal de …, no de la ley: legalmente puedes exigir la factura dentro del ejercicio)'
//       : ', y la ventana del comercio puede ser menor';
//
// `normas/politica-portales-plazos.yaml`, `advertencia_de_jerarquia`, literal:
//
//   «ESTO NO ES UNA NORMA FISCAL. Es la política interna de un tercero y tiene
//   CERO fuerza legal. El plazo LEGAL para pedir factura es todo el ejercicio
//   (el SAT lo dice expresamente), y negarla porque "ya pasó el mes" es una
//   práctica indebida listada por el propio SAT, con remedio en la Conciliación
//   de Factura. El producto NUNCA debe presentar estos plazos como una
//   obligación fiscal.»
//
// Y la fecha que se imprimía en esa rama sale del default `mes_natural`, cuyas
// dos fichas son `sin_verificar` y `texto_vigente: null`. `normas/README.md`:
// «Ninguna ficha `sin_verificar` debe sostener una cifra que el producto
// imprima.»
//
// Texto medido antes del arreglo (diésel de $3,200 del 1-ago-2026, emisor Shell,
// `plazoVerificado: false`, hoy 2026-08-02):
//
//   «Combustible de $3,200.00 sigue sin factura: puedes timbrarlo hasta el
//    2026-08-31 (29 días), y la ventana del comercio puede ser menor. Portal de
//    Shell México: https://facturacion.shell.com.mx/.»
//
// Ni "no de la ley" ni "dentro del ejercicio". El contralor lee una fecha con la
// autoridad de un cálculo y da por perdido el 1-sep un CFDI que puede exigir
// todo el ejercicio. En diésel eso es la deducción y el IVA del gasto más grande
// de la flota.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { COMERCIOS, comercio } from '../facturacion/comercios';
import type { Gasto } from '@/types/cuadra';

/** El ticket del hallazgo: diésel de Shell, sin timbrar, del 1-ago-2026. */
const ticketShell = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 3200, fecha: '2026-08-01',
  folio: 'SH-4471', ocrConfianza: 0.96,
  ocrExtra: { emisor: 'SHELL' },
  ...over,
});

const aviso = (g: Gasto, hoy: string) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5000, gastos: [g], politica: [], hoy })
    .diferencias.filter((d) => d.tipo === 'factura_por_vencer')[0];

describe('el plazo SIN VERIFICAR tampoco puede sonar a obligación fiscal', () => {
  it('el catálogo sigue siendo mayoritariamente sin verificar (por eso importa esta rama)', () => {
    const sinVerificar = COMERCIOS.filter((c) => !c.plazoVerificado).length;
    expect(sinVerificar).toBeGreaterThan(COMERCIOS.length / 2);
    expect(comercio('shell')?.plazoVerificado).toBe(false);
  });

  // EL HALLAZGO. La rama no vencida y sin verificar es la que leen 33 de 37
  // comercios, y era la única de las cuatro que no decía de quién es el plazo.
  it('la rama NO VENCIDA sin verificar dice que la ley da todo el ejercicio', () => {
    const nota = aviso(ticketShell(), '2026-08-02').nota;
    expect(nota).toContain('dentro del ejercicio');
    expect(nota).toContain('no de la ley');
    expect(nota).toContain('la ventana del comercio puede ser menor'); // el matiz viejo no se pierde
  });

  // La fecha no la sostiene ninguna ficha: es el default `mes_natural`. Se sigue
  // diciendo —sirve para empujar— pero atribuida al supuesto que la produjo, no
  // presentada como un cálculo legal.
  it('y dice de dónde sale la fecha que imprime', () => {
    const nota = aviso(ticketShell(), '2026-08-02').nota;
    expect(nota).toContain('2026-08-31');
    expect(nota).toMatch(/fin del mes de la compra/i);
  });

  it('también en la rama URGENTE sin verificar, que es la que más presiona a actuar', () => {
    const nota = aviso(ticketShell(), '2026-08-30').nota;
    expect(nota).toContain('día(s) para timbrarlo');
    expect(nota).toContain('dentro del ejercicio');
  });

  // CONTROLES: las dos ramas que ya lo decían tienen que seguir diciéndolo, y la
  // verificada tiene que seguir nombrando al comercio (es de quien SÍ es el plazo).
  it('la rama VENCIDA sigue igual', () => {
    const nota = aviso(ticketShell(), '2026-09-05').nota;
    expect(nota).toContain('se pasó el plazo');
    expect(nota).toContain('dentro del ejercicio');
    expect(nota).toContain('Conciliación de Factura');
  });

  it('con plazo VERIFICADO se sigue nombrando el portal del comercio', () => {
    const officeDepot = ticketShell({ concepto: 'otro', monto: 1450.5, fecha: '2026-07-25', rfcEmisor: 'ODM950324V2A', ocrExtra: undefined });
    const nota = aviso(officeDepot, '2026-07-28').nota;
    expect(nota).toContain('plazo del portal de Office Depot, no de la ley');
    expect(nota).toContain('dentro del ejercicio');
  });
});
