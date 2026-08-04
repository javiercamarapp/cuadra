import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KpiTile } from '../admin/ui/kit';
import { acreditableMedido, notaAcreditable, NOTA_SIN_MEDICION } from './medicion';
import type { Acreditables } from '@/lib/cuadra/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-09 (CRÍTICO, frontend, REINCIDENTE) — «`KpiTile` no sabe
// decir "no lo medí"».
//
// `kit.tsx:59` imprimía `{fmt(mostrado)}` sin ninguna rama para "no hay dato":
// `vacio` y `nota` solo añaden texto DEBAJO. Así que con los datos del seed y
// sin una sola falla, el panel imprimía **`0 L`** bajo "LIF 2026, Art. 20-A" y
// **`$0.00`** bajo "LIVA, Art. 5". Un cero fiscal con respaldo legal citado
// al pie: la forma más cara de inventar una cifra que tiene este producto.
//
// Y no es "medí y dio cero". El IVA y el peaje se acumulan DESPUÉS de
// `if (!g.xmlVerificado) continue;` (`cuadre/engine.ts`), y los litros exigen
// `claveProdServ` + `ocrExtra.litros`. Una FOTO —el flujo que el producto
// vende— nunca produce ninguna de las dos cosas. El cero no dice "no hubo IVA
// que acreditar", dice "no llegó ningún XML", y son afirmaciones distintas
// para el contralor que va a meter ese número en su declaración.
//
// El arreglo es una CAPACIDAD de `KpiTile` (`valor: number | null`) y no un
// componente aparte: el panel del cliente monta esta misma tarjeta en once
// pantallas, y un segundo componente deja la mitad sin arreglar.
// ═══════════════════════════════════════════════════════════════════════════

const icono = <span />;

const render = (valor: number | null, formato: 'mxn' | 'litros' | 'porcentaje' | 'entero') =>
  renderToStaticMarkup(
    <KpiTile icono={icono} etiqueta="IVA acreditable" valor={valor} formato={formato} nota="LIVA, Art. 5" />,
  );

describe('KpiTile sabe decir «no lo medí»', () => {
  it('sin dato NO imprime $0.00 bajo la cita legal', () => {
    const html = render(null, 'mxn');
    expect(html, 'un cero con LIVA al pie se lee como una medición fiscal').not.toContain('$0.00');
    expect(html, 'y no basta con quitarlo: hay que decir que no se midió').toContain('—');
  });

  it('sin dato tampoco imprime «0 L» bajo LIF 20-A', () => {
    const html = render(null, 'litros');
    expect(html).not.toContain('0 L');
    expect(html).toContain('—');
  });

  it('sin dato tampoco imprime «0%»', () => {
    const html = render(null, 'porcentaje');
    expect(html).not.toContain('0%');
    expect(html).toContain('—');
  });

  it('sin dato tampoco imprime un «0» pelón', () => {
    const html = render(null, 'entero');
    expect(html).not.toMatch(/>0</);
    expect(html).toContain('—');
  });

  // CONTROL. La tarjeta con dato no se apaga: el arreglo distingue "no medí"
  // de "medí y dio cero", no borra la cifra. (En este render estático el
  // count-up arranca en 0 —`useCountUp` con `animar=true`—, así que lo que se
  // afirma es que NO se toma la rama de "sin medición", no el dígito final.)
  it('con dato la tarjeta no dice «no medí»', () => {
    const html = render(581.38, 'mxn');
    expect(html).not.toContain('—');
    expect(html).toContain('LIVA, Art. 5');
  });
});

// ── La regla del acreditable, aparte de la tarjeta ─────────────────────────

const acred = (over: Partial<Acreditables> = {}): Acreditables => ({
  litrosDiesel: 0, ieps: 0, iva: 0, peaje: 0, liquidaciones: 0, ...over,
});

describe('un acreditable en cero no es una medición', () => {
  it('la consulta caída (null) no se rellena con cero', () => {
    expect(acreditableMedido(null, 'iva')).toBeNull();
  });

  it('cero acreditable con liquidaciones leídas sigue siendo «no medí»', () => {
    expect(acreditableMedido(acred({ liquidaciones: 12 }), 'iva')).toBeNull();
  });

  it('con pesos medidos devuelve los pesos, tal cual', () => {
    expect(acreditableMedido(acred({ iva: 581.38, liquidaciones: 3 }), 'iva')).toBe(581.38);
  });

  it('los litros pasan por la misma regla', () => {
    expect(acreditableMedido(acred({ liquidaciones: 3 }), 'litrosDiesel')).toBeNull();
    expect(acreditableMedido(acred({ litrosDiesel: 113.4, liquidaciones: 3 }), 'litrosDiesel')).toBe(113.4);
  });
});

describe('el pie dice QUÉ falta, y distingue los tres motivos', () => {
  it('lectura caída: no se afirma nada sobre el negocio', () => {
    expect(notaAcreditable(null, 'iva', 'LIVA, Art. 5')).toMatch(/no se pudo/i);
  });

  it('sin liquidaciones en la ventana lo dice así, y no culpa al XML', () => {
    const nota = notaAcreditable(acred(), 'iva', 'LIVA, Art. 5');
    expect(nota).toMatch(/liquidaci/i);
    expect(nota).not.toMatch(/XML/);
  });

  it('con liquidaciones pero sin XML, dice que el acreditable sale del XML', () => {
    const nota = notaAcreditable(acred({ liquidaciones: 12 }), 'iva', 'LIVA, Art. 5');
    expect(nota).toContain(NOTA_SIN_MEDICION.iva);
    expect(nota).toMatch(/XML/);
  });

  it('con medición, el pie vuelve a ser la cita legal y nada más', () => {
    expect(notaAcreditable(acred({ iva: 581.38, liquidaciones: 3 }), 'iva', 'LIVA, Art. 5')).toBe('LIVA, Art. 5');
  });
});
