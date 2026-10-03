# Auditoría forense de sincronización del PWA

> **Actualización tras autorización de implementación (03/10/2026):** la corrección local, barreras de no replay, política de zona histórica, conciliación A/B/C/D y resultados actuales están en [PWA_SYNC_CORRECTION.md](PWA_SYNC_CORRECTION.md). El cuerpo siguiente conserva los hallazgos del código anterior; sus referencias a «no se ha cambiado el sincronizador», endpoint web y pruebas 16/16 describen esa fase previa. No se ha desplegado ni recuperado producción. La copia real del ledger sigue pendiente. El script de exportación siguiente es el mismo que `export-phone-ledger.js`, verificado con dobles sintéticos de IndexedDB.

Fecha: 3 de octubre de 2026. Alcance: código de `gym-tracker` y lectura del repositorio `C:\Proyectos\gymtracker-api`; **no se ha accedido al teléfono, a Render ni a datos reales**. La versión instalada en el teléfono y el despliegue real de la API aún deben confirmarse. El estado «75 elementos» es una observación del usuario, no un dato reproducido localmente.

## Hallazgo principal: significado de 75

`SettingsComponent.syncStatusText()` muestra `AccountSyncService.state().attention`; el punto rojo corresponde a `status() === 'attention'` (`src/app/pages/settings/settings.component.ts`, plantilla `.html`). `LocalToCloudMigrationService.getProgress()` calcula exactamente:

```text
attention = referencias de ejercicio sin resolver
          + mappings de ejercicios/rutinas/entrenamientos con estado blocked, failed o unsupported
```

No cuenta `sets` en atención; sí cuenta sets confirmados en `completed` y `total`. Una referencia con mapping `failed` figura tanto en `unresolvedReferences()` como en los mappings `failed`, por lo que **puede sumar dos unidades al indicador**. El test sintético añadido caracteriza esta duplicación. Por ello 75 no significa 75 entrenamientos, ni necesariamente 75 operaciones distintas. Puede incluir ejercicios, rutinas y entrenamientos; también una misma causa propagada a varias rutinas y sesiones. No incluye eliminaciones, peso, backups ni sesiones activas cloud. No existe una tabla genérica de operaciones: la «cola» son cuatro mapas (`exercises`, `routines`, `workouts`, `sets`) dentro de un ledger por cuenta.

`pending` cuenta mappings primarios con estado `pending`; `pendingWorkouts` cuenta entrenamientos `pending` o `blocked`. La presencia de atención tiene prioridad visual sobre `pending`, aunque queden reintentos pendientes. El valor preciso y sus componentes solo pueden conocerse leyendo el ledger **del teléfono**.

## Almacenamiento real y ciclo completo

La base local es IndexedDB mediante Dexie, nombre `GymTrackerDB`, esquema actual v9 (`src/app/data/active-training.repository.ts`). Sus stores son `activeTraining`, `cloudActiveTraining`, `workoutHistory`, `routines`, `selectedRoutine`, `bodyWeight`, `migrationLedgers`, `accountRoutineCache`, `accountWorkoutCache` y `accountExerciseCatalogCache`. `workoutHistory` contiene `id`, `routineId`, `routineName`, `startedAt`, `finishedAt`, ejercicios con `exerciseId`, `name`, series con `setIndex`, `reps`, `weight`, y `observation` opcional. `migrationLedgers` está indexado por `accountId` de `/api/users/me`, con defaults y mappings por entidad. Los mappings guardan `clientId`, `serverId` opcional, estado, `claimedAt`, `error` opcional y `localOnlyReason` opcional; el ledger guarda `createdAt` y `updatedAt`. **No hay número de intentos ni fecha por operación**. `localStorage` contiene preferencias, pistas de sesión, usuario en caché y metadatos de backup/dispositivo; el token de acceso es una señal en memoria y el refresh usa cookie HttpOnly. No se necesita `localStorage` para recuperar el historial.

La vista de historial autenticado mezcla `workoutHistory` con la última página remota guardada en `accountWorkoutCache` (`LocalFirstReadService`). Por eso ver una sesión en el PWA no demuestra por sí solo que sea una fila de `workoutHistory` ni que siga existiendo en el backend. La copia forense incluye también esa caché para identificar el origen de lo mostrado; la caché no es prueba remota actual.

Hay dos recorridos para terminar una sesión (`src/app/pages/training/training.component.ts`):

1. **Sesión local heredada:** `confirmFinish()` toma una marca ISO de fin, crea `workoutHistory.id` concatenando inicio y fin, guarda la sesión completa con `WorkoutHistoryRepository.add()` y solo después llama a `AccountSyncService.notifyPendingWork()`. El backup automático separado se dispara de forma asíncrona. Después borra la sesión activa y la selección. Un cierre justo después de guardar puede dejar el historial sin mapping hasta el próximo `start()` de sincronización; el historial persiste.
2. `AuthSessionService` inicia `AccountSyncService` tras confirmar `/me`. `LocalToCloudMigrationService.start()` llama `ensureClientIds()`: asigna UUID estables a rutina, workout y cada set no migrado, y **guarda el ledger antes del primer POST**. La clave de ejercicio es `exercise:<id local>`; la de serie, `workout:<id workout>:exercise:<id ejercicio>:set:<índice>`.
3. Resuelve ejercicios locales: UUID y nombre válido permiten crear ejercicio custom; los IDs antiguos ambiguos exigen decisión de usuario. Crea ejercicios, después rutinas, después workouts y sus series. Una rutina depende de todos sus ejercicios; un workout depende de su rutina. `chooseCatalogExercise()` y `chooseCustomExercise()` son las únicas resoluciones expuestas en Ajustes.
4. Antes de crear el workout, `unsupportedWorkoutReason()` exige que exista su rutina **local actual**, que la cantidad y el orden de ejercicios coincidan exactamente con el snapshot histórico y que cada serie tenga repeticiones enteras ≥1 y peso finito entre 0 y 9999,99. Si falla, marca workout y sets `unsupported`, preservando el historial local. Esta comparación con la rutina mutable explica de forma demostrable cómo una rutina editada o borrada bloquea entrenamientos anteriores, pero no prueba que sea la causa de los 75 del teléfono.
5. Si la rutina remota no está confirmada, marca workout `pending` cuando la rutina está `pending`, o `blocked` en los demás casos. Si está confirmada, envía `POST /api/workouts` con `clientId` del ledger, `routineId` remoto y `startedAt`/`completedAt` convertidos de los ISO locales a `LocalDateTime` sin zona ni fracciones (`toBackendLocalDateTime`). No cambia los ISO del historial local. La API crea el workout y copia los ejercicios de la rutina remota. El cliente guarda `serverId` **antes** de enviar series; empareja ejercicios de la respuesta por posición y envía una serie por POST con `clientId` estable y `setNumber = setIndex + 1`. Guarda cada confirmación; solo al final marca workout `migrated`.
6. El backend actual aplica `@Transactional` a cada creación de workout o serie. `clientId` es único por usuario para workout y por ejercicio de workout para set (índices V12). Una respuesta perdida puede representar un commit real; repetir exactamente el mismo `clientId` devuelve el recurso existente. La transacción **no abarca** workout más todas sus series: es posible un workout remoto incompleto con algunas series ya guardadas.

Para sesiones que empezaron directamente en modo cloud, `selectedRoutine` y `cloudActiveTraining` guardan IDs/drafts; se crea el workout al inicio, cada serie se sube por separado y `confirmFinish()` hace `PATCH completed:true`, usando la hora del servidor. **Este recorrido no genera los mappings del contador de 75**. Puede tener otros pendientes, que requieren revisar `cloudActiveTraining` por separado.

## Estados, errores y controles visibles

`pending` representa trabajo nuevo o errores HTTP 0, 408, 429, 5xx o `TimeoutError`. El interceptor HTTP (`resilient-http.interceptor.ts`) hace hasta dos reintentos breves solo para GET y POST marcados como seguros; el coordinador reintenta `pending` con esperas 5, 15, 45 y máximo 60 segundos, o al recuperar red/primer plano. `blocked` indica dependencia no resuelta o no confirmada; `unsupported`, incompatibilidad histórica local; `failed`, cualquier otro error, incluidos HTTP 400, 401, 403, 404, 409, 422 y errores JavaScript no clasificados. Un fallo de renovación 401 puede invalidar la sesión; el ledger sigue en IndexedDB.

**Matiz importante:** `AccountSyncService` no programa reintentos periódicos si `pending=0`; por eso el indicador rojo queda estable. No obstante, un nuevo login/restauración o `retryNow()` vuelve a ejecutar `start()`, y esta rutina **sí vuelve a intentar mappings `failed` y `blocked` cuando sus dependencias ya permiten llegar al POST**. `unsupported` se salta en ejecuciones posteriores. Por tanto no existe una regla general de «nunca reintentar atención». No se debe provocar ninguno de estos reintentos en el teléfono antes de tener copia y reconciliación.

El mapping conserva `error` como cadena de `Error.message`, no un campo estructurado con HTTP status, cuerpo, código de negocio o historial de intentos. Las rutas de dependencia lo sobrescriben con un texto genérico; un retry también puede reemplazarlo o borrarlo. `unsupported` conserva `localOnlyReason`. Se conservan el workout local y los IDs de cliente, salvo que alguien restaure/importa datos de forma destructiva. En `SettingsComponent.html` solo hay botones para referencias de ejercicios ambiguas; no hay lista ni acción de inspección/reconciliación de rutinas, workouts o errores, y el punto rojo no es interactivo.

## Compatibilidad con la API y V15

El código actual de Spring conserva `POST /api/workouts` y `POST /api/workouts/{id}/exercises/{exerciseId}/sets`, con las formas que usa el PWA. V15 añade nombres snapshot, client ID de fila de ejercicio y `POST /api/workouts/mobile` para un snapshot completo; **no elimina el contrato web**. No se ha demostrado una incompatibilidad de V15. La API web solo acepta una rutina propia no borrada para crear el workout y reconstruye sus ejercicios actuales; no admite añadir ejercicios después. El nuevo endpoint móvil admitiría snapshots históricos independientes, pero el sincronizador PWA no lo usa. V15 rellena nombres anteriores con nombres *actuales* cuando puede, sin recrear nombres de fechas pasadas. Las fechas web históricas son `LocalDateTime` sin zona original; el historial local conserva las marcas ISO exactas y debe ser la referencia al verificar horas.

Posibles bloqueos **condicionados a evidencia del teléfono**: 400 por validación, número de serie duplicado, fecha final anterior a inicial tras conversión o snapshot de respuesta distinto; 404 por rutina remota borrada/ajena o ejercicio/workout de serie ausente; 401/403 por sesión/permisos; 409/422 si un despliegue responde así; 0/408/429/5xx por red o servidor. Un 5xx o timeout no demuestra ausencia de commit. Un `clientId` presente remotamente con mapping local `failed` o `pending` obliga a reconciliar antes de cambiar nada. El `error` local y la respuesta real permitirán acotar cada caso; sin ellos sería especulación atribuir los 75 a una sola causa. Tampoco se ha verificado que la API desplegada en Render corresponda exactamente al repositorio leído.

## Copia independiente del teléfono: procedimiento seguro

**Primero**: mantener la instalación, el perfil de navegador y el teléfono intactos. Poner el teléfono en modo avión y comprobar Wi‑Fi y datos móviles apagados **antes de abrir o recargar el PWA**: abrirlo autenticado con red inicia sincronización automática. Si la página ya está abierta, inspeccionarla sin recargarla; si hay que abrirla offline, puede aparecer como desconectada, pero la exportación de IndexedDB no depende de que la UI esté autenticada. Mantenerlo sin red durante toda la exportación y no interactuar con entrenamientos. No usar «Restaurar», «Importar», «Borrar datos del sitio», desinstalación, cierre de sesión ni actualizaciones del PWA. El botón «Exportar» integrado solo contiene `routines`, `workoutHistory` y `bodyWeight` (`BackupService`); **no** contiene `migrationLedgers`, series pendientes cloud ni sus IDs de sincronización. Puede guardarse como segunda copia, nunca como única copia forense. El backup automático en otro servidor es oportunista y tampoco incluye el ledger.

En Windows, conectar el Android por USB con cable de datos, activar temporalmente *Opciones de desarrollador → Depuración USB* y aceptar en el teléfono la huella de este ordenador. Abrir Chrome de escritorio y `chrome://inspect/#devices`, activar **Discover USB devices**, localizar la página/origen exacto del PWA instalado y pulsar **Inspect**. Si no aparece, verificar que el PWA pertenece a Chrome; una instalación de Samsung Internet o un WebView propio puede tener almacenamiento distinto y requerirá su depurador. En DevTools → Application → IndexedDB comprobar que existe `GymTrackerDB` y que hay `workoutHistory` y `migrationLedgers`; verificar el origen en la barra, sin inspeccionar cookies o tokens. No pulsar controles de borrado. La consola de DevTools ofrece una exportación de stores elegidos mediante transacción `readonly`. Ejecutar este bloque **solo en el origen correcto y sin red** (Chrome puede pedir escribir `allow pasting` para pegar código):

```js
(async () => {
  const name = 'GymTrackerDB';
  const required = ['workoutHistory', 'routines', 'migrationLedgers'];
  const optional = ['activeTraining', 'cloudActiveTraining',
    'selectedRoutine', 'accountWorkoutCache'];
  const known = await indexedDB.databases();
  if (!known.some(entry => entry.name === name)) throw new Error('Base ausente; exportación cancelada');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error('Apertura requería cambio de esquema; cancelada'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (required.some(store => !database.objectStoreNames.contains(store)))
      throw new Error('Falta un store esencial; no se exportó una copia incompleta');
    const stores = [...required, ...optional.filter(store =>
      database.objectStoreNames.contains(store))];
    const rows = await new Promise((resolve, reject) => {
      const output = {};
      const transaction = database.transaction(stores, 'readonly');
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(output);
      for (const store of stores) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => { output[store] = request.result; };
      }
    });
    const snapshot = { app: 'gym-tracker-forensic-readonly',
      exportedAt: new Date().toISOString(), origin: location.origin,
      indexedDbVersion: database.version,
      missingOptional: optional.filter(store => !stores.includes(store)), stores: rows };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)],
      { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `gym-tracker-forensic-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.log('Exportación solicitada; recuentos:',
      Object.fromEntries(stores.map(store => [store, rows[store].length])));
    return snapshot;
  } finally { database.close(); }
})().catch(error => console.error('Exportación cancelada:', error.message));
```

El archivo se descarga en el **teléfono**, porque el código se ejecuta en esa página. Comprobar en Descargas que existe, copiarlo al PC mediante transferencia USB de archivos y guardar otra copia en ubicación independiente. Si la descarga se bloquea, detenerse y revisar permisos/descargas sin tocar IndexedDB. En Windows verificar el archivo con PowerShell, sin volcar su contenido en el chat:

```powershell
$auditFile = 'C:\ruta\segura\gym-tracker-forensic-XXXXXXXX.json'
$copy = Get-Content -LiteralPath $auditFile -Raw | ConvertFrom-Json
if ($copy.app -ne 'gym-tracker-forensic-readonly' -or
    $null -eq $copy.stores.workoutHistory -or $null -eq $copy.stores.migrationLedgers) {
  throw 'Copia incompleta'
}
$copy.stores.PSObject.Properties | ForEach-Object { '{0}: {1}' -f $_.Name, @($_.Value).Count }
if (@($copy.stores.workoutHistory.id | Select-Object -Unique).Count -ne
    @($copy.stores.workoutHistory).Count) { throw 'IDs de workout duplicados' }
if (@($copy.stores.workoutHistory | Where-Object {
    !$_.id -or !$_.startedAt -or !$_.finishedAt -or $null -eq $_.exercises
}).Count) { throw 'Workouts incompletos' }
Get-FileHash -LiteralPath $auditFile -Algorithm SHA256
```

Comprobar además que los IDs de `workoutHistory` no se repiten, que cada workout conserva `startedAt`, `finishedAt`, ejercicios y series, y que el ledger de la cuenta muestra sus cuatro mapas. El hash, tamaño, versión y recuentos permiten demostrar que la copia transferida permanece intacta. Guardar el JSON cifrado o en un lugar privado: contiene historial de salud/entrenamiento, aunque **no** exporta cookies, JWT, refresh tokens ni todo `localStorage`. No enviar el archivo bruto por chat. Una función temporal añadida al PWA es menos segura: desplegarla puede actualizar service worker/IndexedDB y arrancar sincronización; solo plantearla si falla la inspección USB, con revisión previa y exportación exclusivamente `readonly`, sin `db.version()`/migraciones ni peticiones de red.

## Inspección y reconciliación después de verificar la copia

Trabajar primero **sobre una copia** del JSON. Contar por separado `unresolved` (referencias `exercise:<id>` presentes en rutinas y sin mapping, o con mapping `failed`), y por estado en `ledger.exercises`, `.routines`, `.workouts`, `.sets`. Separar los `failed` duplicados en el contador. Para cada workout unir `workoutHistory.id` con la clave `ledger.workouts[id]`, guardar `clientId`, `serverId`, estado, error, razón local, fecha original y claves de sets; unir rutina por `routineId` y ejercicio por su ID. No interpretar el `workoutHistory.id` como UUID remoto. La lectura del JSON puede usar un script local que emita solo recuentos y hashes/IDs seudonimizados; no imprimir datos personales ni tokens.

Después, obtener **solo lectura** todas las páginas de `GET /api/workouts` de la cuenta correcta mediante un acceso autorizado y controlado, o una consulta de base de datos de solo lectura por el operador. No poner online el PWA para esta fase sin un plan que controle su auto-sync. `GET /api/workouts/{id}` permite confirmar el grafo completo. La API pagina por `createdAt DESC, id ASC`, no por la fecha entrenada. Comparar primero `ledger.workouts[*].serverId` con `remote.id` y `clientId` con `remote.clientId` (misma cuenta). Comparar cada serie por `setMapping.serverId` o por su `clientId` dentro del ejercicio remoto correspondiente. Los nombres y fechas son comprobación secundaria, **no** identidad: pueden existir sesiones iguales y las fechas web pierden zona/fracciones.

| Clase | Evidencia necesaria | Tratamiento posterior a aprobación |
| --- | --- | --- |
| A. Solo local confirmado | No existe `serverId`/`clientId` correspondiente tras consultar todas las páginas y detalles pertinentes | Preparar importación de snapshot preservando `clientId` existente; nunca enviar en bloque sin validación. |
| B. Remoto confirmado | Coinciden `serverId` o `clientId` y el contenido/series esperadas | Registrar enlace y diferencias; no recrear. |
| C. Ambiguo | Error de red/5xx/timeout, `serverId` sin confirmación, coincidencia parcial, página remota incompleta o identidad conflictiva | Consulta adicional de detalle/BD; no reenviar ni sobrescribir. |
| D. Datos inválidos | Incompatibilidad verificada con contrato, dependencia ausente o snapshot distinto | Corregir una **copia de trabajo**, preservando datos originales, fechas e IDs; revisar antes de cualquier envío. |

La estrategia más segura es conservar el JSON forense inmutable; elaborar una tabla de reconciliación para cada workout y set; identificar los ya persistidos y los parcialmente persistidos; diseñar importación individual de los verdaderamente locales. El endpoint móvil V15 podría representar snapshots que el importador PWA rechaza, pero su empleo requiere comprobar formato, zona histórica, referencias y colisiones de `clientId`; nunca inventar un instante o reescribir la hora histórica. Los workouts web ya creados parcialmente requieren completar/verificar sus series bajo sus IDs existentes. Solo después probar con datos sintéticos, revisar el plan concreto y pedir autorización de recuperación separada. No reinicializar ledger ni importar el backup mediante Ajustes: `BackupService.importData()` y `restoreFromServer()` **borran y reemplazan** rutinas, historial y peso.

## Evidencia y próximos pasos del usuario

Pruebas de código existentes con datos sintéticos: `local-to-cloud-migration.service.spec.ts` cubre snapshot distinto, dependencias bloqueadas, reintentos con IDs estables y fallo transitorio. Se añadió un caso que reproduce el doble cómputo de una referencia fallida. Ejecución: `npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/migration/local-to-cloud-migration.service.spec.ts` → **16/16 correctas**. Ninguna usa datos reales. No se ha cambiado el sincronizador ni el backend.

Fuentes de implementación: `src/app/pages/settings/settings.component.{ts,html}` (indicador y única resolución UI); `src/app/migration/{account-sync.service.ts,local-to-cloud-migration.service.ts,local-to-cloud-migration.models.ts}` (contador, estados, cola); `src/app/data/{active-training.repository.ts,workout-history.model.ts}` (IndexedDB e historial); `src/app/pages/training/training.component.ts` (fin de sesión); `src/app/services/{backup.service.ts,resilient-http.interceptor.ts}` y `src/app/auth/{auth.interceptor.ts,auth-session.service.ts}`; `src/app/data/local-first-read.service.ts` (unión local/remoto). En la API: `src/main/java/dev/manuel/gymtracker_api/workout/{controller/WorkoutController.java,service/WorkoutService.java}`, `src/main/resources/db/migration/{V12__add_client_ids_for_idempotent_imports.sql,V15__workout_snapshot_names.sql}` y `docs/frontend-integration-contract.md`. Todo lo relativo a la API se inspeccionó en modo lectura.

1. Mantener el teléfono sin red, conservar la instalación y ejecutar la copia por USB/DevTools anterior.
2. Verificar recuentos, IDs, formato y SHA-256; conservar dos copias privadas y comunicar **solo** versión de IndexedDB, recuentos por store, recuentos por estado/sección y hash si se desea, nunca credenciales ni JSON completo en abierto.
3. Confirmar el navegador/origen de la instalación afectada y la versión visible del PWA. Un origen o build distinto exige volver a contrastar su esquema antes de interpretar el archivo.
4. Autorizar por separado la fase de inspección/reconciliación de datos reales y, más adelante, el plan de recuperación específico. Hasta entonces no conectar el PWA para forzar sync ni reproducir peticiones productivas.

**Conclusión:** el historial local aún visible es una fuente recuperable potencial. El bloqueo del importador por cambios de rutina es real y V15 ofrece una representación histórica mejor, pero la causa de estos 75 y el estado remoto de las últimas semanas siguen sin confirmar hasta disponer de la copia del teléfono y de una lectura remota de solo lectura.
