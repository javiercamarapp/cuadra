import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FE-2, ALTO REINCIDENTE de las auditorías 10 (2-ago y 3-ago) — el simulador
// se contradice solo, en el peor momento posible.
//
// `/demo` es el Plan B que GUION_DEMO.md:35 manda tener abierto en otra
// pestaña: se usa exactamente cuando Meta falla. Y ahí:
//
//   1. Se aprieta «Factura CFDI $1,200» → «Recibí tu factura de $1,200.00
//      (CFDI validado por QR ✅)». La palomita se dispara porque el preset
//      trae el campo `cfdiUuid`, no porque nada se haya validado.
//   2. Se aprieta «cerrar» → «No se puede verificar a nombre de quién está la
//      factura: el receptor no se pudo leer del comprobante. Queda a
//      revisión — reenvía el XML o una foto más clara del QR.»
//
// El motor tiene razón: `api/demo/route.ts` armaba el gasto SIN `rfcReceptor`
// y llamaba a `cuadrarViaje` SIN `empresaRfc`, así que un CFDI cuyo receptor
// no se puede leer va a revisión — que es la conducta correcta y está probada
// aparte. Quien mentía era la burbuja.
//
// El arreglo va sobre el FIXTURE, no sobre el motor: si el preset dice que el
// QR se leyó, el payload tiene que llevar lo que un QR leído entrega. Mismo
// criterio que el arreglo del RFC del seed (d08db8a).
//
// Esta prueba ejecuta la ruta real.
// ═══════════════════════════════════════════════════════════════════════════

const { POST } = await import('./route');

/** Los cuatro presets de `demo/page.tsx`, con el anticipo del guion. */
const CUERPO = {
  anticipo: 10600,
  comprobantes: [
    { concepto: 'diesel', monto: 4200, folio: 'DS-8801' },
    { concepto: 'diesel', monto: 3800, folio: 'DS-8802' },
    { concepto: 'caseta', monto: 1400, folio: 'CA-4471' },
    {
      concepto: 'factura', monto: 1200, folio: 'FA-9007',
      cfdiUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      rfcReceptor: 'TIN010101AA5',
    },
  ],
};

async function cuadrar(cuerpo: unknown) {
  const res = await POST(new Request('https://likida.ai/api/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  }));
  return res.json() as Promise<{
    estatus: string; totalComprobado: number; diferencia: number;
    diferencias: Array<{ tipo: string; nota: string; monto: number }>;
  }>;
}

describe('el veredicto de /demo no contradice lo que las burbujas ya afirmaron', () => {
  it('la factura que el demo dice «validada por QR» NO sale a revisión por receptor ilegible', async () => {
    const r = await cuadrar(CUERPO);
    const tipos = r.diferencias.map((d) => d.tipo);
    expect(tipos, 'la burbuja dijo ✅ y el veredicto pedía «reenvía una foto más clara del QR»')
      .not.toContain('rfc_receptor_no_verificable');
  });

  it('la ÚNICA observación es el diésel sobre política, que es la que el guion viene a lucir', async () => {
    const r = await cuadrar(CUERPO);
    const obs = r.diferencias.filter((d) => d.tipo !== 'anticipo');
    expect(obs.map((d) => d.tipo)).toEqual(['sobre_politica']);
    expect(obs[0].monto).toBe(200);
  });

  it('y las cifras del guion se conservan: comprobado $10,600 y cuadra exacto', async () => {
    const r = await cuadrar(CUERPO);
    expect(r.totalComprobado).toBe(10600);
    expect(r.diferencia).toBe(0);
  });

  // CONTROL. El motor debe SEGUIR mandando a revisión un CFDI cuyo receptor de
  // verdad no se puede leer: el arreglo es del fixture, no del motor. Si esto
  // se pusiera verde, habríamos apagado la validación en vez de completar el
  // dato, que es el modo de fallo que la auditoría 8 documentó como AL-6.
  it('un CFDI SIN receptor legible sigue yendo a revisión — no se apagó la validación', async () => {
    const r = await cuadrar({
      anticipo: 1200,
      comprobantes: [{ concepto: 'factura', monto: 1200, folio: 'FA-1', cfdiUuid: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890' }],
    });
    expect(r.diferencias.map((d) => d.tipo)).toContain('rfc_receptor_no_verificable');
  });

  // Y un CFDI a nombre de OTRA empresa tampoco puede colarse por la puerta que
  // este arreglo abre: al pasar `empresaRfc`, el motor ahora sí compara.
  it('un CFDI timbrado a un TERCERO se marca — la comparación quedó encendida, no apagada', async () => {
    const r = await cuadrar({
      anticipo: 1200,
      comprobantes: [{
        concepto: 'factura', monto: 1200, folio: 'FA-2',
        cfdiUuid: 'c1b2c3d4-e5f6-7890-abcd-ef1234567890',
        rfcReceptor: 'ENE160518AB1',
      }],
    });
    expect(r.diferencias.map((d) => d.tipo)).toContain('rfc_receptor');
  });
});
