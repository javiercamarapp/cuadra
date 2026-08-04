# Likida — continuar el trabajo, en fases

Repo: `~/javiercamarapp/cuadra`, rama `master`, GitHub `javiercamarapp/likida.ai`.
**Lee `CLAUDE.md` antes de tocar nada.** Está escrito para esto y es corto.

Likida liquida viajes de flotas de carga en México por WhatsApp: el operador
manda fotos de tickets, un motor determinístico las cuadra contra el anticipo y
entrega un PDF con fundamento fiscal. **Demo el 6 de agosto de 2026** con
Transportes Innovativos. El guion está en `GUION_DEMO.md`.

El diseño ya está resuelto: paleta blanco + naranja, fondo listo, logo de dos
tonos, marco unificado. **No toques el fondo ni la paleta.** No hay nada de
video pendiente.

---

## Reglas del repo que no se rompen

1. **Nunca inventar una cifra.** Si no hay dato real, se dice qué falta y por
   qué (`dashboard/pendiente.tsx`, `EstadoVacio`). Un 0 de encuadre se lee como
   un 0 de la flota. Sin dato va un guion, no un cero.
2. **Verificar mirando.** Que compile y pasen las pruebas no es que se vea
   bien. Levanta `npm run dev`, captura con Chrome headless y MIRA la imagen
   antes de dar algo por bueno.
3. **Fallar cerrado.** supabase-js devuelve errores POR VALOR: sin comprobar
   `error`, una base caída se lee como "no hay nada". Usa `exigir()` y
   `traerTodo()` de `lib/cuadra/pg.ts`.
4. **El formato de cifras vive sólo en `lib/formato.ts`.** Hay una prueba que
   falla si aparece `toLocaleString('es-MX')` en otro archivo.
5. **Una prueba escrita después del arreglo no vale** hasta que la rompes a
   propósito y la ves fallar.
6. **Aplica las migraciones tú**, sin preguntar, salvo las que destruyan datos.
   Se aplican con el MCP de Supabase (proyecto `gngoqsvrxdguxvsizpbw`, "Likida").
7. **Toda migración nueva necesita** un bloque en `supabase/verificaciones.sql`
   o una exención con razón en `migraciones_verificadas.test.ts`. Hay una
   prueba que lo obliga.
8. Antes de terminar: `npx tsc --noEmit -p .`, `npx eslint src/`,
   `npx vitest run` (van 1,670 verdes) y `npm run build`, los cuatro limpios.

**Sobre commits y deploys:** Javier quiere commits seguidos, pero **cada push a
`master` dispara un build de producción en Vercel (~50 s)**. El 3 de agosto se
fueron 31. Commitea seguido en local y **agrupa los pushes**: uno al cerrar cada
fase, no uno por commit. Verifica ANTES de pushear, no después.

---

## FASE 0 — El ensayo del demo (haz esto primero, hoy)

Faltan 2 días y **el guion no se ha corrido ni una vez** desde que se movió
media interfaz: paleta, marco, roles nuevos, cinco pantallas nuevas.

- Corre la skill `ensayo-demo` (vive en `.claude/skills/` del repo) de punta a
  punta contra el entorno real. Captura cada paso.
- **Prueba un ticket de diésel NUEVO**, con papel virgen. Es el centro del demo
  —litros del estímulo, portal, plazo— y es el único concepto que nunca se ha
  probado sin datos ya usados.
- Reporta qué se rompió o se ve distinto. Arregla lo que rompa el guion; lo
  demás anótalo y sigue.

Datos del demo: `VJ-2026-0848` en el tenant `11111111-1111-1111-1111-111111111111`
("Transportes Innovativos"), operador `529993700779` (el teléfono de Javier).
Para reabrir un viaje liquidado NO basta cambiar `viaje.estatus` — hay que
borrar la fila de `liquidacion` primero; el SQL exacto está en `TRASPASO.md`.

---

## FASE 1 — Mandar mensajes por WhatsApp

Hay **11 plantillas ya creadas** en la cuenta de Meta, todas en `PENDING` de
revisión al 3 de agosto: `pod_pendiente`, `comprobante_pendiente`,
`viaje_asignado`, `liquidacion_lista`, `plazo_factura`, `foto_ilegible`,
`anticipo_depositado`, `pod_rechazado`, `recordatorio_cierre`,
`incidencia_abierta`, `bienvenida_operador`. Verifica su estado con la Graph
API antes de empezar.

Lo que falta:

1. **Una función de envío de plantilla** en `src/lib/meta/client.ts`. Hoy sólo
   manda texto libre, que WhatsApp únicamente permite dentro de la ventana de
   24 h desde el último mensaje del usuario. Todo lo que Likida INICIA necesita
   plantilla aprobada.
2. **Cablear el botón** "pídele el POD al chofer" en `/dashboard/pod`. Hoy la
   página sólo registra que se pidió, con una nota en pantalla explicando por
   qué no manda nada. Cuando exista el envío, quita esa nota.
3. **Degradar con honestidad**: si la plantilla no está aprobada o el envío
   falla, dilo en pantalla. Un botón que falla en silencio es peor que no
   tenerlo.

**Ojo:** aunque las plantillas se aprueben, el número de producción sigue
siendo el de PRUEBA de Meta y sólo entrega a los teléfonos registrados a mano.
Sirve para el demo con el teléfono de Javier; no sirve para un cliente.

---

## FASE 2 — Rastreo GPS (el bloque grande)

Javier pidió integrar los sistemas de rastreo más comunes en flotas mexicanas,
de punta a punta. Nada de esto existe todavía.

**Sé honesto desde el principio: no hay credenciales de ningún proveedor.**
Puedes escribir los clientes contra el contrato documentado de cada API y
probarlos con HTTP simulado, pero no puedes confirmar que respondan hasta que
haya una cuenta real. Dilo así, no des por funcionando lo que no probaste.

1. **Migración** (`0048`): tabla `posicion` (unidad_id, lat, lng, velocidad,
   rumbo, odómetro, timestamp, proveedor) y `geocerca`. RLS con el mismo
   criterio de la 0047: son tablas de oficina, el chofer se excluye con
   `not is_operador()`. Escribe su bloque en `verificaciones.sql` y córrelo.
2. **Credenciales por flota**: tabla propia con RLS que sólo permita
   `flota_admin` y `superadmin` —el encargado NO ve tokens— y en la UI nunca
   muestres el token, sólo "configurado ✓" y los últimos 4.
3. **Capa neutral**: `src/lib/rastreo/tipos.ts` con `PosicionNormalizada` y una
   interfaz `AdaptadorRastreo`, más un registro de adaptadores. El panel no
   debe saber de qué proveedor viene una posición.
4. **Adaptadores** con API pública documentada: **Wialon** (Remote API, muy
   usado en LatAm), **Traccar** (open source, flotas chicas), **Samsara**,
   **Geotab** (MyGeotab, JSON-RPC) y **Navixy**. Cada uno con pruebas de
   contrato contra `fetch` simulado.
5. **Los proveedores mexicanos cerrados** (Encontrack, Detektor, Copiloto
   Satelital) no publican contrato de API: requieren acuerdo comercial. Déjalos
   como punto de extensión documentado, **no inventes sus endpoints**. Muchos
   además revenden Wialon por debajo, así que ese adaptador puede cubrirlos.
6. **Botón "Probar conexión"** que pegue contra el endpoint real y reporte el
   error exacto. Es lo que convierte "escrito" en "verificable" para Javier.
7. **La página `/dashboard/mapa`** hoy es un stub. Cabléala, y si no hay
   proveedor configurado deja el estado vacío que invita a conectar rastreo —
   el propio spec de Javier lo pide así.

---

## FASE 3 — Alta de clientes sin SQL

Desde el 3 de agosto ya se pueden crear viajes, unidades e incidencias desde el
panel (`lib/cuadra/operacion.ts`, las primeras escrituras administrativas de la
app). Lo que **sigue siendo SQL a mano**:

- dar de alta una flota (tenant),
- registrar el teléfono de un operador,
- editar la política de gastos (vive en `tenant.config.politica`, vía
  `getConfig()`; la tabla `politica_gasto` está MUERTA),
- reabrir un viaje liquidado.

Mientras eso no exista, Javier es el cuello de botella operativo con el segundo
cliente. Sigue el patrón ya establecido: server actions que **repiten el chequeo
de permiso adentro** (`dashboard/[id]/page.tsx:59-66` y
`dashboard/despacho/page.tsx`), porque el gateo de la UI sólo decide si se pinta
el formulario.

---

## FASE 4 — Lo que impide firmar un cliente

1. `src/app/privacidad/page.tsx` sigue sin razón social ni domicilio fiscal —
   la página lo declara a propósito. Necesita los datos reales de Javier.
2. **No existe página de Términos y Condiciones.** `/aviso/[tenant]` es otra
   cosa: el aviso que la flota le da a sus choferes.
3. Falta el contrato con la flota. Ellos entregan datos personales de sus
   operadores: Likida es **encargado del tratamiento** y eso se pacta por
   escrito.
4. **No hay forma de cobrar**: sin Stripe, Mercado Pago ni nada. Sin planes ni
   suscripción.

Los puntos 1 y 3 necesitan decisiones de Javier, no código. Pregúntale en vez de
inventar.

---

## FASE 5 — Lo que sólo puede hacer Javier

- **Sacar la cuenta de WhatsApp del modo prueba.** El número de producción es
  `Test Number` / `+1 555-659-6430`, `code_verification_status: NOT_VERIFIED`,
  y la WABA es `Test WhatsApp Business Account` con
  `business_verification_status: not_verified`. Hace falta verificación de
  negocio con Meta (documentos, tarda días o semanas), un número mexicano y
  verificarlo. **Es el camino crítico más largo del proyecto.**
- **Decidir el estímulo del diésel**: entregar litros (como hoy) o pesos con la
  cuota fechada del DOF, que ya se extrae del SIDOF con la skill `cuota-diesel`.
  Cambia el argumento de venta. No lo resuelvas por inferencia.
- **Pausar los deploys automáticos** si le preocupa el gasto: Settings → Git →
  Ignored Build Step en `exit 0`. Es reversible y no hay forma de hacerlo desde
  Claude Code.
- **Respaldos**: no hay nada escrito sobre el plan de Supabase ni sobre cómo
  restaurar. Vale la pena resolverlo antes de tener datos de un cliente real.

---

## Trampas ya pisadas — no vuelvas a caer

**De verificación visual (costaron horas el 3 de agosto):**

- **WebGL NO renderiza en Chrome headless** en esta máquina. Un canvas sale
  siempre transparente. Si algo depende de WebGL, no lo puedes verificar con
  captura: pórtalo a JS y renderízalo, o admite que no lo viste.
- **`--virtual-time-budget` captura ANTES de que React hidrate.** Un
  `useEffect` no corre y el resultado se lee como "todo bien" cuando en
  realidad no pasó nada. Dio dos falsos verdes seguidos.
- **Chrome headless no siempre cierra solo.** Lánzalo en background, espera
  ~20 s y `pkill -f "Google Chrome"`. El archivo suele existir aunque el
  comando devuelva error.
- **Reproduce con el contexto completo.** Un bug del rail no apareció porque el
  preview omitía el sidebar, que era justo la causa.
- Al borrar una ruta de preview, `.next/dev/types/validator.ts` queda obsoleto
  y `tsc` falla por un archivo generado. Bórralo.

**De código:**

- `Date.now()` en el render lo bloquea `react-hooks/purity`. Usa `ahoraMs()` de
  `lib/saludo.ts` desde el servidor y pásalo como prop.
- Puede haber **otra sesión de Claude** en este repo: `git log --oneline -5` y
  `git status` antes de empezar, y nunca `git add -A` a ciegas. Un agente mató
  el servidor de dev de otro por pelear el puerto 3000.

**De dominio:**

- No existen tablas de clientes, facturas emitidas, GPS ni kilómetros por
  viaje. Por eso no hay margen, OTIF ni km/l — y el margen necesita el ingreso
  del flete, que es decisión de producto, no una tabla que se pueda adivinar.
- `viaje.estatus` sólo admite `abierto | en_cuadre | liquidado`.
- `app_user.rol`: superadmin, flota_admin, contador, operador, encargado.
- `gasto.ocr_raw` está muerta; la prueba de que algo pasó por OCR es
  `ocr_confianza`.
- **El encargado NO ve finanzas** (`lib/auth/visibilidad.ts`). Si agregas una
  pantalla al sidebar, clasifícala ahí o una prueba falla — y si pones una
  cifra de dinero en algo que el encargado ve, es una fuga.

---

## FASE 1.5 — Encabezado fijo y scroll interno en TODAS las páginas

Javier lo pidió el 3 de agosto y quedó a medias: sólo Inicio de las dos
consolas (`dashboard/page.tsx` e `inicio-operacion.tsx`) tiene el patrón.

**El patrón**, para replicarlo en las ~60 páginas restantes de `/admin` y
`/dashboard`:

```tsx
<main className="h-full flex flex-col">
  <div className="glass-panel overflow-hidden flex flex-col min-h-0">
    <div className="... shrink-0">   {/* encabezado: no se mueve */}
    <div className="flex-1 min-h-0 overflow-y-auto">   {/* todo lo demás */}
```

Por qué importa: con la columna scrolleando, un panel más alto que la pantalla
se corta a media fila y su borde redondeado no aparece nunca — se lee como
interfaz rota en vez de "hay más abajo". `MARCO_COLUMNA` ya trae `pb-3` para
que el último panel siempre cierre, pero eso no da el encabezado fijo.

No se puede resolver desde `marco.ts`: cada página decide qué parte suya es
encabezado. Hay que ir una por una. Empieza por las que Javier usa en el demo.
