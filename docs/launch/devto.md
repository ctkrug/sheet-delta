---
title: "Why your spreadsheet diff is wrong, and what I built instead"
published: false
tags: go, webassembly, typescript, showdev
canonical_url: https://apps.charliekrug.com/sheet-delta/
---

Someone sends you this month's export of the same report you got last month. Four thousand
rows. Something in it changed and you need to know what.

So you paste both into a diff tool, and you get back a wall of red and green, because between
the two exports someone sorted by a different column. Every line moved, so every line reads as
changed. The eight edits you were looking for are under four thousand false ones.

That is not a gap you can fix with a better UI. It is the wrong algorithm.

## Line diffs assume a spreadsheet is a document

`diff` compares line 1 to line 1, line 2 to line 2, and it is very good at that. But it assumes
a line's position carries meaning, which is true of source code and false of tabular data. In a
spreadsheet, a row's identity is its contents, and sorting a table does not change the data in
it at all. Every text diff disagrees, loudly.

I built [Redline](https://apps.charliekrug.com/sheet-delta/) to treat the sheet as what it is:
two axes that both need aligning before a single cell is compared. Two decisions turned out to
matter.

## Decision 1: align rows by fingerprint, not by index

The core is a Myers longest-common-subsequence pass, the same family of algorithm behind
`git diff`. The trick is what you run it over. Instead of characters or lines, each row is
hashed into a fingerprint over the columns the two sheets share, and the LCS runs over those
fingerprints. A row is "the same row" if it says the same thing, wherever it sits.

That alone kills the false positives from sorting. What it does not handle is the row that both
moved and got edited, which is the interesting case and the one I got wrong first. Such a row
matches nothing in the LCS: its fingerprint changed, so it is a leftover on both sides, and the
naive answer is to report it as one deletion plus one insertion. Which is exactly the wrong
answer I set out to avoid, hiding in a corner case.

The fix is a second pass over the leftovers, pairing them by cell-level similarity, so a row
that moved and had one cell edited comes back as one modified row rather than a delete and an
add. There is a guard on it: pairing leftovers is quadratic, so above a block size the pass
falls back to positional matching rather than hanging the tab on a pathological input.

Columns get aligned first, by header name, for the same reason. Insert a column upstream and
every cell to its right shifts one over. Compare by position and the whole sheet is "changed."

## Decision 2: put the engine in WebAssembly, and mean it

The diff engine is Go compiled to WASM. Partly that is performance: an LCS pass over 50,000
rows is real work, and it runs in about five seconds in the browser rather than locking the tab
for a minute. Partly it is testability. The engine knows nothing about the DOM, so it has a Go
test suite with a fuzz test that checks an invariant that actually matters: every row of both
input sheets shows up exactly once in the output. Row conservation. You cannot silently lose a
row.

But the real reason is the product one. The pitch is "your spreadsheet never leaves your
browser," and I wanted that to be true by construction rather than by policy. There is no
server. There is no upload endpoint to accidentally leave logging. The engine ships with the
page and reads the file in your tab. If you are comparing a sheet with salary figures in it,
"we promise we delete it" and "it never went anywhere" are very different sentences.

## What I would do differently

I let SheetJS decode CSV bytes for a while, which quietly guesses a legacy codepage unless the
file opens with a byte-order mark. Excel writes that mark. Almost nothing else does. So the
same data exported from Excel and from Google Sheets decoded two different ways and diffed as
changed on every row containing an accent. It is now decoded as UTF-8 in one place, which also
keeps SheetJS's codepage tables out of the bundle.

The lesson I keep relearning: in a comparison tool, every bug is a false positive, and a false
positive is the one thing that destroys trust in it. Nobody forgives a diff that cries wolf.
The tests that earn their keep are the ones asserting something is *not* reported.

Code is [on GitHub](https://github.com/ctkrug/sheet-delta), MIT. The tool is
[here](https://apps.charliekrug.com/sheet-delta/). No account, nothing to install.

If you have a pair of exports that it gets wrong, I would genuinely like to see them.
