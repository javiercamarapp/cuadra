import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROL_LABEL, etiquetaRol } from './roles';
import { MENSAJE_ERROR } from './mi-perfil/mensajes';
import { TIPOS_AVATAR, MAX_AVATAR_BYTES } from './mi-perfil/avatar-validacion';

// ═══════════════════════════════════════════════════════════════════════════
// DOS MAPAS QUE LA PANTALLA LEE Y NADIE COMPROBABA. AUDITORÍA 11 · G-33.
//
// Los dos viven en archivos que solo importa un `page.tsx`, y `page.tsx` está
// EXCLUIDO de la medición de cobertura: se escriben sin prueba y no se nota.
// Lo que se fija aquí no es el porcentaje, son dos correspondencias que se
// rompen en silencio:
//
//   · `ROL_LABEL` tiene que cubrir los cinco roles del dominio real de
//     `app_user.rol`. El tipo ya lo obliga a compilar; esto lo obliga a ser
//     verdad (la copia de `mi-perfil` era `Record<string,string>` y por eso
//     un rol nuevo sin etiqueta habría compilado).
//   · Cada `?error=` que `acciones.ts` emite tiene que tener un mensaje. Un
//     `?error=avatar_tamano` sin entrada en el mapa cae al mensaje genérico
//     y le da al usuario el consejo equivocado.
// ═══════════════════════════════════════════════════════════════════════════

describe('ROL_LABEL cubre el dominio real de app_user.rol', () => {
  const DOMINIO = ['superadmin', 'flota_admin', 'contador', 'operador', 'encargado'];

  it('los cinco roles tienen etiqueta', () => {
    for (const rol of DOMINIO) {
      expect(ROL_LABEL[rol as keyof typeof ROL_LABEL], rol).toBeTruthy();
    }
  });

  it('y no hay etiquetas de más (un rol que la base no admite)', () => {
    expect(Object.keys(ROL_LABEL).sort()).toEqual([...DOMINIO].sort());
  });

  it('un rol desconocido se pinta tal cual: la clave cruda es fea, pero es verdad', () => {
    expect(etiquetaRol('rol_del_futuro')).toBe('rol_del_futuro');
  });

  it('los conocidos se pintan legibles', () => {
    expect(etiquetaRol('flota_admin')).toBe('Dueño / Admin de flota');
  });
});

describe('MENSAJE_ERROR responde a cada `?error=` que las acciones emiten', () => {
  // Se leen del código, no de una lista escrita a mano que también se
  // desactualiza: el arreglo de arriba y el `redirect()` de abajo tienen que
  // seguir siendo el mismo conjunto.
  const codigos = [...readFileSync('src/app/admin/mi-perfil/acciones.ts', 'utf8')
    .matchAll(/\?error=([a-z_$}{v.]+)/g)]
    .map((m) => m[1])
    .filter((c) => !c.includes('$')); // el interpolado `avatar_${v.motivo}` va aparte

  it('se encontraron códigos que comprobar (si no, la regex se quedó atrás)', () => {
    expect(codigos.length).toBeGreaterThan(0);
  });

  it('cada código literal tiene su mensaje', () => {
    for (const c of codigos) expect(MENSAJE_ERROR[c], `falta mensaje para ?error=${c}`).toBeTruthy();
  });

  it('y cada motivo de rechazo del avatar también (`avatar_${motivo}`)', () => {
    for (const motivo of ['ausente', 'vacio', 'tipo', 'tamano']) {
      expect(MENSAJE_ERROR[`avatar_${motivo}`], motivo).toBeTruthy();
    }
  });

  it('el mensaje de formato nombra los formatos que de verdad se admiten', () => {
    for (const ext of Object.values(TIPOS_AVATAR)) {
      expect(MENSAJE_ERROR.avatar_tipo).toContain(ext.toUpperCase());
    }
  });

  it('y el de tamaño, el techo de verdad', () => {
    expect(MENSAJE_ERROR.avatar_tamano).toContain(String(MAX_AVATAR_BYTES / (1024 * 1024)));
  });

  it('ningún mensaje culpa al usuario de un fallo del sistema', () => {
    // "intenta con otra imagen" era el consejo para TODO, incluido el bucket
    // caído: manda al usuario a probar fotos hasta cansarse por un fallo que
    // no es suyo.
    expect(MENSAJE_ERROR.avatar).toContain('registrado');
    expect(MENSAJE_ERROR.nombre_guardar).toContain('registrado');
  });
});
