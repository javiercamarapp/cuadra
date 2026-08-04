import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { comercio } from '../facturacion/comercios';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// UN PLAZO DE NIVEL 6 NO PUEDE SONAR A OBLIGACIÓN FISCAL.
//
// `normas/politica-portales-plazos.yaml` (`jerarquia: 6`, `sin_verificar`) lo
// dice con todas sus letras:
//
//   "ESTO NO ES UNA NORMA FISCAL… El plazo LEGAL para pedir factura es todo el
//    ejercicio (el SAT lo dice expresamente), y negarla porque 'ya pasó el mes'
//    es una práctica indebida listada por el propio SAT… El producto NUNCA debe
//    presentar estos plazos como una obligación fiscal."
//
// La rama VENCIDA ya lo decía ("legalmente puedes exigirlo dentro del
// ejercicio"). Las otras dos no. Sobre el ticket real de Office Depot del
// 25-jul-2026 —la única entrada del catálogo con `plazoVerificado: true`, leída
// del papel— el aviso salía así:
//
//   "…sigue sin factura: puedes timbrarlo hasta el 2026-08-31 (34 días)."
//
// Un contralor que lee eso concluye que el 1-sep perdió el CFDI, y no es
// cierto. Es el error de confundir niveles que `normas/README.md` llama el más
// caro del dominio, cometido por el papel que vendemos.
// ═══════════════════════════════════════════════════════════════════════════

const ticketOfficeDepot = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'otro', monto: 1450.5, fecha: '2026-07-25',
  folio: 'ITU-000123', ocrConfianza: 0.97,
  rfcEmisor: 'ODM950324V2A',   // Office Depot de México
  ...over,
});

const avisos = (g: Gasto, hoy: string) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5000, gastos: [g], politica: [], hoy })
    .diferencias.filter((d) => d.tipo === 'factura_por_vencer');

describe('el plazo del comercio se dice como política, no como ley', () => {
  it('Office Depot sigue siendo la única entrada con plazo VERIFICADO', () => {
    // Si alguien marca otra como verificada sin leer su portal, esto lo saca a
    // la luz junto con la ficha, que es la que tiene que enterarse.
    expect(comercio('office_depot')?.plazoVerificado).toBe(true);
    expect(comercio('office_depot')?.plazo).toBe('mes_siguiente');
    expect(comercio('oxxo')?.plazoVerificado).toBe(false);
  });

  it('el cálculo del ticket real sigue siendo el correcto (31-ago, no 31-jul)', () => {
    const a = avisos(ticketOfficeDepot(), '2026-07-28');
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('2026-08-31');
    expect(a[0].nota).toContain('34 días');
  });

  it('con plazo VERIFICADO dice de quién es el plazo y que la ley da el ejercicio', () => {
    const nota = avisos(ticketOfficeDepot(), '2026-07-28')[0].nota;
    expect(nota).toContain('plazo del portal de Office Depot, no de la ley');
    expect(nota).toContain('dentro del ejercicio');
  });

  it('también en la rama URGENTE, que es la que más presiona a actuar', () => {
    // Un día antes del 31-ago: el tono cambia, el matiz de jerarquía no.
    const nota = avisos(ticketOfficeDepot(), '2026-08-30')[0].nota;
    expect(nota).toContain('día(s) para timbrarlo');
    expect(nota).toContain('no de la ley');
  });

  // AUDITORÍA 10, MEDIO (fiscal) — ESTA PRUEBA SE REESCRIBIÓ, NO SE BORRÓ.
  //
  // Fijaba, con `expect(nota).not.toContain('no de la ley')`, la premisa de que
  // el matiz de jerarquía es propiedad del COMERCIO: solo se dice cuando alguien
  // leyó su portal (`plazoVerificado: true`, 4 de 37 entradas). Dejó de
  // sostenerse por dos razones que la ficha `politica-portales-plazos.yaml` ya
  // traía escritas: (1) «El producto NUNCA debe presentar estos plazos como una
  // obligación fiscal» no admite excepción por si el plazo está verificado o no
  // —al contrario, la rama SIN verificar es la que leen 33 de 37 comercios—; y
  // (2) la fecha de esa rama sale del default `mes_natural`, cuyas fichas son
  // `sin_verificar` y `texto_vigente: null`, así que es justo la que menos puede
  // sonar a cálculo legal.
  //
  // Lo que la prueba conserva es lo suyo: que el matiz específico de la rama sin
  // verificar —la ventana puede ser MENOR— no se pierda al añadir el de
  // jerarquía, y que la fecha se atribuya a quien la produjo.
  it('sin plazo verificado: la ventana puede ser menor Y la ley sigue dando el ejercicio', () => {
    const nota = avisos(ticketOfficeDepot({ rfcEmisor: 'CCO8605231N4', monto: 41.5 }), '2026-07-28')[0].nota;
    expect(nota).toContain('la ventana del comercio puede ser menor');
    expect(nota).toContain('dentro del ejercicio');
    // La fecha no se atribuye al portal de nadie: es el supuesto de este sistema.
    expect(nota).toContain('fin del mes de la compra, no de la ley');
    expect(nota).not.toContain('plazo del portal');
  });

  it('la rama VENCIDA sigue diciendo lo que ya decía', () => {
    const nota = avisos(ticketOfficeDepot(), '2026-09-05')[0].nota;
    expect(nota).toContain('se pasó el plazo');
    expect(nota).toContain('dentro del ejercicio');
    expect(nota).toContain('Conciliación de Factura');
  });
});
