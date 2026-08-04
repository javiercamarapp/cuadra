import { mxn } from '@/lib/utils';
import { litros } from './formato';
import { CONDICIONES_ESTIMULO_PEAJE } from '@/lib/cuadra/liquidacion/acreditable';

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
  condicionado,
}: {
  titulo: string;
  valor: number;
  base: string;
  destacar?: boolean;
  unidad?: 'litros';
  /**
   * La cifra es correcta ARITMÉTICAMENTE y su derecho NO está verificado.
   *
   * El estímulo de peaje (LIF 2026 art. 20, ap. A) exige dedicarse
   * EXCLUSIVAMENTE al transporte, usar la Red Nacional de Autopistas de Cuota,
   * ingresos anuales menores a 300 millones, y no ser parte relacionada
   * (LISR 179). El motor aplica el 50% a todo gasto con concepto `caseta` y no
   * conoce ninguna de las cuatro — los propios hallazgos de la ficha lo dicen.
   *
   * `liquidacion/acreditable.ts` ya resolvía esto para el PDF: label con la
   * reserva, tono neutro y un pie que dice que Likida NO verifica la
   * elegibilidad. El panel lo pintaba en verde a 5xl (auditoría 10, ALTO
   * fiscal). Un contralor que meta ese número en su declaración está tomando
   * una posición fiscal que nadie comprobó.
   */
  condicionado?: boolean;
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
  // La regla NO se condiciona a la unidad, y ese fue el hueco del arreglo
  // anterior (auditoría 10, ALTO de frontend): el mismo defecto vivía dos
  // tarjetas a la derecha, en «IVA acreditable $0.00» y «Peaje (50%) $0.00».
  //
  // El IVA y el peaje se acumulan DESPUÉS de `if (!g.xmlVerificado) continue;`
  // (`engine.ts:898`). Una foto nunca produce `xmlVerificado`, y las fotos son
  // el flujo que el producto vende. Así que en el camino normal esas dos
  // cifras dan cero porque no llegó ningún XML — no porque no hubiera IVA que
  // acreditar. Un CFDI de diésel de $4,200 traslada ~$581.
  //
  // Cero grande en `text-5xl` se lee como «su sistema no encontró nada». Es
  // peor que no enseñar la tarjeta, porque la tarjeta afirma haber medido.
  const sinMedicion = !(valor > 0);
  const texto = sinMedicion ? '—' : unidad === 'litros' ? litros(valor) : mxn(valor);
  const pie = sinMedicion
    ? unidad === 'litros'
      ? 'Sin litros medidos en el periodo — se cuentan los del CFDI de diésel con complemento de hidrocarburos.'
      : 'Sin comprobantes medibles en el periodo — se acredita con el XML del CFDI, no con la foto del ticket.'
    : base;
  // Sin medición la tarjeta deja de gritar: pierde el acento y baja a tinta
  // apagada. Si sigue destacada en verde acento, un guion grande se lee como
  // un resultado igual que un cero grande.
  // Un condicionado nunca destaca: el acento se lee como "esto ya es tuyo".
  const resaltar = destacar && !sinMedicion && !condicionado;
  return (
    <div className="card p-7" style={resaltar ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
        {titulo}{condicionado && !sinMedicion ? ' — sujeto a elegibilidad' : ''}
      </div>
      <div
        className="text-4xl md:text-5xl font-semibold tracking-tight tabular mt-2"
        style={{ color: resaltar ? 'var(--accent)' : sinMedicion ? 'var(--muted)' : 'var(--ink)' }}
      >
        {texto}
      </div>
      <div className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{pie}</div>
      {condicionado && !sinMedicion && (
        <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{CONDICIONES_ESTIMULO_PEAJE}</div>
      )}
    </div>
  );
}
