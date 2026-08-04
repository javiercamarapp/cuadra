import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sufijoTenant } from './sufijo';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-47 (ALTO, arquitectura + frontend) — «"Ver como" vive en
// tres sitios con tres reglas distintas, y ya funciona en 1 de 17 páginas».
//
// `rolEfectivo(sesionReal.rol, sp?.rol)` decide con qué rol corre la página.
// Pero de las 17 que llaman a `resolverTenantEfectivo`, solo `dashboard/page`
// declaraba `rol?: string` en el tipo de sus `searchParams`; las otras 16 lo
// tipaban `{vista?, tenant?}`, así que `sp.rol` era `undefined` y `rolEfectivo`
// devolvía SIEMPRE el rol real. Y `tsc` no ve nada: pasar un objeto sin `rol`
// a un parámetro con `rol?` es legal.
//
// Javier abre `/dashboard?rol=encargado` para enseñar qué ve el jefe de
// tráfico, hace clic en cualquier link, y la página corre con privilegios de
// superadmin mientras el sidebar de esa MISMA pantalla sigue filtrado: media
// pantalla previsualiza y media no. Es la demostración que se hace en la sala.
//
// Dos piezas, una sola regla: el TIPO que las páginas declaran y el SUFIJO que
// arrastran sus links. `sidebar-nav.tsx` ya arrastraba `rol`; `sufijo.ts`, que
// dice en su comentario "misma regla, dos fuentes de entrada", no lo conocía.
// ═══════════════════════════════════════════════════════════════════════════

describe('el sufijo de los links del servidor arrastra el «ver como»', () => {
  it('con `?rol=` puesto, viaja pegado al tenant', () => {
    expect(sufijoTenant({ tenant: 'abc', rol: 'encargado' })).toBe('?tenant=abc&rol=encargado');
  });

  it('viaja también con `?vista=demo`', () => {
    expect(sufijoTenant({ vista: 'demo', rol: 'contador' })).toBe('?vista=demo&rol=contador');
  });

  it('y solo, cuando no hay tenant ni vista', () => {
    expect(sufijoTenant({ rol: 'encargado' })).toBe('?rol=encargado');
  });

  it('sin «ver como» nada cambia — un usuario real nunca trae el parámetro', () => {
    expect(sufijoTenant({ tenant: 'abc' })).toBe('?tenant=abc');
    expect(sufijoTenant({ vista: 'demo' })).toBe('?vista=demo');
    expect(sufijoTenant(undefined)).toBe('');
  });

  it('se escapa, como los otros dos — y vuelve a leerse igual', () => {
    const sufijo = sufijoTenant({ tenant: 'a b&c', rol: 'x&y' });
    const leido = new URLSearchParams(sufijo.slice(1));
    expect(leido.get('tenant')).toBe('a b&c');
    expect(leido.get('rol')).toBe('x&y');
  });
});

// ── El tipo, que es lo que hacía a `?rol=` invisible ───────────────────────

const RAIZ = join(process.cwd(), 'src/app/dashboard');

/** Páginas de dominios de otros agentes de esta ronda: migran con el suyo. */
// LISTA VACÍA: las dos páginas que faltaban ya declaran `SearchParamsPanel`,
// así que «ver como» arrastra `?rol=` en las 17. Se deja el mecanismo, no la
// lista. Auditoría 11, G-47, cierre cruzado.
const PENDIENTES = new Set<string>([]);

function paginas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...paginas(p));
    else if (e === 'page.tsx') out.push(p);
  }
  return out;
}

const conTenantEfectivo = paginas(RAIZ)
  .map((p) => ({ rel: p.slice(RAIZ.length + 1).split('\\').join('/'), src: readFileSync(p, 'utf8') }))
  .filter(({ src }) => src.includes('resolverTenantEfectivo('))
  .filter(({ rel }) => !PENDIENTES.has(rel));

describe('toda página que resuelve tenant declara también el rol previsualizado', () => {
  it('hay páginas que revisar', () => {
    expect(conTenantEfectivo.length).toBeGreaterThan(8);
  });

  for (const { rel, src } of conTenantEfectivo) {
    it(`${rel} tipa \`rol?\` en sus searchParams`, () => {
      // Vale de las dos formas: el tipo compartido (`SearchParamsPanel`, que
      // lo trae), o un tipo en línea que lo declare — algunas páginas tienen
      // parámetros propios (`?ok=`, `?err=`) y no pueden usar el compartido
      // tal cual.
      if (/searchParams: Promise<SearchParamsPanel>/.test(src)) return;
      const tipo = src.match(/searchParams: Promise<\{([^}]*)\}>/);
      expect(tipo, `${rel} no declara searchParams con el patrón conocido`).toBeTruthy();
      expect(
        tipo![1],
        'sin `rol?` en el tipo, `sp.rol` es undefined y "Ver como" no hace nada en esta página',
      ).toMatch(/\brol\?/);
    });
  }
});
