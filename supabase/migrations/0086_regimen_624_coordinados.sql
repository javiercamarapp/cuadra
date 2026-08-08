-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 17, CRÍTICO (fiscal) — falta la clave 624 (Coordinados), que es
-- justamente el único régimen de persona moral al que la RFA 2026 regla 2.9 le
-- da la facilidad del 15% de combustible en efectivo.
--
-- La regla dice, literal (ficha normas/rfa-2026-2.9.yaml, verificada contra
-- fuente primaria DOF/SIDOF 5780249):
--
--   «Los contribuyentes personas físicas o morales, dedicados exclusivamente al
--    autotransporte terrestre de carga federal, que tributen conforme al
--    Título II, Capítulo VII o Título IV, Capítulo II, Sección I de la Ley del
--    ISR […] siempre que estos no excedan el 15 por ciento del total de los
--    pagos efectuados por consumo de combustible».
--
-- Título II Capítulo VII de la LISR = Coordinados = clave 624 del catálogo
-- c_RegimenFiscal. La 0056 dejó fuera esa clave y admitió 601 (General de Ley
-- PM), que es el Título II GENERAL, no su Capítulo VII.
--
-- Efecto de la omisión: a un coordinado real no se le podía capturar su régimen
-- (el CHECK lo rechazaba), así que la facilidad que sí le toca quedaba cerrada;
-- y el 601 que no califica la tenía abierta. El código que deriva la
-- elegibilidad se corrige en el mismo commit (administracion.ts).
--
-- 601 NO se retira del dominio: sigue siendo un régimen válido para facturar
-- —una PM de carga puede tributar ahí— y quitarlo rompería a los tenants que ya
-- lo tienen escrito. Lo que cambia es que ya no DERIVA elegibilidad para la 2.9.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenant drop constraint if exists tenant_regimen_fiscal_dominio;
alter table public.tenant add constraint tenant_regimen_fiscal_dominio
  check (regimen_fiscal is null or regimen_fiscal in (
    '601',  -- General de Ley Personas Morales (Titulo II general)
    '603',  -- Personas Morales con Fines no Lucrativos
    '612',  -- Personas Fisicas con Actividades Empresariales y Profesionales
    '621',  -- Incorporacion Fiscal
    '624',  -- Coordinados (Titulo II, Capitulo VII) -- el de la RFA 2.9
    '626'   -- RESICO
  ));

comment on column public.tenant.regimen_fiscal is
  'Clave del catalogo c_RegimenFiscal del SAT. De aqui se DERIVA la elegibilidad '
  'para la facilidad del 15% de la RFA 2026 regla 2.9: solo 624 (Coordinados, '
  'Titulo II Cap. VII) y 612 (PF act. empresariales, Titulo IV Cap. II Sec. I). '
  '601 es el Titulo II general y NO califica.';
