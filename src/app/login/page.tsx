import { destinoSeguro } from '@/lib/auth/destino';
import { entrarConGoogle, entrarConEmail } from './acciones';
import { Logo } from '../logo';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// LOS ACTIONS VIVEN EN `acciones.ts`, NO AQUÍ — y es lo que se prueba.
//
// AUDITORÍA 11, G-31 (residual). Esta página tenía SU PROPIA copia de
// `entrarConGoogle`/`entrarConEmail` y montaba ESA en los dos `<form>`,
// mientras `no_autoregistro.test.ts` ejecutaba la de `acciones.ts`: la versión
// medida por la suite no era la que corría. Y la que corría era la vieja, la
// que ante un fallo REAL del envío —cuota de SMTP agotada, Resend 403,
// proyecto caído— redirigía con `error=1` sin escribir una línea: el contralor
// veía "Algo falló. Intenta otra vez." y el evento no dejaba testigo más que
// su navegador (CRÍTICO de operabilidad de la ronda 10, cerrado en
// `acciones.ts` con `logger.error('login.otp_error')`).
//
// `una_sola_copia.test.ts` falla si vuelven a divergir.
// ═══════════════════════════════════════════════════════════════════════════

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; error?: string }>;
}) {
  const sp = await searchParams;
  // Mismo saneo que usan los actions: un solo criterio para el `next`, no dos.
  const next = destinoSeguro(sp?.next ?? '');

  // Clon estructural de usehandle.ai/login (HTML + CSS computado, capturado
  // 2-ago-2026 por curl — Firecrawl estaba sin créditos): mismo layout de dos
  // columnas, mismos radios/espaciados/transiciones, colores literales de
  // Handle (no las variables de marca de Likida, a propósito, para que quede
  // idéntico). Lo único que cambia de contenido es lo que sería falso decir
  // de Likida: el banner de ronda de inversión de Handle, "As seen in" con
  // prensa que Likida no tiene, el selector US/MX/BR y "Contact sales"/"Try
  // Handle" (sin funnel de marketing todavía), "Sign up" (Likida no tiene
  // alta propia — decisión ya tomada y probada), y "Download desktop app"
  // (no existe). La imagen de la derecha es propia, generada en el mismo
  // estilo pixel-art — no la artwork de Handle.
  return (
    <main className="min-h-screen flex bg-white">
      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center px-6 py-6 md:px-10 lg:px-12 lg:py-12">
          <Logo alto="h-6" />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16 md:px-10">
          <div className="w-full max-w-[330px]">
            <h1 className="text-center text-[32px] font-bold leading-[1.05] tracking-[-0.04em] text-[#0a0a0a]">
              Bienvenido a Likida
            </h1>
            <p className="mt-3 text-center text-[14px] leading-relaxed text-[#6b6b6b]">
              El panel de liquidación de tu flota.
            </p>

            {sp?.enviado ? (
              <p className="mt-8 rounded-lg border border-[#e5e5e5] bg-white p-4 text-center text-[14px] text-[#0a0a0a]">
                Te mandamos un link a tu correo. Ábrelo desde este mismo dispositivo.
              </p>
            ) : (
              <>
                <form action={entrarConGoogle} className="mt-8">
                  <input type="hidden" name="next" value={next} />
                  <button type="submit"
                    className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[#e5e5e5] bg-white px-5 py-3 text-[14px] font-medium text-[#0a0a0a] transition-colors hover:bg-[#fafafa]">
                    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                    </svg>
                    Continuar con Google
                  </button>
                </form>

                <div className="my-6 flex items-center gap-4">
                  <span className="h-px flex-1 bg-[#e5e5e5]" />
                  <span className="text-[11px] font-medium tracking-[0.1em] text-[#6b6b6b]">o</span>
                  <span className="h-px flex-1 bg-[#e5e5e5]" />
                </div>

                <form action={entrarConEmail} className="flex flex-col gap-4">
                  <input type="hidden" name="next" value={next} />
                  <input name="email" type="email" required placeholder="tu@flota.com"
                    className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2.5 text-[14px] text-[#0a0a0a] outline-none transition-colors placeholder:text-[#6b6b6b99] focus:border-[var(--marca)]" />
                  <button type="submit"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-full bg-[var(--marca)] px-5 py-3 text-[14px] font-medium text-white transition-colors duration-300 hover:bg-[#9a3412]">
                    Continuar con email
                  </button>
                </form>

                <p className="mt-6 text-center text-[13px] text-[#6b6b6b]">
                  ¿Tu correo no tiene acceso?{' '}
                  <span className="font-medium text-[#0a0a0a]">Pídele a tu flota que te dé de alta.</span>
                </p>
              </>
            )}

            {sp?.error && (
              <p className="mt-4 text-center text-[13px]" style={{ color: 'var(--color-bad)' }}>
                Algo falló. Intenta otra vez.
              </p>
            )}

            {/* Los DOS, no solo privacidad: aquí es donde se acepta el contrato,
                y hasta hoy la única liga era la del aviso — se aceptaban unos
                términos que no había forma de leer desde esta pantalla. */}
            <p className="mt-8 text-center text-[11px] leading-relaxed text-[#6b6b6b]/70">
              Al continuar, aceptas los{' '}
              <a href="/terminos" className="text-[#0a0a0a] underline underline-offset-2 transition-opacity hover:opacity-70">
                Términos de Servicio
              </a>{' '}
              y el{' '}
              <a href="/privacidad" className="text-[#0a0a0a] underline underline-offset-2 transition-opacity hover:opacity-70">
                Aviso de Privacidad
              </a>{' '}
              de Likida.
            </p>
          </div>
        </div>
      </div>

      {/* Panel derecho — solo desktop, igual que el original (`hidden lg:flex`). */}
      <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:pb-12 lg:pl-3 lg:pr-12 lg:pt-12">
        <div className="relative mt-8 min-h-0 flex-1 overflow-hidden rounded-[28px] bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen estática de fondo, no contenido de producto */}
          <img src="/images/login-hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/25" />
        </div>
      </div>
    </main>
  );
}
