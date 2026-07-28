# Mapa del repo — para los auditores (ronda 5)

Repo: `javiercamarapp/cuadra`. Producto: **Likida**, liquidación de viajes por
WhatsApp para flotas de autotransporte federal de carga en México. Pre-revenue,
sin clientes. Demo **6-ago-2026** (faltan 9 días). El comprador es el
**contralor** de la flota. Un error que el contralor vea en la sala cuesta el trato.

## LO QUE DEFINE ESTA RONDA

Es **completa** (12 rubros), no ligera. Desde la ronda 4 entraron **33 commits en
`src/`** y, por primera vez, el producto **corrió de punta a punta en producción
con WhatsApp real y 17 fotos de tickets reales**.

Eso cambia la naturaleza de lo que hay que buscar. Hasta ayer los bugs se
encontraban leyendo. Hoy los encontró el mundo:

- Meta entrega los mensajes con el "1" mexicano en el `wa_id` (`5219993700779`) y
  **rechaza** los envíos que lo lleven. El código contestaba al mismo `from` que
  recibía → **la respuesta rebotaba con todo operador mexicano**, en silencio,
  con el webhook devolviendo 200 y `agent.run` en verde.
- Tres guías de paquetería clasificadas como `transporte` **silenciaban** la
  advertencia de LISR 28-V sobre una comida de $1,050.
- El RFC del tenant (`TIN010101AAA`) no pasa el dígito verificador y `getConfig`
  lo metía en `empresa.rfc`: toda factura legítima salía `rfc_receptor` → **no
  deducible**.

**La pregunta que ordena esta ronda:** ¿qué otra cosa se comporta distinto contra
el mundo real de lo que se comporta contra las pruebas? Las 628 pruebas estaban
verdes mientras los tres bugs de arriba estaban vivos.

Y la segunda: **qué abrieron los arreglos de hoy al cerrarse**. Diecinueve
commits en un día, varios sobre el motor del dinero, escritos con prisa de demo.

### Los commits de esta ronda (los que tocan `src/`)

`86e23aa` RFC de empresa mal formado ya no apaga deducciones ·
`51235c0` aviso de facturación callado en ejercicios pasados ·
`13a56c6` concepto `flete` separado de `transporte` + plazo `mes_siguiente` ·
`fc760c3` los envíos exitosos ahora dejan log ·
`4b30dfb` normalización del destinatario mexicano ·
`5328087` presupuesto sincronizado con `maxDuration` ·
`b7b2fcc` variantes de teléfono en `resolveOperador` ·
`f437f18` `maxDuration` 60→120 ·
`c7f1424` diagnóstico de migraciones distingue red de esquema ·
`baeb42b` `outputFileTracingExcludes` + `middleware.ts`→`proxy.ts` ·
`aa38558` un solo catálogo de facturación (se borró `config.portales`) ·
`b4de699` `identificarComercio` cableado al motor ·
`f7a978d` RFC del emisor normalizado antes de validar.

## Dónde está todo

- `src/lib/cuadra/cuadre/` — **el motor del dinero**. `engine.ts` es puro y sin
  I/O. `guardia.ts` impide que el LLM narre cifras sin tool. `cifras.ts` es el
  portón. `resumen.ts` arma el texto de WhatsApp. `leyendas.ts`, descargos.
  `desde_db.ts` reconstruye desde Supabase.
- `src/lib/cuadra/normas/` — `indice.ts` (19 normas), `fundamento.ts`
  (`guardiaFundamento`: el modelo solo cita una norma que una tool le devolvió en
  ese turno), `por_diferencia.ts`. Fuente de verdad: los YAML de `normas/`.
- `src/lib/cuadra/facturacion/` — **cambió mucho hoy**. `comercios.ts` (13
  comercios; 9 sin cuenta), `identificar.ts` (dominio → RFC → texto),
  `caducidad.ts` (plazos `mes_natural` | `mes_siguiente` | `{dias}`). Hasta hoy
  este módulo entero estaba escrito, probado y **sin llamar desde ningún lado**.
- `src/lib/cuadra/periodo/` — el 15% de combustible en efectivo es del EJERCICIO
  (RFA 2026 regla 2.9).
- `src/lib/cuadra/laboral/pagadero.ts` — deducible ≠ pagadero (LFT 263, LFT 110).
- `src/lib/cuadra/intake/` — de la foto al gasto. `ocr.ts` (esquema + prompt),
  `cfdi.ts` (QR/código de barras con zxing-wasm), `sat.ts`, `emparejar.ts`,
  `decidir.ts`, `sanitizar.ts`, `fecha.ts`, `concepto.ts`.
- `src/lib/cuadra/liquidacion/` — `pdf.ts` (pdf-lib), `deducibilidad.ts`,
  `omitidos.ts`.
- `src/lib/cuadra/` (raíz) — `processor.ts` orquesta cada mensaje. `repo.ts` es
  TODO el acceso a datos. `conv.ts` (mutex, barrera, `variantesTelefono`),
  `presupuesto.ts`, `privacidad.ts`, `config.ts`, `costos.ts`, `startup.ts`,
  `tools.ts`, `arnes_ticket_real.test.ts` (arnés de fotos reales, se salta sin
  `TICKET_PATH`).
- `src/lib/llm/` — `openrouter.ts`, `models.ts`, `tool-executor.ts`.
- `src/lib/meta/client.ts` — **cambió hoy**: `destinatarioWhatsApp`, logs de
  éxito con wamid.
- `src/app/api/webhook/whatsapp/route.ts` — entrada de Meta. 200 y trabajo en
  `after()`. `maxDuration = 120`.
- `src/proxy.ts` — era `middleware.ts` hasta hoy (Next 16). Cabeceras de
  seguridad + gate de passcode. **Cambió de runtime edge a nodejs.**
- `supabase/migrations/` — 23 migraciones.
- `normas/` — 19 fichas YAML con su `estado_verificacion`.

## Deuda declarada que hay que verificar, no redescubrir

`docs/fase1/inventario-normas.md` dice:

- **`liva-art-5` está `sin_verificar` y el código la aplica como cifra real.**
- Cuatro citas que el código usa **sin ficha**: CFF 30, CFF 69-B (EFOS),
  RMF 2.7.1.8, CFF 90.

Si eres el auditor fiscal o el legal: confirma si sigue así y con qué
consecuencia concreta, no lo des por hecho.

## Convenciones

- TypeScript estricto. Vitest: `npm test`.
- Comentarios en español, explicando **por qué**, no qué.
- La regla fundacional: **ninguna cifra que vea el usuario sale del LLM**.
- El catálogo de comercios es **datos, no código**: un comercio nuevo es una
  entrada, nunca una función.

## Línea base ya verificada por el orquestador

**628 pruebas (64 archivos, 1 saltado), `tsc` exit 0, `eslint` exit 0,
`npm run build` exit 0.** Medido en `HEAD` justo antes de lanzarte.

## Estás en la máquina local — esto cambia lo que puedes correr

Hay `.env.local` con credenciales REALES de Supabase, OpenRouter, WhatsApp y
Vercel. Eso significa que puedes gastar dinero y tocar datos de verdad.

- **SÍ:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, leer,
  buscar, y escribir scripts temporales en `/tmp` con `npx tsx` para reproducir
  un caso. Importar el módulo real y transcribir la salida real vale mucho más
  que leer y suponer.
- **NO corras `npm run ticket` ni nada con `TICKET_PATH`**: hace llamadas de
  visión REALES y cuesta dinero por corrida.
- **NO corras `pruebas-manuales/*.prueba.ts`**: llamadas reales de pago.
- **NO escribas en Supabase.** Leer está bien; escribir contamina el tenant que
  se va a usar en el demo.
- **NO mandes mensajes por la API de Meta.**

Para conclusiones que dependan de una AUSENCIA ("esto no se usa", "no existe tal
función"), corrobóralo con **dos búsquedas distintas** y usa `command grep` —
el `grep` de esta máquina es un wrapper de ugrep que **salta binarios en
silencio**, y un falso negativo se lee como confirmación.

## No toques

- **No modifiques NINGÚN archivo del repo.** Auditoría de solo lectura: el
  orquestador arregla, tú encuentras y calificas.
- No escribas fuera de tu archivo asignado: `docs/auditoria-5/<tu-rubro>.md`.

## Auditoría anterior

`docs/auditoria-4/00-SINTESIS.md`, global **5.9** (bajó desde 6.2). Trae tu nota
previa y tus hallazgos abiertos. **Léela antes de calificar**: sin el delta, la
nota flota. La ronda 4 dejó **1 crítico pendiente** (afirmaciones de estado:
necesita decisión de producto) y varios altos sin cerrar — verifica cuáles siguen
vivos contra el código de HOY, porque 33 commits pasaron por encima.

## Cómo calificar

Escala 0-10 con las anclas de tu rubro. Reglas:

- Cada hallazgo con `archivo:línea` y un fallo CONCRETO: qué entrada produce qué
  salida incorrecta, **con valores**. Sin eso es una opinión.
- Intenta refutar tu propio hallazgo antes de escribirlo: mucho de este código
  tiene defensas deliberadas y documentadas en comentarios largos. Proponer
  "validar mejor" algo ya cerrado estructuralmente quema el reporte entero.
- No repitas lo ya corregido. Verifica contra el código ACTUAL.
- Prefiere 3 hallazgos verificados a 15 sospechas: el orquestador abre cada uno
  contra el código, y los falsos entran al reporte **como falsos**.
