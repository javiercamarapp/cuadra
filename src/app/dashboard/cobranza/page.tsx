import { Landmark } from 'lucide-react';
import SeccionPendiente from '../pendiente';
import { exigirVerRuta } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
/**
 * TECHO DE LA PÁGINA. Sin él, una Supabase degradada deja la pestaña girando
 * hasta el tope de la plataforma —300 s en el plan pro— contra un contralor
 * que está mirando. El tope POR CONSULTA ya existe (`acotada`, 8 s); esto
 * acota la suma de las que la página monta en paralelo (auditoría 11, G-52).
 */
export const maxDuration = 60;


export default async function CobranzaPage() {
  await exigirVerRuta('/dashboard/cobranza');
  return (
    <SeccionPendiente
      Icono={Landmark}
      titulo="Cobranza"
      subtitulo="Lo que te deben y qué tanto tardan en pagarte"
      falta={
        <>
          No hay facturación emitida en el sistema, así que no hay nada que cobrar que Likida conozca. No existe
          tabla de facturas propias, ni de pagos recibidos, ni de recordatorios enviados.
          <br /><br />
          Los CFDI que Likida sí maneja son los que tú <strong>recibes</strong> de tus proveedores (diésel,
          casetas) — están en Facturación. Es lo contrario de la cobranza.
        </>
      }
      cuandoExista={[
        'Total por cobrar, y cuánto de eso ya está vencido',
        'DSO: cuántos días tardas en cobrar, y si esa cifra mejora o empeora',
        'Facturas por estatus — emitida, por vencer, vencida, pagada',
        'Recordatorios por WhatsApp y qué tantos pagos gatillaron',
        'Link de rastreo para tu cliente: ve dónde va su carga y su evidencia de entrega',
      ]}
    />
  );
}
