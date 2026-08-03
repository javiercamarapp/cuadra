// ═══════════════════════════════════════════════════════════════════════════
// PERMISOS DE NIVEL APLICACIÓN — separados de RLS a propósito.
//
// RLS ya NO es solo por tenant. Esta cabecera decía que «cualquier app_user de
// un tenant tiene lectura+escritura completa sobre las 7 tablas» y que eso era
// «correcto para flota_admin/encargado/contador». Lo segundo era falso y costó
// un ALTO: la consola ofrece el rol como «Contador — solo lectura y exportar»,
// y la base le daba DELETE. Hoy el reparto en la base es:
//   · superadmin / flota_admin / encargado → lectura + escritura (tenant_data)
//   · contador                             → SOLO lectura (0048, contador_lee)
//   · operador (chofer)                    → SOLO sus propios viajes (0045+0047)
// Estas funciones deciden qué ACCIÓN se ofrece encima de esos datos:
// qué botón se pinta y qué endpoint acepta la petición. Un rol desconocido
// nunca puede: fail closed, no fail open.
//
// El chofer (`operador`) NO pasa por aquí — su vista es /mis-viajes con RLS
// propia (docs/superpowers/plans/2026-08-02-roles-flota.md, Task 4), no el
// panel de flota_admin/encargado/contador.
// ═══════════════════════════════════════════════════════════════════════════

const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
const ASIGNA = new Set(['superadmin', 'flota_admin', 'encargado']);
const ADMINISTRA = new Set(['superadmin', 'flota_admin']);

export function puedeExportar(rol: string): boolean {
  return EXPORTA.has(rol);
}

export function puedeAsignar(rol: string): boolean {
  return ASIGNA.has(rol);
}

export function puedeAdministrar(rol: string): boolean {
  return ADMINISTRA.has(rol);
}
