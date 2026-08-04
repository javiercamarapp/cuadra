// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (reincidente) — la lista `MEDIOS_LIF_20A` implementaba un
// párrafo que ninguna ficha del repo transcribe.
//
// El comentario del propio arreglo del 2-ago lo declaraba:
//
//   «OJO CON LA PROCEDENCIA: ninguna ficha de `normas/` transcribe ese 4º
//   párrafo, así que esta lista sale del comentario de este archivo y no de una
//   fuente que el repo pueda citar... queda un hallazgo abierto para transcribir
//   el párrafo en `lif-2026-20-A.yaml`.»
//
// Y el escenario del hallazgo es una pregunta que se contesta en la sala: por qué
// un diésel de 200 L con `FormaPago 05` (monedero) sí acredita y uno con `06`
// (dinero electrónico) no. La única respuesta que el repo podía dar era un
// comentario de código.
//
// Esta ronda corre SIN RED hacia el DOF, el SAT ni diputados.gob.mx (medido: 403
// del proxy), así que el párrafo NO se transcribe: inventarlo para llenar
// `texto_vigente` es justo lo que `normas/README.md` prohíbe. Lo que sí se puede
// cerrar es que la decisión deje de vivir solo en un comentario: la ficha ahora
// declara la lista, su alcance, su procedencia real ("decisión de ingeniería, no
// leída en fuente") y cómo verificarla. Esta prueba ata las dos: si alguien mueve
// la lista del motor sin mover la de la ficha —o al revés—, falla.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ficha = readFileSync(new URL('../../../../normas/lif-2026-20-A.yaml', import.meta.url), 'utf8');
const motor = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8');

/** Los códigos de `MEDIOS_LIF_20A`, leídos del fuente del motor. */
function codigosDelMotor(): string[] {
  const i = motor.indexOf('const MEDIOS_LIF_20A');
  expect(i, 'ya no existe `MEDIOS_LIF_20A` en el motor').toBeGreaterThanOrEqual(0);
  const bloque = motor.slice(i, motor.indexOf('];', i));
  return [...bloque.matchAll(/'(\d{2})'/g)].map((m) => m[1]);
}

/** Los códigos que la ficha declara, del campo `codigos_c_formapago`. */
function codigosDeLaFicha(): string[] {
  const m = /codigos_c_formapago:\s*\[([^\]]*)\]/.exec(ficha);
  expect(m, 'la ficha no declara `codigos_c_formapago`').not.toBeNull();
  return [...m![1].matchAll(/"(\d{2})"/g)].map((x) => x[1]);
}

describe('el medio de pago del estímulo de diésel: el motor y la ficha dicen lo mismo', () => {
  it('la ficha declara el requisito que el código implementa', () => {
    expect(ficha).toContain('requisito_medio_de_pago:');
    expect(ficha).toContain('donde_deberia_estar:');
    expect(ficha).toContain('que_afirma_el_codigo:');
  });

  it('y declara su procedencia REAL, que hoy no es una fuente citable', () => {
    // El día que alguien transcriba el párrafo, esto cambia a `transcrito` y
    // `texto_vigente` deja de ser null. Mientras tanto tiene que decirlo la
    // ficha, no un comentario: es el campo con el que se decide si el producto
    // puede citar el fundamento.
    expect(ficha).toMatch(/estado_transcripcion:\s*sin_transcribir/);
    expect(ficha).toMatch(/procedencia_real:/);
    expect(ficha).toMatch(/como_verificarlo:/);
  });

  it('la lista de códigos es la MISMA en los dos lados', () => {
    expect(codigosDeLaFicha()).toEqual(codigosDelMotor());
  });

  it('y es la lista cerrada de seis, no la negación del efectivo', () => {
    expect(codigosDelMotor()).toEqual(['02', '03', '04', '05', '28', '29']);
  });
});
