# Sheet Delta

**Drop in two spreadsheets. See exactly what changed — cell by cell, right on the grid.**

Sheet Delta compares two CSV or Excel files and renders a git-diff-style, cell-level view of
what actually changed: added rows, removed rows, and changed cells highlighted inline on the
original grid. Everything runs client-side in your browser — no upload, no server, no account.

## Why

Every "spreadsheet diff" tool people reach for today is really a text diff wearing a costume:
it flattens the sheet to lines and diffs *those*, so if row 40 moves to row 41 the whole row
lights up red/green even though nothing in it changed. That's noise, not a diff. Real change
detection on tabular data has to be row- and column-aware — closer to a sequence alignment
problem than a line diff.

Sheet Delta adapts a proper diff algorithm to two dimensions: it aligns rows (so a moved row
is recognized as *moved*, not deleted+added), then aligns columns, then does a cell-level
comparison only within matched rows. The output is the spreadsheet grid itself, with only the
cells that actually changed highlighted in place.

## The wow moment

Drop in last month's export and this month's. Instead of a wall of red/green lines, you get
the actual grid back — same shape, same layout — with just the handful of cells that changed
lit up. Rows that were only reordered stay quiet.

## How it works

- **Diff engine** — written in Go, compiled to WebAssembly. Row alignment uses a Myers-style
  LCS/edit-script approach adapted to operate on row fingerprints instead of characters, so
  reordered rows are detected as moves rather than delete+insert pairs. Column alignment and
  per-cell comparison run inside each matched row pair.
- **File parsing** — [SheetJS](https://sheetjs.com/) in the browser reads `.csv`, `.xlsx`, and
  `.xls` into a common tabular representation before it's handed to the WASM diff engine.
- **Everything client-side** — no file ever leaves the browser. There's no backend to this
  app; it's a static site.

## Planned features

- [ ] Drag-and-drop two-file input (CSV, XLS, XLSX)
- [ ] Row-aware, column-aware cell-level diff (the core algorithm)
- [ ] Inline grid rendering with added / removed / changed highlighting
- [ ] Moved-row detection (no false "changed" on pure reorders)
- [ ] Column insertion/removal handling (not just row alignment)
- [ ] Diff summary bar (rows added / removed / changed, cells changed)
- [ ] Export the diff view as CSV or a shareable static HTML snapshot
- [ ] Large-file performance via WASM (tested against sheets with 50k+ rows)

## Stack

| Layer         | Choice                                   |
|---------------|-------------------------------------------|
| Diff engine   | Go, compiled to WebAssembly                |
| File parsing  | SheetJS (`xlsx`) in TypeScript             |
| Frontend      | TypeScript + Vite, static output           |
| Hosting       | Static site, no backend                    |

See [`docs/VISION.md`](docs/VISION.md) for the full design rationale and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the build plan.

## Status

Early scaffold. Not yet functional — see the backlog for what's next.

## License

MIT — see [`LICENSE`](LICENSE).
