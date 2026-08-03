import { NextResponse } from 'next/server';
import { cuadrarViaje, type PoliticaGasto } from '@/lib/cuadra/cuadre/engine';
import { rateLimit, bodyExcede, clientIp } from '@/lib/ratelimit';
import { envHealth } from '@/lib/env';
import type { Gasto } from '@/types/cuadra';

// Health del demo (config detectada, sin exponer valores).
export async function GET() {
  return NextResponse.json({ ok: true, config: envHealth() });
}

export const runtime = 'nodejs';

// Demo determinístico (sin LLM ni DB) — corre el MOTOR DE CUADRE real sobre
// comprobantes de ejemplo. Robusto para una demo en vivo: nunca depende de red.

// 🔴 INVENTADO: la flota del simulador. Es el mismo valor que `seed.sql`, con
// dígito verificador válido — si divergen, el demo por WhatsApp y el simulador
// dan veredictos distintos sobre el mismo comprobante.
const RFC_FLOTA_DEMO = 'TIN010101AA5';

// 🔴 INVENTADO: política de fantasía para el demo (misma que seed.sql).
// Ajústala con la política real de Innovativos.
const POLITICA: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 4000 },
  { concepto: 'caseta', topeMonto: 1500 },
  { concepto: 'alimentacion', topeMonto: 800 },
  { concepto: 'hospedaje', topeMonto: 2500 },
  { concepto: 'transporte', topeMonto: 800 },
  { concepto: 'flete' },
  { concepto: 'factura', requiereCfdi: true },
];

export async function POST(req: Request) {
  if (bodyExcede(req, 64 * 1024)) return NextResponse.json({ error: 'payload muy grande' }, { status: 413 });
  if (!rateLimit(`demo:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: 'demasiadas peticiones' }, { status: 429 });
  const body = (await req.json()) as { comprobantes: Partial<Gasto>[]; anticipo: number };
  const gastos: Gasto[] = (body.comprobantes ?? []).map((c, i) => ({
    id: `g${i}`,
    concepto: c.concepto ?? 'otro',
    monto: c.monto ?? 0,
    folio: c.folio,
    cfdiUuid: c.cfdiUuid,
    // FE-2 (auditoría 10, ALTO reincidente). El receptor viajaba perdido: la
    // burbuja del simulador decía "CFDI validado por QR ✅" y dos burbujas
    // después el motor —con razón— pedía "reenvía una foto más clara del QR",
    // porque el gasto llegaba aquí sin `rfcReceptor`. El motor no se tocó; lo
    // que faltaba era pasar el dato que la burbuja ya afirmaba tener.
    rfcReceptor: c.rfcReceptor,
    ocrConfianza: c.ocrConfianza ?? 0.96,
  }));
  const liq = cuadrarViaje({
    viajeId: 'demo', anticipo: body.anticipo ?? 0, gastos, politica: POLITICA, ruta: 'Silao-Laredo',
    // Sin `empresaRfc` el motor no puede comparar contra nadie, así que la
    // verificación del receptor quedaba a medias: detectaba "no lo pude leer"
    // pero nunca "está a nombre de otro". Con la flota del demo declarada, las
    // dos ramas quedan vivas — el CFDI del preset se confirma, y uno timbrado a
    // un tercero se marca. Es el mismo RFC del seed, con dígito verificador
    // válido (d08db8a).
    empresaRfc: RFC_FLOTA_DEMO,
  });
  return NextResponse.json({
    totalComprobado: liq.totalComprobado,
    totalAnticipo: liq.totalAnticipo,
    diferencia: liq.diferencia,
    estatus: liq.estatus,
    diferencias: liq.diferencias.map((d) => ({ tipo: d.tipo, nota: d.nota, monto: d.monto })),
  });
}
