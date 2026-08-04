#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# CORRE `supabase/verificaciones.sql` CONTRA UNA BASE DE VERDAD.
#
# El archivo llevaba 34 bloques y solo 9 con salida copiada: 24 escritos y
# nunca ejercidos, entre ellos los que prueban que el chofer no ve el dinero de
# la flota y que el contador no borra. La causa no era pereza — era que no
# había dónde correrlos: los bloques hablan `auth.uid()`, `request.jwt.claims`
# y los roles de PostgREST, que un `postgres:16` desnudo no tiene.
#
# `supabase/andamiaje_local.sql` pone esas piezas. Este script arma la base
# desde cero, aplica las 53 migraciones en orden y corre los 34 bloques.
#
# QUÉ VALE ESTE RESULTADO. El motor de RLS es el mismo PostgreSQL, así que un
# bloque que pasa aquí es evidencia FUERTE de que la policy hace lo que dice.
# NO es Supabase: no hay GoTrue ni PostgREST reales. Antes de un despliegue,
# los bloques que tocan `auth` o `storage` se vuelven a correr allá.
#
# Cada bloque termina con `raise exception` A PROPÓSITO: revierte su propia
# transacción y no deja rastro. El resultado se lee en el mensaje de error.
#
#   ./scripts/verificar-sql.sh            arma todo y corre los 34
#   ./scripts/verificar-sql.sh 26 29      solo esos bloques
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

PGDATA=${PGDATA:-/tmp/pgdata_likida}
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5433} PGUSER=${PGUSER:-postgres}
DB=${DB:-likida_verif}
BIN=/usr/lib/postgresql/16/bin

# ── 1. Clúster ─────────────────────────────────────────────────────────────
if ! pg_isready -q 2>/dev/null; then
  echo "· levantando clúster en $PGDATA"
  id postgres >/dev/null 2>&1 || useradd -m postgres
  [ -d "$PGDATA/base" ] || { rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres "$PGDATA"
    su postgres -c "$BIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null 2>&1; }
  su postgres -c "$BIN/pg_ctl -D $PGDATA -l /tmp/pg.log -o '-p $PGPORT -k $PGHOST' start" >/dev/null 2>&1
  sleep 3
fi

# ── 2. Base limpia + andamiaje + migraciones ───────────────────────────────
echo "· base $DB desde cero"
psql -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/andamiaje_local.sql >/dev/null || { echo "ANDAMIAJE FALLÓ"; exit 1; }

for f in supabase/migrations/*.sql; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/tmp/mig.log 2>&1 || {
    echo "MIGRACIÓN FALLÓ: $(basename "$f")"; grep -m3 ERROR /tmp/mig.log; exit 1; }
done
echo "· 53 migraciones aplicadas"

# ── 3. Los bloques ─────────────────────────────────────────────────────────
# Se parte por el encabezado `-- ── NN. …`, que es el mismo que el guardarraíl
# `migraciones_verificadas.test.ts` ya exige — una sola convención, no dos.
python3 - "$@" <<'PY'
import re, subprocess, sys, os
texto = open('supabase/verificaciones.sql').read()
partes = re.split(r'^-- ── (\d+)\. (.*?) ─+\s*$', texto, flags=re.M)
pedidos = set(sys.argv[1:])
bloques = []
for i in range(1, len(partes), 3):
    num, titulo, cuerpo = partes[i], partes[i+1].strip(), partes[i+2]
    # TRES FORMAS DE BLOQUE, y las tres se reportan. Quedarse callado con las
    # que no encajan en la forma esperada es el modo de fallo que esta ronda
    # persigue: el runner decía «34 bloques» y corría 32, sin una línea que
    # dijera qué pasó con los otros dos.
    #
    #   `do $$`  → veredicto por `raise exception` (P0001). A PRINCIPIO DE
    #   LÍNEA: buscarlo en cualquier posición cortaba los bloques 16 y 23 por la
    #   mitad, porque su comentario de cabecera menciona «`do $$` corre como el
    #   dueño y bypasea RLS» y el índice caía dentro de esa frase.
    m = re.search(r'^do \$\$', cuerpo, flags=re.M)
    if m:
        bloques.append((num, titulo, 'do', cuerpo[m.start():]))
        continue
    #   `select` → el veredicto es la FILA que devuelve (bloque 22).
    m = re.search(r'^select\b', cuerpo, flags=re.M)
    if m:
        fin = cuerpo.index(';', m.start()) + 1
        bloques.append((num, titulo, 'select', cuerpo[m.start():fin]))
        continue
    #   sin cuerpo → retirado a propósito (bloque 21, tabla revertida por la
    #   0041). Se imprime igual, para que «retirado» sea una decisión visible y
    #   no un bloque que se perdió.
    bloques.append((num, titulo, 'vacio', ''))

env = dict(os.environ, DB=os.environ.get('DB', 'likida_verif'))
ok = fallo = saltado = retirado = 0
for num, titulo, forma, sql in bloques:
    if pedidos and num not in pedidos:
        saltado += 1; continue

    if forma == 'vacio':
        retirado += 1
        print(f'– {num:>2}  {titulo[:52]:<52} sin cuerpo — retirado a propósito, ver cabecera')
        continue

    if forma == 'select':
        # El veredicto es la fila. Se imprime tal cual y la lee una persona
        # contra el «Corrido el …, salida real» de la cabecera: no hay
        # `raise exception` del que sacar un código.
        r = subprocess.run(['psql', '-q', '-d', env['DB'], '-v', 'ON_ERROR_STOP=1',
                            '-A', '-F', ' ', '-P', 'footer=off'],
                           input=sql, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            fallo += 1
            print(f'✗ {num:>2}  {titulo[:52]:<52} {(r.stderr or "").strip()[:110]}')
        else:
            ok += 1
            fila = ' '.join(r.stdout.split('\n')[:2]).strip()
            print(f'✓ {num:>2}  {titulo[:52]:<52} {fila[:110]}')
        continue

    # VERBOSITY verbose da el SQLSTATE, que es lo único que distingue el
    # veredicto del bloque de un fallo de armado. `raise exception` sin
    # `using errcode` sale como P0001; cualquier otro código (42P01 tabla que
    # no existe, 23503 FK, 23502 not-null, 42601 sintaxis) significa que el
    # bloque NO llegó a medir nada. Confundirlos fue mi primer error aquí: cinco
    # bloques que reventaron por una FK se leyeron como aprobados.
    r = subprocess.run(['psql', '-q', '-d', env['DB'], '-v', 'ON_ERROR_STOP=1',
                        '-v', 'VERBOSITY=verbose'],
                       input="\\set VERBOSITY verbose\n" + sql,
                       capture_output=True, text=True, env=env)
    salida = (r.stderr or r.stdout).strip()
    # Con VERBOSITY verbose, psql escribe `ERROR:  P0001: mensaje` — el SQLSTATE
    # va EN LÍNEA, no en un campo aparte.
    m = re.search(r'ERROR:\s*(\w{5}):\s*(.*)', salida)
    if m:
        codigo, msg = m.group(1), m.group(2)
    else:
        codigo = '?????'
        msg = salida.replace('\n', ' ')[:200]
    esperado = codigo == 'P0001'
    marca = '✓' if esperado else '✗'
    if not esperado: msg = f'[{codigo}] {msg}'
    if esperado: ok += 1
    else: fallo += 1
    print(f'{marca} {num:>2}  {titulo[:52]:<52} {msg[:110]}')
print(f'\n=== {ok} bloques dieron veredicto · {fallo} NO llegaron a medir · '
      f'{retirado} retirados · {saltado} no pedidos  (de {len(bloques)} cabeceras) ===')
sys.exit(1 if fallo else 0)
PY
