import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-31 (residual) — la página de login tenía SU PROPIA copia de
// los dos server actions, y la copia probada era la otra.
//
// `login/acciones.ts` existe justamente porque los actions vivían dentro del
// componente y su única prueba leía el TEXTO fuente: el auditor de la ronda 10
// rompió las tres propiedades que protegía —el límite por IP, el sentido de
// `esCorreoSinCuenta` y `shouldCreateUser:false`— y las tres siguieron verdes.
// `no_autoregistro.test.ts` ya EJECUTA los de `acciones.ts`.
//
// Pero al traer ese archivo, `page.tsx` se quedó con sus copias inline y
// siguió montándolas en los dos `<form action={…}>`. O sea: la versión que
// corre en producción NO es la que la suite mide. Y la que corre es la vieja,
// la que no escribe una línea cuando el envío del magic link falla de verdad
// —cuota de SMTP agotada, Resend 403, proyecto caído— que es el CRÍTICO de
// operabilidad que `acciones.ts` cierra con `logger.error('login.otp_error')`.
//
// Esta prueba ata las dos: si vuelven a divergir, falla aquí.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src', 'app', 'login');
const pagina = () => readFileSync(join(RAIZ, 'page.tsx'), 'utf8');
const acciones = () => readFileSync(join(RAIZ, 'acciones.ts'), 'utf8');

describe('G-31 · /login monta los actions PROBADOS, no una segunda copia', () => {
  it('la página los importa de `acciones.ts`', () => {
    expect(pagina(), 'los `<form action={…}>` apuntan a una copia local')
      .toMatch(/import\s*\{[^}]*entrarConEmail[^}]*\}\s*from\s*['"]\.\/acciones['"]/);
  });

  it('la página NO vuelve a implementarlos', () => {
    const texto = pagina();
    expect(texto, 'segunda definición de entrarConEmail dentro del componente')
      .not.toMatch(/(async\s+)?function\s+entrarConEmail/);
    expect(texto).not.toMatch(/(async\s+)?function\s+entrarConGoogle/);
  });

  it('el login de la página no habla con Supabase Auth por su cuenta', () => {
    // Si `page.tsx` vuelve a llamar `signInWithOtp`/`signInWithOAuth`, hay otra
    // vez dos caminos y uno sin probar.
    expect(pagina()).not.toMatch(/signInWithOtp|signInWithOAuth/);
  });

  it('CONTROL · `acciones.ts` sigue siendo el que tiene las tres garantías', () => {
    const texto = acciones();
    expect(texto, 'el autoregistro por correo').toContain('shouldCreateUser: false');
    expect(texto, 'el límite por IP').toContain("dentroDelLimite('login:email')");
    expect(texto, 'el fallo caro sin rastro — el CRÍTICO de operabilidad').toContain('login.otp_error');
  });
});
