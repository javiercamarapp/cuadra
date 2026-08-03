import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO REINCIDENTE de las rondas 8, 9 y 10 (seguridad) —
// `gasto_no_tras_liquidar()` sin `search_path` fijo.
//
// La 0035 fijó las diez funciones que el linter de Supabase reportó, y es
// ANTERIOR a la 0036, así que no pudo alcanzar a la función que la 0036 creó.
// La 0037 y la 0042 volvieron a tocar los triggers que la usan —la 0042 se
// escribió justamente para cerrar el ALTO de la ronda 9— y las dos tuvieron la
// línea a la vista y no la pusieron. Tres rondas.
//
// Lo que permitía: bajo un `search_path` con otro esquema delante de `public`,
// el `select exists (... from liquidacion ...)` de esa función lee una tabla
// SOMBRA vacía, devuelve `false`, y el gasto que llega DESPUÉS de emitida la
// liquidación entra sin el `CU001` — el PDF archivado y el WhatsApp del
// operador vuelven a decir cifras contrarias del mismo viaje.
//
// ─────────────────────────────────────────────────────────────────────────
// LO QUE ESTA PRUEBA **NO** HACE, Y HAY QUE DECIRLO:
//
// No corre una sola línea de SQL. Aquí no hay base, así que lee las migraciones
// y comprueba una propiedad ESTRUCTURAL: que toda función de `public` que el
// repo define quede con `search_path` fijo, sea en su propio `create or
// replace` o en un `alter function ... set search_path` posterior. Eso atrapa
// exactamente la regresión que se repitió tres veces —definir o redefinir una
// función y olvidar la línea— y NO demuestra que la base tenga `proconfig`
// puesto: una migración se puede escribir y no aplicar. Quien lo demuestra es
// el bloque 30 de `supabase/verificaciones.sql`, que mira `pg_proc.proconfig`.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = join(process.cwd(), 'supabase', 'migrations');
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

interface Def { nombre: string; archivo: string; fijaSearchPath: boolean }

/**
 * Cada `create or replace function <nombre>(...)` de las migraciones, en orden,
 * con si su cabecera —lo que hay entre la firma y el `as $$` del cuerpo—
 * declara `set search_path`.
 */
function definiciones(): Def[] {
  const out: Def[] = [];
  for (const archivo of ARCHIVOS) {
    const sql = readFileSync(join(DIR, archivo), 'utf8');
    const re = /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      // La cabecera termina en el `as $$` que abre el cuerpo. Buscar
      // `search_path` en todo el archivo daría verdes falsos: basta un
      // comentario o una función vecina que sí lo tenga.
      const desde = m.index;
      const finCuerpo = sql.indexOf('$$', desde);
      const cabecera = sql.slice(desde, finCuerpo === -1 ? sql.length : finCuerpo);
      out.push({
        nombre: m[1],
        archivo,
        fijaSearchPath: /set\s+search_path\s*=/i.test(cabecera),
      });
    }
  }
  return out;
}

/** Funciones a las que una migración posterior les puso `alter function ... set search_path`. */
function fijadasPorAlter(): Map<string, string> {
  const out = new Map<string, string>();
  for (const archivo of ARCHIVOS) {
    const sql = readFileSync(join(DIR, archivo), 'utf8');
    const re = /alter\s+function\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*set\s+search_path\s*=/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) out.set(m[1], archivo);
  }
  return out;
}

describe('ninguna función de `public` se queda con el search_path suelto', () => {
  it('hay funciones que leer (si no, todo lo de abajo pasaría por vacío)', () => {
    expect(definiciones().length).toBeGreaterThan(8);
  });

  it('la ÚLTIMA definición de cada función lleva `search_path` fijo, o se lo puso un `alter` posterior', () => {
    const alter = fijadasPorAlter();
    // Solo la última definición de cada nombre: `create or replace` reemplaza,
    // así que lo que gobierna la base es la que se aplicó al final.
    const ultima = new Map<string, Def>();
    for (const d of definiciones()) ultima.set(d.nombre, d);

    const sueltas = [...ultima.values()]
      .filter((d) => !d.fijaSearchPath)
      .filter((d) => {
        const donde = alter.get(d.nombre);
        // El `alter` solo vale si es POSTERIOR a la última definición: un
        // `create or replace` que llega después borra el `proconfig`.
        return !donde || donde < d.archivo;
      })
      .map((d) => `${d.nombre} (${d.archivo})`);

    expect(
      sueltas,
      'estas funciones corren con el search_path de quien llame: un esquema sombra delante de `public` las hace leer otra tabla. ' +
      'Pon `set search_path = public, pg_catalog` en su cabecera, como la 0035 y la 0049.',
    ).toEqual([]);
  });

  it('y la reincidente en concreto: la barrera de «nada entra tras liquidar»', () => {
    const m0049 = readFileSync(join(DIR, '0049_gasto_no_tras_liquidar_search_path.sql'), 'utf8');
    expect(m0049).toMatch(/set\s+search_path\s*=\s*public/i);
    // El cuerpo, además, califica el esquema: es cinturón sobre el tirante, y
    // es lo que sigue protegiendo si alguien un día quita el `set`.
    expect(m0049).toContain('from public.liquidacion');
    expect(m0049).toContain('from public.viaje');
    // Y NO recrea los triggers: `create or replace` no los invalida, y
    // recrearlos aquí sería la forma de perder el `when` con `fecha` que la
    // 0042 le costó una ronda entera al repo.
    expect(m0049, 'esta migración no debe tocar los triggers').not.toMatch(/create\s+trigger/i);
  });
});
