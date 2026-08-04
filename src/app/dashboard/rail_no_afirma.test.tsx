import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatFlota, { responder } from './chat';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-25, la mitad de cliente — el rail no puede AFIRMAR sobre el
// negocio cuando lo que pasó es que no pudo leer.
//
// `chat.tsx` ramificaba solo sobre `kpis === null`, y `null` llegaba por tres
// caminos distintos: no hay datos, no se pudo leer, y el rol de quien pregunta
// no ve el dinero. Los tres contestaban «Todavía no hay liquidaciones» — la
// afirmación más cara que puede hacer este producto, dicha con aplomo a un
// contralor que tiene 40 cerradas.
//
// Y el periodo: las respuestas decían "este periodo" sobre cifras que el rail
// traía SIN ventana (todo el histórico), mientras la tarjeta de al lado
// mostraba 7 días bajo la misma cita de LIVA (G-10).
// ═══════════════════════════════════════════════════════════════════════════

const PREGUNTA = '¿Cuánto llevo comprobado?';

describe('el asistente no convierte un fallo de lectura en un hecho del negocio', () => {
  it('con la base caída NO dice «todavía no hay liquidaciones»', () => {
    const r = responder(PREGUNTA, null, null, 'los últimos 7 días', 'error');
    expect(r, 'una lectura caída se leía como una flota que nunca liquidó').not.toMatch(/no hay liquidaciones/i);
    expect(r).toMatch(/no pude leer|no se pudo leer/i);
  });

  it('al rol que no ve el dinero le dice eso, no que no haya nada', () => {
    const r = responder(PREGUNTA, null, null, 'los últimos 7 días', 'sin-permiso');
    expect(r).toMatch(/acceso|permiso/i);
    expect(r).not.toMatch(/no hay liquidaciones/i);
  });

  it('la flota que de verdad no ha liquidado sí lo escucha', () => {
    expect(responder(PREGUNTA, null, null, 'los últimos 7 días', 'vacio')).toMatch(/no hay liquidaciones/i);
  });

  it('y cuando hay cifras, dice DE QUÉ periodo habla', () => {
    const kpis = { montoComprobado: 47300, viajesLiquidados: 40, conDiferencias: 1, porRevisar: 2, tasaCuadre: 92, diferenciaDetectada: 0 };
    const r = responder(PREGUNTA, kpis, null, 'los últimos 7 días', 'ok' as never);
    expect(r, 'decía "este periodo" sin saber cuál era').toContain('los últimos 7 días');
  });

  it('el IVA también trae su periodo, que es donde chocaba con la tarjeta', () => {
    const acred = { iva: 774.48, peaje: 0, ieps: 0, litrosDiesel: 0, liquidaciones: 3 };
    const r = responder('¿cuánto IVA acreditable llevo?', null, acred, 'los últimos 7 días', 'vacio');
    expect(r).toContain('los últimos 7 días');
    expect(r).not.toContain('este periodo');
  });

  it('el panel de chat monta sin romperse y no afirma de entrada', () => {
    const html = renderToStaticMarkup(<ChatFlota kpis={null} acred={null} motivo="error" />);
    expect(html).not.toMatch(/no hay liquidaciones/i);
  });
});
