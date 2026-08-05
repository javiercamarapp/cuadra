import { describe, it, expect } from 'vitest';
import { puedeExportar } from './permisos';
import { puedeVerArea, areasDe } from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · PASE 2 · A11P2-C1 · CRÍTICO — dos tablas de permisos
// gobiernan el mismo dinero, y las rutas de API consultan la que NO lo niega.
//
// `visibilidad.ts` se escribió esta ronda para que el jefe de tráfico
// (`encargado`) dejara de ver las finanzas de la flota: `encargado:
// ['operacion']`, sin `'dinero'`. En pantalla funciona — `/dashboard/cuadre`,
// `/dashboard/analitica` y `/dashboard/viajes` lo rebotan.
//
// Pero las dos únicas rutas de export que existen —y las dos entregan dinero:
// `total_comprobado`, `total_anticipo`, `diferencia`— gatean con
// `puedeExportar`, de la OTRA tabla, y esa lo dejaba pasar. Con la cookie del
// jefe de tráfico, `curl /api/export/liquidaciones` bajaba el CSV completo de
// la flota: exactamente lo que el producto promete impedirle.
//
// Lo levantaron dos auditores independientes (backend y arquitectura) por la
// misma causa raíz. No es "validar mejor": es que hay DOS fuentes de verdad
// para la misma pregunta y divergieron a los dos días de nacer la segunda.
//
// La prueba que importa no es "encargado no exporta" —eso se arregla borrando
// una palabra y vuelve a divergir en la ronda siguiente—, es la INVARIANTE:
// nadie puede exportar un área que no puede ver.
// ═══════════════════════════════════════════════════════════════════════════

/** El dominio de `app_user.rol` (migración 0044), más un rol inventado. */
const ROLES = ['superadmin', 'flota_admin', 'contador', 'encargado', 'operador'];

describe('A11P2-C1 · exportar es un permiso sobre el dinero, no un permiso aparte', () => {
  it('INVARIANTE · ningún rol exporta un área que no puede ver', () => {
    const incoherentes = ROLES.filter(
      (rol) => puedeExportar(rol) && !puedeVerArea(rol, 'dinero'),
    );

    expect(
      incoherentes,
      'estos roles tienen negado el área "dinero" en visibilidad.ts y aun así ' +
        'pasan el gate de las dos rutas de export, que sirven comprobado, ' +
        'anticipo y diferencia de cada liquidación de la flota',
    ).toEqual([]);
  });

  it('el ENCARGADO —el rol para el que se escribió visibilidad.ts— no exporta', () => {
    expect(areasDe('encargado')).toEqual(['operacion']);
    expect(puedeVerArea('encargado', 'dinero')).toBe(false);
    expect(
      puedeExportar('encargado'),
      'el jefe de tráfico se baja por API el CSV que el panel le esconde',
    ).toBe(false);
  });

  // ── LOS CONTROLES ────────────────────────────────────────────────────────
  // Sin estos, "devolver false siempre" pasaría las dos de arriba sin probar
  // nada, y de paso dejaría al contralor sin su export.

  it('CONTROL · el CONTADOR sí exporta — la consola lo ofrece como «solo lectura y exportar»', () => {
    expect(puedeVerArea('contador', 'dinero')).toBe(true);
    expect(puedeExportar('contador')).toBe(true);
  });

  it('CONTROL · el DUEÑO y el superadmin sí exportan', () => {
    expect(puedeExportar('flota_admin')).toBe(true);
    expect(puedeExportar('superadmin')).toBe(true);
  });

  it('CONTROL · el CHOFER no exportaba antes y sigue sin exportar', () => {
    expect(puedeExportar('operador')).toBe(false);
  });

  it('CONTROL · un rol que nadie clasificó no exporta — fail closed', () => {
    expect(puedeExportar('gerente_regional')).toBe(false);
    expect(puedeVerArea('gerente_regional', 'dinero')).toBe(false);
  });
});
