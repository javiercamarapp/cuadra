# Auditoría 8 — síntesis

**Fecha:** 1-ago-2026. **Anterior:** `docs/auditoria-7/00-SINTESIS.md` (5.5).
**Sha base:** `abdc98d` → `337e1a8`. **Modo:** desatendido, en la nube.
Árbol limpio al arrancar → autofix habilitado. **Rama:** `claude/auditoria-8`.
**Tipo:** **RONDA COMPLETA**, doce auditores, contexto fresco, **los doce
entregaron**.

---

## Nota global: 5.7 (antes 5.5, ▲0.2)

| Rubro | Aud. 7 | Aud. 8 | | Razón |
|---|:--:|:--:|---|---|
| **Operabilidad y DX** | 4 | **7** | ▲3 | se atacó y subió |
| Seguridad | 8 | **7** | ▼1 | mirada más profunda |
| Tool calling | 8 | **7** | ▼1 | deuda que cobró factura |
| **Frontend** | 4 | **6** | ▲2 | se atacó y subió |
| **Cumplimiento legal** | 4 | **6** | ▲2 | se atacó y subió |
| Modelo de datos | 7 | **6** | ▼1 | deuda que cobró factura |
| **Pruebas** | 5 | **6** | ▲1 | se atacó y subió |
| **Sistema agéntico** | 3 | **5** | ▲2 | se atacó y subió |
| Arquitectura | 5 | 5 | = | dos fuerzas que se cancelan |
| Cumplimiento fiscal | 5 | 5 | = | dos fuerzas que se cancelan |
| **Backend y API** | 6 | **4** | ▼2 | mirada más profunda |
| **Rendimiento y costo** | 7 | **4** | ▼3 | mirada más profunda |

**68/12 = 5.7.** Cinco rubros suben, cinco bajan, dos se quedan. Las dos décimas
de mejora esconden **el mayor reacomodo de toda la serie**: diez de doce notas se
movieron, contra dos en la ronda 7.

Y el sentido de la décima importa menos que su composición. Las tres subidas
grandes —operabilidad ▲3, frontend ▲2, legal ▲2— miden **trabajo humano que ya
estaba hecho** en los 34 commits entre rondas. Las tres bajadas grandes
—rendimiento ▼3, backend ▼2— **no miden código que empeorara**: miden que las
notas anteriores estaban infladas porque nadie había abierto esos caminos.

---

## El hallazgo de la ronda: dos rubros llevaban años calificando lo que sí se había mirado

**Backend cayó de 6 a 4 por un brazo que ninguna ronda había abierto.**
`processInbound` tiene tres brazos —texto, imagen y documento—. Las rondas 5, 6
y 7 auditaron los dos primeros. El tercero, el del XML del CFDI
(`processor.ts:532-591`), **no tenía UNA sola prueba**, y ahí vivían dos caminos
donde el mismo dinero se escribe dos veces:

- El XML que no sabe a cuál de dos tickets pegarse **daba de alta un gasto
  nuevo**. `emparejarXmlConTicket` devuelve `null` a propósito ante ambigüedad
  —"sin candidato ÚNICO no se toca nada"—; el `else` del processor leía ese
  `null` como "es nuevo". Dos casetas de $500 el mismo día → cuatro gastos,
  $2,000 comprobados sobre $1,000 gastados, y **estatus `cuadrada`**, que es el
  único estado que nadie revisa. El motor no lo veía porque el gasto que crea el
  XML no lleva `folio`, así que sus dos llaves de duplicado fallan por
  construcción. **Arreglado** (`e447f70`).
- El XML se pega **al viaje abierto de hoy**, no al del gasto. Un XML reenviado
  dos días tarde —que es exactamente lo que el mensaje de cierre le pide al
  operador— repone el mismo diésel en la liquidación siguiente. **Pendiente**:
  el arreglo pide decidir rango y tolerancia de fecha, y eso es diseño, no
  parche.

**Rendimiento cayó de 7 a 4 porque la ronda 6 sumó el peor caso con el
promedio.** Ocho eslabones con un techo escrito de 9,500 ms se sumaron a 0.3 s
cada uno. La suma honesta da **126.1 s contra `maxDuration = 120`**, y el
resultado que no depende de ninguna estimación es aritmética pura:
`108 000` (tope garantizado del reloj) `+ 8 900` (`COSTO_CIERRE_MS`) `+ 4 000`
(el flush nuevo de esta ronda) = **120 900 > 120 000**. El presupuesto no cabe
en su propio límite ni en el camino más favorable.

Ninguno de los dos es código que empeorara esta semana. Los dos llevaban rondas
ahí, calificados por encima de lo que valían.

---

## Lo que sí se atacó, y subió

**Operabilidad ▲3, la subida más grande de la serie.** Sentry quedó cableado de
punta a punta y verificado (`94d0174`), y las dos pruebas de tiempo que existían
sin que CI las corriera ni una vez ahora corren (`cb392f5`). El rubro venía de
"un fallo en producción es invisible"; hoy no lo es.

**Legal ▲2.** La política de Likida y el aviso de la flota dejaron de ser el
mismo documento, la reserva dejó de ser la constancia (`0033`), el aviso
integral existe con sus diez elementos, y `cuadra.mx` —un dominio parkeado que
no es nuestro— salió del pie de cada PDF. Lo que impide pasar de 6: **el camino
de revocación existe en el texto y no existe en el sistema**.

**Frontend ▲2.** `formato.ts` sí es el único origen del formato de cifras, y el
panel lo consume en las cuatro superficies que imprimen dinero. El auditor lo
verificó contando, no leyendo.

**Pruebas ▲1, y trae el número que la ronda 7 pidió.** Mutantes que sobreviven:
**8 de 36 = 22%**, con el denominador el doble de grande que la ronda anterior y
sin descontar equivalentes. La serie va **57% (r5) → 83% (r6) → 19% (r7) → 22%
(r8)**. Y la respuesta a la peor pregunta de la ronda 7 —*¿está probada la
escritura del dinero?*— pasó de **6/6 sobrevivientes a 0/4**. PR-1 quedó cerrado,
verificado con el mutante real: `conv.ts:73` `.limit(2)→.limit(1)` da
`1 failed | 1261 passed`, donde antes daba 1262 en verde.

**Agéntico ▲2, de la nota más baja del repo.** AG-3 quedó cerrado y verificado
ejecutando `guardiaCifras` con el snapshot real: el texto y el PDF ya salen de
la misma fotografía. AG-2 quedó **parcialmente** cerrado — con `consultar_politica`
llamada las citas salen intactas, pero en el camino textual `permitidas` sigue
vacío y la cita sigue saliendo rota.

---

## Los tres arreglos, y cómo se probó que sirven

Uno por commit, cada uno con prueba que lo reproduce, **verificada roja antes y
verde después**. Tope de 3 vueltas alcanzado.

| ID | Arreglo | Sha | Cómo se probó |
|---|---|---|---|
| **ARQ-1** | El PDF llevaba `Cuadra` de cabecera y `Generado por Likida` en el pie de la misma hoja | `9edae2d` | Lee el PDF renderizado. Rojo: `expected 'Cuadra' to be 'Likida'` |
| **BE-1** | El XML ambiguo ya no inventa un gasto | `e447f70` | 4 pruebas sobre el brazo de DOCUMENTO, con control. Rojo: `addGasto` llamado 1 vez |
| **AG-1** | Un PDF que Meta rechaza ya no cuenta como entregado | `8b621ea` | Cliente real, solo la Graph API mockeada. Rojo: `pdf.no_entregado` nunca llamado |

**ARQ-1 merece una nota aparte, y es sobre la prueba, no sobre el arreglo.** La
primera versión buscó `Cuadra` en los bytes crudos del PDF y **pasó en verde con
el bug puesto**: pdf-lib deflata los flujos y escribe el texto como
`<437561647261>`. Una prueba que pasa vacía es peor que no tenerla, y esta ronda
casi commitea una. La versión final infla los flujos y decodifica el hex, y trae
una guarda del propio arnés (`expect(renglones).toContain('LIQUIDACIÓN DE VIAJE')`)
para que, si el extractor se rompe, lo diga en vez de aprobar en silencio.

**AG-1 merece otra, y es sobre por qué la suite no lo veía.**
`processor_cierre.test.ts` mockea `sendDocument: vi.fn()`, que devuelve
`undefined` — exactamente lo mismo que devolvía al ser rechazado por Meta. La
suite entera no podía distinguir entregado de rechazado. Por eso la prueba nueva
usa el cliente real y mockea solo la Graph API.

**Alcance quirúrgico, y lo que deliberadamente NO se tocó.** `Cuadra exacto` y
`Cuadrada` siguen impresos: son el verbo y el estatus, lenguaje del dominio. El
`agentName: 'Cuadra'` de `conv.ts:147` —que hace que el bot se presente con la
marca vieja por WhatsApp— queda como **hallazgo aparte**: es otra superficie y
otro alcance.

---

## Los críticos que quedan, en orden de daño

1. **BE-2** — el XML se aplica al viaje abierto y repone el mismo diésel dos
   veces. Pendiente: pide decidir rango y tolerancia de fecha.
2. **REND-1** — el peor caso no cabe en `maxDuration` y el exceso mata el turno
   en silencio. Pendiente por tope de vueltas.
3. **LEG-2** — en una ráfaga de fotos, perder la reserva se lee como "ya consta"
   y la foto viaja al modelo externo sin que ningún aviso se haya entregado.
   Verificado: `0033:75-88` devuelve `false` por dos razones distintas y
   `processor.ts:169` las colapsa. Pendiente por tope de vueltas.
4. **LEG-1** — el único camino de ARCO termina en un `logger.info` mientras el
   aviso promete que "queda registrada". Pendiente: pide tabla, columna y
   pantalla; no es un cambio quirúrgico y no cabe en una vuelta de autofix.
5. **REND-2** — el abort de los 40 s no corta la tool en vuelo; sobrepaso medido
   de 20.1 s.
6. **DAT-1** — la 0036 protege desde la fila de liquidación, y las cifras se
   congelan segundos antes.

---

## Verificación adversarial

**Cada hallazgo que entró a esta síntesis lo abrí yo contra el código.** Los seis
que verifiqué línea por línea —FE-ALTO-1, FE-ALTO-2, LEG-CRÍTICO-2, LEG-ALTO del
XML, BE-CRÍTICO-1, BE-CRÍTICO-2, ARQ-CRÍTICO, AG-CRÍTICO— se sostuvieron todos.

**Ningún hallazgo resultó falso esta ronda**, y eso merece un matiz en vez de
una celebración: no verifiqué los 60 hallazgos, verifiqué los que mueven nota o
entran a arreglo. Los medios y bajos entran a la síntesis **con la firma de su
auditor, no con la mía**.

Dos auditores refutaron hallazgos propios antes de reportarlos —arquitectura
descartó la ruta del PDF del operador porque ya tiene
`ruta_pdf_sincronizada.test.ts`; frontend descartó el seed apuntando a
`likida.ai` porque es una decisión documentada en `seed.sql:46-52`—. Eso es lo
que se pedía y es lo que hace creíble el resto del reporte.

---

## Compuerta sobre el árbol final

```
npm test          1271 pruebas, 1 saltada, 130 archivos   exit 0   (base: 1262 / 127)
npx tsc --noEmit                                          exit 0
npm run lint                                              exit 0
npm run build     NO SE CORRE en la nube (pide credenciales que aquí no existen)
```

Tablero renderizado **y mirado**: `tablero.png`. Conté los doce rubros en la
imagen, las notas cuadran con esta tabla, y el color codifica la nota y no el
delta —frontend sube 2 y sigue ámbar en 6; seguridad baja 1 y sigue verde en 7—.

---

## Incidencias de infraestructura, que no son hallazgos

- **El clon vino sin `node_modules`** (`vitest: not found` en el primer intento).
  Se corrió `npm ci` antes de tomar la línea base. Segunda ronda seguida.
- **`pruebas.md` tardó 35 minutos y entregó — y yo lo di por muerto antes de
  tiempo.** Cerré la síntesis, el `RESULTADO.md` y el PR marcándolo `INFRA` y
  como rubro sin auditar. **Era falso: el auditor estaba lento, no caído**, y
  entregó a las 11:43 con tres críticos. Todo se corrigió y la nota global pasó
  de 5.6 a 5.7. La lección va escrita aquí porque es exactamente el error que
  `desatendido.md` advierte al revés —confundir *la tarea falló* con *la infra
  falló*— cometido en la dirección contraria: **declarar INFRA lo que solo era
  lento**. El auditor de mutantes corre suites enteras; su presupuesto de tiempo
  no es el de los otros once y la ronda 9 debe esperarlo por defecto.
- `git status --short` tras la ronda: limpio de código de producción. El auditor
  de pruebas muta archivos a propósito y no dejó ninguno atrás.
- `gh` **no existe en este entorno**; el listado de PR se hizo con el MCP de
  GitHub, y su salida real va pegada en el `RESULTADO.md`.

---

## Para la ronda 9

1. **Medir los tres arreglos de esta ronda.** Como en la ronda 7, los doce
   reportes se escribieron **antes** de que ARQ-1, BE-1 y AG-1 aterrizaran. Las
   notas de arquitectura, backend y agéntico califican un árbol que ya no
   existe. Es una propiedad conocida del proceso y la rotación la corrige.
2. **Los tres críticos de pruebas son la lista, y los tres dicen lo mismo**: hay
   arreglos de dinero anclados por un `grep` sobre el fuente en vez de por una
   ejecución. El detector de vouchers —el que quitó $1,600 de comprobado
   fantasma— se prueba leyendo `ocr.ts` con `readFileSync` y `toContain`
   (`voucher.test.ts:78,91,112`, verificado); la mitad productora de AG-3 no
   tiene prueba, así que la tool puede dejar de mandar el snapshot y la guardia
   vuelve a recalcular en verde; y la prueba de AG-2 reimplementa dentro del
   archivo de prueba lo que devuelve `consultar_politica`. Es el mismo modo de
   falla que la ronda 7 encontró con `analytics_deriva`, en tres sitios nuevos.
3. **BE-2 y REND-1 son los dos que más caro salen**, y los dos piden una
   decisión de diseño antes que un parche. BE-2 necesita saber qué rango de
   fechas ata un CFDI a un viaje; REND-1 necesita que alguien decida qué se
   recorta de los 126.1 s.
4. **El `agentName: 'Cuadra'`** de `conv.ts:147` es una línea y sale por WhatsApp
   en el demo del 6 de agosto.
