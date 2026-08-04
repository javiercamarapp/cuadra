import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Las lecturas y escrituras del ENCARGADO (mig. 0047).
//
// Lo que se prueba aquí no es que las consultas "corran": es cada decisión
// donde un cero honesto y un cero mentiroso se ven idénticos en pantalla.
// ═══════════════════════════════════════════════════════════════════════════

/** Filas por tabla que devolverá el mock en la siguiente llamada. */
let TABLAS: Record<string, unknown[]> = {};
/**
 * Tablas que deben fallar. Una cadena es solo el mensaje; el objeto permite
 * darle el SQLSTATE y el `details` con los que Postgres reporta un choque de
 * índice único — que es lo que `violaIndice` lee.
 */
type Falla = string | { message: string; code?: string; details?: string };
let FALLAN: Record<string, Falla> = {};

const escrituras: Array<{ tabla: string; op: string; valores?: unknown; filtros: Array<[string, unknown]> }> = [];

function comoFalla(f: Falla) {
  return typeof f === 'string' ? { message: f } : f;
}

/**
 * Constructor encadenable: todo método devuelve el mismo objeto, y `range`
 * (que es donde `traerTodo` cierra la consulta) resuelve con las filas de la
 * tabla. `single()`/`maybeSingle()` cierran las consultas de una fila.
 *
 * `then` —por donde se esperan los UPDATE— devuelve las filas de la tabla, NO
 * `{data: null}`: codificar el cero-filas como éxito era exactamente el bug
 * que este archivo tenía que haber cazado (un update que no empató nada se
 * anunciaba en verde).
 */
function constructor(tabla: string) {
  const filtros: Array<[string, unknown]> = [];
  const registro: { tabla: string; op: string; valores?: unknown; filtros: Array<[string, unknown]> } =
    { tabla, op: 'select', filtros };

  const resultado = () => FALLAN[tabla]
    ? { data: null, error: comoFalla(FALLAN[tabla]) }
    : { data: TABLAS[tabla] ?? [], error: null };

  /** La fila que empata el `.eq('id', …)` de la consulta, si lo hay. */
  const unaFila = () => {
    const filas = (TABLAS[tabla] ?? []) as Array<Record<string, unknown>>;
    const porId = filtros.find(([c]) => c === 'id');
    if (!porId) return filas[0] ?? null;
    return filas.find((f) => f.id === porId[1]) ?? null;
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filtros.push([c, v]); return api; },
    neq: (c: string, v: unknown) => { filtros.push([`!${c}`, v]); return api; },
    order: () => api,
    range: () => Promise.resolve(resultado()),
    insert: (v: unknown) => { registro.op = 'insert'; registro.valores = v; escrituras.push(registro); return api; },
    update: (v: unknown) => { registro.op = 'update'; registro.valores = v; escrituras.push(registro); return api; },
    single: () => Promise.resolve(
      FALLAN[tabla] ? { data: null, error: comoFalla(FALLAN[tabla]) } : { data: { id: `${tabla}-nuevo` }, error: null },
    ),
    maybeSingle: () => Promise.resolve(
      FALLAN[tabla] ? { data: null, error: comoFalla(FALLAN[tabla]) } : { data: unaFila(), error: null },
    ),
    // Un update sin `.single()` se espera directo: `then` lo hace thenable.
    then: (res: (v: unknown) => unknown) => Promise.resolve(resultado()).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  getCargaOperadores, getViajesSinAsignar, getUnidades, getIncidencias,
  getTableroOperacion, cambiarEstadoIncidencia, crearViaje, getPods, rechazarPod,
  asignarUnidad, crearUnidad, crearIncidencia, marcarPodPedido, cambiarEstadoUnidad,
} = await import('./operacion');

beforeEach(() => { TABLAS = {}; FALLAN = {}; escrituras.length = 0; });

describe('getCargaOperadores — "¿a quién NO le cargo otro?"', () => {
  it('cuenta en curso por operador y deja fuera los viajes sin dueño', async () => {
    TABLAS = {
      operador: [
        { id: 'o-1', nombre: 'Ana Ruiz', telefono: '52999', activo: true },
        { id: 'o-2', nombre: 'Beto Lara', telefono: null, activo: true },
      ],
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'en_cuadre' },
        { id: 'v-3', operador_id: 'o-1', estatus: 'liquidado' },
        { id: 'v-4', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-5', operador_id: null, estatus: 'abierto' },   // sin dueño
      ],
      pod: [], incidencia: [],
    };
    const r = await getCargaOperadores('t-1');
    const ana = r.find((x) => x.operadorId === 'o-1')!;
    expect(ana.enCurso).toBe(2);            // abierto + en_cuadre, NO el liquidado
    expect(ana.abiertos).toBe(1);
    expect(ana.enCuadre).toBe(1);
    expect(ana.liquidados).toBe(1);
    // El viaje sin dueño no le cuenta a nadie: se persigue en otra pantalla.
    expect(r.reduce((s, x) => s + x.enCurso, 0)).toBe(3);
  });

  it('un POD RECHAZADO cuenta como que falta — la evidencia existe pero no sirve', async () => {
    TABLAS = {
      operador: [{ id: 'o-1', nombre: 'Ana', telefono: null, activo: true }],
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'abierto' },
      ],
      pod: [
        { viaje_id: 'v-1', estado: 'subido' },
        { viaje_id: 'v-2', estado: 'rechazado' },
      ],
      incidencia: [],
    };
    const [ana] = await getCargaOperadores('t-1');
    expect(ana.sinPod).toBe(1);
  });

  it('ordena por carga descendente', async () => {
    TABLAS = {
      operador: [
        { id: 'o-1', nombre: 'Ana', telefono: null, activo: true },
        { id: 'o-2', nombre: 'Beto', telefono: null, activo: true },
      ],
      viaje: [
        { id: 'v-1', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-3', operador_id: 'o-1', estatus: 'abierto' },
      ],
      pod: [], incidencia: [],
    };
    const r = await getCargaOperadores('t-1');
    expect(r.map((x) => x.nombre)).toEqual(['Beto', 'Ana']);
  });

  it('si una de las cuatro consultas falla, LANZA — no devuelve carga cero', async () => {
    TABLAS = { operador: [], viaje: [], pod: [], incidencia: [] };
    FALLAN = { viaje: 'timeout' };
    // Cero viajes por error se leería como "nadie trae nada" y el encargado
    // repartiría trabajo encima de choferes que ya van llenos.
    await expect(getCargaOperadores('t-1')).rejects.toThrow('timeout');
  });
});

describe('getViajesSinAsignar', () => {
  it('pide los que no tienen operador y no están liquidados', async () => {
    TABLAS = { viaje: [{ id: 'v-1', folio: 'VJ-1', origen: 'GDL', destino: 'MTY', fecha_inicio: '2026-08-01', estatus: 'abierto' }] };
    const r = await getViajesSinAsignar('t-1');
    expect(r).toEqual([{ id: 'v-1', folio: 'VJ-1', origen: 'GDL', destino: 'MTY', fechaInicio: '2026-08-01', estatus: 'abierto' }]);
  });
});

describe('getUnidades — el papel que vence primero', () => {
  const hoy = new Date('2026-08-03T12:00:00Z');

  it('elige el vencimiento MÁS PRÓXIMO de los tres, no el primero capturado', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-08', placas: 'ABC-123-A', marca: null, modelo: null, anio: 2019,
        estado: 'disponible', km_actual: 412000,
        poliza_vence: '2026-12-01',          // lejano, pero capturado primero
        permiso_sict_vence: '2026-07-04',    // YA VENCIDO
        verificacion_vence: '2026-09-01',
        activo: true,
      }],
      mantenimiento: [],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.queVence).toBe('Permiso SICT');
    expect(u.diasAlVencimiento).toBe(-30);   // negativo = vencido, y así se pinta
  });

  it('sin ningún papel capturado devuelve null, no cero — cero se leería como "vence hoy"', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-09', placas: null, marca: null, modelo: null, anio: null,
        estado: 'taller', km_actual: null,
        poliza_vence: null, permiso_sict_vence: null, verificacion_vence: null, activo: true,
      }],
      mantenimiento: [],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.diasAlVencimiento).toBeNull();
    expect(u.queVence).toBeNull();
  });

  it('cuenta las órdenes de trabajo abiertas de cada unidad', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-08', placas: null, marca: null, modelo: null, anio: null,
        estado: 'taller', km_actual: null, poliza_vence: null, permiso_sict_vence: null,
        verificacion_vence: null, activo: true,
      }],
      mantenimiento: [{ unidad_id: 'u-1', estado: 'abierta' }, { unidad_id: 'u-1', estado: 'en_proceso' }],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.ordenesAbiertas).toBe(2);
  });
});

describe('getIncidencias — SLA', () => {
  const ahora = new Date('2026-08-03T12:00:00Z');
  const base = {
    id: 'i-1', viaje_id: null, unidad_id: null, tipo: 'averia', prioridad: 'alta',
    descripcion: null, resuelta_en: null,
    abierta_en: '2026-08-03T00:00:00Z',   // 12 h antes
  };

  it('marca vencido solo si HAY SLA pactado y ya se pasó', async () => {
    TABLAS = { incidencia: [{ ...base, estado: 'abierta', sla_horas: 4 }], viaje: [], unidad: [] };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(12);
    expect(i.slaVencido).toBe(true);
  });

  it('sin SLA no está vencida, está SIN PACTAR', async () => {
    TABLAS = { incidencia: [{ ...base, estado: 'abierta', sla_horas: null }], viaje: [], unidad: [] };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.slaHoras).toBeNull();
    expect(i.slaVencido).toBe(false);
  });

  it('una resuelta no está vencida aunque haya tardado más que el SLA', async () => {
    TABLAS = {
      incidencia: [{ ...base, estado: 'resuelta', sla_horas: 4, resuelta_en: '2026-08-03T10:00:00Z' }],
      viaje: [], unidad: [],
    };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(10);   // se congela al resolver, no sigue corriendo
    expect(i.slaVencido).toBe(false);
  });
});

describe('getTableroOperacion', () => {
  it('cuenta como pendiente el viaje del que NADIE creó el POD', async () => {
    // El peor cero posible: contar filas de `pod` dejaría fuera justo el viaje
    // que nadie ha tocado, y el tablero diría "no falta ninguno".
    TABLAS = {
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'abierto' },   // sin fila en `pod`
        { id: 'v-3', operador_id: 'o-1', estatus: 'liquidado' },
      ],
      unidad: [{ estado: 'disponible' }, { estado: 'taller' }, { estado: 'en_ruta' }],
      incidencia: [{ estado: 'abierta' }],
      pod: [{ viaje_id: 'v-1', estado: 'subido' }],
    };
    const t = await getTableroOperacion('t-1');
    expect(t.podPendientes).toBe(1);
    expect(t.viajesActivos).toBe(2);
    expect(t.unidadesDisponibles).toBe(1);
    expect(t.unidadesEnTaller).toBe(1);
    expect(t.incidenciasAbiertas).toBe(1);
  });

  it('porAsignar solo cuenta viajes EN CURSO sin dueño', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', operador_id: null, estatus: 'abierto' },
        { id: 'v-2', operador_id: null, estatus: 'liquidado' },   // ya cerró: no se asigna
      ],
      unidad: [], incidencia: [], pod: [],
    };
    expect((await getTableroOperacion('t-1')).porAsignar).toBe(1);
  });
});

describe('getPods — se parte de los VIAJES, no de la tabla pod', () => {
  it('el viaje del que nadie creó registro sale con estado null y PRIMERO', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', folio: 'VJ-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', folio: 'VJ-2', operador_id: 'o-1', estatus: 'abierto' },   // nadie lo tocó
        { id: 'v-3', folio: 'VJ-3', operador_id: 'o-1', estatus: 'liquidado' }, // ya cerró
      ],
      pod: [{ id: 'p-1', viaje_id: 'v-1', estado: 'subido', nota: null, capturado_en: null }],
      operador: [{ id: 'o-1', nombre: 'Ana Ruiz', telefono: '52999' }],
    };
    const r = await getPods('t-1');
    // El liquidado no aparece: la evidencia se persigue mientras el viaje vive.
    expect(r.map((x) => x.folio)).toEqual(['VJ-2', 'VJ-1']);
    expect(r[0].estado).toBeNull();
    expect(r[0].operadorNombre).toBe('Ana Ruiz');
    expect(r[1].estado).toBe('subido');
  });

  it('ordena lo que falta antes de lo que llegó', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', folio: 'llegó', operador_id: null, estatus: 'abierto' },
        { id: 'v-2', folio: 'rechazado', operador_id: null, estatus: 'abierto' },
        { id: 'v-3', folio: 'pedido', operador_id: null, estatus: 'abierto' },
        { id: 'v-4', folio: 'nadie', operador_id: null, estatus: 'abierto' },
      ],
      pod: [
        { id: 'p-1', viaje_id: 'v-1', estado: 'subido', nota: null, capturado_en: null },
        { id: 'p-2', viaje_id: 'v-2', estado: 'rechazado', nota: null, capturado_en: null },
        { id: 'p-3', viaje_id: 'v-3', estado: 'pendiente', nota: null, capturado_en: null },
      ],
      operador: [],
    };
    const r = await getPods('t-1');
    expect(r.map((x) => x.folio)).toEqual(['nadie', 'pedido', 'rechazado', 'llegó']);
  });
});

describe('escrituras', () => {
  /** Un tenant con un chofer, una unidad, un viaje y una incidencia reales. */
  const FLOTA = () => ({
    operador: [{ id: 'o-1', nombre: 'Ana' }],
    unidad: [{ id: 'u-1', numero_economico: 'C2-08' }],
    viaje: [{ id: 'v-1', unidad_id: null }],
    incidencia: [{ id: 'i-1' }],
    pod: [{ id: 'p-1' }],
  });

  it('crearViaje acota por tenant y nace abierto', async () => {
    TABLAS = FLOTA();
    await crearViaje('t-1', { folio: 'VJ-9', origen: 'GDL', destino: 'MTY', anticipo: 5000, operadorId: 'o-1' });
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.op).toBe('insert');
    expect(w.valores).toMatchObject({ tenant_id: 't-1', folio: 'VJ-9', estatus: 'abierto', anticipo: 5000 });
  });

  it('resolver una incidencia FECHA el cierre — el constraint la rechaza si no', async () => {
    TABLAS = FLOTA();
    const ahora = new Date('2026-08-03T12:00:00Z');
    await cambiarEstadoIncidencia('t-1', 'i-1', 'resuelta', ahora);
    const w = escrituras.find((e) => e.tabla === 'incidencia')!;
    expect(w.valores).toEqual({ estado: 'resuelta', resuelta_en: '2026-08-03T12:00:00.000Z' });
    expect(w.filtros).toEqual([['id', 'i-1'], ['tenant_id', 't-1']]);
  });

  it('reabrir una incidencia BORRA la fecha de cierre', async () => {
    TABLAS = FLOTA();
    await cambiarEstadoIncidencia('t-1', 'i-1', 'en_proceso');
    const w = escrituras.find((e) => e.tabla === 'incidencia')!;
    expect(w.valores).toEqual({ estado: 'en_proceso', resuelta_en: null });
  });

  it('un insert que falla lanza en vez de devolver un id inventado', async () => {
    TABLAS = FLOTA();
    FALLAN = { viaje: 'folio duplicado' };
    await expect(crearViaje('t-1', { folio: 'VJ-9', operadorId: 'o-1' })).rejects.toThrow('folio duplicado');
  });

  it('rechazar un POD NO borra el archivo — solo cambia el estado y anota', async () => {
    // Borrar la ruta dejaría la discusión con el chofer sin la prueba de lo
    // que sí mandó. Además, `pod_subido_tiene_archivo` (0047) solo exige
    // archivo para 'subido', así que la fila rechazada queda consistente.
    TABLAS = FLOTA();
    await rechazarPod('t-1', 'p-1', 'ilegible, no se ve el sello');
    const w = escrituras.find((e) => e.tabla === 'pod')!;
    expect(w.valores).toEqual({ estado: 'rechazado', nota: 'ilegible, no se ve el sello' });
    expect(w.valores).not.toHaveProperty('storage_path');
    expect(w.filtros).toEqual([['id', 'p-1'], ['tenant_id', 't-1']]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G-21 — las siete escrituras, sus tres defectos.
//
// (a) Un 23505 propagaba y `dashboard/error.tsx` pintaba «No se pudo cargar el
//     panel — hubo un problema al leer los datos» con un hash de incidente:
//     doblemente falso (no fue una lectura, no es un incidente) y sin la única
//     frase que le sirve al encargado.
// (b) PostgREST contesta 204 SIN error con cero filas empatadas, así que "no
//     había nada que actualizar" y "se actualizó" salían las dos en verde.
// (c) Los ids venían del `<form>` sin comprobar de quién son, contra FK de una
//     sola columna: una unidad de otra flota se podía colgar de un viaje.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA_BASE = () => ({
  operador: [{ id: 'o-1', nombre: 'Ana' }],
  unidad: [{ id: 'u-1', numero_economico: 'C2-08' }],
  viaje: [{ id: 'v-1', unidad_id: null }],
  incidencia: [{ id: 'i-1' }],
  pod: [{ id: 'p-1' }],
});

/** Cómo llega un choque de índice único desde PostgREST. */
const choque = (indice: string) => ({
  message: `duplicate key value violates unique constraint "${indice}"`,
  code: '23505',
  details: `Key (tenant_id, operador_id)=(…) already exists.`,
});

describe('G-21(a) — un 23505 es un mensaje para el encargado, no un incidente', () => {
  it('el segundo viaje abierto del mismo chofer se explica, no se convierte en hash', async () => {
    TABLAS = FLOTA_BASE();
    FALLAN = { viaje: choque('uq_viaje_abierto_por_operador') };
    // En el tenant del demo son DOS CLICS: dar de alta un viaje al único
    // chofer con datos.
    await expect(crearViaje('t-1', { operadorId: 'o-1' })).rejects.toThrow(/ya trae un viaje abierto/i);
  });

  it('un número económico repetido dice cuál es el problema', async () => {
    TABLAS = FLOTA_BASE();
    FALLAN = { unidad: choque('unidad_economico_unico') };
    await expect(crearUnidad('t-1', { numeroEconomico: 'C2-08' })).rejects.toThrow(/n[úu]mero econ[óo]mico/i);
  });

  it('pedir dos veces la misma evidencia no tumba la pantalla', async () => {
    TABLAS = FLOTA_BASE();
    FALLAN = { pod: choque('pod_viaje_unico') };
    await expect(marcarPodPedido('t-1', 'v-1', 'o-1')).rejects.toThrow(/ya tiene registro de evidencia/i);
  });

  it('un 23505 contra un índice DESCONOCIDO sigue siendo un error de verdad', async () => {
    // Tragarse cualquier 23505 escondería el bug que sí lo es.
    TABLAS = FLOTA_BASE();
    FALLAN = { unidad: choque('un_indice_que_nadie_previo') };
    await expect(crearUnidad('t-1', { numeroEconomico: 'C2-08' }))
      .rejects.toThrow(/un_indice_que_nadie_previo/);
  });
});

describe('G-21(b) — un UPDATE que no empató nada NO es un éxito', () => {
  it('rechazar un POD que no es de esta flota lanza en vez de pintar verde', async () => {
    TABLAS = { ...FLOTA_BASE(), pod: [] };
    await expect(rechazarPod('t-1', 'p-ajeno', 'ilegible')).rejects.toThrow();
  });

  it('mover una incidencia que no existe lanza', async () => {
    TABLAS = { ...FLOTA_BASE(), incidencia: [] };
    await expect(cambiarEstadoIncidencia('t-1', 'i-ajena', 'resuelta')).rejects.toThrow();
  });

  it('mover una unidad que no existe lanza', async () => {
    TABLAS = { ...FLOTA_BASE(), unidad: [] };
    await expect(cambiarEstadoUnidad('t-1', 'u-ajena', 'taller')).rejects.toThrow();
  });

  it('asignar unidad a un viaje que no es de esta flota lanza', async () => {
    TABLAS = { ...FLOTA_BASE(), viaje: [] };
    await expect(asignarUnidad('t-1', 'v-ajeno', null)).rejects.toThrow();
  });
});

describe('G-21(c) — el id viene del formulario: hay que comprobar de quién es', () => {
  it('no se cuelga de un viaje una unidad de OTRA flota', async () => {
    TABLAS = { ...FLOTA_BASE(), unidad: [] };   // esa unidad no es de t-1
    await expect(asignarUnidad('t-1', 'v-1', 'u-de-otra-flota')).rejects.toThrow();
    expect(escrituras.filter((e) => e.op === 'update')).toHaveLength(0);
  });

  it('una incidencia no se levanta contra un viaje ajeno', async () => {
    TABLAS = { ...FLOTA_BASE(), viaje: [] };
    await expect(crearIncidencia('t-1', { tipo: 'retraso', viajeId: 'v-de-otra-flota' })).rejects.toThrow();
    expect(escrituras.filter((e) => e.tabla === 'incidencia')).toHaveLength(0);
  });

  it('no se le pide evidencia a un chofer que no es de esta flota', async () => {
    TABLAS = { ...FLOTA_BASE(), operador: [] };
    await expect(marcarPodPedido('t-1', 'v-1', 'o-de-otra-flota')).rejects.toThrow();
    expect(escrituras.filter((e) => e.tabla === 'pod')).toHaveLength(0);
  });

  it('un viaje nuevo no nace con el chofer de otra flota', async () => {
    TABLAS = { ...FLOTA_BASE(), operador: [] };
    await expect(crearViaje('t-1', { operadorId: 'o-de-otra-flota' })).rejects.toThrow();
    expect(escrituras.filter((e) => e.tabla === 'viaje')).toHaveLength(0);
  });
});

describe('G-57 — el despacho saca la unidad de "disponible"', () => {
  it('asignar una unidad la mueve a en_ruta', async () => {
    // Sin esto el encargado despacha las 8 unidades de la mañana y al mediodía
    // el tablero sigue diciendo "8 disponibles" con los 8 en carretera, y el
    // <select> vuelve a ofrecer C2-08 para el noveno viaje.
    TABLAS = FLOTA_BASE();
    await asignarUnidad('t-1', 'v-1', 'u-1');
    const w = escrituras.find((e) => e.tabla === 'unidad' && e.op === 'update')!;
    expect(w).toBeDefined();
    expect(w.valores).toEqual({ estado: 'en_ruta' });
    expect(w.filtros).toEqual([['id', 'u-1'], ['tenant_id', 't-1']]);
  });

  it('desasignar devuelve la unidad que traía a disponible', async () => {
    TABLAS = { ...FLOTA_BASE(), viaje: [{ id: 'v-1', unidad_id: 'u-1' }] };
    await asignarUnidad('t-1', 'v-1', null);
    const w = escrituras.find((e) => e.tabla === 'unidad' && e.op === 'update')!;
    expect(w.valores).toEqual({ estado: 'disponible' });
    expect(w.filtros).toEqual([['id', 'u-1'], ['tenant_id', 't-1']]);
  });

  it('cambiar de unidad libera la vieja y ocupa la nueva', async () => {
    TABLAS = {
      ...FLOTA_BASE(),
      viaje: [{ id: 'v-1', unidad_id: 'u-vieja' }],
      unidad: [{ id: 'u-vieja' }, { id: 'u-nueva' }],
    };
    await asignarUnidad('t-1', 'v-1', 'u-nueva');
    const movidas = escrituras.filter((e) => e.tabla === 'unidad' && e.op === 'update');
    expect(movidas.map((m) => [m.filtros[0][1], (m.valores as { estado: string }).estado]))
      .toEqual([['u-vieja', 'disponible'], ['u-nueva', 'en_ruta']]);
  });

  it('crear un viaje CON unidad también la ocupa', async () => {
    TABLAS = FLOTA_BASE();
    await crearViaje('t-1', { operadorId: 'o-1', unidadId: 'u-1' });
    const w = escrituras.find((e) => e.tabla === 'unidad' && e.op === 'update')!;
    expect(w.valores).toEqual({ estado: 'en_ruta' });
  });
});

describe('G-20 (mitigación) — un viaje sin chofer no se intenta escribir', () => {
  it('crearViaje sin operador dice qué falta en vez de tumbarse con un 23502', async () => {
    // `viaje.operador_id` es NOT NULL desde la 0001. Hasta que la columna se
    // haga nullable, un viaje sin chofer es un error de la BASE, no de la
    // captura — y el encargado solo vería "hubo un problema" con un hash.
    TABLAS = FLOTA_BASE();
    await expect(crearViaje('t-1', { folio: 'VJ-9' })).rejects.toThrow(/chofer|operador/i);
    expect(escrituras.filter((e) => e.tabla === 'viaje')).toHaveLength(0);
  });
});
