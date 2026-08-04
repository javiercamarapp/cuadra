import { describe, it, expect, vi, beforeEach } from 'vitest';

const createUser = vi.fn();
const deleteUser = vi.fn();
const insert = vi.fn();
const maybeSingle = vi.fn();

// `from` sirve a DOS cadenas distintas: el `insert` de `app_user` y el
// `select().eq().eq().maybeSingle()` con el que se comprueba que el chofer sea
// de esta flota antes de tocar Auth.
const from = vi.fn((tabla: string) => ({
  insert,
  select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
  _tabla: tabla,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: (...a: unknown[]) => createUser(...a),
        deleteUser: (...a: unknown[]) => deleteUser(...a),
      },
    },
    from: (...a: unknown[]) => from(...(a as [string])),
  }),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { provisionarUsuario } = await import('./provisionar');

describe('provisionarUsuario', () => {
  beforeEach(() => {
    createUser.mockReset();
    deleteUser.mockReset();
    deleteUser.mockResolvedValue({ error: null });
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: { id: 'op-1' }, error: null });
    from.mockClear();
    logger.warn.mockReset(); logger.error.mockReset();
  });

  it('crea el usuario de Auth y la fila de app_user con rol flota_admin por default', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const r = await provisionarUsuario('t-1', 'contralor@innovativos.mx', 'Ana Ruiz');
    expect(createUser).toHaveBeenCalledWith({ email: 'contralor@innovativos.mx', email_confirm: true });
    expect(from).toHaveBeenCalledWith('app_user');
    // Sin `operador_id`: los cuatro roles que no son chofer no dependen de que
    // la 0045 esté aplicada para poder darse de alta.
    expect(insert).toHaveBeenCalledWith({
      id: 'u-1', tenant_id: 't-1', email: 'contralor@innovativos.mx', nombre: 'Ana Ruiz', rol: 'flota_admin',
    });
    expect(r).toEqual({ userId: 'u-1' });
  });

  it('sin nombre, nombre queda null', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
    await provisionarUsuario('t-1', 'sin-nombre@innovativos.mx');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ nombre: null }));
  });

  it('si Auth falla al crear el usuario, lanza con el mensaje de Supabase', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'correo ya registrado' } });
    await expect(provisionarUsuario('t-1', 'ya@existe.mx')).rejects.toThrow('correo ya registrado');
    expect(insert).not.toHaveBeenCalled();
  });

  it('superadmin: tenantId null y rol explícito, se respetan tal cual', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-3' } }, error: null });
    const r = await provisionarUsuario(null, 'javier@likida.ai', 'Javier', 'superadmin');
    expect(insert).toHaveBeenCalledWith({
      id: 'u-3', tenant_id: null, email: 'javier@likida.ai', nombre: 'Javier', rol: 'superadmin',
    });
    expect(r).toEqual({ userId: 'u-3' });
  });

  // Quinto rol del panel (docs/superpowers/plans/2026-08-02-roles-flota.md):
  // ve todo el tenant y puede asignar viajes a choferes, sin llegar a
  // facturación/invitar usuarios (eso sigue siendo solo de flota_admin).
  it('acepta rol encargado', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-4' } }, error: null });
    await provisionarUsuario('t-1', 'encargado@innovativos.mx', 'Luis', 'encargado');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ rol: 'encargado' }));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 10, ALTO de backend — dos escrituras a dos sistemas sin
  // compensación, y un rol que el formulario ofrece y la función no completa.
  //
  // El caso del insert fallido NUNCA se ejerció: el `beforeEach` de este mismo
  // archivo fijaba `insert` en `{ error: null }` y ningún caso lo movía.
  // ═════════════════════════════════════════════════════════════════════════
  describe('las dos escrituras no se pueden separar en silencio', () => {
    it('si el insert falla, el usuario de Auth recién creado se borra', async () => {
      // Basta un blip de red, el `unique(email)` de 0001_init.sql:18 si la fila
      // ya existía, o el check `app_user_rol_dominio`. Sin compensación, Javier
      // reintenta y `createUser` responde «already been registered»: ese correo
      // queda quemado desde el producto PARA SIEMPRE, hasta que alguien entre a
      // la consola de Supabase.
      createUser.mockResolvedValue({ data: { user: { id: 'u-77' } }, error: null });
      insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "app_user_email_key"' } });

      await expect(provisionarUsuario('t-1', 'juan@innovativos.mx', 'Juan')).rejects.toThrow(/duplicate key/);
      expect(deleteUser).toHaveBeenCalledWith('u-77');
      expect(logger.warn).toHaveBeenCalledWith('provisionar.compensado', expect.objectContaining({
        userId: 'u-77', email: 'juan@innovativos.mx',
      }));
    });

    it('y si el borrado de compensación también falla, queda escrito qué correo hay que limpiar a mano', async () => {
      createUser.mockResolvedValue({ data: { user: { id: 'u-88' } }, error: null });
      insert.mockResolvedValue({ error: { message: 'fetch failed' } });
      deleteUser.mockResolvedValue({ error: { message: 'service unavailable' } });

      await expect(provisionarUsuario('t-1', 'medias@innovativos.mx')).rejects.toThrow('fetch failed');
      expect(logger.error).toHaveBeenCalledWith('provisionar.huerfano', expect.objectContaining({
        userId: 'u-88', email: 'medias@innovativos.mx',
      }));
    });
  });

  describe('el rol operador ya no puede nacer roto', () => {
    it('sin `operadorId` no se crea NADA: se rechaza antes de tocar Auth', async () => {
      // Antes: la cuenta se creaba con `operador_id = null`, `requireOperador`
      // la mandaba a /sin-acceso ("pide tu alta" — acaban de dársela) y ninguna
      // pantalla del repo podía llenar esa columna.
      await expect(provisionarUsuario('t-1', 'chofer@innovativos.mx', 'Juan', 'operador'))
        .rejects.toThrow(/operador_id|ligado/i);
      expect(createUser).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('con `operadorId` de la flota, la cuenta nace ligada y sirve', async () => {
      createUser.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null });
      const r = await provisionarUsuario('t-1', 'chofer@innovativos.mx', 'Juan', 'operador', 'op-1');
      expect(from).toHaveBeenCalledWith('operador');
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ rol: 'operador', operador_id: 'op-1' }));
      expect(r).toEqual({ userId: 'u-9' });
    });

    it('un `operadorId` de OTRA flota se rechaza sin crear el usuario de Auth', async () => {
      // El `<select>` que lista solo los choferes propios es una lista en el
      // navegador, no una restricción: el mismo criterio que `reasignarOperador`.
      maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(provisionarUsuario('t-1', 'chofer@innovativos.mx', 'Juan', 'operador', 'op-de-la-flota-B'))
        .rejects.toThrow(/no pertenece a esta flota/i);
      expect(createUser).not.toHaveBeenCalled();
    });

    it('un `operadorId` colgado de un rol que no es chofer se rechaza', async () => {
      await expect(provisionarUsuario('t-1', 'contador@innovativos.mx', 'Marisol', 'contador', 'op-1'))
        .rejects.toThrow(/solo se llena cuando el rol es 'operador'/i);
      expect(createUser).not.toHaveBeenCalled();
    });
  });
});
