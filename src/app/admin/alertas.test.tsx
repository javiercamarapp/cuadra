import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Notificaciones, { calcularAlertas, type Alerta } from './notificaciones';
import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO (pruebas) — lógica PURA de /admin sin una sola prueba,
// en archivos que sí cuentan para el umbral de cobertura.
//
// `calcularAlertas` es la única función pura y exportada de ese árbol con un
// umbral numérico dentro (`r.tendenciaCosto >= 30`). Su propio comentario dice
// que vive fuera de las páginas «para que layout.tsx Y
// admin/notificaciones/page.tsx usen EXACTAMENTE el mismo cálculo, no dos
// copias que se puedan desincronizar» — y nada medía ese cálculo: cambiar
// `>= 30` por `>= 300` apaga la campana de costo para siempre y la suite no se
// entera. Medición del auditor: `notificaciones.tsx` 0.0 %, 25 líneas.
//
// El punto rojo de la campana se prueba renderizando (mismo idioma que
// `columna_muerta.test.tsx`): es lo único que distingue «hay algo que ver» de
// «todo en orden» en TODO /admin.
// ═══════════════════════════════════════════════════════════════════════════

const BASE: ResumenNegocio = {
  tenants: 3, flotas: [], viajesProcesados: 12, costoIaUsd: 3.4,
  tokensIn: 1000, tokensOut: 500,
  porFase: [], porModelo: [], porServicio: [], porDia: [],
  facturasPorDia: [], facturasTotal: 8,
  tendenciaCosto: null, tendenciaTokens: null,
};

const CONVERSACION: ConversacionActiva = {
  seudonimo: 'Operador 7C', tenantNombre: 'Transportes Innovativos',
  turns: [], actualizadaEn: '2026-08-03T10:00:00Z',
};

const texto = (a: Alerta[]) => a.map((x) => x.texto).join(' | ');

describe('la campana de costo tiene un umbral, y es 30 %', () => {
  it('en 30 % suena: el umbral es inclusivo', () => {
    const a = calcularAlertas({ ...BASE, tendenciaCosto: 30 }, []);
    expect(a.some((x) => x.tipo === 'atencion' && /costo de IA/.test(x.texto))).toBe(true);
  });

  it('en 29 % no suena', () => {
    const a = calcularAlertas({ ...BASE, tendenciaCosto: 29 }, []);
    expect(texto(a)).not.toMatch(/costo de IA/);
  });

  it('un `null` (ventana anterior vacía) NO se lee como cero ni como subida', () => {
    // `getResumenNegocio` devuelve `null` cuando la semana anterior no tuvo
    // actividad, justamente para no inventar «creció ∞ %». Si aquí se
    // comparara `null >= 30` en JavaScript daría `false` por casualidad; el
    // caso está escrito para que siga siendo una decisión y no un accidente.
    expect(texto(calcularAlertas({ ...BASE, tendenciaCosto: null }, []))).not.toMatch(/costo de IA/);
  });

  it('una BAJADA fuerte de costo tampoco alarma', () => {
    expect(texto(calcularAlertas({ ...BASE, tendenciaCosto: -45 }, []))).not.toMatch(/costo de IA/);
  });

  it('y el porcentaje que se enseña es el medido, no uno redondeado a mano', () => {
    const [a] = calcularAlertas({ ...BASE, tendenciaCosto: 41.7 }, []);
    expect(a.texto).toContain('41.7%');
  });
});

describe('las otras dos alertas', () => {
  it('cuenta las conversaciones de WhatsApp con actividad reciente', () => {
    const a = calcularAlertas(BASE, [CONVERSACION, CONVERSACION]);
    expect(a.some((x) => x.tipo === 'ok' && x.texto.startsWith('2 conversación'))).toBe(true);
  });

  it('sin conversaciones no pinta un contador en cero', () => {
    // «0 conversación(es)» es ruido: la campana existe para lo que sí pasó.
    expect(texto(calcularAlertas(BASE, []))).not.toMatch(/conversación/);
  });

  it('«solo el tenant demo» es alerta mientras no haya un cliente real', () => {
    expect(texto(calcularAlertas({ ...BASE, tenants: 1 }, []))).toMatch(/sin clientes reales/);
    expect(texto(calcularAlertas({ ...BASE, tenants: 0 }, []))).toMatch(/sin clientes reales/);
  });

  it('con dos flotas ya no', () => {
    expect(texto(calcularAlertas({ ...BASE, tenants: 2 }, []))).not.toMatch(/sin clientes reales/);
  });

  it('sin nada que decir, la lista queda vacía — no hay alertas de relleno', () => {
    expect(calcularAlertas(BASE, [])).toEqual([]);
  });
});

describe('el punto rojo de la campana', () => {
  const punto = (alertas: Alerta[]) =>
    renderToStaticMarkup(<Notificaciones alertas={alertas} />).includes('var(--color-bad)');

  it('se pinta cuando hay algo de tipo `atencion`', () => {
    expect(punto(calcularAlertas({ ...BASE, tendenciaCosto: 50 }, []))).toBe(true);
  });

  it('NO se pinta cuando lo único que hay es informativo', () => {
    // Una alerta `ok` (conversaciones activas) no es un problema: si encendiera
    // el punto rojo, estaría encendido siempre y dejaría de significar algo.
    const soloOk = calcularAlertas(BASE, [CONVERSACION]);
    expect(soloOk).toHaveLength(1);
    expect(punto(soloOk)).toBe(false);
  });

  it('ni con la lista vacía', () => {
    expect(punto([])).toBe(false);
  });
});
