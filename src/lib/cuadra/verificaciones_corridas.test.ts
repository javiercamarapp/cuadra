import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · ALTO (pruebas) — `supabase/verificaciones.sql` bloque 26 nunca
// se ha corrido, y es la única garantía de que el chofer no ve el dinero de la
// flota. `migraciones_verificadas.test.ts` pasa con el bloque VACÍO.
//
// ── POR QUÉ ESTA PRUEBA Y NO UN PASO DE CI ────────────────────────────────
//
// Lo ideal sería correr el SQL. No se puede, y no por comodidad:
//
//  · Los bloques no corren contra un Postgres pelón. Hablan `authenticated`,
//    `anon` y `service_role`, `auth.uid()`, `request.jwt.claims` y el esquema
//    `storage` — piezas que pone Supabase, no `create database`. La 0001
//    revienta en la primera policy contra un `postgres:16` de servicio.
//  · Levantar el stack de Supabase en CI exige credenciales, y la cabecera de
//    `ci.yml` declara como propiedad del diseño que «CI no necesita secretos, y
//    por eso puede correr en cada push sin costo». Cambiar eso es una decisión
//    de infraestructura, no un arnés de pruebas, y no se puede verificar desde
//    aquí (no hay base en este entorno).
//  · Un script de `package.json` que solo imprima «pega esto en el editor SQL»
//    no verifica nada: sería la misma invocación a mano con otro nombre.
//
// Lo que SÍ se puede medir sin base, y es lo que fallaba: que cada bloque
// tenga cuerpo, y que ninguno entre al archivo sin dejar dicho si su garantía
// se comprobó de verdad alguna vez. La guardia anterior leía SOLO las líneas de
// título (`/^-- ── \d+\./`) y comprobaba que el número de migración apareciera
// en alguna: mide que alguien ESCRIBIÓ UN TÍTULO. Borrar el cuerpo entero del
// bloque 26 dejando el título la dejaba en verde (control C3 del reporte).
//
// El registro vive AQUÍ y no en el .sql a propósito: es el mismo idioma de
// `EXENTAS` en `migraciones_verificadas.test.ts` —una decisión explícita por
// artefacto, que falla cuando aparece uno nuevo sin decisión— y no obliga a
// tocar el .sql, que es de otro rubro.
// ═══════════════════════════════════════════════════════════════════════════

const SQL = readFileSync('supabase/verificaciones.sql', 'utf8');

/** `-- ── 26. El chofer solo ve sus propios viajes (mig. 0045) ─────` */
const TITULO = /^-- ── (\d+)\.(.*)$/;

interface Bloque { n: number; titulo: string; cuerpo: string[] }

function bloques(): Bloque[] {
  const out: Bloque[] = [];
  for (const linea of SQL.split('\n')) {
    const m = TITULO.exec(linea);
    if (m) { out.push({ n: Number(m[1]), titulo: m[2], cuerpo: [] }); continue; }
    if (out.length) out[out.length - 1].cuerpo.push(linea);
  }
  return out;
}

/** SQL de verdad: ni comentario, ni línea en blanco. */
const esSql = (l: string) => l.trim().length > 0 && !l.trimStart().startsWith('--');

// ═══════════════════════════════════════════════════════════════════════════
// EL REGISTRO. Un renglón por bloque, con lo que el ARCHIVO declara sobre su
// última corrida — ni más ni menos.
//
//   `SALIDA:`      el .sql lleva copiada la salida real de una corrida.
//   `SIN SALIDA:`  el bloque está escrito y NADIE ha dejado constancia de
//                  haberlo corrido. Lo que sigue es la garantía que queda sin
//                  comprobar, para que la cuenta se pueda leer.
//   `RETIRADO:`    el bloque ya no comprueba nada (su migración se revirtió).
//
// Un bloque nuevo sin renglón aquí pone esta prueba en ROJO. Eso es todo lo
// que este archivo promete: que nadie agregue una verificación al inventario
// sin decir si se corrió.
// ═══════════════════════════════════════════════════════════════════════════
const CORRIDAS: Record<number, string> = {
  1: 'SIN SALIDA: la cabecera dice «los cuatro primeros pasaron el 28-jul» sin copiar valores. Mutex del viaje (0005).',
  2: 'SIN SALIDA: idem 28-jul, sin valores. Doble cierre (0013 + liquidacion_viaje_uidx).',
  3: 'SIN SALIDA: idem 28-jul, sin valores. Claim del acercamiento (0017).',
  4: 'SIN SALIDA: idem 28-jul, sin valores. Un CFDI, un gasto (0019).',
  5: 'SIN SALIDA: una sola firma de `guardar_liquidacion_tx` (0022). La cabecera declara la migración aplicada, no el bloque corrido.',
  6: 'SIN SALIDA: un teléfono, un operador (0024) — la unicidad de la que depende identificar a quién manda una foto.',
  7: 'SIN SALIDA: `tenant.config` no puede apagar un tope de dinero (0026).',
  8: 'SALIDA (31-jul-2026, cabecera): repetido-entre-viajes-rebotado=t · sin-hash-que-entraron=2 · el msg NOMBRA `uq_gasto_img_hash`.',
  9: 'SIN SALIDA: aislamiento entre flotas en la clave, no en la app (0028). El bloque 18 sí corrió y mira lo mismo desde el catálogo.',
  10: 'SIN SALIDA: un operador, un viaje abierto (0029).',
  11: 'SIN SALIDA: dominios — lo que el motor no sabe manejar ya no entra (0025).',
  12: 'SIN SALIDA: inventario previo a aplicar la 0027. Su lectura del 31-jul sí quedó escrita en la cabecera (un grupo, 2 gastos, $398.00).',
  13: 'SALIDA (31-jul-2026, cabecera): ve-el-que-falta=t · calla-el-que-existe=t · vacio-no-es-null=t.',
  14: 'SALIDA (31-jul-2026, cabecera): nunca-negativo=0 · viaje-inexistente=0 · huerfano-cuenta=1 · sondeo-lo-olvida=0 · sella-al-incrementar=t · reciente-sobrevive=1.',
  15: 'SIN SALIDA: un mensaje de Meta se procesa una vez (0002). La idempotencia del webhook, sin constancia contra la base.',
  16: 'SALIDA (31-jul-2026, cabecera): rls-en-wa_mensaje=t · anon-intake=f · anon-lock=f · anon-unlock=f · service-role-intake=t.',
  17: 'SALIDA (31-jul-2026, cabecera): gana-1a=t · 2do-camino-rebota=f · reenvio-por-version=t · CONSTANCIA-INTACTA=t · version-intacta=v1 · reserva-suelta=t · solto=t · solto-2a-vez=f · reserva-expira=t.',
  18: 'SALIDA (31-jul-2026, cabecera): tablas-sin-rls=— · politicas-que-dicen-true=— · rpc-abiertas-a-anon=—. Barrido de producción.',
  19: 'SALIDA (31-jul-2026, en el bloque): t / f / CU001 / t.',
  20: 'SIN SALIDA: un UPDATE tampoco reescribe el dinero tras liquidar (0037). Es la mitad de escritura del 19, que sí corrió.',
  21: 'RETIRADO: comprobaba `foto_pendiente` (0038), revertida por la 0041. No queda nada que verificar.',
  22: 'SALIDA (1-ago-2026, en el bloque): 1 / f / 0 / t / 0.',
  23: 'SALIDA (1-ago-2026, en el bloque): anon=0 filas · service_role=1 fila.',
  24: 'SIN SALIDA: un UPDATE de solo `fecha` tampoco se reescribe tras liquidar (0042).',
  25: 'SIN SALIDA: la sonda de triggers dice la verdad (0043) — el arranque presume de un chequeo que nadie comprobó contra la base.',
  26: 'SIN SALIDA: EL CHOFER SOLO VE SUS PROPIOS VIAJES (0045). `/mis-viajes` no lleva un solo `.eq()` de cortesía —su comentario dice que «el aislamiento lo hace RLS de verdad»—, así que toda la separación entre un chofer y el dinero de la flota entera descansa en este bloque, escrito el 2-ago y nunca ejecutado.',
  27: 'SIN SALIDA: el chofer no toca las otras cuatro tablas (0046).',
  28: 'SIN SALIDA: las policies del chofer filtran por tenant (0047).',
  29: 'SIN SALIDA: el contador lee y no escribe (0048) — el rol se OFRECE en la consola como «solo lectura».',
  30: 'SIN SALIDA: ninguna función de `public` con `search_path` mutable (0049).',
  31: 'SIN SALIDA: la cuenta del chofer no puede apuntar a otra flota (0050).',
  32: 'SIN SALIDA: la identidad del chofer se nota entera o no se nota (0051).',
  33: 'SIN SALIDA: la sonda de triggers mira el CUERPO, no el nombre (0052).',
  34: 'SIN SALIDA: `app_user` no sobrevive a su usuario de Auth (0053).',
};

/** Cuántas garantías están escritas y sin comprobar HOY. Trinquete: puede
 *  bajar (corriendo el bloque y copiando su salida), no subir sin que alguien
 *  lo decida a mano. */
const SIN_CORRER_HOY = 24;

describe('el inventario de verificaciones dice cuáles se han corrido', () => {
  const B = bloques();

  it('hay bloques que leer', () => {
    // Sin esto, todo lo de abajo pasaría por vacío si el regex del título
    // dejara de casar — que es exactamente el modo de fallo de la guardia
    // anterior, pero al revés.
    expect(B.length).toBeGreaterThan(30);
    expect(B.map((b) => b.n)).toContain(26);
  });

  it('ningún bloque entra sin decir si se corrió', () => {
    const huerfanos = B.filter((b) => !CORRIDAS[b.n]).map((b) => `${b.n}.${b.titulo}`);
    expect(
      huerfanos,
      `estos bloques de supabase/verificaciones.sql no tienen renglón en CORRIDAS:\n  ${huerfanos.join('\n  ')}\n\n` +
      'Escribe uno. `SALIDA: <fecha> <valores>` si lo corriste (y copia la salida en el .sql), ' +
      '`SIN SALIDA: <qué garantía queda sin comprobar>` si no. Lo que no vale es agregar una ' +
      'verificación al inventario y dejar que parezca comprobada por estar escrita.',
    ).toEqual([]);
  });

  it('y ningún renglón sobra', () => {
    const existentes = new Set(B.map((b) => b.n));
    const fantasmas = Object.keys(CORRIDAS).map(Number).filter((n) => !existentes.has(n));
    expect(fantasmas, `CORRIDAS nombra bloques que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('un renglón sin contenido no es un registro', () => {
    const vacios = Object.entries(CORRIDAS)
      .filter(([, v]) => !/^(SALIDA|SIN SALIDA|RETIRADO)\b[^:]*:/.test(v) || v.length < 40);
    expect(vacios.map(([n]) => n), 'estos renglones no dicen ni el estado ni qué está en juego').toEqual([]);
  });

  // ── LA MUTACIÓN QUE LA GUARDIA ANTERIOR NO MATABA ────────────────────────
  it('un bloque con título y sin cuerpo NO cuenta como verificación', () => {
    // Control C3 del reporte: se borró el cuerpo entero del bloque 26 dejando
    // su línea de título, y `migraciones_verificadas.test.ts` siguió con sus 4
    // pruebas en verde — porque solo lee títulos.
    const huecos = B
      .filter((b) => !/\(retirado\)/i.test(b.titulo))
      .filter((b) => b.cuerpo.filter(esSql).length < 3)
      .map((b) => `${b.n}.${b.titulo}`);
    expect(
      huecos,
      `estos bloques son un título sin SQL debajo:\n  ${huecos.join('\n  ')}\n\n` +
      'Un bloque vacío se lee, desde fuera, exactamente igual que uno que comprueba algo.',
    ).toEqual([]);
  });

  it('el bloque 26 —el único que separa al chofer del dinero de la flota— sigue entero', () => {
    // Se nombra aparte porque su ausencia no rompe ninguna pantalla: RLS
    // simplemente deja pasar, y nadie se entera hasta que un chofer abre
    // /mis-viajes y ve las 20 liquidaciones de sus compañeros.
    const b26 = B.find((b) => b.n === 26)!;
    const sql = b26.cuerpo.filter(esSql).join('\n');
    expect(sql).toContain('set local role authenticated');
    expect(sql, 'sin impersonar al chofer, el bloque cuenta filas leídas como service_role y siempre dirá que todo bien').toContain('request.jwt.claims');
    expect(sql).toMatch(/raise exception/);
  });

  // ── TRINQUETE ────────────────────────────────────────────────────────────
  it('las garantías escritas y sin comprobar no crecen solas', () => {
    const sinCorrer = Object.entries(CORRIDAS).filter(([, v]) => v.startsWith('SIN SALIDA:'));
    expect(
      sinCorrer.length,
      `${sinCorrer.length} bloques escritos y sin una sola corrida registrada:\n  ` +
      sinCorrer.map(([n]) => n).join(', ') + '\n\n' +
      'Si este número SUBIÓ, alguien agregó una garantía que nadie ha comprobado nunca: ' +
      'córrela contra el proyecto y copia su salida en el .sql, o baja este trinquete a mano ' +
      'sabiendo lo que estás aceptando. Si BAJÓ, actualiza SIN_CORRER_HOY.',
    ).toBeLessThanOrEqual(SIN_CORRER_HOY);
  });
});
