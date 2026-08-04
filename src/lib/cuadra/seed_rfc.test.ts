import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rfcChecksumOk } from './intake/cfdi';

// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO de la auditoría 10 (fiscal) — el dato de demo que apaga todas las
// cifras fiscales del 6-ago.
//
// `tenant.rfc` del seed era 'TIN010101AAA': plausible a la vista y RECHAZADO
// por nuestro propio dígito verificador. `getConfig` lo descarta y solo lo
// registra en un log del servidor (config.ts:192-197), así que `rfcsOk` queda
// vacía, `rfcEmpresaInservible` se vuelve true (engine.ts:238) y TODO gasto
// con `rfcReceptor` cae en `rfc_receptor_no_verificable` → POR_CONFIRMAR.
//
// Medido por el auditor con los dos gastos exactos del seed ($4,200 de diésel
// con complemento HidroYPetro + $1,400 de caseta, ambos timbrados y con XML
// verificado): totalDeducible 0 · ivaAcreditable 0 · peajeAcreditable 0, el
// renglón "Deducible para ISR" no se imprime, la sección ACREDITABLE /
// RECUPERABLE devuelve null y DESAPARECE del PDF, y el único pie que sí sale
// es falso — dice "Falta timbrar la factura" sobre dos CFDI vigentes.
//
// El motor hace lo correcto: no puede confirmar al receptor, así que no afirma
// la deducción. El dato de entrada es el que no sirve. Por eso la puerta va
// sobre el seed y no sobre el motor.
//
// El RFC sigue siendo inventado (🔴 en el propio seed) — lo que cambia es que
// ahora es CONSISTENTE con el validador que el producto usa para juzgarlo.
// ═══════════════════════════════════════════════════════════════════════════

const seed = readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8');

/** `'TIN010101AA5',  -- 🔴 INVENTADO: ...` en el insert de tenant. */
function rfcDelTenant(): string {
  const bloque = seed.slice(seed.indexOf('insert into tenant'));
  const m = bloque.match(/'([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})'/);
  if (!m) throw new Error('no se encontró el RFC del tenant en seed.sql');
  return m[1];
}

describe('el RFC del tenant de demo pasa el validador del propio producto', () => {
  it('rfcChecksumOk lo acepta — si no, el 6-ago no se imprime una sola cifra fiscal', () => {
    const rfc = rfcDelTenant();
    expect(rfcChecksumOk(rfc)).toBe(true);
  });

  // El receptor de cada gasto es la misma flota. Si divergen, el motor vuelve a
  // no poder confirmar al receptor y el síntoma reaparece por la otra puerta.
  it('el rfc_receptor de los gastos del seed es el mismo del tenant', () => {
    const rfc = rfcDelTenant();
    const receptores = [...seed.matchAll(/'([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})',\s*\n?\s*'?\d{4}-/g)].map((m) => m[1]);
    // Al menos los dos gastos del escenario de demo, y todos apuntando a la flota.
    expect(seed).toContain(`'${rfc}'`);
    for (const r of receptores) expect(r).toBe(rfc);
  });
});
