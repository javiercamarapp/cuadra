-- ═══════════════════════════════════════════════════════════════════════════
-- 0051 — `rol='operador'` con `operador_id` NULL deja de ser un estado válido.
--
-- MEDIO de la auditoría 10 (modelo de datos). La 0045 declaró la invariante en
-- un COMENTARIO —«Solo se llena cuando rol = ''operador'' … NULL para los otros
-- 4 roles»— y no la impuso en ninguna dirección. Un comentario no es una
-- restricción.
--
-- LO QUE PASABA. En el ensayo del demo, Javier crea al chofer desde
-- `/admin/usuarios/nuevo` con rol «Chofer (operador) — solo sus propios
-- viajes». `provisionarUsuario` escribía `id, tenant_id, email, nombre, rol` y
-- nunca `operador_id`, así que la fila quedaba `rol='operador',
-- operador_id=null` y la base la aceptaba sin objeción. El chofer entra con su
-- magic link, `requireOperador` ve `!s.operadorId` y lo manda a /sin-acceso —
-- la pantalla que dice «pídele a tu proveedor que te dé de alta», justo después
-- de dársela. Si el demo enseña /mis-viajes, se cae ahí.
--
-- Y la dirección contraria también se aceptaba: `rol='contador'` con un
-- `operador_id` pegado por error. Ahí `get_user_operador_id()` filtra por rol y
-- no da acceso de más, pero la columna queda mintiendo sobre lo que significa —
-- y el día que alguien lea `operador_id` sin mirar `rol`, ese es el bug.
--
-- El camino de escritura ya quedó cerrado en la aplicación: `provisionarUsuario`
-- recibe `operador_id`, exige el par y comprueba la pertenencia a la flota
-- contra la base, con prueba. Esto es la segunda capa, la que no depende de que
-- la aplicación se porte bien — el criterio con el que se califica este rubro.
--
-- POR QUÉ EL CHECK NO SE PUEDE VIOLAR POR LA ESPALDA: la FK de la 0050 es
-- `on delete restrict`, así que borrar un `operador` ligado falla en vez de
-- dejar `operador_id` en NULL con `rol='operador'` (que es exactamente lo que
-- el `on delete set null` de la 0045 habría hecho).
--
-- SE APLICA CON RED: antes de crear la restricción se cuentan las filas que ya
-- la violan y se aborta con el número y con el SQL para verlas — un
-- `ADD CONSTRAINT` que falla solo dice «is violated by some row».
--
-- Reversible: `alter table public.app_user drop constraint app_user_operador_id_coherente;`
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 32 de `supabase/verificaciones.sql` la comprueba de verdad.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare n_sin_ligar bigint; n_de_mas bigint;
begin
  select count(*) into n_sin_ligar from public.app_user
   where rol = 'operador' and operador_id is null;
  select count(*) into n_de_mas from public.app_user
   where rol <> 'operador' and operador_id is not null;

  if n_sin_ligar > 0 or n_de_mas > 0 then
    raise exception
      'No se puede aplicar app_user_operador_id_coherente: hay % cuenta(s) con rol=''operador'' SIN operador_id (existen y no pueden entrar a /mis-viajes) y % con operador_id colgado de otro rol. Míralas con: select id, email, rol, operador_id from app_user where (rol = ''operador'') is distinct from (operador_id is not null); Liga las primeras al chofer que les toca y limpia las segundas antes de volver a aplicar.',
      n_sin_ligar, n_de_mas;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_operador_id_coherente'
      and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user
      add constraint app_user_operador_id_coherente
      check ((rol = 'operador') = (operador_id is not null));
  end if;
end $$;

comment on constraint app_user_operador_id_coherente on public.app_user is
  'Las dos mitades de la identidad del chofer se notan a la vez: rol=''operador'' exige `operador_id`, y `operador_id` exige rol=''operador''. Sin esto, la consola creaba cuentas de chofer que existían y no podían entrar a /mis-viajes, con el mensaje "pide tu alta" (0051).';
