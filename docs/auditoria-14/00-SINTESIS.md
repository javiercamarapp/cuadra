
# RE-AUDITORÍA — segunda pasada (hallazgos de la ronda 14 atacados)

La ronda 14 bajó el promedio (los defectos estaban en MI implementación del
deber ser de la RFA 2.9, construida esta sesión). Todos los hallazgos de código
se corrigieron en la misma sesión:

- Excedente por comprobante (suma de columna cuadra), año del ejercicio desde
  los comprobantes, superficies con la elegibilidad (panel/causasDe/aviso/chat),
  IVA del efectivo negado en el panel, estatus 'revisar' para no deducible,
  alta tri-estado + edición en consola, 0083 (forma validada en la base real),
  y una sola barrida del ejercicio (reusa getAcumuladoCombustible, best-effort).

**3,150 pruebas verdes · tsc 0 · build limpio.** La base real tiene 0083
aplicada (el "sí" rebota, la declaración del demo intacta).

Lo que queda de VERDAD (decisiones, no código):
1. **[Legal] ToS "no timbra facturas" + cláusula de mandato** — abogado.
2. **[Legal] ARCO legible por la flota** — la pantalla de cumplimiento.
3. **[Rendimiento] Cron de facturación a QStash** — el lote de 8 en una sesión.
4. **[Backend] 7 hallazgos MEDIO/BAJO de la ronda 13 sin atacar** (export,
   ids, asistente, etc. — documentados en docs/auditoria-13/backend.md).
