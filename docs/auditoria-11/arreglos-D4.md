# Arreglos · D4 — WhatsApp: processor, conversación, presupuesto y privacidad

Rama `claude/auditoria-11`. Árbol de partida: `2e332ae` (que ya traía `989ca62`,
el trasplante del PR #7).

**Cada grupo se verificó abriendo el archivo antes de tocarlo.** Lo que `989ca62`
ya había cerrado se anota y no se reescribe: una segunda variante del mismo
arreglo es peor que ninguna.

| Grupo | Sev. | Estado |
|---|---|---|
| G-19 | CRÍTICO | **CERRADO** |
| G-22 | CRÍTICO | **CERRADO** |
| G-04 | ALTO | **CERRADO** |
| G-58 | ALTO | **CERRADO** |
| G-60 | ALTO | **CERRADO** |
| G-54 | CRÍT.+ALTO×2+MED+BAJO | **PARCIAL** — la parte de código, cerrada; la redacción es decisión humana |
| G-18 | CRÍTICO | YA CERRADO por `989ca62` |
| G-23 | ALTO ×2 + MEDIO | YA CERRADO por `989ca62` |
| G-44 | MEDIO ×2 | YA CERRADO por `989ca62` |
| G-59 | ALTO | YA CERRADO por `989ca62` |
| G-55 | ALTO + MEDIO | PROPUESTO — no reproducible sin Postgres |

---

## G-19 · CERRADO
**La afirmación no estaba atada ni a la oferta ni al viaje.**

Verificado abierto en este árbol: `processor.ts:1026` seguía siendo
`enEspera.filter(h => h.ofrecidoEn)` y `:1032` `if (ofrecidos.length && esAfirmacion(...))`.
El PR #7 no lo cubría, tal como decía el plan.

`comprobante_huerfano.ofrecido_en` (mig. 0040) es un timestamp: registra CUÁNDO
se preguntó y no PARA QUÉ. Un «va» del 20-jul con V3 abierto adjuntaba a V3 los
comprobantes ofrecidos en V2 el 15-jul, sin marca de fecha sospechosa (la
tolerancia son 30 días). Es la frase con la que la propia migración se justifica.

**Arreglo, sin migración** (las migraciones son de D5): la constancia se escribe
en `viaje_id`, columna que la 0040 ya tiene y que es literalmente el mismo dato
—el viaje al que la fila se adjuntará si el operador dice que sí—. Al resolverse
se sobrescribe con el viaje real (`adjuntado`) o se limpia (`descartado`), así
que el estado final de la columna no cambia y ninguna otra consulta la lee.

- `repo.ts` — `Huerfano.ofrecidoParaViaje`; `getHuerfanos` selecciona `viaje_id`;
  `marcarHuerfanosOfrecidos(tenant, ids, viajeId)` (tercer parámetro **no**
  opcional: una constancia sin viaje es el defecto).
- `processor.ts` — `ofrecidos` filtra `ofrecidoEn && ofrecidoParaViaje === viajeId`.
  Lo ofrecido en otro viaje no se pierde: cae al brazo de re-oferta y se pregunta
  otra vez, ahora por el viaje abierto.
- Segunda mitad: el «no» prometía *«dime cuál y lo pongo»* y no existe ningún
  lector de esa frase. Ahora dice lo que el sistema sí sabe hacer: reenviar la
  foto, que entra por el camino normal con `uq_gasto_img_hash` cuidando el duplicado.

**Prueba:** `src/lib/cuadra/huerfanos_atados_al_viaje.test.ts` (6 casos, 5 rojos
antes del arreglo; el 6º es el control). Actualizadas al nuevo contrato:
`huerfanos_flujo.test.ts`, `huerfanos_presupuesto.test.ts`, `repo_huerfanos.test.ts`.

*Nota:* en `huerfanos_presupuesto.test.ts` el mock de `getOpenViaje` devolvía un
objeto; `conv.ts:124` devuelve `Promise<string | null>`. Se corrigió el mock.

**Pendiente anotado (fuera de alcance):** `ofrecido_en` sigue sin caducar. La
atadura al viaje acota el daño —un viaje es una cosa acotada— pero un TTL
explícito querría columna o política, y eso es de D5.

---

## G-22 · CERRADO
**`guardar_liquidacion` subía dos PDF con `fetch` pelado; `sendDocument` no acusaba;
`PASOS_CIERRE` apuntaba a trece líneas que no existen.**

Los tres defectos verificados presentes.

1. **Storage sin techo.** `tools.ts` — las dos `storage.upload` van ahora dentro
   de `acotada`. `supabaseAdmin()` no lleva `fetch` propio: heredaban los
   300,000 ms de undici × 2 dentro del tramo que el presupuesto cree acotado a
   40,000, y Vercel corta a los 120,000 **antes** de `saveLiquidacion`.
   La prueba de contrato encontró dos más en `intake/almacen.ts`
   (`subirComprobante`, `ligaComprobante`) — mismo dominio, mismo arreglo.
   `acotada` traduce el tope a `{data:null, error}`, que es la forma que los
   `if (error)` de esos tres sitios ya trataban: se pierde el PDF/la foto con su
   warn, no la liquidación.
2. **Acuse del PDF.** `meta/client.ts` — `sendDocument` devuelve `Promise<string|null>`
   con el `wamid`. `processor.ts` lanza si viene `null`, así que se dispara
   `pdf.no_entregado` y sale el mensaje *«…pero no pude generarte el PDF»* que
   existía justo para eso — y **no** se registra el costo de WhatsApp de un
   documento que no salió.
3. **La tabla apunta a donde dice.** `presupuesto.ts` — cada paso lleva ahora
   `simbolo`, y los trece `donde` se recalcularon contra el archivo de hoy.
   Verificado que los viejos estaban todos mal (`:1278` es una línea en blanco,
   `:380` es un `catch`).

**Prueba:** `src/lib/cuadra/cierre_storage_y_acuse.test.ts` (19 casos).

**No se hizo, a propósito:** reordenar `saveLiquidacion` para que persista antes
de las subidas. `pdf_path` es columna de esa fila; partirlo en insert + update
son dos escrituras nuevas en el camino del dinero a dos días del demo, y con el
techo puesto el modo de fallo que lo motivaba (morir antes de persistir) ya no
está. Queda anotado.

---

## G-04 · CERRADO
**El contador del 15% de la RFA 2.9 estaba ciego y su «margen» mal despejado.**

(a) **El numerador.** `repo.ts:817` contaba `forma_pago === '01'`. La RFA 2026
regla 2.9 no acota su válvula al efectivo sino a los pagos «con medios distintos»
a la lista cerrada de LISR 27-III — y `cuadre/engine.ts` **ya lo evaluaba así por
viaje** desde la ronda 10 (`medioFueraDeLista`). Las dos mitades del producto
contestaban distinto sobre el mismo gasto, y la ciega era la que decide si sale
el aviso: $800,000 por transferencia + $200,000 en `FormaPago 99` (el PPD
obligatorio de la flota que carga a crédito) daban `holgado` con el aviso en
`null` yendo en 20%.

- `periodo/combustible.ts` — `MEDIOS_LISR_27_III` + `cuentaContraTope15()`.
- `repo.ts` — el numerador usa ese predicado. Sin `forma_pago` no cuenta, mismo
  criterio que el motor (un dato ausente no es un incumplimiento).
- La lista está escrita dos veces porque `engine.ts` (D2) no la exporta y no se
  toca desde fuera. Hay una prueba que lee el fuente del motor y falla si se
  separan — mismo mecanismo con el que `presupuesto.test.ts` sincroniza
  `TECHO_ENVIO_META_MS` con `meta/client.ts`. **Si D2 exporta la constante, este
  archivo debería importarla y borrar su copia.**

(b) **El margen.** Era `permitido − efectivo`, que contesta otra pregunta. El
peso que se pague de más también es combustible y entra en los dos lados:
`x = (0.15·t − e) / 0.85`. Con $1,000,000 y $120,000 el margen real es
$35,294.1176 y se imprimía $30,000.00.

Se **trunca** a centavos en vez de redondearse: es el único valor del módulo que
no usa `round2`, porque el margen AUTORIZA a gastar y $35,294.12 ya deja a la
flota encima del tope. Por eso el valor es $35,294.11 y no el $35,294.12 que
cita el plan — un centavo abajo, deliberadamente.

(c) **El rótulo.** `periodo/aviso.ts` decía «Diésel en efectivo». Con el
numerador corregido eso es falso para la flota que carga a crédito, así que la
etiqueta se nombró (`RUBRO`) y dice lo que se cuenta.

**Pruebas:** `src/lib/cuadra/periodo/tope15_numerador_y_margen.test.ts` (11 casos)
y tres casos nuevos en `repo_acumulado.test.ts`. Corregidas las que fijaban el
valor equivocado: `periodo/combustible.test.ts` (margen 3,000 → 3,529.41, con la
razón escrita) y `periodo/aviso.test.ts`.

---

## G-58 · CERRADO
**Un blip de Supabase le decía al chofer que su flota no configuró el aviso, y le
tiraba la foto.**

`ponerAvisoADisposicion` devolvía `boolean`: «el tenant no tiene razón social» y
«la base no contestó» salían por el mismo `return false`, y aguas arriba había un
solo texto — el que acusa a la flota. Con `acotada` traduciendo un cuelgue a ese
mismo error, a las 10:12 del demo el producto acusa por escrito al comprador,
delante del comprador.

- `processor.ts` — `ResultadoAviso = 'puesto' | 'sin_datos' | 'no_se_pudo'`.
  `sin_datos` **solo** cuando `getDatosResponsable` devuelve `null` (la fila
  existe y le faltan campos). Toda excepción es técnica: `no_se_pudo`. Un rebote
  de Meta también.
- El corte manda el texto que corresponde a cada hecho, y el log lleva `motivo`.
- **Se libera el claim del mensaje** cuando el fallo es de este lado, igual que
  sus dos vecinos (`intake.incremento_fallido` y el mutex ocupado): este `return`
  va antes del brazo de imagen, y dejar el `waMessageId` marcado hacía que un
  reintento se descartara como duplicado. Con `sin_datos` **no** se libera:
  reintentar no arregla un alta incompleta.

**No se hizo, y es deliberado:** guardar la foto como huérfana cuando el aviso no
se pudo poner. Guardarla ES tratamiento, y el bloqueo existe justamente porque no
hay aviso que lo ampare (art. 8 LFPDPPP). Lo reparable era que el mensaje no
quedara contado como procesado y que se le diga la verdad al chofer.

**Prueba:** `src/lib/cuadra/aviso_blip_no_acusa.test.ts` (8 casos, 7 rojos antes).
Actualizadas a la firma nueva las 6 aserciones de `aviso_constancia.test.ts` — el
contrato pasó de `boolean` a los tres estados, que es más específico, no menos.

---

## G-60 · CERRADO
**La única recuperación del cierre a medias estaba detrás de un flag apagado por
default.**

`process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1'` — verificado presente en
`processor.ts:1344`. `verificarEntornoCritico` (startup.ts) solo mira
`DASHBOARD_SECRET`, `.env.example:75` la «recomienda» (o sea: nadie sabe si está
puesta) y `openrouter.ts:402` afirma por escrito que está «activo por default».

El flag se retira. La condición que decide sigue siendo un HECHO
—`guardar_liquidacion` en `partialToolCalls`, sin error—, no una suposición: si
esa tool no corrió, el `else` dice lo de siempre. Una recuperación que solo actúa
sobre un cierre demostrado no necesita interruptor.

**Prueba:** `src/lib/cuadra/cierre_parcial_sin_flag.test.ts` (5 casos, 4 rojos
antes con la variable ausente; el 5º es el control de que un fallo sin cierre
sigue diciendo «se me trabó»).

**Fuera de mi dominio, hay que arreglarlo aparte:**
- `.env.example:75` (D3) — la variable ya no existe; la línea sobra.
- `src/lib/llm/openrouter.ts:402-403` (D6) — el comentario afirmaba «activo por
  default»; ahora es cierto, pero conviene que deje de hablar de un flag.

---

## G-54 · PARCIAL — la parte de código, CERRADA
**El aviso está congelado, y cita el art. 2 fr. XX donde va la fr. XII.**

`SeccionAviso.fundamento` se pinta en `aviso/[tenant]/page.tsx:117`, en palabras
del propio archivo «para que quien lo revise pueda comprobarlo». Una cita mal
puesta ahí no es un typo de comentario.

Cerrado, todo respaldado por `normas/lfpdppp-2-XII-XX.yaml`
(`estado_verificacion: verificado_fuente_primaria`, texto transcrito literal de
diputados.gob.mx):

- **fr. XX → fr. XII** donde se define a la persona encargada. La fr. XX es
  *Transferencia*; la de persona encargada es la fr. XII. El documento que
  sostiene «esto no es una transferencia» citaba como fundamento la definición de
  transferencia. Corregido en `privacidad.ts` (comentario del bloque + el párrafo
  de la sección 1) y en `app/privacidad/page.tsx` (comentario + párrafo).
  **La fr. XX se conserva donde sí va** —«no es una transferencia (art. 2 fr. XX)»,
  que es donde la ficha apoya la conclusión— y hay una prueba que distingue los
  dos usos.
- **Se retira «Reglamento art. 21»** del fundamento de la revocación: es el
  reglamento de la ley abrogada. La propia ficha ya corrigió una vez este error
  en otro párrafo — *«venía del Reglamento de la ley abrogada. Citarla ante un
  cliente es citar derecho derogado»*. **No se sustituye por otra cita:** cuál es
  su equivalente en la ley vigente no lo respalda ninguna ficha, y ponerlo a ojo
  sería el mismo error al revés. Queda `LFPDPPP art. 7 último párrafo`.

**Prueba:** `src/lib/cuadra/privacidad_citas.test.ts` (6 casos, 4 rojos antes).

**DECISIÓN HUMANA — no se tocó, y no se debe tocar sin una persona:**
- El catálogo del art. 15 fr. II no cubre la **fotografía** de perfil (mig. 0046),
  el **correo** (`provisionar.ts:29` lo inserta en `app_user`) ni `pod.lat`/`pod.lng`
  (mig. 0047).
- Las finalidades del fr. III no cubren el **expediente operativo por chofer**
  (incidencias con dueño, entregas que faltan, el «% comprobado»).
- `versionAviso` no cambia al levantar una incidencia, así que el reenvío del
  art. 15 fr. VI no dispara.
- Ningún panel liga a un aviso.

Qué datos y qué finalidades se declaran, y si la foto sigue siendo pública, lo
escribe una persona. Añadir texto legal desde aquí sería inventar el documento
que el contralor va a revisar.

**Nota de coordinación:** el bucket `avatares` de G-29 (owner D5) necesita su
renglón en el catálogo cuando se redacte. No se puede escribir todavía porque no
está decidido si la foto es pública.

---

## G-18 · YA CERRADO por `989ca62`
«listo» con la sala de espera llena cerraba en $0.00, y la oferta se marcaba antes
de entregarse. Verificado en el árbol de hoy:

- `processor.ts` — el brazo `!ofrecidos.length` ofrece **siempre**, incluso ante
  un verbo de cierre, con el comentario que explica por qué se revirtió la
  decisión anterior. Anclado por `huerfanos_flujo.test.ts:393` y `:402`.
- La constancia (`marcarHuerfanosOfrecidos`) va **después** del `say`, y si el
  envío rebota se registra `huerfano.oferta_no_entregada` y no se marca.
- El brazo de huérfanos lleva contador de intake + mutex, y su `catch` reconoce
  `llegoTarde`.
- El `imgHash` viaja con el comprobante hasta `addGasto`.

---

## G-23 · YA CERRADO por `989ca62`
Mutex sin techo, barrera de intake por debajo del techo del OCR, y 50 `INSERT` en
serie. Verificado:

- `conv.ts:287` — el cliente se hoistea fuera del `for(;;)`; `:304` la RPC
  `try_lock_viaje` va dentro de `acotada`; el vencimiento se comprueba después
  del `await` y el comentario lo justifica.
- `presupuesto.ts` — `TOPE_BARRERA_INTAKE_MS = TECHO_OCR_MS + 5_000` = 30,000, o
  sea derivado del techo del OCR y ya no un literal por debajo de él.
- `processor.ts` — el bucle de huérfanos consulta `hayPresupuestoPara` en cada
  vuelta, corta con `huerfano.sin_presupuesto` y le dice al operador cuántos
  faltaron. Anclado por `huerfanos_presupuesto.test.ts`.

---

## G-44 · YA CERRADO por `989ca62`
Verificado: `tools.ts` tiene `paraModelo` con lista **blanca** de cinco campos
(no `delete liq`), y el snapshot que viaja al llamador pasa por `sanearOcrExtra`,
que sanea **todo** valor `string` de `ocrExtra` con cap de 120 — `fechaRaw` y
`codigoBarras` incluidos, que era la mitad que faltaba.

---

## G-59 · YA CERRADO por `989ca62`
Verificado: `normas/fundamento.ts` ya no concede la memoria por vocabulario
compartido. El bloque «EL SUJETO DE LA AFIRMACIÓN» ata la cita al **gasto** del
que habla la oración, y el sujeto solo VETA (nunca concede), así que la caseta
citando la RFA 2.9 —el ejemplo del hallazgo— deja de pasar.

---

## G-55 · PROPUESTO (no reproducible aquí)
Ejercer el derecho ARCO no produce efecto: ni registro que la empresa vea, ni
cambio en el tratamiento automatizado.

`processor.ts:133-147` sigue siendo un `logger.info` + un mensaje. La mitad
detectable —`pideAtencionPrivacidad` reconociendo *máquina*, *computadora*,
*borrar*, *eliminar* y la frase con las dos señales— **sí entró** con `989ca62`
(`36a4ca5`).

Lo que falta exige lo que aquí no hay:
- una tabla de solicitudes ARCO (migración → D5),
- una pantalla en `/dashboard` para que la empresa las vea dentro de sus 20 días
  hábiles (→ D1),
- una bandera de oposición en el esquema que `detectarAnomalias`
  (`analytics.ts:125-146`, → D1) pueda respetar. Hoy lee **todos** los `gasto`
  del tenant porque esa bandera no existe.

Mientras tanto, `privacidad.ts:407,521,528` afirma como hecho *«Queda registrada
tu solicitud para la empresa»*. **Eso es texto legal y su corrección es decisión
humana:** o se construye el registro, o la frase deja de prometerlo. No se toca
desde aquí.

---

## Compuerta

```
npx tsc --noEmit -p .   → exit 0
npx vitest run          → ver más abajo
```

Archivos tocados, todos dentro del dominio D4 (más este documento):

```
src/lib/cuadra/processor.ts
src/lib/cuadra/repo.ts
src/lib/cuadra/tools.ts
src/lib/cuadra/presupuesto.ts
src/lib/cuadra/privacidad.ts
src/lib/cuadra/periodo/combustible.ts
src/lib/cuadra/periodo/aviso.ts
src/lib/cuadra/intake/almacen.ts
src/lib/meta/client.ts
src/app/privacidad/page.tsx

pruebas nuevas
  src/lib/cuadra/huerfanos_atados_al_viaje.test.ts      G-19
  src/lib/cuadra/aviso_blip_no_acusa.test.ts            G-58
  src/lib/cuadra/cierre_parcial_sin_flag.test.ts        G-60
  src/lib/cuadra/cierre_storage_y_acuse.test.ts         G-22
  src/lib/cuadra/privacidad_citas.test.ts               G-54
  src/lib/cuadra/periodo/tope15_numerador_y_margen.test.ts  G-04

pruebas actualizadas al contrato nuevo
  src/lib/cuadra/huerfanos_flujo.test.ts
  src/lib/cuadra/huerfanos_presupuesto.test.ts
  src/lib/cuadra/repo_huerfanos.test.ts
  src/lib/cuadra/aviso_constancia.test.ts
  src/lib/cuadra/repo_acumulado.test.ts
  src/lib/cuadra/periodo/combustible.test.ts
  src/lib/cuadra/periodo/aviso.test.ts
```

## Lo que sale del dominio y hay que arreglar en otro lado

| Qué | Dónde | De quién |
|---|---|---|
| `CUADRA_RECUPERAR_CIERRE_PARCIAL` ya no existe: sobra la línea | `.env.example:75` | D3 |
| El comentario que habla del flag de recuperación | `src/lib/llm/openrouter.ts:402-403` | D6 |
| Exportar `MEDIOS_LISR_27_III` para que `periodo/` importe en vez de copiar | `src/lib/cuadra/cuadre/engine.ts:101` | D2 |
| Tabla de solicitudes ARCO + bandera de oposición (G-55) | migración | D5 |
| Pantalla de solicitudes ARCO (G-55) | `/dashboard` | D1 |
| El renglón del bucket `avatares` en el catálogo del aviso (G-29 × G-54) | redacción legal | humano |
