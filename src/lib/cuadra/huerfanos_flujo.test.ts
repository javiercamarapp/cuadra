import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CHOFER QUE NO DICE «HOLA». 1-ago-2026.
//
// Termina la ruta, saca el fajo y manda once fotos de golpe, sin viaje abierto.
// Hasta hoy se le contestaba «No tienes un viaje abierto para liquidar ahorita»
// y sus once comprobantes se tiraban — mientras que el XML del CFDI, en ese
// MISMO corte, sí se conservaba. El producto pedía un documento y se negaba a
// recibir justo el que importa.
//
// Se ejercita `processInbound` de verdad. Las funciones puras ya se prueban en
// `intake/huerfanos.test.ts`; lo que ha fallado hoy siete veces es el cableado.
// ═══════════════════════════════════════════════════════════════════════════

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
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
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

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };
const texto = (t: string) => ({ from: '5219993700779', type: 'text' as const, text: t, waMessageId: `wa-${t}` });

const HUERFANO = (id: string, monto: number, ofrecido = false, imgHash?: string) => ({
  id, gasto: { id: `g-${id}`, concepto: 'diesel', monto, ocrExtra: {}, ...(imgHash ? { imgHash } : {}) },
  motivo: 'sin_viaje' as const, creadoEn: '2026-07-31T10:00:00Z',
  ofrecidoEn: ofrecido ? '2026-08-01T10:00:00Z' : undefined,
});

describe('el chofer que manda fotos sin viaje abierto', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                     marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent, getGastos,
                     intakeDelta, acquireViajeLock, releaseViajeLock]) m.mockReset();
    intakeDelta.mockResolvedValue(1);
    acquireViajeLock.mockResolvedValue(true);
    releaseViajeLock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue(null);          // ← SIN viaje
    getHuerfanos.mockResolvedValue([]);
    getGastos.mockResolvedValue([]);
    guardarHuerfano.mockResolvedValue(true);
    subirComprobante.mockResolvedValue('t1/sin-viaje/HASH.jpg');
    addGasto.mockResolvedValue(undefined);
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: { concepto: 'diesel', monto: 2890, fecha: '2026-07-31', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('EL FALLO: su foto ya no se tira, se guarda', async () => {
    await processInbound(foto);
    expect(guardarHuerfano).toHaveBeenCalledWith('t1', 'o1', expect.objectContaining({ motivo: 'sin_viaje' }));
    expect(salientes.join(' ')).toMatch(/no se pierden/i);
    expect(salientes.join(' '), 'ya no puede ser la única respuesta').not.toMatch(/^No tienes un viaje abierto/);
  });

  it('la imagen se archiva, no solo el número: el OCR se puede discutir, el papel no', async () => {
    await processInbound(foto);
    expect(subirComprobante).toHaveBeenCalled();
    expect(guardarHuerfano.mock.calls[0][2]).toMatchObject({ rutaImagen: 't1/sin-viaje/HASH.jpg' });
  });

  // ── MEDIO de la auditoría 10 (agéntico) ──────────────────────────────────
  //
  // El hash de la imagen SÍ se calcula aquí —hace falta para `subirComprobante`—
  // y se tiraba: se guardaba `ex.gasto` crudo, que nunca lo trae. En el camino
  // sin viaje no hay ningún dedup (la mig. 0040 no tiene índice único y
  // `guardarHuerfano` es un insert pelado), así que el tercer candado —
  // `uq_gasto_img_hash`— era la única defensa que quedaba, y llegaba en NULL.
  //
  // Escenario medido: sin viaje abierto, el chofer manda la foto de una caseta
  // de $312.00 cuyo ticket no trae folio legible; WhatsApp marca fallo de envío
  // y él la reenvía (otro `waMessageId`, así que `claimMessage` no lo ve) → dos
  // filas. Al abrir el viaje se le ofrecen las dos, contesta «sí», y entraban
  // DOS gastos con `img_hash = null` (NULL no colisiona en un índice único) y
  // sin folio, así que `copiasDeComprobante` tampoco los veía: el comprobado
  // subía $312.00 de más, a favor del chofer, por dinero que no gastó.
  it('el hash de la imagen viaja CON el comprobante: es el único candado que le queda', async () => {
    await processInbound(foto);
    expect(guardarHuerfano.mock.calls[0][2].gasto, 'sin hash, el reenvío entra dos veces')
      .toMatchObject({ imgHash: 'HASH' });
  });

  it('en una ráfaga de once NO acusa once veces', async () => {
    // Mismo criterio que el acuse de ráfaga y el aviso de acercamiento: tres
    // mensajes idénticos seguidos hacen ver el producto roto.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100), HUERFANO('b', 200)]);
    await processInbound(foto);
    expect(salientes).toHaveLength(0);
  });

  it('si no se puede guardar, se lo DICE en vez de dejarlo creer que sí', async () => {
    guardarHuerfano.mockResolvedValue(false);
    await processInbound(foto);
    expect(salientes.join(' ')).toMatch(/no pude guardar/i);
  });

  it('una foto ilegible se pide otra vez, no se guarda basura', async () => {
    extraerComprobante.mockResolvedValue({
      legible: false, motivo: 'ilegible',
      gasto: { concepto: 'otro', monto: 0, ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
    await processInbound(foto);
    expect(guardarHuerfano).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/difícil de leer/i);
  });

  it('un texto sin viaje sigue contestando lo de siempre', async () => {
    await processInbound(texto('hola'));
    expect(salientes.join(' ')).toMatch(/No tienes un viaje abierto/);
  });
});

describe('cuando por fin hay viaje, se pregunta antes de adjuntar', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                     marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent, getGastos,
                     intakeDelta, acquireViajeLock, releaseViajeLock]) m.mockReset();
    intakeDelta.mockResolvedValue(1);
    acquireViajeLock.mockResolvedValue(true);
    releaseViajeLock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue('v1');          // ← CON viaje
    getGastos.mockResolvedValue([]);
    guardarHuerfano.mockResolvedValue(true);
    addGasto.mockResolvedValue(undefined);
    subirComprobante.mockResolvedValue('ruta');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('ofrece con la lista y la ruta, y NO adjunta nada todavía', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890), HUERFANO('b', 980)]);
    await processInbound(texto('hola'));
    const m = salientes.join(' ');
    expect(m).toMatch(/¿Los agrego a este viaje\?/);
    expect(m).toContain('$3,870.00');
    expect(m).toContain('Silao→N. Laredo');
    expect(addGasto, 'preguntar no es adjuntar').not.toHaveBeenCalled();
    expect(marcarHuerfanosOfrecidos).toHaveBeenCalledWith('t1', ['a', 'b']);
  });

  // ── ALTO de la auditoría 10 (agéntico) ───────────────────────────────────
  //
  // La constancia de «ya se le preguntó» se escribía ANTES del envío, y la
  // re-oferta está condicionada a que NO haya ninguna fila marcada. Juntas,
  // las dos cosas hacían la oferta de un solo tiro: si Meta rebotaba el
  // mensaje (131047, ventana de 24 h cerrada; 131030, destinatario fuera de
  // la lista — los dos vistos el 1-ago), la base quedaba diciendo que se le
  // preguntó y ningún mensaje posterior volvía a ofrecer. $16,244.00 en
  // comprobantes guardados, invisibles para el chofer y para el contralor.
  //
  // Es la misma lección que este archivo ya pagó dos veces: la constancia del
  // aviso de privacidad va DESPUÉS del envío, y el turno del asistente solo se
  // guarda si `say` devolvió id.
  it('si el envío de la oferta rebota, NO se marca como preguntada y se vuelve a ofrecer', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 8412), HUERFANO('b', 312)]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 131047, message: 'ventana de 24h cerrada' } }),
      { status: 400, headers: { 'content-type': 'application/json' } })));
    await processInbound(texto('hola'));
    expect(marcarHuerfanosOfrecidos, 'nadie leyó la pregunta: la base no puede decir que sí')
      .not.toHaveBeenCalled();

    // Segundo turno, con el envío funcionando: la oferta se vuelve a hacer.
    vi.stubGlobal('fetch', fetchSpy);
    salientes.length = 0;
    await processInbound(texto('buenas'));
    expect(salientes.join(' '), 'la oferta que rebotó tiene que volver a salir')
      .toMatch(/¿Los agrego a este viaje\?/);
    expect(marcarHuerfanosOfrecidos).toHaveBeenCalledWith('t1', ['a', 'b']);
  });

  it('con un «sí» los adjunta y los marca DESPUÉS de insertarlos', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890, true), HUERFANO('b', 980, true)]);
    await processInbound(texto('sí'));
    expect(addGasto).toHaveBeenCalledTimes(2);
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a', 'b'], 'adjuntado', 'v1');
    expect(salientes.join(' ')).toContain('$3,870.00');
  });

  it('y el acuse dice el NETO, calculado con el mismo dedup que el cuadre', async () => {
    // El acuse decía «$28,041.15» y la liquidación «$12,388.05». Los dos ciertos,
    // y el operador entendiendo que le recortaron. Ahora sale la resta ahí mismo.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    getGastos.mockResolvedValue([
      { id: 'x', concepto: 'diesel', monto: 100, folio: 'F1', folioNorm: 'F1' },
      { id: 'y', concepto: 'diesel', monto: 100, folio: 'F1', folioNorm: 'F1' },  // copia
    ]);
    await processInbound(texto('sí'));
    const m = salientes.join(' ');
    expect(m).toContain('1 repetido');
    expect(m, 'el comprobado real, no la suma del papel').toContain('$100.00');
  });

  it('si no se puede leer el viaje, el acuse NO promete un total', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    getGastos.mockRejectedValue(new Error('base caída'));
    await processInbound(texto('sí'));
    expect(salientes.join(' ')).not.toMatch(/llevas/i);
    expect(addGasto, 'y los comprobantes sí entraron').toHaveBeenCalled();
  });

  it('si uno falla al insertarse, NO se marca como puesto', async () => {
    // Marcar primero dejaría un comprobante contado como agregado que no está
    // en ningún lado, y nadie volvería a ofrecerlo.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true), HUERFANO('b', 200, true)]);
    addGasto.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    await processInbound(texto('sí'));
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'adjuntado', 'v1');
  });

  // ── MEDIO de la auditoría 10 (agéntico) ──────────────────────────────────
  //
  // Éste era el único camino que INSERTA gastos sin barrera ni mutex: la foto
  // tiene el contador de intake, el XML tiene contador y mutex, y la sala de
  // espera no tenía ninguno de los dos. Con el «sí» y un «listo» tres segundos
  // después corriendo en paralelo (`route.ts`, `Promise.all`), el «listo» veía
  // el contador en 0, pasaba la barrera, tomaba el mutex y cerraba; los
  // `addGasto` que aún no habían corrido chocaban con el trigger de la 0036.
  it('el «sí» toma la barrera y el mutex, como los otros dos brazos que escriben gastos', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890, true)]);
    await processInbound(texto('sí'));
    expect(intakeDelta, 'sin +1 el «listo» concurrente no espera a nadie').toHaveBeenCalledWith('v1', 1);
    expect(acquireViajeLock).toHaveBeenCalled();
    expect(intakeDelta, 'y el contador se libera pase lo que pase').toHaveBeenCalledWith('v1', -1);
    expect(releaseViajeLock).toHaveBeenCalledWith('v1');
  });

  it('si el mutex está ocupado NO escribe: se le pide que reintente, no se procede sin exclusividad', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890, true)]);
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(texto('sí'));
    expect(addGasto).not.toHaveBeenCalled();
    expect(resolverHuerfanos).not.toHaveBeenCalled();
    expect(intakeDelta).toHaveBeenCalledWith('v1', -1);
  });

  // El `catch` reconocía `uq_gasto_img_hash` y `uq_gasto_cfdi_uuid` y nada más,
  // así que `CU001` —la liquidación de este viaje YA se emitió (mig. 0036)—
  // caía al `logger.error` genérico, la fila no entraba en `puestos` y el
  // chofer recibía «No pude agregarlos ⚙️. Siguen guardados; lo intento otra
  // vez en un momento.» Ese reintento NO EXISTE: no hay cron, no hay job. Los
  // otros dos brazos traducen CU001 a la verdad; éste no.
  it('si llegaron DESPUÉS del cierre se lo dice, y no promete un reintento que no existe', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 8412, true), HUERFANO('b', 312, true)]);
    addGasto.mockRejectedValue(Object.assign(new Error('gasto tras liquidación'), { code: 'CU001' }));
    await processInbound(texto('sí'));
    const m = salientes.join(' ');
    expect(m, 'el reintento inventado era lo único que el chofer tenía').not.toMatch(/lo intento otra vez/i);
    expect(m, 'la verdad es que su liquidación ya cerró').toMatch(/cerr[ée]/i);
    expect(resolverHuerfanos, 'no entraron: no se pueden marcar como adjuntados')
      .not.toHaveBeenCalledWith('t1', expect.arrayContaining(['a']), 'adjuntado', 'v1');
  });

  // La otra mitad del MEDIO: el hash guardado tiene que LLEGAR al `addGasto`,
  // porque es ahí donde `uq_gasto_img_hash` puede actuar. El reenvío duplicado
  // ($312.00 dos veces, sin folio) choca contra el índice y se cuenta una vez.
  it('el hash llega al viaje, y el reenvío duplicado choca contra el índice en vez de sumar', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 312, true, 'H312'), HUERFANO('b', 312, true, 'H312')]);
    getGastos.mockResolvedValue([{ id: 'x', concepto: 'caseta', monto: 312 }]);
    addGasto
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('dup'), {
        code: '23505', message: 'duplicate key value violates unique constraint "uq_gasto_img_hash"',
      }));
    await processInbound(texto('sí'));
    expect(addGasto.mock.calls[0][2]).toMatchObject({ imgHash: 'H312' });
    expect(salientes.join(' '), 'el comprobado no puede subir $312.00 de más')
      .toMatch(/llevas \*?\$312\.00\*? comprobado/);
  });

  it('con un «no» los descarta sin tocar el viaje', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    await processInbound(texto('no'));
    expect(addGasto).not.toHaveBeenCalled();
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'descartado', null);
  });

  // ── CRÍTICO de la auditoría 10 (agéntico) ────────────────────────────────
  //
  // Esta prueba fijaba lo contrario: que «listo» NO disparara la oferta, para
  // no obligar al chofer a escribirlo dos veces. La decisión descansaba en una
  // premisa escrita en el código: «perder la oferta este turno no cuesta nada
  // — se le vuelve a hacer».
  //
  // Esa premisa es FALSA justo en el turno de cierre, que es el único donde no
  // hay turno siguiente: «listo» cierra la liquidación, el viaje queda
  // `liquidado`, y a partir de ahí cualquier mensaje recibe «No tienes un viaje
  // abierto». Los comprobantes que esperaban se ofrecerán en el viaje SIGUIENTE
  // — «un ticket del viaje anterior metido en el de hoy es dinero en la
  // liquidación equivocada», que es literalmente lo que la mig. 0040 dice
  // existir para impedir.
  //
  // Medido por el auditor: 6 comprobantes en sala de espera ($16,244.00), viaje
  // nuevo con anticipo $18,000.00, el chofer escribe `listo` → «Comprobado:
  // $0.00 · Sobró $18,000.00 (a favor de la empresa)» y su PDF.
  //
  // Costar un `listo` de más vale infinitamente menos que cerrar en $0. El
  // costo, además, solo lo paga quien TIENE comprobantes esperando.
  it('«listo» con comprobantes sin ofrecer pregunta primero: cerrar en $0 cuesta más que un intento de más', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100)]);
    await processInbound(texto('listo'));
    expect(marcarHuerfanosOfrecidos).toHaveBeenCalledWith('t1', ['a']);
    expect(salientes.join(' ')).toMatch(/¿Los agrego a este viaje\?/);
    expect(runAgent, 'y sobre todo: NO llegó a cerrar').not.toHaveBeenCalled();
  });

  // Los otros verbos de cierre entran por la misma puerta.
  it('«ya estuvo» / «es todo» tampoco cierran sobre la sala de espera llena', async () => {
    for (const verbo of ['ya', 'termine', 'es todo', 'cierra']) {
      for (const m of [marcarHuerfanosOfrecidos, runAgent]) m.mockClear();
      salientes.length = 0;
      getHuerfanos.mockResolvedValue([HUERFANO('a', 100)]);
      await processInbound(texto(verbo));
      expect(runAgent, `«${verbo}» no debe cerrar`).not.toHaveBeenCalled();
    }
  });

  it('sin nada esperando, el flujo normal no se entera de que esto existe', async () => {
    getHuerfanos.mockResolvedValue([]);
    await processInbound(texto('hola'));
    expect(marcarHuerfanosOfrecidos).not.toHaveBeenCalled();
    expect(runAgent, 'el mensaje tiene que llegar al agente como siempre').toHaveBeenCalled();
  });

  it('un error leyendo la sala de espera no le impide usar su viaje', async () => {
    // `getHuerfanos` devuelve [] ante un fallo de lectura, a propósito.
    getHuerfanos.mockResolvedValue([]);
    await processInbound(texto('cuánto llevo'));
    expect(runAgent).toHaveBeenCalled();
  });
});
