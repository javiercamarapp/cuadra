import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agregarPorFase, redondearUsd } from './costos';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO de la auditoría 10 (arquitectura) — DOS AGREGADORES DE `llm_costo` CON
// SEMÁNTICA DISTINTA, Y EL «OFICIAL» SIN UN SOLO CONSUMIDOR.
//
//   costos.ts:305   `getResumenCosto` — agrega por fase con seis decimales y
//                   devuelve una unión de tres estados (`medido` /
//                   `sin_registros` / `no_medido`) cuyo comentario explica que
//                   existe para que NO se pueda pintar un 0 que nadie midió.
//                   `grep -rn "getResumenCosto" src/` fuera de su archivo y sus
//                   pruebas: CERO.
//   negocio.ts:50   reimplementaba la misma agregación sobre la misma tabla,
//                   con `round2` y sin la distinción — y es la que alimenta la
//                   ÚNICA pantalla que hoy enseña costo.
//
// `costos.ts` parecía la capa de costo y no lo era para nadie.
//
// El cambio que lo hacía estallar está escrito en el roadmap del propio archivo
// («para el panel: margen real»): el día que la flota vea su costo habría dos
// funciones sumando `llm_costo` por fase, con distinto redondeo y distinto
// contrato de error; y si cambia la atribución del costo —`liquidacion_id` en
// vez de `viaje_id`, que `vincularCostosALiquidacion` ya escribe— se arreglaría
// en el archivo que se llama `costos.ts` y `/admin` seguiría con su copia.
//
// Ahora las dos pasan por `agregarPorFase`. Esta prueba fija la suma y, sobre
// todo, que nadie vuelva a escribir la suya.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

describe('agregarPorFase — la única suma de `llm_costo` por fase', () => {
  it('suma por fase y cuenta las llamadas', () => {
    const r = agregarPorFase([
      { fase: 'ocr', costo_usd: 0.001 },
      { fase: 'ocr', costo_usd: 0.002 },
      { fase: 'cuadre', costo_usd: 0.11 },
    ]);
    expect(r).toEqual([
      { fase: 'cuadre', n: 1, costoUsd: 0.11 },
      { fase: 'ocr', n: 2, costoUsd: 0.003 },
    ]);
  });

  it('NO redondea dólares a centavos: una llamada de OCR no cuesta $0.00', () => {
    // Es la diferencia concreta entre los dos agregadores. Con `round2` —lo que
    // `/admin` hacía— tres llamadas de OCR de USD 0.0004 sumaban $0.00 en la
    // pantalla desde la que se fija el precio del producto.
    const r = agregarPorFase([
      { fase: 'ocr', costo_usd: 0.0004 },
      { fase: 'ocr', costo_usd: 0.0004 },
      { fase: 'ocr', costo_usd: 0.0004 },
    ]);
    expect(r[0].costoUsd).toBe(0.0012);
    expect(Math.round(r[0].costoUsd * 100) / 100, 'esto es lo que se veía antes').toBe(0);
  });

  it('un costo ilegible no se suma, pero la llamada SÍ se cuenta', () => {
    // `registrarCosto` ya se niega a escribir NaN. Si uno llegó, esconder la
    // llamada además de su costo convierte un dato roto en un dato ausente.
    const r = agregarPorFase([
      { fase: 'chat', costo_usd: 'no-es-un-numero' },
      { fase: 'chat', costo_usd: 0.05 },
    ]);
    expect(r).toEqual([{ fase: 'chat', n: 2, costoUsd: 0.05 }]);
  });

  it('redondearUsd corta en la millonésima, no en el centavo', () => {
    expect(redondearUsd(0.0000004)).toBe(0);
    expect(redondearUsd(0.0000006)).toBe(0.000001);
    expect(redondearUsd(0.1 + 0.2)).toBe(0.3);
  });
});

describe('nadie vuelve a escribir su propia suma de `llm_costo`', () => {
  const negocio = readFileSync(join(RAIZ, 'src/lib/admin/negocio.ts'), 'utf8');
  const costos = readFileSync(join(RAIZ, 'src/lib/cuadra/costos.ts'), 'utf8');

  it('la consola de superadmin agrega con la función de `costos.ts`', () => {
    expect(negocio, '/admin volvió a acumular las fases por su cuenta').toContain('agregarPorFase(');
    expect(negocio, 'volvió el acumulador local de fases').not.toMatch(/porFaseMap/);
  });

  it('y `getResumenCosto` usa la MISMA, no una gemela', () => {
    expect(costos).toMatch(/porFase\s*=\s*Object\.fromEntries\(agregarPorFase\(/);
  });

  it('los dólares del modelo no se redondean a centavos en ningún lado', () => {
    // `round2` es para PESOS —la unidad más chica de un CFDI—. Aquí no hay
    // unidad más chica: hay un precio por token. El único `round2` que queda en
    // `negocio.ts` es el de la tendencia, que es un porcentaje.
    const usos = [...negocio.matchAll(/round2\(([^)]*)\)/g)].map((m) => m[1]);
    expect(
      usos.filter((u) => /costo|Usd/i.test(u)),
      'volvió a redondearse un costo en dólares a dos decimales',
    ).toEqual([]);
  });
});
