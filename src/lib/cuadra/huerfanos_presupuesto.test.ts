import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRESUPUESTO_WEBHOOK_MS, techoPasoSupabaseMs } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// HASTA 50 `INSERT` EN SERIE, SIN CONSULTAR EL PRESUPUESTO NI UNA VEZ.
// (auditoría 10, MEDIO)
//
// El operador pasó el fin de semana mandando fotos sin viaje abierto y acumuló
// 50 huérfanos —el tope exacto de `getHuerfanos` (`repo.ts:281`, `.limit(50)`)—.
// La oficina le abre el viaje, él contesta «sí», y el bucle emite 50 `INSERT`
// SECUENCIALES sin mirar el reloj ni una vez.
//
// Los números: nominal, al costo unitario del repo (0.3 s), 15 000 ms; con
// Supabase degradado a 2 s por insert, 100 s + lo previo → Vercel corta a los
// 120 s con los comprobantes a medio adjuntar y `resolverHuerfanos` SIN
// EJECUTAR. Techo teórico del bucle: 50 × 9 500 = **475 000 ms**, 3.96× la
// invocación completa. Mientras tanto `presupuesto.ts` justifica
// `TOPE_CONSULTA_MS = 8 000` diciendo que «con 8 s la invocación sobrevive a
// TRES colgadas antes de tocar el límite» — aquí se pueden emitir cincuenta.
//
// Consecuencia: el operador dice «sí», no recibe respuesta, y no sabe si sus 50
// comprobantes se adjuntaron. (No es dinero mal: los no resueltos se le vuelven
// a ofrecer y `uq_gasto_img_hash` evita el duplicado. Es un turno perdido sin
// aviso.)
// ═══════════════════════════════════════════════════════════════════════════

// Se ejercita `processInbound` de verdad, con el mismo arnés que
// `huerfanos_flujo.test.ts`: lo que se mide aquí es el CABLEADO del bucle contra
// el reloj, no una función pura.

const addGasto = vi.fn();
const guardarHuerfano = vi.fn();
const getHuerfanos = vi.fn();
const resolverHuerfanos = vi.fn();
const marcarHuerfanosOfrecidos = vi.fn();
const getOpenViaje = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const runAgent = vi.fn();
const intakeDelta = vi.fn();
const acquireViajeLock = vi.fn();
const releaseViajeLock = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
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
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
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
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, origen: 'Silao', destino: 'N. Laredo', fechaInicio: '2026-08-01' })),
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
  vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
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

const HUERFANO = (id: string, monto: number, ofrecido = false, imgHash?: string) => ({
  id, gasto: { id: `g-${id}`, concepto: 'diesel', monto, ocrExtra: {}, ...(imgHash ? { imgHash } : {}) },
  motivo: 'sin_viaje' as const, creadoEn: '2026-07-31T10:00:00Z',
  ofrecidoEn: ofrecido ? '2026-08-01T10:00:00Z' : undefined,
});


/** 50 huérfanos: el tope exacto de `getHuerfanos`. */
const CINCUENTA = Array.from({ length: 50 }, (_, i) => HUERFANO(`h${i}`, 100 + i, true));

/** Lo que cuesta un `addGasto` con Supabase degradado, en ms de reloj. */
const COSTO_INSERT_MS = 3_000;

describe('el bucle de huérfanos mira el reloj', () => {
  let ahora = 0;

  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                     marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante,
                     runAgent, getGastos, intakeDelta, acquireViajeLock, releaseViajeLock]) m.mockReset();
    intakeDelta.mockResolvedValue(1);
    acquireViajeLock.mockResolvedValue(true);
    releaseViajeLock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue({ id: 'v1', folio: 'V-1', destino: 'N. Laredo' });
    getHuerfanos.mockResolvedValue(CINCUENTA);
    getGastos.mockResolvedValue([]);

    // Solo se falsea `Date`: el reloj del presupuesto lo lee con `Date.now()` y
    // así cada `INSERT` puede «tardar» sin que la prueba espere de verdad.
    ahora = 1_000_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ahora);
    addGasto.mockImplementation(async () => { ahora += COSTO_INSERT_MS; vi.setSystemTime(ahora); });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('con Supabase a 3 s por insert, NO emite los cincuenta', async () => {
    const inicio = ahora;
    await processInbound(texto('si'));
    const gastado = ahora - inicio;

    expect(
      addGasto.mock.calls.length,
      `emitió ${addGasto.mock.calls.length} INSERT sin mirar el reloj: ` +
      `${gastado} ms contra un maxDuration de ${PRESUPUESTO_WEBHOOK_MS}`,
    ).toBeLessThan(50);
    // Se para dejando sitio para su propio techo, no después de pasarse.
    expect(gastado).toBeLessThanOrEqual(PRESUPUESTO_WEBHOOK_MS - techoPasoSupabaseMs() + COSTO_INSERT_MS);
  });

  it('los que SÍ entraron se marcan resueltos: el turno no se pierde entero', async () => {
    await processInbound(texto('si'));
    expect(resolverHuerfanos).toHaveBeenCalled();
    const puestos = resolverHuerfanos.mock.calls[0][1] as string[];
    expect(puestos.length).toBe(addGasto.mock.calls.length);
    expect(puestos.length).toBeGreaterThan(0);
  });

  it('y al operador se le DICE cuántos faltaron, en vez de dejarlo sin respuesta', async () => {
    await processInbound(texto('si'));
    const faltaron = 50 - addGasto.mock.calls.length;
    expect(faltaron, 'sin la guarda no falta ninguno: se emiten los 50 y la invocación muere').toBeGreaterThan(0);
    const todo = salientes.join(' ');
    expect(todo, 'el turno se quedó mudo sobre los que no alcanzaron').toContain(`${faltaron} `);
    expect(todo).toMatch(/s[íi]/i);   // se le dice cómo seguir: contestar «sí» otra vez
  });

  it('con Supabase sano los cincuenta entran igual que siempre', async () => {
    // La guarda no puede activarse en el caso corriente: 50 × 0.3 s = 15 s.
    addGasto.mockImplementation(async () => { ahora += 300; vi.setSystemTime(ahora); });
    await processInbound(texto('si'));
    expect(addGasto.mock.calls.length).toBe(50);
  });
});
