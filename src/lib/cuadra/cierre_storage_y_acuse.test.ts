import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PASOS_CIERRE } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIERRE NO PUEDE TENER UN `fetch` SIN TECHO, NI UN ENVÍO SIN ACUSE, NI UNA
// TABLA DE PRESUPUESTO QUE APUNTE A OTRO LADO — auditoría 11, CRÍTICO (G-22).
//
// (a) `supabaseAdmin()` construye el cliente sin `fetch` propio, así que toda
//     llamada sin `acotada` hereda el default de undici: 300 000 ms. Las DOS
//     subidas de PDF de `guardar_liquidacion` estaban así, dentro del tramo que
//     `presupuesto.ts` cree acotado a 40 000. Con Storage degradado la tool
//     habría terminado a los 643 500 ms; Vercel corta a los 120 000 —ANTES de
//     `saveLiquidacion`— y Meta no reintenta. Ni liquidación, ni PDF, ni log.
//
// (b) `sendDocument` devolvía `void`. Un 400 de Meta se registraba y se
//     retornaba igual que el camino feliz: el operador quedaba dado por
//     servido, no salía «…pero no pude generarte el PDF», y se cobraba el costo
//     de WhatsApp de un documento que nunca salió.
//
// (c) Los trece `donde` de `PASOS_CIERRE` apuntaban a `processor.ts:591, 595,
//     658, 715, 734, 755, 757, 774, 814` y ninguna contenía el paso que decía
//     contener. Una tabla de presupuesto que apunta a otro lado no se audita.
// ═══════════════════════════════════════════════════════════════════════════

const leer = (p: string) => readFileSync(p, 'utf8');

describe('(a) ninguna llamada a Storage del camino del cierre sale sin techo', () => {
  // Mismo estilo que `formato.test.ts`: una prueba de contrato sobre el fuente,
  // porque lo que hay que impedir es que la PRÓXIMA llamada nazca sin `acotada`
  // — no que ésta en concreto lo tenga hoy.
  const ARCHIVOS = [
    'src/lib/cuadra/tools.ts',
    'src/lib/cuadra/processor.ts',
    'src/lib/cuadra/repo.ts',
    'src/lib/cuadra/intake/almacen.ts',
  ];

  it('todo `supabaseAdmin().storage…` va envuelto en `acotada`', () => {
    const sinTecho: string[] = [];
    for (const archivo of ARCHIVOS) {
      const fuente = leer(archivo);
      const lineas = fuente.split('\n');
      lineas.forEach((linea, i) => {
        if (linea.trimStart().startsWith('//') || linea.trimStart().startsWith('*')) return;
        const pos = linea.indexOf('supabaseAdmin().storage');
        if (pos < 0) return;
        // `acotada(` tiene que abrirse ANTES en la misma sentencia. Se mira la
        // línea y la anterior: es como se escriben las dos formas del repo.
        const contexto = `${lineas[i - 1] ?? ''}\n${linea}`;
        if (!contexto.includes('acotada(')) sinTecho.push(`${archivo}:${i + 1}`);
      });
    }
    expect(sinTecho, `Storage sin \`acotada\` (300 s de undici dentro de un turno de 120 s): ${sinTecho.join(', ')}`)
      .toEqual([]);
  });

  it('control: `acotada` es lo que traduce el tope a un error manejable', () => {
    // Si esto deja de ser cierto, la prueba de arriba deja de significar algo.
    expect(leer('src/lib/cuadra/presupuesto.ts')).toMatch(/export async function acotada/);
  });
});

describe('(b) el envío del PDF devuelve acuse, y el cierre lo mira', () => {
  it('`sendDocument` ya no devuelve `void`', () => {
    const cliente = leer('src/lib/meta/client.ts');
    expect(cliente).toMatch(/export async function sendDocument\([^)]*\):\s*Promise<string \| null>/s);
    expect(cliente, 'un envío sin acuse no se distingue de uno entregado')
      .not.toMatch(/export async function sendDocument\([^)]*\):\s*Promise<void>/s);
  });

  it('y `processor.ts` trata «Meta no acusó» como PDF no entregado', () => {
    const p = leer('src/lib/cuadra/processor.ts');
    // El `await sendDocument(...)` del cierre guarda su resultado y lo comprueba
    // dentro del `try` cuyo `catch` escribe `pdf.no_entregado` y avisa al
    // operador. Sin esta comprobación, ese catch no se dispara nunca.
    const iSend = p.indexOf('const wamidPdf');
    const tramo = p.slice(iSend, p.indexOf("logger.error('pdf.no_entregado'", iSend));
    expect(tramo, 'el resultado de sendDocument se tiraba').toMatch(/if \(!wamidPdf\)/);
    expect(p).toMatch(/pdf\.no_entregado/);
    expect(p, 'y el operador se entera de que falta el papel')
      .toMatch(/no pude generarte el PDF/);
  });

  it('el costo de WhatsApp del PDF se registra DESPUÉS del acuse, no antes', () => {
    const p = leer('src/lib/cuadra/processor.ts');
    const iSend = p.indexOf('const wamidPdf');
    const iGuardia = p.indexOf('if (!wamidPdf)');
    const iCosto = p.indexOf('registrarCostoWhatsApp', iSend);
    expect(iGuardia).toBeGreaterThan(iSend);
    expect(iCosto, 'no se cobra el envío de un documento que no salió').toBeGreaterThan(iGuardia);
  });
});

describe('(c) cada `donde` de PASOS_CIERRE apunta a donde dice', () => {
  const lineas = leer('src/lib/cuadra/processor.ts').split('\n');

  it('los trece pasos siguen ahí', () => {
    expect(PASOS_CIERRE).toHaveLength(13);
  });

  for (const p of PASOS_CIERRE) {
    it(`«${p.paso}» → ${p.donde} contiene \`${p.simbolo}\``, () => {
      const [archivo, num] = p.donde.split(':');
      expect(archivo, 'la tabla solo describe processor.ts').toBe('processor.ts');
      const n = Number(num);
      expect(Number.isInteger(n) && n > 0).toBe(true);
      const linea = lineas[n - 1] ?? '';
      // Si esto falla al mover código: se corrige el NÚMERO, no la prueba. El
      // `donde` es lo único que permite auditar la tabla contra el archivo.
      expect(linea, `${p.donde} dice: «${linea.trim()}»`).toContain(p.simbolo);
    });
  }
});
