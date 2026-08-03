import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO de la auditoría 10 (modelo de datos) — la 0045 no era idempotente ni
// dejaba escrita su reversión, a diferencia de su vecina inmediata.
//
// Sus tres `create policy` iban sin `drop policy if exists` delante, mientras
// la MISMA migración sí lo usaba para `tenant_data` en su `do $$`. Re-aplicarla
// sobre una base donde ya corrió —un `db push` repetido, un `db reset`
// parcial— fallaba con `42710 policy "operador_ve_su_viaje" for table "viaje"
// already exists` DESPUÉS de que el `do $$` ya había reescrito las tres
// policies `tenant_data`: media migración aplicada y un error que no dice cuál
// mitad. Y revertirla exigía reconstruir a mano el `tenant_data` de la 0001,
// que no estaba escrito en ningún sitio — quien lo haga bajo presión puede
// dejar un `tenant_data` sin la exclusión del chofer, o un chofer sin acceso a
// nada.
//
// ─────────────────────────────────────────────────────────────────────────
// EL ALCANCE, Y POR QUÉ NO ES TODO EL DIRECTORIO:
//
// La regla se aplica desde la 0044 —la serie de roles e identidad, que es la
// que esta auditoría tocó y la que se va a re-aplicar sobre un proyecto nuevo
// el 5-ago—. Las tres migraciones viejas que crean policies quedan EXENTAS con
// razón, y la razón no es «son viejas»: ponerles `drop policy if exists`
// volvería una re-aplicación parcial ACTIVAMENTE destructiva. Hoy, si alguien
// vuelve a correr la 0001 sola, falla con 42710 y no toca nada; con el `drop`,
// borraría el `tenant_data` endurecido por la 0045/0046/0048 y lo reemplazaría
// por la versión abierta de la 0001, devolviéndole escritura al chofer y al
// contador hasta que esas tres volvieran a correr. Fallar ruidoso es, ahí, la
// opción segura.
//
// Y esto NO ejecuta SQL: comprueba el texto. Que Postgres acepte la segunda
// pasada solo lo demuestra un `db push` repetido contra la base.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = join(process.cwd(), 'supabase', 'migrations');
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** Migraciones que crean policies y NO se retrofitan, con la razón de cada una. */
const EXENTAS: Record<string, string> = {
  '0001': 'esquema base. Con `drop policy if exists`, re-aplicarla sola borraría el `tenant_data` endurecido por la 0045/0046/0048 y pondría la versión abierta: el chofer y el contador recuperarían escritura. El 42710 de hoy es la opción segura.',
  '0003': 'crea `tenant_data` sobre `llm_costo`. Mismo motivo que la 0001: su policy es la versión abierta, y hacerla re-aplicable en silencio es peor que el 42710.',
  '0009': 'crea `tenant_data` sobre `cfdi_xml`. Mismo motivo que la 0001 y la 0003.',
};

/**
 * El SQL sin sus comentarios de línea.
 *
 * Las cabeceras de este repo CITAN el SQL que están corrigiendo —la 0047
 * reproduce el `create policy` de la 0045 para explicar qué le faltaba—, así
 * que leer el archivo entero da falsos positivos sobre código que no se
 * ejecuta.
 */
function sinComentarios(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

/** Cada `create policy <nombre>` de un archivo, con si tiene un `drop policy if exists` que lo cubra. */
function policiesSinDrop(sqlCrudo: string): string[] {
  const sql = sinComentarios(sqlCrudo);
  const sueltas: string[] = [];
  const re = /create\s+policy\s+(\w+|%I)\s+on\s+([\w.%]+)/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const [, nombre] = m;
    // El `drop` que lo cubre tiene que estar ANTES en el archivo y nombrar la
    // misma policy. Buscarlo en todo el archivo daría verdes falsos cuando una
    // migración dropea una policy y crea OTRA.
    const antes = sql.slice(0, m.index);
    const dropRe = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${nombre === '%I' ? '\\w+' : nombre}\\b`, 'i');
    if (!dropRe.test(antes)) sueltas.push(nombre);
  }
  return sueltas;
}

describe('una migración de policies se puede volver a aplicar', () => {
  it('hay migraciones que leer y la lista de exentas nombra archivos que existen', () => {
    expect(ARCHIVOS.length).toBeGreaterThan(40);
    const numeros = new Set(ARCHIVOS.map((f) => f.slice(0, 4)));
    for (const n of Object.keys(EXENTAS)) expect(numeros.has(n), `EXENTAS nombra la ${n}, que ya no existe`).toBe(true);
  });

  it('desde la 0044, ningún `create policy` va sin su `drop policy if exists`', () => {
    const rotas: string[] = [];
    for (const f of ARCHIVOS) {
      const num = f.slice(0, 4);
      if (num < '0044' || EXENTAS[num]) continue;
      const sueltas = policiesSinDrop(readFileSync(join(DIR, f), 'utf8'));
      if (sueltas.length) rotas.push(`${f}: ${sueltas.join(', ')}`);
    }
    expect(
      rotas,
      'estas policies revientan con 42710 en la segunda pasada, DESPUÉS de que el resto de la migración ya escribió:\n  ' +
      rotas.join('\n  '),
    ).toEqual([]);
  });

  it('y las tres exentas lo están con una razón, no por olvido', () => {
    const vacias = Object.entries(EXENTAS).filter(([, r]) => r.trim().length < 40);
    expect(vacias.map(([n]) => n), 'estas exenciones no explican por qué').toEqual([]);
  });

  it('la 0045 deja escrita su reversión, que es la mitad que nadie puede improvisar', () => {
    // Revertirla exige reconstruir el `tenant_data` de la 0001 en tres tablas.
    // Si eso no está escrito, se improvisa en la madrugada del 6-ago.
    const m0045 = readFileSync(join(DIR, '0045_rls_operador.sql'), 'utf8');
    expect(m0045).toMatch(/REVERSI[ÓO]N/i);
    expect(m0045).toContain('drop policy if exists operador_ve_su_viaje');
    // Y la trampa de esa reversión, dicha: devuelve el `tenant_data` de la
    // 0001, que no lleva la exclusión del contador que puso la 0048.
    expect(m0045).toContain('0048');
  });
});
