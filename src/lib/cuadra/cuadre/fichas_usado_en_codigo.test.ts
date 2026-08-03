// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (reincidente) — dos fichas declaraban mal dónde se usan, y
// una de las dos afirmaba de sí misma algo que el código desmentía.
//
// `usado_en_codigo` es el campo con el que se calcula el RADIO DE IMPACTO cuando
// una norma cambia (`normas/README.md`). Si miente, una reforma se evalúa contra
// el archivo equivocado. Y `normas_sincronizadas.test.ts` compara id, estado,
// jerarquía, citas, ruta y `fecha_vigencia_desde` — nunca `usado_en_codigo`.
//
// Lo que decían:
//
//   rmf-2026-2.7.1.21.yaml → «FISCAL_LEGAL.md §1.6 (documentación, no código)»
//     …mientras `normas/por_diferencia.ts` la lista en `factura_por_vencer`. Sí
//     se usa en código, y es una de las dos normas que `guardiaFundamento`
//     autoriza al agente a citar sobre un aviso de facturación — con
//     `texto_vigente: null`.
//
//   politica-portales-plazos.yaml → «`plazoVerificado: false` en 12 de 13
//     entradas; `true` SOLO en office_depot» (son 37 y 4), y «en las dos ramas
//     (vencida y no vencida) dice que el plazo LEGAL es todo el ejercicio»,
//     que era falso contra la salida medida del motor.
//
// Esta prueba no compara prosa: ata los conteos al catálogo y la afirmación
// sobre el motor a lo que el motor de verdad imprime.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cuadrarViaje } from './engine';
import { COMERCIOS } from '../facturacion/comercios';
import { NORMA_POR_DIFERENCIA } from '../normas/por_diferencia';
import type { Gasto } from '@/types/cuadra';

const leer = (f: string) => readFileSync(new URL(`../../../../normas/${f}`, import.meta.url), 'utf8');
const fichaGlobal = leer('rmf-2026-2.7.1.21.yaml');
const fichaPortales = leer('politica-portales-plazos.yaml');

/** El bloque `usado_en_codigo:` de una ficha, hasta el siguiente campo raíz. */
function usadoEnCodigo(txt: string): string {
  const i = txt.indexOf('usado_en_codigo:');
  expect(i, 'la ficha no tiene `usado_en_codigo`').toBeGreaterThanOrEqual(0);
  const resto = txt.slice(i + 'usado_en_codigo:'.length);
  const fin = /\n[a-z_]+:/.exec(resto);
  return fin ? resto.slice(0, fin.index) : resto;
}

describe('`usado_en_codigo` dice la verdad: es el radio de impacto de una reforma', () => {
  it('la ficha de la factura global no puede decir que NO se usa en código', () => {
    // El hecho que la desmentía, leído del código y no de la prosa.
    expect(NORMA_POR_DIFERENCIA.factura_por_vencer).toContain('rmf-2026-2.7.1.21');

    const usado = usadoEnCodigo(fichaGlobal);
    expect(usado).toContain('por_diferencia.ts');
    expect(usado).toContain('cuadre/engine.ts');
    expect(usado, 'seguía diciendo "documentación, no código"').not.toMatch(/no c[oó]digo/i);
  });

  it('los conteos de la ficha de portales son los del catálogo, no los de hace tres rondas', () => {
    const verificados = COMERCIOS.filter((c) => c.plazoVerificado);
    const usado = usadoEnCodigo(fichaPortales);

    const m = /`plazoVerificado: false` en (\d+) de (\d+) entradas/.exec(usado);
    expect(m, 'la ficha ya no declara el conteo de forma comparable').not.toBeNull();
    expect(Number(m![2]), 'total de entradas del catálogo').toBe(COMERCIOS.length);
    expect(Number(m![1]), 'entradas sin plazo verificado').toBe(COMERCIOS.length - verificados.length);

    // Y nombra a las verificadas: son las únicas cuya fecha se puede atribuir a
    // un portal que alguien leyó.
    for (const c of verificados) expect(usado, `falta ${c.clave}`).toContain(c.clave);
  });

  it('y lo que afirma sobre el motor es lo que el motor imprime', () => {
    // Las tres ramas que afirman una fecha, medidas de verdad. Ticket de Office
    // Depot (plazo verificado) y de Shell (sin verificar), en las tres ventanas.
    const ticket = (over: Partial<Gasto> = {}): Gasto => ({
      id: 'g1', concepto: 'otro', monto: 1450.5, fecha: '2026-07-25', folio: 'ITU-1',
      ocrConfianza: 0.97, rfcEmisor: 'ODM950324V2A', ...over,
    });
    const nota = (g: Gasto, hoy: string) =>
      cuadrarViaje({ viajeId: 'v', anticipo: 5000, gastos: [g], politica: [], hoy })
        .diferencias.find((d) => d.tipo === 'factura_por_vencer')!.nota;

    const sinVerificar = ticket({ rfcEmisor: undefined, ocrExtra: { emisor: 'SHELL' }, concepto: 'diesel', fecha: '2026-08-01' });
    for (const [g, hoy] of [
      [ticket(), '2026-07-28'],      // no vencida, verificada
      [ticket(), '2026-08-30'],      // urgente, verificada
      [ticket(), '2026-09-05'],      // vencida
      [sinVerificar, '2026-08-02'],  // no vencida, SIN verificar (33 de 37)
      [sinVerificar, '2026-08-30'],  // urgente, SIN verificar
    ] as [Gasto, string][]) {
      expect(nota(g, hoy), `hoy=${hoy}`).toContain('dentro del ejercicio');
    }

    const usado = usadoEnCodigo(fichaPortales);
    expect(usado).toMatch(/TRES ramas/);
    expect(usado, 'la afirmación vieja hablaba de dos ramas').not.toMatch(/las dos ramas/);
  });
});
