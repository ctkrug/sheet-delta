# Design direction

## 1. Aesthetic direction

**Blueprint / technical.** Sheet Delta reads like a drafting table, not a SaaS dashboard: a
warm cream graph-paper background, precise blueprint-ink-blue lines, and a monospace ledger
font for data — evoking engineering schematics and precision instruments rather than a dark
"developer tool" chrome. This is a deliberate break from dark-theme-by-default: a diff tool
lives or dies on legibility of dense tabular data, and a light, high-contrast paper surface
reads that data better than a glowing dark panel.

## 2. Tokens

| Token             | Value      | Use                                            |
|--------------------|------------|-------------------------------------------------|
| `--bg`             | `#F3EFE4`  | Page background — warm cream paper              |
| `--surface-1`      | `#FFFFFF`  | Cards, the grid canvas, drop zone                |
| `--surface-2`      | `#E8E2D2`  | Muted panels, graph-paper ruling, disabled states |
| `--text`           | `#1B2430`  | Primary text — near-black ink navy               |
| `--text-muted`     | `#5C6773`  | Secondary text, captions, helper copy            |
| `--accent`         | `#1E5AA8`  | Blueprint ink blue — links, focus, primary CTA   |
| `--accent-support` | `#C05621`  | Rust/copper — secondary emphasis, moved-row mark |
| `--success`        | `#2F7A4F`  | Added rows/cells                                 |
| `--danger`         | `#B3261E`  | Removed rows/cells                               |

**Type pairing:**
- Display — [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) (wordmark,
  headings), fallback `ui-sans-serif, system-ui, sans-serif`.
- UI / data — [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) (grid cells,
  diffs, buttons, body copy) — a monospace UI font keeps every cell column-aligned and reads as
  "data instrument," not marketing copy. Fallback `ui-monospace, "SF Mono", Consolas, monospace`.

**Spacing:** 8px base unit — `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.

**Corner radius:** `4px` everywhere. Blueprints are crisp and ruled, not soft — no pill buttons,
no large border-radius cards.

**Shadow / depth:** no blurred glassy shadows. Depth reads as a hard-edged drafting-stencil
offset: `1px solid var(--accent)` border + `2px 2px 0 rgba(27,36,48,0.15)` flat offset shadow.
Panels also carry a faint graph-paper ruling (repeating 8px linear-gradient lines in
`--surface-2` at low opacity) instead of a flat, empty background.

**Motion:** UI transitions `150ms ease-out`. Diff-cell highlight pulses in `90ms ease-out` when
a comparison completes (fast enough to read as instant, slow enough to see the highlight land).

## 3. Layout intent

The **hero is the diff grid itself** — the rendered spreadsheet with changed cells highlighted
in place. Everything else (upload zone, summary bar) is a thin frame around it.

- **Desktop (1440×900):** A slim top bar (wordmark + summary counts: rows added/removed/changed)
  pins to the top. Below it, the grid fills the remaining viewport (~75vh), full width, with its
  own scroll region so headers stay pinned. Before a diff is loaded, the same region shows a
  full-bleed two-panel drag-and-drop zone (Before / After) rather than a small centered box.
- **Phone (390×844):** Top bar collapses to wordmark + a compact summary chip. The grid region
  keeps ~65vh and scrolls both axes within its own bordered viewport (never the whole page) so
  wide sheets stay usable without breaking page layout. Drop zones stack vertically, full width.

## 4. Signature detail

The wordmark's **Δ (delta)** glyph is custom-drawn (inline SVG, not just the letter shape) and
redraws itself with a short stroke-dashoffset animation on load, like a pen tracing it — a
one-time flourish, not a distracting loop. The diff summary bar's counters (added / removed /
changed) digit-roll into place when a comparison completes, echoing an odometer/ledger tally
rather than a flat text swap.

## 5. Games/toys juice plan

Not applicable — Sheet Delta is a data tool, not a game. Interaction feedback still follows the
craft rules in the shared design standard (hover/focus/active states, 150ms transitions, a
designed empty/loading/error state for the upload flow) but there is no synthesized SFX plan.
