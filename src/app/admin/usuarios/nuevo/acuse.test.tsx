import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO (frontend) — «dar de alta un usuario en /admin no acusa
// recibo ni error: los dos parámetros que el server action escribe en la URL
// no los lee nadie».
//
// El action hacía `redirect('/admin?creado=1')` en el camino bueno y
// `redirect('/admin/usuarios/nuevo?error=1')` en el malo, y NINGUNA de las dos
// páginas recibía `searchParams`. Javier elegía flota, tecleaba
// `contralor@innovativos.mx`, rol "Contador", apretaba *Crear usuario*… y
// aterrizaba en una pantalla idéntica a la de antes: sin toast, sin fila nueva
// visible (el roster vive en `/admin/equipo`, otra página). No había forma de
// saber si se creó — y quien no sabe, lo crea otra vez para asegurarse.
//
// Y el camino de error era peor: `provisionarUsuario` LANZA cuando
// `createUser` falla, y el caso normal es correo repetido. Bajo `/admin` no hay
// `error.tsx` en ningún segmento, así que ese throw subía hasta
// `global-error.tsx` y reemplazaba la consola entera por «Código del incidente:
// 8f3c…». Teclear dos veces el mismo correo tiraba toda la pantalla.
//
// Es la única tarea de escritura real de /admin: la que sustituye al script
// `scripts/tmp-provisionar-*.ts`.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: async () => ({ userId: 'u-1', nombre: 'Javier' }) }));
vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: async () => ({ flotas: [{ id: 't-1', nombre: 'Transportes Innovativos' }] }),
}));

const NuevoUsuario = (await import('./page')).default;
const { mensajeDeAlta } = await import('./page');

const pintar = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await NuevoUsuario({ searchParams: Promise.resolve(sp) }) as React.ReactElement);

describe('el alta acusa recibo', () => {
  it('tras crear, la pantalla dice que se creó Y a quién', async () => {
    const html = await pintar({ creado: 'contralor@innovativos.mx' });
    expect(html, 'sin acuse, quien no sabe si funcionó lo crea otra vez').toMatch(/cre[óo]/i);
    expect(html).toContain('contralor@innovativos.mx');
  });

  it('y ofrece ir al roster, que es donde la fila nueva sí se ve', async () => {
    expect(await pintar({ creado: 'contralor@innovativos.mx' })).toContain('/admin/equipo');
  });

  it('el formulario sigue ahí para dar de alta al siguiente', async () => {
    const html = await pintar({ creado: 'contralor@innovativos.mx' });
    expect(html).toContain('Crear usuario');
    expect(html).toContain('Transportes Innovativos');
  });
});

describe('el alta acusa el error en su propia pantalla, sin tirar la consola', () => {
  it('el motivo del fallo se pinta en la página del formulario', async () => {
    const html = await pintar({ error: 'Ese correo ya tiene cuenta.' });
    expect(html).toContain('Ese correo ya tiene cuenta.');
    // Y el formulario sigue puesto: el error no es una pantalla de incidente.
    expect(html).toContain('Crear usuario');
  });

  it('el caso más probable —correo repetido— se traduce a algo accionable', () => {
    // Lo que devuelve Supabase Auth: «A user with this email address has
    // already been registered». Sin traducir, el superadmin lee un error de
    // API en inglés y no sabe que el alta ya estaba hecha.
    const m = mensajeDeAlta(new Error('A user with this email address has already been registered'));
    expect(m).toMatch(/ya tiene cuenta|ya está dado de alta|ya existe/i);
    expect(m, 'el mensaje se pinta en la consola: no puede llevar jerga de API').not.toMatch(/registered/i);
  });

  it('un fallo que no es el repetido conserva su motivo, no se lo traga', () => {
    // Ese chofer no pertenece a esta flota / no se pudo verificar el operador…
    const m = mensajeDeAlta(new Error('Ese chofer no pertenece a esta flota.'));
    expect(m).toContain('Ese chofer no pertenece a esta flota.');
  });

  it('un throw sin mensaje sigue diciendo algo, no cadena vacía', () => {
    expect(mensajeDeAlta({}).length).toBeGreaterThan(0);
  });

  // CONTROL. Sin parámetros no hay banda de nada: la pantalla limpia es la
  // pantalla limpia.
  it('control: sin `creado` ni `error` la página no inventa un acuse', async () => {
    const html = await pintar();
    expect(html).not.toMatch(/cre[óo] la cuenta|no se pudo crear/i);
    expect(html).toContain('Crear usuario');
  });
});
