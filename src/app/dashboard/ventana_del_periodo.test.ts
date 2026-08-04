import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-10 (ALTO, frontend) — «"IVA acreditable" son tres números
// en cuatro pantallas, y "del periodo" es "de siempre"».
//
// `getKpis` y `getAcreditables` tenían la ventana OPCIONAL, así que omitirla
// compilaba y devolvía el histórico completo. Ocho llamadores, cinco sin
// ventana. En /dashboard el rail contestaba $4,120.00 "este periodo" mientras
// la tarjeta a su izquierda decía $774.48 — mismo rótulo, misma cita de LIVA,
// dos consultas distintas, en la misma pantalla.
//
// Dos reglas, y las dos se fijan aquí:
//
//  1. NADIE llama sin declarar su ventana. El parámetro es obligatorio
//     (`number | null`, donde `null` es "histórico, a propósito"), así que
//     `tsc` caza al que la omita. Esta prueba cubre el flanco que `tsc` no ve:
//     que la ventana declarada no sea una constante escondida.
//  2. UN RÓTULO TIENE QUE SER VERDAD: una pantalla que consulta el histórico
//     no puede rotular sus cifras "del periodo".
//
// El encabezado de `analytics.ts` documenta este mismísimo bug como cerrado
// desde hace tres rondas. Lo que faltaba era la prueba.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = fileURLToPath(new URL('.', import.meta.url));

/** Las páginas del panel del cliente, más el handler que alimenta al rail. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acc.push(p);
  }
  return acc;
}

const ARCHIVOS = [
  ...fuentes(RAIZ),
  fileURLToPath(new URL('../api/dashboard/asistente/route.ts', import.meta.url)),
];

const LLAMADA = /get(?:Kpis|Acreditables)\(([^)]*)\)/g;

interface Llamada { archivo: string; args: string }

const llamadas: Llamada[] = [];
for (const archivo of ARCHIVOS) {
  const fuente = readFileSync(archivo, 'utf8');
  for (const m of fuente.matchAll(LLAMADA)) {
    llamadas.push({ archivo: archivo.slice(archivo.indexOf('src/')), args: m[1] });
  }
}

describe('toda pantalla declara la ventana de sus cifras', () => {
  it('hay llamadas que revisar (si esto falla, el descubridor se rompió)', () => {
    expect(llamadas.length).toBeGreaterThan(5);
  });

  for (const { archivo, args } of llamadas) {
    it(`${archivo} · get…(${args})`, () => {
      expect(
        args.split(',').length,
        'sin segundo argumento la consulta trae el histórico y el rótulo dice "del periodo"',
      ).toBeGreaterThan(1);
    });
  }
});

// ── El rótulo contra la consulta ───────────────────────────────────────────

const RÓTULO_DE_PERIODO = /del periodo|este periodo|en el periodo/i;

describe('la pantalla que consulta el histórico no rotula "del periodo"', () => {
  for (const archivo of ARCHIVOS) {
    const fuente = readFileSync(archivo, 'utf8');
    // Solo las que consultan el histórico A PROPÓSITO (segundo argumento
    // literal `null`); las que pasan una variable la resuelven del filtro y
    // rotulan con esa misma variable.
    const historico = [...fuente.matchAll(LLAMADA)].some((m) => /,\s*null\s*$/.test(m[1]));
    if (!historico) continue;
    it(archivo.slice(archivo.indexOf('src/')), () => {
      // Se miran las CADENAS de la pantalla, no los comentarios: el bug era un
      // <h2> que decía "Comprobación del periodo" sobre `getKpis(tenantId)`.
      const sinComentarios = fuente
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(sinComentarios, 'consulta de siempre bajo un rótulo de periodo').not.toMatch(RÓTULO_DE_PERIODO);
    });
  }
});
