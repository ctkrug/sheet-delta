# Architecture

A map of the codebase for anyone (or any later session) picking it up cold.
See [VISION.md](VISION.md) for why, [DESIGN.md](DESIGN.md) for the visual direction,
[BACKLOG.md](BACKLOG.md) for what's left.

## The shape of it

Two halves that meet at one function call:

- **`internal/diff`** — the Go diff engine. Pure, UI-free, and the only place the
  comparison logic lives. Compiled to WebAssembly.
- **`src/`** — the TypeScript frontend. Parses files with SheetJS, hands sheets to the
  engine, renders the result as a grid.

There is no server, and that is load-bearing rather than incidental: "your data never
leaves your browser" is true by construction because there is nowhere for it to go.
The site is static files.

```
index.html            page shell; loads src/main.ts
src/
  main.ts             entry point — finds #app and mounts the app
  app.ts              all app state; wires files → engine → grid + summary
  types.ts            the data model shared with Go + RedlineError
  parse.ts            File → Workbook, via SheetJS (input boundary)
  engine.ts           loads main.wasm; exposes diffSheets()
  grid.ts             DiffResult → the spreadsheet grid (the hero)
  summary.ts          Summary → the rolling counter bar
  export.ts           DiffResult → CSV text (the download)
  dropzone.ts         drag-and-drop / click-to-browse file zones
  style.css           the whole stylesheet; tokens from DESIGN.md
cmd/wasm/main.go      the WASM bridge: redline.diff(before, after)
internal/diff/
  diff.go             Sheet/Result types + the Diff pipeline (start here)
  value.go            Normalize/Equal — the cell equality rule
  column.go           AlignColumns — header matching
  myers.go            alignKeys — the sequence alignment
  pair.go             pairRows — moves and modifications
  op.go               Op + its JSON encoding
  keys.go             interner — strings to alignment keys
scripts/
  build-wasm.sh       builds main.wasm + copies wasm_exec.js into public/
  smoke-wasm.mjs      exercises the real compiled engine over the JS boundary
  smoke-browser.mjs   drives the built app in a real Chromium (layout + keyboard)
public/               static assets + build output (main.wasm, wasm_exec.js)
```

## How a diff actually happens

1. **Drop** — `dropzone.ts` takes a `File`, checks its extension, hands it to `app.ts`.
2. **Parse** — `parse.ts` reads it with SheetJS into `{header, rows}` of **strings**.
   Everything is a string from here on: the engine's equality rule is defined over text,
   so letting SheetJS coerce types would make a value differ by which file it came from.
   A `.csv` is decoded as UTF-8 here before SheetJS sees it — text has no encoding of its
   own, and SheetJS otherwise guesses a legacy codepage for any file lacking a BOM, which
   made an Excel export and a Google Sheets export of the same data differ on every
   accented row.
3. **Compare** — `app.ts` calls `engine.ts`'s `diffSheets`, which JSON-encodes both sheets,
   calls `redline.diff` (Go, in WASM), and decodes a `DiffResult`.
4. **Render** — `grid.ts` draws the grid, `summary.ts` rolls the counters.

The engine pipeline (`diff.go`'s `Diff`), which is the actual product:

1. **Align columns by header name** (`column.go`). First, because a column inserted
   upstream shifts every later cell — fingerprinting rows over raw positions would report
   the entire sheet as changed.
2. **Fingerprint rows over the shared columns only** and align them with an LCS edit
   script (`myers.go`). A row's identity is its content, not its position, so a re-sorted
   sheet still matches up.
3. **Pair the leftovers** (`pair.go`). Alignment can only say equal/insert/delete, so a
   moved row looks like delete+insert and a one-cell edit looks like two changed rows.
   Three passes, cheapest and most certain first: moves pair globally by exact
   fingerprint; modifications pair by similarity within a block of consecutive changes;
   whatever is still unpaired is then matched against the rest of the leftovers, which is
   what catches a row that both moved and was edited. The last pass skips itself when the
   leftover set is too large to search.
4. **Compare cells inside matched pairs only** — so exactly the changed cells are flagged.

Each step exists because of a specific false positive it removes. That is the whole
point: a text diff is wrong here not because it is imprecise but because it never
reconstructs the two-dimensional shape of the data.

## Decisions worth knowing

- **Alignment is Myers, not the textbook DP.** An `n*m` LCS table is ~20GB for two
  50k-row sheets. `alignKeys` first drops rows with no counterpart on the other side
  (they can never join a common subsequence), which collapses the unrelated-sheets worst
  case to O(n+m), then runs Myers' O(ND) over the rest, where D is the real edit count.
  Correctness is pinned by property tests against a naive LCS (`myers_test.go`).
- **Keys are interned, not hashed.** A hash collision would silently align two different
  rows and report a confidently wrong diff. `keys.go` maps strings to dense ids instead.
- **One equality rule, everywhere** (`value.go`). Whitespace is insignificant, numerics
  compare numerically (`"1.0" == "1"`), everything else is an exact string. `Equal` must
  stay an equivalence relation or fingerprinting and cell comparison would disagree.
- **The boundary is JSON strings.** `syscall/js` copies values one at a time, so one
  copy of a whole sheet beats a copy per cell. Errors come back as a tagged
  `{ok:false}` value rather than thrown, because a Go panic across the boundary unwinds
  the WASM instance and takes the page with it.
- **Ops marshal as names** (`"modify"`, not `4`), so reordering the constants can't
  silently repaint the grid.
- **The grid caps at 5,000 rendered rows** and offers the rest on a click. Every row is
  a live DOM node. The cap is never silent — a diff tool that quietly hides rows reads
  as "no more changes", which is the one lie it must not tell.

## Running it

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Go tests | `go test ./...` |
| Frontend tests | `npm test` |
| Coverage | `npm run test:coverage` |
| Typecheck | `npm run lint` |
| Build (WASM + site) | `npm run build` → `dist/` |
| Real-engine smoke test | `npm run test:wasm` (needs a build first) |
| Real-browser smoke test | `npm run test:browser` (needs a build first) |
| Fuzz the engine | `go test ./internal/diff -fuzz FuzzDiff -fuzztime 30s` |
| Everything CI runs | see `.github/workflows/ci.yml` |

`npm run build` emits a self-contained static `dist/`. Every path is relative (Vite
`base: "./"`, and `engine.ts` resolves the WASM against `document.baseURI`) because the
site is served from the `/sheet-delta` subpath, where a leading-slash path would 404.

## Testing approach

- **The engine is tested in Go**, including property tests: alignment against a naive
  LCS reference, and `Normalize`'s fast path against an unoptimized reference. Pure
  logic gets properties; the pipeline gets the wow moment and its edge cases.
- **The frontend is tested in vitest/jsdom with the engine stubbed** — jsdom cannot
  instantiate a 3MB WASM module, and the engine has its own tests. `app.test.ts` drives
  real CSV and `.xlsx` files through the actual parse and render path.
- **`scripts/smoke-wasm.mjs` covers the seam neither reaches**: the real compiled binary
  across the real JS boundary. Without it, a rename in `cmd/wasm/main.go` would break the
  app with every other test green.
- **`scripts/smoke-browser.mjs` covers what jsdom structurally cannot**: layout and
  scrolling. The pinned header, the absence of sideways page scroll at 390/768/1440, the
  5,000-row cap and the keyboard path are all asserted against a real Chromium driving the
  real engine. Both smoke tests run in CI.
- **`FuzzDiffHoldsItsInvariants` (`fuzz_test.go`)** asserts what must hold for *any* pair
  of sheets — above all that every row of both sheets renders exactly once. A dropped or
  doubled row is invisible to the eye in a grid, so only a property test finds it.

## Known gaps

- **Large-sheet performance (Story 9) is unverified against its target.** A 50k-row
  compare takes ~5.5s end to end on a 2-vCPU box, against a 3s budget defined for a
  mid-tier laptop — so this neither passes nor fails; it needs measuring on target
  hardware. The profile: JSON *unmarshal* inside WASM ~2.2s, the diff itself ~2.2s,
  marshal ~0.8s, JS parse ~0.5s. The engine is not the problem, the JSON boundary is —
  but note that only the ~0.8s marshal is recoverable by returning indices instead of
  values. The input still has to be read. Meaningfully beating this means a leaner
  encoding across the boundary, not a faster algorithm, and that is a protocol change.
