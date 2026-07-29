# Auditoría 6 — síntesis

**Fecha:** 29-jul-2026. **Anterior:** `docs/auditoria-5/00-SINTESIS.md` (5.2).
**Sha base:** `5b2ec76`. **Modo:** local, con el operador presente.
**Tipo:** **RONDA COMPLETA**, los 12 rubros, doce auditores con contexto fresco.

---

## Nota global: 5.3 (antes 5.2, ▲0.1)

| Rubro | Aud. 5 | Aud. 6 | | Razón |
|---|:--:|:--:|---|---|
| **Seguridad** | 7 | **8** | ▲ | se atacó y subió |
| **Tool calling** | 7 | **8** | ▲ | se atacó y subió |
| **Modelo de datos** | 5 | **7** | ▲ | se atacó y subió |
| Rendimiento y costo | 7 | 7 | = | sin trabajo dirigido; los 3 altos siguen |
| **Backend y API** | 5 | **6** | ▲ | se atacó y subió, con freno: correcto por lectura, no por prueba |
| **Cumplimiento fiscal** | 4 | **5** | ▲ | se atacó y subió; quedaba el RFC genérico |
| **Frontend** | 5 | **4** | ▼ | deuda que cobró factura |
| **Arquitectura** | 5 | **4** | ▼ | deuda que cobró factura |
| **Operabilidad y DX** | 5 | **4** | ▼ | deuda que cobró factura |
| Cumplimiento legal | 4 | 4 | = | mirada más profunda sobre un arreglo a medias |
| Pruebas | 4 | 4 | = | deuda que cobró factura |
| **Sistema agéntico** | 4 | **3** | ▼ | deuda que cobró factura |

**Cincuenta y cinco arreglos movieron la aguja una décima.** Ese es el
resultado honesto de la ronda, y es exactamente lo que se venía a medir.

---

## La pregunta de la ronda tuvo una respuesta, y es una sola frase

**Se construyó el mecanismo, se le escribieron pruebas unitarias, y nunca se
conectó.**

Los 55 arreglos de la ronda 5 se escribieron con **siete agentes en paralelo**,
cada uno en su territorio de archivos. Dos de ellos construyeron la pieza
correcta, la probaron en aislamiento, y no cruzaron la costura para enchufarla:

| Mecanismo | Para qué se escribió | Quién lo llamaba |
|---|---|---|
| `sondearAvisoIntegral` | lo ÚNICO que distingue un dominio bien escrito de uno sin registrar | solo sus pruebas |
| `flushObservabilidad` | sobrevivir al congelamiento de la invocación en el `after()` | nadie, en el único `after()` del repo |

Las dos tenían pruebas verdes. **Prueban la función aislada, no que esté
enchufada**, y por eso los 990 tests no dijeron nada. Es el mismo modo de falla
que el rubro de pruebas mide con mutaciones, visto desde otro ángulo.

Las pruebas de esta ronda **miran el cable**, y se verificó que fallan sin él:
quitando la llamada, 3 rojas en el webhook y 1 en `register()`.

---

## El hallazgo que ningún auditor vio entero

`getConfig` descartaba el `error` de PostgREST —que llega **por valor**, no
lanzado— y caía a `DEMO_CONFIG`. Tres auditores lo tocaron y cada uno tenía una
parte:

- **Operabilidad** lo marcó CRÍTICO: *"liquida con la política de la demo"*.
- **Backend** lo miró y lo descartó **con buen argumento**: *"degradación a
  valores seguros, no una afirmación falsa sobre el mundo; hoy el riesgo es
  cero"*.
- **Fiscal**, sin saber de los otros dos: `DEMO_CONFIG.empresa.rfc` es el
  **genérico del SAT**, y con el genérico el motor apagaba **las dos** ramas de
  validación de receptor.

Compuestas, un hipo de Supabase liquidaba con la política del demo **y sin
validar a nombre de quién viene ninguna factura**. Medido con el motor real: un
CFDI de $11,600 timbrado a un TERCERO salía `Deducible para ISR $11,600.00` en
verde, con $1,600 de IVA acreditable citando LIVA art. 5, y cero diferencias.
El mismo daño del crítico de ayer, entrando por la otra puerta.

Backend no se equivocó en lo que miró. Le faltaba la mitad de fiscal. **Esa es
la costura, y es la razón de correr doce auditores independientes en vez de
uno.**

---

## Lo que apareció al escribir las pruebas, y no estaba en ningún reporte

**Una fuga entre tenants.** `fusionarConfig` devuelve la MISMA referencia cuando
no hay override, así que `cfg` ES `DEMO_CONFIG`, el objeto del módulo. La línea
`cfg.empresa = { ...cfg.empresa, rfc }` le escribía encima:

```
tenant A (rfc propio) liquida  → DEMO_CONFIG.empresa.rfc = rfc de A
tenant B (rfc aún en null)     → recibe el RFC DE OTRA FLOTA
```

Y con él, **todos los CFDI legítimos de B fallan la validación de receptor**.
Persiste mientras viva la instancia, que Fluid Compute reutiliza entre
peticiones y entre tenants. El comentario de `fusionarConfig` advierte
literalmente de esto; la función no mutaba — mutaba su llamador, una línea
después.

---

## Un hallazgo resultó FALSO, y consta como falso

El rubro agéntico reportó como CRÍTICO que `guardiaEstado` tacha un cierre real
narrado en pretérito y manda el PDF igual, dejando al operador con *"todavía no
he cerrado tu liquidación"* seguido de su liquidación cerrada.

**Reproduje el comportamiento en la función aislada. El camino de llamada no
existe:** `guardia.ts:37-38` cuenta `guardar_liquidacion` como cuadre y la línea
79 devuelve `forzado: true` siempre que hubo cuadre, así que en todo cierre real
`textoDeterminista` queda en `true` y el `if (!textoDeterminista)` impide que
`guardiaEstado` corra. La rama era inalcanzable.

Se cerraron igual los dos defectos que lo causarían —`entrego: false` fijo y un
solo texto de reemplazo para dos motivos— porque lo único que hoy los contiene
es un acoplamiento entre dos guardias que nadie estaba fijando. Ahora hay una
prueba que lo dice en el momento.

**Anotarlo como falso es lo que mantiene honestos a los auditores de mañana.**

---

## El quinto lugar del patrón apareció donde el mapa dijo que buscaran

*Un fallo de consulta disfrazado del valor que significa "no hay"*, quinta
aparición: **`config.ts`**, uno de los cuatro archivos que el MAPA señaló.

Backend recorrió los otros tres y **descartó cada uno por escrito**:
`analytics.ts` traduce el error a excepción en el borde; `costos.ts` lo hace
imposible por tipo (unión discriminada); `repo.ts` lanza en las 17. Esa negativa
razonada vale tanto como el hallazgo.

---

## Hallazgos: 8 críticos y 5 altos, todos cerrados

Once commits sobre `5b2ec76`. Detalle por rubro en los doce `<rubro>.md`;
estado por hallazgo con su sha, en `tablero.html`.

Los que más pesan, por lo que le costarían al contralor en la sala:

1. **El fundamento del LIF 20-A salía partido a la mitad** — `"Te aplica el
   estímulo conforme al."` La función que más vende el producto, con la cita
   devuelta por una tool ese mismo turno. Causa: la ronda 5 unificó la limpieza
   con la detección y dejó el **reconocimiento** como tercera lista aparte.
2. **El RFC genérico aprobaba por defecto** (AL-6, abierto desde la ronda 4).
   Era la ruta de cualquier tenant que aún no capturó el suyo — el día uno de un
   cliente.
3. **El panel contradecía al PDF archivado**: el detalle recalcula con la config
   de hoy, y el candado comparaba `totalComprobado`, la única cifra que un
   cambio de config nunca mueve.
4. **Un CHECK nuevo perdía un CFDI entero**: `FormaPago="1"` en vez de `"01"`
   violaba la restricción de la 0025 y el comprobante se perdía sin guardar ni
   el XML crudo que el CFF art. 30 obliga a conservar cinco años. La única de
   las seis migraciones de ayer que abrió una vía de pérdida de datos.

### Reincidente por tercera ronda

El sondeo de la migración 0019 *"anunciaba que verificaba y no verificaba"* —y
la ronda 5 lo empeoró poniéndole encima seis líneas afirmando lo contrario—.
Leía una columna que existe desde `0001_init.sql`: **el sondeo no podía
fallar**. Se re-clasificó de CRÍTICO a **ALTO** (la 0019 está aplicada, el daño
hoy es cero; lo que se cierra es la falsa garantía) y se cerró con la migración
**0030**, `indices_faltantes`, aplicada y verificada con su control.

---

## Compuerta sobre el árbol final

```
npm test        1115 pruebas, 1 saltada, 112 archivos   exit 0
tsc --noEmit                                            exit 0
eslint                                                  exit 0
npm run build                                           exit 0
cobertura       81.5% líneas · 85.5% ramas   (desde 79.7 / 85.1)
```

Migración **0030 aplicada** en producción y verificada:
`indices_faltantes(['uq_gasto_cfdi_uuid','uq_operador_telefono_activo'])` → `[]`,
y con un índice inventado → lo detecta. La **0027 sigue escrita y sin aplicar**
a propósito.

---

## Lo que queda abierto, y no es código

Tres cosas que no puedo cerrar yo, y las tres son datos del cliente:

- **La URL del aviso de privacidad.** `transportesinnovativos.mx` responde
  NXDOMAIN. El sondeo nuevo va a gritarlo en el próximo despliegue, pero hasta
  que exista una URL que resuelva, el aviso simplificado le manda al operador
  una liga rota **y la respuesta ARCO también** (LFPDPPP art. 15 fr. V y 16
  fr. II).
- **El RFC de la flota.** Con el genérico —o con el `TIN010101AAA` mal formado
  del seed— toda factura sale ahora *a revisión*. Es lo correcto, y se vuelve
  moot en cuanto se capture uno válido.
- **`SENTRY_DSN` sigue sin existir en Vercel.** El arranque ya lo dice en voz
  alta; el flush ya está cableado. Falta la variable.

---

## Para la ronda 7

La pregunta de esta ronda se contestó, así que la siguiente es otra. Dos
candidatas, y la primera pesa más:

1. **¿Cuántas copias de cada verdad hay?** Arquitectura lleva cinco rondas
   midiendo lo mismo en la misma dirección: el acceso a datos fuera de `repo.ts`
   subió **de 49 a 55**. Dos de los críticos de hoy —la fecha del PDF y el
   reconocimiento de citas— son exactamente eso: dos copias que se separaron.
2. **¿Los arreglos de HOY nacieron con arnés?** El rubro de pruebas midió 10 de
   12 mutaciones nuevas sobreviviendo (83%, peor que el 57% de la ronda 5).
   Esta ronda escribió las pruebas mirando el cable; hay que medir si eso
   cambió el número o solo cambió el discurso.
