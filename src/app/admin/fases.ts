import { ScanText, Calculator, MessageSquareText, Shuffle, Smartphone, Flag } from 'lucide-react';
import type { FaseCosto } from '@/lib/cuadra/costos';

// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE LLAMA UNA FASE DEL PIPELINE, EN /admin. UNA SOLA VEZ.
//
// MEDIO de la auditoría 10 (arquitectura). Este mapa estaba escrito CUATRO
// veces —`admin/page.tsx`, `admin/analitica`, `admin/costos-facturacion`,
// `admin/model-ops`— y ya había divergido: las tres primeras traían seis
// claves y `model-ops` tres. Las cuatro pintan la MISMA dona sobre el MISMO
// `r.porFase` de `getResumenNegocio`, así que una fila de la base se leía con
// dos nombres distintos según la pantalla:
//
//     /admin, /admin/analitica, /admin/costos-facturacion → «Agente de Escalación»
//     /admin/model-ops                                    → «escalacion»
//
// Javier mira cuatro pantallas de su propia consola y dos le dan nombres
// distintos para el mismo gasto. Es el caso canónico que este rubro persigue
// desde la ronda 5 (`otro: 'Gasto'` contra `otro: 'Otro'`), reproducido en
// código escrito la misma semana en que se cerró el anterior.
//
// Los comentarios de `model-ops` y `costos-facturacion` documentaban la
// decisión de «recrear local» los helpers de `admin/page.tsx` porque no se
// exportaban; el mapa se copió con ellos. Este archivo es lo que faltaba: el
// sitio del que sí se exportan.
//
// EL TIPO ES EL GUARDARRAÍL. `Record<FaseCosto, string>` —y no el
// `Record<string, string>` que tenían las cuatro copias— hace que agregar una
// fase a `FaseCosto` sin etiquetarla NO compile. Antes había que acordarse de
// siete literales y ninguno fallaba si se olvidaba uno.
// ═══════════════════════════════════════════════════════════════════════════

/** Nombre legible de cada fase que el código escribe hoy. Exhaustivo por tipo. */
export const FASE_LABEL: Record<FaseCosto, string> = {
  ocr: 'Agente OCR',
  cuadre: 'Agente de Cuadre',
  chat: 'Agente de Chat',
  router: 'Agente Router',
  whatsapp: 'Agente de WhatsApp',
};

/** Ícono de cada fase. Mismo criterio que `FASE_LABEL`: exhaustivo por tipo. */
export const FASE_ICONO: Record<FaseCosto, typeof ScanText> = {
  ocr: ScanText,
  cuadre: Calculator,
  chat: MessageSquareText,
  router: Shuffle,
  whatsapp: Smartphone,
};

/**
 * Fases que el CÓDIGO ya no escribe y la BASE todavía guarda.
 *
 * `'escalacion'` salió de `FaseCosto` esta misma ronda (commit `3f58e3b`)
 * porque ningún camino podía producirla. Pero la migración 0025 la sigue
 * admitiendo en el `check` de la columna y las filas históricas siguen en
 * `llm_costo`: sin esta traducción, la dona de las cuatro pantallas pintaría la
 * clave cruda de la base — que es exactamente lo que `model-ops` hacía.
 *
 * Va aparte a propósito y NO en `FASE_LABEL`: no es una fase del pipeline de
 * hoy, y meterla ahí obligaría a aflojar el tipo que es el guardarraíl.
 */
const FASE_HISTORICA: Record<string, { label: string; Icono: typeof ScanText }> = {
  escalacion: { label: 'Agente de Escalación', Icono: Flag },
};

/**
 * Nombre legible de una fase leída de `llm_costo`.
 *
 * El valor llega como `string` (viene de la base, no del tipo), así que la
 * función acepta `string` y cae hacia atrás en la clave cruda: una fase que
 * nadie reconoce se lee como viene, nunca como `undefined`.
 */
export function etiquetaFase(fase: string): string {
  return FASE_LABEL[fase as FaseCosto] ?? FASE_HISTORICA[fase]?.label ?? fase;
}

/**
 * Ícono de una fase leída de `llm_costo`, indexado por la clave CRUDA.
 *
 * Es un mapa y no una función gemela de `etiquetaFase` a propósito: un
 * componente que sale de una llamada durante el render dispara
 * `react-hooks/static-components` (React lo trata como un tipo nuevo en cada
 * pasada y remonta el subárbol). Indexar un mapa constante no.
 */
export const ICONO_POR_FASE: Record<string, typeof ScanText> = {
  ...FASE_ICONO,
  ...Object.fromEntries(Object.entries(FASE_HISTORICA).map(([f, v]) => [f, v.Icono])),
};
