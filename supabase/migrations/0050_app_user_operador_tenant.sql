-- ═══════════════════════════════════════════════════════════════════════════
-- 0050 — `app_user.operador_id` es la ÚNICA FK de identidad sin `tenant_id`.
--
-- ALTO de la auditoría 10 (modelo de datos). La 0047 ya cerró la mitad de este
-- hallazgo: las tres policies del chofer ahora llevan
-- `tenant_id = any(get_user_tenant_ids())`. Falta la otra mitad, que es la
-- clave — y es la que la 0028 estableció para las 22 FK del esquema con este
-- escenario escrito palabra por palabra: «la verificación de la FK no mira
-- tenant, y además ignora la RLS».
--
-- QUÉ ACEPTA LA BASE HOY. La 0045 escribió:
--
--     add column operador_id uuid references public.operador(id)
--       on delete set null
--
-- FK simple. Y como NINGÚN camino de la aplicación llenaba esa columna hasta
-- esta auditoría, ligar la cuenta de un chofer era forzosamente manual, en la
-- consola de Supabase. Se pega el UUID equivocado —el de un chofer de la flota
-- B, que está a tres filas en la misma tabla `operador`—:
--
--     update app_user set operador_id = '<uuid de un operador de la flota B>'
--     where email = 'chofer@flota-a.com';   -- la base lo acepta
--
-- La FK solo exige que el operador exista. Nada, en ninguna capa del esquema,
-- exigía que fuera de la MISMA flota. `mis-viajes/page.tsx:16-22` declara por
-- escrito que confía en la base para eso.
--
-- LO QUE SE PONE:
--
--  1. FK COMPUESTA `(operador_id, tenant_id) → operador (id, tenant_id)`. El
--     índice destino `operador_id_tenant_key` ya existe desde la 0028, así que
--     la clave compuesta estaba disponible y no se usó.
--
--     `on delete restrict`, no `set null`: una FK compuesta con SET NULL
--     anularía TAMBIÉN `tenant_id` —que en `app_user` es nullable, así que el
--     DELETE sí pasaría— y dejaría al contralor sin flota por borrar a un
--     chofer. Con RESTRICT, borrar un `operador` que tiene cuenta web falla
--     ruidosamente y dice qué desligar. El producto no borra operadores: los
--     desactiva (`activo = false`), que es el camino que WhatsApp usa.
--
--     Se dropea la FK simple de la 0045: convivir con ella no aporta —la
--     compuesta la implica— y su `on delete set null` contradice el RESTRICT
--     nuevo, que es el peor estado posible para razonar sobre un DELETE.
--
--  2. CHECK `app_user_operador_exige_tenant`. Una FK compuesta con MATCH
--     SIMPLE —el default— NO COMPRUEBA NADA cuando una de sus columnas es NULL.
--     `app_user.tenant_id` es nullable por diseño (0001:17: nulo = superadmin),
--     así que una fila con `tenant_id = null` y un `operador_id` cualquiera
--     volvería a pasar sin verificación. El CHECK cierra esa puerta: si hay
--     `operador_id`, hay `tenant_id`. Es el mismo motivo por el que la 0028
--     dejó `wa_conversacion` fuera y lo dijo.
--
-- ANTES DE APLICAR se cuentan las filas cruzadas y se aborta con el número, en
-- vez de dejar que el `ADD CONSTRAINT` diga «is not present in table»: ese
-- número decide si se limpia a mano o se investiga (patrón de la 0028).
--
-- Reversible:
--   alter table public.app_user drop constraint app_user_operador_tenant_fkey;
--   alter table public.app_user drop constraint app_user_operador_exige_tenant;
--   alter table public.app_user add constraint app_user_operador_id_fkey
--     foreign key (operador_id) references public.operador(id) on delete set null;
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 31 de `supabase/verificaciones.sql` la comprueba de verdad.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Hay ya filas que esta clave no admitiría? ───────────────────────────
do $$
declare n bigint;
begin
  select count(*) into n
  from public.app_user u
  where u.operador_id is not null
    and (
      u.tenant_id is null
      or not exists (
        select 1 from public.operador o
        where o.id = u.operador_id and o.tenant_id = u.tenant_id
      )
    );

  if n > 0 then
    raise exception
      'No se puede aplicar app_user_operador_tenant_fkey: hay % fila(s) de app_user cuyo operador_id apunta a un chofer de OTRA flota (o que no tienen tenant). Cada una es una cuenta web leyendo los viajes de una flota ajena. Corrígelas antes de volver a aplicar: select id, email, tenant_id, operador_id from app_user where operador_id is not null;', n;
  end if;
end $$;

-- ── 2. Fuera la FK simple de la 0045 ────────────────────────────────────────
-- Por catálogo y no por nombre literal: la 0045 la creó implícita (`references`
-- dentro del `add column`), así que el nombre lo puso Postgres.
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.app_user'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.operador'::regclass
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table public.app_user drop constraint %I', r.conname);
  end loop;
end $$;

-- ── 3. La clave compuesta ───────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_operador_tenant_fkey'
      and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user
      add constraint app_user_operador_tenant_fkey
      foreign key (operador_id, tenant_id)
      references public.operador (id, tenant_id)
      on delete restrict;
  end if;
end $$;

-- ── 4. Y que MATCH SIMPLE no se salte la comprobación por un tenant nulo ────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_operador_exige_tenant'
      and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user
      add constraint app_user_operador_exige_tenant
      check (operador_id is null or tenant_id is not null);
  end if;
end $$;

comment on constraint app_user_operador_tenant_fkey on public.app_user is
  'La cuenta web del chofer y su fila de `operador` son de la MISMA flota. Sin esto, un UUID mal pegado en la consola de Supabase le daba a ese chofer los viajes, gastos y liquidaciones de una flota ajena — la FK simple de la 0045 solo exigía que el operador existiera (0050).';

comment on constraint app_user_operador_exige_tenant on public.app_user is
  'Una FK compuesta con MATCH SIMPLE no comprueba nada si una columna es NULL, y `app_user.tenant_id` es nullable por diseño (nulo = superadmin). Sin este CHECK, `tenant_id = null` volvía a saltarse app_user_operador_tenant_fkey (0050).';
