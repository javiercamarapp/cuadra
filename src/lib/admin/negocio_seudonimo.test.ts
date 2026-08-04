import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-53, CRÍTICO (legal) — /admin EXHIBÍA EL TELÉFONO Y LA
// TRANSCRIPCIÓN ÍNTEGRA DE OPERADORES IDENTIFICABLES, CRUZANDO FLOTAS.
//
// Este grupo venía marcado «YA ARREGLADO EN EL PR #7». No lo estaba en este
// árbol: `negocio.ts` es uno de los archivos que `master` también tocó, así
// que el arreglo (`5b43fd8`) no se pudo traer y `getConversacionesActivas`
// seguía devolviendo `telefono` + `turns` completos. `admin/layout.tsx:42` la
// llama en CADA carga de CUALQUIER página de /admin, y cinco pantallas pintan
// el número: en `conversaciones/page.tsx:47` la etiqueta de cada barra de un
// `HBars` ES el teléfono del operador.
//
// Contra `privacidad.ts:511-512`, que es el texto que el operador abre y
// acepta: «Medir cómo funciona el servicio para mejorarlo (estadísticas de
// uso, SIN IDENTIFICARTE EN LOS REPORTES)». Si en la misma sesión del demo se
// abre /admin y /aviso/[tenant], las dos pantallas se desmienten a un clic.
//
// El dato real no se borra —sigue en `wa_conversacion`, que es donde tiene
// que estar y donde el procedimiento ARCO lo alcanza—. Lo que cambia es lo
// que sale hacia la pantalla de estadísticas.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = self;
  b.range = () => Promise.resolve(resp());
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getConversacionesActivas, seudonimoOperador, redactarTexto } = await import('./negocio');

const TELEFONO = '529993700779';

function conversacion(turns: Array<{ role: string; content: string }>, telefono = TELEFONO) {
  return {
    telefono, updated_at: '2026-08-02T20:00:00Z',
    estado: { turns }, tenant: { nombre: 'Transportes Innovativos' },
  };
}

beforeEach(() => { respuestas.clear(); });

describe('seudonimoOperador — estable, legible y sin el número dentro', () => {
  it('el mismo teléfono da siempre el mismo seudónimo', () => {
    expect(seudonimoOperador(TELEFONO)).toBe(seudonimoOperador(TELEFONO));
  });

  it('dos teléfonos distintos dan seudónimos distintos', () => {
    expect(seudonimoOperador(TELEFONO)).not.toBe(seudonimoOperador('529990000000'));
  });

  it('el seudónimo NO contiene el número ni sus últimos dígitos', () => {
    const s = seudonimoOperador(TELEFONO);
    expect(s).not.toContain(TELEFONO);
    expect(s).not.toContain('0779');
    expect(s).not.toContain('700779');
  });

  it('se lee como una etiqueta, no como un hash de 64 caracteres (va en el eje de una gráfica)', () => {
    expect(seudonimoOperador(TELEFONO)).toMatch(/^Operador [0-9A-Z]{4}$/);
  });

  it('normaliza el formato del número: +52 999 370 07 79 y 529993700779 son la misma persona', () => {
    expect(seudonimoOperador('+52 999 370 07 79')).toBe(seudonimoOperador(TELEFONO));
  });
});

describe('redactarTexto — la transcripción no lleva identificadores dentro', () => {
  it('tapa un teléfono escrito en el mensaje', () => {
    expect(redactarTexto('márcame al 9993700779 porfa')).not.toContain('9993700779');
  });
  it('tapa un RFC', () => {
    expect(redactarTexto('la factura es de PEGJ850315AB1')).not.toContain('PEGJ850315AB1');
  });
  it('tapa un correo', () => {
    expect(redactarTexto('mándalo a juan.perez@flota.mx')).not.toContain('juan.perez@flota.mx');
  });
  it('deja pasar lo que sí es del negocio', () => {
    const t = redactarTexto('gasté 1,250 pesos de diesel en Querétaro');
    expect(t).toContain('diesel');
    expect(t).toContain('Querétaro');
  });
});

describe('getConversacionesActivas — lo que sale a la pantalla', () => {
  it('NO devuelve el teléfono: devuelve el seudónimo', async () => {
    respuestas.set('wa_conversacion', { data: [conversacion([{ role: 'user', content: 'Listo' }])], error: null });
    const r = await getConversacionesActivas();
    expect(JSON.stringify(r)).not.toContain(TELEFONO);
    expect(r[0].seudonimo).toBe(seudonimoOperador(TELEFONO));
    expect((r[0] as unknown as Record<string, unknown>).telefono).toBeUndefined();
  });

  it('los turnos salen redactados', async () => {
    respuestas.set('wa_conversacion', {
      data: [conversacion([
        { role: 'user', content: 'soy Juan, mi cel es 9993700779 y mi RFC PEGJ850315AB1' },
        { role: 'assistant', content: 'Listo, cuadré tu viaje' },
      ])],
      error: null,
    });
    const r = await getConversacionesActivas();
    const texto = r[0].turns.map((t) => t.content).join(' ');
    expect(texto).not.toContain('9993700779');
    expect(texto).not.toContain('PEGJ850315AB1');
    expect(texto).toContain('cuadré tu viaje');
  });

  it('el conteo de mensajes —que es la estadística de uso legítima— se conserva', async () => {
    respuestas.set('wa_conversacion', {
      data: [conversacion([
        { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' },
      ])],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r[0].turns).toHaveLength(3);
    expect(r[0].tenantNombre).toBe('Transportes Innovativos');
  });

  it('un fallo de Supabase sigue lanzando', async () => {
    respuestas.set('wa_conversacion', { data: null, error: { message: 'fetch failed' } });
    await expect(getConversacionesActivas()).rejects.toThrow('fetch failed');
  });
});

describe('ninguna pantalla de /admin puede volver a pintar el teléfono', () => {
  it('el campo `telefono` no aparece en src/app/admin', async () => {
    const { execSync } = await import('node:child_process');
    const salida = execSync(
      `command grep -rn "\\.telefono" src/app/admin --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((l) => !l.includes('.test.'));
    expect(salida, `estas pantallas siguen leyendo el teléfono del operador:\n${salida.join('\n')}`).toEqual([]);
  });
});
