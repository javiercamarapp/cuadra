# D2 · Motor fiscal, el papel y las normas — arreglos

Rama `claude/auditoria-11`. Dominio: `src/lib/cuadra/cuadre/**`,
`src/lib/cuadra/liquidacion/**`, `src/lib/cuadra/intake/sat.ts`,
`src/lib/cuadra/facturacion/**`, `src/lib/cuadra/normas/**`, `normas/**`,
`supabase/seed.sql`, `FISCAL_LEGAL.md`.

**Suite:** verde en todo lo que toca D2. Medido con el árbol COMPARTIDO — otros
cinco agentes escriben en él a la vez, así que las cifras absolutas se mueven:

- Baseline al empezar (`npx vitest run`, antes de tocar nada): **225 archivos /
  2,023 pruebas, 0 fallos**.
- Al terminar: **238 archivos / 2,165 pruebas**, con **20 fallos concentrados en
  un solo archivo, `src/lib/cuadra/operacion.test.ts`** — que es de **D5**, está
  modificado en el árbol de trabajo (+206 líneas, `git diff --stat`) y es su
  prueba-que-reproduce de G-21 todavía sin el arreglo. **Cero referencias a
  `acreditable`, `resumen` o cualquier cosa mía** (`grep -c` = 0). No es de este
  dominio y no lo toqué.
- `src/lib/cuadra/{cuadre,liquidacion,normas,facturacion,intake}` +
  `src/app/dashboard/peaje_condicionado.test.tsx` + `seed_rfc.test.ts`: **todo
  verde**, corrido dirigido.
- `npx eslint` sobre mis tres directorios: limpio.
- `npx tsc --noEmit -p .`: limpio de todo lo mío (ver *Fuera de mi dominio*).

---

## Los siete grupos

### G-01 · CRÍTICO · **YA CERRADO por `989ca62`**
El RFC del tenant del demo. `supabase/seed.sql:26` dice hoy `'TIN010101AA5'`
—con el comentario `🔴 INVENTADO: RFC inventado con dígito verificador válido
(aud. 10)`—, no `'TIN010101AAA'`. El `rfc_receptor` de los dos gastos del
escenario (`seed.sql:125,128`) y el `Receptor Rfc` del XML embebido (`:135`)
apuntan al mismo valor.
**Verificado ejecutando:** `src/lib/cuadra/seed_rfc.test.ts` lee el RFC del
`insert into tenant` del seed y exige `rfcChecksumOk(rfc) === true`; pasa. Lo
acompañan `cuadre/rfc_empresa_invalido.test.ts` y `cuadre/rfc_no_verificable.test.ts`,
que fijan el comportamiento con el RFC malo. No toqué nada.

### G-02 · CRÍTICO · **YA CERRADO por `989ca62`**
El CFDI de emisor en EFOS que imprimía «Deducible para ISR» en verde. Las dos
listas duras que el auditor exigía ya lo incluyen:
- `cuadre/engine.ts:150` — `POR_CONFIRMAR` contiene `'cfdi_efos_indeterminado'`.
- `cuadre/engine.ts:1084` — `SIN_ACREDITAMIENTO` también.
Y `intake/sat.ts:82-84` está reescrito: `EFOS_LIMPIO = {'200','201'}`, cualquier
otro código cae en `efosDesconocido` → `cfdi_efos_indeterminado`, y **nunca** se
afirma `efos: true` desde ese camino (con la cita de `cff-69-B.yaml`,
`verificado_fuente_primaria`: el efecto de «no producen ni produjeron efecto
fiscal alguno» es solo del listado DEFINITIVO, 4º párrafo).
**Verificado ejecutando:** `cuadre/efos_indeterminado_no_es_deducible.test.ts`
(3 casos) pasa. No toqué nada.

### G-03 · ALTO · **YA CERRADO por `989ca62`**
«Efectivo» ya no es `formaPago === '01'`. `cuadre/engine.ts:1163-1171` define
`MEDIOS_LIF_20A` como lista **cerrada** y decide con
`MEDIOS_LIF_20A.includes(g.formaPago)`. Un `FormaPago 99` ya no acredita litros.
La lista está atada a `normas/lif-2026-20-A.yaml`
(`requisito_medio_de_pago.codigos_c_formapago`) por
`cuadre/medios_lif_con_ficha.test.ts`: si una cambia sin la otra, falla.
**Verificado ejecutando:** `diesel_medio_de_pago.test.ts`,
`engine_diesel_medio_pago.test.ts`, `engine_medio_pago_isr.test.ts`,
`medio_pago_27_III_no_combustible.test.ts`, `medios_lif_con_ficha.test.ts` —
todas pasan. No toqué nada.

### G-05 · ALTO · **CERRADO en la parte de D2** (queda un residual de D1, abajo)
Prueba que lo reproduce: `src/lib/cuadra/liquidacion/reserva_una_sola_fuente.test.ts`
(7 casos). Falla sin el arreglo (6 de 7 en rojo), pasa con él.

**(a) El IVA salía afirmado por WhatsApp donde el PDF lo condicionaba.** Éste era
el defecto vivo, y no estaba en la lista de superficies del plan.
`liquidacion/acreditable.ts` ya condicionaba el renglón de IVA cuando el mismo
hecho condiciona la deducción para ISR, citando `normas/liva-5.yaml`
(**`verificado_fuente_primaria`**), fracción I, literal:

> «...se consideran estrictamente indispensables las erogaciones efectuadas por
> el contribuyente **que sean deducibles para los fines del impuesto sobre la
> renta**, aun cuando no se esté obligado al pago de este último impuesto.»

No son dos requisitos: es uno. Pero la regla vivía **dentro** de
`filasAcreditables`, así que solo el PDF la aplicaba. Medido: liquidación con
`ivaAcreditable = 689.66` y `diferencias: [{tipo:'permiso_cre_no_verificable'}]`
—que se dispara **siempre** que hay XML de combustible— daba

| superficie | antes | ahora |
|---|---|---|
| PDF (`acreditable.ts`) | `IVA acreditable (LIVA art. 5) — sujeto a la deducibilidad para ISR` | igual |
| WhatsApp (`cuadre/resumen.ts:95`) | `• IVA: $689.66` **a secas** | `• IVA: $689.66 (sujeto a la deducibilidad para ISR)` |

Arreglo: se extrae `motivosQueCondicionanElIva(diferencias)` de
`filasAcreditables` a función exportada de `liquidacion/acreditable.ts`, y
`cuadre/resumen.ts` decide con **la misma** función, no con un criterio propio.
Control en la prueba: sin ningún motivo, el IVA sigue siendo cifra afirmada.

**(b) La reserva del peaje estaba escrita a mano en tres archivos.**
`acreditable.ts:170`, `cuadre/resumen.ts:103` y `app/dashboard/acred.tsx:101`
tenían cada uno su copia del literal «sujeto a elegibilidad» — el mismo patrón
que `lib/formato.ts` prohíbe para las cifras, aplicado a un dictamen fiscal.
Ahora la reserva nace una sola vez, en `liquidacion/acreditable.ts`:

```
RESERVA_PEAJE            = 'sujeto a elegibilidad'
ETIQUETA_PEAJE           = 'Estímulo de peaje 50% (LIF 2026 art. 20, ap. A) — sujeto a elegibilidad'
ETIQUETA_PEAJE_CORTA     = 'Peaje 50% — sujeto a elegibilidad'      ← para tarjetas de panel
NOTA_PEAJE_PANEL         = 'LIF 2026, Art. 20-A. ' + CONDICIONES_ESTIMULO_PEAJE
RESERVA_IVA_ATADO_AL_ISR = 'sujeto a la deducibilidad para ISR'
```
`CONDICIONES_ESTIMULO_PEAJE` transcribe las cuatro condiciones de
`estimulo_peaje.condiciones` de `normas/lif-2026-20-A.yaml` (dedicación
exclusiva al transporte terrestre; Red Nacional de Autopistas de Cuota;
ingresos anuales < $300M; no ser parte relacionada, LISR 179) y dice quién NO
las verifica. La ficha está en `evidencia_corroborante`, no primaria — la
reserva vale más con el sello bajo, no menos.

La prueba incluye un **grep-test** (estilo `formato.test.ts`): ningún archivo de
`src/` puede reescribir la reserva a mano; tiene que importar la constante.
Caza cualquier copia nueva.

### G-06 · MEDIO + BAJO · **YA CERRADO por `989ca62`**
`cuadre/engine.ts:844` exige `amparaLaComida(g)` (comprobante real, no la mera
existencia del concepto) para dar por amparada la alimentación de LISR 28-V, y
`:870` distingue el caso «trae hospedaje pero sin comprobante» con su propia
frase. `:904` hace lo mismo para la condición de tarjeta de crédito del
transporte, con el comentario que nombra el hospedaje de $1. El tope de $750
diarios ya no alcanza al cajón `viaticos` (`:944-951`).
**Verificado ejecutando:** `cuadre/soporte_28v.test.ts`,
`cuadre/viaticos_generico_sin_tope.test.ts`,
`cuadre/viatico_transporte_sin_tarjeta.test.ts` — pasan. No toqué nada.

### G-07 · MEDIO · **YA CERRADO por `989ca62`**
`cuadre/engine.ts:764-766`: las **dos** ramas de `cierreComercio` dicen que el
plazo legal es el ejercicio («plazo del portal de X, **no de la ley**: legalmente
puedes exigir la factura dentro del ejercicio» / «fin del mes de la compra, **no
de la ley**…»), y `:783` lo repite en la rama vencida remitiendo a Conciliación
de Factura del SAT. `:725` deja `plazoVerificado: false` como default del
catálogo.
**Verificado ejecutando:** `cuadre/plazo_sin_verificar.test.ts`,
`plazo_jerarquia.test.ts`, `plazo_fecha_dudosa.test.ts`,
`aviso_portal_sin_liga.test.ts`, `aviso_siempre.test.ts` — pasan. No toqué nada.

### G-08 · MEDIO + BAJO ×3 · **CERRADO el residual** (el resto ya venía cerrado)
Ya cerrado por `989ca62`: los tres estados de verificación llegan al agente;
`normas/lif-2026-20-A.yaml` incorpora el bloque `requisito_medio_de_pago` con
`texto_vigente: null` + `estado_transcripcion: sin_transcribir` (la única salida
honesta sin red al DOF: el proxy da 403, e inventar el texto es lo que
`normas/README.md` prohíbe); y `cuadre/fichas_usado_en_codigo.test.ts` ya ata
`usado_en_codigo` al catálogo real.

**Residual arreglado aquí:** `FISCAL_LEGAL.md` prometía una medición **mensual**
sobre una regla **anual**.
Prueba que lo reproduce: `src/lib/cuadra/normas/tope_15_es_del_ejercicio.test.ts`
(3 casos). Falla sin el arreglo (2 de 3 en rojo), pasa con él.

Ficha citada: `normas/rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`** (leída
en el DOF vía SIDOF), `texto_vigente`:

> «...siempre que estos no excedan el 15 por ciento **del total de los pagos
> efectuados por consumo de combustible para realizar su actividad**.»

No hay corte mensual en la regla; la RFA rige del 18-feb-2026 al 31-dic-2026 y
su `condiciones_de_aplicacion` dice «en el ejercicio». El motor ya lo decía bien
en la nota que sí se imprime (`cuadre/engine.ts:361`: «cuenta contra el tope del
15% del combustible **del ejercicio**»), así que el documento fundacional
contradecía al código y a la ficha verificada a la vez.

| dónde | antes | ahora |
|---|---|---|
| `FISCAL_LEGAL.md:49-53` | *"Llevas 11.4% de tu diésel en efectivo **este mes**; el tope es 15%."* | *"…**en lo que va del ejercicio**…"*, más un párrafo que declara el periodo y por qué el mensual engaña (un 11.4% en julio convive con un 19% al 31-dic) |
| `FISCAL_LEGAL.md:218` | «contador del 15% … por flota y **por mes**» | «por flota y por **ejercicio** (el periodo de la regla 2.9; ver §1.2)» |

Efecto colateral correcto: citar `normas/rfa-2026-2.9.yaml` en el documento
disparó la prueba **preexistente** `normas_sincronizadas.test.ts:141` («toda
ficha que FISCAL_LEGAL.md nombra por archivo lo declara, con su sección»), así
que se añadieron a su `usado_en_codigo` las dos secciones que la ficha sostiene
(§1.2 y §3). Eso es lo que hace calculable el radio de impacto si la RFA 2027
mueve el porcentaje o el periodo.

---

## Fuera de mi dominio — para quien corresponda

1. **G-05 · D1 (panel del cliente).** Cuatro superficies siguen afirmando el
   estímulo en verde, sin reserva y sin las cuatro condiciones. Los constantes
   ya están exportados; es un import y un cambio de `etiqueta`/`nota`:
   - `src/app/dashboard/page.tsx:245-246` — `etiqueta="Peaje (50%)"` →
     `ETIQUETA_PEAJE_CORTA`, `nota` → `NOTA_PEAJE_PANEL`.
   - `src/app/dashboard/facturacion/page.tsx:98` — `etiqueta="Peaje acreditable (50%)"`,
     `nota="LIF 2026, Art. 20-A"` → los mismos dos.
   - `src/app/dashboard/[id]/page.tsx:211` — `<Tot label="Peaje 50%" … ok />`:
     el `ok` (tinta verde) es justo lo que el PDF evita con `tono: 'condicionado'`.
     Misma línea `:209`, el IVA: hay que preguntar
     `motivosQueCondicionanElIva(d.diferencias)` como hacen el PDF y WhatsApp.
   - `src/app/dashboard/combustible-casetas/page.tsx:84-85` — la tarjeta de
     litros cita «LIF 2026, Art. 20-A» sin la nota de la cuota semanal
     (`NOTA_LITROS_DIESEL`, ya exportada).
   - `src/app/dashboard/acred.tsx:101` — tiene su propia copia del literal
     `' — sujeto a elegibilidad'`. Debe importar `RESERVA_PEAJE`. Está nombrado
     explícitamente en `PENDIENTE_OTRO_DOMINIO` dentro de
     `liquidacion/reserva_una_sola_fuente.test.ts`: al cambiarlo, se borra esa
     línea de la lista y no hay que tocar nada más.
   Todo eso importa de `@/lib/cuadra/liquidacion/acreditable`. **No hay que
   reescribir la regla** — solo consumirla.

2. **`normas/lif-2026-20-A.yaml`, hallazgo H4, `severidad: alta`, `SIN RESOLVER`.**
   La ley dice «hasta en un 50 por ciento del **gasto total erogado**» y el motor
   usa el SubTotal **sin IVA** (~13.8% menos estímulo). Resolverlo hacia el total
   podría **duplicar** el beneficio del IVA, que ya se acredita aparte (LIVA 5).
   Es una **decisión de contador**, no de código; el papel ya declara cuál base
   usó (`BASE_ESTIMULO_PEAJE`). Lo dejo abierto a propósito.

3. **`normas/lif-2026-20-A.yaml`, `requisito_medio_de_pago.texto_vigente: null`.**
   El 4º párrafo de la fracción IV sigue sin transcribir porque este entorno no
   tiene red al DOF ni a diputados.gob.mx (403 del proxy). Mientras siga en
   `null`, el producto no puede citar ese párrafo como fundamento de un veredicto
   — y no lo hace: los litros se entregan como dato, nunca como pesos afirmados.
   Se cierra con la skill `cuota-diesel` / `vigilancia-normativa` cuando haya red.

4. **Dos errores de `tsc` que NO son míos**, del árbol de trabajo de otros
   agentes en paralelo (anotados para que no se atribuyan a este dominio):
   - `src/lib/auth/tenant-efectivo.test.ts(190,41)` — `TS2322`, `null` no
     asignable (D3).
   - `src/app/admin/mi-perfil/page.tsx(7,31)` — `TS2307`, falta `./mensajes` (D6).

---

## Archivos tocados

| archivo | qué |
|---|---|
| `src/lib/cuadra/liquidacion/acreditable.ts` | exporta `RESERVA_PEAJE`, `ETIQUETA_PEAJE`, `ETIQUETA_PEAJE_CORTA`, `NOTA_PEAJE_PANEL`, `RESERVA_IVA_ATADO_AL_ISR` y `motivosQueCondicionanElIva()`; el label del peaje y el del IVA se arman con ellos |
| `src/lib/cuadra/cuadre/resumen.ts` | importa la reserva en vez de copiarla; el IVA de WhatsApp se condiciona con la misma función que el PDF |
| `src/lib/cuadra/liquidacion/reserva_una_sola_fuente.test.ts` | **nuevo** — 7 casos, G-05 |
| `src/lib/cuadra/normas/tope_15_es_del_ejercicio.test.ts` | **nuevo** — 3 casos, G-08 |
| `FISCAL_LEGAL.md` | §1.2 y §3: el 15% se mide por ejercicio, no por mes |
| `normas/rfa-2026-2.9.yaml` | `usado_en_codigo` declara las dos secciones de `FISCAL_LEGAL.md` que sostiene |

Ninguno fuera del dominio D2 (más este documento).
