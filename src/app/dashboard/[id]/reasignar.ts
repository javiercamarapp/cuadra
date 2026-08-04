'use server';

// ═══════════════════════════════════════════════════════════════════════════
// REASIGNAR EL CHOFER DE UN VIAJE — la segunda comprobación de permiso, en un
// archivo que se puede importar y correr.
//
// AUDITORÍA 10 · ALTO (pruebas). `permisos.ts` estaba probado como función
// pura (`permisos.test.ts`, 6 casos con fail-closed) y NUNCA como cableado. El
// auditor cambió esta línea a `if (false && !puedeAsignar(r)) redirect(...)` y
// quitó los dos `puedeExportar(rol) &&` de la UI: la suite completa quedó
// verde. Con esa mutación un `contador` de la flota —que la matriz de roles
// dice que no puede— arma el POST a mano con la misma sesión válida, sin
// botón, y reasigna el viaje de Juan Pérez a Ana Ruiz: el PDF y el CSV de esa
// liquidación pasan a atribuirle el anticipo al chofer equivocado.
//
// El cuerpo es el que estaba dentro de `page.tsx`, línea por línea. Sale aquí
// por la misma razón que los actions de `/login`: un action declarado dentro
// del componente no se puede importar, y lo que no se puede importar solo se
// puede "probar" leyendo su texto — el idioma que esta ronda documentó como
// insuficiente. `page.tsx` conserva su envoltorio de una línea, así que el
// `<form action={…}>` y lo que viaja por el cable no cambian.
// ═══════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { reasignarOperador } from '@/lib/cuadra/repo';

export async function reasignarChofer(liquidacionId: string, viajeId: string, formData: FormData) {
  // Repite la comprobación de permiso EN el server action: el `puedeAsignar`
  // de `page.tsx` solo decide si el <form> se pinta. Sin este segundo chequeo,
  // un contador que arme la petición a mano (misma sesión válida, sin el
  // botón) podría reasignar igual — el mismo criterio que ya usa
  // `requireSessionTenant` para no confiar solo en lo que el proxy filtra.
  const { tenantId: t, rol: r } = await requireSessionTenant(`/dashboard/${liquidacionId}`);
  if (!puedeAsignar(r)) redirect(`/dashboard/${liquidacionId}`);
  const operadorId = String(formData.get('operadorId') ?? '');
  if (!operadorId) redirect(`/dashboard/${liquidacionId}`);
  await reasignarOperador(t, viajeId, operadorId);
  redirect(`/dashboard/${liquidacionId}`);
}
