import { Calculator } from 'lucide-react';
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


export default async function CotizadorPage() {
  await exigirVerRuta('/dashboard/cotizador');
  return (
    <SeccionPendiente
      Icono={Calculator}
      titulo="Cotizador"
      subtitulo="Cotizar un viaje en segundos, con su margen esperado"
      falta={
        <>
          Falta la mitad del cálculo. Likida sí sabe estimar el <strong>costo</strong> de un viaje —el tabulador de
          combustible por placa ya existe y el motor lo usa para detectar consumo raro—, pero no tiene tarifas: no
          hay tabla de precios por ruta, ni por kilómetro, ni por tonelada.
          <br /><br />
          Y sin registrar los kilómetros de cada ruta tampoco hay contra qué calcular el diésel y las casetas de un
          viaje que todavía no ocurre.
        </>
      }
      cuandoExista={[
        'Cotización en segundos: ruta, peso y kilómetros → tarifa sugerida',
        'Casetas y combustible estimados de esa ruta, antes de aceptarla',
        'Margen esperado del viaje — para no aceptar carga que te cuesta dinero',
        'Propuesta compartible con tu cliente',
        'Historial de cotizaciones y qué tantas se convirtieron en viaje',
      ]}
    />
  );
}
