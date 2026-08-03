-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — cierra la RLS del chofer sobre las 4 tablas que la 0045 dejó abiertas.
--
-- La 0045 excluyó a `operador` de `tenant_data` en viaje, gasto y liquidacion,
-- y dejó las otras cuatro con esta nota: «las otras 4 tablas de `tenant_data`
-- (terminal, politica_gasto, wa_conversacion — y `operador` misma) no cambian:
-- el chofer no tiene vista de esas».
--
-- «No tiene vista» es un argumento de UI, y la RLS no está para defender la UI:
-- está para defender la base de un token que no pasa por el navegador. La
-- policy `tenant_data` de la 0001 es `for all` —lectura Y ESCRITURA— para
-- cualquier `app_user` del tenant, sin mirar el rol. Con su sesión web, un
-- chofer conservaba contra el endpoint REST:
--
--   · `politica_gasto`  UPDATE — subirse su propio tope de diésel. Es dinero:
--                       el motor de cuadre lee esa tabla para decidir qué gasto
--                       sale «sobre política».
--   · `wa_conversacion` SELECT — las conversaciones de WhatsApp de TODOS sus
--                       compañeros de flota. Datos personales de terceros.
--   · `operador`        UPDATE — cambiar el teléfono de otro chofer, que es la
--                       identidad con la que el sistema lo reconoce.
--   · `terminal`        UPDATE — mover las terminales de la flota.
--
-- (auditoría 10, CRÍTICO de seguridad.)
--
-- No se agrega policy de reemplazo, al revés que la 0045: el panel del chofer
-- (`src/app/mis-viajes/page.tsx`) solo consulta `viaje` con `liquidacion`
-- anidada, las dos ya cubiertas. Verificado antes de escribir esto. Si algún
-- día necesita leer su propia fila de `operador`, se agrega una policy de
-- SELECT scoped con `get_user_operador_id()`, como hizo la 0045 — no se le
-- devuelve `for all`.
--
-- Su vía de ESCRITURA sigue intacta: WhatsApp entra con service_role, que no
-- pasa por RLS. Esta migración no toca ese camino.
--
-- ⚠️  VERIFICAR ANTES DE CONFIAR: esta migración se escribió sin una base
--     contra la cual ejercerla. El bloque 27 de `supabase/verificaciones.sql`
--     la comprueba de verdad y debe correrse después de aplicarla.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['terminal', 'operador', 'politica_gasto', 'wa_conversacion']
  loop
    execute format('drop policy if exists tenant_data on %I', t);
    execute format($p$
      create policy tenant_data on %I for all
      using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
      with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

comment on policy tenant_data on public.politica_gasto is
  'Excluye rol=operador (0046). Con `for all` el chofer podía SUBIRSE su propio tope de gasto, y el motor de cuadre lee esta tabla para decidir qué sale sobre política.';

comment on policy tenant_data on public.wa_conversacion is
  'Excluye rol=operador (0046). Con `for all` el chofer leía las conversaciones de WhatsApp de todos sus compañeros de flota.';
