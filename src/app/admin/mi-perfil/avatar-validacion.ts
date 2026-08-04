// ═══════════════════════════════════════════════════════════════════════════
// QUÉ ES UN AVATAR VÁLIDO. LA REGLA, SEPARADA DE LA ACCIÓN QUE LA APLICA.
//
// AUDITORÍA 11 · G-33, ALTO. Esta es la PRIMERA subida de archivo del
// producto, y la única comprobación que tenía era
// `archivo instanceof File && archivo.size !== 0`. Ni tipo, ni tamaño. El
// `accept="image/*"` del uploader (`avatar-uploader.tsx:57`) es una sugerencia
// del navegador para el diálogo de archivos: no viaja en el POST, y un
// `curl -F` no lo ve nunca.
//
// El bucket `avatares` es PÚBLICO. Lo que se acepte aquí se sirve tal cual a
// cualquiera con la URL, con la cabecera `Content-Type` que se le ponga al
// subirlo — y esa cabecera salía TAL CUAL de `archivo.type`, o sea del
// cliente. La lista blanca es de tres formatos rasterizados a propósito:
//
//   · `image/svg+xml` NO entra. Un SVG es un documento XML que puede llevar
//     `<script>`, y servido desde el origen del bucket lo ejecuta ahí.
//   · `image/gif` tampoco: nada en el producto lo necesita, y cada formato
//     admitido es superficie que hay que sostener.
//
// La regla vive aquí y no dentro del archivo `'use server'` porque un módulo
// de server actions solo puede exportar funciones asíncronas: una función
// pura y síncrona —la que de verdad se quiere probar— no cabe ahí.
// ═══════════════════════════════════════════════════════════════════════════

/** MIME admitido → extensión canónica. La llave es lo que se sirve. */
export const TIPOS_AVATAR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * 4 MB. Una foto de perfil de 64 px de lado no necesita más, y el techo
 * existe porque sin él una petición ocupa memoria del server action hasta
 * que la plataforma corte — el bucket no es quien pone el límite.
 */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

export type ResultadoAvatar =
  | { ok: true; contentType: string }
  | { ok: false; motivo: 'ausente' | 'vacio' | 'tipo' | 'tamano' };

/**
 * `Blob` y no `File`: `File` extiende `Blob`, y comprobar la base evita que
 * un runtime que entregue un `Blob` sin nombre (o un realm distinto) caiga
 * en "no mandaste nada" cuando sí mandó una imagen.
 */
export function validarAvatar(archivo: unknown): ResultadoAvatar {
  if (!(archivo instanceof Blob)) return { ok: false, motivo: 'ausente' };
  if (archivo.size === 0) return { ok: false, motivo: 'vacio' };
  if (archivo.size > MAX_AVATAR_BYTES) return { ok: false, motivo: 'tamano' };
  // El `type` del cliente se usa solo para BUSCAR en la tabla; lo que se
  // devuelve es la llave de la tabla, que es una constante nuestra.
  const tipo = String(archivo.type ?? '').toLowerCase().split(';')[0].trim();
  const ext = TIPOS_AVATAR[tipo];
  if (!ext) return { ok: false, motivo: 'tipo' };
  return { ok: true, contentType: tipo };
}
