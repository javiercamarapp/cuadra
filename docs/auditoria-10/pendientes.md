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

## LO QUE HAY QUE HACER ANTES DEL 6-AGO

Esto no lo cierra ninguna prueba de este repo.

### 1. Correr los bloques de `supabase/verificaciones.sql`

**Ocho migraciones nuevas (`0046`–`0053`) están escritas y NUNCA ejercidas.**
Aquí no hay base de datos. Sus arneses de TypeScript comprueban propiedades
**estructurales del SQL** —y cada uno lo declara en su cabecera—, no que la
policy funcione.

De los 34 bloques del archivo, **solo 9 tienen salida real copiada. 24 están
escritos y nunca se han corrido**, entre ellos:

- **26** — el chofer no ve el dinero de toda la flota
- **29** — el contador lee y no escribe
- **31** — la cuenta del chofer no puede apuntar a otra flota

La `0053` además toca el esquema `auth`: **puede responder `42501` y quedarse
sin aplicar** en mitad de un `db push`.

### 2. Ejecutar lo que no admite prueba automática
- `scripts/crear-superadmin.mjs` (sus dos guardas y la sintaxis sí se
  verificaron; el camino feliz no).
- El procedimiento del runbook contra el proyecto real de Supabase.

### 3. Decidir lo que es del responsable, no de Likida
- **Ampliar el aviso para cubrir el correo del chofer**, o quitar el rol
  `operador` del alta. El texto exacto de las tres líneas está en `legal.md`.
- **Si Likida ve transcripciones de WhatsApp** siendo persona encargada. Ya no
  identifican al operador (`5b43fd8`); el resto es decisión de producto y de
  aviso.

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
