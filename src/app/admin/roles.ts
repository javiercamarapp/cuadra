import type { RolAppUser } from '@/lib/auth/provisionar';

// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE LLAMA UN ROL, EN /admin. UNA SOLA VEZ.
//
// Mismo criterio —y misma razón— que `admin/fases.ts`: el mapa estaba escrito
// dos veces (`admin/equipo/page.tsx:12` y `admin/mi-perfil/page.tsx:9`) y la
// segunda copia PERDIÓ el tipo por el camino: `Record<string, string>` en vez
// de `Record<RolAppUser, string>`. Con `string` de llave, agregar un rol al
// dominio de `app_user.rol` y olvidar etiquetarlo COMPILA, y la pantalla
// pinta la clave cruda de la base ("flota_admin") donde el resto del panel
// dice "Dueño / Admin de flota".
//
// El tipo es el guardarraíl: `Record<RolAppUser, string>` hace que ese olvido
// no compile.
// ═══════════════════════════════════════════════════════════════════════════

export const ROL_LABEL: Record<RolAppUser, string> = {
  superadmin: 'Superadmin',
  flota_admin: 'Dueño / Admin de flota',
  encargado: 'Encargado',
  contador: 'Contador',
  operador: 'Operador / Chofer',
};

/**
 * El rol que llega de la base es `string` (la columna admite lo que su
 * `check` admita, no lo que TypeScript sepa). Si un día trae uno que no está
 * en el mapa se pinta tal cual: la clave cruda es fea, pero es verdad —
 * inventarle un nombre sería peor.
 */
export function etiquetaRol(rol: string): string {
  return ROL_LABEL[rol as RolAppUser] ?? rol;
}
