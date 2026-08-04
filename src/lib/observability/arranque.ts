// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL ARRANQUE TIENE QUE DECIR EN VOZ ALTA
//
// Este archivo cubre una clase concreta de fallo, no "validar el entorno": las
// variables cuya ausencia **no rompe nada**. Las que rompen se descubren solas —
// sin `SUPABASE_SERVICE_ROLE_KEY` la primera consulta explota y alguien se
// entera. Las de aquí son peores porque el sistema arranca, atiende, y contesta
// mal:
//
//   · `DEMO_TENANT_ID` ausente → el panel cae al tenant de `supabase/seed.sql` y
//     pinta CERO liquidaciones, sin un solo log. En el demo del 6 de agosto eso
//     se lee como "el producto no guardó nada". Es el caso de manual del rubro.
//   · `CUADRA_WHATSAPP_MSG_USD` ausente → el costo por liquidación se calcula con
//     un default, y esa cifra es la que decide el precio del producto.
//   · `NEXT_PUBLIC_APP_URL` ausente → `login/page.tsx` cae a `https://likida.ai`
//     y manda los magic links y el retorno de Google a un dominio que no es el
//     desplegado. El correo llega, el link abre, y la sesión se completa en otro
//     sitio: no hay error en ninguna parte, simplemente nadie entra.
//
// LO QUE SALIÓ DE ESTA LISTA, Y POR QUÉ (auditoría 10, MEDIO). Aquí vivía el
// passcode del panel con la consecuencia `→ "proxy.ts no bloquea /dashboard"`.
// Esa consecuencia es FALSA desde que el gate pasó a ser la sesión de Supabase:
// `src/proxy.ts` no nombra esa variable en ninguna línea, y sus dos únicos
// lectores (`app/acceso/page.tsx`, `lib/auth/passcode.ts`) no protegían
// `/dashboard`. Dejarla costaba de las dos formas posibles: quien la quitara
// —lo correcto— se comía un `error` en CADA arranque en frío, en el mismo `msg`
// (y por tanto el mismo cubo de Sentry) que el aviso real de `DEMO_TENANT_ID`;
// y quien no, tenía que mantener viva una variable que ningún gate lee solo
// para que el semáforo de `GUION_DEMO.md:28` pasara. Es exactamente lo que
// `cuadra/startup.ts:34-46` documenta con nombre y fecha: cuando el aviso
// resulta ser mentira una vez, se aprende a ignorarlo — y el que se aprende a
// ignorar es el que más importa el 6 de agosto.
//
// Los dos lectores de arriba ya NO existen: `/acceso` y `lib/auth/passcode.ts`
// se borraron en la misma auditoría (el passcode "aceptaba" el código y no
// concedía nada). El nombre de la variable no se escribe aquí a propósito —
// `acceso_retirado.test.ts` comprueba que no le quede un solo lector en `src/`,
// y una mención en un comentario cuenta como lector para esa prueba.
//
// No duplica `verificarEntornoCritico()` de `cuadra/startup.ts`, que revisa
// `DASHBOARD_SECRET` (una variable que sí es un agujero de seguridad, no una
// respuesta silenciosamente equivocada). Si aquella crece hasta cubrir estas,
// este archivo sobra.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { faltantes } from '@/lib/env';

const SILENCIOSAS: Array<{ nombre: string; consecuencia: string }> = [
  { nombre: 'DEMO_TENANT_ID', consecuencia: 'el panel consulta el tenant del seed y pinta cero liquidaciones' },
  { nombre: 'CUADRA_WHATSAPP_MSG_USD', consecuencia: 'el costo por liquidación usa el default 0.008' },
  {
    nombre: 'NEXT_PUBLIC_APP_URL',
    consecuencia:
      'login arma sus redirects contra https://likida.ai (el fallback del código) en vez del dominio desplegado: el magic link y el retorno de Google apuntan a otro sitio y nadie entra, sin un solo error',
  },
];

/**
 * Lo que tiene de malo el valor de `NEXT_PUBLIC_APP_URL`, o null si está bien.
 *
 * AUDITORÍA 11, G-36 (ALTO). La comprobación era `!process.env[v.nombre]`:
 * PRESENCIA, no valor — cualquier cadena pasaba. Y `scripts/deploy-vercel.sh`
 * le escribía lo que imprimiera `vercel --prod --yes`, que es la URL POR
 * DEPLOY (`likida-a1b2c3d4e-javier.vercel.app`), no el alias estable. Ese host
 * no está en las *Redirect URLs* de Supabase: GoTrue ignora el
 * `emailRedirectTo`, el navegador se va a otro dominio y Likida NUNCA recibe
 * esa petición — no hay log que pueda existir. El contralor recibe su link,
 * hace clic, y no entra. Con el semáforo del arranque en verde.
 *
 * Esto NO decide cuál de los dominios es el bueno (eso es decisión humana y
 * hay que alinearlo con el Site URL de Supabase); exige que el valor sea uno
 * que PUEDA funcionar. Nunca devuelve el valor: solo el defecto.
 */
function defectoDeAppUrl(): string | null {
  const crudo = process.env.NEXT_PUBLIC_APP_URL;
  if (!crudo) return null; // la ausencia ya la reporta SILENCIOSAS

  let u: URL;
  try {
    u = new URL(crudo);
  } catch {
    return 'no es una URL absoluta (falta el esquema https://)';
  }
  if (u.protocol !== 'https:') return 'no es https (la cookie de sesión es `secure`)';
  if (crudo.endsWith('/')) return 'termina en "/": el redirect quedaría como //auth/callback';
  if (u.pathname !== '/' || u.search || u.hash) return 'lleva ruta o query: debe ser solo el origen';
  if (/localhost|127\.0\.0\.1/.test(u.hostname)) return 'apunta a localhost en un despliegue real';

  // La URL EFÍMERA del deploy. Dos formas de cazarla: `VERCEL_URL` ES esa URL
  // (exacta, cuando la plataforma la expone), y el patrón del hostname
  // generado —`<proyecto>-<hash>-<scope>.vercel.app`— para cuando no está. El
  // alias estable (`likidaai.vercel.app`) no lleva ese sufijo.
  const efimera = process.env.VERCEL_URL;
  if (efimera && u.host === efimera) {
    return 'es la URL efímera del deploy (VERCEL_URL), no el alias estable: el magic link apunta a un host que Supabase no reconoce';
  }
  if (/-[a-z0-9]{8,}(-[a-z0-9-]+)?\.vercel\.app$/i.test(u.hostname)) {
    return 'parece la URL efímera de un deploy y no el alias estable: el magic link apunta a un host que Supabase no reconoce';
  }
  return null;
}

/**
 * Emite una línea en el arranque con el estado de esas variables.
 *
 * Solo en despliegues reales: en local estas ausencias son normales y el aviso
 * diario acabaría siendo ruido que se ignora, que es como muere un aviso.
 *
 * Nunca se emite el VALOR, solo el nombre y la consecuencia: el aviso existe
 * para vigilar la configuración, no para filtrarla por el log.
 */
export function avisarConfiguracionSilenciosa(): void {
  const desplegado = !!process.env.VERCEL_ENV || process.env.NODE_ENV === 'production';
  if (!desplegado) return;

  const faltan = SILENCIOSAS.filter((v) => !process.env[v.nombre])
    .map((v) => `${v.nombre}: ${v.consecuencia}`);

  // Estar puesta no basta: ver `defectoDeAppUrl`.
  const mal = defectoDeAppUrl();
  if (mal) faltan.push(`NEXT_PUBLIC_APP_URL: ${mal}`);

  if (faltan.length === 0) {
    logger.info('startup.config_silenciosa', { ok: true, revisadas: SILENCIOSAS.length });
  } else {
    logger.error('startup.config_silenciosa', { ok: false, faltan });
  }

  avisarGruposDeConfiguracion();
}

/**
 * Y las variables cuya ausencia sí rompe algo, agrupadas por lo que apagan.
 *
 * Se emite con un `msg` PROPIO y no dentro del anterior a propósito: Sentry
 * agrupa por mensaje, y meter un aviso y otro distinto en el mismo cubo es cómo
 * se pierde el segundo. La misma razón por la que `startup.migraciones` no
 * debería usar el mismo `msg` para el fallo y para el `ok:true`.
 *
 * Estas se descubrirían solas —sin `SUPABASE_SERVICE_ROLE_KEY` la primera
 * consulta explota— pero se descubren en el turno de un operador, con el mensaje
 * críptico del SDK. Aquí salen antes de servir la primera petición, con el
 * nombre exacto de lo que falta.
 */
function avisarGruposDeConfiguracion(): void {
  const falta = faltantes();
  const grupos = Object.keys(falta);
  if (grupos.length === 0) {
    logger.info('startup.entorno_grupos', { ok: true });
    return;
  }
  logger.error('startup.entorno_grupos', { ok: false, faltan: falta });
}
