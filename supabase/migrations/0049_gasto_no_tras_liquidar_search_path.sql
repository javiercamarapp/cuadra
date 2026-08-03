-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — `gasto_no_tras_liquidar()` fija su `search_path`.
--
-- BAJO REINCIDENTE de las rondas 8, 9 y 10 (seguridad). Es la ÚNICA función de
-- `public` sin `proconfig`: la 0035 fijó las otras diez y es ANTERIOR a la
-- 0036, así que no pudo alcanzarla. La 0037 y la 0042 volvieron a tocar los
-- triggers que la usan —la 0042 se escribió precisamente para arreglar el ALTO
-- de la ronda 9— y las dos tuvieron la línea a la vista y no la pusieron.
--
-- QUÉ PERMITE. La función es la barrera de «nada entra tras liquidar», el
-- arreglo de lo que la 0036 llama en su propio comentario «el peor bug
-- histórico del camino del dinero». Su cuerpo hace dos consultas sin calificar
-- el esquema:
--
--     perform 1 from viaje where id = new.viaje_id for update;
--     select exists (select 1 from liquidacion where viaje_id = new.viaje_id);
--
-- Bajo un `search_path` con otro esquema delante de `public`, el `select
-- exists` lee una tabla SOMBRA —vacía— y devuelve `false`: el gasto tardío
-- entra, sin `CU001`, y el PDF archivado y el WhatsApp del operador vuelven a
-- decir cifras contrarias del mismo viaje.
--
-- POR QUÉ SIGUE SIENDO BAJO, y se dice completo: hoy nadie que llegue por
-- PostgREST puede crear esa sombra —`has_schema_privilege('anon','public',
-- 'CREATE') = false`, medido en el barrido del 31-jul—. Lo que se reporta no es
-- una explotación disponible, es que la migración escrita para arreglar esta
-- función tuvo la línea delante tres rondas seguidas.
--
-- CÓMO. `create or replace` con la MISMA firma y el MISMO cuerpo (calificado
-- con `public.`, que es cinturón además del tirante), más
-- `set search_path = public, pg_catalog` — el mismo criterio de la 0035. Los
-- dos triggers (`trg_gasto_no_tras_liquidar` de la 0036 y
-- `trg_gasto_no_tras_liquidar_update` de la 0037/0042) siguen apuntando a esta
-- función por nombre: `create or replace` NO los toca ni los invalida, así que
-- esta migración no recrea ningún trigger a propósito.
--
-- Reversible: `alter function public.gasto_no_tras_liquidar() reset search_path;`
-- (el cuerpo calificado se puede dejar: no cambia el comportamiento).
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 30 de `supabase/verificaciones.sql` la comprueba de verdad —
--     mira `pg_proc.proconfig`, que es lo único que lo sabe.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.gasto_no_tras_liquidar()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare ya boolean;
begin
  -- Serializa contra el cierre. No se usa el valor: se usa el candado.
  perform 1 from public.viaje where id = new.viaje_id for update;

  select exists (select 1 from public.liquidacion where viaje_id = new.viaje_id) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: el gasto llegó tarde', new.viaje_id
      using errcode = 'CU001';
  end if;
  return new;
end $$;

comment on function public.gasto_no_tras_liquidar() is
  'Impide agregar gastos a un viaje cuya liquidación YA se emitió. Sin esto, una foto que entra entre el cálculo del PDF y el del texto hace que los dos digan cifras distintas y de signo contrario, y el gasto queda huérfano. Ver 0036. `search_path` fijo desde la 0049: sin él, un esquema sombra delante de `public` hacía que el `select exists` leyera otra tabla `liquidacion` y el gasto tardío pasara.';
