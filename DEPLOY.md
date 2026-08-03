# Runbook de producción

Producción: **https://likidaai.vercel.app** — proyecto `likida/likida.ai` en Vercel,
plan Pro. Ya está desplegado y sirviendo WhatsApp real; este documento es para
**operarlo**, no para levantarlo. El apartado de despliegue está al final porque
es lo que menos falta se hace a las 3 a.m.

---

## Algo se rompió: qué mirar, en este orden

1. **Los logs.** Todo sale como JSON de una línea por `src/lib/logger.ts`.
   ```
   vercel logs https://likidaai.vercel.app --since 1h
   ```
   O el panel: Vercel → proyecto → *Logs* (runtime). Ojo: **la retención de esa
   vista es corta y no hay ningún log drain configurado** — un fallo del sábado
   de madrugada puede no existir el lunes. Si el incidente importa, copia las
   líneas antes de cerrar la pestaña.

2. **Qué buscar en la línea.** Los identificadores del camino del dinero
   (`tenant`, `viaje`, `operador`, `gasto`, `liquidacion`) salen como huella
   `id:xxxxxxxxxxxx`, no como UUID. Para cruzar una huella contra la base:

   ```ts
   import { huellaId } from '@/lib/logger';
   huellaId('<el uuid de la fila>') // === lo que dice el log
   ```

   El porqué está explicado arriba de `src/lib/logger.ts`: el log solo no puede
   revelar a nadie, pero quien tiene la base recorre el camino contrario en un
   segundo. El RFC y los teléfonos sí se borran del todo y no se recuperan.

3. **Los mensajes de arranque.** Cada instancia nueva emite:
   - `startup.observabilidad` — `{"sentry":false}` en `error` significa que
     **nadie va a recibir el siguiente fallo**. Es lo primero que hay que
     arreglar si aparece.
   - `startup.migraciones` — el esquema del camino del dinero.
   - `startup.entorno` — falta configuración crítica.

4. **Si el panel falló para el contralor.** Pídele el `Digest: <número>` que
   Next enseña en pantalla y busca ese número en los logs: `onRequestError`
   (`src/instrumentation.ts`) emite `request.fail` con `digest`, `ruta` y el
   error. Es el único puente entre lo que él vio y el servidor.

5. **Si las fotos dejaron de llegar.** El sospechoso número uno es el token de
   WhatsApp caducado — ver la sección siguiente.

---

## ¿El costo por liquidación es real o solo parece barato?

Likida cobra **por liquidación**, así que un costo que se subestima en silencio
es el que hace fijar mal el precio. Estas cuatro líneas son las que lo delatan
(`src/lib/cuadra/costos.ts`):

| Línea | Qué significa |
|---|---|
| `costo.no_registrado` | Un insert a `llm_costo` rebotó (RLS, columna, `check`). Ese gasto **no está contado**: el costo real es más alto que el que se ve. |
| `costo.liquidacion_sin_costo` | Una liquidación se cerró sin **una sola** fila de costo. Su costo unitario es DESCONOCIDO, no cero. |
| `costo.precio_wa_invalido` | `CUADRA_WHATSAPP_MSG_USD` está puesta y no es un número (típicamente vacía). Se usó el default; sin este aviso cada mensaje habría contado $0. |
| `costo.monto_invalido` | Llegó un costo NaN o negativo y se descartó la fila en vez de escribir un 0 que se leería como barato. |

Regla de lectura: **cero solo es cero cuando alguien lo midió.** `getResumenCosto`
devuelve `estado: 'medido' | 'sin_registros' | 'no_medido'` justamente para que
un fallo de lectura no se pueda pintar como "$0.00".

---

## Rotar el token de WhatsApp

`WHATSAPP_ACCESS_TOKEN` es un token de usuario de sistema de Meta y **caduca**.
Cuando caduca, la Graph API contesta 401 a las descargas de media: el operador
recibe *"No pude descargar tu foto 😕. ¿Me la reenvías?"*, reenvía, y vuelve a
fallar — reenviar no arregla un token vencido, así que el bucle no termina solo.

1. Meta Business Settings → *Usuarios* → *Usuarios del sistema* → el usuario de
   la app → **Generar nuevo token**, con los permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`.
2. ```
   vercel env rm WHATSAPP_ACCESS_TOKEN production
   vercel env add WHATSAPP_ACCESS_TOKEN production
   ```
3. Redespliega (`vercel --prod`): las envs se leen en el arranque de la función.
4. Comprueba con un mensaje de prueba al número de pruebas, no al del cliente.

---

## Variables que deben estar en Vercel

Están todas en `.env.example`, que es el inventario completo y está verificado
contra el código por la suite (`src/lib/observability/runbook.test.ts`). Las
cuatro que hay que revisar a mano porque **si faltan el sistema arranca igual**:

| Variable | Qué pasa si falta |
|---|---|
| `SENTRY_DSN` | No hay alerta de nada. Los errores mueren en el runtime log. |
| `DEMO_TENANT_ID` | El panel consulta el tenant del seed y pinta **cero liquidaciones**, sin log. |
| `NEXT_PUBLIC_APP_URL` | El login arma el magic link y el retorno de Google contra el fallback del código, `https://likida.ai`, que **no es** el dominio desplegado (`https://likidaai.vercel.app`). El correo llega, el link abre, y la sesión se completa en otro sitio: nadie entra y no hay un solo error. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `createServerClient` lanza `supabaseKey is required` dentro del middleware: **cada** petición a `/dashboard`, `/admin` y `/mis-viajes` se vuelve un 500. |
| `DASHBOARD_SECRET` | El HMAC de la cookie de `/acceso` se deriva del passcode: crackeable offline. |

Para listarlas: `vercel env ls production`.

`DASHBOARD_PASSCODE` **ya no gatea el panel** y esta tabla decía que sí. Desde
que el gate es la sesión de Supabase (`src/proxy.ts:44-77`), sus únicos
lectores son `src/app/acceso/page.tsx` y `src/lib/auth/passcode.ts`; ninguno
protege `/dashboard`. Quitarla no abre nada.

---

## Lo que el login necesita del lado de Supabase

Nada de esto vive en el repo, y la mitad de los fallos del login vienen de
aquí. Proyecto de Supabase → **Authentication**:

1. **URL Configuration → Site URL**: `https://likidaai.vercel.app`. Es a donde
   GoTrue manda al usuario cuando **rechaza** el `emailRedirectTo` que pide el
   código. Por default es `http://localhost:3000`, así que dejarla mal no da
   error: manda el correo, el contralor abre el link, y el navegador va a
   localhost. **Likida nunca recibe esa petición**, así que no hay ningún log
   que pueda existir.

2. **URL Configuration → Redirect URLs**: tiene que estar
   `https://likidaai.vercel.app/auth/callback` (y, para trabajar en local,
   `http://localhost:3000/auth/callback`). El código arma
   `${NEXT_PUBLIC_APP_URL}/auth/callback?next=...`
   (`src/app/login/page.tsx:10,79`): si ese origen no está en la lista, GoTrue
   lo ignora y cae en la Site URL del punto anterior.

3. **Providers → Email**: encendido. **Providers → Google**: encendido, con el
   Client ID/Secret de la consola de Google, y en la consola de Google el
   *Authorized redirect URI* que Supabase indica
   (`https://<proyecto>.supabase.co/auth/v1/callback`).

4. **Emails → SMTP Settings**: el remitente. Hoy es el **sandbox de Resend**
   (`onboarding@resend.dev`), que **solo entrega a
   `javiercamaraportepetit@gmail.com` y responde 403 a cualquier otra
   dirección** (`docs/superpowers/plans/2026-08-02-roles-flota.md:96-103`). Ese
   403 llega a GoTrue, que contesta 500 `unexpected_failure` («Error sending
   magic link email»). En el log eso sale como `login.otp_error` con `code` y
   `status`; en la pantalla, como «Algo falló. Intenta otra vez.». **Antes del
   demo hay que poner un remitente con dominio verificado** o el único correo
   que puede entrar al panel es el de Javier.

Cómo se verifica que quedó, sin adivinar: pide el magic link desde el mismo
navegador donde vas a abrirlo (el `code_verifier` del PKCE vive en su cookie) y
mira el log. `login.otp_error` = no salió el correo;
`auth.callback_intercambio` = el correo salió y el intercambio falló (link
caducado, otro dispositivo, callback fuera de la lista blanca); ninguna de las
dos = entró.

---

## Desplegar

Con el proyecto ya vinculado:

```
vercel --prod
```

Para un entorno nuevo desde cero, `bash scripts/deploy-vercel.sh` vincula el
proyecto, empuja las envs de `.env.local` a production + preview (salta las
`WHATSAPP_*` vacías) y fija `NEXT_PUBLIC_APP_URL` al dominio real.

**No** copies solo "las envs de `.env.example` que tengan valor": ese atajo fue
el que dejó fuera el passcode del panel y el tenant. El inventario de arriba es
el que manda.

### Meta / WhatsApp

- Webhook URL: `https://likidaai.vercel.app/api/webhook/whatsapp`
- Verify token: el valor de `WHATSAPP_VERIFY_TOKEN`.
- El `GET` responde el challenge; el `POST` valida HMAC con `WHATSAPP_APP_SECRET`.
- El webhook responde **200 antes de trabajar** (el trabajo va en `after()`, con
  `maxDuration = 120` en `src/app/api/webhook/whatsapp/route.ts`). Consecuencia
  operativa: **Meta no reintenta**. Un error después del 200 es un mensaje
  perdido, y por eso importa tanto que los errores tengan destino.

---

## Lo que este runbook NO cubre

- **Quién recibe qué cuando algo falla.** Hoy no hay nadie asignado ni ningún
  canal: sin `SENTRY_DSN` no hay a dónde mandarlo, y con él habría que decidir
  destinatario.
- **Qué se hace con una liquidación cerrada cuyo PDF no salió** (`pdf.no_entregado`).
  El operador recibe aviso; el procedimiento de reenvío no está escrito.
- **La retención exacta de los runtime logs** en este plan, ni si hace falta un
  log drain antes del demo.
