# Gym Tracker UI system

## Direction

**Cuaderno de pista.** Gym Tracker is a disciplined mobile training ledger: mineral paper, blackened navy structure and a controlled performance-coral signal. It must read as a physical training instrument in grayscale through scale, rules, sequence and density—not through cards or color alone.

## Foundations

- Ground `--ground`, working paper `--paper`, recessed fields `--paper-low`, structure `--ink`, action/progress `--signal`, success and danger only for their semantic states.
- Typography is structural: the numeric stack owns timers, loads, repetitions and major totals; the UI stack owns labels and prose.
- Use a 4px spacing rhythm, 44px minimum targets, clear focus, safe-area spacing and no `transition: all`.
- Repeated records are open rows separated by rules. Contained surfaces are reserved for overlays, focused editors and exceptional state changes.

## Product grammar

- Mobile shell: five-destination bottom dock with a central training action. Desktop: compact top masthead; content never becomes a stretched phone column.
- Home: one dark launch lane, then routine choices and a small amount of weekly/recent context.
- Active workout: compact sticky command bar, continuous progress, numbered exercise ledgers and dense touch-safe set rows. “Anterior” is historical reference, never a generated target.
- Routines: numbered training plans with previews and direct start/edit actions; editor exposes order as the primary structure.
- Catalog: search-first stage, secondary filters and dense selectable result rows.
- History: chronological diary first, week view second. Details remain a set ledger.
- Statistics: one dominant measure, integrated trend and supporting comparisons; never an equal-card KPI grid or source selector.
- Settings: quiet, flat sections using product language for account and synchronization.
- Secondary records (body weight, exercise history, manual workout) reuse the ledger grammar rather than legacy dashboard cards.

## Motion and states

- Motion explains completion, expansion and spatial entry in 120–240ms using transform/opacity/color.
- Respect `prefers-reduced-motion` globally.
- Every data view provides useful loading, empty and recoverable-error states. Account failures never hide usable local data.
