import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO REINCIDENTE de la auditoría 10 (frontend) — la nota del permiso CRE
// sale rota en las DOS ramas.
//
// `sujeto` ya nombra el concepto:
//   · 1 CFDI  → «El CFDI de Combustible»
//   · N CFDI  → «2 CFDI de combustible ($8,000.00)»
//
// y el predicado lo repetía:
//
//   «El CFDI de Combustible **de combustible**: LISR 27-III y RFA 2026…»
//   «2 CFDI de combustible ($8,000.00) **de combustible**: LISR 27-III…»
//
// El auditor de frontend lo verificó ejecutando el motor y lo dejó anotado como
// fuera de su dominio: la cadena nace en `engine.ts` y viaja igual al panel, al
// PDF y a WhatsApp, así que parchearla en la vista habría dejado las otras dos
// superficies rotas y una cuarta copia de la frase.
//
// Se prueba contra el MOTOR, no contra el texto fuente, que es donde la nota se
// construye de verdad.
// ═══════════════════════════════════════════════════════════════════════════

const CLAVES_DIESEL = ['15101505'];

/** Un diésel timbrado y verificado, sin permiso CRE que el sistema pueda validar. */
const diesel = (id: string, monto: number): Gasto => ({
  id, concepto: 'diesel', monto,
  cfdiUuid: `${id}-uuid-0000-0000-000000000000`,
  claveProdServ: '15101505',
  xmlVerificado: true,
  tipoComprobante: 'I',
  subTotal: monto / 1.16,
  ivaTraslado: monto - monto / 1.16,
  ocrConfianza: 0.99,
} as Gasto);

function notaCre(gastos: Gasto[]): string {
  const liq = cuadrarViaje({
    viajeId: 'v1', anticipo: 0, gastos, politica: [], ruta: 'Silao-Laredo',
    hidrocarburos: { claves: CLAVES_DIESEL },
  } as never);
  const d = liq.diferencias.find((x) => x.tipo === 'permiso_cre_no_verificable');
  return d?.nota ?? '';
}

describe('la nota del permiso CRE no repite el concepto', () => {
  it('con UN CFDI: «El CFDI de Combustible de combustible:» ya no sale', () => {
    const nota = notaCre([diesel('g1', 4200)]);
    expect(nota, 'la nota tiene que existir para que esta prueba mida algo').not.toBe('');
    expect(nota).not.toMatch(/de combustible de combustible/i);
    expect(nota, 'el sujeto se conserva').toMatch(/El CFDI de/i);
    expect(nota, 'y el fundamento también').toContain('LISR 27-III');
  });

  it('con VARIOS CFDI: «2 CFDI de combustible ($8,000.00) de combustible:» tampoco', () => {
    const nota = notaCre([diesel('g1', 4000), diesel('g2', 4000)]);
    expect(nota).not.toBe('');
    // El sujeto de esta rama YA termina en «de combustible (monto)», así que la
    // repetición se ve como «…($8,000.00) de combustible:».
    expect(nota).not.toMatch(/\)\s*de combustible/i);
    expect(nota, 'el conteo y el monto se conservan').toMatch(/2 CFDI de combustible/i);
  });

  // CONTROL. El arreglo quita una repetición, no la mitad de la frase: lo que
  // el contralor tiene que poder accionar sigue ahí.
  it('control: la nota conserva qué falta y qué hacer', () => {
    const nota = notaCre([diesel('g1', 4200)]);
    expect(nota).toContain('permiso CRE');
    expect(nota).toMatch(/no lo valida/i);
    expect(nota).toMatch(/contador/i);
  });
});
