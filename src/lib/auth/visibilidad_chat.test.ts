import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaDeRuta, puedeVerArea } from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · PASE 2 · A11P2-C2 · CRÍTICO — se cerró la ventana y quedó
// abierta la puerta.
//
// El arreglo `2fb1982` de esta misma rama cerró el rail del Asistente: dejó de
// servirle `kpis.montoComprobado` y `acred.iva` al jefe de tráfico. Pero
// `/dashboard/chat` es LA MISMA CAJA a pantalla completa —`chat/page.tsx:43`
// pide `getKpis` + `getAcreditables` y se los pasa a `<ChatFlota>`—, seguía
// clasificada `'operacion'` y seguía en el sidebar del encargado.
//
// El guardarraíl que existía para esto (`visibilidad_dinero.test.ts`) no lo
// vio, y la razón importa más que el caso: busca `mxn(` DENTRO del `page.tsx`,
// y esta página no formatea nada — reparte los datos y el formateo ocurre en
// `chat.tsx`. Un gate que mira el archivo equivocado no es un gate.
//
// Por eso esta prueba no persigue la ruta: persigue el DATO. Cualquier página
// que pida los agregados de dinero de la flota —los pinte ella o se los pase a
// un hijo— tiene que estar en un área que el encargado no ve.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src', 'app', 'dashboard');

/** Los dos agregados de dinero de la flota. Traerlos ES tener el dinero,
 *  independientemente de quién lo imprima. */
const PIDE_DINERO = /\bgetKpis\s*\(|\bgetAcreditables\s*\(/;

/** La página parte la pantalla por rol antes de repartir (patrón de
 *  `/dashboard` + `inicio-operacion.tsx`). */
const PARTE_POR_ROL = /puedeVerArea\(\s*rol\s*,\s*'dinero'\s*\)/;

function paginas(): Array<{ ruta: string; fuente: string; archivo: string }> {
  const out: Array<{ ruta: string; fuente: string; archivo: string }> = [];
  out.push({
    ruta: '/dashboard',
    fuente: readFileSync(join(RAIZ, 'page.tsx'), 'utf8'),
    archivo: 'dashboard/page.tsx',
  });
  for (const d of readdirSync(RAIZ, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[')) continue;
    let fuente: string;
    try {
      fuente = readFileSync(join(RAIZ, d.name, 'page.tsx'), 'utf8');
    } catch {
      continue;
    }
    out.push({ ruta: `/dashboard/${d.name}`, fuente, archivo: `dashboard/${d.name}/page.tsx` });
  }
  return out;
}

describe('A11P2-C2 · quien pide los agregados de dinero no puede estar en el área del encargado', () => {
  it('ninguna página que llame getKpis/getAcreditables es visible para el ENCARGADO', () => {
    const fugas = paginas()
      .filter(({ fuente }) => PIDE_DINERO.test(fuente) && !PARTE_POR_ROL.test(fuente))
      .filter(({ ruta }) => {
        const area = areaDeRuta(ruta);
        return area !== undefined && puedeVerArea('encargado', area);
      })
      .map(({ archivo, ruta }) => `${ruta} (${archivo})`);

    expect(
      fugas,
      'páginas que traen el comprobado y el IVA acreditable de la flota y ' +
        'aun así viven en un área que el jefe de tráfico ve',
    ).toEqual([]);
  });

  it('/dashboard/chat es del área "dinero" y el ENCARGADO no entra', () => {
    expect(areaDeRuta('/dashboard/chat')).toBe('dinero');
    expect(puedeVerArea('encargado', 'dinero')).toBe(false);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────
  // Sin estos, mandar todo a 'dinero' pasaría lo de arriba y dejaría sin chat
  // a quien sí puede verlo, y sin panel al jefe de tráfico.

  it('CONTROL · el CONTADOR y el DUEÑO sí entran al chat', () => {
    expect(puedeVerArea('contador', areaDeRuta('/dashboard/chat')!)).toBe(true);
    expect(puedeVerArea('flota_admin', areaDeRuta('/dashboard/chat')!)).toBe(true);
  });

  it('CONTROL · el ENCARGADO conserva su trabajo — despacho, POD, incidencias, unidades', () => {
    for (const ruta of ['/dashboard', '/dashboard/despacho', '/dashboard/pod',
      '/dashboard/incidencias', '/dashboard/unidades']) {
      expect(puedeVerArea('encargado', areaDeRuta(ruta)!), `el encargado perdió ${ruta}`).toBe(true);
    }
  });

  it('CONTROL · /dashboard sí pide los agregados y sigue siendo de operación — parte por rol', () => {
    const raiz = readFileSync(join(RAIZ, 'page.tsx'), 'utf8');
    expect(PIDE_DINERO.test(raiz)).toBe(true);
    expect(PARTE_POR_ROL.test(raiz), 'dashboard/page.tsx dejó de partir por rol').toBe(true);
  });
});
