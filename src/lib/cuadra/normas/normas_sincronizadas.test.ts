import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { NORMAS, IDS_NORMA, esVinculante, type Jerarquia } from './indice';

// ═══════════════════════════════════════════════════════════════════════════
// EL ÍNDICE Y LAS FICHAS NO PUEDEN SEPARARSE.
//
// La fuente de verdad son los YAML de `normas/`: traen el texto vigente
// transcrito y la trazabilidad de verificación. El índice de TS es una copia
// compacta para runtime, y una copia sin verificación es exactamente el patrón
// que ya falló dos veces en este repo con las etiquetas de concepto.
//
// Si alguien añade una ficha, cambia un `estado_verificacion` tras verificarla,
// o corrige una jerarquía, esto falla hasta que el índice lo refleje.
// ═══════════════════════════════════════════════════════════════════════════
const DIR = new URL('../../../../normas/', import.meta.url);

function campo(txt: string, n: string): string | undefined {
  const m = new RegExp(`^${n}:\\s*(.+)$`, 'm').exec(txt);
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, '');
  return v && v !== 'null' ? v : undefined;
}

const archivos = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));
const fichas = archivos.map((f) => {
  const txt = readFileSync(new URL(f, DIR), 'utf8');
  return { archivo: f, txt, id: campo(txt, 'id'), estado: campo(txt, 'estado_verificacion'), jerarquia: campo(txt, 'jerarquia') };
});

describe('índice de normas vs fichas', () => {
  it('hay al menos una ficha por cada entrada del índice', () => {
    const idsFicha = new Set(fichas.map((f) => f.id));
    for (const id of IDS_NORMA) {
      expect(idsFicha.has(id), `el índice tiene "${id}" y no hay ficha con ese id`).toBe(true);
    }
  });

  it('no hay fichas fuera del índice', () => {
    // Una ficha que el código no puede citar es trabajo que no llega a nadie.
    for (const f of fichas) {
      expect(IDS_NORMA, `la ficha ${f.archivo} (id "${f.id}") no está en el índice`).toContain(f.id!);
    }
  });

  it('el estado de verificación coincide, ficha por ficha', () => {
    // Es el campo que decide si el producto puede afirmar algo o tiene que
    // condicionarlo. Desincronizarlo significa afirmar sobre algo sin verificar.
    for (const f of fichas) {
      expect(NORMAS[f.id!].estado, `estado distinto en ${f.archivo}`).toBe(f.estado);
    }
  });

  it('la jerarquía coincide: confundirla es "el error más caro del dominio"', () => {
    for (const f of fichas) {
      expect(NORMAS[f.id!].jerarquia, `jerarquía distinta en ${f.archivo}`).toBe(Number(f.jerarquia));
    }
  });

  it('toda norma tiene al menos una forma de citarse', () => {
    // Sin `citas`, la guardia no puede reconocerla en un texto ni sustituirla.
    for (const id of IDS_NORMA) {
      expect(NORMAS[id].citas.length, `"${id}" no tiene citas_en_codigo`).toBeGreaterThan(0);
    }
  });

  it('las CITAS coinciden con las de la ficha, no solo su cantidad', () => {
    // Este test solo comprobaba que el arreglo no estuviera vacío, y por eso
    // `rlisr-57` pudo estar con `citas_en_codigo: []` en la ficha mientras el
    // índice decía ["RLISR 57"] sin que nada fallara. Las citas SON el patrón
    // con el que la guardia reconoce una norma en un mensaje: si se separan, la
    // guardia le quita al agente una cita legítima o le deja pasar una que no.
    for (const f of fichas) {
      const enFicha = campo(f.txt, 'citas_en_codigo') ?? '[]';
      let lista: string[] = [];
      try { lista = JSON.parse(enFicha.replace(/'/g, '"')); } catch { /* mal formada → [] */ }
      expect(NORMAS[f.id!].citas, `citas distintas en ${f.archivo}`).toEqual(lista);
    }
  });

  it('la ruta de la ficha existe de verdad', () => {
    for (const id of IDS_NORMA) {
      expect(archivos, `${NORMAS[id].ficha} no existe`).toContain(NORMAS[id].ficha.replace('normas/', ''));
    }
  });

  it('la FECHA DE EXIGIBILIDAD del índice es la de la ficha, no la del código', () => {
    // Es el campo que enciende o apaga un veredicto DURO. `config.ts` traía
    // `vigenteDesde: '2026-04-24'` fundado en una cita sin ficha (RMF 2.7.1.8) y
    // el motor tiraba con ella una deducción entera más su IVA acreditable. La
    // única fuente admisible de esa fecha es `fecha_vigencia_desde` de la ficha:
    // si nadie la confirmó, es `null` y el motor no puede afirmar vigencia.
    for (const f of fichas) {
      const enFicha = campo(f.txt, 'fecha_vigencia_desde') ?? null;
      const enIndice = NORMAS[f.id!].exigibleDesde ?? null;
      expect(enIndice, `fecha_vigencia_desde distinta en ${f.archivo}`).toBe(enFicha);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (fiscal) — `usado_en_codigo` es el campo con el que se
// calcula el RADIO DE IMPACTO cuando una norma cambia (`normas/README.md`,
// "Cómo se usa": «apunta a los archivos y líneas que dependen de la ficha. Si
// cambias la norma, ese es tu impacto»). Si miente, una reforma se evalúa
// contra el archivo equivocado — o contra ninguno.
//
// `lfpdppp-2-XII-XX.yaml` decía `usado_en_codigo: []` mientras
// `FISCAL_LEGAL.md §2.3` —el documento con el que el equipo le habla a los
// clientes— construye la sección entera sobre ella y la nombra por archivo:
// «Fuente de verdad de este párrafo: `normas/lfpdppp-2-XII-XX.yaml`». Es la
// ficha que CORRIGE el análisis anterior (la figura de "remisión" no existe en
// la ley vigente): si vuelve a moverse y nadie sabe que ese párrafo cuelga de
// ella, el documento comercial queda citando derecho derogado otra vez.
// ═══════════════════════════════════════════════════════════════════════════
describe('usado_en_codigo dice la verdad sobre quién depende de la ficha', () => {
  const DOC = readFileSync(new URL('../../../../FISCAL_LEGAL.md', import.meta.url), 'utf8');

  /** Los renglones de la lista `usado_en_codigo`, sea en bloque o en línea. */
  function usadoEnCodigo(txt: string): string[] {
    const enLinea = /^usado_en_codigo:\s*(\[.*\])\s*$/m.exec(txt);
    if (enLinea) { try { return JSON.parse(enLinea[1].replace(/'/g, '"')); } catch { return []; } }
    // En bloque: todo lo indentado (renglones de lista, sus continuaciones y
    // los comentarios) hasta la siguiente llave de primer nivel.
    const bloque = /^usado_en_codigo:\s*$\n((?:(?:\s+.*)?\n)*)/m.exec(txt);
    if (!bloque) return [];
    return bloque[1].split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
      .split(/^\s*-\s*/m)
      .map((l) => l.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  it('toda ficha que FISCAL_LEGAL.md nombra por archivo lo declara, con su sección', () => {
    const citadas = fichas.filter((f) => DOC.includes(`normas/${f.archivo}`));
    // Si nadie nombra fichas en el documento, esta prueba no prueba nada.
    expect(citadas.length, 'FISCAL_LEGAL.md dejó de nombrar fichas por archivo').toBeGreaterThan(0);
    for (const f of citadas) {
      const usos = usadoEnCodigo(f.txt).join(' | ');
      expect(usos, `${f.archivo} sostiene un párrafo de FISCAL_LEGAL.md y no lo declara en usado_en_codigo`)
        .toMatch(/FISCAL_LEGAL\.md §\d/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (fiscal, reincidente) — dos fichas que respaldan cifras
// impresas decían `verificado_fuente_primaria` y en su propia
// `nota_verificacion` admitían haber leído REPRODUCCIONES.
//
// `normas/README.md`, tabla "Estados de verificación", literal:
//
//   | `verificado_fuente_primaria` | Se leyó el texto en el DOF, el SAT o
//   | diputados.gob.mx | **Sí** |
//   | `evidencia_corroborante` | Varias fuentes secundarias coinciden, sin leer
//   | el original | Sí, condicionado |
//
// `lisr-28-V.yaml` —la ficha del $750/día, el número más impreso del producto—
// decía «Texto idéntico en cuatro reproducciones independientes (apta.com.mx,
// leyesmx, mley.mx, tax.com.mx)», y `lif-2026-20-A.yaml` —la de los litros de
// diésel y el 50% de peaje— «Texto obtenido de dos reproducciones del
// articulado (leyes-mx.com y mley.mx)». Las dos con `fuente_tipo:
// diputados_oficial`. Las genuinamente primarias se distinguen solas:
// `cff-30` y `cff-89-90` dicen «Transcrito del PDF oficial de la Cámara de
// Diputados» y `rfa-2026-2.9` «Leído en el DOF (SIDOF)».
//
// Un contador que abra `normas/` en la sala y lea dos renglones seguidos de
// `lisr-28-V.yaml` concluye que el sello de verificación es decorativo.
// ═══════════════════════════════════════════════════════════════════════════
describe('el sello de verificación dice lo que la ficha de verdad hizo', () => {
  /** Lo que delata una fuente SECUNDARIA en la propia nota de la ficha. */
  const MARCAS_SECUNDARIAS = [/reproducci[oó]n/i, /reproducciones/i, /leyes-?mx/i, /mley\.mx/i, /apta\.com\.mx/i, /tax\.com\.mx/i, /justia/i];
  /** Y lo que declara haber leído el ORIGINAL. Con esto, corroborar con copias
   *  es una virtud (`rfa-2026-2.9`: «Leído en el DOF (SIDOF) y corroborado en
   *  tres reproducciones independientes»); sin esto, las copias son todo lo que
   *  hubo. */
  const MARCAS_PRIMARIAS = [/le[ií]do en el DOF/i, /SIDOF/i, /PDF oficial/i, /diputados\.gob\.mx/i, /C[aá]mara de Diputados/i, /descargado de/i, /contra el texto vigente/i, /minisitio/i];

  /**
   * El PRIMER párrafo de `nota_verificacion` (más `verificado_por`): es donde la
   * ficha declara QUÉ SE HIZO. Lo que viene después son matices, correcciones y
   * el `PARA CERRAR` —que nombra la fuente primaria justamente porque todavía no
   * se leyó—, y contarlo como evidencia de lectura dejaría pasar la ficha que
   * este bloque existe para atrapar.
   */
  function nota(txt: string): string {
    const bloque = /^nota_verificacion:\s*>\n([\s\S]*?)(?=\n[a-z_]+:)/m.exec(txt)?.[1] ?? '';
    return bloque.split(/\n\s*\n/)[0] + ' ' + (campo(txt, 'verificado_por') ?? '');
  }

  /** Solo leyó copias: ninguna declaración de haber abierto el original. */
  function soloReproducciones(txt: string): boolean {
    const n = nota(txt);
    return MARCAS_SECUNDARIAS.some((m) => m.test(n)) && !MARCAS_PRIMARIAS.some((m) => m.test(n));
  }

  it('ninguna ficha `verificado_fuente_primaria` funda su verificación SOLO en reproducciones', () => {
    for (const f of fichas.filter((x) => x.estado === 'verificado_fuente_primaria')) {
      expect(soloReproducciones(f.txt), `${f.archivo} dice \`verificado_fuente_primaria\` y su nota solo admite reproducciones — el estado honesto es \`evidencia_corroborante\``)
        .toBe(false);
    }
  });

  it('y la que solo leyó reproducciones tampoco declara `fuente_tipo` oficial', () => {
    // El `fuente_tipo` es la otra mitad del mismo sello: `diputados_oficial`
    // sobre una ficha que leyó apta.com.mx afirma la procedencia dos veces.
    // (Las fichas cuyo `PARA CERRAR` es ir al DOF —los dos criterios del Anexo
    // 3— no entran aquí: su nota no dice haber leído una reproducción, dice que
    // el texto todavía no se transcribió, y eso ya lo declara su estado.)
    for (const f of fichas.filter((x) => soloReproducciones(x.txt))) {
      const tipo = campo(f.txt, 'fuente_tipo');
      if (!tipo) continue;
      expect(tipo, `${f.archivo} solo leyó reproducciones y declara \`fuente_tipo: ${tipo}\``)
        .not.toMatch(/oficial/);
    }
  });
});

describe('esVinculante', () => {
  it('ley, reglamento, regla general y anexo obligan', () => {
    for (const j of [1, 2, 3, 4] as Jerarquia[]) expect(esVinculante(j)).toBe(true);
  });

  it('un criterio NO vinculativo y la política de un tercero NO obligan', () => {
    // Presentar el plazo de facturación de una gasolinera como obligación fiscal
    // es el error de nivel 6 que el README señala explícitamente.
    for (const j of [5, 6] as Jerarquia[]) expect(esVinculante(j)).toBe(false);
  });
});
