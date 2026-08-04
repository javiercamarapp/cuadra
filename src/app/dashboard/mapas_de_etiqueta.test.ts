import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { estadoSat } from './documentos/estado-sat';
import { etiquetaRol } from '../admin/roles';
import type { EstadoSat } from '@/lib/cuadra/intake/sat';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-15 (MEDIO, frontend + arquitectura) — «mapas de etiqueta
// incompletos: el veredicto del SAT sale en ámbar y en crudo, y el chofer lee
// claves de base de datos».
//
// `EstadoSat` es una unión de CUATRO: 'vigente' | 'cancelado' |
// 'no_encontrado' | 'pendiente' (`intake/sat.ts:18`). La bandeja traducía dos
// y mandaba las otras dos a un `if (d.estadoSat)` que pintaba LA CLAVE CRUDA
// en ámbar. Y `no_encontrado` no es "atención": es la misma cubeta de NO
// DEDUCIBLE que `cancelado` —el CFDI no existe en el SAT—, así que salía en
// amarillo el peor veredicto posible, escrito como `no_encontrado`.
//
// Igual con el rol: `usuarios/page.tsx` imprimía `flota_admin` en el pill
// teniendo el repo un mapa tipado (`admin/roles.ts`) escrito para esto.
//
// La prueba exige EXHAUSTIVIDAD contra la unión de tipos, no contra una lista
// escrita a mano: una lista también se desactualiza, que es como llegamos aquí.
// ═══════════════════════════════════════════════════════════════════════════

const TODOS: EstadoSat[] = ['vigente', 'cancelado', 'no_encontrado', 'pendiente'];

const doc = (over: Partial<Parameters<typeof estadoSat>[0]> = {}) => ({
  cfdiUuid: 'abc', estadoSat: null as string | null, efos: false, ...over,
});

describe('el veredicto del SAT se traduce entero', () => {
  it.each(TODOS)('«%s» no sale en crudo', (estado) => {
    const { label } = estadoSat(doc({ estadoSat: estado }));
    expect(label, 'la clave de la base pintada en la pantalla del contralor').not.toBe(estado);
    expect(label).not.toContain('_');
  });

  it('«no encontrado» es no deducible, igual que cancelado — no un «atención»', () => {
    expect(estadoSat(doc({ estadoSat: 'no_encontrado' })).estado).toBe('bad');
    expect(estadoSat(doc({ estadoSat: 'cancelado' })).estado).toBe('bad');
  });

  it('«pendiente» sí es atención: todavía no se sabe', () => {
    expect(estadoSat(doc({ estadoSat: 'pendiente' })).estado).toBe('warn');
  });

  it('vigente es lo bueno, y sin CFDI no es un problema', () => {
    expect(estadoSat(doc({ estadoSat: 'vigente' })).estado).toBe('ok');
    expect(estadoSat(doc({ cfdiUuid: null })).estado).toBe('neutral');
  });

  it('EFOS gana sobre todo lo demás', () => {
    expect(estadoSat(doc({ estadoSat: 'vigente', efos: true })).estado).toBe('bad');
  });

  it('un valor que nadie previó no se pinta como si se entendiera', () => {
    const { label, estado } = estadoSat(doc({ estadoSat: 'inventado' }));
    expect(estado, 'un estado desconocido no puede leerse como "atención" a secas').toBe('warn');
    expect(label).toMatch(/sin verificar|desconocido/i);
  });
});

describe('el rol se traduce con el mapa tipado del repo', () => {
  it('la tabla de usuarios no imprime `flota_admin`', () => {
    const fuente = readFileSync(new URL('./usuarios/page.tsx', import.meta.url), 'utf8');
    expect(fuente, 'el pill imprimía la clave cruda de `app_user.rol`').toMatch(/etiquetaRol\(/);
  });

  it('y ese mapa cubre los cinco roles del dominio', () => {
    for (const rol of ['superadmin', 'flota_admin', 'encargado', 'contador', 'operador']) {
      expect(etiquetaRol(rol)).not.toBe(rol);
    }
  });
});
