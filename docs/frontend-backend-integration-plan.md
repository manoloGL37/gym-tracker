# Frontend-backend integration plan

## Phase 1 — authentication foundation (implemented)

- Angular standalone HTTP uses `provideHttpClient` and a functional JWT interceptor.
- Development calls `http://localhost:8080`; production calls `https://gym-tracker-api-s70k.onrender.com`. Authentication services obtain the URL from the Angular environment, never from duplicated literals.
- `AuthApiService` implements only the documented endpoints: `POST /api/users`, `POST /api/auth/login` and `GET /api/users/me`.
- The browser stores the access token in `localStorage` under `gym-tracker:auth:access-token`. This is practical for the current API (there is no refresh-token/cookie option), but makes XSS prevention important because same-origin JavaScript can read it.
- Startup is non-blocking. With no token, the app immediately enters guest/local mode. With a stored token, it checks `/api/users/me` in the background. A 401 clears only the auth key and returns to guest/local mode. A network or 5xx error preserves the token and local data and exposes a manual retry in Settings; this covers Render cold starts.
- Guest mode remains the default and all current Dexie/IndexedDB repositories, settings and backup flows remain unchanged.
- A logged-in account has `persistenceMode = cloud` to signal that it is cloud-capable. `resourcePersistenceMode` remains `local`: no existing routines, workouts, exercises, statistics or body-weight data are server-backed or synchronized in this phase.
- Registration creates the account only, then sends the user to login as required by the API contract. Login stores the token and loads `/me`. Logout is frontend-only and clears only authentication state.

## Phase 2 — cloud exercise catalog (implemented)

- Cloud exercises are isolated in `src/app/exercises`; their API DTOs are never assigned to the existing Dexie routine/workout shapes.
- `ExerciseApiService` calls the authenticated exercise catalog with the contract's custom page response (`content`, `page`, `size`, `totalElements`, `totalPages`) and server-side `search`, `category`, `equipment`, `muscleGroup` and `targetMuscle` filters.
- Filter selects load their real values from authenticated `GET /api/exercises/filter-options`; the page never guesses values from a partial catalog page. If that metadata request is unavailable, the catalog stays usable with the same server-side text filters.
- The server UUID is the cloud identity. Dataset exercises retain `(source, sourceId)` as their stable external identity. Names and aliases are display-only and are never used for local migration or matching.
- New custom exercises receive one native `crypto.randomUUID()` client ID when their draft opens. The ID remains in the draft after an error, so a retry reuses it.
- The catalog uses the current frontend language when choosing a backend translation, then falls back to English and finally the first server translation. Editing retains translations not shown in the form.
- `editable` and `deletable` are the only UI action permissions; no source/name heuristic enables them.
- Guests do not call the protected catalog and keep all local exercise/routine/workout functionality. Authenticated catalog operations are cloud-backed, but local routines and history are deliberately untouched.

## Phase 3 — cloud routines (implemented)

- `RoutineApiService` implements only the documented authenticated routine endpoints: Spring Page listing, detail, POST, full-replacement PUT and DELETE. Its DTOs in `src/app/routines/routine-api.models.ts` remain separate from the Dexie `Routine` shape.
- The routine screen always reads legacy Dexie routines and, for an authenticated session, additionally reads the current cloud page. Each card is labelled `Local` or `Cloud`; a failed/cold backend request leaves the local cards available and reports that cloud data is temporarily unavailable.
- Guest create/edit/delete remains Dexie-only with the existing free-text exercise name and `setsCount` model. Authenticated new routines are cloud routines, require catalog-selected server exercise UUIDs, and send backend fields `sets`, `targetReps`, `restSeconds` and optional `notes`/`description`.
- The cloud exercise picker delegates to `ExerciseApiService`, uses server-side search and pages of 10. It displays the localized catalog name plus global/custom source, but uses only the server UUID as the submitted identity.
- Cloud routine positions are rebuilt explicitly from the editor array as contiguous 0-based values on every POST/PUT. This avoids stale or duplicate positions after removal; no exercise is matched by name.
- A cloud draft gets one `crypto.randomUUID()` `clientId`. A failed POST retains that draft and therefore reuses the same ID on retry. A successful save resets the editor, so the next new draft receives a new ID. PUT sends the contract's replacement DTO but the backend retains its original `clientId`.
- No local routine is migrated, uploaded, hidden or retyped as cloud. Existing selected-routine records lacking the new optional local marker continue to mean local. No Dexie local ID is ever used in a routine API URL.
- The local routine model has no backend equivalents for free-text exercise identity and only stores `setsCount`; cloud routines additionally require an exercise UUID, target reps, rest seconds and notes. These incompatible fields are intentionally not transformed between stores.
- Existing local routines can still start the existing local training flow unchanged. Phase 4 adds cloud selection separately; the local free-text/Dexie model is still never transformed into a cloud resource.

## Phase 4 — cloud workouts (implemented)

- `WorkoutApiService` implements only `GET /api/workouts`, `GET /api/workouts/{id}`, `POST /api/workouts`, `PATCH /api/workouts/{id}` and `POST /api/workouts/{workoutId}/exercises/{workoutExerciseId}/sets`. DTOs in `src/app/workouts/workout-api.models.ts` mirror the contract and remain distinct from Dexie history.
- Routine selection combines legacy local and authenticated cloud routines with an explicit `source`. Selecting local keeps the old `ActiveTrainingRepository` flow. Selecting cloud stores the routine UUID, routine label and one generated workout `clientId`; the training screen creates the workout from the server routine snapshot. It never reconstructs workout-exercise IDs or identifies exercises by name.
- Cloud active state uses a separate small Dexie `cloudActiveTraining` cache. It contains the server workout/exercise identities plus editable set drafts for navigation/reload recovery. On an authenticated reload it refreshes the server workout and preserves only drafts the server has not already confirmed. It is not an offline sync queue and backend responses remain authoritative for persisted fields.
- A set starts as an editable local draft. Its `clientId` is generated once; retrying the same Save reuses it. `setNumber` is allocated deterministically from all existing drafts/sets and is 1-based. After the API confirms the set it becomes read-only because the backend has no edit/delete set endpoint. Weight, reps and optional RPE are sent exactly as documented.
- Cloud completion calls `PATCH { completed: true }`; the server supplies `completedAt`, preserving `startedAt`. The UI treats only `completedAt === null` as unfinished. It will not complete while a non-empty set draft is unsubmitted. A 401 or network failure leaves the local cloud resume cache and drafts untouched.
- Backend `LocalDateTime` is serialized by `toBackendLocalDateTime`: a local wall-clock ISO value with no offset or `Z`. The app does not apply a UTC convention the backend does not declare.
- Calendar keeps Dexie local history and independently fetches one paginated cloud history page. Items have an explicit `Local`/`Cloud` label and source query parameter for detail navigation. A failed cloud request cannot hide/delete local history. Cloud details use backend saved fields, including RPE and snapshot exercise notes, and intentionally do not expose edit/delete actions.
- Workout-level cloud notes can be saved when non-empty through the documented PATCH. The API cannot clear notes. Existing local per-exercise observations retain their local behavior; cloud has no corresponding user-observation field, so the screen shows snapshot routine-exercise notes and does not pretend observations are cloud-backed.
- No historic local workout was uploaded, auto-matched by exercise name, or deleted. Local statistics remain local-only; cloud statistics UI integration is deferred.

## Remaining work

- Explicit, user-controlled legacy local routine migration with no name guessing.
- Phase 5: cloud statistics UI using the statistics endpoints, plus a deliberate UX/product decision for user-controlled historical migration.
- Offline queueing/conflict resolution only if product requirements justify it; no generic sync infrastructure is present.
