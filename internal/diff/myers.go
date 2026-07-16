package diff

// This file implements the sequence alignment that every diff in this
// package is built on. Callers reduce rows (or column headers) to opaque
// uint64 keys where equal keys mean equal content, and alignKeys returns
// the edit script that turns a into b with the fewest edits.
//
// Why not the textbook O(n*m) dynamic-programming LCS: the table alone
// costs 8*n*m bytes, which is ~20GB for the two 50,000-row sheets this
// tool is meant to handle. Instead:
//
//  1. Rows whose key does not occur at all on the other side can never be
//     part of a common subsequence, so they are dropped up front and
//     re-emitted in place afterwards. Two unrelated sheets — the worst
//     case for the DP — reduce to nothing and cost O(n+m).
//  2. What survives is aligned with Myers' O(ND) algorithm in its
//     linear-space (divide-and-conquer middle snake) form, where D is the
//     number of real edits. Two exports of the same data have a small D,
//     which is exactly the case this tool exists to serve.

// edit is one step of an alignment. aIndex/bIndex are indices into the
// original sequences, or -1 for the side the edit does not consume.
type edit struct {
	op     Op
	aIndex int
	bIndex int
}

// alignKeys returns the edit script aligning a to b.
func alignKeys(a, b []uint64) []edit {
	// Count occurrences so rows with no counterpart can be dropped.
	inA := make(map[uint64]struct{}, len(a))
	for _, k := range a {
		inA[k] = struct{}{}
	}
	inB := make(map[uint64]struct{}, len(b))
	for _, k := range b {
		inB[k] = struct{}{}
	}

	ra, raIdx := keepMatchable(a, inB)
	rb, rbIdx := keepMatchable(b, inA)

	reduced := myers(ra, rb)

	out := make([]edit, 0, len(a)+len(b))
	ai, bi := 0, 0
	// flushA/flushB emit the dropped rows sitting between the last
	// consumed original index and the next one, preserving source order.
	flushA := func(upTo int) {
		for ; ai < upTo; ai++ {
			out = append(out, edit{op: OpDelete, aIndex: ai, bIndex: -1})
		}
	}
	flushB := func(upTo int) {
		for ; bi < upTo; bi++ {
			out = append(out, edit{op: OpInsert, aIndex: -1, bIndex: bi})
		}
	}

	for _, e := range reduced {
		switch e.op {
		case OpEqual:
			flushA(raIdx[e.aIndex])
			flushB(rbIdx[e.bIndex])
			out = append(out, edit{op: OpEqual, aIndex: raIdx[e.aIndex], bIndex: rbIdx[e.bIndex]})
			ai, bi = raIdx[e.aIndex]+1, rbIdx[e.bIndex]+1
		case OpDelete:
			flushA(raIdx[e.aIndex])
			out = append(out, edit{op: OpDelete, aIndex: raIdx[e.aIndex], bIndex: -1})
			ai = raIdx[e.aIndex] + 1
		case OpInsert:
			flushB(rbIdx[e.bIndex])
			out = append(out, edit{op: OpInsert, aIndex: -1, bIndex: rbIdx[e.bIndex]})
			bi = rbIdx[e.bIndex] + 1
		}
	}
	flushA(len(a))
	flushB(len(b))
	return out
}

// keepMatchable returns the subsequence of keys that occur on the other
// side, plus each survivor's index in the original sequence.
func keepMatchable(keys []uint64, other map[uint64]struct{}) ([]uint64, []int) {
	kept := make([]uint64, 0, len(keys))
	idx := make([]int, 0, len(keys))
	for i, k := range keys {
		if _, ok := other[k]; ok {
			kept = append(kept, k)
			idx = append(idx, i)
		}
	}
	return kept, idx
}

// myers aligns a and b with the linear-space divide-and-conquer form of
// Myers' O(ND) algorithm, returning edits indexed into a and b.
func myers(a, b []uint64) []edit {
	m := &myersState{
		a:   a,
		b:   b,
		out: make([]edit, 0, len(a)+len(b)),
	}
	// Both vectors are indexed by an absolute diagonal x-y, offset to keep
	// the index non-negative. Two vectors is the whole working set — this is
	// where the linear space comes from.
	//
	// The offset has to cover the furthest diagonal either search can reach.
	// The forward search stays within ±maxD of diagonal 0, but the reverse
	// search is centred on diagonal delta = n-m, so a lopsided pair puts its
	// diagonals |delta| out from the middle: two columns against twelve
	// reaches diagonal -18, which an offset sized for the lengths alone left
	// behind the start of the vector. maxD is at most half the span, and
	// |delta| at most the longer side; subregions of the recursion are
	// smaller on both counts, so this bound serves every middleSnake call.
	span := len(a) + len(b)
	m.offset = max(len(a), len(b)) + span/2 + 2
	size := 2*m.offset + 1
	m.vf = make([]int, size)
	m.vr = make([]int, size)
	m.compare(0, len(a), 0, len(b))
	return m.out
}

type myersState struct {
	a, b   []uint64
	vf, vr []int
	offset int
	out    []edit
}

func (m *myersState) emitEqual(aLo, bLo, n int) {
	for i := 0; i < n; i++ {
		m.out = append(m.out, edit{op: OpEqual, aIndex: aLo + i, bIndex: bLo + i})
	}
}

func (m *myersState) emitDelete(lo, hi int) {
	for i := lo; i < hi; i++ {
		m.out = append(m.out, edit{op: OpDelete, aIndex: i, bIndex: -1})
	}
}

func (m *myersState) emitInsert(lo, hi int) {
	for i := lo; i < hi; i++ {
		m.out = append(m.out, edit{op: OpInsert, aIndex: -1, bIndex: i})
	}
}

// compare aligns a[aLo:aHi] against b[bLo:bHi], appending edits in order.
func (m *myersState) compare(aLo, aHi, bLo, bHi int) {
	// Trim the common prefix: it is always on some optimal path, and
	// shrinking the region before the search keeps D small.
	for aLo < aHi && bLo < bHi && m.a[aLo] == m.b[bLo] {
		m.out = append(m.out, edit{op: OpEqual, aIndex: aLo, bIndex: bLo})
		aLo++
		bLo++
	}

	switch {
	case aLo == aHi && bLo == bHi:
		return
	case aLo == aHi:
		m.emitInsert(bLo, bHi)
		return
	case bLo == bHi:
		m.emitDelete(aLo, aHi)
		return
	}

	x, y, u, v := m.middleSnake(aLo, aHi, bLo, bHi)
	if x == aLo && y == bLo && u == aLo && v == bLo {
		// Degenerate: no progress is possible via a snake, so fall back to
		// a plain replacement rather than recursing forever.
		m.emitDelete(aLo, aHi)
		m.emitInsert(bLo, bHi)
		return
	}

	m.compare(aLo, x, bLo, y)
	m.emitEqual(x, y, u-x)
	m.compare(u, aHi, v, bHi)
}

// middleSnake finds a snake (a run of equal keys) that lies on some
// optimal edit path, returning its start (x, y) and end (u, v) in absolute
// coordinates. Searching forward from the top-left and backward from the
// bottom-right until the two frontiers overlap is what lets the recursion
// split the problem without ever materializing the full DP table.
func (m *myersState) middleSnake(aLo, aHi, bLo, bHi int) (int, int, int, int) {
	n := aHi - aLo
	bn := bHi - bLo
	delta := n - bn
	odd := delta%2 != 0
	maxD := (n+bn)/2 + 1

	// vf/vr hold absolute x for each diagonal; the frontiers meet when a
	// forward path reaches at least as far as a reverse path on the same
	// diagonal.
	vf, vr, off := m.vf, m.vr, m.offset
	vf[off+1] = aLo
	vr[off+delta+1] = aHi + 1

	for d := 0; d <= maxD; d++ {
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && vf[off+k-1] < vf[off+k+1]) {
				x = vf[off+k+1]
			} else {
				x = vf[off+k-1] + 1
			}
			y := bLo + (x - aLo) - k
			sx, sy := x, y
			for x < aHi && y < bHi && m.a[x] == m.b[y] {
				x++
				y++
			}
			vf[off+k] = x
			if odd && k-delta >= -(d-1) && k-delta <= d-1 && vf[off+k] >= vr[off+k] {
				return sx, sy, x, y
			}
		}

		for k := -d; k <= d; k += 2 {
			kr := k + delta
			var x int
			if k == -d || (k != d && vr[off+kr+1] <= vr[off+kr-1]) {
				x = vr[off+kr+1] - 1
			} else {
				x = vr[off+kr-1]
			}
			y := bLo + (x - aLo) - kr
			sx, sy := x, y
			for x > aLo && y > bLo && m.a[x-1] == m.b[y-1] {
				x--
				y--
			}
			vr[off+kr] = x
			if !odd && kr >= -d && kr <= d && vf[off+kr] >= vr[off+kr] {
				return x, y, sx, sy
			}
		}
	}
	// Unreachable for well-formed input: the frontiers must overlap by
	// D = maxD. Returning the degenerate snake makes compare fall back.
	return aLo, bLo, aLo, bLo
}
