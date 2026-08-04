import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA AFIRMACIÓN TIENE QUE SER RESPUESTA A UNA PREGUNTA — auditoría 11, G-19.
//
// `comprobante_huerfano.ofrecido_en` (mig. 0040) es un TIMESTAMP: guarda CUÁNDO
// se preguntó, no EN QUÉ VIAJE. Y el processor decidía con
// `enEspera.filter(h => h.ofrecidoEn)` + `esAfirmacion(msg.text)`, dos hechos
// que no se tocan entre sí.
//
// Escenario medido: el 15-jul, con el viaje V2 abierto, se le ofrecen 6
// comprobantes ($6,412.00); el chofer no contesta y V2 cierra. El 20-jul abre
// V3 y escribe «va» —contestando cualquier otra cosa, o simplemente saludando
// con un monosílabo que `esAfirmacion` reconoce—. Los $6,412.00 de V2 entran a
// V3 sin una sola marca de fecha sospechosa: la tolerancia de fecha son 30 días.
//
// Es LITERALMENTE la frase con la que la mig. 0040 se justifica: «un ticket del
// viaje anterior metido en éste es dinero en la liquidación equivocada, y nadie
// lo nota hasta que el contralor paga».
//
// La constancia deja de ser "se preguntó" y pasa a ser "se preguntó PARA ESTE
// VIAJE". Sin schema nuevo: `viaje_id` ya existe en la 0040 y es exactamente el
// viaje al que la fila se va a adjuntar si el chofer dice que sí.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const getHuerfanos = vi.fn();
const resolverHuerfanos = vi.fn();
const marcarHuerfanosOfrecidos = vi.fn();
const getOpenViaje = vi.fn();
const getGastos = vi.fn();
const runAgent = vi.fn();
const intakeDelta = vi.fn();
const acquireViajeLock = vi.fn();
const releaseViajeLock = vi.fn();

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
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: (...a: unknown[]) => acquireViajeLock(...a),
  releaseViajeLock: (...a: unknown[]) => releaseViajeLock(...a),
  releaseMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  addGasto: (...a: unknown[]) => addGasto(...a),
  guardarHuerfano: vi.fn(async () => true),
  getHuerfanos: (...a: unknown[]) => getHuerfanos(...a),
  resolverHuerfanos: (...a: unknown[]) => resolverHuerfanos(...a),
  marcarHuerfanosOfrecidos: (...a: unknown[]) => marcarHuerfanosOfrecidos(...a),
  getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  corregirFechaGasto: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false),
  reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v3', anticipo: 3000, origen: 'Silao', destino: 'N. Laredo', fechaInicio: '2026-07-20' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
}));
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoDesglosado: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const texto = (t: string) => ({ from: '5219993700779', type: 'text' as const, text: t, waMessageId: `wa-${t}` });

/** Un huérfano que ya se ofreció, y el viaje EN EL QUE se ofreció. */
const OFRECIDO_EN = (id: string, monto: number, viaje: string | undefined) => ({
  id, gasto: { id: `g-${id}`, concepto: 'diesel', monto, ocrExtra: {} },
  motivo: 'sin_viaje' as const, creadoEn: '2026-07-15T10:00:00Z',
  ofrecidoEn: '2026-07-15T10:05:00Z',
  ofrecidoParaViaje: viaje,
});

describe('el «va» solo contesta la pregunta que se le hizo EN ESTE viaje', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, getHuerfanos, resolverHuerfanos, marcarHuerfanosOfrecidos,
                     getOpenViaje, getGastos, runAgent, intakeDelta, acquireViajeLock, releaseViajeLock]) m.mockReset();
    intakeDelta.mockResolvedValue(1);
    acquireViajeLock.mockResolvedValue(true);
    releaseViajeLock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue('v3');      // ← el viaje ABIERTO HOY
    getGastos.mockResolvedValue([]);
    addGasto.mockResolvedValue(undefined);
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  // EL HALLAZGO.
  it('un «va» NO adjunta a V3 lo que se ofreció en V2', async () => {
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 6_112, 'v2'), OFRECIDO_EN('b', 300, 'v2')]);
    await processInbound(texto('va'));
    expect(addGasto, 'esos $6,412.00 son del viaje anterior').not.toHaveBeenCalled();
    expect(resolverHuerfanos, 'y no se pueden marcar como adjuntados a V3')
      .not.toHaveBeenCalledWith('t1', expect.anything(), 'adjuntado', 'v3');
  });

  it('en vez de adjuntar a ciegas, vuelve a preguntar — ahora POR ESTE viaje', async () => {
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 6_112, 'v2')]);
    await processInbound(texto('va'));
    expect(salientes.join(' ')).toMatch(/¿Los agrego a este viaje\?/);
    expect(marcarHuerfanosOfrecidos, 'la constancia dice para QUÉ viaje se preguntó')
      .toHaveBeenCalledWith('t1', ['a'], 'v3');
  });

  it('una oferta vieja sin viaje anotado tampoco se da por contestada', async () => {
    // Las filas que ya existían en la base cuando esto se arregló traen
    // `ofrecido_en` con `viaje_id` nulo. Contarlas como ofrecidas para el viaje
    // de hoy sería exactamente el fallo, con datos heredados.
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 6_112, undefined)]);
    await processInbound(texto('va'));
    expect(addGasto).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/¿Los agrego a este viaje\?/);
  });

  it('lo ofrecido EN ESTE viaje sí se adjunta con un «va»', async () => {
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 2_890, 'v3')]);
    await processInbound(texto('va'));
    expect(addGasto).toHaveBeenCalledTimes(1);
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'adjuntado', 'v3');
  });

  it('un «no» solo descarta lo que se preguntó aquí, no la sala de espera entera', async () => {
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 100, 'v3'), OFRECIDO_EN('b', 200, 'v2')]);
    await processInbound(texto('no'));
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'descartado', null);
  });

  // La segunda mitad del hallazgo: el mensaje del «no» prometía un rescate
  // («dime cuál y lo pongo») que ningún lector implementa — no hay nada que
  // interprete «el de la caseta sí». Lo que SÍ funciona es reenviar la foto:
  // el comprobante entra por el camino normal, al viaje abierto.
  it('el «no» promete lo que el sistema sí sabe hacer', async () => {
    getHuerfanos.mockResolvedValue([OFRECIDO_EN('a', 100, 'v3')]);
    await processInbound(texto('no'));
    const m = salientes.join(' ');
    expect(m, 'nadie lee «dime cuál»').not.toMatch(/dime cu[áa]l/i);
    expect(m, 'reenviar la foto sí funciona').toMatch(/reenv[íi]a|m[áa]ndame/i);
  });
});
