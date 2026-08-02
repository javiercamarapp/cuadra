# Cumplimiento legal — auditoría 9

**Nota: 4/10** (antes 6). Razón del movimiento: **deuda que cobró factura**. Los
dos ALTOS de la ronda 8 SÍ cerraron — verificado corriendo `privacidad.test.ts`,
`privacidad_ronda6.test.ts` y `aviso_integral.test.ts` (100/100 verdes) y
probando yo mismo el código real contra frases nuevas, no solo las del repo.
Pero el mismo comentario de `sanitizar.ts` que la ronda 5 dejó escrito —"una
imagen no se puede enmascarar de antemano […] esto reduce lo que se PERSISTE,
no lo que se remite"— se volvió falso a media ronda: `87ad2ee`, en este mismo
período, empezó a **persistir** la imagen del ticket y a **enseñársela al
contralor** con un botón nuevo ("Ver foto"), y nadie volvió a esa frase para
preguntarse si el filtro de sensibles seguía cubriendo lo que dice cubrir.

El riesgo mayor hoy: el aviso público le dice a un operador que si su foto trae
un dato de salud "por accidente […] no se usa para nada" — y desde este mismo
período, si eso pasa, su patrón puede verla con un clic.

## Hallazgos

### [CRÍTICO] La foto del ticket se guarda y se enseña al contralor sin ningún filtro de contenido sensible, mientras el aviso público jura que eso "no se usa para nada"

`src/lib/cuadra/intake/almacen.ts:39-67` (`subirComprobante`) ·
`src/app/dashboard/[id]/page.tsx:48-51,196,205-218` (botón "Ver foto", nuevo
esta ronda) · `src/lib/cuadra/privacidad.ts:481` · `src/lib/cuadra/intake/sanitizar.ts:33-49,111-119`

**Escenario, con valores.** Un operador compra su medicamento en la carretera y
lo mete a gastos con foto del ticket — el caso real que la propia ronda 5 ya
encontró en producción: `"producto": "METFORMINA 850MG 30 TABS"`.

1. `ocr.ts` extrae `producto: "METFORMINA 850MG 30 TABS"`. `sanitizarProducto`
   (`sanitizar.ts:111-119`) reconoce `mg` + la palabra y descarta el campo
   completo antes de guardarlo — el texto sale limpio de `gasto.ocr_extra`.
   Esa mitad funciona.
2. Pero `subirComprobante` (`almacen.ts:39`), que corre en paralelo
   (`processor.ts:512`) para **todas** las fotos sin excepción, no mira el
   contenido en ningún momento: sube el `dataUrl` completo al bucket
   `comprobantes` pase lo que pase. Lo verifiqué leyendo la función entera:
   no hay ninguna llamada a `sanitizarProducto` ni a ningún clasificador antes
   del `upload`, y `almacen.test.ts` (9 pruebas) no menciona "sensible",
   "salud" ni "farmacia" ni una vez — nunca se probó el caso.
3. El ticket completo —con "METFORMINA 850MG" impreso, legible— queda en el
   bucket, retenido con el mismo horizonte de cinco años que el propio
   `0039_bucket_comprobantes.sql` cita para el resto de comprobantes.
4. `src/app/dashboard/[id]/page.tsx:48-51` (código **nuevo de esta ronda**,
   parte del mismo commit `87ad2ee`) firma una URL por cada `imagenUrl` y
   pinta una columna "Ticket" con un enlace **Ver foto** (`:205-218`) para
   **cualquier** gasto que tenga imagen — sin distinguir concepto. El
   contralor, autenticado con el passcode del panel, hace un clic y ve el
   ticket de la farmacia con el nombre del medicamento.

Mientras tanto, `avisoIntegral()` — el documento público en
`/aviso/[tenant]`, la única fuente de verdad que el operador puede leer —
sigue diciendo, sin que este período lo haya tocado:

> "**No se tratan datos sensibles.** Ni salud [...]. Si en una foto aparece
> algo así por accidente, **no se usa para nada** y puedes pedir que se
> borre." (`privacidad.ts:481`)

Verifiqué con `git log -S` que esta frase es de la ronda que creó el aviso
integral (`9e4a7d8`), **anterior** a que existiera almacenamiento de fotos.
Cuando se escribió era cierta: la imagen se remitía al modelo de visión y se
tiraba, así que "no se usa para nada" describía la realidad. `87ad2ee`
cambió esa realidad en este mismo período y no volvió a esta línea.

**Consecuencia.** *Para el titular:* su empleador ve, sin que él lo sepa,
un dato de salud suyo que el propio texto legal de la empresa le prometió por
escrito que "no se usa para nada". *Para la autoridad:* es exactamente el
supuesto que `docs/conocimiento/11-datos-personales.md:449` pide construirse
como "Filtro de datos sensibles colados […] Detecta y excluye" — hoy sin
construir para el canal de imagen — y el art. 8 párrafo segundo prohíbe crear
una base con sensibles sin justificación; el art. 59 fr. IV permite doblar la
sanción cuando hay sensibles de por medio. *Para Likida:* el 6-ago, si el
contralor de Innovativos hace clic en "Ver foto" de un ticket cualquiera del
demo y el aviso que él mismo puede leer en `/aviso/[tenant]` dice lo
contrario de lo que acaba de hacer posible, es una contradicción que un
abogado del lado del cliente encuentra en un clic.

**Refutación que intenté.** ¿Guardar la foto para cumplir el CFF art. 30 es en
sí mismo una "justificación" que cubre el art. 8? No para el dato sensible
específico: la obligación de conservar comprobantes fiscales cinco años es
sobre el comprobante en general (RFC, monto, folio), no una autorización para
retener y exhibir sin filtro el contenido de salud que accidentalmente venga
impreso en el mismo papel — que es precisamente la distinción que
`sanitizarProducto` ya traza para el campo de texto. Si el argumento valiera
para la imagen, tampoco haría falta el filtro de texto. ¿Es un caso raro? La
propia ronda 5 lo encontró en datos reales de producción, no hipotéticos.

**Causa raíz.** El comentario de `sanitizar.ts:46-49` ("una imagen no se puede
enmascarar de antemano […] esto reduce lo que se PERSISTE, no lo que se
remite") fue una decisión correcta cuando la premisa era cierta: la imagen no
se guardaba. `87ad2ee`, en esta misma ronda, retiró esa premisa —ahora sí se
persiste— sin que nadie revisara si la mitigación seguía alcanzando. Los dos
cambios son legítimos por separado y colisionan entre sí.

---

### [ALTO] El arreglo de la ronda 8 contra las quejas de tickets ahora traga la oposición real que menciona el objeto que se está opinando

`src/lib/cuadra/privacidad.ts:313-319` (`OPOSICION_AMBIGUA`, `OBJETO_DE_PAPEL`)
· `:342` (la exclusión en `pideAtencionPrivacidad`) · `src/lib/cuadra/processor.ts:289-292`

**Artículo y texto aplicable.** Art. 26 fr. II — el mismo derecho que la ronda
8 cerró de un lado (falsos positivos que secuestraban quejas normales) y que
aquí se abre del otro (falsos negativos que pierden el ejercicio real).

**Escenario, con valores.** Corrí `pideAtencionPrivacidad` —el código real de
HEAD, sin mocks— contra frases que contrastan explícitamente "persona" contra
"programa", que es la forma exacta que el propio aviso induce ("Tienes
derecho a oponerte a que se decida así [un programa] y a pedir que la revise
alguien"):

```
pideAtencionPrivacidad('quiero que una persona revise mi comprobante en vez del programa')
  => false
pideAtencionPrivacidad('que revise una persona mi comprobante, no el programa automático')
  => false
pideAtencionPrivacidad('quiero que una persona revise mi ticket, no confío en el programa')
  => false
```

Las tres son oposición inequívoca al tratamiento automatizado —contrastan
explícitamente "una persona" contra "el programa"/"el programa automático",
justo el supuesto del art. 26 fr. II que el propio aviso anuncia con esas
palabras—, y las tres dan `false`. La razón es mecánica: `OPOSICION_AMBIGUA`
(`:313-316`) sí las reconoce como forma de petición, pero `OBJETO_DE_PAPEL`
(`:319`, `ticket|folio|comprobante|recibo|factura|foto|imagen|lectura`) las
excluye porque mencionan "comprobante" o "ticket" — y eso es inevitable: el
tratamiento automatizado que el aviso describe (`privacidad.ts:502`, "La
revisión de tus comprobantes […] la hace un programa") **es sobre
comprobantes por definición**. Quien se opone a esa revisión casi siempre va a
nombrar lo que se está revisando.

Contraste: `'me opongo a que el sistema revise mis comprobantes automáticamente'`
sí da `true` — pero solo porque "me opongo" cae en el patrón `OPOSICION`
inequívoco (`:294`), que nunca pasa por `OBJETO_DE_PAPEL`. La cobertura
sobrevive únicamente para quien usa el verbo "oponerse" o la forma
"no quiero que…"; se pierde para quien contesta con la fórmula que el propio
aviso le acaba de enseñar ("que la revise una persona").

`processor.ts:289-292` es el único punto de entrada: si `pideAtencionPrivacidad`
da `false`, el mensaje sigue de largo hacia el agente conversacional normal
— exactamente el mismo destino, y la misma pérdida de rastro
(`privacidad.solicitud_operador` nunca se escribe), que describía el ALTO
original de la ronda 8.

**Consecuencia.** *Para el operador:* pide expresamente que un humano revise
su caso en vez del programa —el derecho que el aviso le prometió con esas
palabras— y el sistema no lo registra como tal; recibe una respuesta genérica
del agente sobre su ticket, no la constancia ARCO. *Para la auditoría:* la
prueba nueva de la ronda 8 (`privacidad_ronda6.test.ts:69` y
`privacidad.test.ts:265-271`) verificó la forma ambigua SIN vocabulario de
papel (`'que lo revise alguien, no un programa'`) y el caso negativo CON
vocabulario de papel pero SIN contraste programa/sistema (`'que revise una
persona el folio porque el sistema lo leyó mal'`); ningún caso de prueba
combina ambas señales a la vez, así que el hueco pasó los 100/100 verdes sin
que nada lo viera.

**Refutación que intenté.** ¿Es defendible que baste con escribir *PRIVACIDAD*
o "me opongo", y que el resto sea cobertura extra no garantizada? No: el
propio comentario del módulo (`privacidad.ts:270-274`) es explícito sobre por
qué existe esta segunda vía — "Quien acaba de leer esa frase no escribe
PRIVACIDAD: escribe la frase que acaba de leer" —, así que degradar la
cobertura justo para quien responde con las palabras del aviso deshace la
razón de ser del mecanismo, no un extra.

**Causa raíz.** El arreglo de la ronda 8 resolvió el falso positivo con una
sola señal (presencia de vocabulario de papel) sin una segunda señal que
capturara el contraste explícito persona/programa que sí distingue una queja
de ticket de una oposición real. Las dos siguen siendo indistinguibles por la
misma regla que las separaba antes del arreglo: el objeto de la revisión.

---

## Lo que revisé y está bien

- **Los dos ALTOS de la ronda 8 cerraron de verdad, no solo de nombre.**
  `privacidad.ts:544` ya no promete "retención cero contratada": dice "se les
  pide explícitamente que no retengan", que es lo que `PROVIDER_OPTS =
  { provider: { data_collection: 'deny' } }` (`openrouter.ts:123`) realmente
  hace, aplicado sin huecos en `generateResponse`, `generateStructured` y
  `generateWithTools` (los tres spreads de `PROVIDER_OPTS`, verificado
  leyendo `openrouter.ts` completo). El mismo cambio se propagó a
  `src/app/privacidad/page.tsx:81`, la página propia de Likida — no se quedó
  solo en el aviso de la flota.
- El patrón original que la ronda 8 atacó (`"que revise una persona el folio
  porque el sistema lo leyó mal"`, la queja de ticket sin contraste
  programa/sistema) sigue dando `false` — lo corrí de nuevo yo mismo, no
  confié en el test del repo. La ronda 8 no se revirtió; lo que abrió es un
  caso nuevo, no el mismo.
- `supabase/migrations/0039_bucket_comprobantes.sql`: bucket `comprobantes`
  con `public: false` y **sin policies** — RLS de storage deniega a
  anon/authenticated por default, solo el service-role sube y firma. Mismo
  criterio que la 0008. No hay `getPublicUrl` en ningún lugar del código
  (`command grep -rn "getPublicUrl" src` → vacío).
- No apareció código nuevo de custodia de credenciales de portales de
  terceros esta ronda (`facturacion/permiso_cre.ts` es una tabla de consulta
  de 12,625 permisos públicos del CRE, no una credencial) — sigue en cero,
  cuarta ronda consecutiva que lo verifico.
- `docs/conocimiento/` no se tocó esta ronda: no hay drift entre la
  investigación y lo que el código dice hacer más allá de lo que reporto
  arriba.
- Las 149 pruebas del rubro (`privacidad.test.ts`, `privacidad_ronda6.test.ts`,
  `aviso_integral.test.ts`, `src/app/privacidad/privacidad.test.ts`,
  `almacen.test.ts`) pasan contra HEAD — corridas por mí.

## Lo que NO alcancé a revisar

- Si el pendiente de "confirmar el régimen de retención de OpenRouter" (el
  que sigue documentado como abierto en `52-anexo-subencargados.md` desde la
  ronda 8) tiene alguna respuesta fuera del repo.
- El contrato entre Likida y la flota, y la autorización expresa de
  subcontratación (Regl. arts. 54-55): sigue sin vivir en el repo, mismo
  estado que rondas anteriores; no profundicé más allá de confirmar que
  sigue ausente.
- Si `/api/export/pdf/[id]` incrusta o enlaza la foto del ticket dentro del
  PDF que sale por WhatsApp — solo revisé el camino del panel
  (`dashboard/[id]/page.tsx`). Si el PDF también la sirve, el CRÍTICO de
  arriba tendría un segundo canal de salida que no medí.
- El TTL de una hora de la liga firmada (`almacen.ts:76`) y el hueco de FK en
  la migración 0038 (`foto_pendiente`, aislamiento cruzado entre tenants):
  ya están reportados con cita a LFPDPPP en `docs/auditoria-9/seguridad.md`
  (hallazgos MEDIO ambos); no los repito aquí, pero refuerzan el mismo
  hallazgo CRÍTICO desde el ángulo de control de acceso en vez del de
  cobertura del aviso.
- Un barrido exhaustivo de `OPOSICION_AMBIGUA` contra más vocabulario de
  caseta más allá de los seis casos que probé — no hice fuzzing sistemático.
