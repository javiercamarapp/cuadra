// Datos del rail "Asistente de negocio" — que ahora vive en el LAYOUT de
// /dashboard, o sea en las 20 páginas.
//
// Existe como ruta de API y no como consulta del layout por una limitación
// real de Next.js: un layout NO recibe `searchParams`, así que no puede saber
// si un superadmin está viendo `?tenant=<otra flota>`. Si el layout consultara
// por su cuenta usaría siempre el tenant de la sesión, y el rail enseñaría
// cifras del tenant demo junto a una página que muestra las de Transportes
// Innovativos: dos verdades distintas en la misma pantalla.
//
// El rail es un componente de cliente que sí ve la URL, y pregunta aquí.
// La autorización se rehace COMPLETA en este handler —no se confía en el
// `?tenant=` que llegue— con el mismo criterio que `resolverTenantEfectivo`:
// solo un superadmin puede apuntar a otra flota, y el uuid se valida contra
// la tabla antes de usarse.
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getKpis, getAcreditables, detectarAnomalias } from '@/lib/cuadra/analytics';

export const dynamic = 'force-dynamic';

const TENANT_DEMO = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

export async function GET(req: NextRequest) {
  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });

  let tenantId = sesion.tenantId;
  if (!tenantId) {
    if (sesion.rol !== 'superadmin') return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
    tenantId = TENANT_DEMO();
  }

  // Un `?tenant=` solo lo honra un superadmin, y solo si existe de verdad.
  const pedido = req.nextUrl.searchParams.get('tenant');
  let tenantNombre: string | null = null;
  if (pedido && sesion.rol === 'superadmin') {
    const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', pedido).maybeSingle();
    if (t) { tenantId = t.id as string; tenantNombre = t.nombre as string; }
  }

  // ...Y TAMBIÉN LA DEL ROL. El rail lo pinta `chrome.tsx` en las 20 páginas
  // sin mirar quién es, así que este handler es la única capa que queda entre
  // el jefe de tráfico y las finanzas de la flota. `visibilidad.ts` dice
  // `encargado: ['operacion']`; sin esta pregunta, un `GET` con su cookie —o
  // con la del chofer, que ni siquiera entra al panel— devolvía el comprobado,
  // los acreditables fiscales y el detector de anomalías en JSON.
  // `/api` está fuera del matcher del proxy y esto consulta con service-role
  // (salta la RLS de la 0045): aquí no hay una segunda capa que perdone.
  // Se niega ANTES de consultar — traer el dinero para luego tirarlo es pagar
  // tres consultas por un dato que no se va a entregar.
  const verDinero = puedeVerArea(sesion.rol, 'dinero');

  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch { return null; }
  };
  const [kpis, acred, anomalias] = verDinero
    ? await Promise.all([
        safe(() => getKpis(tenantId!)),
        safe(() => getAcreditables(tenantId!)),
        safe(() => detectarAnomalias(tenantId!)),
      ])
    : [null, null, null];

  return NextResponse.json({
    nombre: sesion.nombre,
    tenantNombre,
    kpis,
    acred,
    anomalias: anomalias?.map((a) => ({ detalle: a.detalle, monto: a.monto })) ?? null,
  });
}
