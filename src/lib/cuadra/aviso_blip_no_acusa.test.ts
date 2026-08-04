import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// UN BLIP DE SUPABASE NO PUEDE ACUSAR AL COMPRADOR — auditoría 11, G-58 (ALTO).
//
// `ponerAvisoADisposicion` devolvía `false` ante CUALQUIER excepción, así que
// «el tenant no tiene razón social» y «la base no contestó» entraban por el
// mismo `return`. Aguas arriba solo había un texto:
//
//   «tu empresa aún no ha terminado de configurar su aviso de privacidad»
//
// A las 10:12 del demo, con `acotada` convirtiendo un cuelgue en ese mismo
// error, el producto le dice por escrito al chofer que su flota —el comprador,
// sentado en la sala— no terminó de darse de alta. Por un tropiezo de red.
//
// La regla del repo es «fallar cerrado Y DECIRLO»: aquí fallaba cerrado y decía
// otra cosa. `resolveOperador` y `getOpenViaje` ya distinguen los dos hechos.
//
// Y el `return` del corte va ANTES del brazo de imagen, así que la foto se
// descartaba SIN liberar el claim del mensaje: `wa_mensaje_procesado` se
// quedaba con ese `waMessageId` para siempre, al revés que sus dos vecinos.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const getDatosResponsable = vi.fn();
const releaseMessageClaim = vi.fn();
const sendText = vi.fn();
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
  releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
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
  getDatosResponsable: (...a: unknown[]) => getDatosResponsable(...a),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  confirmarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000 })),
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
  sendText: (...a: unknown[]) => sendText(...a),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound, ponerAvisoADisposicion } = await import('./processor');

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };
const RESPONSABLE = { razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p' };

/** Lo que `acotada` devuelve cuando el tope se agota: un error de consulta. */
const BLIP = new Error('getDatosResponsable: sin respuesta en 8000 ms (tope de consulta)');

describe('ponerAvisoADisposicion distingue «no configurado» de «no contestó»', () => {
  beforeEach(() => {
    getDatosResponsable.mockReset(); sendText.mockReset(); releaseMessageClaim.mockReset();
    runAgent.mockReset(); logger.error.mockReset();
    sendText.mockResolvedValue('wamid.OK');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  });

  it('la flota que no terminó su alta es `sin_datos`', async () => {
    getDatosResponsable.mockResolvedValue(null);
    await expect(ponerAvisoADisposicion('t1', 'o1', '5219993700779')).resolves.toBe('sin_datos');
  });

  it('un blip de la base NO es `sin_datos`: es `no_se_pudo`', async () => {
    getDatosResponsable.mockRejectedValue(BLIP);
    await expect(ponerAvisoADisposicion('t1', 'o1', '5219993700779')).resolves.toBe('no_se_pudo');
  });

  it('con el aviso puesto, `puesto`', async () => {
    getDatosResponsable.mockResolvedValue(RESPONSABLE);
    await expect(ponerAvisoADisposicion('t1', 'o1', '5219993700779')).resolves.toBe('puesto');
  });
});

describe('lo que el chofer LEE cuando la base se tropieza', () => {
  beforeEach(() => {
    getDatosResponsable.mockReset(); sendText.mockReset(); releaseMessageClaim.mockReset();
    runAgent.mockReset(); logger.error.mockReset();
    sendText.mockResolvedValue('wamid.OK');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  });

  it('EL HALLAZGO: no se le dice que su empresa no configuró nada', async () => {
    getDatosResponsable.mockRejectedValue(BLIP);
    await processInbound(foto);
    const dicho = sendText.mock.calls.map((c) => String(c[1])).join(' ');
    expect(dicho, 'acusar al comprador por un tropiezo de red').not.toMatch(/no ha terminado de configurar/i);
    expect(dicho, 'la verdad: se tropezó de este lado').toMatch(/se me trab|conexi[óo]n|en un momento/i);
  });

  it('y la foto no queda marcada como procesada para siempre', async () => {
    getDatosResponsable.mockRejectedValue(BLIP);
    await processInbound(foto);
    expect(releaseMessageClaim, 'sin soltar el claim, el reintento de Meta se descarta como duplicado')
      .toHaveBeenCalledWith('wa1');
  });

  it('sigue sin haber tratamiento: la foto no llega al modelo', async () => {
    getDatosResponsable.mockRejectedValue(BLIP);
    await processInbound(foto);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('el log distingue los dos hechos, no solo «bloqueado»', async () => {
    getDatosResponsable.mockRejectedValue(BLIP);
    await processInbound(foto);
    expect(logger.error).toHaveBeenCalledWith('privacidad.tratamiento_bloqueado',
      expect.objectContaining({ motivo: 'no_se_pudo' }));
  });

  // CONTROL: la flota que de verdad no terminó su alta sigue leyendo lo suyo.
  it('control: si la flota SÍ está sin configurar, el texto de siempre', async () => {
    getDatosResponsable.mockResolvedValue(null);
    await processInbound(foto);
    const dicho = sendText.mock.calls.map((c) => String(c[1])).join(' ');
    expect(dicho).toMatch(/aviso de privacidad/i);
    expect(logger.error).toHaveBeenCalledWith('privacidad.tratamiento_bloqueado',
      expect.objectContaining({ motivo: 'sin_datos' }));
  });
});
