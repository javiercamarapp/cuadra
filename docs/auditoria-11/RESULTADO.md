COMPLETA + CIERRE DE HALLAZGOS

Global 4.9 → 3.9 (▼1.0). Los 12 rubros auditados con contexto fresco sobre
`master` —no sobre la rama del PR #7—, porque `master` es lo que Vercel
despliega y lo que se demuestra el 6-ago.

## Por qué bajó, en una línea

**Los 96 arreglos de la auditoría 10 nunca llegaron a `master`.** Siguen en el
PR #7, sin mergear desde el 3-ago. La ronda volvió a medir un árbol donde los
105 hallazgos anteriores seguían abiertos. No es que el código empeorara: es la
misma deuda contada dos veces porque nadie la pagó.

## Los hallazgos

164 reportados por los doce auditores — 26 CRÍTICOS · 51 ALTOS · 59 MEDIOS ·
28 BAJOS. Deduplicados por causa raíz: **63 grupos únicos**. **1 falso.**

| | Grupos |
|---|---:|
| **Cerrados con prueba que los reproduce** | **49** |
| Propuestos — exigen Postgres, credenciales o red | 9 |
| Decisión humana (aviso de privacidad, dominio, base del 50%) | 4 |
| Descartado por falso | 1 |

**No queda ningún hallazgo cerrable sin cerrar.** Los 14 restantes son 9 que
exigen una base de datos que aquí no existe, 4 que son decisiones tuyas, y 1
falso.

Los 49 salieron en tres movimientos: **16 llegaron completos desde el PR #7**
—`989ca62` trajo 132 archivos que `master` nunca tocó, sin resolver un solo
conflicto—, **28 se cerraron por dominio**, uno a uno, con prueba roja antes del
arreglo, por seis agentes sobre dominios de archivo disjuntos, y **5 eran
arreglos que cruzaban la frontera entre dominios** y se cerraron al final, ya
sin agentes corriendo (`503dde9`).

## Compuerta sobre el árbol final

```
$ npx vitest run        → exit 0 · 269 archivos · 2530 pruebas · 1 saltada
$ npx tsc --noEmit      → exit 0
$ npm run lint          → exit 0 · CERO warnings
$ npm run test:coverage → exit 0 · líneas 84.19% · funciones 85.03%
$ git status            → limpio
```

Línea base al arrancar: 172 archivos / 1670 pruebas, y `test:coverage` en
**exit 1** (líneas 64.32% contra umbral 78). **+97 archivos, +860 pruebas.**

Sin `npm run build`: en la nube pide Supabase, OpenRouter, Facturapi y Upstash.

**El CI de `master` llevaba rojo desde el 3-ago** (runs 264–271, incluida la
#271 sobre `e4326f9`, el HEAD) y por eso el paso de *Build* no había corrido una
sola vez sobre el código del demo. Cerrado sin tocar el umbral:
`vitest.config.ts` queda byte-idéntico.

## Los críticos, y dónde quedó cada uno

CERRADOS CON PRUEBA:
1. El rail servía `montoComprobado`, IVA y peaje acreditables y el detector de
   fraude a cualquiera con sesión — encargado y chofer incluidos (`2fb1982`).
2. `/api/export/liquidaciones` y `/pdf/[id]` autenticaban sin autorizar.
   `puedeExportar` tenía seis pruebas y cero consumidores.
3. `/admin` servía el teléfono del operador y la transcripción íntegra,
   cruzando flotas, en cada carga de cualquier página.
4. Un «va» sobre el viaje de hoy adjuntaba los comprobantes ofrecidos en el
   viaje anterior: dinero de un viaje cerrado entrando a otra liquidación.
5. Las siete escrituras del encargado no traducían errores de Postgres: dar de
   alta el viaje del guion del demo moría con «Código del incidente: 39dfa…».
6. `KpiTile` imprimía `0 L` bajo «LIF 2026, Art. 20-A» y `$0.00` bajo «LIVA,
   Art. 5» — cifras fiscales de cero presentadas como medición.
7. Dieciséis `catch` vacíos se tragaban todos los errores de lectura del panel.
8. El CI rojo, con Build sin correr sobre el código del demo.
9. `guardar_liquidacion` subía dos PDF heredando 300 s de timeout cada uno
   dentro de un turno acotado a 120 s.
10. `AreaChartSimple` **lanzaba** con arreglo vacío, y cinco páginas de /admin
    le pasan `porDia` directo: página en blanco para una flota recién dada de
    alta. Lo encontró la cobertura nueva, no un auditor.

PROPUESTOS — no se arregla lo que no se puede reproducir:
11. `viaje.operador_id` es `NOT NULL` y el módulo del encargado lo asume
    nullable: «Viajes sin asignar» no puede devolver una fila jamás. Mitigado
    en pantalla; el `drop not null` exige base.
12. La RLS del chofer cubre 3 de 7 tablas, y `pod_viaje_unico` es única
    **global**: un POD de la flota A bloquea el de la B.
13. El bucket `avatares` es público, sin tope de tamaño ni de MIME.
14. Los ordinales `0046`/`0047` nombran migraciones distintas en `master` y en
    el PR #7. `supabase/migrations/` quedó INTACTO.

DESCARTADO POR FALSO:
15. «El gate de rol de las 20 páginas está desactivado» — era un mutante que el
    auditor de pruebas tenía vivo en el árbol mientras otro agente leía.

## Requiere decisión humana antes del 6-ago

1. **Elegir el dominio.** `CLAUDE.md` dice `app.likida.ai`, `DEPLOY.md` dice
   `likidaai.vercel.app`, `acciones.ts` cae a `likida.ai`. Si no coincide con
   el Site URL de Supabase, el login queda roto **sin dejar un solo error en
   ningún log**. El arranque ya rechaza lo imposible; elegir cuál es tuyo.
2. **Qué se hace con el PR #7.** Este PR trajo lo que entraba sin conflicto;
   quedan 21 archivos donde las dos ramas refactorizaron lo mismo, y el choque
   de ordinales de migración.
3. **El aviso de privacidad**: la foto de perfil, el expediente por chofer y la
   geolocalización de la 0047 no están en su catálogo. Es redacción legal.
4. **La base del 50% del peaje** (LIF 2026 art. 20-A): la ley dice «gasto total
   erogado», el motor usa el subtotal sin IVA. Empujarlo al total podría
   duplicar el beneficio del IVA. Es decisión de contador.

## Nota de proceso para la ronda 12

Correr los doce auditores en paralelo con uno que muta código a propósito
produjo un hallazgo falso y un rato de suite roja que no era de nadie. Darle su
propio worktree, o correrlo en serie después de los once.

Y el plan de arreglo daba por cerrados cuatro grupos que no lo estaban: el
merge había traído la prosa, no el borrado ni el uso. `login/page.tsx`
conservaba sus copias inline de los server actions y montaba ESAS en los
`<form>` — la versión que corría no era la que la suite medía. Solo se ve
abriendo el archivo.
