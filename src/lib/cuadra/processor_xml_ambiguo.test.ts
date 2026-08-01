import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · BE-1 (CRÍTICO) — EL XML QUE NO SABE A QUÉ TICKET PEGARSE DABA
// DE ALTA UN GASTO NUEVO, Y EL MISMO CONSUMO CONTABA DOS VECES.
//
// `emparejarXmlConTicket` está bien escrita: ante dos tickets del mismo monto
// y el mismo día devuelve `null` A PROPÓSITO — "sin candidato ÚNICO no se toca
// nada" (`emparejar.ts:72-75`). El problema estaba en el consumidor: el `else`
// de `processor.ts` leía ese `null` como "este XML no corresponde a ningún
// gasto conocido, luego es nuevo".
//
// `null` significa NO SÉ CUÁL. El `else` lo convertía en NINGUNO.
//
// Es el sexto caso del patrón que este repo lleva cinco rondas cerrando —un
// fallo de resolución disfrazado del valor que significa "no hay"— pero al
// revés: aquí el disfraz no niega dinero, lo INVENTA.
//
// ESCENARIO REAL. Dos casetas de $500 el mismo día ("dos casetas de $300 el
// mismo día es corriente", lo dice `emparejar.ts:28`). El operador fotografía
// los dos tickets; después llegan los dos XML. Cada XML no desempata, y cada
// uno se da de alta como gasto nuevo: cuatro gastos por dos casetas, $2,000
// comprobados sobre $1,000 gastados.
//
// Y NADIE SE ENTERA: el gasto que crea el XML no lleva `folio`, así que las dos
// llaves de duplicado del motor —`cfdiUuid`, y `concepto|folio|monto`— fallan
// por construcción. La liquidación sale `cuadrada`, que es el único estado que
// nadie revisa.
//
// Todo el brazo de DOCUMENTO de `processInbound` no tenía UNA sola prueba: las
// rondas 5, 6 y 7 auditaron los brazos de TEXTO y de IMAGEN.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const updateGastoCfdiXml = vi.fn();
const getGastos = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Lo que `parseCfdiXml` devuelve; se cambia por prueba. */
let xmlParseado: Record<string, unknown> | null = null;

const salientes: { body: Record<string, unknown> }[] = [];
const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/messages')) {
    salientes.push({ body: JSON.parse(String(init?.body ?? '{}')) });
    return ok({ messages: [{ id: 'wamid.TEST' }] });
  }
  if (u.startsWith('https://media.test/')) return new Response('<cfdi/>', { status: 200 });
  return ok({ url: 'https://media.test/m1', mime_type: 'text/xml' });
});
const textos = () => salientes.filter((s) => s.body.type === 'text').map((s) => String((s.body.text as { body: string }).body));

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
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
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: (...a: unknown[]) => updateGastoCfdiXml(...a),
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
    storage: { from: () => ({ createSignedUrl: vi.fn(), upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/cuadra/intake/cfdi_xml', () => ({ parseCfdiXml: () => xmlParseado }));

const { processInbound } = await import('./processor');

const xmlEntrante = { from: '5219993700779', type: 'document' as const, mediaId: 'm1', waMessageId: 'wa-xml' };

/** Dos casetas del mismo monto y el mismo día, ninguna timbrada. */
const dosTicketsIguales = [
  { id: 't1', concepto: 'caseta', monto: 500, fecha: '2026-08-03', folio: 'C-1' },
  { id: 't2', concepto: 'caseta', monto: 500, fecha: '2026-08-03', folio: 'C-2' },
];

beforeEach(() => {
  salientes.length = 0;
  addGasto.mockReset(); updateGastoCfdiXml.mockReset(); getGastos.mockReset();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  xmlParseado = { uuid: 'uuid-a', total: 500, fecha: '2026-08-03', claveProdServ: '90101500' };
});

describe('XML contra tickets ambiguos: no sé cuál NO es ninguno', () => {
  // CONTROL. Sin esta prueba, la de abajo pasaría igual si el brazo entero
  // dejara de ejecutarse por cualquier motivo (un mock mal puesto, un `return`
  // temprano) y no probaría nada.
  it('control — con UN solo ticket que empareja, enriquece ese gasto y NO crea otro', async () => {
    getGastos.mockResolvedValue([dosTicketsIguales[0]]);
    await processInbound(xmlEntrante);
    expect(updateGastoCfdiXml).toHaveBeenCalledTimes(1);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('con DOS tickets del mismo monto y día, no da de alta un gasto nuevo', async () => {
    getGastos.mockResolvedValue(dosTicketsIguales);
    await processInbound(xmlEntrante);
    // Antes: `addGasto` corría y el mismo consumo quedaba contado dos veces.
    expect(addGasto).not.toHaveBeenCalled();
    // Y tampoco se le pega al ticket equivocado, que le cambiaría el emisor,
    // el IVA y el IEPS a un gasto que no era.
    expect(updateGastoCfdiXml).not.toHaveBeenCalled();
  });

  it('y no se lo calla: se lo dice al operador y deja rastro', async () => {
    getGastos.mockResolvedValue(dosTicketsIguales);
    await processInbound(xmlEntrante);
    expect(logger.warn).toHaveBeenCalledWith('xml.ambiguo', expect.objectContaining({ viaje: 'v1', candidatos: 2 }));
    expect(textos().join(' ')).toMatch(/dos|varios|cuál|cual/i);
  });

  it('sin ningún ticket que se le parezca, SÍ lo da de alta: el XML llegó sin foto previa', async () => {
    getGastos.mockResolvedValue([{ id: 't9', concepto: 'diesel', monto: 4200, fecha: '2026-08-03', folio: 'D-1' }]);
    await processInbound(xmlEntrante);
    expect(addGasto).toHaveBeenCalledTimes(1);
  });
});
