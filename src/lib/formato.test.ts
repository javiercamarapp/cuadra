import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';
import { execSync } from 'node:child_process';
import { mxn, litros, fechaMx, round2, numero, usd } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 7 · MEDIO REINCIDENTE POR TERCERA RONDA — y el número CRECÍA:
//
//     ronda 6 →  3 copias de `mxn()` escritas a mano
//     ronda 7 →  8
//     31-jul  → 11
//
// Siete de ellas eran la misma línea, repetida en cada archivo que imprime
// dinero que el contralor lee: el PDF, el resumen de WhatsApp, el panel, el
// aviso del tope del 15%, los acreditables y el motor.
//
// Que fueran idénticas no era defensa: el hallazgo gemelo de `litros()` YA se
// divergió una vez —el panel decía "1,235 L" donde el PDF decía "1,234.56 L"—.
// Una cifra fiscal que se lee distinta en dos pantallas se lee como dos
// cálculos distintos.
// ═══════════════════════════════════════════════════════════════════════════

describe('el formato del dinero', () => {
  it('es el que espera un contador mexicano', () => {
    expect(mxn(1234.5)).toBe('$1,234.50');
    expect(mxn(0)).toBe('$0.00');
    expect(mxn(839.7)).toBe('$839.70');
  });

  it('un negativo se ve como negativo', () => {
    // El operador que puso de su bolsa lee un número en rojo, no un paréntesis
    // contable que no todo el mundo interpreta igual.
    expect(mxn(-1250)).toContain('-');
    expect(mxn(-1250)).toContain('1,250.00');
  });

  it('redondea a centavos, que es lo que existe en un CFDI', () => {
    expect(mxn(0.005)).toBe('$0.01');
  });

  it('litros: hasta dos decimales, sin rellenar ceros', () => {
    expect(litros(1234.56)).toBe('1,234.56 L');
    expect(litros(200)).toBe('200 L');
    // El motor redondea a dos decimales; esto solo evita que un
    // 1234.5600000001 de coma flotante salga con tres cifras.
    expect(litros(1234.5600000001)).toBe('1,234.56 L');
  });

  it('fecha: el cierre nocturno NO se pasa al día siguiente', () => {
    // 31-jul 19:30 en México (CST, UTC−6) = 01:30 UTC del 1-ago.
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('31');
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('jul');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (pruebas) — `numero()` entró esta ronda sin un solo
// `expect`. La usan cuatro sitios de /admin (`admin/page.tsx:205`,
// `crecimiento/page.tsx:89`, `chat.tsx:26` y `:40`) para pintar conteos de
// tokens y de viajes, y este archivo la tenía rodeada de guardarraíles
// —«nadie reimplementa el formato a mano»— sin nada que dijera qué imprime.
//
// Es la única de las cinco funciones de formato que NO lleva símbolo ni
// unidad, y ése es justamente su contrato: si un día alguien la "arregla"
// devolviendo `String(n)` o reusando `mxn`, la consola pinta «1234567» o
// «$1,234,567.00» donde debe decir tokens.
// ═══════════════════════════════════════════════════════════════════════════
describe('numero — conteos con separador de millares, sin moneda ni unidad', () => {
  it('pone el separador de millares que lee un mexicano', () => {
    expect(numero(1234567)).toBe('1,234,567');
    expect(numero(1000)).toBe('1,000');
  });

  it('por debajo del millar no inventa separador', () => {
    expect(numero(0)).toBe('0');
    expect(numero(999)).toBe('999');
  });

  it('no es dinero ni son litros: sin `$`, sin `MXN`, sin ` L`', () => {
    // Las cuatro llamadas de /admin pintan TOKENS y VIAJES. El símbolo de
    // moneda ahí no es un detalle estético: la pantalla de al lado sí enseña
    // dólares (`usd`), y mezclarlos es leer un conteo como un costo.
    const n = numero(1500);
    expect(n).not.toContain('$');
    expect(n).not.toMatch(/MXN|USD/);
    expect(n).not.toContain('L');
    expect(n).not.toBe(mxn(1500));
    expect(n).not.toBe(usd(1500));
    expect(n).not.toBe(litros(1500));
  });

  it('un negativo se ve como negativo', () => {
    expect(numero(-1500)).toContain('-');
    expect(numero(-1500)).toContain('1,500');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO REINCIDENTE (arquitectura) — `round2()` reimplementado en
// CUATRO archivos de dinero (`engine.ts`, `analytics.ts`, `pagadero.ts`,
// `combustible.ts`), las cuatro copias idénticas y las cuatro con el MISMO
// bug: `Math.round(n * 100) / 100` redondea mal cuando el número no es
// representable exacto en punto flotante. `round2(1.005)` da `1`, no `1.01`
// —1.005 se guarda como 1.00499999999999989…, y `Math.round(100.4999…)` cae
// para abajo—. Ya lo había marcado la ronda 8 como advertencia y nadie lo
// atacó: por la regla del rubro, una advertencia que vuelve a ocurrir es un
// hallazgo, no una advertencia.
// ═══════════════════════════════════════════════════════════════════════════
describe('round2 — redondeo a centavos que no le cree a la coma flotante', () => {
  it('el caso que reprueba Math.round(n*100)/100 a secas', () => {
    expect(round2(1.005)).toBe(1.01);
  });

  it('otros valores de la misma familia (x.xx5) que la coma flotante representa mal', () => {
    expect(round2(35.645)).toBe(35.65);
    expect(round2(0.145)).toBe(0.15);
  });

  it('el caso común (nada especial en punto flotante) sigue redondeando normal', () => {
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(839.7)).toBe(839.7);
  });

  it('negativos', () => {
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('cero y enteros no se mueven', () => {
    expect(round2(0)).toBe(0);
    expect(round2(500)).toBe(500);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 10, ALTO — TERCERA RONDA CON EL MISMO VALOR.
  //
  // La ronda 9 cerró la DUPLICACIÓN (cuatro copias → una, con guardarraíl) y
  // dio por cerrado el NÚMERO, que era el escenario del hallazgo. No lo
  // estaba: `Number.EPSILON` es 2.22e-16 ABSOLUTO y el ULP de un double crece
  // con la magnitud, así que sumarlo es un no-op para todo |n| ≳ 2. Barrido de
  // 3 000 000 de valores en [0, 100000): CERO divergencias entre el `round2`
  // que se escribió y el `Math.round(n*100)/100` que decía sustituir.
  //
  // Los ocho valores que probaba esta suite (1.005, 0.145, -1.005, 35.645,
  // 1234.567, 839.7, 0, 500) distinguían la implementación nueva de la vieja
  // SOLO en los tres menores a $2 — y el importe más chico que este producto
  // maneja de verdad es una caseta de ~$150. La suite pasaba verde sobre un
  // arreglo que no cubría su propio caso motivador.
  //
  // Estos son los casos que ponen la premisa a prueba EN EL RANGO DE DINERO
  // REAL. Si alguien vuelve a "arreglar" el redondeo con un épsilon absoluto,
  // aquí se cae.
  // ═════════════════════════════════════════════════════════════════════════
  it('el caso motivador de la ronda 9, con su valor exacto: el tope del art. 110-I LFT', () => {
    // `pagadero.ts` calcula el 30% del excedente. Con excedente = 1000.55 el
    // producto en doubles es 300.16499999999996, y el tope legal impreso en la
    // nota de descuento de nómina salía UN CENTAVO por debajo.
    expect(round2(1000.55 * 0.30)).toBe(300.17);
  });

  it('arriba de $2, donde el épsilon absoluto no movía nada', () => {
    // Los tres son x.xx5 mal representados y los tres caían para abajo con la
    // implementación anterior: 8.16, 10000.00 y 300.16.
    expect(round2(8.165)).toBe(8.17);
    expect(round2(10000.005)).toBe(10000.01);
    expect(round2(300.165)).toBe(300.17);
  });

  it('no inventa un número ante lo que no es un número', () => {
    // El redondeo pasa por texto decimal; `Infinity`/`NaN` no tienen forma
    // decimal y `Number('Infinitye+2')` es NaN. Se devuelven tal cual.
    expect(round2(Number.NaN)).toBeNaN();
    expect(round2(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(round2(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('NO puede volver a haber una copia de round2', () => {
  // Mismo mecanismo que el guardarraíl de `mxn()` de arriba: se mide el
  // código, no una lista escrita a mano. La ronda 9 encontró las cuatro
  // copias por `command grep`; esto asegura que una quinta no pase inadvertida.
  const archivos = execSync(
    `command grep -rl "function round2\\|const round2\\s*=" src/ --include='*.ts' || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('solo `formato.ts` define round2', () => {
    const fuera = archivos.filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'));
    expect(
      fuera,
      `estos archivos reimplementan round2 en vez de importarlo de formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 10, BAJO — ESTE GUARDARRAÍL CONTABA DECLARACIONES, NO LA
  // EXPRESIÓN.
  //
  // El grep de arriba busca `function round2` / `const round2 =` porque así
  // fue como la ronda 9 encontró las cuatro copias. Pero el defecto no es el
  // nombre: es `Math.round(x * 100) / 100`. Escrita INLINE, sin bautizarla, se
  // le escapaba entera — y quedaban dos sitios de dinero con ella:
  //
  //   repo.ts:834      getAcumuladoCombustible → el acumulado de efectivo del
  //                    ejercicio que dispara la alerta del tope RFA 2026 2.9
  //                    (`periodo/combustible.ts`), uno de los cuatro sitios
  //                    que la ronda 9 nombró.
  //   omitidos.ts:37   el monto del renglón «… y N comprobantes más» que va
  //                    IMPRESO en la liquidación que el contralor archiva.
  //
  // Mientras `round2` fue un no-op (ver el ALTO de esta misma ronda) los tres
  // redondeos daban lo mismo y no había bug visible. Al arreglar `round2` de
  // verdad, estos dos se habrían quedado con el comportamiento viejo y este
  // archivo habría pasado verde: la alerta de efectivo y el renglón impreso
  // divergiendo del resto del producto por un centavo, sin que nada fallara.
  // ═════════════════════════════════════════════════════════════════════════
  it('y nadie la escribe inline: `Math.round(x * 100) / 100` es round2 sin nombre', () => {
    // Se mide sobre el código, no sobre los comentarios: el encabezado de
    // `formato.ts` CITA la expresión para contar la historia del hallazgo, y
    // una prueba que prohíbe explicar el bug que vigila obliga a borrar justo
    // la explicación que hace falta para no repetirlo (mismo criterio que el
    // guardarraíl de `mxn()`).
    const candidatos = execSync(
      `command grep -rlE "Math\\.round\\(.*\\* *100\\) */ *100" src/ --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    const fuera = candidatos
      .filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'))
      .filter((f) => /Math\.round\(.*\* *100\) *\/ *100/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      fuera,
      `estos archivos redondean centavos a mano en vez de llamar a round2 de formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });
});

describe('NO puede volver a haber una copia a mano', () => {
  // LA RED QUE FALTABA, y es la razón por la que el hallazgo sobrevivió tres
  // rondas: cada vez se arreglaban las copias conocidas, nadie impedía la
  // siguiente, y al archivo nuevo le salía la suya. Esto lo mide sobre el
  // código, no sobre una lista escrita a mano que también se desactualiza.
  // SE MIRA EL CÓDIGO, NO LOS COMENTARIOS (`sinComentarios`). La primera versión
  // hacía grep del literal sobre el archivo entero y se rompió con su propio
  // comentario: el encabezado de `dashboard/formato.ts` CITA
  // `toLocaleString('es-MX')` para contar la historia del hallazgo. Una prueba
  // que prohíbe hablar del bug que vigila obliga a borrar justo la explicación
  // que hace falta para no repetirlo.
  const archivos = execSync(
    `grep -rl "toLocaleString('es-MX'" src/ --include='*.ts' --include='*.tsx' || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('solo `formato.ts` formatea cifras mexicanas', () => {
    const fuera = archivos
      .filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'))
      .filter((f) => /toLocaleString\('es-MX'/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      fuera,
      `estos archivos formatean por su cuenta en vez de usar formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });

  it('y `formato.ts` no importa NADA, para que el motor pueda usarlo', () => {
    // `engine.ts` es puro y sin I/O, y `pdf.ts` viaja en el bundle del webhook.
    // Si el formato viviera en `utils.ts` —que importa clsx y tailwind-merge
    // para `cn()`— los dos arrastrarían el sistema de clases de Tailwind. Hoy el
    // tree-shaking lo salva; un archivo sin imports no depende de la suerte.
    const fuente = readFileSync('src/lib/formato.ts', 'utf8');
    expect(fuente).not.toMatch(/^\s*import\s/m);
  });
});
