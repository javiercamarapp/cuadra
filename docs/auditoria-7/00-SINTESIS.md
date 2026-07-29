# Auditoría 7 — síntesis

**Fecha:** 29-jul-2026. **Anterior:** `docs/auditoria-6/00-SINTESIS.md` (5.3).
**Sha base:** `abdc98d`. **Modo:** desatendido, en la nube. Árbol limpio al
arrancar → autofix habilitado. **Rama:** `claude/auditoria-7`.
**Tipo:** **RONDA LIGERA**, 3 rubros por rotación.

---

## Nota global: 5.5 (antes 5.3, ▲0.2)

| Rubro | Aud. 6 | Aud. 7 | | Razón |
|---|:--:|:--:|---|---|
| **Pruebas** | 4 | **5** | ▲ | se atacó y subió |
| **Arquitectura** | 4 | **5** | ▲ | se atacó y subió, con freno |
| Sistema agéntico | 3 | 3 | = | 1 de 3 críticos cerrado; los otros dos siguen |
| Seguridad | 8 | 8 | = | no auditado esta ronda |
| Tool calling | 8 | 8 | = | no auditado esta ronda |
| Rendimiento y costo | 7 | 7 | = | no auditado esta ronda |
| Modelo de datos | 7 | 7 | = | no auditado esta ronda |
| Backend y API | 6 | 6 | = | no auditado esta ronda |
| Cumplimiento fiscal | 5 | 5 | = | no auditado esta ronda |
| Frontend | 4 | 4 | = | no auditado esta ronda |
| Cumplimiento legal | 4 | 4 | = | no auditado esta ronda |
| Operabilidad y DX | 4 | 4 | = | no auditado esta ronda |

Dos rubros se movieron, los dos hacia arriba, y ninguno porque el código de
producción mejorara esta madrugada: subieron porque **esta es la primera ronda
que mide los arreglos de la ronda 6**. Los reportes de la ronda 6 se escribieron
*antes* de que sus propios arreglos aterrizaran, así que sus notas calificaban
un árbol que ya no existía. Es una propiedad conocida del proceso, y la rotación
la va corrigiendo un tercio por ronda.

---

## Por qué esta ronda fue ligera, y no fue decisión de gusto

`HEAD` era **exactamente** el commit que cerró la ronda 6 (`abdc98d`), y
`git log abdc98d..HEAD -- src/ supabase/ normas/` salía vacío. Sin PR de
auditoría abierto y sin commits de código, la regla manda ronda ligera: tres
rubros rotados, y la cobertura se acumula por rotación en vez de por repetición.

**Ningún rubro cumplía el criterio literal** —«los tres de nota más baja que no
se hayan auditado en las últimas 3 rondas»—, porque las rondas 5 y 6 calificaron
los doce. Se cayó a la convención que la ronda 4 dejó escrita para este mismo
empate: **nota más baja**, desempatando con el encargo que la ronda 6 dejó por
escrito para la 7 (la métrica de copias de la verdad, y si los arreglos nacieron
con arnés). De ahí salieron agéntico (3), arquitectura (4) y pruebas (4).

---

## El hallazgo de la ronda: tres pruebas que protegen el dinero no protegen nada

El rubro que nadie mira encontró lo que ningún auditor de código podía ver,
porque no está en el código de producción sino en lo que dice cubrirlo.

**Una prueba corría una copia de la función, no la función.**
`analytics_deriva.test.ts` reimplementaba `derivoLaConfig` dentro del propio
archivo de prueba. La de producción podía romperse entera y las 7 pruebas
seguían verdes — **lo verifiqué cambiando `analytics.ts:391` de `return true` a
`return false`: 7 passed**. Es decir: el arreglo del CRÍTICO de frontend de la
ronda 6 —el detalle del panel contradiciendo al PDF archivado, lo que el
contralor ve— llevaba **una ronda entera sin anclar**. La copia además no era
fiel: le faltaba la guarda `!Array.isArray` de la línea 386.

**La escritura del dinero nunca se había medido en seis rondas.**
`saveLiquidacion` manda 12 parámetros y la prueba miraba 8. Los cuatro sin mirar
eran `p_diferencias`, `p_ieps`, `p_litros_diesel` y `p_pdf_url`: las dos cifras
fiscales que el producto vende. **Sustituyendo `p_litros_diesel` por un `0` fijo,
los 255 litros de diésel se perdían al escribirse y las 10 pruebas seguían
verdes.** El acreditamiento del IEPS del cliente sale de ese número.

**El mock que ignora `.limit()`.** `conv_directo.test.ts:32` mete `limit` en la
lista de métodos que devuelven el mismo enlace y nunca mira su argumento.
Cambiar `conv.ts:73` de `.limit(2)` a `.limit(1)` —que es exactamente el bug de
«devuelve una fila arbitraria y decide el tenant con ella», dinero de una flota
anotado en la de otra— es invisible para la prueba. Sigue **PENDIENTE**.

### El número que contesta la pregunta de la ronda 6

| Qué se mutó | Ronda 5 | Ronda 6 | **Ronda 7** |
|---|--:|--:|--:|
| Sobreviven, en las pruebas escritas por esa ronda | 57% | 83% | **19%** (3 de 16) |
| Sobreviven, en la **escritura** de la liquidación | nunca medido | nunca medido | **6 de 6** |

La ronda 6 preguntó si escribir las pruebas «mirando el cable» cambió el número
o solo el discurso. **Cambió el número**: del 83% al 19%, y mueren todas las de
dinero y las fiscales. Pero la pregunta que nadie había hecho en seis rondas
—¿está probada la *escritura* del dinero, no su cálculo?— tiene la peor
respuesta posible.

---

## Los dos críticos del rubro agéntico que siguen abiertos

Son los dos que más caro salen en la sala del 6 de agosto, y los dos quedaron
fuera por el tope de 3 vueltas.

**`guardiaFundamento` corre SIEMPRE con `permitidas = []`.** El único emisor de
`norma_id` es `cuadrar_viaje` (`tools.ts:88`), y su éxito enciende
`textoDeterminista`, que es justo lo que apaga la guardia en `processor.ts:719`.
Dicho al revés: *el turno en que hay permisos es el turno en que la guardia no
corre; el turno en que corre nunca tiene permisos.* Reproducido ejecutando el
módulo real:

```
ENTRA: Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.
SALE : Te aplica el estímulo del diésel conforme al -A.
       quitadas: ["lif-2026-art-20-A"]
```

Borra una norma **legítima**. El producto es hoy estructuralmente incapaz de
citar una norma a través del modelo, y cuando lo intenta entrega una frase rota.

**El texto y el PDF salen de dos fotografías distintas de la base.**
`guardar_liquidacion` calcula y genera los dos PDF en T1 (`tools.ts:113-143`);
después `guardiaCifras` vuelve a llamar `cuadrarDesdeDB` en T2
(`guardia.ts:71`) para armar el texto. Entre medias, las fotos **no toman el
mutex** (`processor.ts:305-308`, comentario explícito) y `addGasto`
(`repo.ts:141-180`) es un insert que **no mira el estatus del viaje**. Un ticket
de $800 que entre en esa ventana hace que WhatsApp diga *«Pusiste $650 de tu
bolsa»* y el PDF archivado diga *«Sobró $150 a favor de la empresa»*: la misma
respuesta, con $800 de diferencia y de signo contrario.

---

## Lo que se arregló, y cómo se probó que el arreglo sirve

Tres, uno por commit, cada uno con la prueba que lo reproduce verificada **roja
antes y verde después**. Tope de 3 vueltas alcanzado.

| ID | Arreglo | Sha | Cómo se probó |
|---|---|---|---|
| **AG-1** | «Listo, cuadré tu viaje» solo si `guardar_liquidacion` corrió sin error | `2c73e8e` | prueba nueva roja antes del arreglo (salida real pegada en el diario) |
| **PR-3** | `analytics_deriva` importa `derivoLaConfig` de producción | `3fb1e81` | con el mutante puesto: 7 passed antes → 2 failed después |
| **PR-2** | la escritura verifica sus 12 parámetros | `40b886c` | con `p_litros_diesel: 0`: 10 passed antes → 1 failed después |

**AG-1 merece una nota aparte.** El comportamiento malo estaba **fijado por una
prueba**: `guardia.test.ts:48-52` afirmaba `toContain('Listo, cuadré')` con un
solo `cuadrar_viaje`, y su comentario decía *«afirma cierre porque sí cuadró»* —
la confusión entre «se calculó» y «se cerró» escrita como especificación. Por
eso las 1115 pruebas no lo veían. Se corrigió la prueba junto con el código, y
se dice aquí explícitamente porque cambiar una prueba para que pase es
normalmente la señal de que alguien hizo trampa; aquí la prueba era el bug.

---

## Donde defendí, y dónde cedí con la evidencia enfrente

**El auditor de arquitectura calificó 5 y sostuvo que mi MAPA se equivocaba** al
afirmar que `src/` no había cambiado: citó `utils.ts` con `fechaMx`/`litros`,
`pdf.ts` importándolo, y el sondeo de índices por catálogo.

**Defendí primero, y la mitad de mi objeción era correcta.** Verificado:
`git merge-base --is-ancestor 84aa979 abdc98d` → **sí**, y lo mismo para
`8f6e08f`. Esos commits **son** la ronda 6, no posteriores a ella; mi MAPA tenía
razón en que no hay ni un commit después de `abdc98d`.

**Pero su conclusión sí se sostiene, y cedí.** Los reportes de los auditores de
la ronda 6 se escribieron *antes* de que los arreglos de esa misma ronda
aterrizaran, y el 4 salió de ahí. Esta es la primera auditoría que ve el árbol
con esos arreglos dentro, y lo que ve es que **los dos CRÍTICOS del rubro están
cerrados por mecanismo, no por parche**: `CONCEPTO_LABEL` fue **borrado** de
`pdf.ts` —una copia eliminada, no dos copias sincronizadas— y
`etiquetas_sincronizadas.test.ts:43` falla si vuelve a aparecer. Lo comprobé:
`grep -rn CONCEPTO_LABEL src/` solo devuelve el comentario que explica su
ausencia y la prueba que la vigila. El ejemplo canónico del rubro
(`otro: 'Gasto'` contra `otro: 'Otro'`) **ya no existe**. Eso vale un punto.

El freno que impide que valgan dos: la métrica de la frontera no bajó, `mxn()`
resultó estar escrita a mano **ocho** veces y no tres, y los litros de diésel
salen `1,850.5 L` en el PDF y `1850.5 L` en WhatsApp —reincidente por cuarta
ronda, verificado hoy abriendo los tres archivos—.

### Y corrigió una métrica que llevaba tres rondas mal etiquetada

Las rondas 4, 5 y 6 venían citando **43 / 49 / 55** bajo la etiqueta «accesos a
datos fuera de `repo.ts`». Ese era el **total** bajo `src/`, con los de
`repo.ts` incluidos. Reproducido por mí:

```
55  total de .from( / .rpc( en producción bajo src/
38  fuera de repo.ts   ← la cifra que el rubro mide
17  dentro de repo.ts
```

La serie honesta de *fuera* es **33 → 38 → 38**. La conclusión de fondo no
cambia —sigue sin bajar, y nadie tocó la frontera— pero la serie que se venía
citando estaba inflada en 17.

**También rechacé la razón del auditor de pruebas**, que pidió subir por «mirada
más profunda» argumentando que su nota anterior estaba *deflactada*. Esa no es
una de las tres formas —«mirada más profunda» significa que la nota anterior
estaba **inflada**—. El 5 se sostiene igual, pero por *se atacó y subió*: dos de
sus tres críticos se cerraron con commits de esta ronda.

---

## Compuerta sobre el árbol final

```
npm test          1119 pruebas, 1 saltada, 112 archivos   exit 0   (base: 1115)
npx tsc --noEmit                                          exit 0
npm run lint                                              exit 0
npm run build     NO SE CORRE en la nube (pide credenciales que aquí no existen)
```

---

## Incidencias de infraestructura, que no son hallazgos

- **El primer auditor de arquitectura murió sin entregar.** Su transcripción
  dejó de escribirse a las 11:10 y el archivo nunca apareció; los otros dos
  escribieron sin parar en esa misma ventana. Se relanzó con alcance más
  ajustado y entregó a las 11:46. **`INFRA`, no un rubro limpio.**
- El clon venía **sin `node_modules`** (`vitest: not found` en el primer
  intento). Se corrió `npm ci` antes de tomar la línea base.
- Toda la verificación se hizo contra el **blob commiteado**
  (`git show abdc98d:…`) y no contra el árbol de trabajo, porque el auditor de
  pruebas muta archivos a propósito para medir mutantes.

---

## Para la ronda 8

1. **Los tres críticos pendientes son la lista, y en este orden:** `AG-3` (el
   texto y el PDF discrepando en dinero), `AG-2` (la cita rota, que es lo que se
   ve en la sala), `PR-1` (el mock que deja revertir el arreglo multi-tenant en
   verde). Los tres tienen escenario con valores y archivo:línea.
2. **El formateo de litros es una línea y sale en el demo.** `resumen.ts:80`
   interpola litros crudos donde el PDF (`acreditable.ts:95`) y el panel
   (`utils.ts:48`) usan `toLocaleString`. Reincidente por cuarta ronda. El
   auditor lo bajó a MEDIO porque solo diverge por encima de 1,000 L; lo dejo
   anotado aquí igual porque un viaje real de carga federal cruza ese umbral sin
   esfuerzo.
3. **La rotación de la ronda 8, si el código sigue sin cambiar:** frontend,
   cumplimiento legal y operabilidad y DX — los tres en 4/10 y los tres sin
   mirada dedicada desde la ronda 5.
