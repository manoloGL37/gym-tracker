# Inventario funcional para el cliente Android

Auditoría del código Angular vigente. Este documento describe comportamiento de producto existente, no propone la arquitectura ni la interfaz Android.

## 1. Funciones de producto implementadas

- **Inicio:** punto de entrada para iniciar o reanudar una sesión, resumen de la semana (sesiones, volumen y último peso), hasta tres rutinas y último registro. Permite crear un registro histórico manual.
- **Cuenta:** registro, inicio y cierre de sesión; restauración de sesión y reintentos cuando el servicio no está disponible. La app se puede usar como invitado.
- **Rutinas:** listar, crear, editar, reordenar y eliminar rutinas. Las locales contienen nombre y ejercicios escritos libremente con número de series. Las de cuenta contienen descripción y, por ejercicio, catálogo/ejercicio propio, posición, series, repeticiones objetivo, descanso y nota.
- **Selección e inicio de entrenamiento:** elegir una rutina y convertirla en la sesión activa.
- **Entrenamiento activo:** cronómetro, progreso, series kg/repeticiones, referencia de la sesión anterior, indicación de mejor marca estimada local, notas, finalización y cancelación.
- **Ejercicios:** el catálogo autenticado permite buscar, filtrar, paginar, ver detalle e instrucciones, y crear/editar/eliminar ejercicios propios cuando el servidor lo permite. Desde el editor cloud de rutinas también se puede buscar o crear un ejercicio propio.
- **Historial:** diario cronológico y vista semanal; detalle de un registro. Los registros locales se pueden editar y eliminar; los cloud son de solo lectura.
- **Entrada manual:** registrar una sesión pasada escogiendo fecha y rutina, con sus series y observaciones.
- **Historial por ejercicio local:** volumen, mejor peso, 1RM estimado, sesiones, series y detalle de cada sesión, agrupado por *nombre* de ejercicio.
- **Peso corporal:** alta/edición/borrado de un peso por fecha y gráfica de tendencia.
- **Estadísticas:** resúmenes y comparativas semana/mes, evolución de volumen por día de entrenamiento, evolución semanal en intervalo elegido y, con cuenta, evolución por ejercicio.
- **Ajustes:** idioma ES/EN, estado de cuenta/sincronización, resolución de ejercicios ambiguos de migración, información/protección del almacenamiento, exportación/importación/restore de copias.
- **Copia best-effort:** cada cambio de rutina, historial o peso intenta enviar un snapshot por dispositivo a un servicio de backup; se puede exportar/importar JSON y restaurar el último backup remoto.

## 2. Pantallas y navegación

| Ruta actual | Propósito, información y acciones | Estados y relaciones |
|---|---|---|
| `/home` | Inicio: sesión activa, resumen semanal, peso más reciente, accesos a rutinas y último entrenamiento. Iniciar/reanudar; abrir estadísticas, ajustes, rutina, detalle y entrada manual. | Carga local primero; para cuenta refresca rutinas/historial/summary. Vacíos de rutina e historial; muestra trabajo pendiente de sync. |
| `/login`, `/register` | Acceso por email/contraseña. Registro lleva a login con el email precargado; login lleva a inicio. | En error de red recalca que los datos locales siguen disponibles; errores de credenciales/validación. |
| `/routines` | Lista y editor de rutinas. Crear, editar, borrar, mover ejercicios; editor cloud busca/crea ejercicios y configura sus campos. | Lista local inmediata + refresh cloud; carga, vacío, errores y paginación cloud. Desde cada rutina se va a selección para entrenar. |
| `/select-routine` | Elegir la rutina de hoy e iniciar sesión. | Mismo patrón local-first, vacío hacia creación de rutina y paginación cloud. Seleccionar navega a `/training`. |
| `/training` | Registro de sesión activa: rutina, tiempo, sets hechos/totales, ejercicios ordenados, sets, benchmark y notas. Añadir serie solo cloud; finalizar o cancelar. | Carga, sin sesión activa, diálogos de confirmación, error/reintento cloud y estados de guardado por set. Regresa a inicio al finalizar local y a historial al finalizar cloud. |
| `/calendar` | Historial como diario o semana. Muestra fecha, rutina, ejercicios y estado de sesión. | Carga/refresco/error/vacío; paginación cloud. Abre `/calendar/:id?source=local|cloud`; borrar solo local. |
| `/calendar/:id` | Detalle de una sesión. Local: editar kg, reps y observaciones. Cloud: lectura de sets, RPE, notas y notas por ejercicio. | Cloud puede abrir desde caché si red falla; error si no hay caché ni respuesta. Vuelta al historial. |
| `/add-workout` | Crear retrospectivamente un historial local a partir de una rutina local, fecha no futura, sets y notas por ejercicio. | Sin rutina elegida muestra instrucción; guardar vuelve a inicio. |
| `/weight` | Peso de hoy, tendencia y lista histórica. Alta/edición/borrado. | Precarga último valor (o el de hoy); rango válido 20--300 kg, una decimal; vacío y carga. |
| `/stats` | Métricas y gráficas de período, selector de semanas y, cloud, selector/búsqueda de ejercicio. | Carga, reintento, sin datos y aviso de sync pendiente. Invitado enlaza al historial local de ejercicio. |
| `/exercises` | Historial analítico local por ejercicio. | Selector de nombre, resumen y sesiones; carga/vacío; enlaza al detalle local. |
| `/exercise-catalog` | Catálogo de cuenta: búsqueda/filtros/paginación, detalle, CRUD de ejercicios propios. | Invitado ve que requiere cuenta; reconectando puede usar la página cacheada; carga, vacío y errores. |
| `/settings` | Cuenta, sync, idioma, almacenamiento y backup/import/restore. | Invitado ofrece acceso; cuenta muestra progreso/atención. Import y restore exigen confirmación; resolución de ejercicio abre hoja de búsqueda/creación. |

La barra principal no añade funciones: expone Inicio, Rutinas, Entrenar, Historial y Estadísticas. Las rutas desconocidas redirigen a Inicio.

## 3. Persistencia local actual

La base IndexedDB Dexie `GymTrackerDB` (versión 9) guarda lo siguiente:

| Store | Identidad e información relevante |
|---|---|
| `routines` | `id`; `name`; ejercicios `{id, name, setsCount}`. Es la rutina local libre, sin `clientId` remoto. |
| `activeTraining` | única fila `id: "active"`; `routineId`, `routineName`, `startedAt`; ejercicios/snapshot con `exerciseId`, `name`, sets `{setIndex` cero-based, `reps`, `weight`}` y `observation` opcional. |
| `cloudActiveTraining` | única fila `id: "active"`; `workoutId` remoto, `workoutClientId`, `routineId`, `routineName`, `startedAt`, `notes`, ejercicios remotos y drafts de set: `clientId`, `setNumber`, kg/reps/RPE, respuesta persistida y estado de sync. |
| `selectedRoutine` | única fila `id: "selected"`. Local: `routineId`, `source: local`; cloud: además `routineName`, `workoutClientId` y `startedAt`, preservados antes del POST. |
| `workoutHistory` | `id` e índice `finishedAt`; `routineId`, `routineName`, inicio/fin ISO; snapshot de ejercicios/sets y observación por ejercicio. |
| `bodyWeight` | clave `date` (`YYYY-MM-DD`); `weight` en kg. Se migra una vez desde la antigua BD `gym-tracker/bodyWeight`. |
| `migrationLedgers` | clave/índice `accountId` (UUID de `/me`); ledger de migración y mappings por ejercicio/rutina/workout/set, estados, `clientId`, `serverId`, errores, propietarios y defaults. |
| `accountRoutineCache` | clave `accountId`; primera página cloud de rutinas y `updatedAt`. |
| `accountWorkoutCache` | clave `accountId`; primera página cloud de workouts, mapa `routineNames` y `updatedAt`. |
| `accountExerciseCatalogCache` | clave `key=accountId`; solo primera página sin filtros del catálogo y `updatedAt`. |

`localStorage` contiene: idioma `lang`; metadatos no autoritativos de sesión (logout explícito, indicio de sesión y usuario cacheado); UUID de dispositivo de backup; estado/fecha del último backup; y marca de migración de peso legado. No guarda el JWT actual (se elimina una clave antigua); la sesión web usa refresh cookie y token en memoria.

El backup JSON actual incluye **solo** rutinas, historial y peso (`schemaVersion`, `exportedAt`); no incluye sesión activa, selección, caches cloud, ledgers ni preferencias. Importar o restaurar reemplaza (no fusiona) esas tres colecciones, y tampoco limpia la sesión activa.

## 4. Reglas de producto observadas

- Invitado puede usar Inicio, rutinas libres, selección, entrenamiento, historial, entrada manual, peso, estadísticas e import/export sin backend. El catálogo cloud exige cuenta.
- La autenticación no borra datos Dexie al salir; datos locales preexistentes se mantienen y se intentan migrar al autenticarse. La lectura visible combina cloud y local pendiente evitando duplicados representados remotamente.
- Orden: rutinas cloud transmiten `position` cero-based recalculada tras reordenar; el entrenamiento sigue ese snapshot. Las series cloud tienen `setNumber` uno-based y único por ejercicio; locales tienen `setIndex` cero-based y se presentan como 1, 2, …
- Una serie local está completa con reps >= 1 y peso >= 0. La cloud añade enteros, peso finito y máximo 9999.99. El progreso es `round(series completas / series planificadas * 100)`; un set cloud cuenta solo al confirmarse en servidor.
- El benchmark es, por ejercicio y número/índice de serie, la sesión completada más reciente que tenga sets registrados. No bloquea el entrenamiento si no se puede cargar. La marca local es 1RM estimado Epley `peso * (1 + reps/30)` frente al mejor histórico local.
- El cronómetro deriva de `startedAt`, no de un contador persistido; por tanto continúa correctamente al reabrir mientras la fecha sea válida.
- Local autosalva cada cambio de set/observación. Cloud persiste el borrador localmente en cada cambio y envía la serie válida tras 600 ms de debounce o al perder foco; una serie confirmada queda bloqueada. Las notas de sesión cloud requieren pulsar guardar.
- Finalizar local crea un `WorkoutHistory` incluso con series incompletas, vacía sesión/selección y encola sync. Finalizar cloud se bloquea si hay series editadas no confirmadas y usa `completed: true`; la hora de finalización la confirma servidor. Local se puede cancelar (se borra sesión activa); cloud **no** se puede cancelar actualmente porque falta API de cancel/delete y se conserva el cache.
- La entrada manual admite fecha hasta hoy y genera inicio/fin a medianoche UTC; conserva sets incompletos y observaciones.
- Peso: una fila por fecha (upsert), límites 20--300 kg y redondeo a una decimal.
- Estadísticas locales cuentan todas las series, aun si incompletas; reps nulas son 0 y volumen solo existe con kg y reps. Período semana: lunes--domingo actual y anterior; mes: mes natural actual y anterior. Los rangos cloud son `LocalDate` inclusivos. Evolución diaria no se rellena en días sin entrenamiento; la gráfica semanal agrega semanas ISO dentro de un rango de semanas válido (inicio <= fin).

## 5. Offline y local-first

| Disponible sin backend | Depende de red/cuenta o tiene límite actual |
|---|---|
| Invitado: todo el flujo local de rutina, entrenamiento, historial, manual, peso y estadísticas; reanudar sesión tras reinicio. | Login/registro/restauración de sesión; catálogo, CRUD cloud y estadísticas cloud requieren API. |
| Para cuenta: snapshots locales de rutinas, historial y primera página de catálogo son visibles inmediatamente y por cuenta; refresh posterior puede fallar sin ocultarlos. | Una sesión cloud no puede empezar de verdad sin crear el workout en API; selección/datos de inicio quedan listos para reintento idempotente. |
| Borradores de sets cloud y sesión cloud persisten localmente para reintento tras reinicio. | Sets cloud terminan en servidor; reintentos automáticos solo para fallos transitorios. Un error no transitorio exige acción de reintento. |
| Indicador de conectividad y backups no bloqueantes. | Filtros/páginas no cacheadas de catálogo no se restauran offline. El historial cloud detallado depende de caché o API. |

El comportamiento buscado que sí está representado es abrir y dejar entrenar localmente aunque el backend esté dormido/no disponible. Limitaciones actuales que no deben confundirse con requisito: los recursos cloud no son una cola offline completa, el peso no se migra/sincroniza mediante el ledger, y el backup por dispositivo es separado de la cuenta.

## 6. Sincronización (semántica interna, no UI propuesta)

- Al obtener un usuario autenticado se inicia automáticamente la migración/sync de legado; una sesión local terminada notifica nuevo trabajo. No se activa para invitado.
- El ledger se aísla por `accountId`, nunca por email/dispositivo. Para datos locales compartidos, el primer claim determinista por `claimedAt` (y `accountId` como desempate) evita que dos cuentas los migren.
- Antes de POST se persiste un `clientId` para ejercicios, rutinas, workouts y sets. El contrato cloud trata esos IDs como idempotentes dentro de su ámbito; una respuesta ambigua se reintenta con el mismo ID.
- Orden de dependencia: identificar/crear ejercicio local -> rutina -> workout -> sus sets. Ejercicios libres UUID y con nombre válido se crean como personalizados; referencias ambiguas quedan para que la persona elija catálogo o cree personalizado en Ajustes.
- Un workout no migra si ya no existe su rutina local, si su snapshot no coincide con la rutina actual o si sus sets no cumplen el contrato remoto; queda local-only/unsupported. Observaciones por ejercicio no se suben y se marcan como locales.
- Las lecturas fusionan remoto y local pendiente; consideran equivalentes tanto `serverId` como `clientId`, y deduplican respuestas remotas por ambos identificadores.
- Estados retryables (`0`, timeout, 408, 429, 5xx) siguen pendientes; errores de validación/permanentes requieren atención. Sync usa backoff exponencial limitado a 60 s (5, 15, 45, 60 s) y se reanuda por red disponible o retorno a primer plano si hay trabajo pendiente. El set cloud activo usa backoff separado limitado a 30 s.
- `synced` significa que no queda trabajo reintentable ni atención, no simplemente que `completed === total`.

## 7. Especificación detallada: entrenamiento activo

1. Se elige una rutina. Para local se guarda la selección; al abrir Training se crea inmediatamente el snapshot activo de la rutina. Para cloud se guarda rutina, `workoutClientId` y hora antes de crear el workout remoto, de modo que reiniciar/reintentar no lo duplica.
2. La sesión muestra ejercicios en el orden de rutina. Local crea exactamente `setsCount` filas. Cloud reconstruye el snapshot que devuelve el servidor y rellena drafts hasta las series planificadas; permite añadir filas extra.
3. Cada fila presenta número, anterior kg × reps, campos kg/reps y estado. La fila siguiente es la primera incompleta posterior a una cadena completa. Cloud conserva RPE en el modelo/API aunque esta pantalla no ofrece campo para editarlo.
4. La referencia anterior se toma del último workout completado distinto al actual, por identidad estable de ejercicio y set equivalente. En local también se recupera la última observación por ejercicio como contexto de la nota nueva.
5. Local guarda toda mutación de set o observación en IndexedDB. Cloud guarda primero el draft; al ser válido lo envía sin botón por set, lo confirma/bloquea y deja visible guardando/guardado/pendiente/error. Al reiniciar, carga cache local, refresca del servidor y conserva drafts aún no confirmados por `clientId`.
6. El tiempo se calcula continuamente desde la fecha de inicio. Progreso cuenta sets locales válidos o cloud confirmados sobre todas las filas presentes.
7. Local tiene observación por ejercicio. Cloud tiene nota de rutina por ejercicio (solo lectura aquí) y nota de sesión editable, con botón específico de guardado.
8. Finalización local puede tener faltantes y mueve el snapshot al historial. Cloud requiere que no haya valores sin confirmar, pide al backend finalizar y solo entonces borra cache. Cancelar local descarta sesión; cloud hoy no puede cancelar y debe preservar la sesión para evitar inconsistencia.

## 8. Estadísticas

- Métricas principales: sesiones, volumen total (kg), series, repeticiones; comparación porcentual con período anterior si la base anterior no es cero. Summary de API incluye también máximo peso, aunque no es tarjeta principal.
- Gráficas: línea/área de volumen por día entrenado; línea de volumen agregado por semana ISO para un intervalo de semanas; para cuenta, evolución semanal por ejercicio con volumen y máximo peso en ejes separados. Peso tiene polilínea propia, no integrada en Estadísticas.
- En local se calculan desde historial local que no esté ya representado por el ledger de la cuenta. En cloud se consulta servidor; mientras hay workouts pendientes se avisa que las estadísticas se actualizarán al acabar.
- El análisis por ejercicio local es una pantalla distinta, agrupada por `name` libre, con volumen, mejor peso, 1RM Epley, total de sesiones/sets y notas. El análisis cloud usa `exerciseId` y busca en catálogo.
- Fechas locales se comparan con `Date(finishedAt)`; semana inicia lunes. API usa días calendario sin zona y extremos inclusivos. Esto deja una ambigüedad de zona horaria para migración nativa (ver abajo).

## 9. Lecciones UX respaldadas por el código

- Abrir la aplicación no debe esperar a que arranque/restaure el backend: se renderizan snapshots locales y los fallos de red no significan lista vacía.
- Entrenar no debe depender de un guardado manual por set: local autosalva y cloud intenta guardar al completar la fila, conserva borrador y muestra su estado.
- La sesión en curso debe sobrevivir reinicio y conservar su hora real de inicio.
- Una sesión/serie confirmada necesita identidad estable para que reintentos no dupliquen registros.
- El estado de sincronización es reactivo y distingue sincronizando, esperando/reintentando, sincronizado y elementos que requieren atención.
- No ocultar datos locales al autenticarse, desconectarse o expirar temporalmente el token; tampoco mezclar caches entre cuentas.
- Benchmark y notas previas son contexto de captura, no condiciones para iniciar el entrenamiento.

## 10. Conceptos que un cliente nativo no debe reproducir

- Rutas Angular, `RouterLink`, query `source=cloud`, redirección wildcard, barras desktop/mobile y comportamiento de scroll/foco/intersection observer: son artefactos de web.
- Service worker, manifest, estado de cuota/protección mediante `navigator.storage`, `navigator.onLine`, cookies HttpOnly y almacenamiento de tokens web.
- El SVG/Chart.js, formatos de `input type=week/date/file`, descarga Blob y `window.confirm`: conservar la función, no estas primitivas visuales/browser.
- Selectores/etiquetas de implementación **Local/Cloud**, registros Dexie, migration ledger y estados técnicos por set no son una propuesta de IA Android; solo sustentan la semántica de datos y confiabilidad anterior.
- El backup HTTP actual por `deviceId` de navegador es una implementación web separada y solo cubre un subconjunto de entidades, no una fuente de verdad de cuenta.

## 11. Checklist de migración nativa

### MVP / núcleo

- [ ] Uso invitado sin red: rutinas libres, selección, sesión autosalvada/reanudable, series kg/reps, observaciones, tiempo, progreso, completar/cancelar.
- [ ] Historial local, detalle/editado/borrado y entrada manual retrospectiva.
- [ ] Inicio con sesión activa, resumen semanal, último entrenamiento y peso más reciente.
- [ ] Peso corporal: un valor diario, validación, edición/borrado y tendencia.
- [ ] Rutinas con orden y número de series; estados vacío/carga/error que no confundan fallo de red con ausencia de datos.
- [ ] Estadísticas locales semana/mes, volumen, sesiones, series, reps y evolución semanal/diaria.

### Importante

- [ ] Cuenta, restauración segura de sesión y preservación de datos al logout/error temporal.
- [ ] Recursos cloud: catálogo, ejercicios propios, rutinas ricas y workouts, con IDs cliente idempotentes.
- [ ] Sync/migración por cuenta, deduplicación local/remoto, reintentos y resolución de ejercicios ambiguos.
- [ ] Sesión cloud: drafts persistentes, autoenvío de set, bloqueo tras confirmación, finalización remota y reanudación tras reinicio.
- [ ] Historial cloud cacheado/local-first, detalle de solo lectura y paginación.
- [ ] Estadística cloud e historial/evolución por `exerciseId`.
- [ ] Idioma ES/EN y comunicación de estados de sync/accesibilidad equivalente.

### Posterior / opcional

- [ ] Exportar/importar JSON con preview y confirmación, definiendo explícitamente qué entidades reemplaza.
- [ ] Restore/backup remoto por dispositivo, solo si sigue siendo producto deseado y con cobertura completa definida.
- [ ] Visualización semanal de historial, hasta tres accesos de rutinas y gráficos con el estilo concreto actual.
- [ ] Mostrar/gestionar RPE cuando el producto decida exponer el campo ya admitido por API.

## 12. Referencia compacta de modelo de datos

| Entidad | Campos importantes | Relaciones | Identidad local | Identidad remota |
|---|---|---|---|---|
| Rutina local | id, nombre, ejercicios(id/nombre/setsCount) | plantilla de sesión/manual | UUID local | ninguna directa; ledger puede mapearla |
| Rutina cloud | clientId, nombre, descripción, ejercicios(position, exerciseId, sets, targetReps, restSeconds, notes) | ejercicios cloud; genera workout snapshot | cache por cuenta | id UUID API + clientId |
| Ejercicio cloud | source, editable/deletable, taxonomía, traducciones, aliases | rutina/workout por exerciseId | cache de catálogo | id UUID + clientId opcional |
| Sesión activa local | routineId/nombre, startedAt, ejercicios/sets/observación | snapshot de rutina | singleton `active` | ninguna |
| Sesión activa cloud | workoutId/clientId, rutina, inicio, notas, ejercicios y drafts | workout y sus set IDs | singleton `active` | workoutId y clientId; set clientId |
| Historial local | id, routineId/nombre, startedAt/finishedAt, ejercicios/sets/observación | rutina de origen, estadísticas | id (UUID o inicio-fin al completar) | mapping ledger: serverId/clientId |
| Workout cloud | clientId, routineId, start/completed, notes, exercises posición/notas/sets | rutina, ejercicios, sets | cache por accountId | id API; IDs de workout exercise/set |
| Set | índice/número, kg, reps, RPE cloud | pertenece a ejercicio de sesión | local `setIndex`; cloud set clientId | cloud set id, setNumber único por workout-exercise |
| Peso | date, weight | independiente | date | no se sincroniza actualmente |
| Ledger | accountId, defaults, mappings, estados/errores/claims | enlaza legado con cloud | accountId + claves locales | serverId/clientId por recurso |
| Caches | accountId, página, nombres, updatedAt | lectura cloud | accountId | contienen DTOs remotos |

## Ambigüedades que la planificación Android debe resolver

1. ¿La app nativa mantiene dos modos de datos (local libre y cloud rico) o define una única fuente/modelo local y cómo migra compatiblemente el legado?
2. ¿Qué contrato tendrá cancelar/borrar un workout cloud? Hoy no existe y por eso la cancelación cloud no se ejecuta.
3. ¿Cuál es el contrato de zonas para fecha/hora? Web mezcla timestamps ISO locales, medianoche UTC en entrada manual y `LocalDateTime` sin offset para API.
4. ¿Peso corporal, observaciones por ejercicio, sesión activa y ledger deben sincronizarse y entrar en backup? Hoy tienen cobertura desigual.
5. ¿Los workouts cloud deben poder editarse, y deben poder editarse/borrarse sets confirmados? La API/pantalla actual no lo permite.
6. ¿RPE debe ser una captura de producto visible? Está en el contrato y detalle cloud, pero no se introduce en entrenamiento.
