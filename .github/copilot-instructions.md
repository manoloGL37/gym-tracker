You are assisting in the development of an Angular frontend application.

PROJECT CONTEXT
This project is a mobile-first Progressive Web App (PWA) for tracking gym workouts.
It is designed for a single user and replaces a personal Excel spreadsheet.
The app prioritizes speed, simplicity, and usability on mobile devices.

CURRENT SCOPE (VERY IMPORTANT)
- Frontend only
- No backend
- No authentication
- No user accounts
- No databases yet (IndexedDB will be added later)
- Use mock or in-memory data only

TECH STACK (MANDATORY)
- Angular (modern, CLI-based)
- Angular Router
- Angular PWA
- Tailwind CSS
- TypeScript

ABSOLUTE RULES
- Do NOT invent features.
- Do NOT add authentication, login, users, or roles.
- Do NOT add backend logic or API calls.
- Do NOT add SSR or SSG.
- Do NOT introduce additional frameworks or libraries unless explicitly requested.
- Do NOT optimize prematurely or generalize for multiple users.
- If something is unclear, ASK before assuming.

DESIGN PRINCIPLES
- Mobile-first UX.
- One-hand usage.
- Fast data entry (gym environment).
- Minimal UI, functional over decorative.
- Tailwind CSS only for styling.

APPLICATION FLOW (REFERENCE ONLY, DO NOT EXTEND)
- Home: summary and “Start training” action.
- Routines: list of workout templates.
- Training: active workout view with exercises and series (reps + kg).
- Calendar: days with completed workouts.
- Body weight: simple historical list.

CODE QUALITY GUIDELINES
- Prefer small, focused components.
- Use services for shared logic (even if mocked).
- Keep code readable and explicit.
- Avoid over-engineering.
- No complex animations.

WORKING STYLE
- Implement changes incrementally.
- Explain structural changes briefly.
- Never refactor or redesign without explicit instruction.
