import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el fallback cross-provider no se disparaba con el
// error que produce un proveedor caído DE VERDAD.
//
// `isTransientError` clasificaba por el TEXTO del mensaje. Pero el SDK de OpenAI
// construye, para cualquier fallo de conexión —DNS, TCP rechazado, TLS,
// `fetch failed` de undici—, un `APIConnectionError` cuyo mensaje es la cadena
// literal "Connection error.": el detalle real queda en `err.cause`, que nunca
// se leía.
//
// Así que el fallback absorbía los 503 (que es lo que probaban los tests, con
// `new Error('503 ...')`) y NO absorbía la caída de red, que es el caso para el
// que se diseñó. En la sala del 6-ago eso es el agente contestando "se me trabó
// el sistema" ante un parpadeo que el diseño prometía tapar.
// ═══════════════════════════════════════════════════════════════════════════

process.env.OPENROUTER_API_KEY = 'test-key';
const { isTransientError, StructuredError, TruncatedError } = await import('./openrouter');

/** Reconstruye el error tal como lo arma `openai@6`: mensaje genérico, causa real. */
const errorDeConexion = (causa: string) => {
  const e = new Error('Connection error.');
  e.name = 'APIConnectionError';
  (e as Error & { cause?: unknown }).cause = new TypeError(causa);
  return e;
};

describe('isTransientError — el proveedor caído tiene que contar como transitorio', () => {
  it('APIConnectionError por DNS/TCP/TLS es transitorio', () => {
    expect(isTransientError(errorDeConexion('fetch failed'))).toBe(true);
    expect(isTransientError(errorDeConexion('getaddrinfo ENOTFOUND openrouter.ai'))).toBe(true);
  });

  it('también si solo llega el mensaje genérico, sin causa', () => {
    const e = new Error('Connection error.');
    e.name = 'APIConnectionError';
    expect(isTransientError(e)).toBe(true);
  });

  it('un error con status 5xx/429/408 es transitorio aunque el mensaje no traiga el número', () => {
    for (const status of [500, 502, 503, 504, 429, 408]) {
      const e = Object.assign(new Error('upstream problem'), { status });
      expect(isTransientError(e), `status ${status}`).toBe(true);
    }
  });

  it('lo que NO es transitorio sigue sin serlo: un 400 no debe disparar el fallback', () => {
    expect(isTransientError(new Error('400 thinking.budget_tokens must be >= 1024'))).toBe(false);
    expect(isTransientError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isTransientError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false);
  });

  it('lo que ya funcionaba sigue funcionando (regresión)', () => {
    expect(isTransientError(new Error('503 Service Unavailable: provider caído'))).toBe(true);
    expect(isTransientError(new Error('Request timed out.'))).toBe(true);
    expect(isTransientError(new Error('429 rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('overloaded'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO — EL OFFSET DEL `SyntaxError` DE JSON SE LEÍA COMO UN
// CÓDIGO DE ESTADO.
//
// La clasificación por texto concatena el mensaje del error Y el de su `cause`,
// y `new StructuredError('JSON parse falló', e, …)` pone como `cause` el
// `SyntaxError` de `JSON.parse`, cuyo mensaje lleva el offset. Con la regex de
// tres dígitos, cualquier JSON de OCR que se rompa en un offset de 500-599 (o en
// 408, 429, 502-504) se clasificaba como PROVEEDOR CAÍDO y disparaba una tercera
// llamada de visión completa contra el fallback, que iba a fallar por lo mismo.
// Un ticket produce ~500 bytes de JSON: la ventana no es exótica.
//
// Lo peor no era la llamada pagada de más, sino el `llm.fallback` en el log
// diciendo "proveedor caído" con el proveedor sano: la clase de línea que manda
// a diagnosticar al lado equivocado.
//
// La regla de fondo: `isTransientError` clasifica fallos del TRANSPORTE. Un
// `StructuredError` —JSON roto, schema inválido, truncamiento— lo fabricamos
// NOSOTROS después de que el proveedor respondió bien. Nunca es un proveedor
// caído, diga lo que diga su texto.
// ═══════════════════════════════════════════════════════════════════════════
describe('isTransientError — un JSON roto no es un proveedor caído', () => {
  const conOffset = (pos: number) =>
    new StructuredError(
      'JSON parse falló',
      new SyntaxError(`Unterminated string in JSON at position ${pos} (line 1 column ${pos + 1})`),
      '{"monto":1',
    );

  it('el offset que cae en la ventana de tres dígitos ya no dispara el fallback', () => {
    // Reproducidos por la auditoría contra la función real: 536, 408, 502 daban
    // `true`; 300 y 1200 daban `false`. El defecto era esa asimetría.
    for (const pos of [536, 408, 429, 502, 503, 504, 550, 599]) {
      expect(isTransientError(conOffset(pos)), `offset ${pos}`).toBe(false);
    }
  });

  it('los offsets que ya daban false siguen dando false', () => {
    for (const pos of [300, 1200]) expect(isTransientError(conOffset(pos))).toBe(false);
  });

  it('tampoco lo son la validación de schema ni el truncamiento', () => {
    expect(isTransientError(new StructuredError('Validación falló: monto debe ser > 500'))).toBe(false);
    expect(isTransientError(new TruncatedError('Respuesta truncada: se agotaron los 504 tokens', 504, 504))).toBe(false);
  });

  it('un `SyntaxError` suelto tampoco: nunca lo produce el transporte', () => {
    expect(isTransientError(new SyntaxError('Unexpected end of JSON input at position 503'))).toBe(false);
  });

  it('y el proveedor caído de verdad sigue disparando el fallback', () => {
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientError(Object.assign(new Error('upstream'), { status: 503 }))).toBe(true);
  });
});
