# Local-to-cloud migration

Migration is an explicit, account-scoped import available from Settings after `/me` confirms a session. It is not synchronization and it never clears IndexedDB.

## Local data classification

| Local resource | Classification | Behaviour |
| --- | --- | --- |
| Free-text/local exercise reference | Migratable with transformation | User explicitly maps its local UUID to a catalog UUID or creates a cloud custom exercise. Names are never auto-matched. |
| Local custom exercise | Migratable with transformation | There is no separate custom-exercise store; a resolved free-text reference can become a documented cloud custom exercise. |
| Routine | Migratable with transformation | Name, order and `setsCount` transfer. User confirms default target reps/rest because legacy data lacks them. |
| Selected routine | Not currently migratable | Device-local UI state; remains local. |
| Active training | Not currently migratable | Left untouched; finish it locally first. |
| Workout history | Conditionally migratable | Only unchanged routine snapshots with complete valid sets can be reconstructed through the routine snapshot API. |
| Workout exercises / sets | Conditionally migratable | Transfer only as part of a compatible historical workout; positions and 1-based set numbers are rebuilt from the local snapshot. |
| Exercise observations | Not currently migratable | Preserved locally and disclosed as a partial-representation limitation. |
| Local statistics/history | Derived / not uploaded | Cloud statistics derive from migrated backend workouts; Local filters mapped records for the current account. |
| Body weight | Not currently migratable | Retained in Dexie; no backend endpoint exists. |
| Backups, device metadata, language and UI settings | Not migratable by design | Remain local and are never sent to the Gym Tracker API. |

## Ledger and retries

`GymTrackerDB.migrationLedgers` is keyed by `accountId` from `/api/users/me`. Each entry contains resource/client/server mappings, statuses, errors, conversion defaults and timestamps. Client IDs are generated once in the ledger for routines, workouts and sets; cloud custom exercises get one when the user selects that path. A lost response is retried with the same ID, relying only on documented backend idempotency.

The dependency order is custom exercises, routines, historical workouts, then sets. Each confirmed response is persisted immediately. Failures block dependents but do not undo independent successes. Unsupported history receives a local-only reason. A distinct account gets a distinct ledger and is always prompted explicitly.

## Source of truth

After confirmation, authenticated combined screens hide the mapped local counterpart and show cloud data. Legacy data remains physically present for guest mode, logout, export and recovery. The active account's Local statistics/exercise history exclude mapped records; Cloud statistics remain server-authoritative, preventing display or aggregate duplication.
