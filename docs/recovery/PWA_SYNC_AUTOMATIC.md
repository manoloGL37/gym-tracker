# Sincronización automática PWA → Render

04/10/2026. Continuación de `f968bf1`, rama `fix/pwa-historical-snapshot-sync`. Implementación local; sin push, merge, despliegue ni replay de datos reales. Backend y Android intactos.

Esta decisión sustituye las barreras de backup verificado, selección de sesiones y aprobación de replay descritas en los informes anteriores **para el flujo habitual**. Los archivos y la revisión manual siguen como herramientas avanzadas opcionales.

## Comportamiento habitual

`AuthSessionService` ya inicia `AccountSyncService` al autenticar/restaurar la cuenta. Ahora este llama a `LocalToCloudMigrationService.synchronizeAccount()`:

1. Obtiene el Web Lock nativo `gym-tracker-ledger`, compartido con otras pestañas, la migración anterior y las herramientas avanzadas. Sin Web Locks no transmite. Las decisiones de catálogo, zona y defaults también esperan ese lock. La creación inicial del ledger se serializa en una transacción IndexedDB.
2. Comprueba conexión y cuenta mediante `/api/users/me`. Consulta el historial remoto paginado completo, verifica totales, páginas e identidades, y obtiene detalles de las identidades relevantes. Cada petición de workout queda ligada a la cuenta, incluido el refresh de autenticación. Las altas de dependencias también llevan la cuenta esperada y timeout.
3. Reutiliza `inspectRecovery()` para clasificar cada identidad local, incluidos antiguos `unsupported`, `failed`, `blocked`, propuestas de recuperación y registros marcados anteriormente como migrados.
4. A: confirma el snapshot remoto y enlaza sin POST. B: persiste identidad, cuerpo exacto y presupuesto antes del POST móvil. C/D: conserva el histórico, registra el motivo y continúa con las demás sesiones.
5. Comprueba identidad, snapshot de la respuesta y hechos locales antes de marcar `migrated`. El progreso se actualiza tras cada escritura. Una cola local vacía nunca marca éxito mientras la conciliación remota sigue en curso o ha fallado.

El snapshot sigue usando la implementación de `ac67cb2`: instantes originales, nombres/orden históricos, notas y valores realizados, sin depender de la rutina actual; series incompletas excluidas y ejercicios saltados con `sets: []`. El original permanece en `workoutHistory`; no hay migración de esquema, borrado ni restauración.

## Journal, respuestas perdidas y reintentos

El ledger conserva `clientId`, `snapshotPayload`, `snapshotMode`, zona histórica confirmada y `automaticSync`: clasificación, última confirmación, intentos, próxima fecha permitida y estado/error originales. `recoveryError` comunica el fallo actual sin borrar la evidencia anterior. Se guarda antes de transmitir, incluyendo el intento, para que un cierre durante el POST no reinicie el presupuesto.

- Máximo cinco intentos de envío por identidad ausente. Backoff de 5, 15, 45 y 60 segundos, con techo de 60 segundos; no se consume otro POST antes del plazo.
- Los fallos de lectura global tienen otro presupuesto de cinco intentos y fecha de reintento persistidos en `syncRetry`. Un fallo de listado/detalle/cuenta no demuestra ausencia y no habilita POST.
- `AccountSyncService` termina sus temporizadores automáticos después de cinco pasadas pendientes/fallidas. Los eventos online/foreground pueden intentar reanudar, pero no saltan el presupuesto o plazo durable de los envíos/lecturas. Offline no elimina datos ni consume intentos HTTP.
- Tras una respuesta perdida, la siguiente pasada consulta primero el estado remoto. Si encuentra A, enlaza aun dentro del backoff y sin otro POST. Si confirma B, solo repite el cuerpo persistido cuando el presupuesto/plazo lo permiten. No hay replay móvil en el interceptor HTTP.
- Al agotar intentos, Ajustes conserva atención/espera y ofrece **Reintentar sincronización**, que abre un nuevo presupuesto explícito; no borra propuestas ni estados ambiguos.
- Cambiar cuenta cancela la transmisión mediante el contexto HTTP y las comprobaciones de `/me`; la UI ignora resultados de la cuenta anterior. Las claims durables evitan enviar históricos de otra cuenta del dispositivo.

## Zonas y casos ambiguos

Se usa la zona capturada al entrenar, una propuesta histórica ya persistida o una confirmación histórica explícita ligada al mapping. Si faltan esos datos, también puede confirmarse una zona remota cuando una única identidad coincide y ambos instantes originales concuerdan exactamente. Esto solo permite conciliar ese registro existente; no inventa la zona de otros entrenamientos.

Para las sesiones restantes, Ajustes ofrece un único formulario de zona IANA y periodo opcional. Los límites se comparan con la fecha UTC literal del registro y están etiquetados así. El botón confirma explícitamente esa zona para las sesiones indicadas, sin archivos ni selección individual; la sincronización continúa sola. Viajes requieren confirmar periodos distintos. Nunca se desplazan instantes ni se usa silenciosamente la zona actual del Xiaomi.

Sin identidad legacy persistida no se afirma ausencia: se muestra la sesión como ambigua y se conserva. Identidades compartidas por varias filas locales, varios candidatos remotos, identidad de detalle distinta, coincidencia temporal sin identidad, serverId desaparecido, datos inválidos o cambios locales respecto a una propuesta también quedan retenidos. No se fusionan por nombre/fecha ni se genera otra identidad para ocultar conflictos.

## Los antiguos 75 elementos

El número agrupaba operaciones y dependencias, no sesiones. Las sesiones recuperables dejan atención tras confirmación del backend, y los mappings de series se enlazan por su clientId. Las referencias de ejercicios/rutinas independientes que sigan sin resolver conservan su tarea; los snapshots de workouts no dependen de ellas. Los parciales/ambiguos permanecen identificados por nombre, fecha y motivo. Sin el IndexedDB del teléfono no se puede predecir el recuento final ni afirmar que las 99 sesiones se subirán.

## Registros remotos parciales: contrato y corrección mínima

Inspeccionado el backend independiente en lectura: HEAD `2c57da4`; árbol limpio. V14 almacena instantes/zona para mobile; V15 añade snapshots de nombres, clientId de filas y referencias de ejercicio nulas. `WorkoutService.createMobileWorkout()` retorna inmediatamente un clientId existente, sin actualizar su grafo. PATCH de workout y POST de series no sustituyen de forma atómica todo el snapshot histórico.

Por ello **C no se reenvía, duplica ni sobrescribe**. Una reparación completa necesitaría un endpoint específico, autorizado por propietario, con una precondición del snapshot observado (versión o digest), bloqueo transaccional y rechazo 409 ante cambios. Debe conservar workoutId/clientId, comprobar colisiones/series, modificar hijos y metadata atómicamente y devolver el grafo confirmado; un reintento ya aplicado debería devolver el mismo resultado. Antes de implementarlo hay que demostrar que el contenido remoto distinto es reparable y que sus hijos no contienen trabajo válido ajeno a la propuesta. No existe esa evidencia para los datos reales, y no se introduce una sobrescritura automática. Este cambio de PWA conserva un estado C veraz y no requiere modificar Spring Boot.

Android no cambia. Su sincronización existente descarga nuevas identidades. No se promete que complete automáticamente registros parciales ya existentes en Room.

## Evidencia pública de Render

GET público, sin credenciales, a [OpenAPI de Render](https://gym-tracker-api-s70k.onrender.com/v3/api-docs): primer intento con timeout de 55 segundos, segundo intento HTTP 200. OpenAPI 3.1.0 anuncia `/api/workouts/mobile`, autenticación bearer, idempotencia por usuario/clientId, snapshot autoritativo e instantes/zona. Los DTO publicados contienen `nameSnapshot`, `exerciseNameSnapshot`, `startedAtInstant`, `completedAtInstant`, referencias opcionales y sets.

SHA-256 del documento público leído: `298afc4fa5ffc5db378858c1ee31e572dcc26227a9cacce823235b46d0d901a6`. Esta evidencia verifica el contrato publicado compatible con V15, no el contenido de tablas Flyway ni una transacción autenticada real. No se ha enviado un POST, usado un token ni consultado entrenamientos reales. El bloqueo anterior de OpenAPI inaccesible queda resuelto; no se necesita release de backend para importar B.

## Validación y autorización posterior

- Suite Angular/ChromeHeadless: 202/202 pruebas sintéticas. Incluye unsupported, incompletas/saltados/rutinas cambiadas, A/B/C/D, duplicados locales/remotos, HTTP perdido y reinicio, offline→online, timeout, cuentas, lock concurrente, backoff persistido y presupuesto agotado, trabajo nuevo durante una pasada, respuestas sin identidad válida, fallos de lectura de progreso, estado sin falso éxito y zona por periodo sin wizard.
- Build de producción correcto. Se mantienen avisos de bundle inicial y seis CSS; no se relajan presupuestos.
- Revisión visual local con perfil Chrome temporal y respuestas API sintéticas interceptadas (service worker omitido): 390/1280 px, sin overflow horizontal, controles nuevos de 44–48 px, formulario puntual de zona y errores C/D visibles; wizard fuera de Tus datos. Detector: un aviso estático sobre el botón anterior de retorno, cuyo color renderizado usa la tinta existente. No acredita una prueba física en Xiaomi.
- La PWA queda preparada para solicitar autorización posterior de despliegue, aceptando que C/D siguen pendientes. La compatibilidad publicada de Render está comprobada. La comprobación física en Xiaomi y descarga Android de nuevas sesiones se harán después del despliegue autorizado, conservando el almacenamiento de la instalación original.

```powershell
$env:CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test -- --watch=false --browsers=ChromeHeadless --reporters=dots
npm run build
```
