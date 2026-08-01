import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · AG-1 (CRÍTICO) — EL CIERRE SE DABA POR ENTREGADO SIN MIRAR SI
// META ACEPTÓ EL PDF.
//
// `sendText` se cambió a `Promise<string | null>` precisamente para que un
// llamador pudiera saber si el mensaje salió, y `ponerAvisoADisposicion` sí lo
// usa. El camino del ENTREGABLE no lo usaba: `sendDocument` devolvía `void` y
// ante un `!res.ok` registraba y RETORNABA NORMAL, así que el `try/catch` que
// lo envuelve no se disparaba nunca.
//
// ESCENARIO REAL. `WHATSAPP_ACCESS_TOKEN` vencido —pasó el 28-jul-2026 y está
// documentado en `meta/client.ts`—. El operador escribe "listo":
//
//   · `guardar_liquidacion` cuadra, sube los dos PDF, emite la liquidación
//     y deja el viaje en `liquidado`
//   · Meta responde 401 al documento → `sendDocument` retorna void
//   · `pdf.no_entregado` NO se escribe: no hubo excepción
//   · el "no pude generarte el PDF" NO se manda: vive en ese mismo catch
//
// El operador reenvía "listo", `getOpenViaje` devuelve `null` y recibe "no
// tienes un viaje abierto". Callejón sin salida: liquidación emitida, PDF en
// storage, panel del contralor completo, y el chofer creyendo que no pasó nada.
//
// POR QUÉ NINGUNA PRUEBA LO VEÍA. `processor_cierre.test.ts` mockea
// `sendDocument: vi.fn()`, que devuelve `undefined` — exactamente lo mismo que
// devolvía al ser rechazado. La suite no podía distinguir entregado de
// rechazado. Por eso esta prueba usa el cliente REAL y mockea solo la Graph API.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const createSignedUrl = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Estado HTTP con el que la Graph API contesta al envío del documento. */
let estadoDocumento = 200;

type Salida = { body: Record<string, unknown> };
const salientes: Salida[] = [];
const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/messages')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (body.type === 'document' && estadoDocumento !== 200) {
      return new Response(JSON.stringify({ error: { message: 'Error validating access token' } }), { status: estadoDocumento });
    }
    salientes.push({ body });
    return ok({ messages: [{ id: 'wamid.TEST' }] });
  }
  return ok({});
});
const textos = () => salientes.filter((s) => s.body.type === 'text').map((s) => String((s.body.text as { body: string }).body));
const documentos = () => salientes.filter((s) => s.body.type === 'document');

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a), upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };
const cierre = {
  finalText: 'Listo, cerré tu viaje',
  toolCalls: [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado: true }, durationMs: 5 }],
  model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
};

beforeEach(() => {
  salientes.length = 0;
  estadoDocumento = 200;
  runAgent.mockReset(); runAgent.mockResolvedValue(cierre);
  createSignedUrl.mockReset(); createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/liq.pdf' }, error: null });
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
});

describe('un PDF que Meta rechaza no cuenta como entregado', () => {
  // CONTROL: sin esto, lo de abajo pasaría igual si el cierre dejara de correr.
  it('control — con Meta aceptando, el documento sale y no se registra fallo', async () => {
    await processInbound(listo);
    expect(documentos()).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalledWith('pdf.no_entregado', expect.anything());
  });

  it('con Meta rechazando el documento (401), se registra `pdf.no_entregado`', async () => {
    estadoDocumento = 401;
    await processInbound(listo);
    expect(documentos()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith('pdf.no_entregado', expect.objectContaining({ viaje: 'v1' }));
  });

  it('y se le dice al operador, en vez de dejarlo creyendo que no pasó nada', async () => {
    estadoDocumento = 401;
    await processInbound(listo);
    expect(textos().join(' ')).toMatch(/no pude|panel|contralor/i);
  });
});
