# Backlog

Epics are ordered so the wow moment (Epic 1, Story 1) is reachable before anything optional.
Every story lists concrete, checkable acceptance criteria — not vibes.

A story is checked off only when its criteria were verified, not when the code looked done.
Where a criterion could not be verified in this environment, it says so rather than passing.

## Epic 1 — Core diff pipeline & the wow moment

- [x] **Story 1 (WOW MOMENT): End-to-end drop-two-files-see-the-grid-diff demo**
  - Dropping a before/after CSV pair where one cell changed and one row was reordered renders
    the grid with exactly one cell highlighted as changed and zero rows flagged as
    added/removed for the reorder.
  - The diff runs entirely via the WASM engine; the browser dev tools network tab shows zero
    requests fire after the two files are dropped.
  - *Verified:* the engine case in `diff_test.go`, the same case through the real compiled
    binary in `scripts/smoke-wasm.mjs`, and drop-to-grid in `app.test.ts`. No network: there
    is no server and no fetch after the engine loads — but this has not been watched in a
    real dev tools network tab (no browser on the build box).
- [x] **Story 2: CSV parsing via SheetJS**
  - A `.csv` file with a header row and mixed types (numbers, text, empty cells) parses into a
    row/column grid matching the source exactly.
  - A malformed CSV (e.g. an unterminated quote) shows an inline error state, not a crash.
  - *Verified:* `parse.test.ts`. SheetJS recovers from an unterminated quote rather than
    throwing; either way the contract holds — a sheet or a designed error, never a crash.
- [x] **Story 3: Excel (.xlsx/.xls) parsing via SheetJS**
  - A `.xlsx` workbook with a single sheet parses to the same row/column shape as an equivalent
    CSV export of the same data.
  - A multi-sheet workbook lets the user pick which sheet to compare, defaulting to the first
    sheet if unchanged.
  - *Verified:* `parse.test.ts` round-trips a real `.xlsx` binary against the equivalent CSV;
    the picker and its default are covered in `app.test.ts`.
- [x] **Story 4: Column alignment (insertion / removal / reorder)**
  - Inserting a new column in the middle of "after" is detected as a single column insert, not
    a cascade marking every subsequent column as changed.
  - Removing a column from "after" marks it removed and does not misalign the remaining
    columns' cell-level diffs.
  - *Verified:* `column_test.go` and `diff_test.go`.

## Epic 2 — Grid rendering & interaction

- [x] **Story 5: Grid renders with DESIGN.md highlight styling**
  - Added rows use the `--success` tint, removed rows use `--danger`, and changed cells get an
    accent-bordered highlight, matching `docs/DESIGN.md` tokens exactly.
  - The header row stays pinned while scrolling vertically on a 5,000-row sheet.
  - *Partly verified:* the row/cell classes and tokens are asserted in `grid.test.ts` and
    `style.css`; the header uses `position: sticky` and the grid renders 5,000 rows before
    prompting. **Neither the styling nor the sticky scroll has been looked at in a browser** —
    jsdom does not lay out or scroll. QA must confirm visually.
- [x] **Story 6: Diff summary bar**
  - The summary bar shows counts for rows added, rows removed, rows changed, and total cells
    changed, digit-rolling into place per `docs/DESIGN.md`'s signature detail.
  - Counts update correctly when a new file pair is dropped, without a full page reload.
  - *Verified:* `summary.test.ts` (including a mid-roll value proving it animates) and
    `app.test.ts`.
- [x] **Story 7: Drag-and-drop + click-to-browse upload UX**
  - Dragging a file over a drop zone shows a themed hover/active state before it's dropped.
  - Dropping an unsupported file (e.g. `.png`) shows an inline error naming the accepted
    formats instead of failing silently.
  - *Verified:* `dropzone.test.ts` and `app.test.ts`. The dragging state's *appearance* is
    styled but unviewed.
- [ ] **Story 8: Design polish pass for Epic 1–2 surfaces**
  - The page matches `docs/DESIGN.md` at 390px, 768px, and 1440px with no horizontal scroll and
    no dead empty space.
  - Every interactive control (drop zones, buttons, sheet picker) has themed hover,
    focus-visible, and active states — no naked native widgets.
  - *Left open deliberately.* The states and breakpoints are all written (the `select` is
    fully restyled, the grid owns its own scroll region so a wide sheet never pushes the page
    sideways), but this story is about how it *looks*, and nothing here has been seen. It
    needs a browser, which the build box does not have.

## Epic 3 — Performance & robustness

- [ ] **Story 9: Large-sheet performance**
  - Diffing two 50,000-row sheets completes in under 3 seconds on a mid-tier laptop without
    freezing the tab.
  - Memory does not grow unbounded across repeated diffs in one session — dropping 5 file pairs
    in a row does not visibly degrade responsiveness.
  - *Not verified against its target.* 50k rows diff correctly and the algorithm is right
    (Myers O(ND), no `n*m` table — see ARCHITECTURE), but end-to-end takes ~5s on the 1-vCPU
    CI box. That is not a mid-tier laptop, so this neither passes nor fails yet. Profile:
    JSON unmarshal in WASM ~2.2s, diff ~2.2s, marshal ~0.8s, JS parse ~0.5s — the boundary,
    not the algorithm. Next lever: stop sending cell values the frontend already has.
- [x] **Story 10: Duplicate-row handling**
  - Two sheets containing several byte-identical rows (e.g. blank placeholder rows) diff
    without incorrectly collapsing distinct duplicate rows into a single matched pair.
  - *Verified:* `diff_test.go`, plus alignment property tests over deliberately
    duplicate-heavy random sequences in `myers_test.go`.
- [x] **Story 11: Empty-cell and type-coercion edge cases**
  - A cell that changes from empty to a value (or vice versa) is flagged as changed, not
    ignored.
  - Numerically-equal-but-differently-formatted values (e.g. `"1.0"` vs `"1"`) are handled per a
    single documented rule, applied consistently by the diff engine.
  - *Verified:* `value_test.go` and `diff_test.go`. The rule is documented on `Normalize` and
    is the only comparison in the package.
- [ ] **Story 12: Export the diff result**
  - A "download diff" action produces a CSV or static HTML snapshot capturing the highlighted
    grid.
  - The exported file opens correctly and visually reflects the same changed cells shown
    on-screen at export time.
  - *Not started.*

## Epic 4 — Ship polish

- [x] **Story 13: Empty-state landing copy on the app shell**
  - Before any files are dropped, the empty state explains the tool's value within one screen
    at 1440px, with no scrolling required, per `docs/DESIGN.md` layout intent.
  - *Partly verified:* the copy exists and is asserted in `app.test.ts`; "within one screen at
    1440px" is a layout claim needing a browser.
- [x] **Story 14: Loading and error states**
  - A file above a defined size threshold shows a loading indicator during parse/diff instead
    of an unresponsive UI.
  - A caught parse/diff error shows a designed error state (not a browser `alert` or blank
    screen) with a retry action.
  - *Verified:* `app.test.ts` covers the loading state, the designed error panel, retry, and
    that an unexpected internal error still shows a human message rather than a stack trace.
    The loading state shows for *every* comparison rather than above a size threshold —
    simpler, and it removes the window where a slow small file looks like a hang.
- [ ] **Story 15: Accessibility pass**
  - Every interactive element is reachable and operable via keyboard alone (Tab/Enter/Space),
    verified by a full keyboard-only walkthrough of the upload-to-diff flow.
  - Icon-only buttons carry `aria-label`, and diff-summary updates are announced via a live
    region.
  - *Groundwork done, story open.* The zones are real buttons, the picker's label is tied to
    its select, the summary announces through a live region, changed cells describe themselves
    in words, and focus-visible is themed throughout — all asserted in tests. But the story
    asks for a *walkthrough*, which needs a browser.
