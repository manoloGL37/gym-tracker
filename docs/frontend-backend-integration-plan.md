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

## Deferred to Phase 2

- Safe migration of existing IndexedDB data.
- Server persistence and conflict handling for exercises, routines, workouts, sets, weight and statistics.
- Resource synchronization state, offline queueing and data source-of-truth changes.
