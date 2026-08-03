import { describe, it, expect, vi, beforeEach } from 'vitest';

// listOperadores / reasignarOperador — la lectura y la escritura que Task 3
// del plan de roles necesita para que `encargado`/`flota_admin` puedan mover
// un viaje de un chofer a otro desde el panel.
const order = vi.fn();
const eqOperador = vi.fn(() => ({ order }));
const eqActivo = vi.fn(() => ({ eq: eqOperador }));
const select = vi.fn(() => ({ eq: eqActivo }));

const updateResult = vi.fn();
const selectUpdate = vi.fn(() => updateResult());
const eqTenantUpdate = vi.fn(() => ({ select: selectUpdate }));
const eqViajeUpdate = vi.fn(() => ({ eq: eqTenantUpdate }));
const update = vi.fn(() => ({ eq: eqViajeUpdate }));

// Sonda de pertenencia: `operador` filtrado por id + tenant, antes de escribir.
const dueño = vi.fn();
const eqDuenoTenant = vi.fn(() => ({ maybeSingle: () => dueño() }));
const eqDuenoId = vi.fn(() => ({ eq: eqDuenoTenant }));
const selectDueno = vi.fn(() => ({ eq: eqDuenoId }));

let modoOperador: 'lista' | 'dueño' = 'lista';
const from = vi.fn((tabla: string) =>
  tabla === 'operador' ? (modoOperador === 'lista' ? { select } : { select: selectDueno }) : { update });
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { listOperadores, reasignarOperador } = await import('./repo');

describe('listOperadores', () => {
  beforeEach(() => { order.mockReset(); from.mockClear(); modoOperador = 'lista'; });

  it('trae solo los activos del tenant, ordenados por nombre', async () => {
    order.mockResolvedValue({ data: [{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }], error: null });
    const r = await listOperadores('t-1');
    expect(from).toHaveBeenCalledWith('operador');
    expect(eqActivo).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqOperador).toHaveBeenCalledWith('activo', true);
    expect(order).toHaveBeenCalledWith('nombre');
    expect(r).toEqual([{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }]);
  });

  it('si la consulta falla, lanza — un listado vacío por error se leería como "sin choferes"', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(listOperadores('t-1')).rejects.toThrow('timeout');
  });
});

describe('reasignarOperador', () => {
  beforeEach(() => {
    updateResult.mockReset(); from.mockClear(); update.mockClear();
    dueño.mockReset(); modoOperador = 'dueño';
    dueño.mockResolvedValue({ data: { id: 'o-2' }, error: null });   // el chofer SÍ es del tenant
  });

  it('actualiza operador_id del viaje, acotado por tenant', async () => {
    updateResult.mockResolvedValue({ data: [{ id: 'v-1' }], error: null });
    await reasignarOperador('t-1', 'v-1', 'o-2');
    expect(from).toHaveBeenCalledWith('viaje');
    expect(update).toHaveBeenCalledWith({ operador_id: 'o-2' });
    expect(eqViajeUpdate).toHaveBeenCalledWith('id', 'v-1');
    expect(eqTenantUpdate).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  it('si falla, lanza con el mensaje', async () => {
    updateResult.mockResolvedValue({ data: null, error: { message: 'operador no existe' } });
    await expect(reasignarOperador('t-1', 'v-1', 'o-x')).rejects.toThrow('operador no existe');
  });

  // ── ALTO de la auditoría 10 (backend) ──────────────────────────────────
  //
  // El server action revalidaba sesión y permiso, pero no el VALOR: tomaba
  // `formData.get('operadorId')`, comprobaba que no estuviera vacío y lo
  // pasaba tal cual. El `<select>` que lista solo los choferes propios es una
  // lista en el navegador, no una restricción, y la FK
  // `viaje.operador_id references operador(id)` acepta cualquier operador de
  // cualquier flota.
  //
  // Escenario: el dueño de la flota A reenvía la acción con el UUID de un
  // chofer de la flota B. El UPDATE corre y el viaje de A queda apuntando a un
  // chofer de B. Y la policy `operador_ve_su_viaje` de la 0045 dice
  // literalmente `using (operador_id = get_user_operador_id())` — SIN
  // tenant_id. El chofer de B abre /mis-viajes y lee el viaje, los gastos y la
  // liquidación de la flota A.
  //
  // Es el único punto del repo donde una escritura de aplicación puede romper
  // el aislamiento multi-tenant que todo lo demás defiende.
  it('rechaza un operador que NO es del tenant, y no llega a escribir', async () => {
    dueño.mockResolvedValue({ data: null, error: null });   // el UUID existe, pero es de otra flota
    await expect(reasignarOperador('t-1', 'v-1', 'o-de-otra-flota')).rejects.toThrow(/no pertenece|tenant/i);
    expect(update, 'la escritura no puede intentarse siquiera').not.toHaveBeenCalled();
  });

  it('la sonda de pertenencia filtra por id Y por tenant', async () => {
    updateResult.mockResolvedValue({ data: [{ id: 'v-1' }], error: null });
    await reasignarOperador('t-1', 'v-1', 'o-2');
    expect(eqDuenoId).toHaveBeenCalledWith('id', 'o-2');
    expect(eqDuenoTenant).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  // Segunda mitad del mismo hallazgo: el UPDATE no pedía `.select()` ni miraba
  // filas afectadas, así que con un `viajeId` que no empata (viaje borrado,
  // tenant equivocado) NO lanzaba: el server action redirigía como si hubiera
  // funcionado y el panel seguía enseñando el chofer anterior, sin un log.
  it('si el UPDATE no tocó ninguna fila, lanza en vez de fingir que funcionó', async () => {
    updateResult.mockResolvedValue({ data: [], error: null });
    await expect(reasignarOperador('t-1', 'v-inexistente', 'o-2')).rejects.toThrow(/no se reasignó|ninguna fila/i);
  });
});
