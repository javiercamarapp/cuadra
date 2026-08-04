import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// BAJO REINCIDENTE (rondas 8, 9 y 10, seguridad) — `GET /api/demo` publicaba
// el inventario de configuración del despliegue sin pedir nada.
//
//   curl https://app.likida.ai/api/demo
//   → {"ok":true,"config":{"llm":true,"whatsapp":true,"supabase":true}}
//
// No son valores de secretos, pero sí es el mapa de qué integraciones están
// puestas: sirve para saber, sin cuenta, si un despliegue quedó a medias y
// cuál de los tres grupos falta. `/api` está fuera del matcher del proxy
// (`proxy.ts:81`), así que esta línea era la única puerta y no había ninguna.
//
// El endpoint no se retira —es un health-check útil— se le pone dueño: solo el
// superadmin. Y responde 404, no 401: un 401 confirma que la ruta existe, que
// es justamente el reconocimiento que se está cerrando.
// ═══════════════════════════════════════════════════════════════════════════

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { GET } = await import('./route');

describe('GET /api/demo no publica el inventario de configuración', () => {
  beforeEach(() => {
    getSessionTenant.mockReset();
    vi.stubEnv('OPENROUTER_API_KEY', 'x');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'x');
  });

  it('sin sesión: 404 y ni una palabra de la configuración', async () => {
    getSessionTenant.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/llm|whatsapp|supabase|config/i);
  });

  it('con sesión de flota_admin tampoco: la config del despliegue es de Likida, no del cliente', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: null, operadorId: null });
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('con sesión de superadmin sí: el health-check no se pierde, cambia de dueño', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-0', tenantId: null, rol: 'superadmin', nombre: 'Javier', operadorId: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, config: { llm: true } });
  });
});
