# Auditoría 10 — síntesis (continuación del 3-ago-2026)

**Fecha:** 3-ago-2026 (demo: 6-ago-2026, en 3 días). **Anterior:** esta misma
ronda, parte del 2-ago (7.3), sobre `docs/auditoria-9/00-SINTESIS.md` (7.7).
**Sha base:** `96dc577` (cierre de la parte del 2-ago) → `d08db8a`.
**Modo:** desatendida, en la nube, sin nadie mirando.
**Tipo:** **RONDA DE CONTINUACIÓN** sobre el PR #7, que seguía abierto.
**Árbol al arrancar:** limpio → autofix habilitado.

---

## Por qué esta ronda se reabrió, y por qué con doce auditores y no tres

El 2-ago esta ronda corrió **ligera**: tres rubros rotados, porque el delta de
código desde la ronda 9 era exactamente cero. Su PR quedó abierto esperando
revisión. Hoy la situación es la opuesta:

```
$ git log --oneline 96dc577..origin/master -- src/ supabase/ normas/ | wc -l
49
$ git diff --stat 96dc577..origin/master -- src/ supabase/ normas/ | tail -1
 82 files changed, 5743 insertions(+), 215 deletions(-)
```

La regla de tamaño de ronda dice: con PR de auditoría abierto, se continúa sobre
esa rama y se relanzan **los rubros cuyo archivo falte o cuyo código haya
cambiado**. Aquí faltaban nueve archivos y el código cambió para los tres
restantes, así que se relanzaron los doce. `master` se mergeó a la rama primero
(`6d4ea7a`; un solo conflicto, en el bloque de imports de
`src/app/dashboard/page.tsx`, resuelto por unión).

Lo que entró en esas 5,743 líneas es lo más grande desde el motor de cuadre, y
**nada de ello había sido auditado nunca**:

- **Autenticación real** por sesión de Supabase (magic link + Google),
  reemplazando el passcode compartido: `src/lib/auth/` completo, `src/proxy.ts`
  reescrito, `/login`, `/auth/callback`, `/cuenta`, `/sin-acceso`.
- **Cinco roles**, incluido `encargado` (mig. `0044`) y el chofer con RLS propia
  (mig. `0045`), más su panel `/mis-viajes`.
- **La consola de superadmin `/admin`**: 39 archivos, 28 páginas.

---

## Nota global: 4.9 (antes 7.3, ▼2.4)

| Rubro | Aud. 10 (2-ago) | Hoy | | Razón del movimiento |
|---|:--:|:--:|---|---|
| **Sistema agéntico** | 8 | **3** | ▼5 | **Mirada más profunda** — el código del ciclo no cambió (diff vacío en `processor.ts`, `conv.ts`, `guardia.ts`, `agents/`) y los ocho cierres de la ronda 9 anclaron de verdad. Lo que baja la nota es el subsistema que la ronda 9 metió en el camino del dinero y no auditó: la sala de espera de comprobantes (`comprobante_huerfano`, mig. 0040). |
| **Rendimiento y costo** | 8 | **4** | ▼4 | **Mirada más profunda** — el 8 se sostenía en tres hallazgos que quedaron *sin objeto* al revertir `foto_pendiente`, no atacados. Sumado el peor caso contra el límite escrito, no cabe: 233,000 ms contra `maxDuration = 120,000`. |
| **Pruebas** | 9 | **5** | ▼4 | **Deuda que cobró factura** — 7 mutaciones sobre el código nuevo, **5 sobrevivieron**. Los 3 controles murieron como debían: el motor del dinero sigue armado, y el 9 medía eso. |
| **Cumplimiento legal** | 7 | **4** | ▼3 | **Deuda que cobró factura** — entraron 5,743 líneas que tratan datos personales (correo, teléfono, conversaciones) y `privacidad.ts` no se tocó ni una línea. |
| **Backend y API** | 8 | **5** | ▼3 | **Deuda que cobró factura** — la superficie de servidor nueva decide quién ve el dinero de la flota, y esa decisión se tomó solo en la capa que pinta botones. |
| **Seguridad** | 8 | **5** | ▼3 | **Deuda que cobró factura** — el aislamiento **entre flotas** no se rompió por ningún lado; el que se rompió es **entre roles dentro de una flota**, que es justo el entregable de esta ronda. |
| **Modelo de datos** | 8 | **5** | ▼3 | **Deuda que cobró factura** — la RLS de la 0045 no gobierna los caminos que leen con service-role, y nada sonda que esté aplicada. |
| **Operabilidad y DX** | 7 | **5** | ▼2 | **Deuda que cobró factura** — el login nuevo falla sin dejar una sola línea. |
| **Cumplimiento fiscal** | 6 | **5** | ▼1 | **Mirada más profunda** — los dos altos del 2-ago sí anclaron (medidos ejecutando el motor); al abrir el mismo eje una capa más adentro salieron dos cosas que ya estaban el 2-ago y no se vieron. |
| **Tool calling** | 7 | **6** | ▼1 | **Deuda que cobró factura** — el código del rubro es byte-idéntico al del 2-ago; lo que cambió es que llegó el consumidor de la deuda: `/admin` pinta la atribución modelo↔tokens como hecho en 7 pantallas. |
| **Arquitectura** | 7 | **6** | ▼1 | **Deuda que cobró factura** — la tabla de permisos dice por escrito gobernar la API y ningún endpoint la consultaba. |
| **Frontend** | 5 | **6** | ▲1 | **Se atacó y subió** — el CRÍTICO del 2-ago (`0 L` en la tarjeta destacada) cerró de verdad y quedó fijado **renderizando** el componente, la primera prueba del rubro que ejecuta en vez de leer la fuente. |

Suma: 59/12 = **4.9**. **Once de doce bajaron; uno subió.**

### Que baje 2.4 puntos no es un fallo de la ronda: es el trabajo de la ronda

Ocho de los once movimientos a la baja son *deuda que cobró factura*, no
relectura. El patrón es uno solo y vale nombrarlo:

> **Decisiones que eran correctas mientras todos los usuarios del panel eran
> iguales dejaron de serlo cuando entró un rol cuyo valor entero es ver menos.**

Que todo el panel lea con `supabaseAdmin()` (service-role, salta RLS) y que la
RLS sea por *tenant* y no por *rol* era inofensivo con cuatro roles que veían lo
mismo. La 0045 escribió la RLS del chofer con cuidado — y la aplicación la
esquiva por dos caminos distintos, los dos cerrados hoy.

Las notas de la tabla son **las que pusieron los doce auditores con contexto
fresco, ANTES de los arreglos**, igual que el 2-ago. No se suben por los tres
cierres de hoy: subir una nota por un arreglo que ningún auditor volvió a mirar
es exactamente el movimiento que esta ronda vino a corregir.

---

## Los diez CRÍTICOS distintos, verificados uno por uno

Los doce auditores levantaron 13 CRÍTICOS; **cero falsos**. Consolidados por
causa raíz, son diez. Cada uno lo verifiqué abriendo el archivo antes de
anotarlo — los tres primeros, además, reproduciéndolos con prueba en rojo.

### Cerrados con arreglo, prueba que los reproduce y suite verde

**1 · El chofer con cuenta entra a `/dashboard` y ve la flota entera.**
`d081176`. Hallado por separado por **backend**, **seguridad** y **frontend**.
`requireSessionTenant` (`guard.ts:27-37`) preguntaba dos cosas —¿hay sesión?,
¿hay `tenantId`?— y nunca el rol. Las páginas que cuelgan de esa puerta leen con
`supabaseAdmin()`, que salta RLS, así que la policy `operador_ve_su_viaje` de la
0045 no llegaba a evaluarse. Y no era un caso adversarial: `/login` descarta todo
`next` que no empiece con `/dashboard` (`login/page.tsx:49`, más dos copias en
los server actions y una tercera en `auth/callback:13`), así que el panel del
contralor era el destino **por default** de un chofer. Veía los KPIs, las 20
liquidaciones más recientes de sus compañeros con folio, monto y diferencia, y el
panel de anomalías de fraude. La 0045 dice en su propia cabecera existir para
impedir exactamente esto. Ahora rebota a `/mis-viajes`, que lee con
`supabaseServer()` y sí respeta la policy.

**2 · Las dos rutas de export autentican pero no autorizan.** `8fb74d4`.
Hallado por **backend**, **seguridad**, **arquitectura** y **modelo de datos**.
`permisos.ts:9` promete por escrito que estas funciones deciden «qué botón se
pinta **y qué endpoint acepta la petición**», y `puedeExportar` excluye a
`operador` a propósito. Ningún endpoint la llamaba. Nada más lo tapaba: estas
rutas leen con service-role y viven **fuera** del matcher del proxy. Cualquier
sesión del tenant bajaba el CSV de toda la flota y firmaba la URL del PDF de
cualquier liquidación. La prueba nueva lleva casos de control (flota_admin sí
baja las dos cosas) para que cerrar de más no pase como arreglo.

**3 · El RFC del tenant de demo reprueba nuestro propio dígito verificador.**
`d08db8a`. Hallado por **fiscal**. `TIN010101AAA` es plausible a la vista y
`rfcChecksumOk` lo rechaza; `getConfig` lo descarta y solo lo registra en un log
del servidor, así que `rfcEmpresaInservible` se vuelve `true` (`engine.ts:238`) y
**todo** gasto con `rfcReceptor` cae en `POR_CONFIRMAR`. Medido con los dos
gastos exactos del seed —$4,200 de diésel con complemento HidroYPetro y $1,400 de
caseta, ambos timbrados y con XML verificado—: `totalDeducible 0`,
`ivaAcreditable 0`, `peajeAcreditable 0`. El 6-ago el renglón «Deducible para
ISR» no se imprime, la sección **ACREDITABLE / RECUPERABLE** —la que el propio
código llama «la sección que vende»— devuelve `null` y **desaparece del PDF
entero**, y el único pie que sí sale es falso: dice «Falta timbrar la factura»
sobre dos CFDI vigentes. El motor hace lo correcto; el dato de entrada es el que
no sirve, y por eso el arreglo va sobre el seed y no sobre el motor.

### Propuestos — se agotó el tope de 3 vueltas de arreglo

Ninguno es una opinión: los siete están verificados contra el código. Lo que
falta es presupuesto de arreglo, no evidencia.

**4 · «listo» con la sala de espera llena cierra la liquidación en $0.**
Agéntico. `processor.ts:1059`. Con `ofrecidos.length === 0` y
`pareceCierre === true`, la condición es falsa y el bloque de oferta se salta
**sin log y sin mensaje**; se sigue a la barrera, al mutex y al agente, que cuadra
sobre cero gastos. El chofer que mandó seis comprobantes ayer (sin viaje abierto)
y escribe `listo` hoy recibe «Comprobado: $0.00 · Anticipo: $18,000.00 · Sobró
$18,000.00 (a favor de la empresa)» y su PDF, y las seis filas quedan en
`comprobante_huerfano` para ofrecerse en el **viaje siguiente** — que es
literalmente lo que la 0040 dice existir para impedir. Verificado abriendo
`processor.ts:1002-1075`. **Primer candidato de la ronda 11.**

**5 · La RLS del chofer cubre 3 de las 7 tablas.** Seguridad.
`0045_rls_operador.sql:39` excluye a `operador` de `tenant_data` solo en `viaje`,
`gasto` y `liquidacion`. La policy de `0001_init.sql:109` sigue dando `for all`
sobre las otras cuatro a cualquier `app_user` del tenant: un chofer con token
válido conserva lectura **y escritura** sobre `politica_gasto` (sus propios topes
de gasto), `wa_conversacion` (las conversaciones de sus compañeros), `operador` y
`terminal`. Verificado leyendo las dos migraciones. **No se arregló porque no es
reproducible aquí** —no hay base contra la que ejercer una policy— y porque
cambiar política de RLS a tres días del demo es una decisión, no un arreglo
mecánico.

**6 · Nada sonda la 0045.** Modelo de datos. Si la migración no está aplicada, el
`select` de `operador_id` falla y deja a **todos** fuera del panel —incluido el
superadmin— mientras el arranque reporta `ok:true` con un `warn`. Mismo motivo
para no arreglarlo: no reproducible sin base.

**7 · `/admin` expone conversaciones y teléfonos de operadores identificables.**
Legal. Para una finalidad de Likida que el aviso de privacidad de la flota no
cubre, y que contradice por escrito. Requiere decisión de producto (y
probablemente texto de aviso nuevo), no un parche.

**8 · `/auth/callback` no escribe una sola línea cuando el login falla.**
Operabilidad. Verificado: `route.ts:31-35` es un `catch {}` vacío —lo que además
impide que `onRequestError` lo vea— y el camino de `error` truthy cae al redirect
de `:37` sin log. Si el contralor no puede entrar el 6-ago, no hay con qué saber
por qué.

**9 · El login solo registra el caso benigno.** Operabilidad. Los fallos reales de
envío del magic link salen sin log, y el SMTP de hoy es un sandbox que ya se sabe
que rebota.

**10 · `/admin` tiene sus dos capas de autorización sin ancla.** Pruebas. 3,839
líneas y 28 páginas con cero archivos de prueba: las mutaciones de
`admin/layout.tsx:27` y `proxy.ts:44` dejan la suite **verde**. La autorización de
`/admin` es correcta hoy —el frontend abrió las 28 páginas y confirmó que el gate
es `requireSuperadmin()` en el layout, no solo el matcher— pero nada impediría que
se rompiera sin que nadie se entere.

---

## Lo que se revisó y salió limpio

Vale tanto como los hallazgos, porque es lo que distingue un rubro sano de uno
sin mirar:

- **El aislamiento entre flotas no se rompió por ningún camino recorrido**, no
  hay acceso sin autenticar a datos de un tenant, y ningún secreto tiene fallback
  derivado de otro (seguridad).
- **El motor del dinero sigue armado**: de las 7 mutaciones del auditor de
  pruebas, los 3 controles sobre el motor murieron como debían.
- **Los cierres de la ronda 9 anclaron de verdad** donde se verificaron: backend
  confirmó sus 4, agéntico sus 8 (incluida la reversión completa de
  `foto_pendiente`), datos su alto de la 0037, legal sus 2, fiscal sus 2 del
  2-ago. Ninguno reincidente.
- **La advertencia del MAPA sobre `/admin` no se confirmó**: el frontend abrió las
  28 páginas y no encontró una sola cifra fabricada en 4,103 líneas. Sus fallos
  son de forma, no de honestidad. Se anota porque una sospecha del orquestador que
  resulta falsa también es resultado.
- **El chat de `/admin` no toca el camino de tools ni el del modelo** (tool
  calling): ningún archivo bajo `src/app/` invoca `generateWithTools`,
  `generateStructured`, `executeTool` ni `modelFor`. `/admin` lee `llm_costo`, no
  lo produce.

## Hallazgos descartados por falsos

**Ninguno.** Los 13 críticos y los 30 altos que llegaron se sostuvieron al
abrirlos. Se anota explícitamente porque en la auditoría 2 uno resultó falso, y el
conteo de falsos es lo que mantiene honestos a los auditores de mañana.

Una corrección sí hubo, y va aquí por lo mismo: el auditor de pruebas reportó que
`src/lib/cuadra/seed_rfc.test.ts` «falla hoy». Era cierto en el instante en que lo
leyó —la prueba estaba escrita y el arreglo del seed todavía no— y dejó de serlo
minutos después. Re-verificado: la suite completa está verde.

---

## La compuerta, sobre el árbol final

```
$ npm test              → exit 0
  Test Files  175 passed (175)
       Tests  1638 passed | 1 skipped (1639)
  Duration 30.11s
$ npx tsc --noEmit      → exit 0, sin salida
$ npm run lint          → exit 0, sin salida
$ npm run build         → NO SE CORRE en la nube (pide Supabase, OpenRouter,
                          Facturapi y Upstash; su fallo no diría nada del código)
```

Línea base al arrancar la continuación: 173 archivos / 1629 pruebas. Los tres
arreglos sumaron **+2 archivos y +9 pruebas**, cada una con su caso rojo
verificado antes del arreglo.

Contra eso, el dato que ordena el rubro de pruebas: los 49 commits de código que
entraron desde el 2-ago (+5,743 líneas en 82 archivos) trajeron 10 archivos de
prueba y 59 pruebas — y 5 de 7 mutaciones sobre ese código nuevo dejan la suite en
verde. **Verde no es lo mismo que cubierto.**

El tablero (`tablero.html`) se capturó en `tablero.png` y **se miró**: 12 rubros
contados, 59/12 = 4.9 cotejado contra el encabezado, los 10 críticos cuadrados
contra la tarjeta de resumen (3 cerrados + 7 propuestos) y las cifras de la
compuerta cotejadas con la corrida real.

---

## Lo que un humano tiene que decidir

1. **Los siete críticos propuestos.** Tres días para el demo. Si hay que elegir
   uno, es el **#4** (la liquidación en $0): es el único que le imprime al
   contralor una cifra equivocada por un camino que un chofer puede recorrer sin
   proponérselo.
2. **Los dos críticos de RLS (#5, #6)** necesitan una base contra la cual
   probarse. No se tocaron a ciegas a propósito.
3. **El PR #6 (`claude/auditoria-8`) sigue abierto** y cada día se aleja más de
   `master`. Lleva 3 arreglos con prueba que nunca aterrizaron
   (`processor_entrega_rechazada.test.ts`, `processor_xml_ambiguo.test.ts`,
   `pdf_un_solo_nombre.test.ts` — ninguno existe en el árbol de hoy). Sigue
   requiriendo decisión humana: su diff borraría migraciones y pruebas que sí
   están en `master`.
