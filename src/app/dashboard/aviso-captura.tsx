import { TriangleAlert } from 'lucide-react';
import { CAPTURA } from '@/lib/cuadra/operacion';

/**
 * "No se guardó, y esto es lo que pasó" — la cinta de las escrituras del
 * encargado.
 *
 * Existe porque el camino anterior era este: la escritura chocaba contra un
 * índice único (dos clics en el tenant del demo: dar de alta un segundo viaje
 * al mismo chofer), la excepción subía, y `dashboard/error.tsx` pintaba «No se
 * pudo cargar el panel — hubo un problema al leer los datos» con un hash de
 * incidente. Doblemente falso: no fue una lectura y no es un incidente. Y el
 * encargado se quedaba sin la única frase que le sirve.
 *
 * El mensaje se resuelve por CÓDIGO, nunca se arrastra el texto en el query
 * string: la URL no puede ser un sitio donde alguien ponga la frase que quiera
 * bajo el encabezado de Likida. Un código que no está en el catálogo no pinta
 * nada.
 */
export default function AvisoCaptura({ codigo }: { codigo?: string }) {
  const mensaje = codigo ? CAPTURA[codigo] : undefined;
  if (!mensaje) return null;
  return (
    <div
      className="flex items-start gap-2.5 px-5 py-3.5 rounded-xl text-sm"
      style={{ background: 'var(--badbg)', border: '1px solid var(--bad)', color: 'var(--ink)' }}
      role="status"
    >
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="shrink-0 mt-0.5"
        style={{ color: 'var(--bad)' }} />
      <span>
        <strong style={{ color: 'var(--bad)' }}>No se guardó.</strong> {mensaje}
      </span>
    </div>
  );
}
