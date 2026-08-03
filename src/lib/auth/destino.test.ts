import { describe, it, expect } from 'vitest';
import { destinoSeguro } from './destino';

// ═══════════════════════════════════════════════════════════════════════════
// ALTO de la auditoría 10 (frontend), corroborado por backend y por seguridad.
//
// La lista blanca del `next` vivía copiada CUATRO veces —`login/page.tsx:49`,
// `:54`, `:70` y `auth/callback/route.ts:14`— y las cuatro decían lo mismo:
// `startsWith('/dashboard')`. Cualquier otro destino se reescribía a
// `/dashboard`.
//
// Consecuencia medida: el chofer abre `/mis-viajes`, el proxy lo manda a
// `/login?next=%2Fmis-viajes` (y `proxy.test.ts` prueba que ese `next` se
// conserva), y las cuatro copias siguientes lo tiran. Aterrizaba en el panel
// del contralor — que es el CRÍTICO que `d081176` cerró por el otro lado, en
// la puerta de rol. Esto cierra la causa: el destino que el chofer pidió.
//
// La lista blanca NO se relaja: sigue siendo lista blanca, y ahora además
// exige frontera de segmento. `/dashboardcualquiercosa` pasaba antes.
// ═══════════════════════════════════════════════════════════════════════════

describe('destinoSeguro', () => {
  it('conserva los tres paneles reales', () => {
    expect(destinoSeguro('/dashboard')).toBe('/dashboard');
    expect(destinoSeguro('/mis-viajes')).toBe('/mis-viajes');
    expect(destinoSeguro('/admin')).toBe('/admin');
  });

  it('conserva subrutas y query de esos paneles', () => {
    expect(destinoSeguro('/dashboard/abc-123')).toBe('/dashboard/abc-123');
    expect(destinoSeguro('/admin/costos-facturacion')).toBe('/admin/costos-facturacion');
    expect(destinoSeguro('/dashboard?vista=demo')).toBe('/dashboard?vista=demo');
  });

  it('sin `next`, o vacío, cae en /dashboard', () => {
    expect(destinoSeguro(undefined)).toBe('/dashboard');
    expect(destinoSeguro(null)).toBe('/dashboard');
    expect(destinoSeguro('')).toBe('/dashboard');
  });

  // Lo que la lista blanca existe para parar. Un `next` llega del querystring:
  // lo controla quien manda el link.
  it('rechaza destinos absolutos y protocol-relative', () => {
    expect(destinoSeguro('https://evil.example/x')).toBe('/dashboard');
    expect(destinoSeguro('//evil.example/x')).toBe('/dashboard');
    expect(destinoSeguro('http://evil.example')).toBe('/dashboard');
    expect(destinoSeguro('javascript:alert(1)')).toBe('/dashboard');
  });

  it('rechaza rutas del sitio que no son panel', () => {
    expect(destinoSeguro('/aviso/abc')).toBe('/dashboard');
    expect(destinoSeguro('/api/export/liquidaciones')).toBe('/dashboard');
    expect(destinoSeguro('/acceso')).toBe('/dashboard');
  });

  // Frontera de segmento: `'/dashboardevil'.startsWith('/dashboard')` era
  // `true`, así que la versión copiada lo aceptaba.
  it('exige frontera de segmento, no prefijo suelto', () => {
    expect(destinoSeguro('/dashboardevil')).toBe('/dashboard');
    expect(destinoSeguro('/adminis-trador')).toBe('/dashboard');
    expect(destinoSeguro('/mis-viajes-falso')).toBe('/dashboard');
  });

  it('rechaza el salto de línea que partiría una cabecera', () => {
    expect(destinoSeguro('/dashboard\nLocation: https://evil.example')).toBe('/dashboard');
  });
});
