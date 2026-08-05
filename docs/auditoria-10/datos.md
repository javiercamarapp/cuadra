# Modelo de datos y esquema — auditoría 10

**Nota: 7/10** (igual que ronda 9). La vara: ¿el esquema puede sostener, sin
que nadie lo esté mirando, las tres garantías que este producto vende —el PDF
archivado y lo que hay en `gasto` dicen lo mismo para siempre, ningún tenant
ve dinero de otro, y toda migración nueva se comprueba contra Postgres real
antes de darla por buena—? 10 = las tres se sostienen incluso si el código de
aplicación tiene un bug. 7 = se sostienen, pero el proceso que las mantiene
tuvo que autocorregirse esta misma ronda. 4 = una de las tres tiene un hueco
conocido y sin blindaje. 1 = el esquema no coincide con lo que hay en
producción y nadie se dio cuenta.

Anclado a `c658f6a397d7a392b8b3153f7f8cedc0971400ba` (`git rev-parse HEAD` al
empezar). Verificado contra el proyecto real de Supabase (`gngoqsvrxdguxvsizpbw`,
Likida, `ACTIVE_HEALTHY`) vía MCP, no solo leyendo migraciones — el mismo
estándar que pide este rubro. **La base de producción está prácticamente
vacía**: `tenant=0`, `gasto=0`, `viaje=0`, `factura_saas=0` (antes de mi
arreglo); solo `app_user=1`, `bitacora_auditoria=3` y `plan=3` tienen filas.
Esto importa para el primer hallazgo.

## Hallazgos

### [DESCARTADO] "`ocr_confianza` salió 0.950 idéntico en ocho gastos examinados" — no se sostiene, y no es materialmente posible que se haya examinado eso

El dato que esta ronda me pidió verificar no se sostiene. Consulté la tabla
`gasto` del proyecto real de Likida vía MCP (`select count(*) from gasto`):
**cero filas**. Ampliando a las 39 tablas de `public`, solo tres tienen
contenido (`app_user`, `bitacora_auditoria`, `plan`); ninguna tabla de negocio
(`tenant`, `viaje`, `gasto`, `liquidacion`, `factura_saas`) tiene una sola
fila. Es materialmente imposible haber examinado ocho gastos reales con
`ocr_confianza` — no existe ni uno.

Verifiqué también el código, por si la cifra viniera de una constante
escondida y el "ocho gastos" fuera una forma imprecisa de describir una
corrida de pruebas: no la hay. `src/lib/cuadra/intake/ocr.ts:385`
(`ocrConfianza: data.confianza`) toma el valor del JSON que devuelve el
modelo de visión (`generateStructured({ role: 'ocr', ... })`,
`src/lib/llm/openrouter.ts`), con el campo `confianza: z.number().min(0).max(1)`
(`ocr.ts:63`) y una instrucción explícita en el prompt (`ocr.ts:96`: *"confianza
= qué tan seguro estás de haber leído bien el monto y el folio (0 a 1)"*). El
único `catch` de esa función devuelve `ocrConfianza: 0` en fallo técnico
(`ocr.ts:277`), nunca 0.95. No hay ningún `0.95`/`0.950` en código de
producción; sí aparece repetido en *fixtures* de prueba (`processor_cadena.test.ts:57,73`,
`arnes_ticket_real.test.ts:204`, `engine.test.ts:17`, `cuadre/*.test.ts`, una
decena de archivos más) y el demo determinístico usa `0.96` por defecto
(`src/app/api/demo/route.ts:39`), no `0.95`.

**Lectura correcta.** El mecanismo de confianza no está roto — la escalera de
`escalar_viaje.ts` y `al_vuelo.ts` sí recibiría una medición real del modelo
el día que haya gastos reales que medir. Lo que hay que corregir es la
afirmación de esta ronda: "ocho gastos examinados" describe datos que no
existen en la base real. Lo más probable es que se haya leído un *fixture* de
prueba (que sí repite 0.95 muchas veces, porque son valores de ejemplo
escritos a mano) y se haya reportado como si fuera una medición contra datos
reales — exactamente la clase de error que CLAUDE.md prohíbe ("nunca inventar
una cifra"), aquí a nivel de la propia auditoría, no del producto.

### [CRÍTICO, encontrado y arreglado esta ronda] Dos migraciones sin commitear compartían el número `0065` — la colisión apagaba en silencio el candado que obliga a comprobar cada migración nueva

`supabase/migrations/0065_cfdi_de_varias_casetas.sql` y
`supabase/migrations/0065_iva_de_la_mensualidad.sql` (ambas sin commitear,
escritas por agentes distintos el mismo día, `ls -la` con 6 minutos de
diferencia) compartían el prefijo `0065`. `src/lib/cuadra/migraciones_verificadas.test.ts:78`
indexa cada migración por `f.slice(0, 4)` — los 4 primeros caracteres del
nombre de archivo — y comprueba que ese número tenga bloque en
`supabase/verificaciones.sql` o una razón en `EXENTAS`. Con dos archivos
compartiendo la llave `"0065"`, el título del bloque 44
(`verificaciones.sql:2222`, *"...mig. 0065"*, que sí prueba `cfdi_de_varias_casetas`)
le prestaba cobertura FALSA a `iva_de_la_mensualidad`: el test pasaba en
verde (`4 passed`, lo corrí antes de tocar nada) sin que ninguna de las tres
`CHECK` que introduce esa migración —`factura_saas_desglose_coherente`,
`_no_negativo`, `_cuadra`— se hubiera probado nunca contra Postgres real. Es
justo la clase de fuga que ese test existe para atrapar (la migración 0030 se
coló así, según su propio comentario), y la colisión numérica lo desactivaba
sin que `npx vitest run` lo mostrara.

**Por qué era alcanzable.** Confirmé contra el proyecto real (`list_migrations`
vía MCP) que `cfdi_de_varias_casetas` YA estaba aplicada a producción
(versión `20260805042253`) y que su contenido coincide exacto con el archivo
local (columnas `cfdi_orden`, `autofactura_bloqueada_en`/`_bloqueo`, e índices
`uq_gasto_cfdi_uuid`/`gasto_por_facturar_idx` verificados uno por uno contra
`information_schema` y `pg_indexes`). `iva_de_la_mensualidad` en cambio NUNCA
se había aplicado (`factura_saas` no tenía columnas `subtotal`/`iva`, `plan`
no tenía `precio_iva_incluido`). Ambas están además detrás de código YA
escrito que las consume (`al_vuelo.ts`, `pendientes.ts`, `cron/facturar/route.ts`
para la de CFDI; `suscripcion.ts`, `transferencia.ts` para la del IVA) — no es
trabajo muerto, es una carrera real entre dos features que llegaron al mismo
número.

**Arreglo.** Renombré `0065_iva_de_la_mensualidad.sql` →
`0066_iva_de_la_mensualidad.sql` (0066–0069 estaban libres; verifiqué que
ninguna de las migraciones ya numeradas 0070–0075 referencia columnas de
ninguna de las dos 0065, así que el renombre no reordena nada), actualicé su
encabezado interno de "0065 —" a "0066 —" y dejé una nota explicando la
colisión. Apliqué la migración 0066 a producción vía MCP (aditiva y segura:
`plan` tenía 3 filas que solo ganan una columna nullable, `factura_saas`
tenía 0) y escribí el bloque 45→**51** de `verificaciones.sql` (los números
45–50 ya estaban tomados por otros agentes reconciliando 0070–0075 esta misma
ronda) que prueba las tres `CHECK` contra Postgres real. Salida real,
corrida y confirmada:

```
51  desglose-a-medias-rechazado=t  negativo-rechazado=t
    descuadrado-rechazado=t  borde-de-tolerancia-acepta=t  exacto-acepta=t
    (esperado t/t/t/t/t)
```

y confirmé que la transacción se revirtió sola (`select count(*) from tenant
where nombre like 'ZZZ VERIF%'` → 0 filas). `npx vitest run
src/lib/cuadra/migraciones_verificadas.test.ts` vuelve a pasar (4/4), esta vez
por cobertura real y no por colisión — si alguien borra el bloque 51, el test
vuelve a fallar, que es el comportamiento correcto.

### [MEDIO, documentado, no arreglado] `0070_montos_no_negativos.sql`, `0071_indices_de_borrado.sql` y `0072_purga_y_consolidado_ia.sql` traen en su propio encabezado los números `0065`, `0066` y `0067`

Sus nombres de archivo son 0070/0071/0072, pero la primera línea de cada uno
dice *"0065 — Las dos columnas..."*, *"0066 — Borrar una flota..."*, *"0067 —
Nada se purgaba..."* respectivamente. Es evidencia de que hubo un tercer y
cuarto intento de usar 0065/0066/0067 el mismo día (probablemente el propio
agente de datos de esta ronda, escribiendo secuencialmente), que alguien
renumeró a 0070+ para esquivar la colisión que este documento arregla, sin
volver a tocar el texto interno. No lo corregí: son tres archivos con
contenido ya aplicado a producción y ya cubiertos por bloques 45/46/47 de
`verificaciones.sql`, y hay otras sesiones reconciliando este mismo repo
ahora mismo — el riesgo de pisar su trabajo por un cambio cosmético no
compensa el beneficio. Queda para quien toque esos archivos de nuevo.

## Lo que ya está bien

- **El ALTO de la ronda 9 (el `when` de la 0037 no incluía `fecha`) está
  genuinamente cerrado, verificado en dos lugares.** `supabase/migrations/0042_gasto_fecha_no_tras_liquidar.sql`
  agrega `fecha` al `when` del mismo trigger, y confirmé contra el catálogo
  real (`pg_trigger` del proyecto Likida) que `trg_gasto_no_tras_liquidar_update`
  en producción YA incluye `new.fecha IS DISTINCT FROM old.fecha`. El bloque 24
  de `verificaciones.sql` (que ronda 9 pedía como pendiente) existe y prueba
  exactamente el escenario del hallazgo: un `UPDATE ... SET fecha` tras
  liquidar rebota con `CU001`, y una columna no financiera (`clave_prod_serv`)
  sigue pasando como control.
- **Las trampas de columnas muertas/vivas que documenta `CLAUDE.md` siguen
  vigentes, verificadas contra el catálogo real, no releídas de memoria:**
  `gasto.ocr_raw` existe pero no se usa (confirmado: la columna está, el
  código escribe `ocr_confianza`/`ocr_extra`); `politica_gasto` existe como
  tabla muerta; `wa_mensaje_procesado` sigue sin `tenant_id`;
  `viaje_estatus_dominio` sigue como constraint; `cliente`, `viaje.km_recorridos`
  y `viaje.ingreso_flete` existen (vacías, como dice la nota corregida el
  4-ago).
- **El invariante "el esquema del repo = el esquema de producción" —crítico
  en ronda 5, cerrado en ronda 6— sigue sosteniéndose en el fondo**, con un
  matiz: diff nombre por nombre entre las 72 migraciones aplicadas
  remotamente y las 72 (ahora 72, tras mi renombre) locales encontró solo dos
  discrepancias de NOMBRE, ninguna de CONTENIDO — `comprobante_huerfano_ofrecido_en`
  (aplicada aparte, pero el local `0040_comprobante_huerfano.sql` ya incluye
  la columna `ofrecido_en` en el `CREATE TABLE`, confirmado contra
  `information_schema`) y `aviso_y_aceptacion_de_viaje`/`0058_confirmacion_de_viaje.sql`
  (mismo caso, y el propio archivo local documenta honestamente que se
  reconstruyó leyendo el esquema real tras detectar que faltaba — confirmé
  las cuatro columnas y la constraint que describe contra `viaje` real). Es
  el mismo patrón de fuga de la ronda 5 (aplicar por MCP antes de escribir el
  archivo) recurriendo en miniatura, pero esta vez autodetectado y
  documentado en vez de perdido en silencio.
- **`0070_montos_no_negativos.sql` (`gasto.monto >= 0`, `viaje.anticipo >= 0`)
  ya está aplicada a producción y verificada contra el catálogo real** —
  cierra el hueco que dejaban `gasto.monto`/`viaje.anticipo` sin piso, con
  monto `-99999` entrando antes.

## Lo que NO alcancé a revisar

- **No repetí el barrido completo de RLS/permisos de las migraciones 0044-0075**
  contra `anon`/`authenticated` (bloque 18 de `verificaciones.sql`, que es
  del 31-jul) — esta ronda el presupuesto se fue en el hallazgo del OCR y la
  colisión 0065. Es del rubro de seguridad tanto como del mío; lo dejo para
  no duplicar.
- **`wa_conversacion` sin normalizar y `gasto.fecha` nullable sin CHECK** —
  los dos MEDIOS reincidentes de ronda 8, confirmé rápido que `gasto.fecha`
  sigue `nullable` sin `CHECK` asociado, pero no volví a armar el escenario
  completo de daño esta ronda.
- **El bucket `liquidaciones` de Storage y sus policies** — mismo pendiente
  arrastrado desde ronda 5, sin tocar.
- **`round2()` reimplementado en cuatro archivos de dinero** — es de
  arquitectura, no lo dupliqué aquí.
- **Los otros diez archivos nuevos de `supabase/migrations/` (0043-0075
  salvo los ya nombrados) no se auditaron línea por línea** — sí verifiqué
  contra Postgres real las piezas que tocan este reporte (0042, 0058, 0065,
  0066, 0070, `comprobante_huerfano`), pero no cada `CHECK`/índice de las
  ~30 restantes. Cada una trae su propio bloque en `verificaciones.sql`
  (45-50), escrito hoy por otro agente; no re-corrí esos bloques.
