import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO de la auditoría 10 (seguridad) — la RLS del chofer cubría 3 de 7.
//
// `0001_init.sql:109` crea la policy `tenant_data` sobre SIETE tablas, `for
// all` (lectura Y escritura) para cualquier `app_user` del tenant, sin mirar
// el rol. La 0045 excluyó a `operador` en tres —viaje, gasto, liquidacion— y
// dejó las otras cuatro con este razonamiento escrito: «el chofer no tiene
// vista de esas».
//
// «No tiene vista» defiende la UI, no la base. Con su sesión web, contra el
// endpoint REST, el chofer conservaba UPDATE sobre `politica_gasto` (subirse
// su propio tope de gasto — el motor lee esa tabla para decidir qué sale sobre
// política) y SELECT sobre `wa_conversacion` (las conversaciones de todos sus
// compañeros).
//
// ─────────────────────────────────────────────────────────────────────────
// LO QUE ESTA PRUEBA **NO** HACE, Y HAY QUE DECIRLO:
//
// No ejerce una sola policy. Aquí no hay base de datos, así que lee el SQL y
// comprueba una propiedad estructural: que ninguna de las siete tablas se
// quede sin su exclusión. Eso atrapa la regresión que importa —agregar una
// tabla a `tenant_data` y olvidar excluir al chofer— y NO demuestra que la
// policy funcione. Lo que lo demuestra es el bloque 27 de
// `supabase/verificaciones.sql`, que hay que correr contra la base después de
// aplicar la 0046.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = join(process.cwd(), 'supabase', 'migrations');
const SQL = readdirSync(DIR).sort().map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');

/** Las 7 tablas sobre las que `0001_init.sql` crea `tenant_data`. */
const TABLAS = ['terminal', 'operador', 'politica_gasto', 'viaje', 'gasto', 'liquidacion', 'wa_conversacion'];

/** Cada `foreach t in array array[...]` que reescribe `tenant_data` excluyendo al operador. */
function tablasExcluidas(): Set<string> {
  const fuera = new Set<string>();
  for (const bloque of SQL.split('do $$')) {
    if (!bloque.includes('not is_operador()')) continue;
    const lista = bloque.match(/array\[([^\]]+)\]/)?.[1] ?? '';
    for (const t of lista.split(',')) {
      const nombre = t.trim().replace(/^'|'$/g, '');
      if (nombre) fuera.add(nombre);
    }
  }
  return fuera;
}

describe('la RLS del chofer cubre las SIETE tablas de tenant_data', () => {
  it('la lista de tablas de este arnés sigue siendo la de 0001_init.sql', () => {
    // Si alguien agrega una octava tabla a `tenant_data`, esto falla y obliga a
    // decidir explícitamente si el chofer entra o no. Sin esta prueba, la tabla
    // nueva nacería abierta para él y nadie se enteraría.
    const init = readFileSync(join(DIR, '0001_init.sql'), 'utf8');
    const lista = init.match(/array\[([^\]]+)\]\s*\n\s*loop\s*\n\s*execute format\('alter table %I enable row level security'\)?/)
      ?? init.match(/foreach t in array array\[([^\]]+)\]/);
    const declaradas = (lista?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(new Set(declaradas)).toEqual(new Set(TABLAS));
  });

  it('ninguna de las siete le deja `tenant_data` abierto al rol operador', () => {
    const fuera = tablasExcluidas();
    const abiertas = TABLAS.filter((t) => !fuera.has(t));
    expect(abiertas, `estas tablas siguen dándole lectura y escritura al chofer: ${abiertas.join(', ')}`).toEqual([]);
  });

  it('las cuatro que faltaban las cierra la 0046', () => {
    const m0046 = readFileSync(join(DIR, '0046_rls_operador_resto.sql'), 'utf8');
    for (const t of ['terminal', 'operador', 'politica_gasto', 'wa_conversacion']) {
      expect(m0046).toContain(`'${t}'`);
    }
    expect(m0046).toContain('not is_operador()');
  });

  it('y NO le devuelve al chofer un `for all` sobre lo que la 0045 le quitó', () => {
    // La 0045 le dio SELECT scoped sobre viaje/gasto/liquidacion. Si una
    // migración posterior recreara `tenant_data` sin la exclusión, la prueba de
    // arriba lo atrapa; ésta fija además que no aparezca una policy nueva que
    // le regrese escritura por otra puerta.
    const m0046 = readFileSync(join(DIR, '0046_rls_operador_resto.sql'), 'utf8');
    expect(m0046).not.toMatch(/create policy \w+ on public\.(viaje|gasto|liquidacion) for all/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (seguridad) — «Contador — solo lectura y exportar»
// era cierto solo en la etiqueta del <select>.
//
// Misma advertencia que arriba: esto NO ejerce una policy. Comprueba que la
// exclusión esté escrita para las siete tablas y que el contador tenga su
// policy de solo SELECT. Quien lo demuestra es el bloque 29 de
// `supabase/verificaciones.sql`, contra la base.
// ═══════════════════════════════════════════════════════════════════════════
describe('el contador lee y no escribe', () => {
  const m0048 = readFileSync(join(DIR, '0048_rls_contador_solo_lectura.sql'), 'utf8');

  it('ninguna de las siete le deja `tenant_data` abierto al contador', () => {
    const bloques = SQL.split('do $$').filter((b) => b.includes('not is_contador()'));
    const cubiertas = new Set<string>();
    for (const b of bloques) {
      const lista = b.match(/array\[([^\]]+)\]/)?.[1] ?? '';
      for (const t of lista.split(',')) {
        const n = t.trim().replace(/^'|'$/g, '');
        if (n) cubiertas.add(n);
      }
    }
    const abiertas = TABLAS.filter((t) => !cubiertas.has(t));
    expect(abiertas, `estas tablas le siguen dando escritura al contador: ${abiertas.join(', ')}`).toEqual([]);
  });

  it('y sí le deja LEER: sin esto el arreglo lo dejaría sin panel', () => {
    expect(m0048).toContain('contador_lee');
    expect(m0048).toMatch(/create policy contador_lee on %I for select/);
    expect(m0048, 'nunca `for all`').not.toMatch(/create policy contador_lee on %I for all/);
  });

  it('la exclusión del chofer sobrevive a esta migración — no se deshace la 0045/0046', () => {
    expect(m0048).toContain('not is_operador()');
  });
});
