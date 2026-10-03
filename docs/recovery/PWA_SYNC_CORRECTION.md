# Corrección del sincronizador PWA: snapshots V15

Fecha: 03/10/2026. Rama: `fix/pwa-historical-snapshot-sync`. Implementación local; no desplegada, sin push/merge ni recuperación productiva. Backend y Android sin modificaciones. Los resultados anteriores de investigación se conservan en `PWA_SYNC_RECOVERY_AUDIT.md` como evidencia del código anterior.

## Cambios exactos

`LocalToCloudMigrationService.migrateWorkouts()` usa `WorkoutApiService.createMobile()` → `POST /api/workouts/mobile`. El DTO está en `workout-api.models.ts`; el constructor/validador está en `migration/workout-snapshot.ts`. No se consulta ni compara la rutina actual para construir un entrenamiento histórico. Las referencias `routineId` y `exerciseId` se envían explícitamente como `null`: V15 admite snapshots independientes y evita bloquearlos por fuentes borradas, ajenas o editadas. Los IDs locales originales siguen en IndexedDB y en las claves del ledger; no se confunden con UUID de catálogo o de servidor.

El endpoint web anterior crea los ejercicios a partir de la rutina actual y requiere POST adicionales por serie. Mobile almacena nombre de sesión, filas de ejercicio, notas, instantes, zona y series conjuntamente en una transacción Spring. El servicio V15 devuelve el registro existente para un `clientId` ya creado, **no reemplaza sus datos**. Por ello un workout parcial creado anteriormente por web pertenece a clase C y necesita una reparación individual aprobada; repetir mobile no lo arregla.

Se conservan nombres históricos sin sustituirlos por catálogo, orden de ejercicios, `setIndex + 1`, kilos y repeticiones sin redondear, observaciones como notas de ejercicio y los instantes ISO originales incluidos sus milisegundos. Cada ejercicio omitido del snapshot permanece omitido; un ejercicio presente pero no realizado conserva su nombre/nota y `sets: []`. Una serie con cualquiera de los dos campos nulo se considera planificación incompleta y no se transmite. Sus campos parciales permanecen en el historial y backups: no se convierten en ceros. Si ambos valores existen pero incumplen límites/tipos, se bloquea el envío para revisión. No se inventa trabajo realizado. Hay límites V15 de nombres, notas, ejercicios, posiciones/números y UUID; no se truncan datos para pasar validación.

`ResourceMapping.snapshotPayload` almacena la propuesta completa y sus UUID de fila/serie; `snapshotMode` diferencia `new` de `recovery`. El ledger se guarda antes de invocar HTTP. Los reintentos usan esa misma propuesta, sin reconstruirla desde una rutina ni desde ediciones posteriores. Los UUID existentes de workout/serie se conservan; los IDs nuevos se generan al preparar y permanecen dentro del cuerpo persistido. Si la respuesta tiene otro snapshot, o el historial local cambió durante un envío ambiguo, la operación queda `blocked`; se conserva la propuesta y el `serverId`. La lectura local no oculta ese snapshot bloqueado solo por tener identidad remota.

El DTO de respuesta contempla los nombres/instantes V15 y `exerciseId` nulo. Historial/detalle muestran el nombre snapshot antes de consultar nombres actuales; las referencias nulas no generan peticiones de catálogo. Los benchmarks por ID de catálogo no fusionan ejercicios sin referencia por el mero nombre.

## Sesiones nuevas y barrera histórica

Una sesión **local nueva** captura `Intl.DateTimeFormat().resolvedOptions().timeZone` en su inicio, en `ActiveTraining.calendarZone`. Al finalizar se conserva ese campo en `WorkoutHistory`, junto con los instantes originales. Se crea una operación `snapshotMode: new` y se envía normalmente, aunque la rutina/exercicio actual ya no exista o su migración esté bloqueada. El código de captura no se ejecuta al reanudar una sesión antigua ya almacenada. Esa sesión sin zona queda retenida para confirmación histórica.

El flujo cloud interactivo existente es diferente: crea una sesión en curso por web al iniciar, guarda series válidas de forma incremental y finaliza por PATCH. No pasa por las validaciones de migración corregidas y no se reenvía ese registro por mobile. Sus clientId/series ya persistidos permanecen. Cambiarlo a mobile al finalizar usando el mismo clientId no repararía la sesión preexistente; sería otra modificación y requiere revisar ese ciclo completo. Esta corrección cubre los snapshots locales completados y su preparación histórica.

Las altas manuales de históricos carecen de zona capturada en el momento entrenado y tampoco se envían automáticamente. No se les asigna la zona actual del dispositivo.

Las operaciones antiguas, incluidas `pending` sin `snapshotMode: new`, `unsupported`, `failed` y `blocked`, **no se convierten automáticamente** al nuevo endpoint. Los registros de atención de ejercicios/rutinas tampoco se reintentan en `start()` por tener ese estado. Sin trabajo nuevo elegible o dependencias pendientes, `start()` devuelve el ledger sin modificarlo. Durante sincronización nueva puede actualizar metadatos generales/progreso, pero no restablece los estados ni errores de las operaciones históricas. Las opciones explícitas de resolución de ejercicios existentes siguen siendo acciones del usuario. No hay migración nueva de esquema Dexie, ningún clear/delete, ni botón de replay masivo.

`getProgress().pending` excluye workouts históricos retenidos y propuestas `recovery`, evitando un bucle de temporizadores. El contador rojo sigue describiendo operaciones/referencias, no necesariamente 75 entrenamientos; el doble cómputo de una referencia fallida sigue caracterizado. No se ha obtenido el ledger físico para clasificar esos 75.

## Política de zona histórica

La recuperación exige una zona IANA **confirmada por el usuario para la sesión o grupo seleccionado**, sin valor implícito. `inspectRecovery(accountId, confirmedZone, localIds?)` permite limitar la selección; `prepareRecovery()` siempre limita al ID indicado. Si hubo viajes, confirmar zonas por sesión/grupo. No asumir que `Europe/Madrid` es correcta porque el dispositivo actual la use. Si la zona de una sesión es desconocida, retenerla y documentar la limitación; no enviarla como recuperación aprobada. V15 requiere esa zona para la fecha del calendario.

Confirmar zona **no desplaza** `startedAt` ni `finishedAt`. Se mandan literalmente como instantes UTC/offset originales; Spring calcula las horas locales del calendario usando la zona confirmada. Una propuesta ya persistida con otra zona requiere revisión explícita, no regeneración silenciosa.

## Copia del teléfono: acciones personales exactas

1. Conservar la instalación original y el JSON schemaVersion 2 independiente. Poner el teléfono en modo avión y apagar Wi-Fi/datos **antes de abrir o recargar** la PWA. No actualizarla, restaurar, importar, cerrar sesión ni borrar datos. Si está abierta, inspeccionar sin recarga. La transacción exportadora es de solo lectura; una app abierta puede tener tareas propias, por eso se obtiene una captura consistente en una única transacción y se evita la red.
2. Android: activar Opciones de desarrollador → Depuración USB; conectar un cable de datos al Windows y autorizar la huella del ordenador. Chrome Windows: abrir `chrome://inspect/#devices`, activar Discover USB devices y pulsar Inspect en la página/origen **exacto** del PWA. Si la instalación pertenece a otro navegador, detenerse y localizar su almacenamiento: el de Chrome no demuestra el del otro navegador.
3. En DevTools → Application → IndexedDB comprobar `GymTrackerDB`, `workoutHistory`, `routines` y **`migrationLedgers` (plural)**. No tocar cookies/tokens ni botones de borrado. Dexie declara versión 9; la versión nativa mostrada por IndexedDB puede ser 90. No introducir un número de versión al abrir la base.
4. Abrir en el PC `docs/recovery/export-phone-ledger.js`, revisar y copiar **su contenido completo** a Console del origen correcto. El script confirma existencia con `indexedDB.databases()`, abre sin versión, aborta `onupgradeneeded`, lee stores permitidos con `database.transaction(stores, 'readonly')` y cierra la conexión. No lee localStorage, cookies, cabeceras, JWT ni otros stores privados. No solicita red. Si falta la base o un store esencial, cancela. Puede requerir habilitar pegado en DevTools tras revisar el script.
5. El archivo `gym-tracker-forensic-*.json` se descarga en **el teléfono**. Comprobar Descargas y transferirlo al PC por USB. Si la descarga falla, detenerse; no sustituirla por un reset. Conservar otra copia independiente de ambos JSON, de forma privada.
6. Ejecutar la verificación siguiente, sustituyendo solo rutas. La opción Bypass se limita a ese proceso de PowerShell; no cambia la política permanente. El script únicamente lee los dos JSON. No ejecutar sobre Android/Room.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Proyectos\gym-tracker\docs\recovery\verify-backups.ps1 -HistoryBackup "C:\ruta\privada\backup-schema2.json" -LedgerBackup "C:\ruta\privada\gym-tracker-forensic-XXXX.json"
```

La comprobación requiere schemaVersion 2, stores esenciales y ledger no vacío; compara cada ID histórico, instantes literales, rutina, nombres/orden de ejercicios, observaciones y cada serie (incluido nulo frente a cero). Emite solo recuentos/estados y SHA-256, no entrenamientos ni credenciales. Si hay diferencias legítimas por ediciones posteriores, **detenerse y analizarlas**, no sobrescribir una copia con la otra. Verificar también las dos copias independientes mediante sus hashes. Inspeccionar visualmente en privado que el ledger de la cuenta correcta tiene mapas `exercises/routines/workouts/sets`; conservar estados, errores y propuestas exactas. Ninguna prueba de escritorio acredita que el backup del teléfono ya existe: esta comprobación real sigue pendiente.

## Conciliación de solo lectura

`inspectRecovery()` no llama a `getLedger()` ni crea registros/cachés. Lee historial y todos los ledgers para respetar propietarios y consulta:

- `GET /api/users/me` mediante `AuthApiService.getCurrentUser()` para comprobar la cuenta, antes de cada página y al terminar.
- Todas las páginas de `GET /api/workouts?page=N&size=50&sort=id,asc`.
- `GET /api/workouts/{id}` para cada elemento, sin confiar en una caché parcial.

Cancelar si la cuenta difiere, falla una petición, cambian los totales, faltan detalles o aparecen IDs duplicados. No se usa ningún POST de workouts durante esta inspección. Los interceptores existentes pueden renovar autenticación; no registrar ni exportar sus tokens. Esta utilidad no está conectada a arranque, timers ni a un botón de envío. Su ejecución real debe organizarse en una sesión controlada con auto-sync detenido antes de volver online; no abrir la instalación antigua con red para obtener estos datos. Alternativamente el operador autorizado puede recopilar esas respuestas GET o una consulta de BD de solo lectura y compararlas con la copia independiente.

Se une `workoutHistory.id` con la clave del ledger, después con `serverId`/`clientId` remotos. Se comparan ambos instantes, zona, nombre de sesión, nombres/orden/notas históricos y series realizadas (número, kg, reps, RPE). Los IDs remotos de filas no deben coincidir con los UUID locales por accidente; las identidades persistidas están en el ledger/propuesta. La igualdad temporal sin identidad solo señala ambigüedad: **no fusiona** ni autoriza un envío. Sin mapping persistido tampoco se afirma ausencia; revisión manual primero.

| Clase de esta implementación | Criterio | Acción posterior |
| --- | --- | --- |
| A | Identidad y snapshot completo confirmados remotamente | No enviar; registrar/revisar enlaces en una fase aprobada. |
| B | clientId persistido ausente tras listado completo, sin remoteId desaparecido ni coincidencia temporal sospechosa | Candidato a preparar individualmente, con backups y zona confirmados. |
| C | Identidad existente con contenido incompleto/diferente, incluido antiguo web | Plan de reparación específico conservando identidad; mobile no actualiza el existente. |
| D | Sin mapping, IDs contradictorios, coincidencia temporal sin identidad o datos inválidos | Revisión manual; no regenerar ID, fusionar ni reenviar. |

Las letras de esta tabla siguen la solicitud de corrección actual; la tabla de la auditoría original usa otra ordenación de clases y permanece como evidencia anterior. La conciliación no es una transacción entre páginas remotas: los controles detectan cambios de cuenta/totales/duplicados, pero antes de cualquier replay se debe repetir en una ventana sin escrituras concurrentes y confirmar despliegue V15. La igualdad de total no demuestra que nadie editó un registro entre consultas.

`prepareRecovery(accountId, localId, historicalZone, {backupsVerified, historicalZoneConfirmed})` exige ambas confirmaciones y una conciliación B fresca. En una transacción local añade únicamente la propuesta y `snapshotMode: recovery`. No cambia el estado `unsupported`, el error/razón originales ni el historial; no envía HTTP. Las confirmaciones son una barrera de operador, no un verificador criptográfico automático del backup: usar antes el verificador de archivos.

`recoverPreparedWorkout(accountId, localId, {backupsVerified, historicalZoneConfirmed, replayApproved})` implementa la ejecución **individual** para una fase futura aprobada. Sin las tres confirmaciones o propuesta `recovery`, falla antes de HTTP. Comprueba que el historial no cambió desde la propuesta y repite la conciliación. Para A confirma detalle y enlaza sin POST; para B envía exactamente el cuerpo persistido; C/D no se envían. Verifica respuesta y hechos locales antes de marcar `migrated`. Si se pierde la respuesta, conserva el estado y error originales, añade `recoveryError` y la siguiente ejecución explícita puede encontrar A y enlazar sin repetir POST. Los mappings de series existentes se enlazan por clientId. No existe llamada a este ejecutor desde arranque, temporizadores, sincronización normal ni Ajustes; actualizar la PWA no reproduce la cola histórica. **Solo se ha probado con datos sintéticos; no está autorizada su ejecución real en este turno.**

## Recuperación posterior y Android

Después de verificar ambas copias, confirmar zonas, verificar la versión efectivamente desplegada de Render y obtener la conciliación por registro: aprobar separadamente la ejecución individual que solo envía B usando el cuerpo persistido, repite conciliación antes del primer envío y confirma GET posterior. No resetear ledger ni reenviar la cola completa. A no se recrea; C y D requieren planes propios. Un timeout/5xx no prueba ausencia de commit. Detener la sincronización normal durante preparación/ejecución supervisadas: el ledger es un documento por cuenta y no se deben ejecutar ediciones concurrentes desde otras pestañas o sincronizadores.

Los nuevos snapshots remotos ausentes en Room deben descargarse mediante la sincronización existente de Android, bajo la misma cuenta. No se necesita importador JSON. **Los registros parciales ya existentes en Room necesitan revisión específica**: el lector Android inspeccionado previamente no rellena automáticamente todas las series de una identidad ya conocida. No afirmar que un posterior arreglo remoto actualizará esas filas sin verificar ese comportamiento. Android permanece intacto.

## Verificación local

- Suite completa ChromeHeadless: **171/171** correctas. Incluye completo, parcial, ejercicio saltado, rutina editada, ejercicio/fuente eliminado, fin temprano, instantes con milisegundos, notas, cuerpo durable antes de POST, reintento idéntico con respuesta perdida y un único registro remoto simulado, edición local posterior retenida, no replay de legacy/unsupported, conciliación A/B/C/D, cuenta incorrecta y páginas incompletas; además, ejecución individual sintética con rechazo sin aprobación y respuesta perdida conciliada sin segundo POST.
- Test de ruta HTTP: cuerpo V15 exacto a `/api/workouts/mobile` y contexto de reintento idempotente. Ninguna prueba usa el backup real.
- `node docs/recovery/export-phone-ledger.check.cjs`: **4/4** verificaciones sintéticas del contrato readonly, ausencia de base/store, aborto de upgrade y exclusión de autenticación. Dobles de IndexedDB; no prueba hardware ni descarga real en Android.
- `powershell -NoProfile -ExecutionPolicy Bypass -File docs/recovery/verify-backups.check.ps1`: **2/2**; acepta copia sintética exacta, rechaza cero inventado y no altera el input.
- `npm run build`: correcto. Avisos: bundle inicial 674,43 kB frente a aviso 500 kB y seis CSS existentes sobre presupuesto de aviso; no se cambian presupuestos ni estilos.
- Spring se inspeccionó solo en lectura (DTO/service V15 y tests existentes). No se ejecutaron tests Maven ni se comprobó Render contra datos productivos. No se requieren cambios de backend para este contrato.

Comandos reproducibles:

```powershell
$env:CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
node docs/recovery/export-phone-ledger.check.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File docs/recovery/verify-backups.check.ps1
```

## Pendiente del usuario antes de despliegue/recuperación

1. Obtener la copia física del ledger y verificarla junto con schemaVersion 2; guardar dos copias privadas con hashes coincidentes.
2. Confirmar zona histórica por sesión/grupo e identificar zonas desconocidas; no enviar esos registros.
3. Facilitar únicamente recuentos por store/estado y resultado de verificación, nunca tokens ni datos personales completos.
4. Aprobar una sesión de conciliación real controlada y revisar las clases individuales; confirmar qué código V15 está desplegado.
5. Aprobar por separado despliegue y plan de recuperación. Ejecutar el proceso supervisado solo después de esa aprobación; empezar por un registro B y verificarlo en backend/Android antes de ampliar. No activar un proceso masivo automático.

No se ha ejecutado ninguna de estas acciones sobre producción ni sobre el teléfono.
