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
// AUDITORÍA 10, ALTO — AQUÍ DECÍA "SIN PAGINACIÓN: HOY SON 131 FILAS".
//
// El razonamiento era sobre el VOLUMEN, y el modo de fallo no es el volumen: es
// que PostgREST recorta a `max_rows` (1 000 por default) EN SILENCIO — no lanza,
// no loguea, simplemente devuelve menos filas. Una flota real de 30 unidades × 4
// viajes/mes × 10 comprobantes son 1 200 filas de `gasto` en el PRIMER MES: a
// partir de la fila 1 001 el contador retro se congela en 1 000 y no se mueve
// nunca más, y como la consulta tampoco llevaba `.order()`, las 1 000 que
// vuelven son las que PostgREST decida —típicamente las más viejas—, así que la
// gráfica de los últimos 7 días pinta siete ceros en un mes con actividad
// diaria. Lo mismo le pasaba a `viajesProcesados`, `costoIaUsd`, `tokensIn/Out`,
// `porFase`, `porModelo` y a las dos tendencias.
//
// Es la pantalla desde la que se fija el precio del producto, porque de ahí sale
// el costo de IA por viaje: enseñaba un negocio detenido en el mes 1 con la
// misma cara que si de verdad no hubiera pasado nada. Es textualmente lo que
// este repo ya documentó y cerró para `analytics.ts` en la ronda 8; lo que no
// viajó al archivo nuevo fue el patrón, `traerTodo`.
//
// Y ninguna consulta llevaba techo. Sin `acotada`, un Supabase degradado no
// degrada la consola: la cuelga — ninguna página de `src/app` declara
// `maxDuration`, solo el webhook, así que el techo es el default de undici,
// 300 s.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { round2 } from '@/lib/formato';
import { huellaId, redactarTexto } from '@/lib/logger';
import { traerTodo } from '@/lib/cuadra/analytics';
import { acotada } from '@/lib/cuadra/presupuesto';

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
   *  OCR/CFDI) procesadas por día, últimos 7 días — siempre las 7 fechas,
   *  con `n: 0` en las que no hubo actividad, para que la gráfica de barras
   *  no comprima una semana con un solo día real. */
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
 */
export async function getResumenNegocio(hoy: string = new Date().toISOString().slice(0, 10)): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  // `traerTodo` (analytics.ts) pagina con `.range()` hasta agotar la tabla y
  // TRADUCE el error por valor a excepción — los cuatro fallan por valor
  // (supabase-js), no lanzando, y sin ese chequeo una base caída se lee
  // "0 tenants, $0 gastados", indistinguible de que Likida de verdad no tiene
  // nada. `acotada` le pone a cada página el mismo techo que el resto del repo.
  // El `.order()` no es adorno: sin él la paginación no tiene orden estable y
  // dos páginas pueden traer la misma fila o saltarse otra.
  const [tenants, viajes, filas, gastos] = await Promise.all([
    traerTodo<{ id: string; nombre: string; plan: string }>(
      (d, h) => acotada(admin.from('tenant').select('id, nombre, plan').order('id').range(d, h), 'negocio/tenant'),
      'getResumenNegocio/tenant'),
    traerTodo<{ tenant_id: string }>(
      (d, h) => acotada(admin.from('viaje').select('id, tenant_id').order('id').range(d, h), 'negocio/viaje'),
      'getResumenNegocio/viaje'),
    traerTodo<{ tenant_id: string; fase: string; modelo: string; tokens_in: number; tokens_out: number; costo_usd: number; created_at: string }>(
      (d, h) => acotada(admin.from('llm_costo').select('tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at').order('created_at').range(d, h), 'negocio/llm_costo'),
      'getResumenNegocio/llm_costo'),
    traerTodo<{ created_at: string }>(
      (d, h) => acotada(admin.from('gasto').select('created_at').order('created_at').range(d, h), 'negocio/gasto'),
      'getResumenNegocio/gasto'),
  ]);
  const porFaseMap = new Map<string, { n: number; costoUsd: number }>();
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

    const fase = porFaseMap.get(f.fase) ?? { n: 0, costoUsd: 0 };
    fase.n += 1; fase.costoUsd += costo;
    porFaseMap.set(f.fase, fase);

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
  const porFase = [...porFaseMap.entries()]
    .map(([fase, v]) => ({ fase, n: v.n, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
  const porModelo = [...porModeloMap.entries()]
    .map(([modelo, v]) => ({ modelo, n: v.n, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
  const porDia = [...porDiaMap.entries()]
    .map(([dia, v]) => ({ dia, costoUsd: round2(v.costoUsd), tokens: v.tokens }))
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
  for (const v of viajes) {
    viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  }
  // Últimos 7 días, siempre las 7 fechas (0 donde no hubo facturas) — el
  // mismo criterio de `cortes()` de arriba, para que "hoy" sea inyectable
  // en las pruebas en vez de depender del reloj real.
  const facturasPorDiaMap = new Map<string, number>();
  for (const g of gastos) {
    const dia = g.created_at.slice(0, 10);
    facturasPorDiaMap.set(dia, (facturasPorDiaMap.get(dia) ?? 0) + 1);
  }
  const facturasPorDia = Array.from({ length: 7 }, (_, i) => {
    const dia = cortes(6 - i);
    return { dia, n: facturasPorDiaMap.get(dia) ?? 0 };
  });

  const flotas = tenants.map((t) => ({
    ...t,
    viajes: viajesPorTenant.get(t.id) ?? 0,
    costoIaUsd: round2(costoPorTenant.get(t.id) ?? 0),
  }));
  return {
    tenants: flotas.length,
    flotas,
    viajesProcesados: viajes.length,
    costoIaUsd: round2(costoIaUsd),
    tokensIn,
    tokensOut,
    porFase,
    porModelo,
    porDia,
    facturasPorDia,
    facturasTotal: gastos.length,
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
    (d, h) => acotada(admin.from('llm_costo').select('fase, modelo, costo_usd').order('created_at').range(d, h), 'negocio/costoPorFaseModelo'),
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
    .map((v) => ({ ...v, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
}

export interface TurnoConversacion { role: 'user' | 'assistant'; content: string }

export interface ConversacionActiva {
  /**
   * Seudónimo estable del operador — NUNCA su teléfono.
   *
   * El aviso integral que el operador consulta en `/aviso/[tenant]` lista, entre
   * las finalidades a las que puede oponerse, «estadísticas de uso, SIN
   * IDENTIFICARTE EN LOS REPORTES», y cierra diciendo que cualquier finalidad no
   * escrita ahí exige pedirle permiso otra vez. `/admin` pintaba
   * `+5219993700779` como título de la tarjeta, en cuatro pantallas
   * (auditoría 10, CRÍTICO de cumplimiento legal).
   *
   * Estable a propósito: dos conversaciones del mismo operador dan el mismo
   * seudónimo, así que se puede seguir un caso sin saber de quién es.
   */
  seudonimo: string;
  tenantNombre: string;
  turns: TurnoConversacion[];
  actualizadaEn: string;
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
  const { data, error } = await acotada(admin
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, tenant:tenant_id(nombre)')
    .order('updated_at', { ascending: false })
    .limit(20), 'negocio/conversaciones');
  if (error) throw new Error(`getConversacionesActivas: ${error.message}`);
  return (data ?? []).map((c) => {
    const estado = (c.estado as { turns?: TurnoConversacion[] }) ?? {};
    return {
      // La seudonimización va AQUÍ, en la capa de datos, y no en cada pantalla:
      // estas conversaciones se pintan en cuatro sitios de /admin y el layout
      // las carga en cada página. Taparlo pantalla por pantalla es cómo se
      // olvida la quinta.
      seudonimo: huellaId(c.telefono as string),
      tenantNombre: ((c.tenant as { nombre?: string } | null)?.nombre) ?? '—',
      // Y dentro del texto también: el operador teclea su propio teléfono y su
      // RFC en la conversación («soy Juan, mi tel es 5219…»). Quitar el
      // encabezado y dejar el identificador en el cuerpo no seudonimiza nada.
      // Se usa el MISMO redactor que ya filtra lo que va a Sentry, para que no
      // haya dos definiciones de «dato sensible» que puedan divergir.
      turns: Array.isArray(estado.turns)
        ? estado.turns.map((t) => ({ ...t, content: redactarTexto(String(t.content ?? '')) }))
        : [],
      actualizadaEn: c.updated_at as string,
    };
  });
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
  const data = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(admin
      .from('app_user')
      .select('id, tenant_id, rol, nombre, email, operador_id, tenant:tenant_id(nombre)')
      .order('rol', { ascending: true }).order('id').range(d, h), 'negocio/equipo'),
    'getEquipo');
  return data.map((u) => ({
    id: u.id as string,
    email: u.email as string,
    nombre: (u.nombre as string | null) ?? null,
    rol: u.rol as string,
    tenantId: (u.tenant_id as string | null) ?? null,
    tenantNombre: ((u.tenant as { nombre?: string } | null)?.nombre) ?? null,
    operadorId: (u.operador_id as string | null) ?? null,
  }));
}
