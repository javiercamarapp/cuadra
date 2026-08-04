import { LifeBuoy } from 'lucide-react';
import SeccionPendiente from '../pendiente';
import { exigirVerRuta } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
// Techo explícito: sin él, una lectura lenta se lleva el default de la
// plataforma y la página cuelga sin decirlo (auditoría 11, G-52).
export const maxDuration = 60;

export default async function SoportePage() {
  await exigirVerRuta('/dashboard/soporte');
  return (
    <SeccionPendiente
      Icono={LifeBuoy}
      titulo="Soporte & Quejas"
      subtitulo="Reclamaciones de tus clientes sobre lo que ya se movió"
      falta={
        <>
          Lo que sale mal EN LA OPERACIÓN ya tiene dónde vivir y dónde verse: retrasos, averías, daños, faltantes y
          desvíos se levantan en <strong>Incidencias</strong> —dos renglones más arriba en este mismo menú—, con su
          prioridad, su estado y su reloj de SLA. Esta pantalla es lo otro: la queja del CLIENTE.
          <br /><br />
          Y ahí sí falta la pieza de raíz: no existe tabla de clientes. Una queja sin quién la levanta no se puede
          agrupar, ni contestar, ni medir. Tampoco hay encuesta de satisfacción, ni plazo de reclamación corriendo
          contra nadie.
          <br /><br />
          Si necesitas algo de Likida ahora, es por WhatsApp — que es donde ya está tu operación.
        </>
      }
      cuandoExista={[
        'Quejas por cliente y por motivo — dónde se repite el problema',
        'La queja del cliente ligada a la incidencia operativa que la causó',
        'Claims / OS&D con sus plazos legales (9 meses, 120 días)',
        'CSAT: qué tan satisfecho quedó quien levantó la queja',
      ]}
    />
  );
}
