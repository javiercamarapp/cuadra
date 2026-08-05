// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PANTALLAS EXISTEN PARA CADA ROL — una sola fuente, y no es el sidebar.
//
// `permisos.ts` decide qué ACCIÓN se ofrece encima de un dato que el rol ya
// puede ver (exportar, asignar, administrar). Esto decide algo distinto y
// anterior: si la PANTALLA existe siquiera para ese rol.
//
// Hacía falta porque `encargado` y `contador` entraban al mismo /dashboard
// que el dueño y veían TODO: rentabilidad, cobranza, facturación, clientes.
// El encargado es el jefe de tráfico — despacha, no factura — y enseñarle el
// margen de la flota no es un detalle de UI, es exponerle a un puesto medio
// las finanzas completas de la empresa.
//
// SE APLICA EN DOS SITIOS, Y LOS DOS HACEN FALTA:
//   1. el sidebar, para no pintar el link;
//   2. la PÁGINA, con `exigirVer()`, porque un link que no se pinta se
//      escribe a mano en la barra de direcciones. Esconder sin gatear es el
//      patrón que la 0045 ya tuvo que cerrar para el chofer: la UI lo
//      escondía, la consulta no.
//
// RLS no puede resolver esto: `tenant_data` es por TENANT, no por rol, y los
// tres roles de oficina comparten exactamente las mismas filas. Lo que
// cambia es qué se le enseña a cada quien, y eso se decide aquí.
// ═══════════════════════════════════════════════════════════════════════════

/** Las secciones en que se parte el panel, por naturaleza del dato. */
export type Area = 'operacion' | 'dinero' | 'administracion';

/**
 * Qué áreas ve cada rol del dominio de `app_user.rol` (0044).
 *
 * `operador` NO aparece: su vista es /mis-viajes con RLS propia (0045), no
 * este panel. Un rol desconocido cae al `??` de `areasDe` y no ve nada:
 * fail closed, igual que `permisos.ts`.
 */
const AREAS_POR_ROL: Record<string, readonly Area[]> = {
  superadmin: ['operacion', 'dinero', 'administracion'],
  flota_admin: ['operacion', 'dinero', 'administracion'],
  // El jefe de tráfico: despacha y da seguimiento. No ve finanzas ni toca la
  // configuración de la cuenta. Es el rol para el que existe este archivo.
  encargado: ['operacion'],
  // El contador vive del dinero y del papel. No despacha: asignarle un viaje
  // a un chofer no es su trabajo y la matriz de permisos ya se lo niega.
  contador: ['dinero'],
};

export function areasDe(rol: string): readonly Area[] {
  return AREAS_POR_ROL[rol] ?? [];
}

export function puedeVerArea(rol: string, area: Area): boolean {
  return areasDe(rol).includes(area);
}

/**
 * A qué área pertenece cada ruta de /dashboard.
 *
 * Explícito y no por prefijo a propósito: una ruta nueva que nadie clasifique
 * cae a `undefined`, y `puedeVerRuta` la niega. Es preferible que una pantalla
 * nueva no se vea a que se vea de más — el error caro es el segundo.
 */
const AREA_POR_RUTA: Record<string, Area> = {
  '/dashboard': 'operacion',

  // Operación
  '/dashboard/despacho': 'operacion',
  '/dashboard/pod': 'operacion',
  '/dashboard/incidencias': 'operacion',
  '/dashboard/unidades': 'operacion',
  '/dashboard/operadores': 'operacion',
  '/dashboard/mapa': 'operacion',
  '/dashboard/soporte': 'operacion',

  // Dinero — lo que el encargado no ve
  //
  // AUDITORÍA 11, G-26 (ALTO). Estas tres estaban en 'operacion' y las tres
  // pintan pesos de la flota, con la contradicción escrita en el propio repo:
  // `despacho/page.tsx:36-39` declara de este mismo rol «NO hay una sola cifra
  // de dinero en esta pantalla, y no es un descuido», y el link de al lado en
  // su sidebar listaba el anticipo de cada viaje y lo sumaba en un KPI.
  //   · viajes     → "Anticipo en viajes abiertos" + columna Anticipo por viaje
  //   · analitica  → "Gasto por concepto · Todo el histórico de la flota"
  //   · documentos → monto por comprobante
  // El jefe de tráfico conserva su trabajo en Despacho, POD, Incidencias,
  // Unidades y el Inicio de operación (`inicio-operacion.tsx`), que existe
  // exactamente para esto. `visibilidad_dinero.test.ts` ata esta tabla a lo
  // que las páginas RENDERIZAN, para que no vuelvan a divergir.
  '/dashboard/viajes': 'dinero',
  '/dashboard/analitica': 'dinero',
  '/dashboard/documentos': 'dinero',
  // AUDITORÍA 11, PASE 2, A11P2-C2 (CRÍTICO). Estaba en 'operacion'. Es la
  // MISMA caja que el rail del Asistente —`chat/page.tsx:43` pide `getKpis` y
  // `getAcreditables` y se los pasa a `<ChatFlota>`— a pantalla completa: el
  // arreglo `2fb1982` cerró la ventana y esta puerta se quedó abierta, con su
  // link en el sidebar del encargado. `visibilidad_dinero.test.ts` no lo cazó
  // porque busca `mxn(` dentro del `page.tsx` y aquí el formateo vive en
  // `chat.tsx`; `visibilidad_chat.test.ts` persigue el DATO en vez del render.
  // Y estaba mal en los dos sentidos: al contador, que vive del dinero, esta
  // tabla le negaba el chat.
  '/dashboard/chat': 'dinero',
  '/dashboard/valor-ahorro': 'dinero',
  '/dashboard/rentabilidad': 'dinero',
  '/dashboard/clientes': 'dinero',
  '/dashboard/combustible-casetas': 'dinero',
  '/dashboard/cotizador': 'dinero',
  '/dashboard/cuadre': 'dinero',
  '/dashboard/facturacion': 'dinero',
  '/dashboard/cobranza': 'dinero',

  // Administración de la cuenta — solo el dueño
  '/dashboard/usuarios': 'administracion',
  '/dashboard/politicas': 'administracion',
  '/dashboard/configuracion': 'administracion',
};

export function areaDeRuta(href: string): Area | undefined {
  return AREA_POR_RUTA[href];
}

export function puedeVerRuta(rol: string, href: string): boolean {
  const area = areaDeRuta(href);
  return area !== undefined && puedeVerArea(rol, area);
}

/**
 * A dónde mandar a un rol que no puede ver donde está parado.
 *
 * No es `/dashboard` fijo: para el contador, `/dashboard` es de operación y
 * lo rebotaría otra vez — un bucle de redirects, que es peor que la fuga que
 * se quería evitar.
 */
/** Los roles que un superadmin puede PREVISUALIZAR con `?rol=`. */
const PREVISUALIZABLES = new Set(['flota_admin', 'encargado', 'contador']);

/**
 * Qué rol manda para decidir visibilidad — el de la sesión, salvo que un
 * superadmin esté mirando el panel "como" otro.
 *
 * Existe porque los tres roles de oficina comparten la MISMA URL: no había
 * forma de comparar qué ve el dueño contra qué ve el jefe de tráfico sin
 * tener la contraseña de los dos. Y las cuentas de prueba nunca recibieron
 * su magic link (el remitente sandbox de Resend rechaza los alias).
 *
 * SOLO PUEDE QUITAR, NUNCA DAR. Se honra únicamente si el rol REAL de la
 * sesión es superadmin —que ya ve las tres áreas—, así que el resultado es
 * siempre un subconjunto de lo que esa sesión podía ver. Para cualquier otro
 * rol el parámetro se ignora en silencio: si se honrara, `?rol=flota_admin`
 * en la barra de direcciones sería una escalada de privilegios de un solo
 * teclazo.
 */
export function rolEfectivo(rolReal: string, rolPedido?: string | null): string {
  if (rolReal !== 'superadmin') return rolReal;
  if (!rolPedido || !PREVISUALIZABLES.has(rolPedido)) return rolReal;
  return rolPedido;
}

export function inicioDe(rol: string): string {
  if (puedeVerArea(rol, 'operacion')) return '/dashboard';
  if (puedeVerArea(rol, 'dinero')) return '/dashboard/cuadre';
  return '/sin-acceso';
}
