CONTINUACIÓN (pase 2): 12 rubros reauditados, 4 CRÍTICOS cerrados con prueba, 0 falsos

Global 3.9 → 5.7 (▲1.8) sobre `claude/auditoria-11` (PR #8). Ronda de
continuación: había PR de auditoría abierto, se continuó sobre él y **no se
abrió PR nuevo**.

## Lo que hay que leer si solo se lee una cosa

**La rama de este PR está 99 commits detrás de `master`** (398 archivos,
+77,308 líneas, 68 conflictos, migraciones 0047 contra 0076). No se mergeó:
reconciliar dos refactors divergentes de madrugada, un día antes del demo, es
el riesgo que esta rutina existe para bajar.

**Y aun así, dos de los cuatro CRÍTICOS están vivos también en `master`** —o
sea, en lo que se despliega y se demuestra mañana:

```
$ git show origin/master:src/lib/auth/permisos.ts | grep EXPORTA
const EXPORTA = new Set(['superadmin', 'flota_admin', 'encargado', 'contador']);
$ git show origin/master:src/lib/auth/visibilidad.ts | grep "/dashboard/chat"
  '/dashboard/chat': 'operacion',
```

El jefe de tráfico se baja por `curl` el CSV con el comprobado, el anticipo y
la diferencia de cada liquidación, y `/dashboard/chat` se lo cuenta desde su
propio sidebar. Los dos arreglos son de una línea sobre archivos byte-idénticos
en `master`:

```
git checkout master && git cherry-pick c02f0c4 ceb1a13
```

## Los cuatro CRÍTICOS

| ID | Estado | Commit |
|---|---|---|
| **A11P2-C1** · `puedeExportar('encargado')` contra `puedeVerArea('encargado','dinero')` | CERRADO con prueba | `c02f0c4` |
| **A11P2-C2** · `/dashboard/chat` sirve `getKpis`+`getAcreditables` desde el área del encargado | CERRADO con prueba | `ceb1a13` |
| **A11P2-C3** · las rutas de export daban 401 al superadmin, que proyecta el demo | CERRADO con prueba | `4504d90` |
| **A11P2-C4** · el arranque llamaba una RPC de una migración que no existe | CERRADO con prueba | `381af9d` |

Cinco más quedan **PROPUESTOS** con la razón escrita: dos exigen Postgres (RLS
del chofer 3/7 tablas, `tenant_self` `for all`), uno exige una decisión de
producto (el «listo» sin comprobantes cierra en $0.00), uno no es quirúrgico
(el cierre sin reloj, 58,000 ms) y uno es una sesión entera de trabajo (21 de
37 mutantes vivos, 12 en `analytics.ts`).

## Compuerta sobre el árbol final — máquina en reposo

```
$ npx vitest run     → exit 0 · 273 archivos · 2,554 pruebas · 1 saltada · 46s
$ npx tsc --noEmit   → exit 0
$ npm run lint       → exit 0 · CERO warnings
$ git status         → limpio
```

Al arrancar: 269 archivos / 2,530 pruebas. **+4 archivos, +24 pruebas**, todas
anclando los cuatro CRÍTICOS. Sin `npm run build`: en la nube pide credenciales.

Cuatro auditores reportaron entre 2 y 5 rojas mientras los doce corrían a la
vez; todas comparan tiempos de reloj contra umbrales fijos y todas pasan solas.
No es regresión, es carga — y que la suite dependa de la carga sí es hallazgo,
anotado en el rubro de pruebas.

## Cero falsos, contra uno en el pase 1

Lo que lo cambió fue prohibirle al auditor de pruebas mutar el árbol
compartido: aplicó sus 37 mutantes en una copia fuera del repo y devolvió el
árbol limpio, verificado.

**Un error que estuve a punto de publicar:** `git merge-base` decía «historias
no relacionadas» y la lectura obvia era que alguien había reescrito `master`
con un force-push. Es falso — el clon de la nube es superficial (`.git/shallow`)
y `git fetch --unshallow` lo desmiente. Queda escrito porque un hallazgo así,
sin comprobar, manda al dueño a buscar un incidente que no ocurrió.

## Requiere decisión humana antes del demo

1. **Transplantar `c02f0c4` y `ceb1a13` a `master`** — dos fugas de dinero
   vivas en producción, arregladas y probadas aquí.
2. **Qué se hace con este PR y con el #7.** Los dos auditan árboles que
   `master` dejó atrás. El #7 además tiene sus migraciones 0046-0053 chocando
   de ordinal con las de `master`, que ya llegó a la 0076: **hay que
   renumerarlas, no mergearlas.**
3. Las cuatro decisiones que el pase 1 dejó abiertas siguen abiertas: el
   dominio, el aviso de privacidad, la base del 50% del peaje, y el bucket
   `avatares`.
