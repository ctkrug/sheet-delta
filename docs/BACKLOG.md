# Backlog

Epics are ordered so the wow moment (Epic 1, Story 1) is reachable before anything optional.
Every story lists concrete, checkable acceptance criteria — not vibes.

## Epic 1 — Core diff pipeline & the wow moment

- [ ] **Story 1 (WOW MOMENT): End-to-end drop-two-files-see-the-grid-diff demo**
  - Dropping a before/after CSV pair where one cell changed and one row was reordered renders
    the grid with exactly one cell highlighted as changed and zero rows flagged as
    added/removed for the reorder.
  - The diff runs entirely via the WASM engine; the browser dev tools network tab shows zero
    requests fire after the two files are dropped.
- [ ] **Story 2: CSV parsing via SheetJS**
  - A `.csv` file with a header row and mixed types (numbers, text, empty cells) parses into a
    row/column grid matching the source exactly.
  - A malformed CSV (e.g. an unterminated quote) shows an inline error state, not a crash.
- [ ] **Story 3: Excel (.xlsx/.xls) parsing via SheetJS**
  - A `.xlsx` workbook with a single sheet parses to the same row/column shape as an equivalent
    CSV export of the same data.
  - A multi-sheet workbook lets the user pick which sheet to compare, defaulting to the first
    sheet if unchanged.
- [ ] **Story 4: Column alignment (insertion / removal / reorder)**
  - Inserting a new column in the middle of "after" is detected as a single column insert, not
    a cascade marking every subsequent column as changed.
  - Removing a column from "after" marks it removed and does not misalign the remaining
    columns' cell-level diffs.

## Epic 2 — Grid rendering & interaction

- [ ] **Story 5: Grid renders with DESIGN.md highlight styling**
  - Added rows use the `--success` tint, removed rows use `--danger`, and changed cells get an
    accent-bordered highlight, matching `docs/DESIGN.md` tokens exactly.
  - The header row stays pinned while scrolling vertically on a 5,000-row sheet.
- [ ] **Story 6: Diff summary bar**
  - The summary bar shows counts for rows added, rows removed, rows changed, and total cells
    changed, digit-rolling into place per `docs/DESIGN.md`'s signature detail.
  - Counts update correctly when a new file pair is dropped, without a full page reload.
- [ ] **Story 7: Drag-and-drop + click-to-browse upload UX**
  - Dragging a file over a drop zone shows a themed hover/active state before it's dropped.
  - Dropping an unsupported file (e.g. `.png`) shows an inline error naming the accepted
    formats instead of failing silently.
- [ ] **Story 8: Design polish pass for Epic 1–2 surfaces**
  - The page matches `docs/DESIGN.md` at 390px, 768px, and 1440px with no horizontal scroll and
    no dead empty space.
  - Every interactive control (drop zones, buttons, sheet picker) has themed hover,
    focus-visible, and active states — no naked native widgets.

## Epic 3 — Performance & robustness

- [ ] **Story 9: Large-sheet performance**
  - Diffing two 50,000-row sheets completes in under 3 seconds on a mid-tier laptop without
    freezing the tab.
  - Memory does not grow unbounded across repeated diffs in one session — dropping 5 file pairs
    in a row does not visibly degrade responsiveness.
- [ ] **Story 10: Duplicate-row handling**
  - Two sheets containing several byte-identical rows (e.g. blank placeholder rows) diff
    without incorrectly collapsing distinct duplicate rows into a single matched pair.
- [ ] **Story 11: Empty-cell and type-coercion edge cases**
  - A cell that changes from empty to a value (or vice versa) is flagged as changed, not
    ignored.
  - Numerically-equal-but-differently-formatted values (e.g. `"1.0"` vs `"1"`) are handled per a
    single documented rule, applied consistently by the diff engine.
- [ ] **Story 12: Export the diff result**
  - A "download diff" action produces a CSV or static HTML snapshot capturing the highlighted
    grid.
  - The exported file opens correctly and visually reflects the same changed cells shown
    on-screen at export time.

## Epic 4 — Ship polish

- [ ] **Story 13: Empty-state landing copy on the app shell**
  - Before any files are dropped, the empty state explains the tool's value within one screen
    at 1440px, with no scrolling required, per `docs/DESIGN.md` layout intent.
- [ ] **Story 14: Loading and error states**
  - A file above a defined size threshold shows a loading indicator during parse/diff instead
    of an unresponsive UI.
  - A caught parse/diff error shows a designed error state (not a browser `alert` or blank
    screen) with a retry action.
- [ ] **Story 15: Accessibility pass**
  - Every interactive element is reachable and operable via keyboard alone (Tab/Enter/Space),
    verified by a full keyboard-only walkthrough of the upload-to-diff flow.
  - Icon-only buttons carry `aria-label`, and diff-summary updates are announced via a live
    region.
