# Redline

**▶ Live demo — [apps.charliekrug.com/sheet-delta](https://apps.charliekrug.com/sheet-delta/)**

[![CI](https://github.com/ctkrug/sheet-delta/actions/workflows/ci.yml/badge.svg)](https://github.com/ctkrug/sheet-delta/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-1E5AA8.svg)](LICENSE)

**Compare two Excel files, highlight what actually changed.**

Drop in last month's export and this month's. Redline lines the rows up by their content, so a
row that only moved stays quiet and only the cells that really changed light up. It runs
entirely in your browser: there is no server to upload to, and no account.

![Redline comparing two versions of a price list: a re-sorted row stays unmarked, two edited
cells show their old value beside the new one, one row is struck through as removed and one is
marked added.](docs/screenshot.png)

That is a vendor price list exported twice. Between the two, someone re-sorted the sheet,
raised one price, revised one quantity, dropped a SKU and added another. Redline reports
exactly that: 1 added, 1 removed, 2 changed cells. The re-sorted rows say nothing, because
nothing in them changed.

## The problem it solves

Paste those same two files into any text-diff tool and you get a wall of red and green.
Text diffs compare line 1 to line 1, line 2 to line 2, and so on, so re-sorting the export
shifts every line and every line reads as changed. The five edits you were looking for are
buried in four thousand false ones.

A spreadsheet is two-dimensional, and comparing one has to be too:

1. **Columns are matched first**, by header name, so a field inserted upstream shifts nothing
   after it.
2. **Rows are fingerprinted by their contents** and aligned with a Myers longest-common-
   subsequence pass, the same family of algorithm behind `git diff`, run over rows instead of
   characters. A row's identity is what it says, not where it sits.
3. **Cells are compared last**, only inside rows already established as the same row at two
   points in time, so only genuine edits get marked.

The output is the grid you already know, marked up in place, which is the thing a line-based
diff structurally cannot give you: it never reconstructs the shape of the data.

## What it does

- **Reads .csv, .xlsx and .xls**, up to 100MB per file, and lets you pick the sheet to compare
  in a multi-sheet workbook.
- **Marks changed cells in place**, each showing its old value beside the new one.
- **Tells reorders apart from edits**: a moved row is reported as moved, not as one deletion
  plus one insertion.
- **Survives an inserted column** without reporting every cell to its right as changed.
- **Exports the diff as CSV**, where a changed cell reads `200 -> 250`, so it can go straight
  into a ticket or a mail.
- **Sends nothing anywhere.** The diff engine is Go compiled to WebAssembly and ships with the
  page. Open your dev tools network tab and watch it stay silent while you compare.

## Usage

Open the [live demo](https://apps.charliekrug.com/sheet-delta/), drop a file on **Before** and
another on **After**. That is the whole flow. Nothing is installed and nothing is uploaded.

Given `prices-jan.csv`:

```csv
sku,product,unit_price,qty
A-1042,Cold brew concentrate,18.50,240
B-2210,Oat milk 1L,3.20,1800
C-3391,Espresso beans 1kg,24.00,320
```

and `prices-feb.csv`, re-sorted with one price raised:

```csv
sku,product,unit_price,qty
C-3391,Espresso beans 1kg,24.00,320
A-1042,Cold brew concentrate,19.25,240
B-2210,Oat milk 1L,3.20,1800
```

Redline reports one changed cell and one moved row, rather than three rewritten rows.
Downloading that comparison gives exactly this:

```csv
Change,Row,sku,product,unit_price,qty
moved,2,C-3391,Espresso beans 1kg,24.00,320
changed,3,A-1042,Cold brew concentrate,18.50 -> 19.25,240
,4,B-2210,Oat milk 1L,3.20,1800
```

The row that only moved is labelled `moved` and its cells are left alone. A text diff would
have called it one deletion and one insertion.

## Running it yourself

Building the WebAssembly engine needs a Go 1.22+ toolchain alongside Node 20+.

```sh
npm install
npm run dev           # start the Vite dev server
npm run build         # compile the WASM engine and build the static site into dist/
```

`npm run build` produces a self-contained static `dist/` using only relative paths, so it can be
served from any subpath, including a bare `file://` open.

### Tests

```sh
go test ./...         # the diff engine's own suite, including a fuzz test
npm test              # the frontend suite
npm run test:coverage # ...with a coverage report
npm run lint          # typecheck
npm run test:wasm     # exercise the compiled engine over the real JS boundary (needs a build)
npm run test:browser  # drive the built app in a real Chromium (needs a build)
```

`npm run test:browser` needs a Chromium, which `npx playwright install chromium` fetches once.
It covers what jsdom structurally cannot: real layout, real scrolling, and the real compiled
engine. `make test`, `make test-wasm` and `make test-browser` wrap the same commands.

## How it is built

| Layer        | Choice                                    |
|--------------|-------------------------------------------|
| Diff engine  | Go, compiled to WebAssembly                |
| File parsing | [SheetJS](https://sheetjs.com/) in TypeScript |
| Frontend     | TypeScript + Vite, static output           |
| Hosting      | Static site, no backend                    |

Go handles the alignment because a longest-common-subsequence pass over tens of thousands of
rows is real work, and it keeps the core algorithm testable on its own, away from the DOM.
SheetJS stays the parser because rewriting `.xlsx` parsing would be effort spent nowhere near
the thing that makes this tool different.

Further reading: [`docs/VISION.md`](docs/VISION.md) for the rationale,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a map of the codebase,
[`docs/DESIGN.md`](docs/DESIGN.md) for the visual direction, and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the build log.

## License

MIT, see [`LICENSE`](LICENSE).

More of Charlie's projects → https://apps.charliekrug.com
