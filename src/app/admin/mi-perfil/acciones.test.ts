import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-33, ALTO — /admin/mi-perfil DECÍA "GUARDADO" CON EL ERROR
// TIRADO, Y LA PRIMERA SUBIDA DE ARCHIVO DEL PRODUCTO NO VALIDABA NADA.
//
// Los dos server actions vivían INLINE dentro de `page.tsx` (que además está
// excluido de la medición de cobertura), así que no había forma de ejercerlos.
// Aquí se ejercen, y lo que se fija es:
//
//  1. `update({nombre})` descartaba el `{ error }` de supabase-js —el fallo
//     por valor que `pg.ts:10-20` llama «la familia de bugs más repetida del
//     repo»— y redirigía a `?ok=nombre` igual. Con la 0046 sin aplicar, la
//     pantalla decía "Foto de perfil actualizada." y en la siguiente carga
//     volvía el círculo con la inicial: el síntoma que se reporta es "se
//     borra sola", y sin log no hay nada que mirar.
//  2. La validación era `archivo instanceof File && archivo.size !== 0`: ni
//     tipo ni tamaño. Y el `contentType` salía TAL CUAL del cliente, así que
//     el bucket público de avatares servía lo que el cliente dijera que era.
//     `accept="image/*"` del uploader es del navegador: no es una validación.
//  3. La extensión salía de `archivo.name.split('.').pop()`, así que un `.png`
//     no pisaba el `.jpg` anterior y quedaba un objeto público huérfano por
//     cada formato que el usuario probara.
// ═══════════════════════════════════════════════════════════════════════════

const redirecciones: string[] = [];
class Redirigido extends Error {}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { redirecciones.push(url); throw new Redirigido(url); },
}));

vi.mock('@/lib/auth/guard', () => ({
  requireSuperadmin: async () => ({ userId: 'u-1', rol: 'superadmin', nombre: 'Javier' }),
}));

const guardarNombre = vi.fn();
const guardarAvatarUrl = vi.fn();
const subirAvatarAlBucket = vi.fn();
vi.mock('@/lib/admin/negocio', () => ({
  guardarNombrePerfil: (...a: unknown[]) => guardarNombre(...a),
  guardarAvatarUrlPerfil: (...a: unknown[]) => guardarAvatarUrl(...a),
  subirAvatarPerfil: (...a: unknown[]) => subirAvatarAlBucket(...a),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { actualizarNombre, subirAvatar } = await import('./acciones');
const { validarAvatar, MAX_AVATAR_BYTES, TIPOS_AVATAR } = await import('./avatar-validacion');

/** Corre un action que SIEMPRE termina en `redirect()` (que lanza). */
async function correr(fn: () => Promise<void>): Promise<string> {
  try { await fn(); } catch (e) { if (!(e instanceof Redirigido)) throw e; }
  return redirecciones[redirecciones.length - 1] ?? '';
}

function form(campos: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v as string | Blob);
  return fd;
}

function imagen(bytes: number, tipo = 'image/png', nombre = 'foto.png'): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

beforeEach(() => {
  redirecciones.length = 0;
  guardarNombre.mockReset().mockResolvedValue(undefined);
  guardarAvatarUrl.mockReset().mockResolvedValue(undefined);
  subirAvatarAlBucket.mockReset().mockResolvedValue('https://cdn/u-1/avatar');
  logger.error.mockReset(); logger.warn.mockReset(); logger.info.mockReset();
});

describe('actualizarNombre — no dice "guardado" sin haber guardado', () => {
  it('con la escritura fallando, NO redirige a ?ok= y deja una línea en el log', async () => {
    guardarNombre.mockRejectedValue(new Error('permission denied for table app_user'));
    const url = await correr(() => actualizarNombre(form({ nombre: 'Javier Cámara' })));
    expect(url).not.toContain('ok=');
    expect(url).toContain('error=');
    expect(logger.error).toHaveBeenCalled();
  });

  it('con la escritura OK sí confirma', async () => {
    const url = await correr(() => actualizarNombre(form({ nombre: 'Javier Cámara' })));
    expect(guardarNombre).toHaveBeenCalledWith('u-1', 'Javier Cámara');
    expect(url).toBe('/admin/mi-perfil?ok=nombre');
  });

  it('un nombre vacío no llega a la base', async () => {
    const url = await correr(() => actualizarNombre(form({ nombre: '   ' })));
    expect(guardarNombre).not.toHaveBeenCalled();
    expect(url).toContain('error=nombre');
  });
});

describe('subirAvatar — la primera subida de archivo del producto sí valida', () => {
  it('un text/html disfrazado de foto se rechaza ANTES de tocar el bucket', async () => {
    const url = await correr(() => subirAvatar(form({ avatar: imagen(10, 'text/html', 'foto.png') })));
    expect(subirAvatarAlBucket).not.toHaveBeenCalled();
    expect(url).toContain('error=avatar_tipo');
  });

  it('un archivo más grande que el techo se rechaza ANTES de tocar el bucket', async () => {
    const url = await correr(() => subirAvatar(form({ avatar: imagen(MAX_AVATAR_BYTES + 1, 'image/png') })));
    expect(subirAvatarAlBucket).not.toHaveBeenCalled();
    expect(url).toContain('error=avatar_tamano');
  });

  it('el contentType que llega al bucket sale de NUESTRA tabla, no del cliente', async () => {
    // `archivo.type` lo escribe el navegador (o quien haga el POST a mano):
    // reenviarlo tal cual deja que el cliente decida con qué cabecera se
    // sirve un objeto de un bucket PÚBLICO.
    await correr(() => subirAvatar(form({ avatar: imagen(64, 'image/png', 'raro.JPG') })));
    expect(subirAvatarAlBucket).toHaveBeenCalled();
    const [, , contentType] = subirAvatarAlBucket.mock.calls[0];
    expect(contentType).toBe('image/png');
    expect(Object.values(TIPOS_AVATAR)).toContain(contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1]);
  });

  it('la ruta NO depende del nombre del archivo: un png no deja huérfano al jpg anterior', async () => {
    await correr(() => subirAvatar(form({ avatar: imagen(64, 'image/png', 'a.png') })));
    await correr(() => subirAvatar(form({ avatar: imagen(64, 'image/jpeg', 'b.jpeg') })));
    const rutas = subirAvatarAlBucket.mock.calls.map((c) => c[1]);
    expect(rutas[0]).toBe(rutas[1]);
    expect(rutas[0]).toBe('u-1/avatar');
  });

  it('si la subida falla, NO dice "Foto de perfil actualizada."', async () => {
    subirAvatarAlBucket.mockRejectedValue(new Error('Bucket not found'));
    const url = await correr(() => subirAvatar(form({ avatar: imagen(64) })));
    expect(url).not.toContain('ok=');
    expect(logger.error).toHaveBeenCalled();
  });

  it('si el bucket acepta pero la fila de app_user no se actualiza, tampoco', async () => {
    // ESTE es el caso real de la 0046 sin aplicar: el objeto sube, la columna
    // `avatar_url` no existe, y la pantalla felicitaba igual.
    guardarAvatarUrl.mockRejectedValue(new Error("column 'avatar_url' does not exist"));
    const url = await correr(() => subirAvatar(form({ avatar: imagen(64) })));
    expect(url).not.toContain('ok=');
    expect(url).toContain('error=avatar');
    expect(logger.error).toHaveBeenCalled();
  });

  it('el camino feliz confirma y guarda una URL con rompecachés', async () => {
    const url = await correr(() => subirAvatar(form({ avatar: imagen(64) })));
    expect(url).toBe('/admin/mi-perfil?ok=avatar');
    const [, guardada] = guardarAvatarUrl.mock.calls[0];
    expect(String(guardada)).toMatch(/^https:\/\/cdn\/u-1\/avatar\?t=\d+$/);
  });

  it('sin archivo (submit vacío) no se inventa una subida', async () => {
    const url = await correr(() => subirAvatar(form({})));
    expect(subirAvatarAlBucket).not.toHaveBeenCalled();
    expect(url).toContain('error=avatar');
  });
});

describe('validarAvatar — la regla, aparte de la acción', () => {
  it('acepta los tres formatos que el bucket sirve', () => {
    for (const mime of Object.keys(TIPOS_AVATAR)) {
      expect(validarAvatar(imagen(10, mime)), mime).toEqual({ ok: true, contentType: mime });
    }
  });
  it('un SVG no es un avatar: es un documento con script', () => {
    // Un SVG servido desde un bucket público con `image/svg+xml` ejecuta su
    // `<script>` en el origen del bucket. No entra en la lista.
    expect(validarAvatar(imagen(10, 'image/svg+xml')).ok).toBe(false);
  });
  it('cero bytes es un formulario vacío, no una foto', () => {
    expect(validarAvatar(imagen(0, 'image/png'))).toEqual({ ok: false, motivo: 'vacio' });
  });
  it('lo que no es un archivo se rechaza sin reventar', () => {
    expect(validarAvatar(null).ok).toBe(false);
    expect(validarAvatar('foto.png').ok).toBe(false);
    expect(validarAvatar(undefined).ok).toBe(false);
  });
});
