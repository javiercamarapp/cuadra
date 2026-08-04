// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA PANTALLA DICE CUANDO ALGO NO SE GUARDÓ.
//
// AUDITORÍA 11 · G-33. Antes había dos mensajes para cinco resultados
// distintos ("No se pudo subir la foto — intenta con otra imagen." para todo
// lo del avatar), así que un archivo de 9 MB y un `.svg` y un bucket caído se
// leían igual, y el consejo —"intenta con otra imagen"— era el equivocado en
// dos de los tres casos.
//
// Cada motivo dice QUÉ pasó y QUÉ hacer. Las llaves son exactamente los
// `?error=` que `acciones.ts` emite.
// ═══════════════════════════════════════════════════════════════════════════

import { MAX_AVATAR_BYTES, TIPOS_AVATAR } from './avatar-validacion';

const MB = Math.round(MAX_AVATAR_BYTES / (1024 * 1024));
const FORMATOS = Object.values(TIPOS_AVATAR).map((e) => e.toUpperCase()).join(', ');

export const MENSAJE_ERROR: Record<string, string> = {
  nombre: 'El nombre no puede quedar vacío.',
  nombre_guardar: 'No se pudo guardar el nombre. Quedó registrado el fallo — vuelve a intentar.',
  avatar: 'No se pudo guardar la foto. Quedó registrado el fallo — vuelve a intentar.',
  avatar_ausente: 'No llegó ningún archivo. Elige una imagen y vuelve a intentar.',
  avatar_vacio: 'El archivo llegó vacío. Elige una imagen y vuelve a intentar.',
  avatar_tipo: `Ese formato no se admite. Usa ${FORMATOS}.`,
  avatar_tamano: `La imagen pesa más de ${MB} MB. Usa una más chica.`,
};
