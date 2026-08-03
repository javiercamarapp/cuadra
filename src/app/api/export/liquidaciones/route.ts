import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { traerTodo } from '@/lib/cuadra/analytics';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeExportar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const s = await getSessionTenant();
  if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
  // La autorización por ROL vive aquí y no puede vivir en otro lado: esta ruta
  // lee con service-role (salta RLS, la policy de la 0045 no se evalúa) y queda
  // fuera del matcher del proxy. Sin esta línea, el chofer bajaba el CSV con
  // las liquidaciones de toda la flota (auditoría 10, CRÍTICO).
  if (!puedeExportar(s.rol)) return new NextResponse('No autorizado', { status: 403 });
  const tenantId = s.tenantId;

  // PAGINADO, NO `.limit()`. PostgREST aplica `db-max-rows` como techo DURO por
  // encima del limit del cliente, y el default de la plataforma son 1,000
  // filas: recorta en silencio, sin error y sin cabecera que el cliente mire.
  // Una flota de 40 unidades pasa las 1,000 liquidaciones en el mes 3, y el
  // contralor conciliaba su trimestre contra un universo al que le faltaba el
  // 44% — lo más viejo, que es justo lo que ya nadie revisa (auditoría 10,
  // ALTO de backend). `analytics.ts` ya había arreglado esto mismo en la
  // auditoría 8; el único camino de datos hacia el ERP del cliente se quedó sin
  // mover.
  //
  // Se ordena por `id` para paginar, no por fecha: con una clave de orden no
  // única, dos páginas pueden repetir o saltarse una fila. El orden que el
  // contralor espera se aplica al final, sobre el conjunto completo.
  let data: Array<Record<string, unknown>> | null = null;
  let error: { message: string } | null = null;
  try {
    data = await traerTodo<Record<string, unknown>>(
      (desde, hasta) => supabaseAdmin()
        .from('liquidacion')
        .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
        .eq('tenant_id', tenantId)
        .order('id')
        .range(desde, hasta),
      'export.liquidaciones',
    );
    data.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }
  // El texto crudo de PostgREST iba en el cuerpo del 500 y del lado del
  // servidor NO quedaba ninguna línea: el único testigo del fallo era el
  // navegador del contralor, que no lo guarda. Si cerraba la pestaña, el evento
  // no existió. Y de paso el mensaje sacaba nombres de columna y detalle del
  // esquema hacia afuera (auditoría 5, operabilidad, ALTO).
  //
  // Se invierte: el detalle se queda dentro y el usuario recibe algo que puede
  // repetir por teléfono. `tenant` va en el log —el redactor lo huella, no lo
  // borra— para saber de qué flota era el fallo.
  if (error) {
    logger.error('export.liquidaciones', { tenant: tenantId, err: error.message });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows((data ?? []) as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
