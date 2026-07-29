# Auditoría 5 — síntesis

**Fecha:** 28-jul-2026. **Anterior:** `docs/auditoria-4/00-SINTESIS.md` (5.9).
**Sha base:** `86e23aa`. **Modo:** local, con el operador presente.
**Tipo:** **RONDA COMPLETA**, los 12 rubros.

---

## Nota global: 5.2 (antes 5.9, ▼0.7)

| Rubro | Aud. 4 | Aud. 5 | | Razón |
|---|:--:|:--:|---|---|
| **Tool calling** | 5 | **7** | ▲ | se atacó y subió |
| Seguridad | 7 | 7 | = | el arreglo del bundle subió y la mirada profunda bajó; se cancelan |
| **Rendimiento y costo** | 6 | **7** | ▲ | se atacó y subió |
| **Arquitectura** | 4 | **5** | ▲ | se atacó y subió, con freno |
| **Frontend** | 6 | **5** | ▼ | mirada más profunda |
| **Backend y API** | 7 | **5** | ▼ | mirada más profunda |
| **Operabilidad y DX** | 6 | **5** | ▼ | mirada más profunda |
| **Modelo de datos** | 7 | **5** | ▼ | mirada más profunda |
| **Sistema agéntico** | 3 | **4** | ▲ | se atacó y subió |
| **Cumplimiento fiscal** | 7 | **4** | ▼ | mirada más profunda |
| **Cumplimiento legal** | 6 | **4** | ▼ | mirada más profunda |
| **Pruebas** | 7 | **4** | ▼ | deuda que cobró factura |

---

## El patrón que explica la bajada, y es lo más útil de la ronda

**Los tres rubros que la ronda 4 sí auditó subieron los tres.** Rendimiento subió
también, y es el cuarto que recibió trabajo dirigido esta ronda.

De los **nueve arrastrados** con la etiqueta "no auditado esta ronda", **siete
bajaron**. Sus notas describían el código de las rondas 2 y 3, antes de unos
cincuenta commits. Eran ficción contable, y los propios auditores lo escribieron:
*"el 7 venía arrastrado de una ronda que no auditó el rubro"* (backend), *"el 7
venía heredado de una ronda que anotó 'no auditado'"* (datos).

**La bajada no mide deterioro. Mide que por primera vez alguien miró.** Un 5.2
medido vale más que un 5.9 heredado, porque el 5.2 dice dónde está el riesgo a
nueve días del demo.

El caso extremo es **pruebas**, de 7 a 4: el chequeo que define el rubro —romper
la función a propósito y ver si la prueba se entera— nunca se había corrido. Al
correrlo, **12 de 21 mutaciones sobre código de dinero sobrevivieron** con
628/628 en verde. Ese 7 nunca fue verdad.

---

## Lo que esta ronda tuvo de distinto: el producto salió al mundo

Hasta ayer los bugs se encontraban leyendo. Hoy los encontró el mundo real: el
producto corrió por primera vez de punta a punta con WhatsApp de verdad y 17
fotos de tickets reales.

Los tres que aparecieron así **no los podía encontrar la suite**, y esa es la
lección de la ronda:

1. **La respuesta rebotaba con todo operador mexicano.** Meta entrega los mensajes
   con el "1" (`5219993700779`) y **rechaza** los envíos que lo lleven. El código
   contestaba al mismo `from` que recibía. Rebotaba en silencio: webhook 200,
   `agent.run` en verde, y el operador sin nada.
2. **Tres guías de paquetería silenciaban una advertencia fiscal.** Clasificadas
   como `transporte`, hacían desaparecer el aviso de LISR 28-V sobre una comida de
   $1,050 — el artículo pide el transporte *de la persona*, no de una caja.
3. **Un RFC de flota mal formado marcaba toda factura como no deducible.**

Las 628 pruebas estaban verdes mientras los tres estaban vivos. De ahí que el
rubro de pruebas sea el que más cae y el que más trabajo recibió después.

---

## Hallazgos: 18 críticos, 37 altos

**Los 18 críticos y los 37 altos quedaron cerrados**, cada uno con prueba que lo
reproduce y verificación por código de salida. Ningún hallazgo se dio por bueno
sin abrirlo contra el código primero.

Detalle por rubro en los doce `<rubro>.md` de esta carpeta; estado por hallazgo,
con el sha de su commit, en `tablero.html`.

### Los que se arreglaron a sí mismos, y conviene que consten

Dos críticos eran **regresiones introducidas el mismo día**, no deuda vieja:

- Al descartar un RFC mal formado por la mañana, se cambió *"rechaza todo"* por
  **"aprueba todo"**: un CFDI de $11,600 timbrado a un tercero salía deducible con
  $1,600 de IVA acreditable y cero diferencias. Faltaba el tercer estado — no se
  puede confirmar ni descartar → a revisión.
- Al subir el `maxDuration` se rompió el invariante que lo ata a
  `PRESUPUESTO_WEBHOOK_MS`, **y se empujó en rojo**: el comando se encadenó con
  `;` en vez de `&&` y el commit corrió pese al fallo. `master` estuvo rojo entre
  dos commits.

### Reincidentes

Tres críticos del rubro agéntico venían de las rondas 3 y 4, y uno llevaba **tres
rondas** abierto (las afirmaciones de estado). Se cerró con un argumento que antes
no existía: no hace falta una heurística sobre el mundo, porque **el servidor ya
sabe si cerró**. La guardia no adivina, coteja.

---

## Un patrón que apareció cuatro veces en un día

*Un fallo de consulta disfrazado del valor que significa "no hay".*

| Dónde | Qué decía | Qué pasaba de verdad |
|---|---|---|
| `startup.ts` | "FALTA la migración 0005" | `TypeError: fetch failed` |
| `conv.ts` · `resolveOperador` | "no te tengo registrado" | la base no contestó |
| `conv.ts` · `getOpenViaje` | "ese viaje ya quedó cerrado 👍" | la base no contestó |
| `conv.ts` · `intakeDelta` | "no hay fotos en vuelo" | la RPC devolvió error |

El último es el que cuesta dinero del operador: abre la barrera de ráfaga y la
liquidación cierra sin la última foto. Si esa foto era el diésel de $8,000, el
operador termina debiendo de su bolsa un gasto que sí hizo.

**Vale la pena buscarlo explícitamente en la ronda 6**: cada aparición se
encontró por separado, y las cuatro son el mismo error de diseño.

---

## Compuerta sobre el árbol final

```
npm test        990 pruebas, 1 saltada, 103 archivos   exit 0
tsc --noEmit                                           exit 0
eslint                                                 exit 0
npm run build                                          exit 0
cobertura       79.7% líneas · 85.1% ramas · 84.6% funciones, con umbral en CI
```

La suite se corrió **tres veces seguidas** para descartar intermitencia: dos
pruebas de reloj de pared fallaban bajo carga y se rehicieron por lo que de
verdad vigilan.

Migraciones **0024, 0025, 0026, 0028 y 0029 aplicadas** en producción y
verificadas contra el esquema. La **0027 queda escrita y sin aplicar** a
propósito: al aplicarla, reenviar las mismas fotos en un viaje nuevo deja de
registrar gastos, y hasta el 6-ago eso estorba a los ensayos.

---

## ESTAS NOTAS NO CALIFICAN EL CÓDIGO DE HOY

Califican lo que los auditores **encontraron**. Los 18 críticos y los 37 altos se
cerraron *después* de recibirlas, así que la tabla de arriba describe un código
que ya no existe.

Igual que hizo la ronda 3, esos arreglos **se medirán en la ronda 6 con auditores
frescos**. Es la única forma de que la serie histórica signifique algo: si la nota
subiera aquí, estaríamos midiendo nuestra propia satisfacción.

La pregunta de la ronda 6 ya está escrita, y es la misma que esta ronda demostró
que había que hacer: **¿qué abrieron al cerrarse?** Cincuenta y cinco arreglos en
un día, muchos sobre el motor del dinero, escritos con prisa de demo.
