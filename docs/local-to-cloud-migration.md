# Local-to-cloud migration

Migration is an automatic, account-scoped background synchronization that starts after `/me` confirms a session. IndexedDB is never cleared; Settings is only used when an exercise identity genuinely needs a decision.

## Local data classification

| Local resource | Classification | Behaviour |
| --- | --- | --- |
| Free-text/local exercise reference | Migratable with transformation | User explicitly maps its local UUID to a catalog UUID or creates a cloud custom exercise. Names are never auto-matched. |
| Local custom exercise | Migratable with transformation | There is no separate custom-exercise store; a resolved free-text reference can become a documented cloud custom exercise. |
| Routine | Migratable with transformation | Name, order and `setsCount` transfer. User confirms default target reps/rest because legacy data lacks them. |
| Selected routine | Not currently migratable | Device-local UI state; remains local. |
| Active training | Not currently migratable | Left untouched; when it finishes locally, the central coordinator immediately evaluates the completed workout. |
| Workout history | Conditionally migratable | Only unchanged routine snapshots with complete valid sets can be reconstructed through the routine snapshot API. |
| Workout exercises / sets | Conditionally migratable | Transfer only as part of a compatible historical workout; positions and 1-based set numbers are rebuilt from the local snapshot. |
| Exercise observations | Not currently migratable | Preserved locally and disclosed as a partial-representation limitation. |
| Local statistics/history | Derived / not uploaded | Cloud statistics derive from migrated backend workouts; Local filters mapped records for the current account. |
| Body weight | Not currently migratable | Retained in Dexie; no backend endpoint exists. |
| Backups, device metadata, language and UI settings | Not migratable by design | Remain local and are never sent to the Gym Tracker API. |

## Ledger and retries

`GymTrackerDB.migrationLedgers` is keyed by `accountId` from `/api/users/me`. Each entry contains resource/client/server mappings, statuses, errors, conversion defaults and timestamps. Client IDs are generated once in the ledger for routines, workouts and sets; cloud custom exercises get one when the user selects that path. A lost response is retried with the same ID, relying only on documented backend idempotency. Per-record claims prevent a row already associated with one account from being silently imported or displayed in another account on the same device.

The dependency order is custom exercises, routines, historical workouts, then sets. Each confirmed response is persisted immediately. Transient dependency failures remain pending; genuinely unresolved dependencies block only their own routine/workouts and do not undo independent successes. Unsupported history receives a local-only reason.

## Source of truth

Authenticated Home and History render a transitional union of confirmed backend workouts and genuinely pending local workouts. Mapped local counterparts are suppressed by ledger identity, never by names, and History sorts the result chronologically. If the backend is temporarily unavailable, account-owned local rows remain available. Legacy data remains physically present for export and recovery. Cloud statistics remain server-authoritative and show a synchronization notice while workout migration is pending.
