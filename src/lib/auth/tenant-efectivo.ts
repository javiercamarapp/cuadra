// ═══════════════════════════════════════════════════════════════════════════
// A QUÉ FLOTA APUNTA CADA PÁGINA DE /dashboard/* — un solo lugar, no 20 copias.
//
// `requireSessionTenant` ya resuelve el tenant REAL de un flota_admin/
// operador/contador — para esos roles esta función no hace nada extra, solo
// pasa la sesión tal cual. El caso especial es SUPERADMIN: sin selector de
// flota (Fase 1 del roadmap), su `tenantId` por default es el del demo
// (0001_init.sql), y `?tenant=<id>` (desde "Ver dashboard" en /admin/flotas)
// o `?vista=demo` (desde el link del sidebar de /admin) son las dos formas
// de decirle a esta página CUÁL flota real quiere ver.
//
// `esRaiz` es el único parámetro que distingue la página de aterrizaje
// (`/dashboard`) del resto: SOLO ahí un superadmin que llega sin `?tenant=`
// ni `?vista=demo` (p.ej. por bookmark) se rebota a /admin — es SU consola,
// no la de un cliente. Las subpáginas (Viajes, Documentos, Cuadre…) NUNCA
// hacen ese rebote: si superadmin llegó aquí navegando desde el sidebar (que
// ya propaga `?tenant=`/`?vista=demo` en cada link, ver sidebar-nav.tsx), se
// respeta; si no trae ninguno, cae al tenant demo sin más — igual que
// `requireSessionTenant` ya hace, sin sorpresas.
import { redirect } from 'next/navigation';
import { requireSessionTenant } from './guard';
import { puedeVerRuta, inicioDe, rolEfectivo } from './visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigir } from '@/lib/cuadra/pg';
import { logger } from '@/lib/logger';
import type { SessionTenant } from './session';

/**
 * Resuelve `?tenant=` — la ÚNICA forma de mirar una flota que no es la tuya.
 *
 * AUDITORÍA 11, G-34 (ALTO ×4 rubros). Esto era `const { data } = await …`
 * ocho veces copiado, y las ocho descartaban el `error`: el patrón que
 * `pg.ts:9-21` llama «la familia de bugs más repetida del repo». Con un 503
 * transitorio `data` salía null, el `if` no entraba y se seguía con el tenant
 * de la SESIÓN — que para un superadmin es el DEMO. Cuatro de las ocho copias
 * estaban dentro de server actions que ESCRIBEN: el viaje que Javier crea
 * delante del contralor aterrizaba en la flota demo con la píldora verde
 * diciendo "Viaje creado", y el badge que decía de qué flota se hablaba solo
 * existe en Inicio.
 *
 * Ahora `exigir()` lo convierte en excepción: fallar cerrado y decirlo. Y la
 * suplantación que SÍ ocurre deja una línea con quién, qué flota y qué ruta —
 * antes, a «¿quién de ustedes vio mis liquidaciones el martes?» no había
 * respuesta posible, porque este archivo ni siquiera importaba el logger.
 */
async function flotaSuplantada(
  sesionReal: SessionTenant,
  pedido: string,
  ruta: string,
): Promise<{ id: string; nombre: string } | null> {
  // Solo el superadmin. Para cualquier otro rol `?tenant=` no es un parámetro,
  // es un intento: se ignora sin consultar nada.
  if (sesionReal.rol !== 'superadmin') return null;

  let fila: { id: unknown; nombre: unknown } | null;
  try {
    fila = exigir(
      await supabaseAdmin().from('tenant').select('id, nombre').eq('id', pedido).maybeSingle(),
      'tenant-efectivo.resolver',
    );
  } catch (e) {
    logger.error('tenant.suplantacion_ilegible', {
      userId: sesionReal.userId, tenant: pedido, ruta,
      err: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
  if (!fila) return null;

  logger.info('tenant.suplantacion', {
    userId: sesionReal.userId, tenant: fila.id as string, ruta,
  });
  return { id: fila.id as string, nombre: fila.nombre as string };
}

/**
 * El tenant al que ESCRIBE un server action — la copia que vivía ocho veces.
 *
 * Un action es un endpoint con su propia petición: el `tenantId` que capturó
 * el closure viene del render, no de quien hizo clic, así que hay que
 * resolverlo otra vez. El gate de PERMISO (`puedeAsignar`, …) se queda en la
 * página porque el redirect de vuelta necesita su `sufijo`, que es local.
 */
export async function resolverTenantDeAction(
  destino: string,
  sp: { tenant?: string } | undefined,
): Promise<string> {
  const sesionReal = await requireSessionTenant(destino);
  if (!sp?.tenant) return sesionReal.tenantId;
  const flota = await flotaSuplantada(sesionReal, sp.tenant, destino);
  return flota?.id ?? sesionReal.tenantId;
}

export interface TenantEfectivo extends SessionTenant {
  tenantId: string;
  /** Nombre real de la flota SOLO cuando un superadmin está viendo una
   *  flota real distinta de la demo — null en cualquier otro caso (incluida
   *  la demo, que no necesita el badge "viendo como superadmin"). */
  tenantNombre: string | null;
}

export async function resolverTenantEfectivo(
  destino: string,
  sp: { vista?: string; tenant?: string; rol?: string } | undefined,
  opts: { esRaiz?: boolean } = {},
): Promise<TenantEfectivo> {
  const sesionReal = await requireSessionTenant(destino);

  // "Ver como": un superadmin puede mirar el panel con los ojos de otro rol
  // (`?rol=encargado`) para comparar qué ve cada quien. Solo QUITA visibilidad
  // y solo si la sesión real es superadmin — ver `rolEfectivo`.
  const rol = rolEfectivo(sesionReal.rol, sp?.rol);
  const sesion = { ...sesionReal, rol };

  // ¿ESTA PANTALLA EXISTE PARA ESTE ROL? — antes de resolver nada más.
  //
  // Hasta aquí, encargado y contador entraban al mismo panel que el dueño y
  // veían todo: rentabilidad, cobranza, facturación, clientes. RLS no podía
  // evitarlo (`tenant_data` es por tenant, no por rol: los tres comparten
  // exactamente las mismas filas) y esconder el link tampoco — se teclea la
  // URL. Se gatea aquí porque `destino` ES la ruta y todas las páginas de
  // /dashboard con datos ya pasan por esta función.
  if (!puedeVerRuta(sesion.rol, destino)) redirect(inicioDe(sesion.rol));

  // `?rol=` cuenta como intención de ver el panel del cliente, igual que
  // `?vista=demo` — si no, "ver como encargado" desde la raíz rebotaba a
  // /admin y la comparación era imposible justo en la pantalla de inicio,
  // que es la que más cambia entre un rol y otro.
  if (opts.esRaiz && sesionReal.rol === 'superadmin' && sp?.vista !== 'demo' && !sp?.tenant && !sp?.rol) {
    redirect('/admin');
  }

  let tenantId = sesion.tenantId;
  let tenantNombre: string | null = null;
  if (sp?.tenant) {
    // `flotaSuplantada` es quien comprueba que la sesión REAL sea superadmin
    // (no la previsualizada con `?rol=`) y quien falla cerrado si la lectura
    // no se pudo hacer — ver G-34 arriba.
    const flota = await flotaSuplantada(sesionReal, sp.tenant, destino);
    if (flota) {
      tenantId = flota.id;
      tenantNombre = flota.nombre;
    }
  }

  return { ...sesion, tenantId, tenantNombre };
}
