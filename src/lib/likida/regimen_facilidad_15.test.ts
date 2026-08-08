import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 17 · CRÍTICO (fiscal) — la facilidad del 15% se abría al régimen
// equivocado, y el único que la regla nombra no existía en el producto.
//
// RFA 2026 regla 2.9 (ficha `normas/rfa-2026-2.9.yaml`,
// `estado_verificacion: verificado_fuente_primaria`, DOF/SIDOF 5780249), literal:
//
//   «Los contribuyentes personas físicas o morales, dedicados exclusivamente al
//    autotransporte terrestre de carga federal, que tributen conforme al
//    **Título II, Capítulo VII** o **Título IV, Capítulo II, Sección I** de la
//    Ley del ISR, considerarán cumplida la obligación establecida en el artículo
//    27, fracción III, segundo párrafo […] siempre que estos no excedan el 15
//    por ciento del total de los pagos efectuados por consumo de combustible».
//
// Título II Capítulo VII de la LISR es **Coordinados** = clave `624` del
// catálogo c_RegimenFiscal del SAT.
// Título IV Capítulo II Sección I es **PF con actividades empresariales** = `612`.
//
// El código tomaba `601` (General de Ley Personas Morales — el Título II
// GENERAL, no su Capítulo VII) como elegible, y `624` no estaba ni en la lista
// ni en el catálogo del alta. La válvula abría para quien no califica y cerraba
// para quien sí: el PDF imprime "deducible" citando la regla 2.9 a una PM que
// no tributa como coordinado, y a un coordinado de verdad no se le puede ni
// registrar el régimen.
//
// Es el error de jerarquía que `normas/README.md` llama "el más caro del
// dominio": confundir un Título con uno de sus Capítulos.
// ═══════════════════════════════════════════════════════════════════════════

const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])) }),
}));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./config', () => ({ getConfig: vi.fn() }));

const { crearFlota } = await import('./administracion');

function cadena(resultado: unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) nodo[m] = () => nodo;
  nodo.maybeSingle = () => Promise.resolve(resultado);
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return nodo;
}

/** La fila que se insertó en `tenant`, para leerle la `config`. */
let insertado: Record<string, unknown> | undefined;

beforeEach(() => {
  from.mockReset();
  insertado = undefined;
  for (const f of Object.values(logger)) f.mockReset();
  from.mockImplementation((tabla: string) =>
    tabla === 'tenant'
      ? {
          insert: (fila: Record<string, unknown>) => {
            insertado = fila;
            return cadena({ data: { id: 't-1' }, error: null });
          },
        }
      : { insert: () => Promise.resolve({ error: null }) });
});

/** `config.facilidadCombustibleEfectivo.regimenElegible` tal como lo escribe el alta. */
async function elegiblePara(regimenFiscal: string): Promise<boolean | undefined> {
  await crearFlota({ nombre: 'Transportes Prueba', regimenFiscal, dedicacionExclusivaCarga: true });
  const config = insertado?.config as
    | { facilidadCombustibleEfectivo?: { regimenElegible?: boolean } }
    | undefined;
  return config?.facilidadCombustibleEfectivo?.regimenElegible;
}

describe('quién califica para la facilidad del 15% (RFA 2026 regla 2.9)', () => {
  it('624 (Coordinados = Título II Cap. VII) SÍ califica — es el que la regla nombra', async () => {
    expect(await elegiblePara('624')).toBe(true);
  });

  it('612 (PF act. empresariales = Título IV Cap. II Sec. I) SÍ califica', async () => {
    expect(await elegiblePara('612')).toBe(true);
  });

  it('601 (General de Ley PM) NO califica: es el Título II general, no su Capítulo VII', async () => {
    expect(await elegiblePara('601')).toBe(false);
  });

  // CONTROL: un régimen claramente ajeno sigue fuera, para que lo de arriba no
  // pase por "todo devuelve false".
  it('626 (RESICO) no califica', async () => {
    expect(await elegiblePara('626')).toBe(false);
  });
});
