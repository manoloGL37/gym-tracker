param(
  [Parameter(Mandatory=$true)][string]$HistoryBackup,
  [Parameter(Mandatory=$true)][string]$LedgerBackup
)
$ErrorActionPreference = 'Stop'
$historyCopy = Get-Content -LiteralPath $HistoryBackup -Raw -Encoding UTF8 | ConvertFrom-Json
$ledgerCopy = Get-Content -LiteralPath $LedgerBackup -Raw -Encoding UTF8 | ConvertFrom-Json
if ($historyCopy.schemaVersion -ne 2 -or $null -eq $historyCopy.workoutHistory) { throw 'Backup histórico inesperado' }
if ($ledgerCopy.app -ne 'gym-tracker-forensic-readonly') { throw 'Backup forense inesperado' }
foreach ($storeName in @('workoutHistory', 'routines', 'migrationLedgers')) {
  if ($null -eq $ledgerCopy.stores.$storeName) { throw 'Falta un store esencial' }
}
if (@($ledgerCopy.stores.migrationLedgers).Count -eq 0) { throw 'No hay ledger: detener la recuperación' }
$workoutsById = @{}
foreach ($workout in $ledgerCopy.stores.workoutHistory) {
  if (!$workout.id -or $workoutsById.ContainsKey($workout.id)) { throw 'ID histórico ausente o duplicado' }
  $workoutsById[$workout.id] = $workout
}
foreach ($original in $historyCopy.workoutHistory) {
  $actual = $workoutsById[$original.id]
  if ($null -eq $actual -or $actual.startedAt -cne $original.startedAt -or $actual.finishedAt -cne $original.finishedAt -or
      $actual.routineName -cne $original.routineName -or $actual.routineId -cne $original.routineId -or
      @($actual.exercises).Count -ne @($original.exercises).Count) { throw 'Histórico diferente entre copias: revisar sin sobrescribir' }
  for ($exerciseIndex = 0; $exerciseIndex -lt @($original.exercises).Count; $exerciseIndex++) {
    $oldExercise = $original.exercises[$exerciseIndex]
    $newExercise = $actual.exercises[$exerciseIndex]
    if ($oldExercise.exerciseId -cne $newExercise.exerciseId -or $oldExercise.name -cne $newExercise.name -or
        $oldExercise.observation -cne $newExercise.observation -or @($oldExercise.sets).Count -ne @($newExercise.sets).Count) { throw 'Snapshot de ejercicio diferente: revisar' }
    for ($setIndex = 0; $setIndex -lt @($oldExercise.sets).Count; $setIndex++) {
      $oldSet = $oldExercise.sets[$setIndex]
      $newSet = $newExercise.sets[$setIndex]
      if ($oldSet.setIndex -ne $newSet.setIndex -or $oldSet.weight -ne $newSet.weight -or $oldSet.reps -ne $newSet.reps) { throw 'Serie diferente entre copias: revisar' }
    }
  }
}
foreach ($ledger in $ledgerCopy.stores.migrationLedgers) {
  if (!$ledger.accountId) { throw 'Ledger sin cuenta' }
  foreach ($section in @('exercises', 'routines', 'workouts', 'sets')) {
    if ($null -eq $ledger.$section) { throw 'Ledger incompleto' }
    $states = @($ledger.$section.PSObject.Properties.Value | Group-Object status | ForEach-Object { '{0}={1}' -f $_.Name, $_.Count })
    Write-Output ('{0}: {1}' -f $section, ($states -join ', '))
  }
}
Write-Output ('Copias verificadas: {0} históricos originales; {1} históricos forenses; {2} ledgers.' -f
  @($historyCopy.workoutHistory).Count, @($ledgerCopy.stores.workoutHistory).Count, @($ledgerCopy.stores.migrationLedgers).Count)
Get-FileHash -LiteralPath $HistoryBackup -Algorithm SHA256
Get-FileHash -LiteralPath $LedgerBackup -Algorithm SHA256
