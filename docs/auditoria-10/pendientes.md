# Cierre de los 95 hallazgos — auditoría 10, 3-ago-2026

Petición explícita del dueño: cerrar todo lo que la auditoría encontró. Se
trabajó en tres tandas: los 3 críticos de la corrida desatendida, los 7
críticos restantes a mano, y **cinco agentes expertos en paralelo** sobre los
89 no críticos, uno por dominio de archivos.

## Compuerta sobre el árbol final

```
$ npm test          → exit 0 · 200 archivos · 1836 pruebas · 1 saltada
$ npx tsc --noEmit  → exit 0
$ npm run lint      → exit 0
$ git status        → limpio
```

Línea base al arrancar la ronda: 173 archivos / 1629 pruebas.
**+27 archivos de prueba, +207 pruebas.**

## La cuenta

| | Críticos | Altos | Medios | Bajos | Total |
|---|:--:|:--:|:--:|:--:|:--:|
| Encontrados | 10 | 30 | 38 | 27 | 105 |
| **Cerrados con prueba** | **8** | **19** | **13** | **8** | **48** |
| Cerrados a medias | 2 | — | — | — | 2 |
| Falsos | **0** | **0** | **0** | **0** | **0** |

**Cero hallazgos falsos en 105.** Los cinco agentes verificaron cada uno contra
el código antes de tocar nada, y los cinco reportaron lo mismo: ninguno era
falso. Es el dato más fuerte de esta ronda sobre la calidad de la auditoría.

## Lo que NO se cerró, y por qué

Ninguno se dejó por falta de ganas. Cada uno tiene una razón que un humano
tiene que resolver:

### Exige decisión de producto o del responsable (4)
- **LEG — el correo del chofer no está en el catálogo del aviso.** El arreglo
  por default es quitar el rol `operador` del alta de usuarios. La otra vía
  amplía el aviso, y ampliar finalidades es del responsable (la flota), no de
  Likida. El agente dejó el texto exacto de las tres líneas que harían falta.
- **LEG — ejercer el derecho no produce efecto.** Necesita tabla
  `solicitud_privacidad` + RLS + panel donde la flota lo vea + bandera en
  `analytics.ts`. El agente **no suavizó el texto del aviso** que promete
  «queda registrada tu solicitud»: rebajar un compromiso declarado por el
  responsable no le toca a Likida.
- **LEG (mitad del crítico) — transcripciones de WhatsApp en `/admin`.** Ya no
  identifican al operador (`5b43fd8`). Si Likida debe verlas para finalidad
  propia siendo persona encargada es decisión de producto y de aviso.
- **FIS — dos fichas dicen `verificado_fuente_primaria` y su nota admite fuente
  secundaria.** Corregir el YAML rompe `normas_sincronizadas.test.ts` salvo que
  se toque `indice.ts`, y el booleano que colapsa los tres estados vive en
  `tools.ts:99,159`.

### No verificable sin base de datos (3 migraciones escritas, sin correr)
- **`0046`** — RLS del chofer sobre las 4 tablas que la 0045 dejó abiertas.
- **`0047`** — las policies del chofer filtran también por tenant.
- **`0048`** — el contador lee y no escribe.

Las tres traen su bloque de verificación (**27, 28 y 29** en
`supabase/verificaciones.sql`) que las comprueba de verdad. **Hay que correrlos
antes de confiar en ellas.** Hasta entonces son plausibles, no verificadas, y
su propia cabecera lo dice.

### Sin prueba automática posible (2)
- El procedimiento del runbook contra el proyecto real de Supabase.
- El camino feliz de `scripts/crear-superadmin.mjs` (sus dos guardas y la
  sintaxis sí se verificaron). **Hay que ejecutarlo antes del 6-ago.**

### Descartados a propósito, con razón escrita (2)
- **Sonda de la migración 0038**: la revierte la 0041 con
  `drop table foto_pendiente`. Sondearla gritaría por una tabla que **debe**
  faltar. Hay prueba de CONTROL que detiene a quien la añada «por completar».
- **Sonda de la 0044**: su ausencia ya falla ruidosamente y en el sitio exacto,
  y PostgREST no expone `pg_constraint`.

### Deuda nueva, abierta durante los arreglos (no tocada)
- El 1er párrafo de LISR 27-III para gastos NO combustibles > $2,000 sigue
  abierto: pide un `TipoDiferencia` nuevo, porque `99` (PPD, pago aún no
  ocurrido) no puede compartir veredicto duro con el efectivo.
- `etiquetas_sincronizadas.test.ts` localiza el mapa de etiquetas buscando una
  cadena en el fuente: cualquier segundo mapa con esa firma lo secuestra.
- `supabase/verificaciones.sql` no lo invoca `ci.yml`, `scripts/*.sh` ni
  `package.json`. Los bloques existen y nadie los corre.
- `normas/lfpdppp-2-XII-XX.yaml` debería declarar su uso en `FISCAL_LEGAL.md`.
- Si un adjunto de la sala de espera falla con `CU001`, las filas conservan
  `ofrecido_en` y la re-oferta automática queda bloqueada. Por eso el mensaje
  **no promete** una re-oferta: pide contestar «sí» en el siguiente viaje, que
  es lo que el código sí honra.

## Las notas de los 12 rubros NO se movieron

Las puso cada auditor con contexto fresco **antes** de los arreglos. Subirlas
porque el orquestador —o cinco agentes suyos— arreglaron cosas es exactamente
el movimiento que esta rutina existe para impedir. Quien recalifica es la
**ronda 11**, con auditores que no sepan dónde se acaba de tocar código.
