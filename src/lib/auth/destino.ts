// ═══════════════════════════════════════════════════════════════════════════
// A DÓNDE SE PUEDE MANDAR A ALGUIEN DESPUÉS DE ENTRAR — una sola definición.
//
// El `next` llega del querystring: lo controla quien manda el link, así que es
// entrada no confiable y la puerta es una LISTA BLANCA, nunca una lista negra.
//
// Esto vivía copiado cuatro veces (`login/page.tsx:49`, `:54`, `:70` y
// `auth/callback/route.ts:14`), las cuatro con `startsWith('/dashboard')`.
// Dos consecuencias, las dos reales:
//
//  · El chofer que abría `/mis-viajes` era rebotado a `/login?next=/mis-viajes`
//    —el proxy conserva ese `next` y hay prueba de ello— y estas cuatro copias
//    lo tiraban. Acababa en el panel del contralor (auditoría 10, ALTO de
//    frontend; la otra mitad la cerró `d081176` en la puerta de rol).
//  · `'/dashboardevil'.startsWith('/dashboard')` es `true`. El prefijo suelto
//    no es frontera de segmento.
//
// La lista NO se relajó al agregar los otros dos paneles: `/admin` y
// `/mis-viajes` tienen su propia puerta de ROL (`requireSuperadmin`,
// `requireOperador`), así que llegar ahí sin ser quien toca sigue rebotando.
// Esta función decide a dónde se INTENTA ir, no quién puede.
// ═══════════════════════════════════════════════════════════════════════════

/** Las tres raíces de panel del producto. Cada una con su guard de rol. */
const PANELES = ['/dashboard', '/mis-viajes', '/admin'] as const;

export const DESTINO_POR_DEFECTO = '/dashboard';

/**
 * Devuelve `next` si es un destino de panel legítimo; si no, `/dashboard`.
 *
 * Nunca devuelve algo que no empiece por `/`, así que no puede convertirse en
 * un redirect fuera del sitio.
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_POR_DEFECTO;
  // Una ruta del sitio empieza con UNA sola barra. `//evil.example` es
  // protocol-relative: el navegador lo resuelve como otro host.
  if (!next.startsWith('/') || next.startsWith('//')) return DESTINO_POR_DEFECTO;
  // Un salto de línea o un retorno de carro partirían la cabecera `Location`.
  if (/[\r\n]/.test(next)) return DESTINO_POR_DEFECTO;
  // Frontera de segmento: la raíz exacta, o seguida de `/`, `?` o `#`.
  const ok = PANELES.some((p) => next === p || /^[/?#]/.test(next.slice(p.length)) && next.startsWith(p));
  return ok ? next : DESTINO_POR_DEFECTO;
}
