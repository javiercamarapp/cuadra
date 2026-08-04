# Mapa del repo — para los auditores (ronda 11, 4-ago-2026)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México.
Pre-revenue, sin clientes. Demo **6-ago-2026 (en 2 días)** con Transportes
Innovativos. El comprador es el **contralor** de la flota. Un error que el
contralor vea en la sala cuesta el trato.

---

## LEE ESTO PRIMERO: AUDITAS `master`, Y `master` NO TIENE LOS ARREGLOS

Esta es la circunstancia que define la ronda, y si no la entiendes vas a
reportar como "ya arreglado" cosas que están abiertas.

La **auditoría 10** (3-ago) corrió sobre la rama `claude/auditoria-10`, cerró
**96 de 105 hallazgos con prueba** en 99 commits, y quedó en el **PR #7,
abierto y sin mergear**. Mientras tanto `master` avanzó **40 commits por su
cuenta**. Las dos ramas divergieron:

```
$ git log --oneline origin/master..claude/auditoria-10 | wc -l
372          # los arreglos de la auditoría 10 — NINGUNO está en master
$ git log --oneline claude/auditoria-10..origin/master | wc -l
40           # trabajo nuevo de producto — NINGUNO fue auditado nunca
```

**Estás auditando `master`**, que es lo que Vercel despliega a producción y lo
que se va a demostrar el 6-ago. Verificado a mano sobre este árbol:

- `src/lib/auth/destino.ts` — **no existe** (lo creó la auditoría 10).
- `src/app/login/acciones.ts` — **no existe** (idem).
- `src/lib/auth/session.ts:33` — el `select` trae `operador_id, avatar_url` de
  un solo golpe y **no tiene** el reintento `esColumnaAusente` que la auditoría
  10 metió para su CRÍTICO de modelo de datos.

**Consecuencia práctica para ti:** casi todo lo que `docs/auditoria-10/<tu
rubro>.md` reporta sigue **abierto en este árbol**. Ese archivo es tu mejor
insumo: son 105 hallazgos ya verificados contra el código, con `archivo:línea`.
Tu trabajo con ellos es **verificar cuáles siguen presentes aquí** (las líneas
se movieron: `master` reestructuró `/dashboard`) y reportarlos **REINCIDENTE**.
No los des por cerrados porque el PR #7 diga que los cerró: el PR no está
mergeado.

No repitas el texto de la auditoría 10 palabra por palabra. Confirma presencia
con `archivo:línea` de HOY y pasa a lo que nadie ha mirado.

### El PR #7 no se puede mergear tal cual (dato verificado, no lo re-audites)

```
$ git merge origin/master        # sobre claude/auditoria-10
CONFLICT … 14 archivos, 28 hunks
```

Y las dos ramas usan **los mismos ordinales de migración para cosas distintas**:

| Ordinal | `master` | rama del PR #7 |
|---|---|---|
| 0046 | `0046_perfil_avatar.sql` | `0046_rls_operador_resto.sql` |
| 0047 | `0047_operacion_encargado.sql` | `0047_rls_operador_tenant.sql` |

La rama llega hasta `0053`. Esto ya está reportado al dueño y **no es materia
de tu rubro** — salvo que seas *modelo de datos* o *arquitectura*, donde sí
cuenta como riesgo de esquema que hay que dimensionar.

---

## LO QUE NADIE HA AUDITADO NUNCA: los 40 commits de `master`

Aquí está el grueso del riesgo nuevo de esta ronda. Son ~9,700 líneas.

### Bloque A — el panel del encargado y la operación (lo más grande)

- `src/lib/cuadra/operacion.ts` (**567 líneas nuevas**) — lecturas y escrituras
  del encargado: carga por chofer, unidades, incidencias, POD.
  `src/lib/cuadra/operacion.test.ts` (329 líneas) es su única red.
- `supabase/migrations/0047_operacion_encargado.sql` (191 líneas) — tablas
  `unidad`, `mantenimiento`, `incidencia`, `pod`. **Escrita sin base contra la
  cual ejercerla** (aquí no hay Supabase).
- `supabase/migrations/0046_perfil_avatar.sql` — avatar de perfil, y
  `src/app/admin/mi-perfil/avatar-uploader.tsx` (subida de archivo del usuario).
- Páginas nuevas del panel: `dashboard/despacho`, `dashboard/incidencias`,
  `dashboard/pod`, `dashboard/unidades`.

### Bloque B — visibilidad por rol, reescrita

- `src/lib/auth/visibilidad.ts` (139 líneas) + `visibilidad.test.ts` (120) — el
  `encargado` deja de ver las finanzas de la flota.
- `src/lib/auth/tenant-efectivo.ts` (76 líneas) — el superadmin entra al panel
  de una flota ("Ver dashboard"). **Suplantación de tenant: quién puede, cómo
  se acota, y qué queda en el log.**
- `src/lib/admin/negocio.ts` tocado — la única función con permiso de cruzar
  tenants.
- `src/lib/cuadra/pg.ts` (52 líneas nuevas).

### Bloque C — `/dashboard` reestructurado: 20 páginas, design system v2

- `src/app/dashboard/page.tsx` reescrita (537 líneas de diff), más
  `rail.tsx`, `sidebar-nav.tsx`, `rutas.ts`, `sufijo.ts`, `estatus.ts`,
  `pendiente.tsx`, `avance-cierre.tsx`, `cifra-grande.tsx`, `chrome.tsx`.
- Páginas nuevas: `politicas`, `rentabilidad`, `soporte`, `usuarios`,
  `valor-ahorro`, `viajes`, `pod`, `unidades`.
- `src/lib/cuadra/analytics.ts` — **386 líneas de diff** sobre el archivo que
  alimenta las cifras del panel. Es el archivo del `exigir()` / `traerTodo()`.
- Marca y marco: `src/app/logo.tsx`, `fondo.tsx`, `marco.ts`,
  `src/app/globals.css` (paleta a blanco + naranja, se retiró el shader WebGL),
  `not-found.tsx`, `src/lib/saludo.ts`.
- `src/app/admin/` — CommandPalette (⌘K), sidebar colapsable, GlobalFilter,
  `loading.tsx`, `calcular-alertas.ts`, `notificaciones-leidas.ts`,
  `mi-perfil/`, asistente fijo en todas las páginas.

**Advertencia honesta (sigue vigente de la ronda 10):** buena parte de `/admin`
y algunas páginas nuevas de `/dashboard` son UI construida muy rápido. Antes de
reportar que una página "no tiene datos reales", verifica si está **declarada**
como pendiente (`dashboard/pendiente.tsx`, `EstadoVacio`) o si **presume datos
que no tiene**. La segunda es hallazgo; la primera, a lo sumo, deuda. La regla
del producto es "nunca inventar una cifra" — un cero que parezca medición, o un
rótulo "del periodo" cuya consulta no filtra por fecha, sí es hallazgo.

---

## Dónde está todo

```
src/app/
  admin/          consola del superadmin (Javier). ~30 páginas. Cruza tenants A PROPÓSITO.
  dashboard/      panel del CLIENTE (flota_admin y equipo). 20 páginas, filtradas al tenant.
  mis-viajes/     panel de solo lectura del chofer (RLS propia, mig. 0045)
  api/            webhook/whatsapp · export/liquidaciones · export/pdf/[id] · demo · dashboard/asistente
  login/ auth/ cuenta/ sin-acceso/ acceso/   sesión de Supabase (magic link + Google)
  aviso/ privacidad/                          aviso de privacidad por tenant
src/lib/
  auth/           session · guard · permisos · visibilidad · tenant-efectivo · provisionar · passcode
  cuadra/         processor · conv · repo · analytics · operacion · costos · presupuesto · duplicados
    cuadre/       engine · guardia · resumen        ← el motor del dinero
    liquidacion/  deducibilidad · pdf
    intake/       cfdi · sat · ocr · sanitizar · hash · fecha
    facturacion/  laboral/  periodo/
  llm/            openrouter · models · tool-executor
  agents/         run · registry · prompts
  admin/negocio.ts
  observability/  logger.ts  ratelimit.ts  env.ts  formato.ts
src/proxy.ts      el gate de /dashboard
supabase/migrations/   0001 … 0047
supabase/verificaciones.sql
normas/           21 fichas YAML — FUENTE DE VERDAD FISCAL Y LEGAL
docs/auditoria-10/     la ronda anterior, completa, con sus 105 hallazgos
```

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
- No existen: tabla de clientes, de vehículos, de facturas emitidas, GPS, ni
  kilómetros por viaje. Por eso no hay margen, OTIF, km/l ni Carta Porte.
- `requireSessionTenant(destino)` pierde el query string — por eso existe
  `dashboard/sufijo.ts`.

## Qué NO tocar / qué NO correr

- **NO edites ningún archivo del repo.** Escribes UN archivo:
  `docs/auditoria-11/<tu-rubro>.md`. Nada más. Doce agentes escribiendo sobre
  el mismo repo se pisan.
- **NO corras `pruebas-manuales/*.prueba.ts`** — hacen llamadas reales de pago.
- **NO corras `npm run build`** — pide Supabase, OpenRouter, Facturapi y
  Upstash, que aquí no existen; su fallo no dice nada del código.
- Sí puedes: leer, buscar, y correr `npm test`, `npx tsc --noEmit`,
  `npm run lint` en modo lectura.

## Línea base de la compuerta, medida hoy sobre este árbol

```
$ npx vitest run    → exit 0 · 172 archivos · 1670 pruebas · 1 saltada
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0 · 6 warnings (imports sin usar en admin/page.tsx)
```

Para calibrar: el árbol del PR #7 tiene **239 archivos / 2089 pruebas**. Las
**+460 pruebas** que la auditoría 10 escribió para anclar sus arreglos tampoco
están aquí.

## De dónde vienes — notas vigentes (auditoría 10, global 4.9)

| Rubro | Nota | Razón que la dejó ahí |
|---|:--:|---|
| Sistema agéntico | 3 | mirada más profunda — la sala de espera de comprobantes sin auditar |
| Rendimiento y costo | 4 | mirada más profunda — 233,000 ms contra `maxDuration = 120,000` |
| Cumplimiento legal | 4 | deuda que cobró factura — 5,743 líneas con datos personales, `privacidad.ts` intacto |
| Pruebas | 5 | deuda que cobró factura — 5 de 7 mutaciones sobrevivieron |
| Backend y API | 5 | deuda — quién ve el dinero se decidió en la capa que pinta botones |
| Seguridad | 5 | deuda — el aislamiento entre ROLES dentro de una flota se rompió |
| Modelo de datos | 5 | deuda — la RLS de la 0045 no gobierna los caminos con service-role |
| Operabilidad y DX | 5 | deuda — el login nuevo falla sin dejar una línea |
| Cumplimiento fiscal | 5 | mirada más profunda |
| Tool calling | 6 | deuda — `/admin` pinta atribución modelo↔tokens como hecho en 7 pantallas |
| Arquitectura | 6 | deuda — la tabla de permisos decía gobernar la API y ningún endpoint la consultaba |
| Frontend | 6 | se atacó y subió |

Esas notas se pusieron sobre el árbol del PR #7 **con los arreglos dentro**.
Este árbol no los tiene. Si tu rubro está peor aquí que allá, dilo y bájalo.
