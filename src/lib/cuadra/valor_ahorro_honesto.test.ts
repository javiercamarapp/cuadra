import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-41 (ALTO, agéntico + tool-calling) — la pantalla que existe
// para justificar el precio contaba dos cosas que no ocurrieron.
//
//  1. «Amarrados a su viaje». Se contaba `resuelto_en !== null`, y esa columna
//     se llena TAMBIÉN cuando el operador contesta «no» y el comprobante se
//     DESCARTA (`repo.ts:341-345` escribe `resolucion: 'adjuntado' |
//     'descartado'` junto con `resuelto_en`). El chofer rechaza 6 comprobantes
//     por $16,244 y el contralor lee «Llegaron sin viaje: 6 · Amarrados a su
//     viaje: 6», con la nota "acabaron en su liquidación". No están en ninguna.
//     La columna que distingue los dos desenlaces existe y la consulta no la
//     miraba.
//
//  2. «Acciones resueltas por los agentes». Se cuentan filas de `llm_costo`
//     por fase, y `registrarCostoWhatsApp` (`costos.ts:86-88`) escribe una fila
//     por cada MENSAJE SALIENTE, con `tokensIn: 0` y `modelo:
//     'whatsapp-utility'`. O sea: mandar un WhatsApp se contaba como una acción
//     de IA, y en la gráfica "Acciones por agente" la barra más larga era
//     «Agente de WhatsApp», por delante del OCR y del cuadre.
//
// Es la pantalla que el propio `analytics.ts` declara «la más fácil de
// convertir en mentira». Las dos cifras se caen en la primera pregunta.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit', 'range', 'in', 'gte', 'lte', 'is', 'not']) b[m] = self;
  b.maybeSingle = () => Promise.resolve(resp());
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn() }));

const { getValorAhorro } = await import('./analytics');

const TENANT = 't1';
beforeEach(() => respuestas.clear());

describe('«Amarrados a su viaje» cuenta los que SÍ acabaron en una liquidación', () => {
  it('un comprobante DESCARTADO no está amarrado a nada', async () => {
    respuestas.set('comprobante_huerfano', {
      data: [
        { resuelto_en: '2026-08-01T10:00:00Z', resolucion: 'adjuntado' },
        { resuelto_en: '2026-08-01T11:00:00Z', resolucion: 'descartado' },
        { resuelto_en: '2026-08-01T12:00:00Z', resolucion: 'descartado' },
        { resuelto_en: null, resolucion: null },
      ],
      error: null,
    });

    const v = await getValorAhorro(TENANT);

    expect(v.huerfanosTotales, 'los cuatro llegaron sin viaje').toBe(4);
    expect(v.huerfanosResueltos, 'el chofer dijo que dos NO eran de ese viaje').toBe(1);
  });

  it('los descartados se cuentan aparte: existieron y el dueño puede quererlos ver', async () => {
    respuestas.set('comprobante_huerfano', {
      data: [
        { resuelto_en: '2026-08-01T10:00:00Z', resolucion: 'adjuntado' },
        { resuelto_en: '2026-08-01T11:00:00Z', resolucion: 'descartado' },
      ],
      error: null,
    });

    expect((await getValorAhorro(TENANT)).huerfanosDescartados).toBe(1);
  });

  it('una fila vieja resuelta SIN resolución no se cuenta como amarrada', async () => {
    // Antes de la 0040 no había columna. Contarla como "amarrada" es
    // exactamente el mismo invento, con otra causa.
    respuestas.set('comprobante_huerfano', {
      data: [{ resuelto_en: '2026-01-01T10:00:00Z', resolucion: null }],
      error: null,
    });

    expect((await getValorAhorro(TENANT)).huerfanosResueltos).toBe(0);
  });
});

describe('«Acciones resueltas por los agentes» no cuenta envíos de WhatsApp', () => {
  beforeEach(() => {
    respuestas.set('llm_costo', {
      data: [
        { fase: 'ocr' }, { fase: 'ocr' }, { fase: 'ocr' },
        { fase: 'cuadre' },
        { fase: 'whatsapp' }, { fase: 'whatsapp' }, { fase: 'whatsapp' },
        { fase: 'whatsapp' }, { fase: 'whatsapp' }, { fase: 'whatsapp' },
      ],
      error: null,
    });
  });

  it('la barra más larga era mandar mensajes, y no es una acción de IA', async () => {
    const fases = (await getValorAhorro(TENANT)).accionesPorAgente.map((a) => a.fase);
    expect(fases, 'una fila por mensaje saliente, con 0 tokens de entrada').not.toContain('whatsapp');
  });

  it('y el total no las suma: eran 10 de 19 "acciones" en el tenant del demo', async () => {
    const v = await getValorAhorro(TENANT);
    expect(v.accionesPorAgente.reduce((s, a) => s + a.n, 0)).toBe(4);
  });

  it('CONTROL · el OCR y el cuadre siguen contándose enteros', async () => {
    const v = await getValorAhorro(TENANT);
    expect(v.accionesPorAgente.find((a) => a.fase === 'ocr')?.n).toBe(3);
    expect(v.accionesPorAgente.find((a) => a.fase === 'cuadre')?.n).toBe(1);
  });
});
