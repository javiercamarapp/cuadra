-- ═══════════════════════════════════════════════════════════════════════════
-- 0053 — `app_user.id` deja de ser «= auth.users.id» solo en un comentario.
--
-- BAJO de la auditoría 10 (modelo de datos). La 0001 escribió:
--
--     id uuid primary key,   -- = auth.users.id
--
-- Un comentario. `grep "auth.users"` en `supabase/` devuelve esa línea y
-- ninguna más: la relación 1-a-1 que sostiene TODO el login —`getSessionTenant`
-- busca la fila por el `id` del usuario de Auth— nunca fue una restricción.
--
-- ESCENARIO. Se borra un usuario de prueba desde la consola de Auth (la vía
-- documentada para revocar acceso). Su fila de `app_user` sobrevive, porque
-- nada la ata. Se vuelve a dar de alta el mismo correo:
-- `admin.auth.admin.createUser` funciona —ya no existe en Auth— y devuelve un
-- `id` NUEVO; el insert truena con
-- `23505 duplicate key value violates unique constraint "app_user_email_key"`
-- contra la fila vieja, la del `id` muerto. Queda un usuario de Auth sin fila
-- en `app_user`: pide su magic link, obtiene sesión válida, y sale con
-- `tenantId: null` → /sin-acceso para siempre. El alta hay que destrabarla a
-- mano en SQL, y el síntoma que ve la persona («no tienes acceso») no apunta a
-- la causa.
--
-- La mitad de aplicación ya está cerrada: `provisionarUsuario` compensa el
-- insert fallido borrando el usuario de Auth recién creado, y deja escrito el
-- correo si ni eso se puede. Esto es la mitad de esquema: `on delete cascade`
-- hace que borrar el usuario en la consola de Auth se lleve su fila, que es lo
-- que la gente ya cree que pasa.
--
-- POR QUÉ CASCADE Y NO RESTRICT. Borrar en la consola de Auth es la vía
-- documentada para revocar acceso; con RESTRICT esa operación empezaría a
-- fallar con un mensaje sobre una tabla que quien revoca no conoce. CASCADE
-- hace lo que el operador ya cree que está haciendo. Y no se pierde nada que
-- importe: `app_user` no es el dato del negocio, es la liga entre una cuenta y
-- una flota — los viajes, gastos y liquidaciones cuelgan de `tenant` y de
-- `operador`, no de aquí.
--
-- SE APLICA CON RED: antes se cuentan las filas huérfanas (las que ya no tienen
-- usuario de Auth) y se aborta con el número y con el SQL para verlas, porque
-- cada una es una cuenta que alguien cree dada de alta.
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual
--     ejercerla, y esta en particular toca el esquema `auth`, que es de
--     Supabase: `supabase db push` corre como el dueño del proyecto y debería
--     poder referenciarlo, pero si el `alter table` responde `42501
--     permission denied for schema auth`, la migración se queda ahí y hay que
--     pedirlo por soporte. El bloque 34 de `supabase/verificaciones.sql` la
--     comprueba de verdad.
--
-- Reversible: `alter table public.app_user drop constraint app_user_id_auth_fkey;`
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare n bigint;
begin
  select count(*) into n
  from public.app_user u
  where not exists (select 1 from auth.users a where a.id = u.id);

  if n > 0 then
    raise exception
      'No se puede aplicar app_user_id_auth_fkey: hay % fila(s) de app_user cuyo `id` ya NO existe en auth.users. Cada una es una cuenta que alguien cree dada de alta y que no puede iniciar sesión nunca — y además bloquea el alta de ese correo por el unique(email). Míralas con: select id, email, rol, tenant_id from app_user u where not exists (select 1 from auth.users a where a.id = u.id); Bórralas o vuelve a crear su usuario de Auth con el MISMO id antes de reaplicar.', n;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_id_auth_fkey'
      and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user
      add constraint app_user_id_auth_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

comment on constraint app_user_id_auth_fkey on public.app_user is
  'La relación 1-a-1 con auth.users vivía en un comentario de la 0001 desde el primer día. Sin ella, borrar un usuario en la consola de Auth dejaba su fila de app_user viva, y el mismo correo ya no se podía dar de alta desde el producto: `createUser` devolvía un id nuevo y el insert chocaba con el unique(email) de la fila muerta (0053).';
