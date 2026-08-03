-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — «Contador — solo lectura y exportar» deja de ser solo una etiqueta.
--
-- La consola de superadmin ofrece el rol así, literal
-- (`admin/usuarios/nuevo/page.tsx:11`):
--
--     { valor: 'contador', etiqueta: 'Contador — solo lectura y exportar' }
--
-- `permisos.ts` lo respeta en la APLICACIÓN (`ADMINISTRA` y `ASIGNA` no lo
-- incluyen), pero la base decía lo contrario: `tenant_data` es `for all`
-- —lectura Y escritura— para todo rol que no sea `operador`. «Solo lectura» no
-- existía en ningún lado salvo en el texto del `<select>`
-- (auditoría 10, ALTO de seguridad).
--
-- Escenario medido por el auditor: Marisol, contadora externa, con su sesión
-- legítima del panel:
--
--     DELETE /rest/v1/liquidacion?id=eq.<uuid>
--     Authorization: Bearer <su access token>          → 204
--
-- La liquidación desaparece del panel, del CSV y del PDF. Un contador externo
-- es justamente el perfil al que se le da acceso «para que revise», y el que
-- más flotas distintas toca.
--
-- Se recrea `tenant_data` sobre las SIETE tablas (supersede a la 0045 y a la
-- 0046, que ya la habían recreado sobre 3 y 4 respectivamente) con el
-- predicado completo, y se le da al contador una policy de SOLO SELECT.
--
-- Escribir sigue siendo de superadmin / flota_admin / encargado. El chofer
-- sigue fuera de las siete, con sus tres policies de lectura scoped (0045+0047).
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: escrita sin una base contra la cual ejercerla.
--     El bloque 29 de `supabase/verificaciones.sql` la comprueba de verdad.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_contador()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_user where id = auth.uid() and rol = 'contador');
$$;

do $$
declare t text;
begin
  foreach t in array array['terminal', 'operador', 'politica_gasto', 'viaje', 'gasto', 'liquidacion', 'wa_conversacion']
  loop
    execute format('drop policy if exists tenant_data on %I', t);
    execute format($p$
      create policy tenant_data on %I for all
      using ((tenant_id = any(get_user_tenant_ids()) and not is_operador() and not is_contador()) or is_superadmin())
      with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador() and not is_contador()) or is_superadmin())
    $p$, t);

    execute format('drop policy if exists contador_lee on %I', t);
    execute format($p$
      create policy contador_lee on %I for select
      using (tenant_id = any(get_user_tenant_ids()) and is_contador())
    $p$, t);
  end loop;
end $$;

comment on policy contador_lee on public.liquidacion is
  'El contador LEE y no escribe (0048). La consola lo ofrece como "solo lectura y exportar"; antes de esta migración eso solo era cierto en la etiqueta del <select>, y un DELETE por REST con su propio token devolvía 204.';
