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

## Deferred to Phase 3

- Safe migration of existing IndexedDB data.
- Routine integration with server exercise UUIDs, after an explicit migration/selection design.
- Server persistence and conflict handling for workouts, sets, weight and statistics.
- Resource synchronization state, offline queueing and data source-of-truth changes.
