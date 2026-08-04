import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  filasAcreditables,
  RESERVA_PEAJE,
  ETIQUETA_PEAJE,
  RESERVA_IVA_ATADO_AL_ISR,
  motivosQueCondicionanElIva,
} from './acreditable';
import { resumenCuadre } from '../cuadre/resumen';
import type { Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 11 · G-05 (ALTO, fiscal, REINCIDENTE) — LA RESERVA SE ESCRIBIÓ TRES
// VECES Y EL CANAL POR EL QUE SE VENDE SE QUEDÓ SIN LA MITAD.
//
// Dos hechos medidos sobre el árbol antes del arreglo:
//
//  1. `• Peaje 50%: $12,400.00 (sujeto a elegibilidad)` en `cuadre/resumen.ts`
//     es una COPIA a mano del texto que `liquidacion/acreditable.ts` pone en el
//     PDF. Dos copias del mismo dictamen fiscal se separan (CLAUDE.md: «una
//     cifra fiscal que se lee distinto en dos pantallas se lee como dos
//     cálculos»). El repo ya tenía tres copias del literal: `acreditable.ts`,
//     `resumen.ts` y `app/dashboard/acred.tsx`.
//
//  2. EL IVA. `liquidacion/acreditable.ts` condiciona el renglón de IVA cuando
//     el mismo hecho ya condiciona la deducción para ISR —
//     `permiso_cre_no_verificable` se dispara SIEMPRE que hay XML de
//     combustible — porque `normas/liva-5.yaml` (verificado_fuente_primaria),
//     fracción I, dice literalmente:
//
//       «...se consideran estrictamente indispensables las erogaciones
//       efectuadas por el contribuyente QUE SEAN DEDUCIBLES PARA LOS FINES DEL
//       IMPUESTO SOBRE LA RENTA...»
//
//     No son dos requisitos: es uno. El PDF del mismo viaje imprimía
//     «IVA acreditable (LIVA art. 5) — sujeto a la deducibilidad para ISR» y
//     WhatsApp, sobre las MISMAS diferencias, imprimía «• IVA: $689.66» a
//     secas. El operador y el contralor leen dos veredictos distintos del mismo
//     motor sobre el mismo peso.
// ═══════════════════════════════════════════════════════════════════════════

const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1', totalComprobado: 24800, totalAnticipo: 24800, diferencia: 0,
  estatus: 'cuadrada', diferencias: [], gastos: [],
  totalDeducible: 24800, totalNoDeducible: 0, totalPorConfirmar: 0,
  ivaAcreditable: 0, peajeAcreditable: 0, litrosDieselAcreditables: 0, iepsAcreditable: 0,
};

describe('la reserva del peaje se escribe UNA vez y se lee en las dos superficies', () => {
  it('el label del PDF se arma con la constante, no con un literal suelto', () => {
    const r = filasAcreditables({ ivaAcreditable: 0, peajeAcreditable: 500, litrosDieselAcreditables: 0 })!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.label).toBe(ETIQUETA_PEAJE);
    expect(ETIQUETA_PEAJE).toContain(RESERVA_PEAJE);
  });

  it('WhatsApp lleva la MISMA reserva, importada del mismo módulo', () => {
    const texto = resumenCuadre({ ...LIQ, peajeAcreditable: 12400 }, true, 'contralor');
    expect(texto).toContain('12,400');
    expect(texto).toContain(RESERVA_PEAJE);
  });

  // El grep-test, del mismo estilo que `formato.test.ts`: la reserva es un
  // dictamen fiscal, y un dictamen con dos redacciones son dos dictámenes.
  //
  // La copia que queda viva está en el dominio del panel (`/dashboard`), que en
  // esta ronda lo arregla otro agente: se nombra aquí, con su ruta, para que la
  // prueba siga cazando CUALQUIER copia NUEVA en vez de quedarse muda. Cuando
  // `acred.tsx` importe la constante, esta línea se borra y no cambia nada más.
  const PENDIENTE_OTRO_DOMINIO = ['src/app/dashboard/acred.tsx'];

  it('ningún archivo de `src/` reescribe la reserva a mano', () => {
    const archivos: string[] = [];
    const caminar = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) caminar(p);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) archivos.push(p);
      }
    };
    const raiz = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');   // src/
    caminar(raiz);

    const culpables = archivos.filter((p) => {
      if (p.endsWith('/liquidacion/acreditable.ts')) return false;   // la fuente
      if (PENDIENTE_OTRO_DOMINIO.some((q) => p.endsWith(q.replace(/^src/, '')))) return false;
      const src = readFileSync(p, 'utf8');
      // Solo el CÓDIGO: los comentarios pueden (y deben) nombrar la reserva.
      const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return sinComentarios.includes(RESERVA_PEAJE) || sinComentarios.includes(RESERVA_IVA_ATADO_AL_ISR);
    });
    expect(culpables, 'importa la constante de `liquidacion/acreditable.ts`').toEqual([]);
  });
});

describe('el IVA no sale afirmado donde el ISR va condicionado (LIVA 5, fr. I)', () => {
  // El caso del hallazgo: diésel con XML → `permiso_cre_no_verificable`, que
  // condiciona la deducción para ISR y por tanto el acreditamiento del IVA.
  const conPermisoCre = {
    ...LIQ,
    ivaAcreditable: 689.66,
    diferencias: [{ tipo: 'permiso_cre_no_verificable', concepto: 'diesel', monto: 0, nota: '—' }],
  } as Omit<Liquidacion, 'id' | 'creadaEn'>;

  it('el motivo se calcula con la MISMA función que usa el PDF', () => {
    expect(motivosQueCondicionanElIva(conPermisoCre.diferencias)).toHaveLength(1);
    expect(motivosQueCondicionanElIva(LIQ.diferencias)).toHaveLength(0);
  });

  it('el PDF ya lo condicionaba…', () => {
    const r = filasAcreditables(conPermisoCre)!;
    const iva = r.filas.find((f) => f.label.includes('IVA'))!;
    expect(iva.tono).toBe('condicionado');
    expect(iva.label).toContain(RESERVA_IVA_ATADO_AL_ISR);
  });

  it('…y WhatsApp decía «• IVA: $689.66» a secas sobre las mismas diferencias', () => {
    const texto = resumenCuadre(conPermisoCre, true, 'contralor');
    expect(texto).toContain('689.66');
    expect(texto, 'el PDF lo condiciona y el mensaje lo afirmaba').toContain(RESERVA_IVA_ATADO_AL_ISR);
  });

  // CONTROL: sin ningún motivo, el IVA es una cifra medida del XML y se afirma.
  it('control: sin motivo, el IVA sigue siendo una cifra afirmada', () => {
    const texto = resumenCuadre({ ...LIQ, ivaAcreditable: 581.38 }, true, 'contralor');
    expect(texto).toContain('581.38');
    expect(texto).not.toContain(RESERVA_IVA_ATADO_AL_ISR);
  });
});
