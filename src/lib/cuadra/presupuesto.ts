import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO DE UNA INVOCACIÓN.
//
// El webhook responde 200 de inmediato y hace el trabajo en `after()`. Meta ya
// recibió su acuse, así que NO reintenta nunca. Si Vercel mata la función al
// llegar a `maxDuration`, el trabajo se pierde EN SILENCIO: el operador no
// recibe nada, no hay reintento, y el único rastro es que el mensaje nunca llegó.
//
// Encima las etapas se comían el presupuesto a ciegas. La barrera de intake
// espera hasta 20s y el mutex hasta 12s, cada una con su tope fijo, sin saber
// que comparten los 60s con el agente —que es la parte cara—. En el peor caso
// son 32s consumidos antes de empezar a pensar.
//
// Esto no acorta ningún timeout: le da a todas las etapas el mismo reloj, para
// que la que llega tarde pida menos en vez de pedir lo mismo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TECHO DURO DE UNA CONSULTA A SUPABASE. Lo impone `repo.ts` en cada llamada.
 *
 * Va al principio del archivo porque `PASOS_CIERRE` —la tabla de techos del
 * cierre, más abajo— lo usa al construirse.
 *
 * `supabaseAdmin()` construye el cliente sin `fetch` propio, así que hasta aquí
 * NINGUNA consulta ni RPC del sistema llevaba señal de aborto. El default del
 * `fetch` global de Node (undici) es `headersTimeout`/`bodyTimeout` de 300 000
 * ms: un socket aceptado que no contesta bloquea 300s. Medido en esta máquina
 * contra un servidor que acepta y calla, `fetch` seguía bloqueado a los 20s sin
 * el menor síntoma.
 *
 * Vercel mata la función a los 120s (`route.ts:27`), o sea 180s ANTES de que ese
 * fetch se rinda. Y morir así es el peor final posible: la liquidación ya quedó
 * escrita en la base, el operador no recibe ni resumen ni PDF, el
 * `logger.error('pdf.no_entregado')` tampoco se escribe porque el proceso muere
 * antes del `catch`, y Meta —que recibió su 200 en `route.ts:78`— no reintenta.
 *
 * ¿Por qué 8s y no menos? Una consulta de este sistema cuesta ~0.3s en la
 * contabilidad de arriba, así que 8s son 26× lo típico: ninguna consulta sana lo
 * toca ni con un p99 diez veces peor. Y ¿por qué no más? Porque el peor caso
 * sumado de la ruta son ~90.8s contra 120: cada consulta colgada gasta
 * `TOPE − 0.3`s de esa holgura, y con 8s la invocación sobrevive a TRES colgadas
 * antes de tocar el límite. Con el default de undici no sobrevive a una.
 *
 * Se puede subir por entorno sin desplegar (`CUADRA_TOPE_CONSULTA_MS`): la
 * latencia real Vercel ↔ Supabase no está medida, y si resulta peor que la
 * documentada hay que poder aflojarlo desde el panel y no desde un commit.
 */
export const TOPE_CONSULTA_MS = Number(process.env.CUADRA_TOPE_CONSULTA_MS) || 8_000;

/** Margen sobre el tope antes de que dispare la red de seguridad. */
const GRACIA_TOPE_MS = 1_500;

/**
 * TECHO DE UN PASO DE RED DEL CIERRE QUE VA A SUPABASE.
 *
 * No es el costo típico (0.3 s): es lo que ese paso puede tardar como MÁXIMO sin
 * que nada lo interrumpa, y lo fija este mismo archivo:
 * `TOPE_CONSULTA_MS` + `GRACIA_TOPE_MS`.
 *
 * Se define como función porque `TOPE_CONSULTA_MS` se lee de entorno: si alguien
 * lo afloja desde el panel, el techo del cierre tiene que moverse con él y no
 * quedarse en un literal viejo.
 */
export function techoPasoSupabaseMs(): number { return TOPE_CONSULTA_MS + GRACIA_TOPE_MS; }

/**
 * TECHO DE UN ENVÍO A META (`sendText` / `sendDocument`).
 *
 * Es `SEND_TIMEOUT_MS` de `src/lib/meta/client.ts:17`. Está copiado y no
 * importado a propósito —importar `meta/client` desde aquí arrastraría el
 * cliente entero y su lectura de entorno a un módulo que solo hace aritmética—,
 * así que `presupuesto.test.ts` lee aquel archivo y falla si los dos se
 * separan. Mismo mecanismo que ya sincroniza `PRESUPUESTO_WEBHOOK_MS` con el
 * `maxDuration` de la ruta.
 */
export const TECHO_ENVIO_META_MS = 10_000;

/**
 * LOS PASOS DE RED DEL CIERRE, UNO POR UNO — CON SU TECHO, NO SOLO SU PROMEDIO.
 *
 * Esto era un comentario, y el comentario mentía: enumeraba SEIS pasos y sumaba
 * "~7s en un día malo". Contados contra `processor.ts` después de que `runAgent`
 * devuelve, son TRECE viajes de red secuenciales.
 *
 * AUDITORÍA 10, ALTO: la tabla se pobló con el costo NOMINAL de cada paso (0.3 s
 * una consulta, 1.5 s un `sendText`) y `presupuesto.test.ts` comparaba esa suma
 * —8 900 ms— contra `MARGEN_CIERRE_MS`. Era la suma del promedio, no la del peor
 * caso. Con el techo que el propio repo le impone a cada paso, los mismos trece
 * suman **125 000 ms**: 10.4× la reserva de 12 000 y 1.04× el `maxDuration` de
 * 120 000 ELLOS SOLOS. Una tabla de promedios no puede verificar un modo de
 * fallo que solo ocurre en el peor caso.
 *
 * `ms` sigue siendo el costo nominal (para dimensionar la reserva, que es un
 * promedio y está bien que lo sea). `techo` es lo que ese paso puede tardar como
 * máximo. `opcional` marca los que `processor.ts` SALTA cuando el reloj dice que
 * ya no hay presupuesto: lo que no es el entregable —la respuesta y el PDF— ni
 * una guardia de corrección.
 */
// ── EL `donde` TIENE QUE APUNTAR A DONDE DICE ─────────────────────────────
//
// AUDITORÍA 11, CRÍTICO (G-22). Los trece `donde` apuntaban a `processor.ts:591,
// 595, 658, 715, 734, 755, 757, 774, 814` y NINGUNA de esas líneas contenía el
// paso que decía contener: el archivo se reescribió y la tabla se quedó con las
// coordenadas viejas. Una tabla de presupuesto que apunta a otro lado no se
// puede auditar, y este documento es lo único que dice qué se sacrifica cuando
// el reloj aprieta.
//
// Por eso cada paso lleva ahora el SÍMBOLO que lo identifica, y
// `presupuesto.test.ts` abre `processor.ts`, va a esa línea y comprueba que lo
// contenga. Si esta prueba falla al mover código: no se afloja la prueba, se
// corrige el número — es la única forma de que el `donde` siga sirviendo.
export const PASOS_CIERRE: ReadonlyArray<{
  paso: string; donde: string; simbolo: string; ms: number; techo: number; opcional: boolean;
}> = [
  { paso: 'registrarCosto del turno',               donde: 'processor.ts:1393', simbolo: 'registrarCostoDesglosado',     ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'vincularCostosALiquidacion',             donde: 'processor.ts:1399', simbolo: 'vincularCostosALiquidacion',   ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'guardiaCifras → cuadrarDesdeDB',         donde: 'processor.ts:1493', simbolo: 'guardiaCifras',                ms: 300,   techo: techoPasoSupabaseMs(), opcional: false },
  { paso: 'sendText de la respuesta',               donde: 'processor.ts:1577', simbolo: 'await say(reply)',             ms: 1_500, techo: TECHO_ENVIO_META_MS,   opcional: false },
  { paso: 'registrarCostoWhatsApp de la respuesta', donde: 'processor.ts:414',  simbolo: 'registrarCostoWhatsApp',       ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'getGastos para el aviso de barrera',     donde: 'processor.ts:1614', simbolo: 'getGastos',                    ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'sendText del aviso de barrera',          donde: 'processor.ts:1618', simbolo: 'await say(aviso)',             ms: 1_500, techo: TECHO_ENVIO_META_MS,   opcional: true },
  { paso: 'registrarCostoWhatsApp de ese aviso',    donde: 'processor.ts:414',  simbolo: 'registrarCostoWhatsApp',       ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'createSignedUrl del PDF',                donde: 'processor.ts:1663', simbolo: 'createSignedUrl',              ms: 500,   techo: techoPasoSupabaseMs(), opcional: false },
  { paso: 'sendDocument del PDF',                   donde: 'processor.ts:1671', simbolo: 'sendDocument',                 ms: 2_500, techo: TECHO_ENVIO_META_MS,   opcional: false },
  { paso: 'registrarCostoWhatsApp del PDF',         donde: 'processor.ts:1673', simbolo: 'registrarCostoWhatsApp',       ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
  { paso: 'saveConversation',                       donde: 'processor.ts:1696', simbolo: 'saveConversation',             ms: 500,   techo: techoPasoSupabaseMs(), opcional: false },
  { paso: 'releaseViajeLock',                       donde: 'processor.ts:1745', simbolo: 'releaseViajeLock',             ms: 300,   techo: techoPasoSupabaseMs(), opcional: true },
];

/** Suma de los costos NOMINALES. 8.9s con los costos unitarios de este archivo. */
export const COSTO_CIERRE_MS = PASOS_CIERRE.reduce((s, p) => s + p.ms, 0);

/**
 * Suma de los TECHOS: lo que el cierre entero puede tardar si todo sale mal.
 * 10 pasos de Supabase × 9 500 + 3 envíos a Meta × 10 000 = **125 000 ms**.
 * Es el número del hallazgo, y no cabe en ningún presupuesto: por eso hay
 * pasos `opcional`.
 */
export const TECHO_CIERRE_MS = PASOS_CIERRE.reduce((s, p) => s + p.techo, 0);

/**
 * Lo que el cierre puede tardar DESPUÉS de que `processor.ts` salta lo opcional:
 * la guardia de cifras, la respuesta, la URL firmada, el PDF y la conversación.
 * 9 500 + 10 000 + 9 500 + 10 000 + 9 500 = **48 500 ms**.
 *
 * No es una garantía de que quepa —un cierre que arranca con 20 s de
 * presupuesto sigue pudiendo morir—; es la diferencia entre morir con el 100 %
 * del peor caso encima y morir con el 39 %, y entre morir mudo y dejar
 * `cierre.sin_presupuesto` escrito antes.
 */
export const TECHO_CIERRE_OBLIGATORIO_MS = PASOS_CIERRE
  .filter((p) => !p.opcional).reduce((s, p) => s + p.techo, 0);

/**
 * Tiempo que se aparta para CERRAR, o sea para todo lo que va DESPUÉS del
 * agente. Sin este margen se gasta hasta el último milisegundo y no queda
 * tiempo ni de responder — que es el fallo que esto viene a evitar.
 *
 * 12s contra los 8.9s de `COSTO_CIERRE_MS`: 3.1s de holgura. El coste es que el
 * agente pasa de 52s a 48s de techo, y el turno típico usa ~20s.
 *
 * OJO CON LO QUE ESTE NÚMERO **NO** ES: no es un tope. Es una RESERVA
 * dimensionada contra el costo NOMINAL. El peor caso de los trece pasos es
 * `TECHO_CIERRE_MS` = 125 000 ms, o sea 10.4× esta reserva: ningún valor de esta
 * constante puede impedir que un cierre desafortunado se pase.
 *
 * Lo que sí lo acota es que el cierre CONSULTE EL RELOJ, que hasta la auditoría
 * 10 no hacía ni una vez: `processor.ts` salta los pasos `opcional` cuando
 * `reloj.restanteDuro()` ya no da para su techo, y deja
 * `cierre.paso_omitido` / `cierre.sin_presupuesto` escritos ANTES de que Vercel
 * pueda matar la función. Con lo opcional fuera el peor caso baja a
 * `TECHO_CIERRE_OBLIGATORIO_MS` = 48 500 ms.
 *
 * (El párrafo anterior de este comentario decía que `sendText`/`sendDocument`
 * "siguen usando `fetch` pelado, y ahí el techo es el default de undici: 300s".
 * Dejó de ser cierto: `meta/client.ts:17` les puso `SEND_TIMEOUT_MS = 10 000`.
 * El comentario era el que estaba viejo, no el código.)
 */
export const MARGEN_CIERRE_MS = 12_000;

/**
 * TECHO DE UNA LLAMADA DE VISIÓN (OCR de un comprobante).
 *
 * Es el `reloj.senal(…)` que `processor.ts` le pasa a `extraerComprobante`, en
 * los dos caminos (con viaje y sin viaje). Vive aquí y no en `processor.ts`
 * porque hay OTRA etapa que tiene que dimensionarse contra él —la barrera de
 * intake, justo abajo— y con los dos números escritos a mano en sitios distintos
 * se desincronizaron sin que nada fallara.
 */
export const TECHO_OCR_MS = 25_000;

/**
 * Lo que tarda una foto DESPUÉS de que la visión contestó y ANTES de que el
 * `finally` decremente el contador de intake: `registrarCosto`, la lectura de
 * gastos para emparejar, el `addGasto` y el aviso al operador. Nominal ~2.4 s
 * con los costos unitarios de este archivo (0.3 s consulta, 1.5 s `sendText`);
 * se reserva el doble.
 */
const MARGEN_INTAKE_ESCRITURA_MS = 5_000;

/**
 * TOPE DE LA BARRERA DE INTAKE — lo que el "listo" espera a los OCR en vuelo.
 *
 * AUDITORÍA 10, ALTO: eran 20 000 ms esperando a un OCR cuyo techo son 25 000.
 * O sea 5 000 ms de ventana en la que la barrera SIEMPRE se rinde de más: la
 * foto sigue legítimamente dentro de su propio tope y el "listo" ya cuadró sin
 * ella. Con valores: ticket a las 21:04:00, "listo" a las 21:04:01, OCR de 22 s
 * —dentro de su techo—, barrera vencida a los 20 s, `intake.barrera_timeout`, el
 * agente cuadra sin ese comprobante y el viaje queda `liquidado` (el trigger de
 * la 0037 impide corregirlo). Dos segundos después la otra invocación escribe el
 * gasto: el PDF que recibió el operador y el panel del contralor difieren por el
 * monto de ese ticket. Con una carga de diésel de $8 000 de por medio, el
 * operador paga de su bolsa un gasto que sí hizo.
 *
 * El 20 000 se dimensionó cuando `PRESUPUESTO_WEBHOOK_MS` era 60 000 y nunca se
 * re-dimensionó por encima del techo del OCR que espera; `reloj.acotar` solo
 * puede bajarlo, nunca subirlo.
 *
 * Ahora se DERIVA del techo del OCR, así que no se pueden volver a separar:
 * 25 000 + 5 000 = **30 000 ms**.
 *
 * ¿Cabe? El peor caso del camino del "listo" con topes pedidos es
 * 30 000 (barrera) + 12 000 (mutex) + 40 000 (agente) = **82 000 ms** contra los
 * `PRESUPUESTO_WEBHOOK_MS − MARGEN_CIERRE_MS = 108 000` utilizables: 26 000 ms
 * de holgura. Antes eran 72 000 y 36 000 — se gastan 10 s de holgura para dejar
 * de emitir liquidaciones cortas, que es el único de los dos que cuesta dinero
 * del operador.
 */
export const TOPE_BARRERA_INTAKE_MS = TECHO_OCR_MS + MARGEN_INTAKE_ESCRITURA_MS;


// ═══════════════════════════════════════════════════════════════════════════
// TODA CONSULTA DE ESTE ARCHIVO TIENE TECHO.
//
// `supabaseAdmin()` crea el cliente sin `fetch` propio, así que hasta aquí
// ninguna consulta ni RPC llevaba señal de aborto y todas heredaban el default
// de undici: 300 000 ms. Vercel mata la función a los 120s, o sea que el fetch
// se rendía 180s después de que ya no había nadie escuchando. Medido contra un
// servidor que acepta y calla: `fetch()` seguía bloqueado a los 20s, y `getViaje`
// a los 12s (ver `repo_tope.test.ts`).
//
// Morir así es el peor final que tiene este producto: la liquidación ya quedó
// escrita, el operador no recibe ni resumen ni PDF, ni siquiera se escribe el
// `logger.error` porque el proceso muere antes del `catch`, y Meta no reintenta.
//
// El tope se impone en DOS capas a propósito:
//
//   1. `abortSignal` cuando el builder lo acepta —que es el caso en producción—,
//      porque eso CANCELA el socket de verdad. Sin cancelar, una instancia
//      caliente de Lambda se queda con la conexión colgada hasta los 300s.
//   2. Una carrera contra un temporizador, como red de seguridad, porque la
//      señal solo cubre lo que el SDK decida pasarle al fetch: si reintenta por
//      dentro, o si el cuelgue está antes (DNS, TLS), la señal sola no basta.
//
// Y sobre todo: agotar el tope entra por el MISMO camino que un error de
// Postgres —`{ data: null, error }`—, no por uno nuevo. Así cada llamador
// conserva la semántica que ya tenía y que está probada: `getGastos` lanza,
// `gastoExistePorHash` devuelve false, `saveCfdiXmlRaw` deja un warn. Un tope
// que además cambiara cómo falla cada función sería dos cambios disfrazados de
// uno, en el archivo por el que pasa todo el dinero.
// ═══════════════════════════════════════════════════════════════════════════
//
// AUDITORÍA 8, ALTO REINCIDENTE: esto vivía en `repo.ts`, así que solo protegía
// lo que pasaba por ahí. `costos.ts`, `conv.ts` y `config.ts` llamaban a
// `supabaseAdmin()` en crudo — ONCE de los trece pasos del cierre, incluido el
// mutex del viaje y la barrera de ráfaga. Un cuelgue ahí no tenía techo y se
// comía los 120 s de la función entera.
//
// Vive aquí, junto a `TOPE_CONSULTA_MS`, para que cualquier archivo lo importe
// sin volver a copiarlo.
// ═══════════════════════════════════════════════════════════════════════════

/** Margen sobre el tope antes de que dispare la red de seguridad. */
export async function acotada<T>(consulta: PromiseLike<T>, etiqueta: string): Promise<T> {
  const conSenal = consulta as PromiseLike<T> & { abortSignal?: (s: AbortSignal) => unknown };
  if (typeof conSenal.abortSignal === 'function') conSenal.abortSignal(AbortSignal.timeout(TOPE_CONSULTA_MS));

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      consulta,
      new Promise<T>((resolver) => {
        temporizador = setTimeout(() => {
          logger.error('supabase.tope_agotado', { consulta: etiqueta, topeMs: TOPE_CONSULTA_MS });
          resolver({
            data: null,
            error: { message: `sin respuesta en ${TOPE_CONSULTA_MS} ms (tope de consulta)` },
          } as unknown as T);
        }, TOPE_CONSULTA_MS + GRACIA_TOPE_MS);
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Presupuesto de la invocación del webhook, en ms.
 *
 * TIENE QUE COINCIDIR con el `maxDuration` de
 * `src/app/api/webhook/whatsapp/route.ts`. Next exige que aquel sea un literal
 * estático —no se puede importar—, así que hay un test que compara los dos y
 * falla si se desincronizan. Sin él, subir uno y olvidar el otro deja el
 * presupuesto mintiendo y vuelve el fallo silencioso.
 *
 * 120s desde el 28-jul-2026. El plan del equipo `likida` se verificó contra la
 * API de Vercel —es **pro**, tope 300s—, y el peor caso de la ruta son ~72s:
 * lock (≤12s) + espera de intake (20s) + cuadre (~40s). Con 60 se cortaba a
 * media liquidación, y como Meta ya recibió su 200 no reintenta.
 *
 * El comentario anterior decía "60s es el tope de Hobby, solo sube si se
 * confirma Pro": la condición se cumplió y quedó comprobada, no supuesta.
 */
export const PRESUPUESTO_WEBHOOK_MS = 120_000;

/**
 * ¿QUEDA PRESUPUESTO PARA UN PASO OPCIONAL DEL CIERRE?
 *
 * AUDITORÍA 10, ALTO: el cierre corría sin consultar el reloj ni una sola vez —
 * `processor.ts:1158` (el `timeoutMs` del agente) era la última línea del archivo
 * que mencionaba `reloj`, y después venían los trece pasos de `PASOS_CIERRE`, con
 * un techo sumado de 125 000 ms contra una reserva de 12 000. Cuando eso
 * reventaba, la liquidación ya estaba escrita, el operador no recibía nada, no
 * quedaba ni una línea de log —el proceso muere antes de cualquier `catch`— y
 * Meta no reintentaba.
 *
 * Esto no acelera nada: decide QUÉ se sacrifica cuando ya no hay tiempo, en vez
 * de dejar que lo decida el hacha de Vercel. Lo accesorio (contabilidad de
 * costo, avisos, soltar el mutex que igual expira por TTL) cede el paso al
 * entregable: la respuesta y el PDF.
 *
 * Y sobre todo: **deja rastro**. `cierre.paso_omitido` se escribe ANTES de que
 * la función pueda morir, así que el caso deja de ser invisible.
 *
 * @param techoMs  el TECHO del paso, no su costo nominal. El paso que mata la
 *                 invocación es el lento, no el promedio.
 */
export function hayPresupuestoPara(reloj: Presupuesto, techoMs: number, paso: string): boolean {
  const quedan = reloj.restanteDuro();
  if (quedan >= techoMs) return true;
  logger.warn('cierre.paso_omitido', { paso, techoMs, restanteMs: quedan });
  return false;
}

export interface Presupuesto {
  /** Milisegundos utilizables que quedan, ya descontado el margen de cierre. */
  restante(): number;
  /**
   * Milisegundos que quedan de la invocación ENTERA, sin descontar el margen de
   * cierre. Es lo que hay que mirar DENTRO del cierre: ahí `restante()` ya vale
   * 0 por definición —el margen es justo lo que se está consumiendo— y usarlo
   * haría que el cierre se saltara todo siempre.
   *
   * Se compara contra el TECHO del paso que viene, no contra su costo nominal:
   * el modo de fallo que mata la invocación es el paso lento, no el promedio.
   */
  restanteDuro(): number;
  /** `true` si ya no queda tiempo para trabajo nuevo. */
  agotado(): boolean;
  /** El tope que pide una etapa, recortado a lo que de verdad queda. */
  acotar(topeDeseado: number): number;
  /** ¿Cabe una etapa que se estima en `costoMs`? */
  alcanza(costoMs: number): boolean;
  /** Milisegundos transcurridos desde el inicio. Para el log. */
  gastado(): number;
  /**
   * Señal que se aborta cuando se acaba lo que queda (o antes, si `topeMs` es
   * menor). Para pasarla a los SDK que aceptan `AbortSignal` y que si no caen a
   * sus defaults —el de OpenAI son 10 minutos contra un webhook de 60s.
   */
  senal(topeMs?: number): AbortSignal;
}

/**
 * @param totalMs  presupuesto de la invocación (el `maxDuration` de la ruta).
 * @param reloj    inyectable para poder probarlo sin esperar de verdad.
 */
export function crearPresupuesto(totalMs: number, reloj: () => number = Date.now): Presupuesto {
  const inicio = reloj();
  const restante = () => Math.max(0, totalMs - MARGEN_CIERRE_MS - (reloj() - inicio));
  return {
    restante,
    restanteDuro: () => Math.max(0, totalMs - (reloj() - inicio)),
    agotado: () => restante() <= 0,
    acotar: (topeDeseado: number) => Math.min(topeDeseado, restante()),
    alcanza: (costoMs: number) => restante() >= costoMs,
    gastado: () => reloj() - inicio,
    senal: (topeMs?: number) => {
      const ms = Math.min(topeMs ?? Number.POSITIVE_INFINITY, restante());
      // `AbortSignal.timeout(0)` no aborta de inmediato: se agenda. Cuando ya no
      // queda nada se devuelve una señal YA abortada, para que la llamada ni
      // salga.
      if (!(ms > 0)) { const ac = new AbortController(); ac.abort(); return ac.signal; }
      return AbortSignal.timeout(ms);
    },
  };
}
