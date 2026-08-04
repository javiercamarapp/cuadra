import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// UN HUECO ANUNCIADO TIENE QUE SER UN HUECO.
//
// Los recuadros de "esto todavía no existe" son el activo de credibilidad del
// panel: «prefiero enseñarte un hueco honesto que cifras de ejemplo». Un hueco
// que ya dejó de serlo convierte esa declaración en una más que hay que
// verificar — y el comprador que le crea descarta funciones que sí tiene.
//
// La 0047 creó `unidad`, `mantenimiento`, `incidencia` y `pod`. Desde ese día,
// cualquier pantalla que siga diciendo que esas tablas no existen miente, y
// miente con sus propias pantallas vivas dos renglones más arriba en el menú.
//
// La prueba ata la frase a la tabla: solo falla si la tabla EXISTE de verdad
// en `supabase/migrations/`. El día que alguien revierta la 0047, la frase
// vuelve a ser cierta y esto deja de exigir nada.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ_APP = join(process.cwd(), 'src/app');
const RAIZ_MIG = join(process.cwd(), 'supabase/migrations');

/** Las tablas que las migraciones crean de verdad. */
function tablasCreadas(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(RAIZ_MIG)) {
    if (!f.endsWith('.sql')) continue;
    const sql = readFileSync(join(RAIZ_MIG, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

/**
 * Frases de "esto no existe" observadas en el panel, cada una atada a la
 * tabla que la desmiente. Se listan literales a propósito: un detector
 * genérico de negaciones daría falsos positivos sobre huecos que SÍ son
 * ciertos ("no existe tabla de clientes", que hoy es verdad).
 */
const NEGACIONES: Array<{ frase: RegExp; tabla: string }> = [
  { frase: /no hay tabla de veh[íi]culos/i, tabla: 'unidad' },
  { frase: /no guarda unidad/i, tabla: 'unidad' },
  { frase: /no tiene `?unidad_id`?/i, tabla: 'unidad' },
  { frase: /no hay (un )?campo de POD/i, tabla: 'pod' },
  { frase: /no hay tabla de POD/i, tabla: 'pod' },
  { frase: /no hay tabla de incidencias/i, tabla: 'incidencia' },
  { frase: /incidencias.{0,60}no tienen d[óo]nde vivir/is, tabla: 'incidencia' },
  { frase: /ni reloj de SLA/i, tabla: 'incidencia' },
  { frase: /no hay tabla de mantenimiento/i, tabla: 'mantenimiento' },
];

function tsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsx(p));
    else if (e.endsWith('.tsx') && !e.includes('.test.')) out.push(p);
  }
  return out;
}

describe('ninguna pantalla declara inexistente una tabla que sí existe', () => {
  const TABLAS = tablasCreadas();

  it('las cuatro tablas de la 0047 se leen de las migraciones', () => {
    for (const t of ['unidad', 'mantenimiento', 'incidencia', 'pod']) {
      expect(TABLAS.has(t), `${t} debería estar creada por alguna migración`).toBe(true);
    }
  });

  it('ninguna página del panel contradice al esquema', () => {
    const fallos: string[] = [];
    for (const ruta of tsx(RAIZ_APP)) {
      const src = readFileSync(ruta, 'utf8');
      for (const { frase, tabla } of NEGACIONES) {
        if (!TABLAS.has(tabla)) continue;   // la frase todavía es cierta
        const m = src.match(frase);
        if (m) fallos.push(`${ruta.slice(process.cwd().length + 1)}: «${m[0]}» — la tabla \`${tabla}\` sí existe`);
      }
    }
    expect(fallos).toEqual([]);
  });
});
