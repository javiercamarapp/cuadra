import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO REINCIDENTE de la ronda 9 (seguridad) — la descarga de media de Meta no
// tenía tope de tamaño.
//
// El webhook sí mide su cuerpo (256 KB, `webhook/whatsapp/route.ts:42,45`) y lo
// mide dos veces. Pero lo que ese cuerpo trae es un `media_id`: el archivo se
// baja DESPUÉS, en `after()`, y ahí `bin.text()` / `Buffer.from(await
// bin.arrayBuffer())` materializaban lo que Meta entregara — hasta 100 MB, que
// es el máximo de un `document` en WhatsApp Cloud API.
//
// Escenario con valores: un operador dado de alta manda como documento un
// `.xml` de 100 MB. El webhook contesta 200 con 400 bytes; la invocación se
// lleva por delante los demás mensajes del mismo lote (`route.ts`,
// `Promise.all`) y `saveCfdiXmlRaw` escribe eso en una columna `text` sin
// `check` de longitud.
//
// Las dos mitades del tope se prueban por separado a propósito: `content-length`
// es del servidor y puede faltar o mentir, así que un tope que solo mirara la
// cabecera sería una sugerencia.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { downloadMediaAsText, downloadMediaAsDataUrl } = await import('./client');

// Los topes se escriben aquí a mano, no se importan del módulo bajo prueba: una
// prueba que toma la constante del propio código no puede afirmar cuánto vale.
// Si alguien los sube, este archivo tiene que cambiar y decir por qué.
const MAX_MEDIA_TEXTO_BYTES = 2 * 1024 * 1024;   // un CFDI 4.0 con addenda son decenas de KB
const MAX_MEDIA_IMAGEN_BYTES = 8 * 1024 * 1024;  // WhatsApp corta las imágenes en 5 MB

const META_XML = { url: 'https://lookaside.fb/x', mime_type: 'text/xml' };
const META_JPG = { url: 'https://lookaside.fb/x', mime_type: 'image/jpeg' };

/** Cuerpo que se entrega en trozos, como lo entrega la red. */
function cuerpoEnTrozos(totalBytes: number, trozo = 64 * 1024, headers: HeadersInit = {}): Response {
  let restantes = totalBytes;
  let leidos = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (restantes <= 0) return controller.close();
      const n = Math.min(trozo, restantes);
      restantes -= n;
      leidos += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  const res = new Response(stream, { status: 200, headers });
  // Cuánto se llegó a leer de verdad: si el tope corta a media descarga, esto
  // tiene que quedarse MUY por debajo del total.
  Object.defineProperty(res, 'leidos', { get: () => leidos });
  return res;
}

beforeEach(() => {
  logger.error.mockReset(); logger.warn.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = 'EAA-lo-que-sea';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1285225531334385';
});

describe('la descarga de media tiene tope de tamaño', () => {
  it('un XML de 100 MB que declara su content-length no se descarga siquiera', async () => {
    const CIEN_MB = 100 * 1024 * 1024;
    const contenido = vi.fn(async () =>
      new Response('<cfdi/>', { status: 200, headers: { 'content-length': String(CIEN_MB) } }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(META_XML), { status: 200 }))
      .mockImplementationOnce(contenido));

    expect(await downloadMediaAsText('m-100mb')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_demasiado_grande', expect.objectContaining({
      mediaId: 'm-100mb', bytes: CIEN_MB, tope: MAX_MEDIA_TEXTO_BYTES, fuente: 'content-length',
    }));
  });

  it('y sin content-length tampoco: se corta a media descarga, no al final', async () => {
    // Sin la cabecera, la única defensa es contar lo que va llegando. Se pide
    // el doble del tope; lo leído tiene que quedarse cerca del tope, no del
    // doble — eso es lo que distingue "cortó al leer" de "leyó todo y midió".
    const cuerpo = cuerpoEnTrozos(MAX_MEDIA_TEXTO_BYTES * 2);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(META_XML), { status: 200 }))
      .mockResolvedValueOnce(cuerpo));

    expect(await downloadMediaAsText('m-sin-cabecera')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_demasiado_grande', expect.objectContaining({
      mediaId: 'm-sin-cabecera', tope: MAX_MEDIA_TEXTO_BYTES, fuente: 'stream',
    }));
    // El margen son unos pocos trozos: el `ReadableStream` va por delante del
    // lector (read-ahead de la cola), así que "cortó al leer" no significa
    // "cortó en el byte exacto". Lo que este número tiene que demostrar es que
    // NO llegaron los 4 MB al proceso.
    const leidos = (cuerpo as unknown as { leidos: number }).leidos;
    expect(leidos).toBeLessThanOrEqual(MAX_MEDIA_TEXTO_BYTES + 4 * 64 * 1024);
  });

  it('la foto del ticket tiene su propio tope, más alto que el del XML', async () => {
    expect(MAX_MEDIA_IMAGEN_BYTES).toBeGreaterThan(MAX_MEDIA_TEXTO_BYTES);
    const cuerpo = cuerpoEnTrozos(MAX_MEDIA_IMAGEN_BYTES + 1, 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(META_JPG), { status: 200 }))
      .mockResolvedValueOnce(cuerpo));

    expect(await downloadMediaAsDataUrl('m-foto-gigante')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_demasiado_grande', expect.objectContaining({
      mediaId: 'm-foto-gigante', tope: MAX_MEDIA_IMAGEN_BYTES,
    }));
  });

  // El límite por el otro lado: un CFDI de verdad pesa decenas de KB y tiene que
  // seguir pasando sin una línea de error. Sin este caso, "devolver null
  // siempre" pasaría las tres pruebas de arriba.
  it('un CFDI de tamaño normal sigue bajando entero y sin ruido', async () => {
    const xml = `<cfdi:Comprobante>${'x'.repeat(40_000)}</cfdi:Comprobante>`;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(META_XML), { status: 200 }))
      .mockResolvedValueOnce(new Response(xml, { status: 200 })));

    expect(await downloadMediaAsText('m-normal')).toBe(xml);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
