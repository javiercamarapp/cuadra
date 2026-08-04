import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

// ═══════════════════════════════════════════════════════════════════════════
// LA IMAGEN QUE CUESTA DINERO IBA A RESOLUCIÓN NATIVA; LA QUE NO CUESTA NADA,
// REDUCIDA. (auditoría 10, MEDIO)
//
// El mismo buffer sigue dos caminos. El GRATIS (zxing, CPU local,
// `cfdi.ts:243-249`) se reduce a 1 600 px porque el repo ya midió que a
// resolución nativa «cuesta segundos y no encuentra nada que no encuentre la de
// 1 600 px», y el comentario nombra el caso real: «una foto de 24 Mpx». El CARO
// —la llamada de visión— recibía el original de 24 Mpx, en base64 (33 % más de
// cuerpo), dentro de un `reloj.senal(25_000)`.
//
// Los números. La estimación escrita en el repo es $0.015 por visión
// (`processor.ts:503,794`). A `PRICES['google/gemini-3.6-flash'] = [1.5, 7.5]`
// USD/1M, los 1 000–1 800 tokens de razonamiento que el propio repo midió
// (`openrouter.ts:41-45`) más ~100 de JSON ya cuestan $0.0083–$0.0143 SOLO de
// salida. A la entrada le quedan entre $0.0007 y $0.0067, o sea entre 500 y
// 4 500 tokens de imagen. Al ritmo de ~258 tokens por tesela de 768×768, una foto
// de 5 657×4 243 son ~48 teselas ≈ 12 400 tokens: fuera del presupuesto por casi
// 3×, y con 8 comprobantes por viaje el error se multiplica por 8 contra los
// $0.03–0.05 por liquidación que declara `models.ts:17`.
//
// El tope es 2 000 px de lado mayor —~6 teselas, ~1 550 tokens, dentro del rango
// que la propia cuenta admite— y NO amplía: la foto típica de WhatsApp Cloud API
// (que ya llega recomprimida, con tope de 5 MB) pasa intacta. Lo que se acota es
// el caso patológico, que es el único que rompe la cuenta.
// ═══════════════════════════════════════════════════════════════════════════

const generateStructured = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateStructured: (...a: unknown[]) => generateStructured(...a) };
});

const { extraerComprobante } = await import('./ocr');

const respuesta = {
  data: {
    concepto: 'diesel', producto: null, monto: 1000, subtotal: null, iva_monto: null,
    iva_tasa: null, litros: null, precio_unitario: null, forma_pago: 'tarjeta',
    fecha: '2026-07-27', folio: '1404755', web_id: null, estacion: null,
    rfc_emisor: null, cfdi_uuid: null, confianza: 0.95, legible: true,
  },
  raw: '{}', model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 200, cost: 0.01,
  porModelo: [{ model: 'google/gemini-3.6-flash', tokensIn: 100, tokensOut: 200, cost: 0.01 }],
};

/** Una foto plana de w×h, como data-URL — sin QR que decodificar. */
async function foto(w: number, h: number): Promise<string> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** Lo que de verdad se le mandó al modelo. */
function imagenEnviada(): string {
  return (generateStructured.mock.calls[0][0] as { images: string[] }).images[0];
}
async function medir(dataUrl: string) {
  const buf = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  return { width, height, bytes: buf.length };
}

describe('la foto que paga tokens no va a resolución nativa', () => {
  beforeEach(() => { generateStructured.mockReset(); generateStructured.mockResolvedValue(respuesta); });

  it('una foto de 24 Mpx se acota antes de gastar la llamada de visión', async () => {
    const original = await foto(5_657, 4_243);
    await extraerComprobante(original);

    const enviada = await medir(imagenEnviada());
    expect(Math.max(enviada.width, enviada.height), 'se mandó el original de 24 Mpx').toBeLessThanOrEqual(2_000);
    // Y el cuerpo baja de verdad: base64 le suma 33 % a lo que viaje.
    const antes = await medir(original);
    expect(enviada.bytes).toBeLessThan(antes.bytes);
  });

  it('la foto típica de WhatsApp pasa INTACTA — no se reescala hacia arriba ni se recomprime', async () => {
    // El tope no puede degradar el camino corriente: si lo hiciera, se estaría
    // cambiando lectura de comprobantes por ahorro de tokens, y un ticket mal
    // leído cuesta más que la llamada entera.
    const original = await foto(1_280, 960);
    await extraerComprobante(original);
    expect(imagenEnviada()).toBe(original);
  });

  it('el lado corto se mantiene en proporción: no se deforma el ticket', async () => {
    await extraerComprobante(await foto(4_000, 1_000));
    const { width, height } = await medir(imagenEnviada());
    expect(width).toBe(2_000);
    expect(height).toBe(500);
  });

  it('si el redimensionado falla, se manda el original: nunca se pierde la lectura', async () => {
    // Un data-URL que sharp no puede abrir. Antes de ahorrar tokens está leer el
    // comprobante: el fallback es el comportamiento de siempre.
    const roto = 'data:image/jpeg;base64,bm8gc295IHVuYSBpbWFnZW4=';
    await extraerComprobante(roto);
    expect(imagenEnviada()).toBe(roto);
  });
});
