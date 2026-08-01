# Frontend — auditoría 9

**Nota: 5/10** (antes 6). Razón del movimiento: *deuda que cobró factura* — el
CRÍTICO de la ronda 8 (`derivoLaConfig` solo miraba tipos, no `esperado`) cerró
de verdad con `40714ba`: lo verifiqué leyendo `analytics.ts:444-460` y corriendo
`analytics_deriva.test.ts` (10/10 verdes), incluida la prueba nueva del tope de
viáticos. Pero esta ronda un commit de otro rubro (`7301adc`, fiscal) tomó una
decisión —"el aviso va a REVISAR... ni el demo cambia de color"— sin trazarla
contra el código real del panel. Sí cambia: hice el cálculo con el motor real
sobre el escenario EXACTO del viaje que `supabase/seed.sql` diseñó como pieza
central del demo, y el estatus de esa liquidación pasa de ámbar
("Con diferencias") a rojo ("Por revisar") por una condición que nadie puede
resolver nunca.

El riesgo mayor hoy: el viaje que el demo eligió como ejemplo —diésel con XML,
complemento e IEPS/IVA verificados, exactamente el camino que se supone que se
ve BIEN— aterriza en el estatus más alarmante del sistema, y cualquier viaje
futuro con diésel verificado por XML (el caso ejemplar, no el problemático)
queda estructuralmente incapacitado para volver a ser "Cuadrada".

## Hallazgos

### [ALTO] El viaje central del demo pasa de "Con diferencias" (ámbar) a "Por revisar" (rojo) por una regla que nadie puede resolver, contradiciendo lo que su propio commit dice que no iba a pasar
`src/lib/cuadra/cuadre/engine.ts:436` (empuja `permiso_cre_no_verificable` en
CADA CFDI de combustible con XML verificado, sin condición de salida) ·
`src/lib/cuadra/cuadre/engine.ts:909-912` (`REVISAR` incluye
`permiso_cre_no_verificable`; `hayRevisar` tiene prioridad sobre `hayDif` en el
cálculo de `estatus`) · `src/app/dashboard/page.tsx:14-18` y
`src/app/dashboard/[id]/page.tsx:25-29` (mapa `ESTATUS`: `revisar` → `{label:
'Por revisar', color: 'var(--color-bad)'}`, el rojo del sistema) ·
`src/lib/cuadra/repo.ts:439` (`p_estatus: liq.estatus` se persiste literal,
sin filtro) · `supabase/seed.sql:104-130` (el viaje demo, diseñado
explícitamente para mostrar "UNA diferencia" de política)

**Escenario, verificado ejecutando el motor real** (no inferido): tomé el
gasto exacto que `seed.sql:121-129` inserta para el viaje demo Silao→Nuevo
Laredo —diésel $4,200 con `xml_verificado=true`, `clave_prod_serv=15101505`,
`tipo_comprobante=I`, complemento de hidrocarburos, IEPS/IVA desglosados— más
la caseta $1,400, y los pasé por `cuadrarViaje()` con la política real del
demo (`topeMonto` diésel $4,000, de `DEMO_CONFIG`/`api/demo/route.ts`) y los
mismos `hidrocarburos`/`estimulos` de `config.ts`. Resultado real, corrido con
`tsx` sobre el módulo del motor sin mocks:

```
=== con el motor de HOY ===
totalDeducible: 5600   (100% del comprobado — el dinero SÍ sale bien)
estatus: revisar
tipos: [ 'sobre_politica', 'permiso_cre_no_verificable' ]

=== el mismo escenario sin la regla nueva (permiso_cre_no_verificable) ===
estatus: con_diferencias
tipos: [ 'sobre_politica' ]
```

`totalDeducible` no se mueve —el dinero sigue correcto y en verde, tal como
promete el comentario del hallazgo original (`permiso_cre_no_verificable.test.ts:24-26`:
"no se toca el acreditamiento")—, pero el **estatus general de la liquidación**
sí se mueve, de ámbar a rojo, y esa misma frase del comentario dice que
tampoco iba a pasar ("ni el demo cambia de color"). Nadie verificó esa segunda
mitad de la frase contra `engine.ts:909-912`, donde `permiso_cre_no_verificable`
entró a la lista `REVISAR` —que tiene prioridad sobre `con_diferencias`— y
contra el mapa `ESTATUS` del panel, que pinta `revisar` con `--color-bad`, el
mismo rojo reservado para CFDI cancelado, EFOS confirmado o UUID inexistente.

**Consecuencia.** El contralor abre `/dashboard` (o el detalle de la
liquidación) y ve el badge rojo "Por revisar" sobre el viaje que el propio
`seed.sql` documenta como la pieza que se diseñó para lucir bien ("diseñado
para mostrar UNA diferencia: el diésel excede el tope"). El motivo real —"el
sistema no valida el permiso CRE del proveedor, y nunca lo va a validar
mientras `facturacion/permiso_cre.ts` siga sin consumidor real (confirmado:
`command grep -rn "permiso_cre" src/app/ src/lib/cuadra/processor.ts` no
devuelve nada fuera del propio motor y la tabla)"— está en la nota de texto,
pero el primer dato que el contralor procesa es el color del punto, no el
párrafo. Y no es un evento raro: la condición se dispara en TODO CFDI de
combustible con XML verificado, es decir, en el camino de MEJOR calidad de
dato que existe hoy. Un viaje sin ningún otro problema —sin exceso de
política, con CFDI completo— tampoco puede volver a ser "Cuadrada" nunca: la
misma prioridad de `hayRevisar` sobre `hayDif` en `engine.ts:912` lo empuja a
"revisar" en cuanto tiene un solo CFDI de diésel bien hecho. Esto también
arrastra `tasaCuadre` (`src/lib/cuadra/analytics.ts:74-88`, "% de liquidaciones
sin diferencias"): la métrica que resume la calidad del corte del periodo baja
estructuralmente conforme más operadores mandan el XML completo —el
comportamiento que el producto quiere premiar.

**Causa raíz probable.** La decisión de mandar el aviso a `REVISAR`
(`7301adc`) se verificó contra el motor puro (`permiso_cre_no_verificable.test.ts`,
6/6 verdes) pero no contra `dashboard/page.tsx`/`dashboard/[id]/page.tsx`, que
son quienes traducen `estatus` a color. Ningún archivo en `src/app/` menciona
`permiso_cre_no_verificable` ni `revisar` en el contexto de esta regla —
confirmado con `command grep -rln "permiso_cre_no_verificable" src/` (7
archivos, ninguno en `src/app/`).

**Intento de refutación.** ¿Está esto ya contemplado como aceptable? El
comentario del propio commit dice explícitamente lo contrario de lo que hace
("ni el demo cambia de color"), así que no es una decisión informada de
aceptar el rojo: es una suposición no verificada. ¿Se puede negar la parte
del corredor? No: `DEMO_CONFIG.hidrocarburos.claves` (`config.ts:89`) incluye
`'15101505'`, la misma clave del gasto sembrado, así que la ruta que activa
`combustibleFiscal` en `engine.ts:422` sí se cruza con los datos reales del
demo, no es un caso de laboratorio.

---

## Lo que revisé y está bien

**Los dos mapas literales del panel siguen sincronizados con
`types/cuadra.ts`**, comparación hecha de nuevo esta ronda: `CONCEPTO`
(`dashboard/[id]/page.tsx:20-24`, 9 claves) cubre las 9 de `ConceptoGasto`;
`ESTATUS` (`dashboard/page.tsx:14-18` y `dashboard/[id]/page.tsx:25-29`, 3
claves cada uno) cubre exactamente las 3 de `EstatusLiquidacion`. El único
tipo nuevo de esta ronda, `permiso_cre_no_verificable` (`types/cuadra.ts:92`),
no necesita entrada propia en ningún mapa del panel porque las diferencias se
pintan con `nota` en texto libre (`dashboard/[id]/page.tsx:146`), no por
`tipo` — el desajuste real no está en un mapa desincronizado sino en la
interacción de arriba.

**El CRÍTICO de la ronda 8 (`derivoLaConfig` solo veía tipos, no monto)
sigue cerrado.** Releí `analytics.ts:444-460`: la llave de comparación incluye
`esperado` cuando está presente. Corrí `analytics_deriva.test.ts` (10/10
verdes), incluida la prueba específica del tope de viáticos (750→400) que
motivó el hallazgo original.

**`etiquetaGasto` sigue delegando en el motor, no en su propio mapa.**
`dashboard/[id]/page.tsx:238-241` llama a `etiquetaConcepto(g.concepto,
g.ocrExtra)` antes de caer al mapa `CONCEPTO` como red. `etiquetas_panel.test.ts`
(3/3 verdes) sigue fijando que un ticket de MAGNA no puede salir como "Diésel".

**`estadoPanel` sigue cubriendo la combinación traicionera** ("KPIs en cero
legítimo + listado caído" → `'parcial'`, no `'vacio'`). `estado.ts:29-39`
contra `estado.test.ts` (6/6 verdes), sin cambios desde la ronda 8.

**El formateo de dinero, litros y fecha sigue en un solo lugar**, y no usa
`round2()` —el bug de redondeo abierto desde la ronda 6 en 4 archivos del
motor no le llega al panel: `mxn()`/`litros()`/`fechaMx()` (`src/lib/formato.ts`)
delegan en `toLocaleString` nativo, sin pasar por ningún `round2` propio.
Confirmado con `command grep -rn "round2" src/app/` (sin resultados).
`formato.test.ts` (7/7) y `contraste.test.ts` (7/7) verdes, sin cambios de
`globals.css` desde antes de la ronda 6.

**`npx tsc --noEmit` sale limpio** y la corrida dirigida (`dashboard/`,
`privacidad/`, `acuses.test.ts`) da 34/34 pruebas verdes.

## Lo que NO alcancé a revisar

- **Seguí sin renderizar nada con un navegador real** — tercera ronda
  seguida (6, 8, 9) sin mirar. Todo lo de arriba es lectura de código y
  `npx tsx`/`vitest` dirigido. El reflow real del badge rojo en una sala con
  proyector, que es literalmente el objeto del hallazgo de hoy, no lo vi con
  los ojos.
- **No tengo acceso al proyecto real de Supabase (`gngoqsvrxdguxvsizpbw`)**
  para confirmar cuántas liquidaciones YA CERRADAS (antes de `7301adc`) tienen
  diésel con XML y, si alguien abre su detalle hoy, si `derivoLaConfig` detecta
  el tipo nuevo ausente en lo persistido y oculta el desglose de deducibilidad
  (`analytics.ts:389`, mismo mecanismo del CRÍTICO de la ronda 8, esta vez
  disparado por una diferencia de TIPO en vez de valor — el portón sí debería
  detectarlo, pero no confirmé el caso real contra datos reales).
- **No confirmé el guión exacto del demo del 6-ago**: si el viaje
  `44444444-...-0001` se cierra en vivo frente al contralor o se precierra
  antes, y si hay plan de resembrar el proyecto real con datos distintos antes
  del evento. Cualquiera de las dos formas de cerrarlo hoy pasa por el mismo
  motor y llega al mismo estatus.
- **No audité `design-system/` ni `globals.css` a fondo** — sin cambios desde
  antes de la ronda 6 (confirmado por `git log`), igual que constató la
  ronda 8.
- **No repetí una auditoría completa de `/acceso`, `/aviso/[tenant]`,
  `/privacidad`** — solo confirmé que su código no cambió desde la ronda 8
  (salvo el texto legal de `privacidad/page.tsx`, ya atribuido al rubro legal)
  y que sus pruebas (`privacidad.test.ts`, 6/6) siguen verdes.
- **No agoté las otras 23 claves de `TipoDiferencia`** buscando si alguna
  combinación produce una sorpresa de estatus parecida — solo perseguí la
  única pieza nueva de esta ronda (`permiso_cre_no_verificable`) hasta su
  consecuencia real en el panel.
