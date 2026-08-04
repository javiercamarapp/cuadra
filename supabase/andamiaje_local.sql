-- ═══════════════════════════════════════════════════════════════════════════
-- ANDAMIAJE LOCAL — lo que Supabase pone y un PostgreSQL desnudo no.
--
-- POR QUÉ EXISTE. Las migraciones y los 34 bloques de `verificaciones.sql`
-- hablan `auth.uid()`, `request.jwt.claims`, los roles `anon`/`authenticated`/
-- `service_role` y el esquema `storage`. Nada de eso vive en el repo: lo pone
-- la plataforma. Sin este archivo, `psql -f 0001_init.sql` falla en la primera
-- policy y NINGUNA verificación se puede correr — que es exactamente por qué 24
-- de los 34 bloques llevaban meses escritos y sin ejercer.
--
-- QUÉ ES Y QUÉ NO ES.
--
--   SÍ es: una réplica de las CUATRO piezas que el repo consume, copiadas del
--   comportamiento documentado de Supabase — `auth.uid()` leyendo el claim
--   `sub` de `request.jwt.claims`, `auth.users` como destino de la FK de
--   `app_user`, los tres roles con sus grants, y `storage.buckets`.
--
--   NO es: Supabase. No trae GoTrue, ni PostgREST, ni sus triggers, ni su
--   `search_path` por defecto, ni la versión exacta de sus extensiones. Un
--   bloque que pase aquí es evidencia FUERTE de que la policy hace lo que dice
--   —el motor de RLS es el mismo PostgreSQL— y NO es prueba de que el
--   despliegue real se comporte igual.
--
-- CÓMO SE USA (ver `scripts/verificar-sql.sh`, que hace esto solo):
--   psql -f supabase/andamiaje_local.sql
--   psql -f supabase/migrations/0001_init.sql   ... y el resto, en orden
--   psql -f supabase/verificaciones.sql          bloque por bloque
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Los tres roles de PostgREST ────────────────────────────────────────────
-- `anon` y `authenticated` son roles a los que `authenticator` cambia según el
-- JWT. `service_role` es el que salta RLS (BYPASSRLS), y por eso todo el código
-- que lo usa tiene que filtrar por tenant a mano — el repo lo repite en cada
-- comentario de `supabaseAdmin()`.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- ── Esquema `auth` ─────────────────────────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- `auth.users` es el destino de `app_user.id` (0001 lo dice en un comentario, y
-- la migración 0053 lo convierte en FK de verdad). Solo las columnas que el
-- repo toca: GoTrue tiene ~30 más que aquí no hacen falta.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  -- `instance_id` no lo usa el repo, pero el bloque 34 de `verificaciones.sql`
  -- inserta en `auth.users` imitando a GoTrue y la nombra. Está aquí para que
  -- ese bloque mida la FK de la 0053 y no un `column does not exist`.
  instance_id uuid default '00000000-0000-0000-0000-000000000000',
  email text unique,
  encrypted_password text,
  -- GoTrue las escribe siempre y el bloque 34 las nombra al imitar un alta de
  -- Auth. No las usa el repo; están para que ese bloque mida la FK de la 0053.
  aud text default 'authenticated',
  role text default 'authenticated',
  updated_at timestamptz not null default now(),
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- `app_user.id` referencia a `auth.users.id` desde la 0053, así que los bloques
-- que dan de alta un usuario tienen que crear primero su fila de Auth. Esta
-- función es lo que GoTrue hace por debajo, reducido a lo que el repo consume.
create or replace function auth.crear_usuario(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, p_email);
  return v_id;
end $$;

grant execute on function auth.crear_usuario(text) to postgres, service_role;

-- EL CORAZÓN DE TODA LA RLS DE ESTE REPO.
--
-- PostgREST pone el JWT del usuario en `request.jwt.claims` como GUC de la
-- transacción; `auth.uid()` lee el claim `sub`. Los bloques de
-- `verificaciones.sql` lo simulan con `set_config('request.jwt.claims', …)`,
-- que es exactamente el mismo mecanismo — por eso lo que se mide aquí es la
-- policy real y no un mock.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'role', ''),
    current_setting('role', true)
  );
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- ── Esquema `storage` ──────────────────────────────────────────────────────
-- La 0039 crea el bucket `comprobantes` y `startup.ts` lo sonda con
-- `storage.getBucket`. Solo `buckets`: `objects` no lo toca ninguna migración.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

grant select on storage.buckets to anon, authenticated, service_role;

-- ── Grants que Supabase aplica por defecto a lo que nazca en `public` ──────
-- Sin esto, `set local role authenticated` en los bloques de verificación falla
-- con «permission denied for table», y el resultado se leería como una policy
-- que bloquea cuando en realidad es un grant que falta. La RLS se evalúa
-- DESPUÉS del grant: son dos capas distintas y confundirlas invalida la medición.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
