/**
 * El `?tenant=`/`?vista=demo` que hay que arrastrar en CADA link interno de
 * /dashboard cuando un superadmin está viendo la flota de un cliente — si un
 * link lo pierde, el siguiente clic te devuelve al tenant demo sin avisar,
 * viendo cifras de otra empresa bajo el mismo encabezado.
 *
 * Y el `?rol=` de "Ver como", por la MISMA razón y con peor desenlace: el rol
 * previsualizado decide qué puede hacer la página (`rolEfectivo`), así que un
 * link que lo pierde devuelve la sesión a los privilegios reales de superadmin
 * mientras el sidebar de esa misma pantalla —que sí lo arrastraba— sigue
 * filtrado. Media pantalla previsualiza y media no (auditoría 11, G-47).
 *
 * El sidebar tiene su propia copia de esta lógica (`sidebar-nav.tsx`) porque
 * ahí es un Client Component que lee `useSearchParams()`; aquí es para las
 * páginas server, que reciben `searchParams` como prop. Misma regla, dos
 * fuentes de entrada — y ahora sí las dos conocen los tres parámetros.
 */
export interface SearchParamsPanel {
  vista?: string;
  tenant?: string;
  rango?: string;
  /** "Ver como": el rol que un superadmin está previsualizando. */
  rol?: string;
}

export function sufijoTenant(sp: SearchParamsPanel | undefined): string {
  const params = new URLSearchParams();
  if (sp?.tenant) params.set('tenant', sp.tenant);
  else if (sp?.vista) params.set('vista', sp.vista);
  if (sp?.rol) params.set('rol', sp.rol);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
