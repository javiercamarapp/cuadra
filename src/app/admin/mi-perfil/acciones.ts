'use server';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS SERVER ACTIONS DE /admin/mi-perfil, FUERA DE page.tsx.
//
// AUDITORÍA 11 · G-33, ALTO. Estaban INLINE dentro del componente de página:
// no se podían importar, así que no se podían ejercer, así que la única
// escritura de perfil del producto no tenía una sola prueba — y las dos
// felicitaban al usuario con el `{ error }` de supabase-js tirado a la
// basura. La familia de bugs que `pg.ts:10-20` llama la más repetida del
// repo, en la pantalla que le dice a Javier que su cambio se guardó.
//
// La escritura misma vive en `@/lib/admin/negocio`. No es ceremonia: la
// frontera de que `/admin` no habla con Supabase directamente es la que hace
// que exista UN sitio donde comprobar el error, y `mi-perfil` era el primer
// archivo de `/admin` que la rompía (tres `supabaseAdmin()` propios).
// ═══════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import { guardarNombrePerfil, guardarAvatarUrlPerfil, subirAvatarPerfil } from '@/lib/admin/negocio';
import { logger } from '@/lib/logger';
import { validarAvatar } from './avatar-validacion';

/** Un fallo de escritura NO se anuncia como "guardado". Se registra y se dice. */
export async function actualizarNombre(formData: FormData): Promise<void> {
  const { userId } = await requireSuperadmin();
  const nombre = String(formData.get('nombre') ?? '').trim();
  if (!nombre) redirect('/admin/mi-perfil?error=nombre');
  try {
    await guardarNombrePerfil(userId, nombre);
  } catch (e) {
    // Sin esta línea el síntoma que llega es "se borra sola": el usuario
    // vio "Nombre guardado." y en la siguiente carga el nombre viejo.
    logger.error('perfil.nombre_no_guardado', {
      userId, err: e instanceof Error ? e.message : String(e),
    });
    redirect('/admin/mi-perfil?error=nombre_guardar');
  }
  redirect('/admin/mi-perfil?ok=nombre');
}

export async function subirAvatar(formData: FormData): Promise<void> {
  const { userId } = await requireSuperadmin();
  const v = validarAvatar(formData.get('avatar'));
  if (!v.ok) {
    logger.warn('perfil.avatar_rechazado', { userId, motivo: v.motivo });
    redirect(`/admin/mi-perfil?error=avatar_${v.motivo}`);
  }

  // RUTA FIJA, SIN EXTENSIÓN. Antes salía de `archivo.name.split('.').pop()`,
  // así que subir un `.png` no pisaba el `.jpg` anterior: quedaba un objeto
  // PÚBLICO huérfano por cada formato que el usuario probara, y ninguna
  // pantalla los enseña ni hay quien los borre. La extensión no aporta nada:
  // el navegador se guía por el `Content-Type` con el que se sirve.
  const ruta = `${userId}/avatar`;
  let publicUrl: string;
  try {
    publicUrl = await subirAvatarPerfil(userId, ruta, v.contentType, formData.get('avatar') as Blob);
  } catch (e) {
    logger.error('perfil.avatar_no_subido', {
      userId, err: e instanceof Error ? e.message : String(e),
    });
    redirect('/admin/mi-perfil?error=avatar');
  }

  try {
    // `?t=` para reventar el caché del navegador — la ruta pública es siempre
    // la misma, así que sin esto seguiría enseñando la foto vieja.
    await guardarAvatarUrlPerfil(userId, `${publicUrl}?t=${Date.now()}`);
  } catch (e) {
    // EL CASO REAL de la 0046 sin aplicar: el objeto sube, la columna
    // `avatar_url` no existe, y la pantalla decía "Foto de perfil
    // actualizada." mientras la siguiente carga volvía al círculo con la
    // inicial.
    logger.error('perfil.avatar_no_referenciado', {
      userId, err: e instanceof Error ? e.message : String(e),
    });
    redirect('/admin/mi-perfil?error=avatar');
  }
  redirect('/admin/mi-perfil?ok=avatar');
}
