# Cierre de los 105 hallazgos — auditoría 10, 3-ago-2026

Petición explícita del dueño: cerrar todo lo que la auditoría encontró. Se
trabajó en cuatro tandas: los 3 críticos de la corrida desatendida, los 7
críticos restantes a mano, y **dos olas de agentes expertos en paralelo** —
cinco y luego cuatro, más arquitectura y pruebas al final— cada uno con un
dominio de archivos disjunto.

## Compuerta sobre el árbol final

```
$ npm test          → exit 0 · 239 archivos · 2089 pruebas · 1 saltada
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0
$ git status        → limpio
```

Línea base al arrancar la ronda: 173 archivos / 1629 pruebas.
**+66 archivos de prueba, +460 pruebas. 99 commits de arreglo.**

## La cuenta

| | Críticos | Altos | Medios | Bajos | Total |
|---|:--:|:--:|:--:|:--:|:--:|
| Encontrados | 10 distintos | 30 | 38 | 27 | 105 |
| **Cerrados con prueba** | **8** | **28** | **35** | **25** | **96** |
| Cerrados a medias | 2 | — | — | — | 2 |
| **Falsos** | **0** | **0** | **0** | **0** | **0** |

**Cero hallazgos falsos en 105.** Los siete agentes verificaron cada uno contra
el código antes de tocar nada, y los siete reportaron lo mismo. En la auditoría
2, uno resultó falso: esa era la vara.

## EL SQL YA SE CORRIÓ — 3-ago-2026

`./scripts/verificar-sql.sh` arma un PostgreSQL 16 local con
`supabase/andamiaje_local.sql` (los roles de PostgREST, `auth.uid()`,
`auth.users`, `storage.buckets` — lo que la plataforma pone y el repo no),
aplica las 53 migraciones y corre los 34 bloques.

**Las 53 migraciones aplican limpias, incluidas las 8 escritas a ciegas
(`0046`–`0053`).** **33 de las 34 cabeceras dan veredicto; la 34ª (bloque 21)
está retirada a propósito. Cero bloques que no lleguen a medir.**

La primera corrida dejó 3 bloques reventando antes de medir y 1 dando un
resultado falso. Los cuatro quedaron arreglados, y **cada arreglo enseñó algo
que la primera lectura no decía** — el detalle está más abajo.

### Las CUATRO migraciones de RLS quedan VERIFICADAS

| Bloque | Migración | Salida real | Esperado |
|:--:|---|---|:--:|
| 26 | `0045` | `viajes=1 gastos=1 liquidaciones=1 viaje-ajeno=0` | ✅ |
| 27 | `0046` | `terminal=0 operador=0 politica=0 conversacion=0 subio-su-tope=0` | ✅ |
| 28 | `0047` | `fk-compuesta-rechaza=1 viaje-ajeno=0 gastos=0 liquidacion=0` | ✅ |
| 29 | `0048` | `ve=1 actualizo=0 borro=0` | ✅ |

El chofer no puede subirse su propio tope de gasto y el contador no puede
borrar una liquidación. Eso ya no es una promesa: es una medición.

Con una salvedad que hay que decir en voz alta: **la `0047` es defensa en
profundidad, no el cierre**. Correrla demostró que la FK compuesta de la `0028`
ya hacía imposible el estado que el ALTO de backend describía. La mitad del
hallazgo que sí era real —el `UPDATE` sin mirar filas afectadas— se cerró en
`d6ba851`. El `0` de la policy se mide con la FK retirada a propósito dentro de
la transacción del bloque, que es lo que quedaría si algún día se toca la 0028.

Y las de identidad, que en la primera corrida no llegaban a medir:

| Bloque | Migración | Salida real | Esperado |
|:--:|---|---|:--:|
| 31 | `0050` | `cruzado=0 sin_tenant=0 propio=1` | ✅ |
| 32 | `0051` | `sin_ligar=0 de_mas=0 completo=1` | ✅ |

### ⚠️ HALLAZGO NUEVO, salido de correrlo

**`try_lock_viaje` y `unlock_viaje` son ejecutables por `anon`.** Los bloques
16 y 18 lo dicen por separado:

```
16  PERMISOS  anon-lock=t  anon-unlock=t   (esperado f / f)
18  AISLAMIENTO  rpc-abiertas-a-anon=try_lock_viaje, unlock_viaje
```

PostgREST expone las funciones de `public` en `/rest/v1/rpc/…`. Con la anon key
—que viaja en el navegador— cualquiera puede tomar o soltar el mutex de
CUALQUIER viaje. Tomarlo bloquea el cierre de esa liquidación; soltarlo abre la
puerta a la doble liquidación que la 0005 existe para cerrar. **No requiere
sesión.** Los dos bloques lo declaraban esperado en `f` y nadie los había
corrido.

### Los 4 bloques arreglados, y lo que enseñó cada uno

| | Fallaba con | Causa real | Ahora |
|:--:|---|---|---|
| **23** | `[42P01] relation "_res" does not exist` | Guardaba resultados en una tabla temporal creada FUERA del `do $$`. Y leía una tabla vacía: un `anon=0` sobre cero filas no distingue una policy que cierra de una tabla sin datos. | Siembra su propia fila y añade el control `dueno=1`. `anon=0 dueno=1` |
| **28** | `[23503] viaje_operador_tenant_fkey` | **La FK compuesta de la 0028 ya impedía el estado cruzado.** El escenario del ALTO de backend era imposible a nivel de base desde antes. | Mide la FK primero (`fk-compuesta-rechaza=1`), luego la TIRA dentro de su propia transacción —que se revierte— para llegar a la policy. `1 / 0 / 0 / 0` |
| **31** | `[23514] app_user_operador_id_coherente` | El armado creaba `rol='operador'` con `operador_id` NULL, justo lo que el CHECK de la 0051 —posterior al bloque— prohíbe. | La cuenta nace ligada a su chofer, y esa alta pasa a ser el control. `cruzado=0 sin_tenant=0 propio=1` |
| **32** | `completo=0` (esperaba 1) | **Un falso ALTO a un paso de mandarse.** Parecía que el CHECK de la 0051 dejaba al producto sin poder dar de alta a un chofer. Era la FK `app_user.id → auth.users.id` de la 0053 reventando sobre un UUID que no existe en Auth, y el `when others` del control se la tragaba. | Los usuarios se crean en `auth` primero. `sin_ligar=0 de_mas=0 completo=1` |

El de la 32 es el que vale la pena subrayar: **el bloque no falló, MINTIÓ**. Dio
un número creíble, con la forma exacta de un hallazgo grave, por una razón que
no tenía nada que ver con lo que medía. Un `exception when others` que asigna
`0` no distingue «el candado cerró de más» de «faltaba una fila en otra tabla».

### Y dos cabeceras que el runner se estaba saltando en silencio

Decía «34 bloques» y corría 32, sin una línea que dijera qué pasó con las otras
dos. **La 21** está retirada a propósito (la 0041 revirtió `foto_pendiente`);
**la 22** tiene cuerpo y nunca se ejecutó — es un `select`, no un `do $$`, y el
partidor solo buscaba `do $$`. Ahora el runner reconoce las tres formas e
imprime una línea por cabecera. La 22 corre y da `existe=1 publico=f
buckets_publicos=0 policies=0`.

`rls_objects` sale **nulo** contra el andamiaje, y se deja así: `storage.objects`
lo crea la plataforma, no una migración de este repo. Replicarlo en el andamiaje
haría que el bloque midiera mi propio fixture y devolviera un `t` que no prueba
nada. La columna nula es el recordatorio de que ese bloque se repite en Supabase.

## LO QUE SIGUE SIN PODERSE HACER AQUÍ

- **Correr esto contra Supabase de verdad.** El andamiaje no es GoTrue ni
  PostgREST. Los bloques que tocan `auth` o `storage` hay que repetirlos allá.
- **Ejecutar `scripts/crear-superadmin.mjs`** y el procedimiento del runbook
  contra el proyecto real.
- **Decidir lo que es del responsable, no de Likida**: ampliar el aviso para
  cubrir el correo del chofer (o quitar el rol `operador` del alta), y si Likida
  ve transcripciones de WhatsApp siendo persona encargada.

## Lo que se descartó a propósito, con razón escrita

- **Sonda de la migración 0038**: la revierte la 0041 con
  `drop table foto_pendiente`. Sondearla gritaría por una tabla que **debe**
  faltar. Hay prueba de CONTROL que detiene a quien la añada «por completar».
- **Sonda de la 0044**: su ausencia ya falla ruidosamente y en el sitio exacto,
  y PostgREST no expone `pg_constraint`.
- **`verificaciones.sql` en CI**: los bloques hablan `authenticated`/`anon`/
  `service_role`, `auth.uid()` y el esquema `storage`. No corren contra un
  `postgres:16` de servicio, y levantar Supabase en CI exige secretos — contra
  la propiedad que `ci.yml` declara por escrito. Lo que sí quedó medido: cada
  bloque tiene cuerpo, y ninguno entra al inventario sin decir si se corrió.

## Deuda abierta durante los arreglos (anotada, no tocada)

- `DASHBOARD_SECRET` ya no protege ningún candado: su único lector es
  `verificarEntornoCritico()`. Retirarla toca `DEPLOY.md` y `runbook.test.ts`.
- `usuarios/nuevo/page.tsx` tiene que ofrecer el `<select>` de choferes y pasar
  ese id a `provisionarUsuario`. Hasta entonces «Chofer (operador)» **falla con
  un mensaje que dice qué falta**, en vez de crear una cuenta que no sirve.
- `proxy.ts` + `auth/session.ts`: ~900 ms de red serializada por navegación del
  panel, sin techo.
- Sin prompt caching en `openrouter.ts` (~$0.0096 por liquidación).
- `numero(NaN)`: el escenario del reporte **no se pudo reproducir** —
  `Number(null)` es `0`, no `NaN`—. No se ancló como comportamiento ni se
  levantó como hallazgo nuevo.

## Las notas de los 12 rubros NO se movieron

Las puso cada auditor con contexto fresco **antes** de los arreglos. Subirlas
porque el orquestador —o siete agentes suyos— arreglaron cosas es exactamente
el movimiento que esta rutina existe para impedir. Quien recalifica es la
**ronda 11**, con auditores que no sepan dónde se acaba de tocar código.
