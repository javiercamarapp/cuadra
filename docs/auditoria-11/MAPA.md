# Mapa del repo — para los auditores (ronda 11, **PASE 2**, 5-ago-2026)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México.
Pre-revenue, sin clientes. Demo **6-ago-2026 (MAÑANA)** con Transportes
Innovativos. El comprador es el **contralor** de la flota. Un error que el
contralor vea en la sala cuesta el trato.

---

## LEE ESTO PRIMERO: auditas la rama del PR #8, con los arreglos ya dentro

Esta es una **ronda de continuación**. El pase 1 (4-ago) corrió sobre `master`
y encontró 63 grupos únicos de hallazgos; **49 se cerraron con prueba sobre
esta misma rama** (`claude/auditoria-11`, PR #8, abierto y sin mergear).

Auditas **`claude/auditoria-11`**, no `master`. Diferencia contra el pase 1:
**277 archivos cambiados, +18,531 / −1,846 líneas** entre `50e3047` (cuando se
escribieron los reportes del pase 1) y el HEAD de hoy. Los reportes del pase 1
describen un árbol que ya no existe: **tu trabajo es medir el de hoy.**

Tu reporte del pase 1 vive en `docs/auditoria-11/<tu-rubro>-pase1.md`. Es tu
mejor insumo, pero está **caducado por construcción**:

1. Toma tus hallazgos del pase 1 y **verifícalos uno por uno contra el código
   de hoy**. Las líneas se movieron mucho.
2. Los que siguen ahí van como **REINCIDENTE**. Es lo que impide que la nota
   suba por prosa.
3. Los que ya no están, dilo con la línea de hoy que lo demuestra. Es lo que
   justifica subir la nota.
4. Pasa el resto del tiempo en lo que **nadie ha mirado**: el código de los 11
   commits de arreglo y los 132 archivos que llegaron del PR #7.

### La trampa documentada del pase 1 — no vuelvas a caer

Cerrando el pase 1 se descubrió que **el merge del PR #7 trajo la prosa, no el
borrado ni el uso**: `login/page.tsx` conservaba copias *inline* de los server
actions y montaba ESAS en los `<form>`, mientras la suite medía las de
`acciones.ts`. **La versión que corre no siempre es la que la suite mide.**

Consecuencia para ti: que exista un archivo con el arreglo **no prueba que el
arreglo esté en el camino que corre**. Sigue la cadena de llamada hasta el
consumidor real antes de dar algo por cerrado. Esto vale doble en `dashboard/`,
`login/` y `lib/auth/`, donde dos refactors independientes se fusionaron.

### Lo que sí quedó intacto y es riesgo vivo

`supabase/migrations/` **no se tocó**: sigue en `0047`. Las dos migraciones de
RLS que el PR #7 traía (`0046_rls_operador_resto.sql`,
`0047_rls_operador_tenant.sql`) **no están aquí** — sus ordinales chocan con
`0046_perfil_avatar.sql` y `0047_operacion_encargado.sql` de `master`. Una base
que ya aplicó las de `master` se saltaría las de RLS en silencio y quedaría
"totalmente migrada" sin ellas. Dato verificado; **no lo re-audites salvo que
seas *modelo de datos*, *seguridad* o *arquitectura***, donde sí cuenta.

---

## Los 11 commits de arreglo de esta rama — lo que hay que ejercer

```
707c749 chore(admin): cero warnings — se retira código muerto del desduplicado
503dde9 fix: cierre de los cinco pendientes cruzados entre dominios [A11-G13/G32/G47/G52]
992045b fix(dashboard): el panel deja de afirmar cifras que nunca midió [A11-D1]
832220f fix(dashboard): punto de control verde del dominio D1
c4358fa fix(operacion): las siete escrituras del encargado dejan de tumbar la pantalla [A11-D5]
e305a08 fix(whatsapp): el «va» de hoy dejaba de adjuntar los comprobantes de ayer [A11-D4]
489ff54 fix(auth): las rutas de export dejan de autenticar sin autorizar [A11-D3]
bc7fc86 fix(admin): el teléfono del operador sale de /admin, y la cobertura desbloquea el CI [A11-D6]
0492635 fix(fiscal): el IVA por WhatsApp deja de afirmar lo que el PDF condiciona [A11-G05/G08]
2e332ae fix: los guardarraíles del PR #7 cazaron cuatro defectos de master
989ca62 fix: se traen a master los arreglos de la ronda 10 que no chocan (132 archivos)
2fb1982 fix(api): el rail no entrega el dinero de la flota a quien no puede verlo [A11-BE-1/SEC-1]
```

Un arreglo hecho de madrugada por seis agentes en paralelo sobre dominios
disjuntos es exactamente donde aparece el defecto de costura: **dos arreglos
correctos que juntos no lo son**. Búscalo ahí.

## Dónde está todo

```
src/app/
  admin/          consola del superadmin (Javier). ~30 páginas. Cruza tenants A PROPÓSITO.
  dashboard/      panel del CLIENTE (flota_admin y equipo). ~20 páginas, filtradas al tenant.
  mis-viajes/     panel de solo lectura del chofer (RLS propia, mig. 0045)
  api/            webhook/whatsapp · export/liquidaciones · export/pdf/[id] · demo · dashboard/asistente
  login/ auth/ cuenta/ sin-acceso/   sesión de Supabase (magic link + Google)
  aviso/ privacidad/                 aviso de privacidad por tenant
src/lib/
  auth/           session · guard · permisos · visibilidad · tenant-efectivo · destino · provisionar
  cuadra/         processor · conv · repo · analytics · operacion (717 líneas) · costos · presupuesto
    cuadre/       engine · guardia · resumen        ← el motor del dinero
    liquidacion/  deducibilidad · pdf
    intake/       cfdi · sat · ocr · sanitizar · hash · fecha
    facturacion/  laboral/  periodo/  normas/
  llm/            openrouter · models · tool-executor
  agents/         run · registry · prompts
  admin/negocio.ts
  observability/  logger.ts  ratelimit.ts  env.ts
supabase/migrations/   0001 … 0047   (INTACTO desde el pase 1)
normas/           21 fichas YAML — FUENTE DE VERDAD FISCAL Y LEGAL
docs/auditoria-11/*-pase1.md   tu reporte del pase 1
docs/auditoria-11/arreglos-D*.md  qué hizo cada agente de arreglo, y qué dejó abierto
docs/auditoria-11/RESULTADO.md    el cierre del pase 1: los 14 que quedaron abiertos
```

490 archivos `.ts`/`.tsx` en `src/`, de los cuales **269 son de prueba**.

## Reglas del producto que un hallazgo puede violar

- **Nunca inventar una cifra.** Si no hay dato real se dice qué falta y por qué.
  Una estimación se puede mostrar, pero declarada (ver `MINUTOS_CAPTURA_MANUAL`).
- **Un rótulo tiene que ser verdad.** "Del periodo" ⇒ la consulta filtra por
  fecha. Un filtro en pantalla mueve TODO lo que hay debajo.
- **El formato de cifras vive solo en `lib/formato.ts`.** Hay prueba que falla
  si aparece `toLocaleString('es-MX')` en otro archivo.
- **Fallar cerrado y decirlo.** supabase-js reporta errores POR VALOR: sin
  comprobar `error`, una base caída se lee como "no hay nada". Ver `exigir()` y
  `traerTodo()` en `analytics.ts` (PostgREST recorta a 1,000 filas en silencio).

## Trampas ya pisadas — no las reportes como nuevas

- `gasto.ocr_raw` está MUERTA; la prueba de OCR es `ocr_confianza`.
- La tabla `politica_gasto` está muerta. La política viva es
  `tenant.config.politica`, vía `getConfig()`.
- `wa_mensaje_procesado` NO tiene `tenant_id`.
- `viaje.estatus` solo admite `abierto | en_cuadre | liquidado`.
  `app_user.rol`: superadmin, flota_admin, contador, operador, encargado.
- `cliente`, `unidad`, `tarifa`, `factura_emitida`, `pago_recibido`, `posicion`
  y `geocerca` **SÍ existen** (migs. 0047-0050 del linaje) pero están **vacías**:
  nadie las escribe todavía. Antes de usar cualquiera, mira si tiene filas.
- `requireSessionTenant(destino)` pierde el query string — por eso existe
  `dashboard/sufijo.ts`.
- El push a `master` **ya no despliega solo**: `vercel.json` construye solo si
  el **asunto** del commit lleva la bandera de deploy.

## Qué NO tocar / qué NO correr

- **NO edites ningún archivo del repo.** Escribes UN archivo:
  `docs/auditoria-11/<tu-rubro>.md`. Nada más. Doce agentes escribiendo sobre el
  mismo repo se pisan.
- **NO mutes código para medir.** En el pase 1 el auditor de pruebas dejó
  mutantes vivos mientras los otros once leían, y produjo **un hallazgo falso**.
  Si tu método exige mutar, hazlo sobre una **copia fuera del repo** o razona
  sobre la cobertura sin tocar el árbol.
- **NO corras `pruebas-manuales/*.prueba.ts`** — hacen llamadas reales de pago.
- **NO corras `npm run build`** — pide Supabase, OpenRouter, Facturapi y
  Upstash, que aquí no existen; su fallo no dice nada del código.
- Sí puedes: leer, buscar, y correr `npx vitest run`, `npx tsc --noEmit`,
  `npm run lint` en modo lectura.

## Línea base de la compuerta, medida hoy sobre esta rama

```
$ npx vitest run    → exit 0 · 269 archivos · 2530 pruebas · 1 saltada
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0 · CERO warnings
$ git status        → limpio
```

Contra el pase 1 (172 archivos / 1670 pruebas): **+97 archivos, +860 pruebas.**
Que la suite sea más grande no dice que cubra lo correcto — eso es del rubro de
pruebas medirlo.

## De dónde vienes — notas del pase 1 (global 3.9)

| Rubro | Nota pase 1 | Razón que la dejó ahí |
|---|:--:|---|
| Sistema agéntico | 3 | mirada más profunda — 5 de 8 puntos de muerte no cierran el ciclo con el humano |
| Cumplimiento fiscal | 3 | deuda — dos CRÍTICOS del 3-ago vivos línea por línea |
| Cumplimiento legal | 3 | deuda — bucket `avatares` público, fuera del catálogo del aviso |
| Rendimiento y costo | 3 | deuda — 233,000 ms de techo contra `maxDuration = 120,000` |
| Pruebas | 3 | deuda — 22 mutaciones sobre código nuevo, sobrevivieron las 22 |
| Backend y API | 4 | deuda — la ruta de API reabrió en JSON lo que `visibilidad.ts` cerró en la página |
| Operabilidad y DX | 4 | deuda — CI rojo desde el 3-ago, 16 `catch` vacíos |
| Modelo de datos | 4 | deuda — `viaje.operador_id` es NOT NULL y el encargado lo asume nullable |
| Frontend | 5 | deuda — tres tarjetas fiscales imprimiendo `0` como medición |
| Tool calling | 5 | mirada más profunda — 11 de 17 hallazgos reincidentes |
| Seguridad | 5 | se atacó y subió en un frente, la deuda cobró factura en el otro |
| Arquitectura | 5 | deuda — `permisos.ts` dice gobernar la API y no gobierna un endpoint |

Esas notas se pusieron **antes** de los 49 cierres. Si tu rubro está mejor hoy,
dilo y súbelo con la línea que lo prueba. Si sigue igual, la nota no se mueve
por buena voluntad.
