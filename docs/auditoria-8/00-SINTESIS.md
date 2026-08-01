# Auditoría 8 — síntesis

**Fecha:** 1-ago-2026. **Anterior:** `docs/auditoria-7/00-SINTESIS.md` (5.5).
**Sha base:** `abdc98d` → `ac752de` (41 commits antes de esta ronda) → esta
ronda añade 5 commits de arreglo. **Modo:** local, con el operador presente.
**Tipo:** **RONDA COMPLETA**, doce auditores con contexto fresco.

---

## Nota global: 6.5 (antes 5.5, ▲1.0)

| Rubro | Aud. 7/6 | Tras los 12 auditores | Tras los arreglos | | Razón del movimiento final |
|---|:--:|:--:|:--:|---|---|
| Modelo de datos | 7 | 8 | **8** | ▲ | se atacó y subió (1 alto nuevo, sin críticos) |
| Pruebas | 5 | 7 | **8** | ▲ | se atacó y subió — el crítico (5 supervivientes de ronda 6) cerró con arnés real, mutante por mutante |
| Seguridad | 8 | 8 | **8** | = | no atacado esta ronda |
| Tool calling | 8 | 8 | **8** | = | no atacado esta ronda |
| Backend y API | 6 | 7 | **7** | ▲ | se atacó y subió, con freno |
| Legal | 4 | 6 | **6** | ▲ | se atacó y subió — el crítico NXDOMAIN cerró de verdad |
| Arquitectura | 5 | 6 | **6** | ▲ | se atacó y subió |
| Operabilidad y DX | 4 | 6 | **6** | ▲ | se atacó y subió — los 2 críticos viejos cerraron de verdad |
| Rendimiento y costo | 7 | 6 | **6** | ▼ | mirada más profunda |
| Sistema agéntico | 3 | 4 | **5** | ▲ | se atacó y subió — el crítico (portón de cifras) cerró; 3 altos siguen abiertos |
| Frontend | 4 | 5 | **6** | ▲ | se atacó y subió — el crítico (tope de viáticos) cerró |
| Cumplimiento fiscal | 5 | 4 | **4** | ▼ | mirada más profunda — 2 de 3 críticos cerrados, el ancla del rubro sigue satisfecha por el que queda abierto |

**Nueve de doce rubros subieron.** Es la primera ronda desde la 6 con los
doce auditados de cero, y la primera en la que el orquestador arregla
críticos EN LA MISMA RONDA en la que se encontraron — antes el ciclo era
"encontrar → esperar la siguiente ronda → arreglar → esperar otra ronda más
para confirmarlo". Aquí cinco de seis críticos se cerraron con prueba
roja-antes/verde-después el mismo día.

---

## Los seis críticos, verificados uno por uno antes de tocar código

Ninguno resultó falso. Cada uno se abrió, se leyó el código exacto, y se
confirmó reproduciendo el escenario con el motor real antes de escribir la
prueba.

| # | Hallazgo | Rubro | Estado | Commit |
|---|---|---|---|---|
| 1 | El portón de cifras (`NO_ES_DINERO`) se apagaba por frase completa, no por cláusula | Agéntico | **ARREGLADO** | `ebf2220` |
| 2 | `derivoLaConfig` solo miraba tipos, no el `esperado` del tope de viáticos | Frontend | **ARREGLADO** | `40714ba` |
| 3 | Cinco supervivientes de la ronda 6 sin arnés (el peor: bloqueo de datos personales) | Pruebas | **ARREGLADO** | `9bbfa35` |
| 4 | Litros del estímulo de IEPS sin cotejar contra el monto | Fiscal | **ARREGLADO** | `af0acfb` |
| 5 | Tope diario de viáticos diluido por tickets sin timbrar | Fiscal | **ARREGLADO** | `43ebf41` |
| 6 | CFDI sin RFC receptor sale deducible en verde | Fiscal | **PENDIENTE** | — |

### Por qué el #6 se queda pendiente, y no es pereza

El arreglo directo (una tercera validación: `if (g.cfdiUuid && !g.rfcReceptor)
→ rfc_receptor_no_verificable`) es correcto y quedó probado en aislamiento —
pero `rfc_receptor_no_verificable` está en la lista `POR_CONFIRMAR` que
`cubetaDe` usa para clasificar, así que aplicarlo **reclasifica** cualquier
gasto con `cfdiUuid` y sin `rfcReceptor` de `deducible` a `por_confirmar`.

Corrido contra la suite completa: **25 pruebas fallaron en 4 archivos**
(`engine.test.ts`, `complemento_exigibilidad.test.ts`,
`engine_diesel_medio_pago.test.ts`, `acreditable.test.ts`). Casi todos los
fixtures del motor construyen un `Gasto` con `cfdiUuid` para representar "hay
factura válida" y nunca capturan `rfcReceptor`, porque hasta hoy ese campo no
importaba para lo que probaban. El arreglo es correcto; el blast radius —
auditar y corregir docenas de fixtures fiscales bajo presión de tiempo — no
es seguro hacerlo a las carreras el mismo día que se encontró, y un error ahí
sería exactamente el tipo de daño que esta auditoría existe para prevenir.

Se revirtió el cambio (`git checkout -- engine.ts`, prueba nueva borrada) y
queda **para ronda 9**, con el diseño ya validado:

```ts
if (g.cfdiUuid && !g.rfcReceptor) {
  diferencias.push({ tipo: 'rfc_receptor_no_verificable', ... });
}
```

más una pasada de `rfcReceptor` en los fixtures que representan un CFDI
verificado de verdad.

---

## Compuerta sobre el árbol final

```
npm test          1317 pruebas, 1 saltada, 139 archivos   exit 0   (antes 1119)
npx tsc --noEmit                                          exit 0
npm run lint                                              exit 0
npm run build      no se corre localmente (pide credenciales de deploy)
```

5 commits de arreglo en `master`, cada uno con su suite completa verde antes
de commitear: `ebf2220`, `40714ba`, `9bbfa35`, `af0acfb`, `43ebf41`.

---

## Para la ronda 9

1. **El crítico fiscal #6 (RFC receptor faltante) sigue abierto.** Diseño
   validado arriba. Requiere auditar los fixtures de `engine.test.ts`,
   `complemento_exigibilidad.test.ts`, `engine_diesel_medio_pago.test.ts` y
   `acreditable.test.ts` para distinguir "simula un CFDI verificado" (agregar
   `rfcReceptor`) de "simula uno sin verificar a propósito" (dejarlo, y
   confirmar que ahora cae en `por_confirmar` como debe).
2. **Sistema agéntico sigue con 3 altos abiertos** que no se tocaron esta
   ronda: el aviso de barrera vencida manda a reenviar algo que la 0036 ya
   prohíbe; sin ninguna tool en el turno, las citas normativas se siguen
   mutilando; el XML no toma la barrera ni el mutex.
3. **Pruebas encontró un patrón nuevo** (`gasto_tarde.test.ts` prueba el
   TEXTO del cableado, no el cableado) — sexta aparición del mismo defecto en
   este repo, primera vez en código de la misma ronda que lo nombra.
4. **Arquitectura encontró `round2()` reimplementado en 4 archivos de
   dinero**, con el mismo bug de redondeo (`round2(1.005)` da 1, no 1.01) en
   las cuatro copias — no se atacó esta ronda.

Reportes completos por rubro en `docs/auditoria-8/<rubro>.md`. Tablero en
`docs/auditoria-8/tablero.html` / `.png`.
