# Cierre de los 95 hallazgos restantes — 3-ago-2026

Petición explícita del dueño: cerrar todo lo que la auditoría encontró. Los 10
críticos ya están (8 cerrados, 2 a medias). Quedan **30 ALTOS, 38 MEDIOS,
27 BAJOS**.

Orden: daño real, no orden de archivo. Lo que el contralor puede ver el 6-ago
va primero; luego lo que mueve dinero; luego lo que se rompe en silencio.

Marca: `[ ]` pendiente · `[x]` cerrado con prueba · `[~]` parcial · `[!]` no
cerrable aquí, con razón escrita.

## ALTOS

- [x] `e8a337f` **FE-A2** `/demo` afirma «CFDI validado por QR ✅» y se desdice (REINCIDENTE)
- [x] `0af4a7e` **FE-A1** IVA y Peaje afirman «$0.00» medido que el motor nunca midió
- [x] `cbeccd2` **FE-A3** el `next` del login descarta `/mis-viajes` (3 copias + callback)
- [ ] **FIS-A1** LISR 27-III implementado como «no es efectivo» (FormaPago 99/17)
- [ ] **FIS-A2** estímulo de peaje afirmado sin ninguna de las 4 condiciones
- [ ] **BE-A1** CSV al ERP recortado en silencio a 1,000 renglones
- [x] `d6ba851` **BE-A2** `reasignarOperador` acepta un operador de OTRO tenant
- [ ] **BE-A3** `provisionarUsuario` dos escrituras sin compensación
- [ ] **SEG-A2** el `contador` se vende «solo lectura» y la base le da escritura
- [ ] **DAT-A1** `app_user.operador_id` sin `tenant_id` en la FK ni en la policy
- [x] **DAT-A2** la 0045 dejó `for all` en las demás — cerrado por `abbf9e8` (0046)
- [ ] **REN-A1** mutex del «listo» sin techo dentro de `for (;;)`
- [ ] **REN-A2** barrera 20,000 ms vs OCR de 25,000 ms
- [ ] **REN-A3** el cierre corre sin consultar el reloj
- [ ] **REN-A4** `/admin` 4 escaneos completos por página
- [ ] **OPS-A1** `getSessionTenant` sigue tirando el error de `auth.getUser()`
- [ ] **OPS-A2** `proxy.ts` corre en el 100% del tráfico sin una línea de log
- [ ] **OPS-A3** el runbook describe un candado que ya no existe
- [ ] **OPS-A4** no hay procedimiento para crear el primer usuario
- [ ] **PRU-A1** `no_autoregistro.test.ts` prueba texto fuente, no comportamiento
- [ ] **PRU-A2** `permisos.ts` probado como función pura, nunca como cableado
- [ ] **PRU-A3** bloque 26 de `verificaciones.sql` nunca corrido
- [ ] **AGE-A1** la oferta se marca antes de entregarse, y es de un solo tiro
- [ ] **AGE-A2** `guardiaFundamento` certifica cita bien nombrada y mal aplicada
- [ ] **TOOL-A1** atribución modelo↔tokens tras el fallback, en 7 pantallas
- [ ] **ARQ-A1** el REINCIDENTE de `round2` cerrado como duplicación, no como número
- [ ] **ARQ-A2** el passcode no se retiró: dos verdades de auth conviviendo
- [ ] **LEG-A1** el correo del chofer no está en el catálogo del aviso
- [ ] **LEG-A2** ejercer el derecho no produce ningún efecto
- [x] **SEG-A1** export sin autorizar — cerrado por `8fb74d4`

## MEDIOS (38) y BAJOS (27)

Listados en cada archivo de rubro. Se atacan después de los altos.
