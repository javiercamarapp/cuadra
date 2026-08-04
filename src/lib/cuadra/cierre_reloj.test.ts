import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  crearPresupuesto, hayPresupuestoPara,
  PASOS_CIERRE, COSTO_CIERRE_MS, TECHO_CIERRE_MS, TECHO_CIERRE_OBLIGATORIO_MS,
  MARGEN_CIERRE_MS, PRESUPUESTO_WEBHOOK_MS, TECHO_ENVIO_META_MS, techoPasoSupabaseMs,
} from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIERRE CORRÍA SIN CONSULTAR EL RELOJ NI UNA SOLA VEZ. (auditoría 10, ALTO)
//
// `processor.ts`, en el `timeoutMs` del agente, era la ÚLTIMA línea del archivo
// que mencionaba `reloj`. Todo lo que va después —los trece pasos de
// `PASOS_CIERRE`— corría a ciegas, con un techo sumado de 125 000 ms contra una
// reserva de 12 000 (10.4×) y contra el `maxDuration` de 120 000 (1.04× ellos
// solos).
//
// La suma del escenario: el agente consume su tope de 40 000 ms —caso que
// `presupuesto_camino.test.ts` declara soportado—, el transcurrido es
// 0.9 + 30 + 12 + 40 = 82.9 s y quedan 37.1 s. Basta que CUATRO de los trece
// pasos agoten su propio techo (4 × 9 500 = 38 000) para pasarse de los 120 000.
// Y `sendDocument` del PDF es el paso 10 de 13: para cuando se llega ahí,
// `guardar_liquidacion` ya corrió DENTRO del agente, así que el viaje está
// `liquidado` y el `llm_costo` ya cobrado.
//
// Consecuencia: liquidación cerrada en la base, cero mensajes al operador, cero
// líneas de log (el proceso muere antes del `catch`), sin reintento de Meta.
//
// Y la tabla que debía hacer verificable todo esto estaba llena de costos
// NOMINALES: `COSTO_CIERRE_MS` = 8 900 ms, la suma del promedio.
// ═══════════════════════════════════════════════════════════════════════════

const processorSrc = readFileSync('src/lib/cuadra/processor.ts', 'utf8');
/** Todo lo que corre DESPUÉS de que el agente devuelve: el cierre. */
const tramoDelCierre = processorSrc.slice(processorSrc.indexOf('const res = await runAgent('));

describe('la tabla del cierre dice el peor caso, no el promedio', () => {
  it('cada paso trae su techo, y el techo NO es el costo nominal', () => {
    expect(PASOS_CIERRE).toHaveLength(13);
    for (const p of PASOS_CIERRE) {
      expect(p.techo, `${p.paso} sin techo`).toBeGreaterThan(0);
      expect(p.techo, `${p.paso}: el techo no puede ser el promedio`).toBeGreaterThan(p.ms);
      expect([techoPasoSupabaseMs(), TECHO_ENVIO_META_MS]).toContain(p.techo);
    }
  });

  it('el peor caso del cierre son 125 000 ms — 10.4× la reserva y 1.04× la invocación', () => {
    expect(TECHO_CIERRE_MS).toBe(125_000);
    expect(TECHO_CIERRE_MS / MARGEN_CIERRE_MS).toBeGreaterThan(10);
    expect(TECHO_CIERRE_MS).toBeGreaterThan(PRESUPUESTO_WEBHOOK_MS);
    // Y que quede escrito por qué la reserva no lo puede tapar: es un promedio.
    expect(COSTO_CIERRE_MS).toBeLessThanOrEqual(MARGEN_CIERRE_MS);
  });

  it('saltar lo opcional baja el peor caso a 48 500 ms', () => {
    expect(TECHO_CIERRE_OBLIGATORIO_MS).toBe(48_500);
    expect(TECHO_CIERRE_OBLIGATORIO_MS).toBeLessThan(TECHO_CIERRE_MS / 2);
    // Lo obligatorio es exactamente el entregable más la guardia que lo corrige:
    // respuesta, URL firmada, PDF, la conversación y `guardiaCifras`.
    expect(PASOS_CIERRE.filter((p) => !p.opcional).map((p) => p.paso)).toEqual([
      'guardiaCifras → cuadrarDesdeDB',
      'sendText de la respuesta',
      'createSignedUrl del PDF',
      'sendDocument del PDF',
      'saveConversation',
    ]);
  });

  it('`TECHO_ENVIO_META_MS` sigue siendo el `SEND_TIMEOUT_MS` de meta/client.ts', () => {
    // Está copiado, no importado (ver el comentario en presupuesto.ts). Si los
    // dos se separan, el peor caso del cierre queda mintiendo.
    const cliente = readFileSync('src/lib/meta/client.ts', 'utf8');
    const m = /SEND_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(cliente);
    expect(m, 'no se encontró SEND_TIMEOUT_MS en meta/client.ts').not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBe(TECHO_ENVIO_META_MS);
  });
});

describe('el cierre consulta el reloj', () => {
  it('el tramo posterior a `runAgent` mira el presupuesto', () => {
    expect(
      tramoDelCierre,
      'todo lo que corre después del agente lo hace a ciegas: 125 000 ms de techo ' +
      'contra los 37 100 que quedan en el peor caso soportado, y cuando revienta no ' +
      'queda ni una línea de log porque el proceso muere antes del `catch`.',
    ).toMatch(/hayPresupuestoPara\(/);
  });

  it('y salta exactamente los pasos que la tabla marca como opcionales', () => {
    // Si un paso deja de estar guardado, o se guarda uno que es el entregable,
    // esto lo dice. Los nombres son los del código, no los de la tabla.
    for (const marca of ["'registrarCosto del turno'", "'vincularCostosALiquidacion'", "'aviso de barrera'"]) {
      expect(tramoDelCierre, `no se guarda el paso opcional ${marca}`).toContain(marca);
    }
    // Estos dos se guardan FUERA del tramo porque su código es compartido: la
    // contabilidad del mensaje vive dentro del helper `say` (que se usa en todo
    // el archivo) y soltar el mutex vive en el `finally` de la función entera.
    for (const marca of ["'registrarCostoWhatsApp'", "'releaseViajeLock'"]) {
      expect(processorSrc, `no se guarda el paso opcional ${marca}`)
        .toMatch(new RegExp(`hayPresupuestoPara\\([^;]*${marca}\\)`));
    }
    // Y NUNCA el entregable: el PDF y la respuesta se intentan siempre.
    expect(tramoDelCierre).not.toMatch(/hayPresupuestoPara\([^)]*'sendDocument/);
  });
});

describe('hayPresupuestoPara', () => {
  it('con presupuesto de sobra deja pasar el paso', () => {
    const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => 0);
    expect(hayPresupuestoPara(p, techoPasoSupabaseMs(), 'registrarCosto')).toBe(true);
  });

  it('mide contra la invocación ENTERA, no contra `restante()`', () => {
    // Dentro del cierre `restante()` vale 0 por definición —el margen es justo lo
    // que se está consumiendo—, así que usarlo haría que se saltara TODO siempre.
    let ahora = 0;
    const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora);
    ahora = PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS;   // justo donde arranca el cierre
    expect(p.restante()).toBe(0);
    expect(p.restanteDuro()).toBe(MARGEN_CIERRE_MS);
    expect(hayPresupuestoPara(p, techoPasoSupabaseMs(), 'registrarCosto')).toBe(true);
  });

  it('sin tiempo para su techo, lo salta Y DEJA RASTRO', async () => {
    const { logger } = await import('@/lib/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    let ahora = 0;
    const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora);
    ahora = PRESUPUESTO_WEBHOOK_MS - 2_000;   // quedan 2 s de invocación

    expect(hayPresupuestoPara(p, TECHO_ENVIO_META_MS, 'sendText del aviso de barrera')).toBe(false);
    expect(warn).toHaveBeenCalledWith('cierre.paso_omitido', expect.objectContaining({
      paso: 'sendText del aviso de barrera', techoMs: TECHO_ENVIO_META_MS, restanteMs: 2_000,
    }));
    warn.mockRestore();
  });
});
