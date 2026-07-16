package diff

import (
	"math/rand"
	"testing"
)

// naiveLCSLen is the textbook O(n*m) dynamic-programming LCS length. It is
// obviously correct and obviously too slow for real sheets, which makes it
// the reference the fast alignment is checked against.
func naiveLCSLen(a, b []uint64) int {
	table := make([][]int, len(a)+1)
	for i := range table {
		table[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				table[i][j] = table[i+1][j+1] + 1
			} else if table[i+1][j] >= table[i][j+1] {
				table[i][j] = table[i+1][j]
			} else {
				table[i][j] = table[i][j+1]
			}
		}
	}
	return table[0][0]
}

// checkScript asserts the edit script is a valid alignment of a to b:
// indices are consumed strictly in order, every element of each side is
// accounted for exactly once, and equal-marked pairs really are equal.
// It returns the number of matched pairs.
func checkScript(t *testing.T, a, b []uint64, script []edit) int {
	t.Helper()
	ai, bi, equals := 0, 0, 0
	for _, e := range script {
		switch e.op {
		case OpEqual:
			if e.aIndex != ai || e.bIndex != bi {
				t.Fatalf("equal out of order: got a=%d b=%d, want a=%d b=%d", e.aIndex, e.bIndex, ai, bi)
			}
			if a[e.aIndex] != b[e.bIndex] {
				t.Fatalf("equal marks unequal keys at a=%d b=%d", e.aIndex, e.bIndex)
			}
			ai++
			bi++
			equals++
		case OpDelete:
			if e.aIndex != ai || e.bIndex != -1 {
				t.Fatalf("delete out of order: got a=%d, want a=%d (bIndex %d)", e.aIndex, ai, e.bIndex)
			}
			ai++
		case OpInsert:
			if e.bIndex != bi || e.aIndex != -1 {
				t.Fatalf("insert out of order: got b=%d, want b=%d (aIndex %d)", e.bIndex, bi, e.aIndex)
			}
			bi++
		}
	}
	if ai != len(a) || bi != len(b) {
		t.Fatalf("script consumed a=%d/%d b=%d/%d", ai, len(a), bi, len(b))
	}
	return equals
}

// The alignment must be optimal, not merely valid: a valid-but-lazy script
// (delete everything, insert everything) would make every reordered row
// show as a false change, which is the exact failure this tool exists to
// avoid. Random sequences over a small alphabet produce plenty of
// duplicate keys, which is where alignment bugs hide.
func TestAlignKeysMatchesNaiveLCSOnRandomSequences(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	for _, alphabet := range []uint64{2, 3, 8, 40} {
		for trial := 0; trial < 300; trial++ {
			a := randKeys(rng, rng.Intn(12), alphabet)
			b := randKeys(rng, rng.Intn(12), alphabet)

			script := alignKeys(a, b)
			equals := checkScript(t, a, b, script)
			if want := naiveLCSLen(a, b); equals != want {
				t.Fatalf("alphabet %d: matched %d rows, optimal is %d\n a=%v\n b=%v", alphabet, equals, want, a, b)
			}
		}
	}
}

// A wide sheet against a narrow one is the case the equal-length random
// trials never produce: the reverse search runs on diagonals offset by
// delta = len(a)-len(b), so a lopsided pair pushes it far from the middle
// of the vector. Sizing the vector for the sequence lengths alone left it
// indexing behind the start, which panicked instead of diffing. Header rows
// hit this in the wild: a sheet with trailing blank columns is mostly
// duplicate empty keys, so nothing gets dropped as unmatchable.
func TestAlignKeysHandlesLopsidedSequences(t *testing.T) {
	// Two columns against twelve, sharing only "" and "1": the shape the
	// fuzzer found.
	a := []uint64{0, 1}
	b := []uint64{1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}

	equals := checkScript(t, a, b, alignKeys(a, b))
	if want := naiveLCSLen(a, b); equals != want {
		t.Fatalf("matched %d, optimal is %d", equals, want)
	}
}

// The same asymmetry, swept: whichever side is longer, and at every ratio
// that changes which diagonal the search starts from.
func TestAlignKeysMatchesNaiveLCSOnLopsidedRandomSequences(t *testing.T) {
	rng := rand.New(rand.NewSource(11))
	for _, alphabet := range []uint64{2, 3, 8} {
		for _, lens := range [][2]int{{1, 12}, {12, 1}, {2, 12}, {12, 2}, {3, 25}, {25, 3}, {1, 40}, {40, 1}} {
			for trial := 0; trial < 200; trial++ {
				a := randKeys(rng, lens[0], alphabet)
				b := randKeys(rng, lens[1], alphabet)

				script := alignKeys(a, b)
				equals := checkScript(t, a, b, script)
				if want := naiveLCSLen(a, b); equals != want {
					t.Fatalf("alphabet %d, %dx%d: matched %d rows, optimal is %d\n a=%v\n b=%v",
						alphabet, lens[0], lens[1], equals, want, a, b)
				}
			}
		}
	}
}

func TestAlignKeysHandlesEmptyAndIdenticalSequences(t *testing.T) {
	full := []uint64{1, 2, 3}

	if script := alignKeys(nil, nil); len(script) != 0 {
		t.Errorf("two empty sequences produced %d edits, want 0", len(script))
	}
	if equals := checkScript(t, nil, full, alignKeys(nil, full)); equals != 0 {
		t.Errorf("empty vs full matched %d, want 0", equals)
	}
	if equals := checkScript(t, full, nil, alignKeys(full, nil)); equals != 0 {
		t.Errorf("full vs empty matched %d, want 0", equals)
	}
	if equals := checkScript(t, full, full, alignKeys(full, full)); equals != len(full) {
		t.Errorf("identical sequences matched %d, want %d", equals, len(full))
	}
}

// Two sheets with nothing in common are the worst case for the textbook
// DP. The unmatchable-key reduction must strip them to nothing, so this
// size completes instantly rather than allocating an n*m table.
func TestAlignKeysHandlesLargeDisjointSequencesQuickly(t *testing.T) {
	const n = 50_000
	a := make([]uint64, n)
	b := make([]uint64, n)
	for i := 0; i < n; i++ {
		a[i] = uint64(i)
		b[i] = uint64(i + n)
	}
	if equals := checkScript(t, a, b, alignKeys(a, b)); equals != 0 {
		t.Fatalf("disjoint sequences matched %d rows, want 0", equals)
	}
}

// The realistic shape: two large exports that mostly agree. D is small, so
// Myers should finish fast even though the sheets are big.
func TestAlignKeysHandlesLargeMostlyEqualSequencesQuickly(t *testing.T) {
	const n = 50_000
	a := make([]uint64, n)
	for i := range a {
		a[i] = uint64(i)
	}
	b := make([]uint64, 0, n)
	b = append(b, a[:1000]...)
	b = append(b, 999_001, 999_002) // two inserted rows
	b = append(b, a[1002:]...)      // ...and two dropped ones

	equals := checkScript(t, a, b, alignKeys(a, b))
	if want := naiveEqualsForMostlyEqual(a, b); equals < want {
		t.Fatalf("matched %d rows, want at least %d", equals, want)
	}
}

func naiveEqualsForMostlyEqual(a, b []uint64) int {
	inB := make(map[uint64]struct{}, len(b))
	for _, k := range b {
		inB[k] = struct{}{}
	}
	n := 0
	for _, k := range a {
		if _, ok := inB[k]; ok {
			n++
		}
	}
	return n
}

func randKeys(rng *rand.Rand, n int, alphabet uint64) []uint64 {
	keys := make([]uint64, n)
	for i := range keys {
		keys[i] = uint64(rng.Int63n(int64(alphabet)))
	}
	return keys
}
