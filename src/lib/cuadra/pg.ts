import { logger } from '@/lib/logger';
// El tope de consulta vive en `presupuesto.ts` (dominio del webhook): aquí se
// IMPORTA, no se reimplementa — un segundo tope sería un segundo número que
// alguien tiene que acordarse de mover.
import { acotada } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS BORDES DE POSTGREST — extraídos de analytics.ts para que el módulo
// de operación (operacion.ts) no los reimplemente.
//
// Reimplementarlos habría sido peor que moverlos: son exactamente los dos
// fallos que CLAUDE.md llama "la familia de bugs más repetida del repo", y una
// segunda copia es una segunda oportunidad de escribirla mal.
// ═══════════════════════════════════════════════════════════════════════════

// ── Los fallos de Supabase llegan POR VALOR, no lanzando ────────────────────
// `shouldThrowOnError` es false por defecto en postgrest-js, así que un host
// inalcanzable, un 500, una llave rotada o un `grant` que le cierre la tabla al
// service-role devuelven `{ data: null, error }` y siguen. Desestructurar solo
// `data` convierte cualquiera de esos fallos en "no hay nada": el panel pintaba
// "Aún no hay liquidaciones" con la base caída y el contralor concluía que la
// flota nunca ha liquidado un viaje (auditoría 5, frontend, CRÍTICO).
//
// El panel ya sabe distinguir null de dato —`safe()` en dashboard/page.tsx
// atrapa excepciones—, así que lo único que faltaba era TRADUCIR el error por
// valor a una excepción. Se hace aquí, en el borde, y no en cada llamador.
export type RespuestaPg<T> = { data: T | null; error: { message: string } | null };

export function exigir<T>(res: RespuestaPg<T>, consulta: string): T | null {
  if (res.error) throw new Error(`${consulta}: ${res.error.message}`);
  return res.data;
}

// AUDITORÍA 8, ALTO REINCIDENTE: PostgREST recorta en silencio a `max_rows`
// (1,000 por default) sin avisar — no lanza, no loguea, simplemente devuelve
// menos filas. Para un tenant que ya lleva un trimestre operando, eso apagaba
// `detectarAnomalias` (el detector de fraude entre viajes) justo cuando más
// datos hay que mirar, sin que el panel supiera que la lectura estaba
// incompleta. `getAcumuladoCombustible` (repo.ts) ya paginaba así desde la
// ronda 6; aquí no se había movido.
const PAGINA = 1_000;
/** 100 páginas son 100,000 filas. Un tenant que las pase necesita un `sum()`
 *  en SQL, no más vueltas: se corta y se dice, en vez de colgar el turno. */
const MAX_PAGINAS = 100;

export async function traerTodo<T>(
  construir: (desde: number, hasta: number) => PromiseLike<RespuestaPg<T[]>>,
  consulta: string,
): Promise<T[]> {
  const filas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA;
    // CADA PÁGINA CON SU TECHO. `acotada` estaba en las escrituras del
    // encargado y no en las lecturas del panel, que son once y pasan todas por
    // aquí. Sin tope, una Supabase degradada no hace la página lenta: la deja
    // en blanco — `safeLog` atrapa excepciones, no esperas, así que el
    // fallback que la pantalla tiene escrito nunca se pinta y la invocación
    // muere por corte de la plataforma (auditoría 11, G-52).
    const pag = exigir(
      await acotada(construir(desde, desde + PAGINA - 1), `${consulta}[${pagina}]`),
      consulta,
    ) ?? [];
    filas.push(...pag);
    if (pag.length < PAGINA) break;
  }
  return filas;
}

// ═══════════════════════════════════════════════════════════════════════════
// EL TERCER BORDE: el `catch` que la pantalla necesita y el operador no puede
// pagar.
//
// AUDITORÍA 11 · G-32 (CRÍTICO). Quince páginas de /dashboard y el handler del
// rail definían, byte a byte, la misma función:
//
//     async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
//       try { return await fn(); } catch { return null; }
//     }
//
// De cara al usuario está bien: una sección caída no debe tirar la pantalla
// entera. De cara a quien opera el sistema es ceguera total — ninguna de esas
// páginas importaba `@/lib/logger`, así que el fallo desaparecía sin dejar una
// línea, y en Next.js un `catch` vacío en un Server Component además apaga
// `onRequestError`. El caso más caro: `cuadre/page.tsx` se comía el `throw`
// que `getLiquidaciones` hace A PROPÓSITO para no volver a pintar "12 viajes
// liquidados" con la base caída.
//
// Vive aquí y no en un `ui/` porque es el mismo problema que `exigir()` una
// capa más arriba: un fallo de lectura que se lee como "no hay nada".
// ═══════════════════════════════════════════════════════════════════════════

export async function safeLog<T>(
  fn: () => Promise<T>,
  /** Qué se estaba leyendo, para que la línea del log sirva a las 3 a.m.
   *  ("dashboard/cuadre.liquidaciones"). */
  contexto: string,
  /** Aviso opcional al llamador: el handler del rail lo usa para responder
   *  503 con un motivo en vez de 200 con nulos (G-25). */
  alFallar?: (e: unknown) => void,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    logger.error('lectura.fallida', {
      contexto,
      err: e instanceof Error ? e.message : String(e),
    });
    alFallar?.(e);
    return null;
  }
}
