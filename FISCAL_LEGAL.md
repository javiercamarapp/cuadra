# Camino fiscal y legal — lo que Likida tiene que respetar

Investigado el 27-jul-2026. Cada afirmación trae su fundamento. Lo que no pude
verificar está marcado como **SIN VERIFICAR** — no se construye encima de eso
sin comprobarlo antes.

> **ERRATA CORREGIDA (27-jul-2026).** La versión original de §1.6 citaba la factura
> global como "RMF 2.7.1.24". Es una cita muerta: se renumeró a **2.7.1.21** desde la
> RMF 2022, y hoy la 2.7.1.24 trata devolución de IVA a turistas. Ya está corregido
> abajo. El dictamen completo vive en `docs/conocimiento/10-contradicciones.md`.
>
> Esto no es asesoría fiscal. Es la lectura de las fuentes primarias para
> decidir qué construye Likida. Antes de prometerle números a un cliente,
> valídalo con un contador del sector.

---

## 1. FISCAL — las reglas que cambian el producto

### 1.1 El diésel en efectivo no es deducible — POR REGLA GENERAL

> **No leas esta sección sola.** Para el segmento que Likida vende —autotransporte
> de carga federal— hay una excepción que vale dinero, y está en §1.2. Un motor de
> reglas que aplique solo lo de abajo **le quita deducciones legítimas a la flota**.

**Art. 27, fr. III, 2º párrafo LISR.** Para combustible el pago debe ser con
transferencia, cheque nominativo, tarjeta de crédito/débito/servicios o monedero
electrónico autorizado por el SAT — **aun cuando la compra no exceda $2,000**.

El SAT lo dice sin rodeos: *"Si pagas en efectivo no es deducible aun cuando
obtengas la factura electrónica"*.

**Esto es lo más importante de todo el documento**, porque el operador de una
flota carga diésel en efectivo todo el tiempo. Conseguir el CFDI **no salva** ese
gasto por sí solo.

### 1.2 …pero el autotransporte de carga federal tiene una facilidad del 15%

**RFA 2026, regla 2.9** (DOF 17-feb-2026, vigente del 18-feb-2026 al 31-dic-2026).

Los contribuyentes dedicados **exclusivamente al autotransporte terrestre de
carga federal** cumplen el requisito del Art. 27 aunque paguen combustible por
medios distintos a los electrónicos, **siempre que eso no exceda el 15% del
total de los pagos por consumo de combustible**.

- Pasaje y turismo foráneo: **regla 3.12** (mismo 15%).
- Agrícolas, silvícolas, ganaderas y pesqueras: **regla 1.9**.

**Lo que Likida tiene que hacer con esto:** llevar el contador. *"Llevas 11.4% de
tu diésel en efectivo este mes; el tope es 15%."* Ningún competidor generalista
(Zumma, Clara, FacturaGPT) puede darle eso a una flota, porque no saben en qué
régimen está su usuario. **Aquí es donde Likida gana y no en leer mejor el
ticket.**

Pasado el 15%, el excedente **no es deducible** aunque tenga CFDI perfecto.

**Matiz que cuesta dinero si se ignora:** ese 15% conserva la deducción para
**ISR**, pero **NO habilita el acreditamiento del IEPS**. Son dos beneficios
distintos y el efectivo solo salva uno.

### 1.3 El CFDI de combustible debe traer el permiso de hidrocarburos

Tanto el Art. 27 como la regla 2.9 lo exigen: *"en el comprobante fiscal deberá
constar la información del permiso vigente, expedido de acuerdo con la Ley de
Hidrocarburos al proveedor del combustible y que, en su caso, dicho permiso no se
encuentre suspendido en el momento de la expedición del comprobante fiscal."*

Un CFDI de diésel **sin el permiso** = gasto no deducible. Esto se valida sobre
el XML, no sobre el ticket.

### 1.4 La deducción del 8% NO cubre combustible

**RFA 2026, regla 2.2.** El autotransporte de carga federal puede deducir hasta
el **8% de sus ingresos propios, sin exceder $1,000,000** al año, sin
documentación con requisitos fiscales — pagando **16% de ISR definitivo** sobre
ese monto.

**Pero la regla lo excluye expresamente:** *"La deducción prevista en el primer
párrafo de esta regla no incluirá los gastos que realicen los contribuyentes por
adquisición de combustibles."*

Importa para no contar dos veces ni prometerle al contralor que el diésel sin
factura "entra en el 8%". No entra.

### 1.5 El plazo legal es el EJERCICIO, no el mes

Esto corrige una creencia extendida (y algo que yo mismo di por bueno).

- **El SAT:** *"cuentas con todo el ejercicio en el que se lleve la
  contraprestación para solicitarla"*. No existe regla de 30 días ni de "mes
  pasado".
- **Negar la factura porque "ya pasó el mes" es una práctica indebida** listada
  por el propio SAT, junto con obligar a facturar en un portal y aumentar el
  precio al pedir factura.
- Si el comercio se niega, existe el servicio **Conciliación de Factura** del
  SAT, que interviene como mediador.

**Lo que esto cambia en el diseño:** un ticket cuya ventana de portal se cerró
**no está perdido**. Está fuera del camino automático y entra a un camino de
reclamación. Modelarlo como "vencido → se acabó" le regala al cliente
deducciones que legalmente todavía tiene.

### 1.6 Los plazos por comercio son política interna, no ley

Las ventanas cortas (gasolineras 5–15 días, Oxxo 15, supermercados fin de mes,
casetas ~7) son **decisión del comercio**, por cuadre de caja y por su factura
global de operaciones con público en general (**RMF 2.7.1.21**, RFC genérico
`XAXX010101000`). Una vez que el ticket entró en la factura global, sacarlo
obliga al comercio a cancelarla con motivo "04" y reexpedirla sin ese ticket, o
a emitir un CFDI de egreso que la disminuya — por eso cierran la ventana.

> **Para diésel y gasolina es peor:** el SAT **prohíbe cancelar** la factura
> global de hidrocarburos y petrolíferos. La única salida es el CFDI de egreso.
> Le pega directo a las gasolineras, que son el proveedor número uno de una flota.

**SIN VERIFICAR:** los plazos exactos por cadena. La fuente es el blog de un
competidor (Clara Intelligence), no los portales. Hay que comprobarlos uno por
uno antes de que Likida le prometa un plazo a alguien.

---

## 2. LEGAL — protección de datos y credenciales

### 2.1 La ley cambió: LFPDPPP nueva desde el 21-mar-2025

- Nueva LFPDPPP publicada en el DOF el **20-mar-2025**, vigente el **21-mar-2025**.
- **El INAI desapareció**: sus funciones pasaron a la **Secretaría de
  Anticorrupción y Buen Gobierno**.
- **Ya no valen las "finalidades análogas o compatibles"**: usar los datos para
  algo distinto de lo declarado exige **recabar el consentimiento otra vez**.

Cualquier aviso de privacidad copiado de antes de 2025 está desactualizado.

### 2.2 Los datos de una flota exigen consentimiento EXPRESO

*"Los datos financieros o patrimoniales requerirán el consentimiento expreso de
la persona titular."*

Los gastos, los comprobantes y los datos fiscales de la flota son patrimoniales.
No basta el consentimiento tácito: hace falta un acto afirmativo.

### 2.3 Mandar la foto a un modelo de IA es una transferencia

Likida manda la imagen del comprobante a OpenRouter/Gemini. Eso es tratamiento
por un tercero y hay que declararlo en el aviso de privacidad.

El **art. 52 del Reglamento** pone condiciones para usar cómputo en la nube. El
proveedor debe, al menos:

- tener políticas de protección de datos afines a la Ley;
- **transparentar sus subcontrataciones**;
- no asumir la titularidad de la información;
- guardar confidencialidad;
- permitir limitar el tratamiento;
- **garantizar la supresión al terminar el servicio**;
- impedir el acceso a quien no tenga privilegios.

*"En cualquier caso, el responsable no podrá adherirse a servicios que no
garanticen la debida protección de los datos personales."*

**Lo que hay que revisar:** que OpenRouter, el proveedor del modelo, Supabase,
Vercel y el navegador headless cumplan esto — sobre todo **retención cero** en el
proveedor de IA. Un modelo que entrena con los comprobantes de la flota es un
problema legal, no solo comercial.

### 2.4 Custodiar credenciales de portales

**42 de 60 portales exigen cuenta.** Si Likida guarda esas credenciales:

- Son datos de acceso a sistemas de un tercero **a nombre del cliente**.
- Hay que cifrarlas en reposo, con llave fuera de la base.
- El aviso de privacidad y el contrato deben decirlo explícitamente.
- Debe existir revocación: el cliente puede pedir que se borren.
- **SIN VERIFICAR:** si los términos de uso de cada portal prohíben el acceso
  automatizado. Hay que leerlos, cadena por cadena. Un portal que lo prohíba
  puede bloquear la cuenta de la flota, no la de Likida — y ese daño es del
  cliente.

**Alternativa que evita el problema:** que la cuenta del portal sea de la flota y
Likida la opere con permiso escrito, en vez de crear cuentas a su nombre.

### 2.5 Pagos a través de un tercero: permitido

El SAT lo permite *"siempre que los fondos para realizar el pago se transfieran
al tercero desde cuentas abiertas a nombre del contribuyente"*. Relevante solo si
algún día Likida toca dinero. Hoy no aplica.

---

## 3. Qué cambia en lo ya construido

| Pieza | Qué hay que corregir |
|---|---|
| `facturacion/caducidad.ts` | Hoy modela vencido/no vencido. Faltan **dos relojes**: la ventana del comercio (política, corta) y el límite fiscal (el ejercicio). Vencer la primera manda a conciliación, no a la basura. |
| `facturacion/comercios.ts` | `plazo` debe llamarse `ventanaPortal` y dejar claro que no es el plazo legal. |
| Cuadre | Falta el **contador del 15% de combustible en efectivo** por flota y por mes. Es la pieza de más valor para el contralor. |
| Validación de CFDI | Falta verificar el **permiso de hidrocarburos** en el XML del combustible. |
| Aviso de privacidad y contrato | No existen. Consentimiento expreso, transferencias a proveedores de IA, y custodia de credenciales. |

---

## 4. Lo que sigue abierto

1. **Plazos reales por cadena** — verificar contra cada portal.
2. **Términos de uso de los portales** — ¿prohíben automatización?
3. **Retención cero** con el proveedor de IA.
4. **Régimen de cada flota** — la facilidad del 15% aplica a quien se dedica
   *exclusivamente* al autotransporte de carga federal. Si la flota no está en
   ese supuesto, no aplica y el efectivo no se salva.

## Fuentes

- LISR art. 27 fr. III — requisitos de las deducciones
- RFA 2026, reglas 1.9, 2.2, 2.9, 3.12 — DOF 17-feb-2026
- SAT, *Preguntas sobre deducción de combustibles*
- SAT, *Solicita tu factura* — prácticas indebidas y Conciliación de Factura
- SAT, *Preguntas y respuestas sobre Comprobación Fiscal* — factura global: **RMF 2.7.1.21**
- LFPDPPP (vigente 21-mar-2025) y su Reglamento, art. 52
- EY Law Flash — cambios de la nueva LFPDPPP
