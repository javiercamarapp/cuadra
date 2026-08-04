import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { esperarIntake } from './conv';
import {
  TECHO_OCR_MS, TOPE_BARRERA_INTAKE_MS,
  PRESUPUESTO_WEBHOOK_MS, MARGEN_CIERRE_MS,
} from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// LA BARRERA ESPERABA MENOS DE LO QUE PUEDE TARDAR AQUELLO QUE ESPERA.
// (auditoría 10, ALTO)
//
// El "listo" entraba a `esperarIntake` con 20 000 ms; el OCR que esa barrera
// espera corre con `reloj.senal(25_000)`. Entre los dos números hay 5 000 ms en
// los que la barrera SIEMPRE se rinde de más: la foto sigue dentro de su propio
// techo y el cuadre ya salió sin ella.
//
// Con valores: ticket a las 21:04:00, "listo" a las 21:04:01, OCR de 22 s
// —legítimo—, barrera vencida a los 20 s, `intake.barrera_timeout`, el agente
// cuadra sin ese comprobante y el viaje queda `liquidado` (trigger de la 0037:
// no se puede corregir). Dos segundos después la primera invocación escribe el
// gasto. El PDF que recibió el operador y el panel que abre el contralor
// difieren por el monto de ese ticket, y esa discrepancia no se le avisa a
// nadie.
//
// Los dos números vivían escritos a mano en sitios distintos (`processor.ts` y
// `conv.ts`), que es cómo se separaron sin que nada fallara. Ahora salen del
// mismo sitio y esta prueba lo fija.
// ═══════════════════════════════════════════════════════════════════════════

/** Resuelve el argumento de un call-site: literal (`25_000`) o constante. */
const CONSTANTES: Record<string, number> = { TECHO_OCR_MS, TOPE_BARRERA_INTAKE_MS };
function valor(expr: string): number {
  const n = Number(expr.replace(/_/g, ''));
  return Number.isFinite(n) ? n : CONSTANTES[expr];
}

const processorSrc = readFileSync('src/lib/cuadra/processor.ts', 'utf8');

describe('la barrera de intake contra el techo del OCR que espera', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('el tope que el processor le pide a la barrera es >= el techo del OCR', () => {
    const barrera = [...processorSrc.matchAll(/esperarIntake\(\s*viajeId\s*,\s*reloj\.acotar\(([^)]+)\)/g)]
      .map((m) => valor(m[1].trim()));
    const ocr = [...processorSrc.matchAll(/extraerComprobante\([^,]+,\s*reloj\.senal\(([^)]+)\)/g)]
      .map((m) => valor(m[1].trim()));

    expect(barrera.length, 'no se encontró el call-site de la barrera').toBeGreaterThan(0);
    expect(ocr.length, 'no se encontraron los call-sites del OCR').toBeGreaterThan(0);

    const peorOcr = Math.max(...ocr);
    for (const b of barrera) {
      expect(
        b,
        `la barrera espera ${b} ms por un OCR cuyo techo son ${peorOcr} ms: ` +
        `${peorOcr - b} ms en los que se rinde sobre una foto que todavía es legítima, ` +
        'y la liquidación sale corta sin que el PDF y el panel coincidan.',
      ).toBeGreaterThanOrEqual(peorOcr);
    }
  });

  it('un OCR de 22 s —dentro de su techo de 25— ya NO tira la barrera', async () => {
    vi.useFakeTimers();
    // El contador de intake: la foto hizo +1 y su `finally` lo baja a 0 cuando
    // el OCR termina, a los 22 s.
    let enVuelo = 1;
    setTimeout(() => { enVuelo = 0; }, 22_000);

    let ok: boolean | undefined;
    void esperarIntake('v1', TOPE_BARRERA_INTAKE_MS, async () => enVuelo).then((v) => { ok = v; });
    await vi.advanceTimersByTimeAsync(TOPE_BARRERA_INTAKE_MS + 1_000);

    expect(ok, 'la barrera se rindió sobre una foto que seguía dentro de su propio techo').toBe(true);
  });

  it('y con el tope viejo de 20 000 ms ese mismo OCR sí la tiraba', async () => {
    vi.useFakeTimers();
    let enVuelo = 1;
    setTimeout(() => { enVuelo = 0; }, 22_000);

    let ok: boolean | undefined;
    void esperarIntake('v1', 20_000, async () => enVuelo).then((v) => { ok = v; });
    await vi.advanceTimersByTimeAsync(23_000);

    expect(ok, 'este es el fallo que se está cerrando: documenta el 20 000 de antes').toBe(false);
  });

  it('la barrera más ancha SIGUE cabiendo en el presupuesto de la invocación', () => {
    // El número contra el número: los topes pedidos del camino del "listo".
    const TOPE_MUTEX = 12_000, TOPE_AGENTE = 40_000;
    const fijos = TOPE_BARRERA_INTAKE_MS + TOPE_MUTEX + TOPE_AGENTE;   // 82 000
    const utilizable = PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS;      // 108 000
    expect(fijos).toBeLessThanOrEqual(utilizable);
    expect(utilizable - fijos).toBeGreaterThanOrEqual(20_000);
  });

  it('ni `processor.ts` ni `conv.ts` vuelven a escribir esos topes a mano', () => {
    const convSrc = readFileSync('src/lib/cuadra/conv.ts', 'utf8');
    expect(processorSrc).not.toMatch(/reloj\.acotar\(20_000\)/);
    expect(processorSrc).not.toMatch(/reloj\.senal\(25_000\)/);
    // El default de `esperarIntake` es el mismo número, y también se separó.
    expect(convSrc).toMatch(/TOPE_BARRERA_INTAKE_MS/);
  });
});
