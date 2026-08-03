import { mxn } from '@/lib/utils';
import { litros } from './formato';

/**
 * Una tarjeta de la fila "Estímulos acreditables del periodo".
 *
 * Vivía dentro de `page.tsx` y se sacó aquí para poder EJECUTARLA en una
 * prueba. El rubro frontend no tiene arnés de render, y la única prueba que
 * tenía el panel (`foto_no_expuesta.test.ts`) lee el texto fuente en vez de
 * correrlo — el patrón que este repo ya documentó como insuficiente. Sacar el
 * componente es lo mínimo para que la regla de abajo se pruebe de verdad.
 *
 * `unidad` existe porque no todo lo acreditable son pesos. El estímulo de
 * diésel es cuota semanal disminuida × litros (LIF 2026 art. 20-A), y esa
 * cuota no la tenemos: entregar los litros es honesto, inventar los pesos no.
 *
 * Con `maximumFractionDigits: 0` esta tarjeta decía "152 L" y el detalle, a un
 * clic, "152.35 L" — y el PDF que el contralor le manda a su contador, una
 * tercera cifra. En un dato fiscal, tres representaciones se leen como tres
 * cálculos (auditoría 5, frontend, MEDIO 1). `litros()` es la única.
 */
export function Acred({
  titulo,
  valor,
  base,
  destacar,
  unidad,
}: {
  titulo: string;
  valor: number;
  base: string;
  destacar?: boolean;
  unidad?: 'litros';
}) {
  // AUDITORÍA 10, CRÍTICO (frontend): esta tarjeta imprimía `0 L` en
  // `text-4xl md:text-5xl`, en color de acento y con borde de acento —el
  // elemento más grande de la pantalla— siempre que no hubiera litros medidos.
  //
  // Y no hay litros medidos en las rutas que el demo puede tomar: el motor
  // solo cuenta litros que vengan de `ocrExtra.litros` (`engine.ts:928`), que
  // únicamente escribe el OCR de una foto (`intake/ocr.ts:406`), y además exige
  // `claveProdServ` (`engine.ts:906`), que únicamente escribe el parser del XML
  // (`intake/cfdi_xml.ts:115`). El gasto de diésel del seed entra sin
  // `ocr_extra` (`seed.sql:121-123`), así que la suma da 0 y la pantalla lo
  // afirmaba como si lo hubiera medido.
  //
  // "0 L" no es lo mismo que "no medí litros". El panel de detalle ya
  // distingue las dos cosas —`[id]/page.tsx:138` oculta la tarjeta cuando no
  // hay litros—; éste no, y es el que se proyecta. Un cero en el tamaño más
  // grande de la pantalla se lee como "su sistema no encontró nada", y es peor
  // que no enseñar la tarjeta, porque la tarjeta afirma haber medido.
  //
  // Se conserva la tarjeta (el contralor tiene que ver que el concepto existe)
  // y se le quita la afirmación: raya en vez de cero, y el pie dice qué falta.
  // Cuando SÍ hay litros, nada cambia.
  const sinMedicion = unidad === 'litros' && !(valor > 0);
  const texto = sinMedicion ? '—' : unidad === 'litros' ? litros(valor) : mxn(valor);
  const pie = sinMedicion
    ? 'Sin litros medidos en el periodo — se cuentan los del CFDI de diésel con complemento de hidrocarburos.'
    : base;
  // Sin medición la tarjeta deja de gritar: pierde el acento y baja a tinta
  // apagada. Si sigue destacada en verde acento, un guion grande se lee como
  // un resultado igual que un cero grande.
  const resaltar = destacar && !sinMedicion;
  return (
    <div className="card p-7" style={resaltar ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="text-sm font-medium" style={{ color: 'var(--muted)' }}>{titulo}</div>
      <div
        className="text-4xl md:text-5xl font-semibold tracking-tight tabular mt-2"
        style={{ color: resaltar ? 'var(--accent)' : sinMedicion ? 'var(--muted)' : 'var(--ink)' }}
      >
        {texto}
      </div>
      <div className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{pie}</div>
    </div>
  );
}
