import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaDeRuta, puedeVerArea } from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-26 · ALTO — rutas clasificadas como "operación" que pintan
// pesos de la flota.
//
// `AREA_POR_RUTA` es una tabla de texto: nada la ata a lo que la pantalla
// RENDERIZA de verdad. Y la contradicción estaba escrita en el repo:
// `despacho/page.tsx:36-39` declara del jefe de tráfico «NO hay una sola cifra
// de dinero en esta pantalla, y no es un descuido», mientras el link de al
// lado en su propio sidebar —Viajes— listaba el anticipo de cada viaje y lo
// sumaba en un KPI ("Anticipo en viajes abiertos"). Igual Analítica ("Gasto
// por concepto · Todo el histórico de la flota") y Documentos (monto por
// comprobante).
//
// Esta prueba ata la tabla al render: si una `page.tsx` formatea pesos, su
// ruta NO puede estar en el área que ve el encargado, salvo que la propia
// página parta la pantalla por rol (que es lo que hace `/dashboard` con
// `puedeVerArea(rol,'dinero')` → `inicio-operacion.tsx`).
//
// Se ancla con una lista EXPLÍCITA y corta, no con un patrón: una pantalla
// nueva que pinte dinero sin decidir por rol falla aquí, que es el punto.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src', 'app', 'dashboard');

/** `mxn(...)` y `formato="mxn"` son las DOS formas de pintar pesos en el panel
 *  (lib/formato.ts es el único sitio donde vive el formato — CLAUDE.md). */
const PINTA_DINERO = /formato="mxn"|\bmxn\(/;

/** La página decide por rol antes de pintar: parte la pantalla en vez de
 *  esconder el link. Es el patrón de `/dashboard` + `inicio-operacion.tsx`. */
const PARTE_POR_ROL = /puedeVerArea\(\s*rol\s*,\s*'dinero'\s*\)/;

/**
 * Rutas de 'operacion' que HOY siguen pintando pesos sin partir por rol.
 *
 * No es una lista de perdón: es un trinquete. Cada entrada nombra por qué
 * sigue abierta y qué haría falta para cerrarla. Si la lista crece, esta
 * prueba lo dice; si algo se cierra, se borra de aquí.
 */
const RESIDUALES_CONOCIDOS = new Set([
  // El roster de choferes con "Anticipo entregado" y "Comprobado contra ese
  // anticipo" por operador. Reclasificarla a 'dinero' le quita al jefe de
  // tráfico la lista de su propia gente —que sí es su trabajo—, así que la
  // salida buena es partir la pantalla como hace `/dashboard`. Eso se decide
  // en la página, no en esta tabla.
  '/dashboard/operadores',
]);

function paginas(): Array<{ ruta: string; fuente: string; archivo: string }> {
  const out: Array<{ ruta: string; fuente: string; archivo: string }> = [];
  const raiz = join(RAIZ, 'page.tsx');
  out.push({ ruta: '/dashboard', fuente: readFileSync(raiz, 'utf8'), archivo: 'dashboard/page.tsx' });
  for (const d of readdirSync(RAIZ, { withFileTypes: true })) {
    // Las rutas dinámicas (`[id]`) no tienen entrada en la tabla: su gate es
    // el de la liquidación, no el de la sección.
    if (!d.isDirectory() || d.name.startsWith('[')) continue;
    let fuente: string;
    try {
      fuente = readFileSync(join(RAIZ, d.name, 'page.tsx'), 'utf8');
    } catch {
      continue; // subcarpeta sin página propia
    }
    out.push({ ruta: `/dashboard/${d.name}`, fuente, archivo: `dashboard/${d.name}/page.tsx` });
  }
  return out;
}

describe('G-26 · el área de una ruta tiene que ser verdad contra lo que la pantalla pinta', () => {
  it('ninguna pantalla de "operación" le enseña pesos al jefe de tráfico', () => {
    const fugas = paginas()
      .filter(({ fuente }) => PINTA_DINERO.test(fuente) && !PARTE_POR_ROL.test(fuente))
      .filter(({ ruta }) => areaDeRuta(ruta) === 'operacion')
      .filter(({ ruta }) => !RESIDUALES_CONOCIDOS.has(ruta))
      .map(({ archivo, ruta }) => `${ruta} (${archivo})`);

    expect(fugas, 'pantallas de área "operacion" que formatean pesos').toEqual([]);
  });

  it('y por tanto el ENCARGADO no puede ver esas rutas', () => {
    for (const ruta of ['/dashboard/viajes', '/dashboard/analitica', '/dashboard/documentos']) {
      const area = areaDeRuta(ruta);
      expect(area, `${ruta} sin clasificar`).toBeDefined();
      expect(puedeVerArea('encargado', area!), `el encargado entra a ${ruta}`).toBe(false);
    }
  });

  it('el trinquete no crece: solo /dashboard/operadores sigue abierta', () => {
    // Si esta lista cambia, es una decisión, no un descuido.
    expect([...RESIDUALES_CONOCIDOS]).toEqual(['/dashboard/operadores']);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────
  // Sin estos, "mandar todo a 'dinero'" pasaría las de arriba y dejaría al
  // jefe de tráfico sin panel.

  it('CONTROL · el ENCARGADO conserva despacho, POD, incidencias y unidades', () => {
    for (const ruta of ['/dashboard', '/dashboard/despacho', '/dashboard/pod',
      '/dashboard/incidencias', '/dashboard/unidades']) {
      expect(puedeVerArea('encargado', areaDeRuta(ruta)!), `el encargado perdió ${ruta}`).toBe(true);
    }
  });

  it('CONTROL · el CONTADOR sí ve las tres reclasificadas — vive del papel y del dinero', () => {
    for (const ruta of ['/dashboard/viajes', '/dashboard/analitica', '/dashboard/documentos']) {
      expect(puedeVerArea('contador', areaDeRuta(ruta)!), `el contador perdió ${ruta}`).toBe(true);
    }
  });
});
