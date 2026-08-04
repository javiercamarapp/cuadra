# Arreglos D6 — costo de IA, gateway, consola `/admin` y CI

Rama `claude/auditoria-11`. Árbol con `989ca62` + `2fb1982` + `2e332ae` dentro.
Cada grupo se verificó **abriendo el archivo**, no leyendo el plan.

| Grupo | Estado |
|---|---|
| G-33 | **CERRADO** (pruebas: `src/app/admin/mi-perfil/acciones.test.ts`, `src/app/admin/frontera_datos.test.ts`, `src/app/admin/roles_y_mensajes.test.ts`) |
| G-35 | **CERRADO** — cobertura 69.64% → 80.25% de líneas, `npm run test:coverage` sale 0. Umbral **intacto**. Y el CI se reordenó para que Build siempre corra. |
| G-39 | **YA CERRADO** por `989ca62` (PR #7: `6beb677`, `917f8e8`, `bf89b70`, `e5cf48a`) |
| G-40 | **CERRADO** (prueba: `src/lib/admin/negocio_paginacion.test.ts`) |
| G-42 | **CERRADO lo arreglable** (prueba: `src/lib/llm/openrouter_vigencia_precio.test.ts`) · **PENDIENTE**: `cache_control` |
| G-43 | **YA CERRADO** por `989ca62` (PR #7: `c8caec2`, `cae6ee7`, `4a5d9a6`) |
| G-45 | **YA CERRADO** por `989ca62` |
| G-46 | **YA CERRADO** por `2e332ae` (`admin/fases.ts` es la fuente única) |
| G-49 | **CERRADO en parte** (prueba: `src/app/admin/frontera_datos.test.ts`) · **PENDIENTE**: `getResumenCosto` sin consumidores |
| G-53 | **NO estaba cerrado — CERRADO aquí** (prueba: `src/lib/admin/negocio_seudonimo.test.ts`) |

**Cierra: 6 · Ya estaban: 4 · Pendientes anotados: 3** (dos de ellos, parte de un
grupo que sí cerró).

---

## G-40 · ALTO — CERRADO
`src/lib/admin/negocio.ts` · prueba: `src/lib/admin/negocio_paginacion.test.ts`

Las cinco consultas leían sin `.range()`, sin `.order()` y sin techo. PostgREST
recorta a 1,000 filas **en silencio**; a ~19 filas de `llm_costo` por
liquidación, la tabla cruza el corte por la liquidación #46 — y esta función
corre en el **layout**, o sea en las ~30 páginas de `/admin`.

- Las cinco pasan por `traerTodo`/`exigir` (`lib/cuadra/pg.ts`), que es el
  patrón que el repo ya declara para este borde exacto.
- `.order()` explícito en las cuatro: sin él «la página 2» no significa nada, y
  para una tabla append-only el primer bloque del plan son las filas **más
  viejas** (`porDia` sin días recientes → `tendencia()` = `null` → la flecha
  desaparece en vez de gritar).
- `round2` → `redondearUsd` (`costos.ts`, seis decimales) en todo lo que sea
  dólares de costo de modelo. `round2` es la regla del **peso** de un CFDI;
  aplicada a $0.0027 imprimía `$0.00 · 1 llamadas` en Model Ops, que es la
  pantalla que existe para comparar Gemini contra Haiku. `round2` se queda solo
  para el **porcentaje** de la tendencia.
- `porFase` pasa por `agregarPorFase` (`costos.ts`): eran dos agregadores de la
  misma tabla con distinto redondeo y distinto contrato de error.

La prueba falla sin el arreglo (7 de 8 casos en rojo, verificado).

## G-33 · ALTO — CERRADO
`src/app/admin/mi-perfil/` · pruebas: `acciones.test.ts` (15), `frontera_datos.test.ts` (4), `roles_y_mensajes.test.ts` (10)

Los dos server actions vivían **inline** en `page.tsx`: no se podían importar,
no se podían ejercer, y `page.tsx` además está excluido de la medición de
cobertura. Se extrajeron a `acciones.ts`, y con ellos:

- **El `error` ya no se descarta.** Las tres escrituras (`nombre`, subida al
  bucket, `avatar_url`) fallan con excepción, dejan una línea en el log y
  redirigen a `?error=…`. El caso real —la 0046 sin aplicar— era: el objeto
  sube, la columna no existe, y la pantalla decía «Foto de perfil actualizada.»
  mientras la siguiente carga volvía al círculo con la inicial. El síntoma que
  se reporta de eso es «se borra sola», y no había log.
- **La subida valida tipo y tamaño** (`avatar-validacion.ts`): lista blanca de
  `image/jpeg|png|webp`, techo de 4 MB. `image/svg+xml` queda FUERA a
  propósito: el bucket `avatares` es público y un SVG servido desde ahí ejecuta
  su `<script>` en el origen del bucket. `accept="image/*"` es del navegador y
  no viaja en el POST.
- **El `contentType` sale de nuestra tabla**, no de `archivo.type`. Antes el
  cliente decidía con qué cabecera se sirve un objeto público.
- **Ruta fija sin extensión** (`${userId}/avatar`). Antes salía de
  `archivo.name.split('.').pop()`, así que un `.png` no pisaba el `.jpg`
  anterior: quedaba un objeto público huérfano por formato probado.
- **Frontera restaurada**: los tres `supabaseAdmin()` propios salieron a
  `@/lib/admin/negocio`. Es la regla que la ronda 10 verificó intacta y que
  este archivo rompió.
- `ROL_LABEL` era la segunda copia del mapa y había perdido el tipo por el
  camino (`Record<string,string>`). Ahora vive en `admin/roles.ts` tipado
  `Record<RolAppUser,string>` — mismo criterio que `admin/fases.ts` — y
  `admin/equipo/page.tsx` usa esa.
- Los mensajes de error dejaron de ser dos para cinco resultados distintos
  (`mensajes.ts`): un archivo de 9 MB, un `.svg` y un bucket caído se leían
  igual, y el consejo «intenta con otra imagen» era el equivocado en dos de los
  tres casos.

## G-53 · CRÍTICO — **NO estaba cerrado** · CERRADO
`src/lib/admin/negocio.ts` + 4 páginas · prueba: `src/lib/admin/negocio_seudonimo.test.ts` (14)

**El plan lo marcaba «YA ARREGLADO EN EL PR #7». No lo estaba en este árbol**:
`negocio.ts` es uno de los archivos que `master` también tocó, así que `5b43fd8`
no se pudo traer. `getConversacionesActivas` seguía devolviendo `telefono` y los
`turns` íntegros, sin un solo `.eq('tenant_id', …)`, y `admin/layout.tsx:42` la
llama en **cada carga de cualquier página** de `/admin`. En
`conversaciones/page.tsx:47` la etiqueta de cada barra de un `HBars` **era el
teléfono del operador**.

Contra `privacidad.ts:511-512`, que es el texto que el operador acepta:
*«estadísticas de uso, sin identificarte en los reportes»*. Abrir `/admin` y
`/aviso/[tenant]` en la misma sesión del demo las desmentía a un clic.

- `seudonimoOperador()` — etiqueta estable y legible («Operador 4F2A»), derivada
  del teléfono normalizado. La conversión pasa **en el borde**: el número no
  sale del módulo ni una vez.
- `redactarTexto()` — tapa correo, RFC, CURP y teléfonos dentro del texto de
  cada turno. Lo del negocio (montos, conceptos, plazas) pasa intacto.
- Las 4 páginas (`page.tsx`, `conversaciones`, `agente-whatsapp`,
  `whatsapp-infra`) pintan el seudónimo, y un grep-test impide que `.telefono`
  vuelva a aparecer en `src/app/admin`.
- **Lo que esto NO es, y está escrito en el código:** no es anonimización
  irreversible. La sal es una constante del repo y el espacio de teléfonos
  mexicanos es chico. Sirve para que la consola no EXHIBA el número —que es el
  hallazgo— y para agrupar. El dato real sigue en `wa_conversacion`, que es
  donde el procedimiento ARCO lo alcanza.

## G-42 · MEDIO + ALTO — CERRADO lo arreglable
`src/lib/llm/openrouter.ts`, `src/lib/llm/models.ts` · prueba: `openrouter_vigencia_precio.test.ts` (8)

La vigencia de la tarifa introductoria de Sonnet 5 estaba **en un comentario al
final de un renglón**. `PRICES` es la única fuente de costo del producto: el
1-sep, cuando Anthropic revierta a $3/$15, todas las filas de `llm_costo` del
modelo de cuadre se registrarían con un 50% de subestimación sin una línea de
aviso — mientras `llm.modelo_sin_precio` sí grita por lo desconocido.

- `VIGENCIAS` es ahora un **dato**: hasta cuándo vale y a cuánto vuelve.
- `openrouter_vigencia_precio.test.ts` **falla sola a partir del 1-sep-2026** si
  `PRICES` no se actualizó, con el importe correcto en el mensaje.
- `avisarPreciosCaducados()` emite un `logger.error('llm.precio_caducado')` en
  la corrida que está registrando la cifra mal (una vez por proceso, no por
  llamada). Una prueba solo protege a quien corre la suite.
- **El precio NO se cambia solo**: eso sería inventar una cifra. La tarifa
  revertida hay que confirmarla contra el proveedor; el trabajo de la tabla es
  hacer imposible que se olvide.
- `models.ts` afirmaba «Costo ≈ $0.03–0.05 / liquidación» sin fuente, y la
  aritmética con las constantes del propio repo lo contradice: 8 fotos ×
  ~$0.015 = **$0.12** solo de OCR. El comentario ahora separa **objetivo
  declarado** de **cota calculada** de **medición pendiente**, y dice dónde está
  el dato (`llm_costo.costo_usd` con `viaje_id`/`liquidacion_id`).

**PENDIENTE — `cache_control` sobre el prefijo invariante de ~1,200 tokens.**
No se hizo: toca el camino de petición al gateway (campos específicos del
proveedor a través del SDK de OpenAI) a 2 días del demo, y una regresión ahí no
falla ruidosamente — devuelve respuestas peores o más caras. Es ahorro, no
corrección.

**DECISIÓN HUMANA que queda abierta:** cuál es el costo real por liquidación.
El dato ya se está guardando y `/admin/model-ops` lo enseña por fase y modelo;
nadie ha hecho la división.

## G-49 · MEDIO + BAJO ×2 — CERRADO en parte
prueba: `src/app/admin/frontera_datos.test.ts`

- **Acceso directo a la base fuera de `repo.ts`:** el guardarraíl se escribió
  **acotado a `/admin`**, que es la frontera concreta que el hallazgo dice que
  se rompió («`/admin` importaba solo de `@/lib/admin/negocio`»). Ninguna página
  ni componente de `src/app/admin/**` puede importar el cliente de servicio,
  nombrar una tabla, ni tocar `storage`. Verificado que **habría fallado** con
  el `mi-perfil/page.tsx` anterior (9 coincidencias). `/admin` está hoy en cero.
  *Un contador global de los 129 sitios se descartó a propósito: cinco agentes
  editan `src/app/` en paralelo y un techo global habría fallado por trabajo
  ajeno, que es ruido, no señal.*
- **El guardarraíl de `round2`:** ya estaba cerrado — `src/lib/formato.test.ts`
  vigila la **expresión** `Math.round(x * 100) / 100`, no el nombre. Entró con
  `989ca62`. No se tocó.
- **PENDIENTE — `getResumenCosto()` (`costos.ts:305`) sigue sin consumidores.**
  `agregarPorFase()` ya tiene uno (`negocio.ts`, arreglo de G-40), pero la
  función de tres estados no. Borrarla o cablearla es una decisión de producto
  («cuándo ve la flota su costo»), no un arreglo de madrugada, y borrarla a 2
  días del demo puede chocar con otro agente. `topeDescuento()` y
  `puedeAdministrar()` viven **fuera de D6** — anotados, no tocados.

## G-35 · CRÍTICO — CERRADO
`vitest.config.ts` (**sin tocar**) · `.github/workflows/ci.yml` · 5 archivos de prueba nuevos

### El umbral NO se bajó. La cobertura subió.

```
línea base D6 (antes de tocar nada, este árbol):
  Statements 69.64% (7564/10861) · Functions 78.52% (395/503) · exit 1
solo con las pruebas de D6 dentro:
  Statements 80.25% (8960/11165) · Functions 83.63% (465/556) · exit 0
medición final (con lo que los demás agentes también aterrizaron):
  Statements 83.05% (9291/11187) · Functions 84.21% (475/564) · exit 0
```

El salto que le toca a D6 es el primero: **+10.61 puntos de líneas**, y es el
que cruza el umbral por sí solo (80.25 > 78 y 83.63 > 83, medido con la suite
de los demás agentes tal como estaba entonces).

Umbrales de `vitest.config.ts`: `lines 78 · statements 78 · branches 84 ·
functions 83`. **Byte-idénticos a como estaban.** `npm run test:coverage` ahora
sale 0.

Dónde se subió, y por qué ahí: las dos librerías que pintan **todo el dinero de
la consola** no se ejecutaban nunca.

| Archivo | antes | después |
|---|--:|--:|
| `src/app/admin/ui/graficas.tsx` (503 líneas) | 12.53% | **100%** |
| `src/app/admin/charts.tsx` (262) | 5.45% | **100%** |
| `src/app/admin/notificaciones-leidas.ts` | 19.14% | **100%** |
| `src/app/admin/sidebar-nav.tsx` · `perfil.tsx` · `rango-costo.tsx` · `notificaciones.tsx` · `rutas.ts` · `calcular-alertas.ts` | 0-10% | **100%** |
| dominio D6 completo | ~35% | **86.70%** |

**Y encontró un bug real, que es la prueba de que no es cobertura de adorno:**
`AreaChartSimple` **lanzaba** con `datos = []` (`xy[xy.length-1][0]` sobre un
arreglo vacío). Cinco páginas de `/admin` le pasan `r.porDia` directo, que viene
vacío en cuanto `llm_costo` no tiene filas — el estado de una flota nueva. Sin
error boundary en `/admin`, eso es la página en blanco. Arreglado: pinta el
marco con «Sin datos en el periodo» en vez de reventar o quedarse mudo.

Segundo hallazgo de la misma tanda: cuatro sitios emitían coordenadas SVG sin
redondear (`57.142857142857146`) en `cx/cy/points`, que es exactamente el
mismatch de hidratación que `graficas.tsx:38-41` documenta para `punto()` — los
`d=` iban con `toFixed(1)` y los atributos de al lado, no.

### Lo arreglable del CI, hecho
`.github/workflows/ci.yml`: el trinquete de cobertura salió del paso de las
pruebas y se movió **al final**, después de Build. Antes eran un solo paso, así
que «una prueba se rompió» y «entró código sin prueba» producían el mismo rojo
y GitHub saltaba los dos pasos siguientes. Por eso **Build no corrió una sola
vez sobre el código del demo** desde el 3-ago — el paso cuyo propio comentario
dice que ya cazó un fallo real que solo aparece ahí (Turbopack y el `.wasm` del
lector de códigos de barras, que es el que lee los tickets del demo).

Ahora: Tests → Pruebas de tiempo → Build → Trinquete. El trinquete sigue
poniendo el CI en rojo; lo que ya no puede es esconder a Build detrás de él.
Cuesta correr la suite dos veces (~1 min de runner). `pruebas_en_ci.test.ts`
—que lee este YAML— sigue en verde.

---

## Verificación

```
npx vitest run  (dominio D6: src/app/admin, src/lib/admin, src/lib/llm)
  → 29 archivos · 269 pruebas · 0 fallos
npm run test:coverage
  → 258 archivos · 2,421 pruebas · 3 saltadas · exit 0 (suite VERDE)
npx tsc --noEmit -p .
  → limpio en todo D6
npx eslint src/app/admin src/lib/admin src/lib/llm src/lib/agents
  → 0 errores · 4 warnings preexistentes (imports sin usar en
    `model-ops/page.tsx` y `admin/page.tsx`, ya reportados en el MAPA)
```

## Fuera de D6 — anotado, no tocado

- `topeDescuento()` (`laboral/pagadero.ts:122`) formatea dinero con
  `toFixed(2)`: sin `$`, sin miles, fuera de `formato.ts`. El guardarraíl solo
  greppea `toLocaleString('es-MX'`, así que no lo ve. **Es de D2/D4.**
- `puedeAdministrar()` (`auth/permisos.ts:29`) sin consumidores. **D3.**
- `src/lib/cuadra/processor.ts:1200` (`modelo: 'parcial'`) e
  `intake/ocr.ts:281` (`'ocr'`) — la mitad de G-39 que vive fuera de
  `src/lib/llm/`. Vinieron ya arregladas en `989ca62`; confirmado que
  `/admin` no pinta esas dos como proveedores.
