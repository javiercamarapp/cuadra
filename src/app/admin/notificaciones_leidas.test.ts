import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Alerta } from './calcular-alertas';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTADO DE «LEÍDO» DE LAS NOTIFICACIONES. AUDITORÍA 11 · G-35.
//
// `notificaciones-leidas.ts` tenía 19.14% de líneas ejecutadas y seis
// funciones sin correr una sola vez. Es el módulo con MÁS trampas por línea
// de toda la consola, y las tres están escritas en sus propios comentarios
// sin nada que las sostenga:
//
//   1. `useSyncExternalStore` exige que `getSnapshot` devuelva LA MISMA
//      REFERENCIA si nada cambió. Si `leerLeidas()` devolviera un `Set`
//      nuevo en cada llamada, React concluye que la tienda cambió en cada
//      render y entra en BUCLE INFINITO — la campana congela /admin entera.
//      Eso lo sostiene un caché de una línea que nadie estaba probando.
//   2. `localStorage` LANZA en Safari privado y con cookies de terceros
//      bloqueadas. Un `throw` ahí sube por el render y tumba el layout.
//   3. Un JSON corrupto en la clave (una versión vieja del formato, una
//      pestaña a medio escribir) tiene que leerse como "nada leído", no
//      reventar.
//
// Y la decisión de producto que hay debajo: la clave de una alerta se deriva
// de `tipo::texto`, así que si la CONDICIÓN cambia (el costo sube otro %),
// el texto cambia y la alerta reaparece como no-leída. Es un hecho distinto,
// no la misma alerta de ayer. Eso también se fija aquí.
// ═══════════════════════════════════════════════════════════════════════════

const CLAVE = 'likida:notificaciones:leidas';

let almacen: Map<string, string>;
let eventos: string[];
let lanzarAlLeer = false;

function montarVentana() {
  almacen = new Map();
  eventos = [];
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => {
        if (lanzarAlLeer) throw new Error('SecurityError: acceso a localStorage denegado');
        return almacen.get(k) ?? null;
      },
      setItem: (k: string, v: string) => { almacen.set(k, v); },
    },
    addEventListener: (t: string) => { eventos.push(`+${t}`); },
    removeEventListener: (t: string) => { eventos.push(`-${t}`); },
    dispatchEvent: (e: Event) => { eventos.push(e.type); return true; },
  });
}

beforeEach(() => { lanzarAlLeer = false; montarVentana(); vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

async function mod() {
  return import('./notificaciones-leidas');
}

const ALERTA: Alerta = { tipo: 'atencion', texto: 'El costo de IA subió 42.5% esta semana vs la anterior.' };

describe('claveAlerta — el texto ES la identidad', () => {
  it('mismo tipo y texto, misma clave', async () => {
    const { claveAlerta } = await mod();
    expect(claveAlerta(ALERTA)).toBe(claveAlerta({ ...ALERTA }));
  });

  it('si la condición cambia, el texto cambia y la alerta es OTRA (reaparece sin leer)', async () => {
    const { claveAlerta } = await mod();
    const otra: Alerta = { tipo: 'atencion', texto: 'El costo de IA subió 61% esta semana vs la anterior.' };
    expect(claveAlerta(otra)).not.toBe(claveAlerta(ALERTA));
  });

  it('el tipo también cuenta', async () => {
    const { claveAlerta } = await mod();
    expect(claveAlerta({ tipo: 'ok', texto: 'x' })).not.toBe(claveAlerta({ tipo: 'atencion', texto: 'x' }));
  });
});

describe('leerLeidas — la referencia estable que evita el bucle de React', () => {
  it('dos lecturas seguidas devuelven EL MISMO objeto', async () => {
    const { leerLeidas } = await mod();
    expect(leerLeidas()).toBe(leerLeidas());
  });

  it('sigue siendo el mismo después de leer un valor guardado', async () => {
    almacen.set(CLAVE, JSON.stringify(['atencion::x']));
    const { leerLeidas } = await mod();
    const a = leerLeidas();
    expect(leerLeidas()).toBe(a);
    expect(a.has('atencion::x')).toBe(true);
  });

  it('cambia de referencia SOLO cuando el contenido de verdad cambió', async () => {
    const { leerLeidas, marcarLeida } = await mod();
    const antes = leerLeidas();
    marcarLeida('atencion::nueva');
    expect(leerLeidas()).not.toBe(antes);
  });

  it('en el servidor (sin `window`) devuelve el conjunto vacío compartido', async () => {
    vi.unstubAllGlobals();
    const { leerLeidas, SIN_LEIDAS } = await mod();
    expect(leerLeidas()).toBe(SIN_LEIDAS);
    expect(SIN_LEIDAS.size).toBe(0);
  });

  it('si localStorage LANZA (Safari privado), no tumba el layout', async () => {
    lanzarAlLeer = true;
    const { leerLeidas, SIN_LEIDAS } = await mod();
    expect(leerLeidas()).toBe(SIN_LEIDAS);
  });

  it('un JSON corrupto se lee como "nada leído", no revienta', async () => {
    almacen.set(CLAVE, '{esto no es json');
    const { leerLeidas } = await mod();
    expect(leerLeidas().size).toBe(0);
  });
});

describe('marcar como leída', () => {
  it('una alerta queda guardada y avisa a la misma pestaña', async () => {
    const { marcarLeida, claveAlerta, leerLeidas } = await mod();
    marcarLeida(claveAlerta(ALERTA));
    expect(leerLeidas().has(claveAlerta(ALERTA))).toBe(true);
    expect(JSON.parse(almacen.get(CLAVE)!)).toContain(claveAlerta(ALERTA));
    // `storage` solo dispara en OTRAS pestañas: la campana y la lista viven
    // en la MISMA, así que sin este evento propio no se sincronizan.
    expect(eventos).toContain('likida:notificaciones:cambio');
  });

  it('marcar todas guarda las N claves de una', async () => {
    const { marcarTodasLeidas, leerLeidas } = await mod();
    marcarTodasLeidas(['a::1', 'b::2', 'c::3']);
    expect(leerLeidas().size).toBe(3);
  });

  it('marcar dos veces no duplica', async () => {
    const { marcarLeida, leerLeidas } = await mod();
    marcarLeida('a::1');
    marcarLeida('a::1');
    expect(leerLeidas().size).toBe(1);
    expect(JSON.parse(almacen.get(CLAVE)!)).toHaveLength(1);
  });
});

describe('suscribirCambiosLeidas — se desuscribe de lo que suscribió', () => {
  it('escucha el evento propio Y el de otras pestañas, y limpia los dos', async () => {
    const { suscribirCambiosLeidas } = await mod();
    const cancelar = suscribirCambiosLeidas(() => {});
    expect(eventos).toContain('+likida:notificaciones:cambio');
    expect(eventos).toContain('+storage');
    cancelar();
    expect(eventos).toContain('-likida:notificaciones:cambio');
    expect(eventos).toContain('-storage');
  });
});
