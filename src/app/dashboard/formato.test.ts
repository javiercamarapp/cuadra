import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';
import { litros, fechaMx } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// El contralor compara la pantalla con el PDF que le mandó a su contador.
// Estas pruebas fijan que las dos cifras que puede cruzar —litros elegibles y
// fecha de la liquidación— digan lo mismo en los dos sitios.
// ═══════════════════════════════════════════════════════════════════════════

describe('litros: una sola representación, la del PDF', () => {
  it('conserva los dos decimales que la lista redondeaba a entero', () => {
    // La tarjeta grande del panel decía "152 L" y al hacer clic el detalle
    // decía "152.35 L" (auditoría 5, frontend, MEDIO 1).
    expect(litros(152.35)).toBe('152.35 L');
    expect(litros(1234.56)).toBe('1,234.56 L');
  });

  it('no rellena con ceros los valores redondos — igual que el PDF', () => {
    expect(litros(1850)).toBe('1,850 L');
    expect(litros(0)).toBe('0 L');
  });

  it('coincide carácter por carácter con lo que imprime el PDF', () => {
    // `pdf.ts` usa `toLocaleString('es-MX')` a secas. El tope de 2 decimales
    // solo puede diferir si llegara un valor con 3+, y el motor redondea a 2.
    for (const v of [0, 0.5, 152.35, 1234.56, 1850, 98765.4]) {
      expect(litros(v)).toBe(`${v.toLocaleString('es-MX')} L`);
    }
  });
});

describe('fechaMx: la fecha del cliente, no la del servidor', () => {
  it('una liquidación cerrada a las 20:00 de CDMX NO salta al día siguiente', () => {
    // created_at real que devuelve PostgREST para el 31-jul-2026 20:00 CST.
    // `.slice(0, 10)` daba "2026-08-01": en el corte mensual, una liquidación
    // de julio aparecía listada en agosto (auditoría 5, frontend, MEDIO 3).
    expect('2026-08-01T02:00:00.000+00:00'.slice(0, 10)).toBe('2026-08-01'); // el bug
    expect(fechaMx('2026-08-01T02:00:00.000+00:00')).toBe('31 jul 2026');   // el arreglo
  });

  it('respeta el día cuando la hora local y la UTC coinciden', () => {
    expect(fechaMx('2026-07-31T15:00:00.000+00:00')).toBe('31 jul 2026');
  });

  it('usa el mismo formato que el PDF (día, mes corto, año)', () => {
    expect(fechaMx('2026-08-01T18:00:00.000+00:00')).toBe('01 ago 2026');
  });

  it('una fecha ausente o rota se pinta como guion, no como "Invalid Date"', () => {
    expect(fechaMx(undefined)).toBe('—');
    expect(fechaMx(null)).toBe('—');
    expect(fechaMx('')).toBe('—');
    expect(fechaMx('no es una fecha')).toBe('—');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL GUARDARRAÍL TENÍA UN HUECO, Y UNA PÁGINA NUEVA YA SE COLÓ POR ÉL.
//
// `lib/formato.test.ts` impide una segunda copia del formato haciendo grep de
// `toLocaleString('es-MX'` sobre todo `src/`. `toLocaleDateString` NO contiene
// esa subcadena, así que `admin/page.tsx:22` formateaba fechas por su cuenta
// —«lunes, 3 de agosto de 2026», donde `fechaMx` dice «03 ago 2026»— y la
// compuerta pasaba en verde (auditoría 10, frontend, BAJO).
//
// El daño de ESA copia era cosmético. Lo que no lo es: el hallazgo que aquel
// archivo documenta sobrevivió TRES rondas por exactamente esto —se arreglaban
// las copias conocidas y no se impedía la siguiente—, y la prueba afirmaba, con
// el comentario de `dashboard/formato.ts` repitiéndolo, proteger algo que no
// protegía del todo.
//
// Aquí se cierra sobre la familia entera: `toLocaleString`,
// `toLocaleDateString` y `toLocaleTimeString` con locale mexicano. El único
// archivo que puede formatear sigue siendo `src/lib/formato.ts`.
// ═══════════════════════════════════════════════════════════════════════════

describe('NO puede volver a haber una copia a mano del formato mexicano', () => {
  // `grep -E` sobre la familia completa, no sobre un literal. El `|| true`
  // evita que un cero-resultados (exit 1 de grep) tumbe la prueba.
  const archivos = execSync(
    `grep -rlE "toLocale(Date|Time)?String\\('es-MX'" src/ --include='*.ts' --include='*.tsx' || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('solo `lib/formato.ts` formatea fechas y cifras mexicanas', () => {
    // SE MIRA EL CÓDIGO, NO LOS COMENTARIOS: el encabezado de `formato.ts`
    // CITA la llamada para contar la historia del hallazgo, y una prueba que
    // prohíbe hablar del bug que vigila obliga a borrar la explicación que
    // evita repetirlo.
    const fuera = archivos
      .filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'))
      .filter((f) => /toLocale(Date|Time)?String\('es-MX'/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      fuera,
      `estos archivos formatean por su cuenta en vez de usar formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });

  it('y el hueco concreto por el que se coló `/admin` queda cerrado', () => {
    // Regresión del hueco, no del archivo: el grep del guardarraíl viejo no ve
    // esta cadena. Si alguien vuelve a estrecharlo, esto falla.
    const grepViejo = /toLocaleString\('es-MX'/;
    expect(grepViejo.test("new Date().toLocaleDateString('es-MX', {})")).toBe(false);
    expect(/toLocale(Date|Time)?String\('es-MX'/.test("new Date().toLocaleDateString('es-MX', {})")).toBe(true);
  });
});
