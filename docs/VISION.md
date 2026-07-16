# Vision

## The problem

Comparing two versions of a spreadsheet is a chore everyone hits and almost no tool handles
well. The usual options are: eyeball two open windows side by side, paste both into a generic
text-diff tool (which flattens rows to lines and lights up an entire row as "changed" the moment
it moves one position), or open a paid desktop app that wants a license and an install. None of
them answer the actual question people have — *"what data actually changed between these two
exports?"* — without a mountain of false positives from rows that simply got reordered, sorted,
or had a column inserted upstream.

## Who it's for

Anyone who regularly gets two versions of the same tabular export and needs to know what
changed: analysts comparing monthly report pulls, engineers diffing config/data CSVs in a PR,
finance/ops people reconciling two spreadsheet snapshots, anyone auditing a vendor data feed.
The common thread is *tabular data, two points in time, no tooling budget, and a strong
preference for not uploading the file anywhere.*

## The core idea

Treat this as a two-dimensional diff problem, not a text diff problem:

1. **Align rows** — find which rows in "before" correspond to which rows in "after," treating a
   row as an opaque unit (fingerprinted by its cell values) so reordering doesn't register as
   change. This uses a longest-common-subsequence edit script, the same family of algorithm
   behind `diff`/`git diff`, but operating on row fingerprints instead of characters.
2. **Align columns** — handle column insertion/removal/reorder so a diff survives a header
   getting a new field added in the middle.
3. **Diff cells within matched rows** — only after two rows are established as "the same row
   at two points in time" do we compare their cells, and only the cells that actually differ get
   marked.
4. **Render it as a grid, not a wall of text** — the output is the spreadsheet itself, laid out
   as a grid, with added rows, removed rows, and changed cells highlighted in place. That's the
   thing a generic diff tool structurally cannot produce, because it never reconstructs the
   two-dimensional shape of the data.

Everything runs client-side: the diff engine is Go compiled to WebAssembly (for the
performance a two-file, tens-of-thousands-of-rows comparison needs), and file parsing is
[SheetJS](https://sheetjs.com/) in the browser. No file is ever uploaded to a server — there is
no server. That's not just a privacy nicety; it's what makes "drag in two files and get an
answer in under a second" possible without provisioning any backend at all.

## Key design decisions

- **Row fingerprint, not row index, is the unit of identity.** A row is "the same row" if its
  cell values match, regardless of position. This is what correctly detects a pure reorder as
  unchanged instead of delete+insert — the whole point of the tool.
- **WASM for the diff engine, not JS.** LCS-based alignment on tens of thousands of rows is the
  kind of workload where a compiled diff engine matters; Go was chosen for straightforward
  WebAssembly compilation and a clean, testable core algorithm independent of the UI.
  SheetJS remains the parser because rewriting `.xlsx` parsing from scratch would be wasted
  effort with no payoff for the actual differentiator (the diff, not the parse).
  See [`docs/DESIGN.md`](DESIGN.md) for the visual direction.
- **Static site, no backend, ever.** This is a product decision, not just an implementation
  detail: "your data never leaves your browser" has to be true by construction, not by policy,
  for people to trust it with real spreadsheets.
- **The grid view is the product.** A summary count of "12 rows changed" is a byproduct; the
  actual deliverable is being able to look at the familiar spreadsheet shape and see exactly
  which cells moved.

## What "v1 done" looks like

- Drag-and-drop (or click-to-browse) two files, CSV or Excel (`.csv`, `.xlsx`, `.xls`).
- Row-aware, column-aware diff renders as the spreadsheet grid itself, with added rows, removed
  rows, and changed cells highlighted — a pure row reorder shows zero false changes.
- A summary bar reporting rows added / removed / changed and total cells changed.
- Correct on real-world edge cases: a column inserted or removed between the two files, empty
  cells, duplicate rows, and sheets with 10k+ rows without the tab hanging.
- The whole flow works with no network requests after the page loads — verifiable by opening the
  dev tools network tab and seeing nothing fire once the two files are dropped.
- Ships as a single static `dist/` deployable to `apps.charliekrug.com/sheet-delta` with no
  server component.
