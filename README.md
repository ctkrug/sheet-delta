# Sheet Delta

[![CI](https://github.com/ctkrug/sheet-delta/actions/workflows/ci.yml/badge.svg)](https://github.com/ctkrug/sheet-delta/actions/workflows/ci.yml)

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

- **Diff engine** — written in Go, compiled to WebAssembly. It aligns **columns first**, by
  header name, because a column inserted upstream shifts every later cell and would otherwise
  make the whole sheet look changed. Rows are then fingerprinted over the columns the two
  sheets share and aligned with a Myers LCS edit script — operating on row fingerprints
  instead of characters, so a row's identity is its content, not its position. Leftover rows
  are paired into moves and modifications, and only then are cells compared, inside matched
  pairs, so exactly the changed cells are flagged.
- **File parsing** — [SheetJS](https://sheetjs.com/) in the browser reads `.csv`, `.xlsx`, and
  `.xls` into a common tabular representation before it's handed to the WASM diff engine.
- **Everything client-side** — no file ever leaves the browser. There's no backend to this
  app; it's a static site.

## Features

- [x] Drag-and-drop two-file input (CSV, XLS, XLSX), with click-to-browse
- [x] Row-aware, column-aware cell-level diff (the core algorithm)
- [x] Inline grid rendering with added / removed / changed highlighting
- [x] Moved-row detection (no false "changed" on pure reorders)
- [x] Column insertion/removal handling (not just row alignment)
- [x] Diff summary bar (rows added / removed / changed / moved, cells changed)
- [x] Multi-sheet workbooks: pick which sheet to compare
- [x] Export the diff view as CSV (a changed cell exports as `before -> after`)
- [ ] Large-file performance tuning (50k rows diff correctly; see the backlog)

## Stack

| Layer         | Choice                                   |
|---------------|-------------------------------------------|
| Diff engine   | Go, compiled to WebAssembly                |
| File parsing  | SheetJS (`xlsx`) in TypeScript             |
| Frontend      | TypeScript + Vite, static output           |
| Hosting       | Static site, no backend                    |

See [`docs/VISION.md`](docs/VISION.md) for the full design rationale,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a map of the codebase,
[`docs/DESIGN.md`](docs/DESIGN.md) for the visual direction, and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the build plan.

## Getting started

```sh
npm install
npm run dev           # start the Vite dev server
npm test              # run frontend tests
npm run test:coverage # ...with a coverage report
npm run lint          # typecheck
npm run build         # compile the WASM engine + build the static site into dist/
npm run test:wasm     # exercise the compiled engine (needs a build first)
npm run test:browser  # drive the built app in a real Chromium (needs a build first)
go test ./...         # run the diff engine's Go test suite
```

Building the WASM engine requires a local Go 1.22+ toolchain in addition to Node.
`npm run build` produces a self-contained static `dist/` with only relative paths, so it
can be served from any subpath.

`npm run test:browser` needs a Chromium, which `npx playwright install chromium` fetches
once. It covers what jsdom structurally cannot: real layout, real scrolling, and the real
compiled engine.

## Status

Feature complete: drop two files, get the grid diff, download it as CSV. The layout, the
keyboard path, the download and the compiled engine are all verified in a real browser by
`npm run test:browser`. The one open item is the large-sheet performance target, which is
measured but unmet on slow hardware — see [`docs/BACKLOG.md`](docs/BACKLOG.md), and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the code fits together.

## License

MIT — see [`LICENSE`](LICENSE).
