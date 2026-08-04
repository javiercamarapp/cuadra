// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN DE NEGOCIO — la consola de superadmin, no el panel de una flota.
//
// Cruza TODOS los tenants a propósito: es la única función del repo con
// permiso de ver toda la base a la vez. `usd()` (formato.ts) ya lo advierte
// en su propio comentario — "nunca para el cliente" — y esta es la primera
// pantalla que de verdad lo pinta: costo de IA en dólares, por fase, de
// Likida completa. Vive fuera de analytics.ts (tenant-scoped en cada línea)
// para que nadie copie un patrón de aquí a una consulta de cliente y filtre
// de menos.
//
// ── AUDITORÍA 11 · G-40, ALTO: «NO ANTES» YA LLEGÓ ─────────────────────────
//
// Aquí decía: «sin paginación: hoy son 131 filas de llm_costo y 1 tenant. El
// día que crezca de verdad, esto necesita el mismo `traerTodo` que ya usa
// analytics.ts — no antes.» El día llegó antes que el crecimiento: cada
// liquidación escribe ~19 filas de `llm_costo`, así que la tabla cruza el
// `max_rows` de PostgREST (1,000, recortado EN SILENCIO) alrededor de la
// liquidación #46 — y esta función corre en el LAYOUT, o sea en las ~30
// páginas de /admin.
//
// Sin `.order()` el recorte además es arbitrario: PostgREST entrega el primer
// bloque del plan, que para una tabla append-only son las filas MÁS VIEJAS.
// `porDia` se queda sin días recientes, `tendencia()` devuelve `null` y la
// flecha DESAPARECE en vez de gritar — el modo de fallo que `costos.ts:5-13`
// llama el peligroso: «bajó sola y nadie lo notó».
//
// Y el redondeo: `round2` es la regla de los PESOS de un CFDI (la unidad más
// chica que existe ahí es el centavo). Un dólar de costo de modelo no tiene
// unidad más chica, tiene un precio por token: una llamada de OCR cuesta
// $0.0027 y `round2` la pintaba «$0.00 · 1 llamadas» en Model Ops, que es la
// pantalla que existe para responder «¿me sale más barato Gemini o Haiku?».
// La regla correcta ya estaba escrita y bautizada: `redondearUsd` (costos.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo } from '@/lib/cuadra/pg';
import { agregarPorFase, redondearUsd } from '@/lib/cuadra/costos';
// `round2` sigue aquí para UNA cosa: el PORCENTAJE de la tendencia. Un
// porcentaje sí tiene dos decimales; los dólares de costo de modelo, no.
import { round2 } from '@/lib/formato';

export interface ResumenNegocio {
  tenants: number;
  flotas: Array<{ id: string; nombre: string; plan: string; viajes: number; costoIaUsd: number }>;
  viajesProcesados: number;
  costoIaUsd: number;
  tokensIn: number;
  tokensOut: number;
  porFase: Array<{ fase: string; n: number; costoUsd: number }>;
  porModelo: Array<{ modelo: string; n: number; costoUsd: number }>;
  porDia: Array<{ dia: string; costoUsd: number; tokens: number }>;
  /** Facturas (filas de `gasto` — cada una es un comprobante que pasó por
   *  OCR/CFDI) procesadas por día, ventana de `ventanaDias` (default 7) —
   *  siempre TODAS las fechas de la ventana, con `n: 0` en las que no hubo
   *  actividad, para que la gráfica de barras no comprima el periodo a un
   *  solo día real. */
  facturasPorDia: Array<{ dia: string; n: number }>;
  /** Total histórico de facturas (todas las filas de `gasto`, sin filtro
   *  de fecha) — para el contador retro junto al saludo. */
  facturasTotal: number;
  /** % de cambio de los últimos 7 días vs los 7 anteriores — `null` sin
   *  suficiente historia (menos de 14 días con datos) para no inventar una
   *  tendencia de dos puntos. */
  tendenciaCosto: number | null;
  tendenciaTokens: number | null;
}

/**
 * `hoy` es inyectable (default: fecha real) — mismo criterio que
 * `cuadrarViaje({ hoy })` en el motor: una prueba de tendencia no puede
 * depender del reloj del sistema el día que corra.
 *
 * `ventanaDias` (default 7) es lo que mueve el `<GlobalFilter>` de Inicio
 * (7d/30d) — solo afecta `facturasPorDia`; el resto de los números
 * (costoIaUsd, tendencias, etc.) son totales o comparativos de 7 días fijos
 * a propósito, no se re-derivan por ventana todavía.
 */
export async function getResumenNegocio(
  hoy: string = new Date().toISOString().slice(0, 10),
  ventanaDias: number = 7,
): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  // `traerTodo` (pg.ts) hace las dos cosas a la vez y por eso se usa en vez de
  // repetir el `if (res.error)` de antes: pagina con `.range()` hasta agotar
  // la tabla, y traduce el error POR VALOR de supabase-js a una excepción
  // (`exigir`). Sin lo segundo, una base caída se lee "0 tenants, $0
  // gastados" — indistinguible de que Likida de verdad no tiene nada, el
  // mismo error que ya se cerró para el panel de una flota (analytics.ts).
  //
  // El `.order()` NO es cosmético: es lo que hace que "la página 2" signifique
  // algo. Sin él, dos peticiones al mismo rango pueden devolver filas
  // distintas y la suma sale mal en silencio.
  const [tenantsData, viajesData, filas, gastosData] = await Promise.all([
    traerTodo<{ id: string; nombre: string; plan: string }>(
      (d, h) => admin.from('tenant').select('id, nombre, plan').order('id', { ascending: true }).range(d, h),
      'getResumenNegocio/tenant'),
    traerTodo<{ tenant_id: string }>(
      (d, h) => admin.from('viaje').select('id, tenant_id').order('id', { ascending: true }).range(d, h),
      'getResumenNegocio/viaje'),
    traerTodo<{ tenant_id: string; fase: string; modelo: string; tokens_in: number; tokens_out: number; costo_usd: number; created_at: string }>(
      (d, h) => admin.from('llm_costo')
        .select('tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at')
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(d, h),
      'getResumenNegocio/llm_costo'),
    traerTodo<{ created_at: string }>(
      (d, h) => admin.from('gasto').select('created_at').order('created_at', { ascending: true }).range(d, h),
      'getResumenNegocio/gasto'),
  ]);
  const porModeloMap = new Map<string, { n: number; costoUsd: number }>();
  const porDiaMap = new Map<string, { costoUsd: number; tokens: number }>();
  const costoPorTenant = new Map<string, number>();
  let costoIaUsd = 0, tokensIn = 0, tokensOut = 0;
  for (const f of filas) {
    costoPorTenant.set(f.tenant_id, (costoPorTenant.get(f.tenant_id) ?? 0) + Number(f.costo_usd));
    const costo = Number(f.costo_usd);
    const tokens = Number(f.tokens_in) + Number(f.tokens_out);
    costoIaUsd += costo;
    tokensIn += Number(f.tokens_in);
    tokensOut += Number(f.tokens_out);

    const modelo = porModeloMap.get(f.modelo) ?? { n: 0, costoUsd: 0 };
    modelo.n += 1; modelo.costoUsd += costo;
    porModeloMap.set(f.modelo, modelo);

    // `created_at` es UTC; el corte por día aquí es aproximado a propósito
    // (no es un dato fiscal, es una gráfica de tendencia) — el mismo criterio
    // fino de `fechaMx` sería trabajo de más para una vista que solo enseña
    // si el gasto sube o baja semana a semana.
    const dia = f.created_at.slice(0, 10);
    const d = porDiaMap.get(dia) ?? { costoUsd: 0, tokens: 0 };
    d.costoUsd += costo; d.tokens += tokens;
    porDiaMap.set(dia, d);
  }
  // `agregarPorFase` vive en costos.ts a propósito (BAJO de la auditoría 10):
  // había DOS agregadores de `llm_costo` por fase, con distinto redondeo y
  // distinto contrato de error, y este archivo era el que alimentaba la única
  // pantalla que enseña costo. Ahora los dos pasan por el mismo.
  const porFase = agregarPorFase(filas);
  const porModelo = [...porModeloMap.entries()]
    .map(([modelo, v]) => ({ modelo, n: v.n, costoUsd: redondearUsd(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
  const porDia = [...porDiaMap.entries()]
    .map(([dia, v]) => ({ dia, costoUsd: redondearUsd(v.costoUsd), tokens: v.tokens }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  // Tendencia real, no de adorno: si la ventana ANTERIOR está vacía (Likida
  // lleva menos de 7 días con actividad), "creció ∞%" no dice nada — se
  // calla en vez de inventar una flecha.
  const cortes = (diasAtras: number) => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
  };
  const [inicioActual, inicioAnterior] = [cortes(7), cortes(14)];
  const sumaEnVentana = (desde: string, hasta: string, campo: 'costoUsd' | 'tokens') =>
    porDia.filter((d) => d.dia >= desde && d.dia < hasta).reduce((s, d) => s + d[campo], 0);
  const tendencia = (campo: 'costoUsd' | 'tokens'): number | null => {
    const actual = sumaEnVentana(inicioActual, cortes(0), campo);
    const anterior = sumaEnVentana(inicioAnterior, inicioActual, campo);
    if (anterior === 0) return null;
    return round2(((actual - anterior) / anterior) * 100);
  };

  const viajesPorTenant = new Map<string, number>();
  for (const v of viajesData) {
    viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  }
  // Últimos 7 días, siempre las 7 fechas (0 donde no hubo facturas) — el
  // mismo criterio de `cortes()` de arriba, para que "hoy" sea inyectable
  // en las pruebas en vez de depender del reloj real.
  const facturasPorDiaMap = new Map<string, number>();
  for (const g of gastosData) {
    const dia = g.created_at.slice(0, 10);
    facturasPorDiaMap.set(dia, (facturasPorDiaMap.get(dia) ?? 0) + 1);
  }
  const facturasPorDia = Array.from({ length: ventanaDias }, (_, i) => {
    const dia = cortes(ventanaDias - 1 - i);
    return { dia, n: facturasPorDiaMap.get(dia) ?? 0 };
  });

  const flotas = tenantsData.map((t) => ({
    ...t,
    viajes: viajesPorTenant.get(t.id) ?? 0,
    costoIaUsd: redondearUsd(costoPorTenant.get(t.id) ?? 0),
  }));
  return {
    tenants: flotas.length,
    flotas,
    viajesProcesados: viajesData.length,
    costoIaUsd: redondearUsd(costoIaUsd),
    tokensIn,
    tokensOut,
    porFase,
    porModelo,
    porDia,
    facturasPorDia,
    facturasTotal: gastosData.length,
    tendenciaCosto: tendencia('costoUsd'),
    tendenciaTokens: tendencia('tokens'),
  };
}

export interface CostoPorFaseModelo { fase: string; modelo: string; n: number; costoUsd: number }

/**
 * `llm_costo` agrupado por fase Y modelo A LA VEZ (no cada uno por separado
 * como en `getResumenNegocio`) — para Model Ops y Agente OCR, que necesitan
 * saber qué modelo corrió DENTRO de una fase específica (p. ej. "¿qué costó
 * OCR, desglosado por modelo?"), algo que `porFase`/`porModelo` no pueden
 * responder solos porque cada uno agrupa por un solo eje. Mismo dato real
 * de siempre, solo agrupado más fino — nada nuevo que instrumentar.
 */
export async function getCostoPorFaseModelo(): Promise<CostoPorFaseModelo[]> {
  const admin = supabaseAdmin();
  const data = await traerTodo<{ fase: string; modelo: string; costo_usd: number }>(
    (d, h) => admin.from('llm_costo').select('fase, modelo, costo_usd').order('id', { ascending: true }).range(d, h),
    'getCostoPorFaseModelo');
  const map = new Map<string, { fase: string; modelo: string; n: number; costoUsd: number }>();
  for (const f of data) {
    const key = `${f.fase}::${f.modelo}`;
    const cur = map.get(key) ?? { fase: f.fase, modelo: f.modelo, n: 0, costoUsd: 0 };
    cur.n += 1;
    cur.costoUsd += Number(f.costo_usd);
    map.set(key, cur);
  }
  return [...map.values()]
    .map((v) => ({ ...v, costoUsd: redondearUsd(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
}

export interface TurnoConversacion { role: 'user' | 'assistant'; content: string }

export interface ConversacionActiva {
  /** NUNCA el teléfono. Ver `seudonimoOperador`. */
  seudonimo: string;
  tenantNombre: string;
  turns: TurnoConversacion[];
  actualizadaEn: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-53, CRÍTICO — LA CONSOLA NO IDENTIFICA A NADIE.
//
// `getConversacionesActivas` devolvía `telefono` y los `turns` íntegros, sin
// un solo `.eq('tenant_id', …)`, y `admin/layout.tsx:42` la llama en CADA
// carga de CUALQUIER página de /admin. Cinco pantallas pintaban el número; en
// `conversaciones/page.tsx` la etiqueta de cada barra de un `HBars` ERA el
// teléfono del operador, encima de dos KPI de uso.
//
// Contra el texto que el operador abre y acepta (`privacidad.ts:511-512`):
// «Medir cómo funciona el servicio para mejorarlo (estadísticas de uso, SIN
// IDENTIFICARTE EN LOS REPORTES)». Abrir /admin y /aviso/[tenant] en la misma
// sesión del demo desmentía una con la otra a un clic.
//
// QUÉ NO HACE ESTO. El dato real no se borra: sigue en `wa_conversacion`, que
// es donde tiene que estar y donde el procedimiento ARCO lo alcanza. Lo que
// cambia es lo que sale HACIA LA PANTALLA DE ESTADÍSTICAS, que es la
// finalidad que el aviso acota.
//
// Y LO QUE ESTO NO ES: no es anonimización irreversible. La sal es una
// constante del código, y el espacio de teléfonos mexicanos es chico: quien
// tenga el repo y una lista de números puede reconstruir la tabla. Sirve para
// que la consola no EXHIBA el número —que es el hallazgo— y para que dos
// barras del mismo operador se agrupen. Decirlo aquí es parte del arreglo:
// una medida que se cree más fuerte de lo que es acaba justificando enseñar
// más de lo debido.
// ═══════════════════════════════════════════════════════════════════════════

/** Solo los dígitos: `+52 999 370 07 79` y `529993700779` son la misma persona. */
function normalizarTelefono(telefono: string): string {
  return String(telefono ?? '').replace(/\D/g, '');
}

const SAL_SEUDONIMO = 'likida/admin/conversaciones/v1';

/** Etiqueta estable y legible («Operador 4F2A») — va en el eje de una gráfica. */
export function seudonimoOperador(telefono: string): string {
  const h = createHash('sha256').update(`${SAL_SEUDONIMO}:${normalizarTelefono(telefono)}`).digest('hex');
  // 20 bits en base 36 y en mayúsculas: 4 caracteres, ~1M de combinaciones.
  // Con decenas de operadores la colisión es anecdótica, y una etiqueta de 4
  // caracteres se lee en una barra; un hash de 64 no.
  const corto = parseInt(h.slice(0, 8), 16).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  return `Operador ${corto}`;
}

// Lo que un mensaje de WhatsApp puede traer dentro y no tiene por qué salir a
// una pantalla de estadísticas. El orden importa: el correo primero, porque
// su parte local puede contener dígitos que la regla del teléfono partiría.
const REDACCIONES: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '«correo»'],
  // RFC de persona física (4 letras) o moral (3), con homoclave.
  [/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, '«RFC»'],
  // CURP: 18 posiciones con estructura fija.
  [/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g, '«CURP»'],
  // 10 dígitos o más seguidos (con separadores) es un teléfono, no un monto:
  // los importes de este producto no pasan de 7 cifras y llevan decimales.
  [/(?:\+?\d[\s-]?){10,}/g, '«teléfono»'],
];

/** Tapa identificadores dentro del texto de un turno. */
export function redactarTexto(texto: string): string {
  let t = String(texto ?? '');
  for (const [re, marca] of REDACCIONES) t = t.replace(re, marca);
  return t;
}

/**
 * CORRECCIÓN (2-ago-2026, tras verla mal renderizada): `wa_conversacion.
 * estado` SÍ trae el historial de mensajes — `{ turns: ConvTurn[] }`, la
 * misma forma que `conv.ts` (`loadConversation`/`saveConversation`) lee y
 * escribe, acotada a `MAX_TURNS` recientes. El comentario anterior de esta
 * función decía que Likida "no guarda el texto de la conversación" — estaba
 * mal: sí lo guarda, solo que en una ventana rodante, no para siempre.
 */
export async function getConversacionesActivas(): Promise<ConversacionActiva[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, tenant:tenant_id(nombre)')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getConversacionesActivas: ${error.message}`);
  return (data ?? []).map((c) => {
    const estado = (c.estado as { turns?: TurnoConversacion[] }) ?? {};
    const turns = Array.isArray(estado.turns) ? estado.turns : [];
    return {
      // El teléfono se convierte AQUÍ, en el borde: si saliera del módulo
      // aunque fuera una vez, la siguiente pantalla lo pintaría.
      seudonimo: seudonimoOperador(c.telefono as string),
      tenantNombre: ((c.tenant as { nombre?: string } | null)?.nombre) ?? '—',
      turns: turns.map((t) => ({ role: t.role, content: redactarTexto(t.content) })),
      actualizadaEn: c.updated_at as string,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PERFIL DEL PROPIO SUPERADMIN — las tres escrituras de /admin/mi-perfil.
//
// AUDITORÍA 11 · G-33. Vivían dentro de `admin/mi-perfil/page.tsx` con su
// propio `supabaseAdmin()` (tres veces) y sin comprobar un solo `error`.
// Están aquí por lo mismo que todo lo demás de este archivo: `/admin` no
// habla con Supabase, habla con este módulo. Un solo sitio donde el error
// por valor se convierte en excepción es lo que hace que el llamador no
// pueda ignorarlo por descuido.
// ═══════════════════════════════════════════════════════════════════════════

export async function guardarNombrePerfil(userId: string, nombre: string): Promise<void> {
  const { error } = await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);
  if (error) throw new Error(`guardarNombrePerfil: ${error.message}`);
}

export async function guardarAvatarUrlPerfil(userId: string, avatarUrl: string): Promise<void> {
  const { error } = await supabaseAdmin().from('app_user').update({ avatar_url: avatarUrl }).eq('id', userId);
  if (error) throw new Error(`guardarAvatarUrlPerfil: ${error.message}`);
}

/**
 * Sube el objeto al bucket `avatares` y devuelve su URL pública.
 *
 * `contentType` lo elige el LLAMADOR de su propia lista blanca
 * (`avatar-validacion.ts`), nunca el `archivo.type` que mandó el cliente: el
 * bucket es público y esa cabecera es con la que se sirve.
 */
export async function subirAvatarPerfil(
  userId: string, ruta: string, contentType: string, archivo: Blob,
): Promise<string> {
  const admin = supabaseAdmin();
  const { error } = await admin.storage.from('avatares')
    .upload(ruta, archivo, { upsert: true, contentType });
  if (error) throw new Error(`subirAvatarPerfil(${userId}): ${error.message}`);
  const { data } = admin.storage.from('avatares').getPublicUrl(ruta);
  if (!data?.publicUrl) throw new Error(`subirAvatarPerfil(${userId}): el bucket no devolvió URL pública`);
  return data.publicUrl;
}

/** El correo de la cuenta, para pintarlo (no editable desde aquí). */
export async function getCorreoPerfil(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('app_user').select('email').eq('id', userId).maybeSingle();
  if (error) throw new Error(`getCorreoPerfil: ${error.message}`);
  return (data?.email as string | null) ?? null;
}

export interface MiembroEquipo {
  id: string;
  email: string;
  nombre: string | null;
  rol: string;
  tenantId: string | null;
  tenantNombre: string | null;
  operadorId: string | null;
}

/**
 * Roster real de `app_user` para la página Equipo/RBAC — mismo patrón de
 * error que el resto del archivo (falla por valor, se revisa `.error` a
 * mano). `tenant_id` es nullable (superadmin no pertenece a ninguna flota,
 * 0001_init.sql:21), así que el join a `tenant` viene NULL en esas filas —
 * no un error, un superadmin de verdad no tiene flota.
 */
export async function getEquipo(): Promise<MiembroEquipo[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('app_user')
    .select('id, tenant_id, rol, nombre, email, operador_id, tenant:tenant_id(nombre)')
    .order('rol', { ascending: true });
  if (error) throw new Error(`getEquipo: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    email: u.email as string,
    nombre: (u.nombre as string | null) ?? null,
    rol: u.rol as string,
    tenantId: (u.tenant_id as string | null) ?? null,
    tenantNombre: ((u.tenant as { nombre?: string } | null)?.nombre) ?? null,
    operadorId: (u.operador_id as string | null) ?? null,
  }));
}
