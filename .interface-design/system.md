# Gym Tracker UI system

## Direction and feel

**Rubber, steel & chalk.** Gym Tracker is a focused training instrument for someone logging a set between lifts. It uses a chalk-white canvas, rubber-charcoal structure and one plate-lime action/progress accent. The experience should feel athletic, direct and calm under effort—not like a generic analytics dashboard.

The product signature is the **training log line**: ordered exercise numbers, set rows, large tabular training values and a continuous progress rail. This language should appear in active training, routines, history and recent-session summaries.

## Foundations

- **Depth:** use quiet surface shifts and low-opacity dividers. Reserve `--shadow-card` for elevated focal surfaces such as the next-session launcher or sheets. Lists and repeated records stay flat.
- **Spacing:** 4px base rhythm. Dense rows use 8–12px gaps, controls 12–16px padding, sections 24–36px separation and primary focal areas 40–48px breathing room.
- **Radius:** controls `--radius-control` (12px), rare grouped surfaces `--radius-card` (16px), sheets/auth panels `--radius-sheet` (24px). Repeated list rows do not get individual radii.
- **Typography:** rounded system stack. Headings use strong weight and negative tracking; labels are compact, uppercase and tracked; training values, counters and timers use tabular numerals.
- **Color:** `--rubber` provides primary structure, `--plate` and `--plate-strong` mean action/progress, `--cloud` means account-backed data, and `--danger` is destructive only.
- **Controls:** 44px minimum hit target. Inputs are inset via `--surface-sunken`; focus uses `--focus`. Buttons receive brief scale feedback and never use `transition: all`.

## Hierarchy

- Every screen has one focal action: next session on Home, routine choice in Train, current set in Training, search in Exercises, chronological session in History.
- Important training numbers use the largest weight/size contrast. Labels and persistence metadata remain tertiary.
- Prefer grouped lists, dividers, sticky controls and bottom sheets over collections of independent cards.
- Local/cloud distinctions are visible but secondary. Use human labels such as “En este dispositivo” and “En tu cuenta”; never expose implementation vocabulary in primary copy.

## Navigation

- Below 48rem, use the bottom navigation: Inicio, Rutinas, Entrenar, Historial and Estadísticas. Entrenar is the centered raised action.
- At 48rem and above, navigation becomes a fixed 84px vertical rail on the left. Content receives corresponding left clearance; do not stretch the mobile bar across the viewport.
- Exercises and Settings are contextual/secondary destinations rather than equal-frequency mobile tabs.
- Active-training and destructive actions must sit above navigation and safe-area insets.

## Screen composition

### Home

- Lead with “Tu próximo movimiento”: resume an active workout or launch routine selection.
- Follow with up to three routine shortcuts, weekly training pulse and the latest session.
- On desktop, use a two-column dashboard; the next-session launcher spans both columns.

### Routines and training selection

- Routines are flat, numbered/scannable rows with source, exercise count and restrained edit/delete actions.
- At desktop widths, use a list plus sticky editor. The editor may scroll independently for long routines.
- Training selection is a launch list, not a settings form. One tap on a routine starts its existing local/cloud flow.

### Exercise library

- Search is the dominant control. Filters form a compact band beneath or beside it.
- Results are dense rows with name first, muscle/category metadata second and source last.
- Details and custom-exercise forms use constrained editorial widths rather than full-width cards.

### Active workout

- Use a sticky charcoal command bar with routine, elapsed timer, completed/total sets, progress rail and persistence state.
- Each exercise is a numbered section. Each set is one compact row; reps and weight are the dominant inputs.
- Completed local sets receive a quiet plate wash. Persisted cloud sets are clearly locked; editable drafts keep an explicit Save action.
- Notes are collapsed by default on mobile. Finish is sticky, visually separated and always requires confirmation.
- At desktop widths, keep the set log in the main column and session notes in a sticky side column.

### History and workout detail

- History opens in chronological-list mode; the week view remains available as a secondary perspective.
- Session rows use a training timeline accent and preserve local/cloud identity.
- Workout detail uses exercise sections with dense set tables. On desktop, exercise identity/notes and set data form a two-column scan pattern.

### Statistics

- Period and source controls stay near the header.
- Primary metrics form one connected numeric band, not separate KPI cards.
- Daily distribution follows as the supporting training rhythm, using the plate accent only for actual activity.

### Settings and migration

- Organize account, data/cloud, migration, preferences and backup as clearly separated sections.
- Keep most sections flat; migration may use a contained surface because it represents a discrete guided operation.
- Describe migration as data on this device, data in the account, choices required and items that cannot be uploaded.

## Reusable patterns

- `app-kicker`: 11px-equivalent tracked section/context label.
- `source-badge` and `source-badge--cloud`: secondary persistence labels.
- `metric-value` / `numeric`: tabular values with negative tracking.
- `.routine-launch`: 84px minimum launch row with index, identity, source and forward affordance.
- `.exercise-log`: numbered exercise section containing flat `.set-row` records.
- `.session-commandbar`: sticky session identity and progress context.
- `.session-finish`: safe-area-aware persistent finish action; confirmation uses `.finish-sheet`.
- `.section-heading`: kicker/title plus a single tertiary destination.

## Motion and states

- Interaction feedback is 120–180ms and limited to transform, opacity and color.
- Respect `prefers-reduced-motion` globally.
- Every data view retains loading, empty and failure states. Offline/cloud failures must never hide usable local data.
