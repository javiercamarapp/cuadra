import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 17 · CRÍTICO (agéntico) — al contralor le llegaba por WhatsApp el
// ejemplar del OPERADOR, que está filtrado a propósito para esconderle los
// veredictos fiscales.
//
// `guardar_liquidacion` sube DOS PDF (`tools.ts`): `{tenant}/{viaje}.pdf` es el
// completo —lo que el contralor archiva y lo que queda en `liquidacion.pdf_path`—
// y `{tenant}/{viaje}-operador.pdf` lleva el mismo filtro `SOLO_CONTRALOR` que el
// mensaje de WhatsApp del chofer: sin `cfdi_efos`, `cfdi_cancelado`,
// `rfc_receptor`…
//
// El processor firmaba SOLO el del operador (correcto para el chofer) y reusaba
// ESA MISMA URL firmada para `avisarCierreAlJefe`. Resultado: a la oficina le
// llegaba (a) un texto que sí dice "proveedor en lista 69-B" y (b) adjunto, un
// PDF que no trae esa línea — dos documentos del mismo cierre que se contradicen,
// en manos de quien decide la compra, y en TODO cierre, no en un borde.
//
// Esta prueba fija QUÉ ejemplar recibe cada quién. Sin el arreglo, el `expect`
// del `urlPdf` del jefe recibe la liga del `-operador.pdf` y falla.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const createSignedUrl = vi.fn();
type ArgsAviso = { tenantId: string; viajeId: string; urlPdf?: string | null };
const avisarCierreAlJefe = vi.fn(async (a: ArgsAviso) => {
  void a; // lo que importa es el argumento capturado en `mock.calls`
  return { enviado: true, motivo: undefined as string | undefined };
});
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const salientes: { url: string; body: Record<string, unknown> }[] = [];
const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/messages')) {
    salientes.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    return ok({ messages: [{ id: 'wamid.TEST' }] });
  }
  return ok({ url: 'https://media.test/x', mime_type: 'text/xml' });
});
const documentos = () => salientes.filter((s) => s.body.type === 'document');

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/avisar_cierre', () => ({
  avisarCierreAlJefe: (a: ArgsAviso) => avisarCierreAlJefe(a),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [], cierreSinComprobantes: true })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
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
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'gte', 'lte', 'or', 'order', 'in', 'is', 'limit']) b[m] = self;
      b.range = async () => ({ data: [], error: null, count: 0 });
      b.maybeSingle = async () => ({ data: null, error: null });
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    },
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a), upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };
const cierre = {
  finalText: 'Listo, cerré tu viaje',
  toolCalls: [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado: true, pdf_contralor_generado: true }, durationMs: 5 }],
  model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
};

/** La liga firmada lleva el path dentro: así se distingue un ejemplar del otro. */
const firmaSegunPath = async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?sig=x` }, error: null });

beforeEach(() => {
  salientes.length = 0;
  runAgent.mockReset(); runAgent.mockResolvedValue(cierre);
  createSignedUrl.mockReset(); createSignedUrl.mockImplementation(firmaSegunPath);
  avisarCierreAlJefe.mockClear();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
});

describe('cada quien recibe SU ejemplar del PDF', () => {
  it('al chofer se le manda el ejemplar filtrado del operador (control)', async () => {
    await processInbound(listo);
    expect(documentos()).toHaveLength(1);
    expect(String(((documentos()[0].body.document) as { link: string }).link)).toContain('v1-operador.pdf');
  });

  it('al jefe se le manda el ejemplar COMPLETO del contralor, no el del operador', async () => {
    await processInbound(listo);
    expect(avisarCierreAlJefe).toHaveBeenCalledTimes(1);
    const arg = avisarCierreAlJefe.mock.calls[0][0];
    // El del contralor: `{tenant}/{viaje}.pdf`, sin el sufijo `-operador`.
    expect(arg.urlPdf).toContain('t1/v1.pdf');
    expect(arg.urlPdf).not.toContain('-operador');
  });

  it('se firman los DOS ejemplares, cada uno con TTL de 60s', async () => {
    await processInbound(listo);
    const paths = createSignedUrl.mock.calls.map((c) => String(c[0]));
    expect(paths).toContain('t1/v1-operador.pdf');
    expect(paths).toContain('t1/v1.pdf');
    for (const c of createSignedUrl.mock.calls) expect(c[1]).toBe(60);
  });
});
