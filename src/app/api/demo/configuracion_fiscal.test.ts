import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (fiscal) — «/api/demo corre el motor real sin ninguna
// configuración fiscal».
//
// La página `/demo` anuncia «El cuadre es real» y es el Plan B que
// `GUION_DEMO.md:35` manda tener abierto en otra pestaña. Corría
// `cuadrarViaje` sin `estimulos`, sin `hidrocarburos` y sin `hoy`, mientras
// `cuadre/desde_db.ts` —la puerta de WhatsApp, sobre los MISMOS comprobantes—
// los pasa todos.
//
// Consecuencia medida: `engine.ts` condiciona TODO el bloque del tope de
// alimentación a `if (topeAlimentacion != null)` (el $750/día de LISR 28-V,
// que llega dentro de `estimulos`). Sin ese objeto la regla NO CORRE: una
// alimentación de $3,000 timbrada salía por esta puerta sin una sola
// observación, y por `desde_db` con `viatico_excede_fiscal`. El mismo hecho,
// dos veredictos, según qué puerta lo evaluó.
//
// `normas/lisr-28-V.yaml` (`verificado_fuente_primaria`), `texto_vigente`,
// literal: «Tratándose de gastos de viaje destinados a la alimentación, éstos
// sólo serán deducibles hasta por un monto que no exceda de $750.00 diarios por
// cada beneficiario, cuando los mismos se eroguen en territorio nacional...».
//
// La configuración que se pasa es `DEMO_CONFIG` —la misma de `config.ts` que
// `getConfig` usa como base para todo tenant—, no una copia nueva: dos juegos
// de topes fiscales se separan en silencio.
// ═══════════════════════════════════════════════════════════════════════════

const { POST } = await import('./route');

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

describe('/api/demo corre el motor con la MISMA configuración fiscal que la puerta de WhatsApp', () => {
  it('el tope de alimentación de LISR 28-V corre: $3,000 timbrados no pasan callados', async () => {
    const r = await cuadrar({
      anticipo: 3000,
      comprobantes: [{
        concepto: 'alimentacion', monto: 3000, folio: 'AL-1',
        cfdiUuid: 'd1b2c3d4-e5f6-7890-abcd-ef1234567890', rfcReceptor: 'TIN010101AA5',
      }],
    });
    const tope = r.diferencias.find((d) => d.tipo === 'viatico_excede_fiscal');
    expect(tope, 'el simulador omite una observación fiscal que el producto sí emite').toBeDefined();
    // El excedente es sobre lo TIMBRADO: $3,000 − $750 = $2,250.
    expect(tope!.monto).toBe(2250);
    expect(tope!.nota).toContain('LISR 28-V');
    expect(tope!.nota).toContain('$750.00');
  });

  it('el tope llega de `DEMO_CONFIG.estimulos`, no de un literal escrito otra vez aquí', async () => {
    const { DEMO_CONFIG } = await import('@/lib/cuadra/config');
    const r = await cuadrar({
      anticipo: 3000,
      comprobantes: [{
        concepto: 'alimentacion', monto: 3000, folio: 'AL-1',
        cfdiUuid: 'd1b2c3d4-e5f6-7890-abcd-ef1234567890', rfcReceptor: 'TIN010101AA5',
      }],
    });
    const tope = r.diferencias.find((d) => d.tipo === 'viatico_excede_fiscal')!;
    expect(tope.monto).toBe(3000 - DEMO_CONFIG.estimulos.viaticosTopeFiscalDiarioMxn);
  });

  it('el guion del demo NO cambia: sigue cuadrando exacto con el diésel sobre política como única observación', async () => {
    const r = await cuadrar({
      anticipo: 10600,
      comprobantes: [
        { concepto: 'diesel', monto: 4200, folio: 'DS-8801' },
        { concepto: 'diesel', monto: 3800, folio: 'DS-8802' },
        { concepto: 'caseta', monto: 1400, folio: 'CA-4471' },
        {
          concepto: 'factura', monto: 1200, folio: 'FA-9007',
          cfdiUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', rfcReceptor: 'TIN010101AA5',
        },
      ],
    });
    expect(r.totalComprobado).toBe(10600);
    expect(r.diferencia).toBe(0);
    expect(r.diferencias.filter((d) => d.tipo !== 'anticipo').map((d) => d.tipo)).toEqual(['sobre_politica']);
  });
});
