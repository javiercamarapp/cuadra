import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESTATUS, etiquetaEstatus } from '@/app/dashboard/estatus';

// ═══════════════════════════════════════════════════════════════════════════
// LOS MISMOS CONCEPTOS, ESCRITOS EN TRES SITIOS, YA SE DESINCRONIZARON DOS VECES.
//
// La primera fue `viaticos` partido en tres: el dashboard se quedó corto y un
// concepto salía en blanco en pantalla. Se arregló a mano. La segunda fue
// `otro`, que decía 'Gasto' en el motor y 'Otro' en el PDF y el panel — el
// operador leía una palabra por WhatsApp y el contralor otra en el papel.
//
// Sincronizarlos a mano ya falló dos veces, así que esto no es un test de
// etiquetas: es el mecanismo que evita la tercera. Si alguien añade un concepto
// en un sitio y no en los otros, falla aquí y no en la demo.
//
// No se unificó en una constante compartida porque el dashboard es un server
// component y el PDF corre en otro runtime; el test da la garantía sin forzar
// un import que no siempre es posible.
// ═══════════════════════════════════════════════════════════════════════════

/** Saca los pares `clave: 'Etiqueta'` de un mapa literal del fuente. */
function etiquetas(ruta: string, ancla: string): Record<string, string> {
  const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const i = src.indexOf(ancla);
  expect(i, `no se encontró el ancla "${ancla}" en ${ruta}`).toBeGreaterThanOrEqual(0);
  const bloque = src.slice(i, src.indexOf('}', i));
  const out: Record<string, string> = {};
  for (const m of bloque.matchAll(/(\w+):\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

describe('etiquetas de concepto — las tres fuentes dicen lo mismo', () => {
  // El PDF ya NO tiene mapa propio: importa `etiquetaConcepto` del motor. Una
  // función importada no puede desincronizarse, que es mejor que un test que
  // avisa cuando ya pasó. Queda el del panel, que sigue siendo una copia.
  const motor = etiquetas('./cuadre/engine.ts', 'const m: Record<string, string> = {');
  const panel = etiquetas('../../app/dashboard/[id]/page.tsx', 'const CONCEPTO');

  it('el PDF ya no tiene mapa propio: usa la función del motor', () => {
    // Si alguien vuelve a meter un mapa gemelo en el PDF, este test lo caza.
    const src = readFileSync(new URL('./liquidacion/pdf.ts', import.meta.url), 'utf8');
    expect(src).toContain('etiquetaConcepto');
    expect(src, 'volvió a aparecer un mapa de etiquetas en el PDF').not.toMatch(/const CONCEPTO_LABEL/);
  });

  it('el motor y el panel cubren los mismos conceptos', () => {
    expect(Object.keys(motor).sort()).toEqual(Object.keys(panel).sort());
  });

  it('y les ponen la MISMA etiqueta', () => {
    // Aquí es donde se cazó `otro: 'Gasto'` contra `otro: 'Otro'`.
    for (const k of Object.keys(motor)) {
      expect(panel[k], `"${k}" difiere entre el motor y el panel`).toBe(motor[k]);
    }
  });

  it('cubren todos los conceptos que el tipo permite', () => {
    // Si alguien añade un concepto a types/cuadra.ts y no lo etiqueta, sale en
    // pantalla como la clave cruda o como undefined.
    const tipos = readFileSync(new URL('../../types/cuadra.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type ConceptoGasto');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const conceptos = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(conceptos.length, 'no se pudo leer ConceptoGasto').toBeGreaterThan(3);
    for (const c of conceptos) expect(motor[c], `falta etiqueta para "${c}"`).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL MISMO PATRÓN, EN EL OTRO MAPA DEL PANEL — Y LA TERCERA VEZ QUE PASA.
//
// ESTA SECCIÓN COMPARABA DOS ARCHIVOS POR NOMBRE, Y ESA ERA LA FALLA.
//
// `ESTATUS` vivía copiado en `dashboard/page.tsx` y `dashboard/[id]/page.tsx`;
// el auditor lo marcó como "latente para el próximo estatus nuevo" y esto se
// escribió para cerrarlo. Pero se escribió nombrando los dos archivos, así que
// la página nueva de la ronda 10 —`/mis-viajes`, la ÚNICA pantalla web que
// tiene el chofer— añadió una TERCERA copia idéntica justo fuera de su alcance.
//
// El cambio que lo hacía estallar, con valores: se agrega `'en_revision'` a
// `EstatusLiquidacion`. Este test fallaba y obligaba a actualizar las dos
// páginas del panel — hacía su trabajo. `/mis-viajes` pasaba verde y caía a su
// fallback: el chofer leía la clave cruda `en_revision`, en gris, donde el
// contralor leía «Por revisar».
//
// PREMISA VIEJA (ya no es cierta): «no se unificó en una constante compartida
// porque el dashboard es un server component y el PDF corre en otro runtime».
// Para el mapa de CONCEPTOS eso sigue en pie —el PDF sí corre en otro runtime y
// por eso arriba se comparan fuentes—. Para ESTATUS no aplicaba: sus tres
// consumidores son páginas de Next del mismo runtime, y `/mis-viajes` ya
// importaba `fechaMx` de `../dashboard/formato`. Ahora el mapa vive UNA vez en
// `src/app/dashboard/estatus.ts`, tipado `Record<EstatusLiquidacion, …>` para
// que `tsc` cace el estatus nuevo sin etiqueta.
//
// Y el guardarraíl deja de nombrar archivos: DESCUBRE a cualquiera que declare
// un mapa de estatus propio, que es como llegó a haber tres.
// ═══════════════════════════════════════════════════════════════════════════

/** Todos los `.ts`/`.tsx` de `src/app/`, sin pruebas. */
function paginas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...paginas(p)); continue; }
    if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
    out.push(p);
  }
  return out;
}

describe('etiquetas de estatus — una sola declaración, y nadie puede escribir la cuarta', () => {
  const RAIZ = process.cwd();
  const APP = join(RAIZ, 'src/app');
  const MODULO = join('dashboard', 'estatus.ts');

  it('ninguna página declara su propio mapa de estatus', () => {
    const copias = paginas(APP)
      .filter((f) => !f.endsWith(MODULO))
      .filter((f) => /const\s+ESTATUS\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(
      copias,
      `estas páginas copian el mapa de estatus en vez de importarlo de dashboard/estatus.ts:\n${copias.join('\n')}`,
    ).toEqual([]);
  });

  it('las tres pantallas que lo pintan lo traducen con la MISMA función', () => {
    // Las dos del contralor y la del chofer. Si aparece una cuarta pantalla que
    // pinte estatus sin `etiquetaEstatus`, la lista de abajo se queda corta y
    // hay que venir aquí — que es exactamente el aviso que faltaba.
    for (const p of ['dashboard/page.tsx', 'dashboard/[id]/page.tsx', 'mis-viajes/page.tsx']) {
      const src = readFileSync(join(RAIZ, 'src/app', p), 'utf8');
      expect(src, `${p} no usa etiquetaEstatus`).toContain('etiquetaEstatus');
    }
  });

  it('el mapa cubre todos los estatus que el tipo permite', () => {
    // `tsc` ya lo garantiza por el tipo. Esto lo mide TAMBIÉN en runtime para
    // que aflojarlo a `Record<string, …>` —que es lo que tenían las tres
    // copias— no pase inadvertido.
    const tipos = readFileSync(new URL('../../types/cuadra.ts', import.meta.url), 'utf8');
    const i = tipos.indexOf('export type EstatusLiquidacion');
    const decl = tipos.slice(i, tipos.indexOf(';', i));
    const estatus = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(estatus.length, 'no se pudo leer EstatusLiquidacion').toBeGreaterThan(1);
    expect(Object.keys(ESTATUS).sort()).toEqual([...estatus].sort());
  });

  it('y un estatus que nadie reconoce se lee como viene, no como undefined', () => {
    expect(etiquetaEstatus('estatus_que_no_existe').label).toBe('estatus_que_no_existe');
  });
});
