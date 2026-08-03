import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// REVISIÓN FINAL de la rama de auth — dos propiedades de /login que un cambio
// de una línea puede deshacer sin que ninguna otra prueba se entere.
//
//  · `shouldCreateUser: false`. El default de Supabase es `true`: sin esa
//    opción, CUALQUIER correo tecleado en la caja crea un `auth.users` real,
//    justo lo contrario de la decisión 1 del spec (nadie se da de alta solo;
//    las cuentas las crea `provisionarUsuario`). Es una omisión invisible:
//    la pantalla se comporta igual.
//  · El límite por IP. El passcode que este login reemplaza lo tenía
//    (`acceso/page.tsx`); aquí el costo de no tenerlo es mayor, porque cada
//    intento gasta cuota del SMTP de Supabase — la única vía de entrada
//    mientras Google OAuth no esté configurado.
//
// Se lee el fuente, como en `dashboard/foto_no_expuesta.test.ts`: los server
// actions viven dentro del componente y no se pueden importar sueltos.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('/login no se autoregistra ni se queda sin límite', () => {
  it('pide shouldCreateUser: false al mandar el magic link', () => {
    expect(PAGINA).toMatch(/shouldCreateUser:\s*false/);
  });

  it('limita por IP antes de llamar a Supabase', () => {
    expect(PAGINA).toMatch(/rateLimit\(/);
    expect(PAGINA).toMatch(/dentroDelLimite\('login:email'\)/);
  });

  it('el correo sin cuenta no se distingue del enviado: ambos caen en enviado=1', () => {
    // Si esto se rompe, /login vuelve a ser un oráculo para enumerar qué
    // correos son contralores reales.
    expect(PAGINA).toMatch(/esCorreoSinCuenta/);
    expect(PAGINA).toMatch(/otp_disabled/);
  });

  // CRÍTICO de la auditoría 10 (operabilidad). Se registraba SOLO el caso
  // benigno (`login.otp_sin_cuenta`, un correo que no tiene cuenta). El fallo
  // que de verdad importa —cuota de SMTP agotada, config rota, proyecto
  // caído— salía sin una sola línea, y el SMTP de hoy es el sandbox de
  // Supabase, del que ya se sabe que rebota. El 6-ago, un contralor que no
  // pueda entrar dejaría cero rastro.
  //
  // ADVERTENCIA HONESTA sobre esta prueba: lee el fuente, no ejecuta. Los
  // server actions viven dentro del componente y no se pueden importar
  // sueltos. El auditor de pruebas de esta misma ronda mostró que este idioma
  // deja pasar mutaciones; anclar esto de verdad exige extraer el manejo de
  // error a un módulo propio, que es un cambio de forma y no cabía en el
  // alcance de este arreglo. Queda anotado como deuda.
  it('el fallo REAL de envío del magic link se registra, no solo el correo sin cuenta', () => {
    expect(PAGINA).toMatch(/logger\.error\('login\.otp_error'/);
  });

  it('y lo registrado no arrastra el correo del usuario', () => {
    const linea = PAGINA.match(/logger\.error\('login\.otp_error',[^)]*\)/)?.[0] ?? '';
    expect(linea).not.toMatch(/\bemail\b/);
  });
});
