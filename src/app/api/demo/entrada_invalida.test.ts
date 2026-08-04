import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-61 (residual) — el simulador aceptaba un cuerpo que no era
// JSON y un anticipo que no era un número.
//
// `const body = (await req.json())` sin `try`: un cuerpo malformado sale como
// un 500 genérico de Next en la pantalla que se proyecta cuando Meta falla.
//
// Y peor, porque no falla: `{"anticipo": "cinco mil"}` entra tal cual al motor
// —que es real, no una maqueta— y sale `"diferencia": null`. El simulador
// anuncia «El cuadre es real»; un veredicto nulo sobre una cifra inventada es
// exactamente lo que este producto no puede permitirse enseñar.
// ═══════════════════════════════════════════════════════════════════════════

const { POST } = await import('./route');

let ip = 0;
/** IP distinta por llamada: el rate-limit del simulador es 30/min por IP. */
const pedir = (cuerpo: string) =>
  POST(new Request('http://localhost/api/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${++ip}` },
    body: cuerpo,
  }));

describe('G-61 · /api/demo no cuadra sobre basura', () => {
  it('un cuerpo que no es JSON responde 400, no un 500 genérico', async () => {
    const res = await pedir('{no soy json');

    expect(res.status).toBe(400);
  });

  it('un anticipo que no es número se rechaza — no sale `diferencia: null`', async () => {
    const res = await pedir(JSON.stringify({ comprobantes: [], anticipo: 'cinco mil' }));

    expect(res.status, 'el motor cuadró contra NaN y devolvió un veredicto nulo').toBe(400);
    expect((await res.json()).diferencia).toBeUndefined();
  });

  it('un monto que no es número tampoco', async () => {
    const res = await pedir(JSON.stringify({
      comprobantes: [{ concepto: 'diesel', monto: 'mucho' }], anticipo: 1000,
    }));

    expect(res.status).toBe(400);
  });

  it('`comprobantes` que no es lista se rechaza', async () => {
    const res = await pedir(JSON.stringify({ comprobantes: 'diesel', anticipo: 1000 }));

    expect(res.status).toBe(400);
  });

  // ── CONTROL ──────────────────────────────────────────────────────────────
  // Sin esto, "responder 400 siempre" pasaría las cuatro y apagaría el
  // simulador entero justo cuando Meta falla y es lo único que queda.

  it('CONTROL · un cuerpo válido sigue cuadrando y devuelve el veredicto', async () => {
    const res = await pedir(JSON.stringify({
      comprobantes: [{ concepto: 'diesel', monto: 4000, folio: 'A-1' }],
      anticipo: 5000,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalComprobado).toBe(4000);
    expect(body.totalAnticipo).toBe(5000);
    expect(typeof body.diferencia).toBe('number');
  });
});
