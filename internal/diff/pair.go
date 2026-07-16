package diff

import "sort"

// This file turns the raw alignment into what a person actually means by
// "what changed".
//
// alignKeys can only report a row as equal, inserted, or deleted, because
// a row whose fingerprint differs at all is a different row to it. That
// leaves two everyday edits misreported:
//
//   - A row that moved appears as a delete in one place and an insert in
//     another, so re-sorting a sheet would light up every row.
//   - A row with one edited cell appears as a delete plus an insert, so
//     the grid would show two whole rows in red and green instead of one
//     highlighted cell.
//
// pairRows fixes both by matching the leftover deletes against the
// leftover inserts: identical fingerprints are the same row moved, and
// similar-enough rows are the same row modified. It runs nearby, cheap
// matches first and only then reaches across the sheet, so the common
// edit-in-place keeps its obvious partner and a row that moved *and*
// changed still finds its own.

// minSimilarity is the fraction of shared columns two rows must agree on
// to be considered the same row modified rather than an unrelated
// add/remove pair.
//
// 0.5 means "at least half the row still matches". The bar has to sit at
// or below half so the common two-column (key, value) sheet still pairs a
// row whose value changed, and no lower, or unrelated rows that happen to
// share a cell would pair.
const minSimilarity = 0.5

// pairing records which "before" row each "after" row was matched to.
type pairing struct {
	// bToA maps an after-row index to its before-row index.
	bToA map[int]int
	// pairedA holds before-row indices that found a partner.
	pairedA map[int]struct{}
	// moved marks after-row indices whose match is byte-identical.
	moved map[int]struct{}
}

// pairRows matches leftover deleted rows against leftover inserted rows.
// keysA/keysB are the row fingerprints; similarity reports the fraction of
// shared columns on which the given before/after row pair agrees.
func pairRows(script []edit, keysA, keysB []uint64, similarity func(ai, bi int) float64) pairing {
	p := pairing{
		bToA:    make(map[int]int),
		pairedA: make(map[int]struct{}),
		moved:   make(map[int]struct{}),
	}

	var deletes, inserts []int
	for _, e := range script {
		switch e.op {
		case OpDelete:
			deletes = append(deletes, e.aIndex)
		case OpInsert:
			inserts = append(inserts, e.bIndex)
		}
	}

	// Pass 1 — moves, matched globally by fingerprint. A moved row can land
	// anywhere in the sheet, so this cannot be limited to nearby rows.
	// Duplicate fingerprints pair in source order, which keeps distinct
	// duplicate rows distinct instead of collapsing them onto one partner.
	byKey := make(map[uint64][]int, len(deletes))
	for _, ai := range deletes {
		byKey[keysA[ai]] = append(byKey[keysA[ai]], ai)
	}
	for _, bi := range inserts {
		queue := byKey[keysB[bi]]
		if len(queue) == 0 {
			continue
		}
		ai := queue[0]
		byKey[keysB[bi]] = queue[1:]
		p.bToA[bi] = ai
		p.pairedA[ai] = struct{}{}
		p.moved[bi] = struct{}{}
	}

	// Pass 2 — modified rows, matched by similarity within each block of
	// consecutive changes. Scoping to a block keeps this O(block^2) rather
	// than O(n^2) across the sheet, and matches the intuition that an
	// edited row stays roughly where it was.
	for _, block := range changeBlocks(script, p.pairedA, p.moved) {
		matchBlock(block, similarity, &p)
	}

	// Pass 3 — rows that both moved and were edited. A single unchanged row
	// between a row's old and new position ends the block, so pass 2 never
	// compares that row's delete with its insert and both are reported as
	// real, which is the false positive this package exists to remove:
	// "sorted by region and fixed a total" is one action to a user.
	//
	// What is left after passes 1 and 2 is small in the case this exists
	// for — a re-sorted sheet with a handful of edits. A leftover set too
	// big to search is a wholesale rewrite, where pairing rows across the
	// whole sheet is both costly and unconvincing, so those keep their
	// add/remove reading rather than blow the comparison budget.
	rest := unpaired(deletes, inserts, &p)
	if len(rest.deletes)*len(rest.inserts) <= maxBlockComparisons {
		matchBlock(rest, similarity, &p)
	}
	return p
}

// unpaired collects the leftovers no earlier pass could match.
func unpaired(deletes, inserts []int, p *pairing) block {
	var b block
	for _, ai := range deletes {
		if _, done := p.pairedA[ai]; !done {
			b.deletes = append(b.deletes, ai)
		}
	}
	for _, bi := range inserts {
		if _, done := p.bToA[bi]; !done {
			b.inserts = append(b.inserts, bi)
		}
	}
	return b
}

// block is one run of consecutive non-equal edits, minus anything already
// paired as a move.
type block struct {
	deletes []int
	inserts []int
}

func changeBlocks(script []edit, pairedA, moved map[int]struct{}) []block {
	var blocks []block
	var cur block
	flush := func() {
		if len(cur.deletes) > 0 && len(cur.inserts) > 0 {
			blocks = append(blocks, cur)
		}
		cur = block{}
	}
	for _, e := range script {
		switch e.op {
		case OpEqual:
			flush()
		case OpDelete:
			if _, done := pairedA[e.aIndex]; !done {
				cur.deletes = append(cur.deletes, e.aIndex)
			}
		case OpInsert:
			if _, done := moved[e.bIndex]; !done {
				cur.inserts = append(cur.inserts, e.bIndex)
			}
		}
	}
	flush()
	return blocks
}

// maxBlockComparisons bounds the all-pairs similarity search. A block big
// enough to exceed it means a large contiguous rewrite, where pairing rows
// by similarity is both expensive and unconvincing; those fall back to
// comparing rows positionally, which is O(min(k,m)) and still catches the
// common "this run of rows was edited in place" case.
const maxBlockComparisons = 100_000

// matchBlock pairs the most similar remaining rows in a block, best match
// first, so the strongest evidence wins regardless of source order.
func matchBlock(b block, similarity func(ai, bi int) float64, p *pairing) {
	if len(b.deletes)*len(b.inserts) > maxBlockComparisons {
		matchBlockPositionally(b, similarity, p)
		return
	}

	type candidate struct {
		ai, bi int
		score  float64
	}
	var candidates []candidate
	for _, ai := range b.deletes {
		for _, bi := range b.inserts {
			if score := similarity(ai, bi); score >= minSimilarity {
				candidates = append(candidates, candidate{ai: ai, bi: bi, score: score})
			}
		}
	}
	// Sort by score descending; ties break on source order so the result is
	// stable and reproducible.
	sort.Slice(candidates, func(i, j int) bool {
		x, y := candidates[i], candidates[j]
		if x.score != y.score {
			return x.score > y.score
		}
		if x.ai != y.ai {
			return x.ai < y.ai
		}
		return x.bi < y.bi
	})

	usedB := make(map[int]struct{}, len(b.inserts))
	for _, c := range candidates {
		if _, taken := p.pairedA[c.ai]; taken {
			continue
		}
		if _, taken := usedB[c.bi]; taken {
			continue
		}
		p.bToA[c.bi] = c.ai
		p.pairedA[c.ai] = struct{}{}
		usedB[c.bi] = struct{}{}
	}
}

// matchBlockPositionally pairs the nth deleted row with the nth inserted
// row when they are similar enough, for blocks too large to search
// exhaustively.
func matchBlockPositionally(b block, similarity func(ai, bi int) float64, p *pairing) {
	n := len(b.deletes)
	if len(b.inserts) < n {
		n = len(b.inserts)
	}
	for i := 0; i < n; i++ {
		ai, bi := b.deletes[i], b.inserts[i]
		if similarity(ai, bi) >= minSimilarity {
			p.bToA[bi] = ai
			p.pairedA[ai] = struct{}{}
		}
	}
}
