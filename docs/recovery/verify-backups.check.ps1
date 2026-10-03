$ErrorActionPreference = 'Stop'
$checkDirectory = Join-Path ([IO.Path]::GetTempPath()) ('gym-recovery-synthetic-' + [guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $checkDirectory)
$historyPath = Join-Path $checkDirectory 'history.json'
$ledgerPath = Join-Path $checkDirectory 'ledger.json'
$history = @{ schemaVersion = 2; workoutHistory = @(@{ id = 'synthetic'; routineId = 'synthetic'; routineName = 'Synthetic'; startedAt = '2026-01-01T10:00:00.123Z'; finishedAt = '2026-01-01T10:01:00.456Z'; exercises = @(@{ exerciseId = 'synthetic'; name = 'Synthetic'; observation = 'Synthetic'; sets = @(@{ setIndex = 0; reps = 8; weight = 22.75 }, @{ setIndex = 1; reps = $null; weight = $null }) }) }) }
$forensic = @{ app = 'gym-tracker-forensic-readonly'; stores = @{ workoutHistory = $history.workoutHistory; routines = @(); migrationLedgers = @(@{ accountId = 'synthetic'; exercises = @{}; routines = @{}; workouts = @{}; sets = @{} }) } }
try {
  $history | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $historyPath -Encoding UTF8
  $forensic | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
  & "$PSScriptRoot/verify-backups.ps1" -HistoryBackup $historyPath -LedgerBackup $ledgerPath | Out-Null
  $before = (Get-FileHash -LiteralPath $historyPath).Hash
  $forensic.stores.workoutHistory[0].exercises[0].sets[1].weight = 0
  $forensic | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
  $rejected = $false
  try { & "$PSScriptRoot/verify-backups.ps1" -HistoryBackup $historyPath -LedgerBackup $ledgerPath | Out-Null } catch { $rejected = $true }
  if (!$rejected) { throw 'Verifier accepted an invented zero' }
  if ((Get-FileHash -LiteralPath $historyPath).Hash -ne $before) { throw 'Verifier modified input' }
  Write-Output '2/2 backup checks passed: exact history accepted; invented zero rejected; inputs unchanged.'
} finally {
  # Only the two exact synthetic files created above, never a recursive delete.
  Remove-Item -LiteralPath $historyPath, $ledgerPath -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $checkDirectory -ErrorAction SilentlyContinue
}
