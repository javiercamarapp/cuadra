-- ═══════════════════════════════════════════════════════════════════════════
-- 0052 — sondear un trigger por NOMBRE no distingue el de la 0037 del de la 0042.
--
-- MEDIO de la auditoría 10 (modelo de datos). `triggers_faltantes` (0043)
-- comprueba `t.tgname = e` y nada más. La 0042 hace `drop trigger` +
-- `create trigger` con EL MISMO NOMBRE —`trg_gasto_no_tras_liquidar_update`—
-- cambiando solo el `when`, que es donde entró `fecha`. Una sonda de existencia
-- no puede ver la diferencia entre un objeto y su reemplazo.
--
-- ESCENARIO. La base de producción tiene hoy el trigger de la 0037 (se aplicó
-- en la ronda 8). Se despliega el código de esta ronda y la 0042 no entra —un
-- `db push` cortado, un proyecto nuevo montado el 5-ago—.
-- `triggers_faltantes(['trg_gasto_no_tras_liquidar',
-- 'trg_gasto_no_tras_liquidar_update'])` devuelve `{}` porque los dos nombres
-- existen, el arranque escribe `{ok: true}`, y un
-- `UPDATE gasto SET fecha = '2026-08-02' WHERE id = …` posterior a la
-- liquidación vuelve a pasar sin `CU001`: exactamente el ALTO de la ronda 9,
-- con el sistema afirmando por escrito que está cerrado. El contralor puede ver
-- un desglose fiscal que contradice el PDF archivado, con el arranque en verde.
--
-- LO QUE HACE ESTA FUNCIÓN. Recibe pares `{nombre: fragmento}` y devuelve los
-- nombres cuyo `pg_get_triggerdef()` NO contiene su fragmento — lo que incluye,
-- gratis, los que no existen. Mira el CUERPO, no el nombre, que es lo único que
-- distingue una migración de su reemplazo.
--
-- Se compara en minúsculas porque `pg_get_triggerdef` normaliza a su manera y
-- el fragmento lo escribe una persona en TypeScript.
--
-- `triggers_faltantes` (0043) NO se dropea: sigue siendo la sonda correcta para
-- un trigger sin `when` (donde no hay cuerpo que distinguir) y el bloque 25 de
-- verificaciones.sql la ejercita. Lo que cambia es que el arranque deja de
-- apoyarse SOLO en ella para los dos triggers del dinero.
--
-- Mismo criterio de permisos que la 0043: solo lectura, `security definer` para
-- poder mirar el catálogo, `search_path` fijo (0035/0049), y ejecutable
-- únicamente por `service_role` — la sonda corre desde el servidor, nunca desde
-- una sesión del panel.
--
-- Reversible: `drop function public.triggers_desactualizados(jsonb);`
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 33 de `supabase/verificaciones.sql` la comprueba de verdad.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.triggers_desactualizados(p_esperados jsonb)
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    array_agg(e.key order by e.key) filter (
      where not exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and t.tgname = e.key
          and not t.tgisinternal
          and position(lower(e.value) in lower(pg_get_triggerdef(t.oid))) > 0
      )
    ),
    '{}'::text[]
  )
  from jsonb_each_text(p_esperados) as e(key, value);
$$;

comment on function public.triggers_desactualizados(jsonb) is
  'Devuelve cuáles de los triggers esperados NO existen O existen con un cuerpo que no contiene el fragmento declarado. Solo lectura. Existe porque `triggers_faltantes` sonda por nombre y una migración que REEMPLAZA un trigger conservando su nombre (0042 sobre 0037) es indetectable así: el arranque decía {ok:true} sobre una base donde el UPDATE de `gasto.fecha` tras liquidar volvía a pasar sin CU001. Ver src/lib/cuadra/startup.ts.';

revoke all on function public.triggers_desactualizados(jsonb) from public, anon, authenticated;
grant execute on function public.triggers_desactualizados(jsonb) to service_role;
