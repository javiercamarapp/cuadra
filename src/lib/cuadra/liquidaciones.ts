import { supabaseAdmin } from '@/lib/supabase/admin';
import type { RespuestaPg } from './analytics';

// ═══════════════════════════════════════════════════════════════════════════
// LA ÚNICA PUERTA DE LECTURA A `liquidacion`. UN SOLO SITIO PARA EL FILTRO
// QUE SEPARA A UNA FLOTA DE OTRA.
//
// BAJO de la auditoría 10 (arquitectura). Había CUATRO archivos —seis
// consultas— que escribían a mano `.from('liquidacion') … .eq('tenant_id', …)`:
//
//   app/dashboard/page.tsx            `getLiquidaciones`, definida DENTRO del
//                                     archivo de la página, con `analytics.ts`
//                                     al lado y con la misma firma
//   lib/cuadra/analytics.ts           getKpis, getAcreditables, getLiquidacionDetalle
//   app/api/export/liquidaciones/     el CSV al ERP del cliente
//   app/api/export/pdf/[id]/          la firma de la URL del papel
//
// Las seis usan `supabaseAdmin()` — service-role, **RLS NO APLICA**: la policy
// `tenant_data` y la 0045 no se evalúan en ninguna de ellas. El aislamiento
// entre flotas depende ENTERAMENTE de que cada consulta acuerde poner el `.eq`.
//
// El cambio que lo hace estallar no es un bug de hoy: es la próxima consulta a
// `liquidacion` que alguien escriba copiando del vecino equivocado. La medida
// del rubro lo venía diciendo desde la ronda 8 — el 67% de los accesos directos
// vive fuera de `repo.ts`, y "¿dónde se lee una liquidación?" tenía cuatro
// respuestas y ninguna era un módulo de datos.
//
// Ahora hay dónde ponerlo una sola vez. Quien lea liquidaciones pasa por aquí y
// el `tenant_id` es un ARGUMENTO OBLIGATORIO, no una línea que se puede olvidar:
// omitirlo no compila.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Consulta a `liquidacion` ya acotada a la flota, lista para encadenar
 * (`.order()`, `.range()`, `.eq('id', …)`, `.maybeSingle()`, …).
 *
 * NO se devuelve el resultado sino el builder a propósito: cada consumidor
 * pagina, ordena o filtra distinto —el CSV pagina con `traerTodo`, el detalle
 * es un `maybeSingle`— y forzarlos a un contrato común habría hecho que alguno
 * se saliera del módulo, que es de donde venimos.
 *
 * Lo que NO es negociable, y por eso está aquí: el cliente es `supabaseAdmin()`
 * (service-role, salta RLS) y el `.eq('tenant_id', …)` es el único candado.
 */
export interface ConsultaLiquidacion<T> extends PromiseLike<RespuestaPg<T[]>> {
  eq(columna: string, valor: unknown): ConsultaLiquidacion<T>;
  order(columna: string, opciones?: { ascending?: boolean }): ConsultaLiquidacion<T>;
  limit(n: number): ConsultaLiquidacion<T>;
  range(desde: number, hasta: number): ConsultaLiquidacion<T>;
  maybeSingle(): PromiseLike<RespuestaPg<T>>;
  /** La usa `acotada()` para colgarle el tope de consulta. */
  abortSignal(s: AbortSignal): ConsultaLiquidacion<T>;
}

export function liquidacionesDe<T = Record<string, unknown>>(
  tenantId: string,
  columnas: string,
): ConsultaLiquidacion<T> {
  // LA ÚNICA ASERCIÓN DE TIPO DEL MÓDULO, Y VIVE AQUÍ A PROPÓSITO.
  //
  // `select()` de supabase-js deriva el tipo de la fila PARSEANDO el literal de
  // columnas en tiempo de tipos. Con una variable `string` no puede, y devuelve
  // `GenericStringError[]`; con un genérico `Cols extends string` sí puede, pero
  // el parser recursivo se dispara sobre los `select` largos de este módulo y
  // `tsc` se queda sin memoria (medido: 8 GB y muere). La forma de la respuesta
  // se declara arriba y se afirma una sola vez, en el borde, en vez de que cada
  // consumidor cargue con un cast propio — que es la duplicación que este
  // módulo vino a quitar.
  return supabaseAdmin()
    .from('liquidacion')
    .select(columnas)
    .eq('tenant_id', tenantId) as unknown as ConsultaLiquidacion<T>;
}
