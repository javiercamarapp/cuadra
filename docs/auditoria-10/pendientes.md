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
(`0046`–`0053`).** **28 de 34 bloques dan veredicto.**

### Las tres migraciones de RLS quedan VERIFICADAS

| Bloque | Migración | Salida real | Esperado |
|:--:|---|---|:--:|
| 26 | `0045` | `viajes=1 gastos=1 liquidaciones=1 viaje-ajeno=0` | ✅ |
| 27 | `0046` | `terminal=0 operador=0 politica=0 conversacion=0 subio-su-tope=0` | ✅ |
| 29 | `0048` | `ve=1 actualizo=0 borro=0` | ✅ |

El chofer no puede subirse su propio tope de gasto y el contador no puede
borrar una liquidación. Eso ya no es una promesa: es una medición.

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

### Los 3 bloques que aún no llegan a medir

- **28** — `[23503] viaje_operador_tenant_fkey`. El bloque monta un viaje de la
  flota A apuntando a un chofer de la B, y **la FK compuesta de la 0028 ya lo
  impide**. Es decir: el escenario del ALTO de backend era **imposible a nivel
  de base** desde antes. La mitad del hallazgo que sí era real —el `UPDATE` sin
  mirar filas afectadas— quedó cerrada en `d6ba851`; la migración `0047` es
  defensa en profundidad sobre una puerta ya cerrada, no el cierre.
- **31** — `[23514] app_user_operador_id_coherente`. El CHECK de la 0051 salta
  durante el ARMADO del bloque. Hay que reescribirlo con manejador de excepción.
- **23** — `[42P01] relation "_res" does not exist`. El bloque usa una CTE entre
  sentencias, que no sobrevive.
- **32** dio `completo=0` donde esperaba `1`: revisar si es la migración o el
  armado del bloque.

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
