import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA RECUPERACIÓN DEL CIERRE A MEDIAS NO PUEDE SER UNA VARIABLE DE ENTORNO —
// auditoría 11, ALTO (G-60).
//
// `guardar_liquidacion` corrió bien y una ronda posterior tiró el ciclo:
// `PartialExecutionError` trae esa tool en `partialToolCalls`, así que la
// liquidación YA está en la base, los dos PDF en storage y el contralor la ve
// en el panel. Todo lo que hace falta para cerrarle el ciclo al chofer está en
// memoria.
//
// Y se tiraba por `process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1'`, una
// bandera APAGADA por default que:
//   · `verificarEntornoCritico` (startup.ts) no mira,
//   · `.env.example:75` recomienda encendida —o sea que nadie sabe si lo está—,
//   · y `openrouter.ts:402` afirma por escrito que está «activo por default».
//
// Con la bandera ausente el chofer lee «se me trabó, ¿me reenvías?», reenvía, y
// recibe «No tienes un viaje abierto para liquidar ahorita». Su liquidación
// existe. Y `pdf.no_entregado` y `cerroSinEntregar` tampoco se disparan: los
// dos viven dentro de `if (closed)`.
//
// Un comportamiento del que depende el entregable no se configura: se hace.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const createSignedUrl = vi.fn();
const cuadrarDesdeDB = vi.fn();
const vincularCostosALiquidacion = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: vi.fn(), tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({
  subirComprobante: vi.fn(async () => 'ruta'), ligaComprobante: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  gastoPorHash: vi.fn(async () => null), corregirFechaGasto: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false),
  reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  confirmarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 18_000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
}));
vi.mock('@/lib/cuadra/cuadre/engine', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...a),
}));
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoDesglosado: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'),
  vincularCostosALiquidacion: (...a: unknown[]) => vincularCostosALiquidacion(...a),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: (...a: unknown[]) => createSignedUrl(...a) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');
const { PartialExecutionError } = await import('@/lib/llm/openrouter');

const salientes: { tipo: string; texto: string }[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  salientes.push({
    tipo: String(b.type ?? ''),
    texto: String((b.text as { body?: string } | undefined)?.body ?? ''),
  });
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa-listo' };

const PARCIAL = () => new PartialExecutionError(
  'el ciclo murió después de cerrar', new Error('boom'),
  [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado: true, pdf_contralor_generado: true }, durationMs: 5 }],
  10, 10, 0,
);

describe('el cierre a medias se recupera SIN que nadie haya puesto una variable', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); createSignedUrl.mockReset(); cuadrarDesdeDB.mockReset();
    vincularCostosALiquidacion.mockReset();
    logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    // LA CONDICIÓN DEL HALLAZGO: la bandera NO está puesta. Es el default de
    // producción — `verificarEntornoCritico` no la exige y nadie la verifica.
    delete process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL;
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/liq.pdf' }, error: null });
    cuadrarDesdeDB.mockResolvedValue({
      viajeId: 'v1', totalComprobado: 16_244, totalAnticipo: 18_000, diferencia: 1_756,
      estatus: 'cuadrada', diferencias: [], gastos: [],
      totalDeducible: 16_244, totalNoDeducible: 0, totalPorConfirmar: 0,
      ivaAcreditable: 0, peajeAcreditable: 0, litrosDieselAcreditables: 0, iepsAcreditable: 0,
    });
    runAgent.mockRejectedValue(PARCIAL());
  });

  it('EL HALLAZGO: no le dice «se me trabó» sobre una liquidación que YA cerró', async () => {
    await processInbound(listo);
    const textos = salientes.map((s) => s.texto).join(' ');
    expect(textos, 'la liquidación está en la base y el contralor ya la ve')
      .not.toMatch(/se me trab[óo] el sistema/i);
  });

  it('y le manda su PDF', async () => {
    await processInbound(listo);
    expect(salientes.some((s) => s.tipo === 'document'), 'el entregable del paso 3 del demo').toBe(true);
  });

  it('el costo de la liquidación queda ligado a ella', async () => {
    await processInbound(listo);
    expect(vincularCostosALiquidacion).toHaveBeenCalledWith('t1', 'v1', 'L1');
  });

  it('y queda escrito que esto fue una recuperación, no un cierre normal', async () => {
    await processInbound(listo);
    expect(logger.warn).toHaveBeenCalledWith('agent.cierre_parcial_recuperado',
      expect.objectContaining({ viaje: 'v1', liqId: 'L1' }));
  });

  // CONTROL: un fallo que NO alcanzó a cerrar sigue diciendo lo de siempre. Sin
  // este contraste, «no dice se me trabó» podría deberse a que el mock nunca
  // llega al catch.
  it('control: si NO se llegó a guardar la liquidación, sí se le dice que se trabó', async () => {
    runAgent.mockRejectedValue(new PartialExecutionError('boom', new Error('boom'), [], 10, 10, 0));
    await processInbound(listo);
    expect(salientes.map((s) => s.texto).join(' ')).toMatch(/se me trab[óo] el sistema/i);
    expect(salientes.some((s) => s.tipo === 'document')).toBe(false);
  });
});
