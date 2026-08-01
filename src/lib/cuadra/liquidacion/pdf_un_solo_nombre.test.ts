import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { generarLiquidacionPDF } from './pdf';
import type { Liquidacion, Viaje, Operador } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ARQ-1 — EL PRODUCTO TENÍA DOS NOMBRES EN LA MISMA HOJA.
//
// `pdf.ts` imprimía `Cuadra` como cabecera en 20pt bold y, 237 líneas más
// abajo del mismo archivo, `Generado por Likida` en el pie. Las dos cosas
// salen en el MISMO papel: el que el contralor archiva y le manda a su
// contador.
//
// Es el residuo del cambio de nombre. El commit `87daa62` —el que sacó el
// dominio ajeno del pie— corrigió la línea del pie y no miró la cabecera,
// porque en el fuente están a 237 líneas de distancia y ninguna prueba
// comparaba una con otra.
//
// El daño no es estético. El contralor recibe una liquidación encabezada por
// una marca y firmada por otra. En una sala de demo eso no se lee como
// "cambiaron de nombre": se lee como que el documento no es de quien dice ser,
// que es justo la duda que un contralor tiene el trabajo de tener.
//
// POR QUÉ LA PRUEBA LEE EL PDF Y NO EL FUENTE. Es la única forma de comparar
// dos cadenas que viven en extremos opuestos del archivo. Y hay que descomprimir
// e interpretar el hex a mano: el primer intento de esta misma prueba buscó
// "Cuadra" en los bytes crudos y PASÓ EN VERDE con el bug puesto, porque
// pdf-lib deflata los flujos y escribe el texto como `<437561647261>`. Una
// prueba que pasa vacía es peor que no tenerla.
// ═══════════════════════════════════════════════════════════════════════════

const liq: Liquidacion = {
  id: 'l1', viajeId: 'v1', creadaEn: '2026-05-02T10:00:00Z',
  totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0, estatus: 'cuadrada',
  totalDeducible: 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  diferencias: [], gastos: [{ id: 'g1', concepto: 'diesel', monto: 1000, folio: 'A1', fecha: '2026-05-01' }],
};
const viaje: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Merida', destino: 'Cancun', anticipo: 1000 };
const operador: Operador = { id: 'o1', nombre: 'Juan Perez', telefono: '+52', terminal: 'Merida' };

/**
 * El texto que un humano LEE en el papel: se inflan los flujos deflatados y se
 * decodifican los literales `<hex>` que pdf-lib emite para cada `Tj`.
 */
async function textoImpreso(): Promise<string> {
  const buf = Buffer.from(await generarLiquidacionPDF(liq, viaje, operador));
  let contenido = '';
  for (let i = 0; ;) {
    const s = buf.indexOf('stream', i);
    if (s === -1) break;
    let a = s + 'stream'.length;
    if (buf[a] === 0x0d) a++;
    if (buf[a] === 0x0a) a++;
    const e = buf.indexOf('endstream', a);
    if (e === -1) break;
    try { contenido += inflateSync(buf.subarray(a, e)).toString('latin1'); } catch { /* no deflatado */ }
    i = e + 'endstream'.length;
  }
  return (contenido.match(/<([0-9A-Fa-f]+)>\s*Tj/g) ?? [])
    .map((m) => Buffer.from(m.slice(1, m.indexOf('>')), 'hex').toString('latin1'))
    .join('\n');
}

describe('la liquidación impresa nombra UN solo producto', () => {
  it('la cabecera del papel dice `Likida`, que es lo que dice el pie', async () => {
    const renglones = (await textoImpreso()).split('\n');
    // Guarda del propio arnés: si el extractor deja de leer el PDF, esto lo
    // delata en vez de dejar pasar en vacío las afirmaciones de abajo.
    expect(renglones).toContain('LIQUIDACIÓN DE VIAJE');

    expect(renglones[0]).toBe('Likida');
    expect(renglones.some((r) => r.startsWith('Generado por Likida'))).toBe(true);
  });

  it('la marca vieja no sobrevive en ningún renglón', async () => {
    const renglones = (await textoImpreso()).split('\n');
    // `Cuadra exacto` y `Cuadrada` NO son la marca: son el verbo y el estatus,
    // lenguaje del dominio que el producto debe seguir imprimiendo. Lo que no
    // puede quedar es `Cuadra` nombrando al producto.
    const marca = renglones.filter((r) => /\bCuadra\b/.test(r) && !/^Cuadra exacto$/.test(r));
    expect(marca).toEqual([]);
  });
});
