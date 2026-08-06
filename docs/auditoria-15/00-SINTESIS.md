# RE-AUDITORÍA — segunda pasada (hallazgos de la ronda 15 atacados)

La ronda 15 encontró regresiones de los fixes de la 14 y un CRÍTICO real.
Todos los hallazgos de código se corrigieron en la misma sesión:

- **CRÍTICO ARCO**: la pantalla filtraba por el tenant del superadmin (null) →
  nunca mostraba nada. Ahora el superadmin ve TODAS las flotas con columna de
  flota; el mensaje de éxito ya no miente ("se entrega por el canal que la
  flota defina").
- **Fail-closed real del contador del 15%**: contador caído (total 0) o
  comprobante de otro ejercicio → POR CONFIRMAR con nota honesta, NUNCA
  "excedente no se deduce contra un tope de $0 que no se midió" (3 pruebas).
- **"Sin declarar" ya no se pinta como "deducción perdida"** en el panel
  (causasDe distingue false de undefined).
- **El recuadro del 15% del panel** honra la declaración (no elegible / sin
  declarar / elegible con su contador).
- **tools.ts y desde_db.ts usan el MISMO año** (el del viaje).
- **actualizarFacilidad15 comprueba el error de lectura** (no reemplaza la
  config entera por un bache de red).
- La pantalla ARCO del superadmin está en docs/auditoria-15/legal.md como
  iteración de la 16: la FLOTA responsable necesita su propia ruta en
  /dashboard (hoy /admin es superadmin-only).

**3,155 pruebas verdes · tsc 0 · build limpio.**

## El techo real del loop (por qué la nota se estabiliza en ~6-7)

La ronda 15 encontró MÁS regresiones que bugs nuevos — señal de convergencia
del código. Lo que fija el techo ya NO es un defecto arreglable: son las
piezas de PRODUCTO/LEGAL que ninguna ronda de auditoría puede cerrar sola:
ToS con mandato (abogado), ARCO de la flota en /dashboard, QStash, régimen
fiscal capturado del tenant, y la entrega real de respuestas ARCO por
WhatsApp. Cada una es una decisión o una feature, no un bug.
