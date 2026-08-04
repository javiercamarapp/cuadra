#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER USUARIO DEL PANEL. Sin esto, una máquina limpia no entra.
//
// AUDITORÍA 10, ALTO (operabilidad). El camino en una laptop recién clonada
// era este: `npm run seed` + `npm run dev` → /dashboard → `proxy.ts` rebota a
// /login → se teclea el correo → `signInWithOtp` va con
// `shouldCreateUser:false` y no hay nada en `auth.users` → Supabase responde
// `otp_disabled` → la pantalla dice «Te mandamos un link a tu correo» (a
// propósito, para no filtrar qué correos existen) y el link NUNCA llega.
//
// El único alta que existe en el árbol es `/admin/usuarios/nuevo`, y empieza
// con `requireSuperadmin()`: exige una fila `app_user` con `rol='superadmin'`
// que solo se puede crear con esa misma página. El script temporal que hacía
// este trabajo se borró al construirla. Esto lo reemplaza, y esta vez está
// documentado en DEPLOY.md y lo nombra `scripts/seed.sh` al terminar.
//
// LO QUE ESCRIBE, y por qué en ese orden: `app_user.id` TIENE que ser el `id`
// de `auth.users` (`getSessionTenant` busca la fila por el id del usuario
// autenticado), así que primero se crea el usuario de Auth con la Admin API
// —`email_confirm: true`, el primer magic link es la confirmación de verdad—
// y después la fila de `app_user`. Es la misma secuencia de
// `src/lib/auth/provisionar.ts`; se repite aquí en JS porque un script de node
// no puede importar el TS del árbol, y una prueba
// (`observability/runbook.test.ts`) cruza las columnas de los dos para que no
// se separen en silencio.
//
// `tenant_id` va NULO a propósito: en `app_user` un tenant nulo con
// `rol='superadmin'` no es "sin asignar", es "no pertenece a ninguna flota"
// (0001_init.sql:17), y `requireSessionTenant` le da el tenant de la demo.
//
// ES IDEMPOTENTE. Correrlo dos veces con el mismo correo no duplica nada ni
// falla: reutiliza el usuario de Auth que ya exista y reescribe su fila. Un
// bootstrap que revienta al segundo intento no sirve a las 3 a.m.
//
//   USO
//     node --env-file=.env.local scripts/crear-superadmin.mjs javier@ejemplo.mx "Javier"
//
//   o, contra producción, sin archivo:
//     NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/crear-superadmin.mjs javier@ejemplo.mx "Javier"
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const email = (process.argv[2] ?? '').trim();
const nombre = (process.argv[3] ?? '').trim() || null;

function morir(mensaje) {
  console.error(`\n❌ ${mensaje}\n`);
  process.exit(1);
}

if (!email || !email.includes('@')) {
  morir(
    'Falta el correo del superadmin.\n' +
    '   Uso:  node --env-file=.env.local scripts/crear-superadmin.mjs correo@dominio.mx "Nombre"',
  );
}

// Se comprueban las DOS antes de tocar nada: con la URL puesta y la llave no,
// el cliente falla a media secuencia y puede dejar el usuario de Auth creado
// sin su fila de `app_user` — un usuario que entra y aterriza en /sin-acceso,
// que es justo el síntoma más caro de diagnosticar de este producto.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  morir(
    'Faltan variables de entorno:\n' +
    `   NEXT_PUBLIC_SUPABASE_URL   ${url ? 'ok' : 'FALTA'}\n` +
    `   SUPABASE_SERVICE_ROLE_KEY  ${service ? 'ok' : 'FALTA'}\n` +
    '   Salen de Supabase → Project Settings → API. La service role SALTA la RLS:\n' +
    '   no la pongas en el navegador ni la subas al repo.',
  );
}

const admin = createClient(url, service, { auth: { persistSession: false } });

/** El usuario de Auth que ya exista con ese correo, o `null`. */
async function buscarEnAuth(correo) {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) morir(`No se pudo consultar auth.users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === correo.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const creado = await admin.auth.admin.createUser({ email, email_confirm: true });
let userId = creado.data?.user?.id;

if (!userId) {
  // El correo ya está en `auth.users` — el caso normal al reintentar. Se
  // reutiliza en vez de fallar: lo que falta puede ser solo la fila de
  // `app_user`, que es exactamente el estado que deja un intento a medias.
  const existente = await buscarEnAuth(email);
  if (!existente) morir(`No se pudo crear el usuario de Auth: ${creado.error?.message ?? 'sin detalle'}`);
  userId = existente.id;
  console.log(`▸ El usuario de Auth ya existía (${userId}); se reutiliza.`);
} else {
  console.log(`▸ Usuario de Auth creado (${userId}).`);
}

// `upsert` por `id` y no `insert`: si la fila quedó a medias en un intento
// anterior, esto la corrige en vez de reventar con un duplicate key.
const { error } = await admin.from('app_user').upsert(
  { id: userId, tenant_id: null, email: email, nombre: nombre, rol: 'superadmin' },
  { onConflict: 'id' },
);
if (error) {
  morir(
    `No se pudo escribir la fila de app_user: ${error.message}\n` +
    '   Si dice que la tabla o una columna no existe, faltan migraciones:\n' +
    '     DATABASE_URL="postgres://..." npm run seed',
  );
}

console.log(`
✅ Superadmin listo: ${email}

   Siguiente, en este MISMO navegador (el code_verifier del PKCE vive en su
   cookie: pedir el link aquí y abrirlo en el teléfono NO funciona):

     1. Abre /login y teclea ${email}
     2. Abre el magic link que llega al correo
     3. Ya dentro, da de alta al resto desde /admin/usuarios/nuevo

   Si el correo no llega, el remitente es el que manda: ver DEPLOY.md,
   «Lo que el login necesita del lado de Supabase». En el log del servidor,
   \`login.otp_error\` dice que el envío falló.
`);
