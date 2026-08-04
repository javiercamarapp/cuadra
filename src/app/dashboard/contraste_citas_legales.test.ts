import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-13 (ALTO, frontend) — «`--faint` mide 2.56:1: las citas
// legales que sostienen cada cifra fiscal son el texto menos legible del
// panel».
//
// `contraste.test.ts` mide los TRES tokens con significado (`--color-ok`,
// `--color-bad`, `--color-warn`) y se llama a sí mismo la lista completa. No
// lo es: `--faint` (#a1a1aa, 2.56:1 sobre blanco) se usa como TINTA en el pie
// de TODOS los `KpiTile` —"LIF 2026, Art. 20-A", "LIVA, Art. 5", y el mensaje
// que declara el supuesto de `MINUTOS_CAPTURA_MANUAL`— y en la nota de la
// cifra grande. Es la defensa del producto contra "¿de dónde salió ese
// número?", pintada por debajo del mínimo de AA para texto grande.
//
// Esta prueba no lleva lista de tokens: DESCUBRE los que aparecen como
// `color:` en las piezas del panel del cliente y los mide todos. Un token
// nuevo mal contrastado falla aquí sin que nadie tenga que acordarse de
// agregarlo.
//
// ALCANCE: las piezas de este dominio (el panel del cliente y el kit que
// monta). El valor de `--faint` en `globals.css` sigue siendo bajo para quien
// lo use en otra parte —`admin/ui/graficas.tsx` lo usa cinco veces— y eso se
// arregla en el dominio de esa hoja.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const CSS = readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8');

function luminancia(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

/** El cuerpo de un bloque de `globals.css`, para no leer el valor del modo
 *  oscuro creyendo que es el que se sirve. */
function bloque(nombre: string): string {
  const i = CSS.indexOf(nombre);
  if (i < 0) return '';
  return CSS.slice(i, CSS.indexOf('}', CSS.indexOf('{', i + nombre.length)) + 1);
}

// Tres sitios declaran tokens: el bloque claro (el que gana cuando hay
// switch), `:root` (los tokens del design system v2) y `@theme` (los de base).
const CLARO = bloque(':root[data-theme="light"]');
const ROOT = bloque(':root {');
const TEMA = bloque('@theme');

/**
 * Valor servido HOY de un token: el del bloque claro si lo declara, si no el
 * del `@theme` (nadie pone `data-theme`), resolviendo la indirección
 * `--muted: var(--color-muted)`.
 */
function valor(nombre: string, vistos = new Set<string>()): string | null {
  if (vistos.has(nombre)) return null;
  vistos.add(nombre);
  for (const cuerpo of [CLARO, ROOT, TEMA]) {
    const directo = cuerpo.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`));
    if (directo) return directo[1].toLowerCase();
    const alias = cuerpo.match(new RegExp(`${nombre}:\\s*var\\((--[a-z0-9-]+)\\)`));
    if (alias) return valor(alias[1], vistos);
  }
  return null;
}

/** Las piezas de este dominio que pintan texto del panel del cliente. */
const ARCHIVOS = [
  join(RAIZ, 'src/app/admin/ui/kit.tsx'),
  ...(function todos(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) todos(p, acc);
      else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) acc.push(p);
    }
    return acc;
  })(join(RAIZ, 'src/app/dashboard')),
];

/** Todo token que aparezca como `color: var(--x)`. No una lista escrita. */
const tokens = new Set<string>();
for (const f of ARCHIVOS) {
  for (const m of readFileSync(f, 'utf8').matchAll(/(?<!background-)(?<!border-)\bcolor:\s*'var\((--[a-z0-9-]+)\)'/g)) {
    tokens.add(m[1]);
  }
}

// Tokens que NO son tinta sobre la superficie del panel: se pintan sobre su
// propio fondo (el pill de acento, el badge de error), y ese par se mide en
// `contraste.test.ts`. Medirlos contra blanco sería medir un par que no existe.
const SOBRE_SU_PROPIO_FONDO = new Set(['--accent-fg', '--marca-fg', '--ok', '--bad', '--warn', '--color-ok', '--color-bad', '--color-warn']);

const SUPERFICIE = '#ffffff';
const AA_TEXTO = 4.5;

describe('todo token usado como tinta en el panel del cliente se puede leer', () => {
  it('se descubrieron tokens (si no, el descubridor se rompió)', () => {
    expect(tokens.size).toBeGreaterThan(2);
  });

  for (const t of [...tokens].sort()) {
    if (SOBRE_SU_PROPIO_FONDO.has(t)) continue;
    it(`${t} pasa AA sobre la tarjeta blanca`, () => {
      const hex = valor(t);
      expect(hex, `no se pudo resolver ${t} en globals.css`).toBeTruthy();
      expect(
        contraste(hex!, SUPERFICIE),
        `${t} = ${hex}: el pie de las tarjetas fiscales cita la ley que sostiene la cifra`,
      ).toBeGreaterThanOrEqual(AA_TEXTO);
    });
  }
});
