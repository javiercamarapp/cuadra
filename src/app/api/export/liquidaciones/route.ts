import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeExportar } from '@/lib/auth/permisos';
import { tenantDeSesion } from '@/lib/auth/guard';
import { traerTodo } from '@/lib/cuadra/pg';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const s = await getSessionTenant();
  if (!s) return new NextResponse('No autorizado', { status: 401 });
  // AUDITORÍA 11, PASE 2, A11P2-C3 (CRÍTICO). Aquí decía `!s || !s.tenantId`,
  // y el superadmin tiene `tenant_id` nulo por diseño: el botón se pintaba y
  // el clic devolvía «No autorizado» en texto plano, en la sala del demo.
  // `tenantDeSesion` solo resuelve el tenant; el gate de rol sigue abajo.
  const tenantDe = tenantDeSesion(s);
  if (!tenantDe) return new NextResponse('No autorizado', { status: 401 });
  // AUDITORÍA 11, G-24 (CRÍTICO). Hasta aquí el único `if` preguntaba "¿hay
  // sesión?", y `permisos.ts` —que afirma por escrito decidir «qué endpoint
  // acepta la petición»— no lo importaba NINGUNA ruta de `src/app/api`. Con la
  // cookie de un `operador`, `curl` a esta URL bajaba la nómina de viajes de
  // sus compañeros: `/api` está fuera del matcher del proxy (`proxy.ts:81`) y
  // la consulta corre con service-role, que salta la RLS de la 0045.
  // 403 y no 404: aquí ya hay sesión, así que la existencia de la ruta no es
  // el secreto — el secreto son las filas, y esas no salen.
  if (!puedeExportar(s.rol)) {
    logger.warn('export.liquidaciones.rol_no_autorizado', { tenant: tenantDe, rol: s.rol });
    return new NextResponse('No autorizado', { status: 403 });
  }
  const tenantId = tenantDe;

  // AUDITORÍA 11, G-24 (segunda mitad). `.limit(5000)` pierde contra el
  // `max_rows` de PostgREST (1,000 por default): la conciliación del trimestre
  // cortaba a mitad del segundo mes con HTTP 200 y sin una fila de aviso. Es
  // exactamente el borde que `lib/cuadra/pg.ts` documenta; se pagina con el
  // mismo helper que `analytics.ts`, no con una segunda copia.
  //
  // `traerTodo` LANZA cuando PostgREST devuelve error (vía `exigir`), así que
  // el manejo que antes miraba `error` por valor ahora vive en el `catch`. El
  // texto crudo de PostgREST se queda dentro —sacaba nombres de columna y
  // detalle del esquema hacia afuera (auditoría 5, operabilidad, ALTO)— y el
  // usuario recibe algo que puede repetir por teléfono. `tenant` va en el log
  // —el redactor lo huella, no lo borra— para saber de qué flota era el fallo.
  let data: unknown[];
  try {
    data = await traerTodo<unknown>(
      (desde, hasta) =>
        supabaseAdmin()
          .from('liquidacion')
          .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .range(desde, hasta),
      'export.liquidaciones',
    );
  } catch (e) {
    logger.error('export.liquidaciones', {
      tenant: tenantId, err: e instanceof Error ? e.message : String(e),
    });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows(data as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
