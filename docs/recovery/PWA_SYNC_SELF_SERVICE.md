# Recuperación de sincronización desde el PWA

03/10/2026. Extensión local de `ac67cb2`, en la rama `fix/pwa-historical-snapshot-sync`. Sin despliegue, push, merge, importación ni recuperación real. Android y backend sin cambios.

## Flujo del usuario en Xiaomi

Después de una **aprobación de despliegue separada**, actualizar la instalación original del PWA, manteniendo su almacenamiento:

1. Ajustes → Tus datos → **Revisar sincronización**. El aviso rojo cuenta tareas; la nueva pantalla revisa sesiones completas.
2. **Descargar copia de recuperación**. Conservar ese JSON junto al backup schemaVersion 2 de 99 entrenamientos que ya existe.
3. **Comprobar copia descargada** → seleccionar ese mismo archivo reciente en Descargas mediante el selector del teléfono. El PWA comprueba tamaño y SHA-256 exactos. **No importa ni restaura el archivo.** Si la copia no coincide, no habilita recuperación.
4. Introducir la zona histórica, por ejemplo `Europe/Madrid` únicamente si corresponde realmente; limitar fechas si hubo viajes y confirmar la zona para ese periodo. Las horas UTC originales no se desplazan. Cambiar zona o periodo exige repetir confirmación. Dejar fuera sesiones con zona desconocida.
5. Pulsar **Revisar sincronización**. Se consultan todas las páginas remotas y los detalles necesarios para la cuenta autenticada. La revisión no envía sesiones ni modifica el ledger.
6. Ver los cuatro grupos: **Ya sincronizados**, **Ausentes en tu cuenta**, **Guardados con diferencias**, **Necesitan revisión**. Seleccionar solo ausentes seguros. Un registro sin identidad persistida, con identidad contradictoria o con posible coincidencia temporal permanece en revisión manual.
7. **Recuperar entrenamientos pendientes** → revisar el resumen → **Confirmar y recuperar N sesiones**. Esta segunda acción autoriza exclusivamente ese lote seleccionado. El código vuelve a conciliar cada sesión antes de enviar.
8. Seguir el progreso. Mantener la pantalla abierta y evitar editar sesiones/cambiar de cuenta. **Detener después de esta sesión** conserva lo ya confirmado y no inicia la siguiente.
9. Si hay interrupción o respuesta perdida: pulsar revisión de nuevo. Si se cerró/refrescó el PWA, descargar/verificar una copia actual otra vez. Nunca se reanuda automáticamente un lote al entrar o iniciar sesión. Una propuesta histórica que ya existe remotamente aparece como recuperada pendiente de confirmar; la confirmación enlaza mediante GET, **sin nuevo POST**.
10. Abrir Gym Tracker Android, con la misma cuenta, y actualizar Historial mediante su sincronización existente. Los registros ausentes en Room se descargan desde el backend; no hay importador Android. Los registros ya presentes pero incompletos requieren revisión específica y no se reparan automáticamente por esta pantalla.

No se requiere USB, inspección remota ni consola del navegador en el teléfono. Los scripts forenses previos permanecen como herramientas opcionales; dejan de ser requisito para este flujo.

## Datos y garantías

- Nueva ruta lazy: `/settings/sync-recovery`; enlace visible en Tus datos incluso cuando no hay indicador rojo.
- Exportación `LocalToCloudMigrationService.exportRecoveryBackup()`: una única transacción Dexie `r`, verificada como IndexedDB **readonly**. Incluye `workoutHistory`, `routines` y todos los `migrationLedgers`: IDs locales, clientIds/serverIds, mapas de ejercicios/rutinas/workouts/series, estados, errores y propuestas ya persistidas. Los ejercicios históricos y series están dentro de `workoutHistory`; los planes y mappings necesarios están en rutinas/ledger. No existe un store local de catálogo separado imprescindible para snapshots con referencias nulas.
- Formato de recuperación: `app: gym-tracker-sync-recovery`, `schemaVersion: 1`, `exportedAt`, `stores`. Es distinto del backup general schemaVersion 2. No lee localStorage, cookies, JWT, refresh tokens ni cabeceras; no envía el archivo a un servidor. El importador general existente rechaza esta estructura antes de borrar datos porque no contiene sus arrays en la raíz.
- El navegador no puede garantizar por sí solo que una descarga quedó en disco: por eso la selección y comprobación del archivo es obligatoria. Verificación válida solo durante esa sesión de pantalla/cuenta. Un nuevo download invalida la verificación anterior.
- Comparación remota: clientId/remoteId existentes y hechos históricos exactos, no coincidencia aproximada de nombres. Coincidencias temporales sin identidad son señales de ambigüedad, nunca fusiones.
- POST solo para clase B reconfirmada, con `/api/workouts/mobile`; conserva clientId, exacto snapshot persistido, instantes y nombres/orden/notas, y solo series realizadas con valores válidos. No depende de la rutina actual, no completa huecos con ceros ni modifica históricos locales.
- Clase C: antiguo workout web con el mismo clientId pero snapshot incompleto/diferente. Mobile devuelve el existente por idempotencia y **no lo repara**. La interfaz conserva esa categoría sin envío automático.
- En caso de fallo/timeout de recuperación, conserva estado/error anteriores y guarda `recoveryError`; un fallo HTTP no prueba ausencia de commit. La respuesta y el estado remoto se comprueban antes de marcar migrated.
- Antes de cada envío, el UI comprueba que histórico y clientId siguen coincidiendo con la copia verificada. Cambios posteriores exigen otra copia/revisión. Una propuesta persistida con otra zona se retiene en D; no se regenera silenciosamente.
- `AccountSyncService.pauseForRecovery()` drena la pasada normal antes de habilitar acciones y retiene retries/login/online mientras esta pantalla está abierta. Al salir reanuda solo la sincronización normal elegible; no el lote histórico.
- Web Locks, nativo en Chrome Android, serializa operaciones de ledger contra sincronización normal y otras ventanas actualizadas del mismo origen. Si no está disponible, copia/revisión funcionan pero el envío queda deshabilitado con explicación. No editar desde otras ventanas ni conservar abierta una versión antigua que no conoce estos locks.
- Contexto HTTP `EXPECTED_ACCOUNT_ID`: GETs de workouts y POST móvil de recuperación quedan ligados a la cuenta revisada, incluido un refresh de autenticación. El interceptor cancela un cambio de cuenta antes de transmitir/reintentar. La sincronización móvil normal también usa esa protección.
- Timeouts explícitos: 30 segundos por consulta y 45 por POST de recuperación. Una interrupción no cancela retroactivamente un commit: la siguiente revisión reconcilia el resultado. Las consultas de detalle por sesión se limitan a candidatos pertinentes, evitando leer todos los detalles otra vez para cada envío.

## Límites y requisitos antes del lanzamiento

**Contrato desplegado pendiente de verificación.** El repositorio Spring V15 admite este DTO y snapshots independientes/atómicos con clientId idempotente. La lectura web de OpenAPI no fue accesible; dos consultas públicas readonly a `https://gym-tracker-api-s70k.onrender.com/v3/api-docs` agotaron tiempos de 30 y 45 segundos. Esto no demuestra que el servidor rechace el endpoint ni que V15 esté desplegado. No se hicieron peticiones autenticadas reales ni POST sintéticos a producción.

Antes de aprobar despliegue, el operador debe confirmar el commit/migraciones V14/V15 efectivamente instalados y el contrato de `/api/workouts/mobile` mediante OpenAPI accesible o evidencia de despliegue. No se propone modificar backend. La nueva pantalla no sustituye esa comprobación de release.

Después de desplegar con aprobación: comprobar en Xiaomi descarga/selector de archivo, compatibilidad Web Locks, zona, resumen de solo lectura y copia verificada. Autorizar el primer registro B individual, confirmar backend/Android y ampliar únicamente tras verificar el resultado. La descarga real del teléfono y la recuperación real **no se han ejecutado** en esta implementación.

Sin identidad persistida, sin zona conocida, con totales remotos cambiantes o con contenido existente distinto no se autoriza recuperación automática. Una revisión paginada no es una transacción global del servidor: evitar actividad concurrente desde otros clientes; la idempotencia y la validación de respuesta protegen el clientId persistido.

## Verificación y diseño

- Suite PWA completa: **182 pruebas correctas**, todas sintéticas. Cobertura añadida: entrada/download sin replay, verificación SHA-256, archivo incorrecto, confirmación de zona/periodo, A/B/C/D, envío seleccionado B con confirmación separada, histórico cambiado después de copia, cuenta cambiada (también durante refresh), parada de lote, respuesta perdida/revisión obligatoria y enlace A tras interrupción.
- Pruebas anteriores conservan completo/parcial/saltado/editado/eliminado, snapshot durable antes de POST, reintento exacto, idempotencia simulada y no replay automático de unsupported.
- Exportación verificada en transacción readonly, sin crear ledger ni cambiar histórico y con lista explícita de stores. Pausa normal probada esperando la pasada actual y bloqueando retries hasta liberar la pantalla.
- Build de producción correcto; avisos de bundle inicial y CSS anteriores, sin relajar presupuestos. Resultados finales y commit figuran en el informe de entrega.
- Inspección visual local con perfil Chrome temporal, datos sintéticos y URLs HTTPS de producción bloqueadas: móvil 390 px y escritorio 1280 px sin overflow horizontal; acciones medidas de 48 px. Detector ejecutado una vez: dos avisos estáticos de negro que no corresponden al render (enlace medido `rgb(17,24,39)`, token ink). Revisión independiente: **ship**, sin hallazgos materiales dentro del alcance operativo; no acredita descarga real en Xiaomi.
- Se conserva DESIGN.md. La skill detectó un sidecar visual previo desactualizado; no se repara ni rediseña como efecto lateral de este trabajo.

### Contrato de dirección de esta extensión

**THESIS:** completar una recuperación segura desde el teléfono con pasos visibles y acciones separadas. **OWN-WORLD:** paleta mineral/navy, fuente numérica, divisores y controles nativos del PWA existente. **STORY:** guardar/comprobar copia, confirmar zona, revisar evidencias, decidir el envío. **FIRST VIEWPORT:** retorno a Ajustes, propósito, cuenta y copia como primera acción; instrucciones legibles sin consola. **FORM:** extensión funcional de Ajustes, tres pasos secuenciales y grupos desplegables de sesiones; conserva el mundo visual existente, sin nueva composición aleatoria. **FINISH:** revisión de capturas móvil/escritorio, controles funcionales probados, veredicto independiente y documentación de límites; sin assets raster nuevos publicados.

Comandos:

```powershell
$env:CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```
