import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (modelo de datos) — `app_user.operador_id` era la
// ÚNICA FK de identidad del repo sin `tenant_id`.
//
// La 0028 estableció lo contrario para las 22 FK del esquema, con este
// escenario escrito palabra por palabra: «la verificación de la FK no mira
// tenant, y además ignora la RLS». La 0045 escribió
// `references public.operador(id) on delete set null` — simple.
//
// Como ningún camino de la aplicación llenaba esa columna, ligar la cuenta de
// un chofer era forzosamente manual, en la consola de Supabase:
//
//     update app_user set operador_id = '<uuid de un chofer de la flota B>'
//     where email = 'chofer@flota-a.com';   -- la base lo aceptaba
//
// Y salía: ese chofer entra a /mis-viajes, `requireOperador` lo deja pasar
// (solo exige `operadorId` no nulo) y la policy le devuelve los viajes, gastos
// y liquidaciones de la flota B. La 0047 ya cerró la mitad —las policies llevan
// `tenant_id`—; esto cierra la clave, que es la capa que no depende de que la
// aplicación se porte bien.
//
// ─────────────────────────────────────────────────────────────────────────
// LO QUE ESTA PRUEBA **NO** HACE: no ejecuta SQL. No hay base aquí. Comprueba
// propiedades ESTRUCTURALES del texto de las migraciones —que la clave sea
// compuesta, que la simple ya no esté, que el CHECK del tenant nulo exista— y
// NO demuestra que Postgres rechace el UPDATE cruzado. Eso lo demuestra el
// bloque 31 de `supabase/verificaciones.sql`, contra la base.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = join(process.cwd(), 'supabase', 'migrations');
const m0050 = readFileSync(join(DIR, '0050_app_user_operador_tenant.sql'), 'utf8');
const TODAS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

describe('la cuenta web del chofer y su operador son de la misma flota', () => {
  it('la FK es COMPUESTA con `tenant_id`, no solo por `id`', () => {
    expect(m0050).toMatch(/foreign key\s*\(\s*operador_id\s*,\s*tenant_id\s*\)/i);
    expect(m0050).toMatch(/references\s+public\.operador\s*\(\s*id\s*,\s*tenant_id\s*\)/i);
  });

  it('y el destino existe: `operador (id, tenant_id)` es único desde la 0028', () => {
    // Una FK compuesta necesita un índice único sobre EXACTAMENTE esas
    // columnas. Si alguien quitara el de la 0028, esta migración dejaría de
    // poder aplicarse y el fallo aparecería en un `db push`, no aquí.
    const m0028 = readFileSync(join(DIR, '0028_fks_con_tenant.sql'), 'utf8');
    expect(m0028).toContain("'operador'");
    expect(m0028).toMatch(/unique \(id, tenant_id\)/i);
  });

  it('la FK simple de la 0045 se retira: no se dejan dos reglas de borrado contradictorias', () => {
    // La simple era `on delete set null`; la compuesta es `restrict`. Convivir
    // deja el DELETE de un `operador` con dos respuestas posibles según cuál
    // evalúe Postgres primero, que es el peor estado para razonar.
    expect(m0050).toMatch(/drop constraint/i);
    expect(m0050).toContain("array_length(c.conkey, 1) = 1");
    expect(m0050).toMatch(/on delete restrict/i);
    expect(m0050, 'la compuesta NO puede ser `set null`: anularía también el tenant del usuario')
      .not.toMatch(/references\s+public\.operador\s*\(\s*id\s*,\s*tenant_id\s*\)[\s\S]{0,60}set null/i);
  });

  it('cierra el hueco de MATCH SIMPLE: `operador_id` exige `tenant_id`', () => {
    // `app_user.tenant_id` es nullable por diseño (0001:17, nulo = superadmin).
    // Con MATCH SIMPLE —el default— una FK compuesta NO comprueba nada si
    // alguna columna es NULL: sin este CHECK, `tenant_id = null` volvía a
    // saltarse la clave entera.
    expect(m0050).toContain('app_user_operador_exige_tenant');
    expect(m0050).toMatch(/check\s*\(\s*operador_id is null or tenant_id is not null\s*\)/i);
  });

  it('no aplica a ciegas: cuenta las filas cruzadas y aborta con el número', () => {
    // El patrón de la 0028. Un `ADD CONSTRAINT` que falla solo dice «is not
    // present in table»; el número es lo que decide si se limpia a mano o se
    // investiga.
    expect(m0050).toMatch(/raise exception/i);
    expect(m0050).toMatch(/count\(\*\)\s+into\s+n/i);
  });

  it('y ninguna migración posterior le devuelve la FK simple', () => {
    const posteriores = TODAS.filter((f) => f.slice(0, 4) > '0050');
    for (const f of posteriores) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      expect(sql, `${f} vuelve a colgar app_user.operador_id de operador(id) sin tenant`)
        .not.toMatch(/app_user[\s\S]{0,200}foreign key\s*\(\s*operador_id\s*\)\s*references/i);
    }
  });
});
