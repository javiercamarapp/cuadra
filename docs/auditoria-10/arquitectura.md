# Arquitectura y mantenibilidad — auditoría 10

Ancla: commit `cbbdcb0` (HEAD al cerrar esta auditoría; árbol de trabajo **sucio**
con ~30 archivos modificados por otras sesiones activas en paralelo — ver nota
al final). Ronda anterior: `docs/auditoria-9/arquitectura.md`, commit `93a0c42`.

**Nota: 7/10** (sin cambio vs ronda 9). Razón del movimiento: dos mecanismos que
la ronda 9 dejó como apuesta abierta **sostuvieron una segunda ronda**
(`round2()` centralizado, guardarraíl de `etiquetas_sincronizadas`) y el módulo
nuevo más grande de la ronda (`facturacion/`, ~10,500 líneas) está escrito con
un nivel de disciplina de concurrencia y aislamiento por tenant notablemente
alto — pero eso se compensa con dos cosas que no había el 1-ago: el indicador
que la ronda 9 citó como *"primera mejora desde que se mide"* (qué porcentaje
del acceso a datos pasa por `repo.ts`) se revirtió con fuerza sin que exista una
decisión escrita que lo autorice, y un archivo nuevo de hoy mismo (`administracion.ts`)
abre una pregunta de concurrencia sin resolver que nadie más auditó porque no
existía hace 24 horas. Ninguno de los dos alcanza el estándar de "hallazgo
confirmado con escenario reproducido" — quedan como abierto, no como ALTO — así
que no hay motivo para bajar la nota, y tampoco hay commits de esta ronda que la
suban.

---

## El hallazgo de negocio de hoy, verificado desde el código — no desde el dato

Se me pidió verificar a fondo la conclusión de que diésel y casetas (~54% del
gasto real según INEGI, no la canasta CANACAR que el propio IMT no ha
publicado) son justo las categorías que **no generan un ticket facturable por
portal** — el diésel se paga con monedero (CFDI consolidado del emisor) y las
casetas con TAG (factura mensual) — y que por eso "más adaptadores de portal"
no escala hacia el 80% del gasto.

**No pude localizar el artefacto de esa investigación en el repo.** Busqué en
`docs/investigacion/` (incluidos los archivos de hoy, `autopago.html` y
`portales/`), en los 23 documentos de `docs/conocimiento/`, en los `.md` de raíz
y en el diff completo de los ~30 archivos modificados sin commitear — ninguno
menciona "IMT", "54%" ni cita INEGI en ese sentido. Lo más cercano es una nota
de una ronda anterior (`docs/conocimiento/00-OPORTUNIDAD.md:525-527`): *"La
canasta básica CANACAR 2026 [...] el rango encontrado va de 30% a 82% según la
metodología, que es demasiado amplio para usarse sin nota al pie."* Esto acota
la cifra de hoy — 54% cae dentro de ese rango ya conocido como ancho — pero no
la confirma ni la contradice, y **no es lo mismo** que el hallazgo de hoy
(que además distingue INEGI de CANACAR y cita al IMT sobre la tabla nunca
publicada). Se lo anoto al orquestador: si esta cifra es el hallazgo de negocio
más importante de la ronda, hoy vive solo en la conversación que la produjo, no
en el repo — y una conclusión que no se escribe se pierde en la siguiente
compactación de contexto.

**Lo que SÍ pude verificar, con archivo y línea, es la implicación
arquitectónica — de forma independiente, leyendo `src/lib/cuadra/facturacion/`
completo.** El equipo de esta misma ronda (hoy, 4-ago-2026) ya llegó, por su
cuenta y desde datos de campo distintos, a la misma conclusión estructural:

- `src/lib/cuadra/facturacion/enrutar.ts:6-16` — comentario fechado hoy: *"Los
  11 con cuenta son casi todos de PEAJE —IAVE, PASE, TeleVía, PINFRA— y ahí
  además el TAG factura mensual contra la cuenta, no ticket por ticket."*
- `src/lib/cuadra/facturacion/comercios.ts:25-35` — el mismo hecho, con el dato
  que lo prueba: *"El peaje además no se factura ticket por ticket: el TAG
  factura mensual contra la cuenta."* Y las entradas `iave` (línea 596-601) y
  `tag-pase` (línea 611-619) llevan `requiereCuenta: true`, así que **ya se
  enrutan a una persona, no a un adaptador automático** (`enrutar.ts:69-71`).
- `src/app/dashboard/combustible-casetas/page.tsx:29-30,151-153` — la pantalla
  del cliente lo dice en un `EstadoVacio`, sin inventar una cifra: *"El cruce
  del estado de cuenta del monedero de combustible y del TAG de casetas contra
  el CFDI [...] necesita esas dos integraciones conectadas, y hoy no lo están."*
- `src/app/dashboard/configuracion/page.tsx:14-17,159-161` — mismo reconocimiento:
  *"monedero de combustible, TAG de casetas [...] no existen como tales en el
  sistema — enseñarlas apagadas sería prometer una conexión que no está
  construida."*
- `src/lib/cuadra/intake/cfdi_xml.ts:39-42,127-130` — el parser YA distingue un
  `esquemaAlterno` (Carta Porte / "Estado de Cuenta de Combustibles" ECC) del
  esquema normal, específicamente para que el motor fiscal NO declare no
  deducible un CFDI que llega por ese camino.

**Lo que confirma la brecha real, y que ningún archivo de arriba resuelve:**
grepeé el repo completo por `IdCCP`, `Ubicaciones`, `Mercancias` (los nodos del
complemento Carta Porte que harían falta para cruzar un CFDI consolidado contra
un viaje por ruta/placa/fecha en vez de por ticket 1:1) y por `buzon`/`buzón`
(el mecanismo de "ser destinatario" que `docs/investigacion/00-DECISIONES.md:24-44`
ya había decidido el 29-jul como la vía más barata) — cero resultados fuera de
comentarios que solo detectan la PRESENCIA del esquema, nunca lo parsean. Hoy:

1. Un CFDI entra al sistema **uno a la vez**, atado 1:1 a una fila de `gasto`
   ya existente (`al_vuelo.ts:escribirUuid`) o suelto por WhatsApp
   (`processor.ts:414-422`, se guarda con `gasto_id: null` cuando no hay viaje
   abierto). No hay ningún camino que reciba un **estado de cuenta o CFDI
   consolidado de un periodo** y lo reparta entre varios viajes.
2. No existe ningún parser de Carta Porte (`IdCCP`, `Ubicaciones`, `Mercancias`):
   sin eso, no hay forma de decidir a qué viaje pertenece un cargo dentro de un
   consolidado — la única señal que un CFDI de monedero/TAG puede traer para
   identificar el tramo es justo esa.
3. No hay mecanismo de ingesta por correo (el "buzón por tenant" que la
   investigación del 29-jul ya diseñó) en ningún lugar de `src/lib/cuadra/intake/`.

**La implicación para el roadmap, dicha sin rodeos:**

- **El registro de adaptadores actual (`facturacion/adaptadores/registro.ts`,
  `comercios.ts`) está bien acotado para lo que hace** — no pretende cubrir el
  100% del gasto, y de hecho ya excluye explícitamente TAG/peaje del camino
  automático. **No hay que "arreglarlo"** ni forzarlo a crecer hacia diésel y
  casetas: seguir agregando entradas a `TABLA`/`COMERCIOS` (adaptador #14, #15…)
  sigue siendo la estrategia correcta para el conjunto de comercios que SÍ
  emiten un ticket facturable — pero ese conjunto, por diseño del mercado, nunca
  va a incluir la mayoría del gasto en pesos si diésel y casetas de verdad pesan
  la mitad o más.
- **El cuarto entregable no es un archivo nuevo en `adaptadores/`** — es
  estructuralmente distinto: recibir un CFDI o estado de cuenta consolidado
  (por correo, ya decidido el 29-jul), parsear Carta Porte para extraer el
  tramo, y hacer JOIN contra `viaje` por placa+fecha+ruta en vez de por
  `gasto_id`. Es un patrón de escritura distinto al de `al_vuelo.ts`
  (que actualiza UN `gasto` conocido) y no cabe en la tabla de adaptadores sin
  forzarla.
- **Nada de esto bloquea hoy.** Es una decisión de producto — cuatro
  entrevistas con contralores reales siguen pendientes
  (`docs/conocimiento/00-OPORTUNIDAD.md:518`) antes de comprometer ingeniería
  aquí — y por eso no lo construyo ni lo intento; lo dejo escrito con la
  evidencia de código que lo sostiene, tal como pidió la tarea.

---

## Hallazgos de código (arquitectura, no negocio)

### [MEDIO, sin confirmar del todo] `reabrirViaje` no participa del mutex `acquireViajeLock` que protege el resto del ciclo de vida de un viaje

`src/lib/cuadra/administracion.ts:334-407` (función nueva de hoy, commit
`4f8255d`) borra la fila de `liquidacion` y pone `viaje.estatus = 'abierto'`
sin llamar a `acquireViajeLock`/`releaseViajeLock` (`conv.ts:418-464,612-616`),
el mutex que el propio `conv.ts:412-416` documenta como necesario para que "un
`listo` no cierre la liquidación antes de que el OCR de la última foto haya
guardado su gasto". `processor.ts` sí lo toma antes de escribir una liquidación
nueva (líneas 1290, 1646).

**Por qué no lo subo a ALTO:** en el estado estable esto no es explotable —
`getOpenViaje` (`conv.ts:164`) solo devuelve viajes `abierto`/`en_cuadre`, así
que una vez liquidado, el flujo de WhatsApp deja de tocar ESE viaje y abre uno
distinto para el siguiente mensaje del operador. La ventana real sería un
mensaje que YA estaba en vuelo (reclamado, procesándose) justo cuando alguien
reabre desde el panel, y `guardar_liquidacion` corre — por el nombre —
detrás de una función/RPC transaccional (`guardar_liquidacion_tx`, referida en
`analytics.ts:743`) más el índice único `liquidacion_viaje_uidx` (CLAUDE.md,
sección de trampas), que es exactamente el tipo de red que convertiría una
colisión en un error ruidoso en vez de en una liquidación corrupta silenciosa.
**No rastreé el cuerpo de `guardar_liquidacion_tx` para confirmar si
re-valida el estatus dentro de la transacción** — así que esto se queda como
pregunta abierta con evidencia parcial, no como hallazgo cerrado. Vale la pena
que el próximo auditor de backend o de datos lo cierre: o `reabrirViaje` toma
el mismo lock, o `guardar_liquidacion_tx` ya lo hace inmune y se documenta por
qué.

### [Observación, no hallazgo puntual] El perímetro de `repo.ts` volvió a crecer — en la dirección contraria a la que la ronda 9 celebró

La ronda 9 citó como evidencia de mejora que el porcentaje de accesos a datos
FUERA de `repo.ts` bajó de 70% (40/57) a 62% (42/68). Repetí el mismo conteo
(`.from('`/`.rpc('` con literal, sin `*.test.ts`) sobre el árbol de hoy:

```
repo.ts:                    26 sitios (igual que ronda 9 — no creció)
fuera de repo.ts:          135 sitios (antes 42)
total:                      161 (antes 68)
% fuera de repo.ts:         84% (antes 62%)
```

El salto no es sorpresa una vez que se mira de dónde sale: esta ronda se
construyeron cuatro módulos satélite nuevos completos —`operacion.ts` (677
líneas, 29 sitios), `comercial.ts` (358 líneas), `administracion.ts` (407
líneas, 11 sitios incluidos 7 escrituras), `fiscal.ts` (943 líneas)— siguiendo
el MISMO patrón que la ronda 9 ya había aprobado explícitamente para
`conv.ts`/`analytics.ts`/`startup.ts`/`costos.ts`: acotado por tenant, con
`supabaseAdmin()` directo, sin duplicar ninguna verdad que viva en otro lado.
Verifiqué una muestra de las escrituras nuevas (`operacion.ts:383,478,622,646`;
`administracion.ts:47,253,382,389,398`) y **todas** comprueban `error`
explícitamente y fallan cerrado — el mismo estándar que `repo.ts` exige de sí
mismo. No encontré una escritura de dinero silenciosa entre las que revisé.

**Por qué esto es una observación y no un hallazgo con severidad:** no hay un
escenario de "entra esto → sale esto mal" — cada archivo nuevo sostiene la
disciplina. Lo que sí falta, y es una brecha real de mantenibilidad, es una
decisión ESCRITA sobre cuándo un módulo nuevo debe ser "satélite" (su propio
`supabaseAdmin()`) y cuándo debe entrar a `repo.ts`. Hoy ese criterio vive
solo en la cabeza de quien escribió cada archivo, sostenido por
convención y no por regla. `repo.ts:1-2` ya no reclama ser "todo el acceso a
datos" (la ronda 9 corrigió esa frase), así que no hay una afirmación falsa en
el código — pero la pregunta del rubro, *"¿dónde se lee/escribe una
liquidación?"*, ya no tiene una respuesta, tiene aproximadamente diez.

---

## Lo que revisé y está bien

- **`round2()` — la reincidencia de dos rondas se cerró y AGUANTÓ una tercera.**
  `grep -rn "function round2\|const round2"` sobre todo `src/` da un solo
  resultado: `src/lib/formato.ts:53`. Los diez consumidores de dinero
  (`chofer.ts`, `analytics.ts`, `comercial.ts`, `fiscal.ts`,
  `periodo/combustible.ts`, `facturacion/adaptadores/capufe.ts`,
  `cuadre/engine.ts`, `laboral/pagadero.ts`, `admin/negocio.ts`, `saas/iva.ts`)
  importan de ahí. Ninguna copia paralela nueva, ni siquiera en los cuatro
  módulos satélite nuevos que sí tocan dinero.
- **El guardarraíl de etiquetas de concepto sigue vivo y probado.**
  `src/lib/cuadra/etiquetas_sincronizadas.test.ts` — 6/6 verdes
  (`npx vitest run`, hoy). El mapa local de
  `src/app/dashboard/[id]/page.tsx:27-31` (`CONCEPTO`) que en la auditoría 5
  fue el ejemplo canónico de duplicación divergente sigue existiendo, pero
  ahora es explícitamente una RED, no la fuente: `etiquetaGasto()` en la misma
  página (líneas 389-392) llama primero a `etiquetaConcepto` del motor y solo
  cae al mapa local cuando el motor devuelve la clave cruda — con el comentario
  que explica por qué (líneas 376-388). El propio test lo mantiene sincronizado.
- **`facturacion/adaptadores/registro.ts` cierra por diseño una clase de bug
  que el resto del sistema ya sufrió una vez (el registro global de
  `ADAPTADORES` por comercio, sin tenant, que habría facturado con el RFC de
  la flota equivocada).** El archivo entero (líneas 1-74) es el registro de
  esa decisión: por qué no puede ser de nivel de módulo, por qué el tenant va
  EN LA CLAVE sin default, y por qué `conPortales()` usa `finally` para
  garantizar que el registro de una flota no sobreviva para la siguiente
  invocación caliente de Vercel. Es exactamente el tipo de documentación que
  el rubro pide — la decisión arquitectónica queda legible sin tener que
  reconstruir el razonamiento.
- **`al_vuelo.ts:reclamarIntentos` (líneas 592-645) resuelve una carrera real
  con Postgres como árbitro**, no con un sello en memoria: el `UPDATE`
  condicional sobre `autofactura_intentada_en` es exactamente el patrón que
  round 9 celebró para otros casos (RPC atómica en vez de "leer, decidir en
  JS, escribir"). El comentario documenta el bug que esto reemplaza (dos CFDI
  del mismo ticket) con la honestidad de decir que "hoy lo tapa que el modo
  por defecto es `ensayo`".
- **`comercios.ts:20-31` documenta una autocorrección real de esta ronda**:
  Javier cazó que el comentario decía "42 de 60 exigen cuenta" cuando el dato
  correcto era lo opuesto (70% NO la exige), y el archivo deja el error
  anterior visible en vez de borrarlo — es la clase de rastro que el rubro de
  arquitectura pide para "qué se va a desincronizar la próxima vez".
- **280/280 pruebas de `src/lib/cuadra/facturacion/` en verde**
  (`npx vitest run src/lib/cuadra/facturacion/`, hoy), incluidas las de
  integración con Chromium real contra el portal de pruebas de CAPUFE.
- **Sin duplicación nueva entre `/admin` y `/dashboard`** en la muestra que
  revisé: `getGastoPorConcepto`/`getAcreditables` (`analytics.ts`) solo se
  consumen desde `dashboard/`; no encontré una reimplementación de KPIs de
  dinero del lado de `admin/`. No es una revisión exhaustiva de las ~31
  páginas del dashboard, solo de los puntos que ya tenían precedente de
  duplicación.

## Lo que NO alcancé a revisar

- El artefacto original de la investigación del 54%/INEGI/IMT — puede existir
  fuera de este repo (otra sesión, otro documento) y simplemente no haberse
  escrito aquí todavía. Vale la pena que el orquestador confirme con el agente
  que lo produjo antes de asumir que se perdió.
- El cuerpo de `guardar_liquidacion_tx` (la función/RPC que de verdad escribe
  la liquidación) — necesario para cerrar el hallazgo de `reabrirViaje` de
  arriba con un veredicto firme en vez de una pregunta abierta.
- Las ~31 páginas del dashboard completas contra `/admin`, en busca de
  duplicación — solo se revisó la muestra con precedente conocido.
- El resto de los ~30 archivos modificados sin commitear por otras sesiones
  esta noche (no se tocó ninguno: el árbol estaba sucio al empezar, así que
  por la regla de la skill no se hizo ningún fix de código en esta ronda,
  solo lectura y documentación).
