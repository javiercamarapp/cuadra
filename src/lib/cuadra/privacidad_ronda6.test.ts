import { describe, it, expect } from 'vitest';
import { revisarAvisoIntegral, pideAtencionPrivacidad } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · los dos ALTOS del rubro legal.
// ═══════════════════════════════════════════════════════════════════════════

describe('el filtro de rellenos no puede apagar dominios reales', () => {
  // `'pendiente'` y `'todo'` se buscaban como SUBSTRING sobre la URL completa, y
  // viven dentro de palabras españolas normales: in-de-PENDIENTE, me-TODO-logía.
  // "Independiente" es exactamente como se anuncia media flota mexicana — el
  // segmento que censó Likida.
  //
  // El coste no era cosmético: al marcar la liga inservible, el aviso salía
  // diciendo que la empresa NO ha publicado su aviso integral (afirmación falsa
  // sobre el cumplimiento del cliente) y el operador se quedaba sin el canal
  // ARCO del art. 15 fr. V teniendo uno publicado.
  const reales = [
    'https://transportistaindependiente.mx/aviso-de-privacidad',
    'https://autotransportesindependientes.com.mx/privacidad',
    'https://operadorindependiente.mx/aviso',
    'https://metodologiatransporte.mx/aviso',
    'https://grupotodovia.mx/aviso',
  ];
  for (const u of reales) {
    it(`pasa: ${u.replace('https://', '').slice(0, 40)}`, () => {
      expect(revisarAvisoIntegral(u)).toBe('ok');
    });
  }

  const rellenos: [string, string][] = [
    ['dominio de plantilla', 'https://example.com/aviso'],
    ['plantilla en español', 'https://ejemplo.mx/x'],
    ['tudominio', 'https://tudominio.com/aviso'],
    ['la palabra suelta en la ruta', 'https://miempresa.mx/aviso-pendiente'],
    ['la palabra suelta en el query', 'https://miempresa.mx/?url=todo'],
    ['marcador de "falta capturar"', 'https://miempresa.mx/cambiar'],
    ['no es público', 'http://localhost:3000/aviso'],
    ['ni siquiera es URL', 'no-es-url'],
  ];
  for (const [etq, u] of rellenos) {
    it(`sigue cayendo — ${etq}`, () => {
      expect(revisarAvisoIntegral(u)).not.toBe('ok');
    });
  }

  it('sin liga es "ausente", que NO es lo mismo que inservible', () => {
    // Ausente = la empresa no lo ha publicado. Inservible = puso algo que no
    // sirve. El aviso dice cosas distintas y por eso no se pueden juntar.
    expect(revisarAvisoIntegral(undefined)).toBe('ausente');
    expect(revisarAvisoIntegral('  ')).toBe('ausente');
  });
});

describe('la oposición del art. 26 fr. II se reconoce como se habla', () => {
  // El detector veía el presente ("me opongo") y el infinitivo con clítico
  // pegado ("oponerme"), y no la PERÍFRASIS, que es la forma natural en español
  // hablado. El clítico va suelto y antes del verbo, así que `\boponerme\b` no
  // podía casarlo, y el derecho se perdía sin dejar rastro.
  const ejercen = [
    'me quiero oponer',
    'no me quiero oponer',          // también es ejercicio del derecho
    'quisiera oponerme',
    'me voy a oponer',
    'me gustaría oponerme a eso',
    'me opongo',
    'oponerme',
    'no quiero que me revisen mis tickets con un programa',
    'quiero que lo revise una persona',
    'PRIVACIDAD',
  ];
  for (const t of ejercen) {
    it(`lo atiende: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(true));
  }

  // Se exige la forma de PETICIÓN para no secuestrar la conversación normal de
  // la caseta. Un falso positivo manda una respuesta que el operador no pidió.
  const noEjercen = [
    'listo',
    'mándame mi liquidación',
    'la persona de la caseta no me dio ticket',
    'me quiero ir a Monterrey',
    'opongo mi camión al muro',
  ];
  for (const t of noEjercen) {
    it(`no lo confunde: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(false));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO — "que lo revise una persona" es la misma forma tanto
// para oponerse a una decisión automatizada (art. 26 fr. II) como para pedir
// ayuda con un ticket mal leído por el OCR. Sin distinguir el OBJETO de la
// revisión, la queja real sobre el papel desaparecía sin rastro: el operador
// recibía un discurso de ARCO en vez de ayuda con su comprobante.
// ═══════════════════════════════════════════════════════════════════════════
describe('la oposición ambigua NO secuestra una queja sobre un ticket', () => {
  const quejasDeTicket = [
    'que revise una persona el folio porque el sistema lo leyó mal',
    'necesito que una persona vea este ticket, se ve mal la foto',
    'oye que revise una persona mi comprobante, se ve rara la lectura',
  ];
  for (const t of quejasDeTicket) {
    it(`NO la trata como oposición: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(false));
  }

  // Control: sin vocabulario de papel, "que lo revise una persona" SIGUE
  // siendo oposición — el arreglo no puede volverse un falso negativo general.
  it('control: "quiero que lo revise una persona" (sin ticket/folio) sigue contando', () => {
    expect(pideAtencionPrivacidad('quiero que lo revise una persona')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO — el arreglo de arriba (OBJETO_DE_PAPEL) cerró el falso
// positivo abriendo un falso negativo del otro lado: quien contesta con las
// palabras EXACTAS que el aviso le enseña —"que lo revise una persona, no el
// programa"— también nombra el objeto que se revisa (es inevitable: la
// revisión automatizada es sobre comprobantes), y eso apagaba una oposición
// real. La distinción no es "menciona un papel": es "rechaza explícitamente
// lo automatizado" (RECHAZA_AUTOMATIZADO).
// ═══════════════════════════════════════════════════════════════════════════
describe('la oposición real SÍ cuenta cuando además nombra el objeto que se revisa', () => {
  const oposicionesReales = [
    'quiero que una persona revise mi comprobante en vez del programa',
    'que revise una persona mi comprobante, no el programa automático',
    'quiero que una persona revise mi ticket, no confío en el programa',
  ];
  for (const t of oposicionesReales) {
    it(`SÍ la trata como oposición: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(true));
  }

  // Las quejas de ticket de la ronda 8 (arriba) NO tienen el rechazo explícito
  // —"el sistema lo leyó mal" describe un error, no rechaza el sistema— y
  // tienen que seguir sin contar. Sin este control, ampliar la cobertura aquí
  // podría reabrir el falso positivo que la ronda 8 cerró.
  it('control: la queja de ticket original de la ronda 8 sigue SIN contar', () => {
    expect(pideAtencionPrivacidad('que revise una persona el folio porque el sistema lo leyó mal')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, MEDIO (residual de la misma familia) — el arreglo de la ronda 9
// se calibró contra las TRES frases exactas del hallazgo anterior en vez de
// contra la CLASE de frases, y quedó atado a dos cosas:
//
//   · un vocabulario cerrado — `programa|sistema|robot|bot` —, que deja fuera
//     "máquina" y "computadora", que es como se le llama a esto en la carretera;
//   · una posición fija de la negación — pegada al sustantivo—, así que
//     "no QUIERO que un robot decida" no contaba, aunque trae las dos señales
//     que el arreglo declara buscar.
//
// Y en la misma corrida apareció la otra mitad: la C de ARCO (art. 15 fr. V).
// El detector conocía `dar de baja mis datos` y no `borrar` ni `eliminar` — una
// asimetría de vocabulario, no de diseño. En los cinco casos el mensaje seguía
// de largo hacia el agente y el operador recibía una respuesta sobre su ticket.
// ═══════════════════════════════════════════════════════════════════════════
describe('la oposición cuenta aunque la negación no vaya pegada al sustantivo', () => {
  const oposicionesReales = [
    // Trae las DOS señales: rechazo a lo automatizado y petición de humano.
    // Fallaba porque la negación va pegada a "quiero", no a "robot".
    'no quiero que un robot decida sobre mi ticket, que lo vea alguien',
    // "máquina" y "computadora": el vocabulario real, fuera de la lista.
    'quiero que lo revise un humano y no una maquina, ese comprobante está bien',
    'no estoy de acuerdo con que una computadora revise mis comprobantes',
    // Rechazo pospuesto, con la petición de humano en otro orden.
    'quiero que alguien de verdad vea mi recibo, no el robot',
  ];
  for (const t of oposicionesReales) {
    it(`SÍ la trata como oposición: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(true));
  }

  // Controles de las rondas 8 y 9: ampliar el vocabulario y soltar la posición
  // de la negación no puede reabrir el falso positivo de la queja de ticket.
  const quejasDeTicket = [
    'que revise una persona el folio porque el sistema lo leyó mal',
    'necesito que una persona vea este ticket, se ve mal la foto',
    'no quiero que el sistema me pida el XML otra vez',
    'no quiero que el programa me cobre doble el diesel',
  ];
  for (const t of quejasDeTicket) {
    it(`control: sigue SIN contar: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(false));
  }
});

describe('la cancelación en cristiano es la C de ARCO (art. 15 fr. V)', () => {
  const cancelan = [
    'borren mis datos',
    'quiero que borren mi información personal',
    'ya no quiero que tengan mi teléfono',
    'eliminen mis datos por favor',
    'quiero dar de baja mis datos',
  ];
  for (const t of cancelan) {
    it(`lo atiende: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(true));
  }

  // El objeto tiene que ser SUS DATOS, no un papel del viaje: borrar una foto
  // mal tomada es la petición más común del canal y no es un ARCO.
  const noCancelan = [
    'borré la foto por error, la vuelvo a mandar',
    'eliminé el ticket del hotel sin querer',
    'borra mi último ticket que salió mal',
    'quítame ese gasto que no es mío',
  ];
  for (const t of noCancelan) {
    it(`no lo confunde: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(false));
  }
});
