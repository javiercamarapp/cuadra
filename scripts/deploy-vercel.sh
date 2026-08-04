#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy de Likida a Vercel — automatiza link + envs + deploy a producción.
#
# REQUIERE una acción interactiva TUYA primero (una sola vez):
#     npm i -g vercel && vercel login
#
# Luego:  bash scripts/deploy-vercel.sh
#
# Empuja TODAS las variables de .env.local a Vercel (production + preview),
# saltando las vacías (p. ej. WHATSAPP_* si aún no tienes las creds de Meta) y
# NEXT_PUBLIC_APP_URL (se fija al dominio real, no a localhost).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

command -v vercel >/dev/null || { echo "❌ Falta Vercel CLI:  npm i -g vercel"; exit 1; }
[ -f .env.local ] || { echo "❌ Falta .env.local"; exit 1; }

echo "▸ Vinculando el proyecto (crea 'likida' si no existe)…"
vercel link

push_env() {  # name value environment
  local name="$1" val="$2" env="$3"
  [ -z "$val" ] && return 0
  vercel env rm "$name" "$env" -y >/dev/null 2>&1 || true   # idempotente
  printf '%s' "$val" | vercel env add "$name" "$env" >/dev/null
  echo "  ✓ $name → $env"
}

echo "▸ Empujando variables de entorno…"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  name="${line%%=*}"
  val="${line#*=}"
  val="${val%%#*}"                                   # quita comentario inline
  val="$(printf '%s' "$val" | sed 's/[[:space:]]*$//')"  # quita espacios finales
  [ "$name" = "NEXT_PUBLIC_APP_URL" ] && continue    # se fija al dominio real abajo
  push_env "$name" "$val" production
  push_env "$name" "$val" preview
done < .env.local

# ─────────────────────────────────────────────────────────────────────────────
# EL DOMINIO ESTABLE — antes del deploy, no después.
#
# AUDITORÍA 11, G-36 (ALTO). Aquí se hacía `url="$(vercel --prod --yes)"` y se
# guardaba ESA salida como NEXT_PUBLIC_APP_URL. Es la URL POR DEPLOY
# (`likida-a1b2c3d4e-javier.vercel.app`), distinta en cada push y ausente de
# las *Redirect URLs* de Supabase: GoTrue ignora el `emailRedirectTo`, el
# navegador se va a otro dominio y Likida nunca recibe esa petición — no hay
# log que pueda existir. El contralor recibe su magic link, hace clic, y no
# entra. Y el script cerraba con un `echo` recordando redesplegar: un
# recordatorio impreso, no un paso.
#
# Ahora el valor sale de `.env.local` (el mismo archivo del que salen las
# demás), se comprueba ANTES de desplegar, y si no sirve el script se detiene.
# El dominio tiene que ser el MISMO que el Site URL de Supabase
# (Auth → URL Configuration); eso no lo puede adivinar un script.
# ─────────────────────────────────────────────────────────────────────────────
app_url="$(grep -E '^NEXT_PUBLIC_APP_URL=' .env.local | head -1 | cut -d= -f2- | sed 's/#.*//; s/[[:space:]]*$//')"
case "$app_url" in
  https://*) ;;
  *) echo "❌ NEXT_PUBLIC_APP_URL en .env.local debe ser el dominio de producción con https:// (hoy: '${app_url:-vacío}')"; exit 1 ;;
esac
case "$app_url" in
  */) echo "❌ NEXT_PUBLIC_APP_URL no puede terminar en '/': el redirect quedaría como //auth/callback"; exit 1 ;;
  *localhost*|*127.0.0.1*) echo "❌ NEXT_PUBLIC_APP_URL apunta a localhost; en Vercel tiene que ser el dominio real"; exit 1 ;;
esac
if printf '%s' "$app_url" | grep -Eq -- '-[a-z0-9]{8,}(-[a-z0-9-]+)?\.vercel\.app$'; then
  echo "❌ NEXT_PUBLIC_APP_URL parece la URL efímera de un deploy, no el alias estable."
  echo "   Usa el alias de producción o tu dominio propio, y ponlo también en Supabase → Auth → URL Configuration."
  exit 1
fi

echo "▸ Fijando NEXT_PUBLIC_APP_URL=$app_url (dominio estable, ANTES del deploy)…"
vercel env rm NEXT_PUBLIC_APP_URL production -y >/dev/null 2>&1 || true
printf '%s' "$app_url" | vercel env add NEXT_PUBLIC_APP_URL production >/dev/null
echo "  ✓ El deploy de abajo ya lo toma: no hace falta un segundo redeploy."

echo "▸ Deploy a producción…"
url="$(vercel --prod --yes)"
echo "✅ Desplegado: $url"
echo "   (esa es la URL de ESTE deploy; la app se sirve en $app_url)"

cat <<EOF

── SIGUIENTE ──────────────────────────────────────────────────────────────────
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan:  vercel project inspect  (o el dashboard → Settings → Functions)
   - Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
   - Si Hobby: queda en 60; el peor caso va por QStash (FASE 3).
3) Reportar tier + probar flujo/ráfaga contra el dominio real.
EOF
