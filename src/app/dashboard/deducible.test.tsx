import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilaDeduc, TINTA_TONO } from './deducible';
import { filasDeducibilidad, type FilaDeducibilidad, type TonoDeducibilidad } from '@/lib/cuadra/liquidacion/deducibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO REINCIDENTE (frontend) — «TonoDeducibilidad tiene
// cuatro miembros y el panel sigue conociendo dos».
//
// `deducibilidad.ts:17` declara `'bueno' | 'malo' | 'pendiente' |
// 'condicionado'`. `[id]/page.tsx:158` los pintaba con un ternario de dos
// ramas: `f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)'`. Resultado en
// pantalla: «Por confirmar» (`pendiente`), «Deducible para ISR» (`bueno`) y
// «Deducible para ISR — sujeto a permiso CRE vigente» (`condicionado`) salían
// EN EL MISMO COLOR y con el mismo peso. Lo único que los distinguía era el
// texto de la etiqueta.
//
// El PDF del mismo viaje —que el guion abre en el minuto 6, junto a la
// pantalla— los pinta en tres colores distintos (`pdf.ts:295`: VERDE, ÁMBAR e
// INK). Dos codificaciones de color para el mismo desglose.
//
// «Por confirmar» es dinero que todavía se puede recuperar («Falta timbrar la
// factura o acreditar el medio de pago»). Leerlo con la misma tinta que
// «Deducible para ISR» es leerlo como dinero que ya está a salvo.
//
// Se prueba EJECUTANDO el componente (`renderToStaticMarkup`), no leyendo su
// texto fuente — el patrón que este repo ya documentó como insuficiente.
// ═══════════════════════════════════════════════════════════════════════════

const TONOS: TonoDeducibilidad[] = ['bueno', 'malo', 'pendiente', 'condicionado'];

const pintar = (tono: TonoDeducibilidad, extra: Partial<FilaDeducibilidad> = {}) =>
  renderToStaticMarkup(
    <FilaDeduc fila={{ label: 'Renglón', monto: 5600, tono, ...extra }} />,
  );

describe('el panel distingue los cuatro tonos, no dos', () => {
  it('cada tono se pinta con una tinta distinta de las otras tres', () => {
    const tintas = TONOS.map((t) => TINTA_TONO[t]);
    expect(
      new Set(tintas).size,
      `dos tonos comparten color: ${tintas.join(' · ')}`,
    ).toBe(TONOS.length);
  });

  it('«Por confirmar» NO se ve igual que «Deducible para ISR»', () => {
    // El caso concreto del hallazgo: la misma liquidación devuelve las dos
    // filas, y en pantalla salían idénticas salvo por el texto.
    const porConfirmar = pintar('pendiente');
    const deducible = pintar('bueno');
    expect(porConfirmar).not.toContain(TINTA_TONO.bueno);
    expect(deducible).not.toContain(TINTA_TONO.pendiente);
  });

  it('«sujeto a permiso CRE vigente» tampoco se ve igual que «Deducible para ISR»', () => {
    // `condicionado` no es «falta algo del operador» (eso es `pendiente`): es
    // «el sistema no verifica un requisito legal». Mismo criterio que el PDF.
    expect(pintar('condicionado')).not.toContain(TINTA_TONO.bueno);
    expect(pintar('condicionado')).not.toContain(TINTA_TONO.pendiente);
  });

  it('lo no deducible conserva el rojo que ya tenía — el arreglo no desanda nada', () => {
    expect(pintar('malo')).toContain('var(--color-bad)');
  });

  it('el renglón sigue imprimiendo etiqueta, monto y pie', () => {
    const html = pintar('pendiente', { pie: 'Falta timbrar la factura.' });
    expect(html).toContain('Renglón');
    expect(html).toContain('5,600');
    expect(html).toContain('Falta timbrar la factura.');
  });

  // EL COTEJO CONTRA EL TIPO, EJECUTADO. Si `deducibilidad.ts` gana un quinto
  // tono, `Record<TonoDeducibilidad, string>` ya rompe `tsc`; esto además fija
  // que ninguno de los que HOY existen se quede sin tinta propia en pantalla.
  it('los tonos que el motor emite de verdad tienen todos su color', () => {
    const conCre = filasDeducibilidad({
      totalDeducible: 5600, totalPorConfirmar: 0, totalNoDeducible: 0, totalComprobado: 5600,
      diferencias: [{ tipo: 'permiso_cre_no_verificable' }],
    });
    const mezcla = filasDeducibilidad({
      totalDeducible: 3000, totalPorConfirmar: 2000, totalNoDeducible: 600, totalComprobado: 5600,
    });
    const emitidos = [...(conCre ?? []), ...(mezcla ?? [])].map((f) => f.tono);
    expect(emitidos.length).toBeGreaterThan(0);
    for (const t of emitidos) expect(TINTA_TONO[t], `el motor emite «${t}» y el panel no lo pinta`).toBeTruthy();
    // Y los cuatro salen realmente distintos en el HTML del renglón.
    const html = [...(conCre ?? []), ...(mezcla ?? [])].map((f) => renderToStaticMarkup(<FilaDeduc fila={f} />));
    // La tinta del MONTO, no la del pie (que siempre es `--muted`).
    const colores = html.map((h) => h.match(/whitespace-nowrap"[^>]*style="color:([^"]+)"/)?.[1]?.trim());
    expect(colores.every(Boolean), `no encontré la tinta del monto en ${html[0]}`).toBe(true);
    expect(new Set(colores).size, `los renglones del motor salen en ${new Set(colores).size} color(es)`).toBeGreaterThan(2);
  });
});
