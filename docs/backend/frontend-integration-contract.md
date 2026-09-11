# Frontend Integration Contract

This document is derived from the current Spring MVC controllers, DTO records, Bean Validation annotations, services, repositories, Flyway migrations, security configuration, and integration tests. It describes the implemented API only.

## 1. Base URLs, CORS, and wire formats

| Environment | API base URL |
| --- | --- |
| Local | `http://localhost:8080` |
| Production | `https://gym-tracker-api-s70k.onrender.com` |

Application endpoints use `/api`. Swagger UI is `/swagger-ui/index.html`; OpenAPI JSON is `/v3/api-docs`.

`APP_CORS_ALLOWED_ORIGINS` is a comma-separated list of exact origins (no path or trailing slash). Its default is `http://localhost:4200,https://gym-tracker-eight-dun.vercel.app`. CORS permits `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, with `Authorization`, `Content-Type`, `Accept`, and `Origin` headers. It enables credentials and never uses a wildcard origin.

UUIDs are JSON strings. Java `BigDecimal` values are JSON numbers. Java `LocalDate` is JSON `YYYY-MM-DD`; Java `LocalDateTime` is an ISO-8601 local date-time such as `2026-09-10T14:30:00`, with no offset or timezone suffix.

## 2. Authentication

### Registration

`POST /api/users` is public and returns `201 Created`.

Request body (`CreateUserRequest`):

| Field | JSON type | Required / nullable | Validation |
| --- | --- | --- | --- |
| `email` | string | Required; not null/blank | `@Email` |
| `password` | string | Required; not null/blank | length 8–100 |

Success response (`UserResponse`):

| Field | JSON type | Nullable | Source |
| --- | --- | --- | --- |
| `id` | UUID string | No | Server-generated UUID |
| `email` | string | No | Persisted request value |
| `createdAt` | ISO local date-time | No | Server-generated `LocalDateTime.now()` |

Errors: `400` validation uses `{ status: 400, code: "VALIDATION_ERROR", errors: Record<string,string>, timestamp }`; duplicate email is `409` with `{ status: 409, code: "EMAIL_ALREADY_EXISTS", message, timestamp }`. Registration does not log in and does not return a token.

### Login

`POST /api/auth/login` is public and returns `200 OK`.

Request body (`LoginRequest`):

| Field | JSON type | Required / nullable | Validation |
| --- | --- | --- | --- |
| `email` | string | Required; not null/blank | `@Email` |
| `password` | string | Required; not null/blank | No size constraint in this DTO |

Success response (`AuthResponse`) remains exactly:

```json
{ "accessToken": "<signed JWT>" }
```

There is no `tokenType`, expiry field, refresh token, or user object in the JSON response. The JWT contains subject=user UUID, issued-at, and expiration claims; its default lifetime is 3,600,000 ms (1 hour). Login also creates a server-side refresh session and sends `Set-Cookie` for `refreshToken`. The raw refresh token is never returned in JSON and PostgreSQL stores only its SHA-256 hash.

The refresh cookie is host-only (no `Domain`), `HttpOnly`, has `Path=/api/auth`, and has a maximum lifetime matching the refresh session (default 2,592,000,000 ms / 30 days from login). Production must configure `Secure=true` and `SameSite=None` because the Angular and API deployments are cross-site. Local HTTP development defaults to `Secure=false` and `SameSite=Lax`. Browsers or privacy modes that block third-party cookies can still block the current Vercel-to-Render cookie; for maximum compatibility, deploy frontend and API on same-site custom domains or proxy `/api` through the frontend origin.

Invalid payload is `400 VALIDATION_ERROR`. Unknown email or wrong password is `401` with `{ status: 401, code: "INVALID_CREDENTIALS", message, timestamp }`.

### Refresh

`POST /api/auth/refresh` is public in Spring Security because authentication is the refresh cookie, not the bearer token. It accepts no body. Angular must call it with credentials (`withCredentials: true`). A valid cookie returns the same exact JSON shape as login:

```json
{ "accessToken": "<new signed JWT>" }
```

Every successful refresh rotates the cookie. The 30-day expiry is absolute from login and does not slide on each refresh. The old token is immediately revoked. Missing, unknown, expired, revoked, or reused tokens return `401` with code `INVALID_REFRESH_TOKEN` and clear the cookie. Reuse of a rotated token revokes every still-active token in that refresh family, including the newer token, so Angular must discard local authentication and require login. Concurrent refresh requests must be coalesced client-side: only one refresh request should be in flight.

### Logout

`POST /api/auth/logout` accepts no body and should be called with `withCredentials: true`. It is idempotent, returns `204 No Content`, revokes the refresh family when the cookie is known, and always expires the refresh cookie. The access JWT is not persisted and therefore remains cryptographically valid until its short expiry; Angular must delete its in-memory/local copy immediately and must not send it again.

### Angular authentication flow

1. Send login with `withCredentials: true`, retain `accessToken`, and let the browser manage the refresh cookie.
2. Send protected API calls with `Authorization: Bearer <accessToken>`.
3. On application startup (when no usable access token exists) or after an access-token `401`, make one `POST /api/auth/refresh` with `withCredentials: true`, save the returned `accessToken`, then retry the original request once.
4. Do not read, copy, persist, or include a refresh token in JavaScript or a request body; it is HttpOnly and browser-managed.
5. If refresh returns `401`, clear client auth state and navigate to login. Do not retry refresh recursively.
6. On logout, call `POST /api/auth/logout` with credentials, clear the access token regardless of the response, and navigate to login.

### Protected requests

Send `Authorization: Bearer <accessToken>`. Missing, malformed, expired, or invalid tokens receive `401` through Spring Security's `sendError`; its body is not guaranteed to match the application error DTO. There are no roles. The authenticated JWT subject, never a request user ID, determines ownership.

## 3. Current authenticated user

`GET /api/users/me` requires a valid bearer JWT and returns `200 UserResponse` with exactly `id`, `email`, and `createdAt` defined above. It returns `401` for an absent/invalid token and `404 RESOURCE_NOT_FOUND` if the token subject no longer has a user row. This is the only current-user endpoint.

## 4. Exercise identity and migration

All exercise routes require JWT. `GET /api/exercises` returns a custom page object, not a raw array:

```ts
interface ExercisePageResponse {
  content: ExerciseResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}
```

`page` defaults to 0 and must be >= 0; `size` defaults to 20 and must be 1–100. Optional filters are `search`, `category`, `equipment`, `muscleGroup`, and `targetMuscle`.

### Filter metadata

`GET /api/exercises/filter-options` requires the same bearer JWT as every exercise route and returns `200 ExerciseFilterOptionsResponse`:

```ts
interface ExerciseFilterOptionsResponse {
  categories: string[];
  equipment: string[];
  muscleGroups: string[];
  targetMuscles: string[];
}
```

The endpoint does not accept query parameters and does not modify `GET /api/exercises` filtering or pagination. Each array is non-null and contains only non-null, non-blank, distinct values from visible, non-deleted exercises: global dataset exercises plus exercises owned by the authenticated JWT user. Another user's custom exercise values are excluded. Values are returned alphabetically in the server's natural string order. `secondaryMuscles` is deliberately not included. Missing/invalid JWT returns the normal security `401` response.

`ExerciseResponse` is:

```ts
interface ExerciseResponse {
  id: string;
  clientId: string | null;
  source: 'EXERCISES_DATASET' | 'USER';
  sourceId: string | null;
  editable: boolean;
  deletable: boolean;
  category: string | null;
  equipment: string | null;
  targetMuscle: string | null;
  muscleGroup: string | null;
  secondaryMuscles: string[] | null;
  translations: Array<{ language: string; name: string; instructions: string | null }>;
  aliases: Array<{ language: string; alias: string }>;
}
```

`id` is the server UUID and is the reference sent by routines/workout exercises. For dataset items, the stable migration identity is `(source, sourceId)` where `source === "EXERCISES_DATASET"`; the database has a unique source/sourceId index for non-null source IDs. For caller-created exercises, use the client-generated `clientId` and returned server `id`. Translation `name`, category, muscle fields, aliases, and free-text metadata are not declared unique and are not reliable matching keys. `ownerId` is never exposed. `editable`/`deletable` are the action contract for the current caller.

`POST /api/exercises` and `PUT /api/exercises/{id}` use `CreateExerciseRequest`:

| Field | Required / nullable | Validation |
| --- | --- | --- |
| `clientId` UUID | Optional/null | None; POST retries find caller-owned resource by it |
| `category`, `equipment`, `targetMuscle`, `muscleGroup` | Optional/null | max 100 each |
| `secondaryMuscles` string[] | Optional/null | No element/length constraint |
| `translations` array | Required, non-null, not empty | each item valid |
| `translations[].language` | Required | nonblank, max 10 |
| `translations[].name` | Required | nonblank, max 255 |
| `translations[].instructions` | Optional/null | No constraint |

## 5. Routine API

All routine endpoints require JWT and operate only on the authenticated user's non-deleted routines. Foreign, deleted, or absent routine IDs return `404 RESOURCE_NOT_FOUND`.

### DTOs

Request for create and replacement update (`CreateRoutineRequest`):

| Field | JSON type | Required / nullable | Validation / behavior |
| --- | --- | --- | --- |
| `clientId` | UUID string | Optional/null | POST idempotency identifier scoped to user |
| `name` | string | Required | nonblank, max 150 |
| `description` | string | Optional/null | max 500 |
| `exercises` | `RoutineExerciseRequest[]` | Required; may be `[]` | non-null, max 50; every item validated |

`RoutineExerciseRequest`:

| Field | JSON type | Required / nullable | Validation |
| --- | --- | --- | --- |
| `exerciseId` | UUID string | Required | must refer to a visible non-deleted global or caller-owned exercise |
| `position` | number | Required primitive | integer >= 0; supplied by client; unique within the request/routine |
| `sets` | number | Required primitive | integer >= 1 |
| `targetReps` | number | Required primitive | integer >= 1 |
| `restSeconds` | number | Required primitive | integer >= 0 |
| `notes` | string | Optional/null | max 500 |

Absent primitive fields bind as `0` and consequently fail their minimum validations where applicable. Repeated positions return `400 DUPLICATE_EXERCISE_POSITION`.

Detail response (`RoutineResponse`):

```ts
interface RoutineResponse {
  id: string;                 // server-generated
  clientId: string | null;
  name: string;
  description: string | null;
  exercises: RoutineExerciseResponse[]; // ordered position ASC; may be []
  createdAt: string;          // LocalDateTime
  updatedAt: string;          // LocalDateTime
}
interface RoutineExerciseResponse {
  id: string;                 // server-generated row ID
  exerciseId: string;
  position: number;           // 0-based client-supplied order
  sets: number;
  targetReps: number;
  restSeconds: number;
  notes: string | null;
}
```

On `PUT`, all prior routine-exercise rows are deleted and replacement rows receive new `id` values. `createdAt` is server-created on POST; `updatedAt` is server-created on POST and refreshed on PUT. Neither is client-supplied.

List item response (`RoutineSummaryResponse`) is the same routine-level fields (`id`, `clientId`, `name`, `description`, `createdAt`, `updatedAt`) but omits `exercises`.

### Endpoints

| Method/path | Request | Success | List/ownership/error behavior |
| --- | --- | --- | --- |
| `GET /api/routines?page=&size=&sort=` | none | `200 Page<RoutineSummaryResponse>` | Spring Page; only caller's non-deleted routines. Default page 0/size 10. Request `sort` binds but service always orders `createdAt DESC, id ASC`. |
| `GET /api/routines/{id}` | none | `200 RoutineResponse` | Child exercises ordered `position ASC`; `404` absent/foreign/deleted. |
| `POST /api/routines` | `CreateRoutineRequest` | `201 RoutineResponse` | Caller owns it; invalid body/position => `400`; unavailable exercise => `404`. Same caller `clientId` returns existing resource on retry (controller still emits 201). |
| `PUT /api/routines/{id}` | `CreateRoutineRequest` | `200 RoutineResponse` | Full replacement of routine exercises; `404` absent/foreign/deleted. `clientId` is not changed by update. |
| `DELETE /api/routines/{id}` | none | `204` empty | Soft delete; `404` absent/foreign/already deleted. |

Current Spring Page JSON fields are `content`, `totalElements`, `totalPages`, `size`, `number`, `sort`, `pageable`, `first`, `last`, `numberOfElements`, and `empty`. It is not the exercise custom-page shape.

## 6. Workout lifecycle

All workout routes require JWT; a workout belongs to the JWT subject. There is no boolean `active`/`completed` field in a response: client code may treat `completedAt === null` as unfinished, but there is no active-workout query/filter endpoint.

### Start/create

`POST /api/workouts` accepts `CreateWorkoutRequest`:

| Field | JSON type | Required / nullable | Validation / behavior |
| --- | --- | --- | --- |
| `clientId` | UUID string | Optional/null | Idempotency identifier scoped to user |
| `routineId` | UUID string | Required | must be a non-deleted routine owned by caller; otherwise `404` |
| `startedAt` | ISO local date-time | Optional/null | client value, otherwise server `LocalDateTime.now()` |
| `completedAt` | ISO local date-time | Optional/null | client value allowed only when it is not before effective `startedAt`; invalid relation => `400 INVALID_REQUEST` |
| `notes` | string | Optional/null | max 500 |

It returns `201 WorkoutResponse`. The server creates a snapshot of every current routine exercise, copying `exerciseId`, `position`, and routine-exercise `notes`. It does not copy routine `sets`, `targetReps`, or `restSeconds`. Retrying a POST with the same caller `clientId` returns the existing workout (still status 201 by controller annotation).

### Read/history

| Method/path | Success | Behavior |
| --- | --- | --- |
| `GET /api/workouts/{id}` | `200 WorkoutResponse` | Caller-owned workout only; `404` absent/foreign. Exercises ordered `position ASC`; each set ordered `setNumber ASC`. |
| `GET /api/workouts?page=&size=&sort=` | `200 Page<WorkoutResponse>` | Caller-owned history, no date/completion filter. Default page 0/size 10. Service ignores requested sort and uses `createdAt DESC, id ASC`. Every item includes exercises and sets. Spring Page shape is exactly the routine list page shape above. |

### Add exercises and sets

Adding a workout exercise directly is **not supported by the current API**. Workout exercises are only created as the routine snapshot during `POST /api/workouts`.

`POST /api/workouts/{workoutId}/exercises/{workoutExerciseId}/sets` accepts `WorkoutSetRequest` and returns `201 WorkoutSetResponse`:

| Field | JSON type | Required / nullable | Validation |
| --- | --- | --- | --- |
| `clientId` | UUID string | Optional/null | Retry identity scoped to the workout exercise |
| `setNumber` | number | Required primitive | integer >= 1 |
| `weight` | JSON number | Required | decimal 0.00–9999.99 |
| `reps` | number | Required primitive | integer >= 1 |
| `rpe` | JSON number | Optional/null | decimal 0.0–10.0 |

The supplied `workoutId` must be caller-owned and `workoutExerciseId` must belong to that workout; otherwise `404`. Same `clientId` returns the existing set on retry. A different/new request using a duplicate `(workoutExerciseId, setNumber)` gets `400 DUPLICATE_WORKOUT_SET_NUMBER`.

### Edit/complete/delete

`PATCH /api/workouts/{id}` is the only update endpoint. Request (`UpdateWorkoutRequest`):

| Field | JSON type | Required / nullable | Actual behavior |
| --- | --- | --- |
| `completed` | boolean | Optional/null | `true` sets `completedAt` to server now; `false` clears `completedAt`; null/omitted leaves it unchanged. It cannot set an arbitrary completion timestamp. |
| `notes` | string | Optional/null | max 500; non-null replaces notes. `null`/omitted leaves notes unchanged, so this endpoint cannot clear notes. |

It returns `200 WorkoutResponse`; absent/foreign workout is `404`, invalid body is `400`.

Deleting a workout is **not supported by the current API**. Editing or deleting a workout exercise is **not supported by the current API**. Editing or deleting a set is **not supported by the current API**.

### Workout DTOs

```ts
interface WorkoutResponse {
  id: string;                    // server-generated
  clientId: string | null;
  routineId: string | null;      // response is nullable by model; POST-created values are non-null
  startedAt: string;             // LocalDateTime; client supplied or server-generated
  completedAt: string | null;
  notes: string | null;
  exercises: WorkoutExerciseResponse[]; // may be []
  createdAt: string;             // server-created audit timestamp
}
interface WorkoutExerciseResponse {
  id: string;                    // server-generated
  exerciseId: string;
  position: number;              // copied from routine; 0-based convention
  notes: string | null;          // copied from routine at creation
  sets: WorkoutSetResponse[];    // may be []
}
interface WorkoutSetResponse {
  id: string;                    // server-generated
  clientId: string | null;
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number | null;
}
```

## 7. Set numbering and ordering

Every set has a server-generated UUID `id`. There is no separate set `position` field and the server does not derive sequence. The client supplies `setNumber`, which is 1-based (`>= 1`) and unique within a workout exercise. The database enforces that uniqueness. Workout detail and list responses guarantee sets ordered by `setNumber ASC`; workout exercises are ordered by `position ASC`. Routine/workout exercise position is 0-based (`>= 0`).

## 8. Statistics

Every statistics endpoint requires JWT. Query date parameters are required `LocalDate` values in `YYYY-MM-DD`; none accepts timestamps. `to < from` returns `400 INVALID_REQUEST`. Missing/malformed query values are framework binding errors and are not guaranteed to use the application error body.

The domain interval is inclusive by API meaning: internally `[from 00:00, day-after-to 00:00)`, compared to workout `startedAt`. It uses `LocalDateTime`/database date extraction with no declared timezone, UTC conversion, or offset contract.

### `GET /api/statistics/summary?from=&to=`

Returns `200 StatisticsSummaryResponse`:

```ts
interface StatisticsSummaryResponse {
  from: string;       // YYYY-MM-DD, request echo
  to: string;         // YYYY-MM-DD, request echo
  workouts: number;   // long, includes incomplete/empty workouts in range
  sets: number;       // long
  reps: number;       // long
  volume: number;     // BigDecimal sum(weight * reps)
  maxWeight: number;  // BigDecimal maximum set weight
}
```

All aggregate numeric fields are non-null. Empty data yields zero for all numeric aggregates.

### `GET /api/statistics/comparison?currentFrom=&currentTo=&previousFrom=&previousTo=`

All four parameters are required `YYYY-MM-DD`. Returns `200`:

```ts
interface StatisticsComparisonResponse {
  current: StatisticsSummaryResponse;
  previous: StatisticsSummaryResponse;
  changes: {
    workouts: number; sets: number; reps: number; volume: number; maxWeight: number;
  };
}
```

`changes` are `double` percentages. If previous is zero, change is `0.0` when current is zero and `100.0` otherwise. All nested aggregate fields are non-null, including empty ranges.

### `GET /api/statistics/evolution?from=&to=`

Both parameters are required `YYYY-MM-DD`. Returns `200`:

```ts
interface StatisticsEvolutionResponse {
  from: string;
  to: string;
  data: Array<{
    date: string; workouts: number; sets: number; reps: number; volume: number; maxWeight: number;
  }>;
}
```

`data` is non-null, ordered `date ASC`, and contains only dates having a caller workout. Missing dates are not zero-filled. Point numeric fields are non-null.

### `GET /api/statistics/exercises/{exerciseId}?from=&to=`

`exerciseId` is required UUID path parameter; `from` and `to` are required `YYYY-MM-DD`. Returns `200` for every parseable UUID, even if the exercise is absent/inaccessible or has no caller data:

```ts
interface ExerciseStatisticsResponse {
  exerciseId: string;
  from: string;
  to: string;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  maxWeight: number;
  evolution: Array<{ date: string; volume: number; maxWeight: number }>;
}
```

All aggregate fields are non-null and no matching data yields zeros plus `evolution: []`. Evolution is date ascending and only includes dates having a matching caller workout exercise. This route does not existence-check the exercise; it is scoped by `workouts.user_id`.

## 9. Dates, timestamps, and timezone limitation

| Field | Java type / JSON | Client or server | Meaning |
| --- | --- | --- | --- |
| User `createdAt` | `LocalDateTime` / ISO local date-time | Server | Account record creation time |
| Routine `createdAt`, `updatedAt` | `LocalDateTime` / ISO local date-time | Server | Routine audit timestamps; update refreshes only `updatedAt` |
| Workout `startedAt` | `LocalDateTime` / ISO local date-time | Client optional; server now fallback | Actual session start/domain time |
| Workout `completedAt` | `LocalDateTime` / ISO local date-time or null | Client optional at POST; server now/clear through PATCH | Actual completion/domain time |
| Workout `createdAt` | `LocalDateTime` / ISO local date-time | Server | Record creation audit time; never backdated |
| Statistics parameters/response dates | `LocalDate` / `YYYY-MM-DD` | Client query / server response | Calendar intervals derived from `startedAt` |
| Statistics evolution point `date` | `LocalDate` / `YYYY-MM-DD` | Server | `DATE(started_at)` |

The backend declares no timezone, offset, UTC normalization, or user-zone convention. All `LocalDateTime` values are unspecified local times. Angular must not label them as UTC or use offset arithmetic without a product-level convention.

## 10. Unsupported Operations Relevant to Angular

- Register-and-login in one request: **Not supported by the current API.**
- Access-token expiry is represented only by the JWT `exp` claim; it is not a separate response field.
- Add a workout exercise independently: **Not supported by the current API.**
- Edit/delete a workout exercise: **Not supported by the current API.**
- Edit/delete a workout set: **Not supported by the current API.**
- Delete a workout: **Not supported by the current API.**
- Clear workout notes through PATCH: **Not supported by the current API.**
- Set arbitrary `completedAt` through PATCH: **Not supported by the current API.**
- Arbitrary historical workout snapshot import (one whose exercises do not match a server-migrable routine): **Not supported by the current API.**
- Bulk migration/import endpoint: **Not supported by the current API.**
- Workout history filters by date or active/completed state: **Not supported by the current API.**

## 11. OpenAPI completeness cross-check

`/v3/api-docs` discovers all controller routes and DTO schemas through Springdoc. It correctly reflects the existing statistics-exercise `200` behavior rather than a 404.

Swagger annotations often provide only response descriptions, not explicit schemas or all implementation outcomes. In particular, generated Swagger does not clearly explain: idempotent `clientId` retry semantics and its 201 status; routine replacement generating new child IDs; server-overridden `sort`; Spring Page serialization metadata; ordering guarantees; nullable/unchangeable PATCH notes; security's non-application 401 body; the local-time/no-timezone limitation; or unsupported subresource operations. This contract supplies those implementation-verified details. No OpenAPI annotation change is needed to keep existing API behavior truthful.
