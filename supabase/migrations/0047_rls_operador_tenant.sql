-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — las policies del chofer también filtran por tenant.
--
-- La 0045 escribió:
--
--   create policy operador_ve_su_viaje on public.viaje for select
--     using (operador_id = get_user_operador_id());
--
-- Sin `tenant_id`. Eso asume que `viaje.operador_id` nunca apunta a un chofer
-- de otra flota — cierto hasta que `reasignarOperador` se volvió un botón del
-- panel. Un `operadorId` de otra flota escrito ahí hacía que ESE chofer leyera
-- el viaje, los gastos y la liquidación de una flota ajena
-- (auditoría 10, ALTO de backend).
--
-- El camino de escritura ya quedó cerrado en la aplicación: `reasignarOperador`
-- comprueba la pertenencia antes del UPDATE, con prueba. Esto es la segunda
-- capa, la que no depende de que la aplicación se porte bien — que es
-- literalmente el criterio con el que se califica el rubro de modelo de datos:
-- «si la respuesta es "la aplicación se encarga", es un hallazgo».
--
-- `get_user_tenant_ids()` ya existe (0001) y es el mismo predicado que usa
-- `tenant_data`, así que no se introduce un concepto nuevo.
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 28 de `supabase/verificaciones.sql` la comprueba de verdad.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists operador_ve_su_viaje on public.viaje;
create policy operador_ve_su_viaje on public.viaje for select
  using (operador_id = get_user_operador_id() and tenant_id = any(get_user_tenant_ids()));

drop policy if exists operador_ve_sus_gastos on public.gasto;
create policy operador_ve_sus_gastos on public.gasto for select
  using (
    tenant_id = any(get_user_tenant_ids())
    and viaje_id in (
      select id from public.viaje
      where operador_id = get_user_operador_id()
        and tenant_id = any(get_user_tenant_ids())
    )
  );

drop policy if exists operador_ve_sus_liquidaciones on public.liquidacion;
create policy operador_ve_sus_liquidaciones on public.liquidacion for select
  using (
    tenant_id = any(get_user_tenant_ids())
    and viaje_id in (
      select id from public.viaje
      where operador_id = get_user_operador_id()
        and tenant_id = any(get_user_tenant_ids())
    )
  );

comment on policy operador_ve_su_viaje on public.viaje is
  'Chofer: solo sus viajes Y solo dentro de su tenant (0047). El filtro por tenant no es redundante — `viaje.operador_id` es escribible desde el panel y podía quedar apuntando a un chofer de otra flota.';
