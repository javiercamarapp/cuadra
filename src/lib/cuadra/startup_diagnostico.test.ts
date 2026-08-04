import { describe, it, expect, vi, beforeEach } from 'vitest';

// EL FALLO QUE ESTO FIJA — leído en los logs de producción del 28-jul-2026.
//
//   [error] startup.migraciones
//   "FALTA la migración 0005 (try_lock_viaje / unique(viaje_id)):
//    la protección de doble liquidación NO está activa."
//   err: "TypeError: fetch failed"
//
// Las cuatro migraciones estaban aplicadas. Se comprobó llamando a los RPC
// directamente contra Supabase: `try_lock_viaje` → true, `intake_delta` → 0,
// `enriquecer_gasto_codigo` → false, `codigo_pendiente` → 200.
//
// El chequeo trataba CUALQUIER error como "falta la migración", incluido un
// fallo de red. Eso convierte el aviso que protege el dinero —doble
// liquidación— en uno que se aprende a ignorar.

const rpc = vi.fn();
const from = vi.fn();
const getBucket = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from, storage: { getBucket } }) }));

const error = vi.fn();
const warn = vi.fn();
const info = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error: (...a: unknown[]) => error(...a), warn: (...a: unknown[]) => warn(...a), info: (...a: unknown[]) => info(...a) } }));

const { verificarMigracionesCriticas } = await import('./startup');

// Stub encadenable: el sondeo de la 0016 usa `.select().limit()` y el de la 0019
// `.select().not().limit()`. Un stub que solo soporta una de las dos cadenas hace
// que la otra lance, el `catch` general se lo trague como `migraciones_skip`, y
// las pruebas midan cualquier cosa menos lo que dicen medir.
const tabla = (resultado: { error: unknown } = { error: null }) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'eq', 'limit']) enlace[m] = () => enlace;
  // `await` sobre el enlace resuelve al resultado (igual que el query builder real).
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return enlace;
};
const okTabla = tabla();

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); error.mockReset(); warn.mockReset(); info.mockReset();
  from.mockReturnValue(okTabla);
  // Bucket presente por default: lo contrario haría que TODA prueba de este
  // archivo midiera además el sondeo de la 0039.
  getBucket.mockReset();
  getBucket.mockResolvedValue({ data: { id: 'comprobantes' }, error: null });
});

describe('diagnóstico de migraciones', () => {
  it('un fallo de RED no se reporta como migración faltante', async () => {
    // Así lo entrega supabase-js: sin código, con el TypeError envuelto.
    rpc.mockResolvedValue({ error: { code: '', message: 'TypeError: fetch failed' } });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
    const [, meta] = warn.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('NO se pudo verificar');
    expect(meta.msg).not.toContain('FALTA');
  });

  it('una migración que de verdad falta SÍ se reporta como error', async () => {
    // PostgREST contesta con código cuando la función no existe: hubo respuesta.
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function public.try_lock_viaje' } });
    await verificarMigracionesCriticas();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('startup.migraciones', expect.objectContaining({ code: 'PGRST202' }));
    const [, meta] = error.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('FALTA la migración 0005');
  });

  it('con todo aplicado, dice que está bien y no grita', async () => {
    rpc.mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  // ── CRÍTICO de la auditoría 10 (modelo de datos) ──────────────────────────
  //
  // Nada sondaba la 0045, y su ausencia es de las peores que hay: el `select`
  // de `getSessionTenant` pide `operador_id`, una columna que NACE en esa
  // migración. Si no está, PostgREST falla el select ENTERO, `data` queda en
  // null y TODO usuario —el contralor, y también el superadmin— sale con
  // `tenantId: null` y aterriza en /sin-acceso. El panel no se ve roto: se ve
  // como si nadie tuviera alta. Y el arranque decía `ok: true`.
  it('si falta la 0045, el arranque lo dice — es la que deja a TODOS fuera del panel', async () => {
    rpc.mockResolvedValue({ error: null });
    from.mockImplementation((t: string) => (t === 'app_user'
      ? tabla({ error: { code: '42703', message: 'column app_user.operador_id does not exist' } })
      : okTabla));
    await verificarMigracionesCriticas();

    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
    const dicho = error.mock.calls.map(([, m]) => (m as { msg: string }).msg).join(' ');
    expect(dicho).toContain('0045');
    expect(dicho, 'y que diga la consecuencia, no solo el número').toMatch(/panel|sin-acceso|fuera/i);
  });

  it('un fallo de RED sobre esa misma sonda no se reporta como migración faltante', async () => {
    rpc.mockResolvedValue({ error: null });
    from.mockImplementation((t: string) => (t === 'app_user'
      ? tabla({ error: { code: '', message: 'TypeError: fetch failed' } })
      : okTabla));
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  // La red se puede caer en cualquiera de los cuatro probes, no solo en el primero.
  it('el mismo criterio aplica al probe de la barrera de intake', async () => {
    rpc.mockResolvedValueOnce({ error: null })                                        // 0005 ok
       .mockResolvedValueOnce({ error: null })                                        // unlock
       .mockResolvedValueOnce({ error: { code: '', message: 'fetch failed' } })       // 0011 sin red
       .mockResolvedValue({ error: null });                                           // el resto ok
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  // El límite: un error CON código, aunque el mensaje suene a red, es una
  // respuesta de la base. No se puede perder por parecerse a un fallo de red.
  it('un error con código nunca se degrada a "no se pudo verificar"', async () => {
    rpc.mockResolvedValue({ error: { code: '42883', message: 'function does not exist (socket)' } });
    await verificarMigracionesCriticas();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

// CRÍTICO de la auditoría 5 (modelo de datos): la migración 0022 estaba aplicada
// en producción y NO existía en el repo — `git log --all --diff-filter=A` sobre
// `supabase/migrations/0022*` sale vacío. Cualquier `supabase db push` sobre un
// proyecto limpio nace con las dos firmas de `guardar_liquidacion_tx` y ninguna
// liquidación cierra. Y este chequeo no la sondeaba: decía `ok: true`.
describe('la sobrecarga ambigua de guardar_liquidacion_tx', () => {
  it('con DOS firmas vivas, el arranque lo grita en vez de decir ok', async () => {
    // POR NOMBRE, no por posición. Estaba encadenado con `mockResolvedValueOnce`
    // en el orden exacto de los sondeos, así que agregar uno nuevo en medio
    // —el de la 0033— corría la fila y esta prueba empezaba a medir otra cosa.
    // Una prueba que se rompe al insertar un sondeo ANTES del que le importa no
    // está midiendo lo que dice.
    rpc.mockImplementation(async (nombre: string) => (nombre === 'guardar_liquidacion_tx'
      ? { error: { code: '42725', message: 'function guardar_liquidacion_tx(...) is not unique' } }
      : { data: [], error: null }));
    await verificarMigracionesCriticas();

    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
    expect(error).toHaveBeenCalledWith('startup.migraciones', expect.objectContaining({ code: '42725' }));
    const [, meta] = error.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('0022');
    expect(meta.msg).toContain('NINGUNA liquidación puede cerrar');
  });

  it('un error NORMAL de esa sonda (tenant inexistente) no se confunde con la ambigüedad', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await verificarMigracionesCriticas();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });
});

// ALTO de la auditoría 5 (operabilidad): el arranque salía al PRIMER fallo, así
// que con dos migraciones ausentes solo se veía UNA por ciclo de despliegue: se
// arreglaba, se volvía a desplegar, y aparecía la siguiente. Y la 0019 no se
// sondeaba: sin `uq_gasto_cfdi_uuid` el mismo CFDI de diésel entra dos veces, se
// cuenta doble en el comprobado y su IVA se acredita por duplicado.
describe('el arranque dice TODO lo que falta, no lo primero', () => {
  it('con dos migraciones ausentes, reporta las dos', async () => {
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'no try_lock_viaje' } })  // 0005
       .mockResolvedValueOnce({ error: null })                                                // unlock
       .mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'no intake_delta' } })     // 0011
       .mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0005');
    expect(mensajes).toContain('0011');
  });

  it('con algo faltando NO dice ok', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'nada existe' } });
    await verificarMigracionesCriticas();
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  // REESCRITA EN LA AUDITORÍA 6. Antes esta prueba pasaba haciendo fallar la
  // TABLA `gasto` entera, que es un fallo de otra cosa. El sondeo real
  // —`select cfdi_uuid ... limit 1`— no podía detectar la ausencia del ÍNDICE:
  // `cfdi_uuid` es una columna de `0001_init.sql` y la consulta responde igual
  // de bien sin la 0019. La prueba verde daba por cubierto lo que no lo estaba.
  it('el índice de la 0019 se sonda contra el catálogo, no contra la columna', async () => {
    rpc.mockResolvedValue({ data: ['uq_gasto_cfdi_uuid'], error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('uq_gasto_cfdi_uuid');
    expect(mensajes).toContain('mismo CFDI se liquida dos veces');
  });

  it('y el de la 0024, que evita cargarle el gasto a quien no fue', async () => {
    rpc.mockResolvedValue({ data: ['uq_operador_telefono_activo'], error: null });
    await verificarMigracionesCriticas();
    expect(error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | '))
      .toContain('uq_operador_telefono_activo');
  });

  it('si falta la función que los sonda, se dice ESO y no "falta la 0019"', async () => {
    // La distinción que costó un diagnóstico falso en producción: "no pude
    // preguntar" no es "no está".
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function public.indices_faltantes' } });
    await verificarMigracionesCriticas();
    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0030');
  });

  it('con todos los índices puestos no inventa un faltante', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await verificarMigracionesCriticas();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });
});

// AUDITORÍA 9, CRÍTICO (operabilidad) — "0036/0037, el trigger que blinda el
// peor bug histórico del camino del dinero, y ninguna línea de este archivo
// lo sondeaba." PostgREST no expone `pg_trigger`, así que el sondeo pasa por
// una función del esquema, mismo patrón que `indices_faltantes`.
//
// ── QUÉ CAMBIÓ EN LA AUDITORÍA 10 (MEDIO de modelo de datos) ────────────────
//
// Este bloque afirmaba que la función era `triggers_faltantes` (0043), que
// sondea por NOMBRE. Esa premisa se retira, no porque estuviera mal escrita,
// sino porque el mecanismo no alcanzaba: la 0042 hace `drop trigger` +
// `create trigger` con EL MISMO NOMBRE que la 0037, cambiando solo el `when`.
// Con la 0037 aplicada y la 0042 no, los dos nombres existen, `triggers_faltantes`
// devuelve `{}`, el arranque escribe `{ok: true}`, y un
// `UPDATE gasto SET fecha = ...` posterior a la liquidación vuelve a pasar sin
// CU001. El sondeo ahora es `triggers_desactualizados` (0052), que mira el
// CUERPO con `pg_get_triggerdef`. Los casos de abajo son los mismos; lo que
// cambia es la migración que se nombra cuando la función no está.
describe('los triggers de "nada entra ni se reescribe tras liquidar" (0036/0037/0042)', () => {
  it('si el trigger de INSERT falta, lo dice con la migración y la consecuencia', async () => {
    rpc.mockResolvedValue({ data: ['trg_gasto_no_tras_liquidar'], error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('trg_gasto_no_tras_liquidar');
    expect(mensajes).toContain('0036');
    expect(mensajes).toContain('cifras contrarias');
  });

  it('si el trigger de UPDATE falta, lo dice con las dos migraciones que lo escribieron', async () => {
    rpc.mockResolvedValue({ data: ['trg_gasto_no_tras_liquidar_update'], error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('trg_gasto_no_tras_liquidar_update');
    expect(mensajes).toContain('0037');
    expect(mensajes).toContain('0042');
  });

  it('con algo faltando NO dice ok, ni siquiera si el resto de migraciones están', async () => {
    rpc.mockResolvedValue({ data: ['trg_gasto_no_tras_liquidar'], error: null });
    await verificarMigracionesCriticas();
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  it('si falta la función que los sonda, se dice ESO y no "falta el trigger"', async () => {
    // Misma distinción que ya existe para índices: "no pude preguntar" no es
    // "no está" — un diagnóstico falso manda a correr `db push` contra un
    // problema que no existe.
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function public.triggers_desactualizados' } });
    await verificarMigracionesCriticas();
    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0052');
  });

  it('con los dos triggers puestos no inventa un faltante', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await verificarMigracionesCriticas();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIO de la auditoría 10 (modelo de datos) — la sonda no distinguía el
  // trigger de la 0037 del de la 0042.
  //
  // Los dos se llaman `trg_gasto_no_tras_liquidar_update`. Lo único que los
  // separa es que el `when` de la 0042 incluye `new.fecha`, y `fecha` decide
  // ejercicio, plazo de facturación y el tope diario de LISR 28-V. Una sonda de
  // EXISTENCIA es ciega a eso por construcción.
  // ═══════════════════════════════════════════════════════════════════════════
  it('pregunta por el CUERPO del trigger, no por su nombre', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await verificarMigracionesCriticas();

    const llamada = rpc.mock.calls.find(([f]) => f === 'triggers_desactualizados');
    expect(llamada, 'el arranque sigue sondeando por nombre: la 0042 es indetectable así').toBeTruthy();
    const esperados = (llamada![1] as { p_esperados: Record<string, string> }).p_esperados;
    // `new.fecha` SOLO aparece en el `when` que escribió la 0042.
    expect(esperados.trg_gasto_no_tras_liquidar_update).toContain('new.fecha');
    expect(esperados.trg_gasto_no_tras_liquidar).toContain('before insert');
  });

  it('si el UPDATE existe pero es el de la 0037, lo dice — y dice qué se pierde', async () => {
    // El caso que el arranque daba por bueno: el nombre está, el `when` no
    // tiene `fecha`, y `corregirFechaGasto` reescribe la fecha de un gasto
    // después de emitida la liquidación sin CU001.
    rpc.mockResolvedValue({ data: ['trg_gasto_no_tras_liquidar_update'], error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('DESACTUALIZADO');
    expect(mensajes).toContain('0042');
    expect(mensajes).toMatch(/LISR 28-V|plazo de facturación/);
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · EL CONTADOR DE LA BARRERA NO SABÍA OLVIDAR (migración 0031).
//
// La 0011 dejó un contador puro: `+1` al entrar la foto, `-1` en el `finally`
// del OCR. Un `finally` no corre cuando el proceso no vuelve, y la función del
// webhook tiene `maxDuration = 120`: si Vercel la mata por tope, por memoria o
// por un despliegue a media ráfaga, el `+1` queda y el `-1` no llega nunca.
//
// A partir de ahí ese viaje queda averiado PARA SIEMPRE: cada "listo" espera los
// 20s completos de la barrera y termina avisándole al operador que se cuadró con
// gastos parciales sobre una liquidación que estaba entera. El aviso que existe
// para advertir de dinero perdido se vuelve permanente y falso justo en el viaje
// que ya sufrió una caída — el mejor sitio para enseñar a ignorarlo.
// ═══════════════════════════════════════════════════════════════════════════
describe('el TTL del contador de la barrera (0031)', () => {
  /** `from` por tabla: el sondeo de la 0031 lee `viaje`, el de la 0016 `codigo_pendiente`. */
  const porTabla = (mapa: Record<string, { error: unknown }>) =>
    from.mockImplementation((t: string) => tabla(mapa[t] ?? { error: null }));

  it('sin la columna, el arranque lo dice — y dice qué se rompe', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    // 42703 es el `undefined_column` de Postgres, que es como contesta PostgREST
    // a un `select` de una columna que no existe.
    porTabla({ viaje: { error: { code: '42703', message: 'column viaje.intake_pendientes_en does not exist' } } });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0031');
    // La consecuencia, no solo el número: un mensaje que solo dice "falta la
    // 0031" no le dice a quien lo lee de madrugada si puede esperar al lunes.
    expect(mensajes).toContain('liquidación corta');
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  it('un fallo de RED en ese sondeo tampoco se reporta como migración faltante', async () => {
    // El mismo criterio que ya rige a los otros cinco: "no pude preguntar" no es
    // "no está". Sin código de error no hubo respuesta de la base.
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({ viaje: { error: { code: '', message: 'TypeError: fetch failed' } } });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  it('con la 0031 aplicada no inventa nada', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({});
    await verificarMigracionesCriticas();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, MEDIO · LO QUE EL PROBE TODAVÍA NO MIRABA.
//
// `grep -n "0038\|0039\|0040\|0044"` sobre startup.ts daba cero. De esas
// cuatro, dos merecen sonda y dos NO — y decirlo importa tanto como añadirlas:
//
//   · 0038 (`foto_pendiente`) la REVIERTE la 0041 con un `drop table`. Sondear
//     su presencia sería gritar por una tabla que tiene que NO existir.
//   · 0044 solo extiende el dominio de `app_user_rol_dominio` con `encargado`.
//     Su ausencia falla RUIDOSAMENTE y en el sitio exacto: el insert de
//     `/admin/usuarios/nuevo` rebota con un check violation que el superadmin
//     ve en pantalla. Además PostgREST no expone `pg_constraint`, así que
//     sondearla pediría una migración nueva (`restricciones_faltantes`) para
//     cubrir un fallo que ya se ve solo.
//
// Las otras dos son de las que se pierden en silencio, que es el criterio de
// este archivo.
// ═══════════════════════════════════════════════════════════════════════════
describe('el bucket de comprobantes (0039) y la sala de espera (0040)', () => {
  const porTabla = (mapa: Record<string, { error: unknown }>) =>
    from.mockImplementation((t: string) => tabla(mapa[t] ?? { error: null }));

  it('sin el bucket `comprobantes`, el arranque lo dice — y dice que se pierden los tickets', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({});
    getBucket.mockResolvedValue({ data: null, error: { message: 'Bucket not found', status: 404 } });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0039');
    // La consecuencia, no solo el número. `subirComprobante` no tumba el
    // intake a propósito: el gasto entra igual y la foto se pierde, con un
    // `warn` por foto en el turno del operador. Cinco años de conservación del
    // CFF art. 30 dependen de que ese bucket exista.
    expect(mensajes).toMatch(/foto|comprobante|ticket/i);
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  it('un fallo de RED sobre el bucket no se reporta como migración faltante', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({});
    getBucket.mockResolvedValue({ data: null, error: { message: 'TypeError: fetch failed' } });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  it('sin `comprobante_huerfano`, el arranque lo dice — el chofer sin viaje abierto pierde sus fotos', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({ comprobante_huerfano: { error: { code: '42P01', message: 'relation "comprobante_huerfano" does not exist' } } });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0040');
    expect(mensajes).toMatch(/sin viaje|sala de espera|se pierde/i);
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  it('un fallo de RED sobre esa tabla tampoco', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({ comprobante_huerfano: { error: { code: '', message: 'TypeError: fetch failed' } } });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  // CONTROL: con las dos aplicadas el arranque no inventa nada y sigue diciendo
  // `ok: true` — un probe que grita de más entrena a ignorar el que grita bien.
  it('CONTROL: con las dos aplicadas no inventa un faltante', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    porTabla({});
    await verificarMigracionesCriticas();
    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  // Y la 0038 al revés: la 0041 la revierte, así que `foto_pendiente` NO tiene
  // que existir. Si alguien añade la sonda "por completar la lista", esta
  // prueba lo detiene.
  it('CONTROL: la 0038 está revertida (0041) y NO se sondea su tabla', async () => {
    const tablas: string[] = [];
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((t: string) => { tablas.push(t); return okTabla; });
    await verificarMigracionesCriticas();
    expect(tablas, '`drop table foto_pendiente` (0041): sondearla gritaría por una tabla que debe faltar')
      .not.toContain('foto_pendiente');
  });
});
