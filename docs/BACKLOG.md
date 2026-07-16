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
  - *Verified.* The row/cell classes and tokens are asserted in `grid.test.ts`; the sticky
    header and the 5,000-row cap are now asserted against a real Chromium in
    `scripts/smoke-browser.mjs` (the header holds its position while the grid's own region
    scrolls, and "show all" renders the remaining rows), and the rendered page was
    reviewed at 390/768/1440.
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
- [x] **Story 8: Design polish pass for Epic 1–2 surfaces**
  - The page matches `docs/DESIGN.md` at 390px, 768px, and 1440px with no horizontal scroll and
    no dead empty space.
  - Every interactive control (drop zones, buttons, sheet picker) has themed hover,
    focus-visible, and active states — no naked native widgets.
  - *Verified in a browser.* Reviewed at all three widths; horizontal page overflow is
    asserted to be zero at each in `scripts/smoke-browser.mjs`. The blueprint direction,
    both fonts and the graph ruling render as specified. The sheet picker is confirmed
    restyled rather than native (`appearance: none`, IBM Plex Mono, blueprint border, 44px
    tall), and every control shows a themed focus ring.
  - One real defect was found and fixed doing this: at 1440 the empty state was one column
    of prose against a dead right half. It now composes as copy plus a worked sample diff.

## Epic 3 — Performance & robustness

- [ ] **Story 9: Large-sheet performance**
  - Diffing two 50,000-row sheets completes in under 3 seconds on a mid-tier laptop without
    freezing the tab.
  - Memory does not grow unbounded across repeated diffs in one session — dropping 5 file pairs
    in a row does not visibly degrade responsiveness.
  - *Second criterion verified; the first still unmeasured on target hardware.* Memory is
    settled: dropping six 2,000-row pairs in a row in a real browser holds the heap at
    9.5MB and the DOM at a constant node count, round after round — no listener or node
    leak, no degradation. The tab does not freeze; every comparison shows the loading state.
  - The 3s budget is still unproven: 50k rows takes ~5.5s end to end on a 2-vCPU box, which
    is not a mid-tier laptop, so this neither passes nor fails. Profile: JSON unmarshal in
    WASM ~2.2s, diff ~2.2s, marshal ~0.8s, JS parse ~0.5s. The boundary, not the algorithm —
    but only the ~0.8s marshal is recoverable by returning indices instead of values (the
    input must still be read), so that lever is worth less than it looks. Beating this
    properly means a leaner encoding across the boundary, which is a protocol change and
    wants its own story rather than a QA tweak.
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
- [x] **Story 12: Export the diff result**
  - A "download diff" action produces a CSV or static HTML snapshot capturing the highlighted
    grid.
  - The exported file opens correctly and visually reflects the same changed cells shown
    on-screen at export time.
  - *Verified:* `export.test.ts` covers the rendering (statuses, the grid's own row
    numbering, both values of a changed cell, and RFC 4180 quoting so a sheet full of
    commas and newlines survives its own export), `app.test.ts` covers the button's
    lifecycle and the blob's contents, and `scripts/smoke-browser.mjs` downloads the file
    from a real Chromium and reads it back. CSV, not HTML: what people do with a diff is
    take it somewhere else, and everything reads CSV. A changed cell exports as
    `before -> after`, which is how the highlight survives a format with no colour; the
    file also round-trips back through a CSV parser in the tests.

## Epic 4 — Ship polish

- [x] **Story 13: Empty-state landing copy on the app shell**
  - Before any files are dropped, the empty state explains the tool's value within one screen
    at 1440px, with no scrolling required, per `docs/DESIGN.md` layout intent.
  - *Verified.* The copy is asserted in `app.test.ts`, and the state was reviewed at 1440
    in a browser: it fills one screen without scrolling and now carries a worked sample of
    the diff beside the copy.
- [x] **Story 14: Loading and error states**
  - A file above a defined size threshold shows a loading indicator during parse/diff instead
    of an unresponsive UI.
  - A caught parse/diff error shows a designed error state (not a browser `alert` or blank
    screen) with a retry action.
  - *Verified:* `app.test.ts` covers the loading state, the designed error panel, retry, and
    that an unexpected internal error still shows a human message rather than a stack trace.
    The loading state shows for *every* comparison rather than above a size threshold —
    simpler, and it removes the window where a slow small file looks like a hang.
- [x] **Story 15: Accessibility pass**
  - Every interactive element is reachable and operable via keyboard alone (Tab/Enter/Space),
    verified by a full keyboard-only walkthrough of the upload-to-diff flow.
  - Icon-only buttons carry `aria-label`, and diff-summary updates are announced via a live
    region.
  - *Verified by walkthrough in a real browser.* Tab reaches the Before zone, the After zone,
    each sheet picker and the source link, in that order, each with a visible themed focus
    ring; Enter on a zone opens the file browser (asserted in `scripts/smoke-browser.mjs`, so
    the keyboard path cannot silently dead-end). The picker's label is tied to its select and
    its control is 44px tall. The summary announces through a live region, now in correct
    singular/plural, and changed cells describe themselves in words.

## Epic 5 — Closeout

- [x] **Positioned and named the product**
  - The working title "Sheet Delta" was a literal description of the function, which is the
    naming trap: three syllables across two words, and interchangeable with any other
    spreadsheet-diff tool. The product ships as **Redline**, after the marked-up print a
    drafter hands back with the changes struck on it in red pen, which is what the tool
    produces and the term its audience already uses.
  - The name deepened the existing blueprint direction rather than fighting it: the page is
    the blue print, every mark the tool makes is the red pen, and the wordmark's signature is
    that pen stroke drawing itself under the name. The delta glyph left with the old name.
  - The repo, slug and URL stay `sheet-delta`: they are an address, not a brand.
- [x] **Turned away files that are not spreadsheets**
  - SheetJS never rejects input. Given anything it does not recognize it decodes the bytes as
    text and parses them into a one-column sheet, so a JPEG named `data.csv` rendered a grid
    of mojibake and the "not really a spreadsheet" error could never fire for the case it
    named. `parse.ts` now sniffs the bytes and refuses what is not text, unless the file opens
    with a real `.xlsx`/`.xls` container magic. The undecodable-byte threshold is deliberately
    loose so a Latin-1 CSV, whose accents do not decode, still reads.
- [x] **Fixed a panic in the alignment on lopsided sheets**
  - Found by the fuzzer at the ship gate. The reverse middle-snake search walks diagonals
    centred on `delta = len(a)-len(b)` rather than on zero, so two columns against twelve
    reached diagonal -18 while the vector was offset for 15, and the engine panicked instead
    of diffing. Reachable in the wild: a sheet exported with trailing blank columns shares
    every header key, so nothing is dropped as unmatchable and the alignment sees the whole
    lopsided pair. The offset now covers the longer side plus half the span, which bounds
    every subregion of the recursion. Pinned by the fuzz corpus entry, a unit test at the
    `alignKeys` level, a readable one at the `Diff` level, and 4,800 lopsided random pairs
    checked against the naive LCS reference.
- [x] **Answered the search that brings people here**
  - The page carried a bare product name as its title and nothing a search engine could read.
    It now leads with the job it does, and 589 words of reference copy and FAQ sit below the
    app as static markup, so they read without running any script.
- [x] **Removed the dead code**
  - `Op.UnmarshalJSON` decoded data nothing decodes: ops cross the WASM boundary Go to JS
    only, and the only test exercising it existed to exercise it. The wire-format test now
    reads ops as strings the way the frontend does.

### Known gaps at v1.0.0

- **Large-sheet performance** is measured but unverified against its target: a 50k-row compare
  takes ~5.9s on a 2-vCPU box against a 3s budget written for a mid-tier laptop. The cost is
  the JSON boundary, not the algorithm (see `docs/ARCHITECTURE.md`), so beating it means a
  leaner encoding, which is a protocol change rather than a tuning pass.
- **The row-number gutter can show the same number twice.** Removed rows are numbered from the
  "before" sheet and everything else from the "after" sheet, so the two can collide next to
  each other. Honest but momentarily confusing; git shows two columns for exactly this reason.
