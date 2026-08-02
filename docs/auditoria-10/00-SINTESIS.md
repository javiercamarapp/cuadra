# Auditoría 10 — síntesis

**Fecha:** 2-ago-2026 (demo: 6-ago-2026, en 4 días). **Anterior:** `docs/auditoria-9/00-SINTESIS.md` (7.7).
**Sha base:** `848487a` (cierre de la ronda 9) → `de4b945` (cierre de ésta).
**Modo:** desatendida, en la nube, sin nadie mirando. **Tipo:** **RONDA LIGERA — 3 rubros rotados.**
**Árbol al arrancar:** limpio → autofix habilitado.

---

## Nota global: 7.3 (antes 7.7, ▼0.4)

**El delta de código desde la ronda 9 es cero.** `git log 848487a..HEAD -- src/
supabase/ normas/` no devuelve nada: el árbol es byte por byte el que la ronda 9
dejó. Por la regla de tamaño de ronda, eso es una ronda ligera de 3 rubros por
rotación, y cambia la naturaleza del trabajo: **esta ronda no buscó regresiones,
auditó una calificación.**

El encargo lo fijó la propia síntesis de la ronda 9, que cierra así:

> «la columna "tras los arreglos" es mi lectura de qué tan sostenido queda cada
> rubro [...] **no una re-corrida de los 12 auditores con contexto fresco**. Esa
> re-corrida es, por diseño, el Paso 1 de la ronda 10.»

La ronda 9 subió 6.5 → 7.7, el salto más grande de la serie, sobre notas que
nadie con contexto fresco había verificado. Se mandaron tres auditores nuevos a
verificarlas. **Bajaron los tres.**

| Rubro | Aud. 9 | Aud. 10 | | Razón del movimiento |
|---|:--:|:--:|---|---|
| **Frontend** | 7 | **5** | ▼▼ | **Mirada más profunda** — el código no cambió, la nota anterior estaba inflada. El 7 se puso sobre un rubro que nadie había *ejecutado*. |
| **Cumplimiento fiscal** | 7 | **6** | ▼ | **Mirada más profunda** — el código no cambió, la nota anterior estaba inflada. 3 de los 4 altos de la ronda 9 anclaron de verdad; el cuarto cerró el falso positivo y abrió el falso negativo. |
| **Tool calling** | 8 | **7** | ▼ | **Mirada más profunda** — el código no cambió, la nota anterior estaba inflada. El ancla de 8 es doble y solo se cumple la primera mitad. |
| Pruebas | 9 | 9 | = | no auditado esta ronda |
| Sistema agéntico | 8 | 8 | = | no auditado esta ronda |
| Backend y API | 8 | 8 | = | no auditado esta ronda |
| Modelo de datos | 8 | 8 | = | no auditado esta ronda |
| Rendimiento y costo | 8 | 8 | = | no auditado esta ronda |
| Seguridad | 8 | 8 | = | no auditado esta ronda |
| Cumplimiento legal | 7 | 7 | = | no auditado esta ronda |
| Operabilidad y DX | 7 | 7 | = | no auditado esta ronda |
| Arquitectura | 7 | 7 | = | no auditado esta ronda |

Promedio de los doce: 88/12 = **7.3**.

### Por qué las notas NO suben por los arreglos de hoy

Se cerraron el crítico y dos de los tres altos, con prueba que los reproduce.
Aun así las notas de la tabla son las que pusieron los auditores **antes** de
los arreglos, y se quedan así a propósito: subirlas por un arreglo que ningún
auditor con contexto fresco ha vuelto a mirar es exactamente el movimiento que
la ronda 9 hizo y que esta ronda vino a corregir. La ronda 11 las medirá.

---

## Los tres rubros, y por qué estos

Rotación por nota más baja y por abandono. Las rondas 7, 8 y 9 fueron completas,
así que el filtro literal «no auditado en las últimas 3 rondas» da conjunto
vacío; se aplicó nota más baja, con el abandono como desempate:

- **Cumplimiento fiscal** (7): el salto más violento de la ronda 9 —4 → 7 en una
  sola ronda—, y el rubro que le cuesta dinero al cliente.
- **Frontend** (7): lo que el contralor literalmente mira el 6-ago. Subió por UN
  alto cerrado y no tiene lint ni prueba propia.
- **Tool calling** (8): **no se atacó en las rondas 7, 8 ni 9** — tres rondas
  congelado mientras acumulaba siete hallazgos abiertos. Es el único rubro que
  satisface literalmente el criterio de rotación.

---

## Hallazgos: 27 verificados, 0 falsos

1 CRÍTICO · 3 ALTOS · 14 MEDIOS · 9 BAJOS. Cada uno se abrió contra el código
antes de anotarlo. **Esta ronda no produjo ningún falso** — a diferencia de la
auditoría 2, donde uno resultó inventado. Los tres auditores entregaron
`archivo:línea` verificables y escenarios ejecutados contra el motor real.

### Cerrados con arreglo, cada uno con su commit y su prueba

| ID | Hallazgo | Rubro | Sev. | Commit |
|---|---|---|---|---|
| **FE-1** | La tarjeta destacada del panel imprime `0 L` en las rutas que el demo puede tomar, donde el guion manda narrar «el dato duro que el contador multiplica» | Frontend | **CRÍTICO** | `5365ca0` |
| **FISCAL-1** | Tras el arreglo de EFOS de la ronda 9, un CFDI que el SAT marcó sale «Deducible para ISR $11,600» en verde con $1,600 de IVA acreditable | Fiscal | **ALTO** | `65b90eb` |
| **FISCAL-2** | Los litros del estímulo de diésel se cuentan con cualquier forma de pago que no sea efectivo, incluido el `99` obligatorio en todo CFDI PPD | Fiscal | **ALTO** | `0d1fe65` (+ `de4b945`) |

**FISCAL-1 es el hallazgo de la ronda.** La auditoría 9 arregló un falso
positivo real: `sat.ts` mapeaba `ValidacionEFOS='100'` directo a `efos: true` y
declaraba fraude confirmado sobre un emisor que podía estar solo PRESUNTO en el
69-B. Ese arreglo era correcto y no se revirtió. Pero con él `efos` ya no puede
valer `true` desde ningún camino (`intake/sat.ts:82`), así que `g.efos === true`
(`engine.ts:405`) quedó inalcanzable y **todo** EFOS entra por
`cfdi_efos_indeterminado` — que no estaba en `NO_DEDUCIBLE_ISR`, ni en
`POR_CONFIRMAR`, ni en `SIN_ACREDITAMIENTO`. Se pasó de *siempre duro* a *nunca
duro*. El arreglo de un alto abrió otro alto, en la misma ronda que lo celebró,
y solo un auditor sin el contexto de haberlo escrito podía verlo.

Los tres se verificaron **por mutación**: reintroducir el bug pone la prueba
nueva en rojo. Sin eso, una prueba que pasa con y sin el arreglo no probó nada.

### Los tres altos de la ronda 9 que SÍ anclaron

Verificados ejecutando el motor, no leyendo el commit: el tope de $750
(`72b565b`), la comida amparada solo por transporte sin tarjeta de crédito
(`c64c74c`) y el permiso CRE que mandaba el viaje demo a rojo (`f25d44f` —
además la causa raíz, no solo el síntoma). **Eso vale y se dice.**

### Lo que queda propuesto

**FE-2 (ALTO, no arreglado):** el simulador `/demo` afirma «CFDI validado por QR
✅» y dos burbujas después se desdice —«el receptor no se pudo leer del
comprobante, reenvía una foto más clara del QR»— sobre el mismo comprobante. La
palomita es una cadena literal que se dispara solo porque el preset trae
`cfdiUuid` (`demo/page.tsx:38`); `api/demo/route.ts:33-40` construye el gasto
sin `rfcReceptor`, así que el motor emite `rfc_receptor_no_verificable`.
Verificado. **No se arregló: se agotaron las 3 vueltas de arreglo que la skill
permite.** Es el primer candidato de la ronda 11.

Los 14 MEDIOS y 9 BAJOS quedan propuestos por el alcance por default (autofix
solo críticos y altos). Los de más peso:

- **Fiscal:** las dos fichas que respaldan las cifras impresas (`lisr-28-V`, el
  $750/día; `lif-2026-20-A`, los litros) dicen `verificado_fuente_primaria`
  mientras su propia `nota_verificacion` admite reproducciones secundarias,
  y `lisr-27-III` —misma calidad de evidencia— está honestamente marcada
  `evidencia_corroborante`. El mecanismo de confianza del rubro no es auditable.
- **Fiscal:** `/api/demo` corre el motor sin configuración fiscal, así que el
  mismo gasto da dos veredictos según la puerta ($2,250 de deducción de
  diferencia). Hoy ningún preset lo dispara; uno editado antes del 6-ago sí.
- **Tool calling:** de los tres caminos con fallback del gateway, solo uno tiene
  prueba que lo ejecute — y el que no la tiene es el del OCR, el camino feliz
  del demo. El rol `cuadre_fallback` está declarado, presupuestado y
  documentado, y no lo llama nadie.
- **Frontend:** `TonoDeducibilidad` ganó un cuarto miembro en la ronda 9 y el
  panel sigue conociendo dos: «Por confirmar» se ve idéntico a «Deducible para
  ISR» en pantalla.

---

## Un hallazgo de proceso: el PR #6 lleva trabajo real sin aterrizar

`gh`/GitHub reporta **un PR de auditoría abierto: el #6** (`claude/auditoria-8`).
No se continuó sobre él, y la razón importa:

- La ronda 9 ya cerró completa y aterrizó en `master`; `docs/auditoria-8/`
  también está en `master`, con sus 12 rubros y su tablero.
- `claude/auditoria-8` bifurcó en `337e1a8` y quedó **67 commits atrás**.
  Continuar la ronda 8 hoy produciría un PR cuyo diff **borra** las migraciones
  0037–0043 y ~10 archivos de prueba que sí están en `master`.

La regla de continuación existe para no encimar PRs, no para revivir una ronda
que otra ronda ya reemplazó. Pero el PR #6 **no está vacío**: lleva tres
arreglos con prueba que nunca llegaron a `master`, verificado por ausencia de
archivo en el árbol de hoy:

| Arreglo | Prueba | ¿En `master`? |
|---|---|---|
| Un PDF que Meta rechaza contaba como entregado (AG-1) | `processor_entrega_rechazada.test.ts` | **NO existe** |
| Un XML que no sabe a qué ticket pegarse inventaba un gasto (BE-1) | `processor_xml_ambiguo.test.ts` | **NO existe** |
| La liquidación llevaba DOS nombres de producto en la misma hoja (ARQ-1) | `pdf_un_solo_nombre.test.ts` | **NO existe** |

**Son tres bugs reales, con prueba, perdidos en una rama abierta.** Necesitan una
decisión humana: rebasarlos sobre `master` o cerrar el PR a sabiendas. No es algo
que una corrida desatendida deba resolver sola.

---

## Evidencia

Compuerta sobre el árbol final, corrida sin pipe para leer el exit code real:

```
$ npx tsc --noEmit
tsc exit=0            (sin salida)

$ npm run lint
> eslint .
lint exit=0           (sin salida)

$ npx vitest run
 Test Files  166 passed (166)
      Tests  1583 passed | 1 skipped (1584)
vitest exit=0
```

Línea base al abrir la ronda: **163 archivos / 1570 pruebas**. Las 13 nuevas son
las tres que reproducen los hallazgos cerrados. La única saltada es la de
siempre (`pruebas-manuales/*.prueba.ts`, llamadas reales de pago, no se corren
por regla del proyecto).

`npm run build` **no se corre en la nube**: pide Supabase, OpenRouter, Facturapi
y Upstash, y su fallo no diría nada del código.

`tablero.html` renderizado y **capturado en `tablero.png`, y mirado**: se contaron
los 12 rubros, se verificó que el promedio 88/12 da el 7.3 del encabezado y que
las cifras de la compuerta son las de la corrida real. La primera captura traía
los conteos de severidad mal (decía 25 = 1+2+15+7); se corrigió a 27 = 1+3+14+9 y
se volvió a capturar. Ese error se encontró **porque se miró**.

---

## Nota metodológica: qué NO se verificó

- **Ninguna norma se verificó contra su fuente.** Esta ronda corre sin red hacia
  el DOF, el SAT ni diputados.gob.mx. Todo lo que se afirma sobre el texto de una
  ley sale de la transcripción que la ficha declara — y un hallazgo de esta ronda
  es justamente que esa declaración no es fiable en dos fichas.
- **La lista de medios de pago de FISCAL-2 sale del comentario del propio
  código**, no de una ficha: ninguna transcribe el 4º párrafo de la LIF 20-A-IV.
  Por eso se eligió el lado conservador (contar de menos, nunca de más) y queda
  un hallazgo abierto para transcribirlo.
- **La causa de datos de FE-1 no se tocó.** El XML del seed trae
  `Cantidad="113.00"` y `grep Cantidad src/lib/cuadra/intake/` no devuelve nada:
  el parser nunca la lee. Arreglarlo escribe en Supabase, y aquí no hay base para
  ejercer ese camino. Se arregló lo que sí se podía probar —que el panel no
  afirme una medición que no ocurrió— y la causa de datos queda propuesta.
- **Nueve rubros no se auditaron.** Sus notas son de la ronda 9 y arrastran la
  misma advertencia: fueron estimadas, no re-auditadas con contexto fresco.
  La global de 7.3 hereda esa incertidumbre en 9 de sus 12 términos.
